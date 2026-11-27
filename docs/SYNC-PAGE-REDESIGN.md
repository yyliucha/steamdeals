# 游戏管理拆分 + 同步与回填页重设计（GA，待开发）

> 状态：**需求与方案已确认（2026-11-27），待开发**。
> 关联：**可交互 demo** [design/sync-page-redesign-2026-11-27.html](design/sync-page-redesign-2026-11-27.html)（`-1.png` 默认态 / `-2.png` 折叠展开态）、
> `frontend/src/pages/AdminModules.vue`（`section==='games'` 段）、`frontend/src/pages/Console.vue`（菜单）

## 0. 背景与现状（2026-11-27 核实）

所有者反馈（截图）：「这里也是一样的问题，tab 过多；并且『同步与回填』页面的元素太多，非常乱」。

**现状：游戏管理一个菜单下 3 个 tab**（游戏目录 / 同步与回填 / 对齐审核），
其中「同步与回填」页平铺 **10 个区块**：

| # | 区块 | 内容 |
|---|---|---|
| 1 | 说明横幅 | 「数据任务由服务器自动执行…」 |
| 2 | 内容分级统计 | 成人/色情/成熟/已回填/未回填 5 卡 + 最近回填时间 |
| 3 | App 版本 | 当前版本 / 上次同步 / 失败原因 / 状态 + 立即同步 |
| 4 | 任务实时进度 | 运行中才出现 |
| 5 | 数据时效 | 价格/状态/中文名/缺封面 × 超 1/3/7 天 + 补跑 |
| 6 | 429 补跑队列 | 排队中/最大重试/最早入队 + 立即补 |
| 7 | 初始化全量同步 | 大按钮 + 说明 |
| 8 | 任务告警 | 缺 Key / 被关掉的任务 |
| 9 | 任务表（12 组） | 组行 + 展开 27 子步骤 + 组级立即运行 |
| 10 | 任务健康 | 当前任务 + 输出尾巴 |

**三个结构性问题**：① 三个 tab 混层级（日常主功能 / 运维 / 审核）；② 10 个区块平铺、主次不分，
天天用的「任务表」排第 9；③ 信息重复（「数据时效」的超期与任务表的「上次/下次运行」是同一件事的两个视角）。

## 1. 已确认的决策（所有者 2026-11-27）

| # | 决策 |
|---|---|
| 1 | **拆成三个一级菜单**（内容运营下）：**游戏目录 / 同步与回填 / 对齐审核**——三种性质不再挤一个菜单 |
| 2 | **页内「任务优先 + 两块折叠」**：顶部概览条 → 任务组表（主）→ 折叠「数据质量」（分级统计 + 数据时效 + 429 队列）→ 折叠「工具」（初始化全量 + App 版本） |
| 3 | demo 做到**全可点**（纯静态假数据、原生 JS）：菜单切换、任务组展开、立即运行（确认弹窗 + toast）、折叠开合、概览卡定位 |
| 4 | 不改任何接口与数据口径（复用现有 `sync/status`、`sync/freshness`、`sync/429queue`、分级统计、App latest） |
| 5 | 群组「立即运行」与子步骤「立即运行」都保留；批量/组级行为不变 |
| 6 | 移动端：侧栏变顶部横向菜单；任务组行改为两行（名称 + 状态，子步骤表横向滚动） |
| 7 | **任务精简（所有者 2026-11-27 追加确认）**：定时任务 **26 → 17**——合并 5 处、转手动 4 个、降频 4 处（详见 §3.7）；界面按「11 个任务组 + 手动任务组」呈现 |
| 8 | 精简后的手动任务（catalog / prune / logs / report / steam-claim）**保留「立即运行」入口**，不再进调度器 |

## 2. 信息架构

### 2.1 后台菜单（内容运营组）

| 现在 | 改为 |
|---|---|
| 游戏管理（内含 3 tab） | **游戏目录** |
| ↑ 同上 | **同步与回填**（本批重设计） |
| ↑ 同上 | **对齐审核** |

`Console.vue` 的「内容运营」组 items 由 `games` 一项拆为 `games` / `sync` / `align` 三项（`AdminModules.vue` 的 `prop section` 沿用，`gameView` 三态取消）。

### 2.2 「同步与回填」页结构

```
概览条（4 卡，可点定位）
  ├ 运行中 1 · 需要关注 2（点击滚到失败组）· 429 队列 37 · 今日待补 11,203
任务与调度（主区）
  ├ 11 个任务组（17 个定时任务）：名称 / 子步骤数 / 最近运行 / 健康 / 「立即运行」
  ├ 展开：子步骤表（子步骤 / 频率 / 上次 / 下次 / 结果 / 耗时 / 操作）
  └ 末尾「手动任务（不进调度器）」组：catalog / prune / logs / report / steam-claim（只保留立即运行）
折叠「数据质量」（标题行带摘要）
  ├ 内容分级统计（5 卡 + 最近回填时间）
  ├ 数据时效（4 卡 7/3/1 天 + 补跑按钮）
  └ 429 补跑队列（3 卡 + 立即补 429）
折叠「工具」（标题行带摘要）
  ├ 初始化全量同步（二次确认）
  └ App 版本（4 卡 + 立即同步）
```

## 3. 交互

1. **概览卡**：「需要关注」点击 → 滚到最近一个失败任务组并展开；「运行中」点击 → 显示当前任务与耗时；
2. **任务组行**：点击展开/收起子步骤；「立即运行」/「立即运行（组）」→ 确认弹窗 → 提交后按钮置「已提交」+ toast（约 15 秒生效）；
3. **折叠区**：标题行点击开合，收起时标题行右侧显示关键摘要（如「分级未回填 112,325 · 价格超 7 天 109,312 · 429 队列 37」）；
4. **补跑按钮**：数据时效 4 个「补跑」与 429「立即补」走同一确认/反馈；
5. **任务实时进度**：运行中任务在概览「运行中」卡与任务组行内显示，不再单独一块占位；
6. **任务告警**（缺 Key / 被关掉）收进任务表头部的 warning 提示条，不再单独一块。

### 3.7 任务精简（26 → 17，所有者 2026-11-27 追加确认）

**现状**：`jobsFromEnv` 里 26 个定时任务（12 个界面组只是分组）；按频率月 5 分钟级 / 8 小时级 / 8 天级 / 5 周级。

| 动作 | 任务 | 做法 |
|---|---|---|
| **合并** | `rename` → `backfill` | backfill 取 appdetails 时顺带写中文名（同一次响应，零额外请求） |
| **合并** | `search-tokens-rebuild` → `readmodel` | readmodel 每日对账后顺带增量重建 token（纯本地计算） |
| **合并** | `images-backfill` → `images` | images 每轮顺带补缺图（同一批封面） |
| **合并** | `explicit-backfill` → `rating-backfill` | rating-backfill 候选并入「strict 色情分级」分支（同链路，候选不同） |
| **转手动** | `catalog` / `prune` / `logs` / `report` | 移除定时，只保留「立即运行」；`report` 仍受 notifier 条件约束 |
| **降频** | `proxy-probe` 10→30 分、`app-release-sync` 15→60 分、`align-snapshot` 30→120 分、`sonkwo` 60→180 分 | 只改默认 `intervalMin`（env 仍可覆盖） |

**保留不动**：steam-prices、backfill、steam-status、rating-backfill、images、readmodel、alerts、steam-accounts、
heat（10 分）、steam-discovery（30 分）、itad、gog、humble、discover、app-release-sync、align-snapshot、proxy-probe。

**兼容要求**：被合并的任务**CLI 命令与参数不删**（`rename` / `search-tokens` / `images-backfill` / `explicit-backfill`
仍可手动跑），只是不再进调度器；`/api/admin/sync/status` 的 `schedule.jobs` 自然少 9 项，前端按返回渲染不写死。

## 4. 数据与接口

- **无新接口**：复用 `GET /api/admin/sync/status`（`schedule.jobs` / `schedule.groups` / `backfillProgress` / `sourceStats` / `forbidden` / `rateGate`）、
  `GET /api/admin/sync/freshness`、`GET /api/admin/sync/429queue`、`GET /api/admin/games/stats`（分级统计）、`GET /api/admin/app-sync/status`；
- 手动触发复用现有 `POST /api/admin/sync`（组/子步骤）、`POST /api/admin/heat|backfill|steam-status|init-sync|images/backfill`、`POST /api/admin/app-sync`；
- 不改表结构、不改接口契约。

## 5. 前端

- `Console.vue`：内容运营组拆三项（`games` / `sync` / `align`），图标与描述按 demo；
- `AdminModules.vue`：`section==='games'` 拆成两段渲染——`games` 目录（原 gameView==='directory'）与 `sync`（新结构）；
  对齐审核（原 `gameView==='align'`）移入 `section==='align'`；
- 新增 `SyncKpiBar.vue`（概览条）、`TaskGroupTable.vue`（任务组表，含展开与立即运行）、`SyncFold.vue`（折叠容器）；
- 任务组/子步骤状态渲染沿用现有 `groupState` / `stepRow` / `partialReason` 逻辑；
- 移动端：侧栏横向滚动、任务组行两行、子步骤表可横向滚动；
- **demo**：[design/sync-page-redesign-2026-11-27.html](design/sync-page-redesign-2026-11-27.html)（可交互，`?open=quality,tools&expand=1,3` 控制初始态），
  验收必须「与 demo 一致」；demo 内嵌状态↔断言对照见 §7。

## 6. 安全与权限

- 权限不变（`requireAdmin`）；手动触发仍走现有接口与互斥（重任务单槽）；
- 初始化全量同步仍二次确认（危险动作，文案保留「默认 20 万上限」）；
- 无新增密钥/凭据。

## 7. 验收（8 条，分两批）

### GA-1 界面（4 条）

| # | 验收 | 对应 demo 状态 |
|---|---|---|
| 1 | 内容运营组出现三项一级菜单（游戏目录 / 同步与回填 / 对齐审核），点击直达；游戏管理不再有内部 tab | 左侧菜单 |
| 2 | 同步与回填页自上而下：概览条 → 任务表 → 折叠数据质量 → 折叠工具；**页面上没有平铺的 10 个区块**（静态锁） | 图 1 |
| 3 | 概览 4 卡数字来自 `sync/status` + `freshness` + `429queue`；「需要关注」点击滚到失败组并展开；折叠收起时标题行显示摘要 | 图 1 / 图 2 |
| 4 | 12→11 任务组 + 「手动任务」组：点击展开/收起子步骤；组级与子步骤级「立即运行」都弹确认 → 按钮置灰 + toast；告警收进表头提示条；移动端 ≤980px 侧栏变顶部横向菜单 | 图 1（手动组收起态）/ 图 2 |

### GA-2 任务精简（4 条）

| # | 验收 | 断言 |
|---|---|---|
| 5 | `jobsFromEnv` 定时任务 **26 → 17**（合并 5 处 + 转手动 4 个），界面组 12 → 11 + 手动组 | 单测断言任务名集合（不多不少） |
| 6 | 降频 4 项默认值：proxy-probe 30 / app-release-sync 60 / align-snapshot 120 / sonkwo 180（env 仍可覆盖） | 单测断言 `intervalMin` |
| 7 | 4 处合并逻辑真生效：backfill 顺带写中文名、readmodel 顺带重建 token、images 顺带补缺图、rating-backfill 含 strict 色情分级 | 各自单测（真 pglite / mock） |
| 8 | 5 个手动任务仍可「立即运行」（catalog / prune / logs / report / steam-claim），被合并任务的 CLI 命令未删；`npm test`（分段）+ `frontend:build` + `scan` 全绿 | CLI 实跑 + 构建 |

## 8. 实施顺序

**拆两批（每批一个 QA 单元、验收各 4 条）**：

| 子批 | 内容 | 验收 |
|---|---|---|
| **GA-1** 界面 | 菜单三项 + 页结构（概览/任务表/两折叠）+ 告警收表头 + 手动任务组 + 移动端 | §7 的 1~4 |
| **GA-2** 任务精简 | 合并 4 处 + 转手动 4 个 + 降频 4 处 + 兼容（CLI 命令不删） | §7 的 5~8 |

依赖：两者无强依赖，建议 **GA-1 先**（界面先按「17 定时 + 手动组」渲染，GA-2 再改后端；任务数变化由接口返回驱动，前端不写死）。

## 9. 待确认

无（四项已于 2026-11-27 确认：三项一级菜单 + 任务优先/两块折叠 / 可交互 demo / 任务精简六类动作（合并 4、转手动 4、降频 4））。
