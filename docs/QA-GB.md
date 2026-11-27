# QA：GB 图片页 console 三报错修复（第 1 轮）

> 基线 `909299e` → HEAD `29eac6e`（本批提交；验证期间并入 FY-2 的 `3b50a96`，见「风险提醒」）；
> 判据 [IMAGE-PAGE-CONSOLE-FIX.md](IMAGE-PAGE-CONSOLE-FIX.md) §3 验收 4 条；开发描述来源：夜班监工派工单（GB，2026-11-27）。
> 结论：**✅ 放行** —— 通过 4 / 缺失 0 / 偏差 0 / 需人工确认 2

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | GB | 后台「数据统计 → 图片与备份」图片覆盖看板能打开，四个数字不再是「—」（coverage 不再 503） | 后台 → 数据统计 → 图片与备份（`GET /api/admin/images/coverage`） | ✅ | `src/routes/admin-images.js:72` count 聚合 + 20 万行实测 169ms |
| 2 | GB | 看板数字与库内口径一致：游戏总数 / 有 header_image / 缺图（含 noHeader、cdn404、fetchFailed） | 同上（`stats` 字段） | ✅ | `test/image-coverage.test.js:360`（total=190000 / withHeader=180000 / missing=10000） |
| 3 | GB | 缺图分页列表照旧：header_image 空 / CDN 404 / 抓取失败，分页与「重置缺图缓存」后回落不变 | 看板下方缺图列表 +「重置缺图缓存」按钮 | ✅ | `test/image-coverage.test.js:186-270`（EC-1 全部断言保持） |
| 4 | GB | iOS「添加到主屏幕」有 180×180 自定义图标，`/apple-touch-icon.png` 不再 404 | 浏览器请求 `/apple-touch-icon.png`（iOS 主屏） | ✅ | `frontend/public/apple-touch-icon.png`（180×180）+ `src/server.js:2183` + `test/pwa.test.js:82` |
| 5 | GB | Chrome 不再提示 `apple-mobile-web-app-capable` 弃用（新标签补上，旧标签保留给 iOS） | 浏览器 console | ✅ | `frontend/index.html:11-12` + `test/pwa.test.js:76` |

## 逐条核对（规格验收 → 证据）

| # | 条目（规格 §3 验收） | 检查手段 | 证据（文件:行 / 命令） | 判定 |
|---|---|---|---|---|
| 1 | coverage 接口不再全表拉行；20 万行量级响应 < 1s | ① 静态断言；② pglite 造 20 万行实测；③ 变异自检 | ① `test/image-coverage.test.js:341` 断言路由调 `imageCoverageTotals`/`imageCoverageHeaderByAppids` 且**不出现** `db.imageCoverageRows(`；repo 聚合 SQL 锁在 `src/store/admin-images-repository.js:37-53`；② `node test/image-coverage.test.js` → `[GB-1] 20 万行 coverage 响应 169ms（total=190000 / withHeader=180000 / missing=10000）`；③ 变异：把路由改回 `db.imageCoverageRows(q)` → GB-1 静态锁变红（断言消息「看板分支不得再调用全表 imageCoverageRows」），撤销后回绿 | ✅ |
| 2 | 看板数字与库内 SQL 口径一致（totalGames / withHeaderImage / cachedGames / missing） | pglite 数据断言（既有 EC-1 + 新增 20 万行） | `test/image-coverage.test.js:186` EC-1：3 款数据集 totalGames=3、withHeaderImage=2、missing=2、missingByReason `{noHeader:1,cdn404:1,fetchFailed:0}`；`test/image-coverage.test.js:360` 20 万行：逐项等于 SQL `count(*)` / `count(header_image)`，`list.total` = missing；已删除游戏不计总数、负缓存里的库外 appid 不计缺图（`test/image-coverage.test.js:257/263`） | ✅ |
| 3 | `frontend/public/apple-touch-icon.png` 存在（或引用指向存在文件）；`index.html` 含 `mobile-web-app-capable`；`test/pwa.test.js` 通过 | 读文件 + PNG 头 + 构建产物 + 静态路由 + 跑测试 | 图标：Pillow 从 `icon-512.png` 缩放生成 180×180 RGB（不透明）→ `frontend/public/apple-touch-icon.png`；`node test/pwa.test.js` 10/10 通过（新增「GB：apple-touch-icon.png 真实存在（180×180）且登记为 PWA 根文件」）；构建产物 `frontend/dist/apple-touch-icon.png`（10988 B）与 `frontend/dist/index.html` 两个 meta 均在；服务端白名单 `src/server.js:2183`（否则 dist 里的图标不被服务、仍 404） | ✅ |
| 4 | `npm test`（分段）+ `frontend:build` + `scan` 全绿 | 真跑四段主链 + 构建 + 凭据扫描 | 最终 HEAD `29eac6e`：`test:1` / `test:2` / `test:3` / `test:4` 全部 `EXIT 0`（无 `✖` 条目，test:1 共 31 个测试文件）；`vite build` → `✓ built in 1.88s`；`scan-secrets` → 893 文件「未发现高置信度凭据 / 可疑的密钥赋值」；链外 `test/admin-images.test.js` 5/5、`test/image-coverage.test.js` 11/11 | ✅ |

## 测试质量与反向自检（变异验证）

- 变异 1（把 coverage 分支改回 `db.imageCoverageRows(q)`）→ `GB-1 coverage 看板改 SQL 聚合` 变红（`doesNotMatch` 落空），证明静态锁真守「不再全表拉行」；
- 变异 2（把 `imageCoverageHeaderByAppids` 的 `and not deleted` 去掉）→ EC-1 变红：`actual {noHeader:1,cdn404:1,fetchFailed:0}` vs `expected {…cdn404:0}`，证明「已删除游戏不虚增缺图」的语义锁有效；
- 两处变异均已撤销，最终代码与测试见提交 `29eac6e`。

## 打回清单

- 无。

## 需人工确认

- 条目 1/2：本地用 pglite 20 万行替身（169ms）证明「不再全表拉行」；**生产 19.6 万行真实库 + 网络环境的看板是否恢复（503 消失、数字有值）需部署后目视**。
- 条目 4：180×180 图标文件与 HTTP 路由已验证，**iOS 真机「添加到主屏幕」的实际显示效果**无法本地验证，需上线后目视。

## 风险提醒（范围外改动，不判错，供监工/所有者知悉）

1. **基线红修复**：`test/mail-templates.test.js:219` 断言 `handleSettingsRoutes({…})` 参数列表少了 FX（`975bfce`）新增的 `ip`，导致 HEAD 上 `test:1` 常红（与 GB 无关）。本批顺带把断言同步为 `readBody, user, ip, afterHydrate`（一行、纯测试），否则验收④无法全绿、CI 无法双绿。
2. **`isFrontendPublicFile` 新增 `/apple-touch-icon.png`**：规格 §2.2 只要求补文件；但 `serveFrontendStatic` 只把白名单内路径交给 `frontendDir`，不登记则构建产物里的 180×180 不被服务（继续回落 `web/` 旧图标），404 根因链没有闭合。属防 404 的必要改动，附带 pwa 测试锁住。
3. **文档同步**：`docs/MOBILE-PWA.md` §2 / §6 两处补注（图标落点与白名单），不改其它发布文档。
4. **并发提交**：验证期间 FY-2 在**同一工作区**提交 `3b50a96`（`AdminModules.vue` 等 13 文件）；`test:3` 曾因该在途改动短暂变红，FY-2 提交后最终全绿。本批提交 `29eac6e` 的 diff 只有 11 个本批文件（`git diff 3b50a96..29eac6e --stat` 已核对），未包含也未回退 FY-2 任何改动。

## 纪律检查（steamdeals-qa §6）

1. 未打 tag（本会话无 `git tag` 操作），未触发构建；
2. 未碰部署/服务器配置/凭据（仅 `frontend/`、`src/`、`test/`、`docs/MOBILE-PWA.md`）；
3. 无构建产物入库（`frontend/dist/` 已忽略）；
4. 已推 `main`（`3b50a96..29eac6e`）；
5. 发布文档（TODO / INDEX / DONE / DELIVERY / CHANGELOG / README / PROJECT-OVERVIEW）按夜班纪律**由监工统一更新**，本批未改。

## 已检查 / 未检查

- 已检查：GB（规格 §3 验收 1~4 + 纪律项 + 功能清单 5 条）→ 结论 ✅ 放行。
- 未检查：无（本批单条目）。

## 复检记录

- 第 1 轮（2026-11-27）：无打回项 → ✅ 放行。状态回写（`docs/TODO.md` GB → `质检通过`）按夜班纪律由监工统一更新。
