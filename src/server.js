// Web 服务：静态页 + JSON API。
//
// 权限模型（对应"前台免登录可看、后台才能改"）：
//   GET  /api/*           匿名可读
//   POST /api/login       匿名
//   POST /api/prefs       需要登录（只影响自己的展示）
//   POST /api/games/:appid/interest   需要管理员
//   GET  /api/admin/*     需要管理员
//
// 折扣数据永远只由调度器写入，这里没有任何改价的接口——这是硬约束。
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { join, extname, resolve, sep } from 'node:path';
import * as db from './store/pg.js';
import { createConcurrencyGate } from './http-guard.js';
import * as visitors from './visitors.js';
import * as images from './images.js';
import * as ratelimit from './ratelimit.js';
import * as guard from './guard.js';
import * as autoBan from './auto-ban.js';
import * as devices from './devices.js';
import * as captcha from './captcha.js';
import * as settings from './settings.js';
import { baseRegion } from './sync-regions.js';
import { handleSetupRoutes } from './setup-routes.js';
import { sessionCookie } from './session-cookie.js';
import { createAlignCompute } from './align-compute.js';
import { ensureAlignSnapshot, alignSnapshotMaxAgeMs } from './align-snapshot.js';
import { handleSettingsRoutes } from './settings-routes.js';
import { appealEmailFrom } from './appeal.js';
import { ensureSteamSchemaOnce } from './steam-login.js';
import * as notify from './notify.js';
import { buildPushHits, renderDigest, toPayload } from './alerts.js';
import { ipSessionKey, uaSessionKey } from './session-fingerprint.js';
import { yuanAmount } from './format.js';
import * as appRateLimit from './app-ratelimit.js';
// CO-4/B4（docs/DESIGN-AUDIT.md B4）：App 域路由已抽到 src/routes/app.js——
// handleAppPreflight 在拦截链之前（封禁自查），handleAppRoutes 在认证上下文就绪后（主段）。
// 拆分模式与后续域步骤见 docs/ARCHITECTURE.md「域路由拆分模式」。
import { handleAppPreflight, handleAppRoutes } from './routes/app.js';
// CO-4/B4 第二轮：申诉域路由已抽到 src/routes/appeal.js——
// handleAppealPublic 在认证上下文解析之前（公开段，保住 must_change_password 用户的申诉入口），
// handleAppealAdmin 在 requireAdmin 就绪之后（管理段）。拦截链豁免（appealExempt）仍是中间件、留在本文件。
import { handleAppealPublic, handleAppealAdmin } from './routes/appeal.js';
// CO-5/B4-2 第三轮：认证域路由已抽到 src/routes/auth.js——
// handleAuthPublic 在认证上下文解析之前（公开段，保住 must_change_password 用户的设备注册），
// handleAuthRoutes 在认证上下文就绪后（主段）。拦截链豁免（appealExempt）、must_change_password
// 白名单、loginIpFails/bindStates 共享状态仍是中间件、留在本文件。
import { handleAuthPublic, handleAuthRoutes } from './routes/auth.js';
// CO-5/B4-2 第四轮：watchlist/wishlist 域用户段路由已抽到 src/routes/watchlist.js——
// handleWatchlistRoutes 在认证上下文就绪后（主段）。用户级写限流计数 Map（watchUserFails）
// 只被本域使用、随域移入模块（与认证域 passwordCheckHits 同先例）；/api/admin/watchlist*、
// /api/admin/wishlists 属管理段（B4 队列 #16 后续轮次），留在本文件。
import { handleWatchlistRoutes } from './routes/watchlist.js';
// CO-5/B4-2 第五轮：公告域路由已抽到 src/routes/announcements.js——
// handleAnnouncementsPublic 在认证上下文解析之前（公开段，游客与待改密用户也要能读到公告）、
// handleAnnouncementsRoutes 在认证上下文就绪后（主段，已读写表）、handleAnnouncementsAdmin
// 在 requireAdmin 就绪之后（管理段 CRUD）。resolveSession 闭包留在本文件（与 adminBypass /
// 主 user 三处共享同一请求级 promise），按引用传入公开段（语义共享）。
import { handleAnnouncementsPublic, handleAnnouncementsRoutes, handleAnnouncementsAdmin } from './routes/announcements.js';
// CO-5/B4-2 第六轮：me 域路由已抽到 src/routes/me.js——
// handleMeRoutes 在认证上下文就绪后（主段）。must_change_password 白名单
// （p === '/api/me'、p.startsWith('/api/avatar/')）仍是中间件、留在本文件；
// /api/me/email/* 留在 src/auth-routes.js（与 /api/auth/email* 同模块，DT-2 排除区）。
import { handleMeRoutes } from './routes/me.js';
// CO-5/B4-2 第七轮：site 域（B4 #7 杂项）路由已抽到 src/routes/site.js——
// handleSitePreflight 在拦截链之前（/api/ban/state 封禁自查，原位置语义）、
// handleSitePublic 在认证上下文解析之前（/api/site，原位置语义）、handleSiteRoutes
// 在认证上下文就绪后的主段（/api/steam/* Steam 账号管理）。banState 限流桶随域移入模块
// （只被本域使用）；siteName/appealEmail 宿主闭包经 ctx 按引用传入（语义共享）；
// /api/admin/wishlists（B4 #16）留本文件。
import { handleSitePreflight, handleSitePublic, handleSiteRoutes } from './routes/site.js';
// CO-5/B4-2 第八轮：admin-access 域（B4 #8 后台访问安全：views/visitors/blacklist/
// whitelist/abuse/devices/reviews）路由已抽到 src/routes/admin-access.js——
// handleAdminAccessAdmin 在 requireAdmin 就绪之后的管理段（本域全部 20 条路由，
// 管理段形态先例=申诉域）。banIpExclusive 宿主闭包经 ctx 按引用传入（语义共享：
// 与 #11 /api/admin/bulk 批量封禁/信任共用同一 banIpExclusiveSql 互斥口径）；
// 封禁拦截链/黑名单加载/限流计数等中间件仍是本文件职责（§15.4）；
// /api/admin/users|images|reports 等其它 admin 域路由（B4 #11/#13/#12）留本文件。
import { handleAdminAccessAdmin } from './routes/admin-access.js';
// CO-5/B4-2 第九轮：admin-sync 域（B4 #9 后台手动同步任务：sync/heat/backfill/
// rename/circuit）路由已抽到 src/routes/admin-sync.js——handleAdminSyncAdmin 在
// requireAdmin 就绪之后的管理段（本域全部 13 条路由）。startSteamJob 宿主闭包、
// syncState 进程级状态持有对象、syncStatusCache/invalidateSyncStatusCache 短缓存
// 按引用传入（语义共享：任务启停与状态轮询跨请求共享同一子进程槽位）；
// isLoggablePath 的 sync/status|runs 访问日志豁免仍是中间件、留本文件；
// /api/admin/wishlists（B4 #16）、
// /api/admin/bulk 派发表（B4 #11）等其它 admin 域路由留本文件。
import { handleAdminSyncAdmin } from './routes/admin-sync.js';
// CO-5/B4-2 第十轮：admin-settings 域（B4 #10 后台系统设置：smtp/mail/emails/proxies/
// version）路由已抽到 src/routes/admin-settings.js——handleAdminSettingsAdmin 在
// requireAdmin 就绪之后的管理段（本域全部 11 条路由，管理段形态先例=admin-access 域）。
// 调用位置不能动：取本域最早路由 /api/admin/version 的原位置（admin-sync 接线之前）。
// appealEmail 宿主闭包、store（createApiServer 参数，settings.hydrateSettings 需要真实
// pg store 实例）经 ctx 按引用传入（语义共享，勿改成拷贝）；测试邮件冷却计数只被本域
// 使用，随域移入模块级（先例：watchlist 域 watchUserFails）；/api/admin/settings*
// （settings-routes.js 独立模块）与 /api/admin/users 邮件绑定等其它 admin 域路由留本文件。
import { handleAdminSettingsAdmin } from './routes/admin-settings.js';
// CO-5/B4-2 第十一轮：admin-sessions 域（B4 #14 后台会话：列表/单条踢下线）路由已抽到
// src/routes/admin-sessions.js——handleAdminSessionsAdmin 在 requireAdmin 就绪之后的管理段
// （本域 2 条路由，管理段形态先例=admin-settings 域）。调用位置不能动：取本域最早路由
// /api/admin/sessions 的原位置（auth 主段接线之前）。token 经 ctx 传入（列表 current
// 标记与踢下线审计用，只读）；/api/admin/users/:name/sessions（kickAll，B4 #11 users 区）
// 与 /api/user/sessions/revoke-others（前台主段）留本文件；bulk 派发表 sessions/kick
// 条目（B4 #11）留本文件。
import { handleAdminSessionsAdmin } from './routes/admin-sessions.js';
// CO-5/B4-2 第十四轮：admin-align 域（B4 #17 后台对齐审核：/api/admin/align*）路由已抽到
// src/routes/admin-align.js——handleAdminAlignAdmin 在 requireAdmin 就绪之后的管理段
// （本域全部 8 组路由，管理段形态先例=admin-settings 域）。调用位置不能动：取本域最早路由
// /api/admin/align 的原位置（公告管理段接线之后、bulk 之前）。triggerAlignGeneration 宿主
// 闭包（后台生成 single-flight 链式排队）与 runGated 宿主闭包（并发闸 Map）经 ctx 按引用
// 传入（语义共享，勿改成拷贝）；store（createApiServer 参数，本域事务走 store.tx）经 ctx
// 传入；computeAlignGroups/ensureAlignSnapshot/alignSnapshotMaxAgeMs 供 triggerAlignGeneration
// 使用留本文件；/api/admin/bulk 派发表无 align 条目（本域不涉 bulk）。
import { handleAdminAlignAdmin } from './routes/admin-align.js';
// CO-5/B4-2 第十六轮（docs/DESIGN-AUDIT.md B4）：admin-users 域（B4 #11：后台用户批量
// /api/admin/users*、bulk、bulk-ops + DT-4 后台重置密码发码）路由已抽到 src/routes/admin-users.js——
// handleAdminUsersAdmin 在 requireAdmin 就绪之后的管理段（kickAll 原位置）。banIpExclusive
// 宿主闭包（与 admin-access 域共用）、invalidateAdminGamesCache/invalidateListCache 宿主短缓存、
// appealEmail 宿主闭包经 ctx 按引用传入（语义共享，勿改成拷贝）；BULK_KEY_ERROR/BULK_ACTIONS
// 白名单派发表与全部 bulk helper 只被本域使用、随域移入模块。
// /api/admin/games*（B4 #15）、/api/admin/images*（B4 #13）、admin 报表/备份/日志（B4 #12）、
// /api/user/sessions/revoke-others（前台主段）留本文件；banIpExclusiveSql 跨域共用（admin-access
// 域单条封禁/信任）留本文件。
import { handleAdminUsersAdmin } from './routes/admin-users.js';
// CO-5/B4-2 第十五轮（docs/DESIGN-AUDIT.md B4）：games 域（B4 #21：公开 /api/games/*）路由已抽到
// src/routes/games.js——handleGamesRoutes 在认证上下文（user/requireUser/requireAdmin）就绪后的
// 主段（调用位置不能动：取本域最早路由 /api/games/for-you 的原位置，handleAuthRoutes 之后、
// handleMeRoutes 之前）。runGated（并发闸 Map）/listCache/invalidateListCache（DX 批前台列表缓存）/
// invalidateAdminGamesCache（#15 admin games 短缓存）/gameCountCache（60s count 缓存对象）/
// maybeFillDlcOnRead（DLC 读路径回源节流）/dlcReadThrottleMs/dlcFetchImpl 经 ctx 按引用传入
// （语义共享，勿改成拷贝）；forYouCache/historyCsvEnabled 只被本域使用、随域移入模块。
// /api/admin/games*（列表/stats/merge/links/deleted）已随 B4 #15 拆到 routes/admin-games.js、
// /api/behavior 留本文件；
// isLoggablePath 的 /api/games/stamp 与 /api/games/search 访问记录豁免仍是中间件、留本文件。
import { handleGamesRoutes } from './routes/games.js';
// CO-5/B4-2 第十五轮：admin-reports 域（B4 #12 后台报表/备份/日志：reports/backup/backups/logs/
// steam-logs）路由已抽到 src/routes/admin-reports.js——handleAdminReportsAdmin 在 requireAdmin
// 就绪之后的管理段（本域全部 6 条路由，管理段形态先例=admin-settings 域）。调用位置不能动：
// 取本域最早路由 /api/admin/backups 的原位置（admin-settings 接线之后）。本域无跨模块共享的
// 可变状态，ctx 只需基座字段；SQL 全部跨模块共用零搬家（priceChanges 等留 pg.js、listSteamLogs
// 留 steam-log.js、createBackup/listBackups 留 backup.js，判定见 admin-reports-repository.js）。
// isTimeoutExemptPath 的 '/api/admin/backup' 超时豁免仍是中间件、留本文件（§15.4）。
import { handleAdminReportsAdmin } from './routes/admin-reports.js';
// CO-5/B4-2 第十六轮：admin-images 域（B4 #13 后台图片：/api/admin/images）路由已抽到
// src/routes/admin-images.js——handleAdminImagesAdmin 在 requireAdmin 就绪之后的管理段
// （本域全部 4 条路由，管理段形态先例=admin-settings 域）。调用位置不能动：取本域最早路由
// /api/admin/images 的原位置（DT-3 users POST 之后）。imgMissCache（负缓存 Map，/img/ 代理
// 路由写、本域读/清空）、startSteamJob（同步子进程槽位 single-flight，与 admin-sync 域共用）、
// startSteamJobImpl（EC 批测试注入替身）经 ctx 按引用传入（语义共享，勿改成拷贝）；
// images.js 是共享业务模块（/img/ 代理与 cli/ops.js images 命令也走），保留 import 不动。
import { handleAdminImagesAdmin } from './routes/admin-images.js';
// CO-5/B4-2 第十七轮：admin-games 域（B4 #15 后台游戏目录：/api/admin/games* 管理段）路由已
// 抽到 src/routes/admin-games.js——handleAdminGamesAdmin 在 requireAdmin 就绪之后的管理段
// （本域全部 5 条路由，管理段形态先例=admin-settings 域）。调用位置不能动：取本域最早路由
// /api/admin/games/stats 的原位置（wishlists 段之后）。runGated（并发闸 Map，'GET
// /api/admin/games' 键在 HEAVY_GATE_CONFIG 留本文件）、adminGamesCache（B2 短缓存对象）、
// invalidateAdminGamesCache（本域 merge 与 #21 域删除/屏蔽/说明、bulk 共用失效闭包）、
// invalidateListCache（DX 批前台缓存）、adminCacheTtlMs 经 ctx 按引用/值传入（语义共享，
// 勿改成拷贝）；/api/games/* 公开区已随 B4 #21 拆到 routes/games.js，本域不碰。
import { handleAdminGamesAdmin } from './routes/admin-games.js';
// DX 批（docs/SEARCH-FIX-PERF.md §DX）：前台列表/搜索短 TTL 内存缓存（纯逻辑，测试锁语义）。
import { createListCache } from './search-cache.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  // BS 批（docs/MOBILE-APP-TWA.md §5）：安卓安装包（站点 /app 下载页）
  '.apk': 'application/vnd.android.package-archive',
};

const COOKIE = 'gp_session';
const DEVICE_COOKIE = 'gp_device';

// BK 批（docs/SESSION-MANAGEMENT.md §3.2）：last_seen_at 写节流——同一 token 5 分钟最多写一次（内存态）
const sessionSeenAt = new Map();
// CA-1：Bearer Token 的 last_used_at 5 分钟节流写（与 sessionSeenAt 同款内存节流）
const apiTokenSeenAt = new Map();
// CH 批：行为上报每用户 60 次/分限流（/api/behavior 留本文件；for-you 缓存已随 games 域抽到 routes/games.js）
const behaviorBuckets = new Map();// AK-2（docs/AUTH-REDESIGN.md §4.3）：登录 IP 限速（同 IP 15 分钟失败 ≥20 次 → 429，内存计数、重启清零）
const loginIpFails = new Map(); // ip -> { count, windowStart }

/** 测试用：清零登录 IP 限速计数（模块级 Map 跨测试共享）。 */
export function resetLoginThrottleForTest() {
  loginIpFails.clear();
}

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** 是不是浏览器在请求页面（用于决定返回 JSON 还是封禁提示页）。 */
const wantsHtml = (req) =>
  /text\/html/i.test(String(req.headers.accept ?? '')) && !String(req.url ?? '').startsWith('/api/');

/**
 * 手机 UA 判定（CP 批，docs/MOBILE-DETECT-FIX.md §2 决策 1/§3）——三信号：
 * ① UA 移动特征（mobile/iphone/ipod/windows phone + 国产浏览器品牌）；
 * ② 客户端提示 Sec-CH-UA-Mobile: ?1；
 * ③ 前端 index.html 的 screen.width 兜底（服务端不可见，由内联脚本承担）。
 * 国产浏览器「桌面版网站」模式把 UA 伪装成桌面串（小米 = X11; Linux x86_64 + MiuiBrowser），
 * 品牌特征优先于桌面特征：桌面 UA 上带品牌仍判手机；纯桌面 UA（Windows NT/Macintosh/X11 Linux
 * 且只有泛化 mobile 字样、无移动品牌）排除，避免误跳。
 */
const MOBILE_UA_RE = /mobile|android.+mobile|iphone|ipod|windows phone|miuibrowser|huaweibrowser|vivobrowser|heytapbrowser|oppobrowser/i;
const MOBILE_BRAND_RE = /iphone|ipod|windows phone|android|miuibrowser|huaweibrowser|vivobrowser|heytapbrowser|oppobrowser/i;
const DESKTOP_UA_RE = /windows nt|macintosh|x11; linux/i;

/** 命中信号：'client_hint' | 'ua' | null（跳转日志记录命中来源，排查"某端不生效"用）。 */
export function mobileHitSignal(req) {
  const ua = String(req.headers['user-agent'] ?? '');
  if (String(req.headers['sec-ch-ua-mobile'] ?? '') === '?1') return 'client_hint';
  if (!MOBILE_UA_RE.test(ua)) return null;
  if (DESKTOP_UA_RE.test(ua) && !MOBILE_BRAND_RE.test(ua)) return null;
  return 'ua';
}

/** 手机 UA 粗判（跳转与日志用）。 */
const isMobileUa = (req) => mobileHitSignal(req) !== null;

/**
 * B1 批（docs/DESIGN-AUDIT.md B1）：统一请求超时（默认 15s）的白名单豁免——
 * 长连接/长任务路径不套看门狗：静态资源、图片代理、APK 下载、静态曲线页、CSV 导出、手动备份。
 * 白名单范围是交付时需所有者确认的点之一。
 */
export function isTimeoutExemptPath(path) {
  if (/\.(png|jpe?g|gif|webp|svg|ico|css|js|map|woff2?|ttf|otf|eot|json|xml|txt|md|apk|wasm|webmanifest)$/i.test(path)) return true;
  if (path.startsWith('/img/') || path.startsWith('/app/dl/') || path.startsWith('/out/')) return true;
  if (/\.csv$/.test(path)) return true;
  if (path === '/api/admin/backup') return true;
  // DR 批（docs/APP-INSTANT-UPDATE.md §3.1）：手动 App 同步要下载 APK（数十 MB），不套 15s 看门狗；
  // 并发与排队已由 single-flight + GitHub 超时保护。
  if (path === '/api/admin/app-sync') return true;
  return false;
}

/**
 * B1 批（docs/DESIGN-AUDIT.md B1）：重型接口并发闸配置——
 * key = 运行时闸门键（`GET /api/admin/games`、`GET /api/admin/align`、`games-search`）；
 * 值 = 最大并发数。/api/games 的 GET 列表与 POST 搜索共用 `games-search` 一把闸（≤2），
 * 避免两路由各自计数造成合计并发翻倍。这些接口要么全表重查询、要么触发重计算，
 * 单接口并发 ≤1–2；排队超限/超时 503，日志可观测。
 */
export const HEAVY_GATE_CONFIG = {
  'GET /api/admin/games': 1,
  'GET /api/admin/align': 1,
  // GET /api/games 与 POST /api/games/search 共用这把闸（路由处 runGated('games-search', …)）
  'games-search': 2,
};

/**
 * CO-4/B4（docs/DESIGN-AUDIT.md B4）：/api/app/latest 的 apkPath 派生已随 App 域抽到
 * src/app-release.js（appApkPathFor，签名不变）；本文件的调用点已移入 src/routes/app.js。
 */

// 仅被封禁者可见的页面：未封禁访问一律 302 回首页（docs/BAN-AND-SECURITY-FIXES.md §3）。
// 以后新增同类页面必须登记进这里——测试会遍历它，漏登记直接红。
export const BAN_ONLY_PAGES = new Set(['/banned', '/banned/', '/banned.html']);

// 申诉编号：crypto 随机 + 去易混字符（0/O/1/I），保留 AP- 前缀（docs/URL-PARAM-PRIVACY.md §5/§6.1）。
// 4 字节 32 bit → 取 30 bit 按 5 bit 一组映射到 32 字符表 → 恰好 6 位。
const APPEAL_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newAppealCode() {
  const buf = randomBytes(4);
  let bits = (((buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3]) >>> 0);
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += APPEAL_CODE_ALPHABET[bits & 31];
    bits >>>= 5;
  }
  return `AP-${code}`;
}

// 说明：BQ 邮件动作 token（newActionToken）、封禁原因文案（appealBanReasonLabel）、
// 管理员申诉行视图（appealRowPublic）已随 CO-4/B4 第二轮移入 src/routes/appeal.js；
// newAppealCode 因 serveBanPage 仍使用、且被 test/appeal-security.test.js 导入，保留在本文件。
// /api/ban/state 的自带限流桶（banStateBuckets/banStateLimited）已随 CO-5/B4-2 第七轮
// 移入 src/routes/site.js（只被本域使用，watchlist 域 watchUserFails 同先例）。

// 申诉接口自带限流（docs/APPEAL-SYSTEM.md §7 / §10.3）：内存桶 + 库内双保险。
// 提交每 IP 3 次/小时；编号查询每 IP 20 次/分钟；BQ 动作每 IP 10 次/分钟。
const appealBuckets = new Map(); // ip -> { submit:number[], query:number[], action:number[] }
export function appealBucketLimited(ip, kind, max, windowMs) {
  if (!ip) return false;
  const key = String(ip);
  if (appealBuckets.size > 20_000) appealBuckets.clear();
  const now = Date.now();
  const rec = appealBuckets.get(key) ?? { submit: [], query: [], action: [] };
  const list = (rec[kind] ?? []).filter((t) => now - t < windowMs);
  if (list.length >= max) {
    rec[kind] = list;
    appealBuckets.set(key, rec);
    return true;
  }
  list.push(now);
  rec[kind] = list;
  appealBuckets.set(key, rec);
  return false;
}

/** 测试用：清空申诉限流内存桶（与 ratelimit.resetState 同一先例）。 */
export function resetAppealBuckets() {
  appealBuckets.clear();
}

// DF 批（docs/ALERT-MANUAL-PUSH.md §3）：手动推送 5 分钟频控——同一条（w:<id>）/同一批（b:<ids 排序连接>）
// 重复推送 → 429 { retryAfterSec }。内存窗口、重启清零（与申诉限流同款设计，防误触/刷屏）。
const alertPushBuckets = new Map(); // key -> number[]（首次推送时间戳）
export const ALERT_PUSH_WINDOW_MS = 5 * 60_000;
/** 未超限返回 null；超限返回首次推送的时间戳（调用方据此算 retryAfterSec）。 */
export function alertPushLimited(key) {
  if (alertPushBuckets.size > 5000) alertPushBuckets.clear();
  const now = Date.now();
  const list = (alertPushBuckets.get(key) ?? []).filter((t) => now - t < ALERT_PUSH_WINDOW_MS);
  if (list.length) {
    alertPushBuckets.set(key, list);
    return list[0];
  }
  list.push(now);
  alertPushBuckets.set(key, list);
  return null;
}

/** 测试用：清空手动推送频控桶。 */
export function resetAlertPushBuckets() {
  alertPushBuckets.clear();
}

const bannedTplCache = new Map();
function bannedTemplate(outDir) {
  const file = resolve(outDir ?? 'web', 'banned.html');
  if (bannedTplCache.has(file)) return bannedTplCache.get(file);
  let html;
  try {
    html = readFileSync(file, 'utf8');
  } catch {
    html = '<!doctype html><meta charset="utf-8"><title>Access denied</title><h1>Access denied</h1>';
  }
  bannedTplCache.set(file, html);
  return html;
}

/** 封禁提示页：多语言在前端按 navigator.language 选，这里只注入站点名/申诉邮箱/到期时间/申诉编号/剩余秒数/脱敏 IP（BR 批 §11.4）。 */
function serveBanPage(res, outDir, { status = 403, until = null, reason = '', siteName = 'SteamDeals', appealEmail = '', remainingSec = null, ipMasked = null } = {}, frontendDir = null) {
  const code = newAppealCode();
  const untilIso = until ? new Date(until).toISOString() : '';
  const distIndex = frontendDir && resolve(frontendDir, 'index.html');
  let html;
  if (distIndex && existsSync(distIndex)) {
    const payload = JSON.stringify({ status, until: untilIso, reason, site: siteName, email: appealEmail, code, remainingSec, ipMasked }).replace(/</g, '\\u003c');
    // 最终方案（docs/FRONTEND-RENDER-FIX.md §2）：必须在模块脚本加载前改地址——
    // main.js 里 router.replace 无效（ES module 提升导致 createWebHistory 已按旧地址初始化）。
    const script =
      `window.__BAN_PAGE__=${payload};` +
      `if(location.pathname!=='/banned'&&location.pathname!=='/appeal'){history.replaceState(null,'','/banned');}`;
    html = readFileSync(distIndex, 'utf8').replace('</head>', `<script>${script}</script></head>`);
  } else {
    html = bannedTemplate(outDir)
      .replaceAll('__SITE_NAME__', escapeHtml(siteName))
      .replaceAll('__APPEAL_EMAIL__', escapeHtml(appealEmail))
      .replaceAll('__UNTIL__', untilIso)
      .replaceAll('__REASON__', escapeHtml(reason))
      .replaceAll('__CODE__', code);
  }
  const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' };
  if (until) headers['retry-after'] = String(Math.max(1, Math.ceil((Number(until) - Date.now()) / 1000)));
  res.writeHead(status, headers);
  res.end(html);
  return code;
}

/**
 * 申诉页：仅被封禁者可见，站点信息注入 `window.__APPEAL__`（URL 只带 code，见 URL-PARAM-PRIVACY.md §4.2）。
 * 无 frontend/dist 时返回 false，调用方回落到原静态路径（保持无构建产物时的旧行为）。
 */
function serveAppealPage(res, outDir, frontendDir, { site, email, code }) {
  const distIndex = frontendDir && resolve(frontendDir, 'index.html');
  if (!distIndex || !existsSync(distIndex)) return false;
  const payload = JSON.stringify({ site, email, code }).replace(/</g, '\\u003c');
  const script = `window.__APPEAL__=${payload};`;
  const html = readFileSync(distIndex, 'utf8').replace('</head>', `<script>${script}</script></head>`);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
  return true;
}

// 封面图内存热缓存：数据库是持久层，这里只放最近访问的少量图片（LRU，约 300 张）
const imgMemCache = new Map(); // appid/size -> { contentType, body }
const IMG_MEM_MAX = 300;
// 取图失败缓存：5 分钟内不再重试，避免每次都拖满超时
// AW 批（docs/IMAGE-FETCH.md §3.2/§3.3）：负缓存分层（404 永久性 24h，网络类 10min）；
// header_image 直链白名单：只认 https + .steamstatic.com，防 SSRF。
// TTL 是模块常量，供测试断言；实例缓存挂在每个 createApiServer 闭包里（多实例隔离）。
export const IMG_MISS_TTL = { notfound: 24 * 3600 * 1000, error: 10 * 60 * 1000 };

/** header_image 直链安全校验：https 且 host 为 steamstatic.com 或其子域。 */
export function isAllowedSteamImageUrl(u) {
  try {
    const p = new URL(String(u));
    if (p.protocol !== 'https:') return false;
    return p.hostname === 'steamstatic.com' || p.hostname.endsWith('.steamstatic.com');
  } catch {
    return false;
  }
}

function memoGetImage(key) {
  const hit = imgMemCache.get(key);
  if (!hit) return null;
  imgMemCache.delete(key);
  imgMemCache.set(key, hit); // 移到队尾（最近使用）
  return hit;
}
function memoPutImage(key, entry) {
  imgMemCache.set(key, entry);
  if (imgMemCache.size > IMG_MEM_MAX) imgMemCache.delete(imgMemCache.keys().next().value);
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const json = (res, status, body, headers = {}) => {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(text);
};

const readBody = (req, limit = 64 * 1024) =>
  new Promise((done, fail) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        fail(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return done({});
      try {
        done(JSON.parse(raw));
      } catch {
        fail(new Error('invalid json'));
      }
    });
    req.on('error', fail);
  });

/** 排序：折扣力度 / 金额 / 游戏名，默认折扣。 */
export function sortGames(rows, sort = 'discount') {
  const copy = [...rows];
  if (sort === 'price') {
    copy.sort((a, b) => (a.current_low ?? Infinity) - (b.current_low ?? Infinity));
  } else if (sort === 'name') {
    copy.sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), 'zh-Hans-CN'));
  } else {
    copy.sort((a, b) => (b.discount ?? 0) - (a.discount ?? 0) || (a.current_low ?? Infinity) - (b.current_low ?? Infinity));
  }
  return copy;
}
/**
 * 创建 API 服务。
 * query: (sql, params) => Promise<{rows}>
 */
export function createApiServer({
  query,
  logger = null,
  outDir = null,
  frontendDir = null,
  store = null,
  setupToken = '',
  getSetupState = null,
  imageFetch = null, // 测试注入：() => { body, bytes, contentType }；默认用 http.js 的 fetchBuffer
  steamVerify = null, // 测试注入：verifyCallback 的替身 (url, opts) => Promise<steamId|null>；默认走 Steam OpenID 校验
  imgMissTtl = IMG_MISS_TTL, // 测试注入：负缓存 TTL 覆盖（避免等 24h）
  dlcFetchImpl = null, // BP 批测试注入：(appids, opts) => Promise<{items,failed}>；默认走 store-browse 的 fetchStoreItems
  dlcReadThrottleMs = 10 * 60_000, // BP 批测试注入：读路径回源的按游戏节流窗口（默认 10 分钟）
  requestTimeoutMs = 15000, // B1 批测试注入：统一请求超时（白名单豁免见 isTimeoutExemptPath）
  gateWaitMs = 15000, // B1 批测试注入：并发闸排队等待上限
  gateMaxQueue = 20, // B1 批测试注入：并发闸队列长度上限（超出立即 503）
  adminCacheTtlMs = 3000, // B2 批测试注入：/api/admin/games 短缓存 TTL
  syncStatusTtlMs = 3000, // B2 批测试注入：/api/admin/sync/status 短缓存 TTL
  listCacheTtlMs = 45000, // DX 批测试注入：前台列表/搜索短缓存 TTL（规格 30–60s）
  siteCacheTtlMs = 60000, // DX 批测试注入：/api/site 短缓存 TTL（规格 60s）
  appSyncFetchImpl = null, // DR 批测试注入：POST /api/admin/app-sync 的 GitHub fetch 替身（默认真实 fetch）
  appSyncDir = null, // DR 批测试注入：app-sync 落盘目录（默认 env APP_DATA_DIR ?? data/app）
  startSteamJobImpl = null, // EC 批测试注入：POST /api/admin/images/backfill 的启动替身（默认宿主闭包 startSteamJob）
}) {
  const q = query;
  // B1 批（docs/DESIGN-AUDIT.md B1）：重型接口并发闸——按 key 每实例一把闸，
  // 排队超限/超时抛 GATE_BUSY / GATE_WAIT_TIMEOUT，路由层转 503。
  const gates = new Map();
  const gateFor = (key, max) => {
    let g = gates.get(key);
    if (!g) {
      g = createConcurrencyGate({ max, maxQueue: gateMaxQueue, waitMs: gateWaitMs });
      gates.set(key, g);
    }
    return g;
  };
  const runGated = async (key, max, fn, respond503) => {
    try {
      return await gateFor(key, max).run(fn);
    } catch (err) {
      if (err?.code === 'GATE_BUSY') {
        logger?.warn('http.gate_rejected', { key, queue: gateMaxQueue });
        return respond503('接口繁忙，请稍后再试');
      }
      if (err?.code === 'GATE_WAIT_TIMEOUT') {
        logger?.warn('http.gate_wait_timeout', { key, waitMs: gateWaitMs });
        return respond503('接口排队超时，请稍后再试');
      }
      throw err;
    }
  };
  // BP 批（docs/GAME-DLC.md §3.3）：读路径回源节流——按 steam_appid 记上次回源时间（进程内，
  // 重启会重置；与"打开详情"这种瞬时行为对齐，不需要持久化）。
  const dlcFillAttempts = new Map(); // appid -> lastAttemptMs
  // 读路径回源（决策 6）：缺明细且距上次 >10 分钟才触发，最多 3 批 GetItems、超时 5s；
  // 失败/429 静默降级（列表照常返回，synced:false）。先记节流时间再拉——失败 10 分钟内也不重试。
  const maybeFillDlcOnRead = async ({ gameId, appid, throttleMs = 10 * 60_000, fetchImpl = null }) => {
    const missing = await db.countDlcMissing(q, { gameId });
    if (!missing) return { attempted: false };
    const now = Date.now();
    const last = dlcFillAttempts.get(appid) ?? 0;
    if (now - last < throttleMs) return { attempted: false };
    dlcFillAttempts.set(appid, now);
    const { fillDlcDetails } = await import('./dlc-fill.js');
    const res = await fillDlcDetails(q, { gameIds: [gameId], maxBatches: 3, timeoutMs: 5000, fetchImpl, logger });
    if (res.dlcs > 0) logger?.info?.('steam.dlc.read_fill', { appid, dlcs: res.dlcs, batches: res.batches });
    return { attempted: true, ...res };
  };
  // AW 批（docs/READ-MODEL.md §5.2）/ AY 批（§10）：/api/games/count 的 priced + catalog 计数
  // 60 秒进程内缓存（原只缓存 priced，catalog 每次全表扫 198k 行 ≈76ms）。
  // 挂在每个服务实例闭包里（单实例；多副本各自缓存，数值偏差可接受）。
  const gameCountCache = { value: null, at: 0 };
  // B2 批（docs/DESIGN-AUDIT.md B2）：admin 列表接口短缓存（TTL 3s，游戏写操作后立即失效）——
  // 控制台翻页/切筛选在 3 秒内的重复请求直接命中，不再重跑 2.1s 重查询；契约与缓存未命中时完全一致。
  // sync/status 同理（8s 轮询下相邻请求有收益；任务启停/熔断重置后立即失效，状态延迟 ≤3s）。
  const adminGamesCache = { value: null, key: null, at: 0 };
  const syncStatusCache = { value: null, at: 0 };
  const invalidateAdminGamesCache = () => {
    adminGamesCache.value = null;
    adminGamesCache.key = null;
    adminGamesCache.at = 0;
  };
  const invalidateSyncStatusCache = () => {
    syncStatusCache.value = null;
    syncStatusCache.at = 0;
  };
  // DX 批（docs/SEARCH-FIX-PERF.md §DX）：前台列表/搜索与 /api/site 的短缓存状态——
  // 按服务实例隔离（与 adminGamesCache 同先例，测试多实例互不干扰）。
  // listCache 的失效三路：TTL / 进程内主动 invalidate（admin 写操作、手动同步子进程结束、
  // 用户标记变更）/ 数据世代 gen 不匹配（调度器跨进程同步，见 db.dataGen）。
  // siteCache 的失效：设置保存（afterHydrate）/ SMTP 保存时主动失效 + TTL 兜底；重启自然清空。
  const listCache = createListCache({ ttlMs: listCacheTtlMs });
  const siteCache = { value: null, at: 0 };
  const invalidateListCache = () => listCache.invalidate();
  const invalidateSiteCache = () => {
    siteCache.value = null;
    siteCache.at = 0;
  };
  // AW 批（docs/IMAGE-FETCH.md §3.2）：图片负缓存也按实例隔离（测试多实例互不干扰）。
  const imgMissCache = new Map(); // appid/size -> { at, kind }
  // 手动同步的进程内状态：同一时刻只允许一个同步任务。
  // CO-5/B4-2 第九轮：状态持有对象按引用传给 src/routes/admin-sync.js（语义共享）——
  // startSteamJob 闭包在宿主、路由在域模块，两边必须读写同一份状态，勿改成拷贝。
  const syncState = {
    child: null,
    run: null, // { id, mode, startedAt, params }
    output: '', // 子进程输出尾巴，供前端轮询
    settled: true,
    stopRequested: false, // 后台点了"停止"，子进程退出后记为 cancelled
  };
  // DR 批（docs/APP-INSTANT-UPDATE.md §3.1）：App 手动同步 single-flight——并发请求共享同一 Promise，
  // GitHub 只被请求一轮（验收 §4.1「并发两次只跑一次」）。
  // CO-4/B4：状态持有对象按引用传给 src/routes/app.js（该域路由读写 appSync.inFlight）。
  const appSync = { inFlight: null };

  // Steam 绑定 state 的进程内登记表：随机串 → { userId, expiresAt }，5 分钟过期。
  // 必须放在请求处理器之外：/start 签发、/callback 消费，跨两次请求共享（steam-login.js 实现）。
  const bindStates = new Map();

  /**
   * 启动一个 Steam 子进程任务（同步 / 回填共用同一个槽位，保证同一时间只有一个任务）。
   * 记录到 sync_runs，输出尾巴供前端轮询；返回 { runId, pid }。
   */
  async function startSteamJob({ mode, args, params = null, by = null }) {
    if (syncState.child) {
      const err = new Error('已有任务在运行（同步/回填），请等它结束');
      err.code = 'BUSY';
      err.run = syncState.run;
      throw err;
    }
    // 进程内没记录但库里有 running（服务重启残留）→ 先标失败，避免永远拒绝
    const stale = await db.runningSyncRun(q).catch(() => null);
    if (stale) await db.markStaleSyncRuns(q).catch(() => {});
    const run = await db.insertSyncRun(q, { mode, args: args.join(' ') });
    const { spawn } = await import('node:child_process');
    const fsMod = await import('node:fs');
    // SYNC_RUN_ID 让子进程复用这一条记录，避免重复建行
    const child = spawn(process.execPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        SYNC_RUN_ID: String(run.id),
        // 后台回填是长任务：Steam 持续返回 429 时由 http.js 逐步延长冷却并自动重试，
        // 让管理员点一次后可留在服务器上运行；手动同步仍使用有限重试。
        ...(mode === 'backfill' || mode === 'heat' ? { STEAM_429_RETRIES: 'Infinity' } : {}),
      },
    });
    syncState.child = child;
    syncState.run = { id: run.id, mode, args: args.join(' '), startedAt: run.startedAt, params };
    syncState.output = '';
    syncState.settled = false;
    syncState.stopRequested = false;
    const append = (chunk) => {
      syncState.output = (syncState.output + chunk).slice(-8000);
      try {
        fsMod.appendFileSync('logs/spawn.log', chunk);
      } catch {
        /* 日志目录不可写时忽略，DB 里仍有输出 */
      }
    };
    const finish = async (status, exitCode, note) => {
      if (syncState.settled) return;
      syncState.settled = true;
      syncState.child = null;
      if (syncState.stopRequested) status = 'cancelled';
      if (note) append('\n' + note);
      try {
        await db.finishSyncRun(q, run.id, { status, exitCode, output: syncState.output });
      } catch {
        /* 记录失败不影响主流程 */
      }
      // DX 批：手动同步/回填/heat/rename 子进程结束（无论成败）→ 前台列表缓存立即失效
      invalidateListCache();
      logger?.info('api.sync_finished', { mode, runId: run.id, status, exitCode });
    };
    child.stdout?.on('data', (d) => append(String(d)));
    child.stderr?.on('data', (d) => append(String(d)));
    child.on('error', (err) => {
      void finish('failed', null, '[spawn error] ' + String(err.message).slice(0, 300));
    });
    child.on('close', (code) => {
      void finish(code === 0 ? 'ok' : 'failed', code, null);
    });
    logger?.info('api.sync_started', { mode, args: args.join(' '), by, pid: child.pid, runId: run.id });
    return { runId: run.id, pid: child.pid };
  }

  // 被拦截请求的采样日志：同一 IP 每分钟最多一条，避免刷屏和污染访问统计
  const blockedLoggedAt = new Map();
  const logBlocked = ({ ip, req, path, status, reason }) => {
    const now = Date.now();
    if (now - (blockedLoggedAt.get(ip) ?? 0) < 60_000) return;
    blockedLoggedAt.set(ip, now);
    if (blockedLoggedAt.size > 5000) {
      for (const [k, v] of blockedLoggedAt) if (now - v > 300_000) blockedLoggedAt.delete(k);
    }
    db.insertVisitorLog(q, {
      ip,
      remoteIp: String(req.socket?.remoteAddress ?? '').replace(/^::ffff:/, ''),
      region: visitors.cachedRegion(ip),
      path,
      method: req.method ?? 'GET',
      userAgent: req.headers['user-agent'],
      status,
      blocked: true,
      blockReason: reason,
    }).catch(() => {});
  };

  const siteName = () => String(process.env.SITE_NAME ?? 'SteamDeals').trim() || 'SteamDeals';
  // 申诉邮箱回退链（|| 链 + trim，见 src/appeal.js）：水合的空串不再截断回退
  const appealEmail = () => appealEmailFrom(process.env);

  /** 统一的封禁响应：浏览器给提示页，API/脚本给纯文本。 */
  const denyBanned = (req, res, { status = 403, until = null, reason = '访问被拒绝', ip = null } = {}) => {
    // 拦截链侧记一条观测日志：下次"某个端不生效"能直接定位（docs/BAN-AND-SECURITY-FIXES.md §3.5）
    logger?.info('ban.page_view', {
      ip,
      path: String(req.url ?? '').split('?')[0],
      mobile: isMobileUa(req),
      at: 'gate',
      reason,
      status,
    });
    // BR 批 §11.4：封禁页可读——剩余秒数 + 脱敏 IP 注入 payload，由前端 BanPage 渲染
    const remainingSec = until ? Math.max(0, Math.ceil((Number(until) - Date.now()) / 1000)) : null;
    const ipMasked = visitors.maskIpForDisplay(ip);
    if (wantsHtml(req)) {
      const code = serveBanPage(res, outDir, { status, until, reason, siteName: siteName(), appealEmail: appealEmail(), remainingSec, ipMasked }, frontendDir);
      // 记录申诉编号，管理员收到申诉邮件后能按编号在日志里定位这次封禁
      logger?.warn('ban.page', { ip, code, status, until, reason });
      return code;
    }
    const headers = { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' };
    if (until) headers['retry-after'] = String(Math.max(1, Math.ceil((Number(until) - Date.now()) / 1000)));
    res.writeHead(status, headers);
    res.end(reason);
    return null;
  };

  /**
   * 异常请求审核：**只记录、不封禁**。
   * 同一 IP+规则由 guard 内部节流（默认 60s），数据库里 pending 记录再合并计数。
   */
  const recordReview = async ({ ip, deviceId, fingerprint, rule, detail, path }) => {
    try {
      const row = await db.recordAbuseReview(q, { ip, deviceId, fingerprint, rule, detail, path });
      logger?.warn('abuse.review', {
        ip,
        rule,
        path: String(path ?? '').slice(0, 120),
        hits: row?.hits ?? 1,
        deviceId: deviceId || null,
      });
    } catch (err) {
      logger?.warn('abuse.review_failed', { ip, rule, message: String(err.message).slice(0, 120) });
    }
  };

  // ---- DL 批（docs/ALIGN-SNAPSHOT.md §5）：对齐审核快照落库——废弃内存缓存语义
  // （alignRunner TTL/invalidate/staleCache 不再使用），队列真相 = align_snapshots 最新行。
  // 计算本体抽到 align-compute.js（与 CLI `align-snapshot` 调度任务共用）。
  const { computeAlignGroups } = createAlignCompute({ q, db, logger });
  // 后台生成 single-flight（进程内）：firstRun 202 / ?refresh=1 / 动作后一致性重算都走这里。
  // 已有生成在跑时**链式排队**（在途轮结束后补跑）——动作后的重算必须覆盖「动作之后」的状态，
  // 否则在途旧重算可能覆盖同事务更新过的快照（ensureAlignSnapshot 内部另有动作竞态防护）。
  // 失败已写快照 error + 日志 align.snapshot_failed，不向上抛（请求不阻塞）。
  // CO-5/B4-2 第十四轮：本闭包经 ctx 按引用传入 routes/admin-align.js（语义共享：确认/忽略/
  // 恢复动作后与 GET 首次/refresh 共用同一在途 Promise 链），勿改成拷贝。
  let alignGeneration = null;
  const triggerAlignGeneration = ({ force = false } = {}) => {
    const run = () =>
      ensureAlignSnapshot({ q, compute: computeAlignGroups, logger, force, maxAgeMs: alignSnapshotMaxAgeMs() }).catch(
        () => {
          /* 失败可见性由快照 error 字段 + sync_runs（调度任务）承担 */
        },
      );
    const head = (alignGeneration ?? Promise.resolve()).then(run);
    alignGeneration = head;
    head.finally(() => {
      if (alignGeneration === head) alignGeneration = null;
    });
    return head;
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let path = url.pathname;      const appealPage = path === '/appeal' || path === '/appeal/';
    // ---- B1 批（docs/DESIGN-AUDIT.md B1）：统一请求超时（默认 15s，白名单豁免长连接路径）----
    // 超时先看响应是否已开始：还没发头 → 503 JSON（日志 http.request_timeout）；
    // 已开始写 → destroy 连接（不补写状态码）。handler 结束后 finally 清掉定时器；
    // timedOut 期间 writeHead/end 变 no-op，避免 handler 继续写时抛"headers already sent"。
    const timeoutExempt = isTimeoutExemptPath(path);
    let timedOut = false;
    let timeoutTimer = null;
    if (!timeoutExempt) {
      const origHead = res.writeHead.bind(res);
      const origEnd = res.end.bind(res);
      res.writeHead = (...args) => (timedOut ? res : origHead(...args));
      res.end = (...args) => (timedOut ? res : origEnd(...args));
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        logger?.warn('http.request_timeout', { path, ms: requestTimeoutMs });
        if (!res.headersSent) {
          origHead(503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
          origEnd('{"error":"请求超时，请稍后再试"}');
        } else if (!res.writableEnded) {
          res.destroy();
        }
      }, requestTimeoutMs);
      timeoutTimer.unref?.();
    }
    // O-3（docs/APPEAL-SYSTEM.md §3.1 / §10.3）：申诉接口放行封禁拦截（与 /appeal 页同等待遇）——
    // 被封禁者必须能提交申诉、点邮件里的处理链接；其余拦截照旧。接口自身的限流在路由里做。
    const appealApi = path === '/api/appeal' || path === '/api/appeal/action';
    // O 批质检打回修复（2026-11-14 第 1 轮，docs/QA-APPEAL-OBQ.md）：被封用户要在申诉页拉图形
    // 验证码，GET /api/captcha 同样放行拦截链——否则被封 IP 一律 403，站内申诉永远无法提交。
    // 风险可控：验证码一次性、5 分钟过期；提交端仍有每 IP 3 条/小时兜底；发码自带 30 张/分钟限流。
    const appealExempt = appealPage || appealApi || (path === '/api/captcha' && req.method === 'GET');
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[COOKIE] ?? null;

    // CA-1（docs/APP-NATIVE.md §3.2/§3.4）：App 用 Bearer Token 认证（先 Bearer、后 Cookie）；
    // /api/app/* 是 App 专用命名空间——豁免 IP 黑名单与设备封禁拦截，但保留全局 API 基础限流。
    const bearerMatch = /^Bearer\s+([A-Za-z0-9_-]{16,})$/i.exec(String(req.headers.authorization ?? ''));
    const bearer = bearerMatch ? bearerMatch[1] : null;
    const appNamespace = path === '/api/app/status' || path.startsWith('/api/app/');
    // CA-1（docs/APP-API.md §1 总则）：前缀重写——App 只调 /api/app/<rest>，服务端去掉 /api/app 后按
    // /api/<rest> 路由（保留 query）；精确例外 /api/app/latest 与 /api/app/status 不重写。
    // 封禁豁免按原始 /api/app/* 前缀判定（appNamespace），重写只影响后续路由匹配。
    if (appNamespace && path !== '/api/app/latest' && path !== '/api/app/status') {
      path = '/api' + path.slice('/api/app'.length);
    }

    try {
      // ---- 基础安全响应头（所有响应都带）----
      applySecurityHeaders(req, res);

      // ---- 访问者 IP + 黑名单 + 频率限制（整站拦截，静态资源也一样拦）----
      const ip = visitors.clientIp(req);

      // BK 批（docs/SESSION-MANAGEMENT.md §3.2）：会话解析收敛——同一请求最多查一次 userBySession，
      // 结果缓存到局部 promise（adminBypass / 公告已读 / 主 user 三处共享）。
      // 空闲超时 / IP・UA 绑定不一致时删行、清 cookie、视为未登录（公开接口不受影响，只影响 requireUser/Admin）。
      let sessUserPromise = null;
      const resolveSession = async () => {
        if (!sessUserPromise) {
          sessUserPromise = (async () => {
            if (!token) return null;
            let row = null;
            try {
              row = await db.userBySession(q, token);
            } catch {
              return null;
            }
            if (!row) return null;
            // BK-3：空闲超时（auth.sessionIdleDays，0=关闭）
            const idleDays = Math.max(0, Number(process.env.AUTH_SESSION_IDLE_DAYS ?? '7') || 0);
            if (idleDays > 0 && row.last_seen_at) {
              const idleMs = Date.now() - new Date(row.last_seen_at).getTime();
              if (idleMs > idleDays * 86400_000) {
                await db.deleteSessionByToken(q, token).catch(() => {});
                res.setHeader('set-cookie', sessionCookie(req, '', 0));
                logger?.info('session.idle_expired', { id: row.sess_id, username: row.username, lastSeenAt: row.last_seen_at, idleDays });
                return null;
              }
            }
            // BK-3：绑定校验——老会话（key 为 null）跳过，不误踢；两个开关默认开
            const bindIp = process.env.AUTH_SESSION_BIND_IP !== '0';
            const bindUa = process.env.AUTH_SESSION_BIND_UA !== '0';
            const curIpKey = ipSessionKey(ip);
            const curUaKey = uaSessionKey(req.headers['user-agent']);
            if (bindIp && row.ip_key && curIpKey && row.ip_key !== curIpKey) {
              await db.deleteSessionByToken(q, token).catch(() => {});
              res.setHeader('set-cookie', sessionCookie(req, '', 0));
              logger?.warn('session.bound_mismatch', { id: row.sess_id, username: row.username, field: 'ip', hit: curIpKey });
              return null;
            }
            if (bindUa && row.ua_key && curUaKey && row.ua_key !== curUaKey) {
              await db.deleteSessionByToken(q, token).catch(() => {});
              res.setHeader('set-cookie', sessionCookie(req, '', 0));
              logger?.warn('session.bound_mismatch', { id: row.sess_id, username: row.username, field: 'ua', hit: curUaKey });
              return null;
            }
            // BK-2：last_seen_at 节流写（同一会话 5 分钟最多一次，内存节流，不新建任务）
            const lastWrite = sessionSeenAt.get(token) ?? 0;
            if (Date.now() - lastWrite > 5 * 60_000) {
              sessionSeenAt.set(token, Date.now());
              if (sessionSeenAt.size > 50_000) sessionSeenAt.clear();
              db.touchSession(q, token).catch(() => {});
            }
            return row;
          })();
        }
        return sessUserPromise;
      };

      // 白名单：不计数、不受黑名单限制
      const whitelisted = ratelimit.isWhitelisted(ip);

      // 管理员放行：避免把自己拉黑后连控制台都进不去
      let adminBypass = false;
      if (token) {
        try {
          const u = await resolveSession();
          adminBypass = u?.role === 'admin';
        } catch {
          adminBypass = false;
        }
      }

      // ---- 设备封禁（管理员在控制台审批后才会存在）----
      const deviceId = devices.normalizeDeviceId(cookies[DEVICE_COOKIE]);

      // ---- robots.txt：敏感页一律 Disallow（docs/URL-PARAM-PRIVACY.md §5）----
      if (path === '/robots.txt' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=86400' });
        res.end('User-agent: *\nDisallow: /console\nDisallow: /banned\nDisallow: /appeal\nDisallow: /api/\n');
        return;
      }

      // ---- 只读封禁状态接口（客户端复核用，docs/BAN-AND-SECURITY-FIXES.md §3.3）----
      // CO-5/B4-2 第七轮：已抽到 src/routes/site.js 的 handleSitePreflight。
      // 调用位置不能动：必须在拦截链之前——被封禁者也要拿得到自己的状态（契约不变）。
      if (await handleSitePreflight({ path, req, res, json, ip, whitelisted, deviceId })) return;

      // CO-4/B4（docs/DESIGN-AUDIT.md B4）：App 域预检段（/api/app/status）已抽到 src/routes/app.js。
      // 调用位置不能动：必须在设备维度限流与封禁拦截链之前（契约 §3：仍只受全局基础限流）。
      if (await handleAppPreflight({ path, req, res, json, ip, whitelisted })) return;

      // CO-3/C2（docs/DESIGN-AUDIT.md C2）：/api/app/* 设备维度限流（X-Device-Id 为键）。
      // 封禁/黑名单豁免保持不变；这里补按设备独立窗口——同设备超限 429（带 retryAfterSec /
      // Retry-After），不封禁、不影响其它设备；审计事件 app.device_rate_limited 落日志。
      // /api/app/status 在上面的精确路由里已 return（仍只受全局基础限流，契约 §3 不变）；
      // 无有效 X-Device-Id 的请求不进入本限流（仍受全局 IP 基础限流约束）。
      if (appNamespace && !whitelisted && !adminBypass) {
        const appDeviceId = devices.normalizeDeviceId(String(req.headers['x-device-id'] ?? ''));
        if (appDeviceId) {
          const deviceVerdict = appRateLimit.hitDevice(appDeviceId);
          if (deviceVerdict.limited) {
            logger?.warn('app.device_rate_limited', {
              deviceId: appDeviceId,
              ip,
              path,
              method: req.method ?? 'GET',
              count: deviceVerdict.count,
              max: deviceVerdict.max,
              windowSec: deviceVerdict.windowSec,
              retryAfterSec: deviceVerdict.retryAfterSec,
            });
            return json(
              res,
              429,
              { error: '请求过于频繁，请稍后再试', retryAfterSec: deviceVerdict.retryAfterSec },
              { 'cache-control': 'no-store', 'retry-after': String(deviceVerdict.retryAfterSec) },
            );
          }
        }
      }

      // CA-1：/api/app/* 豁免设备封禁与 IP 黑名单（App 端自行按 /api/app/status 处理封禁提示）
      const deviceBan = deviceId && !appNamespace && !adminBypass && !whitelisted ? devices.isBanned({ deviceId }) : null;
      if (deviceBan && !appealExempt) {
        if (req.method === 'GET' && isFrontendAsset(path)) return serveFrontendStatic(res, frontendDir, outDir, path);
        logger?.warn('device.denied', { ip, deviceId, until: deviceBan.until });
        logBlocked({ ip, req, path, status: 403, reason: '设备已被封禁' });
        return denyBanned(req, res, { status: 403, until: deviceBan.until, reason: '设备已被封禁', ip });
      }

      // BJ 批 A1（docs/BAN-AND-SECURITY-FIXES.md §10.4.1）：IP 黑名单检查提到频率限制**之前**——
      // 黑名单 IP 在计数之前被拦下：不计数、不三振、不升级、不写 ip_abuse / abuse_reviews，
      // 响应固定 403（不再出现"先 403、超 60 次后变 429"）。
      const hit = ip && !appNamespace && !adminBypass && !whitelisted ? visitors.blockedBy(ip) : null;

      // CF 批（docs/ADMIN-UX-SECURITY.md §3）：auto-ban 硬规则作用域——白名单/管理员/内网/App 命名空间不参与
      const autoBanScope = Boolean(ip && !whitelisted && !adminBypass && !appNamespace && !visitors.isPrivateAddress(ip));
      const tryAutoBan = async (trigger, detail) => {
        if (!trigger || !autoBanScope) return null;
        const res = await autoBan.applyAutoBan(q, ip, { rule: trigger.rule, detail, path: trigger.paths?.[0] ?? null, ratelimit });
        if (res) {
          logger?.warn('auto_ban.applied', {
            ip,
            rule: trigger.rule,
            until: new Date(res.until).toISOString(),
            minutes: res.minutes,
            strikes: res.strikes,
          });
        } else {
          logger?.warn('auto_ban.skipped', { ip, rule: trigger.rule, reason: 'whitelisted or mode off' });
        }
        return res;
      };
      if (hit && !appealExempt) {
        if (req.method === 'GET' && isFrontendAsset(path)) return serveFrontendStatic(res, frontendDir, outDir, path);
        logger?.warn('block.ip_denied', { ip, path, rule: hit });
        logBlocked({ ip, req, path, status: 403, reason: `IP 黑名单（${hit}）` });
        return denyBanned(req, res, { status: 403, reason: '访问被拒绝', ip });
      }

      // 频率限制：白名单/管理员不参与三振；内网/本机（反代、健康检查）不计数
      // 分桶（BR 批 §11.4）：页面 / API / 静态资源三个独立桶——正常翻页不与接口抢计数，
      // 封面图也不该顶到页面阈值；封禁期内只有 API 桶继续累计升级。
      if (ip && !whitelisted && !adminBypass && !visitors.isPrivateAddress(ip) && !appealExempt) {
        // 统一走 hit：封禁期内的请求也会被计数，够数就记一条待审核（**不再自动永久封**）
        const bucket = guard.isAssetPath(path) ? 'asset' : path.startsWith('/api/') ? 'api' : 'page';
        const verdict = await ratelimit.hit(q, ip, { bucket });
        if (verdict.limited) {
          if (req.method === 'GET' && isFrontendAsset(path)) return serveFrontendStatic(res, frontendDir, outDir, path);
          const until = Number(verdict.until) || 0;
          logger?.warn('rate.limited', {
            ip,
            path,
            bucket,
            strikes: verdict.strikes ?? null,
            reason: verdict.reason,
            escalated: Boolean(verdict.escalated),
            needsReview: Boolean(verdict.needsReview),
            over: Boolean(verdict.over),
            count: verdict.count ?? null,
          });
          // CF 批（docs/ADMIN-UX-SECURITY.md §3.1）：strict 模式普通超频只 429；
          // 极端频率（≥阈值 extremeMultiplier 倍且连续 extremeWindows 个窗口）交给 auto-ban 自动临时封。
          if (verdict.over) {
            const trigger = autoBanScope
              ? autoBan.recordRateOver(ip, bucket, verdict.count)
              : null;
            if (trigger) {
              const ban = await tryAutoBan(trigger, `极端频率：${bucket} 桶 ${verdict.count} 次/窗口（阈值 ${verdict.max}）`);
              if (ban) {
                logBlocked({ ip, req, path, status: 403, reason: 'auto:extreme-rate' });
                return denyBanned(req, res, { status: 403, until: ban.until, reason: '检测到恶意高频请求，已临时封禁', ip });
              }
            }
            // 未到极端：只 429（带 retry-after），不封禁、不算 App 封禁
            logBlocked({ ip, req, path, status: 429, reason: verdict.reason });
            return denyBanned(req, res, { status: 429, until, reason: verdict.reason, ip });
          }
          // 只有"新一次超限"才记审核；封禁期内的重复请求不重复记
          if (!verdict.banned && verdict.needsReview) {
            await recordReview({
              ip,
              deviceId,
              fingerprint: devices.fingerprintFor(deviceId),
              rule: 'rate-limit',
              detail: `超频 ${verdict.strikes || 1} 次：${verdict.reason}`,
              path,
            });
          }
          logBlocked({ ip, req, path, status: 429, reason: verdict.reason });
          return denyBanned(req, res, { status: 429, until, reason: verdict.reason, ip });
        }
      }

      // ---- 路径守卫：白名单 / 扫描器签名 / 未知路径计数 + 异常 UA（CF 批）----
      // 只记录待审核；自动封禁只按 auto-ban 硬规则（路径签名/UA 名单），普通异常仍人工审批。
      if (ip && !whitelisted && !adminBypass && !visitors.isPrivateAddress(ip) && visitors.isIpLike(ip)) {
        try {
          const uaBad = autoBan.isBadUa(req.headers['user-agent']);
          const result = await guard.inspect({
            ip,
            path,
            method: req.method ?? 'GET',
            outDir,
            logger,
            userAgent: req.headers['user-agent'] ?? '',
            uaBad,
            onReview: (payload) =>
              recordReview({
                ip,
                deviceId,
                fingerprint: devices.fingerprintFor(deviceId),
                ...payload,
              }),
          });
          // CF 批硬规则：UA 名单（10 分钟 ≥2 次）/ 漏洞路径（窗口内 ≥N 个不同签名）→ 自动临时封
          if (autoBanScope) {
            if (result.uaHit) {
              const trigger = autoBan.recordUaHit(ip);
              if (trigger) await tryAutoBan(trigger, '异常 UA 名单命中');
            } else if (result.verdict?.kind === 'signature') {
              const trigger = autoBan.recordPathSignature(ip, result.rule, result.path ?? path);
              if (trigger) await tryAutoBan(trigger, `漏洞路径探测：${trigger.paths?.join('、')}`);
            }
          }
        } catch (err) {
          // 守卫自己出错只记日志，绝不影响正常请求（fail-open）
          logger?.warn('guard.failed', { ip, path, message: String(err.message).slice(0, 160) });
        }
      }

      // ---- 访问记录：静态资源不记，页面与 API 必记（状态码在 finish 时补）----
      const logVisit = () => {
        if (!isLoggablePath(path)) return;
        const region = visitors.cachedRegion(ip);
        res.once('finish', () => {
          // 成功的只读 API 查询不计入访问记录；页面访问、登录/修改以及错误状态仍记录。
          if ((req.method === 'GET' && path.startsWith('/api/') || req.method === 'POST' && path === '/api/games/search') && res.statusCode < 400) return;
          db.insertVisitorLog(q, {
            ip,
            remoteIp: String(req.socket?.remoteAddress ?? '').replace(/^::ffff:/, ''),
            region,
            path,
            method: req.method ?? 'GET',
            userAgent: req.headers['user-agent'],
            status: res.statusCode,
          })
            .then((id) => {
              if (!region && ip) visitors.enrichRegion(q, ip, id).catch(() => {});
            })
            .catch(() => {});
        });
      };
      logVisit();

      // ---- 首次初始化拦截：完成前只允许 /setup、设置页静态资源和 /api/setup/* ----
      const setupState = getSetupState ? await getSetupState() : { completed: true };
      if (!setupState.completed) {
        // 图标也要放行：否则 /setup 自身的 favicon 请求会被 302 成 HTML，标签页图标就丢了
        if (
          path === '/setup' ||
          (req.method === 'GET' && isFrontendAsset(path)) ||
          path === '/settings-ui.js' ||
          path === '/favicon.svg' ||
          path === '/favicon.ico' ||
          path === '/apple-touch-icon.png'
        ) {
          return serveFrontendStatic(res, frontendDir, outDir, path);
        }
        if (path.startsWith('/api/setup/')) {
          const handled = await handleSetupRoutes({
            path,
            req,
            res,
            q,
            store,
            logger,
            json,
            readBody,
            setupToken,
            cookieName: COOKIE,
          });
          if (handled) return;
        }
        if (path.startsWith('/api/')) {
          return json(res, 428, { error: '系统尚未初始化', setupRequired: true, setup: '/setup' });
        }
        res.writeHead(302, { location: '/setup', 'cache-control': 'no-store' });
        res.end();
        return;
      }
      if (path === '/setup') {
        res.writeHead(302, { location: '/', 'cache-control': 'no-store' });
        res.end();
        return;
      }
      // 初始化完成后 /api/setup/status 仍可读；complete/schema 会返回 409
      if (path.startsWith('/api/setup/')) {
        const handled = await handleSetupRoutes({
          path,
          req,
          res,
          q,
          store,
          logger,
          json,
          readBody,
          setupToken,
          cookieName: COOKIE,
        });
        if (handled) return;
      }

      // ---- 仅封禁可见页面守卫（docs/BAN-AND-SECURITY-FIXES.md §3）----
      // 只读判定：复用拦截链已经算好的 deviceBan / hit / whitelisted / adminBypass，
      // 频率封禁只读 bannedUntil()——hit() 有计数与三振副作用，禁止在页面路由调用（§3.6）。
      // 管理员与白名单视为未封禁；被封禁的用户到达不了 /banned（拦截链已 denyBanned），
      // 但能到达 /appeal（故意豁免），所以这里对 /appeal 是第一次真正判定。
      const banState = () => {
        if (adminBypass || whitelisted) return null;
        if (deviceBan) return { type: 'device', until: deviceBan.until };
        // BJ 批 A1：黑名单优先级高于自动封禁（与拦截链一致）
        if (hit) return { type: 'ip', rule: hit };
        const rateUntil = ip ? ratelimit.bannedUntil(ip) : null;
        if (rateUntil) return { type: 'rate', until: rateUntil };
        return null;
      };
      if (BAN_ONLY_PAGES.has(path) && banState() === null) {
        logger?.info('ban.page_view', { ip, path, mobile: isMobileUa(req), at: 'ban_only', reason: 'not_banned' });
        logger?.info('ban.redirect_home', { ip, path, from: 'ban_only_page' });
        res.writeHead(302, { location: '/', 'cache-control': 'no-store', 'content-length': '0' });
        res.end();
        return;
      }

      // ---- 申诉页：守卫已保证仅被封禁者可见；注入站点信息（URL 只带 code，见 URL-PARAM-PRIVACY.md §4.2）----
      if (appealPage) {
        const rawCode = String(url.searchParams.get('code') ?? '');
        // 白名单校验：整个 code 必须匹配 ^[A-Za-z0-9-]{1,16}$，非法（含 <、超长）按空处理，
        // 不报错、不反射输入（docs/URL-PARAM-PRIVACY.md §5）
        const code = /^[A-Za-z0-9-]{1,16}$/.test(rawCode) ? rawCode : '';
        if (serveAppealPage(res, outDir, frontendDir, { site: siteName(), email: appealEmail(), code })) return;
        // 无构建产物时回落到下方静态资源路径（保持旧行为）
      }

      // ---- CA-5（docs/APP-NATIVE.md §5）+ CP 批（docs/MOBILE-DETECT-FIX.md）：手机浏览器前台跳转 /app ----
      // 开关默认关闭（app.mobileRedirectEnabled / APP_MOBILE_REDIRECT_ENABLED，等原生 App（CG）发布后开启）。
      // 只对登记在 FRONTEND_PAGES 的前台页面生效；豁免后台/登录/注册/下载/封禁/申诉/初始化/改密。
      // 微信内置浏览器同样跳到 /app——下载页里有「右上角 → 在浏览器打开」提示（微信内不能直接下载 APK）。
      const MOBILE_REDIRECT_EXEMPT = /^\/(console|login|register|app|banned|appeal|setup|change-password)(\/|$)/;
      const mobileSignal = mobileHitSignal(req);
      if (
        String(process.env.APP_MOBILE_REDIRECT_ENABLED ?? '') === '1' &&
        req.method === 'GET' &&
        mobileSignal &&
        FRONTEND_PAGES.includes(path) &&
        !MOBILE_REDIRECT_EXEMPT.test(path)
      ) {
        logger?.info('http.mobile_redirect', { ip, path, signal: mobileSignal });
        res.writeHead(302, { location: '/app', 'cache-control': 'no-store', 'content-length': '0' });
        res.end();
        return;
      }

      // ---- CJ 批：/app/dl/<file> 白名单下载路由（只读 data/app/，HEAD 可用）----
      // 必须在静态资源分支之前——/app/dl/ 不是镜像文件，落到 serveFrontendStatic 只会 404。
      // CJ 现场回归修复（2026-11-17 线上 v2.22.0）：文件不存在时 302 回落到镜像 /app/<file>——
      // 首轮同步未跑/失败（data/app 为空）时旧下载链接不死。
      const dlMatch = path.match(/^\/app\/dl\/(steamdeals-[\d.]+\.apk)$/);
      if (dlMatch) {
        const file = dlMatch[1];
        const dlRoot = resolve(process.cwd(), process.env.APP_DATA_DIR ?? 'data/app');
        const target = resolve(dlRoot, file);
        if (!target.startsWith(dlRoot + sep) || !existsSync(target)) {
          res.writeHead(302, { location: `/app/${file}`, 'cache-control': 'no-store', 'content-length': '0' });
          res.end();
          return;
        }
        const size = (readFileSync(target)).length;
        if (size > 50 * 1024 * 1024) return json(res, 404, { error: 'too large' });
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'content-type': 'application/vnd.android.package-archive', 'content-length': size, 'cache-control': 'no-store' });
          return res.end();
        }
        if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });
        res.writeHead(200, { 'content-type': 'application/vnd.android.package-archive', 'content-length': size, 'cache-control': 'no-store' });
        return res.end(readFileSync(target));
      }

      // 静态资源（页面本身仍由 chart 生成，这里只发文件）
      // 注意：/img/ 是服务端图片代理路由（本地缓存 → CDN 兜底），不能当静态文件处理，
      // 否则会直接 404——这正是之前"前台只有名字没有图"的真正原因。
      if (!path.startsWith('/api/') && !path.startsWith('/img/')) {
        return serveFrontendStatic(res, frontendDir, outDir, path);
      }

      // ---- CO-5/B4-2 第七轮（docs/DESIGN-AUDIT.md B4）：site 域公开路由已抽到 src/routes/site.js ----
      // 调用位置不能动：必须在认证上下文解析（must_change_password 白名单）之前——
      // 注册页/改密页在认证前也要读站点信息（原位置语义，移动 = 改契约）。
      // siteName / appealEmail 是宿主闭包（serveBanPage / 申诉域仍用），经 ctx 按引用传入（语义共享）。
      // DX 批：siteCache 按引用传入（与 syncStatusCache 同先例）——配置变更/重启时宿主主动失效。
      if (await handleSitePublic({ path, req, res, q, json, siteName, appealEmail, siteCache, siteCacheTtlMs })) return;
      // ---- CO-5/B4-2 第五轮（docs/DESIGN-AUDIT.md B4）：公告域路由已抽到 src/routes/announcements.js ----
      // 公开段调用位置不能动：必须在认证上下文解析（must_change_password 白名单）之前——
      // 游客与待改密用户也要能读到公告（原位置语义，移动 = 改契约）。
      // resolveSession 与 adminBypass / 主 user 共享同一请求级 promise（BK 批 §3.2），按引用传入（语义共享）。
      if (await handleAnnouncementsPublic({ path, req, res, q, json, resolveSession })) return;
      // ---- CO-5/B4-2 第三轮（docs/DESIGN-AUDIT.md B4）：认证域公开路由已抽到 src/routes/auth.js ----
      // 调用位置不能动：必须在认证上下文解析（must_change_password 白名单）之前——
      // 改密页也会注册设备（原位置语义，移动 = 改契约）。ctx 字段契约见 ARCHITECTURE §15。
      if (await handleAuthPublic({ path, req, res, q, logger, json, readBody, ip })) return;

      // ---- CO-4/B4 第二轮（docs/DESIGN-AUDIT.md B4）：申诉域公开路由已抽到 src/routes/appeal.js ----
      // 调用位置不能动：必须在认证上下文解析（must_change_password 白名单）之前——
      // 已登录但被要求改密的用户也要能提交申诉（原位置语义，移动 = 改契约）。
      // ctx 里 appealBucketLimited 与 /api/captcha 路由共用同一限流桶、newAppealCode 因 serveBanPage
      // 仍用而留在本文件——两者都按引用传递（语义共享）；hit/deviceBan/deviceId 是拦截链只读结果。
      if (
        await handleAppealPublic({
          path,
          req,
          res,
          q,
          logger,
          json,
          readBody,
          ip,
          captcha,
          deviceId,
          hit,
          deviceBan,
          appealBucketLimited,
          newAppealCode,
          siteName,
          appealEmail,
        })
      )
        return;



      // CA-1（docs/APP-NATIVE.md §3.2）：先 Bearer、后 Cookie——Bearer 校验哈希 + 未过期 + 未撤销 +
      // 用户未禁用；失效统一 user=null（用户接口 401 login_required）。last_used_at 5 分钟节流写。
      let user = null;
      if (bearer) {
        const row = await db.userByApiToken(q, bearer).catch(() => null);
        if (row) {
          user = row;
          const lastWrite = apiTokenSeenAt.get(bearer) ?? 0;
          if (Date.now() - lastWrite > 5 * 60_000) {
            apiTokenSeenAt.set(bearer, Date.now());
            if (apiTokenSeenAt.size > 50_000) apiTokenSeenAt.clear();
            db.touchApiToken(q, bearer).catch(() => {});
          }
        }
      } else {
        user = await resolveSession();
      }
      // Steam 账号相关表幂等建表（一次后为 no-op）。列表/详情的「已拥有推导」SQL 会 join
      // steam_games / steam_accounts / steam_wishlist，必须先于任何查询存在——不能只放在
      // Steam 路由块里，否则该块之前的路由（如 /api/games/search）在全新库上会 500。
      await ensureSteamSchemaOnce(q);

      // AK-3（docs/AUTH-REDESIGN.md §4.8）：首次登录强制改密——must_change_password 的用户
      // 只放行白名单路径（改密页要用的 /api/password/check 一并放行），其余一律 403。
      if (user?.must_change_password) {
        const allow = (p) =>
          p === '/api/me' ||
          p === '/api/logout' ||
          p === '/api/user/password' ||
          p === '/api/auth/token/revoke' ||
          p === '/api/site' ||
          p === '/api/captcha' ||
          p === '/api/password/check' ||
          p.startsWith('/api/avatar/') || // CX 批：头像公开只读，改密页也要能显示本人头像
          !p.startsWith('/api/');
        if (!allow(path)) {
          return json(res, 403, { error: '需要先修改密码', code: 'must_change_password' });
        }
      }

      // 邮箱验证码路由（发送 / 校验），逻辑在 auth-routes.js
      const authRoutes = await import('./auth-routes.js');
      if (await authRoutes.handleEmailAuth({ path, req, res, q, logger, json, readBody, captcha, ip })) return;
      const requireUser = () => {
        if (!user) {
          // CA-1：App（Bearer）语义统一 401 { error: 'login_required' }；Web（Cookie）文案不变
          json(res, 401, { error: bearer ? 'login_required' : '需要登录' });
          return false;
        }
        return true;
      };
      const requireAdmin = () => {
        if (!user) {
          json(res, 401, { error: '需要登录' });
          return false;
        }
        if (user.role !== 'admin') {
          json(res, 403, { error: '需要管理员' });
          return false;
        }
        return true;
      };

      // ---- CO-4/B4（docs/DESIGN-AUDIT.md B4）：App 域路由主段已抽到 src/routes/app.js ----
      // ctx 字段契约（路由上下文注入模式）见 docs/ARCHITECTURE.md「域路由拆分模式」；
      // loginIpFails 与 Web 登录共用同一计数 Map（按引用传递，两边写同一份）；
      // appSync 是单飞状态持有对象（{ inFlight }，按引用传递让模块读写同一份）。
      if (
        await handleAppRoutes({
          path,
          req,
          res,
          q,
          logger,
          json,
          readBody,
          ip,
          user,
          bearer,
          captcha,
          requireAdmin,
          frontendDir,
          appSyncDir,
          appSyncFetchImpl,
          appSync,
          loginIpFails,
          autoBanScope,
          tryAutoBan,
        })
      )
        return;

      // ---- CO-5/B4-2 第十一轮（docs/DESIGN-AUDIT.md B4）：admin-sessions 域管理段路由已抽到
      // src/routes/admin-sessions.js。调用位置不能动：必须在 requireAdmin 就绪之后的管理段
      // （401/403 语义依赖该位置；调用点取本域最早路由 /api/admin/sessions 的原位置）。
      // 域内 2 条路由 path+method 互不重叠、与相邻其它路由无同 path 双匹配，
      // 在管理段内集中到一处不改变匹配语义；token 只读传入（current 标记/踢下线审计）。
      if (
        await handleAdminSessionsAdmin({
          path,
          req,
          res,
          url,
          q,
          logger,
          json,
          user,
          requireAdmin,
          token,
        })
      )
        return;

      // 黑/白名单互斥（docs/BAN-AND-SECURITY-FIXES.md §4）：加黑移白、加白移黑，含内存态同步。
      // 单条/审核/批量四个入口都走这里，保证口径一致、不会再出现"同一 IP 两边都在"。
      // （CO-5/B4-2 第十六轮：定义上移到 admin-users 接线之前——本域 kickAll 原位置在
      // 本定义之前，bulk 路由经 ctx 拿引用时不能触发 TDZ；行为不变。）
      const banIpExclusive = (ip, note, kind, opts) => banIpExclusiveSql(q, ip, note, kind, opts);

      // ---- CO-5/B4-2 第十六轮（docs/DESIGN-AUDIT.md B4）：admin-users 域路由已抽到
      // src/routes/admin-users.js——handleAdminUsersAdmin 在 requireAdmin 就绪之后的管理段
      // （调用位置不能动：取本域最早路由 kickAll /api/admin/users/:name/sessions 的原位置，
      // handleAdminSessionsAdmin 之后、前台 revoke-others 之前）。banIpExclusive（宿主闭包，
      // 与 admin-access 域共用 banIpExclusiveSql 互斥口径）/invalidateAdminGamesCache/
      // invalidateListCache（宿主短缓存）/appealEmail/token/ip 经 ctx 按引用传入（语义共享）。
      // /api/admin/games*（B4 #15）、/api/admin/images*（B4 #13）、admin 报表/备份/日志
      // （B4 #12）、/api/user/sessions/revoke-others（前台主段）留本文件。
      if (
        await handleAdminUsersAdmin({
          path,
          req,
          res,
          url,
          q,
          logger,
          json,
          readBody,
          user,
          requireAdmin,
          ip,
          token,
          appealEmail,
          banIpExclusive,
          invalidateAdminGamesCache,
          invalidateListCache,
        })
      )
        return;

      // BK-3（§3.4）：前台「退出其它所有设备」——保留当前会话
      if (path === '/api/user/sessions/revoke-others' && req.method === 'POST') {
        if (!requireUser()) return;
        const removed = await db.deleteSessionsOfUser(q, user.id, { exceptToken: token });
        logger?.info('session.revoke_others', { userId: user.id, removed });
        return json(res, 200, { removed });
      }

      // 系统设置（管理员）：读写 app_settings / smtp_settings
      if (path.startsWith('/api/admin/settings')) {
        if (!requireAdmin()) return;
        // BR 批：设置保存后立即热加载限流阈值（hydrate 写回 env → configureFromEnv 重配）
        // DX 批：注册开关等 /api/site 字段来自设置表——保存/恢复后立即失效 site 缓存
        const handled = await handleSettingsRoutes({ path, req, res, q, store, logger, json, readBody, user, afterHydrate: () => { ratelimit.configureFromEnv(process.env); appRateLimit.configureFromEnv(process.env); invalidateSiteCache(); } });
        if (handled) return;
      }

      // ---- CO-4/B4 第二轮：申诉域管理路由已抽到 src/routes/appeal.js（requireAdmin 就绪后调用）----
      if (
        await handleAppealAdmin({
          path,
          req,
          res,
          url,
          q,
          logger,
          json,
          readBody,
          ip,
          user,
          requireAdmin,
          siteName,
          appealEmail,
        })
      )
        return;

      // ---- CO-5/B4-2 第三轮（docs/DESIGN-AUDIT.md B4）：认证域路由主段已抽到 src/routes/auth.js ----
      // 调用位置不能动：必须在 must_change_password 白名单之后（/api/captcha 在白名单里，
      // /api/login 等匿名路由的拦截语义不变）；loginIpFails（与 App token 登录共用）、
      // appealBucketLimited（与 /api/captcha 同桶）、bindStates、steamVerify 都按引用/注入传 ctx。
      if (
        await handleAuthRoutes({
          path,
          req,
          res,
          url,
          q,
          logger,
          json,
          readBody,
          ip,
          user,
          token,
          deviceId,
          captcha,
          requireUser,
          loginIpFails,
          autoBanScope,
          tryAutoBan,
          appealBucketLimited,
          bindStates,
          steamVerify,
        })
      )
        return;

      // ---- CO-5/B4-2 第十五轮（docs/DESIGN-AUDIT.md B4）：games 域路由已抽到 src/routes/games.js ----
      // 调用位置不能动：必须在认证上下文（user/requireUser/requireAdmin）就绪后的主段
      // （401/403 语义依赖该位置，原位置语义，移动 = 改契约）——取本域最早路由
      // /api/games/for-you 的原位置。runGated/listCache/invalidateListCache/
      // invalidateAdminGamesCache/gameCountCache/maybeFillDlcOnRead/dlcsReadThrottleMs/
      // dlcFetchImpl 经 ctx 按引用传入（语义共享，勿改成拷贝）。
      // /api/admin/games* 已随 B4 #15 拆到 routes/admin-games.js、/api/behavior 留本文件。
      if (
        await handleGamesRoutes({
          path,
          req,
          res,
          url,
          q,
          logger,
          json,
          readBody,
          user,
          requireUser,
          requireAdmin,
          runGated,
          listCache,
          invalidateListCache,
          invalidateAdminGamesCache,
          gameCountCache,
          maybeFillDlcOnRead,
          dlcReadThrottleMs,
          dlcFetchImpl,
        })
      )
        return;

      if (path === '/api/behavior' && req.method === 'POST') {
        if (!requireUser()) return;
        const { behaviorActionWeight } = await import('./discovery.js');
        const body = await readBody(req, 16 * 1024);
        const action = String(body?.action ?? '');
        const weight = behaviorActionWeight(action);
        if (!weight) return json(res, 400, { error: 'action 不在白名单' });
        // 每用户 60 次/分限流（内存桶）
        const now = Date.now();
        const bRec = behaviorBuckets.get(user.id) ?? { at: now, count: 0 };
        if (now - bRec.at > 60_000) { bRec.at = now; bRec.count = 0; }
        bRec.count += 1;
        behaviorBuckets.set(user.id, bRec);
        if (bRec.count > 60) return json(res, 429, { error: '上报过于频繁' }, { 'retry-after': '60' });
        if (String(process.env.PERSONAL_BEHAVIOR_LOG_ENABLED ?? '1') === '0') {
          return json(res, 202, { ok: true, skipped: true });
        }
        const gameId = Number(body?.gameId);
        await db.upsertUserBehavior(q, { userId: user.id, gameId: Number.isInteger(gameId) && gameId > 0 ? gameId : null, action, weight });
        if (action === 'search' && body?.query) await db.insertUserSearchLog(q, { userId: user.id, query: body.query });
        logger?.info('behavior.recorded', { userId: user.id, action, gameId: Number.isInteger(gameId) && gameId > 0 ? gameId : null });
        return json(res, 200, { ok: true });
      }

      // ---- CO-5/B4-2 第六轮（docs/DESIGN-AUDIT.md B4）：me 域路由已抽到 src/routes/me.js ----
      // 调用位置不能动：必须在认证上下文（user/requireUser）就绪后的主段（401/403 语义依赖
      // 该位置）；must_change_password 白名单（/api/me、/api/avatar/*）是中间件、留在本文件。
      // 本域无跨模块共享状态，ctx 只需基座字段；/api/me/email/* 留 auth-routes.js（DT-2 排除区）。
      if (
        await handleMeRoutes({
          path,
          req,
          res,
          q,
          logger,
          json,
          readBody,
          user,
          requireUser,
        })
      )
        return;

      // ---- CO-5/B4-2 第五轮（docs/DESIGN-AUDIT.md B4）：公告已读路由已抽到 src/routes/announcements.js ----
      // 主段调用位置不能动：必须在认证上下文（user/requireUser）就绪之后（401 语义依赖该位置）。
      if (await handleAnnouncementsRoutes({ path, req, res, q, logger, json, readBody, user, requireUser })) return;

      // ---- Steam 图片代理：/img/steam/<appid>/<size>（服务端经代理取 CDN，前端无需直连） ----
      const imgMatch = path.match(/^\/img\/steam\/(\d+)\/([a-z0-9_]+)$/);
      if (imgMatch && req.method === 'GET') {
        const appid = imgMatch[1];
        const size = imgMatch[2];
        if (!images.isImageSize(size)) return json(res, 404, { error: 'unknown size' });
        const key = appid + '/' + size;
        const imgHeaders = (contentType, length) => ({
          'content-type': contentType,
          'content-length': length,
          'cache-control': 'public, max-age=31536000, immutable',
        });

        // 1) 内存热缓存（列表刷新会重复取同一批图）
        const hot = memoGetImage(key);
        if (hot) {
          res.writeHead(200, imgHeaders(hot.contentType, hot.body.length));
          res.end(hot.body);
          return;
        }

        // 2) 本地磁盘：图片下载过一次后只读文件，不再碰 CDN/代理（VPS 只用于数据联通）
        const local = images.readImage(appid, size);
        if (local) {
          memoPutImage(key, { contentType: 'image/jpeg', body: local });
          res.writeHead(200, imgHeaders('image/jpeg', local.length));
          res.end(local);
          return;
        }

        // 3) 本地没有：走 CDN 兜底取一次，成功后落盘
        const miss = imgMissCache.get(key);
        if (miss && Date.now() - miss.at < Number(imgMissTtl[miss.kind] ?? 0)) {
          res.writeHead(404);
          res.end();
          return;
        }
        const fetcher = imageFetch ?? (await import('./http.js')).fetchBuffer;
        // AW 批（docs/IMAGE-FETCH.md §3.3）：header 尺寸优先用 games.header_image 直链（白名单校验，
        // 失败回退老路径；查询失败/为空不阻塞）。
        let preferredUrl = null;
        if (size === 'header') {
          try {
            const row = (await q('select header_image from games where steam_appid = $1', [Number(appid)])).rows[0];
            if (row?.header_image && isAllowedSteamImageUrl(row.header_image)) preferredUrl = row.header_image;
          } catch {
            /* 查询失败回退老路径 */
          }
        }
        const got = await images.downloadImage(appid, size, { fetchBuffer: fetcher, preferredUrl });
        if (got.ok) {
          memoPutImage(key, { contentType: got.contentType, body: got.body });
          logger?.info('steam.img_cached', { appid, size, bytes: got.bytes });
          res.writeHead(200, imgHeaders(got.contentType, got.body.length));
          res.end(got.body);
          return;
        }
        // AW 批（docs/IMAGE-FETCH.md §3.2）：负缓存分层——404/410 记 notfound（24h），其余记 error（10min）
        const kind = got.notFound ? 'notfound' : 'error';
        imgMissCache.set(key, { at: Date.now(), kind });
        if (imgMissCache.size > 2000) imgMissCache.delete(imgMissCache.keys().next().value);
        logger?.warn('steam.img_miss', {
          appid,
          size,
          status: got.status ?? null,
          kind: got.notFound ? 'notfound' : got.timeout ? 'timeout' : 'error',
          message: String(got.error?.message ?? '').slice(0, 160),
        });
        res.writeHead(404);
        res.end();
        return;
      }

      // ---- CO-5/B4-2 第七轮（docs/DESIGN-AUDIT.md B4）：site 域主段路由已抽到 src/routes/site.js ----
      // 调用位置不能动：必须在认证上下文（user/requireUser/requireAdmin）就绪后的主段
      // （401/403 语义依赖该位置，原位置语义，移动 = 改契约）；本域无跨模块共享状态
      // （banState 限流桶随域移入模块），ctx 只需基座字段。
      // steamAccountsMod 动态 import 保留——本文件 admin 段仍用
      // （/api/admin/wishlists 属 B4 #16）；steamLogMod 已随 B4 #12 拆走。
      if (
        await handleSiteRoutes({
          path,
          req,
          res,
          url,
          q,
          logger,
          json,
          readBody,
          user,
          requireUser,
          requireAdmin,
          invalidateListCache, // DX 批：账号库/愿望单同步后失效前台列表缓存（owned/wishlist 维度）
        })
      )
        return;

      const steamAccountsMod = await import('./steam-accounts.js');

      // ---- CO-5/B4-2 第四轮：watchlist/wishlist 域用户段路由已抽到 src/routes/watchlist.js ----
      // 调用位置不能动：必须在认证上下文（user/requireUser）就绪后的主段；本域无跨模块共享状态
      // （用户级写限流 Map 只被本域使用、随域移入模块），ctx 只需基座字段。
      if (
        await handleWatchlistRoutes({
          path,
          req,
          res,
          q,
          logger,
          json,
          readBody,
          user,
          requireUser,
        })
      )
        return;

      // ---- 管理员：愿望单清单（BE 批 §4.2；CY 批改为只读——用户私有数据，写方法已移除）----
      if (path === '/api/admin/wishlists' && req.method === 'GET') {
        if (!requireAdmin()) return;
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 200) || 200, 1), 500);
        const keyword = String(url.searchParams.get('q') ?? '').trim();
        const filterUserId = url.searchParams.get('userId') ? Number(url.searchParams.get('userId')) : null;
        return json(res, 200, await steamAccountsMod.listWishlists(q, { limit, keyword, userId: filterUserId }));
      }
      // CY 批：/api/admin/wishlists/:id 的 DELETE 已移除——愿望单属用户私有数据，管理员只读（越权写走 404/白名单拦截）

      // ---- CO-5/B4-2 第十七轮（docs/DESIGN-AUDIT.md B4）：admin-games 域管理段路由已抽到
      // src/routes/admin-games.js。调用位置不能动：必须在 requireAdmin 就绪之后的管理段
      // （401/403 语义依赖该位置；调用点取本域最早路由 /api/admin/games/stats 的原位置）。
      // 域内 5 条路由 path+method 互不重叠、与相邻其它 admin 域路由无同 path 双匹配，
      // 在管理段内集中到一处不改变匹配语义；runGated（'GET /api/admin/games' 闸键在
      // HEAVY_GATE_CONFIG 留本文件）、adminGamesCache、invalidateAdminGamesCache、
      // invalidateListCache、adminCacheTtlMs 按引用/值传入（语义共享），勿改成拷贝。
      if (
        await handleAdminGamesAdmin({
          path,
          req,
          res,
          url,
          q,
          logger,
          json,
          readBody,
          user,
          requireAdmin,
          runGated,
          adminGamesCache,
          invalidateAdminGamesCache,
          invalidateListCache,
          adminCacheTtlMs,
        })
      )
        return;

      // ---- 管理员：到价提醒（CL 批 docs/USER-ALERTS.md §3.2：全站清单只读+清理；旧加/删兼容保留）----
      if (path === '/api/admin/watchlist' && req.method === 'GET') {
        if (!requireAdmin()) return;
        // EI 批（docs/STEAM-SYNC-STATUS-AND-RATING.md §11）：默认 region 读本位币区域
        const region = String(url.searchParams.get('region') ?? baseRegion());
        const page = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1);
        const pageSize = Math.min(Math.max(Number(url.searchParams.get('pageSize') ?? 20) || 20, 1), 200);
        const username = String(url.searchParams.get('username') ?? '').trim() || null;
        // CU-1（docs/USER-ALERTS-GOVERNANCE.md §2）：status=no_price 只出「无报价」行
        const status = String(url.searchParams.get('status') ?? '');
        const result = await db.listAllWatchesAdmin(q, { region, page, pageSize, username, noPriceOnly: status === 'no_price' });
        // 契约：hasPrice / claimableUsers 用驼峰（规格 §3）；其余字段沿用既有蛇形命名，前端消费不动
        const items = result.items.map(({ has_price: hasPrice, claimable_users: claimableUsers, ...rest }) => ({
          ...rest,
          hasPrice: hasPrice === true,
          claimableUsers: Array.isArray(claimableUsers) ? claimableUsers : [],
        }));
        // DF 批（docs/ALERT-MANUAL-PUSH.md §2 #5）：带已配置的推送渠道名，前端据此禁用「推送」按钮（无通道不可推）
        const notifyChannels = notify.channelsFromEnv().map((c) => c.name);
        return json(res, 200, { ...result, items, region, notifyChannels });
      }

      if (path === '/api/admin/watchlist' && req.method === 'POST') {
        if (!requireAdmin()) return;
        const body = await readBody(req);
        let gameId = Number(body.gameId);
        if (!Number.isFinite(gameId) || gameId <= 0) {
          const appid = Number(body.appid);
          const found = Number.isFinite(appid) && appid > 0 ? await db.gameDetail(q, { steamAppid: appid }) : null;
          if (!found) return json(res, 400, { error: '需要有效的 gameId 或 appid' });
          gameId = found.id;
        }
        let targetCents = null;
        if (body.targetCents != null && body.targetCents !== '') {
          const n = Math.round(Number(body.targetCents));
          if (!Number.isFinite(n) || n < 0) return json(res, 400, { error: '目标价不合法' });
          targetCents = n;
        }
        const id = await db.upsertWatch(q, {
          gameId,
          region: 'cn',
          targetCents,
          note: String(body.note ?? '').trim().slice(0, 200) || null,
        });
        logger?.info('api.watch_saved', { gameId, targetCents, by: user.username });
        return json(res, 200, { id });
      }

      // ---- DF 批（docs/ALERT-MANUAL-PUSH.md §3）：手动推送（单条 / 批量合并一封）----
      // 复用 alerts（buildPushHits/renderDigest/toPayload）+ notify.deliver；仅站点级（用户级 403 只读）；
      // mark 默认勾选；5 分钟频控；审计 admin.alert_pushed。返回 { status, payload } 由路由直接 json。
      const adminPushWatches = async ({ ids, force, mark }) => {
        const channels = notify.channelsFromEnv();
        if (!channels.length) {
          return { status: 400, payload: { error: '未配置任何通知通道，请先在系统设置配置（邮件 / Webhook / 企业微信）' } };
        }

        // 频控：先查每个 watch 的独立桶（"同一 watch"），批量再查整批桶（"同一批"）
        const limitedWatch = ids.map((id) => ({ id, first: alertPushLimited(`w:${id}`) })).find((x) => x.first != null);
        const batchFirst = ids.length > 1 ? alertPushLimited(`b:${[...ids].sort((a, b) => a - b).join(',')}`) : null;
        const limitedFirst = limitedWatch?.first ?? batchFirst;
        if (limitedFirst != null) {
          const retryAfterSec = Math.max(1, Math.ceil((limitedFirst + ALERT_PUSH_WINDOW_MS - Date.now()) / 1000));
          await db.writeAuditLog(q, {
            actorId: user.id,
            actor: user.username,
            action: 'admin.alert_pushed',
            target: `watchlist:${ids.join(',')}`,
            detail: { ids, force, mark, outcome: 'rate_limited', retryAfterSec },
            ip,
          });
          return { status: 429, payload: { error: '5 分钟内已推送过该提醒，请稍后再试', retryAfterSec } };
        }

        const candidates = await db.watchCandidates(q);
        const wanted = new Set(ids);
        const rows = candidates.filter((r) => wanted.has(Number(r.watch_id)));
        // 用户级提醒不可推（仅站点级；与 DELETE 只读语义一致 → 403 + 审计）
        const userRow = rows.find((r) => r.user_id != null);
        if (userRow != null) {
          logger?.warn('admin.forbidden_write', { target: `watchlist:${Number(userRow.watch_id)}`, userId: Number(userRow.user_id), by: user.username, ip });
          await db.writeAuditLog(q, {
            actorId: user.id,
            actor: user.username,
            action: 'admin.forbidden_write',
            target: `watchlist:${Number(userRow.watch_id)}`,
            detail: { userId: Number(userRow.user_id), method: 'POST', path: 'push' },
            ip,
          });
          return { status: 403, payload: { error: '用户提醒不可推送，仅站点级支持' } };
        }
        if (!rows.length) return { status: 404, payload: { error: '提醒不存在或非站点级' } };

        const now = new Date();
        const { hits, skipped } = buildPushHits(rows, { force, now });
        const perRow = [
          ...hits.map((h) => ({ id: h.watchId, name: h.name, sent: true, reason: h.reason })),
          ...skipped.map((s) => ({
            id: s.watchId,
            name: s.name,
            sent: false,
            reason: s.reason,
            currentCents: s.currentCents ?? null,
            targetCents: s.targetCents ?? null,
            histLowCents: s.histLowCents ?? null,
          })),
        ];

        if (!hits.length) {
          const firstSkip = skipped[0];
          const reason = skipped.every((s) => s.reason === 'no_price') ? 'no_price' : 'not_met';
          await db.writeAuditLog(q, {
            actorId: user.id,
            actor: user.username,
            action: 'admin.alert_pushed',
            target: `watchlist:${ids.join(',')}`,
            detail: { ids, force, mark, outcome: 'not_met', perRow },
            ip,
          });
          return {
            status: 200,
            payload: {
              sent: false,
              reason,
              currentCents: firstSkip?.currentCents ?? null,
              targetCents: firstSkip?.targetCents ?? null,
              histLowCents: firstSkip?.histLowCents ?? null,
              results: perRow,
            },
          };
        }

        const { renderAlertsHtml } = await import('./alerts-html.js');
        const mail = renderAlertsHtml(hits, { now });
        const delivery = await notify.deliver(channels, {
          text: renderDigest(hits, { now }),
          html: mail.html,
          payload: toPayload(hits, { now }),
          subject: mail.subject,
          logger,
        });
        if (!delivery.ok) {
          const firstErr = delivery.results.find((r) => !r.ok);
          return { status: 502, payload: { error: `发送失败：${firstErr?.error ?? firstErr?.errcode ?? '未知原因'}` } };
        }

        if (mark) {
          for (const h of hits) await db.markNotified(q, { watchId: h.watchId, priceCents: h.currentCents });
        }
        const channelNames = delivery.results.map((r) => r.channel).join(',');
        logger?.info('api.alert_pushed', { ids: hits.map((h) => h.watchId), force, mark, channels: channelNames, by: user.username });
        await db.writeAuditLog(q, {
          actorId: user.id,
          actor: user.username,
          action: 'admin.alert_pushed',
          target: `watchlist:${ids.join(',')}`,
          detail: { ids, force, mark, outcome: 'sent', sentCount: hits.length, channels: channelNames, perRow },
          ip,
        });
        return {
          status: 200,
          payload: {
            sent: true,
            sentCount: hits.length,
            channel: channelNames,
            markApplied: mark,
            results: perRow,
          },
        };
      };

      const watchPushOne = path.match(/^\/api\/admin\/watchlist\/(\d+)\/push$/);
      if (watchPushOne && req.method === 'POST') {
        if (!requireAdmin()) return;
        const wid = Number(watchPushOne[1]);
        const body = await readBody(req);
        const force = body.force === true;
        const mark = body.mark !== false; // DF：更新最近提醒时间默认勾选
        const result = await adminPushWatches({ ids: [wid], force, mark });
        return json(res, result.status, result.payload);
      }

      if (path === '/api/admin/watchlist/push' && req.method === 'POST') {
        if (!requireAdmin()) return;
        const body = await readBody(req);
        const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
        if (!ids.length) return json(res, 400, { error: '需要选择要推送的提醒' });
        const force = body.force === true;
        const mark = body.mark !== false; // 批量同单条：默认勾选
        const result = await adminPushWatches({ ids, force, mark });
        return json(res, result.status, result.payload);
      }

      // CU-2（docs/USER-ALERTS-GOVERNANCE.md §2/§3）：站点级提醒批量迁移给用户（候选=Steam 愿望单反查，
      // 前端已按 claimableUsers 列出；服务端校验目标用户存在）+ 批量删除；均记审计。
      if (path === '/api/admin/watchlist/migrate' && req.method === 'POST') {
        if (!requireAdmin()) return;
        const body = await readBody(req);
        const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
        const userId = Number(body.userId);
        if (!ids.length) return json(res, 400, { error: '需要选择要迁移的提醒' });
        if (!Number.isInteger(userId) || userId <= 0) return json(res, 400, { error: '需要选择目标用户' });
        const target = await q('select id, username from users where id = $1', [userId]);
        const targetUser = target.rows[0];
        if (!targetUser) return json(res, 404, { error: '目标用户不存在' });
        const result = await db.migrateSiteWatches(q, { ids, userId, region: 'cn' });
        if (result.migrated + result.merged === 0) return json(res, 404, { error: '所选提醒不存在或非站点级' });
        logger?.info('api.watch_migrated', { ids, toUserId: userId, toUsername: targetUser.username, by: user.username, ...result });
        await db.writeAuditLog(q, {
          actorId: user.id,
          actor: user.username,
          action: 'admin.watch_migrated',
          target: `watchlist:${ids.join(',')}`,
          detail: { ids, toUserId: userId, toUsername: targetUser.username, migrated: result.migrated, merged: result.merged },
          ip,
        });
        return json(res, 200, { ok: true, ...result, target: { id: userId, username: targetUser.username } });
      }

      if (path === '/api/admin/watchlist/delete' && req.method === 'POST') {
        if (!requireAdmin()) return;
        const body = await readBody(req);
        const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
        if (!ids.length) return json(res, 400, { error: '需要选择要删除的提醒' });
        const removed = await db.deleteSiteWatches(q, { ids, region: 'cn' });
        if (!removed.length) return json(res, 404, { error: '所选提醒不存在或为用户级（只读）' });
        for (const row of removed) {
          logger?.info('api.watch_deleted', { watchId: Number(row.id), userId: null, gameId: Number(row.game_id), by: user.username });
        }
        await db.writeAuditLog(q, {
          actorId: user.id,
          actor: user.username,
          action: 'admin.watch_deleted',
          target: `watchlist:${removed.map((x) => x.id).join(',')}`,
          detail: { ids: removed.map((x) => Number(x.id)), gameIds: removed.map((x) => Number(x.game_id)), requested: ids },
          ip,
        });
        return json(res, 200, { ok: true, removed: removed.length });
      }

      // CL 批：按提醒 id 清理任意一条（含用户级），记审计 api.watch_deleted
      // CY 批（docs/DATA-ISOLATION.md §3）：用户私有提醒管理员只读——用户行写 → 403 + 审计，
      // 站点级行（user_id IS NULL）保留清理能力。
      const watchDel = path.match(/^\/api\/admin\/watchlist\/(\d+)$/);
      if (watchDel && req.method === 'DELETE') {
        if (!requireAdmin()) return;
        const wid = Number(watchDel[1]);
        const found = await q('select id, user_id, game_id from watchlist where id = $1 and region = \'cn\'', [wid]);
        const row = found.rows[0];
        if (!row) return json(res, 404, { error: '提醒不存在' });
        if (row.user_id != null) {
          logger?.warn('admin.forbidden_write', { target: `watchlist:${wid}`, userId: Number(row.user_id), by: user.username, ip });
          await db.writeAuditLog(q, {
            actorId: user.id,
            actor: user.username,
            action: 'admin.forbidden_write',
            target: `watchlist:${wid}`,
            detail: { userId: Number(row.user_id), method: 'DELETE', path },
            ip,
          });
          return json(res, 403, { error: '用户提醒只读，请让用户自行操作' });
        }
        const deleted = await db.deleteWatchById(q, { id: wid, region: 'cn' });
        if (!deleted) return json(res, 404, { error: '提醒不存在' });
        logger?.info('api.watch_deleted', { watchId: wid, userId: null, gameId: Number(deleted.game_id), by: user.username });
        return json(res, 200, { ok: true, removed: 1 });
      }

      // ---- CO-5/B4-2 第十轮（docs/DESIGN-AUDIT.md B4）：admin-settings 域管理段路由已抽到
      // src/routes/admin-settings.js。调用位置不能动：必须在 requireAdmin 就绪之后的管理段
      // （401/403 语义依赖该位置；调用点取本域最早路由 /api/admin/version 的原位置）。
      // 域内 11 条路由 path+method 互不重叠、与相邻其它 admin 域路由无同 path 双匹配，
      // 在管理段内集中到一处不改变匹配语义；appealEmail 宿主闭包、store（settings
      // hydrateSettings 需要真实 pg store 实例）按引用传入（语义共享），勿改成拷贝。
      if (
        await handleAdminSettingsAdmin({
          path,
          req,
          res,
          url,
          q,
          logger,
          json,
          readBody,
          user,
          requireAdmin,
          store,
          appealEmail,
          invalidateSiteCache,
        })
      )
        return;

      // ---- CO-5/B4-2 第十五轮（docs/DESIGN-AUDIT.md B4）：admin-reports 域管理段路由已抽到
      // src/routes/admin-reports.js。调用位置不能动：必须在 requireAdmin 就绪之后的管理段
      // （401/403 语义依赖该位置；调用点取本域最早路由 /api/admin/backups 的原位置）。
      // 域内 6 条路由 path+method 互不重叠、与相邻其它 admin 域路由无同 path 双匹配，
      // 在管理段内集中到一处不改变匹配语义；本域无跨模块共享的可变状态，ctx 只需基座字段。
      if (
        await handleAdminReportsAdmin({
          path,
          req,
          res,
          url,
          q,
          logger,
          json,
          user,
          requireAdmin,
        })
      )
        return;

      // ---- CO-5/B4-2 第九轮（docs/DESIGN-AUDIT.md B4）：admin-sync 域管理段路由已抽到
      // src/routes/admin-sync.js。调用位置不能动：必须在 requireAdmin 就绪之后的管理段
      // （401/403 语义依赖该位置；调用点取本域最早路由 /api/admin/sync 的原位置）。
      // 域内 13 条路由 path+method 互不重叠、与相邻其它 admin 域路由无同 path 双匹配，
      // 在管理段内集中到一处不改变匹配语义；startSteamJob 宿主闭包、syncState 状态
      // 持有对象、syncStatusCache/invalidateSyncStatusCache 短缓存必须按引用传入
      // （语义共享：任务启停/状态轮询与宿主共用同一子进程槽位与缓存），勿改成拷贝。
      if (
        await handleAdminSyncAdmin({
          path,
          req,
          res,
          url,
          q,
          logger,
          json,
          readBody,
          user,
          requireAdmin,
          startSteamJob,
          syncState,
          syncStatusCache,
          invalidateSyncStatusCache,
          syncStatusTtlMs,
        })
      )
        return;

      // ---- CO-5/B4-2 第八轮（docs/DESIGN-AUDIT.md B4）：admin-access 域管理段路由已抽到
      // src/routes/admin-access.js。调用位置不能动：必须在 requireAdmin 就绪之后的管理段
      // （401/403 语义依赖该位置；调用点取本域最早路由 /api/admin/views 的原位置）。
      // 域内 20 条路由 path+method 互不重叠、与相邻其它 admin 域路由无同 path 双匹配，
      // 在管理段内集中到一处不改变匹配语义；banIpExclusive 是 admin 段闭包 helper
      // （语义共享：与 #11 /api/admin/bulk 批量封禁/信任共用同一 banIpExclusiveSql 口径），
      // 必须按引用传入，勿改成拷贝。
      if (
        await handleAdminAccessAdmin({
          path,
          req,
          res,
          url,
          q,
          logger,
          json,
          readBody,
          user,
          requireAdmin,
          banIpExclusive,
        })
      )
        return;

      // ---- CO-5/B4-2 第十六轮（docs/DESIGN-AUDIT.md B4）：admin-images 域管理段路由已抽到
      // src/routes/admin-images.js。调用位置不能动：必须在 requireAdmin 就绪之后的管理段
      // （401/403 语义依赖该位置；调用点取本域最早路由 /api/admin/images 的原位置）。
      // 域内 4 条路由 path+method 互不重叠、与相邻其它 admin 域路由无同 path 双匹配，
      // 在管理段内集中到一处不改变匹配语义；imgMissCache（负缓存 Map，/img/ 代理路由写、
      // 本域读/清空）、startSteamJob（同步子进程槽位，与 admin-sync 域共用 single-flight）、
      // startSteamJobImpl（EC 批测试注入替身）按引用传入（语义共享），勿改成拷贝。
      if (
        await handleAdminImagesAdmin({
          path,
          req,
          res,
          url,
          q,
          logger,
          json,
          user,
          requireAdmin,
          imgMissCache,
          startSteamJob,
          startSteamJobImpl,
        })
      )
        return;

      // ---- CO-5/B4-2 第五轮（docs/DESIGN-AUDIT.md B4）：公告管理路由已抽到 src/routes/announcements.js ----
      // 管理段调用位置不能动：必须在 requireAdmin 就绪之后（401/403 语义依赖该位置）；
      // toIso 只被本域使用、已随域移入模块。
      if (
        await handleAnnouncementsAdmin({
          path,
          req,
          res,
          url,
          q,
          logger,
          json,
          readBody,
          user,
          requireAdmin,
        })
      )
        return;

      // ---- CO-5/B4-2 第十四轮（docs/DESIGN-AUDIT.md B4）：admin-align 域管理段路由已抽到
      // src/routes/admin-align.js。调用位置不能动：必须在 requireAdmin 就绪之后的管理段
      // （401/403 语义依赖该位置；调用点取本域最早路由 /api/admin/align 的原位置，
      // 即公告管理段接线之后、bulk 之前）。域内 8 组路由 path+method 互不重叠、
      // 与相邻其它 admin 域路由无同 path 双匹配，在管理段内集中到一处不改变匹配语义；
      // triggerAlignGeneration 宿主闭包（后台生成 single-flight 链式排队）、runGated 宿主
      // 闭包（并发闸 Map）与 store（本域事务 store.tx，测试注入）必须按引用传入
      // （语义共享：动作后重算与 GET 首次/refresh 共用同一在途 Promise 链），勿改成拷贝。
      if (
        await handleAdminAlignAdmin({
          path,
          req,
          res,
          url,
          q,
          logger,
          json,
          readBody,
          user,
          requireAdmin,
          store,
          runGated,
          triggerAlignGeneration,
        })
      )
        return;

      return json(res, 404, { error: 'not found' });
    } catch (err) {
      // B1 批：超时后 handler 继续跑完/抛错属预期，不再记 api.error 刷日志（超时本身已记 http.request_timeout）
      if (!timedOut) logger?.error('api.error', { path, message: String(err.message).slice(0, 200) });
      return json(res, 500, { error: '服务器错误' });
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
    }
  });

  return server;
}

/** 访问记录过滤：静态资源与图片代理不记，页面与 API 必记。 */
function isLoggablePath(path) {
  if (path === '/favicon.ico') return false;
  // 前台轮询用的轻量指纹接口：每 10 秒一次，记访问日志只会污染统计
  if (path === '/api/games/stamp') return false;
  // 控制台轮询类接口：只用于刷新 UI，记进访问日志只会让统计虚高
  if (path === '/api/admin/sync/status' || path === '/api/admin/sync/runs') return false;
  if (/\.(png|jpe?g|gif|webp|svg|ico|css|js|map|woff2?|ttf|otf|eot|json|xml|txt|md)$/i.test(path)) return false;
  if (path.startsWith('/img/')) return false;
  return true;
}

/**
 * 黑/白名单互斥（docs/BAN-AND-SECURITY-FIXES.md §4）：加黑自动移白、加白自动移黑，含内存态同步。
 * SQL 在 src/store/pg.js（addBlockedIp / addWhitelistIp 已互斥删除对方表），这里负责内存态与回执。
 * refresh: 是否立即重建内存黑名单（批量场景传 false，跑完由 runner 统一刷一次）。
 * （CO-5/B4-2 第十六轮：跨域共用留本文件——admin-access 域单条封禁/信任与 admin-users 域
 * bulk 批量封禁/信任都经 banIpExclusive 宿主闭包走这里，§15.4 判据。）
 */
async function banIpExclusiveSql(q, ip, note, kind, { refresh = true, markReviews = true } = {}) {
  if (kind === 'ban') {
    const row = await db.addBlockedIp(q, { ip, note });
    if (row.removedFromWhitelist) ratelimit.removeWhitelist(ip);
    // BJ 批 D1：黑名单优先——写黑名单时清掉该 IP 的临时封禁（行保留做审计；与加白清单同一先例）
    await db.clearAbuseBan(q, ip).catch(() => {});
    ratelimit.clearBanMemory(ip);
    if (refresh) await visitors.refreshBlocklist(q).catch(() => {});
    if (markReviews) await db.markReviewsAutoBanned(q, { ip, note: '手动封禁' }).catch(() => {});
    return { ip: row.ip, removedFromWhitelist: row.removedFromWhitelist };
  }
  const row = await db.addWhitelistIp(q, { ip, note });
  if (refresh) await visitors.refreshBlocklist(q).catch(() => {});
  // BR 批 §11.2 决策 1：加白即清封——先把内存态临时封禁清掉，响应回 clearedBan，
  // 手机被误封后管理员加白**不重启**立即恢复（bannedUntil 顺带清过期条目，无副作用）。
  const clearedBan = ratelimit.bannedUntil(ip) !== null;
  ratelimit.addWhitelist(ip);
  ratelimit.clearBanMemory(ip);
  return { ip: row.ip, removedFromBlacklist: row.removedFromBlacklist, clearedBan };
}

/** 基础安全响应头：防嗅探、防点击劫持、限制 referrer 与权限。 */
function applySecurityHeaders(req, res) {
  try {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
    res.setHeader('permissions-policy', 'geolocation=(), microphone=(), camera=()');
    // 敏感页面（封禁/申诉）不收录、不跟随（docs/URL-PARAM-PRIVACY.md §5）
    const pathname = String(req.url ?? '').split('?')[0];
    if (/^\/banned(\/|\.html|$)/.test(pathname) || pathname === '/appeal' || pathname === '/appeal/') {
      res.setHeader('x-robots-tag', 'noindex, nofollow');
    }
    if (pathname === '/appeal' || pathname === '/appeal/') {
      res.setHeader('cache-control', 'no-store');
    }
    // CSP 先以 Report-Only 观察（Element Plus 需要 inline style），跑稳后再切换成强制
    res.setHeader(
      'content-security-policy-report-only',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
        "connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    );
    const proto = String(req.headers['x-forwarded-proto'] ?? '').toLowerCase();
    const https = proto === 'https' || Boolean(req.socket?.encrypted);
    if (https) res.setHeader('strict-transport-security', 'max-age=15552000; includeSubDomains');
  } catch {
    /* 头部设置失败不影响请求 */
  }
}

/** 会话 Cookie：HTTPS 时加 Secure（本地 http 调试不受影响）。 */
function serveStatic(res, outDir, pathname, { cacheControl = null } = {}) {
  if (!outDir) {
    res.writeHead(404).end('not found');
    return;
  }
  let clean = pathname;
  try {
    clean = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400).end('bad request');
    return;
  }
  if (clean === '/') clean = '/index.html';
  if (clean === '/console' || clean === '/console/') clean = '/console.html';
  if (clean === '/setup' || clean === '/setup/') clean = '/setup.html';
  const root = resolve(outDir);
  const file = resolve(root, `.${clean}`);
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  if (!existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
    return;
  }
  const body = readFileSync(file);
  res.writeHead(200, {
    'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': body.length,
    // BS 批（docs/MOBILE-APP-TWA.md §3.2/§5.1）：assetlinks.json / sw.js / app/*.apk 显式 no-cache
    // （TWA 校验与 APK 下载不能吃到旧缓存），其余维持原口径
    'cache-control': cacheControl ?? (file.endsWith('.html') ? 'no-cache' : 'public, max-age=300'),
  });
  res.end(body);
}

/**
 * PWA 根文件（manifest / 图标）：源文件在 frontend/public，构建后落在 dist 根目录。
 * 不能走 outDir——线上 outDir 是 web/（旧页面与图标）或 out/（静态曲线页），
 * 否则 /manifest.webmanifest 与 /icon-*.png 会 404，"添加到主屏幕"直接失效。
 */
export function isFrontendPublicFile(pathname) {
  // BS 批（docs/MOBILE-APP-TWA.md §3.2/§4/§5）：TWA 校验文件、service worker、APK 下载都走 frontendDir，
  // 必须登记——否则"构建成功但线上 404"（本项目老坑：manifest/图标、/login 都踩过）
  return (
    pathname === '/manifest.webmanifest' ||
    pathname.startsWith('/icon-') ||
    pathname === '/.well-known/assetlinks.json' ||
    pathname === '/sw.js' ||
    pathname.startsWith('/app/')
  );
}

/**
 * BM-1（docs/SESSION-MANAGEMENT.md §8.4.1）：前端 SPA 页面白名单。
 * `frontend/src/router/index.js` 里每个页面路径都必须登记在这里，否则未命中路径会落到旧 web/ 目录，
 * 找不到文件就回纯文本 `not found`——v2.11.0 的 `/login` 事故就是这么来的（AL 批新增页面，白名单忘了更新）。
 * 一致性由 test/serve.test.js 断言（新增页面漏登记 → 测试直接红）。
 */
export const FRONTEND_PAGES = [
  '/',
  '/index.html',
  '/console',
  '/console/',
  '/console.html',
  '/setup',
  '/setup/',
  '/setup.html',
  '/banned',
  '/banned/',
  '/banned.html',
  '/appeal',
  '/appeal/',
  // BQ 批（docs/APPEAL-SYSTEM.md §10.4）：邮件内一键处理确认页——必须登记，否则硬打开落旧 web/ 404
  '/appeal/act',
  '/appeal/act/',
  // AL 批（docs/AUTH-REDESIGN.md §5.1）新增的登录/注册/改密页 + BM-1 补齐
  '/login',
  '/login/',
  '/register',
  '/register/',
  '/change-password',
  '/change-password/',
  // BS 批（docs/MOBILE-APP-TWA.md §5.1）：安卓版下载页——必须登记，否则硬打开落旧 web/ → 纯文本 not found
  '/app',
  '/app/',
];

/** Vue 构建产物负责站点所有页面；无构建产物时回退到 web 目录。 */
export function serveFrontendStatic(res, frontendDir, outDir, pathname) {
  if (!frontendDir || !existsSync(resolve(frontendDir, 'index.html'))) return serveStatic(res, outDir, pathname);
  if (FRONTEND_PAGES.includes(pathname)) {
    return serveStatic(res, frontendDir, '/index.html');
  }
  if (pathname.startsWith('/assets/') || isFrontendPublicFile(pathname)) {
    // BS 批：assetlinks.json / sw.js / app/*.apk 不走 max-age 缓存
    const noCache = pathname === '/.well-known/assetlinks.json' || pathname === '/sw.js' || pathname.startsWith('/app/');
    return serveStatic(res, frontendDir, pathname, { cacheControl: noCache ? 'no-cache' : null });
  }
  return serveStatic(res, outDir, pathname);
}

function isFrontendAsset(pathname) {
  return /^\/assets\/[A-Za-z0-9._/-]+\.(?:js|css)$/.test(pathname);
}

export function startApiServer({
  query,
  logger = null,
  outDir = null,
  frontendDir = null,
  port = 8090,
  host = '0.0.0.0',
  store = null,
  setupToken = '',
  getSetupState = null,
  imageFetch = null,
  steamVerify = null,
  imgMissTtl = IMG_MISS_TTL,
  dlcFetchImpl = null,
  dlcReadThrottleMs = 10 * 60_000,
  requestTimeoutMs = 15000,
  gateWaitMs = 15000,
  gateMaxQueue = 20,
  adminCacheTtlMs = 3000,
  syncStatusTtlMs = 3000,
  listCacheTtlMs = 45000,
  siteCacheTtlMs = 60000,
  appSyncFetchImpl = null, // DR 批测试注入：POST /api/admin/app-sync 的 GitHub fetch 替身
  appSyncDir = null, // DR 批测试注入：app-sync 落盘目录（默认 env APP_DATA_DIR ?? data/app）
  startSteamJobImpl = null, // EC 批测试注入：POST /api/admin/images/backfill 的启动替身
}) {
  const server = createApiServer({ query, logger, outDir, frontendDir, store, setupToken, getSetupState, imageFetch, steamVerify, imgMissTtl, dlcFetchImpl, dlcReadThrottleMs, requestTimeoutMs, gateWaitMs, gateMaxQueue, adminCacheTtlMs, syncStatusTtlMs, listCacheTtlMs, siteCacheTtlMs, appSyncFetchImpl, appSyncDir, startSteamJobImpl });
  // 黑名单定时刷新（管理端增删后也会即时刷新；unref 不阻止进程退出）
  const blockTimer = setInterval(() => {
    visitors.refreshBlocklist(query).catch(() => {});
    devices.loadBans(query).catch(() => {});
    ratelimit.loadState(query).catch((err) => logger?.warn('rate.refresh_failed', { message: String(err.message).slice(0, 120) }));
  }, 60_000);
  blockTimer.unref?.();
  return new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, host, async () => {
      server.removeListener('error', fail);
      try {
        await visitors.refreshBlocklist(query);
      } catch (err) {
        logger?.warn('block.init_failed', { message: String(err.message).slice(0, 120) });
      }
      try {
        // 频率限制与白名单：内存计数 + 启动时从库里回填白名单/未到期封禁
        // BR 批：阈值来自 env（settings 水合后为 RATE_LIMIT_PAGE_MAX/API_MAX，DB > env > 默认）
        ratelimit.configureFromEnv(process.env);
        // CO-3/C2：App 设备维度限流阈值同样来自 env（APP_DEVICE_RATE_*，settings 热加载）
        appRateLimit.configureFromEnv(process.env);
        // CF 批：auto-ban 硬规则阈值同样来自 env（SECURITY_AUTOBAN_*，settings 热加载）
        autoBan.configureFromEnv(process.env);
        const loaded = await ratelimit.loadState(query);
        logger?.info('rate.init', { ...ratelimit.currentConfig(), autoBan: autoBan.currentConfig(), ...loaded });
      } catch (err) {
        logger?.warn('rate.init_failed', { message: String(err.message).slice(0, 120) });
      }
      try {
        // 路径守卫：只记录待审核，不自动封禁
        guard.configure({
          enabled: process.env.PATH_REVIEW_ENABLED !== '0',
          unknownMax: Number(process.env.PATH_REVIEW_UNKNOWN_MAX ?? 30),
          unknownWindowSec: Number(process.env.PATH_REVIEW_UNKNOWN_WINDOW_SEC ?? 600),
        });
        logger?.info('guard.init', { ...guard.currentConfig(), outDir: outDir ? resolve(outDir) : null });
      } catch (err) {
        logger?.warn('guard.init_failed', { message: String(err.message).slice(0, 120) });
      }
      try {
        // 设备封禁缓存：只有管理员审批后才会存在；启动回填 + 60s 刷新
        const loaded = await devices.loadBans(query);
        logger?.info('device.init', loaded);
      } catch (err) {
        logger?.warn('device.init_failed', { message: String(err.message).slice(0, 120) });
      }
      try {
        // 服务重启后残留的 running 记录标失败，避免同步按钮永远禁用
        await db.markStaleSyncRuns(query);
      } catch {
        /* 表未建（老库）时忽略 */
      }
      const address = server.address();
      logger?.info('api.listen', { host, port: address.port, outDir: outDir ? resolve(outDir) : null });
      done({
        server,
        port: address.port,
        host,
        close: () => new Promise((r) => {
          clearInterval(blockTimer);
          server.close(r);
        }),
      });
    });
  });
}

export { join };
