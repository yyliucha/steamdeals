// FP 批（docs/SYNC-HARDENING.md）专项测试：僵尸锁 / 429 冷却超时中断 / shape 预期缺失 /
// 403 独立退避与告警口径 / heavy 分槽与低峰窗口 / backup 流式分页与超时 / P2 提速默认值。
//
// 每条断言注释写清「守的是什么约束」，与既有测试风格一致。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isStaleSyncRun,
  syncStaleRunHours,
  maintWindow,
  inMaintWindow,
  inMaintWindowFor,
  is403Failure,
  shouldAlert403,
  DISCOVERY_JOBS,
  planTick,
  HEAVY_MAINT,
  heavyGroupFor,
  STEAM_HEAVY,
} from '../src/scheduler.js';
import {
  sync429MaxWaitMs,
  writeSteam429Until,
  writeSteam403Until,
  readSteam403Info,
  steam403BackoffMs,
  fetchText,
} from '../src/http.js';
import { offerExpectedMissing, ingestOffers, ingestAlertBreaches } from '../src/ingest.js';
import { backupTimeoutMs, createBackup, BACKUP_BATCH_ROWS } from '../src/backup.js';

const tmpDir = () => mkdtempSync(join(tmpdir(), 'fp-sync-harden-'));

const steamPlatform = { code: 'steam', name: 'Steam 国区', kind: 'official' };

function collectLogger() {
  const events = [];
  const logger = {
    trace: (e, f) => events.push(['trace', e, f]),
    debug: (e, f) => events.push(['debug', e, f]),
    info: (e, f) => events.push(['info', e, f]),
    warn: (e, f) => events.push(['warn', e, f]),
    error: (e, f) => events.push(['error', e, f]),
    fatal: (e, f) => events.push(['fatal', e, f]),
  };
  return { logger, events };
}

// ---------------------------------------------------------------- P0 僵尸锁

test('FP P0 僵尸锁：isStaleSyncRun——running 超 2h 判僵尸，刚启动/非法时间/非 running 不误杀', () => {
  const now = Date.now();
  const threeHoursAgo = new Date(now - 3 * 3600_000).toISOString();
  const oneHourAgo = new Date(now - 3600_000).toISOString();
  assert.equal(isStaleSyncRun({ status: 'running', started_at: threeHoursAgo }, { nowMs: now }), true, 'running 3 小时 = 僵尸');
  assert.equal(isStaleSyncRun({ status: 'running', started_at: oneHourAgo }, { nowMs: now }), false, 'running 1 小时不是僵尸');
  assert.equal(isStaleSyncRun({ status: 'ok', started_at: threeHoursAgo }, { nowMs: now }), false, '非 running 不判僵尸');
  assert.equal(isStaleSyncRun({ status: 'running', started_at: null }, { nowMs: now }), false, '无 started_at 不误杀');
  assert.equal(isStaleSyncRun({ status: 'running', started_at: 'not-a-date' }, { nowMs: now }), false, '非法时间不误杀（绝不阻塞调度）');
  assert.equal(isStaleSyncRun({ status: 'running', started_at: threeHoursAgo }, { nowMs: now, staleHours: 5 }), false, 'SYNC_STALE_RUN_HOURS=5 时 3 小时不算僵尸');
  assert.equal(isStaleSyncRun({ status: 'running', started_at: threeHoursAgo }, { nowMs: now, staleHours: 2 }), true);
  assert.equal(syncStaleRunHours({}), 2, '默认阈值 2 小时');
  assert.equal(syncStaleRunHours({ SYNC_STALE_RUN_HOURS: '5' }), 5, 'env 可覆盖');
});

test('FP P0 僵尸锁：interruptStaleSyncRuns 只标记超时 running 并带时长参数（mock DB）', async () => {
  const { interruptStaleSyncRuns } = await import('../src/store/pg.js');
  const calls = [];
  const q = async (sql, params) => {
    calls.push({ sql, params });
    return { rowCount: 3 };
  };
  const n = await interruptStaleSyncRuns(q, { staleHours: 2 });
  assert.equal(n, 3, '返回被打上 interrupted 的条数');
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /update sync_runs set status = 'interrupted', finished_at = now\(\)/);
  assert.match(calls[0].sql, /status = 'running' and started_at < now\(\) - \(\$1 \|\| ' hours'\)::interval/, '只标记超时 running，不碰正常记录');
  assert.deepEqual(calls[0].params, ['2'], '阈值作为参数传入 SQL（env SYNC_STALE_RUN_HOURS 生效）');
  // 非法阈值回落默认 2
  const calls2 = [];
  await interruptStaleSyncRuns(async (sql, params) => {
    calls2.push(params);
    return { rowCount: 0 };
  }, { staleHours: 0 });
  assert.deepEqual(calls2[0], ['2'], 'staleHours=0 回落默认 2');
});

// ---------------------------------------------------------------- P0 429 冷却超时中断

test('FP P0 429 冷却：sync429MaxWaitMs 默认 5 分钟，env 可覆盖，非法回落', () => {
  assert.equal(sync429MaxWaitMs({}), 5 * 60_000, '默认 5 分钟');
  assert.equal(sync429MaxWaitMs({ SYNC_429_MAX_WAIT_MS: '60000' }), 60_000);
  assert.equal(sync429MaxWaitMs({ SYNC_429_MAX_WAIT_MS: 'abc' }), 5 * 60_000, '非法值回落默认');
});

test('FP P0 429 冷却：剩余超 SYNC_429_MAX_WAIT_MS → COOLDOWN_ABORT（不请求不等待，调用方 exit 75）', async () => {
  const dir = tmpDir();
  const prevFile = process.env.STEAM_429_FILE;
  process.env.STEAM_429_FILE = join(dir, 's429.json');
  process.env.SYNC_429_MAX_WAIT_MS = '300000';
  try {
    writeSteam429Until(Date.now() + 10 * 60_000, { label: 'steam.appdetails' });
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return new Response('{"ok":true}', { status: 200 });
    };
    const started = Date.now();
    await assert.rejects(
      () => fetchText('https://store.steampowered.com/api/appdetails?appids=730', { fetchImpl, retries: 0 }),
      (err) => {
        assert.equal(err.code, 'COOLDOWN_ABORT', '带稳定 code 供 runSyncTracked 识别 interrupted + exit 75');
        assert.equal(err.status, 429);
        return true;
      },
    );
    assert.equal(calls, 0, '冷却超上限：不发起任何请求（不空转占槽）');
    assert.ok(Date.now() - started < 3000, '超上限立即抛错，不睡满冷却');
  } finally {
    process.env.STEAM_429_FILE = prevFile;
    delete process.env.SYNC_429_MAX_WAIT_MS;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FP P0 429 冷却：剩余 ≤ 上限 → 保持等待后继续请求', async () => {
  const dir = tmpDir();
  const prevFile = process.env.STEAM_429_FILE;
  process.env.STEAM_429_FILE = join(dir, 's429.json');
  process.env.SYNC_429_MAX_WAIT_MS = '5000';
  try {
    writeSteam429Until(Date.now() + 250, { label: 'steam.appdetails' });
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return new Response('{"ok":true}', { status: 200 });
    };
    const started = Date.now();
    const res = await fetchText('https://store.steampowered.com/api/appdetails?appids=730', { fetchImpl, retries: 0 });
    assert.equal(calls, 1, '短冷却等待后照常请求');
    assert.equal(res.status, 200);
    assert.ok(Date.now() - started >= 200, '确实等待了冷却剩余时间（约 250ms）');
  } finally {
    process.env.STEAM_429_FILE = prevFile;
    delete process.env.SYNC_429_MAX_WAIT_MS;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- P0 shape 预期缺失

test('FP P0 shape：offerExpectedMissing 只认免费/未发行/区域限制/显式声明', () => {
  assert.equal(offerExpectedMissing({ meta: { isFree: true } }), 'free');
  assert.equal(offerExpectedMissing({ meta: { comingSoon: true } }), 'coming_soon');
  assert.equal(offerExpectedMissing({ meta: { releaseStatus: 'coming_soon' } }), 'coming_soon');
  assert.equal(offerExpectedMissing({ meta: { regionLocked: true } }), 'region_locked');
  assert.equal(offerExpectedMissing({ expectedMissing: true }), 'declared');
  assert.equal(offerExpectedMissing({ meta: { noPrice: true } }), 'declared');
  assert.equal(offerExpectedMissing({ meta: {} }), null, '无标记 = 契约漂移');
  assert.equal(offerExpectedMissing({}), null);
});

test('FP P0 shape：预期缺失（免费）不进 shapeMismatch、不触发 shape_threshold', async () => {
  const { logger, events } = collectLogger();
  const offers = Array.from({ length: 6 }, (_, i) => ({
    platformCode: 'steam',
    platformProductId: `f${i}`,
    title: `免费游戏${i}`,
    region: 'cn',
    priceCents: undefined,
    meta: { isFree: true },
  }));
  const stats = await ingestOffers(
    { query: () => { throw new Error('预期缺失不应触库'); } },
    { platform: steamPlatform, offers, logger },
  );
  assert.equal(stats.expectedMissing, 6, '预期缺失单独统计');
  assert.equal(stats.shapeMismatch, 0, '预期缺失不计入契约漂移');
  assert.equal(stats.skipped, 6);
  assert.ok(!events.some(([, e]) => e === 'ingest.shape_threshold'), '6 条预期缺失不触发告警（旧口径会误报 6/6）');
  assert.ok(events.some(([, e]) => e === 'ingest.expected_missing'), '日志/统计分开：ingest.expected_missing');
  assert.ok(!events.some(([, e]) => e === 'adapter.steam.shape_mismatch'));
});

test('FP P0 shape：混合轮次——契约漂移单独判线，预期缺失不稀释也不放大', async () => {
  const { logger, events } = collectLogger();
  const offers = [
    ...Array.from({ length: 3 }, (_, i) => ({
      platformCode: 'steam', platformProductId: `f${i}`, title: `免费${i}`, region: 'cn',
      priceCents: undefined, meta: { isFree: true },
    })),
    ...Array.from({ length: 3 }, (_, i) => ({
      platformCode: 'steam', platformProductId: `b${i}`, title: `坏${i}`, region: 'cn',
      priceCents: undefined, meta: {},
    })),
  ];
  const stats = await ingestOffers(
    { query: () => { throw new Error('不应触库'); } },
    { platform: steamPlatform, offers, logger },
  );
  assert.equal(stats.expectedMissing, 3);
  assert.equal(stats.shapeMismatch, 3, '3 条真漂移');
  assert.ok(!events.some(([, e]) => e === 'ingest.shape_threshold'), '3/6 < max(5, ⌈6×50%⌉) 不告警（预期缺失不掺水）');
});

test('FP P0 shape：全漂移仍按原阈值告警（反向自检：新口径没把告警搞丢）', async () => {
  const { logger, events } = collectLogger();
  const offers = Array.from({ length: 6 }, (_, i) => ({
    platformCode: 'steam', platformProductId: `b${i}`, title: `坏${i}`, region: 'cn',
    priceCents: undefined, meta: {},
  }));
  const stats = await ingestOffers(
    { query: () => { throw new Error('不应触库'); } },
    { platform: steamPlatform, offers, logger },
  );
  assert.equal(stats.shapeMismatch, 6);
  assert.equal(stats.expectedMissing, 0);
  assert.ok(events.some(([, e]) => e === 'ingest.shape_threshold'), '6/6 契约漂移仍告警');
});

test('FP P0 shape：title/region 缺失即使带 isFree 也算契约漂移（只放宽 priceCents）', async () => {
  const { logger, events } = collectLogger();
  const offers = [
    { platformCode: 'steam', platformProductId: 'x1', title: '', region: 'cn', priceCents: 100, meta: { isFree: true } },
    { platformCode: 'steam', platformProductId: 'x2', title: 't', region: '', priceCents: 100, meta: { isFree: true } },
  ];
  const stats = await ingestOffers(
    { query: () => { throw new Error('不应触库'); } },
    { platform: steamPlatform, offers, logger },
  );
  assert.equal(stats.shapeMismatch, 2, 'title/region 缺失不是「无价游戏」的合法形态');
  assert.equal(stats.expectedMissing, 0);
  assert.equal(ingestAlertBreaches({ total: 2, shapeMismatch: 2 }).shape, false, '2 条低于 min=5 不告警（口径一致性自检）');
});

// ---------------------------------------------------------------- P0 403 处理

test('FP P0 403：指数退避纯函数——1m→2m→4m…上限 30m，非法值回落 1 分钟', () => {
  assert.equal(steam403BackoffMs(1), 60_000);
  assert.equal(steam403BackoffMs(2), 120_000);
  assert.equal(steam403BackoffMs(3), 240_000);
  assert.equal(steam403BackoffMs(6), 30 * 60_000, '2^5=32m 超过上限截到 30m');
  assert.equal(steam403BackoffMs(20), 30 * 60_000);
  assert.equal(steam403BackoffMs(0), 60_000, '非法 count 回落第 1 次');
});

test('FP P0 403：首次 403 落盘指数退避，冷却期内不再请求（降速），到期恢复', async () => {
  const dir = tmpDir();
  const prevFile = process.env.STEAM_403_FILE;
  process.env.STEAM_403_FILE = join(dir, 's403.json');
  try {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return new Response('denied', { status: 403 });
    };
    await assert.rejects(
      () => fetchText('https://store.steampowered.com/api/appdetails?appids=730', { fetchImpl, retries: 0 }),
      (err) => {
        assert.equal(err.status, 403);
        return true;
      },
    );
    assert.equal(calls, 1);
    const info = readSteam403Info();
    assert.ok(info, '403 冷却已落盘（跨子进程共享）');
    assert.equal(info.count, 1);

    // 冷却期内第二次调用：直接失败、不再打 Steam（降速）
    await assert.rejects(
      () => fetchText('https://store.steampowered.com/api/appdetails?appids=730', { fetchImpl, retries: 0 }),
      (err) => {
        assert.equal(err.code, 'FORBIDDEN_COOLDOWN');
        assert.equal(err.status, 403);
        return true;
      },
    );
    assert.equal(calls, 1, '冷却期内不发起请求');

    // 冷却到期后恢复请求（直到又 403，连续次数 +1）
    writeSteam403Until(Date.now() - 1, { count: 1, at: new Date().toISOString(), label: 'x' });
    await assert.rejects(
      () => fetchText('https://store.steampowered.com/api/appdetails?appids=730', { fetchImpl, retries: 0 }),
      (err) => {
        assert.equal(err.status, 403);
        return true;
      },
    );
    assert.equal(calls, 2, '冷却到期后恢复请求');
    assert.equal(readSteam403Info().count, 2, '连续次数递增 → 退避时长翻倍');
  } finally {
    process.env.STEAM_403_FILE = prevFile;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FP P0 403：告警口径——连续 ≥3 次才告警，discovery 类永不告警', () => {
  assert.equal(is403Failure('Steam 返回 HTTP 403（appid 730），已中止热度回填'), true);
  assert.equal(is403Failure('HTTP 429 提前收尾'), false);
  assert.equal(is403Failure('exit code 1'), false);
  assert.equal(shouldAlert403('backfill', 2), false, '连续 2 次 403 不告警（单次风控是常态）');
  assert.equal(shouldAlert403('backfill', 3), true, '连续 3 次才发失败邮件');
  assert.equal(shouldAlert403('heat', 99), true);
  assert.equal(shouldAlert403('steam-discovery', 99), false, 'discovery 类任务 403 只日志不告警');
  assert.equal(shouldAlert403('discover', 99), false);
  assert.ok(DISCOVERY_JOBS.has('steam-discovery') && DISCOVERY_JOBS.has('discover'));
});

// ---------------------------------------------------------------- P1 heavy 分槽与低峰窗口

test('FP P1 分槽：heavySteam 与 heavyMaint 互不影响（planTick heavyGroups）', () => {
  const steamJob = { name: 'steam-prices', group: 'steam-prices' };
  const maintJob = { name: 'backup', group: 'system' };
  const heavyJobs = new Set([...STEAM_HEAVY, ...HEAVY_MAINT]);
  const plan = planTick({
    due: [steamJob, maintJob],
    running: new Set(),
    lightMax: 3,
    heavyJobs,
    heavyGroups: { groupOf: heavyGroupFor, busy: new Set(['steam']) },
  });
  assert.deepEqual(plan.heavy.map((j) => j.name), ['backup'], 'steam 槽被占只挡 steam 任务，backup 照发（两槽互不影响）');

  const plan2 = planTick({
    due: [steamJob, maintJob],
    running: new Set(),
    lightMax: 3,
    heavyJobs,
    heavyGroups: { groupOf: heavyGroupFor, busy: new Set(['maint']) },
  });
  assert.deepEqual(plan2.heavy.map((j) => j.name), ['steam-prices'], 'maint 槽被占不挡价格任务（backup 卡死不再饿死价格/状态）');

  assert.ok(HEAVY_MAINT.has('backup') && HEAVY_MAINT.has('prune') && HEAVY_MAINT.has('logs'), 'maint 槽含 backup/prune/logs');
  assert.equal(heavyGroupFor('backup'), 'maint');
  assert.equal(heavyGroupFor('prune'), 'maint');
  assert.equal(heavyGroupFor('logs'), 'maint');
  assert.equal(heavyGroupFor('steam-prices'), 'steam');
  assert.equal(heavyGroupFor('steam-status'), 'steam');
});

test('FP P1 分槽：不传 heavyGroups 时退化为旧单槽行为（heavySlot 挡全部）', () => {
  const steamJob = { name: 'steam-prices', group: 'steam-prices' };
  const maintJob = { name: 'backup', group: 'system' };
  const heavyJobs = new Set([...STEAM_HEAVY, ...HEAVY_MAINT]);
  const plan = planTick({ due: [steamJob, maintJob], heavySlot: 'heat', running: new Set(), lightMax: 3, heavyJobs });
  assert.deepEqual(plan.heavy, [], '旧单槽：heavySlot 非空全部不排');
});

test('FP P1 低峰窗口：03:00–05:00（env 可配），backup/prune 受约束、logs 不受', () => {
  const win = maintWindow({});
  assert.deepEqual(win, { startHour: 3, endHour: 5, tz: 'Asia/Shanghai' }, '默认窗口 03:00–05:00 北京时间');
  const winCfg = maintWindow({ SYNC_MAINT_WINDOW_START_HOUR: '2', SYNC_MAINT_WINDOW_END_HOUR: '6', SYNC_MAINT_WINDOW_TZ: 'Asia/Shanghai' });
  assert.deepEqual({ startHour: winCfg.startHour, endHour: winCfg.endHour }, { startHour: 2, endHour: 6 }, 'env 可配窗口');

  // 北京时间 04:00 = 2026-11-24T20:00Z；10:00 = 2026-11-25T02:00Z
  const inWindow = Date.parse('2026-11-24T20:00:00Z');
  const outWindow = Date.parse('2026-11-25T02:00:00Z');
  assert.equal(inMaintWindow(inWindow, win), true, '04:00 在窗口内');
  assert.equal(inMaintWindow(outWindow, win), false, '10:00 在窗口外');
  assert.equal(inMaintWindowFor('backup', inWindow, {}), true);
  assert.equal(inMaintWindowFor('prune', inWindow, {}), true);
  assert.equal(inMaintWindowFor('backup', outWindow, {}), false, '窗口外 backup 不派发（任务保持 due，窗口一到即发）');
  assert.equal(inMaintWindowFor('prune', outWindow, {}), false);
  assert.equal(inMaintWindowFor('logs', outWindow, {}), true, 'logs 只占独立槽、不限时段');
  assert.equal(inMaintWindowFor('steam-prices', outWindow, {}), true, '价格任务不受窗口约束');
  // 跨零点窗口 22:00–02:00
  const cross = { startHour: 22, endHour: 2, tz: 'Asia/Shanghai' };
  assert.equal(inMaintWindow(Date.parse('2026-11-24T15:00:00Z'), cross), true, '北京时间 23:00 在 22–02 窗口内');
  assert.equal(inMaintWindow(Date.parse('2026-11-25T02:00:00Z'), cross), false, '北京时间 10:00 在窗口外');
});

// ---------------------------------------------------------------- P1 backup 流式/分页/超时

test('FP P1 backup：backupTimeoutMs 默认 30 分钟，env 可覆盖', () => {
  assert.equal(backupTimeoutMs({}), 30 * 60_000, '默认 30 分钟');
  assert.equal(backupTimeoutMs({ BACKUP_TIMEOUT_MIN: '45' }), 45 * 60_000);
  assert.equal(backupTimeoutMs({ BACKUP_TIMEOUT_MIN: 'abc' }), 30 * 60_000, '非法值回落默认');
});

test('FP P1 backup：流式写出 gzip 可解压、内容与行数据一致（mock q 单页）', async () => {
  const dir = tmpDir();
  try {
    const games = [
      { id: 1, name: 'A' },
      { id: 2, name: 'B' },
      { id: 3, name: 'C' },
    ];
    const q = async (sql) => {
      if (sql.startsWith('select * from games')) return { rows: games };
      return { rows: [], rowCount: 0 };
    };
    const result = await createBackup(q, { dir, timeoutMs: 60_000 });
    assert.ok(existsSync(result.file), '备份文件已写出');
    const json = JSON.parse(gunzipSync(readFileSync(result.file)).toString('utf8'));
    assert.deepEqual(json.dump.games, games, 'JSON 结构与行数据一致');
    assert.equal(result.rows, 3);
    assert.equal(result.tables, 8);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FP P1 backup：超过每批行数按 id 游标翻页，不漏行不重复', async () => {
  const dir = tmpDir();
  try {
    const all = Array.from({ length: BACKUP_BATCH_ROWS + 1 }, (_, i) => ({ id: i + 1, name: `g${i}` }));
    const gamesCalls = [];
    const q = async (sql, params) => {
      if (sql.startsWith('select * from games')) {
        gamesCalls.push({ sql, params });
        const hasCursor = sql.includes('where (id) > ($1)');
        const from = hasCursor ? Number(params[0]) : 0;
        return { rows: all.filter((r) => r.id > from).slice(0, BACKUP_BATCH_ROWS) };
      }
      return { rows: [], rowCount: 0 };
    };
    const result = await createBackup(q, { dir, timeoutMs: 60_000 });
    assert.equal(gamesCalls.length, 2, '2001 行分两页拉取');
    assert.match(gamesCalls[1].sql, /where \(id\) > \(\$1\)/, '第二页用主键游标续跑（不用 offset，避免大表 O(n²)）');
    assert.equal(gamesCalls[1].params[0], BACKUP_BATCH_ROWS, '游标 = 上一页最后一行的 id');
    const json = JSON.parse(gunzipSync(readFileSync(result.file)).toString('utf8'));
    assert.equal(json.dump.games.length, all.length, '翻页不漏行');
    assert.deepEqual(json.dump.games[all.length - 1], all[all.length - 1]);
    assert.equal(result.rows, all.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FP P1 backup：超过 BACKUP_TIMEOUT_MIN 自动中断抛 BACKUP_TIMEOUT，半成品文件清理', async () => {
  const dir = tmpDir();
  try {
    const q = async () => {
      await new Promise((r) => setTimeout(r, 120)); // 每批拖 120ms，8 张表必超 timeoutMs=50
      return { rows: [{ id: 1 }] };
    };
    await assert.rejects(
      () => createBackup(q, { dir, timeoutMs: 50 }),
      (err) => {
        assert.equal(err.code, 'BACKUP_TIMEOUT', '带稳定 code 供 runSyncTracked 识别 interrupted + exit 75');
        return true;
      },
    );
    const leftovers = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.gz')) : [];
    assert.equal(leftovers.length, 0, '超时中断不留半成品备份文件（不污染磁盘、不骗恢复流程）');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- P2 提速默认值

test('FP P2 提速：steam-status/backfill/rating-backfill 默认上限 20000，env 可配 3–5 万', async () => {
  const { jobsFromEnv } = await import('../src/scheduler.js');
  const byName = new Map(jobsFromEnv({}).map((j) => [j.name, j]));
  const limitOf = (name) => {
    const args = byName.get(name).args;
    return args[args.indexOf('--limit') + 1];
  };
  assert.equal(limitOf('steam-status'), '20000', 'steam-status 默认 2 万/天（20 万目录约 10 天一轮）');
  assert.equal(limitOf('backfill'), '20000');
  assert.equal(limitOf('rating-backfill'), '20000');

  const over = new Map(jobsFromEnv({ STEAM_STATUS_LIMIT: '40000', STEAM_BACKFILL_LIMIT: '35000', STEAM_RATING_BACKFILL_LIMIT: '30000' }).map((j) => [j.name, j]));
  const limitOver = (name) => {
    const args = over.get(name).args;
    return args[args.indexOf('--limit') + 1];
  };
  assert.equal(limitOver('steam-status'), '40000', 'env 可配 3–5 万');
  assert.equal(limitOver('backfill'), '35000');
  assert.equal(limitOver('rating-backfill'), '30000');
});

// ---------------------------------------------------------------- P2 429 队列与数据时效（pglite 真 SQL）

test('FP P2：sync_429_queue 入队/重复 attempts/清队/候选优先 + 数据时效统计（pglite 真 SQL）', async () => {
  const { openStore } = await import('../src/store/index.js');
  const db = await import('../src/store/pg.js');
  const store = await openStore('pglite:', {});
  const q = (sql, p) => store.query(sql, p);
  try {
    await db.migrate(store);
    // 入队：3 个 appid，重复入队 attempts+1
    await db.record429Appids(q, [730, 570, 440]);
    await db.record429Appids(q, [730]);
    const stats = await db.sync429QueueStats(q);
    assert.equal(stats.count, 3, '入队 3 条');
    assert.equal(stats.maxAttempts, 2, '重复入队 attempts+1（后台卡片可见重试次数）');
    assert.ok(stats.oldestAt, '带最早入队时间');
    // 清队：补跑成功清除
    await db.clear429Appids(q, [730]);
    assert.equal((await db.sync429QueueStats(q)).count, 2, '补跑成功清队（收敛）');

    // 候选优先：插 3 个候选游戏，队列里 570/440 应排在非队列 730 之前
    await q("insert into platforms (code, name, kind) values ('steam', 'Steam', 'official') on conflict do nothing");
    await q(
      "insert into games (steam_appid, name, created_at) values (730, 'CS', now() - interval '100 days'), (570, 'D2', now() - interval '99 days'), (440, 'TF2', now() - interval '98 days') on conflict do nothing",
    );
    const candidates = await db.listBackfillCandidates(q, { limit: 10 });
    const idx = (a) => candidates.indexOf(a);
    assert.ok(idx(570) >= 0 && idx(440) >= 0 && idx(730) >= 0, '三个都是候选（无报价/缺说明）');
    assert.ok(idx(570) < idx(730) && idx(440) < idx(730), '429 队列 appid 优先于普通候选（下一轮优先补 429）');
    // steam-status 候选同样优先队列
    const statusCands = await db.listSteamStatusCandidates(q, { limit: 10 });
    const sidx = (a) => statusCands.findIndex((c) => c.steamAppid === a);
    assert.ok(sidx(570) >= 0 && sidx(440) >= 0 && sidx(730) >= 0, 'steam_checked_at 为 null 都是状态候选');
    assert.ok(sidx(570) < sidx(730) && sidx(440) < sidx(730), '状态候选也优先队列');

    // 数据时效：四类口径都有数值，中文名分档正确（英文名 8 天未更新 → d7）
    const fresh = await db.dataFreshnessStats(q);
    assert.ok(fresh.prices.total >= 0 && fresh.status.total >= 0 && fresh.names.total >= 0 && fresh.images.total >= 0, '四类统计结构完整');
    assert.ok(Number.isFinite(fresh.names.d1) && Number.isFinite(fresh.names.d3) && Number.isFinite(fresh.names.d7));
    await q(
      "insert into games (steam_appid, name, created_at, updated_at) values (1, '中文游戏', now(), now()), (2, 'English Game', now() - interval '8 days', now() - interval '8 days') on conflict do nothing",
    );
    const fresh2 = await db.dataFreshnessStats(q);
    assert.equal(fresh2.names.d7, fresh.names.d7 + 1, '英文名游戏按 updated_at 8 天计入 d7 档');
    assert.equal(fresh2.names.total, fresh.names.total + 1, '中文名游戏不计入 names 统计');
  } finally {
    await store.close().catch(() => {});
  }
});
