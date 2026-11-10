// Steam 多账号绑定与「游戏库 / 愿望单」同步。
//
// 职责边界：本模块只负责「怎么把账号数据落库」（差集删除、愿望单→到价提醒对账、
// 认领、解绑清理），不碰 HTTP 请求；拉取动作由调用方注入（默认用 steam-login.js
// 的实现），测试时注入假 fetch 即可离线验证。
//
// 日志事件（域.动作）：
//   steam.library_synced      单账号库同步完成（总数 / 差集删除数）
//   steam.wishlist_synced     单账号愿望单同步完成（总数 / 差集删除数 / 自动提醒数 / 未命中数 / 对账清理数）
//   steam.account_unbound     解绑（清行数 + 自动提醒对账数）
//   steam.claim / steam.claim_skip  认领与幂等跳过
//   （steam.account_bound / steam.alias_set / sync.steam_accounts_done 由 server.js / cli.js 记录）
import { fetchOwnedGames, fetchWishlist } from './steam-login.js';
import { recordSteamLog } from './steam-log.js';

/**
 * 审计上下文（docs/ADMIN-CONSOLE-IA.md §5，AT 批）：动作落 steam_account_logs。
 * 各写操作函数都接受可选 `log` 参数；不传时按 actor='self' 记录（用户自己操作的场景）。
 * 写入吞异常——审计失败不能影响绑定/同步主流程。
 */
function logCtx(log) {
  const l = log || {};
  return {
    actor: String(l.actor ?? 'self').slice(0, 200),
    username: l.username != null ? String(l.username).slice(0, 200) : null,
    userId: l.userId != null ? Number(l.userId) : null,
    personaName: l.personaName != null ? String(l.personaName).slice(0, 200) : null,
  };
}

/** 把拉到的游戏行写进 steam_games（upsert），并做差集删除：账号移出库的游戏必须消失。 */
export async function syncAccountLibrary(q, { steamId, apiKey, fetchImpl = null, logger = null, log = null }) {
  const ctx = logCtx(log);
  const started = Date.now();
  try {
    const games = await (fetchImpl ?? fetchOwnedGames)({ apiKey, steamId, logger });
    for (const g of games) {
      await q(
        'insert into steam_games (steam_id, appid, name, playtime_minutes, last_played_at, synced_at) values ($1,$2,$3,$4,$5,now()) ' +
          'on conflict (steam_id, appid) do update set name = excluded.name, playtime_minutes = excluded.playtime_minutes, last_played_at = excluded.last_played_at, synced_at = now()',
        [steamId, g.appid, g.name ?? null, g.playtimeMinutes ?? 0, g.lastPlayedAt ?? null],
      );
    }
    const appids = [...new Set(games.map((g) => Number(g.appid)).filter((n) => Number.isFinite(n) && n > 0))];
    // 空集合也成立：appid = any('{}') 恒 false → 删掉该账号全部旧行。
    const diff = await q('delete from steam_games where steam_id = $1 and not (appid = any($2::int[]))', [steamId, appids]);
    const deleted = diff.rowCount ?? 0;
    await recordSteamLog(q, {
      action: 'sync-library',
      steamId,
      ...ctx,
      result: 'ok',
      detail: { added: appids.length, removed: deleted, total: appids.length },
      elapsedMs: Date.now() - started,
    });
    logger?.info('steam.library_synced', { steamId, total: appids.length, diffDeleted: deleted });
    return { total: appids.length, deleted };
  } catch (err) {
    await recordSteamLog(q, {
      action: 'sync-library',
      steamId,
      ...ctx,
      result: 'failed',
      detail: { reason: String(err.message).slice(0, 160) },
      elapsedMs: Date.now() - started,
      error: String(err.message),
    });
    throw err;
  }
}

/** 把拉到的愿望单写进 steam_wishlist（upsert + 差集删除），并对账「愿望单→到价提醒」。 */
export async function syncAccountWishlist(q, { steamId, apiKey, userId, fetchImpl = null, logger = null, log = null }) {
  const ctx = logCtx(log);
  const started = Date.now();
  try {
    const items = await (fetchImpl ?? fetchWishlist)({ apiKey, steamId, logger });
    for (const it of items) {
      await q(
        'insert into steam_wishlist (steam_id, appid, name, synced_at) values ($1,$2,$3,now()) ' +
          'on conflict (steam_id, appid) do update set name = excluded.name, synced_at = now()',
        [steamId, it.appid, it.name ?? null],
      );
    }
    const appids = [...new Set(items.map((it) => Number(it.appid)).filter((n) => Number.isFinite(n) && n > 0))];
    const diff = await q('delete from steam_wishlist where steam_id = $1 and not (appid = any($2::int[]))', [steamId, appids]);
    const deleted = diff.rowCount ?? 0;

    // 愿望单 → 自动到价提醒：目标价为空 = 史低提醒；(game_id, region) 已存在时不覆盖（手动优先）。
    // 目录里没有的 appid 自然不进 select，计入 skipped。
    let watches = 0;
    let skipped = 0;
    if (appids.length) {
      const seen = await q('select count(*)::int as n from games g where g.steam_appid = any($1::int[]) and not g.deleted', [appids]);
      const hit = Number(seen.rows[0]?.n ?? 0);
      skipped = appids.length - hit;
      const ins = await q(
        `insert into watchlist (game_id, region, target_cents, note, source)
         select g.id, 'cn', null, 'Steam 愿望单', 'steam_wishlist'
           from games g
          where g.steam_appid = any($1::int[]) and not g.deleted
         on conflict (game_id, region) do nothing`,
        [appids],
      );
      watches = ins.rowCount ?? 0;
    }
    const cleaned = await cleanupAutoWatches(q, userId);
    await recordSteamLog(q, {
      action: 'sync-wishlist',
      steamId,
      ...ctx,
      result: 'ok',
      detail: { added: appids.length, removed: deleted, total: appids.length, watches, catalogMiss: skipped },
      elapsedMs: Date.now() - started,
    });
    logger?.info('steam.wishlist_synced', {
      steamId,
      total: appids.length,
      diffDeleted: deleted,
      watchesAdded: watches,
      catalogMiss: skipped,
      watchesCleaned: cleaned,
    });
    return { total: appids.length, deleted, watches, skipped, cleaned };
  } catch (err) {
    await recordSteamLog(q, {
      action: 'sync-wishlist',
      steamId,
      ...ctx,
      result: 'failed',
      detail: { reason: String(err.message).slice(0, 160) },
      elapsedMs: Date.now() - started,
      error: String(err.message),
    });
    throw err;
  }
}

/**
 * 对账：删掉 source='steam_wishlist' 且「该用户所有账号的愿望单里已没有这个 appid」的自动提醒。
 * 手动设过目标价的提醒（source='manual'）不受影响；另一个账号仍在愿望单里的也保留。
 */
export async function cleanupAutoWatches(q, userId) {
  const r = await q(
    `delete from watchlist w
      using games g
      where w.game_id = g.id and w.source = 'steam_wishlist'
        and not exists (
          select 1 from steam_wishlist sw
            join steam_accounts sa on sa.steam_id = sw.steam_id
           where sa.user_id = $1 and sw.appid = g.steam_appid
        )`,
    [userId],
  );
  return r.rowCount ?? 0;
}

/** 解绑：删库/愿望单/账号行（steam_sessions 已停用不清理），随后对账自动提醒。 */
export async function unbindAccount(q, { steamId, userId, logger = null, log = null }) {
  const ctx = logCtx(log);
  const started = Date.now();
  try {
    const games = await q('delete from steam_games where steam_id = $1', [steamId]);
    const wishlist = await q('delete from steam_wishlist where steam_id = $1', [steamId]);
    const account = await q('delete from steam_accounts where steam_id = $1 and user_id = $2', [steamId, userId]);
    const removedAccount = account.rowCount ?? 0;
    const cleaned = removedAccount > 0 ? await cleanupAutoWatches(q, userId) : 0;
    await recordSteamLog(q, {
      action: 'unbind',
      steamId,
      ...ctx,
      result: 'ok',
      detail: { gamesRemoved: games.rowCount ?? 0, wishlistRemoved: wishlist.rowCount ?? 0, watchesCleaned: cleaned },
      elapsedMs: Date.now() - started,
    });
    logger?.info('steam.account_unbound', {
      steamId,
      userId,
      gamesDeleted: games.rowCount ?? 0,
      wishlistDeleted: wishlist.rowCount ?? 0,
      watchesCleaned: cleaned,
    });
    return { removed: removedAccount, cleaned };
  } catch (err) {
    await recordSteamLog(q, {
      action: 'unbind',
      steamId,
      ...ctx,
      result: 'failed',
      detail: { reason: String(err.message).slice(0, 160) },
      elapsedMs: Date.now() - started,
      error: String(err.message),
    });
    throw err;
  }
}

/** 认领未归属账号：写入当前用户 user_id；幂等（已归属同人不报错）。 */
export async function claimAccount(q, { username, steamId, logger = null, log = null }) {
  const ctx = logCtx(log);
  const started = Date.now();
  try {
    const user = await q('select id, username from users where username = $1', [username]);
    const target = user.rows[0];
    if (!target) throw new Error('没有该用户：' + username);
    const account = await q('select user_id, persona_name from steam_accounts where steam_id = $1', [steamId]);
    const row = account.rows[0];
    if (!row) throw new Error('没有该 Steam 账号：' + steamId);
    if (row.user_id != null && Number(row.user_id) !== Number(target.id)) {
      throw new Error(`该 Steam 账号已归属用户 #${row.user_id}，请先解绑`);
    }
    if (row.user_id != null) {
      logger?.info('steam.claim_skip', { steamId, username, reason: 'already_owned' });
      return { claimed: false, steamId, userId: target.id, personaName: row.persona_name };
    }
    await q('update steam_accounts set user_id = $1, last_login_at = now() where steam_id = $2 and user_id is null', [
      target.id,
      steamId,
    ]);
    await recordSteamLog(q, {
      action: 'claim',
      steamId,
      ...ctx,
      userId: target.id,
      username,
      personaName: row.persona_name,
      result: 'ok',
      elapsedMs: Date.now() - started,
    });
    logger?.info('steam.claim', { steamId, username, userId: target.id });
    return { claimed: true, steamId, userId: target.id, personaName: row.persona_name };
  } catch (err) {
    await recordSteamLog(q, {
      action: 'claim',
      steamId,
      ...ctx,
      result: 'failed',
      detail: { reason: String(err.message).slice(0, 160) },
      elapsedMs: Date.now() - started,
      error: String(err.message),
    });
    throw err;
  }
}

/** 当前用户绑定的账号列表（含游戏数/类型未知数/愿望单数/最近同步/是否已配 API Key；type_unknown 仅日志/诊断用）。 */
export async function listUserAccounts(q, userId) {
  const r = await q(
    `select a.steam_id, a.persona_name, a.alias, a.avatar, a.last_login_at,
            (a.api_key_enc is not null) as api_key_set,
            (select count(*)::int from steam_games g where g.steam_id = a.steam_id) as games,
            (select count(*)::int from steam_games g2 join games g3 on g3.steam_appid = g2.appid
              where g2.steam_id = a.steam_id and g3.app_type is null) as type_unknown,
            (select max(g.synced_at) from steam_games g where g.steam_id = a.steam_id) as library_synced_at,
            (select count(*)::int from steam_wishlist w where w.steam_id = a.steam_id) as wishlist,
            (select max(w.synced_at) from steam_wishlist w where w.steam_id = a.steam_id) as wishlist_synced_at
       from steam_accounts a
      where a.user_id = $1
      order by a.steam_id`,
    [userId],
  );
  return r.rows;
}

/** 未归属账号（迁移认领用）。 */
export async function listUnownedAccounts(q) {
  const r = await q(
    `select a.steam_id, a.persona_name, a.avatar, a.last_login_at,
            (select count(*)::int from steam_games g where g.steam_id = a.steam_id) as games
       from steam_accounts a
      where a.user_id is null
      order by a.steam_id`,
  );
  return r.rows;
}

/** 所有已归属账号（调度器每日批量同步用），含 user_id 便于对账自动提醒、username 作审计快照。 */
export async function listAllBoundAccounts(q) {
  const r = await q(
    'select a.steam_id, a.user_id, a.persona_name, u.username from steam_accounts a left join users u on u.id = a.user_id where a.user_id is not null order by a.steam_id',
  );
  return r.rows;
}

/**
 * 补全账号库中「目录里还没有 app_type」的游戏类型（GetItems 批量，一次 100 个）。
 * GetOwnedGames 本身不带类型字段，类型未知数只能靠目录 app_type 判断；
 * 这里只挑 app_type IS NULL 的 appid 请求，补全后天然收敛（下次同步近乎零请求）。
 * storeItemsFetch 可注入（默认走 adapters/store-browse.js 的 fetchStoreItems），便于离线测试。
 */
export async function backfillOwnedAppTypes(q, { steamId, apiKey, storeItemsFetch = null, logger = null }) {
  const missing = await q(
    `select sg.appid from steam_games sg
       join games g on g.steam_appid = sg.appid
      where sg.steam_id = $1 and g.app_type is null
      order by sg.appid`,
    [steamId],
  );
  const appids = missing.rows.map((r) => Number(r.appid)).filter((n) => Number.isFinite(n) && n > 0);
  if (!appids.length) return { checked: 0, typed: 0, failed: [] };
  const fetchItems = storeItemsFetch ?? (async (ids, opts) => {
    const { fetchStoreItems } = await import('./adapters/store-browse.js');
    return fetchStoreItems(ids, opts);
  });
  let items = [];
  let failed = appids;
  try {
    const res = await fetchItems(appids, { key: apiKey, logger });
    items = res?.items ?? [];
    failed = res?.failed ?? [];
  } catch (err) {
    failed = appids;
    logger?.warn('steam.app_types_failed', { steamId, message: String(err.message).slice(0, 160) });
  }
  let typed = 0;
  for (const item of items) {
    if (!item?.steamAppid || !item?.appType) continue;
    const r = await q('update games set app_type = $1 where steam_appid = $2 and app_type is null', [item.appType, item.steamAppid]);
    typed += r.rowCount ?? 0;
  }
  logger?.info('steam.app_types_backfilled', { steamId, checked: appids.length, typed, failed: failed.length });
  if (failed.length) logger?.warn('steam.app_types_missing', { steamId, count: failed.length, sample: failed.slice(0, 5) });
  return { checked: appids.length, typed, failed };
}

/** 账号库的类型未知数（拥有条目中目录 app_type 为空的个数；仅日志/诊断用）。 */
export async function ownedTypeStats(q, steamId) {
  const r = await q(
    `select count(*) filter (where g.app_type is null)::int as type_unknown
       from steam_games sg
       join games g on g.steam_appid = sg.appid
      where sg.steam_id = $1`,
    [steamId],
  );
  const row = r.rows[0] ?? {};
  return { typeUnknown: Number(row.type_unknown ?? 0) };
}

/**
 * 推送愿望单增删到 Steam（写操作，必须用该账号自己注册的 Web API Key）。
 * 接口是官方未文档化的 IWishlistService/{Add,Remove}ToWishlist：
 * 以 key + steamid + appid 表单提交，防御式解析——HTTP 2xx 且响应里没有
 * 显式 success:false / response.success:false 就算成功；上线后由每日同步对账兜底。
 */
export async function pushWishlistItem({ steamId, apiKey, appid, action = 'add', fetchImpl = null, logger = null }) {
  const isAdd = action !== 'remove';
  const name = isAdd ? 'AddToWishlist' : 'RemoveFromWishlist';
  const url = `https://api.steampowered.com/IWishlistService/${name}/v1/`;
  const params = new URLSearchParams({ key: String(apiKey ?? ''), steamid: String(steamId), appid: String(appid) });
  const eventOk = `adapter.steam.wishlist_${isAdd ? 'add' : 'remove'}_ok`;
  const eventFail = `adapter.steam.wishlist_${isAdd ? 'add' : 'remove'}_failed`;
  const send = fetchImpl ?? (async () => {
    const { fetchJson } = await import('./http.js');
    return fetchJson(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      timeoutMs: 20000,
      retries: 1,
      logger,
    });
  });
  try {
    const res = await send();
    const data = res?.json ?? res ?? {};
    const explicitFail = data?.success === false || data?.response?.success === false;
    const status = Number(res?.status ?? 200);
    if (status < 400 && !explicitFail) {
      logger?.info(eventOk, { steamId, appid, status });
      return { ok: true };
    }
    const reason = explicitFail ? 'Steam 返回 success:false' : `HTTP ${status}`;
    logger?.warn(eventFail, { steamId, appid, status, reason, snippet: String(res?.body ?? '').slice(0, 160) });
    return { ok: false, reason };
  } catch (err) {
    const reason = String(err.message).slice(0, 160);
    logger?.warn(eventFail, { steamId, appid, reason });
    return { ok: false, reason };
  }
}

/**
 * 站点内手动愿望单（BE 批 docs/WISHLIST-SITE-ONLY.md §4.1）：只写本站 + 建「愿望单」自动到价提醒。
 * steamIds 参数保留仅为旧调用方兼容，**忽略不写、不推送**（列继续存在，新写入统一 '{}'）。
 */
export async function addUserWishlist(q, { userId, gameId }) {
  await q(
    "insert into user_wishlist (user_id, game_id, steam_ids) values ($1, $2, '{}') " +
      'on conflict (user_id, game_id) do nothing',
    [userId, gameId],
  );
  await q(
    "insert into watchlist (game_id, region, target_cents, note, source) values ($1, 'cn', null, '愿望单', 'user_wishlist') " +
      'on conflict (game_id, region) do nothing',
    [gameId],
  );
}

/**
 * 移除站点手动愿望单：删 user_wishlist 行（返回当时选择推送的账号）并清理自动提醒；
 * 用户手动设过目标价的提醒（source 已翻转为 manual）保留。
 */
export async function removeUserWishlist(q, { userId, gameId }) {
  const r = await q('delete from user_wishlist where user_id = $1 and game_id = $2 returning steam_ids', [userId, gameId]);
  const steamIds = r.rows[0]?.steam_ids ?? [];
  // BE 批（docs/WISHLIST-SITE-ONLY.md §4.1）：其他人还收藏同一游戏时，别把全局自动提醒清掉
  const left = await q('select 1 from user_wishlist where game_id = $1 limit 1', [gameId]);
  let watchesCleaned = 0;
  if (!left.rows.length) {
    const watch = await q(
      "delete from watchlist where game_id = $1 and region = 'cn' and source = 'user_wishlist' and target_cents is null",
      [gameId],
    );
    watchesCleaned = watch.rowCount ?? 0;
  }
  return { removed: r.rowCount ?? 0, steamIds, watchesCleaned };
}

/** 该用户所有账号里愿望单含此 appid 的账号（移除时回推删除用）。 */
export async function accountsWithWishlistAppid(q, { userId, appid }) {
  const r = await q(
    `select a.steam_id from steam_accounts a
      where a.user_id = $1
        and exists (select 1 from steam_wishlist sw where sw.steam_id = a.steam_id and sw.appid = $2)`,
    [userId, appid],
  );
  return r.rows.map((row) => row.steam_id);
}

/** 写入/清空账号自配 API Key（密文由调用方加密；null 清空）。 */
export async function setAccountApiKey(q, { steamId, apiKeyEnc, log = null }) {
  const ctx = logCtx(log);
  const started = Date.now();
  try {
    await q('update steam_accounts set api_key_enc = $1 where steam_id = $2', [apiKeyEnc ?? null, steamId]);
    await recordSteamLog(q, {
      action: 'api-key',
      steamId,
      ...ctx,
      result: 'ok',
      detail: { set: apiKeyEnc != null },
      elapsedMs: Date.now() - started,
    });
  } catch (err) {
    await recordSteamLog(q, {
      action: 'api-key',
      steamId,
      ...ctx,
      result: 'failed',
      detail: { reason: String(err.message).slice(0, 160) },
      elapsedMs: Date.now() - started,
      error: String(err.message),
    });
    throw err;
  }
}

/** 后台愿望单清单（BE 批 §4.2）：用户 / 游戏 / 当前价 / 史低 / 加入时间。 */
export async function listWishlists(q, { limit = 200, keyword = '', userId = null } = {}) {
  const kw = String(keyword ?? '').trim().slice(0, 80);
  const params = [];
  const where = [];
  if (userId != null) {
    params.push(Number(userId));
    where.push(`uw.user_id = $${params.length}`);
  }
  if (kw) {
    params.push(`%${kw}%`);
    const like = `$${params.length}`;
    params.push(kw);
    const exact = `$${params.length}`;
    where.push(`(u.username ilike ${like} or g.name ilike ${like} or g.name_en ilike ${like} or cast(g.steam_appid as text) = ${exact})`);
  }
  const size = Math.min(Math.max(Number(limit) || 200, 1), 500);
  params.push(size);
  const rows = (await q(
    `select uw.id, uw.user_id, uw.game_id, uw.created_at,
            u.username, g.name, g.name_en, g.steam_appid,
            rs.price_cents as current_low, rs.hist_low_cents as hist_low
       from user_wishlist uw
       join users u on u.id = uw.user_id
       join games g on g.id = uw.game_id
       left join game_region_snapshot rs on rs.game_id = uw.game_id and rs.region = 'cn'
      ${where.length ? 'where ' + where.join(' and ') : ''}
      order by uw.created_at desc
      limit $${params.length}`,
    params,
  )).rows;
  return { items: rows, total: rows.length };
}

/**
 * 后台删除愿望单（单条 + 批量共用）：删 user_wishlist 行；若该游戏已无任何用户收藏，
 * 清掉全局自动提醒（watchlist source=user_wishlist / target 为空 / cn）——保留用户手动设过的目标价。
 */
export async function deleteWishlistsByIds(q, ids) {
  const list = [...new Set((ids ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!list.length) return { deleted: [], gameIds: [], watchesCleaned: 0 };
  const rows = (await q('delete from user_wishlist where id = any($1::bigint[]) returning id, user_id, game_id', [list])).rows;
  const gameIds = [...new Set(rows.map((r) => Number(r.game_id)))];
  let watchesCleaned = 0;
  if (gameIds.length) {
    const cleaned = await q(
      `delete from watchlist w
        where w.source = 'user_wishlist' and w.target_cents is null and w.region = 'cn'
          and w.game_id = any($1::bigint[])
          and not exists (select 1 from user_wishlist uw where uw.game_id = w.game_id)`,
      [gameIds],
    );
    watchesCleaned = cleaned.rowCount ?? 0;
  }
  return { deleted: rows, gameIds, watchesCleaned };
}