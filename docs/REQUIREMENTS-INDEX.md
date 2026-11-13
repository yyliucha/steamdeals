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
| **O** | 申诉系统改造（站内提交入库 + 后台申诉管理 + 处理结果回信；每 IP 3 条/小时 + 验证码 + 幂等） | [APPEAL-SYSTEM.md](APPEAL-SYSTEM.md) §1–§9 / [DEV-BRIEF-APPEAL.md](DEV-BRIEF-APPEAL.md) | 已实现待发版（2026-11-14，第 1 轮打回已修复，待复检） | ✅ 本轮已给 |
| **BQ** | 申诉邮件内一键「信任 / 封禁」（确认页 + 一次性 token，14 天有效；收件人沿用申诉邮箱） | [APPEAL-SYSTEM.md](APPEAL-SYSTEM.md) §10 / [DEV-BRIEF-APPEAL.md](DEV-BRIEF-APPEAL.md) | 已实现待发版（2026-11-14，随 O 同批，第 1 轮打回已修复，待复检） | ✅ 本轮已给 |
| **BR** | 封禁自助恢复 + 手机/CGNAT 适配（加白即清封、`ban/state` 自查三件套、封禁页可读、页面/API 分桶） | [BAN-AND-SECURITY-FIXES.md](BAN-AND-SECURITY-FIXES.md) §11 | 质检通过（2026-11-14，docs/QA-BAN-BR.md） | ✅ 本轮已给 |
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
| **C1** | heat 逐 appid 全 `success:false` | ❌ 无规格（[TODO.md](TODO.md) C1） | 待探测 | ❌ 未给 |

## 本会话（2026-11-06）讨论过、但**不属于项目文档**的内容

| 内容 | 落点 |
|---|---|
| 需求 skill 三条规则：① 设计/排查阶段分开决定是否给命令；② §9 排查命令规范；③ 需求确认后**必须**产出开发描述 | `.dsh/skills/gameprice-requirements/SKILL.md`（自 2026-11-09 起随仓库提交） |

## 未落实项（本轮对账结论）

1. **F**（价格同步优化）只有 TODO 里的计划，没有独立规格、没有开发描述；
2. **C1**（heat 全失败）只有 TODO 一行，没有规格、没有探测结论；
3. **Y** 原先只有 TODO，现并入 AB 规格 §3-F；
4. **AA** 缺所有者输入（`wishlist_add_failed` 日志），因此还没有开发描述；**AC / AE** 的决策已于 2026-11-06 拿到，已转「待开发」并给出开发描述；
5. [TODO.md](TODO.md) 的历史段落存在**重复字母**（K/M/N/O/P 各出现两次）、A 段停留在 v1.4.6，扫描时容易被误导；
6. **AH–AL** 五条已入 TODO（2026-11-06）：用户生命周期 3 条见 [USER-LIFECYCLE.md](USER-LIFECYCLE.md)，密码系统与页面 2 条见 [AUTH-REDESIGN.md](AUTH-REDESIGN.md)；
   AK/AL 未单独给开发描述——所有者明确"按规格 §8 顺序直接派发"；
7. **AM**（Steam 代理池）同日入 TODO，规格 [PROXY-POOL.md](PROXY-POOL.md)；AM-1/AM-2 两批，后者依赖前者；
8. **AN**（未保存修改的离开提醒）同日入 TODO，规格 [UNSAVED-GUARD.md](UNSAVED-GUARD.md)；单批，纯前端；
9. **AO**（后台游戏列 + 链接抽屉改版）2026-11-09 入 TODO，规格 [ADMIN-LINKS-DRAWER.md](ADMIN-LINKS-DRAWER.md)；单批，纯前端；
10. **AP**（价格历史报表）2026-11-09 入 TODO，规格 [PRICE-HISTORY-REPORT.md](PRICE-HISTORY-REPORT.md)；单批，纯前端；
11. **AQ / AR**（后台列表排序 / 按 IP 合并）2026-11-09 入 TODO，规格 [ADMIN-REVIEW-LISTS.md](ADMIN-REVIEW-LISTS.md)；AR 依赖 AQ、下一期开发。










