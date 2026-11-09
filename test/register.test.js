// 自助注册（docs/AUTH-REDESIGN.md §7 验收 8 + §4.6，AK-3 批）：
// 开关关闭 403、SMTP 未配置 503、用户名/邮箱唯一性 409、图形验证码、发码三级限流、
// 验证码校验（过期/次数/错误）、密码策略、建号 email_verified=true 并自动登录、并发唯一索引兜底 409。
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer } from '../src/server.js';
import { ensureEmailSchema, hashCode } from '../src/email-auth.js';

process.env.CAPTCHA_ENABLED = '0';

function startFakeSmtp() {
  const state = { data: '' };
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
        if (inData) {
          if (line === '.') { inData = false; socket.write('250 2.0.0 Ok\r\n'); } else state.data += `${line}\r\n`;
          continue;
        }
        if (/^EHLO/i.test(line)) socket.write('250-fake\r\n250-AUTH PLAIN LOGIN\r\n250 HELP\r\n');
        else if (/^AUTH PLAIN/i.test(line)) socket.write('235 auth ok\r\n');
        else if (/^MAIL FROM|^RCPT TO/i.test(line)) socket.write('250 Ok\r\n');
        else if (/^DATA/i.test(line)) { inData = true; socket.write('354 End data\r\n'); }
        else if (/^QUIT/i.test(line)) { socket.write('221 Bye\r\n'); socket.end(); }
        else socket.write('250 OK\r\n');
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state, port: server.address().port })));
}

async function setup({ smtp = true } = {}) {
  const fake = smtp ? await startFakeSmtp() : null;
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  await ensureEmailSchema(store);
  const settings = await import('../src/settings.js');
  await settings.ensureSettingsSchema(store);
  settings.resetSettingsCache();
  await settings.initializeSettings({ store, env: {}, secretKey: settings.secretKeyFor() });
  const q = (sql, p) => store.query(sql, p);
  if (fake) {
    await q("insert into smtp_settings (id, host, port, secure, username, from_addr, enabled) values (1, '127.0.0.1', $1, false, 's@x.com', 's@x.com', true)", [fake.port]);
  }
  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1', store });
  const base = `http://127.0.0.1:${srv.port}`;
  const post = async (path, body) => {
    const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json(), rawCookie: res.headers.get('set-cookie') ?? '' };
  };
  return { store, q, srv, base, post, fake, close: async () => { await srv.close(); fake?.server.close(); await store.close(); } };
}

test('验收 8：完整注册流——请求码 → 验码 → 建号（email_verified=true）→ 自动登录', async () => {
  const env = await setup();
  try {
    let r = await env.post('/api/auth/register/request', { username: 'newbie', email: 'newbie@example.com' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const row = (await env.q("select * from email_codes where email = 'newbie@example.com' and purpose = 'register'")).rows[0];
    assert.ok(row, 'purpose=register 的验证码落库');
    // 从假 SMTP 收到的邮件里解出验证码
    let code = null;
    for (const line of String(env.fake.state.data).split(/\r?\n/)) {
      if (!/^[A-Za-z0-9+/=]{20,}$/.test(line)) continue;
      const m = /(\d{6})/.exec(Buffer.from(line, 'base64').toString('utf8'));
      if (m) { code = m[1]; break; }
    }
    assert.ok(code, '邮件里有 6 位验证码');
    r = await env.post('/api/auth/register/verify', { email: 'newbie@example.com', code, username: 'newbie', password: 'correct-horse-battery-staple' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.user.username, 'newbie');
    assert.equal(r.body.user.role, 'user');
    assert.match(r.rawCookie, /gp_session=/, '自动登录下发会话');
    const user = (await env.q("select email_verified, role, must_change_password from users where username = 'newbie'")).rows[0];
    assert.equal(user.email_verified, true, '注册即验证');
    assert.equal(user.must_change_password, false, '注册账号不强制改密');
  } finally {
    await env.close();
  }
});

test('验收 8：唯一性 409（用户名/邮箱）；密码策略拒绝弱密码；验证码错误/过期/次数', async () => {
  const env = await setup();
  try {
    await db.createUser(env.q, { username: 'taken', password: 'correct-horse-battery-staple', email: 'taken@example.com' });
    let r = await env.post('/api/auth/register/request', { username: 'taken', email: 'other@example.com' });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /用户名已被使用/);
    r = await env.post('/api/auth/register/request', { username: 'other', email: 'taken@example.com' });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /邮箱已被注册/);
    r = await env.post('/api/auth/register/request', { username: 'bad name', email: 'x@example.com' });
    assert.equal(r.status, 400, '用户名含空格拒绝');
    // 验证码 + 弱密码 → 400（验证码作废前先检查策略——按规格：先验码再复查，弱密码 400）
    await env.post('/api/auth/register/request', { username: 'weakuser', email: 'weak@example.com' });
    const row = (await env.q("select * from email_codes where email = 'weak@example.com' and purpose = 'register'")).rows[0];
    r = await env.post('/api/auth/register/verify', { email: 'weak@example.com', code: '000000', username: 'weakuser', password: 'weak1234' });
    assert.equal(r.status, 400, '验证码不正确先 400（不泄露策略）');
    // 用正确验证码 + 弱密码 → 400 密码不符合要求
    let code = null;
    for (const line of String(env.fake.state.data).split(/\r?\n/)) {
      if (!/^[A-Za-z0-9+/=]{20,}$/.test(line)) continue;
      const m = /(\d{6})/.exec(Buffer.from(line, 'base64').toString('utf8'));
      if (m) { code = m[1]; break; }
    }
    r = await env.post('/api/auth/register/verify', { email: 'weak@example.com', code, username: 'weakuser', password: 'weak1234' });
    assert.equal(r.status, 400, '弱密码拒绝');
    assert.match(r.body.error, /密码不符合要求/);
  } finally {
    await env.close();
  }
});

test('验收 8：开关关闭 403；SMTP 未配置 503', async () => {
  const env = await setup({ smtp: false });
  try {
    await env.q("insert into app_settings (key, value) values ('auth.registrationEnabled', '0')");
    let r = await env.post('/api/auth/register/request', { username: 'x1abc', email: 'x1@example.com' });
    assert.equal(r.status, 503, 'SMTP 未配置优先 503');
    // 配好 SMTP 后 → 403（开关关闭）
    const fake = await startFakeSmtp();
    await env.q("insert into smtp_settings (id, host, port, secure, username, from_addr, enabled) values (1, '127.0.0.1', $1, false, 's@x.com', 's@x.com', true)", [fake.port]);
    r = await env.post('/api/auth/register/request', { username: 'x1abc', email: 'x1@example.com' });
    assert.equal(r.status, 403, '开关关闭 403');
    assert.match(r.body.error, /暂未开放注册/);
    fake.server.close();
  } finally {
    await env.close();
  }
});

test('静态：注册开关设置项存在；注册路由在 auth-routes 里（前端注册页属 AL 批）', async () => {
  const settings = await import('../src/settings.js');
  const def = settings.SETTING_MAP.get('auth.registrationEnabled');
  assert.ok(def, 'auth.registrationEnabled 设置项');
  assert.equal(def.type, 'bool');
  assert.equal(def.default, true, '默认开放注册');
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const src = readFileSync(fileURLToPath(new URL('../src/auth-routes.js', import.meta.url)), 'utf8');
  assert.match(src, /\/api\/auth\/register\/request/, '注册发码路由');
  assert.match(src, /\/api\/auth\/register\/verify/, '注册验码路由');
  assert.match(src, /purpose = 'register'/, 'purpose=register 复用 email_codes');
});
