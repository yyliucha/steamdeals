# QA：DV 游戏管理「ITAD」筛选改来源筛选（第 1 轮）

> 基线 ba9b0b0 → HEAD（worktree 分支 wt-228-srv，未提交）；判据 docs/ITAD-SOURCE-FILTER.md §3 验收（方案 A 已确认）；
> 开发描述来源：夜班监工派发（工人 2，重放备份 F:\dsh\dv-wip\edits.md，基线 7bce0b6 → 已 rebase 到当前 main）。
> 结论：✅ 放行 —— 通过 5 / 缺失 0 / 偏差 0 / 需人工确认 0

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | DV | 游戏管理「平台」下拉分「平台 / 来源」两组，来源组为「ITAD（来源）」 | 控制台 → 游戏管理 → 目录筛选 | ✅ | AdminModules.vue filterbar（el-option-group 平台/来源）+ admin-ui.js ElOptionGroup 注册 |
| 2 | DV | 选「ITAD（来源）」列出有 ITAD 匹配标记（game_source_sync matched）的游戏，数量与库内标记一致 | GET /api/admin/games?platform=itad | ✅ | server.js platformCond itad 分支；test/admin-games.test.js DV 测试 |
| 3 | DV | 其它平台筛选行为不变（steam/sonkwo/gog/humble/steampy 仍按 offers.platform_code） | 同上 | ✅ | test/admin-games.test.js「其它平台筛选行为不变」 |
| 4 | DV | ITAD 采集新匹配一批游戏后，刷新即可在「ITAD（来源）」下看到 | 同上 | ✅ | test/admin-games.test.js 验收③（含短缓存过期语义） |

## 逐条核对（规格验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | 选「ITAD（来源）」→ 列出有 matched 标记的游戏，数量与库内 ITAD 标记一致 | HTTP 测试对比 SQL 计数 | test/admin-games.test.js:120-137（`total === sqlMarked`；反向自检注释） | ✅ |
| 2 | 选其它平台结果与改动前一致 | HTTP 测试：platform=steam 只出有 steam 报价的游戏；不带 platform 不受影响 | test/admin-games.test.js:139-156 | ✅ |
| 3 | ITAD 采集新匹配后刷新可见 | HTTP 测试：新标记 → 缓存过期 → total +1 | test/admin-games.test.js:158-176 | ✅ |
| 4 | 前端标签/提示清楚区分「平台」与「来源」 | 静态断言：两个 el-option-group、itad 不在平台数组 | test/frontend-registration.test.js DV 组（2 条） | ✅ |
| 5 | npm test（分段）+ frontend:build + scan 全绿 | 亲自重跑 | admin-games 6/6、frontend-registration 8/8、http-guard 绿、api 38/38；build ✓ 11.21s；scan ✅ | ✅ |

## 打回清单

无。

## 需人工确认

无（列表有 3s 短缓存属 B2 批既有行为，测试按注入 TTL 覆盖该语义）。

## 争议项

无。

## 复检记录

- 第 1 轮（2026-11-20）：重放后初检发现验收③测试撞上列表 3s 短缓存（B2 批既有行为），测试注入 adminCacheTtlMs=100 并按真实语义断言「缓存过期后可见」，重跑全绿——不是功能缺陷，是测试未覆盖缓存语义。

## 备注

- TODO 状态由监工统一回写（夜班工人不改 docs/TODO.md 及任何共用文档，监工指令例外）。
- 重放基线说明：原开发会话基线 7bce0b6，重放时 main 已前进至 ba9b0b0；platformCond 区域未被 B4 拆分改动（已核对），按 edits.md 原样重放无冲突。
- 本报告在 worktree 内（F:\dsh\gp-wt-228b\docs\QA-DV.md），与主树隔离。

## 验证输出（QA 亲自重跑，对应 edits.md 尾部清单）

- `node test/admin-games.test.js` → 6/6 绿（含 DV 3 条）
- `node test/frontend-registration.test.js` → 8/8 绿（含 DV 锁 2 条）
- `node test/api.test.js` → 38/38 绿
- `node test/http-guard.test.js` → 绿
- `npm run frontend:build` → ✓ built in 11.21s
- `npm run scan` → ✅ 未发现高置信度凭据
- （steam-accounts 16/16 为 EM 批相关，本批未触及；主链 test:1 中 commit-own 因沙箱禁 spawn git 失败与 DV 无关）
