// ER 批（docs/TODO.md「ER. B4/cli 拆分遗留缺陷修复（3 项）」）：cli 运维域三条拆分遗留缺陷的行为锁。
//
// ① backfill 候选查询按 q 函数签名传参——B4 #20 拆分后 ops.js 把 store 对象直接传给
//    listBackfillCandidates（签名是 q），第一批就 TypeError: q is not a function；
// ② 裸库（只跑过 migrate、从没跑 ensureEmailSchema/ensureSteamSchema）prune 不再 42P01；
// ③ #18 拆分遗留断引用：cmdBackfill 价格回退分支调用 syncPrices，import 必须存在。
//
// 测试不 spawn 子进程（受限环境下管道捕获不可靠）：直接把真实的 pglite store 注入
// createCliOps 的 withStore，命令走的仍是 CLI 同一份实现与同一批 SQL。
//
// 反向自检（跑过并恢复）：
//   ① 把 listBackfillCandidates 的 s.query 改回传 store → 测试 1 红（q is not a function）；
//   ② 删掉 cmdPrune 里两行 ensure → 测试 2 红（relation "email_codes" does not exist / 42P01）；
//   ③ 删掉 ops.js 的 `import { syncPrices }` → 测试 3 红（静态断言）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { createCliOps } from '../src/cli/ops.js';

const OPS_SRC = readFileSync(new URL('../src/cli/ops.js', import.meta.url), 'utf8');

// 与 src/cli.js 同口径的 flag 解析（--name value / --name 两种写法）。
function makeFlag(args) {
  return (name, fallback = null) => {
    const i = args.indexOf(`--${name}`);
    if (i === -1) return fallback;
    const v = args[i + 1];
    return v && !v.startsWith('--') ? v : true;
  };
}

function fakeLogger() {
  const events = [];
  const rec = (level) => (event, data) => events.push({ level, event, data });
  return {
    info: rec('info'),
    warn: rec('warn'),
    error: rec('error'),
    debug: () => {},
    timed: () => ({ done: () => {} }),
    events,
  };
}

// 注入真实 store：withStore 只透传、不关闭（由测试自己关），命令内部行为与 CLI 一致。
function makeOps(store, args) {
  const logger = fakeLogger();
  const ops = createCliOps({
    args,
    flag: makeFlag(args),
    logger,
    withStore: async (fn) => fn(store),
    syncNote: {},
    pad: (s) => String(s ?? ''),
    dbTarget: 'pglite:',
    runId: 'test-er',
  });
  return { ops, logger };
}

// 命令用 console.log 输出结果，测试里捕获断言（同时避免刷屏）。
async function capturing(fn) {
  const out = [];
  const orig = console.log;
  console.log = (...a) => out.push(a.map(String).join(' '));
  try {
    const result = await fn();
    return { result, out };
  } finally {
    console.log = orig;
  }
}

// 一个 pglite 内存库贯穿三个用例：只跑 migrate（=「裸库」定义），不跑任何 ensure*Schema。
// 用例按定义顺序串行（node:test 同文件默认串行）：backfill 不改数据，prune 只删过期行，互不干扰。
let store;
let tmpDir;
let savedProgressFile;

test.before(async () => {
  store = await openStore('pglite:', {});
  await db.migrate(store);
  tmpDir = mkdtempSync(join(tmpdir(), 'er-cli-ops-'));
  savedProgressFile = process.env.BACKFILL_PROGRESS_FILE;
  process.env.BACKFILL_PROGRESS_FILE = join(tmpDir, 'backfill-progress.json');
});

test.after(async () => {
  if (savedProgressFile === undefined) delete process.env.BACKFILL_PROGRESS_FILE;
  else process.env.BACKFILL_PROGRESS_FILE = savedProgressFile;
  rmSync(tmpDir, { recursive: true, force: true });
  await store?.close();
});

test('ER-① backfill 真实跑通：候选查询按 q 函数签名传参，不再 q is not a function', async () => {
  // 空库 = 没有候选：命令走到 listBackfillCandidates 后立即收尾，不触发任何 Steam 请求。
  const { ops } = makeOps(store, ['backfill', '--limit', '1', '--fallback', '0']);
  const { out } = await capturing(() => ops.commands.backfill());
  assert.ok(
    out.some((line) => line.includes('没有需要回填的游戏了')),
    `空库 backfill 应正常收尾（修复前第一批就 TypeError: q is not a function），实际输出：${out.join(' | ')}`,
  );
  assert.ok(
    out.some((line) => line.includes('完成：处理 0 款')),
    `收尾统计行必须在（证明跑完整条命令，不是异常中断），实际输出：${out.join(' | ')}`,
  );
  // 调用点契约（行为锁的补充，防止有人把 s.query 改回 store 而只靠 pg.js 兜底）。
  assert.match(OPS_SRC, /db\.countBackfillCandidates\(s\.query\)/, 'countBackfillCandidates 传 q 函数');
  assert.match(
    OPS_SRC,
    /db\.listBackfillCandidates\(s\.query, \{ limit: size \}\)/,
    'listBackfillCandidates 传 q 函数（v2.28.4 只修了 count 那一半）',
  );
});

test('ER-② 裸库 prune 不再 42P01：清理前幂等补建 email_codes / steam_account_logs', async () => {
  // 复现裸库：只跑过 migrate，没有 ensureEmailSchema / ensureSteamSchema。
  // 修复前 purgeOldRows 第一次 delete email_codes 就报 42P01（relation does not exist）。
  const probeBefore = await store.query("select to_regclass('public.email_codes') as e, to_regclass('public.steam_account_logs') as s");
  assert.deepEqual(
    { email: probeBefore.rows[0].e, steam: probeBefore.rows[0].s },
    { email: null, steam: null },
    '前置：测试库确实是裸库（两张表都不存在）',
  );

  const { ops, logger } = makeOps(store, ['prune']);
  const { out } = await capturing(() => ops.commands.prune());
  assert.ok(
    out.some((line) => line.includes('清理完成')),
    `裸库 prune 应完成清理（修复前 42P01 直接抛错），实际输出：${out.join(' | ')}`,
  );
  assert.ok(
    logger.events.some((e) => e.event === 'maintenance.cleanup'),
    'prune 完成日志 maintenance.cleanup 必须落（可观测性不变）',
  );

  // 幂等：第二次 prune 仍要成功（ensure 是 if not exists，不重复建/不报错）。
  const second = await capturing(() => ops.commands.prune());
  assert.ok(second.out.some((line) => line.includes('清理完成')), '重复 prune 幂等');
});

test('ER-③ 价格回退分支可运行：cmdBackfill 的 syncPrices import 不得再断（#18 拆分遗留）', async () => {
  // #18 把 adapters/steam import 随同步域移出后，cmdBackfill 的价格回退分支调用 syncPrices
  // 变成 ReferenceError；#20 拆分时补回了 import，这里锁住它不再被删。
  assert.match(
    OPS_SRC,
    /import \{ syncPrices \} from '\.\.\/adapters\/steam\.js';/,
    'ops.js 必须显式 import syncPrices（删掉即价格回退分支 ReferenceError）',
  );
  assert.match(
    OPS_SRC,
    /const got = await syncPrices\(\{ appids: missing,/,
    '价格回退分支真实调用点保留（GetItems 缺价 → appdetails 回退取价）',
  );
  // import 名字写错/文件不存在时 ESM 链接期直接失败，这里加载一次兜住。
  const mod = await import('../src/cli/ops.js');
  assert.equal(typeof mod.createCliOps, 'function', 'ops.js 可加载且导出 createCliOps');
});
