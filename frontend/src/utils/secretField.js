// FX 批（docs/SECRET-REVEAL.md §1/§6）：后台密钥字段「密码框 + 眼睛」的纯逻辑。
//
// 抽成无 Vue / 无 DOM 的纯函数，node:test 可以直接锁行为（前端没有组件级测试框架）：
// - eyeAction：点眼睛到底该做什么——未配置不发请求、首次取明文、再点只切密文；
// - submitDecision：懒加载真值只作比较基线，未改动不提交、留空不提交；
// - parseProxyLines：代理多条（换行分隔）逐行展示/逐行复制。
//
// 明文生命周期（决策 2/3）：懒加载值只存在于组件内存；30 秒无操作自动切回密文。

/** 明文显示 30 秒无操作自动回密文（决策 3，验收 §7.3）。 */
export const SECRET_AUTO_HIDE_MS = 30000;

/**
 * 代理多条的掩码：固定 12 位、不随真实长度变化（不泄露条数/凭据长度）。
 * 仍由浏览器 type=password 渲染圆点（决策 8：不手工拼点，这里只提供固定占位值）。
 */
export const PROXY_MASK = '************';

/**
 * 点眼睛的动作判定。
 * @param {{ hasValue: boolean, loaded: string|null|undefined, revealed: boolean }} state
 * @returns {'ignore'|'hide'|'fetch'|'reveal-cached'}
 *   ignore = 未配置（按钮置灰、不发任何请求）；fetch = 首次懒加载；
 *   reveal-cached = 命中缓存直接切明文（不重复请求）；hide = 切回密文。
 */
export function eyeAction({ hasValue = false, loaded = null, revealed = false } = {}) {
  if (!hasValue) return 'ignore';
  if (revealed) return 'hide';
  return loaded == null ? 'fetch' : 'reveal-cached';
}

/**
 * 提交判定（决策 5：未改动不提交、留空 = 保持原值）。
 * baseline 是懒加载到的真值；没点过眼睛时它是 null（基线为空）。
 * @returns {{ submit: boolean, reason: 'empty'|'unchanged'|'changed', value?: string }}
 */
export function submitDecision({ draft = '', baseline = null } = {}) {
  const value = String(draft ?? '').trim();
  if (!value) return { submit: false, reason: 'empty' };
  if (value === String(baseline ?? '').trim()) return { submit: false, reason: 'unchanged' };
  return { submit: true, reason: 'changed', value };
}

/** 代理多条：换行（兼容 \r\n / 逗号）分隔 → 去空行 → 逐行可复制（§4「代理（多条）」）。 */
export function parseProxyLines(text) {
  return String(text ?? '')
    .split(/[\r\n,]+/)
    .map((line) => line.trim())
    .filter(Boolean);
}
