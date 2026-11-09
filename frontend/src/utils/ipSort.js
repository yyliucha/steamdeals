// IP 排序工具（AQ 批 docs/ADMIN-REVIEW-LISTS.md §3.1）。
//
// 需求：IP 按**数值**排序（9.x → 45.x → 100.x → 193.x），而不是字符串顺序
// （字符串会排出 100 → 193 → 45 → 9 这种"看着乱"的顺序）。
// IPv6 / 异常值排在所有 IPv4 之后，内部按字符串比较；空值永远排最后。

/** 是否合法 IPv4（四段 0–255）。 */
export function isIpv4(value) {
  const text = String(value ?? '').trim();
  const m = text.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  return m.slice(1).every((part) => Number(part) <= 255);
}

/** IPv4 → 32 位整数；非法返回 null。 */
export function ipv4ToInt(value) {
  if (!isIpv4(value)) return null;
  const [a, b, c, d] = String(value).trim().split('.').map(Number);
  return a * 2 ** 24 + b * 2 ** 16 + c * 2 ** 8 + d;
}

/**
 * 比较两个 IP：IPv4 按数值，IPv6/异常值排后按字符串，空值最后。
 * 用于 Array.prototype.sort(compareIp)。
 */
export function compareIp(a, b) {
  const left = String(a ?? '').trim();
  const right = String(b ?? '').trim();
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  const li = ipv4ToInt(left);
  const ri = ipv4ToInt(right);
  if (li != null && ri != null) return li - ri;
  if (li != null) return -1;
  if (ri != null) return 1;
  return left.localeCompare(right);
}
