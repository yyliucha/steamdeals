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

/** 把拉到的游戏行写进 steam_games（upsert），并做差集删除：账号移出库的游戏必须消失。 */
export async function syncAccountLibrary(q, { steamId, apiKey, fetchImpl = null, logger = null }) {
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
  logger?.info('steam.library_synced', { steamId, total: appids.length, diffDeleted: deleted });
  return { total: appids.length, deleted };
}

/** 把拉到的愿望单写进 steam_wishlist（upsert + 差集删除），并对账「愿望单→到价提醒」。 */
export async function syncAccountWishlist(q, { steamId, apiKey, userId, fetchImpl = null, logger = null }) {
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
  logger?.info('steam.wishlist_synced', {
    steamId,
    total: appids.length,
    diffDeleted: deleted,
    watchesAdded: watches,
    catalogMiss: skipped,
    watchesCleaned: cleaned,
  });
  return { total: appids.length, deleted, watches, skipped, cleaned };
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
export async function unbindAccount(q, { steamId, userId, logger = null }) {
  const games = await q('delete from steam_games where steam_id = $1', [steamId]);
  const wishlist = await q('delete from steam_wishlist where steam_id = $1', [steamId]);
  const account = await q('delete from steam_accounts where steam_id = $1 and user_id = $2', [steamId, userId]);
  const removedAccount = account.rowCount ?? 0;
  const cleaned = removedAccount > 0 ? await cleanupAutoWatches(q, userId) : 0;
  logger?.info('steam.account_unbound', {
    steamId,
    userId,
    gamesDeleted: games.rowCount ?? 0,
    wishlistDeleted: wishlist.rowCount ?? 0,
    watchesCleaned: cleaned,
  });
  return { removed: removedAccount, cleaned };
}

/** 认领未归属账号：写入当前用户 user_id；幂等（已归属同人不报错）。 */
export async function claimAccount(q, { username, steamId, logger = null }) {
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
  logger?.info('steam.claim', { steamId, username, userId: target.id });
  return { claimed: true, steamId, userId: target.id, personaName: row.persona_name };
}

/** 当前用户绑定的账号列表（含游戏数/愿望单数/最近同步）。 */
export async function listUserAccounts(q, userId) {
  const r = await q(
    `select a.steam_id, a.persona_name, a.alias, a.avatar, a.last_login_at,
            (select count(*)::int from steam_games g where g.steam_id = a.steam_id) as games,
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

/** 所有已归属账号（调度器每日批量同步用），含 user_id 便于对账自动提醒。 */
export async function listAllBoundAccounts(q) {
  const r = await q(
    'select a.steam_id, a.user_id, a.persona_name from steam_accounts a where a.user_id is not null order by a.steam_id',
  );
  return r.rows;
}
