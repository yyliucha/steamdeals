// CO-5/B4-2 第七轮（docs/DESIGN-AUDIT.md B4）：site 域 repository——站点信息
// （/api/site）与 Steam 账号管理（/api/steam/*）的专属 SQL。三个函数从 src/store/pg.js
// 巨石搬来（函数签名与拆分前完全一致），其余是本域路由体里内联 SQL 抽出的新函数。
//
// 归属判定（判据：只有本域路由用 → 抽走；跨域/其它域也用 → 留 pg.js）：
//   · setDefaultSteamAccount / clearDefaultSteamIfMatches / userLibraryItems 只被本域路由
//     （/api/steam/accounts/:id 的 default/PATCH/DELETE、library/wishlist 弹窗）使用 →
//     搬家（第六轮 me 域拆分时因「非本域」留 pg.js，本轮按 §15.5 第 4 步搬入）；
//   · steam_accounts / steam_games / steam_wishlist 表 DDL 在 src/steam-login.js
//     （ensureSteamSchemaOnce，跨模块共用：server.js 中间件、CLI、测试都调用），不在 pg.js，
//     本文件不搬家；
//   · steam-accounts.js（listUserAccounts/syncAccountLibrary/unbindAccount 等）是跨域模块
//     （CLI 与 admin 段 B4 #16 也用），整模块原地不动；
//   · 后台愿望单清单（/api/admin/wishlists，B4 #16）与用户删除审计里对 steam_accounts 的
//     SQL 留 pg.js/server.js，非本域。
//
// 拆分约定（见 docs/ARCHITECTURE.md「域路由拆分模式」）：
//   · 域 SQL 落 src/store/<domain>-repository.js；
//   · pg.js 以 `export { … } from './site-repository.js'` re-export——routes/site.js、
//     server.js 其它段与现有测试一律照旧走 pg.js 聚合壳（db.* 签名不变）。
//
// OFFICIAL_KINDS 是跨域通用 SQL 片段（pg.js 内多处使用），从 pg.js import（live binding，
// 循环由 ESM 处理：本文件顶层只声明函数、运行期才取值），不在此重复定义防漂移。
import { OFFICIAL_KINDS } from './pg.js';
// getUserPublic 已随 me 域抽到 me-repository.js（CO-5/B4-2 第六轮）；setDefaultSteamAccount
// 依赖它（返回更新后的本人资料），直接 import 自 me-repository.js（不经 pg.js 壳，减少间接层）。
import { getUserPublic } from './me-repository.js';

// ---------------------------------------------------------------- DQ 批（docs/PROFILE-UI-2026-11-19.md §3）：默认 Steam 账号

/** DQ 批：设为默认 Steam 账号——只写 users.default_steam_id，不再联动头像。 */
export async function setDefaultSteamAccount(q, { userId, steamId }) {
  await q('update users set default_steam_id = $2 where id = $1', [userId, steamId]);
  return getUserPublic(q, userId);
}

/** DQ 批：解绑/删除默认账号后收口——只清 default_steam_id（头像不受影响）。 */
export async function clearDefaultSteamIfMatches(q, { userId, steamId }) {
  await q('update users set default_steam_id = null where id = $1 and default_steam_id = $2', [userId, steamId]);
}

/**
 * 某绑定账号的库 / 愿望单条目（CX §2 #13 弹窗）：搜索（游戏名/英文名/AppID）+ 分页。
 * kind = 'library' | 'wishlist'；只返回本人名下账号（server 层先过所有权检查）。
 */
export async function userLibraryItems(q, { steamId, kind, kw = '', page = 1, pageSize = 10 }) {
  const isWishlist = kind === 'wishlist';
  const like = kw ? `%${kw}%` : null;
  const params = [steamId];
  const cond = ['src.steam_id = $1'];
  if (like) {
    params.push(like);
    params.push(kw);
    cond.push(
      `(coalesce(g.name, src.name) ilike $2 or coalesce(nullif(g.name_en, ''), g.name_en) ilike $2 or cast(src.appid as text) = $3)`,
    );
  }
  const whereSql = 'where ' + cond.join(' and ');
  const src = isWishlist
    ? `steam_wishlist src left join games g on g.steam_appid = src.appid`
    : `steam_games src left join games g on g.steam_appid = src.appid`;
  const total = (await q(`select count(*)::int as n from ${src} ${whereSql}`, params)).rows[0]?.n ?? 0;
  const safePage = Math.max(1, Number.isInteger(page) ? page : 1);
  const safeSize = Math.min(Math.max(Number.isInteger(pageSize) ? pageSize : 10, 1), 500);
  const offset = (safePage - 1) * safeSize;
  params.push(safeSize, offset);
  // steam_wishlist 没有 playtime/last_played 列：愿望单模式下这两列置 null（列形状保持一致）
  const playCols = isWishlist ? 'null as playtime_minutes, null as last_played_at' : 'src.playtime_minutes, src.last_played_at';
  const rows = (
    await q(
      `select src.appid,
              coalesce(g.name, src.name) as name,
              g.name_en,
              ${playCols},
              src.synced_at,
              g.steam_appid is not null as in_db,
              (select min(o.price_cents) from offers o
                 join platforms p on p.code = o.platform_code
                where o.game_id = g.id and o.region = 'cn' and o.in_stock
                  and p.kind in ${OFFICIAL_KINDS}) as current_low,
              (select min(d.min_price_cents) from daily_prices d
                 join platforms p on p.code = d.platform_code
                where d.game_id = g.id and d.region = 'cn'
                  and p.kind in ${OFFICIAL_KINDS}) as hist_low
         from ${src}
        ${whereSql}
        order by ${isWishlist ? 'src.synced_at desc nulls last, src.appid' : 'src.playtime_minutes desc nulls last, src.appid'}
        limit $${params.length - 1} offset $${params.length}`,
      params,
    )
  ).rows;
  return { steamId, kind, items: rows, total: Number(total), page: safePage, pageSize: safeSize };
}

// ---------------------------------------------------------------- AL 批（docs/AUTH-REDESIGN.md §5.3）：注册开关

/**
 * 注册开关设置行（app_settings.auth.registrationEnabled）；不存在返回 null。
 * 开关判定（含 env 兜底 AUTH_REGISTRATION_ENABLED）在路由层——repository 只负责取行。
 */
export async function registrationEnabledRow(q) {
  const r = await q("select value from app_settings where key = 'auth.registrationEnabled'");
  return r.rows[0] ?? null;
}

// ---------------------------------------------------------------- Steam 账号管理路由的内联 SQL 抽函数

/**
 * 账号的 API Key 密文（BE 批：账号级同步一律用该账号自己的 API Key）。
 * 不存在返回 null；解密与错误文案在路由层。
 */
export async function accountApiKeyEnc(q, steamId) {
  const r = await q('select api_key_enc from steam_accounts where steam_id = $1', [steamId]);
  return r.rows[0]?.api_key_enc ?? null;
}

/**
 * 当前登录用户对该账号的所有权检查行：返回账号行（含昵称/归属用户名快照，供审计）。
 * 账号不存在返回 null；归属校验（403）在路由层。
 */
export async function accountOwnerRow(q, steamId) {
  const r = await q(
    'select a.steam_id, a.user_id, a.persona_name, u.username from steam_accounts a left join users u on u.id = a.user_id where a.steam_id = $1',
    [steamId],
  );
  return r.rows[0] ?? null;
}

/** 认领目标行（只取归属与昵称两列）；账号不存在返回 null。 */
export async function claimTargetRow(q, steamId) {
  const r = await q('select user_id, persona_name from steam_accounts where steam_id = $1', [steamId]);
  return r.rows[0] ?? null;
}

/** 认领（迁移）：管理员把未归属账号划到自己名下（user_id 为 null 才写，防竞态）。 */
export async function claimSteamAccount(q, { steamId, userId }) {
  await q('update steam_accounts set user_id = $1, last_login_at = now() where steam_id = $2 and user_id is null', [userId, steamId]);
}

/** 改账号别名（null 清空；长度截断在路由层）。 */
export async function updateSteamAccountAlias(q, { steamId, alias }) {
  await q('update steam_accounts set alias = $1 where steam_id = $2', [alias, steamId]);
}

/** 该账号是否已配置 API Key（PATCH 响应回显用）。 */
export async function steamAccountApiKeySet(q, steamId) {
  const r = await q('select (api_key_enc is not null) as api_key_set from steam_accounts where steam_id = $1', [steamId]);
  return r.rows[0]?.api_key_set ?? false;
}
