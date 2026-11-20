// CO-5/B4-2 第十六轮（docs/DESIGN-AUDIT.md B4）：admin-users 域专属 SQL。
//
// 本文件只含 B4 #11「admin 用户批量」域（/api/admin/users*、/api/admin/bulk、
// /api/admin/bulk-ops + DT-4 后台重置密码发码）专属的数据访问函数（签名与拆分前一致）；
// pg.js 顶部 re-export 保持旧 db.* 导入签名不变（routes/admin-users.js、server.js 其它段
// 与现有测试照旧走聚合壳）。跨域共用的通用 SQL（listUsers——cli.js 共用、setUserPassword——
// auth-routes.js 共用、writeAuditLog——admin-access 域审计共用、deleteSessionsOfUser——
// 前台 revoke-others/auth 域/kickAll 禁用踢会话共用、bulkSetFreeStatus——steam-status 共用）
// 留 pg.js。users/admin_bulk_ops 等表 DDL 在 pg.js SCHEMA（跨模块共用），不搬家。

import { recordSteamLog } from '../steam-log.js';

/** 批量操作的 id 列表规范化（类型收敛：非数字/非正整数的过滤掉，不去重）。 */
function asIdList(list) {
  return (Array.isArray(list) ? list : [])
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0);
}
/** 批量操作的文本列表规范化（去空，不去重）。 */
function asTextList(list) {
  return (Array.isArray(list) ? list : []).map((v) => String(v)).filter(Boolean);
}

// ---------------------------------------------------------------- users 域内联 SQL 新函数

/** kickAll 踢全部会话的目标行（用户名 → id）。 */
export async function userSessionKickTarget(q, username) {
  const r = await q('select id, username from users where username = $1', [username]);
  return r.rows[0] ?? null;
}

/** 发码/重置密码的目标行（id + username + email）。 */
export async function userEmailTarget(q, username) {
  const r = await q('select id, username, email from users where username = $1', [username]);
  return r.rows[0] ?? null;
}

/** 校验码/重置密码的目标行（id + email）。 */
export async function userEmailIdRow(q, username) {
  const r = await q('select id, email from users where username = $1', [username]);
  return r.rows[0] ?? null;
}

/** 编辑/删除/绑邮箱前的用户状态行（多取列不影响响应，供各入口复用）。 */
export async function userStateRow(q, username) {
  const r = await q('select email, email_verified, display_name, role, disabled from users where username = $1', [username]);
  return r.rows[0] ?? null;
}

/** steam-accounts 只读展示的目标行（用户名 → id）。 */
export async function userIdRow(q, username) {
  const r = await q('select id from users where username = $1', [username]);
  return r.rows[0] ?? null;
}

/** 插入一条后台验证码（purpose 白名单 bind/admin_reset、expiresMinutes 白名单 5/10，均来自代码常量），返回 id。 */
export async function insertAdminEmailCode(q, { email, userId, purpose, codeHash, subject, body, expiresMinutes }) {
  const r = await q(
    "insert into email_codes (email, user_id, purpose, code_hash, subject, body, expires_at) " +
      `values ($1, $2, $3, $4, $5, $6, now() + interval '${expiresMinutes} minutes') returning id`,
    [email, userId, purpose, codeHash, subject, body],
  );
  return r.rows[0].id;
}

/** 最近一条可用验证码（按 purpose 过滤，倒序取最新）。 */
export async function pendingEmailCode(q, { email, purpose }) {
  const r = await q(
    "select id, code_hash, attempts, expires_at from email_codes where email = $1 and purpose = $2 and used_at is null order by created_at desc limit 1",
    [email, purpose],
  );
  return r.rows[0] ?? null;
}

/** 验证码尝试次数 +1（错误路径）。 */
export async function bumpEmailCodeAttempts(q, id) {
  await q('update email_codes set attempts = attempts + 1 where id = $1', [id]);
}

/** 验证码消费（used_at = now）。 */
export async function consumeEmailCode(q, id) {
  await q('update email_codes set used_at = now() where id = $1', [id]);
}

/** 邮箱验证通过（email_verified = true）。 */
export async function markEmailVerified(q, userId) {
  await q('update users set email_verified = true where id = $1', [userId]);
}

/** 管理员重置密码发码的冷却记录（同邮箱同 purpose 最近 N 条）。 */
export async function recentEmailCodes(q, { email, purpose, limit = 20 }) {
  const r = await q(
    'select created_at, sent_ok from email_codes where email = $1 and purpose = $2 order by created_at desc limit $3',
    [email, purpose, limit],
  );
  return r.rows;
}

/** 管理员绑定邮箱（email_verified 重置为 false）。 */
export async function adminBindEmail(q, { email, username }) {
  return q(
    'update users set email = $1, email_verified = false where username = $2 returning id, username, email, role, disabled',
    [email, username],
  );
}

/** 旧库缺列兜底：补建 email / email_verified 后重试一次。 */
export async function ensureUsersEmailColumns(q) {
  await q('alter table users add column if not exists email text');
  await q('alter table users add column if not exists email_verified boolean not null default false');
}

// ---------------------------------------------------------------- users 域既有函数搬家（签名照抄）

/** 管理员解锁（AK-2，docs/AUTH-REDESIGN.md §4.4）：清零失败计数与锁定。 */
export async function unlockUser(q, { username }) {
  const r = await q(
    'update users set failed_login_count = 0, locked_until = null where username = $1 returning id, username, failed_login_count, locked_until',
    [username],
  );
  return r.rows[0] ?? null;
}

/** 编辑用户：显示名、角色、启用状态。 */
export async function updateUser(q, { username, displayName = undefined, role = undefined, disabled = undefined }) {
  const sets = [];
  const params = [];
  if (displayName !== undefined) {
    params.push(displayName);
    sets.push(`display_name = $${params.length}`);
  }
  if (role !== undefined) {
    params.push(role);
    sets.push(`role = $${params.length}`);
  }
  if (disabled !== undefined) {
    params.push(Boolean(disabled));
    sets.push(`disabled = $${params.length}`);
  }
  if (!sets.length) return null;
  params.push(username);
  const r = await q(
    `update users set ${sets.join(', ')} where username = $${params.length} returning id, username, display_name, role, disabled`,
    params,
  );
  return r.rows[0] ?? null;
}

/**
 * 彻底删除用户（docs/USER-LIFECYCLE.md §4.1，AH 批）：
 * 守卫（不存在 404 / confirmUsername 不符 400 / 删自己 400 / 最后一个可用管理员 409）→
 * 单事务：先手动清 steam_games / steam_wishlist（无外键，防孤儿行）→ 删 users（其余表级联/置空，
 * 会话立即失效）→ 落 admin_user_deletions 审计（邮箱打码、只存计数与操作者快照）。
 * 成功返回 { ok: true, deleted: { username, steamAccounts, sessions } }；守卫失败返回 { ok: false, status, error }。
 */
export async function deleteUserAudited(q, { username, confirmUsername = null, operator = null, operatorId = null, reason = null }) {
  const target = (await q('select id, username, email, role, disabled from users where username = $1', [username])).rows[0];
  if (!target) return { ok: false, status: 404, error: '没有该用户' };
  if (confirmUsername !== username) return { ok: false, status: 400, error: '请输入完整用户名确认' };
  if (operator === username) return { ok: false, status: 400, error: '不能删除自己' };
  if (target.role === 'admin' && !target.disabled) {
    const admins = (await q("select count(*)::int as n from users where role = 'admin' and not disabled")).rows[0]?.n ?? 0;
    if (admins <= 1) return { ok: false, status: 409, error: '不能删除最后一个可用管理员' };
  }
  const counts = (
    await q(
      'select (select count(*)::int from sessions where user_id = $1) as sessions, ' +
        "(select count(*)::int from steam_accounts where user_id = $1) as steam_accounts, " +
        "(select coalesce(array_agg(steam_id), '{}') from steam_accounts where user_id = $1) as steam_ids",
      [target.id],
    )
  ).rows[0];
  const steamAccounts = Number(counts?.steam_accounts ?? 0);
  const sessions = Number(counts?.sessions ?? 0);
  const steamIds = Array.isArray(counts?.steam_ids) ? counts.steam_ids.filter((s) => s != null) : [];
  const mask = (() => {
    const email = String(target.email ?? '').trim();
    const at = email.indexOf('@');
    if (!email || at <= 0) return null;
    const tail = at < email.length - 1 ? email.slice(at) : '';
    return `${email.slice(0, 1)}***${tail}`;
  })();
  await q('begin');
  try {
    if (steamIds.length) {
      await q('delete from steam_games where steam_id = any($1::text[])', [steamIds]);
      await q('delete from steam_wishlist where steam_id = any($1::text[])', [steamIds]);
    }
    await q('delete from users where id = $1', [target.id]);
    await q(
      'insert into admin_user_deletions (username, role, email_masked, steam_accounts, sessions, deleted_by, deleted_by_id, reason) values ($1,$2,$3,$4,$5,$6,$7,$8)',
      [username, target.role, mask, steamAccounts, sessions, operator ?? '', operatorId, reason ? String(reason).slice(0, 500) : null],
    );
    // AT 批（docs/ADMIN-CONSOLE-IA.md §5）：用户被删后其 Steam 日志必须留下——
    // 账号级联删除的同时给每个账号补一条 delete-cascade 审计（不挂外键，删除后仍可查）。
    for (const sid of steamIds) {
      await recordSteamLog(q, {
        action: 'delete-cascade',
        steamId: sid,
        userId: target.id,
        username,
        actor: `admin:${operator ?? ''}`,
        result: 'ok',
        detail: { reason: reason ? String(reason).slice(0, 160) : null },
      });
    }
    await q('commit');
  } catch (err) {
    await q('rollback').catch(() => {});
    throw err;
  }
  return { ok: true, deleted: { username, role: target.role, steamAccounts, sessions } };
}

/** 最近删除审计（docs/USER-LIFECYCLE.md §4.5）：按用户名模糊搜索（大小写不敏感），倒序，limit ≤ 200。 */
export async function listUserDeletions(q, { search = '', limit = 50 } = {}) {
  const cap = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const like = String(search ?? '').trim().slice(0, 80);
  const r = like
    ? await q(
        "select id, username, role, email_masked, steam_accounts, sessions, deleted_by, reason, created_at from admin_user_deletions where username ilike '%' || $1 || '%' order by id desc limit $2",
        [like, cap],
      )
    : await q(
        'select id, username, role, email_masked, steam_accounts, sessions, deleted_by, reason, created_at from admin_user_deletions order by id desc limit $1',
        [cap],
      );
  return r.rows;
}

// ---------------------------------------------------------------- bulk 域既有函数搬家（签名照抄）

/** 批量禁用 / 启用游戏：返回真正改动的 id。 */
export async function bulkSetGamesBlocked(q, { ids = [], blocked }) {
  const list = asIdList(ids);
  if (!list.length) return [];
  const r = await q(
    `update games set blocked = $1, updated_at = now()
      where id = any($2::bigint[]) and blocked is distinct from $1
      returning id`,
    [Boolean(blocked), list],
  );
  return r.rows.map((row) => Number(row.id));
}

/** 批量移入回收站 / 恢复：返回真正改动的 id。 */
export async function bulkSetGamesDeleted(q, { ids = [], deleted }) {
  const list = asIdList(ids);
  if (!list.length) return [];
  const r = await q(
    `update games set deleted = $1,
                      deleted_at = case when $1 then now() else null end,
                      updated_at = now()
      where id = any($2::bigint[]) and deleted is distinct from $1
      returning id`,
    [Boolean(deleted), list],
  );
  return r.rows.map((row) => Number(row.id));
}

/** 批量删除公告：返回真正删掉的 id。 */
export async function bulkDeleteAnnouncements(q, ids = []) {
  const list = asIdList(ids);
  if (!list.length) return [];
  const r = await q('delete from announcements where id = any($1::bigint[]) returning id', [list]);
  return r.rows.map((row) => Number(row.id));
}

/** 批量启用 / 停用公告：返回真正改动的 id。 */
export async function bulkSetAnnouncementsActive(q, { ids = [], active }) {
  const list = asIdList(ids);
  if (!list.length) return [];
  const r = await q(
    `update announcements set active = $1, updated_at = now()
      where id = any($2::bigint[]) and active is distinct from $1
      returning id`,
    [Boolean(active), list],
  );
  return r.rows.map((row) => Number(row.id));
}

/** 审批封 IP / 封设备要逐条拿 ip 与指纹，所以先整批查出来再逐条执行。 */
export async function bulkGetAbuseReviews(q, ids = []) {
  const list = asIdList(ids);
  if (!list.length) return [];
  const r = await q(
    `select id, ip, device_id, fingerprint, rule, status
       from abuse_reviews where id = any($1::bigint[])`,
    [list],
  );
  return r.rows.map((row) => ({ ...row, id: Number(row.id) }));
}

/** 批量忽略待审：只处理 pending，已处理过的返回 skipped。 */
export async function bulkRejectAbuseReviews(q, { ids = [], reviewedBy = null, note = null }) {
  const list = asIdList(ids);
  if (!list.length) return [];
  const r = await q(
    `update abuse_reviews
        set status = 'rejected', reviewed_by = $2, reviewed_at = now(), note = coalesce($3, note)
      where id = any($1::bigint[]) and status = 'pending'
      returning id`,
    [list, reviewedBy, note ? String(note).slice(0, 300) : null],
  );
  return r.rows.map((row) => Number(row.id));
}

/** 批量解封 IP（黑名单）。 */
export async function bulkRemoveBlockedIps(q, ips = []) {
  const list = asTextList(ips);
  if (!list.length) return [];
  const r = await q('delete from ip_blacklist where ip = any($1::text[]) returning ip', [list]);
  return r.rows.map((row) => String(row.ip));
}

/** 批量移出白名单。 */
export async function bulkRemoveWhitelistIps(q, ips = []) {
  const list = asTextList(ips);
  if (!list.length) return [];
  const r = await q('delete from ip_whitelist where ip = any($1::text[]) returning ip', [list]);
  return r.rows.map((row) => String(row.ip));
}

/** 批量解封设备。 */
export async function bulkRemoveDeviceBans(q, fingerprints = []) {
  const list = asTextList(fingerprints).map((f) => f.toLowerCase());
  if (!list.length) return [];
  const r = await q('delete from device_bans where fingerprint = any($1::text[]) returning fingerprint', [list]);
  return r.rows.map((row) => String(row.fingerprint));
}

/** 批量禁用用户需要的守卫数据（自己 / 最后一个可用管理员）。 */
export async function usersForBulk(q, ids = []) {
  const list = asIdList(ids);
  if (!list.length) return [];
  const r = await q('select id, username, role, disabled from users where id = any($1::integer[])', [list]);
  return r.rows.map((row) => ({ ...row, id: Number(row.id) }));
}

/** 排除 excludeIds 之后还剩几个可用管理员（禁用前的守卫计算）。 */
export async function countActiveAdmins(q, { excludeIds = [] } = {}) {
  const list = asIdList(excludeIds);
  const r = await q(
    `select count(*)::int as n from users
      where role = 'admin' and not disabled and not (id = any($1::integer[]))`,
    [list],
  );
  return Number(r.rows[0]?.n ?? 0);
}

/** 批量禁用 / 启用用户：返回真正改动的行。 */
export async function bulkSetUsersDisabled(q, { ids = [], disabled }) {
  const list = asIdList(ids);
  if (!list.length) return [];
  const r = await q(
    `update users set disabled = $1
      where id = any($2::integer[]) and disabled is distinct from $1
      returning id, username`,
    [Boolean(disabled), list],
  );
  return r.rows.map((row) => ({ id: Number(row.id), username: row.username }));
}

/** 禁用后立即踢掉该用户的会话：禁用必须马上生效，不能等 cookie 自己过期。 */
export async function deleteSessionsOfUsers(q, ids = []) {
  const list = asIdList(ids);
  if (!list.length) return 0;
  const r = await q('delete from sessions where user_id = any($1::integer[])', [list]);
  return r.rowCount ?? 0;
}

/** 写一条批量操作审计；keys_sample 最多留 50 个键。 */
export async function createBulkOp(q, {
  actorId = null,
  actor = null,
  target,
  action,
  total = 0,
  ok = 0,
  failed = 0,
  skipped = 0,
  keysSample = [],
  options = null,
  ip = null,
  durationMs = null,
}) {
  const r = await q(
    `insert into admin_bulk_ops (actor_id, actor, target, action, total, ok, failed, skipped, keys_sample, options, ip, duration_ms)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12)
     returning id, created_at`,
    [
      actorId,
      actor,
      String(target),
      String(action),
      Number(total) || 0,
      Number(ok) || 0,
      Number(failed) || 0,
      Number(skipped) || 0,
      JSON.stringify(asTextList(keysSample).slice(0, 50)),
      options ? JSON.stringify(options) : null,
      ip,
      durationMs == null ? null : Math.round(Number(durationMs)),
    ],
  );
  return { id: Number(r.rows[0].id), createdAt: r.rows[0].created_at };
}

export async function listBulkOps(q, { limit = 100, target = null } = {}) {
  const params = [Math.min(Math.max(Number(limit) || 100, 1), 200)];
  let where = '';
  if (target) {
    params.push(String(target));
    where = 'where target = $2';
  }
  const r = await q(
    `select id, created_at, actor, target, action, total, ok, failed, skipped, ip, duration_ms
       from admin_bulk_ops ${where} order by id desc limit $1`,
    params,
  );
  return r.rows.map((row) => ({
    ...row,
    id: Number(row.id),
    total: Number(row.total),
    ok: Number(row.ok),
    failed: Number(row.failed),
    skipped: Number(row.skipped),
    duration_ms: row.duration_ms == null ? null : Number(row.duration_ms),
  }));
}

/** 单条审计详情（含 keys_sample，用于「点开看这次动了哪些键」）。 */
export async function getBulkOp(q, id) {
  const r = await q('select * from admin_bulk_ops where id = $1', [Number(id)]);
  const row = r.rows[0];
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    total: Number(row.total),
    ok: Number(row.ok),
    failed: Number(row.failed),
    skipped: Number(row.skipped),
  };
}
