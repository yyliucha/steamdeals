// CO-3/C4（docs/DESIGN-AUDIT.md C4）：前端金额展示统一 util。
// 金额整数分 → 元字符串的唯一落点（yuanAmount），货币符号只做展示、不折算；
// 未知币种用「CODE 」前缀兜底。Home 主页的区服币种符号沿用其历史口径（JPY:'¥'），
// 但 /100 已全部收敛到本文件的 yuanAmount。
export const CURRENCY_SYMBOLS = {
  CNY: '¥',
  USD: '$',
  HKD: 'HK$',
  TWD: 'NT$',
  JPY: 'JP¥',
  EUR: '€',
  GBP: '£',
};

/** 整数分 → 两位小数字符串（调用方先判空；null/NaN 语义透出）。 */
export function yuanAmount(cents) {
  return (Number(cents) / 100).toFixed(2);
}

/** 金额展示：货币符号 + 两位小数；null/NaN → nil（默认 '—'）。 */
export function formatMoney(cents, currency, { nil = '—' } = {}) {
  if (cents == null || Number.isNaN(Number(cents))) return nil;
  const code = String(currency ?? '');
  const symbol = CURRENCY_SYMBOLS[code] ?? `${code} `;
  return `${symbol}${yuanAmount(cents)}`;
}
