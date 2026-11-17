// CL 批（docs/USER-ALERTS.md）：用户级到价提醒——数据层 CRUD + 站点级/用户级并存 + 部分唯一索引 +
// 用户隔离 + 详情 watch 字段 + 管理员全站清单 + 提醒分组投递（groupAlertsByUser）+ 真实 HTTP 接口语义。
// 断言行为而非只看全绿：每条注释写清"守的是什么约束"。
import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer } from '../src/server.js';
import { evaluateAlerts, groupAlertsByUser } from '../src/alerts.js';
import { ingestOffers } from '../src/ingest.js';

// 与 api.test.js 一致：测试默认关登录验证码（HTTP 用例要真实登录）
process.env.CAPTCHA_ENABLED = '0';

async function setup() {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  return { store, q };
}

/** 建游戏 + 报价，返回 gameId。 */
async function makeGame(q, store, appid, name = '测试游戏', priceCents = 10000) {
  await ingestOffers(store, {
    platform: { code: 'steam', name: 'Steam 国区', kind: 'official' },
    offers: [
      {
        platformCode: 'steam',
        platformProductId: String(appid),
        steamAppid: appid,
        title: name,
        productType: 'official_direct',
        region: 'cn',
        currency: 'CNY',
        priceCents,
        originalCents: priceCents,
        discountPct: 0,
        inStock: true,
        buyUrl: `https://store.steampowered.com/app/${appid}/`,
        meta: {},
      },
    ],
  });
  const r = await q('select id from games where steam_appid = $1', [appid]);
  return Number(r.rows[0].id);
}

test('迁移幂等：migrate 连跑两次不报错，索引与列就位', async () => {
  const { store, q } = await setup();
  try {
    await db.migrate(store); // 第二次：幂等
    const cols = (await q("select column_name from information_schema.columns where table_name = 'watchlist'")).rows.map((r) => r.column_name);
    assert.ok(cols.includes('user_id'), 'watchlist 有 user_id 列');
    const idx = (await q("select indexname from pg_indexes where tablename = 'watchlist'")).rows.map((r) => r.indexname);
    assert.ok(idx.includes('watchlist_user_game_uq'), '用户级部分唯一索引存在');
    assert.ok(idx.includes('watchlist_site_game_uq'), '站点级部分唯一索引存在');
    // 旧约束已删：同名 (game_id, region) 唯一约束不再存在
    assert.ok(!idx.includes('watchlist_game_id_region_key'), '旧的整表唯一约束已删除');
  } finally {
    await store.close();
  }
});

test('用户级 CRUD：upsert 更新不重复、list 倒序带价格、getUserWatch 回显、delete 幂等', async () => {
  const { store, q } = await setup();
  try {
    const u1 = (await db.createUser(q, { username: 'wuser1', password: 'wpass123456', role: 'user' })).id;
    const g1 = await makeGame(q, store, 400001, '游戏一', 10000);
    const g2 = await makeGame(q, store, 400002, '游戏二', 20000);

    // upsert：同键重复只更新目标价，不产生重复行
    const id1 = await db.upsertUserWatch(q, { userId: u1, gameId: g1, targetCents: 8000, note: '想玩' });
    const id2 = await db.upsertUserWatch(q, { userId: u1, gameId: g1, targetCents: 9000 });
    assert.equal(id1, id2, '同 (user,game,region) 重复 upsert 返回同一行 id');
    const count = Number((await q('select count(*)::int as n from watchlist where user_id = $1', [u1])).rows[0].n);
    assert.equal(count, 1, '不产生重复行');

    const watch = await db.getUserWatch(q, { userId: u1, gameId: g1 });
    assert.deepEqual(watch, { targetCents: 9000, note: null, createdAt: watch.createdAt }, '回显目标价（重复 upsert 覆盖备注为提交值）');

    await db.upsertUserWatch(q, { userId: u1, gameId: g2, targetCents: null });
    const list = await db.listUserWatches(q, { userId: u1 });
    assert.equal(list.length, 2, '列表两条');
    assert.equal(Number(list[0].game_id), g2, '按加入时间倒序（后加的在前）');
    assert.equal(Number(list[0].current_cents), 20000, '带当前价');
    assert.equal(Number(list[0].hist_low), 20000, '带史低');

    assert.equal(await db.deleteUserWatch(q, { userId: u1, gameId: g1 }), 1, '删除返回 removed 1');
    assert.equal(await db.deleteUserWatch(q, { userId: u1, gameId: g1 }), 0, '重复删除返回 0（幂等）');
  } finally {
    await store.close();
  }
});

test('两级并存：站点级（NULL）与用户级互不冲突；站点级函数只碰 NULL 行', async () => {
  const { store, q } = await setup();
  try {
    const u1 = (await db.createUser(q, { username: 'wuser2', password: 'wpass123456', role: 'user' })).id;
    const g1 = await makeGame(q, store, 400003, '游戏三', 5000);

    await db.upsertWatch(q, { gameId: g1, targetCents: 4000 }); // 站点级
    await db.upsertUserWatch(q, { userId: u1, gameId: g1, targetCents: 3000 }); // 用户级同游戏
    const all = await q('select user_id, target_cents from watchlist where game_id = $1 order by user_id nulls first', [g1]);
    assert.equal(all.rows.length, 2, '同游戏站点级与用户级并存');

    const siteList = await db.listWatches(q);
    assert.equal(siteList.length, 1, '站点级清单只含 NULL 行');
    assert.equal(Number(siteList[0].target_cents), 4000);

    // 站点级删除只删 NULL 行，用户级不受影响
    assert.equal(await db.deleteWatch(q, { gameId: g1 }), 1);
    const left = await q('select user_id from watchlist where game_id = $1', [g1]);
    assert.equal(left.rows.length, 1, '删站点级后用户级仍在');
    assert.equal(Number(left.rows[0].user_id), u1);
  } finally {
    await store.close();
  }
});

test('用户隔离：A 删不掉 B 的提醒；管理员可按 id 清理任意一条', async () => {
  const { store, q } = await setup();
  try {
    const uA = (await db.createUser(q, { username: 'wuserA', password: 'wpass123456', role: 'user' })).id;
    const uB = (await db.createUser(q, { username: 'wuserB', password: 'wpass123456', role: 'user' })).id;
    const g1 = await makeGame(q, store, 400004, '游戏四', 6000);
    const watchId = await db.upsertUserWatch(q, { userId: uB, gameId: g1, targetCents: 5000 });

    assert.equal(await db.deleteUserWatch(q, { userId: uA, gameId: g1 }), 0, 'A 删 B 的 → removed 0（只删自己的）');
    assert.equal(await db.getUserWatch(q, { userId: uA, gameId: g1 }), null, 'A 看不到 B 的提醒');
    assert.ok((await db.getUserWatch(q, { userId: uB, gameId: g1 })) != null, 'B 的提醒仍在');

    const admin = await db.deleteWatchById(q, { id: watchId });
    assert.equal(Number(admin.user_id), uB, '管理员按 id 删除返回被删行（审计用）');
    assert.equal((await db.getUserWatch(q, { userId: uB, gameId: g1 })), null);
  } finally {
    await store.close();
  }
});

test('管理员全站清单：分页 + 用户名筛选 + total 精确', async () => {
  const { store, q } = await setup();
  try {
    const u1 = (await db.createUser(q, { username: 'listuser1', password: 'wpass123456', role: 'user' })).id;
    const u2 = (await db.createUser(q, { username: 'listuser2', password: 'wpass123456', role: 'user' })).id;
    const g1 = await makeGame(q, store, 400005, '游戏五', 7000);
    const g2 = await makeGame(q, store, 400006, '游戏六', 8000);
    await db.upsertUserWatch(q, { userId: u1, gameId: g1, targetCents: 6000 });
    await db.upsertUserWatch(q, { userId: u2, gameId: g2, targetCents: 7000 });
    await db.upsertWatch(q, { gameId: g1, targetCents: 5000 }); // 站点级也进全站清单

    const all = await db.listAllWatchesAdmin(q, { page: 1, pageSize: 20 });
    assert.equal(all.total, 3, '全站含用户级 + 站点级');
    assert.ok(all.items.some((i) => i.username === 'listuser1'), '含用户名 listuser1');
    assert.ok(all.items.some((i) => i.username === 'listuser2'), '含用户名 listuser2');
    assert.ok(all.items.some((i) => i.username === null), '站点级行 username 为 null');

    const filtered = await db.listAllWatchesAdmin(q, { page: 1, pageSize: 20, username: 'listuser1' });
    assert.equal(filtered.total, 1, '按用户名筛选');
    assert.equal(filtered.items[0].username, 'listuser1');
  } finally {
    await store.close();
  }
});

test('watchCandidates 带 user_id/邮箱；evaluateAlerts 透传；groupAlertsByUser 分组稳定', async () => {
  const { store, q } = await setup();
  try {
    const u1 = (await db.createUser(q, { username: 'mailuser1', password: 'wpass123456', role: 'user', email: 'a@example.com' })).id;
    const u2 = (await db.createUser(q, { username: 'mailuser2', password: 'wpass123456', role: 'user' })).id; // 无邮箱
    const g1 = await makeGame(q, store, 400007, '游戏七', 9000);
    const g2 = await makeGame(q, store, 400008, '游戏八', 8000);
    await db.upsertUserWatch(q, { userId: u1, gameId: g1, targetCents: 10000 });
    await db.upsertUserWatch(q, { userId: u2, gameId: g2, targetCents: 10000 });
    await db.upsertWatch(q, { gameId: g2, targetCents: 9000 });

    const hits = evaluateAlerts(await db.watchCandidates(q));
    assert.equal(hits.length, 3, '三条全部命中');
    const grouped = groupAlertsByUser(hits);
    assert.equal(grouped.site.length, 1, '站点级 1 条');
    assert.equal(grouped.users.length, 2, '两个用户分组');
    const u1g = grouped.users.find((x) => x.userId === Number(u1));
    assert.equal(u1g.email, 'a@example.com', '带用户邮箱');
    assert.equal(u1g.hits.length, 1);
    const u2g = grouped.users.find((x) => x.userId === Number(u2));
    assert.equal(u2g.email, null, '无邮箱用户 email 为 null（投递层跳过并记日志）');
    assert.ok(grouped.users[0].userId < grouped.users[1].userId, '分组按 userId 升序（投递顺序稳定）');
  } finally {
    await store.close();
  }
});

test('HTTP：未登录 401；用户可加/查/删自己的提醒；详情带 watch；A 删 B 返回 removed 0；参数校验', async () => {
  const { store, q } = await setup();
  const uA = (await db.createUser(q, { username: 'httpA', password: 'wpass123456', role: 'user' })).id;
  const uB = (await db.createUser(q, { username: 'httpB', password: 'wpass123456', role: 'user' })).id;
  const g1 = await makeGame(q, store, 400009, 'HTTP游戏', 11000);
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
    // 未登录：401 login_required 语义（Web 是「需要登录」；用状态码断言）
    assert.equal((await fetch(`${base}/api/watchlist`)).status, 401, '未登录 GET 401');
    assert.equal((await fetch(`${base}/api/watchlist`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401, '未登录 POST 401');
    assert.equal((await fetch(`${base}/api/watchlist/${g1}`, { method: 'DELETE' })).status, 401, '未登录 DELETE 401');

    const cookieA = await login('httpA', 'wpass123456');
    const cookieB = await login('httpB', 'wpass123456');
    const auth = (c) => ({ cookie: c, 'content-type': 'application/json' });

    // A 加提醒（appid 入口）
    const add = await fetch(`${base}/api/watchlist`, { method: 'POST', headers: auth(cookieA), body: JSON.stringify({ appid: 400009, targetCents: 9900, note: '蹲一个' }) });
    assert.equal(add.status, 200, 'A 加提醒 200');
    // 非法目标价 400
    const bad = await fetch(`${base}/api/watchlist`, { method: 'POST', headers: auth(cookieA), body: JSON.stringify({ appid: 400009, targetCents: -5 }) });
    assert.equal(bad.status, 400, '负数目标价 400');

    // 详情带 watch（A 登录）
    const detailA = await (await fetch(`${base}/api/games/400009`, { headers: { cookie: cookieA } })).json();
    assert.equal(detailA.watch.targetCents, 9900, '详情 watch 回显 A 的目标价');
    assert.equal(detailA.watch.note, '蹲一个', '详情 watch 回显备注');
    // 游客详情 watch 为 null
    const detailGuest = await (await fetch(`${base}/api/games/400009`)).json();
    assert.equal(detailGuest.watch, null, '游客详情 watch 为 null');

    // B 的列表看不到 A 的提醒
    const listB = await (await fetch(`${base}/api/watchlist`, { headers: { cookie: cookieB } })).json();
    assert.equal(listB.watches.length, 0, 'B 列表为空（看不到 A 的）');
    // B 删 A 的 → removed 0
    const delB = await (await fetch(`${base}/api/watchlist/${g1}`, { method: 'DELETE', headers: { cookie: cookieB } })).json();
    assert.equal(delB.removed, 0, 'B 删 A 的 → removed 0');
    // A 自己删 → removed 1
    const delA = await (await fetch(`${base}/api/watchlist/${g1}`, { method: 'DELETE', headers: { cookie: cookieA } })).json();
    assert.equal(delA.removed, 1, 'A 删自己的 → removed 1');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('HTTP：管理员全站清单可查可删（按提醒 id + 审计），普通用户 403', async () => {
  const { store, q } = await setup();
  const admin = (await db.createUser(q, { username: 'httpadmin', password: 'wpass123456', role: 'admin' })).id;
  const u = (await db.createUser(q, { username: 'httpuser', password: 'wpass123456', role: 'user' })).id;
  const g1 = await makeGame(q, store, 400010, '管理游戏', 12000);
  const watchId = await db.upsertUserWatch(q, { userId: u, gameId: g1, targetCents: 10000 });
  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${srv.port}`;
  const login = async (username, password) => {
    const res = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
    return (res.headers.get('set-cookie') ?? '').split(';')[0];
  };
  try {
    const cookieU = await login('httpuser', 'wpass123456');
    const cookieAdmin = await login('httpadmin', 'wpass123456');
    assert.equal((await fetch(`${base}/api/admin/watchlist`, { headers: { cookie: cookieU } })).status, 403, '普通用户访问管理员清单 403');

    const list = await (await fetch(`${base}/api/admin/watchlist?username=httpuser`, { headers: { cookie: cookieAdmin } })).json();
    assert.equal(list.total, 1, '管理员按用户名筛选查全站');
    assert.equal(list.items[0].username, 'httpuser');
    assert.equal(Number(list.items[0].current_cents), 12000, '清单带当前价');

    const del = await fetch(`${base}/api/admin/watchlist/${watchId}`, { method: 'DELETE', headers: { cookie: cookieAdmin } });
    assert.equal(del.status, 200, '管理员按提醒 id 删除 200');
    assert.equal(await db.getUserWatch(q, { userId: u, gameId: g1 }), null, '删除生效');
    // 不存在 → 404
    assert.equal((await fetch(`${base}/api/admin/watchlist/999999`, { method: 'DELETE', headers: { cookie: cookieAdmin } })).status, 404);
  } finally {
    await srv.close();
    await store.close();
  }
});
