// CO-5/B4-2 第六轮（docs/DESIGN-AUDIT.md B4）：me 域 repository——当前用户资料/偏好/
// 头像/游戏库统计的专属 SQL，从 src/store/pg.js 巨石抽出（函数签名与拆分前完全一致），
// 另含两个从 server.js 域内联 SQL 抽出的新函数（此前路由体直接写 SQL 字面量）。
//
// 归属判定（判据：只有本域路由用 → 抽走；跨域/其它域也用 → 留 pg.js）：
//   · getUserPublic / updateUserProfile / avatarOfUser / setUserAvatar / clearUserAvatar /
//     userLibraryStats / getPrefs / savePrefs（含 PREF_TABS/PREF_SORTS/normalizePrefs 三个
//     helper）只被本域路由（/api/me*、/api/prefs、/api/avatar/:id）使用 → 搬家；
//   · setDefaultSteamAccount / clearDefaultSteamIfMatches 留在 pg.js——被 steam accounts 域
//     路由（/api/steam/accounts/:id 解绑 / default，B4 #7）使用，非本域；
//   · userLibraryItems 留在 pg.js——被 steam accounts 域库/愿望单弹窗（B4 #7）使用；
//   · user_prefs 表 DDL 留在 pg.js——watchCandidates（alerts 引擎，pg.js 内）也 left join
//     该表，属跨域共用表（watchlist/announcements/auth 先例：无 DDL 搬家）。
//
// 拆分约定（见 docs/ARCHITECTURE.md「域路由拆分模式」）：
//   · 域 SQL 落 src/store/<domain>-repository.js；
//   · pg.js 以 `export { … } from './me-repository.js'` re-export——routes/me.js、
//     server.js 其它段与现有测试（test/game-search-filter.test.js 的 getPrefs/savePrefs 等）
//     一律照旧走 pg.js 聚合壳（db.* 签名不变）。
//
// OFFICIAL_KINDS 是跨域通用 SQL 片段（pg.js 内多处使用），从 pg.js import（live binding，
// 循环由 ESM 处理：本文件顶层只声明函数、运行期才取值），不在此重复定义防漂移。
import { OFFICIAL_KINDS } from './pg.js';

// ---------------------------------------------------------------- CX 批（docs/USER-PROFILE-EDIT.md §3）：个人资料

/**
 * 本人资料完整视图（不含 avatar_bytes 原图；头像走 GET /api/avatar/:userId）。
 * 本批只对本人调用——「我的资料」无他人入口，管理员同样只能看自己。
 */
export async function getUserPublic(q, userId) {
  const r = await q(
    `select id, username, display_name, email, email_verified, role, created_at,
            bio, avatar_source, avatar_mime, avatar_updated_at, default_steam_id
       from users where id = $1`,
    [userId],
  );
  return r.rows[0] ?? null;
}

/** 保存本人资料（昵称 / 简介）；只改传入的字段（undefined 保持现值）。校验在 server 层。 */
export async function updateUserProfile(q, { userId, displayName = undefined, bio = undefined }) {
  const sets = [];
  const params = [];
  if (displayName !== undefined) {
    params.push(displayName);
    sets.push(`display_name = $${params.length}`);
  }
  if (bio !== undefined) {
    params.push(bio);
    sets.push(`bio = $${params.length}`);
  }
  if (sets.length) {
    params.push(userId);
    await q(`update users set ${sets.join(', ')} where id = $${params.length}`, params);
  }
  return getUserPublic(q, userId);
}

/** 头像行（自定义上传时含 bytes；DQ 起 source 只可能是 null / 'custom'，null 时前端回退首字）。 */
export async function avatarOfUser(q, userId) {
  const r = await q(
    'select id, avatar_bytes, avatar_mime, avatar_source, avatar_updated_at from users where id = $1',
    [userId],
  );
  return r.rows[0] ?? null;
}

/** 存自定义头像（客户端已裁剪 256×256；bytes 为 Buffer，mime 白名单在 server 层校验）。 */
export async function setUserAvatar(q, { userId, bytes, mime }) {
  await q(
    'update users set avatar_bytes = $2, avatar_mime = $3, avatar_source = $4, avatar_updated_at = now() where id = $1',
    [userId, bytes, mime, 'custom'],
  );
  return avatarOfUser(q, userId);
}

/** 移除自定义头像：清空 bytes/mime/source（前端回退首字/Steam 默认选择器可重新选）。 */
export async function clearUserAvatar(q, userId) {
  await q(
    'update users set avatar_bytes = null, avatar_mime = null, avatar_source = null, avatar_updated_at = now() where id = $1',
    [userId],
  );
  return avatarOfUser(q, userId);
}

/**
 * 我的游戏库与统计（CX §2 #12/#14）：每账号一卡数据由 listUserAccounts 提供（steam-accounts.js），
 * 这里只算 5 项汇总：已拥有合计 / 愿望单合计 / 本站愿望单 / 到价提醒 / 史低命中。
 * 史低命中口径与 alerts.evaluateAlerts 的 HIST_LOW 一致：当前在售最低价 ≤ 史低（官方渠道）。
 */
export async function userLibraryStats(q, userId) {
  const row = (
    await q(
      `select
         (select coalesce(sum(n), 0)::int from
            (select count(*)::int as n from steam_games g join steam_accounts a on a.steam_id = g.steam_id
              where a.user_id = $1 group by g.steam_id) x) as owned_total,
         (select coalesce(sum(n), 0)::int from
            (select count(*)::int as n from steam_wishlist w join steam_accounts a on a.steam_id = w.steam_id
              where a.user_id = $1 group by w.steam_id) x) as wishlist_total,
         (select count(*)::int from user_wishlist where user_id = $1) as site_wishlist,
         (select count(*)::int from watchlist where user_id = $1 and region = 'cn') as alerts,
         (select count(*)::int from watchlist w
            join games g on g.id = w.game_id
           where w.user_id = $1 and w.region = 'cn' and not g.deleted
             and (select min(o.price_cents) from offers o
                    join platforms p on p.code = o.platform_code
                   where o.game_id = g.id and o.region = 'cn' and o.in_stock
                     and p.kind in ${OFFICIAL_KINDS}) is not null
             and (select min(o.price_cents) from offers o
                    join platforms p on p.code = o.platform_code
                   where o.game_id = g.id and o.region = 'cn' and o.in_stock
                     and p.kind in ${OFFICIAL_KINDS})
                 <= (select min(d.min_price_cents) from daily_prices d
                      join platforms p on p.code = d.platform_code
                     where d.game_id = g.id and d.region = 'cn'
                       and p.kind in ${OFFICIAL_KINDS})) as hist_low_hits`,
      [userId],
    )
  ).rows[0];
  return {
    ownedTotal: Number(row?.owned_total ?? 0),
    wishlistTotal: Number(row?.wishlist_total ?? 0),
    siteWishlist: Number(row?.site_wishlist ?? 0),
    alerts: Number(row?.alerts ?? 0),
    histLowHits: Number(row?.hist_low_hits ?? 0),
  };
}

// ---------------------------------------------------------------- 用户偏好

export const PREF_TABS = ['all', 'on', 'off', 'owned', 'wishlist'];
export const PREF_SORTS = ['discount', 'price', 'name'];

/** 页签/排序的合法值归一化，非法值回落默认。 */
export function normalizePrefs(prefs = {}) {
  const tab = PREF_TABS.includes(String(prefs.tab ?? '')) ? String(prefs.tab) : 'all';
  const sort = PREF_SORTS.includes(String(prefs.sort ?? '')) ? String(prefs.sort) : 'discount';
  return { tab, sort };
}

export async function getPrefs(q, userId) {
  const r = await q('select hide_uninterested, sort, tab, theme, email_alerts from user_prefs where user_id = $1', [userId]);
  const row = r.rows[0];
  if (!row) return { hide_uninterested: false, sort: 'discount', tab: 'all', theme: null, email_alerts: true };
  const { tab, sort } = normalizePrefs({ tab: row.tab, sort: row.sort });
  return { hide_uninterested: row.hide_uninterested === true, sort, tab, theme: row.theme ?? null, email_alerts: row.email_alerts === true };
}

export async function savePrefs(q, userId, prefs = {}) {
  // 缺省字段沿用现值，避免「只改主题」把页签/排序重置成默认
  const existing = await getPrefs(q, userId);
  const tab = prefs.tab === undefined ? existing.tab : normalizePrefs(prefs).tab;
  const sort = prefs.sort === undefined ? existing.sort : normalizePrefs(prefs).sort;
  // theme：'light'/'dark' 显式选择；null 显式回到「跟随系统」；缺省保持
  const theme = prefs.theme === 'light' || prefs.theme === 'dark' ? prefs.theme : prefs.theme === null ? null : existing.theme;
  // CX 批：到价提醒邮件开关（缺省保持现值）
  const emailAlerts = prefs.email_alerts === undefined ? existing.email_alerts : Boolean(prefs.email_alerts);
  await q(
    `insert into user_prefs (user_id, hide_uninterested, sort, tab, theme, email_alerts) values ($1, $2, $3, $4, $5, $6)
     on conflict (user_id) do update set
       hide_uninterested = excluded.hide_uninterested,
       sort = excluded.sort,
       tab = excluded.tab,
       theme = excluded.theme,
       email_alerts = excluded.email_alerts`,
    // hide_uninterested 是旧字段：tab=on 等价于"隐藏不感兴趣"，保留兼容老客户端
    [userId, tab === 'on', sort, tab, theme, emailAlerts],
  );
  return getPrefs(q, userId);
}

// ---------------------------------------------------------------- 域内联 SQL 抽出的新函数（B4-2 第六轮）

/** 已绑定 Steam 账号数（/api/me 的 steamBound 口径：>0 即 true；App「已拥有」chip 显隐依据）。 */
export async function countBoundSteamAccounts(q, userId) {
  const r = await q('select count(*)::int as n from steam_accounts where user_id = $1', [userId]);
  return Number(r.rows[0]?.n ?? 0);
}

/** 某 Steam 账号的绑定时间（steam_account_logs 最早一条 action='bind'），无记录 null。 */
export async function boundAtOfSteamAccount(q, steamId) {
  const r = await q(
    "select min(created_at) as bound_at from steam_account_logs where action = 'bind' and steam_id = $1",
    [steamId],
  );
  return r.rows[0]?.bound_at ?? null;
}
