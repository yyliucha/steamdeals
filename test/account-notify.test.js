// 账号变更通知（docs/USER-LIFECYCLE.md §4.2/§8 验收 5–7、11，AJ 批）：
// 8 类事件渲染与发送（收件人/主题/正文、操作者固定「站点管理员」、变量转义、统一页脚）、
// 无邮箱跳过 / 模板停用跳过 / SMTP 未配置与发送失败都落 mail_log 且不影响业务、
// 串行队列一封一封发、PATCH 各字段触发对应事件且一次最多一封、重置密码正文不含新密码、
// 改邮箱两封（旧邮箱空/未验证→新邮箱；相同只发一封；解绑不发）、删除异步通知、
// 批量禁用/启用不发任何用户邮件（决策 9）。
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer } from '../src/server.js';
import { ensureEmailSchema } from '../src/email-auth.js';
import {
  NOTIFY_ACTIONS,
  timeInZone,
  notifyUserAction,
  notifyUserActionQueued,
  waitForNotifyQueue,
} from '../src/account-notify.js';

// 测试里关掉登录验证码（与 admin-users.test.js 同款）
process.env.CAPTCHA_ENABLED = '0';

/** 假 SMTP 服务器：记录命令、收件人与邮件正文（与 email-auth.test.js 同款协议桩）。 */
function startFakeSmtp() {
  const state = { commands: [], data: '', rcpt: [] };
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
        if (/^EHLO/i.test(line)) socket.write('250-fake\r\n250 AUTH PLAIN LOGIN\r\n250 HELP\r\n');
        else if (/^MAIL FROM/i.test(line)) socket.write('250 2.1.0 Ok\r\n');
        else if (/^RCPT TO/i.test(line)) {
          state.rcpt.push(line);
          socket.write('250 2.1.5 Ok\r\n');
        } else if (/^DATA/i.test(line)) {
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

/** 从 SMTP 收到的报文里解出所有 Subject（中文主题是 RFC 2047 base64）。 */
function mailSubjects(fake) {
  const subjects = [];
  for (const line of fake.state.data.split('\r\n')) {
    const m = /^Subject: (.*)$/.exec(line);
    if (!m) continue;
    const v = m[1];
    subjects.push(v.startsWith('=?UTF-8?B?') ? Buffer.from(v.slice(10, -2), 'base64').toString('utf8') : v);
  }
  return subjects;
}

/** 解出全部正文段（text/plain 与 text/html 的 base64 段）拼成的可读文本，用于断言正文内容。 */
function decodedBodies(fake) {
  const parts = [];
  for (const line of fake.state.data.split('\r\n')) {
    if (!/^[A-Za-z0-9+/=]{40,}$/.test(line)) continue; // 只挑 base64 内容行，跳过头与分隔线
    try {
      parts.push(Buffer.from(line, 'base64').toString('utf8'));
    } catch {
      /* 非 base64 行 */
    }
  }
  return parts.join('\n');
}

/** 每个 HTTP 测试独立环境：pglite + 假 SMTP（smtp_settings 落库）+ 管理员会话。 */
async function setup() {
  const fake = await startFakeSmtp();
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  await ensureEmailSchema(store);
  const q = (sql, p) => store.query(sql, p);
  await q(
    "insert into smtp_settings (id, host, port, secure, username, password_enc, from_addr, enabled) values (1, '127.0.0.1', $1, false, '', null, 'noreply@steamdeals.test', true)",
    [fake.port],
  );
  await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin', email: 'admin@example.com' });
  await q("update users set email_verified = true where username = 'admin'");
  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${srv.port}`;
  const login = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123456' }),
  });
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
  const close = async () => {
    await srv.close();
    fake.server.close(); // 必须关：监听句柄不关，node:test 跑完事件循环不退出
    await store.close();
  };
  return { store, q, srv, base, cookie, fake, close };
}

test('8 类事件：渲染变量转义、HTML 双段、统一页脚、操作者固定「站点管理员」、mail_log 落成功行', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  await ensureEmailSchema(store);
  const q = (sql, p) => store.query(sql, p);
  try {
    await q(
      "insert into smtp_settings (id, host, port, secure, username, password_enc, from_addr, enabled) values (1, '127.0.0.1', 25, false, '', null, 'from@x.test', true)",
    );
    assert.equal(NOTIFY_ACTIONS.length, 8, '8 类账号通知事件');
    const sent = [];
    const fakeSend = async (mail) => {
      sent.push(mail);
      return { ok: true };
    };
    const cases = [
      ['account_disabled', {}],
      ['account_enabled', {}],
      ['account_deleted', {}],
      ['account_renamed', { action: '新名字' }],
      ['account_email_changed', { action: 'n***@x.test' }],
      ['account_email_bound', { action: 'n***@x.test' }],
      ['account_role_changed', { action: '管理员' }],
      ['account_password_reset', {}],
    ];
    for (const [action, extra] of cases) {
      const r = await notifyUserAction({
        q,
        user: { username: 'alice', email: 'alice@x.test' },
        action,
        extra,
        actor: 'root_admin',
        siteUrl: 'https://s.test',
        contactEmail: 'contact@x.test',
        send: fakeSend,
      });
      assert.equal(r.status, 'sent', `${action} 应发送成功`);
    }
    assert.equal(sent.length, 8);
    for (const mail of sent) {
      assert.equal(mail.to, 'alice@x.test', '收件人是用户邮箱');
      assert.ok(mail.html, '账号通知必须是 HTML 邮件');
      assert.ok(mail.text, '要有纯文本兜底');
      assert.match(mail.html, /本邮件由系统自动发送，请勿直接回复/, '统一页脚由代码追加');
      assert.ok(!String(mail.text + mail.html).includes('root_admin'), '正文不暴露操作者账号（决策 15）');
    }
    assert.match(sent[7].text, /请向站点管理员获取新密码/, '重置密码只写"向管理员获取"，不含新密码');
    // {{action}} 变量必须转义（防模板注入）
    await notifyUserAction({
      q,
      user: { username: 'alice', email: 'alice@x.test' },
      action: 'account_renamed',
      extra: { action: '<b>注入</b>' },
      actor: 'root_admin',
      send: fakeSend,
    });
    assert.ok(sent[8].html.includes('&lt;b&gt;注入&lt;/b&gt;'), '显示名变量要 HTML 转义');
    assert.ok(!sent[8].html.includes('<b>注入</b>'), '不得原样注入标签');
    // to 覆盖（改邮箱用旧邮箱收「已变更」）
    await notifyUserAction({
      q,
      user: { username: 'alice', email: 'new@x.test' },
      action: 'account_email_changed',
      to: 'old@x.test',
      extra: { action: 'n***@x.test' },
      actor: 'root_admin',
      send: fakeSend,
    });
    assert.equal(sent[9].to, 'old@x.test', 'to 覆盖收件人');
    const rows = await db.listMailLog(q, { limit: 20 });
    assert.equal(rows.length, 10, '每次真实发送写一行 mail_log');
    assert.ok(rows.every((r) => r.ok === true), 'mail_log 全部 ok=true');
    assert.ok(rows.every((r) => r.actor === 'root_admin'), 'actor 记录触发者');
  } finally {
    await store.close();
  }
});

test('跳过与失败：无邮箱跳过、模板停用跳过、SMTP 未配置/发送失败落 mail_log(ok=false) 且不抛异常', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  await ensureEmailSchema(store);
  const q = (sql, p) => store.query(sql, p);
  try {
    await db.upsertMailTemplate(q, { event: 'account_enabled', subject: 's', bodyHtml: '<p>{{username}}</p>', enabled: false });
    let calls = 0;
    const fakeSend = async () => {
      calls += 1;
      return { ok: true };
    };
    const none = await notifyUserAction({ q, env: {}, user: { username: 'ghost', email: '' }, action: 'account_disabled', send: fakeSend });
    assert.equal(none.status, 'skipped_no_email', '未绑定邮箱跳过');
    const off = await notifyUserAction({ q, env: {}, user: { username: 'alice', email: 'a@x.test' }, action: 'account_enabled', send: fakeSend });
    assert.equal(off.status, 'skipped_disabled', '模板停用跳过');
    assert.equal(calls, 0, '跳过时不发起 SMTP 连接');

    const nocfg = await notifyUserAction({ q, env: {}, user: { username: 'alice', email: 'a@x.test' }, action: 'account_disabled', send: fakeSend });
    assert.equal(nocfg.status, 'failed');
    assert.equal(nocfg.error, 'SMTP 未配置');
    assert.equal(calls, 0, 'SMTP 未配置不发连接');
    let rows = await db.listMailLog(q, { limit: 10 });
    assert.equal(rows.length, 1, '跳过不写 mail_log，只有真实尝试才写');
    assert.equal(rows[0].ok, false);
    assert.equal(rows[0].error, 'SMTP 未配置');

    const boom = await notifyUserAction({
      q,
      env: { SMTP_HOST: 'smtp.test', SMTP_FROM: 'f@x.test' },
      user: { username: 'alice', email: 'a@x.test' },
      action: 'account_disabled',
      send: async () => ({ ok: false, error: '连接超时' }),
    });
    assert.equal(boom.status, 'failed', '发送失败返回 failed，不抛异常（业务不受影响）');
    assert.equal(boom.error, '连接超时');
    const thrown = await notifyUserAction({
      q,
      env: { SMTP_HOST: 'smtp.test', SMTP_FROM: 'f@x.test' },
      user: { username: 'alice', email: 'a@x.test' },
      action: 'account_deleted',
      send: async () => {
        throw new Error('socket 中断');
      },
    });
    assert.equal(thrown.status, 'failed', '发送器抛异常同样收敛成 failed');
    assert.match(thrown.error, /socket 中断/);
    rows = await db.listMailLog(q, { limit: 10 });
    assert.equal(rows.length, 3, '两次失败各落一行');
    assert.equal(rows[0].event, 'account_deleted');
    assert.equal(rows[0].ok, false);
    assert.match(rows[0].error, /socket 中断/);
  } finally {
    await store.close();
  }
});

test('串行队列：并发排队一封一封发（同一时刻只有一个在途，顺序保持）', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  await ensureEmailSchema(store);
  const q = (sql, p) => store.query(sql, p);
  try {
    await q(
      "insert into smtp_settings (id, host, port, secure, username, password_enc, from_addr, enabled) values (1, '127.0.0.1', 25, false, '', null, 'from@x.test', true)",
    );
    let inFlight = 0;
    let maxInFlight = 0;
    const order = [];
    const fakeSend = async (mail) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      order.push(mail.subject);
      await new Promise((r) => setTimeout(r, 20));
      inFlight -= 1;
      return { ok: true };
    };
    const p1 = notifyUserActionQueued({ q, env: {}, user: { username: 'a', email: 'a@x.test' }, action: 'account_disabled', send: fakeSend });
    const p2 = notifyUserActionQueued({ q, env: {}, user: { username: 'a', email: 'a@x.test' }, action: 'account_enabled', send: fakeSend });
    const p3 = notifyUserActionQueued({ q, env: {}, user: { username: 'a', email: 'a@x.test' }, action: 'account_deleted', send: fakeSend });
    const results = await Promise.all([p1, p2, p3]);
    await waitForNotifyQueue();
    assert.ok(results.every((r) => r.status === 'sent'));
    assert.equal(maxInFlight, 1, '同一时刻最多一封在途（避免 SMTP 并发限流）');
    assert.deepEqual(order, ['你的账号已被停用', '你的账号已恢复', '你的账号已被删除'], '按排队顺序发送');
  } finally {
    await store.close();
  }
});

test('timeInZone：站点时区 YYYY-MM-DD HH:mm；非法时区回落', () => {
  assert.match(timeInZone(new Date('2026-11-06T09:45:00Z'), 'Asia/Shanghai'), /^2026-11-06 17:45$/);
  assert.match(timeInZone(new Date('2026-11-06T09:45:00Z'), 'UTC'), /^2026-11-06 09:45$/);
  assert.match(timeInZone(new Date('2026-11-06T09:45:00Z'), 'Not/AZone'), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, '非法时区回落本地时间格式');
});

test('PATCH 入口：禁用/启用/角色/改名各发对应事件；优先级只发一封；无变化不发；响应带 notify', async () => {
  const { store, q, srv, base, cookie, fake, close } = await setup();
  try {
    await db.createUser(q, { username: 'alice', password: 'alice123456', email: 'alice@example.com' });
    await q("update users set email_verified = true where username = 'alice'");
    const patch = async (username, body) => {
      const res = await fetch(`${base}/api/admin/users/${username}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify(body),
      });
      return { status: res.status, body: await res.json() };
    };
    // 禁用 → account_disabled
    let r = await patch('alice', { disabled: true, reason: '测试禁用' });
    assert.equal(r.status, 200);
    assert.equal(r.body.notify.status, 'sent');
    assert.match(fake.state.rcpt[0], /alice@example\.com/);
    assert.equal(mailSubjects(fake).at(-1), '你的账号已被停用');
    // 启用 → account_enabled
    r = await patch('alice', { disabled: false });
    assert.equal(r.body.notify.status, 'sent');
    assert.equal(mailSubjects(fake).at(-1), '你的账号已恢复');
    // 角色 → account_role_changed（正文含新角色）
    r = await patch('alice', { role: 'admin' });
    assert.equal(r.body.notify.status, 'sent');
    assert.equal(mailSubjects(fake).at(-1), '你的账号权限已变更');
    assert.match(decodedBodies(fake), /管理员/);
    // 改名 → account_renamed（变量转义）
    r = await patch('alice', { display_name: '<b>新名</b>' });
    assert.equal(r.body.notify.status, 'sent');
    assert.equal(mailSubjects(fake).at(-1), '你的显示名已修改');
    assert.ok(decodedBodies(fake).includes('&lt;b&gt;新名&lt;/b&gt;'), '显示名必须转义');
    assert.ok(!decodedBodies(fake).includes('<b>新名</b>'), '不得原样注入');
    // 优先级：同时改三项 → 只发一封（disabled > role > display_name）
    const n = fake.state.rcpt.length;
    r = await patch('alice', { disabled: true, role: 'user', display_name: 'x' });
    assert.equal(r.body.notify.status, 'sent');
    assert.equal(fake.state.rcpt.length, n + 1, '一次请求最多一封');
    assert.equal(mailSubjects(fake).at(-1), '你的账号已被停用', 'disabled 优先级最高');
    // 无变化 → 不通知、响应无 notify 字段
    r = await patch('alice', { disabled: true });
    assert.equal(r.status, 200);
    assert.equal(r.body.notify, undefined, '字段没变不发邮件');
  } finally {
    await close();
  }
});

test('重置密码入口：触发 account_password_reset，正文绝不出现新密码明文', async () => {
  const { store, q, srv, base, cookie, fake, close } = await setup();
  try {
    await db.createUser(q, { username: 'alice', password: 'alice123456', email: 'alice@example.com' });
    const res = await fetch(`${base}/api/admin/users/alice/password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ password: 'NewSecret!2026' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.notify.status, 'sent');
    assert.equal(mailSubjects(fake).at(-1), '你的密码已被重置');
    assert.ok(!decodedBodies(fake).includes('NewSecret!2026'), '正文绝不能出现新密码明文');
    const rows = await db.listMailLog(q, { limit: 5 });
    assert.equal(rows[0].event, 'account_password_reset');
    assert.equal(rows[0].actor, 'admin');
  } finally {
    await close();
  }
});

test('改邮箱入口：两封（旧邮箱「已变更」+ 新邮箱「绑定成功」）；相同只发一封；旧邮箱未验证改发新邮箱；解绑不发', async () => {
  const { store, q, srv, base, cookie, fake, close } = await setup();
  try {
    await db.createUser(q, { username: 'alice', password: 'alice123456', email: 'old@example.com' });
    await q("update users set email_verified = true where username = 'alice'");
    const bind = async (email) => {
      const res = await fetch(`${base}/api/admin/users/alice/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ email }),
      });
      return { status: res.status, body: await res.json() };
    };
    // 旧邮箱已验证 → 旧邮箱收「已变更」+ 新邮箱收「绑定成功」，共两封
    let r = await bind('new@example.com');
    assert.equal(r.status, 200);
    assert.equal(r.body.notify, 'queued', '改邮箱异步发送');
    await waitForNotifyQueue();
    assert.equal(fake.state.rcpt.length, 2, '两封');
    assert.deepEqual(fake.state.rcpt.map((l) => /<([^>]+)>/.exec(l)[1]), ['old@example.com', 'new@example.com'], '分别发旧/新邮箱');
    assert.deepEqual(mailSubjects(fake), ['你的登录邮箱已变更', '新邮箱绑定成功']);
    assert.match(decodedBodies(fake), /ne\*\*\*@example\.com/, '正文里的新邮箱必须打码（maskEmail 保留名字前 2 位）');
    assert.ok(!decodedBodies(fake).includes('new@example.com'), '正文不得出现完整新邮箱');
    // 再次绑定同一邮箱 → 只发「绑定成功」一封
    const n2 = fake.state.rcpt.length;
    await bind('new@example.com');
    await waitForNotifyQueue();
    assert.equal(fake.state.rcpt.length, n2 + 1, '新旧邮箱相同只发一封');
    assert.equal(mailSubjects(fake).at(-1), '新邮箱绑定成功');
    // 旧邮箱未验证（上一步绑定后 email_verified=false）→ 变更通知改发新邮箱，两封都进新邮箱
    await bind('third@example.com');
    await waitForNotifyQueue();
    const last2 = fake.state.rcpt.slice(-2).map((l) => /<([^>]+)>/.exec(l)[1]);
    assert.deepEqual(last2, ['third@example.com', 'third@example.com'], '旧邮箱未验证时两封都发新邮箱');
    assert.deepEqual(mailSubjects(fake).slice(-2), ['你的登录邮箱已变更', '新邮箱绑定成功']);
    // 解绑（空邮箱）→ 不发任何邮件
    const n4 = fake.state.rcpt.length;
    r = await bind('');
    assert.equal(r.status, 200);
    assert.equal(r.body.notify, undefined, '解绑不发通知');
    await waitForNotifyQueue();
    assert.equal(fake.state.rcpt.length, n4, '解绑不发邮件');
  } finally {
    await close();
  }
});

test('删除入口：notify=queued 异步发 account_deleted 且原因不进正文；无邮箱 skipped_no_email；批量禁用/启用不发邮件', async () => {
  const { store, q, srv, base, cookie, fake, close } = await setup();
  try {
    const alice = await db.createUser(q, { username: 'alice', password: 'alice123456', email: 'alice@example.com' });
    await q("update users set email_verified = true where username = 'alice'");
    // 有邮箱：响应 queued，邮件异步发出，mail_log 落 actor=admin
    const del = await fetch(`${base}/api/admin/users/alice`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ confirmUsername: 'alice', reason: '违规操作' }),
    });
    assert.equal(del.status, 200);
    const delBody = await del.json();
    assert.equal(delBody.notify, 'queued', '删除响应立即返回，不阻塞发送');
    await waitForNotifyQueue();
    assert.equal(mailSubjects(fake).at(-1), '你的账号已被删除');
    assert.ok(!decodedBodies(fake).includes('违规操作'), '删除原因不进邮件正文（决策 10）');
    const logs = await db.listMailLog(q, { limit: 5 });
    assert.equal(logs[0].event, 'account_deleted');
    assert.equal(logs[0].ok, true);
    assert.equal(logs[0].actor, 'admin');
    // 无邮箱：notify=skipped_no_email，不发邮件
    const bob = await db.createUser(q, { username: 'bob', password: 'bob123456' });
    const n = fake.state.rcpt.length;
    const del2 = await fetch(`${base}/api/admin/users/bob`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ confirmUsername: 'bob' }),
    });
    assert.equal((await del2.json()).notify, 'skipped_no_email');
    await waitForNotifyQueue();
    assert.equal(fake.state.rcpt.length, n, '无邮箱不发邮件');
    // 批量禁用/启用：只记日志，不发任何用户邮件（决策 9）
    const carol = await db.createUser(q, { username: 'carol', password: 'carol123456', email: 'carol@example.com' });
    const disable = await fetch(`${base}/api/admin/bulk`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ target: 'users', action: 'disable', keys: [carol.id], confirmCount: 1 }),
    });
    assert.equal(disable.status, 200);
    assert.equal((await disable.json()).ok, 1);
    await waitForNotifyQueue();
    assert.equal(fake.state.rcpt.length, n, '批量禁用不发邮件');
    const enable = await fetch(`${base}/api/admin/bulk`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ target: 'users', action: 'enable', keys: [carol.id] }),
    });
    assert.equal(enable.status, 200);
    assert.equal((await enable.json()).ok, 1);
    await waitForNotifyQueue();
    assert.equal(fake.state.rcpt.length, n, '批量启用不发邮件');
  } finally {
    await close();
  }
});
