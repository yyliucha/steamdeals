# 变更日志

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [2.5.0] - 2026-11-09

AU 批：`pg_trgm` 搜索索引 + 封面图缓存总量上限 + 愿望单诚实口径（AA 方案 A）。见 [docs/TODO.md](docs/TODO.md) 的 AU 条目。

### 新增

- **搜索索引（D1）**：迁移建 `pg_trgm` 扩展与 3 条表达式 GIN 索引（`games.name` / `games.name_en` /
  `game_aliases.platform_title`），表达式与 `gameKeywordSql` 的字段侧归一化逐字一致（去半角/全角空格 + lower）；
  本地 pglite 无扩展时静默跳过、迁移不中断。
- **封面图缓存总量上限（D2）**：新设置 `images.maxBytes`（字节，0=不限）；超限按 mtime 从最旧清理（只删 `.jpg`）；
  `node src/cli.js images prune --max-bytes <字节>` 手动清理；`images pull` 结束自动清理（调度器任务同样生效）。

### 修复

- **愿望单提示口径（AA 方案 A）**：Steam `AddToWishlist` 对 Web API Key 返回 401（已停止接受第三方写入），
  前端弹窗与加入/移除提示改为「仅本站保存」「Steam 推送暂不支持」，不再出现「推送失败」字样；
  服务端失败日志与 reason、推送分支代码保留，每日只读同步不受影响。

### 测试

- `test/images.test.js`：超限按最旧删除 / 上限内不动 / 0=不限；
  `test/pg.test.js`：迁移含三条索引表达式 + pglite 两次 migrate 不中断；
  `test/wishlist.test.js`：诚实口径断言（含「不再出现推送失败」反例）。

## [2.4.0] - 2026-11-09

AT 批：后台信息架构改版——新建/编辑改右侧抽屉、操作日志合并 5 tab、邮件与设置 tab 化、价格变化悬停线图（规格 [docs/ADMIN-CONSOLE-IA.md](docs/ADMIN-CONSOLE-IA.md)）。

### 新增

- **新建用户 / 新建·编辑站点通知改右侧抽屉**：用户管理与站点通知页只留列表；抽屉不跳页、列表不刷新、
  关闭后筛选/分页/滚动位置不丢；`?section=users&drawer=new`、`?section=announcements&drawer=new&id=…` 可直达；
  新建用户成功后临时密码在抽屉内一次性展示（可复制）；通知抽屉带前台预览；未保存离开提醒对抽屉照常生效。
- **操作日志（新菜单，5 tab）**：侧栏新增「日志审计 / 操作日志」，删除「批量操作记录」「运行日志」两个菜单；
  一页收拢用户删除 / 批量操作 / Steam 账号 / 邮件发送 / 运行与同步（含实时输出，10 秒轮询只在 tab 打开时跑）；
  `?tab=` 直达、切 tab 懒加载 + 内存缓存、顶部显示条数；旧书签 `?section=bulk-ops` / `?section=sync` /
  `?section=mail&tab=records` 自动映射不 404；用户删除 tab 上限 200 + 日期范围筛选。
- **Steam 账号操作审计**：新表 `steam_account_logs` 记录绑定 / 解绑 / 认领 / 同步游戏库 / 同步愿望单 /
  更换 API Key / 级联删除 7 类动作（失败也记录并带原因与耗时；`user_id` 不挂外键——用户被删后日志仍在）；
  `GET /api/admin/steam-logs`（limit≤500 / steamId / action / result / days）；保留 180 天并入现有
  `prune` 周任务（`--steam-days` 可调）；Steam 账号页「操作日志 ↗」入口与行内「日志」链接。
- **邮件服务 3 tab**：配置 / 模板 / 发送测试分开；发送记录只留「查看发送记录 ↗」一个入口（跳到操作日志·邮件发送）。
- **系统设置 6 tab**：折叠面板改为 tab（与旧 6 分组一一对应、项数一致），搜索命中自动切到对应 tab。
- **价格变化悬停线图**：删除底部「近 7 天变化」表；悬停「变化」列即时弹该游戏近 7 天线图（7 天最低 / 当前、
  无数据空态）；`/api/admin/reports/price` 移除 `daily`、新增 `series`（报告内 game_id 一次查出每日最低，无逐行请求）。

### 测试

- 新增 `test/admin-console-ia.test.js`（11 项：审计落库/失败记录/删用户后日志保留/180 天清理/序列批量查询/
  接口鉴权与筛选/前端接线静态断言）接入 `npm test` 主链；
  `unsaved-guard` / `auth-pages` / `admin-bulk` / `proxy-pool-ui` / `frontend-registration` / `api.test.js`
  断言随抽屉化与报表字段更新。

## [2.3.0] - 2026-11-09

AS 批：README 开发进度摘要（自动生成）+ docs-progress CI 防漂移 + README 过期项修正。

### 新增

- **README「开发进度」自动摘要**：`docs/TODO.md` 仍是唯一排期来源，`scripts/todo-progress.js`
  解析每条目的状态行，生成 README 标记块（当前版本 / 进行中 / 接下来 / 最近 5 个完成 + 计数）；
  未知状态进「待分类」不静默丢失；生成不含时间戳、可重复生成。
- **本地命令**：`npm run todo:progress`（生成）/ `npm run todo:progress:check`（校验）。
- **CI `docs-progress`**：README 与 TODO 不一致时变红并提示命令，只在相关文件变更时运行，不触发镜像构建。

### 修复

- **README 过期描述**：Docker 部署行改「已发布镜像」；多区服两处口径统一为「同屏并排」；
  删除过期「路线图」段（已完成项不再挂 `[ ]`），未排期产品项迁入 `docs/ROADMAP.md`。

### 测试

- 新增 `test/todo-progress.test.js`（8 项：分类顺序、最近 5 个、待分类兜底、标记替换、幂等、check 语义），
  接入 `npm test` 主链。

## [2.2.1] - 2026-11-09

Steam 价格同步优化（F 批）：限速收紧 + 热点优先 / 冷门降频。

### 新增

- **Steam 价格同步优化（F 批）**：`steam-prices` 请求间隔 1100 → **1600ms**（约 187 次/5 分钟，
  回到 Steam 200 次/5 分钟配额内，不再靠 429 冷却兜底）；选取条件改**热点优先 + 冷门降频**——
  热点（近 90 天有访问 / 有用户标记 / `heat ≥ 1`）每天刷，冷门在最近价格快照超过 **3 天**未更新才刷，
  排序 `is_hot desc, last_snap asc`；阈值可用 `STEAM_PRICES_HOT_HEAT_MIN`（默认 1）/
  `STEAM_PRICES_COLD_DAYS`（默认 3）调整；不新增调度任务。测试 `test/steam-prices-priority.test.js`。
## [2.2.0] - 2026-11-09

后台列表排序（AQ 批）+ 三个线上问题的修复（heat/catalog 静默失效、未保存弹窗反复出现）一起交付。

### 新增

- **价格历史报表视图（AP 批，docs/PRICE-HISTORY-REPORT.md）**：游戏详情价格历史从 chip 网格改为**报表视图**——
  指标条（区间最低 / 区间最高 / 当前较史低 / 记录天数）+ 手写 SVG 趋势线（史低点绿）+ 表格（日期 / 当日最低 /
  较前一日 / 标记，**史低行整行高亮 + 徽标**），范围「近 30 天 / 近 90 天 / 全部」，移动端卡片化。
- **后台游戏列布局 + 平台链接抽屉重做（AO 批，docs/ADMIN-LINKS-DRAWER.md）**：游戏列改 flex——名称单行省略、
  复制图标固定行尾、英文名悬停看全名；复制内容 = **中英文两行**（相同/仅中文时仅一行）；**点游戏名开抽屉**（复制只点图标）；
  抽屉重做：封面 + 中英文名 + AppID + 每条渠道一张卡（平台/区服/现价/划线原价/折扣/库存/更新时间/打开）+ 空态兜底 + 移动端全屏。
- **异常审核「按 IP 合并」视图（AR 批，docs/ADMIN-REVIEW-LISTS.md §4）**：待审列表加「按 IP 合并」开关（默认关，
  状态存 localStorage）；同 IP 的多条规则合成一行（规则摘要 / 总次数 / 首末时间 / **设备数** / 状态），
  展开看每条明细；处置（封 IP / 封设备 / 忽略）作用于该 IP **全部待审记录**，确认弹窗写明条数；
  状态混合显示「部分已处理」；勾选合并行 = 该 IP 全部待审，批量栏显示「N 个 IP · M 条记录」；移动端卡片化。
- **后台访问/异常列表排序（AQ 批，docs/ADMIN-REVIEW-LISTS.md §3）**：
  - 异常审核列表**客户端排序**：最近出现 / IP / 次数 / 规则，默认「最近出现 ↓」，
    IP 按**数值序**（IPv4 转整数、IPv6/异常值排后、空值最后），排序状态存 `localStorage`，切换不重置筛选；
  - 访问明细**服务端排序**：`GET /api/admin/visitors` 新增 `sort=time|ip|status` + `order=asc|desc` **白名单**
    （非法回落默认；IP 用零填充字符串键，不用 `ip::inet` 防脏数据炸查询），换排序回第 1 页；
  - 异常审核拉取上限 300 → **500**，列表头显示「共 N 条（上限 500）」。

### 修复

- **愿望单六项产品缺陷（AA 批，docs/WISHLIST-FIX.md §4）**：失败账号的日志与提示带**原因**
  （未配 Key / 解密失败 / Steam 拒绝）、无 Steam AppID 条目明确「仅本站」不再弹多选、
  无绑定账号提示「绑定后可同步推送」、未配 Key 账号在弹窗置灰注明；新增 `test/wishlist.test.js`（7 项）。
- **heat 任务静默失效（C1，docs/TODO.md C 段）**：AB 批把 `fetchJson` 改为返回 `{...res, json}` 后，
  `heat` 仍按旧契约解包（`data[appid]`）→ 永远取到 undefined → **全量「无效跳过」、写 0 条热度**；
  `steam-catalog` 同因空跑（新游戏进不了库）。改为 `data.json` 解包，新增
  `test/fetchjson-contract.test.js` 锁契约，防再犯。
- **后台「放弃修改」后弹窗反复出现（AN 回归）**：`discard()` 只放行一次导航、不清任何草稿，而 Console 切换
  section 不卸载组件 → 草稿一直挂着、每次导航都弹。现在注册签名支持 `discard` 回调，五个编辑面各自清草稿，
  新增 2 项回归测试（「放弃后 dirtySources 为 0、下次导航直接放行」）。

### 文档

- **AA 方案 A 定案（docs/WISHLIST-OAUTH.md）**：愿望单推送 Steam 失败根因为 `HTTP 401 → api.steampowered.com`
  （写接口不接受 Web API Key，只读 GetWishlist 正常）；经所有者确认采用**方案 A「诚实提示」**——
  改为中性文案「已加入本站愿望单（Steam 推送暂不支持）」+ 文档说明，不投入 OAuth 改造。开发描述已入规格，待排期。

## [2.1.0] - 2026-11-09

认证与账号系统（AK/AL）、Steam 代理池设置页（AM-2）、后台未保存离开提醒（AN）与同步可靠性（AC-2/3/4）九批一起交付。

### 新增

- **密码策略 + 哈希升级（AK-1 批，docs/AUTH-REDESIGN.md §4.1/§4.2）**：
  - 新增 `src/password-policy.js` 与 `src/data/common-passwords.js`（Top 1 万常见密码 + 常见词数字尾巴变体）：
    最低 **12 位**（≤200）、含用户名/邮箱 @ 前部分、全同字符、连续序列判定与 0–4 评分；
  - scrypt 版本化哈希 `$scrypt$32768$8$1$…`（旧 `salt:hash` 兼容，登录成功**静默升级**）；
    登录时评估 `weak_password` 落库；六个设置密码入口统一策略（初始化/后台建号/后台重置/自助重置/CLI/注册/改密）；
  - `POST /api/password/check`（匿名、每 IP 每分钟 30 次）给前端强度条。

- **登录防护 + 后台安全标识（AK-2 批，docs/AUTH-REDESIGN.md §4.3/§4.4）**：
  同 IP 15 分钟失败 ≥20 次 → 429（不消耗账号尝试次数）；账号 5 次错密码锁 15 分钟（第 6 次 429 + 剩余时间）；
  成功清零；登录失败统一「用户名或密码错误」（不暴露禁用）；管理员解锁（`POST /api/admin/users/:username/unlock`）；
  「记住我」30 天/默认 7 天；后台用户列表「已锁定/弱密码/需改密」tag。

- **账号流程（AK-3 批，docs/AUTH-REDESIGN.md §4.5–4.8）**：
  后台建号/重置密码可留空 → 16 位随机临时密码（只回一次）+ 首登强制改密；重置不再顺带启用账号；
  开放自助注册（开关 `auth.registrationEnabled`、SMTP 未配置 503、唯一性 409、图形验证码 + 发码限流、
  建号即验证并自动登录）；登录用户修改密码（旧密码校验、踢其它会话保留当前、weak 清除）；
  `must_change_password` 用户业务接口 403（白名单放行）。

- **登录 / 注册 / 改密页面（AL 批，docs/AUTH-REDESIGN.md §5）**：
  独立 `/login`（桌面左右分栏 + 移动单列、三模式、Caps Lock 提示、错误就地、记住我、回跳 next 站内校验）、
  `/register`（强度条 + 60 秒倒计时 + 不可用说明）、`/change-password`（forced 提示）；
  首页不再弹登录框；任意接口 401 → `/login?next=…`；后台新建/重置密码「随机生成」+ 临时密码弹窗。

- **Steam 代理池设置页（AM-2 批，docs/PROXY-POOL.md §5）**：
  「网络与代理」的 Steam 专用代理从单行输入改为**列表编辑器**（查看并编辑走明文通道、增/删/上移/下移、
  上限 10 条、清空全部；前端校验 http/https 与 ≤10 报行号，服务端兜底）+ 健康状态表
  （正常/冷却中倒计时/未知、连续失败、冷却到、最近错误）+ 每 10 秒自动刷新。

- **未保存修改的离开提醒（AN 批，docs/UNSAVED-GUARD.md）**：
  系统设置/邮件配置/站点通知/编辑游戏/新建用户五个编辑面有未保存修改时，切菜单或离开路由弹三选一
  （保存并离开/放弃修改/留在本页）；刷新关闭不拦；401 跳转 bypass；当前菜单项未保存小圆点。

- **同步价格/吞吐/可靠性三批（AC-2/3/4 批，docs/SYNC-FAILURE-MODES.md）**：
  `steam-status` 判 ok 顺带写首次报价 + 「已同步」口径 = ok+有报价；回填新游戏优先 + 上限 5 万 +
  每日 Steam 配额预算超限自动降频告警；熔断面板可见 + 手动重置（`POST /api/admin/circuit/reset`）；
  429 冷却落盘跨子进程共享（`data/steam-429.json`）；报价解析结构校验（`adapter.<平台>.shape_mismatch`）。

### 修复

- 修复 AI 批遗留的测试断言过期（验证码模板主题与 multipart 正文提取）。

### 测试

- 新增 `test/password-policy.test.js`（11 项）、`test/auth-lockout.test.js`（6 项）、`test/register.test.js`（4 项）、
  `test/password-change.test.js`（4 项）、`test/auth-pages.test.js`（7 项）、`test/proxy-pool-ui.test.js`（4 项）、
  `test/unsaved-guard.test.js`（5 项）接入主链；扩展 `test/steam-status.test.js`（AC8）、`test/scheduler.test.js`（AC9/AC4/AC2）、
  `test/http-error.test.js`（AC6）、`test/pg.test.js`（AC7）；主链 66 文件 / 542 项全绿。

## [2.0.0] - 2026-11-06

账号生命周期三件套（用户彻底删除 AH、邮件模板化 AI、账号变更通知 AJ）与 Steam 代理池 AM-1 一并交付，跃升大版本 2.0.0。

### 新增

- **邮件模板 + HTML 邮件 + 发送记录（AI 批，docs/USER-LIFECYCLE.md §3.1/§3.3/§4.3/§4.4/§4.5/§5.2）**：
  - `buildMessage`/`sendMail` 支持 **HTML 多部分**（`multipart/alternative`，text/plain 兜底 + text/html，均 base64）；
    主题在 `encodeSubject` 里先过滤 CR/LF（防头注入）；
  - 新增 `src/mail-templates.js`：9 个事件（8 类账号通知 + 验证码）默认模板、渲染（变量 HTML 转义、
    未知变量原样保留、统一页脚代码追加、text 自动兜底）、保存前校验（主题 ≤200 去换行、HTML ≤20000、
    `{{code}}` 仅验证码可用）、3 套示例版式（简洁/卡片/正式）；
  - 模板存 `mail_templates`（表里没有 = 用代码默认；恢复默认 = 删表行）；管理接口
    `GET/PUT /api/admin/mail/templates`、`POST .../:event/reset|preview|test`（测试发 10 秒限流、写 `mail_log`）；
  - 通知类邮件落 `mail_log`（`GET /api/admin/mail/log`），验证码仍由 `email_codes` 记录；
    登录/重置/绑定三类验证码邮件套用 `verify_code` 模板（模板被停用时回退内置纯文本，验证码是功能性邮件不断发）；
  - 「邮件服务」页新增模板卡（事件 tab、启停、主题/HTML 编辑、变量按钮、预览/发测试/套用示例/恢复默认/保存）
    与「最近发送记录」验证码/通知双 tab；`admin-ui.js` 补注册 `ElTabs`/`ElTabPane`。

- **用户彻底删除（AH 批，docs/USER-LIFECYCLE.md §3.2/§4.1/§5.1）**：
  `DELETE /api/admin/users/:username`（`confirmUsername` 必填精确匹配）——删自己 400、最后一个可用管理员 409、
  不存在 404；单事务先清 `steam_games`/`steam_wishlist`（两张表无外键）再删 `users`（其余级联，被删用户会话立即失效）；
  审计落 `admin_user_deletions`（邮箱打码、关联计数、操作者快照、可选原因，不含密码/Key/token）；
  删除后用户名可立即重新注册。前端用户表加「删除」（自己那行不渲染、最后一个可用管理员置灰）+
  确认弹窗（列出会话/Steam 账号/愿望单与标记，输入用户名才可提交，可选原因只进审计）+
  「最近删除」只读审计表（按用户名模糊搜索，`GET /api/admin/users/deletions?q=`）。
  `listUsers` 附带 `sessions`/`steam_accounts` 计数供弹窗展示。通知邮件随 AJ 批接入。

- **账号变更通知（AJ 批，docs/USER-LIFECYCLE.md §4.2/§6）**：
  - 新增 `src/account-notify.js`：8 类事件（禁用/启用/删除/改名/改邮箱/改角色/重置密码 + 邮箱绑定成功）渲染与发送，
    模块级串行队列（同进程一封一封发）、单封超时 8 秒失败不重试、每次真实发送写 `mail_log`（成功/失败都落，actor 记真实操作者）；
  - 四个入口接入：PATCH 改用户（字段实际变化才发、一次请求最多一封、优先级 禁用 > 角色 > 显示名、结果进响应）、
    改邮箱（发两封：旧邮箱「登录邮箱已变更」+ 新邮箱「绑定成功」；旧邮箱空/未验证改发新邮箱；新旧相同只发一封；解绑不发）、
    重置密码（正文绝不写新密码）、删除（异步 `notify:'queued'`）；批量禁用/启用不发（决策 9）、创建用户不通知；
  - 操作者统一「站点管理员」（`mail_log.actor` 另记真实操作者）；正文不含密码/token/API Key/IP/完整邮箱，删除原因不进邮件；
    模板停用跳过（`skipped_disabled`）、未绑定邮箱跳过并提示（`skipped_no_email`）、发送失败不影响业务（`failed`）；
    前端各入口带 notify 回执 toast。

- **Steam 代理池后端（AM-1 批，docs/PROXY-POOL.md §3/§4）**：
  - `network.steamProxy` 支持多条（换行/逗号分隔、去重、上限 10 条、非法行报行号；老单行 = 1 条且行为完全不变）；
  - 新增 `src/proxy-pool.js`：候选顺序（最近成功者粘住优先 → 配置顺序跳过冷却中的 → 全部冷却取最早解冻再试一次）、
    失败冷却 60s / 5min / 30min 封顶、成功清零；健康状态落 `data/proxy-health.json`（sha256 key 不含地址密码、
    1 秒防抖 + tmp→rename 原子写、跨子进程共享）；
  - `http.js` 把选代理挪进重试循环：只有代理层失败（连不上/超时/TLS/代理 CONNECT 4xx/5xx）才换下一条，
    目标 HTTP 5xx 与 429 不切换（429 按出口 IP 限流，切代理等于绕配额）；全部失败抛 `PROXY_ALL_FAILED` **不回退直连**；
    `GET /api/admin/proxies`（仅管理员、地址脱敏）返回每条状态（正常/冷却中/未知、连续失败、最近错误）；
    diagnose 输出代理池条数与每条状态。

### 测试

- 新增 `test/mail-templates.test.js`（7 项）、`test/notify-html.test.js`（3 项）接入主链：
  默认模板/变量转义/未知变量/页脚/text 兜底、校验（CR/LF、{{code}}、未知变量警告）、示例版式、DB 存取；
  multipart 结构、纯文本兼容、主题防注入。

- 新增 `test/admin-user-delete.test.js`（4 项）接入主链：护栏四态、级联清理 + 手动清无外键表 + 审计脱敏、
  删除后可重新注册 + 列表计数、最近删除模糊搜索（ilike/limit）。

- 新增 `test/account-notify.test.js`（8 项）接入主链：8 事件渲染与 mail_log、跳过/失败路径、串行队列、
  PATCH 四类入口与优先级、密码正文无明文、改邮箱两封（含相同只发一封/旧邮箱未验证改发新邮箱/解绑不发）、
  删除异步通知与批量不发（决策 9）。

- 新增 `test/proxy-pool.test.js`（8 项）、`test/http-proxy-failover.test.js`（7 项）接入主链：
  多条解析/候选顺序/冷却阶梯/健康文件脱敏与重启持久/设置校验（行号、≤10）/`/api/admin/proxies` 权限与脱敏；
  故障切换断言「第 2 次尝试的代理 ≠ 第 1 次」（逐次记录实际代理）+ 反例自检（`nextCandidate` 恒返第一条 → 套件变红）。

## [1.18.0] - 2026-11-06

### 新增

- **版本徽标按服务器 IP 选镜像仓库（AE 批，docs/VERSION-SOURCE.md）**：`detectRegion()`（`ipinfo.io`，
  2s 超时、成功缓存 24h / 失败 10min）→ 大陆/香港优先腾讯云 TCR、其他地区优先 Docker Hub
  （两仓库都走匿名 token，401 换新 token 重试；tag 无 `v` 前缀、过滤 `X.Y.Z` 取最大）；
  首选失败回退另一仓库、双失败回退 GitHub；结果带 `source`/`region`；成功缓存 6h / 全失败 10min。
- **后台平台链接抽屉 + 游戏名复制（AG 批，docs/ADMIN-PLATFORM-LINKS.md）**：后台「游戏管理」新增
  「链接」列（`link_count`，只计 http/https），点击打开抽屉按需加载该游戏全部平台链接
  （`GET /api/admin/games/:id/links`，按平台/区服排序、`javascript:` 过滤、无链接但有 AppID 给 Steam 兜底）；
  后台游戏名/AppID 与前台卡片/详情标题点击复制（`frontend/src/utils/clipboard.js`：clipboard API +
  `execCommand` 降级，HTTP 环境可用）。
- **同步观测与任务健康（AC-1 批，docs/SYNC-FAILURE-MODES.md §6）**：heat/rename/backfill/discover/images/
  backup/prune/alerts/report/logs-prune 全部写 `sync_runs`（后台「同步记录」可见）；重任务排队可观测
  （`scheduler.job_wait_slot`/`job_wait_end` 日志 + 状态文件 `waitingFor`）；后台任务表新增「上次结果 /
  耗时 / 失败原因 / 等待」列；`/api/admin/sync/status` 返回 `warnings`（缺 `STEAM_API_KEY` 或被
  `*_ENABLED=0` 关闭的任务），「同步与回填」页顶部显式提示。

### 修复

- **搜索态写操作后列表不刷新（AF 批，docs/FRONTEND-STALE-LIST.md）**：加/删愿望单、切换感兴趣/已拥有
  标记、取消提醒成功后先失效 30 秒搜索缓存再重拉列表（`invalidateSearchCache()`），不再"点了没反应"；
  无搜索词与缓存能力不变。

### 测试

- 新增 `test/frontend-search-cache.test.js`（6 项静态断言）与 `test/admin-games.test.js`（3 项 HTTP 级）；
  `test/version.test.js` 新增 7 项（CN→TCR / US→Hub / 401 换 token / geo 降级 / 缓存 / tag 过滤）；
  `test/scheduler.test.js` 新增 2 项（auditJobs / 状态文件健康字段）；主链 56 个文件全绿。

## [1.17.0] - 2026-11-06

### 新增

- **搜索支持中英文（含平台中文别名，AD 批 docs/SEARCH-I18N.md）**：
  - 关键词条件收敛到 `db.gameKeywordSql`——`name` / `name_en` / `game_aliases.platform_title`
    三源命中（exists 子查询防重复行），前台搜索与后台「游戏管理」搜索同口径；
  - 空格（半角/全角）在关键词与字段两侧都归一化后再包含匹配，搜「英雄连 3」与「英雄连3」结果一致；
  - 纯数字关键词继续按 AppID 精确匹配（走索引）；
  - `rename` 任务候选放开为「name 不含中文即补中文名」（写入仍走 `upsertGameMeta`，
    人工维护的名字不会被覆盖）。不做人工中文别名字段、不做拼音搜索（所有者已确认）。

### 测试

- `test/store-browse.test.js` 新增 3 项：中文命中 name 与平台别名 + 英文回归、空格/全角归一化一致、
  后台「游戏管理」搜索 HTTP 层同口径验证。

## [1.16.4] - 2026-11-06

### 修复

- **Steam 状态判定整轮静默不写库（AB 批，docs/STEAM-STATUS-FIX.md）**：
  - 根因：取 appdetails 条目时少取 `.json`（`res[appid]` 应为 `res.json[appid]`）→ 两个 entry 恒为 undefined
    → 状态判定全空 → 整轮请求 200 但 **0 行写入**，且无任何失败日志；
  - 写入不可静默：`wrote` 只统计真的写进库的行；判定不了记 `steam-status.skip_write`（debug）、
    写库未命中记 `steam-status.write_miss`（warn）；本轮全部没写入直接抛错，不再静默"成功"；
  - 限速按「每个请求」计（cn/hk 各 sleep 一次，非 429 的 4xx 也 sleep）；撞 429 立即收轮，不再睡 30 分钟空转；
  - 整轮复用数据库连接（原每条新建连接池）；每轮写 `sync_runs`（后台「同步记录」可观测）；
  - 空数组/空对象不再覆盖已有分级；`content_descriptors` 补显式 `::int[]`。
- **补 `steamStatus.initialDelaySec` 设置项（原 Y 批并入）**：`STEAM_STATUS_INITIAL_DELAY_SEC`，默认 600 秒，
  可在「系统设置」调整；`steamStatus.limit` 默认 **12000 → 6000**（约 5 小时/轮，避免单轮拖过夜撞配额）。
  **注意：库里已保存的 12000 会覆盖默认值，部署后需在系统设置里同步改。**

### 测试

- `test/steam-status.test.js` 新增 3 项：appid 不在库 → 写入未命中不算成功、空数组/空 ratings 不清空已有分级、
  `runSteamStatusRound` 一轮四态（取 `.json` 写入 / 无条目跳过不写库 / 4xx 继续 / 429 立即收轮）；
  `test/scheduler.test.js` 新增 env 覆盖用例；`test/settings.test.js` 57 项定义 + 水合断言。

## [1.16.3] - 2026-11-06

### 修复

- **后台建号「邮箱被占用却已创建用户」**：此前「建号」与「绑邮箱」是两步请求——邮箱已被其他账号
  占用时第二步报错、账号却已落库，前端提示失败后刷新列表会冒出幽灵用户，换邮箱重试又因用户名重复再失败。
  现在 `POST /api/admin/users` 支持可选 `email`，账号与邮箱同一次写入：邮箱占用返回
  409「这个邮箱已被其他账号绑定」、用户名重复返回 409「用户名已存在」（原来是 500），两者都**不产生残号**；
  老库缺 `email` 列时自动补列重试（与绑邮箱路由同款兜底）；前端改为单次请求。

### 测试

- 新增 `test/admin-users.test.js`（6 项）接入主链：带邮箱建号一次落库、邮箱占用 409 且用户数不变（原子）、
  用户名重复 409、非法邮箱 400、不带邮箱向后兼容 201、匿名 401 / 普通用户 403。

## [1.16.2] - 2026-11-06

### 修复

- **手机端详情弹窗右侧被裁（Z 批，docs/MOBILE-FIX.md）**：真机（红米 K100 Pro Max + 小米自带浏览器）
  忽略 `<meta viewport>`、按 980 排版；`main.js` 的 zoom 兜底把列表页压回正常宽度，但 **`vw` 不受 zoom 影响**，
  `.mobile-full{width:100vw}` 仍是 980 → 详情弹窗被裁。移动端全屏样式改回 `%`/`dvh`、弹窗宽度绑 `100%`，
  图片补 `max-width:100%`，删除从未生效的 `html.mobile-layout` 死规则，`html,body` 全局防横向溢出。

### 新增

- **桌面版网站渲染提示**：检测到 `screen.width≤640 && innerWidth>700` 时，移动端顶部给可关闭提示条
  （关闭状态存 sessionStorage）+「我的」页常驻说明；zoom 兜底公式保持不变。
- **安装到桌面（PWA）**：`frontend/src/composables/useInstallPrompt.js` 监听 `beforeinstallprompt` /
  `appinstalled` / `display-mode: standalone`；Chrome 可用时顶部出「安装到桌面」，不支持的小米浏览器
  在「我的」页显示 Chrome 安装说明（旧快捷方式先删再装）。
- **后台表格手机卡片化**：游戏目录与访问记录各 tab（访问明细/待审/最近设备/已封设备/黑名单/白名单/自动封禁）
  在手机上渲染卡片列表（勾选与批量操作可用，字段与表格列一致，游戏卡补齐同步状态/分级标签）；
  其余表格加「左右滑动查看更多」提示与右侧渐隐。`isMobile` 改为 760 断点响应式（resize/旋转监听）。

### 变更

- 移动端视觉微调：卡片间距 12、触摸目标统一 ≥44px、搜索框与筛选按钮等高（44px）。

### 测试

- 新增 `test/frontend-mobile.test.js`（5 项）接入主链：Home.vue 无 `100vw`/`100vh`/`mobile-layout`、
  `main.css` 含 `100dvh`/防溢出/滑动提示、`main.js` 保留 zoom 兜底、安装提示与桌面模式提示接线、
  `AdminModules` 卡片分支与 760 断点。

## [1.16.1] - 2026-11-05

### 修复

- **调度器长任务阻塞（X 批，docs/SCHEDULER-BLOCKING-FIX.md）**：
  - Steam 重任务改为「非阻塞发射 + 全局单槽」（`heavySlot`）：tick 循环不再 `await runJob(job)`，
    `steam-prices` 跑 90 分钟期间 `sonkwo`/`gog`/`alerts`/`steam-accounts` 等轻任务照常派发；
    槽位在 `.finally` 里释放并 `wake()` 立即唤醒，两个重任务并行打配额是红线（`scheduler.heavy_slot_released` 可观测）；
  - `steam-status` 归入 `STEAM_HEAVY`（此前走轻任务分支，会与价格/热度并行打 Steam 配额）；
  - 启动时从 `sync_runs` 按 mode 恢复 `lastRunMs`：发版重启不再把全部任务打回首轮延迟重新计时；
  - `data/scheduler-status.json` 每个 tick 刷新，`updatedAt` 能反映调度器存活。

### 变更

- `steam-status` 节奏（X 批已确认）：首轮延迟 6 小时 → **10 分钟**、周期每周 → **每天**、每轮上限 8000 → **12000**
  （约 5 小时/天，约两周补完 17.5 万条）。`steamStatus.limit`/`steamStatus.intervalMin` 设置项默认值同步改；
  **线上若曾在系统设置页保存过旧值，需在「系统设置」里确认/重置这两项**（设置优先级：数据库 > 环境变量 > 默认值）。

### 测试

- `test/scheduler.test.js` 22 项（+3）：`steam-status` ∈ `STEAM_HEAVY`、重任务占槽期间轻任务照常派发
  （`planTick`）、`lastRunMs` 恢复（坏行跳过、按间隔计时）；`test/settings.test.js` 默认值断言同步。

## [1.16.0] - 2026-11-05

### 新增

- **手机端 PWA（docs/MOBILE-PWA.md）**：`manifest.webmanifest`（`standalone` + `portrait`，主题色对齐暗色 token）
  与 192/512 图标（512 声明 `any maskable`，由 `web/favicon.svg` 导出）；`index.html` 补 manifest /
  theme-color / apple-mobile-web-app-* / apple-touch-icon。手机浏览器「添加到主屏幕」后全屏运行、无地址栏；
  购买仍跳 Steam 商店，**不做购物车、不做站内购买**。
- **统一网络失败提示**：`frontend/src/utils/network.js` 包装 fetch，断网/超时统一换成语义化错误
  「网络不可用，请检查连接后重试」；App.vue 顶部提示条 + 首页列表空态可重试；**不做离线缓存**，
  没有 service worker（避免"看到旧页面"）。
- **Android 返回键先关浮层**：`frontend/src/composables/useBackGuard.js` 以 `history.pushState`/`popstate`
  管理浮层栈——详情弹窗、筛选抽屉、站点通知、登录、愿望单弹窗打开时入栈，返回键只关最上层；
  仅手机结构生效，PC 端浏览器返回保持原行为。
- **版本检查与「已更新」提示（§2.1 半自动更新）**：`frontend/src/composables/useVersionGuard.js`
  启动时记 `/api/site` 的 `version` 基线，`visibilitychange` 切回前台再查，不一致 → 顶部提示
  「已更新到 vX.Y.Z，点击刷新」（全局唯一、可关闭）；`AUTO_RELOAD=false` 默认不自动刷新，
  避免丢弹窗/表单状态；离线或请求失败静默跳过、不误报。

### 变更

- `src/server.js` 的 `serveFrontendStatic` 把 `/manifest.webmanifest` 与 `/icon-*.png` 交给 `frontendDir`
  （此前会落到 `outDir` → 404，导致「添加到主屏幕」静默失效）；补 `.webmanifest` 的 MIME。
- `frontend/src/utils/network.js` 导出 `rawFetch`：版本探测这类后台请求失败不点亮全局断网提示条。

### 测试

- 新增 `test/pwa.test.js`（9 项）接入主链：manifest 字段齐全、图标存在且 PNG 尺寸正确、
  `index.html` 引用完整、前端无 serviceWorker 注册、服务端 PWA 根文件路由、版本比较纯函数
  （相等/不等/首次为空）、断网提示与 AbortError 不误报。

## [1.15.2] - 2026-11-04

### 修复

- **`STEAM_STATUS_LIMIT` 进系统设置**：此前只在调度器读环境变量，控制台看不到也改不了。
  新增设置项 `steamStatus.limit`（env `STEAM_STATUS_LIMIT`，默认 **8000** ≈ 3.3 小时/天，
  三周补完 17.5 万条；上限 200000）——「系统设置 → 数据源与采集 → 高级」可改、保存即热加载；
  调度器与 `steam-status` CLI 的默认上限同步改为 8000

## [1.15.1] - 2026-11-04

### 新增

- **后台内容分级筛选（docs/STEAM-SYNC-STATUS-AND-RATING.md §13）**：
  `GET /api/admin/games` 加 `rating=adult|mature|none`（可与搜索/平台/同步状态叠加）；
  `adminGameStats` 加 `adult` / `mature` 计数（成人+成熟+未标注 = 未删除总数）；
  后台筛选栏加「内容分级」下拉与「成人/成熟」两张指标卡（点击即筛选）；
  「全部同步状态」下拉从旧两项改为与六态指标卡一一对应
- **backfill 顺带写 Steam 状态与分级（同规格 §14.3）**：新增 `src/steam-status.js` 的 `applySteamDetails`
  共用函数（状态 `classifySteamStatus` + 分级 `classifyContentRating` + 落库 `setSteamStatus`）；
  `cmdBackfill` 的 appdetails 回退路径逐条调用（省约 6.9 万次重复请求），`cmdSteamStatus` 改调同一函数，口径唯一

### 变更

- `db.setSteamStatus` 写入语义收紧：`status=null` 不写 `steam_checked_at` 游标（留给 steam-status 判定）；
  分级字段传 `null` 用 `coalesce` 不覆盖已有值；`adultFlag`/`matureFlag` 传 `null` 不覆盖

### 测试

- `test/steam-status.test.js` 6 → 10 项：`entryFromMeta` 分支、全写/不写游标/不覆盖已有分级、重复跑幂等
- `test/api.test.js` 新增筛选用例：成人/成熟/未标注筛出正确、与状态叠加、三者之和=未删除总数

## [1.15.0] - 2026-11-04

### 新增

- **Steam 同步状态可解释（docs/STEAM-SYNC-STATUS-AND-RATING.md）**：
  - `games` 加 7 列幂等迁移（`steam_status` / `steam_checked_at` / `required_age` / `content_descriptors` /
    `age_ratings` / `adult_flag` / `mature_flag`）+ partial index；免费游戏一次 SQL 置位（2.3 万条不发请求）
  - 六态状态机：`ok` / `free` / `coming_soon` / `region_locked` / `no_price` / `not_found` / 未探测——
    每款游戏能回答"为什么没有价格"；「待同步」重定义为 未探测 或 `ok` 缺简介，9.2 万不再永远不归零
  - `steam-status` 任务并入调度器（默认每周、首轮延迟 6 小时避开热度播种期）：逐 appid 全量 appdetails
    （`cc=cn`，`success:false` 补 `cc=hk` 判定锁区），状态与分级**共用同一次请求**，`steam_checked_at` 作续跑游标，
    失败不写游标下轮重试；与 heat/backfill/catalog/价格共用 Steam 配额、任务互斥
- **锁国区标注**：国区不可售但港区可售/免费 → `region_locked`，后台标「锁国区」，前台标「国区不可售」且不出国区价格（不隐藏）
- **内容分级标注**：`required_age` / `content_descriptors` / `age_ratings` 原样落库；按平台标签派生
  `adult_flag`（descriptors 3/4 或 ESRB AO）与 `mature_flag`（descriptors 2/5、PEGI≥18、required_age≥18）——
  只做平台标签→站点策略映射，不做法律定性。新设置 `site.adultDisplay` = `hide`（默认，前台不显示、后台可见）/
  `badge`（带「成人内容」角标）/ `show`；`steamStatus.rateMs` / `steamStatus.intervalMin` 可调
- **后台指标卡重定义**：游戏目录改为 已同步 / 未探测 / 免费 / 未发售 / 锁国区 / 国区无价 / 国区不可售 / 其他 分项
  （点击即按 `status` 筛选），列表新增「同步状态」「分级」两列

### 测试

- 新增 `test/steam-status.test.js` 6 项并接入主链（六态判定、分级派生、迁移置位、任务写回/续跑、前台成人过滤）；
  `npm test` 48 个文件全绿；scheduler / settings / setup / api 的计数断言同步更新

## [1.14.2] - 2026-11-04

### 新增

- **仅封禁可见页面统一守卫（docs/BAN-AND-SECURITY-FIXES.md）**：
  - `BAN_ONLY_PAGES` 注册表（`/banned`、`/banned/`、`/banned.html`、`/appeal`、`/appeal/`）：未封禁 / 管理员 /
    封禁已过期访问一律 302 回首页；判定只在拦截链（只读复用 `deviceBan` / `blockedBy` / `bannedUntil`，
    页面路由零二次判定）
  - 新增只读接口 `GET /api/ban/state`（豁免拦截链与频率计数、只用内存态、自带 1 次/秒 + 30 次/分钟限流，
    只回调用者自己的 `{banned,type,until}`）；前端共享 `useBanOnlyPage` composable（挂载 + 每 30 秒 + 切回标签页复查），
    解封后自动回首页
  - `ban.page_view` 观测日志（`at: gate|ban_only` + `mobile`），`ban.redirect_home` 带 `from`
- **黑/白名单双向互斥（同规格 §4）**：加黑自动移白、加白自动移黑（单条与批量回执 `removedFromWhitelist/Blacklist`）；
  `banIpExclusive` 收敛单条/审核/批量四个入口；`migrate()` 幂等存量清理（白名单优先，被覆盖的临时封禁一并清空）
- **待审口径 A（同规格 §5）**：待审 = 全部 `pending`（去掉 `NOT_ACTIVE_BAN` 二次过滤，列表与计数同口径）；
  状态列补全 待审 / 已封禁 / 已忽略 / 自动退出 四种标签 + 悬停备注与处理时间
- **申诉 URL 去敏感化（docs/URL-PARAM-PRIVACY.md 方案 A）**：`/appeal` 只带 `?code=AP-XXXXXX`，
  站点名与申诉邮箱由服务端注入 `window.__APPEAL__`（封禁用户调不了 `/api/site`）；申诉页不再展示原因/解除时间，
  旧链接多余参数忽略并在前端清洗地址栏

### 修复

- 申诉编号 `Math.random()` → `crypto.randomBytes` + 去易混字符（0/O/1/I），保持 `AP-XXXXXX`
- `/banned*`、`/appeal*` 响应带 `X-Robots-Tag: noindex, nofollow`；`/appeal` 补 `Cache-Control: no-store`；
  新增 `GET /robots.txt`（Disallow `/console` `/banned` `/appeal` `/api/`）
- 申诉 `code` 白名单整串校验（`^[A-Za-z0-9-]{1,16}$`，非法按空处理、不反射输入）

### 测试

- `test/reviews.test.js` 19 → 24 项：`BAN_ONLY_PAGES` 逐页遍历（未封禁 302 / 被封禁 403 或 200）、
  `/api/ban/state` 三类型与豁免与限流、待审口径 A
- `test/visitors.test.js` 5 → 8 项：互斥（store 层 / 迁移清理 / HTTP 层内存态）
- `test/admin-bulk.test.js` 12 → 13 项：批量互斥回执
- 新增 `test/appeal-security.test.js` 6 项并接入主链：302 / 注入 / 非法 code / robots / 响应头 / 编号随机 / 前端静态断言

## [1.14.1] - 2026-11-03

### 修复

- **封禁页守卫（docs/BAN-PAGE-GUARD.md）**：`/banned` 不再无条件返回 403 封禁页——未封禁的人
  （手动输入网址、收藏夹、封禁到期后刷新、管理员）此前会看到「解封时间：暂未设定」的假封禁页。
  现在 `/banned` 一律 302 回首页（`location: /`、`cache-control: no-store`、日志 `ban.redirect_home`）：
  判定只在拦截链（设备封禁 / 频率封禁 / IP 黑名单三道闸）完成，真正被封禁的请求仍由 `denyBanned`
  返回封禁页（403/429）；页面路由不做二次判定（避免第二份口径、误伤管理员与白名单）。
  前端 `BanPage.vue` 加 `__BAN_PAGE__` 缺失守卫（`location.replace('/')`），SPA 内部误入不再渲染假封禁页。

### 测试

- `test/reviews.test.js` 新增 7 条封禁页守卫断言（19 项）：未封禁 302（含 `/banned/`）、IP 黑名单命中 403
  （注入 `__BAN_PAGE__`）、设备封禁 403（换 IP 同样）、频率封禁 429 + `Retry-After`、管理员 bypass 302、
  封禁过期 302、日志事件（`ban.redirect_home` / `ban.page`）与 BanPage 守卫静态断言

## [1.14.0] - 2026-11-03

### 新增

- **后台 11 个列表批量操作（docs/ADMIN-BULK-ACTIONS.md）**：
  - 统一入口 `POST /api/admin/bulk`：`src/server.js` 的 `BULK_ACTIONS` 白名单派发表（19 个 target/action）、
    单次上限（高危 50 / 常规 200 / 回收站恢复 1000）、高危动作**服务端**二次校验 `confirmCount`、
    逐条回执（`ok` / `skipped` / `failed` + 原因），单条失败不影响其它条
  - 覆盖：待审列表（封 IP / 封设备 / 忽略）、访问明细（封 IP / 信任加白）、回收站（恢复，含「全选当前筛选」≤1000）、
    站点通知（删除 / 启用 / 停用）、IP 黑名单（解封）、IP 白名单（移除）、已封设备（解封）、自动封禁记录（解封）、
    游戏目录（禁用 / 启用 / 删除进回收站）、最近设备（封禁 10 分钟 / 1 小时 / 1 天 / 永久）、用户管理（禁用 / 启用）
  - 内存态同步：黑名单、白名单、设备封禁改动后立即刷新，不需重启（验收用"解封后再访问 200"验证）
  - 用户批量禁用守卫：不能禁用自己、不能禁用最后一个可用管理员（409）；禁用后立即删除该用户会话
  - 审计表 `admin_bulk_ops` + 后台「系统 → 批量操作记录」页（操作者/时间/目标/动作/总数/成功/失败/耗时 + 键样本详情）
  - 前端复用件 `useBulkSelection`（键去重 + 翻页清空）、`BulkBar`、`BulkResultDialog`；移动端卡片列表补勾选框

### 修复

- **`admin-ui.js` 漏注册 `ElRadio` / `ElRadioGroup`**：控制台「设备封禁」弹窗的时长单选此前静默不渲染；
  本次批量封禁复用同一交互，补齐注册并加 `test/frontend-registration.test.js` 防回归

### 测试

- 新增 `test/admin-bulk.test.js`（12 项，真 PGlite + 真 HTTP）并接入 `npm test` 主链：
  前端接入静态断言、鉴权、参数整单拒绝、单次上限、高危确认、内存态同步、公告部分失败、用户守卫与会话失效、
  设备封禁/解封、回收站、审计查询、键规范化与去重

## [1.13.0] - 2026-11-03

### 新增

- **后台功能对齐（docs/ADMIN-PARITY.md）**：
  - 「访问与安全」新增第 4 个 tab「设备」：最近设备表（`GET /api/admin/devices`）+ 按时长封禁
    （10 分钟/1 小时/1 天/永久，`POST /api/admin/devices/ban`）+ 已封设备表（`GET /api/admin/device-bans`）
    + 解封（`DELETE /api/admin/device-bans/:fingerprint`，二次确认）
  - 游戏目录工具栏「高级」→「合并重复游戏」弹窗（源/目标 AppID → `POST /api/admin/games/merge`，
    成功提示迁移/去重条数并刷新列表）
  - 运行日志页新增「同步记录」表（`GET /api/admin/sync/runs`，列：开始时间/模式/状态/请求数/总量/
    成功/跳过/失败/耗时/备注，失败行标红）；后端 `listSyncRuns` 附带同一轮 fetch_runs 汇总
  - 任务实时进度：任务运行中轮询 `GET /api/admin/backfill/status`，显示
    `已完成 X / 总 Y（Z%）· 速度 N 款/分钟 · 预计剩余 M 分钟`

## [1.12.1] - 2026-11-03

### 修复

- **申诉邮箱回退链被空串截断**：`appealEmail()` 原来用 `??` 链，而设置水合会把未填的
  `ALERT_EMAIL_TO` 写成空字符串（非 null），导致「发件人/SMTP 账号」明明有值也取不到——
  新增 `src/appeal.js` 的 `appealEmailFrom`（`||` 链 + trim：申诉邮箱 → 邮件收件人 → 发件人 → SMTP 账号）；
  新增系统设置「申诉邮箱」（`alerts.appealEmail`，留空按上述顺序回退，保存即热加载）

### 变更

- **邮件配置合并到「邮件服务」页**：新增「邮件配置」卡片（`MailSettingsForm.vue`，自包含加载/渲染/保存，
  8 个邮件字段按 schema 顺序、secret 留空保持原值/勾选清空传 null、保存后 emit 刷新状态卡）；
  系统设置页过滤邮件 key，「降价提醒」分组改为「通知与提醒」（提醒开关与间隔、Webhook/企业微信，
  邮件配置在邮件服务页）；系统设置保存不再提交邮件 key（docs/MAIL-CONFIG-PAGE.md 方案 A）

## [1.12.0] - 2026-11-03

### 修复

- **封禁页跳转（最终方案）**：v1.11.0 在 main.js 里 `router.replace('/banned')` 实测无效
  （ES module 提升导致 `createWebHistory` 已按旧地址初始化）——改为 `serveBanPage` 注入的内联脚本
  在模块加载前 `history.replaceState(null,'','/banned')`（`/banned`、`/appeal` 除外）；
  main.js 移除无效跳转。无头 Edge 实测：注入后 `pathname==='/banned'`、`.ban-card` 存在、
  `.storefront` 不挂载、`/appeal` 正常放行
- **验证码加载失败提示**：`loadCaptcha` 失败时 `ElMessage.warning('验证码加载失败，点击验证码重试')`，
  空态显示可点击的「点击重试」占位块（封禁/断网时不再只剩破图）

## [1.11.0] - 2026-11-03

### 修复

- **抽屉/角标/复选框未注册（v1.6.0 起的隐性 bug）**：main.js 补注册 `ElDrawer`/`ElBadge`/
  `ElCheckbox`/`ElCheckboxGroup`（含样式）——此前 `<el-drawer>` 等被当普通标签渲染，导致手机
  筛选/我的菜单/通知抽屉点不开、内容铺在页面流里、未读角标不显示、愿望单弹窗无法勾选账号
  （**推送到 Steam 账号从未真正可用**）
- **封禁页入口**：main.js 在 mount 前读取服务端注入的 `window.__BAN_PAGE__` 并
  `router.replace('/banned')`（`/banned`、`/appeal` 除外防死循环）——被封用户刷新任意路径
  直接看到封禁卡片与「申请解封」入口
- 新增 `test/frontend-registration.test.js` 静态防回归断言（组件注册 + __BAN_PAGE__ 跳转）

## [1.10.0] - 2026-11-03

### 修复

- **移动端真机适配（强制 viewport）**：红米 K100 Pro Max 实测「桌面版网站」模式下字体小、按钮点不中——
  根因是布局视口仍按 ~980px 缩放。修复：`frontend/index.html` 内联脚本在
  `screen.width<=640 && innerWidth>700` 时改写 viewport 为 `width=390, initial-scale=1,
  maximum-scale=1, user-scalable=no`（sessionStorage 防循环 reload 一次）；main.js 提供 zoom
  兜底（meta 无效内核）；`-webkit-text-size-adjust:100%` 防系统二次缩放；移动端字号基线校准
  （正文 ≥14px、tab 15px、底部导航 56px + 安全区、抽屉内容 `max-height:70vh` 滚动）；
  新增 `?debug=1` 调试浮层（innerWidth/screen.width/DPR/isMobile/desktopMode/UA）供真机截图自检。
  真机 14 项清单见 [docs/MOBILE-VIEWPORT.md §4](docs/MOBILE-VIEWPORT.md)

## [1.9.0] - 2026-11-03

### 新增

- **封禁标记（替代「仅过滤」）**：封禁动作发生时——`rate`/`rate-day`/`path` 自动封禁、手动黑名单、
  审核「封 IP」——把该 IP 的所有 `pending` 审核标记为 `auto_banned`（note 区分「自动封禁/手动封禁」），
  旧记录**永久退出待审**（解封不恢复）；该 IP 之后的新异常仍生成新 pending（不永久屏蔽）；
  审核列表 `status` 支持 `pending | all`（all 为审计视图）；`NOT_ACTIVE_BAN` 保留作双保险
- **移动端独立设计**：`isMobile` 判定（`max-width:640` 或「桌面版网站」特征
  `screen.width<=640 && innerWidth>700`）后 `v-if` 双结构，PC 不再被 CSS 断点压缩——
  移动端：52px 顶栏（Logo+铃铛+菜单）、搜索行、筛选 chips、分段 tab、单列大卡（标题 16px/价格 21px/
  按钮 ≥44px）、底部 4 入口（首页/心愿单/已拥有/我的）、筛选底部弹层（单选组+应用/重置）、
  全屏详情 + 底部固定操作栏、「加载更多」分页；触摸与安全区按规格

### 修复

- **PC 筛选区**：工具栏恢复单行（搜索 flex + 4 个 132px 下拉 + 刷新），筛选抽屉只在移动端渲染，
  窄断点覆盖规则不再波及 PC（1920/1440/1280 无回归）

## [1.8.0] - 2026-11-03

### 新增

- **愿望单归属**：列表/详情返回 `wishlisted_by[{steamId,name}]` 与 `site_wishlisted`（本站手动项）；
  卡片徽标「愿望单 · FF、Happy」（>2 个 `+N`），详情列全并悬停显示 SteamID；
  添加弹窗标注「已在愿望单」且默认不勾选，`POST /api/wishlist` 返回 `alreadyIn` 不重复推送
- **愿望单选择性移除**：`DELETE /api/wishlist/*` 接受 `{ steamIds, siteWishlist }`——移除弹窗列出
  「本站 + 各账号」默认全选、可取消勾选；缺省 body 保持旧行为（删本站 + 回推全部持有账号）
- **站点通知中心**：顶栏铃铛 + 未读角标 + 抽屉（未读高亮、已读淡色、全部标为已读）；
  登录用户已读状态存服务端（新表 `announcement_reads`，`GET /api/announcements` 附 `readIds`，
  `POST /api/announcements/read` 写入，跨设备跟随账号）；游客仍存本地（兼容旧 max-id 格式）；
  进站未读弹窗保留
- **移动端响应式重做**：断点 1024/768/480；「桌面版网站」兜底判定
  （`screen.width<=640 && innerWidth>700`）给 `<html>` 加 `mobile-layout` 类强制移动布局——
  单列卡、筛选进抽屉、顶栏精简（菜单收主题/登录）、详情全屏、已拥有/愿望单按钮收进详情、
  触摸目标 ≥44px、字号 ≥13px；PC 布局无回归
- **调度器轻任务并行**：sonkwo/itad/gog/humble/discover/steam-accounts/backup/logs/alerts/images
  可在 Steam 重任务（heat/steam-prices 等，仍严格串行且与手动同步互斥）运行时并行执行，
  并发上限 `SCHEDULER_LIGHT_CONCURRENCY`（默认 3，1–8）——解决 heat 首轮播种期其它源被饿数小时的问题；
  chart 后续任务串行执行避免并发写静态页

### 修复

- **自动封禁的 IP 不再出现在「异常审核」待审列表与计数**（`listAbuseReviews`/`countPendingReviews`
  排除 `ip_abuse.banned_until > now()`；只过滤显示不改状态，解封后自动恢复）

### 变更

- **移除账号库「DLC」列与 `*` 标记**：`IPlayerService/GetOwnedGames` 只返回游戏、不含 DLC 拥有记录
  （Steam 公开 API 限制），DLC 数天然恒为 0 且易误导——账号列表上方改为诚实说明
  「Steam API 不返回 DLC 拥有数据」，同步提示去掉「其中 DLC N 款」；`type_unknown` 仅留日志/诊断
  （方案 A，见 [docs/STEAM-DLC.md](docs/STEAM-DLC.md)）

## [1.7.0] - 2026-11-02

### 新增

- **账号库 DLC 统计**：`GetOwnedGames` 本身不带游戏类型字段，账号库的 DLC 数量按目录
  `games.app_type` 统计；后台「Steam 账号」页新增 **DLC 列**（与游戏库/愿望单并列），
  类型未知的游戏标 `*` 并悬停提示
- **同步时自动补全目录类型**：库同步后，把该账号拥有的、目录里 `app_type` 缺失的 appid
  批量走 `IStoreBrowseService/GetItems`（一次 100 个）补全类型——只挑缺失的，天然收敛
  （补全后每日同步近乎零额外请求）；补全失败只记日志（`steam.app_types_failed`），不影响同步。
  手动「同步游戏库」的完成提示同步带上「其中 DLC N 款」

### 变更

- 绑定成功、手动同步、调度器每日 `steam-accounts` 任务都带类型补全步骤；
  日志新增 `steam.app_types_backfilled` / `steam.app_types_missing`（带 steamId 与计数）

## [1.6.0] - 2026-11-02

### 新增

- **手动愿望单 + 推送到 Steam 账号**：前台游戏卡/详情新增「愿望单」按钮——加入本站的同时
  写进所选 Steam 账号的愿望单；绑定 1 个账号直接推送，多个账号弹窗多选（可「仅加入本站」）。
  新表 `user_wishlist` 存手动愿望单（`steam_ids` 记录推送账号），前台「愿望单」推导 =
  手动 ∪ Steam 同步；手动项同样自动加入价提醒（`watchlist.source='user_wishlist'`，史低提醒）
- **每账号自配 API Key**：Steam 写愿望单必须用该账号自己注册的 Web API Key
  （`IWishlistService/AddToWishlist` 未文档化接口，见 [STEAM-ACCOUNTS.md §16](docs/STEAM-ACCOUNTS.md)）。
  后台「Steam 账号 → API Key」配置，AES-256-GCM 密文存储、不回显；未配 Key 的账号同步不受影响，
  只是不能推送/回推
- **移除同步回推**：`DELETE /api/wishlist/:appid` 清站点行与自动提醒，并向「添加时选过的账号 ∪
  愿望单里持有该条目的账号」推 `RemoveFromWishlist`；推送失败只记日志，由每日同步对账收敛

### 变更

- 愿望单推送采用防御式解析：HTTP 2xx 且响应无显式 `success:false` 即成功；成功乐观写
  `steam_wishlist`，Steam 若实际未接受，每日 `steam-accounts` 同步差集删除兜底
- 新增日志事件：`adapter.steam.wishlist_add_ok/_failed`、`adapter.steam.wishlist_remove_ok/_failed`、
  `steam.wishlist_manual_add/remove`（带 steamId / appid / 原因）

> **已知限制**：AddToWishlist 属未文档化接口，真实行为需服务器上线后实测验证（本机无 Steam 出口）。

## [1.5.0] - 2026-11-02

### 新增

- **Steam 多账号绑定**：每个站点用户可绑定最多 5 个 Steam 账号，一个 Steam 账号只属一人。
  绑定走 OpenID + 一次性 state（防 CSRF，5 分钟过期），必须已登录站点账号；回调校验 state 后
  检查唯一性/上限（占用与超限返回 409），成功后自动同步该账号的游戏库与愿望单。
  后台「Steam 账号」页改为账号列表：同步游戏库/愿望单、改别名（前台徽标优先显示别名）、
  解绑（级联清理数据与愿望单自动提醒）、认领历史未归属账号；存量账号也可用 CLI `steam-claim`
  或 compose 配置 `STEAM_CLAIM_USERNAME`/`STEAM_CLAIM_STEAM_ID` 由调度器幂等认领
- **「已拥有」按用户推导**：前台「已拥有」= 手动标记 ∪ 该用户所有绑定账号游戏库的并集；
  `user_game_flags.owned=false` 永久排除（再同步不恢复，可点「恢复已拥有」回到跟随推导）；
  列表/详情返回 `owned_by[{steamId,name}]`，卡片显示「已拥有 · FF、XX」（>2 个 `+N`，详情列全）。
  全局 `games.owned` 废弃（前台不再读取）；已拥有/谁拥有仅当前登录用户可见
- **愿望单同步 + 独立标签页**：新增 `steam_wishlist` 表，前台新增「愿望单」标签页；
  愿望单游戏自动加入价提醒（`watchlist.source='steam_wishlist'`，目标价为空 = 史低提醒，
  手动设过的目标价不被覆盖）；移出愿望单/解绑只清理自动提醒
- **调度器每日 `steam-accounts` 任务**：所有已绑定账号逐个串行同步库与愿望单（间隔 ≥1s，
  单账号失败只记日志继续下一个），需要 `STEAM_API_KEY`；
  `STEAM_ACCOUNTS_INTERVAL_MIN` / `STEAM_ACCOUNTS_SLEEP_MS` 可调

### 修复

- **库/愿望单同步只增不删**：同步改为差集删除（`appid <> all(本次集合)`），账号移出库/愿望单的
  游戏不再残留——旧逻辑会让「已拥有」在退库后永远不消失
- **绑定回调对非浏览器客户端**：成功绑定一律 302；错误按请求方返回 302（浏览器回控制台展示）或
  JSON 状态码（API 客户端拿到 400/409 与错误码）

### 变更

- `steam_sessions` 停用（表保留不再写入）：Steam 身份改由站点会话决定，旧 `steam_session` cookie 直接失效
- 前台游客不再显示「已拥有」标签页与已拥有标记（本地已拥有标记一并移除，愿望单/已拥有是登录用户专属维度）
- 规格与实现记录见 [docs/STEAM-ACCOUNTS.md](docs/STEAM-ACCOUNTS.md)，验收标准 §14 全数覆盖
  （`test/steam-accounts.test.js` + `test/scheduler.test.js` 断言）

## [1.4.9] - 2026-11-02

### 修复

- **Steam 登录校验永远失败（`snippet="[object Object]"`）**：`verifyCallback` 把 `fetchText`
  返回的 `{ body, status, … }` 对象直接当字符串匹配，`/is_valid/` 永远匹配不上——
  连接再正常也会判"Steam 校验失败"。改为读取 `body` 文本，并补回归测试
  （`is_valid:true` 通过、`is_valid:false`/HTML 拒绝）。此 bug 自首次实现 OpenID 登录就存在

## [1.4.8] - 2026-11-02

### 修复

- **Steam 登录"Steam 校验失败"**（大陆应用服务器 + 香港代理的典型场景）：明文 HTTP 代理的
  `CONNECT steamcommunity.com` 被大陆→香港链路的 DPI 重置，导致 OpenID 二次校验失败。
  应用侧支持 **https 代理**（TLS 壳）：`proxyAgentOptions` 对 `https://` 代理放行自签证书
  （`proxyTls.rejectUnauthorized=false`，TLS 只负责隐藏 CONNECT 目标域名）。
  运维侧配套：香港代理机用 stunnel（或 gost）给 tinyproxy 加 TLS 壳、安全组放行新端口、
  「系统设置 → 网络 → Steam 专用代理」填 `https://用户:密码@代理:8531`（详见 DELIVERY 排障记录）

## [1.4.7] - 2026-10-30

### 新增

- **游戏目录指标卡即筛选**：目录游戏 / 待同步 / 已同步 / 有报价 四张卡可点击，点一下下方列表按对应
  口径刷新（当前生效的卡高亮，再点一次取消；与「同步状态」下拉联动）；「已删除」卡点击跳转回收站
- `GET /api/admin/games` 新增 `offers=priced|none` 参数（对应「有报价」口径）
- 控制台支持 URL `?section=` 联动切换选中页（回收站跳转复用）

## [1.4.6] - 2026-10-30

### 变更

- **「同步与回填」页精简为一表 + 状态卡**：去掉 6 个卡片、4 组参数输入框和「① 导入目录 / ② 增量同步」按钮；
  五个任务（价格刷新 / 目录同步 / 增量回填 / 重写名字 / 热度回填）各一行，显示频率、上次/下次运行、
  状态（空闲 / 运行中 / 失败 N 次 / 熔断至）与「立即运行」（默认参数，任务互斥）；
  运行中的任务在下方状态卡显示实时输出，可「停止」
- 控制台移除 `steamall`（增量同步）入口——功能已被 `backfill`（批量 GetItems）覆盖且快 3-4 倍；
  CLI 与 `POST /api/admin/sync` 的 `steamall` 兼容保留
- `POST /api/admin/sync` 的 `mode` 白名单扩为 `catalog` / `steam-prices` / `steamall`（缺省 `steam-prices`）

### 新增

- **时间字段时区设置化**：新增系统设置「时区」（`system.timezone`，env `TZ`，默认 `Asia/Shanghai`）。
  保存后：数据库会话时区随连接生效（`current_date` / `date_trunc` 的"按天"归属、psql 时间显示都是东八区），
  日志 `ts` 改为带偏移的 ISO（如 `2026-10-30T16:42:23+08:00`）、日志文件按本地日期分片，
  前端所有时间显示改用站点时区（`/api/me` 下发，`Intl` 指定 `timeZone`），不再跟随浏览器本地时区。
  时区校验白名单 + 非法回落 `Asia/Shanghai`；运行中改设置约 30 秒内新连接生效，重启保证全部生效
- 后台侧栏版本徽标移到顶部右侧（与主题切换并排，有新版时高亮提示）；
  侧栏底部改两行布局并加 `overflow` / `flex` 收缩约束，修复徽标被挤出侧栏的问题（[UI-FIXES.md](docs/UI-FIXES.md) 第 1 条）

## [1.4.5] - 2026-10-30

### 新增

- **控制台「重写名字」卡片**（游戏管理 → 同步与回填）：可直接触发/停止 `rename`，
  最多处理 / 每批 / 间隔可调，实时显示批次进度（已处理、带回中文名、失败）；
  对应新接口 `POST /api/admin/rename`、`POST /api/admin/rename/stop`、
  `GET /api/admin/rename/status`（管理员权限；与同步/回填/热度共用子进程槽位，忙时 409）
- `src/backfill.js` 新增 `renameArgs` / `parseRenameProgress`（rename 批次行多「带回中文名」字段，独立解析）

### 修复

- 状态文件 `scheduler-status.json` 的 `nextRunAt`：从未跑过的任务按首轮延迟计算，
  不再显示成"一个间隔之后"（此前 rename 首轮会显示成一周后，实际是 2 小时后）

## [1.4.4] - 2026-10-30

### 修复

- **TCR 镜像缺版本 tag（v1.4.3 部署报 not found）**：`docker-tcr` 工作流的版本号 tag
  原来只取 `package.json`（当时仍为 1.4.0，历史发布未按规范 bump），导致腾讯云 TCR 上
  没有 `1.4.3` 这个镜像 tag，服务器 `docker compose up` 拉取失败。修复：
  1. 工作流改为**打 tag 触发时取 git tag**（去 `v` 前缀），手动触发才回退 `package.json`；
  2. 本次补 `npm version 1.4.4`，镜像内版本号与控制台显示、镜像 tag 重新对齐
- 发布与升级流程、服务器操作边界固化进文档：[docs/DEPLOY.md](docs/DEPLOY.md)、
  [docs/DELIVERY.md](docs/DELIVERY.md)、[CONTRIBUTING.md](CONTRIBUTING.md)（硬规则 4：
  服务器操作由部署人员执行，仓库不保存服务器凭据）

## [1.4.3] - 2026-10-30

### 修复

- **同步游戏没有中文名**（生产 19.6 万行里仅 1.14 万有中文名）：目录导入
  （`IStoreService/GetAppList` 无语言参数）把英文基础名写进了 `name`，而回填的
  名字写入是"只补空缺"（`coalesce(games.name, …)`），中文名拿到后被静默丢弃。
  修复分三层：
  1. `importCatalogGames`：目录导入按内容分流——含中文的写 `name`，否则写 `name_en`，
     `name` 留空等回填补 schinese 本地化名
  2. `upsertGameMeta` / `ensureGame`：允许用中文名覆盖"机器英文名"
     （`name_en` 为空且 `name` 不含中文），并把被替换的英文名挪进 `name_en`；
     人工维护的名字（中文名、或 `name_en` 已有人工值）仍然不被覆盖
  3. 新增 CLI `node src/cli.js rename`：存量修复，挑"name 为空或仍是机器英文名"的行
     用 GetItems 重取覆盖（`--limit 200000 --batch 100 --sleep 1500`，无简中的行保持英文）；
     **已纳入调度器**：每周自动跑一轮（`STEAM_RENAME_LIMIT / STEAM_RENAME_INTERVAL_MIN` 可调，
     与后台手动同步/回填互斥，跑完自动重建静态页），无需每次人工执行
- **调度器补齐"纯系统跑"的两块人工缺口**（目标：部署后不需要人去服务器执行任何命令）：
  1. 新增 `catalog` 任务：每周同步 Steam 全量目录（幂等），新游戏自动进库，需要 `STEAM_API_KEY`，
     可调 `STEAM_CATALOG_INTERVAL_MIN / STEAM_CATALOG_INITIAL_DELAY_SEC`
  2. 新增 `backfill` 任务：每周增量回填元数据/说明/价格（`STEAM_BACKFILL_LIMIT` 默认 20000），
     有说明+报价的游戏自动跳过、没活秒退
  3. Steam 重任务（价格/热度/改名/回填/目录）统一与后台手动任务互斥，避免并行冲击限流；
     backfill 写报价后自动重建静态页
- 贡献指南新增硬规则 3：新命令/新数据任务必须同步进自动调度，人工命令不得成为上线必经步骤
  （见 [CONTRIBUTING.md](CONTRIBUTING.md#三条硬规则)）
- **回填不写 `app_type`**：真实 GetItems 的 `type` 是数字枚举（Game=0、DLC=4、…），
  旧实现按字符串判断且 0 是 falsy，导致 `app_type` 永远为空（生产仅 1,180 行有值，
  全部来自 appdetails 路径）；`mapStoreItem` 改为按 EStoreAppType 枚举表映射
- 展示兜底：`name` 为空时前台/报表回退显示 `name_en`
  （`coalesce(nullif(g.name,''), nullif(g.name_en,''), 'appid:'||appid)`）
- `sync itad` 检索名回退：`name` 为空时用 `name_en`（英文名更适合 ITAD 搜索）

## [1.4.2] - 2026-10-30

### 修复

- **热度回填改为逐 appid 请求**：实测 Steam appdetails 只要 appids 多于 1 个，
  无 filters 或 `filters=recommendations,release_date` 都返回 400，批量只接受
  `filters=price_overview`；单 appid 请求 69 字节可用，因此逐款回填
  （约 1.7s/款，全量约 90 小时，靠 `heat_at` 游标分多周续跑）
- 调度器热度任务参数同步：`--limit 20000 --sleep 1700`（去掉 `--batch`）
- 1.4.1 的"失败批次记 heat_at 防原地打转、4xx 立即中止"保留，并细化到单 appid 粒度

## [1.4.1] - 2026-10-30

### 修复

- **热度回填线上 400 空转**：批量 appids + `filters=recommendations,release_date` 被 Steam 拒绝
  （批量时 filters 白名单只有 `price_overview` 类，单 appid 才接受 recommendations）；
  改为**不带 filters** 的全量批量请求，并顺带把 `app_type` 一起回填
- **失败批次不再原地打转**：网络类失败的本批写 `heat_at` 跳过（下轮调度再试），
  游标继续前进；4xx（含 429/风控）立即中止任务，不再烧配额反复重试同一批

## [1.4.0] - 2026-10-30

批次 5：安全加固 + 体验修正（排查结论见 [docs/ROADMAP.md](docs/ROADMAP.md)）。

### 变更

- **「全部」页签改为「未标记」口径**：排除已标 感兴趣 / 不感兴趣 的游戏（已拥有本就由
  `owned=exclude` 排除）；`POST /api/games/search` 新增 `marks=unmarked`（登录用户按个人标记行判断，
  游客按 `guestFlags.excludeIds`），旧行为 `marks=any` 不变
- **首页工具栏响应式**：`≤1200px` 时搜索框独占一行、四个下拉两列排布（`min-width:118px`），
  宽屏单行；不再出现控件被挤成 10px 间距
- **热度周任务上限 5000 → 20000**（`STEAM_HEAT_LIMIT`）：10.6 万条有价游戏从 21 周轮一遍
  缩短到约 5 周

### 新增

- `node src/cli.js prune`：定期清理 `visitor_logs`（180 天）/ `fetch_runs`、`sync_runs`（90 天）/
  `email_codes`（7 天），调度器每周执行（`PRUNE_INTERVAL_MIN` / `PRUNE_ENABLED`）
- `VISITOR_GEO=0`：不再把访客 IP 发给第三方归属地服务（隐私开关）

### 安全

- Steam 登录回调地址只信任可信反代：`TRUST_PROXY=1` 且来源在 `TRUSTED_PROXY_IPS` 时才采纳
  `X-Forwarded-Host/Proto`，防 Host/协议伪造（新增 `test/steam-login.test.js` 3 项）
- 全站响应带 `Content-Security-Policy-Report-Only`（观察阶段，`default-src 'self'` +
  Element Plus 所需 inline style；跑稳后转强制）

### 测试

- `npm test` 44 文件全绿；`api.test.js` 新增「未标记」过滤 5 条断言（含游客 `excludeIds`）；
  scheduler 测试覆盖 prune 任务与新热度上限

## [1.3.0] - 2026-10-30

热度排序与发行时间筛选（计划 `docs/PLAN.md` 批次 4）。

### 新增

- `games` 新增 `heat / heat_reviews / heat_at` 列与 `(heat desc)` 索引；
  热度公式 = `log10(1 + 评测数) * 0.7 + 新作加权 * 0.3`（发行满 1 年衰减到一半）
- 新命令 `node src/cli.js heat --limit 200000 --batch 30 --sleep 1700`：
  用 `appdetails?filters=recommendations,release_date` 批量回填评测数与发行日期
  （30 个/批、约 1.7 秒间隔，全量约 3 小时）；按 `heat_at is null` 自动续跑，
  成功与否都记 `heat_at` 防止同一批反复选中
- 后台「游戏管理 → 同步与回填」新增热度回填卡片（开始/停止/最近输出），
  接口 `POST /api/admin/heat`、`/api/admin/heat/stop`、`GET /api/admin/heat/status`
- 调度器每周跑一次 `heat`（`STEAM_HEAT_INTERVAL_MIN` 默认 10080 分钟，首轮延迟 1 天，
  每周限量 5000 款，只刷新「heat_at 过期且已有报价」的条目）

### 变更

- **列表排序**：`heat desc nulls last` 是第一排序键（用户选的折扣/价格/名称作次序），
  没有热度数据的游戏排在最后而不是消失
- 前台新增「发行时间」筛选：不限 / 近 30 天 / 近 1 年 / 近 3 年
- 热度任务与同步/回填共用子进程槽位（同一时刻只允许一个 Steam 重任务），
  并享受 `STEAM_429_RETRIES=Infinity` 的长任务退避
- 全程一次都没拿到数据时热度任务按失败退出（避免空跑被记成成功）

## [1.2.0] - 2026-10-30

前台交互修复、亮暗色主题与移动端适配（计划见 `docs/PLAN.md` 批次 1–3）。

### 新增

- **亮暗色主题**：约 30 个语义化颜色 token 替换全部硬编码颜色；`html.dark` + Element Plus
  暗色变量；`index.html` 内联脚本防首屏闪烁；未选择时跟随系统并实时响应系统变化
- 前台顶栏与后台头部各有一个「🌙/🌞」切换按钮，状态共用；登录用户写服务端
  `user_prefs.theme`（跨设备），系统设置页提供「跟随系统」入口；`/banned`、`/appeal`、`/setup`
  一并支持暗色
- **首页目录统计**：大数字改为「收录条目（含 DLC/软件）+ 其中有报价 N 款」
  （`GET /api/games/count` 排除已删除/禁用）
- **站点通知弹窗**：页面内不再放公告元素；只有比已读 id 更新的公告才弹，最多展示 5 条，
  关闭即记已读（`steamdeals.notice-read.v1`）
- **搜索边打边查**：300ms 防抖 + 中文输入法合成期不查 + 最少 2 字符（纯数字 AppID ≥4 位）
  + 请求取消与序号防乱序 + 30 秒结果缓存 + 回车立即查询 + 搜索词同步到 URL
- **「不感兴趣/感兴趣/已拥有」三态**：卡片与详情弹窗都是三个显式按钮；登录用户支持
  `'clear'` 清除个人标记（回退全局）；游客删 localStorage key
- **后台「检测新版本」**：侧栏底部显示当前版本，有新版本显示「↑ 新版 vX 可用」链接，
  点击带 `force=1` 重查，进入控制台自动查一次（走服务端 6 小时缓存）
- **后台查询输入框统一 Enter 触发**：设置搜索、侧栏功能搜索补上 Enter 行为；
  黑名单/白名单/测试邮件/新建用户等表单输入支持 Enter 提交
- **移动端**：断点 900/760/420；工具栏 2×2、卡片单列、弹窗宽度 `min(…, 92vw)`；
  后台游戏目录与访问记录在 ≤720px 改用卡片式渲染；分页在手机上只保留上/下页

### 变更

- 详情弹窗宽度响应式（`880px` / `96vw`），报价行栅格改固定比例，手机两行布局；
  价格历史网格自适应列宽
- `PaginationBar` 只有一页时不再渲染（`hideOnSinglePage`），避免「Total 1 / Go to 1」噪声
- Element Plus 配置中文 locale（分页、下拉占位等不再出现英文 `Total / Go to / Select`）
- 历史 CSV 接口默认关闭：`/api/games/:appid/history.csv` 返回 404（与未知路由一致），
  设 `HISTORY_CSV_ENABLED=1` 才放行；前台导出入口已删除
- 搜索关键词是纯数字时按 `steam_appid = $2::int` 精确匹配，避免全表 cast

### 修复

- 详情弹窗在手机上溢出（`850px` 固定宽度 + 失效的 `:deep(.el-dialog)` 规则）
- 报价行第二列 `1fr` 吃掉全部宽度导致的巨大空隙
- 后台游戏管理两个筛选下拉显示英文「Select」
- 登录用户无法清除个人标记（`setUserGameFlag` 原来把 `null` 当「不改动」）

## [1.1.0] - 2026-10-30

游客本地标记、全站列表分页与独立申诉页。

### 新增

- **游客本地标记**：未登录也能标记「感兴趣 / 已拥有」，存浏览器 localStorage
  （`steamdeals.guest-game-flags.v1`）；列表改走新的 `POST /api/games/search`，
  带 `guestFlags`（interestedIds / uninterestedIds / ownedIds）在服务端按 id 筛选，
  各上限 5000 个、非数字丢弃；登录后忽略该字段，改按数据库用户标记
- **`/appeal` 申诉页**（Vue）：从封禁页带申诉编号 / 原因 / 到期时间 / 申诉邮箱跳转，
  生成申诉邮件正文并支持复制兜底；服务端对 `/appeal` 跳过封禁与限流判定，
  被封 IP / 设备也能打开该页（仍只放行构建产物），申诉内容不落库
- **PaginationBar 分页组件** + `useListPagination`：前台详情的报价与价格历史、
  后台用户 / 回收站 / Steam 库 / 邮件 / 日志 / 公告 / 黑白名单 / 自动封禁 /
  价格变化 / 浏览排行 / 备份等列表全部改为分页显示

### 变更

- `GET /api/games`：默认 `pageSize` 50→20、上限 200→100；新增 `compact=1`
  只返回卡片字段（价格 CTE 汇总，省一次聚合子查询）
- 成功的 `POST /api/games/search` 不写访问记录；前台搜索请求可中止，翻页会取消旧请求
- 后台接口 `limit` 参数化：邮件记录、公告、浏览排行、价格报表、异常审核
- `offers` / `daily_prices` 增加 `(region, game_id)` 复合索引
- 详情接口补充 `user_interested` / `user_owned` 原始用户标记字段

### 修复

- 游客在卡片上切换标记后详情弹窗与列表同步刷新；登录态下标记以用户数据为准

### 测试

- `npm test`（40 个文件）全绿；`test/api.test.js` 21 项通过；`frontend:build` 通过
- 冒烟验证：`POST /api/games/search` 返回 48 款、guestFlags 三种过滤结果正确、
  非法 id 被丢弃；`/appeal` 带参渲染正常；游客点击标记写入 localStorage 并即时生效

## [1.0.0] - 2026-10-29

前后台页面全面迁移到 Vue 3 + Vite + Element Plus，旧的零构建页面保留为回退。

### 新增

- **Vue 3 前端工程** `frontend/`：Vite 构建、Vue Router 路由、Element Plus 组件；
  前台首页、初始化向导、封禁页、管理控制台全部由 Vue 渲染
- **管理控制台重做**：游戏管理、回收站、站点通知、访问记录、用户管理、Steam 账号、
  邮件服务、系统设置、数据统计、运行日志共 10 个模块；侧栏分组 + 功能搜索 +
  `?section=` 深链
- 服务端新增 `frontendDir` 静态分发：`/`、`/console`、`/setup`、`/banned` 与 `/assets/*`
  由 `frontend/dist` 提供；没有构建产物时自动回退旧的 `web/` 页面
- 封禁页改为 Vue 渲染：服务端把站点名/申诉邮箱/到期时间/申诉编号注入
  `window.__BAN_PAGE__`，封禁期间只放行该页所需的 `/assets/*.js|css`
- 游戏列表返回 `currency` 字段（`src/store/pg.js`），前台按报价币种显示价格
- 新增 [docs/PROJECT-OVERVIEW.md](docs/PROJECT-OVERVIEW.md)：项目全貌、功能落点与维护约定，
  README / ARCHITECTURE 已互相链接

### 变更

- **`Dockerfile` 改为多阶段构建**：先在 `node:22-bookworm-slim` 里 `npm ci` + `vite build`
  产出 `frontend/dist`，再拷进运行镜像；`frontend/dist/` 不入库
- `vue`、`vue-router`、`element-plus`、`@element-plus/icons-vue`、`vite`、
  `@vitejs/plugin-vue` 从 `dependencies` 移到 `devDependencies`（运行时只需要构建产物）
- 新增 `npm run frontend:dev` / `frontend:build` / `frontend:preview`
- 旧 `web/console.html` 支持 `?embed` 隐藏侧栏，便于旧模块嵌入

### 修复

- 封禁页申诉按钮兜底：点击后先展示完整申诉全文，复制成功才提示「已复制」，
  复制失败则聚焦只读文本框，没装邮件客户端的环境下也能手动复制

### 测试

- `npm test`（40 个文件）全绿；`email-auth` / `api` / `cli-dispatch` 三个链外文件单独跑也通过
- `npm run frontend:build` 构建通过；`npm ci --dry-run` 确认 lockfile 与 `package.json` 一致
- `node scripts/check-html-syntax.mjs`（含 `banned.html`）通过
- 本地 `serve` 冒烟：`/`、`/console`、`/banned`、`/assets/*` 返回预期内容，缺失资源 404，
  封禁页正确注入 `window.__BAN_PAGE__`
- 浏览器渲染验证：首页渲染出 47 款游戏与报价；后台 10 个模块逐个切换无 JS 报错
  （仅本机无 Steam 出口导致封面图 404，属环境限制）

## [0.32.0] - 2026-10-29

Steam 定时任务改为「每日刷新已有报价」，长任务遇到 429 自动退避重试。

### 变更

- **定时任务拆分**：`sync steamall`（增量补全）改为后台「数据回填」负责；
  定时任务变为 `steam-prices`：只刷新**已经有 Steam 报价**的游戏，默认**每天一次**
  （`STEAM_PRICE_INTERVAL_MIN=1440`），首轮延迟 600 秒
- 设置项 `sources.steam.intervalMin` → `sources.steam.priceIntervalMin`，
  环境变量 `STEAM_INTERVAL_MIN` → `STEAM_PRICE_INTERVAL_MIN`（旧值不再读取，默认 1440）
- `sync steamall` 跳过 1 天内已回填过的游戏；没有待补游戏时正常退出（不再报错）
- 控制台同步记录的「steam-prices」显示为「Steam 价格刷新」

### 修复

- **429 长任务自动重试**：新增 `STEAM_429_RETRIES`（默认 1）；后台回填与定时价格任务设为
  `Infinity`，冷却按 30 分钟 → 1 小时 → 2 小时…最多 6 小时递增后自动重试，
  不会因一次 429 直接退出（手动同步仍是有限重试）
- 回填说明文案更新：任务在服务器后台运行，关页面/关电脑不影响

### 测试

- `scheduler.test.js` / `settings.test.js` 随新任务名与新设置键更新

## [0.31.3] - 2026-10-29

回填取价遵守 Steam appdetails 的限流。

### 修复

- Steam `store/api/appdetails` 限 **200 次/5 分钟**（≈ 最低 1.5 秒/请求），
  回填价格回退原来 1.1 秒/批（约 270 次/5 分钟），超限会被 429 并触发 30 分钟冷却
- 回填价格回退改为：**单批 50 个、间隔 2 秒**（150 次/5 分钟），留出限流余量
- `syncPrices` / `syncMeta` 默认间隔从 1.1 秒同步改成 2 秒
- 429 行为不变：全局冷却 30 分钟后只重试一次，避免把代理 IP 打进风控

## [0.31.2] - 2026-10-29

设置页保存栏不再吸顶，避免遮住顶部搜索栏。

### 修复

- `#settingsBar` 从 `position:sticky` 改为普通文档流（保留底部间距），展开设置项时不会覆盖搜索栏

## [0.31.1] - 2026-10-29

限流退避修正：429 重试改为 20 秒。

### 修复

- 出网请求遇到 429（限流）时，重试等待从 500ms 提高到 **20 秒**，避免连续重试把出口 IP 打进风控；
  403 仍然不重试

## [0.31.0] - 2026-10-29

安全加固 + 控制台导航重构。

### 新增

- **首次初始化口令自动生成**：未配置 `SETUP_TOKEN` 时启动生成一次性随机口令并打印到日志，
  防止公网部署被别人抢先初始化；配置了则仍用配置值
- **`TRUSTED_PROXY_IPS`**：`TRUST_PROXY=1` 时必须同时列出代理来源 IP/CIDR 才信任
  `X-Forwarded-For` / `X-Real-IP`，公网直连请求不能再伪造转发头；私有网段仍自动信任
- 5 个 compose 变体透传 `TRUST_PROXY` / `TRUSTED_PROXY_IPS` / `RATE_LIMIT_*`

### 变更

- **会话 Cookie 统一**：密码登录、邮箱验证码、首次初始化共用一个构造函数，
  统一 `HttpOnly` + `SameSite=Lax`，HTTPS 下自动加 `Secure`
- **验证码邮件正文不再落库**：数据库只存哈希与脱敏占位，老库启动时自动清洗历史正文
- 邮箱验证码请求改为统一通用提示（不区分邮箱未绑定/禁用/未验证/发信失败），防账号枚举
- 密码长度统一为 8–200 位（邮箱重置密码、CLI 创建用户）
- 限流内存表加容量上限、配置值做范围校验；补充 IPv6 链路本地/保留网段识别
- **控制台导航重构**：侧栏分组 + 功能搜索 + 吸顶子导航，设置页吸顶保存栏与搜索联动

### 测试

- `email-auth.test.js` 更新为「正文不存明文验证码」：验证码只从发出的邮件里取并校验哈希

## [0.30.5] - 2026-10-29

修复回填原地打转：同一批游戏被反复处理，价格永远写不进去。

### 修复

- **回填原地打转**：`upsertGameMeta` 不写 `description`，且选择条件里
  `not exists (steam offer)` 对无报价游戏永远为真，导致每批都选中同一批游戏
  （实测 20 个单批请求全部是 `appid=730`，「写入 10000」只是同一批跑了 100 遍）
  - 新增 `games.backfill_at`：处理过的游戏（无论有没有拿到报价）一天内不再被选中
  - `upsertGameMeta` 现在会写 `description`（只填空，不覆盖人工编辑）
  - 每批写库后统一 `markBackfilled`，进度是真正的新游戏
- 诊断日志：GetItems 无价格时打 `store_browse.no_price_shape`（顶层字段 + `best_purchase_option` 字段）；
  appdetails 0 报价时打 `adapter.steam.no_offers`，带响应片段，用于区分「success:false / 免费 / 锁区」

### 测试

- `pg.test.js` 新增：`description` 写入、`backfill_at` 标记、已有说明不被覆盖（12/12）

## [0.30.4] - 2026-10-29

回填价格改用 appdetails 回退取价：不再依赖 GetItems 的价格字段。

### 修复

- **GetItems 拿不到价格**（字段名/接口变化，实测 `priced=0`）：回填对没有价格的 appid 自动用
  `store.steampowered.com/api/appdetails` 批量回退（30 个/请求、1.1s 间隔），拿到 `price_overview`
  后再写 `offers` / `daily_prices`
- GetItems 自带价格仍然优先使用；两路结果按 appid 去重，不会重复写
- 新增 `backfill.price_fallback` 日志（回退 appid 数 / 请求数 / 拿到报价数）；
  回退遇到 403/429 立即中止，避免把出口 IP 打进风控
- 单批「价格 0 条」的提示改为「GetItems 与 appdetails 回退都没拿到」

### 测试

- `backfill.test.js` 新增 4 项：缺价 appid 筛选与去重、GetItems 报价转换、两路报价合并去重

## [0.30.3] - 2026-10-29

修复回填「有元数据、没价格」的真正原因：价格字段名解析错了。

### 修复

- **`mapStoreItem` 读错价格字段**：Steam `GetItems` 返回的是
  `final_price_in_cents` / `original_price_in_cents` / `discount_pct`，
  之前读的是 `final_price.amount`，导致每条的 `priceOverview` 都是 null →
  `offers` / `daily_prices` 一条没写，前端「有价格」一直停在约 1000 款
- 同时兼容旧形态（`final_price` 为整数或 `{amount}`）和 `purchase_options` 数组；
  免费游戏用 `is_free` 判断
- 说明：`include_best_purchase_option` 在 proto 里默认就是 true，0.30.1 补的那一项无害，
  但不是问题根因（请求前后响应字节数完全一致）

### 测试

- `store-browse.test.js` 增加真实字段名、免费游戏 `is_free` 的用例（共 10 项）

## [0.30.2] - 2026-10-29

控制台游戏管理：去掉「显示图片」开关，图片列改为始终显示。

### 变更

- 移除「显示图片」复选框和条件判断：列表加载即显示封面（仍保留 `loading="lazy"`，滚动到才加载）
- 没有 appid 的游戏继续显示 `—`，图片加载失败时自动隐藏

## [0.30.1] - 2026-10-29

修复数据回填只写元数据、不写价格：GetItems 必须显式要价格字段。

### 修复

- **GetItems 请求补 `include_best_purchase_option: true`**：不加这一项 Steam 不返回
  `best_purchase_option`，回填日志里的「写入 10000」只是元数据，价格一条没写，
  前端「有价格」一直停在原来的约 1000 款（列表只显示有价格的游戏）
- `mapStoreItem` 兼容 `final_price` 的两种形态（`{amount,currency}` 与整数 + `currency_code`），
  以及价格放在 `purchase_options` 数组里的情况
- 回填日志新增「价格 N 条」；一批里一条价格都没拿到时写 `backfill.batch_no_price` 警告，
  结束时价格 0 条给出明确提示（批次进度行格式保持不变，控制台进度解析不受影响）

### 测试

- `store-browse.test.js` 补 3 项：请求体必须带 `include_best_purchase_option`、
  整数价格形态、`purchase_options` 形态

## [0.30.0] - 2026-10-29

自动封禁恢复，改为**按天三振**：10 分钟 → 30 分钟 → 封到当天结束。

### 变更

- 页面/API 超频重新**自动封禁**（不再只记录等人工审批）：
  第 1 次封 **10 分钟**、第 2 次 **30 分钟**、第 3 次 **封到当天结束**（次日 0 点自动恢复）
- **每天最多 3 次**：封到当天结束后不再累加/升级，`strikes` 封顶在 3
- 三振按天重置：跨天后 `strikes` 归零，重新从 10 分钟起算（新增 `ip_abuse.strike_day`）
- 封禁期内继续请求仍按 `blockedEscalate`（默认 100 次）升一档；**永不自动写永久黑名单**
- 每次自动封禁同时写一条「待审核」记录，管理员可提前解封或改为永久封
- 扫描器/未知路径策略不变：只记录待审核，由管理员决定封不封
- 控制台规则说明、README 同步更新

### 修复

- 封禁页申诉按钮点击无反馈：没装邮件客户端时 `mailto:` 不会有任何反应，
  现在点击会**复制申诉内容并显示申诉邮箱**，另提供「复制申诉内容」按钮（9 种语言）

### 测试

- `ratelimit.test.js`：第 3 次封到次日 0 点、`nextMidnight` 边界、当天封顶后不再累加
- `reviews.test.js` 新增真 PGlite 集成用例：三振升级 → 封顶后不再累加 → 重启后恢复「当天封禁」→ 次日 `strike_day` 归零重新封 10 分钟
- `reviews.test.js` 增加封禁页申诉兜底按钮/提示区域的断言

## [0.29.1] - 2026-10-29

修复封禁页「发送申诉邮件」点了没反应。

### 修复

- 申诉按钮是 `mailto:` 链接：没装邮件客户端（或浏览器/内置浏览器拦截 mailto）时点击完全没有反馈。
  现在点击后**同时复制申诉内容**并在页面显示「如果邮件客户端没有打开，请手动发送到 xxx@…」
- 新增「复制申诉内容」按钮（9 种语言都有对应文案），复制失败时提示手动记录申诉编号和邮箱
- 切换语言会重置提示、更新按钮文案

### 测试

- `reviews.test.js` 增加断言：封禁页必须包含复制兜底按钮和可见提示区域

## [0.29.0] - 2026-10-29

站点通知、设备指纹、封禁提示页；同时把「自动封禁」改成「记录待审核，管理员审批」。

### 新增

- **站点通知**：后台「站点通知」页可写标题/正文/级别/启停/生效时间窗口，前台顶部横幅展示，
  用户点 × 关闭后本机不再提示；接口 `GET /api/announcements`（公开）与
  `GET/POST/PATCH/DELETE /api/admin/announcements`（管理员）
- **设备指纹**：前台页面加载时上报平台/语言/时区/屏幕/CPU/内存/WebGL/Canvas 等，
  服务端只存 sha256 指纹（不存原始 canvas）；控制台「访问记录 → 设备」可看最近设备并一键封禁，
  封禁按指纹生效，同一设备换 IP 也会命中；接口 `POST /api/device`（公开）、
  `GET /api/admin/devices`、`GET/POST/DELETE /api/admin/device-bans`
- **封禁提示页** `web/banned.html`：按浏览器语言（简体/繁体/英/日/韩/俄/西/法/德）展示，
  带申诉编号和 `mailto:` 申诉入口；封禁响应改为：浏览器请求返回提示页（403 + HTML），
  API/脚本仍返回纯文本。申诉邮箱由 `APPEAL_EMAIL` 配置，站点名由 `SITE_NAME` 配置；
  每次返回提示页记 `ban.page`（含申诉编号），收到申诉邮件后可按编号在日志里定位
- **异常请求审核**：扫描器路径（`.env`/`.git`/`*.php`/`..` 等）、未知路径超阈值、IP 超频
  只写入 `abuse_reviews`（同 IP+规则合并计数），不再自动封禁；控制台「访问记录 → 待审核」
  可对每条记录选择「封 IP / 封设备 / 忽略」，审批后才写黑名单/设备封禁

### 变更

- **限流不再自动写永久黑名单**：超频只做 10/30 分钟临时限流并记一条待审核，
  是否永久封由管理员决定（避免共享出口被几分钟内升成永久）

### 测试

- 新增 `test/reviews.test.js`（9 项）：扫描路径只记录不封、正常资源不误报、未知路径阈值、
  超频进审核、管理员审批后 403 + 多语言提示页、设备上报/封禁、拦截日志采样、限流分桶、XFF 防伪造
- 新增 `test/announcements.test.js`（2 项）：生效窗口过滤、管理员增改删与公开接口
- 新增 `test/devices.test.js`（5 项）：设备 ID 校验、字段截断、指纹稳定性、写库节流、设备→指纹映射
- `ratelimit.test.js` 更新：不再自动永久封，第三次超频只续临时封禁并标记待审核

## [0.28.0] - 2026-10-29

回填任务搬到后台：控制台直接启动/停止、看实时进度；回填本身更快、遇到限流会立刻停。

### 新增

- **控制台「数据回填」卡片**：上限 / 每批 / 间隔 / 回退数可调，支持开始、停止，
  实时显示批次、已处理比例、写入/回退/失败、速度；任务记入「同步记录」（模式「数据回填」）
- 新增管理员接口 `POST /api/admin/backfill`、`POST /api/admin/backfill/stop`、
  `GET /api/admin/backfill/status`
- 回填与同步**共用同一个子进程槽位**：同一时间只跑一个 Steam 任务，避免叠加请求触发限流

### 变更

- 回填写库从「每款一个数据库连接」改为「每批一个连接」（100 次/批 → 1 次/批）
- 新增 `--fallback N`：单条回退上限可调，0 = 关闭单条回退
- `fetchStoreItems` 支持 `throwOnFatal`：403/405/429 直接抛给调用方处理

### 修复

- 回填遇到 **429/403 立即中止**（之前只在单请求上退避 20 秒，任务会继续打）；
  405 直接提示镜像过旧（需要 ≥0.25.2 的 GET + input_json 实现）
- 停止任务先 SIGTERM，10 秒未退再 SIGKILL；任务状态记为「已停止」

### 测试

- 新增 `test/backfill.test.js`：参数收敛、子进程参数拼装、进度解析
- `sync-runs.test.js` 增加回填接口的权限 / 空状态 / 停止 409 断言
- `store-browse.test.js` 增加 `throwOnFatal` 行为断言

## [0.27.0] - 2026-10-29

访问安全：限流分桶、扫描路径自动临时封禁、拦截日志与正常访问分开统计。

### 新增

- **路径守卫**（`src/guard.js`）：白名单 = 页面/图标/`outDir` 下真实存在的静态文件/`/api/`/`/img/`/`robots.txt` 等良性探测；
  扫描器签名（`.env`、`.git`、`*.php`、`..`、`/wp-`、`/phpmyadmin`、`/etc/passwd` 等）命中立即 403 并封禁
- **封禁策略**：首次 1 小时、24 小时内重犯 24 小时，独立 `path_strikes` 计数，**永不自动写永久黑名单**；
  封禁期内继续请求不参与三振升级（避免共享出口被几分钟内升成永久）
- **未知路径**：默认只记录（`PATH_BAN_UNKNOWN_MODE=log`），可配成达到阈值（默认 10 分钟内 30 个不同路径）后封禁
- **拦截日志**：`visitor_logs` 新增 `blocked` / `block_reason`，429/403/路径封禁按 IP 每分钟采样一条；
  控制台访问记录新增「正常访问 / 被拦截 / 全部」筛选，被拦截请求不计入今日访问量
- 自动封禁列表新增「路径封禁次数 / 来源（频率限制 or 路径规则）」列

### 修复

- **限流误伤**：原先封面图等静态资源也计入 60 次/60 秒，正常翻页可能把用户顶到阈值并被封。改为两个桶：
  页面/API 默认 60 次/60 秒，静态资源/图片默认 300 次/60 秒（`RATE_LIMIT_ASSET_MAX`）
- **XFF 伪造**：`clientIp` 改为优先 `X-Real-IP`、否则取 `X-Forwarded-For` **最后一跳**，并校验必须是合法 IP。
  之前取第一个值，反代使用 `$proxy_add_x_forwarded_for` 时客户端可伪造任意 IP（配合自动封禁等于"任意 IP 拉黑器"）

### 测试

- 新增 `test/guard.test.js`（6 项）：白名单、扫描器签名、编码/大小写归一化、未知路径去重计数、资源判定
- 新增 `test/pathban.test.js`（7 项）：XFF 只信最后一跳、扫描路径临时封禁且不自动永久、正常页面+封面不封、
  未知路径阈值、拦截日志采样与统计隔离、访问记录接口筛选、限流分桶

## [0.26.2] - 2026-10-29

前台列表布局：封面与游戏名固定同一行，名字不再折行。

### 修复

- 首列改成 flex：封面固定 92×43（窄屏 64×30），游戏名单行显示，超长用省略号
  （悬停看全名）；英文名不再另起一行，改为跟在中文名后面的小字
- 表格固定列宽（现价 180 / 原价 96 / 折扣 80 / 各平台 236），名字列吃剩余空间；
  内容区 1100 → **1240px**，长名字不再把表格撑出卡片、也不再被价格列挤到折行
- 现价下方的「其他平台最低」压成 11px 单行；窄屏隐藏（各平台列的胶囊已有同样信息）
- 窄屏（≤760px）表格保持列宽、卡片内横向滚动，封面缩到 64×30，名字仍单行省略

### 测试

- 无新增自动化测试；用 Playwright 在 1526 / 1280 / 900 / 390 四档宽度渲染真实页面核对：
  每行封面与名字垂直居中对齐、名字单行、表格不超出卡片（详见提交说明）

## [0.26.3] - 2026-10-29

访问统计口径修正：一次刷新不再记十几条。

### 修复

- **GET 类 API 数据请求（2xx/3xx）不再写入访问记录**：之前一次控制台刷新会打约 10 个
  `/api/*` 请求，每个都记一条，导致「刷新一下访问量跳十几」
- 仍然记录：页面访问（`/`、`/console`、`/game/*`）、登录与修改类请求（POST 等）、
  以及所有 4xx/5xx（含 403 拉黑、429 限流），排障信息不丢

### 测试

- `visitors.test.js` 改为断言「登录 POST 有记录、GET /api/games 不记录」
## [0.26.1] - 2026-10-29

控制台轮询降噪。

### 变更

- 轮询类接口（`/api/admin/sync/status`、`/api/admin/sync/runs`）**不再写访问日志**，
  避免控制台开着页面就把访问统计刷高
- 控制台同步状态轮询：3 秒 → **10 秒**，页面不可见时降到 30 秒
- 日志页自动刷新：3 秒 → **10 秒**，页面不可见时暂停

## [0.26.0] - 2026-10-29

取消前台自动刷新；修正封禁期内请求不计数的问题。

### 变更

- **前台不再自动刷新**：移除 10 秒一次的数据指纹轮询，改为顶部「刷新」按钮手动触发
  （手机/多标签页不会再因为自动轮询被限流误伤；切换页签/排序/搜索仍会重新拉数据）

### 修复

- **限流升级逻辑**：之前封禁期内的请求直接 429 返回、**完全不计入任何计数**，
  所以出现「某 IP 访问 634 次、累计超频却只有 1 次」的怪现象。现在封禁期内的请求
  会累计「违禁请求」，每满 **100 次**直接升级一档封禁（10 分钟 → 30 分钟 → 永久黑名单），
  升级动作写日志 `rate.banned escalated=true`
- 429 响应补上 `Retry-After` 头，明确告诉客户端还要等多久

### 测试

- `ratelimit.test.js` 改为验证「封禁期内继续请求会升级」：10 分钟 → 30 分钟 → 永久

## [0.25.2] - 2026-10-29

修复 GetItems 批量接口 405。

### 修复

- Steam 的 `IStoreBrowseService/GetItems` **只接受 GET**（POST 返回 405），改为
  `GET ?key=&input_json=<JSON>`
- 响应统一包在 `response` 里，按 `response.store_items` 读取（兼容直接返回 `store_items`）

## [0.25.1] - 2026-10-28

站点图标：补上 SteamDeals 的 favicon（品牌渐变 + 百分号），三个页面统一引用。

### 新增

- **`web/favicon.svg`**：64×64 圆角方块，`#22d3ee → #4f46e5` 品牌渐变 + 白色百分号（与前台 logo 同一个渐变）
- **`web/favicon.ico`**：32×32 PNG 压缩 ICO，老浏览器和 `/favicon.ico` 默认请求不再 404
- **`web/apple-touch-icon.png`**：180×180 全出血方图，iOS「添加到主屏幕」用
- 前台 / 控制台 / 初始化三个页面都加了 `rel="icon"` 与 `apple-touch-icon`；
  初始化未完成时也放行图标，`/setup` 页标签页图标不再被 302 掉

### 测试

- 新增 `test/favicon.test.js`：三个页面引用一致且文件存在、SVG/ICO/PNG 格式合法性（含 ICO 头部与内嵌 PNG 校验）

## [0.25.0] - 2026-10-28

批量回填全量游戏的元数据与国区价格。

### 新增

- **ackfill 命令**：用 `IStoreBrowseService/GetItems`（一次最多 100 个 appid，需 `STEAM_API_KEY`）
  批量补名称/类型/开发商/发行商/简介/国区现价与原价，配合 `upsertGameMeta` + `ingestOffers` 落库
- 单批失败或个别 appid 不返回时，自动**回退单个 appdetails**（每批最多 10 个，避免拖慢）
- 只处理「缺说明或缺 Steam 报价」的游戏，可断点续跑；默认**不下载图片**（之后 `images pull` 只补有价格的）
- 用法：`node src/cli.js backfill --batch 50 --sleep 1500 --limit 20000`

### 测试

- 新增 `test/store-browse.test.js`：请求体（100 上限/上下文）、字段映射（含免费/DLC/无价）、
  分批与缺失 appid 收集、无 key 抛错
## [0.24.5] - 2026-10-28

修复前台列表卡在「加载中…」。

### 修复

- 0.23.3 引入的「新史低」标签有一处变量自引用（`lowTag` 初始化时引用自己），
  导致列表渲染抛 ReferenceError、页面一直停在「加载中…」——已改为
  `isNewLow ? 新史低 : (atLow ? 史低 : 空)`
## [0.24.4] - 2026-10-28

Steam 限流（429/403）处理：更长退避 + 触发中止。

### 修复

- 429/403 的重试退避从 0.5 秒改为 **20 秒**（原来 0.5 秒重试只会加重封禁）
- `sync steamall` 连续 **5 次 403/429** 立即**中止本轮**并以非 0 退出，
  让调度器熔断（连续 3 次失败暂停 6 小时），不再一小时一次地硬打

### 运维建议

- 被限流后先在「系统设置 → 数据源与采集」关掉 Steam，等 1~2 小时
- 恢复时用 `--limit 20~50 --sleep 8~10 --concurrency 1`，不要同时补图（`SYNC_IMAGES_ENABLED=0`）
## [0.24.3] - 2026-10-28

合并重复的邮件配置入口。

### 变更

- 侧栏「邮箱配置」改名为「邮件测试」，**删除重复的 SMTP 表单**（主机/端口/账号/授权码统一在「系统设置 → 降价提醒」维护）
- 该页保留：发送测试邮件、验证码发送记录（用途/结果/时间/内容查看）
- 测试邮件必须显式填写收件邮箱（不再从已删除的账号输入框取值）
## [0.24.2] - 2026-10-28

控制台：设置页保存栏悬浮 + Ctrl+S；数据统计页加锚点导航。

### 新增

- **系统设置**：保存栏改为**吸顶悬浮**，滚动到任何位置都能直接保存；支持 `Ctrl+S / Cmd+S`（仅在设置页生效）
- **数据统计**：顶部新增锚点导航（价格变动 / 近 7 天趋势 / 图片缓存 / 备份 / 浏览排行），点击平滑跳转
## [0.24.1] - 2026-10-28

Steam 登录：OpenID 校验失败时自动改直连重试。

### 修复

- 代理把 `steamcommunity.com` 连接重置（`ECONNRESET`）时，OpenID 校验再**直连重试一次**，
  并在日志里记 `steam.openid_retry_direct`；两次都失败才提示「Steam 校验失败」
- `diagnose` 增加 `proxy:connect:community`（专门验证 `steamcommunity.com:443` 的隧道）
## [0.24.0] - 2026-10-28

增量同步顺带下载封面图。

### 新增

- `sync steamall` 在写完元数据/价格后，**顺手把本次同步游戏的封面图下载到本地**
  （默认尺寸 `capsule_sm_120` + `header`，每张间隔 200ms；失败只记日志不影响同步结果）
- 同步结束会打印「封面图：成功 N 张，失败 M 张」，并写进同步记录的结果摘要
- 参数：`--images 0` 关闭、`--image-sleep` 调节间隔、`--image-sizes` 指定尺寸；
  环境变量 `SYNC_IMAGES_ENABLED=0` 可全局关闭（关掉后仍由 4 小时的补图任务兜底）
## [0.23.3] - 2026-10-28

前台区分「新史低」与「史低」。

### 新增

- 列表接口新增 `prev_hist_low`（**今天之前**的历史最低价，不含当天快照）
- 前台：当前价低于 `prev_hist_low` 时显示橙色 **新史低**；否则达到历史最低显示绿色 **史低**
- 详情弹窗同步显示「史低」金额（口径不变）
## [0.23.2] - 2026-10-28

停用邮箱验证码登录；发信增加 IP 与全站额度。

### 变更

- **前台登录只保留密码登录**：移除「邮箱验证码」登录入口（邮箱仍用于绑定验证与忘记密码）
- **发信防轰炸**：除原有的「同邮箱 60 秒冷却 + 每小时上限」外，新增
  **单 IP 每小时最多 10 封**、**全站每天最多 200 封**；超限返回 429 并提示稍后再试
- 超限事件记日志：`auth.otp_ip_limited` / `auth.otp_daily_limited`
## [0.23.1] - 2026-10-28

访问记录页拆分子视图，明细表内部滚动。

### 变更

- 「访问记录」页拆成两个子标签：**访问记录**（明细）与 **统计 / 黑名单 / 白名单 / 自动封禁**
- 访问记录表格改为**固定高度内部滚动 + 表头吸顶**（最多 58vh），数据再多也不会把页面拉长
- 默认进入「访问记录」明细视图；切换标签不重新请求数据
## [0.23.0] - 2026-10-28

登录增加图形验证码，进一步压低爆破空间。

### 新增

- **登录图形验证码**（自托管 SVG，不依赖第三方）：4 位字符（去掉 0/O/1/I），旋转 + 噪点 + 干扰线，
  一次性、5 分钟过期、用完即删；答案只存库、不下发前端
- GET /api/captcha 取图（匿名，禁止缓存）；POST /api/login 必须带 `captchaToken` + `captchaAnswer`，
  验证码校验在密码校验之前——错误验证码不消耗密码尝试次数，也不泄露账号是否存在
- 控制台登录框、前台登录弹窗都已接入；点击图片或「换一张」可刷新
- `CAPTCHA_ENABLED=0` 可关闭（离线调试/自动化测试用）

### 测试

- pi.test.js 新增：验证码下发 SVG 且落库、开启后无验证码登录 400、错误验证码 400
- 会登录的测试文件统一在测试进程内关闭验证码（不干扰既有断言）
## [0.22.0] - 2026-10-28

安全加固（频率限制/白名单/响应头）、控制台布局优化、定时任务状态展示。

### 安全修复（按严重程度）

- **高：无任何频率限制** → 新增 IP 频率限制：60 秒内超过 60 次页面/API 请求判定异常，
  第 1 次封 10 分钟、第 2 次 30 分钟、第 3 次自动写入永久黑名单；内网/本机（反代、健康检查）不计数
- **高：登录接口可被爆破** → 同上限流覆盖 `/api/login`（超频即 429）
- **中：会话 Cookie 缺 `Secure`** → HTTPS 请求（含反代 `x-forwarded-proto: https`）时自动加 `Secure`
- **中：缺安全响应头** → 统一加 `X-Content-Type-Options`、`X-Frame-Options: DENY`、
  `Referrer-Policy`、`Permissions-Policy`，HTTPS 下加 HSTS
- **中：`X-Forwarded-For` 可伪造绕过限流/黑名单** → 只有直连来源是内网/本机（即反代）时才采信 XFF，
  否则一律用 socket 地址；可用 `TRUST_PROXY=1` 强制信任

### 新增

- **IP 白名单**：`ip_whitelist` 表 + 控制台增删；白名单不受频率限制与黑名单影响
- **自动封禁记录**：`ip_abuse` 表，控制台可看超频次数/封禁到期时间，支持手动解封
- **接口**：`GET/POST /api/admin/whitelist`、`DELETE /api/admin/whitelist/:ip`、
  `GET /api/admin/abuse`、`DELETE /api/admin/abuse/:ip`
- **定时任务状态**：调度器把各任务的间隔/上次/下次运行写 `data/scheduler-status.json`，
  控制台「游戏管理」顶部展示「手动同步立即执行 / 定时同步按间隔自动跑」，并显示 steam 下次运行时间

### 变更

- **同步记录更紧凑**：默认只显示最近 5 条，「展开全部」看 20 条；结果列单行截断，完整内容悬停查看
- **系统设置页**：顶部新增分组跳转 + 搜索框（按名称/键/帮助过滤），每个分组可折叠

### 审计结论（无需修改的项）

- SQL 全部参数化（备份表名取自代码内白名单）；静态文件服务已做 `resolve` 越界拦截；
  图片路由限定 appid 数字与尺寸白名单；密码用 scrypt 加盐；会话 token 32 字节随机；
  Cookie `HttpOnly + SameSite=Lax`；邮箱验证码存哈希；敏感设置 AES 加密存储

## [0.21.2] - 2026-10-28

前台自动刷新改为「数据指纹」轮询，数据没变就不重拉列表。

### 变更

- **前台实时更新优化**：每 10 秒只查 `GET /api/games/stamp`（游戏数 / 报价数 / 最新报价时间），
  指纹变了才调 `/api/games` 重新拉列表；页面切回前台时同样只查指纹
- **指纹接口不写访问记录**（`isLoggablePath` 排除），自己的轮询不会再把自己的访问统计刷高

### 测试

- `api.test.js` 新增：指纹字段齐全、数据变化后指纹改变、轮询不产生访问记录

## [0.21.1] - 2026-10-28

同步失败不再只有 `fetch failed`：代理拒绝建隧道时，直接把代理的回答写进同步记录。

### 修复

- **代理拒绝 CONNECT 的报错说清楚了**：undici 把真实原因埋在三层 `cause` 里（最外层 `fetch failed`、
  中间层是 `code=0` 的 `Request was cancelled.`、最底层才是 `Proxy response (407) !== 200 when HTTP Tunneling`）。
  现在顺着 `cause` 链挖到底，同步记录显示 `fetch failed (PROXY_407) → api.steampowered.com · 代理要求认证… · 经 steam-proxy`，
  日志同时记 `proxyStatus` / `cause`，不再出现毫无意义的 `code=0`
- **403/407 不再无意义重试**：这是代理配置问题，重试 3 次只会拖慢并刷屏；代理 5xx 仍然重试
- **`diagnose` 增加代理隧道探测**：对 `store.steampowered.com:443` 与 `api.steampowered.com:443` 各发一次 CONNECT，
  直接打印代理的状态码（407 要账号密码、403 是代理不放行、200 才算通）；探测用未脱敏的代理地址，带账号密码也能验通
- **代理地址格式配错时会明说**：`STEAM_PROXY=socks5://…` 这类值原来被静默丢弃、回落直连，
  `diagnose` 现在报 `proxy:format` 失败

### 测试

- 新增 `test/http-error.test.js`：三层 cause 链解析、`code=0` 不当错误码、407 不重试且提示可操作、
  起本地假代理真实走一遍 undici `ProxyAgent`（407 → `PROXY_407` 且只请求一次，502 → 重试）

## [0.21.0] - 2026-10-28

控制台显示当前版本，并在有新版本时提示。

### 新增

- **侧栏版本号**：控制台左下角显示「版本 v0.21.0」（取自 `package.json`，点击可立即重新检查）
- **新版本提示**：检查 GitHub 仓库的 release / tag，若比当前版本新，显示「↑ 新版 vX 可用」，
  点击跳到对应 release 页
- **接口**：`GET /api/admin/version`（管理员），返回 `{current, latest, updateAvailable, url, checkedAt, error}`；
  服务端缓存 6 小时（GitHub 未认证额度只有 60 次/小时），`UPDATE_CHECK=0` 可完全关闭出网检查，
  `UPDATE_REPO` 可换检查的仓库
- 检查失败（没网/被墙/额度耗尽）只在 `error` 里说明，不影响页面

### 测试

- 新增 `test/version.test.js`：版本解析/数值比较、无 release 时退回 tags、已是最新、缓存与强制刷新、网络失败
- `api.test.js` 新增：版本接口返回当前版本、`UPDATE_CHECK=0` 时不出网、匿名 401

## [0.20.2] - 2026-10-28

设置项敏感字段可查看明文（按需解密 + 审计），非敏感字段本来就地明文。

### 新增

- **敏感字段「查看 / 隐藏」**：系统设置里已配置的密钥（代理地址、API Key、Webhook、SMTP 授权码等）
  输入框旁新增「查看」按钮，点一下按需拉取明文、再点隐藏；未配置时按钮不出现
- **接口**：`GET /api/admin/settings/value?key=<设置键>`（管理员，仅 `secret` 类型字段），
  每次查看记 `settings.revealed` 审计日志（含操作人）
- 列表接口依旧不回显密钥（避免批量泄漏），明文只在显式点击时返回

### 测试

- `api.test.js` 新增：保存敏感字段 → 列表不回显 → 单独查看得到明文 → 非敏感字段 400 → 匿名 401

## [0.20.1] - 2026-10-28

`diagnose` 增加 Steam Web API Key 校验。

### 新增

- `diagnose` 新增 `steam.api_key` 检查（`ISteamUser/GetPlayerSummaries`）：
  `store/api/appdetails` 是免 key 的，同步成功不能证明 key 有效；这项单独验证
  403 / 结构异常会明确提示 key 无效

## [0.20.0] - 2026-10-28

收尾四件：区服筛选、单款历史 CSV、后台备份入口、日志时间范围。

### 新增

- **前台区服筛选**：筛选栏新增「国区/港区/台区/美区/日区/俄区/土区/阿区」下拉，
  列表价格随区服切换（不同币种不折算）；区服选择记入浏览器缓存
- **单款价格历史 CSV**：`GET /api/games/:appid/history.csv?days=90`（带 BOM）；
  详情弹窗加「导出价格历史 CSV」按钮
- **后台备份入口**：「数据统计」页可「立即备份」并查看已有备份文件与大小；
  `POST /api/admin/backup`、`GET /api/admin/backups`（管理员）
  备份逻辑抽到 `src/backup.js`，CLI `backup` 与接口共用同一实现
- **日志时间范围**：「日志」页新增「最近 1 小时 / 6 小时 / 24 小时」过滤（`?minutes=`）

### 修复

- 备份流程在 `email_codes` 表不存在时（未初始化/测试环境）不再整体失败，跳过该清理并记警告

### 测试

- `api.test.js` 新增：备份生成与列表、匿名 401、单款历史 CSV 内容、区服筛选、日志时间参数

## [0.19.9] - 2026-10-28

价格报表主动推送。

### 新增

- **`report price --notify`**：把报表（降/涨价条数、新史低、Top 涨跌、近 7 天趋势）推到已配置的
  webhook / 企业微信 / 邮件通道
- **调度器 `report` 任务**：配置了任意提醒通道后自动启用，默认每天推一次
  （`REPORT_ENABLED=0` 关闭，`REPORT_INTERVAL_MIN` 调间隔）

### 测试

- `scheduler.test.js` 新增：无通道时不建任务、有通道时参数正确、`REPORT_ENABLED=0` 可关

## [0.19.8] - 2026-10-28

采集健康度覆盖全部源；前台支持按类型（游戏 / DLC）筛选。

### 新增

- **`fetch_runs` 覆盖全部同步源**：`steamall / catalog / sonkwo / itad / gog / humble` 每次同步都写一行
  （`sync steam` 原本就有，避免重复写入）；`stats` 命令与排障能直接看到每个源的采集健康度
- **类型筛选**：`GET /api/games?type=game|dlc|all`；前台筛选栏新增「全部类型 / 游戏 / DLC」下拉

### 测试

- `api.test.js` 新增：type 过滤（游戏/DLC/默认/非法值回落）

## [0.19.7] - 2026-10-28

`sync steamall` 并发抓取提速。

### 新增

- **并发池**（`src/pool.js`）：固定 worker 数循环取活，天然限流；单项失败隔离、结果保序
- `sync steamall` 新增 `--concurrency`（默认 **4**，上限 16），配合 `--sleep` 控制总速率；
  `--concurrency 1` 回到原来的串行行为
- 调度器的 steam 任务显式传 `--concurrency`/`--sleep`，可用 `STEAM_CONCURRENCY` / `STEAM_SLEEP_SEC` 调整

### 测试

- 新增 `test/pool.test.js` 4 项：并发上限、结果顺序、错误隔离、空列表/非法并发

## [0.19.6] - 2026-10-28

前台「到价提醒」入口（关注列表此前只能 CLI 操作）。

### 新增

- **详情弹窗到价提醒**（管理员登录可见）：填目标价（元，留空=只跟史低）→ 保存；
  已关注时显示「更新 / 取消提醒」与当前状态
- **接口**：`GET /api/admin/watchlist`、`POST /api/admin/watchlist`（`{gameId | appid, targetCents}`）、
  `DELETE /api/admin/watchlist/:gameId`——管理员专属（普通用户 403、匿名 401）

### 测试

- `api.test.js` 新增：按 appid 解析、留空覆盖成史低、普通用户 403、匿名 401、删除生效

## [0.19.5] - 2026-10-28

同步结束后控制台自动刷新数据。

### 变更

- **同步完成自动刷新**：任务从「运行中」转为结束的瞬间，自动重新拉取
  游戏列表、同步进度统计、同步记录，并弹出「同步完成，数据已刷新」提示——不再需要手动点刷新
- 只有真正观察到过「运行中」状态才触发刷新（进入页面时不会重复请求）
- 前台本来就有 10 秒自动刷新，不受影响

## [0.19.4] - 2026-10-28

按用户的收藏/标记（混合模式：个人优先，未标记回退全局）。

### 新增

- **`user_game_flags` 表**：`(user_id, game_id, interested, owned)`，字段为 null 表示"未标记"
- **个人标记接口**：`POST /api/games/:appid/flags`、`POST /api/games/id/:id/flags`
  （登录用户，`{interested?: bool, owned?: bool}`），返回该游戏对自己的生效值
- **生效规则（混合）**：`coalesce(个人标记, 全局标记)`
  —— 登录用户设置过就用自己的；没设置过就用管理员在 `games` 上维护的全局标记；
  未登录访客看到的是全局标记
- 列表与详情接口在登录态下返回**个人生效的** `interested` / `owned`，页签筛选也按生效值过滤
- 前台详情弹窗的「标记不感兴趣 / 标记已拥有」按钮对**所有登录用户**开放（之前只有管理员能点）

### 说明

- 管理员的全局标记仍在：CLI `interest/owned` 与旧接口继续维护它，作为"策展默认值"
- 个人标记写入后优先；想恢复跟随全局，把个人标记重新设成与全局相同的值即可

### 测试

- `api.test.js` 新增：全局已拥有 → 匿名/管理员列表被排除；alice 个人取消已拥有后可见；
  详情返回个人生效值；匿名写个人标记 401

## [0.19.3] - 2026-10-28

多区服展示、合并重复游戏入口、移动端适配。

### 新增

- **详情弹窗支持多区服**：报价表新增「区服」列（国区/港区/美区/俄区/土区…），金额按币种显示
  （¥/$/€/₽/₺ 等，不同币种不折算）；多区服数据本来就在库里有，之前前端没展示
- **合并重复游戏入口**（控制台「合并重复游戏」卡片）：填两个 Steam appid，
  把源的报价/快照/日聚合/关注迁移到目标后删除源行；接口 `POST /api/admin/games/merge`
- **移动端基础适配**：前台/控制台窄屏下侧栏折叠、表格横向滚动、字号与间距收紧

### 测试

- `api.test.js` 新增合并接口断言（报价迁移、源行删除、匿名 401、同源同目标 400）

## [0.19.2] - 2026-10-28

价格报表增强：新史低、按天趋势、CSV 导出。

### 新增

- **国内镜像入口**：`compose.cn.yaml` / `compose.cn.external-db.yaml` 使用腾讯云 TCR 公开镜像
  `ccr.ccs.tencentyun.com/tcb-100003189690-pljp/steamdeals`，国内不依赖 Docker Hub；
  `docker-tcr` 工作流负责推 amd64 app 镜像并镜像 `postgres:15-alpine`
- **新史低统计**：报表里新增 `newLows`——窗口内降价的游戏里，现价 ≤ 历史最低（日聚合）的条数
- **按天趋势**（`GET /api/admin/reports/price?days=7` 的 `daily`）：近 N 天每天降价/涨价/合计条数；
  控制台「数据统计 → 近 7 天变动趋势」
- **CSV 导出**：`GET /api/admin/reports/price.csv?hours=24`（管理员，带 BOM 便于 Excel 打开中文）；
  控制台价格变动卡片有「导出 CSV」按钮；CLI 支持 `report price --csv`（重定向到文件）
- `report price` 命令同时打印新史低与近 N 天趋势

### 测试

- `api.test.js` 补新史低、按天趋势数组、CSV 内容与匿名 401 断言

## [0.19.1] - 2026-10-28

前台服务端搜索/分页；同步任务（含定时）全部落记录；折扣字段上线。

### 新增

- **前台服务端搜索与分页**：`GET /api/games?q=&page=&pageSize=&sort=&interest=&owned=`
  返回 `{ games, total, page, pageSize, pages }`；搜索走全库（不再只搜已加载的 500 条），
  排序（折扣/价格/名称）由数据库完成，翻页按服务端数据拉取
- **字段 `discount`**：游戏的最大官方折扣，前台「折扣」列终于有值（此前一直显示 —，排序也失效）
- **同步任务全量留痕**：`sync steamall / catalog / sonkwo / itad / gog / humble` 以及 `sync steam`
  都写 `sync_runs`（控制台触发的任务复用同一条记录，不重复），定时同步也能在「同步记录」里看到；
  成功时把一行摘要（元数据条数、价格条数、涨跌条数）写进结果列

### 变更

- 前台列表改为服务端分页（每页 50/100/200 条可选），页大小、页码、搜索词、页签、排序都会反映到请求
- `sortGames` 不再参与 `/api/games`（排序下推到 SQL）

### 测试

- `api.test.js` 新增服务端分页/全库搜索/折扣排序断言（10 项）

## [0.19.0] - 2026-10-28

后台游戏管理新增「同步进度统计」与「同步状态筛选」。

### 新增

- **同步概览统计**（`GET /api/admin/games/stats`）：库内总数、有 appid 数、**待同步信息数**、
  已同步数（含进度百分比）、有报价数、已删除数；控制台游戏管理页直接在列表上方显示
- **同步状态筛选**：游戏列表新增下拉「全部同步状态 / 待同步信息 / 已同步」
  （`GET /api/admin/games?sync=pending|done`）——可以直接筛出还没补说明/没 Steam 价格的游戏

### 说明

- 「待同步」判定与 `sync steamall` 的选择条件一致：有 appid、未删除，且（缺说明 或 没有 Steam 价格）
- 目录里没有 appid 的行（如纯杉果游戏）不计入同步进度分母

### 测试

- `api.test.js` 新增：统计字段、待同步 → 已同步转换、pending/done 过滤、匿名 401

## [0.18.9] - 2026-10-27

价格报表第一版：每次同步的价格简报 + 涨跌榜。

### 新增

- **快照记住前价**：`price_snapshots.prev_price_cents`，入库时写入上一条快照的价格
  （之后涨跌、降幅都能直接算，不用再翻历史快照）
- **每次同步的价格简报**：`sync steamall` 结束时打印本次降价/涨价条数与 Top 榜
- **`report price` 命令**：`node src/cli.js report price --hours 24 --limit 10`
- **`GET /api/admin/reports/price?hours=24&limit=10`**（管理员）：返回汇总 + 降价 Top / 涨价 Top
- 控制台「数据统计」新增「价格变动（近 24 小时）」：降价/涨价条数 + 涨跌榜（原价 → 现价 → 幅度 → 时间）

### 说明

- 只统计带有前价的新快照；功能上线前写入的旧快照没有前价，不会进报表
- 「新史低」暂未纳入本期（需要与日聚合的最低价做对比，下期补）

### 测试

- `api.test.js` 新增：快照前价写入、报表统计与榜单、匿名 401

## [0.18.8] - 2026-10-27

后台编辑/前台详情 404 修复（单款查询不再依赖列表前 500 名）。

### 修复

- `/api/games/:appid` 与 `/api/games/by-id/:id` 之前是「取概览前 500 条再搜目标」，
  排在 500 名之后、或还没有报价数据的游戏会返回 404——控制台点「编辑」报「载入失败：没有该游戏」
- 新增 `db.gameDetail`（单款按 appid / 内部 id 直查，字段与列表一致），两条详情路由改用它；
  不再受 limit、排序与「必须有日价格」的限制

### 测试

- `api.test.js` 新增：不在列表里的游戏（无报价）也能取详情、按内部 id 也能取

## [0.18.7] - 2026-10-27

游戏逻辑删除（回收站）与平台列。

### 新增

- **逻辑删除**：games.deleted / deleted_at；后台游戏列表每行新增「删除」按钮（二次确认），
  数据与报价全部保留，只是不再展示
- **回收站页面**：控制台新「回收站」页列出已删除游戏（含平台、报价数、删除时间），可一键恢复；
  接口 GET /api/admin/games/deleted
- **平台列**：后台游戏列表新增「平台」列（Steam/杉果/GOG/Humble… 多个则多个标签），
  并支持按平台筛选（GET /api/admin/games?platform=steam）
- 新接口：POST /api/games/:appid/deleted 与 POST /api/games/id/:id/deleted（管理员，{deleted:true|false}）

### 变更

- 前台列表与详情排除已删除游戏；后台列表默认排除（deleted=only 查回收站、include 两边都看）
- 增量同步不再同步已删除的游戏（sync steamall 选择条件加 not g.deleted）

### 测试

- api.test.js 新增：平台列下发、逻辑删除前后台排除、回收站可见、恢复后恢复展示、报价数据未真删

## [0.18.6] - 2026-10-27

控制台用户列表列错位修复。

### 修复

- 用户表行里多渲染了一个「Steam 绑定」单元格、表头却没有对应列，导致从「角色」开始整体右移一格
  （角色格显示「未绑定」、状态格显示 admin）。移除该单元格，列对齐恢复
- 角色改为中文展示（管理员 / 普通用户），表下补一行角色与状态说明，避免看不懂 admin/user

## [0.18.5] - 2026-10-27

无 Steam appid 的游戏（杉果等）也能标记不感兴趣/已拥有。

### 修复

- 上一版把「标记不感兴趣 / 标记已拥有」按钮限定为有 Steam appid 的游戏，
  导致杉果专属游戏详情里没有这两个按钮。现在补上按**内部 id** 的接口：
  `POST /api/games/id/:id/interest` 与 `POST /api/games/id/:id/owned`（管理员），详情弹窗自动选择用哪条
- `setOwned` 支持 `gameId`，与 `setInterest` 对齐

### 测试

- `api.test.js` 增加无 appid 游戏按内部 id 标记的断言（匿名 401 / 管理员落库）

## [0.18.4] - 2026-10-27

前台偏好双写（数据库 + 浏览器缓存）；「全部」过滤已拥有与不感兴趣。

### 新增

- **偏好随账号走**：`user_prefs` 新增 `tab` 列，页签 + 排序按用户保存；
  登录用户打开页面按数据库里的个人习惯加载（同时镜像到 `localStorage`），未登录按浏览器缓存加载；
  切换页签/排序时**同时写数据库与浏览器缓存**（写库失败不影响本地生效）
- `GET /api/me` 返回的 `prefs` 带 `tab`；`POST /api/prefs` 对非法值归一化
  （`tab` 只认 all/on/off/owned，`sort` 只认 discount/price/name）

### 变更

- **Docker 命名统一为 `steamdeals`**：compose 项目名、PostgreSQL 库名/用户、命名卷、源码镜像 tag、
  文档示例全部从 `gameprice` 切换；Docker Hub 镜像仍是 `s1065420329/steamdeals`
- **「全部」页签过滤掉「不感兴趣」与「已拥有」**（之前只隐藏已拥有）；
  已拥有只在「已拥有」里出现，不感兴趣只在「不感兴趣」里出现
- 旧 `hide_uninterested` 字段保留兼容：`tab=on` 时自动置 true

### 测试

- `api.test.js` 补充页签偏好落库、`/api/me` 回带、非法值归一化断言

## [0.18.3] - 2026-10-27

游戏详情弹窗布局调整（原来 320px 太窄，表头与内容被挤成竖排）。

### 变更

- 详情弹窗宽度改为 `min(860px, 94vw)`，最大高度 88vh 可滚动；窄屏下表格区域横向滚动
- 弹窗内表格不再折行（`white-space: nowrap`），列宽恢复正常；关闭按钮不参与压缩
- 头图限制最大宽度 520px 并居中，避免宽屏下图过高
- 前端简易后台弹窗同样放宽（`min(720px, 94vw)`）

## [0.18.2] - 2026-10-27

修复「标记不感兴趣/已拥有后，列表与页签不更新」。

### 修复

- 前台刷新签名漏了 `interested` / `owned`：标记请求已写入数据库，但 `load()` 比对签名认为"没变化"，
  不重渲染——于是切到「不感兴趣」页签看到的还是旧列表。签名补上这两个字段（及类型）后立即重绘
- 列表行新增「不感兴趣」标签（`已拥有` 原本就有），标记后当场可见，不用刷新页面
- 详情弹窗的标记按钮：失败时弹出错误提示（以前静默）；没有 Steam appid 的杉果游戏不再显示这两个按钮（避免点了 404）

### 说明

- `感兴趣 / 不感兴趣 / 已拥有` 是**全局标记**，存在 `games.interested` / `games.owned` 列，只有管理员可以改；
  `user_prefs` 只存每个用户自己的展示偏好（隐藏不感兴趣 / 只看折扣 / 排序），不是标记本身

## [0.18.1] - 2026-10-27

封面图本地缓存：下载一次后由本机磁盘直接提供，之后不再依赖 CDN / 代理（VPS 只用于采集数据）。

### 新增

- **图片本地缓存**（`src/images.js`）：`<IMG_DIR>/<appid>/<size>.jpg`，默认 `data/images`；
  `data` 是 compose 挂到宿主机的卷，重建容器不丢
- **`images pull` 命令**：批量补图（默认 `capsule_sm_120,header`，支持 `--limit/--sleep/--sizes`），
  只补「有价格数据」的游戏（列表/详情才用得到），已缓存齐全的自动跳过
- **`images stats`**：已缓存张数 / 覆盖游戏数 / 体积
- **调度器 `images` 任务**：默认每 4 小时补 200 款（`IMAGES_ENABLED` / `IMAGES_INTERVAL_MIN` /
  `IMAGES_LIMIT` / `IMAGES_SLEEP_MS` 可调）
- **`GET /api/admin/images`** 与控制台「数据统计 → 封面图缓存」：张数 / 覆盖 / 体积 / 目录
- `.gitignore` 忽略 `data/images/`

### 修复

- **`/img/steam/<appid>/<size>` 路由此前永远不可达**：非 `/api/` 路径会先被静态资源分支处理并 404，
  于是图片请求根本到不了图片路由——这是「前台只有名字没有图」的真正原因（与代理无关）。
  现在 `/img/` 与 `/api/` 一样先走路由，再回落到静态文件
- 图片路由改为「内存热缓存 → 本地磁盘 → 三条 CDN 兜底并落盘」；命中本地后不再出网，
  失败结果缓存 5 分钟避免拖满超时

### 测试

- 新增 `images.test.js` 4 项：路径安全（appid 只留数字 / size 白名单）、读写与统计、
  下载落盘（注入 fetchBuffer，全失败不落盘）、`/img` 路由命中本地文件时不再触网

## [0.18.0] - 2026-10-27

Docker Hub 零配置部署：业务配置落库 + 首次 `/setup` 初始化 + 控制台系统设置 + 调度器热加载。

### 新增

- **设置存储**：`app_settings`（jsonb + 密钥密文）与 `app_meta`（初始化状态 / settings.revision）；
  50 项业务设置集中定义在 `src/settings.js`，SMTP 继续复用 `smtp_settings`
- **首次初始化 `/setup`**：创建第一个管理员 + 写业务设置 + 标记完成，全部在一个事务里；
  完成前页面 302 到 `/setup`、业务 API 返回 428，健康检查不受影响
- **`SETUP_TOKEN`**：可选初始化口令，防止公网被抢先初始化
- **控制台「系统设置」页**：按服务端 schema 渲染分组表单；密钥只显示「已配置」，留空保持、可显式清除
- **`GET/POST /api/admin/settings`**：管理员读写设置，保存后递增 revision
- **调度器热加载**：初始化完成前等待，不采集；轮询 revision，设置变更后重新水合 env 并重建任务表
- **Docker Hub**：`compose.hub.yaml`（自带 PostgreSQL、命名卷、零 `.env`）与
  `compose.hub.external-db.yaml`（已有库，连接串写在 compose 命令里）
- **发布工作流**：GitHub Actions 多架构构建 `linux/amd64,linux/arm64`，测试 + 容器冒烟 + 推送 `s1065420329/steamdeals`
- **文档**：`docs/DOCKER-HUB.md`，README/DEPLOY/QUICKSTART/WEB 同步更新

### 变更

- CLI 启动时自动水合数据库设置；老部署（已有管理员）自动导入旧 `.env` 并标记初始化完成
- `all` 模式入口先 bootstrap 再启动，保证首次部署导入种子游戏
- 容器默认使用命名卷，不再需要 `mkdir` / `chown`；`.dockerignore` 排除 `data/secret.key`、测试数据库与备份
- `.env.example` 缩减为部署参数；业务配置不再需要改 `.env`

### 测试

- 新增 `settings.test.js`（默认值/密钥加密/env 导入/水合/事务）与 `setup.test.js`（拦截、初始化、口令、老库迁移）
- `deploy.test.js` 增加 Hub compose、外部库 compose、发布工作流、`.dockerignore` 守卫

## [0.17.7] - 2026-10-27

Steam 登录整体移到后台，前台只展示优惠数据。

### 变更

- **前台移除 Steam 页签与登录入口**：去掉「Steam」tab、Steam 面板、登录弹窗里的「用 Steam 账号登录」按钮及相关脚本；
  本地偏好里残留的 `steam` 页签自动回落到「全部」
- **控制台新增「Steam 账号」页**（仅后台）：OpenID 登录 / 退出、游戏库同步（时长、最低价、未入库标记）、
  单款点击打开 Steam 商店页；原有 `/api/steam/*` 接口不变
- 前台功能收敛为：游戏优惠列表、筛选排序、搜索、详情价格曲线、各平台报价

### 测试

- `deploy.test.js` 新增守卫：前台不得出现 Steam 登录入口/面板/页签，控制台必须有登录与同步入口

## [0.17.6] - 2026-10-27

后台同步体验：不跳页、按钮禁用、实时输出、同步记录；前台分页吸底。

### 新增

- **同步记录**（`sync_runs` 表 + 控制台「同步记录」表）：每次手动同步的任务号、模式、状态、耗时、
  退出码与输出尾巴；服务重启残留的 running 记录启动时自动标失败
- **同步实时输出**：`GET /api/admin/sync/status` 返回运行状态与输出；控制台在同步卡片内滚动显示
- **`GET /api/admin/sync/runs`**：同步历史列表（管理员）
- 同一时间只允许一个同步：运行中再点返回 409（前端按钮同时禁用，结束自动恢复）

### 变更

- 点「增量同步」不再跳转到「日志」页，只提示任务号并原地显示进度；成功/失败后按钮自动恢复
- `sync steamall` 取到 0 条时打印排查指引（`diagnose` 的 `net:steam` 一行）
- 前台分页条改**吸底常驻**（`position:sticky`），长列表滚动时始终可见

### 测试

- 新增 `test/sync-runs.test.js` 2 项；全套 26 个文件 216 项全绿

## [0.17.5] - 2026-10-27

封面图链路诊断细化。

### 变更

- `/img/steam` 兜底路径去重：三条互不重复的路（Cloudflare 代理 → Akamai 直连 → Cloudflare 强制直连）
- `diagnose` 图片探测拆成三行 `net:img:cf-proxy` / `net:img:ak-direct` / `net:img:cf-direct`，
  与图片路由逐条对应；`fetchText` 新增 `forceDirect`（跳过代理决策）

## [0.17.4] - 2026-10-27

Steam 封面图多路兜底（线上图片 404 的修复）。

### 修复

- `/img/steam/<appid>/<size>` 原来只走 Cloudflare CDN 且必须经代理，代理不通就 404。
  现在按 **Cloudflare(代理) → Akamai(直连) → Cloudflare(直连) → Akamai(代理)** 依次兜底，
  每条路 8 秒超时；成功过的路按 appid 记忆复用，失败也缓存 5 分钟避免每次拖满超时
- 图片失败日志从 debug 提到 **warn**（`steam.img_miss` 带失败原因），INFO 级别日志也能看到为什么没图
- `fetchBuffer` 新增 `forceDirect` 参数（跳过代理决策）

### 变更

- `diagnose` 新增两条封面图链路探测：`net:img:cloudflare` / `net:img:akamai`，
  图片打不开时跑 `docker compose exec app node src/cli.js diagnose` 一眼定位是哪条路不通

## [0.17.3] - 2026-10-27

游戏类型（游戏 / DLC）在前台体现；开发商/发行商同步补强。

### 新增

- 前台列表：DLC / 试玩 / 音乐等非游戏类型显示**类型徽标**（`app_type` 由 `gameOverview` 下发）；
  游戏详情弹窗 facts 首项显示「类型」，控制台游戏列表新增「类型」列
- 同步日志输出 DLC 数量（`sync.steamall.done` 带 `dlc` 计数）

### 修复 / 变更

- **类型大小写统一**：官方接口（`dlc`）与 steamcmd 镜像（`DLC`）的 `type` 全部归一化成小写入库
  （新增 `normalizeType`；`upsertGameMeta` 防御性再归一，老库大小写混用的数据随下次同步自动纠正，
  前端按小写匹配，旧数据也能立即正确显示）
- 开发商 / 发行商：此前已在同步链路中提取落库（两个后端都抓 `developers` / `publishers`），
  本次补上入库断言与 DLC 落库测试，保证不再回退

### 测试

- `steam-meta.test.js` 新增类型归一化用例；`gamemeta.test.js` 新增开发商/发行商/DLC 落库用例（共 214 项全绿）

## [0.17.2] - 2026-10-27

验证码邮件内容落库，用户收不到邮件时管理员可直接提供验证码。

### 新增

- `email_codes` 表新增 `subject` / `body` 列：登录、重置密码、绑邮箱、SMTP 测试四类邮件的
  主题与正文在**发送前**就落库（发送失败也能查到内容）
- 控制台「验证码发送记录」新增「查看」按钮：弹窗展示邮件主题/正文 + 元信息（收件人、用途、过期时间、是否已使用），
  「复制验证码」一键复制正文里的 6 位码
- `GET /api/admin/emails` 返回 `subject` / `body` / `expires_at` / `used_at`

### 变更

- 每日备份任务顺带清理 3 天前的邮件记录（正文含明文验证码，不留存太久）

### 测试

- `test/email-auth.test.js` 新增 2 项：schema 含 subject/body 列；假 SMTP 端到端
  （发码 → 正文验证码可哈希校验 → 管理员接口可读 → 过期清理），共 8 项

## [0.17.1] - 2026-10-27

前台实时刷新提速 + 真实游戏数量 + 详情弹窗头图。

### 新增

- **`GET /api/games/count`**（匿名可读）：返回库内游戏总数与"已有价格"的游戏数。
  列表接口最多 500 条，此前后台游戏超过 500 款时前台数量永远停在 500，看起来像"没更新"
- **详情弹窗 Steam 头图**：打开游戏详情时顶部显示 `/img/steam/<appid>/header`（加载失败自动隐藏）

### 变更

- 前台实时刷新从 60 秒加快到 **10 秒**；页面从后台切回可见时立即刷新一次；
  Steam 页签也随每次轮询刷新（游戏库/时长同步后不用手动刷新）
- 前台顶部元信息改为「库内 N 款 · 有价格 N 款 · 更新于 HH:mm:ss（自动刷新）」

## [0.17.0] - 2026-10-27

访问者记录与 IP 黑名单；控制台游戏管理页重构。

### 新增

- **访问记录**：每次页面/API 请求落库 `visitor_logs`（IP + 归属地 + 路径 + 状态码），
  静态资源不记；IP 归属地异步解析（ip-api.com → ipwho.is 兜底，24h 内存缓存，内网地址不查）
- **后台「访问记录」页**：今日访问/独立 IP/黑名单数汇总、近 24h 高频 IP、分页记录（可按 IP/路径过滤）
- **IP 黑名单**：后台增删（支持单个 IP 与 IPv4 CIDR），命中即整站 403（server 层拦截、常驻内存零查询），
  管理员会话自动放行避免自我锁死
- **游戏管理页重构**：删除「愿望单导入」卡片与「单个游戏编辑」区块；
  列表「编辑」改为弹窗（说明/禁用）；「同步 Steam」卡片置顶

### 修复

- `src/steam-login.js` 误用 `../http.js` 导入：Steam 登录及所有位于其后的后台路由全部 500（`70cab61` 引入）
- 全新库上 `/api/admin/users` 报 `column "email" does not exist`：users 表的 email/steam_id 列补进迁移
- `deploy.test.js` 的 shebang 断言跟随入口脚本改为 `#!/bin/bash`

### 测试

- `test/visitors.test.js` 5 项（IP/CIDR 校验与匹配、记录落库与过滤、黑名单拦截与管理员放行、权限隔离）并纳入 `npm test`

## [0.16.0] - 2026-10-26

前后端分离落地：有了真正的 Web 前端与用户系统。

### 新增

- **`web/` 前端工程**（零构建单页）：列表 + 筛选（全部/感兴趣/不感兴趣/已拥有）+ 排序（折扣/价格/名称）
- **游戏详情弹窗**：客户端 SVG 价格曲线、各平台报价、开发商/发行商/分类
- **后台管理页**（仅管理员）：用户列表、浏览排行；可直接标记感兴趣/已拥有
- **访客本地偏好**：未登录也能筛选排序，选择存 `localStorage`，不上传服务端
- **`user` 命令**：`user add <名> [--admin]`，密码只显示一次；`user list`
- **`backup` 命令**：8 张核心表导出 gzip JSON 到 `data/backup`，保留最近 7 份
- **浏览记录 90 天清理**（随备份任务执行）
- **[docs/WEB.md](docs/WEB.md)**：API 契约、权限矩阵、部署要点

### 修复

- `serve` 启动报 `startApiServer is not defined`（导入缺失），全栈服务无法启动
- Steam `appdetails` 批量请求返回 400：改为逐个 appid 请求，并顺带取分类与价格字段
- 元数据曾覆盖人工维护的游戏名：改为只补空缺

### 变更

- 仓库更名 `gameprice` → **`steamdeals`**（旧地址 301 重定向）
- `discover`（杉果目录发现）默认关闭：以 Steam 为准，只在需要补 SKU 映射时手动开启
- 调度器新增每日 `backup` 任务（`BACKUP_ENABLED=0` 可关）

### 测试

- `test/api.test.js` 5 项（匿名可读、权限隔离、登录登出、密码哈希、已拥有）
- 调度器测试更新为 8 个任务


## [0.15.0] - 2026-10-26

用户系统与只读 API。

### 新增

- `users` / `sessions` / `user_prefs` / `page_views` 四张表，migrate 幂等创建
- scrypt 加盐哈希 + httpOnly cookie 会话（7 天）
- API：`/api/games`、`/api/games/:appid`、`/api/login`、`/api/logout`、`/api/me`、`/api/prefs`、`/api/admin/*`
- 权限隔离：匿名只读，写操作需登录/管理员；**Web 层没有任何改价接口**

## [0.14.0] - 2026-10-26

不用 nginx，直接 `IP:端口` 看页面。

### 新增

- **内置静态页服务** `serve`（`src/serve.js`，零依赖，用 node:http）
  - compose 新增 `web` 服务，复用同一个镜像，默认对外 **8090**（避开已被占用的 80）
  - `WEB_PORT` 可改端口，`OUT_DIR` 决定服务哪个目录
  - 安全边界：只读 `OUT_DIR` 之内（路径穿越 403）、只允许 GET/HEAD（其余 405）、
    HTML 不缓存（页面上是价格）、`x-content-type-options: nosniff`
- `serve --port/--dir/--host`，`--port 0` 时由系统分配

### 说明

宿主机上常有 nginx 占着 80，且用户只想"IP+端口直接访问"。为此不引 nginx、不加反代，
而是把静态服务做进应用：少一个组件就少一处故障点。想挂到已有 nginx 也可以，
把 `OUT_DIR` 设成 `data/out`，nginx 直接指过去（教程里有配置）。

### 验证

- `test/serve.test.js` 5 项：路径穿越（含 URL 编码 `../` 与空字节）、内容类型、GET/HEAD/405
- 真实运行：对着 48 款游戏的生成目录起服务，
  `GET /` 200（14KB）、`GET /game-105600.html` 200、`GET /nope` 404、`HEAD /` 只有头
- 部署测试新增断言：web 服务复用镜像、端口 `${WEB_PORT:-8090}:8080`、不含 nginx
- 合计 195 项

## [0.13.0] - 2026-10-26

修掉两个会让首次部署直接失败的坑（是我之前的"零配置"说法不够准确）。

### 修复

- **`docker compose up` 不会启动数据库**：`db` 服务原来挂在 `profiles: ["bundled"]` 下，
  而没有 `.env` 时 `COMPOSE_PROFILES` 为空 → db 不启动 → app 连 `db:5432` 被拒、无限重启。
  现在 db 默认随 `up` 启动；用外部数据库时执行 `docker compose up -d app` 只起 app。
- **宿主机挂载目录权限**：容器以 `node`(uid 1000) 运行，`./data`、`./logs` 属主是 root 时
  写日志 `EACCES`，报错藏在启动日志深处。现在入口脚本启动前检查可写性，
  直接打印修复命令（`sudo chown -R 1000:1000 ./data ./logs`）并以 2 退出。

### 新增

- **[docs/QUICKSTART.md](docs/QUICKSTART.md)**：云服务器从零部署教程——装 Docker、权限、
  验收四命令、提醒通道配置、静态页托管（`OUT_DIR=data/out` + nginx）、网络方案、日常运维、
  故障速查表
- 部署测试新增断言：db 不得依赖 profile 才启动；入口脚本必须检查挂载目录可写

### 验证

- `test/deploy.test.js` 10 项、`test/docs.test.js` 5 项（含新文档的链接检查）全绿
- `bash -n scripts/docker-entrypoint.sh` 通过；`compose.yaml` YAML 解析通过
- **本机没有 Docker，镜像仍未经真实构建**：以上是结构与语法验证

## [0.12.0] - 2026-10-26

国内服务器访问 Steam 的问题，有了可配的出口。

### 新增

- **按主机分流的出网代理**（`src/proxy.js` + `src/http.js`）
  - `STEAM_PROXY`：只作用于 Steam 域名（store/api/community）
  - `HTTPS_PROXY`：通用代理，受 `NO_PROXY` 排除
  - 境内源（杉果）和可达源（GOG/Humble）保持直连——全走代理既慢又浪费流量
  - 支持 `http(s)://`（undici `ProxyAgent`），**不支持 socks5**；代理密码在日志与 `diagnose` 中脱敏
  - 每个请求日志带 `via=direct|proxy|steam-proxy`，失败信息也带上走了哪条路
- `diagnose` 增加 `proxy:steam` / `proxy:others` 两行，部署后第一眼就能确认出口配置
- `scripts/local-proxy.js`：零依赖的最小代理（HTTP absolute-form + HTTPS CONNECT），
  用来验证"请求确实被转发了"而无需第三方工具

### 验证

- `test/proxy.test.js` 10 项：决策矩阵、NO_PROXY 匹配、密码脱敏、**本地起代理真实转发**
- 真实 HTTPS 验证：`HTTPS_PROXY=http://127.0.0.1:8899` 下，`import steam` 成功且日志 `via=proxy`，
  代理端记录 `CONNECT api.steamcmd.net:443`；`STEAM_PROXY` 下 Steam 请求记录
  `CONNECT store.steampowered.com:443` 并报 `经 steam-proxy`
- 合计 184 项

## [0.11.0] - 2026-10-26

游戏信息不用手填了。

### 新增

- **Steam 游戏信息导入** `import steam`
  - 支持 `--appids 730,570`、`--urls <商店链接>`、`--file <清单>`（每行一个 appid 或链接）
  - 写入中文名、英文名、类型、封面、发行日期、开发商/发行商
  - **双后端自动回落**：先探官方 `appdetails`（5s 超时），不通则用 `api.steamcmd.net`
    （Steam PICS 数据镜像，实测本机可达），实际用的后端记进 `steam.meta.done`
  - `--backend auto|official|steamcmd` 可强制指定
- 实测：6 个 appid 全部导入成功，中文名与封面齐全

### 修复

- **元数据把人工维护的名字改坏了**：730 的 `sc_schinese` 还是旧的「反恐精英：全球攻势」，
  第一版"元数据覆盖"策略把它盖掉了「反恐精英 2」。现在名字**只补空缺不覆盖**
  （`coalesce(games.name, excluded.name)`）；`is_free` 用 null 判断，镜像给不了时不会误改成 false。

### 已知

- 镜像**不提供 `is_free`**，也**不能按名字搜索**（只能给 appid 或商店链接）。
  官方接口可达时这两个限制都不存在。

### 测试

- 新增 `test/steam-meta.test.js` 11 项、`test/gamemeta.test.js` 5 项
- 合计 174 项

## [0.10.0] - 2026-10-26

采集完自动刷新页面，不用再手动跑 `chart`。

### 新增

- **曲线页自动重建**：调度器在采集类任务成功后自动执行 `chart`
  - 触发条件：任务是 steam/sonkwo/itad/gog/humble/discover 且退出码为 0
  - `CHART_ON_SYNC=0` 可关闭（例如页面由 CI 构建）
  - `OUT_DIR` 可配置输出目录
  - 重建失败只记 `scheduler.job_failed`（job 名 `sonkwo:chart`），不影响主任务状态
- 实测：46 个杉果 SKU 同步完成（65.5s，41 条新快照）→ 自动重建 48 款游戏、49 个文件、337ms

### 测试

- 调度测试新增 1 项：成功触发 / 失败不触发 / 非采集任务不触发 / 可关闭
- 合计 158 项

## [0.9.0] - 2026-10-26

`region` 终于不只是数据库里的一个字段。

### 新增

- **多区服采集**：GOG 支持按国家/币种查询，`sync gog --regions cn,us`（或 `GOG_REGIONS`）
  - 显式区服映射表（cn/hk/tw/us/jp/ru/tr/ar → 国家 + 币种），未知区服直接报错
  - 实测：泰拉瑞亚 cn ¥36.00 / us $9.99，星露谷 cn ¥48.00 / us $14.99
- **多区服对比** `compare <appid>`
  - 按区服分组、组内按价格排序、标出"该区最低"
  - **不同币种不做汇率折算**，只并排展示并明确提示不可直接比较
  - `--region cn` 只看单区、`--json` 输出机器可读结构
- 存储层 `regionOffers()`：跨区查询，同样只统计官方/授权渠道

### 设计说明

不做汇率折算的理由：折算需要实时汇率，硬编码会把比较做**错**；用户真正关心的是
"这个区多少钱"，而不是"折成人民币多少"（后者还涉及支付方式能否落地）。所以只在
**同币种内**比数字。

### 测试

- `test/compare.test.js` 7 项、`test/regions.test.js` 4 项、gog 区服 2 项
- 合计 157 项

## [0.8.0] - 2026-10-26

把"46 条孤立价格"和"Steam 游戏"接上的那一环。

### 新增

- **跨平台名称匹配** `match`
  - 归一化：去版本词（标准版/豪华版/Deluxe/Ultimate/GOTY…）、去平台标注、全角转半角、去标点
  - 相似度用**字符 bigram 的 Dice 系数**（中文无词边界，比编辑距离稳），并对"包含关系"给部分分
  - 标题拆成中/英多个写法分别比较（杉果标题常是「中文名 版本（Steam） English Name」）
  - 阈值分级：≥0.94 自动应用、0.86–0.94 待人工 `--confirm`、<0.86 无候选
  - `--apply` 写入 `data/skus.json`；`--confirm <skuId> <appid>` 手工确认
- **重复游戏行合并** `mergeGames()`
  - 确认 appid 后，把早期按名称建出的孤立行并进 Steam 游戏行：
    报价（快照跟随 offer_id）、日聚合（同键取 LEAST）、别名、关注列表，最后删源行
  - 同平台同渠道类型的重复报价保留目标行，源行快照一并清理

### 修复（都是真实数据暴露的）

- **`™` 被 NFKC 展开成 "TM"**：`ELDEN RING™` 归一化成 `elden ringtm`，匹配不到。
  改为先去商标符号再 normalize。
- **中文片段把数字删了**：早期用"删掉所有 ASCII 取中文"，`全境封锁2` 变成 `全境封锁`。
  改为"必须以汉字开头、允许后接数字"的匹配。
- **纯数字被当成中文变体**：`Cyberpunk 2077` 生成变体 `2077`，与中文标题里的 `2077`
  得到 0.6 的假高分。中文片段现在要求以汉字开头。

### 测试

- `test/match.test.js` 11 项、`test/merge.test.js` 5 项（真 PG 语义）
- 合计 144 项

### 已知

- 真实运行 `match` 对 46 个杉果 SKU 返回 0 提案——它们与现有 24 款 Steam 游戏没有交集。
  这是数据覆盖问题，扩大游戏库后即可work。

## [0.7.0] - 2026-10-26

杉果不用再手工加 SKU 了。

### 新增

- **杉果 SKU 自动发现** `discover sonkwo`
  - 杉果没有搜索接口（loader 服务端报错、`/api/*` 已下线 410），改为**按 sku id 顺序探测**：
    id 连续、密度约 70%，未上架/已下架的 id 返回 200 的空壳页（无价格），用解析结果区分
  - 策略：从前沿（已知最大 id）向后扫，**连续 N 个空壳即停**，通常十几到几十次请求
  - 发现的 SKU（含名称）自动并入 `data/skus.json`，已有 `appid` 映射与名称不会被覆盖
  - 扫描水位记录在 `data/sonkwo-discovery.json`（已 gitignore）
  - 调度器新增 `discover` 任务（默认 12 小时一次）
- 实测：扫 120 个 id 命中 46 个商品（111442–111491 密集区，111492 后为空壳），新增 45 条

### 修复

- **空壳页被记成 ERROR**：批量发现时 74 个空壳页产生 74 条 `adapter.sonkwo.no_price` 错误日志，
  会污染 `error-*.jsonl`。现在能区分"这个 id 没有商品"（`adapter.sonkwo.not_a_product`，debug 级）
  与"商品页解析不出价格"（仍是 error 级）。

### 工具

- `scripts/probe-skus.js`：按区间抽样统计 SKU 密度，用于设计扫描窗口；
  判定标准与适配器一致（能解析出报价才算商品）

### 测试

- 新增 `test/discover.test.js` 9 项：区间计算、连续空壳停止、404/异常容错、合并去重
- sonkwo 测试补空壳识别 2 项
- 合计 128 项

## [0.6.0] - 2026-10-26

真正做到一键部署、零配置开箱即用。

### 新增

- **自动建库**：`ensureDatabase()` 在连接前检查目标库，不存在就连维护库 `/postgres` 执行
  `CREATE DATABASE`（标识符转义、支持 URL 编码的中文库名）。无建库权限时只记 `db.autocreate_failed`
  并继续，让后续真实连接报出更明确的错误。
- **compose 零配置**：去掉必填的 `POSTGRES_PASSWORD`，内置库改用 `trust` 认证且**不发布端口**；
  `docker compose up -d --build` 三条命令即可，不需要 `.env`、不需要先建库建表。
- **CLI 自动降级**：没有 `DATABASE_URL` 也没有 `--db` 时，自动使用嵌入式 PG（`data/pgdata`），
  本地试验零前置。

### 测试

- 新增 `test/store.test.js` 10 项，其中最后一项用 **PGlite + PGLiteSocketServer 起真 TCP Postgres**，
  实测 `CREATE DATABASE` 成功、重复调用变为 `exists`、并在 `pg_database` 里查到新库。
- 部署测试新增断言：compose 默认免密启动、数据库端口不对外、`DATABASE_URL` 与 trust 匹配。
- 合计 117 项。

## [0.5.0] - 2026-10-26

提醒终于能推到手上了。

### 新增

- **三种提醒通道**（`src/notify.js`），可同时配置
  - 通用 webhook（原有）
  - 企业微信群机器人：`errcode=0` 才算成功，HTTP 200 但 errcode 非 0 会判失败
  - 邮件：自实现 SMTP 客户端，支持隐式 TLS(465) 与 STARTTLS(587)、AUTH PLAIN / LOGIN
- **`notify-test` 命令**：给所有已配置通道发一条测试消息，部署时先跑这个
- `alerts` 输出每个通道的投递结果（✔/✘ + 状态码）；任一通道成功才标记已通知
- `channelsFromEnv()` / `hasNotifier()`：通道完全由环境变量决定，调度器据此决定是否传 `--mark`

### 实现说明

- 邮件没有引入 nodemailer：运行时依赖仍只有 `pg`，且协议对话可在本地假 SMTP 服务器上逐行断言
- 中文主题按 RFC 2047（`=?UTF-8?B?...?=`）编码，正文 base64 + 76 字符折行，避免客户端乱码
- 通道失败只记日志不抛异常：一个通道挂了不能影响其它通道和整轮任务

### 测试

- 新增 `test/notify.test.js` 10 项，其中 SMTP 全流程用 `net.createServer` 起假服务器，
  断言 `EHLO → AUTH PLAIN(base64 校验) → MAIL/RCPT → DATA → QUIT` 与收到的 MIME 内容
- 合计 106 项

## [0.4.0] - 2026-10-26

数据源从 1 个变成 3 个。

### 新增

- **GOG 适配器**（`sync gog`）
  - 用官方商店前端的 catalog 接口，直接拿 CNY 价格，无需解析页面
  - 实测 24 款中匹配 8 款（泰拉瑞亚 ¥36、星露谷 ¥48、空洞骑士 ¥58、茶杯头 ¥68、死亡细胞 ¥40、赛博朋克 ¥89、博德之门 3 ¥298、冰汽时代 ¥16）
  - **只接受标题归一化后完全相等的产品**：GOG 的 `like:` 是模糊搜索，GOG 不卖的游戏会返回无关热门商品，宁可判空也不能张冠李戴
- **Humble 适配器**（`sync humble`）
  - 搜索接口被 Cloudflare 挡（403），改为按英文名生成 slug 探测商品页，解析 schema.org JSON-LD 的 `offers.price`
  - 名称必须完全一致才接受；404 与"重定向到商店首页"都按"这家店没有"处理
- **英文名支持**：`data/games.json` 增加 `nameEn`，`seed` 写入 `games.name_en`（GOG/Humble 只能按英文检索）
- 调度器新增 `gog` / `humble` 任务（默认 12 小时一次）
- 报价可携带 `steamAppid`，按名检索的源据此并入已有游戏行而不是新建

### 修复

- **GOG 折扣算错**：`price.finalMoney.discount` 是"省了多少钱"（如 209），不是百分比；改为由 final/base 自行计算，`-70%` 才不会被显示成 `209%`
- **Humble 把"不存在"当成"页面结构变了"**：商品不存在时会被 302 到商店首页并返回 200（700KB 无 JSON-LD），现在检查最终 URL 判定为 `redirected`
- **GOG 报价没有带上 steamAppid**，导致 8 款游戏被建成英文名的新行（实测 `noAppId=8`）；修复后 `noAppId=0`、游戏总数不变

### 未接入

- **Fanatical**：商品页是 SPA（HTML 里没有价格），数据走 Algolia 代理，而 `/algolia/key` 被 Cloudflare 返回 403。没有可靠取数路径，暂不实现，避免用错误数据充数。

## [0.3.0] - 2026-10-26

从"能看"到"会叫你"。

### 新增

- **关注列表**（`watchlist` 表，第 8 张表）
  - `watch add <appid> --target 99`：到目标价提醒
  - `watch add <appid>`：不带目标价时，跌到史低才提醒
  - `watch rm` / `watch list`
- **降价提醒** `alerts`
  - 两种触发语义：目标价优先，未设目标时看是否破史低
  - **按价格去重**：同价位不重复打扰，更便宜才再通知（不用时间窗口）
  - `--json` 输出机器可读载荷、`--mark` 记录已通知、`--webhook URL` 投递
  - 没配 webhook 时**不标记**已通知，避免静默吞掉提醒；投递失败不标记、下轮重试
- **采集熔断**
  - 同一任务连续失败 `CIRCUIT_THRESHOLD`（默认 3）次后暂停 `CIRCUIT_COOLDOWN_MIN`（默认 360）分钟
  - 熔断期间只记 `scheduler.circuit_skip`，不再请求目标站；成功一次即复位
- **老库自动迁移**：命令执行前检查 `to_regclass`，缺表自动补 DDL，不需要记住先跑 `init`
- 调度器新增 `alerts` 任务（默认 6 小时一次）；`ALERT_WEBHOOK_URL` 存在时才传 `--mark`

### 修复

- 演示数据里多平台报价被归到同一平台的问题，现在会记 `ingest.platform_mismatch`（上个版本的行为修复，本次补测试）

## [0.2.0] - 2026-10-26

价格历史终于能"看"了。

### 新增

- **静态价格页** `node src/cli.js chart`
  - 列表页：每款游戏当前最低价、原价、折扣、史低、迷你看板
  - 详情页：90 天价格曲线 + 当前最低 / 历史最低 / 区间均价 / 区间最高 + 各平台报价表
  - 纯静态：内联 SVG，无外部 JS/CSS/字体，离线可打开；单页约 7KB
  - 所有外部文本（游戏名、平台名）转义
- **演示数据脚本** `scripts/demo-seed.js`：造 3 款游戏 90 天曲线，用于本地看效果或截图
- 存储层新增查询：`gameOverview` / `dailyMinSeries` / `dailyPlatformSeries` / `offersOfGame`

### 修复

- **多平台报价会被归到错误的平台**：`ingestOffers` 用批次的 `platform` 作为默认值，若一个批次里混了多个平台而 offer 未自带 `platform` 字段，后来的报价会被静默记到第一个平台名下（演示数据里"杉果 ¥118"被显示成"Steam 国区"）。现在会记 `ingest.platform_mismatch` 告警，演示脚本也改为逐条携带 platform。
- **Y 轴刻度不可读**：原实现按数据范围 ±8% 均分，出现 ¥83 / ¥141 这类标签；改为 1/2/5 × 10ⁿ 步长对齐。

## [0.1.0] - 2026-10-26

首个可用版本：从零到"能自动采集、能查历史、能远程排障、能一键部署"。

### 新增

- **采集适配器**
  - Steam 国区：官方 `appdetails`，支持逗号分隔批量、限速、失败重试
  - 杉果：解析商品页内嵌 `window.__remixContext` 结构化 JSON，DOM 仅作兜底
  - IsThereAnyDeal：官方 REST API（`/games/search/v1`、`/games/prices/v3`），按商店拆成独立平台
- **存储（PostgreSQL 15）**
  - 六张表 + 一个主榜视图：`games` / `game_aliases` / `offers` / `price_snapshots` / `daily_prices` / `fetch_runs` / `v_lowest_official`
  - "只收官方渠道"做成视图约束，C2C 无法进入主榜
  - 快照按内容指纹判重，价格不变不写入
- **调度**
  - 常驻调度器，三个任务各自独立子进程，崩溃不影响其它任务
  - 首轮触发错开（30s / 180s / 300s），避免启动瞬间打满
- **日志**
  - JSONL 结构化日志，`runId` 串联一次命令的全部事件
  - 请求级埋点：`http.request/response/retry/error/fail`，带 `requestId`
  - 密钥自动脱敏，连接串只抹密码
  - 按大小轮转（8MB / 保留 10 份），错误额外落一份 `error-*.jsonl`
  - `logs` 命令支持按级别 / 事件 / runId / 时间过滤
- **运维**
  - `diagnose`：环境、数据库、网络逐项自检并落盘报告
  - `ping`：健康检查命令
  - `bootstrap`：容器启动时建表 + 首次导入，幂等
- **部署**
  - Dockerfile：非 root、tini、`npm ci --omit=dev`、healthcheck
  - compose：内置 postgres:15（可选 profile），支持外部库
  - `.gitattributes` 锁定 LF，避免 CRLF 破坏容器入口脚本
- **文档**
  - README：定位、边界、架构、命令、配置、限制
  - `docs/ARCHITECTURE.md`：设计取舍、失败模型、扩展新平台指南
  - `docs/DATA-SOURCES.md`：四个数据源的可达性实测与勘查方法
  - `docs/DEPLOY.md`：两种部署方式、运维命令、故障排查表

### 修复

开发期由测试抓到的三个会产生**错误数据**的缺陷：

- **杉果取错版本价格**：页面顶部先渲染"荣光痴人版 ¥269"，本 SKU 实际 ¥198。原实现取第一个价格，现改为按 `sku_id` 精确匹配 JSON，DOM 兜底只认"购买区"块。
- **DATE 被解析成带时区的 `Date`**：跨时区会差一天，导致日聚合把一天拆成两天、史低判断偏移。改为 identity parser + SQL `::text`。
- **错误日志被读两遍**：error 同时写入 `app-*.jsonl` 与 `error-*.jsonl`，`readLogs` 不区分来源导致重复计数。

### 已知问题

- Steam 官方接口在国内网络直连不可达（`UND_ERR_CONNECT_TIMEOUT`），需出口或改走 ITAD。
- 杉果无可用搜索接口，SKU 需人工维护（`data/skus.json`）。
- ITAD 响应结构按官方文档实现，尚未用真实 key 验证。
- 无失败熔断：某源持续 403 时仍需人工关闭。
- 无前端界面，当前只有 CLI。

