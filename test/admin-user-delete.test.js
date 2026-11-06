// 用户彻底删除（docs/USER-LIFECYCLE.md §4.1/§4.5，AH 批）：
// 护栏（404/400/400/409）、级联清理 + steam_games/steam_wishlist 手动清（无外键）、
// 审计行只存脱敏快照、删除后用户名可立即重新注册、最近删除按用户名模糊搜索。
import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { ensureSteamSchemaOnce } from '../src/steam-login.js';

async function fresh() {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  await ensureSteamSchemaOnce(q);
  return { store, q };
}

test('护栏：不存在 404 / confirmUsername 不符 400 / 删自己 400 / 最后一个可用管理员 409', async () => {
  const { store, q } = await fresh();
  try {
    await db.createUser(q, { username: 'admin1', password: 'password123', role: 'admin' });
    await db.createUser(q, { username: 'bob', password: 'password123' });

    assert.deepEqual(await db.deleteUserAudited(q, { username: 'ghost', confirmUsername: 'ghost', operator: 'admin1' }), {
      ok: false,
      status: 404,
      error: '没有该用户',
    });
    const mismatch = await db.deleteUserAudited(q, { username: 'bob', confirmUsername: 'b0b', operator: 'admin1' });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.status, 400, 'confirmUsername 必须精确匹配');
    const self = await db.deleteUserAudited(q, { username: 'admin1', confirmUsername: 'admin1', operator: 'admin1' });
    assert.equal(self.ok, false);
    assert.equal(self.status, 400, '不能删除自己');
    // 只剩 admin1 一个可用管理员：即使操作者是别人也不许删
    const lastAdmin = await db.deleteUserAudited(q, { username: 'admin1', confirmUsername: 'admin1', operator: 'bob' });
    assert.equal(lastAdmin.ok, false);
    assert.equal(lastAdmin.status, 409, '不能删除最后一个可用管理员');
    // 有第二个可用管理员后放行
    await db.createUser(q, { username: 'admin2', password: 'password123', role: 'admin' });
    const ok = await db.deleteUserAudited(q, { username: 'admin1', confirmUsername: 'admin1', operator: 'admin2' });
    assert.equal(ok.ok, true, '有两个可用管理员时允许删除其中一个');
  } finally {
    await store.close();
  }
});

test('删除成功：级联清理 + 手动清 steam_games/steam_wishlist + 审计行脱敏', async () => {
  const { store, q } = await fresh();
  try {
    await db.createUser(q, { username: 'admin1', password: 'password123', role: 'admin' });
    const bob = await db.createUser(q, { username: 'bob', password: 'password123', email: 'bob@example.com' });
    await q('insert into steam_accounts (steam_id, persona_name, user_id) values ($1, $2, $3)', ['76561198000000001', 'Bob', bob.id]);
    const game = (await q("insert into games (steam_appid, name, is_free) values (8001, '测试', false) returning id")).rows[0].id;
    await q('insert into steam_games (steam_id, appid) values ($1, $2)', ['76561198000000001', 8001]);
    await q('insert into steam_wishlist (steam_id, appid) values ($1, $2)', ['76561198000000001', 8001]);
    await q('insert into user_wishlist (user_id, game_id) values ($1, $2)', [bob.id, game]);
    await q("insert into sessions (token, user_id, expires_at) values ('tok-bob', $1, now() + interval '1 day')", [bob.id]);
    await q('insert into user_prefs (user_id) values ($1)', [bob.id]);

    const result = await db.deleteUserAudited(q, {
      username: 'bob',
      confirmUsername: 'bob',
      operator: 'admin1',
      operatorId: 1,
      reason: '测试删除',
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.deleted, { username: 'bob', role: 'user', steamAccounts: 1, sessions: 1 });

    // users 行没了；级联把 sessions/user_prefs/user_wishlist/steam_accounts 清掉
    assert.equal((await q("select count(*)::int as n from users where username='bob'")).rows[0].n, 0);
    assert.equal((await q("select count(*)::int as n from sessions where token='tok-bob'")).rows[0].n, 0, '会话立即失效（级联）');
    assert.equal((await q('select count(*)::int as n from user_prefs where user_id = $1', [bob.id])).rows[0].n, 0);
    assert.equal((await q('select count(*)::int as n from user_wishlist where user_id = $1', [bob.id])).rows[0].n, 0);
    assert.equal((await q("select count(*)::int as n from steam_accounts where steam_id='76561198000000001'")).rows[0].n, 0);
    // 两张没有外键的表必须手动清掉，否则留孤儿行
    assert.equal((await q("select count(*)::int as n from steam_games where steam_id='76561198000000001'")).rows[0].n, 0, 'steam_games 无外键，靠事务里显式清');
    assert.equal((await q("select count(*)::int as n from steam_wishlist where steam_id='76561198000000001'")).rows[0].n, 0);

    // 审计行：脱敏邮箱 + 操作者快照 + 关联计数；不存密码/完整邮箱/Key/token
    const audit = (await q('select * from admin_user_deletions where username = $1', ['bob'])).rows[0];
    assert.ok(audit, '审计行必须落库');
    assert.equal(audit.email_masked, 'b***@example.com', '邮箱必须打码');
    assert.ok(!String(audit.email_masked).includes('bob@example.com'), '不得存完整邮箱');
    assert.equal(audit.deleted_by, 'admin1');
    assert.equal(audit.steam_accounts, 1);
    assert.equal(audit.sessions, 1);
    assert.equal(audit.reason, '测试删除');
    const cols = Object.keys(audit);
    assert.ok(!cols.includes('password_hash') && !cols.includes('token'), '审计表不含敏感列');
  } finally {
    await store.close();
  }
});

test('删除后用户名可立即重新注册；listUsers 带 sessions/steam_accounts 计数', async () => {
  const { store, q } = await fresh();
  try {
    await db.createUser(q, { username: 'admin1', password: 'password123', role: 'admin' });
    const bob = await db.createUser(q, { username: 'bob', password: 'password123' });
    await q('insert into steam_accounts (steam_id, user_id) values ($1, $2)', ['76561198000000002', bob.id]);
    await q("insert into sessions (token, user_id, expires_at) values ('t1', $1, now() + interval '1 day'), ('t2', $1, now() + interval '1 day')", [bob.id]);
    const listed = await db.listUsers(q);
    const row = listed.find((u) => u.username === 'bob');
    assert.equal(row.sessions, 2, 'listUsers 要带会话计数（删除弹窗用）');
    assert.equal(row.steam_accounts, 1);

    await db.deleteUserAudited(q, { username: 'bob', confirmUsername: 'bob', operator: 'admin1' });
    const again = await db.createUser(q, { username: 'bob', password: 'newpass123' });
    assert.ok(again, '用户名唯一约束随删行释放，可立即重新注册');
  } finally {
    await store.close();
  }
});

test('最近删除审计：按用户名模糊搜索、大小写不敏感、limit 生效', async () => {
  const { store, q } = await fresh();
  try {
    await db.createUser(q, { username: 'admin1', password: 'password123', role: 'admin' });
    for (const name of ['BobMing', 'bobli', 'Alice']) {
      await db.createUser(q, { username: name, password: 'password123' });
      await db.deleteUserAudited(q, { username: name, confirmUsername: name, operator: 'admin1' });
    }
    const all = await db.listUserDeletions(q, { limit: 50 });
    assert.equal(all.length, 3, '默认返回全部');
    assert.equal(all[0].username, 'Alice', '倒序（最近删除在前）');

    const hit = await db.listUserDeletions(q, { search: 'BOB', limit: 50 });
    assert.deepEqual(hit.map((d) => d.username).sort(), ['BobMing', 'bobli'], 'ilike 模糊 + 大小写不敏感');
    const capped = await db.listUserDeletions(q, { search: 'bob', limit: 1 });
    assert.equal(capped.length, 1, 'limit 生效');
    const none = await db.listUserDeletions(q, { search: 'ghost' });
    assert.equal(none.length, 0);
  } finally {
    await store.close();
  }
});
