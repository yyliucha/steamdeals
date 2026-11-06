# Steam 代理池：多代理按序自动切换（已确认待开发）

> 状态：**需求与方案已确认（2026-11-06），待开发**。拆两批：**AM-1 代理池后端**、**AM-2 设置页列表与健康状态**。
> 关联：[DEPLOY.md](DEPLOY.md)（环境变量）、[WEB.md](WEB.md)（后台接口）、[HANDOVER.md](HANDOVER.md)。

## 1. 现状（代码事实，2026-11-06 核对）

| 项 | 事实 | 证据 |
|---|---|---|
| 配置 | `network.steamProxy` 是**单个 secret 字符串**，水合到 `STEAM_PROXY` | `src/settings.js:146`、`:777` |
| 校验 | 单值 `isHttpUrl()`，只允许 http/https | `src/settings.js`（`['network.steamProxy','network.httpsProxy']` 分支） |
| 决策 | `decideProxy()` 按目标主机选**一个**代理：Steam 域名优先专用，否则通用，最后直连 | `src/proxy.js:55-72` |
| 请求 | `route` 在 `while` 重试循环**之前**算一次，所有重试都走同一代理 | `src/http.js:186-210` |
| 失败识别 | 已有 `proxyStatus` / `retryable`（代理 407 不重试、502 重试） | `src/http.js:128-164`、`:273-276` |
| 设置页 | secret 单行输入 +「查看 / 清除」，无法表达多条 | `AdminModules.vue`（secret 分支） |

**核心结论**：现在代理挂了 = 这一轮所有重试都撞同一台；要做的不是"多存几个值"，而是把选代理挪进重试循环，并给每条代理记健康状态。

## 2. 已确认的决策（2026-11-06 所有者）

| # | 决策 |
|---|---|
| 1 | **切换条件 = 只网络层 / 代理层失败**：连不上、超时、TLS 错误、代理 CONNECT 4xx/5xx；**HTTP 5xx 与 429 都不切换**（429 按出口 IP 限流，切代理等于绕配额，继续走现有全局冷却） |
| 2 | **冷却**：首败 60 秒；连续失败 5 分钟；再失败 30 分钟封顶；成功一次清零 |
| 3 | **全部失败**：直接报错并记 `http.proxy_all_failed`，Steam 域名**不回退直连**（国内直连本来就不通，只会多等一次超时） |
| 4 | **配置形态**：设置页做成**列表**（增 / 删 / 上移 / 下移），**上限 10 条**，按顺序尝试 |
| 5 | **健康状态**：设置页显示每条代理的当前状态（正常 / 冷却中剩余时间 / 连续失败次数 / 最近错误） |
| 6 | 通用代理 `HTTPS_PROXY` **本期不动**（仍是单条）；SOCKS5 不支持 |

## 3. 数据与配置

### 3.1 配置存储（不新增 key）

- 仍是 `network.steamProxy`（secret，加密保存），**值改为换行分隔的多条**：`http://a:7890\nhttp://b:7890`；
- 老的单行配置 = 只有一条，**完全兼容**；环境变量 `STEAM_PROXY` 也接受换行或逗号分隔（解析层同时支持 `\n` 与 `,`）；
- 校验：按行拆分 → 去空 → 逐条 `parseProxy()` → 非法行返回「第 N 行不是合法的 http/https 代理」→ 去重（保留首次出现）→ 1–10 条。

### 3.2 健康状态文件（跨进程共享）

重任务跑在**子进程**里（`scheduler` 起的 `node src/cli.js …`），内存态各自独立；设置页在 server 进程，读不到子进程的状态。
所以健康状态落一个 JSON 文件，谁写谁读：

```
data/proxy-health.json          # 需加进 .gitignore
{
  "updatedAt": "2026-11-06T17:00:00+08:00",
  "lastGood": "a1b2c3d4e5f60718",        // 最近一次成功的代理 key（粘住用）
  "proxies": {
    "a1b2c3d4e5f60718": { "fails": 2, "downUntil": "2026-11-06T17:05:00+08:00",
                           "lastErrorAt": "…", "lastError": "ECONNREFUSED", "lastOkAt": "…" }
  }
}
```

- key = `sha256(proxyUrl)` 前 16 位——**文件里不出现代理地址与密码**；展示时用当前配置反查；
- 读写：进程启动时读一次；变更后 1 秒防抖、`写 tmp → rename` 原子落盘；多进程并发按"最后写入者胜"（可接受，最多丢一次计数）；
- 文件不存在 / JSON 坏了 → 当空状态，记 `proxy.health_reset`。

## 4. 服务端

### 4.1 `src/proxy.js`：解析与池化

```js
export function parseProxyList(value)   // 返回去重后的 URL 数组（换行/逗号分隔，逐条 parseProxy）
export function steamProxyUrls(env)     // 只取 STEAM_PROXY 的多条；没配返回 []
export function decideProxy(...)        // 保持原签名（非 Steam 主机/兼容测试用），Steam 分支的 url 取第一条
```

### 4.2 `src/proxy-pool.js`（新增）：选择、冷却、持久化

```js
export function candidatesFor(host, env)        // 按配置顺序，Sticky 优先，冷却中的排后面
export function nextCandidate(list, tried)      // 取第一条没试过的
export function noteProxyFailure(url, err)      // fails+1，算冷却，落盘
export function noteProxySuccess(url)           // fails=0、清冷却、记 lastGood
export function proxyHealth()                   // 给 API/diagnose 用（含 masked 地址与状态）
```

- **顺序**：`lastGood`（若在池内且不在冷却）→ 配置顺序里跳过冷却中的 → 其余；
- **全部在冷却**：取"最早解冻"的那条**仍然试一次**（否则长任务会被卡死），记 `http.proxy_cooldown_override`；
- **冷却时长**：`fails=1 → 60s`，`fails=2 → 5min`，`fails>=3 → 30min`。

### 4.3 `src/http.js`：把选代理挪进重试循环

当前 `route` 在循环外算一次（`:186`）。改成：

```
pool = steamProxyUrls(env)          // 只有 Steam 主机且池非空才启用
for attempt in 1..maxAttempts:
    route = pool ? nextCandidate(...) : 原逻辑（单代理/直连）
    请求 → 成功：noteProxySuccess(route.url); return
          → 失败且属于「代理层失败」：noteProxyFailure(...); 换下一条; continue
          → 其它失败：按现有 retry/backoff 逻辑（不换代理）
```

- `maxAttempts = Math.max(retries + 1, candidates.length)`，封顶 10；
- **不切换**：目标返回 HTTP 4xx/5xx（含 429）——这些是"有响应"，按现有重试/冷却处理；
- **切换**：`ECONNREFUSED`、`ETIMEDOUT`/`UND_ERR_CONNECT_TIMEOUT`、`ENOTFOUND`/`EAI_AGAIN`（代理主机解析失败）、
  TLS 握手错误、`UND_ERR_SOCKET`/`EPIPE`、以及 `proxyStatus` 4xx/5xx（CONNECT 被拒）；
- 池非空且全部尝试失败 → 抛 `PROXY_ALL_FAILED`，错误里带每条的最后失败原因；
- 非 Steam 主机、`forceDirect`、`fetchImpl`（测试注入）行为**完全不变**。

**测试必须锁住"换过代理"这件事**（这是最容易假绿的地方）：
- 测试里记录**每次尝试实际用的代理 URL / dispatcher**，断言"第 2 次尝试的代理 ≠ 第 1 次"；
- 只断言"最终请求成功"或"函数返回了"**不算**——旧实现（`route` 在循环外算一次）也能满足"成功"，但那是假绿；
- 另加一条反例自检（开发者做，把结果贴进汇报）：把 `nextCandidate()` 临时改成永远返回第一条，该测试**必须变红**；仍绿说明断言没锁住。

### 4.4 日志事件

| 事件 | 级别 | 字段 |
|---|---|---|
| `http.proxy_switch` | info | `from`（masked）、`to`（masked）、`reason` |
| `http.proxy_down` | warn | `proxy`（masked）、`fails`、`downUntil` |
| `http.proxy_ok` | debug | `proxy`（masked） |
| `http.proxy_cooldown_override` | warn | `proxy`（masked）、`downUntil` |
| `http.proxy_all_failed` | error | `count`、`lastError` |

### 4.5 健康状态 API（仅管理员）

`GET /api/admin/proxies` →

```json
{
  "proxies": [
    { "index": 1, "proxy": "http://127.0.0.1:7890", "state": "ok",
      "fails": 0, "downUntil": null, "lastError": null, "lastErrorAt": null, "lastOkAt": "2026-11-06T16:58:00+08:00" }
  ],
  "lastGood": 1,
  "updatedAt": "2026-11-06T17:00:00+08:00"
}
```

- `proxy` 用 `redactProxy()` 脱敏（账号密码 → `***`）；`state` ∈ `ok | cooldown | unknown`；
- 没配置代理 → `{ proxies: [] }`；
- `diagnose` 命令的 `describeProxy` 同步输出"池里有几条 + 每条状态"。

## 5. 前端（`AdminModules.vue` 系统设置 → 网络与代理）

### 5.1 列表编辑器（替换原来的单行输入）

- 卡片显示：`已配置 N 条`（N=0 时显示"未配置，Steam 走直连/通用代理"）；
- 「查看并编辑」按钮：调 `GET /api/admin/settings/value?key=network.steamProxy` 取回明文（沿用现有"查看"通道），
  填进可编辑列表——每行：地址输入框 + 上移 / 下移 / 删除；底部「添加一条」（满 10 条置灰）+「清空全部」；
- 保存：把非空行按顺序 `join('\n')` 提交 `POST /api/admin/settings`（`network.steamProxy`）；清空则传 `null`；
- 前端也做一遍简单校验（http/https、条数），服务端仍兜底。

### 5.2 健康状态

- 列表下方一张小表：`# | 代理 | 状态 | 连续失败 | 冷却到 | 最近错误`；
- 状态：`正常`（绿）/ `冷却中 3:20`（黄，倒计时）/ `未知`（灰，从未用过）；
- 「刷新」按钮 + 展开该分组时每 10 秒自动刷新（页面不可见时不刷）；保存后立即刷新一次。

## 6. 安全

1. 代理地址可能含账号密码：日志与健康 API 一律 `redactProxy()`；健康文件只存 hash，不存地址；
2. 只有管理员能读健康状态与明文（沿用现有 `/api/admin/settings/value` 权限）；
3. 不新增出网依赖；不改变 `NO_PROXY` 语义（Steam 专用代理本来就不受 `NO_PROXY` 影响）；
4. 多条代理 = 多个出口 IP，但**不用于绕 Steam 429**（429 不切换，见决策 1）。

## 7. 验收

1. 老的单行 `STEAM_PROXY` 配置照常工作（等于 1 条代理）；
2. 配 2 条代理：第 1 条拒绝连接 → 同一请求内自动切第 2 条并成功，日志有 `http.proxy_switch { reason: 'ECONNREFUSED' }`；
   **测试必须断言两次尝试用的代理不同**（不只是最终成功），且反例自检（永远用第一条）时该测试变红；
3. 第 1 条进入冷却后，后续请求**直接**从第 2 条开始（不再先撞一次死的）；
4. 第 2 条成功后被"粘住"：下个请求优先用它；第 1 条冷却结束后不会抢回；
5. 两条都失败 → 请求报错 `PROXY_ALL_FAILED`，日志 `http.proxy_all_failed`，**不尝试直连**；
6. 目标返回 HTTP 500 / 429 时**不切换代理**（仍按原重试/冷却逻辑）；
7. 重启进程（或另起一个 CLI 子进程）后，冷却状态仍在（读 `data/proxy-health.json`）；
8. 设置页：增 / 删 / 上移 / 下移、上限 10 条、非法行被拒且提示行号；保存后下一次请求即生效；
9. 健康状态表显示正常/冷却剩余/连续失败/最近错误，刷新与 10 秒自动刷新可用；
10. 日志与 API 里看不到代理密码；`data/proxy-health.json` 不含代理地址；
11. `npm test` 全绿（新增 `test/proxy-pool.test.js`、`test/http-proxy-failover.test.js` 并入主链）、
    `npm run frontend:build`、`npm run scan`。

## 8. 实施顺序

| 批次 | 内容 | 依赖 |
|---|---|---|
| **AM-1** 代理池后端 | §3 + §4（parse 多条、proxy-pool 模块、http 循环内切换、健康文件、`GET /api/admin/proxies`、日志、测试） | 无 |
| **AM-2** 设置页 | §5（列表编辑器 + 健康表 + 保存/清空） | AM-1（接口契约） |

## 9. 本期不做（写清楚，避免被当成漏项）

- SOCKS5 / 代理链（proxy chain）；
- 每条代理的并发上限、带宽限制、自动测速排序；
- 按请求轮询（round-robin）——顺序固定 + 成功者优先；
- 通用代理 `HTTPS_PROXY` 多代理；
- 代理自动发现/订阅。

## 10. 待确认

无。5 个问题已于 2026-11-06 确认（切换条件 A、冷却 60s/5min/30min、全部失败不回直连、列表 UI ≤10、显示健康状态）。
