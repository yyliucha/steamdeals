// README 开发进度摘要（AS 批，docs/TODO-PROGRESS.md）：
// 这条测试守的是「进度只能来自 docs/TODO.md」——分类、最近 5 个、未知状态兜底、
// 标记替换不碰标记外内容、--check 能拦住漂移。用字符串夹具，不依赖真实 README。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  START,
  END,
  classify,
  cleanTitle,
  parseTodo,
  buildBlock,
  applyBlock,
  checkBlock,
} from '../scripts/todo-progress.js';

const TODO = [
  '# 待办总览',
  '',
  '## A. ~~立即待办~~ → **已过时**',
  '',
  '## AA. 待开发：示例待办',
  '**状态：待开发（2026-01-01）**',
  '',
  '## AB. 已发布 v1.0.0：已完成功能',
  '**状态：已发布 v1.0.0（2026-01-01）**',
  '',
  '## AC. 开发中：示例进行中',
  '**状态：开发中**',
  '',
  '## AD. 状态异常',
  '**状态：准备开始**',
  '',
  '## AE. 已实现并发布 v1.1.0：不能当成待发版',
  '**状态：已实现并发布 v1.1.0（2026-01-02）**',
  '',
  '## AF. 已过时：重复段',
  '**状态：已过时**',
  '',
].join('\n');

test('状态分类：已实现并发布必须先命中去重后的「已发布」', () => {
  assert.equal(classify('已实现并发布 v1.1.0（2026-01-02）').kind, 'done', '已实现并发布 → 完成');
  assert.equal(classify('已发布 v2.2.0（2026-11-09）').kind, 'done');
  assert.equal(classify('质检通过（2026-11-09）').kind, 'pendingRelease');
  assert.equal(classify('质检通过（2026-11-09）').label, '质检通过，待发版');
  assert.equal(classify('已实现待发版（2026-11-09）').kind, 'pendingRelease');
  assert.equal(classify('开发中').kind, 'inProgress');
  assert.equal(classify('待质检').kind, 'pendingQa');
  assert.equal(classify('待开发').kind, 'todo');
  assert.equal(classify('等排期').kind, 'todo');
  assert.equal(classify('依赖阻塞').kind, 'blocked');
  assert.equal(classify('待排查').kind, 'blocked');
  assert.equal(classify('待决策').kind, 'blocked');
  assert.equal(classify('准备开始').kind, 'unknown', '未知状态进待分类，不静默丢弃');
});

test('标题清洗：去掉删除线/状态前缀/箭头后的尾巴', () => {
  assert.equal(cleanTitle('~~待开发：Steam 同步状态~~ → **已实现并发布（v1.15.0）**'), 'Steam 同步状态');
  assert.equal(cleanTitle('已发布 v2.1.0：未保存修改的离开提醒'), '未保存修改的离开提醒');
  assert.equal(cleanTitle('待开发：README 开发进度摘要（自动生成）'), 'README 开发进度摘要（自动生成）');
});

test('解析 TODO：按段落取第一条状态行，删除线历史段不参与', () => {
  const { sections, counts } = parseTodo(TODO);
  const byId = Object.fromEntries(sections.filter((s) => s.id !== 'A').map((s) => [s.id, s]));
  const sectionA = sections.find((s) => s.id === 'A');
  assert.equal(sectionA.kind, 'obsolete', '删除线历史段不参与');
  assert.equal(byId.AA.kind, 'todo');
  assert.equal(byId.AC.kind, 'inProgress');
  assert.equal(byId.AD.kind, 'unknown');
  assert.equal(byId.AE.kind, 'done', '已实现并发布不能落进待发版');
  assert.equal(byId.AF.kind, 'obsolete');
  assert.equal(byId.AA.version, '');
  assert.equal(counts.active, 1);
  assert.equal(counts.todo, 1);
  assert.equal(counts.unknown, 1);
  assert.equal(counts.done, 2);
});

test('生成块：进行中/接下来/最近完成/待分类，且不带时间戳、可重复生成', () => {
  const block = buildBlock({ todoText: TODO, version: '2.2.1' });
  assert.ok(block.startsWith(START), '块以 START 开头');
  assert.ok(block.endsWith(END), '块以 END 结尾');
  assert.match(block, /\*\*当前版本：v2\.2\.1\*\* · 进行中 1 · 接下来 1/);
  assert.match(block, /`AA` 示例待办 —— 待开发/);
  assert.match(block, /`AC` 示例进行中 —— 开发中/);
  assert.match(block, /\*\*待分类（需补状态词）\*\*/);
  assert.match(block, /`AD` 状态异常/);
  assert.match(block, /\*\*最近完成\*\*/);
  assert.match(block, /`AE` 不能当成待发版 —— v1\.1\.0/);
  assert.equal(buildBlock({ todoText: TODO, version: '2.2.1' }), block, '同一输入两次生成必须一致');
});

test('最近完成：按文件顺序倒序，最多 5 个', () => {
  const lines = ['# 待办'];
  for (let i = 0; i < 7; i += 1) {
    lines.push('', `## A${String.fromCharCode(65 + i)}. 功能 ${i}`, `**状态：已发布 v1.0.${i}（2026-01-0${i + 1}）**`);
  }
  const block = buildBlock({ todoText: lines.join('\n'), version: '1.0.0' });
  const recent = block.split('**最近完成**')[1].split(END)[0];
  const rows = recent.split('\n').filter((line) => line.startsWith('- `'));
  assert.equal(rows.length, 5, '最多 5 个');
  assert.match(rows[0], /功能 6/, '最新的在最前');
  assert.match(rows[4], /功能 2/);
});

test('标记替换：只换标记内，标记外一个字节都不动', () => {
  const readme = `# 项目\n\n前置段落\n\n${START}\n旧内容\n${END}\n\n后置段落\n`;
  const block = buildBlock({ todoText: TODO, version: '2.2.1' });
  const next = applyBlock(readme, block);
  assert.ok(next.startsWith('# 项目\n\n前置段落\n\n'), '前缀不变');
  assert.ok(next.endsWith('\n\n后置段落\n'), '后缀不变');
  assert.equal(next.match(new RegExp(START, 'g')).length, 1, '只有一个 START');
  assert.ok(next.includes(block), '标记内换成生成块');
});

test('标记缺失：直接报错，不猜位置', () => {
  assert.throws(() => applyBlock('# 没有标记的 README\n', 'x'), /缺少标记/);
});

test('--check 语义：一致返回 ok，不一致能指出期望块', () => {
  const block = buildBlock({ todoText: TODO, version: '2.2.1' });
  const good = `前\n${block}\n后\n`;
  assert.equal(checkBlock(good, block).ok, true);
  const stale = `前\n${START}\n旧内容\n${END}\n后\n`;
  const result = checkBlock(stale, block);
  assert.equal(result.ok, false);
  assert.match(result.actual, /旧内容/);
});
