// CO-3/C4（docs/DESIGN-AUDIT.md C4）：前端金额 util 口径测试（frontend/src/utils/money.js）。
// 与后端 src/format.js 同精神：整数分 → 两位小数字符串的唯一落点；断言守的是
// 「组件替换 /100 后金额显示一字不差」——0.05 元这种小数分不能有浮点尾差。
import test from 'node:test';
import assert from 'node:assert/strict';
import { CURRENCY_SYMBOLS, yuanAmount, formatMoney } from '../frontend/src/utils/money.js';
import { fmtDay } from '../frontend/src/utils/siteTime.js';

test('yuanAmount：整数分 → 两位小数字符串', () => {
  assert.equal(yuanAmount(19800), '198.00');
  assert.equal(yuanAmount(4800), '48.00');
  assert.equal(yuanAmount(5), '0.05', '5 分 = 0.05，不能出现 0.05000000000001');
  assert.equal(yuanAmount(0), '0.00');
  assert.equal(yuanAmount(2999), '29.99');
  assert.equal(yuanAmount(Math.floor(4800 * 0.9)), '43.20', '折扣 9 折路径与旧实现一致');
});

test('formatMoney：符号 + 两位小数；null/NaN → nil', () => {
  assert.equal(formatMoney(19800, 'CNY'), '¥198.00');
  assert.equal(formatMoney(19800, 'USD'), '$198.00');
  assert.equal(formatMoney(19800, 'HKD'), 'HK$198.00');
  assert.equal(formatMoney(19800, 'JPY'), 'JP¥198.00', '组件口径 JPY 用 JP¥（与后端不同，行为不变）');
  assert.equal(formatMoney(19800, 'EUR'), '€198.00');
  assert.equal(formatMoney(19800, 'GBP'), '£198.00');
  assert.equal(formatMoney(100, 'XYZ'), 'XYZ 1.00', '未知币种：CODE + 空格前缀');
  assert.equal(formatMoney(null, 'CNY'), '—');
  assert.equal(formatMoney(Number.NaN, 'CNY'), '—');
});

test('组件替换前的内联实现逐一对照（行为不变的锁）', () => {
  // PriceSparkline / PriceHistoryReport：CURRENCY_SYMBOL[code] || ''（未知币种无前缀）
  const spark = (cents, currency) =>
    cents == null ? '—' : `${CURRENCY_SYMBOLS[String(currency ?? '').toUpperCase()] || ''}${yuanAmount(cents)}`;
  assert.equal(spark(4800, 'CNY'), '¥48.00');
  assert.equal(spark(4800, 'JPY'), 'JP¥48.00', '组件口径 JPY 用 JP¥');
  assert.equal(spark(4800, 'jp'), '48.00', '旧实现按大写后的字面量查表（jp→JP 无前缀），行为照旧');
  assert.equal(spark(4800, 'ZZZ'), '48.00', '未知币种不显示前缀（旧行为 || \'\'）');
  assert.equal(spark(null, 'CNY'), '—');
  // Home：nil 文案是「暂无报价」（旧行为）
  assert.equal(formatMoney(null, 'CNY', { nil: '暂无报价' }), '暂无报价');
});

test('fmtDay：日期字段取前 10 位（Home 愿望单加入时间、后台删除记录口径）', () => {
  assert.equal(fmtDay('2026-11-18T05:00:00.000Z'), '2026-11-18');
  assert.equal(fmtDay('2026-11-18'), '2026-11-18');
  assert.equal(fmtDay(null), '');
  assert.equal(fmtDay(''), '');
});

test('币种符号表：组件历史口径一字不差', () => {
  assert.deepEqual(CURRENCY_SYMBOLS, {
    CNY: '¥', USD: '$', HKD: 'HK$', TWD: 'NT$', JPY: 'JP¥', EUR: '€', GBP: '£',
  });
});
