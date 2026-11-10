# SteamDeals · 以 Steam 为准的跨平台游戏比价

**中文游戏的价格履历。**

把 Steam 国区、杉果、以及 IsThereAnyDeal 聚合的海外授权店放在同一张表里比价，并把每一次价格变动都存下来，形成可以回看的曲线。

![node](https://img.shields.io/badge/node-%E2%89%A522.5-3c873a)
![postgresql](https://img.shields.io/badge/PostgreSQL-15-336791)
![docker](https://img.shields.io/badge/docker-compose-2496ed)
![license](https://img.shields.io/badge/license-MIT-lightgrey)

---

## 目录

- [现在的真实状态](#现在的真实状态)
- [它解决什么](#它解决什么)
- [它明确不做什么](#它明确不做什么)
- [功能](#功能)
- [设计原则](#设计原则)
- [架构](#架构)
- [项目总览文档](docs/PROJECT-OVERVIEW.md)
- [开发到交付全流程](docs/DELIVERY.md)
- [快速开始](#快速开始)
- [命令参考](#命令参考)
- [配置](#配置)
- [数据模型](#数据模型)
- [数据源](#数据源)
- [日志与排障](#日志与排障)
- [测试](#测试)
- [已知限制](#已知限制)
- [路线图](#路线图)
- [项目结构](#项目结构)
- [许可与免责](#许可与免责)

---

## 现在的真实状态

一句话：**开箱即用的有杉果和 GOG；Steam 需要出口、ITAD 需要 key、Humble 命中率有限。**

| 能力 | 状态 | 依据 |
|---|---|---|
| 杉果价格采集 | ✅ 已跑通 | 真实页面端到端验证：解析 ¥198 → 入库 → 写快照 |
| **杉果 SKU 自动发现** | ✅ 已跑通 | 实测扫 120 个 id 命中 46 个商品、新增 45 条，连续空壳自动停 |
| **跨平台名称匹配** | ✅ 已跑通 | bigram Dice + 阈值分级 + 人工确认；重复行自动合并（11+5 项测试） |
| **多区服采集** | ✅ 已跑通 | GOG 真实双区采集（cn ¥36 / us $9.99）；不同币种不折算，明确告知 |
| **Steam 游戏信息导入** | ✅ 已跑通 | 双后端（官方 / steamcmd 镜像）自动回落；实测 6 个 appid 全部拿到中文名与封面 |
| **曲线页自动重建** | ✅ 已跑通 | 调度器采集成功后自动跑 `chart`；实测 46 SKU 同步 → 48 款游戏 49 个文件 337ms |
| **GOG 价格采集** | ✅ 已跑通 | catalog 接口真实运行：24 款匹配 8 款，中文名合并正确 |
| **Humble 价格采集** | ⚠️ 可用但命中率受限 | 按 slug 探测 + JSON-LD 校验；没探测到的游戏会静默跳过 |
| 价格历史 / 史低判断 | ✅ 已跑通 | 96 项测试，含真 PG 语义（PGlite）验证 |
| **价格曲线网页** | ✅ 已跑通 | `node src/cli.js chart` 生成静态页，内联 SVG，浏览器直接打开 |
| 只收官方渠道的结构约束 | ✅ 已生效 | 视图 + 查询层双重过滤 + 回归断言 |
| 定时采集调度 | ✅ 已跑通 | 子进程隔离实测：真实任务完成、单任务失败不影响调度器 |
| 结构化日志 / 自检 | ✅ 已跑通 | `diagnose` 输出 11 项检查并落盘 |
| **关注与降价提醒** | ✅ 已跑通 | `watch` 加关注、`alerts` 判定到价；同价位不重复打扰 |
| **提醒通道** | ✅ 已跑通 | 通用 webhook / 企业微信机器人 / 邮件（自实现 SMTP），对着本地假服务器逐行验证 |
| **采集熔断** | ✅ 已跑通 | 连续失败 3 次暂停 6 小时，实测 `circuit_tripped` → `circuit_skip` |
| Steam 国区采集 | ⚠️ 代码完成，**本机网络不可达** | `store.steampowered.com` 连接超时（12s），需出口 |
| ITAD 官方 API | ⚠️ 代码完成，**未用真 key 验证** | 无 key 时返回 403；响应结构按官方文档实现 |
| Docker 部署 | ✅ 已发布镜像 | 镜像由 GitHub Actions 构建并推送 TCR / Docker Hub（v2.2.0 双绿）；线上容器版本以 [DELIVERY.md](docs/DELIVERY.md) 部署记录为准 |
| **一键部署（自动建库/建表/导入）** | ✅ 已验证 | `ensureDatabase` 在真 PG 协议下建库成功；`bootstrap` 幂等建表与导入 |
| Fanatical | ⏸ 不接入 | 商品页是 SPA 且 Algolia key 被 Cloudflare 403，无可靠取数路径 |
| 多区服同屏并排 | 🚧 未实现 | 采集与单区切换已支持（见上方「多区服采集」）；`region` 维度已在数据模型里，同屏多区并排展示未做 |
| 小黑盒商城 | ⏸ 评估后暂缓 | 无公开接口，需逆向 `hkey` 签名 |
| SteamPy | ⏸ 不接入 | 商品接口全部要求登录态（401），且是 C2C |

> 这张表随代码更新。**任何标 ✅ 的能力都必须能被测试或一次真实运行验证**；做不到就写 ⚠️。

## 它解决什么

买一款游戏时，实际要回答三个问题：

1. **同一款游戏，各渠道现在差多少？** Steam 国区、杉果、Fanatical、Humble、GOG 的价格经常差 20–40%，但没有任何一个中文站点把它们横向摆在一起。
2. **现在是不是历史低点？** 商店页面只显示"当前 -50%"，不显示"这游戏史低是 -75%"。没有价格历史，就无法判断该不该等。
3. **这个价格到底可不可信？** 搜索到的"3 元买《赛博朋克》"，大概率是共享账号或黑 key，不是游戏。

这个项目就是为这三个问题写的：**官方渠道横向比价 + 长期价格曲线 + 明确的来源边界**。

## 它明确不做什么

划清边界比堆功能重要，下面这些是**有意不做**的：

| 不做 | 原因 |
|---|---|
| **全网最低价（C2C）** | SteamPy、淘宝卖家、共享账号的"最低价"结构性上由灰产定价。把它们和正版渠道排在一起，等于给假货做免费广告，并且会把用户投诉引到自己身上。 |
| **站内下单 / 代购** | 代收货款属于二清，且平台没有面向第三方的下单接口。跳转购买已经满足需求，也避免了支付牌照、发票、售后赔付这一整套责任。 |
| **"保证是正品"的承诺** | 没有任何算法能在成交前证明一个 key 的真伪。本项目只承诺"来源可信 + 可追溯"，不承诺"我保证是正品"。 |
| **SteamPy 接入** | 全部商品接口要求登录态（`code:401`），且是 C2C 性质。用个人账号跑自动化有封号风险，收益不足以抵消。 |

## 功能

状态含义：**✅ 已验证** / **⚠️ 已实现但受限或未验证** / **🚧 未实现** / **⏸ 评估后暂缓**

| 功能 | 状态 | 说明 |
|---|---|---|
| Steam 国区采集 | ⚠️ | 官方 `appdetails`，批量 + 限速；单测覆盖解析，真实网络被阻断 |
| 杉果采集 | ✅ | 商品页内嵌 JSON 解析，不依赖 DOM 选择器；真实页面验证 |
| 杉果 SKU 自动发现 | ✅ | 按 id 从前沿向后探测，连续空壳即停；发现的 SKU 自动并入 `data/skus.json` |
| 跨平台名称匹配 | ✅ | bigram Dice 打分 + 阈值分级（自动/待确认/无候选）+ 人工 `--confirm`；确认后自动合并重复游戏行 |
| 多区服对比 | ✅ | 同一游戏按区服并排（GOG 支持 cn/us/tr/ru/ar 等）；**不同币种不折算** |
| Steam 游戏信息导入 | ✅ | `import steam`：appid / 商店链接 / 清单文件 → 中文名、封面、发行日期、开发商 |
| 出网代理 | ✅ | 按目标主机分流：Steam 走 `STEAM_PROXY`（**支持多条自动切换**：失败冷却 60s/5min/30min、成功粘住、全部失败报错不回退直连，v2.0.0），其余走 `HTTPS_PROXY`，境内源直连 |
| ITAD 官方 API | ⚠️ | 按商店拆成独立平台，需自备免费 key；未用真 key 跑过 |
| 价格历史与史低 | ✅ | 变化才写快照，按天聚合，终端画轨迹 |
| 官方渠道结构约束 | ✅ | `v_lowest_official` 视图 + 查询层过滤 + 回归断言 |
| 定时采集 | ✅ | 每平台独立子进程；Steam 价格/热度/状态判定各自周期，**重任务非阻塞单槽**（v1.16.1：价格刷新跑 90 分钟期间杉果/GOG/提醒照常执行）；`steam-status` 每天 12000 条；重启从 `sync_runs` 恢复上次运行时间 |
| 结构化日志 | ✅ | JSONL + `runId` 串联 + 密钥脱敏 + 轮转 |
| 自检 `diagnose` | ✅ | 环境 / 数据库 / 网络逐项检查，报告落盘 |
| 凭据扫描 | ✅ | `npm run scan`，公开仓库前自检 |
| Docker 部署 | ✅ | 非 root / tini / healthcheck；镜像由 GitHub Actions 构建并推送 TCR / Docker Hub，线上容器版本以部署记录为准 |
| 价格曲线网页 | ✅ | 静态 HTML + 内联 SVG，无外部依赖，浏览器直接打开 |
| **Web 前端 + 用户系统** | ✅ | `frontend/` Vue 3 + Vite + Element Plus；前台、初始化、封禁页与控制台全部由 Vue 渲染，没有构建产物时回退 `web/` 旧页面 |
| 访问记录与 IP 黑名单 | ✅ | 页面/API 访问落库（IP+归属地），后台可查；拉黑 IP/CIDR 即整站 403；`/banned` 只有真被封禁才给封禁页，未封禁（含管理员、封禁已过期）一律 302 回首页 |
| 内置静态页服务 | ✅ | `serve` 命令 / compose 的 `web` 服务，直接 `IP:端口` 访问，不依赖 nginx |
| 曲线页自动重建 | ✅ | 采集成功后由调度器自动刷新 `out/`（`CHART_ON_SYNC=0` 可关） |
| 关注列表与降价提醒 | ✅ | 目标价 / 史低两种触发，同价位去重 |
| 提醒通道 | ✅ | webhook / 企业微信机器人 / 邮件（SMTP，支持 STARTTLS 与 AUTH PLAIN/LOGIN） |
| **用户彻底删除** | ✅ | 后台 → 用户管理 → 删除：必须输入用户名确认；不能删自己、不能删最后一个可用管理员；级联清理会话/Steam 账号/愿望单/标记 + 「最近删除」只读审计表（v2.0.0；v2.4.0 起搬到操作日志 · 用户删除 tab，上限 200 + 日期范围） |
| **邮件模板 + HTML 邮件** | ✅ | 9 事件模板（8 类账号通知 + 验证码）可编辑/启停/预览/发测试/恢复默认/套用 3 套示例版式；HTML 多部分邮件（纯文本兜底）；发送记录验证码/通知双筛选（v2.0.0；v2.4.0 起搬到操作日志 · 邮件发送，邮件服务页只留「查看发送记录 ↗」入口） |
| **账号变更通知** | ✅ | 禁用/启用/删除/改名/改邮箱/改角色/重置密码自动发通知邮件；改邮箱发两封（旧邮箱安全提醒 + 新邮箱绑定确认）；批量操作不发；发送失败不影响业务（v2.0.0） |
| **Steam 代理池健康状态** | ✅ | `GET /api/admin/proxies` 显示每条代理状态（正常/冷却中/未知、连续失败、最近错误，地址脱敏）；健康状态落 `data/proxy-health.json` 跨进程共享（v2.0.0）；设置页**列表编辑器**（增/删/上移/下移、≤10 条、健康状态表、10 秒自动刷新，v2.1.0） |
| **密码策略与哈希升级** | ✅ | 新密码最低 12 位 + 弱口令黑名单 + 含用户名/邮箱/连续序列判定；scrypt 版本化哈希（登录静默升级）；`/api/password/check` 强度评估（v2.1.0） |
| **登录防护** | ✅ | 同 IP 15 分钟失败 20 次限速；账号 5 次错密码锁 15 分钟；管理员可解锁；记住我 30 天；后台「已锁定/弱密码/需改密」tag（v2.1.0） |
| **账号流程** | ✅ | 后台建号/重置可留空生成临时密码（首登强制改密）；开放自助注册（邮箱验证码）；登录用户自助修改密码（踢其它会话）（v2.1.0） |
| **独立登录 / 注册 / 改密页** | ✅ | `/login`（三模式 + 记住我）/ `/register`（强度条）/ `/change-password`；首页不再弹登录框；会话过期跳登录带回跳（v2.1.0） |
| **后台未保存离开提醒** | ✅ | 系统设置/邮件配置/站点通知/编辑游戏/新建用户有未保存修改时，切菜单/离开页面弹「保存并离开/放弃修改/留在本页」；「放弃修改」会清掉草稿（v2.1.0；回归修复 v2.2.0） |
| **后台列表排序** | ✅ | 异常审核（最近出现/IP/次数/规则）与访问明细（时间/IP/结果）表头可点排序；IP 按**数值序**（IPv6 排后）；排序状态存 localStorage；待审上限 500（v2.2.0） |
| **异常审核按 IP 合并（默认视图）** | ✅ | 进入「异常审核」直接是合并视图（同一 IP 多条规则合成一行：规则摘要/总次数/首次→最近/设备数/状态，展开看每条规则）；处置一律按整 IP（封 IP/封设备/忽略作用于该 IP 全部待审记录，确认弹窗写明条数）；「已选 N 个 IP · M 条待审」批量栏、合并视图排序与移动端卡片（v2.7.0；无开关、无明细表） |
| **封面图回源优化** | ✅ | 不存在的图只请求 1 次就 404（不再连试 3 个 CDN）；单候选超时 8s→3s、整次预算 5s；404 负缓存 24h、网络错误 10min；header 尺寸优先用 Steam 新资产直链（`games.header_image`，仅 https + `.steamstatic.com` 白名单）；封面失败显示占位块（不再用 favicon 兜底）；`images pull` 统计 404 缺图数（v2.7.0） |
| **同步可靠性** | ✅ | steam-status 判 ok 顺带写首价；「已同步」= ok+有报价；回填新游戏优先+上限 5 万；每日 Steam 配额预算超限自动降频告警；熔断面板可见可手动重置；429 冷却跨进程共享；报价结构校验（v2.1.0） |
| 采集熔断 | ✅ | 连续失败自动暂停，避免持续撞墙 |
| GOG 采集 | ✅ | 官方 catalog 接口，CNY 价格，只接受精确标题匹配 |
| Humble 采集 | ⚠️ | slug 探测 + JSON-LD，名称必须完全一致；探测不到就跳过 |
| Fanatical | ⏸ | SPA + Algolia key 被 Cloudflare 拦，没有可靠路径 |
| **热度排序** | ✅ | `heat` 命令回填 Steam 评测数 + 发行日期，列表默认按热度主序，用户排序作次序；无热度数据排最后 |
| **发行时间筛选** | ✅ | 前台「不限 / 近 30 天 / 近 1 年 / 近 3 年」 |
| **目录统计口径** | ✅ | 首页显示「收录条目（含 DLC/软件）+ 有报价数」，`/api/games/count` 排除已删除/禁用 |
| **搜索边打边查** | ✅ | 300ms 防抖 + 中文输入法合成期不查 + 最短长度 + 请求取消 + 30 秒缓存 + 搜索词同步 URL；**v2.5.0 起生产库建 `pg_trgm` 表达式 GIN 索引**（与搜索归一化逐字一致，模糊搜索走索引；本地 pglite 无扩展自动跳过） |
| **亮暗色主题** | ✅ | 语义化颜色 token；默认跟随系统，顶栏/后台可切；登录用户跨设备同步（`user_prefs.theme`），设置页可回「跟随系统」 |
| **移动端适配 / PWA** | ✅ | 900/760/420 三档断点；后台游戏目录、访问记录在手机上**卡片式**（其余表格支持左右滑动）；手机浏览器「添加到主屏幕」后 **standalone 全屏运行**（manifest + 192/512 图标，无地址栏）；断网统一提示「网络不可用，请检查连接后重试」并可重试；Android 返回键先关浮层再退出；**版本更新提示**（切回前台检测，默认不自动刷新）。**不做 service worker / 离线缓存 / 推送 / 购物车**，购买仍跳 Steam 商店 |
| **站点通知弹窗** | ✅ | 新公告自动弹窗（最多 5 条），关闭记已读，页面不放公告元素 |
| **标记三态** | ✅ | 感兴趣 / 不感兴趣 两个显式按钮（游客存本地、登录存库）；「全部」页签只显示**未标记**的游戏 |
| **已拥有（按用户推导）** | ✅ | 绑定 Steam 账号后，「已拥有」= 手动标记 ∪ 所有绑定账号游戏库并集；卡片显示 `已拥有 · 账号名`（>2 个 `+N`）；全局 `games.owned` 已废弃 |
| **愿望单标签页** | ✅ | 同步绑定账号的 Steam 愿望单到前台独立标签页，并自动加入价提醒（`source='steam_wishlist'`，史低提醒；移出愿望单/解绑自动清理） |
| **手动愿望单** | ✅ | 点「愿望单」按钮加入本站愿望单并联动到价提醒（多账号弹窗可选「仅本站」）；**Steam 账号推送暂不可用**——`AddToWishlist` 对 Web API Key 返回 401，Steam 已停止接受第三方写入，弹窗与提示为「仅本站保存」诚实口径（AA 方案 A）；失败原因仍记 `adapter.steam.wishlist_add_failed`，每日只读同步不受影响 |
| **Steam 多账号绑定** | ✅ | 每个站点用户最多绑 5 个 Steam 账号、一账号只属一人；OpenID + state 防 CSRF；后台「Steam 账号」页可同步库/愿望单、改别名、解绑、认领，并统计每个账号的游戏数与 **DLC 数**（同步时自动补全目录类型） |
| **后台版本检查** | ✅ | 侧栏显示当前版本，有新版本提示链接，点击强制重查 |
| **后台列表批量操作** | ✅ | 11 个列表可多选批量执行（待审 / 访问明细 / 回收站 / 站点通知 / IP 黑名单 / IP 白名单 / 已封设备 / 自动封禁 / 游戏目录 / 最近设备 / 用户）；统一 `POST /api/admin/bulk`：白名单派发表决定单次上限（高危 50 / 常规 200 / 回收站 1000），高危动作服务端二次校验 `confirmCount`，成功/跳过/失败逐条回执；审计落 `admin_bulk_ops`，v2.4.0 起在「操作日志 → 批量操作」tab 可查键样本 |
| **Steam 同步状态与内容分级** | ✅ | 六态状态机解释「为什么没价格」：免费 / 未发售 / 锁国区 / 国区无价 / 国区不可售 / 正常；锁国区（港区可售）标「国区不可售」且不出国区价格；成人/成熟内容按 Steam 平台标签标注（`site.adultDisplay` = hide/badge/show，默认 hide 前台不显示、后台始终可见）；后台指标卡按六态 + 成人/成熟拆分，支持 `rating=adult|mature|none` 分级筛选；`steam-status` 每周任务一次请求同时拿状态与分级，backfill 的 appdetails 回退路径顺带写状态与分级（拿不到状态不推游标、分级不覆盖） |
| **单款历史 CSV** | ⏸ | 前端入口已移除，接口默认 404（`HISTORY_CSV_ENABLED=1` 可临时打开） |
| **后台信息架构改版（AT 批）** | ✅ | 新建用户 / 新建·编辑站点通知改右侧抽屉（不跳页、列表不刷新、URL 直达、临时密码抽屉内一次性展示、通知带前台预览）；新菜单「操作日志」一页 5 tab（用户删除 / 批量操作 / Steam 账号 / 邮件发送 / 运行与同步，?tab= 直达、懒加载+缓存）；邮件服务 3 tab（配置/模板/发送测试）；系统设置折叠改 6 tab；价格变化悬停「变化」列弹近 7 天线图（无逐行请求）；旧书签 bulk-ops/sync 自动映射不 404（v2.4.0） |
| **Steam 账号操作审计** | ✅ | 绑定 / 解绑 / 认领 / 同步库 / 同步愿望单 / 换 API Key / 级联删除 7 类动作落 `steam_account_logs`（失败带原因与耗时、用户被删后日志仍在），后台「操作日志 → Steam 账号」可查；保留 180 天并入每周 prune（v2.4.0） |
| **首页列表读模型** | ✅ | `game_region_snapshot` 入库时算好价格/折扣/史低/新史低，列表与计数不再每次全库聚合（`READ_MODEL=legacy` 可回滚旧 SQL；`readmodel check/rebuild` 对账与重建 + 每日抽样对账任务）；**性能目标**（部署后实测）：列表 TTFB P95 < 150ms、零命中 < 150ms、`/api/games/count` < 30ms（v2.6.0） |
| **多区服同屏并排** | 🚧 | 列表可按区服切换；同屏多区并排展示未做（采集与 `compare` 命令已支持） |

## 设计原则

**1. 只比官方渠道价，并且让这是结构约束而不是一句口号**

`platforms.kind` 只允许 `official` / `authorized_reseller` / `c2c` 三种值，主榜由视图 `v_lowest_official` 过滤。这意味着：

- 即使采集层以后误收了 C2C 报价，它也进不了主榜；
- 想放进去，必须改视图——一个能被 code review 看到的地方。

这个约束不是多余的谨慎。开发过程中真出现过一次泄漏：主榜视图挡住了 `offers`，但"史低"走的 `daily_prices` 聚合是**第二条路径**，把 C2C 的 3 元算成了史低。现在查询层所有面向主榜的 SQL 都强制 join `platforms.kind`，并有回归断言守着。

**2. "真实"只承诺到"来源可信 + 可追溯"**

每条报价都记录平台、区服、渠道类型、抓取时间与来源 URL。用户能看到这条价格是哪来的、什么时候抓的，而不是一个无法验证的数字。

**3. 历史从第一天开始存**

`price_snapshots` 只追加、价格没变就不写；`daily_prices` 按天聚合。晚一天开始，那天的价格就永远补不回来——这是这个项目里唯一"过期不候"的东西。

## 架构

后续维护或新会话建议先读 **[项目总览：架构、功能与代码落点](docs/PROJECT-OVERVIEW.md)**；这里保留产品定位和采集链路概览，设计取舍见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

```
                        ┌──────────────────────────────────────────┐
                        │  src/adapters/    每平台一个，统一吐 RawOffer │
                        │  ├ steam.js   官方 appdetails（批量+限速）  │
                        │  ├ sonkwo.js  商品页 → 内嵌 JSON → 报价     │
                        │  └ itad.js    官方 REST API（按商店拆分）    │
                        └──────────────────┬───────────────────────┘
                                           │  RawOffer
                                           ▼
                        ┌──────────────────────────────────────────┐
                        │  src/ingest.js                           │
                        │  指纹判重 → 当前报价 upsert                │
                        │           → 有变化才写快照                 │
                        │           → 按天聚合                       │
                        └──────────────────┬───────────────────────┘
                                           ▼
                        ┌──────────────────────────────────────────┐
                        │  src/store/     PostgreSQL 15            │
                        │  pg.js  全部 SQL 集中在这一个文件            │
                        │  index.js  连接池 + 查询日志 + 慢查询告警     │
                        └──────────────────┬───────────────────────┘
                                           ▼
   ┌───────────────────────────────────────────────────────────────────┐
   │  src/cli.js       同步 / 主榜 / 轨迹 / 日志 / 自检                    │
   │  src/scheduler.js 常驻调度：每任务独立子进程，崩了不带垮调度器            │
   │  src/log.js       JSONL + runId + 脱敏 + 轮转                       │
   └───────────────────────────────────────────────────────────────────┘
```

一次 `sync` 的完整时序：

```
cli.js 生成 runId
  └→ adapter 分批请求（每批记 http.request / http.response）
       └→ 解析成 RawOffer（解析过程的中间量记 adapter.* 事件）
            └→ ingest：每个 offer 一个 upsert 事务单元
                 ├→ 价格没变：只更新 last_seen_at（unchanged+1）
                 └→ 价格变了：写 price_snapshots（snapshots+1）+ 记 ingest.price_changed
                      └→ 更新 daily_prices（取当天最低）
                           └→ 汇总 ingest.summary → sync.done → fetch_runs 落健康度
```

设计取舍写在 **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**，包括为什么不做长事务、为什么子进程隔离、怎么加一个新平台。

## 快速开始

### 方式一：Docker Hub（零配置，推荐）

镜像：`s1065420329/steamdeals:latest`。**不需要 `.env`，也不需要改业务配置。**

```bash
docker compose -f compose.hub.yaml up -d
```

打开 `http://服务器IP:8090`，会先进入 `/setup`：

1. 创建第一个管理员
2. 填数据源（国内服务器建议 ITAD Key 或 Steam 代理）
3. 可选填 Webhook / 企业微信 / SMTP

完成后自动登录，调度器约 15 秒内开始采集。之后所有业务设置都在「控制台 → 系统设置」，保存后热加载，不用重启容器。

**用已有 PostgreSQL**：直接改 [compose.hub.external-db.yaml](compose.hub.external-db.yaml) 里的 `DATABASE_URL`（和改 `volumes` 一样），然后：

```bash
docker compose -f compose.hub.external-db.yaml up -d
```

不想把密码写进受版本控制的文件时，复制一份本地副本（已 gitignore）：

```bash
cp compose.hub.external-db.yaml compose.hub.external-db.local.yaml
# 改本地副本里的 DATABASE_URL
docker compose -f compose.hub.external-db.local.yaml up -d
```

完整说明（外部库、docker run、卷、备份、SETUP_TOKEN、排障）见 **[docs/DOCKER-HUB.md](docs/DOCKER-HUB.md)**。

**国内用户**：Docker Hub 可能拉不动，用腾讯云 TCR 公开镜像：

```bash
docker compose -f compose.cn.yaml up -d
```

已有 PostgreSQL 就改 [compose.cn.external-db.yaml](compose.cn.external-db.yaml) 里的 `DATABASE_URL`，然后：

```bash
docker compose -f compose.cn.external-db.yaml up -d
```

镜像由 GitHub Actions 的 `docker-tcr` 工作流推送，需要先配置 `TCR_USERNAME` / `TCR_PASSWORD` 并手动运行一次。详见 [docs/DOCKER-HUB.md](docs/DOCKER-HUB.md#国内用户腾讯云-tcr)。

**从源码构建**（开发/自定义镜像）：

```bash
mkdir -p logs out                       # 这两个目录不在仓库里，必须自己建
sudo chown -R 1000:1000 ./data ./logs   # 容器以 uid 1000 运行
docker compose up -d --build
docker compose ps             # app 应为 healthy
docker compose logs -f app    # 看到 bootstrap.done 即启动成功
```

**不需要先建库、建表、改密码、填 .env。** 起来之后这条链是全自动的：

```
postgres 容器创建库 steamdeals
  → app 启动：ensureDatabase（库不在就 CREATE DATABASE）
  → bootstrap：建表 + 平台字典 + 首次导入 data/games.json（幂等）
  → /setup：创建管理员、写业务设置
  → 调度器：初始化完成后按间隔采集
```

内置 `postgres:15-alpine` 用 trust 认证且端口不发布到宿主机，只在 compose 内网可达；需要密码见 [DEPLOY.md](docs/DEPLOY.md)。
用外部数据库时填好 `DATABASE_URL` 后执行 `docker compose up -d app`（只起 app）。

> 镜像构建与首次启动冒烟由 GitHub Actions 执行；开发机没有 Docker，本地只做配置/单测/前端语法校验。首次部署仍建议对照 [DOCKER-HUB.md 排障表](docs/DOCKER-HUB.md#排障) 看日志。

### 方式二：本地运行（推荐先这样验证）

要求 **Node ≥ 22.5**、**PostgreSQL ≥ 15**（开发机上实测 15.17）。

```bash
npm install
export DATABASE_URL='postgres://user:pass@host:5432/steamdeals'
node src/cli.js init          # 建表 + 平台字典（幂等）
node src/cli.js seed          # 导入 data/games.json
node src/cli.js diagnose      # 环境 / 数据库 / 网络自检
```

前端源码在 `frontend/`（Vue 3 + Vue Router + Element Plus + Vite）。开发时另开终端运行 `npm run frontend:dev`（Vite 默认 5174，API 代理到本机 `8090`），改完刷新即可；生产镜像构建时由多阶段 Dockerfile 自动生成 `frontend/dist`，`frontend/dist/` 不入库。前台首页、初始化、封禁页和控制台十个模块全部由 Vue 渲染；`web/` 里的旧页面只在没有构建产物时作为回退。

没有 PG 服务器也能跑起来（内置 wasm 版 PostgreSQL，仅用于验证逻辑）：

```bash
node src/cli.js init --db pglite:./data/pgdata
node src/cli.js seed --db pglite:./data/pgdata
```

### 确认安装正常

```bash
node src/cli.js ping                      # 只验证数据库，静默退出 0
node src/cli.js sync sonkwo --limit 1     # 唯一开箱即用的源，真实抓一次
node src/cli.js list                      # 应能看到价格与史低标记
node src/cli.js chart                     # 生成静态价格页到 out/
```

`chart` 之后直接用浏览器打开 `out/index.html`（Windows 可以 `start out\index.html`）。页面是纯静态的：内联 SVG 曲线、无外部 JS/CSS、离线可看。

想先看效果而不采集数据：

```bash
node scripts/demo-seed.js                                    # 造 3 款游戏、90 天演示数据
node src/cli.js chart --db pglite:./data/demo-pgdata --out out
```

## 命令参考

**日常**

| 命令 | 说明 |
|---|---|
| `list` | 主榜：各游戏官方渠道最低价 + 是否史低 |
| `chart` | 生成静态价格页（曲线图）到 `out/`（`--out`、`--days 90`、`--limit 200`） |
| `watch add\|rm\|list` | 关注列表：`watch add 1091500 --target 99`（不带 target = 跌到史低才提醒） |
| `alerts` | 检查到价（`--mark` 记录已通知、`--json` 机器可读、`--webhook URL` 临时投递） |
| `notify-test` | 给所有已配置的提醒通道发一条测试消息（部署自检） |
| `history <appid>` | 终端画价格轨迹 + 史低判断（`--days 90`） |
| `stats` | 数据量 + 最近 5 次采集健康度 |

**采集**

| 命令 | 说明 |
|---|---|
| `sync steam` | Steam 国区价格（`--limit 500`）⚠️ 需能访问 Steam |
| `sync sonkwo` | 按 `data/skus.json` 抓杉果（`--limit`、`--rate 1200`）✅ |
| `discover sonkwo` | 自动发现新 SKU（`--ahead`、`--max-misses`、`--from/--to`）✅ |
| `match` | 把杉果 SKU 对齐到 Steam 游戏（`--apply` 自动、`--confirm <skuId> <appid>` 手工）✅ |
| `compare <appid>` | 多区服对比（`--region cn` 只看单区、`--json` 机器可读）✅ |
| `import steam` | 导入游戏信息（`--appids 730,570` / `--urls <链接>` / `--file 清单`；`--backend auto\|official\|steamcmd`）✅ |
| `serve` | 全栈服务：前端 + JSON API（`--port 8090`、`--dir web`）✅ |
| `user add <名> [--admin]` / `user list` | 用户管理，密码只显示一次 ✅ |
| `backup` | 8 张核心表导出 gzip JSON，保留 7 份，顺带清理 90 天前浏览记录 ✅ |
| `owned <appid> on\|off` | 标记已拥有（⚠️ 全局 `games.owned` 已废弃，前台不再读取；前台「已拥有」改由绑定 Steam 账号 + 个人标记推导） |
| `sync itad` | ITAD 官方 API（`ITAD_API_KEY` 未配置则跳过）⚠️ 未验证 |
| `sync gog` | 按英文名查 GOG（catalog 接口，只接受精确标题）✅ 已跑通 |
| `sync humble` | 按英文名探测 Humble 商品页（JSON-LD）⚠️ 命中率取决于 slug |
| `add-sku <id...>` | 往 `data/skus.json` 加 SKU，`--appid 123` 关联 Steam 游戏 |

**运维与排障**

| 命令 | 说明 |
|---|---|
| `init` | 建表 + 平台字典，可重复执行 |
| `bootstrap` | 建表 + 首次自动导入（容器启动用） |
| `ping` | 健康检查，数据库可用则静默退出 0 |
| `seed` | 从 `data/games.json` 导入游戏 |
| `logs` | 查日志（`--level` `--event` `--run` `--since`） |
| `backfill` | 批量回填全量游戏的元数据/价格（后台「数据回填」卡片同款）：`--limit 200000 --batch 100 --sleep 3000 --fallback 10` |
| `heat` | 热度回填：评测数 + 发行日期（appdetails recommendations）：`--limit 200000 --batch 30 --sleep 1700`，按 `heat_at is null` 自动续跑，约 3 小时全量 |
| `steam-status` | Steam 同步状态判定 + 内容分级（逐 appid 全量 appdetails，`cc=cn` 失败补 `cc=hk` 判定锁区）：`--limit 200000 --batch 30 --rate 1500`，`steam_checked_at` 作续跑游标，免费已由迁移置位 |
| `steam-accounts` | 同步所有已绑定 Steam 账号的游戏库与愿望单（差集删除 + 愿望单→价提醒对账；`--sleep 1000` 账号间隔）✅ |
| `steam-claim <用户名> <SteamID>` | 认领未归属的 Steam 账号（迁移用；幂等，已归属他人时报错）✅ |
| `prune` | 定期清理：访问记录/采集与任务记录/验证码/Steam 账号日志（`--visitor-days 180 --run-days 90 --email-days 7 --steam-days 180`） |
| `readmodel` | 首页列表读模型对账/重建：`check [--sample 200] [--fix]`（差异非零退出）、`rebuild [--region cn]` |
| `diagnose` | 环境/数据库/网络自检，报告落盘 `logs/diagnose-*.json` |
| `probe` | 目标可达性探针，见下 |

通用参数：`--db <target>`（`postgres://…` 或 `pglite:./path`）、`--level`、`--log-dir`、`--wait-db <秒>`。

探针用于接入新平台前的可达性判断，不写库、不依赖 DATABASE_URL：

```bash
node src/probe.js --url-file scripts/probe-targets.txt --rounds 1
node src/probe.js --target steam --rounds 24 --interval 3600   # 跑 24 小时看稳定性
```

输出每轮的状态码、延迟、响应体大小，最后给成功率与 p50/p95；出现 403/429 会提示风控。

## 配置

### 业务设置（落库，页面维护）

50 项业务配置 **不再需要改 `.env`**，全部存在 PostgreSQL。Steam 价格默认每天刷新一次，可在系统设置中调整刷新间隔：

- 首次启动：`/setup` 初始化页
- 之后：控制台 →「系统设置」
- 保存后调度器约 15 秒内热加载；密钥字段只显示「已配置」，不回显

| 分组 | 内容 |
|---|---|
| 数据源 | Steam / 杉果 / ITAD / GOG / Humble / SKU 发现的开关、间隔、首轮延迟 |
| Key 与区服 | `ITAD_API_KEY`、`STEAM_API_KEY`、`GOG_REGIONS` |
| 提醒 | Webhook、企业微信、SMTP（授权码 AES-256-GCM 加密）、收件人、检查间隔 |
| 网络 | `STEAM_PROXY`、`HTTPS_PROXY`、`NO_PROXY` |
| 高级 | 熔断、备份、日志清理、静态页开关、日志级别 |
| 封面图缓存 | 开关、间隔、每轮数量、下载间隔、**总量上限**（`images.maxBytes`，超限自动按最旧清理；`node src/cli.js images prune --max-bytes <字节>` 可手动清理；图片落 `data/images`，不进库） |

旧 `.env` 里的这些变量仍会被识别：如果是老库（已有管理员），首次启动自动导入数据库；新库则由 `/setup` 写入。优先级是 **数据库 > 环境变量 > 默认值**。完整列表见 [docs/DEPLOY.md](docs/DEPLOY.md#旧环境变量迁移)。

### 部署参数（仍用环境变量）

这些必须在连接数据库/启动容器前确定，不能搬进数据库：

| 变量 | 默认 | 说明 |
|---|---|---|
| `DATABASE_URL` | 自带 db / 嵌入式 PG | 外部 PostgreSQL 连接串；写在 compose 命令里即可 |
| `POSTGRES_PASSWORD` / `POSTGRES_HOST_AUTH_METHOD` | 空 / `trust` | 仅自带 db 的可选加固 |
| `WEB_PORT` | `8090` | 宿主机端口（容器内固定 8080） |
| `TZ` | `Asia/Shanghai` | 影响日志时间与 `current_date` |
| `SETUP_TOKEN` | 自动生成 | 首次初始化必须有口令；可自行设置，未设置时启动输出会显示一次性口令 |
| `SECRET_KEY` | 自动生成 | 不设则用 `data/secret.key`；务必持久化 data 卷 |
| `DB_WAIT_SEC` | `0`（容器内 60） | 启动时最多等数据库多少秒 |
| `SEED_ON_START` | `1` | 首次启动是否自动导入游戏 |
| `OUT_DIR` / `LOG_DIR` | `out` / `logs` | 静态页与日志目录 |
| `IMG_DIR` | `data/images` | 封面图缓存目录（随 data 卷持久化） |
| `STEAM_HEAT_INTERVAL_MIN` | `10080` | 热度任务间隔（分钟，每周） |
| `STEAM_HEAT_LIMIT` | `20000` | 热度任务每轮上限（只刷「过期且已有报价」的条目） |
| `STEAM_STATUS_INTERVAL_MIN` / `STEAM_STATUS_RATE_MS` / `STEAM_STATUS_LIMIT` / `STEAM_STATUS_INITIAL_DELAY_SEC` | `1440` / `1500` / `6000` / `600` | Steam 状态判定任务间隔（分钟）/ 逐 appid 请求间隔（毫秒）/ 每轮尝试上限（默认 **6000** 款 ≈ 5 小时/轮，每款平均 2 次请求，AB 批从 12000 下调）/ 首轮延迟（秒）。四项都在「系统设置 → 数据源与采集 → 高级」里可改（键：`steamStatus.intervalMin` / `steamStatus.rateMs` / `steamStatus.limit` / `steamStatus.initialDelaySec`；注意库里已保存的值会覆盖默认值） |
| `SITE_ADULT_DISPLAY` | `hide` | 成人内容展示策略：`hide`（前台不显示，默认）/ `badge`（带角标）/ `show`（正常展示）；后台始终可见 |
| `STEAM_ACCOUNTS_INTERVAL_MIN` / `STEAM_ACCOUNTS_SLEEP_MS` | `1440` / `1000` | 绑定账号同步间隔与账号间间隔（需要 `STEAM_API_KEY`） |
| `STEAM_CLAIM_USERNAME` / `STEAM_CLAIM_STEAM_ID` | 空 | 配置后调度器自动把历史未归属账号认领给该用户（幂等，完成后可删） |
| `PRUNE_INTERVAL_MIN` / `PRUNE_ENABLED` | `10080` / 开 | 定期清理任务间隔与开关 |
| `VISITOR_GEO` | 开 | 置 `0` 不再把访客 IP 发给第三方归属地服务 |
| `HISTORY_CSV_ENABLED` | 空 | 置 `1` 才开放 `/api/games/:appid/history.csv`（默认 404） |
| `RUN_MODE` | `scheduler` | 容器入口模式；compose 用 `all` |

## 数据模型

```
games              游戏身份，以 steam_appid 为锚点；含 heat/heat_reviews/heat_at（热度排序）与 release_date（发行筛选）
game_aliases       平台商品 → 游戏 的映射（跨平台对齐的落点，保留匹配方式与置信度）
offers             当前报价：game × platform × 渠道类型 × 区服 唯一
price_snapshots    历史快照，只追加；raw_hash 相同不写
daily_prices       按天最低价聚合，画曲线只读这张
fetch_runs         每次采集的成功/失败/跳过，先看这里再怀疑代码
platforms          平台字典（official / authorized_reseller / c2c）
watchlist          关注列表：目标价 / 上次通知价（同价位不重复打扰）
users/sessions/user_prefs/user_game_flags   账号、会话、偏好（含主题）与个人标记
announcements/email_codes/smtp_settings     站点通知、邮箱验证码与 SMTP
visitor_logs/page_views/ip_*/device_*/abuse_reviews/sync_runs   访问记录、安全与后台任务
v_lowest_official  主榜视图：只统计官方渠道的最低到手价
```

> 目前**共 26 张表 + 1 个视图**。`platforms` 里预置了 `itad` / `fanatical` / `humble` / `gog` / `steampy` 的 code，但**只有 `steam` / `sonkwo` / `itad` / `gog` / `humble` 有适配器**——预留 code 不等于已支持，见[数据源](#数据源)。

三个关键设计：

- **区服是独立维度。** 国区 298、全球 60 美元、土区 30 里拉不是"同一个东西的不同价格"，混着比就是错的。
- **`offers` 与 `price_snapshots` 分离。** 前者是"现在多少钱"（高频查），后者是"曾经多少钱"（只追加）。画图只读 `daily_prices`，永远不扫快照全表。
- **`DATE` 列按字符串处理。** `pg` 默认把 `date` 解析成带时区的 `Date`，跨时区会差一天，日聚合和史低判断全错。存储层显式注册了 identity parser，SQL 里也统一 `::text`。

完整 DDL 在 [src/store/pg.js](src/store/pg.js)。

## 数据源

| 来源 | 方式 | 状态 |
|---|---|---|
| 杉果 | 商品页内嵌 `__remixContext` JSON | ✅ 可用；SKU 靠 `discover` 按 id 增量发现 |
| GOG | 官方 catalog JSON（`catalog.gog.com`） | ✅ 可用，按英文名精确匹配 |
| Humble | 商品页 JSON-LD `offers.price` | ⚠️ 可用但命中率取决于 slug 命名 |
| Steam | 官方 `appdetails` | ⚠️ 代码完成，国内网络直连不可达 |
| Steam 元数据 | 官方 `appdetails(basic)` / `api.steamcmd.net` 镜像 | ✅ 双后端自动回落；镜像给中文名与封面，但不提供 `is_free` |
| IsThereAnyDeal | 官方 REST API | ⚠️ 需免费 key，结构未真实验证 |
| Fanatical | SPA + Algolia 代理 | ⏸ 商品页无价格、key 接口 403，不接入 |
| 小黑盒 | SPA + `hkey` 签名 | ⏸ 暂缓 |
| SteamPy | 需登录态（401） | ⏸ 不接入 |

可达性实测、接口细节、复现命令都记在 **[docs/DATA-SOURCES.md](docs/DATA-SOURCES.md)**。那份文档记录了每个源"怎么探出来的"，包括失败的尝试——避免下次重新踩。

**合规说明**：本项目仅个人自用，低频访问、遵守目标站 `robots.txt`（杉果未禁止抓取）、不绕过登录与签名校验、不转售数据。使用 ITAD API 遵守其条款（可个人免费使用，不得改价或去除联盟参数）。

## 日志与排障

日志是这个项目的一等公民——远程排障只靠它。

```
logs/app-YYYY-MM-DD.jsonl      全量（info 及以上）
logs/error-YYYY-MM-DD.jsonl    只含 error/fatal，快速看错误流
logs/diagnose-*.json           自检报告
```

每条记录都带 `ts` / `level` / `event` / `runId` / `pid`。事件名是 `域.动作`，一次命令的所有事件用 `runId` 串起来。

| 事件 | 什么时候出现 | 排障用途 |
|---|---|---|
| `http.request` / `http.response` | 每次外部请求 | 只有 request 没有 response = 卡在网络上 |
| `http.error` / `http.retry` | 单次失败 / 重试 | `code=UND_ERR_CONNECT_TIMEOUT` 是被阻断；`status=429` 是限流 |
| `http.parse_error` | 响应不是 JSON | 带 `bodySnippet`，多半是拿到 HTML 错误页 |
| `db.query_failed` | SQL 报错 | 带 SQL 片段与错误码（如 `23505` 唯一键冲突） |
| `adapter.sonkwo.sku_candidates` | 解析商品页 | `count=0` 说明页面结构变了 |
| `ingest.price_changed` | 价格真的变了 | 带前后 hash 与价格 |
| `ingest.summary` / `sync.done` | 每轮结束 | 一眼看 inserted/updated/snapshots/unchanged |
| `scheduler.job_*` | 调度器派发任务 | 子进程退出码与耗时 |

```bash
node src/cli.js logs --level error --limit 20
node src/cli.js logs --event http --since 30        # 最近 30 分钟
node src/cli.js logs --run run-20261026025454-nu81  # 单次命令全轨迹
```

**线上出问题，发这三样就够定位**：`logs/error-*.jsonl`、对应 `runId` 的 `logs/app-*.jsonl`、`logs/diagnose-*.json`。

日志自动脱敏：`apiKey` / `token` / `cookie` 打成 `***`；连接串只抹密码、保留 host 与库名（排障需要）。按 8MB 轮转、保留 10 份。

### 访问安全、设备与站点通知

- **限流分桶**：页面/API 默认 60 次/60 秒，静态资源与封面图单独一桶（300 次/60 秒）——正常翻页的几十张封面不会把用户顶到阈值。
- **IP 超频自动封禁（按天三振）**：第 1 次封 10 分钟、第 2 次 30 分钟、第 3 次封到当天结束，
  **每天最多 3 次**，封到当天结束后不再累加；**次日 0 点自动恢复**，新的一天重新从 10 分钟起算。自动流程**永不写永久黑名单**。
  封禁期内继续打会按「违禁请求」次数升档；每次封禁同时写一条「待审核」记录。
- **扫描器/未知路径只记录**：`.env`、`.git`、`*.php`、`..`、`/wp-`、`/phpmyadmin` 等签名、
  以及未知路径超阈值（默认 10 分钟 30 个不同路径）只写进「待审核」（`abuse_reviews`，同 IP+规则合并计数），
  控制台「访问记录 → 待审核」里逐条选择 **封 IP / 封设备 / 忽略**，审批后才写黑名单/设备封禁。
- **限流响应**：429 + `Retry-After`，封禁期间提示还需等待多久；API/脚本收到纯文本。
- **设备指纹**：前台页面加载时上报平台/语言/时区/屏幕/CPU/内存/WebGL/Canvas 等，服务端只存 sha256 指纹；
  控制台「访问记录 → 设备」可查看最近设备、按指纹封禁。封禁按指纹生效，换 IP 也会命中。
- **封禁提示页**：被 IP/设备/频率封禁的浏览器请求直接返回 Vue 封禁页（403/429，按拦截来源），带「申请解封」按钮跳转 `/appeal` 申诉页
  （填写说明后生成申诉邮件）；封禁期间仅放行该页所需的构建 JS/CSS。
  **仅封禁可见的页面（`/banned`、`/banned.html`、`/appeal`）统一守卫**：没被封禁（含管理员、白名单、封禁已过期）
  一律 302 回首页（`ban.redirect_home` 日志），页面路由不做二次判定；客户端每 30 秒复查 `/api/ban/state`，
  解封后自动回首页。申诉链接只带 `?code=AP-XXXXXX`（原因/到期/邮箱由服务端注入，不进 URL）；
  `/banned*`、`/appeal*` 响应带 `noindex`，`robots.txt` 屏蔽 `/console /banned /appeal /api/`。
  简中/繁中/英/日/韩/俄/西/法/德，带申诉编号；没装邮件客户端时点击会复制申诉内容并显示邮箱；API/脚本仍收到纯文本。
  页面里的站点名与申诉邮箱来自 `SITE_NAME` 与「系统设置 → 申诉邮箱」（`APPEAL_EMAIL`），
  申诉邮箱留空时依次回退：邮件收件人 → 发件人 → SMTP 账号；每次返回提示页会记 `ban.page` 日志（含申诉编号），
  收到申诉邮件后按编号在 `logs/app-*.jsonl` 里能查到对应的 IP / 到期时间 / 原因。
- **站点通知**：控制台「站点通知」可写标题/正文/级别/启停/生效时间；前台不再放横幅，
  只有「比已读 id 更新」的公告会弹窗展示（最多 5 条），关闭即记已读（本地存储）。
- **被拦截的请求**按 IP 每分钟采样一条写入访问记录，带 `blocked` 标记，不计入访问量；
  控制台可切换「正常访问 / 被拦截 / 全部」。
- 封禁名单：`ip_blacklist`（IP，永久，只由管理员或审批写入）、`device_bans`（设备指纹，可设到期）；
  **黑/白名单双向互斥**：加黑自动移白、加白自动移黑（存量冲突按白名单优先清理），
  控制台「统计 / 黑名单 / 白名单」与「设备」页可一键解封。
- **待审口径**：待审列表与计数 = 所有 `pending` 记录；封禁期间产生的新异常同样以「待审」出现，
  状态列区分 待审 / 已封禁 / 已忽略 / 自动退出 四种标签。
- **反代部署**才需要 `TRUST_PROXY=1`；内网代理会自动识别，公网代理还需通过 `TRUSTED_PROXY_IPS` 配置代理 IP/CIDR。只有来自可信代理的 `X-Real-IP` / `X-Forwarded-For` 才会用于客户端 IP 判断；
  Steam 登录回调地址同样只信任可信反代的 `X-Forwarded-Host/Proto`。
- **CSP 以 Report-Only 观察中**：全站响应带 `Content-Security-Policy-Report-Only`（`default-src 'self'` + Element Plus 所需的 inline style），
  跑稳后切换成强制。另已具备 `nosniff`、`X-Frame-Options: DENY`、`referrer-policy`、HTTPS 下 HSTS。
- 访客归属地查询可关：`VISITOR_GEO=0`（隐私开关，关闭后访问记录只存 IP）。
- 限流阈值可在 Compose 环境变量中用 `RATE_LIMIT_MAX`、`RATE_LIMIT_ASSET_MAX` 与 `RATE_LIMIT_WINDOW_SEC` 调整；默认值适合单实例，多个实例的请求计数仍各自独立。

## 测试

```bash
node test/log.test.js        # 7 项：JSONL 格式、脱敏、轮转读取、过滤
node test/adapters.test.js   # 5 项：Steam 接口构造与解析
node test/sonkwo.test.js     # 9 项：对着真实页面快照解析（含"别取错版本价"）
node test/gog.test.js        # 11 项：标题归一化、精确匹配、拒绝模糊结果、折扣计算
node test/humble.test.js     # 9 项：slug 生成、JSON-LD 解析、名称校验、重定向与 404
node test/steam-meta.test.js # 15 项：appid 解析、双后端归一化、官方不可用时自动回落
node test/proxy.test.js      # 10 项：代理决策、NO_PROXY、密码脱敏、本地代理真实转发
node test/proxy-pool.test.js # 8 项：多条解析、候选顺序、冷却阶梯、健康文件脱敏、设置校验、健康 API
node test/http-proxy-failover.test.js # 7 项：真实转发链路的故障切换（断言两次尝试代理不同）、5xx/429 不切换
node test/http-error.test.js # 8 项：代理隧道错误翻译（407/403/502）、code=0 不误判、真实 ProxyAgent
node test/favicon.test.js    # 4 项：三个页面的图标引用一致且文件存在、SVG/ICO/PNG 格式合法
node test/serve.test.js      # 5 项：路径穿越防护、内容类型、GET/HEAD/405
node test/discover.test.js   # 9 项：扫描区间、连续空壳停止、404 容错、合并去重
node test/match.test.js      # 11 项：名称归一化、bigram 相似度、候选挑选、阈值分级
node test/compare.test.js    # 7 项：分区、同币种比较、终端渲染
node test/regions.test.js    # 4 项：跨区报价存储与 C2C 隔离（真 PG）
node test/store.test.js      # 12 项：URL 解析、建库 SQL、真 TCP PG 协议下自动建库
node test/merge.test.js      # 5 项：合并重复游戏行（报价/快照/日聚合/关注）
node test/gamemeta.test.js   # 6 项：元数据只补空缺、不覆盖人工维护的名字
node test/pg.test.js         # 11 项：真 PG 语义（PGlite）跑建表/入库/去重/主榜/史低
node test/report.test.js     # 14 项：SVG 图表、转义、空数据、静态站点端到端
node test/alerts.test.js     # 8 项：到价判定、同价位去重、简报、webhook 失败不抛
node test/notify.test.js     # 10 项：通道发现、MIME 编码、假 SMTP 协议对话、企业微信 errcode
node test/watchlist.test.js  # 5 项：关注表 CRUD、候选查询、标记后不再提醒、级联删除
node test/scheduler.test.js  # 13 项：调度时刻表、首轮错开、参数透传、熔断
node test/visitors.test.js   # 5 项：IP/CIDR 校验、记录落库与过滤、黑名单 403 拦截、权限隔离
node test/sync-runs.test.js  # 2 项：同步任务记录生命周期、重启中断标记、状态接口权限
node test/pool.test.js       # 4 项：并发上限、结果顺序、单项失败隔离
node test/version.test.js    # 4 项：版本比较、release/tag 回退、缓存与强制刷新
node test/ratelimit.test.js  # 5 项：IP 频率限制三振（10/30 分钟/当天）、白名单豁免、手动解封、禁用
node test/guard.test.js      # 8 项：路径白名单、扫描器签名、编码归一化、未知路径去重、只上报不封禁
node test/reviews.test.js   # 9 项：异常只记录、审批后封 IP/设备、提示页、拦截采样、限流分桶、XFF 防伪造
node test/announcements.test.js # 2 项：公告生效窗口、管理员增改删与公开接口
node test/devices.test.js   # 5 项：设备 ID/字段截断、指纹稳定性、写库节流、设备→指纹映射
node test/store-browse.test.js # 5 项：GetItems 批量请求体、字段映射、分批与缺 key 回退
node test/images.test.js     # 4 项：封面缓存路径安全、原子写、下载失败兜底
node test/settings.test.js   # 8 项：设置定义、密钥加密、env 兜底与水合、SMTP 特殊存储
node test/setup.test.js      # 4 项：首次初始化流程与 SETUP_TOKEN
node test/deploy.test.js     # 23 项：compose/Dockerfile/入口脚本一致性、CRLF 检查
node test/docs.test.js       # 5 项：相对链接有效性、入口文档齐全、README 必备章节、CHANGELOG 格式、许可一致
node test/secrets.test.js    # 5 项：凭据扫描器自身的正确性 + 当前仓库无泄漏
```

共 **427 项**断言（主链 `npm test`，50 个文件；另有 33 项在链外的 `email-auth` / `api` / `cli-dispatch` 三个文件，改相关代码时单独跑）。杉果解析器直接用真实页面快照做夹具，页面结构变化会立刻让测试变红。

发布前额外跑一次凭据扫描（`npm run scan`）：检查 token、私钥、带真实密码的连接串，文档里的示例和占位符不会误报。

## 已知限制

1. **Steam 官方接口在国内网络不可达**（实测 `UND_ERR_CONNECT_TIMEOUT`）。生产环境需配 `STEAM_PROXY`（按主机分流，只让 Steam 域名走代理；自 v2.0.0 支持多条按序自动切换与冷却）；价格回填与热度回填共用 Steam 配额，二者通过后台任务槽位互斥。
   - 元数据导入做了**双后端**：先探官方（5s 超时），不通则自动回落到 `api.steamcmd.net`（Steam PICS 数据镜像）。镜像能给出中文名、封面、发行日期、开发商，但**不提供 `is_free`**，也**不能按名字搜索**（只能给 appid 或商店链接）。
2. **ITAD 响应结构未用真 key 验证**。无 key 时返回 `403 Invalid or expired api key`；结构不符时会记 `adapter.itad.shape_mismatch` 并带原始片段。
3. **热度数据需要先跑一次回填**：新库 `heat` 全为 null，排序退化为原来的折扣优先；部署后执行
   `node src/cli.js heat --limit 200000 --batch 30 --sleep 1700`（约 3 小时，可中断续跑），之后调度器每周增量刷新。
4. **`app_type` 未回填**：目录数因此只能标注「含 DLC/软件」；`type` 只能从 appdetails 全量响应获取（每款约 15KB，全量约 3GB 流量），暂不做。
5. **杉果没有搜索接口**（`store/search` 的 loader 服务端报错、`/api/*` 返回 410），所以 SKU 靠「按 id 探测」发现：id 连续、密度约 70%，未上架的 id 返回 200 空壳页。`discover` 只能跟上前沿，**历史目录要靠一次性回填**（`--from/--to` 指定区间）；空壳页的判定依赖"无价格 + 13KB 通用页"，站点改版需要复核。
6. **杉果商品页里没有 Steam appid**，跨平台对齐只能靠名称匹配：`match` 用 bigram Dice 打分，≥0.94 才自动应用、0.86–0.94 留给人工 `--confirm`。**匹配率取决于游戏库覆盖**；未关联的报价会计入 `ingest.summary.noAppId`。
7. **GOG 的搜索是模糊的**：`like:` 查询对"这家店没有的游戏"会返回无关热门商品。适配器只接受标题完全相等的结果，所以宁可没有价格，也不会把别人的价格挂上去。
8. **Humble 命中率有限**：只能用"按英文名猜 slug → 抓商品页 → 校验名称"的方式，没命中的会静默跳过（日志记 `adapter.humble.no_match`）。
9. **邮件客户端是自实现的**，只覆盖 STARTTLS + AUTH PLAIN/LOGIN，不支持 OAuth2 与附件；协议对话已在本地假 SMTP 服务器上验证，但**未对真实邮件服务商做过端到端测试**。
10. **`web/` 旧页面只作回退**：镜像内有 `frontend/dist` 时全部页面走 Vue 应用；旧零构建页面仅在开发环境（无构建产物）时使用，其中的管理功能不再单独维护。
11. **DLC 拥有数不可得**：Steam 公开 API（`IPlayerService/GetOwnedGames`）只返回游戏、不返回 DLC 拥有记录，
    后台「Steam 账号」不展示 DLC 数（详见 [docs/STEAM-DLC.md](docs/STEAM-DLC.md)）。
12. **PWA 不做离线**：没有 service worker，断网时只给「网络不可用，请检查连接后重试」提示，页面仍需联网加载；
    standalone 里点 Steam 商店等外链会跳出到系统浏览器（买完需手动切回），部分国产 ROM 浏览器不支持独立窗口、
    仍以标签页打开（详见 [docs/MOBILE-PWA.md](docs/MOBILE-PWA.md) §5）。
13. **PWA 版本更新是"半自动"**：停在页面上的旧会话要等切回前台才会出现「已更新到 vX.Y.Z，点击刷新」提示
    （默认不自动刷新，防止丢详情弹窗/搜索输入/表单状态；离线时静默跳过）。这依赖 HTML 的 `cache-control: no-cache`——
    **部署时需确认 nginx 未对 HTML 加 `expires` / `proxy_cache`**，否则重新打开也会拿到旧版。

<!-- TODO-PROGRESS:START -->
## 开发进度

> 本段由 [docs/TODO.md](docs/TODO.md) 自动生成，请勿手改；改完待办状态后运行 `npm run todo:progress` 更新。

**当前版本：v2.7.0** · 进行中 5 · 接下来 2

**进行中**

- `AZ` 异常审核「规则摘要」列精简（首规则 ×n · 共 N 条规则 + hover 弹层） —— 质检通过，待发版
- `BA` 运行与同步页重设计（任务健康条 + 记录精简 + 固定高度日志面板） —— 质检通过，待发版
- `BB` 代理健康主动探测（立即检测按钮 + 每 10 分钟定时任务） —— 质检通过，待发版
- `BC` 封面图补图覆盖率（header_image 补全 + 预取扩大 + 缺图缓存可手动清） —— 质检通过，待发版
- `BD` 后台链接抽屉「最低价」醒目（方案 A：整卡高亮 + 角标） —— 质检通过，待发版

**接下来**

- `BE` 愿望单仅本站（去 Steam 关联 + 前后端清单 + 后台可删不可加） —— 待开发
- `BF` 数据库遗留对象清理（已下线功能的表/列） —— 待开发

**阻塞与待定**

- `AY` AV 读模型上线后性能未达门槛（列表 340ms / 零命中 1.59s / count 163ms） —— 待排查

**最近完成**

- `AX` 异常审核「按 IP 合并」定为默认视图（去掉开关与明细表） —— v2.7.0
- `AW` 封面图回源：404 快失败 + 超时收紧 + 负缓存分层 + header_image 直链 —— v2.7.0
- `AV` 首页列表读模型：game_region_snapshot（把每请求全库聚合改成入库时维护） —— v2.6.0
- `AU` pg_trgm 搜索索引 + 封面图缓存总量上限 + 愿望单诚实口径（AA 方案 A） —— v2.5.0
- `AT` 后台信息架构改版（新增改抽屉 / 操作日志合并 5 tab / 邮件与设置 tab / 价格走势线图） —— v2.4.0
<!-- TODO-PROGRESS:END -->

产品方向与未排期想法见 [docs/ROADMAP.md](docs/ROADMAP.md)；完整排期与依据见 [docs/TODO.md](docs/TODO.md)。

## 项目结构

```
steamdeals/
├── src/
│   ├── adapters/        平台适配器（steam / sonkwo / itad / gog / humble）
│   │   └── sonkwo-discover.js  杉果 SKU 增量发现（按 id 探测）
│   ├── store/           PG 存储层（SQL 与连接池）
│   ├── cli.js           命令行入口
│   ├── scheduler.js     常驻调度（子进程隔离）
│   ├── ingest.js        入库：判重 / 快照 / 日聚合
│   ├── match.js         跨平台名称匹配（bigram Dice 打分）
│   ├── report.js        静态价格页：内联 SVG 图表 + 纯函数渲染
│   ├── alerts.js        降价提醒：判定 / 简报 / webhook 投递
│   ├── log.js           结构化日志
│   ├── http.js          唯一出网点（超时/重试/脱敏/代理分流/观测）
│   ├── proxy.js         出网代理决策（按主机分流 + NO_PROXY + 密码脱敏）
│   ├── visitors.js      访问记录：IP 提取、归属地解析、黑名单内存态
│   ├── steam-login.js   Steam OpenID 登录（state 防 CSRF）、账号归属 schema、库/愿望单拉取
│   ├── steam-accounts.js 多账号同步（差集删除）、愿望单→价提醒对账、认领/解绑
│   ├── probe.js         目标可达性探针
├── frontend/           Vue 3 前端（Vite 构建，页面/组件/composables；dist 不入库）
├── test/               53 个测试文件（主链 50 + 链外 3）+ 真实页面夹具
├── data/               games.json（游戏清单）、skus.json（杉果 SKU）
├── docs/               PROJECT-OVERVIEW / PLAN / ROADMAP / ARCHITECTURE / DATA-SOURCES / DEPLOY / WEB
├── out/                 由 chart 生成的静态页（已 gitignore）
├── scripts/             勘查工具（inspect / mine-bundle / hit）+ 凭据扫描 + 容器入口
├── Dockerfile
├── compose.yaml
└── .env.example
```

## 贡献

这是个人项目，但改动请遵守两条硬规则：

1. **任何改动都要有可执行的验证**（`node test/*.test.js` 必须全绿）。
2. **改采集逻辑必须写日志**：新的事件用 `域.动作` 命名，失败路径必须带上可判断原因的信息。

细节见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可与免责

代码以 [MIT](LICENSE) 协议开源。

价格数据版权归各平台所有，本项目不转售、不重新分发数据。采集为低频个人使用，如相关平台认为不妥，删除对应适配器即可（各平台彼此独立，见 `src/adapters/`）。

本项目不对任何交易的最终结果负责：价格可能延迟、商品可能下架、第三方 key 存在来源风险。**购买前请自行核实。**
