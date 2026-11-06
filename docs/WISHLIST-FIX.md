# 添加愿望单失败：链路审计与修复（待排查确认）

> 状态：**已审计；现象已补全（2026-11-06 13:38 截图），等一条 `adapter.steam.wishlist_add_failed` 日志定性**。
> 关联：[STEAM-ACCOUNTS.md](STEAM-ACCOUNTS.md)（多账号与愿望单同步）、[WEB.md](WEB.md)、[TODO.md](TODO.md) 的 AA 条目。

## 1. 现象

所有者反馈「添加愿望单功能失败」。**2026-11-06 补充到具体表现**：

1. 在多选弹窗里**勾选了 Steam 账号**并提交；
2. 游戏确实进了「愿望单」标签页（本站 `user_wishlist` 写入成功）；
3. 但**没有归属到该 Steam 账号**——卡片上看不到 `wishlisted_by` 的账号名，Steam 侧也没有；
4. 也就是：**只有"本站愿望单"生效，推送那一步没有发生**；
5. 前端提示原文：**「已加入本站愿望单；76561198268202591 推送失败」**（截图 2026-11-06 13:38）；
6. 后台「Steam 账号」页确认该账号**已配置 API Key**，详情页里显示「愿望单账号：本站」（`wishlisted_by` 为空）。

对应代码路径：`POST /api/wishlist` 里 `addUserWishlist()` 成功，但账号循环里 `pushWishlistItem()` 返回失败；
前端只显示"推送失败"与 steamid，**不显示 `reason`**（`Home.vue:257`），所以必须查日志才能知道 Steam 到底返回了什么。

## 2. 链路（代码事实）

```
首页卡片「愿望单」按钮（仅登录用户可见，Home.vue:40）
  └─ toggleWishlist(game)  Home.vue:253
       ├─ game.wishlisted === true → openWishlistRemove()（弹「移除愿望单」）
       ├─ 没有绑定账号 → addWishlist(game, [])            ← 只加本站
       └─ 有账号 → 弹「加入愿望单」多选（默认只勾选了"已配 API Key 且不在愿望单"的账号）
            └─ confirmWishlist() → addWishlist(game, steamIds)

POST /api/wishlist（server.js:1311）
  ├─ requireUser()                                      → 未登录 401
  ├─ db.gameDetail({appid | gameId})                    → 找不到 404
  ├─ addUserWishlist()  写 user_wishlist + watchlist（自动到价提醒）
  └─ 对每个所选账号：
       ├─ 已在 steam_wishlist → alreadyIn
       ├─ 账号未配 API Key → failed: 「该账号未配置 API Key」
       ├─ decryptSecret 失败 → failed: 「API Key 解密失败」
       └─ pushWishlistItem() → Steam IWishlistService/AddToWishlist
            ├─ 成功 → 写 steam_wishlist（乐观）→ added
            └─ 失败 → failed: 「Steam 推送失败」
```

## 3. 候选根因（已按截图收窄）

截图证明：**账号已配 API Key、已勾选、本站写入成功**，失败只出在 `pushWishlistItem()`。
`steam-accounts.js:256-262` 的判定是 `status < 400 && !explicitFail`，所以失败只有三种可能：

| # | 假设 | Steam 侧表现 | 代码证据 |
|---|---|---|---|
| 1 | **API Key 不被该接口接受**（`IWishlistService/AddToWishlist` 实际要 `access_token`） | HTTP 401 / 403 | `steam-accounts.js:237` 只传 `key/steamid/appid` |
| 2 | **Key 无效/被吊销/有空格**（复制错误） | HTTP 403 `Forbidden` | 同上，无 Key 校验步骤 |
| 3 | **账号隐私设置**（愿望单/详情非公开） | `success:false` 或 401 | `explicitFail` 判定 |
| 4 | 频率限制 | HTTP 429 | `http.js` 统一处理 |

> §16 规格里写的是"已查证可用 Web API Key"，但**没有真机验证记录**；本次是第一次真实失败样本。
> 结论必须以 `adapter.steam.wishlist_add_failed` 日志里的 `status` 与 `snippet` 为准。

### 需要的日志（只读，所有者执行）

首选应用自带的日志读取（读 `/app/logs/app-*.jsonl`，不受 `docker logs` 轮转 / 容器重启影响）：

```bash
docker exec steamdeals node /app/src/cli.js logs --event wishlist --since 360 --limit 30
```

兜底（容器 stdout）：

```bash
docker logs steamdeals --since 6h 2>&1 | grep -E 'wishlist' | tail -30
```

判读 **三分支**（第三种最容易被漏掉）：

| 日志形态 | 结论 | 下一步 |
|---|---|---|
| `adapter.steam.wishlist_add_failed` 且 `status=401/403` | 鉴权：Key 不被 `IWishlistService` 接受（假设 1）或 Key 无效/带空格（假设 2） | 用该账号 Key 手工打一次接口复核；再定是否改 `access_token` |
| 同上，`status=200` 且 `snippet` 含 `success:false` | Steam 拒绝写入（假设 3：隐私设置 / 接口语义） | 查账号隐私设置与该 appid 商店页 |
| 同上，`status=429` | 频率限制（假设 4） | 间隔重试即可，不改代码 |
| **只有 `steam.wishlist_manual_add`、没有 `wishlist_add_failed`** | 失败发生在调用 Steam **之前**：`api_key_set` 为真但 `decryptSecret` 失败（`SECRET_KEY` 变过 / 密文损坏），或该账号未配 Key | 查 `steam_accounts.api_key_enc` 能否解密；这条路径**当前没有独立日志**（`steam.wishlist_manual_add` 的 `failed` 只记 steamId，不记 reason），属 §4-1 要补的观测缺口 |

## 4. 无论根因如何都要修的产品缺陷

| # | 问题 | 位置 | 修法 |
|---|---|---|---|
| 1 | 服务端日志只记失败账号 id，**不记原因** | `server.js` 的 `steam.wishlist_manual_add`（`failed: failed.map(f => f.steamId)`） | 改为记 `{steamId, reason}`，排障靠它 |
| 2 | 前端提示只有"XX 推送失败"，**不显示原因** | `Home.vue:257` | toast 里带上 `reason`（未配 Key / 解密失败 / Steam 拒绝） |
| 3 | 弹窗里未配 API Key 的账号被**静默排除**在默认勾选外 | `Home.vue:253` | 账号项显示"未配置 API Key（不可推送）"并置灰 |
| 4 | 无绑定账号时**静默只加本站** | `Home.vue:253` | 提示「已加入本站愿望单；绑定 Steam 账号可同步推送」 |
| 5 | 多选全部为空时用户点确认 → 仅本站，但弹窗文案暗示"同时加入 Steam" | `Home.vue:82` | 空选时按钮改文案「仅加入本站」 |
| 6 | `game.steam_appid` 为 null 时无任何 Steam 动作，但提示与有推送时相同 | `server.js:1329` | 明确"该条目无 Steam AppID，仅本站" |

## 5. 需要所有者补充的信息（决定根因）

1. 是从**首页卡片**、**详情页**还是**手机详情底部栏**点的？
2. 点下去后**界面发生了什么**：弹窗标题是什么？有没有黄/红色提示？文案是什么？
3. 用的哪个账号、当时**是否登录**；后台「Steam 账号」页里该账号的 **API Key 是否显示已配置**？
4. 大约的时间点（用来查 `logs/app-*.jsonl` 里的 `steam.wishlist_manual_add` 与 `adapter.steam.wishlist_add_failed`）。

## 6. 验收（修复后）

1. 账号未配 API Key：弹窗中该项置灰并注明原因；确认后提示"本站已加入，Steam 未推送（未配置 API Key）"。
2. 正常账号：提示"已加入愿望单（推送到 N 个账号）"，Steam 侧可见，`steam_wishlist` 有行。
3. 已在 Steam 愿望单的游戏：按钮显示"✓ 愿望单"，点击进入移除流程（不再误以为添加失败）。
4. 未登录：按钮不显示；若会话过期导致 401，提示"登录已失效，请重新登录"。
5. 服务端日志 `steam.wishlist_manual_add` 含每个失败账号的原因。
6. `npm test` 全绿（新增 `test/wishlist.test.js` 覆盖 failed 原因透传与空选场景）。

## 7. 待确认

| # | 问题 | 默认 |
|---|---|---|
| 1 | 第 5 节四条信息 | 需所有者补充后才能定根因、写开发描述 |
| 2 | 无绑定账号时是否仍允许"仅本站愿望单"？ | 允许，但必须明确提示（不是删功能） |
