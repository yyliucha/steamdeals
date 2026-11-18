# QA：BR 封禁自助恢复 + 手机/CGNAT 适配（第 1 轮）

> 基线 `3087c1f` → HEAD `edcaaa7`（b8ee317 实现 + e7c1c17 状态补哈希 + edcaaa7 验收级断言补充）；
> 判据 [BAN-AND-SECURITY-FIXES.md](BAN-AND-SECURITY-FIXES.md) §11.7 验收 1–6；
> 开发描述来源：TODO.md 的 BR 条目 + 开发会话开场指令（2026-11-13）。
> 结论：✅ 放行 —— 通过 6 / 缺失 0 / 偏差 0 / 需人工确认 1

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | BR | 页面与 API 独立限流桶：正常刷页面 120 次/分钟才触发，API 150 次/分钟独立判定，图片资源 300 次/分钟 | 所有请求（服务端分桶） | ✅ | src/ratelimit.js:25-26、303-305；src/server.js:610 |
| 2 | BR | 封禁期内继续浏览页面/图片不会把封禁越刷越长（升级只累计 API） | 被封期间访问站点 | ✅ | src/ratelimit.js:282；test/ratelimit.test.js（BR 桶与升级用例） |
| 3 | BR | 纯 API 高频仍会被拦截并按 10 分钟 → 30 分钟 → 当天 0 点三振升级 | 脚本/接口调用 | ✅ | test/reviews.test.js「超频三振」「纯 API 高频仍会被拦并升级」 |
| 4 | BR | 限流阈值可后台调整（安全与限流分组），保存即热加载 | 系统设置 → 安全与限流 | ✅ | src/settings.js:164-175、217；src/settings-routes.js:33-37、src/server.js:968 |
| 5 | BR | 封禁自查：`GET /api/ban/state` 返回自己的 `ip` / `whitelisted` / `until` | /api/ban/state | ✅ | src/server.js:573；test/reviews.test.js「只读、豁免拦截链、IP/白名单口径」 |
| 6 | BR | 管理员加白即清封：不重启立即恢复，响应回 `clearedBan`，控制台提示 | 后台 → 封禁与白名单 → 信任 | ✅ | src/server.js:3527-3532、3136-3137；AdminModules.vue:412；test/reviews.test.js「BR：加白即清封」 |
| 7 | BR | 封禁页可读：显示「约 X 分钟后恢复」+ 脱敏 IP（1.2.3.x）+ 保留申诉入口 | 封禁页 /banned | ✅ | src/server.js:436-439、141；BanPage.vue:22-27、49；test/reviews.test.js「封禁页 payload」 |

## 逐条核对（规格 §11.7 验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | 封禁页显示"约 X 分钟后恢复"与脱敏 IP；`/api/ban/state` 返回 `ip`/`whitelisted`/`until` | grep + HTTP 实测 | server.js:573（三件套）、436-439（remainingSec/ipMasked 注入）、141（payload）；BanPage.vue:22-27、49；visitors.js:79（maskIpForDisplay）；reviews.test.js 封禁页 payload 断言 | ✅ |
| 2 | 加白 → 不重启立即恢复；`clearedBan:true`；`/api/ban/state` 变 `banned:false, whitelisted:true` | HTTP 实测 | server.js:3527-3532；reviews.test.js「BR：加白即清封」断言 deepEqual `{banned:false,ip,whitelisted:true}` + 200 恢复 | ✅ |
| 3 | 白名单 IP 封禁期内刷新不升级（页面 GET 不计升级） | 单测 | ratelimit.js:282（`bucket==='api'` 才累计）；ratelimit.test.js「封禁期内只有 API 请求累计升级，页面/资源刷不升级」 | ✅ |
| 4 | 手机连刷首页 20 次不误封；纯 API 高频仍被拦 | 单测 + HTTP 实测 | ratelimit.test.js「默认阈值下 20 次页面刷新不触发封禁」；reviews.test.js「BR：纯 API 高频仍会被拦并升级」 | ✅（真机目视 🔎，见下） |
| 5 | 三振升级仍有效（API 超限 → 10 → 30 → 当天）；黑名单/设备封语义不变 | 单测 + HTTP 实测 | ratelimit.test.js 第 1 条（API 桶三振）；reviews.test.js「超频三振」全链路；黑名单/设备测试（BJ 批断言）原样全绿 | ✅ |
| 6 | `npm test` 全绿 + `frontend:build` 通过 + `scan` 干净；不自行构建 | 重跑 | `npm test` → 84 个测试文件、0 fail、exit 0；`npm run frontend:build` → ✓ built in 955ms；`npm run scan` → ✅ 未发现高置信度凭据；`git tag --list` 无新增 tag | ✅ |

## 打回清单

无。

## 需人工确认

- 条目 4 的「手机真实连刷 20 次」与条目 1 的「封禁页手机目视」：本地无浏览器/真机，只能通过注入 payload 的 HTTP 断言 + 前端静态断言（BanPage 绑定 `remainingText`/`ipMasked`）锁定；部署后按规格 §11.7 在手机上目视复核一次即可。

## 风险提醒（查多，不判错）

- 5 个 compose 文件与 README 的环境变量更名：`RATE_LIMIT_MAX` 不再被读取，改为 `RATE_LIMIT_PAGE_MAX`/`RATE_LIMIT_API_MAX`（默认 120/150）。若生产 compose 显式设置过 `RATE_LIMIT_MAX`，升级后该值失效，需改用新变量或「系统设置 → 安全与限流」页调整——部署侧留意。
- 改动触碰部署配置（compose）属于规格 §11.3「阈值走设置项」的必要配套，非越界改动。

## 争议项（待所有者裁定）

- 规格 §11.3「升级只计 API / 非法路径」与 §11.4「升级只对非 page 请求累加」文字冲突（资源桶算不算）。实现按 §11.2/§11.3 收敛为「只计 API」：资源请求不计（否则封禁页自身的图片会把手机用户刷成当天封，与本批初衷矛盾）；非法路径也不计 blockedHits（沿用 BJ 批「路径封禁不升级」先例，扫描器噪声不升级共享出口封禁，且 guard 审核 + 每轮三振兜底仍在）。如所有者认为非法路径必须计入升级，改 ratelimit.js:282 一处即可。

## 复检记录

- 第 1 轮（2026-11-14）：基线 3087c1f → HEAD edcaaa7，逐条取证 + 亲自重跑三项验证 → ✅ 放行。
