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
| **AA** | 添加愿望单推送失败 | [WISHLIST-FIX.md](WISHLIST-FIX.md) | 待排查（等 `wishlist_add_failed` 日志） | ❌ 等根因 |
| **AC** | 同步不可达的未保证项（AC1–AC11） | [SYNC-FAILURE-MODES.md](SYNC-FAILURE-MODES.md) | AC-1 已发布 v1.18.0；AC-2 待开发；AC-3/4 依赖阻塞 | ✅ 已在对话给出 |
| **AE** | 版本检测按服务器 IP 选镜像仓库（TCR/Hub） | [VERSION-SOURCE.md](VERSION-SOURCE.md) | 已发布 v1.18.0 | ✅ 已在对话给出 |
| **AF** | 愿望单/标记操作后列表不刷新（搜索缓存未失效） | [FRONTEND-STALE-LIST.md](FRONTEND-STALE-LIST.md) | 已发布 v1.18.0 | ✅ 已在对话给出 |
| **AG** | 后台平台链接抽屉 + 游戏名点击复制（后台/前台） | [ADMIN-PLATFORM-LINKS.md](ADMIN-PLATFORM-LINKS.md) | 已发布 v1.18.0 | ✅ 已在对话给出 |
| **AH** | 用户彻底删除（硬删除 + 最近删除审计） | [USER-LIFECYCLE.md](USER-LIFECYCLE.md) | 已发布 v2.0.0（2026-11-06） | ✅ 已在对话给出 |
| **AI** | 邮件模板化 + HTML 邮件 + 发送记录 | [USER-LIFECYCLE.md](USER-LIFECYCLE.md) | 已发布 v2.0.0（2026-11-06） | ✅ 已在对话给出 |
| **AJ** | 账号变更通知（7 类操作 / 8 类邮件） | [USER-LIFECYCLE.md](USER-LIFECYCLE.md) | 已发布 v2.0.0（2026-11-06） | ✅ 已在对话给出 |
| **AK** | 密码系统重设计（AK-1 策略/哈希、AK-2 登录防护、AK-3 账号流程） | [AUTH-REDESIGN.md](AUTH-REDESIGN.md) | AK-1 质检通过；AK-2 质检通过；AK-3 质检通过（2026-11-09，df79db2） | ✅ 规格自包含（按 §8 顺序派发） |
| **AL** | 登录 / 注册 / 改密页面 | [AUTH-REDESIGN.md](AUTH-REDESIGN.md) | 待开发（2026-11-09 由 AK-3 完成解锁） | ✅ 规格自包含（按 §8 顺序派发） |
| **AM** | Steam 代理池（多代理按序切换 + 健康状态） | [PROXY-POOL.md](PROXY-POOL.md) | AM-1 已发布 v2.0.0（2026-11-06）；AM-2 质检通过（2026-11-09，b7c49df） | ✅ 规格自包含（按 §8 顺序派发） |
| **AN** | 未保存修改的离开提醒（后台 5 个编辑面） | [UNSAVED-GUARD.md](UNSAVED-GUARD.md) | 质检通过（2026-11-09，ac9cbf4） | ✅ 规格自包含 |
| **AO** | 后台游戏列 + 平台链接抽屉改版（复制中英文 / 抽屉重做） | [ADMIN-LINKS-DRAWER.md](ADMIN-LINKS-DRAWER.md) | 待开发 | ✅ 规格自包含 |
| **AP** | 游戏详情·价格历史报表（趋势线 + 史低高亮） | [PRICE-HISTORY-REPORT.md](PRICE-HISTORY-REPORT.md) | 待开发 | ✅ 规格自包含 |
| **AQ** | 后台访问/异常列表排序（数值 IP + 上限 500） | [ADMIN-REVIEW-LISTS.md](ADMIN-REVIEW-LISTS.md) §3 | 待开发 | ✅ 规格自包含 |
| **AR** | 异常审核「按 IP 合并」视图 | [ADMIN-REVIEW-LISTS.md](ADMIN-REVIEW-LISTS.md) §4 | 依赖阻塞（AQ） | ✅ 规格自包含 |
| **F** | Steam 价格同步优化（缩量 / 热点优先） | ❌ 无独立规格（计划写在 [TODO.md](TODO.md) F 段） | 等排期 | ❌ 未给 |
| **C1** | heat 逐 appid 全 `success:false` | ❌ 无规格（[TODO.md](TODO.md) C1） | 待探测 | ❌ 未给 |

## 本会话（2026-11-06）讨论过、但**不属于项目文档**的内容

| 内容 | 落点 |
|---|---|
| 需求 skill 三条规则：① 设计/排查阶段分开决定是否给命令；② §9 排查命令规范；③ 需求确认后**必须**产出开发描述 | `.dsh/skills/gameprice-requirements/SKILL.md`（gitignored，不在仓库文档里） |

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
