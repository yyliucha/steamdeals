# 开发到交付全流程（会话交接文档）

> 本文是**新会话的接线手册**：接手项目先读这里，再读 [PROJECT-OVERVIEW.md](PROJECT-OVERVIEW.md)（架构与代码落点）、
> [TODO.md](TODO.md)（所有未完成事项总览）和 [ROADMAP.md](ROADMAP.md)（决策与待办）。
> 已知 UI 缺陷与修法见 [UI-FIXES.md](UI-FIXES.md)。发版前必读「对外描述同步」规则。
>
> **会话分工**：讨论方案用 DeepSeek-V4.1-Flash1017，开发实现用 DeepSeek-V4-Pro（见 CONTRIBUTING.md）。
>
> **最后更新：2026-11-09（v2.1.0 已发布：AM-2/AN/AK×3/AL/AC-2~4 九批；服务器升级待部署人员执行）。若你读到的时间晚于最近提交，先看 CHANGELOG 与 git log。**

---

## 0. 一分钟看懂项目

- 仓库：`github.com/yyliucha/steamdeals`，主分支 `main`，本地 `F:\dsh\gameprice`（Windows）。
- 技术栈：Node ≥22.5（ESM）+ PostgreSQL 15 + Vue 3/Vite/Element Plus（`frontend/`，产物 `frontend/dist` 不入库）+ Docker Compose。
- 线上：生产库 19.6 万条目（有国区报价 10.6 万）；TCR 镜像 `ccr.ccs.tencentyun.com/tcb-100003189690-pljp/steamdeals:<版本>`，Docker Hub `s1065420329/steamdeals:<版本>`。
- 版本历史：… 1.1.0 → 1.2.0 → 1.3.0 → 1.4.0 → 1.4.1 → 1.4.2 → 1.4.3 → 1.4.4 → … → 1.4.9 → 1.5.0 → 1.6.0 → 1.7.0（详见 CHANGELOG）。

## 1. 开发环境与日常开发

```bash
cd F:\dsh\gameprice
npm install                    # 依赖（vite/element-plus 在 devDependencies）
node src/cli.js serve --port 8090   # 全栈服务；无 DATABASE_URL 时用嵌入式 PG（pglite:./data/pgdata）
npm run frontend:dev           # 另开终端：Vite 5174，/api 代理到 8090，改前端即热更
```

- 本地数据库是 `pglite:./data/pgdata`（wasm PG，仅开发验证；生产是 118.25.114.250 的 PostgreSQL）。
- 本机**无 Docker、无 Steam 出口**：采集/回填类命令本地会网络失败（预期），线上才真正验证。
- 前端页面全在 `frontend/src/pages/`；路由 `frontend/src/router/index.js`；全局样式与主题 token 在 `frontend/src/styles/main.css`（亮暗色通过 `html.dark` + CSS 变量切换，`composables/useTheme.js`）。

## 2. 改动前必须知道的规则

1. **先读 `docs/PROJECT-OVERVIEW.md` 的「后续开发的必做收尾」**：改完功能要同步总览/专项文档/README，不允许"代码新、文档旧"。
2. **发布必做「对外描述同步」**：每次打 tag 发版，按发布时点的真实功能更新 README（功能表/命令参考/环境变量/已知限制）、`docs/` 各文档、CHANGELOG，以及 **GitHub 仓库 About/description 与 topics**（`gh repo edit yyliucha/steamdeals --description "..."`）。
3. **任何改动都要有可执行的验证**：`npm test` 全绿 + 相关链外测试 + 前端改动跑 `npm run frontend:build`。改动 `web/*.html` 还要跑 `node scripts/check-html-syntax.mjs web/index.html web/console.html web/setup.html`。
4. **写日志**：新增采集/后台逻辑用 `域.动作` 事件名，失败路径带原因。
5. **测试分两链**：主链 `npm test`（44 个文件）；链外 `test/email-auth.test.js`、`test/api.test.js`、`test/cli-dispatch.test.js` 改相关代码时单独跑。
6. 凭据扫描 `npm run scan`（公开仓库前自检）。
7. **README 没有进度摘要**（2026-11-12 起）：进度只看 [docs/TODO.md](TODO.md)（README 只保留一条链接），
   不再有 `todo:progress` 脚本与 `docs-progress` CI（原因见 [TODO-PROGRESS.md](TODO-PROGRESS.md) §0）。

## 3. 提交与发版（构建镜像）完整步骤

> **构建由人工下令触发（硬规则 5）。** 打 tag 并 push 会立即触发 CI 构建并推送镜像，
> **只有收到项目所有者明确的"构建 vX.Y.Z"指令后才能执行**；日常改动只提交并推送 `main`
> （推 main 不会触发构建），tag 与构建时机由人决定。代码就绪后把"待发版"状态写进本文末尾的
> 「当前状态」，等人下令。

**构建镜像 = 打 annotated tag 并 push。** 推 tag 自动触发两个 GitHub Actions workflow，不需要手工跑 docker。

```bash
cd F:\dsh\gameprice
# ① 验证
npm test && npm run frontend:build && npm run scan
node test/api.test.js          # 若动过 API/权限/标记

# ② 文档同步（对外描述同步规则）
#    - CHANGELOG.md 顶部加新版本条目（## [X.Y.Z] - 日期，Keep a Changelog 格式）
#    - README/docs 里过时的描述一并更新

# ③ 版本号（改 package.json + package-lock.json，不自动打 tag）
npm version <X.Y.Z> --no-git-tag-version

# ④ 提交并推送 main
git add -A
git commit -m "feat(范围): 摘要"
git push origin main

# ⑤ 打 annotated tag 并推送（= 触发构建；**必须先收到"构建 vX.Y.Z"的人工指令**）
git tag -a vX.Y.Z -m "SteamDeals X.Y.Z：<一句话摘要>"
git push origin vX.Y.Z

# ⑥ 盯 CI（gh 先切到有 workflow 权限的账号）
gh auth switch --user yyliucha
gh run list --limit 2
```

### 版本号规则

- **X.0.0**：大版本（如全面换前端 = 1.0.0）。
- **X.Y.0**：新功能 / 用户可见行为变化。
- **X.Y.Z**：纯修 bug / 参数修正（如 1.4.1、1.4.2 都是热修复）。
- tag 命名固定 `v` 前缀；每次发版**恰好一个 tag**，改完再发就是下一个 patch/minor。

### CI 会发生什么（对方最关心）

- 两个 workflow 都先跑 `npm ci + npm test + 前端在 Docker 多阶段里 vite build`（`frontend/dist` 不入库，镜像内构建）。
- `docker-hub`：test + **smoke job**（真实构建镜像 → 起容器连外部 PG → 走 `/api/setup/complete` 完成初始化）→ 推送 amd64+arm64 到 Docker Hub。
- `docker-tcr`：test → 推送 linux/amd64 到腾讯云 TCR（`latest` / `<版本>` / `sha-<commit>` 三个 tag）→ `Verify manifests` 确认镜像真实存在。
- 耗时：docker-hub 约 5–7 分钟；docker-tcr 约 8–25 分钟（跨境推送波动）。
- **判断成功**：`gh run view <run-id> --json jobs` 看 publish job 的 `Run docker/build-push-action@v6` 和 `Verify manifests` 都是 success。查完 `gh auth switch --user boxiang-sun_shortcut` 切回默认账号。

## 4. 部署到服务器

> **服务器操作边界（硬规则 4，见 CONTRIBUTING.md）**：服务器更新由**具备服务器权限的部署人员**执行；
> 仓库与开发侧不保存服务器凭据、不直接操作服务器。开发侧职责到「提交 + 打 tag」为止。
> 通用流程（Hub/TCR 两种源的 pull/up、验证、回滚）见
> [DEPLOY.md 的「发布与升级流程」](DEPLOY.md#发布与升级流程从提交到上线)，本节是**这台生产服务器**的具体执行版。

> 服务器：`ubuntu@VM-0-6-ubuntu`（118.25.114.250），项目目录 `/home/ubuntu/steamdeals`。
> **compose 文件已确认（2026-11-09）：`/home/ubuntu/steamdeals/docker-compose.yml`**（docker inspect 标签取证）。

用真实文件名替换 tag 并部署（TCR 的可用 tag：`latest`、`sha-<完整40位提交号>`、`<git tag 版本号>`——
以 CI 实际推送为准，先 `docker manifest inspect ccr.ccs.tencentyun.com/tcb-100003189690-pljp/steamdeals:<tag>` 确认存在）：

```bash
cd /home/ubuntu/steamdeals
docker compose config --images   # 看当前实际用的镜像 tag
sed -i 's#tcb-100003189690-pljp/steamdeals:[^" ]*#tcb-100003189690-pljp/steamdeals:sha-<完整40位提交号>#' docker-compose.yml
docker compose pull app && docker compose up -d app
docker exec steamdeals node -p "require('./package.json').version"   # 期望输出新版本
```

回滚：把 tag 换回上一个已部署版本（如 1.4.0）再 pull/up。

### 部署后验证清单

1. `GET /` 是新 Vue 首页；目录大数字（约 19.7 万）+「其中有报价 N」。
2. 后台 `/console`：侧栏版本号、热度回填卡片、中文 locale（无 Total/Go to/Select）。
3. 封禁页 `/banned` 与申诉页 `/appeal` 可打开且带样式。
4. 日志：`docker logs --tail 100 steamdeals` 无 error 刷屏。

## 5. 数据任务与自动化（哪些命令不用手工跑）

调度器（容器内 `RUN_MODE=all` 会随 app 常驻）**自动**执行：

| 任务 | 频率 | 说明 |
|---|---|---|
| `sync steam-prices` | 每天 | 刷新已有 Steam 报价（`STEAM_PRICE_INTERVAL_MIN`） |
| `sync catalog` | 每周 | Steam 全量目录同步（幂等），**新游戏自动进库**；需 `STEAM_API_KEY`，没配则该任务不出现 |
| `backfill` 增量回填 | 每周 | 给新游戏补元数据/说明/价格；有说明+报价的自动跳过，没活秒退（`STEAM_BACKFILL_LIMIT` 默认 20000） |
| `heat` 热度回填 | **每天**（v1.4.3 起） | 首轮自动全量播种（每天 2 万款 ≈ 9.4h，19.6 万款约 10 天播完）；之后只刷"过期 7 天且有报价"的条目 |
| `steam-status` 状态判定 | **每天**（X 批：原每周） | 逐 appid 全量 appdetails 判定同步状态 + 内容分级（`steam_checked_at` 续跑游标，失败不推游标）；每轮 **12000** 条 ≈ 5 小时，约两周补完 17.5 万条；归入 Steam 重任务槽，与价格/热度/回填互斥串行（X 批：原每轮 8000、首轮延迟 6 小时） |
| `rename` 名字重写 | 每周 | 机器英文名补中文（英文挪进 name_en）；选择条件自带收敛，没活秒退 |
| `steam-accounts` | 每天 | 所有已绑定 Steam 账号的库 + 愿望单同步（差集删除、愿望单→自动提醒）；需 `STEAM_API_KEY`，账号间串行 ≥1s，单账号失败隔离 |
| `steam-claim`（可选） | 每天 | 仅在 compose 配置 `STEAM_CLAIM_USERNAME` + `STEAM_CLAIM_STEAM_ID` 时出现：把历史未归属账号认领给该用户（幂等，认领后可删配置） |
| `prune` 定期清理 | 每周 | 访问记录 180 天 / 采集与任务 90 天 / 验证码 7 天 |
| `images pull` / `backup` / `alerts` | 定时 | 封面缓存 / 每日备份 / 到价提醒 |

Steam 重任务（价格/目录/回填/热度/改名/状态判定）与后台手动任务**互斥**，不会并行抢限流；
调度器主循环不再被重任务阻塞（X 批），价格刷新跑 90 分钟期间杉果/GOG/提醒等轻任务照常执行。
`rename` / `backfill` 成功后自动重建静态页。

**仍需手工**：`/setup` 首次初始化（一次性）、`diagnose`、`proxy-check`（排查工具，出问题才用）。
**不要再手工执行** `rename` / `heat` / `backfill` / `sync catalog` / `steam-accounts`——调度器会自动跑（早期运维习惯中的手工
`docker exec … heat --limit 200000` 等命令已被 v1.4.3 的调度任务取代）。
急用时可在控制台「游戏管理 → 同步与回填 → 重写名字」立即触发（v1.4.5 起，带进度显示），
不需要登服务器敲 CLI。绑定账号的库/愿望单同步也可以在后台「Steam 账号」页手动触发。

## 6. 排障速查（历次踩坑汇总）

- **容器里没有 curl**：用 `docker exec steamdeals node --input-type=module -e '...'` + `/app/src/http.js` 的 `fetchText`（自动走 `STEAM_PROXY`）。
- **bash 双引号里的 `!` 会历史展开**（`!String: event not found`）：脚本外层用单引号。
- **Steam appdetails 批量规则（2026-10-30 实测）**：`appids` 多于 1 个时**只接受 `filters=price_overview`**；无 filters 或 `filters=recommendations` 都 400；单 appid 才支持 recommendations（69 字节）。热度因此逐 appid 请求。
- **Steam 配额**：200 次/5 分钟；价格回填跑起来就是 ~176 次/5 分钟，别再并行开热度/探测。
- **代理并发满**表现为 `UND_ERR_CONNECT_TIMEOUT`（不是批量问题）；`node src/cli.js proxy-check` 看 TCP/CONNECT/实际请求三段。
- **429**：后台回填/热度 `STEAM_429_RETRIES=Infinity`，冷却 30 分钟→1 小时→2 小时→…→6 小时自动重试；日志 `http.rate_limit_pause` 表示在等待，不是卡死。
- **搜索性能基准**：`like '%kw%'` count 在生产 EXPLAIN 是 114.87ms（并行全表扫）；暂不上 pg_trgm，超 150ms 再上。
- **Steam 登录"Steam 校验失败"（2026-11-02 定位）**：应用服务器（腾讯云大陆 106.54.217.8）经香港 tinyproxy
  （43.129.196.229:8521）访问 `steamcommunity.com` 时，**明文 `CONNECT steamcommunity.com:443` 被大陆→香港链路
  的 DPI 重置**（tinyproxy 日志：上游 Established、客户端 fd read 被 reset；store 的 CONNECT 放行）。
  修法：香港代理机用 **stunnel 给 tinyproxy 加 TLS 壳**（8531 → 127.0.0.1:8521，自签证书），安全组放行 8531；
  应用侧 v1.4.8 起支持 https 代理（自签放行），「系统设置 → 网络 → Steam 专用代理」填
  `https://steambot1:12345@43.129.196.229:8531`。验证：`curl -k --proxy-insecure -x https://…:8531` 能拿到
  `ns:http://specs.openid.net/auth/2.0` 即通。
- **生产库**：`docker exec -i steamdeals sh -c 'cat > /tmp/count.mjs' <<'EOF' … EOF` 方式传入脚本（见 ROADMAP 探测记录）；数据库只读诊断先跑 `node src/cli.js stats`。

## 7. 会话交接模板（每个会话结束时填）

复制本节填好，作为下个会话的开场白：

```
【项目状态】版本 <X.Y.Z>，HEAD <短哈希>，工作区是否干净；最新 tag 与已构建镜像列表
【本次做了什么】按提交/文件列出，标注"已发布 / 已提交未发布 / 未提交 WIP"
【线上状态】服务器部署版本、数据任务是否在跑（heat/backfill）、已知异常
【待办】下一批要做的 + 依赖的前提（如需要生产数据/用户拍板）
【踩坑】本次新发现的坑（补充进本文第 6 节）
【验证】跑过哪些测试/命令与结果
```

---

### 当前状态（2026-11-13 更新，v2.11.1 已发布：BL 回填吞吐治理）

> 未完成事项的完整清单见 [TODO.md](TODO.md)。本节只记录版本与部署现状。

- **v2.11.1 已发布**（tag `v2.11.1`）：BL 批增量回填吞吐与配额治理——候选排除四态（free/coming_soon/
  region_locked/not_found，no_price 保留）；节奏每周 5 万 → **每天 5000**；403/429 **软退出**（exit 75 =
  partial、进度保留、1 小时重排、连续 3 次放弃等日轮、failures 不增不熔断）；首次 429 即落盘全局冷却
  （含 at/label）；同一 appid 连续 3 次拿不到元数据跳过 30 天（成功清零）；指标卡「待回填/已排除/跳过中」
  与任务卡「部分完成/429 次数/重试时间」；`data/backfill-progress.json` 进度文件并入 `/api/admin/sync/status`。
  验证：`npm test` 全绿（含新增 `backfill-throughput` 5 项）、`api.test` 22/22、`frontend:build`、`scan` 干净；
  质检：BL ✅ 放行（[QA-BACKFILL-THROUGHPUT-BL.md](QA-BACKFILL-THROUGHPUT-BL.md)，通过 9 / 需人工确认 2）。
  CI：docker-hub run 43370924706（test / smoke / publish 全绿，10m52s）；docker-tcr 首次 run 43370924717
  因 **postgres 镜像 mirror** 步骤卡住（1h36m，应用镜像 build-push 11m39s 已成功）已取消 →
  仓库修 workflow（`postgres:15-alpine` 已在 TCR 即跳过，2026-11-13）后用 **workflow_dispatch 补跑**
  run 43381858099（test / publish 全绿；postgres 步骤 2s 跳过，`Verify manifests` ✓），两源镜像均已备齐。
  补跑细节：workflow_dispatch 的版本号回退 `package.json` = **2.11.1**，TCR 推 `latest` + `2.11.1` 两个 tag。
  **服务器部署待执行**（升级到 `2.11.1`）；部署后重点：
  ① 按 [BACKFILL-THROUGHPUT.md](BACKFILL-THROUGHPUT.md) §4.10 只读复核（候选数/四态数、进度文件 done/limit、
  24h 内每日一轮、429 次数对比上一周）；
  ② 首次启动会在 `games`（19.6 万行）上建 `idx_games_backfill_skip` 部分索引（一次性耗时，建议低峰窗口）；
  ③ 真实 429 触发一次确认「部分完成 + 1 小时重排」链路。
- **v2.11.0 已发布**（tag `v2.11.0`）：BK 批会话治理——后台「账号与服务 → 登录会话」列表与踢下线
  （单条/批量/按用户，响应绝不返回 token）；会话空闲 7 天失效（可配 0=关闭）+ IP 网段（IPv4 /24、IPv6 /64）
  与浏览器家族+主版本绑定（开关可关，老会话不误踢）；单条禁用立即踢会话、会话计数只算未过期、
  过期会话并入 prune；前台改密页「退出其它所有设备」。
  验证：`npm test` 78 个文件全绿、`frontend:build`、`scan` 干净；
  质检：BK ✅ 放行（[QA-SESSION-BK.md](QA-SESSION-BK.md)，3 项转部署后验收）。
  CI：`docker-hub` run 43185124260（test/smoke/publish 全绿）、`docker-tcr` run 43185124244
  （test 6m32s + publish 30m41s——今日出网偏慢但成功，`Verify manifests` ✓），两个镜像源均已推送。
  **服务器部署待执行**（升级到 `2.11.0`）；部署后重点：
  ① 后台会话列表与踢下线目视（筛选/分页/当前会话标记/批量）；
  ② 生产 `session.*` 审计事件字段；
  ③ 空闲 7 天与 IP/UA 绑定实际体验——如掉线率高，按 [SESSION-MANAGEMENT.md](SESSION-MANAGEMENT.md) §7 调比较粒度或开关。
- **v2.10.2 已发布**（tag `v2.10.2`）：BJ 批——拦截链黑名单前置（黑名单 IP 一律立即 403，不再计数/
  不写 `ip_abuse`/不写待审核，采样拦截日志保留）；自动封禁记录默认只列生效中 + 状态列 +「已在黑名单」
  标注（CIDR）；解封语义拆分（自动封禁只清 `ip_abuse`、黑名单只删 `ip_blacklist`，批量同口径）；写黑名单
  时清该 IP 临时封禁字段（行保留）+ 迁移幂等存量清理；自动封禁记录 prune 保留 90 天。
  验证：`npm test` 77 个文件全绿、`frontend:build`、`scan` 干净；
  质检：BJ ✅ 放行（[QA-BAN-BJ.md](QA-BAN-BJ.md)，3 项转部署后验收）。
  CI：`docker-hub` run 42975522492（test/smoke/publish 全绿）、`docker-tcr` run 42975522471
  （test 7m56s + publish 7m11s，`Verify manifests` success），两个镜像源均已推送。
  **服务器部署待执行**（升级到 `2.10.2`）；部署后按规格 §10.7 三条只读 SQL 复核
  （黑名单 IP 的 `ip_abuse.updated_at` 24 小时不变、「生效中」为空、存量被覆盖行 `banned_until` 已清）。
- **v2.10.1 已发布**（tag `v2.10.1`）：AY 搜索性能修复（关键词 trigram 候选收敛 + 零命中快返 + `games_heat_live`
  部分索引 + count 60s 合并缓存）；BF 数据库遗留对象清理（删 steam_sessions / users.steam_id / offers.risk_level /
  user_wishlist.steam_ids 的 DDL 与读写，保留 api_key_enc 等）；BG 站点通知页未编辑误报未保存修复。
  验证：`npm test` 全绿、`api.test` 22/22、`frontend:build`、`scan` 干净、`todo:progress:check` 一致；
  质检：AY ✅（[QA-SEARCH-PERF-AY.md](QA-SEARCH-PERF-AY.md)）、BF/BG ✅（[QA-BF-BG-2026-11-11.md](QA-BF-BG-2026-11-11.md)）。
  CI：docker-hub [#42964296670](https://github.com/yyliucha/steamdeals/actions/runs/42964296670)（test/smoke/publish 全绿）、
  docker-tcr [#42964296570](https://github.com/yyliucha/steamdeals/actions/runs/42964296570)（test/publish 全绿）（2026-11-11）。
  **服务器部署待执行**（升级到 `2.10.1`）；部署后重点：
  ① AY——按 [READ-MODEL.md](READ-MODEL.md) §12 的 6 条 `EXPLAIN (ANALYZE, BUFFERS)` 与 §9 三项门槛复测；
  ② BF——部署人员按 [DB-LEGACY-CLEANUP.md](DB-LEGACY-CLEANUP.md) §3 先只读核对再执行清理 SQL；
  ③ BG——站点通知页目视：打开不弹未保存、抽屉编辑后守卫照常。
- **v2.10.0 已发布**（tag `v2.10.0`）：BI 访问明细 IP 统计——状态四态（已封禁 / 封禁中 + 剩余时间 / 被拦截 / 正常），
  手动黑名单优先于自动临时封禁；接口追加 `ban_until` / `ban_source` 与 `status` 白名单筛选（与时间窗/关键词/分页叠加）。
  验证：`npm test` 79 文件 / 629 项全绿、`api.test` 22/22、`frontend:build`、`scan` 干净；
  质检：BI ✅ 放行（[QA-IP-BAN-STATUS.md](QA-IP-BAN-STATUS.md)）。CI：docker-hub [#42944496395](https://github.com/yyliucha/steamdeals/actions/runs/42944496395) 与 docker-tcr [#42944496407](https://github.com/yyliucha/steamdeals/actions/runs/42944496407) ✅（2026-11-11）。
  **服务器部署待执行**（升级到 `2.10.0`）；部署后可手工往 `ip_abuse` 造一条未过期封禁验证「封禁中」显示。
- **v2.9.0 已发布**（tag `v2.9.0`）：BE 愿望单仅本站（POST/DELETE /api/wishlist 只写本站 + 后台「愿望单」清单可删不可加 +
  每账号 API Key 改账号同步用、不回退全局 key、绑定后不自动同步）；BH 访问记录按 IP 统计
  （`/api/admin/visitors/by-ip` 时间窗/排序白名单 + 展开行、黑白名单统计列、设备按 device_id 聚合）。
  验证：`npm test` 79 文件 / 628 项全绿、`api.test` 22/22、`frontend:build`、`scan` 干净；
  质检：BE ✅ 放行（[QA-WISHLIST-SITE-ONLY.md](QA-WISHLIST-SITE-ONLY.md)）、BH ✅ 放行（[QA-VISIT-IP-STATS.md](QA-VISIT-IP-STATS.md)）。
  CI：docker-hub [#42790991661](https://github.com/yyliucha/steamdeals/actions/runs/42790991661) 与 docker-tcr [#42790991580](https://github.com/yyliucha/steamdeals/actions/runs/42790991580) ✅（2026-11-10）。
  **服务器部署待执行**（升级到 `2.9.0`）；部署后按各规格验收（愿望单前台流程、后台清单/批量、IP 统计视图、设备聚合）。
- **v2.8.0 已发布**（tag `v2.8.0`）：AZ 异常审核规则摘要精简（首规则 ×n · 共 N 条规则 + hover 全量规则）；
  BA 运行与同步页重设计（任务健康条 + 记录 6 列/5 轮折叠 + 55vh 固定高度日志面板）；
  BB 代理健康主动探测（立即检测 + `probe --proxy` + 每 10 分钟 `proxy-probe`，探测不写业务冷却）；
  BC 封面图补图覆盖率（`steam-status` 顺带补 `header_image` + `backfill` 候选纳入有价无图 +
  `images.limit` 默认 500 + 后台「清除缺图缓存」）。
  验证：`npm test` 77 文件 / 617 项全绿、`api.test` 22/22、`frontend:build`、`scan` 干净；
  质检：AZ/BA/BB/BC ✅ 放行（[QA-AZ-BA-BB-BC.md](QA-AZ-BA-BB-BC.md)）。
  CI：docker-hub [#42775398971](https://github.com/yyliucha/steamdeals/actions/runs/42775398971) 与 docker-tcr [#42775398970](https://github.com/yyliucha/steamdeals/actions/runs/42775398970) ✅（2026-11-10）。
  **服务器部署待执行**（升级到 `2.8.0`）；部署后按各规格验收（AZ hover、BA 一屏/移动端、BB 立即检测、BC 补图）。
- **v2.7.0 已发布**（tag `v2.7.0`）：AW 批封面图回源（404 快失败 + 单候选 8s→3s + 整次预算 5s + 负缓存分层
  notfound 24h/error 10min + `header_image` 直链白名单 + 前端占位块 + `images pull` 统计 notFound）+
  AX 批异常审核（合并视图默认唯一、去开关与明细表、整 IP 处置）。
  验证：`npm test` 75 个文件全绿、`frontend:build`、`scan` 干净；质检：AW ✅ 放行
  （[QA-IMAGE-FETCH-AW.md](QA-IMAGE-FETCH-AW.md)，通过 8 / 需人工确认 1）、AX ✅ 放行
  （[QA-ADMIN-REVIEW-AX.md](QA-ADMIN-REVIEW-AX.md)，通过 5 / 需人工确认 1）。
  CI：docker-hub run 42761550473（test / smoke / publish 全绿）、docker-tcr run 42761550478（test / publish 全绿），
  镜像已推送两源。
  **服务器部署待执行**（升级到 `2.7.0`）；部署后按 [IMAGE-FETCH.md](IMAGE-FETCH.md) §6 实测：新 appid
  （4266020 等）首次请求 <1s 返回 404、老游戏未缓存图仍 200（日志 `steam.img_fast_fail` / `steam.img_fallback`）；
  控制台真机目视异常审核合并视图桌面展开与移动端卡片。
- **v2.6.0 已发布**（tag `v2.6.0`）：AV 批首页列表读模型——新表 `game_region_snapshot`（(game, region) 一行，
  入库时维护价格/折扣/史低/新史低，`ingestOffers`/`mergeGames` 两个写入方同库强一致）；`gameSearch` 与
  `/api/games/count` 改读快照（去掉两个全库 CTE 与 exists(daily_prices)，count 加 60s 缓存）；
  迁移表空时一次性回填（**首次启动会慢一次，估 10–60 秒**，失败不吞异常）；`readmodel check/rebuild` +
  每日抽样对账任务；`READ_MODEL=legacy` 回滚开关。
  验证：`npm test` 75 个文件全绿、`node test/api.test.js` 22 项全绿、`frontend:build`、`scan` 干净；
  质检：AV ✅ 放行（[QA-READ-MODEL-AV.md](QA-READ-MODEL-AV.md)，通过 12 / 缺失 0 / 偏差 0 / 需人工确认 3）。
  CI：docker-hub run 42746559809（test / smoke / publish 全绿）、docker-tcr run 42746559832（test / publish 全绿），
  镜像已推送两源。
  **服务器部署待执行**（升级到 `2.6.0`）；部署后按 [READ-MODEL.md](READ-MODEL.md) §9 实测：列表 TTFB P95 < 150ms、
  零命中 < 150ms、`/api/games/count` < 30ms、EXPLAIN 命中 grs_region_* 索引；另注意首次启动的回填窗口与
  `readmodel.backfill_done` 日志。
- **v2.5.0 已发布**（tag `v2.5.0`）：AU 批——① D1 `pg_trgm` 搜索索引（迁移建扩展 + 3 条表达式 GIN 索引，
  与搜索归一化逐字一致，本地 pglite 无扩展静默跳过）；② D2 封面图缓存总量上限（设置 `images.maxBytes`，
  超限按最旧清理 + `images prune --max-bytes` + `images pull` 后自动清理）；③ AA 方案 A 愿望单诚实口径
  （「仅本站保存 / Steam 推送暂不支持」，不再出现「推送失败」字样，失败日志与推送分支保留）。
  验证：`npm test` 全绿、`frontend:build`、`scan` 干净；
  质检：AU ✅ 放行（[QA-AU-D1D2AA.md](QA-AU-D1D2AA.md)）。
  CI：docker-hub run 42619351781（test / smoke / publish 全绿）、docker-tcr run 42619351759（test / publish 全绿），
  镜像已推送两源。
  **服务器部署待执行**（升级到 `2.5.0`）；部署后生产验证 `\dx` 有 `pg_trgm`、关键词查询 `EXPLAIN` 命中
  Bitmap Index Scan（TODO AU「待线上验证」）。
- **v2.4.0 已发布**（tag `v2.4.0`）：AT 批后台信息架构改版——新建用户/新建·编辑通知改右侧抽屉（不跳页、
  URL 直达、临时密码抽屉内一次性展示、通知带前台预览）；新菜单「操作日志」一页 5 tab（用户删除/批量操作/
  Steam 账号/邮件发送/运行与同步，?tab= 直达、懒加载+缓存，旧书签 bulk-ops/sync 自动映射不 404）；
  `steam_account_logs` 审计 7 类动作（失败也记、用户被删后日志仍在、保留 180 天并入 prune）；
  邮件服务 3 tab + 发送记录单一入口；系统设置折叠改 6 tab；价格变化悬停「变化」列弹近 7 天线图
  （`/api/admin/reports/price` 去 `daily` 加 `series`，无逐行请求）。规格见
  [ADMIN-CONSOLE-IA.md](ADMIN-CONSOLE-IA.md)。
  验证：`npm test` 74 个文件全绿、`node test/api.test.js` 22 项全绿、`frontend:build`、`scan` 干净；
  质检：AT ✅ 放行（[QA-ADMIN-CONSOLE-IA-AT.md](QA-ADMIN-CONSOLE-IA-AT.md)，通过 14 / 缺失 0 / 偏差 0 / 需人工确认 4）。
  CI：docker-hub run 42611223021（test / smoke / publish 全绿）、docker-tcr run 42611223034（test / publish 全绿），
  镜像已推送两源。
  **服务器部署待执行**（升级到 `2.4.0`）；部署后按规格 §11 验收 1–14 目视核对（含抽 2 游戏对 7 天最低值、
  真机 ≤768 抽屉全屏）。
- **v2.3.0 已发布**（tag `v2.3.0`）：AS 批——README「开发进度」自动摘要（`scripts/todo-progress.js` 生成 +
  `npm run todo:progress`/`todo:progress:check` + CI `docs-progress` 防漂移）+ README 过期项修正。
  纯文档/脚本/CI，无运行行为变化。验证：`npm test` 全绿、`frontend:build`、`scan` 干净、`todo:progress:check` 一致；
  质检：AS ✅ 放行（[QA-TODO-PROGRESS-AS.md](QA-TODO-PROGRESS-AS.md)）。
  CI：docker-hub run 42601382807（test / smoke / publish 全绿）、docker-tcr run 42601382774（test / publish 全绿），
  镜像已推送两源。
  **服务器部署待执行**（升级到 `2.3.0`）；部署后确认 GitHub 首页 README 进度块与 TODO 一致即可。
- **v2.2.1 已发布**（tag `v2.2.1`）：F 批 Steam 价格同步优化——请求间隔 1100→1600ms（回到 200 次/5 分钟配额内）；
  选取改热点优先（近 90 天访问 / 用户标记 / 热度≥1 每天刷）+ 冷门降频（最近快照超 3 天才刷）；
  阈值 `STEAM_PRICES_HOT_HEAT_MIN` / `STEAM_PRICES_COLD_DAYS` 可调。验证：`npm test` 全链全绿 + `frontend:build` + `scan`；
  质检：F ✅ 放行（[QA-STEAM-PRICES-F.md](QA-STEAM-PRICES-F.md)）。
  **服务器部署待执行**（升级到 `2.2.1`）；部署后重点确认：steam-prices 单轮时长与 429 频率、热点阈值是否需调。
- **v2.2.0 已发布**（tag `v2.2.0`）：AQ/AR/AO 后台批次 + AA 愿望单六项缺陷修复 + C1/AN 修复——
  ① 异常审核/访问明细表头排序（IP 数值序、服务端白名单、localStorage 持久化、待审上限 500）；
  ② 异常审核「按 IP 合并」视图（聚合行 + 展开明细 + 处置作用于该 IP 全部待审 + 部分已处理状态 + 移动卡片）；
  ③ 后台游戏列布局修复 + 平台链接抽屉重做（复制中英文两行、点名称开抽屉、每渠道一张卡、移动端全屏）；
  ④ 游戏详情价格历史报表（指标条 + SVG 趋势线 + 史低高亮表格 + 30/90/全部范围 + 移动卡片）；
  ③ AA 六项：失败账号日志/提示带原因（未配 Key / 解密失败 / Steam 拒绝）、无 AppID 条目明确「仅本站」、
  无绑定账号提示可绑定同步、未配 Key 账号置灰；
  ④ C1：heat/catalog 适配 `fetchJson` 新契约（此前 heat 全量无效跳过、catalog 空跑），加契约回归测试；
  ⑤ AN 回归：「放弃修改」清草稿，弹窗不再反复出现（注册签名支持 discard，五面各自清，+2 回归测试）。
  验证：`npm test` 72 文件 / 569 项全绿、`api.test.js` 22 项、`email-auth` 9 项、`frontend:build`、`scan` 干净；
  质检：C1/AN/AA/AQ/AR/AO/AP ✅ 放行（[QA-RELEASE-2.2.0.md](QA-RELEASE-2.2.0.md)、[QA-WISHLIST-AA.md](QA-WISHLIST-AA.md)、[QA-ADMIN-REVIEW-LISTS-AQ.md](QA-ADMIN-REVIEW-LISTS-AQ.md)、[QA-ADMIN-REVIEW-LISTS-AR.md](QA-ADMIN-REVIEW-LISTS-AR.md)、[QA-ADMIN-LINKS-DRAWER-AO.md](QA-ADMIN-LINKS-DRAWER-AO.md)、[QA-PRICE-HISTORY-AP.md](QA-PRICE-HISTORY-AP.md)）。
  CI：`docker-hub` run 42593316897（test/smoke/publish 全绿）、`docker-tcr` run 42593316989
  （test 全绿、`build-push-action@v6` 与 `Verify manifests` 均 success），两个镜像源均已推送
  （首轮因主链误引未提交的 AP 测试失败，已恢复 AP 测试入链并重打 tag）。
  **服务器部署待执行**（含 `2.2.1`）；部署后重点确认：
  C1——`heat --limit 5` 的 `withHeat>0` 且 catalog 补跑能进新游戏（另有 TODO C1 的「重置误标游标」建议）；
  AQ——十万行访问明细按 IP 排序耗时（超阈值再补索引）；AN——真机「放弃修改」后不再弹窗。

- **待开发：AR 后台异常审核「按 IP 合并」视图**（2026-11-09 AQ 质检通过后解锁，另一方会话进行中）。

- **待开发：AA 方案 A「愿望单诚实提示」**（方案 A 已确认，开发描述见 [WISHLIST-OAUTH.md](WISHLIST-OAUTH.md) §3/§4）。

- **v2.1.0 已发布**（tag `v2.1.0`）：AM-2 代理池设置页 + AN 未保存离开提醒 + AK-1/2/3 密码系统 +
  AL 登录/注册/改密页 + AC-2/3/4 同步三批——
  ① 代理池列表编辑器 + 健康状态表（10 秒自动刷新）；
  ② 后台五个编辑面未保存修改三选一离开提醒；
  ③ 密码最低 12 位 + 弱口令黑名单 + scrypt 版本化哈希静默升级 + 强度接口；登录防护（锁 15 分钟/IP 限速/
  记住我/后台安全标识+解锁）；账号流程（临时密码/自助注册/修改密码/首登强制改密）；
  ④ 独立 `/login` `/register` `/change-password` 页面 + 首页去弹窗 + 401 跳转；
  ⑤ steam-status 判 ok 顺带写首价 + 「已同步」= ok+有报价；回填新游戏优先 + 上限 5 万 + 每日配额预算超限降频；
  熔断面板可见/手动重置 + 429 冷却落盘共享 + 报价结构校验。
  验证：`npm test` 66 文件 / 542 项全绿、`node test/api.test.js` 22 项、`frontend:build`、`scan` 干净；
  质检：AM-2/AN/AK-1/AK-2/AK-3/AL/AC-2/AC-3/AC-4 九批均 ✅ 放行（QA-PROXY-POOL-AM2.md / QA-UNSAVED-GUARD-AN.md /
  QA-AUTH-AK1.md / QA-AUTH-AK2.md / QA-AUTH-AK3.md / QA-AUTH-AL.md / QA-SYNC-AC2.md / QA-SYNC-AC3.md / QA-SYNC-AC4.md）。
  CI：`docker-hub` run 42577503696（test/smoke/publish 全绿）、`docker-tcr` run 42577503641
  （test 全绿、`build-push-action@v6` 与 `Verify manifests` 均 success），两个镜像源均已推送
  （首轮 docker-hub smoke 因 AK-1 密码策略拒 11 位旧密码失败，已改 workflow 为 ≥12 位强密码并重打 tag）。
  服务器部署：**已部署（2026-11-09 15:55 实测）**——容器 `package.json` 版本 `2.1.0`、
  `/home/ubuntu/steamdeals/docker-compose.yml` 当日更新并重启（`scheduler.start` 15:55:20 全量任务表，含 heat）。
  部署后重点人工确认：
  真机走一遍登录/注册/改密交互（AL QA 需人工确认项）、真实邮箱收到注册验证码、后台「重置熔断」按钮、
  老用户已有密码不受影响（登录自动静默升级为新哈希）、老部署升级后新密码必须 ≥12 位。

- **待开发：AA 方案 A「愿望单诚实提示」**（2026-11-09 所有者确认方案 A）：
  根因已定案——`wishlist_add_failed` = `HTTP 401 → api.steampowered.com`，写接口 `AddToWishlist` 不接受 Web API Key
  （只读 GetWishlist 正常）；不投入 OAuth 改造，改为中性文案「已加入本站愿望单（Steam 推送暂不支持）」+ 文档说明。
  开发描述见 [WISHLIST-OAUTH.md](WISHLIST-OAUTH.md) §3/§4（只改前端文案与文档，保留失败日志的 reason）。

- **v1.18.0 已发布**（tag `v1.18.0`）：AE/AF/AG/AC-1 四批——版本徽标按服务器 IP 选镜像仓库
  （ipinfo.io 定位 → 大陆/香港优先 TCR、其他优先 Hub，401 换 token、双失败回退 GitHub，结果带 source/region）；
  搜索态写操作后列表立刻刷新（先失效 30 秒搜索缓存）；后台「游戏管理」平台链接抽屉（`/api/admin/games/:id/links`
  + 列表 `link_count`，脏链接过滤、AppID 兜底）+ 后台/前台游戏名复制（clipboard API + execCommand 降级）；
  数据任务全部写 `sync_runs`、重任务排队可观测（`job_wait_slot`/`job_wait_end` + 面板「等待」）、
  后台任务表「上次结果/耗时/失败原因」三列、`/api/admin/sync/status` 带 `warnings`（缺 Key/被关闭任务显式提示）。
  验证：`npm test` 56 个文件全绿 / `frontend:build` / `scan` 干净。
  CI：`docker-hub` run 42188621967（test/smoke/publish 全绿）、`docker-tcr` run 42188622023
  （`build-push-action` 与 `Verify manifests` 均 success），两个镜像源均已推送。
  **服务器部署待执行**（按本文第 4 节升级到 `1.18.0`）；
  部署后按 [QA-AE-AF-AG-AC1.md](QA-AE-AF-AG-AC1.md) 的 5 项「需人工确认」验收。

- **v1.17.0 已发布**（tag `v1.17.0`）：AD 批「搜索支持中英文（含平台中文别名）」——搜索三源命中
  （`name`/`name_en`/平台别名）+ 空格/全角归一化，前台与后台「游戏管理」同口径；`rename` 放开为
  「name 不含中文即补中文名」（覆盖保护仍在）。验证：`npm test` 51 个文件全绿 / `frontend:build` / `scan` 干净。
  CI：`docker-hub` run 42179973683（test/smoke/publish 全绿）、`docker-tcr` run 42179973696
  （`build-push-action` 与 `Verify manifests` 均 success），两个镜像源均已推送。
  **服务器部署待执行**（按本文第 4 节升级到 `1.17.0`）；
  部署后请在后台复验：搜「英雄连」应命中 `Company of Heroes 3`（若该游戏的平台别名已入库）。

- **v1.16.4 已发布**（tag `v1.16.4`）：AB 批「Steam 状态判定整轮静默不写库」——修 appdetails 条目少取
  `.json` 导致的 0 写入、写入不可静默（`wrote` 只计真写入 + `skip_write`/`write_miss` 日志 + 全跳过报错）、
  限速按每请求计、429 立即收轮、整轮复用连接、每轮写 `sync_runs`；补 `steamStatus.initialDelaySec` 设置项（原 Y 批）、
  `steamStatus.limit` 默认 12000→6000。验证：`npm test` 51 个文件全绿 / `frontend:build` / `scan` 干净。
  CI：`docker-hub` run 42177725546（test/smoke/publish 全绿）、`docker-tcr` run 42177725483
  （`build-push-action` 与 `Verify manifests` 均 success），两个镜像源均已推送。
  **服务器部署待执行**（按本文第 4 节升级到 `1.16.4`）；
  部署后请同步「系统设置 → 数据源与采集」里的 `steamStatus.limit` 为 6000（库值覆盖代码默认），
  并跑 `--limit 20` 抽查 `steam_status`/`steam_checked_at` 真的写入。

- **v1.16.3 已发布**（tag `v1.16.3`）：后台建号「邮箱被占用却已创建用户」修复——`POST /api/admin/users`
  支持可选 `email` 并同一次写入，邮箱占用 409「这个邮箱已被其他账号绑定」、用户名重复 409「用户名已存在」，
  均不产生残号；前端单次请求。验证：`npm test` 51 个文件全绿（含新增 `test/admin-users.test.js` 6 项）/
  `node test/api.test.js` 22 项全绿 / `frontend:build` / `scan` 干净。
  CI：`docker-hub` run 42168292026（test/smoke/publish 全绿）、`docker-tcr` run 42168291983
  （`build-push-action` 与 `Verify manifests` 均 success），两个镜像源均已推送。
  **服务器部署待执行**（按本文第 4 节升级到 `1.16.3`）；部署后请在后台复验：填已占用邮箱建号 →
  409 提示且刷新列表无新增用户。

- **v1.16.2 已发布**（tag `v1.16.2`）：Z 批「手机端适配修复」——详情弹窗 `vw` 逃逸根因修复
  （`%`/`dvh` + 弹窗宽 100% + 删死规则 + 全局防横向溢出）、桌面版网站渲染提示（保留 zoom 兜底）、
  「安装到桌面」提示（`useInstallPrompt`，不支持时给 Chrome 说明）、后台游戏目录/访问记录各 tab 手机卡片化、
  其余表格左右滑动提示。验证：`npm test` 50 个文件 427 项全绿 / `node test/api.test.js` 22 项全绿 /
  `frontend:build` / `scan` 干净。CI：`docker-hub` run 42153332843（test/smoke/publish 全绿）、
  `docker-tcr` run 42153332850（`build-push-action` 与 `Verify manifests` 均 success；
  PostgreSQL 镜像 mirror 耗时约 47 分钟，比往常慢但完成），两个镜像源均已推送。
  规格见 [MOBILE-FIX.md](MOBILE-FIX.md)。**服务器部署待执行**（按本文第 4 节升级到 `1.16.2`）；
  真机验收（红米 K100 Pro Max + 小米自带浏览器：详情不溢出、安装按钮、后台卡片、PC 零回归）随部署执行。

- **v1.16.1 已发布**（tag `v1.16.1`）：X 批「调度器长任务阻塞修复」——重任务改「非阻塞发射 + 全局单槽」
  （tick 不再被 `steam-prices` 阻塞 90 分钟）、`steam-status` 归入 `STEAM_HEAVY`、启动从 `sync_runs` 恢复
  `lastRunMs`、状态文件每 tick 刷新；`steam-status` 节奏改为首轮 10 分钟 / 每天 / 每轮 12000。
  验证：`npm test` 49 个文件 422 项全绿 / `node test/api.test.js` 22 项全绿 / `frontend:build` / `scan` 干净。
  CI：`docker-hub` run 41989284328（test/smoke/publish 全绿）、`docker-tcr` run 41989284397
  （`build-push-action` 与 `Verify manifests` 均 success），两个镜像源均已推送。
  规格见 [SCHEDULER-BLOCKING-FIX.md](SCHEDULER-BLOCKING-FIX.md)。**服务器部署待执行**（按本文第 4 节升级到 `1.16.1`）。
  **上线时注意**：`steamStatus.limit` / `steamStatus.intervalMin` 是落库设置，线上若已保存过旧值（8000 / 10080），
  需在「系统设置」里确认/重置为 12000 / 1440；部署后观察一轮 `scheduler.job_start` 序列确认轻任务不再被饿死。

- **v1.16.0 已发布**（tag `v1.16.0`）：手机端 PWA——standalone 全屏（manifest + 192/512 图标，512 maskable）、
  断网统一提示「网络不可用，请检查连接后重试」可重试、Android 返回键先关浮层（`useBackGuard`）、
  版本检查与「已更新」提示（`useVersionGuard`：启动记基线 + `visibilitychange` 比对 `/api/site`，
  默认只提示不自动刷新，离线静默跳过）；**不做** service worker / 离线缓存 / 推送 / 购物车。
  验证：`npm test` 49 个文件 419 项全绿 / `node test/api.test.js` 22 项全绿 / `frontend:build` / `scan` 干净。
  CI：`docker-hub` run 41972177950（test/smoke/publish 全绿）、`docker-tcr` run 41972178047
  （`build-push-action` 与 `Verify manifests` 均 success），两个镜像源均已推送。
  规格见 [MOBILE-PWA.md](MOBILE-PWA.md)。**服务器部署待执行**（按本文第 4 节升级到 `1.16.0`；
  部署侧需确认 nginx 未对 HTML 加 `expires`/`proxy_cache`，见规格 §2.1）；
  真机验收（添加主屏幕 / 更新提示 / 离线不误报）随部署执行。

- **v1.15.2 已发布**（tag `v1.15.2`）：`STEAM_STATUS_LIMIT` 进系统设置（`steamStatus.limit`，默认 8000，
  保存即热加载）；调度器与 `steam-status` CLI 默认上限同步改为 8000。测试 `npm test` 48 个文件全绿 /
  `scan` 干净。CI：`docker-hub` run 41810479183（test/smoke/publish 全绿）、`docker-tcr` run 41810479240
  （`build-push-action` 与 `Verify manifests` 均 success），两个镜像源均已推送。
  **服务器部署待执行**（按本文第 4 节升级到 `1.15.2`；compose 真实文件名仍未确认，先 `ls compose*.*`）。

- **v1.15.1 已发布**（tag `v1.15.1`）：V 批——后台内容分级筛选（`rating=adult|mature|none` +
  指标卡「成人/成熟」计数 + 筛选下拉与六态卡片对齐）+ backfill 合并写状态与分级（`src/steam-status.js`
  的 `applySteamDetails` 共用函数，appdetails 回退路径顺带落库，拿不到状态不推游标、分级 null 不覆盖，
  省约 6.9 万次重复请求）。测试：`test/steam-status.test.js` 6 → 10 项、`api.test.js` 新增筛选用例，
  `npm test` / `frontend:build` / `scan` 全绿。CI：`docker-hub` run 41807033753（test/smoke/publish 全绿）、
  `docker-tcr` run 41807033648（`build-push-action` 与 `Verify manifests` 均 success），两个镜像源均已推送。
  规格见 [STEAM-SYNC-STATUS-AND-RATING.md](STEAM-SYNC-STATUS-AND-RATING.md) §13/§14.3。
  **服务器部署待执行**（按本文第 4 节升级到 `1.15.1`；compose 真实文件名仍未确认，先 `ls compose*.*`）。
  **上线时建议把 `STEAM_STATUS_LIMIT` 调到 8000**（单轮约 3.3 小时/天，三周补完）。

- **v1.15.0 已发布**（tag `v1.15.0`）：Steam 同步状态可解释 + 锁国区标注 + 内容分级标注
  （[STEAM-SYNC-STATUS-AND-RATING.md](STEAM-SYNC-STATUS-AND-RATING.md)）：六态状态机 + 7 列迁移（免费一次 SQL 置位）、
  `steam-status` 任务（每周、续跑游标、与热度共用配额）、后台指标卡 7 分项 + 状态/分级列、前台成人隐藏/角标与锁区/未发售标注、
  设置 `site.adultDisplay`（hide/badge/show）与 `steamStatus.*`。测试：新增 `test/steam-status.test.js` 6 项入主链
  （`npm test` 48 个文件全绿 / `frontend:build` / `scan` / `api.test.js` 22 项）。
  CI：`docker-hub` run 41792878309（test/smoke/publish 全绿）、`docker-tcr` run 41792877726
  （`build-push-action` 与 `Verify manifests` 均 success），两个镜像源均已推送。
  **上线后的同步步骤见规格 §12**（迁移自动置位免费 → 手工 `steam-status --limit 2000` 验证分布 → 放开全量，
  约 37 小时可中断续跑）。**服务器部署待执行**（按本文第 4 节升级到 `1.15.0`；
  compose 真实文件名仍未确认，先 `ls compose*.*`）。

- **v1.14.2 已发布**（tag `v1.14.2`）：S 批（仅封禁可见页面统一守卫 `BAN_ONLY_PAGES` + `/api/ban/state`
  复查接口 + 黑白名单双向互斥 + 待审口径 A）与 T 批（申诉 URL 只带 `?code=`、服务端注入 `__APPEAL__`、
  robots/响应头/申诉编号 crypto 随机等 5 项加固）。测试：reviews 24 项 / visitors 8 项 / admin-bulk 13 项 /
  新增 appeal-security 6 项全绿（`npm test` 47 个文件全绿 / `frontend:build` / `scan` 干净）。
  CI：`docker-hub` run 41772653681（test/smoke/publish 全绿）、`docker-tcr` run 41772653679
  （`build-push-action` 与 `Verify manifests` 均 success），两个镜像源均已推送。
  规格见 [BAN-AND-SECURITY-FIXES.md](BAN-AND-SECURITY-FIXES.md)、[URL-PARAM-PRIVACY.md](URL-PARAM-PRIVACY.md)。
  **服务器部署待执行**（按本文第 4 节升级到 `1.14.2`；compose 真实文件名仍未确认，先 `ls compose*.*`）。

- **v1.14.1 已发布**（tag `v1.14.1`）：封禁页守卫——`/banned` 未封禁一律 302 回首页（判定只在拦截链，
  不做二次判定），`BanPage.vue` 加 `__BAN_PAGE__` 缺失守卫；`test/reviews.test.js` 19 项全绿。
  CI：`docker-hub` run 41664570516（test/smoke/publish 全绿）、`docker-tcr` run 41664570658
  （`build-push-action` 与 `Verify manifests` 均 success），两个镜像源均已推送。
  规格见 [BAN-PAGE-GUARD.md](BAN-PAGE-GUARD.md)。**服务器部署待执行**（按本文第 4 节升级到 `1.14.1`；
  compose 真实文件名仍未确认，先 `ls compose*.*`）。

- **v1.14.0 已发布**（tag `v1.14.0`）：后台 11 个列表批量操作（多选 + 统一 `POST /api/admin/bulk` + 审计
  「系统 → 批量操作记录」）。`npm test`（46 个测试文件，含新增 `test/admin-bulk.test.js` 12 项）/
  `npm run frontend:build` / `npm run scan` 全绿。CI：`docker-hub` run 41653223118（test/smoke/publish 全绿）、
  `docker-tcr` run 41653223106（`build-push-action` 与 `Verify manifests` 均 success），两个镜像源均已推送。
  规格与实现偏差见 [ADMIN-BULK-ACTIONS.md](ADMIN-BULK-ACTIONS.md)（§11）。
  **服务器部署待执行**（按本文第 4 节升级到 `1.14.0`；compose 真实文件名仍未确认，先 `ls compose*.*`）。

- **v1.11.0 已发布**（tag `v1.11.0`，docker-hub + docker-tcr 双绿，镜像已推送）。功能：补注册
  ElDrawer/ElBadge/ElCheckbox/ElCheckboxGroup（修复手机筛选/我的/通知抽屉、未读角标、愿望单勾选——
  推送到 Steam 账号首次真正可用）+ 封禁页跳转（`__BAN_PAGE__` → `/banned`）。规格见
  [FRONTEND-RENDER-FIX.md](FRONTEND-RENDER-FIX.md)。**服务器部署待执行**（按本文第 4 节升级到 `1.11.0`）。
- **v1.10.0 已发布**（tag `v1.10.0`，docker-hub + docker-tcr 双绿，镜像已推送）。功能：移动端真机适配——
  「桌面版网站」模式下强制 viewport（`width=390` + 禁缩放 + sessionStorage 防循环 reload）、zoom 兜底、
  `-webkit-text-size-adjust:100%`、字号/触摸基线校准、`?debug=1` 调试浮层。规格见
  [MOBILE-VIEWPORT.md](MOBILE-VIEWPORT.md)。**服务器部署待执行**（按本文第 4 节升级到 `1.10.0`）；
  部署后请在红米 K100 Pro Max 按规格 §4 的 14 项清单真机自检并回执。
- **v1.9.0 已发布**（tag `v1.9.0`，docker-hub + docker-tcr 双绿，镜像已推送）。功能：PC 筛选修复（单行工具栏）、
  移动端独立设计（v-if 双结构 + 底部 4 入口 + 筛选弹层 + 全屏详情 + 「桌面版网站」兜底）、封禁标记
  （封禁时该 IP 的旧待审永久标记 `auto_banned`，审计视图 `status=all`）。规格见
  [UX-REDESIGN-2026-11-03.md](UX-REDESIGN-2026-11-03.md)。**服务器部署待执行**（按本文第 4 节升级到 `1.9.0`）；
  上线后建议手机真机 + DevTools 设备模拟过一遍移动端验收清单（规格 §3.5）。
- **v1.8.0 已发布**（tag `v1.8.0`，docker-hub + docker-tcr 双绿，镜像已推送）。功能：愿望单归属与选择性移除、
  审核联动（封禁中 IP 不再占待审）、站点通知中心（铃铛/角标/抽屉 + 服务端已读）、移动端响应式重做
  （含「桌面版网站」兜底）、调度器轻任务并行（`SCHEDULER_LIGHT_CONCURRENCY` 默认 3，heat 播种期不再饿死其它源）、
  DLC 列移除（方案 A）。规格见 [UX-BATCH-2026-11-03.md](UX-BATCH-2026-11-03.md) 与
  [STEAM-DLC.md](STEAM-DLC.md)。**服务器部署待执行**（按本文第 4 节升级到 `1.8.0`）；
  升级后生产「heat 首轮播种期杉果/GOG 排队」问题即自然消失，无需任何手工命令。
- **v1.7.0 已发布**（tag `v1.7.0`，docker-hub + docker-tcr 双绿，镜像已推送）。功能：账号库 DLC 统计
  （后台「Steam 账号」页 DLC 列）+ 同步时自动补全目录类型（GetItems 只挑 `app_type` 缺失的，天然收敛）。
  规格见 [STEAM-ACCOUNTS.md §8](STEAM-ACCOUNTS.md)。**服务器部署待执行**（按本文第 4 节升级到 `1.7.0`）。
- **v1.6.0 已发布**（tag `v1.6.0`，docker-hub + docker-tcr 双绿，镜像已推送）。功能：前台「愿望单」按钮
  加入本站并写进所选 Steam 账号（多账号弹窗多选/仅本站）；写操作需账号自配 API Key（后台「Steam 账号 →
  API Key」，密文存储）；移除回推 `RemoveFromWishlist`；新表 `user_wishlist`，推导 = 手动 ∪ Steam 同步。
  规格见 [STEAM-ACCOUNTS.md §16](STEAM-ACCOUNTS.md#16-手动愿望单与-steam-推送需求-2026-11-02已实现并发布-v160)。
  **服务器部署待执行**（按本文第 4 节升级到 `1.6.0`）。⚠️ AddToWishlist 为未文档化接口，
  上线后需在服务器实测一次「点愿望单 → Steam 生效」，并回执验证结果。
- **v1.5.0 已发布**（tag `v1.5.0`，docker-hub + docker-tcr 双绿，镜像已推送）。功能：Steam 多账号绑定
  （每用户上限 5、OpenID + state 防 CSRF）、「已拥有」按用户推导（手动 ∪ 绑定账号库，`owned_by` 徽标）、
  愿望单标签页与自动价提醒（`source='steam_wishlist'`）、库/愿望单差集删除（修掉只增不删的旧 bug）、
  调度器每日 `steam-accounts` 任务与可选 `steam-claim` 认领任务。规格与验收见 [STEAM-ACCOUNTS.md](STEAM-ACCOUNTS.md)。
  **服务器部署待执行**（按本文第 4 节：sed 改 compose 镜像 tag → `docker compose pull app && up -d app`；
  compose 真实文件名仍待确认，先 `ls compose*.*`）。升级后无需手工数据命令：
  `steam-accounts` 每日自动同步；存量 FF 账号认领走后台按钮或 compose 配 `STEAM_CLAIM_USERNAME`/`STEAM_CLAIM_STEAM_ID`。
- 服务器当前部署 **v1.4.9**（控制台右上角显示 `v1.4.9`）。TCR/Docker Hub 均有 `1.4.9` / `latest`（v1.5.0 已就绪）。
- v1.4.9（`d2d3109`）：修复 OpenID 校验把 fetchText 对象当字符串的 bug（`snippet="[object Object]"`）。
- v1.4.8（`fe86d35`）：支持 https 代理（自签放行），解决 community 的 DPI 重置。
  Steam 专用代理已配置为 `https://steambot1:***@43.129.196.229:8531`（香港 VM-0-7 上 tinyproxy + stunnel）。
- 工作区：见 git status；HEAD 已同步 origin main。
- 待探测（需服务器）：线上 heat 逐 appid 返回全 `success:false`（[TODO.md C1](TODO.md#c-线上问题--需要探测)）、
  服务器 compose 真实文件名（C2）。
- 已知事项：`web/*.html` 旧回退页（无 Vue 构建产物时才使用）的 Steam 区块未同步新接口，生产走 Vue 构建不受影响。

