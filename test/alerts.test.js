import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAlerts, renderDigest, toPayload, postWebhook, REASON, REASON_LABEL } from '../src/alerts.js';

const row = (over = {}) => ({
  watch_id: 1,
  game_id: 10,
  steam_appid: 1091500,
  name: '赛博朋克 2077',
  target_cents: null,
  hist_low: 9900,
  current_cents: 14900,
  original_cents: null,
  last_notified_cents: null,
  last_notified_at: null,
  note: null,
  ...over,
});

test('到目标价才提醒', () => {
  assert.equal(evaluateAlerts([row({ target_cents: 10000, current_cents: 14900 })]).length, 0);
  const hits = evaluateAlerts([row({ target_cents: 10000, current_cents: 9900 })]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].reason, REASON.TARGET);
  assert.equal(hits[0].currentCents, 9900);
});

// FM（docs/ALERT-HISTLOW-FIX.md §2）：hist_low 是「今天以前」的史低——
// 跌破才是「新史低」，持平只能叫「跌至史低」。反向自检：把判定改回 current<=hist 一律
// hist_low，本组第 2 条的 reason 断言必红（纯函数层）。
test('没设目标价：跌破「今天以前」史低才叫新史低', () => {
  const below = evaluateAlerts([row({ current_cents: 8800, hist_low: 9900 })]);
  assert.equal(below.length, 1);
  assert.equal(below[0].reason, REASON.HIST_LOW);
  assert.equal(REASON_LABEL[below[0].reason], '新史低', '跌破才叫「新」史低');
  assert.equal(below[0].atHistLow, true);
});

test('没设目标价：与史低持平提醒「跌至史低」，没跌破不提醒', () => {
  const tie = evaluateAlerts([row({ current_cents: 9900, hist_low: 9900 })]);
  assert.equal(tie.length, 1, '平了历史最低仍提醒（不丢提醒）');
  assert.equal(tie[0].reason, REASON.HIST_LOW_TIE);
  assert.equal(REASON_LABEL[tie[0].reason], '跌至史低', '持平不能叫「新史低」');
  assert.equal(tie[0].atHistLow, true);

  assert.equal(evaluateAlerts([row({ current_cents: 14900, hist_low: 9900 })]).length, 0, '没跌破史低不提醒');
  assert.equal(evaluateAlerts([row({ current_cents: 9900, hist_low: null })]).length, 0, '没有昨天以前的史低：不猜也不误报');
});

test('原价透传：命中行带 originalCents，模板据此判「未降价」', () => {
  const hits = evaluateAlerts([row({ target_cents: 10000, current_cents: 9900, original_cents: 29800 })]);
  assert.equal(hits[0].originalCents, 29800);
  assert.equal(evaluateAlerts([row({ target_cents: 10000, current_cents: 9900, original_cents: null })])[0].originalCents, null);
});

test('没有在售价就不提醒', () => {
  assert.equal(evaluateAlerts([row({ current_cents: null, target_cents: 99999 })]).length, 0);
});

test('同一价位不重复打扰，继续下跌才再提醒', () => {
  const notified = row({ target_cents: 10000, current_cents: 9900, last_notified_cents: 9900 });
  assert.equal(evaluateAlerts([notified]).length, 0, '同价不重复');

  const cheaper = row({ target_cents: 10000, current_cents: 9000, last_notified_cents: 9900 });
  assert.equal(evaluateAlerts([cheaper]).length, 1, '更便宜要再提醒');

  const pricier = row({ target_cents: 10000, current_cents: 10100, last_notified_cents: 9900 });
  assert.equal(evaluateAlerts([pricier]).length, 0, '涨回目标价之上不提醒');
});

test('多个关注项一起判定，互不干扰', () => {
  const hits = evaluateAlerts([
    row({ watch_id: 1, name: 'A', target_cents: 10000, current_cents: 9000 }),
    row({ watch_id: 2, name: 'B', target_cents: 10000, current_cents: 12000 }),
    row({ watch_id: 3, name: 'C', current_cents: 500, hist_low: 500 }), // 持平史低：提醒
    row({ watch_id: 4, name: 'D', current_cents: 600, hist_low: 500 }), // 没跌破：不提醒
  ]);
  assert.deepEqual(hits.map((h) => h.name), ['A', 'C']);
  assert.equal(hits[1].reason, REASON.HIST_LOW_TIE);
});

test('简报包含名称、价格、原因与链接', () => {
  const text = renderDigest(evaluateAlerts([row({ target_cents: 10000, current_cents: 9900 })]));
  assert.match(text, /价格提醒/);
  assert.match(text, /赛博朋克 2077/);
  assert.match(text, /¥99\.00/);
  assert.match(text, /已达目标价/);
  assert.match(text, /store\.steampowered\.com\/app\/1091500/);
  assert.equal(renderDigest([]), '没有需要提醒的价格。');
});

// FM §2.3/§2.4：邮件正文（纯文本兜底也走这里）不能出现「新史低 ¥X 史低 ¥X」这种重复，
// 也不能在价格=原价（没打折）时谈史低。反向自检：把 shouldShowHistLow 的任一分支去掉，本组红。
test('简报：新史低/跌至史低标签区分，同价不重复显示史低', () => {
  const tie = renderDigest(evaluateAlerts([row({ current_cents: 9900, hist_low: 9900 })]));
  assert.match(tie, /跌至史低/);
  assert.ok(!tie.includes('新史低'), '持平不标「新史低」');
  assert.ok(!tie.includes('史低 ¥99.00'), '同价不重复显示「史低 ¥X」');

  const fresh = renderDigest(evaluateAlerts([row({ current_cents: 8800, hist_low: 9900 })]));
  assert.match(fresh, /新史低/);
  assert.match(fresh, /史低 ¥99\.00/, '真跌破时「史低」显示昨天以前的旧低');
});

test('简报：未降价（价格=原价）不显示史低段，有折扣才显示', () => {
  const undiscounted = renderDigest(
    evaluateAlerts([row({ target_cents: 14900, current_cents: 14900, original_cents: 14900, hist_low: 9900 })]),
  );
  assert.match(undiscounted, /已达目标价/);
  assert.ok(!undiscounted.includes('史低'), '价格=原价时不显示史低');

  const discounted = renderDigest(
    evaluateAlerts([row({ target_cents: 14900, current_cents: 14900, original_cents: 29800, hist_low: 9900 })]),
  );
  assert.match(discounted, /史低 ¥99\.00/, '有折扣时史低信息保留');
});

test('投递载荷结构稳定（给 webhook 用）', () => {
  const hits = evaluateAlerts([row({ target_cents: 10000, current_cents: 9900, note: '想玩' })]);
  const payload = toPayload(hits);
  assert.equal(payload.type, 'steamdeals.alerts');
  assert.equal(payload.count, 1);
  assert.equal(payload.alerts[0].name, '赛博朋克 2077');
  assert.equal(payload.alerts[0].current, 9900);
  assert.equal(payload.alerts[0].reason, REASON.TARGET);
  assert.equal(payload.alerts[0].note, '想玩');
  assert.ok(payload.text.includes('价格提醒'));
});

test('webhook 成功与失败都不抛异常', async () => {
  const okFetch = async () => ({ ok: true, status: 204, text: async () => '' });
  assert.deepEqual(await postWebhook('https://example.com/hook', { a: 1 }, { fetchImpl: okFetch }), {
    ok: true,
    status: 204,
    body: '',
  });

  const failFetch = async () => {
    throw new Error('connect ECONNREFUSED');
  };
  const failed = await postWebhook('https://example.com/hook', { a: 1 }, { fetchImpl: failFetch });
  assert.equal(failed.ok, false);
  assert.match(failed.error, /ECONNREFUSED/);
});
