// B4 #20 cli 运维类域（CO-5/B4-2 第十二轮拆分）：backfill/rename/heat/rating-backfill/search-tokens/
// images/prune/logs/backup/diagnose/proxy-check/probe/readmodel/serve/all。
// 按 ARCHITECTURE §15 模式：本模块**不 import cli.js**（入口文件带 main() 副作用），
// 宿主（cli.js）把共享上下文打包成 ctx 传入（§15.2 类比），createCliOps(ctx) 返回：
//   - commands        15 个运维类命令（commands 注册表条目指这里）
//   - trackedCommands heat/rename/rating-backfill/search-tokens/backfill/images/backup/prune/readmodel
//                     （写 sync_runs + fetch_runs，TRACKED_COMMANDS 语义保持）
// 契约零变化：命令名/参数/输出/退出码与拆分前逐字节一致。
// setupAccessForRun / printSetupToken 仅 all/serve 命令用 → 随域移入本文件（含 randomBytes）。

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readLogs } from '../log.js';
import { openStore, ping } from '../store/index.js';
import { startApiServer } from '../server.js';
import * as db from '../store/pg.js';
import { ingestOffers } from '../ingest.js';
import { missingPriceAppids, mergePriceOffers, writeBackfillProgress } from '../backfill.js';
import { applySteamDetails, entryFromMeta, runRatingBackfillRound, runExplicitBackfillRound } from '../steam-status.js';
import { fetchMetadata } from '../adapters/steam-meta.js';
import { syncPrices } from '../adapters/steam.js';
import { baseRegion, regionContext } from '../sync-regions.js';
import { describeProxy, decideProxy, redactProxy } from '../proxy.js';
import * as settings from '../settings.js';
import { formatDayUtc } from '../format.js';
import { fetchText, fetchJson, fetchBuffer, sleep, readSteam429Info, readSteam403Info } from '../http.js';
import { createBackup } from '../backup.js';
import * as cliOpsRepo from '../store/cli-ops-repository.js';

function setupAccessForRun(initialized) {
  if (initialized.completed) return { token: process.env.SETUP_TOKEN ?? '', generated: false };
  const configured = String(process.env.SETUP_TOKEN ?? '').trim();
  return configured
    ? { token: configured, generated: false }
    : { token: randomBytes(24).toString('base64url'), generated: true };
}

function printSetupToken(access) {
  if (access.generated) {
    console.log(`首次初始化口令（仅本次启动有效）：${access.token}`);
    console.log('请在 /setup 页面输入此口令；重启后未完成初始化则会生成新口令。');
  }
}

export function createCliOps(ctx) {
  const { args, flag, logger, withStore, syncNote, pad, dbTarget, runId } = ctx;

  /** 逻辑备份：核心表导出成 gzip JSON，保留最近 7 份；顺带清理过期浏览记录。 */
  async function cmdBackup() {
    const dir = String(flag('out', 'data/backup'));
    const result = await withStore((store) =>
      createBackup((sql, p) => store.query(sql, p), {
        dir,
        keep: 7,
        viewDays: Number(flag('days', 90)),
        logger,
      }),
    );
    console.log(`备份完成：${result.file}`);
    console.log(
      `  表 ${result.tables} 张、${result.rows} 行；清理旧备份 ${result.removedOld} 份；` +
        `清理过期浏览记录 ${result.purgedViews} 条；清理过期邮件记录 ${result.purgedCodes} 条`,
    );
  }

  /**
   * 一体化：同一进程跑 Web/API，并把调度器作为子进程拉起。
   * 部署只需要一个服务：既能采集，又能出前端与 /console 控制台。
   */
  async function cmdAll() {
    const port = Number(flag('port', process.env.WEB_PORT ?? 8080));
    const host = String(flag('host', '0.0.0.0'));
    const dir = String(flag('dir', existsSync('web') ? 'web' : (process.env.OUT_DIR ?? 'out')));
    const frontendDir = existsSync('frontend/dist/index.html') ? 'frontend/dist' : null;
    if (!Number.isFinite(port) || port < 0) throw new Error(`端口不合法：${port}`);

    const store = await openStore(dbTarget, { logger, timezone: process.env.TZ });
    await db.migrate(store); // 启动即补齐列，避免旧库缺字段导致查询 500
    await (await import('../email-auth.js')).ensureEmailSchema(store); // 邮箱验证码相关表
    await (await import('../steam-login.js')).ensureSteamSchema(store); // Steam 登录与游戏库
    const initialized = await settings.initializeSettings({ store, logger });
    await store.setTimezone?.(process.env.TZ); // 数据库里的时区设置水合后立即生效
    const setupAccess = setupAccessForRun(initialized);
    const levelFlag = flag('level', null);
    if (levelFlag && typeof levelFlag === 'string') logger.setLevel(levelFlag);
    const q = (sql, p) => store.query(sql, p);
    const srv = await startApiServer({
      query: q,
      logger,
      outDir: dir,
      frontendDir,
      port,
      host,
      store,
      setupToken: setupAccess.token,
      getSetupState: async () => ({ completed: await settings.isSetupComplete(q) }),
    });
    logger.info('app.all_mode', { port: srv.port, staticDir: dir, setupCompleted: initialized.completed });

    const child = spawn(process.execPath, ['src/scheduler.js'], { stdio: 'inherit' });
    child.on('exit', (code) => logger.warn('app.scheduler_exit', { code }));

    console.log(`服务已启动：http://<服务器IP>:${srv.port}/`);
    if (!initialized.completed) {
      console.log(`首次初始化：http://<服务器IP>:${srv.port}/setup`);
      logger.info('app.setup_required', { url: '/setup', setupToken: true, generated: setupAccess.generated });
      printSetupToken(setupAccess);
    }
    console.log(`管理控制台：http://<服务器IP>:${srv.port}/console（需管理员登录）`);
    console.log('采集调度器已在同一容器内启动；Ctrl+C 停止');

    await new Promise((done) => {
      const stop = () => {
        logger.info('app.stopping', {});
        try {
          child.kill('SIGTERM');
        } catch {
          /* 已退出 */
        }
        srv.close().then(() => store.close()).then(done);
      };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    });
  }

  /** 内置静态页服务：直接 IP:端口 访问生成好的页面，不需要外部 nginx。 */
  async function cmdServe() {
    // v2.28.6：与 compose 的容器端口映射（8080）保持一致；旧默认 8090 会造成 nginx 502。
    const port = Number(flag('port', process.env.WEB_PORT ?? process.env.PORT ?? 8080));
    const host = String(flag('host', '0.0.0.0'));
    // 有 web/ 就服务前端工程，否则退回静态页目录
    const dir = String(flag('dir', existsSync('web') ? 'web' : (process.env.OUT_DIR ?? 'out')));
    const frontendDir = existsSync('frontend/dist/index.html') ? 'frontend/dist' : null;
    if (!Number.isFinite(port) || port < 0) throw new Error(`端口不合法：${port}`);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const store = await openStore(dbTarget, { logger, timezone: process.env.TZ });
    await db.migrate(store); // 启动即补齐列，避免旧库缺字段导致查询 500
    await (await import('../email-auth.js')).ensureEmailSchema(store); // 邮箱验证码相关表
    const initialized = await settings.initializeSettings({ store, logger });
    await store.setTimezone?.(process.env.TZ);
    const setupAccess = setupAccessForRun(initialized);
    const levelFlag = flag('level', null);
    if (levelFlag && typeof levelFlag === 'string') logger.setLevel(levelFlag);
    const q = (sql, p) => store.query(sql, p);
    const srv = await startApiServer({
      query: q,
      logger,
      outDir: dir,
      frontendDir,
      port,
      host,
      store,
      setupToken: setupAccess.token,
      getSetupState: async () => ({ completed: await settings.isSetupComplete(q) }),
    });

    console.log(`Web 服务已启动：http://${host === '0.0.0.0' ? '<服务器IP>' : host}:${srv.port}/`);
    if (!initialized.completed) {
      console.log(`首次初始化：http://${host === '0.0.0.0' ? '<服务器IP>' : host}:${srv.port}/setup`);
      printSetupToken(setupAccess);
    }
    console.log(`静态目录：${dir} · 接口：/api/*（前台免登录可读，写操作需管理员）`);
    console.log('Ctrl+C 停止');

    await new Promise((done) => {
      const stopServer = () => {
        logger.info('web.stopping', {});
        srv.close().then(() => store.close()).then(done);
      };
      process.once('SIGINT', stopServer);
      process.once('SIGTERM', stopServer);
    });
  }

  /** 清理 N 天前的日志文件（jsonl / boot.log 按行截断）。 */
  async function pruneLogs(days = 7) {
    const fsMod = await import('node:fs');
    const pathMod = await import('node:path');
    const dir = process.env.LOG_DIR ?? 'logs';
    const cutoff = Date.now() - days * 24 * 3600 * 1000;
    let removed = 0;
    let kept = 0;
    let entries = [];
    try {
      entries = fsMod.readdirSync(dir).filter((n) => n.endsWith('.jsonl'));
    } catch {
      entries = [];
    }
    for (const name of entries) {
      const p = pathMod.join(dir, name);
      try {
        const st = fsMod.statSync(p);
        if (st.mtimeMs < cutoff) {
          fsMod.unlinkSync(p);
          removed += 1;
        } else {
          kept += 1;
        }
      } catch {
        /* 单个文件失败不影响整体 */
      }
    }
    // boot.log 会持续追加，超过 5MB 时保留最后 2000 行
    const boot = pathMod.join(dir, 'boot.log');
    try {
      const st = fsMod.statSync(boot);
      if (st.size > 5 * 1024 * 1024) {
        const lines = fsMod.readFileSync(boot, 'utf8').split('\n');
        fsMod.writeFileSync(boot, lines.slice(-2000).join('\n'));
        logger.info('logs.boot_truncated', { keptLines: 2000 });
      }
    } catch {
      /* 没有 boot.log 就算了 */
    }
    logger.info('logs.pruned', { days, removed, kept });
    console.log(`日志清理完成：删除 ${removed} 个文件，保留 ${kept} 个（阈值 ${days} 天）`);
    return { removed, kept };
  }

  function cmdLogs() {
    if (flag('action') === 'prune' || process.argv.includes('prune')) {
      return pruneLogs(Number(flag('days', '7')) || 7);
    }
    const recs = readLogs({
      dir: String(flag('log-dir', 'logs')),
      level: flag('level', null),
      event: flag('event', null),
      runId: flag('run', null),
      sinceMinutes: flag('since', null) ? Number(flag('since', null)) : null,
      limit: Number(flag('limit', 50)),
    });
    if (!recs.length) {
      console.log('没有匹配的日志');
      return;
    }
    for (const r of recs.reverse()) {
      const { ts, level, event, pid, ...rest } = r;
      console.log(`${ts} ${level.toUpperCase().padEnd(5)} ${event} ${JSON.stringify(rest)}`);
    }
  }

  async function cmdDiagnose() {
    const checks = [];
    const add = (name, ok, detail) => {
      checks.push({ name, ok, detail });
      logger.info('diagnose.check', { name, ok, detail });
    };

    add('node', true, process.version);
    add('platform', true, `${process.platform} ${process.arch}`);
    add('cwd', true, process.cwd());
    add('DATABASE_URL', Boolean(process.env.DATABASE_URL), process.env.DATABASE_URL ? '已设置（已脱敏）' : '未设置');
    add('ITAD_API_KEY', Boolean(process.env.ITAD_API_KEY), process.env.ITAD_API_KEY ? '已设置' : '未设置（ITAD 源会跳过）');

    // 出网通道：国内服务器访问 Steam 需要蒸汽专用代理，这里把决策结果显式打出来
    const proxyInfo = describeProxy(process.env);
    add('proxy:steam', true, proxyInfo.steam.via === 'direct' ? '直连（国内通常不可达）' : `${proxyInfo.steam.via} → ${proxyInfo.steam.proxy}`);
    add('proxy:others', true, proxyInfo.others.via === 'direct' ? '直连' : `${proxyInfo.others.via} → ${proxyInfo.others.proxy}`);
    // AM-1：Steam 代理池（docs/PROXY-POOL.md §4.5）——池里每条的状态（地址已脱敏）
    if (proxyInfo.steam.poolCount > 1) {
      add('proxy:pool', true, `Steam 代理池 ${proxyInfo.steam.poolCount} 条`);
      const { proxyHealth } = await import('../proxy-pool.js');
      for (const p of proxyHealth(process.env).proxies) {
        const stateText = p.state === 'ok' ? '正常' : p.state === 'cooldown' ? `冷却中（至 ${p.downUntil}）` : '未知';
        const detail = [stateText, p.fails ? `连续失败 ${p.fails}` : '', p.lastError ? `最近错误 ${p.lastError}` : ''].filter(Boolean).join('，');
        add(`proxy:pool#${p.index}`, true, `${p.proxy} ${detail}`);
      }
    }

    // 代理"协议层"探测：TCP 通 ≠ CONNECT 通（407 要账号密码、403 是代理禁目标、代理挂了是 ECONNREFUSED）。
    // 关键点：必须用**未脱敏**的代理地址探测——凭证在 URL 里，拿 "http://***@host" 去探只会得到 407。
    // BB 批（docs/PROXY-POOL.md §11.1）：CONNECT 探测逻辑抽到 proxy-pool.js，diagnose 与定时任务共用同一实现。
    const { probeProxyConnect } = await import('../proxy-pool.js');

    // socks5:// 之类会被 parseProxy 静默丢掉、回落直连——最难查的一类配置错误，单独报出来（AM-1：兼容多条）
    const rawSteamProxy = String(process.env.STEAM_PROXY ?? process.env.steam_proxy ?? '').trim();
    if (rawSteamProxy) {
      const { parseProxyList } = await import('../proxy.js');
      const parsed = parseProxyList(rawSteamProxy);
      const lineCount = rawSteamProxy.split(/[\r\n,]+/).filter(Boolean).length;
      if (!parsed.length) {
        add('proxy:format', false, 'STEAM_PROXY 不是合法的 http/https 地址（只支持 http:// 或 https://，socks5 不支持）');
      } else if (parsed.length < lineCount) {
        add('proxy:format', false, `STEAM_PROXY 共 ${lineCount} 行，只有 ${parsed.length} 行是合法的 http/https 代理（其余被忽略）`);
      }
    }

    // store 与 api 的放行规则经常不一样，而「导入目录」走的正是 api.steampowered.com
    const steamRoute = decideProxy('api.steampowered.com', process.env);
    if (steamRoute.url) {
      const shown = redactProxy(steamRoute.url);
      for (const [name, target] of [
        ['proxy:connect', 'store.steampowered.com:443'],
        ['proxy:connect:api', 'api.steampowered.com:443'],
        ['proxy:connect:community', 'steamcommunity.com:443'],
      ]) {
        const r = await probeProxyConnect(steamRoute.url, target);
        add(name, r.ok, `${r.detail}${shown ? `；代理 ${shown}` : ''}`);
      }
    }

    if (dbTarget) {
      try {
        await withStore(async (store) => {
          const v = await db.serverVersion((sql, p) => store.query(sql, p));
          const alive = await ping(store);
          add('database', alive, `${v.version?.slice(0, 50)} tz=${v.timeZone}`);
          const t = await cliOpsRepo.listPublicTableNames((sql, p) => store.query(sql, p));
          const names = t.rows.map((r) => r.table_name);
          add('tables', names.includes('offers') && names.includes('price_snapshots'), names.join(',') || '(空)');
        });
      } catch (err) {
        add('database', false, String(err.message).slice(0, 200));
      }
    } else {
      add('database', false, '没有 DATABASE_URL，也没有 --db');
    }

    const net = async (name, url, opts = {}) => {
      try {
        const res = await fetchText(url, { logger, label: `diagnose.${name}`, retries: 0, timeoutMs: 12000, ...opts });
        add(`net:${name}`, true, `HTTP ${res.status} ${(res.bytes / 1024).toFixed(0)}KB ${res.elapsedMs}ms`);
      } catch (err) {
        // 把响应体片段带上：403 的 body 常常直接写着原因（如 "Invalid or expired api key"）
        const snippet = err.body ? ` body=${String(err.body).slice(0, 120)}` : '';
        add(`net:${name}`, false, `${String(err.message).slice(0, 140)}${snippet}`);
      }
    };
    await net('steam', 'https://store.steampowered.com/api/appdetails?appids=730&cc=cn');
    await net('sonkwo', 'https://www.sonkwo.hk/sku/111454');
    await net('itad', `https://api.isthereanydeal.com/games/search/v1?title=elden&key=${process.env.ITAD_API_KEY ?? 'none'}`);
    await net('fanatical', 'https://www.fanatical.com/');
    // 封面图链路：与 /img/steam 的三条兜底路径一一对应，图片 404 时看这三行
    const imgPath = '/steam/apps/413150/capsule_sm_120.jpg';
    await net('img:cf-proxy', 'https://cdn.cloudflare.steamstatic.com' + imgPath);
    await net('img:ak-direct', 'https://cdn.akamai.steamstatic.com' + imgPath);
    await net('img:cf-direct', 'https://cdn.cloudflare.steamstatic.com' + imgPath, { forceDirect: true });

    // Steam Web API Key 校验：store/api/appdetails 是免 key 的，key 只用于个人资料/游戏库/目录，
    // 所以同步成功不代表 key 有效——这里用 GetPlayerSummaries 单独验一次。
    const apiKey = String(process.env.STEAM_API_KEY ?? '').trim();
    if (!apiKey) {
      add('steam.api_key', false, '未配置 STEAM_API_KEY（Steam 登录/游戏库同步不可用，采集不受影响）');
    } else {
      try {
        const res = await fetchJson(
          `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(apiKey)}&steamids=76561198000000000`,
          { logger, label: 'diagnose.api_key', retries: 0, timeoutMs: 12000 },
        );
        const players = res.json?.response?.players;
        const text = JSON.stringify(res.json ?? {}).slice(0, 120);
        if (Array.isArray(players)) add('steam.api_key', true, `可用（HTTP ${res.status}，玩家查询正常返回）`);
        else add('steam.api_key', false, `返回结构异常：${text}`);
      } catch (err) {
        const body = err.body ? ` body=${String(err.body).slice(0, 120)}` : '';
        add('steam.api_key', false, `${String(err.message).slice(0, 120)}${body}（403 通常就是 key 无效）`);
      }
    }

    const failed = checks.filter((c) => !c.ok);
    console.log('\n检查项：');
    for (const c of checks) console.log(`  ${c.ok ? '✔' : '✘'} ${pad(c.name, 16)} ${c.detail}`);
    const file = `logs/diagnose-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    writeFileSync(file, JSON.stringify({ runId, checks }, null, 2), 'utf8');
    logger.info('diagnose.done', { failed: failed.length, total: checks.length, file });
    console.log(`\n${failed.length ? `${failed.length} 项异常` : '全部通过'}，报告已写入 ${file}`);
  }

  /**
   * 代理专项排查：TCP → CONNECT（带/不带认证）→ 真正经代理访问 Steam。
   * 三层的失败原因完全不同（防火墙 / 白名单 / 认证 / 协议不对），必须分开看。
   */
  async function cmdProxyCheck() {
    const net = await import('node:net');
    const { describeProxy: describeProxyDyn, parseProxy, parseProxyList, redactProxy: redactProxyDyn } = await import('../proxy.js');
    const info = describeProxyDyn(process.env);
    // AM-1：Steam 专用代理可能配多条，本命令只逐层探测第一条（池内切换由 http.js 负责）
    const steamUrl = parseProxyList(process.env.STEAM_PROXY ?? process.env.steam_proxy ?? '')[0] ?? null;
    console.log('配置：Steam 专用代理 = ' + (steamUrl ? redactProxyDyn(steamUrl) : '（未配置）'));
    console.log('      通用出网代理 = ' + (info.others.via === 'direct' ? '（未配置）' : info.others.proxy));
    if (!steamUrl) {
      console.log('\n没有配置 Steam 专用代理：Steam 目前直连（国内通常不可达 api.steampowered.com）。');
      return;
    }

    const u = new URL(steamUrl);
    console.log('      凭证 = ' + (u.username ? '已配置（用户名 ' + decodeURIComponent(u.username) + '）' : '未配置 —— 若代理要求认证就会 407'));
    const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
    const host = u.hostname;

    // 1) TCP：主机端口通不通
    const tcp = await new Promise((resolve) => {
      const s = net.connect({ host, port, timeout: 6000 });
      s.once('connect', () => { s.destroy(); resolve({ ok: true }); });
      s.once('timeout', () => { s.destroy(); resolve({ ok: false, error: 'timeout' }); });
      s.once('error', (e) => resolve({ ok: false, error: e.code || e.message }));
    });
    console.log('\n1) TCP ' + host + ':' + port + ' → ' + (tcp.ok ? '✔ 通' : '✘ ' + tcp.error));
    if (!tcp.ok) {
      console.log('   → 端口不通：防火墙/安全组拦了出站，或代理端口不是 ' + port + '。');
      return;
    }

    // 2) HTTP CONNECT：能不能建隧道（这里才看得出 407/403）
    const connectTest = (withAuth) =>
      new Promise((resolve) => {
        const headers = { host: 'store.steampowered.com:443' };
        if (withAuth) {
          const cred = decodeURIComponent(u.username) + ':' + decodeURIComponent(u.password);
          headers['proxy-authorization'] = 'Basic ' + Buffer.from(cred).toString('base64');
        }
        const req = httpRequest(
          { host, port, method: 'CONNECT', path: 'store.steampowered.com:443', headers, timeout: 8000 },
          (res) => { res.resume(); resolve({ error: '代理把 CONNECT 当普通请求处理了，返回 HTTP ' + res.statusCode }); },
        );
        let settled = false;
        req.on('connect', (res, sock) => { settled = true; sock.destroy(); resolve({ status: res.statusCode }); });
        req.on('timeout', () => { req.destroy(); if (!settled) resolve({ error: 'timeout（8s 无响应）' }); });
        req.on('error', (e) => { if (!settled) resolve({ error: e.code || e.message }); });
        req.end();
      });
    const plain = await connectTest(false);
    const explain = (r) => {
      if (r.status === 200) return '✔ 200（隧道已建立）';
      if (r.status === 407) return '✘ 407 需要账号密码 → 填 http://账号:密码@' + host + ':' + port;
      if (r.status === 403) return '✘ 403 代理拒绝该目标（可能是 IP 白名单/目标限制）';
      if (r.status) return '✘ HTTP ' + r.status;
      return '✘ ' + r.error;
    };
    console.log('2) CONNECT store.steampowered.com:443 → ' + explain(plain));
    if (u.username) console.log('   CONNECT（带认证）→ ' + explain(await connectTest(true)));

    // 3) 真正经代理拿一次 Steam 数据（含 TLS 与证书校验）
    try {
      const res = await fetchText('https://store.steampowered.com/api/appdetails?appids=413150&cc=cn&l=schinese', {
        label: 'proxy-check',
        logger,
        retries: 0,
        timeoutMs: 15000,
      });
      console.log('3) 经代理访问 Steam → ✔ HTTP ' + res.status + '，' + res.bytes + ' 字节');
    } catch (err) {
      const cause = err.cause ? String(err.cause.message ?? err.cause) : '';
      console.log('3) 经代理访问 Steam → ✘ ' + err.message + (cause ? '（cause: ' + cause + '）' : ''));
    }

    console.log('\n结论对照：');
    console.log('  407 → 设置里补账号密码；403/隧道被关 → 把本机公网 IP 加进代理白名单');
    console.log('  立即断开/乱码 → 这个端口多半是 SOCKS5，不是 HTTP 代理');
    console.log('  certificate/ssl → 代理地址写了 https:// 而实际是 http 代理，改成 http://');
  }

  /**
   * 批量回填：用 IStoreBrowseService/GetItems（一次最多 100 个 appid）把全量目录的
   * 元数据 + 国区价格补齐。失败/缺 key 时回退到单条 appdetails。
   * FP 批 P2（docs/SYNC-HARDENING.md §2）：initMode=true 时为「初始化全量同步」参数口径
   * （默认 20 万上限/单条回退 10）；429 收轮时本批 appid 入 sync_429_queue，下一轮优先补。
   */
  async function cmdBackfill(initMode = false) {
    const batch = Math.max(1, Math.min(Number(flag('batch', initMode ? '100' : '50')) || (initMode ? 100 : 50), 100));
    const sleepMs = Math.max(0, Number(flag('sleep', initMode ? '3000' : '1500')) || 0);
    const limit = Math.max(1, Math.min(Number(flag('limit', initMode ? '200000' : '20000')) || (initMode ? 200000 : 20000), 200000));
    // 单条回退上限：大跑时设 0 可完全关掉，把"缺的少量游戏"留给小任务慢慢补
    const fallbackMax = Math.max(0, Math.min(Number(flag('fallback', '10')) || 0, 100));
    const { fetchStoreItems } = await import('../adapters/store-browse.js');
    const key = String(process.env.STEAM_API_KEY ?? '').trim();
    const startedMs = Date.now();
    const startedIso = new Date(startedMs).toISOString();
    let done = 0;
    let stored = 0;
    let priced = 0;
    let fallback = 0;
    let failed = 0;
    let batches = 0;
    // BL-2（docs/BACKFILL-THROUGHPUT.md §3.2/§3.4）：进度文件与 429 观测
    let partial = false;
    let count429 = 0;
    let last429At = readSteam429Info()?.at ?? null;
    // v2.28.4 回归修复：countBackfillCandidates 期望 q 函数，这里显式传 store.query
    // （旧代码传整个 store 对象 → TypeError: q is not a function，backfill 每次调度都失败）。
    const candidateTotal = await withStore((s) => db.countBackfillCandidates(s.query));
    const writeProgress = (result) =>
      writeBackfillProgress({
        startedAt: startedIso,
        result,
        done,
        limit,
        batches,
        stored,
        priced,
        failed,
        candidateTotal,
        ratePerMin: Math.round((done / Math.max(1, Date.now() - startedMs)) * 60000),
        count429,
        last429At,
      });

    // 限流/风控/方法错误时立刻中止：继续跑只会把代理 IP 打进黑名单
    const abort = (message, extra = {}) => {
      writeProgress('failed');
      logger.error('backfill.aborted', { message, ...extra });
      throw new Error(message);
    };
    // BL-2：403/429 软退出——本轮收尾、保留进度，1 小时内由调度器重排（exit 75 = partial）
    const softExit = (status) => {
      partial = true;
      count429 += 1;
      last429At = new Date().toISOString();
      writeProgress('partial');
      logger.warn('backfill.partial', { reason: `http_${status}`, done, stored, priced, failed, batches, count429 });
      console.log(`本轮因 HTTP ${status} 提前收尾：已处理 ${done} 款，进度已保留，1 小时内自动重试`);
      process.exitCode = 75;
    };

    console.log(`批量回填：每批 ${batch} 个、间隔 ${sleepMs}ms、上限 ${limit} 款、单条回退 ${fallbackMax} 个/批${key ? '' : '（未配置 STEAM_API_KEY，将全部走单条接口）'}`);

    while (done < limit) {
      const size = Math.min(batch, limit - done);
      // BL-1（docs/BACKFILL-THROUGHPUT.md §3.1）：候选谓词统一走 db.backfillCandidateWhere——
      // 缺描述 / 无 Steam 报价 / 有价缺图，排除四态（free/coming_soon/region_locked/not_found），
      // 1 天冷却防同批重复选中；BL-3 的失败隔离（backfill_skip_until）已并入谓词。
      // ER：listBackfillCandidates 的签名是 q 查询函数（不是 store 对象）——传 store 会
      // TypeError: q is not a function，backfill 第一批就失败（与上面 countBackfillCandidates
      // 的 v2.28.4 修复同一根因，当轮只修了计数那一半）。
      const rows = await withStore((s) => db.listBackfillCandidates(s.query, { limit: size }));
      const appids = rows.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0);
      if (!appids.length) {
        console.log('没有需要回填的游戏了');
        break;
      }
      batches += 1;

      let items = [];
      let missed = [];
      if (key) {
        try {
          const r = await fetchStoreItems(appids, { key, logger, throwOnFatal: true });
          items = r.items;
          missed = r.failed;
        } catch (err) {
          if (err.status === 405) {
            abort('批量接口返回 405（POST 被拒）：当前镜像过旧，GetItems 需要 GET + input_json（0.25.2+），升级后再跑', { status: 405 });
          }
          if (err.status === 403 || err.status === 429) {
            // FP 批 P2（docs/SYNC-HARDENING.md §2）：429 收轮——本批 appid 入补跑队列（下一轮优先补）；403 是风控不入队
            if (err.status === 429) {
              await withStore((s) => db.record429Appids(s.query, appids)).catch(() => {});
            }
            softExit(err.status); // BL-2：不再整轮作废，收尾保留进度
          } else {
            logger.warn('backfill.batch_failed', { message: String(err.message).slice(0, 160) });
            missed = appids;
          }
        }
      } else {
        missed = appids;
      }
      if (partial) break;

      // 回退：批量接口没返回的，逐个走 appdetails（默认最多 10 个/批，避免拖慢）
      if (fallbackMax > 0) {
        for (const appid of missed.slice(0, fallbackMax)) {
          if (partial) break;
          try {
            // EF/EI 批（docs/STEAM-SYNC-STATUS-AND-RATING.md §9/§11）：回填的价格以本位币口径为准
            // （mergePriceOffers/applySteamDetails 会把 priceOverview 写进本位币 offer），
            // 这里保持 cc=baseRegion；成人描述符回填由 rating-backfill 命令负责（内容区）。
            const one = await fetchMetadata([appid], { backend: 'official', logger, cc: baseRegion() });
            if (one.items?.length) items.push(...one.items);
            fallback += 1;
          } catch (err) {
            if (err.status === 403 || err.status === 429) {
              // FP 批 P2：429 单条回退收轮——该 appid 入补跑队列
              if (err.status === 429) {
                await withStore((s) => db.record429Appids(s.query, [appid])).catch(() => {});
              }
              softExit(err.status);
              break;
            }
            failed += 1;
            logger.warn('backfill.item_failed', { appid, message: String(err.message).slice(0, 160) });
          }
          await sleep(400);
        }
      }
      if (partial) break;
      failed += Math.max(0, missed.length - fallbackMax);

      // GetItems 没带价格的（字段缺失/接口变化），用 appdetails 批量回退取价：
      // GetItems 只负责元数据，价格这条链路以 appdetails 的 price_overview 为准。
      // Steam 限 200 次/5 分钟：单批 50 个、间隔 2 秒（150 次/5 分钟），留出余量。
      const missing = missingPriceAppids(items);
      let fallbackOffers = [];
      if (missing.length) {
        try {
          const got = await syncPrices({ appids: missing, logger, region: baseRegion(), batchSize: 50, rateLimitMs: 2000 });
          fallbackOffers = got.offers;
          logger.info('backfill.price_fallback', {
            appids: missing.length,
            offers: fallbackOffers.length,
            skipped: got.skipped.length,
            requests: got.requests,
            regions: regionContext(),
          });
        } catch (err) {
          if (err.status === 403 || err.status === 429) {
            // FP 批 P2：429 价格回退收轮——缺价 appid 入补跑队列
            if (err.status === 429) {
              await withStore((s) => db.record429Appids(s.query, missing)).catch(() => {});
            }
            softExit(err.status);
          } else {
            logger.warn('backfill.price_fallback_failed', { appids: missing.length, message: String(err.message).slice(0, 160) });
          }
        }
      }
      if (partial) break; // 软退出：本批未处理的条目不计数、不写库（没有失败事实）

      const offersToWrite = mergePriceOffers(items, fallbackOffers);
      const batchPriced = offersToWrite.length;
      priced += batchPriced;

      // 写库：每批只开 1 个连接（之前是每款一个，100 连接/批，日志会被 db.connect 刷屏）
      if (items.length) {
        await withStore(async (store) => {
          const q = (sql, p) => store.query(sql, p);
          for (const item of items) {
            await db.upsertGameMeta(q, item);
            stored += 1;
            // V 批（docs/STEAM-SYNC-STATUS-AND-RATING.md §14.3）：appdetails 来源的条目
            // （normalizeOfficial，含分级字段）顺带落状态与分级；GetItems 条目没有分级字段，
            // entryFromMeta 判定不了时只写已有的、不推游标——steam-status 之后仍会选中它们。
            if (item.source === 'official') {
              await applySteamDetails(q, { appid: item.steamAppid, cnEntry: entryFromMeta(item), meta: item });
            }
          }
          if (offersToWrite.length) {
            await ingestOffers(store, { platform: { code: 'steam', name: 'Steam 国区', kind: 'official' }, offers: offersToWrite, logger });
          }
          // 无论有没有拿到报价都记一笔，避免这批（尤其是免费/锁区的）下一批又被选中
          await db.markBackfilled(q, appids);
          // FP 批 P2（docs/SYNC-HARDENING.md §2）：本批处理完从 429 补跑队列清除（成功补跑的收敛）
          await db.clear429Appids(q, appids).catch(() => {});
          // BL-3（docs/BACKFILL-THROUGHPUT.md §3.3）：失败隔离——
          // 拿到元数据 = 成功（清零并解除跳过）；本批没拿到元数据的记一次失败，连续 3 次跳过 30 天
          const successIds = [...new Set(items.map((it) => Number(it.steamAppid)).filter((n) => Number.isFinite(n) && n > 0))];
          const failedIds = appids.filter((a) => !successIds.includes(a));
          await db.clearBackfillFailures(q, successIds);
          if (failedIds.length) {
            const skipped = await db.recordBackfillFailures(q, failedIds);
            for (const s of skipped) logger.warn('backfill.item_skipped', { appid: s.appid, count: s.count });
          }
        });
      }

      done += appids.length;
      const rate = Math.round((done / Math.max(1, Date.now() - startedMs)) * 60000);
      console.log(`  批次 ${batches}：本批 ${appids.length} 款，写入 ${items.length}，回退 ${fallback}，失败 ${failed}；累计 ${done}/${limit}（${rate} 款/分钟）`);
      writeProgress('running');
      if (items.length && batchPriced === 0) {
        logger.warn('backfill.batch_no_price', {
          batch: batches,
          items: items.length,
          missing: missing.length,
          hint: 'GetItems 与 appdetails 回退都没拿到价格（免费/锁区，或 Steam 接口异常）',
        });
      }
      if (sleepMs) await sleep(sleepMs);
    }

    writeProgress('ok');
    logger.info('backfill.done', { done, stored, priced, fallback, failed, batches, elapsedMs: Date.now() - startedMs });
    console.log(`完成：处理 ${done} 款，元数据 ${stored} 条，价格 ${priced} 条，单条回退 ${fallback}，失败 ${failed}`);
    if (stored > 0 && priced === 0) {
      console.warn('⚠️ 一条价格都没拿到：GetItems 与 appdetails 回退都没返回价格（可能全部免费/锁区，或 Steam 接口异常）。');
      logger.warn('backfill.no_prices', { stored, hint: 'getitems+appdetails both empty' });
    }
  }

  /**
   * 重写名字（存量修复）：早期目录导入把英文名写进了 name、回填又只补空缺，
   * 导致十几万行名字停在英文。这个命令挑「name 为空或仍是机器英文名」的行，
   * 用 GetItems（schinese）重取：有官方简中的覆盖成中文（英文名挪进 name_en），
   * 没有简中的保持英文。选择条件自带收敛——修好的行不再被选中；backfill_at 一天
   * 冷却防止同一批行在本次运行内反复重选。
   */
  async function cmdRename() {
    const batch = Math.max(1, Math.min(Number(flag('batch', '100')) || 100, 100));
    const sleepMs = Math.max(0, Number(flag('sleep', '1500')) || 0);
    const limit = Math.max(1, Math.min(Number(flag('limit', '200000')) || 200000, 200000));
    // 单条回退上限：没有 STEAM_API_KEY 时逐 appid 走 appdetails；大跑时设 0 完全关掉
    const fallbackMax = Math.max(0, Math.min(Number(flag('fallback', '10')) || 0, 100));
    const { fetchStoreItems } = await import('../adapters/store-browse.js');
    const key = String(process.env.STEAM_API_KEY ?? '').trim();
    const startedMs = Date.now();
    let done = 0;
    let stored = 0;
    let renamed = 0;
    let fallback = 0;
    let failed = 0;
    let batches = 0;

    const abort = (message, extra = {}) => {
      logger.error('rename.aborted', { message, ...extra });
      throw new Error(message);
    };

    console.log(`重写名字：每批 ${batch} 个、间隔 ${sleepMs}ms、上限 ${limit} 款、单条回退 ${fallbackMax} 个/批${key ? '' : '（未配置 STEAM_API_KEY，将全部走单条接口）'}`);

    while (done < limit) {
      const size = Math.min(batch, limit - done);
      const rows = await withStore((store) =>
        cliOpsRepo.listRenameCandidates((sql, p) => store.query(sql, p), { size }),
      );
      const appids = rows.rows.map((r) => Number(r.steam_appid)).filter((n) => Number.isFinite(n) && n > 0);
      if (!appids.length) {
        console.log('没有需要重写名字的游戏了');
        break;
      }
      batches += 1;

      let items = [];
      let missed = [];
      if (key) {
        try {
          const r = await fetchStoreItems(appids, { key, logger, throwOnFatal: true });
          items = r.items;
          missed = r.failed;
        } catch (err) {
          if (err.code === 'COOLDOWN_ABORT') throw err; // FP：429 冷却超时中断——runSyncTracked 记 interrupted + exit 75
          if (err.status === 405) {
            abort('批量接口返回 405（POST 被拒）：当前镜像过旧，GetItems 需要 GET + input_json，升级后再跑', { status: 405 });
          }
          if (err.status === 403 || err.status === 429) {
            abort(`Steam 返回 HTTP ${err.status}（限流/风控），已立即中止避免 IP 被封；等 30-60 分钟后把 --sleep 调大再试`, { status: err.status });
          }
          logger.warn('rename.batch_failed', { message: String(err.message).slice(0, 160) });
          missed = appids;
        }
      } else {
        missed = appids;
      }

      if (fallbackMax > 0) {
        for (const appid of missed.slice(0, fallbackMax)) {
          try {
            // EF/EI 批（docs/STEAM-SYNC-STATUS-AND-RATING.md §9/§11）：重写名字只写元数据、不写价格，
            // 走默认内容区（sync.contentRegion，默认 us）——国区商店隐藏成人游戏，us 才能拿到成人游戏的中文名。
            const one = await fetchMetadata([appid], { backend: 'official', logger });
            if (one.items?.length) items.push(...one.items);
            fallback += 1;
          } catch (err) {
            if (err.code === 'COOLDOWN_ABORT') throw err; // FP：429 冷却超时中断——runSyncTracked 记 interrupted + exit 75
            if (err.status === 403 || err.status === 429) {
              abort(`单条回退遇到 HTTP ${err.status}（限流），已立即中止重写名字`, { status: err.status, appid });
            }
            failed += 1;
            logger.warn('rename.item_failed', { appid, message: String(err.message).slice(0, 160) });
          }
          await sleep(400);
        }
      }
      failed += Math.max(0, missed.length - fallbackMax);

      await withStore(async (store) => {
        const q = (sql, p) => store.query(sql, p);
        for (const item of items) {
          await db.upsertGameMeta(q, item);
          stored += 1;
          if (item.nameZh && /[\u4e00-\u9fa5]/.test(String(item.nameZh))) renamed += 1;
        }
        // 无论有没有拿到元数据都记一笔：没有简中的行一天内不再重复请求
        await db.markBackfilled(q, appids);
      });

      done += appids.length;
      const rate = Math.round((done / Math.max(1, Date.now() - startedMs)) * 60000);
      console.log(`  批次 ${batches}：本批 ${appids.length} 款，写入 ${items.length}，带回中文名 ${renamed}，回退 ${fallback}，失败 ${failed}；累计 ${done}/${limit}（${rate} 款/分钟）`);
      if (sleepMs) await sleep(sleepMs);
    }

    logger.info('rename.done', { done, stored, renamed, fallback, failed, batches, elapsedMs: Date.now() - startedMs });
    console.log(`完成：处理 ${done} 款，写入元数据 ${stored} 条（其中带回中文名 ${renamed} 款），单条回退 ${fallback}，失败 ${failed}`);
  }

  /**
   * EF 批（docs/STEAM-SYNC-STATUS-AND-RATING.md §9）：内容分级回填。
   * 根因：cc=cn 的 appdetails 国区商店隐藏成人内容 → content_descriptors 采不到 → 全库
   * adult_flag 仅约 20 个。本命令逐 appid 用内容区（EI 批 §11：sync.contentRegion，默认 us）
   * 重采 content_descriptors / required_age / age_ratings，只写分级、不写 steam_status、
   * 不写价格（本位币价格口径不受影响）。
   * 限速 ≥1s/请求；撞 429 立即收轮（exit 75，调度器 1 小时后重排）；高嫌疑优先；
   * backfill_at 1 天冷却 + required_age 已采到即收敛 → 可断点续跑。
   * 开工前 / 收工后各记一次 adult/mature 计数（验收①：steam.meta.backfill_before/done）。
   * 一轮逻辑在 src/steam-status.js 的 runRatingBackfillRound（可单测），本命令只负责参数与输出。
   */
  async function cmdRatingBackfill() {
    // FP 批 P2（docs/SYNC-HARDENING.md §2）：默认上限 5000 → 20000（env 可配）
    const limit = Math.max(1, Math.min(Number(flag('limit', '20000')) || 20000, 200000));
    const batch = Math.max(1, Math.min(Number(flag('batch', '30')) || 30, 100));
    // 硬约束 6：采集限速 ≥1 秒/请求；默认 1.5s（在 Steam 200 次/5 分钟配额内）
    const rateMs = Math.max(1000, Math.min(Number(flag('rate', '1500')) || 1500, 60000));

    const result = await withStore((store) =>
      runRatingBackfillRound((sql, p) => store.query(sql, p), { limit, batch, rateMs, logger }),
    );

    if (result.aborted429) {
      console.log(`撞 HTTP 429：本轮提前收尾（已处理 ${result.done} 款），1 小时后自动重试`);
      process.exitCode = 75;
    }
    console.log(`完成：处理 ${result.done} 款，写分级 ${result.wrote} 条（本轮新判 adult ${result.adultWrote} / mature ${result.matureWrote}），失败 ${result.failed}${result.aborted429 ? '（HTTP 429 提前收轮）' : ''}`);
    console.log(`adult 计数：${result.before.adult} → ${result.after.adult}（+${result.after.adult - result.before.adult}）；mature：${result.before.mature} → ${result.after.mature}（+${result.after.mature - result.before.mature}）`);
  }

  /**
   * FT 批（docs/EXPLICIT-RATING.md §2.2）：色情游戏（严格分级）存量回填。
   * 根因：现有 adult_flag 游戏（存量约 4759 个）没有存 descriptor 原始 ids → 无法本地判定
   * explicit（descriptor 4 或 ESRB AO）。本命令逐 appid 用内容区（sync.contentRegion，默认 us）
   * 重采 content_descriptors/age_ratings，只写分级（含 explicit_flag）、不写 steam_status、
   * 不写价格（本位币价格口径不受影响）。
   * 候选 = adult_flag=true 且 explicit_flag=false（1 天冷却：断点续跑；explicit=true 退出收敛）；
   * 限速 ≥1s/请求；撞 429 立即收轮（exit 75）；开工前 / 收工后各记一次 adult/explicit 计数
   * （验收：steam.meta.explicit_backfill_before/done）。
   * 一轮逻辑在 src/steam-status.js 的 runExplicitBackfillRound（可单测），本命令只负责参数与输出。
   */
  async function cmdExplicitBackfill() {
    const limit = Math.max(1, Math.min(Number(flag('limit', '5000')) || 5000, 200000));
    const batch = Math.max(1, Math.min(Number(flag('batch', '30')) || 30, 100));
    // 硬约束 6：采集限速 ≥1 秒/请求；默认 1.5s（在 Steam 200 次/5 分钟配额内）
    const rateMs = Math.max(1000, Math.min(Number(flag('rate', '1500')) || 1500, 60000));

    const result = await withStore((store) =>
      runExplicitBackfillRound((sql, p) => store.query(sql, p), { limit, batch, rateMs, logger }),
    );

    if (result.aborted429) {
      console.log(`撞 HTTP 429：本轮提前收尾（已处理 ${result.done} 款），可稍后重跑续作`);
      process.exitCode = 75;
    }
    console.log(`完成：处理 ${result.done} 款，写分级 ${result.wrote} 条（本轮新判 explicit ${result.explicitWrote}），失败 ${result.failed}${result.aborted429 ? '（HTTP 429 提前收轮）' : ''}`);
    console.log(`adult 计数：${result.before.adult} → ${result.after.adult}；explicit：${result.before.explicit} → ${result.after.explicit}（+${result.after.explicit - result.before.explicit}）`);
  }

  /**
   * DS 批（docs/SEARCH-ALIASES.md §3）：派生搜索 token 重建。
   * 默认增量（search_tokens 为空/从未生成/名字在生成后被改过的行），--full 全量按 id 游标翻页；
   * 纯本地计算、无 Steam 请求；token 未变化的行不写（is distinct from）。调度器每 6 小时一轮。
   */
  async function cmdSearchTokens() {
    const full = Boolean(flag('full'));
    const limit = Math.max(1, Math.min(Number(flag('limit', '50000')) || 50000, 1000000));
    const r = await withStore(async (store) =>
      db.rebuildSearchTokens((sql, p) => store.query(sql, p), { full, limit }),
    );
    const mode = full ? '全量' : '增量';
    logger.info('search.tokens_rebuilt', { full, processed: r.processed, written: r.written });
    console.log(`搜索 token 重建（${mode}）完成：处理 ${r.processed} 行，写入 ${r.written} 行（token 未变化的跳过）`);
    syncNote.note = `搜索 token 重建（${mode}）：处理 ${r.processed}，写入 ${r.written}`;
  }

  // 定期清理：访问记录/采集与任务记录/验证码/Steam 账号日志（默认由调度器每周跑一次）
  async function cmdPrune() {
    const visitorDays = Math.max(1, Number(flag('visitor-days', '180')) || 180);
    const runDays = Math.max(1, Number(flag('run-days', '90')) || 90);
    const emailDays = Math.max(1, Number(flag('email-days', '7')) || 7);
    const steamDays = Math.max(1, Number(flag('steam-days', '180')) || 180);
    // BJ 批 H1：自动封禁记录保留 90 天，并入现有 prune（不新建定时任务）
    const abuseDays = Math.max(1, Number(flag('abuse-days', '90')) || 90);
    // BK 批（docs/SESSION-MANAGEMENT.md §3.5）：会话清理并入 prune；空闲超时兜底（0=只清绝对过期行）
    const sessionIdleDays = Math.max(0, Number(flag('session-idle-days', process.env.AUTH_SESSION_IDLE_DAYS ?? '7')) || 0);
    const result = await withStore(async (store) => {
      // ER：purgeOldRows 要删 email_codes（email-auth.js 建）与 steam_account_logs（steam-login.js 建），
      // 这两张表不在 migrate() 里。裸库（只跑过 migrate、从没起过 Web）直接 delete 会报 42P01；
      // 与 serve/all 启动口径一致，清理前先幂等补建，再删。
      await (await import('../email-auth.js')).ensureEmailSchema(store); // 邮箱验证码相关表
      await (await import('../steam-login.js')).ensureSteamSchema(store); // Steam 登录与账号日志表
      return db.purgeOldRows((sql, p) => store.query(sql, p), { visitorDays, runDays, emailDays, steamDays, abuseDays, sessionIdleDays });
    });
    console.log(
      `清理完成：访问记录 ${result.visitorLogs} 条、采集记录 ${result.fetchRuns} 条、任务记录 ${result.syncRuns} 条、验证码 ${result.emailCodes} 条、Steam 账号日志 ${result.steamAccountLogs} 条、自动封禁记录 ${result.ipAbuse} 条、登录会话 ${result.sessions} 条` +
        `（保留：访问 ${visitorDays} 天 / 采集与任务 ${runDays} 天 / 验证码 ${emailDays} 天 / Steam 日志 ${steamDays} 天 / 自动封禁 ${abuseDays} 天 / 会话空闲 ${sessionIdleDays} 天）`,
    );
    logger.info('maintenance.cleanup', { ...result, visitorDays, runDays, emailDays, steamDays, abuseDays, sessionIdleDays });
  }

  // 首页列表读模型对账/重建（docs/READ-MODEL.md §7，AV 批）
  async function cmdReadModel() {
    const sub = args[1];
    if (sub === 'check') {
      const sample = Math.min(Math.max(Number(flag('sample', '200')) || 200, 1), 2000);
      const fix = flag('fix') != null;
      const result = await withStore((store) =>
        db.readModelCheck((sql, p) => store.query(sql, p), { sample, fix }),
      );
      console.log(
        `对账完成：比对 ${result.checked} 个 (game,region)（其中底层比快照新的疑似陈旧行 ${result.suspect} 个），` +
          `差异 ${result.diffs.length}${fix ? `（已就地修复 ${result.fixed} 行）` : '（可用 --fix 就地修复）'}`,
      );
      for (const d of result.diffs.slice(0, 20)) {
        console.log(`  差异：game ${d.gameId} / ${d.region} / ${d.field} → 快照 ${JSON.stringify(d.snapshot)} ≠ 实际 ${JSON.stringify(d.actual)}`);
      }
      // B5 批：fixed 只计「出现差异的行」，修复走 refresh* 唯一写入路径（不是自拼 SQL）
      logger.info('readmodel.check', { checked: result.checked, suspect: result.suspect, diffs: result.diffs.length, fixed: result.fixed, fix });
      if (result.diffs.length && !fix) process.exitCode = 1; // 对账不通过非零退出（调度器可观测）
      return;
    }
    if (sub === 'rebuild') {
      const region = flag('region') ?? null;
      const result = await withStore((store) =>
        db.readModelRebuild((sql, p) => store.query(sql, p), { region }),
      );
      logger.info('readmodel.rebuild', { region, deleted: result.deleted });
      console.log(`重建完成：删除 ${result.deleted} 行（${region ?? '全部区服'}），已重新回填。`);
      return;
    }
    throw new Error('用法: node src/cli.js readmodel check [--sample 200] [--fix] | readmodel rebuild [--region cn]');
  }

  // 热度回填：appdetails 的 recommendations（评测数）+ release_date，给 games 落 heat。
  // 与价格回填共用 Steam 配额，靠后台任务槽位互斥（同一时刻只允许一个 Steam 重任务）。
  async function cmdHeat() {
    const batch = Math.max(1, Math.min(Number(flag('batch', '30')) || 30, 100));
    const sleepMs = Math.max(0, Number(flag('sleep', '1700')) || 0);
    const limit = Math.max(1, Math.min(Number(flag('limit', '200000')) || 200000, 200000));
    const startedMs = Date.now();
    let done = 0, withHeat = 0, marked = 0, failed = 0, batches = 0, invalidLogged = 0;

    // 热度公式：对数化累计评测数 + 新作加权（1 年衰减到一半）
    const heatScore = (totalReviews, releaseDate) => {
      const reviews = Number(totalReviews) || 0;
      let recency = 0;
      if (releaseDate) {
        const days = Math.max(0, (Date.now() - releaseDate.getTime()) / 86400000);
        recency = 1 / (1 + days / 365);
      }
      return Math.log10(1 + reviews) * 0.7 + recency * 0.3;
    };

    // Steam 本地化日期："2020 年 12 月 9 日" / "9 Dec, 2020" / 兜底只取年份
    const parseRelease = (raw) => {
      const s = String(raw ?? '').trim();
      if (!s) return null;
      const zh = s.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})/);
      if (zh) return new Date(Date.UTC(Number(zh[1]), Number(zh[2]) - 1, Number(zh[3])));
      const en = s.match(/(\d{1,2})\s*([A-Za-z]{3,9})[a-z]*\.?,?\s*(\d{4})/);
      if (en) {
        const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
        const m = months[en[2].slice(0, 3).toLowerCase()];
        if (m !== undefined) return new Date(Date.UTC(Number(en[3]), m, Number(en[1])));
      }
      const y = s.match(/(\d{4})/);
      if (y) return new Date(Date.UTC(Number(y[1]), 0, 1));
      return null;
    };

    console.log(`热度回填：逐 appid 请求（间隔 ${sleepMs}ms、上限 ${limit} 款，按 heat_at 为 null / 过期 7 天续跑）`);
    while (done < limit) {
      const size = Math.min(Math.max(1, batch), limit - done);
      const rows = await withStore((store) =>
        cliOpsRepo.listHeatCandidates((sql, p) => store.query(sql, p), { size }),
      );
      const appids = rows.rows.map((r) => Number(r.steam_appid)).filter((n) => Number.isFinite(n) && n > 0);
      if (!appids.length) {
        console.log('没有需要回填热度的游戏了');
        break;
      }
      batches += 1;
      let batchOk = 0;
      let batchSkipped = 0;
      for (const appid of appids) {
        // Steam appdetails 的批量规则（实测）：appids 多于 1 个时只接受 filters=price_overview，
        // 无 filters / recommendations 都返回 400；所以热度必须逐 appid 请求（69 字节/次）。
        try {
          const data = await fetchJson(
            `https://store.steampowered.com/api/appdetails?appids=${appid}&filters=recommendations,release_date&cc=cn&l=schinese`,
            { logger, label: 'steam.heat', timeoutMs: 30000, retries: 1 },
          );
          // AB 批起 fetchJson 返回 { ...res, json }：必须取 .json 再按 appid 解包（2026-11-09 线上定位：旧写法取不到 → 全量无效跳过）
          const entry = data?.json?.[String(appid)];
          const ok = Boolean(entry && entry.success === true && entry.data);
          await withStore(async (store) => {
            const q = (sql, p) => store.query(sql, p);
            if (!ok) {
              // 下架/无效 appid：只记 heat_at，避免每次都被选中；前 5 条打原始形状，便于排查接口变化
              if (invalidLogged < 5) {
                invalidLogged += 1;
                logger.warn('heat.entry_invalid', { appid, shape: JSON.stringify(entry ?? data ?? null).slice(0, 200) });
              }
              await db.setGameHeat(q, { steamAppid: appid });
              return;
            }
            const total = Number(entry.data.recommendations?.total ?? 0);
            const rel = parseRelease(entry.data.release_date?.date);
            const heat = heatScore(total, rel);
            await db.setGameHeat(q, {
              steamAppid: appid,
              heat,
              heatReviews: total,
              releaseDate: rel ? formatDayUtc(rel) : null,
            });
          });
          if (ok) {
            withHeat += 1;
            batchOk += 1;
          } else {
            marked += 1;
          }
        } catch (err) {
          failed += 1;
          // FP 批 P0：429 冷却超时中断（COOLDOWN_ABORT）原样重抛——runSyncTracked 记 interrupted + exit 75
          if (err.code === 'COOLDOWN_ABORT') throw err;
          // FW-3（docs/SLOW-SYNC.md §1.3 决策 14、§3.2/§3.4）：Steam 业务 403 = 本轮软收尾——
          // 当前 appid **不写 heat_at**（退避后仍被选中，进度只进不退），抛带 code 的错误；
          // runSyncTracked 记 interrupted + exit 76（调度器不熔断、不重排，下一轮按正常间隔继续）。
          // 排除 proxyStatus：代理层 CONNECT 403 属「代理坏了」，交给 FW-2 的代理切换/全池失败路径。
          if (err.code === 'FORBIDDEN_COOLDOWN' || (err.status === 403 && err.proxyStatus == null)) {
            const info = readSteam403Info();
            logger.warn('sync.forbidden_round_end', {
              job: 'heat',
              appid,
              count: info?.count ?? null,
              backoffMs: info ? Math.max(0, info.until - Date.now()) : null,
              message: 'Steam 403：热度回填本轮软收尾（当前 appid 不写 heat_at，冷却后下一轮优先补）',
            });
            const forbidden = new Error(
              `Steam 返回 HTTP 403（appid ${appid}），热度回填本轮软收尾（进度已保留，冷却后下一轮继续）`,
            );
            forbidden.code = 'FORBIDDEN_ROUND_END';
            forbidden.status = 403;
            throw forbidden;
          }
          if (err.status && err.status >= 400 && err.status < 500) {
            // 4xx：请求本身被拒（限流/风控/参数非法），继续重试没有意义，立刻中止避免烧配额
            logger.error('heat.aborted', {
              appid,
              status: err.status,
              hint: err.status === 429 ? '限流，冷却后重跑可续' : '参数/风控问题，需要排查',
            });
            throw new Error(`Steam 返回 HTTP ${err.status}（appid ${appid}），已中止热度回填（避免原地重试烧配额）`);
          }
          // 网络类错误：记 heat_at 跳过（下轮再试），游标继续前进，不做原地打转
          await withStore(async (store) => {
            await db.markHeatSkipped((sql, p) => store.query(sql, p), [appid]);
          });
          batchSkipped += 1;
        }
        done += 1;
        if (sleepMs) await sleep(sleepMs);
      }
      const rate = Math.round((done / Math.max(1, Date.now() - startedMs)) * 60000);
      console.log(`  批次 ${batches}：本批 ${appids.length} 款，写入热度 ${batchOk}，网络跳过 ${batchSkipped}；累计 ${done}/${limit}（${rate} 款/分钟）`);
    }
    logger.info('heat.done', { done, withHeat, marked, failed, batches, elapsedMs: Date.now() - startedMs });
    console.log(`完成：处理 ${done} 款，写入热度 ${withHeat} 条，无效跳过 ${marked - withHeat}，失败 ${failed}`);
    if (withHeat === 0 && failed > 0) {
      // 全程没拿到任何数据：任务槽位应标记失败，而不是静默"成功"
      throw new Error(`热度回填全程失败（${failed} 个请求未拿到数据）：检查代理/限流后重跑`);
    }
  }

  /** BB 批（docs/PROXY-POOL.md §11.4）：代理健康主动探测——调度器 `probe --proxy` 与人工排查共用。 */
  async function cmdProbe() {
    if (args[1] !== '--proxy') throw new Error('用法: node src/cli.js probe --proxy');
    const proxyPool = await import('../proxy-pool.js');
    const r = await proxyPool.probeAllProxies(process.env, { logger });
    console.log(`代理探测完成：${r.probed} 条，可用 ${r.ok}，失败 ${r.failed}，耗时 ${r.elapsedMs ?? 0} ms`);
    for (const p of r.proxies || []) {
      console.log(`  #${p.index} ${p.proxy} → ${p.probeOk ? '可用' : '不可用'}${p.probeError ? '（' + p.probeError + '）' : ''}`);
    }
    // 全部不可用 = 真故障，让调度任务标红（部分失败只记录，不算失败）
    if (r.probed > 0 && r.ok === 0) throw new Error(`代理全部不可用（${r.failed} 条）`);
  }

  /**
   * 封面图本地缓存：批量下载到 data/images（宿主机挂载卷），下载一次后由本机直接提供，
   * 之后不再依赖 Steam CDN / 香港代理（VPS 只用于采集数据）。
   */
  async function cmdImages() {
    const sub = String(args[1] ?? 'pull');
    const images = await import('../images.js');
    if (sub === 'stats') {
      const s = images.imageStats();
      console.log(`图片缓存：${s.images} 张 / ${s.games} 款游戏 / ${(s.bytes / 1024 / 1024).toFixed(1)} MB`);
      console.log(`目录：${s.root}`);
      return;
    }
    if (sub === 'prune') {
      // D2（docs/ROADMAP.md）：按总量上限清理最旧文件；默认读设置 images.maxBytes（水合后的 env）
      const maxBytes = Math.max(0, Number(flag('max-bytes', process.env.IMAGES_MAX_BYTES ?? '0')) || 0);
      if (maxBytes <= 0) throw new Error('用法: node src/cli.js images prune --max-bytes <字节>（或先配置系统设置 images.maxBytes）');
      const before = images.imageStats();
      const r = images.pruneImages({ maxBytes });
      logger.info('images.pruned', { maxBytes, removed: r.removed, freedBytes: r.freedBytes, remainingBytes: r.remainingBytes });
      console.log(
        `清理完成：删除 ${r.removed} 张（释放 ${(r.freedBytes / 1024 / 1024).toFixed(1)} MB）；` +
          `缓存 ${(before.bytes / 1024 / 1024).toFixed(1)} → ${(r.remainingBytes / 1024 / 1024).toFixed(1)} MB（上限 ${(maxBytes / 1024 / 1024).toFixed(1)} MB）`,
      );
      return;
    }
    if (sub === 'backfill') {
      // EC 批（docs/IMAGE-COVERAGE.md §8 EC-2）：缺图回填——header_image 为空的游戏逐 appid
      // 重同步元数据补封面；限速 ≥1s/请求防 429（单款失败不中断整轮）。
      const limit = Math.min(Math.max(Number(flag('limit', '100')) || 100, 1), 500);
      const sleepMs = Math.max(Number(flag('sleep', '1200')) || 1000, 1000);
      const steamMeta = await import('../adapters/steam-meta.js');
      const { backfillMissingHeaders } = await import('../image-backfill.js');
      const r = await withStore((store) =>
        backfillMissingHeaders((sql, p) => store.query(sql, p), {
          fetchMeta: (appids) => steamMeta.fetchMetadata(appids, { logger }),
          limit,
          sleepMs,
          logger,
        }),
      );
      console.log(`缺图回填完成：扫描 ${r.scanned} 款，补 header_image ${r.filled} 款，失败 ${r.failed} 款，跳过 ${r.skipped} 款`);
      return;
    }
    if (sub !== 'pull') {
      throw new Error('用法: node src/cli.js images pull [--limit 200] [--sleep 300] [--sizes capsule_sm_120,header] | images backfill [--limit 100] [--sleep 1200] | images stats | images prune --max-bytes <字节>');
    }
    const limit = Math.min(Math.max(Number(flag('limit', '200')) || 200, 1), 5000);
    const sleepMs = Math.max(0, Number(flag('sleep', '300')) || 0);
    const sizes = String(flag('sizes', 'capsule_sm_120,header'))
      .split(',')
      .map((s) => s.trim())
      .filter((s) => images.isImageSize(s));
    if (!sizes.length) throw new Error('--sizes 不合法，可选：' + images.IMG_SIZES.join(' / '));

    // 只补「有价格数据」的游戏：列表/详情才用得到图，全量目录不下载
    const rows = await withStore((store) =>
      cliOpsRepo.listImagePullCandidates((sql, p) => store.query(sql, p), { limit: limit * 4 }),
    );
    const appids = [];
    for (const row of rows.rows) {
      const appid = Number(row.steam_appid);
      if (!Number.isFinite(appid) || appid <= 0) continue;
      if (sizes.every((size) => images.hasImage(appid, size))) continue; // 已缓存齐全
      appids.push(appid);
      if (appids.length >= limit) break;
    }
    if (!appids.length) {
      const s = images.imageStats();
      console.log(`都有图了：${s.images} 张 / ${s.games} 款游戏 / ${(s.bytes / 1024 / 1024).toFixed(1)} MB`);
      return;
    }

    console.log(`准备补图：${appids.length} 款 × ${sizes.length} 张（${sizes.join(' + ')}），每张间隔 ${sleepMs}ms`);
    const stats = { downloaded: 0, skipped: 0, failed: 0, notFound: 0 };
    for (const appid of appids) {
      for (const size of sizes) {
        if (images.hasImage(appid, size)) {
          stats.skipped += 1;
          continue;
        }
        const r = await images.downloadImage(appid, size, { fetchBuffer, logger, timeoutMs: 12000 });
        if (r.ok) {
          stats.downloaded += 1;
          if (stats.downloaded % 20 === 0) console.log(`  已下载 ${stats.downloaded} 张…（最近 ${appid}/${size}）`);
        } else if (r.notFound) {
          // AW 批（docs/IMAGE-FETCH.md §3.6）：404 快失败单计 notFound，不混进失败告警
          stats.notFound += 1;
        } else {
          stats.failed += 1;
          logger.warn('images.failed', { appid, size, message: String(r.error?.message ?? '').slice(0, 160) });
        }
        if (sleepMs) await sleep(sleepMs);
      }
    }
    const local = images.imageStats();
    logger.info('images.pull.done', { ...stats, images: local.images, games: local.games, bytes: local.bytes });
    console.log(`完成：新下载 ${stats.downloaded} 张，跳过 ${stats.skipped} 张，404 缺图 ${stats.notFound} 张，失败 ${stats.failed} 张`);
    console.log(`缓存合计：${local.images} 张 / ${local.games} 款游戏 / ${(local.bytes / 1024 / 1024).toFixed(1)} MB → ${local.root}`);
    // D2：补图后若设置了总量上限，自动按最旧清理
    const maxBytes = Math.max(0, Number(process.env.IMAGES_MAX_BYTES ?? '0') || 0);
    if (maxBytes > 0) {
      const r = images.pruneImages({ maxBytes });
      if (r.removed > 0) {
        logger.info('images.pruned', { maxBytes, removed: r.removed, freedBytes: r.freedBytes, remainingBytes: r.remainingBytes });
        console.log(`已按上限清理 ${r.removed} 张（释放 ${(r.freedBytes / 1024 / 1024).toFixed(1)} MB）`);
      }
    }
  }

  return {
    commands: {
      backfill: cmdBackfill,
      'init-sync': () => cmdBackfill(true), // FP 批 P2：初始化全量同步（回填全量口径，sync_runs mode=init-sync）
      rename: cmdRename,
      heat: cmdHeat,
      'rating-backfill': cmdRatingBackfill,
      'explicit-backfill': cmdExplicitBackfill,
      'search-tokens': cmdSearchTokens,
      images: cmdImages,
      prune: cmdPrune,
      logs: cmdLogs,
      backup: cmdBackup,
      diagnose: cmdDiagnose,
      'proxy-check': cmdProxyCheck,
      probe: cmdProbe,
      readmodel: cmdReadModel,
      serve: cmdServe,
      all: cmdAll,
    },
    trackedCommands: {
      heat: cmdHeat,
      rename: cmdRename,
      'rating-backfill': cmdRatingBackfill,
      'explicit-backfill': cmdExplicitBackfill,
      'search-tokens': cmdSearchTokens,
      backfill: cmdBackfill,
      'init-sync': () => cmdBackfill(true), // FP 批 P2：写 sync_runs（后台按钮可见进度与历史）
      images: cmdImages,
      backup: cmdBackup,
      prune: cmdPrune,
      readmodel: cmdReadModel,
    },
  };
}
