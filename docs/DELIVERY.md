# 开发到交付全流程（会话交接文档）

> 本文是**新会话的接线手册**：接手项目先读这里，再读 [PROJECT-OVERVIEW.md](PROJECT-OVERVIEW.md)（架构与代码落点）、
> [TODO.md](TODO.md)（所有未完成事项总览）和 [ROADMAP.md](ROADMAP.md)（决策与待办）。
> 已知 UI 缺陷与修法见 [UI-FIXES.md](UI-FIXES.md)。发版前必读「对外描述同步」规则。
>
> **会话分工**：讨论方案用 DeepSeek-V4.1-Flash1017，开发实现用 DeepSeek-V4-Pro（见 CONTRIBUTING.md）。
>
> **最后更新：2026-11-03（v1.9.0 已发布：PC 筛选修复 + 移动端独立设计 + 封禁标记；服务器升级待部署人员执行）。若你读到的时间晚于最近提交，先看 CHANGELOG 与 git log。**

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

服务器：`ubuntu@VM-0-6-ubuntu`（118.25.114.250），项目目录 `/home/ubuntu/steamdeals`。
**注意：compose 文件名不叫 compose.yaml**（历史上 sed compose.yaml 报不存在）；先确认：

```bash
cd /home/ubuntu/steamdeals
ls compose*.*
docker compose config --images   # 看当前实际用的镜像 tag
```

用真实文件名替换 tag 并部署（TCR 的可用 tag：`latest`、`sha-<完整40位提交号>`、`<git tag 版本号>`——
以 CI 实际推送为准，先 `docker manifest inspect ccr.ccs.tencentyun.com/tcb-100003189690-pljp/steamdeals:<tag>` 确认存在）：

```bash
sed -i 's#tcb-100003189690-pljp/steamdeals:[^" ]*#tcb-100003189690-pljp/steamdeals:sha-<完整40位提交号>#' <真实 compose 文件名>
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
| `rename` 名字重写 | 每周 | 机器英文名补中文（英文挪进 name_en）；选择条件自带收敛，没活秒退 |
| `steam-accounts` | 每天 | 所有已绑定 Steam 账号的库 + 愿望单同步（差集删除、愿望单→自动提醒）；需 `STEAM_API_KEY`，账号间串行 ≥1s，单账号失败隔离 |
| `steam-claim`（可选） | 每天 | 仅在 compose 配置 `STEAM_CLAIM_USERNAME` + `STEAM_CLAIM_STEAM_ID` 时出现：把历史未归属账号认领给该用户（幂等，认领后可删配置） |
| `prune` 定期清理 | 每周 | 访问记录 180 天 / 采集与任务 90 天 / 验证码 7 天 |
| `images pull` / `backup` / `alerts` | 定时 | 封面缓存 / 每日备份 / 到价提醒 |

Steam 重任务（价格/目录/回填/热度/改名）与后台手动任务**互斥**，不会并行抢限流；
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

### 当前状态（2026-11-04 更新，v1.14.2 已发布：封禁与安全修复批次 + URL 参数隐私化）

> 未完成事项的完整清单见 [TODO.md](TODO.md)。本节只记录版本与部署现状。

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
