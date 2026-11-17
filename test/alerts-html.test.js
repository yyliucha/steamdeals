// CI-1（docs/ALERT-MAIL-APPEAL-UX.md §3）：提醒邮件 HTML 化——品牌头/卡片/转义/无外部资源；
// CI-2：申诉页分段控件/空态/到期并入封禁原因 静态契约。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderAlertsHtml } from '../src/alerts-html.js';

const hits = [
  { name: '赛博朋克 <2077> & 幽灵', steamAppid: 1091500, currentCents: 9900, targetCents: 12800, histLowCents: 8800, reason: 'hist_low' },
  { name: '无目标游戏', steamAppid: null, currentCents: 2000, targetCents: null, histLowCents: null, reason: 'wishlist' },
];

test('CI-1 渲染：品牌头/卡片字段/Steam 链接/转义/无外部资源', () => {
  const { subject, html, text } = renderAlertsHtml(hits, { now: new Date('2026-11-17T02:00:00Z') });
  assert.match(subject, /2 款到价/);
  assert.match(html, /SteamDeals/, '品牌头');
  assert.match(html, /2026-11-17/, '日期');
  assert.ok(!html.includes('<2077>'), '动态字段必须转义');
  assert.match(html, /&lt;2077&gt;/, '转义后内容');
  assert.match(html, /store\.steampowered\.com\/app\/1091500/, 'Steam 链接');
  assert.match(html, /达到目标价|新史低|愿望单/, '原因角标');
  assert.ok(!html.includes('https://fonts'), '无外部资源（无外链字体）');
  assert.ok(!/<img/.test(html), '无外部图片');
  assert.match(text, /赛博朋克 <2077>/, '纯文本兜底不转义（webhook 口径不变）');
});

test('CI-1 接线：cli 提醒路径传 html；alerts.js 纯文本口径不变', () => {
  const cli = readFileSync(join(process.cwd(), 'src', 'cli.js'), 'utf8');
  assert.match(cli, /renderAlertsHtml/, 'cli 引入渲染');
  assert.match(cli, /html: mail\.html/, 'deliver 多传 html');
  const alerts = readFileSync(join(process.cwd(), 'src', 'alerts.js'), 'utf8');
  assert.match(alerts, /export function renderDigest/, '纯文本兜底保留');
});

test('CI-2 申诉页：分段控件主色选中/卡片空态/到期并入封禁原因/移动卡片不变', () => {
  const vue = readFileSync(join(process.cwd(), 'frontend', 'src', 'components', 'AppealsAdmin.vue'), 'utf8');
  assert.match(vue, /seg-tabs/, '分段控件容器');
  assert.match(vue, /\.seg-tabs button\.on\{background:var\(--brand\);color:#fff/, '主色选中态');
  assert.match(vue, /appeal-empty-card/, '卡片式空态');
  assert.match(vue, /<template #empty>/, '桌面表格自定义空态');
  assert.ok(!vue.includes('<el-table-column label="到期"'), '「到期」不再独立成列');
  assert.match(vue, /到期 \{\{ dateTime\(row\.ban_until\) \}\}/, '到期并入封禁原因副行');
  assert.match(vue, /game-card-list/, '移动端卡片结构保留');
});
