// CJ 批（docs/APP-AUTO-UPDATE-PAGE.md）：App 发版后 /app 页自动更新——
// 每小时同步 GitHub Release（yyliucha/steamdeals-app）的 latest.json / APK / sha256 到本地 data/app/，
// 站点自托管下载；GitHub Release 作兜底链接。失败不删旧文件（不 5xx），只保留最近 KEEP 个 APK。
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, readdirSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const GITHUB_API = 'https://api.github.com';

const sha256Of = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * 同步一次。返回 { synced: true, version, apk, latest } | { synced: false, reason, version? }。
 * fetchImpl 可注入（测试）。目录默认 data/app（相对 process.cwd()）。
 */
export async function syncAppRelease({
  repo = 'yyliucha/steamdeals-app',
  keep = 3,
  dir = 'data/app',
  force = false,
  logger = null,
  fetchImpl = null,
  timeoutMs = 5000,
} = {}) {
  const doFetch = fetchImpl ?? ((u, opts) => fetch(u, opts));
  const root = resolve(process.cwd(), dir);
  mkdirSync(root, { recursive: true });
  const latestFile = join(root, 'latest.json');
  const log = (event, fields) => logger?.info?.(`app.${event}`, fields);

  let remote;
  try {
    const res = await doFetch(`${GITHUB_API}/repos/${repo}/releases/latest`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { synced: false, reason: `github_http_${res.status}` };
    remote = await res.json();
  } catch (err) {
    log('release_failed', { reason: 'network', message: String(err?.message ?? err).slice(0, 120) });
    return { synced: false, reason: 'network' };
  }
  const tag = String(remote?.tag_name ?? '');
  const tagMatch = /^app-v(\d+\.\d+\.\d+)$/.exec(tag);
  if (!tagMatch) return { synced: false, reason: 'bad_tag', tag };
  const version = tagMatch[1];
  const assets = Array.isArray(remote.assets) ? remote.assets : [];
  const latestAsset = assets.find((a) => a.name === 'latest.json');
  const apkAsset = assets.find((a) => a.name === `steamdeals-${version}.apk`);
  if (!latestAsset) return { synced: false, reason: 'no_latest_asset', version };

  // 版本比较：本地已有同版本且非 force → 跳过
  let localVersion = null;
  try {
    localVersion = JSON.parse(readFileSync(latestFile, 'utf8'))?.version ?? null;
  } catch { /* 无本地文件 */ }
  if (!force && localVersion === version) {
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
      // 失败不删旧文件：latest 已更新但 APK 用旧的兜底（不 5xx）
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
