// CO-5/B4-2 第十轮（docs/DESIGN-AUDIT.md B4）：admin-settings 域（B4 队列 #10：后台系统设置
// smtp/mail/emails/proxies/version）专属 SQL——从 src/store/pg.js 巨石抽出的第十个域 repository。
//
// 归属判定（§15.1「域专属 SQL 进 repository，通用 SQL 留 pg.js」）：
//   · 搬入本文件：listMailTemplates / upsertMailTemplate / resetMailTemplate / listMailLog——
//     只被本域路由使用（/api/admin/mail/templates* 与 /api/admin/mail/log），
//     且签名与拆分前完全一致；
//   · 留在 pg.js：insertMailLog 跨模块共用——src/account-notify.js（通知发送成功/失败落库）、
//     src/routes/appeal.js（申诉邮件发送记录）、本域 /api/admin/mail/templates/:event/test
//     都写同一张 mail_log 表，属通用 SQL 一律不搬；
//   · 域内联 SQL（此前直接写在 server.js 路由体里的字面量）抽成本文件新函数：
//     saveSmtpSettings（POST /api/admin/smtp 的 upsert）、listEmailCodes（GET /api/admin/emails
//     列表，原 limit 字符串拼接改为 $1 参数化，行为一致）、insertTestEmailCode /
//     markEmailCodeSent / markEmailCodeFailed（POST /api/admin/smtp/test 的测试邮件记录）；
//   · DDL 不搬家：smtp_settings / mail_templates / mail_log / email_codes 表 DDL 在
//     src/email-auth.js（EMAIL_SCHEMA，跨模块共用——ensureEmailSchema 建表）。
//
// pg.js 顶部 import + re-export 本文件，旧 db.* 导入签名永远不变。

// ---------------------------------------------------------------- 邮件模板与发送记录（docs/USER-LIFECYCLE.md §3.1/§3.3/§4.3）

/** 读出所有已保存的模板行（event → 行）。 */
export async function listMailTemplates(q) {
  const r = await q('select event, subject, body_html, body_text, enabled, updated_at, updated_by from mail_templates');
  return new Map(r.rows.map((row) => [row.event, row]));
}

/** 保存/更新一个模板；event 白名单由调用方校验。 */
export async function upsertMailTemplate(q, { event, subject, bodyHtml, bodyText = null, enabled = true, updatedBy = null }) {
  await q(
    'insert into mail_templates (event, subject, body_html, body_text, enabled, updated_by) values ($1,$2,$3,$4,$5,$6) ' +
      'on conflict (event) do update set subject = excluded.subject, body_html = excluded.body_html, body_text = excluded.body_text, enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = now()',
    [event, subject, bodyHtml, bodyText, Boolean(enabled), updatedBy],
  );
}

/** 恢复默认 = 删表行（渲染时回落到代码默认值）。 */
export async function resetMailTemplate(q, event) {
  await q('delete from mail_templates where event = $1', [event]);
}

/** 最近发送记录（通知 tab）：倒序，limit ≤ 500。 */
export async function listMailLog(q, { limit = 200 } = {}) {
  const cap = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const r = await q('select id, created_at, event, to_email, subject, ok, error, actor from mail_log order by id desc limit $1', [cap]);
  return r.rows;
}

// ---------------------------------------------------------------- SMTP 配置（POST /api/admin/smtp 域内联 SQL）

/** 保存 SMTP 配置（单行 upsert）；密码留空（passwordEnc=null）时保持原值。 */
export async function saveSmtpSettings(q, { host, port, secure, username, passwordEnc, fromAddr, enabled }) {
  await q(
    `insert into smtp_settings (id, host, port, secure, username, password_enc, from_addr, enabled, updated_at)
     values (1, $1, $2, $3, $4, $5, $6, $7, now())
     on conflict (id) do update set
       host = excluded.host, port = excluded.port, secure = excluded.secure,
       username = excluded.username,
       password_enc = coalesce($5, smtp_settings.password_enc),
       from_addr = excluded.from_addr, enabled = excluded.enabled, updated_at = now()`,
    [host, port, secure, username, passwordEnc, fromAddr, enabled],
  );
}

// ---------------------------------------------------------------- 验证码/测试邮件记录（email_codes 域内联 SQL）

/** 验证码发送记录列表（GET /api/admin/emails）：倒序，limit ≤ 500。 */
export async function listEmailCodes(q, { limit = 100 } = {}) {
  const cap = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const r = await q(
    'select id, email, purpose, sent_ok, error, ip, subject, body, expires_at, used_at, created_at ' +
      'from email_codes order by created_at desc limit $1',
    [cap],
  );
  return r.rows;
}

/** 测试邮件记录（purpose='test'）：先落一行再发送，结果回写 sent_ok。 */
export async function insertTestEmailCode(q, { email, subject, body }) {
  const r = await q(
    "insert into email_codes (email, purpose, code_hash, subject, body, expires_at, sent_ok) " +
      "values ($1, 'test', '-', $2, $3, now(), null) returning id",
    [email, subject, body],
  );
  return r.rows[0].id;
}

/** 测试邮件发送成功回写。 */
export async function markEmailCodeSent(q, id) {
  await q('update email_codes set sent_ok = true where id = $1', [id]);
}

/** 测试邮件发送失败回写（错误截断到 200 字符）。 */
export async function markEmailCodeFailed(q, id, error) {
  await q('update email_codes set sent_ok = false, error = $1 where id = $2', [String(error).slice(0, 200), id]);
}
