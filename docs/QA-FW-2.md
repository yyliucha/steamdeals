# QA：FW-2 403/429 代理切换 + 全站速率闸门（第 1 轮）

> 基线 `14305c7` → HEAD `09c7036`（`feat(http): FW-2 403/429 代理切换 + 全站速率闸门（文件令牌桶 30/分钟）`）；
> 判据 [SLOW-SYNC.md](SLOW-SYNC.md) §8「FW-2」1~7 + §1.2 决策 7~13、§2.3、§2.4、§3.3、§5，
> 以及 [PROXY-POOL.md](PROXY-POOL.md) §12（本批正式修订 AM-1 决策 1）；开发描述摘自监工交接单（FW-2 子批）。
> 结论：**✅ 放行 —— 通过 7 / 缺失 0 / 偏差 0 / 需人工确认 4**（另有 1 条反例自检口径说明见「争议项记录」）

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/接口/任务行为） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | FW-2 | Steam 返回 **403** 时自动换下一条代理，不再用同一个出口 IP 空等 | 所有 Steam 同步任务（heat / steam-prices / steam-status / discovery / backfill …） | ✅ | `src/http.js:630-653`；`test/http-proxy-failover.test.js:324-347` |
| 2 | FW-2 | Steam 返回 **429** 时同样换代理；`Retry-After` 只记到该条代理，不当全局冷却 | 同上 | ✅ | `src/http.js:640-654`、`:671-694`；`test/http-proxy-failover.test.js:350-374` |
| 3 | FW-2 | **5xx 仍不换代理**（Steam 自身故障，换 IP 没用）——保留 AM-1 原重试逻辑 | 同上 | ✅ | `src/http.js:708-728`；`test/http-proxy-failover.test.js:237-256` |
| 4 | FW-2 | **每请求 403/429 最多试 3 条代理**（5 条池也只打 3 条），不会一条链路跑穿整池 | 同上（`SYNC_ROTATE_MAX_PER_REQUEST`） | ✅ | `src/http.js:636-637`；`test/http-proxy-failover.test.js:376-407` |
| 5 | FW-2 | **按代理冷却**：被拒的那条进冷却（60s/5min/30min），下一次请求直接换其它条；健康表可分辨「Steam 403 / Steam 429 / 代理不可用」 | 后台 → 设置 →「网络与代理」健康表（`GET /api/admin/proxies` 的 `lastErrorKind`）；`data/proxy-health.json` | ✅ | `src/http.js:481-507`、`src/proxy-pool.js:194-215`、`:256`；`test/http-proxy-failover.test.js:410-437`、`test/proxy-pool.test.js:79-114` |
| 6 | FW-2 | **全池都被拒才写全局冷却**（403 从 5 分钟起 / 429 仍 30 分钟起），并抛**原错误码 403/429**（不包装 `PROXY_ALL_FAILED`，下游软退出可判） | 所有 Steam 同步任务；`data/steam-403.json` / `data/steam-429.json` | ✅ | `src/http.js:656-705`、`:736-738`；`test/http-proxy-failover.test.js:439-466` |
| 7 | FW-2 | **全站速率闸门 30 次/分钟**（Steam 硬上限 40 留 25% 余量；含代理重试，切 IP 不加预算）；等超 5 分钟中断本轮 | 所有 Steam 业务请求；`data/steam-rate.json` | ✅ | `src/rate-gate.js:133-177`、`src/http.js:397-401`、`:529-535`；`test/rate-gate.test.js:87-111`、`:228-263` |
| 8 | FW-2 | 后台新增 **5 个可回滚开关**（403 切代理 / 429 切代理 / 闸门次/分钟 / 每请求最多几条 / 闸门等待上限），默认值即新行为，全关可退回 AM-1 | 后台 → 高级 →「调度与熔断」折叠区 | ✅ | `src/settings.js:111-115`、`:462-483`；`test/settings.test.js:154-190` |
| 9 | FW-2 | 回滚开关实测有效：`SYNC_ROTATE_ON_403=0` 时不换代理、只写全局冷却（AM-1 行为） | 设置页 / env | ✅ | `src/http.js:634-641`；`test/http-proxy-failover.test.js:468-491` |
| 10 | FW-2 | 闸门只针对 **Steam 业务域真实请求**：杉果/GOG/Humble/ITAD、图片 CDN、probe 的 CONNECT 不扣 token | 全局出网层 | ✅ | `src/http.js:399`、`:529-535`；`test/rate-gate.test.js:265-282` |

## 逐条核对（规格验收 → 证据）

| # | 条目（[SLOW-SYNC.md](SLOW-SYNC.md) §8「FW-2」） | 检查手段 | 证据（文件:行 / 命令输出） | 判定 |
|---|---|---|---|---|
| 1 | 403 切代理：2 条池、第 1 条 403 → 同一逻辑请求用第 2 条成功；**断言两次请求的代理不同**；反例自检 | 读码 + 本地双代理真实转发链路（假代理直接回 403） | `src/http.js:630-653`（`isSteamReject` → `noteProxyFailure(kind='steam403')` → `shouldAdvance=true; continue`）；`test/http-proxy-failover.test.js:324-347` 断言 `attempts[0].proxy !== attempts[1].proxy`、目标只被打到 1 次、`http.proxy_switch.reason='steam403'`；实跑 `node test/http-proxy-failover.test.js` → 14/14 通过 | ✅ |
| 2 | 429 同样切代理（status 429） | 同上（假代理回 429 + `Retry-After: 120`） | `src/http.js:640-654`（`noteProxyFailure(kind='steam429', minCooldownMs=Retry-After)`）、`:671-694`（不能切时才写全局）；`test/http-proxy-failover.test.js:350-374` 断言两次代理不同、`proxy-health.json` 的 `lastErrorKind='steam429'`、`downUntil ≈ now+120s`（取 max(阶梯60s, Retry-After)）、**不写** `data/steam-429.json`；实跑通过 | ✅ |
| 3 | 5xx 不切（返 500 时仍用同一条代理） | 本地假目标回 500，池 2 条 | `src/http.js:708-728`（5xx 不进 403/429 分支、也不满足 `isProxyLayerFailure`，只走原重试逻辑）；`test/http-proxy-failover.test.js:237-256` 断言两次 `http.request.proxy` 相同、无 `http.proxy_switch`、无 `http.proxy_down`；实跑通过 | ✅ |
| 4 | 每请求最多 3 条：5 条池全 403 → 只发 3 次请求，随后抛 403 | 5 条假代理全回 403，`retries:0` | `src/http.js:636-637`（`triedProxies.length < rotateMax` 且 `untried.length > 0`）；`test/http-proxy-failover.test.js:376-407` 断言 3 次请求、3 条不同代理、第 4/5 条 `hits=0`、`http.proxy_all_rejected{status:403,count:3}`、全局 `steam-403.json` 的 `until` 在未来且 ≤5 分钟+5s；实跑通过 | ✅ |
| 5 | 按代理冷却：第 1 条 403 后 `proxy-health.json` 有 `downUntil` + `lastErrorKind='steam403'`；后续请求直接从第 2 条开始 | 先 403→成功，再发第 2 个请求；读真实落盘的健康文件 | `src/http.js:481-507`（`available = candidates 过滤未过期 downUntil`，全池不可用才读全局）；`test/http-proxy-failover.test.js:410-437` 断言第 2 请求只 1 次尝试且 `proxy=第2条`、第 1 条 `hits` 不再增长、健康文件含 `lastErrorKind/downUntil` 且不含代理地址；实跑通过 | ✅ |
| 6 | 全池 403 才写全局冷却；抛出的错误 `err.status===403`（不是 `PROXY_ALL_FAILED`） | 2 条假代理全 403，读全局冷却文件与抛出的错误对象 | `src/http.js:656-705`（全池从 5 分钟起 `steam403PoolBackoffMs`、`http.proxy_all_rejected`、`steamRejected=true; break`）、`:736-738`（`steamRejected` 时跳过 `PROXY_ALL_FAILED`）；`test/http-proxy-failover.test.js:439-466` 断言 `err.status===403`、`err.code!=='PROXY_ALL_FAILED'`、两条代理各自 `lastErrorKind='steam403'`+`downUntil`、全局 `until` 在未来；实跑通过 | ✅ |
| 7 | 速率闸门：容量 30；第 31 个 token 需等待；`tokens` 随时间回升；代理重试也扣（切 3 条=扣 3 个）；等待超 `SYNC_RATE_MAX_WAIT_MS` → `COOLDOWN_ABORT` | 注入假时钟单测 + 本地 3 代理真实链路 | `src/rate-gate.js:54-88`（纯函数）、`:133-177`（读→补→扣→原子写→sleep≤2s→超限 `COOLDOWN_ABORT`）；`test/rate-gate.test.js:87-111`（前 30 个不等待、第 31 个 `sleeps=[2000]`、文件写回合法 JSON）、`:113-145`（旧文件按 10 分钟补满、缺失/坏 JSON 按满桶并记 `sync.rate_gate_reset`）、`:146-170`（`maxWaitMs=5000` 时 sleeps `[2000,2000]` 后抛 `COOLDOWN_ABORT`，`maxWaitMs=0` 不睡）、`:228-263`（3 条代理各被真实打到 1 次、token 30→27）、`:265-282`（非 Steam 主机 token 数量完全不变）；实跑 8/8 通过 | ✅ |
| 8 | 设置 5 项（任务书 §4）：默认值/env/范围/进「调度与熔断」折叠/可回滚 | 读 schema + 校验函数 | `src/settings.js:462-483`（`true/true/30/3/300000`，范围 1–40、1–10、0–3600000，env 名精确）、`:111-115`（section=schedule、tier=advanced）；`test/settings.test.js:154-190` 断言默认值/范围拒绝/非法 kind/`SETTING_MAP` 唯一/`d.help` 说明；实跑 20/20 通过 | ✅ |
| 9 | 代理健康：`noteProxyFailure(url, err, {kind})` 支持 `proxy/steam403/steam429` 写 `lastErrorKind`，`proxyHealth()` 输出且老字段不变（任务书 §3） | 单测 + 落盘重启读回 | `src/proxy-pool.js:24-28`（kind 白名单/归一化）、`:194-215`（写 `lastErrorKind`、`minCooldownMs` 取 max）、`:256`（视图输出）、`:229`（成功后清空）；`test/proxy-pool.test.js:79-114` 断言三种 kind/非法归一化/老字段仍在/429 `minCooldownMs` 生效/`flush + reset` 后仍读得到 `steam429`；实跑 9/9 通过 | ✅ |
| 10 | 纪律项（任务书红线）：不改共用文档、不加依赖、不改表结构/版本号、未打 tag、提交只含自己的文件 | `git show --stat` / `git tag --contains` / `git status` | `09c7036` 仅 11 个文件（`src/http.js`、`src/proxy-pool.js`、`src/settings.js`、新增 `src/rate-gate.js`、5 个测试/测试文件、`package.json` 一行、`.gitignore` 一行）；`git tag --contains HEAD` 为空、最新 tag 仍是 `v2.30.3`；`git diff 14305c7..HEAD` 无 compose/deploy/.env；`package.json` 只改了 `test:1` 一行（新增 `node test/rate-gate.test.js`） | ✅ |

## 通用验收（规格 §8「通用」+ 任务书验证命令）

| 项 | 命令 | 结果 |
|---|---|---|
| 主链 test:1（改动直接相关段） | 逐文件 `node test/*.test.js`（等价 `npm run test:1` 串行） | **30/31 通过**；唯一未通过的是 `test/steam-accounts.test.js`：本机探测 Steam 12 秒超时（无出口），该用例内部真实外网调用挂起 → **环境限制，非本批改动**；该文件不在任务书验证清单内，CI 有出口会跑 |
| http / proxy / 闸门相关 | `node test/http-proxy-failover.test.js`、`node test/proxy-pool.test.js`、`node test/rate-gate.test.js`、`node test/http-error.test.js` | 14/14、9/9、8/8、10/10 全绿 |
| 调度 / 设置 | `node test/scheduler.test.js`、`node test/settings.test.js` | 48/48、20/20 全绿 |
| 403/429 冷却既有语义（FP 批回归） | `node test/sync-harden.test.js` | 22/22 全绿（`COOLDOWN_ABORT` / `FORBIDDEN_COOLDOWN` / 403 连续计数未被改坏） |
| 前端 | `node node_modules/vite/bin/vite.js build --config frontend/vite.config.js` | `✓ built in 1.52s` |
| 凭据 | `node scripts/scan-secrets.js` | `扫描 873 个文件` → 两条 ✅ 无凭据 |

## 反例自检（开发侧留存，QA 复核结论）

- 任务书要求：把 `nextCandidate` 临时改成「永远返回第一条」，403 切代理测试必须变红。
- **实测**：该变异下 `test/http-proxy-failover.test.js` **仍 14/14 绿**。原因不是断言假绿，而是本批按规格实现了「按代理冷却」预过滤：
  `src/http.js:483` 先 `available = poolCandidates.filter(!downUntil)`，第 1 条 403 后已进冷却、**根本不在传给 `nextCandidate` 的候选里**，
  所以「恒返第一条」拿到的仍然是第 2 条——这个变异在本设计下语义等价，无法区分。
- 为证明「两次请求代理不同」不是假绿，另做**等价且能区分**的变异：`src/http.js:650-652` 把 `shouldAdvance=true` 改成 `false`（403 后同一出口重试，
  即旧实现 `route` 在循环外算一次的形态）→ **5 条 FW-2 用例变红**（验收 1 / 2 / 4 /「验收 5/6」合并用例 / 6），回滚与 5xx 用例保持绿。恢复后 14/14 复绿，文件哈希与变异前一致。
- 闸门侧反例：把 `takeToken` 改成「每个逻辑请求只扣一次」（`attempt===1`）→ `test/rate-gate.test.js` 的「代理重试扣 token」用例变红（30→29 而非 27），恢复后 8/8 复绿。

## 打回清单（按严重度排序）

无。

## 需人工确认

1. **部署前提：代理池 ≥2 条固定 IP 且不同 IP 段**（规格 §9 / §10-4）。池只有 1 条时本批全部开关都不生效（代码走 AM-1 单代理逻辑），
   需部署侧确认线上 `network.steamProxy` 条数与 IP 段。
2. **`data/` 是否持久卷**（`data/steam-rate.json`、`data/proxy-health.json`、`data/steam-403.json`）。容器重建若丢失 `data/`，
   冷却与 token 桶会从满桶/空健康状态重来（规格 §10-2）。
3. **闸门 30 次/分钟对吞吐的影响**需上线后按 `sync_runs` 实测（规格 §6.5：想跑 57,000~85,000/天 vs 上限 43,200/天）。
   本批只保证「不超 30/分钟」，不承诺全量周期不变。
4. **本机无 Steam 出口**：403/429 全部用本地假代理 + 假目标验证（真实 undici ProxyAgent 转发链），未做真实 Steam 风控抓取；
   线上首次 403 建议观察 `http.proxy_switch` / `http.proxy_all_rejected` 日志与健康表。

## 争议项记录

- 无需求争议。反例自检口径差异已按上文「反例自检」如实记录：字面变异在本设计下不可区分，已用能区分的等价变异证明断言有效。

## 复检记录

- 第 1 轮（2026-11-26）：基线 `14305c7` → HEAD `09c7036`，7 条验收逐条取证，扩展测试 14/9/8/10 全绿 + `sync-harden` 回归 22/22 + `scheduler` 48/48 + `settings` 20/20 + 前端构建/凭据扫描通过 → ✅ 放行（通过 7 / 缺失 0 / 偏差 0 / 需人工确认 4）。
