// BK 批（docs/SESSION-MANAGEMENT.md §3.2）：会话绑定指纹归一化。
//
// 目的：既防会话被盗用，又不因"移动网络切网 / 浏览器自动升级"把正常用户频繁踢下线。
// 比较粒度（§7 已确认默认）：
//   - IPv4：前 24 位（1.2.3.x 视为同一出口）
//   - IPv6：前 64 位前缀（展开 :: 后取前 4 组）
//   - UA：浏览器家族 + 主版本（Chrome/130、Safari/17、Edge/130、Firefox/131、MicroMessenger/8…），
//     忽略小版本、平台串与 Windows NT 10.0 这类细节
// 完全字符串相等会让切网/自动升级变成频繁掉线，故不采用；若所有者坚持，改这里即可（§7-1）。

const IPV4_RE = /^(\d{1,3})(?:\.(\d{1,3})){3}$/;

function isIpv4(s) {
  if (!IPV4_RE.test(s)) return false;
  return s.split('.').every((p) => Number(p) <= 255);
}

/** IPv4 → 前 24 位键（"1.2.3.0/24"）；非法返回 null。 */
function ipv4Key(ip) {
  if (!isIpv4(ip)) return null;
  const [a, b, c] = ip.split('.').map(Number);
  return `${a}.${b}.${c}.0/24`;
}

/** 展开 IPv6 的 :: 为 8 组；非法返回 null。 */
function expandIpv6(ip) {
  const s = String(ip ?? '').trim();
  if (!s.includes(':')) return null;
  let head = s;
  let tail = '';
  const zoneIdx = s.indexOf('%');
  if (zoneIdx >= 0) {
    tail = s.slice(zoneIdx);
    head = s.slice(0, zoneIdx);
  }
  const double = head.indexOf('::');
  if (double >= 0) {
    const left = head.slice(0, double).split(':').filter(Boolean);
    const right = head.slice(double + 2).split(':').filter(Boolean);
    const missing = 8 - left.length - right.length;
    if (missing < 1) return null;
    head = [...left, ...Array(missing).fill('0'), ...right].join(':');
  }
  const groups = head.split(':');
  if (groups.length !== 8) return null;
  if (!groups.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g))) return null;
  return groups.map((g) => g.padStart(4, '0').toLowerCase()).join(':') + tail;
}

/** IPv6 → 前 64 位前缀（前 4 组，展开后小写）；非法返回 null。 */
function ipv6Key(ip) {
  const expanded = expandIpv6(ip);
  if (!expanded) return null;
  return expanded.split(':').slice(0, 4).join(':') + '::/64';
}

/**
 * 会话 IP 归一化键：IPv4 取 /24、IPv6 取 /64；非法（含空）返回 null。
 * 存 sessions.ip_key，请求时用同一函数生成后比较。
 */
export function ipSessionKey(ip) {
  const s = String(ip ?? '').trim();
  if (!s) return null;
  if (isIpv4(s)) return ipv4Key(s);
  if (s.includes(':')) return ipv6Key(s);
  return null;
}

const UA_FAMILY = [
  [/MicroMessenger\/(\d+)/, 'MicroMessenger'],
  [/Edg(?:e|A|iOS)?\/(\d+)/, 'Edge'],
  [/OPR\/(\d+)/, 'Opera'],
  [/Chrome\/(\d+)/, 'Chrome'],
  [/Firefox\/(\d+)/, 'Firefox'],
  [/Version\/(\d+).*Safari/, 'Safari'],
  [/Safari\/(\d+)/, 'Safari'],
];

/**
 * UA 归一化键：浏览器家族 + 主版本（"Chrome/130"、"Safari/17"、null=识别不出）。
 * 只用于"变没变"的比较，识别不出（null）的 UA 由调用方决定是否跳过绑定校验。
 */
export function uaSessionKey(userAgent) {
  const ua = String(userAgent ?? '');
  if (!ua) return null;
  for (const [re, family] of UA_FAMILY) {
    const m = ua.match(re);
    if (m) return `${family}/${m[1]}`;
  }
  return null;
}
