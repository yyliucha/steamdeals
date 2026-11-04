# 封禁与安全修复批次：仅封禁可见页面统一守卫 + 黑白名单互斥 + 待审口径（待开发）

> 状态：**需求与方案已确认（2026-11-04），待开发**。
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
