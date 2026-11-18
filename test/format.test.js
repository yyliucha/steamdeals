// CO-3/C4（docs/DESIGN-AUDIT.md C4）：日期/金额统一 helper 口径测试。
// 守的是三件事：
//   1. 金额「整数分 → 元字符串」唯一实现（yuanAmount）——两位小数、无浮点垃圾（5 分 = '0.05'）；
//   2. formatDay 是**本地时区**的 YYYY-MM-DD（进程 TZ = 站点时区），与 UTC 切片口径分开、可复现差异；
//   3. 既有调用方签名（report.fmtYuan/fmtDate、compare.formatMoney）行为不变——这些还有
//      test/report.test.js / test/compare.test.js 各自主链兜底，这里再做一轮交叉锁。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CURRENCY_SYMBOLS,
  yuanAmount,
  yuanRounded,
  formatMoney,
  formatDayText,
  formatDay,
  formatDayUtc,
  formatDateTime,
} from '../src/format.js';
import { fmtYuan, fmtDate } from '../src/report.js';
import { formatMoney as compareFormatMoney } from '../src/compare.js';

test('yuanAmount：整数分 → 两位小数字符串，小数分不丢精度', () => {
  assert.equal(yuanAmount(4800), '48.00');
  assert.equal(yuanAmount(5), '0.05', '5 分必须显示 0.05，不能出现浮点尾差');
  assert.equal(yuanAmount(0), '0.00');
  assert.equal(yuanAmount(123456), '1234.56');
  assert.equal(yuanAmount(-50), '-0.50');
  assert.equal(yuanAmount('2999'), '29.99', '字符串数字同样可用');
});

test('yuanRounded：整数元四舍五入（图表轴标签口径）', () => {
  assert.equal(yuanRounded(149), 1);
  assert.equal(yuanRounded(150), 2);
  assert.equal(yuanRounded(0), 0);
});

test('formatMoney：符号 + 两位小数；null/NaN → nil；未知币种用「CODE 」前缀', () => {
  assert.equal(formatMoney(4800), '¥48.00', '默认 CNY');
  assert.equal(formatMoney(4800, 'USD'), '$48.00');
  assert.equal(formatMoney(4800, 'HKD'), 'HK$48.00');
  assert.equal(formatMoney(4800, 'JPY'), 'JP¥48.00');
  assert.equal(formatMoney(100, 'XYZ'), 'XYZ 1.00', '未知币种：CODE + 空格前缀（compare.test.js 同款锁）');
  assert.equal(formatMoney(null), '—');
  assert.equal(formatMoney(Number.NaN), '—', 'NaN 视为无值');
  assert.equal(formatMoney(null, 'CNY', { nil: '-' }), '-', 'nil 文案可覆盖（CLI 用 -）');
});

test('formatDayText：已字符串化的日期取前 10 位（YYYY-MM-DD 口径）', () => {
  assert.equal(formatDayText('2026-10-26T00:00:00Z'), '2026-10-26');
  assert.equal(formatDayText('2026-10-26'), '2026-10-26');
  assert.equal(formatDayText(null), '');
  assert.equal(formatDayText(''), '');
});

test('formatDay：本地时区取日（进程 TZ = 站点时区），与 UTC 口径分离', () => {
  // 从本地分量构造：本地 11-18 00:30。formatDay 必须仍是 2026-11-18——这正是「DATE 字符串口径」
  // 要守的语义：展示日期跟随站点时区，而不是跟着 UTC 漂移。
  const d = new Date(2026, 10, 18, 0, 30);
  assert.equal(formatDay(d), '2026-11-18', '本地分量构造的 Date 取日仍是本地日');
  assert.equal(formatDayUtc(d), d.toISOString().slice(0, 10), 'UTC 口径与 ISO 切片完全一致');

  // 反向自检：非零时区下，本地零点附近的两个口径必然不同——如果 formatDay 哪天悄悄变成
  // toISOString().slice(0,10)（UTC 口径），这条就会红。
  const now = new Date();
  const nearMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 30);
  const localDay = formatDay(nearMidnight);
  const utcDay = formatDayUtc(nearMidnight);
  if (nearMidnight.getTimezoneOffset() !== 0) {
    assert.notEqual(localDay, utcDay, `本地口径（${localDay}）≠ UTC 口径（${utcDay}）`);
  } else {
    assert.equal(localDay, utcDay, 'UTC 机器上两个口径天然一致');
  }
});

test('formatDateTime：本地 YYYY-MM-DD HH:mm（邮件到期时间口径）', () => {
  assert.equal(formatDateTime(new Date(2026, 10, 18, 3, 5)), '2026-11-18 03:05');
  assert.equal(formatDateTime(new Date(2026, 0, 2, 23, 7)), '2026-01-02 23:07');
});

test('既有调用方签名行为不变：report.fmtYuan / fmtDate / compare.formatMoney', () => {
  // 与 test/report.test.js、test/compare.test.js 的主链断言一一对应（helper 收敛后行为不漂移）。
  assert.equal(fmtYuan(9900), '¥99.00');
  assert.equal(fmtYuan(null), '—');
  assert.equal(fmtDate('2026-10-26T00:00:00Z'), '2026-10-26');
  assert.equal(compareFormatMoney(8900, 'CNY'), '¥89.00');
  assert.equal(compareFormatMoney(2999, 'USD'), '$29.99');
  assert.equal(compareFormatMoney(123456, 'TRY'), '₺1234.56');
  assert.equal(compareFormatMoney(null, 'CNY'), '—');
});

test('币种符号表完整性：后端展示覆盖八个区服币种', () => {
  // 与 src/compare.js 历史 SYMBOLS 一致（ARS 用 ARS$，JPY 用 JP¥——不是前端那套符号）。
  assert.deepEqual(CURRENCY_SYMBOLS, {
    CNY: '¥', USD: '$', HKD: 'HK$', TWD: 'NT$', JPY: 'JP¥',
    RUB: '₽', TRY: '₺', ARS: 'ARS$', EUR: '€',
  });
});
