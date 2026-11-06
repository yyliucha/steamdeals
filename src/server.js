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
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, resolve, sep } from 'node:path';
import * as db from './store/pg.js';
import * as visitors from './visitors.js';
import * as images from './images.js';
import * as ratelimit from './ratelimit.js';
import * as guard from './guard.js';
import * as devices from './devices.js';
import * as captcha from './captcha.js';
import { createBackup, listBackups } from './backup.js';
import { versionInfo } from './version.js';
import { VERSION } from './settings.js';
import * as settings from './settings.js';
import { handleSetupRoutes } from './setup-routes.js';
import { sessionCookie } from './session-cookie.js';
import { handleSettingsRoutes } from './settings-routes.js';
import { appealEmailFrom } from './appeal.js';
import { ensureSteamSchemaOnce, baseUrl } from './steam-login.js';
import * as mailTemplates from './mail-templates.js';
import * as notify from './notify.js';
import { auditJobs as auditSchedulerJobs } from './scheduler.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const COOKIE = 'gp_session';
const DEVICE_COOKIE = 'gp_device';

// 测试邮件限流：同一管理员 10 秒 1 次（docs/USER-LIFECYCLE.md §7.5）
const mailTestCooldown = new Map();

// 单款价格历史 CSV 默认关闭：线上暂不对外提供（避免被试探出导出能力）；HISTORY_CSV_ENABLED=1 才放行
const historyCsvEnabled = () => process.env.HISTORY_CSV_ENABLED === '1';

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** 是不是浏览器在请求页面（用于决定返回 JSON 还是封禁提示页）。 */
const wantsHtml = (req) =>
  /text\/html/i.test(String(req.headers.accept ?? '')) && !String(req.url ?? '').startsWith('/api/');

/** 手机 UA 粗判（日志用：下次"某个端不生效"时能直接区分 PC/移动端）。 */
const isMobileUa = (req) => /mobile/i.test(String(req.headers['user-agent'] ?? ''));

// 仅被封禁者可见的页面：未封禁访问一律 302 回首页（docs/BAN-AND-SECURITY-FIXES.md §3）。
// 以后新增同类页面必须登记进这里——测试会遍历它，漏登记直接红。
export const BAN_ONLY_PAGES = new Set(['/banned', '/banned/', '/banned.html', '/appeal', '/appeal/']);

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

// /api/ban/state 的自带限流：每 IP 1 次/秒、30 次/分钟（防被当成探测接口；docs/BAN-AND-SECURITY-FIXES.md §3.3）。
const banStateBuckets = new Map(); // ip -> { last, minute: number[] }
function banStateLimited(ip) {
  const key = String(ip || 'anon');
  if (banStateBuckets.size > 10_000) banStateBuckets.clear();
  const now = Date.now();
  const bucket = banStateBuckets.get(key);
  const minute = (bucket?.minute ?? []).filter((t) => now - t < 60_000);
  if (minute.length >= 30) {
    banStateBuckets.set(key, { last: now, minute });
    return true;
  }
  if (bucket && now - bucket.last < 1000) {
    banStateBuckets.set(key, { last: bucket.last, minute });
    return true;
  }
  minute.push(now);
  banStateBuckets.set(key, { last: now, minute });
  return false;
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

/** 封禁提示页：多语言在前端按 navigator.language 选，这里只注入站点名/申诉邮箱/到期时间/申诉编号。 */
function serveBanPage(res, outDir, { status = 403, until = null, reason = '', siteName = 'SteamDeals', appealEmail = '' } = {}, frontendDir = null) {
  const code = newAppealCode();
  const untilIso = until ? new Date(until).toISOString() : '';
  const distIndex = frontendDir && resolve(frontendDir, 'index.html');
  let html;
  if (distIndex && existsSync(distIndex)) {
    const payload = JSON.stringify({ status, until: untilIso, reason, site: siteName, email: appealEmail, code }).replace(/</g, '\\u003c');
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

function deviceCookie(req, value, maxAgeSec) {
  const proto = String(req.headers['x-forwarded-proto'] ?? '').toLowerCase();
  const https = proto === 'https' || Boolean(req.socket?.encrypted);
  return `${DEVICE_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${https ? '; Secure' : ''}`;
}

const toIso = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

// 封面图内存热缓存：数据库是持久层，这里只放最近访问的少量图片（LRU，约 300 张）
const imgMemCache = new Map(); // appid/size -> { contentType, body }
const IMG_MEM_MAX = 300;
// 取图失败缓存：5 分钟内不再重试，避免每次都拖满超时
const imgMissCache = new Map(); // appid/size -> ts

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
  steamWishlistPush = null, // 测试注入：({steamId, apiKey, appid, action}) => Promise<{ok, reason}>；默认走 IWishlistService 推送
}) {
  const q = query;
  // 手动同步的进程内状态：同一时刻只允许一个同步任务
  let syncChild = null;
  let syncRun = null; // { id, mode, startedAt, params }
  let syncOutput = ''; // 子进程输出尾巴，供前端轮询
  let syncSettled = true;
  let syncStopRequested = false; // 后台点了"停止"，子进程退出后记为 cancelled

  // Steam 绑定 state 的进程内登记表：随机串 → { userId, expiresAt }，5 分钟过期。
  // 必须放在请求处理器之外：/start 签发、/callback 消费，跨两次请求共享（steam-login.js 实现）。
  const bindStates = new Map();

  /**
   * 启动一个 Steam 子进程任务（同步 / 回填共用同一个槽位，保证同一时间只有一个任务）。
   * 记录到 sync_runs，输出尾巴供前端轮询；返回 { runId, pid }。
   */
  async function startSteamJob({ mode, args, params = null, by = null }) {
    if (syncChild) {
      const err = new Error('已有任务在运行（同步/回填），请等它结束');
      err.code = 'BUSY';
      err.run = syncRun;
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
    syncChild = child;
    syncRun = { id: run.id, mode, args: args.join(' '), startedAt: run.startedAt, params };
    syncOutput = '';
    syncSettled = false;
    syncStopRequested = false;
    const append = (chunk) => {
      syncOutput = (syncOutput + chunk).slice(-8000);
      try {
        fsMod.appendFileSync('logs/spawn.log', chunk);
      } catch {
        /* 日志目录不可写时忽略，DB 里仍有输出 */
      }
    };
    const finish = async (status, exitCode, note) => {
      if (syncSettled) return;
      syncSettled = true;
      syncChild = null;
      if (syncStopRequested) status = 'cancelled';
      if (note) append('\n' + note);
      try {
        await db.finishSyncRun(q, run.id, { status, exitCode, output: syncOutput });
      } catch {
        /* 记录失败不影响主流程 */
      }
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
    if (wantsHtml(req)) {
      const code = serveBanPage(res, outDir, { status, until, reason, siteName: siteName(), appealEmail: appealEmail() }, frontendDir);
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

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
      const appealPage = path === '/appeal' || path === '/appeal/';
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[COOKIE] ?? null;

    try {
      // ---- 基础安全响应头（所有响应都带）----
      applySecurityHeaders(req, res);

      // ---- 访问者 IP + 黑名单 + 频率限制（整站拦截，静态资源也一样拦）----
      const ip = visitors.clientIp(req);

      // 白名单：不计数、不受黑名单限制
      const whitelisted = ratelimit.isWhitelisted(ip);

      // 管理员放行：避免把自己拉黑后连控制台都进不去
      let adminBypass = false;
      if (token) {
        try {
          const u = await db.userBySession(q, token);
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
      // 必须在拦截链之前：被封禁者也要拿得到自己的状态。只用内存态（devices.isBanned /
      // ratelimit.bannedUntil / visitors.blockedBy），不查库、不计数；自带限流 1 次/秒、30 次/分钟；
      // 只回调用者自己的 {banned,type,until}，不含名单内容、不含他人 IP。
      if (path === '/api/ban/state' && req.method === 'GET') {
        if (banStateLimited(ip)) {
          return json(res, 429, { error: '请求过于频繁' }, { 'cache-control': 'no-store', 'retry-after': '1' });
        }
        let state = { banned: false };
        if (!whitelisted) {
          const devBan = deviceId ? devices.isBanned({ deviceId }) : null;
          const rateUntil = ip ? ratelimit.bannedUntil(ip) : null;
          const ipBlocked = ip ? visitors.blockedBy(ip) : null;
          if (devBan) state = { banned: true, type: 'device', until: devBan.until ? new Date(devBan.until).toISOString() : null };
          else if (rateUntil) state = { banned: true, type: 'rate', until: new Date(rateUntil).toISOString() };
          else if (ipBlocked) state = { banned: true, type: 'ip', until: null };
        }
        return json(res, 200, state, { 'cache-control': 'no-store' });
      }

      const deviceBan = deviceId && !adminBypass && !whitelisted ? devices.isBanned({ deviceId }) : null;
      if (deviceBan && !appealPage) {
        if (req.method === 'GET' && isFrontendAsset(path)) return serveFrontendStatic(res, frontendDir, outDir, path);
        logger?.warn('device.denied', { ip, deviceId, until: deviceBan.until });
        logBlocked({ ip, req, path, status: 403, reason: '设备已被封禁' });
        return denyBanned(req, res, { status: 403, until: deviceBan.until, reason: '设备已被封禁', ip });
      }

      // 频率限制：白名单/管理员不参与三振；内网/本机（反代、健康检查）不计数
      // 分桶：页面/API 与静态资源/图片分开计数——一个列表页几十张封面不该顶到页面阈值
      if (ip && !whitelisted && !adminBypass && !visitors.isPrivateAddress(ip) && !appealPage) {
        // 统一走 hit：封禁期内的请求也会被计数，够数就记一条待审核（**不再自动永久封**）
        const verdict = await ratelimit.hit(q, ip, { bucket: guard.isAssetPath(path) ? 'asset' : 'page' });
        if (verdict.limited) {
          if (req.method === 'GET' && isFrontendAsset(path)) return serveFrontendStatic(res, frontendDir, outDir, path);
          const until = Number(verdict.until) || 0;
          logger?.warn('rate.limited', {
            ip,
            path,
            strikes: verdict.strikes ?? null,
            reason: verdict.reason,
            escalated: Boolean(verdict.escalated),
            needsReview: Boolean(verdict.needsReview),
          });
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

      const hit = ip && !adminBypass && !whitelisted ? visitors.blockedBy(ip) : null;
      if (hit && !appealPage) {
        if (req.method === 'GET' && isFrontendAsset(path)) return serveFrontendStatic(res, frontendDir, outDir, path);
        logger?.warn('block.ip_denied', { ip, path, rule: hit });
        logBlocked({ ip, req, path, status: 403, reason: `IP 黑名单（${hit}）` });
        return denyBanned(req, res, { status: 403, reason: '访问被拒绝', ip });
      }

      // ---- 路径守卫：白名单 / 扫描器签名 / 未知路径计数 ----
      // 只记录待审核，**绝不自动封禁**；管理员在控制台审批后才封 IP/设备。
      if (ip && !whitelisted && !adminBypass && !visitors.isPrivateAddress(ip) && visitors.isIpLike(ip)) {
        try {
          await guard.inspect({
            ip,
            path,
            method: req.method ?? 'GET',
            outDir,
            logger,
            onReview: (payload) =>
              recordReview({
                ip,
                deviceId,
                fingerprint: devices.fingerprintFor(deviceId),
                ...payload,
              }),
          });
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
        const rateUntil = ip ? ratelimit.bannedUntil(ip) : null;
        if (rateUntil) return { type: 'rate', until: rateUntil };
        if (hit) return { type: 'ip', rule: hit };
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

      // 静态资源（页面本身仍由 chart 生成，这里只发文件）
      // 注意：/img/ 是服务端图片代理路由（本地缓存 → CDN 兜底），不能当静态文件处理，
      // 否则会直接 404——这正是之前"前台只有名字没有图"的真正原因。
      if (!path.startsWith('/api/') && !path.startsWith('/img/')) {
        return serveFrontendStatic(res, frontendDir, outDir, path);
      }

      // ---- 公开接口：站点信息 / 公告 / 设备指纹上报 ----
      if (path === '/api/site' && req.method === 'GET') {
        return json(res, 200, {
          name: siteName(),
          version: VERSION,
          appealEmail: appealEmail(),
          // 前台成人内容展示策略（hide/badge/show），Home 卡片按它决定角标
          adultDisplay: String(process.env.SITE_ADULT_DISPLAY ?? 'hide'),
        });
      }
      if (path === '/api/announcements' && req.method === 'GET') {
        const rows = await db.listAnnouncements(q, { activeOnly: true, limit: 200 });
        // 登录用户附带服务端已读 id（跨设备跟随账号）；游客本地记录，接口只给空数组
        const sessUser = token ? await db.userBySession(q, token) : null;
        let readIds = [];
        if (sessUser) {
          const reads = await q('select announcement_id from announcement_reads where user_id = $1', [sessUser.id]);
          readIds = reads.rows.map((r) => Number(r.announcement_id));
        }
        return json(
          res,
          200,
          {
            announcements: rows.map((r) => ({
              id: Number(r.id),
              title: r.title,
              body: r.body,
              level: r.level,
              startsAt: r.starts_at,
              endsAt: r.ends_at,
            })),
            readIds,
          },
          { 'cache-control': 'no-store' },
        );
      }
      if (path === '/api/device' && req.method === 'POST') {
        let body;
        try {
          body = await readBody(req, 16 * 1024);
        } catch {
          return json(res, 400, { error: '请求格式错误' });
        }
        if (!body || typeof body !== 'object') return json(res, 400, { error: '请求格式错误' });
        const deviceId = devices.normalizeDeviceId(body?.deviceId);
        const details = devices.sanitizeDetails(body?.details);
        const fingerprint = devices.fingerprintOf(details);
        const cookie = deviceCookie(req, deviceId, deviceId ? 31536000 : 0);
        const ban = devices.isBanned({ deviceId, fingerprint });
        if (ban) {
          logger?.warn('device.banned', { ip, deviceId: deviceId || null, fingerprint: fingerprint.slice(0, 16), until: ban.until });
          return json(res, 403, { banned: true, until: ban.until, reason: ban.note || '设备已被封禁' }, { 'set-cookie': cookie });
        }
        if (deviceId) devices.rememberDevice(deviceId, fingerprint, details);
        if (devices.shouldLog(deviceId || fingerprint)) {
          db.insertDeviceLog(q, { ip, deviceId, fingerprint, userAgent: req.headers['user-agent'], details }).catch(() => {});
        }
        return json(res, 200, { ok: true, fingerprint: fingerprint.slice(0, 16) }, { 'set-cookie': cookie });
      }

      const user = token ? await db.userBySession(q, token) : null;
      // Steam 账号相关表幂等建表（一次后为 no-op）。列表/详情的「已拥有推导」SQL 会 join
      // steam_games / steam_accounts / steam_wishlist，必须先于任何查询存在——不能只放在
      // Steam 路由块里，否则该块之前的路由（如 /api/games/search）在全新库上会 500。
      await ensureSteamSchemaOnce(q);

      // 邮箱验证码路由（发送 / 校验），逻辑在 auth-routes.js
      const authRoutes = await import('./auth-routes.js');
      if (await authRoutes.handleEmailAuth({ path, req, res, q, logger, json, readBody })) return;
      const requireUser = () => {
        if (!user) {
          json(res, 401, { error: '需要登录' });
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

      // 黑/白名单互斥（docs/BAN-AND-SECURITY-FIXES.md §4）：加黑移白、加白移黑，含内存态同步。
      // 单条/审核/批量四个入口都走这里，保证口径一致、不会再出现"同一 IP 两边都在"。
      const banIpExclusive = (ip, note, kind, opts) => banIpExclusiveSql(q, ip, note, kind, opts);

      // 系统设置（管理员）：读写 app_settings / smtp_settings
      if (path.startsWith('/api/admin/settings')) {
        if (!requireAdmin()) return;
        const handled = await handleSettingsRoutes({ path, req, res, q, store, logger, json, readBody, user });
        if (handled) return;
      }

      // ---- 登录 / 登出 ----
      // ---- 图形验证码（登录前置，匿名可拿；缓存禁止）----
      if (path === '/api/captcha' && req.method === 'GET') {
        const cap = await captcha.issue(q);
        return json(res, 200, cap, { 'cache-control': 'no-store' });
      }

      if (path === '/api/login' && req.method === 'POST') {
        const body = await readBody(req);
        // 验证码校验放在密码之前：没通过就不会消耗一次密码尝试，也不会泄露账号是否存在
        if (captcha.enabled()) {
          const okCaptcha = await captcha.verify(q, body.captchaToken, body.captchaAnswer);
          if (!okCaptcha) {
            logger?.warn('api.login_captcha_failed', { ip, username: String(body.username ?? '').slice(0, 32) });
            return json(res, 400, { error: '验证码错误或已过期，请重新输入' });
          }
        }
        const found = await db.findUserByName(q, String(body.username ?? ''));
        if (!found || found.disabled || !db.verifyPassword(String(body.password ?? ''), found.password_hash)) {
          logger?.warn('api.login_failed', { username: String(body.username ?? '').slice(0, 32), disabled: Boolean(found?.disabled) });
          return json(res, 401, { error: found?.disabled ? '账号已被禁用' : '用户名或密码错误' });
        }
        const sessionToken = await db.createSession(q, { userId: found.id });
        logger?.info('api.login', { userId: found.id, username: found.username });
        return json(
          res,
          200,
          { user: { id: found.id, username: found.username, role: found.role } },
          { 'set-cookie': sessionCookie(req, sessionToken, 604800) },
        );
      }

      if (path === '/api/logout' && req.method === 'POST') {
        await db.deleteSession(q, token);
        return json(res, 200, { ok: true }, { 'set-cookie': sessionCookie(req, '', 0) });
      }

      // ---- 当前用户与偏好 ----
      if (path === '/api/me' && req.method === 'GET') {
        const prefs = user ? await db.getPrefs(q, user.id) : null;
        return json(res, 200, {
          user: user ? { id: user.id, username: user.username, role: user.role } : null,
          prefs,
          // 站点时区（系统设置里的「时区」）：前端用它格式化时间，而不是浏览器本地时区
          timezone: process.env.TZ || 'Asia/Shanghai',
        });
      }

      if (path === '/api/prefs' && req.method === 'POST') {
        if (!requireUser()) return;
        const body = await readBody(req);
        const prefs = await db.savePrefs(q, user.id, body);
        logger?.info('api.prefs_saved', { userId: user.id, ...prefs });
        return json(res, 200, { prefs });
      }

      // ---- 游戏数量（匿名可读）：库内总数 + 已有价格数，前台"实时数量"靠它 ----
      if (path === '/api/games/count' && req.method === 'GET') {
        const priced = await q('select count(*)::int as n from (select distinct game_id from daily_prices) x');
        const catalog = await q('select count(*)::int as n from games where not deleted and not blocked');
        return json(res, 200, { priced: priced.rows[0]?.n ?? 0, catalog: catalog.rows[0]?.n ?? 0 });
      }

      // ---- 公告已读（登录用户写表；游客只存浏览器本地，不调用）----
      if (path === '/api/announcements/read' && req.method === 'POST') {
        if (!requireUser()) return;
        const body = await readBody(req);
        const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
        // 只写真实存在的公告 id（客户端可能带已删除的旧 id，FK 会拒绝）
        const valid = ids.length ? (await q('select id from announcements where id = any($1::bigint[])', [ids])).rows.map((r) => Number(r.id)) : [];
        if (valid.length) {
          await q(
            'insert into announcement_reads (user_id, announcement_id) select $1, x.id from unnest($2::bigint[]) as x(id) on conflict (user_id, announcement_id) do nothing',
            [user.id, valid],
          );
        }
        logger?.info('announcement.read', { userId: user.id, count: valid.length });
        return json(res, 200, { ok: true, readIds: valid });
      }

      // ---- 数据指纹（匿名可读）：前台轮询这个，变了才重新拉列表 ----
      // 只做低成本聚合：别再让每次自动刷新都跑一遍完整列表查询。
      // 说明：价格/库存变化会更新 offers.last_seen_at，新游戏/新报价会改变计数，
      // 所以这三项足够判断"列表内容是否需要重新拉"。
      if (path === '/api/games/stamp' && req.method === 'GET') {
        const r = await q(
          `select (select count(*)::int from games) as games,
                  (select count(*)::int from offers) as offers,
                  (select max(last_seen_at)::text from offers) as offers_seen`,
        );
        const row = r.rows[0] ?? {};
        const stamp = [row.games, row.offers, row.offers_seen].join('|');
        return json(res, 200, { stamp, ...row }, { 'cache-control': 'no-store' });
      }

      // ---- 游戏列表（匿名可读）：GET 保留旧接口；POST 用于游客本地标记筛选 ----
      const guestSearchPost = path === '/api/games/search' && req.method === 'POST';
      if ((path === '/api/games' && req.method === 'GET') || guestSearchPost) {
        const body = guestSearchPost ? await readBody(req, 256 * 1024) : {};
        const getInput = (key) => guestSearchPost ? body?.[key] : url.searchParams.get(key);
        const oneOf = (key, allowed, fallback) => {
          const v = String(getInput(key) ?? '').trim();
          return allowed.includes(v) ? v : fallback;
        };
        const interest = oneOf('interest', ['all', 'on', 'off'], 'all');
        const ownedParam = oneOf('owned', ['exclude', 'only', 'include'], 'exclude');
        const blockedParam = oneOf('blocked', ['exclude', 'only', 'include'], 'exclude');
        const sort = oneOf('sort', ['discount', 'price', 'name'], 'discount');
        const typeFilter = oneOf('type', ['all', 'game', 'dlc'], 'all');
        const released = oneOf('released', ['all', '30d', '1y', '3y'], 'all');
        // 成人内容展示策略（docs/STEAM-SYNC-STATUS-AND-RATING.md §5.2）：
        // hide=前台不展示（默认，由系统设置 site.adultDisplay 决定）；badge/show 不过滤
        const adult = oneOf('adult', ['hide', 'badge', 'show'], String(process.env.SITE_ADULT_DISPLAY ?? 'hide'));
        // marks=unmarked：「全部」页签——排除用户已标 感兴趣/不感兴趣 的游戏（已拥有由 owned 参数排除）
        const marks = oneOf('marks', ['any', 'unmarked'], 'any');
        const compact = guestSearchPost || url.searchParams.get('compact') === '1';
        const keyword = String(getInput('q') ?? '').slice(0, 80);
        const pageSize = Math.min(
          Math.max(Number(guestSearchPost ? getInput('pageSize') ?? 20 : url.searchParams.get('pageSize') ?? url.searchParams.get('limit') ?? 20) || 20, 5),
          100,
        );
        const page = Math.max(1, Number(getInput('page') ?? 1) || 1);
        const maxBigintId = 9223372036854775807n;
        const normalizeIds = (value) => Array.isArray(value)
          ? [...new Set(value.slice(0, 5000).map((id) => String(id)).filter((id) => /^\d{1,19}$/.test(id) && BigInt(id) > 0n && BigInt(id) <= maxBigintId))]
          : [];
        const guestFlags = guestSearchPost && !user ? {
          interestedIds: normalizeIds(body?.guestFlags?.interestedIds),
          uninterestedIds: normalizeIds(body?.guestFlags?.uninterestedIds),
          ownedIds: normalizeIds(body?.guestFlags?.ownedIds),
          excludeIds: normalizeIds(body?.guestFlags?.excludeIds),
        } : null;
        const result = await db.gameSearch(q, {
          region: String(getInput('region') ?? 'cn').slice(0, 12),
          page,
          pageSize,
          keyword,
          sort,
          interest,
          owned: ownedParam,
          blocked: blockedParam,
          userId: user?.id ?? null,
          typeFilter,
          released,
          marks,
          compact,
          guestFlags,
          adult,
          // 愿望单是登录用户专属维度；游客传入的 wishlist=true 一律无效
          wishlist: Boolean(user && guestSearchPost && body?.wishlist === true),
        });
        return json(res, 200, {
          games: result.rows,
          total: result.total,
          page: result.page,
          pageSize: result.pageSize,
          pages: result.pages,
          sort,
          owned: ownedParam,
          interest,
          q: keyword,
          type: typeFilter,
        });
      }

      // ---- 单个游戏（匿名可读）----
      // ---- 单个游戏（按内部 id，用于没有 Steam appid 的杉果游戏）----
      const byIdMatch = path.match(/^\/api\/games\/by-id\/(\d+)$/);
      if (byIdMatch && req.method === 'GET') {
        const id = Number(byIdMatch[1]);
        const game = await db.gameDetail(q, { gameId: id, region: url.searchParams.get('region') ?? 'cn', userId: user?.id ?? null, adult: String(process.env.SITE_ADULT_DISPLAY ?? 'hide') });
        if (!game) return json(res, 404, { error: '没有该游戏' });
        const offers = await db.offersOfGame(q, { gameId: game.id, region: 'cn' });
        const series = await db.dailyMinSeries(q, { gameId: game.id, region: 'cn' });
        if (user) await db.recordView(q, { userId: user.id, path: `/game/id/${id}`, appid: game.steam_appid ?? null });
        return json(res, 200, { game, offers, series });
      }

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

        // 3) 本地没有：走三条 CDN 兜底取一次，成功后落盘
        const missAt = imgMissCache.get(key);
        if (missAt && Date.now() - missAt < 5 * 60 * 1000) {
          res.writeHead(404);
          res.end();
          return;
        }
        const fetcher = imageFetch ?? (await import('./http.js')).fetchBuffer;
        const got = await images.downloadImage(appid, size, { fetchBuffer: fetcher, timeoutMs: 8000 });
        if (got.ok) {
          memoPutImage(key, { contentType: got.contentType, body: got.body });
          logger?.info('steam.img_cached', { appid, size, bytes: got.bytes });
          res.writeHead(200, imgHeaders(got.contentType, got.body.length));
          res.end(got.body);
          return;
        }
        imgMissCache.set(key, Date.now());
        if (imgMissCache.size > 2000) imgMissCache.delete(imgMissCache.keys().next().value);
        logger?.warn('steam.img_miss', { appid, size, message: String(got.error?.message ?? '').slice(0, 160) });
        res.writeHead(404);
        res.end();
        return;
      }

      const gameMatch = path.match(/^\/api\/games\/(\d+)$/);
      if (gameMatch && req.method === 'GET') {
        const appid = Number(gameMatch[1]);
        // 单款查询：不走"列表前 500 名"，否则排在后面的游戏会 404（后台编辑曾因此失败）
        const game = await db.gameDetail(q, { steamAppid: appid, region: url.searchParams.get('region') ?? 'cn', userId: user?.id ?? null, adult: String(process.env.SITE_ADULT_DISPLAY ?? 'hide') });
        if (!game) return json(res, 404, { error: '没有该游戏' });
        const offers = await db.regionOffers(q, { steamAppid: appid });
        const series = await db.dailyMinSeries(q, { gameId: game.id, region: 'cn' });
        if (user) await db.recordView(q, { userId: user.id, path: `/game/${appid}`, appid });
        return json(res, 200, { game, offers, series });
      }

      // ---- 登录用户：个人标记（个人优先，未标记回退全局标记）----
      const flagsByAppid = path.match(/^\/api\/games\/(\d+)\/flags$/);
      const flagsById = path.match(/^\/api\/games\/id\/(\d+)\/flags$/);
      if ((flagsByAppid || flagsById) && req.method === 'POST') {
        if (!requireUser()) return;
        const body = await readBody(req);
        let gameId = null;
        if (flagsByAppid) {
          const found = await db.gameDetail(q, { steamAppid: Number(flagsByAppid[1]) });
          if (!found) return json(res, 404, { error: '没有该游戏' });
          gameId = found.id;
        } else {
          gameId = Number(flagsById[1]);
        }
        // 'clear' = 显式清除个人标记（回退全局）；boolean = 设置；其余 = 不改动
        const pick = (v) => (v === 'clear' ? 'clear' : typeof v === 'boolean' ? v : null);
        const flags = await db.setUserGameFlag(q, {
          userId: user.id,
          gameId,
          interested: pick(body.interested),
          owned: pick(body.owned),
        });
        if (!flags) return json(res, 404, { error: '没有该游戏' });
        logger?.info('api.user_flag', { userId: user.id, gameId, interested: flags.interested, owned: flags.owned });
        return json(res, 200, { flags });
      }

      // ---- 管理员：标记兴趣、看用户 ----
      const interestMatch = path.match(/^\/api\/games\/(\d+)\/interest$/);
      if (interestMatch && req.method === 'POST') {
        if (!requireAdmin()) return;
        const body = await readBody(req);
        const appid = Number(interestMatch[1]);
        const row = await db.setInterest(q, { steamAppid: appid, interested: Boolean(body.interested) });
        if (!row) return json(res, 404, { error: '没有该游戏' });
        logger?.info('api.interest', { appid, interested: row.interested, by: user.username });
        return json(res, 200, { game: row });
      }

      // ---- 管理员：标记已拥有 ----
      const ownedMatch = path.match(/^\/api\/games\/(\d+)\/owned$/);
      if (ownedMatch && req.method === 'POST') {
        if (!requireAdmin()) return;
        const body = await readBody(req);
        const appid = Number(ownedMatch[1]);
        const row = await db.setOwned(q, { steamAppid: appid, owned: Boolean(body.owned) });
        if (!row) return json(res, 404, { error: '没有该游戏' });
        logger?.info('api.owned', { appid, owned: row.owned, by: user.username });
        return json(res, 200, { game: row });
      }

      // ---- 管理员：按内部 id 标记（杉果等没有 Steam appid 的游戏）----
      const byIdInterest = path.match(/^\/api\/games\/id\/(\d+)\/interest$/);
      if (byIdInterest && req.method === 'POST') {
        if (!requireAdmin()) return;
        const body = await readBody(req);
        const gameId = Number(byIdInterest[1]);
        const row = await db.setInterest(q, { gameId, interested: Boolean(body.interested) });
        if (!row) return json(res, 404, { error: '没有该游戏' });
        logger?.info('api.interest_by_id', { gameId, interested: row.interested, by: user.username });
        return json(res, 200, { game: row });
      }

      const byIdOwned = path.match(/^\/api\/games\/id\/(\d+)\/owned$/);
      if (byIdOwned && req.method === 'POST') {
        if (!requireAdmin()) return;
        const body = await readBody(req);
        const gameId = Number(byIdOwned[1]);
        const row = await db.setOwned(q, { gameId, owned: Boolean(body.owned) });
        if (!row) return json(res, 404, { error: '没有该游戏' });
        logger?.info('api.owned_by_id', { gameId, owned: row.owned, by: user.username });
        return json(res, 200, { game: row });
      }

      // ---- 管理员：用户管理（编辑 / 改密码 / 禁用）----
      // ---- Steam 多账号绑定 / 游戏库 / 愿望单（身份由站点会话决定，steam_sessions 已停用）----
      const steamMod = await import('./steam-login.js');
      const steamAccountsMod = await import('./steam-accounts.js');

      const MAX_ACCOUNTS_PER_USER = 5;

      const requireSteamApiKey = () => {
        const apiKey = String(process.env.STEAM_API_KEY ?? '').trim();
        if (!apiKey) {
          json(res, 400, { error: '未配置 STEAM_API_KEY（Steam Web API Key）' });
          return null;
        }
        return apiKey;
      };

      // 当前登录用户对该账号的所有权检查：返回账号行，无权/不存在返回 null（响应已写出）
      const requireAccountOwner = async (steamId) => {
        const found = await q('select steam_id, user_id from steam_accounts where steam_id = $1', [steamId]);
        const row = found.rows[0];
        if (!row) {
          json(res, 404, { error: '没有该 Steam 账号' });
          return null;
        }
        if (row.user_id == null || Number(row.user_id) !== Number(user.id)) {
          json(res, 403, { error: '这个 Steam 账号不属于当前用户' });
          return null;
        }
        return row;
      };

      if (path === '/api/auth/steam/start' && req.method === 'GET') {
        if (!requireUser()) return;
        const state = steamMod.issueBindState(bindStates, user.id);
        const target = steamMod.buildLoginUrl(steamMod.baseUrl(req), state);
        logger?.info('steam.bind_start', { userId: user.id, host: req.headers.host });
        res.writeHead(302, { location: target, 'cache-control': 'no-store' });
        res.end();
        return;
      }

      if (path.startsWith('/api/auth/steam/callback')) {
        const bindResult = (location) => {
          const params = new URL(location, 'http://localhost').searchParams;
          // 成功（带 steamBound）一律 302；错误时浏览器 302 到控制台展示提示、API 客户端回 JSON 状态码
          if (params.has('steamBound') || !params.has('steamError')) {
            res.writeHead(302, { location, 'cache-control': 'no-store' });
            res.end();
            return;
          }
          if (wantsHtml(req)) {
            res.writeHead(302, { location, 'cache-control': 'no-store' });
            res.end();
          } else {
            const code = String(params.get('steamError') ?? '');
            const messages = {
              state: '绑定链接已失效或过期，请重新发起绑定',
              conflict: '该 Steam 账号已被其他用户绑定',
              limit: '最多绑定 5 个 Steam 账号',
              verify: 'Steam 校验失败，请重试',
            };
            const status = code === 'conflict' || code === 'limit' ? 409 : 400;
            json(res, status, { error: messages[code] ?? '绑定失败，请重试', code });
          }
          return;
        };
        // 1) 校验 state（防 CSRF / 防串号）＋ 与当前站点会话用户一致
        const stateUserId = steamMod.consumeBindState(bindStates, url.searchParams.get('state'));
        if (!stateUserId) {
          logger?.warn('steam.bind_state_invalid', { ip });
          return bindResult('/console?section=steam&steamError=state');
        }
        if (!user || Number(user.id) !== Number(stateUserId)) {
          logger?.warn('steam.bind_session_mismatch', { stateUserId, sessionUserId: user?.id ?? null });
          return bindResult('/console?section=steam&steamError=state');
        }
        // 2) Steam OpenID 校验 → steamId
        const steamId = await (steamVerify ?? steamMod.verifyCallback)(url, { logger });
        if (!steamId) return bindResult('/console?section=steam&steamError=verify');
        // 3) 唯一性 / 上限校验
        const existing = await q('select user_id from steam_accounts where steam_id = $1', [steamId]);
        const ownerId = existing.rows[0]?.user_id ?? null;
        if (ownerId != null && Number(ownerId) !== Number(user.id)) {
          logger?.warn('steam.bind_conflict', { steamId, ownedBy: ownerId, by: user.id });
          return bindResult('/console?section=steam&steamError=conflict');
        }
        if (ownerId == null) {
          const count = await q('select count(*)::int as n from steam_accounts where user_id = $1', [user.id]);
          if (Number(count.rows[0]?.n ?? 0) >= MAX_ACCOUNTS_PER_USER) {
            logger?.warn('steam.bind_limit', { steamId, userId: user.id, count: count.rows[0].n });
            return bindResult('/console?section=steam&steamError=limit');
          }
        }
        // 4) 落库（已绑定同人 = 幂等，只刷新昵称/头像）
        const apiKey = String(process.env.STEAM_API_KEY ?? '').trim();
        const persona = await steamMod.fetchPersona({ apiKey, steamId, logger });
        await q(
          "insert into steam_accounts (steam_id, persona_name, avatar, user_id, last_login_at) values ($1, $2, $3, $4, now()) " +
            'on conflict (steam_id) do update set persona_name = coalesce(excluded.persona_name, steam_accounts.persona_name), ' +
            'avatar = coalesce(excluded.avatar, steam_accounts.avatar), last_login_at = now()',
          [steamId, persona.personaName, persona.avatar, user.id],
        );
        logger?.info('steam.bind_ok', { steamId, userId: user.id, persona: persona.personaName ?? null });
        // 5) 自动同步库 + 愿望单（失败只记日志，不阻断绑定）
        if (apiKey) {
          try {
            await steamAccountsMod.syncAccountLibrary(q, { steamId, apiKey, logger });
          } catch (err) {
            logger?.warn('steam.bind_library_failed', { steamId, message: String(err.message).slice(0, 160) });
          }
          try {
            await steamAccountsMod.backfillOwnedAppTypes(q, { steamId, apiKey, logger });
          } catch (err) {
            logger?.warn('steam.bind_types_failed', { steamId, message: String(err.message).slice(0, 160) });
          }
          try {
            await steamAccountsMod.syncAccountWishlist(q, { steamId, apiKey, userId: user.id, logger });
          } catch (err) {
            logger?.warn('steam.bind_wishlist_failed', { steamId, message: String(err.message).slice(0, 160) });
          }
        }
        return bindResult('/console?section=steam&steamBound=1');
      }

      if (path === '/api/steam/accounts' && req.method === 'GET') {
        if (!requireUser()) return;
        const accounts = await steamAccountsMod.listUserAccounts(q, user.id);
        const unowned = user.role === 'admin' ? await steamAccountsMod.listUnownedAccounts(q) : [];
        return json(res, 200, { accounts, unowned, limit: MAX_ACCOUNTS_PER_USER });
      }

      if (path === '/api/steam/me' && req.method === 'GET') {
        // 兼容接口：旧单账号字段取第一个绑定账号，新前端用 accounts 数组。
        const accounts = user ? await steamAccountsMod.listUserAccounts(q, user.id) : [];
        const first = accounts[0] ?? null;
        return json(res, 200, {
          steamId: first?.steam_id ?? null,
          persona_name: first?.persona_name ?? null,
          avatar: first?.avatar ?? null,
          accounts,
        });
      }

      const accountMatch = path.match(/^\/api\/steam\/accounts\/([^/]+)$/);
      const accountAction = path.match(/^\/api\/steam\/accounts\/([^/]+)\/(library|wishlist|claim)(?:\/(sync))?$/);
      if (accountAction) {
        if (!requireUser()) return;
        const steamId = decodeURIComponent(accountAction[1]);

        // 认领（迁移）：管理员把未归属账号划到自己名下
        if (accountAction[2] === 'claim' && req.method === 'POST') {
          if (!requireAdmin()) return;
          const found = await q('select user_id from steam_accounts where steam_id = $1', [steamId]);
          if (!found.rows[0]) return json(res, 404, { error: '没有该 Steam 账号' });
          if (found.rows[0].user_id != null) return json(res, 409, { error: '该账号已被认领' });
          await q('update steam_accounts set user_id = $1, last_login_at = now() where steam_id = $2 and user_id is null', [user.id, steamId]);
          logger?.info('steam.claim', { steamId, userId: user.id, by: user.username });
          return json(res, 200, { ok: true });
        }
        if (accountAction[2] === 'library' && req.method === 'POST' && accountAction[3] === 'sync') {
          const row = await requireAccountOwner(steamId);
          if (!row) return;
          const apiKey = requireSteamApiKey();
          if (!apiKey) return;
          try {
            const result = await steamAccountsMod.syncAccountLibrary(q, { steamId, apiKey, logger });
            // 补全目录类型（类型未知数靠 app_type；只挑缺失的，天然收敛）
            const types = await steamAccountsMod.backfillOwnedAppTypes(q, { steamId, apiKey, logger });
            const stats = await steamAccountsMod.ownedTypeStats(q, steamId);
            return json(res, 200, { ...result, typeUnknown: stats.typeUnknown, typesChecked: types.checked, typesTyped: types.typed });
          } catch (err) {
            return json(res, 502, { error: '拉取游戏库失败：' + String(err.message).slice(0, 160) });
          }
        }
        if (accountAction[2] === 'wishlist' && req.method === 'POST' && accountAction[3] === 'sync') {
          const row = await requireAccountOwner(steamId);
          if (!row) return;
          const apiKey = requireSteamApiKey();
          if (!apiKey) return;
          try {
            const result = await steamAccountsMod.syncAccountWishlist(q, { steamId, apiKey, userId: user.id, logger });
            return json(res, 200, result);
          } catch (err) {
            return json(res, 502, { error: '拉取愿望单失败：' + String(err.message).slice(0, 160) });
          }
        }
        if (accountAction[2] === 'library' && req.method === 'GET') {
          const row = await requireAccountOwner(steamId);
          if (!row) return;
          const games = await q(
            "select sg.appid, coalesce(g.name, sg.name) as name, sg.playtime_minutes, sg.last_played_at, " +
              "g.steam_appid is not null as in_db, " +
              '(select min(o.price_cents) from offers o where o.game_id = g.id and o.in_stock) as low ' +
              'from steam_games sg left join games g on g.steam_appid = sg.appid where sg.steam_id = $1 order by sg.playtime_minutes desc limit 500',
            [steamId],
          );
          return json(res, 200, { steamId, games: games.rows });
        }
        return json(res, 404, { error: 'not found' });
      }

      if (accountMatch && req.method === 'PATCH') {
        if (!requireUser()) return;
        const steamId = decodeURIComponent(accountMatch[1]);
        const row = await requireAccountOwner(steamId);
        if (!row) return;
        const body = await readBody(req);
        const raw = String(body.alias ?? '').trim().slice(0, 64);
        const alias = raw || null;
        await q('update steam_accounts set alias = $1 where steam_id = $2', [alias, steamId]);
        // 账号自配 API Key（写愿望单用）：明文只进不出，AES-256-GCM 加密落库；clearApiKey=true 清除
        let apiKeyChanged = null;
        if (typeof body.apiKey === 'string' && body.apiKey.trim()) {
          const auth = await import('./email-auth.js');
          const enc = auth.encryptSecret(body.apiKey.trim(), auth.loadSecretKey());
          await steamAccountsMod.setAccountApiKey(q, { steamId, apiKeyEnc: enc });
          apiKeyChanged = true;
        } else if (body.clearApiKey === true) {
          await steamAccountsMod.setAccountApiKey(q, { steamId, apiKeyEnc: null });
          apiKeyChanged = false;
        }
        const after = await q('select (api_key_enc is not null) as api_key_set from steam_accounts where steam_id = $1', [steamId]);
        logger?.info('steam.alias_set', { steamId, alias, userId: user.id, apiKeyChanged });
        return json(res, 200, { ok: true, alias, apiKeySet: after.rows[0]?.api_key_set ?? false });
      }

      if (accountMatch && req.method === 'DELETE') {
        if (!requireUser()) return;
        const steamId = decodeURIComponent(accountMatch[1]);
        const row = await requireAccountOwner(steamId);
        if (!row) return;
        const result = await steamAccountsMod.unbindAccount(q, { steamId, userId: user.id, logger });
        return json(res, 200, result);
      }

      // ---- 手动愿望单：站点落库 + 按所选账号推 Steam（写操作需账号自配 API Key）----
      const pushWishlist = steamWishlistPush ?? ((args) => steamAccountsMod.pushWishlistItem({ ...args, logger }));

      if (path === '/api/wishlist' && req.method === 'POST') {
        if (!requireUser()) return;
        const body = await readBody(req);
        const game = await db.gameDetail(q, { steamAppid: Number(body.appid) || null, gameId: Number(body.gameId) || null, userId: user.id });
        if (!game) return json(res, 404, { error: '没有该游戏' });
        // 只接受当前用户自己的账号，其余静默丢弃
        const accounts = await steamAccountsMod.listUserAccounts(q, user.id);
        const mine = new Set(accounts.map((a) => a.steam_id));
        const chosen = [...new Set((Array.isArray(body.steamIds) ? body.steamIds : []).map(String).filter((s) => /^\d{17}$/.test(s)))];
        const steamIds = chosen.filter((s) => mine.has(s));
        await steamAccountsMod.addUserWishlist(q, { userId: user.id, gameId: game.id, steamIds });

        const added = [];
        const alreadyIn = [];
        const failed = [];
        if (game.steam_appid != null) {
          const byId = new Map(accounts.map((a) => [a.steam_id, a]));
          for (const steamId of steamIds) {
            // 账号本来就含有该游戏 → 不重复推送，返回 alreadyIn
            const existing = await q('select 1 from steam_wishlist where steam_id = $1 and appid = $2', [steamId, game.steam_appid]);
            if (existing.rows.length) {
              alreadyIn.push(steamId);
              continue;
            }
            if (!byId.get(steamId)?.api_key_set) {
              failed.push({ steamId, reason: '该账号未配置 API Key' });
              continue;
            }
            const encRow = await q('select api_key_enc from steam_accounts where steam_id = $1', [steamId]);
            let apiKey = null;
            try {
              const auth = await import('./email-auth.js');
              apiKey = auth.decryptSecret(encRow.rows[0]?.api_key_enc, auth.loadSecretKey());
            } catch {
              apiKey = null;
            }
            if (!apiKey) {
              failed.push({ steamId, reason: 'API Key 解密失败' });
              continue;
            }
            const result = await pushWishlist({ steamId, apiKey, appid: game.steam_appid, action: 'add' });
            if (result.ok) {
              // 乐观写 steam_wishlist：Steam 若实际未接受，每日同步会差集删除兜底
              await q(
                'insert into steam_wishlist (steam_id, appid, name, synced_at) values ($1, $2, $3, now()) ' +
                  'on conflict (steam_id, appid) do update set synced_at = now()',
                [steamId, game.steam_appid, game.name ?? null],
              );
              added.push(steamId);
            } else {
              failed.push({ steamId, reason: result.reason ?? 'Steam 推送失败' });
            }
          }
        }
        logger?.info('steam.wishlist_manual_add', {
          userId: user.id,
          gameId: game.id,
          appid: game.steam_appid ?? null,
          steamIds,
          added,
          alreadyIn,
          failed: failed.map((f) => f.steamId),
        });
        return json(res, 200, { ok: true, appid: game.steam_appid ?? null, added, alreadyIn, failed });
      }

      const wishDel = path.match(/^\/api\/wishlist\/(\d+)$/);
      const wishDelById = path.match(/^\/api\/wishlist\/id\/(\d+)$/);
      if ((wishDel || wishDelById) && req.method === 'DELETE') {
        if (!requireUser()) return;
        const game = wishDel
          ? await db.gameDetail(q, { steamAppid: Number(wishDel[1]) })
          : await db.gameDetail(q, { gameId: Number(wishDelById[1]) });
        if (!game) return json(res, 404, { error: '没有该游戏' });
        const appid = game.steam_appid;
        // 新语义：body { steamIds: string[], siteWishlist: boolean }；缺省保持旧行为（删本站 + 回推全部含它的账号）
        const body = await readBody(req);
        const bodyGiven = Array.isArray(body.steamIds) || body.siteWishlist != null;
        const doSite = bodyGiven ? body.siteWishlist !== false : true;
        let removed = { removed: 0, steamIds: [], watchesCleaned: 0 };
        if (doSite) removed = await steamAccountsMod.removeUserWishlist(q, { userId: user.id, gameId: game.id });
        const accounts = await steamAccountsMod.listUserAccounts(q, user.id);
        const mine = new Set(accounts.map((a) => a.steam_id));
        let targets;
        if (Array.isArray(body.steamIds)) {
          targets = [...new Set(body.steamIds.map(String).filter((s) => /^\d{17}$/.test(s)).filter((s) => mine.has(s)))];
        } else {
          // 旧行为：添加时选过的账号 ∪ 愿望单里实际有它的账号
          targets = [
            ...new Set([
              ...(removed.steamIds ?? []),
              ...(appid != null ? await steamAccountsMod.accountsWithWishlistAppid(q, { userId: user.id, appid }) : []),
            ]),
          ];
        }
        const byId = new Map(accounts.map((a) => [a.steam_id, a]));
        const removedFromSteam = [];
        const failed = [];
        for (const steamId of targets) {
          if (!byId.get(steamId)?.api_key_set) continue; // 没配 key 推不了删除，留给同步对账
          const encRow = await q('select api_key_enc from steam_accounts where steam_id = $1', [steamId]);
          let apiKey = null;
          try {
            const auth = await import('./email-auth.js');
            apiKey = auth.decryptSecret(encRow.rows[0]?.api_key_enc, auth.loadSecretKey());
          } catch {
            apiKey = null;
          }
          if (!apiKey) continue;
          const result = await pushWishlist({ steamId, apiKey, appid, action: 'remove' });
          if (result.ok) {
            await q('delete from steam_wishlist where steam_id = $1 and appid = $2', [steamId, appid]);
            removedFromSteam.push(steamId);
          } else {
            failed.push({ steamId, reason: result.reason ?? 'Steam 推送失败' });
          }
        }
        await steamAccountsMod.cleanupAutoWatches(q, user.id);
        logger?.info('steam.wishlist_manual_remove', {
          userId: user.id,
          gameId: game.id,
          appid,
          siteRemoved: removed.removed,
          targets,
          removedFromSteam,
          failed: failed.map((f) => f.steamId),
        });
        return json(res, 200, { ok: true, siteRemoved: removed.removed, removedFromSteam, failed });
      }

      // ---- 管理员：游戏同步概览（待同步数量统计）----
      if (path === '/api/admin/games/stats' && req.method === 'GET') {
        if (!requireAdmin()) return;
        return json(res, 200, { stats: await db.adminGameStats(q) });
      }

      // ---- 管理员：游戏列表（分页 + 搜索 + 平台筛选 + 同步状态 + 回收站）----
      if (path === '/api/admin/games' && req.method === 'GET') {
        if (!requireAdmin()) return;
        const kw = String(url.searchParams.get('q') ?? '').trim();
        const page = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1);
        const pageSize = Math.min(Math.max(Number(url.searchParams.get('pageSize') ?? 20) || 20, 5), 200);
        const offset = (page - 1) * pageSize;
        const platform = String(url.searchParams.get('platform') ?? '').trim();
        const sync = String(url.searchParams.get('sync') ?? '').trim();
        // 报价筛选：priced=有任意平台报价，none=没有任何报价（控制台指标卡点击用）
        const offersParam = String(url.searchParams.get('offers') ?? '').trim();
        const deletedParam = String(url.searchParams.get('deleted') ?? 'exclude');
        // 默认只看正常游戏；deleted=only 就是回收站，include 两边都看
        const deletedWhere =
          deletedParam === 'only' ? ' and g.deleted = true' : deletedParam === 'include' ? '' : ' and not g.deleted';
        const offersWhere =
          offersParam === 'priced'
            ? ' and exists (select 1 from offers of1 where of1.game_id = g.id)'
            : offersParam === 'none'
              ? ' and not exists (select 1 from offers of2 where of2.game_id = g.id)'
              : '';
        // 同步状态（docs/STEAM-SYNC-STATUS-AND-RATING.md §4）：
        //   sync=pending（旧参数，兼容）= 从未探测或 ok 但缺简介；done=ok 且有简介
        //   status=<steam_status|pending|synced|other>（新参数，指标卡点击用）
        const statusParam = String(url.searchParams.get('status') ?? '').trim();
        const statusWhere =
          statusParam === 'pending'
            ? ' and g.steam_appid is not null and g.steam_status is null'
            : statusParam === 'synced'
              ? " and g.steam_appid is not null and g.steam_status = 'ok' and g.description is not null and g.description <> ''"
              : statusParam === 'other'
                ? " and g.steam_appid is not null and g.steam_status is not null and g.steam_status not in ('ok','free','coming_soon','region_locked','no_price','not_found')"
                : ['ok', 'free', 'coming_soon', 'region_locked', 'no_price', 'not_found'].includes(statusParam)
                  ? ` and g.steam_appid is not null and g.steam_status = '${statusParam}'`
                  : '';
        const syncWhere =
          sync === 'pending'
            ? " and g.steam_appid is not null and (g.steam_status is null or (g.steam_status = 'ok' and (g.description is null or g.description = '')))"
            : sync === 'done'
              ? " and g.steam_appid is not null and g.steam_status = 'ok' and g.description is not null and g.description <> ''"
              : statusWhere;
        // 内容分级筛选（docs/STEAM-SYNC-STATUS-AND-RATING.md §13.2）：可与搜索/平台/同步状态叠加
        const ratingParam = String(url.searchParams.get('rating') ?? '').trim();
        const ratingWhere =
          ratingParam === 'adult' ? ' and g.adult_flag'
            : ratingParam === 'mature' ? ' and g.mature_flag'
              : ratingParam === 'none' ? ' and not g.adult_flag and not g.mature_flag'
                : '';
        // 平台筛选：按参数位置生成（计数查询与列表查询占位符不同）
        const platformCond = (index) =>
          platform
            ? " and exists (select 1 from offers po join platforms pp on pp.code = po.platform_code where po.game_id = g.id and po.platform_code = $" + index + ')'
            : '';
        const baseWhere =
          'where ' + db.gameKeywordSql('$1', { appidAsText: true }) +
          deletedWhere + syncWhere + offersWhere + ratingWhere;
        const cnt = await q(
          'select count(*)::int as n from games g ' + baseWhere + platformCond(2),
          platform ? [kw, platform] : [kw],
        );
        const rows = await q(
          'select g.id, g.steam_appid, coalesce(nullif(g.name, \'\'), nullif(g.name_en, \'\'), \'appid:\' || g.steam_appid) as name, g.name_en, g.app_type, g.blocked, g.deleted, g.deleted_at, g.updated_at, ' +
          '(g.description is not null and g.description <> \'\') as has_desc, ' +
          'g.steam_status, g.steam_checked_at, g.required_age, g.adult_flag, g.mature_flag, ' +
          '(select count(*) from offers o where o.game_id = g.id) as offer_count, ' +
          '(select min(o.price_cents) from offers o where o.game_id = g.id and o.platform_code = \'steam\' and o.in_stock) as steam_price, ' +
          // 平台列：这款游戏当前有报价的渠道（多个用数组，前端渲染成多个标签）
          '(select coalesce(array_agg(distinct p.name), \'{}\') from offers o2 join platforms p on p.code = o2.platform_code where o2.game_id = g.id) as platform_names, ' +
          '(select coalesce(array_agg(distinct o3.platform_code), \'{}\') from offers o3 where o3.game_id = g.id) as platform_codes, ' +
          // AG 批（docs/ADMIN-PLATFORM-LINKS.md）：列表只带数量，完整链接按需从 /links 接口取
          "(select count(*)::int from offers o4 where o4.game_id = g.id and o4.buy_url ~ '^https?://') as link_count " +
          'from games g ' + baseWhere + platformCond(4) + ' ' +
          'order by g.updated_at desc nulls last, g.id desc limit $2 offset $3',
          platform ? [kw, pageSize, offset, platform] : [kw, pageSize, offset],
        );
        const total = cnt.rows[0]?.n ?? 0;
        return json(res, 200, { total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)), games: rows.rows });
      }

      // ---- 管理员：单游戏全部平台链接（AG 批 docs/ADMIN-PLATFORM-LINKS.md §3-A，仅 http/https）----
      const linkMatch = path.match(/^\/api\/admin\/games\/(\d+)\/links$/);
      if (linkMatch && req.method === 'GET') {
        if (!requireAdmin()) return;
        const gameId = Number(linkMatch[1]);
        const g = await q('select id, steam_appid, name, name_en from games where id = $1 and not deleted', [gameId]);
        if (!g.rows[0]) return json(res, 404, { error: '没有该游戏' });
        return json(res, 200, { game: g.rows[0], links: await db.adminGameLinks(q, { gameId }) });
      }

      // ---- 管理员：回收站（逻辑删除的游戏）----
      if (path === '/api/admin/games/deleted' && req.method === 'GET') {
        if (!requireAdmin()) return;
        const limit = Number(url.searchParams.get('limit') ?? 200);
        return json(res, 200, { games: await db.listDeletedGames(q, { limit }) });
      }

      // ---- 管理员：到价提醒（关注列表）----
      if (path === '/api/admin/watchlist' && req.method === 'GET') {
        if (!requireAdmin()) return;
        const region = String(url.searchParams.get('region') ?? 'cn');
        return json(res, 200, { watches: await db.listWatches(q, { region }) });
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

      const watchDel = path.match(/^\/api\/admin\/watchlist\/(\d+)$/);
      if (watchDel && req.method === 'DELETE') {
        if (!requireAdmin()) return;
        const removed = await db.deleteWatch(q, { gameId: Number(watchDel[1]), region: 'cn' });
        logger?.info('api.watch_deleted', { gameId: Number(watchDel[1]), removed, by: user.username });
        return json(res, 200, { removed });
      }

      // ---- 管理员：版本与更新检查 ----
      if (path === '/api/admin/version' && req.method === 'GET') {
        if (!requireAdmin()) return;
        const force = url.searchParams.get('force') === '1';
        const repo = process.env.UPDATE_REPO || undefined;
        // UPDATE_CHECK=0 时只报当前版本，不出网
        if (process.env.UPDATE_CHECK === '0') {
          return json(res, 200, {
            current: VERSION,
            latest: null,
            updateAvailable: false,
            url: null,
            checkedAt: new Date().toISOString(),
            error: null,
            repo: repo ?? null,
            source: null,
            region: null,
          });
        }
        return json(res, 200, await versionInfo({ current: VERSION, repo, logger, force }));
      }

      // ---- 管理员：备份（手动触发 + 列表）----
      if (path === '/api/admin/backups' && req.method === 'GET') {
        if (!requireAdmin()) return;
        return json(res, 200, { backups: listBackups(process.env.BACKUP_DIR ?? 'data/backup') });
      }

      if (path === '/api/admin/backup' && req.method === 'POST') {
        if (!requireAdmin()) return;
        try {
          const result = await createBackup(q, { dir: process.env.BACKUP_DIR ?? 'data/backup', logger });
          logger?.info('api.backup_done', { ...result, by: user.username });
          return json(res, 200, { result, backups: listBackups(process.env.BACKUP_DIR ?? 'data/backup') });
        } catch (err) {
          logger?.warn('api.backup_failed', { message: String(err.message).slice(0, 160) });
          return json(res, 500, { error: '备份失败：' + String(err.message).slice(0, 120) });
        }
      }

      // ---- 单款价格历史 CSV（默认关闭，见 historyCsvEnabled）----
      const historyCsv = path.match(/^\/api\/games\/(\d+)\/history\.csv$/);
      if (historyCsv && req.method === 'GET') {
        if (!historyCsvEnabled()) return json(res, 404, { error: 'not found' });
        const appid = Number(historyCsv[1]);
        const days = Math.min(Math.max(Number(url.searchParams.get('days') ?? 90) || 90, 1), 3650);
        const game = await db.gameDetail(q, { steamAppid: appid });
        if (!game) return json(res, 404, { error: '没有该游戏' });
        const cutoff = Date.now() - days * 86400000;
        const series = (await db.dailyMinSeries(q, { gameId: game.id, region: 'cn' })).filter(
          (p) => new Date(p.day).getTime() >= cutoff,
        );
        const lines = ['date,price_cents,price,currency'];
        for (const p of series) lines.push([p.day, p.price_cents, (p.price_cents / 100).toFixed(2), p.currency].join(','));
        const body = '\uFEFF' + lines.join('\r\n');
        res.writeHead(200, {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': 'attachment; filename="history-' + appid + '.csv"',
          'cache-control': 'no-store',
        });
        res.end(body);
        return;
      }

      // ---- 管理员：合并重复游戏（把 from 并进 to，按 Steam appid 指定）----
      if (path === '/api/admin/games/merge' && req.method === 'POST') {
        if (!requireAdmin()) return;
        const body = await readBody(req);
        const fromAppid = Number(body.fromAppid);
        const toAppid = Number(body.toAppid);
        if (!Number.isFinite(fromAppid) || !Number.isFinite(toAppid)) {
          return json(res, 400, { error: '需要 fromAppid 与 toAppid' });
        }
        if (fromAppid === toAppid) return json(res, 400, { error: '源和目标不能是同一个游戏' });
        const from = await db.gameDetail(q, { steamAppid: fromAppid });
        const to = await db.gameDetail(q, { steamAppid: toAppid });
        if (!from) return json(res, 404, { error: '源游戏不存在：' + fromAppid });
        if (!to) return json(res, 404, { error: '目标游戏不存在：' + toAppid });
        const result = await db.mergeGames(q, { fromGameId: from.id, toGameId: to.id, logger });
        logger?.info('api.game_merged', { fromAppid, toAppid, ...result, by: user.username });
        return json(res, 200, { result });
      }

      // ---- 管理员：逻辑删除 / 恢复（按 appid 或内部 id）----
      const delByAppid = path.match(/^\/api\/games\/(\d+)\/deleted$/);
      const delById = path.match(/^\/api\/games\/id\/(\d+)\/deleted$/);
      if ((delByAppid || delById) && req.method === 'POST') {
        if (!requireAdmin()) return;
        const body = await readBody(req);
        const target = delByAppid ? { steamAppid: Number(delByAppid[1]) } : { gameId: Number(delById[1]) };
        const row = await db.setGameDeleted(q, { ...target, deleted: body.deleted !== false });
        if (!row) return json(res, 404, { error: '没有该游戏' });
        logger?.info('api.game_deleted', { ...target, deleted: row.deleted, by: user.username });
        return json(res, 200, { game: row });
      }

      // ---- 管理员：验证邮箱归属（发码 / 校验）----      // ---- 管理员：验证邮箱归属（发码 / 校验）----      // ---- 管理员：验证邮箱归属（发码 / 校验）----
      const bindCode = path.match(/^\/api\/admin\/users\/([^/]+)\/email\/code$/);
      if (bindCode && req.method === 'POST') {
        if (!requireAdmin()) return;
        const auth = await import('./email-auth.js');
        const { sendMail } = await import('./notify.js');
        const username = decodeURIComponent(bindCode[1]);
        const urow = await q('select id, username, email from users where username = $1', [username]);
        const target = urow.rows[0];
        if (!target) return json(res, 404, { error: '没有该用户' });
        if (!target.email) return json(res, 400, { error: '该用户还没有绑定邮箱' });
        const cfg = await auth.smtpConfig(q);
        if (!auth.isSmtpConfigured(cfg)) return json(res, 503, { error: 'SMTP 未配置，无法发送验证邮件' });
        const code = auth.generateCode();
        const ins = await q(
          "insert into email_codes (email, user_id, purpose, code_hash, subject, body, expires_at) " +
          "values ($1, $2, 'bind', $3, $4, $5, now() + interval '5 minutes') returning id",
          [target.email, target.id, auth.hashCode(target.email, code), 'SteamDeals 邮箱验证码', '验证码邮件正文未保存。'],
        );
        try {
          // AI 批：绑定验证码同样套用 verify_code 模板（停用时回退纯文本）
          const tpl = await mailTemplates.resolveTemplate(q, 'verify_code').catch(() => null);
          const expiryAt = new Date(Date.now() + 5 * 60 * 1000);
          let mail = { subject: 'SteamDeals 邮箱验证码', text: '验证码：' + code + '\n有效期 5 分钟。', html: null };
          if (tpl?.enabled) {
            mail = mailTemplates.renderTemplate({
              subject: tpl.subject,
              bodyHtml: tpl.bodyHtml,
              bodyText: tpl.bodyText ?? '',
              vars: {
                username: target.username,
                action: '绑定邮箱',
                time: `${String(expiryAt.getFullYear()).padStart(4, '0')}-${String(expiryAt.getMonth() + 1).padStart(2, '0')}-${String(expiryAt.getDate()).padStart(2, '0')} ${String(expiryAt.getHours()).padStart(2, '0')}:${String(expiryAt.getMinutes()).padStart(2, '0')}`,
                code,
                siteUrl: baseUrl(req),
                contactEmail: appealEmail(),
              },
            });
          }
          await sendMail(
            { host: cfg.host, port: cfg.port, secure: cfg.secure, user: cfg.user, pass: cfg.pass, from: cfg.from, to: target.email,
              subject: mail.subject, text: mail.text, html: mail.html },
            { logger },
          );
          await q('update email_codes set sent_ok = true where id = $1', [ins.rows[0].id]);
          logger?.info('api.user_email_code_sent', { username, by: user.username });
          return json(res, 200, { ok: true, hint: '验证码已发送到 ' + target.email });
        } catch (err) {
          await q('update email_codes set sent_ok = false, error = $1 where id = $2', [String(err.message).slice(0, 200), ins.rows[0].id]);
          return json(res, 502, { error: '发送失败：' + String(err.message).slice(0, 160) });
        }
      }

      const bindVerify = path.match(/^\/api\/admin\/users\/([^/]+)\/email\/verify$/);
      if (bindVerify && req.method === 'POST') {
        if (!requireAdmin()) return;
        const auth = await import('./email-auth.js');
        const body = await readBody(req);
        const code = String(body.code ?? '').trim();
        const username = decodeURIComponent(bindVerify[1]);
        const urow = await q('select id, email from users where username = $1', [username]);
        const target = urow.rows[0];
        if (!target) return json(res, 404, { error: '没有该用户' });
        if (!target.email) return json(res, 400, { error: '该用户还没有绑定邮箱' });
        const found = await q(
          "select id, code_hash, attempts, expires_at from email_codes where email = $1 and purpose = 'bind' and used_at is null order by created_at desc limit 1",
          [target.email],
        );
        const row = found.rows[0];
        if (!row) return json(res, 400, { error: '没有可用的验证码，请先发送' });
        if (new Date(row.expires_at).getTime() < Date.now()) return json(res, 400, { error: '验证码已过期，请重新发送' });
        if (row.attempts >= 5) return json(res, 429, { error: '尝试次数过多，请重新发送' });
        if (!auth.verifyCodeHash(target.email, code, row.code_hash)) {
          await q('update email_codes set attempts = attempts + 1 where id = $1', [row.id]);
          return json(res, 400, { error: '验证码不正确' });
        }
        await q('update email_codes set used_at = now() where id = $1', [row.id]);
        await q('update users set email_verified = true where id = $1', [target.id]);
        logger?.info('api.user_email_verified', { username, by: user.username });
        return json(res, 200, { ok: true });
      }

      const userMatch = path.match(/^\/api\/admin\/users\/([^/]+)$/);
      if (userMatch && req.method === 'DELETE') {
        if (!requireAdmin()) return;
        const body = await readBody(req);
        const username = decodeURIComponent(userMatch[1]);
        const result = await db.deleteUserAudited(q, {
          username,
          confirmUsername: String(body.confirmUsername ?? ''),
          operator: user.username,
          operatorId: user.id,
          reason: String(body.reason ?? '').trim() || null,
        });
        if (!result.ok) return json(res, result.status, { error: result.error });
        logger?.info('admin.user_deleted', {
          username,
          role: result.deleted.role ?? null,
          steamAccounts: result.deleted.steamAccounts,
          sessions: result.deleted.sessions,
          by: user.username,
          reason: String(body.reason ?? '').trim() || null,
        });
        // AH 批不含通知（AJ 接入后这里改为 notifyUserAction 异步发送）
        return json(res, 200, { ok: true, deleted: result.deleted });
      }
      if (userMatch && req.method === 'PATCH') {
        if (!requireAdmin()) return;
        const body = await readBody(req);
        const username = decodeURIComponent(userMatch[1]);
        const row = await db.updateUser(q, {
          username,
          displayName: body.display_name,
          role: body.role,
          disabled: body.disabled,
        });
        if (!row) return json(res, 404, { error: '没有该用户或没有要改的字段' });
        logger?.info('api.user_updated', { username, by: user.username, ...body });
        return json(res, 200, { user: row });
      }

      const pwdMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/password$/);
      if (pwdMatch && req.method === 'POST') {
        if (!requireAdmin()) return;
        const body = await readBody(req);
        const password = String(body.password ?? '');
        if (password.length < 8 || password.length > 200) return json(res, 400, { error: '密码需要 8-200 位' });
        const row = await db.setUserPassword(q, { username: decodeURIComponent(pwdMatch[1]), password });
        if (!row) return json(res, 404, { error: '没有该用户' });
        logger?.info('api.user_password_reset', { username: decodeURIComponent(pwdMatch[1]), by: user.username });
        return json(res, 200, { ok: true });
      }

      // ---- 管理员：禁用游戏 / 编辑说明 / 触发 Steam 同步 ----
      const blockMatch = path.match(/^\/api\/games\/(\d+)\/blocked$/);
      if (blockMatch && req.method === 'POST') {
        if (!requireAdmin()) return;
        const body = await readBody(req);
        const row = await db.setGameBlocked(q, { steamAppid: Number(blockMatch[1]), blocked: Boolean(body.blocked) });
        if (!row) return json(res, 404, { error: '没有该游戏' });
        logger?.info('api.game_blocked', { appid: Number(blockMatch[1]), blocked: row.blocked, by: user.username });
        return json(res, 200, { game: row });
      }

      const descMatch = path.match(/^\/api\/games\/(\d+)\/description$/);
      if (descMatch && req.method === 'POST') {
        if (!requireAdmin()) return;
        const body = await readBody(req);
        const row = await db.setGameDescription(q, {
          steamAppid: Number(descMatch[1]),
          description: String(body.description ?? ''),
          overwrite: Boolean(body.overwrite),
        });
        if (!row) return json(res, 404, { error: '没有该游戏' });
        logger?.info('api.game_description', { appid: Number(descMatch[1]), by: user.username });
        return json(res, 200, { game: row });
      }

      // 一键同步：把动作丢给子进程，避免 HTTP 请求挂几分钟。
      // 记录到 sync_runs（开始/结束/输出尾巴），前端轮询状态显示实时输出。
      // 控制台只暴露 catalog / steam-prices（全量补元数据已由 /api/admin/backfill 承担，
      // steamall 仍保留给 CLI 与老调用方，不再作为页面入口）。
      if (path === '/api/admin/sync' && req.method === 'POST') {
        if (!requireAdmin()) return;
        const body = await readBody(req);
        const MODES = new Set(['catalog', 'steam-prices', 'steamall']);
        const mode = MODES.has(String(body.mode)) ? String(body.mode) : 'steam-prices';
        const args = ['src/cli.js', 'sync', mode];
        if (mode === 'steamall') {
          const limit = Math.min(Math.max(Number(body.limit ?? 200) || 200, 1), 2000);
          const sleep = Math.min(Math.max(Number(body.sleep ?? 2) || 2, 1), 30);
          args.push('--limit', String(limit), '--sleep', String(sleep));
        }
        try {
          const job = await startSteamJob({ mode, args, by: user.username });
          return json(res, 202, { started: true, runId: job.runId, mode, pid: job.pid });
        } catch (err) {
          if (err.code === 'BUSY') return json(res, 409, { error: err.message, run: err.run });
          throw err;
        }
      }

      if (path === '/api/admin/sync/status' && req.method === 'GET') {
        if (!requireAdmin()) return;
        const running = Boolean(syncChild);
        const last = await db.listSyncRuns(q, { limit: 1 }).catch(() => []);
        let schedule = null;
        try {
          const file = process.env.SCHEDULER_STATUS_FILE ?? 'data/scheduler-status.json';
          schedule = JSON.parse(readFileSync(file, 'utf8'));
        } catch {
          schedule = null;
        }
        return json(res, 200, {
          running,
          run: running ? syncRun : null,
          output: syncOutput.slice(-6000),
          last: last[0] ?? null,
          schedule,
          // AC1（docs/SYNC-FAILURE-MODES.md）：该有但没有的任务，后台显式提示（缺 Key / 被 *_ENABLED=0 关闭）
          warnings: auditSchedulerJobs(process.env),
        });
      }

      if (path === '/api/admin/sync/runs' && req.method === 'GET') {
        if (!requireAdmin()) return;
        const limit = Number(url.searchParams.get('limit') ?? 20);
        return json(res, 200, { runs: await db.listSyncRuns(q, { limit }) });
      }

      // ---- 管理员：数据回填（批量补全量元数据/价格，与同步共用子进程槽位）----
      if (path === '/api/admin/backfill' && req.method === 'POST') {
        if (!requireAdmin()) return;
        const body = await readBody(req);
        const { normalizeBackfillParams, backfillArgs } = await import('./backfill.js');
        const params = normalizeBackfillParams(body);
        try {
          const job = await startSteamJob({ mode: 'backfill', args: backfillArgs(params), params, by: user.username });
          logger?.info('api.backfill_started', { runId: job.runId, by: user.username, ...params });
          return json(res, 202, { started: true, runId: job.runId, pid: job.pid, params });
        } catch (err) {
          if (err.code === 'BUSY') return json(res, 409, { error: err.message, run: err.run });
          throw err;
        }
      }

      if (path === '/api/admin/backfill/stop' && req.method === 'POST') {
        if (!requireAdmin()) return;
        if (!syncChild) return json(res, 409, { error: '当前没有运行中的任务' });
        const child = syncChild;
        const runId = syncRun?.id ?? null;
        syncStopRequested = true;
        child.kill('SIGTERM');
        // 10 秒还没退就强杀，避免卡死子进程一直占着槽位
        const killTimer = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            /* 已退出 */
          }
        }, 10000);
        killTimer.unref?.();
        logger?.warn('api.backfill_stop', { runId, pid: child.pid, by: user.username });
        return json(res, 202, { stopping: true, runId, pid: child.pid });
      }

      if (path === '/api/admin/backfill/status' && req.method === 'GET') {
        if (!requireAdmin()) return;
        const { parseBackfillProgress } = await import('./backfill.js');
        const isBackfill = syncRun?.mode === 'backfill';
        const runs = await db.listSyncRuns(q, { limit: 10 }).catch(() => []);
        return json(res, 200, {
          running: Boolean(syncChild) && isBackfill,
          busy: Boolean(syncChild),
          mode: syncRun?.mode ?? null,
          run: syncRun,
          output: syncOutput.slice(-6000),
          progress: isBackfill ? parseBackfillProgress(syncOutput) : null,
          last: runs.find((r) => r.mode === 'backfill') ?? null,
        });
      }

      // ---- 管理员：热度回填（与同步/回填共用子进程槽位，天然互斥）----
      if (path === '/api/admin/heat' && req.method === 'POST') {
        if (!requireAdmin()) return;
        const body = await readBody(req);
        const pickNum = (v, def, min, max) => Math.max(min, Math.min(Number(v ?? def) || def, max));
        const params = {
          limit: pickNum(body.limit, 200000, 1, 200000),
          batch: pickNum(body.batch, 30, 1, 100),
          sleep: pickNum(body.sleep, 1700, 0, 60000),
        };
        try {
          const job = await startSteamJob({
            mode: 'heat',
            args: ['heat', '--limit', String(params.limit), '--batch', String(params.batch), '--sleep', String(params.sleep)],
            params,
            by: user.username,
          });
          logger?.info('api.heat_started', { runId: job.runId, by: user.username, ...params });
          return json(res, 202, { started: true, runId: job.runId, pid: job.pid, params });
        } catch (err) {
          if (err.code === 'BUSY') return json(res, 409, { error: err.message, run: err.run });
          throw err;
        }
      }

      if (path === '/api/admin/heat/stop' && req.method === 'POST') {
        if (!requireAdmin()) return;
        if (!syncChild) return json(res, 409, { error: '当前没有运行中的任务' });
        const child = syncChild;
        const runId = syncRun?.id ?? null;
        syncStopRequested = true;
        child.kill('SIGTERM');
        const killTimer = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            /* 已退出 */
          }
        }, 10000);
        killTimer.unref?.();
        logger?.warn('api.heat_stop', { runId, pid: child.pid, by: user.username });
        return json(res, 202, { stopping: true, runId, pid: child.pid });
      }

      if (path === '/api/admin/heat/status' && req.method === 'GET') {
        if (!requireAdmin()) return;
        const isHeat = syncRun?.mode === 'heat';
        return json(res, 200, {
          running: Boolean(syncChild) && isHeat,
          busy: Boolean(syncChild),
          mode: syncRun?.mode ?? null,
          run: syncRun,
          output: syncOutput.slice(-6000),
        });
      }

      // ---- 管理员：重写名字（把目录导入留下的机器英文名换成中文，与同步/回填共用槽位）----
      if (path === '/api/admin/rename' && req.method === 'POST') {
        if (!requireAdmin()) return;
        const body = await readBody(req);
        const { normalizeBackfillParams, renameArgs } = await import('./backfill.js');
        const params = normalizeBackfillParams(body);
        // rename 默认间隔 1500ms（比回填轻），控制台未传时按 1500
        if (body.sleep == null || body.sleep === '') params.sleep = 1500;
        try {
          const job = await startSteamJob({ mode: 'rename', args: renameArgs(params), params, by: user.username });
          logger?.info('api.rename_started', { runId: job.runId, by: user.username, ...params });
          return json(res, 202, { started: true, runId: job.runId, pid: job.pid, params });
        } catch (err) {
          if (err.code === 'BUSY') return json(res, 409, { error: err.message, run: err.run });
          throw err;
        }
      }

      if (path === '/api/admin/rename/stop' && req.method === 'POST') {
        if (!requireAdmin()) return;
        if (!syncChild) return json(res, 409, { error: '当前没有运行中的任务' });
        const child = syncChild;
        const runId = syncRun?.id ?? null;
        syncStopRequested = true;
        child.kill('SIGTERM');
        const killTimer = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            /* 已退出 */
          }
        }, 10000);
        killTimer.unref?.();
        logger?.warn('api.rename_stop', { runId, pid: child.pid, by: user.username });
        return json(res, 202, { stopping: true, runId, pid: child.pid });
      }

      if (path === '/api/admin/rename/status' && req.method === 'GET') {
        if (!requireAdmin()) return;
        const { parseRenameProgress } = await import('./backfill.js');
        const isRename = syncRun?.mode === 'rename';
        const runs = await db.listSyncRuns(q, { limit: 10 }).catch(() => []);
        return json(res, 200, {
          running: Boolean(syncChild) && isRename,
          busy: Boolean(syncChild),
          mode: syncRun?.mode ?? null,
          run: syncRun,
          output: syncOutput.slice(-6000),
          progress: isRename ? parseRenameProgress(syncOutput) : null,
          last: runs.find((r) => r.mode === 'rename') ?? null,
        });
      }

      // ---- 管理员：邮箱（SMTP）配置与验证码发送记录 ----
      if (path === '/api/admin/smtp' && req.method === 'GET') {
        if (!requireAdmin()) return;
        const auth = await import('./email-auth.js');
        const cfg = await auth.smtpConfig(q);
        const raw = await q("select from_addr from smtp_settings where id = 1");
        const rawFrom = raw.rows[0] ? String(raw.rows[0].from_addr ?? '') : '';
        return json(res, 200, {
          smtp: {
            source: cfg.source,
            host: cfg.host ?? '',
            port: cfg.port ?? 465,
            secure: cfg.secure !== false,
            user: cfg.user ?? '',
            from: cfg.from ?? '',
            hasPassword: Boolean(cfg.pass),
            ready: auth.isSmtpConfigured(cfg),
          },
        });
      }

      if (path === '/api/admin/smtp' && req.method === 'POST') {
        if (!requireAdmin()) return;
        const auth = await import('./email-auth.js');
        const body = await readBody(req);
        const pass = body.pass ? auth.encryptSecret(String(body.pass), auth.loadSecretKey()) : null;
        // 发件人留空就用账号，保存时就补全，避免后续判断为"未配置"
        const mailUser = String(body.user ?? '').trim();
        const mailFrom = String(body.from ?? '').trim(); // 存原值；留空表示用账号，由读取时兜底
        await q(
          `insert into smtp_settings (id, host, port, secure, username, password_enc, from_addr, enabled, updated_at)
           values (1, $1, $2, $3, $4, $5, $6, $7, now())
           on conflict (id) do update set
             host = excluded.host, port = excluded.port, secure = excluded.secure,
             username = excluded.username,
             password_enc = coalesce($5, smtp_settings.password_enc),
             from_addr = excluded.from_addr, enabled = excluded.enabled, updated_at = now()`,
          [
            String(body.host ?? '').trim(),
            Number(body.port ?? 465),
            body.secure !== false,
            mailUser,
            pass,
            mailFrom,
            body.enabled !== false,
          ],
        );
        logger?.info('api.smtp_saved', { by: user.username, host: String(body.host ?? '').trim() });
        if (store) {
          await settings.hydrateSettings({ store, logger }).catch((err) => {
            logger?.warn('settings.hydrate_failed', { message: String(err.message).slice(0, 160) });
          });
        }
        return json(res, 200, { ok: true });
      }

      if (path === '/api/admin/smtp/test' && req.method === 'POST') {
        if (!requireAdmin()) return;
        const auth = await import('./email-auth.js');
        const { sendMail } = await import('./notify.js');
        const body = await readBody(req);
        const cfg = await auth.smtpConfig(q);
        if (!auth.isSmtpConfigured(cfg)) {
          const missing = [];
          if (!cfg.host) missing.push('主机');
          if (!cfg.from) missing.push('发件人（留空时应回填账号，请再保存一次）');
          logger?.warn('api.smtp_incomplete', { missing, by: user.username });
          return json(res, 400, { error: 'SMTP 配置不完整：缺少 ' + missing.join('、') });
        }
        // 收件人留空时发给发件人自己，前端不用重复填
        const to = String(body.to ?? '').trim() || cfg.from;
        if (!auth.normalizeEmail(to)) return json(res, 400, { error: '收件邮箱不合法' });
        const record = await q(
          "insert into email_codes (email, purpose, code_hash, subject, body, expires_at, sent_ok) " +
          "values ($1, 'test', '-', $2, $3, now(), null) returning id",
          [to, 'SteamDeals 测试邮件', '这是一封测试邮件。收到说明 SMTP 配置可用。'],
        );
        try {
          const result = await sendMail(
            {
              host: cfg.host,
              port: cfg.port,
              secure: cfg.secure,
              user: cfg.user,
              pass: cfg.pass,
              from: cfg.fromRaw,
            effectiveFrom: cfg.from,
              to,
              subject: 'SteamDeals 测试邮件',
              text: '这是一封测试邮件。收到说明 SMTP 配置可用。',
            },
            { logger },
          );
          await q('update email_codes set sent_ok = true where id = $1', [record.rows[0].id]);
          logger?.info('api.smtp_test_ok', { to, by: user.username, steps: result?.steps ?? null });
          return json(res, 200, { ok: true, steps: result?.steps ?? [] });
        } catch (err) {
          const message = String(err.message).slice(0, 200);
          await q('update email_codes set sent_ok = false, error = $1 where id = $2', [message, record.rows[0].id]);
          logger?.warn('api.smtp_test_failed', { message, to, steps: err.steps ?? null });
          return json(res, 502, { error: message, steps: err.steps ?? [] });
        }
      }

      if (path === '/api/admin/emails' && req.method === 'GET') {
        if (!requireAdmin()) return;
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 100) || 100, 1), 500);
        const rows = await q(
          'select id, email, purpose, sent_ok, error, ip, subject, body, expires_at, used_at, created_at ' +
          `from email_codes order by created_at desc limit ${limit}`,
        );
        return json(res, 200, { records: rows.rows });
      }

      // ---- 管理员：给用户绑定/解绑登录邮箱 ----
      const bindMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/email$/);
      if (bindMatch && req.method === 'POST') {
        if (!requireAdmin()) return;
        const body = await readBody(req);
        const auth = await import('./email-auth.js');
        const raw = String(body.email ?? '').trim();
        const email = raw ? auth.normalizeEmail(raw) : null;
        if (raw && !email) return json(res, 400, { error: '邮箱格式不正确' });
        const username = decodeURIComponent(bindMatch[1]);
        const doBind = () =>
          q(
            'update users set email = $1, email_verified = false where username = $2 returning id, username, email, role, disabled',
            [email, username],
          );
        try {
          let r;
          try {
            r = await doBind();
          } catch (err) {
            // 旧库可能缺列：补建后重试一次，避免只报"服务器错误"
            if (String(err.code) === '42703') {
              await q('alter table users add column if not exists email text');
              await q('alter table users add column if not exists email_verified boolean not null default false');
              r = await doBind();
            } else {
              throw err;
            }
          }
          if (!r.rows.length) return json(res, 404, { error: '没有该用户' });
          logger?.info('api.user_email_bound', {
            username,
            email: email ? String(email).replace(/^(.)(.*)(@.*)$/, '$1***$3') : null,
            by: user.username,
          });
          return json(res, 200, { user: r.rows[0] });
        } catch (err) {
          if (String(err.code) === '23505') return json(res, 409, { error: '这个邮箱已被其他账号绑定' });
          logger?.error('api.user_email_bind_failed', {
            username,
            code: err.code ?? null,
            message: String(err.message).slice(0, 200),
            by: user.username,
          });
          return json(res, 500, { error: '绑定失败：' + String(err.message).slice(0, 160) });
        }
      }

      // ---- 管理员：最近日志（排障用；日志层已做脱敏）----
      if (path === '/api/admin/logs' && req.method === 'GET') {
        if (!requireAdmin()) return;
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
        return json(res, 200, { files: picked, count: filtered.length, entries: filtered.slice(-limit) });
      }

      if (path === '/api/admin/users' && req.method === 'GET') {
        if (!requireAdmin()) return;
        return json(res, 200, { users: await db.listUsers(q) });
      }

      // 最近删除审计（docs/USER-LIFECYCLE.md §4.5，AH 批）：只读，按用户名模糊搜索
      if (path === '/api/admin/users/deletions' && req.method === 'GET') {
        if (!requireAdmin()) return;
        const search = String(url.searchParams.get('q') ?? '').trim().slice(0, 80);
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50) || 50, 1), 200);
        return json(res, 200, { deletions: await db.listUserDeletions(q, { search, limit }) });
      }

      // ---- 邮件模板与发送记录（docs/USER-LIFECYCLE.md §4.3/§4.5，AI 批）----
      if (path === '/api/admin/mail/templates' && req.method === 'GET') {
        if (!requireAdmin()) return;
        const saved = await db.listMailTemplates(q);
        const contactEmail = appealEmail();
        const templates = mailTemplates.TEMPLATE_EVENTS.map((def) => {
          const row = saved.get(def.event);
          const overrides = row
            ? { subject: row.subject, bodyHtml: row.body_html, bodyText: row.body_text, enabled: row.enabled }
            : { subject: def.subject ?? '', bodyHtml: mailTemplates.DEFAULT_TEMPLATES[def.event]?.bodyHtml ?? '', bodyText: mailTemplates.DEFAULT_TEMPLATES[def.event]?.bodyText ?? '', enabled: true };
          return {
            event: def.event,
            label: def.label,
            variables: def.variables,
            subject: overrides.subject,
            body_html: overrides.bodyHtml,
            body_text: overrides.bodyText,
            enabled: overrides.enabled,
            isDefault: !row,
            contactEmail,
          };
        });
        return json(res, 200, { templates, samples: mailTemplates.SAMPLE_THEMES, variables: mailTemplates.TEMPLATE_VARIABLES });
      }

      const tplAction = path.match(/^\/api\/admin\/mail\/templates\/([a-z_]+)\/(reset|preview|test)$/);
      if (tplAction) {
        if (!requireAdmin()) return;
        const event = tplAction[1];
        const action = tplAction[2];
        const known = mailTemplates.TEMPLATE_EVENTS.some((d) => d.event === event);
        if (!known) return json(res, 404, { error: '没有该模板事件' });
        if (action === 'reset') {
          await db.resetMailTemplate(q, event);
          return json(res, 200, { ok: true });
        }
        const body = await readBody(req);
        const vars = mailTemplates.templateVarsForPreview(event, String(body.to ?? user.email ?? ''), appealEmail());
        const target = await db.listMailTemplates(q).then((m) => m.get(event));
        const rendered = mailTemplates.renderTemplate({
          subject: target?.subject ?? mailTemplates.DEFAULT_TEMPLATES[event].subject,
          bodyHtml: target?.body_html ?? mailTemplates.DEFAULT_TEMPLATES[event].bodyHtml,
          bodyText: target?.body_text ?? mailTemplates.DEFAULT_TEMPLATES[event].bodyText ?? '',
          vars,
        });
        if (action === 'preview') return json(res, 200, rendered);
        // test：发给指定地址（默认当前管理员邮箱），走同一发送路径并写 mail_log
        const to = String(body.to ?? '').trim() || String(user.email ?? '');
        if (!to || !to.includes('@')) return json(res, 400, { error: '请提供有效的收件邮箱' });
        const nowMs = Date.now();
        const last = mailTestCooldown.get(user.id) ?? 0;
        if (nowMs - last < 10_000) return json(res, 429, { error: '测试邮件 10 秒内只能发一次' });
        mailTestCooldown.set(user.id, nowMs);
        const auth = await import('./email-auth.js');
        const cfg = await auth.smtpConfig(q);
        if (!auth.isSmtpConfigured(cfg)) return json(res, 503, { error: 'SMTP 未配置，无法发送测试邮件' });
        const sendResult = await notify.sendMail(
          { host: cfg.host, port: cfg.port, secure: cfg.secure, user: cfg.user, pass: cfg.pass, from: cfg.from, to, subject: rendered.subject, text: rendered.text, html: rendered.html },
          { logger, timeoutMs: 8000 },
        );
        await db.insertMailLog(q, { event, toEmail: to, subject: rendered.subject, ok: sendResult.ok, error: sendResult.error ?? null, actor: user.username });
        if (!sendResult.ok) return json(res, 502, { error: '发送失败：' + String(sendResult.error ?? '未知错误').slice(0, 200) });
        logger?.info('admin.mail_test_sent', { event, to: authRoutes.maskEmail(to), by: user.username });
        return json(res, 200, { ok: true });
      }

      const tplPut = path.match(/^\/api\/admin\/mail\/templates\/([a-z_]+)$/);
      if (tplPut && req.method === 'PUT') {
        if (!requireAdmin()) return;
        const event = tplPut[1];
        const known = mailTemplates.TEMPLATE_EVENTS.some((d) => d.event === event);
        if (!known) return json(res, 404, { error: '没有该模板事件' });
        const body = await readBody(req);
        const check = mailTemplates.validateTemplatePayload(event, {
          subject: body.subject,
          bodyHtml: body.body_html,
          bodyText: body.body_text == null ? null : String(body.body_text),
        });
        if (!check.ok) return json(res, 400, { error: check.error });
        await db.upsertMailTemplate(q, {
          event,
          subject: check.subject,
          bodyHtml: check.bodyHtml,
          bodyText: check.bodyText,
          enabled: body.enabled !== false,
          updatedBy: user.username,
        });
        return json(res, 200, { ok: true, warnings: check.warnings });
      }

      if (path === '/api/admin/mail/log' && req.method === 'GET') {
        if (!requireAdmin()) return;
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 200) || 200, 1), 500);
        return json(res, 200, { entries: await db.listMailLog(q, { limit }) });
      }

      if (path === '/api/admin/views' && req.method === 'GET') {
        if (!requireAdmin()) return;
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
          const rows = await q(
            "select g.id, g.steam_appid, coalesce(nullif(g.name, ''), nullif(g.name_en, ''), 'appid:' || g.steam_appid) as name, " +
            "(select min(o.price_cents) from offers o where o.game_id = g.id and o.in_stock) as low " +
            "from games g where g.steam_appid = any($1::int[]) or g.id = any($2::int[])",
            [appids, ids],
          );
          for (const g of rows.rows) {
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
        return json(res, 200, { views: enriched });
      }

      if (path === '/api/admin/users' && req.method === 'POST') {
        if (!requireAdmin()) return;
        const body = await readBody(req);
        const username = String(body.username ?? '').trim();
        const password = String(body.password ?? '');
        if (!username || password.length < 8 || password.length > 200) {
          return json(res, 400, { error: '用户名必填，密码需要 8-200 位' });
        }
        // 邮箱可选，但必须和账号在同一次写入里落库：先建号、再绑邮箱的两步式会让
        // "邮箱已被占用"时账号已落库，前端报错刷新却冒出幽灵用户（2026-11-06 反馈的 bug）。
        const auth = await import('./email-auth.js');
        const rawEmail = String(body.email ?? '').trim();
        const email = rawEmail ? auth.normalizeEmail(rawEmail) : null;
        if (rawEmail && !email) return json(res, 400, { error: '邮箱格式不正确' });
        const doCreate = () => db.createUser(q, { username, password, role: body.role === 'admin' ? 'admin' : 'user', email });
        let created;
        try {
          try {
            created = await doCreate();
          } catch (err) {
            // 老库可能缺列：补建后重试一次（与绑邮箱路由同款兜底）
            if (String(err.code) === '42703') {
              await q('alter table users add column if not exists email text');
              await q('alter table users add column if not exists email_verified boolean not null default false');
              created = await doCreate();
            } else {
              throw err;
            }
          }
        } catch (err) {
          if (String(err.code) === '23505') {
            const dupEmail = String(err.constraint ?? err.message ?? '').includes('email');
            return json(res, 409, { error: dupEmail ? '这个邮箱已被其他账号绑定' : '用户名已存在' });
          }
          logger?.error('api.user_create_failed', {
            username,
            code: err.code ?? null,
            message: String(err.message).slice(0, 200),
            by: user.username,
          });
          return json(res, 500, { error: '创建失败：' + String(err.message).slice(0, 160) });
        }
        logger?.info('api.user_created', { username: created.username, role: created.role, emailBound: Boolean(email) });
        return json(res, 201, { user: created });
      }

      // ---- 管理员：访问记录（分页 + 过滤 + 今日汇总）----
      if (path === '/api/admin/visitors' && req.method === 'GET') {
        if (!requireAdmin()) return;
        const page = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1);
        const pageSize = Math.min(Math.max(Number(url.searchParams.get('pageSize') ?? 20) || 20, 5), 200);
        const ip = String(url.searchParams.get('ip') ?? '').trim();
        const p = String(url.searchParams.get('path') ?? '').trim();
        // filter=visits（默认，正常访问）| blocked（被拦截）| all
        const filter = String(url.searchParams.get('filter') ?? 'visits');
        const list = await db.listVisitorLogs(q, { page, pageSize, ip: ip || null, path: p || null, filter });
        const summary = await db.visitorSummary(q);
        return json(res, 200, { ...list, page, pageSize, filter, pages: Math.max(1, Math.ceil(list.total / pageSize)), summary });
      }

      // ---- 管理员：封面图本地缓存统计 ----
      if (path === '/api/admin/images' && req.method === 'GET') {
        if (!requireAdmin()) return;
        return json(res, 200, { images: images.imageStats() });
      }

      // ---- 管理员：价格变动报表（涨跌榜 + 按天趋势 + CSV 导出）----
      if (path === '/api/admin/reports/price' && req.method === 'GET') {
        if (!requireAdmin()) return;
        const hours = Number(url.searchParams.get('hours') ?? 24);
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 100) || 100, 1), 500);
        const days = Number(url.searchParams.get('days') ?? 7);
        return json(res, 200, {
          report: await db.priceChanges(q, { hours, limit }),
          daily: await db.priceChangesByDay(q, { days }),
        });
      }

      if (path === '/api/admin/reports/price.csv' && req.method === 'GET') {
        if (!requireAdmin()) return;
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
            (r.was / 100).toFixed(2),
            (r.now_price / 100).toFixed(2),
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
        return;
      }

      // ---- 管理员：IP 黑名单 ----
      if (path === '/api/admin/blacklist' && req.method === 'GET') {
        if (!requireAdmin()) return;
        return json(res, 200, { ips: await db.listBlockedIps(q) });
      }

      if (path === '/api/admin/blacklist' && req.method === 'POST') {
        if (!requireAdmin()) return;
        const body = await readBody(req);
        const ip = visitors.normalizeBanInput(body.ip);
        if (!ip) return json(res, 400, { error: 'IP 格式不正确（支持 1.2.3.4 单个 IP 或 1.2.3.0/24 网段）' });
        // 互斥：加黑自动移白（含内存态），并把该 IP 的待审记录标记为 auto_banned
        const result = await banIpExclusive(ip, String(body.note ?? '').trim().slice(0, 200) || null, 'ban');
        logger?.info('api.ip_blocked', { ip, by: user.username, removedFromWhitelist: result.removedFromWhitelist });
        return json(res, 200, { ip: result.ip, removedFromWhitelist: result.removedFromWhitelist });
      }

      const unbanMatch = path.match(/^\/api\/admin\/blacklist\/([^/]+)$/);
      if (unbanMatch && req.method === 'DELETE') {
        if (!requireAdmin()) return;
        const target = decodeURIComponent(unbanMatch[1]);
        const removed = await db.removeBlockedIp(q, target);
        await visitors.refreshBlocklist(q).catch(() => {});
        logger?.info('api.ip_unblocked', { ip: target, removed, by: user.username });
        return json(res, 200, { removed });
      }

      // ---- 管理员：白名单（不受频率限制与黑名单影响）----
      if (path === '/api/admin/whitelist' && req.method === 'GET') {
        if (!requireAdmin()) return;
        return json(res, 200, { ips: await db.listWhitelist(q), config: ratelimit.currentConfig() });
      }

      if (path === '/api/admin/whitelist' && req.method === 'POST') {
        if (!requireAdmin()) return;
        const body = await readBody(req);
        const ip = visitors.normalizeBanInput(body.ip);
        if (!ip) return json(res, 400, { error: 'IP 格式不正确（支持 1.2.3.4 或 1.2.3.0/24）' });
        // 互斥：加白自动移黑（含内存态），黑名单不会"删白后复活"
        const result = await banIpExclusive(ip, String(body.note ?? '').trim().slice(0, 200) || null, 'trust');
        logger?.info('api.ip_whitelisted', { ip, by: user.username, removedFromBlacklist: result.removedFromBlacklist });
        return json(res, 200, { ip: result.ip, removedFromBlacklist: result.removedFromBlacklist });
      }

      const wlMatch = path.match(/^\/api\/admin\/whitelist\/([^/]+)$/);
      if (wlMatch && req.method === 'DELETE') {
        if (!requireAdmin()) return;
        const target = decodeURIComponent(wlMatch[1]);
        const removed = await db.removeWhitelistIp(q, target);
        ratelimit.removeWhitelist(target);
        logger?.info('api.ip_whitelist_removed', { ip: target, removed, by: user.username });
        return json(res, 200, { removed });
      }

      // ---- 管理员：超频/临时封禁记录 + 手动解封 ----
      if (path === '/api/admin/abuse' && req.method === 'GET') {
        if (!requireAdmin()) return;
        return json(res, 200, {
          abuse: await db.listAbuse(q, { limit: Number(url.searchParams.get('limit') ?? 50) }),
          config: ratelimit.currentConfig(),
        });
      }

      const abuseUnban = path.match(/^\/api\/admin\/abuse\/([^/]+)$/);
      if (abuseUnban && req.method === 'DELETE') {
        if (!requireAdmin()) return;
        const target = decodeURIComponent(abuseUnban[1]);
        const removed = await ratelimit.unban(q, target);
        await visitors.refreshBlocklist(q).catch(() => {});
        logger?.info('api.abuse_unbanned', { ip: target, removed, by: user.username });
        return json(res, 200, { removed });
      }

      // ---- 管理员：站点公告 ----
      if (path === '/api/admin/announcements' && req.method === 'GET') {
        if (!requireAdmin()) return;
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 200) || 200, 1), 200);
        return json(res, 200, { announcements: await db.listAnnouncements(q, { limit }) });
      }
      if (path === '/api/admin/announcements' && req.method === 'POST') {
        if (!requireAdmin()) return;
        const body = await readBody(req);
        const title = String(body.title ?? '').trim().slice(0, 120);
        const text = String(body.body ?? '').trim().slice(0, 4000);
        if (!title || !text) return json(res, 400, { error: '标题和内容不能为空' });
        const row = await db.createAnnouncement(q, {
          title,
          body: text,
          level: ['info', 'warning', 'critical'].includes(body.level) ? body.level : 'info',
          active: body.active !== false,
          startsAt: toIso(body.startsAt),
          endsAt: toIso(body.endsAt),
          createdBy: user.id,
        });
        logger?.info('announcement.created', { id: row.id, by: user.username });
        return json(res, 200, { announcement: row });
      }
      const annMatch = path.match(/^\/api\/admin\/announcements\/(\d+)$/);
      if (annMatch && (req.method === 'PATCH' || req.method === 'PUT')) {
        if (!requireAdmin()) return;
        const body = await readBody(req);
        const title = String(body.title ?? '').trim().slice(0, 120);
        const text = String(body.body ?? '').trim().slice(0, 4000);
        if (!title || !text) return json(res, 400, { error: '标题和内容不能为空' });
        const row = await db.updateAnnouncement(q, Number(annMatch[1]), {
          title,
          body: text,
          level: ['info', 'warning', 'critical'].includes(body.level) ? body.level : 'info',
          active: body.active !== false,
          startsAt: toIso(body.startsAt),
          endsAt: toIso(body.endsAt),
        });
        if (!row) return json(res, 404, { error: '公告不存在' });
        logger?.info('announcement.updated', { id: row.id, by: user.username });
        return json(res, 200, { announcement: row });
      }
      if (annMatch && req.method === 'DELETE') {
        if (!requireAdmin()) return;
        const removed = await db.deleteAnnouncement(q, Number(annMatch[1]));
        logger?.info('announcement.deleted', { id: Number(annMatch[1]), removed, by: user.username });
        return json(res, 200, { removed });
      }

      // ---- 管理员：设备指纹与设备封禁 ----
      if (path === '/api/admin/devices' && req.method === 'GET') {
        if (!requireAdmin()) return;
        return json(res, 200, { devices: await db.listDevices(q, { limit: Number(url.searchParams.get('limit') ?? 100) }) });
      }
      if (path === '/api/admin/device-bans' && req.method === 'GET') {
        if (!requireAdmin()) return;
        return json(res, 200, { bans: await db.listDeviceBans(q, { limit: 200 }) });
      }
      if (path === '/api/admin/devices/ban' && req.method === 'POST') {
        if (!requireAdmin()) return;
        const body = await readBody(req);
        const fingerprint = String(body.fingerprint ?? '').trim().toLowerCase();
        if (!/^[a-f0-9]{32,64}$/.test(fingerprint)) return json(res, 400, { error: 'fingerprint 不合法' });
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
        return json(res, 200, { ban: row });
      }
      const devBanMatch = path.match(/^\/api\/admin\/device-bans\/([a-f0-9]{16,64})$/);
      if (devBanMatch && req.method === 'DELETE') {
        if (!requireAdmin()) return;
        const removed = await db.removeDeviceBan(q, devBanMatch[1]);
        await devices.loadBans(q).catch(() => {});
        logger?.info('device.unbanned', { fingerprint: devBanMatch[1].slice(0, 16), removed, by: user.username });
        return json(res, 200, { removed });
      }

      // ---- 管理员：异常请求审核（不自动封，审批后才封 IP / 设备）----
      if (path === '/api/admin/reviews' && req.method === 'GET') {
        if (!requireAdmin()) return;
        const status = String(url.searchParams.get('status') ?? '') === 'all' ? 'all' : 'pending';
        const reviews = await db.listAbuseReviews(q, { status, limit: Number(url.searchParams.get('limit') ?? 300) });
        return json(res, 200, { reviews, pending: await db.countPendingReviews(q) });
      }
      if (path === '/api/admin/reviews/approve' && req.method === 'POST') {
        if (!requireAdmin()) return;
        const body = await readBody(req);
        const review = await db.getAbuseReview(q, Number(body.id));
        if (!review || review.status !== 'pending') return json(res, 404, { error: '审核记录不存在或已处理' });
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
        return json(res, 200, { ok: true, bannedIp, bannedDevice });
      }
      if (path === '/api/admin/reviews/reject' && req.method === 'POST') {
        if (!requireAdmin()) return;
        const body = await readBody(req);
        const row = await db.finishAbuseReview(q, Number(body.id), { status: 'rejected', reviewedBy: user.id, note: body.note });
        if (!row) return json(res, 404, { error: '审核记录不存在' });
        return json(res, 200, { ok: true });
      }

      // ---- 管理员：批量操作（统一入口 + 白名单派发表，见 docs/ADMIN-BULK-ACTIONS.md）----
      if (path === '/api/admin/bulk' && req.method === 'POST') {
        if (!requireAdmin()) return;
        const startedAt = Date.now();
        let body;
        try {
          body = await readBody(req, 256 * 1024);
        } catch {
          return json(res, 400, { error: '请求格式错误' });
        }
        if (!body || typeof body !== 'object') return json(res, 400, { error: '请求格式错误' });
        const target = String(body.target ?? '').trim();
        const action = String(body.action ?? '').trim();
        const reject = async (status, reason) => {
          logger?.warn('admin.bulk_rejected', {
            target,
            action,
            reason,
            count: Array.isArray(body.keys) ? body.keys.length : 0,
            by: user.username,
          });
          return json(res, status, { error: reason });
        };
        const def = BULK_ACTIONS[`${target}/${action}`];
        if (!def) return reject(400, '不支持的批量操作');
        if (!Array.isArray(body.keys)) return reject(400, 'keys 必须是数组');
        if (!body.keys.length) return reject(400, '请先选择要操作的条目');
        // 逐条校验 → 规范化 → 去重：IP 的大小写/CIDR 写法、指纹大小写、id 写成字符串都算同一个键
        const keys = [];
        const seen = new Set();
        for (const raw of body.keys) {
          const key = normalizeBulkKey(def.keyType, raw);
          if (key == null) return reject(400, BULK_KEY_ERROR[def.keyType]);
          const sig = String(key);
          if (seen.has(sig)) continue;
          seen.add(sig);
          keys.push(key);
        }
        if (!keys.length) return reject(400, '请先选择要操作的条目');
        if (keys.length > def.max) return reject(400, `单次最多 ${def.max} 条`);
        // 高危动作必须在服务端二次确认，不能只靠前端弹窗
        if (def.risk === 'high') {
          const confirmCount = Number(body.confirmCount);
          if (!Number.isInteger(confirmCount) || confirmCount !== keys.length) {
            return reject(400, `高危操作需要确认条数（本次 ${keys.length} 条）`);
          }
        }
        if (def.guard) {
          const blockedReason = await def.guard({ q, keys, user });
          if (blockedReason) return reject(409, blockedReason);
        }
        let outcome;
        try {
          outcome = await def.run({ q, keys, options: body.options, user, logger });
        } catch (err) {
          logger?.error('admin.bulk_failed', { target, action, message: String(err.message).slice(0, 200), by: user.username });
          return json(res, 500, { error: '批量执行失败，请稍后重试' });
        }
        const results = (outcome.results || []).slice(0, 200);
        const ok = Number(outcome.ok) || 0;
        const failed = results.filter((item) => item.status === 'failed').length;
        const skipped = results.filter((item) => item.status === 'skipped').length;
        const durationMs = Date.now() - startedAt;
        let opId = null;
        try {
          const op = await db.createBulkOp(q, {
            actorId: user.id,
            actor: user.username,
            target,
            action,
            total: keys.length,
            ok,
            failed,
            skipped,
            keysSample: keys.map((k) => String(k)),
            options: body.options ?? null,
            ip,
            durationMs,
          });
          opId = op.id;
        } catch (err) {
          // 审计写失败不影响已执行的结果，但必须留下证据
          logger?.error('admin.bulk_audit_failed', { target, action, message: String(err.message).slice(0, 200) });
        }
        logger?.info('admin.bulk', { opId, target, action, total: keys.length, ok, failed, skipped, by: user.username });
        for (const item of results.filter((r) => r.status === 'failed').slice(0, 20)) {
          logger?.warn('admin.bulk_item_failed', { target, action, key: String(item.key).slice(0, 64), message: item.reason });
        }
        const reply = { opId, total: keys.length, ok, failed, skipped, results };
        // 互斥回执（docs/BAN-AND-SECURITY-FIXES.md §4.1）：批量封/信任时带被互斥移除的对侧条目数
        if (Number.isFinite(outcome.removedFromWhitelist)) reply.removedFromWhitelist = outcome.removedFromWhitelist;
        if (Number.isFinite(outcome.removedFromBlacklist)) reply.removedFromBlacklist = outcome.removedFromBlacklist;
        return json(res, 200, reply);
      }

      // ---- 管理员：批量操作记录（审计：谁、何时、对哪个列表、做了什么、成败多少）----
      if (path === '/api/admin/bulk-ops' && req.method === 'GET') {
        if (!requireAdmin()) return;
        const limit = Number(url.searchParams.get('limit') ?? 100);
        const target = url.searchParams.get('target') || null;
        return json(res, 200, { ops: await db.listBulkOps(q, { limit, target }) });
      }
      const bulkOpMatch = path.match(/^\/api\/admin\/bulk-ops\/(\d+)$/);
      if (bulkOpMatch && req.method === 'GET') {
        if (!requireAdmin()) return;
        const op = await db.getBulkOp(q, Number(bulkOpMatch[1]));
        if (!op) return json(res, 404, { error: '记录不存在' });
        return json(res, 200, { op });
      }

      return json(res, 404, { error: 'not found' });
    } catch (err) {
      logger?.error('api.error', { path, message: String(err.message).slice(0, 200) });
      return json(res, 500, { error: '服务器错误' });
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

// ---------------------------------------------------------------- 后台批量操作
//
// 设计见 docs/ADMIN-BULK-ACTIONS.md：所有列表共用一个 POST /api/admin/bulk，
// 靠这张白名单派发表决定「哪些 target/action 合法、单次上限多少、是不是高危」。
// 未登记的组合一律 400 —— 新增一个列表必须显式改这张表，不允许隐式放行。
//
// 两种执行形态：
//   · 纯 SQL 批量（解封/恢复/启停/忽略/删除/禁用）：一次 update/delete ... = any(数组)，
//     returning 出来的就是成功集，没返回的记 skipped；
//   · 逐条复用单条逻辑（封 IP / 封设备 / 信任 / 设备封禁）：上限只有 50，串行执行，
//     单条异常记 failed 不影响其它条（与 ingest 的失败模型一致）。

const BULK_KEY_ERROR = {
  id: '条目 id 不合法',
  ip: 'IP 格式不正确（支持 1.2.3.4 单个 IP 或 1.2.3.0/24 网段）',
  fingerprint: '设备指纹不合法',
};

const BULK_ACTIONS = {
  'reviews/approve-ip': { max: 50, risk: 'high', keyType: 'id', run: bulkReviewApproveIp },
  'reviews/approve-device': { max: 50, risk: 'high', keyType: 'id', run: bulkReviewApproveDevice },
  'reviews/reject': { max: 200, risk: 'low', keyType: 'id', run: bulkReviewReject },
  'visitors/ban-ip': { max: 50, risk: 'high', keyType: 'ip', run: bulkVisitorBanIp },
  'visitors/trust': { max: 200, risk: 'low', keyType: 'ip', run: bulkVisitorTrust },
  'games/restore': { max: 1000, risk: 'low', keyType: 'id', run: bulkGameRestore },
  'games/block': { max: 50, risk: 'high', keyType: 'id', run: bulkGameBlock },
  'games/unblock': { max: 200, risk: 'low', keyType: 'id', run: bulkGameUnblock },
  'games/delete': { max: 50, risk: 'high', keyType: 'id', run: bulkGameDelete },
  'announcements/delete': { max: 50, risk: 'high', keyType: 'id', run: bulkAnnouncementDelete },
  'announcements/activate': { max: 200, risk: 'low', keyType: 'id', run: bulkAnnouncementActivate },
  'announcements/deactivate': { max: 200, risk: 'low', keyType: 'id', run: bulkAnnouncementDeactivate },
  'blacklist/unban': { max: 200, risk: 'low', keyType: 'ip', run: bulkBlacklistUnban },
  'whitelist/remove': { max: 200, risk: 'low', keyType: 'ip', run: bulkWhitelistRemove },
  'device-bans/unban': { max: 200, risk: 'low', keyType: 'fingerprint', run: bulkDeviceBanRemove },
  'abuse/unban': { max: 200, risk: 'low', keyType: 'ip', run: bulkAbuseUnban },
  'devices/ban': { max: 50, risk: 'high', keyType: 'fingerprint', run: bulkDeviceBan },
  'users/disable': { max: 50, risk: 'high', keyType: 'id', guard: bulkGuardUserDisable, run: bulkUserDisable },
  'users/enable': { max: 200, risk: 'low', keyType: 'id', run: bulkUserEnable },
};

/** 键规范化：IP 走 visitors.normalizeBanInput（与单条接口同一口径），非法返回 null。 */
function normalizeBulkKey(keyType, raw) {
  if (keyType === 'ip') return visitors.normalizeBanInput(raw);
  if (keyType === 'fingerprint') {
    const fp = String(raw ?? '').trim().toLowerCase();
    return /^[a-f0-9]{32,64}$/.test(fp) ? fp : null;
  }
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * 黑/白名单互斥（docs/BAN-AND-SECURITY-FIXES.md §4）：加黑自动移白、加白自动移黑，含内存态同步。
 * SQL 在 src/store/pg.js（addBlockedIp / addWhitelistIp 已互斥删除对方表），这里负责内存态与回执。
 * refresh: 是否立即重建内存黑名单（批量场景传 false，跑完由 runner 统一刷一次）。
 */
async function banIpExclusiveSql(q, ip, note, kind, { refresh = true, markReviews = true } = {}) {
  if (kind === 'ban') {
    const row = await db.addBlockedIp(q, { ip, note });
    if (row.removedFromWhitelist) ratelimit.removeWhitelist(ip);
    if (refresh) await visitors.refreshBlocklist(q).catch(() => {});
    if (markReviews) await db.markReviewsAutoBanned(q, { ip, note: '手动封禁' }).catch(() => {});
    return { ip: row.ip, removedFromWhitelist: row.removedFromWhitelist };
  }
  const row = await db.addWhitelistIp(q, { ip, note });
  if (refresh) await visitors.refreshBlocklist(q).catch(() => {});
  ratelimit.addWhitelist(ip);
  return { ip: row.ip, removedFromBlacklist: row.removedFromBlacklist };
}

/** 纯 SQL 批量的收尾：返回真正改动的键，其余记为 skipped（幂等重放不虚报成功）。 */
function bulkMissing(keys, doneKeys, reason) {  const done = new Set(doneKeys.map((k) => String(k)));
  return keys.filter((k) => !done.has(String(k))).map((k) => ({ key: String(k), status: 'skipped', reason }));
}

/** 逐条执行的小工具：把单条异常收敛成 failed，不影响其它条。 */
async function bulkEach(keys, handler) {
  const results = [];
  let ok = 0;
  let touched = false;
  for (const key of keys) {
    try {
      const outcome = await handler(key);
      if (outcome === 'done') {
        ok += 1;
        touched = true;
      } else {
        results.push({ key: String(key), status: 'skipped', reason: outcome || '状态已一致' });
      }
    } catch (err) {
      results.push({ key: String(key), status: 'failed', reason: String(err?.message ?? err).slice(0, 120) });
    }
  }
  return { ok, results, touched };
}

async function bulkReviewApproveIp({ q, keys, user }) {
  const rows = await db.bulkGetAbuseReviews(q, keys);
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  const { ok, results, touched } = await bulkEach(keys, async (key) => {
    const review = byId.get(String(key));
    if (!review) return '审核记录不存在';
    if (review.status !== 'pending') return '已处理过';
    if (!review.ip) return '该记录没有 IP';
    // 互斥 helper：加黑移白 + 待审标记（内存黑名单由循环后统一刷一次）
    await banIpExclusiveSql(q, review.ip, `批量审核通过（${review.rule}）by ${user.username}`, 'ban', { refresh: false });
    await db.finishAbuseReview(q, review.id, { status: 'approved', reviewedBy: user.id, note: '批量封 IP' });
    return 'done';
  });
  if (touched) await visitors.refreshBlocklist(q).catch(() => {});
  return { ok, results };
}

async function bulkReviewApproveDevice({ q, keys, user }) {
  const rows = await db.bulkGetAbuseReviews(q, keys);
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  const { ok, results, touched } = await bulkEach(keys, async (key) => {
    const review = byId.get(String(key));
    if (!review) return '审核记录不存在';
    if (review.status !== 'pending') return '已处理过';
    if (!review.fingerprint) return '该记录没有设备指纹';
    await db.upsertDeviceBan(q, {
      fingerprint: review.fingerprint,
      deviceId: review.device_id,
      note: `批量审核通过（${review.rule}）by ${user.username}`,
    });
    await db.finishAbuseReview(q, review.id, { status: 'approved', reviewedBy: user.id, note: '批量封设备' });
    return 'done';
  });
  if (touched) await devices.loadBans(q).catch(() => {});
  return { ok, results };
}

async function bulkReviewReject({ q, keys, user }) {
  const done = await db.bulkRejectAbuseReviews(q, { ids: keys, reviewedBy: user.id, note: '批量忽略' });
  return { ok: done.length, results: bulkMissing(keys, done, '审核记录不存在或已处理') };
}

async function bulkVisitorBanIp({ q, keys, user }) {
  let removedFromWhitelist = 0;
  const { ok, results, touched } = await bulkEach(keys, async (ip) => {
    const outcome = await banIpExclusiveSql(q, ip, `批量封禁 by ${user.username}`, 'ban', { refresh: false });
    if (outcome.removedFromWhitelist) removedFromWhitelist += 1;
    return 'done';
  });
  if (touched) await visitors.refreshBlocklist(q).catch(() => {});
  return { ok, results, removedFromWhitelist };
}

async function bulkVisitorTrust({ q, keys, user }) {
  let removedFromBlacklist = 0;
  const { ok, results } = await bulkEach(keys, async (ip) => {
    const outcome = await banIpExclusiveSql(q, ip, `批量信任 by ${user.username}`, 'trust', { refresh: false });
    if (outcome.removedFromBlacklist) removedFromBlacklist += 1;
    return 'done';
  });
  // 加白会互斥删除黑名单条目：内存黑名单必须跟着刷，否则删掉的条目还挡着路
  if (removedFromBlacklist) await visitors.refreshBlocklist(q).catch(() => {});
  return { ok, results, removedFromBlacklist };
}

async function bulkGameRestore({ q, keys }) {
  const done = await db.bulkSetGamesDeleted(q, { ids: keys, deleted: false });
  return { ok: done.length, results: bulkMissing(keys, done, '游戏不存在或未删除') };
}

async function bulkGameBlock({ q, keys }) {
  const done = await db.bulkSetGamesBlocked(q, { ids: keys, blocked: true });
  return { ok: done.length, results: bulkMissing(keys, done, '游戏不存在或已禁用') };
}

async function bulkGameUnblock({ q, keys }) {
  const done = await db.bulkSetGamesBlocked(q, { ids: keys, blocked: false });
  return { ok: done.length, results: bulkMissing(keys, done, '游戏不存在或已是启用状态') };
}

async function bulkGameDelete({ q, keys }) {
  const done = await db.bulkSetGamesDeleted(q, { ids: keys, deleted: true });
  return { ok: done.length, results: bulkMissing(keys, done, '游戏不存在或已在回收站') };
}

async function bulkAnnouncementDelete({ q, keys }) {
  const done = await db.bulkDeleteAnnouncements(q, keys);
  return { ok: done.length, results: bulkMissing(keys, done, '公告不存在或已删除') };
}

async function bulkAnnouncementActivate({ q, keys }) {
  const done = await db.bulkSetAnnouncementsActive(q, { ids: keys, active: true });
  return { ok: done.length, results: bulkMissing(keys, done, '公告不存在或已是启用状态') };
}

async function bulkAnnouncementDeactivate({ q, keys }) {
  const done = await db.bulkSetAnnouncementsActive(q, { ids: keys, active: false });
  return { ok: done.length, results: bulkMissing(keys, done, '公告不存在或已是停用状态') };
}

async function bulkBlacklistUnban({ q, keys }) {
  const done = await db.bulkRemoveBlockedIps(q, keys);
  // 内存黑名单必须同步刷新，否则这批 IP 仍会被 403（验收 §8.3 专门盯这条）
  if (done.length) await visitors.refreshBlocklist(q).catch(() => {});
  return { ok: done.length, results: bulkMissing(keys, done, '不在黑名单中') };
}

async function bulkWhitelistRemove({ q, keys }) {
  const done = await db.bulkRemoveWhitelistIps(q, keys);
  for (const ip of done) ratelimit.removeWhitelist(ip);
  return { ok: done.length, results: bulkMissing(keys, done, '不在白名单中') };
}

async function bulkDeviceBanRemove({ q, keys }) {
  const done = await db.bulkRemoveDeviceBans(q, keys);
  if (done.length) await devices.loadBans(q).catch(() => {});
  return { ok: done.length, results: bulkMissing(keys, done, '不在设备封禁列表中') };
}

async function bulkAbuseUnban({ q, keys }) {
  const { ok, results, touched } = await bulkEach(keys, async (ip) => {
    const removed = await ratelimit.unban(q, ip);
    return removed ? 'done' : '没有临时封禁记录';
  });
  if (touched) await visitors.refreshBlocklist(q).catch(() => {});
  return { ok, results };
}

async function bulkDeviceBan({ q, keys, options, user }) {
  const minutes = Number(options?.minutes);
  const permanent = options?.permanent === true || !Number.isFinite(minutes) || minutes <= 0;
  const until = permanent ? null : new Date(Date.now() + minutes * 60_000).toISOString();
  const note = String(options?.note ?? '').trim().slice(0, 200) || `批量封禁 by ${user.username}`;
  const { ok, results } = await bulkEach(keys, async (fingerprint) => {
    await db.upsertDeviceBan(q, { fingerprint, deviceId: null, note, until });
    return 'done';
  });
  if (ok) await devices.loadBans(q).catch(() => {});
  return { ok, results };
}

/** 用户批量禁用的守卫：不能把最后一个可用管理员禁掉，也不能禁用自己。 */
async function bulkGuardUserDisable({ q, keys, user }) {
  const rows = await db.usersForBulk(q, keys);
  const disablingAdmins = rows.filter((row) => row.role === 'admin' && !row.disabled).length;
  if (disablingAdmins > 0) {
    const remaining = await db.countActiveAdmins(q, { excludeIds: keys });
    if (remaining <= 0) return '不能禁用最后一个可用管理员';
  }
  if (rows.some((row) => row.id === user.id)) return '不能禁用自己的账号';
  return null;
}

async function bulkUserDisable({ q, keys }) {
  const done = await db.bulkSetUsersDisabled(q, { ids: keys, disabled: true });
  // 禁用要立即生效：删掉这些用户的会话，否则旧 cookie 还能继续用
  if (done.length) await db.deleteSessionsOfUsers(q, done.map((row) => row.id));
  const doneIds = done.map((row) => row.id);
  return { ok: done.length, results: bulkMissing(keys, doneIds, '用户不存在或已是禁用状态') };
}

async function bulkUserEnable({ q, keys }) {
  const done = await db.bulkSetUsersDisabled(q, { ids: keys, disabled: false });
  return { ok: done.length, results: bulkMissing(keys, done.map((row) => row.id), '用户不存在或已是启用状态') };
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
function serveStatic(res, outDir, pathname) {
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
    'cache-control': file.endsWith('.html') ? 'no-cache' : 'public, max-age=300',
  });
  res.end(body);
}

/**
 * PWA 根文件（manifest / 图标）：源文件在 frontend/public，构建后落在 dist 根目录。
 * 不能走 outDir——线上 outDir 是 web/（旧页面与图标）或 out/（静态曲线页），
 * 否则 /manifest.webmanifest 与 /icon-*.png 会 404，"添加到主屏幕"直接失效。
 */
export function isFrontendPublicFile(pathname) {
  return pathname === '/manifest.webmanifest' || pathname.startsWith('/icon-');
}

/** Vue 构建产物负责站点所有页面；无构建产物时回退到 web 目录。 */
export function serveFrontendStatic(res, frontendDir, outDir, pathname) {
  if (!frontendDir || !existsSync(resolve(frontendDir, 'index.html'))) return serveStatic(res, outDir, pathname);
  if (['/', '/console', '/console/', '/setup', '/setup/', '/banned', '/banned/', '/appeal', '/appeal/', '/index.html', '/console.html', '/setup.html', '/banned.html'].includes(pathname)) {
    return serveStatic(res, frontendDir, '/index.html');
  }
  if (pathname.startsWith('/assets/') || isFrontendPublicFile(pathname)) return serveStatic(res, frontendDir, pathname);
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
  steamWishlistPush = null,
}) {
  const server = createApiServer({ query, logger, outDir, frontendDir, store, setupToken, getSetupState, imageFetch, steamVerify, steamWishlistPush });
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
        ratelimit.configure({
          enabled: process.env.RATE_LIMIT_ENABLED !== '0',
          max: Number(process.env.RATE_LIMIT_MAX ?? 60),
          assetMax: Number(process.env.RATE_LIMIT_ASSET_MAX ?? 300),
          windowSec: Number(process.env.RATE_LIMIT_WINDOW_SEC ?? 60),
        });
        const loaded = await ratelimit.loadState(query);
        logger?.info('rate.init', { ...ratelimit.currentConfig(), ...loaded });
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
