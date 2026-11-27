// GA-2（docs/SYNC-PAGE-REDESIGN.md §3.7、§7-5~§7-8）：定时任务精简 26 → 19 的行为锁。
//
// 五组断言（对应规格验收 5/6/7/8）：
//   ① 定时任务集合**恰好 19 个**（不多不少）、prune 周→天（1440）、降频 4 项默认值 + env 仍可覆盖、
//      界面组 12 个（含 prune 的「系统维护」组）不变；
//   ② 4 处合并逻辑真生效：
//      a. rename → backfill：候选池并入「中文名待补」，写库顺带落中文名（name_en 保留英文）；
//      b. search-tokens-rebuild → readmodel：对账收尾顺带增量重建 token（--tokens 0 可关）；
//      c. images-backfill → images：images pull 每轮先补一批缺图（--backfill-limit 0 可关）；
//      d. explicit-backfill → rating-backfill：候选并入 strict 色情分级分支，同一轮写 explicit_flag；
//   ③ 转手动 3 个（catalog / logs / report）+ steam-claim 的手动清单与可运行性；
//   ④ CLI 兼容：被合并任务的命令与参数不删、手动任务端点存在、状态接口下发 manualJobs。
//
// 反向自检（改坏任一条对应断言必红）：
//   · jobsFromEnv 里把 rename 加回 → ① 红；prune 改回 10080 → ① 红；
//   · listBackfillCandidates 的 includeRename 默认改 true（或 cmdBackfill 不传）→ ②-a 红；
//   · 删掉 cmdReadModel 里的 rebuildSearchTokens → ②-b 红；
//   · 删掉 cmdImages pull 分支的 backfillMissingHeaders → ②-c 红；
//   · runRatingBackfillRound 的 strict 默认改 false → ②-d 红；
//   · 从 MANUAL_JOBS 删掉 report → ③ 红；删掉 /api/admin/sync/manual 路由 → ④ 红。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { createCliOps } from '../src/cli/ops.js';
import { normalizeOfficial } from '../src/adapters/steam-meta.js';
import {
  jobsFromEnv,
  jobGroupsFromEnv,
  manualJobsFromEnv,
  manualJobByName,
  JOB_GROUPS,
  STEAM_BUDGET_MODES,
} from '../src/scheduler.js';
import { hasChineseName } from '../src/backfill.js';
import { listRatingBackfillCandidates, runRatingBackfillRound } from '../src/steam-status.js';

const KEY = '0123456789ABCDEF0123456789ABCDEF';
const OPS_SRC = readFileSync(new URL('../src/cli/ops.js', import.meta.url), 'utf8');
const ADMIN_SYNC_SRC = readFileSync(new URL('../src/routes/admin-sync.js', import.meta.url), 'utf8');
const SCHEDULER_SRC = readFileSync(new URL('../src/scheduler.js', import.meta.url), 'utf8');

async function fresh() {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  return store;
}

// 与 src/cli.js 同口径的 flag 解析（--name value / --name 两种写法）。
function makeFlag(args) {
  return (name, fallback = null) => {
    const i = args.indexOf(`--${name}`);
    if (i === -1) return fallback;
    const v = args[i + 1];
    return v && !v.startsWith('--') ? v : true;
  };
}

function makeOps(store, args) {
  const events = [];
  const rec = (level) => (event, data) => events.push({ level, event, data });
  const logger = { info: rec('info'), warn: rec('warn'), error: rec('error'), debug: () => {}, timed: () => ({ done: () => {} }), events };
  const ops = createCliOps({
    args,
    flag: makeFlag(args),
    logger,
    withStore: async (fn) => fn(store),
    syncNote: {},
    pad: (s) => String(s ?? ''),
    dbTarget: 'pglite:',
    runId: 'test-ga-slim',
  });
  return { ops, events };
}

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

// ---------------------------------------------------------------- ① 任务集合与频率（§7-5 / §7-6）

test('GA-2 验收 5：jobsFromEnv 定时任务恰好 19 个（不多不少），prune 周→天，界面组 12 个', () => {
  const jobs = jobsFromEnv({ STEAM_API_KEY: KEY, ALERT_WEBHOOK_URL: 'https://example.com/hook' });
  const names = jobs.map((j) => j.name).sort();
  assert.deepEqual(
    names,
    [
      'alerts', 'align-snapshot', 'app-release-sync', 'backfill', 'discover', 'gog', 'heat', 'humble', 'images',
      'itad', 'proxy-probe', 'prune', 'rating-backfill', 'readmodel', 'sonkwo', 'steam-accounts', 'steam-discovery',
      'steam-prices', 'steam-status',
    ],
    '定时任务恰好这 19 个（多一个 / 少一个都算不达标）',
  );
  assert.equal(jobs.length, 19, '数量 19');
  // 合并 4 处 + 转手动 3 个 → 不再进调度器
  for (const gone of ['rename', 'search-tokens-rebuild', 'images-backfill', 'explicit-backfill', 'catalog', 'logs', 'report']) {
    assert.ok(!names.includes(gone), `${gone} 不在定时任务集合里`);
  }
  // prune 例外：保留定时但周（10080）→ 天（1440）
  assert.equal(jobs.find((j) => j.name === 'prune').intervalMin, 1440, 'prune 天级（1440）');
  // 界面组 12 个（含 prune 的「系统维护」组）不变——组只是展示层，不随任务精简消失
  assert.equal(JOB_GROUPS.length, 12, 'JOB_GROUPS 固定 12 组');
  const groups = jobGroupsFromEnv({ STEAM_API_KEY: KEY });
  assert.equal(groups.length, 12, 'jobGroupsFromEnv 仍返回 12 组');
  assert.ok(groups.every((g) => g.steps.length >= 1), '每组至少 1 个子步骤（没有空组）');
  assert.deepEqual(groups.find((g) => g.name === 'system').steps.map((s) => s.name), ['prune'], '系统维护组保留 prune');
  // 预算口径同步收窄：explicit-backfill 已合并，不再单独占预算
  assert.deepEqual(STEAM_BUDGET_MODES, ['steam-prices', 'heat', 'steam-status', 'backfill', 'rating-backfill'], '预算口径 5 个 mode');
});

test('GA-2 验收 6：降频 4 项默认值（proxy-probe 30 / app-release-sync 60 / align-snapshot 120 / sonkwo 180），env 仍可覆盖', () => {
  const jobs = jobsFromEnv({});
  const interval = (name) => jobs.find((j) => j.name === name).intervalMin;
  assert.equal(interval('proxy-probe'), 30, '代理探测 10 → 30 分钟');
  assert.equal(interval('app-release-sync'), 60, 'App 版本同步 15 → 60 分钟');
  assert.equal(interval('align-snapshot'), 120, '对齐快照 30 → 120 分钟');
  assert.equal(interval('sonkwo'), 180, '杉果同步 60 → 180 分钟');

  // env 仍可覆盖（只改默认，不锁死）
  const custom = jobsFromEnv({
    PROXY_PROBE_INTERVAL_MIN: '10',
    APP_RELEASE_SYNC_INTERVAL_MIN: '15',
    ALIGN_SNAPSHOT_INTERVAL_MIN: '30',
    SONKWO_INTERVAL_MIN: '60',
    PRUNE_INTERVAL_MIN: '10080',
  });
  const customInterval = (name) => custom.find((j) => j.name === name).intervalMin;
  assert.equal(customInterval('proxy-probe'), 10, 'PROXY_PROBE_INTERVAL_MIN 可覆盖');
  assert.equal(customInterval('app-release-sync'), 15, 'APP_RELEASE_SYNC_INTERVAL_MIN 可覆盖');
  assert.equal(customInterval('align-snapshot'), 30, 'ALIGN_SNAPSHOT_INTERVAL_MIN 可覆盖');
  assert.equal(customInterval('sonkwo'), 60, 'SONKWO_INTERVAL_MIN 可覆盖');
  assert.equal(customInterval('prune'), 10080, 'PRUNE_INTERVAL_MIN 可覆盖（回周级）');
});

// ---------------------------------------------------------------- ② 4 处合并逻辑（§7-7）

test('GA-2 验收 7-a：rename 合并进 backfill——候选池含「中文名待补」，写库顺带把中文名落到 name（英文进 name_en）', async () => {
  const store = await fresh();
  try {
    const q = (sql, p) => store.query(sql, p);
    // 数据齐全（有描述 + 有 Steam 报价 + 有封面）但名字是机器英文名 → 旧回填候选谓词不选它
    const gid = Number((await q("insert into games (steam_appid, name, name_en, description, header_image, steam_status) values (5001, 'Half-Life 2', null, 'desc', 'h.jpg', 'synced') returning id")).rows[0].id);
    await q("insert into offers (game_id, platform_code, product_type, region, price_cents, currency, in_stock) values ($1, 'steam', 'app', 'cn', 900, 'CNY', true)", [gid]);

    assert.deepEqual(await db.listBackfillCandidates(q, { limit: 10 }), [], '旧口径（includeRename=false）不选「只缺中文名」的行');
    assert.deepEqual(await db.listBackfillCandidates(q, { limit: 10, includeRename: true }), [5001], 'includeRename（backfill 命令默认）把「中文名待补」并入候选');

    // 同一次 GetItems(schinese) 响应写回：中文名进 name，机器英文名挪进 name_en（覆盖保护不变）
    const wrote = await db.upsertGameMeta(q, { steamAppid: 5001, nameZh: '半条命 2', nameEn: 'Half-Life 2', description: 'desc', headerImage: 'h.jpg' });
    const row = (await q('select name, name_en from games where steam_appid = 5001')).rows[0];
    assert.equal(row.name, '半条命 2', '中文名落到 name（rename 的语义并在 backfill 里完成）');
    assert.equal(row.name_en, 'Half-Life 2', '被替换的机器英文名挪进 name_en（不丢）');
    assert.equal(wrote.name, '半条命 2', 'upsertGameMeta 返回落库后的真实名字（cmdBackfill 用它统计中文名款数）');
    assert.equal(hasChineseName('半条命 2'), true, '中文名判定口径');
    assert.equal(hasChineseName('Half-Life 2'), false, '英文名不算');
    // 命令侧接线：候选查询带 includeRename，批次行尾部追加中文名计数（不破坏进度解析句式）
    assert.match(OPS_SRC, /db\.listBackfillCandidates\(s\.query, \{ limit: size, includeRename \}\)/, 'cmdBackfill 传 includeRename');
    assert.match(OPS_SRC, /中文名 \$\{renamed\}/, '批次行输出顺带带回的中文名款数');
    assert.match(OPS_SRC, /hasChineseName\(item\.nameZh\) && wrote\.name === item\.nameZh/, '只统计真正落成中文名的行（人工名不被误计）');
  } finally {
    await store.close();
  }
});

test('GA-2 验收 7-b：search-tokens-rebuild 合并进 readmodel——对账收尾顺带增量重建 token（--tokens 0 可关）', async () => {
  const store = await fresh();
  try {
    const q = (sql, p) => store.query(sql, p);
    // search_tokens 默认 '{}'（空数组）+ search_tokens_at 为空 = 从未生成（DS 批的增量候选口径）
    await q("insert into games (steam_appid, name) values (6001, '赛博朋克 2077'), (6002, '巫师 3')");
    const tokensOf = async (appid) => (await q('select search_tokens from games where steam_appid = $1', [appid])).rows[0].search_tokens;
    assert.deepEqual(await tokensOf(6001), [], '前置：token 为空数组');

    // 默认（调度器传 --tokens-limit 50000）：对账收尾顺带重建
    const { ops } = makeOps(store, ['readmodel', 'check', '--sample', '10', '--fix', '--tokens-limit', '100']);
    const { out } = await capturing(() => ops.commands.readmodel());
    assert.ok(out.some((l) => l.includes('对账完成')), '对账本身仍跑（输出保留）');
    assert.ok(out.some((l) => l.includes('顺带重建搜索 token')), '输出「顺带重建搜索 token」行（合并生效）');
    const t1 = await tokensOf(6001);
    assert.ok(Array.isArray(t1) && t1.length > 0, 'token 已写入（6001）');
    assert.ok((await tokensOf(6002)).length > 0, 'token 已写入（6002）');

    // --tokens 0：只对账、不重建（旧行为可回退）
    await q("update games set search_tokens = '{}'::text[], search_tokens_at = null where steam_appid = 6001");
    const { ops: ops2 } = makeOps(store, ['readmodel', 'check', '--sample', '10', '--fix', '--tokens', '0']);
    const { out: out2 } = await capturing(() => ops2.commands.readmodel());
    assert.ok(!out2.some((l) => l.includes('顺带重建搜索 token')), '--tokens 0 不打印重建行');
    assert.deepEqual(await tokensOf(6001), [], '--tokens 0 真的不重建');
    // 调度器接线：readmodel 的 args 带 --tokens-limit（默认 5 万行上限）
    const rm = jobsFromEnv({}).find((j) => j.name === 'readmodel');
    assert.deepEqual(rm.args, ['readmodel', 'check', '--sample', '200', '--fix', '--tokens-limit', '50000'], '调度参数含 tokens 上限');
    // 独立 CLI 命令不删（兼容手动跑）
    assert.match(OPS_SRC, /'search-tokens':\s*cmdSearchTokens/, 'CLI search-tokens 命令保留');
  } finally {
    await store.close();
  }
});

test('GA-2 验收 7-c：images-backfill 合并进 images——pull 每轮先补一批缺图（--backfill-limit 0 可关）', async () => {
  const store = await fresh();
  try {
    const q = (sql, p) => store.query(sql, p);
    // 有封面、且没有 daily_prices → 拉图与补缺图都没有候选，全程不出网
    await q("insert into games (steam_appid, name, header_image) values (7001, '有图游戏', 'h.jpg')");

    const { ops } = makeOps(store, ['images', 'pull', '--limit', '1', '--sleep', '0']);
    const { out } = await capturing(() => ops.commands.images());
    assert.ok(out.some((l) => l.includes('顺带补缺图')), 'images pull 先跑缺图回填（合并生效）');
    assert.ok(out.some((l) => l.includes('扫描 0 款')), '无缺图候选时扫描 0 款（不出网）');
    assert.ok(out.some((l) => l.includes('都有图了')), '原有拉图分支仍执行');

    const { ops: ops2 } = makeOps(store, ['images', 'pull', '--limit', '1', '--sleep', '0', '--backfill-limit', '0']);
    const { out: out2 } = await capturing(() => ops2.commands.images());
    assert.ok(!out2.some((l) => l.includes('顺带补缺图')), '--backfill-limit 0 关闭补缺图');
    assert.ok(out2.some((l) => l.includes('都有图了')), '关闭补缺图后拉图分支照旧');
    // CLI images backfill 子命令不删（手动补图入口保留）
    assert.match(OPS_SRC, /if \(sub === 'backfill'\)/, 'images backfill 子命令保留');
    // 合并的真接线：不是只打一行日志——真调用 backfillMissingHeaders，且 fetchMeta 接真实元数据抓取
    assert.match(
      OPS_SRC,
      /backfillMissingHeaders\(\(sql, p\) => store\.query\(sql, p\), \{\s*fetchMeta: \(appids\) => steamMeta\.fetchMetadata\(appids, \{ logger \}\),\s*limit: backfillLimit,\s*sleepMs: backfillSleep,/,
      'images pull 真调用缺图回填（注入真实 fetchMetadata + limit/sleep 参数）',
    );
    // 调度器接线：images 带补缺图参数
    const img = jobsFromEnv({}).find((j) => j.name === 'images');
    assert.ok(img.args.includes('--backfill-limit') && img.args.includes('--backfill-sleep'), 'images 调度参数含补缺图开关');
  } finally {
    await store.close();
  }
});

test('GA-2 验收 7-d：explicit-backfill 合并进 rating-backfill——候选并入 strict 色情分级分支，同一轮写 explicit_flag', async () => {
  const store = await fresh();
  try {
    const q = (sql, p) => store.query(sql, p);
    // 8001：分级已采过（required_age=18）但 adult 且未判 explicit → 只有 strict 分支会选它
    await q("insert into games (steam_appid, name, required_age, adult_flag, explicit_flag) values (8001, '成人未判色情', 18, true, false)");
    // 8002：分级没采过 → 两个分支都选（原始评级回填候选）
    await q("insert into games (steam_appid, name) values (8002, '未采分级')");

    assert.deepEqual(await listRatingBackfillCandidates(q, { limit: 20 }), [8002], 'strict=false（旧口径）只选 required_age 为空的行');
    assert.deepEqual(await listRatingBackfillCandidates(q, { limit: 20, strict: true }), [8001, 8002], 'strict=true 把 adult&&!explicit 的行并入候选');

    const fetchImpl = async (appids) => {
      const [appid] = appids;
      if (appid === 8001) {
        // 纯色情（descriptor 4）→ explicit=true
        return { backend: 'official', items: [normalizeOfficial(8001, { name: '黄油X', required_age: '18', content_descriptors: { ids: [4] }, ratings: {} })] };
      }
      return { backend: 'official', items: [normalizeOfficial(8002, { name: '全年龄', required_age: '0', content_descriptors: { ids: [] }, ratings: {} })] };
    };
    const events = [];
    const logger = { info: (e, f) => events.push([e, f]), warn: (e, f) => events.push([e, f]) };
    // 不传 strict → 默认 true（合并后的新常态）
    const result = await runRatingBackfillRound(q, { limit: 10, batch: 10, rateMs: 1000, fetchMetadataImpl: fetchImpl, logger });
    assert.equal(result.done, 2, '默认一轮同时处理两支候选');
    assert.equal(result.explicitWrote, 1, '本轮新判 explicit 1 款（原 explicit-backfill 的产出并入这里）');
    const row = (await q('select explicit_flag, adult_flag, steam_status, steam_checked_at from games where steam_appid = 8001')).rows[0];
    assert.equal(row.explicit_flag, true, 'explicit_flag 落库');
    assert.equal(row.adult_flag, true);
    assert.equal(row.steam_status, null, '仍只写分级（不写 steam_status）');
    assert.equal(row.steam_checked_at, null, '不推 steam_checked_at 游标');
    assert.ok(events.some(([e]) => e === 'steam.meta.backfill_batch'), '批次日志留档');

    // strict=false 可退回旧口径（CLI --no-explicit）
    const off = await runRatingBackfillRound(q, { limit: 10, batch: 10, rateMs: 1000, fetchMetadataImpl: fetchImpl, logger, strict: false });
    assert.equal(off.explicitWrote, 0, 'strict=false 不跑色情分级分支');
    // CLI 接线：默认 strict、--no-explicit 关闭；独立 explicit-backfill 命令保留
    assert.match(OPS_SRC, /const strict = flag\('no-explicit'\) == null/, 'CLI 默认 strict（--no-explicit 关闭）');
    assert.match(OPS_SRC, /'explicit-backfill':\s*cmdExplicitBackfill/, 'CLI explicit-backfill 命令保留（仍可手动跑）');
  } finally {
    await store.close();
  }
});

// ---------------------------------------------------------------- ③ 手动任务与 CLI 兼容（§7-8）

test('GA-2 验收 8：手动任务 4 个（catalog/logs/report/steam-claim）可「立即运行」，被合并任务的 CLI 命令未删', () => {
  const list = manualJobsFromEnv({ STEAM_API_KEY: KEY, ALERT_WEBHOOK_URL: 'https://example.com/hook', STEAM_CLAIM_USERNAME: 'admin', STEAM_CLAIM_STEAM_ID: '76561198000000000' });
  assert.deepEqual(list.map((j) => j.name), ['catalog', 'logs', 'report', 'steam-claim'], '手动任务组恰好 4 个（与 demo 一致）');
  assert.ok(list.every((j) => j.runnable), '配置齐全时四个都可运行');
  assert.deepEqual(list.find((j) => j.name === 'catalog').args, ['sync', 'catalog'], 'catalog 参数不变');
  assert.deepEqual(list.find((j) => j.name === 'logs').args, ['logs', 'prune', '--days', '7'], 'logs 参数不变');
  assert.deepEqual(list.find((j) => j.name === 'report').args, ['report', 'price', '--hours', '24', '--notify'], 'report 参数不变');
  assert.deepEqual(list.find((j) => j.name === 'steam-claim').args, ['steam-claim', 'admin', '76561198000000000'], 'steam-claim 参数来自 steamClaimArgs');
  assert.equal(manualJobByName('report', {}).runnable, false, '未配置通道时不可运行（按钮置灰而非静默失败）');

  // 手动任务端点：POST /api/admin/sync/manual（requireAdmin + 404/400/202/409 语义）
  assert.match(ADMIN_SYNC_SRC, /path === '\/api\/admin\/sync\/manual' && req\.method === 'POST'/, '手动任务「立即运行」路由存在');
  assert.match(ADMIN_SYNC_SRC, /manualJobByName\(body\.name, process\.env\)/, '端点按 manualJobByName 取任务（不写死）');
  assert.match(ADMIN_SYNC_SRC, /json\(res, 404, \{ error: '未知的手动任务' \}\)/, '未知任务 404');
  assert.match(ADMIN_SYNC_SRC, /json\(res, 400, \{ error: `手动任务不可运行/, '不可运行 400');
  // 状态接口下发 manualJobs（前端手动组按返回渲染，不写死）
  assert.match(ADMIN_SYNC_SRC, /manualJobs: manualJobsFromEnv\(process\.env\)/, '/api/admin/sync/status 带 manualJobs');

  // 被合并 / 转手动任务的 CLI 命令与参数不删
  for (const cmd of ['cmdBackfill', 'cmdRename', 'cmdRatingBackfill', 'cmdExplicitBackfill', 'cmdSearchTokens', 'cmdImages', 'cmdPrune', 'cmdLogs', 'cmdReadModel']) {
    assert.ok(OPS_SRC.includes(cmd), `${cmd} 仍存在（CLI 命令不删）`);
  }
  for (const key of ["rename: cmdRename", "'explicit-backfill': cmdExplicitBackfill", "'search-tokens': cmdSearchTokens", 'images: cmdImages', 'logs: cmdLogs']) {
    assert.ok(OPS_SRC.includes(key), `commands 注册表仍含 ${key}`);
  }
  // 日志清理仍可手动触发（logs prune 走 runSyncTracked，不因转手动丢痕迹）
  assert.match(readFileSync(new URL('../src/cli.js', import.meta.url), 'utf8'), /if \(command === 'logs' && args\[1\] === 'prune'\) return runSyncTracked\('logs', opsDomain\.commands\.logs\)/, 'logs prune 仍写 sync_runs');
});
