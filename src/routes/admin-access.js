// CO-5/B4-2 第八轮（docs/DESIGN-AUDIT.md B4）：admin-access 域路由模块——从 src/server.js
// 巨石抽出的第八个域（后台访问安全：views/visitors/blacklist/whitelist/abuse/devices/reviews，
// B4 队列 #8）。
//
// 域边界（外部契约零变化，路径/参数/响应/错误码与拆分前完全一致）：
//   · GET  /api/admin/views               浏览统计（含游戏名/最低价解析增强）
//   · GET  /api/admin/visitors            访问记录（分页 + 过滤 + 今日汇总）
//   · GET  /api/admin/visitors/by-ip      IP 统计视图（时间窗/排序/状态白名单）
//   · GET  /api/admin/visitors/by-ip/:ip  单 IP 展开行（最近 20 条 + 路径 top 5）
//   · GET|POST /api/admin/blacklist       黑名单列表 / 加黑（互斥移白 + 内存态同步）
//   · DELETE /api/admin/blacklist/:ip     移出黑名单（刷内存黑名单）
//   · GET|POST /api/admin/whitelist       白名单列表（含限流配置）/ 加白（互斥移黑 + 清临时封禁）
//   · DELETE /api/admin/whitelist/:ip     移出白名单（同步内存白名单）
//   · GET  /api/admin/abuse               超频/临时封禁记录（补「已在黑名单」标注）
//   · DELETE /api/admin/abuse/:ip         手动解封（只清 ip_abuse，绝不动 ip_blacklist）
//   · GET  /api/admin/devices             设备指纹聚合列表
//   · GET  /api/admin/device-bans         设备封禁列表
//   · POST /api/admin/devices/ban         封设备（指纹格式校验 + 内存态刷新）
//   · DELETE /api/admin/device-bans/:fp   解封设备
//   · GET  /api/admin/reviews             异常请求待审列表（证据抽屉：地区/申诉状态/最近 UA）
//   · POST /api/admin/reviews/approve     审批通过（封 IP / 封设备 / 双封）
//   · POST /api/admin/reviews/reject      审批忽略
//   · POST /api/admin/reviews/act         单条四操作（tempban/permban/trust/ignore）
//
// 单入口（位置语义，见 docs/ARCHITECTURE.md「域路由拆分模式」§15.3）：
//   · handleAdminAccessAdmin(ctx)：requireAdmin 就绪后的管理段——本域全部 20 条路由
//     （管理段形态先例=申诉域 handleAppealAdmin / 公告域 handleAnnouncementsAdmin）。
//   返回值约定：true = 已处理并结束响应；false = 未命中本域，宿主继续。凡写过响应的分支
//   必须返回 true（json(...) 自身返回 undefined，直接 return json(...) 会让宿主误判未命中
//   继续跑完整条链 → 二次写头 ERR_HTTP_HEADERS_SENT，拆分回归实测踩过）。
//
// 留在 server.js 的中间件与未拆段（不属于本域）：
//   · 封禁拦截链/黑名单加载/限流计数等中间件（§15.4）——visitors.js/devices.js/ratelimit.js
//     等模块留在宿主，本模块只 import 其方法；
//   · banIpExclusive 闭包 helper（与 #11 /api/admin/bulk 批量封禁/信任共用同一
//     banIpExclusiveSql 口径）——留在 server.js，经 ctx 按引用传入（语义共享）；
//   · /api/admin/bulk 的批量封 IP/封设备/批量信任等条目——走批量分发端点（B4 #11），
//     与 /api/admin/users、/api/admin/images、/api/admin/reports 等其它 admin 域路由留在本文件；
//   · 跨域共用 SQL（listBlockedIps/addBlockedIp/removeBlockedIp/upsertDeviceBan/
//     removeDeviceBan/finishAbuseReview 等）留 pg.js（见 admin-access-repository.js 头部归属判定）。
//
// 本域无跨模块共享状态（无域内限流桶），ctx 只需基座字段 + banIpExclusive 闭包。
import * as db from '../store/pg.js';
import * as visitors from '../visitors.js';
import * as devices from '../devices.js';
import * as ratelimit from '../ratelimit.js';
import * as autoBan from '../auto-ban.js';

/**
 * 管理段：server.js 在 requireAdmin 就绪之后调用——后台访问安全全部路由。
 * 每条分支自己 requireAdmin()（401/403 文案由宿主守卫统一输出，契约不变）。
 * ctx.banIpExclusive 是宿主 admin 段闭包（语义共享：与 #11 /api/admin/bulk 批量
 * 封禁/信任共用同一 banIpExclusiveSql 互斥口径），必须按引用传入，勿改成拷贝。
 */
export async function handleAdminAccessAdmin(ctx) {
  const { path, req, res, url, q, logger, json, readBody, user, requireAdmin, banIpExclusive } = ctx;

  if (path === '/api/admin/views' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 100) || 100, 1), 500);
    const views = await db.viewStats(q, { limit });
    // 把 /game/<appid> 与 /game/id/<id> 解析成游戏名与当前最低价
    const appids = [];
    const ids = [];
    for (const v of views) {
      const byId = /^\/game\/id\/(\d+)$/.exec(v.path);
      const byAppid = /^\/game\/(\d+)$/.exec(v.path);
      if (byId) ids.push(Number(byId[1]));
      else if (byAppid) appids.push(Number(byAppid[1]));
    }
    const map = new Map();
    if (appids.length || ids.length) {
      const rows = await db.adminViewsGameMap(q, { appids, ids });
      for (const g of rows) {
        if (g.steam_appid != null) map.set('a' + g.steam_appid, g);
        map.set('i' + g.id, g);
      }
    }
    const enriched = views.map((v) => {
      const byId = /^\/game\/id\/(\d+)$/.exec(v.path);
      const byAppid = /^\/game\/(\d+)$/.exec(v.path);
      const g = byId ? map.get('i' + byId[1]) : byAppid ? map.get('a' + byAppid[1]) : null;
      return { ...v, name: g ? g.name : null, price: g ? g.low : null };
    });
    json(res, 200, { views: enriched });
    return true;
  }

  // ---- 管理员：访问记录（分页 + 过滤 + 今日汇总）----
  if (path === '/api/admin/visitors' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    const page = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1);
    const pageSize = Math.min(Math.max(Number(url.searchParams.get('pageSize') ?? 20) || 20, 5), 200);
    const ip = String(url.searchParams.get('ip') ?? '').trim();
    const p = String(url.searchParams.get('path') ?? '').trim();
    // FZ 批（docs/VISITORS-REDESIGN.md §4/§7-5）：明细视图与 IP 统计同口径——status 白名单新增
    // active（默认，排除黑名单+白名单）与 trusted（白名单派生）。旧 filter 参数保留兼容：
    // 只传 filter、不传 status 的老书签仍按旧口径（visits=未拦截 / blocked / all）。
    const rawStatus = String(url.searchParams.get('status') ?? '');
    const rawFilter = String(url.searchParams.get('filter') ?? '');
    const visitorStatuses = ['active', 'normal', 'intercepted', 'banned', 'blocked', 'trusted', 'all'];
    const status = url.searchParams.has('status')
      ? (visitorStatuses.includes(rawStatus) ? rawStatus : 'active')
      : (['visits', 'blocked', 'all'].includes(rawFilter) ? null : 'active');
    const filter = ['visits', 'blocked', 'all'].includes(rawFilter) ? rawFilter : 'visits';
    // AQ 批（docs/ADMIN-REVIEW-LISTS.md §3.2）：排序白名单，非法值回落默认，不拼接用户输入
    const rawSort = String(url.searchParams.get('sort') ?? '');
    const sort = ['time', 'ip', 'status'].includes(rawSort) ? rawSort : 'time';
    const order = String(url.searchParams.get('order') ?? '') === 'asc' ? 'asc' : 'desc';
    const rawDays = Number(url.searchParams.get('days') ?? 0);
    const days = [1, 7, 30].includes(rawDays) ? rawDays : null;
    const list = await db.listVisitorLogs(q, { page, pageSize, ip: ip || null, path: p || null, filter, status, sort, order, days });
    const summary = await db.visitorSummary(q);
    json(res, 200, { ...list, page, pageSize, filter, status: status ?? filter, pages: Math.max(1, Math.ceil(list.total / pageSize)), summary });
    return true;
  }

  // FZ 批（docs/VISITORS-REDESIGN.md §4）：概览 6 张数字卡——一次查询返回 6 个数（今日请求/被拦截/
  // 待审/临时封/黑名单/白名单）。放在 by-ip 之前，避免与后面的 /by-ip/... 正则分支互相打扰。
  if (path === '/api/admin/visitors/overview' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    json(res, 200, await db.visitorOverview(q));
    return true;
  }

  // BH 批（docs/VISIT-IP-STATS.md §3.1）：访问明细默认「IP 统计视图」——时间窗/排序白名单，不拼接用户输入
  if (path === '/api/admin/visitors/by-ip' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    const rawDays = Number(url.searchParams.get('days') ?? 7);
    const days = [1, 7, 30].includes(rawDays) ? rawDays : 7;
    const page = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1);
    const pageSize = Math.min(Math.max(Number(url.searchParams.get('pageSize') ?? 20) || 20, 5), 100);
    const kw = String(url.searchParams.get('q') ?? '').trim().slice(0, 80);
    const rawSort = String(url.searchParams.get('sort') ?? '');
    const sort = ['visits', 'lastAt', 'ip'].includes(rawSort) ? rawSort : 'visits';
    // BI 批（docs/VISIT-IP-STATS.md §8）：状态筛选白名单（全部/正常/被拦截/封禁中/已封禁）；
    // FZ 批：新增 active（默认，有效访问 = 排除已封禁 + 已信任）与 trusted（白名单派生）。
    const rawStatus = String(url.searchParams.get('status') ?? '');
    const status = ['active', 'normal', 'intercepted', 'banned', 'blocked', 'trusted', 'all'].includes(rawStatus) ? rawStatus : 'active';
    const data = await db.listVisitorsByIp(q, { days, page, pageSize, q: kw, sort, status });
    json(res, 200, {
      items: data.rows,
      total: data.total,
      page,
      pageSize,
      days,
      sort,
      status,
      pages: Math.max(1, Math.ceil(data.total / pageSize)),
    });
    return true;
  }
  const visitorIpMatch = path.match(/^\/api\/admin\/visitors\/by-ip\/(.+)$/);
  if (visitorIpMatch && req.method === 'GET') {
    if (!requireAdmin()) return true;
    const ip = decodeURIComponent(visitorIpMatch[1]).slice(0, 64);
    const rawDays = Number(url.searchParams.get('days') ?? 7);
    const days = [1, 7, 30].includes(rawDays) ? rawDays : 7;
    json(res, 200, { ip, days, ...(await db.visitorIpDetail(q, { ip, days })) });
    return true;
  }

  // ---- 管理员：IP 黑名单 ----
  if (path === '/api/admin/blacklist' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    json(res, 200, { ips: await db.listBlockedIps(q) });
    return true;
  }

  if (path === '/api/admin/blacklist' && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const body = await readBody(req);
    const ip = visitors.normalizeBanInput(body.ip);
    if (!ip) {
      json(res, 400, { error: 'IP 格式不正确（支持 1.2.3.4 单个 IP 或 1.2.3.0/24 网段）' });
      return true;
    }
    // 互斥：加黑自动移白（含内存态），并把该 IP 的待审记录标记为 auto_banned
    const result = await banIpExclusive(ip, String(body.note ?? '').trim().slice(0, 200) || null, 'ban');
    logger?.info('api.ip_blocked', { ip, by: user.username, removedFromWhitelist: result.removedFromWhitelist });
    json(res, 200, { ip: result.ip, removedFromWhitelist: result.removedFromWhitelist });
    return true;
  }

  const unbanMatch = path.match(/^\/api\/admin\/blacklist\/([^/]+)$/);
  if (unbanMatch && req.method === 'DELETE') {
    if (!requireAdmin()) return true;
    const target = decodeURIComponent(unbanMatch[1]);
    const removed = await db.removeBlockedIp(q, target);
    await visitors.refreshBlocklist(q).catch(() => {});
    logger?.info('api.ip_unblocked', { ip: target, removed, by: user.username });
    json(res, 200, { removed });
    return true;
  }

  // ---- 管理员：白名单（不受频率限制与黑名单影响）----
  if (path === '/api/admin/whitelist' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    json(res, 200, { ips: await db.listWhitelist(q), config: ratelimit.currentConfig() });
    return true;
  }

  if (path === '/api/admin/whitelist' && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const body = await readBody(req);
    const ip = visitors.normalizeBanInput(body.ip);
    if (!ip) {
      json(res, 400, { error: 'IP 格式不正确（支持 1.2.3.4 或 1.2.3.0/24）' });
      return true;
    }
    // 互斥：加白自动移黑（含内存态），黑名单不会"删白后复活"；BR 批：加白即清临时封禁
    const result = await banIpExclusive(ip, String(body.note ?? '').trim().slice(0, 200) || null, 'trust');
    logger?.info('api.ip_whitelisted', { ip, by: user.username, removedFromBlacklist: result.removedFromBlacklist, clearedBan: result.clearedBan });
    json(res, 200, { ip: result.ip, removedFromBlacklist: result.removedFromBlacklist, clearedBan: result.clearedBan });
    return true;
  }

  const wlMatch = path.match(/^\/api\/admin\/whitelist\/([^/]+)$/);
  if (wlMatch && req.method === 'DELETE') {
    if (!requireAdmin()) return true;
    const target = decodeURIComponent(wlMatch[1]);
    const removed = await db.removeWhitelistIp(q, target);
    ratelimit.removeWhitelist(target);
    logger?.info('api.ip_whitelist_removed', { ip: target, removed, by: user.username });
    json(res, 200, { removed });
    return true;
  }

  // ---- 管理员：超频/临时封禁记录 + 手动解封 ----
  if (path === '/api/admin/abuse' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    const status = String(url.searchParams.get('status') ?? 'active');
    const rows = await db.listAbuse(q, { limit: Number(url.searchParams.get('limit') ?? 50), status });
    // BJ 批 B1：逐行补「已在黑名单」标注（运行时 matchesIpEntry，含 CIDR 覆盖）
    for (const row of rows) {
      const entry = visitors.blockedBy(row.ip);
      row.in_blacklist = Boolean(entry);
      row.blacklist_entry = entry ?? null;
    }
    json(res, 200, {
      abuse: rows,
      config: ratelimit.currentConfig(),
    });
    return true;
  }

  const abuseUnban = path.match(/^\/api\/admin\/abuse\/([^/]+)$/);
  if (abuseUnban && req.method === 'DELETE') {
    if (!requireAdmin()) return true;
    const target = decodeURIComponent(abuseUnban[1]);
    // BJ 批 C1：只清 ip_abuse（含内存态），绝不动 ip_blacklist
    const before = await db.ipAbuseBanRow(q, target);
    const wasActive = Boolean(before?.banned_until && new Date(before.banned_until).getTime() > Date.now());
    const removed = await ratelimit.clearAbuse(q, target);
    logger?.info('api.abuse_unbanned', { ip: target, removed, wasActive, blacklistKept: true, by: user.username });
    json(res, 200, { removed });
    return true;
  }

  // ---- 管理员：设备指纹与设备封禁 ----
  if (path === '/api/admin/devices' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    json(res, 200, { devices: await db.listDevices(q, { limit: Number(url.searchParams.get('limit') ?? 100) }) });
    return true;
  }
  if (path === '/api/admin/device-bans' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    json(res, 200, { bans: await db.listDeviceBans(q, { limit: 200 }) });
    return true;
  }
  if (path === '/api/admin/devices/ban' && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const body = await readBody(req);
    const fingerprint = String(body.fingerprint ?? '').trim().toLowerCase();
    if (!/^[a-f0-9]{32,64}$/.test(fingerprint)) {
      json(res, 400, { error: 'fingerprint 不合法' });
      return true;
    }
    const minutes = Number(body.minutes);
    const permanent = body.permanent === true || !Number.isFinite(minutes) || minutes <= 0;
    const until = permanent ? null : new Date(Date.now() + minutes * 60_000).toISOString();
    const row = await db.upsertDeviceBan(q, {
      fingerprint,
      deviceId: devices.normalizeDeviceId(body.deviceId),
      note: body.note,
      until,
    });
    await devices.loadBans(q).catch(() => {});
    logger?.info('device.banned', { fingerprint: fingerprint.slice(0, 16), by: user.username, until });
    json(res, 200, { ban: row });
    return true;
  }
  const devBanMatch = path.match(/^\/api\/admin\/device-bans\/([a-f0-9]{16,64})$/);
  if (devBanMatch && req.method === 'DELETE') {
    if (!requireAdmin()) return true;
    const removed = await db.removeDeviceBan(q, devBanMatch[1]);
    await devices.loadBans(q).catch(() => {});
    logger?.info('device.unbanned', { fingerprint: devBanMatch[1].slice(0, 16), removed, by: user.username });
    json(res, 200, { removed });
    return true;
  }

  // ---- 管理员：异常请求审核（不自动封，审批后才封 IP / 设备）----
  if (path === '/api/admin/reviews' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    const status = String(url.searchParams.get('status') ?? '') === 'all' ? 'all' : 'pending';
    const reviews = await db.listAbuseReviews(q, { status, limit: Number(url.searchParams.get('limit') ?? 500) });
    // CF 批（docs/ADMIN-UX-SECURITY.md §4）：证据抽屉补充——地区/申诉状态/最近 UA（只用已有字段）
    const enriched = await Promise.all(
      reviews.map(async (r) => ({
        ...r,
        region: r.ip ? visitors.cachedRegion(r.ip) : null,
        appeal_status: r.ip ? await db.appealStatusByIp(q, r.ip) : null,
        last_ua: r.ip ? await db.lastUaByIp(q, r.ip) : null,
      })),
    );
    json(res, 200, { reviews: enriched, pending: await db.countPendingReviews(q) });
    return true;
  }
  if (path === '/api/admin/reviews/approve' && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const body = await readBody(req);
    const review = await db.getAbuseReview(q, Number(body.id));
    if (!review || review.status !== 'pending') {
      json(res, 404, { error: '审核记录不存在或已处理' });
      return true;
    }
    const mode = ['ip', 'device', 'both'].includes(body.mode) ? body.mode : 'ip';
    let bannedIp = false;
    let bannedDevice = false;
    if ((mode === 'ip' || mode === 'both') && review.ip) {
      // 互斥 helper：加黑移白 + 内存态同步 + 把该 IP 的其它待审记录标记为 auto_banned
      await banIpExclusive(review.ip, `审核通过（${review.rule}）by ${user.username}`, 'ban');
      bannedIp = true;
    }
    if ((mode === 'device' || mode === 'both') && review.fingerprint) {
      await db.upsertDeviceBan(q, {
        fingerprint: review.fingerprint,
        deviceId: review.device_id,
        note: `审核通过（${review.rule}）by ${user.username}`,
      });
      await devices.loadBans(q).catch(() => {});
      bannedDevice = true;
    }
    await db.finishAbuseReview(q, Number(body.id), { status: 'approved', reviewedBy: user.id, note: body.note });
    logger?.info('abuse.review_approved', {
      id: Number(body.id),
      mode,
      ip: review.ip,
      fingerprint: (review.fingerprint || '').slice(0, 16),
      by: user.username,
    });
    json(res, 200, { ok: true, bannedIp, bannedDevice });
    return true;
  }
  if (path === '/api/admin/reviews/reject' && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const body = await readBody(req);
    const row = await db.finishAbuseReview(q, Number(body.id), { status: 'rejected', reviewedBy: user.id, note: body.note });
    if (!row) {
      json(res, 404, { error: '审核记录不存在' });
      return true;
    }
    json(res, 200, { ok: true });
    return true;
  }

  // CF 批（docs/ADMIN-UX-SECURITY.md §4）：单条审核四操作——临时封（10min/1h/1d）/
  // 永久封（黑名单）/ 信任（白名单）/ 忽略（保留记录）；全部审计 review.action。
  if (path === '/api/admin/reviews/act' && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const body = await readBody(req);
    const id = Number(body.id);
    const action = ['tempban', 'permban', 'trust', 'ignore'].includes(body.action) ? body.action : null;
    if (!Number.isFinite(id) || !action) {
      json(res, 400, { error: '参数不合法（action: tempban/permban/trust/ignore）' });
      return true;
    }
    const review = await db.getAbuseReview(q, id);
    if (!review || review.status !== 'pending') {
      json(res, 404, { error: '审核记录不存在或已处理' });
      return true;
    }
    if (!review.ip) {
      json(res, 400, { error: '该记录没有 IP，无法执行该操作' });
      return true;
    }
    let minutes = null;
    if (action === 'tempban') {
      minutes = [10, 60, 1440].includes(Number(body.minutes)) ? Number(body.minutes) : 0;
      if (!minutes) {
        json(res, 400, { error: '临时封时长必须是 10 / 60 / 1440 分钟' });
        return true;
      }
      const until = Date.now() + minutes * 60_000;
      await db.applyManualTempBan(q, { ip: review.ip, until });
      ratelimit.applyExternalBan(review.ip, until, { source: 'manual' });
    } else if (action === 'permban') {
      await banIpExclusive(review.ip, `审核永久封禁（${review.rule}）by ${user.username}`, 'ban');
    } else if (action === 'trust') {
      // 信任 = 白名单：加白移黑 + 清临时封禁 + 内存态同步（与 BJ/BR 批互斥口径一致）
      await db.trustIpDb(q, {
        ip: review.ip,
        note: `审核信任（${review.rule}）by ${user.username}`,
      });
      ratelimit.addWhitelist(review.ip);
      autoBan.addWhitelist(review.ip);
      ratelimit.clearBanMemory(review.ip);
      await visitors.refreshBlocklist(q).catch(() => {});
    }
    await db.finishAbuseReview(q, id, {
      status: action === 'ignore' ? 'rejected' : 'approved',
      reviewedBy: user.id,
      note: action === 'ignore' ? (body.note || '忽略') : body.note,
    });
    logger?.info('review.action', {
      id,
      ip: review.ip,
      action,
      minutes,
      by: user.username,
      reason: body.note ?? null,
    });
    json(res, 200, { ok: true, action, minutes });
    return true;
  }

  return false;
}
