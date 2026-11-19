// CO-5/B4-2 第三轮（docs/DESIGN-AUDIT.md B4）：认证域 repository——Web 登录 / 改密 / Steam 绑定
// 的专属 SQL，从 src/server.js 巨石的内联 SQL 抽出（本轮不涉及 pg.js 现有函数搬家）。
// 归属判定：只含「仅认证域路由使用」的 SQL；跨域共享的通用 SQL 留在 pg.js——
//   · findUserByName / verifyPassword / hashPassword / passwordNeedsRehash（App token 登录、
//     setup 建号、后台用户管理也共用）、createSession / deleteSession / userBySession /
//     deleteSessionsOfUser 等会话函数（setup-routes、auth-routes、后台会话管理也共用）、
//     insertDeviceLog（后台设备列表也共用）都留 pg.js；
//   · steam_accounts 表 DDL 在 steam-login.js（ensureSteamSchema），同步/解绑 SQL 在
//     steam-accounts.js——本文件只放「绑定流程」的三条 SQL（绑定是认证域的入口动作）。
//
// 拆分约定（见 docs/ARCHITECTURE.md「域路由拆分模式」）：
//   · 域 SQL 落 src/store/<domain>-repository.js；
//   · pg.js 以 `export { … } from './auth-repository.js'` re-export——routes/auth.js 与
//     现有 import 一律照旧走 pg.js 聚合壳，后续域拆完 pg.js 只剩聚合壳与通用 SQL。

// AK-2（docs/AUTH-REDESIGN.md §4.3/§4.4）：登录失败计数 +1 并返回新计数；
// 由调用方在 ≥5 时决定锁定（锁 15 分钟）。
export async function bumpLoginFailCount(q, userId) {
  const r = await q('update users set failed_login_count = failed_login_count + 1 where id = $1 returning failed_login_count', [
    userId,
  ]);
  return Number(r.rows[0]?.failed_login_count ?? 0);
}

/** 账号锁定 15 分钟，返回 locked_until（供 429 响应与日志）。 */
export async function lockUserAccount(q, userId) {
  const r = await q("update users set locked_until = now() + interval '15 minutes' where id = $1 returning locked_until", [
    userId,
  ]);
  return r.rows[0]?.locked_until ?? null;
}

/** 登录成功：清零失败计数与锁定（验收 3「成功一次清零」）。 */
export async function resetLoginFailState(q, userId) {
  await q('update users set failed_login_count = 0, locked_until = null where id = $1', [userId]);
}

/** AK-1：旧哈希静默升级（passwordNeedsRehash 命中时调用），不强制改密。 */
export async function rehashUserPassword(q, userId, newHash) {
  await q('update users set password_hash = $1, password_updated_at = now() where id = $2', [newHash, userId]);
}

/** 弱密码评估落库（登录时评估，不强制改密）。 */
export async function setUserWeakPassword(q, userId, weak) {
  await q('update users set weak_password = $1 where id = $2', [Boolean(weak), userId]);
}

/** 改密前的旧密码哈希读取；查不到返回 null（调用方回 400 当前密码不正确）。 */
export async function userPasswordHash(q, userId) {
  const r = await q('select password_hash from users where id = $1', [userId]);
  return r.rows[0] ?? null;
}

/** AK-3（docs/AUTH-REDESIGN.md §4.7）：改密落库——同时解除弱密码标记与强制改密。 */
export async function changeUserPassword(q, userId, newHash) {
  await q(
    'update users set password_hash = $1, weak_password = false, must_change_password = false, password_updated_at = now() where id = $2',
    [newHash, userId],
  );
}

/** CX 批：steam_id 当前归属（绑定唯一性校验）；无人认领返回 null。 */
export async function steamAccountOwnerId(q, steamId) {
  const r = await q('select user_id from steam_accounts where steam_id = $1', [steamId]);
  return r.rows[0]?.user_id ?? null;
}

/** CX 批：该用户已绑定账号数（上限 MAX_ACCOUNTS_PER_USER = 5，见 routes/auth.js）。 */
export async function countUserSteamAccounts(q, userId) {
  const r = await q('select count(*)::int as n from steam_accounts where user_id = $1', [userId]);
  return Number(r.rows[0]?.n ?? 0);
}

/** CX 批：绑定落库（已绑定同人 = 幂等，只刷新昵称/头像与 last_login_at，不改 user_id）。 */
export async function upsertSteamAccount(q, { steamId, personaName, avatar, userId }) {
  await q(
    "insert into steam_accounts (steam_id, persona_name, avatar, user_id, last_login_at) values ($1, $2, $3, $4, now()) " +
      'on conflict (steam_id) do update set persona_name = coalesce(excluded.persona_name, steam_accounts.persona_name), ' +
      'avatar = coalesce(excluded.avatar, steam_accounts.avatar), last_login_at = now()',
    [steamId, personaName, avatar, userId],
  );
}
