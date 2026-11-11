# 封禁与安全修复批次：仅封禁可见页面统一守卫 + 黑白名单互斥 + 待审口径

> 状态：**已实现并发布（v1.14.2，2026-11-04）**——tag `v1.14.2` 已推送触发镜像构建；
> 测试 reviews 24 项 / visitors 8 项 / admin-bulk 13 项 / appeal-security 6 项全绿。
> 起因：v1.14.1 上线后所有者实测三处问题——① 手机端打开 `/banned` 未跳首页；② 同一 IP 可同时出现在黑/白名单；
> ③ 「只看待审」筛选后为空，但「全部（审计）」里能看到大量状态为「待审」的行。
> 关联：[BAN-PAGE-GUARD.md](BAN-PAGE-GUARD.md)（上一版封禁页守卫）、[ADMIN-PARITY.md](ADMIN-PARITY.md)（审核联动的前身）、
> [WEB.md](WEB.md)（后台模块）、[URL-PARAM-PRIVACY.md](URL-PARAM-PRIVACY.md)（申诉页 URL 去敏感化，与本批共用同一处服务端改动）、[TODO.md](TODO.md)。

## 1. 现状与根因

### 1.1 问题一：手机端打开 `/banned` 没有跳首页

**代码事实**：服务端没有任何按 UA / 移动端分支的逻辑（`src/server.js` 全文件无 `user-agent` / `mobile` 判断），
`/banned` 的 302 在 `src/server.js:528-533`，PC 与手机走同一条代码。所以不是"手机端没实现"。

三种可能，需要证据区分：

| 可能 | 机制 | 证据 |
|---|---|---|
| ① 手机当时确实被封 | 设备封禁 / 频率封禁 / IP 黑名单在 `src/server.js:369-414` 先 `denyBanned` 返回封禁页，**根本到不了 302** | 同一分钟有 `device.denied` / `rate.limited` / `block.ip_denied` |
| ② 客户端路由进入 | 申诉页底部「← 返回访问受限说明」是 `<router-link to="/banned">`（`frontend/src/pages/AppealPage.vue:49`），不走服务端；若该标签页**曾封禁过**，`window.__BAN_PAGE__` 残留 → 守卫不触发 | 手机是从申诉页点进去的 |
| ③ 旧地址 `/banned.html` | 只有 `/banned` 与 `/banned/` 会 302，`.html` 走静态 → SPA → 守卫，链路更长且依赖 JS | 书签/收藏夹是 `banned.html` |

**当前症状**：所有者在 `docker logs` 中没看到任何相关日志。

### 1.1.1 实测结论（2026-11-04，服务器只读诊断）

| 检查 | 结果 | 判读 |
|---|---|---|
| 容器版本 | `steamdeals` 1.14.1，healthy，`127.0.0.1:8520→8080`，前置 **nginx** 80/443 | 手机走公网 → nginx → 容器；日志里是真实客户端 IP，`XFF` 透传正常 |
| 容器内自测 `/banned`（PC UA + iPhone UA） | **两者都 302，`location: /`** | 302 逻辑本身没问题，不存在"手机端没实现" |
| 日志级别 | `LOG_LEVEL` 未设置 = info | `ban.redirect_home`(info) 本该进 docker logs |
| 日志 | 10:16:52 / 10:17:22 出现 4 条 `ban.redirect_home`（`ip=127.0.0.1`） | 自测命令产生，链路与日志都正常 |
| 日志 | **11-04 09:33–09:49 连续 4 条 `block.ip_denied`，`ip=101.82.244.116`**（路径 `/api/me`、`/favicon.ico`） | **该 IP 当时在黑名单里**，被 `src/server.js:408-414` 的拦截链在到达 302 之前就 `denyBanned` 了 |
| 日志 | **11-03 23:24:30 连续 3 条 `ban.page_direct`，`ip=183.192.9.122`** | v1.14.0 旧版本的"直接打开 `/banned` 给假页面"行为，即最初报障的那次 |

**结论**：v1.14.1 的 302 有效；手机端看到的"不跳转"是**当时该出口 IP 正处于黑名单**（403 封禁页），
属于"被封禁"而不是"未封禁"。`ban.page_direct` 那三条则证明最初的问题在旧版本上确实存在，已由 v1.14.1 修掉。

**同时暴露**：`101.82.244.116` 既在黑名单又在白名单（问题二），让人误以为"没被封"；
而它 09:33 被拦下说明**白名单是在那之后才加的**——正是这种可并存设计带来的误判。
**待复核**：手机当前出口 IP 尚未取到（诊断命令 ④ 用了占位符 `手机出口IP`，查询全空，未生效）。

### 1.1.2 二次诊断（2026-11-04 追加，事件级日志）

| 时间 | 事件 | 说明 |
|---|---|---|
| 09:33:36 | `api.ip_blocked` `101.82.244.116` by sunboxiang | **是管理员自己把该 IP 加进黑名单的**，不是系统自动封 |
| 09:33:38 / 09:33:43 | `block.ip_denied` `/api/me` | 紧接着被拦，符合预期 |
| 09:33:50 | `api.ip_unblocked` `removed:1` | 解封 |
| 09:33:52 | `api.ip_blocked` | **2 秒后又被封回**（同一 IP） |
| 09:38:48 / 09:49:11 | `block.ip_denied` `/favicon.ico` | 仍被拦 |
| 09:53:48 → 09:54:20 | 解封 → 再封 | 又一次"解封后立刻封回" |
| **10:17:12** | `api.ip_unblocked` `removed:1` | 最后一次已解封，之后无拦截记录 |

**新增的关键事实**：自 11-03 23:24 之后，**没有任何真实 IP 请求过 `/banned`**——所有 `ban.redirect_home`
都来自 `127.0.0.1`（自测）。也就是说手机那次"没跳首页"要么发生在升级前（23:24 的 v1.14.0 假页面），
要么**请求根本没到 Node 进程**，两种可能：

1. **客户端路由 + 残留 payload**：从申诉页「← 返回访问受限说明」（`<router-link to="/banned">`）进入，
   不走服务端；该标签页曾封禁过 → `window.__BAN_PAGE__` 残留 → `BanPage.vue` 的 `!window.__BAN_PAGE__`
   守卫判为"有 payload"，于是**不跳转**，渲染出旧封禁页。**这种情况不会产生任何服务端日志**，与现状完全吻合。
2. **nginx 层直接返回**：`docker ps` 显示前置 nginx（80/443）→ 容器 `127.0.0.1:8520`。若 nginx 对
   `/banned` 或 `/banned.html` 有静态映射/缓存，请求不会到 Node，同样零日志。

**阶段性结论**：v1.14.1 的服务端 302 已被证明有效；剩余风险集中在**进入方式**（客户端路由）与**前置 nginx**。
因此方案一除了入口收敛，必须补一条**客户端复查**（§3.4），否则"零日志但不跳转"永远查不到。

### 1.1.3 三次诊断（2026-11-04 追加，nginx 层）

| 检查 | 结果 | 判读 |
|---|---|---|
| `docker logs nginx \| grep /banned` | **空** | 不能作为证据——见下一行 |
| nginx 配置 | `access_log /var/log/nginx/access.log main;`（全局，第 23 行）**被两个 server 块内的 `access_log off;`（第 162、245 行）覆盖** | **站点访问日志是关闭的**，nginx 侧完全没有观测数据 |
| nginx 站点配置 | steamdeals 块只有 `location / { proxy_pass http://steamdeals$request_uri; }`，无 `/banned` 静态映射 | nginx **不会**自己返回假封禁页（缓存未配，未发现 `proxy_cache`） |
| app 侧 `logs --event ban` | 升级后仍只有 `127.0.0.1` 的 `ban.redirect_home` | 手机**没有发出过**新的 `/banned` 请求 |

**运维缺口（建议，属部署侧，不在开发范围）**：两个 server 块都写了 `access_log off;`，导致"某个端访问异常"时
无法判断请求是否到达 nginx。建议至少对 4xx/5xx 打开日志，或改回 `access_log /var/log/nginx/access.log main;`
（注意扫描器流量大，日志会明显增长，建议配合 `map` 只记非 200 或启用轮转）。

### 1.1.4 真实根因定案（2026-11-04，所有者提供手机 URL）

所有者手机实际打开的是：

```
https://sd.yyliucha.cn/appeal?code=AP-IZSVJ8&reason=访问被拒绝&until=&email=
```

**是 `/appeal`（申诉页），不是 `/banned`（封禁页）。**

| 事实 | 证据 |
|---|---|
| `/appeal` 被**故意豁免**所有封禁判定（被封禁的人才进得来申诉） | `src/server.js:341` `const appealPage = path === '/appeal' \|\| path === '/appeal/';`，三处判定都在 `!appealPage` 才执行：`src/server.js:369`（设备）、`src/server.js:378`（频率）、`src/server.js:409`（IP 黑名单） |
| v1.14.1 的 302 只覆盖 `/banned` 与 `/banned/` | `src/server.js:528`，没有任何 `/appeal` 分支 |
| 申诉页不走服务端判定，也不记日志 | `/appeal` 直接由 `serveFrontendStatic` 返回 `index.html`，无 logger 调用 |
| 该项目**原本就"没有这个功能"**与所有者描述完全一致 | 未封禁用户打开 `/appeal` 永远能看到申诉表单，永远不会跳首页 |

**定案**：问题一的真因是**申诉页没有守卫**，而不是封禁页的 302 失效、也不是手机缓存。
之前三轮排查（v1.14.0 假页面、HTTP 黑名单 403、nginx 无日志）都只是过程中的干扰项，已各自排除或单独修复。

**顺带发现**：该 URL 的 `email=` 为空，说明生成这个封禁页时 `APPEAL_EMAIL` 未配置
（回退链：`APPEAL_EMAIL` → `ALERT_EMAIL_TO` → `SMTP_FROM` → `SMTP_USER`，见 `src/appeal.js`）。
申诉页会显示"管理员尚未配置申诉邮箱"，申诉邮件也没有收件人——**建议单独确认线上是否漏配**（不属本批代码范围）。

### 1.2 问题二：黑白名单可并存

**证据**：两边的写入各自只写一张表，互不清理——
`src/store/pg.js:1511 addBlockedIp` 只 `insert ip_blacklist`，`src/store/pg.js:1531 addWhitelistIp` 只 `insert ip_whitelist`；
单条接口 `src/server.js:2196` / `src/server.js:2225`、批量 `src/server.js:2649-2666` 同样。

**更麻烦**：运行时是**白名单胜出**——`src/server.js:408` 是 `!whitelisted` 才查黑名单。
所以两边都在时黑名单形同虚设；一旦删掉白名单，黑名单会**突然复活**。

### 1.3 问题三：待审筛选为空

两个缺陷叠加：

1. **状态标签缺分支**（确定性 bug）：`frontend/src/pages/AdminModules.vue:33` 的标签只有
   `auto_banned → 自动退出` 与 `其他 → 待审`；而实际状态有 4 种（`pending` / `approved` / `rejected` / `auto_banned`）。
   于是**已封过 IP 的 approved、已忽略的 rejected 也显示成「待审」**。
2. **`NOT_ACTIVE_BAN` 二次过滤**（`src/store/pg.js:1723`，计数 `src/store/pg.js:1775` 同样）：
   把"IP 当前处于临时封禁"的 pending 行从待审视图隐藏。但 v1.9.0 起封禁动作已把旧 pending 标成
   `auto_banned` 永久退出待审，这层过滤现在只会藏掉**封禁期间新产生**的 pending 记录——恰恰是最该看的，
   而且状态列还写着「待审」，与界面说明自相矛盾。

## 2. 已确认的决策

| # | 决策 |
|---|---|
| 1 | 三块合并为**一批**实施、一份规格（本文件） |
| 2 | 待审口径选 **A**：待审视图 = 所有 `pending`（去掉 `NOT_ACTIVE_BAN`），状态列补全 4 种标签，计数同步 |
| 3 | 黑/白名单**双向互斥**：加黑自动移白、加白自动移黑，含内存态同步与接口回执 |
| 4 | 存量冲突按**白名单优先**清理（删黑名单），与当前运行时行为一致，不改变线上表现 |
| 5 | CIDR 只处理**完全相同**的条目；包含关系（`1.2.3.0/24` 黑 vs `1.2.3.5` 白）不自动删，运行时仍白名单胜出 |
| 6 | 封禁页入口收敛**不依赖根因**先做（见 §3），根因待 §9 诊断结果确认后再补 |
| 7 | **`/appeal`（申诉页）也要守卫：未封禁访问一律 302 回首页**，被封禁者保持可申诉（§3.2，问题一的真修复） |
| 8 | **"仅封禁可见"的页面统一治理**：登记进 `BAN_ONLY_PAGES` 即自动获得守卫；未封禁一律 302 回首页（§3.1–3.2） |
| 9 | **解封后不得继续显示该类页面**：客户端每 30 秒 + 切回标签页复查，解封即自动回首页（§3.3–3.4）；为此新增只读接口 `/api/ban/state` |

## 3. 方案一：仅封禁可见页面的统一守卫（问题一）

所有者要求（2026-11-04）：**"类似的功能都要加处理——只有被封禁的访问者才该看到的页面，一旦解封就不能再看到，直接回首页。"**
所以这里不做逐页补丁，而是抽象成**一类页面 + 一个守卫 + 一套客户端复查**，以后新增同类页面只需登记一次。

### 3.1 定义：什么是"仅封禁可见页面"

| 页面 | 用途 | 未封禁时 | 被封禁时 |
|---|---|---|---|
| `/banned`、`/banned/`、`/banned.html` | 封禁提示页 | **302 → `/`** | 显示封禁页（真因/到期时间） |
| `/appeal`、`/appeal/` | 申诉页 | **302 → `/`** | 显示申诉页（申诉入口必须可用） |
| 以后新增的同类页面 | — | 302 → `/` | 正常显示 |

登记方式：`src/server.js` 顶部集中一个集合，新增页面必须加进来（测试会遍历它，漏登记直接红）：

```js
// 仅被封禁者可见的页面：未封禁访问一律 302 回首页（docs/BAN-AND-SECURITY-FIXES.md §3）
const BAN_ONLY_PAGES = new Set(['/banned', '/banned/', '/banned.html', '/appeal', '/appeal/']);
```

### 3.2 服务端：一个只读判定 + 一个统一出口

判定函数（**只读**，不产生任何计数或状态变更）：

```js
// 复用拦截链里已经算好的 deviceBan（368 行）与 hit（408 行），避免两套口径；
// 频率封禁只能读 bannedUntil()：hit() 会累计三振，禁止在页面路由调用。
const banState = () => {
  if (adminBypass || whitelisted) return null;          // 管理员 / 白名单视为未封禁
  if (deviceBan) return { type: 'device', until: deviceBan.until };
  const rateUntil = ip ? ratelimit.bannedUntil(ip) : null;
  if (rateUntil) return { type: 'rate', until: rateUntil };
  if (hit) return { type: 'ip', rule: hit };
  if (ip && visitors.blockedBy(ip)) return { type: 'ip' };  // hit 为 null 时兜底（如私有 IP 场景）
  return null;
};
```

统一出口（放在拦截链之后、静态资源之前）：

```js
if (BAN_ONLY_PAGES.has(path) && banState() === null) {
  logger?.info('ban.redirect_home', { ip, path, from: 'ban_only_page' });
  res.writeHead(302, { location: '/', 'cache-control': 'no-store', 'content-length': '0' });
  res.end();
  return;
}
```

说明：

- `/banned` 的封禁用户永远到不了这里（拦截链先 `denyBanned` 了），所以它实际总是 302——与 v1.14.1 现状一致；
- `/appeal` 是被拦截链豁免的，这里才第一次真正判定：未封禁 → 302，被封禁 → 继续走静态资源渲染申诉页；
- **不在 `/banned` 分支做二次判定**（保持 [BAN-PAGE-GUARD.md](BAN-PAGE-GUARD.md) §3.2 的原则），判定只在这一处。

### 3.3 新增只读状态接口 `GET /api/ban/state`

自动复查（§3.4）需要一个**既能被已封禁者调用、又不会加重封禁**的接口。现有 `/api/site` 不能用：
它是被封禁者访问时会被拦截链拦下，而且频率封禁者每请求一次都会走 `ratelimit.hit()`，
**轮询会累计"违禁请求"并可能把封禁升档**（10 分钟 → 30 分钟 → 当天）。

所以新增一个极轻的只读接口：

```http
GET /api/ban/state        （无需登录；豁免拦截链与频率计数；自带限流）
200 { "banned": false }
200 { "banned": true, "type": "ip" | "device" | "rate", "until": "2026-11-04T11:00:00.000Z" | null }
```

实现要点：

| 点 | 说明 |
|---|---|
| 位置 | 拦截链**之前**处理（与 `/appeal` 同为豁免路径），否则封禁者拿不到自己的状态 |
| 无副作用 | 只用内存态：`devices.isBanned`、`ratelimit.bannedUntil`、`visitors.blockedBy`；**不查库、不计数** |
| 自带限流 | 每 IP 最多 1 次/秒、30 次/分钟（内存 Map，超限返回 429 `{}`），防止被当成探测接口 |
| 不泄漏 | 只返回调用者自己的状态，不含名单内容、不含他人 IP |

### 3.4 客户端：共享 composable `useBanOnlyPage`

`frontend/src/composables/useBanOnlyPage.js`（`BanPage.vue`、`AppealPage.vue` 及以后同类页面共用）：

```js
export function useBanOnlyPage({ intervalMs = 30000 } = {}) {
  let timer = null;
  const check = async () => {
    try {
      const r = await fetch('/api/ban/state', { headers: { accept: 'application/json' }, cache: 'no-store' });
      if (r.status === 429) return;            // 限流：本轮跳过，不误跳
      const data = await r.json();
      if (data.banned === false) window.location.replace('/');   // 已解封 → 立即回首页
    } catch { /* 离线：保持当前页 */ }
  };
  onMounted(() => { check(); timer = setInterval(check, intervalMs); });
  onUnmounted(() => clearInterval(timer));
  // 切回标签页时立即复查（手机切后台再回来最常见的场景）
  // document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
}
```

行为：

1. **挂载即查**：覆盖"客户端路由进入 / bfcache 恢复 / 残留 `__BAN_PAGE__`"这些零日志场景；
2. **每 30 秒复查**：解封后最多 30 秒自动回首页，满足"解封后不能再看到该页面"；
3. **切回标签页复查**：手机端主要场景（后台回来立刻生效）；
4. **限流/离线不跳**：避免误判把正在申诉的人踢走。

### 3.5 其他加固项（一并做）

| 项 | 内容 |
|---|---|
| `/banned.html` 归入注册表 | 当前只有 `/banned`、`/banned/` 会 302（`src/server.js:528`），`.html` 走静态 → SPA → JS 守卫这条长链路 |
| 申诉页「返回」链接 | `frontend/src/pages/AppealPage.vue:49` 的 `<router-link to="/banned">` 改为 `/`，不该把用户送回封禁页 |
| 申诉页 URL 去敏感化 | `/appeal` 改为服务端注入 `window.__APPEAL__`、URL 只留 `?code=`，与 [URL-PARAM-PRIVACY.md](URL-PARAM-PRIVACY.md) 方案 A 是同一处改动 |
| `ban.page_view` 日志 | 拦截链与注册表分支各记一条：`{ ip, path, mobile, at: 'gate'|'ban_only', reason }`，下次"某个端不生效"能直接定位 |

### 3.6 为什么要改掉"用 `/api/site` 复核"的初版想法

初版（本文件 v1 稿）打算复用 `/api/site` 做客户端复核，实现后发现问题：

- 封禁者的 `/api/site` 会被拦截链拦下 → 返回 403 纯文本，客户端只能靠状态码猜；
- **频率封禁者每轮询一次就 `hit()` 一次**，`blockedEscalate` 达标后封禁升档 → **页面开着反而被越封越久**；
- 无法区分"IP/设备/频率"，也无法拿到真实到期时间。

所以改为 §3.3 的专用只读接口。这是**有意放开的一个例外**：只读、无副作用、自带限流、只回自己的状态，
不放行任何业务接口。

## 4. 方案二：黑/白名单互斥（问题二）

### 4.1 规则

| 动作 | 副作用 | 接口回执 |
|---|---|---|
| 加入黑名单 | 删除同 IP 的白名单条目 + `ratelimit.removeWhitelist(ip)` + `visitors.refreshBlocklist(q)` | `{ ..., removedFromWhitelist: true }` |
| 加入白名单 | 删除同 IP 的黑名单条目 + `visitors.refreshBlocklist(q)` + `ratelimit.addWhitelist(ip)` | `{ ..., removedFromBlacklist: true }` |
| 移除白名单 | 只删白名单（黑名单不会"复活"，因为互斥后不可能同时存在） | `{ removed }` |

### 4.2 收敛到一个 helper

新增 `banIpExclusive(q, { ip, note, kind: 'ban'|'trust' })`（`src/server.js` 内，SQL 仍在 `src/store/pg.js`），
替换 4 个调用点：
`POST /api/admin/blacklist`（2196）、`POST /api/admin/whitelist`（2225）、
待审「封 IP」（2369 附近）、批量 `visitors/ban-ip` 与 `visitors/trust`（2649-2666）。

### 4.3 存量清理（迁移）

`src/store/pg.js` 的 `migrate()` 追加幂等清理：

```sql
-- 白名单优先：同时存在于两表的 IP，删掉黑名单那条（与运行时"白名单胜出"一致）
delete from ip_blacklist b
 using ip_whitelist w
 where b.ip = w.ip;

-- 顺手清掉被白名单覆盖的临时封禁记录，避免「白名单里却显示正在封禁」
update ip_abuse a
   set banned_until = null
  from ip_whitelist w
 where a.ip = w.ip and a.banned_until is not null;
```

迁移后 `visitors.refreshBlocklist()` / `ratelimit.removeWhitelist()` 由启动流程自然重建内存态。

### 4.4 边界

- **CIDR 包含关系不自动清理**，只在加入时提示"该网段与白名单 X 重叠"（不阻断）；
- 批量操作逐条应用同一规则，回执里带每条的 `removedFrom*` 标记。

## 5. 方案三：待审口径与状态标签（问题三）

### 5.1 去掉 `NOT_ACTIVE_BAN`

- `src/store/pg.js:1723` 删除该常量，`listAbuseReviews` 的 `where` 只保留状态条件；
- `src/store/pg.js:1775 countPendingReviews` 同步去掉，保证**待审计数 = 待审列表条数 = 侧栏角标**。

### 5.2 状态列补全 4 种标签

`frontend/src/pages/AdminModules.vue:33`：

| status | 标签 | 颜色 | 备注 |
|---|---|---|---|
| `pending` | 待审 | success | 可勾选、可批量操作 |
| `approved` | 已封禁 | danger | 悬停显示 `note` 与 `reviewed_at` |
| `rejected` | 已忽略 | info | 同上 |
| `auto_banned` | 自动退出 | info | 封禁发生时自动退出待审的旧记录 |

同时把「操作」列的按钮条件保持 `status === 'pending'`（approved/rejected 不可再操作）。

### 5.3 文案更新

`AdminModules.vue:32` 的说明改为：「系统记录异常但不自动永久封禁；审核后可封 IP、封设备或忽略。
封禁发生时该 IP 的旧待审会标记为 `auto_banned` 永久退出待审（「全部」视图可查）；
**封禁期间产生的新异常仍会以「待审」出现**（状态列可据此判断是否已处理）。」

## 6. 影响面

| 文件 | 改动 |
|---|---|
| `src/server.js` | **仅封禁可见页面守卫（§3.1–3.4：注册表 + 服务端 302 + `/api/ban/state` + `useBanOnlyPage`）**；`/banned.html` 归入注册表；`ban.page_view` 日志；`banIpExclusive` helper 替换 4 处调用 |
| `src/store/pg.js` | `listAbuseReviews` / `countPendingReviews` 去掉 `NOT_ACTIVE_BAN`；新增互斥用的删除与清理 SQL；`migrate()` 加存量清理 |
| `frontend/src/pages/AdminModules.vue` | 状态列 4 种标签 + 悬停信息；说明文案 |
| `frontend/src/composables/useBanOnlyPage.js` | **新增**共享复查 composable（挂载 + 30s 轮询 + visibilitychange，§3.4） |
| `frontend/src/pages/BanPage.vue` | 使用 `useBanOnlyPage`（§3.4） |
| `frontend/src/pages/AppealPage.vue` | 使用 `useBanOnlyPage`（§3.4）；返回链接改 `/` |
| `test/reviews.test.js` | `BAN_ONLY_PAGES` 遍历断言（每页：未封禁 302 / 被封禁 200 或 403）；`/api/ban/state` 三种封禁类型与限流；待审口径断言 |
| `test/visitors.test.js` | 黑白名单互斥：加黑移白、加白移黑、内存态同步、迁移清理 |
| `test/admin-bulk.test.js` | 批量 `visitors/ban-ip` / `trust` 的互斥回执 |
| `docs/PROJECT-OVERVIEW.md`、`docs/WEB.md`、`README.md`、`CHANGELOG.md` | 访问安全小节的描述同步（随发版） |

## 7. 实施顺序

1. **仅封禁可见页面守卫（§3.1–3.4：注册表 + 服务端 302 + `/api/ban/state` + `useBanOnlyPage`）**——问题一的真修复，优先级最高；
2. 黑白名单互斥 helper + 迁移清理 + 测试（独立、可先发）；
3. 待审口径 A + 状态标签 + 计数一致 + 测试；
4. 封禁页入口收敛（`/banned.html`、`ban.page_view` 日志）+ `BanPage.vue` 复核；
5. 文档同步 + `npm test` / `frontend:build` / `scan`；
6. **不自行打 tag**（硬规则 5），等"构建 vX.Y.Z"指令。

## 8. 待确认（可选，不阻塞本批）

1. **`/api/ban/state` 的轮询频率**：当前默认 30 秒 + 切回标签页时复查；若觉得请求偏多可调到 60 秒。
   该接口豁免拦截链与频率计数（否则频率封禁者轮询会自己把封禁升档，见 §3.6），但保留自带限流 1 次/秒、30 次/分钟。
2. 互斥的**包含关系**（CIDR）是否也要自动删？当前默认只提示、不删。
3. 后台是否需要一个「白名单覆盖了哪些黑名单/临时封禁」的只读提示列表？当前默认不做。
4. **`/appeal` 对未封禁用户一律跳首页**，会让"未被封禁但想提前申诉"的用户无法访问。
   当前按所有者要求执行；若将来做 [APPEAL-SYSTEM.md](APPEAL-SYSTEM.md) 的服务端受理，需要重新评估
   （那时可能需要允许已登录用户主动申诉）。
5. 线上 `APPEAL_EMAIL` 是否为空的确认（§1.1.4 末尾，属配置问题）。

## 9. 上线前需要在服务器执行的诊断（问题一）

只读命令，由具备服务器权限的人员执行（硬规则 4）：

```bash
# 1) 版本与端口（确认手机连的就是这台容器）
docker ps --format 'table {{.Names}}\t{{.Ports}}\t{{.Status}}'
docker exec steamdeals node -p "require('./package.json').version"

# 2) 容器内直测 /banned（PC UA 与 iPhone UA 都应返回 302 location:/）
docker exec steamdeals node --input-type=module -e '
const http = await import("node:http");
const uas = [
  ["iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1"],
  ["PC    ", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36"],
];
for (const [name, ua] of uas) {
  await new Promise((done) => {
    const req = http.request({ host: "127.0.0.1", port: 8080, path: "/banned", headers: { "user-agent": ua, accept: "text/html" } }, (res) => {
      console.log(name, res.statusCode, res.headers.location || "-");
      res.resume(); res.on("end", done);
    });
    req.on("error", (e) => { console.log("ERR", e.message); done(); });
    req.end();
  });
}
'

# 3) 日志级别（ban.redirect_home 是 info，级别为 warn 时不会出现在 docker logs）
docker exec steamdeals node -p "process.env.LOG_LEVEL || '(未设置，默认 info)'"
docker exec steamdeals sh -c 'ls -lah logs | tail -5'
docker exec steamdeals sh -c 'grep -h -E "ban\.|rate\.limited|device\.denied|block\.ip_denied" logs/app-*.jsonl | tail -30'

# 4) 用 CLI 按事件前缀过滤
docker exec steamdeals node src/cli.js logs --event ban --limit 30

# 5) 手机上访问 https://ip.sb 拿到手机出口 IP，再查三张表的封禁状态
docker exec -e IP='手机出口IP' steamdeals node --input-type=module -e '
const { openStore } = await import("./src/store/index.js");
const store = await openStore(process.env.DATABASE_URL, {});
const q = (sql, p) => store.query(sql, p);
const ip = process.env.IP;
for (const [label, sql] of [
  ["黑名单", "select ip, note, created_at from ip_blacklist where ip = $1"],
  ["白名单", "select ip, note, created_at from ip_whitelist where ip = $1"],
  ["临时封禁", "select ip, strikes, banned_until, ban_source from ip_abuse where ip = $1"],
  ["最近访问", "select ip, path, status, created_at from visitor_logs where ip = $1 order by id desc limit 10"],
]) {
  const r = await q(sql, [ip]);
  console.log(label, JSON.stringify(r.rows));
}
const d = await q("select fingerprint, device_id, until, note from device_bans order by created_at desc limit 20");
console.log("已封设备(最近20)", JSON.stringify(d.rows));
'
```

判读：`/banned` 若两种 UA 都返回 302，说明代码路径正确，问题在手机侧（被封/缓存/客户端路由）；
若返回 403/429，说明手机 IP 或设备确实处于封禁中（配合第 5 步确认是哪一类）。

### 9.1 手机复测步骤（2026-11-04 追加）

1. 手机浏览器打开 `https://ip.sb`（或任意查 IP 站点），记下**当前出口 IP**（Wi-Fi 与蜂窝网各记一次，两者 IP 不同）；
2. 用该 IP 重跑上面的第 5 条命令（把 `手机出口IP` 换成真实值），确认三张表状态；
3. 手机打开 `https://<站点>/banned`，观察是否直接落到首页；
4. 同时在服务器执行：
   ```bash
   docker exec steamdeals node src/cli.js logs --event ban --limit 20
   docker exec steamdeals node src/cli.js logs --event block --limit 20
   ```
   出现 `ban.redirect_home`（带手机 IP）= 302 生效；只出现 `block.ip_denied` / `device.denied` / `rate.limited` = 手机仍处于封禁中。

> 注意：诊断命令 ④ 若忘记替换 `手机出口IP` 占位符，四条查询会全部返回 `[]`，看起来像"查无此人"。

### 9.2 前置 nginx 排查（2026-11-04 追加，只读）

`docker ps` 显示站点是 `nginx(80/443) → 127.0.0.1:8520 → 容器 8080`，所以"零日志"必须先排除 nginx：

```bash
# 1) nginx 是否收到过 /banned 请求、返回了什么
docker logs nginx --since 48h 2>&1 | grep -E '/banned' | tail -20

# 2) nginx 站点配置里是否有 /banned 的静态映射、缓存或自己的 redirect
docker exec nginx nginx -T 2>/dev/null | grep -n -E 'location|proxy_pass|try_files|cache' | head -60

# 3) 从公网侧直接看响应头（在服务器上执行，替换成真实域名）
curl -sS -o /dev/null -D - -A 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Mobile/15E148' \
  https://<站点域名>/banned | head -20
```

判读：
- nginx 访问日志里**有** `/banned` 且返回 200（不是 302/403）→ nginx 层直接给了静态页或缓存，需改 nginx；
- 有 `/banned` 且返回 302 → 服务端生效，问题在客户端（配合 §3.4 复查解决）；
- **完全没有** `/banned` 记录 → 手机请求没到服务器（客户端路由/离线/不同地址），也是 §3.4 的适用场景。

> **2026-11-04 实测更正**：上面第 1 条命令在当前环境**恒为空**——两个 server 块内都有 `access_log off;`（第 162、245 行），
> 站点访问日志被关闭。要恢复观测能力，需把该行改成 `access_log /var/log/nginx/access.log main;`
> 或对 4xx/5xx 单独开日志；在此之前，nginx 侧没有任何 `/banned` 证据可用，**不要据此下结论**。
>
> `curl` 命令里的域名**不要写成尖括号** `<域名>`（bash 会当成输入重定向，报 `No such file or directory`）。
> 若不方便用公网 DNS，可直接绕过解析：
> ```bash
> curl -sS -k -o /dev/null -D - --resolve 你的域名:443:127.0.0.1 \
>   -A 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Mobile/15E148' \
>   https://你的域名/banned | head -15
> ```

## 10. 2026-11-11 修订（BJ）：黑名单 IP 不再写入自动封禁 + 自动封禁记录口径 + 解封语义拆分

> 状态：**已确认待开发（2026-11-11，所有者确认 15 项细节）**。编号 **BJ**。
> 关联：[TODO.md](TODO.md) 的 BJ 条目、[VISIT-IP-STATS.md](VISIT-IP-STATS.md) §8（BI 的「封禁中 / 已封禁」口径先例）、
> [ADMIN-BULK-ACTIONS.md](ADMIN-BULK-ACTIONS.md)（批量处置回执与审计）、[WEB.md](WEB.md)（接口表）、
> [ROADMAP.md](ROADMAP.md)（不做项）。

### 10.1 现象（2026-11-11 所有者截图，生产 v2.10.0「访问记录 → 封禁与白名单」）

截图事实：

- **IP 黑名单**：`45.138.12.10`（审核通过 rate-limit）、`45.138.12.6`（审核通过 vcs-dir）；
- **自动封禁记录**：`45.138.12.10`（来源 rate、封禁至 2026/11/02 10:01）仍在列表里；
  `34.65.66.120` / `34.65.89.81`（rate-day）、`142.86.110.204`、`34.156.56.208`、`34.70.39.109` 等的封禁至时间**早已过去**；
- **IP 白名单**：`101.82.244.116`、`223.166.239.55`（本批不涉及，行为保持不变）。

两个独立缺陷叠加：

1. **已审核封禁（永久黑名单）的 IP 仍在产生新的自动封禁记录**——管理员以为「封死了」，实际每次访问仍在被计数、
   够数还会再写一条 `ip_abuse`，并把该 IP 的新 pending 审核标成 `auto_banned`；极端情况下黑名单 IP 看到的是
   `429 请求过于频繁`（限流先命中）而不是 `403`，更像「封禁没生效」。
2. **「自动封禁记录」不区分生效/过期**——`ip_abuse` 的历史行全量返回，过期行永远显示在页面上，
   也没有「该 IP 已在黑名单」的提示，管理员无法判断哪条还在生效。

### 10.2 代码证据（2026-11-11 核对，行号为当前 main）

| # | 结论 | 证据 |
|---|---|---|
| 1 | 自动封禁记录 = `ip_abuse` **全量**查询，不按 `banned_until` 过滤 | `src/store/pg.js:2268-2278`（`listAbuse`：无 where，`order by banned_until desc nulls last, updated_at desc`） |
| 2 | 列表其实已带 `blacklist_note`（精确等值子查询），但前端从未显示 | `src/store/pg.js:2271`（`(select note from ip_blacklist b where b.ip = a.ip)`）；`frontend/src/pages/AdminModules.vue:50` 无该列 |
| 3 | 限流计数在 IP 黑名单检查**之前** | `src/server.js:515`（`await ratelimit.hit(...)`）早于 `:543`（`visitors.blockedBy(ip)`）；`:513` 的豁免只有白名单 / 管理员 / 内网 / 申诉页，**没有黑名单** |
| 4 | `hit()` 只豁免白名单，不认黑名单 | `src/ratelimit.js:244`（`isWhitelisted` 直接放行）、`:250-266`（封禁期内继续累计 `blockedHits`，到 `blockedEscalate=100` 就升级） |
| 5 | 升级 / 超限会写 `ip_abuse`，并把 pending 审核标 `auto_banned` | `src/ratelimit.js:198-205`（`applyBan` 写 `banned_until` / `ban_source`）、`:208-217`（`update abuse_reviews ... status='auto_banned'`）；`addStrike` 在 `:158-177` |
| 6 | 审核通过只写黑名单、**不清** `ip_abuse` | `src/server.js:3253`（`reviews/approve-ip`）→ `:3331-3346`（`bulkReviewApproveIp`）→ `:3291-3303`（`banIpExclusiveSql`）→ `src/store/pg.js:2213-2220`（`addBlockedIp` 只删白名单 + insert 黑名单） |
| 7 | 相反：加白名单**会**清临时封禁（可作先例） | `src/store/pg.js:417-422`（`update ip_abuse set banned_until = null from ip_whitelist`） |
| 8 | 自动封禁页「解封」同时删 `ip_abuse` **和** `ip_blacklist` | `src/server.js:2947-2955`（`DELETE /api/admin/abuse/:ip`）→ `src/ratelimit.js:296-314`（`unban`：`:306` 删 abuse、`:308` 删 blacklist） |
| 9 | 批量同口径：`abuse/unban` 走 `ratelimit.unban`；`blacklist/unban` 只删黑名单 | `src/server.js:3268` → `:3463-3470`（`bulkAbuseUnban`）；`:3265` → `:3444-3449`（`bulkBlacklistUnban`） |
| 10 | 前端自动封禁区块无状态列、按钮一律「解封」、筛选/标注都没有 | `frontend/src/pages/AdminModules.vue:50`（表格）、`:402`（黑名单解封）、`:405`（`unbanAbuse` 提示「临时封禁已解除」）、`:302-305`（批量动作一律「解封」）、`:393`（`loadSecurity` 只传 `limit=200`） |
| 11 | `prune` 定时任务不清理 `ip_abuse` | `src/store/pg.js:2017-2026`（`purgeOldRows` 只清 visitor_logs / fetch_runs / sync_runs / email_codes / steam_account_logs）；`src/cli.js:2044-2057`（`cmdPrune`） |
| 12 | CIDR 只在运行时匹配，SQL 侧是等值 | `src/visitors.js:96-105`（`matchesIpEntry`）、`:112-116`（`blockedBy`）、`:119-123`（`refreshBlocklist`） |
| 13 | 默认阈值（本批**不改**，仅作为验收依据） | `src/ratelimit.js:19-27`：`max=60/60s`、`assetMax=300`、`blockedEscalate=100`、`banMinutes=[10,30]`、`dayBanStrikes=3` |

**一句话根因**：拦截链顺序把「限流计数」放在了「黑名单」前面，于是黑名单 IP 照样进计数器；而「解封」又把两张表的删除合并成一个动作，
列表又不看 `banned_until`——三处口径各自为政，才有了截图里的矛盾。

### 10.3 已确认的决策（2026-11-11 所有者，共 15 项）

| # | 决策 |
|---|---|
| 1 | **拦截链顺序**：IP 黑名单检查提到频率限制**之前**（A1） |
| 2 | 黑名单命中**不计数、不三振、不升级、不写 `ip_abuse`、不写 `abuse_reviews`**（A1） |
| 3 | 黑名单命中仍写**采样拦截日志**（`visitor_logs.blocked=true` + `block_reason`、`block.ip_denied`、`ban.page_view`），同 IP 每分钟最多 1 条（A1） |
| 4 | 白名单 / 管理员 / 内网 / 申诉页 / 前端静态资源的豁免**维持现状**：内网本来只豁免限流与路径守卫（`server.js:513/553` 的 `isPrivateAddress`），黑名单这一层照旧会拦；本批不改（A1） |
| 5 | 自动封禁记录**默认只显示「生效中」**；状态筛选 = 生效中（默认）/ 已过期 / 全部（B1） |
| 6 | 列表加**状态列**：`生效中` / `已过期` / `仅计数`（`banned_until` 为空、只有三振或路径计数的行）（B1） |
| 7 | 列表加**「已在黑名单」标注**；匹配按运行时 `matchesIpEntry`（支持 `1.2.3.0/24`），SQL 的备注子查询保留精确等值（B1 + D1） |
| 8 | **存量修复**：只清「已被黑名单覆盖」的 `ip_abuse.banned_until` / `ban_source`（**行保留**做审计）；SQL 只处理精确相等，CIDR 由代码运行时判定（H1） |
| 9 | 过期行**保留期 90 天**，并入现有 `prune` 定时任务，**不新建定时任务**（H1） |
| 10 | 自动封禁页「解除封禁 / 清除记录」**只清 `ip_abuse`（含内存态），绝不动 `ip_blacklist`**（C1） |
| 11 | 黑名单页「解封」**只删 `ip_blacklist`**，不动 `ip_abuse`（C1） |
| 12 | **批量同口径拆分**：`abuse/unban` 与 `blacklist/unban` 各自只动自己那张表（C1） |
| 13 | 按钮文案按状态区分：生效中用「解除封禁」、已过期 / 仅计数用「清除记录」；确认框写明「不影响 IP 黑名单」（C1） |
| 14 | 审核通过 / 手动封 IP / 批量封 IP 写黑名单时，把该 IP 的 `ip_abuse.banned_until` 与 `ban_source` **置空（行保留）**（D1） |
| 15 | **本批不做**：三振阈值/时长/档位、设备封禁、白名单逻辑、访问明细统计、`setBanUntil` / `applyExternalBan` 死代码清理（E1） |

### 10.4 设计

#### 10.4.1 拦截链顺序（决策 1–4）

目标顺序（`src/server.js` 请求拦截链）：

```
/api/ban/state 豁免(:487)
  → 设备封禁(:503)
  → IP 黑名单(:543-549 整块前移到这里)
  → 频率限制(:513-541)
  → 路径守卫(:553-573)
  → 访问记录(:575-597)
```

实现要点：

1. 把 `:543-549` 的块（`const hit = ...; if (hit && !appealPage) {...}`）**整体移到 `:513` 之前**，`hit` 变量随之前移，
   下游 `banState()`（`:662-669`）继续复用同一个 `hit`，不新增查询；`/api/ban/state`（`:487-501`）本来就走
   `visitors.blockedBy`（`:495`），本批只调它的类型优先级（见下面第 5 条）；
2. 豁免条件原样保留：`!adminBypass && !whitelisted`、`!appealPage`、`GET` 前端静态资源走 `serveFrontendStatic`（`:545`）；
3. 效果：黑名单 IP 在**计数之前**被拦下 → `ratelimit.hit` 不再被调用 → 不写 `ip_abuse` / `abuse_reviews`、不升级；
   黑名单 IP 的响应从「先 403、超 60 次后变 429」固定为 **403**；
4. 审计：不新增逐请求日志（黑名单 IP 可能高频，会刷屏）。保留现有采样：
   `logBlocked`（`:376-396`，同 IP 每分钟最多 1 条 → `visitor_logs.blocked=true` + `block_reason`）、
   `block.ip_denied`（`:546`）、`ban.page_view`（`:405`）；
5. **连带项（决策 1 的直接推论，非独立决策）**：`/api/ban/state`（`:487-501`）与 `banState()`（`:662-669`）的类型优先级
   改为 **设备 → 黑名单 → 自动封禁**，与拦截链一致；黑名单返回 `{ banned:true, type:'ip', until:null }`，
   避免黑名单 IP 因残留的内存态频率封禁被报成 `type:'rate'`（客户端行为不变，仍 302 回首页/显示封禁页）。

不做的事：不把黑名单检查放到设备封禁之前（设备封禁仍优先，避免换 IP 绕过设备封禁的提示顺序变化）；
不动 `/appeal` 豁免（被封者必须还能申诉）。

#### 10.4.2 查询与字段（决策 5–7）

`src/store/pg.js` 的 `listAbuse` 增加 `status` 参数（白名单，非法值回落 `active`）：

| status | where | 排序 |
|---|---|---|
| `active`（默认） | `a.banned_until is not null and a.banned_until > now()` | `banned_until asc`（最快到期在前） |
| `expired` | `a.banned_until is null or a.banned_until <= now()` | `banned_until desc nulls last, updated_at desc` |
| `all` | 无 | 同 `expired` |

返回字段（在现有基础上追加）：

| 字段 | 含义 | 来源 |
|---|---|---|
| `ip` / `strikes` / `path_strikes` / `ban_source` / `banned_until` / `updated_at` | 现有 | `ip_abuse` |
| `blacklist_note` | 黑名单备注（**精确等值**命中的条目才有） | `ip_blacklist` 子查询（保留） |
| `active` | `banned_until > now()` | SQL 计算 `coalesce(a.banned_until > now(), false) as active` |
| `in_blacklist` | 是否被黑名单覆盖（**含 CIDR**） | 服务端用 `visitors.blockedBy(row.ip)` 逐行补 |
| `blacklist_entry` | 命中的黑名单条目（IP 或 CIDR），用于 hover 展示 | 同上（`blockedBy` 的返回值） |

接口 `/api/admin/abuse?status=&limit=`（`src/server.js:2939-2945`）：`status` 白名单透传，`limit` 仍 1–200；
`GET` 返回 `{ abuse, config }` 形状不变（前端不用改解析）。

前端列表（`AdminModules.vue` 自动封禁区块）：

| 列 | 内容 |
|---|---|
| IP | IP +（`in_blacklist`）`已在黑名单` tag，hover 显示 `blacklist_entry` / `blacklist_note` |
| 频率命中 / 路径命中 / 来源 | 现有 |
| 封禁至 | 现有（`banned_until` 为空显示 `—`） |
| 状态 | `生效中`（橙）/ `已过期`（灰）/ `仅计数`（灰，`banned_until` 为空） |
| 操作 | `生效中` →「解除封禁」；`已过期` / `仅计数` →「清除记录」 |

筛选：`生效中（默认）/ 已过期 / 全部`，切换回第 1 页；顶部说明补一句「默认只显示生效中；已过期记录保留 90 天后由 prune 清理」；
空态：「当前没有生效中的自动封禁」+ 提示切到「已过期 / 全部」。

#### 10.4.3 解封语义（决策 10–13）

| 入口 | 现在 | 本批 |
|---|---|---|
| `DELETE /api/admin/abuse/:ip`（`src/server.js:2947`） | `ratelimit.unban` → 删 `ip_abuse` **+ `ip_blacklist`** | 只清 `ip_abuse` 行 + 内存态，**黑名单不变** |
| `DELETE /api/admin/blacklist/:ip`（`:2901`） | 只删 `ip_blacklist` | **不变**（不碰 `ip_abuse`） |
| 批量 `abuse/unban`（`:3268` → `:3463`） | `ratelimit.unban`（两表） | 只清 `ip_abuse` |
| 批量 `blacklist/unban`（`:3265` → `:3444`） | 只删 `ip_blacklist` | **不变** |

实现：

1. `src/ratelimit.js` 新增 `clearAbuse(q, ip)`：清理内存（`windowHits` / `assetHits` / `blockedHits` / `banUntil` / `pathBanned` / `dayBanned`）
   + `delete from ip_abuse where ip = $1`；`unban` 移除（或改为 `clearAbuse` 的兼容别名），**不再出现 `delete from ip_blacklist`**；
   两个调用点（`src/server.js:2951`、`:3465`）改到 `clearAbuse`；
2. 回执保持 `{ removed }` 形状（前端不用改解析）；单条日志事件沿用 `api.abuse_unbanned`，追加
   `{ blacklistKept: true, wasActive: <boolean> }`；批量仍走 `admin_bulk_ops` 审计；
3. 文案（`AdminModules.vue`）：行内按钮按 `row.active` 切「解除封禁 / 清除记录」；确认框
   「只解除自动临时封禁，**不会移除 IP 黑名单**；该 IP 若在黑名单中仍无法访问」；成功提示「临时封禁已解除」/「记录已清除」；
   批量按钮改「解除临时封禁」（已过期行批量时提示「清除记录」），确认框带条数与同一句提示；
4. 黑名单页「解封」不变，但**确认框补一句**「不会恢复该 IP 的自动封禁记录」。

#### 10.4.4 审核通过 / 手动封 IP 时清临时封禁（决策 14）

`banIpExclusiveSql`（`src/server.js:3291-3303`）的 `kind === 'ban'` 分支，在 `db.addBlockedIp` 之后追加：

```js
// 决策 14：黑名单优先，清掉该 IP 的临时封禁字段（行保留做审计；与加白名单清临时封禁同一先例）
await db.clearAbuseBan(q, ip);       // update ip_abuse set banned_until=null, ban_source=null, updated_at=now()
ratelimit.clearBanMemory(ip);        // 清 banUntil/pathBanned/dayBanned/blockedHits（窗口计数可保留）
```

覆盖三个调用点：`POST /api/admin/blacklist`（`:2890`）、批量审核通过 `:3340`、批量 `visitors/ban-ip`（`:3376`）。
`pg.js` 新增 `clearAbuseBan(q, ip)`（返回是否改到行）；`ratelimit.js` 新增 `clearBanMemory(ip)`。
**不删行**：审核备注 / 来源 / 历史命中次数还要能查（默认视图已隐藏）。

#### 10.4.5 迁移与清理（决策 8–9）

**一次性修复**（幂等，放 `migrate()`，紧邻 §4.3 的白名单清理 `src/store/pg.js:413-422`）：

```sql
-- 已被黑名单覆盖的 IP：清掉临时封禁字段（行保留，避免「黑名单里却显示正在封禁」）
update ip_abuse a
   set banned_until = null,
       ban_source   = null,
       updated_at   = now()
  from ip_blacklist b
 where a.ip = b.ip
   and a.banned_until is not null;
```

- 只处理**精确相等**的条目；CIDR 黑名单（`1.2.3.0/24`）覆盖的 IP 由代码运行时判定（`matchesIpEntry`），迁移不改；
- 可重复执行（第二次 `count=0`）；生产重启后 `ratelimit.loadState` 只加载 `banned_until > now()`，内存态自然干净。

**保留期清理**（并入现有 `prune`，决策 9）：

- `pg.js purgeOldRows` 增加 `abuseDays = 90`，返回 `ipAbuse` 计数；
- SQL：

```sql
delete from ip_abuse
 where (banned_until is not null and banned_until < now() - ($1 || ' days')::interval)
    or (banned_until is null and updated_at < now() - ($1 || ' days')::interval);
```

- `cmdPrune`（`src/cli.js:2044`）输出追加「自动封禁记录 N 条」，日志 `maintenance.cleanup` 带 `ipAbuse`；
- **合并评估（skill §4.1）**：无外部请求、与 `visitor_logs` 同属「本地运维清理」，且 AT 批已把 `steam_account_logs`
  并进同一个 `prune`（`pg.js:2023-2024`）——**并入，不新建定时任务**；
- **单轮成本**：`ip_abuse` 是「每 IP 一行」的小表（当前量级几十~几百行），顺序扫描可忽略；每周跑一次（默认 10080 分钟）；
- 保留期 90 天 = 3 个月的自动封禁历史，足够回答「这个 IP 以前被封过几次」。

### 10.5 改动清单

| 文件 | 改动 |
|---|---|
| `src/server.js` | 黑名单检查块前移到限流之前（`513`/`543`）；`/api/admin/abuse` 加 `status` 透传 + 逐行补 `in_blacklist`/`blacklist_entry`；`DELETE /api/admin/abuse/:ip` 改 `clearAbuse`；`banIpExclusiveSql` 追加 `clearAbuseBan` + `clearBanMemory`；`banState` / `/api/ban/state` 类型优先级改 设备→黑名单→自动封禁 |
| `src/ratelimit.js` | 新增 `clearAbuse`（替代 `unban`，不再删 `ip_blacklist`）与 `clearBanMemory`；`unban` 退场 |
| `src/store/pg.js` | `listAbuse` 加 `status` / `active` / 排序；新增 `clearAbuseBan`；`purgeOldRows` 加 `abuseDays=90` + `ipAbuse` 计数；`migrate()` 加黑名单覆盖清理 SQL |
| `src/cli.js` | `cmdPrune` 输出与日志带自动封禁计数（`--abuse-days` 可临时覆盖，默认 90） |
| `frontend/src/pages/AdminModules.vue` | 自动封禁区块：状态筛选 + 状态列 + 「已在黑名单」tag + 按钮文案/确认框 + 空态；`loadSecurity` 带 `status`；批量动作文案；黑名单解封确认框补一句 |
| `test/*.test.js` | 见 §10.6 第 11 条 |
| `docs/WEB.md`、`docs/PROJECT-OVERVIEW.md`、`README.md`、`CHANGELOG.md` | 接口参数与功能描述同步（**开发阶段**随交付改，本批需求会话不写） |

### 10.6 验收

1. **黑名单不再产生新 auto-ban**：把 `203.0.113.77` 加进黑名单，用 `x-forwarded-for: 203.0.113.77` 连续请求 `/` **≥ 200 次**
   → **全部 403**（不出现 429）；`select count(*) from ip_abuse where ip='203.0.113.77'` = 0；
   `abuse_reviews` 该 IP 无新 `pending`；`visitor_logs` 里该 IP 的 `blocked` 行每分钟 ≤ 1 条（采样生效）。
2. **白名单 / 管理员 / 内网 / 申诉页不受影响**：白名单 IP 仍 200 且不计数；管理员 cookie 仍免封禁；
   内网（`127.0.0.1`）仍不被限流计数；`/appeal` 对黑名单 IP 仍可打开。
3. **默认口径**：「自动封禁记录」默认只列生效中（`banned_until > now()`）；切「已过期」只列过期/无封禁时间的行；
   「全部」= 并集；切换回第 1 页；`limit=200` 上限与分页不变。
4. **状态列与标注**：生效中橙「生效中」、过期灰「已过期」、无 `banned_until` 灰「仅计数」；
   `45.138.12.10` 这类「已在黑名单」的行在「全部」视图有 tag，hover 能看到黑名单条目/备注；
   CIDR 用例：黑名单 `203.0.113.0/24` 时，`ip_abuse` 里的 `203.0.113.9` 也标「已在黑名单」；删掉该黑名单条目后 tag 消失。
5. **解封粒度**：自动封禁页「解除封禁 / 清除记录」→ `ip_abuse` 行删除、`ip_blacklist` 行**仍在**、该 IP 仍 403；
   黑名单页「解封」→ `ip_blacklist` 删除、`ip_abuse` 行不受影响。
6. **审核通过**：审核通过 → `ip_blacklist` 新增、`ip_abuse.banned_until` 为 `null`、**行仍存在**；
   默认视图看不到该 IP，「全部」+「已在黑名单」能查到。
7. **迁移幂等**：`migrate()` 连跑两次无副作用（第二次清 0 行）；已被黑名单覆盖的行被清空，未覆盖的行不动。
8. **prune**：构造 ①91 天前的过期行 ②未过期行 ③91 天前 `banned_until` 为空、`updated_at` 很旧的行 → 只删 ①③；
   `node src/cli.js prune` 输出含「自动封禁记录 N 条」，日志 `maintenance.cleanup` 带 `ipAbuse`。
9. **权限**：`/api/admin/abuse`、`DELETE /api/admin/abuse/:ip`、批量 `abuse/unban` → 未登录 401、非 admin 403；
   批量上限 200 不变；未授权请求不产生任何库改动。
10. **审计**：单条清除记 `api.abuse_unbanned`（含 `by` / `removed` / `wasActive` / `blacklistKept`）；
    批量写 `admin_bulk_ops`（`admin-bulk-actions` 既有机制）；限流拦截采样日志仍可查（`visitor_logs.blocked`）。
11. **测试要求**：
    - `test/admin-bulk.test.js`：黑名单 IP 200 次请求全 403 且 `ip_abuse` 无新行；`abuse/unban` 只清 `ip_abuse`（黑名单仍在、仍 403）；`blacklist/unban` 不动 `ip_abuse`；
    - `test/ratelimit.test.js`：`clearAbuse` 只删 `ip_abuse`，**不再** `delete from ip_blacklist`；原有「手动解封清临时封禁」断言保持绿；
    - `test/visitors.test.js`：`listAbuse` 三种 `status` 口径与 `active` 字段；`in_blacklist` 的 CIDR 用例；审核通过清 `banned_until` 保留行；
    - `test/reviews.test.js`：审核通过（单条/批量）后 `ip_blacklist` 有行、`ip_abuse.banned_until` 为空、行仍在；
    - `test/admin-review-lists.test.js` 或新文件：前端静态断言（状态筛选/状态列/`已在黑名单` tag/两个按钮文案/确认框文案）；
    - `test/scheduler.test.js` 或 `test/pg.test.js`：`purgeOldRows` 保留期口径（91 天前删、未过期不删）；
    - `npm test` 全绿、`npm run frontend:build`、`npm run scan`；新增测试文件要接入 `package.json` 的 `test` 链。
12. **页面现象**（生产 v2.10.x 部署后）：同一张截图页面，`45.138.12.10` 不再出现在默认视图；`34.65.66.120` 等过期行
    只在「已过期 / 全部」里；`34.156.56.208` 等若已被黑名单覆盖则带「已在黑名单」tag。

### 10.7 部署侧复核（**只读**，发版后由部署/所有者执行）

```sql
-- 1) 迁移是否生效：期望 0 行（黑名单覆盖的 IP 不应再有封禁时间）
select count(*) from ip_abuse a join ip_blacklist b on b.ip = a.ip where a.banned_until is not null;

-- 2) 列表默认视角：期望与后台「生效中」行数一致
select count(*) from ip_abuse where banned_until > now();

-- 3) 修复后是否还在写：把 45.138.12.10 的 updated_at 记下来，观察 24h 后是否变化
select ip, strikes, banned_until, ban_source, updated_at from ip_abuse where ip = '45.138.12.10';
```

判读：① 非 0 说明迁移没跑（`migrate()` 在启动时执行，需重启容器）或 CIDR 覆盖未处理（按决策 8 属预期，只影响标注）；
③ 的 `updated_at` 24 小时不变 = 黑名单 IP 已经不再被计数（配合后台「生效中」为空）。

### 10.8 本批不做

1. **不改三振策略**：`max` / `assetMax` / `windowSec` / `banMinutes` / `dayBanStrikes` / `blockedEscalate` 一律不动
   （`src/ratelimit.js:19-27`）；
2. **不改设备封禁**（指纹/设备码语义、`device_bans` 表、拦截顺序里的设备分支）；
3. **不动白名单逻辑**（互斥、CIDR、豁免、加白清临时封禁都保持现状）；
4. **不重做访问明细 / IP 统计**（BI 的四态与筛选不动；本批只做「封禁与白名单」页）；
5. **不清理死代码**：`setBanUntil`（`pg.js:2302`）、`applyExternalBan`（`ratelimit.js:225`）保留（E1），
   如需清理另开条目；
6. **不做「一键清空已过期」按钮**：默认筛选 + prune 保留期已覆盖诉求；
7. **不把「剩余时间」加进自动封禁列表**：`封禁至` 列已有绝对时间，避免与访问明细的剩余时间重复。

### 10.9 待确认

无。15 项决策已于 2026-11-11 由所有者逐项确认（A1 / B1 / H1 / C1 / D1 / E1）。

可后置、**不阻塞本批**的观察项：

1. prune 的 `abuseDays` 是否需要做成页面设置项（当前默认 90 天，命令行 `--abuse-days` 可临时覆盖）；
2. 自动封禁列表是否需要「剩余时间」（与访问明细口径统一）；
3. `banState` 的类型优先级调整是否影响申诉页文案（预期不影响：黑名单 `type:'ip'` 一直存在，只是从「rate 优先」改成「ip 优先」）。
