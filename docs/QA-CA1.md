# QA：CA-1 站点侧（App Token 认证 + /api/app/* 前缀重写）（第 1 轮）

> 基线 ff36628（契约冻结）→ HEAD 0483ef0；判据 [APP-API.md](APP-API.md)（App 唯一口径）+ [APP-NATIVE.md](APP-NATIVE.md) §3 + CA 条目验收；
> 本轮只判 **CA-1 子批**（CA 条目保持「开发中」，CA-5/CG 不在范围）。
> 结论：✅ 放行 —— 通过 12 / 缺失 0 / 偏差 0 / 需人工确认 1

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（App 调用） | 状态 | 证据 |
|---|---|---|---|---|---|
| 1 | CA-1 | App 用用户名+密码+图形验证码登录拿 Token（rememberMe 30 天 / 默认 7 天） | `POST /api/app/auth/token` | ✅ | src/server.js:1179+；test/api.test.js（生命周期 7/30 天断言） |
| 2 | CA-1 | App 退出登录撤销 Token（撤销后立即失效） | `POST /api/app/auth/token/revoke` | ✅ | src/server.js:1244；api.test.js 撤销后 401 断言 |
| 3 | CA-1 | App 只调 `/api/app/*`，服务端透明重写为 `/api/*`（latest/status 精确例外） | 全部 App 请求 | ✅ | src/server.js:555-560（前缀重写）；api.test.js `/api/app/games` 重写断言 |
| 4 | CA-1 | App 启动检查封禁状态（IP 黑名单→设备封禁，返回 `{banned,type,until}`） | `GET /api/app/status` | ✅ | src/server.js:674-695；api.test.js 黑名单 IP 下 status 返回 type=ip 且自身不被拦 |
| 5 | CA-1 | 被封的 IP/设备调 App 接口不被拦（豁免只对 /api/app/*，Web /api/* 不变） | 全部 App 请求 | ✅ | src/server.js:685/705（!appNamespace 豁免）；api.test.js：App 200 vs Web /api/me 403 对照 |
| 6 | CA-1 | 用户接口用 Bearer；过期/撤销/禁用 → 401 `login_required`（App 弹登录） | `/api/app/me`、`/api/app/prefs` 等 | ✅ | src/server.js:1316（requireUser）；api.test.js 三态 401 断言 |
| 7 | CA-1 | 公开接口匿名可调（首页/详情/计数/公告/验证码） | `/api/app/games` 等 | ✅ | api.test.js 匿名列表/详情 200 + 重写路径 200 |
| 8 | CA-1 | Token 只存 sha256 哈希，签发/撤销有审计（auth.token_issued/revoked，不含明文） | 服务端行为 | ✅ | src/store/pg.js:2241（哈希落库）；api.test.js 明文查不到 + 哈希查得到；app-token.test.js 审计断言 |
| 9 | CA-1 | 登录限流/账号锁定与 Web 完全一致（IP 20 次/15 分钟 429、账号 5 次锁 15 分钟） | 登录接口 | ✅ | src/server.js:1179+ 共用 loginIpFails/failed_login_count；api.test.js 5 次锁定 429 断言 |
| 10 | CA-1 | 验证码必填（缺/错 400，不消耗密码尝试次数） | 登录接口 | ✅ | src/server.js:1187-1192；api.test.js 缺/错验证码 400 断言 |
| 11 | CA-1 | `/api/app/latest` 沿用现有清单接口（versionCode/minVersionCode/notes 已在 latest.json 与响应中） | `GET /api/app/latest` | ✅ | src/server.js:1715-1736 响应含全部字段；frontend/public/app/latest.json 字段齐全 |
| 12 | CA-1 | 基础限流对 /api/app/* 仍生效（滥用 429，不算封禁） | 服务端行为 | ✅ | src/server.js:716-724 限流分支无 appNamespace 豁免；app-token.test.js 静态断言 |

## 逐条核对（契约/验收 → 证据）

| # | 条目 | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | api_tokens 表：token_hash 唯一、expires/revoked/last_used、级联删 | grep DDL | src/store/pg.js:394-406（API_TOKENS_DDL）+ :495（migrate 幂等执行） | ✅ |
| 2 | 签发只存哈希（明文只在响应出现一次） | grep + 运行时 | src/store/pg.js:2241-2250（insertApiToken 哈希入参）；api.test.js 明文查不到 | ✅ |
| 3 | POST /api/auth/token：验证码必填、限流/锁定与 web 一致 | 读代码 + 跑 | src/server.js:1179-1242（captcha 先行、共用 loginIpFails、共用 failed_login_count/locked_until） | ✅ |
| 4 | POST /api/auth/token/revoke：撤销当前 Bearer | 读代码 + 跑 | src/server.js:1244-1249；api.test.js 撤销后 prefs 401 | ✅ |
| 5 | GET /api/me 支持 Bearer（先 Bearer 后 Cookie） | 读代码 + 跑 | src/server.js:1170-1185（bearer 优先）；api.test.js /api/me Bearer 返回 alice | ✅ |
| 6 | /api/app/* 前缀重写（例外 latest/status），豁免黑名单/设备封禁，保留基础限流 | 读拦截链 + 跑 | src/server.js:555-560（重写）、:685/:705（豁免）、:716-724（限流不豁免）；api.test.js 黑名单对照 | ✅ |
| 7 | GET /api/app/status：IP 黑名单→设备封禁顺序，返回 {banned,type,until}，无副作用 | 读代码 + 跑 | src/server.js:674-695；api.test.js type=ip 断言 | ✅ |
| 8 | 未登录/Token 失效统一 401 { error: 'login_required' }；公开接口匿名可调 | 读 requireUser + 跑 | src/server.js:1316；api.test.js 匿名 401 需要登录（Web 不变）/坏 Bearer login_required | ✅ |
| 9 | 审计 auth.token_issued/revoked，不记明文 | grep | src/server.js:1233/1247；app-token.test.js「审计日志不能带明文 token」 | ✅ |
| 10 | HTTPS 强制 | grep | 站点层由反向代理终止 TLS（compose/DEPLOY 口径）；本批无服务端跳转逻辑——见「需人工确认」 | 🔎 |
| 11 | 契约文档 docs/APP-API.md 产出且与实现一致 | 读 + 断言 | docs/APP-API.md（前缀重写/401/限流/状态响应均与代码一致）；test/app-token.test.js:62 锁文档存在 | ✅ |
| 12 | npm test / frontend:build / scan 全绿 | 亲自重跑 | npm test 89 文件 0 fail（NPM_EXIT=0）；api.test.js 26/26；frontend:build ✓ 12.73s；scan 干净 | ✅ |

## 四方一致检查

- **后端**：pg.js 表+函数 ↔ server.js 消费（insertApiToken/userByApiToken/revokeApiToken/touchApiToken 全部引用）✅
- **前端**：本批无前端改动（CA-5 Web 改造不属 CA-1；App 前端在 CG 仓库）——不适用 ✅
- **测试**：主链 app-token.test.js 7 项锁结构与豁免语义；api.test.js 4 项真跑生命周期（签发/过期/撤销/禁用/锁定/验证码/黑名单豁免/401 语义）——「真锁住」而非只看全绿 ✅
- **文档**：APP-API.md（契约）、APP-NATIVE.md §3 状态行、PROJECT-OVERVIEW CA 行、TODO 进度行、INDEX 行均已同步 ✅

## 纪律项

- `git tag --list`：无新增 tag ✅
- diff 未碰部署/服务器配置/凭据 ✅（10 文件全为代码/测试/文档）
- 构建产物未进提交（frontend/dist、*.log 均未 add）✅
- 已推 main（0483ef0）✅
- 状态回写：CA 条目保持「开发中」（用户指令：CA-1 完成后不标已实现）+ 进度行已写 ✅

## 需人工确认

- **HTTPS 强制**：站点 TLS 由反向代理终止（部署层），CA-1 服务端不新增跳转逻辑；上线后确认 App 只配 https Base 即可。
- **X-Client / X-App-Version 头**：契约注明「用于日志/排查，不参与鉴权」，本批未实现采集（无功能影响）；如需要可在 CG 联调时补日志。

## 复检记录

- 第 1 轮（2026-11-17）：✅ 放行。
