# QA：STEAM-DLC 方案 A（第 1 轮 · 演练）

> 基线 `c08833e` → 交付 `09fe7dd`；判据 [docs/STEAM-DLC.md](STEAM-DLC.md) §4 改动清单 + §5 验收四条 + gameprice-dev 纪律项。
> 演练性质：回顾性质检（交付时 gameprice-qa 尚不存在；当前 repo 已到 v1.16.2，规格已标"方案 A 已实现并发布 v1.8.0"）。
> 结论：**⚠️ 有条件放行 —— 通过 13 / 缺失 0 / 偏差 0 / 需人工确认 2**（另有风险记录 2 条）

| # | 条目（规格 §4/§5） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | listUserAccounts 删除 dlc 子查询与返回字段 | `git show 09fe7dd:src/steam-accounts.js` grep `dlc` | 零命中；仅存 `as type_unknown` 子查询 | ✅ |
| 2 | ownedTypeStats 删除 dlc 字段（保留 typeUnknown） | grep `ownedTypeStats` | `select count(*) filter (where g.app_type is null)…`、`return { typeUnknown }` | ✅ |
| 3 | server.js 库同步接口返回体删除 dlc | HEAD 版 grep `dlc` | 仅剩 `/api/games` 的 `type` 过滤（与本接口无关） | ✅ |
| 4 | 删除「DLC」列（含 `*` 与 tooltip） | `git diff c08833e..09fe7dd -- frontend/src/pages/AdminExtras.vue` | DLC 列整行删除 | ✅ |
| 5 | 账号列表上方加说明句 | grep `不返回 DLC 拥有数据` | AdminExtras.vue（card-heading 第二段 `<p>`） | ✅ |
| 6 | syncSteam 去掉「其中 DLC N 款」、保留「差集清理 N 条」 | grep toast | `已同步 X 款游戏（差集清理 N 条…）`，无 dlc 字样 | ✅ |
| 7 | 测试不再断言 dlc；type_unknown 断言保留 | grep test 文件 | `'dlc' in list[0] === false` 负向断言（防回退）+ `type_unknown` 断言保留 | ✅ |
| 8 | README / STEAM-ACCOUNTS 已知限制补行 | grep `DLC 拥有数不可得` | README 已知限制 11；STEAM-ACCOUNTS 已知限制段（基线 c08833e 已写入，按"最终仓库状态为准"判定） | ✅ |
| 9 | §5.1 页面不再出现 DLC 列与 `*` | 静态 grep + 渲染效果 | 静态 ✅；实际渲染 🔎（需部署后目视；事后：v1.8.0 已发布，规格标已实现） | 🔎 |
| 10 | §5.2 同步提示不再出现"其中 DLC N 款" | grep toast | 无 dlc 字样 | ✅ |
| 11 | §5.3 type_unknown 仍写日志、页面不渲染 | grep 日志点 + 前端 | 日志侧 ✅（`steam.app_types_backfilled/missing` 保留、listUserAccounts 仍返回 type_unknown）；toast 仍含「类型未知 N 款已尝试补全」半句——§4 只要求去掉 DLC 部分、§5.3 说"页面不渲染"，两处张力 → 需所有者裁定（事后：v1.8.0 发布时保留，视为默认接受） | 🔎 |
| 12 | §5.4 npm test / frontend:build 全绿 | 交付时记录 + 本轮重跑 | 交付时 EXIT=0（有会话记录）；本轮演练重跑：`npm test` EXIT=0（50 个测试文件全绿）、`frontend:build` EXIT=0（1.38s）、`scan` EXIT=0 | ✅ |

## 纪律固定检查项

| 检查项 | 证据 | 判定 |
|---|---|---|
| 无擅自新增 tag | `git tag`：c08833e..09fe7dd 之间无 tag（v1.8.0 为之后发版所打） | ✅ |
| 未碰部署/服务器配置 | diff 仅 5 个源码/测试文件 | ✅ |
| 构建产物未进提交 | diff 无 dist/logs/data | ✅ |
| 已推 main | 09fe7dd 在 main 历史 | ✅ |
| PROJECT-OVERVIEW.md 同步 | 09fe7dd 未改该文件；当前 HEAD 全库 grep，PROJECT-OVERVIEW.md 中 DLC 零命中——账号库 DLC 统计/方案 A 从未进入项目总览（gameprice-dev §6 必改项） | ⚠️ 风险记录 |

## 查多（需求外改动）

- `src/cli.js` 注释改动（"DLC 统计靠 app_type"→"类型未知数靠 app_type"）：需求清单外，属注释口径同步，无行为变化 → 风险提醒（记录，不判错）。

## 打回清单

无（缺失 0、偏差 0）。

## 需人工确认

1. 条目 9：后台「Steam 账号」页实际渲染效果（列消失、说明句显示）——部署后目视。
2. 条目 11：同步提示保留「类型未知 N 款已尝试补全」半句是否符合 §5.3「页面不渲染 type_unknown」——所有者裁定；事后已随 v1.8.0 发布保留。

## 风险记录（不阻塞）

1. PROJECT-OVERVIEW.md 未记录账号库 DLC 统计与方案 A（gameprice-dev §6 必改项的历史欠账）。
2. cli.js 需求外注释改动（无害）。

## 复检记录

第 1 轮（2026-11-06，演练）：无打回项，结论 ⚠️ 有条件放行；两条 🔎 事后由所有者随 v1.8.0 发布默认关闭。
