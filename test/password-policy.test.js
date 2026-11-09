// 密码策略与哈希升级（docs/AUTH-REDESIGN.md §7 验收 1、2 前半 + §4.1/§4.2，AK-1 批）：
// 策略纯函数（长度/常见/身份/全同/连续/评分）、哈希新格式与旧格式兼容、登录静默升级、
// 弱密码评估落库、/api/password/check 匿名限流、各设置密码入口规则一致（建号/重置/自助重置/初始化）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scryptSync, randomBytes } from 'node:crypto';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer } from '../src/server.js';
import { ensureEmailSchema, hashCode } from '../src/email-auth.js';
import { evaluatePassword, passwordPolicyError, MIN_LENGTH, MAX_LENGTH, REASON_TEXT } from '../src/password-policy.js';

process.env.CAPTCHA_ENABLED = '0';

test('策略：长度下限 12 / 上限 200；11 位拒绝、12 位随机短语通过', () => {
  assert.equal(MIN_LENGTH, 12);
  assert.equal(MAX_LENGTH, 200);
  assert.equal(evaluatePassword('12345678901').ok, false, '11 位拒绝');
  assert.match(REASON_TEXT.too_short, /至少 12 位/);
  assert.equal(evaluatePassword('correct-horse-battery-staple').ok, true, '20 位随机短语通过');
  assert.equal(evaluatePassword('a'.repeat(201)).reasons.includes('too_long'), true, '超长拒绝');
});

test('策略：常见密码与数字尾巴变体拒绝（含验收 1 的 password1234）', () => {
  for (const pw of ['password1234', 'password123456', 'letmein1234', 'qwerty123456', '123456']) {
    assert.ok(evaluatePassword(pw).reasons.includes('common'), `${pw} 应命中 common`);
  }
  assert.ok(evaluatePassword('123456').reasons.includes('common'), 'Top 1 万内直接命中');
});

test('策略：含用户名 / 邮箱 @ 前部分（长度 ≥4、忽略大小写）拒绝；短身份不误伤', () => {
  assert.equal(evaluatePassword('MyAlice2026Secure!', { username: 'alice' }).ok, false, '含用户名');
  assert.equal(evaluatePassword('AliceBig2026!!', { username: 'ALICE' }).ok, false, '忽略大小写');
  assert.equal(evaluatePassword('MailBox2026!!', { email: 'mailbox@example.com' }).ok, false, '含邮箱前部');
  assert.equal(evaluatePassword('Bob2026Secure!', { username: 'bob' }).ok, true, '3 字身份不触发');
});

test('策略：全同字符与连续序列（≥6）拒绝；评分区间与压制规则', () => {
  assert.equal(evaluatePassword('aaaaaaaaaaaa').reasons.includes('repeated'), true, '全同字符');
  assert.equal(evaluatePassword('abcdefghijkl').reasons.includes('sequential'), true, '连续字母');
  assert.equal(evaluatePassword('123456789012').reasons.includes('sequential'), true, '连续数字');
  assert.equal(evaluatePassword('abcdef0123456789').reasons.includes('sequential'), true, '串内连续段');
  const s12 = evaluatePassword('k7Qw!2mXp3nZ'); // 12 位
  assert.equal(s12.score, 2, '12–15 位 = 2');
  const s16 = evaluatePassword('k7Qw!2mXp3nZv9Rc'); // 16 位
  assert.equal(s16.score, 3, '16–19 位 = 3');
  assert.equal(evaluatePassword('correct-horse-battery-staple').score, 4, '≥20 位 = 4');
  assert.equal(evaluatePassword('password1234').score, 0, 'common 压到 0');
  assert.equal(evaluatePassword('Alice2026Secure!!', { username: 'alice' }).score, 1, 'contains_identity 压到 1');
  assert.ok(Array.isArray(evaluatePassword('123').suggestions) && evaluatePassword('123').suggestions.length > 0, '带建议');
});

test('哈希：新格式 $scrypt$32768$8$1$ 往返可验；旧格式 salt:hash 兼容；needsRehash 判定', () => {
  const fresh = db.hashPassword('correct-horse-battery-staple');
  assert.match(fresh, /^\$scrypt\$32768\$8\$1\$/, '新格式带算法与参数');
  assert.equal(db.verifyPassword('correct-horse-battery-staple', fresh), true);
  assert.equal(db.verifyPassword('wrong-password-xx', fresh), false);
  assert.equal(db.passwordNeedsRehash(fresh), false, '新格式不需要升级');
  // 旧格式（N=16384 默认参数）继续可验
  const salt = randomBytes(16).toString('hex');
  const legacy = `${salt}:${scryptSync('legacy-pass-2026', salt, 64).toString('hex')}`;
  assert.equal(db.verifyPassword('legacy-pass-2026', legacy), true, '旧格式兼容');
  assert.equal(db.verifyPassword('wrong-pass', legacy), false);
  assert.equal(db.passwordNeedsRehash(legacy), true, '旧格式标记需升级');
  assert.equal(db.passwordNeedsRehash(''), false);
});

test('登录成功后：旧哈希静默升级为新格式 + weak_password 评估落库', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  try {
    // 老账号：旧格式哈希 + 弱密码
    const salt = randomBytes(16).toString('hex');
    const legacy = `${salt}:${scryptSync('password1234', salt, 64).toString('hex')}`;
    const created = await db.createUser(q, { username: 'olduser', password: 'password1234' });
    await q('update users set password_hash = $1 where id = $2', [legacy, created.id]);
    const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1' });
    const base = `http://127.0.0.1:${srv.port}`;
    try {
      const res = await fetch(`${base}/api/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'olduser', password: 'password1234' }),
      });
      assert.equal(res.status, 200, '旧哈希老账号仍能登录');
      const row = (await q('select password_hash, weak_password, password_updated_at from users where id = $1', [created.id])).rows[0];
      assert.match(row.password_hash, /^\$scrypt\$/, '登录后静默升级为新格式');
      assert.equal(row.weak_password, true, '弱密码评估落库 true');
      assert.ok(row.password_updated_at, 'password_updated_at 更新');
    } finally {
      await srv.close();
    }
  } finally {
    await store.close();
  }
});

test('/api/password/check：匿名返回评估结果，不回显用户信息；每 IP 每分钟 30 次后 429', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${srv.port}`;
  try {
    const check = async (password) => {
      const res = await fetch(`${base}/api/password/check`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password, username: 'alice', email: 'alice@example.com' }),
      });
      return { status: res.status, body: await res.json() };
    };
    const weak = await check('alice1234');
    assert.equal(weak.status, 200);
    assert.equal(weak.body.ok, false);
    assert.ok(weak.body.reasons.length > 0, '带 reasons');
    assert.equal(typeof weak.body.score, 'number');
    const strong = await check('correct-horse-battery-staple');
    assert.equal(strong.body.ok, true);
    assert.equal(strong.body.score, 4);
    let limited = null;
    for (let i = 0; i < 30; i += 1) await check('x'.repeat(12));
    limited = await check('x'.repeat(12));
    assert.equal(limited.status, 429, '第 31 次触发限流');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('入口一致：后台建号 / 后台重置 / 自助重置 / 初始化 全部拒绝弱密码（同一策略文案）', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  await ensureEmailSchema(store);
  const q = (sql, p) => store.query(sql, p);
  await db.createUser(q, { username: 'admin', password: 'correct-horse-battery-staple', role: 'admin', email: 'admin@example.com' });
  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${srv.port}`;
  const login = async (username, password) => {
    const res = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    return (res.headers.get('set-cookie') ?? '').split(';')[0];
  };
  try {
    const cookie = await login('admin', 'correct-horse-battery-staple');
    const post = (path, body, headers = {}) =>
      fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    // 后台建号：弱密码拒绝（11 位 + 含身份）
    let r = await post('/api/admin/users', { username: 'alice', password: 'alice1234', role: 'user' }, { cookie });
    assert.equal(r.status, 400, '后台建号拒绝弱密码');
    assert.match((await r.json()).error, /密码不符合要求/, '统一策略文案');
    // 后台建号：强密码通过（12 位随机）
    r = await post('/api/admin/users', { username: 'alice', password: 'k7Qw!2mXp3nZ', role: 'user' }, { cookie });
    assert.equal(r.status, 201, '强密码建号通过');
    // 后台重置：弱密码拒绝
    r = await post('/api/admin/users/alice/password', { password: 'alice1234' }, { cookie });
    assert.equal(r.status, 400, '后台重置拒绝弱密码');
    // 自助重置：正确验证码 + 弱密码 → 400
    const email = 'alice@example.com';
    await q("update users set email = $1, email_verified = true where username = 'alice'", [email]);
    const code = '654321';
    await q(
      "insert into email_codes (email, user_id, purpose, code_hash, expires_at) values ($1, (select id from users where username = 'alice'), 'reset', $2, now() + interval '5 minutes')",
      [email, hashCode(email, code)],
    );
    r = await post('/api/auth/email/verify', { email, code, purpose: 'reset', password: 'alice1234' });
    assert.equal(r.status, 400, '自助重置拒绝弱密码');
    assert.match((await r.json()).error, /密码不符合要求/);
    // 初始化（setup）：新库上弱密码拒绝（setup 只在未初始化时可用，另起一个库验证）
  } finally {
    await srv.close();
    await store.close();
  }
});

test('初始化入口：/api/setup/complete 拒绝弱密码；强密码通过', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  await ensureEmailSchema(store);
  const settingsMod = await import('../src/settings.js');
  await settingsMod.ensureSettingsSchema(store);
  settingsMod.resetSettingsCache();
  await settingsMod.initializeSettings({ store, env: {}, secretKey: settingsMod.secretKeyFor() });
  const q = (sql, p) => store.query(sql, p);
  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1', store });
  const base = `http://127.0.0.1:${srv.port}`;
  try {
    const complete = (password) =>
      fetch(`${base}/api/setup/complete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ admin: { username: 'admin', password, email: 'admin@example.com' }, settings: {} }),
      });
    const weak = await complete('admin123456');
    assert.equal(weak.status, 400, 'setup 拒绝弱密码');
    assert.match((await weak.json()).error, /密码不符合要求/);
    const ok = await complete('correct-horse-battery-staple');
    assert.equal(ok.status, 200, 'setup 强密码通过');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('静态：CLI 建号同样走 passwordPolicyError（不再各写 length < 8）', () => {
  const cli = readFileSync(fileURLToPath(new URL('../src/cli.js', import.meta.url)), 'utf8');
  assert.match(cli, /passwordPolicyError\(password/, 'cli.js 用同一策略');
  assert.ok(!cli.includes('密码需要 8-200 位'), '旧的 8-200 位检查已移除');
  const setup = readFileSync(fileURLToPath(new URL('../src/setup-routes.js', import.meta.url)), 'utf8');
  assert.match(setup, /passwordPolicyError/, 'setup-routes.js 用同一策略');
  const authRoutes = readFileSync(fileURLToPath(new URL('../src/auth-routes.js', import.meta.url)), 'utf8');
  assert.match(authRoutes, /passwordPolicyError/, 'auth-routes.js 用同一策略');
});

test('passwordPolicyError：入口辅助返回 null 或一句含原因的中文', () => {
  assert.equal(passwordPolicyError('correct-horse-battery-staple'), null);
  assert.match(passwordPolicyError('123'), /至少 12 位/);
  assert.match(passwordPolicyError('password1234'), /过于常见/);
});
