# URL 参数隐私化：敏感页面不再把信息放进 URL（待开发）

> 状态：**需求与方案已确认（2026-11-04），待开发**。方案 **A**（移除而非加密）。
> 关联：[BAN-AND-SECURITY-FIXES.md](BAN-AND-SECURITY-FIXES.md)（同一批：`/appeal` 守卫与服务端注入）、
> [WEB.md](WEB.md)（页面表）、[TODO.md](TODO.md)（条目）。
>
> 起因：所有者提出"所有 URL 跳转不要有明文，前后端都加密，避免爬虫拿敏感信息"。核对后按 **A** 落地。

## 1. 需求澄清（先纠正三个前提）

| 原假设 | 事实 | 依据 |
|---|---|---|
| URL 是明文传输的 | **已经是 TLS 加密传输**：HTTPS + `strict-transport-security: max-age=15552000; includeSubDomains` | `src/server.js:2784`；nginx 443 |
| 加密 URL 能防爬虫 | 爬虫不读他人地址栏，只抓公开链接与自己构造的参数。真实泄漏面是**分享/截图/浏览器历史、Referer、搜索收录、访问日志、缓存** | 本次报障的 URL 就是从手机历史里翻出来的 |
| 前端加密、后端解密 | 前端必须拿到对称密钥，等于公开。可行形态只有"**后端签发、前端原样带回**" | — |

**结论**：不加密，直接把敏感信息**移出 URL**（方案 A）——比"加密后仍放在 URL 里"更彻底，且零新依赖。

**范围**：只治理"敏感页面"，不做全站 URL 加密。全站盘点（`frontend/src` + `src`，9 处 URL 参数）中只有一处敏感：

| 位置 | 参数 | 敏感性 |
|---|---|---|
| `frontend/src/pages/BanPage.vue:17` | `/appeal?code&reason&until&email` | **高**（封禁原因、解封时间、申诉邮箱） |
| `Console.vue:57`、`AdminModules.vue:201` | `?section=` | 无 |
| `AdminExtras.vue:128` | `/api/auth/steam/start`（无参数） | 无 |
| 其余 5 处 | `location.replace('/')` 等 | 无 |

## 2. 已确认的决策

| # | 决策 |
|---|---|
| 1 | 采用 **A**：URL 只保留 `?code=AP-XXXXXX`，`reason` / `until` / `email` 三个参数彻底移除 |
| 2 | 范围只覆盖敏感页面（`/appeal`、`/banned` 及未来同类页面），**不做**全站 URL 加密 |
| 3 | 配套 5 项加固全做（§6） |
| 4 | 旧链接兼容：多余参数被忽略，并在前端用 `history.replaceState` 清洗地址栏 |

## 3. 现状（代码事实）

| 位置 | 现状 |
|---|---|
| `frontend/src/pages/BanPage.vue:17` | `appealRoute` 把 `code/reason/until/email` 全部写进 query |
| `frontend/src/pages/AppealPage.vue:7-10` | 从 `route.query` 读 `email`/`code`/`reason`/`until` |
| `frontend/src/pages/AppealPage.vue:52` | 页面展示「限制原因 / 解除时间」 |
| `frontend/src/pages/AppealPage.vue:14-23` | 申诉邮件正文包含原因与解除时间 |
| `src/server.js:69-95` | 封禁页由服务端注入 `window.__BAN_PAGE__`（站点名/邮箱/到期/原因/编号） |
| `src/server.js:441-455` | 访问记录只落 `url.pathname`，**不含 query**（现状安全） |
| `src/server.js` 全文 | **没有** `robots.txt` 路由或静态文件 |
| `src/server.js:70` | 申诉编号用 `Math.random()` 生成（**非密码学随机**） |

## 4. 目标形态

### 4.1 URL

```
/appeal?code=AP-XXXXXX
```

`reason`、`until`、`email` 不再出现在 URL，也不再出现在 history。

### 4.2 站点信息改由服务端注入

封禁用户**不能**调用 `/api/site`（会被拦截链 403），所以邮箱必须服务端注入——
与封禁页同一套做法（`src/server.js:81` 的 `replace('</head>', script)`）：

```js
if (appealPage) {
  const code = String(url.searchParams.get('code') ?? '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 16);
  const payload = JSON.stringify({ site: siteName(), email: appealEmail(), code }).replace(/</g, '\\u003c');
  // 注入 <script>window.__APPEAL__=${payload}</script> 后返回 index.html
}
```

- 与 [BAN-AND-SECURITY-FIXES.md](BAN-AND-SECURITY-FIXES.md) §3.2 的 `/appeal` 守卫**同一处改动**，一起做；
- 无 `frontend/dist/index.html`（无构建产物）时保持现状，不新增回退页；
- `code` 必须按白名单清洗并限长，防注入。

### 4.3 申诉页字段调整

| 项 | 改法 |
|---|---|
| 申诉编号 | 保留（来自 URL 的 `code`，或 `__APPEAL__.code`） |
| 限制原因 / 解除时间 | **不再展示**（封禁页仍展示）；邮件正文同步去掉这两行 |
| 申诉邮箱 | 取 `window.__APPEAL__.email`；为空时回退 `fetch('/api/site')`（仅本地 dev 无注入时生效） |
| 管理员如何核查 | 申诉编号已写入 `ban.page` 日志（含 `ip`/`until`/`reason`/`status`），按编号查即可 |

### 4.4 旧链接兼容

已流出的旧 URL（如 `?code=…&reason=…&until=&email=`）仍然可用：

1. 页面只读 `code`，忽略其余参数；
2. 挂载后 `router.replace({ path: '/appeal', query: { code } })` 清洗地址栏与 history（不留明文）。

## 5. 服务端改动清单

| 改动 | 说明 |
|---|---|
| `/appeal` 由静态改为注入式返回 | 复用 `serveBanPage` 的注入方式；与守卫合并在同一分支 |
| `code` 输入清洗 | `/^[A-Za-z0-9-]{1,16}$/`，非法则按空处理（不报错、不反射） |
| `robots.txt` 路由 | 无静态文件，新增 `GET /robots.txt`：`Disallow: /console`、`/banned`、`/appeal`、`/api/` |
| `X-Robots-Tag` | `/banned*`、`/appeal*` 响应加 `noindex, nofollow` |
| `Cache-Control` | `/appeal` 加 `no-store`（`/banned` 已有） |
| 申诉编号改用密码学随机 | `crypto.randomBytes(4)` → 去易混字符（如 `0/O/1/I`）映射成 6 位，保留 `AP-` 前缀 |

## 6. 配套加固 5 项

| # | 项 | 落点 |
|---|---|---|
| 1 | 申诉编号改 `crypto.randomBytes` | `src/server.js:70` |
| 2 | `X-Robots-Tag: noindex, nofollow` + `robots.txt` | 服务端响应头 + 新路由 |
| 3 | `/appeal` 补 `Cache-Control: no-store` | 服务端 |
| 4 | 日志不落 query | 应用侧现状已满足（`server.js:441-455`）；若运维开启 nginx 日志，格式用 `$uri` 而非 `$request` |
| 5 | 任何"按 code 查上下文"的接口必须限流 | 本方案不新增此类接口；写进约束，供未来服务端申诉（[APPEAL-SYSTEM.md](APPEAL-SYSTEM.md)）遵守 |

## 7. 影响面

| 文件 | 改动 |
|---|---|
| `src/server.js` | `/appeal` 注入 `__APPEAL__`（与守卫同处）；`robots.txt`；敏感页响应头；`code` 改 crypto 随机 |
| `frontend/src/pages/BanPage.vue` | `appealRoute` 只保留 `code` |
| `frontend/src/pages/AppealPage.vue` | 读 `__APPEAL__`；去掉原因/到期展示与邮件正文对应行；`replaceState` 清洗旧参数 |
| `test/reviews.test.js`（或新增 `test/appeal-url.test.js`） | 见 §8 |
| `docs/WEB.md`、`docs/PROJECT-OVERVIEW.md`、`README.md`、`CHANGELOG.md` | 页面表与安全小节同步（随发版） |

## 8. 验收

1. 被封禁访问任意页面 → 封禁页 → 点「申请解封」→ 地址栏为 `/appeal?code=AP-XXXXXX`，**不含** `reason`/`until`/`email`。
2. 申诉页正常渲染，显示申诉编号；不再显示"限制原因/解除时间"。
3. 申诉邮件正文含编号、联系邮箱、说明，不含原因/解除时间。
4. 打开旧格式 URL（带 4 个参数）→ 页面可用，且地址栏被清洗成只剩 `?code=`。
5. 响应头：`/appeal` 有 `cache-control: no-store` 与 `x-robots-tag: noindex, nofollow`；`GET /robots.txt` 返回 Disallow 列表。
6. 申诉编号形如 `AP-XXXXXX`，连续生成 100 个无重复、字符集不含 `0/O/1/I`。
7. 空 `code` 或非法 `code`（含 `<`、超长）→ 页面正常、不反射输入。
8. 通用验证：`npm test` 全绿、`npm run frontend:build`、`npm run scan`；**不自行打 tag**（硬规则 5）。

## 9. 明确不做

- **全站 URL 加密**：搜索 `?q=`、分页、`/console?section=` 等保持原样（加密会破坏分享/刷新/调试/缓存，且无安全收益）。
- **前端加密**：前端不持有密钥。
- **可逆加密承载业务参数**：方案 A 已不需要；若未来确需无状态，再评估 AES-256-GCM（复用 `email-auth.js` 的 `encryptSecret/decryptSecret`）。
- **URL 缩短服务**：引入外部依赖，收益不抵风险。

## 10. 待确认

无（方案 A、范围、加固 5 项均已在 2026-11-04 确认）。
