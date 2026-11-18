// CR 批（docs/APP-DEV-PUBLISHER-NAMES.md）：开发商/发行商名称脏数据修复——
// ① mapStoreItem 归一化（GetItems 对象数组 → 名称）；② writeGames/upsertGameMeta 写库后为纯字符串；
// ③ migrate 幂等清洗历史脏元素；④ 详情接口真跑无 `{`。
import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer } from '../src/server.js';
import { mapStoreItem, namesFromList } from '../src/adapters/store-browse.js';

const DBD_DEV = { name: 'Behaviour Interactive Inc.', creator_clan_account_id: 33367148 };

test('CR-1：mapStoreItem 把 GetItems 对象数组归一化为名称（生产夹具：黎明杀机）', () => {
  const item = mapStoreItem({
    appid: 381210,
    name: 'Dead by Daylight',
    basic_info: {
      developers: [DBD_DEV],
      publishers: [DBD_DEV],
    },
  });
  assert.deepEqual(item.developers, ['Behaviour Interactive Inc.'], '对象数组取 name');
  assert.deepEqual(item.publishers, ['Behaviour Interactive Inc.']);
  assert.ok(!JSON.stringify(item.developers).includes('creator_clan_account_id'), '不再透传对象');
});

test('CR-1：归一化口径——去空白/去重保序/脏 JSON 文本兜底/截断 200/上限 20/空值', () => {
  assert.deepEqual(namesFromList([' A ', 'A', '', 'B']), ['A', 'B'], '去空白 + 去重保序');
  assert.deepEqual(namesFromList(['{"name":"Ubisoft Mainz"}', { name: 'Y' }]), ['Ubisoft Mainz', 'Y'], '历史脏 JSON 文本兜底 + 对象取 name');
  assert.deepEqual(namesFromList(['  ', null, 42, {}]), null, '非法/空元素丢弃，全空 → null');
  assert.equal(namesFromList(['x'.repeat(300)])[0].length, 200, '单条截断 200');
  assert.equal(namesFromList(Array.from({ length: 30 }, (_, i) => `n${i}`)).length, 20, '上限 20 条');
  assert.equal(namesFromList(null), null, '非数组 → null');
  assert.equal(namesFromList([]), null, '空数组 → null');
});

test('CR-2：migrate 清洗历史脏元素（幂等，二次运行无变化）', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  await q("insert into games (steam_appid, name) values (900001, '测试游戏')");
  // 手工造脏行：旧 GetItems 落库结果（对象被 JSON.stringify 成文本元素）+ 空白 + 重复
  await q(
    `update games set developers = array['{"name":"Behaviour Interactive Inc.","creator_clan_account_id":33367148}',' Clean Studio ','{"name":"Behaviour Interactive Inc.","creator_clan_account_id":33367148}','']`,
  );
  await q(`update games set publishers = array['{"name":"Pub Co", "x":1}','Pub Co','']`);

  await db.migrate(store); // 再跑一次迁移 = 执行清洗
  let row = (await q('select developers, publishers from games where steam_appid = 900001')).rows[0];
  assert.deepEqual(row.developers, ['Behaviour Interactive Inc.', 'Clean Studio'], '解析取 name、去空白、去重保序、丢空');
  assert.deepEqual(row.publishers, ['Pub Co'], 'publishers 同样清洗');

  await db.migrate(store); // 幂等：再跑无变化
  const again = (await q('select developers, publishers from games where steam_appid = 900001')).rows[0];
  assert.deepEqual(again, row, '二次迁移结果不变（幂等）');
  await store.close();
});

test('CR-2 修复：生产非法 JSON 元素不抛 22P02，清洗幂等稳定（v2.24.2 线上事故回归）', async () => {
  // 守的约束：① 截断/无引号键/空对象等非法 JSON 元素一律不抛错（旧 ::jsonb 实现会 22P02 崩 bootstrap）；
  //           ② 第一轮清洗出的 name 值本身以 `{` 开头时，第二轮不再被当 JSON 二次解析（否则仍 22P02）；
  //           ③ 纯文本元素原样保留。反向自检：把迁移里的 substring 提取换回 `::jsonb ->> 'name'` →
  //             本用例必红（pglite 抛 invalid input syntax for type json，22P02；旧 CR-2 用例的夹具全是合法
  //             JSON，在旧实现下仍绿——正是「测试夹具没覆盖生产脏形态」才让事故漏检，本用例补上这一层）。
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  await q("insert into games (steam_appid, name) values (900002, '脏数据回归')");
  await q(
    `update games set developers = array[
       '{"name":"Behaviour Interactive Inc.","creator_clan_account_id":33367148}',
       '{"name":"截断形态',
       '{name: "无引号键"}',
       '{}',
       '{"name":"{ 花括号名 }"}',
       '纯文本 Studio',
       '{"name":"Esc \\"Q\\" Name"}'
     ]`,
  );

  await db.migrate(store); // 第一轮清洗：任何元素都不抛错
  let row = (await q('select developers from games where steam_appid = 900002')).rows[0];
  // 设计口径：含 `"name":` 特征的元素 → 提取（提取不出则丢弃）；不含特征的元素（纯文本 / 无引号键 / 空对象）
  // → 原样保留，第二轮不再命中（幂等稳定），App 端 NameListSerializer 对无法解析的 `{` 文本兜底丢弃。
  assert.deepEqual(
    row.developers,
    ['Behaviour Interactive Inc.', '{name: "无引号键"}', '{}', '{ 花括号名 }', '纯文本 Studio', 'Esc \\"Q\\" Name'],
    '合法 JSON 提取 name；截断 JSON 丢弃；无 name 特征元素保留原文（幂等稳定）；name 含花括号正确提取；转义符按原样保留',
  );

  await db.migrate(store); // 第二轮：`{ 花括号名 }` 不含 "name": 特征，不再被二次解析
  const again = (await q('select developers from games where steam_appid = 900002')).rows[0];
  assert.deepEqual(again, row, '二次迁移结果不变（清洗产物不会被二次误解析）');
  await store.close();
});

test('CR-3：upsertGameMeta 写库后读回为纯字符串数组（无对象残留）', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  await db.upsertGameMeta(q, {
    steamAppid: 381210,
    nameZh: '黎明杀机',
    nameEn: 'Dead by Daylight',
    developers: ['Behaviour Interactive Inc.'],
    publishers: ['Behaviour Interactive Inc.'],
    source: 'store-browse',
  });
  const row = (await q('select developers, publishers from games where steam_appid = 381210')).rows[0];
  assert.deepEqual(row.developers, ['Behaviour Interactive Inc.']);
  assert.deepEqual(row.publishers, ['Behaviour Interactive Inc.']);
  assert.ok(!JSON.stringify(row.developers).includes('{'), '库里无 JSON 文本元素');
  await store.close();
});

test('CR-4：详情接口返回的 developers/publishers 为字符串数组、不含 {', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  await db.upsertGameMeta(q, {
    steamAppid: 381211,
    nameZh: '接口测试游戏',
    developers: ['Behaviour Interactive Inc.'],
    publishers: ['Behaviour Interactive Inc.'],
    source: 'store-browse',
  });
  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${srv.port}`;
  try {
    const detail = await (await fetch(`${base}/api/games/381211`)).json();
    assert.deepEqual(detail.game.developers, ['Behaviour Interactive Inc.']);
    assert.deepEqual(detail.game.publishers, ['Behaviour Interactive Inc.']);
    assert.ok(!JSON.stringify(detail.game.developers).includes('{'), '接口契约：字符串数组');
  } finally {
    await srv.close();
    await store.close();
  }
});
