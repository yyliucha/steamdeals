# 价格提醒史低误报修复（FM，待开发，2026-11-24）

> 所有者反馈（2026-11-24 邮件截图）：「新史低 ¥349.00 史低 ¥349.00」——价格和史低一样却标「新史低」；
> 要求：价格和原价一样（未降价）时不要显示史低。

## 1. 根因（代码证据）

- `src/store/pg.js` 的 `watchCandidates`：`hist_low = min(daily_prices.min_price_cents)`——**日聚合含当天**，
  当天价格本身就是史低 → `current == hist_low` **恒成立**；
- `src/alerts.js` 的 `evaluateAlerts`：无 target 时 `current <= hist` → `reason = hist_low`（**恒触发**）；
- `src/alerts-html.js`：`REASON_LABEL.hist_low = '新史低'` + 恒显示「史低 ¥X」→ 邮件出现「新史低 349 史低 349」。

## 2. 修复口径

1. **hist_low 改为「今天以前」**：`watchCandidates` 的日聚合加 `d.day < current_date`（Asia/Shanghai 日历日）——
   这样 `hist_low` = 昨天及以前的史低；
2. **判定**（`evaluateAlerts`）：
   - `current < hist_low` → `reason=hist_low`，标签 **「新史低」**（真跌破）；
   - `current == hist_low`（平了之前最低）→ 标签 **「跌至史低」**（仍提醒，但不叫「新」）；
   - `current > hist_low` → 不提醒（无 target 时）；
3. **模板去重**（`alerts-html.js`）：
   - 「史低 ¥X」仅当 `currentCents !== histLowCents` 时显示（相同就不重复）；
   - 标签按判定区分（新史低 / 跌至史低）；
4. **未降价不显示史低**：`current >= 原价`（若行内有原价字段——from offers.original_price_cents；没有则按 `current == hist_low` 处理）时，
   模板不显示史低段（需在 watchCandidates 补 `original_cents`，取当前最低价对应的 offers.original_price_cents）。

## 3. 验收

1. 无 target 的提醒：**只有当前价跌破「昨天以前史低」才标「新史低」**；平低标「跌至史低」；否则不提醒；
2. 邮件不再出现「新史低 ¥X 史低 ¥X」（相同价不重复显示史低）；
3. 价格=原价（无折扣）时邮件不显示史低段；
4. 有 target 的提醒行为不变（达到目标价触发，标签「达到目标价」）；
5. `node --test test/alerts.test.js test/alerts-html.test.js` + `npm test`（分段）全绿；邮件 HTML 样例核对。
