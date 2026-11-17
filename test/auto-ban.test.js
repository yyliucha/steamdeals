// CF 批（docs/ADMIN-UX-SECURITY.md §3）：auto-ban 硬规则引擎——strict 模式下
// 四类硬规则（漏洞路径/凭据爆破/极端频率/异常 UA）→ 自动临时封（阶梯 10min/1h/1d 封顶，
// 跨天重置，永不自动永久）；mode=off 全部只 429 + 审核；白名单豁免。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as autoBan from '../src/auto-ban.js';

const fakeQ = () => {
  const rows = [];
  const q = async (sql, params) => {
    rows.push({ sql, params });
    // 阶梯查询：第 1 次无行（strikes=1）；可注入已有 strikes
    if (/select strikes, strike_day from ip_abuse/.test(sql)) {
      return { rows: q.strikesToday ? [{ strikes: q.strikesToday, strike_day: '2026-11-17' }] : [] };
    }
    return { rows: [], rowCount: 1 };
  };
  q.rows = rows;
  q.strikesToday = null;
  return q;
};

test('CF auto-ban：默认配置与模式门', () => {
  autoBan.resetState();
  const c = autoBan.currentConfig();
  assert.equal(c.mode, 'strict');
  assert.equal(c.pathDistinctMax, 3);
  assert.equal(c.credentialIpMax, 50);
  assert.equal(c.extremeMultiplier, 5);
  assert.equal(c.extremeWindows, 2);
  assert.deepEqual(c.banLadderMin, [10, 60, 1440]);
  assert.ok(autoBan.isBadUa('sqlmap/1.0 (https://sqlmap.org)'), '名单命中');
  assert.ok(!autoBan.isBadUa('Mozilla/5.0 (Windows NT 10.0)'), '正常 UA 不命中');
});

test('CF auto-ban：凭据爆破——满 50 次触发一次，窗口内不清零', () => {
  autoBan.resetState();
  autoBan.configure({ mode: 'strict', credentialIpMax: 3 });
  const now = Date.now();
  assert.equal(autoBan.recordCredentialFail('203.0.113.9', now), null);
  assert.equal(autoBan.recordCredentialFail('203.0.113.9', now + 1000), null);
  const t = autoBan.recordCredentialFail('203.0.113.9', now + 2000);
  assert.equal(t?.rule, 'credential');
  assert.equal(autoBan.recordCredentialFail('203.0.113.9', now + 3000), null, '触发即清，重新计数');
});

test('CF auto-ban：漏洞路径——3 个不同签名才触发；同一规则多条路径只算 1 个', () => {
  autoBan.resetState();
  autoBan.configure({ mode: 'strict', pathDistinctMax: 3, pathWindowSec: 600 });
  const now = Date.now();
  assert.equal(autoBan.recordPathSignature('203.0.113.9', 'secret-file', '/.env', now), null);
  assert.equal(autoBan.recordPathSignature('203.0.113.9', 'secret-file', '/.env.production', now + 1000), null, '同规则多路径只算 1');
  assert.equal(autoBan.recordPathSignature('203.0.113.9', 'cms-probe', '/phpmyadmin/', now + 2000), null);
  const t = autoBan.recordPathSignature('203.0.113.9', 'path-traversal', '/a/../b', now + 3000);
  assert.equal(t?.rule, 'path-probe');
});

test('CF auto-ban：异常 UA——10 分钟 ≥2 次触发', () => {
  autoBan.resetState();
  autoBan.configure({ mode: 'strict' });
  const now = Date.now();
  assert.equal(autoBan.recordUaHit('203.0.113.9', now), null);
  const t = autoBan.recordUaHit('203.0.113.9', now + 1000);
  assert.equal(t?.rule, 'ua-list');
});

test('CF auto-ban：极端频率——连续 2 个窗口才触发；同一窗口不重复计', () => {
  autoBan.resetState();
  autoBan.configure({ mode: 'strict', extremeWindows: 2 });
  const w1 = Date.UTC(2026, 10, 17, 2, 0, 0);
  assert.equal(autoBan.recordRateOver('203.0.113.9', 'api', 800, w1), null);
  assert.equal(autoBan.recordRateOver('203.0.113.9', 'api', 900, w1 + 1000), null, '同一窗口不叠加');
  const t = autoBan.recordRateOver('203.0.113.9', 'api', 800, w1 + 61_000);
  assert.equal(t?.rule, 'extreme-rate');
  assert.equal(t?.windows, 2);
});

test('CF auto-ban：阶梯封禁——同一天 10min → 1h → 1d 封顶；写 ip_abuse + abuse_reviews', async () => {
  autoBan.resetState();
  autoBan.configure({ mode: 'strict', banLadderMin: [10, 60, 1440] });
  const q = fakeQ();
  const now = Date.UTC(2026, 10, 17, 2, 0, 0);
  const first = await autoBan.applyAutoBan(q, '203.0.113.9', { rule: 'credential' }, now);
  assert.equal(first.minutes, 10, '第 1 次 10 分钟');
  assert.equal(first.strikes, 1);
  q.strikesToday = 1;
  const second = await autoBan.applyAutoBan(q, '203.0.113.9', { rule: 'path-probe' }, now + 1000);
  assert.equal(second.minutes, 60, '第 2 次 1 小时');
  q.strikesToday = 2;
  const third = await autoBan.applyAutoBan(q, '203.0.113.9', { rule: 'ua-list' }, now + 2000);
  assert.equal(third.minutes, 1440, '第 3 次 1 天');
  q.strikesToday = 5;
  const fourth = await autoBan.applyAutoBan(q, '203.0.113.9', { rule: 'extreme-rate' }, now + 3000);
  assert.equal(fourth.minutes, 1440, '第 4 次仍 1 天封顶，永不自动永久');
  const banInsert = q.rows.find((r) => /insert into ip_abuse/.test(r.sql));
  assert.ok(['auto:credential', 'auto:path-probe', 'auto:ua-list', 'auto:extreme-rate'].includes(banInsert.params[3]), 'ban_source=auto:<rule>');
  const reviewInsert = q.rows.find((r) => /insert into abuse_reviews/.test(r.sql));
  assert.ok(reviewInsert, '每次自动封禁必须写一条审核记录');
});

test('CF auto-ban：mode=off 只记录不封；白名单豁免', async () => {
  autoBan.resetState();
  autoBan.configure({ mode: 'off', credentialIpMax: 2 });
  assert.equal(autoBan.recordCredentialFail('203.0.113.9'), null, 'off 模式记录器不触发');
  const q = fakeQ();
  assert.equal(await autoBan.applyAutoBan(q, '203.0.113.9', { rule: 'credential' }), null, 'off 模式不封');
  autoBan.configure({ mode: 'strict', credentialIpMax: 2 });
  autoBan.addWhitelist('203.0.113.9');
  assert.equal(autoBan.recordCredentialFail('203.0.113.9'), null, '白名单不触发');
  autoBan.resetState();
});
