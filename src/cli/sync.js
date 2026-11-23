// B4 #18 cli 同步类域（CO-5/B4-2 第十轮拆分）：sync 全家族 + Steam 账号/发现/状态等同步类命令。
// 按 ARCHITECTURE §15 模式：本模块**不 import cli.js**（入口文件带 main() 副作用，import 会触发执行），
// 宿主（cli.js）把共享上下文打包成 ctx 传入（§15.2 类比），createCliSync(ctx) 返回：
//   - dispatchSync        sync <target> 全部分发（all/steam/steam-prices/steamall/catalog/sonkwo/itad/gog/humble）
//   - trackedCommands     TRACKED_COMMANDS 的同步类条目（写 sync_runs + fetch_runs，注册表语义保持）
//   - steamClaim          steam-claim 命令（调度器 STEAM_CLAIM_* 迁移任务）
// 契约零变化：命令名/参数/输出/退出码与拆分前逐字节一致；runSyncTracked 等记录包装留宿主按引用传入。

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { serializeError } from '../log.js';
import * as db from '../store/pg.js';
import { ingestOffers } from '../ingest.js';
import { descriptor as steam, syncPrices } from '../adapters/steam.js';
import { descriptor as sonkwo, fetchSku } from '../adapters/sonkwo.js';
import { descriptor as itad, searchGame, fetchPrices, normalizeDeals } from '../adapters/itad.js';
import {
  descriptor as gogDescriptor,
  searchOffer as gogSearch,
  resolveRegion as gogResolveRegion,
  fetchById as gogFetchById,
} from '../adapters/gog.js';
import {
  descriptor as humbleDescriptor,
  searchOffer as humbleSearch,
  fetchBySlug as humbleFetchBySlug,
} from '../adapters/humble.js';
import {
  DEFAULT_STATE as DEFAULT_DISCOVERY_STATE,
  planScan,
  discoverSkus,
  mergeSkuEntries,
} from '../adapters/sonkwo-discover.js';
import { fetchMetadata } from '../adapters/steam-meta.js';
import { baseRegion, baseCurrency, regionContext } from '../sync-regions.js';
import { fetchJson, fetchBuffer, sleep } from '../http.js';
import { runPool } from '../pool.js';
import { runSteamStatusRound } from '../steam-status.js';
import { yuanAmount } from '../format.js';
import * as cliSyncRepo from '../store/cli-sync-repository.js';
import { readResumeState, validResumeAppids, recordResume, clearResume, writeResumeState } from '../sync-resume.js';

// 统一成 { code, name, kind, ..., searchOffer } 的形状，供 syncByTitle 复用
const gog = { ...gogDescriptor, searchOffer: gogSearch, fetchById: gogFetchById };
const humble = { ...humbleDescriptor, searchOffer: humbleSearch, fetchBySlug: humbleFetchBySlug };

export function createCliSync(ctx) {
  const { args, flag, logger, withStore, syncNote, runSyncTracked, readJson, applySkuMapping } = ctx;

  async function cmdSyncSteam() {
    const limit = Number(flag('limit', 500));
    const appids = await withStore(async (store) =>
      cliSyncRepo.listSyncSteamAppids((sql, p) => store.query(sql, p), { limit }),
    );
    if (!appids.length) throw new Error('库里没有游戏，先跑 seed');
    logger.info('sync.start', { platform: steam.code, appids: appids.length });
    const runId_ = await withStore((store) => db.startFetchRun((sql, p) => store.query(sql, p), steam.code));

    try {
      const result = await syncPrices({ appids, logger, log: (m) => logger.debug('sync.progress', { msg: m }) });
      const stats = await withStore((store) => ingestOffers(store, { platform: steam, offers: result.offers, logger }));
      await withStore((store) =>
        db.finishFetchRun((sql, p) => store.query(sql, p), runId_, {
          requests: result.requests,
          total: appids.length,
          ok: result.offers.length,
          skipped: result.skipped.length,
          failed: appids.length - result.offers.length - result.skipped.length,
          status: 'ok',
          note: `${(result.bytes / 1024).toFixed(0)}KB`,
        }),
      );
      logger.info('sync.done', { platform: steam.code, ...stats });
    } catch (err) {
      await withStore((store) =>
        db.finishFetchRun((sql, p) => store.query(sql, p), runId_, {
          total: appids.length,
          failed: appids.length,
          status: 'failed',
          note: String(err.message).slice(0, 200),
        }),
      );
      logger.error('sync.failed', { platform: steam.code, err: serializeError(err) });
      throw err;
    }
  }

  /** 每日刷新已经有 Steam 报价的游戏，避免对全目录的免费/未售游戏重复请求。 */
  async function cmdSyncSteamPrices() {
    const limit = Math.max(1, Math.min(Number(flag('limit', '200000')) || 200000, 200000));
    // EU-2（docs/SCHEDULER-RESTART-RESILIENCE.md §EU-2）：--batch 每轮最多处理一批（默认 5000 ≈ 4–5 分钟）；
    // 批内每 chunk 落断点（data/scheduler-resume.json），被重启打断后下一轮从断点续跑、不重跑已处理部分。
    const batch = Math.max(1, Math.min(Number(flag('batch', '5000')) || 5000, 200000));
    // F 批（docs/TODO.md F 段）：热点优先 + 冷门降频。
    // 热点 = 近 90 天有访问 / 有用户标记 / 热度达标 → 每天刷；冷门 = 最近价格快照超过 N 天未更新才刷。
    const hotHeatMin = Number(process.env.STEAM_PRICES_HOT_HEAT_MIN ?? '1');
    const coldDays = Number(process.env.STEAM_PRICES_COLD_DAYS ?? '3');
    const appids = await withStore(async (store) =>
      cliSyncRepo.listSteamPriceRefreshAppids((sql, p) => store.query(sql, p), { limit, hotHeatMin, coldDays }),
    );
    if (!appids.length) {
      logger.info('sync.steam_prices_empty', { hint: '先在后台完成首次数据回填' });
      console.log('没有需要刷新的 Steam 报价；请先在后台完成首次数据回填。');
      return;
    }

    // 断点续跑：上一轮被中断前已处理的 appid 本轮排除（断点超 36h 自动作废）
    const resumeState = readResumeState();
    const doneAppids = new Set(validResumeAppids(resumeState, { mode: 'steam-prices' }));
    const todo = appids.filter((id) => !doneAppids.has(id)).slice(0, batch);
    if (!todo.length) {
      // 断点里已把本轮候选全部处理完（正常收尾路径，理论上不可达；防御性清断点）
      writeResumeState(clearResume(resumeState, 'steam-prices'));
      logger.info('sync.steam_prices_empty', { hint: '断点已覆盖全部候选，本轮无新报价' });
      console.log('没有需要刷新的 Steam 报价（断点已覆盖全部候选）。');
      return;
    }
    const skippedByResume = appids.length - todo.length;

    logger.info('sync.start', {
      platform: 'steam',
      mode: 'prices',
      appids: todo.length,
      batch,
      skippedByResume,
      regions: regionContext(),
    });
    const runId_ = await withStore((store) => db.startFetchRun((sql, p) => store.query(sql, p), steam.code));
    const totals = { requests: 0, offers: 0, skipped: 0, bytes: 0 };
    const ingested = { inserted: 0, updated: 0, snapshots: 0, unchanged: 0 };
    let processed = 0;
    try {
      // 每 chunk 最多 1000 个 appid：一次 syncPrices + 入库，完成后立即落断点——中断损失 ≤1 chunk
      for (let i = 0; i < todo.length; i += 1000) {
        const chunk = todo.slice(i, i + 1000);
        const result = await syncPrices({
          appids: chunk,
          logger,
          region: baseRegion(),
          batchSize: 30,
          rateLimitMs: 1600,
          log: (m) => logger.debug('sync.progress', { msg: m }),
        });
        const stats = await withStore((store) => ingestOffers(store, { platform: steam, offers: result.offers, logger }));
        for (const key of Object.keys(ingested)) ingested[key] += stats[key] ?? 0;
        processed += chunk.length;
        totals.requests += result.requests;
        totals.offers += result.offers.length;
        totals.skipped += result.skipped.length;
        totals.bytes += result.bytes;
        const done = todo.slice(0, processed);
        writeResumeState(recordResume(resumeState, { mode: 'steam-prices', appids: [...doneAppids, ...done] }));
        logger.info('sync.progress_batch', {
          platform: steam.code,
          mode: 'prices',
          processed,
          total: todo.length,
          offers: totals.offers,
        });
      }
      // 本轮正常跑完：清断点（下一轮由 last_snap 收敛性自然推进，不再需要排除）
      writeResumeState(clearResume(resumeState, 'steam-prices'));
      await withStore((store) =>
        db.finishFetchRun((sql, p) => store.query(sql, p), runId_, {
          requests: totals.requests,
          total: todo.length,
          ok: totals.offers,
          skipped: totals.skipped,
          failed: todo.length - totals.offers - totals.skipped,
          status: 'ok',
          note: `${(totals.bytes / 1024).toFixed(0)}KB`,
        }),
      );
      syncNote.note = skippedByResume
        ? `本轮处理 ${processed} 条报价（断点续跑跳过 ${skippedByResume} 条已处理）`
        : `本轮处理 ${processed} 条报价`;
      logger.info('sync.done', { platform: steam.code, mode: 'prices', ...totals, ...ingested, processed });
    } catch (err) {
      // 中断/失败：断点保留在上一 chunk 完成点，下一轮续跑
      await withStore((store) =>
        db.finishFetchRun((sql, p) => store.query(sql, p), runId_, {
          total: todo.length,
          ok: totals.offers,
          skipped: totals.skipped,
          failed: todo.length - totals.offers - totals.skipped,
          status: 'failed',
          note: String(err.message).slice(0, 200),
        }),
      );
      logger.error('sync.failed', { platform: steam.code, mode: 'prices', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * 同步库里所有 Steam 游戏：元数据（名字/开发商/分类/说明）+ Steam 自身价格。
   * 这是「以 Steam 为准」的批量入口，后台按钮与定时任务都走它。
   */
  /**
   * 导入 Steam 全量应用目录（一次请求，20 万条）。
   * 只写 appid 与名称：GetAppList 没有语言参数，基础名绝大多数是英文，
   * 所以含中文的写 name、否则写 name_en（name 留空等回填补 schinese 本地化名），
   * 避免英文名占死中文名槽位。价格/说明交给 sync steamall 慢慢补。
   */
  async function cmdImportSteamCatalog() {
    const { fetchAppList } = await import('../adapters/steam-catalog.js');
    console.log('拉取 Steam 应用目录…（单次请求，可能 10MB 左右）');
    let apps = [];
    try {
      apps = await fetchAppList({
        logger,
        onPage: (p) => {
          const msg = '已拉取第 ' + p.page + ' 页，累计 ' + p.total + ' 条';
          console.log('  ' + msg);
          logger.info('import.steamcatalog.progress', { page: p.page, total: p.total });
        },
      });
    } catch (err) {
      logger.error('import.steamcatalog.failed', { message: String(err.message).slice(0, 300) });
      throw err;
    }
    logger.info('import.steamcatalog.fetched', { total: apps.length });
    console.log('拿到 ' + apps.length + ' 条，开始入库（批量 500）');
    let inserted = 0;
    await withStore(async (store) => {
      const q = (sql, p) => store.query(sql, p);
      for (let i = 0; i < apps.length; i += 500) {
        const batch = apps.slice(i, i + 500);
        inserted += await db.importCatalogGames(q, batch);
        if ((i / 500) % 20 === 0) {
          const msg = '已处理 ' + (i + batch.length) + ' / ' + apps.length + '，新增 ' + inserted;
          console.log('  ' + msg);
          logger.info('import.steamcatalog.progress', { done: i + batch.length, total: apps.length, inserted });
        }
      }
    });
    logger.info('import.steamcatalog.done', { total: apps.length, inserted });
    console.log('完成：目录 ' + apps.length + ' 条，新增 ' + inserted + ' 款');
    console.log('下一步：node src/cli.js sync steamall --limit 200 --sleep 2（慢慢补价格与说明）');
  }

  async function cmdSyncSteamAll() {
    // 只挑"还没有 Steam 价格或说明"的游戏，按 id 顺序推进，避免重复抓同一批
    const startedMs = Date.now();
    const limit = Number(flag('limit', '200')) || 200;
    const sleepMs = Math.max(0, Number(flag('sleep', '2')) || 0) * 1000;
    // 并发抓取：默认 4 路，配合每路 sleep 控制总速率（--concurrency 1 即回到串行）
    const concurrency = Math.max(1, Math.min(Number(flag('concurrency', 4)) || 4, 16));
    const rows = await withStore(async (store) =>
      cliSyncRepo.listSteamAllCandidates((sql, p) => store.query(sql, p), { limit }),
    );
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const appids = rows.map((r) => Number(r.steam_appid)).filter((n) => Number.isFinite(n) && n > 0);
    if (!appids.length) {
      logger.info('sync.steamall_complete', { hint: '没有缺少说明或 Steam 报价的游戏' });
      console.log('没有需要补全的 Steam 游戏。');
      return;
    }

    console.log(`同步 ${appids.length} 款 Steam 游戏（官方接口：元数据 + 说明 + 价格，并发 ${concurrency}）`);
    const backend = String(flag('backend', 'official'));
    const items = [];
    let blocked = 0; // 连续 403/429 计数：被限流时及时中止，避免把 IP 越打越黑
    await runPool(
      appids,
      concurrency,
      async (appid) => {
        try {
          // EF/EI 批（docs/STEAM-SYNC-STATUS-AND-RATING.md §9/§11）：本路径用 priceOverview 写本位币报价，
          // 必须保持 cc=baseRegion（默认 cn；用内容区会把美元价写进国区 offer）
          const one = await fetchMetadata([appid], { backend, logger, cc: baseRegion() });
          if (one.items?.length) items.push(...one.items);
        } catch (err) {
          const status = Number(err.status) || 0;
          if (status === 403 || status === 429) {
            blocked += 1;
            logger.warn('sync.rate_limited', { appid, status, blocked });
            if (blocked >= 5) {
              throw new Error(`Steam 返回 ${status}（出口 IP 被限流），本轮已中止：降低 limit/并发，等 1~2 小时再试`);
            }
          }
          logger.warn('sync.item_failed', { appid, message: String(err.message).slice(0, 160) });
        }
        if (sleepMs) await sleep(sleepMs);
      },
      {
        onProgress: (done, total) => {
          if (done % 25 === 0 || done === total) console.log(`  进度 ${done} / ${total}`);
        },
      },
    );
    console.log(`元数据来源 ${backend}，取到 ${items.length} 条`);

    let named = 0;
    let described = 0;
    let priced = 0;
    const offers = [];

    for (const item of items) {
      await withStore(async (store) => {
        const q = (sql, p) => store.query(sql, p);
        await db.upsertGameMeta(q, item);
        if (item.description) {
          const row = await db.setGameDescription(q, { steamAppid: item.steamAppid, description: item.description });
          if (row?.description) described += 1;
        }
        if (item.nameZh) named += 1;

        if (item.priceOverview && item.priceOverview.final != null) {
          offers.push({
            platformCode: 'steam',
            platformProductId: String(item.steamAppid),
            steamAppid: item.steamAppid,
            title: item.nameZh ?? item.nameEn ?? String(item.steamAppid),
            productType: 'official_direct',
            region: baseRegion(),
            currency: item.priceOverview.currency ?? baseCurrency(),
            priceCents: Math.round(item.priceOverview.final),
            originalCents: Math.round(item.priceOverview.initial ?? item.priceOverview.final),
            discountPct: Number(item.priceOverview.discountPercent ?? 0),
            inStock: true,
            buyUrl: `https://store.steampowered.com/app/${item.steamAppid}/`,
            meta: {},
          });
          priced += 1;
        }
      });
    }

    if (offers.length) {
      const stats = await withStore((store) =>
        ingestOffers(store, { platform: { code: 'steam', name: 'Steam 国区', kind: 'official' }, offers, logger }),
      );
      const dlcCount = items.filter((i) => i.appType === 'dlc').length;
      logger.info('sync.steamall.done', { appids: appids.length, items: items.length, dlc: dlcCount, described, priced, regions: regionContext(), ...stats });
      console.log(`完成：${items.length} 条元数据（其中 DLC ${dlcCount} 款；说明 ${described} 条）、${priced} 条 Steam 价格（新增 ${stats.inserted}）`);
      syncNote.note = `元数据 ${items.length} 条（说明 ${described}）、Steam 价格 ${priced} 条（新增 ${stats.inserted}）`;
    } else if (!items.length) {
      logger.warn('sync.steamall.empty', { appids: appids.length, backend });
      console.log('完成：0 条元数据 —— 拉取全部失败。先排查网络/代理：');
      console.log('  docker compose exec app node src/cli.js diagnose   # 看 net:steam 一行');
      console.log('  日志里搜 steam.meta.failed 可看到每个 appid 的失败原因');
      syncNote.note = '0 条元数据（拉取全部失败，先看 diagnose 的 net:steam）';
    } else {
      console.log(`完成：${items.length} 条元数据，没有可入库的价格（汇率区/免费游戏）`);
      syncNote.note = `元数据 ${items.length} 条（无可入库价格）`;
    }

    // 只冷却成功收到元数据的项目；真正请求失败的 appid 留待后续重试。
    const handledAppids = [...new Set(items.map((item) => Number(item.steamAppid)).filter((id) => Number.isFinite(id) && id > 0))];
    if (handledAppids.length) {
      await withStore((store) => db.markBackfilled((sql, p) => store.query(sql, p), handledAppids));
    }

    // 增量同步顺带补封面图：前台不用再等 4 小时的补图任务；--images 0 可关，--image-sleep 控制节奏
    const withImages = String(flag('images', '1')) !== '0' && process.env.SYNC_IMAGES_ENABLED !== '0';
    if (withImages && items.length) {
      const images = await import('../images.js');
      const sizes = String(flag('image-sizes', 'capsule_sm_120,header'))
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      const imageSleep = Math.max(0, Number(flag('image-sleep', '200')) || 0);
      let imgOk = 0;
      let imgFailed = 0;
      for (const item of items) {
        const appid = Number(item.steamAppid);
        if (!Number.isFinite(appid) || appid <= 0) continue;
        for (const size of sizes) {
          if (!images.isImageSize(size)) continue;
          try {
            const r = await images.downloadImage(appid, size, { fetchBuffer, logger, timeoutMs: 12000 });
            if (r.ok) imgOk += 1;
            else imgFailed += 1;
          } catch (err) {
            imgFailed += 1;
            logger.warn('sync.image_failed', { appid, size, message: String(err.message).slice(0, 160) });
          }
          if (imageSleep) await sleep(imageSleep);
        }
      }
      console.log('封面图：成功 ' + imgOk + ' 张，失败 ' + imgFailed + ' 张');
      syncNote.note = (syncNote.note ? syncNote.note + '；' : '') + '封面图 ' + imgOk + ' 张';
    }
    // 价格简报：本次同步产生的涨跌（价格快照带 prev_price_cents 后才统计得到）
    const priceSummary = await printSyncPriceReport(startedMs, 5);
    if (priceSummary) syncNote.note = (syncNote.note ? syncNote.note + '；' : '') + priceSummary;
  }

  /** 打印某个时间窗内的价格变动简报；失败只警告，不影响同步结果。 */
  async function printSyncPriceReport(sinceMs, limit = 5) {
    try {
      const rep = await withStore((store) =>
        db.priceChanges((sql, p) => store.query(sql, p), { sinceMs, limit }),
      );
      if (!rep.changed) {
        console.log('本次没有价格变动');
        return '价格无变动';
      }
      console.log(`\n本次价格变动：降价 ${rep.drops} 条 / 涨价 ${rep.rises} 条`);
      for (const d of rep.topDrops) {
        const pct = d.was > 0 ? Math.round((d.drop_cents / d.was) * 100) : 0;
        console.log(`  ↓ ¥${yuanAmount(d.was)} → ¥${yuanAmount(d.now_price)}（-${pct}%）${d.name} · ${d.platform_name}`);
      }
      for (const r of rep.topRises.slice(0, limit)) {
        console.log(`  ↑ ¥${yuanAmount(r.was)} → ¥${yuanAmount(r.now_price)}  ${r.name} · ${r.platform_name}`);
      }
      logger.info('sync.price_report', { hours: rep.hours, changed: rep.changed, drops: rep.drops, rises: rep.rises });
      return `降价 ${rep.drops} 条 / 涨价 ${rep.rises} 条`;
    } catch (err) {
      logger.warn('sync.price_report_failed', { message: String(err.message).slice(0, 160) });
      return '';
    }
  }

  async function cmdAppSync() {
    // CJ 批（docs/APP-AUTO-UPDATE-PAGE.md §3）：手动调试同步——默认读 GitHub Release 最新资产
    const { syncAppRelease } = await import('../app-release.js');
    const result = await syncAppRelease({
      repo: String(flag('repo', process.env.APP_RELEASE_SYNC_REPO ?? 'yyliucha/steamdeals-app')),
      keep: Number(flag('keep', 3)),
      force: flag('force', false) === true,
      logger,
    });
    if (!result.synced && result.reason !== 'same_version' && result.reason !== 'no_release') {
      // CO-1/A5：真正的同步失败（网络/接口/资产缺失）必须抛错——让调度任务在健康条显红并带原因，
      // 不再静默退出 0；「同版本跳过 / 无新 Release」属正常，不算失败。
      throw new Error(`App Release 同步失败：${result.reason}${result.version ? `（${result.version}）` : ''}`);
    }
    // DK 批（docs/TODO.md DK C）：APK 下载失败（latest 已更新但本地 APK 缺失）同样抛错——
    // 健康条显红 + 原因可见；站点自托管缺 APK 时用户在走 GitHub 直链，运维据此手动重拉。
    if (result.apkFailed) {
      throw new Error(`App Release 同步失败：${result.apkFailed}（${result.version}）`);
    }
    console.log(result.synced ? `已同步 app ${result.version}（APK ${result.apk ?? '无'}）` : `未同步：${result.reason}${result.version ? `（${result.version}）` : ''}`);
  }
  async function cmdSteamDiscovery() {
    const { runDiscoveryRound } = await import('../discovery.js');
    const stats = await withStore((store) =>
      runDiscoveryRound({
        q: (sql, p) => store.query(sql, p),
        pages: Number(flag('pages', 100)),
        fallbackLimit: Number(flag('fallback', 100)),
        rateMs: Number(flag('rate', 1200)),
        logger,
      }),
    );
    console.log(`发现轮完成：翻页命中 ${stats.matched}，回退请求 ${stats.fallbackRequests}（采纳 ${stats.fallbackMatched}），总请求 ${stats.requests}`);
  }

  async function cmdSyncSonkwo() {
    const skus = readJson('data/skus.json', []);
    if (!skus.length) throw new Error('data/skus.json 为空，先用 add-sku 加几个 SKU');
    // CC 批：设置默认 0 = 全部 SKU——hydrateSettings 会把默认值写回 env（'0' 是 truthy 字符串），
    // 必须显式把 0 换算成 skus.length，否则默认配置下每轮处理 0 个（质检打回项）。
    const rawLimit = Number(process.env.SOURCES_SONKWO_LIMIT);
    const limit = Number.isFinite(rawLimit) && rawLimit >= 0
      ? (rawLimit === 0 ? skus.length : rawLimit)
      : Number(flag('limit', skus.length));
    const targets = skus.slice(0, limit);
    // A3 批（docs/DESIGN-AUDIT.md A3）：库映射（game_source_map confirmed）为唯一真相，
    // skus.json 自带 appid 只读回落（旧数据兼容，DH 批计算时自动补写进库）。
    const align = await import('../align.js');
    const confirmedAppids = await withStore((store) =>
      align.loadConfirmedAppids({ q: (sql, p) => store.query(sql, p), productIds: targets.map((t) => String(t.skuId)) }),
    );
    logger.info('sync.start', { platform: sonkwo.code, skus: targets.length });
    const offers = [];
    const marks = [];
    let matched = 0;
    let noMatch = 0;
    let failed = 0;
    for (const item of targets) {
      const appid = align.resolveSkuAppid(confirmedAppids, item);
      try {
        const offer = await fetchSku(item.skuId, { logger });
        if (offer) {
          if (appid) offer.steamAppid = appid;
          offers.push(offer);
          matched += 1;
          if (appid) marks.push({ appid, status: 'matched', externalId: String(item.skuId), ok: true });
        } else {
          noMatch += 1;
          if (appid) marks.push({ appid, status: 'nomatch', ok: false });
        }
      } catch (err) {
        failed += 1;
        if (appid) marks.push({ appid, status: 'failed', ok: false, error: String(err.message).slice(0, 200) });
        logger.error('sync.sku_failed', { skuId: item.skuId, err: serializeError(err) });
      }
      await sleep(Number(flag('rate', 1200)));
    }
    // CC 批（docs/SOURCE-SYNC-COVERAGE.md §3.3）：杉果保持 skus.json 驱动，只补状态与 external_id=skuId
    if (marks.length) {
      await withStore(async (store) => {
        const q = (sql, p) => store.query(sql, p);
        for (const m of marks) {
          const game = await cliSyncRepo.gameBySteamAppid(q, { appid: m.appid });
          if (game) {
            await db.sourceSyncMark(q, { gameId: Number(game.id), platform: 'sonkwo', status: m.status, externalId: m.externalId ?? null, ok: m.ok, error: m.error ?? null });
          }
        }
      });
    }
    const stats = await withStore((store) => ingestOffers(store, { platform: sonkwo, offers, logger }));
    logger.info('sync.source_progress', { platform: sonkwo.code, scanned: targets.length, matched, nomatch: noMatch, failed, remaining: Math.max(0, targets.length - matched) });
    logger.info('sync.done', { platform: sonkwo.code, fetched: offers.length, ...stats });
    // CD 批（docs/SONKWO-STEAM-MATCH.md §4.1）：sonkwo 收尾追加 match 增量（不新增 cron 任务；
    // MATCH_ON_SONKWO=0 可关）。只自动应用「自动」级提案（CE 加固规则），失败不影响价格采集。
    if (process.env.MATCH_ON_SONKWO !== '0') {
      try {
        await runSonkwoMatchStep({ limit: Number(process.env.SONKWO_MATCH_LIMIT ?? 100) });
      } catch (err) {
        logger.error('match.step_failed', { err: serializeError(err) });
      }
    }
  }

  /**
   * CD 批：sonkwo 收尾的增量匹配——决定继承 + 去重组提案 + 自动应用「自动」级（A3 起只写
   * game_source_map，skus.json 只读）。返回 { proposals, auto, mapped, merged } 供日志与测试。
   */
  async function runSonkwoMatchStep({ limit = 100, autoScore = 0.94 } = {}) {
    const skuFile = 'data/skus.json';
    const entries = readJson(skuFile, []);
    const align = await import('../align.js');
    const { bestMatchMulti } = await import('../match.js');
    const games = await withStore(async (store) =>
      cliSyncRepo.allSteamGamesBasic((sql, p) => store.query(sql, p)),
    );
    const orphanRows = await withStore((store) => align.loadOrphanSonkwoGames((sql, p) => store.query(sql, p)));
    const items = align.loadSonkwoItems(entries, orphanRows);
    const maps = await withStore((store) => db.sourceMapsByProducts((sql, p) => store.query(sql, p), 'sonkwo', items.map((i) => String(i.skuId))));
    const inherit = align.applyMapInheritance(items, maps);
    // DH 批（docs/ALIGN-INTEGRITY.md §2 A1）：skus.json 已带 appid、库无映射 → 自动补写 + 日志 align.map_backfilled
    await withStore((store) =>
      align.writeBackfilledMaps({ q: (sql, p) => store.query(sql, p), backfill: inherit.backfill, steamGames: games, logger }),
    );
    // A3 批：confirmed 继承只用于跳过队列，不再写回 skus.json（库为唯一真相）
    if (inherit.inheritApplied) logger.info('match.inherited', { applied: inherit.inheritApplied });
    const groups = align.proposeAlignGroups(inherit.items.slice(0, limit), games, { autoScore });
    const auto = groups.filter((g) => g.auto);
    let mapped = 0;
    let merged = 0;
    for (const group of auto) {
      const appid = group.best.candidate.steam_appid;
      for (const skuId of group.skuIds) {
        await withStore((store) => applySkuMapping(store, { skuId, appid }));
        mapped += 1;
      }
      const res = await withStore((store) =>
        align.confirmGroup({
          store,
          q: (sql, p) => store.query(sql, p),
          group,
          appid,
          steamGames: games,
          method: group.best.method,
          confidence: group.best.score,
          mergeGame: ({ fromGameId, toGameId }) => db.mergeGames((sql, p) => store.query(sql, p), { fromGameId, toGameId, logger }),
        }),
      );
      merged += res.merged;
    }
    logger.info('match.summary', { groups: groups.length, auto: auto.length, mapped, merged, limit });
    return { proposals: groups.length, auto: auto.length, mapped, merged };
  }

  async function cmdSyncItad() {
    const apiKey = process.env.ITAD_API_KEY;
    if (!apiKey) {
      logger.warn('sync.skip', { platform: itad.code, reason: 'missing_ITAD_API_KEY' });
      console.log('未配置 ITAD_API_KEY，跳过。到 https://isthereanydeal.com/apps/my/ 注册后设置环境变量。');
      return;
    }
    // CC 批（docs/SOURCE-SYNC-COVERAGE.md §3.2/§3.3）：候选按 pending→nomatch 7 天→matched 间隔→failed 退避；
    // 命中缓存 external_id（ITAD id），后续批量取价不再重复 search。
    const limit = Number(process.env.SOURCES_ITAD_LIMIT || flag('limit', 50));
    const refreshMinutes = Math.max(1, Number(process.env.ITAD_INTERVAL_MIN || 1440));
    const candidates = await withStore((store) =>
      db.sourceSyncCandidates((sql, p) => store.query(sql, p), {
        platform: 'itad',
        limit,
        refreshInterval: `${Math.max(1, Math.round(refreshMinutes / 60))} hours`,
      }),
    );
    if (!candidates.length) {
      logger.info('sync.skip', { platform: itad.code, reason: 'no_candidates' });
      console.log('ITAD：没有待处理的游戏。');
      return;
    }

    logger.info('sync.start', { platform: itad.code, games: candidates.length });
    const ids = [];
    const marks = [];
    let matched = 0;
    let noMatch = 0;
    let failed = 0;
    for (const g of candidates) {
      try {
        let bestId = g.external_id ?? null;
        if (!bestId) {
          // 优先英文名搜索（命中率高）；没有英文名再用中文名
          const query = String(g.name_en || g.name || '').trim();
          const hits = await searchGame(query, { apiKey, logger });
          const best = hits.find((h) => h.title?.toLowerCase() === query.toLowerCase()) ?? hits[0];
          logger.info('itad.search_result', {
            query,
            hits: hits.length,
            picked: best?.title ?? null,
            pickedId: best?.id ?? null,
            top3: hits.slice(0, 3).map((h) => h.title),
          });
          bestId = best?.id ?? null;
        }
        if (bestId) {
          ids.push(String(bestId));
          marks.push({ gameId: g.game_id, status: 'matched', externalId: String(bestId), ok: true });
          matched += 1;
        } else {
          marks.push({ gameId: g.game_id, status: 'nomatch', ok: false });
          noMatch += 1;
        }
      } catch (err) {
        logger.error('itad.item_failed', { game: g.name_en || g.name, err: serializeError(err) });
        marks.push({ gameId: g.game_id, status: 'failed', ok: false, error: String(err.message).slice(0, 200) });
        failed += 1;
      }
      await sleep(Number(flag('rate', 1000)));
    }

    if (marks.length) {
      await withStore(async (store) => {
        const q = (sql, p) => store.query(sql, p);
        for (const m of marks) await db.sourceSyncMark(q, { gameId: m.gameId, platform: 'itad', ...m });
      });
    }

    let fetched = 0;
    let stats = {};
    if (ids.length) {
      const prices = await fetchPrices(ids, { apiKey, logger });
      // CD 批（docs/SONKWO-STEAM-MATCH.md §8/§10）：先对每个 ITAD game 找 Steam 店的 deal.url，
      // 跟随 itad.link 跳转反解 appid（必须存在于本站 games），命中后同一 game 的所有商店 deal 都挂该游戏；
      // 反解失败回退英文名匹配（现有 ingest 行为）。
      const { resolveDealSteamAppid } = await import('../adapters/itad.js');
      const gameAppids = new Map();
      for (const game of prices) {
        const steamDeal = (Array.isArray(game?.deals) ? game.deals : []).find((d) => d?.shop?.name === 'Steam');
        if (!steamDeal?.url) continue;
        const appid = await resolveDealSteamAppid(steamDeal.url, { logger });
        if (appid == null) continue;
        const exists = await withStore(async (store) =>
          cliSyncRepo.gameExistsByAppid((sql, p) => store.query(sql, p), { appid }),
        );
        if (exists) gameAppids.set(String(game.id), appid);
        await sleep(200);
      }
      const { offers, skipped } = normalizeDeals(prices, { logger, gameAppids });
      fetched = offers.length;
      logger.info('itad.normalized', { games: ids.length, offers: offers.length, skipped, urlAppids: gameAppids.size });
      stats = await withStore((store) => ingestOffers(store, { platform: itad, offers, logger }));
    }
    const prog = await withStore((store) => db.sourceSyncStats((sql, p) => store.query(sql, p)));
    const by = prog.byPlatform.itad ?? { pending: 0, nomatch: 0 };
    logger.info('sync.source_progress', { platform: itad.code, scanned: candidates.length, matched, nomatch: noMatch, failed, remaining: by.pending + by.nomatch });
    logger.info('sync.done', { platform: itad.code, fetched, ...stats });
    console.log(`ITAD：扫描 ${candidates.length}，匹配 ${matched}，未命中 ${noMatch}，失败 ${failed}，取价 ${fetched} 条`);
  }

  /**
   * 按英文名检索型适配器的通用同步流程（GOG / Humble）。
   * 关键点：把 steamAppid 注入 offer，才能并进已有游戏行而不是新建一条英文名记录。
   * regions 非空时按区服逐个查询（只有声明支持多区的适配器才传）。
   * CC 批（docs/SOURCE-SYNC-COVERAGE.md §3.2/§3.3）：候选有游标（pending→nomatch 7 天→matched 间隔→failed 退避）；
   * 已命中（matched + external_id）的游戏按 id/slug 直接刷新，不再重新搜索。
   */
  async function syncByTitle(adapter, { label = adapter.code, limit = 50, rate = 1200, regions = null, refreshInterval = '12 hours' } = {}) {
    const candidates = await withStore((store) =>
      db.sourceSyncCandidates((sql, p) => store.query(sql, p), { platform: adapter.code, limit, refreshInterval }),
    );
    if (!candidates.length) {
      logger.info('sync.skip', { platform: adapter.code, reason: 'no_candidates' });
      console.log(`${label}：没有待处理的游戏。`);
      return;
    }

    const regionList = regions?.length ? regions : [null];
    logger.info('sync.start', { platform: adapter.code, games: candidates.length, regions: regionList.filter(Boolean) });

    const offers = [];
    const marks = [];
    let matched = 0;
    let noMatch = 0;
    let failed = 0;
    for (const g of candidates) {
      let anyOffer = false;
      let gameFailed = false;
      let externalId = g.external_id ?? null;
      for (const region of regionList) {
        try {
          let result;
          if (g.status === 'matched' && externalId) {
            // 复用外部 id/slug 刷新（GOG 按 product id、Humble 按 slug），不再重新搜索
            result = adapter.fetchById
              ? await adapter.fetchById(externalId, { logger, steamAppid: g.steam_appid, ...(region ? { region } : {}) })
              : adapter.fetchBySlug
                ? await adapter.fetchBySlug(externalId, { logger, steamAppid: g.steam_appid })
                : await adapter.searchOffer(g.name_en, { logger, steamAppid: g.steam_appid, ...(region ? { region } : {}) });
          } else {
            result = await adapter.searchOffer(g.name_en, { logger, steamAppid: g.steam_appid, ...(region ? { region } : {}) });
          }
          if (result?.offer) {
            offers.push(result.offer);
            anyOffer = true;
            externalId = String(result.offer.platformProductId ?? result.offer.meta?.slug ?? externalId);
          }
        } catch (err) {
          gameFailed = true;
          logger.error('sync.item_failed', {
            platform: adapter.code,
            game: g.name_en,
            region,
            err: serializeError(err),
          });
        }
        await sleep(rate);
      }
      if (anyOffer) {
        matched += 1;
        marks.push({ gameId: g.game_id, status: 'matched', externalId, ok: true });
      } else if (gameFailed) {
        failed += 1;
        marks.push({ gameId: g.game_id, status: 'failed', ok: false, error: 'request_failed' });
      } else {
        noMatch += 1;
        marks.push({ gameId: g.game_id, status: 'nomatch', ok: false });
      }
    }

    if (marks.length) {
      await withStore(async (store) => {
        const q = (sql, p) => store.query(sql, p);
        for (const m of marks) await db.sourceSyncMark(q, { gameId: m.gameId, platform: adapter.code, ...m });
      });
    }

    const stats = await withStore((store) => ingestOffers(store, { platform: adapter, offers, logger }));
    const prog = await withStore((store) => db.sourceSyncStats((sql, p) => store.query(sql, p)));
    const by = prog.byPlatform[adapter.code] ?? { pending: 0, nomatch: 0 };
    logger.info('sync.source_progress', { platform: adapter.code, scanned: candidates.length, matched, nomatch: noMatch, failed, remaining: by.pending + by.nomatch });
    logger.info('sync.done', { platform: adapter.code, queried: candidates.length, regions: regionList.filter(Boolean), matched, noMatch, ...stats });
    const regionNote = regionList.filter(Boolean).length > 1 ? ` × ${regionList.filter(Boolean).length} 区服` : '';
    console.log(`${label}：扫描 ${candidates.length} 款${regionNote}，匹配 ${matched} 条报价，未找到 ${noMatch} 次，失败 ${failed} 次`);
  }

  async function cmdSyncGog() {
    const raw = String(flag('regions', process.env.GOG_REGIONS ?? 'cn'));
    const regions = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    // 提前校验区服，避免跑一半才发现拼错、静默拿到错误币种
    for (const region of regions) gogResolveRegion(region);
    const refreshMinutes = Math.max(1, Number(process.env.GOG_INTERVAL_MIN || 720));
    await syncByTitle(gog, {
      label: 'GOG',
      limit: Number(process.env.SOURCES_GOG_LIMIT || flag('limit', 50)),
      rate: Number(flag('rate', 1200)),
      regions,
      refreshInterval: `${Math.max(1, Math.round(refreshMinutes / 60))} hours`,
    });
  }

  async function cmdSyncHumble() {
    const refreshMinutes = Math.max(1, Number(process.env.HUMBLE_INTERVAL_MIN || 720));
    await syncByTitle(humble, {
      label: 'Humble',
      limit: Number(process.env.SOURCES_HUMBLE_LIMIT || flag('limit', 50)),
      rate: Number(flag('rate', 1500)),
      refreshInterval: `${Math.max(1, Math.round(refreshMinutes / 60))} hours`,
    });
  }

  /** 杉果 SKU 自动发现：从前沿向后探测，连续空壳即停。 */
  async function cmdDiscover() {
    const target = args[1];
    if (target !== 'sonkwo') {
      throw new Error('用法: node src/cli.js discover sonkwo [--ahead 120] [--from N --to M] [--rate 1200] [--max-misses 15]');
    }

    const skuFile = 'data/skus.json';
    const stateFile = 'data/sonkwo-discovery.json';
    const entries = readJson(skuFile, []);
    const state = { ...DEFAULT_DISCOVERY_STATE, ...readJson(stateFile, {}) };
    const knownMax = entries.reduce((max, e) => Math.max(max, Number(e.skuId) || 0), 0);

    const explicitFrom = flag('from', null);
    const explicitTo = flag('to', null);
    const range =
      explicitFrom != null && explicitTo != null
        ? { from: Number(explicitFrom), to: Number(explicitTo) }
        : planScan({ knownMax, state, ahead: Number(flag('ahead', 120)), overlap: Number(flag('overlap', 3)) });

    if (!range) throw new Error('没有已知 SKU 作为起点：先 add-sku，或用 --from/--to 指定区间');
    if (!Number.isFinite(range.from) || !Number.isFinite(range.to) || range.to < range.from) {
      throw new Error(`区间不合法：${JSON.stringify(range)}`);
    }

    const rate = Number(flag('rate', 1200));
    const maxMisses = Number(flag('max-misses', 15));
    console.log(`扫描 ${range.from}..${range.to}（间隔 ${rate}ms，连续 ${maxMisses} 个空壳即停）`);

    const result = await discoverSkus({
      ...range,
      rate,
      stopAfterMisses: maxMisses,
      logger,
      fetchSku: (id) => fetchSku(id, { logger }),
    });

    const merged = mergeSkuEntries(entries, result.found);
    writeFileSync(skuFile, `${JSON.stringify(merged.entries, null, 2)}\n`, 'utf8');

    const discoveredMax = result.found.reduce((max, f) => Math.max(max, f.skuId), 0);
    const highWaterMark = Math.max(knownMax, Number(state.highWaterMark) || 0, discoveredMax);
    writeFileSync(
      stateFile,
      `${JSON.stringify(
        {
          highWaterMark,
          lastRunAt: new Date().toISOString(),
          lastRange: range,
          lastStopReason: result.stopReason,
          totalFound: (Number(state.totalFound) || 0) + merged.added,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    console.log(
      `探测 ${result.probed} 个 id：命中 ${result.found.length}，新增 ${merged.added} 条，` +
        `补名称 ${merged.named} 条，当前共 ${merged.total} 条（停止原因：${result.stopReason}）`,
    );
    if (merged.added) console.log(`已写入 ${skuFile}；接着跑 node src/cli.js sync sonkwo 拉价格。`);
  }

  /** 批量同步所有已绑定 Steam 账号的库 + 愿望单（调度器每日任务；账号间间隔 ≥ 1s，单个失败不阻断）。 */
  async function cmdSteamAccounts() {
    const sleepMs = Math.max(1000, Number(flag('sleep', String(process.env.STEAM_ACCOUNTS_SLEEP_MS ?? 1000))) || 1000);
    const mod = await import('../steam-accounts.js');
    const auth = await import('../email-auth.js');
    const secretKey = (() => { try { return auth.loadSecretKey(); } catch { return null; } })();
    let accounts = [];
    let ok = 0;
    let failed = 0;
    let skipped = 0;
    await withStore(async (store) => {
      const q = (sql, p) => store.query(sql, p);
      accounts = await mod.listAllBoundAccounts(q);
      for (let i = 0; i < accounts.length; i += 1) {
        const account = accounts[i];
        // AT 批（docs/ADMIN-CONSOLE-IA.md §5）：调度器批量同步落审计（actor=scheduler；失败也不中断）
        const log = { actor: 'scheduler', userId: account.user_id, username: account.username ?? null, personaName: account.persona_name ?? null };
        // BE 批（docs/WISHLIST-SITE-ONLY.md §4.4）：每个账号用自己的 API Key；没配就跳过并记日志，**不回退**全局 key。
        const apiKeyEnc = await cliSyncRepo.steamAccountApiKeyEnc(q, { steamId: account.steam_id });
        let apiKey = null;
        try {
          apiKey = auth.decryptSecret(apiKeyEnc, secretKey);
        } catch {
          apiKey = null;
        }
        if (!apiKey) {
          skipped += 1;
          logger.warn('steam.account_sync_skipped', { steamId: account.steam_id, reason: 'no_api_key' });
          if (i < accounts.length - 1) await sleep(sleepMs);
          continue;
        }
        try {
          await mod.syncAccountLibrary(q, { steamId: account.steam_id, apiKey, logger, log });
          // 库同步后补全目录类型（GetOwnedGames 不带类型字段，类型未知数靠 app_type；只挑缺失的，天然收敛）
          await mod.backfillOwnedAppTypes(q, { steamId: account.steam_id, apiKey, logger });
          await mod.syncAccountWishlist(q, { steamId: account.steam_id, apiKey, userId: account.user_id, logger, log });
          ok += 1;
        } catch (err) {
          failed += 1;
          if (err?.status === 401 || err?.status === 403) {
            logger.error('steam.account_sync_invalid_key', { steamId: account.steam_id, status: err.status });
          } else {
            logger.warn('sync.steam_account_failed', { steamId: account.steam_id, message: String(err.message).slice(0, 160) });
          }
        }
        // 串行 + 账号间间隔（规格 §8：逐个串行，间隔 ≥ 1s）
        if (i < accounts.length - 1) await sleep(sleepMs);
      }
    });
    logger.info('sync.steam_accounts_done', { accounts: accounts.length, ok, failed, skipped });
    console.log(`Steam 账号同步完成：${ok} 成功 / ${failed} 失败 / ${skipped} 跳过（缺 API Key，共 ${accounts.length} 个账号）。`);
  }
  /** 认领未归属的 Steam 账号（迁移用；幂等，归属他人时报错）。 */
  async function cmdSteamClaim() {
    const username = String(args[1] ?? '').trim();
    const steamId = String(args[2] ?? '').trim();
    if (!username || !/^\d{17}$/.test(steamId)) {
      throw new Error('用法: node src/cli.js steam-claim <用户名> <17位SteamID>');
    }
    const mod = await import('../steam-accounts.js');
    const result = await withStore((store) =>
      mod.claimAccount((sql, p) => store.query(sql, p), { username, steamId, logger, log: { actor: 'scheduler' } }),
    );
    console.log(result.claimed ? `已认领：${steamId} → ${username}` : `无需处理：${steamId} 已归属 ${username}`);
  }

  /**
   * Steam 同步状态 + 内容分级（docs/STEAM-SYNC-STATUS-AND-RATING.md + AB 批 docs/STEAM-STATUS-FIX.md）：
   * 逐 appid 请求全量 appdetails（EH/EI 批 §10/§11：cc=contentRegion，默认 us；success:false 时
   * 补一次 cc=hk 判定锁区），状态判定与分级解析共用同一次响应；steam_checked_at 作续跑游标，
   * 失败不写游标下轮重试。
   * AB 批：取值 .json、写入不可静默（wrote 只计真写入）、限速按每请求、429 立即收轮、整轮复用连接。
   */
  async function cmdSteamStatus() {
    // 默认上限读设置（steamStatus.limit / STEAM_STATUS_LIMIT，默认 6000 ≈ 5 小时/轮，AB 批 §3-C）
    const limit = Math.max(1, Math.min(Number(flag('limit', process.env.STEAM_STATUS_LIMIT ?? '6000')) || 6000, 200000));
    const batch = Math.max(1, Math.min(Number(flag('batch', '30')) || 30, 100));
    const rateMs = Math.max(0, Number(flag('rate', process.env.STEAM_STATUS_RATE_MS ?? '1500')) || 0);
    const startedMs = Date.now();

    console.log(`Steam 状态判定：逐 appid 请求全量 appdetails（每请求间隔 ${rateMs}ms、上限 ${limit} 款，steam_checked_at 续跑游标）`);
    // AB 批 §3-D：整轮一次连接；取值/写回/限速/429 都在 runSteamStatusRound（可注入测试）
    const result = await withStore((store) =>
      runSteamStatusRound((sql, p) => store.query(sql, p), {
        limit,
        batch,
        rateMs,
        fetchJsonImpl: fetchJson,
        logger,
        onProgress: ({ attempted, wrote, skipped, failed }) => {
          if (attempted % 100 === 0) console.log(`  已尝试 ${attempted} 款（写入 ${wrote} / 跳过 ${skipped} / 失败 ${failed}）…`);
        },
      }),
    );
    const { wrote, skipped, failed, requests, counts, offers, dlcWritten, dlcFill } = result;
    logger.info('steam-status.done', { wrote, skipped, failed, requests, offers, dlcWritten, dlcFill, regions: regionContext(), ...counts, elapsedMs: Date.now() - startedMs });
    console.log(
      `完成：写入 ${wrote} 款，跳过 ${skipped}，失败 ${failed}，顺带写价 ${offers} 款，写 DLC 归属 ${dlcWritten} 款，补 DLC 明细 ${dlcFill?.dlcs ?? 0} 条（${dlcFill?.batches ?? 0} 批），分布 ${JSON.stringify(counts)}${result.aborted429 ? '（429 提前收轮）' : ''}`,
    );
    syncNote.note = `steam-status 写入 ${wrote} / 跳过 ${skipped} / 失败 ${failed} / 写价 ${offers}`;
    // AB 批 §3-B：全部尝试都没有写进去 → 必须失败，不许静默通过
    if (wrote === 0 && result.attempted > 0) {
      throw new Error(
        `Steam 状态判定本轮未写入任何数据（尝试 ${result.attempted}，跳过 ${skipped}，失败 ${failed}）：检查取值链路/代理/限流后重跑`,
      );
    }
  }

  /** 一键同步：把能采集的源按顺序跑一遍，最后重建页面。 */
  async function cmdSyncAll() {
    const sources = ['sonkwo', 'gog', 'humble', 'steam', 'itad'];
    const enabled = {
      sonkwo: process.env.SONKWO_ENABLED !== '0',
      gog: process.env.GOG_ENABLED !== '0',
      humble: process.env.HUMBLE_ENABLED !== '0',
      steam: process.env.STEAM_ENABLED !== '0',
      itad: process.env.ITAD_ENABLED !== '0' && Boolean(process.env.ITAD_API_KEY),
    };
    const queue = sources.filter((s) => enabled[s]);

    if (!queue.length) throw new Error('没有启用任何采集源（检查 *_ENABLED / ITAD_API_KEY）');
    console.log(`一键同步：${queue.join(' → ')}（共 ${queue.length} 个源，串行执行）`);

    const results = [];
    for (const source of queue) {
      const startedAt = Date.now();
      console.log(`\n── ${source} ${'─'.repeat(Math.max(0, 40 - source.length))}`);
      // 子进程隔离：单个源崩溃不影响其它源，和调度器保持同一套行为
      const code = await new Promise((resolve) => {
        const child = spawn(process.execPath, ['src/cli.js', 'sync', source], { stdio: 'inherit' });
        child.on('close', (c) => resolve(c ?? 1));
        child.on('error', () => resolve(1));
      });
      results.push({ source, code, elapsedMs: Date.now() - startedAt });
      if (code !== 0) console.log(`${source} 失败（exit ${code}），继续下一个`);
    }

    // 采集完立刻重建页面，省掉再跑一次 chart
    console.log('\n── 重建页面 ──────────────────────────────');
    const chartCode = await new Promise((resolve) => {
      const child = spawn(process.execPath, ['src/cli.js', 'chart'], { stdio: 'inherit' });
      child.on('close', (c) => resolve(c ?? 1));
      child.on('error', () => resolve(1));
    });

    const ok = results.filter((r) => r.code === 0).length;
    logger.info('sync.all_done', { sources: results, ok, failed: results.length - ok, chartCode });
    console.log(
      `\n完成：${ok}/${results.length} 个源成功` +
        (results.length - ok ? `，失败：${results.filter((r) => r.code !== 0).map((r) => r.source).join(', ')}` : '') +
        `；页面重建${chartCode === 0 ? '成功' : '失败'}`,
    );
    if (!ok) throw new Error('所有采集源都失败了，检查日志');
  }

  async function dispatchSync() {
    const target = args[1];
    if (target === 'all') return cmdSyncAll();
    // 各源同步都留一条记录（定时任务也能在控制台「同步记录」里看到）
    if (target === 'steam') return runSyncTracked('steam', cmdSyncSteam, { fetchRun: false });
    if (target === 'steam-prices') return runSyncTracked('steam-prices', cmdSyncSteamPrices, { fetchRun: false });
    if (target === 'steamall') return runSyncTracked('steamall', cmdSyncSteamAll);
    if (target === 'catalog') return runSyncTracked('catalog', cmdImportSteamCatalog);
    if (target === 'sonkwo') return runSyncTracked('sonkwo', cmdSyncSonkwo);
    if (target === 'itad') return runSyncTracked('itad', cmdSyncItad);
    if (target === 'gog') return runSyncTracked('gog', cmdSyncGog);
    if (target === 'humble') return runSyncTracked('humble', cmdSyncHumble);
    throw new Error('用法: node src/cli.js sync all|steam|steam-prices|steamall|catalog|sonkwo|itad|gog|humble');
  }

  return {
    dispatchSync,
    steamClaim: cmdSteamClaim,
    trackedCommands: {
      'steam-accounts': cmdSteamAccounts,
      'steam-status': cmdSteamStatus,
      discover: cmdDiscover,
      'app-sync': cmdAppSync,
      'steam-discovery': cmdSteamDiscovery,
    },
  };
}
