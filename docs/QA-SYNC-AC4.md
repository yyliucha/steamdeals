# QA：同步可靠性批（AC-4 批，第 1 轮）

> 基线 c05b1d6 → HEAD e33ca08；判据 [docs/SYNC-FAILURE-MODES.md](SYNC-FAILURE-MODES.md) AC2/AC6/AC7 + [docs/TODO.md](TODO.md) AC 段；
> 开发描述来源：开发会话汇报（8d39d22 代码 + e33ca08 文档）。
> 结论：✅ 放行 —— 通过 10 / 缺失 0 / 偏差 0 / 需人工确认 2

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/接口/行为） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | AC-4 | 任务熔断状态在任务面板可见（「熔断至 时间」）——此前熔断 6 小时无人知晓 | 后台 → 同步与回填 | ✅ | AdminModules.vue（状态列 openUntil tag，AC11 面板已有 + 本批补按钮） |
| 2 | AC-4 | 管理员可一键「重置熔断」：清零失败计数与冷却，任务立即恢复可跑 | 后台 → 同步与回填 → 重置熔断 | ✅ | AdminModules.vue；server.js（POST /api/admin/circuit/reset）；scheduler.js（registerCircuitReset/resetCircuit）；test/scheduler.test.js:444 |
| 3 | AC-4 | Steam 429 冷却落盘跨子进程共享（任何子进程都尊重最早冷却，不再各睡各的 30 分钟） | data/steam-429.json（自动） | ✅ | http.js（readSteam429Until/writeSteam429Until + fetchText 合流）；test/http-error.test.js:200 |
| 4 | AC-4 | 报价解析结构校验：priceCents/title/region 缺失记 shape_mismatch 并跳过，字段改名不再静默变 null | 入库链路（ingest） | ✅ | ingest.js（rawOfferShapeIssue）；test/pg.test.js:368 |

## 逐条核对（规格验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | AC2 熔断在后台可见 | 面板「熔断至 X」tag（status 文件 failures/openUntil 已随 AC11 有，本批确认） | AdminModules.vue | ✅ |
| 2 | AC2 支持手动重置熔断 | 单测：钩子注册/命中清零/未命中 false/注销失效 | test/scheduler.test.js:444-457 | ✅ |
| 3 | AC2 重置走审计日志 | api.circuit_reset / scheduler.circuit_reset_manual | server.js / scheduler.js | ✅ |
| 4 | AC6 429 全局退避（不每进程各睡 30 分钟） | 单测：落盘读回未来冷却、过期视为无冷却、写过去不生效 | test/http-error.test.js:200-222 | ✅ |
| 5 | AC6 请求前合流内存+磁盘冷却 | fetchText effective429 = max(内存, 磁盘) | http.js | ✅ |
| 6 | AC6 文件原子写 + .gitignore | tmp→rename + data/steam-429.json 入 ignore | http.js / .gitignore | ✅ |
| 7 | AC7 关键字段缺失记 shape_mismatch | 单测：三条坏数据全跳过且不入库、事件带字段名 | test/pg.test.js:368-389 | ✅ |
| 8 | AC7 正常报价不受影响 | rawOfferShapeIssue(正常)=null + 全量回归 | test/pg.test.js | ✅ |
| 9 | npm test 全绿 + build + scan | 亲自重跑 | npm test 66 文件/542 项 fail 0；api 22；build ✓；scan 干净 | ✅ |
| 10 | 纪律：无新 tag / 无产物入提交 / 已推 main / OVERVIEW+DELIVERY 同步 | git 取证 | 无新 tag；origin/main=e33ca08 | ✅ |

## 亲自重跑验证（2026-11-09）

```
npm test               → 66 个文件 / pass 542 / fail 0
node test/api.test.js  → pass 22 / fail 0
npm run frontend:build → ✓
npm run scan           → ✅ 未发现高置信度凭据 / 未发现可疑密钥赋值
```

## 打回清单

无。

## 需人工确认

1. 后台「重置熔断」按钮在真机上的交互（无浏览器级测试，静态断言 + 构建通过为准）；
2. 真实 429 发生后多个任务进程对 `data/steam-429.json` 的读写表现（本地无法模拟真实 Steam 429）。

## 争议项

无。

## 复检记录

- 第 1 轮（2026-11-09）：初检即通过，无打回项。
