// CO-5/B4-2 第十五轮（docs/DESIGN-AUDIT.md B4）：admin-reports 域路由模块——从 src/server.js
// 巨石抽出的第十五个域（B4 队列 #12：后台报表/备份/日志 reports/backup/backups/logs/steam-logs）。
//
// 域边界（外部契约零变化，路径/参数/响应/错误码与拆分前完全一致）：
//   · GET  /api/admin/backups            备份文件列表（BACKUP_DIR，默认 data/backup）
//   · POST /api/admin/backup             手动触发备份（createBackup 写库 + 返回最新列表）
//   · GET  /api/admin/logs               最近日志（LOG_DIR 最近 5 个 .jsonl + boot.log；
//                                        limit/grep/scope/minutes 过滤，倒序截断）
//   · GET  /api/admin/reports/price      价格变动报表（涨跌榜 + series 悬停线图序列，
//                                        AT 批去 daily、加 series，一次查出无逐行请求）
//   · GET  /api/admin/reports/price.csv  价格变动 CSV 导出（BOM + 双引号转义，附件下载）
//   · GET  /api/admin/steam-logs         Steam 账号操作日志（limit/steamId/action/result/days）
//
// 单入口（位置语义，见 docs/ARCHITECTURE.md「域路由拆分模式」§15.3）：
//   · handleAdminReportsAdmin(ctx)：requireAdmin 就绪后的管理段——本域全部 6 条路由
//     （管理段形态先例=admin-access 域 handleAdminAccessAdmin / admin-sync 域
//     handleAdminSyncAdmin / admin-settings 域 handleAdminSettingsAdmin）。
//   返回值约定：true = 已处理并结束响应；false = 未命中本域，宿主继续。凡写过响应的分支
//   必须返回 true（json(...) 自身返回 undefined，直接 return json(...) 会让宿主误判未命中
//   继续跑完整条链 → 二次写头 ERR_HTTP_HEADERS_SENT）。
//
// 留在 server.js 的中间件与未拆段（不属于本域）：
//   · isTimeoutExemptPath 的 '/api/admin/backup' 超时豁免是中间件、留 server.js（§15.4，
//     手动备份是长任务、豁免统一请求超时看门狗）；
//   · /api/admin/wishlists（B4 #16）与其它 admin 域路由留 server.js；
//   · 本域 SQL 全部跨模块共用、零搬家（判定见 src/store/admin-reports-repository.js 头部）：
//     priceChanges/priceChangeRows/dailyMinSeriesBatch 留 pg.js（cli/sync.js、cli/report.js
//     与 games 域 history.csv 路由（B4 #21，routes/games.js）共用）、listSteamLogs 留
//     steam-log.js（site.js 用户段共用）、createBackup/listBackups 留 backup.js（cli/ops.js 共用）。
import * as db from '../store/pg.js';
import { createBackup, listBackups } from '../backup.js';
import { listSteamLogs } from '../steam-log.js';
import { yuanAmount } from '../format.js';

/**
 * 管理段：server.js 在 requireAdmin 就绪之后调用——后台报表/备份/日志全部路由。
 * 每条分支自己 requireAdmin()（401/403 文案由宿主守卫统一输出，契约不变）。
 * ctx 全部为基座字段（path/req/res/url/q/logger/json/user/requireAdmin），
 * 本域无跨模块共享的可变状态、无域特有 ctx 字段。
 */
export async function handleAdminReportsAdmin(ctx) {
  const { path, req, res, url, q, logger, json, user, requireAdmin } = ctx;

  // ---- 管理员：备份（手动触发 + 列表）----
  if (path === '/api/admin/backups' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    json(res, 200, { backups: listBackups(process.env.BACKUP_DIR ?? 'data/backup') });
    return true;
  }

  if (path === '/api/admin/backup' && req.method === 'POST') {
    if (!requireAdmin()) return true;
    try {
      const result = await createBackup(q, { dir: process.env.BACKUP_DIR ?? 'data/backup', logger });
      logger?.info('api.backup_done', { ...result, by: user.username });
      json(res, 200, { result, backups: listBackups(process.env.BACKUP_DIR ?? 'data/backup') });
      return true;
    } catch (err) {
      logger?.warn('api.backup_failed', { message: String(err.message).slice(0, 160) });
      json(res, 500, { error: '备份失败：' + String(err.message).slice(0, 120) });
      return true;
    }
  }

  // ---- 管理员：最近日志（排障用；日志层已做脱敏）----
  if (path === '/api/admin/logs' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    const fsMod = await import('node:fs');
    const dir = process.env.LOG_DIR ?? 'logs';
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 200) || 200, 1000);
    const grep = String(url.searchParams.get('grep') ?? '').trim();
    let files = [];
    try {
      files = fsMod.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort();
    } catch {
      files = [];
    }
    const picked = files.slice(-5);
    const entries = [];
    for (const f of picked) {
      try {
        const lines = fsMod.readFileSync(dir + '/' + f, 'utf8').split('\n').filter(Boolean);
        for (const line of lines.slice(-limit)) {
          try {
            entries.push(JSON.parse(line));
          } catch {
            entries.push({ msg: line });
          }
        }
      } catch {
        /* 单个文件读失败不影响整体 */
      }
    }
    // 容器启动输出（entrypoint / node 崩溃栈）也一起返回
    try {
      const bootLines = fsMod.readFileSync(dir + '/boot.log', 'utf8').split('\n').filter(Boolean).slice(-limit);
      for (const line of bootLines) {
        entries.push({ ts: new Date().toISOString(), level: /错误|失败|ERROR|Error/.test(line) ? 'warn' : 'info', event: line.slice(0, 300) });
      }
      if (bootLines.length) picked.push("boot.log");
    } catch {
      /* 没有 boot.log 就算了 */
    }

    // 按模块归类：用户 / Steam 同步 / 程序；error 单独一档
    const scopeOf = (e) => {
      const ev = String(e.event || '');
      const job = String(e.job || '');
      if (/^(auth\.|api\.login|api\.logout|api\.user_|api\.me)/.test(ev)) return 'user';
      if (/^(sync\.steamall|sync\.item_failed|import\.steamcatalog|steam\.meta|api\.sync_)/.test(ev) || /^steam/.test(job)) return 'steam';
      return 'app';
    };
    const scope = String(url.searchParams.get('scope') ?? '').trim();
    const minutes = Math.max(0, Number(url.searchParams.get('minutes') ?? 0) || 0);
    // 时间范围：只保留最近 N 分钟的日志（ts 是 ISO 字符串）
    let ranged = entries;
    if (minutes > 0) {
      const cutoff = Date.now() - minutes * 60_000;
      ranged = entries.filter((e) => {
        const ts = e.ts || e.time;
        if (!ts) return false;
        const t = new Date(ts).getTime();
        return Number.isFinite(t) && t >= cutoff;
      });
    }
    const scoped = scope
      ? ranged.filter((e) => (scope === 'error' ? String(e.level || '').toLowerCase() === 'error' : scopeOf(e) === scope))
      : ranged;
    const filtered = grep ? scoped.filter((e) => JSON.stringify(e).includes(grep)) : scoped;
    json(res, 200, { files: picked, count: filtered.length, entries: filtered.slice(-limit) });
    return true;
  }

  // ---- 管理员：价格变动报表（涨跌榜 + 悬停线图序列 + CSV 导出）----
  if (path === '/api/admin/reports/price' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    const hours = Number(url.searchParams.get('hours') ?? 24);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 100) || 100, 1), 500);
    const days = Math.min(Math.max(Number(url.searchParams.get('days') ?? 7) || 7, 1), 30);
    const report = await db.priceChanges(q, { hours, limit });
    // AT 批（docs/ADMIN-CONSOLE-IA.md §6）：去 daily、加 series——
    // 报告里出现的 game_id 一次查出近 N 天每日最低（官方渠道），悬停零额外请求。
    const gameIds = [...(report.topDrops || []), ...(report.topRises || [])].map((r) => r.game_id);
    json(res, 200, {
      report,
      series: await db.dailyMinSeriesBatch(q, { gameIds, days }),
    });
    return true;
  }

  if (path === '/api/admin/reports/price.csv' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    const hours = Number(url.searchParams.get('hours') ?? 24);
    const rows = await db.priceChangeRows(q, { hours });
    const cell = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const lines = ['appid,name,platform,platform_name,old_price,new_price,drop_pct,captured_at'];
    for (const r of rows) {
      const pct = r.was > 0 ? (((r.was - r.now_price) / r.was) * 100).toFixed(1) : '';
      lines.push([
        r.steam_appid ?? '',
        r.name,
        r.platform,
        r.platform_name,
        yuanAmount(r.was),
        yuanAmount(r.now_price),
        pct,
        String(r.captured_at).slice(0, 19).replace('T', ' '),
      ].map(cell).join(','));
    }
    // 带 BOM：Excel 直接打开中文不乱码
    const body = '\uFEFF' + lines.join('\r\n');
    res.writeHead(200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="price-changes.csv"',
      'cache-control': 'no-store',
    });
    res.end(body);
    return true;
  }

  // ---- 管理员：Steam 账号操作日志（docs/ADMIN-CONSOLE-IA.md §6，AT 批）----
  // 参数 limit(≤500) / steamId / action / result / days(默认 30)；返回 { entries, total }。
  if (path === '/api/admin/steam-logs' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    const limit = Number(url.searchParams.get('limit') ?? 100);
    const steamId = String(url.searchParams.get('steamId') ?? '').trim() || null;
    const action = String(url.searchParams.get('action') ?? '').trim() || null;
    const result = String(url.searchParams.get('result') ?? '').trim() || null;
    const days = Number(url.searchParams.get('days') ?? 30);
    json(res, 200, await listSteamLogs(q, { limit, steamId, action, result, days }));
    return true;
  }

  return false;
}
