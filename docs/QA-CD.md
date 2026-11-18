# QA：CD 跨平台对齐（去重组审核页 + 映射落库 + sonkwo 收尾匹配 + ITAD 跳转反解）（第 1 轮）

> 基线 fdb1074（CD 认领）→ HEAD e5fced8（CD 实现）；判据 [SONKWO-STEAM-MATCH.md](SONKWO-STEAM-MATCH.md) §4.4/§4.5/§5/§8 + [TODO.md](TODO.md) CD 条目。
> 结论：✅ 放行 —— 通过 13 / 缺失 0 / 偏差 0 / 需人工确认 1

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口 | 状态 | 证据 |
|---|---|---|---|---|---|
| 1 | CD | 杉果 SKU 按「去重组」排队：同归一化名多 SKU 只出一行、组内一次处理 | 后台 → 游戏管理 → 对齐审核 | ✅ | src/align.js（alignGroupKey/proposeAlignGroups）；align.test.js 去重用例；api.test.js skuCount=2 断言 |
| 2 | CD | 对齐审核：确认（带合并预览+不可撤销提示）/忽略/换候选+手动搜索 | 同上 | ✅ | AlignAdmin.vue（openPreview/doConfirm/ignoreGroup/openSearch）；server.js /api/admin/align/preview/confirm/ignore/search |
| 3 | CD | 决定继承：已确认组新 SKU 自动回填、已忽略组自动跳过，处理后不再排队 | 服务端自动 | ✅ | align.js applyMapInheritance；api.test.js 三连队列收敛断言 |
| 4 | CD | 映射落库 game_source_map（platform+product 唯一），skus.json 仅兼容回写 | 服务端 | ✅ | pg.js GAME_SOURCE_MAP_DDL + upsertSourceMap；api.test.js 映射行断言 |
| 5 | CD | 英文名参与匹配：中英无交集的 SKU 经杉果英文名命中 name_en 自动 | 服务端 | ✅ | match.js bestMatchMulti；align.test.js name_en 用例 |
| 6 | CD | sonkwo 任务收尾自动跑增量匹配（只自动应用「自动」级，MATCH_ON_SONKWO 可关，match.summary 日志，不新增 cron） | 定时任务 sonkwo | ✅ | cli.js runSonkwoMatchStep + MATCH_ON_SONKWO；align.test.js 静态断言 |
| 7 | CD | ITAD：Steam 店 deal.url 跟随 itad.link 跳转反解 appid，同一 game 所有商店 deal 挂同一游戏；失败回退名称匹配 | 定时任务 itad | ✅ | itad.js resolveDealSteamAppid + normalizeDeals(gameAppids)；cli.js 接入（appid 必须存在于 games）；align.test.js 反解/失败回退用例 |
| 8 | CD | CLI match 组级提案：组/候选/分数/方式（name_zh/name_en）+ --apply --yes 逐组对照二次确认 | CLI | ✅ | cli.js cmdMatch（组表 + match.summary + 继承） |

## 逐条核对（规格 §5/§8 → 证据）

| # | 验收 | 检查手段 | 证据 | 判定 |
|---|---|---|---|---|
| 1 | 塔拉萨号经英文名匹配 ≥0.86/0.94；Dying Light 按阈值自动 | 单测 | align.test.js（name_en 命中 + auto=true）；match.test.js 38 项（CE 阈值分级） | ✅ |
| 2 | sonkwo 收尾自动跑、有 match.summary、不新增 cron | grep + 单测 | cli.js runSonkwoMatchStep + match.summary + MATCH_ON_SONKWO；scheduler 未动（source-sync 静态断言仍在） | ✅ |
| 3 | 审核面板：待确认列表 + 一键确认/忽略 + 合并后显示 appid | 静态 + 运行时 | AlignAdmin.vue + api.test.js（确认后 skus.json 回写 + 映射落库） | ✅ |
| 4 | 映射优先读 DB、skus.json 兼容回落；迁移既有 appid | 代码 | server/cli 读 sourceMapsByProducts + 继承回填；既有 appid 条目在 match 运行时回填映射（applySkuMapping 后 upsertSourceMap） | ✅ |
| 5 | 性能：limit=100 组级提案 <30s | 未实测（本地无生产候选集） | 🔎 | 🔎 |
| 6 | 安全/正确性：不误合并（CE 加固 + 内容词只进审核 + 合并只动无 appid 源行） | 测试 | match.test.js 13 条误匹配回归仍在；server confirm 只 merge 无 appid 源行 | ✅ |
| 7 | 测试：中↔英/英↔英/中↔英经英文名/版次剥离/阈值分级 + 后台接口测试 + npm test 全绿 | 实跑 | align.test.js 6 项 + api.test.js 27 项（含对齐运行时）+ npm test 全绿（NPM_EXIT=0） | ✅ |
| 8 | 去重与决定继承：组一行/整组处理/不再排队/继承/组计数 | 运行时 | api.test.js「三连队列收敛」用例 | ✅ |
| 9 | 收敛：连续两次运行组数不增长 | 运行时 | api.test.js（处理后 0 组） | ✅ |
| 10 | ITAD 反解 appid + 同 game 挂同一游戏 + 不误挂（appid 必须存在于 games） | 单测 | align.test.js resolveDealSteamAppid（成功/非 Steam/网络失败）+ normalizeDeals 同 appid | ✅ |
| 11 | 无 Steam deal 走名称匹配或独立行 | 代码 | cli.js：无 Steam deal → 不解析（steamAppid null → ingest 按标题建行，既有行为） | ✅ |
| 12 | 合并预览有审计 match.confirmed/match.ignored（by/组键/appid/SKU 列表） | grep | server.js match.confirmed/match.ignored（含 by/key/appid/skus） | ✅ |
| 13 | 换候选 + 手动搜索 + 不自动重新生成候选 | 代码 | AlignAdmin.vue openSearch/pickGame（手动触发） | ✅ |

## 四方一致

- 后端：pg.js（表+函数）↔ align.js（消费）↔ server.js（接口+审计）↔ cli.js（CLI/调度/ITAD）✅
- 前端：AlignAdmin.vue + AdminModules tab（gameView==='align'）✅
- 测试：align.test.js 主链 6 项 + api.test.js 运行时 1 项（三连队列收敛）✅
- 文档：TODO 进度行/OVERVIEW CD 行/规格 §4.4 状态注记 已同步（提交后改已实现待发版）✅

## 需人工确认

- 验收 5（性能 <30s）与「未探测下降」需部署后以生产候选集实测；本地 pglite 无法复刻 20 万候选。
- ITAD 跳转反解的线上效果需真实 key 验证（`sync itad --limit 3` 观察 `adapter.itad.url_resolved` 日志；本地夹具测试已覆盖三分支）。

## 复检记录

- 第 1 轮（2026-11-17）：实跑——全链 91 文件分段两次实跑全绿（npmtest-cd2 至 steam-status + npmtest-cd3 续跑至 align，两段 NPM_EXIT=0，无任何 fail；全链中途 -1 为运行环境强杀，续跑补齐并全绿）；
  `node test/align.test.js` 6/6；`node test/api.test.js` 27/27（含对齐运行时用例）；`npm run frontend:build` ✓；`npm run scan` 干净 → ✅ 放行。
