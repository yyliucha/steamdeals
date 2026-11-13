// 频率限制三振规则（用假 q 验证，不连库）。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as ratelimit from '../src/ratelimit.js';

function fakeQ() {
  const abuse = new Map();
  const blacklist = new Set();
  const whitelist = new Set();
  const stats = { inserts: 0 };
  const q = async (sql, params) => {
    if (/insert into ip_abuse/.test(sql)) {
      stats.inserts += 1;
      const ip = params[0];
      const next = (abuse.get(ip) ?? 0) + 1;
      abuse.set(ip, next);
      return { rows: [{ strikes: next }], rowCount: 1 };
    }
    if (/update ip_abuse set banned_until/.test(sql)) return { rows: [], rowCount: 1 };
    if (/insert into ip_blacklist/.test(sql)) {
      blacklist.add(params[0]);
      return { rows: [], rowCount: 1 };
    }
    if (/delete from ip_abuse/.test(sql)) return { rows: [], rowCount: abuse.delete(params[0]) ? 1 : 0 };
    if (/delete from ip_blacklist/.test(sql)) return { rows: [], rowCount: blacklist.delete(params[0]) ? 1 : 0 };
    if (/select ip from ip_whitelist/.test(sql)) return { rows: [...whitelist].map((ip) => ({ ip })) };
    if (/select ip, banned_until/.test(sql)) return { rows: [] };
    return { rows: [], rowCount: 0 };
  };
  return { q, abuse, blacklist, whitelist, stats };
}

test('超频：第 1 次封 10 分钟、第 2 次 30 分钟、第 3 次封到当天结束（次日 0 点恢复），不写永久黑名单', async () => {
  ratelimit.resetState();
  ratelimit.configure({ enabled: true, apiMax: 5, windowSec: 60, blockedEscalate: 5 });
  const { q, blacklist, stats } = fakeQ();
  const ip = '203.0.113.9';

  for (let i = 0; i < 5; i += 1) {
    const v = await ratelimit.hit(q, ip, { bucket: 'api' });
    assert.equal(v.limited, false, `第 ${i + 1} 次不应限流`);
  }
  const first = await ratelimit.hit(q, ip, { bucket: 'api' });
  assert.equal(first.limited, true);
  assert.equal(first.strikes, 1);
  assert.equal(first.permanent, false);
  assert.equal(first.needsReview, true, '第一次超限就要交管理员审核');
  const mins1 = Math.round((first.until - Date.now()) / 60000);
  assert.ok(mins1 >= 9 && mins1 <= 10, '第一次应封约 10 分钟，实际 ' + mins1);

  // 封禁期内继续请求 5 次 → 升级到第 2 档（30 分钟）；BR 批：升级只累计 API 请求
  let second = null;
  for (let i = 0; i < 5; i += 1) second = await ratelimit.hit(q, ip, { bucket: 'api' });
  assert.equal(second.strikes, 2);
  const mins2 = Math.round((second.until - Date.now()) / 60000);
  assert.ok(mins2 >= 29 && mins2 <= 30, '第二次应封约 30 分钟，实际 ' + mins2);

  // 再继续 5 次 → 第 3 档：封到当天结束（次日 0 点）
  let third = null;
  for (let i = 0; i < 5; i += 1) third = await ratelimit.hit(q, ip, { bucket: 'api' });
  assert.equal(third.strikes, 3);
  assert.equal(third.permanent, false, '永不自动永久');
  assert.equal(third.needsReview, true);
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  assert.ok(Math.abs(third.until - midnight.getTime()) <= 5000, '第三次应封到次日 0 点，实际 ' + new Date(third.until).toISOString());
  assert.match(third.reason, /明天 0 点/);
  assert.equal(blacklist.has(ip), false, '自动流程不能写永久黑名单');

  // 已经封到当天结束：当天最多就这 3 次，继续请求不再升级、不再累加
  const insertsAfterThird = stats.inserts;
  for (let i = 0; i < 5; i += 1) {
    const v = await ratelimit.hit(q, ip, { bucket: 'api' });
    assert.equal(v.limited, true);
    assert.equal(Boolean(v.escalated), false, '当天封禁后不再升级');
  }
  assert.equal(stats.inserts, insertsAfterThird, '每天封顶 3 次，之后不再累计');
});

test('nextMidnight：返回本地时区次日 0 点', () => {
  const now = new Date(2026, 9, 29, 23, 59, 30).getTime();
  const next = new Date(ratelimit.nextMidnight(now));
  assert.equal(next.getFullYear(), 2026);
  assert.equal(next.getMonth(), 9);
  assert.equal(next.getDate(), 30);
  assert.equal(next.getHours(), 0);
});

test('白名单不计数、不限流', async () => {
  ratelimit.resetState();
  ratelimit.configure({ enabled: true, pageMax: 2, windowSec: 60 });
  const { q } = fakeQ();
  ratelimit.addWhitelist('198.51.100.7');
  for (let i = 0; i < 10; i += 1) {
    const v = await ratelimit.hit(q, '198.51.100.7');
    assert.equal(v.limited, false);
  }
  assert.equal(ratelimit.isWhitelisted('198.51.100.7'), true);
  ratelimit.removeWhitelist('198.51.100.7');
  assert.equal(ratelimit.isWhitelisted('198.51.100.7'), false);
});

test('手动解封清掉临时封禁（不再产生永久黑名单）', async () => {
  ratelimit.resetState();
  ratelimit.configure({ enabled: true, pageMax: 1, windowSec: 60, blockedEscalate: 2 });
  const { q, blacklist } = fakeQ();
  const ip = '203.0.113.55';
  for (let round = 0; round < 3; round += 1) {
    await ratelimit.hit(q, ip);
    await ratelimit.hit(q, ip); // 第 2 次即超限
  }
  assert.equal(blacklist.has(ip), false, '自动流程不写永久黑名单');
  assert.ok(ratelimit.bannedUntil(ip), '应处于临时封禁中');
  await ratelimit.clearAbuse(q, ip);
  assert.equal(ratelimit.bannedUntil(ip), null);
});

test('BJ：clearAbuse 只清 ip_abuse，不再删 ip_blacklist（解封语义拆分）', async () => {
  ratelimit.resetState();
  const { q, abuse, blacklist } = fakeQ();
  // 模拟「该 IP 同时在自动封禁与黑名单里」：黑名单行先存在，abuse 行由 fakeQ 的 insert 分支记
  blacklist.add('203.0.113.88');
  abuse.set('203.0.113.88', 2);
  ratelimit.applyExternalBan('203.0.113.88', Date.now() + 600_000);
  const removed = await ratelimit.clearAbuse(q, '203.0.113.88');
  assert.equal(removed, true);
  assert.equal(blacklist.has('203.0.113.88'), true, '黑名单行必须保留');
  assert.equal(ratelimit.bannedUntil('203.0.113.88'), null, '内存临时封禁已清');
});

test('BJ：clearBanMemory 只清封禁内存，不碰窗口计数与黑名单', async () => {
  ratelimit.resetState();
  ratelimit.configure({ enabled: true, pageMax: 60, windowSec: 60 });
  const { q, blacklist } = fakeQ();
  blacklist.add('203.0.113.99');
  ratelimit.applyExternalBan('203.0.113.99', Date.now() + 600_000);
  await ratelimit.hit(q, '203.0.113.99'); // 封禁期内计数（不会真写库）
  ratelimit.clearBanMemory('203.0.113.99');
  assert.equal(ratelimit.bannedUntil('203.0.113.99'), null, '内存封禁已清');
  assert.equal(blacklist.has('203.0.113.99'), true, '黑名单不在此函数职责内');
});

test('禁用后完全不限流', async () => {
  ratelimit.resetState();
  ratelimit.configure({ enabled: false, pageMax: 1, windowSec: 60 });
  const { q } = fakeQ();
  for (let i = 0; i < 20; i += 1) {
    const v = await ratelimit.hit(q, '203.0.113.1');
    assert.equal(v.limited, false);
  }
});

test('BR：页面 / API / 静态资源三个桶独立计数', async () => {
  ratelimit.resetState();
  ratelimit.configure({ enabled: true, pageMax: 2, apiMax: 3, assetMax: 4, windowSec: 60 });
  const { q } = fakeQ();
  const ip = '203.0.113.200';
  // 页面桶打满 2 次仍不断（第 3 次才断）；期间 API 桶与资源桶独立
  for (let i = 0; i < 2; i += 1) assert.equal((await ratelimit.hit(q, ip, { bucket: 'page' })).limited, false);
  for (let i = 0; i < 3; i += 1) assert.equal((await ratelimit.hit(q, ip, { bucket: 'api' })).limited, false);
  for (let i = 0; i < 4; i += 1) assert.equal((await ratelimit.hit(q, ip, { bucket: 'asset' })).limited, false);
  // 页面第 3 次超限 → 封禁（资源/API 没打满，证明三个桶互不影响）
  const over = await ratelimit.hit(q, ip, { bucket: 'page' });
  assert.equal(over.limited, true);
  assert.equal(over.strikes, 1);
  assert.match(over.reason, /页面/);
});

test('BR：封禁期内只有 API 请求累计升级，页面/资源刷不升级', async () => {
  ratelimit.resetState();
  ratelimit.configure({ enabled: true, pageMax: 5, apiMax: 1, assetMax: 100, windowSec: 60, blockedEscalate: 2 });
  const { q, stats } = fakeQ();
  const ip = '203.0.113.201';
  // API 桶第 2 次超限 → 第 1 档封禁
  assert.equal((await ratelimit.hit(q, ip, { bucket: 'api' })).limited, false);
  const ban = await ratelimit.hit(q, ip, { bucket: 'api' });
  assert.equal(ban.limited, true);
  assert.equal(ban.strikes, 1);
  assert.ok(ratelimit.bannedUntil(ip), '应处于临时封禁中');

  // 封禁期内狂刷页面与静态资源：都返回封禁中，但绝不升级、不写库
  const insertsBefore = stats.inserts;
  for (let i = 0; i < 10; i += 1) {
    const p = await ratelimit.hit(q, ip, { bucket: 'page' });
    assert.equal(p.limited, true);
    assert.equal(Boolean(p.escalated), false, '页面 GET 在封禁期内不得升级');
    const a = await ratelimit.hit(q, ip, { bucket: 'asset' });
    assert.equal(a.limited, true);
    assert.equal(Boolean(a.escalated), false, '静态资源在封禁期内不得升级');
  }
  assert.equal(stats.inserts, insertsBefore, '页面/资源刷屏不得触发新三振写入');

  // 封禁期内 API 继续 2 次 → 升级到第 2 档（脚本防护仍在）
  let escalated = null;
  for (let i = 0; i < 2; i += 1) escalated = await ratelimit.hit(q, ip, { bucket: 'api' });
  assert.equal(escalated.limited, true);
  assert.equal(escalated.escalated, true);
  assert.equal(escalated.strikes, 2, 'API 请求仍按 blockedEscalate 升档');
});

test('BR：configureFromEnv 读取 RATE_LIMIT_PAGE_MAX / RATE_LIMIT_API_MAX', () => {
  ratelimit.resetState();
  ratelimit.configureFromEnv({ RATE_LIMIT_ENABLED: '1', RATE_LIMIT_PAGE_MAX: '7', RATE_LIMIT_API_MAX: '9' });
  const cfg = ratelimit.currentConfig();
  assert.equal(cfg.pageMax, 7);
  assert.equal(cfg.apiMax, 9);
  assert.equal(cfg.assetMax, 300, '未设置时取默认');
  ratelimit.resetState();
});
