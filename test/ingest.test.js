// E4 批（docs/LOGGING-SCHEMA.md §4/§5）：ingest 域聚合告警阈值与失败字段。
//
// 锁三件事：
//   1. 阈值纯函数（ingestAlertThresholds / ingestAlertBreaches）——env 解析、默认值、告警线边界；
//   2. 聚合告警触发——整轮 shape_mismatch → ingest.shape_threshold（error、带阈值字段）；
//      整轮入库失败 → ingest.failure_threshold；低于阈值不触发；
//   3. 失败事件字段——adapter.*.shape_mismatch 与 ingest.offer_failed 带 reason 稳定短码。
import test from 'node:test';
import assert from 'node:assert/strict';
import { ingestOffers, ingestAlertThresholds, ingestAlertBreaches, INGEST_ALERT_DEFAULTS } from '../src/ingest.js';

const steamPlatform = { code: 'steam', name: 'Steam 国区', kind: 'official' };

const offer = (over = {}) => ({
  platformCode: 'steam',
  platformProductId: 'p1',
  steamAppid: 730,
  title: '测试游戏',
  productType: 'official_direct',
  region: 'cn',
  currency: 'CNY',
  priceCents: 9900,
  originalCents: 9900,
  discountPct: 0,
  inStock: true,
  buyUrl: 'https://store.steampowered.com/app/730/',
  meta: {},
  ...over,
});

function collectLogger() {
  const events = [];
  const logger = {
    trace: (e, f) => events.push(['trace', e, f]),
    debug: (e, f) => events.push(['debug', e, f]),
    info: (e, f) => events.push(['info', e, f]),
    warn: (e, f) => events.push(['warn', e, f]),
    error: (e, f) => events.push(['error', e, f]),
    fatal: (e, f) => events.push(['fatal', e, f]),
  };
  return { logger, events };
}

test('E4 阈值解析：默认值与 env 覆盖，非法值回落默认', () => {
  assert.deepEqual(ingestAlertThresholds({}), INGEST_ALERT_DEFAULTS);
  assert.deepEqual(ingestAlertThresholds({ ALERTS_INGEST_ALERT_MIN: '8', ALERTS_INGEST_ALERT_PCT: '30' }), { min: 8, pct: 30 });
  assert.deepEqual(ingestAlertThresholds({ ALERTS_INGEST_ALERT_MIN: '0', ALERTS_INGEST_ALERT_PCT: '101' }), INGEST_ALERT_DEFAULTS, '非法值（0 条 / 101%）回落默认');
});

test('E4 告警线边界：max(min, ⌈total×pct%⌉)', () => {
  assert.equal(ingestAlertBreaches({ total: 10, shapeMismatch: 4 }).shape, false, '4/10 < 50% 不告警');
  assert.equal(ingestAlertBreaches({ total: 10, shapeMismatch: 5 }).shape, true, '5/10 = 50% 告警');
  assert.equal(ingestAlertBreaches({ total: 4, failed: 4 }).failed, false, 'min=5：4 条全失败也不告警');
  assert.equal(ingestAlertBreaches({ total: 6, failed: 6 }).failed, true, '6 条全失败 ≥ max(5, 3) 告警');
  assert.equal(ingestAlertBreaches({ total: 100, failed: 30 }, { min: 5, pct: 30 }).failed, true, '100 条失败 30 条 = 30% 告警');
  assert.equal(ingestAlertBreaches({ total: 100, failed: 29 }, { min: 5, pct: 30 }).failed, false, '29/100 < 30% 不告警');
});

test('E4 聚合告警：整轮字段缺失 → ingest.shape_threshold，且 shape_mismatch 带 reason', async () => {
  const { logger, events } = collectLogger();
  // priceCents 缺失 → 全部 shape_mismatch，不会触库
  const offers = Array.from({ length: 6 }, (_, i) => ({
    platformCode: 'steam', platformProductId: `p${i}`, title: `t${i}`, region: 'cn', priceCents: undefined,
  }));
  const store = { query: () => { throw new Error('不应触库'); } };
  const stats = await ingestOffers(store, { platform: steamPlatform, offers, logger });

  assert.equal(stats.shapeMismatch, 6);
  assert.equal(stats.failed, 0);
  const alert = events.find(([, e]) => e === 'ingest.shape_threshold');
  assert.ok(alert, '6/6 缺失 ≥ max(5, ⌈6×50%⌉) 应记聚合告警');
  assert.equal(alert[0], 'error', '聚合告警是 error 级（单独落 error-*.jsonl）');
  assert.equal(alert[2].total, 6);
  assert.equal(alert[2].shapeMismatch, 6);
  assert.equal(alert[2].thresholdMin, 5, '告警日志自带阈值自描述字段');
  assert.equal(alert[2].thresholdPct, 50);
  const mismatches = events.filter(([, e]) => e === 'adapter.steam.shape_mismatch');
  assert.equal(mismatches.length, 6);
  assert.ok(mismatches.every(([, , f]) => f.reason === 'shape_priceCents'), 'shape_mismatch 带 reason 稳定短码');
});

test('E4 聚合告警：整轮入库失败 → ingest.failure_threshold，offer_failed 带 reason/status', async () => {
  const { logger, events } = collectLogger();
  const store = { query: () => { throw Object.assign(new Error('连接挂掉'), { code: '57P01' }); } };
  const offers = Array.from({ length: 6 }, (_, i) => offer({ platformProductId: `p${i}` }));
  const stats = await ingestOffers(store, { platform: steamPlatform, offers, logger });

  assert.equal(stats.failed, 6);
  const alert = events.find(([, e]) => e === 'ingest.failure_threshold');
  assert.ok(alert, '6/6 入库失败应记聚合告警');
  assert.equal(alert[0], 'error');
  assert.equal(alert[2].failed, 6);
  assert.equal(alert[2].thresholdMin, 5);
  assert.equal(alert[2].thresholdPct, 50);
  const failed = events.filter(([, e]) => e === 'ingest.offer_failed');
  assert.equal(failed.length, 6);
  assert.ok(failed.every(([, , f]) => f.reason === '57P01' && f.status === null), 'offer_failed 带 reason（错误 code）与 status 字段');
  assert.ok(failed.every(([, , f]) => f.err?.code === '57P01'), 'offer_failed 同时保留 serializeError 产物');
});

test('E4 聚合告警：低于阈值不触发（提高阈值后 6 条全缺也不告警）', async () => {
  const { logger, events } = collectLogger();
  const offers = Array.from({ length: 6 }, (_, i) => ({
    platformCode: 'steam', platformProductId: `p${i}`, title: `t${i}`, region: 'cn', priceCents: undefined,
  }));
  const stats = await ingestOffers(
    { query: () => { throw new Error('不应触库'); } },
    { platform: steamPlatform, offers, logger, thresholds: { min: 100, pct: 100 } },
  );
  assert.equal(stats.shapeMismatch, 6);
  assert.ok(!events.some(([, e]) => e === 'ingest.shape_threshold'), '阈值 min=100 时 6 条缺失不触发');
});
