# QA：EM Steam 同步超时修复（第 1 轮）

> 基线 5ce2e50（EC 提交 ab7ba90 后）→ HEAD（worktree 分支 wt-228-srv，未提交）；判据 docs/STEAM-SYNC-TIMEOUT.md §3 验收；
> 开发描述来源：夜班监工派发（工人 2，worktree F:\dsh\gp-wt-228b）。
> 结论：✅ 放行 —— 通过 5 / 缺失 0 / 偏差 0 / 需人工确认 1

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | EL-1 | 单次 Steam 同步请求 8s 内失败并交给代理池切换（不再 30s 长等同一代理） | 服务端 fetchWishlist / fetchOwnedGames | ✅ | steam-login.js:230/253（timeoutMs: 8000）；test/steam-login.test.js EM 断言 |
| 2 | EL-2 | 点同步立即返回「已开始后台同步」（202），不再同步阻塞被 15s 看门狗砍掉 | POST /api/steam/accounts/:id/wishlist/sync、/library/sync | ✅ | routes/site.js:265-333；test/steam-accounts.test.js EM EL-2 |
| 3 | EL-2 | 同账号同步进行中重复触发返回「进行中」（single-flight） | 同上 | ✅ | routes/site.js:271（409「该账号正在同步中」）；测试断言 |
| 4 | EL-2 | 同步状态查询：idle/running + lastResult（进程内状态 + steam_account_logs 兜底） | GET /api/steam/accounts/:id/sync-status | ✅ | routes/site.js:172-217；测试含兜底分支 |
| 5 | EL-3 | 按钮「同步中…」→ 2s 轮询（≤60s）→ 完成刷新列表并提示结果；失败显示原因可重试 | 控制台 → Steam 账号（?section=steam） | ✅ | AdminExtras.vue syncSteam/pollSync/applySyncResult；test/frontend-registration.test.js EM EL-3 |
| 6 | EL-3 | 不再出现「请求超时，请稍后再试」笼统错误 | 同上 | ✅ | 前端断言 doesNotMatch；服务端错误文案带具体原因 |

## 逐条核对（规格验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | 单次 Steam 请求 8s 内失败并切换下一条（日志 http.proxy_switch 可见） | 源码断言 + http.js 既有代理池行为未动 | steam-login.js:230/253（timeoutMs: 8000, retries: 1 每次尝试走代理池轮换）；http.js 未改 | ✅ |
| 2 | 触发同步 → 立即返回「后台同步中」→ 轮询完成后列表更新（不再 15s 超时） | HTTP 测试：202 立即返回、轮询到 idle、任务结束 | test/steam-accounts.test.js EM EL-2（202 → 409 → 轮询 idle）；看门狗路径未豁免——接口立即返回不需要豁免（server.js isTimeoutExemptPath 未改） | ✅ |
| 3 | 后台显示同步结果/失败原因；重复触发返回「进行中」 | 测试断言 409 文案 + 前端 EL-3 断言 | routes/site.js:271/294；AdminExtras.vue applySyncResult（同步失败：原因）；test/frontend-registration.test.js | ✅ |
| 4 | 正常网络下单账号愿望单同步成功率与改造前一致 | 代码核对：同步逻辑（syncAccountWishlist/Library）未动，只改了触发方式 | routes/site.js 后台任务体与原同步块逐字段一致（含类型补全/缓存失效） | 🔎 见下 |
| 5 | npm test（分段）+ frontend:build + scan 全绿；无 schema 变更 | 亲自重跑 | steam-login 7/7、steam-accounts 16/16、frontend-registration 6/6、api 38/38；build ✓ 7.36s；scan ✅；无迁移改动 | ✅ |

## 打回清单

无。

## 需人工确认

- 正常网络下真实愿望单/游戏库同步成功率（本地无 Steam 出口，测试走「失败路径」验证；成功路径逻辑未动，上线后目视一次同步结果即可）。

## 争议项

无。

## 复检记录

- 第 1 轮（2026-11-20）：开发自测发现 sync-status 路由初始实现未按 site 域契约返回 true（404 双写头），修复后重跑全绿。

## 备注

- TODO 状态由监工统一回写（夜班工人不改 docs/TODO.md 及任何共用文档，监工指令例外）。
- server.js 看门狗豁免名单（isTimeoutExemptPath）未改——EL-2 触发接口立即返回 202，无豁免需求（监工提示的「如需调整再动并注明」按不需调整处理）。
- 本报告在 worktree 内（F:\dsh\gp-wt-228b\docs\QA-EM.md），与主树隔离。

## 验证输出（QA 亲自重跑）

- `node test/steam-login.test.js` → 7/7 绿（EL-1 超时 8s 锁）
- `node test/steam-accounts.test.js` → 16/16 绿（EL-2 触发/single-flight/状态流转/日志兜底）
- `node test/frontend-registration.test.js` → 6/6 绿（EL-3 前端锁）
- `node test/api.test.js` → 38/38 绿（动过 API 必跑）
- `npm run frontend:build` → ✓ built in 7.36s
- `npm run scan` → ✅ 未发现高置信度凭据
