# QA：AU 批（pg_trgm 索引 / 封面图缓存上限 / 愿望单诚实口径 AA 方案 A）

> 基线 `447359d`（v2.4.0 AT 批发布后）→ 本批为**工作区未提交改动**，HEAD 仍为 `447359d`；
> 判据：[ROADMAP.md](ROADMAP.md) 的 D1/D2、[WISHLIST-OAUTH.md](WISHLIST-OAUTH.md) §3/§4、[TODO.md](TODO.md) AU 条目。
> 结论：**✅ 放行** —— 通过 10 / 缺失 0 / 偏差 0 / 需人工确认 2（生产索引命中、线上缓存清理观感）。

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | D1 | 关键词搜索不再全表扫（生产库建三元组索引，搜索更快） | 前台搜索框 / 后台游戏搜索 → `games.name`、`games.name_en`、`game_aliases.platform_title` 三条表达式 GIN 索引 | ✅ | `src/store/pg.js:428-442`；`test/pg.test.js:56-74` |
| 2 | D1 | 没有 `pg_trgm` 扩展的环境（本地 pglite）照常启动，不因建索引失败中断迁移 | 容器启动 `migrate()` | ✅ | `src/store/pg.js:441-443` try/catch；`test/pg.test.js` 连跑两次 `migrate` |
| 3 | D2 | 封面图缓存可设总量上限（字节，0=不限），超了就自动清最旧的 | 系统设置 → 高级 → 「封面图缓存总量上限」 | ✅ | `src/settings.js:184`；`test/settings.test.js`（59 项） |
| 4 | D2 | 可手动按上限清一次缓存 | 命令行 `node src/cli.js images prune --max-bytes <字节>` | ✅ | `src/cli.js:2370-2381` |
| 5 | D2 | 每次补图跑完自动按上限清理，不用手动管 | 调度器 `images` 任务（`images pull` 结束） | ✅ | `src/cli.js:2446`；`scheduler.js:547/705` 设置 revision 变化重新水合 env |
| 6 | D2 | 清理只删封面图（`.jpg`），删不掉的文件跳过不中断 | 同上 | ✅ | `src/images.js:99`（`pruneImages`）；`test/images.test.js:72-102` |
| 7 | AA | 愿望单弹窗如实说明：只存本站，Steam 推送暂不支持 | 前台卡片/详情 →「愿望单」按钮 → 多选弹窗 | ✅ | `frontend/src/pages/Home.vue:82`（弹窗说明）；`test/wishlist.test.js:176` |
| 8 | AA | 加入愿望单成功提示不再出现「失败」字样 | 同上 → 提交后 toast | ✅ | `Home.vue` `addWishlist`；`test/wishlist.test.js:177-178`（含 `doesNotMatch /推送失败/`） |
| 9 | AA | 移除愿望单提示同口径（Steam 回推暂不支持） | 详情/卡片 → 移除愿望单 | ✅ | `Home.vue` `confirmWishlistRemove`；同测试文件 |
| 10 | AA | 服务端仍记失败原因，排障能力不丢；文档同步（WEB / STEAM-ACCOUNTS / README） | `adapter.steam.wishlist_add_failed` + reason；三份文档 | ✅ | `docs/WEB.md:46`、`docs/STEAM-ACCOUNTS.md:274-276`、`README.md:145`；`src/steam-accounts.js`（未改动） |

## 逐条核对（规格验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | D1：索引表达式与 `gameKeywordSql` 字段侧归一化一致 | 读两处表达式逐字比对 | `pg.js:1046-1048`（`replace(replace(lower(coalesce(col,'')),' ',''),'　','')`）与 `pg.js:433-440` 相同 | ✅ |
| 2 | D1：三条索引覆盖 name / name_en / 平台别名 | grep 索引名 | `games_name_trgm` / `games_name_en_trgm` / `game_aliases_title_trgm`（`pg.js:433-440`） | ✅ |
| 3 | D1：本地无扩展不中断迁移 | 读 try/catch + 测试实跑两次 migrate | `pg.js:441-443`；`test/pg.test.js:56-74` | ✅ |
| 4 | D2：超限按最旧删到合规 | 读实现 + 单测断言（400B 旧文件先删、300B 保留） | `images.js:99-147`；`test/images.test.js:72-102` | ✅ |
| 5 | D2：上限内不动、0=不限 | 单测两条断言 | `test/images.test.js:85-100` | ✅ |
| 6 | D2：设置项可改、热加载 | 读 `def()` 定义 + 调度器 revision 重水合 | `settings.js:184`；`scheduler.js:704-714` | ✅ |
| 7 | D2：CLI 手动清理可用 | 读参数解析与错误提示 | `cli.js:2370-2381`（`flag('max-bytes', env.IMAGES_MAX_BYTES ?? '0')`） | ✅ |
| 8 | D2：`images pull` 后自动清理 | 读 pull 尾部逻辑 | `cli.js:2440-2449` | ✅ |
| 9 | AA：弹窗/加入/移除三处口径 | 读 Home.vue 三处文案 + 测试静态断言 | `Home.vue:82` 与 `addWishlist` / `confirmWishlistRemove`；`test/wishlist.test.js:176-181` | ✅ |
| 10 | AA：文档同步 | 读三份文档 | `WEB.md:46`、`STEAM-ACCOUNTS.md:274-276`、`README.md:145` | ✅ |
| 11 | 纪律：未打 tag、未改版本号 | `git tag --list`、`git diff package.json` | tag 最新仍是 v2.4.0（由 AT 批会话推送）；`package.json` 无改动 | ✅ |
| 12 | 纪律：构建产物/日志未入库 | `git status` 检查 | `frontend/dist`、`logs/`、`data/` 均未出现；工作区根目录临时日志未提交 | ✅ |
| 13 | 文档收尾：PROJECT-OVERVIEW / TODO / INDEX / ROADMAP / CHANGELOG | 读 diff | 四份均新增 AU/D1/D2 条目；CHANGELOG 增 `[Unreleased]` 段 | ✅ |

## 亲自重跑的验证

| 命令 | 关键输出 | 结论 |
|---|---|---|
| `npm test` | 74 个测试文件、590 项断言、`# fail 0`，`EXIT=0` | ✅ 全绿 |
| `node test/api.test.js` | `# tests 22 / # pass 22 / # fail 0`（50.9s） | ✅ 全绿 |
| `npm run frontend:build` | `✓ built in 1.03s`，`EXIT=0` | ✅ 通过 |
| `npm run scan` | 扫描 304 个文件，「未发现高置信度凭据」 | ✅ 干净 |
| `npm run todo:progress` / `:check` | 「开发进度块与 docs/TODO.md 一致」 | ✅ 一致 |
| `node test/docs.test.js` | `# tests 5 / # pass 5 / # fail 0` | ✅ 无断链 |

## 打回清单

- 无。

## 风险提醒（不判错，记录给下一批）

1. **`images prune --max-bytes` 不带数值时**：`flag()` 对「有 flag 无值」返回 `true`，`Number(true) === 1`，
   等于把缓存清到 1 字节。建议下一批把它改成「非字符串即报用法错误」，并加一条 CLI 参数单测。
2. **生产建扩展权限**：若生产角色不是 superuser 且 `pg_trgm` 未由 DBA 预装，`create extension` 会失败并被 catch，
   三条索引静默不建（功能不受影响，只是没加速）。建议迁移里区分两步并在扩展失败时 `logger.warn`。
3. **愿望单弹窗仍列 Steam 账号**（未配 Key 置灰、可选）：与「暂不支持」文案有轻微割裂——方案 A 明确保留现状，
   若体验上想彻底去掉，等方案 B 再评估。

## 需人工确认

- **D1 索引是否真的被用上**：本机无 PostgreSQL 15，只能验证「迁移不报错 + 语句存在」。上线/有 PG 环境后执行
  `\dx pg_trgm` 与 `EXPLAIN ANALYZE select count(*) from games where replace(replace(lower(coalesce(name,'')),' ',''),'　','') like '%森林%';`，
  看是否为 `Bitmap Index Scan on games_name_trgm`。
- **D2 线上观感**：设置一个较小上限（如 50MB）跑一轮 `images` 任务，确认 `logs` 出现 `images.pruned` 且前台封面不裂（删掉会按需回源重下）。

## 复检记录

- 第 1 轮（2026-11-09）：首次检查，10 项功能 + 13 条核对全部通过，0 打回；`npm test` / `api.test` / `frontend:build` / `scan` 全绿。
