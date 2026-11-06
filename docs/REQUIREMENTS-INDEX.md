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
| **AB** | Steam 状态判定整轮静默不写库（JSON 取错） | [STEAM-STATUS-FIX.md](STEAM-STATUS-FIX.md) | 已实现待发版（e432d2f，待质检） | ✅ 已在对话给出 |
| **Y** | 补 `steamStatus.initialDelaySec` 设置项 | 并入 [STEAM-STATUS-FIX.md](STEAM-STATUS-FIX.md) §3-F | 已实现待发版（随 AB，e432d2f） | 随 AB |
| **AD** | 搜索支持中英文（含平台中文别名） | [SEARCH-I18N.md](SEARCH-I18N.md) | 待开发（决策已确认） | ✅ 已在对话给出 |
| **AA** | 添加愿望单推送失败 | [WISHLIST-FIX.md](WISHLIST-FIX.md) | 待排查（等 `wishlist_add_failed` 日志） | ❌ 等根因 |
| **AC** | 同步不可达的未保证项（AC1–AC11） | [SYNC-FAILURE-MODES.md](SYNC-FAILURE-MODES.md) | 待决策（§5 的 Q1–Q5 未答） | ❌ 待决策 |
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
4. **AA / AC** 缺所有者输入（日志 / 决策），因此还没有开发描述；
5. [TODO.md](TODO.md) 的历史段落存在**重复字母**（K/M/N/O/P 各出现两次）、A 段停留在 v1.4.6，扫描时容易被误导。
