# 个人资料页打磨：头像与 Steam 账号解耦 + 布局调整（DQ，已实现并发布 v2.27.0）

> 状态：**已实现并发布 v2.27.0（2026-11-19 站点 e62fb4e/a1af397 + App 795c791；5 项口径已确认，见 §1；App 侧 app-v2.22.0 随本批）**。
> 关联：[USER-PROFILE-EDIT.md](USER-PROFILE-EDIT.md)（CX 原规格）、demo [design/profile-layout-2026-11-19.html](design/profile-layout-2026-11-19.html)
> 仓库：站点 `F:\dsh\gameprice` + App `F:\dsh\steamdeals-app`

## 1. 已确认的决策（2026-11-19 所有者）

| # | 决策 |
|---|---|
| 1 | **头像永远由用户上传**：废弃「从 Steam 账号取头像」（`avatar_source='steam:<id>'` 退役） |
| 2 | **默认头像 = 昵称首字母（英文大写）/ 第一个汉字 + 品牌色圆底**（Web 与 App 统一，App 不再回退人形图标） |
| 3 | Steam 账号卡按钮**两行等宽**：第一行「查看已拥有 / 查看愿望单」，第二行「设为默认 / 解绑（红字）」 |
| 4 | 卡片保留「已拥有/愿望单」小数字；底部统计只留 **本站愿望单 / 到价提醒 / 史低命中** 三项（已拥有/愿望单总数放统计标题行） |
| 5 | 开关标签改「**到价提醒邮件**」+ 副说明「降价时发邮件提醒」；**Web 端同步**（同套布局） |

## 2. 现状（代码证据）

- `users.avatar_source` 三态：`null`（前端回退首字）/ `custom`（上传）/ `steam:<steamId>`（取该账号 Steam 头像）；
- **「设为默认账号」与头像耦合**：`setDefaultSteamAccount` 只写 `avatar_source='steam:<id>'`（pg.js）；
  `setDefaultSteamAccountIfUnset` 在绑定新账号且头像未设时自动写；`clearDefaultSteamIfMatches` 解绑时清；
  `isDefault` 判定 = `avatar_source === 'steam:'+steamId`（server.js:2375）——**没有独立的默认账号字段**；
- Web `UserAvatar.vue` 无头像回退首字；**App 回退人形图标**（不一致）；
- App 编辑资料页布局问题（2026-11-19 截图）：开关无标签（只显示「开启」）、账号卡按钮 2+2+1 排布（解绑/设为默认竖成窄条）、统计与卡片数字重复。

## 3. 数据与服务端

- **新增列** `users.default_steam_id text`（迁移 `alter table ... add column if not exists`）；
  **回填**：`update users set default_steam_id = split_part(avatar_source, ':', 2) where avatar_source like 'steam:%' and default_steam_id is null`；
- **头像解耦**：`update users set avatar_source = null where avatar_source like 'steam:%'`（头像回归未设置；用户可自行上传）；
- `setDefaultSteamAccount`：改为**只写 `default_steam_id`**，不再动 `avatar_source`；
- `setDefaultSteamAccountIfUnset`：**删除**（绑定新账号不再自动改头像）；
- `clearDefaultSteamIfMatches`：改为**只清 `default_steam_id`**（解绑默认账号不碰头像）；
- `isDefault` 判定（`/api/me` 的 accounts 数组）改读 `default_steam_id`；
- `/api/me/profile` 返回的 `avatarSource` 只可能是 `null`/`custom`。

## 4. 前端

### Web（`ProfilePage.vue` / `UserAvatar.vue`）
- 头像区只保留「上传头像 / 移除头像」；**删除「从 Steam 账号选头像」列表**；
- 默认头像：昵称首字母（英文大写）/ 第一个汉字 + 品牌色圆底（`UserAvatar.vue` 的 fallback 规则统一）；
- 账号卡改两行按钮；「设为默认」徽标读 `default_steam_id`；
- 统计区只留三项（本站愿望单/到价提醒/史低命中），已拥有/愿望单总数显示在「我的统计」标题行；
- 邮件提醒开关标签「到价提醒邮件 + 降价时发邮件提醒」。

### App（`ProfileEditScreen.kt` / `MeScreen.kt`）
- 与 Web 同套布局：头像上传/移除、账号卡两行按钮、统计三项、开关标签；
- 无头像回退改为**首字母 + 品牌色**（`MeScreen` 账号卡与资料页头像一致）。

## 5. Demo

`docs/design/profile-layout-2026-11-19.html` + 同名 `.png`：两种状态（默认首字头像 / 已上传头像）+ 两账号卡 + 统计三项 + 开关 + 吸底保存。

## 6. 验收（demo 状态 ↔ 断言）

| demo 状态 | 断言点 | 预期 |
|---|---|---|
| 默认首字头像 | 头像区 | 无上传时显示昵称首字母（英文大写）/第一个汉字 + 品牌色，非人形图标 |
| 已上传头像 | 头像区 | 显示 `/api/avatar/:userId`；有「移除头像」回到首字态 |
| 无「从 Steam 选头像」 | 页面结构 | 资料页不存在 Steam 头像来源选择（grep 无 `avatar_source` steam 选项） |
| 账号卡两行按钮 | 按钮布局 | 行1「查看已拥有/查看愿望单」等宽；行2「设为默认/解绑」等宽；窄屏不竖排 |
| 设为默认独立 | 数据 | 点「设为默认」只改 `default_steam_id`，头像不变（API 断言） |
| 统计去重 | 数字 | 卡片保留已拥有/愿望单数字；底部统计只有本站愿望单/到价提醒/史低命中 |
| 开关文案 | 文案 | 「到价提醒邮件」+ 副说明可见 |
| 解绑默认账号 | 数据 | 解绑后默认标记消失、头像不变（回填/回退正确） |

## 7. 待确认

无（5 项口径已定）。
