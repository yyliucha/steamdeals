// EI 批（docs/STEAM-SYNC-STATUS-AND-RATING.md §11）：两套区域配置，各管各的——
// 内容链路（steam-meta / steam-status / discovery / rating-backfill）读 contentRegion
// （默认 us：国区商店隐藏成人/锁区内容，美区才能拿全量）；
// 价格链路（steam.js / sync steam-prices / backfill / steamall）读 baseRegion + baseCurrency
// （默认 cn / CNY：国区报价是业务核心，改美区会把美元价写进国区 offer）。
//
// 值来源：settings 水合后的 process.env（数据库 > 环境变量 > 代码默认，见 src/settings.js）。
// 回退一律用 ||：?? 遇空字符串不回退（水合会把空值写成 ''，见 SKILL 已知坑）。

/** 内容采集区域（Steam cc 两字母码），默认 us。 */
export function contentRegion(env = process.env) {
  return String(env.SYNC_CONTENT_REGION ?? '').trim().toLowerCase() || 'us';
}

/** 本位币/报价区域（价格同步 + 前台查询默认 region），默认 cn。 */
export function baseRegion(env = process.env) {
  return String(env.SITE_BASE_REGION ?? '').trim().toLowerCase() || 'cn';
}

/** 本位币货币（展示/入库货币），默认 CNY。 */
export function baseCurrency(env = process.env) {
  return String(env.SITE_BASE_CURRENCY ?? '').trim().toUpperCase() || 'CNY';
}

/** 日志/任务记录用：双区域一目了然（EI 验收⑥：日志可区分两区域）。 */
export function regionContext(env = process.env) {
  return { content: contentRegion(env), base: baseRegion(env), currency: baseCurrency(env) };
}
