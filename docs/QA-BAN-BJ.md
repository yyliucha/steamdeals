# QA：BJ 批（黑名单 IP 不再写入自动封禁 + 自动封禁记录口径 + 解封语义拆分）——第 1 轮

> 基线 `b507df4` → 交付 `9bc665e`；判据：[BAN-AND-SECURITY-FIXES.md](BAN-AND-SECURITY-FIXES.md) §10.3（15 项决策）、§10.6（验收）、§10.8（不做项）。
> 结论：**✅ 放行 —— 通过 15 / 缺失 0 / 偏差 0 / 需人工确认 3**

## 功能清单（用户视角，供所有者验收）

| # | 功能（用户能感知到的一条 = 一行） |
|---|---|
| 1 | 黑名单里的 IP 访问网站一律立刻 403（不再先被限流计数、打满 60 次后变 429） |
| 2 | 黑名单 IP 的访问不再产生新的自动封禁记录，也不再产生新的「异常请求」待审核 |
| 3 | 黑名单 IP 的拦截日志仍保留（同 IP 每分钟最多 1 条，可审计） |
| 4 | 后台「自动封禁记录」默认只显示还在生效的条目，已过期的不再刷屏 |
| 5 | 自动封禁列表新增「生效中 / 已过期 / 全部」筛选 |
| 6 | 自动封禁列表新增「状态」列（生效中 / 已过期 / 仅计数） |
| 7 | 自动封禁列表里，凡命中黑名单（含 CIDR 网段）的 IP 都标注红色「已在黑名单」tag，悬停可看命中的条目与备注；移出黑名单后 tag 消失 |
| 8 | 自动封禁页的解封按钮区分语义：「解除封禁」（生效中）与「清除记录」（已过期/仅计数），并弹确认框说明「不会移除 IP 黑名单」 |
| 9 | 黑名单页解封弹确认框说明「不会恢复该 IP 的自动封禁记录」；批量动作统一改名「解除临时封禁」 |
| 10 | 审核通过封 IP / 手动封 IP / 批量封 IP 时，该 IP 的临时封禁立即失效（记录行保留做审计） |
| 11 | 存量数据自动修复：升级后「已被黑名单覆盖」的旧临时封禁记录自动清空封禁时间（行保留） |
| 12 | 自动封禁记录保留 90 天，超期由现有清理任务自动删除（不再是永久堆积） |

## 逐条核对（§10.6 验收 + §10.3 决策）

| # | 验收/决策 | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | A1 拦截链黑名单前置；200 次全 403 无 429 | HTTP 真跑 | test/admin-bulk.test.js「BJ：黑名单 IP 连续 200 次…」 | ✅ |
| 2 | A1 命中不写 ip_abuse / 不写 abuse_reviews | 同上用例断言 | 同上（abuse=0 / pending=0） | ✅ |
| 3 | A1 采样拦截日志保留且 ≤1 条/分钟 | 同上用例断言 | 同上（blocked 1–2 条/200 次） | ✅ |
| 4 | A1 白名单/管理员/内网/申诉页/静态资源豁免不变 | 只换序未动分支 + 全链回归 | src/server.js 拦截链；appeal/ratelimit/visitors 全绿 | ✅ |
| 5 | B1 默认只列生效中 + 状态列三态 | 单测 + 静态断言 | visitors.test.js「listAbuse 三种 status」；bj-abuse-views.test.js | ✅ |
| 6 | B1 状态筛选透传 | 静态断言 | bj-abuse-views.test.js「status=${abuseFilter.value}」 | ✅ |
| 7 | B1 「已在黑名单」含 CIDR 覆盖 + 删后消失 | HTTP 真跑 | admin-bulk.test.js「逐行标注已在黑名单（含 CIDR 覆盖）…」 | ✅ |
| 8 | C1 自动封禁解封只清 ip_abuse、黑名单仍在且 IP 仍 403 | HTTP 真跑 | admin-bulk.test.js「批量 abuse/unban…」 | ✅ |
| 9 | C1 黑名单解封不动 ip_abuse；批量同口径 | HTTP 真跑 | admin-bulk.test.js「批量 blacklist/unban…」 | ✅ |
| 10 | D1 审核通过/手动封/批量封清 banned_until 且行保留 | HTTP 真跑 | reviews.test.js「管理员审批…」+ admin-bulk「批量 abuse/unban」前半 | ✅ |
| 11 | H1 迁移幂等（第二次清 0 行） | 单测 | visitors.test.js「clearAbuseBan…迁移幂等」 | ✅ |
| 12 | H1 prune 只删 90 天前过期/仅计数行 | 单测 | visitors.test.js「purgeOldRows 自动封禁保留期…」 | ✅ |
| 13 | 权限 401/403 与审计/批量回执 | HTTP 真跑（复用既有守卫） | admin-bulk.test.js 17 项全绿 | ✅ |
| 14 | 不做项：三振阈值/设备封禁/白名单逻辑/死代码不动 | diff 审计 | ratelimit.js DEFAULTS 未动；setBanUntil/applyExternalBan 仍在 | ✅ |
| 15 | 全链验证 | 命令输出 | `npm test` 77 个文件 EXIT=0 / `frontend:build` ✓ / `scan` 干净 | ✅ |

## 需人工确认（🔎，部署后执行）

1. **生产行为（§10.7 三条只读 SQL）**：部署后确认黑名单 IP 的 `ip_abuse.updated_at` 24 小时不变（不再被计数）、「生效中」为空、存量被覆盖行的 `banned_until` 已清。
2. **前端真实交互**：筛选切换/确认框/按钮文案在真浏览器点一遍（本地仅静态断言 + build）。
3. **审计事件字段**：`api.abuse_unbanned` 日志带 `removed/wasActive/blacklistKept`（目检，生产日志验证）。

## 复检记录

第 1 轮（2026-11-11）：✅ 放行（3 项转部署后验收）。
