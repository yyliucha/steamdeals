# README 开发进度摘要（自动生成）

> 状态：**已确认待开发（2026-11-09）；已实现并发布 v2.3.0（2026-11-09）**。编号 **AS**。方案 A（README 自动进度块）由所有者确认。
> 关联：[TODO.md](TODO.md)（唯一排期与状态来源）、[../README.md](../README.md)、[ROADMAP.md](ROADMAP.md)。

## 1. 已确认的决策（2026-11-09 所有者）

| # | 决策 |
|---|---|
| 1 | **形态 = README 自动进度块**：`docs/TODO.md` 仍是唯一排期与状态来源，README 只放摘要，不复制全量清单 |
| 2 | **范围 = 进行中 + 接下来 + 最近 5 个完成**；另显示当前版本与各类数量 |
| 3 | **同步 = 脚本 + CI `--check`**：改完 TODO 跑 `npm run todo:progress`；CI 发现不一致就红，**不自动提交**、不加机器人 commit |
| 4 | **README 现有「路线图」替换为「开发进度」**，顺手修正 README 里与事实不符的过期描述 |
| 5 | **本期不上 GitHub Issues / Projects**：可勾选、看板、通知等能力后置；README 里的勾选框是只读展示 |
| 6 | **状态归并为 4 类 + 待分类兜底**；README 只放「编号 / 标题 / 状态 / 版本」，不搬 TODO 的内部细节与依据 |

## 2. 现状（2026-11-09 核对）

- `docs/TODO.md`：约 790 行、50 多个 `##` 段落，历史批次与当前条目混排；`K/M/N/O/P` 各出现两次；
  状态行有大量自由文本（`等排期`、`已定位，待开发`、`已实现并推 main`…）。整段搬进 README 不可读，也无法自动判定。
- 但 TODO 顶部已约定「每个条目必须有 `**状态：…**` 行」，这是可解析的锚点；本次只依赖这一行。
- README 的手写清单已经漂移（详见 §5.4 的修正清单），例如：
  - `README.md:62` 写「Docker 镜像未真实构建过」，`README.md:112` 又写「镜像由 GitHub Actions 构建并推送 TCR / Docker Hub」；
  - `README.md:47` 写「多区服对比 ✅ 已跑通」，`README.md:65` 又写「多区服对比 🚧 未实现」；
  - `README.md:637` 把「Steam 锁国区与 18+」标成未完成，但 README:149 与 TODO 的 U 段都写明 v1.15.0 已发布。
- GitHub 侧现状：Issues 已开启但 **0 条**，Projects 已开启，Wiki 关闭，没有 release / milestone 在用；
  README 里的 Markdown 任务列表只渲染成**只读**勾选框，不能点。

## 3. 目标与非目标

**目标**

1. 打开 GitHub 仓库首页就能看到「现在在做什么、接下来做什么、最近完成了什么」，不用点进约 790 行的 TODO。
2. 进度只能来自 `docs/TODO.md`，不允许 README 与 TODO 各写一份。
3. README 的过期描述顺手修正，首页不再自相矛盾。

**非目标（本期不做，写清楚避免被当漏项）**

- 不引入 GitHub Issues / Projects / Milestones 作为第二套待办；
- 不做自动提交 README 的 Action（避免机器人 commit 与并发冲突）；
- 不把 TODO 全量（含历史批次、依据、验收）搬进 README；
- 不改任何业务代码、接口、数据库或前端页面；不涉及版本号与构建。

## 4. 解析规则（唯一数据源：`docs/TODO.md`）

### 4.1 段落与状态

1. 以行首 `## <编号>. <标题>` 切分段落；编号为 1–2 个大写字母（`F`、`AA`、`AR`）。
2. 每段取**第一条** `**状态：…**` 行作为该段状态；没有状态行的段落视为结构段（如 B/C/D/E 的总表），不进入摘要。
3. 状态含 `已过时` 的段落排除；标题含 `~~` 的段落只在状态为 `已发布` 时保留——TODO 约定完成项标题加删除线，仍需进「最近完成」，其余删除线历史段（旧重复字母段）排除。
4. 标题清洗：去掉 `~~`、`**`、反引号；去掉开头的 `已发布 vX.Y.Z：` / `待开发：` / `待实施：` / `待办：` 等前缀；
   连续空白压成一个空格。

### 4.2 状态分类（按顺序匹配，先命中先算）

| 顺序 | 状态行包含 | 归类 | README 分区 |
|---|---|---|---|
| 1 | `已发布` | 已完成 | 最近完成（只取最近 5 个） |
| 2 | `已过时` | 忽略 | 不显示 |
| 3 | `质检通过` | 待发版 | 进行中 |
| 4 | `已实现待发版` | 待发版 | 进行中 |
| 5 | `质检打回` | 质检打回 | 进行中 |
| 6 | `开发中` | 开发中 | 进行中 |
| 7 | `待质检` | 待质检 | 进行中 |
| 8 | `待开发` | 待开发 | 接下来 |
| 9 | `依赖阻塞` / `待排查` / `待决策` | 阻塞/待定 | 阻塞与待定（有内容才渲染） |
| 10 | `等排期` | 待开发 | 接下来 |
| 11 | 其它/空 | 待分类 | 待分类（有内容才渲染，不阻断） |

- 顺序很重要：`已实现并发布` 必须先命中 `已发布`，不能落进「待发版」。
- 未知状态不静默丢弃：进「待分类」并原样显示状态片段，方便人工补状态词。

### 4.3 最近完成

- 取分类为「已完成」的段落，按**文件出现顺序倒序**（TODO 约定新条目追加在末尾）取前 5 个。
- 版本号从状态行里正则 `v\d+\.\d+\.\d+` 提取第一个；提不到就只显示标题。
- 同一版本多条合并为一条时按段落各占一行，不合并（保持可追溯）。

### 4.4 计数与版本

- 当前版本读 `package.json` 的 `version`（不写死在文档里）。
- 计数 = 各分区**段落数**：`进行中 N · 接下来 N · 已发布 N`（已过时与待分类不计入已发布）。
- 生成结果**不含时间戳**（保证同一份 TODO 生成同一份 README，`--check` 不会因日期抖动）。

## 5. README 结构

### 5.1 位置与标记

- 用 `## 路线图` 所在位置（当前 `README.md:631` 起）替换为「开发进度」块，整段包在标记里：

```markdown
<!-- TODO-PROGRESS:START -->
## 开发进度
…生成内容…
<!-- TODO-PROGRESS:END -->
```

- 标记外的一行产品方向链接由人手写（不参与生成）：
  `产品方向与未排期想法见 [docs/ROADMAP.md](docs/ROADMAP.md)；完整排期与依据见 [docs/TODO.md](docs/TODO.md)。`
- 生成器只替换两个标记之间的内容；标记缺失时报错退出，不猜位置。

### 5.2 生成内容（示例）

```markdown
## 开发进度

> 本段由 [docs/TODO.md](docs/TODO.md) 自动生成，请勿手改；改完待办状态后运行 `npm run todo:progress`。

**当前版本：v2.2.0** · 进行中 3 · 接下来 1

**进行中**

- `F` Steam 价格同步优化 —— 待发版
- `AP` 游戏详情·价格历史报表 —— 质检通过（待发版）
- `AO` 后台游戏列与平台链接抽屉改版 —— 质检通过（待发版）

**接下来**

- `AA` 添加愿望单推送 Steam 失败（方案 A 已确认）

**最近完成**

- `AR` 异常审核「按 IP 合并」视图 —— v2.2.0
- `AQ` 后台访问/异常列表排序 —— v2.2.0
- `AN` 未保存修改的离开提醒 —— v2.1.0（回归修复 v2.2.0）
- `AM` Steam 代理池 —— v2.1.0
- `AL` 登录 / 注册 / 改密页面 —— v2.1.0
```

（以上为格式示例，真实内容以生成结果为准。）

### 5.3 渲染细节

- 用无序列表而不是 `- [ ]`：README 的勾选框是只读的，用了会让人以为能点；状态用文字表达。
- 每条 = `` `编号` `` + 标题 + `——` + 状态/版本；单行不换行，长标题不截断（由标题清洗控制长度）。
- 「进行中 / 接下来 / 最近完成」三段恒渲染（为空时显示 `- 暂无`）；「阻塞与待定 / 待分类」只在有内容时渲染。
- 链接只指向仓库内已有文件（`docs/TODO.md`、`docs/ROADMAP.md`），不链未创建的脚本路径。

### 5.4 顺手修正的 README 过期项（同一批交付）

| 位置 | 现在 | 改成 |
|---|---|---|
| `README.md:62` | Docker 部署「⚠️ 文件齐备，镜像未真实构建过」 | ✅ 镜像由 GitHub Actions 构建并推送 TCR / Docker Hub；线上版本以 [DELIVERY.md](DELIVERY.md) 部署记录为准 |
| `README.md:65` | 「多区服对比 🚧 未实现」与 47 行 ✅ 冲突 | 改成「多区服**同屏并排** 🚧 未实现」，并在依据里写清「采集已支持、列表可按区服切换」 |
| `README.md:151` | 「多区服对比 🚧」同上 | 改成「多区服同屏并排 🚧」，避免与 47 行的采集能力混淆 |
| `README.md:631-640` | 手写路线图（含 637 行已过期的锁国区） | 整段替换为自动进度块；仍未做的产品项迁到 [ROADMAP.md](ROADMAP.md) 的「未排期想法」 |
| `README.md:637` 的锁国区项 | `[ ]` 未完成 | 删除（v1.15.0 已发布，README:149 已描述）；不留在首页 |

> 迁往 ROADMAP 的未排期项：`后台其余列表的手机端卡片化`、`提醒通道：多收件人分组`。
> `汇率折算`按项目既有边界（不同币种不折算、只并排）写成“明确不做”，不留在路线图里。

## 6. 脚本与命令

- 新增 `scripts/todo-progress.js`（ESM、零依赖，与仓库其他脚本一致）。
- 导出纯函数便于测试：
  - `parseTodo(todoText)` → `{ sections, counts }`；
  - `buildBlock({ todoText, version })` → 生成块字符串（含标记内内容）；
  - `applyBlock(readmeText, block)` → 替换标记内内容，返回新文本；
  - `check(readmeText, block)` → `{ ok, expected, actual }`。
- CLI：
  - `node scripts/todo-progress.js`：写回 `README.md`（只改标记内），并打印一行摘要；
  - `node scripts/todo-progress.js --check`：不一致退出码 1 并打印提示「请运行 npm run todo:progress」；一致退出 0；
  - 标记缺失 / README 读不到 / TODO 读不到：退出码 2，错误信息写清文件路径。
- `package.json` 增加：
  - `"todo:progress": "node scripts/todo-progress.js"`
  - `"todo:progress:check": "node scripts/todo-progress.js --check"`
- 不允许脚本自己 `git add/commit`；也不改 README 标记之外的任何字节（用字符串切片替换，不做全文件重写）。

## 7. CI

新增 `.github/workflows/docs-progress.yml`，只做校验、不构建镜像：

```yaml
name: docs-progress
on:
  push:
    branches: [main]
    paths: ['docs/TODO.md', 'README.md', 'scripts/todo-progress.js', 'test/todo-progress.test.js']
  pull_request:
    paths: ['docs/TODO.md', 'README.md', 'scripts/todo-progress.js', 'test/todo-progress.test.js']
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: node scripts/todo-progress.js --check
```

- 不需要 `npm ci`（脚本零依赖），单步几秒完成。
- 不触碰 tag 构建流程；`docker-hub` / `docker-tcr` 保持只由 tag 触发。
- 工作流失败时的提示要能直接告诉人「跑 `npm run todo:progress`」。

## 8. 测试

新增 `test/todo-progress.test.js`（`node:test` + `node:assert/strict`，使用临时目录/字符串夹具，不写假 README）：

1. 状态映射：`已实现并发布` → 已完成；`质检通过` → 进行中/待发版；`已实现待发版` → 进行中；
   `~~…~~` 与 `已过时` 被排除；`等排期` → 接下来。
2. 最近完成：按文件顺序倒序取 5 个，版本号从状态行提取；不足 5 个时全显示。
3. 未知状态：进「待分类」，不抛异常、不丢段落。
4. 幂等：同一输入生成两次完全一致；无时间戳。
5. 标记替换：`<!-- TODO-PROGRESS:START -->` 之外的内容一个字节都不变；标记缺失抛错。
6. `--check`：一致返回 0，不一致返回 1；错误信息包含 `npm run todo:progress`。
7. 真实仓库自检（可选，不放进主链）：`node scripts/todo-progress.js --check` 对本仓库必须通过。

新增测试必须加进 `package.json` 的 `test` 主链（项目硬规则，否则视为没交付）。

## 9. 文档与流程同步（交付的一部分）

- `docs/TODO.md` 顶部说明补一句：**“改完状态后运行 `npm run todo:progress` 更新 README 摘要；CI `docs-progress` 会校验。”**
- 三个 skill 各补一步：
  - `gameprice-dev` §6（文档收尾）：改完 TODO 状态后跑脚本；
  - `gameprice-qa`（改状态为「质检通过/质检打回」后）：跑脚本；
  - `gameprice-requirements` §6（建/改 TODO 条目后）：跑脚本。
- `docs/PROJECT-OVERVIEW.md`：在「功能与代码落点」表补一行（脚本、README 块、CI、测试）。
- `docs/DELIVERY.md`：只在“当前状态/验证”里补一句 CI 名称，不改发版流程。

## 10. 验收（可观测）

1. 打开 GitHub 仓库首页，README 出现「开发进度」块：当前版本、进行中、接下来、最近 5 个完成；点编号能看到对应 TODO 段落。
2. 手改 `docs/TODO.md` 某条状态但不重新生成 → `npm run todo:progress:check` 退出 1，并提示运行 `npm run todo:progress`；
   运行后退出 0，且 README 只有标记内变化（`git diff` 可见）。
3. `node test/todo-progress.test.js` 全绿；`npm test` 主链包含并通过。
4. CI `docs-progress` 在只改 `docs/TODO.md` / `README.md` 的 push 上运行并通过；不触发任何镜像构建。
5. README 的四处过期项（Docker、多区服 ×2、路线图/锁国区）已修正，`npm test` 里的文档链接检查仍全绿。
6. 生成结果不含时间戳，连续跑两次无 diff。
7. README 中不出现 TODO 的内部细节（依据、服务器路径、验收清单），只有编号/标题/状态/版本。

## 11. 实施顺序

1. 写 `scripts/todo-progress.js` 的解析 + 生成 + `--check`（先只读，不改 README）；
2. 补 `test/todo-progress.test.js` 并接进主链；
3. 迁移 README：删「路线图」、插入标记与空块、跑生成器；顺手修 §5.4 的过期项；
4. 把未排期的产品项迁进 `docs/ROADMAP.md`（新增「未排期想法」小节）；
5. 加 `.github/workflows/docs-progress.yml`；
6. 补 TODO 顶部说明、三个 skill、PROJECT-OVERVIEW；
7. 跑 `npm run todo:progress:check`、`node test/todo-progress.test.js`、`npm test`、`npm run scan`。

## 12. 待确认（有默认值，不阻塞开工）

| # | 问题 | 默认 |
|---|---|---|
| 1 | 「质检通过但未发版」算完成还是进行中？ | 进行中（待发版），不算“最近完成” |
| 2 | 未知状态是否让 CI 直接红？ | 不红：进「待分类」展示，人工补状态词 |
| 3 | 迁进 ROADMAP 的产品项是否要单独排期？ | 不排期，只留想法；需要时再建 TODO |

## 13. 2026-11-11 修订：生成时机（顺序不能反）

> 状态：**已确认（2026-11-11 所有者选 A：保留门禁 + 补流程约束）**。AS 批（v2.3.0）的 §1 决策 3 不变，
> 本节只把「什么时候跑生成器」钉死，避免再出现「门禁红、但内容本可以一致」。

**现象（2026-11-11 BJ 批实测）**：`docs-progress` 连红 3 次——`#41`（开发改状态 9bc665e）、
`#42`（质检回写 d4cf9e1）、`#43`（发版 6615939），三次都改了 `docs/TODO.md` 却没重跑生成器；
其中发版那次尤其必然：README 块的「当前版本」读 `package.json`，**版本号一变块就过期**。
最后 `6eadc18` 只补了一次生成（3 行）就恢复绿。

**规则（写进 HANDOVER §2/§3/§6、DELIVERY §2/§3、dev/qa/build 三个 skill）**：

1. 任何 `**状态：…**` 变更（开发 / 质检 / 发版）**必须在同一次提交里**附带 README 生成结果；
2. **顺序固定**：先改 TODO 状态 → 发版还要先 bump `package.json` 版本号 → **最后**跑 `npm run todo:progress`；
3. 提交前必须有 `npm run todo:progress:check` 通过（失败信息已直接提示要跑的命令，见 §6）；
4. 仍然**不自动提交**（§1 决策 3 不变，避免机器人 commit 与三会话并发冲突）——所以靠流程约束，不靠 CI 兜底。

**验收**：连做三条状态翻页（开发 → 质检 → 发版），每次提交后 `docs-progress` 都绿；
若故意只改 TODO 不生成，`--check` 退出 1 且提示跑 `npm run todo:progress`。
