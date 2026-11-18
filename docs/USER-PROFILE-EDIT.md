# 个人资料编辑（Web + App）（CX，已实现待发版）

> 状态：**已实现待发版（2026-11-18 晚完成；待质检/发版）**。所有者确认 5 项决策 + 我的资料口径。
> Demo：编辑 [design/profile-web-2026-11-18.html](design/profile-web-2026-11-18.html) / [design/profile-android-2026-11-18.html](design/profile-android-2026-11-18.html)；
> 我的资料（双账号卡片/统计，仅本人）[design/my-profile-web-2026-11-18.html](design/my-profile-web-2026-11-18.html) / [design/my-profile-android-2026-11-18.html](design/my-profile-android-2026-11-18.html)
> 关联：[TODO.md](TODO.md) CX 条目、[AUTH-REDESIGN.md](AUTH-REDESIGN.md)（邮箱/密码）、
> [APP-PARITY.md](APP-PARITY.md)（App 功能对齐）、[DATA-ISOLATION.md](DATA-ISOLATION.md)（CY：权限边界）。

## 1. 现状（2026-11-18 代码核对）

- `users` 表有 `display_name / email / email_verified`，**无头像列、无 bio**；`user_prefs.theme` 已存在；
- `/api/me` **只有 GET**，没有任何保存资料的接口；
- 用户**没有**个人资料页（后台/前台/App 都没有）；
- Steam 账号：`steam_accounts`（`steam_id / persona_name / avatar / user_id / alias`），
  `GET /api/steam/accounts`（列表 + 管理员可见未归属）、`PATCH /api/steam/accounts/:steamId`（别名/API Key）、
  `unbindAccount`（解绑，保留历史「曾拥有」）、绑定走 Steam 登录流程；`MAX_ACCOUNTS_PER_USER` 限数量。

## 2. 已确认需求（所有者 2026-11-18）

| # | 内容 |
|---|---|
| 1 | 管理员与普通用户**同一套页面/接口**，服务端只允许改 `session.user.id` 自己的资料；管理员**不能**改别人的资料。 |
| 2 | 头像：**存数据库**（`users.avatar_bytes bytea + avatar_mime + avatar_source + avatar_updated_at`）；客户端裁剪后提交；`GET /api/avatar/:userId` 输出（ETag/长缓存）。 |
| 3 | 头像来源：**默认取已绑 Steam 账号头像**（多账号时可选其一），**也可自定义上传**；`avatar_source` = `steam:<steamId>` / `custom` / null。 |
| 4 | 用户名只读；**邮箱本版只读**（更换邮箱 + 验证码 → 二期）。角色只读（所有者分配）。 |
| 5 | 可编辑：**昵称（2–20 字）、个人简介（≤200 字）、主题（跟随系统/深/浅）、到价提醒邮件开关**。 |
| 6 | **Steam 账号卡**：列出全部绑定账号（头像/昵称/SteamID/绑定时间/默认标记）；支持**设为默认、解绑、新增绑定**；解绑只停止后续检测，**历史「曾拥有」记录保留**。 |
| 7 | **App 端**同样可看 Steam 账号列表，并支持**解绑 / 新增 / 更换**；新增绑定在系统浏览器打开站点 Steam 绑定流程，返回 App 刷新列表。 |
| 8 | 前端展示处（评论/申诉/后台用户列表等）在有头像时显示头像，无头像回退首字/默认图。 |
| 9 | **「我的资料」仅本人可见**：不提供任何访问他人资料的入口/URL；管理员同样只能看/改自己。 |
| 10 | **必填项**：昵称、简介、**邮箱必填**；**管理员豁免**：昵称/简介可空，邮箱仍必填。老用户邮箱为空时不强制跳补全，保存/使用邮箱功能时提示。 |
| 11 | **多 Steam 账号用卡片展示**：每个绑定账号一张卡（头像/昵称/SteamID/已拥有数/愿望单数/最近同步时间/操作），不合并成一行。 |
| 12 | 资料页下半部展示**我的游戏库与统计**（仅本人）：每账号卡片 + 本站愿望单/到价提醒数量汇总。 |
| 13 | **查看已拥有/愿望单用弹窗**：Web = 对话框（标题含账号、tab 已拥有/愿望单、搜索、列表、分页）；Android = 底部弹层（同结构）。 |
| 14 | 统计口径：已拥有合计 / 愿望单合计 / 本站愿望单 / 到价提醒 / **史低命中数**（5 项）。 |
| 15 | 账号卡片的「最近同步时间」：**Web 显示，Android 不显示**。 |

## 3. 改动落点

- `src/store/pg.js`：`users` 加列（`avatar_bytes/avatar_mime/avatar_source/avatar_updated_at/bio`）；
  `getUserPublic`/`updateUserProfile`/`getAvatar`；`setDefaultSteamAccount`（`users.avatar_source`）。
- `src/server.js`：`PATCH /api/me/profile`（昵称/简介/主题/邮件开关）、`POST /api/me/avatar`（JSON dataUrl，≤512KB）、
  `DELETE /api/me/avatar`、`GET /api/avatar/:userId`（public，ETag）、`POST /api/steam/accounts/:id/default`；
  解绑复用 `unbindAccount`；绑定复用 Steam 登录流程。
- `frontend/src/pages/ProfilePage.vue`（新）：资料表单 + 头像选择（Steam 账号/自定义）+ Steam 账号卡；
  Console 左栏加「个人资料」入口（`/console/profile`）；有头像的地方用 `<img :src="avatarUrl(user)">`。
- App：`MeScreen` → 「编辑资料」页（`ProfileEditScreen`）：头像选择（相册 + 裁剪 256）、昵称/简介、主题、邮件开关、
  Steam 账号列表（解绑/新增/设为默认）；新增走浏览器打开 `https://sd.yyliucha.cn/console/steam`（或绑定深链）。
- 测试：`test/profile.test.js`（字段校验、越权 403、头像上传大小/类型、avatar_source 切换）；
  `test/api.test.js` 扩 `/api/me` 返回字段；App JVM 单测（表单校验 + 账号操作请求）。

## 4. 验收（demo 状态 ↔ 断言）

| demo 状态 | 断言点 | 预期 |
|---|---|---|
| Web 头像区显示「S」+ 更换/移除 | 头像展示 | 有自定义头像显示图片；无则显示 Steam 默认/首字 |
| Web「默认头像」三个选项（sunming / alt_account / 自定义） | 选择器 | 选中项持久化；保存后 `/api/me` 的 `avatarSource` 对应 |
| Web Steam 卡两条 + 「默认」徽标 | 列表 | 两个账号都显示；默认只有一个；解绑有二次确认 |
| Web「设为默认 / 解绑 / ＋绑定新的」 | 操作 | 设为默认立即生效；解绑后行消失但历史记录保留；新增跳 Steam 绑定 |
| Web 昵称/简介/主题/邮件开关 | 表单 | 校验（昵称 2–20、简介 ≤200）；保存成功 toast；刷新后保持 |
| Web 用户名/邮箱/角色只读 | 只读 | 不可编辑；接口忽略这些字段 |
| Android 头像 + 三个头像来源 chips | 同 Web | 选中态与保存一致 |
| Android Steam 卡（解绑/设为默认/新增） | 同 Web | 操作后列表刷新；新增打开浏览器绑定 |
| 越权 | 安全 | A 改 B 的资料 → 403；直接传 `userId` 被忽略 |
| 我的资料（仅本人） | 权限/无入口 | 无他人资料入口；管理员只能改自己 |
| 多账号卡片 | 每账号一卡 | Web 有最近同步、Android 无；两卡数据分开 |
| 查看已拥有/愿望单 | 弹窗形态 | Web 对话框 / Android 底部弹层；均有搜索+分页 |
| 统计 | 5 项 | 已拥有/愿望单/本站愿望单/到价提醒/史低命中 |
| 通用 | `npm test` / `frontend:build` / `scan` | 全绿；App 构建 + 模拟器验证 |

## 5. 二期（记录）

- 更换邮箱（验证码 + 双邮箱通知）；
- 头像裁剪交互（服务端裁剪 vs 客户端裁剪的最终形态）；
- 个人主页（他人可看的公开页：头像/昵称/简介 + 愿望单公开度）。




