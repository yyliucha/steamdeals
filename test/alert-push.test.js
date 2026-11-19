// DF（docs/ALERT-MANUAL-PUSH.md §4 验收）：后台到价提醒手动推送——
// 达标即发 / 未达标不强制不发（reason not_met）/ 强制推送（reason manual + 文案标注）/
// mark 默认勾选并写 last_notified（后续自动任务不重复提醒同价格）/ 5 分钟频控 429 /
// 无通道禁用（400 + 列表 notifyChannels 空）/ 审计 admin.alert_pushed 落库 /
// 用户级提醒不可推（403 + admin.forbidden_write）/ 批量合并一封邮件 + 逐条结果。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer, resetAlertPushBuckets } from '../src/server.js';
import { buildPushHits, evaluateAlerts, REASON } from '../src/alerts.js';

process.env.CAPTCHA_ENABLED = '0';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** 清掉所有提醒通道 env（每个测试按需配置，避免本机环境变量串扰）。 */
function clearChannels() {
  delete process.env.ALERT_WEBHOOK_URL;
  delete process.env.WECOM_WEBHOOK_URL;
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.ALERT_EMAIL_TO;
}

async function setup() {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  return { store, q };
}

/** 假 webhook 接收器：记录每次 POST 到的 JSON。 */
function fakeWebhook() {
  const posts = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        posts.push(JSON.parse(body));
      } catch {
        /* 非 JSON 忽略 */
      }
      res.writeHead(200).end('ok');
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, posts, url: `http://127.0.0.1:${server.address().port}/alerts` })));
}

/** 建游戏行，返回内部 game_id。 */
async function makeGame(q, appid, name) {
  await db.ensureGame(q, { steamAppid: appid, name, nameEn: null, meta: null });
  const r = await q('select id from games where steam_appid = $1', [appid]);
  return Number(r.rows[0].id);
}

/** 给游戏写当前价（官方渠道在售）与史低（日聚合）。 */
async function setPrices(q, gameId, currentCents, histCents) {
  await q(
    `insert into offers (game_id, platform_code, product_type, region, currency, price_cents, in_stock)
     values ($1,'steam','official_direct','cn','CNY',$2,true)`,
    [gameId, currentCents],
  );
  await q(
    `insert into daily_prices (game_id, platform_code, region, day, min_price_cents, currency)
     values ($1,'steam','cn', current_date - 1, $2, 'CNY')`,
    [gameId, histCents],
  );
}

/** 起服务 + 管理员登录。 */
async function startServer(q) {
  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${srv.port}`;
  const login = async (username, password) => {
    const res = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
    return (res.headers.get('set-cookie') ?? '').split(';')[0];
  };
  return { srv, base, login };
}

// ---------------------------------------------------------------- 纯函数：判定口径

test('DF buildPushHits：达标命中 / 未达标 skipped / 强制转 manual / 无报价永不推送', () => {
  const base = {
    watch_id: 1,
    user_id: null,
    user_email: null,
    user_email_alerts: true,
    game_id: 10,
    steam_appid: 100,
    name: '游戏A',
    note: null,
  };
  // 有目标价：current<=target 命中 target；未达标 skipped；force 后 manual
  const targetRows = [
    { ...base, watch_id: 1, target_cents: 9000, hist_low: null, current_cents: 8000 },
    { ...base, watch_id: 2, target_cents: 9000, hist_low: null, current_cents: 12000 },
  ];
  const r1 = buildPushHits(targetRows, { force: false });
  assert.equal(r1.hits.length, 1, '只有达标行命中');
  assert.equal(r1.hits[0].reason, REASON.TARGET, '达标原因 target');
  assert.equal(r1.hits[0].manual, true, '手动推送标记 manual');
  assert.equal(r1.skipped.length, 1);
  assert.equal(r1.skipped[0].reason, 'not_met');
  assert.equal(r1.skipped[0].currentCents, 12000, 'skipped 带当前价供提示文案');
  const r1f = buildPushHits(targetRows, { force: true });
  assert.equal(r1f.hits.length, 2, 'force 时未达标行也命中');
  assert.equal(r1f.hits[1].reason, REASON.MANUAL, '强制未达标 → reason manual');

  // 史低模式：current<=hist 命中 hist_low；未达标 skipped；force → manual
  const histRows = [
    { ...base, watch_id: 3, target_cents: null, hist_low: 6000, current_cents: 5000 },
    { ...base, watch_id: 4, target_cents: null, hist_low: 6000, current_cents: 7000 },
  ];
  const r2 = buildPushHits(histRows, { force: false });
  assert.equal(r2.hits.length, 1);
  assert.equal(r2.hits[0].reason, REASON.HIST_LOW);
  const r2f = buildPushHits(histRows, { force: true });
  assert.equal(r2f.hits.length, 2, 'force 时史低未达标也命中');
  assert.equal(r2f.hits[1].reason, REASON.MANUAL);

  // 无在售报价：即使 force 也不发（无价可发）
  const r3 = buildPushHits([{ ...base, watch_id: 5, target_cents: null, hist_low: 100, current_cents: null }], { force: true });
  assert.equal(r3.hits.length, 0);
  assert.equal(r3.skipped[0].reason, 'no_price');
});

// ---------------------------------------------------------------- HTTP：单条推送

test('DF 单条达标推送：webhook 真收到、mark 默认勾选写 last_notified、去重生效、审计落库', async () => {
  clearChannels();
  resetAlertPushBuckets();
  const { store, q } = await setup();
  const hook = await fakeWebhook();
  process.env.ALERT_WEBHOOK_URL = hook.url;
  const admin = (await db.createUser(q, { username: 'pushadmin', password: 'wpass123456', role: 'admin' })).id;
  const gid = await makeGame(q, 1001, '达标游戏');
  await setPrices(q, gid, 5000, 6000); // 当前 50 <= 史低 60 → 达标
  const wid = await db.upsertWatch(q, { gameId: gid });
  try {
    const { srv, base, login } = await startServer(q);
    try {
      const cookie = await login('pushadmin', 'wpass123456');
      const res = await fetch(`${base}/api/admin/watchlist/${wid}/push`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ force: false }), // 不传 mark → 默认勾选
      });
      assert.equal(res.status, 200);
      const d = await res.json();
      assert.equal(d.sent, true, '达标 → sent:true');
      assert.equal(d.markApplied, true, 'mark 默认勾选');
      assert.equal(d.channel, 'webhook');

      // 投递证据：假 webhook 收到 1 次、payload 含游戏名与「手动推送」文案
      assert.equal(hook.posts.length, 1, 'webhook 真收到一次');
      assert.equal(hook.posts[0].alerts.length, 1);
      assert.equal(hook.posts[0].alerts[0].name, '达标游戏');
      assert.match(hook.posts[0].text, /手动推送/, '文案标注「手动推送」（§4.3）');

      // mark 去重：last_notified 写入当前价 → 自动任务不再提醒同价格（§4.4）
      const w = (await q('select last_notified_cents, last_notified_at from watchlist where id = $1', [wid])).rows[0];
      assert.equal(Number(w.last_notified_cents), 5000, 'last_notified_cents = 当前价');
      assert.ok(w.last_notified_at, 'last_notified_at 已写');
      const hitsAfterMark = evaluateAlerts(await db.watchCandidates(q));
      assert.equal(hitsAfterMark.filter((h) => h.watchId === wid).length, 0, 'mark 后同价格不再命中（去重）');

      // 审计落库（§4.5）
      const aud = (await q("select * from audit_logs where action = 'admin.alert_pushed' order by id desc")).rows[0];
      assert.equal(aud.actor, 'pushadmin');
      assert.equal(aud.detail.outcome, 'sent');
      assert.deepEqual(aud.detail.ids, [wid]);
      assert.equal(aud.detail.mark, true, '审计记录 mark 值');
    } finally {
      await srv.close();
    }
  } finally {
    await store.close();
    hook.server.close();
    clearChannels();
  }
});

test('DF 未达标不强制：200 sent:false reason not_met，不发信不改 last_notified，审计 not_met', async () => {
  clearChannels();
  resetAlertPushBuckets();
  const { store, q } = await setup();
  const hook = await fakeWebhook();
  process.env.ALERT_WEBHOOK_URL = hook.url;
  await db.createUser(q, { username: 'pushadmin2', password: 'wpass123456', role: 'admin' });
  const gid = await makeGame(q, 1002, '未达标游戏');
  await setPrices(q, gid, 12000, 6000); // 当前 120 > 史低 60 → 未达标
  const wid = await db.upsertWatch(q, { gameId: gid });
  try {
    const { srv, base, login } = await startServer(q);
    try {
      const cookie = await login('pushadmin2', 'wpass123456');
      const res = await fetch(`${base}/api/admin/watchlist/${wid}/push`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ force: false, mark: true }),
      });
      assert.equal(res.status, 200);
      const d = await res.json();
      assert.equal(d.sent, false, '未达标不强制 → sent:false');
      assert.equal(d.reason, 'not_met', '原因 not_met（§4.2 提示文案数据源）');
      assert.equal(d.currentCents, 12000);
      assert.equal(hook.posts.length, 0, '未达标不发信');
      const w = (await q('select last_notified_cents from watchlist where id = $1', [wid])).rows[0];
      assert.equal(w.last_notified_cents, null, '未发送不改 last_notified');
      const aud = (await q("select * from audit_logs where action = 'admin.alert_pushed' order by id desc")).rows[0];
      assert.equal(aud.detail.outcome, 'not_met', '未达标也落审计（页面提示有据可查）');
    } finally {
      await srv.close();
    }
  } finally {
    await store.close();
    hook.server.close();
    clearChannels();
  }
});

test('DF 强制推送：未达标也发（reason manual），mark=false 不改 last_notified', async () => {
  clearChannels();
  resetAlertPushBuckets();
  const { store, q } = await setup();
  const hook = await fakeWebhook();
  process.env.ALERT_WEBHOOK_URL = hook.url;
  await db.createUser(q, { username: 'pushadmin3', password: 'wpass123456', role: 'admin' });
  const gid = await makeGame(q, 1003, '强制游戏');
  await setPrices(q, gid, 12000, 6000); // 未达标
  const wid = await db.upsertWatch(q, { gameId: gid });
  try {
    const { srv, base, login } = await startServer(q);
    try {
      const cookie = await login('pushadmin3', 'wpass123456');
      const res = await fetch(`${base}/api/admin/watchlist/${wid}/push`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ force: true, mark: false }),
      });
      const d = await res.json();
      assert.equal(d.sent, true, '强制 → 发送');
      assert.equal(d.markApplied, false);
      assert.equal(hook.posts.length, 1);
      assert.equal(hook.posts[0].alerts[0].reason, 'manual', '强制未达标 reason=manual');
      assert.match(hook.posts[0].text, /手动推送/);
      const w = (await q('select last_notified_cents from watchlist where id = $1', [wid])).rows[0];
      assert.equal(w.last_notified_cents, null, 'mark=false 不改 last_notified（§4.4）');
    } finally {
      await srv.close();
    }
  } finally {
    await store.close();
    hook.server.close();
    clearChannels();
  }
});

test('DF 频控：5 分钟内同 watch/同批重复推送 429（带 retryAfterSec），重置后可再推', async () => {
  clearChannels();
  resetAlertPushBuckets();
  const { store, q } = await setup();
  const hook = await fakeWebhook();
  process.env.ALERT_WEBHOOK_URL = hook.url;
  await db.createUser(q, { username: 'pushadmin4', password: 'wpass123456', role: 'admin' });
  const g1 = await makeGame(q, 1004, '频控A');
  const g2 = await makeGame(q, 1005, '频控B');
  await setPrices(q, g1, 5000, 6000);
  await setPrices(q, g2, 5000, 6000);
  const w1 = await db.upsertWatch(q, { gameId: g1 });
  const w2 = await db.upsertWatch(q, { gameId: g2 });
  try {
    const { srv, base, login } = await startServer(q);
    try {
      const cookie = await login('pushadmin4', 'wpass123456');
      const pushOne = (id, body = {}) =>
        fetch(`${base}/api/admin/watchlist/${id}/push`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
      const batchPush = (ids) =>
        fetch(`${base}/api/admin/watchlist/push`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ ids }) });
      // 第一次 200；同一 watch 二次 → 429
      assert.equal((await pushOne(w1)).status, 200, '首次推送成功');
      const r429 = await pushOne(w1);
      assert.equal(r429.status, 429, '5 分钟内同 watch 重复推送 429（§4.5）');
      const d429 = await r429.json();
      assert.ok(d429.retryAfterSec > 0, '带 retryAfterSec');
      assert.match(d429.error, /5 分钟内/);
      const aud429 = (await q("select * from audit_logs where action = 'admin.alert_pushed' order by id desc limit 1")).rows[0];
      assert.equal(aud429.detail.outcome, 'rate_limited', '429 尝试落审计');
      // 另一个 watch 首推仍 200；含已推 watch 的批量 → 429（"同一 watch"维度）
      assert.equal((await pushOne(w2)).status, 200, '不同 watch 不受影响');
      assert.equal((await batchPush([w1, w2])).status, 429, '批内任一 watch 在窗口内 → 429');
      // 重置后：批量首次 200，同批二次 429（"同一批"维度）
      resetAlertPushBuckets();
      assert.equal((await batchPush([w1, w2])).status, 200, '重置后批量首次成功');
      assert.equal((await batchPush([w1, w2])).status, 429, '同批二次 429');
      // 再重置：同 watch 可再推
      resetAlertPushBuckets();
      assert.equal((await pushOne(w1)).status, 200, '重置频控后可再推');
    } finally {
      await srv.close();
    }
  } finally {
    await store.close();
    hook.server.close();
    clearChannels();
  }
});

test('DF 无通道：按钮禁用数据源 notifyChannels 为空 + 推送 400 提示配置', async () => {
  clearChannels();
  resetAlertPushBuckets();
  const { store, q } = await setup();
  await db.createUser(q, { username: 'pushadmin5', password: 'wpass123456', role: 'admin' });
  const gid = await makeGame(q, 1006, '无通道游戏');
  await setPrices(q, gid, 5000, 6000);
  const wid = await db.upsertWatch(q, { gameId: gid });
  try {
    const { srv, base, login } = await startServer(q);
    try {
      const cookie = await login('pushadmin5', 'wpass123456');
      const list = await (await fetch(`${base}/api/admin/watchlist?pageSize=20`, { headers: { cookie } })).json();
      assert.deepEqual(list.notifyChannels, [], '无通道时 notifyChannels 空（前端据此禁用按钮）');
      const res = await fetch(`${base}/api/admin/watchlist/${wid}/push`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ force: true }),
      });
      assert.equal(res.status, 400, '无通道推送 400');
      const d = await res.json();
      assert.match(d.error, /未配置任何通知通道/, '提示先在系统设置配置通道');
      const w = (await q('select last_notified_cents from watchlist where id = $1', [wid])).rows[0];
      assert.equal(w.last_notified_cents, null);
    } finally {
      await srv.close();
    }
  } finally {
    await store.close();
  }
});

test('DF 用户级提醒不可推：403 + admin.forbidden_write 审计（仅站点级可推）', async () => {
  clearChannels();
  resetAlertPushBuckets();
  const { store, q } = await setup();
  const hook = await fakeWebhook();
  process.env.ALERT_WEBHOOK_URL = hook.url;
  await db.createUser(q, { username: 'pushadmin6', password: 'wpass123456', role: 'admin' });
  const u1 = (await db.createUser(q, { username: 'pushu1', password: 'wpass123456', email: 'u1@example.com' })).id;
  const gid = await makeGame(q, 1007, '用户级游戏');
  await setPrices(q, gid, 5000, 6000);
  const userWid = await db.upsertUserWatch(q, { userId: u1, gameId: gid, targetCents: 9000 });
  try {
    const { srv, base, login } = await startServer(q);
    try {
      const cookie = await login('pushadmin6', 'wpass123456');
      const res = await fetch(`${base}/api/admin/watchlist/${userWid}/push`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ force: true }),
      });
      assert.equal(res.status, 403, '用户级提醒推送 403（§5.1 只站点级）');
      const d = await res.json();
      assert.match(d.error, /用户提醒不可推送/);
      assert.equal(hook.posts.length, 0, '不投递');
      const aud = (await q("select * from audit_logs where action = 'admin.forbidden_write' order by id desc")).rows[0];
      assert.equal(Number(aud.detail.userId), u1, '403 尝试落 forbidden_write 审计');
    } finally {
      await srv.close();
    }
  } finally {
    await store.close();
    hook.server.close();
    clearChannels();
  }
});

test('DF 批量：合并一封邮件（webhook 只收 1 次、含全部命中游戏）、逐条结果、mark 只作用于已发送行', async () => {
  clearChannels();
  resetAlertPushBuckets();
  const { store, q } = await setup();
  const hook = await fakeWebhook();
  process.env.ALERT_WEBHOOK_URL = hook.url;
  await db.createUser(q, { username: 'pushadmin7', password: 'wpass123456', role: 'admin' });
  const gA = await makeGame(q, 1008, '批量A');
  const gB = await makeGame(q, 1009, '批量B');
  const gC = await makeGame(q, 1010, '批量C');
  await setPrices(q, gA, 5000, 6000); // 达标（史低模式）
  await setPrices(q, gB, 8000, 9000); // 未达标（史低模式）
  await setPrices(q, gC, 12000, 6000); // 未达标（史低模式）
  const wA = await db.upsertWatch(q, { gameId: gA });
  const wB = await db.upsertWatch(q, { gameId: gB });
  const wC = await db.upsertWatch(q, { gameId: gC });
  try {
    const { srv, base, login } = await startServer(q);
    try {
      const cookie = await login('pushadmin7', 'wpass123456');
      const res = await fetch(`${base}/api/admin/watchlist/push`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ ids: [wA, wB, wC], force: false, mark: true }),
      });
      assert.equal(res.status, 200);
      const d = await res.json();
      assert.equal(d.sent, true);
      assert.equal(d.sentCount, 2, '2 条达标发送');
      assert.equal(d.results.length, 3, '逐条结果汇总（§4.5c）');
      const byId = (id) => d.results.find((r) => r.id === id);
      assert.equal(byId(wA).sent, true);
      assert.equal(byId(wB).sent, true);
      assert.equal(byId(wC).sent, false);
      assert.equal(byId(wC).reason, 'not_met');

      // 合并一封：webhook 只收到 1 次，正文列出全部命中游戏、不含未命中的 C
      assert.equal(hook.posts.length, 1, '批量只发一封（§5.3）');
      assert.equal(hook.posts[0].alerts.length, 2);
      const names = hook.posts[0].alerts.map((a) => a.name);
      assert.deepEqual(names.sort(), ['批量A', '批量B']);
      assert.ok(!hook.posts[0].text.includes('批量C'), '未达标的 C 不进邮件');

      // mark 只作用于已发送行
      const wk = (await q('select id, last_notified_cents from watchlist where id = any($1::int[]) order by id', [[wA, wB, wC]])).rows;
      const cents = Object.fromEntries(wk.map((r) => [Number(r.id), r.last_notified_cents]));
      assert.equal(Number(cents[wA]), 5000);
      assert.equal(Number(cents[wB]), 8000);
      assert.equal(cents[wC], null, '未发送行不改 last_notified');

      // 审计一次、带全部 ids 与逐条结果
      const aud = (await q("select * from audit_logs where action = 'admin.alert_pushed' and detail->>'outcome' = 'sent' order by id desc")).rows[0];
      assert.equal(aud.detail.sentCount, 2);
      assert.equal(aud.detail.ids.length, 3);
      assert.equal(aud.detail.perRow.length, 3);
    } finally {
      await srv.close();
    }
  } finally {
    await store.close();
    hook.server.close();
    clearChannels();
  }
});

test('DF 前端静态锁：推送按钮 / 强制与 mark 选项 / 批量合并 / 无通道禁用文案 / 接口调用', () => {
  const text = readFileSync(`${ROOT}/frontend/src/pages/AdminModules.vue`, 'utf8');
  assert.match(text, /推送选中/, '批量推送入口文案');
  assert.match(text, /强制推送/, '强制推送选项');
  assert.match(text, /更新最近提醒时间/, 'mark 选项文案');
  assert.match(text, /合并为 1 封邮件/, '批量合并一封提示');
  assert.match(text, /先在系统设置配置通知通道/, '无通道禁用提示');
  assert.match(text, /pushChannels\.length/, '按钮禁用消费 notifyChannels');
  assert.match(text, /\/api\/admin\/watchlist\/push/, '批量推送接口调用');
  assert.match(text, /\/api\/admin\/watchlist\/\$\{rows\[0\]\.id\}\/push/, '单条推送接口调用');
  assert.match(text, /openWatchPush/, '推送交互入口存在');
});
