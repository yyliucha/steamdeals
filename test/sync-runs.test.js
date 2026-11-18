// 手动同步任务记录：落库生命周期、中断标记、状态/记录接口权限。
import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer } from '../src/server.js';

// 测试里关掉登录验证码
process.env.CAPTCHA_ENABLED = '0';

test('同步记录：插入 → 完成 → 列表 → 重启中断标记', async () => {
  const store = await openStore('pglite:', {});
  try {
    await db.migrate(store);
    const q = (sql, p) => store.query(sql, p);

    const run = await db.insertSyncRun(q, { mode: 'steamall', args: 'src/cli.js sync steamall --limit 200' });
    assert.ok(run.id > 0, '要返回任务 id');
    const running = await db.runningSyncRun(q);
    assert.equal(running.id, run.id, '刚开始应处于运行中');

    await db.finishSyncRun(q, run.id, { status: 'ok', exitCode: 0, output: '完成：200 条元数据' });
    const list = await db.listSyncRuns(q, { limit: 10 });
    assert.equal(list.length, 1);
    assert.equal(list[0].status, 'ok');
    assert.equal(list[0].exit_code, 0);
    assert.match(list[0].output, /200 条元数据/);
    assert.ok(list[0].finished_at, '结束时间要写入');
    assert.equal(await db.runningSyncRun(q), null, '完成后不再是 running');

    // 服务重启残留：running 记录被标成失败，避免同步按钮永远禁用
    const r2 = await db.insertSyncRun(q, { mode: 'catalog' });
    assert.equal((await db.runningSyncRun(q)).id, r2.id);
    assert.equal(await db.markStaleSyncRuns(q), 1);
    const row = (await q('select status, output from sync_runs where id = $1', [r2.id])).rows[0];
    assert.equal(row.status, 'failed');
    assert.match(row.output, /服务重启/);

    // CO-1/A5：任务失败原因——最近一条 failed 记录的输出；成功记录/别的 mode 不命中
    await db.insertSyncRun(q, { mode: 'app-sync', args: 'src/cli.js app-sync' }).then((r) =>
      db.finishSyncRun(q, r.id, { status: 'failed', exitCode: 1, output: 'App Release 同步失败：network' }),
    );
    assert.equal(await db.lastFailedSyncRun(q, 'app-sync'), 'App Release 同步失败：network', '取该 mode 最近失败原因');
    assert.equal(await db.lastFailedSyncRun(q, 'steam-prices'), null, '别的 mode 不命中');
  } finally {
    await store.close();
  }
});

test('B3 实测耗时：sync_runs 成功运行平均秒，失败行与样本不足的 mode 不参与', async () => {
  const store = await openStore('pglite:', {});
  try {
    await db.migrate(store);
    const q = (sql, p) => store.query(sql, p);
    // steam-prices：两条成功（30s/90s → 平均 60s）+ 一条失败 1000s（不参与）
    for (const [sec, status] of [[30, 'ok'], [90, 'ok'], [1000, 'failed']]) {
      const r = await db.insertSyncRun(q, { mode: 'steam-prices' });
      await q("update sync_runs set started_at = now() - ($1 || ' seconds')::interval where id = $2", [String(sec), r.id]);
      await db.finishSyncRun(q, r.id, { status, exitCode: status === 'ok' ? 0 : 1 });
    }
    // heat：只有 1 条成功 → 样本不足（minRuns=2）不回传，预算回落理论值
    const h = await db.insertSyncRun(q, { mode: 'heat' });
    await q("update sync_runs set started_at = now() - interval '10 seconds' where id = $1", [h.id]);
    await db.finishSyncRun(q, h.id, { status: 'ok', exitCode: 0 });
    const map = await db.observedSyncRunSeconds(q);
    assert.equal(map.size, 1, '只有样本达标的 mode 回传');
    const sec = map.get('steam-prices');
    assert.ok(Math.abs(sec - 60) < 0.5, `平均应为 60s，实际 ${sec}`);
    assert.equal(map.get('heat'), undefined, '样本不足不回传（minRuns=2）');
  } finally {
    await store.close();
  }
});

test('回填接口：匿名 401，管理员空状态，未运行时停止返回 409', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${srv.port}`;
  try {
    assert.equal((await fetch(base + '/api/admin/backfill/status')).status, 401, '匿名不能看回填状态');
    assert.equal(
      (await fetch(base + '/api/admin/backfill', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status,
      401,
      '匿名不能启动回填',
    );

    const login = await fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123456' }),
    });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];

    const st = await (await fetch(base + '/api/admin/backfill/status', { headers: { cookie } })).json();
    assert.equal(st.running, false);
    assert.equal(st.busy, false);
    assert.equal(st.progress, null);
    assert.equal(st.last, null);

    // 没有任务在跑时，停止应明确拒绝而不是静默成功
    const stop = await fetch(base + '/api/admin/backfill/stop', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(stop.status, 409);
  } finally {
    await srv.close();
    await store.close();
  }
});

test('重写名字接口：匿名 401，管理员空状态，未运行时停止返回 409', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${srv.port}`;
  try {
    assert.equal((await fetch(base + '/api/admin/rename/status')).status, 401, '匿名不能看重写名字状态');
    assert.equal(
      (await fetch(base + '/api/admin/rename', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status,
      401,
      '匿名不能启动重写名字',
    );

    const login = await fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123456' }),
    });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];

    const st = await (await fetch(base + '/api/admin/rename/status', { headers: { cookie } })).json();
    assert.equal(st.running, false);
    assert.equal(st.busy, false);
    assert.equal(st.progress, null);
    assert.equal(st.last, null);

    const stop = await fetch(base + '/api/admin/rename/stop', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(stop.status, 409, '没有任务在跑时停止应明确拒绝');
  } finally {
    await srv.close();
    await store.close();
  }
});

test('同步状态/记录接口：匿名 401，管理员 200，未运行 running=false', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  const q = (sql, p) => store.query(sql, p);
  await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
  const srv = await startApiServer({ query: q, port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${srv.port}`;
  try {
    assert.equal((await fetch(base + '/api/admin/sync/status')).status, 401, '匿名不能看同步状态');
    assert.equal((await fetch(base + '/api/admin/sync/runs')).status, 401, '匿名不能看同步记录');

    const login = await fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123456' }),
    });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];

    const st = await (await fetch(base + '/api/admin/sync/status', { headers: { cookie } })).json();
    assert.equal(st.running, false);
    assert.equal(st.run, null);
    assert.equal(st.output, '');
    assert.equal(st.last, null);

    const runs = await (await fetch(base + '/api/admin/sync/runs?limit=5', { headers: { cookie } })).json();
    assert.deepEqual(runs.runs, []);
  } finally {
    await srv.close();
    await store.close();
  }
});
