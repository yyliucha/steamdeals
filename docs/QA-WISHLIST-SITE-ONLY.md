# QA：BE 批（愿望单仅本站）

> 基线 `a7db8d3` → HEAD `af1a630`（实现 `66f0c18`；清理 `af1a630`）。
> 判据：`docs/WISHLIST-SITE-ONLY.md` §8（验收 1–8）与 §4.4（验收 9–13）。
> 结论：**✅ 放行 —— 通过 18 / 缺失 0 / 偏差 0 / 需人工确认 5**

## 功能清单（本批交付的全部功能，一条一行）

| # | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|
| 1 | 加愿望单不再弹 Steam 账号多选，直接加入本站 | 前台卡片/详情「愿望单」按钮 | ✅ | `Home.vue:251`（`addWishlist` 直 POST）；`test/wishlist.test.js` |
| 2 | 移除愿望单先二次确认，只删本站、不推 Steam | 前台「✓ 愿望单」按钮 | ✅ | `Home.vue:259`（确认）、`server.js:1573`（DELETE 只删本站） |
| 3 | 卡片/详情不再显示 Steam 账号名；详情显示「本站愿望单」 | 前台卡片徽标 / 详情弹窗 | ✅ | `Home.vue:80`（本站标签）；`grep wishlisted_by` 无模板展示 |
| 4 | 前台「愿望单」tab 仍按愿望单过滤（价格/史低正常） | 首页筛选 tab | ✅ | `test/wishlist-push.test.js`（过滤命中/越权不可见） |
| 5 | 后台新增「愿望单」菜单 | 控制台 → 内容运营 → 愿望单 | ✅ | `Console.vue:52` |
| 6 | 后台列表：用户 / 游戏 / 当前价 / 史低 / 加入时间 | 愿望单页表格 | ✅ | `AdminModules.vue:49`（模板）、`steam-accounts.js:449`（`listWishlists`） |
| 7 | 关键词搜索（用户名/游戏名/AppID） | 愿望单页搜索框 | ✅ | `steam-accounts.js:455-462`；`test/wishlist-site-only.test.js` 三种关键词 |
| 8 | 分页 | 愿望单页底部分页 | ✅ | `AdminModules.vue:49`（`PaginationBar` + `pagedWishlists`） |
| 9 | 单条删除（二次确认） | 愿望单行「删除」 | ✅ | `AdminModules.vue:400`（`removeWishlist`）；`server.js:1593` |
| 10 | 批量删除（二次确认，单次上限 200） | 勾选 + 批量工具条 | ✅ | `server.js:3235`（`wishlists/delete` max 200）；测试 201 键 → 400 |
| 11 | 后台**没有**新增入口 | 愿望单页 | ✅ | `AdminModules.vue:49` 页面文案 + 无新增按钮；`server.js` 无管理端新增路由 |
| 12 | 删除后前台消失；自动史低提醒清理（最后一个收藏才清） | 删除后刷新前台 | ✅ | `steam-accounts.js:486`（`deleteWishlistsByIds`）；`removeUserWishlist` 同步改口径 |
| 13 | 权限：管理端匿名 401 / 普通用户 403；用户端未登录 401 | API | ✅ | `server.js:1585`（`requireAdmin`）、`:1559`（`requireUser`）；测试覆盖 |
| 14 | 旧请求带 `steamIds` 不报错、不推送、不写 `steam_wishlist` | `POST /api/wishlist` | ✅ | `server.js:1558`（忽略字段）；`test/wishlist.test.js` 断言 |
| 15 | `steam_wishlist` 与 `sync-wishlist` 任务不受影响 | 调度/DB | ✅ | 本批未改 `sync-wishlist`；删除不触碰 `steam_wishlist`（测试断言行保留） |
| 16 | 账号同步（游戏库/愿望单）用**该账号自己的** API Key | 后台 Steam 账号「同步游戏库/愿望单」 | ✅ | `server.js:1288`（`requireAccountApiKey`）、`:1484/:1504`（两条同步路由） |
| 17 | 未配置 key / key 无效 → 直接报错，**不回退**全局 key | 同上 | ✅ | `server.js:1289-1309`；`grep requireSteamApiKey()` 为 0 |
| 18 | 调度任务逐账号取 key；缺 key 跳过并记日志（不中断整轮） | 每日 `steam-accounts` 任务 | ✅ | `cli.js:1182`（逐账号解密）、`:1208`（`steam.account_sync_skipped`） |
| 19 | 绑定新账号后**不自动同步**，提示先配 key；后台列改名「API Key」 | 绑定回调 → 后台 Steam 账号页 | ✅ | `server.js:1407`（`steamNeedKey=1`）；`AdminExtras.vue:22`（列名）、`:160`（提示）、弹窗文案 |
| 20 | 系统级采集任务（catalog/steam-status/backfill/heat/rename/discover）仍用全局 key | 调度器 | ✅ | 本批未改这些任务的 key 来源；`scheduler.js` 无 diff |

## 逐条核对（规格验收）

| # | 条目（规格验收） | 检查手段 | 证据 | 判定 |
|---|---|---|---|---|
| 1 | §8-1 加入：无多选弹窗、只写本站+建提醒、卡片/详情立即显示 | 真 HTTP + 静态 | `test/wishlist.test.js`（POST 200、steam_ids 空、watch 建、steam_wishlist 0 行） | ✅ |
| 2 | §8-2 详情/卡片无账号名；移除只删本站 | 静态 + 真 HTTP | 无 `wishlistByText`；DELETE 响应 `removedFromSteam: []` | ✅ |
| 3 | §8-3 「愿望单」tab 仍能过滤 | 真 HTTP | 搜索 `wishlist:true` 命中、bob/游客不可见 | ✅ |
| 4 | §8-4 后台列表正确（用户/游戏/价/史低/时间） | 真 HTTP | `GET /api/admin/wishlists` 断言 username/name/steam_appid/current_low=12345/hist_low=9999/created_at | ✅ |
| 5 | §8-5 单条+批量删除、前台消失、自动提醒清、无新增入口 | 真 HTTP | 单条 200/404；批量 200；watch 清理断言；页面无新增按钮 | ✅ |
| 6 | §8-6 权限 403/401 | 真 HTTP | 匿名 401、alice 403、admin 200 | ✅ |
| 7 | §8-7 旧接口兼容（带 steamIds 不报错不推送） | 真 HTTP | POST with steamIds → added []、calls 0、无 steam_wishlist 行 | ✅ |
| 8 | §8-8 npm test + build + scan | 亲自跑 | 见下「验证」 | ✅ |
| 9 | §4.4-9 A 用 key1、B 用 key2 | 代码 + 静态 | 逐账号查 `api_key_enc` 解密（`cli.js:1182`/`server.js:1288`），无共享全局变量 | ✅ |
| 10 | §4.4-10 未配 key → 报错、不发请求、不回退 | 真 HTTP（缺 key 分支）+ 静态 | 同步路由 400「该账号未配置 API Key」（helper 先返回，未进入 fetch） | ✅ |
| 11 | §4.4-11 key 无效 → 报错、不回退 | 代码 | 401/403 → 400「该账号 API Key 无效」（`server.js:1481/1500`） | ✅ |
| 12 | §4.4-12 绑定后不自动同步、提示先配 key | 代码 | 绑定块已删自动同步；`steamNeedKey=1`；AdminExtras 提示文案 | ✅ |
| 13 | §4.4-13 系统任务仍用全局 key | 代码 | 本批未改 `scheduler.js` 与系统任务路径 | ✅ |

## 亲自重跑的验证

| 命令 | 关键输出 | 结论 |
|---|---|---|
| `npm test` | **78 个文件 / 621 项 / `# fail 0`**，`EXIT=0` | ✅ |
| `node test/api.test.js` | `# tests 22 / # pass 22 / # fail 0` | ✅ |
| `npm run frontend:build` | `✓ built in 1.67s` | ✅ |
| `npm run scan` | 未发现高置信度凭据 / 可疑密钥赋值 | ✅ |
| `npm run todo:progress:check` | 与 TODO 一致 | ✅ |
| `node test/docs.test.js` | 5/5 无断链 | ✅ |

## 质检中发现并已处理的偏差

1. **多用户共享同一游戏时的提醒清理**：原 `removeUserWishlist` 无条件删全局自动提醒；已改为「最后一个收藏删掉才清」
   （与后台删除同口径），并被 `test/wishlist-site-only.test.js` 的「还有别人收藏 → 提醒保留」锁住。
2. **遗留死代码**：`steamWishlistPush` 注入参数、`accountsWithWishlistAppid` 导出、过期注释已清理（`af1a630`）。
3. **过程事故（已上报）**：`66f0c18` 误把另一会话写入工作区的 **BG 条目**（`docs/TODO.md` / `REQUIREMENTS-INDEX.md`）
   一并提交；内容未改动，其规格文档 `docs/UNSAVED-GUARD.md` §11 仍由该会话自行提交。

## 风险提醒（不判错）

1. `user_wishlist` 新增代理主键 `id bigserial`（迁移只加列 + 唯一索引）。生产表行数 = 用户×收藏数，通常不大；
   若极大，`ALTER TABLE ... ADD COLUMN bigserial` 会回填一次，建议部署窗口执行。
2. API 的 `wishlisted_by` 现在恒为空数组（前台已不展示）；无外部依赖。
3. `pushWishlistItem` 保留但无生产调用（为 OAuth 方案 B 预留），有单测覆盖解析逻辑。
4. 生产已绑定的账号多数没有账号级 key：升级后同步会先报「请先配置 API Key」，属预期；需逐个补 key。

## 需人工确认（5）

1. 前台加/删愿望单的视觉与移动端手感（无弹窗后是否够顺手）。
2. 后台「愿望单」页表格/移动卡片的布局与批量删除交互。
3. 真实流程：绑定新账号 → 提示配 key → 填入 → 同步游戏库/愿望单成功。
4. 生产升级迁移（`user_wishlist` 加列）耗时与锁影响。
5. 账号级 key 的真实 Steam 行为（有效 key 同步成功、无效 key 报 401 文案）。

## 复检记录

- 第 1 轮（2026-11-10）：功能 20 条、验收 13 条逐条核对；`npm test`/`api.test`/`build`/`scan` 全绿 → ✅ 放行。
