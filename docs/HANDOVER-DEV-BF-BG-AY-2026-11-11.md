# 开发会话交接：BF / BG / AY（2026-11-11）

> 用途：把三个待办分别丢进**独立开发会话**执行。每个会话自包含，不需要读别的会话上下文；
> 但都必须先读 [HANDOVER.md](HANDOVER.md) 并加载 `gameprice-dev` 技能（项目硬规则以它为准）。
>
> 当前看板（2026-11-11）：`进行中 1`（AY 质检通过待发版）· `接下来 2`（BF、BG 待开发）· 已发布 v2.10.0。
> 三个会话的**写集互不重叠**（BF：后端 DDL/读写；BG：前端抽屉 + 测试；AY：只读复测 + 文档），可并行。

## 0. 三个会话共用规则（每个会话开头都要遵守）

1. 工作目录 `F:\dsh\gameprice`；先读 `docs/HANDOVER.md`，按 `gameprice-dev` 技能流程做。
2. **`docs/TODO.md` 是唯一事实源**：开工把条目状态改「开发中」，完工改「已实现待发版」，绝不改别人的条目。
3. 只做代码 + 测试；不碰服务器、不碰生产数据；**没有「构建 vX.Y.Z」指令不打 tag、不触发 CI**。
4. 验证三件套必须真跑并贴输出：`npm test`、`npm run frontend:build`（动前端时）、`npm run scan`；
   另外 `node test/api.test.js`（动后端时）与 `npm run todo:progress:check`。
5. 提交前先 `git status`：**只 `git add` 自己改的文件**，绝不 `git add -A`（工作区常有其他会话的未提交文档/QA 报告）。
6. 同步 `docs/PROJECT-OVERVIEW.md`；提交推 main 后**直接调用 `gameprice-qa`** 质检（技能会按条目出报告并改状态）。
7. 结束按 HANDOVER §3 汇报：`✅ 已做 / ⏳ 未做 / 📄 状态更新 / 🧪 质检 / 🔖 提交`，并说明「未做哪些及原因」。

---

## 1. 会话 BF：数据库遗留对象清理

```text
你是 SteamDeals（F:\dsh\gameprice）的开发会话，任务 = TODO 条目 BF。

先读：docs/HANDOVER.md → docs/TODO.md 的 BF 条目 → docs/DB-LEGACY-CLEANUP.md（规格，已提交）。
按 gameprice-dev 技能流程做：开工把 BF 状态改「开发中」，完工改「已实现待发版」。

范围（代码与库同步清理，规格 §3/§5）：
- A 组（立即做）：
  1) src/steam-login.js：删 create table steam_sessions 的 DDL（及注释里「已停用」说明）；
  2) src/steam-login.js：删 create unique index users_steam_uniq；
  3) src/store/pg.js：删 alter table users add column steam_id（约 :356）；
  4) src/store/pg.js：offers INSERT（约 :565-571）删 risk_level 字段与值；DDL 里该列也删；
  5) src/store/pg.js 后台用户列表 SELECT（约 :1702）删 steam_id 选择；全仓库 grep 确认无 steam_sessions /
     users.steam_id / offers.risk_level 的读写残留。
- B 组（BE 已发布 v2.9.0，已解锁）：
  6) src/steam-accounts.js addUserWishlist 的 steam_ids 写入、removeUserWishlist 的 returning steam_ids、
     以及任何读 user_wishlist.steam_ids 的地方全部删掉；
  7) src/steam-login.js 的 user_wishlist DDL 删 steam_ids 列（新库不再建）。
- 不要做：删 games.content_descriptors/age_ratings、games.interested/owned、user_prefs.hide_uninterested、
  steam_accounts.api_key_enc（规格 §6 明确保留）。
- 部署侧 SQL（规格 §3 末尾）不由你执行，只在文档里保持原样。

测试要求：
- 新增/增补测试断言「迁移不会重建这些对象」：新库 migrate 后 information_schema 里无 steam_sessions 表、
  users 无 steam_id 列、offers 无 risk_level 列、user_wishlist 无 steam_ids 列；
- 现有测试（wishlist / steam-accounts / api / pg）全绿，特别锁住「愿望单加入/移除」不受影响；
- npm test、node test/api.test.js、npm run scan 真跑并贴输出。

注意：
- 生产库现有这些列/表要等部署侧执行清理 SQL 才消失；代码必须能容忍「列还在」的过渡期（不读不写即可）；
- 只 git add 自己改的文件；提交推 main 后调用 gameprice-qa 按 BF 判；
- 不要碰服务器、不要发布。
```

---

## 2. 会话 BG：站点通知页误报「未保存的修改」

```text
你是 SteamDeals（F:\dsh\gameprice）的开发会话，任务 = TODO 条目 BG（BUG）。

先读：docs/HANDOVER.md → docs/TODO.md 的 BG 条目 → docs/UNSAVED-GUARD.md §11（规格，已提交）。
按 gameprice-dev 技能流程做：开工把 BG 状态改「开发中」，完工改「已实现待发版」。

根因（规格已定位）：frontend/src/components/AnnouncementDrawer.vue 里
  let snapshot = '';  // 初始为空串 → 页面挂载/抽屉关闭时 isDirty() 恒 true
  function isDirty() { return JSON.stringify(form) !== snapshot; }
修复：初始快照 = 初始表单 `let snapshot = JSON.stringify(form);`（fillFrom 打开抽屉时仍会重置，保持不变）。

范围：
- 只改 AnnouncementDrawer.vue 这一处 + 测试；不要动 useUnsavedGuard / 其他四个编辑面；
- test/unsaved-guard.test.js 增补静态断言：snapshot 初始为 JSON.stringify(form)、fillFrom 内仍重置快照；
- 手工核对：切菜单不弹、无「●」圆点；打开抽屉改字段后才脏；取消/遮罩/✕ 三按钮行为不变。

验证：npm test（主链含 unsaved-guard）、npm run frontend:build、npm run scan 真跑贴输出。

注意：
- 只 git add 自己改的文件（工作区常有其他会话的未提交 QA 报告/文档）；
- 提交推 main 后调用 gameprice-qa 按 BG 判；不要碰服务器、不要发布。
```

---

## 3. 会话 AY：搜索性能（部署后复测与收尾）

```text
你是 SteamDeals（F:\dsh\gameprice）的开发会话，任务 = TODO 条目 AY（状态：质检通过，待发版/待复测）。

先读：docs/HANDOVER.md → docs/TODO.md 的 AY 条目 → docs/READ-MODEL.md §9（门槛）+ §12（AY 修复与复测清单）。
代码修复已完成并推 main（71d0f87 + ffda3a9），本会话只做「部署后复测 +（不达标时）继续优化 + 文档收尾」。

前提确认（先做）：
1) 确认新版本已构建并部署：curl 生产 /api/site 看 version 是否 ≥ 下个构建版本（v2.11.0 或之后）；
   若还没构建/部署，停下来告诉所有者「AY 需要先构建部署」，不要自己打 tag/部署。
2) 部署后生产库里 games_heat_live 索引应已由 migrate 建好，可用只读 SQL 确认。

复测（全部只读，SQL 模板在 READ-MODEL §12 / 上一条会话已给过，6 条 EXPLAIN + 阈值）：
- 关键词查询（kw='' 与 kw='zzzzzz'）：EXPLAIN 里不应再出现 Seq Scan on games（关键词），且 Execution Time 显著下降；
- 默认列表：不应再出现 Sort Method: external merge，应走 games_heat_live；
- 外网实测三项：搜索 P95<150ms、零命中<150ms、/api/games/count<30ms（首次未命中缓存<100ms）；
- 结果把 EXPLAIN 关键行 + 实测数字追加到 READ-MODEL §12，并更新 TODO AY 的「复测」结论。

不达标时（按顺序排查）：
1) 关键词查询仍全扫 → 确认生产 pg_trgm 索引存在且表达式一致；确认候选查询真的走了 Bitmap Index Scan；
2) 列表仍外部排序 → 确认 games_heat_live 已建、谓词匹配（not deleted/adult/blocked）、必要时 ANALYZE games；
3) count 仍慢 → 检查 60s 缓存是否生效（进程重启后首访冷）；必要时评估给列表 count 加缓存（需先提需求）；
4) 任何新改动都按正常开发流程：改代码/迁移 → npm test/build/scan → 提交推 main → gameprice-qa。

注意：不改业务语义（total/排序/筛选必须与现实现一致，复用 test/game-search-read-model.test.js）；
只 git add 自己改的文件；不要碰服务器执行 DDL（建索引由版本 migrate 自动做）。
```

---

## 4. 依赖与建议顺序

| 会话 | 依赖 | 可否并行 | 说明 |
|---|---|---|---|
| BF | 无（B 组已解锁：BE 已发布 v2.9.0） | 是 | 纯后端 + 数据库对象，与 BG/AY 写集不重叠 |
| BG | 无 | 是 | 单文件前端修复 + 测试 |
| AY | **下个版本构建 + 部署** | 是（等部署那一段） | 代码已合入 main；未部署前只能做只读核对 |

> 三者改完后，建议一次构建（如 v2.11.0）包含 BF + BG，AY 的复测在新版本部署后进行。
