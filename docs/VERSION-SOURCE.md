# 版本检测：按服务器网络位置选择镜像仓库（已确认待开发）

> 状态：**已实现并发布 v1.18.0（2026-11-06）**：允许第三方 IP 归属接口，**采用 `ipinfo.io`**（`ip-api.com` 实测不可用）。
> 同日补实测：TCR 匿名列 tag 要先取 token、两个仓库的 tag 都**没有 `v` 前缀**、Docker Hub 在大陆**超时**——
> 见 §6.1，§3 的实现细节已按实测改写。
> 关联：[DEPLOY.md](DEPLOY.md)（镜像与仓库）、[DOCKER-HUB.md](DOCKER-HUB.md)（TCR 与 Hub 双源）、[TODO.md](TODO.md) 的 AE 条目。

## 1. 现状与问题

后台右上角徽标（`v1.16.2 ↑ 新版 v1.16.4 可用`）来自 [src/version.js](../src/version.js)：

```
checkLatest() → https://api.github.com/repos/yyliucha/steamdeals/releases/latest
             → 失败则 /tags?per_page=100，取最大语义化版本
缓存 6 小时；/api/admin/version?force=1 可强刷
```

问题：

1. **大陆服务器访问 `api.github.com` 不稳定**（超时/限流），徽标经常是"检查失败"或停在旧版本；
2. 徽标说"有新版"，但用户实际是从 **TCR 或 Docker Hub** 拉的镜像，两者发布节奏可能不同步（CI 双跑，但单边失败时只有一个仓库有新 tag）；
3. 部署在哪个源上、该看哪个源，现在靠人记。

已有两个仓库（都已在 CI 推送）：

| 源 | 镜像 | 说明 |
|---|---|---|
| 腾讯云 TCR | `ccr.ccs.tencentyun.com/tcb-100003189690-pljp/steamdeals` | 公开仓库、个人版、仅 amd64 |
| Docker Hub | `s1065420329/steamdeals` | amd64 + arm64 |

## 2. 目标

后台版本徽标按**服务器所在网络位置**自动选择可信仓库取"最新版本"，**不做成设置项**，全部由代码判定：

- 大陆 / 香港 IP → **优先 TCR**；
- 其他地区 IP → **优先 Docker Hub**；
- 首选源失败 → 回退另一个；两个都失败 → 回退 GitHub（保留现有能力）；
- 结果里带"来源"，便于排查（前端可不显示）。

## 3. 方案

### A. 区域判定（`src/version.js` 内新增，懒加载 + 缓存 24h）

```
detectRegion():
  1) GET https://ipinfo.io/json  （2s 超时；免费、无 key；返回 country = ISO 3166-1 alpha-2）
     → country ∈ {CN, HK} → 'cn'；其他 → 'global'
  2) 失败/超时 → 'unknown'（交给连通性探测决定顺序）
```

- 只用**免费、无 key** 的接口；结果缓存 24 小时，失败也缓存 10 分钟（避免每次刷新都打）；
- 日志：`update.geo_ok {country}` / `update.geo_failed`。

> **实测（2026-11-06，结论：已确认用 ipinfo.io）**：`ip-api.com` 免费版**不支持 HTTPS**（403），
> HTTP 又被网络丢弃（超时）→ 原 URL 不可用；`https://ipinfo.io/json` 实测 200。接口要可替换、失败可降级。

### B. 从仓库取最新 tag（`checkRegistryLatest()`）

| 源 | 接口 | 认证 |
|---|---|---|
| Docker Hub | `GET https://auth.docker.io/token?service=registry.docker.io&scope=repository:s1065420329/steamdeals:pull`，再 `GET https://registry-1.docker.io/v2/s1065420329/steamdeals/tags/list` | 匿名 token（标准流程） |
| TCR | 先 `GET https://ccr.ccs.tencentyun.com/service/token?service=token-service&scope=repository:tcb-100003189690-pljp/steamdeals:pull`，再 `GET https://ccr.ccs.tencentyun.com/v2/tcb-100003189690-pljp/steamdeals/tags/list` | **匿名 bearer token**（实测可签发，`expires_in=7200`）；401 只是标准 challenge，**不是"不可用"** |

- 过滤 `^\d+\.\d+\.\d+$`（两个仓库的 tag 都是 `X.Y.Z`、**无 `v` 前缀**；排除 `latest`、`1.16` 这类两段版本、`sha-*`），取最大；
- 超时 4 秒、`retries: 0`（徽标不等人）；
- 日志：`update.registry_ok {source, latest}` / `update.registry_failed {source, status}`。

### C. 选择顺序（代码硬编码，无开关）

```
region = await detectRegion()
order = region === 'cn' ? ['tcr', 'hub'] : ['hub', 'tcr']
for (source of order) if (await checkRegistryLatest(source)) return { latest, source }
// 都失败
return await checkLatestGitHub()   // 现有实现
```

- `region === 'unknown'` 时按 `['hub', 'tcr']`，但两个都探测（不短路），取**先成功**的；
- 结果对象增加 `source`（`'tcr' | 'hub' | 'github'`）与 `region`；
- 缓存策略：成功的 registry 结果缓存 6 小时（沿用）；全失败时缓存 10 分钟，避免前端每次刷新都重打。

### D. 接口与前端

`GET /api/admin/version`（管理员，前端 `Console.vue:73` 调用）返回增加 `source` / `region` 两个字段（向后兼容，不加不删）。
前端 `Console.vue` **本批不改**（徽标文案保持），来源只进日志；若后续需要在徽标上标注，再单独提。

## 4. 影响面

| 文件 | 改动 |
|---|---|
| `src/version.js` | 新增 `detectRegion()`、`checkRegistryLatest()`、`pickSourceOrder()`；`versionInfo()` 串联；缓存与日志 |
| `src/server.js` | `/api/admin/version` 透传 `source`/`region`（字段可选） |
| `test/version.test.js` | 新增：CN→先 TCR、global→先 Hub、TCR 401→取 token→成功、token 也失败→回退、两者失败→GitHub、tags 过滤（无 v 前缀）与取最大、缓存不重复请求 |
| `docs/DEPLOY.md` / `DOCKER-HUB.md` | 补一句"徽标按 IP 选源"的说明 |

## 5. 验收

1. 模拟 `countryCode=CN`：只请求 TCR，返回 `X.Y.Z`（无 `v` 前缀）最大值，`source='tcr'`；
2. 模拟 `countryCode=US`：只请求 Docker Hub，`source='hub'`；
3. 模拟 TCR 首次 401：**先取匿名 token 再重试并成功**（不允许把 401 直接判失败）；token 服务也失败时才回退 Docker Hub，日志有 `update.registry_failed`；
4. 模拟两者都超时：回退 GitHub，徽标行为与现在一致（不回归）；
5. 模拟 geo 接口超时：不阻塞，按"两个都探、先成功者"返回；
6. 缓存生效：6 小时内连续调用 `/api/admin/version` 只打一次仓库接口（用桩计数断言）；
7. `npm test` 全绿（`test/version.test.js` 覆盖第 1–6 条）、`npm run scan`。

## 6. 风险与决策

| # | 事项 | 影响 | 处理 |
|---|---|---|---|
| 1 | TCR 匿名 `tags/list` 的认证方式（**2026-11-06 已实测，见 #5**） | 不是"匿名直列"：无 token 必 401 | 按 Bearer token 流程实现；**不要**把 401 当成"该仓库不可用" |
| 2 | 引入第三方 IP 归属接口（**已确认用 `ipinfo.io`**） | 多一个外部依赖；接口挂了要能降级 | 2s 超时即降级为"双探"，24h 缓存；不写死单一接口，预留备选 |
| 3 | GitHub 兜底是否保留 | 保留可避免双源同时故障时徽标彻底失效 | **保留**（本方案默认） |
| 4 | **两个仓库的 tag 都无 `v` 前缀**（实测） | 原过滤 `^v\d+\.\d+\.\d+$` 一个都匹配不到 → 徽标永远显示"无更新"，比现在更糟 | 过滤改 `^\d+\.\d+\.\d+$`；CI 见 [docker-tcr.yml](../.github/workflows/docker-tcr.yml)（推送前去掉 `v`）与 [docker-hub.yml](../.github/workflows/docker-hub.yml)（semver pattern 本身不带 `v`） |
| 5 | **TCR 首次请求必 401**（带 Bearer challenge），且 Docker Hub 在大陆不可达 | "401 即回退 Hub" = 大陆服务器永远落到一个连不上的仓库 → 徽标彻底失效 | TCR 与 Hub 一样走 token 流程（实测匿名 token 可签发，之后列 tag 200）；401 本身不算失败 |

### 6.1 实测证据（2026-11-06，开发机大陆网络；服务器同在腾讯云大陆）

| 探测 | 结果 | 结论 |
|---|---|---|
| `GET https://api.github.com/repos/yyliucha/steamdeals/releases/latest` | HTTP 403，body：`API rate limit exceeded for 103.211.230.40` | 未认证 60 次/时的额度在共享出口 IP 上必然撞到——这就是徽标"检查失败 / 停在旧版"的直接原因 |
| `GET https://registry-1.docker.io/v2/` | 6s / 12s 两次均超时 | 大陆到 Docker Hub 不可达；"Hub 优先 / 回退 Hub"在大陆没有意义（只会白等超时） |
| `GET https://ccr.ccs.tencentyun.com/v2/<ns>/steamdeals/tags/list`（无 token） | 401 + `WWW-Authenticate: Bearer realm="…/service/token"` | 需要 token 流程，不是"匿名直列" |
| 同上，先取 `…/service/token?service=token-service&scope=repository:…:pull` | 200，token 1122 字符，`expires_in=7200`；再用它列 tag → 200 | 匿名 token 可用；返回的 `tags` 为 `1.5.0 … 1.16.4`、`latest`、`sha-*`——**无 `v` 前缀** |
| `GET https://ip-api.com/json/?fields=…` | HTTPS 403（免费版不支持 SSL），HTTP 超时 | 规格 §3-A 的原 URL 不可用 |
| `GET https://ipinfo.io/json` | 200 | 可作为备选归属接口（仍需 2s 超时 + 缓存 + 可降级） |

> 说明：以上是**网络与接口事实**，不是方案变更；§3 的两处实现细节（tag 正则、TCR token 流程）已按实测改写。

**已确认（2026-11-06）**：**允许**调用第三方 IP 归属接口，**采用 `ipinfo.io`**（`ip-api.com` 实测不可用）；
接口按"可降级、可替换"实现——2s 超时即降级为"双探"，结果缓存 24h，失败缓存 10 分钟。
不采用纯连通性探测方案（香港 IP 可能两个 registry 都很快，判定不如地理准确）。
