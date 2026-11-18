// E4 批（docs/LOGGING-SCHEMA.md §2/§5）：试点域日志 schema 静态锁。
//
// 三条锁：
//   1. 事件名快照——试点域（scheduler/adapter/ingest）全部日志事件与快照一致。
//      改名/删除 → 红 = 事件名回归；新增事件 → 显式加进快照（并核对域白名单）。
//   2. 事件名格式——`域.动作`，域段必须是白名单（adapter 下还必须带平台段）。
//      steam.* / discover.* / store_browse.* 是白名单外历史前缀，试点内冻结现状，不允许新增。
//   3. 失败字段——试点域 error/fatal 级失败事件必须带 reason / failFields / err 之一；
//      纯告警事件（熔断触发/聚合阈值）豁免（它们带阈值自描述字段）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const PILOT_FILES = [
  'src/scheduler.js',
  'src/ingest.js',
  'src/adapters/steam.js',
  'src/adapters/sonkwo.js',
  'src/adapters/gog.js',
  'src/adapters/humble.js',
  'src/adapters/itad.js',
  'src/adapters/steam-meta.js',
  'src/adapters/steam-catalog.js',
  'src/adapters/sonkwo-discover.js',
  'src/adapters/store-browse.js',
];

// 事件名快照（2026-11-18 E4 批生成；顺序无关，内容必须逐字一致）。
// adapter.${plat.code}.shape_mismatch 是 ingest 域唯一的模板事件，按字面文本入快照。
const EVENT_SNAPSHOT = {
  'src/scheduler.js': [
    'scheduler.budget_exceeded', 'scheduler.circuit_reset', 'scheduler.circuit_reset_manual',
    'scheduler.circuit_skip', 'scheduler.circuit_tripped', 'scheduler.crash', 'scheduler.exit',
    'scheduler.failure_alert', 'scheduler.failure_alert_failed', 'scheduler.failure_alert_skipped',
    'scheduler.failure_reason_failed', 'scheduler.followup', 'scheduler.heavy_slot_released',
    'scheduler.job_deferred_busy', 'scheduler.job_done', 'scheduler.job_failed', 'scheduler.job_partial',
    'scheduler.job_spawn_failed', 'scheduler.job_start', 'scheduler.job_unexpected', 'scheduler.job_wait_end',
    'scheduler.job_wait_slot', 'scheduler.lastrun_restore_failed', 'scheduler.lastrun_restored',
    'scheduler.no_jobs', 'scheduler.settings_reloaded', 'scheduler.start', 'scheduler.stop',
    'scheduler.waiting_setup',
  ],
  'src/ingest.js': [
    'adapter.${plat.code}.shape_mismatch', 'ingest.failure_threshold', 'ingest.offer',
    'ingest.offer_failed', 'ingest.platform_mismatch', 'ingest.price_changed', 'ingest.shape_threshold',
    'ingest.skip', 'ingest.summary',
  ],
  'src/adapters/steam.js': ['adapter.steam.batch', 'adapter.steam.no_offers'],
  'src/adapters/sonkwo.js': [
    'adapter.sonkwo.bad_price', 'adapter.sonkwo.dom_fallback', 'adapter.sonkwo.no_price',
    'adapter.sonkwo.no_remix_context', 'adapter.sonkwo.not_a_product', 'adapter.sonkwo.sku_candidates',
    'adapter.sonkwo.sku_done', 'adapter.sonkwo.sku_empty',
  ],
  'src/adapters/gog.js': [
    'adapter.gog.matched', 'adapter.gog.no_exact_match', 'adapter.gog.no_price',
    'adapter.gog.no_price_by_id', 'adapter.gog.no_product_by_id', 'adapter.gog.refresh_by_id',
  ],
  'src/adapters/humble.js': [
    'adapter.humble.matched', 'adapter.humble.name_mismatch', 'adapter.humble.no_jsonld',
    'adapter.humble.no_match', 'adapter.humble.no_offer_by_slug', 'adapter.humble.redirected',
    'adapter.humble.refresh_by_slug', 'adapter.humble.slug_failed',
  ],
  'src/adapters/itad.js': [
    'adapter.itad.no_deals', 'adapter.itad.shape_mismatch', 'adapter.itad.url_failed',
    'adapter.itad.url_no_appid', 'adapter.itad.url_resolved',
  ],
  'src/adapters/steam-meta.js': ['steam.meta.done', 'steam.meta.failed', 'steam.meta.missing', 'steam.probe'],
  'src/adapters/steam-catalog.js': ['steam.catalog.fetched', 'steam.catalog.shape'],
  'src/adapters/sonkwo-discover.js': [
    'discover.done', 'discover.hit', 'discover.miss', 'discover.probe_failed', 'discover.stop_early',
  ],
  'src/adapters/store-browse.js': ['store_browse.batch_failed', 'store_browse.no_price_shape'],
};

// 域段白名单：白名单域 + 试点内冻结的历史前缀（新增事件不允许再用历史前缀）
const DOMAIN_SEGMENTS = new Set(['scheduler', 'ingest', 'adapter', 'steam', 'discover', 'store_browse']);
const EVENT_CALL_RE = /(?:logger|log)\??\.(?:trace|debug|info|warn|error|fatal)(?:\?\.)?\(\s*(['"`])([\s\S]*?)\1/g;
const ERROR_CALL_RE = /(?:logger|log)\??\.(?:error|fatal)(?:\?\.)?\(/g;
// 纯告警事件：带阈值自描述字段，不要求 reason/err
const ALERT_EVENTS = new Set(['scheduler.circuit_tripped', 'ingest.shape_threshold', 'ingest.failure_threshold']);

function fileText(file) {
  return readFileSync(`${ROOT}/${file}`, 'utf8');
}

function extractEvents(text) {
  const seen = new Set();
  let m;
  while ((m = EVENT_CALL_RE.exec(text))) {
    if (!seen.has(m[2])) {
      seen.add(m[2]);
    }
  }
  return [...seen];
}

function eventAfter(text, index) {
  const m = /^\s*(['"`])([\s\S]*?)\1/.exec(text.slice(index));
  return m ? m[2] : null;
}

test('E4 事件名快照：试点域事件名与快照逐字一致（改名/删除即红）', () => {
  for (const file of PILOT_FILES) {
    const got = extractEvents(fileText(file)).sort();
    const want = [...EVENT_SNAPSHOT[file]].sort();
    assert.deepEqual(got, want, `${file} 事件名与快照不一致——改名/删除属回归，新增需显式加进快照`);
  }
});

test('E4 事件名格式：域.动作、域段在白名单内、adapter 必须带平台段', () => {
  for (const file of PILOT_FILES) {
    for (const raw of extractEvents(fileText(file))) {
      const concrete = raw.replace(/\$\{[^}]*\}/g, 'x'); // 模板事件（adapter.${plat.code}.shape_mismatch）按占位符校验
      assert.match(concrete, /^[a-z][a-z0-9_.-]+$/, `${file} 事件名「${raw}」格式非法`);
      const domain = concrete.split('.')[0];
      assert.ok(DOMAIN_SEGMENTS.has(domain), `${file} 事件名「${raw}」域段「${domain}」不在白名单`);
      if (domain === 'adapter') {
        const second = concrete.split('.')[1];
        assert.ok(Boolean(second) && /^[a-z0-9_-]+$/.test(second), `${file} 事件名「${raw}」adapter 域必须带平台段`);
      }
    }
  }
});

test('E4 失败字段：试点域 error/fatal 失败事件必带 reason/failFields/err（告警事件豁免）', () => {
  const missing = [];
  for (const file of PILOT_FILES) {
    const text = fileText(file);
    let m;
    while ((m = ERROR_CALL_RE.exec(text))) {
      const afterCall = text.slice(ERROR_CALL_RE.lastIndex);
      const event = eventAfter(afterCall, 0);
      if (event && ALERT_EVENTS.has(event)) continue; // 告警事件带阈值字段，豁免
      const window = text.slice(ERROR_CALL_RE.lastIndex, ERROR_CALL_RE.lastIndex + 900);
      const ok = /reason\b|failFields|err:/.test(window);
      if (!ok) missing.push(`${file} → ${event ?? '（事件名未识别）'}`);
    }
  }
  assert.equal(missing.length, 0, `以下 error/fatal 失败事件缺 reason/failFields/err：\n${missing.join('\n')}`);
});
