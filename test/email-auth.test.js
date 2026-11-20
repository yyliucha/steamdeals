import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer } from '../src/server.js';

// 测试里关掉登录验证码
process.env.CAPTCHA_ENABLED = '0';
import {
  generateCode,
  hashCode,
  verifyCodeHash,
  normalizeEmail,
  checkRateLimit,
  checkIpRateLimit,
  checkGlobalDailyLimit,
  SEND_IP_HOURLY_LIMIT,
  SEND_DAILY_GLOBAL_LIMIT,
  encryptSecret,
  decryptSecret,
  ensureEmailSchema,
  purgeOldCodes,
  smtpConfig,
  isSmtpConfigured,
  CODE_TTL_SEC,
  SEND_COOLDOWN_SEC,
  SEND_HOURLY_LIMIT,
} from '../src/email-auth.js';

/** 起一个假 SMTP 服务器，记录收到的每一行命令与邮件正文。 */
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

test('验证码：6 位数字，范围合法', () => {
  for (let i = 0; i < 20; i += 1) {
    const code = generateCode();
    assert.match(code, /^\d{6}$/);
    assert.ok(Number(code) >= 100000 && Number(code) <= 999999);
  }
  assert.equal(CODE_TTL_SEC, 300, '验证码 5 分钟有效');
});

test('验证码哈希：加盐、可校验、不含明文', () => {
  const stored = hashCode('A@Example.com', '123456');
  assert.notEqual(stored, hashCode('A@Example.com', '123456'), '每次盐不同');
  assert.equal(verifyCodeHash('a@example.com', '123456', stored), true, '邮箱不区分大小写');
  assert.equal(verifyCodeHash('a@example.com', '123457', stored), false);
  assert.equal(verifyCodeHash('a@example.com', '123456', 'garbage'), false);
  assert.ok(!stored.includes('123456'), '不能出现明文');
});

test('邮箱规范化：合法/非法', () => {
  assert.equal(normalizeEmail('  User@Example.COM '), 'user@example.com');
  assert.equal(normalizeEmail('not-an-email'), null);
  assert.equal(normalizeEmail(''), null);
});

test('频率限制：冷却 60 秒、每小时 5 次、失败不占额度', () => {
  const now = Date.UTC(2026, 9, 27, 1, 0, 0);
  assert.equal(checkRateLimit([], now).ok, true);

  const justSent = [{ created_at: new Date(now - 5000).toISOString(), sent_ok: true }];
  const cooled = checkRateLimit(justSent, now);
  assert.equal(cooled.ok, false);
  assert.equal(cooled.reason, 'cooldown');
  assert.ok(cooled.retryAfterSec > 0 && cooled.retryAfterSec <= SEND_COOLDOWN_SEC);

  const hourly = Array.from({ length: SEND_HOURLY_LIMIT }, (_, i) => ({
    created_at: new Date(now - (SEND_COOLDOWN_SEC + 1 + i * 60) * 1000).toISOString(),
    sent_ok: true,
  }));
  assert.equal(checkRateLimit(hourly, now).reason, 'hourly_limit');

  const failed = [{ created_at: new Date(now - 1000).toISOString(), sent_ok: false }];
  assert.equal(checkRateLimit(failed, now).ok, true);
});

test('SMTP 密码加密：AES-GCM 往返，错误密钥解不开', () => {
  const secret = 'a-very-long-secret-key-123';
  const enc = encryptSecret('smtp-pass', secret);
  assert.ok(!enc.includes('smtp-pass'));
  assert.equal(decryptSecret(enc, secret), 'smtp-pass');
  assert.throws(() => decryptSecret(enc, 'wrong-secret-key-000'));
  assert.equal(encryptSecret('', secret), null);
});

test('SMTP 配置：数据库优先，未配置回退环境变量', async () => {
  const env = {
    SMTP_HOST: 'smtp.env.com',
    SMTP_PORT: '587',
    SMTP_SECURE: '0',
    SMTP_USER: 'u',
    SMTP_PASS: 'p',
    SMTP_FROM: 'f@x.com',
  };
  const none = await smtpConfig(async () => ({ rows: [] }), env);
  assert.equal(none.source, 'env');
  assert.equal(none.host, 'smtp.env.com');
  assert.equal(none.port, 587);
  assert.equal(none.secure, false);

  const secret = 'x'.repeat(20);
  const dbRow = {
    host: 'smtp.db.com',
    port: 465,
    secure: true,
    username: 'dbu',
    password_enc: encryptSecret('dbpass', secret),
    from_addr: 'db@x.com',
    enabled: true,
  };
  const fromDb = await smtpConfig(async () => ({ rows: [dbRow] }), { ...env, SECRET_KEY: secret });
  assert.equal(fromDb.source, 'database');
  assert.equal(fromDb.pass, 'dbpass', '有 SECRET_KEY 时能解开密码');

  assert.equal(isSmtpConfigured({ host: 'h', from: 'f' }), true);
  assert.equal(isSmtpConfigured({ host: '', from: '' }), false);
});

test('建表：email_codes / smtp_settings 与 users.email', async () => {
  const store = await openStore('pglite:', {});
  try {
    await db.migrate(store);
    await ensureEmailSchema(store);
    await ensureEmailSchema(store);
    const t = await store.query(
      "select table_name from information_schema.tables where table_schema='public' and table_name in ('email_codes','smtp_settings')",
    );
    assert.equal(t.rows.length, 2);
    const cols = await store.query(
      "select column_name from information_schema.columns where table_name='users' and column_name='email'",
    );
    assert.equal(cols.rows.length, 1);
    const mailCols = await store.query(
      "select column_name from information_schema.columns where table_name='email_codes' and column_name in ('subject','body')",
    );
    assert.equal(mailCols.rows.length, 2, 'email_codes 要有 subject/body（管理员查看邮件内容用）');
  } finally {
    await store.close();
  }
});

test('发码后邮件内容落库：正文不存明文验证码，哈希可校验，管理员接口可读，过期可清理', async () => {
  const { server: smtp, state, port } = await startFakeSmtp();
  const store = await openStore('pglite:', {});
  try {
    await db.migrate(store);
    await ensureEmailSchema(store);
    const q = (sql, p) => store.query(sql, p);
    await db.createUser(q, { username: 'alice', password: 'alice123456' });
    await q("update users set email = 'alice@example.com', email_verified = true where username = 'alice'");
    await q(
      "insert into smtp_settings (id, host, port, secure, username, from_addr, enabled) values (1, '127.0.0.1', $1, false, 's@x.com', 's@x.com', true)",
      [port],
    );
    await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });

    const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1' });
    const base = `http://127.0.0.1:${srv.port}`;
    try {
      const res = await fetch(`${base}/api/auth/email/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'alice@example.com', purpose: 'login' }),
      });
      assert.equal(res.status, 200, JSON.stringify(await res.text()));

      const row = (await q('select id, subject, body, code_hash from email_codes order by id desc limit 1')).rows[0];
      assert.equal(row.subject, 'SteamDeals 验证码', '主题跟随 verify_code 模板默认值（AI 批）');
      assert.equal(row.body, '验证码邮件正文未保存。', '数据库不能留明文验证码');
      // 真实验证码只在发出的邮件里：邮件现在是 multipart/alternative（AI 批），
      // 逐个 base64 段解码后找 6 位验证码，再验证哈希仍然对得上
      const rawMail = String(state.data || '');
      let code = null;
      for (const line of rawMail.split(/\r?\n/)) {
        if (!/^[A-Za-z0-9+/=]{20,}$/.test(line)) continue;
        const m = /(\d{6})/.exec(Buffer.from(line, 'base64').toString('utf8'));
        if (m) {
          code = m[1];
          break;
        }
      }
      assert.ok(code, '发出的邮件正文里应有 6 位验证码');
      assert.equal(verifyCodeHash('alice@example.com', code, row.code_hash), true, '邮件里的验证码能通过哈希校验');

      // 管理员接口能看到主题/正文（正文已是脱敏占位，不再暴露验证码）
      const login = await fetch(`${base}/api/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin123456' }),
      });
      const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
      const emails = await (await fetch(`${base}/api/admin/emails`, { headers: { cookie } })).json();
      assert.equal(emails.records[0].body, row.body);
      assert.equal(emails.records[0].subject, 'SteamDeals 验证码');

      // 清理：3 天前的记录被删
      await q("update email_codes set created_at = now() - interval '4 days'");
      const purged = await purgeOldCodes(q, { days: 3 });
      assert.equal(purged, 1);
    } finally {
      await srv.close();
    }
  } finally {
    await store.close();
    smtp.close();
  }
});

test('发信限流：单 IP 每小时上限与全站每日上限', () => {
  const now = Date.now();
  const many = Array.from({ length: SEND_IP_HOURLY_LIMIT }, () => ({ created_at: new Date(now - 1000).toISOString(), sent_ok: true }));
  const ipLimited = checkIpRateLimit(many, now);
  assert.equal(ipLimited.ok, false);
  assert.equal(ipLimited.reason, 'ip_hourly_limit');
  assert.equal(checkIpRateLimit(many.slice(0, 3), now).ok, true);

  assert.equal(checkGlobalDailyLimit(SEND_DAILY_GLOBAL_LIMIT).ok, false);
  assert.equal(checkGlobalDailyLimit(SEND_DAILY_GLOBAL_LIMIT - 1).ok, true);
});

// ===== DT-4（docs/ADMIN-PERMISSIONS.md）：验证码冷却按场景分桶 + retryAfterSec =====
// 分桶维度 = email_codes.purpose：同邮箱同场景才互斥；后台重置密码发码（admin_reset）
// 不占用前台登录/注册/重置发码额度（反之亦然）。成功响应带 retryAfterSec=60 供前端倒计时。
// 反向自检：把任一「where email = $1 and purpose = $2」退化成「where email = $1」→
// 下面「reset 发码不占 login 额度」与「后台发码不占前台额度」断言必红。
test('DT-4 分桶：同邮箱不同场景发码互不占额度；同场景 60 秒冷却 429 + retryAfterSec；后台发码不占前台额度', async () => {
  const { server: smtp, state, port } = await startFakeSmtp();
  const store = await openStore('pglite:', {});
  try {
    await db.migrate(store);
    await ensureEmailSchema(store);
    const q = (sql, p) => store.query(sql, p);
    await db.createUser(q, { username: 'alice', password: 'alice123456' });
    await q("update users set email = 'alice@example.com', email_verified = true where username = 'alice'");
    await q(
      "insert into smtp_settings (id, host, port, secure, username, from_addr, enabled) values (1, '127.0.0.1', $1, false, 's@x.com', 's@x.com', true)",
      [port],
    );
    await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
    const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1' });
    const base = `http://127.0.0.1:${srv.port}`;
    const send = (path, body) =>
      fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    try {
      // 1) 前台登录发码成功，响应带 retryAfterSec=60
      const r1 = await send('/api/auth/email/request', { email: 'alice@example.com', purpose: 'login' });
      assert.equal(r1.status, 200, JSON.stringify(await r1.clone().text()));
      assert.equal((await r1.json()).retryAfterSec, 60, '成功响应带 retryAfterSec=60');
      // 2) 同场景再发 → 429 冷却 + retryAfterSec
      const r2 = await send('/api/auth/email/request', { email: 'alice@example.com', purpose: 'login' });
      assert.equal(r2.status, 429, '同场景 60 秒冷却');
      const b2 = await r2.json();
      assert.ok(b2.retryAfterSec > 0 && b2.retryAfterSec <= 60, '429 带剩余秒数');
      // 3) 不同场景（前台重置）不受登录冷却拦截——分桶生效
      const r3 = await send('/api/auth/email/request', { email: 'alice@example.com', purpose: 'reset' });
      assert.equal(r3.status, 200, '重置发码不占登录发码额度（purpose 分桶）');
      // 4) 后台重置密码发码（admin_reset）也不占前台 login/reset 额度
      const loginAdmin = await fetch(base + '/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin123456' }),
      });
      const cookie = (loginAdmin.headers.get('set-cookie') ?? '').split(';')[0];
      const r5 = await fetch(base + '/api/admin/users/alice/reset-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: '{}',
      });
      assert.equal(r5.status, 200, '后台重置发码不占前台额度（分桶）');
      assert.equal((await r5.json()).retryAfterSec, 60, '后台发码也带 retryAfterSec');
      // 5) 后台同场景冷却仍生效（分桶不取消同场景互斥）
      const r6 = await fetch(base + '/api/admin/users/alice/reset-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: '{}',
      });
      assert.equal(r6.status, 429, '后台同场景 60 秒冷却仍生效');
      // 6) 匿名/普通用户不可用后台发码接口
      const anon = await fetch(base + '/api/admin/users/alice/reset-code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      assert.equal(anon.status, 401, '匿名 401');
      await db.createUser(q, { username: 'bob', password: 'bob123456' });
      const loginBob = await fetch(base + '/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'bob', password: 'bob123456' }),
      });
      const bobCookie = (loginBob.headers.get('set-cookie') ?? '').split(';')[0];
      const asBob = await fetch(base + '/api/admin/users/alice/reset-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: bobCookie },
        body: '{}',
      });
      assert.equal(asBob.status, 403, '普通用户 403');
    } finally {
      await srv.close();
    }
  } finally {
    await store.close();
    smtp.close();
  }
});

// 从假 SMTP 累积的邮件原文里解出最后一个 6 位验证码（multipart base64 段解码）。
function lastCodeFromMail(rawMail) {
  const codes = [];
  for (const line of String(rawMail ?? '').split(/\r?\n/)) {
    if (!/^[A-Za-z0-9+/=]{20,}$/.test(line)) continue;
    let text = '';
    try {
      text = Buffer.from(line, 'base64').toString('utf8');
    } catch {
      continue;
    }
    const m = /(\d{6})/.exec(text);
    if (m) codes.push(m[1]);
  }
  return codes[codes.length - 1] ?? null;
}

test('DT-4 后台重置密码验证码模式：错码返回剩余次数（弹窗不关）、过期/无码提示重发、正确码重置+踢会话+审计', async () => {
  const { server: smtp, state, port } = await startFakeSmtp();
  const store = await openStore('pglite:', {});
  try {
    await db.migrate(store);
    await ensureEmailSchema(store);
    const q = (sql, p) => store.query(sql, p);
    await db.createUser(q, { username: 'alice', password: 'alice123456' });
    await q("update users set email = 'alice@example.com', email_verified = true where username = 'alice'");
    await q(
      "insert into smtp_settings (id, host, port, secure, username, from_addr, enabled) values (1, '127.0.0.1', $1, false, 's@x.com', 's@x.com', true)",
      [port],
    );
    await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
    const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1' });
    const base = `http://127.0.0.1:${srv.port}`;
    const loginAdmin = await fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123456' }),
    });
    const cookie = (loginAdmin.headers.get('set-cookie') ?? '').split(';')[0];
    const pwdReset = (body) =>
      fetch(base + '/api/admin/users/alice/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify(body),
      });
    try {
      // 未发码就确认 → 提示先发送（弹窗不关）
      const noCode = await pwdReset({ code: '123456' });
      assert.equal(noCode.status, 400);
      assert.equal((await noCode.json()).code, 'no_code');
      // 发码
      const sent = await fetch(base + '/api/admin/users/alice/reset-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: '{}',
      });
      assert.equal(sent.status, 200);
      const code = lastCodeFromMail(state.data);
      assert.ok(code, '邮件里有验证码');
      // 错码 3 次：remainingAttempts 递减（前端显示「还剩 N 次机会」）；
      // 错码取一个必不等于真码的值（真码 +1 取模，防万一撞码）
      const wrongCode = String((Number(code) + 1) % 1000000).padStart(6, '0');
      let remaining = 5;
      for (let i = 0; i < 3; i += 1) {
        const r = await pwdReset({ code: wrongCode });
        assert.equal(r.status, 400);
        const b = await r.json();
        remaining = b.remainingAttempts;
        assert.ok(remaining >= 0 && remaining < 5, '错码返回剩余次数');
      }
      assert.equal(remaining, 2, '3 次错码后剩余 2 次');
      // 正确码 → 临时密码 + 会话被踢 + 审计
      const aliceLogin = await fetch(base + '/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'alice', password: 'alice123456' }),
      });
      const aliceCookie = (aliceLogin.headers.get('set-cookie') ?? '').split(';')[0];
      const ok = await pwdReset({ code });
      assert.equal(ok.status, 200, JSON.stringify(await ok.clone().text()));
      const okBody = await ok.json();
      // 临时密码是 base64url（16 字符，含 -_ 与字母数字），只在响应里出现一次
      assert.match(okBody.tempPassword ?? '', /^[A-Za-z0-9_-]{16}$/, '生成临时密码只回一次');
      assert.equal((await q("select count(*)::int as n from sessions where user_id = (select id from users where username='alice')")).rows[0].n, 0, '重置后会话全部被踢');
      const audit = (await q("select action from audit_logs where actor = 'admin' order by id desc limit 1")).rows[0];
      assert.equal(audit?.action, 'admin.password_reset_code', '验证码重置落审计');
      // 验证码一次性：再次用同一码 → no_code
      const replay = await pwdReset({ code });
      assert.equal(replay.status, 400);
      assert.equal((await replay.json()).code, 'no_code', '验证码一次性使用');
    } finally {
      await srv.close();
    }
  } finally {
    await store.close();
    smtp.close();
  }
});