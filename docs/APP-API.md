# App API 契约（CA-1 交付物，Android 按此开发）

> 状态：**已确认（2026-11-16）；CA-1 已发布 v2.22.0（2026-11-17，质检 ✅ docs/QA-CA1.md）**。适用：站点侧 **CA-1**（实现）与 Android **CG**（消费）。
> 规格：[APP-NATIVE.md](APP-NATIVE.md) §3（Token/命名空间）、§4（App 行为）；本文件是 App 唯一接口口径，**以本文件为准**。

## 1. 总则

- **Base**：`https://<站点域名>/api/app`；App 只调这个前缀。
- **前缀重写**：服务端对 `/api/app/<rest>` 去掉 `/api/app` 后按 `/api/<rest>` 路由（保留 query），
  **只对这个前缀豁免 IP 黑名单/设备封禁**；Web `/api/*` 行为完全不变。
- **精确例外**（先于重写匹配）：
  - `GET /api/app/latest`：现有 APK 清单接口，保持原实现，只补字段；
  - `GET /api/app/status`：新增，App 启动封禁检查。
- **请求头**：
  - `Authorization: Bearer <token>`（登录后）；
  - `X-Device-Id: <安装 UUID>`（App 首次启动生成并持久化；用于设备封禁检查）；
  - `X-App-Version: <versionName>`、`X-Client: steamdeals-android`（用于日志/排查，不参与鉴权）；
  - `Content-Type: application/json`。
- **错误格式**：统一 JSON `{ "error": "..." }`：
  - `400` 参数/验证码错误；`401` 未登录或 Token 失效（`{ "error": "login_required" }`）；
  - `404` 不存在；`429` 频率限制（带 `retryAfterSec` 与 `Retry-After`）；`5xx` 服务端错误。
- **限流**：App 命名空间**保留全局 API 基础限流**（当前 150 次/分钟/IP，可调），正常使用无感；429 时 App 不弹封禁提示。
- **不再使用 Cookie**：App 只用 Bearer；`/api/logout` 等 Cookie 语义不适用于 App。

## 2. 登录与账号

### 2.1 图形验证码

`GET /api/app/captcha`（匿名）

```json
{ "token": "一次性 token", "svg": "<svg>...</svg>" }
```

App 把 `svg` 渲染成位图显示；登录时回传 `token` 与用户输入。

### 2.2 登录（签发 Token）

`POST /api/app/auth/token`（匿名）

```json
// 请求
{ "username": "yyliucha", "password": "***", "captchaToken": "...", "captchaAnswer": "7KQ2", "rememberMe": true }
// 200
{ "token": "base64url-token", "expiresAt": "2026-12-16T...Z",
  "user": { "id": 1, "username": "yyliucha", "role": "admin", "mustChangePassword": false } }
```

- 验证码必填（`CAPTCHA_ENABLED=0` 时服务端会跳过，App 仍可传空）；
- 频率/锁定与 Web 一致：同 IP 15 分钟失败 ≥20 次 → 429；账号 5 次失败锁 15 分钟；
- 有效期：`rememberMe=true` 30 天、false 7 天；无 refresh token（v1）。

### 2.3 撤销 Token（退出）

`POST /api/app/auth/token/revoke`（Bearer）

```json
{ "ok": true }
```

### 2.4 当前用户

`GET /api/app/me`（Bearer 可带；匿名返回 user=null）

```json
{ "user": { "id": 1, "username": "...", "role": "user", "mustChangePassword": false } | null,
  "prefs": { "...": "..." } | null, "timezone": "Asia/Shanghai" }
```

### 2.5 偏好

`POST /api/app/prefs`（Bearer）——沿用现有 `/api/prefs` 请求体（主题等），返回 `{ prefs }`。

### 2.6 修改密码

`POST /api/app/user/password`（Bearer）

```json
{ "oldPassword": "***", "newPassword": "至少 12 位" }
```

成功 `{ "ok": true, "message": "密码已修改，其它设备已退出登录" }`；失败 400。

### 2.7 注册（可选，v1 不做 UI 也可保留接口）

- `POST /api/app/auth/register/request`：`{ "email": "..." }` → 发 6 位验证码（60s 冷却）；
- `POST /api/app/auth/register/verify`：`{ "email", "code", "username", "password" }` → 成功注册并返回登录态（按现有实现）。

## 3. 启动封禁检查

`GET /api/app/status`（匿名，豁免封禁拦截）

```json
{ "banned": true, "type": "ip" | "device" | null, "until": "2026-11-16T..." | null }
```

- 检查顺序：IP 黑名单（`visitors.blockedBy`）→ 设备封禁（按 `X-Device-Id` 对应指纹）；
- App 行为（见 APP-NATIVE §4.2）：`banned=true` → 原生不可取消对话框「你已经被封禁」+「已知晓」→ 退出 App；
- **无副作用**：不写库、不计数、不返回具体规则/证据。

## 4. 浏览（匿名可用）

### 4.1 游戏列表

`GET /api/app/games?page=1&pageSize=20&q=&sort=discount&interest=all&owned=exclude&type=all&released=all&region=cn&compact=0`

参数沿用现有 `/api/games`；返回：

```json
{ "games": [ { "id": 1, "steam_appid": 3008130, "name": "...", "name_en": "...",
               "current_low": 19800, "current_original": 29800, "currency": "CNY",
               "discount": 33, "heat": 123, "wishlisted": false, "interested": null, "owned": null } ],
  "total": 200508, "page": 1, "pageSize": 20, "pages": 10026,
  "sort": "discount", "owned": "exclude", "interest": "all", "q": "", "type": "all" }
```

### 4.2 搜索/愿望单筛选

`POST /api/app/games/search`（登录用户可带 `wishlist: true` 查本站愿望单）

```json
{ "q": "赛博朋克", "page": 1, "pageSize": 20, "wishlist": true }
```

返回同 4.1（`wishlist:true` 需登录；游客传了也无效）。

### 4.3 游戏详情

`GET /api/app/games/:appid`（匿名可读；登录后返回个人标记）

```json
{ "game": { "id", "steam_appid", "name", "name_en", "description", "...": "..." },
  "offers": [ { "platform_code": "steam", "platform_name": "Steam", "region": "cn",
                "price_cents": 19800, "original_cents": 29800, "discount_pct": 33,
                "buy_url": "https://..." } ],
  "series": [ { "day": "2026-11-16", "price_cents": 19800 } ],
  "dlc": { "total": 24, "synced": true, "filled": 20 },
  "watch": { "targetCents": 19800, "note": "...", "createdAt": "..." } | null }
```

> 字段以现有 `/api/games/:appid` 返回为准；App 不新增服务端字段（CA-1 只做前缀/鉴权）。
> 封面图不经此字段下发，App 用 `/img/steam/<appid>/header` 代理路径（§4.3 修复：原
> `header_image` / `flags` 与实际实现漂移，2026-11-18 以代码为准改为 `watch`）。

### 4.4 DLC 列表

`GET /api/app/games/:appid/dlc?page=1&pageSize=10`（匿名）

```json
{ "total": 24, "page": 1, "pageSize": 10, "synced": true,
  "items": [ { "appid": 2364740, "name": "...", "price_cents": 4800, "original_cents": 4800,
               "discount_pct": 0, "currency": "CNY", "in_stock": true,
               "buy_url": "https://store.steampowered.com/app/2364740/" } ] }
```

## 5. 用户操作（需 Bearer）

### 5.1 感兴趣 / 不感兴趣 / 已拥有

`POST /api/app/games/:appid/flags`（Bearer）

```json
{ "interested": true | false | "clear", "owned": true | false | "clear" }
```

返回 `{ "flags": { "interested": true|null, "owned": true|null } }`。
> 不感兴趣 = `interested:false`；清除 = `"clear"`。

### 5.2 愿望单

- 添加：`POST /api/app/wishlist`（Bearer）`{ "appid": 3008130 }` → `{ "ok": true, "site": true, ... }`；
- 移除：`DELETE /api/app/wishlist/:appid`（Bearer）→ `{ "ok": true, "siteRemoved": true, ... }`；
- 列表：`POST /api/app/games/search` body `{ "wishlist": true, "page": 1 }`（见 4.2）。

### 5.3 公告

- `GET /api/app/announcements`（匿名可读；登录返回 readIds）；
- `POST /api/app/announcements/read`（Bearer）`{ "ids": [1,2] }` → `{ "ok": true, "readIds": [1,2] }`。

## 6. App 更新清单

`GET /api/app/latest`（匿名；现有接口扩展字段）

```json
{ "version": "2.19.0", "versionCode": 21900, "minVersionCode": 21800,
  "apkPath": "/app/steamdeals-2.19.0.apk", "sha256": "…64 位…", "size": 1472278,
  "releasedAt": "2026-11-16", "notes": ["…"] }
```

- **CA-1 必须补** `versionCode`、`minVersionCode`、`notes`（缺失返回 null）；
- 发版时 `latest.json` 同步写这些字段；`versionCode` 规则沿用 `major*10000+minor*100+patch`。

## 7. 实现约束（CA-1）

1. 前缀重写：在请求入口、封禁判定**之前**识别 `/api/app/*`；先匹配 `/api/app/latest`、`/api/app/status`，
   其余按 `/api/<rest>` 路由；保留 method/query/body；
2. 黑名单/设备封禁：只对 App 命名空间跳过；Web `/api/*` 不变；`/api/app/status` 例外地**主动查**两类封禁；
3. Bearer：优先于 Cookie；`/api/app/*` 不读 Cookie；`401 login_required` 统一；
4. 频率限制：沿用全局 API 桶；不因 App 前缀而豁免；429 带 `retryAfterSec`；
5. 审计：`auth.token_issued` / `auth.token_revoked` / `app.status_checked`（不含 token 明文）；
6. 测试：前缀重写不影响 Web；`/api/app/status` 命中 IP/设备；公开接口匿名；用户接口 401；限流 429；
7. `/api/app/latest` 新字段缺失时返回 null，不 5xx；旧客户端不受影响。

## 8. 个人资料（CX，docs/USER-PROFILE-EDIT.md）

管理员与普通用户同一套接口，只能改自己；Web 与 App 共用。

### 8.1 当前用户（扩展）

`GET /api/app/me` 的 `user` 在 CA-1 基础上**新增本人资料字段**（昵称/简介/头像元信息/邮箱验证态）：

```json
{ "user": { "id": 1, "username": "...", "role": "user", "mustChangePassword": false,
            "email": "a@example.com", "emailVerified": true,
            "displayName": "昵称", "bio": "简介", "avatarSource": "steam:7656119…|custom|null",
            "avatarMime": "image/png|null", "avatarUpdatedAt": "…", "createdAt": "…" } | null,
  "prefs": { "theme": "dark", "email_alerts": true, "...": "..." } | null, "timezone": "Asia/Shanghai" }
```

### 8.2 保存资料

`PATCH /api/app/me/profile`（Bearer）

```json
{ "displayName": "昵称（2–20 字；管理员可为空串=清空）", "bio": "简介（≤200 字）",
  "theme": "light|dark|null（跟随系统）", "emailAlerts": true }
```

- 校验失败 400（昵称 2–20 / 简介 1–200，管理员昵称/简介可空）；`null` 字段 = 保持现值；
- 用户名/邮箱/角色/userId 一律忽略（只改 session 用户自己）；
- 200 返回 `{ "user": {…同上}, "prefs": {…} }`。

### 8.3 头像

- `POST /api/app/me/avatar`（Bearer）：`{ "dataUrl": "data:image/png;base64,…" }`——客户端裁剪 256×256，
  只接受 PNG/JPEG/WebP/GIF，dataUrl ≤512KB，服务端校验魔数；413 超限、400 格式/魔数不符。
  200 `{ "avatarSource": "custom", "avatarMime": "image/png", "avatarUpdatedAt": "…" }`；
- `DELETE /api/app/me/avatar`（Bearer）：移除自定义头像 → `avatarSource` 回 null；
- `GET /api/app/avatar/:userId`（公开）：`custom` → 输出字节（ETag/长缓存）；`steam:<id>` → 302 到该账号
  Steam 头像；无头像 404（客户端回退首字）。

### 8.4 Steam 账号卡

- `GET /api/app/me/library`（Bearer）：每账号一张卡 + 5 项统计：
  `{ "accounts": [ { "steamId", "name", "avatar", "owned", "wishlist", "lastSyncedAt", "boundAt", "isDefault" } ],
     "stats": { "ownedTotal", "wishlistTotal", "siteWishlist", "alerts", "histLowHits" } }`
  （Android 不显示 `lastSyncedAt`，其余同 Web）；
- `POST /api/app/steam/accounts/:steamId/default`（Bearer）：设为默认账号（头像默认取该账号）；
- `DELETE /api/app/steam/accounts/:steamId`（Bearer）：解绑（保留历史「曾拥有」；解绑默认账号会清空头像来源）；
- `GET /api/app/steam/accounts/:steamId/library?q=&page=&pageSize=`（Bearer）：库条目（返回 `games` 数组）；
- `GET /api/app/steam/accounts/:steamId/wishlist?q=&page=&pageSize=`（Bearer）：愿望单条目（返回 `items` 数组）。
  条目行：`{ "appid", "name", "name_en", "playtime_minutes", "last_played_at", "synced_at", "in_db", "current_low", "hist_low" }`，
  附 `total/page/pageSize` 分页；
- **新增绑定**：App 在系统浏览器打开 `<站点>/console/steam`（绑定流程复用站点会话），返回 App 后刷新列表。

## 9. 待确认（不阻塞）

1. 注册/邮箱验证码是否在 App 第一期开放（接口先预留）；
2. App 命名空间是否单独设置更宽松的限流阈值（默认沿用全局 150/分钟）；
3. `until` 是否需要在 App 弹窗展示（当前只显示「你已经被封禁」）。
