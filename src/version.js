// 版本与更新检查（AE 批 docs/VERSION-SOURCE.md：按服务器 IP 选镜像仓库）。
//
// 链路：detectRegion（ipinfo.io，24h 缓存）→ 按区域顺序查仓库最新 tag
// （TCR / Docker Hub 都走匿名 token，tag 无 v 前缀，^X.Y.Z$ 过滤取最大）→ 全失败回退 GitHub。
// 结果缓存：成功 6 小时、全失败 10 分钟；`/api/admin/version?force=1` 可强刷。
import { fetchJson } from './http.js';

export const DEFAULT_REPO = 'yyliucha/steamdeals';

/** AE 批：两个镜像仓库（CI 双推；tag 均为 X.Y.Z、无 v 前缀）。 */
export const REGISTRIES = {
  tcr: { image: 'ccr.ccs.tencentyun.com/tcb-100003189690-pljp/steamdeals' },
  hub: { image: 's1065420329/steamdeals' },
};

const GEO_URL = 'https://ipinfo.io/json';
const OK_CACHE_MS = 6 * 3600 * 1000;
const FAIL_CACHE_MS = 10 * 60 * 1000;
const GEO_OK_CACHE_MS = 24 * 3600 * 1000;

const cache = { at: 0, value: null };
const geoCache = { at: 0, value: null };

/** "v0.20.2" / "0.20.2" → [0,20,2]；解析失败返回 null。 */
export function parseVersion(value) {
  const m = String(value ?? '')
    .trim()
    .replace(/^v/i, '')
    .match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** 语义化版本比较：a>b 返回正数，a<b 负数，相等 0（只比较 major.minor.patch）。 */
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

/** 区域判定（AE 批 §3-A）：ipinfo.io 免费无 key；CN/HK → 'cn'，其他 → 'global'，失败 → 'unknown'。
 *  缓存：成功 24h，失败 10min（失败也缓存，避免每次刷新都打）。 */
export async function detectRegion({ logger = null, force = false, fetchImpl = null } = {}) {
  if (!force && geoCache.value && Date.now() - geoCache.at < (geoCache.value === 'unknown' ? FAIL_CACHE_MS : GEO_OK_CACHE_MS)) {
    return geoCache.value;
  }
  let region = 'unknown';
  try {
    const r = await fetchJson(GEO_URL, {
      label: 'update.geo',
      logger,
      retries: 0,
      timeoutMs: 2000,
      ...(fetchImpl ? { fetchImpl } : {}),
    });
    const country = String(r.json?.country ?? '').trim().toUpperCase();
    if (country) {
      region = ['CN', 'HK'].includes(country) ? 'cn' : 'global';
      logger?.info?.('update.geo_ok', { country });
    }
  } catch (err) {
    logger?.warn?.('update.geo_failed', { message: String(err.message ?? err).slice(0, 120) });
  }
  geoCache.at = Date.now();
  geoCache.value = region;
  return region;
}

/** 区域 → 仓库探测顺序（AE 批 §3-C；unknown 也按 hub 优先但会两个都探）。 */
export function pickSourceOrder(region) {
  return region === 'cn' ? ['tcr', 'hub'] : ['hub', 'tcr'];
}

/** 仓库接口地址（token 服务 + tags 列表），AE 批 §3-B。 */
function registryEndpoints(source) {
  const image = REGISTRIES[source]?.image;
  if (!image) throw new Error('unknown registry: ' + source);
  if (source === 'tcr') {
    const path = image.split('/').slice(1).join('/'); // 去 host，剩 namespace/repo
    return {
      tokenUrl: `https://ccr.ccs.tencentyun.com/service/token?service=token-service&scope=repository:${path}:pull`,
      tagsUrl: `https://ccr.ccs.tencentyun.com/v2/${path}/tags/list`,
    };
  }
  return {
    tokenUrl: `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${image}:pull`,
    tagsUrl: `https://registry-1.docker.io/v2/${image}/tags/list`,
  };
}

/** 从指定仓库取最新 tag：匿名 token → tags/list；401 换新 token 重试一次（AE 批 §3-B/风险 #1）。
 *  过滤 `^\d+\.\d+\.\d+$`（两仓库都无 v 前缀，排除 latest / 两段版本 / sha-*），取最大；无可用 tag 返回 null。 */
export async function fetchRegistryLatest(source, { logger = null, fetchImpl = null } = {}) {
  const { tokenUrl, tagsUrl } = registryEndpoints(source);
  const call = (url, headers = {}, label) =>
    fetchJson(url, { label, logger, retries: 0, timeoutMs: 4000, headers, ...(fetchImpl ? { fetchImpl } : {}) });
  const getToken = async () => {
    const t = await call(tokenUrl, {}, 'update.registry_token');
    const token = t.json?.token ?? t.json?.access_token;
    if (!token) throw new Error(`${source} token 缺失`);
    return token;
  };
  let token = await getToken();
  let res;
  try {
    res = await call(tagsUrl, { authorization: `Bearer ${token}` }, 'update.registry_tags');
  } catch (err) {
    if (err.status === 401) {
      // 401 只是标准 Bearer challenge：换新 token 重试一次，不允许直接判失败（AE 批风险 #1）
      token = await getToken();
      res = await call(tagsUrl, { authorization: `Bearer ${token}` }, 'update.registry_tags');
    } else {
      throw err;
    }
  }
  const names = (res.json?.tags ?? []).map(String).filter((n) => /^\d+\.\d+\.\d+$/.test(n));
  names.sort(compareVersions);
  return names[names.length - 1] ?? null;
}

/** 仓库查询包装：失败只记日志返回 null（徽标不因单源故障抛错）。 */
export async function checkRegistryLatest(source, { logger = null, fetchImpl = null } = {}) {
  try {
    const latest = await fetchRegistryLatest(source, { logger, fetchImpl });
    if (latest) {
      logger?.info?.('update.registry_ok', { source, latest });
      return { source, latest };
    }
    logger?.warn?.('update.registry_failed', { source, status: 'no_tag' });
    return null;
  } catch (err) {
    logger?.warn?.('update.registry_failed', {
      source,
      status: err.status ?? null,
      message: String(err.message ?? err).slice(0, 120),
    });
    return null;
  }
}

/**
 * GitHub 兜底（AE 批保留的现有能力；带缓存）。
 * 返回 { repo, latest, url, checkedAt, error }；网络/额度问题只记 error，不抛异常。
 */
export async function checkLatest({ repo = DEFAULT_REPO, logger = null, force = false, fetchImpl = null } = {}) {
  if (!force && cache.value && Date.now() - cache.at < OK_CACHE_MS && cache.value.latest) return cache.value;

  const out = { repo, latest: null, url: null, checkedAt: new Date().toISOString(), error: null };
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'steamdeals-update-check' };
  const call = (url, label) =>
    fetchJson(url, { label, logger, headers, retries: 0, timeoutMs: 8000, ...(fetchImpl ? { fetchImpl } : {}) });
  try {
    let latest = null;
    let url = null;
    // 仓库发了 release 就用 release/latest；没有 release（只有 tag）时退回 tags 列表
    try {
      const rel = await call(`https://api.github.com/repos/${repo}/releases/latest`, 'update.release');
      latest = rel.json?.tag_name ?? null;
      url = rel.json?.html_url ?? null;
    } catch {
      /* 没有 release 是常态，继续走 tags */
    }
    if (!latest) {
      const tags = await call(`https://api.github.com/repos/${repo}/tags?per_page=100`, 'update.tags');
      const names = (tags.json ?? []).map((t) => t.name).filter((n) => parseVersion(n));
      names.sort(compareVersions);
      latest = names[names.length - 1] ?? null;
      url = latest ? `https://github.com/${repo}/releases/tag/${latest}` : null;
    }
    out.latest = latest;
    out.url = url;
  } catch (err) {
    out.error = String(err.message ?? err).slice(0, 200);
    logger?.warn('update.check_failed', { repo, message: out.error });
  }
  cache.at = Date.now();
  cache.value = out;
  return out;
}

/** 当前版本 + 最新版本 + 是否有更新（AE 批：geo → registry → GitHub 兜底，带 source/region）。 */
export async function versionInfo({ current, repo = DEFAULT_REPO, logger = null, force = false, fetchImpl = null } = {}) {
  if (!force && cache.value && Date.now() - cache.at < (cache.value.latest ? OK_CACHE_MS : FAIL_CACHE_MS) && cache.value.region !== undefined) {
    return cache.value;
  }

  const region = await detectRegion({ logger, force, fetchImpl });
  let source = null;
  let latest = null;
  let url = null;
  let error = null;
  for (const s of pickSourceOrder(region)) {
    const r = await checkRegistryLatest(s, { logger, fetchImpl });
    if (r && r.latest) {
      source = s;
      latest = r.latest;
      break;
    }
  }
  if (latest) {
    const image = REGISTRIES[source].image;
    url = source === 'hub' ? `https://hub.docker.com/r/${image}/tags` : `https://ccr.ccs.tencentyun.com/${image.split('/').slice(1).join('/')}`;
  } else {
    // 两个仓库都失败：回退 GitHub（保留现有能力，不回归）
    const gh = await checkLatest({ repo, logger, force: true, fetchImpl });
    latest = gh.latest;
    url = gh.url;
    error = gh.error;
    source = 'github';
  }
  const out = {
    current,
    latest,
    updateAvailable: Boolean(latest) && compareVersions(latest, current) > 0,
    url,
    checkedAt: new Date().toISOString(),
    error,
    repo,
    source,
    region,
  };
  cache.at = Date.now();
  cache.value = out;
  return out;
}

/** 测试用：清空缓存。 */
export function resetVersionCache() {
  cache.at = 0;
  cache.value = null;
  geoCache.at = 0;
  geoCache.value = null;
}
