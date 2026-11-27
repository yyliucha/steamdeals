// FZ 批（docs/VISITORS-REDESIGN.md §1 决策 13、§3-5）：访问安全域**唯一**的状态词映射表。
//
// 全站（访问分析 / IP 详情抽屉 / IP 封禁 / 设备封禁 / 临时封禁 / 白名单 / 概览）都从这里取文案与标签色，
// 不再各写一套（重设计前「封禁中 / 已封禁 / 拦截」三种叫法在不同 tab 里混用）。
//
// 五个 IP 状态：正常 normal / 被拦截 intercepted / 临时封 banned（显示剩余时间）/ 已封禁 blocked / 已信任 trusted。
// 注意：审核记录状态（待审 / 已处置 / 已忽略 / 自动封禁）是**另一个维度**，集中在 REVIEW_STATUS，
// 与 IP 状态不混用（规格 §1 决策 13 明文要求）。

export const VISITOR_STATUS = {
  normal: { label: '正常', tag: 'info' },
  intercepted: { label: '被拦截', tag: 'warning' },
  banned: { label: '临时封', tag: 'warning' },
  blocked: { label: '已封禁', tag: 'danger' },
  trusted: { label: '已信任', tag: 'success' },
};

/** 状态枚举顺序（表格/图例/筛选共用，避免各处顺序不一）。 */
export const VISITOR_STATUS_ORDER = ['normal', 'intercepted', 'banned', 'blocked', 'trusted'];

/** 状态筛选下拉：默认「有效访问」（排除已封禁 + 已信任；临时封保留），与后端 status 白名单一一对应。 */
export const VISITOR_STATUS_FILTERS = [
  { value: 'active', label: '有效访问（默认）' },
  ...VISITOR_STATUS_ORDER.map((value) => ({ value, label: VISITOR_STATUS[value].label })),
  { value: 'all', label: '全部' },
];

/** 审核记录状态（第二维度，不参与 IP 状态筛选）。 */
export const REVIEW_STATUS = {
  pending: { label: '待审', tag: 'success' },
  approved: { label: '已处置', tag: 'danger' },
  rejected: { label: '已忽略', tag: 'info' },
  auto_banned: { label: '自动封禁', tag: 'info' },
};

/** 自动封禁来源 → 可读标签（CF 批来源词口径不变，集中到这里供临时封禁页/抽屉共用）。 */
const ABUSE_SOURCE_LABELS = {
  rate: '频率超限',
  'rate-day': '频率超限（当天）',
  path: '路径规则',
  'manual:temp': '人工临时封',
  'auto:path-probe': '漏洞路径探测',
  'auto:credential': '登录凭据爆破',
  'auto:extreme-rate': '极端频率',
  'auto:ua-list': '异常 UA 名单',
};

export function abuseSourceLabel(source) {
  return ABUSE_SOURCE_LABELS[source] || source || '—';
}

export function visitorStatusMeta(status) {
  return VISITOR_STATUS[status] || { label: '未知', tag: 'info' };
}

export function visitorStatusLabel(status) {
  return visitorStatusMeta(status).label;
}

/**
 * 剩余时间文案（临时封禁用）：`剩余 6 分钟` / `剩余 1 小时 20 分钟` / `剩余 2 天 3 小时`；
 * 已过期/无到期时间返回空串（调用方不显示「剩余」）。
 */
export function banRemaining(banUntil, now = Date.now()) {
  if (!banUntil) return '';
  const until = typeof banUntil === 'number' ? banUntil : Date.parse(banUntil);
  if (!Number.isFinite(until)) return '';
  const ms = until - now;
  if (!(ms > 0)) return '';
  const minute = 60_000;
  if (ms < minute) return '剩余 <1 分钟';
  const totalMinutes = Math.ceil(ms / minute);
  if (totalMinutes < 60) return `剩余 ${totalMinutes} 分钟`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return minutes ? `剩余 ${hours} 小时 ${minutes} 分钟` : `剩余 ${hours} 小时`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `剩余 ${days} 天 ${restHours} 小时` : `剩余 ${days} 天`;
}

/** 状态文案（行内展示）：临时封拼上剩余时间，其余直接取映射表。 */
export function visitorStatusText(row, now = Date.now()) {
  const status = row?.status || 'normal';
  const meta = visitorStatusMeta(status);
  if (status === 'banned') {
    const left = banRemaining(row?.ban_until, now);
    return left ? `${meta.label} · ${left}` : meta.label;
  }
  return meta.label;
}

/** 状态标签类型（el-tag type）。 */
export function visitorStatusTag(status) {
  return visitorStatusMeta(status).tag;
}

export function reviewStatusMeta(status) {
  return REVIEW_STATUS[status] || REVIEW_STATUS.pending;
}
