# QA：AZ / BA / BB / BC 四批（第 1 轮）

> 基线 `fd85d59` → HEAD `dec034d`（实现：AZ `4c5c98d`、BA `44942fd`、BB `96d28a9`、BC `3ebc515`；修正：`dec034d`）。
> 判据：`docs/ADMIN-REVIEW-LISTS.md` §4.6、`docs/RUN-SYNC-REDESIGN.md` §4、`docs/PROXY-POOL.md` §11.6、
> `docs/IMAGE-COVERAGE.md` §4；开发描述来源 TODO 的 AZ/BA/BB/BC 条目。
> 结论：**✅ 放行 —— 通过 18 / 缺失 0 / 偏差 0 / 需人工确认 5**

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | AZ | 异常审核规则摘要只显示「首规则 ×n · 共 N 条规则」，列宽固定不再撑爆 | 后台 → 访问与安全 → 异常审核（合并表） | ✅ | `AdminModules.vue:33`（`label="规则摘要" width="250"`） |
| 2 | AZ | 悬停规则摘要，弹层列出该 IP **全部**规则及次数 | 同上，悬停单元格 | ✅ | `AdminModules.vue:33`（`el-popover trigger="hover"` + `v-for="r in row.rules"`） |
| 3 | AZ | 只有 1 条规则的 IP 不弹空层 | 同上 | ✅ | `AdminModules.vue:33`（`:disabled="!row.rules \|\| row.rules.length<=1"`） |
| 4 | AZ | 移动端卡片同口径（首规则 + 共 N 条规则） | 后台移动端 → 异常审核 | ✅ | `AdminModules.vue:33`（移动卡片同文案）；`test/admin-review-lists.test.js` AZ 断言（2 处文案） |
| 5 | BA | 运行与同步页顶部「任务健康」条：每个任务最近状态/耗时/下次运行 | 后台 → 操作日志 → 运行与同步 | ✅ | `AdminLogs.vue:113-121`（健康条）、`:422-470`（jobState/jobLabel/nextRunText） |
| 6 | BA | 点任务 chip 只看该任务日志；可一键清除筛选 | 同上，点 chip / 「清除任务筛选」 | ✅ | `AdminLogs.vue:474`（`toggleJobFilter` → `logQuery=name` + `loadLogs`）、`:477`（`clearJobFilter`） |
| 7 | BA | 任务健康条每 60 秒自动刷新（页面可见且在该 tab） | 停留页面 | ✅ | `AdminLogs.vue:503-506`（`healthTimer`） |
| 8 | BA | 同步记录精简为 6 列（时间/模式/状态/结果/耗时/备注） | 同上，记录表 | ✅ | `AdminLogs.vue:126-134`（`runResult` 合并计数） |
| 9 | BA | 同步记录默认只显示最近 5 轮，可展开全部 20 轮 | 同上，表格头「展开全部」 | ✅ | `AdminLogs.vue:434`（`visibleRuns`）、`:123`（切换按钮） |
| 10 | BA | 日志面板固定 55vh 内部滚动，筛选条 sticky 在面板头 | 同上，日志面板 | ✅ | `AdminLogs.vue:571`（`max-height:55vh`）、`:574`（sticky head） |
| 11 | BA | 日志行紧凑单行，点击展开完整字段（时间/级别/事件/字段摘要） | 同上，点日志行 | ✅ | `AdminLogs.vue:154-160`（`toggleLogExpanded`）、`:481-489`（`logBrief`） |
| 12 | BA | 移动端：健康条横向滚动、日志面板 50vh | 后台移动端 | ✅ | `AdminLogs.vue:580`（`@media 760px`） |
| 13 | BB | 设置页「立即检测」逐条探测代理池并更新结果 | 后台 → 系统设置 → 网络与代理 → 健康状态 | ✅ | `AdminModules.vue:434`（`probeProxies`）、`server.js:2769`（`POST /api/admin/proxies/probe`） |
| 14 | BB | 状态显示「正常 / 冷却中 mm:ss / 未检测 / 探测失败」+ 最近检测时间 | 同上，健康状态表 | ✅ | `AdminModules.vue:431-433`（`proxyStateText/Type`）、`AdminModules.vue:33`（最近检测列） |
| 15 | BB | 探测失败**不改**业务冷却（fails/downUntil 原样） | 同上（点检测 → 看连续失败/冷却列不变） | ✅ | `proxy-pool.js:307`（`recordProbe` 只写 probe*）；`test/proxy-probe.test.js`「只写 probe* 字段」 |
| 16 | BB | 每 10 分钟 `proxy-probe` 定时任务，`PROXY_PROBE_ENABLED=0` 关闭 | 调度器 | ✅ | `scheduler.js:117`（job）、`cli.js:2321`（`cmdProbe`）；`test/scheduler.test.js` 断言 |
| 17 | BB | 探测与 API 输出地址脱敏，健康文件不含明文 | 同上 / `data/proxy-health.json` | ✅ | `proxy-pool.js:324`（`probeAllProxies` 用 `redactProxy`）；测试断言文件无地址/密码 |
| 18 | BB | 老配置兼容：旧健康文件无 probe 字段时显示「未检测」，字段缺省不报错 | 升级后首次打开 | ✅ | `proxy-pool.js:235-237`（`probeAt/probeOk/probeError` 缺省 null） |
| 19 | BC | `steam-status` 一轮同一次 appdetails 顺带补 `header_image`（零额外请求） | 调度任务 `steam-status` | ✅ | `steam-status.js:46-51`（fill + 日志）、`pg.js:2677`（`fillHeaderImage`）；测试「顺带补齐」 |
| 20 | BC | `backfill` 候选包含「有价但 header_image 为空」的游戏 | 调度任务 `backfill` | ✅ | `cli.js:1792`（OR 扩展）；回归断言「并入 OR 组」 |
| 21 | BC | `images.limit` 默认 500（新库）；生产已保存旧值需部署侧改 | 系统设置 → 高级 → 每轮补图数量 | ✅ | `settings.js:182`（默认 500）、`scheduler.js`（fallback 500）；`test/image-coverage.test.js` |
| 22 | BC | 后台「清除缺图缓存」清空 24h 负缓存（二次确认） | 后台 → 数据统计 → 图片与备份 → 封面缓存 | ✅ | `AdminModules.vue`（`resetImageMiss` + 按钮）、`server.js:2890`（`POST /api/admin/images/reset-miss`） |
| 23 | BC | 前端占位块保持 AW 设计（不改样式，失败仍有兜底） | 前台封面加载失败 | ✅ | `Home.vue` 未在本批改动（diff 无该文件） |

## 逐条核对（规格验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据 | 判定 |
|---|---|---|---|---|
| 1 | AZ-1 列固定宽、单行不溢出 | 读模板 + CSS | `AdminModules.vue:33` width=250；`.rule-summary{overflow:hidden;text-overflow:ellipsis}` | ✅ |
| 2 | AZ-2 弹层列全部规则且与展开行一致 | 读模板 + 测试 | popover 内 `v-for r in row.rules` → `规则 ×n`；展开行仍为 `merged-detail-row` | ✅ |
| 3 | AZ-3 单规则不出现空弹层 | 读模板 | `:disabled` 单条禁用 | ✅ |
| 4 | AZ-4 移动端同口径 | 读模板 + 测试断言 2 处文案 | 同 #23 行证据 | ✅ |
| 5 | BA-1 健康条字段齐全 | 读代码 | `jobs` 来自 `/api/admin/sync/status` 的 `schedule.jobs`（`label/intervalMin/lastRunAt/nextRunAt/lastResult/lastElapsedMs/openUntil`） | ✅ |
| 6 | BA-2 chip 过滤 | 读代码 | `toggleJobFilter` 写 `logQuery` 并刷新；再次点击清除 | ✅ |
| 7 | BA-3 60 秒刷新 | 读代码 + 测试正则 | `healthTimer` 60s，判断 `activeTab==='run' && !document.hidden` | ✅ |
| 8 | BA-4 6 列 + 结果合并文案 | 读模板 + 测试 | `runResult` 拼「成功/跳过/失败」；测试断言无「请求数/总量」列 | ✅ |
| 9 | BA-5 默认 5 轮 + 展开 | 读代码 + 测试 | `visibleRuns` slice(0,5)；`showAllRuns` 切换 | ✅ |
| 10 | BA-6 55vh 内滚 + sticky | 读 CSS + 测试 | `.log-panel-body{max-height:55vh;overflow-y:auto}`、`.log-panel-head{position:sticky` | ✅ |
| 11 | BA-7 行展开/收起 | 读模板 + 测试 | `@click="toggleLogExpanded(index)"` + `v-if="expandedLogs.has(index)"` | ✅ |
| 12 | BA-8 移动端 50vh | 读 CSS | `@media(max-width:760px){.log-panel-body{max-height:50vh}` | ✅ |
| 13 | BB-1 探测结果正确（200/407/超时） | 单测（本地假代理） | `test/proxy-probe.test.js` 4 项全过 | ✅ |
| 14 | BB-2 状态映射 | 读代码 + 测试 | `proxyStateText/Type`；测试断言「未检测/探测失败」 | ✅ |
| 15 | BB-3 不误改业务冷却 | 单测 | `recordProbe` 前后 `fails/downUntil` 相等断言 | ✅ |
| 16 | BB-4 定时任务参数/开关 | 单测 | `interval('proxy-probe')===10`、`args=['probe','--proxy']`、`PROXY_PROBE_ENABLED=0` 剔除 | ✅ |
| 17 | BB-5 脱敏 | 单测 | API 输出与健康文件均不含密码/地址，key 为 hash | ✅ |
| 18 | BB-6 老配置兼容 | 读代码 | probe 字段缺省 null → 前端显示「未检测」 | ✅ |
| 19 | BC-1 steam-status 补 header_image（不覆盖） | 单测（pglite） | `fillHeaderImage` 只改空值；第二次 rowCount=0；日志事件 | ✅ |
| 20 | BC-2 backfill 候选 OR 扩展 | 读代码 + 回归断言 | `cli.js:1792` OR 组；反例断言「不能是独立 AND」 | ✅ |
| 21 | BC-3 limit 默认 500 | 单测 + 调度测试 | `settings.SETTINGS` 默认 500；`args('images')` 为 500 | ✅ |
| 22 | BC-4 reset-miss 鉴权 + cleared | 单测（真实 HTTP） | 匿名 401 / 普通 403 / 管理员 200 + `cleared` 数字 | ✅ |
| 23 | BC-5 占位块不变 | `git diff` | 本批未改 `Home.vue`；AW 的 `.cover-placeholder` 仍在 | ✅ |
| 24 | 纪律：无擅自 tag、无构建产物入库 | `git tag --list` / `git status` | 最新 tag 仍 v2.7.0；`frontend/dist` 未入库 | ✅ |

## 亲自重跑的验证

| 命令 | 关键输出 | 结论 |
|---|---|---|
| `npm test` | **77 个文件 / 617 项 / `# fail 0`**，`EXIT=0` | ✅ |
| `node test/api.test.js` | `# tests 22 / # pass 22 / # fail 0` | ✅ |
| `npm run frontend:build` | `✓ built in 1.86s` | ✅ |
| `npm run scan` | 未发现高置信度凭据 / 可疑密钥赋值 | ✅ |
| `npm run todo:progress:check` | 与 TODO 一致 | ✅ |
| `node test/docs.test.js` | 5/5 无断链 | ✅ |

## 实现期自纠（已修，不判打回）

- **BC 回填候选原写成独立 `AND`**（`g.header_image is null AND 有价`）→ 会**收窄**候选，补不到图；已改为并入
  「缺描述 / 缺 Steam 报价」的 **OR 组**，并加回归断言（`dec034d`）。质检确认当前 SQL 是 OR 语义。
- **BB 探测把 407/403 的中文提示丢了**（`diagnose` 原有「需要账号密码」提示）→ 已在 `probeProxyConnect` 补回，
  测试仍全绿（`dec034d`）。

## 风险提醒（不判错，记录）

1. BA 的任务 chip 在「运行中」时状态点仍为灰（`jobState` 对 running 返回 idle），文案显示「运行中」——观感小瑕疵。
2. BB 的「立即检测」是同步请求：代理池上限 10 条 × 12s 超时最坏 120s，前端有 loading 但会长时间等待；
   后续可改异步任务 + 轮询（本批不做）。
3. BC 生产库若已保存 `images.limit` 旧值（200），代码默认值不生效，需部署侧在设置页改 500（规格 §3.2 已写明）。

## 需人工确认（5）

1. AZ：桌面/手机悬停弹层样式与列宽观感（列固定 250px 是否合适）。
2. BA：1440×900 首屏是否真的能同时看到健康条 + 记录前 5 行 + 日志面板头（本次是静态断言 + CSS 推算）。
3. BA：移动端健康条横滚与 50vh 日志面板的真机手感。
4. BB：设置页点「立即检测」的真实结果（正常 / 407 / 超时的文案与「最近检测」时间）。
5. BC：生产升级后 `steam-status` 一轮 `header_image` 增量、`reset-miss` 清缓存后前台是否立即恢复取图。

## 复检记录

- 第 1 轮（2026-11-10）：四批一次质检，23 条功能全部有代码/测试证据；发现并确认开发期已自纠 2 处（BC 回填 OR、BB 提示）；
  `npm test` / `api.test` / `frontend:build` / `scan` 全绿 → ✅ 放行。
