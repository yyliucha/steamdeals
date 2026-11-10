// Steam OpenID 绑定 + 账号数据 schema。
// 身份由站点会话决定：Steam 账号归属站点用户（steam_accounts.user_id），steam_sessions 已停用。
// 绑定（OpenID）不需要 API Key；游戏库/愿望单同步需要 STEAM_API_KEY，且账号资料必须公开。
import { fetchText, fetchJson } from './http.js';
import { randomBytes } from 'node:crypto';
import { isPrivateAddress, matchesIpEntry } from './visitors.js';

const OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login';

/** 建表（幂等）。steam_accounts 归属站点用户（user_id），一账号只属一人；steam_sessions 已停用（保留表不再写入）。 */
export async function ensureSteamSchema(store) {
  const exec = (sql) => (store.exec ? store.exec(sql) : store.query(sql));
  await exec('alter table users add column if not exists steam_id text');
  await exec('create unique index if not exists users_steam_uniq on users (steam_id) where steam_id is not null');
  await exec([
    'create table if not exists steam_accounts (',
    '  steam_id text primary key,',
    '  persona_name text,',
    '  avatar text,',
    '  alias text,',
    '  user_id integer references users(id) on delete cascade,',
    '  api_key_enc text,',
    '  last_login_at timestamptz not null default now()',
    ');',
  ].join('\n'));
  // 老库补列（幂等；user_id 先允许为空，未归属账号走「认领」）
  await exec('alter table steam_accounts add column if not exists user_id integer references users(id) on delete cascade');
  await exec('alter table steam_accounts add column if not exists alias text');
  // 账号自配的 Steam Web API Key（写愿望单等写操作必须用账号自己的 key），AES-256-GCM 加密
  await exec('alter table steam_accounts add column if not exists api_key_enc text');
  await exec('create index if not exists steam_accounts_user on steam_accounts (user_id)');
  await exec([
    'create table if not exists steam_sessions (',
    '  token text primary key,',
    '  steam_id text not null references steam_accounts(steam_id) on delete cascade,',
    '  created_at timestamptz not null default now()',
    ');',
  ].join('\n'));
  await exec([
    'create table if not exists steam_games (',
    '  steam_id text not null,',
    '  appid integer not null,',
    '  name text,',
    '  playtime_minutes integer not null default 0,',
    '  last_played_at timestamptz,',
    '  synced_at timestamptz not null default now(),',
    '  primary key (steam_id, appid)',
    ');',
  ].join('\n'));
  await exec('create index if not exists steam_games_appid on steam_games (appid)');
  await exec([
    'create table if not exists steam_wishlist (',
    '  steam_id text not null,',
    '  appid integer not null,',
    '  name text,',
    '  synced_at timestamptz not null default now(),',
    '  primary key (steam_id, appid)',
    ');',
  ].join('\n'));
  await exec('create index if not exists steam_wishlist_appid on steam_wishlist (appid)');
  // 站点内手动愿望单：与 Steam 同步推导取并集；steam_ids 记用户选择推送的账号（移除时回推删除）
  await exec([
    'create table if not exists user_wishlist (',
    '  user_id    integer not null references users(id) on delete cascade,',
    '  game_id    bigint not null references games(id) on delete cascade,',
    '  steam_ids  text[] not null default \'{}\',',
    '  created_at timestamptz not null default now(),',
    '  primary key (user_id, game_id)',
    ');',
  ].join('\n'));
  await exec('create index if not exists user_wishlist_user on user_wishlist (user_id)');
  // BE 批（docs/WISHLIST-SITE-ONLY.md §4.2）：后台按单条删除需要代理主键（复合主键保留不动）
  await exec('alter table user_wishlist add column if not exists id bigserial');
  await exec('create unique index if not exists user_wishlist_id_key on user_wishlist (id)');
  // Steam 账号操作审计（docs/ADMIN-CONSOLE-IA.md §5，AT 批）：
  // 7 类动作（bind/unbind/claim/sync-library/sync-wishlist/api-key/delete-cascade）。
  // user_id 故意不挂外键——用户被删后这条证据要留下；保留 180 天，由 prune 任务清理。
  await exec([
    'create table if not exists steam_account_logs (',
    '  id           bigserial primary key,',
    '  created_at   timestamptz not null default now(),',
    "  action       text not null,          -- bind | unbind | claim | sync-library | sync-wishlist | api-key | delete-cascade",
    '  steam_id     text not null,',
    '  persona_name text,                   -- 动作发生时的昵称快照',
    '  user_id      integer,                -- 故意不挂外键：用户被删后这条证据要留下',
    '  username     text,                   -- 归属用户名快照',
    "  actor        text not null,          -- 'admin:xxx' | 'scheduler' | 'self'",
    "  result       text not null,          -- ok | failed",
    '  detail       jsonb,                  -- { added,removed,total } / { httpStatus, reason }',
    '  elapsed_ms   integer,',
    '  error        text                    -- 截断 200 字符',
    ');',
  ].join('\n'));
  await exec('create index if not exists steam_logs_time on steam_account_logs (created_at desc)');
  await exec('create index if not exists steam_logs_steam on steam_account_logs (steam_id, created_at desc)');
}

// 按「查询函数」维度懒建表：同一进程里可能有多个 store（测试每个用例新建 PGlite），
// 进程级 flag 会让第二个 store 跳过 DDL。用 WeakMap 缓存 Promise，同一 q 并发请求也不会重复建表。
const ensuredQueries = new WeakMap();
export async function ensureSteamSchemaOnce(q) {
  if (ensuredQueries.has(q)) return ensuredQueries.get(q);
  const pending = ensureSteamSchema({ exec: (sql) => q(sql), query: (sql) => q(sql) });
  ensuredQueries.set(q, pending);
  await pending;
}

export function baseUrl(req) {
  // 只信任可信反代传入的 X-Forwarded-*（防 Host/协议伪造影响 Steam 登录回调地址）
  const raw = String(req.socket?.remoteAddress ?? '').replace(/^::ffff:/, '');
  const trustedEntries = String(process.env.TRUSTED_PROXY_IPS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const trusted =
    isPrivateAddress(raw) ||
    (process.env.TRUST_PROXY === '1' && trustedEntries.some((entry) => matchesIpEntry(raw, entry)));
  const host = trusted
    ? String(req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost')
    : String(req.headers.host ?? 'localhost');
  const proto = trusted
    ? String(req.headers['x-forwarded-proto'] ?? (req.socket?.encrypted ? 'https' : 'http')).split(',')[0].trim()
    : req.socket?.encrypted
      ? 'https'
      : 'http';
  return proto + '://' + host;
}

/** 生成跳转到 Steam 的授权地址。state 用于防 CSRF（绑定到当前站点用户会话，5 分钟过期）。 */
export function buildLoginUrl(base, state = null) {
  const returnTo = state ? `${base}/api/auth/steam/callback?state=${encodeURIComponent(state)}` : `${base}/api/auth/steam/callback`;
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnTo,
    'openid.realm': base,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });
  return OPENID_ENDPOINT + '?' + params.toString();
}

/** 用 Steam 校验回传参数，成功返回 steamid（17 位），失败返回 null。 */
export async function verifyCallback(url, { logger = null, fetchImpl = null } = {}) {
  const params = new URLSearchParams(url.search);
  params.set('openid.mode', 'check_authentication');
  const post = (extra) =>
    fetchText(OPENID_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      timeoutMs: 20000,
      retries: 1,
      logger,
      ...(fetchImpl ? { fetchImpl } : {}),
      ...extra,
    });
  // fetchText 返回 { body, status, … } 对象，这里要的是 body 文本。
  // 历史 bug：直接把整个对象当字符串匹配，`/is_valid/` 永远匹配不上，
  // 日志里 snippet 打印 "[object Object]"（连接通了也会判失败）。
  const read = (resp) => resp?.body ?? String(resp ?? '');
  let text = '';
  try {
    text = read(await post({}));
  } catch (err) {
    // 代理可能把 steamcommunity 的连接重置：再直连试一次（国内直连有时反而通）
    logger?.warn('steam.openid_retry_direct', { message: String(err.message).slice(0, 120) });
    try {
      text = read(await post({ forceDirect: true, retries: 0 }));
    } catch (err2) {
      logger?.warn('steam.openid_failed', { message: String(err2.message).slice(0, 160) });
      return null;
    }
  }
  if (!/is_valid\s*:\s*true/.test(text)) {
    logger?.warn('steam.openid_invalid', { snippet: String(text).slice(0, 120) });
    return null;
  }
  const claimed = String(url.searchParams.get('openid.claimed_id') ?? '');
  const m = /\/id\/(\d{17})$/.exec(claimed);
  if (!m) {
    logger?.warn('steam.openid_no_id', { claimed });
    return null;
  }
  logger?.info('steam.openid_ok', { steamId: m[1] });
  return m[1];
}

// ---- 绑定 state（防 CSRF / 防串号）----
// 进程内存即可：单进程服务，5 分钟过期；重启后未完成的绑定重试一次即可。
const BIND_STATE_TTL_MS = 5 * 60 * 1000;

/** 签发一次性绑定 state：随机串 + 归属站点用户 + 过期时间。 */
export function issueBindState(map, userId, { nowMs = Date.now(), ttlMs = BIND_STATE_TTL_MS } = {}) {
  // 顺手清掉过期项，避免长期运行后无限增长
  for (const [state, entry] of map) {
    if (entry.expiresAt <= nowMs) map.delete(state);
  }
  const state = randomBytes(24).toString('base64url');
  map.set(state, { userId, expiresAt: nowMs + ttlMs });
  return state;
}

/** 校验并消费一次性 state：合法返回 userId（取后即焚），非法/过期返回 null。 */
export function consumeBindState(map, state, { nowMs = Date.now() } = {}) {
  if (!state) return null;
  const entry = map.get(state);
  map.delete(state);
  if (!entry || entry.expiresAt <= nowMs) return null;
  return entry.userId;
}

/** 拉取昵称头像（需要 API Key；没有 key 就用 steamid）。 */
export async function fetchPersona({ apiKey, steamId, logger = null }) {
  if (!apiKey) return { personaName: null, avatar: null };
  try {
    const url =
      'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=' +
      encodeURIComponent(apiKey) + '&steamids=' + encodeURIComponent(steamId);
    const res = await fetchJson(url, { logger, timeoutMs: 20000, retries: 1 });
    const data = res?.json ?? {};
    const p = data?.response?.players?.[0] ?? null;
    return { personaName: p?.personaname ?? null, avatar: p?.avatarfull ?? null };
  } catch (err) {
    logger?.warn('steam.persona_failed', { message: String(err.message).slice(0, 120) });
    return { personaName: null, avatar: null };
  }
}

/** 拉取账号拥有的游戏（需要 API Key）。 */
export async function fetchOwnedGames({ apiKey, steamId, logger = null }) {
  const url =
    'https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/' +
    '?key=' + encodeURIComponent(apiKey) +
    '&steamid=' + encodeURIComponent(steamId) +
    '&include_appinfo=1&include_played_free_games=1&format=json';
  const res = await fetchJson(url, { logger, timeoutMs: 30000, retries: 1 });
  const data = res?.json ?? {};
  const games = data?.response?.games ?? [];
  return games
    .map((g) => ({
      appid: Number(g.appid),
      name: String(g.name ?? '').trim(),
      playtimeMinutes: Number(g.playtime_forever ?? 0),
      lastPlayedAt: g.rtime_last_played ? new Date(g.rtime_last_played * 1000) : null,
    }))
    .filter((g) => Number.isFinite(g.appid) && g.appid > 0);
}

/** 拉取账号愿望单（需要 API Key；账号「游戏详情/愿望单」必须公开）。 */
export async function fetchWishlist({ apiKey, steamId, logger = null }) {
  const url =
    'https://api.steampowered.com/IWishlistService/GetWishlist/v1/' +
    '?key=' + encodeURIComponent(apiKey) +
    '&steamid=' + encodeURIComponent(steamId) + '&format=json';
  const res = await fetchJson(url, { logger, timeoutMs: 30000, retries: 1 });
  const data = res?.json ?? {};
  // 响应形状随接口版本略有差异：兼容 items / wishlist 两种常见键。
  const items = data?.response?.items ?? data?.response?.wishlist ?? data?.items ?? [];
  const parsed = [];
  for (const it of Array.isArray(items) ? items : []) {
    const appid = Number(it?.appid ?? it?.app_id);
    if (!Number.isFinite(appid) || appid <= 0) continue;
    parsed.push({ appid, name: String(it?.name ?? '').trim() });
  }
  if (!parsed.length) {
    logger?.warn('steam.wishlist_empty_or_shape', {
      steamId,
      snippet: String(res?.body ?? '').slice(0, 200),
    });
  }
  return parsed;
}
