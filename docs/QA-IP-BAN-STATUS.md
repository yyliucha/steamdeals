# QA：BI 批（IP 统计自动临时封禁显示与状态筛选）

> 基线 `c318c5c` → HEAD `be91c43`。
> 判据：`docs/VISIT-IP-STATS.md` §8（验收 8–11）。
> 结论：**✅ 放行 —— 通过 9 / 缺失 0 / 偏差 0 / 需人工确认 2**

## 功能清单（本批交付的全部功能，一条一行）

| # | 功能（用户视角） | 入口（页面/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|
| 1 | IP 统计状态扩展为四态：已封禁 / 封禁中 / 被拦截 / 正常 | 访问记录 → 访问明细 → IP 统计 | ✅ | `pg.js`（`listVisitorsByIp` 状态 case）；`AdminModules.vue` 状态列 |
| 2 | 「封禁中」显示自动封禁剩余时间（`m:ss`；超过 1 小时显示 `h 小时 m 分`） | 同上，状态列 | ✅ | `AdminModules.vue`（`banLeft(row)` + `封禁中 · `） |
| 3 | 手动黑名单优先：同时命中黑名单与自动封禁时显示「已封禁」 | 同上 | ✅ | `pg.js` 状态优先级；测试「黑名单优先」 |
| 4 | 自动封禁到期后自动回落「被拦截/正常」，不留「封禁中」 | 同上 | ✅ | 测试：把 `banned_until` 改成过去 → `intercepted`、`ban_until=null` |
| 5 | 状态筛选：全部 / 正常 / 被拦截 / 封禁中 / 已封禁 | IP 统计筛选栏 | ✅ | `AdminModules.vue`（`ipStatus` + 5 个选项）；`server.js` 白名单 |
| 6 | 筛选与时间窗 1/7/30、分页、IP 关键词叠加生效 | 同上 | ✅ | SQL 在分页前过滤 CTE；测试 `status=banned` 只回该 IP |
| 7 | 接口返回 `ban_until` / `ban_source`（自动封禁到期时间与来源） | `GET /api/admin/visitors/by-ip` | ✅ | `pg.js`（子查询取 `ip_abuse`）；测试断言 `ban_source='rate'` |
| 8 | 参数白名单：`status` 非法值回落 `all`，不拼接用户输入 | API | ✅ | `server.js`（`['normal','intercepted','banned','blocked']`）；测试 `status=evil` → `all` |
| 9 | 移动端 IP 卡片同口径（封禁中 + 剩余时间、四态标签） | 后台移动端 | ✅ | `AdminModules.vue` 移动卡片（与桌面同一表达式） |

## 逐条核对（规格 §8 验收）

| # | 条目 | 检查手段 | 证据 | 判定 |
|---|---|---|---|---|
| 1 | §8-8 未过期 `banned_until` → 「封禁中」+ 剩余时间；到期回落 | 真 DB + 单测 | `ip_abuse` 未来时间 → `banned`、`ban_until` 有值；改过去 → `intercepted`、`ban_until=null` | ✅ |
| 2 | §8-9 黑名单与自动封禁同时命中 → 「已封禁」 | 真 DB | 插入黑名单后状态 `blocked`，`status=banned` 查询为 0 | ✅ |
| 3 | §8-10 `status=banned/blocked` 只返回对应 IP，且与时间窗/分页/关键词叠加 | 真 HTTP + SQL | `banned` 只回被封 IP；`intercepted` 不含它；CTE 先过滤后分页 | ✅ |
| 4 | §8-11 `npm test` / `frontend:build` / `scan` 全绿 | 亲自跑 | 见下「验证」 | ✅ |

## 亲自重跑的验证

| 命令 | 关键输出 | 结论 |
|---|---|---|
| `npm test` | **79 个文件 / 629 项 / `# fail 0`**，`EXIT=0` | ✅ |
| `node test/api.test.js` | `# tests 22 / # pass 22 / # fail 0` | ✅ |
| `node test/visitors.test.js` | 8/8 | ✅ |
| `node test/admin-bulk.test.js` | 13/13 | ✅ |
| `npm run frontend:build` | `✓ built in 1.17s` | ✅ |
| `npm run scan` | 未发现高置信度凭据 / 可疑密钥赋值 | ✅ |
| `npm run todo:progress:check` | 与 TODO 一致 | ✅ |
| `node test/docs.test.js` | 5/5 无断链 | ✅ |

## 风险提醒（不判错）

1. 剩余时间在列表加载/翻页时计算一次，不逐秒刷新；要刷新可点「刷新」或切时间窗重新加载。
2. 自动封禁来源 `ban_source` 已返回但前端未展示（规格只要求返回；排障可看接口/SQL）。
3. 封禁到期后状态回落依赖服务端 `now()`；前端不做本地倒计时。

## 需人工确认（2）

1. 「封禁中 · 剩余 m:ss」在 1440×900 与移动端的排版（长 IP + 长地区名是否会挤压状态列）。
2. 生产上真实三振封禁出现时，状态列与筛选的实际联动（可用 `ip_abuse` 手工造一条未过期记录验证）。

## 复检记录

- 第 1 轮（2026-11-11）：功能 9 条、验收 4 条逐条核对；`npm test`（79 文件 / 629 项）/ `api.test` / `build` / `scan` 全绿 → ✅ 放行。
