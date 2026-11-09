#!/usr/bin/env node
// README「开发进度」摘要生成器（docs/TODO-PROGRESS.md §4/§5，AS 批）
//
// 唯一数据源是 docs/TODO.md：每个条目的第一条 **状态：…** 行决定它出现在
// 「进行中 / 接下来 / 阻塞与待定 / 最近完成」哪一段。README 只放摘要，
// 标记块之外的内容一个字节都不改。
//
// 用法：
//   node scripts/todo-progress.js           # 生成并写回 README.md
//   node scripts/todo-progress.js --check   # 只比对，不一致退出 1（CI 用）
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const START = '<!-- TODO-PROGRESS:START -->';
export const END = '<!-- TODO-PROGRESS:END -->';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TODO_PATH = join(ROOT, 'docs', 'TODO.md');
const README_PATH = join(ROOT, 'README.md');
const PKG_PATH = join(ROOT, 'package.json');

const SECTION_RE = /^##\s+([A-Z]{1,2})\.\s*(.*)$/;
const STATUS_RE = /^\*\*状态[：:]\s*(.*?)\*\*/;

// 匹配顺序不能乱：`已实现并发布` 必须先命中「已发布」，否则会被当成待发版。
const RULES = [
  ['已实现并发布', 'done', ''],
  ['已发布', 'done', ''],
  ['已过时', 'obsolete', '已过时'],
  ['质检通过', 'pendingRelease', '质检通过，待发版'],
  ['已实现待发版', 'pendingRelease', '待发版'],
  ['质检打回', 'qaRejected', '质检打回'],
  ['开发中', 'inProgress', '开发中'],
  ['待质检', 'pendingQa', '待质检'],
  ['待开发', 'todo', '待开发'],
  ['依赖阻塞', 'blocked', '依赖阻塞'],
  ['待排查', 'blocked', '待排查'],
  ['待决策', 'blocked', '待决策'],
  ['等排期', 'todo', '等排期'],
];

const ACTIVE_KINDS = new Set(['pendingRelease', 'qaRejected', 'inProgress', 'pendingQa']);

/** 状态行 → { kind, label }；未知状态进 unknown，不静默丢弃。 */
export function classify(status = '') {
  const text = String(status);
  for (const [needle, kind, label] of RULES) {
    if (text.includes(needle)) return { kind, label, matched: needle };
  }
  const snippet = text.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim().slice(0, 30);
  return { kind: 'unknown', label: snippet || '状态缺失', matched: '' };
}

/** 标题清洗：去掉删除线/加粗/反引号与「→」后的状态尾巴，再剥掉开头状态前缀。 */
export function cleanTitle(raw = '') {
  let title = String(raw)
    .replace(/~~/g, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '');
  title = title.split('→')[0];
  title = title.replace(
    /^(?:已发布|已实现并发布|已实现待发版|已实现|质检通过|质检打回|开发中|待开发|待质检|待实施|待办|待排查|待决策)\s*(?:v?\d[\w.]*)?\s*[：:]\s*/,
    '',
  );
  title = title.replace(/\s+/g, ' ').trim();
  title = title.replace(/[：:。；;，,\s]+$/, '');
  return title;
}

/**
 * 解析 TODO.md：按 `## <编号>. <标题>` 切段，每段取第一条 `**状态：…**`。
 * 返回 sections（含 id/title/status/kind/label/version/line）与分类计数。
 */
export function parseTodo(todoText = '') {
  const lines = String(todoText).split(/\r?\n/);
  const sections = [];
  let current = null;

  for (let i = 0; i < lines.length; i += 1) {
    const heading = lines[i].match(SECTION_RE);
    if (heading) {
      if (current) sections.push(current);
      current = { id: heading[1], rawTitle: heading[2].trim(), status: '', line: i + 1 };
      continue;
    }
    if (current && !current.status) {
      const status = lines[i].match(STATUS_RE);
      if (status) current.status = status[1].trim();
    }
  }
  if (current) sections.push(current);

  for (const section of sections) {
    section.title = cleanTitle(section.rawTitle);
    if (section.status.includes('已过时')) {
      section.kind = 'obsolete';
      section.label = '已过时';
      continue;
    }
    // 删除线 = 历史段：只有「已发布」仍算完成，其余（旧重复字母段）不参与摘要。
    if (section.rawTitle.includes('~~') && !section.status.includes('已发布')) {
      section.kind = 'obsolete';
      section.label = '已过时';
      continue;
    }
    if (!section.status) {
      section.kind = 'structural';
      section.label = '';
      continue;
    }
    const result = classify(section.status);
    section.kind = result.kind;
    section.label = result.label;
    const version = section.status.match(/v\d+\.\d+\.\d+/);
    section.version = version ? version[0] : '';
  }

  const counts = { active: 0, todo: 0, blocked: 0, unknown: 0, done: 0 };
  for (const section of sections) {
    if (ACTIVE_KINDS.has(section.kind)) counts.active += 1;
    else if (section.kind === 'todo') counts.todo += 1;
    else if (section.kind === 'blocked') counts.blocked += 1;
    else if (section.kind === 'unknown') counts.unknown += 1;
    else if (section.kind === 'done') counts.done += 1;
  }
  return { sections, counts };
}

const listLine = (section) =>
  `- \`${section.id}\` ${section.title} —— ${section.label || '进行中'}`;

function pushList(lines, title, items) {
  if (!items.length) return;
  lines.push('', `**${title}**`, '');
  for (const item of items) lines.push(item);
}

/** 生成完整标记块（含 START/END）；同一份 TODO 必须得到同一份输出（不写时间戳）。 */
export function buildBlock({ todoText, version }) {
  const { sections, counts } = parseTodo(todoText);
  const active = sections.filter((s) => ACTIVE_KINDS.has(s.kind));
  const todo = sections.filter((s) => s.kind === 'todo');
  const blocked = sections.filter((s) => s.kind === 'blocked');
  const unknown = sections.filter((s) => s.kind === 'unknown');
  const recent = sections
    .filter((s) => s.kind === 'done')
    .sort((a, b) => b.line - a.line)
    .slice(0, 5);

  const lines = [
    START,
    '## 开发进度',
    '',
    '> 本段由 [docs/TODO.md](docs/TODO.md) 自动生成，请勿手改；改完待办状态后运行 `npm run todo:progress` 更新。',
    '',
    `**当前版本：v${version}** · 进行中 ${counts.active} · 接下来 ${counts.todo}`,
    '',
    '**进行中**',
    '',
  ];
  if (active.length) for (const s of active) lines.push(listLine(s));
  else lines.push('- 暂无');
  lines.push('', '**接下来**', '');
  if (todo.length) for (const s of todo) lines.push(listLine(s));
  else lines.push('- 暂无');
  if (blocked.length) pushList(lines, '阻塞与待定', blocked.map(listLine));
  if (unknown.length) pushList(lines, '待分类（需补状态词）', unknown.map(listLine));
  lines.push('', '**最近完成**', '');
  if (recent.length) {
    for (const s of recent) lines.push(`- \`${s.id}\` ${s.title} —— ${s.version || '已发布'}`);
  } else {
    lines.push('- 暂无');
  }
  lines.push(END);
  return lines.join('\n');
}

/** 用生成块替换 README 标记内的内容；标记缺失直接抛错，不猜位置。 */
export function applyBlock(readmeText, block) {
  const text = String(readmeText);
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  if (start < 0 || end < 0 || end < start) {
    throw new Error(`README 缺少标记：${START} / ${END}`);
  }
  return text.slice(0, start) + block + text.slice(end + END.length);
}

/** 比对 README 里的块与期望块；返回 { ok, expected, actual }。 */
export function checkBlock(readmeText, block) {
  const text = String(readmeText);
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  if (start < 0 || end < 0 || end < start) {
    return { ok: false, expected: block, actual: null };
  }
  const actual = text.slice(start, end + END.length);
  return { ok: actual === block, expected: block, actual };
}

function readVersion() {
  return JSON.parse(readFileSync(PKG_PATH, 'utf8')).version;
}

function main(argv) {
  const check = argv.includes('--check');
  try {
    const todoText = readFileSync(TODO_PATH, 'utf8');
    const readme = readFileSync(README_PATH, 'utf8');
    const version = readVersion();
    const block = buildBlock({ todoText, version });

    if (check) {
      const result = checkBlock(readme, block);
      if (!result.ok) {
        console.error('README 的「开发进度」块与 docs/TODO.md 不一致。');
        console.error('请运行 `npm run todo:progress` 后提交（CI docs-progress 会再次校验）。');
        return 1;
      }
      console.log('开发进度块与 docs/TODO.md 一致。');
      return 0;
    }

    const next = applyBlock(readme, block);
    if (next === readme) {
      console.log(`README 开发进度无变化（v${version}）。`);
    } else {
      writeFileSync(README_PATH, next);
      console.log(`README 开发进度已更新（v${version}）。`);
    }
    return 0;
  } catch (error) {
    console.error(`todo-progress: ${error.message}`);
    return 2;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  process.exitCode = main(process.argv.slice(2));
}
