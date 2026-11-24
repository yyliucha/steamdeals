// CJ 批（docs/APP-AUTO-UPDATE-PAGE.md）：App 发版后 /app 页自动更新——
// 每小时同步 GitHub Release（yyliucha/steamdeals-app）的 latest.json / APK / sha256 到本地 data/app/，
// 站点自托管下载；GitHub Release 作兜底链接。失败不删旧文件（不 5xx），只保留最近 KEEP 个 APK。
//
// CT 批（docs/APP-SYNC-404.md）：仓库已公开、不再需要 token——
// 主路径改走 GET /repos/{repo}/releases?per_page=10，取第一条 draft=false && prerelease=false 的 release；
// /releases/latest 对部分 release 返回 404（线上实测），只作兜底（列表 404/网络失败/无合格项时再试）。
// 配置了 GITHUB_TOKEN 才带 authorization 头，未配置走匿名。失败原因日志区分
// app.sync_http_404 / app.sync_no_release / app.sync_no_assets，不再只有笼统的 github_http_404。
// DK 批（docs/TODO.md DK）：apk_download 失败带 apkFailed 标记（cmdAppSync 抛错 → 任务健康条显红）；
// 新增 githubApkUrl——本地与镜像都无 APK 时 /api/app/latest 的 apkPath 兜底 GitHub Release 直链。
// EK 批（docs/APP-RELEASE-SYNC-PROXY.md）：三件套资产下载（latest.json / APK / sha256）支持专用代理
// network.appSyncProxy（env APP_RELEASE_SYNC_PROXY）——有代理走 undici.ProxyAgent（复用 http.js
// proxyAgentOptions，零新依赖）且该次下载超时 30s；留空保持现状（直连、10s）。仅作用于资产下载，
// releases 列表/latest 接口请求保持现状。
// FK 批（docs/APP-SYNC-COS.md，所有者 2026-11-24 选方案 B）：同步换源——source=cos 时从腾讯云 COS
// 同步同一套资产（GET ${cosBase}/latest.json → steamdeals-<version>.apk + .sha256），source=github
// 保持 CT/EK/DK 原逻辑；cos 失败且 fallbackGithub 为真时回退 GitHub 一次（日志 app.release_fallback），
// 失败原因区分 cos_download / cos_404 / apk_download。COS 下载超时 60s（国内直连、APK 大，比 GitHub 直连 10s 宽）。
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, readdirSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { proxyAgentOptions } from './http.js';
import { parseProxy, redactProxy } from './proxy.js';

const GITHUB_API = 'https://api.github.com';
const RELEASES_PER_PAGE = 10;

const sha256Of = (buf) => createHash('sha256').update(buf).digest('hex');

/** 从 releases 列表（数组）或 latest 兜底（单对象）里挑第一条非 draft/prerelease。 */
function pickStableRelease(payload) {
  if (Array.isArray(payload)) return payload.find((r) => r && r.draft !== true && r.prerelease !== true) ?? null;
  if (payload && payload.draft !== true && payload.prerelease !== true) return payload;
  return null;
}

/**
 * FK 批（docs/APP-SYNC-COS.md）：同步入口——按 source 选源（github 默认 / cos）。
 * 返回 { synced: true, version, apk, latest, source } | { synced: false, reason, version?, source }。
 *   - source=github：CT/EK/DK 原逻辑不变（helper 见下方 syncFromGithub）；
 *   - source=cos：COS 拉取失败（除 same_version 外）且 fallbackGithub 为真 → 回退 GitHub 一次，
 *     结果额外带 fallbackFrom='cos' / fallbackReason，日志 app.release_fallback；
 *   - source 非法值按 github 处理（前端 enum 已拦，仅 env 陈旧兜底）。
 * source / cosBase / fallbackGithub 默认读 process.env（设置热加载 hydrate 写回，调度子进程继承）。
 */
export async function syncAppRelease(options = {}) {
  const {
    source = process.env.APP_RELEASE_SYNC_SOURCE || 'github',
    cosBase = process.env.APP_RELEASE_SYNC_COS_BASE ?? '',
    fallbackGithub = envBool(process.env.APP_RELEASE_SYNC_FALLBACK, true),
    logger = null,
  } = options;
  const src = String(source).trim().toLowerCase() || 'github';
  if (src !== 'cos') return { ...(await syncFromGithub(options)), source: 'github' };
  const cos = await syncFromCos({ ...options, cosBase, logger });
  if (cos.synced || cos.reason === 'same_version') return cos;
  if (!fallbackGithub) return cos;
  logger?.info?.('app.release_fallback', {
    from: 'cos', to: 'github', reason: cos.reason, version: cos.version ?? null,
  });
  const gh = await syncFromGithub(options);
  return { source: 'github', ...gh, fallbackFrom: 'cos', fallbackReason: cos.reason };
}

/**
 * GitHub Release 源（原 syncAppRelease 主体，CT/EK/DK 语义不变）。
 * fetchImpl 可注入（测试）；token 默认读 GITHUB_TOKEN（可选，公开仓库匿名可用）。
 * 目录默认 data/app（相对 process.cwd()）。
 * proxy（EK 批）默认读 env APP_RELEASE_SYNC_PROXY（设置热加载写回 env，调度子进程继承）：
 * 非空且为合法 http/https 时，资产下载走 ProxyAgent、超时 30s；空/非法 = 直连（现状，10s）。
 */
async function syncFromGithub({
  repo = 'yyliucha/steamdeals-app',
  keep = 3,
  dir = 'data/app',
  force = false,
  logger = null,
  fetchImpl = null,
  token = process.env.GITHUB_TOKEN || null,
  timeoutMs = 5000,
  proxy = process.env.APP_RELEASE_SYNC_PROXY ?? '',
} = {}) {
  const doFetch = fetchImpl ?? ((u, opts) => fetch(u, opts));
  const root = resolve(process.cwd(), dir);
  mkdirSync(root, { recursive: true });
  const latestFile = join(root, 'latest.json');
  const log = (event, fields) => logger?.info?.(`app.${event}`, fields);
  log('release_source', { source: 'github', repo });
  // CT 批：token 可选——配了才带认证头（留私有化口子），没配匿名请求
  const headers = { accept: 'application/vnd.github+json', ...(token ? { authorization: `token ${token}` } : {}) };
  const apiFetch = async (url) => {
    const res = await doFetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    return { status: res.status, ok: res.ok, json: async () => res.json() };
  };

  // ---- 主路径：releases 列表第一条非 draft/prerelease；latest 仅兜底 ----
  const listUrl = `${GITHUB_API}/repos/${repo}/releases?per_page=${RELEASES_PER_PAGE}`;
  const latestUrl = `${GITHUB_API}/repos/${repo}/releases/latest`;
  let listOk = false; // 列表接口本身 200（内容为空也算）——决定失败原因按 no_release 还是 http_404 报
  let lastStatus = null;
  let networkError = null;
  let release = null;
  try {
    const res = await apiFetch(listUrl);
    if (res.ok) {
      listOk = true;
      release = pickStableRelease(await res.json());
    } else {
      lastStatus = res.status;
    }
  } catch (err) {
    networkError = String(err?.message ?? err);
  }
  if (!release) {
    try {
      const res = await apiFetch(latestUrl);
      if (res.ok) {
        release = pickStableRelease(await res.json());
      } else if (!listOk) {
        lastStatus = res.status;
      }
    } catch (err) {
      if (!listOk) networkError = String(err?.message ?? err);
    }
  }
  if (!release) {
    if (listOk) {
      log('sync_no_release', { repo });
      return { synced: false, reason: 'no_release' };
    }
    if (lastStatus === 404) {
      log('sync_http_404', { repo });
      return { synced: false, reason: 'http_404' };
    }
    if (networkError !== null) {
      log('release_failed', { reason: 'network', message: networkError.slice(0, 120) });
      return { synced: false, reason: 'network' };
    }
    if (lastStatus !== null) {
      log('release_failed', { reason: `http_${lastStatus}` });
      return { synced: false, reason: `github_http_${lastStatus}` };
    }
    log('sync_no_release', { repo });
    return { synced: false, reason: 'no_release' };
  }

  const tag = String(release?.tag_name ?? '');
  const tagMatch = /^app-v(\d+\.\d+\.\d+)$/.exec(tag);
  if (!tagMatch) return { synced: false, reason: 'bad_tag', tag };
  const version = tagMatch[1];
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const latestAsset = assets.find((a) => a.name === 'latest.json');
  const apkAsset = assets.find((a) => a.name === `steamdeals-${version}.apk`);
  if (!latestAsset) {
    log('sync_no_assets', { repo, version });
    return { synced: false, reason: 'no_assets', version };
  }

  // 版本比较：本地已有同版本且非 force → 跳过。
  // DK 批 D（docs/TODO.md DK D）：同版本跳过前必须检查 APK 文件存在性——latest.json 同版本但
  // `steamdeals-<version>.apk` 缺失（上一轮 apk_download 失败）时不得跳过，重新走下载补齐；
  // 否则每小时调度永远 same_version 跳过、APK 永不自动补齐。
  // Release 没有 APK 资产时无 APK 可下，按原语义跳过。
  let localVersion = null;
  try {
    localVersion = JSON.parse(readFileSync(latestFile, 'utf8'))?.version ?? null;
  } catch { /* 无本地文件 */ }
  const localApk = join(root, `steamdeals-${version}.apk`);
  if (!force && localVersion === version && (!apkAsset || existsSync(localApk))) {
    log('release_skipped', { version });
    return { synced: false, reason: 'same_version', version };
  }

  // 下载 latest.json → 校验 version/versionCode 合法 → .tmp → rename 原子写。
  // EK 批（docs/APP-RELEASE-SYNC-PROXY.md §3）：专用代理只作用于下面的资产下载三处
  // （latest.json / APK / sha256）；releases 列表与 latest 接口请求保持现状。
  // 非法代理值按 parseProxy 语义视为未配置（直连），避免拼错的地址被当成"已启用"。
  const proxyUrl = parseProxy(proxy);
  const proxyAgent = proxyUrl ? new ProxyAgent(proxyAgentOptions(proxyUrl)) : null;
  const downloadTimeoutMs = proxyAgent ? 30000 : timeoutMs * 2;
  log('release_proxy', { via: proxyAgent ? 'proxy' : 'direct', proxy: proxyAgent ? redactProxy(proxyUrl) : null });
  // 下载 fetcher：注入的 fetchImpl 优先（测试据此断言 dispatcher）；默认实现仅在带 dispatcher 时走
  // undici.fetch（全局 fetch 不认 dispatcher），无 dispatcher 时保持全局 fetch 直连（EK 批前的现状）。
  const doDownloadFetch = fetchImpl ?? ((u, opts) => (opts.dispatcher ? undiciFetch(u, opts) : fetch(u, opts)));
  const download = async (url) => {
    const res = await doDownloadFetch(url, {
      signal: AbortSignal.timeout(downloadTimeoutMs),
      ...(proxyAgent ? { dispatcher: proxyAgent } : {}),
    });
    if (!res.ok) throw new Error(`http_${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  };
  try {
    const latestBuf = await download(latestAsset.browser_download_url);
    const latest = JSON.parse(latestBuf.toString('utf8'));
    if (String(latest.version) !== version || !Number.isInteger(Number(latest.versionCode))) {
      return { synced: false, reason: 'bad_latest', version };
    }
    const tmp = `${latestFile}.tmp`;
    writeFileSync(tmp, latestBuf);
    renameSync(tmp, latestFile);
  } catch (err) {
    log('release_failed', { reason: 'latest_download', message: String(err?.message ?? err).slice(0, 120) });
    return { synced: false, reason: 'latest_download' };
  }

  // 下载 APK + sha256 校验（无 apk 资产时不失败——latest 已更新）
  if (apkAsset) {
    try {
      const apkBuf = await download(apkAsset.browser_download_url);
      const shaAsset = assets.find((a) => a.name === `${apkAsset.name}.sha256`);
      const expect = shaAsset ? (await download(shaAsset.browser_download_url)).toString('utf8').trim().split(/\s+/)[0].toLowerCase() : null;
      const actual = sha256Of(apkBuf);
      if (expect && expect !== actual) {
        log('release_failed', { reason: 'sha_mismatch', version, expect, actual });
        return { synced: false, reason: 'sha_mismatch' };
      }
      const apkFile = join(root, apkAsset.name);
      const tmpApk = `${apkFile}.tmp`;
      writeFileSync(tmpApk, apkBuf);
      renameSync(tmpApk, apkFile);
      pruneApks(root, keep, version);
    } catch (err) {
      log('release_failed', { reason: 'apk_download', message: String(err?.message ?? err).slice(0, 120) });
      // 失败不删旧文件：latest 已更新但 APK 用旧的兜底（不 5xx）。
      // DK 批（docs/TODO.md DK C）：带 apkFailed 标记——cmdAppSync 据此抛错，
      // 后台任务健康条显红 + 原因可见（A5 接线；站点自托管缺 APK 时用户在走 GitHub 直链）。
      return { synced: true, version, apk: null, apkFailed: 'apk_download' };
    }
  }

  log('release_synced', { version, apk: apkAsset?.name ?? null });
  return { synced: true, version, apk: apkAsset?.name ?? null };
}

// ---- FK 批（docs/APP-SYNC-COS.md）：腾讯云 COS 源 ----
// COS 目录结构（与 GitHub Release 三资产同名，站点 /app 落盘格式完全一致）：
//   ${base}/latest.json
//   ${base}/steamdeals-<version>.apk
//   ${base}/steamdeals-<version>.apk.sha256
const APP_VERSION_RE = /^\d+\.\d+\.\d+$/;

/** 宽松布尔：'0'/'false'/'off'/'no' 为假，其余非空为真；空值用默认值（hydrate 写 '1'/'0'）。 */
function envBool(value, fallback) {
  const s = String(value ?? '').trim().toLowerCase();
  if (!s) return fallback;
  return !['0', 'false', 'off', 'no'].includes(s);
}

/** COS base 归一化：去两端空白与末尾斜杠（`${base}/latest.json` 拼接不出现双斜杠）。 */
function normalizeCosBase(value) {
  return String(value ?? '').trim().replace(/\/+$/, '');
}

/**
 * COS 源同步一次。语义与 GitHub 源对齐，差异点：
 *   - version 直接来自 COS 的 latest.json（不是 tag），必须严格 x.y.z + versionCode 整数才落盘
 *     （version 会拼进文件名，防 `../` 路径注入）；
 *   - APK 与 sha256 先下载并校验，全部成功后才原子写 latest.json + APK——不留「latest 指向缺失 APK」中间态；
 *   - 失败原因：latest.json 404 → cos_404；latest 其它失败 → cos_download；APK/sha 失败 → apk_download；
 *   - 下载超时 60s（cosTimeoutMs），不走 GitHub 专用代理（COS 国内直连）。
 * 返回 { synced, version?, apk?, reason?, source: 'cos' }。
 */
async function syncFromCos({
  dir = 'data/app',
  keep = 3,
  force = false,
  logger = null,
  fetchImpl = null,
  cosBase = process.env.APP_RELEASE_SYNC_COS_BASE ?? '',
  cosTimeoutMs = 60000,
} = {}) {
  const root = resolve(process.cwd(), dir);
  mkdirSync(root, { recursive: true });
  const latestFile = join(root, 'latest.json');
  const log = (event, fields) => logger?.info?.(`app.${event}`, fields);
  const base = normalizeCosBase(cosBase);
  // 日志只留 origin+path：COS 预签名地址的查询串带签名，不能进日志。
  log('release_source', { source: 'cos', base: base.split('?')[0].split('#')[0].slice(0, 200) });
  if (!base) {
    log('release_failed', { reason: 'cos_no_base', source: 'cos' });
    return { synced: false, reason: 'cos_no_base', source: 'cos' };
  }
  const doFetch = fetchImpl ?? ((u, opts) => fetch(u, opts));
  const get = async (url) => {
    const res = await doFetch(url, { signal: AbortSignal.timeout(cosTimeoutMs) });
    if (!res.ok) {
      const err = new Error(`http_${res.status}`);
      err.status = res.status;
      throw err;
    }
    return Buffer.from(await res.arrayBuffer());
  };

  // 1) latest.json —— 404 与其它失败分开报（路径填错/还没上传 vs 网络/5xx 处理方式不同）
  let latestBuf;
  try {
    latestBuf = await get(`${base}/latest.json`);
  } catch (err) {
    const reason = Number(err?.status) === 404 ? 'cos_404' : 'cos_download';
    log('release_failed', { reason, source: 'cos', message: String(err?.message ?? err).slice(0, 120) });
    return { synced: false, reason, source: 'cos' };
  }

  // 2) 解析 + 严格校验（与 GitHub 源同口径：version 必须匹配、versionCode 必须整数）
  let latest = null;
  try { latest = JSON.parse(latestBuf.toString('utf8')); } catch { latest = null; }
  const version = String(latest?.version ?? '');
  if (!APP_VERSION_RE.test(version) || !Number.isInteger(Number(latest?.versionCode))) {
    log('release_failed', { reason: 'bad_latest', source: 'cos', version: version || null });
    return { synced: false, reason: 'bad_latest', version: version || null, source: 'cos' };
  }

  // 3) 同版本且 APK 已落盘 → 跳过（DK D 语义：APK 缺失不跳过、重新下载补齐）
  let localVersion = null;
  try { localVersion = JSON.parse(readFileSync(latestFile, 'utf8'))?.version ?? null; } catch { /* 无本地文件 */ }
  const apkName = `steamdeals-${version}.apk`;
  const apkFile = join(root, apkName);
  if (!force && localVersion === version && existsSync(apkFile)) {
    log('release_skipped', { version, source: 'cos' });
    return { synced: false, reason: 'same_version', version, source: 'cos' };
  }

  // 4) 先下 APK + sha256 校验，全部成功后再落盘
  let apkBuf;
  let expect = null;
  try {
    apkBuf = await get(`${base}/${apkName}`);
    try {
      expect = (await get(`${base}/${apkName}.sha256`)).toString('utf8').trim().split(/\s+/)[0].toLowerCase();
    } catch (err) {
      // sha256 缺失（404）不阻断同步（与 GitHub 源一致：没 sha 就跳过校验），其它失败照常报 apk_download。
      if (Number(err?.status) !== 404) throw err;
      log('release_sha_missing', { version, name: `${apkName}.sha256` });
    }
  } catch (err) {
    log('release_failed', { reason: 'apk_download', source: 'cos', version, message: String(err?.message ?? err).slice(0, 120) });
    return { synced: false, reason: 'apk_download', version, source: 'cos' };
  }
  const actual = sha256Of(apkBuf);
  if (expect && expect !== actual) {
    log('release_failed', { reason: 'sha_mismatch', source: 'cos', version, expect, actual });
    return { synced: false, reason: 'sha_mismatch', version, source: 'cos' };
  }

  // 5) 原子落盘：两个 .tmp 都写完再 rename，latest.json 最后 rename（版本公告晚于 APK 就绪）
  writeFileSync(`${latestFile}.tmp`, latestBuf);
  writeFileSync(`${apkFile}.tmp`, apkBuf);
  renameSync(`${apkFile}.tmp`, apkFile);
  renameSync(`${latestFile}.tmp`, latestFile);
  pruneApks(root, keep, version);
  log('release_synced', { version, apk: apkName, source: 'cos' });
  return { synced: true, version, apk: apkName, source: 'cos' };
}

/** 只保留最近 KEEP 个 steamdeals-*.apk（按版本号排序，旧的全删）。 */
export function pruneApks(dir, keep = 3, currentVersion = null) {
  const root = resolve(process.cwd(), dir);
  const files = readdirSync(root)
    .filter((f) => /^steamdeals-\d+\.\d+\.\d+\.apk$/.test(f))
    .map((f) => ({ f, v: f.match(/(\d+\.\d+\.\d+)/)[1] }));
  const versionCmp = (a, b) => a.v.split('.').map(Number).reduce((acc, n, i) => acc || n - (Number(b.v.split('.')[i]) || 0), 0);
  files.sort((a, b) => versionCmp(b, a));
  for (const item of files.slice(Number(keep))) unlinkSync(join(root, item.f));
  return files.length;
}

/** /api/app/latest 读取优先级：data/app/latest.json → APP_LATEST_FILE（镜像兜底）。 */
export function readLatestMeta(dir = 'data/app', fallbackFile = null) {
  const file = join(resolve(process.cwd(), dir), 'latest.json');
  try {
    if (existsSync(file)) return { source: 'data', data: JSON.parse(readFileSync(file, 'utf8')) };
  } catch { /* 坏文件回落镜像 */ }
  if (fallbackFile && existsSync(fallbackFile)) {
    try { return { source: 'image', data: JSON.parse(readFileSync(fallbackFile, 'utf8')) }; } catch { /* 忽略 */ }
  }
  return { source: 'none', data: null };
}

/**
 * DK 批（docs/TODO.md DK A）：apkPath 兜底——本地 data/app 与镜像都没有该版本 APK 时，
 * /api/app/latest 返回 GitHub Release 直链（App 白名单已含 github.com / githubusercontent.com），
 * 不再返回 null。版本不合法仍返回 null（BY 契约：缺失字段不报错）。
 */
export function githubApkUrl(version, repo = 'yyliucha/steamdeals-app') {
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) return null;
  return `https://github.com/${repo}/releases/download/app-v${version}/steamdeals-${version}.apk`;
}

/**
 * CO-4/B4（docs/DESIGN-AUDIT.md B4）：从 src/server.js 移入（原 appApkPathFor，签名不变）——
 * CJ 现场回归修复（2026-11-17 线上 v2.22.0）：/api/app/latest 的 apkPath 按文件真实存在性派生：
 * data/app（GitHub Release 每小时同步）优先 → `/app/dl/<ver>.apk`；
 * 否则镜像内 app/<ver>.apk 存在 → 回落 `/app/<ver>.apk`（旧路径，isFrontendPublicFile 白名单内）；
 * 都没有 → null（BY 契约：缺失字段不报错，由调用方再走 githubApkUrl 兜底）。
 * APP_DATA_DIR 可覆盖 data 目录（测试隔离/运维）。
 */
export function appApkPathFor(version, frontendDir, cwd = process.cwd()) {
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) return null;
  const name = `steamdeals-${version}.apk`;
  const synced = resolve(cwd, process.env.APP_DATA_DIR ?? 'data/app', name);
  if (existsSync(synced)) return `/app/dl/${name}`;
  const mirror = resolve(frontendDir ?? 'frontend/dist', 'app', name);
  if (existsSync(mirror)) return `/app/${name}`;
  return null;
}
