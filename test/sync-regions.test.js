// EI 批（docs/STEAM-SYNC-STATUS-AND-RATING.md §11）：双区域配置读取单点——
// 默认内容 us / 本位币 cn+CNY；env（settings 水合后）覆盖；空字符串必须回退（|| 不是 ??）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { contentRegion, baseRegion, baseCurrency, regionContext } from '../src/sync-regions.js';

test('默认值：contentRegion=us、baseRegion=cn、baseCurrency=CNY（env 为空对象）', () => {
  assert.equal(contentRegion({}), 'us');
  assert.equal(baseRegion({}), 'cn');
  assert.equal(baseCurrency({}), 'CNY');
  assert.deepEqual(regionContext({}), { content: 'us', base: 'cn', currency: 'CNY' });
});

test('env 覆盖：SYNC_CONTENT_REGION / SITE_BASE_REGION / SITE_BASE_CURRENCY', () => {
  const env = { SYNC_CONTENT_REGION: 'eu', SITE_BASE_REGION: 'us', SITE_BASE_CURRENCY: 'usd' };
  assert.equal(contentRegion(env), 'eu');
  assert.equal(baseRegion(env), 'us', '区域归一化小写');
  assert.equal(baseCurrency(env), 'USD', '货币归一化大写');
  assert.deepEqual(regionContext(env), { content: 'eu', base: 'us', currency: 'USD' });
});

test('空字符串回退默认（水合会把空值写成 \'\'，?? 遇空串不回退的坑）', () => {
  const env = { SYNC_CONTENT_REGION: '', SITE_BASE_REGION: '   ', SITE_BASE_CURRENCY: '' };
  assert.equal(contentRegion(env), 'us');
  assert.equal(baseRegion(env), 'cn');
  assert.equal(baseCurrency(env), 'CNY');
});

test('大小写与空白容错：区域小写、货币大写', () => {
  const env = { SYNC_CONTENT_REGION: ' US ', SITE_BASE_REGION: 'CN', SITE_BASE_CURRENCY: ' cny ' };
  assert.equal(contentRegion(env), 'us');
  assert.equal(baseRegion(env), 'cn');
  assert.equal(baseCurrency(env), 'CNY');
});
