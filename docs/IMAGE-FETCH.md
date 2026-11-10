# 封面图回源：404 快失败 + 超时收紧 + 负缓存分层 + `header_image` 直链（已实现待发版）

> 状态：**已实现待发版（2026-11-10）**（所有者 2026-11-10 确认「要的」）
> 关联：[TODO.md](TODO.md) 的 AW 条目 · [NGINX-PERF.md](NGINX-PERF.md)（HTTP/2 缓解图片挤占连接）·
> [READ-MODEL.md](READ-MODEL.md)（AV 批：列表查询，与本批互补）

一句话：**同一张不存在的图不再连试 3 个 CDN、不再每次等 2–6 秒**；有新资产地址（`games.header_image`）时直接用它，
前端拿不到图时显示占位块而不是小图标。

## 1. 问题与证据（2026-11-09/10 实测）

**线上接口耗时**

| 请求 | 结果 | 说明 |
|---|---|---|
| `/img/steam/400/library_hero`（老游戏·未预取） | 200，**2.82s**，173KB | 冷启动正常成本（CDN 往返） |
| `/img/steam/400/capsule_616x353` | 200，0.79s | 同上 |
| `/img/steam/730/library_hero` | 200，0.96s | 同上 |
| `/img/steam/4266020/header`、`capsule_sm_120`、`capsule_231x87` | **404，2.0–6.6s** | 老路径无资源 |
| `/img/steam/400,220,620,367520/header` | 200，0.08–0.11s | 本地已缓存 |

**服务器日志（`docker logs steamdeals`，2026-11-10 09:42）**

```
WARN steam.img_miss appid=4266020 size=header message="HTTP 404"
WARN steam.img_miss appid=4265920 size=header message="HTTP 404"
WARN steam.img_miss appid=4848110 size=header message="HTTP 404"
WARN steam.img_miss appid=4825080 size=header message="This operation was aborted"
```

**代码根因**

| 位置 | 现状 | 问题 |
|---|---|---|
| `src/images.js:147` `imageCandidates()` | 同一路径拼 3 个 CDN 候选（Cloudflare → Akamai → Cloudflare 直连） | 同一个资源 404 时换 CDN 仍是 404 |
| `src/images.js:161` `downloadImage()` | 3 个候选串行，每个 `timeoutMs: 8000`，任何错误都试下一个 | 404 也重试 → 2–6.6s；超时最坏 24s |
| `src/server.js:191` `imgMissCache` | 失败后负缓存 **5 分钟** | 过期又是一轮；404 是永久性的，5 分钟太短 |
| `src/cli.js:2429` `images pull` | 预取 `header` + `capsule_sm_120`，每轮 200 张 | 覆盖约 3200 张 / 10 万游戏（≈3%），冷启动多 |
| `frontend/src/pages/Home.vue:199` | `@error` → `src='/favicon.svg'` | 卡片上是站点小图标，观感差 |
| 新 appid 的资产路径 | 只拼老路径 `/steam/apps/<appid>/<size>.jpg` | 2024 后上架条目资产在 `store_item_assets/...`，老路径 404 |

**关键结论**：代理/出口是通的（老游戏未预取尺寸也能 200）；404 是「新 appid 在老路径下没有资产」，
而 `games.header_image` 列**已经存在**（`src/store/pg.js:23`，由 `upsertGameMeta` 写入 `src/store/pg.js:2459`），
里面有 Steam 返回的新资产完整 URL —— 直接用它就能解决大部分新游戏的封面。

## 2. 已确认的决策（2026-11-10）

| # | 决策 | 结论 |
|---|---|---|
| 1 | 404 处理 | **立即失败，不再试下一个候选**（同一资源，换 CDN 一样 404） |
| 2 | 超时 | 单候选 `8000 → 3000ms`，整次兜底预算 ≤ 5000ms |
| 3 | 负缓存 | **分层**：404/410 → 24 小时；超时/网络错误 → 10 分钟 |
| 4 | 新资产地址 | `games.header_image` 有值时**优先直链**（仅 `header` 尺寸），失败再回退老路径 |
| 5 | 前端占位 | 加载失败显示 CSS 占位块（渐变色 + 首字），不再显示站点 favicon |
| 6 | 预取 | `images pull` 复用同一套逻辑；404 计入统计但不中断整轮 |

## 3. 设计

### 3.1 `downloadImage` 改造（`src/images.js`）

```js
// 新增可选 preferredUrl（header_image 直链）；404 直接抛出带 status 的错误供上层分层缓存
export async function downloadImage(appid, size, { fetchBuffer, logger, timeoutMs = 3000, totalBudgetMs = 5000, preferredUrl = null, env = process.env })
```

- 候选顺序：`preferredUrl`（若给且合法）→ 原 3 条老路径；
- 每次 `fetchBuffer` 带 `retries: 0`、`timeoutMs`；
- 错误分类：`err.status === 404 || 410` → 立即 `return { ok:false, notFound:true, error }`；
- 总预算：累计耗时超过 `totalBudgetMs` 就停止尝试后续候选，返回 `{ ok:false, timeout:true }`；
- 成功仍走 `saveImage` 落盘。

### 3.2 负缓存分层（`src/server.js`）

```js
const imgMissCache = new Map(); // key -> { at, kind: 'notfound' | 'error' }
const IMG_MISS_TTL = { notfound: 24 * 3600 * 1000, error: 10 * 60 * 1000 };
```

命中未过期 → 直接 404（`cache-control: no-store` 或保留现状）；容量仍 2000、FIFO 淘汰。

### 3.3 `header_image` 直链（`src/server.js` 图片路由）

- 仅当 `size === 'header'`：查该游戏 `header_image`（一次 `select header_image from games where steam_appid=$1`，
  失败/为空不阻塞，回退老路径）；
- **安全校验**（防 SSRF）：必须 `https:`、host 以 `.steamstatic.com` 结尾；
  不满足则忽略并回退；
- 用 `preferredUrl` 调 `downloadImage`；成功照常落盘（文件仍存 `data/images/<appid>/header.jpg`，与现有读取路径一致）；
- 日志：`steam.img_fallback`（header_image 失败后回退老路径）。

### 3.4 日志

| 事件 | 字段 | 用途 |
|---|---|---|
| `steam.img_miss` | 加 `status`（HTTP 码）/ `kind`（notfound/timeout） | 区分「没有资产」与「网络抖」 |
| `steam.img_fast_fail` | appid/size/status | 404 快失败，便于统计有多少新游戏缺图 |
| `steam.img_fallback` | appid、原因 | header_image 直链失败回退 |

### 3.5 前端占位（`frontend/src/pages/Home.vue`）

- 卡片/详情 `<img>` 外套 `.cover-wrap` 已有背景；失败时加 class（如 `img-failed`）隐藏 `<img>`、显示 `.cover-placeholder`
  （CSS 渐变 + 游戏名首字，纯 CSS，不引依赖）；
- 删除 `event.target.src='/favicon.svg'` 的写法（避免再请求 favicon 也不好看）；
- 移动端卡片同样处理（`Home.vue:67` 附近）。

### 3.6 预取（`src/cli.js` `images pull`）

- 复用 `downloadImage` 新逻辑（404 快失败）；
- `stats` 增加 `notFound` 计数并打进 `images.pull.done` 日志与命令行摘要；
- 候选排序可加「最近入库优先」——现有 `order by g.updated_at desc` 已是近似，不改。

## 4. 安全

- `header_image` 只接受 **https + `.steamstatic.com`**；禁止 `http:`、IP 直连、其它域名（防 SSRF）；
- 不跟随跨域重定向（`fetchBuffer` 默认 3 次重定向跟随，需要时限制到同域）；
- 落盘仍走 `saveImage` 的 appid/size 白名单，不按 URL 决定路径。

## 5. 验收

1. **404 快失败**：注入 `fetchBuffer` 恒返回 404 → 只调用 **1 次**，`downloadImage` 返回 `notFound:true`（现在是 3 次）；
2. **超时换候选**：注入 fetchBuffer 前两次超时、第三次成功 → 调用 **3 次**并返回 ok（不回归兜底能力）；
3. **总预算**：三个候选都超时 → 总耗时 ≤ `totalBudgetMs + 单次超时`，不会累加到 24s；
4. **负缓存分层**：404 后 24h 内重复请求不再触发 fetch；网络错误 10min 后可重试（可导出 TTL 常量断言）；
5. **header_image 优先**：`games.header_image` 有值时，fetcher 收到的第一个 URL 就是它；非白名单域名 → 不采用并回退老路径（断言两次调用）；
6. **前端占位**：静态断言不再出现 `'/favicon.svg'` 作为图片兜底，且存在占位元素/类名；
7. **不回归**：本地已有图仍 200 且不再请求网络；`images pull` 统计包含 `notFound`；
8. 通用：`npm test` 全绿（新测试进主链）、`npm run frontend:build`、`npm run scan` 干净。

## 6. 实施顺序

1. `downloadImage` 改造 + 单测（快失败 / 超时换候选 / 总预算）；
2. 负缓存分层 + 日志字段；
3. `header_image` 直链 + 白名单校验 + 测试；
4. 前端占位 + 静态断言；
5. `images pull` 统计；
6. 上线后实测：新 appid 首次请求 <1s 返回 404；老游戏未缓存图仍 200。

## 7. 风险

| 风险 | 对策 |
|---|---|
| `header_image` 为空（新游戏没走过元数据同步） | 回退老路径；后续由 `backfill` 补齐（不在本批） |
| 老路径对老游戏有效、对新游戏 404 | 快失败把成本从 2–6s 降到 <1s，观感与负载都改善 |
| 缩短超时导致弱网取图失败 | 3000ms 对 CDN 足够；失败进 10 分钟负缓存，下轮再试 |
| 白名单误伤 | 只认 `.steamstatic.com`；Steam 所有资产都在该域下 |

## 8. 本批不做

- 保证每个新游戏都有 `header_image`（依赖 `backfill` 的候选策略，另议）；
- 由 `header_image` 推导其它尺寸的新路径（Steam 的 hash 无法推导）；
- 图片 CDN 化 / 对象存储（体量与成本不值）。
