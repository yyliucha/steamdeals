# QA：Steam 代理池后端（AM-1 批，第 1 轮）

> 基线 0f3c4f1 → HEAD cb33cf2；判据 [docs/PROXY-POOL.md](PROXY-POOL.md) §3.1/§4.1–4.5/§6/§7 验收 1–7、10、11（AM-1 范围）；
> 开发描述来源：开发会话汇报（4e6b0a0 代码 + cb33cf2 文档）。
> 结论：✅ 放行 —— 通过 17 / 缺失 0 / 偏差 0 / 需人工确认 2

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/接口/行为） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | AM-1 | Steam 专用代理可配多条（换行/逗号、≤10、自动去重；非法行报行号） | 系统设置 → 网络与代理（secret 值）/ env STEAM_PROXY | ✅ | settings.js:320-330；test/proxy-pool.test.js:136 |
| 2 | AM-1 | 第一条代理连不上时，同一请求内自动换第二条并成功（旧行为：所有重试撞同一台） | 所有走 Steam 代理的采集请求 | ✅ | http.js:250-282；test/http-proxy-failover.test.js:85（断言两次代理不同） |
| 3 | AM-1 | 失败的代理进入冷却（60s → 5min → 30min），冷却期内请求不再先撞它 | 同上 | ✅ | proxy-pool.js:18、:177；test/proxy-pool.test.js:76 |
| 4 | AM-1 | 成功的代理被"粘住"，下个请求优先用它，冷却结束也不抢回 | 同上 | ✅ | proxy-pool.js:131-167、:198；test/http-proxy-failover.test.js:116 |
| 5 | AM-1 | 全部代理都失败 → 直接报错「所有代理均失败」，绝不回退直连 | 同上 | ✅ | http.js:233-247、:422；test/http-proxy-failover.test.js:138 |
| 6 | AM-1 | 目标返回 HTTP 500 / 429 时不切换代理（仍按原重试/冷却逻辑） | 同上 | ✅ | http.js:125-128、:399-408；test/http-proxy-failover.test.js:164 |
| 7 | AM-1 | 老的单行 STEAM_PROXY 配置行为完全不变（=1 条，不启用池） | env STEAM_PROXY 单值 | ✅ | http.js:210-211；test/http-proxy-failover.test.js:224 |
| 8 | AM-1 | 代理健康状态跨进程共享（重启/子进程后冷却仍在） | data/proxy-health.json（自动落盘） | ✅ | proxy-pool.js:92-112；test/proxy-pool.test.js:107 |
| 9 | AM-1 | 后台可查每条代理的健康（正常/冷却中/未知、连续失败、最近错误），地址密码脱敏 | GET /api/admin/proxies（仅管理员） | ✅ | server.js:2417-2421；test/proxy-pool.test.js:148 |
| 10 | AM-1 | diagnose 命令显示代理池条数与每条状态 | CLI diagnose / proxy-check | ✅ | cli.js:1533-1543、:1679-1682 |
| 11 | AM-1 | 健康文件与日志、API 中都不出现代理地址与密码（文件只存 sha256 前 16 位） | 日志 / data/proxy-health.json | ✅ | proxy-pool.js:21-24；test/proxy-pool.test.js:107、:130 |

## 逐条核对（规格验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | §7.1 老单行照常工作（=1 条代理） | 代码 gate ≥2 条才启用池 + 专用测试 + 既有 http-error 全绿 | http.js:210-211；test/http-proxy-failover.test.js:224；test/http-error.test.js 8/8 | ✅ |
| 2 | §7.2 第 1 条拒连 → 同请求内切第 2 条成功；日志 http.proxy_switch{reason:ECONNREFUSED}；断言两次尝试代理不同 | 假代理+假目标真实转发，逐次记录 http.request 的 proxy | test/http-proxy-failover.test.js:85-112 | ✅ |
| 3 | §7.2 反例自检：nextCandidate 恒返第一条 → 测试变红 | QA 亲自执行（破坏→红→还原→绿） | 本报告「复检记录」；输出贴于汇报 | ✅ |
| 4 | §7.3 第 1 条冷却后，后续请求直接从第 2 条开始 | 第 2 个请求 attempts.length===1 且 proxy=第 2 条 | test/http-proxy-failover.test.js:116-136 | ✅ |
| 5 | §7.4 成功后粘住，冷却结束不抢回 | candidatesFor sticky 优先 + lastGood 断言 | proxy-pool.js:131-167；test/proxy-pool.test.js:87-101 | ✅ |
| 6 | §7.5 全部失败 → PROXY_ALL_FAILED + 日志 + 不直连 | 两死代理：报错码、日志 count、attempts===2（无第 3 次直连） | http.js:233-247；test/http-proxy-failover.test.js:138-161 | ✅ |
| 7 | §7.6 目标 500/429 不切换代理 | 500 两次尝试同代理、无 switch 日志；429 不重试不切换 | test/http-proxy-failover.test.js:164-199 | ✅ |
| 8 | §7.7 重启进程后冷却仍在 | 落盘 → 清内存（模拟新进程）→ cooldownUntil 仍生效 | proxy-pool.js:92-112；test/proxy-pool.test.js:107-118 | ✅ |
| 9 | §7.10 日志与 API 无密码；健康文件无地址 | 文件内容断言 + proxyHealth 脱敏断言 | test/proxy-pool.test.js:107-118、:121-134、:148-183 | ✅ |
| 10 | §7.11 npm test 全绿 + 两个新测试入主链 + frontend:build + scan | 亲自重跑 | npm test 59 文件/495 项 fail 0；frontend:build ✓；scan 干净 | ✅ |
| 11 | §3.1 校验：按行拆分/去空/逐条 parseProxy/报行号/去重/1–10 条 | settings.validateSetting 单测 | settings.js:320-330；test/proxy-pool.test.js:136-146 | ✅ |
| 12 | §4.1 函数签名（parseProxyList/steamProxyUrls/decideProxy 取第一条） | grep + 单测 | proxy.js:31-49、:82-84；test/proxy-pool.test.js:58-62 | ✅ |
| 13 | §4.2 候选顺序 + 全部冷却取最早解冻 + nextCandidate 纯函数 | 单测 | proxy-pool.js:131-175；test/proxy-pool.test.js:87-101 | ✅ |
| 14 | §4.3 maxAttempts = max(retries+1, candidates) 封顶 10；fetchImpl/forceDirect/非 Steam 不变 | 代码 + 两条注入/非 Steam 测试 | http.js:212、:277-284；test/http-proxy-failover.test.js:201-253 | ✅ |
| 15 | §4.4 五个日志事件（switch/down/ok/cooldown_override/all_failed） | grep 事件名与字段 | http.js:256-266、:340、:405、:238-241；proxy-pool.js:73-76（health_reset） | ✅ |
| 16 | §4.5 GET /api/admin/proxies（管理员、脱敏、没配返回空）+ diagnose 池状态 | API 401/403/200 测试 + cli.js diff | server.js:2417-2421；test/proxy-pool.test.js:148-183；cli.js:1533-1543 | ✅ |
| 17 | 纪律：无新 tag / 无部署文件 / 无产物入提交 / 已推 main / OVERVIEW 同步 | git 取证 | 无新 tag；diff 14 文件全为代码/测试/文档；origin/main=cb33cf2；PROJECT-OVERVIEW 新增 AM-1 行 | ✅ |

## 亲自重跑验证（2026-11-06 19:1x）

```
npm test              → 59 个文件 / pass 495 / fail 0
npm run frontend:build → ✓ built in 943ms
npm run scan          → ✅ 未发现高置信度凭据 / 未发现可疑密钥赋值
```

## 打回清单

无。

## 需人工确认

1. 真实多代理环境：本地验证用假代理（ECONNREFUSED/转发/500/429），真实出口代理的切换/冷却效果需上线后观察（`http.proxy_switch` / `http.proxy_down` 日志）。
2. 反例自检的精确现象（如实披露）：`nextCandidate` 恒返第一条后，变红的是**验收 5** 的尝试计数断言（死代理被重试 4 次，attempts=4≠2，报 PROXY_ALL_FAILED 路径被绕过）；验收 2 的「两次代理不同」断言在该破坏下仍绿——因为失败代理在同一请求内已进入 60s 冷却，候选列表只剩健康代理（恒返第一条恰好仍是它）。这不是断言没锁住，而是冷却机制在保护；套件整体变红已证明"假绿"会被抓住。

## 争议项

无。

## 复检记录

- 第 1 轮（2026-11-06）：初检即通过，无打回项。
- 反例自检（QA 亲自执行）：`nextCandidate` 临时恒返第一条 → `node test/http-proxy-failover.test.js` → **EXIT=1，fail 1**（验收 5）→ 还原 → 7/7 全绿。
