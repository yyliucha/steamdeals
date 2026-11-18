# QA：CE 杉果匹配器加固（第 1 轮）

> 基线 ac58953（事故记录 + CE 条目建档）→ HEAD 64c30d1（代码 5392852 未变，其后均为 TODO/INDEX 状态提交）；判据 [SONKWO-STEAM-MATCH.md](SONKWO-STEAM-MATCH.md) §9 + [TODO.md](TODO.md) CE 条目验收；开发描述来源：TODO CE 条目（无独立开发描述，以 §9 加固要求为判据）。
> 结论：✅ 放行 —— 通过 9 / 缺失 0 / 偏差 0 / 需人工确认 1

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | CE | 提案与自动匹配不再被「共享一个词」误导——§9 表 13 条事故误匹配全部不再自动、不再进提案 | 运维 CLI `node src/cli.js match` | ✅ 已交付 | `test/match.test.js:105-135`（13 条回归，断言 bestMatch=null + auto=false）；`node test/match.test.js` 全绿 |
| 2 | CE | 数字/序数/罗马数字不一致直接判负（the 2nd vs the 1st、27 vs 21、VI vs V） | 同上 | ✅ 已交付 | `src/match.js:134-160`（extractNumbers/numbersConflict）、`src/match.js:254`（冲突 score=0）、`test/match.test.js:158-165` |
| 3 | CE | DLC/季票/通行证/服装/皮肤/故事包/扩展包/升级包/合集/三部曲 类商品只进人工审核，绝不自动合并 | 同上 | ✅ 已交付 | `src/match.js:40-66`（CONTENT_WORDS）、`:83`（hasContentWord）、`:267`（auto 排除 contentWord）、`test/match.test.js:167-175` |
| 4 | CE | 正确样例（愚者不灭、神盾力量：斯考利安战争、忙作一团、血色序曲、内核之心）仍自动匹配 | 同上 | ✅ 已交付 | `test/match.test.js:137-156` |
| 5 | CE | 英文名对等仍自动；中英混合标题经英文片段仍可提案（完整分不足时只进人工） | 同上 | ✅ 已交付 | `test/match.test.js:158-166`（The Thalassa 对等自动 + 混合标题待确认） |
| 6 | CE | `match --apply` 打印逐条「杉果名 → 候选名/appid」对照，必须 `--yes` 二次确认；默认只出提案 | 运维 CLI `node src/cli.js match --apply` | ✅ 已交付 | `src/cli.js:1161-1166`（无 --yes 打印对照后抛错拒绝）、`src/cli.js:1170-1183`（有 --yes 逐条打印后应用） |
| 7 | CE | `match --confirm <skuId> <appid>` 手工确认保留 | 运维 CLI `node src/cli.js match --confirm` | ✅ 已交付 | `src/cli.js:1103-1122`（confirm 分支未改动） |
| 8 | CE | 误合并数据修复（关杉果源→清错误 appid→迁报价/重建孤立行→开杉果源） | 运维侧生产操作 | 🔎 范围外（已完成） | 用户指令：数据修复已完成，本批不碰数据；TODO CE 条目仍保留该描述 |

## 逐条核对（规格 §9 加固要求 + TODO 验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | 只对完整归一化标题计分；片段匹配仅当片段长度 ≥6 且非通用词、完整标题分数 ≥0.8 才允许 | grep evaluatePair/isUsableFragment/GENERIC_FRAGMENTS | `src/match.js:83-92`（GENERIC_FRAGMENTS）、`:243-263`（evaluatePair：先算完整分，`fullScore >= fragmentFloor` 才进片段循环；片段过 `isUsableFragment` 门）、`src/match.js:166-170`（isUsableFragment：长度 ≥6 + 非通用词） | ✅ |
| 2 | 提取数字/序数/罗马数字（含 the 2nd / 2 / II）做一致性校验，不一致直接判负 | 读 extractNumbers/numbersConflict | `src/match.js:134-160`（数字+st/nd/rd/th、罗马 token（≤100 挡 MX/DMC 缩写）、第X 中文序数）、`src/match.js:254`（冲突 score=0） | ✅ |
| 3 | 扩展内容词表；命中 DLC/季票/通行证/服装/皮肤/故事包/扩展包/升级包/合集/三部曲 → 只进人工审核 | 读 CONTENT_WORDS + auto 判定 | `src/match.js:40-66`（中英双语内容词）、`:83`、`:267`（`!contentWord` 才可能 auto） | ✅ |
| 4 | 自动条件收紧：完整归一化相等，或（完整 Dice ≥0.94 且无内容词 且数字一致 且标题长度 ≥4） | 读 evaluatePair auto 行 | `src/match.js:267`（`equal || (fullScore >= autoScore && lenA >= 4 && lenB >= 4)`，且 numbersOk、!contentWord） | ✅ |
| 5 | `--apply` 打印每条「杉果名 → 候选名/appid」对照并要求 `--yes` 二次确认；默认只出提案 | 读 cmdMatch | `src/cli.js:1111`（`--yes` 标志）、`:1155`（默认只出提案提示）、`:1161-1166`（无 --yes 打印对照 + throw 拒绝）、`:1170-1183`（有 --yes 逐条打印后应用）；提案 label 由 `best.auto` 决定（`src/cli.js:1131`），不再用片段加分误标「自动」 | ✅ |
| 6 | 增加误匹配回归测试集（上表 13 条 + 正确样例） | 读测试 + 跑 | `test/match.test.js:105-135`（13 条，逐条断言不进提案 + 不自动）、`:137-175`（正确样例/英文名/数字冲突/内容词）；`package.json` test 主链含 `test/match.test.js` | ✅ |
| 7 | 上表 13 条不再自动匹配 | `node test/match.test.js` | 38/38 全绿（含 13 条回归 + 双保险断言 auto=false） | ✅ |
| 8 | 正确样例（愚者不灭、神盾力量、忙作一团、血色序曲、内核之心等）仍自动 | 同上 | `test/match.test.js:137-156` 全绿 | ✅ |
| 9 | 修复脚本 dry-run 输出可核对；修完再开杉果源、无新增误挂 | 只读检查 | **不在本批范围**（用户指令：数据修复已完成，不要再动数据） | 🔎 需人工确认（生产侧已完成/由运维核对） |
| 10 | `npm test` 全绿 | 亲自重跑 | `npm test` → `NPM_EXIT=0`（开发轮 npmtest-ce.log 全绿；QA 轮 npmtest-qa.log 复核见复检记录） | ✅ |

## 四方一致检查

- **后端**：`src/match.js` 提供 evaluatePair/bestMatch（auto/reasons/fullScore），`src/cli.js` 消费 `best.auto`/`best.reasons` ✓（`:1131`）
- **前端**：本批无前端改动（匹配是运维 CLI 功能）——不适用 ✓
- **测试**：`test/match.test.js` 断言锁住「不自动/不进提案」而非只看全绿；13 条逐条 `assert.equal(best, null)` + `assert.equal(ev.auto, false)` 双保险 ✓
- **文档**：`docs/PROJECT-OVERVIEW.md:80` 已同步 CE 说明；`docs/TODO.md` CE 状态 = 已实现待发版（f693562）；INDEX 已加 CE 行 ✓

## 纪律固定检查项

1. `git tag --list`：无新增 tag（最新 v2.18.0，事故前发版）✅
2. diff 未碰部署/服务器配置/凭据 ✅（4 文件全为代码/测试/文档）
3. 构建产物未进提交（`frontend/dist/`、`*.log`、`data/*-pgdata/` 均未 add）✅
4. 已推 main：5392852（feat）→ f693562（docs）✅
5. `docs/PROJECT-OVERVIEW.md` 已同步 ✅

## 查多（需求外改动，风险提醒）

- **并发撞车（记录，不判错）**：另一会话（CC 批）在 `49ec3e6` 用指定路径 `git add` 时，把本批当时尚未提交的 `src/cli.js` 与 `docs/PROJECT-OVERVIEW.md` 一并提交（提交信息不含 CE）；本批发现后已在 `5392852` 提交 `src/match.js`+`test/match.test.js` 使 HEAD 恢复一致，并在提交信息中注明。CC 批自身的改动（适配器/调度/后台四源触发）与 app 文档提交在基线..HEAD 内，属其它会话批次，不在本轮判定范围。
- TODO CE 条目「改动落点」仍列着「数据修复脚本」——按用户指令本批不实现；建议需求侧后续把该条标注为已完成或从 CE 划走。

## 需人工确认

- 条目 9：数据修复脚本与「修完再开杉果源、无新增误挂」属生产侧动作，本地无法验证；数据修复已完成（用户确认），开杉果源后建议运维先跑 `node src/cli.js match`（dry-run）核对提案再 `--apply --yes`。
- 「内核之心等经杉果页英文名自动」的端到端闭环依赖 CD 批把 `sku_ename` 接入 `skus.json`；CE 已保证匹配器本体对纯英文名对等自动（`test/match.test.js:158-161`）。

## 复检记录

- 第 1 轮（2026-11-16）：开发轮验证 `npm test`（NPM_EXIT=0，全绿）、`node test/match.test.js`（38/38）、`npm run scan`（干净）、`npm run frontend:build`（✓ built）；QA 轮重跑 `npm run scan`（SCAN_EXIT=0）、`npm run frontend:build`（BUILD_EXIT=0）、`npm test`（NPM_EXIT=0，npmtest-qa.log 无任何 fail）→ 全绿 → ✅ 放行。
