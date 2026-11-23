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

> **BS 批（docs/MOBILE-APP-TWA.md §5.3）：APK 必须先入库、再下令构建。**
> 镜像构建时 `frontend/public/**` 才会被拷进 `dist/`——本机出 APK → 放 `frontend/public/app/` + 更新同目录
> `latest.json` → 提交推 main，**之后**再下令「构建 vX.Y.Z」；先构建后放包 = 该版镜像里没有包，`/app` 页面 404。
>
> **BY 批（docs/MOBILE-APP-UPDATE.md §5）：App 内置更新的发版清单**
> ① `android/twa-manifest.json` / `app/build.gradle` 的 `appVersionName/appVersionCode` = 本次版本（**单调递增**，
> 签名 keystore 不变，否则覆盖安装被系统拒绝）；② 出包后写 `frontend/public/app/latest.json`：
> `version/versionCode/minVersionCode/apkPath/sha256/size/releasedAt/notes`（`versionCode` = major×10000+minor×100+patch）；
> ③ 只保留最近 3 个 APK（更早的删文件）；④ 同一 APK 传 GitHub Release（tag `app-v<version>`）作为 App 下载兜底。

```bash
cd F:\dsh\gameprice
# ① 验证
npm test && npm run frontend:build && npm run scan
node test/api.test.js          # 若动过 API/权限/标记
npm run e2e                    # e2e 全量（CK 批门禁：矩阵逐行有结果 + PDF 报告在 F:\dsh\e2e-reports\，见 docs/TESTING-E2E.md）
                               # 发版前与每轮 QA 必跑；线上行（--online）留到部署后带 --expect-version= 跑

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

- **X.0.0**：主版本（架构级重构，如全面换前端 = 1.0.0；必须所有者点名，不自动推算）。
- **X.Y.0**：大版本（新功能 / 用户可见行为变化）。
- **X.Y.Z**：小版本（纯修 bug / 参数修正，如 1.4.1、1.4.2 都是热修复）。
- tag 命名固定 `v` 前缀；每次发版**恰好一个 tag**；**版本号连续递增、禁止跳号**（2026-11-17 起，
  口径见 `.dsh/skills/steamdeals-build/SKILL.md` §1——即使一次发 ≥3 个功能条目也只 +1 大版本）。

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

> **发版避让长任务（EU 批，2026-11-23 起，见 [SCHEDULER-RESTART-RESILIENCE.md](SCHEDULER-RESTART-RESILIENCE.md)）**：
> 重启 app 会打断正在跑的定时任务。升级前先看一眼有没有长任务在跑：
>
> ```bash
> # 方式一：后台「游戏管理 → 同步与回填」看「当前任务」；方式二：命令行看状态文件
> docker exec steamdeals cat data/scheduler-status.json | grep -E '"running": true|"lastResult"'
> ```
>
> - 没有任务在跑 → 直接升级；
> - 有任务在跑 → **等待它完成（steam-prices 单轮 ≤10 分钟）**，或至少等 10 分钟后升级——
>   被打断的任务会记为「被重启中断」（不告警、不发失败邮件），下一轮自动断点续跑，不丢已处理进度。

> **调度器独立服务（EV 批，2026-11-23 起，见 [SCHEDULER-AS-SERVICE.md](SCHEDULER-AS-SERVICE.md)）**：
> app 容器只跑 Web/API（`command: ["serve"]`），定时任务跑在独立的 `scheduler` 容器里：
>
> ```bash
> # 首次升级到 EV 之后：安装调度器服务（自动防双调度器：app 还在跑 all 会拒绝）
> ./scripts/scheduler-service.sh install
> ./scripts/scheduler-service.sh status    # 容器状态 + 最近心跳 + 当前 heavy slot 任务
>
> # 日常发版（规格 §7 一键：stop_grace_period 10m + EU-5 排空自动保证顺序，无需分步）
> docker compose pull && docker compose up -d
>
> # 保守场景：只想更新 Web/API 时只动 app（调度器继续跑、任务不受影响）
> docker compose up -d --no-deps app
>
> # 分步命令（原理说明，见规格 §6）：pull → up app → 观察调度器任务 → up scheduler
> # （scheduler 收到 SIGTERM 触发 EU-5 排空——等任务自然完成 ≤10 分钟才退出）
>
> # 一键删除所有调度任务（停容器 + 删容器 + 清 data/scheduler-*.json 状态；业务数据不动）：
> ./scripts/scheduler-service.sh remove
> ```

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

### 当前状态（2026-11-21 更新，**v2.28.1 已发布（CI 双绿：docker-hub 44784945370 ✅ test/smoke/publish 全 success；docker-tcr 44784945479 ✅ test/publish 全 success；test-main 44784930574 ✅（main 249fd04 全链绿））：CO-5/B4-2 巨石拆分第十四~十七轮八域**（#17 admin align 4817d49 / #12 admin 报表备份日志 4a93c01 / #13 admin 图片 652e6f7 / #11 admin 用户批量 9905946 / #15 admin 游戏目录 42ee800 / #16 admin 提醒愿望单 beb25e4 / #20 cli 运维类 8249e56 / #21 games d46b51a；QA 八域全部第 1 轮 ✅ 放行（0 打回），**B4 队列 21/21 域全部拆完**；纯技术债重构，无 schema/接口/配置变化，升级即可）；**服务器部署待执行**；**v2.28.0 已发布（CI 三绿：docker-hub 44729743765 ✅ test/smoke/publish 全 success；docker-tcr 44729743671 ✅ test/publish 全 success；test-main 44729724224 ✅（release 提交 1722011，main 全链绿；DT-4 时点 session-heartbeat 红项已由 DT-5 提交修复、DT-3 steamBound 边界锁回归已由 9646308 修复））：DU + DV + EC + EM + DT-1~5 八条合并发版**（✨ 功能 1 + ⚙️ 调整 5 + 🐞 缺陷 2，含新功能面 → 大版本，2.27.9 → 2.28.0 连续递增）——DU 个人简介 placeholder 动态绑定（791d729，QA-DU 3/0/0/0）；DV 游戏管理「ITAD」改来源筛选（0a6b978，QA-DV 5/0/0/0）；EC 图片覆盖治理：覆盖看板/缺图回填/前端占位（ab7ba90，QA-EC 4/0/0/1）；EM Steam 同步超时修复：8s 快速失败 + 同步异步化 202/轮询（ba9b0b0，QA-EM 5/0/0/1）；DT-1 菜单权限隔离（7f5edba）/DT-2 用户级接口 + 5 页接入（403e6f2）/DT-3 用户管理打磨（4a40737）/DT-4 验证码体验（4c49f7c）/DT-5 前后台入口（c19f514），QA 全放行（docs/QA-DT-1~5.md）。**部署提示**：EC 看板/回填任务首轮执行、EM 同步异步化（触发即 202 + sync-status 轮询）、DT 权限/菜单与普通用户 5 页、DV「ITAD（来源）」筛选上线生效；服务器部署待执行；**v2.27.9 已发布（CI 双绿：docker-hub 44717191386 ✅ test/smoke/publish 全 success；docker-tcr 44717191332 ✅ test/publish 全 success；test-main 44717129292 被并发 push 取消（concurrency，主链以 tag 双绿为准）；#20 cli 运维类（8249e56）在 tag 之后推 main、归下批，其 test-main 44719388430 红待查——本地 worktree 全绿、与 DT-4 同类 2–3 分钟快速失败，疑似 CI 环境 flaky）：CO-5/B4-2 巨石拆分第十/十一/十二/十三轮四域——admin 系统设置 #10（5ce2e50）+ admin 会话 #14（9659435）+ cli 同步类 #18（9bc710a）+ cli 报表类 #19（2aa8b15），契约零变化**；**v2.27.8 已发布：DX + ED + EH + EI + EL + EK 六条合并发版**；**DX 列表/站点接口性能优化已随本版发布**（090af4c，规格 docs/SEARCH-FIX-PERF.md §DX：① gameSearch count 合并——四分支 rows 查询带 `count(*) over()`，无关键词列表 count+rows 从 2 条 SQL 合并为 1 条，空页回落独立 count、total 口径不变；② 列表 45s 短 TTL 内存缓存（src/search-cache.js；key=归一化筛选参数+region+userId 摘要+游客哈希；命中日志 `search.cache_hit`；gen=sync_runs max(id) 感知调度器跨进程同步；手动同步子进程结束/合并/删除恢复/屏蔽/兴趣/拥有/个人标记/bulk/Steam 库与愿望单同步主动失效）；③ /api/site 60s 缓存（设置保存/SMTP 保存失效、重启清空）；④ test/search-perf.test.js 5 项进主链 test:3。**本机线上只读压测（部署前 v2.27.7，N=30，2026-11-20）**：列表 P50 327ms/P95 349ms（min 313/max 695，total=109372）；搜索「侠盗猎车手」P50 586/P95 644ms（total=0——DW 修复线上复验待所有者执行）、「portal」P50 535/P95 599ms（total=64）；/api/site P50 60/P95 68ms。**部署后同条件复测目标：列表/搜索 P95 ≤150ms、/api/site ≤50ms**）；**ED test-main 文档路径忽略已发布 v2.27.8**（143d97e，QA docs/QA-ED.md ✅ 4/0/0/0）；**EL 后台添加/编辑统一弹窗已发布 v2.27.8**（e0821f9，QA docs/QA-EL.md 第 1 轮 ✅ 5/0/0/2；纯前端改动——IP 黑/白名单、站点通知、设置代理、申诉处理统一为弹窗，交互验证 20/20 + 前后截图 `F:\dsh\el-shots\{before,after}`）；**EK App Release 同步代理已发布 v2.27.8**（✅ 6/0/0/1，QA docs/QA-EK.md，实现 cc4fcf5）；v2.27.8 已发布：DX + ED + EH + EI + EL + EK（六条均为修复/调整/技术债/测试基建，无新功能面 → 小版本；EH+EI 代码已随 v2.27.6 成像，本批为补发版记录）；v2.27.7 已发布：EJ 昵称显示规则统一（Web + App，App 同步发布 app-v2.24.2）；v2.27.6 已发布：CO-5/B4-2 第九轮 admin 同步任务域拆分（技术债重构，契约零变化）；v2.27.5 已发布：EF 18R 数据同步与筛选修复 + EG 公告角标已读修复，App 同步发布 app-v2.24.0；app-v2.23.0 已发布：DY + DZ + EA-1~6 + EB（站点零改动）；v2.27.4 已发布：CO-5/B4-2 两域拆分（site/steam/ban 杂项 + admin 访问安全）；v2.27.3 已发布：CO-5/B4-2 三域拆分（watchlist/announcements/me）；v2.27.2 已发布：CO-5/B4-2 认证域拆分；v2.27.1 已发布：CO-4/B4 两域拆分 + DW 搜索修复；v2.27.0 已发布：DP + DQ + DN + DR + DS + DL，App 同步发布 app-v2.22.0；v2.26.0 已发布：CU 四项 + DF + CO-4/D4 + CO-4/D6 + CO-4/E4；v2.25.0 已发布：CO-1/A3 + CO-2/B3 + CQ + CW + CX + CY + CZ + DA + DC + DH + DK；App 同步发布 app-v2.21.0）

**v2.28.2 已发布（2026-11-23，tag v2.28.2；CI 双绿：docker-hub 45101984459 ✅ test/smoke/publish 全 success；docker-tcr 45101984469 ✅ test/publish 全 success；test-main 45101958048 ✅ main 全链绿）**：ET 设置页布局系统修复（64d9f48；QA [QA-ET.md](QA-ET.md) 第 1 轮 ✅ 5/0/0/1——数据源与采集/站点与内容/高级三 tab 每 section 一张卡片、两列网格 ≤960px 单列、折叠在卡片内；纯前端布局修复，无 schema/接口/配置变化，升级即可）。验证：settings.test.js 15/15 + 主链分段 test:1~4 全绿 + frontend:build ✓ + scan 干净 + headless Chrome 结构/功能探针。**服务器部署待执行**（按本文第 4 节升级到 2.28.2）。

**v2.28.3 已发布（2026-11-23，tag v2.28.3 → 7723f0c；CI 双绿：docker-hub 45121904048 ✅ test/smoke/publish 全 success；docker-tcr 45121904031 ✅ test/publish 全 success；test-main 45110357498 ✅ main 3c6d752 全链绿，7723f0c 纯文档修复由 docker-hub test job 兜底全绿）**：EU 定时任务重启韧性（3c6d752；QA docs/QA-EU.md 第 1 轮 ✅ 5/0/0/2——SIGTERM 打断在跑任务记「被重启中断」不误报失败/不发邮件/不进熔断；steam-prices 分批 5000 + 断点续跑；重启残留 running 标 interrupted；停机跳过失败原因查询降噪；EU-5 排空——停机先等任务自然完成 ≤10 分钟再退出）+ EV 调度器独立进程化（8dcd41a；QA docs/QA-EV.md 第 1 轮 ✅ 5/0/0/2——compose 五变体 app 改 serve + 独立 scheduler 容器（stop_grace_period 10m）；scheduler-service.sh install/remove/status；发版只重启 app）。**无 schema 变更、无新增依赖**。**部署提示**：服务器 compose 需同步「app command 改 serve + 新增 scheduler 服务（stop_grace_period: 10m）」两处（本文第 4 节）；升级后执行 `scripts/scheduler-service.sh install`（防双调度器）并观察一轮任务；日常发版一行 `docker compose pull && docker compose up -d`（规格 §7 一键，排空保护）。**服务器部署待执行**。

**v2.28.4 构建未发布（2026-11-23，tag v2.28.4 → 08eab51；CI 三红：docker-hub 45127732749 ❌ / docker-tcr 45127732738 ❌ / test-main 45127712493 ❌）**：EX backfill 回归修复（countBackfillCandidates 兼容 store 调用 + ops.js 传 s.query + 回归测试）——但 CI 红在「EW 旧静态断言过期」（test/wishlist.test.js 的 v2.9.0 时代断言与 EW 只读展示冲突），镜像未发布，由 v2.28.5 补发。

**v2.28.5 已发布（2026-11-23，tag v2.28.5 → c39cd9f；CI 双绿：docker-hub 45129428416 ✅ test/smoke/publish 全 success；docker-tcr 45129428468 ✅ test/publish 全 success；test-main 45129405730 ✅ main c39cd9f 全链绿）**：EW 前台愿望单显示 Steam 账号（0fcde48 + 9a65cc2，功能随本版发布）+ EX backfill 回归修复（08eab51）+ EW 旧静态断言更新（test/wishlist.test.js 改 `assert.match(home, /wishlistByText/)`，保留禁止账号选择/推送断言）。**无 schema 变更、无新增依赖**；升级后 backfill 任务恢复调度。**服务器部署待执行**（按本文第 4 节升级到 2.28.5）。

**v2.28.6 已发布（2026-11-23，tag v2.28.6 → cd3fa17；CI 双绿：docker-hub 45135093938 ✅ test/smoke/publish 全 success；docker-tcr 45135094024 ✅ test/publish 全 success；test-main 45135073389 ✅ main 全链绿）**：EV 部署回归修复——`serve` 默认端口 8090→8080（与 compose 集装箱 8080 映射一致，消除 nginx 502；`WEB_PORT` 环境变量仍可覆盖）。**无 schema 变更、无新增依赖**。**服务器部署待执行**（按本文第 4 节升级到 2.28.6）。

**EZ + FA 已实现待发版（2026-11-23，实现 8eeb1f4；QA docs/QA-EZ-FA.md 第 1 轮 ✅ 通过 11 / 缺失 0 / 偏差 0 / 需人工确认 1=截图目视）**：EZ 个人资料页 Tab 版——`el-tabs` 三 Tab（基本信息 / Steam 账号（绑定+游戏库合并，每账号一行四操作：查看已拥有/查看愿望单/设为默认/解绑 + 底部绑定新账号）/ 偏好与统计（主题/邮件 + 三项统计））+ 保存/取消固定底部（Web 与手机端 sticky、三 Tab 共用同一表单）+ 手机端 Tab 横向滚动 + 全部按钮 el-button，原功能不变（头像/邮箱/简介/绑定/解绑/默认/主题/邮件/统计/未保存离开提示）；FA 用户菜单「切换账户」——菜单顺序与 demo 一致（个人资料/修改密码/返回网站 ↗/（分隔线）切换账户/退出登录，退出登录红字），切换 = POST /api/logout → `/login?switch=1`（提示「切换账户：已退出当前会话…」）→ 登录成功回原页面，退出登录保持回首页。验证：profile 15/15 + admin-console-ia 23/23 + auth-pages 14/14 + session-heartbeat 7/7 + frontend-registration 9/9 + 主链分段 test:1~4 全绿 + frontend:build ✓ + scan 干净 + headless Chrome 断言全过（三 Tab 切换、菜单顺序、sticky、横向滚动、全 el-button；截图 8 张在 `F:\dsh\ez-fa-shots\` 待所有者目视）。**无 schema 变更、无新增依赖**。

> 未完成事项的完整清单见 [TODO.md](TODO.md)。本节只记录版本与部署现状。
- **v2.27.8 已发布**（tag `v2.27.8`，release 提交见 git log）：ED + EH + EI + EL + EK + DX 六条合并发版（🧪 测试基建 1 + ⚙️ 调整 3 + 🐞 缺陷 1 + 🧹 技术债 1，均无新功能面 → 小版本，2.27.7 → 2.27.8 连续递增）。本批不涉及 App 仓库。
  ED（143d97e）：test-main 加文档路径忽略（`docs/**`、`**/*.md`、`CHANGELOG.md`、`data/**`）——纯文档提交不再触发/取消重跑 test-main；代码路径一律不忽略；docker-hub/docker-tcr 只在 tag 触发不动。
  EH+EI（897476c，**代码已随 v2.27.6 镜像成像，本批为 QA 通过后的补发版记录**）：同步逻辑去 cn（steam-status/discovery → cc=us）+ 双区域配置（`sync.contentRegion` 默认 us 内容拿全量 / `site.baseRegion` 默认 cn + `site.baseCurrency` 默认 CNY 价格本位币可配）。
  EL（e0821f9）：后台「添加/编辑」统一弹窗（IP 黑/白名单、站点通知、设置代理、申诉处理；纯前端改动，交互验证 20/20 + 截图 `F:\dsh\el-shots\{before,after}`）。
  EK（cc4fcf5）：App Release 同步资产下载支持专用代理（`network.appSyncProxy` / env `APP_RELEASE_SYNC_PROXY`，有代理走代理、无代理直连 GitHub，零新依赖）。
  DX（090af4c）：列表/站点接口性能优化（count 合并 + 列表 45s 短缓存 + /api/site 60s 缓存，详见本节「当前状态」）。
  QA：ED ✅ [QA-ED.md](QA-ED.md) 第 1 轮（4/0/0/0）/ EH+EI ✅ [QA-EH-EI.md](QA-EH-EI.md) 第 1 轮（9/0/0/2）/ EL ✅ [QA-EL.md](QA-EL.md) 第 1 轮（5/0/0/2）/ EK ✅ [QA-EK.md](QA-EK.md) 第 1 轮（6/0/0/1）/ DX ✅ [QA-DX.md](QA-DX.md) 第 1 轮（6/0/0/1）。
  验证（本机发版门禁）：相关测试 87 项全绿（sync-regions 4 / steam-status 17 / steam-meta 17 / adapters 6 / settings 15 / app-release-sync 7 / app-release 10 / admin-edit-dialog 6 / discovery 5）+ 主链分段 test:1~4 + `node test/api.test.js` + `frontend:build` + `scan`（输出随 release 提交记录）。
  **部署提示（本批）**：
  - **无 schema 变更、无新增依赖**——升级后直接可用。
  - **EH/EI 生效说明**：后台「系统设置 → 同步区域」保存后调度器约 **15 秒内生效**（`contentRegion=us` / `baseRegion=cn` 下一轮同步生效；内容链路下一轮即按 us 采集，价格链路保持 cn/CNY 口径）。
  - **EK**：线上配置 `APP_RELEASE_SYNC_PROXY` 或后台「App 同步专用代理」后，`app-release-sync` 资产下载走代理；未配置保持直连（现状）。
  - **DX**：部署后按本节「当前状态」的压测目标复测（列表/搜索 P95 ≤150ms、`/api/site` ≤50ms）。
  - **EF 的 `rating-backfill` 回填**若尚未执行，请一并提醒执行（cc=us 重采分级、只写分级不写价）。
  CI：docker-hub run **44706356922** ✅（test/smoke/publish 全 success）；docker-tcr run **44706356847** ✅（test/publish 全 success）；test-main（push）release 提交 `15acdc9` 的 run 44706158286 被并发 push 取消（2.28.0 会话高频提交），兜底绿 = run **44709985126** ✅（HEAD `ab7ba90` 含 release 提交，test success）。两个镜像源均已推送；镜像含 release 提交 `15acdc9`（DX 090af4c / ED 143d97e / EL e0821f9 / EK cc4fcf5 均在其祖先；EH+EI 897476c 已随 v2.27.6 成像），不含 tag 之后 2.28.0 会话的提交（归后续版本）。
  **服务器部署待执行**（按本文第 4 节升级到 `2.27.8`）。
- **v2.27.7 已发布**（tag `v2.27.7`，release 提交见 git log）：EJ 昵称显示规则统一（Web + App）（显示口径调整，无新功能面 → 小版本，2.27.6 → 2.27.7 连续递增）。
  全站「用户」展示统一为「昵称（trim 非空）? 昵称 : 用户名」：后台用户管理列表/卡片、登录会话、到价提醒（含候选/迁移下拉）、愿望单、Steam 操作日志「归属用户」、异常审核审阅人、前台「我的」菜单与 App「我的」账号卡；昵称清空回退用户名；用户管理去掉并列「显示名」列；认证与审计「操作者」仍用 username。
  同批修掉两处既有偏差：前台 Home/Console 误读 `user.display_name`（`/api/me` 返回 `displayName`）、App 头像首字对空白昵称不判空。
  QA：docs/QA-EJ.md 第 1 轮 ✅（5/0/0/0，两端截图 `F:\dsh\ej-shots`）。App 仓库同步发布 **app-v2.24.2（22402）**（Release 三资产 APK/sha256/latest.json 已建，模拟器覆盖安装 OK、版本号显示 2.24.2；站点 app-sync 待「立即同步」）。验证：相关测试全绿 + api.test.js 38/38 + frontend:build ✅ + scan ✅ + App assembleRelease ✅ + 单测 88/88。**CI 双绿**：docker-hub `44668966523`（test/smoke/publish 全 success）、docker-tcr `44668966463`（test/publish 全 success），test-main `44668944594` success（HEAD `7e24646`）。**服务器部署待执行**（按本文第 4 节升级到 2.27.7）。
- **v2.27.6 已发布**（tag `v2.27.6`，release 提交见 git log）：CO-5/B4-2 巨石拆分第九轮（admin 同步任务域，契约零变化）（技术债重构，无新功能面 → 小版本，2.27.5 → 2.27.6 连续递增）。
  第九轮 admin-sync（3997083）`src/routes/admin-sync.js`（管理段单入口 13 条路由——sync 3 / circuit 1 / backfill 3 / heat 3 / rename 3）+ `src/store/admin-sync-repository.js`（`listSyncRuns` 唯一专属 SQL 搬家；`insertSyncRun`/`finishSyncRun`/`runningSyncRun`/`markStaleSyncRuns`/`sourceSyncStats` 等跨域共用 SQL 留 `pg.js` + re-export 兼容壳）；`syncState` 持有对象与 `startSteamJob` 闭包按引用共享（「语义共享，勿改成拷贝」注释）；`src/server.js` 净 −205、`src/store/pg.js` 净 −8；**外部契约零变化**（路径/参数/响应/错误码不变）。已交付九域（app/appeal/auth/watchlist/announcements/me/site/admin-access/admin-sync），剩余域继续按 [B4-QUEUE.md](B4-QUEUE.md) 队列推进（下一域 #10 admin 系统设置）。
  QA：B4-2 第九轮 ✅ [QA-CO5-B4-2-admin-sync.md](QA-CO5-B4-2-admin-sync.md) 第 1 轮（14/0/0/1）；需人工确认项为本机沙箱环境限制（`frontend:build` 默认命令被拦，改用 native loader 变体），CI 兜底。
  验证（本机发版门禁）：`node test/sync-runs.test.js` 9/9（含本批新增四组静态锁与反向自检）+ `source-sync` 5/5 + `admin-cache` 3/3 + 主链 `npm run test:2` 全绿 + `node test/api.test.js` 38/38 + `docs.test` 5/5 + `frontend:build` ✓（3.12s，`--configLoader native` 变体；默认命令受本机沙箱 spawn 限制）+ `scan` 干净（1521 文件，无高置信度凭据）；本批零代码改动（仅发布文档 + 版本号），test:1/3/4 未本机重跑，由 CI 全量兜底。
  同期：**EH + EI 同步双区域配置化**（897476c，10:45 由其实施会话提交并推 main，QA docs/QA-EH-EI.md 第 1 轮 ✅ 放行 9/0/0/2）随本 tag 一并成像；其 TODO/INDEX/DONE 状态回写（已实现待发版 → 已发布 v2.27.6）归其实施/质检会话收尾，本构建会话未代写以免并发写入冲突。
  CI：docker-hub run 44664741632 ✅（test/smoke/publish 全 success）；docker-tcr run 44664741638 ✅（test/publish 全 success）；test-main（push）release 提交 52bb65a 的 run 44664716754 被并发 push 取消（EH+EI/EJ 会话随后提交），其后 test-main 连续被并发取消，兜底绿 = run 44668944594 ✅（最终 HEAD 7e24646 含 release 提交 52bb65a，test success）。两个镜像源均已推送；镜像含 EH+EI（897476c），不含 tag 之后的 EJ 提交（f340d78/51865de/8d72320/29e0d03），归 v2.27.7。
  **服务器部署待执行**（升级到 `2.27.6`；本批无 schema 变更、无新增依赖——升级后直接可用）。
- **app-v2.23.0 已发布**（tag `app-v2.23.0`，App 仓库 d803612；Release 三资产：`steamdeals-2.23.0.apk` + `.apk.sha256` + `latest.json`）：
  DY 页面衔接状态保存（搜索/首页/愿望单/我的进详情或切 Tab 返回保持状态，详情旋转不重拉，表单非敏感输入旋转/进程重建不丢）+ DZ 公告「全部已读」（角标立即消失、刷新/重启不复现、单条已读与游客↔登录合并保留）+ EA-1~6 体验包（下拉刷新/搜索空态/详情分享/版本号+清缓存/骨架屏/全局弱网提示）+ EB 18R 内容选项（18R chip + 18+ 角标 + 首次年龄确认 + 默认关闭本地记忆）。
  站点零改动（本批为 App 纯端功能，服务端 adult 参数已支持）。
  QA：DY/DZ ✅ [QA-DY-DZ.md](QA-DY-DZ.md) 第 2 轮（12/0/0/3）/ EA-1~3 ✅ [QA-EA-1-3.md](QA-EA-1-3.md) 第 1 轮（9/0/0/1）/ EA-4~6 ✅ [QA-EA-4-6.md](QA-EA-4-6.md) 第 1 轮（8/0/0/2）/ EB ✅ [QA-EB.md](QA-EB.md) 第 1 轮（8/0/0/2）。
  验证：App JVM 单测 78/78 全绿；`gradlew assembleRelease` ✓（2.23.0/22300，sha256 960cebfe…）；模拟器覆盖安装自测 ✓（2.22.0 → 2.23.0 覆盖安装成功、「我的」版本行 v2.23.0）。
  **同步提示**：所有者打开后台 → 同步与回填 → App 版本卡点「立即同步」（或等 15 分钟自动同步）后，手机即可见更新；本机只读核对 `curl -s https://sd.yyliucha.cn/api/app/latest`（返回 versionCode 22300 即同步完成）。
- **v2.27.2 已发布**（tag `v2.27.2`，release 提交见 git log）：CO-5/B4-2 巨石拆分第三轮（认证域，契约零变化）（技术债重构，无新功能面 → 小版本，2.27.1 → 2.27.2 连续递增）。
  CO-5/B4-2：认证域（00a838f）`src/routes/auth.js`（认证域 8 条路由——公开段 `POST /api/device` + 主段 `GET /api/captcha`、`POST /api/login`、`POST /api/password/check`、`POST /api/logout`、`POST /api/user/password`、`GET /api/auth/steam/start`、`GET /api/auth/steam/callback`）+ `src/store/auth-repository.js`（登录失败计数/锁定/改密/Steam 绑定 10 个 SQL 新函数）；`src/store/pg.js` re-export 兼容壳；`src/server.js` 认证区换为两入口接线（`loginIpFails`/`appealBucketLimited`/`bindStates` 共享状态留宿主）；**外部契约零变化**（路径/参数/响应/错误码不变）；已交付 app/appeal/auth 三域，剩余域拆分继续按 [B4-QUEUE.md](B4-QUEUE.md) 队列推进（watchlist 为下一域）。
  QA：B4-2 ✅ [QA-CO5-B4-2.md](QA-CO5-B4-2.md) 第 1 轮（16/0/0/1）。
  验证（本机发版门禁）：主链四段（`npm run test:1..4` 串行）+ `node test/api.test.js` + `frontend:build` + `scan`（输出随 release 提交记录）。
  CI：docker-hub run 44548428207 ✅（publish 全 success）；docker-tcr run 44548428173 ✅；test-main **run 44559097058 ✅**（最终 HEAD ededf38；v2.27.2 发布后的文档提交被 concurrency 取消，测试在最终 HEAD 回归通过）。
  **服务器部署待执行**（升级到 `2.27.2`；本批无 schema 变更、无新增依赖——升级后直接可用）。
- **v2.27.3 已发布**（tag `v2.27.3`，release 提交见 git log）：CO-5/B4-2 巨石拆分第四/五/六轮（watchlist/wishlist + announcements + me 三域，契约零变化）（技术债重构，无新功能面 → 小版本，2.27.2 → 2.27.3 连续递增）。
  第四轮 watchlist/wishlist 用户段（1b087b4）`src/routes/watchlist.js`（6 条路由）+ `src/store/watchlist-repository.js`（3 函数搬家 + 域内联 SQL 新函数，`watchUserFails` 限流 Map 随域移入，admin 段/steam-accounts 段留宿主）；第五轮 announcements（3022d6e）`src/routes/announcements.js`（公开段+主段+管理段，首个三段域）+ `src/store/announcements-repository.js`（/api/admin/bulk 派发表 announcements 三条目留 #11）；第六轮 me（4ed78db）`src/routes/me.js`（6 条路由）+ `src/store/me-repository.js`（`/api/me/email/*` 与 `/api/auth/email*` 同模块（DT-2 排除区）整块留 auth-routes.js）；`src/server.js` 三域净 −319、`src/store/pg.js` 净 −165；pg.js re-export 兼容壳零删改；**外部契约零变化**（路径/参数/响应/错误码不变）。已交付 app/appeal/auth/watchlist/announcements/me 六域，剩余域拆分继续按 [B4-QUEUE.md](B4-QUEUE.md) 队列推进（下一域 #7 杂项 site/steam/ban）。
  QA：B4-2 第四轮 ✅ [QA-CO5-B4-2-watchlist.md](QA-CO5-B4-2-watchlist.md) 第 1 轮（10/0/0/2）/ 第五轮 ✅ [QA-CO5-B4-2-announcements.md](QA-CO5-B4-2-announcements.md) 第 1 轮（16/0/0/2）/ 第六轮 ✅ [QA-CO5-B4-2-me.md](QA-CO5-B4-2-me.md) 第 1 轮（17/0/0/2）；需人工确认项均为本机沙箱环境限制（commit-own 测试 spawn EPERM、frontend:build 默认命令），CI 兜底。
  验证（本机发版门禁）：主链 test:2/3/4 全绿（test:1 仅 commit-own 4 项已知沙箱环境红、与拆分前基线一致）+ `node test/api.test.js` 37/37 + `frontend:build` ✓（1.89s，native loader 变体）+ `scan` 干净；三域工人各自全链测试与反向自检记录见各 QA 报告。
  CI：docker-hub run 44608440588 ✅（test/smoke/publish 全 success，20m10s）；docker-tcr run 44608440514 ✅（test/publish 全 success，18m20s）；test-main（push）run 44608412265 ✅（test success，release 提交 02d62aa 的 push 门禁，14m13s）。两个镜像源均已推送。
  **服务器部署待执行**（升级到 `2.27.3`；本批无 schema 变更、无新增依赖——升级后直接可用）。
- **v2.27.4 已发布**（tag `v2.27.4`，release 提交见 git log）：CO-5/B4-2 巨石拆分第七/八轮（site 杂项 + admin 访问安全两域，契约零变化）（技术债重构，无新功能面 → 小版本，2.27.3 → 2.27.4 连续递增）。
  第七轮 site 杂项（552fb40）`src/routes/site.js`（预检段 `GET /api/ban/state` + 公开段 `GET /api/site` + 主段 `/api/steam/*` 全 10 条）+ `src/store/site-repository.js`（3 函数搬家 + 域内联 SQL 新函数；`/api/admin/wishlists` 留 #16、`/api/admin/steam-logs` 留 #12）；第八轮 admin 访问安全（b3ebd8a）`src/routes/admin-access.js`（管理段单入口 20 条路由 + device-bans 3 条）+ `src/store/admin-access-repository.js`（15 函数搬家 + 4 内联 SQL 新函数；封禁拦截链/黑名单加载等中间件留 server.js）；`src/server.js` 两域净 −528、`src/store/pg.js` 净 −249；pg.js re-export 兼容壳零删改；**外部契约零变化**（路径/参数/响应/错误码不变）。已交付八域（app/appeal/auth/watchlist/announcements/me/site/admin-access），剩余域拆分继续按 [B4-QUEUE.md](B4-QUEUE.md) 队列推进（下一域 #9 admin 同步任务）。
  QA：B4-2 第七轮 ✅ [QA-CO5-B4-2-site.md](QA-CO5-B4-2-site.md) 第 1 轮（18/0/0/2）/ 第八轮 ✅ [QA-CO5-B4-2-admin-access.md](QA-CO5-B4-2-admin-access.md) 第 1 轮（20/0/0/1）；需人工确认项均为本机沙箱环境限制（commit-own 测试 spawn EPERM、frontend:build 默认命令），CI 兜底。
  验证（本机发版门禁）：主链 test:2/3/4 全绿（test:1 仅 commit-own 4 项已知沙箱环境红、与拆分前基线一致）+ `node test/api.test.js` 37/37 + `frontend:build` ✓（native loader 变体）+ `scan` 干净；两域工人各自全链测试与反向自检记录见各 QA 报告。注：本轮因主树被 EG/EF 会话占用，构建在独立 worktree（nightshift-v2274，基 b3ebd8a）执行，主树未动。
  CI：docker-hub run 44643406573 ✅（test/smoke/publish 全 success）；docker-tcr run 44643406627 ✅（test/publish 全 success）；test-main（push）release 提交的 run 44643381231 被 EF/EG 会话并发 push 取消（concurrency 组，ED 已知问题），兜底绿 = run 44644311190 ✅（HEAD 938c4f6 含 release 提交 3b8e93e，test success）。两个镜像源均已推送；镜像不含 tag 之后 EF/EG 的三提交（7a3ac2b/938c4f6/7eb5d4a），归下个版本。
  **服务器部署待执行**（升级到 `2.27.4`；本批无 schema 变更、无新增依赖——升级后直接可用）。
- **v2.27.5 已发布**（tag `v2.27.5`，release 提交见 git log）：EF 18R 数据同步与筛选修复 + EG 公告角标已读修复（均为 🐞 缺陷修复 → 小版本，2.27.4 → 2.27.5 连续递增）。App 仓库同步发布 **app-v2.24.1（22401）**（app-v2.24.0 的 tag 被 GitHub 不可变 Release 机制永久锁死——曾有同名 Release 创建后被删，升 2.24.1 重建发布，Release 三资产已建）。
  EF（7a3ac2b）：元数据 `appdetails` 请求 `cc=cn` → `cc=us`（价格口径调用点保持 cc=cn）；新增 `rating-backfill` 命令（cc=us 重采分级、只写分级不写价、限速 ≥1s、429 收轮 exit 75、前后 adult/mature 计数日志、断点续跑）+ 并入调度器；前台 `/api/games` 支持 `rating=adult|mature|none`；Web 首页 18R 筛选开关（badge+rating=adult，取消恢复全部，18+ 角标）；App 仓库 358ebc5 同步改筛选语义。
  EG（7eb5d4a）：`GET /api/announcements` 公开段补 Bearer 解析——此前 readIds 只认 Cookie 会话，App 登录用户恒拿空数组 → 已读标记虽落库但每次刷新/重进/重启角标回跳；App 仓库 3458bce 标记纪元守卫（陈旧快照只并集不覆盖、会话切换快照作废）。
  QA：EF ✅ [QA-EF.md](QA-EF.md) 第 1 轮（13/0/0/3）/ EG ✅ [QA-EG.md](QA-EG.md) 第 1 轮（3/0/0/0）。
  验证（本机发版门禁）：announcements 8/8 + steam-meta 16/16 + scheduler 38/38 + app-contract 2/2 + `node test/api.test.js` 38/38 + 主链 `npm test` 全绿（退出码 0，&& 串行）+ `frontend:build` ✓（3.59s）+ `scan` 干净；App 单测 83/83 + `assembleRelease`（签名指纹 48A3…7A05 与 README 一致）+ 模拟器覆盖安装自测（2.22.0→2.24.0 ✓、版本号 2.24.0 ✓、18R 开关确认记忆 ✓、角标全部已读归零 + 重启不复现 ✓）。App 最终以 app-v2.24.1（22401）发布：仅版本号变更（app-v2.24.0 tag 被不可变 Release 机制锁死的应急，代码零变化），2.24.1 单测 83/83 + assembleRelease 复验 ✓。
  CI：docker-hub run 44656117747 ✅（test/smoke/publish 全 success）；docker-tcr run 44656117688 ✅（test/publish 全 success）；test-main（push）run 44656695975 ✅（最终 HEAD 526fa72 含 release 提交 8b53782，test success，12m0s）。两个镜像源均已推送；镜像不含 tag 之后监工的 #9 域拆分（3997083）与 EH/EI/EJ 文档提交，归下个版本。
  **部署提示（重要）**：服务器升级到 `2.27.5` 后**执行一次 `node src/cli.js rating-backfill`**（cc=us 重采分级，限速 ≥1s、429 收轮 exit 75、可断点续跑）——回填后 adult 游戏数应显著增加（>20，前后计数日志可核对）；EF 已并入调度器，日常增量由 `steam-meta` 任务维持。**EG 无迁移**（无需数据命令）。
  **服务器部署待执行**（升级到 `2.27.5` 并执行 rating-backfill 一次；App 版本卡点「立即同步」后手机即可更新 app-v2.24.1（22401，替代被锁死的 2.24.0））。
- **v2.27.1 已发布**（tag `v2.27.1`，release 提交见 git log）：CO-4/B4 巨石拆分两域（试点 App 域 + 第二轮申诉域）+ DW 搜索关键词参数位错位修复合并发版（技术债重构 + 缺陷修复，无新功能面 → 小版本，2.27.0 → 2.27.1 连续递增）。
  CO-4/B4：试点 App 域（0c8f5ff）`src/routes/app.js`（App 域 6 条路由）+ `src/store/app-repository.js`（`api_tokens` DDL + 4 个 token 函数）；第二轮申诉域（34a7bcc）`src/routes/appeal.js`（申诉域 5 条路由：公开段 + 管理段）+ `src/store/appeal-repository.js`（`appeals` DDL + 12 个申诉 SQL 函数）；`src/store/pg.js` 两域 re-export 兼容壳；`src/server.js` 试点 -216 行、第二轮再 -267 行（域路由换为入口接线，appealExempt 豁免与限流桶等中间件留原地）；**外部契约零变化**（路径/参数/响应/错误码不变）；已交付 app/appeal 两域，剩余 ~18 个域拆分另行立项（B4-2/CO-5）。
  DW：`gameSearch` 关键词归一化拆两个显式变量（`kwNormCandidate` 供候选探测/fuzzy、`kwNorm` 供主查询），注释约束两者不可互换（互换 = 精确名 LIKE 匹配 cap/42P18，新测试必红）；`filterParams` 顺序不变、候选查询绑定不变；新增 `test/game-search-exact.test.js` 进主链 test:3（精确名命中/region 值不命中/回归/零命中 + 注入错位反向自检）。
  QA：B4 ✅ [QA-CO4-B4.md](QA-CO4-B4.md) 第 1/2 轮（16/0/0/1）/ DW ✅ [QA-DW.md](QA-DW.md) 第 1 轮（6/0/0/1）。
  验证（本机发版门禁）：主链四段全绿（`npm run test:1..4` 串行，合计 1020 通过 / 0 失败——B4 涉及全部路由故跑全量主链；DW 搜索用例在 test:3 的 `game-search-exact.test.js` 4/4）+ `node test/api.test.js` 37/37 + `frontend:build` ✓（2.25s）+ `scan` 干净（699 文件，无高置信度凭据）。
  CI：docker-hub run 44519906810 ✅（test 21m23s——含 coverage/perf 门禁全绿 / smoke 36s / publish 全 success）；docker-tcr run 44519906872 ✅（test 21m23s / publish 10m29s、Verify manifests 全绿）；test-main（push）run 44519850643 ✅（test success，release 提交 466f4c4 的 push 门禁）。两个镜像源均已推送。
  **部署提示**：本批**无 schema 变更、无新增依赖**——升级后直接可用，无需迁移/首次回填等一次性关注项；部署后按 DW 规格 §DW 线上复验「侠盗猎车手」精确名搜索。
  **服务器部署待执行**（升级到 `2.27.1`）；发版后 e2e 全量由独立报告会话按 steamdeals-test §2.3 执行（PDF 落 `F:\dsh\e2e-reports\`），不在本会话跑。
- **v2.27.0 已发布**（tag `v2.27.0`，release 提交见 git log）：DP（实现 24780ef）+ DQ（站点 e62fb4e/a1af397 + App 795c791）+ DN（实现 0c5fde4）+ DR（站点 39aaebb + App 仓库 98dabca）+ DS（实现 d607e27）+ DL（实现 1e49eeb）合并发版（含新功能面 DS 搜索派生 / DL 快照落库 / DR 后台立即同步 → 大版本，2.26.0 → 2.27.0 连续递增）。App 仓库同步发布 **app-v2.22.0（22200）**。
  DP e2e 默认浏览器 Edge → Chrome（探测顺序 Program Files Chrome → PF(x86) Chrome → PATH chrome → 回退 Edge 并提示；预检/报告/PDF 打印走 Chrome）；DQ 个人资料页打磨（`users.default_steam_id` + 迁移、头像只认 custom 否则首字+品牌色、账号卡两行按钮/统计三项/开关副说明，Web + App）；DN 内容词 SKU 默认归档（季票/服装/DLC 自动 ignored 不进待对齐队列、不占计数、可恢复）；DR App 发版后即刻可更新（`POST /api/admin/app-sync` + 「App 版本卡」立即同步、同步间隔默认 15 分钟可配热加载、App 节流 24h→1h）；DS 搜索全自动派生（`search_tokens` 缩写/罗马数字/拼音 + 三级排序 + 模糊兜底，零人工）；DL 对齐审核快照落库（`align_snapshots` + 数据签名动态失效 + 操作同事务更新快照——重启即读、确认后旧列表不再出现）。
  QA：DP ✅ [QA-DP.md](QA-DP.md) 第 1 轮（4/0/0/0）/ DQ ✅ [QA-DQ.md](QA-DQ.md) 第 1 轮（9/0/0/3）/ DN ✅ [QA-DN.md](QA-DN.md) 第 1 轮（10/0/0/1）/ DR ✅ [QA-DR.md](QA-DR.md) 第 1 轮（8/0/0/2）/ DS ✅ [QA-DS.md](QA-DS.md) 第 1 轮（5/0/0/3）/ DL ✅ [QA-DL.md](QA-DL.md) 第 1 轮（9/0/0/0）。
  验证（本机发版门禁）：本批相关测试全绿（search-derive 10/10、game-search-alias 9/9、align-snapshot 10/10、profile 8/8、align 11/11、align-perf 14/14、app-release-sync 6/6、settings 13/13、scheduler 38/38、http-guard 7/7，合计 126 项）；主链四段全绿（test:1 27.7s / test:2 50s / test:3 53s / test:4 26s）；`node test/api.test.js` 37/37；`frontend:build` ✓（2.23s）；`scan` 干净（无高置信度凭据）；e2e:smoke Chrome 冒烟 7/8 ✅（浏览器确认为 Chrome；admin-login 行失败为 CX 批 UserAvatar 既有 /api/avatar/1 404，与 QA-DP 记录一致、非本批引入）；App 侧 gradlew assembleRelease ✓（2.22.0/22200，sha256 bf58b548…）+ GitHub Release app-v2.22.0 三资产（APK/sha256/latest.json）。
  CI：docker-hub run 44482586439 ✅（test / smoke / publish 全 success）；docker-tcr run 44482586460 ✅（test / publish 全 success）；test-main（push）run 44482543699 ✅（test success，release 提交 5b7889a 的 push 门禁）。两个镜像源均已推送。
  **部署提示（首次启动一次性成本，部署人员注意）**：
  ① DL：migrate 新建 `align_snapshots` 表；`align-snapshot` 任务首轮延迟 30 秒自动生成首份快照——首轮前页面会显示一次「首次生成中」，之后签名不变零重算；
  ② DS：migrate 新建 `search_tokens` 列 + GIN 索引；`search-tokens-rebuild` 增量回填任务首轮会扫全库（约 19.8 万行），首轮可能耗时较长，之后每 6 小时只补增量（≤5 万行）；
  ③ DR：`APP_RELEASE_SYNC_INTERVAL_MIN` 默认 15 分钟生效（原 60）；后台「同步与回填 → App 版本卡」出现「立即同步」按钮。
  **服务器部署待执行**（升级到 `2.27.0`）；**App 升级路径**：app-v2.22.0 不依赖本批站点新接口（DQ 头像规则、DR 节流均为 App 本地行为），可先升级；站点 v2.27.0 部署后点后台「立即同步」即可即刻推送更新（部署前由 15 分钟自动同步兜底）；发版后 e2e 全量由独立报告会话按 steamdeals-test §2.3 执行（PDF 落 `F:\dsh\e2e-reports\`），不在本会话跑。
- **v2.26.0 已发布**（tag `v2.26.0`，release 提交见 git log）：CU 四项（CU-1 实现 b5f5663 + 恢复 77c9f8f / CU-2 实现 b7ab402 / CU-3 规格 §6 附录 / CU-4 规格 §7 附录）+ DF（578f063）+ CO-4/D4（56d8573）+ CO-4/D6（40517d5）+ CO-4/E4（551f4b1 + e5cfef1）合并发版（含新功能面 CU-2 迁移与 DF 手动推送 → 大版本，2.25.0 → 2.26.0 连续递增）。
  CU-1 后台「到价提醒」无报价徽标 + 状态筛选（无在售报价行标「无报价」、不触发提醒）；CU-2 站点级提醒按 Steam 愿望单反查候选用户（多用户全列、去重）+ 一键迁移给用户（同游戏已有行合并删站点级）+ 批量删除（全审计）；CU-3 史低抽检结论（规格 §6 附录 SQL + 结论清单，分析类无代码，部落幸存者 ¥20.25 确认真实促销史低）；CU-4 Steam 刷新频率评估（规格 §7 附录：720 可接受 / 480 不推荐，未改任何配置）；DF 到价提醒手动推送（后台每行「推送」+ 确认弹窗、强制推送、mark 默认勾选、批量「推送选中」合并一封邮件、5 分钟频控 429、无通道禁用、审计 `admin.alert_pushed`）；CO-4/D4 移动/桌面双结构渐进合并（列表区共享 DOM + CSS 双态，v-if 77→38 行，四态截图像素零差异）；CO-4/D6 覆盖率/性能基线门禁（CI 两个 workflow test job 挂 coverage/perf 阈值 + e2e 报告联动）；CO-4/E4 日志统一字段规范（scheduler/adapter/ingest 失败事件统一 reason/url/status + 告警阈值，[LOGGING-SCHEMA.md](LOGGING-SCHEMA.md)）。
  QA：CU-1 ✅ [QA-CU1.md](QA-CU1.md) 第 2 轮（3/0/0/1）/ CU-2 ✅ [QA-CU2.md](QA-CU2.md)（5/0/0/2）/ CU-3 ✅ [QA-CU3.md](QA-CU3.md)（4/0/0/2）/ CU-4 ✅ [QA-CU4.md](QA-CU4.md)（4/0/0/1）/ DF ✅ [QA-DF.md](QA-DF.md) 第 1 轮（9/0/0/2）/ D4 ✅ [QA-D4.md](QA-D4.md) 第 1 轮 / D6 ✅ [QA-D6.md](QA-D6.md) 第 1 轮 / E4 ✅ [QA-CO4-E4.md](QA-CO4-E4.md)（4/0/0/1）。
  验证（本机发版门禁）：本批相关测试全绿（watchlist-noprice 3/3、alert-push 9/9、log-schema 3/3、baseline-gate 5/5、style-tokens 3/3）+ `node test/api.test.js` 33/33 + `frontend:build` ✓（3.04s）+ `scan` 干净（665 文件，无高置信度凭据）；主链四段 test:1/test:2/test:3 全绿、test:4 在本机多会话并发高负载（CPU 100%）下三次出现不同文件的环境干扰性偶发失败（images 耗时断言 225/169ms vs 160ms 阈值、isolation claim 偶发 500、deploy 偶发 428），各单独重跑全绿（images 10/10、isolation 7/7、deploy 23/23），本批提交零代码改动（仅文档+版本号），CI 干净环境全量主链已全绿兜底。
  CI：docker-hub run 44458557600 ✅（test 19m36s——含 coverage/perf 门禁全绿 / smoke 31s / publish 2m4s）；docker-tcr run 44458557753 ✅（test 16m4s / publish 8m13s、Verify manifests 全绿）。两个镜像源均已推送。
  **服务器部署待执行**（升级到 `2.26.0`）；发版后 e2e 全量由独立报告会话按 steamdeals-test §2.3 执行（PDF 落 `F:\dsh\e2e-reports\`），不在本会话跑。
- **v2.25.0 已发布**（tag `v2.25.0`，release 提交见 git log）：CO-1/A3（6a9ecc3）+ CO-2/B3（7a324b0）+ CQ（6850e5b + 修复 b705824/50f5e45）+ CW（随 b9811f8 入 main）+ CX（随 b9356aa/93e1241/2f01b59 入 main + App 6f68e81）+ CY（3351f9f）+ CZ（站点 ac52955 + App 7c01820）+ DA（站点 b46669a + App 4334823）+ DC（App ef17e9a）+ DH（d3c67ec + cc8e351）+ DK（站点 d65542f + App 8fb6328）合并发版（含新功能条目 → 大版本，2.24.5 → 2.25.0 连续递增）。
  CQ 系统设置信息架构（6 平台卡/折叠摘要/只看非默认/来源标注/恢复默认/搜索展开）；CW 后台游戏详情弹窗（站内已同步 Steam 数据 + Steam 商店跳转，三态兜底）；CX 个人资料编辑（头像存库/双 Steam 账号默认头像/我的游戏库与统计，Web + App）；CY 数据隔离（用户私有数据管理员只读，越权写 403 + 审计）；CZ 更换登录邮箱（两步验证码、全会话下线、双邮件、24h 频控，Web + App）；DA App 筛选/排序服务端化（4 开关互斥 + heat/release 排序，App 依赖本批站点参数）；DC App 公告角标与列表（游客本地已读）；DH 对齐审核数据完整性（继承缺口/已忽略恢复/审阅痕迹/孤儿行提示）；DK App 检查更新失败修复（apkPath 兜底 GitHub 直链 + App 提示区分 + APK 缺失自愈）；A3 双真相源收敛（库唯一真相、skus.json 只读兼容）；B3 任务预算实测化（sync_runs 实测折算 + 任务卡实际/估算差）。
  QA：A3 ✅ [QA-CO1-A3.md](QA-CO1-A3.md)（25/0/0/0）/ B3 ✅ [QA-CO2-B3.md](QA-CO2-B3.md)（15/0/0/1）/ CQ ✅ [QA-CQ.md](QA-CQ.md) 第 3 轮（9/0/0/2）/ CW ✅ [QA-CW.md](QA-CW.md)（11/0/0/2）/ CX ✅ [QA-CX.md](QA-CX.md)（14/0/0/1）/ CY ✅ [QA-CY.md](QA-CY.md)（6/0/0/0）/ CZ ✅ [QA-CZ.md](QA-CZ.md)（11/0/0/2）/ DA ✅ [QA-DA.md](QA-DA.md)（6/0/0/2）/ DC ✅ [QA-DC.md](QA-DC.md) / DH ✅ [QA-DH.md](QA-DH.md) 第 2 轮 / DK ✅ [QA-DK.md](QA-DK.md)（6/0/0/2）；多会话并行审计 [AUDIT-2026-11-19.md](AUDIT-2026-11-19.md)（改坏项已全部恢复；本批补其 §③遗漏 1——`test/isolation.test.js` 注册进主链 test:4）。
  验证（本机发版门禁）：主链分段 test:1~test:4 全绿 + `node test/api.test.js` 33/33 + `frontend:build` ✓（1.87s）+ `scan` 干净（658 文件，无高置信度凭据）；App 侧 gradlew assembleRelease ✓（签名指纹 48a30df9… 与 app-v2.20.0 Release 一致）+ 模拟器覆盖安装 2.21.0/22100 启动正常 + 站点 app-sync 后 `/api/app/latest` 返回 22100。
  CI：docker-hub run 44419810208 ✅（test 20m45s——含 coverage/perf 门禁首跑全绿 / smoke 39s / publish 3m31s）；docker-tcr run 44419810182 ✅（success）。两个镜像源均已推送。
  **服务器部署待执行**（升级到 `2.25.0`）；**App 升级路径**：app-v2.21.0 依赖本批站点 `/api/games` 参数（DA）——先部署站点 v2.25.0，再提示用户升级 App（详情见 [APP-FILTER-SERVER-SIDE.md](APP-FILTER-SERVER-SIDE.md) §4）；发版后 e2e 全量由独立报告会话按 steamdeals-test §2.3 执行（PDF 落 `F:\dsh\e2e-reports\`），不在本会话跑。
- **v2.24.5 已发布**（tag `v2.24.5`，实现 afc5a91 + 12a6de7 / 3acd1b8 / c87dfe0 / 5b1cbfb / c4e2695 / 2ee09af）：DG + DI + DJ + CO-1/A5 + CO-2/B5 + CO-4/D1 合并发版（无新功能面 → 小版本）。
  DG 对齐匹配修复（候选索引补 `name_en` + 副标题感知——主标题命中 0.90–0.93 + 「副标题」理由、只进人工，断箭组恢复候选）；
  DI 测试环境隔离与主链分段（`APP_DATA_DIR` 注入隔离 + `test:1`~`test:4` 四段 + `test:reset` 白名单复位）；
  DJ e2e 整轮 20 分钟总预算（到点「预算截断」照常出报告、退出码三态）+ 发版测试报告独立会话流程（steamdeals-test §2.3）；
  CO-1/A5 同步任务失败可见（健康条显红 + 失败原因 + 可选邮件告警，`app-release-sync` 真失败不再静默）；
  CO-2/B5 读模型双写一致性守卫（唯一写入网关 + 增量对账 + 每日自动修复）；
  CO-4/D1 设计 token 收敛（四族 CSS 变量 + 三个最重组件按 token 引用，视觉零变化）。
  QA：DG ✅ [QA-DG.md](QA-DG.md) 第 1 轮 / DI ✅ [QA-DI.md](QA-DI.md) 第 1 轮 / DJ ✅ [QA-DJ.md](QA-DJ.md) 第 1 轮 / A5 ✅ [QA-CO1-A5.md](QA-CO1-A5.md) 第 1 轮 / B5 ✅ [QA-B5.md](QA-B5.md) 第 1 轮 / D1 ✅ [QA-D1.md](QA-D1.md) 第 1 轮。
  验证（本机发版门禁，干净 worktree @ 271f65a）：主链四段全绿（test:1 212 / test:2 271 / test:3 210 / test:4 208，共 901 通过 0 失败）+ `node test/api.test.js` 31/31 + `frontend:build` ✓（2.89s）+ `scan` 干净；本批针对性测试全绿（match 47 / align 6 / serve 12 / budget 7 / scheduler 32 / game-search-read-model 12 / read-model-guard 2 / style-tokens 3）。
  CI：docker-hub run 44322883908 ✅（test 10m11s / smoke 45s / publish 全绿）；docker-tcr run 44322883903 ✅（test 7m42s / publish 16m38s、Verify manifests 全绿）。
  **服务器部署待执行**（升级到 `2.24.5`）；发版后 e2e 全量由独立报告会话按 steamdeals-test §2.3 执行（PDF 落 `F:\dsh\e2e-reports\`），不在本会话跑。
- **v2.24.4 已发布**（tag `v2.24.4`，实现 9312054 / 75a7e7f / a54be76 / 89c8dfd / 318e678 + 729d0e9）：CP + CT + CO-2（B1/B2）+ CO-3（C2/C4/C5）+ DE 合并发版。
  CP 手机端识别三信号（UA 品牌特征 + `Sec-CH-UA-Mobile` + index.html `screen.width<=640` 兜底，小米桌面 UA 不再漏判）；
  CT app-release-sync 改 releases 列表接口（第一条非 draft/prerelease、latest 兜底、匿名可用、失败日志区分）；
  CO-2/B1 统一 15s 请求超时（长连接白名单豁免）+ 重型接口并发闸（admin 游戏列表/对齐 ≤1、公开搜索共用 ≤2，排队满/超时 503）；
  CO-2/B2 admin 列表提速（三索引 + 两端点 3s 短缓存与写失效，契约不变，压测列表 SQL -92%）；
  CO-3 C2 `/api/app/*` 设备维度限流（`X-Device-Id` 滑动窗口，超限 429 不封禁 + 审计）/
  C4 日期金额统一 helper（后端 format.js + 前端 money.js）/ C5 APP-API 契约漂移 CI 逐字段守卫；
  DE 对齐审核页按 demo 改版（状态徽标/统计卡/进度条/搜索筛选/批量确认忽略/空态互斥；接口 202 `total`+`cachedRows`+`failed`、200 `counts`、批量 `keys`）。
  QA：CP/CT/CO-2 ✅ [QA-CP-CT-CO2.md](QA-CP-CT-CO2.md) 第 1 轮（通过 15/需人工确认 2）；CO-3 ✅ [QA-CO3.md](QA-CO3.md) 第 1 轮（放行）；DE ⚠️ 有条件放行 [QA-DE.md](QA-DE.md) 第 1 轮（通过 7/偏差 1 已修/需人工确认 1）。
  验证（本机发版门禁）：本批相关测试全绿（frontend-mobile / serve / app-release / app-release-sync / http-guard / admin-cache /
  app-device-ratelimit / format / money-format 全过，align-perf 22/22、align 6/6、settings 8/8、setup 4/4、app-contract 2/2、
  api.test.js 31/31）；`frontend:build` ✓（1.59s）；`scan` 干净。
  CI：docker-hub run 44281749460 ✅（test 7m40s / smoke 34s / publish 1m56s 全绿）；docker-tcr run 44281749459 ✅（test 6m10s / publish 6m3s 全绿）。
  **服务器部署待执行**（升级到 `2.24.4`）；部署后待所有者确认：① 红米真机 CP 验收 + 线上四组 UA 复测；② DE 移动端与 demo 整体视觉一致性目视、线上首刷 202 stale 与失败重试闭环；③ B1 超时白名单范围、B2 生产 PG 同口径复核。
- **v2.24.3 已发布**（tag `v2.24.3`，站点 2a03188/cbb3a02 + App 仓库 0945006/65eaa5d）：P0 双修——
  CS：对齐审核后台生成（冷缓存 202 {generating,processed,total} + 前端 3s 轮询，完成后自动展示；预算只约束匹配循环、
  后台算完为止不再 partial 空结果；slow_query 增 eventLoopLagMs）；CV：所有查询不排除已拥有（Web/App 列表与搜索
  owned=include、已拥有账号名徽标与详情终态、App 详情账号列全）。QA ✅ [QA-CS-CV.md](QA-CS-CV.md) 两轮（通过 12/需人工确认 2）。
  CI：docker-hub run 44250653459 ✅（test/smoke/publish 全绿，10m57s）；docker-tcr run 44250653465 ✅（test/publish 全绿，23m50s）。
  **服务器部署待执行**（升级到 `2.24.3`）；部署后：① 打开「对齐审核」应显示「后台生成中（已处理 X/Y 组）」，完成后完整队列（不再暂无数据）；
  ② 计算期间观察其它接口不卡顿；③ 登录已拥有账号验证 Web/App 列表与搜索可见已拥有游戏、详情只留「去 Steam 商店」+ 账号名；④ App 真机目视徽标/终态。
- **v2.24.2 已发布**（tag `v2.24.2`，提交 9dd508e）：v2.24.1 升级后线上 bootstrap 崩溃重启循环（`invalid input syntax for type json`）。
  根因：CR 清洗迁移用 `::jsonb` 解析 `{` 开头元素，生产存在 `{CRYTIME}`/`{COMPANY_NAME_GOES_HERE}`/`{uni}` 等占位符非 JSON 元素。
  修复：纯正则提取 `"name":"…"`（永不抛错）+ WHERE 收紧为 `"name":` 特征（幂等稳定）；回归用例锁定事故形态 + 反向自检。
  QA：✅ [QA-CR-fix.md](QA-CR-fix.md) 第 1 轮。CI：docker-hub run 44230529201 ✅（test/smoke/publish 全绿，10m6s）；docker-tcr run 44230529276 ✅（test/publish 全绿，16m40s）。
  **服务器部署待执行**（升级到 `2.24.2`；若站点仍在崩溃循环先回滚 v2.24.0 止血）；部署后：容器启动 migrate 不报错、
  启动后站点正常；CR 清洗在首次 migrate 已完成（生产 `"name":` 元素已 0），残留占位符 4 个元素按设计保留（App 端兜底不显示）。
- **v2.24.1 已发布**（tag `v2.24.1`）：CN 批 P0 热修——对齐审核查询拖垮站点（线上 504 + 容器重启）：
  `GET /api/admin/align` 改为「后台计算 + 缓存读」——结果缓存 TTL 10 分钟（`src/align-query.js` createAlignRunner，
  实例级跨请求共享）+ single-flight（并发只算一次）+ `?refresh=1` 强制重算 + confirm/ignore 后失效；
  候选预筛（`src/match.js` 归一化全等快路径 + 信息 token 召回、共享数降序截断 ≤2000，口径零变化）；
  匹配循环每 200 组 `setImmediate` 分片 + 20s 预算（超时返回 `partial:true` 不 5xx）；
  接口分页 `page/pageSize=20`（`parseAlignPage` 回落）+ 前端生成时间/缓存状态/partial 提示、刷新强制重算。
  详见 [ALIGN-QUERY-PERF.md](ALIGN-QUERY-PERF.md)。
  验证：`npm test` 主链全绿（97 文件 815 用例，新增 test/align-perf.test.js 13 项进主链，反向自检 2 处）、
  `frontend:build` ✓、`scan` 干净；HTTP 冒烟：缓存命中 7ms ≤200ms、45 组分页、计算期间 `/api/games/count` 与 `/api/site` 并发 200。
  质检：CN ✅（[QA-CN.md](QA-CN.md) 第 1 轮，通过 7 / 需人工确认 4：部署后 P95 观察 / 零 token 标题边界抽查 /
  confirm-ignore HTTP 级复验 / 前端页面目视）。
  **CR 批同随本版本发布**（实现 5673ee9 + 2b5f88b）：开发商/发行商名称脏数据修复（GetItems 归一化 + 迁移幂等清洗历史脏元素 +
  契约字符串数组）；QA ✅（[QA-CR.md](QA-CR.md) 第 1 轮，通过 7 / 需人工确认 2：部署后脏行统计归零 + 抽查 3 款游戏）。
  CI：docker-hub run 44221597594 ✅（test/smoke/publish 全绿，13m14s）；docker-tcr run 44221597447 ✅（test/publish 全绿，13m20s）。
  **服务器部署待执行**（升级到 `2.24.1`）；部署后：① 打开「对齐审核」两次，第二次应 ≤200ms 且显示「缓存」；
  ② 点「刷新」观察重算与 partial 提示；③ 计算期间观察其它页面/接口不卡顿、容器不再重启；
  ④ CR：查脏行统计（如 `games` 里 developers/publishers 含 `{` 的行数）应归零，抽查黎明杀机等 3 款详情显示纯名称。
- **v2.24.0 已发布**（tag `v2.24.0`）：CK 批 e2e 测试套件（`test/e2e/` 功能矩阵 49 行 + runner + 8 个 lib，
  零新增运行时依赖）+ CM 批 App 功能补齐（站点侧：e2e 矩阵 4 行与文档；App 仓库 `steamdeals-app` v2.20.0
  独立发布，app-v2.20.0 tag 等所有者指令）。详见 [TESTING-E2E.md](TESTING-E2E.md) / [E2E-SUITE.md](E2E-SUITE.md) / [APP-PARITY.md](APP-PARITY.md)。
  验证：`npm test` 主链全绿、`frontend:build` ✓、`scan` 干净、`api.test.js` ✓；
  `npm run e2e` 全量 42 通过/0 失败/3 环境 skip（186s，PDF `F:\dsh\e2e-reports\`）、`npm run e2e:smoke` 8/8（38s）。
  质检：CK ✅（[QA-E2E-SUITE-CK.md](QA-E2E-SUITE-CK.md) 第 1 轮，通过 6/需人工确认 0）；CM ✅（[QA-CM.md](QA-CM.md) 第 1 轮）。
  CI：docker-hub run 44083043810 ✅（test/smoke/publish 全绿）；docker-tcr run 44083043852 ✅（test/publish 全绿）。
  **服务器部署待执行**（升级到 `2.24.0`；e2e 套件的 `--online --expect-version=2.24.0` 公网只读验收在部署后跑）。
- **v2.23.0 已发布**（tag `v2.23.0`，提交 e196382）：CL 批——到价提醒改为用户级：
  详情页三段式操作区（购买 / 我的标记 chips / 到价提醒区块：参考行 + ¥ 输入 + 「按史低」「减 10%」+ 保存，
  已设置绿色 pill「提醒中 ¥X」+ 取消；移动端折叠一行）+「到价提醒」列表页（桌面 tab + 移动「提醒」，分页 20、取消即移除、空态引导）；
  已拥有改为终态（只认绑定 Steam 库并集，`user_game_flags.owned` 不再参与口径）：显示全部账号名、只留「去 Steam 商店」、
  其余互动按钮全隐藏（管理员同），库同步发现已拥有自动删该用户的愿望单行与提醒行；
  提醒按用户分组发信（收件人 = 本人邮箱、同用户多游戏合并一封、无邮箱跳过记 `alert.skipped_no_email`、站点级行为不变）；
  后台新增「到价提醒」全站清单（分页 + 用户名筛选 + 删除确认，按提醒 id 清理 + 审计 `api.watch_deleted`）。
  验证：`npm test` 全链绿（新增 test/watchlist-user.test.js 8 项进主链）、`frontend:build` ✓、`scan` ✅。
  质检：CL ✅（[QA-CL.md](QA-CL.md) 第 1 轮，通过 8 / 需人工确认 2：部署后 UI 目视（demo 对照）+ 邮件实发）。
  CI：docker-hub run 44069918147 ✅（test/smoke/publish）；docker-tcr run 44069918129 ✅（test/publish）。
  **服务器部署待执行**（升级到 `2.23.0`）；部署后：① 详情页三段式与 demo 逐屏目视（桌面/移动/已拥有终态）；
  ② 绑邮箱账号设目标价跑 `alerts --mark` 观察本人邮箱收件与无邮箱跳过日志；③ 后台全站清单抽查删除审计。
- **v2.22.1 已发布**（tag `v2.22.1` → bb1318b）：CJ 现场回归修复——`/api/app/latest` 的 apkPath 按文件真实存在性三级派生
  （`data/app`（GitHub 每小时同步）优先 `/app/dl/<ver>.apk`，否则镜像内 `app/<ver>.apk` 存在则回落 `/app/<ver>.apk`，
  都没有返回 null）；`/app/dl/<file>` 文件不存在时 **302** 兜底到 `/app/<file>`；`/app/dl/` 路由从静态资源分支之后移到之前
  （原位置为死代码——任何请求都先落到 serveFrontendStatic，是线上 404 的直接原因之一）；`APP_DATA_DIR` 环境变量作测试隔离。
  回归断言进 `test/serve.test.js`「CJ-回归」用例（data/app 空 → 回落镜像 / 302 兜底 / 有文件走 /app/dl/ 200 / 两边无 → null 四分支）；
  BS-1/BY-1 断言同步更新。
  验证：`npm test` 全链绿、`frontend:build` ✓、`scan` ✅。
  质检：CJ 复检轮 ✅（[QA-CJ-regression.md](QA-CJ-regression.md)，通过 4 / 缺失 0 / 偏差 0 / 需人工确认 1——线上复测）。
  CI：docker-hub run 44051124638 ✅（test/smoke/publish）；docker-tcr run 44051124347 ✅（test/publish）。
  **服务器部署待执行**（升级到 `2.22.1`）：部署后按原现场回归路径复核——`/api/app/latest` 的 apkPath 在 data/app 为空时
  指向 `/app/<ver>.apk` 且浏览器下载成功；`app-sync` 首轮成功后切 `/app/dl/<ver>.apk` 且 200；旧 `/app/dl/` 链接 302 兜底。
- **v2.22.0 已发布**（tag `v2.22.0`，提交 014ec9b 发版文档 + 53dad6c test 修复后重打 tag）：CA（App Token 认证：`api_tokens` + `/api/auth/token[/revoke]` +
  `/api/app/*` 前缀重写与封禁豁免 + `/api/app/status` + 契约 docs/APP-API.md；CA-5 手机 UA 前台 302 → `/app`
  开关默认关闭 + 微信「在浏览器打开」提示 + /app 页改版为主推原生 App）+ CI（提醒邮件 HTML 化 + 申诉页视觉对齐）+
  CG App v2.19.0 APK 入库（versionCode 21900，同 keystore 覆盖旧 TWA）。
  验证：`npm test` 主链全绿、`frontend:build` ✓、`scan` 干净、`api.test.js` 27/27（重跑）。
  质检：CA-1 ✅（[QA-CA1.md](QA-CA1.md)，通过 12）、CA-5 ✅（[QA-CA5.md](QA-CA5.md)，通过 9）、CI ✅（[QA-CI.md](QA-CI.md)）、
  CG ✅（[QA-CG.md](QA-CG.md)，App 按 GitHub Release 独立发布 app-v2.19.0）。
  CI：docker-hub run 44037853853 ✅（test/smoke/publish）；docker-tcr run 44037853797 ✅（test/publish）。
  首次 tag（014ec9b）CI test 红：CJ 批（当时开发中、后已质检通过 docs/QA-CJ.md）随 main 改了 `/api/app/latest`
  apkPath 语义（派生 `/app/dl/<ver>.apk`），serve.test.js 契约断言未同步——ce-dev 补 BS-1 断言（61e8ec6）、
  本会话补 BY-1 断言（53dad6c）后重打 tag 双绿。**服务器部署待执行**（升级到 `2.22.0`）；
  部署后：① App Token 登录与 `/api/app/*` 接口真机回归（CA-1）；② 确认 CG 发布后开启
  `app.mobileRedirectEnabled`（手机浏览器前台 → /app，默认关闭）；③ 到价提醒邮件观察 HTML 渲染与纯文本兜底（CI）。
- **v2.21.0 已发布**（tag `v2.21.0`，提交待补）：CF（strict 自动封禁硬规则 + 阶梯 + 审核四操作 + 布局改版）+
  CD（对齐审核页去重组/合并预览/决定继承 + game_source_map 落库 + sonkwo 收尾匹配 + ITAD 跳转反解）+
  CH（steam-discovery 每天 100 页 Deck/好评率采集 + 综合评分/筛选/徽标 + 为你推荐 + 行为学习 + 免费角标）。
  验证：`npm test` 92 文件全绿、`frontend:build` ✓、`scan` 干净、`api.test.js` 27/27。
  质检：CF ✅（[QA-CF.md](QA-CF.md)）、CD ✅（[QA-CD.md](QA-CD.md)）、CH ✅（[QA-CH.md](QA-CH.md)）；
  CG（Android App）第 1 轮 ✅（[QA-CG.md](QA-CG.md)，App 按 GitHub Release 独立发布，不进站点镜像）。
  CI：docker-hub run 44021503806 ✅（test/smoke/publish）；docker-tcr run 44021503944 ✅（test/publish）。**服务器部署待执行**（升级到 `2.21.0`）；
  部署后重点：① 观察 `auto_ban.applied` 误封率（CF）；② 对齐审核处理杉果队列、「未探测」下降（CD）；
  ③ steam-discovery 首轮采集后 Deck/好评率覆盖上升、为你推荐可用（CH，§11 四条待实测校准）。

- **v2.19.0 已发布**（tag `v2.19.0`，提交 `12f4f42`）：CE（杉果→Steam 匹配加固：完整标题计分 +
  片段限制 + 数字/序数/罗马数字一致性 + 内容词只进人工 + 自动应用收紧）+ CC（多源采集推进：
  `game_source_sync` 状态表 + 候选游标（热点/访问优先 → nomatch 7 天 → matched 间隔 → failed 退避）、
  ITAD 英文名优先 + external_id 缓存批量取价、GOG/Humble 按 id/slug 刷新、后台四源立即运行 + 覆盖列、
  四源每轮条数设置）。无 Android 改动（APK/latest.json 沿用 2.18.0）。
  验证：`npm test` 88 文件全绿、`frontend:build`、`scan` 干净。
  质检：CE ✅（[QA-CE.md](QA-CE.md)）、CC ✅（[QA-SOURCE-SYNC-CC.md](QA-SOURCE-SYNC-CC.md) 两轮）。
  CI：docker-hub run 43852594174 ✅（10m28s）；docker-tcr run 43852593704 ✅（12m55s）。
  **服务器部署待执行**（升级到 `2.19.0`）；部署后重点（CC 验收 8）：连续观察两轮调度，
  后台「未探测」下降、GOG/Humble/ITAD 报价开始出现（热点游戏优先）；杉果匹配人工候选使用正常。
- **v2.18.0 已发布**（tag `v2.18.0`，提交 `f71242b`）：BT（手机登录入口统一 `openLogin` 整页硬跳、
  `next` 站内白名单、懒加载 chunk `router.onError` 兜底）+ BW（后台 ≤768px ☰ 抽屉 + 五模块卡片 +
  批量吸底 + 弹窗全屏，桌面不变）+ BY（App 内置更新：启动/回前台 24h 检查、原生对话框可选/强制、
  下载校验 + GitHub 兜底 + 用户确认安装、「我的 → 检查更新」scheme 手动入口；`latest.json` /
  `/api/app/latest` 增 `versionCode`/`minVersionCode`/`notes`）+ CB（价格报表邮件 HTML 化：
  KPI/Top5/3/7 天柱状/CTA、multipart 文本兜底、`site.publicUrl` 设置、≤480px 单列）。
  APK `steamdeals-2.18.0.apk`（versionCode 21800，签名指纹不变，sha256 `7e7bc84e…`）入库随镜像；
  GitHub Release **app-v2.18.0** 已发布（APK + sha256，作为 App 内更新兜底）。
  验证：`npm test` 87 文件全绿、`frontend:build`、`scan` 干净。
  质检：BW ✅（[QA-CONSOLE-MOBILE-BW.md](QA-CONSOLE-MOBILE-BW.md) 两轮）、BY ✅（[QA-APP-UPDATE-BY.md](QA-APP-UPDATE-BY.md) 两轮）、
  CB ✅（[QA-PRICE-REPORT-CB.md](QA-PRICE-REPORT-CB.md) 两轮）；真机/部署侧复核项已列入各 QA 报告。
  CI：docker-hub run 43828878651 ✅（9m47s）；docker-tcr run 43828878658 ✅（18m37s）。
  **服务器部署待执行**（升级到 `2.18.0`）；部署后重点：① 手机打开 `/console` 为 ☰ 抽屉 + 卡片（BW 真机 3 项）；
  ② 手动 `node src/cli.js report price --notify` 收到 HTML 邮件（CB 验收 6）；③ 真机装 `steamdeals-2.18.0.apk`
  后启动/回前台/「我的 → 检查更新」出现原生更新对话框、安装确认、覆盖升级数据保留（BY 真机 2 项）；
  ④ BT 小米浏览器「我的」面板点登录直达登录页。
- **v2.17.0 已发布**（tag `v2.17.0`）：BS 批——安卓 App（TWA，`android/` 工程入库，包名
  `cn.yyliucha.steamdeals`、versionCode 21600）+ 可清缓存离线（SW 只缓存 `/assets/*` 与封面图，
  HTML/API/manifest 永不缓存、导航走网络、版本变化清缓存 + `?nosw=1`）+ 双通道分发（站点 `/app`
  下载页 + GitHub Release `app-v2.16.0`；签名 APK 入库随镜像，`GET /api/app/latest` 读
  `frontend/public/app/latest.json`；`/.well-known/assetlinks.json`、`/sw.js`、`/app/*.apk` 静态白名单）。
  验证：`npm test` 全绿（serve/pwa 新增断言）、`frontend:build`（`dist/app/` 含 APK 1,472,278 字节）、
  `scan` 干净；
  质检：BS ✅ 放行（[QA-MOBILE-APP-TWA-BS.md](QA-MOBILE-APP-TWA-BS.md)，通过 8 / 需人工确认 4）。
  CI：docker-hub run 43607877486（test / smoke / publish 全绿）；docker-tcr run 43607877492
  （test / publish 全绿，postgres 镜像已存在 2s 跳过），两个镜像源均已推送。
  App 侧：GitHub Release **app-v2.16.0** 已发布（`steamdeals-2.16.0.apk` + `.sha256`，
  `https://github.com/yyliucha/steamdeals/releases/tag/app-v2.16.0`；app-v 标签不触发站点构建）。
  **服务器部署待执行**（升级到 `2.17.0`）；部署后重点：
  ① 部署后 `/.well-known/assetlinks.json` 生效，真机装 `steamdeals-2.16.0.apk`：全屏无地址栏、
  Steam 外链走 Custom Tabs、返回键关浮层、登录态与浏览器独立（验收 §8 第 1–4 条）；
  ② `/app` 页直接可下载并校验 SHA-256（包已在镜像里，无需额外部署步骤）；
  ③ 断网只回静态资源、不返回旧 HTML/旧数据；版本升级后 App 内出「已更新」提示并清缓存。
- **v2.16.0 已发布**（tag `v2.16.0`）：BR + O + BQ 三批——① 封禁自助恢复与手机/CGNAT 适配（页面/API/资源
  三桶限流 120/150/300、封禁期升级只计 API、`/api/ban/state` 自查三件套、加白即清临时封禁不重启恢复、
  封禁页显示剩余时间与脱敏 IP）；② 申诉系统站内受理（封禁页 → 申诉页提交入库 + 图形验证码 + 每 IP 3 条/小时
  + 幂等，SMTP 未配也入库；后台「申诉管理」列表/详情/5 动作联动解封/回信申请人；通知邮件 Reply-To=申请人）；
  ③ 申诉邮件内一键「信任并解封 / 拒绝并保持封禁」→ 确认页 `/appeal/act`（token 在 fragment、只存 sha256、
  14 天、一次性、与后台共用状态机）。
  验证：`npm test` 全绿（85 文件；新增 `test/appeal-system.test.js` 19 项进主链）、`api.test` 22/22、
  `frontend:build`、`scan` 干净；质检：BR ✅ 放行（[QA-BAN-BR.md](QA-BAN-BR.md)），O/BQ ✅ 放行
  （[QA-APPEAL-OBQ.md](QA-APPEAL-OBQ.md) 第 2 轮）。
  CI：docker-hub run 43486662860（test / smoke / publish 全绿）；docker-tcr run 43486662685
  （test / publish 全绿），两个镜像源均已推送。
  **服务器部署待执行**（升级到 `2.16.0`）；部署后重点：
  ① 迁移新增 `appeals` 表（含 token 三列）+ 4 索引（幂等，一次性）；
  ② 手机实测：正常连刷首页 20 次不误封；被封后封禁页显示「约 X 分钟后恢复」+ 脱敏 IP，申诉页拉得出验证码
  并可提交拿到 `AP-XXXXXX`；
  ③ 管理员邮箱收到新申诉通知（含「信任并解封 / 拒绝并保持封禁」两按钮），点开确认页零副作用、信任后 IP 与
  设备解封、申请人收到结果邮件；
  ④ 后台「访问与安全 → 申诉管理」列表/抽屉/处理可用；「系统设置 → 安全与限流」出现页面/API 阈值（保存即热加载）。
- **v2.14.0 已发布**（tag `v2.14.0`）：BP 批——详情弹窗最下方「DLC（共 N 个）」内联列表（名称/价格/折扣/
  缺货、10 条/页、Steam 商店跳转新窗口、移动端卡片、标注「Steam 不提供 DLC 拥有数据」）；`games.dlc_appids`
  随 steam-status/backfill 的 appdetails 顺带写入，`game_dlc` 明细由 steam-status 每轮收尾补（`STEAM_DLC_FILL_GAMES`
  /`STEAM_DLC_FILL_BATCH`）+ 打开详情缺明细回源（≤3 批、10 分钟节流、失败降级）；新增公开接口
  `GET /api/games/:appid/dlc` 与详情 `dlc` 摘要；不新增调度任务。
  验证：`npm test` 全绿（新增 `test/game-dlc.test.js` 7 项进主链）、`api.test` 22/22、`frontend:build`、`scan` 干净；
  质检：BP ✅ 放行（[QA-GAME-DLC-BP.md](QA-GAME-DLC-BP.md)，通过 9 / 需人工确认 1）。
  CI：docker-hub run 43415654728（test / smoke / publish 全绿）；docker-tcr run 43415654500
  （test / publish 全绿，postgres 镜像已存在 2s 跳过，`Verify manifests` ✓），两个镜像源均已推送。
  **服务器部署待执行**（升级到 `2.14.0`）；部署后重点：
  ① 迁移会新建 `game_dlc` 表与 `games.dlc_appids` 列（幂等，一次性）；
  ② 打开 Anno 1800 / HELLDIVERS™ 2 详情滚到底：DLC 列表、翻页、Steam 跳转（新窗口）、Console 干净；
  ③ 24h 后 `game_dlc` 明细覆盖上升（steam-status 收尾补齐 + 读路径回源两条腿）。
- **v2.13.0 已发布**（tag `v2.13.0`）：BO 批——价格历史删掉与趋势线重复的日期表格/移动卡片/分页条，
  趋势线 76px → **150px**（移动端 ≤760px 为 120px、满宽）；新增史低虚线参考线与轴标签（左「¥区间最低 ·
  史低线」、右「区间 首日 → 末日」），底部改为「共 N 条 · … · 史低已标出」（随区间切换变化）；
  平线垂直居中、无历史空态与史低圆点（全期口径）不变；保留 BN 的 v-for+v-if 全组件扫描与编译级回归。
  验证：`npm test` 全绿、`frontend:build`、`scan` 干净；
  质检：BO ✅ 放行（[QA-PRICE-HISTORY-BO.md](QA-PRICE-HISTORY-BO.md)，通过 5 / 需人工确认 2）。
  CI：docker-hub run 43407796179（test / smoke / publish 全绿）；docker-tcr run 43407796297
  （test / publish 全绿，postgres 镜像已存在 2s 跳过，`Verify manifests` ✓），两个镜像源均已推送。
  **服务器部署待执行**（升级到 `2.13.0`）；部署后重点：打开任意有历史价格的详情，确认价格历史只有
  指标卡 + 区间切换 + 趋势线（桌面 150px / 移动端 120px、参考线与轴标签）、无日期表格，Console 干净。
- **v2.12.1 已发布**（tag `v2.12.1`）：BN 批——价格历史区块整块不渲染修复：史低圆点的 `<circle>` 同时写了
  `v-for` 与 `v-if`（Vue 3 里 `v-if` 优先级更高 → 判断被提到循环外引用 `p` → `TypeError` → 整个
  `PriceHistoryReport` 组件渲染失败，指标条/标题/趋势线/表格/空态全部消失）。改为 JS 预计算 `lowDots`
  （史低日 + 坐标），模板只 `v-for`；`chart` 产出 `pts` 数组，去掉模板 `split(' ')` 二次解析。
  史低全期口径、区间切换、分页、空态不变；新增全组件扫描（禁止同元素 `v-for`+`v-if`）与
  `@vue/compiler-dom` 编译级回归断言（旧写法放回必红）。
  验证：`npm test` 全绿、`frontend:build`、`scan` 干净；
  质检：BN ✅ 放行（[QA-PRICE-HISTORY-BN.md](QA-PRICE-HISTORY-BN.md)，通过 4 / 需人工确认 2）。
  CI：docker-hub run 43396423035（test / smoke / publish 全绿）；docker-tcr run 43396423010
  （test / publish 全绿，postgres 镜像已存在 2s 跳过，`Verify manifests` ✓），两个镜像源均已推送。
  **服务器部署待执行**（升级到 `2.12.1`）；部署后重点：打开任意有历史价格的游戏详情，确认「价格历史」区块
  （指标条/趋势线/表格）正常出现、Console 无 `TypeError`。
- **v2.12.0 已发布**（tag `v2.12.0`）：BM 批——`/login`、`/register`、`/change-password` 直接打开/刷新返回
  登录页（SPA 白名单补齐 + router↔白名单一致性测试）；后台 5 处 401 统一软跳登录页（带 `next` +
  `reason=expired`，登录页提示「登录已过期，请重新登录」，不再整页导航撞 404）；会话心跳（登录态页面每
  5 分钟 + 切回前台探测 `/api/me`，仅"上次已登录→这次未登录"才跳，游客/离线/5xx/429 不跳、公开页不探测、
  全局单例、不续期）；老会话迁移改 `last_seen_at = now()`（部署不再把登录超 7 天的会话一次性判空闲过期）。
  验证：`npm test` 全绿（新增 `test/serve.test.js` 页面路由/白名单一致性与 `test/session-heartbeat.test.js`
  静态 + 运行时断言，均进主链）、`api.test` 22/22、`frontend:build`、`scan` 干净；
  质检：BM ✅ 放行（[QA-SESSION-BM.md](QA-SESSION-BM.md)，通过 8 / 需人工确认 2）。
  CI：docker-hub run 43389571927（test / smoke / publish 全绿）；docker-tcr run 43389571921
  （test / publish 全绿，`Ensure PostgreSQL image in TCR` 2s 跳过——postgres:15-alpine 已在 TCR，
  `Verify manifests` ✓），两个镜像源均已推送。
  **服务器部署待执行**（升级到 `2.12.0`）；部署后重点：
  ① 直接打开 `https://<站点>/login`（及 `/register`、`/change-password`）应返回登录页而非 `not found`；
  ② 后台控制台删会话/等过期后操作或挂 5 分钟（或切回标签页）应自动回登录页并提示「登录已过期」；
  ③ 观察老会话不被批量登出（BM-2 迁移口径）。
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
