#!/usr/bin/env node
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createLogger, serializeError } from './log.js';
import { openStore } from './store/index.js';
import * as db from './store/pg.js';
import { channelsFromEnv, deliver, hasNotifier } from './notify.js';
// B4 #18（CO-5/B4-2 第十轮）：cli 同步类域已拆到 src/cli/sync.js（ARCHITECTURE §15 模式，
// 域模块不 import 本文件——宿主组装 ctx 传入；原 adapters/steam|sonkwo|itad|gog|humble、
// sonkwo-discover、sync-regions 的 baseCurrency、pool.runPool 等仅同步类命令使用的 import 随域移出）
// B4 #19（第十一轮）：cli 报表类域拆到 src/cli/report.js——buildSite/alerts 求值/renderPriceReport/
// compare 渲染等仅报表类命令使用的 import 随域移出；notify.js 因 cmdNotifyTest 留宿主保留。
// B4 #20（第十二轮）：cli 运维类域拆到 src/cli/ops.js——fs.spawn/httpRequest/randomBytes/readLogs/
// ping/startApiServer/ingest/backfill/steam-status/sync-regions/proxy/serve/http/backup 等仅运维类
// 命令使用的 import 随域移出；startStaticServer 从未有消费者，本轮一并清理。
import { bestMatchMulti } from './match.js';
import { extractAppId, fetchMetadata } from './adapters/steam-meta.js';
import { passwordPolicyError } from './password-policy.js';
import * as settings from './settings.js';
import { yuanAmount, formatDayUtc } from './format.js';
import { createAlignCompute } from './align-compute.js';
import { ensureAlignSnapshot, alignSnapshotMaxAgeMs } from './align-snapshot.js';
import { createCliSync } from './cli/sync.js';
import { createCliReport } from './cli/report.js';
import { createCliOps } from './cli/ops.js';
import * as cliSyncRepo from './store/cli-sync-repository.js';
import { installSigtermHandler } from './cli-interrupt.js';

const args = process.argv.slice(2);
const command = args[0] ?? 'help';
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : true;
};

const runId = `run-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
// 同步结束时写进 sync_runs.output 的一行摘要（控制台「同步记录」的结果列显示它）。
// B4 #18：cli 同步类域命令（src/cli/sync.js）也要写 → 按引用共享对象（§15.2 语义共享），
// runSyncTracked 读 .note；留原地的命令（search-tokens / align-snapshot）同样写 .note。
const syncNote = { note: '' };
const logger = createLogger({
  level: String(flag('level', process.env.LOG_LEVEL ?? 'info')),
  dir: String(flag('log-dir', process.env.LOG_DIR ?? 'logs')),
  bindings: { runId },
});

const explicitTarget = String(flag('db', process.env.DATABASE_URL ?? ''));
// 开箱即用：什么都没配就落到本地嵌入式 PG（数据在 data/pgdata 下），
// 不需要先装数据库、也不需要先建库。
const dbTarget = explicitTarget || 'pglite:./data/pgdata';
if (!explicitTarget) {
  logger.info('db.default_target', { target: dbTarget, hint: '未配置 DATABASE_URL，使用嵌入式 PG' });
}
// 容器启动时数据库可能还没就绪（compose 里 db 先起、app 随后），所以支持"等库"：
// DB_WAIT_SEC=60 表示最多等 60 秒，每 2 秒重连一次。
const dbWaitSec = Number(flag('wait-db', process.env.DB_WAIT_SEC ?? 0));
const yuan = (c) => (c == null ? '-' : `¥${yuanAmount(c)}`);
const width = (s) => {
  let w = 0;
  for (const ch of String(s)) w += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1;
  return w;
};
const pad = (s, n) => String(s ?? '') + ' '.repeat(Math.max(0, n - width(s)));
const readJson = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback);

/**
 * 按需迁移：老库可能缺新表（例如加了 watchlist 之后的存量库）。
 * 每次只做一次 `to_regclass` 检查，缺表才跑完整 DDL——不能让用户记住"先 init"。
 */
async function ensureSchema(store) {
  const probe = await store.query(`select to_regclass('public.watchlist') is not null as ok`);
  if (probe.rows[0]?.ok === true) return;
  logger.info('db.migrate_auto', { reason: 'schema_incomplete' });
  await db.migrate(store);
}

const SKIP_AUTO_MIGRATE = new Set(['ping', 'init', 'bootstrap']);

/**
 * 大多数 CLI 命令在真正干活前先水合一次设置：
 *   sync itad 这类命令在 withStore 之前就读 process.env.ITAD_API_KEY，
 *   不提前水合会拿到旧值。这里单独开一个短连接，读完即关。
 */
const NO_HYDRATE = new Set(['init', 'bootstrap', 'ping', 'help', 'logs', 'all', 'serve']);
async function hydrateCliSettings() {
  if (NO_HYDRATE.has(command)) return;
  try {
    const store = await openStore(dbTarget, { logger, timezone: process.env.TZ });
    try {
      // 老库可能还没建表；先补齐，避免设置水合时 SMTP 表不存在
      await ensureSchema(store);
      await settings.initializeSettings({ store, logger });
    } finally {
      await store.close();
    }
    // 显式 --level 优先于数据库里的日志级别
    const level = flag('level', null);
    if (level && typeof level === 'string') logger.setLevel(level);
  } catch (err) {
    logger.warn('settings.hydrate_failed', { message: String(err.message).slice(0, 200) });
  }
}

async function withStore(fn) {
  // ping 是健康检查，必须快速返回；等库重试只对真正要干活的命令生效
  const attempts = dbWaitSec > 0 && command !== 'ping' ? Math.max(1, Math.ceil(dbWaitSec / 2)) : 1;
  let lastErr;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      const store = await openStore(dbTarget, { logger, timezone: process.env.TZ });
      try {
        if (!SKIP_AUTO_MIGRATE.has(command)) await ensureSchema(store);
        return await fn(store);
      } finally {
        await store.close();
      }
    } catch (err) {
      lastErr = err;
      // 只有"连不上"才重试；SQL 报错重试没有意义
      const connectFailed = /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|connect|terminat/i.test(String(err.message));
      if (i === attempts || !connectFailed) break;
      logger.warn('db.connect_retry', {
        attempt: i,
        attempts,
        delayMs: 2000,
        message: String(err.message).slice(0, 160),
      });
      await sleep(2000);
    }
  }
  throw lastErr;
}

async function cmdInit() {
  await withStore(async (store) => {
    const timer = logger.timed('db.migrate', {});
    await db.migrate(store);
    timer.done();
    await settings.initializeSettings({ store, logger });
    const v = await db.serverVersion((sql, p) => store.query(sql, p));
    logger.info('db.server', { version: v.version?.slice(0, 60), timeZone: v.timeZone, alive: await ping(store) });
    console.log(`数据库就绪：${dbTarget.startsWith('pglite:') ? dbTarget : 'postgres（凭据已隐藏）'}`);
    console.log(`  服务端版本：${v.version}`);
    console.log(`  时区：${v.timeZone}`);
  });
}

/** 容器启动用：建表 + 首次自动导入游戏（已导入则跳过），可重复执行。 */
async function cmdBootstrap() {
  await withStore(async (store) => {
    const timer = logger.timed('db.migrate', {});
    await db.migrate(store);
    timer.done();
    // 建设置表；老部署（已有管理员）在这里自动标记初始化完成并导入 .env
    await settings.initializeSettings({ store, logger });

    const countRow = await store.query('select count(*)::int as c from games');
    const games = countRow.rows[0]?.c ?? 0;
    if (games > 0) {
      logger.info('bootstrap.done', { games, seeded: 0, reason: 'already_seeded' });
      return;
    }
    if (process.env.SEED_ON_START === '0') {
      logger.info('bootstrap.done', { games: 0, seeded: 0, reason: 'SEED_ON_START=0' });
      return;
    }
    const seeds = readJson('data/games.json', []);
    let created = 0;
    for (const g of seeds) {
      const r = await db.ensureGame((sql, p) => store.query(sql, p), {
        steamAppid: g.appid ?? null,
        name: g.name ?? null,
        nameEn: g.nameEn ?? null,
      });
      if (r.created) created += 1;
    }
    logger.info('bootstrap.done', { games: games + created, seeded: created, reason: 'first_run' });
    console.log(`首次启动：已导入 ${created} 个游戏`);
  });
}

/** 健康检查：只验证数据库可用，成功时静默退出 0。 */
async function cmdPing() {
  await withStore(async (store) => {
    const r = await store.query('select 1 as ok');
    if (r.rows[0]?.ok !== 1) throw new Error('数据库返回异常');
  });
  process.exitCode = 0;
}

async function cmdSeed() {
  const games = readJson('data/games.json', []);
  if (!games.length) throw new Error('data/games.json 为空');
  await withStore(async (store) => {
    const q = (sql, p) => store.query(sql, p);
    let created = 0;
    let withEn = 0;
    for (const g of games) {
      const r = await db.ensureGame(q, { steamAppid: g.appid ?? null, name: g.name ?? null, nameEn: g.nameEn ?? null });
      if (r.created) created += 1;
      if (g.nameEn) withEn += 1;
    }
    logger.info('seed.done', { total: games.length, created, withEn });
    console.log(`导入 ${games.length} 个游戏，新建 ${created} 个（带英文名 ${withEn} 个）`);
  });
}

async function cmdAddSku() {
  const ids = args.slice(1).filter((a) => /^\d+$/.test(a));
  if (!ids.length) throw new Error('用法: node src/cli.js add-sku <skuId> [skuId...] [--appid 123]');
  const appid = flag('appid', null);
  const file = 'data/skus.json';
  const list = readJson(file, []);
  const newIds = [];
  for (const skuId of ids) {
    if (list.some((s) => String(s.skuId) === String(skuId))) continue;
    // A3 批（docs/DESIGN-AUDIT.md A3）：skus.json 只存 SKU 清单（appid 不再落文件），映射只写库
    list.push({ skuId: Number(skuId), appid: null });
    newIds.push(skuId);
  }
  writeFileSync(file, `${JSON.stringify(list, null, 2)}\n`, 'utf8');
  if (appid != null && newIds.length) {
    await withStore(async (store) => {
      const q = (sql, p) => store.query(sql, p);
      const target = (await q('select id from games where steam_appid = $1', [Number(appid)])).rows[0];
      if (!target) throw new Error(`库里没有 appid ${appid}，先 add 或 seed`);
      for (const skuId of newIds) {
        await db.upsertSourceMap(q, {
          platformCode: 'sonkwo',
          productId: String(skuId),
          gameId: Number(target.id),
          method: 'manual',
          confidence: 1,
          decision: 'confirmed',
        });
      }
    });
  }
  logger.info('skus.updated', { added: newIds.length, total: list.length, appid: appid ?? null });
  console.log(`SKU 列表新增 ${newIds.length} 条（共 ${list.length} 条）${appid != null && newIds.length ? `，映射已写 game_source_map（appid ${appid}）` : ''}`);
}

async function cmdWatch() {
  const sub = args[1];
  const appid = Number(args[2]);

  if (sub === 'list' || sub === undefined) {
    const rows = await withStore((store) => db.listWatches((sql, p) => store.query(sql, p)));
    if (!rows.length) {
      console.log('关注列表为空。用法：node src/cli.js watch add <steamAppid> --target 99');
      return;
    }
    console.log(`${pad('游戏', 30)} ${pad('目标价', 10)} ${pad('上次提醒', 12)} ${pad('价格', 10)} 备注`);
    console.log('-'.repeat(88));
    for (const r of rows) {
      const t = r.target_cents == null ? '史低才提醒' : yuan(r.target_cents);
      const last = r.last_notified_at ? new Date(r.last_notified_at).toISOString().slice(5, 10) : '—';
      console.log(`${pad(r.name, 30)} ${pad(t, 10)} ${pad(last, 12)} ${pad(yuan(r.last_notified_cents), 10)} ${r.note ?? ''}`);
    }
    return;
  }

  if (!Number.isFinite(appid) || appid <= 0) throw new Error('用法: node src/cli.js watch <add|rm|list> <steamAppid> [--target 99]');

  if (sub === 'add') {
    const targetYuan = flag('target', null);
    const targetCents = flag('target-cents', null);
    const target = targetCents != null ? Number(targetCents) : targetYuan != null ? Math.round(Number(targetYuan) * 100) : null;
    if (target != null && (!Number.isFinite(target) || target <= 0)) throw new Error('--target 需要是正数（单位：元）');
    const note = flag('note', null);

    const result = await withStore(async (store) => {
      const q = (sql, p) => store.query(sql, p);
      const game = await q('select id, name from games where steam_appid = $1', [appid]);
      if (!game.rows.length) return { missing: true };
      const id = await db.upsertWatch(q, { gameId: Number(game.rows[0].id), targetCents: target, note: typeof note === 'string' ? note : null });
      logger.info('watch.saved', { appid, gameId: Number(game.rows[0].id), targetCents: target, watchId: id });
      return { name: game.rows[0].name, id };
    });
    if (result.missing) throw new Error(`库里没有 appid ${appid}，先 node src/cli.js add ${appid} 或 seed`);
    console.log(`已关注：${result.name ?? `appid ${appid}`}${target ? `（目标 ${yuan(target)}）` : '（跌至史低时提醒）'}`);
    return;
  }

  if (sub === 'rm') {
    const removed = await withStore(async (store) => {
      const q = (sql, p) => store.query(sql, p);
      const game = await q('select id from games where steam_appid = $1', [appid]);
      if (!game.rows.length) return 0;
      return db.deleteWatch(q, { gameId: Number(game.rows[0].id) });
    });
    logger.info('watch.removed', { appid, removed });
    console.log(removed ? `已取消关注 appid ${appid}` : `appid ${appid} 不在关注列表里`);
    return;
  }

  throw new Error('用法: node src/cli.js watch <add|rm|list> <steamAppid> [--target 99] [--note 备注]');
}

/** 部署自检：走一遍所有已配置的通道，确认能收到消息。 */
async function cmdNotifyTest() {
  const channels = channelsFromEnv();
  if (!channels.length) {
    console.log('没有配置任何提醒通道。可设置 ALERT_WEBHOOK_URL / WECOM_WEBHOOK_URL / SMTP_HOST+ALERT_EMAIL_TO。');
    process.exitCode = 1;
    return;
  }
  const text = [
    'SteamDeals 测试消息',
    `时间：${new Date().toISOString()}`,
    `通道：${channels.map((c) => c.name).join(', ')}`,
    '收到这条说明提醒链路已打通。',
  ].join('\n');
  const result = await deliver(channels, {
    text,
    payload: { type: 'steamdeals.test', text },
    subject: 'SteamDeals 测试邮件',
    logger,
  });
  for (const r of result.results) {
    console.log(`  ${r.ok ? '✔' : '✘'} ${r.channel}  ${r.ok ? `HTTP ${r.status ?? ''}` : (r.error ?? `errcode=${r.errcode}`)}`);
  }
  console.log(result.ok ? '至少一个通道投递成功。' : '全部通道投递失败，见日志 notify.* 事件。');
  if (!result.ok) process.exitCode = 1;
}

/** 把某个杉果 SKU 指向 Steam 游戏，并合并此前按名称建出的孤立游戏行。 */
// B4 #18：本函数跨域共用（cmdMatch 留宿主 + src/cli/sync.js 的 runSonkwoMatchStep 也调用）→ 按 §15.4
// 判据留宿主，作为宿主闭包经 ctx 传入域模块（§15.2 语义共享，防双写）；域内联 SQL 已抽到
// src/store/cli-sync-repository.js（gameBySteamAppid / sonkwoAliasGameId / gameAppidRowById）。
async function applySkuMapping(store, { skuId, appid }) {
  const q = (sql, p) => store.query(sql, p);
  const game = await cliSyncRepo.gameBySteamAppid(q, { appid });
  if (!game) throw new Error(`库里没有 appid ${appid}，先 add 或 seed`);
  const targetId = Number(game.id);

  const aliasGameId = await cliSyncRepo.sonkwoAliasGameId(q, { skuId });
  let merge = null;
  if (aliasGameId != null) {
    const fromId = Number(aliasGameId);
    if (fromId !== targetId) {
      const source = await cliSyncRepo.gameAppidRowById(q, { id: fromId });
      // 只合并「没有 appid 的孤立行」；有 appid 的行说明映射冲突，交给人工处理
      if (source && source.steam_appid == null) {
        merge = await db.mergeGames(q, { fromGameId: fromId, toGameId: targetId, logger });
      } else {
        logger.warn('match.skip_merge', { skuId, fromGameId: fromId, reason: 'source_has_appid' });
      }
    }
  }
  return { targetId, gameName: game.name, merge };
}

/** 名称匹配 + 人工确认：把杉果 SKU 对齐到已有 Steam 游戏。 */
async function cmdMatch() {
  const skuFile = 'data/skus.json';
  const entries = readJson(skuFile, []);
  const { bestMatchMulti, alignGroupKey } = await import('./match.js');
  const align = await import('./align.js');
  const games = await withStore(async (store) =>
    (await store.query('select id, steam_appid, name, name_en from games where steam_appid is not null order by id')).rows,
  );
  const orphanRows = await withStore((store) => align.loadOrphanSonkwoGames((sql, p) => store.query(sql, p)));

  // 人工确认模式：match --confirm <skuId> <appid>（A3 起只写 game_source_map，不再写 skus.json）
  const confirmIdx = args.indexOf('--confirm');
  if (confirmIdx > -1) {
    const skuId = Number(args[confirmIdx + 1]);
    const appid = Number(args[confirmIdx + 2]);
    if (!Number.isFinite(skuId) || !Number.isFinite(appid)) {
      throw new Error('用法: node src/cli.js match --confirm <skuId> <steamAppid>');
    }
    const entry = entries.find((e) => Number(e.skuId) === skuId);
    if (!entry) throw new Error(`skus.json 里没有 ${skuId}`);
    const result = await withStore((store) => applySkuMapping(store, { skuId, appid }));
    await withStore(async (store) => {
      const q = (sql, p) => store.query(sql, p);
      const target = (await q('select id from games where steam_appid = $1', [appid])).rows[0];
      if (target) await db.upsertSourceMap(q, { platformCode: 'sonkwo', productId: String(skuId), gameId: Number(target.id), method: 'manual', confidence: 1, decision: 'confirmed' });
    });
    console.log(`已确认：${entry.name ?? skuId} → ${games.find((g) => g.steam_appid === appid)?.name ?? appid}（映射已写 game_source_map）`);
    if (result.merge?.merged) {
      console.log(`合并了孤立游戏行：搬 ${result.merge.moved} 条报价、丢弃 ${result.merge.dropped} 条重复`);
    }
    return;
  }

  const minScore = Number(flag('min-score', 0.86));
  const autoScore = Number(flag('auto-score', 0.94));
  const apply = flag('apply', false) === true;
  const yes = flag('yes', false) === true;
  const limit = Number(flag('limit', 200));

  // CD 批：决定继承——confirmed 回填、ignored 自动跳过（A3 起不再写回 skus.json）
  const items = align.loadSonkwoItems(entries, orphanRows);
  const maps = await withStore((store) => db.sourceMapsByProducts((sql, p) => store.query(sql, p), 'sonkwo', items.map((i) => String(i.skuId))));
  const inherit = align.applyMapInheritance(items, maps);
  // DH 批（docs/ALIGN-INTEGRITY.md §2 A1）：skus.json 已带 appid、库无映射 → 自动补写 + 日志 align.map_backfilled
  await withStore((store) =>
    align.writeBackfilledMaps({ q: (sql, p) => store.query(sql, p), backfill: inherit.backfill, steamGames: games, logger }),
  );
  if (inherit.inheritApplied) logger.info('match.inherited', { applied: inherit.inheritApplied });
  const unresolved = inherit.items.slice(0, limit);

  if (!unresolved.length) {
    console.log('没有待匹配的 SKU（都已有 appid / 已被确认或忽略，或 skus.json 为空）。');
    return;
  }

  const groups = align.proposeAlignGroups(unresolved, games, { minScore, autoScore });
  console.log(`${pad('组', 30)} ${pad('SKU 数', 7)} ${pad('候选游戏', 22)} ${pad('appid', 8)} ${pad('分数', 6)} 方式/建议`);
  console.log('-'.repeat(100));

  const proposals = [];
  for (const group of groups) {
    const best = group.best;
    if (!best) {
      console.log(`${pad(group.name, 30)} ${pad(group.skuIds.length, 7)} ${pad('—', 22)} ${pad('—', 8)} ${pad('—', 6)} 无候选`);
      continue;
    }
    const label = best.auto ? '自动' : '待确认';
    const note = best.reasons?.length ? `（${best.reasons.join('、')}）` : '';
    proposals.push({ group, best, label });
    console.log(
      `${pad(group.name, 30)} ${pad(group.skuIds.length, 7)} ${pad(best.candidate.name ?? best.matchedField, 22)} ` +
        `${pad(best.candidate.steam_appid, 8)} ${pad(best.score.toFixed(2), 6)} ${best.method}/${label}${note}`,
    );
  }

  logger.info('match.proposals', {
    unresolved: unresolved.length,
    groups: groups.length,
    proposed: proposals.length,
    auto: proposals.filter((p) => p.best.auto).length,
  });

  if (!proposals.length) {
    console.log('\n没有达到阈值的候选。可降低 --min-score，或用 match --confirm <skuId> <appid> 手工指定。');
    return;
  }

  const auto = proposals.filter((p) => p.best.auto);

  if (!apply) {
    console.log(
      `\n以上为提案（未写入；按去重组展示，确认/忽略一次处理整组）。加 --apply --yes 自动应用「自动」级别的 ${auto.length} 组（--apply 必须带 --yes 二次确认）。`,
    );
    return;
  }

  // CE 加固（SONKWO-STEAM-MATCH.md §9）：--apply 必须 --yes 二次确认，并逐条打印对照
  if (!yes) {
    console.log(`\n将自动应用的 ${auto.length} 组对照（未写入，需 --yes 二次确认）：`);
    for (const p of auto) {
      console.log(`  ${p.group.name}（${p.group.skuIds.length} 个 SKU）→ ${p.best.candidate.name ?? p.best.matchedField}（appid ${p.best.candidate.steam_appid}）`);
    }
    throw new Error('match --apply 需要 --yes 二次确认：核对以上「杉果名 → 候选名/appid」对照后，加 --yes 重新执行');
  }

  let mapped = 0;
  let merged = 0;
  console.log(`\n开始应用（逐组对照，共 ${auto.length} 组）：`);
  for (const p of auto) {
    const appid = p.best.candidate.steam_appid;
    console.log(`  ${p.group.name}（${p.group.skuIds.length} 个 SKU）→ ${p.best.candidate.name ?? p.best.matchedField}（appid ${appid}）`);
    for (const skuId of p.group.skuIds) {
      await withStore((store) => applySkuMapping(store, { skuId, appid }));
      mapped += 1;
    }
    const res = await withStore((store) =>
      align.confirmGroup({
        store,
        q: (sql, p) => store.query(sql, p),
        group: p.group,
        appid,
        steamGames: games,
        method: p.best.method,
        confidence: p.best.score,
        mergeGame: ({ fromGameId, toGameId }) => db.mergeGames((sql, p) => store.query(sql, p), { fromGameId, toGameId, logger }),
      }),
    );
    merged += res.merged;
    if (res.errors.length) logger.warn('match.merge_errors', { group: p.group.key, errors: res.errors });
  }
  logger.info('match.applied', { mapped, merged });
  logger.info('match.summary', { unresolved: unresolved.length, groups: groups.length, auto: auto.length, mapped, merged });
  console.log(`\n已写入 ${mapped} 条映射到 game_source_map（A3 起 skus.json 只读，不再写回；自动阈值 ${autoScore}）。其余请用 --confirm 或后台对齐审核。`);
}

/** 导入 Steam 游戏元数据（名字/封面/发行日期/开发商），支持 appid、商店链接或文件。 */
async function cmdImport() {
  const kind = args[1];
  if (kind !== 'steam') {
    throw new Error('用法: node src/cli.js import steam [--appids 730,570] [--urls ...] [--file data/wishlist.txt] [--backend auto|official|steamcmd]');
  }

  const raw = [];
  const appidsFlag = flag('appids', null);
  if (typeof appidsFlag === 'string') raw.push(...appidsFlag.split(/[\s,]+/));
  const urlsFlag = flag('urls', null);
  if (typeof urlsFlag === 'string') raw.push(...urlsFlag.split(/[\s,]+/));
  const fileFlag = flag('file', null);
  if (typeof fileFlag === 'string') {
    if (!existsSync(fileFlag)) throw new Error(`文件不存在：${fileFlag}`);
    raw.push(...readFileSync(fileFlag, 'utf8').split(/\r?\n/));
  }

  const appids = [...new Set(raw.map(extractAppId).filter((n) => Number.isFinite(n) && n > 0))];
  if (!appids.length) {
    throw new Error('没有解析到 appid：用 --appids 730,570 / --urls <商店链接> / --file <清单> 指定');
  }

  console.log(`准备导入 ${appids.length} 个 appid：${appids.slice(0, 8).join(', ')}${appids.length > 8 ? ' …' : ''}`);
  const { backend, items } = await fetchMetadata(appids, { backend: String(flag('backend', 'auto')), logger });
  console.log(`元数据来源：${backend ?? '无'}，取到 ${items.length} 条`);

  const stats = await withStore(async (store) => {
    const q = (sql, p) => store.query(sql, p);
    let created = 0;
    let updated = 0;
    let named = 0;
    for (const item of items) {
      const result = await db.upsertGameMeta(q, item);
      if (result.created) created += 1;
      else updated += 1;
      if (item.nameZh) named += 1;
    }
    return { created, updated, named };
  });

  logger.info('import.done', { kind, backend, requested: appids.length, got: items.length, ...stats });
  console.log(
    `导入完成：新增 ${stats.created} 款、更新 ${stats.updated} 款（其中带中文名 ${stats.named} 款）`,
  );
  const missing = appids.length - items.length;
  if (missing > 0) console.log(`有 ${missing} 个 appid 没有取到元数据（可能已下架或不是游戏），详见日志 steam.meta.missing`);
  console.log('下一步：node src/cli.js list，或直接 node src/cli.js chart 看页面');
}

/** 标记已拥有（默认在列表里收起，采集与统计不受影响）。 */
async function cmdOwned() {
  const appid = Number(args[1]);
  const value = String(args[2] ?? '').toLowerCase();
  if (!Number.isFinite(appid) || !['on', 'off'].includes(value)) {
    throw new Error('用法: node src/cli.js owned <steamAppid> on|off');
  }
  const row = await withStore((store) => db.setOwned((sql, p) => store.query(sql, p), { steamAppid: appid, owned: value === 'on' }));
  if (!row) throw new Error(`库里没有 appid ${appid}`);
  logger.info('owned.set', { appid, owned: row.owned });
  console.log(`${row.name ?? appid} → ${row.owned ? '已拥有' : '未拥有'}（默认在列表里收起）`);
}

/** 用户管理：add / list。密码只在创建时显示一次。 */
async function cmdUser() {
  const sub = args[1];
  if (sub === 'add') {
    const username = String(args[2] ?? '').trim();
    const role = args.includes('--admin') ? 'admin' : 'user';
    const pwIdx = args.indexOf('--password');
    // 用 Web Crypto（Node 19+ 全局可用），不额外引入模块
    const password =
      pwIdx > -1 ? String(args[pwIdx + 1]) : Buffer.from(crypto.getRandomValues(new Uint8Array(9))).toString('base64url');
    if (!username) throw new Error('用法: node src/cli.js user add <用户名> [--admin] [--password xxx]');
    // AK-1（docs/AUTH-REDESIGN.md §4.1）：CLI 建号同样走密码策略（随机生成的 12 位自动符合）
    const policyError = passwordPolicy.passwordPolicyError(password, { username });
    if (policyError) throw new Error(policyError);
    const created = await withStore((store) =>
      db.createUser((sql, p) => store.query(sql, p), { username, password, role }),
    );
    logger.info('user.created', { username: created.username, role: created.role });
    console.log(`已创建 ${created.username}（${created.role}）`);
    if (pwIdx === -1) console.log(`初始密码：${password}（只显示这一次，请立即保存）`);
    return;
  }
  if (sub === 'list') {
    // listUsers 附带 sessions / steam_accounts 计数（AH 批），老库需先确保 Steam 表存在
    const users = await withStore(async (store) => {
      await (await import('./steam-login.js')).ensureSteamSchemaOnce((sql, p) => store.query(sql, p));
      return db.listUsers((sql, p) => store.query(sql, p));
    });
    if (!users.length) {
      console.log('还没有用户。用 node src/cli.js user add <用户名> --admin 创建管理员。');
      return;
    }
    for (const u of users) {
      const created = u.created_at ? formatDayUtc(new Date(u.created_at)) : '';
      console.log(`${String(u.username).padEnd(18)} ${String(u.role).padEnd(6)} ${created}`);
    }
    return;
  }
  throw new Error('用法: node src/cli.js user add <用户名> [--admin] [--password xxx] | user list');
}

/** 标记感兴趣 / 不感兴趣。不感兴趣只影响列表展示，采集与统计照常。 */
async function cmdInterest() {
  const appid = Number(args[1]);
  const value = String(args[2] ?? '').toLowerCase();
  if (!Number.isFinite(appid) || !['on', 'off'].includes(value)) {
    throw new Error('用法: node src/cli.js interest <steamAppid> on|off');
  }
  const interested = value === 'on';
  const row = await withStore(async (store) => db.setInterest((sql, p) => store.query(sql, p), { steamAppid: appid, interested }));
  if (!row) throw new Error(`库里没有 appid ${appid}`);
  logger.info('interest.set', { appid, interested });
  console.log(`${row.name ?? appid} → ${interested ? '感兴趣' : '不感兴趣'}（采集与金额统计不受影响）`);
}

// B4 #18（CO-5/B4-2 第十轮）：cli 同步类域装配——宿主把共享上下文打包成 ctx（§15.2 类比）：
// syncNote 按引用共享（域命令写摘要、runSyncTracked 读）；runSyncTracked / applySkuMapping 是宿主闭包
// （applySkuMapping 语义共享：cmdMatch 与 sync.js 的 runSonkwoMatchStep 共用同一实现，防双写）。
const syncDomain = createCliSync({ args, flag, logger, withStore, syncNote, runSyncTracked, readJson, applySkuMapping });
// B4 #19（CO-5/B4-2 第十一轮）：cli 报表类域装配——yuan/pad 是跨域显示工具
// （cmdWatch/cmdMatch/cmdDiagnose 也用）留宿主经 ctx 传入；sparkline 仅 history 用已随域移出。
const reportDomain = createCliReport({ args, flag, logger, withStore, yuan, pad });
// B4 #20（CO-5/B4-2 第十二轮）：cli 运维类域装配——pad 跨域显示工具（cmdWatch/cmdMatch 也用）
// 留宿主经 ctx 传入；dbTarget/runId 是宿主运行常量；syncNote 按引用共享（search-tokens 写摘要）。
const opsDomain = createCliOps({ args, flag, logger, withStore, syncNote, pad, dbTarget, runId });

const commands = {
  init: cmdInit,
  bootstrap: cmdBootstrap,
  ping: cmdPing,
  seed: cmdSeed,
  'add-sku': cmdAddSku,
  list: reportDomain.commands.list,
  chart: reportDomain.commands.chart,
  watch: cmdWatch,
  alerts: reportDomain.commands.alerts,
  discover: syncDomain.trackedCommands.discover,
  match: cmdMatch,
  'app-sync': syncDomain.trackedCommands['app-sync'],
  'steam-discovery': syncDomain.trackedCommands['steam-discovery'],
  compare: reportDomain.commands.compare,
  import: cmdImport,
  serve: opsDomain.commands.serve,
  all: opsDomain.commands.all,
  interest: cmdInterest,
  user: cmdUser,
  backup: opsDomain.commands.backup,
  owned: cmdOwned,
  'notify-test': cmdNotifyTest,
  history: reportDomain.commands.history,
  stats: reportDomain.commands.stats,
  logs: opsDomain.commands.logs,
  diagnose: opsDomain.commands.diagnose,
  backfill: opsDomain.commands.backfill,
  rename: opsDomain.commands.rename,
  'rating-backfill': opsDomain.commands['rating-backfill'],
  'explicit-backfill': opsDomain.commands['explicit-backfill'],
  'search-tokens': opsDomain.commands['search-tokens'],
  heat: opsDomain.commands.heat,
  'steam-status': syncDomain.trackedCommands['steam-status'],
  prune: opsDomain.commands.prune,
  'proxy-check': opsDomain.commands['proxy-check'],
  probe: opsDomain.commands.probe,
  images: opsDomain.commands.images,
  readmodel: opsDomain.commands.readmodel,
  report: reportDomain.commands.report,
  'steam-accounts': syncDomain.trackedCommands['steam-accounts'],
  'steam-claim': syncDomain.steamClaim,
};
/** 本次同步的任务号（控制台触发时由 env 传入，这时不重复建记录）。 */
function syncRunEnvId() {
  const id = Number(process.env.SYNC_RUN_ID);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** 建一条同步记录（定时任务/命令行手动跑都会留痕，控制台能看到）。 */
async function beginSyncRunRecord(mode) {
  const existing = syncRunEnvId();
  if (existing) return { id: existing, own: false };
  try {
    const id = await withStore(async (store) => {
      const q = (sql, p) => store.query(sql, p);
      const run = await db.insertSyncRun(q, { mode, args: args.join(' ') });
      return run.id;
    });
    return { id, own: true };
  } catch (err) {
    logger.warn('sync.run_begin_failed', { mode, message: String(err.message).slice(0, 160) });
    return { id: null, own: false };
  }
}

async function finishSyncRunRecord(run, status, note = '') {
  if (!run?.own || !run.id) return; // 控制台触发的任务由 web 进程负责收尾
  try {
    await withStore(async (store) => {
      const q = (sql, p) => store.query(sql, p);
      await db.finishSyncRun(q, run.id, { status, output: note ? String(note).slice(0, 2000) : null });
    });
  } catch (err) {
    logger.warn('sync.run_finish_failed', { runId: run.id, message: String(err.message).slice(0, 160) });
  }
}

/** 采集健康度（fetch_runs）：每个源的同步都留一行，`stats` 命令与排障能直接看。 */
async function beginFetchRunRecord(platformCode) {
  try {
    return await withStore(async (store) => db.startFetchRun((sql, p) => store.query(sql, p), platformCode));
  } catch (err) {
    logger.warn('fetch_run.begin_failed', { platformCode, message: String(err.message).slice(0, 160) });
    return null;
  }
}

async function finishFetchRunRecord(id, { status, note = '', stats = null }) {
  if (!id) return;
  try {
    await withStore(async (store) =>
      db.finishFetchRun((sql, p) => store.query(sql, p), id, {
        status,
        note: note ? String(note).slice(0, 500) : null,
        requests: stats?.requests ?? 0,
        total: stats?.total ?? 0,
        ok: stats?.ok ?? 0,
        skipped: stats?.skipped ?? 0,
        failed: stats?.failed ?? 0,
      }),
    );
  } catch (err) {
    logger.warn('fetch_run.finish_failed', { id, message: String(err.message).slice(0, 160) });
  }
}

/**
 * 同步命令的"记录"包装：sync_runs（任务级）+ fetch_runs（采集健康度）各留一条。
 * 注意 sync steam 自己已经写 fetch_runs，传 { fetchRun: false } 避免重复。
 */
// DL 批（docs/ALIGN-SNAPSHOT.md §5）：对齐审核快照后台生成（调度任务 align-snapshot）——
// 每轮算数据签名：与最新快照相同且未超 24h 直接用库快照；变化/超龄才重算写库并 prune；
// 失败写快照 error 字段 + sync_runs 失败原因（CO-1/A5 任务健康条红标可见）。
async function cmdAlignSnapshot() {
  await withStore(async (store) => {
    const q = (sql, p) => store.query(sql, p);
    const { computeAlignGroups } = createAlignCompute({ q, db, logger });
    const r = await ensureAlignSnapshot({
      q,
      compute: computeAlignGroups,
      logger,
      maxAgeMs: alignSnapshotMaxAgeMs(process.env),
    });
    syncNote.note = r.fresh ? '签名未变化，使用库快照' : '已生成新快照';
    console.log(syncNote.note);
  });
}

/**
 * EU-1（docs/SCHEDULER-RESTART-RESILIENCE.md）：当前在跑的同步记录（SIGTERM 收尾用）。
 * 服务停机时父进程先 SIGTERM 子进程——这里把 sync_runs 记为 interrupted（含已完成进度）
 * 再以 143 退出，父调度器按「被重启中断」收尾（不告警、不熔断、下轮断点续跑）。
 */
let activeSyncRun = null;

async function runSyncTracked(mode, fn, { fetchRun = true } = {}) {
  const run = await beginSyncRunRecord(mode);
  activeSyncRun = run;
  const fetchRunId = fetchRun ? await beginFetchRunRecord(mode) : null;
  try {
    await fn();
    await finishSyncRunRecord(run, 'ok', syncNote.note || null);
    await finishFetchRunRecord(fetchRunId, { status: 'ok', note: syncNote.note });
  } catch (err) {
    // FP 批 P0/P1（docs/SYNC-HARDENING.md §2/§4）：软中断类错误——429 冷却超时（COOLDOWN_ABORT）
    // 与备份超时（BACKUP_TIMEOUT）不记 failed：sync_runs 记 interrupted、exit 75（调度器不告警不熔断、
    // 1 小时后自动重排、不占 heavy slot）。
    const softAbort = err?.code === 'COOLDOWN_ABORT' || err?.code === 'BACKUP_TIMEOUT';
    await finishSyncRunRecord(run, softAbort ? 'interrupted' : 'failed', String(err.message).slice(0, 500));
    await finishFetchRunRecord(fetchRunId, { status: softAbort ? 'interrupted' : 'failed', note: String(err.message).slice(0, 300) });
    if (softAbort) {
      process.exitCode = 75;
      logger.warn('process.soft_abort', { mode, code: err.code, message: String(err.message).slice(0, 200) });
      return;
    }
    throw err;
  } finally {
    activeSyncRun = null;
  }
}

async function main() {
  // 先把库里的业务设置水合到 process.env（sync itad 等命令在 withStore 之前就会读 Key）
  if (command === 'sync' || (commands[command] && !NO_HYDRATE.has(command))) {
    await hydrateCliSettings();
  }
  // B4 #18：sync 全家族分发在 src/cli/sync.js（契约零变化：目标/参数/输出/退出码不变）
  if (command === 'sync') {
    return syncDomain.dispatchSync();
  }
  // AC-1（docs/SYNC-FAILURE-MODES.md AC10/AC3）：所有数据任务统一写 sync_runs + fetch_runs，
  // 后台「同步记录」可见每轮结果（此前只有 sync 系 / steam-accounts / steam-status 有）
  // B4 #18：同步类条目（steam-accounts/steam-status/discover/app-sync/steam-discovery）来自域模块
  // trackedCommands——注册表语义保持（仍在 TRACKED_COMMANDS 中，仍写 sync_runs + fetch_runs）。
  // B4 #19：alerts/report 同样随报表域 trackedCommands 展开（语义保持）。
  // B4 #20：heat/rename/rating-backfill/search-tokens/backfill/images/backup/prune/readmodel
  // 随运维域 trackedCommands 展开（语义保持）。
  const TRACKED_COMMANDS = {
    ...syncDomain.trackedCommands,
    ...reportDomain.trackedCommands,
    ...opsDomain.trackedCommands,
    // DL 批：对齐审核快照后台生成（失败写 sync_runs → 任务健康条红标）
    'align-snapshot': cmdAlignSnapshot,
  };
  if (TRACKED_COMMANDS[command]) {
    if (command === 'images' && args[1] !== 'pull') return commands.images();
    return runSyncTracked(command, TRACKED_COMMANDS[command]);
  }
  if (command === 'steam-claim') return syncDomain.steamClaim();
  // 日志清理（调度器 logs prune）同样留痕；人工查日志不写
  if (command === 'logs' && args[1] === 'prune') return runSyncTracked('logs', opsDomain.commands.logs);
  const fn = commands[command];
  if (!fn) {
    console.log(`用法: node src/cli.js <命令>

  init                 建表 + 平台字典（幂等）
  bootstrap            建表 + 首次自动导入游戏（容器启动用，幂等）
  ping                 健康检查：数据库可用则静默退出 0
  seed                 从 data/games.json 导入游戏
  add-sku <id...>      往 data/skus.json 加杉果 SKU（可 --appid 关联 Steam）
  sync steam           拉 Steam 国区价格（需能访问 store.steampowered.com）
  sync steam-prices    刷新已有 Steam 报价（调度器默认每日执行）
  sync steamall        补元数据/说明/价格 + 封面图（--limit 200 --sleep 2 --concurrency 4 --images 0 可关）
  sync sonkwo          按 SKU 抓杉果价格
  sync itad            走 ITAD 官方 API（需 ITAD_API_KEY）
  sync gog             按英文名查 GOG 商店（catalog 接口，只接受精确标题）
  sync humble          按英文名探测 Humble 商品页（JSON-LD，命中率取决于 slug）
  list                 主榜：各游戏官方渠道最低价
  chart                生成静态价格页（曲线图）到 out/，用浏览器直接打开
  watch add|rm|list    关注列表：watch add 1091500 --target 99
  discover sonkwo      自动发现杉果 SKU（从前沿向后探测，连续空壳即停）
  match                把杉果 SKU 对齐到 Steam 游戏（--apply --yes 二次确认自动应用、--confirm 手工确认）
  compare <appid>      多区服对比（--region 只看某区、--json 机器可读）
  import steam         导入 Steam 游戏信息（--appids / --urls / --file，双后端自动回落）
  owned <appid> on|off      标记已拥有（⚠️ 全局标记已废弃，前台按绑定 Steam 账号推导）
  interest <appid> on|off   标记感兴趣 / 不感兴趣
  serve                内置静态页服务：直接 IP:端口 访问页面（--port 8090 --dir out）
  alerts               检查关注列表是否到价（--mark 记录、--json 输出、--webhook 投递）
  notify-test          给所有已配置的提醒通道发一条测试消息（部署自检）
  history <appid>      价格轨迹（--days 90）
  stats                数据量 + 采集健康度
  report price         价格涨跌报表（--hours 24 --limit 10 --notify 推送到提醒通道 --csv）
  logs                 查日志（--level error --event http --since 60 --limit 50）
  diagnose             环境/数据库/网络自检，报告落盘
  proxy-check          代理专项排查：TCP → CONNECT → 经代理访问 Steam
  backfill             批量回填全量游戏的元数据/价格（GetItems，一次最多 100 个 appid）
                       --limit 200000 --batch 100 --sleep 3000 --fallback 10（回退数设 0 关闭单条回退）
  rename               存量修复：把目录导入留下的英文名换成中文名（GetItems schinese）
                       --limit 200000 --batch 100 --sleep 1500 --fallback 10（无简中的行保持英文）
  rating-backfill      内容分级回填：逐 appid 用内容区（sync.contentRegion，默认 us）重采 content_descriptors/required_age/age_ratings
                       （EF 批 §9：国区商店隐藏成人内容，cc=cn 采不到 → adult_flag 全库仅约 20 个）
                       --limit 200000 --batch 30 --rate 1500（限速 ≥1s；429 收轮 exit 75；断点续跑）
  explicit-backfill    色情游戏（严格分级）存量回填：候选 = adult_flag=true 且 explicit_flag=false 的成人游戏
                       （FT 批 docs/EXPLICIT-RATING.md §2.2：存量约 4759 个，重采判定 descriptor 4/ESRB AO）
                       --limit 5000 --batch 30 --rate 1500（限速 ≥1s；429 收轮 exit 75；1 天冷却断点续跑）
  search-tokens        派生搜索 token 重建：增量（token 空/未生成/名字已变更，--limit 50000 每轮）
                       --full 全量重建（19.8 万行预算内完成；纯本地计算，无 Steam 请求）
  heat                 热度回填：评测数 + 发行日期（逐 appid 请求，约 1.7s/款）
                       --limit 200000 --sleep 1700（按 heat_at 为 null 自动续跑；全量约 90 小时，可分多周跑）
  steam-status         Steam 同步状态判定 + 内容分级（逐 appid 全量 appdetails，内容区失败补 cc=hk）
                       --limit 200000 --batch 30 --rate 1500（steam_checked_at 作续跑游标；免费已由迁移置位）
  prune                定期清理：访问记录/采集与任务记录/验证码/Steam 账号日志
                       --visitor-days 180 --run-days 90 --email-days 7 --steam-days 180
  align-snapshot       对齐审核快照后台生成：签名未变化直接用库快照，变化/超龄才重算（调度器默认每 30 分钟）
  readmodel            首页列表读模型对账/重建：check [--sample 200] [--fix]、rebuild [--region cn]
  steam-accounts       同步所有已绑定 Steam 账号的游戏库与愿望单（差集删除 + 自动提醒）
                       --sleep 1000（账号间间隔，≥1s；调度器默认每日执行）
  steam-claim <用户名> <SteamID>
                       认领未归属的 Steam 账号（迁移用；幂等，已归属他人时报错）

通用参数：--db <target> --level <trace|debug|info|warn|error> --log-dir <dir>
环境变量：DATABASE_URL / ITAD_API_KEY / LOG_LEVEL / LOG_DIR

数据库：postgres://user:pass@host:5432/db，或 pglite:./data/pgdata（本地嵌入式）`);
    return;
  }
  await fn();
}

process.on('unhandledRejection', (err) => logger.fatal('process.unhandled_rejection', { err: serializeError(err) }));
process.on('uncaughtException', (err) => logger.fatal('process.uncaught_exception', { err: serializeError(err) }));

// EU-1（docs/SCHEDULER-RESTART-RESILIENCE.md）：SIGTERM 收尾——把 sync_runs 记为 interrupted 后
// 以 143（128+15）退出。控制台手动触发的任务（SYNC_RUN_ID 由 web 进程建行，own=false）不写库，
// 由 web 端按「已停止（cancelled）」收尾，避免互相覆盖。
installSigtermHandler({
  getRun: () => activeSyncRun,
  finish: (run) => finishSyncRunRecord(run, 'interrupted', '进程收到 SIGTERM（服务重启/停止），任务被中断'),
  logger,
});

main()
  .then(() => logger.debug('process.exit', { code: 0 }))
  .catch((err) => {
    logger.error('process.command_failed', { command: args[0], err: serializeError(err) });
    console.error(`\n错误: ${err.message}`);
    console.error(`详细日志: ${logger.file?.() ?? 'logs/'}（runId=${runId}）`);
    process.exitCode = 1;
  });
