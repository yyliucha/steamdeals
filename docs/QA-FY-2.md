# QA：FY-2 设置页行列表 + 每项即时保存 + 跨组搜索/只看非默认 + 移动端（第 1 轮）

> 基线 `9d0f268` → HEAD `ba4568b`（实现提交：`3b50a96` 主体 + `521ced8` 守卫重试/headless 增强 +
> `a1f50d3` 跨批测试断言同步 + `ba4568b` 暗色截图；四个提交都只含本批文件）。
> 判据：[SETTINGS-REDESIGN.md](SETTINGS-REDESIGN.md) §1 决策（全部 10 条）、§3.2 行列表、§3.3 即时保存、
> §3.4 搜索/过滤、§3.5 移动端、§7 验收 **3 / 4 / 5 / 6 / 7 / 8**；
> demo：[design/settings-redesign-2026-11-27.html](design/settings-redesign-2026-11-27.html)（`?shot=1` 布局 / `?shot=2` 交互 /
> `?shot=3` 分组与移动端）+ 同名 `-1/-2/-3.png`。
> 范围：只判 FY-2。FY-1 的左导航 / 路由 / 分组定义**未改动**（`src/settings.js` 零改动，
> 左导航模板与 `goSettingsGroup` 原样保留）；另修一处 FY-1 遗留的服务端缺陷（见「争议项 4」）。
> 结论：**✅ 放行 —— 通过 6 / 缺失 0 / 偏差 0 / 需人工确认 2**（另有 1 条规格内部时序冲突已在实现层同时满足，见「争议项 1」）。

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | FY-2 | 右侧每个分区显示「分区标题 + 项数 + 启用状态徽标」 | 后台 → 系统设置 → 任意组 | ✅ 已交付 | `AdminModules.vue:222`（`section-head` + `section-n` + `section-st`）、`:814`（`visibleSections`）；headless「分区标题 ["全局","Steam","杉果","ITAD","GOG / Humble","发现与热度","同步区域"]」 |
| 2 | FY-2 | 一行一项：每行 = label + 帮注 + 控件 + 保存状态 | 后台 → 系统设置 → 任意组 | ✅ 已交付 | `AdminModules.vue:223`（`<SettingsRow v-for="field in sec.fields">`）、`SettingsRow.vue:1-75`；headless「行 38」 |
| 3 | FY-2 | 去掉卡片盒子与「高级 N 项」折叠（层级 3 → 2） | 同上 | ✅ 已交付 | 全文件无 `settings-card` / `settings-fold` / `setting-grid`（静态锁 `test/settings-immediate-save.test.js:382-396`）；headless「settings-card=0 / fold=0 / grid=0」 |
| 4 | FY-2 | 高级项不再折叠，行内加「高级」小标 | 同上 | ✅ 已交付 | `SettingsRow.vue:54`（`isAdvanced`）、`:11`（`item-adv`）；headless「高级小标 11 个」 |
| 5 | FY-2 | 来源徽标（数据库 / 环境变量 / 默认值）与「恢复默认」**hover/focus 该行才出现** | 鼠标移到/键盘聚焦某设置行 | ✅ 已交付 | `SettingsRow.vue:184-197`（`opacity:0` + `:hover` + `:focus-within`）；headless「默认 0 / hover 1 / 移开 0 / focus 1」；行内「恢复默认」真点：二次确认 → `POST /api/admin/settings/restore` → 来源离开「数据库」（headless 实测） |
| 6 | FY-2 | toggle / select 改完即存：1 秒内出现 `✓ 已保存` | 后台 → 系统设置 → 点任意开关/下拉 | ✅ 已交付 | `AdminModules.vue:844-849`（saver）、`:875`（`commitSetting`）、`settingsSave.js:15`（静默 700ms）；headless「750ms 出 ✓」 |
| 7 | FY-2 | int/string/text 输入停止 600ms 后保存；失焦立即保存 | 改任意数字/文本项 | ✅ 已交付 | `settingsSave.js:114-133`（输入防抖 600ms）、`AdminModules.vue:876-884`；headless「450ms 未发 / 600ms 后 1 次 POST」 |
| 8 | FY-2 | 连续改动合并：1.5 秒内多次改动只发 1 次 `POST /api/admin/settings` | 快速连改多项 | ✅ 已交付 | `settingsSave.js:16`（`MERGE_WINDOW_MS=1500`）、`:110-121`（queue/armCap）；headless「1632ms 内 3 项 → POST 1 次」 |
| 9 | FY-2 | 行内三态：`保存中…`（spinner）→ `✓ 已保存`（2 秒淡出）→ 失败 `✕ 原因` | 每行右侧 | ✅ 已交付 | `SettingsRow.vue:117-123`（state 计算）、`:246-268`（三态样式）、`settingsSave.js:17`（2000ms 淡出）；DOM 断言 `settings-immediate-save.test.js:303-340` |
| 10 | FY-2 | 保存失败回滚上次值并标红（不静默丢改动） | 服务端 400/500 时 | ✅ 已交付 | `settingsSave.js:135-150`（catch → `onRollback`）、`AdminModules.vue:846-847`；headless「✕ 超出上限，已回滚 + input 回滚 1500」 |
| 11 | FY-2 | 工具栏只留 **搜索 + 只看非默认**（移除「保存设置」「重新加载」「跟随系统」） | 设置页顶部 | ✅ 已交付 | `AdminModules.vue:212`；静态锁 `settings-immediate-save.test.js:399-410` |
| 12 | FY-2 | 搜索常驻组顶、**跨 7 组**匹配 label/key/help；命中面板显示「组 · 分区」，点击跳组 + 高亮该行 | 设置页搜索框 | ✅ 已交付 | `AdminModules.vue:214-217`（面板）、`:807`（`settingSearchHits`，不按 group 过滤）、`:829-836`（`jumpToSetting`）；headless「数据源页搜到网络与代理 4 条 → 点后 URL 变 /console/settings/network + 高亮 network.steamProxy」 |
| 13 | FY-2 | 「只看非默认」只显示非默认项（含高级项），刷新后仍生效 | 工具栏复选框 | ✅ 已交付 | `AdminModules.vue:799-803`（`settings-only-changed` + `onlyChangedFilter`）；headless「38 项 → 5 项；刷新后仍 5 项，localStorage=1」 |
| 14 | FY-2 | ≤560px 每行改上下两段：label 在上、控件占满宽、保存状态在控件下；触摸目标 ≥44px | 手机浏览器后台设置页 | ✅ 已交付 | `SettingsRow.vue:282-311`（560 断点 / 单列 / 44px）、`AdminModules.vue:1119`（左导航收成下拉）；headless 375px「单列 + column + 行 351px/输入 347px + 开关 44px + 无横向溢出」 |
| 15 | FY-2 | 密钥字段继续复用 FX 的「密码框 + 眼睛」（8 个 secret，Steam 代理仍走原代理弹窗） | 数据源/提醒/网络组的密钥项 | ✅ 已交付 | `SettingsRow.vue:58-64`（`<SecretField>`）、`:117`（proxy/single 判定）；headless「`.secret-field` + `.secret-eye` + 编辑弹窗打开」；`test/secret-reveal.test.js:141` |
| 16 | FY-2 | 离开页面 / 切到别的模块时，未发出的改动强制 flush 一次（不丢改动） | 改完立即切菜单 | ✅ 已交付 | `AdminModules.vue:889-894`（`flushAll` + 切 section watch）、`:1047-1050`（生命周期注册/卸载） |
| 17 | FY-2 | 未保存守卫语义跟着改：即时保存后**只有提交失败**才算「未保存」；选「保存并离开」会把失败项重试一次，仍失败则留在本页 | 有失败项时切菜单 | ✅ 已交付 | `AdminModules.vue:848`（错误态联动 `settingsConflict`）、`:893-902`（`flushSettings` 先 flush 再重试 `lastAttempt`，仍失败抛错留页）、`:1047`（`isDirty:()=>settingsConflict`）、代理弹窗草稿单独注册 `settings-proxy`；静态锁 `settings-immediate-save.test.js:420-424`、`test/unsaved-guard.test.js:63-67` |
| 18 | FY-2 | 深链 `/console/settings/<group>` 直接打开/刷新返回 SPA（原为纯文本 `not found`） | 地址栏/收藏夹/搜索跳组后刷新 | ✅ 已交付 | `src/server.js:2230-2235`（`FRONTEND_PAGE_PREFIXES` + `isFrontendPage`）、`:1191/:2116/:2287` 三处判定切换；`test/serve.test.js:127-160`（真 HTTP 200 + 未登记 404） |

## 逐条核对（规格 §7 验收 3/4/5/6/7/8 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行 / 命令） | 判定 |
|---|---|---|---|---|
| 3 | 右侧「分区标题 + 一行一项」；**页面无卡片盒子、无「高级 N 项」折叠**（模板静态锁） | 静态锁（模板 + CSS 全文件扫描）+ SSR 真渲染 + headless DOM 计数 | ① `AdminModules.vue:220-227`（分区循环 → `SettingsRow`）；② 全文件 `settings-card`/`settings-fold`/`setting-grid`/`setting-rows` 各 0 处（`settings-immediate-save.test.js:382-396`）；③ SSR：`.setting-item` + `.item-adv` + `.item-src` + `.item-restore`（`settings-immediate-save.test.js:303-340`）；④ headless：行 38、`settings-card=0`、`fold=0`、`grid=0`、高级小标 11；⑤ 控件类型保留：bool/el-switch、enum/el-select、int、text/textarea、secret/SecretField 全部命中（headless「控件类型全部保留」） | ✅ 通过 |
| 4 | 即时保存：toggle/select 改后 **1 秒内**出现 `✓ 已保存`；int 停 **600ms** 后保存；失败**回滚原值并标红** | 假计时器纯逻辑（逐毫秒断言 POST 时刻与次数）+ headless 真点击/真输入/真 400 | ① 单改：静默 700ms 发一次，`clock.now()≤1000`（`settings-immediate-save.test.js:98-116`）；② int：input 后 599ms 未发、600ms 发一次且只提交最后值（`:123-136`）；blur 立即且取消防抖（`:138-147`）；③ 失败：`onRollback(key, 20000)` + 行内红字（`:187-208`）；④ headless：toggle 750ms 出 ✓、int 450ms 未发/600ms 发、失败「✕ 超出上限，已回滚」+ 输入框回滚到 1500 | ✅ 通过 |
| 5 | 连续改 3 项（1.5 秒内）只发 **1 次** `POST /api/admin/settings`（断言请求次数） | 假计时器计数 + headless 真点击 3 个开关 + `window.fetch` 计数 | ① 假计时器：0/300/600ms 三次改动 → `calls.length===1` 且 values 三个 key（`settings-immediate-save.test.js:149-157`）；② 上限：每 400ms 改一项 → 1.5s 只发 1 次、4 个 key 同批（`:159-170`）；③ 超窗口后的新改动单独发第二次（`:172-180`）；④ headless：1632ms 内 3 项 → POST 1 次 `{sonkwo.enabled, itad.enabled, gog.enabled}` | ✅ 通过 |
| 6 | 来源徽标与「恢复默认」默认不可见，**hover/focus 该行才出现** | CSS 静态锁 + headless 真鼠标移动 / 真 focus + 计算样式 | ① 静态：`.item-meta{opacity:0}` + `:hover` + `:focus-within` + 触屏兜底（`SettingsRow.vue:184-197`，锁在 `settings-immediate-save.test.js:371-379`）；② headless：默认 `opacity=0`、`Input.dispatchMouseEvent` 移入后 `1`、移开回 `0`、`focus()` 后 `1`（`opacity` 有 0.15s 过渡，断言前等过渡结束） | ✅ 通过 |
| 7 | 搜索跨 7 组命中并可跳组；「只看非默认」过滤生效且**刷新后仍生效** | 静态锁 + headless 真输入搜索 / 真点击结果 / 真刷新 | ① 静态：`settingSearchHits` 不按 group 过滤、label/key/help 三字段（`AdminModules.vue:807`，锁 `:425-437`）；面板「组 · 分区」+ 点击跳组 + 高亮 + 滚动（`:214-217`、`:829-836`）；② 只看非默认 `localStorage['settings-only-changed']`（`:799-803`，锁 `:438-446`）；③ headless：数据源页搜「代理」→ 命中 4 条网络与代理项；点「Steam 专用代理」→ `location.pathname==='/console/settings/network'` 且 `.setting-item.is-hit` = `network.steamProxy`；只看非默认 38→5 项，`Page.reload` 后仍 5 项、`localStorage=1` | ✅ 通过 |
| 8 | 移动端 375px 行改上下两段、控件占满宽、无横向溢出；`npm test`（分段）+ `frontend:build` + `scan` 全绿 | headless 375px 视口 + 计算样式 + 构建/主链/扫描命令 | ① headless 375px：`grid-template-columns=347px`（单列）、`flex-direction=column`、行 351px/输入 347px、开关可点高 44px、`scrollWidth=375=innerWidth`（无横向溢出）、竖排导航 `display:none` + 顶部下拉 `display:block`、移动端改一项仍 ✓ 并 1 次 POST；② `vite build` → `✓ built in 2.28s`；③ `npm test` 分段全绿（见「重跑输出」）；④ `scan-secrets.js` → `✅ 未发现高置信度凭据 / ✅ 未发现可疑的密钥赋值` | ✅ 通过 |

### demo 逐状态对照（`?shot=1/2/3`）

| demo 状态 | 实现 | 证据 |
|---|---|---|
| `?shot=1` 分区标题（`全局 6 项` / `Steam 7 项 + 已启用`） | 分区头 = 名称 + `N 项` + `已启用/已停用` 徽标；高级项 inline（不再是折叠行） | `AdminModules.vue:222`；headless 分区标题列表 |
| `?shot=1` 行 = 左 label/帮注/来源，右控件 + 保存状态 | 同构（`.setting-item` 两列网格；≤560px 变单列） | `SettingsRow.vue:8-75`、SSR 断言 `:303` |
| `?shot=2` ① 三态：`保存中…` spinner / `✓ 已保存` / `✕ 超出上限，已回滚` + 输入框红边 | 三态 + 2 秒淡出；错误行红字（不做红边框，保持与主题 token 一致） | `SettingsRow.vue:117-123/246-268`；headless 三态实测 |
| `?shot=2` ② 默认只有 label+值，hover 才出来源/恢复默认 | `opacity:0` 常驻 DOM，hover/focus 显形；触屏 `@media (hover:none)` 常显 | `:184-197`；headless hover/focus 实测 |
| `?shot=2` ③ 搜索面板「数据源 · Steam / 网络与代理」→ 点击跳组 | 面板显示 `组` 或 `组 · 分区`，点击跳组 + 高亮 + 滚动 | `AdminModules.vue:214-217/829-836`；headless 跳组实测 |
| `?shot=2` ④ 只看非默认（33 → 5 项） | 真实 38 → 5 项（项数随 code 演进，见 QA-FY-1 争议项） | headless 实测 |
| `?shot=3` 移动端：顶部「组名 · N 项 ▾」+ 行上下两段 + 状态在控件下 | 同构（左导航 `display:none`、下拉全宽、单列行） | `SettingsRow.vue:282-311`、`AdminModules.vue:1119`；headless 375px 实测 |
| `?shot=3` 7 组名称/路由表 | 与 FY-1 完全一致（本批未改） | `src/settings.js` 零改动、`router/index.js` 零改动 |

## 打回清单

本轮**无打回项**（通过 6 / 缺失 0 / 偏差 0）。

## 风险提醒（需求外，本批未修，建议单开条目）

- **R1（P2）「恢复默认」在同一进程内值不回落（后端既有行为，非本批引入）**：
  `hydrateSettings` 会把**每个**设置值写进 `process.env`（`src/settings.js` → `env[d.env] = valueToEnv(...)`，全量循环），
  而 `readSettings` 的优先级是 DB → env → 默认。于是一旦在管理员会话里保存过某项（保存后立即水合 env），
  再点「恢复默认」删掉 DB 覆盖行时，值会回落到**刚才水合进 env 的那个值**（= 保存值），表现为「点了恢复默认没变化」。
  headless 实测：`sources.steam.enabled` 保存为 false 后点恢复默认 → 来源从「数据库」变「环境变量」、值仍是 false。
  `test/settings.test.js` 的 CQ 恢复默认用例是在 `env:{}` 的纯函数语境下断言的，所以测不出来。
  建议修法（择一）：① 水合时记录「本进程写过的 env key」，`readSettings` 的 env 兜底跳过这些 key；
  ② 恢复默认后再水合前先把这些 key 从 env 删除；③ 进程启动时快照原始 env，水合只写启动快照里不存在的 key。
  **本批不动后端语义**（交付单红线：不改 setting key / 默认值 / 语义 / 后端接口），仅记录证据。
- **R2（已修复，非本批）基线 `65ea1a6` 上 `test/mail-templates.test.js` 的主链断言是红的**：
  `CO-5/B4-2 第十轮：admin-settings 路由分支不得双实现` 断言 `handleSettingsRoutes({ ... user, afterHydrate`，
  而 FX 批（`975bfce`）给该调用加了 `ip` 参数（`user, ip, afterHydrate`）。**非本批引入、非本批文件**；
  该断言已由他人提交 `29eac6e`（GB 批）同步修好。本批验证时在干净 worktree 临时应用同一行修复（不提交）后跑主链，
  见「主链分段结果」。

## 需人工确认

1. **视觉与 demo 的主观一致性**：headless 已抓 4 张截图并逐张看过（`F:\temp\fy2-shots\`）：
   - `fy2-desktop-sources.png`（亮色，1280×900）：左导航 7 组 + 项数徽标 + 底部「版本 2.31.0 · 配置修订 1 / 改一项即存，约 15 秒生效」；
     面包屑「管理控制台 / 系统设置 / 数据源」；工具栏只剩搜索 + 只看非默认；分区「全局 6 项」「Steam 7 项 已启用」；
     一行一项，无卡片边框；来源徽标/恢复默认默认不可见。
   - `fy2-desktop-sources-dark.png`（暗色，与 demo 配色同款）：配色/边框/输入框底与 demo `?shot=1` 同构。
   - `fy2-desktop-failed.png`：高级小标（「状态判定限速（毫秒） 高级」）、失败行红字「✕ 超出上限，已回滚」+ 输入回滚 1500、
     成功行「✓ 已保存」、密钥行「Steam Web API Key」密码框 + 眼睛、左导航底部「设置保存失败，待重试」。
   - `fy2-mobile-375.png`：顶部「📡 数据源 · 36 项 ▾」下拉、搜索占满宽、行上下两段（label/帮注在上、输入框占满宽在下）、无横向溢出。
   结构/状态/尺寸已实测；「像不像 demo」的观感（行距、hover 过渡、暗色红字对比度）建议所有者再扫一眼。
   demo `?shot=2` 的「输入框红边」本批未做（错误提示用红字 + 行内文案），如需严格一致请提一句，改动只需 3 行 CSS。
2. **真实 400 文案 / 生产热加载**：headless 用 fetch 拦截模拟服务端 400（`{error:'超出上限，已回滚'}`），真实
   `validateSetting` 的中文报错建议人工填一个超 max 的 int 确认一次（预期：行内 `✕ <服务端原因>` + 回滚）；
   保存后调度器水合约 15 秒生效属部署后行为，本地未验证。

## 争议项（待所有者裁定/知悉）

1. **规格内部时序冲突（实现层已同时满足）**：§7 验收 4 要求「toggle 改后 **1 秒内**出现 ✓」，验收 5 要求「**1.5 秒内**
   连改 3 项只发 1 次 POST」。若「改一项立刻发」，3 连改必然 ≥2 次 POST；若「等满 1.5 秒再发」，单改要 1.5 秒后才有 ✓。
   本批用两条计时器同时满足：**静默 700ms 提前 flush** + **合并上限 1500ms**（`utils/settingsSave.js:1-20` 头注释记录推导），
   headless 实测两条均成立（单改 750ms 出 ✓；3 连改 1 次 POST）。如所有者认为应改成「一律等 1.5 秒」，只需把
   `QUIET_FLUSH_MS` 调到 1500（但验收 4 会不达标）。
2. **分区级「恢复本组默认」下线**：旧折叠体底部有该按钮，新分区头按 §3.2 只留「名称 + 项数 + 启用徽标」，
   行级「恢复默认」全部保留。属按规格执行，特此知会。
3. **平铺组（账号与安全 / 提醒与通知 / 网络与代理）没有分区小标题**：这三组在 schema 里没有 `SETTINGS_SECTIONS`
   （`PLAIN_GROUPS`），组标题已在页头（面包屑 + h2 + 描述），再打一遍会重复；demo 未覆盖这三组，按「不重复打标题」实现。
4. **本批顺手修了 FY-1 遗留缺陷**（`src/server.js` + `test/serve.test.js`）：`/console/settings/<group>` 深链/刷新命中
   服务端「前端页面白名单」漏登记，返回纯文本 `not found`（v2.11.0 `/login` 同款事故）；`test/serve.test.js` 的 BM-1
   在 FY-1 合并后**一直是红的**（`router 路径 /console/settings/:group? 已登记进 FRONTEND_PAGES`）。不修则验收 7「跳组后刷新」
   与验收 8「移动端深链」都不成立，故纳入本批；改动仅为「参数化路由前缀白名单」+ 真 HTTP 200/404 断言，
   不触碰任何 setting key / 默认值 / 后端接口语义。

## 反向自检（证明断言真锁住行为）

对实现注入 5 种回归，逐一验证断言变红，再复原复跑（`test/settings-immediate-save.test.js`，复原后 pass 22 / fail 0）：

| 注入的回归 | 预期 | 实测 |
|---|---|---|
| `QUIET_FLUSH_MS` 700 → 1200 | 验收 4「单改 1 秒内 ✓」变红 | ✖ fail=2，首条红「验收 4：toggle 改动后 1 秒内完成保存」 |
| 删掉失败分支的 `onRollback(...)` | 验收 4「回滚」变红 | ✖ fail=1「验收 4：提交失败 → 回滚上次值 + 红字原因」 |
| `queue()` 里改成立刻 `flush()`（不合并） | 验收 5「1.5 秒 3 项 1 次 POST」变红 | ✖ fail=6，首条红「验收 4：toggle 改动后 1 秒内完成保存」 |
| 模板/CSS 塞回 `settings-card` | 验收 3 静态锁变红 | ✖ fail=1「验收 3：右侧是「分区标题 + 一行一项」」 |
| `.item-meta` 的 `opacity` 0 → 1 | 验收 6 静态锁变红 | ✖ fail=1「验收 6：来源徽标与「恢复默认」默认不可见」 |

## 纪律检查（steamdeals-qa §6）

| 项 | 结论 | 证据 |
|---|---|---|
| 无擅自新增 tag（硬规则 5） | ✅ | `git tag --list` 最新仍是 `v2.9.0`（历史 tag），本批未打 tag |
| 未碰部署/服务器配置、未连生产库 | ✅ | 提交仅 13 个文件：`frontend/src/{pages,components,utils}`、`src/server.js`（SPA 白名单）、`package.json`（test:4 注册）、`test/*`；无 compose / DEPLOY / 凭据文件 |
| 构建产物未入库 | ✅ | `git show --stat HEAD` 无 `frontend/dist/`、`*.log`、`data/*-pgdata/`、`out/`、`logs/` |
| 已推 `main` | ✅ | `git push origin main`（`65ea1a6..3b50a96`、`29eac6e..521ced8`、`521ced8..a1f50d3`、`a1f50d3..ba4568b`；推 main 不触发构建）；HEAD == `origin/main` == `ba4568b` |
| 不改 setting key / 默认值 / 语义 / 后端接口 | ✅ | `git show --stat HEAD` 无 `src/settings.js`、`src/settings-routes.js`、`src/store/pg.js`；`test/settings.test.js` 的 112 项 / 8 密钥 / 默认值 / 迁移断言全绿 |
| 密钥查看接口与审计未改 | ✅ | `src/settings-routes.js` 零改动；`test/secret-reveal.test.js` 9/9 绿（含审计 1 条 / detail 只含 key / 400-401-403） |
| 文档收尾（PROJECT-OVERVIEW / TODO / INDEX / CHANGELOG / README / DELIVERY） | ⏳ 由监工统一更新 | 本批交付单纪律（红线）明确工人不改这 7 份文档；`git show --stat HEAD` 无 docs 改动 |
| 工作区有他人未提交改动时的隔离 | ✅ | 提交前工作区含他人改动（`frontend/index.html`、`src/routes/admin-images.js`、`src/store/admin-images-repository.js`、`src/store/pg.js`、`test/{admin-images,image-coverage,pwa,mail-templates}.test.js`、`docs/MOBILE-PWA.md`、`frontend/public/apple-touch-icon.png`）；`src/server.js` 里有一段他人的 `apple-touch-icon` hunk，提交时先临时还原、本次提交只含本批 hunk，提交后已原样恢复（他人这批改动随后由 `29eac6e` 独立提交，未被我带走） |
| QA 报告入库 | ✅ 本批按工人交付单提交 `docs/QA-FY-2.md`（仅报告本身；`docs/TODO.md`/`INDEX`/`DONE`/`DELIVERY`/`CHANGELOG`/`README`/`PROJECT-OVERVIEW` 一律未动，由监工统一更新） |

## 重跑输出（干净 worktree `F:\dsh\wt\fy2` @ `3b50a96`，命令按 steamdeals-dev §7）

| 命令 | 关键输出 |
|---|---|
| `node test/settings-immediate-save.test.js` | `tests 22 / pass 22 / fail 0`（新增：合并窗口 + 输入防抖 + 回滚 + SSR 真渲染 + 静态接线） |
| `node test/settings.test.js` | `tests 22 / pass 22 / fail 0`（含 FY-1 迁移断言 + FY-2 前端接线锁） |
| `node test/admin-console-ia.test.js` | `tests 24 / pass 24 / fail 0`（左导航/路由契约不变 + 右侧改为行列表的静态锁） |
| `node test/secret-reveal.test.js` | `tests 9 / pass 9 / fail 0`（8 个密钥统一经 SettingsRow 复用 SecretField + 审计/权限） |
| `node test/unsaved-guard.test.js` | `tests 8 / pass 8 / fail 0`（设置面 save=flush、代理弹窗单独注册） |
| `node test/proxy-pool-ui.test.js` | `tests 4 / pass 4 / fail 0`（代理编辑器/健康表未回归） |
| `node test/serve.test.js` | `tests 12 / pass 12 / fail 0`（**修复前 BM-1 red**：`/console/settings/:group?` 未登记；现含深链 200 + `/console/nope` 404） |
| `node test/admin-edit-dialog.test.js` | `tests 6 / pass 6 / fail 0`（FX 密钥分支断言已随 FY-2 收进 SettingsRow） |
| `node test/admin-console-mobile.test.js` / `setup` / `csp` / `frontend-registration` / `style-tokens` | `10/10`、`4/4`、`11/11`、`9/9`、`3/3` 全绿 |
| `node node_modules/vite/bin/vite.js build --config frontend/vite.config.js` | `✓ 1763 modules transformed` / `✓ built in 2.28s` |
| `node scripts/scan-secrets.js` | `扫描 678 个文件` / `✅ 未发现高置信度凭据` / `✅ 未发现可疑的密钥赋值` |
| `npm test`（分段 test:1~4，干净 worktree @ `a1f50d3`） | `EXITCODE=0`：四段全绿，142 个测试文件 / 1344 个用例 / **0 失败**（无 `✖`、无 `failing tests`） |
| `node test/api.test.js`（链外；`src/server.js` 改动必跑） | `pass 41 / fail 0` |
| `node test/e2e/settings-rows.mjs`（链外，先 build） | `FY-2 headless 验收：29 通过 / 0 失败` |

### 主链分段结果（`npm test`）

在干净 worktree（`F:\dsh\wt\fy2`，`node_modules` 软链到主仓，基线提交 `a1f50d3`；`ba4568b` 只改链外 e2e 脚本，不影响主链）跑
`npm test` → **`EXITCODE=0`**：四段全绿、142 个测试文件、1344 个用例、**0 失败**（日志 `fail 0` 出现 142 次，无 `✖`、无 `failing tests`）。

| 段 | 结果 | 本批相关的关键文件 |
|---|---|---|
| `npm run test:1` | ✅ 31 个文件全绿 | `serve.test.js` 12/12（深链 200 + 未登记 404）、`proxy-pool-ui.test.js` 4/4、`image-coverage` / `pwa` / `mail-templates` 等一并绿 |
| `npm run test:2` | ✅ 37 个文件全绿 | 与本批无直接文件，验证 `src/server.js` 改动未影响既有 HTTP/调度链路 |
| `npm run test:3` | ✅ 38 个文件全绿 | `admin-console-ia.test.js` 24/24、`admin-console-mobile.test.js` 10/10、`admin-edit-dialog.test.js` 6/6、`csp` 11/11、`style-tokens` 3/3 |
| `npm run test:4` | ✅ 36 个文件全绿 | `settings-immediate-save.test.js` 22/22、`settings.test.js` 22/22、`secret-reveal.test.js` 9/9、`unsaved-guard.test.js` 8/8、`docs.test.js` 5/5 |
| `node test/api.test.js`（链外，`src/server.js` 改动必跑） | ✅ `pass 41 / fail 0` | 真 HTTP + pglite 全量接口 |

> 说明：第一轮主链在 `test:3 / admin-edit-dialog` 打回过一次（见「复检记录 ③」）；修完后从最终提交整轮重跑，上表是**修完后**的结果。

### headless 真交互（`node test/e2e/settings-rows.mjs`，先 `frontend:build`）

```
✔ 登录成功（headless 会话可用）  — POST /api/login → 200
✔ 验收 3：右侧是「分区标题 + 一行一项」  — 行 38 / 分区标题 ["全局","Steam","杉果","ITAD","GOG / Humble","发现与热度","同步区域"]
✔ 验收 3：页面无卡片盒子（.settings-card=0）
✔ 验收 3：页面无「高级 N 项」折叠（.settings-fold=0、无 .setting-grid）
✔ 验收 3：高级项不再折叠，行内出现「高级」小标  — 11 个
✔ 验收 3：每行 = label + 帮注 + 来源 + 恢复默认  — Steam 价格首轮延迟（秒） / 默认值 / 恢复默认
✔ 验收 6：来源徽标与「恢复默认」默认不可见  — 默认 opacity=0
✔ 验收 6：鼠标 hover 该行才出现  — hover=1 / 移开=0
✔ 验收 6：键盘 focus 该行也出现（可访问性）  — focus-within opacity=1
✔ 验收 4：toggle 改后 1 秒内出现 ✓ 已保存  — 耗时 750ms，文案「✓ 已保存」
✔ 验收 4：toggle 只提交该项（局部 values）  — POST 1 次：[{"sources.steam.enabled":false}]
✔ 验收 5：1.5 秒内连改 3 项只发 1 次 POST  — 1632ms 内 3 项 → POST 1 次：[{"sources.sonkwo.enabled":false,"sources.itad.enabled":false,"sources.gog.enabled":false}]
✔ 验收 4：int 输入停止 600ms 后保存（450ms 时还没发）  — 450ms 时 POST=0
✔ 验收 4：int 防抖到点只发 1 次且值是输入值  — POST：[{"sources.steam.priceIntervalMin":720}]
✔ 验收 4：提交失败 → 行内红字原因  — 「✕ 超出上限，已回滚」
✔ 验收 4：提交失败 → 回滚上次值  — 回滚后 input=1500（失败前 1500）
✔ 验收 7：搜索跨 7 组命中（当前组是数据源，仍能搜到「网络与代理」的项）  — 4 条
✔ 验收 7：点结果跳组（URL 换成 /console/settings/network）并高亮该行  — 高亮行 network.steamProxy
✔ 验收 3：密钥行复用 SecretField（密码框 + 眼睛），代理行「编辑」仍打开原弹窗  — 弹窗=true
✔ 验收 3：控件类型全部保留（text 多行 / enum 下拉 / 高级小标）
✔ 验收 7：「只看非默认」过滤生效  — 38 项 → 5 项
✔ 验收 7：刷新后仍然生效（localStorage 记忆）  — 刷新后 5 项，localStorage=1
✔ 验收 8：≤560px 每行改上下两段（单列 + 控件纵向）  — grid-template-columns=347px / flex-direction=column
✔ 验收 8：控件占满宽  — 行 351px / 输入框 347px
✔ 验收 8：左导航收成顶部下拉
✔ 验收 8：触摸目标 ≥44px  — 开关可点高度 44px
✔ 验收 8：375px 无横向溢出  — scrollWidth=375 / innerWidth=375
✔ 验收 8：移动端改一项仍即时保存（✓ 已保存 + 1 次 POST）
✔ 功能：行内「恢复默认」链路可用（二次确认 → 发出 restore → 来源离开「数据库」）

FY-2 headless 验收：29 通过 / 0 失败（截图目录 F:\temp\fy2-shots）
```

## 复检记录

- 第 1 轮（2026-11-27）：按 §7 验收 3~8 逐条核对 → 无打回项 → ✅ 放行。
  过程中发现并修复 3 处**自检缺陷**（均在本轮内闭环，未进入打回清单）：
  ① 设置页深链 `/console/settings/<group>` 在真实服务上 404（FY-1 遗留，`test/serve.test.js` 当时已红）→ 本批修 `isFrontendPage`；
  ② `.item-meta` 的 0.15s 过渡会让「focus 后立即读计算值」读到 0 → 修正 headless 断言等待过渡（实现无问题）；
  ③ **主链 test:3 打回了我第一版**：`test/admin-edit-dialog.test.js` 仍在断言 AdminModules 里
  `field.key==='network.httpsProxy'||...` 的旧密钥分支（FY-2 已把密钥渲染收进 `SettingsRow` 的 type 分支）——
  该用例在干净 worktree 的全量主链里变红（我此前只跑了 settings 相关文件，漏了这条跨批静态锁）。
  已修：断言改锁 `SettingsRow` 的单分支 + proxy/single 模式判定（`test/admin-edit-dialog.test.js:68-80`，6/6 绿），
  并重新从最终提交跑全量 `npm test`。
