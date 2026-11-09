# QA：同步价格批（AC-2 批，第 1 轮）

> 基线 6bceac8 → HEAD d0d157b；判据 [docs/SYNC-FAILURE-MODES.md](SYNC-FAILURE-MODES.md) AC8 + [docs/TODO.md](TODO.md) AC 段；
> 开发描述来源：开发会话汇报（e122816 代码 + d0d157b 文档）。
> 结论：✅ 放行 —— 通过 9 / 缺失 0 / 偏差 0 / 需人工确认 1

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/接口/行为） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | AC-2 | steam-status 判定「ok（国区有价）」时顺带写入该游戏首次价格，列表里不再"已同步却没价格" | steam-status 定时任务（自动） | ✅ | steam-status.js（applySteamDetails 写价分支）；test/steam-status.test.js:348 |
| 2 | AC-2 | 写价与状态判定共用同一次 appdetails 响应，不额外消耗 Steam 配额 | 同上 | ✅ | steam-status.js（meta 复用） |
| 3 | AC-2 | 锁区 / 无价 / 免费不写价；价格用国区 final（原价/折扣/币种齐全） | 同上 | ✅ | steam-status.js；test:348 |
| 4 | AC-2 | 重复判定不重复写价（fingerprint 幂等） | 同上 | ✅ | ingest（offerHash unchanged）；test:348 |
| 5 | AC-2 | 「已同步」口径复核 = ok + 有报价（免费不要求报价），与用户感知一致 | 后台指标卡 | ✅ | pg.js（adminGameStats）；test:70 |
| 6 | AC-2 | 任务日志与完成提示带「顺带写价 N 款」计数 | CLI / 日志 | ✅ | cli.js（steam-status.done offers 字段） |

## 逐条核对（规格验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | AC8 判 ok 顺带写 offer（Q3 已确认的改法） | 单测：ok+价格 → offers 表落 1 行且字段正确 | test/steam-status.test.js:348-376 | ✅ |
| 2 | AC8 锁区/无价/免费不写价 | 单测三例 | test:378-390 | ✅ |
| 3 | AC8 幂等（fingerprint 不变不重插） | 重复调用断言行数不变 | test:391-393 | ✅ |
| 4 | AC8 「已同步」口径 = ok+有报价 | adminGameStats 断言（改口径后 pending/synced 翻转） | test:70-103 | ✅ |
| 5 | 写价失败不影响状态判定 | 代码 try/catch + offer_failed 日志 | steam-status.js | ✅ |
| 6 | offer 写入不可静默（inserted/updated>0 才算） | offerWritten 判定 | steam-status.js | ✅ |
| 7 | 任务收尾日志带 offers 计数 | 代码 + 静态阅读 | cli.js（steam-status.done） | ✅ |
| 8 | npm test 全绿 + build + scan | 亲自重跑 | npm test 66 文件/537 项 fail 0；build ✓；scan 干净 | ✅ |
| 9 | 纪律：无新 tag / 无产物入提交 / 已推 main / OVERVIEW+DELIVERY 同步 | git 取证 | 无新 tag；origin/main=d0d157b | ✅ |

## 亲自重跑验证（2026-11-09）

```
npm test               → 66 个文件 / pass 537 / fail 0
npm run frontend:build → ✓
npm run scan           → ✅ 未发现高置信度凭据 / 未发现可疑密钥赋值
```

## 打回清单

无。

## 需人工确认

- 上线后核对 `steam-status.done` 的 `offers` 计数与 `steam_status='ok'` 且无报价游戏数的收敛趋势（真实 Steam 数据）。

## 争议项

无。

## 复检记录

- 第 1 轮（2026-11-09）：初检即通过，无打回项。
