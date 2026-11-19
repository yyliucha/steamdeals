// DL 批（docs/ALIGN-SNAPSHOT.md §8）：对齐审核快照落库的回归锁。
// 守的约束：① 签名三段（skus 文件/games/gsm）任一变化签名必变、不变则相同；
// ② 签名不变且未超 24h → 直接用库快照不重算（反向自检：实现若忽略签名直接重算，
//    本条 compute 间谍会抛错变红）；③ 签名变化/超龄 → 重算并写新快照（存「算后签名」）；
// ④ 生成失败写 error 可见 + rethrow（调度任务红条）；⑤ prune 只保留最近 5 条；
// ⑥ 动作后快照更新纯函数口径（移除组 + counts 按桶递减 + 钳制 ≥0）——
//    服务端若去掉同事务更新这一步，api.test.js「确认 3 组后立即读」必须红（反向自检）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  computeAlignSignature,
  loadLatestAlignSnapshot,
  loadLatestAlignSnapshotForUpdate,
  insertAlignSnapshot,
  markAlignSnapshotError,
  applyAlignSnapshotAction,
  updateAlignSnapshotAfterAction,
  markAlignSnapshotDirty,
  ensureAlignSnapshot,
  alignSnapshotMaxAgeMs,
  ALIGN_SNAPSHOT_KEEP,
} from '../src/align-snapshot.js';
import { alignGroupCounts } from '../src/align.js';

// 与 pg.js ALIGN_SNAPSHOTS_DDL 同构（只建本表，测试快）
const DDL = `
create table if not exists align_snapshots (
  id             bigserial primary key,
  payload        jsonb not null,
  counts         jsonb not null,
  signature      text  not null,
  generated_at   timestamptz not null default now(),
  generated_ms   int,
  dirty          boolean not null default false,
  last_action_at timestamptz,
  error          text
);
create index if not exists idx_align_snapshots_gen on align_snapshots (generated_at desc);
`;

async function openDb() {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(DDL);
  const q = (sql, p = []) => db.query(sql, p);
  return { db, q, close: () => db.close() };
}

// 签名查询桩：games / game_source_map 两条聚合返回固定行
const sigQ = ({ games = { n: 10, m: '2026-11-19T10:00:00Z' }, gsm = { n: 3, m: '2026-11-19T09:00:00Z' } } = {}) =>
  async (sql) => {
    if (/from games\b/.test(sql)) return { rows: [games] };
    if (/from game_source_map/.test(sql)) return { rows: [gsm] };
    throw new Error(`签名桩意外 SQL: ${sql}`);
  };

test('DL 签名：三段任一变化签名必变，不变则相同（skus 文件 size+mtime 参与）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'align-sig-'));
  const skuFile = join(dir, 'skus.json');
  try {
    writeFileSync(skuFile, '[]'); // 长度 2
    const q = sigQ();
    const s1 = await computeAlignSignature({ q, skuFile });
    const s2 = await computeAlignSignature({ q, skuFile });
    assert.equal(s1, s2, '输入不变 → 签名相同（默认缓存判据）');

    writeFileSync(skuFile, '[{"skuId":1}]'); // 长度不同 → size 必变
    assert.notEqual(await computeAlignSignature({ q, skuFile }), s1, 'skus.json 变化 → 签名变');

    writeFileSync(skuFile, '[]');
    const base = await computeAlignSignature({ q, skuFile });
    assert.notEqual(await computeAlignSignature({ q: sigQ({ games: { n: 11, m: '2026-11-19T10:00:00Z' } }), skuFile }), base, 'games count 变化 → 签名变');
    assert.notEqual(await computeAlignSignature({ q: sigQ({ games: { n: 10, m: '2026-11-19T11:00:00Z' } }), skuFile }), base, 'games max(updated_at) 变化 → 签名变');
    assert.notEqual(await computeAlignSignature({ q: sigQ({ gsm: { n: 4, m: '2026-11-19T09:00:00Z' } }), skuFile }), base, 'gsm count 变化 → 签名变');
    assert.notEqual(await computeAlignSignature({ q: sigQ({ gsm: { n: 3, m: '2026-11-19T12:00:00Z' } }), skuFile }), base, 'gsm max(reviewed_at) 变化 → 签名变');

    // 文件不存在按空处理（与 readAlignSkus 同口径），不抛错
    assert.ok(await computeAlignSignature({ q, skuFile: join(dir, 'missing.json') }), '文件缺失安全');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('DL 动作后快照更新（纯函数）：移除已处理组、counts 按桶递减、钳制 ≥0、无关字段保留', () => {
  const groups = [
    { key: 'a', skuIds: [1, 2], best: { score: 0.97 } }, // auto
    { key: 'b', skuIds: [3], best: { score: 0.9 } },     // manual
    { key: 'c', skuIds: [4], best: null },               // noCandidate
  ];
  const counts = alignGroupCounts(groups, { inheritApplied: 5, ignoredGroups: 1 }, { groups: 1, skus: 1 });
  const snapRow = { id: 1, payload: { items: groups, partial: false }, counts };
  const { payload, counts: next } = applyAlignSnapshotAction(snapRow, { removedGroups: [groups[0], groups[2]] });
  assert.deepEqual(payload.items.map((g) => g.key), ['b'], '已处理组从 payload 移除');
  assert.equal(payload.partial, false, 'payload 其它字段保留');
  assert.equal(next.groups, 1, '组数递减');
  assert.equal(next.skus, 1, 'SKU 数递减');
  assert.equal(next.auto, 0, 'auto 桶递减');
  assert.equal(next.manual, 1, 'manual 桶不动（未移除）');
  assert.equal(next.noCandidate, 0, 'noCandidate 桶递减');
  assert.equal(next.inherited, 5, 'inherited 不动');
  assert.equal(next.ignored, 1, 'ignored 不动');
  assert.equal(next.contentWords, 1, '内容词计数不动');
  // 重复/多移除也不为负（并发补偿路径）
  const again = applyAlignSnapshotAction({ payload: { items: payload.items }, counts: next }, { removedGroups: [groups[1], groups[0]] });
  assert.equal(again.counts.groups, 0);
  assert.equal(again.counts.skus, 0);
});

test('DL 落库：insert 后 prune 只保留最近 5 条，最新快照 = generated_at/id 倒序第一条', async () => {
  const { q, close } = await openDb();
  try {
    for (let i = 1; i <= 7; i += 1) {
      await insertAlignSnapshot(q, { payload: { items: [{ key: `g${i}` }] }, counts: { groups: 1 }, signature: `sig${i}` });
    }
    const n = (await q('select count(*)::int as n from align_snapshots')).rows[0].n;
    assert.equal(n, ALIGN_SNAPSHOT_KEEP, 'prune 只保留最近 5 条');
    const latest = await loadLatestAlignSnapshot(q);
    assert.equal(latest.signature, 'sig7', '最新快照取到（id 倒序兜底同毫秒）');
    assert.equal(latest.payload.items[0].key, 'g7', 'payload jsonb 读回为对象');
  } finally {
    await close();
  }
});

test('DL 同事务更新：FOR UPDATE 行锁 + payload/counts/dirty/last_action_at 同事务落库', async () => {
  const { db, q, close } = await openDb();
  try {
    const groups = [
      { key: 'a', skuIds: [1, 2], best: { score: 0.97 } },
      { key: 'b', skuIds: [3], best: { score: 0.9 } },
    ];
    const counts = alignGroupCounts(groups, {}, {});
    await insertAlignSnapshot(q, { payload: { items: groups }, counts, signature: 's1' });
    await db.transaction(async (tx) => {
      const tq = (sql, p = []) => tx.query(sql, p);
      const snap = await loadLatestAlignSnapshotForUpdate(tq);
      assert.ok(snap, '行锁后能读到最新快照');
      await updateAlignSnapshotAfterAction(tq, snap, { removedGroups: [groups[0]] });
      // 事务内可见（未提交前本事务自己读得到）
      const inside = (await tq('select payload, counts, dirty from align_snapshots where id = $1', [snap.id])).rows[0];
      assert.equal(inside.payload.items.length, 1, '事务内 payload 已移除');
      assert.equal(inside.dirty, true, '事务内 dirty=true');
    });
    const latest = await loadLatestAlignSnapshot(q);
    assert.equal(latest.payload.items.length, 1, '提交后读请求看到新队列');
    assert.equal(latest.payload.items[0].key, 'b');
    assert.equal(latest.counts.groups, 1);
    assert.equal(latest.counts.skus, 1);
    assert.equal(latest.dirty, true, 'dirty 落库（后台将重算一致性）');
    assert.ok(latest.last_action_at, 'last_action_at 落库');
  } finally {
    await close();
  }
});

test('DL restore 标脏：markAlignSnapshotDirty 只置 dirty + last_action_at，不动队列', async () => {
  const { q, close } = await openDb();
  try {
    await insertAlignSnapshot(q, { payload: { items: [{ key: 'a' }] }, counts: { groups: 1 }, signature: 's1' });
    const snap = await loadLatestAlignSnapshot(q);
    await markAlignSnapshotDirty(q, snap);
    const latest = await loadLatestAlignSnapshot(q);
    assert.equal(latest.payload.items.length, 1, '队列不动（重算后该组才重新入队）');
    assert.equal(latest.dirty, true);
  } finally {
    await close();
  }
});

test('DL 生成决策：签名不变且未超 24h → 直接用库快照、不重算（反向自检：忽略签名必红）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'align-fresh-'));
  const skuFile = join(dir, 'skus.json');
  process.env.ALIGN_SKU_FILE = skuFile;
  try {
    writeFileSync(skuFile, '[]');
    const sig = await computeAlignSignature({ q: sigQ(), skuFile });
    const latestRow = { id: 1, signature: sig, generated_at: new Date().toISOString(), payload: { items: [{ key: 'x' }] }, counts: { groups: 1 } };
    const q = async (sql) => {
      if (/from games\b/.test(sql)) return { rows: [{ n: 10, m: '2026-11-19T10:00:00Z' }] };
      if (/from game_source_map/.test(sql)) return { rows: [{ n: 3, m: '2026-11-19T09:00:00Z' }] };
      if (/select \* from align_snapshots order by/.test(sql)) return { rows: [latestRow] };
      throw new Error(`意外 SQL: ${sql}`);
    };
    let computed = 0;
    const logs = [];
    const r = await ensureAlignSnapshot({
      q,
      compute: async () => {
        computed += 1;
        throw new Error('签名相同不该重算——若实现忽略签名直接重算，本间谍必被调用、本条变红（反向自检）');
      },
      logger: { info: (e) => logs.push(e) },
      maxAgeMs: alignSnapshotMaxAgeMs(),
    });
    assert.equal(r.fresh, true, '直接用库快照');
    assert.equal(computed, 0, '未触发重算');
    assert.ok(logs.includes('align.snapshot_fresh'), 'fresh 日志（规格 §8.3 可观测）');
  } finally {
    delete process.env.ALIGN_SKU_FILE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('DL 签名变化：重算并写新快照（payload=items、counts 统计口径、存「算后签名」）', async () => {
  const inserted = [];
  const latestRows = [];
  const q = async (sql, p = []) => {
    if (/from games\b/.test(sql)) return { rows: [{ n: 10, m: '2026-11-19T10:00:00Z' }] };
    if (/from game_source_map/.test(sql)) return { rows: [{ n: 3, m: '2026-11-19T09:00:00Z' }] };
    if (/select \* from align_snapshots order by/.test(sql)) return { rows: latestRows };
    if (/insert into align_snapshots/.test(sql)) {
      inserted.push({ payload: JSON.parse(p[0]), counts: JSON.parse(p[1]), signature: p[2] });
      return { rows: [{ id: inserted.length }] };
    }
    if (/delete from align_snapshots/.test(sql)) return { rows: [] };
    throw new Error(`意外 SQL: ${sql}`);
  };
  const align = await import('../src/align.js');
  let computed = 0;
  const logs = [];
  const r = await ensureAlignSnapshot({
    q,
    compute: async () => {
      computed += 1;
      return {
        align,
        groups: [{ key: 'g1', skuIds: [1, 2], best: null }],
        inherit: { inheritApplied: 0, ignoredGroups: 0 },
        contentWords: {},
        partial: false,
      };
    },
    logger: { info: (e) => logs.push(e) },
    maxAgeMs: alignSnapshotMaxAgeMs(),
  });
  assert.equal(computed, 1, '无快照/签名不符 → 重算');
  assert.equal(r.generated, true);
  assert.equal(inserted.length, 1, '写一条新快照');
  assert.deepEqual(inserted[0].payload.items.map((g) => g.key), ['g1'], 'payload.items = 队列全量组');
  assert.equal(inserted[0].counts.groups, 1, 'counts 统计口径落库');
  assert.ok(logs.includes('align.snapshot_generated'), 'generated 日志');
  assert.match(inserted[0].signature, /^[0-9a-f]{40}$/, 'sha1 签名');
});

test('DL 24h 强制重算兜底：超龄快照即使签名相同也重算；env 可缩短验证', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'align-age-'));
  const skuFile = join(dir, 'skus.json');
  process.env.ALIGN_SKU_FILE = skuFile;
  try {
    writeFileSync(skuFile, '[]');
    const sig = await computeAlignSignature({ q: sigQ(), skuFile });
    const old = new Date(Date.now() - 25 * 3600_000).toISOString();
    const latestRows = [{ id: 1, signature: sig, generated_at: old, payload: { items: [] }, counts: { groups: 0 } }];
    const q = async (sql, p = []) => {
      if (/from games\b/.test(sql)) return { rows: [{ n: 10, m: '2026-11-19T10:00:00Z' }] };
      if (/from game_source_map/.test(sql)) return { rows: [{ n: 3, m: '2026-11-19T09:00:00Z' }] };
      if (/select \* from align_snapshots order by/.test(sql)) return { rows: latestRows };
      if (/insert into align_snapshots/.test(sql)) return { rows: [{ id: 9 }] };
      if (/delete from align_snapshots/.test(sql)) return { rows: [] };
      throw new Error(`意外 SQL: ${sql}`);
    };
    const align = await import('../src/align.js');
    let computed = 0;
    await ensureAlignSnapshot({
      q,
      compute: async () => {
        computed += 1;
        return { align, groups: [], inherit: { inheritApplied: 0, ignoredGroups: 0 }, contentWords: {}, partial: false };
      },
      logger: {},
      maxAgeMs: alignSnapshotMaxAgeMs(),
    });
    assert.equal(computed, 1, '签名相同但超 24h → 强制重算（规格 §8.6）');
    assert.equal(alignSnapshotMaxAgeMs({ ALIGN_SNAPSHOT_MAX_AGE_HOURS: '1' }), 3600_000, 'env 缩短验证锚点');
    assert.equal(alignSnapshotMaxAgeMs({}), 24 * 3600_000, '默认 24h');
  } finally {
    delete process.env.ALIGN_SKU_FILE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('DL 生成失败可见：error 写进最新快照行 + snapshot_failed 日志 + rethrow（调度任务红条）', async () => {
  const { q, close } = await openDb();
  try {
    await insertAlignSnapshot(q, { payload: { items: [] }, counts: { groups: 0 }, signature: 's' });
    const qWithStub = async (sql, p = []) => {
      if (/from games\b/.test(sql)) return { rows: [{ n: 1, m: null }] };
      if (/from game_source_map/.test(sql)) return { rows: [{ n: 0, m: null }] };
      return q(sql, p); // 快照表读写走真库
    };
    const logs = [];
    await assert.rejects(
      ensureAlignSnapshot({
        q: qWithStub,
        compute: async () => {
          throw new Error('候选表读取失败');
        },
        logger: { info: () => {}, error: (e) => logs.push(e) },
        maxAgeMs: alignSnapshotMaxAgeMs(),
      }),
      /候选表读取失败/,
      '失败 rethrow——CLI runSyncTracked 记 sync_runs、任务健康条红标',
    );
    assert.ok(logs.includes('align.snapshot_failed'), '失败日志');
    const latest = await loadLatestAlignSnapshot(q);
    assert.equal(latest.error, '候选表读取失败', 'error 写进最新快照行（规格 §7.2）');
  } finally {
    await close();
  }
});

test('DL 首次生成失败（表空）：插一条空 payload 失败行——GET 返回失败态而非永远 202', async () => {
  const { q, close } = await openDb();
  try {
    const id = await markAlignSnapshotError(q, '数据库不可用');
    assert.ok(id > 0, '失败行插入');
    const latest = await loadLatestAlignSnapshot(q);
    assert.deepEqual(latest.payload, {}, '空 payload');
    assert.deepEqual(latest.counts, {}, '空 counts');
    assert.equal(latest.error, '数据库不可用', 'error 可见');
  } finally {
    await close();
  }
});
