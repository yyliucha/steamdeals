// CO-4/B4 第二轮（docs/DESIGN-AUDIT.md B4）：申诉域 repository——申诉系统（docs/APPEAL-SYSTEM.md §2/§3，O/BQ 批次）
// 从 src/store/pg.js 巨石抽出。归属判定：只包含 appeals 表结构与查询该表的 12 个函数；
// 申诉路由用到的 removeBlockedIp / clearAbuseBan / fingerprintOfDeviceId / removeDeviceBan / insertMailLog
// 是通用 SQL（黑名单/设备/邮件也供其它域用），留在 pg.js。
//
// 拆分约定（见 docs/ARCHITECTURE.md「域路由拆分模式」）：
//   · 域 SQL 落 src/store/<domain>-repository.js，函数签名不变；
//   · pg.js 以 `export { … } from './<domain>-repository.js'` 保持 re-export 兼容——server.js 等
//     现有 import 不用改，后续域拆完 pg.js 只剩聚合壳与通用 SQL。

// 申诉系统（docs/APPEAL-SYSTEM.md §2 + §10.2，O/BQ 批次）：
// 提交入库 → 后台处理 / 邮件一键处理 → 结果回信申请人。
// BQ 的 3 列（action_token_hash / action_expires_at / handled_via）随建表一起落，
// token 只存 sha256、处理成功即置空；handled_via 记 console | email 审计来源。
export const APPEALS_DDL = `
create table if not exists appeals (
  id                 bigserial primary key,
  code               text not null unique,
  ip                 text,
  device_id          text,
  fingerprint        text,
  reason             text,
  ban_until          timestamptz,
  contact            text not null,
  message            text,
  status             text not null default 'pending',
  action             text,
  note               text,
  created_at         timestamptz not null default now(),
  handled_at         timestamptz,
  handled_by         bigint references users(id) on delete set null,
  action_token_hash  text,
  action_expires_at  timestamptz,
  handled_via        text
);
create index if not exists appeals_status on appeals (status, created_at desc);
create index if not exists appeals_ip on appeals (ip);
create index if not exists appeals_contact on appeals (contact);
create index if not exists appeals_action_token on appeals (action_token_hash);
`;

/** CF 批（docs/ADMIN-UX-SECURITY.md §4）：审核证据抽屉——该 IP 最近一条申诉状态。 */
export async function appealStatusByIp(q, ip) {
  if (!ip) return null;
  const r = await q('select status from appeals where ip = $1 order by created_at desc limit 1', [String(ip)]);
  return r.rows[0]?.status ?? null;
}

/** 提交申诉入库；token 相关列（BQ）在提交时生成（只存 sha256 + 14 天到期）。 */
export async function insertAppeal(q, {
  code, ip = null, deviceId = null, fingerprint = null, reason = null, banUntil = null,
  contact, message, tokenHash = null, actionExpiresAt = null,
}) {
  const r = await q(
    `insert into appeals (code, ip, device_id, fingerprint, reason, ban_until, contact, message, action_token_hash, action_expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     returning id, code, status, created_at`,
    [code, ip, deviceId, fingerprint, reason, banUntil, contact, message, tokenHash, actionExpiresAt],
  );
  return r.rows[0] ?? null;
}

/** 幂等口径：同一 IP + 相同说明，1 小时内重复提交返回原编号。 */
export async function recentAppealByIpMessage(q, { ip, message, minutes = 60 }) {
  const r = await q(
    `select code from appeals
      where ip = $1 and message = $2 and created_at > now() - ($3 * interval '1 minute')
      order by id desc limit 1`,
    [ip, message, minutes],
  );
  return r.rows[0]?.code ?? null;
}

/** 每 IP 每小时限 3 条（库内双保险；内存桶在 server.js）。 */
export async function countAppealsSince(q, { ip, minutes = 60 }) {
  const r = await q(
    `select count(*)::int as n from appeals where ip = $1 and created_at > now() - ($2 * interval '1 minute')`,
    [ip, minutes],
  );
  return Number(r.rows[0]?.n ?? 0);
}

/** 申请人按编号查进度：只回 status/handled_at/note，不回显 IP/指纹（§3.4）。 */
export async function appealStatusByCode(q, code) {
  const r = await q('select status, handled_at, note from appeals where code = $1', [String(code).toUpperCase()]);
  return r.rows[0] ?? null;
}

/** 管理员列表（pending 默认 / done=已处理 resolved+rejected / all；按 id desc 分页），含待处理总数。 */
export async function listAppeals(q, { status = 'pending', limit = 20, page = 1 } = {}) {
  const where = status === 'all' ? '' : status === 'done' ? `where status <> 'pending'` : `where status = $3`;
  const params = status === 'all' || status === 'done' ? [limit, Math.max(0, (page - 1) * limit)] : [limit, Math.max(0, (page - 1) * limit), status];
  const r = await q(
    `select id, code, ip, device_id, fingerprint, reason, ban_until, contact, message,
            status, action, note, created_at, handled_at, handled_via
       from appeals ${where}
      order by id desc
      limit $1 offset $2`,
    params,
  );
  return r.rows;
}

export async function countPendingAppeals(q) {
  const r = await q(`select count(*)::int as n from appeals where status = 'pending'`);
  return Number(r.rows[0]?.n ?? 0);
}

export async function countAppeals(q, { status = 'pending' } = {}) {
  const where = status === 'all' ? '' : status === 'done' ? `where status <> 'pending'` : 'where status = $1';
  const params = status === 'all' || status === 'done' ? [] : [status];
  const r = await q(`select count(*)::int as n from appeals ${where}`, params);
  return Number(r.rows[0]?.n ?? 0);
}

export async function getAppealById(q, id) {
  const r = await q('select * from appeals where id = $1', [id]);
  return r.rows[0] ?? null;
}

/**
 * 处理申诉（含 BQ 邮件通道共用）：where status='pending' 抢锁，0 行 = 已被处理（调用方回 409）。
 * 支持 note 动作（仅备注，status 保持 pending、不写 handled_at）。
 */
export async function resolveAppeal(q, { id, action, note = null, handledBy = null, handledVia = 'console' }) {
  const status = action === 'reject' ? 'rejected' : action === 'note' ? 'pending' : 'resolved';
  const r = await q(
    `update appeals
        set status = $2, action = $3, note = $4, handled_at = $5, handled_by = $6, handled_via = $7
      where id = $1 and status = 'pending'
      returning *`,
    [id, status, action, note, action === 'note' ? null : new Date().toISOString(), handledBy, action === 'note' ? null : handledVia],
  );
  return r.rows[0] ?? null;
}

/** BQ：token 只存 sha256；预览/执行共用——不存在/过期/已置空统一查不到（调用方回 404）。 */
export async function appealByTokenHash(q, hash) {
  const r = await q('select * from appeals where action_token_hash = $1', [hash]);
  return r.rows[0] ?? null;
}

/**
 * BQ：事务内抢 pending 并消费 token（0 行 → 409 语义由调用方处理）。
 * 成功处理**不**清 action_token_hash：链接再打开仍能解析出「已处理 + 处理时间」给后来者看
 * （§10.7 验收 12/13）；执行能力由 status='pending' 约束（旧链接立即失效 = 不能再执行）。
 */
export async function consumeAppealToken(q, { hash, status, action, note = null, handledVia = 'email' }) {
  const r = await q(
    `update appeals
        set status = $2, action = $3, note = $4, handled_at = now(), handled_via = $5
      where action_token_hash = $1 and status = 'pending'
      returning *`,
    [hash, status, action, note, handledVia],
  );
  return r.rows[0] ?? null;
}
