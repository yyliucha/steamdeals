// CO-3/C4（docs/DESIGN-AUDIT.md C4）：日期/金额统一口径 helper。
//
// 金额：入库一律整数分，展示才转元。全仓「分 → 元字符串」的唯一实现在这里
// （yuanAmount），避免散落 `/100` 引入浮点或四舍五入口径漂移；货币符号只做展示，
// 不同币种**不折算**（region + currency 是显式维度）。
//
// 日期：YYYY-MM-DD 字符串口径（docs/ARCHITECTURE.md §4.3）。Date 对象按**进程本地
// 时区**（进程 TZ = 站点时区）取日，绝不拿 Date 直接进 SQL 比较；已字符串化的值只
// 取前 10 位。少数需要 UTC 口径的场景（文件时间戳、Steam epoch 换算）用 formatDayUtc。

export const CURRENCY_SYMBOLS = {
  CNY: '¥',
  USD: '$',
  HKD: 'HK$',
  TWD: 'NT$',
  JPY: 'JP¥',
  RUB: '₽',
  TRY: '₺',
  ARS: 'ARS$',
  EUR: '€',
};

/** 整数分 → 两位小数字符串（全仓唯一 /100 落点；调用方先判空，null/NaN 语义透出）。 */
export function yuanAmount(cents) {
  return (Number(cents) / 100).toFixed(2);
}

/** 整数分 → 整数元（四舍五入；图表轴标签等不需要小数的展示，同样收敛 /100 落点）。 */
export function yuanRounded(cents) {
  return Math.round(Number(cents) / 100);
}

/** 金额展示：货币符号 + 两位小数；null/NaN → nil（默认 '—'）。符号未收录时用「CODE 」前缀。 */
export function formatMoney(cents, currency = 'CNY', { nil = '—' } = {}) {
  if (cents == null || Number.isNaN(Number(cents))) return nil;
  const code = String(currency ?? '');
  const symbol = CURRENCY_SYMBOLS[code] ?? `${code} `;
  return `${symbol}${yuanAmount(cents)}`;
}

const pad2 = (n) => String(n).padStart(2, '0');

/** 已字符串化/数字的日期值 → 取前 10 位（YYYY-MM-DD 口径；非日期串照原样切片）。 */
export function formatDayText(value) {
  return String(value ?? '').slice(0, 10);
}

/** Date → 本地时区 YYYY-MM-DD（进程 TZ = 站点时区）；非 Date 值回落 formatDayText。 */
export function formatDay(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
  }
  return formatDayText(value);
}

/** Date → UTC YYYY-MM-DD（toISOString().slice(0,10) 的统一落点：文件时间戳、epoch 换算）。 */
export function formatDayUtc(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return formatDayText(value);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Date → 本地时区 `YYYY-MM-DD HH:mm`（邮件里的到期时间等展示口径）。 */
export function formatDateTime(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return formatDayText(value);
  return `${formatDay(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
