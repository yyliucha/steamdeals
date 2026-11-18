# QA：CL 用户级到价提醒（详情三段式 + 已拥有终态 + 列表页 + 后台全站清单）（第 1 轮）

> 基线 e196382（feat(alert): CL 批，v2.22.1 之后）；判据 = [USER-ALERTS.md](USER-ALERTS.md) §9 验收 8 条 + §9.1 demo 对照表 +
> 所有者 5 条验收要点（TODO CL 条目）。结论：✅ 放行 —— 通过 8 / 缺失 0 / 偏差 0 / 需人工确认 2

## 功能清单（本批全部功能，一条一行）

| # | 功能（用户视角） | 入口 | 状态 | 证据 |
|---|---|---|---|---|
| 1 | 详情页「到价提醒」区块：参考行（当前价·史低）+ ¥ 输入框（留空=史低提醒）+「按史低」「减 10%」快捷按钮 + 保存 | 游戏详情弹窗（登录） | ✅ | Home.vue alert-block 区块；serve 详情带 `watch` 字段；watchlist-user HTTP 用例「A 加提醒 200」 |
| 2 | 已设置状态：绿色 pill「提醒中 ¥X」+「取消提醒」；未设置时不显示取消 | 同上 | ✅ | Home.vue `v-if="watchExists"` 分支；openDetail 从 detail.watch 回显 |
| 3 | 「到价提醒」列表页：桌面顶部 tab + 移动「提醒」入口；游戏名可点开详情、目标/当前/史低/加入时间、取消即移除、分页 20、空态引导 | Home（登录） | ✅ | Home.vue watchlist 区块（PC + 移动）、loadWatchList/cancelWatchFromList；`GET /api/watchlist` |
| 4 | 用户隔离：A 看不到/删不掉 B 的提醒 | 接口 | ✅ | deleteUserWatch 只删 user_id 匹配；watchlist-user HTTP 用例「B 删 A → removed 0、B 列表为空」 |
| 5 | 已拥有终态：显示「✓ 已拥有 · 全部账号名」，只保留「去 Steam 商店」；感兴趣/不感兴趣/愿望单/到价提醒/复制名全部不渲染；管理员同样遵守 | 详情弹窗（拥有者） | ✅ | EFFECTIVE_OWNED_SQL 只认 steam_games 并集；Home.vue owned 分支只渲染 owned-final + 商店按钮；copy-row/两处底栏均按 owned 门控 |
| 6 | 数据联动：Steam 库同步发现已拥有 → 自动删除该用户该游戏的愿望单行与到价提醒行 | steam-accounts 同步 | ✅ | syncAccountLibrary 清理段（user_wishlist + watchlist，幂等 delete） |
| 7 | 降价邮件收件人 = 用户本人邮箱；同用户多游戏合并一封；无邮箱跳过并记日志；站点级（NULL）行为不变 | alerts 任务 | ✅ | groupAlertsByUser + cmdAlerts 用户组 email channel（to=本人邮箱）+ `alert.skipped_no_email`；siteHits 走原全通道 |
| 8 | 后台「到价提醒」全站清单：分页 + 用户名筛选 + 删除确认；删除有审计 | 后台新 section | ✅ | AdminModules.vue watchlist section + Console 菜单；`GET /api/admin/watchlist` 分页/筛选、`DELETE /:id` 记 `api.watch_deleted`（HTTP 用例断言 403/筛选/删除/404） |

## 验收逐条核对（§9 + 所有者要点）

| # | 验收点 | 判定 | 证据 |
|---|---|---|---|
| 1 | 未拥有默认：三段式可加/删提醒；不再有「已拥有」按钮；管理员与普通用户一致 | ✅ | 旧 detail-actions（含 toggleOwned 按钮）与 admin watch 区块已整体替换；PC detail-actions 与移动 m-detail-bar 均无 owned 按钮（grep 确认）；三段式 = buy-row / detail-chips / alert-block |
| 2 | 已拥有终态：Steam 库并集判定、显示全部账号、其余全隐藏、管理员同 | ✅ | EFFECTIVE_OWNED_SQL（games 并集，user_game_flags.owned 不再参与）；owned_by 全量账号；owned 分支只留「去 Steam 商店」；前端不区分 role |
| 3 | 用户隔离：A 看不到/删不掉 B；后台可见全部 | ✅ | HTTP 用例真跑（removed 0 / 列表隔离 / admin 全站） |
| 4 | 提醒评估：收件人=本人邮箱、同用户合并一封、无邮箱跳过记日志、站点级不变 | ✅ | groupAlertsByUser 纯函数用例（分组/邮箱透传/升序稳定）；cmdAlerts 分组投递（email to 覆盖 + skipped_no_email）；siteHits 分支保持原 deliver(channels) |
| 5 | 后台清单可分页/筛选/删除、审计 | ✅ | listAllWatchesAdmin（total/username ilike）+ HTTP 用例（筛选 total=1、删除 200、不存在 404）；server 记 `api.watch_deleted` |
| 6 | 迁移幂等：migrate 两次不报错；旧站点级数据保留行为不变 | ✅ | watchlist-user 测试 1（二次 migrate + 索引/列断言 + 旧约束已删）；两级并存测试 3（站点级函数只碰 NULL 行）；steam-accounts ON CONFLICT 部分索引适配后旧用例全绿 |
| 7 | npm test / frontend:build / scan 全绿 | ✅ | 本会话权威跑 `npm test` EXIT=0（含 watchlist-user 8 项进主链）；QA 重跑 watchlist-user/steam-accounts/serve/api 均 fail 0；frontend:build ✓；scan ✅ |
| 8 | demo 一致（§9.1 对照表）：三段式 / chips 选中态 / 参考行 / 按史低=史低、减 10%=当前×0.9 取整分 / 未设置无取消 / 提醒中 pill / 移动折叠 / 已拥有隐藏 | ✅ | Home.vue：`.detail-chip.on` 选中态（✓ + 淡色底）、ref 行（当前·史低）、setWatchHistLow=hist_low/100、setWatchDiscount10=Math.floor(current×0.9)/100、watchExists 才渲染取消、`.watch-pill` 绿 pill、isMobile 折叠行「🔔 到价提醒 · 提醒中 ¥X · 调整 ▾」（watchOpen 展开）、owned 分支全隐藏；§9.1 静态断言由 frontend 编译 + QA 代码核对面覆盖 |

## 四方一致检查

- **数据层**：迁移 5 条幂等 ALTERS；upsert/delete/list/get 用户级 + admin 全站；站点级函数全部加 `user_id is null` 口径 ✓
- **接口层**：`/api/watchlist` 三方法 requireUser + 写 30 次/分限流 + 参数校验（400/404）；详情两端点带 watch；`/api/me` 带本人 email ✓
- **投递层**：groupAlertsByUser 纯函数 + cmdAlerts 分组；无邮箱 skip 不 mark（下轮重试）✓
- **前端**：三段式/终态/列表 tab/移动折叠 + 后台 section，构建通过 ✓
- **测试**：watchlist-user.test.js 8 项锁行为（迁移幂等/CRUD/两级并存/隔离/后台/分组/HTTP 语义）；steam-accounts 口径用例更新 ✓
- **文档**：USER-ALERTS.md 状态已实现待发版、PROJECT-OVERVIEW CL 行、TODO CL 已实现待发版 ✓

## 纪律项

- 无新增 tag ✅；提交只含本批文件（未带入 ce-dev 未提交的 DELIVERY/E2E/package.json e2e hunk）✅；QA 报告默认不入库（待发版收尾再定）✅

## 需人工确认（部署后）

1. **UI 目视（R2）**：详情页三段式与 `docs/design/detail-actions-2026-11-17.html` 逐屏对照（桌面 + 移动折叠态 + 已拥有终态），移动端 chips 横向滚动；
2. **邮件实发**：绑邮箱账号设置目标价 → 调度 `alerts --mark` 观察：收件人=本人邮箱、同用户多游戏合并一封、无邮箱用户日志 `alert.skipped_no_email`、站点级企业微信通道不变。

## 复检记录

- 第 1 轮（2026-11-17）：e196382，放行 ✅。
