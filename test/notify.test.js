import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { buildMessage, channelsFromEnv, encodeSubject, hasNotifier, sendMail, sendWecom, deliver, postJson, jobFailureEmailChannel, buildJobFailureMail } from '../src/notify.js';

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

test('通道发现：只认配好的那几个', () => {
  assert.deepEqual(channelsFromEnv({}), []);
  assert.equal(hasNotifier({}), false);

  const webhook = channelsFromEnv({ ALERT_WEBHOOK_URL: 'https://x/hook' });
  assert.deepEqual(webhook.map((c) => [c.name, c.kind]), [['webhook', 'webhook']]);

  const wecom = channelsFromEnv({ WECOM_WEBHOOK_URL: 'https://qyapi.weixin.qq.com/...' });
  assert.deepEqual(wecom.map((c) => c.name), ['wecom']);

  const email = channelsFromEnv({
    SMTP_HOST: 'smtp.example.com',
    SMTP_USER: 'me@example.com',
    SMTP_PASS: 'pw',
    ALERT_EMAIL_TO: 'a@x.com, b@y.com',
  });
  assert.equal(email.length, 1);
  assert.equal(email[0].kind, 'email');
  assert.equal(email[0].port, 465);
  assert.equal(email[0].secure, true);
  assert.deepEqual(email[0].to, ['a@x.com', 'b@y.com']);

  // 缺收件人时不算配置了邮件通道
  assert.equal(channelsFromEnv({ SMTP_HOST: 'smtp.example.com' }).length, 0);
  assert.equal(hasNotifier({ SMTP_HOST: 'smtp.example.com', ALERT_EMAIL_TO: 'a@x.com' }), true);
});

test('中文主题按 RFC 2047 编码，ASCII 主题保持原样', () => {
  assert.equal(encodeSubject('Price drop'), 'Price drop');
  const encoded = encodeSubject('游戏价格提醒');
  assert.match(encoded, /^=\?UTF-8\?B\?/);
  const decoded = Buffer.from(encoded.slice('=?UTF-8?B?'.length, -2), 'base64').toString('utf8');
  assert.equal(decoded, '游戏价格提醒');
});

test('邮件正文是标准 MIME，base64 可还原且每行不超过 76 字符', () => {
  const text = '赛博朋克 2077 到价：¥99.00\n'.repeat(6);
  const message = buildMessage({ from: 'a@x.com', to: ['b@y.com'], subject: '到价提醒', text, messageId: '<t@steamdeals>' });
  assert.match(message, /^From: a@x\.com/);
  assert.match(message, /To: b@y\.com/);
  assert.match(message, /Message-ID: <t@steamdeals>/);
  assert.match(message, /Content-Transfer-Encoding: base64/);

  const [, body] = message.split('\r\n\r\n');
  for (const line of body.split('\r\n')) assert.ok(line.length <= 76, `行过长：${line.length}`);
  assert.equal(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8'), text);
});

test('SMTP 全流程：EHLO → AUTH PLAIN → MAIL/RCPT → DATA → QUIT', async () => {
  const { server, state, port } = await startFakeSmtp();
  try {
    const result = await sendMail(
      {
        host: '127.0.0.1',
        port,
        secure: false,
        user: 'sender@example.com',
        pass: 'secret',
        from: 'sender@example.com',
        to: ['rcpt@example.com'],
        subject: '游戏到价',
        text: '赛博朋克 2077 现在 ¥99.00',
      },
      { timeoutMs: 5000 },
    );
    assert.equal(result.ok, true, JSON.stringify(result));

    const cmds = state.commands;
    assert.ok(cmds[0].startsWith('EHLO'), `首条命令应为 EHLO，实际 ${cmds[0]}`);
    const authLine = cmds.find((c) => c.startsWith('AUTH PLAIN'));
    assert.ok(authLine, '应使用 AUTH PLAIN');
    const token = authLine.split(' ')[2];
    assert.equal(Buffer.from(token, 'base64').toString('utf8'), '\u0000sender@example.com\u0000secret');
    assert.ok(cmds.some((c) => c === 'MAIL FROM:<sender@example.com>'));
    assert.ok(cmds.some((c) => c === 'RCPT TO:<rcpt@example.com>'));
    assert.ok(cmds.includes('DATA'));
    assert.ok(cmds.includes('QUIT'));

    // 假服务器收到的正文里应能看到编码后的主题与可解码的正文
    assert.match(state.data, /Subject: =\?UTF-8\?B\?/);
    const body = state.data.split('\r\n\r\n').pop();
    assert.equal(Buffer.from(body.replace(/\r\n/g, '').replace(/\r\n\.\r\n$/, ''), 'base64').toString('utf8').includes('¥99.00'), true);
  } finally {
    server.close();
  }
});

test('SMTP 认证失败返回 ok:false 且带错误码，不抛异常', async () => {
  const { server, port } = await startFakeSmtp({ authCode: 535 });
  try {
    const result = await sendMail(
      { host: '127.0.0.1', port, secure: false, user: 'u', pass: 'p', from: 'f@x.com', to: 't@x.com', subject: 's', text: 't' },
      { timeoutMs: 5000 },
    );
    assert.equal(result.ok, false);
    assert.equal(result.code, 535);
    assert.match(result.error, /535/);
  } finally {
    server.close();
  }
});

test('连不上 SMTP 时返回失败而不是崩溃', async () => {
  const result = await sendMail(
    { host: '127.0.0.1', port: 1, secure: false, from: 'f@x.com', to: 't@x.com', subject: 's', text: 't' },
    { timeoutMs: 2000 },
  );
  assert.equal(result.ok, false);
  assert.ok(result.error);
});

test('企业微信：errcode=0 才算成功', async () => {
  const okFetch = async () => ({ ok: true, status: 200, text: async () => '{"errcode":0,"errmsg":"ok"}' });
  const ok = await sendWecom('hello', { url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x', fetchImpl: okFetch });
  assert.equal(ok.ok, true);
  assert.equal(ok.errcode, 0);

  const badFetch = async () => ({ ok: true, status: 200, text: async () => '{"errcode":93000,"errmsg":"invalid webhook url"}' });
  const bad = await sendWecom('hello', { url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x', fetchImpl: badFetch });
  assert.equal(bad.ok, false, 'errcode 非 0 不能当成功');
});

test('deliver：多通道部分失败也算已送达，结果逐条返回', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('qyapi.weixin')) return { ok: true, status: 200, text: async () => '{"errcode":0}' };
    throw new Error('ECONNREFUSED');
  };
  const channels = [
    { name: 'webhook', kind: 'webhook', url: 'https://example.com/hook' },
    { name: 'wecom', kind: 'wecom', url: 'https://qyapi.weixin.qq.com/x' },
  ];
  const result = await deliver(channels, { text: 'hi', payload: { a: 1 }, fetchImpl });
  assert.equal(result.results.length, 2);
  assert.equal(result.ok, true);
  assert.equal(result.results.find((r) => r.channel === 'wecom').ok, true);
  assert.equal(result.results.find((r) => r.channel === 'webhook').ok, false);
});

test('deliver：没有通道时不报成功', async () => {
  const result = await deliver([], { text: 'hi' });
  assert.equal(result.ok, false);
  assert.deepEqual(result.results, []);
});

test('postJson 失败返回结构化错误', async () => {
  const res = await postJson('https://example.com', { a: 1 }, {
    fetchImpl: async () => {
      throw new Error('boom');
    },
  });
  assert.equal(res.ok, false);
  assert.match(res.error, /boom/);
});

// ---------------------------------------------------------------- CO-1/A5（docs/DESIGN-AUDIT.md A5）：任务失败邮件告警

test('任务失败告警通道：开关默认关；开关开但 SMTP/收件人缺失也返回 null', () => {
  assert.equal(jobFailureEmailChannel({}), null, '开关默认关闭（不发信）');
  assert.equal(jobFailureEmailChannel({ ALERTS_JOB_FAILURE_EMAIL: '0', SMTP_HOST: 'smtp.x.com', ALERT_EMAIL_TO: 'a@x.com' }), null, '显式 0 同样不发');
  assert.equal(jobFailureEmailChannel({ ALERTS_JOB_FAILURE_EMAIL: '1' }), null, '开关开但没配 SMTP');
  assert.equal(jobFailureEmailChannel({ ALERTS_JOB_FAILURE_EMAIL: '1', SMTP_HOST: 'smtp.x.com' }), null, '配了 SMTP 但回退链取不到收件人');
});

test('任务失败告警通道：收件人走回退链（申诉邮箱 → 告警收件人 → 发件人 → SMTP 账号）', () => {
  const base = { ALERTS_JOB_FAILURE_EMAIL: '1', SMTP_HOST: 'smtp.example.com', SMTP_USER: 'me@example.com', SMTP_PASS: 'pw' };
  const appeal = jobFailureEmailChannel({ ...base, APPEAL_EMAIL: 'appeal@x.com', ALERT_EMAIL_TO: 'a@x.com' });
  assert.deepEqual(appeal.to, ['appeal@x.com'], '申诉邮箱优先级最高');
  const alert = jobFailureEmailChannel({ ...base, ALERT_EMAIL_TO: 'a@x.com, b@x.com' });
  assert.deepEqual(alert.to, ['a@x.com', 'b@x.com'], '告警收件人次之，支持多个');
  const from = jobFailureEmailChannel({ ...base, SMTP_FROM: 'from@x.com' });
  assert.deepEqual(from.to, ['from@x.com'], '发件人兜底');
  const user = jobFailureEmailChannel(base);
  assert.deepEqual(user.to, ['me@example.com'], '最后回退 SMTP 账号');
  assert.equal(user.host, 'smtp.example.com');
  assert.equal(user.port, 465);
  assert.equal(user.secure, true);
  assert.equal(user.from, 'me@example.com');
});

test('任务失败告警邮件：主题带任务名，正文带时间/退出码/原因；缺原因回退退出码', () => {
  const mail = buildJobFailureMail({
    job: 'sonkwo',
    code: 1,
    reason: 'data/skus.json 为空，先用 add-sku 加几个 SKU',
    at: new Date('2026-11-18T10:00:00Z'),
  });
  assert.equal(mail.subject, '[SteamDeals] 任务失败：sonkwo');
  assert.match(mail.text, /定时任务 sonkwo 运行失败/);
  assert.match(mail.text, /2026-11-18T10:00:00\.000Z/);
  assert.match(mail.text, /退出码：1/);
  assert.match(mail.text, /data\/skus\.json 为空/);
  const noReason = buildJobFailureMail({ job: 'heat', code: 2, reason: null, at: new Date('2026-11-18T10:00:00Z') });
  assert.match(noReason.text, /原因：exit code 2/, '取不到原因时用退出码兜底');
});

test('任务失败告警端到端：开关开 + 假 SMTP 真收到告警邮件；开关关不发', async () => {
  const { server, state, port } = await startFakeSmtp();
  try {
    const env = {
      ALERTS_JOB_FAILURE_EMAIL: '1',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(port),
      SMTP_SECURE: '0',
      SMTP_USER: '',
      SMTP_PASS: '',
      ALERT_EMAIL_TO: 'ops@example.com',
    };
    const channel = jobFailureEmailChannel(env);
    assert.ok(channel, '开关开 + SMTP 配好才有通道');
    const mail = buildJobFailureMail({ job: 'app-release-sync', code: 1, reason: 'App Release 同步失败：network' });
    const res = await deliver([channel], { subject: mail.subject, text: mail.text });
    assert.equal(res.ok, true, 'SMTP 投递成功');
    assert.match(state.data, /Subject: =?/, 'SMTP 服务器收到邮件');
    assert.ok(state.commands.some((c) => c === 'RCPT TO:<ops@example.com>'), '收件人正确');
    const body = state.data.split('\r\n\r\n').pop();
    assert.match(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8'), /App Release 同步失败：network/, '正文带失败原因');
  } finally {
    server.close();
  }
  // 开关关：不发信（channel 为 null，调度器跳过并只记日志）
  assert.equal(
    jobFailureEmailChannel({ ALERTS_JOB_FAILURE_EMAIL: '0', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(port), SMTP_SECURE: '0', ALERT_EMAIL_TO: 'ops@example.com' }),
    null,
    '开关关时无通道，不发信',
  );
});
