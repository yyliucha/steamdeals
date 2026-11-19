// DQ 批（docs/PROFILE-UI-2026-11-19.md §4 决策 2）：默认头像统一规则（Web 与 App 同一口径）——
// 昵称首字母（英文大写）/ 第一个汉字 + 品牌色圆底；空昵称回退调用方给的占位符。
// App 侧对应实现：steamdeals-app ui/profile/ProfileEditScreen.kt 的 initialOf（JVM 单测锁定）。
export function avatarInitial(name, fallback = '?') {
  const s = String(name ?? '').trim();
  if (!s) return fallback;
  const first = [...s][0]; // 按码点取首字符（中文/emoji 安全），英文转大写、汉字不变
  return first.toUpperCase();
}
