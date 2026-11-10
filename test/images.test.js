// 封面图本地缓存：路径安全、读写、统计、下载落盘、/img 路由优先读本地文件。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { startApiServer } from '../src/server.js';
import * as images from '../src/images.js';

function withTmpDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'steamdeals-img-'));
  const old = process.env.IMG_DIR;
  process.env.IMG_DIR = dir;
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      if (old === undefined) delete process.env.IMG_DIR;
      else process.env.IMG_DIR = old;
      rmSync(dir, { recursive: true, force: true });
    });
}

test('路径安全：appid 只保留数字、size 必须白名单', async () => {
  await withTmpDir((dir) => {
    assert.equal(images.imageFile('413150', 'capsule_sm_120'), join(dir, '413150', 'capsule_sm_120.jpg'));
    assert.equal(images.imageFile('413150/../../etc', 'header'), join(dir, '413150', 'header.jpg'), '非法字符被剔掉');
    assert.equal(images.imageFile('413150', '../secret'), null, 'size 不在白名单返回 null');
    assert.equal(images.imageFile('abc', 'header'), null, '没有数字的 appid 返回 null');
    assert.equal(images.imageFile('413150', 'header', { IMG_DIR: '/tmp/x' }), resolve('/tmp/x', '413150', 'header.jpg'), '可注入 env');
  });
});

test('读写与统计：saveImage 原子写、readImage 读回、imageStats 计数', async () => {
  await withTmpDir(async () => {
    const body = Buffer.from('fake-jpeg-bytes');
    const file = images.saveImage(413150, 'capsule_sm_120', body);
    assert.ok(file && existsSync(file));
    assert.deepEqual(images.readImage(413150, 'capsule_sm_120'), body);
    assert.equal(images.hasImage(413150, 'capsule_sm_120'), true);
    assert.equal(images.hasImage(413150, 'header'), false);
    assert.equal(images.readImage(999, 'header'), null);

    images.saveImage(413150, 'header', Buffer.from('h'.repeat(100)));
    images.saveImage(730, 'capsule_sm_120', Buffer.from('x'));
    const s = images.imageStats();
    assert.equal(s.images, 3);
    assert.equal(s.games, 2);
    assert.ok(s.bytes > 100);
  });
});

test('downloadImage：注入 fetchBuffer 成功即落盘，全失败返回 ok:false', async () => {
  await withTmpDir(async () => {
    const okFetch = async () => ({ body: Buffer.from('downloaded'), bytes: 10, contentType: 'image/jpeg' });
    const r = await images.downloadImage(413150, 'capsule_sm_120', { fetchBuffer: okFetch });
    assert.equal(r.ok, true);
    assert.equal(r.bytes, 10);
    assert.deepEqual(readFileSync(r.file), Buffer.from('downloaded'));

    const failFetch = async () => {
      throw new Error('cdn down');
    };
    const bad = await images.downloadImage(413150, 'header', { fetchBuffer: failFetch });
    assert.equal(bad.ok, false);
    assert.match(String(bad.error?.message), /cdn down/);
    assert.equal(images.hasImage(413150, 'header'), false, '失败不落盘');
  });
});

test('D2：pruneImages 超上限按最旧删除到合规；上限内不动；0=不限', async () => {
  await withTmpDir(async () => {
    images.saveImage(1001, 'header', Buffer.from('a'.repeat(400)));
    images.saveImage(1002, 'header', Buffer.from('b'.repeat(300)));
    // 显式拉开 mtime，保证「最旧先删」可判定
    const { utimesSync } = await import('node:fs');
    utimesSync(images.imageFile(1001, 'header'), new Date(2020, 0, 1), new Date(2020, 0, 1));
    utimesSync(images.imageFile(1002, 'header'), new Date(2022, 0, 1), new Date(2022, 0, 1));
    const before = images.imageStats();
    assert.equal(before.bytes, 700);
    assert.equal(before.images, 2);

    // 上限内：不动
    let r = images.pruneImages({ maxBytes: 700 });
    assert.equal(r.removed, 0);
    assert.equal(r.remainingBytes, 700);

    // 上限 500：最旧的 1001（400B）被删，剩 1002（300B）
    r = images.pruneImages({ maxBytes: 500 });
    assert.equal(r.removed, 1);
    assert.equal(r.freedBytes, 400);
    assert.equal(r.remainingBytes, 300);
    assert.equal(images.hasImage(1001, 'header'), false, '最旧文件先删');
    assert.equal(images.hasImage(1002, 'header'), true, '较新文件保留');

    // 0 = 不限
    r = images.pruneImages({ maxBytes: 0 });
    assert.equal(r.removed, 0);
    assert.equal(images.hasImage(1002, 'header'), true);
  });
});

test('/img 路由：本地已有文件时直接发，不依赖网络；全失败返回 404', async () => {
  await withTmpDir(async () => {
    const store = await openStore('pglite:', {});
    await db.migrate(store);
    const q = (sql, p) => store.query(sql, p);
    const body = Buffer.from('\xff\xd8\xff\xe0fake-jpeg');
    images.saveImage(413150, 'capsule_sm_120', body);

    // imageFetch 直接抛错：证明命中磁盘后不会再走网络
    const srv = await startApiServer({
      query: q,
      port: 0,
      host: '127.0.0.1',
      imageFetch: async () => {
        throw new Error('should not be called');
      },
    });
    const base = `http://127.0.0.1:${srv.port}`;
    try {
      const hit = await fetch(`${base}/img/steam/413150/capsule_sm_120`);
      assert.equal(hit.status, 200);
      assert.equal(hit.headers.get('content-type'), 'image/jpeg');
      assert.deepEqual(Buffer.from(await hit.arrayBuffer()), body);

      const miss = await fetch(`${base}/img/steam/999999/header`);
      assert.equal(miss.status, 404, '本地没有且网络失败 → 404');

      const badSize = await fetch(`${base}/img/steam/413150/../etc`);
      assert.ok(badSize.status === 404 || badSize.status === 403, '非法 size 不放行');
    } finally {
      await srv.close();
      await store.close();
    }
  });
});

// ---------------------------------------------------------------- AW 批（docs/IMAGE-FETCH.md §5 验收）

test('AW 验收 1/2/3：404 快失败只调 1 次；超时换候选 3 次兜底；总预算拦住 24s 累加', async () => {
  await withTmpDir(async () => {
    // 1) 恒 404 → 只调用 1 次并返回 notFound
    let calls = [];
    const always404 = async (url) => {
      calls.push(url);
      const e = new Error('HTTP 404');
      e.status = 404;
      throw e;
    };
    const r404 = await images.downloadImage(413150, 'header', { fetchBuffer: always404 });
    assert.equal(calls.length, 1, '404 立即失败，不再试其余 2 个候选（现状是 3 次）');
    assert.equal(r404.ok, false);
    assert.equal(r404.notFound, true);
    assert.equal(r404.status, 404);

    // 2) 前两次超时、第三次成功 → 3 次调用仍能兜底
    calls = [];
    let n = 0;
    const twoTimeout = async (url) => {
      calls.push(url);
      n += 1;
      if (n < 3) throw new Error('timeout');
      return { body: Buffer.from('saved'), bytes: 5, contentType: 'image/jpeg' };
    };
    const ok = await images.downloadImage(413150, 'capsule_sm_120', { fetchBuffer: twoTimeout });
    assert.equal(ok.ok, true);
    assert.equal(calls.length, 3, '超时/网络错误照旧换候选，不回归兜底能力');
    assert.equal(images.hasImage(413150, 'capsule_sm_120'), true, '第三次成功照常落盘');

    // 3) 总预算：单次超时 40ms、总预算 90ms，慢候选（50ms）最多跑 2 个，总耗时 ≤ 预算 + 单次超时
    calls = [];
    const slow = async (url) => {
      calls.push(url);
      await new Promise((r) => setTimeout(r, 50));
      throw new Error('timeout');
    };
    const started = Date.now();
    const budget = await images.downloadImage(413150, 'capsule_616x353', { fetchBuffer: slow, timeoutMs: 40, totalBudgetMs: 90 });
    const elapsed = Date.now() - started;
    assert.equal(budget.ok, false);
    assert.equal(budget.timeout, true);
    assert.ok(calls.length < 3, `总预算应拦住第 3 个候选（实际 ${calls.length} 次）`);
    assert.ok(elapsed <= 90 + 40 + 30, `总耗时 ${elapsed}ms 应在 预算+单次超时 内（不再累加到 24s）`);
  });
});

test('AW 验收 4：负缓存分层——404 缓存 24h 不再触发网络；网络错误 10min 后可重试（TTL 可注入）', async () => {
  await withTmpDir(async () => {
    const store = await openStore('pglite:', {});
    await db.migrate(store);
    const q = (sql, p) => store.query(sql, p);
    let calls = 0;
    const srv = await startApiServer({
      query: q,
      port: 0,
      host: '127.0.0.1',
      imageFetch: async () => {
        calls += 1;
        throw new Error('cdn down'); // 无 status = 网络类错误
      },
      imgMissTtl: { notfound: 60_000, error: 120 }, // 注入小 TTL 避免等 10 分钟
    });
    const base = `http://127.0.0.1:${srv.port}`;
    try {
      assert.equal((await fetch(`${base}/img/steam/999999/header`)).status, 404);
      assert.equal(calls, 3, '第一次走网络：3 个候选都试（网络错误照旧换候选）');
      assert.equal((await fetch(`${base}/img/steam/999999/header`)).status, 404);
      assert.equal(calls, 3, '负缓存期内不再触发 fetch');
      await new Promise((r) => setTimeout(r, 180)); // 超过 error TTL 120ms
      assert.equal((await fetch(`${base}/img/steam/999999/header`)).status, 404);
      assert.equal(calls, 6, '网络错误过期后可重试（3 个候选各再试一次）');
    } finally {
      await srv.close();
      await store.close();
    }
  });
});

test('AW 验收 4b：404 负缓存 24h——第二次请求不再触发网络（快失败也只调 1 次）', async () => {
  await withTmpDir(async () => {
    const store = await openStore('pglite:', {});
    await db.migrate(store);
    const q = (sql, p) => store.query(sql, p);
    let calls = 0;
    const srv = await startApiServer({
      query: q,
      port: 0,
      host: '127.0.0.1',
      imageFetch: async () => {
        calls += 1;
        const e = new Error('HTTP 404');
        e.status = 404;
        throw e;
      },
      imgMissTtl: { notfound: 60_000, error: 60_000 },
    });
    const base = `http://127.0.0.1:${srv.port}`;
    try {
      assert.equal((await fetch(`${base}/img/steam/888888/header`)).status, 404);
      assert.equal(calls, 1, '404 快失败：只调 1 次');
      assert.equal((await fetch(`${base}/img/steam/888888/header`)).status, 404);
      assert.equal(calls, 1, '24h 负缓存期内不再触发网络');
    } finally {
      await srv.close();
      await store.close();
    }
  });
});

test('AW 验收 5：header_image 优先直链；非白名单域名被拒绝回退老路径；404 回退老路径', async () => {
  await withTmpDir(async () => {
    const store = await openStore('pglite:', {});
    await db.migrate(store);
    const q = (sql, p) => store.query(sql, p);
    const seedGame = (appid, headerImage) =>
      q('insert into games (steam_appid, name, header_image) values ($1, $2, $3)', [appid, '测试' + appid, headerImage]);
    await seedGame(4266020, 'https://cdn.cloudflare.steamstatic.com/steam/apps/4266020/header.jpg?t=1');
    await seedGame(4266021, 'https://evil.example.com/steal.jpg'); // 非白名单
    await seedGame(4266022, 'http://cdn.cloudflare.steamstatic.com/x.jpg'); // 非 https
    await seedGame(4266023, 'https://cdn.cloudflare.steamstatic.com/dead.jpg'); // 白名单但 404

    const fetchLog = [];
    const srv = await startApiServer({
      query: q,
      port: 0,
      host: '127.0.0.1',
      imageFetch: async (url) => {
        fetchLog.push(url);
        if (url.includes('/dead.jpg')) {
          const e = new Error('HTTP 404');
          e.status = 404;
          throw e;
        }
        return { body: Buffer.from('img-' + url.slice(-10)), bytes: 10, contentType: 'image/jpeg' };
      },
    });
    const base = `http://127.0.0.1:${srv.port}`;
    try {
      // 白名单 header_image：第一个请求就是它
      const ok = await fetch(`${base}/img/steam/4266020/header`);
      assert.equal(ok.status, 200);
      assert.ok(fetchLog[0].startsWith('https://cdn.cloudflare.steamstatic.com/steam/apps/4266020/header.jpg'), '第一个请求是 header_image 直链');

      // 非白名单域名：不采用，直接回退老路径（第一个请求是老路径 cloudflare）
      const before = fetchLog.length;
      const evil = await fetch(`${base}/img/steam/4266021/header`);
      assert.equal(evil.status, 200);
      assert.ok(fetchLog[before].startsWith('https://cdn.cloudflare.steamstatic.com/steam/apps/4266021/header.jpg'), '非白名单域名被拒绝，回退老路径');
      assert.ok(!fetchLog.some((u) => u.includes('evil.example.com')), '白名单外的 URL 从未被请求');

      // http 协议同样被拒绝
      const before2 = fetchLog.length;
      await fetch(`${base}/img/steam/4266022/header`);
      assert.ok(fetchLog[before2].startsWith('https://cdn.cloudflare.steamstatic.com/steam/apps/4266022/'), '非 https 被拒绝');
      assert.ok(!fetchLog.some((u) => u.startsWith('http://')), 'http 直链从未被请求');

      // 白名单但 404：回退老路径（2 次调用：直链 + 老路径），老路径成功后正常 200
      const before3 = fetchLog.length;
      const dead = await fetch(`${base}/img/steam/4266023/header`);
      assert.equal(dead.status, 200, '直链 404 回退老路径后成功');
      assert.equal(fetchLog.length - before3, 2, '直链 404 → 老路径再试一次（共 2 次调用）');
      assert.ok(fetchLog[before3].includes('/dead.jpg'));
      assert.ok(fetchLog[before3 + 1].startsWith('https://cdn.cloudflare.steamstatic.com/steam/apps/4266023/header.jpg'));

      // 非 header 尺寸不查 header_image（胶囊走老路径）
      const before4 = fetchLog.length;
      await fetch(`${base}/img/steam/4266020/capsule_sm_120`);
      assert.ok(fetchLog[before4].startsWith('https://cdn.cloudflare.steamstatic.com/steam/apps/4266020/capsule_sm_120.jpg'), '非 header 尺寸不使用直链');
    } finally {
      await srv.close();
      await store.close();
    }
  });
});

test('AW 验收 6/7：前端不再用 favicon 兜底且有占位元素；cli pull 统计 notFound', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const home = readFileSync(fileURLToPath(new URL('../frontend/src/pages/Home.vue', import.meta.url)), 'utf8');
  assert.ok(!home.includes("'/favicon.svg'"), '前端不再出现 favicon 作为图片兜底');
  assert.match(home, /cover-placeholder/, '存在占位元素类名');
  assert.match(home, /markCoverFailed/, '失败回调挂 class 隐藏 img、显示占位块');
  assert.match(home, /img-failed/, '失败状态类存在');
  assert.match(home, /firstChar/, '占位块显示游戏名首字');
  const cli = readFileSync(fileURLToPath(new URL('../src/cli.js', import.meta.url)), 'utf8');
  assert.match(cli, /notFound/, 'images pull 统计包含 notFound');
  assert.match(cli, /404 缺图/, '命令行摘要包含 404 缺图计数');
});
