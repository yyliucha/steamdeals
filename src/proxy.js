// 出网代理决策。
//
// 场景：国内服务器访问 Steam 官方接口超时，但杉果（境内）、GOG、Humble 是通的。
// 如果所有请求都走代理，既慢又浪费流量；所以按**目标主机**决定是否走代理：
//
//   STEAM_PROXY  只作用于 Steam 域名（store/api/community）
//   HTTPS_PROXY  通用代理，作用于其余所有主机（受 NO_PROXY 排除）
//
// 两者都不配 = 全部直连（默认行为，和之前完全一致）。

/** 默认走 Steam 专用代理的域名后缀。 */
export const DEFAULT_STEAM_HOSTS = ['store.steampowered.com', 'api.steampowered.com', 'steamcommunity.com', 'cdn.cloudflare.steamstatic.com'];

const firstDefined = (...values) => values.find((v) => typeof v === 'string' && v.trim() !== '') ?? '';

/** 读取代理地址；非法 URL 视为未配置，避免把拼错的地址当成"已启用"。 */
export function parseProxy(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.includes('://') ? raw : `http://${raw}`);
    if (!/^https?:$/.test(url.protocol)) return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

/**
 * 多条代理解析（docs/PROXY-POOL.md §3.1，AM-1 批）：换行/逗号分隔 → 去空 →
 * 逐条 parseProxy（非法行丢弃）→ 去重（保留首次出现）。老的单行配置天然等于 1 条。
 */
export function parseProxyList(value) {
  const seen = new Set();
  const out = [];
  for (const part of String(value ?? '').split(/[\r\n,]+/)) {
    const url = parseProxy(part);
    if (url && !seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}

/** 读取 STEAM_PROXY 的全部条目（环境变量同样接受换行/逗号分隔）；没配返回 []。 */
export function steamProxyUrls(env = process.env) {
  return parseProxyList(firstDefined(env.STEAM_PROXY, env.steam_proxy));
}

/** NO_PROXY / no_proxy → 数组；支持 *、逗号、后缀匹配、带端口。 */
export function parseNoProxy(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function shouldBypass(host, noProxy = []) {
  const target = String(host ?? '').toLowerCase().split(':')[0];
  if (!target) return false;
  for (const rule of noProxy) {
    if (rule === '*') return true;
    const bare = rule.split(':')[0];
    if (!bare) continue;
    if (target === bare) return true;
    if (bare.startsWith('.') && target.endsWith(bare)) return true;
    if (target.endsWith(`.${bare}`)) return true;
  }
  return false;
}

/**
 * 决定某个主机该怎么出网。
 * 返回 { via: 'steam-proxy' | 'proxy' | 'direct', url: string|null }
 */
export function decideProxy(host, env = process.env, steamHosts = DEFAULT_STEAM_HOSTS) {
  const target = String(host ?? '').toLowerCase().split(':')[0];
  const noProxy = parseNoProxy(firstDefined(env.NO_PROXY, env.no_proxy));

  const isSteam = steamHosts.some((suffix) => target === suffix || target.endsWith(`.${suffix}`));
  if (isSteam) {
    // AM-1：Steam 专用代理现在可以配多条；本函数保持"取一条"的旧语义（取第一条），
    // 多条的顺序切换/冷却在 src/proxy-pool.js 与 http.js 的重试循环里处理。
    const steam = steamProxyUrls(env);
    if (steam.length) return { via: 'steam-proxy', url: steam[0] };
    // Steam 没配专用代理时，落回通用代理（如果配了）
    const general = parseProxy(firstDefined(env.HTTPS_PROXY, env.https_proxy, env.HTTP_PROXY, env.http_proxy));
    if (general && !shouldBypass(target, noProxy)) return { via: 'proxy', url: general };
    return { via: 'direct', url: null };
  }

  const general = parseProxy(firstDefined(env.HTTPS_PROXY, env.https_proxy, env.HTTP_PROXY, env.http_proxy));
  if (general && !shouldBypass(target, noProxy)) return { via: 'proxy', url: general };
  return { via: 'direct', url: null };
}

/** 日志里不能出现代理密码。 */
export function redactProxy(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = u.username ? '***' : '';
      u.password = '';
    }
    return u.toString().replace(/\/$/, '');
  } catch {
    return '***';
  }
}

/** 给 diagnose 用的一行摘要。 */
export function describeProxy(env = process.env) {
  const steam = decideProxy('store.steampowered.com', env);
  const other = decideProxy('catalog.gog.com', env);
  const pool = steamProxyUrls(env);
  return {
    steam: { via: steam.via, proxy: redactProxy(steam.url), poolCount: pool.length },
    others: { via: other.via, proxy: redactProxy(other.url) },
  };
}
