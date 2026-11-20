// CO-5/B4-2 第十五轮（docs/DESIGN-AUDIT.md B4）：admin-reports 域（B4 队列 #12：后台报表/备份/
// 日志 reports/backup/backups/logs/steam-logs）专属 SQL——从 src/store/pg.js 巨石抽出的第十五个域 repository。
//
// 归属判定（§15.1「域专属 SQL 进 repository，通用 SQL 留 pg.js」）：
//   · 本域零函数搬家——6 条路由的取数函数全部跨模块共用：
//     - priceChanges / priceChangeRows / dailyMinSeriesBatch 留 pg.js（定义不动）：
//       src/cli/sync.js、src/cli/report.js 的报表命令也走同一批函数（B4 #18/#19 域），
//       dailyMinSeriesBatch 还被 games 域 history.csv 路由（B4 #21，routes/games.js）共用；
//     - listSteamLogs 留 src/steam-log.js：src/routes/site.js 用户段
//       （/api/steam/accounts/:id/library）也读同一张 steam_account_logs 表；
//     - createBackup / listBackups 留 src/backup.js：src/cli/ops.js 的 backup 命令共用，
//       且 listBackups 是纯文件系统函数（读 BACKUP_DIR 目录），非 SQL；
//   · 本域路由体内无内联 SQL（/api/admin/logs 读 LOG_DIR 文件属编排逻辑，随路由搬入
//     routes/admin-reports.js）；
//   · 相关表 DDL 均不属本域：price_snapshots/daily_prices/games 在 pg.js migrate()，
//     steam_account_logs 在 steam-login.js ensureSteamSchema——一律不动。
//
// 因此本文件不承载函数：pg.js 无需为本域新增 re-export（旧 db.* 导入签名本来就不变）；
// 文件保留为归属判定记录 + 后续本域新 SQL 的落点（§15.1 目录约定的每域一对文件）。
// 测试 test/admin-reports.test.js 有静态锁：本域函数在 pg.js 必须是定义而非 re-export。
