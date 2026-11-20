# 需求批次索引（每次需求讨论的落点总账）

> 用途：回答"聊过的需求到底落实在哪"。**每一批都必须在这里有一行**：规格文档 + TODO 条目 + 开发描述。
> 状态口径：`已发布` / `待开发` / `待排查` / `待决策`。
> 维护规则：新增一批需求时，先在 [TODO.md](TODO.md) 建条目，再回本表加一行；**没有规格文档的批次不允许标"已确认"**。

## 已发布（有规格、有 TODO、已上线）

| 编号 | 主题 | 规格 | 发布版本 |
|---|---|---|---|
| Q | 后台列表批量操作 | [ADMIN-BULK-ACTIONS.md](ADMIN-BULK-ACTIONS.md) | v1.14.0 |
| R | 封禁页守卫 | [BAN-PAGE-GUARD.md](BAN-PAGE-GUARD.md) | v1.14.1 |
| S | 封禁与安全修复（入口收敛 + 黑白名单 + 待审口径） | [BAN-AND-SECURITY-FIXES.md](BAN-AND-SECURITY-FIXES.md) | v1.14.2 |
| T | URL 参数隐私化 | [URL-PARAM-PRIVACY.md](URL-PARAM-PRIVACY.md) | v1.14.2 |
| U | 同步状态 + 锁国区 + 内容分级 | [STEAM-SYNC-STATUS-AND-RATING.md](STEAM-SYNC-STATUS-AND-RATING.md) | v1.15.0 |
| V | 分级筛选 + backfill 合并写分级 | 同上 §13/§14 | v1.15.1 |
| W | 手机端 PWA（standalone / 返回键 / 网络提示） | [MOBILE-PWA.md](MOBILE-PWA.md) | v1.16.0 |
| X | 调度器长任务阻塞修复 | [SCHEDULER-BLOCKING-FIX.md](SCHEDULER-BLOCKING-FIX.md) | v1.16.1 |
| Z | 手机端适配（vw 逃逸 / 安装提示 / 后台卡片化） | [MOBILE-FIX.md](MOBILE-FIX.md) | v1.16.2 |

> X 批是唯一把开发描述也存进文档的一批：[HANDOVER-X-SCHEDULER.md](HANDOVER-X-SCHEDULER.md)。
> Z 批的开发描述只在对话里给过，规格已足够自包含。

## 待开发 / 待排查 / 待决策

| 编号 | 主题 | 规格 | 状态 | 开发描述 |
|---|---|---|---|---|
| **AB** | Steam 状态判定整轮静默不写库（JSON 取错） | [STEAM-STATUS-FIX.md](STEAM-STATUS-FIX.md) | 已发布 v1.16.4 + **生产验证通过**（wrote=5/ok=5） | ✅ 已在对话给出 |
| **Y** | 补 `steamStatus.initialDelaySec` 设置项 | 并入 [STEAM-STATUS-FIX.md](STEAM-STATUS-FIX.md) §3-F | 已发布 v1.16.4（随 AB） | 随 AB |
| **AD** | 搜索支持中英文（含平台中文别名） | [SEARCH-I18N.md](SEARCH-I18N.md) | 已发布 v1.17.0（服务器仍 1.16.4，待部署验收） | ✅ 已在对话给出 |
| **AA** | 添加愿望单推送失败 | [WISHLIST-FIX.md](WISHLIST-FIX.md) | 方案 A 已发布 v2.5.0（2026-11-09，随 AU） | ✅ 本轮已给 |
| **AU** | pg_trgm 搜索索引 + 封面图缓存上限 + 愿望单诚实口径（AA 方案 A） | [ROADMAP.md](ROADMAP.md) / [WISHLIST-OAUTH.md](WISHLIST-OAUTH.md) | 已发布 v2.5.0（2026-11-09） | ✅ 本轮已给 |
| **AV** | 首页列表读模型 `game_region_snapshot`（每请求全库聚合 → 入库时维护） | [READ-MODEL.md](READ-MODEL.md) | 已发布 v2.6.0（2026-11-10） | ✅ 本轮已给 |
| **AW** | 封面图回源：404 快失败 + 超时收紧 + 负缓存分层 + `header_image` 直链 | [IMAGE-FETCH.md](IMAGE-FETCH.md) | 已发布 v2.7.0（2026-11-10） | ✅ 本轮已给 |
| **AX** | 异常审核「按 IP 合并」定为默认视图（去开关、去明细表、不做逐条处置） | [ADMIN-REVIEW-LISTS.md](ADMIN-REVIEW-LISTS.md) §4.5 | 已发布 v2.7.0（2026-11-10） | ✅ 本轮已给 |
| **AY** | AV 读模型上线后性能未达门槛（列表 340ms / 零命中 1.59s / count 163ms） | [READ-MODEL.md](READ-MODEL.md) §12 | 已发布 v2.10.1（2026-11-11；性能待部署复测） | ✅ 本轮已给 |
| **AZ** | 异常审核「规则摘要」列精简（首规则 ×n · 共 N 条规则 + hover 弹层） | [ADMIN-REVIEW-LISTS.md](ADMIN-REVIEW-LISTS.md) §4.6 | 已发布 v2.8.0（2026-11-10） | ✅ 本轮已给 |
| **BA** | 运行与同步页重设计（任务健康条 + 记录精简折叠 + 固定高度日志面板） | [RUN-SYNC-REDESIGN.md](RUN-SYNC-REDESIGN.md) | 已发布 v2.8.0（2026-11-10） | ✅ 本轮已给 |
| **BB** | 代理健康主动探测（立即检测按钮 + 每 10 分钟定时任务） | [PROXY-POOL.md](PROXY-POOL.md) §11 | 已发布 v2.8.0（2026-11-10） | ✅ 本轮已给 |
| **BC** | 封面图补图覆盖率（header_image 补全 + 预取扩大 + 缺图缓存可手动清） | [IMAGE-COVERAGE.md](IMAGE-COVERAGE.md) | 已发布 v2.8.0（2026-11-10） | ✅ 本轮已给 |
| **BD** | 后台链接抽屉「最低价」醒目（方案 A：整卡高亮 + 角标） | [ADMIN-LINKS-DRAWER.md](ADMIN-LINKS-DRAWER.md) §12 | 已发布 v2.8.0（2026-11-10） | ✅ 本轮已给 |
| **BE** | 愿望单仅本站：去 Steam 关联 + 前后端清单 + 后台可删不可加 | [WISHLIST-SITE-ONLY.md](WISHLIST-SITE-ONLY.md) | 已发布 v2.9.0（2026-11-10） | ✅ 本轮已给 |
| **BF** | 数据库遗留对象清理（已下线功能的表/列） | [DB-LEGACY-CLEANUP.md](DB-LEGACY-CLEANUP.md) | 已发布 v2.10.1（2026-11-11） | ✅ 本轮已给 |
| **BG** | BUG：站点通知页未编辑即误报「未保存的修改」 | [UNSAVED-GUARD.md](UNSAVED-GUARD.md) §11 | 已发布 v2.10.1（2026-11-11） | ✅ 本轮已给 |
| **BH** | 访问记录按 IP 统计（访问明细默认 IP 视图 + 黑白名单统计列 + 设备按设备码） | [VISIT-IP-STATS.md](VISIT-IP-STATS.md) | 已发布 v2.9.0（2026-11-10） | ✅ 本轮已给 |
| **BI** | 访问明细 IP 统计：自动临时封禁显示（封禁中 + 剩余时间）与状态筛选 | [VISIT-IP-STATS.md](VISIT-IP-STATS.md) §8 | 已发布 v2.10.0（2026-11-11） | ✅ 本轮已给 |
| **BJ** | 黑名单 IP 不再写入自动封禁 + 自动封禁记录默认口径（生效中/状态列/已在黑名单）+ 解封语义拆分 | [BAN-AND-SECURITY-FIXES.md](BAN-AND-SECURITY-FIXES.md) §10 | 已发布 v2.10.2 | ✅ 本轮已给 |
| **BK** | 会话治理（BK-1 禁用/计数/过期清理 · BK-2 会话列表+踢下线 · BK-3 空闲超时/IP·UA 绑定/退出其它设备） | [SESSION-MANAGEMENT.md](SESSION-MANAGEMENT.md) | 已发布 v2.11.0 | ✅ 本轮已给 |
| **BL** | 增量回填吞吐与配额治理（候选去噪 · 429 软退出+1 小时重排 · 每日 5000 · 连续失败跳过 · 观测） | [BACKFILL-THROUGHPUT.md](BACKFILL-THROUGHPUT.md) | 已发布 v2.11.1（2026-11-13） | ✅ 本轮已给 |
| **BM** | BUG：登录页硬跳 404（/login 未登记 SPA 回退）+ 会话失效跳转口径（软跳 + 心跳） | [SESSION-MANAGEMENT.md](SESSION-MANAGEMENT.md) §8 | 已发布 v2.12.0（2026-11-13） | ✅ 本轮已给 |
| **BN** | BUG：价格历史区块整个不渲染（`v-for`+`v-if` 同元素导致渲染抛错） | [PRICE-HISTORY-REPORT.md](PRICE-HISTORY-REPORT.md) §10 | 已发布 v2.12.1（2026-11-13） | ✅ 本轮已给 |
| **BO** | 价格历史删掉日期表格 + 趋势线加高到 150px（含史低参考线/轴标签，方案 B） | [PRICE-HISTORY-REPORT.md](PRICE-HISTORY-REPORT.md) §11 | 已发布 v2.13.0（2026-11-13） | ✅ 本轮已给 |
| **BP** | 游戏详情·DLC 总数与**内联列表**（分页 10 + Steam 商店跳转；**不含拥有状态**——Steam API 不提供） | [GAME-DLC.md](GAME-DLC.md) | 已发布 v2.14.0（2026-11-13） | ✅ 本轮已给 |
| **O** | 申诉系统改造（站内提交入库 + 后台申诉管理 + 处理结果回信；每 IP 3 条/小时 + 验证码 + 幂等） | [APPEAL-SYSTEM.md](APPEAL-SYSTEM.md) §1–§9 / [DEV-BRIEF-APPEAL.md](DEV-BRIEF-APPEAL.md) | 已发布 v2.16.0（2026-11-14） | ✅ 本轮已给 |
| **BQ** | 申诉邮件内一键「信任 / 封禁」（确认页 + 一次性 token，14 天有效；收件人沿用申诉邮箱） | [APPEAL-SYSTEM.md](APPEAL-SYSTEM.md) §10 / [DEV-BRIEF-APPEAL.md](DEV-BRIEF-APPEAL.md) | 已发布 v2.16.0（2026-11-14，随 O 同批） | ✅ 本轮已给 |
| **BR** | 封禁自助恢复 + 手机/CGNAT 适配（加白即清封、`ban/state` 自查三件套、封禁页可读、页面/API 分桶） | [BAN-AND-SECURITY-FIXES.md](BAN-AND-SECURITY-FIXES.md) §11 | 已发布 v2.16.0（2026-11-14） | ✅ 本轮已给 |
| **BS** | 安卓 App（TWA，不上架）+ 可清缓存离线 + 双通道分发（**APK 入库随镜像**，站点/GitHub 都能下；不做推送与角标） | [MOBILE-APP-TWA.md](MOBILE-APP-TWA.md) | 已发布 v2.17.0（2026-11-14；已被 CA 取代，TWA 停发） | ✅ 本轮已给 |
| **BT** | 手机端点「登录」不出现登录页（浮层 `history.back()` 与 `router.push` 竞态）→ 登录入口统一硬跳 + chunk 兜底 | [MOBILE-LOGIN-ENTRY-FIX.md](MOBILE-LOGIN-ENTRY-FIX.md) | 已发布 v2.18.0（2026-11-16，eba879c） | ✅ 本轮已给 |
| **BU** | 移动端登录页重做（大表单 + 键盘避让 + 验证码/下载入口） | [MOBILE-REDESIGN.md](MOBILE-REDESIGN.md) §3 / §10 效果图 | 已过时（2026-11-16 被 CA 取代） | ✅ 本轮已给 |
| **BV** | 前台移动端重设计（底部 Tab：首页/搜索/愿望单/我的；详情全屏页） | [MOBILE-REDESIGN.md](MOBILE-REDESIGN.md) §4 / §10 效果图 | 已过时（2026-11-16 被 CA 取代） | ✅ 本轮已给 |
| **BW** | 后台移动端重设计（☰ 抽屉 + 表格全卡片 + 批量吸底 + 表单全屏） | [MOBILE-REDESIGN.md](MOBILE-REDESIGN.md) §5 / §10 效果图 | 已发布 v2.18.0（2026-11-16，605e05a + 打回修复 8817207） | ✅ 本轮已给 |
| **BX** | 手机浏览器首访「下载安卓 App」提示（只安卓、一次、可关闭） | [MOBILE-REDESIGN.md](MOBILE-REDESIGN.md) §6 | 已过时（2026-11-16 被 CA 取代） | ✅ 本轮已给 |
| **BY** | 安卓 App 内置更新（启动/回前台检查 → 原生提示 → 下载校验 → 用户确认安装；minVersionCode 强制） | [MOBILE-APP-UPDATE.md](MOBILE-APP-UPDATE.md) | 已发布 v2.18.0（2026-11-16，92cae3e + 打回修复 8585dba） | ✅ 本轮已给 |
| **BZ** | App 代码仓库拆分（`android/` 迁独立公开仓库；站点 CI 拉 Release 出 `latest.json`；规格/TODO 留站点） | [MOBILE-APP-REPO-SPLIT.md](MOBILE-APP-REPO-SPLIT.md) | 已过时（CA 直接新建独立仓库） | ✅ 本轮已给 |
| **CA** | 原生 Android 的站点侧（Token/API + Web 手机端改造；Android 工程见 CG） | [APP-NATIVE.md](APP-NATIVE.md) §3/§5 + [APP-API.md](APP-API.md) | 已发布 v2.22.0（2026-11-17） | ✅ 本轮已给 |
| **CG** | 原生 Android App（CA-2~4，独立仓库 `steamdeals-app`；六屏/游客/登录后自动完成/启动封禁提示/内置更新） | [APP-NATIVE.md](APP-NATIVE.md) §4 | 已发布 app-v2.19.0（2026-11-17，App 仓库 tag + Release） | ✅ 本轮已给 |
| **CB** | 价格报表邮件 HTML 化 + 内容增强（品牌头/KPI/降价 Top5/涨价 Top3/7 天趋势/CTA；multipart 文本兜底） | [PRICE-REPORT-EMAIL.md](PRICE-REPORT-EMAIL.md) | 已发布 v2.18.0（2026-11-16，c5fc536 + 打回修复 becff89） | ✅ 本轮已给 |
| **CC** | 多源采集推进：ITAD/GOG/Humble 覆盖全目录（游标/状态 + 命中缓存）+ 后台四源触发 | [SOURCE-SYNC-COVERAGE.md](SOURCE-SYNC-COVERAGE.md) | 已发布 v2.19.0（2026-11-16，12f4f42） | ✅ 本轮已给 |
| **CD** | 跨平台对齐（杉果 + ITAD）：英文名/Steam 链接反解 + 调度化 + **对齐审核页（去重分组/合并预览/决定继承）** + 映射落库 | [SONKWO-STEAM-MATCH.md](SONKWO-STEAM-MATCH.md) | 已发布 v2.21.0（2026-11-17，e5fced8） | ✅ 本轮已给 |
| **CF** | 后台体验与安全策略（申诉布局 / Steam 账号重复渲染修复 / 指标压缩 / 自动封禁收紧 + 审核证据） | [ADMIN-UX-SECURITY.md](ADMIN-UX-SECURITY.md) | 已发布 v2.21.0（2026-11-17，31483fb） | ✅ 本轮已给 |
| **CH** | 个性化推荐 + Deck 认证 + 好评率（借鉴 steam-deals；免费角标/行为学习搭车） | [DISCOVERY-FOR-YOU.md](DISCOVERY-FOR-YOU.md) | 已发布 v2.21.0（2026-11-17，b575dcc） | ✅ 本轮已给 |
| **CI** | 价格提醒邮件 HTML 化 + 申诉管理页视觉对齐（分段控件/空态/表格列/间距） | [ALERT-MAIL-APPEAL-UX.md](ALERT-MAIL-APPEAL-UX.md) | 已发布 v2.22.0（2026-11-17，docs/QA-CI.md ✅） | ✅ 本轮已给 |
| **CJ** | 安卓版 App 发版后 /app 页自动更新（GitHub Release 同步 + 站点自托管 + 兜底） | [APP-AUTO-UPDATE-PAGE.md](APP-AUTO-UPDATE-PAGE.md) | 已发布 v2.22.0（回归修复 b726af4 随 v2.22.1；质检 ✅） | ✅ 本轮已给 |
| **CK** | e2e 测试套件（功能矩阵 + headless Edge + Android 模拟器/真机 + 公网只读 + PDF 报告） | [E2E-SUITE.md](E2E-SUITE.md) | 已发布 v2.24.0（2026-11-17，QA docs/QA-E2E-SUITE-CK.md ✅） | ✅ 本轮已给 |
| **CL** | 用户级到价提醒（列表页 + 已拥有终态隐藏 + 后台全站清单 + 详情页三段式 UI） | [USER-ALERTS.md](USER-ALERTS.md) | 已发布 v2.23.0（2026-11-17，e196382；QA ✅ docs/QA-CL.md） | ✅ 本轮已给 |
| **CM** | App 功能补齐（开发商 JSON 修复 / DLC 列表 / 价格历史区间与指标 / 复制名；CM-5 筛选服务端化二期） | [APP-PARITY.md](APP-PARITY.md) | 已发布 v2.24.0（站点侧，2026-11-17；QA docs/QA-CM.md ✅；App 侧 app-v2.20.0 待指令） | ✅ 本轮已给 |
| **CN** | 对齐审核查询拖垮站点（缓存 + 候选预筛 + 单飞 + 时间预算 + 分页） | [ALIGN-QUERY-PERF.md](ALIGN-QUERY-PERF.md) | 已发布 v2.24.1（2026-11-17，5c723aa + 2060586；QA ✅ docs/QA-CN.md） | ✅ 本轮已给 |
| **CO** | 设计审计技术债清理（15 项 → CO-1~CO-4 四批，每日至少推进 1 条） | [DESIGN-AUDIT.md](DESIGN-AUDIT.md) | CO-2 已发布 v2.24.4（2026-11-18，75a7e7f，QA docs/QA-CP-CT-CO2.md：B1 统一超时+并发闸、B2 admin 列表提速）；CO-3 已发布 v2.24.4（2026-11-18，89c8dfd，QA docs/QA-CO3.md：C2 设备限流、C4 日期金额 helper、C5 契约校验）；CO-1/A5 已发布 v2.24.5（2026-11-18，c4e2695，QA docs/QA-CO1-A5.md 第 1 轮 ✅：任务失败健康条显红 + 失败原因可见 + 可选邮件告警）；CO-2/B5 已发布 v2.24.5（2026-11-18，5b1cbfb，QA docs/QA-B5.md 第 1 轮 ✅：快照唯一写入路径 + 增量对账 + 每日自动修复）；CO-4/D1 已发布 v2.24.5（2026-11-18，2ee09af，QA docs/QA-D1.md 第 1 轮 ✅：四族设计 token 落 main.css + 三个最重组件试点）；CO-1/A3 已发布 v2.25.0（2026-11-19，6a9ecc3，QA docs/QA-CO1-A3.md ✅：库为唯一真相、skus.json 只读兼容）；CO-2/B3 已发布 v2.25.0（2026-11-19，7a324b0，QA docs/QA-CO2-B3.md ✅：任务预算实测耗时）；CO-4/D4 已发布 v2.26.0（2026-11-19，56d8573，QA docs/QA-D4.md 第 1 轮 ✅）；CO-4/D6 已发布 v2.26.0（2026-11-19，40517d5，QA docs/QA-D6.md 第 1 轮 ✅）；CO-4/E4 已发布 v2.26.0（2026-11-19，551f4b1 + e5cfef1，QA docs/QA-CO4-E4.md ✅ 放行 4/0/0/1）；CO-4/B4 已发布 v2.27.1（2026-11-19，试点 App 域 0c8f5ff + 第二轮申诉域 34a7bcc；QA docs/QA-CO4-B4.md 第 1/2 轮 ✅ 16/0/0/1：已交付 app/appeal 两域，契约零变化）；CO-5/B4-2 已发布 v2.27.2（2026-11-19，00a838f + 8867077 + d779b69；QA docs/QA-CO5-B4-2.md 第 1 轮 ✅ 16/0/0/1：认证域已交付，契约零变化）；CO-5/B4-2 第九轮（#9 admin 同步任务域）已发布 v2.27.6（2026-11-20，3997083；QA docs/QA-CO5-B4-2-admin-sync.md 第 1 轮 ✅ 14/0/0/1：已交付九域，契约零变化）；E1 文档归档已完成（不进版本） | ✅ 本轮已给 |
| **CP** | 手机端识别增强（Sec-CH-UA-Mobile + 前端 screen.width 兜底，修小米浏览器桌面 UA 漏判） | [MOBILE-DETECT-FIX.md](MOBILE-DETECT-FIX.md) | 已发布 v2.24.4（2026-11-18，75a7e7f；QA docs/QA-CP-CT-CO2.md 第 1 轮） | ✅ 本轮已给 |
| **CQ** | 系统设置信息架构重构（平台卡片 + 常用/高级折叠 + 只看非默认/来源/恢复默认） | [SETTINGS-IA.md](SETTINGS-IA.md) | 已发布 v2.25.0（2026-11-19，QA docs/QA-CQ.md 第 3 轮 ✅；实现 6850e5b + 修复 b705824/50f5e45） | ✅ 本轮已给 |
| **CS** | 对齐审核二次修复（事件循环阻塞观测 + 首屏后台化；补齐 CN 未进镜像问题；DB 侧已验证 91ms 无需索引） | [ALIGN-DB-SLOW.md](ALIGN-DB-SLOW.md) | 已发布 v2.24.3（2026-11-18，2a03188；QA ✅ docs/QA-CS-CV.md） | ✅ 本轮已给 |
| **CT** | app-release-sync 404 → 改用 releases 列表接口取最新（仓库已公开，无需 token；日志区分失败原因） | [APP-SYNC-404.md](APP-SYNC-404.md) | 已发布 v2.24.4（2026-11-18，9312054；QA docs/QA-CP-CT-CO2.md 第 1 轮） | ✅ 本轮已给 |
| **CU** | 到价提醒治理（无报价标记 / 站点级按 Steam 愿望单反查并迁移 / 史低抽检 / Steam 刷新频率评估） | [USER-ALERTS-GOVERNANCE.md](USER-ALERTS-GOVERNANCE.md) | 已发布 v2.26.0（2026-11-19；CU-1 b5f5663+77c9f8f，QA-CU1 第 2 轮 ✅ 3/0/0/1；CU-2 b7ab402，QA-CU2 ✅ 5/0/0/2；CU-3 规格 §6 附录，QA-CU3 ✅ 4/0/0/2；CU-4 规格 §7 评估未改配置，QA-CU4 ✅ 4/0/0/1——四项全部交付） | ✅ 本轮已给 |
| **CV** | 所有查询不再排除已拥有（列表+搜索 owned=include；已拥有显示账号与终态按钮；App 对齐） | [APP-SEARCH-OWNED.md](APP-SEARCH-OWNED.md) | 已发布 v2.24.3（2026-11-18，站点 2a03188 + App 0945006；QA ✅ docs/QA-CS-CV.md） | ✅ 本轮已给 |
| **CW** | 后台「游戏目录」点游戏名弹详情（Steam 已同步数据 + 封面/发售/开发商 + 底部 Steam 商店跳转） | [ADMIN-GAME-POPUP.md](ADMIN-GAME-POPUP.md) | 已发布 v2.25.0（2026-11-19，实现随 b9811f8 入 main；QA docs/QA-CW.md ✅） | ✅ 本轮已给 |
| **CX** | 个人资料编辑（Web + App；头像存库、双 Steam 账号默认头像、设为默认/解绑/新增换绑） | [USER-PROFILE-EDIT.md](USER-PROFILE-EDIT.md) | 已发布 v2.25.0（2026-11-19，QA docs/QA-CX.md ✅；站点随 b9356aa/93e1241/2f01b59 入 main + App 6f68e81） | ✅ 本轮已给 |
| **CY** | 数据隔离（用户私有数据管理员只读；越权 403 + 审计；站点级/账号安全/申诉保留可写） | [DATA-ISOLATION.md](DATA-ISOLATION.md) | 已发布 v2.25.0（2026-11-19，QA docs/QA-CY.md 第 1 轮 ✅；实现 3351f9f） | ✅ 本轮已给 |
| **CZ** | 更换登录邮箱（邮箱体系收尾；验证码登录/忘记密码已实现，只做换邮箱+加固） | [EMAIL-CHANGE.md](EMAIL-CHANGE.md) | 已发布 v2.25.0（2026-11-19，QA docs/QA-CZ.md 第 1 轮 ✅；站点 ac52955 + App 7c01820） | ✅ 本轮已给 |
| **DA** | CM-5：App 筛选/排序服务端化（折扣/史低/免费/未发售全库筛；站点 + App 方案 A） | [APP-FILTER-SERVER-SIDE.md](APP-FILTER-SERVER-SIDE.md) | 已发布 v2.25.0（2026-11-19，QA docs/QA-DA.md 第 1 轮 ✅；实现站点 b46669a + App 4334823） | ✅ 本轮已给 |
| **DB** | ~~个人主页（公开资料页）~~ → **已过时**：合并进 CX（仅本人可见的「我的资料」） | [USER-PROFILE-EDIT.md](USER-PROFILE-EDIT.md) | 已过时（2026-11-18 取消公开页） | — |
| **DC** | CM-6：App 公告角标与公告列表（铃铛入口/全量未读/游客本地已读） | —（TODO DC 条目） | 已发布 v2.25.0（2026-11-19，App 仓库 ef17e9a；QA docs/QA-DC.md ✅） | ✅ 本轮已给 |
| **DE** | 对齐审核页改版（统计卡/进度条/搜索筛选/批量/空态互斥） | [ALIGN-REVIEW-UI.md](ALIGN-REVIEW-UI.md) | 已发布 v2.24.4（2026-11-18，318e678 + 修复 729d0e9；QA docs/QA-DE.md——通过 7/偏差 1 已修/需人工确认 1） | ✅ 本轮已给 |
| **DF** | 到价提醒手动推送（每行「推送」；强制推送/更新去重时间/频控/审计） | [ALERT-MANUAL-PUSH.md](ALERT-MANUAL-PUSH.md) | 已发布 v2.26.0（2026-11-19，实现 578f063，QA docs/QA-DF.md 第 1 轮 ✅ 9/0/0/2） | ✅ 本轮已给 |
| **DG** | 对齐匹配修复（副标题/别名低分 → 无候选；索引补 name_en + 副标题感知） | —（TODO DG 条目） | 已发布 v2.24.5（2026-11-18，afc5a91 + 12a6de7；QA docs/QA-DG.md 第 1 轮 ✅） | ✅ 本轮已给 |
| **DH** | 对齐审核数据完整性（继承缺口/已忽略撤销/审阅痕迹/孤儿行合并提示） | [ALIGN-INTEGRITY.md](ALIGN-INTEGRITY.md) | 已发布 v2.25.0（2026-11-19，d3c67ec + 修复 cc8e351；QA docs/QA-DH.md 第 2 轮 ✅） | ✅ 本轮已给 |
| **DI** | 测试环境隔离与主链分段（A 测试隔离 / B 四段主链 / C 环境复位脚本） | [TEST-ENV-ISOLATION.md](TEST-ENV-ISOLATION.md) | 已发布 v2.24.5（2026-11-18，3acd1b8；QA docs/QA-DI.md ✅） | ✅ 本轮已给 |
| **CR** | 开发商/发行商名称脏数据修复（GetItems 归一化 + 历史清洗 + API 契约字符串数组） | [APP-DEV-PUBLISHER-NAMES.md](APP-DEV-PUBLISHER-NAMES.md) | 已发布 v2.24.1（2026-11-18，5673ee9；QA ✅ docs/QA-CR.md） | ✅ 本轮已给 |
| **CE** | 杉果匹配器加固 + 误合并数据修复（完整标题计分/片段限制/数字一致性/内容词只进人工/`--apply` 二次确认） | [SONKWO-STEAM-MATCH.md](SONKWO-STEAM-MATCH.md) §9 | 已发布 v2.19.0（2026-11-16，12f4f42；QA 报告 docs/QA-CE.md） | ✅ 本轮已给 |
| **AT** | 后台信息架构改版（新增改抽屉 / 操作日志 5 tab / 邮件与设置 tab / 价格走势线图） | [ADMIN-CONSOLE-IA.md](ADMIN-CONSOLE-IA.md) | 已发布 v2.4.0（2026-11-09） | ✅ 本轮已给 |
| **AC** | 同步不可达的未保证项（AC1–AC11） | [SYNC-FAILURE-MODES.md](SYNC-FAILURE-MODES.md) | AC-1 已发布 v1.18.0；AC-2/AC-3/AC-4 已发布 v2.1.0（2026-11-09） | ✅ 已在对话给出 |
| **AE** | 版本检测按服务器 IP 选镜像仓库（TCR/Hub） | [VERSION-SOURCE.md](VERSION-SOURCE.md) | 已发布 v1.18.0 | ✅ 已在对话给出 |
| **AF** | 愿望单/标记操作后列表不刷新（搜索缓存未失效） | [FRONTEND-STALE-LIST.md](FRONTEND-STALE-LIST.md) | 已发布 v1.18.0 | ✅ 已在对话给出 |
| **AG** | 后台平台链接抽屉 + 游戏名点击复制（后台/前台） | [ADMIN-PLATFORM-LINKS.md](ADMIN-PLATFORM-LINKS.md) | 已发布 v1.18.0 | ✅ 已在对话给出 |
| **AH** | 用户彻底删除（硬删除 + 最近删除审计） | [USER-LIFECYCLE.md](USER-LIFECYCLE.md) | 已发布 v2.0.0（2026-11-06） | ✅ 已在对话给出 |
| **AI** | 邮件模板化 + HTML 邮件 + 发送记录 | [USER-LIFECYCLE.md](USER-LIFECYCLE.md) | 已发布 v2.0.0（2026-11-06） | ✅ 已在对话给出 |
| **AJ** | 账号变更通知（7 类操作 / 8 类邮件） | [USER-LIFECYCLE.md](USER-LIFECYCLE.md) | 已发布 v2.0.0（2026-11-06） | ✅ 已在对话给出 |
| **AK** | 密码系统重设计（AK-1 策略/哈希、AK-2 登录防护、AK-3 账号流程） | [AUTH-REDESIGN.md](AUTH-REDESIGN.md) | AK-1/AK-2/AK-3 已发布 v2.1.0（2026-11-09） | ✅ 规格自包含（按 §8 顺序派发） |
| **AL** | 登录 / 注册 / 改密页面 | [AUTH-REDESIGN.md](AUTH-REDESIGN.md) | 已发布 v2.1.0（2026-11-09） | ✅ 规格自包含（按 §8 顺序派发） |
| **AM** | Steam 代理池（多代理按序切换 + 健康状态） | [PROXY-POOL.md](PROXY-POOL.md) | AM-1 已发布 v2.0.0（2026-11-06）；AM-2 已发布 v2.1.0（2026-11-09） | ✅ 规格自包含（按 §8 顺序派发） |
| **AN** | 未保存修改的离开提醒（后台 5 个编辑面） | [UNSAVED-GUARD.md](UNSAVED-GUARD.md) | 已发布 v2.1.0（2026-11-09） | ✅ 规格自包含 |
| **AO** | 后台游戏列 + 平台链接抽屉改版（复制中英文 / 抽屉重做） | [ADMIN-LINKS-DRAWER.md](ADMIN-LINKS-DRAWER.md) | 已发布 v2.2.0（af70754） | ✅ 规格自包含 |
| **AP** | 游戏详情·价格历史报表（趋势线 + 史低高亮） | [PRICE-HISTORY-REPORT.md](PRICE-HISTORY-REPORT.md) | 已发布 v2.2.0（282d018） | ✅ 规格自包含 |
| **AQ** | 后台访问/异常列表排序（数值 IP + 上限 500） | [ADMIN-REVIEW-LISTS.md](ADMIN-REVIEW-LISTS.md) §3 | 已发布 v2.2.0（2026-11-09，8a20304） | ✅ 规格自包含 |
| **AR** | 异常审核「按 IP 合并」视图 | [ADMIN-REVIEW-LISTS.md](ADMIN-REVIEW-LISTS.md) §4 | 已发布 v2.2.0（2026-11-09，0aa6842） | ✅ 规格自包含 |
| **AS** | README 开发进度摘要（自动生成） | [TODO-PROGRESS.md](TODO-PROGRESS.md) | 已发布 v2.3.0（de71311）；**2026-11-12 已下线**（方案 B：删生成块/脚本/CI/测试） | ✅ 规格自包含 |
| **F** | Steam 价格同步优化（缩量 / 热点优先） | 计划写在 [TODO.md](TODO.md) F 段 | 已发布 v2.2.1（f32e2b9） | ✅ 按 F 段方案实现 |
| **C1** | heat 逐 appid 全 `success:false` | 无独立规格（[TODO.md](TODO.md) C 段定案） | 已发布 v2.2.0（2026-11-09，b01aaf8 修复） | ✅ 已在对话给出 |
| **DJ** | 发版测试报告独立会话 + e2e 整轮总预算 | [E2E-SUITE.md](E2E-SUITE.md) | 已发布 v2.24.5（2026-11-18，c87dfe0；QA docs/QA-DJ.md 第 1 轮 ✅） | ✅ 本轮已给 |
| **DK** | App 检查更新失败：apkPath 缺 GitHub 直链兜底 + App 提示区分 | 本条目 + [APP-AUTO-UPDATE-PAGE.md](APP-AUTO-UPDATE-PAGE.md) | 已发布 v2.25.0（2026-11-19，站点 d65542f + App 仓库 8fb6328；QA docs/QA-DK.md 第 1 轮 ✅） | ✅ 本轮已给 |
| **DL** | 对齐审核快照落库（后台生成 + 数据签名动态失效 + 操作即时更新快照 + 前台只读） | [ALIGN-SNAPSHOT.md](ALIGN-SNAPSHOT.md) | 已发布 v2.27.0（2026-11-19，实现 1e49eeb；QA docs/QA-DL.md 第 1 轮 ✅ 9/0/0/0） | ✅ 本轮已给 |
| **DM** | 对齐审核批量操作超时：短期补丁 | 并入 [ALIGN-SNAPSHOT.md](ALIGN-SNAPSHOT.md) | 已过时（2026-11-19 所有者要求彻底解决，并入 DL） | — |
| **DP** | e2e 浏览器从 Edge 换成 Chrome（headless Chrome + Edge 回退） | 本交接 + [E2E-SUITE.md](E2E-SUITE.md) + [TESTING-E2E.md](TESTING-E2E.md) | 已发布 v2.27.0（2026-11-19，实现 24780ef；QA docs/QA-DP.md 第 1 轮 ✅ 4/0/0/0） | ✅ 本轮已给 |
| **DQ** | 个人资料页打磨：头像与 Steam 账号解耦（default_steam_id）+ 布局调整 | [PROFILE-UI-2026-11-19.md](PROFILE-UI-2026-11-19.md) | 已发布 v2.27.0（2026-11-19，站点 e62fb4e/a1af397 + App 795c791；QA docs/QA-DQ.md 第 1 轮 ✅ 9/0/0/3；App 侧 app-v2.22.0 随本批） | ✅ 本交接已给 |
| **DN** | 对齐审核内容词 SKU 默认归档（季票/服装/DLC 等无效数据不进待审队列） | 本条目 + [SONKWO-STEAM-MATCH.md](SONKWO-STEAM-MATCH.md) | 已发布 v2.27.0（2026-11-19，实现 0c5fde4；QA docs/QA-DN.md 第 1 轮 ✅ 10/0/0/1） | ✅ 本轮已给 |
| **DR** | App 发版后即刻可更新（后台立即同步 + App 检查节流 1h + 同步间隔 15 分钟可配） | [APP-INSTANT-UPDATE.md](APP-INSTANT-UPDATE.md) | 已发布 v2.27.0（2026-11-19，站点 39aaebb + App 仓库 98dabca；QA docs/QA-DR.md 第 1 轮 ✅ 8/0/0/2；App 侧 app-v2.22.0 随本批） | ✅ 本轮已给 |
| **DS** | 搜索全自动派生（缩写/罗马数字/拼音 token + 分级排序 + 模糊兜底，零人工） | [SEARCH-ALIASES.md](SEARCH-ALIASES.md) | 已发布 v2.27.0（2026-11-19，实现 d607e27；QA docs/QA-DS.md 第 1 轮 ✅ 5/0/0/3） | ✅ 本交接已给 |
| **DT-1** | 菜单与路由权限隔离（admin 全量 / 普通用户 5 页 / 删 Steam 账号菜单 / 路由守卫） | [ADMIN-PERMISSIONS.md](ADMIN-PERMISSIONS.md) §DT-1 | 待开发（2026-11-19 沟通确认） | ✅ 本轮已给 |
| **DT-2** | 用户级数据接口（/api/me/sessions+踢自己、/api/me/wishlist）+ 5 页数据接入 | [ADMIN-PERMISSIONS.md](ADMIN-PERMISSIONS.md) §DT-2 | 待开发（依赖 DT-1） | ✅ 本轮已给 |
| **DT-3** | 用户管理打磨（去新建用户/行内操作/批量踢会话/编辑角色/绑定账号只读） | [ADMIN-PERMISSIONS.md](ADMIN-PERMISSIONS.md) §DT-3 | 待开发（2026-11-19 沟通确认） | ✅ 本轮已给 |
| **DT-4** | 验证码体验（冷却分桶 + 倒计时 60s + 重置密码弹窗不发码/失败不关/可重发） | [ADMIN-PERMISSIONS.md](ADMIN-PERMISSIONS.md) §DT-4 | 待开发（2026-11-19 沟通确认） | ✅ 本轮已给 |
| **DT-5** | 前后台入口（前台登录按钮/去退出改密；Console 全局顶栏用户菜单树） | [ADMIN-PERMISSIONS.md](ADMIN-PERMISSIONS.md) §DT-5 | 待开发（2026-11-19 沟通确认） | ✅ 本轮已给 |
| **DU** | 🐞 缺陷：个人资料「个人简介」placeholder 插值未绑定（显示 {{ }} 源码） | 本交接（TODO DU 条目） | 待开发（2026-11-19 截图发现，P3） | ✅ 本轮已给 |
| **DV** | 游戏管理「ITAD」筛选改为来源筛选（game_source_sync matched） | [ITAD-SOURCE-FILTER.md](ITAD-SOURCE-FILTER.md) | 待开发（2026-11-19 方案 A 确认） | ✅ 本轮已给 |
| **DW** | 🐞 缺陷：搜索关键词参数位错位风险（精确名匹配失效，中文名搜不到）——候选/主查询两套绑定显式化 + 锁行为测试 | [SEARCH-FIX-PERF.md](SEARCH-FIX-PERF.md) §DW | 已发布 v2.27.1（2026-11-19，修复 fc410af + 锁行为测试 77f8214；QA-DW.md 第 1 轮 6/0/0/1） | ✅ 本轮已给 |
| **DY** | 🐞 缺陷：安卓页面衔接状态丢失（详情返回后搜索/滚动/表单丢）——ViewModel/rememberSaveable 治理 | [ANDROID-POLISH.md](ANDROID-POLISH.md) §DY | 已发布 app-v2.23.0（2026-11-20，App d803612/tag app-v2.23.0；QA docs/QA-DY-DZ.md 第 2 轮 ✅） | ✅ 本轮已给 |
| **DZ** | ⚙️ 调整：安卓公告未读角标无法清除（首页铃铛常驻 1）——弹层加「全部已读」 | [ANDROID-POLISH.md](ANDROID-POLISH.md) §DZ | 已发布 app-v2.23.0（2026-11-20，App d803612/tag app-v2.23.0；QA docs/QA-DY-DZ.md 第 2 轮 ✅） | ✅ 本轮已给 |
| **EA** | ⚙️ 调整：安卓体验包（攒批）——下拉刷新/搜索空态/详情分享/版本号+清缓存/骨架屏/弱网提示 | [ANDROID-POLISH.md](ANDROID-POLISH.md) §EA | 已发布 app-v2.23.0（2026-11-20，App d803612/tag app-v2.23.0；QA docs/QA-EA-1-3.md、QA-EA-4-6.md 第 1 轮 ✅） | ✅ 本轮已给 |
| **EB** | ✨ 功能：安卓 18R 内容选项（筛选 chips「18R」+ adult=badge 显示/角标 + 首次 18+ 确认 + 本地记忆，攒批） | [ANDROID-POLISH.md](ANDROID-POLISH.md) §EB | 已发布 app-v2.23.0（2026-11-20，App d803612/tag app-v2.23.0；QA docs/QA-EB.md 第 1 轮 ✅） | ✅ 本轮已给 |
| **EC** | ⚙️ 调整：图片覆盖治理（后台覆盖看板 + 缺图回填任务 + 前端占位图） | [IMAGE-COVERAGE.md](IMAGE-COVERAGE.md) §8 | 待开发（2026-11-19 立项） | ✅ 本轮已给 |
| **ED** | 🧪 测试基建：test-main 加文档路径忽略（纯 docs 提交不跑测试，避免夜班文档提交反复取消 CI） | 本条目正文 | 质检通过（2026-11-20，QA docs/QA-ED.md 第 1 轮 ✅） | ✅ 本轮已给 |
| **EF** | 🐞 缺陷：18R 数据同步与筛选修复（元数据 cc=cn 锁国区 → 改 cc=us + 回填 + 前台 rating + Web/App 筛选） | [STEAM-SYNC-STATUS-AND-RATING.md](STEAM-SYNC-STATUS-AND-RATING.md) §9 | 已发布 v2.27.5（2026-11-20；站点 7a3ac2b + App 358ebc5；app-v2.24.0 随本批） | ✅ 本轮已给 |
| **EG** | 🐞 缺陷：通知角标已读后不消失（ABC 三场景） | [ANDROID-POLISH.md](ANDROID-POLISH.md) §EG | 已发布 v2.27.5（2026-11-20；站点 7eb5d4a + App 3458bce；app-v2.24.0 随本批） | ✅ 本轮已给 |
| **EH** | ⚙️ 调整：同步逻辑去 cn（内容类：steam-status 状态/分级 + discovery 搜索改 cc=us；价格保持 cc=cn） | [STEAM-SYNC-STATUS-AND-RATING.md](STEAM-SYNC-STATUS-AND-RATING.md) §10 | 待开发（2026-11-20 P1） | ✅ 本轮已给 |
| **EI** | ⚙️ 调整：同步双区域配置（contentRegion=us 拿全量 / baseRegion=cn 价格本位币可配；国际化预留） | [STEAM-SYNC-STATUS-AND-RATING.md](STEAM-SYNC-STATUS-AND-RATING.md) §11 | 待开发（2026-11-20 P1） | ✅ 本轮已给 |
| **EJ** | ⚙️ 调整：昵称显示规则统一（有昵称显示昵称，无昵称显示用户名；Web + App） | [DISPLAY-NAME-RULE.md](DISPLAY-NAME-RULE.md) | 已发布 v2.27.7（2026-11-20，站点 f340d78 + release 提交见 git log；App app-v2.24.2 / 6254978；QA docs/QA-EJ.md ✅） | ✅ 本轮已给 |
| **EL** | ⚙️ 调整：后台「添加/编辑」统一弹窗（IP 黑/白名单、站点通知、设置代理、申诉处理；原编号 EK，2026-11-20 编号撞车由所有者裁决改为 EL） | [ADMIN-EDIT-DIALOG.md](ADMIN-EDIT-DIALOG.md) | 已实现待发版（2026-11-20，实现 e0821f9） | ✅ 本轮已给 |
| **EK** | 🐞 缺陷：App Release 同步资产下载走专用代理（有代理走代理、无代理直连 GitHub；代理超时 30s） | [APP-RELEASE-SYNC-PROXY.md](APP-RELEASE-SYNC-PROXY.md) | 质检通过（2026-11-20，实现 cc4fcf5；QA docs/QA-EK.md 第 1 轮 ✅） | ✅ 本轮已给 |
| **EM** | 🐞 缺陷：Steam 同步超时（代理快速切换 + 同步异步化 + 结果反馈） | [STEAM-SYNC-TIMEOUT.md](STEAM-SYNC-TIMEOUT.md) | 待开发（2026-11-20 P1） | ✅ 本轮已给 |
| **DX** | 🧹 技术债：列表/站点接口性能优化（count 合并 + 短 TTL 缓存 + /api/site 缓存 + 压测） | [SEARCH-FIX-PERF.md](SEARCH-FIX-PERF.md) §DX | 待开发（依赖 DW） | ✅ 本轮已给 |

## 本会话（2026-11-06）讨论过、但**不属于项目文档**的内容

| 内容 | 落点 |
|---|---|
| 需求 skill 三条规则：① 设计/排查阶段分开决定是否给命令；② §9 排查命令规范；③ 需求确认后**必须**产出开发描述 | `.dsh/skills/steamdeals-requirements/SKILL.md`（自 2026-11-09 起随仓库提交） |

## 未落实项（本轮对账结论）

1. **F**（价格同步优化）已随 v2.2.1 发布（f32e2b9），方案写在 TODO F 段、无独立规格；
2. **C1**（heat 全失败）2026-11-09 已定案并随 v2.2.0 修复（b01aaf8），无独立规格；
3. **Y** 原先只有 TODO，现并入 AB 规格 §3-F；
4. **AA** 已随 v2.5.0 发布（方案 A，785670b）；**AC / AE** 已于 2026-11-06 拿到决策并随 v2.1.0 / v1.18.0 发布；
5. [TODO.md](TODO.md) 的历史段落存在**重复字母**（K/M/N/O/P 各出现两次）、A 段停留在 v1.4.6，扫描时容易被误导；
6. **AH–AL** 五条已入 TODO（2026-11-06）：用户生命周期 3 条见 [USER-LIFECYCLE.md](USER-LIFECYCLE.md)，密码系统与页面 2 条见 [AUTH-REDESIGN.md](AUTH-REDESIGN.md)；
   AK/AL 未单独给开发描述——所有者明确"按规格 §8 顺序直接派发"；
7. **AM**（Steam 代理池）同日入 TODO，规格 [PROXY-POOL.md](PROXY-POOL.md)；AM-1/AM-2 两批，后者依赖前者；
8. **AN**（未保存修改的离开提醒）同日入 TODO，规格 [UNSAVED-GUARD.md](UNSAVED-GUARD.md)；单批，纯前端；
9. **AO**（后台游戏列 + 链接抽屉改版）2026-11-09 入 TODO，规格 [ADMIN-LINKS-DRAWER.md](ADMIN-LINKS-DRAWER.md)；单批，纯前端；
10. **AP**（价格历史报表）2026-11-09 入 TODO，规格 [PRICE-HISTORY-REPORT.md](PRICE-HISTORY-REPORT.md)；单批，纯前端；
11. **AQ / AR**（后台列表排序 / 按 IP 合并）2026-11-09 入 TODO，规格 [ADMIN-REVIEW-LISTS.md](ADMIN-REVIEW-LISTS.md)；AR 依赖 AQ、下一期开发。






