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
               "discount_pct": 33, "heat": 123, "wishlisted": false, "interested": null, "owned": null } ],
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
{ "game": { "id", "steam_appid", "name", "name_en", "header_image", "description", "...": "..." },
  "offers": [ { "platform_code": "steam", "platform_name": "Steam", "region": "cn",
                "price_cents": 19800, "original_cents": 29800, "discount_pct": 33,
                "buy_url": "https://..." } ],
  "series": [ { "day": "2026-11-16", "price_cents": 19800 } ],
  "dlc": { "total": 24, "synced": true, "filled": 20 },
  "flags": { "interested": null, "owned": null, "wishlisted": false } | null }
```

> 字段以现有 `/api/games/:appid` 返回为准；App 不新增服务端字段（CA-1 只做前缀/鉴权）。

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

## 8. 待确认（不阻塞）

1. 注册/邮箱验证码是否在 App 第一期开放（接口先预留）；
2. App 命名空间是否单独设置更宽松的限流阈值（默认沿用全局 150/分钟）；
3. `until` 是否需要在 App 弹窗展示（当前只显示「你已经被封禁」）。
