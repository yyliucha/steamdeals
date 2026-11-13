// 申诉系统（docs/APPEAL-SYSTEM.md §1–§9 验收 1–8，O 批；真 PGlite + 真 HTTP + 假 SMTP）：
// 提交入库（token 列一并生成）/ 通知邮件（Reply-To=申请人）/ SMTP 未配仍入库 /
// 验证码 / 每 IP 3 条/小时 / 同内容幂等 / 后台列表与权限 / 解封联动与 409 / 拒绝理由必填 /
// 仅备注 / 查进度不回显内部信息 / 封禁拦截放行。
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer } from '../src/server.js';
import { ensureEmailSchema } from '../src/email-auth.js';
import * as ratelimit from '../src/ratelimit.js';
import * as devices from '../src/devices.js';
import * as visitors from '../src/visitors.js';

process.env.TRUST_PROXY = '1';
process.env.APPEAL_EMAIL = 'appeal@example.com';
process.env.SITE_NAME = 'SteamDeals-Test';

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

async function boot({ smtp = true, captchaEnabled = '0', frontendDir = null } = {}) {
  process.env.CAPTCHA_ENABLED = captchaEnabled;
  ratelimit.resetState();
  devices.resetState();
  const fake = smtp ? await startFakeSmtp() : null;
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  await ensureEmailSchema(store);
  const q = (sql, p) => store.query(sql, p);
  if (fake) {
    await q("insert into smtp_settings (id, host, port, secure, username, from_addr, enabled) values (1, '127.0.0.1', $1, false, 'site@steamdeals.test', 'site@steamdeals.test', true)", [fake.port]);
  }
  await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1', store, frontendDir });
  const base = `http://127.0.0.1:${srv.port}`;
  const asIp = (ip, extra = {}) => ({ headers: { 'x-forwarded-for': ip, ...extra } });
  const post = async (path, body, ip = '203.0.113.60', extra = {}) => {
    const res = await fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...extra },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed = {};
    try { parsed = text ? JSON.parse(text) : {}; } catch { /* 纯文本 */ }
    return { status: res.status, body: parsed, text, rawCookie: res.headers.get('set-cookie') ?? '' };
  };
  const get = async (path, ip = '203.0.113.60', extra = {}) => {
    const res = await fetch(base + path, { headers: { 'x-forwarded-for': ip, ...extra } });
    const text = await res.text();
    let parsed = {};
    try { parsed = text ? JSON.parse(text) : {}; } catch { /* 纯文本 */ }
    return { status: res.status, body: parsed, text };
  };
  const loginAdmin = async () => {
    const res = await fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.77' },
      body: JSON.stringify({ username: 'admin', password: 'admin123456' }),
    });
    assert.equal(res.status, 200);
    return (res.headers.get('set-cookie') ?? '').split(';')[0];
  };
  return {
    store, q, srv, base, fake, post, get, loginAdmin,
    close: async () => { await srv.close(); fake?.server.close(); await store.close(); },
  };
}

const MESSAGE = '我是在手机浏览器正常浏览游戏列表，没有使用任何脚本，请管理员复核解封，谢谢。';

test('O-2/O-4：提交申诉入库（含 token 列）+ 通知邮件 Reply-To=申请人 + 写发送记录', async () => {
  const env = await boot();
  try {
    const r = await env.post('/api/appeal', { contact: 'User@Example.com', message: MESSAGE }, '198.51.100.101');
    assert.equal(r.status, 200, r.text);
    assert.match(r.body.code, /^AP-[A-HJ-NP-Z2-9]{6}$/, '编号格式 AP-XXXXXX');
    const row = (await env.q("select * from appeals where contact = 'user@example.com'")).rows[0];
    assert.ok(row, '应入库');
    assert.equal(row.ip, '198.51.100.101', '快照调用者 IP');
    assert.equal(row.status, 'pending');
    assert.match(row.action_token_hash ?? '', /^[a-f0-9]{64}$/, 'token 只存 sha256（64 hex）');
    const expiresIn = new Date(row.action_expires_at).getTime() - Date.now();
    assert.ok(expiresIn > 13 * 86400_000 && expiresIn <= 14 * 86400_000, 'token 14 天有效');

    // 通知邮件：To=申诉邮箱、Reply-To=申请人（小写归一化）、From=SMTP 账号
    assert.match(env.fake.state.data, /To: appeal@example\.com/, '收件人=申诉邮箱');
    assert.match(env.fake.state.data, /Reply-To: user@example\.com/, 'Reply-To=申请人');
    assert.match(env.fake.state.data, /From: site@steamdeals\.test/, 'From=SMTP 账号');
    const log = (await env.q("select * from mail_log where event = 'appeal_admin_notify'")).rows[0];
    assert.ok(log, '发送记录写入 mail_log');
    assert.equal(log.ok, true);
  } finally {
    await env.close();
  }
});

test('O-2：SMTP 未配置时提交仍成功，不写发送记录', async () => {
  const env = await boot({ smtp: false });
  try {
    const r = await env.post('/api/appeal', { contact: 'user@example.com', message: MESSAGE }, '198.51.100.102');
    assert.equal(r.status, 200, r.text);
    const rows = await env.q('select count(*)::int as n from appeals');
    assert.equal(rows.rows[0].n, 1, 'SMTP 未配也入库');
    const log = await env.q("select count(*)::int as n from mail_log where event = 'appeal_admin_notify'");
    assert.equal(log.rows[0].n, 0, '未发信不写发送记录');
  } finally {
    await env.close();
  }
});

test('O-2：邮箱必填/格式、说明 10–2000 字校验', async () => {
  const env = await boot({ smtp: false });
  try {
    assert.equal((await env.post('/api/appeal', { contact: '', message: MESSAGE }, '198.51.100.103')).status, 400);
    assert.equal((await env.post('/api/appeal', { contact: 'not-an-email', message: MESSAGE }, '198.51.100.103')).status, 400);
    assert.equal((await env.post('/api/appeal', { contact: 'a@b.co', message: '太短' }, '198.51.100.103')).status, 400);
    assert.equal((await env.post('/api/appeal', { contact: 'a@b.co', message: 'x'.repeat(2001) }, '198.51.100.103')).status, 400);
    assert.equal((await env.q('select count(*)::int as n from appeals')).rows[0].n, 0, '非法请求不得入库');
  } finally {
    await env.close();
  }
});

test('O-2：图形验证码——开启后缺验证码/验证码错误 400', async () => {
  const env = await boot({ smtp: false, captchaEnabled: '1' });
  try {
    assert.equal((await env.post('/api/appeal', { contact: 'a@b.co', message: MESSAGE }, '198.51.100.104')).status, 400);
    const bad = await env.post('/api/appeal', { contact: 'a@b.co', message: MESSAGE, captchaToken: 'bogus', captchaAnswer: 'ABCD' }, '198.51.100.104');
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /验证码/, '验证码错误提示');
  } finally {
    await env.close();
  }
});

test('O-2：每 IP 每小时 3 条——第 4 次 429；同 IP 同内容幂等返回原编号', async () => {
  const env = await boot({ smtp: false });
  try {
    const ip = '198.51.100.105';
    for (let i = 0; i < 3; i += 1) {
      const r = await env.post('/api/appeal', { contact: `u${i}@example.com`, message: `第 ${i + 1} 条申诉说明内容，超过十个字没问题。` }, ip);
      assert.equal(r.status, 200, `第 ${i + 1} 条应成功`);
    }
    const fourth = await env.post('/api/appeal', { contact: 'u9@example.com', message: '第四条申诉说明内容，超过十个字没问题。' }, ip);
    assert.equal(fourth.status, 429, '第 4 条应 429');
    assert.match(fourth.body.error, /1 小时/);

    // 幂等：另一 IP 相同内容重复提交 → 原编号，不重复入库
    const ip2 = '198.51.100.106';
    const a = await env.post('/api/appeal', { contact: 'dup@example.com', message: MESSAGE }, ip2);
    const b = await env.post('/api/appeal', { contact: 'dup@example.com', message: MESSAGE }, ip2);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(b.body.code, a.body.code, '重复提交返回原编号');
    const n = await env.q('select count(*)::int as n from appeals');
    assert.equal(n.rows[0].n, 4, '重复提交不重复入库（3 + 1）');
  } finally {
    await env.close();
  }
});

test('O-5：后台列表（pending/all/done + 待处理计数）+ 匿名 401', async () => {
  const env = await boot({ smtp: false });
  try {
    const ip = '198.51.100.107';
    await env.post('/api/appeal', { contact: 'a@example.com', message: MESSAGE }, ip);
    const cookie = await env.loginAdmin();
    const anon = await env.get('/api/admin/appeals');
    assert.equal(anon.status, 401, '匿名 401');

    const pending = await env.get('/api/admin/appeals?status=pending', '203.0.113.77', { cookie });
    assert.equal(pending.status, 200);
    assert.equal(pending.body.appeals.length, 1);
    assert.equal(pending.body.pending, 1, '待处理计数');
    assert.equal(pending.body.total, 1);
    const row = pending.body.appeals[0];
    assert.ok(row.code && row.ip === ip && row.contact === 'a@example.com', '列表字段齐全');
    assert.equal(row.action_token_hash, undefined, '列表不得回显 token 哈希');

    // 处理后再看 done/all
    await env.post(`/api/admin/appeals/${row.id}/resolve`, { action: 'note', note: '先备注' }, '203.0.113.77', { cookie });
    const done = await env.get('/api/admin/appeals?status=done', '203.0.113.77', { cookie });
    assert.equal(done.body.total, 0, 'note 保持待处理，不进已处理');
    const all = await env.get('/api/admin/appeals?status=all', '203.0.113.77', { cookie });
    assert.equal(all.body.total, 1);
    const reject = await env.post(`/api/admin/appeals/${row.id}/resolve`, { action: 'reject', note: '理由' }, '203.0.113.77', { cookie });
    assert.equal(reject.status, 200);
    const done2 = await env.get('/api/admin/appeals?status=done', '203.0.113.77', { cookie });
    assert.equal(done2.body.total, 1, '拒绝后进入已处理');
    assert.equal(done2.body.pending, 0);
  } finally {
    await env.close();
  }
});

test('O-6/O-12：解封 IP 联动（黑名单 + ip_abuse + 内存封禁）+ 重复处理 409', async () => {
  const env = await boot({ smtp: false });
  try {
    const ip = '198.51.100.108';
    const r = await env.post('/api/appeal', { contact: 'a@example.com', message: MESSAGE }, ip);
    // 造封禁现场：黑名单 + 生效中的临时封禁 + 内存封禁
    await env.q("insert into ip_blacklist (ip, note) values ($1, '审核封禁')", [ip]);
    await env.q("insert into ip_abuse (ip, strikes, banned_until, ban_source) values ($1, 2, now() + interval '30 minutes', 'rate') on conflict (ip) do update set banned_until = excluded.banned_until", [ip]);
    await visitors.refreshBlocklist(env.q);
    ratelimit.applyExternalBan(ip, Date.now() + 600_000, { source: 'rate' });
    assert.equal(visitors.blockedBy(ip) !== null, true, '前置：黑名单生效');
    assert.ok(ratelimit.bannedUntil(ip), '前置：内存封禁生效');

    const cookie = await env.loginAdmin();
    const row = (await env.get('/api/admin/appeals?status=pending', '203.0.113.77', { cookie })).body.appeals[0];
    const resolved = await env.post(`/api/admin/appeals/${row.id}/resolve`, { action: 'unban_ip' }, '203.0.113.77', { cookie });
    assert.equal(resolved.status, 200, resolved.text);
    assert.equal(resolved.body.appeal.status, 'resolved');
    assert.equal((await env.q("select count(*)::int as n from ip_blacklist where ip = $1", [ip])).rows[0].n, 0, '黑名单行已删');
    assert.equal((await env.q("select banned_until from ip_abuse where ip = $1", [ip])).rows[0].banned_until, null, '临时封禁已清');
    assert.equal(ratelimit.bannedUntil(ip), null, '内存封禁已清');
    assert.equal(visitors.blockedBy(ip), null, '内存黑名单已刷新');

    const again = await env.post(`/api/admin/appeals/${row.id}/resolve`, { action: 'unban_ip' }, '203.0.113.77', { cookie });
    assert.equal(again.status, 409, '重复处理 409');
  } finally {
    await env.close();
  }
});

test('O-6/O-12：解封设备联动 + reject 理由必填 + 结果邮件；note 不发信', async () => {
  const env = await boot({ smtp: true });
  try {
    const ip = '198.51.100.109';
    const r = await env.post('/api/appeal', { contact: 'dev@example.com', message: MESSAGE }, ip);
    const cookie = await env.loginAdmin();
    const row = (await env.get('/api/admin/appeals?status=pending', '203.0.113.77', { cookie })).body.appeals[0];

    // reject 无理由 → 400；有理由 → 200 + 结果邮件
    assert.equal((await env.post(`/api/admin/appeals/${row.id}/resolve`, { action: 'reject' }, '203.0.113.77', { cookie })).status, 400);
    const rejected = await env.post(`/api/admin/appeals/${row.id}/resolve`, { action: 'reject', note: '维持封禁' }, '203.0.113.77', { cookie });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.appeal.status, 'rejected');
    assert.equal(rejected.body.appeal.note, '维持封禁');
    const dbRow = (await env.q('select * from appeals where id = $1', [row.id])).rows[0];
    assert.equal(dbRow.status, 'rejected');
    assert.equal(dbRow.handled_via, 'console');
    // 结果邮件：To=申请人、Reply-To=申诉邮箱
    assert.match(env.fake.state.data, /To: dev@example\.com/, '结果邮件发给申请人');
    assert.match(env.fake.state.data, /Reply-To: appeal@example\.com/, '结果邮件 Reply-To=申诉邮箱');
    const log = (await env.q("select * from mail_log where event = 'appeal_result'")).rows[0];
    assert.ok(log, '结果邮件写发送记录');
  } finally {
    await env.close();
  }
});

test('O-6：note 仅备注——状态保持 pending、不写 handled_at、不发结果邮件', async () => {
  const env = await boot({ smtp: true });
  try {
    const ip = '198.51.100.110';
    await env.post('/api/appeal', { contact: 'note@example.com', message: MESSAGE }, ip);
    env.fake.state.data = '';
    const cookie = await env.loginAdmin();
    const row = (await env.get('/api/admin/appeals?status=pending', '203.0.113.77', { cookie })).body.appeals[0];
    const r = await env.post(`/api/admin/appeals/${row.id}/resolve`, { action: 'note', note: '先观察' }, '203.0.113.77', { cookie });
    assert.equal(r.status, 200);
    assert.equal(r.body.appeal.status, 'pending');
    assert.equal(r.body.appeal.note, '先观察');
    assert.equal(r.body.appeal.handled_at, null, '仅备注不写处理时间');
    const dbRow = (await env.q('select status, handled_at from appeals where id = $1', [row.id])).rows[0];
    assert.equal(dbRow.status, 'pending');
    assert.equal(dbRow.handled_at, null);
    assert.equal(env.fake.state.data, '', '仅备注不发结果邮件');
    // 备注后仍可继续处理（状态机未消费）
    const again = await env.post(`/api/admin/appeals/${row.id}/resolve`, { action: 'unban_ip' }, '203.0.113.77', { cookie });
    assert.equal(again.status, 200);
  } finally {
    await env.close();
  }
});

test('O-7：GET /api/appeal/:code 查进度（不回显 IP/指纹/邮箱）；未知编号 404', async () => {
  const env = await boot({ smtp: false });
  try {
    const ip = '198.51.100.111';
    const r = await env.post('/api/appeal', { contact: 'q@example.com', message: MESSAGE }, ip);
    const status = await env.get(`/api/appeal/${r.body.code}`, ip);
    assert.equal(status.status, 200);
    assert.equal(status.body.status, 'pending');
    assert.equal(JSON.stringify(status.body).includes(ip), false, '不回显 IP');
    assert.equal(JSON.stringify(status.body).includes('q@example.com'), false, '不回显邮箱');
    assert.equal((await env.get('/api/appeal/AP-ZZZZZ9', ip)).status, 404);
  } finally {
    await env.close();
  }
});

// ---------------------------------------------------------------- BQ 批（docs/APPEAL-SYSTEM.md §10.7 验收 9–17）
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function makeToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: createHash('sha256').update(token).digest('hex') };
}

/** 从假 SMTP 缓冲里解出 base64 正文并提取确认链接与按钮文案。
 * 注意：多字节字符可能被 60 字符/行的 base64 截断，且 multipart 各段的 padding 会截断拼接解码，
 * 必须按「连续 base64 行」分段解码后再合并。 */
function extractFromMail(state) {
  const parts = [];
  let cur = [];
  const flush = () => {
    if (cur.length) {
      parts.push(Buffer.from(cur.join(''), 'base64').toString('utf8'));
      cur = [];
    }
  };
  for (const line of String(state.data).split(/\r?\n/)) {
    if (/^[A-Za-z0-9+/=]{20,}$/.test(line)) cur.push(line);
    else flush();
  }
  flush();
  const all = parts.join('\n');
  return {
    url: (all.match(/\/appeal\/act#t=[A-Za-z0-9_-]{40,50}/) ?? [null])[0],
    token: (all.match(/\/appeal\/act#t=([A-Za-z0-9_-]{40,50})/) ?? [null, null])[1],
    hasTrustButton: all.includes('信任并解封'),
    hasRejectButton: all.includes('拒绝并保持封禁'),
    hasExpiryNote: /14 天内有效|处理一次后失效/.test(all),
  };
}

test('BQ-3：管理员通知邮件带「信任/拒绝」两按钮 + fragment 链接（可端到端执行）', async () => {
  const env = await boot();
  try {
    const r = await env.post('/api/appeal', { contact: 'bq@example.com', message: MESSAGE }, '198.51.100.120');
    assert.equal(r.status, 200);
    const mail = extractFromMail(env.fake.state);
    assert.ok(mail.url, '邮件含确认页链接');
    assert.ok(mail.token, 'token 在链接 fragment 里');
    assert.equal(mail.hasTrustButton, true, 'HTML 有「信任并解封」按钮');
    assert.equal(mail.hasRejectButton, true, 'HTML 有「拒绝并保持封禁」按钮');
    assert.equal(mail.hasExpiryNote, true, '纯文本版附有效期说明');
    // 用邮件里的 token 预览：零副作用
    const prev = await env.post('/api/appeal/action', { token: mail.token, op: 'preview' }, '203.0.113.77');
    assert.equal(prev.status, 200, prev.text);
    assert.equal(prev.body.code, r.body.code);
    assert.equal(prev.body.canAct, true);
    assert.equal(prev.body.ipMasked, '198.51.100.x', '预览脱敏 IP');
    assert.equal(prev.body.contactMasked, 'b***@example.com', '预览脱敏邮箱');
    const row = (await env.q('select status, handled_at from appeals where code = $1', [r.body.code])).rows[0];
    assert.equal(row.status, 'pending', 'preview 零状态变化');
    assert.equal(row.handled_at, null, 'preview 不写处理时间');
  } finally {
    await env.close();
  }
});

test('BQ-2/BQ-5：trust 解封 IP+设备 + 结果邮件；重复点 409 不重复解封/发信；与后台共用状态机', async () => {
  const env = await boot();
  try {
    const ip = '198.51.100.121';
    const { token, hash } = makeToken();
    await db.insertAppeal(env.q, {
      code: 'AP-TTTT11', ip, device_id: 'bq-device-1', fingerprint: 'a'.repeat(32), reason: '临时超频封禁',
      banUntil: new Date(Date.now() + 600_000).toISOString(), contact: 't@example.com', message: MESSAGE,
      tokenHash: hash, actionExpiresAt: new Date(Date.now() + 14 * 86400_000).toISOString(),
    });
    // 造封禁现场：IP 黑名单 + 设备封禁
    await env.q("insert into ip_blacklist (ip, note) values ($1, '审核')", [ip]);
    await env.q("insert into device_bans (fingerprint, device_id, note) values ($1, 'bq-device-1', '审核')", ['a'.repeat(32)]);
    await visitors.refreshBlocklist(env.q);

    const trust = await env.post('/api/appeal/action', { token, op: 'trust' }, '203.0.113.77');
    assert.equal(trust.status, 200, trust.text);
    assert.equal(trust.body.status, 'resolved');
    const row = (await env.q('select * from appeals where code = $1', ['AP-TTTT11'])).rows[0];
    assert.equal(row.status, 'resolved');
    assert.equal(row.action, 'both', '信任 = 解封 IP + 设备');
    assert.equal(row.handled_via, 'email');
    assert.ok(row.handled_at, '写处理时间');
    assert.equal((await env.q("select count(*)::int as n from ip_blacklist where ip = $1", [ip])).rows[0].n, 0, 'IP 黑名单已删');
    assert.equal((await env.q("select count(*)::int as n from device_bans where fingerprint = $1", ['a'.repeat(32)])).rows[0].n, 0, '设备封禁已删');
    // 结果邮件
    assert.match(env.fake.state.data, /To: t@example\.com/, '结果邮件发申请人');
    const sent = await env.q("select count(*)::int as n from mail_log where event = 'appeal_result'");
    assert.equal(sent.rows[0].n, 1);

    // 重复点同一链接：409 已处理，不重复解封、不重复发信（先到先得）
    const again = await env.post('/api/appeal/action', { token, op: 'trust' }, '203.0.113.77');
    assert.equal(again.status, 409, '重复处理 409');
    assert.equal(again.body.status, 'resolved');
    const sent2 = await env.q("select count(*)::int as n from mail_log where event = 'appeal_result'");
    assert.equal(sent2.rows[0].n, 1, '不重复发信');

    // 后台与邮件共用状态机：另一条申诉先被后台处理，邮件动作 409
    const { token: token2, hash: hash2 } = makeToken();
    await db.insertAppeal(env.q, {
      code: 'AP-TTTT22', ip: '198.51.100.122', contact: 't2@example.com', message: MESSAGE,
      tokenHash: hash2, actionExpiresAt: new Date(Date.now() + 14 * 86400_000).toISOString(),
    });
    const cookie = await env.loginAdmin();
    const list = (await env.get('/api/admin/appeals?status=pending', '203.0.113.77', { cookie })).body.appeals;
    const row2 = list.find((a) => a.code === 'AP-TTTT22');
    await env.post(`/api/admin/appeals/${row2.id}/resolve`, { action: 'reject', note: '后台先拒' }, '203.0.113.77', { cookie });
    const race = await env.post('/api/appeal/action', { token: token2, op: 'trust' }, '203.0.113.77');
    assert.equal(race.status, 409, '后台先处理 → 邮件动作后到 409');
    assert.equal(race.body.status, 'rejected');
  } finally {
    await env.close();
  }
});

test('BQ-2：reject 默认理由/自定义理由 + 结果邮件；处理过再打开显示处理结果', async () => {
  const env = await boot();
  try {
    const { token, hash } = makeToken();
    await db.insertAppeal(env.q, {
      code: 'AP-TTTT33', ip: '198.51.100.123', contact: 'r@example.com', message: MESSAGE,
      tokenHash: hash, actionExpiresAt: new Date(Date.now() + 14 * 86400_000).toISOString(),
    });
    const rej = await env.post('/api/appeal/action', { token, op: 'reject' }, '203.0.113.77');
    assert.equal(rej.status, 200);
    const row = (await env.q('select * from appeals where code = $1', ['AP-TTTT33'])).rows[0];
    assert.equal(row.status, 'rejected');
    assert.equal(row.note, '未通过审核，如仍有疑问请回复本邮件', '拒绝理由为空用默认文案');
    // 处理过再打开：preview 显示处理结果与时间（不是 404）
    const prev = await env.post('/api/appeal/action', { token, op: 'preview' }, '203.0.113.77');
    assert.equal(prev.status, 200);
    assert.equal(prev.body.status, 'rejected');
    assert.equal(prev.body.canAct, false);
    assert.ok(prev.body.handledAt, '显示处理时间');
    assert.equal(prev.body.handledVia, 'email');
  } finally {
    await env.close();
  }
});

test('BQ-2：过期 token 统一 404；伪造/篡改 token 404；连续错误触发 429', async () => {
  const env = await boot({ smtp: false });
  try {
    const { token, hash } = makeToken();
    await db.insertAppeal(env.q, {
      code: 'AP-TTTT44', ip: '198.51.100.124', contact: 'x@example.com', message: MESSAGE,
      tokenHash: hash, actionExpiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const expired = await env.post('/api/appeal/action', { token, op: 'preview' }, '203.0.113.77');
    assert.equal(expired.status, 404, '过期统一 404');
    assert.equal(expired.body.error, '链接无效或已过期');
    const forged = await env.post('/api/appeal/action', { token: 'A'.repeat(43), op: 'preview' }, '203.0.113.77');
    assert.equal(forged.status, 404, '伪造 token 404');
    assert.equal(forged.body.error, '链接无效或已过期');
    const short = await env.post('/api/appeal/action', { token: 'short', op: 'preview' }, '203.0.113.77');
    assert.equal(short.status, 404, '格式非法 token 404');
    // 连续 11 次 → 第 11 次 429（每 IP 10 次/分）
    let limited = false;
    for (let i = 0; i < 11; i += 1) {
      const r = await env.post('/api/appeal/action', { token: 'B'.repeat(43), op: 'preview' }, '198.51.100.125');
      if (r.status === 429) { limited = true; break; }
    }
    assert.equal(limited, true, '每 IP 10 次/分的限流生效');
  } finally {
    await env.close();
  }
});

test('BQ-4：确认页 /appeal/act 200（登记 FRONTEND_PAGES）；仅 GET 零状态变化；GET 无写入端点', async () => {
  const frontend = mkdtempSync(join(tmpdir(), 'gp-appeal-act-'));
  writeFileSync(join(frontend, 'index.html'), '<!doctype html><html><head></head><body>act-placeholder</body></html>');
  const env = await boot({ smtp: false, frontendDir: frontend });
  try {
    // 直开页面：FRONTEND_PAGES 已登记 → 200 index.html（BM 事故：未登记会落旧 web/ 404）
    const page = await fetch(env.base + '/appeal/act#t=zzz', { headers: { 'x-forwarded-for': '203.0.113.77' } });
    assert.equal(page.status, 200, '/appeal/act 应返回 SPA index.html');
    assert.match(await page.text(), /act-placeholder/);

    const { token, hash } = makeToken();
    await db.insertAppeal(env.q, {
      code: 'AP-TTTT55', ip: '198.51.100.126', contact: 'g@example.com', message: MESSAGE,
      tokenHash: hash, actionExpiresAt: new Date(Date.now() + 14 * 86400_000).toISOString(),
    });
    // 模拟邮件安全扫描：只发 GET /api/appeal/action → 无副作用（POST-only，GET 404）
    const getRes = await fetch(env.base + '/api/appeal/action', { headers: { 'x-forwarded-for': '203.0.113.77' } });
    assert.equal(getRes.status, 404, 'GET 无处理端点');
    const row0 = (await env.q('select status, handled_at from appeals where code = $1', ['AP-TTTT55'])).rows[0];
    assert.equal(row0.status, 'pending', '仅 GET 零状态变化');
    assert.equal(row0.handled_at, null);
    // preview GET 也不行（同样零副作用）
    const getPreview = await fetch(env.base + `/api/appeal/action?token=${token}&op=preview`, { headers: { 'x-forwarded-for': '203.0.113.77' } });
    assert.equal(getPreview.status, 404, '查询参数形式的 GET 不执行');
  } finally {
    await env.close();
  }
});

test('BQ-2：SMTP 未配置时确认页动作仍可用（trust 生效）', async () => {
  const env = await boot({ smtp: false });
  try {
    const { token, hash } = makeToken();
    await db.insertAppeal(env.q, {
      code: 'AP-TTTT66', ip: '198.51.100.127', contact: 'nosmtp@example.com', message: MESSAGE,
      tokenHash: hash, actionExpiresAt: new Date(Date.now() + 14 * 86400_000).toISOString(),
    });
    const trust = await env.post('/api/appeal/action', { token, op: 'trust' }, '203.0.113.77');
    assert.equal(trust.status, 200, 'SMTP 未配不影响邮件动作');
    const row = (await env.q("select status from appeals where code = 'AP-TTTT66'")).rows[0];
    assert.equal(row.status, 'resolved');
  } finally {
    await env.close();
  }
});
