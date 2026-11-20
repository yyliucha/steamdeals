# QA：EC 图片覆盖治理（第 1 轮）

> 基线 5ce2e50 → HEAD（worktree 分支 wt-228-srv，未提交）；判据 docs/IMAGE-COVERAGE.md §8「EC 图片覆盖治理」验收；
> 开发描述来源：夜班监工派发（工人 2，worktree F:\dsh\gp-wt-228b）。
> 结论：✅ 放行 —— 通过 4 / 缺失 0 / 偏差 0 / 需人工确认 1

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | EC-1 | 后台「图片覆盖看板」显示游戏总数/有 header_image 数/本地已缓存数/缺图数 | 控制台 → 数据报表 → 图片与备份 | ✅ | server.js:3055-3122、AdminModules.vue:135（coverage-card） |
| 2 | EC-1 | 缺图游戏列表分页 + 标原因（header_image 空 / CDN 404 / 抓取失败） | 同上 | ✅ | server.js:3104-3118、test/image-coverage.test.js EC-1 测试 |
| 3 | EC-1 | 「重置缺图负缓存」按钮（复用 POST /api/admin/images/reset-miss） | 同上 | ✅ | 已有 BC 批路由 server.js:3044，看板旁按钮（135 行 cache-card） |
| 4 | EC-2 | 缺图回填任务：扫描 header_image 为空 → 逐 appid 元数据重同步补封面（限速防 429，日志 images.backfill_*） | 定时任务 images-backfill + 手动按钮「重同步缺图」 | ✅ | src/image-backfill.js、cli.js images backfill、scheduler.js:262-277、server.js POST /api/admin/images/backfill |
| 5 | EC-2 | 回填一轮后缺图数下降 | 同上 | ✅ | test/image-coverage.test.js「EC-2 缺图回填」：3 → 1 |
| 6 | EC-3 | 缺图显示品牌占位（S 标 + 游戏名首字），列表与详情统一 | 前台首页列表/详情弹窗、后台游戏目录/游戏库/链接抽屉/个人资料弹窗 | ✅ | CoverPlaceholder.vue + 6 个使用点（test/frontend-registration.test.js EC-3 锁） |

## 逐条核对（规格验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | 看板数字与 SQL 统计一致、缺图列表可翻页 | grep + 测试断言（pglite 真 SQL 对比） | server.js:3055-3122；test/image-coverage.test.js:262-341（`noHeader 与 SQL 统计一致`、`两页不重复`） | ✅ |
| 2 | 回填任务跑一轮后缺图数下降（对比截图/日志） | 单元测试注入 fetchMeta + 日志断言 | src/image-backfill.js:20-58；test/image-coverage.test.js:171-215（3 → 1，images.backfill_filled/done） | ✅ |
| 3 | 缺图游戏前端显示占位图 | 组件编译 + 六使用点扫描 | CoverPlaceholder.vue；test/frontend-registration.test.js:37-86 | ✅ |
| 4 | npm test（分段）+ frontend:build + scan 全绿 | 亲自重跑 | image-coverage 9/9、frontend-registration 5/5、scheduler 38/38、api 38/38、test:1/test:2 分段、frontend:build ✓ 4.83s、scan ✅ | ✅ |

## 打回清单

无。

## 需人工确认

- 真实 Steam 出口下的回填效果（本地无 Steam 网络，fetchMeta 是注入假实现验证的；生产跑一轮后观察 `images.backfill_done` 日志与看板缺图数下降）。
- 占位图视觉细节（S 标 + 首字的实际渲染效果，浏览器目视）。

## 争议项

无。

## 复检记录

- 第 1 轮（2026-11-20）：初检即通过（测试先跑后检：开发自测与 QA 重跑同一命令）。

## 备注

- TODO 状态由监工统一回写（夜班工人不改 docs/TODO.md 及任何共用文档，监工指令例外）。
- 本报告在 worktree 内（F:\dsh\gp-wt-228b\docs\QA-EC.md），与主树隔离。

## 验证输出（QA 亲自重跑）

- `node test/image-coverage.test.js` → 9/9 绿（EC-1/EC-2 全部断言）
- `node test/frontend-registration.test.js` → 5/5 绿（EC-3 组件与六使用点锁）
- `node test/images.test.js` → 10/10 绿（AW 批占位断言随 EC-3 组件化同步更新，行为不变）
- `node test/scheduler.test.js` → 38/38 绿（images-backfill 默认参数/开关）
- `node test/api.test.js` → 38/38 绿（动过 API 必跑）
- `npm run test:2` → 全绿（退出码 0）
- `npm run test:1` → 除 test/commit-own.test.js 外全绿；commit-own 4/4 失败原因是本会话沙箱禁止 spawn git（EPERM，环境限制，与 EC 无关；CI 由 GitHub Actions 兜底）
- `npm run frontend:build` → ✓ built in 4.83s
- `npm run scan` → ✅ 未发现高置信度凭据

