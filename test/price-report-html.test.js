// CB 批（docs/PRICE-REPORT-EMAIL.md §4）：价格报表邮件 HTML 渲染与投递。
// 覆盖：渲染内容（KPI/Top5/Top3/7 天/链接/金额折扣）、转义与安全（无 flex/grid/外部资源）、
// 纯文本 fallback 口径、deliver() html 透传（假 SMTP 收 multipart）、webhook 只发 text、CLI 接入。
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderPriceReport } from '../src/price-report-html.js';
import { deliver } from '../src/notify.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SITE_URL = 'https://sd.yyliucha.cn';

function sampleReport() {
  return {
    hours: 24,
    changed: 129,
    drops: 46,
    rises: 83,
    newLows: 46,
    topDrops: [
      { name: 'Hades II', platform_name: 'Steam 国区', steam_appid: 1145350, was: 10800, now_price: 5400, drop_cents: 5400, captured_at: '2026-11-16T02:00:00Z' },
      { name: '含 <script>alert(1)</script> 与 "引号"', platform_name: '杉果', steam_appid: null, was: 9900, now_price: 4900, drop_cents: 5000, captured_at: '2026-11-16T02:00:00Z' },
      { name: 'Game C', platform_name: 'GOG', steam_appid: 111, was: 5000, now_price: 3000, drop_cents: 2000, captured_at: '2026-11-16T02:00:00Z' },
      { name: 'Game D', platform_name: 'Humble', steam_appid: 222, was: 4000, now_price: 2500, drop_cents: 1500, captured_at: '2026-11-16T02:00:00Z' },
      { name: 'Game E', platform_name: 'SteamPy', steam_appid: 333, was: 3000, now_price: 2000, drop_cents: 1000, captured_at: '2026-11-16T02:00:00Z' },
      { name: 'Game F-extra', platform_name: 'ITAD 聚合', steam_appid: 444, was: 2000, now_price: 1500, drop_cents: 500, captured_at: '2026-11-16T02:00:00Z' },
    ],
    topRises: [
      { name: 'Rise A', platform_name: 'Steam 国区', steam_appid: 555, was: 5000, now_price: 8000, drop_cents: -3000, captured_at: '2026-11-16T02:00:00Z' },
      { name: 'Rise B', platform_name: '杉果', steam_appid: null, was: 3000, now_price: 5000, drop_cents: -2000, captured_at: '2026-11-16T02:00:00Z' },
      { name: 'Rise C', platform_name: 'GOG', steam_appid: 666, was: 1000, now_price: 2000, drop_cents: -1000, captured_at: '2026-11-16T02:00:00Z' },
      { name: 'Rise D-extra', platform_name: 'Humble', steam_appid: 777, was: 100, now_price: 200, drop_cents: -100, captured_at: '2026-11-16T02:00:00Z' },
    ],
  };
}

function sampleDaily() {
  return [
    { day: '2026-11-10', drops: 10, rises: 20, changed: 30 },
    { day: '2026-11-11', drops: 40, rises: 10, changed: 50 },
    { day: '2026-11-12', drops: 8, rises: 12, changed: 20 },
    { day: '2026-11-13', drops: 22, rises: 5, changed: 27 },
  ];
}

test('CB-1：renderPriceReport 输出 subject/html/text，含 KPI、Top5/3、金额与折扣、7 天数值', () => {
  const { subject, html, text } = renderPriceReport({
    report: sampleReport(),
    daily: sampleDaily(),
    siteUrl: SITE_URL,
    now: new Date('2026-11-16T08:00:00+08:00'),
  });
  assert.match(subject, /SteamDeals 价格报表 · 11-16 \| 降价 46 \/ 新史低 46/, 'subject 含日期与数字');
  assert.ok(html.includes('>46<'), 'KPI 降价数字');
  assert.ok(html.includes('>83<'), 'KPI 涨价数字');
  assert.match(html, /新史低/, 'KPI 标签');
  assert.match(html, /Hades II/, 'Top5 名称');
  assert.ok(!html.includes('Game F-extra'), 'Top5 只取 5 条（第 6 条不出现）');
  assert.ok(!html.includes('Rise D-extra'), 'Top3 只取 3 条（第 4 条不出现）');
  assert.match(html, /¥108\.00/, '原价金额分转元');
  assert.match(html, /¥54\.00/, '现价金额分转元');
  assert.match(html, /-50%/, '折扣取整徽标');
  assert.match(html, /2026-11-10|11-10/, '7 天日期');
  assert.match(html, /降 40/, '7 天数值');
  // 纯文本 fallback 口径
  assert.match(text, /SteamDeals 价格报表（近 24 小时）/, 'text 保留原口径');
  assert.match(text, /降价 46 条 \/ 涨价 83 条 \/ 新史低 46 条/, 'text 统计行');
  assert.match(text, /↓ ¥108\.00 → ¥54\.00（-50%）Hades II · Steam 国区/, 'text Top 行口径');
  assert.match(text, /近 7 天：2026-11-10 降10\/涨20；/, 'text 7 天口径');
});

test('CB-1：转义与安全——动态字段全转义、无 flex/grid、无外部资源、无 appid 不出 Steam 链接', () => {
  const { html } = renderPriceReport({ report: sampleReport(), daily: sampleDaily(), siteUrl: SITE_URL });
  assert.ok(!html.includes('<script>alert(1)</script>'), 'script 注入被转义');
  assert.match(html, /&lt;script&gt;/, '转义后的 <script 文本存在');
  assert.ok(!html.includes('&quot;引号&quot;'.replace(/&quot;/g, '"')), '引号不裸出');
  assert.ok(!/<img/i.test(html), '无外部图片');
  assert.ok(!/<link/i.test(html), '无外部 CSS');
  assert.ok(!/https?:\/\/(?!sd\.yyliucha\.cn|store\.steampowered\.com)/.test(html), '除站点与 Steam 商店外无其它 URL');
  assert.ok(!/flex/i.test(html), '无 flex');
  assert.ok(!/\bgrid\b/i.test(html), '无 grid');
  assert.match(html, /\/app\/1145350\//, '有 appid 出 Steam 链接');
  // 「杉果」行 steam_appid=null：该行不得出现 store.steampowered.com
  const sonkwoLine = html.slice(html.indexOf('杉果'), html.indexOf('杉果') + 400);
  assert.ok(!sonkwoLine.includes('store.steampowered.com'), '无 appid 不出 Steam 链接');
  assert.match(html, /\?q=Hades%20II/, '站内搜索链接（encodeURIComponent）');
  assert.match(html, />打开 SteamDeals</, 'CTA 按钮');
  // 手机单列适配（§3.1 @media 480；QA 第 1 轮打回项）
  assert.match(html, /@media \(max-width:480px\)/, '手机单列媒体查询');
  assert.match(html, /td\.stack\{display:block/, '表格单元堆叠规则');
  assert.match(html, /td\.kpi\{display:block/, 'KPI 卡堆叠规则');
  assert.match(html, /table\.main\{width:100%/, '主表格手机全宽');
});

test('CB-2：deliver 透传 html——假 SMTP 收到 multipart/alternative 且 HTML 段含 KPI；webhook 只发 text', async () => {
  const smtpState = { data: '' };
  const smtp = net.createServer((socket) => {
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
          if (line === '.') { inData = false; socket.write('250 2.0.0 Ok\r\n'); } else smtpState.data += `${line}\r\n`;
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
  await new Promise((r) => smtp.listen(0, '127.0.0.1', r));
  const webhookBody = { got: null };
  const webhook = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { webhookBody.got = body; res.writeHead(200); res.end('ok'); });
  });
  await new Promise((r) => webhook.listen(0, '127.0.0.1', r));
  try {
    const { subject, html, text } = renderPriceReport({ report: sampleReport(), daily: sampleDaily(), siteUrl: SITE_URL });
    const channels = [
      { kind: 'email', name: 'email', host: '127.0.0.1', port: smtp.address().port, secure: false, user: 's@x.com', pass: '', from: 's@x.com', to: 'a@b.co' },
      { kind: 'webhook', name: 'webhook', url: `http://127.0.0.1:${webhook.address().port}/hook` },
    ];
    const result = await deliver(channels, { text, html, subject });
    assert.equal(result.ok, true);
    // email：multipart 两段
    assert.match(smtpState.data, /multipart\/alternative/, '邮件为 multipart/alternative');
    assert.match(smtpState.data, /Content-Type: text\/html/, '含 HTML 段');
    // 解码 base64 段（按连续 base64 行分段，避免 padding 截断）确认 HTML 段含 KPI
    const parts = [];
    let cur = [];
    for (const line of smtpState.data.split(/\r?\n/)) {
      if (/^[A-Za-z0-9+/=]{20,}$/.test(line)) cur.push(line);
      else { if (cur.length) { parts.push(Buffer.from(cur.join(''), 'base64').toString('utf8')); cur = []; } }
    }
    if (cur.length) parts.push(Buffer.from(cur.join(''), 'base64').toString('utf8'));
    assert.ok(parts.some((p) => p.includes('>46<') && p.includes('价格报表')), 'HTML 段可解码且含 KPI');
    assert.ok(parts.some((p) => p.includes('降价 46 条 / 涨价 83 条')), '纯文本段保持原口径');
    // webhook：只发 text（payload），不含 HTML
    const got = JSON.parse(webhookBody.got);
    assert.match(got.text, /降价 46 条/, 'webhook 收到 text');
    assert.ok(!got.html, 'webhook 不发 html');
  } finally {
    smtp.close();
    webhook.close();
  }
});

test('CB-3：CLI 接入与设置项——cmdReport 用 renderPriceReport、site.publicUrl 存在', () => {
  // CO-5/B4-2 第十一轮：cmdReport 已随 cli 报表类域拆到 src/cli/report.js，断言按新落点指向
  const cliReport = readFileSync(ROOT + 'src/cli/report.js', 'utf8');
  const settings = readFileSync(ROOT + 'src/settings.js', 'utf8');
  assert.match(cliReport, /import \{ renderPriceReport \} from '\.\.\/price-report-html\.js'/, 'CLI 引入渲染模块');
  assert.match(cliReport, /renderPriceReport\(\{\s*report: rep/, 'cmdReport 生成 {subject, html, text}');
  assert.match(cliReport, /SITE_PUBLIC_URL/, 'CLI 读站点公开地址设置');
  assert.match(cliReport, /html,\s*\n?\s*payload: \{ type: 'steamdeals\.price_report'/, 'deliver 传 html + payload');
  assert.match(settings, /site\.publicUrl/, '新增 site.publicUrl 设置');
  assert.match(settings, /SITE_PUBLIC_URL/, 'env SITE_PUBLIC_URL');
  assert.match(settings, /https:\/\/sd\.yyliucha\.cn/, '默认值');
});
