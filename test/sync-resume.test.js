// EU-2（docs/SCHEDULER-RESTART-RESILIENCE.md §EU-2）：steam-prices 分批断点续跑。
// 覆盖：读写 round-trip、有效期内排除、过期丢弃、脏数据过滤、正常收尾清断点。
// 反向自检口径：把 RESUME_MAX_AGE_MS 调成 0 → 过期丢弃断言红；把 recordResume 的
// 空数组分支删掉 → 「正常跑完清断点」断言红；把 validResumeAppids 的正整数过滤删掉 → 脏数据断言红。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readResumeState,
  validResumeAppids,
  recordResume,
  clearResume,
  writeResumeState,
  removeResumeFile,
  RESUME_MAX_AGE_MS,
} from '../src/sync-resume.js';

test('断点文件读写 round-trip：写 → 读 → 删', () => {
  const file = join(tmpdir(), `sync-resume-${Date.now()}.json`);
  try {
    assert.deepEqual(readResumeState(file), {}, '文件不存在返回空对象');
    writeResumeState({ 'steam-prices': { appids: [10, 20, 30], savedAt: Date.now() } }, file);
    const state = readResumeState(file);
    assert.deepEqual(state['steam-prices'].appids, [10, 20, 30], '写后能读回');
    removeResumeFile(file);
    assert.deepEqual(readResumeState(file), {}, '删除后读为空');
  } finally {
    rmSync(file, { force: true });
  }
});

test('validResumeAppids：有效期内返回 appid、过期丢弃、脏行过滤', () => {
  const now = Date.now();
  const fresh = { 'steam-prices': { appids: [10, 0, -3, 20, 1.5, 30], savedAt: now - 60_000 } };
  assert.deepEqual(validResumeAppids(fresh, { mode: 'steam-prices', nowMs: now }), [10, 20, 30], '过滤非正整数，保留有效 appid');
  const stale = { 'steam-prices': { appids: [10, 20], savedAt: now - RESUME_MAX_AGE_MS - 1000 } };
  assert.deepEqual(validResumeAppids(stale, { mode: 'steam-prices', nowMs: now }), [], '超过 36h 的断点陈旧丢弃（冷门报价已重新过期）');
  assert.deepEqual(validResumeAppids({}, { mode: 'steam-prices', nowMs: now }), [], '没有该 mode 的断点返回空');
  assert.deepEqual(validResumeAppids({ 'steam-prices': { appids: 'bad', savedAt: now } }, { mode: 'steam-prices', nowMs: now }), [], 'appids 非数组返回空');
  assert.deepEqual(validResumeAppids({ 'steam-prices': { appids: [1], savedAt: 'oops' } }, { mode: 'steam-prices', nowMs: now }), [], 'savedAt 非数字返回空');
  assert.deepEqual(validResumeAppids({ 'steam-prices': { appids: [10], savedAt: now - 60_000 } }, { mode: 'heat', nowMs: now }), [], '别的 mode 的断点不串');
});

test('recordResume/clearResume：追加已处理 appid、正常跑完清断点（纯函数）', () => {
  const now = Date.now();
  let state = recordResume({}, { mode: 'steam-prices', appids: [1, 2, 3], nowMs: now });
  assert.deepEqual(state['steam-prices'].appids, [1, 2, 3], '第一 chunk 落断点');
  state = recordResume(state, { mode: 'steam-prices', appids: [1, 2, 3, 4, 5], nowMs: now + 1000 });
  assert.deepEqual(state['steam-prices'].appids, [1, 2, 3, 4, 5], '断点累计（已处理集合 + 新 chunk）');
  assert.equal(state['steam-prices'].savedAt, now + 1000, 'savedAt 随每次落盘刷新');
  state = recordResume(state, { mode: 'steam-prices', appids: [], nowMs: now + 2000 });
  assert.equal(state['steam-prices'], undefined, '空数组 = 该 mode 断点清空');
  const other = recordResume({}, { mode: 'heat', appids: [9], nowMs: now });
  assert.deepEqual(clearResume(other, 'heat'), {}, 'clearResume 清掉指定 mode');
  assert.deepEqual(clearResume(other, 'steam-prices'), other, 'clearResume 不存在的 mode 不影响其它键');
});

test('损坏的断点文件返回空对象（坏 JSON 不阻塞启动）', () => {
  const file = join(tmpdir(), `sync-resume-bad-${Date.now()}.json`);
  try {
    writeFileSync(file, '{ not json');
    assert.deepEqual(readResumeState(file), {}, '坏 JSON → {}');
  } finally {
    rmSync(file, { force: true });
  }
});
