// e2e 本地服务栈（CK 批，docs/E2E-SUITE.md §3）：
// 起一个"真 HTTP 服务 + pglite 临时库"的完整本地环境——不走 mock，前端产物 frontend/dist 真实伺服。
// 复用 api.test.js 的成熟模式：openStore + migrate + startApiServer（端口随机、127.0.0.1）。
//
// 注意：startE2EStack 参数用普通形参（repoRoot），不要改成解构形参 { repoRoot }——
// 本机 Node 22 上解构形参 + 本文件内容组合会让该导出函数被初始化为 undefined（V8 解析缺陷）。
import { mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openStore } from '../../../src/store/index.js';
import * as db from '../../../src/store/pg.js';
import * as settings from '../../../src/settings.js';
import { startApiServer } from '../../../src/server.js';
import { ingestOffers } from '../../../src/ingest.js';
import { ensureSteamSchemaOnce } from '../../../src/steam-login.js';

export const ADMIN_USERNAME = 'admin';
// 强密码（≥12 位、大小写数字符号，避开常见密码词表），只存在于临时库。
export const ADMIN_PASSWORD = 'E2eAdmin#2026$Xy7q';

// 1x1 透明 PNG：注入 imageFetch，让 /img/steam/* 封面请求不依赖外网（本机无 Steam 出口）。
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

// 种子游戏：主游戏（星露谷物语 413150，详情/DLC/价格历史/中文搜索）、
// 高折扣游戏（Left 4 Dead 2 = 550，排序/折扣断言 + 英文搜索）、DLC 条目（首页"游戏类型=DLC"筛选）。
const SEED_GAMES = [
  { appid: 413150, title: '星露谷物语 Stardew Valley', appType: 'game', price: 4800, orig: 4800, disc: 0 },
  { appid: 550, title: '求生之路 2 Left 4 Dead 2', appType: 'game', price: 680, orig: 6800, disc: 90 },
  { appid: 225840, title: '风之旅人 DLC 试炼包', appType: 'dlc', price: 999, orig: 1999, disc: 50 },
];

/**
 * 最小种子数据：3 个游戏（含报价/价格历史/读模型/DLC 明细）+ 1 条站点公告。
 * 全部走真实入库路径（ingestOffers / writeDlcAppids / refreshGameRegionHist），不是假夹具。
 */
async function seed(q, store) {
  for (const g of SEED_GAMES) {
    await ingestOffers(store, {
      platform: { code: 'steam', name: 'Steam 国区', kind: 'official' },
      offers: [
        {
          platformCode: 'steam',
          platformProductId: String(g.appid),
          steamAppid: g.appid,
          title: g.title,
          productType: 'official_direct',
          region: 'cn',
          currency: 'CNY',
          priceCents: g.price,
          originalCents: g.orig,
          discountPct: g.disc,
          inStock: true,
          buyUrl: `https://store.steampowered.com/app/${g.appid}/`,
          meta: {},
        },
      ],
    });
    await q('update games set app_type = $1 where steam_appid = $2', [g.appType, g.appid]);
    // 近 3 天价格历史 + 读模型重刷（与生产 ingest 的 touch 一致）
    await q(
      `insert into daily_prices (game_id, platform_code, region, day, min_price_cents, currency)
       select id, 'steam', 'cn', d::date, $2, 'CNY'
       from games, unnest(array[current_date - 2, current_date - 1, current_date]) as d
       where steam_appid = $1
       on conflict do nothing`,
      [g.appid, g.price],
    );
    const gid = (await q('select id from games where steam_appid = $1', [g.appid])).rows[0]?.id;
    if (gid) await db.refreshGameRegionHist(q, gid);
    // 每个游戏都标记 DLC 已知（synced），详情页读路径不真实回源
    await db.writeDlcAppids(q, { steamAppid: g.appid, dlcAppIds: g.appid === 413150 ? [413151, 413152] : [] });
  }
  // 星露谷物语的 DLC 明细（详情页 DLC 区块断言 + 反向自检目标）
  const base = (await q('select id from games where steam_appid = 413150')).rows[0];
  await db.upsertGameDlc(q, {
    gameId: base.id,
    items: [
      { steamAppid: 413151, nameZh: '星露谷物语 OST', priceOverview: { final: 1600, initial: 1600, discountPercent: 0, currency: 'CNY' } },
      { steamAppid: 413152, nameZh: '星露谷 壁纸集', priceOverview: { final: 1200, initial: 1200, discountPercent: 0, currency: 'CNY' } },
    ],
  });
  // 游客可见公告（通知中心抽屉断言）
  await db.createAnnouncement(q, {
    title: '欢迎使用 SteamDeals',
    body: '价格情报站点 e2e 种子公告。',
    level: 'info',
    active: true,
    createdBy: 1,
  });
}

/**
 * 启动本地全栈：返回 { base, q, store, srv, workDir, close }。
 * repoRoot 用于定位 frontend/dist（需先 npm run frontend:build）；logPath 时写结构化日志（诊断会话/401 用）。
 */
export async function startE2EStack(repoRoot, logPath = null) {
  // e2e 会做 UA 仿真（微信/移动视口行），与生产默认的会话 UA 绑定（AUTH_SESSION_BIND_UA）冲突——
  // 同一会话跨行切换 UA 会被判 bound_mismatch 而 401。这里只关 UA 绑定，IP 绑定保留（全程 127.0.0.1）。
  process.env.AUTH_SESSION_BIND_UA = '0';
  const workDir = mkdtempSync(join(tmpdir(), 'steamdeals-e2e-'));
  const store = await openStore(`pglite:${join(workDir, 'pgdata')}`, {});
  const q = (sql, p) => store.query(sql, p);
  const logger = logPath
    ? {
        line: (level, event, data) => {
          try {
            appendFileSync(logPath, `${new Date().toISOString()} ${level} ${event} ${JSON.stringify(data ?? {})}\n`);
          } catch {
            /* 日志不可写不影响运行 */
          }
        },
        info: (event, data) => logger.line('INFO', event, data),
        warn: (event, data) => logger.line('WARN', event, data),
        error: (event, data) => logger.line('ERROR', event, data),
      }
    : null;
  try {
    await db.migrate(store);
    await ensureSteamSchemaOnce(q);
    await settings.ensureSettingsSchema(store);
    await db.createUser(q, { username: ADMIN_USERNAME, password: ADMIN_PASSWORD, role: 'admin' });
    await settings.markSetupComplete(q, { by: 'e2e' });
    await seed(q, store);
    // 与 src/cli.js serve 一致：frontendDir 指向构建产物目录（frontend/dist），
    // 页面/资源都从 dist 伺服（frontend/ 是 Vite 源码目录，不能直接伺服）。
    const outDir = resolve(repoRoot, 'frontend', 'dist');
    const frontendDir = outDir;
    const srv = await startApiServer({
      query: q,
      port: 0,
      host: '127.0.0.1',
      store,
      outDir,
      frontendDir,
      logger,
      getSetupState: () => ({ completed: true }),
      // 封面/图片走内存 1x1 PNG，不依赖外网；DLC 读路径不回源（种子已含明细）
      imageFetch: async () => ({ body: TINY_PNG, bytes: TINY_PNG.length, contentType: 'image/png' }),
      dlcFetchImpl: async () => ({ items: [], failed: [] }),
    });
    return {
      store,
      q,
      srv,
      workDir,
      base: `http://127.0.0.1:${srv.port}`,
      close: async () => {
        // Edge 会保持 HTTP keep-alive 连接，server.close() 会一直等它 → 先强制断开所有连接
        try {
          srv.server.closeAllConnections?.();
          srv.server.closeIdleConnections?.();
        } catch {
          /* 旧版本无此 API */
        }
        await srv.close().catch(() => {});
        await store.close().catch(() => {});
        rmSync(workDir, { recursive: true, force: true });
      },
    };
  } catch (err) {
    await store.close().catch(() => {});
    rmSync(workDir, { recursive: true, force: true });
    throw err;
  }
}
