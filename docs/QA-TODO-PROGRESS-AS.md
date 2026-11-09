# QA：README 开发进度摘要（第 1 轮）

> 基线 `0f2a5e0`（requirements 落条目）→ HEAD `de71311`（开发提交）；判据 [TODO-PROGRESS.md](TODO-PROGRESS.md) §10 验收；
> 开发描述来源：requirements 会话 §6（条目 AS / 规格 §4、§5、§7、§10 / 5 条验收要点）。
> 注：基线→HEAD 之间混入了其他会话的 v2.2.1 发布提交（`0390872`、`34ec201`，涉及 CHANGELOG/DELIVERY/C1-VERIFY/package-lock），
> 本批自身改动以 `de71311^..de71311` 为准（13 个文件，451+ / 21-）。
>
> 结论：✅ 放行 —— 通过 7 / 缺失 0 / 偏差 0 / 需人工确认 0

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | AS | GitHub 仓库首页 README 显示自动生成的「开发进度」块：当前版本、进行中、接下来、最近 5 个完成、计数 | GitHub 仓库首页 README | ✅ 已交付 | README.md:631-653；`npm run todo:progress` 生成 |
| 2 | AS | 进度防漂移：改完 TODO 状态不重新生成，CI `docs-progress` 变红并提示运行命令 | GitHub Actions（push 触发） | ✅ 已交付 | .github/workflows/docs-progress.yml；run 42598110740 success；本地模拟退出码 1 |
| 3 | AS | 本地命令：`npm run todo:progress`（生成）/ `todo:progress:check`（校验） | 命令行 | ✅ 已交付 | package.json scripts；scripts/todo-progress.js |
| 4 | AS | README 修正过期描述：Docker 镜像行改「已发布镜像」；多区服两处口径统一为「同屏并排」；删除过期「路线图」段，产品项迁入 ROADMAP | README 阅读 | ✅ 已交付 | README.md:47/62/65/151/631；docs/ROADMAP.md 末段 |
| 5 | AS | 未知状态兜底：README 进度块显示「待分类（需补状态词）」，不静默丢失 | README 进度块 | ✅ 已交付 | scripts/todo-progress.js:168；test/todo-progress.test.js:81 |

## 逐条核对（规格 §10 验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | README 出现「开发进度」块，只能由 TODO 生成；改状态不重新生成时 `--check` 退出 1 并提示命令 | 读 README + 反向模拟 | README.md:631-653（块存在）；模拟：把 AS 状态改成 `开发中` → `node scripts/todo-progress.js --check` 退出 1 且提示「请运行 npm run todo:progress」；改回后退出 0 | ✅ |
| 2 | 块内是 进行中 + 接下来 + 最近 5 个完成 + 当前版本；未知状态进「待分类」不丢失 | 读生成块 + 单测 | README.md:636-653（v2.2.1 · 进行中 1 · 接下来 1 · 最近完成 5 条）；scripts/todo-progress.js:168；test/todo-progress.test.js:81、95 | ✅ |
| 3 | 旧「路线图」已替换；Docker/多区服/锁国区过期描述修正；docs 链接检查全绿 | git diff + 重跑 | `git diff de71311^..de71311 -- README.md`（路线图段删除、62/65/151 行修正）；`node test/docs.test.js` → 5 项全绿 | ✅ |
| 4 | `docs-progress` CI 只在 TODO/README/脚本变更时跑，通过 `--check`，不触发镜像构建 | 读 workflow + Actions | .github/workflows/docs-progress.yml（paths 白名单 + `node scripts/todo-progress.js --check`，无 docker 步骤）；run 42598110740 success | ✅ |
| 5 | `test/todo-progress.test.js` 已进主链；`npm test` / `npm run scan` 全绿 | 重跑 | package.json test 链含 `node test/todo-progress.test.js`；`npm test` 退出码 0（577 项子测试，无 not ok）；`npm run scan` → 297 文件无凭据 | ✅ |
| 6 | 生成不含时间戳，连续跑两次无 diff | 单测 + 实测 | test/todo-progress.test.js:81（幂等断言）；实测 `npm run todo:progress` 连跑两次 README 哈希不变 | ✅ |
| 7 | README 中不出现内部细节，只有编号/标题/状态/版本 | 读块 | README.md:631-653（仅编号+标题+状态+版本，无依据/服务器/账号内容） | ✅ |

## 纪律固定检查项

1. `git tag --list`：无新增 tag（仅历史 v0.20.1…v2.2.1）—— ✅
2. diff 未碰部署/服务器配置/凭据（compose、DEPLOY 语义、密钥均无）—— ✅
3. 构建产物未入库：本批 13 文件均为 md/js/yml/json，无 dist/logs/data—— ✅
4. 已按要求推 main：`de71311` → origin/main—— ✅
5. `docs/PROJECT-OVERVIEW.md` 已同步（新增 AS 行，功能与代码落点表）—— ✅

## 打回清单

无。

## 需人工确认

无。docs-progress CI 已在实际 push 上验证成功（run 42598110740）。

## 争议项

无。

## 复检记录

- 第 1 轮（2026-11-09）：初检即 ✅ 放行，无打回项。
