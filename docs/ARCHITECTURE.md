# 架构与设计取舍

这份文档记录**为什么这样设计**，而不是罗列代码。命令与部署见 [DEPLOY.md](DEPLOY.md)，数据源实测记录见 [DATA-SOURCES.md](DATA-SOURCES.md)。

项目全貌、Web 前后端、功能代码落点和常用入口见 [PROJECT-OVERVIEW.md](PROJECT-OVERVIEW.md)。

## 1. 约束从哪来

| 约束 | 来源 | 对设计的直接影响 |
|---|---|---|
| 只比官方渠道 | 产品决策（C2C 最低价由灰产定价） | `platforms.kind` + 视图，主榜天然排除 C2C |
| 数据必须可追溯 | "真实"只能承诺到来源可信 | 每条报价带 platform / region / 抓取时间 / 来源 URL |
| 历史不能补 | 价格只在发生的那一刻存在 | 快照表从第一天启用，且必须"变化才写" |
| 远程排障 | 部署在别人的服务器上，看不到现场 | 日志成为一等公民，事件可过滤、可按 runId 串联 |
| 目标库是 PG 15 | 现有私有数据库 | 只用 PG 10+ 语法，禁用 `any_value`(16+)、`json_table`(17+) |

## 2. 分层与职责边界

```
adapters/   ── 只负责"把某个平台的数据变成 RawOffer"，不做入库决策
ingest.js   ── 只负责"怎么落库"（判重、快照、日聚合），不关心数据从哪来
store/      ── 只负责"SQL 与连接"，不含业务判断（域 SQL 抽到 store/<domain>-repository.js）
routes/     ── 域路由：只负责 HTTP 输入输出编排，SQL 一律走 store/（拆分模式见 §15）
report.js   ── 只负责"把查询结果渲染成静态 HTML"，不查库（数据由调用方传入）
cli.js      ── 只负责"编排与输出"，不写 SQL
scheduler   ── 只负责"什么时候跑"，不关心跑什么
```

边界清楚带来的直接好处：**加一个平台不需要动 ingest 和 store**。适配器只要吐出一致的 `RawOffer`，后面全部复用。

`RawOffer` 的约定（新增平台必须满足）：

```js
{
  platformCode,        // 与 platforms.code 对应
  platformProductId,   // 平台内部商品 ID（用于 alias 去重）
  steamAppid,          // 能为 null，但为 null 就无法与 Steam 数据合并
  title,               // 平台上的名称，用于对齐与展示
  productType,         // official_direct / authorized_key / c2c_listing
  region, currency,
  priceCents,          // 一律整数分，禁止浮点
  originalCents, discountPct,
  inStock,
  buyUrl,              // 必须是可点击的真实购买页
  meta                 // 平台特有字段，进日志便于排障
}
```

## 2.1 从零到可用：启动链

"开箱即用"不是一句口号，它对应一条明确的链，每一环都可重复执行（幂等），失败只影响自己：

```
openStore(target)                          src/store/index.js
  └─ ensureDatabase(target)                库不存在就连 /postgres 执行 CREATE DATABASE
       └─ 无权限/连不上 → 只记 warn，继续（后面真实连接会报更明确的错）
cli bootstrap                              src/cli.js
  ├─ migrate()                             8 张表 + 1 视图 + 平台字典，全部 if not exists
  └─ games 为空？→ 读 data/games.json 导入   已导入则跳过（SEED_ON_START=0 可关）
scheduler                                  src/scheduler.js
  └─ 按间隔派生子进程跑采集 / 提醒
```

三个刻意的设计：

1. **建库失败不致命**：托管数据库通常不给建库权限，此时应继续走正常的连接逻辑，
   让 `pg` 抛出"database does not exist"，比在这里抛"权限不足"更好定位。
2. **不配 `DATABASE_URL` 也能跑**：CLI 会降级到嵌入式 PGlite（`data/pgdata`），
   本地试验不需要先装数据库。
3. **每一步都幂等**：容器重启、`docker compose up` 重跑、升级后重跑，都不会产生重复数据。

## 3. 一次采集的完整时序

```
cli.js
 ├─ 生成 runId（贯穿本次命令所有日志）
 ├─ openStore()：连接池 + 注册 DATE parser
 ├─ startFetchRun()：先落一行"开始"，即使后面崩了也有痕迹
 │
 ├─ adapter.sync*
 │    ├─ 分批请求：每批记 http.request / http.response（含 bytes / elapsedMs）
 │    ├─ 每批解析：记 adapter.*.batch（requested / parsed / skipped）
 │    └─ 失败重试：记 http.retry（原因 + 等待时长）；最终失败记 http.fail
 │
 ├─ ingestOffers()
 │    └─ 逐条 offer：
 │         ├─ ensurePlatform / ensureGame / upsertAlias（别名表记 match_method）
 │         ├─ findOffer → insert 或 update
 │         ├─ lastSnapshotHash 对比 → 不同才 insertSnapshot
 │         └─ upsertDaily（LEAST(旧, 新) 取当天最低）
 │
 ├─ finishFetchRun()：回填 requests / ok / skipped / failed / status
 └─ sync.done + ingest.summary：一行看全量结果
```

关键点：**`fetch_runs` 在开始时就写一行，结束时回填**。这样即使进程被 kill，也能看到"有一轮跑了但没结束"，而不是什么都没有。

## 4. 数据模型的三次决策

### 4.1 为什么 `offers` 和 `price_snapshots` 要分开

- `offers` 回答"现在多少钱"：每个 (game, platform, type, region) 唯一一行，查询高频、数据量小。
- `price_snapshots` 回答"曾经多少钱"：只追加，**价格没变就不写**。

如果不分开，每次查询当前价都要在几千万行里做窗口函数；如果不做"变化才写"，一年会灌入 `3000 游戏 × 24 次 × 365 天 ≈ 2600 万行` 的冗余。

判重靠 `raw_hash`：只对 `priceCents | originalCents | discountPct | inStock` 做 SHA-1，`buyUrl` 变化不会产生新快照（它不影响价格）。

### 4.2 为什么区服是独立维度

国区 ¥298、全球 $60、土区 ₺1200 不是"同一个东西的不同价格"——它们对应不同的激活限制、支付方式和合规风险。用一个 `price` 字段糊在一起，最低价就一定是错的。

因此唯一键是 `(game, platform, product_type, region)`，查询必须显式带上 region。

### 4.3 为什么 DATE 要当字符串

`pg` 默认把 `date` 解析成 JS `Date`（本地时区午夜）。跨时区时 `2026-10-26` 可能变成 `2026-10-25T16:00:00Z`，于是：

- 按天聚合会把同一天拆成两天；
- 史低比较会差一天。

两层修：存储层注册 identity parser（`pg.types.setTypeParser(1082, v => v)`），SQL 里统一 `::text`。**这条踩过，不是理论风险。**

## 5. 失败模型
| 场景 | 行为 | 为什么 |
|---|---|---|
| 单条 offer 入库失败 | 捕获、记 `ingest.offer_failed`、继续下一条 | 一条脏数据不该让整轮作废 |
| 单个平台采集失败 | 子进程非 0 退出，调度器记 `scheduler.job_failed` 并继续 | 平台之间彼此独立 |
| 采集中途进程被杀 | `fetch_runs` 留一行"未完成" | 能看到"跑过但没跑完" |
| 数据库连不上 | `DB_WAIT_SEC` 内重试，超时才失败 | 容器编排下 db 可能比 app 晚就绪 |
| **没有**用长事务 | 每条语句自动提交 | 幂等 upsert 下，中途失败下一轮自愈；长事务反而容易占死连接池 |

**已知缺口**：熔断状态只在调度器进程内（重启清零），且只覆盖调度器派发的任务——手工执行的 `sync` 不受熔断保护。

## 6. 日志模型

### 事件命名

`域.动作`，域固定为：`http` / `db` / `adapter.<平台>` / `ingest` / `sync` / `scheduler` / `diagnose` / `process`。

用 `logs --event http` 这种前缀过滤就依赖这个约定，所以**新增事件不要自创域**。

### 一次请求的完整痕迹

```
http.request   {label, requestId, attempt, url}
http.response  {label, requestId, status, bytes, elapsedMs, contentType, finalUrl}
http.retry     {label, requestId, attempt, delayMs}
http.error     {label, requestId, code, hint, status, bodySnippet, retryable}
http.fail      {label, url, code, hint}          ← 最终失败
```

`requestId` 是单次尝试的随机串，`runId` 是整个命令。排障顺序：先按 `runId` 看全貌，再按 `requestId` 看某次请求细节。

### 脱敏规则

| 情况 | 处理 |
|---|---|
| 键名匹配 `token` / `cookie` / `apikey` / `secret` / `password` | 值替换为 `***` |
| 值是 URL 形态（`postgres://user:pw@host/db`） | 只抹密码，保留 host 与库名 |
| URL 查询参数名含 `key` / `token` / `sign` | 值替换为 `***` |

保留 host 和库名是刻意的：排障时"连错库"和"密码错"是完全不同的两个问题，全抹掉就没法判断。

### 体积

正常一轮（3000 游戏，只记 info）大约 200–400KB/天；`trace` 级别会把每条 SQL 都记下来，量级上升到几十 MB——**生产不要开 trace**。

## 7. 加一个新平台

以 Fanatical 为例，四步：

1. **勘查**（不要凭猜）：
   ```bash
   node scripts/inspect.js https://www.fanatical.com/zh-cn/game/xxx
   node scripts/mine-bundle.js <页面引用的 JS>
   ```
   目的是回答：服务端渲染还是 SPA？价格在 HTML 还是内嵌 JSON？有没有公开 API？

2. **写适配器** `src/adapters/fanatical.js`：
   - 导出 `descriptor`（code / name / kind / defaultRegion / currency）
   - 导出 `fetchXxx()`，返回 `RawOffer[]`
   - 解析失败时记 `adapter.fanatical.*` 事件，并返回空数组而不是抛异常

3. **注册平台**：在 `src/store/pg.js` 的 `migrate()` 里加一行 `platforms`，`kind` 决定它能不能进主榜。

4. **写测试**：把真实页面存成 `test/fixtures/real-xxx.html`，对着它断言价格、名称、SKU id——**不要手写假 HTML**，那样测不出页面改版。

检查清单：

- [ ] 价格是整数分，没有浮点误差
- [ ] `region` / `currency` 正确
- [ ] 失败路径有日志且信息足够定位（带 URL、状态码、响应片段）
- [ ] 限速（默认 ≥1 秒/请求）
- [ ] 真实页面夹具 + 断言
- [ ] 更新 [DATA-SOURCES.md](DATA-SOURCES.md) 里的可达性表

## 8. 静态价格页（report.js）

`chart` 把 `daily_prices` 渲染成一套静态 HTML，而不是做一个 Web 服务。几个决定：

| 决定 | 理由 | 代价 |
|---|---|---|
| **静态生成**，不做服务端渲染 | 个人自用、数据只读、零运维：产物可以直接双击打开、丢静态托管、或挂到任意 CDN | 没有实时性，要重新生成 |
| **手写内联 SVG**，不引前端库 | 运行时依赖仍然只有 `pg` 一个；离线可用；单页 7KB | 没有交互（缩放、悬浮提示） |
| **渲染函数是纯函数** | 输入数据 → 输出字符串，不碰 DB；单测可以逐字断言 SVG | 数据组装逻辑落在 `buildSite` 里 |
| **所有外部文本必须 `esc()`** | 游戏名、平台名来自第三方站点，是**不可信输入**；不转义就是注入面 | 无 |

图表本身有两个容易做错的地方，都是实际调试出来的：

1. **Y 轴必须是"整数刻度"**。最初按数据范围 ±8% 后均分，刻度出来是 ¥83 / ¥141 / ¥199——数学正确但读不了。现在用 1/2/5 × 10ⁿ 的步长对齐（`niceStep`），标签才是 ¥50 / ¥100 / ¥150。
2. **价格全平时不能除零**。所有价格相同时 `yMax - yMin = 0`，必须给一段人工区间，否则坐标是 `NaN`，SVG 静默变成空白。测试里专门有这条断言。

## 9. 关注与提醒（watchlist / alerts）

### 触发语义

两种，互斥：

| 配置 | 触发条件 | 用途 |
|---|---|---|
| `target_cents` 有值 | 当前最低价 ≤ 目标价 | "到 ¥100 叫我" |
| `target_cents` 为空 | 当前最低价 ≤ 史低 | "只关心它破史低" |

同时配置时**目标价优先**——用户既然设了心理价位，破没破史低不重要。

### 去重规则：比价格，而不是比时间

`watchlist.last_notified_cents` 记住上次通知的价格，**当前价 ≥ 上次通知价就不重复提醒**。

不用"N 天内不重复"这类时间窗口，是因为两种失败都很难看：窗口太短 → 同一价格反复骚扰；窗口太长 → 真的又降了却没人告诉你。按价格比较则天然正确：同价不打扰，更便宜必通知。

### 为什么没配 webhook 就不标记

`alerts` 默认是只读检查。如果"检查完就标记已通知"，而用户根本没收到消息，提醒就被静默吞掉了。所以：

- 没有 `ALERT_WEBHOOK_URL` → 只输出简报，**不写** `last_notified_*`
- 有 webhook 且投递成功 → 才标记
- 有 webhook 但投递失败 → **不标记**，下一轮重试（投递失败只记日志，不抛异常）

调度器据此决定子任务参数：`ALERT_WEBHOOK_URL` 存在时传 `alerts --mark`，否则只传 `alerts`。

### 熔断为什么在调度器里

熔断状态（连续失败次数、解禁时间）需要跨子进程存活，而每个采集任务是独立进程，所以状态放在调度器内存里。代价是**调度器重启后状态清零**——这是可接受的：重启通常意味着人为介入或部署，重新试一次比继承"上次被熔断"更合理。

连续 `CIRCUIT_THRESHOLD`（默认 3）次失败后，该任务暂停 `CIRCUIT_COOLDOWN_MIN`（默认 360）分钟。期间每次到点只记 `scheduler.circuit_skip`，不再请求目标站——持续 403 时继续重试只会更快被封。

### 投递通道

三种通道（`src/notify.js`），可以同时配置，结果逐条记录：

| 通道 | 触发条件 | 成功判定 |
|---|---|---|
| 通用 webhook | `ALERT_WEBHOOK_URL` | HTTP 2xx |
| 企业微信机器人 | `WECOM_WEBHOOK_URL` | HTTP 200 **且** `errcode=0` |
| 邮件 | `SMTP_HOST` + `ALERT_EMAIL_TO` | SMTP 走完 QUIT |

**任一通道成功即视为"已送达"**，然后才写 `last_notified_*`。全部失败则不标记，下一轮重试——宁可重复提醒，也不能把提醒吞掉。

邮件为什么自己实现 SMTP 而不是引 nodemailer：项目运行时依赖只有 `pg` 一个，加上 SMTP 客户端会很突兀；而且自实现的好处是**协议对话可以在本地假 SMTP 服务器上逐行断言**（EHLO → AUTH PLAIN → MAIL/RCPT → DATA → QUIT，连 `AUTH PLAIN` 里 `\0user\0pass` 的 base64 都能验），比"配好了应该能发"可靠。代价是不支持 OAuth2 与附件。

中文主题按 RFC 2047 编码成 `=?UTF-8?B?...?=`，正文 base64 并按 76 字符折行——这两条都有测试，因为不这么写的话多数客户端会显示乱码。

## 10. 跨平台名称匹配（match.js）

杉果页面里没有 Steam appid（实测页面上不存在 `steam_appid` / `appid` / `steampowered.com/app/` 任何字段），所以对齐只能靠名称。

### 为什么用 bigram Dice 而不是编辑距离

中文没有词边界，"赛博朋克2077" 与 "赛博朋克 2077" 在编辑距离上差 1，但 "巫师3" 与 "巫师" 也差 1 —— 后者完全不是同一个游戏。字符 bigram 的 Dice 系数对长度和顺序更宽容，且对中文/英文一致，不需要分词器。

### 归一化踩过的两个坑

1. **`™` 会被 NFKC 展开成 "TM"**：`ELDEN RING™` 变成 `elden ringtm`，必须先去商标符号再 normalize。
2. **"删掉所有 ASCII 取中文"会连数字一起删**：`全境封锁2` 变成 `全境封锁`，而 2 是标题的一部分。现在中文片段用"以汉字开头、允许后接数字"的匹配，英文片段单独抽。

还有一个隐蔽的假高分：如果把纯数字也当成"中文片段"，`Cyberpunk 2077` 会生成变体 `2077`，与中文标题里的 `2077` 得到 0.6 分。中文片段的规则要求**必须以汉字开头**。

### 阈值与人工确认

| 分数 | 处置 |
|---|---|
| ≥ 0.94 | `--apply` 时自动写入 `appid` |
| 0.86 – 0.94 | 只打印提案，等 `--confirm <skuId> <appid>` |
| < 0.86 | 视为无候选，宁可不匹配 |

宁可不匹配也不乱匹配：错的 appid 会把两件不同游戏的价格混进同一条曲线，比缺数据难查得多。

### 确认之后要合并重复行

历史原因：早期导入时没有 appid，会按名称建一条**孤立游戏行**；后来确认了 appid，报价如果直接记到 Steam 游戏行，孤立行就会留下过期价格。

`mergeGames(from, to)` 负责迁移：报价（快照跟着 `offer_id` 走）、日聚合（同键取 `LEAST`）、别名、关注列表，最后删除源行。同平台同渠道类型的重复报价保留目标行那条，源行的快照一并清理。

## 11. 多区服对比

`region` 从第一天就在数据模型里（唯一键含 region），但直到这一版才真正被用起来。

### 采集：只有声明支持多区的适配器才分批

GOG 的 catalog 接口接受 `countryCode` + `currencyCode`，是目前唯一能做多区的源
（杉果只有国区，Steam 被网络阻断，ITAD 需要 key）。区服到国家/币种是一张**显式映射表**
（`REGIONS`），不认识的区服直接报错——猜错国家会静默拿到错误口径的价格。

### 展示：不同币种不折算

这是刻意的：

- 折算需要实时汇率，硬编码一个汇率会把比较结果做**错**；
- 用户真正想知道的是"这个区多少钱"，而不是"折成人民币多少钱"（后者还涉及支付方式能否落地）；
- 所以对比视图**按区服并排**，只在同币种内比数字，并显式提示"跨区数字不可直接比较"。

同区服内仍然按价格排序并标出"该区最低"——这里币种一致，比较是成立的。

### 结构约束在多区视图里同样生效

`regionOffers` 也 join `platforms.kind`，C2C 报价不会出现在对比里（`test/regions.test.js` 有回归断言）。

## 12. 游戏元数据的双后端

游戏信息（名字/封面/发行日期/开发商）来自 Steam，但 Steam 官方接口在很多网络环境不可达。
所以做了两个后端，同一套归一化输出：

| 后端 | 接口 | 能给什么 | 缺什么 |
|---|---|---|---|
| `official` | `store.steampowered.com/api/appdetails`（`filters=basic`） | 本地化名、`is_free`、封面、发行日期、开发商 | 很多网络环境访问不到 |
| `steamcmd` | `api.steamcmd.net/v1/info/{appid}`（PICS 数据镜像） | 英文名、`name_localized.schinese`、`header_image.schinese`、发行日期、开发商 | 没有可靠的 `is_free`；不能按名字搜索 |

`--backend auto`（默认）先探官方（5 秒超时、不重试），不通就回落镜像，并把实际用的后端记进
`steam.meta.done`。这样同一份代码在"能访问 Steam 的服务器"和"不能访问的开发机"上都能用。

### 名字为什么"只补空缺"（外加一条机器英文名例外）

第一版是"元数据权威，覆盖旧值"，实测立刻踩坑：730 的 `sc_schinese` 还是旧的
「反恐精英：全球攻势」，一导入就把人工维护的「反恐精英 2」改掉了。

现在的规则是**只填空缺、只保护人工值**：

- `name` 为空 → 用元数据补上；
- `name` 是**机器英文名**（`name_en` 为空且不含中文）→ 允许被中文名覆盖，
  被替换的英文名挪进 `name_en`。这条例外是为目录导入的历史遗留开的：
  `GetAppList` 没有语言参数，英文基础名一度占死了 `name` 槽位（生产 19.6 万行
  仅 1.14 万有中文名）；
- 其余（中文名、或 `name_en` 已有人工值）→ 不覆盖。

目录导入（`importCatalogGames`）从源头配合：含中文的基础名写 `name`，否则写
`name_en`，不再产生新的"英文占位"行。存量用 `node src/cli.js rename` 重写。
类型/封面/发行日期/is_free 仍以元数据为准（这些没人手工维护）。
`is_free` 用 `case when $5 is null then games.is_free else $5 end`，因为镜像给不了这个字段，
传 null 不能把它改成 false。

## 13. 容量与性能

| 项 | 估算 |
|---|---|
| 游戏数（个人使用） | 10²–10³ |
| 快照年增量 | 变化次数 × 游戏数，通常 10⁵ 量级 |
| 单轮查询 | `lowestOffers` 走视图 + 索引，毫秒级 |
| 单轮采集 | Steam 3000 款 ≈ 50 分钟（1 请求/秒，批量 30），正好卡在"每小时"的物理上限 |
| PGlite 上的 DDL | 10–30 秒（wasm 编译成本，真实 PG 上是毫秒级） |

## 14. 已知技术债

1. **名称匹配是妥协**：杉果页面没有 Steam appid，只能靠 bigram 相似度 + 人工确认；
   匹配率受游戏库覆盖限制（当前 46 个 SKU 与 24 款 Steam 游戏零交集）。
2. **`ensureGame` 对无 appid 的游戏按名称去重**，同名不同游戏可能被合并——目前靠人工维护 SKU 清单规避。
3. **静态页没有交互**：不能缩放、不能看某一天的精确价格；要交互得引前端框架，暂时不值得。
4. **提醒只有 webhook 出口**，没有邮件、没有企业微信/钉钉的模板适配。
5. **ITAD 结构未用真 key 验证**：有 shape mismatch 日志兜底，但首次接入仍需要人盯一次。
6. **熔断状态不持久化**：调度器重启即清零（见 §9 的取舍说明）。

## 15. 域路由拆分模式（CO-4/B4：巨石拆分试点，后续域照此复制）

背景：`server.js`/`pg.js` 曾经是 4730/3987 行的巨石（路由 + 业务 + 渲染 + SQL 混在一起），
改动风险高、评审困难（[DESIGN-AUDIT.md](DESIGN-AUDIT.md) B4）。拆分是**渐进式**的：一次一个域，
外部契约（路径/参数/响应/错误码）零变化，全部以"先抽出、后瘦身"的方式推进。

### 15.1 目录约定

| 落点 | 内容 | 规则 |
|---|---|---|
| `src/routes/<domain>.js` | 该域的全部路由处理器 | 只做 HTTP 输入输出编排；**不写 SQL 字面量**（走 repository） |
| `src/store/<domain>-repository.js` | 该域专属 SQL（DDL + 查询函数） | 函数签名与拆分前一致；只含本域 SQL，通用 SQL 留在 pg.js |
| `src/store/pg.js` | 聚合壳 + 通用 SQL | 域 repository 用 `export { … } from './<domain>-repository.js'` re-export，**旧 `db.*` 导入签名永远不变** |

拆分期间 `pg.js` 同时承担两职：通用 SQL 的实库 + 域 SQL 的 re-export 壳。
域拆完它自然只剩聚合壳；**任何一步都不允许删除 re-export**（`test/app-token.test.js` 有静态锁）。

### 15.2 路由上下文注入（RouteContext，一次定死）

路由模块**不 import server.js**（避免循环依赖），宿主把请求期上下文打包成 `ctx` 传入。
`ctx` 是一份**按域组装的普通对象**，字段分两类：

**固定基座**（每个域的主入口都收这些）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `path` / `req` / `res` | 请求本体 | path 可能已被前缀重写（见 15.4） |
| `q` | 查询函数 | 传 repository 用；路由模块自己 `import * as db from '../store/pg.js'` |
| `logger` / `json` / `readBody` | 基础设施 | 响应包装与请求体读取（与宿主同一实现） |
| `user` / `bearer` | 认证结果 | 认证上下文解析**留在 server.js**，路由只读 |
| `token` | 会话 cookie 值 | `cookies` 已解析；认证域登出/改密按 token 删会话（其它域不需要） |
| `requireUser` / `requireAdmin` | 认证守卫 | 已在宿主闭包里写好 401/403 文案，直接调 |
| `ip` / `whitelisted` | 拦截链结果 | 只读；路由不得自行调用计数型限流 |
| `hit` / `deviceBan` / `deviceId` | 拦截链只读结果 | 黑名单命中 / 设备封禁 / 设备 ID——链上算好传入，路由不重复计算（申诉域用） |
| `url` / `cookies` | 请求上下文 | `url.searchParams` 读分页参数（管理段用）；`cookies` 在链上已解析 |
| `captcha` / `settings` 等 | 域需要的共享模块 | 按域按需加入 |

**域特有**（按引用传递的可变状态，语义共享）：

| 字段 | 例子 | 为什么按引用 |
|---|---|---|
| 进程级计数 Map | `loginIpFails` | App token 登录与 Web 登录**共用同一套失败计数**，各写各的会分家 |
| 限流桶函数 | `appealBucketLimited` | 申诉接口与 `/api/captcha` 共用同一内存桶（闭包持有 server.js 的 Map） |
| 单飞状态持有对象 | `appSync = { inFlight: null }` | 并发请求共享同一 Promise（single-flight） |
| 闭包函数 | `tryAutoBan`、`siteName`、`appealEmail`、`newAppealCode` | 依赖宿主的 `autoBanScope`/q/ratelimit 闭包；`newAppealCode` 因封禁页仍用而留宿主 |
| Steam 绑定 state Map | `bindStates` | 认证域 issue/consume 与 server.js 持有同一 Map（state 生命周期跨请求） |
| 测试注入函数 | `steamVerify` | verifyCallback 替身（默认走 steam-login.js 真实现），测试传假实现离线验证绑定回调 |

**约定**：`ctx` 只加不减——新字段进基座表并写进本节；**传引用字段必须注释"语义共享"**，
防止后人误改成"传值拷贝"。

### 15.3 入口按位置语义分段（顺序语义，不能合并）

域内路由对"跑在哪一段"有硬约束时，模块导出**多个入口**。两种已出现的形态：

| 入口 | 调用位置 | 适用 |
|---|---|---|
| `handle<Domain>Preflight(ctx)` | `/api/ban/state` 之后、设备维度限流与封禁拦截链**之前** | 必须豁免拦截链的路由（如 `/api/app/status` 封禁自查） |
| `handle<Domain>Routes(ctx)` | 认证上下文（user/bearer/requireAdmin）就绪之后 | 其余全部路由 |
| `handle<Domain>Public(ctx)` / `handle<Domain>Admin(ctx)` | 公开段：拦截链之后、**认证上下文解析之前**；管理段：requireAdmin 之后 | 域内路由对"用户解析前后"有硬约束时（申诉域：已登录但 must_change_password 的用户也要能提交申诉，公开段必须在白名单检查之前；管理段需要 user/requireAdmin） |

各入口共享同一 ctx 构造约定；返回值统一 `true = 已处理并结束响应 / false = 未命中，宿主继续`。
**移动调用位置 = 改契约**：预检段路由一旦挪到拦截链之后，就会新增限流/封禁副作用（App 契约 §3 不允许）；
公开段路由一旦挪到认证上下文之后，就会被 must_change_password 白名单拦下（申诉契约不允许）。

### 15.4 什么留在 server.js（中间件 ≠ 路由）

以下**作用于整条请求链**的东西不随域拆走：

- 前缀重写（`/api/app/<rest>` → `/api/<rest>`，CA-1）、Bearer 头解析、`user` 解析——它们决定**所有**路由看到的 `path`/`user`；
- `/api/app/*` 封禁豁免、设备维度限流（CO-3/C2）、全局三振限流——它们拦截在路由之前，作用于整个命名空间；
- 首次初始化拦截（setup 未完成时）、must_change_password 白名单——同样的理由。

判据：**"只有这个域的路由会走" → 抽走；"所有域都经过" → 留在 server.js**。

### 15.5 后续域拆解步骤（checklist）

1. 读 [TODO.md](TODO.md)/[ACTIVE-SESSIONS.md](ACTIVE-SESSIONS.md) 认领，文件面登记；**一次一个域**；
2. 盘点域内路由：`grep -n "path === '<前缀>'" src/server.js`，逐条确认无其它路由抢占同一 path+method；
3. 建 `src/routes/<domain>.js`：复制路由体，把 `q/logger/json/…` 改为从 `ctx` 解构；
   按 15.3 选入口形态——需要预检段的路由进 `handle<Domain>Preflight`，其余进 `handle<Domain>Routes`；
   域内对"用户解析前后"有硬约束时用 `handle<Domain>Public` / `handle<Domain>Admin` 两段（申诉域先例），
   "公开段 + 主段"组合同样成立（认证域先例：/api/device 在白名单前走公开段，其余认证路由进主段）；
4. 抽该域 SQL：`grep -n "<域特征>" src/store/pg.js` 找到专属 DDL/函数 → 建 `src/store/<domain>-repository.js`
   （签名照抄）→ pg.js 顶部 import + re-export，`migrate()` 继续消费其 DDL 常量；
   **域内联 SQL**（此前直接写在路由体里的字面量）同样抽成 repository 新函数——认证域先例：
   登录失败计数/锁定/改密/Steam 绑定 10 函数；**跨域共用的通用 SQL 一律留 pg.js**
   （判定：有没有别的域/模块也用，如 findUserByName/会话函数/insertDeviceLog）；
5. 在 server.js 原位置换入各入口调用（预检段/公开段/管理段位置**必须原样**），组装 ctx（基座 + 域特有）；
6. 修静态断言测试指向新文件，并加三条锁：路由分支在新文件、宿主真实接线（防死模块）、
   旧分支不残留在 server.js（防双实现）；**反向自检**：删一个路由分支 → 对应测试必须红；
7. `node test/<域相关>.test.js` → `npm run test:1..4` → `node test/api.test.js` → `frontend:build` → `scan` 全绿；
8. 回写 [DESIGN-AUDIT.md](DESIGN-AUDIT.md)「跟踪」列 + [PROJECT-OVERVIEW.md](PROJECT-OVERVIEW.md) 代码落点表；
   验收汇报里给 **拆分前后行数对比**（域代码净移出、契约零变化）。

### 15.6 已拆域

| 域 | 路由模块 | repository | 拆出内容 | 批次 |
|---|---|---|---|---|
| App 客户端 API + 分发 | `src/routes/app.js` | `src/store/app-repository.js` | `/api/app/status`、`/api/app/latest`、`/api/auth/token`、`/api/auth/token/revoke`、`/api/admin/app-sync`、`/api/admin/app-sync/status`；api_tokens 表 + 4 个 token 函数 | 已发布 v2.27.1（CO-4/B4 试点，2026-11-19） |
| 申诉系统（公开 + 管理） | `src/routes/appeal.js` | `src/store/appeal-repository.js` | `/api/appeal`、`/api/appeal/:code`、`/api/appeal/action`（公开段）、`/api/admin/appeals`、`/api/admin/appeals/:id/resolve`（管理段）；appeals 表 + 12 个申诉 SQL 函数 | 已发布 v2.27.1（CO-4/B4 第二轮，2026-11-19） |
| 认证（Web 登录/密码/验证码/设备 + Steam 绑定） | `src/routes/auth.js` | `src/store/auth-repository.js` | `/api/device`（公开段）、`/api/captcha`、`/api/login`、`/api/password/check`、`/api/logout`、`/api/user/password`、`/api/auth/steam/start`、`/api/auth/steam/callback`（主段）；登录失败计数/锁定/改密/Steam 绑定 10 个 SQL 新函数（本轮无 pg.js 现有函数搬家，域内联 SQL 抽新函数） | CO-5/B4-2（第三轮，已发布 v2.27.2，2026-11-19） |
| watchlist / wishlist（用户段） | `src/routes/watchlist.js` | `src/store/watchlist-repository.js` | 用户段 6 条路由——`GET/POST /api/watchlist`、`DELETE /api/watchlist/:gameId`、`POST /api/wishlist`、`DELETE /api/wishlist/:appid`、`DELETE /api/wishlist/id/:gameId`；upsertUserWatch/deleteUserWatch/listUserWatches 3 函数搬家 + 域内联 SQL 抽新函数；`watchUserFails` 限流 Map 随域移入（语义共享）；admin 段/steam-accounts 段留宿主（B4 #16/#7） | 已发布 v2.27.3（CO-5/B4-2 第四轮，2026-11-20） |
| 公告（公开 + 主段 + 管理） | `src/routes/announcements.js` | `src/store/announcements-repository.js` | `GET /api/announcements`（公开段）、`POST /api/announcements/read`（主段）、`GET/POST /api/admin/announcements` + `PATCH|PUT/DELETE /api/admin/announcements/:id`（管理段，首个三段域）；CRUD 4 函数搬家 + 域内联 SQL 3 新函数；`/api/admin/bulk` 派发表 announcements 三条目留 #11；announcements 表 DDL 跨域共用留 pg.js | 已发布 v2.27.3（CO-5/B4-2 第五轮，2026-11-20） |
| me（个人资料/头像/游戏库） | `src/routes/me.js` | `src/store/me-repository.js` | `GET /api/me`、`POST /api/prefs`、`GET /api/avatar/:userId`、`PATCH /api/me/profile`、`POST|DELETE /api/me/avatar`、`GET /api/me/library`；`/api/me/email/*` 与 `/api/auth/email*` 同属 auth-routes.js 模块（DT-2 排除区）整块留原地；默认 Steam 账号/库统计 SQL 跨域共用留 pg.js | 已发布 v2.27.3（CO-5/B4-2 第六轮，2026-11-20） |

**第二轮选申诉域的理由**（与认证域二选一）：① 边界最独立——全部 `/api/appeal*` 与
`/api/admin/appeals*` 由申诉系统独占，唯一跨域共享的 `appealBucketLimited` 按 §15.2 闭包传引用即可，
验证码路由留 server.js 不冲突；② 试点 QA（docs/QA-CO4-B4.md 条目 11）的「下一步建议」正是申诉域；
③ 认证域是 App 认证 / Web 登录 / Steam 登录三方交汇点（`loginIpFails`/auto-ban/验证码共享最复杂，
且 `/api/auth/token` 已在 App 域、命名易混淆），留到模式成熟后再拆。
**与试点的差异**：试点是「预检段 + 主段」，申诉域是「公开段（用户解析前）+ 管理段（requireAdmin 后）」
——没有预检段，但公开段必须在 must_change_password 白名单**之前**（§15.3 第三种形态，已写入 checklist）。

**第三轮选认证域的理由**（用户交接指定，与第二轮建议一致）：① 边界独立——除 `/api/auth/token*`
（已在 App 域）外的全部 `/api/auth/*` 与 `/api/login|logout|password/check|user/password|captcha|device`
由认证域独占，跨域共享的 `loginIpFails`（与 App token 登录同 Map）/`appealBucketLimited`
（与 /api/captcha 同桶）/`bindStates` 按 §15.2 闭包传引用即可；② 测试齐——auth-redesign 相关
（auth-lockout/password-change/password-policy）、captcha（api.test/appeal-system 共用桶断言）、
device（devices/reviews/admin-bulk）三族断言锁定行为；③ 避开 `/api/games*`（DX 在途）与
`/api/me*`（DT-2 在途）；邮箱验证码/注册/换邮箱（`src/auth-routes.js`）本轮不动——独立模块且
`/api/me/email/*` 属 DT-2 排除区，与 `/api/auth/email*` 同模块不拆半截。
**与第二轮的差异**：本轮是「公开段 + 主段」——`/api/device` 必须在 must_change_password 白名单
**之前**（改密页也要注册设备），其余认证路由在白名单之后（主段）；pg.js 本轮零函数搬家
（路由内联 SQL 抽 10 个新函数 + re-export 壳），`MAX_ACCOUNTS_PER_USER` 由 routes/auth.js 导出、
server.js 导入（`/api/steam/accounts` 共用同一上限）。

## 16. Android 导航状态保存规范（DY 批，2026-11-19）

> 适用：App 仓库 `F:\dsh\steamdeals-app`。Compose Navigation 跳转时列表页离开组合（dispose），
> `remember` 状态随之销毁，返回时页面重建为空——这是 DY 缺陷（详情返回后搜索/滚动/表单全丢）的根因。
> 本节是 App 端页面状态的唯一规范，后续新增/修改页面一律照此写；完整缺陷/验收见
> [ANDROID-POLISH.md](ANDROID-POLISH.md) §DY。

### 16.1 状态分层：按存活需求三选一

| 存活范围 | 工具 | 适用 |
|---|---|---|
| 组合期内（瞬时） | `remember` | 对话框开关、验证码图片对象、FocusRequester 等非状态对象、纯派生计算、loading/error 瞬时态 |
| 页面往返 / 旋转（Bundle 可存） | `rememberSaveable` | 滚动位置、筛选/排序选中项、非敏感表单输入、弹窗开关 |
| 页面往返 / 旋转 / 切 Tab（业务数据） | ViewModel（AppViewModel 扩展，或返回栈级 `viewModel(key=…)`） | 搜索词/结果/分页、列表数据、资料表单（含脏标记） |

- **Tab 切换**：AppNav 已有 `popUpTo { saveState = true }` + `restoreState = true` ✅ 不改；
  `rememberSaveable` 与返回栈级 ViewModel 都随它存活。
- **进详情再返回**：列表页留在返回栈——`rememberSaveable` 由 NavHost 的 SaveableStateHolder
  保存/恢复，ViewModel 不销毁；旋转/进程重建由 SavedStateRegistry 兜底（跨进程冷启动不要求，见 DY 边界）。

### 16.2 滚动位置：一律 Saver

- Lazy 列表：`rememberSaveable(saver = LazyListState.Saver) { LazyListState() }`；
- 普通滚动（表单 Column、筛选 chips 行）：`rememberSaveable(saver = ScrollState.Saver) { ScrollState(0) }`；
- 禁止用 `rememberLazyListState()` / 裸 `rememberScrollState()` 承接页面级滚动。

### 16.3 业务状态提升到 ViewModel

- 搜索/首页/愿望单/资料等跨导航往返的业务状态**提升到 ViewModel**。本项目用 AppViewModel 扩展
  （`vm.searchState` / `vm.homeState` / `vm.wishlistState` / `vm.profileState`）；详情页是返回栈级
  `viewModel(key = "detail-<appid>", factory = …)`，随返回栈弹出自动清理；
- 账号切换（登录/退出）时，ViewModel 里的用户数据必须复位（`resetForSessionChange()` / `reset()`），
  避免加载完成前闪现上一账号数据；
- 状态类内部的网络请求用 `viewModelScope`（页面销毁不取消，随 Activity 生命周期）。

### 16.4 表单输入：rememberSaveable + 安全例外

- 用户名/邮箱/昵称/简介等非敏感输入一律 `rememberSaveable`（旋转/返回不丢）；
- **密码类字段**（密码/确认密码）与一次性验证码（图形/邮箱验证码）**不落 saveable**（不入系统保存状态，
  安全惯例），旋转后需重输属预期行为——页面代码注释与规格实现说明里写明；
- 瞬时状态（loading/error/countdown/验证码图片对象）保持 `remember`。

### 16.5 验收口径（grep 断言）

10 个 Screen（Home / Search / Wishlist / Me / Detail / Login / Register / ChangePassword /
ProfileEdit / About）的状态类 `remember` 断言：Screen 组合函数里 `mutableStateOf` 与状态持有类实例
必须来自 `rememberSaveable` 或 ViewModel；允许 `remember` 的只有——纯派生计算、FocusRequester 等
非状态对象、§16.4 的安全例外字段与瞬时状态。DY 批的 grep 命令与残留白名单见
[ANDROID-POLISH.md](ANDROID-POLISH.md) §DY 实现说明。
