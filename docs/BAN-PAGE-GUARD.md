# 封禁页守卫：未封禁访问 `/banned` 返回首页

> 状态：**已实现并发布（v1.14.1，2026-11-03）**——tag `v1.14.1` 已推送触发镜像构建，
> 测试 `test/reviews.test.js` 19 项全绿。
> 关联：[FRONTEND-RENDER-FIX.md](FRONTEND-RENDER-FIX.md)（封禁页跳转最终方案，`__BAN_PAGE__` 注入）、
> [WEB.md](WEB.md)（页面表）、[TODO.md](TODO.md)（条目）。

## 1. 背景与现状（代码事实）

问题：`/banned` 目前**无条件**返回 403 封禁页，`reason` 固定为「访问受限」。于是没被封禁的人
（手动输入网址、收藏夹、封禁到期后刷新、管理员）会看到一个「解封时间：暂未设定」的假封禁页。

现状代码（v1.14.0）：

| 位置 | 行为 |
|---|---|
| `src/server.js:522-527` | `/banned` 直接 `serveBanPage()`，不判定 |
| `src/server.js:368-374` | 设备封禁：命中即 `denyBanned(403)`，**请求在这里就被拦下** |
| `src/server.js:378-406` | 频率/路径封禁：命中即 `denyBanned(429)`，同样提前拦下 |
| `src/server.js:408-414` | IP 黑名单：命中即 `denyBanned(403)`，同样提前拦下 |
| `src/server.js:305-317` | `denyBanned()`：浏览器给封禁页，API/脚本给纯文本 |

**关键事实：真正被封禁的请求根本走不到 522 行的 `/banned` 分支**——三道闸在它之前就已经返回封禁页了。
所以"到达 522 行"本身就等价于"当前请求没有被封禁"（或被管理员 bypass / 在白名单里）。

## 2. 已确认的决策

| # | 决策 |
|---|---|
| 1 | 判定口径 = **三类都算**（IP 黑名单 / 设备封禁 / 频率自动封禁），与拦截口径保持一致 |
| 2 | 跳转方式 = **服务端 302 + 前端兜底** |
| 3 | 管理员打开 `/banned`：**也跳首页**（管理员本来就有 bypass） |
| 4 | 封禁已过期（`banned_until` 是过去时间）：视为未封禁，**跳首页** |
| 5 | 停留在封禁页期间被解封：**不做**自动跳回（刷新即可） |

## 3. 方案

### 3.1 服务端：`/banned` 一律 302 到 `/`

把 522-527 的 handler 改成重定向（不再拼封禁页）：

```js
if (path === '/banned' || path === '/banned/') {
  logger?.info('ban.redirect_home', { ip, path });
  res.writeHead(302, { location: '/', 'cache-control': 'no-store', 'content-length': '0' });
  res.end();
  return;
}
```

到达这里 ⇔ 设备/频率/IP 三道闸都没拦下（见 §1），因此**不需要也不应该在这里再判一次**。
封禁用户看到封禁页的路径不变：任意 URL 被 `denyBanned()` 拦下 → 返回封禁页（`web/banned.html`
或无构建时的 `frontend/dist/index.html` + 注入的 `__BAN_PAGE__`）。

### 3.2 为什么不在这里二次判定（重要，别"补"回去）

1. **口径唯一**：判定已经在 §1 那三处做了；再写一份，将来改阈值/加封禁来源时必然漂移。
2. **会误伤管理员与白名单**：他们命中黑名单但 `adminBypass` / `whitelisted` 已经放行，
   二次判定会把已经放行的人又拉回封禁页——与决策 3 冲突。
3. **过期封禁自动正确**：`ratelimit.bannedUntil()`（`src/ratelimit.js:145`）在读取时就把过期条目清掉，
   过期后请求自然通过三闸 → 走 302，正好满足决策 4。
4. **只读约束**：判定链里的 `ratelimit.hit()` 有计数与三振副作用，不能在页面路由里再调一次。

> 若将来新增封禁来源（例如按账号封禁），**加在 §1 的拦截链里**，本路由保持"只做重定向"。

### 3.3 前端兜底：`BanPage.vue`

SPA 内部路由到 `/banned`（无服务端往返、拿不到 `__BAN_PAGE__`）时，`frontend/src/pages/BanPage.vue`
目前会用空对象渲染出假封禁页。加一行守卫：

```js
if (!window.__BAN_PAGE__) { window.location.replace('/'); }
```

- 真实封禁场景下 `__BAN_PAGE__` 一定由 `serveBanPage()` 注入，不会误跳；
- 用 `location.replace` 而不是 `router.replace`：避免新增 history 记录、也不用处理
  「ES module 提升导致 `createWebHistory` 已按旧地址初始化」这个已知坑（见 FRONTEND-RENDER-FIX §2）。
- 已知残留：曾在被封禁状态加载过页面（`__BAN_PAGE__` 残留在内存），之后 SPA 内部导航到 `/banned`
  仍可能显示旧内容。站内没有任何指向 `/banned` 的链接，实际触发概率可忽略，按决策 5 不额外处理。

### 3.4 响应与日志

| 项 | 值 |
|---|---|
| 状态码 | `302`（不做 301，避免浏览器永久缓存） |
| `location` | `/` |
| `cache-control` | `no-store` |
| 日志 | `ban.redirect_home` `{ ip, path }`（info）；替代原 `ban.page_direct` |
| 被封禁时的日志 | 保持原样：`ban.page`（warn）/ `block.ip_denied` / `rate.limited` / `device.denied` |

## 4. 影响面

| 文件 | 改动 |
|---|---|
| `src/server.js` | 522-527 改为 302；删除该分支对 `serveBanPage` 的调用（函数本身仍被 `denyBanned` 使用，保留） |
| `frontend/src/pages/BanPage.vue` | 顶部加 `__BAN_PAGE__` 缺失守卫 |
| `test/reviews.test.js` | 新增 4-5 条断言（见 §5）；现有的封禁/限流断言不动 |
| `docs/PROJECT-OVERVIEW.md` | 「封禁与申诉」行的行为补充：未封禁访问 `/banned` 直接回首页 |
| `docs/WEB.md` | 页面表 `/banned` 说明补一句 |
| `README.md` | 「访问安全」小节补一句（对外描述同步，随发版） |
| `CHANGELOG.md` | 随发版写入 |

**不受影响**：`web/banned.html`（无构建产物时的回退页，仍按 `__SITE_NAME__` 等占位符渲染）；
`__BAN_PAGE__` 注入逻辑；申诉页 `/appeal`（不在本改动范围，且继续放行封禁 IP）。

## 5. 验收

1. 未封禁访问 `GET /banned` → **302**，`location: /`，`cache-control: no-store`；跟随后是首页。
2. 未封禁访问 `GET /banned/`（带斜杠）→ 同样 302。
3. IP 黑名单命中 → `GET /banned` 仍返回 **403 封禁页**（含 `window.__BAN_PAGE__`），**不是 302**。
4. 设备封禁命中 → `GET /banned` → 403 封禁页；换 IP 也一样。
5. 频率封禁命中 → `GET /banned` → **429** 封禁页（沿用 `denyBanned` 的 status），带 `Retry-After`。
6. 管理员（IP 在黑名单里）访问 `/banned` → 302（bypass 生效）。
7. 封禁到期后访问 `/banned` → 302（过期即视为未封禁）。
8. SPA 内部导航到 `/banned` 且无 `__BAN_PAGE__` → 自动回首页，不出现"暂未设定"的假封禁页。
9. 日志：302 时出现 `ban.redirect_home`；被封禁时仍是 `ban.page`。
10. 通用验证：`node test/reviews.test.js` + `npm test` 全绿；**不自行打 tag / 触发构建**（硬规则 5）。

## 6. 实施顺序

1. `src/server.js` 改 302（最小改动，先让行为对上）；
2. `BanPage.vue` 加守卫；
3. `test/reviews.test.js` 补断言（302 / 403 / 429 / 管理员 bypass / 过期）；
4. 文档同步（PROJECT-OVERVIEW / WEB / README / CHANGELOG，随发版）；
5. 跑 `npm test` + `npm run frontend:build` + `npm run scan`。

## 7. 待确认问题

无（5 项决策已由所有者确认，见 §2）。
