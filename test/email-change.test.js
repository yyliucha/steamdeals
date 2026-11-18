// CZ 批（docs/EMAIL-CHANGE.md §4）：更换登录邮箱。
// 7 项测试，对应规格验收 §4 的 8 条：
//   ① 换邮箱成功：email 更新 + email_verified=true + 旧邮箱安全通知 + 新邮箱绑定成功 + 审计 auth.email_changed；
//   ② 换成功全部会话下线（两台设备都踢，当前会话下一次请求 401）；占用邮箱 request 不泄露（静默跳过）、
//     验证码通过后才提示 409；
//   ③ 验证码错误/过期/超次数有明确提示；
//   ④ 24 小时内第二次换邮箱被 429 拒绝并给 retryAfterSec；
//   ⑤ 未验证邮箱也能换，换完变已验证；
//   ⑥ 管理员重置邮箱仍可用 + 审计 admin.email_reset + 通知；
//   ⑦ 未登录 401：Cookie「需要登录」、Bearer「login_required」（App 共用同一接口）。
//
// 测试环境用假 SMTP（net 模块）：验证码邮件与两封通知都真实走 SMTP 协议发出，
// 从 DATA 报文里解出 6 位验证码（哈希校验兜底），而不是 mock 掉发信逻辑——
// 这样「发到新邮箱的验证码 + 旧邮箱安全通知 + 新邮箱绑定成功」是真锁住的行为。
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer } from '../src/server.js';
import { verifyCodeHash, hashCode, ensureEmailSchema } from '../src/email-auth.js';
import { waitForNotifyQueue } from '../src/account-notify.js';

// 测试里默认关掉登录验证码
process.env.CAPTCHA_ENABLED = '0';

/** 起一个假 SMTP 服务器，记录收到的每一行命令与邮件正文（与 email-auth.test.js 同款）。 */
function startFakeSmtp({ authCode = 235 } = {}) {
  const state = { commands: [], data: '' };
  const server = net.createServer((socket) => {
    socket.write('220 fake ESMTP ready\r\n');
    let buf = '';
    let inData = false;
    socket.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        state.commands.push(line);
        if (inData) {
          if (line === '.') {
            inData = false;
            socket.write('250 2.0.0 Ok: queued\r\n');
          } else {
            state.data += `${line}\r\n`;
          }
          continue;
        }
        if (/^EHLO/i.test(line)) socket.write('250-fake\r\n250-AUTH PLAIN LOGIN\r\n250 HELP\r\n');
        else if (/^AUTH PLAIN/i.test(line)) socket.write(`${authCode} auth result\r\n`);
        else if (/^MAIL FROM/i.test(line)) socket.write('250 2.1.0 Ok\r\n');
        else if (/^RCPT TO/i.test(line)) socket.write('250 2.1.5 Ok\r\n');
        else if (/^DATA/i.test(line)) {
          inData = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (/^QUIT/i.test(line)) {
          socket.write('221 2.0.0 Bye\r\n');
          socket.end();
        } else socket.write('250 OK\r\n');
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, state, port: server.address().port }));
  });
}

/** 从假 SMTP 收到的全部 DATA 里找出能通过哈希校验的 6 位验证码（通知邮件混在一起时也能定位）。 */
function extractCode(state, email, codeHash) {
  for (const line of String(state.data ?? '').split(/\r?\n/)) {
    if (!/^[A-Za-z0-9+/=]{20,}$/.test(line)) continue;
    const decoded = Buffer.from(line, 'base64').toString('utf8');
    for (const m of decoded.matchAll(/\d{6}/g)) {
      if (verifyCodeHash(email, m[0], codeHash)) return m[0];
    }
  }
  return null;
}

async function setup() {
  const { server: smtp, state, port } = await startFakeSmtp();
  const store = await openStore('pglite:', {});
  try {
    await db.migrate(store);
    await ensureEmailSchema(store); // smtp_settings / email_codes / mail_templates / mail_log（真实服务启动时也会建）
    const q = (sql, p) => store.query(sql, p);
    const admin = await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin', email: 'admin@example.com' });
    const alice = await db.createUser(q, { username: 'alice', password: 'alice123456', role: 'user', email: 'alice@example.com' });
    const bob = await db.createUser(q, { username: 'bob', password: 'bob123456', role: 'user', email: 'bob@example.com' });
    await q("update users set email_verified = true where username in ('alice','bob')");
    await q(
      "insert into smtp_settings (id, host, port, secure, username, from_addr, enabled) values (1, '127.0.0.1', $1, false, 's@x.com', 's@x.com', true)",
      [port],
    );
    const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1' });
    return { smtp, state, store, q, srv, base: `http://127.0.0.1:${srv.port}`, admin, alice, bob };
  } catch (err) {
    // 建库/起服失败也要关掉假 SMTP 与 store——否则 net.Server 句柄泄漏会让 node:test 永不退出
    await store.close().catch(() => {});
    smtp.close();
    throw err;
  }
}

const login = async (base, username, password) => {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return { status: res.status, cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] };
};

const requestChange = (base, cookie, newEmail, headers = {}) =>
  fetch(`${base}/api/me/email/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
    body: JSON.stringify({ newEmail }),
  });

const verifyChange = (base, cookie, newEmail, code) =>
  fetch(`${base}/api/me/email/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ newEmail, code }),
  });

/** 给某邮箱发码并返回真实验证码（发码 → 查 code_hash → 从 SMTP 报文解出能通过哈希的码）。 */
async function requestCode(c, cookie, email) {
  const r = await requestChange(c.base, cookie, email);
  assert.equal(r.status, 200, `发码应 200：${await r.text()}`);
  const codeRow = (
    await c.q(`select code_hash from email_codes where purpose = 'change_email' and email = $1 order by id desc limit 1`, [email])
  ).rows[0];
  assert.ok(codeRow, '验证码记录已写入');
  const code = extractCode(c.state, email, codeRow.code_hash);
  assert.ok(code, '能从发出的邮件里解出 6 位验证码');
  return code;
}

test('① 换邮箱成功：双邮件 + 审计 + email_verified；全部会话下线（当前 401）', async () => {
  const c = await setup();
  try {
    const ac = await login(c.base, 'alice', 'alice123456');
    const ac2 = await login(c.base, 'alice', 'alice123456'); // 第二台设备
    // 第三台「设备」：App Bearer Token（换邮箱后必须一并撤销）
    const appLogin = await fetch(`${c.base}/api/auth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'alice123456', captchaToken: '', captchaAnswer: '', deviceName: 'test-phone' }),
    });
    assert.equal(appLogin.status, 200, 'App Token 签发');
    const appToken = (await appLogin.json()).token;

    // 未登录 401（Cookie 语义）
    assert.equal((await requestChange(c.base, '', 'x@example.com')).status, 401);

    const code = await requestCode(c, ac.cookie, 'alice-new@example.com');

    let r = await verifyChange(c.base, ac.cookie, 'alice-new@example.com', code);
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.equal(body.ok, true);
    assert.match(body.message, /重新登录/, '提示用新邮箱重新登录');

    // 库：email 更新 + 已验证 + 记录更换时间
    const u = (await c.q('select email, email_verified, email_updated_at from users where id = $1', [c.alice.id])).rows[0];
    assert.equal(u.email, 'alice-new@example.com');
    assert.equal(u.email_verified, true, '换完自动变为已验证（规格决策 4）');
    assert.ok(u.email_updated_at, '记录 email_updated_at');

    // 审计：auth.email_changed，邮箱脱敏（不落明文邮箱）
    const aud = (
      await c.q("select actor_id, actor, action, target, detail from audit_logs where action = 'auth.email_changed' order by id desc limit 1")
    ).rows[0];
    assert.equal(Number(aud.actor_id), Number(c.alice.id), '审计记录操作者');
    assert.equal(aud.actor, 'alice');
    assert.equal(aud.target, 'alice');
    assert.equal(aud.detail.newEmail, 'al***@example.com', '审计里新邮箱脱敏');
    assert.equal(aud.detail.oldEmail, 'al***@example.com', '审计里旧邮箱脱敏');

    // 会话全清：两台设备都被踢——受保护接口 401（App/前端凭此跳登录），/api/me 也识别为未登录
    const sess = (await c.q('select count(*)::int as n from sessions where user_id = $1', [c.alice.id])).rows[0];
    assert.equal(sess.n, 0, '全部会话已删除');
    assert.equal(
      (await fetch(`${c.base}/api/me/library`, { headers: { cookie: ac.cookie } })).status,
      401,
      '当前会话已失效（下一次请求 401 → 跳登录）',
    );
    assert.equal(
      (await fetch(`${c.base}/api/me/library`, { headers: { cookie: ac2.cookie } })).status,
      401,
      '其它设备会话也被踢',
    );
    // App Bearer Token 一并撤销：库中 revoked_at 非空，请求 401 login_required
    const tok = (
      await c.q("select revoked_at from api_tokens where user_id = $1 order by id desc limit 1", [c.alice.id])
    ).rows[0];
    assert.ok(tok?.revoked_at, 'App Token 已撤销');
    assert.equal(
      (await fetch(`${c.base}/api/me/library`, { headers: { authorization: `Bearer ${appToken}` } })).status,
      401,
      'App 端会话也被踢',
    );
    const meAfter = await (await fetch(`${c.base}/api/me`, { headers: { cookie: ac.cookie } })).json();
    assert.equal(meAfter.user, null, '/api/me 识别为未登录');

    // 双邮件：旧邮箱收「登录邮箱已变更」安全通知、新邮箱收「绑定成功」；两封都真实投递成功
    await waitForNotifyQueue();
    const mail = (
      await c.q("select event, to_email, ok from mail_log where event in ('account_email_changed', 'account_email_bound') order by id")
    ).rows;
    const changed = mail.filter((m) => m.event === 'account_email_changed');
    const bound = mail.filter((m) => m.event === 'account_email_bound');
    assert.equal(changed.length, 1, '旧邮箱安全通知恰好一封');
    assert.equal(changed[0].to_email, 'alice@example.com', '安全通知发到旧邮箱');
    assert.equal(changed[0].ok, true, '安全通知真实投递成功');
    assert.equal(bound.length, 1, '新邮箱绑定成功恰好一封');
    assert.equal(bound[0].to_email, 'alice-new@example.com', '绑定成功发到新邮箱');
    assert.equal(bound[0].ok, true, '绑定成功真实投递成功');
    // SMTP 层核对收件人（验证码 1 封 + 通知 2 封，共 3 次 RCPT）
    const rcpts = c.state.commands.filter((l) => l.startsWith('RCPT TO'));
    assert.equal(rcpts.length, 3, '总共发出 3 封邮件');
    assert.ok(rcpts.some((l) => l.includes('alice@example.com')), '旧邮箱收到邮件');
    assert.ok(rcpts.some((l) => l.includes('alice-new@example.com')), '新邮箱收到邮件');
  } finally {
    await c.srv.close();
    await c.store.close();
    c.smtp.close();
  }
});

test('② 占用不泄露：request 静默跳过；验证码通过后才提示 409', async () => {
  const c = await setup();
  try {
    const ac = await login(c.base, 'alice', 'alice123456');

    // 新邮箱已被 bob 占用：响应与正常发码完全一致（黑盒不可探测），但不实际发码、不产生记录
    let r = await requestChange(c.base, ac.cookie, 'bob@example.com');
    assert.equal(r.status, 200);
    const hintBody = await r.json();
    assert.equal(hintBody.ok, true);
    assert.equal(hintBody.hint, '如果邮箱可用，验证码将发送到该邮箱', '响应文案与正常发码一致');
    const occ = (
      await c.q("select count(*)::int as n from email_codes where email = 'bob@example.com' and purpose = 'change_email'")
    ).rows[0];
    assert.equal(occ.n, 0, '占用邮箱不产生验证码记录（也不给第三方邮箱发骚扰验证码）');

    // 竞态：request 时未占用、verify 时已被占用 → 验证码通过后才提示 409
    const code = await requestCode(c, ac.cookie, 'race@example.com');
    await c.q("update users set email = 'race@example.com' where username = 'bob'"); // 期间被 bob 抢注
    r = await verifyChange(c.base, ac.cookie, 'race@example.com', code);
    assert.equal(r.status, 409, '验证码通过后占用才提示 409');
    assert.equal((await r.json()).error, '该邮箱不可用');
    const u = (await c.q('select email from users where id = $1', [c.alice.id])).rows[0];
    assert.equal(u.email, 'alice@example.com', '冲突时邮箱未变');
    // 冲突的验证码已作废，不能重放
    const used = (
      await c.q("select used_at from email_codes where email = 'race@example.com' and purpose = 'change_email' order by id desc limit 1")
    ).rows[0];
    assert.ok(used.used_at, '409 后验证码作废，防重放');
  } finally {
    await c.srv.close();
    await c.store.close();
    c.smtp.close();
  }
});

test('③ 验证码错误/超次数/过期有明确提示', async () => {
  const c = await setup();
  try {
    const ac = await login(c.base, 'alice', 'alice123456');
    const code = await requestCode(c, ac.cookie, 'trial@example.com');
    const badCode = code === '000000' ? '111111' : '000000';

    // 错误验证码 400
    let r = await verifyChange(c.base, ac.cookie, 'trial@example.com', badCode);
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error, '验证码不正确');
    // 再错 4 次凑满 5 次 → 第 6 次（哪怕用真码）429 提示重新获取
    for (let i = 0; i < 4; i += 1) {
      await verifyChange(c.base, ac.cookie, 'trial@example.com', badCode);
    }
    r = await verifyChange(c.base, ac.cookie, 'trial@example.com', code);
    assert.equal(r.status, 429, '5 次尝试用完即拒绝');
    assert.equal((await r.json()).error, '尝试次数过多，请重新获取验证码');

    // 过期：直接把记录改过期，用真码也应 400
    const code2 = await requestCode(c, ac.cookie, 'expired@example.com');
    await c.q(
      "update email_codes set expires_at = now() - interval '1 second' where email = 'expired@example.com' and purpose = 'change_email'",
    );
    r = await verifyChange(c.base, ac.cookie, 'expired@example.com', code2);
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error, '验证码已过期，请重新获取');
  } finally {
    await c.srv.close();
    await c.store.close();
    c.smtp.close();
  }
});

test('④ 24 小时内第二次换邮箱被 429 拒绝并给 retryAfterSec', async () => {
  const c = await setup();
  try {
    const ac = await login(c.base, 'alice', 'alice123456');
    // 第一次换成功
    const code = await requestCode(c, ac.cookie, 'first-new@example.com');
    let r = await verifyChange(c.base, ac.cookie, 'first-new@example.com', code);
    assert.equal(r.status, 200, '第一次换邮箱成功');

    // 换成功后会话全清，用新邮箱重新登录（顺带验证新邮箱可登录）
    const ac2 = await login(c.base, 'alice', 'alice123456');
    r = await requestChange(c.base, ac2.cookie, 'second-new@example.com');
    assert.equal(r.status, 429, '24 小时内第二次被 429 拒绝');
    const body = await r.json();
    assert.ok(
      Number(body.retryAfterSec) > 80000 && Number(body.retryAfterSec) <= 86400,
      `retryAfterSec 接近 24 小时（实际 ${body.retryAfterSec}）`,
    );
    assert.match(body.error, /24 小时/);

    // verify 的 24h 双保险：request 已被拦、正常流程到不了这里——直接插入一条有效码记录，
    // 验证码通过后仍应被 24h 频控拒绝（证明 verify 自己也有频控，不依赖 request）
    await c.q(
      `insert into email_codes (email, user_id, purpose, code_hash, attempts, expires_at)
       values ('second-new@example.com', $1, 'change_email', $2, 0, now() + interval '10 minutes')`,
      [c.alice.id, hashCode('second-new@example.com', '654321')],
    );
    r = await verifyChange(c.base, ac2.cookie, 'second-new@example.com', '654321');
    assert.equal(r.status, 429, 'verify 也被 24h 频控拦截（验证码通过后仍 429）');
  } finally {
    await c.srv.close();
    await c.store.close();
    c.smtp.close();
  }
});

test('⑤ 未验证邮箱也能换，换完变已验证（决策 4）', async () => {
  const c = await setup();
  try {
    await c.q("update users set email_verified = false where username = 'alice'");
    const ac = await login(c.base, 'alice', 'alice123456');
    const code = await requestCode(c, ac.cookie, 'verified-new@example.com');
    const r = await verifyChange(c.base, ac.cookie, 'verified-new@example.com', code);
    assert.equal(r.status, 200, '未验证邮箱也能走完换邮箱');
    const u = (await c.q('select email, email_verified from users where id = $1', [c.alice.id])).rows[0];
    assert.equal(u.email, 'verified-new@example.com');
    assert.equal(u.email_verified, true, '换完变为已验证');

    // 旧邮箱未验证 → 安全通知改发新邮箱（旧邮箱收不到，与管理员绑定接口同口径）
    await waitForNotifyQueue();
    const mail = (
      await c.q("select event, to_email from mail_log where event in ('account_email_changed', 'account_email_bound') order by id")
    ).rows;
    const changed = mail.filter((m) => m.event === 'account_email_changed');
    assert.equal(changed.length, 1);
    assert.equal(changed[0].to_email, 'verified-new@example.com', '旧邮箱未验证时安全通知改发新邮箱');
  } finally {
    await c.srv.close();
    await c.store.close();
    c.smtp.close();
  }
});

test('⑥ 管理员重置邮箱仍可用：落审计 admin.email_reset + 通知（安全兜底）', async () => {
  const c = await setup();
  try {
    const adminC = await login(c.base, 'admin', 'admin123456');
    const r = await fetch(`${c.base}/api/admin/users/alice/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminC.cookie },
      body: JSON.stringify({ email: 'reset-by-admin@example.com' }),
    });
    assert.equal(r.status, 200, `管理员重置邮箱应 200：${JSON.stringify(await r.json())}`);

    const u = (await c.q('select email, email_verified from users where id = $1', [c.alice.id])).rows[0];
    assert.equal(u.email, 'reset-by-admin@example.com', '管理员重置邮箱仍然可用（CZ 批未移除兜底）');

    // 审计：admin.email_reset（邮箱脱敏）
    const aud = (
      await c.q("select actor, actor_id, action, target, detail from audit_logs where action = 'admin.email_reset' order by id desc limit 1")
    ).rows[0];
    assert.equal(aud.actor, 'admin', '审计记录操作管理员');
    assert.equal(Number(aud.actor_id), Number(c.admin.id));
    assert.equal(aud.target, 'alice');
    assert.equal(aud.detail.newEmail, 're***@example.com', '审计里新邮箱脱敏');
    assert.equal(aud.detail.oldEmail, 'al***@example.com', '审计里旧邮箱脱敏');

    // 通知：与既有 AJ 批行为一致（旧邮箱 account_email_changed + 新邮箱 account_email_bound）
    await waitForNotifyQueue();
    const mail = (
      await c.q("select event, to_email from mail_log where event in ('account_email_changed', 'account_email_bound') order by id")
    ).rows;
    const changed = mail.filter((m) => m.event === 'account_email_changed');
    const bound = mail.filter((m) => m.event === 'account_email_bound');
    assert.equal(changed.length, 1, '旧邮箱收安全通知');
    assert.equal(changed[0].to_email, 'alice@example.com');
    assert.equal(bound.length, 1, '新邮箱收绑定成功');
    assert.equal(bound[0].to_email, 'reset-by-admin@example.com');
  } finally {
    await c.srv.close();
    await c.store.close();
    c.smtp.close();
  }
});

test('⑦ 未登录 401：Cookie「需要登录」、Bearer「login_required」（App 共用同一接口）', async () => {
  const c = await setup();
  try {
    // Cookie 语义（Web）
    let r = await requestChange(c.base, '', 'x@example.com');
    assert.equal(r.status, 401);
    assert.equal((await r.json()).error, '需要登录');
    r = await verifyChange(c.base, '', 'x@example.com', '123456');
    assert.equal(r.status, 401);
    assert.equal((await r.json()).error, '需要登录');

    // Bearer 语义（App）：无效 token 同样 401，文案是 login_required（CA-1 口径）
    const bearer = 'Bearer ' + 'A'.repeat(32);
    r = await requestChange(c.base, '', 'x@example.com', { authorization: bearer });
    assert.equal(r.status, 401);
    assert.equal((await r.json()).error, 'login_required');
    r = await fetch(`${c.base}/api/me/email/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: bearer },
      body: JSON.stringify({ newEmail: 'x@example.com', code: '123456' }),
    });
    assert.equal(r.status, 401);
    assert.equal((await r.json()).error, 'login_required');
  } finally {
    await c.srv.close();
    await c.store.close();
    c.smtp.close();
  }
});
