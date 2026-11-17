// 邮件真实收件（CK 批，docs/E2E-SUITE.md §1 #6）：163 测试邮箱凭据放仓库外 F:\dsh\e2e-secrets\mail.env，
// 这里只读取环境变量，绝不入库、绝不打印密码。优先 IMAP 拉取断言（node:tls 手写最小 IMAP 客户端，零依赖）。
// mail.env 缺失 → readMailEnv() 返回 null，相关矩阵行按"环境不具备"skip 并在报告写原因。
import { readFileSync, existsSync } from 'node:fs';
import { connect } from 'node:tls';

export const MAIL_ENV_PATH = 'F:\\dsh\\e2e-secrets\\mail.env';

/** 读 F:\dsh\e2e-secrets\mail.env（KEY=VALUE，每行一条）。不存在或字段不全返回 null。 */
export function readMailEnv() {
  if (!existsSync(MAIL_ENV_PATH)) return null;
  const map = {};
  for (const line of readFileSync(MAIL_ENV_PATH, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) map[m[1]] = m[2];
  }
  const user = map.E2E_MAIL_USER || '';
  const pass = map.E2E_MAIL_PASS || '';
  if (!user || !pass) return null;
  return {
    user,
    pass,
    imapHost: map.E2E_IMAP_HOST || 'imap.163.com',
    imapPort: Number(map.E2E_IMAP_PORT || 993),
    smtpHost: map.E2E_SMTP_HOST || 'smtp.163.com',
    smtpPort: Number(map.E2E_SMTP_PORT || 465),
  };
}

class ImapClient {
  constructor(socket) {
    this.socket = socket;
    this.buf = '';
    this.tag = 0;
    this.waiters = [];
    socket.setEncoding('utf8');
    socket.on('data', (d) => {
      this.buf += d;
      this.drain();
    });
  }

  drain() {
    // IMAP 响应行以 \r\n 结束；FETCH 字面量 {n}\r\n<bytes> 整块读
    while (true) {
      const idx = this.buf.indexOf('\r\n');
      if (idx < 0) return;
      const line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 2);
      if (/\{\d+\}$/.test(line)) {
        const n = Number(line.match(/\{(\d+)\}$/)[1]);
        if (this.buf.length < n + 2) {
          this.buf = line + '\r\n' + this.buf; // 数据不完整，塞回等下一段
          return;
        }
        const literal = this.buf.slice(0, n);
        this.buf = this.buf.slice(n + 2);
        this.emitLine(line.replace(/\{\d+\}$/, `{${n}}`) + '\r\n' + literal);
        continue;
      }
      this.emitLine(line);
    }
  }

  emitLine(line) {
    const w = this.waiters.find((x) => line.startsWith(x.tag + ' '));
    if (w) this.waiters.splice(this.waiters.indexOf(w), 1), w.resolve(line);
  }

  cmd(cmd, { multiline = false, timeoutMs = 30_000 } = {}) {
    const tag = `A${String(++this.tag).padStart(4, '0')}`;
    this.socket.write(`${tag} ${cmd}\r\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.waiters.findIndex((x) => x.tag === tag);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Error(`IMAP ${cmd} 超时`));
      }, timeoutMs);
      this.waiters.push({
        tag,
        resolve: (line) => {
          clearTimeout(timer);
          const status = line.split(' ').slice(1).join(' ');
          if (multiline) resolve(line);
          else if (status.startsWith('OK')) resolve(status);
          else reject(new Error(`IMAP ${cmd} → ${status}`));
        },
      });
    });
  }
}

/** 登录并拉取最近 N 封邮件主题（含正文头若干行），供"收到某主题邮件"断言。 */
export async function fetchRecentSubjects(env, { limit = 20, timeoutMs = 60_000 } = {}) {
  const socket = await new Promise((done, fail) => {
    const s = connect({ host: env.imapHost, port: env.imapPort, servername: env.imapHost, rejectUnauthorized: true });
    s.once('secureConnect', () => done(s));
    s.once('error', fail);
    setTimeout(() => fail(new Error('IMAP TLS 连接超时')), timeoutMs).unref?.();
  });
  const client = new ImapClient(socket);
  try {
    await client.cmd('CAPABILITY');
    await client.cmd(`LOGIN "${env.user}" "${env.pass}"`);
    await client.cmd('SELECT "INBOX"');
    const list = await client.cmd(`FETCH 1:${limit} (BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE)])`, { multiline: true });
    await client.cmd('LOGOUT');
    // 解析 FETCH 响应里的 Subject 行
    const subjects = [];
    for (const part of list.split(/\r?\n\* /)) {
      const subj = part.match(/Subject:\s*([^\r\n]+)/i);
      const from = part.match(/From:\s*([^\r\n]+)/i);
      if (subj) subjects.push({ subject: decodeMimeWords(subj[1].trim()), from: from ? decodeMimeWords(from[1].trim()) : '' });
    }
    return subjects;
  } finally {
    socket.destroy();
  }
}

function decodeMimeWords(s) {
  // 只解最常见 =?UTF-8?B?…?= 与 =?UTF-8?Q?…?=（163 邮件头常见形态）
  return s.replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_, b) => Buffer.from(b, 'base64').toString('utf8'))
    .replace(/=\?UTF-8\?Q\?([^?]+)\?=/gi, (_, q) => q.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (__, h) => String.fromCharCode(parseInt(h, 16))));
}
