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
  // CO-5/B4-2 第十一轮：cmdAlerts 已随 cli 报表类域拆到 src/cli/report.js，断言按新落点指向
  const cliReport = readFileSync(join(process.cwd(), 'src', 'cli', 'report.js'), 'utf8');
  assert.match(cliReport, /renderAlertsHtml/, 'cli 引入渲染');
  assert.match(cliReport, /html: mail\.html/, 'deliver 多传 html');
  const alerts = readFileSync(join(process.cwd(), 'src', 'alerts.js'), 'utf8');
  assert.match(alerts, /export function renderDigest/, '纯文本兜底保留');
});

// FM（docs/ALERT-HISTLOW-FIX.md §2.3/§2.4、§3）：标签区分「新史低 / 跌至史低」；
// 史低价与当前价相同不重复显示；未降价（价格=原价）不显示史低段。
// 反向自检：去掉 shouldShowHistLow 的「同价」分支 → 第 1 条「同价只出现一次」红；
// 去掉「未降价」分支 → 第 2 条「价格=原价 → 无史低段」红。
const fmHit = (over = {}) => ({
  name: '游戏',
  steamAppid: 100,
  currentCents: 9900,
  targetCents: null,
  histLowCents: 9900,
  originalCents: 19900,
  reason: 'hist_low_tie',
  ...over,
});

test('FM 标签区分：跌破=新史低，持平=跌至史低，且同价不重复显示史低', () => {
  const fresh = renderAlertsHtml([fmHit({ currentCents: 8800, histLowCents: 9900, reason: 'hist_low' })]);
  assert.match(fresh.html, /新史低/, '真跌破标「新史低」');
  assert.ok(!fresh.html.includes('跌至史低'), '跌破不标「跌至史低」');
  assert.match(fresh.html, /史低 ¥99\.00/, '历史低与当前价不同 → 显示昨天以前的旧低');

  const tie = renderAlertsHtml([fmHit({ currentCents: 9900, histLowCents: 9900, reason: 'hist_low_tie' })]);
  assert.match(tie.html, /跌至史低/, '持平标「跌至史低」');
  assert.ok(!tie.html.includes('新史低'), '持平不能叫「新史低」');
  assert.equal((tie.html.match(/¥99\.00/g) ?? []).length, 1, '同价只出现一次（旧版会「新史低 ¥99.00 史低 ¥99.00」）');
  assert.ok(!tie.text.includes('史低 ¥99.00'), '纯文本兜底同样不重复');
});

test('FM 未降价不显示史低段：价格=原价不谈史低，有折扣才显示', () => {
  const undiscounted = renderAlertsHtml(
    [fmHit({ currentCents: 14900, targetCents: 14900, histLowCents: 9900, originalCents: 14900, reason: 'target' })],
  );
  assert.match(undiscounted.html, /达到目标价/);
  assert.ok(!undiscounted.html.includes('史低'), '价格=原价 → 不显示史低段');
  assert.ok(!undiscounted.text.includes('史低'), '纯文本兜底同样不显示');

  const discounted = renderAlertsHtml(
    [fmHit({ currentCents: 14900, targetCents: 14900, histLowCents: 9900, originalCents: 29800, reason: 'target' })],
  );
  assert.match(discounted.html, /史低 ¥99\.00/, '有折扣时保留史低信息');
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
