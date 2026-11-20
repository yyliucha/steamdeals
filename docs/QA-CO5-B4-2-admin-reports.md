# QA：B4 #12 admin 报表备份日志域拆分（第 1 轮）

> 基线 94671b4（worktree gp-wt-12 基 main@94671b4）→ HEAD 4a93c01（本域拆分提交，
> 交付文件：server.js / 4 个测试文件改 + routes/admin-reports.js / store/admin-reports-repository.js /
> test/admin-reports.test.js 新增）；判据 docs/ARCHITECTURE.md §15 + docs/B4-QUEUE.md #12 行；
> 开发描述来源：监工派发的 B4 #12 工人 prompt（自包含）。
> 结论：✅ 放行 —— 通过 16 / 缺失 0 / 偏差 0 / 需人工确认 2

## 功能清单（本批交付的全部功能，一条一行，不许合并/抽样）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | B4 #12 | 备份文件列表（BACKUP_DIR 目录） | GET /api/admin/backups | ✅ | src/routes/admin-reports.js:54 |
| 2 | B4 #12 | 手动触发备份并返回最新列表 | POST /api/admin/backup | ✅ | src/routes/admin-reports.js:62 |
| 3 | B4 #12 | 最近日志查看（最近 5 个 jsonl + boot.log，limit/grep/scope/minutes 过滤） | GET /api/admin/logs | ✅ | src/routes/admin-reports.js:78 |
| 4 | B4 #12 | 价格变动报表（涨跌榜 + 悬停线图 series，无逐行请求） | GET /api/admin/reports/price | ✅ | src/routes/admin-reports.js:150 |
| 5 | B4 #12 | 价格变动 CSV 导出（BOM + 转义，附件下载） | GET /api/admin/reports/price.csv | ✅ | src/routes/admin-reports.js:163 |
| 6 | B4 #12 | Steam 账号操作日志（limit/steamId/action/result/days 筛选） | GET /api/admin/steam-logs | ✅ | src/routes/admin-reports.js:188 |
| 7 | B4 #12 | 手动备份豁免统一请求超时看门狗（中间件行为不变） | 请求链（isTimeoutExemptPath） | ✅ | src/server.js:200 |

## 逐条核对（规格验收 → 证据）

| # | 条目（§15 / B4-QUEUE #12 验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | 域内路由全部拆到 src/routes/admin-reports.js（backups/backup/logs/reports/price/price.csv/steam-logs 6 条） | grep path === | src/routes/admin-reports.js:54/62/78/150/163/188；test/admin-reports.test.js:31-44 | ✅ |
| 2 | 路由模块只做 HTTP 编排、不写 SQL 字面量 | grep select/insert/update/delete | test/admin-reports.test.js:39 断言通过（路由文件无 SQL） | ✅ |
| 3 | 数据访问函数签名不变、repository 成对存在 | existsSync + 归属判定 | src/store/admin-reports-repository.js:1-20（零搬家判定） | ✅ |
| 4 | pg.js 保留 re-export 兼容、共用 SQL 留 pg.js、DDL/schema 不动 | git diff pg.js | pg.js 零 diff；priceChanges/priceChangeRows/dailyMinSeriesBatch 定义仍在 pg.js（test/admin-reports.test.js:96-99 锁） | ✅ |
| 5 | server.js 挂载改指新模块 + 位置语义不变（取最早路由 backups 原位置） | grep 接线 | src/server.js import（125-133 注释 + import 行）、接线在 handleAdminSettingsAdmin 之后（test/admin-reports.test.js:57-58 位置锁） | ✅ |
| 6 | 旧内联实现删除、无行为变化（契约零变化：方法/路径/入参/出参/权限） | diff 逐段对照 | server.js 六段内联全删（−117 行）；新模块逐字对照原内联（见开发取证） | ✅ |
| 7 | requireAdmin 守卫逐条保留（401/403 文案由宿主守卫输出） | grep requireAdmin | src/routes/admin-reports.js 6 处 `if (!requireAdmin()) return true;`（test 锁计数=6） | ✅ |
| 8 | 中间件留 server.js（§15.4） | grep isTimeoutExemptPath | src/server.js:200 `if (path === '/api/admin/backup') return true;` 保留 | ✅ |
| 9 | 边界：/api/admin/games*、/api/games/* 不碰；wishlists 留 #16 | grep + diff | server.js diff 不含 games 区改动；wishlists 分支仍在（test/steam-accounts.test.js:651 锁） | ✅ |
| 10 | 静态断言测试指新文件 + 旧锁更新 + 不降断言质量 | 读测试 | test/admin-reports.test.js 132 行 5 用例（分支/接线/双实现/repository/HTTP 冒烟）；steam-accounts/sync-runs/mail-templates/reviews 边界锁更新指新接线 | ✅ |
| 11 | 反向自检：删分支 → 测试红 | 亲自执行 | 临时删 steam-logs 分支 → pass 3/fail 2 红证；恢复后 5/5 绿 | ✅ |
| 12 | 真跑测试全绿 | 亲自执行 | admin-reports 5/5、admin-console-ia 22/22、steam-accounts 16/16、sync-runs 9/9、api 38/38、http-guard 7/7、reviews 31/31、mail-templates 17/17、test:2/3/4 全链绿、frontend:build（--configLoader native）✓、scan 干净 | ✅ |
| 13 | 纪律：无新 tag、不构建、不改共用文档、不动 package.json | git tag --list + status | 无新 tag；工作区仅 8 个本域文件；package.json 未动 | ✅ |
| 14 | server.js 净减行数 | numstat | server.js +31/−149 = 净 −118（pg.js 0） | ✅ |
| 15 | 契约 HTTP 冒烟：匿名 401、管理员 200 | 亲自执行 | test/admin-reports.test.js HTTP 冒烟用例（6 条路由 401 + 管理员 200/表头） | ✅ |
| 16 | /api/admin/steam-logs 归本域（#7 轮先例留 #12 的段） | grep | 已拆入 src/routes/admin-reports.js:188；server.js 无残留（双实现锁） | ✅ |

## 打回清单

（无）

## 需人工确认

- 条目 M1：frontend:build 标准命令在本机沙箱报 `spawn EPERM`（vite 配置加载 spawn 被拦），
  改用 `--configLoader native` 变体构建成功（先例 #4–#17 各轮同口径）；生产构建链由 CI 兜底
  （docker-hub/docker-tcr/test-main），本机限制非代码问题。
- 条目 M2：test:1 全链仅 commit-own 4 项红（隔离提交/新鲜度门禁/清单锁/重叠警告，spawn EPERM 与
  临时目录 ENOENT 的本机沙箱基线，B4-QUEUE 备注自 #4 起逐轮记录），与本域改动无关；CI 兜底。

## 争议项

（无）

## 复检记录

- 第 1 轮（2026-11-20）：16 条核对全过、反向自检红证、门禁全绿 → ✅ 放行；提交 4a93c01
  已推 main（rebase 后冲突仅 server.js import 区块与 #21 games 域重叠，两侧保留、契约零变化）。
