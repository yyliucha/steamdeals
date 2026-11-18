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
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, readdirSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

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
 * 同步一次。返回 { synced: true, version, apk, latest } | { synced: false, reason, version? }。
 * fetchImpl 可注入（测试）；token 默认读 GITHUB_TOKEN（可选，公开仓库匿名可用）。
 * 目录默认 data/app（相对 process.cwd()）。
 */
export async function syncAppRelease({
  repo = 'yyliucha/steamdeals-app',
  keep = 3,
  dir = 'data/app',
  force = false,
  logger = null,
  fetchImpl = null,
  token = process.env.GITHUB_TOKEN || null,
  timeoutMs = 5000,
} = {}) {
  const doFetch = fetchImpl ?? ((u, opts) => fetch(u, opts));
  const root = resolve(process.cwd(), dir);
  mkdirSync(root, { recursive: true });
  const latestFile = join(root, 'latest.json');
  const log = (event, fields) => logger?.info?.(`app.${event}`, fields);
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

  // 下载 latest.json → 校验 version/versionCode 合法 → .tmp → rename 原子写
  const download = async (url) => {
    const res = await doFetch(url, { signal: AbortSignal.timeout(timeoutMs * 2) });
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
