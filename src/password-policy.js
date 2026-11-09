// 密码策略（docs/AUTH-REDESIGN.md §4.1，AK-1 批）：
// 最低 12 位 / 最长 200；弱口令黑名单（Top 1 万 + 常见词带数字尾巴的变体）、
// 含用户名/邮箱 @ 前部分（长度 ≥4、忽略大小写）、全同字符、连续序列（递增/递减 ≥6）。
// 纯函数；六个设置密码的入口统一调用本模块，不再各写 length < 8。
// 不 trim、不做 Unicode 归一化——空格与中文都是合法字符，密码原样哈希。
import { randomBytes } from 'node:crypto';
import { COMMON_PASSWORDS } from './data/common-passwords.js';

export const MIN_LENGTH = 12;
export const MAX_LENGTH = 200;

// 「常见密码词 + 数字尾巴」变体（如 password1234）：Top 1 万列表没有覆盖全部数字尾巴，
// 但这类变体是撞库首选（验收 1 明确要求 password1234 拒绝），用词根 + 0~6 位数字尾巴兜底。
const COMMON_BASE_WORDS = [
  'password', 'passwd', 'pass', 'admin', 'administrator', 'root', 'qwerty', 'abc123',
  'letmein', 'welcome', 'iloveyou', 'test', 'login', 'secret', 'monkey', 'dragon',
  'football', 'baseball', 'master', 'shadow', 'sunshine', 'princess', 'trustno1', 'access',
];
const COMMON_BASE_RE = new RegExp(`^(?:${COMMON_BASE_WORDS.join('|')})\\d{0,6}$`);

function isCommon(password) {
  const lower = password.toLowerCase();
  return COMMON_PASSWORDS.has(lower) || COMMON_BASE_RE.test(lower);
}

/** 连续序列：同方向递增/递减（ASCII 相邻 ±1）连续 ≥6 个（123456789012、abcdefghijkl 都命中）。 */
function isSequential(password) {
  const lower = password.toLowerCase();
  let run = 1;
  let dir = 0;
  for (let i = 1; i < lower.length; i += 1) {
    const step = lower.charCodeAt(i) - lower.charCodeAt(i - 1);
    if (step !== 1 && step !== -1) {
      dir = 0;
      run = 1;
      continue;
    }
    if (step === dir) {
      run += 1;
    } else {
      dir = step;
      run = 2;
    }
    if (run >= 6) return true;
  }
  return false;
}

/** 每个 reason 对应的中文提示（接口 400 文案与前端展示用）。 */
export const REASON_TEXT = {
  too_short: '至少 12 位',
  too_long: '不超过 200 位',
  common: '过于常见，容易撞库',
  contains_identity: '不能包含用户名或邮箱',
  repeated: '不能全是同一字符',
  sequential: '不能是连续序列（如 123456789012）',
};

/**
 * 评估密码。返回 { ok, score: 0..4, reasons: string[], suggestions: string[] }。
 * 任一 reason 命中即 ok=false；评分：12–15 位 = 2，16–19 = 3，≥20 = 4；
 * 命中 common 压到 0、contains_identity 压到 1（§4.1）。
 */
export function evaluatePassword(password, { username = '', email = '' } = {}) {
  const pw = String(password ?? '');
  const reasons = [];
  const suggestions = [];

  if (pw.length < MIN_LENGTH) {
    reasons.push('too_short');
    suggestions.push(`密码至少 ${MIN_LENGTH} 位`);
  }
  if (pw.length > MAX_LENGTH) {
    reasons.push('too_long');
    suggestions.push(`密码不超过 ${MAX_LENGTH} 位`);
  }
  if (isCommon(pw)) {
    reasons.push('common');
    suggestions.push('换一个不常见的密码');
  }
  const identities = [String(username ?? ''), String(email ?? '').split('@')[0]]
    .map((s) => s.toLowerCase())
    .filter((s) => s.length >= 4);
  if (identities.some((part) => pw.toLowerCase().includes(part))) {
    reasons.push('contains_identity');
    suggestions.push('不要包含用户名或邮箱');
  }
  if (pw.length >= 2 && new Set(pw).size === 1) {
    reasons.push('repeated');
    suggestions.push('不要全部使用同一字符');
  }
  if (isSequential(pw)) {
    reasons.push('sequential');
    suggestions.push('不要使用连续数字或字母');
  }

  let score = pw.length >= 20 ? 4 : pw.length >= 16 ? 3 : pw.length >= 12 ? 2 : 0;
  if (reasons.includes('common')) score = 0;
  else if (reasons.includes('contains_identity')) score = Math.min(score, 1);

  return { ok: reasons.length === 0, score, reasons, suggestions };
}

/** 入口用：返回 null（合格）或一句中文错误（含命中原因）。 */
export function passwordPolicyError(password, { username = '', email = '' } = {}) {
  const check = evaluatePassword(password, { username, email });
  if (check.ok) return null;
  return `密码不符合要求：${check.reasons.map((r) => REASON_TEXT[r]).join('、')}`;
}

/** AK-3（docs/AUTH-REDESIGN.md §4.5）：16 位随机临时密码（base64url，天然满足策略），只在响应里出现一次。 */
export function generateTempPassword(bytes = 12) {
  return randomBytes(bytes).toString('base64url');
}
