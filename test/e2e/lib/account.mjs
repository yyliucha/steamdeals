// e2e_ 测试账号生命周期（CK 批，docs/E2E-SUITE.md §1 #5、§6.2）：
// 全部走真实接口（登录含图形验证码——答案在 login_challenges 表，测试侧可读），不绕过鉴权。
// 铁律：只操作 e2e_ 前缀账号，绝不碰真实用户。
export const E2E_PREFIX = 'e2e_';

export function e2eUsername(ts = Date.now()) {
  return `${E2E_PREFIX}${ts}`;
}

/** 强密码：≥12 位、大小写数字符号、避开常见密码词（password-policy MIN_LENGTH=12）。 */
export function strongPassword(tag = Date.now()) {
  return `E2e#${tag}$Ab7zQ`;
}

async function readJson(res) {
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    /* 非 JSON 响应 */
  }
  return { status: res.status, body, text };
}

const postJson = (url, body, cookie) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

/**
 * 真实登录（含验证码）：GET /api/captcha 拿 token → 从 login_challenges 读答案 → POST /api/login。
 * 返回会话 Cookie（gp_session=…，取自 set-cookie 头）。失败抛错并带响应体。
 */
export async function apiLogin(base, username, password, q) {
  const capRes = await fetch(`${base}/api/captcha`);
  if (!capRes.ok) throw new Error(`获取验证码失败：HTTP ${capRes.status}`);
  const cap = await capRes.json();
  const row = (await q('select answer from login_challenges where token = $1', [cap.token])).rows[0];
  if (!row) throw new Error('验证码 token 未落库（login_challenges 无该行）');
  const res = await postJson(`${base}/api/login`, {
    username,
    password,
    captchaToken: cap.token,
    captchaAnswer: row.answer,
  });
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
  const body = await res.json().catch(() => ({}));
  if (res.status !== 200) throw new Error(`登录失败（${username}）：HTTP ${res.status} ${body.error ?? ''}`);
  return cookie;
}

export async function listUsers(base, adminCookie) {
  const res = await fetch(`${base}/api/admin/users`, { headers: { cookie: adminCookie } });
  const { status, body } = await readJson(res);
  if (status !== 200) throw new Error(`列出用户失败：HTTP ${status}`);
  return body.users ?? [];
}

/**
 * 新建 e2e 用户（DT-3 起：POST /api/admin/users 已下线，走自助注册——
 * 测试侧可读库：先落一条 register 验证码再 POST /api/auth/register/verify）。
 */
export async function createUser(base, q, { username, password, email = null }) {
  const mail = email ?? `${username}@e2e.local`;
  const code = '654321';
  const { hashCode } = await import('../../../src/email-auth.js');
  await q(
    "insert into email_codes (email, user_id, purpose, code_hash, expires_at) values ($1, null, 'register', $2, now() + interval '10 minutes')",
    [mail, hashCode(mail, code)],
  );
  const res = await postJson(`${base}/api/auth/register/verify`, { email: mail, code, username, password });
  const r = await readJson(res);
  if (r.status !== 201) throw new Error(`创建用户失败（${username}）：HTTP ${r.status} ${r.body.error ?? ''}`);
  return r.body.user;
}

/** 彻底删除（DELETE /api/admin/users/:username，confirmUsername 必须精确匹配；护栏 404/400/409 原样透出）。 */
export async function deleteUser(base, adminCookie, username) {
  const res = await fetch(`${base}/api/admin/users/${encodeURIComponent(username)}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ confirmUsername: username, reason: 'e2e 测试清理' }),
  });
  const r = await readJson(res);
  if (r.status !== 200) throw new Error(`删除用户失败（${username}）：HTTP ${r.status} ${r.body.error ?? ''}`);
  return r.body;
}

/** 断言登录已被拒（用户不存在/已删除 → 401；验证码错误不掩盖用户名错误）。 */
export async function assertLoginGone(base, username, password, q) {
  const capRes = await fetch(`${base}/api/captcha`);
  const cap = await capRes.json();
  const row = (await q('select answer from login_challenges where token = $1', [cap.token])).rows[0];
  const res = await postJson(`${base}/api/login`, {
    username,
    password,
    captchaToken: cap.token,
    captchaAnswer: row?.answer ?? '',
  });
  if (res.status === 200) throw new Error(`断言失败：已删除用户 ${username} 仍可登录`);
  return res.status;
}

/** 开场孤儿清理：只删 e2e_ 前缀，返回删除的账号名列表。 */
export async function cleanupOrphans(base, adminCookie, q) {
  const users = await listUsers(base, adminCookie);
  const orphans = users.filter((u) => String(u.username).startsWith(E2E_PREFIX));
  const removed = [];
  for (const u of orphans) {
    await deleteUser(base, adminCookie, u.username);
    removed.push(u.username);
  }
  return { removed, remaining: (await listUsers(base, adminCookie)).filter((u) => String(u.username).startsWith(E2E_PREFIX)) };
}

/** 会话级联断言：删除后 sessions 表无残留（级联清掉）。 */
export async function sessionCount(q, userId) {
  const r = await q('select count(*)::int as n from sessions where user_id = $1', [userId]);
  return r.rows[0].n;
}
