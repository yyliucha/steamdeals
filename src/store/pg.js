// PostgreSQL 存储层。目标版本 15.x（实测 15.17 Debian）。
//
// 只用 PG 15 就有的语法：identity 列、ON CONFLICT DO UPDATE、LEAST()、
// make_interval()、timestamptz、视图。避免 any_value(16+)、json_table(17+)。
//
// 所有函数都接收同一个 q(sql, params) 查询函数，因此同一套 SQL 既能在
// 真实 PG 上跑，也能在测试里的 PGlite 上跑（PGlite 是编译成 wasm 的真 PG）。
import { deriveSearchTokens } from '../search-derive.js';
// CO-4/B4（docs/DESIGN-AUDIT.md B4）：App 域 SQL 已抽到 app-repository.js；这里 import 供 migrate()
// 建表并 re-export 保持旧导出签名不变（server.js / auth-routes.js / 测试照旧 import pg.js）。
import { API_TOKENS_DDL, apiTokenHash, insertApiToken, userByApiToken, revokeApiToken, touchApiToken } from './app-repository.js';
export { API_TOKENS_DDL, apiTokenHash, insertApiToken, userByApiToken, revokeApiToken, touchApiToken } from './app-repository.js';
// CO-4/B4 第二轮（docs/DESIGN-AUDIT.md B4）：申诉域 SQL 已抽到 appeal-repository.js；这里 import 供 migrate()
// 建表并 re-export 保持旧导出签名不变（server.js 审核证据抽屉等照旧 import pg.js）。
import {
  APPEALS_DDL,
  appealStatusByIp,
  insertAppeal,
  recentAppealByIpMessage,
  countAppealsSince,
  appealStatusByCode,
  listAppeals,
  countPendingAppeals,
  countAppeals,
  getAppealById,
  resolveAppeal,
  appealByTokenHash,
  consumeAppealToken,
} from './appeal-repository.js';
export {
  APPEALS_DDL,
  appealStatusByIp,
  insertAppeal,
  recentAppealByIpMessage,
  countAppealsSince,
  appealStatusByCode,
  listAppeals,
  countPendingAppeals,
  countAppeals,
  getAppealById,
  resolveAppeal,
  appealByTokenHash,
  consumeAppealToken,
} from './appeal-repository.js';
// CO-5/B4-2 第三轮（docs/DESIGN-AUDIT.md B4）：认证域 SQL 落 auth-repository.js（登录失败计数/
// 锁定/改密/Steam 绑定专属 SQL，无 DDL 搬家）；这里 re-export 保持 routes/auth.js 与现有
// 导入照旧走 pg.js 聚合壳（db.* 签名不变）。
export {
  bumpLoginFailCount,
  lockUserAccount,
  resetLoginFailState,
  rehashUserPassword,
  setUserWeakPassword,
  userPasswordHash,
  changeUserPassword,
  steamAccountOwnerId,
  countUserSteamAccounts,
  upsertSteamAccount,
} from './auth-repository.js';
// CO-5/B4-2 第四轮（docs/DESIGN-AUDIT.md B4）：watchlist/wishlist 域用户段 SQL 落
// watchlist-repository.js（用户级到价提醒 CRUD；无 DDL 搬家——watchlist 表跨域共用，
// alerts/CLI/管理段/游戏详情都读写它）。这里 re-export 保持旧 db.* 导入签名不变
// （routes/watchlist.js、server.js 其它段与现有测试照旧走 pg.js 聚合壳）。
export {
  upsertUserWatch,
  deleteUserWatch,
  listUserWatches,
} from './watchlist-repository.js';
// CO-5/B4-2 第五轮（docs/DESIGN-AUDIT.md B4）：announcements 域 SQL 落 announcements-repository.js
// （公告 CRUD 四函数 + 已读三新函数；无 DDL 搬家——announcements 表被后台批量操作 B4 #11 也读写）。
// 这里 re-export 保持旧 db.* 导入签名不变（routes/announcements.js、server.js 其它段与现有测试照旧走聚合壳）。
export {
  listAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  listAnnouncementReads,
  filterExistingAnnouncementIds,
  markAnnouncementsRead,
} from './announcements-repository.js';
// CO-5/B4-2 第八轮（docs/DESIGN-AUDIT.md B4）：admin-access 域 SQL 落 admin-access-repository.js
// （后台访问安全：views/visitors/whitelist/abuse/devices/reviews 专属 15 函数 + 域内联 4 新函数；
// 无 DDL 搬家——本域表跨域共用：中间件/拦截链/批量操作都读写）。这里 re-export 保持旧 db.*
// 导入签名不变（routes/admin-access.js、server.js 其它段与现有测试照旧走聚合壳）。
export {
  viewStats,
  adminViewsGameMap,
  visitorOrderClause,
  visitorLogStatusCond,
  listVisitorLogs,
  visitorSummary,
  visitorOverview,
  listVisitorsByIp,
  visitorIpDetail,
  listWhitelist,
  removeWhitelistIp,
  listAbuse,
  ipAbuseBanRow,
  listDevices,
  listDeviceBans,
  listAbuseReviews,
  getAbuseReview,
  countPendingReviews,
  lastUaByIp,
  applyManualTempBan,
  trustIpDb,
} from './admin-access-repository.js';
// CO-5/B4-2 第六轮（docs/DESIGN-AUDIT.md B4）：me 域 SQL 落 me-repository.js（本人资料/
// 偏好/头像/游戏库统计专属 SQL + 两个域内联 SQL 新函数；无 DDL 搬家——user_prefs 表被
// watchCandidates（alerts 引擎）也 join，属跨域共用表）。
// 这里 re-export 保持旧 db.* 导入签名不变（routes/me.js、server.js 其它段与现有测试照旧走聚合壳）。
export {
  getUserPublic,
  updateUserProfile,
  avatarOfUser,
  setUserAvatar,
  clearUserAvatar,
  userLibraryStats,
  PREF_TABS,
  PREF_SORTS,
  normalizePrefs,
  getPrefs,
  savePrefs,
  countBoundSteamAccounts,
  boundAtOfSteamAccount,
  listBoundSteamAccounts,
  listMySessions,
  revokeMySession,
} from './me-repository.js';
// CO-5/B4-2 第七轮（docs/DESIGN-AUDIT.md B4）：site 域 SQL 落 site-repository.js——站点信息
// （/api/site）与 Steam 账号管理（/api/steam/*）专属 SQL。setDefaultSteamAccount /
// clearDefaultSteamIfMatches / userLibraryItems 第六轮因「steam accounts 域 B4 #7 使用」留
// 本文件，本轮随域搬走（函数签名与拆分前完全一致）；无 DDL 搬家——steam_accounts 等表
// DDL 在 steam-login.js（跨模块共用）。这里 re-export 保持旧 db.* 导入签名不变
// （routes/site.js、server.js 其它段与现有测试照旧走 pg.js 聚合壳）。
export {
  setDefaultSteamAccount,
  clearDefaultSteamIfMatches,
  userLibraryItems,
  registrationEnabledRow,
  accountApiKeyEnc,
  accountOwnerRow,
  claimTargetRow,
  claimSteamAccount,
  updateSteamAccountAlias,
  steamAccountApiKeySet,
} from './site-repository.js';
// CO-5/B4-2 第九轮（docs/DESIGN-AUDIT.md B4）：admin-sync 域 SQL 落 admin-sync-repository.js
// （B4 队列 #9：手动同步任务 sync/heat/backfill/rename/circuit）。只搬 listSyncRuns——它只被
// 本域路由使用；sync_runs 其余函数（insertSyncRun/finishSyncRun/runningSyncRun/
// markStaleSyncRuns/sourceSyncStats/observedSyncRunSeconds/lastFailedSyncRun/
// lastSyncRunStartedByMode）被 cli.js / scheduler.js / server.js 启动清理跨模块共用，
// 属通用 SQL 留本文件（§15.1）。无 DDL 搬家——sync_runs 表 DDL 在本文件 migrate() 消费。
// 这里 re-export 保持旧 db.* 导入签名不变（routes/admin-sync.js、server.js 其它段
// 与现有测试照旧走 pg.js 聚合壳）。
export { listSyncRuns } from './admin-sync-repository.js';
// CO-5/B4-2 第十轮（docs/DESIGN-AUDIT.md B4）：admin-settings 域（B4 #10：smtp/mail/emails/
// proxies/version）SQL 落 admin-settings-repository.js——邮件模板 CRUD（listMailTemplates/
// upsertMailTemplate/resetMailTemplate）与发送记录列表（listMailLog）只被本域路由使用随域搬走，
// 域内联 SQL（SMTP upsert/email_codes 列表/测试邮件记录）抽成 5 个新函数；
// insertMailLog 被 account-notify.js / routes/appeal.js / 本域 mail test 跨模块共用留本文件；
// 无 DDL 搬家——smtp_settings/mail_templates/mail_log/email_codes 表 DDL 在 email-auth.js。
// 这里 re-export 保持旧 db.* 导入签名不变（routes/admin-settings.js、server.js 其它段
// 与现有测试照旧走聚合壳）。
export {
  listMailTemplates,
  upsertMailTemplate,
  resetMailTemplate,
  listMailLog,
  saveSmtpSettings,
  listEmailCodes,
  insertTestEmailCode,
  markEmailCodeSent,
  markEmailCodeFailed,
} from './admin-settings-repository.js';
// CO-5/B4-2 第十一轮（docs/DESIGN-AUDIT.md B4）：admin-sessions 域（B4 #14：后台会话
// 列表/踢下线）SQL 落 admin-sessions-repository.js——listSessions 只被本域路由使用随域
// 搬走；deleteSessionById（#11 bulkSessionKick 共用）、deleteSessionsOfUser（auth-routes/
// routes/auth.js/server.js kickAll、revoke-others、禁用踢会话共用）、deleteSessionsOfUsers
// （#11 bulk）、touchSession/deleteSessionByToken（请求链中间件）一律留本文件；
// 无 DDL 搬家——sessions 表 DDL 在本文件 migrate() 消费。
// 这里 re-export 保持旧 db.* 导入签名不变（routes/admin-sessions.js、server.js 其它段
// 与现有测试照旧走聚合壳）。
export { listSessions } from './admin-sessions-repository.js';
// CO-5/B4-2 第十四轮（docs/DESIGN-AUDIT.md B4）：admin-align 域（B4 #17：后台对齐审核
// /api/admin/align*）SQL 落 admin-align-repository.js——align_snapshots 表 DDL（只被本域
// 读写；CLI align-snapshot 走 align-snapshot.js 共享函数，建表仍由本文件 migrate() 消费）
// + 域内联 SQL 抽 5 个新函数（确认流程别名/源行守卫、合并预览孤儿行、目标游戏、搜索候选）。
// 这里 import 供 migrate() 建表并 re-export 保持旧 db.* 导入签名不变
// （routes/admin-align.js、server.js 其它段与现有测试照旧走聚合壳）。
import {
  ALIGN_SNAPSHOTS_DDL,
  gameAliasGameId,
  gameSteamAppidById,
  listOrphanGameRows,
  gameBySteamAppid,
  searchAlignGames,
} from './admin-align-repository.js';
export {
  ALIGN_SNAPSHOTS_DDL,
  gameAliasGameId,
  gameSteamAppidById,
  listOrphanGameRows,
  gameBySteamAppid,
  searchAlignGames,
} from './admin-align-repository.js';
// CO-5/B4-2 第十五轮（docs/DESIGN-AUDIT.md B4）：games 域（B4 #21：公开 /api/games/*）
// SQL 落 games-repository.js——前台列表/搜索（gameSearch）、详情回显（getUserWatch/
// recordView）、DLC 摘要与列表（dlcSummary/countGameDlc/countDlcMissing/listGameDlc）、
// 个人标记与管理员游戏写操作（setUserGameFlag/setGameBlocked/setGameDeleted）、数据世代
// （dataGen）与域内联 SQL（countGamesForApi/gamesStamp）只被本域路由使用随域搬走；
// gameDetail / regionOffers / dailyMinSeries / offersOfGame / setInterest / setOwned /
// setGameDescription / gameKeywordSql 等被 watchlist 域、CLI、admin 段（#15 后台游戏管理）
// 跨模块共用，属通用 SQL 留本文件；GAME_SELECT 等共享片段加 export 供
// games-repository.js 导入（本文件 gameDetail/gameOverview 与域 repository 共用同一片段，
// 防两处漂移）。无 DDL 搬家——games/daily_prices/offers 等表 DDL 在本文件 SCHEMA。
// 这里 re-export 保持旧 db.* 导入签名不变（routes/games.js、server.js 其它段
// 与现有测试照旧走 pg.js 聚合壳）。
export {
  gameSearch,
  countGamesForApi,
  gamesStamp,
  getUserWatch,
  recordView,
  dataGen,
  listGameDlc,
  countGameDlc,
  countDlcMissing,
  dlcSummary,
  setGameBlocked,
  setGameDeleted,
  setUserGameFlag,
} from './games-repository.js';
// CO-5/B4-2 第十六轮（docs/DESIGN-AUDIT.md B4）：admin-images 域（B4 #13：后台图片
// /api/admin/images）SQL 落 admin-images-repository.js——imageCoverageRows 只被本域路由
// 使用（EC 批覆盖看板）随域搬走，域内联 SQL（看板缺图分页列表）抽新函数
// imageCoverageMissingRows；fillHeaderImage（image-backfill.js 回填与 steam-status.js 共用）、
// missingHeaderImageAppids（image-backfill.js 回填候选）、backfillCandidateWhere（CLI 与统计
// 共用候选谓词）属跨模块共用 SQL 留本文件；games 表 DDL 在本文件 SCHEMA 不搬。
// 这里 re-export 保持旧 db.* 导入签名不变（routes/admin-images.js、server.js 其它段
// 与现有测试照旧走 pg.js 聚合壳）。
// GB 批（docs/IMAGE-PAGE-CONSOLE-FIX.md §2.1）：看板统计改 SQL 聚合——imageCoverageTotals（count）
// 与 imageCoverageHeaderByAppids（只查负缓存 appid）随域新增，一起 re-export。
export {
  imageCoverageHeaderByAppids,
  imageCoverageMissingRows,
  imageCoverageRows,
  imageCoverageTotals,
} from './admin-images-repository.js';
// CO-5/B4-2 第十六轮（docs/DESIGN-AUDIT.md B4）：admin-users 域（B4 #11：后台用户批量
// /api/admin/users*、bulk、bulk-ops + DT-4 后台重置密码发码）SQL 落 admin-users-repository.js——
// 用户 CRUD（unlockUser/updateUser/deleteUserAudited/listUserDeletions）、批量操作审计与
// 批量 SQL（createBulkOp/listBulkOps/getBulkOp、bulkSetGamesBlocked/Deleted、bulkDeleteAnnouncements、
// bulkSetAnnouncementsActive、bulkGetAbuseReviews/bulkRejectAbuseReviews、bulkRemoveBlockedIps/
// WhitelistIps/DeviceBans、usersForBulk/countActiveAdmins/bulkSetUsersDisabled/deleteSessionsOfUsers）
// 只被本域路由使用随域搬走，域内联 SQL（发码/校验/绑定邮箱/审计行）抽成 13 个新函数；
// listUsers（cli.js users 命令共用）、setUserPassword（auth-routes.js 前台重置共用）、
// writeAuditLog（admin-access 域审计共用）、deleteSessionsOfUser（前台 revoke-others/auth 域/
// kickAll/禁用踢会话共用）、bulkSetFreeStatus（steam-status 收尾共用）属通用 SQL 留本文件。
// 无 DDL 搬家——users/admin_bulk_ops 等表 DDL 在本文件 SCHEMA。
// 这里 re-export 保持旧 db.* 导入签名不变（routes/admin-users.js、server.js 其它段
// 与现有测试照旧走 pg.js 聚合壳）。
export {
  userSessionKickTarget,
  userEmailTarget,
  userEmailIdRow,
  userStateRow,
  userIdRow,
  insertAdminEmailCode,
  pendingEmailCode,
  bumpEmailCodeAttempts,
  consumeEmailCode,
  markEmailVerified,
  recentEmailCodes,
  adminBindEmail,
  ensureUsersEmailColumns,
  unlockUser,
  updateUser,
  deleteUserAudited,
  listUserDeletions,
  bulkSetGamesBlocked,
  bulkSetGamesDeleted,
  bulkDeleteAnnouncements,
  bulkSetAnnouncementsActive,
  bulkGetAbuseReviews,
  bulkRejectAbuseReviews,
  bulkRemoveBlockedIps,
  bulkRemoveWhitelistIps,
  bulkRemoveDeviceBans,
  usersForBulk,
  countActiveAdmins,
  bulkSetUsersDisabled,
  deleteSessionsOfUsers,
  createBulkOp,
  listBulkOps,
  getBulkOp,
} from './admin-users-repository.js';
// CO-5/B4-2 第十七轮（docs/DESIGN-AUDIT.md B4）：admin-games 域（B4 #15：后台游戏目录
// /api/admin/games*）SQL 落 admin-games-repository.js——adminGameStats（同步概览）、
// adminGameLinks（单游戏平台链接）、listDeletedGames（回收站）只被本域路由使用随域搬走，
// 域内联 SQL（DV 批平台筛选片段/游戏列表 count+rows/links 守卫行）抽 3 个新函数
// （adminGamesPlatformCond/listAdminGames/adminGameLinkRow）；gameKeywordSql 与
// backfillCandidateWhere 被 repository import 引用（循环导入只取函数声明，运行时调用，
// #21 games-repository.js 先例）、gameDetail/mergeGames/setInterest/setOwned/
// setGameDescription 等被 #21 域、CLI、align 域跨模块共用，属通用 SQL 留本文件；
// games 表 DDL 在本文件 SCHEMA 不搬。
// 这里 re-export 保持旧 db.* 导入签名不变（routes/admin-games.js、server.js 其它段
// 与现有测试照旧走 pg.js 聚合壳）。
export {
  adminGameStats,
  adminGameLinks,
  listDeletedGames,
  adminGamesPlatformCond,
  adminGamesWhereParts,
  listAdminGames,
  adminGameLinkRow,
} from './admin-games-repository.js';
// CO-5/B4-2 第十七轮（docs/DESIGN-AUDIT.md B4）：admin-watchlist 域（B4 #16：后台提醒愿望单
// /api/admin/watchlist*、/api/admin/wishlists）SQL 落 admin-watchlist-repository.js——
// deleteWatchById/listAllWatchesAdmin/migrateSiteWatches/deleteSiteWatches 只被本域管理段
// 路由使用随域搬走，域内联 SQL（migrate 目标用户行、watchDel 提醒行）抽 2 个新函数；
// upsertWatch/deleteWatch/listWatches（CLI watch add/del/list 共用）、watchCandidates/
// markNotified（alerts 引擎与 CLI report 共用）、getUserWatch（games 域详情回显）属通用 SQL
// 留本文件；愿望单落库 SQL 在 steam-accounts.js（跨模块原地）。watchlist 表 DDL 在本文件
// SCHEMA（跨模块共用）不搬。这里 re-export 保持旧 db.* 导入签名不变（routes/admin-watchlist.js、
// server.js 其它段与现有测试照旧走 pg.js 聚合壳）。
export {
  adminWatchTargetUser,
  watchRowById,
  deleteWatchById,
  listAllWatchesAdmin,
  migrateSiteWatches,
  deleteSiteWatches,
} from './admin-watchlist-repository.js';

export const SCHEMA = `
create table if not exists platforms (
  code text primary key,
  name text not null,
  kind text not null check (kind in ('official', 'authorized_reseller', 'c2c'))
);

create table if not exists games (
  id            bigint generated by default as identity primary key,
  steam_appid   integer unique,
  name          text,
  name_en       text,
  app_type      text,
  is_free       boolean not null default false,
  header_image  text,
  release_date  date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 平台商品 → 游戏 的映射。跨平台对齐的唯一落点，匹配方式留痕便于事后纠错。
create table if not exists game_aliases (
  id                  bigint generated by default as identity primary key,
  game_id             bigint not null references games(id) on delete cascade,
  platform_code       text not null references platforms(code),
  platform_title      text,
  platform_product_id text not null,
  match_method        text not null default 'appid',
  confidence          real not null default 1.0,
  unique (platform_code, platform_product_id)
);

-- 当前报价：一个游戏的同一平台/渠道类型/区服只留一条最新
create table if not exists offers (
  id             bigint generated by default as identity primary key,
  game_id        bigint not null references games(id) on delete cascade,
  platform_code  text not null references platforms(code),
  product_type   text not null,
  region         text not null,
  currency       text not null,
  price_cents    integer not null,
  original_cents integer,
  discount_pct   integer not null default 0,
  in_stock       boolean not null default true,
  buy_url        text,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  unique (game_id, platform_code, product_type, region)
);
create index if not exists idx_offers_game on offers (game_id);
create index if not exists idx_offers_region_game on offers (region, game_id);

-- 历史快照：只追加，价格/库存没变就不写
create table if not exists price_snapshots (
  id             bigint generated by default as identity primary key,
  offer_id       bigint not null references offers(id) on delete cascade,
  price_cents    integer not null,
  original_cents integer,
  discount_pct   integer not null default 0,
  in_stock       boolean not null default true,
  raw_hash       text not null,
  captured_at    timestamptz not null default now()
);
create index if not exists idx_snapshots_offer on price_snapshots (offer_id, captured_at desc);

-- 按天聚合：画曲线只读这张，不扫快照全表
create table if not exists daily_prices (
  game_id         bigint not null references games(id) on delete cascade,
  platform_code   text not null references platforms(code),
  region          text not null,
  day             date not null,
  min_price_cents integer not null,
  currency        text not null,
  primary key (game_id, platform_code, region, day)
);
create index if not exists idx_daily_prices_region_game on daily_prices (region, game_id);

-- 采集健康度：每次同步一行，"最近为什么没数据"先看这里
create table if not exists fetch_runs (
  id            bigint generated by default as identity primary key,
  platform_code text not null,
  started_at    timestamptz not null,
  finished_at   timestamptz,
  requests      integer not null default 0,
  total         integer not null default 0,
  ok            integer not null default 0,
  skipped       integer not null default 0,
  failed        integer not null default 0,
  status        text,
  note          text
);

-- 关注列表：target_cents 为空表示"只跟史低"，非空表示"到目标价叫我"
-- source 标记提醒来源：manual = 手动添加；steam_wishlist = 愿望单同步自动创建（随移出/解绑清理）
create table if not exists watchlist (
  id                  bigint generated by default as identity primary key,
  game_id             bigint not null references games(id) on delete cascade,
  region              text not null default 'cn',
  target_cents        integer,
  note                text,
  source              text not null default 'manual',
  created_at          timestamptz not null default now(),
  last_notified_at    timestamptz,
  last_notified_cents integer,
  unique (game_id, region)
);

-- "C2C 不参与主榜"做成结构约束，而不是靠业务代码记得加 if
create or replace view v_lowest_official as
select o.game_id, o.region, min(o.price_cents) as lowest_cents
from offers o
join platforms p on p.code = o.platform_code
where p.kind in ('official', 'authorized_reseller') and o.in_stock
group by o.game_id, o.region;

-- 访问者记录：每次页面/API 请求一行（静态资源不记）。
-- ip 是"生效 IP"（优先 x-real-ip / x-forwarded-for 最后一跳，否则 socket 地址）；
-- remote_ip 是直连对端，二者不同说明前面有反代，排查归属问题时看它。
-- blocked=true 表示这次请求是"被拦截"（429/403/路径封禁），采样写入，不算真实访问。
create table if not exists visitor_logs (
  id         bigint generated by default as identity primary key,
  ip         text not null,
  remote_ip  text,
  region     text,
  path       text not null,
  method     text not null default 'GET',
  user_agent text,
  status     integer,
  created_at timestamptz not null default now()
);
create index if not exists idx_visitor_logs_created on visitor_logs (created_at desc);
create index if not exists idx_visitor_logs_ip on visitor_logs (ip);

-- 老库补列：拦截标记与原因（只对 blocked=true 有意义）
alter table visitor_logs add column if not exists blocked boolean not null default false;
alter table visitor_logs add column if not exists block_reason text;
create index if not exists idx_visitor_logs_blocked on visitor_logs (blocked, id desc);

-- IP 黑名单：命中即整站 403（server 层拦截）。支持单个 IP 与 IPv4 CIDR。
create table if not exists ip_blacklist (
  id         bigint generated by default as identity primary key,
  ip         text not null unique,
  note       text,
  created_at timestamptz not null default now()
);

-- IP 白名单：不受频率限制与黑名单影响（自己的出口 IP 放这里）
create table if not exists ip_whitelist (
  ip         text primary key,
  note       text,
  created_at timestamptz not null default now()
);

-- 超频三振计数与封禁到期：第 1 次 10 分钟、第 2 次 30 分钟、第 3 次封到当天结束（次日 0 点恢复）。
-- path_strikes 是"扫描/非法路径"的独立计数：只记录，不自动封。
-- ban_source 记录当前封禁来自哪套规则（rate / path），重启后据此决定要不要三振升级。
-- strike_day 记最后一次三振的日期：跨天后 strikes 归零，重新从 10 分钟起算。
create table if not exists ip_abuse (
  ip           text primary key,
  strikes      int not null default 0,
  banned_until timestamptz,
  updated_at   timestamptz not null default now()
);
alter table ip_abuse add column if not exists path_strikes int not null default 0;
alter table ip_abuse add column if not exists last_path_strike timestamptz;
alter table ip_abuse add column if not exists ban_source text;
alter table ip_abuse add column if not exists strike_day date;

-- 登录图形验证码：一次性、5 分钟过期（答案不返回给前端）
create table if not exists login_challenges (
  token      text primary key,
  answer     text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_login_challenges_exp on login_challenges (expires_at);

-- 后台手动触发的同步任务记录：开始时插一行 running，子进程结束时补结果与输出尾巴
create table if not exists sync_runs (
  id          bigint generated by default as identity primary key,
  mode        text not null,
  args        text,
  status      text not null default 'running',
  exit_code   integer,
  output      text,
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists idx_sync_runs_started on sync_runs (started_at desc);
`;

// 增量迁移：老库通过 alter 补齐，新库由上面的 create table 负责
const USER_SCHEMA = `
create table if not exists users (
  id serial primary key,
  username text not null unique,
  password_hash text not null,
  role text not null default 'user',
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);
create table if not exists sessions (
  token text primary key,
  user_id integer not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);create table if not exists user_prefs (
  user_id integer primary key references users(id) on delete cascade,
  hide_uninterested boolean not null default true,
  sort text not null default 'discount',
  tab text not null default 'all'
);
create table if not exists page_views (
  id bigserial primary key,
  user_id integer references users(id) on delete set null,
  path text not null,
  appid integer,
  created_at timestamptz not null default now()
);
-- 每个用户的游戏标记：null = 未标记（回退到 games 上的全局标记）
create table if not exists user_game_flags (
  user_id    integer not null references users(id) on delete cascade,
  game_id    bigint not null references games(id) on delete cascade,
  interested boolean,
  owned      boolean,
  updated_at timestamptz not null default now(),
  primary key (user_id, game_id)
);

-- 用户彻底删除审计（docs/USER-LIFECYCLE.md §3.2）：
-- 只存脱敏快照（邮箱打码、关联计数、操作者），不存密码/token/Key/完整邮箱/SteamID 列表。
create table if not exists admin_user_deletions (
  id             bigserial primary key,
  username       text not null,
  role           text not null,
  email_masked   text,
  steam_accounts int not null default 0,
  sessions       int not null default 0,
  deleted_by     text not null,
  deleted_by_id  integer references users(id) on delete set null,
  reason         text,
  created_at     timestamptz not null default now()
);
create index if not exists idx_admin_user_deletions_time on admin_user_deletions (created_at desc);

-- 站点公告：后台写，前台展示；active + 时间窗口控制生效范围
create table if not exists announcements (
  id         bigint generated by default as identity primary key,
  title      text not null,
  body       text not null,
  level      text not null default 'info',
  active     boolean not null default true,
  starts_at  timestamptz,
  ends_at    timestamptz,
  created_by integer references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_announcements_active on announcements (active, id desc);

-- 公告已读：登录用户已读状态存库（跨设备跟随账号）；游客只存浏览器本地
create table if not exists announcement_reads (
  user_id         integer not null references users(id) on delete cascade,
  announcement_id bigint not null references announcements(id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (user_id, announcement_id)
);

-- 设备指纹日志：页面加载时前端上报，服务端对稳定字段算 sha256（不存原始 canvas/音频）
create table if not exists device_logs (
  id          bigint generated by default as identity primary key,
  ip          text,
  device_id   text,
  fingerprint text not null,
  user_agent  text,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_device_logs_fp on device_logs (fingerprint);
create index if not exists idx_device_logs_did on device_logs (device_id);
create index if not exists idx_device_logs_created on device_logs (created_at desc);

-- 设备封禁：until 为空 = 永久；按指纹封，同时挂 device_id 方便 cookie 命中
create table if not exists device_bans (
  fingerprint text primary key,
  device_id   text,
  note        text,
  until       timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists idx_device_bans_did on device_bans (device_id);

-- 异常请求审核：**不自动封禁**，先记录，由管理员审批后再封 IP / 封设备
create table if not exists abuse_reviews (
  id          bigint generated by default as identity primary key,
  ip          text,
  device_id   text,
  fingerprint text,
  rule        text not null,
  detail      text,
  path        text,
  hits        int not null default 1,
  status      text not null default 'pending', -- pending | approved | rejected
  note        text,
  reviewed_by integer references users(id) on delete set null,
  reviewed_at timestamptz,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);
create index if not exists idx_abuse_reviews_status on abuse_reviews (status, last_seen desc);
create unique index if not exists uniq_abuse_reviews_pending on abuse_reviews (ip, rule) where status = 'pending';

-- 后台批量操作审计：一次 POST /api/admin/bulk 落一条，供「系统 → 批量操作记录」页查看。
-- keys_sample 只留最多 50 个键（IP/指纹/内部 id），避免一次把 1000 条 IP 写进 jsonb；
-- actor 冗余存用户名，用户被删除后记录仍可读。
create table if not exists admin_bulk_ops (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  actor_id    integer references users(id) on delete set null,
  actor       text,
  target      text not null,
  action      text not null,
  total       int not null,
  ok          int not null default 0,
  failed      int not null default 0,
  skipped     int not null default 0,
  keys_sample jsonb,
  options     jsonb,
  ip          text,
  duration_ms int
);
create index if not exists idx_admin_bulk_ops_time on admin_bulk_ops (created_at desc);
create index if not exists idx_admin_bulk_ops_target on admin_bulk_ops (target, created_at desc);
`;

// CO-4/B4 第二轮：申诉表结构已抽到 appeal-repository.js（APPEALS_DDL），此处仅消费（migrate 里建表）。

// CY 批（docs/DATA-ISOLATION.md §3）：通用审计表——管理员越权写用户私有数据时落
// action='admin.forbidden_write'（target 形如 watchlist:123），只记动作/目标/操作者快照，
// 不存被改数据内容；actor 冗余存用户名，用户被删除后记录仍可读。
const AUDIT_LOGS_DDL = `
create table if not exists audit_logs (
  id         bigserial primary key,
  actor_id   integer references users(id) on delete set null,
  actor      text,
  action     text not null,
  target     text,
  detail     jsonb,
  ip         text,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_logs_time on audit_logs (created_at desc);
create index if not exists idx_audit_logs_action on audit_logs (action, created_at desc);
`;

// CC 批（docs/SOURCE-SYNC-COVERAGE.md §3.1）：每游戏 × 每源的采集推进状态——
// pending（无行即待处理）/ matched（命中外部条目）/ nomatch（未命中，7 天重试窗口）/ failed（退避）。
const SOURCE_SYNC_DDL = `
create table if not exists game_source_sync (
  game_id        integer not null references games(id) on delete cascade,
  platform_code  text not null,
  status         text not null default 'pending',
  external_id    text,
  last_tried_at  timestamptz,
  last_ok_at     timestamptz,
  fail_count     integer not null default 0,
  last_error     text,
  primary key (game_id, platform_code)
);
create index if not exists idx_gss_pending on game_source_sync (platform_code, status, last_tried_at);
`;

// CA-1（docs/APP-NATIVE.md §3.1）：App Bearer Token——明文只出现在签发响应里，库中只存 sha256 哈希。
// CO-4/B4：表结构已抽到 app-repository.js（API_TOKENS_DDL），此处仅消费。

// CD 批（docs/SONKWO-STEAM-MATCH.md §4.5）：跨平台对齐映射落库——decision=confirmed/ignored，
// 决定对后续同组新 SKU 自动继承；skus.json 仅做兼容回落。
const GAME_SOURCE_MAP_DDL = `
create table if not exists game_source_map (
  platform_code  text not null,
  product_id     text not null,
  game_id        integer references games(id) on delete cascade,
  match_method   text,
  confidence     real,
  decision       text not null default 'confirmed',
  reviewed_by    integer,
  reviewed_at    timestamptz,
  primary key (platform_code, product_id)
);
create index if not exists idx_gsm_game on game_source_map (game_id);
`;

const ALTERS = [  'alter table games add column if not exists interested boolean not null default true',
  'alter table games add column if not exists owned boolean not null default false',
  'alter table games add column if not exists blocked boolean not null default false',
  'alter table games add column if not exists description text',
  'alter table users add column if not exists disabled boolean not null default false',
  'alter table users add column if not exists display_name text',
  'alter table users add column if not exists email text',
  'alter table users add column if not exists email_verified boolean not null default false',
  // AK-1（docs/AUTH-REDESIGN.md §3）：密码系统补列
  'alter table users add column if not exists must_change_password boolean not null default false',
  'alter table users add column if not exists failed_login_count integer not null default 0',
  'alter table users add column if not exists locked_until timestamptz',
  'alter table users add column if not exists weak_password boolean',
  'alter table users add column if not exists password_updated_at timestamptz',
  'alter table games add column if not exists developers text[]',
  'alter table games add column if not exists publishers text[]',
  // BL-3（docs/BACKFILL-THROUGHPUT.md §3.3）：回填失败隔离列
  'alter table games add column if not exists backfill_fail_count int not null default 0',
  'alter table games add column if not exists backfill_skip_until timestamptz',
  'alter table games add column if not exists genres text[]',
  'alter table games add column if not exists tags text[]',
  'alter table user_prefs add column if not exists tab text not null default \'all\'',
  // 主题偏好：'light' | 'dark' | null（null = 跟随系统）
  'alter table user_prefs add column if not exists theme text',
  // CX 批（docs/USER-PROFILE-EDIT.md §3）：头像存库（bytea + mime + source）与个人简介。
  // avatar_source：null = 无头像（前端回退首字）；'custom' = 自定义上传；'steam:<steamId>' = 默认取该绑定账号的 Steam 头像。
  'alter table users add column if not exists avatar_bytes bytea',
  'alter table users add column if not exists avatar_mime text',
  'alter table users add column if not exists avatar_source text',
  'alter table users add column if not exists avatar_updated_at timestamptz',
  'alter table users add column if not exists bio text',
  // DQ 批（docs/PROFILE-UI-2026-11-19.md §3）：默认 Steam 账号独立列——头像与 Steam 账号解耦。
  // 回填：历史 avatar_source='steam:<id>' 的「默认账号」关系迁到 default_steam_id；
  // steam: 头像来源退役清空（头像回归未设置，前端回退首字；用户可自行上传）。两者都幂等。
  'alter table users add column if not exists default_steam_id text',
  `update users set default_steam_id = split_part(avatar_source, ':', 2) where avatar_source like 'steam:%' and default_steam_id is null`,
  `update users set avatar_source = null where avatar_source like 'steam:%'`,
  // 到价提醒邮件开关（true=发邮件；用户关闭后其用户级提醒跳过邮件投递）
  'alter table user_prefs add column if not exists email_alerts boolean not null default true',
  // 逻辑删除：不真删数据，只打标记；前台与后台默认列表都排除，回收站里能看到并恢复
  'alter table games add column if not exists deleted boolean not null default false',
  'alter table games add column if not exists deleted_at timestamptz',
  // 回填标记：处理过的游戏（哪怕没拿到报价）也记一笔，避免同一批无报价游戏被每批反复选中
  'alter table games add column if not exists backfill_at timestamptz',
  // 热度（0.x 排序用）：heat=对数化评测数+新作加权；heat_reviews=Steam 评测总数；heat_at=写入时间
  'alter table games add column if not exists heat real',
  'alter table games add column if not exists heat_reviews integer',
  'alter table games add column if not exists heat_at timestamptz',
  'create index if not exists idx_games_heat on games (heat desc)',
  // B2 批（docs/DESIGN-AUDIT.md B2）：admin 列表接口提速的三条索引——
  // ① 后台游戏列表 order by updated_at desc limit 20：原全表排序 19.6 万行，是 /api/admin/games 2.1s 的主因之一；
  // ② 存活游戏部分索引：/api/admin/sync/status 的 sourceSyncStats count(*) 走 index-only，不再全表扫；
  // ③ sync_runs 的 lateral join 按 (platform_code, started_at) 找最近 fetch_runs：是 /api/admin/sync/status 1.7s 的主因之一。
  'create index if not exists idx_games_updated on games (updated_at desc nulls last, id desc)',
  'create index if not exists idx_games_live on games (id) where not deleted',
  'create index if not exists idx_fetch_runs_platform_started on fetch_runs (platform_code, started_at desc)',
  // 价格快照记录前价，报表直接算涨跌（老数据为 null，报表只看新数据）
  'alter table price_snapshots add column if not exists prev_price_cents integer',
  // 到价提醒来源：steam_wishlist 自动项可随愿望单/解绑清理
  "alter table watchlist add column if not exists source text not null default 'manual'",
  // Steam 同步状态与内容分级（docs/STEAM-SYNC-STATUS-AND-RATING.md §3）：
  // steam_status = ok / free / coming_soon / region_locked / no_price / not_found / pending（null=未探测）
  // 分级字段是"平台标签"，站点策略（前台隐藏/角标）由 site.adultDisplay 决定，不做法律定性
  'alter table games add column if not exists steam_status text',
  'alter table games add column if not exists steam_checked_at timestamptz',
  // CH 批（docs/DISCOVERY-FOR-YOU.md §2）：Deck 认证 + 好评率 + 评测数 + 采集时间
  'alter table games add column if not exists deck_compat smallint',
  'alter table games add column if not exists review_score smallint',
  'alter table games add column if not exists review_score_desc text',
  'alter table games add column if not exists review_total integer',
  'alter table games add column if not exists quality_checked_at timestamptz',
  'alter table games add column if not exists required_age integer',
  'alter table games add column if not exists content_descriptors integer[]',
  'alter table games add column if not exists age_ratings jsonb',
  'alter table games add column if not exists adult_flag boolean not null default false',
  'alter table games add column if not exists mature_flag boolean not null default false',
  // FT 批（docs/EXPLICIT-RATING.md §2.1）：explicit（严格）= descriptor 4 或 ESRB AO——
  // 色情游戏口径；adult_flag（宽，3/4/AO）保持不变（含 2077 这类含部分性内容的正常游戏）。
  'alter table games add column if not exists explicit_flag boolean not null default false',
  'create index if not exists idx_games_steam_status on games (steam_status) where steam_status is not null',
  // BK 批（docs/SESSION-MANAGEMENT.md §3.1）：会话治理补列——对外标识/客户端指纹/最近活动。
  // token 仍是主键；id 只作接口标识（绝不把 token 下发前端）。
  'alter table sessions add column if not exists id bigint generated by default as identity',
  'alter table sessions add column if not exists ip text',
  'alter table sessions add column if not exists ip_key text',
  'alter table sessions add column if not exists user_agent text',
  'alter table sessions add column if not exists ua_key text',
  'alter table sessions add column if not exists device_id text',
  'alter table sessions add column if not exists last_seen_at timestamptz',
  'create unique index if not exists ux_sessions_id on sessions (id)',
  'create index if not exists idx_sessions_user on sessions (user_id)',
  'create index if not exists idx_sessions_expires on sessions (expires_at)',
  // BP 批（docs/GAME-DLC.md §3.1）：游戏 → DLC appid 列表（appdetails.dlc[] 去重后 jsonb）+ 每个 DLC 的展示信息。
  // 明细是"占位 → 补齐"两步：先按 dlc_appids 建 (game_id, appid) 行，再由 GetItems 补名称/价格/折扣/在售。
  'alter table games add column if not exists dlc_appids jsonb',
  `create table if not exists game_dlc (
     game_id         integer not null references games(id) on delete cascade,
     appid           integer not null,
     name            text,
     price_cents     integer,
     original_cents  integer,
     discount_pct    integer not null default 0,
     currency        text,
     in_stock        boolean not null default true,
     synced_at       timestamptz,
     primary key (game_id, appid)
   )`,
  'create index if not exists idx_game_dlc_appid on game_dlc (appid)',
  // CL 批（docs/USER-ALERTS.md §2）：watchlist 用户级——user_id 列（NULL = 站点级历史数据，行为不变）。
  // PG 的 unique 对 NULL 视为互不相等，站点级必须用部分唯一索引单独约束。
  'alter table watchlist add column if not exists user_id bigint references users(id) on delete cascade',
  'alter table watchlist drop constraint if exists watchlist_game_id_region_key',
  'create unique index if not exists watchlist_user_game_uq on watchlist (user_id, game_id, region) where user_id is not null',
  'create unique index if not exists watchlist_site_game_uq on watchlist (game_id, region) where user_id is null',
  'create index if not exists idx_watchlist_user on watchlist (user_id, created_at desc)',
  // DA 批（docs/APP-FILTER-SERVER-SIDE.md §5）：user_prefs.only_discount 是死字段（存但 gameSearch 从未使用）
  // → drop 列避免两套真相；unreleased 筛选/sort=release 走 release_date 索引；discountOnly 走部分索引。
  'alter table user_prefs drop column if exists only_discount',
  'create index if not exists idx_games_release_date on games (release_date desc nulls last)',
  'create index if not exists idx_offers_discount on offers (game_id) where discount_pct > 0',
  // DS 批（docs/SEARCH-ALIASES.md §1）：搜索派生 token——纯派生数据（非人工录入），
  // search_tokens_at 作「名字已变更」的增量重算信号（updated_at > search_tokens_at 即重算）。
  // GIN 索引在 migrate() 的 try/catch 里建（pglite 无 GIN 时跳过，与 tags/trgm 同模式）。
  "alter table games add column if not exists search_tokens text[] not null default '{}'",
  'alter table games add column if not exists search_tokens_at timestamptz',
];

// FP 批 P2（docs/SYNC-HARDENING.md §2）：429 补跑队列——撞 429 收轮的 appid 入队，
// 下一轮回填/状态判定优先补这些（attempts 少的先补），补成功清队。
export const SYNC_429_DDL = `
create table if not exists sync_429_queue (
  id            bigint generated by default as identity primary key,
  steam_appid   integer unique not null,
  attempts      integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);
`;

export async function migrate(store, { logger = null } = {}) {
  await store.exec(SCHEMA);
  await store.exec(USER_SCHEMA);
  // 申诉系统（O/BQ）：users 表已建，可直接带外键建表（幂等，每次启动跑一次）
  await store.exec(APPEALS_DDL);
  // CY 批（docs/DATA-ISOLATION.md §3）：管理员越权写审计表（幂等）
  await store.exec(AUDIT_LOGS_DDL);
  // CC 批（docs/SOURCE-SYNC-COVERAGE.md §3.1）：四源推进状态表 + 从既有 offers 回填 matched
  await store.exec(SOURCE_SYNC_DDL);
  // CA-1（docs/APP-NATIVE.md §3.1）：App Bearer Token 表（幂等）
  await store.exec(API_TOKENS_DDL);
  // CD 批（docs/SONKWO-STEAM-MATCH.md §4.5）：对齐映射表（幂等）
  await store.exec(GAME_SOURCE_MAP_DDL);
  // DL 批（docs/ALIGN-SNAPSHOT.md §3）：对齐审核快照表（幂等；created_at 补列供签名 §4 的
  // max(coalesce(reviewed_at, created_at)) 使用——老行迁移时统一取 now()，首次生成后签名即稳定）
  await store.exec(ALIGN_SNAPSHOTS_DDL);
  // FP 批 P2（docs/SYNC-HARDENING.md §2）：429 补跑队列表（幂等）
  await store.exec(SYNC_429_DDL);
  await store.exec('alter table game_source_map add column if not exists created_at timestamptz not null default now()');
  // CH 批（docs/DISCOVERY-FOR-YOU.md §2）：行为学习两张表 + tags GIN 预过滤索引
  await store.exec(`
create table if not exists user_behaviors (
  id       bigint generated by default as identity primary key,
  user_id  integer not null references users(id) on delete cascade,
  game_id  integer references games(id) on delete cascade,
  action   text not null,
  weight   smallint not null default 1,
  count    integer not null default 1,
  first_at timestamptz not null default now(),
  last_at  timestamptz not null default now(),
  unique (user_id, game_id, action)
);
create index if not exists idx_user_behaviors_user on user_behaviors (user_id, last_at desc);
create table if not exists user_search_logs (
  id               bigint generated by default as identity primary key,
  user_id          integer not null references users(id) on delete cascade,
  query            text not null,
  clicked_game_id  integer references games(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists idx_user_search_logs_user on user_search_logs (user_id, created_at desc);
`);
  try {
    await store.exec('create index if not exists games_tags_gin on games using gin (tags)');
  } catch {
    /* pglite 无 GIN 时跳过（与 pg_trgm 同模式） */
  }
  // DS 批（docs/SEARCH-ALIASES.md §1）：search_tokens 的 GIN 索引——`&&`（数组包含）走它。
  // 本地 pglite 无 GIN：跳过不中断（生产 PostgreSQL 15 建索引）。
  try {
    await store.exec('create index if not exists games_search_tokens_gin on games using gin (search_tokens)');
  } catch {
    /* pglite 无 GIN 时跳过 */
  }
  await store.query(
    `insert into game_source_sync (game_id, platform_code, status)
     select distinct o.game_id, o.platform_code, 'matched'
       from offers o
      where o.platform_code in ('itad', 'gog', 'humble', 'sonkwo')
     on conflict (game_id, platform_code) do nothing`,
  );
  // 老库补列：必须幂等，容器每次启动都会跑
  for (const ddl of ALTERS) {
    await store.exec(ddl);
  }
  // CR 批（docs/APP-DEV-PUBLISHER-NAMES.md §3 CR-2）：历史脏元素清洗（幂等）——
  // GetItems 旧实现把对象数组原样写进 text[]，元素成了 `{"name":…,"creator_clan_account_id":…}` 文本；
  // 这里解析取 name，去空/去重保序/上限 20/单条截断 200（与 store-browse.namesFromList 同口径）。无脏行不更新。
  // ⚠️ v2.24.2 修复（线上 22P02 事故）：不再用 `::jsonb` 解析——生产存在非法 JSON 元素（截断/无引号键），
  // cast 失败会让整条 UPDATE 抛错、bootstrap 崩溃重启循环；且第一轮清洗出的 name 值本身可能以 `{` 开头，
  // 按「以 { 开头」判定会被二次误解析。现改为：
  //  ① 纯正则提取 `"name":"…"` 的值（不做任何 JSON 解析，永不抛错；非法/无匹配 → 丢弃该元素）；
  //  ② WHERE 收紧为「元素含 `"name":` 特征」——清洗产物不再被二次命中，幂等稳定。
  for (const col of ['developers', 'publishers']) {
    await store.query(
      `update games set ${col} = (
         select array_agg(n order by first_ord) from (
           select n, min(ord) as first_ord from (
             select left(case when e ~ '"name"\\s*:' then nullif(btrim(substring(e from '"name"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"')), '') else nullif(btrim(e), '') end, 200) as n, ord
               from unnest(${col}) with ordinality as t(e, ord)
           ) x where n is not null group by n order by min(ord) limit 20
         ) y
       ) where ${col} is not null and exists (select 1 from unnest(${col}) e where e ~ '"name"\\s*:')`,
    );
  }
  await store.query(
    `insert into platforms (code, name, kind) values
       ('steam',   'Steam 国区', 'official'),
       ('sonkwo',  '杉果',       'authorized_reseller'),
       ('itad',    'ITAD 聚合',  'authorized_reseller'),
       ('fanatical','Fanatical', 'authorized_reseller'),
       ('humble',  'Humble',     'authorized_reseller'),
       ('gog',     'GOG',        'authorized_reseller'),
       ('steampy', 'SteamPy',    'c2c')
     on conflict (code) do update set name = excluded.name, kind = excluded.kind`,
  );
  // 黑/白名单互斥的存量清理（docs/BAN-AND-SECURITY-FIXES.md §4.3，幂等，每次启动跑一次）：
  // 白名单优先——同时存在于两表的 IP 删掉黑名单条目（与运行时"白名单胜出"一致），
  // 并清掉被白名单覆盖的临时封禁，避免「白名单里却显示正在封禁」。
  await store.query('delete from ip_blacklist b using ip_whitelist w where b.ip = w.ip');
  await store.query(
    `update ip_abuse a
        set banned_until = null
       from ip_whitelist w
      where a.ip = w.ip and a.banned_until is not null`,
  );
  // BJ 批 H1（docs/BAN-AND-SECURITY-FIXES.md §10.4.5）：同样清掉被黑名单覆盖的临时封禁字段
  // （行保留做审计；只处理精确相等，CIDR 覆盖由运行时判定）。幂等：第二次跑清 0 行。
  await store.query(
    `update ip_abuse a
        set banned_until = null,
            ban_source   = null,
            updated_at   = now()
       from ip_blacklist b
      where a.ip = b.ip and a.banned_until is not null`,
  );
  // 免费游戏一次性置位（docs/STEAM-SYNC-STATUS-AND-RATING.md §3/§6）：is_free 已已知，
  // 免费永远无价，不需要再发请求；置位后 9.2 万「待同步」立刻拆出 2.3 万免费。
  await store.query(`update games set steam_status = 'free' where is_free and steam_status is null`);
  // BM-2（docs/SESSION-MANAGEMENT.md §8.4.2）：老会话 last_seen_at = now()——空闲超时的起点是
  // "部署/首次活动这一刻"，而不是 created_at（否则登录超过 7 天的会话在部署后第一次请求就被判空闲过期，
  // v2.11.0 线上发生过）。已执行过旧迁移的库列已非空，这条语句不会再命中 → 幂等、不延长 expires_at。
  // ip_key/ua_key 保持 null——绑定校验只对"两个 key 都非空"的新会话生效，老会话不误踢。
  await store.query('update sessions set last_seen_at = now() where last_seen_at is null');
  // D1（docs/ROADMAP.md）：模糊搜索 pg_trgm 表达式索引——与 AD 批 gameKeywordSql 的字段侧归一化
  // 表达式完全一致（去半角/全角空格 + 小写），LIKE '%kw%' 才能走 GIN 索引。
  // 本地 pglite 不带 pg_trgm 扩展：失败只跳过、不中断迁移（生产 PostgreSQL 15 会成功建索引）。
  try {
    await store.exec('create extension if not exists pg_trgm');
    await store.exec(
      "create index if not exists games_name_trgm on games using gin (replace(replace(lower(coalesce(name,'')),' ',''),'　','') gin_trgm_ops)",
    );
    await store.exec(
      "create index if not exists games_name_en_trgm on games using gin (replace(replace(lower(coalesce(name_en,'')),' ',''),'　','') gin_trgm_ops)",
    );
    await store.exec(
      "create index if not exists game_aliases_title_trgm on game_aliases using gin (replace(replace(lower(coalesce(platform_title,'')),' ',''),'　','') gin_trgm_ops)",
    );
  } catch (err) {
    // 本地 pglite（WASM 版）没有 pg_trgm：静默跳过，生产建索引
  }
  // AY 批（docs/READ-MODEL.md §10）：首页默认排序是 `g.heat desc nulls last`，而现有
  // idx_games_heat 是 btree (heat DESC)（= NULLS FIRST），顺序不匹配用不上，生产实测
  // 3 个 worker 各自 external merge（落盘 4.5MB）再归并。按查询口径建 live 行部分索引。
  await store.exec(
    'create index if not exists games_heat_live on games (heat desc nulls last) ' +
      'where not deleted and not adult_flag and not blocked',
  );
  // BL-3（docs/BACKFILL-THROUGHPUT.md §3.3）：回填失败隔离——连续 3 次拿不到元数据跳过 30 天
  await store.exec(
    'create index if not exists idx_games_backfill_skip on games (backfill_skip_until) where backfill_skip_until is not null',
  );
  // AV 批（docs/READ-MODEL.md §3/§6）：首页列表读模型——(game, region) 粒度的价格/史低快照。
  // 表空时一次性回填（offers ∪ daily_prices 并集）；回填失败必须报错不吞（列表暂时为空需人工介入，规格 §7）。
  // B5 批（docs/DESIGN-AUDIT.md B5 行）：offers/daily_prices 补 updated_at 作为「底层数据比快照新」的
  // 增量对账信号（readModelCheck 变更优先候选）；ALTER 必须排在回填之前，避免旧行默认值晚于快照造成
  // 首轮对账大面积误报。列只加不改语义，幂等。
  await store.exec('alter table offers add column if not exists updated_at timestamptz not null default now()');
  await store.exec('alter table daily_prices add column if not exists updated_at timestamptz not null default now()');
  await store.exec(GAME_REGION_SNAPSHOT_DDL);
  const empty = await store.query('select count(*)::int as n from game_region_snapshot limit 1');
  if (Number(empty.rows[0]?.n ?? 0) === 0) {
    logger?.info('readmodel.backfill_start', {});
    const started = Date.now();
    await backfillGameRegionSnapshot((sql, p) => store.query(sql, p));
    logger?.info('readmodel.backfill_done', { elapsedMs: Date.now() - started });
  }
}

export async function upsertPlatform(q, { code, name, kind }) {
  // 不把已有的 official 降级成 authorized_reseller（ITAD 里的 Steam 店就是这种情况）
  await q(
    `insert into platforms (code, name, kind) values ($1, $2, $3)
     on conflict (code) do update set name = excluded.name,
       kind = case when platforms.kind = 'official' then platforms.kind else excluded.kind end`,
    [code, name ?? code, kind ?? 'authorized_reseller'],
  );
}

/**
 * 全量目录导入：`IStoreService/GetAppList` 没有语言参数，返回的是基础名
 * （绝大多数英文）。直接把英文写进 `name` 会占死中文名槽位（后面所有补名字的
 * 写入都只补空缺），所以按内容分流：含中文的写 `name`（国产游戏基础名本来就是
 * 中文），否则写 `name_en`，`name` 留空等回填用 schinese 本地化名补上。
 */
export async function importCatalogGames(q, apps = []) {
  const pairs = (apps ?? []).filter((a) => Number.isFinite(Number(a?.appid)) && Number(a.appid) > 0);
  const ids = pairs.map((a) => Number(a.appid));
  const names = pairs.map((a) => String(a.name ?? '').trim());
  if (!ids.length) return 0;
  const r = await q(
    `insert into games (steam_appid, name, name_en)
     select x.appid,
            case when x.name ~ '[一-龥]' then x.name else null end,
            case when x.name ~ '[一-龥]' then null else nullif(x.name, '') end
       from unnest($1::int[], $2::text[]) as x(appid, name)
      where not exists (select 1 from games g where g.steam_appid = x.appid)`,
    [ids, names],
  );
  return r.rowCount ?? 0;
}

export async function ensureGame(q, { steamAppid = null, name = null, nameEn = null, meta = null }) {
  if (steamAppid != null) {
    const found = await q('select id, name, name_en from games where steam_appid = $1', [steamAppid]);
    if (found.rows.length) {
      const row = found.rows[0];
      // 名字策略（与 upsertGameMeta 一致）：只补空缺，唯一例外是"机器英文名"——
      // 目录导入（GetAppList 无本地化）把英文名写进了 name（旧版）或 name_en（新版），
      // 表现为 name 不含中文、name_en 为空或与 name 相同。这种情况允许用新拿到的
      // 中文名覆盖，并把被替换的英文名挪进 name_en。
      const empty = (v) => v == null || String(v).trim() === '';
      const hasZh = (v) => /[\u4e00-\u9fa5]/.test(String(v ?? ''));
      const machineEnglish =
        (empty(row.name_en) || row.name_en === row.name) && !empty(row.name) && !hasZh(row.name);
      const patchName = name && (empty(row.name) || (machineEnglish && hasZh(name)));
      const patchNameEn = nameEn && empty(row.name_en);
      const moveNameEn =
        patchName && machineEnglish && empty(row.name_en) && !/^appid:\d+$/.test(String(row.name))
          ? row.name
          : null;
      if (patchName || patchNameEn || moveNameEn) {
        const r = await q(
          `update games set name = coalesce($1, name), name_en = coalesce($2, name_en), updated_at = now()
            where id = $3 returning id, name, name_en`,
          [patchName ? name : null, moveNameEn ?? (patchNameEn ? nameEn : null), row.id],
        );
        // DS 批：名字动了就顺带重算 search_tokens（is distinct from 幂等）
        await refreshSearchTokens(q, { id: Number(r.rows[0].id), name: r.rows[0].name, nameEn: r.rows[0].name_en });
      } else {
        await q('update games set updated_at = now() where id = $1', [row.id]);
      }
      return { id: Number(row.id), created: false };
    }
  } else if (name) {
    const found = await q('select id, name, name_en from games where name = $1 and steam_appid is null', [name]);
    if (found.rows.length) {
      const row = found.rows[0];
      // 没有 appid 的行也要能补英文名（杉果页面带 sku_ename，首次采集时可能还没有）
      if (nameEn && !row.name_en) {
        const r = await q('update games set name_en = $1, updated_at = now() where id = $2 returning id, name, name_en', [nameEn, row.id]);
        // DS 批：补英文名顺带重算 search_tokens
        await refreshSearchTokens(q, { id: Number(r.rows[0].id), name: r.rows[0].name, nameEn: r.rows[0].name_en });
      } else {
        await q('update games set updated_at = now() where id = $1', [row.id]);
      }
      return { id: Number(row.id), created: false };
    }
  }

  const inserted = await q(
    `insert into games (steam_appid, name, name_en, app_type, is_free, header_image, release_date, search_tokens)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [
      steamAppid,
      name,
      nameEn,
      meta?.appType ?? null,
      Boolean(meta?.isFree),
      meta?.headerImage ?? null,
      meta?.releaseDate ?? null,
      // DS 批：新行直接带派生 token（与写库同一条 SQL）
      deriveSearchTokens({ name, nameEn }),
    ],
  );
  return { id: Number(inserted.rows[0].id), created: true };
}

export async function upsertAlias(q, { gameId, platformCode, title, productId, method = 'appid', confidence = 1.0 }) {
  await q(
    `insert into game_aliases (game_id, platform_code, platform_title, platform_product_id, match_method, confidence)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (platform_code, platform_product_id)
     do update set game_id = excluded.game_id, platform_title = excluded.platform_title`,
    [gameId, platformCode, title, productId, method, confidence],
  );
}

export async function findOffer(q, { gameId, platformCode, productType, region }) {
  const r = await q(
    `select id, price_cents from offers
      where game_id = $1 and platform_code = $2 and product_type = $3 and region = $4`,
    [gameId, platformCode, productType, region],
  );
  return r.rows[0] ?? null;
}

export async function insertOffer(q, offer) {
  const r = await q(
    `insert into offers (game_id, platform_code, product_type, region, currency, price_cents,
                         original_cents, discount_pct, in_stock, buy_url)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
    [
      offer.gameId,
      offer.platformCode,
      offer.productType,
      offer.region,
      offer.currency,
      offer.priceCents,
      offer.originalCents,
      offer.discountPct,
      offer.inStock,
      offer.buyUrl,
    ],
  );
  return Number(r.rows[0].id);
}

export async function updateOffer(q, offerId, offer) {
  await q(
    `update offers set price_cents=$1, original_cents=$2, discount_pct=$3,
                       in_stock=$4, buy_url=$5, last_seen_at=now(), updated_at=now()
      where id=$6`,
    [offer.priceCents, offer.originalCents, offer.discountPct, offer.inStock, offer.buyUrl, offerId],
  );
}

/** 最近一条快照：哈希用于判重，价格用于报表算涨跌。 */
export async function lastSnapshot(q, offerId) {
  const r = await q(
    'select raw_hash, price_cents, in_stock from price_snapshots where offer_id=$1 order by captured_at desc, id desc limit 1',
    [offerId],
  );
  const row = r.rows[0];
  if (!row) return null;
  return { hash: row.raw_hash, priceCents: row.price_cents, inStock: row.in_stock };
}

/** 兼容旧调用方：只要哈希。 */
export async function lastSnapshotHash(q, offerId) {
  const snap = await lastSnapshot(q, offerId);
  return snap?.hash ?? null;
}

export async function insertSnapshot(q, offerId, offer, hash, prevPriceCents = null) {
  await q(
    `insert into price_snapshots (offer_id, price_cents, original_cents, discount_pct, in_stock, raw_hash, prev_price_cents)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [offerId, offer.priceCents, offer.originalCents, offer.discountPct, offer.inStock, hash, prevPriceCents],
  );
}

// ---------------------------------------------------------------- 价格变动报表

/**
 * 近 N 小时（或从某个时间点起）的价格变动：降价榜 / 涨价榜 + 汇总。
 * 只统计带 prev_price_cents 的新快照；同一条 offer 多次变化只取最后一次，避免重复计数。
 */
export async function priceChanges(q, { hours = 24, sinceMs = null, limit = 10 } = {}) {
  const spanSec = Math.max(
    1,
    sinceMs
      ? Math.round((Date.now() - Number(sinceMs)) / 1000)
      : Math.round(Math.min(Math.max(Number(hours) || 24, 1), 24 * 30) * 3600),
  );
  const span = String(spanSec) + ' seconds';
  const top = Math.min(Math.max(Number(limit) || 10, 1), 100);
  const base = `
    with latest as (
      select distinct on (s.offer_id)
             s.offer_id, s.price_cents, s.prev_price_cents, s.captured_at
        from price_snapshots s
       where s.captured_at > now() - $1::interval
         and s.prev_price_cents is not null
         and s.prev_price_cents <> s.price_cents
       order by s.offer_id, s.captured_at desc, s.id desc
    )
    select g.id as game_id, g.steam_appid,
           coalesce(nullif(g.name, ''), nullif(g.name_en, ''), 'appid:' || g.steam_appid) as name,
           p.code as platform, p.name as platform_name,
           l.prev_price_cents as was, l.price_cents as now_price,
           l.captured_at, (l.prev_price_cents - l.price_cents) as drop_cents
      from latest l
      join offers o on o.id = l.offer_id
      join games g on g.id = o.game_id
      join platforms p on p.code = o.platform_code
     where not g.deleted`;
  const drops = (await q(`${base} order by drop_cents desc limit $2`, [span, top])).rows.filter((x) => x.drop_cents > 0);
  const rises = (await q(`${base} order by drop_cents asc limit $2`, [span, top])).rows.filter((x) => x.drop_cents < 0);
  const counts = await q(
    `with latest as (
       select distinct on (s.offer_id) s.offer_id, s.price_cents, s.prev_price_cents
         from price_snapshots s
        where s.captured_at > now() - $1::interval
          and s.prev_price_cents is not null
          and s.prev_price_cents <> s.price_cents
        order by s.offer_id, s.captured_at desc, s.id desc
     )
     select count(*) filter (where prev_price_cents > price_cents)::int as drops,
            count(*) filter (where prev_price_cents < price_cents)::int as rises,
            count(*)::int as changed
       from latest`,
    [span],
  );
  const row = counts.rows[0] ?? { drops: 0, rises: 0, changed: 0 };
  // 新史低：本窗口内降价的游戏里，现价 ≤ 该游戏历史最低（日聚合最小值）的条数
  const lows = await q(
    `with latest as (
       select distinct on (s.offer_id) s.offer_id, s.price_cents, s.prev_price_cents
         from price_snapshots s
        where s.captured_at > now() - $1::interval
          and s.prev_price_cents is not null
          and s.prev_price_cents <> s.price_cents
        order by s.offer_id, s.captured_at desc, s.id desc
     )
     select count(*)::int as n
       from latest l
       join offers o on o.id = l.offer_id
       join games g on g.id = o.game_id
      where l.prev_price_cents > l.price_cents
        and not g.deleted
        and l.price_cents <= coalesce((
              select min(dp.min_price_cents)
                from daily_prices dp
                join platforms pp on pp.code = dp.platform_code
               where dp.game_id = g.id and pp.kind in ${OFFICIAL_KINDS}
            ), l.price_cents)`,
    [span],
  );
  return {
    hours: Math.round((spanSec / 3600) * 10) / 10,
    changed: Number(row.changed ?? 0),
    drops: Number(row.drops ?? 0),
    rises: Number(row.rises ?? 0),
    newLows: Number(lows.rows[0]?.n ?? 0),
    topDrops: drops,
    topRises: rises,
  };
}

/** 按天统计价格变动（近 N 天），用于日报/周报趋势。 */
export async function priceChangesByDay(q, { days = 7 } = {}) {
  const span = String(Math.min(Math.max(Number(days) || 7, 1), 365)) + ' days';
  const r = await q(
    `select d.day::text as day,
            count(*) filter (where d.prev > d.cur)::int as drops,
            count(*) filter (where d.prev < d.cur)::int as rises,
            count(*)::int as changed
       from (
         select date_trunc('day', s.captured_at)::date as day,
                s.price_cents as cur, s.prev_price_cents as prev
           from price_snapshots s
          where s.captured_at > now() - $1::interval
            and s.prev_price_cents is not null
            and s.prev_price_cents <> s.price_cents
       ) d
      group by d.day
      order by d.day desc`,
    [span],
  );
  return r.rows.map((x) => ({
    day: x.day,
    drops: Number(x.drops ?? 0),
    rises: Number(x.rises ?? 0),
    changed: Number(x.changed ?? 0),
  }));
}

// ---------------------------------------------------------------- CC 批（docs/SOURCE-SYNC-COVERAGE.md §3.2）
// 每源候选：pending（无行，热度/近 90 天访问优先）→ nomatch（7 天窗口）→ matched（按源间隔刷新）
// → failed（fail_count 退避 2^n 天上限 30 天）。同一游戏同一源只取一次（按状态分组排序）。
export async function sourceSyncCandidates(q, { platform, limit = 50, refreshInterval = '24 hours' }) {
  const n = Math.min(Math.max(Number(limit) || 50, 1), 1000);
  const r = await q(
    `select g.id as game_id, g.steam_appid, g.name, g.name_en,
            coalesce(s.status, 'pending') as status,
            s.external_id, s.last_tried_at, s.last_ok_at, s.fail_count
       from games g
       left join game_source_sync s on s.game_id = g.id and s.platform_code = $2
      where not g.deleted
        and coalesce(nullif(g.name, ''), nullif(g.name_en, '')) is not null
        and (
          s.status is null
          or (s.status = 'nomatch' and (s.last_tried_at is null or s.last_tried_at < now() - interval '7 days'))
          or (s.status = 'matched' and (s.last_ok_at is null or s.last_ok_at < now() - $3::interval))
          or (s.status = 'failed' and (s.last_tried_at is null or s.last_tried_at < now() - make_interval(days => least(30, (2 ^ least(coalesce(s.fail_count, 0), 5))::int))))
        )
      order by
        case coalesce(s.status, 'pending') when 'pending' then 0 when 'nomatch' then 1 when 'matched' then 2 else 3 end,
        (select count(*) from page_views pv where pv.appid = g.steam_appid and pv.created_at > now() - interval '90 days') desc,
        coalesce(g.heat, 0) desc nulls last,
        g.id
      limit $1`,
    [n, String(platform), String(refreshInterval)],
  );
  return r.rows;
}

/** 写入单条状态：命中（ok=true）置 matched + last_ok_at + external_id；未命中 nomatch；异常 failed（fail_count+1）。 */
export async function sourceSyncMark(q, { gameId, platform, status, externalId = null, ok = false, error = null }) {
  await q(
    `insert into game_source_sync (game_id, platform_code, status, external_id, last_tried_at, last_ok_at, fail_count, last_error)
     values ($1, $2, $3, $4, now(), case when $5 then now() else null end, case when $5 then 0 else 1 end, $6)
     on conflict (game_id, platform_code) do update set
       status = excluded.status,
       external_id = coalesce(excluded.external_id, game_source_sync.external_id),
       last_tried_at = excluded.last_tried_at,
       last_ok_at = case when $5 then now() else game_source_sync.last_ok_at end,
       fail_count = case when $5 then 0 else game_source_sync.fail_count + 1 end,
       last_error = excluded.last_error`,
    [Number(gameId), String(platform), String(status), externalId, Boolean(ok), error],
  );
}

/** 每源状态汇总：matched/nomatch/failed/pending（pending = 无状态行的存活游戏）。 */
export async function sourceSyncStats(q) {
  const totalRow = await q('select count(*)::int as n from games where not deleted');
  const rows = await q(
    `select platform_code, status, count(*)::int as n from game_source_sync group by platform_code, status`,
  );
  const total = Number(totalRow.rows[0]?.n ?? 0);
  const byPlatform = {};
  for (const r of rows.rows) {
    byPlatform[r.platform_code] = byPlatform[r.platform_code] || { matched: 0, nomatch: 0, failed: 0, pending: 0 };
    byPlatform[r.platform_code][String(r.status) === 'pending' ? 'pending' : String(r.status)] = Number(r.n ?? 0);
  }
  for (const p of Object.keys(byPlatform)) {
    byPlatform[p].pending = Math.max(0, total - (byPlatform[p].matched + byPlatform[p].nomatch + byPlatform[p].failed));
  }
  return { total, byPlatform };
}

/** 窗口内的全部价格变动明细（CSV 导出用，最多 5000 条）。 */
export async function priceChangeRows(q, { hours = 24, sinceMs = null, limit = 5000 } = {}) {
  const spanSec = Math.max(
    1,
    sinceMs
      ? Math.round((Date.now() - Number(sinceMs)) / 1000)
      : Math.round(Math.min(Math.max(Number(hours) || 24, 1), 24 * 30) * 3600),
  );
  const r = await q(
    `with latest as (
       select distinct on (s.offer_id)
              s.offer_id, s.price_cents, s.prev_price_cents, s.captured_at
         from price_snapshots s
        where s.captured_at > now() - $1::interval
          and s.prev_price_cents is not null
          and s.prev_price_cents <> s.price_cents
        order by s.offer_id, s.captured_at desc, s.id desc
     )
     select g.steam_appid, coalesce(nullif(g.name, ''), nullif(g.name_en, ''), 'appid:' || g.steam_appid) as name,
            p.code as platform, p.name as platform_name,
            l.prev_price_cents as was, l.price_cents as now_price,
            l.captured_at
       from latest l
       join offers o on o.id = l.offer_id
       join games g on g.id = o.game_id
       join platforms p on p.code = o.platform_code
      where not g.deleted
      order by l.captured_at desc
      limit $2`,
    [String(spanSec) + ' seconds', Math.min(Math.max(Number(limit) || 5000, 1), 5000)],
  );
  return r.rows;
}

export async function upsertDaily(q, { gameId, platformCode, region, priceCents, currency }) {
  await q(
    `insert into daily_prices (game_id, platform_code, region, day, min_price_cents, currency)
     values ($1,$2,$3, current_date, $4,$5)
     on conflict (game_id, platform_code, region, day)
     do update set min_price_cents = least(daily_prices.min_price_cents, excluded.min_price_cents),
                   updated_at = now()`,
    [gameId, platformCode, region, priceCents, currency],
  );
}

// ---------------------------------------------------------------- 首页列表读模型（docs/READ-MODEL.md，AV 批）
//
// 目标：把「每次请求现算全库聚合」改成「入库时算一次、读的时候只查一行」。
// 写入方只有 ingestOffers（唯一写 offers）+ mergeGames（唯一删/移 offers），同库强一致，不需要队列。
//
// B5 批（docs/DESIGN-AUDIT.md B5 行）：本表全部 INSERT/UPDATE/DELETE 收敛到下方唯一的
// snapshotWrite 网关（SQL 常量表 + 一个执行函数），杜绝任何函数绕过维护钩子直写快照——
// test/read-model-guard.test.js 静态锁：src/ 下除网关块外的任何直写语句都会让测试变红。
// 新增维护逻辑时 SQL 必须进 SNAPSHOT_WRITE_SQL、经 snapshotWrite 调用；维护钩子本身
// （refresh*/touch/backfill）是「唯一写入路径」的对外入口，调用方（ingest/mergeGames/
// migrate/check --fix）一律走它们，不得自拼 SQL。

const GAME_REGION_SNAPSHOT_DDL = `
create table if not exists game_region_snapshot (
  game_id           bigint not null references games(id) on delete cascade,
  region            text   not null,
  -- 当前价（官方渠道 = official + authorized_reseller，仅 in_stock）
  price_cents       integer,
  currency          text,
  original_cents    integer,
  discount_pct      integer,
  steam_price_cents integer,            -- 只看 Steam 平台的最低在售价
  low_platform      text,
  low_platform_name text,
  platform_names    text[],             -- 该区服在售的平台名（卡片标签）
  offers_count      integer not null default 0,
  last_seen_at      timestamptz,
  -- 历史（来自 daily_prices 的日聚合）
  hist_low_cents       integer,
  prev_hist_low_cents  integer,         -- 今天以前的史低（「新史低」角标）
  hist_low_day         date,            -- hist_low 最新覆盖到哪一天（日界切换用）
  updated_at        timestamptz not null default now(),
  primary key (game_id, region)
);

-- 列表排序/筛选（只覆盖有当前价的行）
create index if not exists grs_region_discount on game_region_snapshot (region, discount_pct desc, price_cents asc) where price_cents is not null;
create index if not exists grs_region_price    on game_region_snapshot (region, price_cents asc) where price_cents is not null;
create index if not exists grs_region_seen     on game_region_snapshot (region, last_seen_at desc) where price_cents is not null;
-- 计数与 join 用
create index if not exists grs_game on game_region_snapshot (game_id);
`;

// 官方渠道集合（snapshot 全部 SQL 共用；声明在网关之前，模板串在模块加载期就要取值）
// 跨域通用 SQL 片段：watchlist-repository.js 经 import 引用（live binding），不复制防漂移。
export const OFFICIAL_KINDS = "('official', 'authorized_reseller')";

// <snapshot-write-gateway>
// B5 批：game_region_snapshot 的唯一写入网关——全部写语句收在这张表里，经 snapshotWrite 执行。
// 静态锁 test/read-model-guard.test.js 校验：本块之外（含 migrate 与其它文件）出现任何
// insert/update/delete into game_region_snapshot 都会变红。加新语句必须进这张表。
const SNAPSHOT_WRITE_SQL = {
  backfillPrices: `
    insert into game_region_snapshot (game_id, region, price_cents, currency, original_cents, discount_pct,
        steam_price_cents, low_platform, low_platform_name, platform_names, offers_count, last_seen_at)
     select o.game_id, o.region,
       min(o.price_cents) filter (where o.in_stock and p.kind in ${OFFICIAL_KINDS}) as current_low,
       (array_agg(o.currency order by o.price_cents) filter (where o.in_stock and p.kind in ${OFFICIAL_KINDS}))[1],
       min(o.original_cents) filter (where o.in_stock and p.kind in ${OFFICIAL_KINDS}),
       max(o.discount_pct) filter (where o.in_stock and p.kind in ${OFFICIAL_KINDS}),
       min(o.price_cents) filter (where o.in_stock and o.platform_code = 'steam'),
       (array_agg(o.platform_code order by o.price_cents) filter (where o.in_stock and p.kind in ${OFFICIAL_KINDS}))[1],
       (array_agg(p.name order by o.price_cents) filter (where o.in_stock and p.kind in ${OFFICIAL_KINDS}))[1],
       array_agg(distinct p.name) filter (where o.in_stock and p.kind in ${OFFICIAL_KINDS}),
       count(*) filter (where o.in_stock and p.kind in ${OFFICIAL_KINDS}),
       max(o.last_seen_at)
       from offers o join platforms p on p.code = o.platform_code
      group by o.game_id, o.region
     on conflict (game_id, region) do update set
       price_cents = excluded.price_cents, currency = excluded.currency, original_cents = excluded.original_cents,
       discount_pct = excluded.discount_pct, steam_price_cents = excluded.steam_price_cents,
       low_platform = excluded.low_platform, low_platform_name = excluded.low_platform_name,
       platform_names = excluded.platform_names, offers_count = excluded.offers_count,
       last_seen_at = excluded.last_seen_at, updated_at = now()`,
  backfillRows: `
    insert into game_region_snapshot (game_id, region)
     select distinct d.game_id, d.region from daily_prices d
     on conflict (game_id, region) do nothing`,
  backfillHist: `
    update game_region_snapshot rs
        set hist_low_cents = t.hist, prev_hist_low_cents = t.prev, hist_low_day = current_date, updated_at = now()
       from (
         select d.game_id, d.region,
           min(d.min_price_cents) filter (where p.kind in ${OFFICIAL_KINDS}) as hist,
           min(d.min_price_cents) filter (where d.day < current_date and p.kind in ${OFFICIAL_KINDS}) as prev
           from daily_prices d join platforms p on p.code = d.platform_code
          group by d.game_id, d.region
       ) t
      where rs.game_id = t.game_id and rs.region = t.region`,
  prices: `
    insert into game_region_snapshot (game_id, region, price_cents, currency, original_cents, discount_pct,
        steam_price_cents, low_platform, low_platform_name, platform_names, offers_count, last_seen_at)
     select o.game_id, o.region,
       min(o.price_cents) filter (where o.in_stock and p.kind in ${OFFICIAL_KINDS}) as current_low,
       (array_agg(o.currency order by o.price_cents) filter (where o.in_stock and p.kind in ${OFFICIAL_KINDS}))[1],
       min(o.original_cents) filter (where o.in_stock and p.kind in ${OFFICIAL_KINDS}),
       max(o.discount_pct) filter (where o.in_stock and p.kind in ${OFFICIAL_KINDS}),
       min(o.price_cents) filter (where o.in_stock and o.platform_code = 'steam'),
       (array_agg(o.platform_code order by o.price_cents) filter (where o.in_stock and p.kind in ${OFFICIAL_KINDS}))[1],
       (array_agg(p.name order by o.price_cents) filter (where o.in_stock and p.kind in ${OFFICIAL_KINDS}))[1],
       array_agg(distinct p.name) filter (where o.in_stock and p.kind in ${OFFICIAL_KINDS}),
       count(*) filter (where o.in_stock and p.kind in ${OFFICIAL_KINDS}),
       max(o.last_seen_at)
       from offers o join platforms p on p.code = o.platform_code
      where o.game_id = $1
      group by o.game_id, o.region
     on conflict (game_id, region) do update set
       price_cents = excluded.price_cents, currency = excluded.currency, original_cents = excluded.original_cents,
       discount_pct = excluded.discount_pct, steam_price_cents = excluded.steam_price_cents,
       low_platform = excluded.low_platform, low_platform_name = excluded.low_platform_name,
       platform_names = excluded.platform_names, offers_count = excluded.offers_count,
       last_seen_at = excluded.last_seen_at, updated_at = now()`,
  histRows: `
    insert into game_region_snapshot (game_id, region)
     select distinct d.game_id, d.region from daily_prices d where d.game_id = $1
     on conflict (game_id, region) do nothing`,
  hist: `
    update game_region_snapshot rs
        set hist_low_cents = t.hist, prev_hist_low_cents = t.prev, hist_low_day = current_date, updated_at = now()
       from (
         select d.game_id, d.region,
           min(d.min_price_cents) filter (where p.kind in ${OFFICIAL_KINDS}) as hist,
           min(d.min_price_cents) filter (where d.day < current_date and p.kind in ${OFFICIAL_KINDS}) as prev
           from daily_prices d join platforms p on p.code = d.platform_code
          where d.game_id = $1
          group by d.game_id, d.region
       ) t
      where rs.game_id = t.game_id and rs.region = t.region`,
  touchDaily: `
    insert into game_region_snapshot (game_id, region, price_cents, offers_count, hist_low_cents, prev_hist_low_cents, hist_low_day)
     values ($1, $2, null, 0,
       case when exists (select 1 from platforms p where p.code = $3 and p.kind in ${OFFICIAL_KINDS}) then $4::int else null end,
       null, current_date)
     on conflict (game_id, region) do update set
       hist_low_cents = case
         when exists (select 1 from platforms p where p.code = $3 and p.kind in ${OFFICIAL_KINDS})
           then least(coalesce(game_region_snapshot.hist_low_cents, $4::int), $4::int)
         else game_region_snapshot.hist_low_cents end,
       prev_hist_low_cents = case
         when game_region_snapshot.hist_low_day is null or game_region_snapshot.hist_low_day < current_date
           then game_region_snapshot.hist_low_cents
         else game_region_snapshot.prev_hist_low_cents end,
       hist_low_day = current_date,
       updated_at = now()`,
  clearRegion: `delete from game_region_snapshot where region = $1`,
  clearAll: `delete from game_region_snapshot`,
};

/** 快照写网关：所有写语句的唯一执行出口（未知 op 直接抛错，防拼错走旁路）。 */
async function snapshotWrite(q, op, params = []) {
  const sql = SNAPSHOT_WRITE_SQL[op];
  if (!sql) throw new Error(`game_region_snapshot 未知写操作：${op}（必须经 SNAPSHOT_WRITE_SQL 网关）`);
  return q(sql, params);
}
// </snapshot-write-gateway>

/**
 * 一次性回填读模型（docs/READ-MODEL.md §6）：行集合 = offers ∪ daily_prices 的 (game, region)；
 * 当前价列实时聚合 offers（官方渠道、在售），历史列一次聚合 daily_prices（hist_low_day=current_date）。
 * 幂等（on conflict do update / do nothing），中断后重启可继续。
 */
export async function backfillGameRegionSnapshot(q) {
  // 1) 当前价列：每个 (game, region) 一条（有在售官方报价才有价）
  await snapshotWrite(q, 'backfillPrices');
  // 2) 有历史但无现价的游戏也要有行（与旧 exists(daily_prices) 语义对齐，§6.3）
  await snapshotWrite(q, 'backfillRows');
  // 3) 历史列：一次聚合 daily_prices（官方渠道；prev = 今天以前）
  await snapshotWrite(q, 'backfillHist');
}

/**
 * 重算一个游戏全部区服的「当前价」列（docs/READ-MODEL.md §4）：
 * 每个 offer 写库后调用；单游戏只扫几行，1–3ms。历史列不动（由 touchDailyAggregate 维护）。
 * 写入唯一路径：经 snapshotWrite 网关，SQL 见 SNAPSHOT_WRITE_SQL.prices。
 */
export async function refreshGameRegionPrices(q, gameId) {
  await snapshotWrite(q, 'prices', [gameId]);
}

/**
 * 重算一个游戏全部区服的「历史」列（mergeGames 移动 daily 后调用，docs/READ-MODEL.md §4）。
 * 先补齐行（该游戏有日价但快照缺行的区服——与回填「daily ∪ offers」的语义一致），再更新历史列。
 */
export async function refreshGameRegionHist(q, gameId) {
  await snapshotWrite(q, 'histRows', [gameId]);
  await snapshotWrite(q, 'hist', [gameId]);
}

/**
 * 维护史低与新史低（docs/READ-MODEL.md §4 日界切换）：
 * upsertDaily 之后调用。hist_low 只吸收官方渠道价（c2c 不进史低）；
 * 日界切换不看渠道——「今天第一次写入之前」的 hist_low 恰好等于 prev_hist_low，任何写入触发切换都对。
 */
export async function touchDailyAggregate(q, { gameId, region, platformCode, priceCents }) {
  await snapshotWrite(q, 'touchDaily', [gameId, region, platformCode, priceCents]);
}

export async function startFetchRun(q, platformCode) {
  const r = await q('insert into fetch_runs (platform_code, started_at) values ($1, now()) returning id', [platformCode]);
  return Number(r.rows[0].id);
}

export async function finishFetchRun(q, id, fields) {
  await q(
    `update fetch_runs set finished_at=now(), requests=$1, total=$2, ok=$3, skipped=$4, failed=$5, status=$6, note=$7
      where id=$8`,
    [fields.requests ?? 0, fields.total ?? 0, fields.ok ?? 0, fields.skipped ?? 0, fields.failed ?? 0, fields.status ?? 'ok', fields.note ?? null, id],
  );
}

export async function lowestOffers(q, { region = 'cn', limit = 50 } = {}) {
  const r = await q(
    `select g.id, g.steam_appid, coalesce(nullif(g.name, ''), nullif(g.name_en, ''), 'appid:' || g.steam_appid) as name,
            g.name_en,
            o.platform_code, p.name as platform_name,
            o.price_cents, o.original_cents, o.discount_pct, o.buy_url, o.last_seen_at,
            (select min(d.min_price_cents) from daily_prices d
               join platforms ph on ph.code = d.platform_code
              where d.game_id = g.id and d.region = o.region and ph.kind in ${OFFICIAL_KINDS}) as hist_low,
            -- 各平台当前价（升序），让列表页能直接看出"哪家便宜"
            (select json_agg(x order by x.price)
               from (
                 select pp.code as platform, pp.name as platform_name, oo.price_cents as price, oo.currency
                   from offers oo
                   join platforms pp on pp.code = oo.platform_code
                  where oo.game_id = g.id and oo.region = o.region and oo.in_stock
                    and pp.kind in ${OFFICIAL_KINDS}
               ) x) as all_offers
       from offers o
       join games g on g.id = o.game_id
       join platforms p on p.code = o.platform_code
       join v_lowest_official v on v.game_id = o.game_id and v.region = o.region
      where o.in_stock and o.region = $1 and o.price_cents = v.lowest_cents
      order by o.discount_pct desc, o.price_cents asc, name asc
      limit $2`,
    [region, limit],
  );
  return r.rows;
}

export async function priceHistory(q, { steamAppid, days = 90 }) {
  const r = await q(
    `select d.day::text as day, d.platform_code, d.min_price_cents, d.currency
       from daily_prices d
       join platforms p on p.code = d.platform_code
       join games g on g.id = d.game_id
      where g.steam_appid = $1
        and d.day >= current_date - make_interval(days => $2)
        and p.kind in ${OFFICIAL_KINDS}
      order by d.day asc, d.platform_code asc`,
    [steamAppid, Number(days)],
  );
  return r.rows;
}

export async function isAtHistoricalLow(q, { steamAppid, region = 'cn' }) {
  const hist = await q(
    `select min(d.min_price_cents) as hist_low
       from daily_prices d
       join platforms p on p.code = d.platform_code
       join games g on g.id = d.game_id
      where g.steam_appid=$1 and d.region=$2 and p.kind in ${OFFICIAL_KINDS}`,
    [steamAppid, region],
  );
  const now = await q(
    `select min(o.price_cents) as now
       from offers o
       join platforms p on p.code = o.platform_code
       join games g on g.id = o.game_id
      where g.steam_appid=$1 and o.region=$2 and o.in_stock and p.kind in ${OFFICIAL_KINDS}`,
    [steamAppid, region],
  );
  const histLow = hist.rows[0]?.hist_low;
  const current = now.rows[0]?.now;
  if (histLow == null || current == null) return null;
  return { histLow, current, atLow: current <= histLow };
}

export async function stats(q) {
  const one = async (sql) => Object.values((await q(sql)).rows[0] ?? {})[0];
  return {
    games: Number(await one('select count(*) from games')),
    offers: Number(await one('select count(*) from offers')),
    snapshots: Number(await one('select count(*) from price_snapshots')),
    dailyRows: Number(await one('select count(*) from daily_prices')),
    platforms: (await q('select code, name, kind from platforms order by code')).rows,
    lastRuns: (
      await q(`select platform_code, started_at, finished_at, requests, ok, skipped, failed, status, note
                 from fetch_runs order by id desc limit 5`)
    ).rows,
  };
}

export async function serverVersion(q) {
  const r = await q('select version() as v, current_setting($1) as tz', ['TimeZone']);
  return { version: r.rows[0]?.v ?? null, timeZone: r.rows[0]?.tz ?? null };
}

/**
 * 单款游戏的完整字段（概览列表与详情共用）。注意 $1 永远是 region。
 * 详情必须能不依赖"前 500 名"直接按 appid / id 取到，否则后台编辑会 404。
 */
// CO-5/B4-2 第十五轮：export 给 games-repository.js 导入——gameSearch 的 count/rows 查询
// 与 gameDetail/gameOverview 共用同一 SELECT 片段与「已拥有/谁拥有/愿望单」推导片段，
// 留在本文件保持单一定义（跨域共用 SQL 不搬家，§15.1）。
export const GAME_SELECT = `select g.id,
            g.steam_appid,
            coalesce(nullif(g.name, ''), nullif(g.name_en, ''), 'appid:' || g.steam_appid) as name,
            g.name_en,
            g.app_type,
            g.interested,
            g.owned,
            g.blocked,
            g.description,
            g.developers,
            g.publishers,
            g.genres,
            g.tags,
            g.steam_status,
            g.required_age,
            g.adult_flag,
            g.mature_flag,
            g.steam_checked_at,
            -- CW 批（docs/ADMIN-GAME-POPUP.md §3）：后台游戏详情弹窗用（封面/发售日期/Steam 评测数）；
            -- release_date 按 YYYY-MM-DD 字符串语义走 ::text，避免 date 对象序列化成时区偏移的 ISO 串
            g.header_image,
            g.release_date::text as release_date,
            g.heat_reviews,
            (select min(o.price_cents) from offers o
               join platforms p on p.code = o.platform_code
              where o.game_id = g.id and o.region = $1 and o.in_stock
                and p.kind in ${OFFICIAL_KINDS}) as current_low,
            (select o.currency from offers o
               join platforms p on p.code = o.platform_code
              where o.game_id = g.id and o.region = $1 and o.in_stock
                and p.kind in ${OFFICIAL_KINDS}
              order by o.price_cents asc limit 1) as currency,
            -- Steam 自身价格：以 Steam 为准，其它平台只作参考
            (select min(o.price_cents) from offers o
              where o.game_id = g.id and o.region = $1 and o.in_stock and o.platform_code = 'steam') as steam_price,
            (select min(o.original_cents) from offers o
               join platforms p on p.code = o.platform_code
              where o.game_id = g.id and o.region = $1 and o.in_stock
                and p.kind in ${OFFICIAL_KINDS}) as current_original,
            -- 折扣力度（官方渠道在售报价里的最大折扣），前台"折扣"列与排序都靠它
            (select max(o.discount_pct) from offers o
               join platforms p on p.code = o.platform_code
              where o.game_id = g.id and o.region = $1 and o.in_stock
                and p.kind in ${OFFICIAL_KINDS}) as discount,
            (select min(d.min_price_cents) from daily_prices d
               join platforms p on p.code = d.platform_code
              where d.game_id = g.id and d.region = $1
                and p.kind in ${OFFICIAL_KINDS}) as hist_low,
            -- 新史低判定：今天之前的最低价（不含当天），当前价低于它才算「新史低」
            (select min(d.min_price_cents) from daily_prices d
               join platforms p on p.code = d.platform_code
              where d.game_id = g.id and d.region = $1 and d.day < current_date
                and p.kind in ${OFFICIAL_KINDS}) as prev_hist_low,
            (select count(*)::int from daily_prices d
              where d.game_id = g.id and d.region = $1) as day_count,
            (select max(o.last_seen_at) from offers o
              where o.game_id = g.id and o.region = $1) as last_seen_at,
            -- 当前最低价来自哪个平台（列表页要能直接看出"哪家便宜"）
            (select p.name from offers o
               join platforms p on p.code = o.platform_code
              where o.game_id = g.id and o.region = $1 and o.in_stock and p.kind in ${OFFICIAL_KINDS}
              order by o.price_cents asc limit 1) as low_platform_name,
            (select o.platform_code from offers o
               join platforms p on p.code = o.platform_code
              where o.game_id = g.id and o.region = $1 and o.in_stock and p.kind in ${OFFICIAL_KINDS}
              order by o.price_cents asc limit 1) as low_platform,
            -- 各平台当前价（升序）
            (select json_agg(x order by x.price)
               from (
                 select p.code as platform, p.name as platform_name, o.price_cents as price, o.currency
                   from offers o
                   join platforms p on p.code = o.platform_code
                  where o.game_id = g.id and o.region = $1 and o.in_stock and p.kind in ${OFFICIAL_KINDS}
               ) x) as all_offers`;

// AV 批（docs/READ-MODEL.md §5.1）：非 compact 分支的读模型版——价格/史低列全部取快照 rs.*，
// all_offers 仍逐行现算（旧页面用，每行一条子查询、页内最多 100 行，可接受）。
export const GAME_SELECT_RM = `select g.id,
            g.steam_appid,
            coalesce(nullif(g.name, ''), nullif(g.name_en, ''), 'appid:' || g.steam_appid) as name,
            g.name_en,
            g.app_type,
            g.interested,
            g.owned,
            g.blocked,
            g.description,
            g.developers,
            g.publishers,
            g.genres,
            g.tags,
            g.steam_status,
            g.required_age,
            g.adult_flag,
            g.mature_flag,
            g.steam_checked_at,
            rs.price_cents as current_low,
            rs.currency,
            rs.steam_price_cents as steam_price,
            rs.original_cents as current_original,
            rs.discount_pct as discount,
            rs.hist_low_cents as hist_low,
            rs.prev_hist_low_cents as prev_hist_low,
            (select count(*)::int from daily_prices d
              where d.game_id = g.id and d.region = $1) as day_count,
            rs.last_seen_at,
            rs.low_platform_name,
            rs.low_platform,
            (select json_agg(x order by x.price)
               from (
                 select p.code as platform, p.name as platform_name, o.price_cents as price, o.currency
                   from offers o
                   join platforms p on p.code = o.platform_code
                  where o.game_id = g.id and o.region = $1 and o.in_stock and p.kind in ${OFFICIAL_KINDS}
               ) x) as all_offers`;

// 生效「已拥有」推导：手动 owned=true ∪（未被 owned=false 永久排除 且 appid 在该用户所有账号的库里）。
// $uid 为当前用户 id；游客（uid=null）不显示已拥有/谁拥有/愿望单（规格 §6）。
// CL 批（docs/USER-ALERTS.md §2）：已拥有口径变更——只认 Steam 账号库并集；
// user_game_flags.owned 不再参与判定（字段保留不删，历史手动标记不迁移）。
export const EFFECTIVE_OWNED_SQL = (uidRef) =>
  `(exists (
     select 1 from steam_games sg
       join steam_accounts sa on sa.steam_id = sg.steam_id
      where sa.user_id = ${uidRef} and sg.appid = g.steam_appid))`;
export const OWNED_BY_SQL = (uidRef) =>
  `(select coalesce(json_agg(json_build_object(
        'steamId', sa.steam_id,
        'name', coalesce(sa.alias, sa.persona_name, sa.steam_id)) order by sa.steam_id), '[]'::json)
      from steam_games sg
      join steam_accounts sa on sa.steam_id = sg.steam_id
     where sa.user_id = ${uidRef} and sg.appid = g.steam_appid)`;
export const WISHLISTED_SQL = (uidRef) =>
  `(exists (select 1 from steam_wishlist sw
      join steam_accounts sa on sa.steam_id = sw.steam_id
     where sa.user_id = ${uidRef} and sw.appid = g.steam_appid)
    or exists (select 1 from user_wishlist uw
     where uw.user_id = ${uidRef} and uw.game_id = g.id))`;
// 谁愿望单（Steam 账号维度；本站手动项单独用 site_wishlisted 表示）。
// EW（docs/WISHLIST-STEAM-ACCOUNT.md §7）：展示名按 alias（btrim 后非空）→ persona_name → steam_id 回退——
// 空白别名不再显示成空白账号名（与「我的愿望单」steam_accounts 聚合口径一致）。
export const WISHLISTED_BY_SQL = (uidRef) =>
  `(select coalesce(json_agg(json_build_object(
        'steamId', sa.steam_id,
        'name', coalesce(nullif(btrim(sa.alias), ''), sa.persona_name, sa.steam_id)) order by sa.steam_id), '[]'::json)
      from steam_wishlist sw
      join steam_accounts sa on sa.steam_id = sw.steam_id
     where sa.user_id = ${uidRef} and sw.appid = g.steam_appid)`;
// 是否在本站手动愿望单（user_wishlist）
export const SITE_WISHLISTED_SQL = (uidRef) =>
  `exists (select 1 from user_wishlist uw
     where uw.user_id = ${uidRef} and uw.game_id = g.id)`;

/**
 * 单款游戏（按 steam_appid 或内部 id）。与列表不同，不受 limit / 排序影响，
 * 也不需要"有日价格数据"——后台编辑、回收站恢复后查看都要能取到。
 * userId 传入时，interested / owned 返回该用户的生效值：owned = 手动 ∪ 绑定账号库推导；
 * owned_by / wishlisted 只对当前用户可见，游客恒为 false / []（games.owned 全局值已废弃）。
 */
export async function gameDetail(q, { steamAppid = null, gameId = null, region = 'cn', userId = null, adult = 'show' }) {
  const cond = steamAppid != null ? 'g.steam_appid = $2' : 'g.id = $2';
  const join = userId ? 'left join user_game_flags uf on uf.game_id = g.id and uf.user_id = $3' : '';
  const extra = userId
    ? `, coalesce(uf.interested, g.interested) as eff_interested, ${EFFECTIVE_OWNED_SQL('$3')} as eff_owned,
       uf.interested as user_interested, uf.owned as user_owned,
       ${OWNED_BY_SQL('$3')} as owned_by, ${WISHLISTED_SQL('$3')} as wishlisted,
       ${WISHLISTED_BY_SQL('$3')} as wishlisted_by, ${SITE_WISHLISTED_SQL('$3')} as site_wishlisted`
    : '';
  const params = [region, steamAppid ?? gameId];
  if (userId) params.push(userId);
  const r = await q(`${GAME_SELECT}${extra} from games g ${join} where ${cond} and not g.deleted`, params);
  const row = r.rows[0];
  if (!row) return null;
  // 前台 hide 策略同样作用于详情：直接 URL 访问也不可见（后台/内部调用默认 show）
  if (adult === 'hide' && row.adult_flag) return null;
  if (userId) {
    row.interested = row.eff_interested;
    row.owned = row.eff_owned;
    delete row.eff_interested;
    delete row.eff_owned;
  } else {
    row.owned = false;
    row.owned_by = [];
    row.wishlisted = false;
    row.wishlisted_by = [];
    row.site_wishlisted = false;
  }
  return row;
}

/** 有价格记录的游戏概览：当前最低 / 史低 / 数据天数 / 最近更新。 */
export async function gameOverview(q, { region = 'cn', limit = 200 } = {}) {
  const r = await q(
    `${GAME_SELECT}
       from games g
      where exists (select 1 from daily_prices d
                     where d.game_id = g.id and d.region = $1)
        and not g.deleted
      order by (select min(o.price_cents) from offers o
                 join platforms p on p.code = o.platform_code
                where o.game_id = g.id and o.region = $1 and o.in_stock
                  and p.kind in ${OFFICIAL_KINDS}) asc nulls last, name asc
      limit $2`,
    [region, limit],
  );
  return r.rows;
}

/**
 * 关键词搜索条件（AD 批 docs/SEARCH-I18N.md §3-A/B）：
 * name / name_en / game_aliases.platform_title 三源命中，避免 JOIN 重复行（exists 子查询）；
 * 关键词与字段两侧都做归一化（去半角/全角空格、统一小写）后再包含匹配——
 * 当前 like '%kw%' 本来就不走索引（198k 行实测约 114ms），可接受。
 * appidAsInt：纯数字关键词按 AppID 精确匹配；appidAsText：任意关键词安全比较（不抛 int 转换错）。
 */
export function gameKeywordSql(kwParam, { appidAsInt = false, appidAsText = false, tokenCond = null } = {}) {
  const kw = `replace(replace(lower(${kwParam}), ' ', ''), '　', '')`;
  const f = (col) => `replace(replace(lower(coalesce(${col}, '')), ' ', ''), '　', '')`;
  const appid = appidAsInt ? ` or g.steam_appid = ${kwParam}::int` : appidAsText ? ` or cast(g.steam_appid as text) = ${kwParam}` : '';
  // DS 批（docs/SEARCH-ALIASES.md §4）：派生 token 源（在原有 name/name_en/platform_title 三源之外）。
  // tokenCond：gameSearch 传入完整条件（数组重叠 + LIKE 模式，带参数编号）；
  // 不给时退化为「归一化关键词整体子串」——后台「游戏管理」搜索（server.js）复用此 helper，无 token 参数位。
  const tokenArm = tokenCond
    ? ` or (${tokenCond})`
    : ` or exists (select 1 from unnest(g.search_tokens) t where t like '%' || ${kw} || '%')`;
  return (
    `(${kw} = '' or ${f('g.name')} like '%' || ${kw} || '%' or ${f('g.name_en')} like '%' || ${kw} || '%' ` +
    `or exists (select 1 from game_aliases a where a.game_id = g.id and ${f('a.platform_title')} like '%' || ${kw} || '%')${tokenArm}${appid})`
  );
}

/** 单个游戏的每日最低价（跨官方平台取最小），按天升序。 */
export async function dailyMinSeries(q, { gameId, region = 'cn' }) {
  const r = await q(
    `select d.day::text as day, min(d.min_price_cents) as price_cents, min(d.currency) as currency
       from daily_prices d
       join platforms p on p.code = d.platform_code
      where d.game_id = $1 and d.region = $2 and p.kind in ${OFFICIAL_KINDS}
      group by d.day
      order by d.day asc`,
    [gameId, region],
  );
  return r.rows;
}

/**
 * 批量近 N 天每日最低价（docs/ADMIN-CONSOLE-IA.md §6，AT 批）：
 * 一次查询 group by game_id, day，返回 { [gameId]: [{ day, price_cents, currency }] }。
 * 口径与 dailyMinSeries 一致（官方渠道、国区、跨平台取每日最低）；窗口按日历天算。
 * 价格报表上限 100 行 → 序列最多 100×7=700 行，随列表一次返回，悬停零额外请求。
 */
export async function dailyMinSeriesBatch(q, { gameIds, days = 7, region = 'cn' }) {
  const ids = [...new Set((gameIds ?? []).map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  if (!ids.length) return {};
  const span = Math.min(Math.max(Number(days) || 7, 1), 30);
  const r = await q(
    `select d.game_id, d.day::text as day, min(d.min_price_cents) as price_cents, min(d.currency) as currency
       from daily_prices d
       join platforms p on p.code = d.platform_code
      where d.game_id = any($1::int[]) and d.region = $2 and p.kind in ${OFFICIAL_KINDS}
        and d.day >= current_date - ($3::int - 1)
      group by d.game_id, d.day
      order by d.game_id asc, d.day asc`,
    [ids, region, span],
  );
  const out = {};
  for (const row of r.rows) {
    const key = Number(row.game_id);
    if (!out[key]) out[key] = [];
    out[key].push({ day: row.day, price_cents: Number(row.price_cents), currency: row.currency });
  }
  return out;
}

/** 单个游戏各平台每天的价（画多线时用）。 */
export async function dailyPlatformSeries(q, { gameId, region = 'cn' }) {
  const r = await q(
    `select d.platform_code, d.day::text as day, d.min_price_cents
       from daily_prices d
       join platforms p on p.code = d.platform_code
      where d.game_id = $1 and d.region = $2 and p.kind in ${OFFICIAL_KINDS}
      order by d.platform_code asc, d.day asc`,
    [gameId, region],
  );
  return r.rows;
}

/** 单个游戏当前在售的官方报价（可跨区服）。 */
export async function regionOffers(q, { steamAppid, region = null } = {}) {
  const params = [steamAppid];
  let filter = '';
  if (region) {
    params.push(region);
    filter = ' and o.region = $2';
  }
  const r = await q(
    `select o.region, o.currency, o.platform_code, p.name as platform_name,
            o.price_cents, o.original_cents, o.discount_pct, o.buy_url, o.last_seen_at
       from offers o
       join platforms p on p.code = o.platform_code
       join games g on g.id = o.game_id
      where g.steam_appid = $1 and o.in_stock and p.kind in ${OFFICIAL_KINDS}${filter}
      order by o.region asc, o.price_cents asc`,
    params,
  );
  return r.rows;
}

/** 单个游戏在指定区服当前在售的官方报价。 */
export async function offersOfGame(q, { gameId, region = 'cn' }) {
  const r = await q(
    `select o.platform_code, p.name as platform_name, o.price_cents, o.original_cents,
            o.discount_pct, o.buy_url, o.last_seen_at, o.currency
       from offers o
       join platforms p on p.code = o.platform_code
      where o.game_id = $1 and o.region = $2 and o.in_stock and p.kind in ${OFFICIAL_KINDS}
      order by o.price_cents asc`,
    [gameId, region],
  );
  return r.rows;
}

// ---------------------------------------------------------------- 关注列表

// ---------------------------------------------------------------- 关注列表
// CL 批（docs/USER-ALERTS.md）：watchlist 拆两级——user_id 非空 = 用户级（本人管理），
// user_id NULL = 站点级历史数据（行为不变）。稳定键：用户级 (user_id, game_id, region)，
// 站点级 (game_id, region)，各自部分唯一索引约束。

/** 站点级 upsert（历史入口：CLI watch add / 愿望单自动提醒）。冲突只在 user_id IS NULL 行内推断。 */
export async function upsertWatch(q, { gameId, region = 'cn', targetCents = null, note = null, source = 'manual' }) {
  const r = await q(
    `insert into watchlist (game_id, region, target_cents, note, source, user_id)
     values ($1, $2, $3, $4, $5, null)
     on conflict (game_id, region) where user_id is null do update
       set target_cents = excluded.target_cents, note = excluded.note, source = excluded.source
     returning id`,
    [gameId, region, targetCents, note, source],
  );
  return Number(r.rows[0].id);
}

/** 站点级删除（只删 NULL 行，防误删用户级）。 */
export async function deleteWatch(q, { gameId, region = 'cn' }) {
  const r = await q('delete from watchlist where game_id = $1 and region = $2 and user_id is null', [gameId, region]);
  return r.rowCount ?? 0;
}

/** 站点级清单（CLI 用，行为不变）。 */
export async function listWatches(q, { region = 'cn' } = {}) {
  const r = await q(
    `select w.id, w.target_cents, w.note, w.source, w.created_at, w.last_notified_cents, w.last_notified_at,
            g.id as game_id, g.steam_appid, coalesce(nullif(g.name, ''), nullif(g.name_en, ''), 'appid:' || g.steam_appid) as name
       from watchlist w
       join games g on g.id = w.game_id
      where w.region = $1 and w.user_id is null
      order by g.name asc nulls last`,
    [region],
  );
  return r.rows;
}

/**
 * 关注列表 + 当前价 + 史低 + 原价 + user_id/邮箱，供 alerts 判定与分组。
 *
 * FM（docs/ALERT-HISTLOW-FIX.md §2）：`hist_low` 只算「今天以前」的日聚合。
 * 口径说明：`daily_prices.day` 由 `upsertDaily` 写 `current_date`，而连接池会话时区固定
 * 站点时区（默认 Asia/Shanghai，见 src/store/index.js 的 `set_config timezone`），
 * 所以 `d.day < current_date` 就是 Asia/Shanghai 日历日的「昨天及以前」。
 * 旧口径含当天时，当天现价自己就是史低 → `current == hist_low` 恒成立、邮件恒标「新史低」。
 * `original_cents` 取当前最低价那条官方在售报价的原价，用于「未降价（价格=原价）不显示史低段」。
 */
export async function watchCandidates(q, { region = 'cn' } = {}) {
  const r = await q(
    `select w.id as watch_id, w.user_id, u.email as user_email,
            coalesce(p.email_alerts, true) as user_email_alerts,
            w.target_cents, w.note, w.last_notified_cents, w.last_notified_at,
            g.id as game_id, g.steam_appid, coalesce(nullif(g.name, ''), nullif(g.name_en, ''), 'appid:' || g.steam_appid) as name,
            g.name_en,
            (select min(o.price_cents) from offers o
               join platforms p on p.code = o.platform_code
              where o.game_id = g.id and o.region = $1 and o.in_stock
                and p.kind in ${OFFICIAL_KINDS}) as current_cents,
            (select min(d.min_price_cents) from daily_prices d
               join platforms p on p.code = d.platform_code
              where d.game_id = g.id and d.region = $1 and d.day < current_date
                and p.kind in ${OFFICIAL_KINDS}) as hist_low,
            (select o.original_cents from offers o
               join platforms p on p.code = o.platform_code
              where o.game_id = g.id and o.region = $1 and o.in_stock
                and p.kind in ${OFFICIAL_KINDS}
              order by o.price_cents asc, o.original_cents asc nulls last
              limit 1) as original_cents
       from watchlist w
       join games g on g.id = w.game_id
       left join users u on u.id = w.user_id
       left join user_prefs p on p.user_id = u.id
      where w.region = $1
      order by g.name asc nulls last`,
    [region],
  );
  return r.rows;
}

// ---------------------------------------------------------------- 用户与会话

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// AK-1（docs/AUTH-REDESIGN.md §4.2）：新格式 $scrypt$N$r$p$<salt b64>$<hash b64>（N=32768,r=8,p=1）；
// 旧格式 salt:hash（N=16384 默认参数）继续可验，登录成功后静默升级。
const SCRYPT_OPTS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** scrypt 哈希（带算法与参数的版本化格式；不引第三方库，node:crypto 足够）。 */
export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(password), salt, 64, SCRYPT_OPTS);
  return `$scrypt$${SCRYPT_OPTS.N}$${SCRYPT_OPTS.r}$${SCRYPT_OPTS.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/** 校验密码：兼容新格式 $scrypt$… 与旧格式 salt:hash（保持返回 boolean，不改调用点签名）。 */
export function verifyPassword(password, stored) {
  const value = String(stored ?? '');
  if (value.startsWith('$scrypt$')) {
    const parts = value.split('$'); // ['', 'scrypt', N, r, p, salt, hash]
    const [n, r, p, saltB64, hashB64] = parts.slice(2);
    try {
      const hash = scryptSync(String(password), Buffer.from(saltB64, 'base64'), 64, {
        N: Number(n),
        r: Number(r),
        p: Number(p),
        maxmem: 256 * 1024 * 1024,
      });
      return timingSafeEqual(hash, Buffer.from(hashB64, 'base64'));
    } catch {
      return false;
    }
  }
  const [salt, hash] = value.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/** 旧格式（或空）需要升级到版本化格式。 */
export function passwordNeedsRehash(stored) {
  const value = String(stored ?? '');
  return value.length > 0 && !value.startsWith('$scrypt$');
}

export async function createUser(q, { username, password, role = 'user', email = null, mustChange = false }) {
  const r = await q(
    'insert into users (username, password_hash, role, email, must_change_password) values ($1, $2, $3, $4, $5) returning id, username, role, email, email_verified',
    [username, hashPassword(password), role, email, Boolean(mustChange)],
  );
  return r.rows[0];
}

export async function findUserByName(q, username) {
  const r = await q(
    'select id, username, password_hash, role, disabled, email, failed_login_count, locked_until, must_change_password, weak_password from users where username = $1',
    [username],
  );
  return r.rows[0] ?? null;
}

export async function listUsers(q) {
  const r = await q(
    'select u.id, u.username, u.display_name, u.email, u.email_verified, u.role, u.disabled, u.created_at, u.last_login_at, ' +
      'u.must_change_password, u.weak_password, u.locked_until, u.failed_login_count, ' +
      '(select count(*)::int from sessions s where s.user_id = u.id and s.expires_at > now()) as sessions, ' +
      '(select count(*)::int from steam_accounts a where a.user_id = u.id) as steam_accounts ' +
      'from users u order by u.id',
  );
  return r.rows;
}

export async function setUserRole(q, { username, role }) {
  const r = await q('update users set role = $1 where username = $2 returning id, username, role', [role, username]);
  return r.rows[0] ?? null;
}

// ---------------------------------------------------------------- CX 批（docs/USER-PROFILE-EDIT.md §3）：个人资料
// getUserPublic / updateUserProfile / avatarOfUser / setUserAvatar / clearUserAvatar 已随
// me 域抽到 me-repository.js（CO-5/B4-2 第六轮）；setDefaultSteamAccount /
// clearDefaultSteamIfMatches / userLibraryItems 已随 site 域抽到 site-repository.js
// （CO-5/B4-2 第七轮，顶部 re-export 保旧 db.* 签名）。

/** 改密码：踢掉该用户所有会话，旧 cookie 立即失效；AK-3 起不再顺带启用账号（启用/禁用是独立动作）。 */
export async function setUserPassword(q, { username = null, userId = null, password, mustChange = false }) {
  const where = userId != null ? 'id = $2' : 'username = $2';
  const key = userId != null ? userId : username;
  const r = await q(`update users set password_hash = $1, must_change_password = $3 where ${where} returning id`, [
    hashPassword(password),
    key,
    Boolean(mustChange),
  ]);
  if (!r.rows.length) return null;
  await q('delete from sessions where user_id = $1', [r.rows[0].id]);
  return r.rows[0];
}

// ---------------------------------------------------------------- 邮件模板与发送记录（docs/USER-LIFECYCLE.md §3.1/§3.3/§4.3）
// CO-5/B4-2 第十轮：listMailTemplates / upsertMailTemplate / resetMailTemplate / listMailLog
// 已随 admin-settings 域搬到 admin-settings-repository.js（顶部 re-export）。insertMailLog
// 被 account-notify.js / routes/appeal.js / admin-settings 域 mail test 跨模块共用，留本文件。

/** 通知类邮件发送记录（§3.3）：成功/失败各一行；验证码邮件不写这张表。 */
export async function insertMailLog(q, { event, toEmail, subject = null, ok = false, error = null, actor = null }) {
  await q('insert into mail_log (event, to_email, subject, ok, error, actor) values ($1,$2,$3,$4,$5,$6)', [
    event,
    toEmail,
    subject ? String(subject).slice(0, 300) : null,
    Boolean(ok),
    error ? String(error).slice(0, 500) : null,
    actor,
  ]);
}

/** CY 批（docs/DATA-ISOLATION.md §3）：写一条通用审计（永不抛出——审计失败不能影响主流程）。
 *  跨模块共用（admin-access 域 / admin-users 域 / alert 手动推送 / 前台认证域），留本文件。 */
export async function writeAuditLog(q, { actorId = null, actor = null, action, target = null, detail = null, ip = null }) {
  try {
    await q(
      'insert into audit_logs (actor_id, actor, action, target, detail, ip) values ($1, $2, $3, $4, $5::jsonb, $6)',
      [actorId, actor, String(action), target == null ? null : String(target), detail ?? null, ip ?? null],
    );
  } catch {
    // 审计表未建好 / 写入失败：只吞掉，不影响主流程（与 steam_account_logs 同一先例）
  }
}

/** 编辑游戏说明（人工维护优先，Steam 同步只在为空时填）。 */
export async function setGameDescription(q, { steamAppid, description, overwrite = false }) {
  const r = await q(
    `update games set description = case when $3 then $1 else coalesce(nullif(description, ''), $1) end, updated_at = now()
      where steam_appid = $2 returning id, name, description`,
    [description, steamAppid, Boolean(overwrite)],
  );
  return r.rows[0] ?? null;
}

export async function createSession(q, { userId, days = 7, ip = null, ipKey = null, userAgent = null, uaKey = null, deviceId = null }) {
  const token = randomBytes(32).toString('base64url');
  // BK 批（docs/SESSION-MANAGEMENT.md §3.1）：建会话时记录客户端指纹（IP 原样 + 归一化键 + UA 原样 + 归一化键 + 设备码）
  await q(
    `insert into sessions (token, user_id, expires_at, ip, ip_key, user_agent, ua_key, device_id, last_seen_at)
     values ($1, $2, now() + ($3 || ' days')::interval, $4, $5, $6, $7, $8, now())`,
    [token, userId, String(days), ip, ipKey, userAgent, uaKey, deviceId],
  );
  await q('update users set last_login_at = now() where id = $1', [userId]);
  return token;
}

/**
 * 用 token 换用户（BK-1：兜底过滤 disabled——即使会话行残留，被禁用用户一律视为未登录）。
 * 返回行带 BK 字段：sess_id（对外 id）、ip_key/ua_key/last_seen_at 供 server 层做空闲/绑定判定。
 */
export async function userBySession(q, token) {
  if (!token) return null;
  const r = await q(
    `select u.id, u.username, u.role, u.disabled, u.must_change_password, u.email,
            s.id as sess_id, s.expires_at, s.ip_key, s.ua_key, s.last_seen_at
       from sessions s join users u on u.id = s.user_id
      where s.token = $1 and s.expires_at > now() and not u.disabled`,
    [token],
  );
  return r.rows[0] ?? null;
}

export async function deleteSession(q, token) {
  if (!token) return;
  await q('delete from sessions where token = $1', [token]);
}

/**
 * BK 批（docs/SESSION-MANAGEMENT.md §3.2/§3.3）：会话行操作。
 * 接口一律用对外 id（sessions.id），绝不把 token 下发前端。
 */
export async function deleteSessionById(q, sessId) {
  const r = await q(
    'delete from sessions s using users u where s.id = $1 and u.id = s.user_id returning s.id, s.user_id, u.username, s.token',
    [sessId],
  );
  return r.rows[0] ?? null;
}

/** 后台会话列表：默认只列未过期；按 last_seen_at desc, created_at desc；绝不返回 token。 */
// CO-5/B4-2 第十一轮：listSessions 已随 admin-sessions 域搬到 admin-sessions-repository.js
// （顶部 re-export，签名不变）。deleteSessionById / deleteSessionsOfUser / touchSession /
// deleteSessionByToken 跨模块共用，留本文件。

/** 按用户踢全部会话；exceptToken 传当前 token 时保留它（按用户踢自己 / 退出其它设备）。返回删除行数。 */
export async function deleteSessionsOfUser(q, userId, { exceptToken = null } = {}) {
  const r = exceptToken
    ? await q('delete from sessions where user_id = $1 and token <> $2', [userId, exceptToken])
    : await q('delete from sessions where user_id = $1', [userId]);
  return r.rowCount ?? 0;
}

/** 节流写最近活动（server 层 5 分钟内存节流，这里只负责写）。 */
export async function touchSession(q, token) {
  if (!token) return;
  await q('update sessions set last_seen_at = now() where token = $1', [token]);
}

/** 空闲超时 / 绑定不一致：删该会话行（按 token），返回 { id, user_id }。 */
export async function deleteSessionByToken(q, token) {
  const r = await q('delete from sessions where token = $1 returning id, user_id', [token]);
  return r.rows[0] ?? null;
}

// ── CA-1（docs/APP-NATIVE.md §3）：App Bearer Token ──────────────────────────
// CO-4/B4（docs/DESIGN-AUDIT.md B4）：SQL 已抽到 app-repository.js，本文件顶部 re-export
// （apiTokenHash / insertApiToken / userByApiToken / revokeApiToken / touchApiToken），
// server.js / auth-routes.js / 测试的 `db.*` 导入签名不变。

// ── CD 批（docs/SONKWO-STEAM-MATCH.md §4.5）：跨平台对齐映射（落库，不写文件）────────

/** 写/更新一条映射（confirmed/ignored）。decision 对同组新 SKU 自动继承。 */
export async function upsertSourceMap(q, { platformCode, productId, gameId = null, method = null, confidence = null, decision = 'confirmed', reviewedBy = null }) {
  await q(
    `insert into game_source_map (platform_code, product_id, game_id, match_method, confidence, decision, reviewed_by, reviewed_at)
     values ($1, $2, $3, $4, $5, $6, $7, now())
     on conflict (platform_code, product_id) do update set
       game_id = excluded.game_id,
       match_method = excluded.match_method,
       confidence = excluded.confidence,
       decision = excluded.decision,
       reviewed_by = coalesce(excluded.reviewed_by, game_source_map.reviewed_by),
       reviewed_at = now()`,
    [platformCode, String(productId), gameId, method, confidence == null ? null : Number(confidence), decision, reviewedBy],
  );
}

/** 查单条映射；无记录返回 null。 */
export async function sourceMapByProduct(q, platformCode, productId) {
  const r = await q('select * from game_source_map where platform_code = $1 and product_id = $2', [platformCode, String(productId)]);
  return r.rows[0] ?? null;
}

/** 批量查某平台映射（product_id → 行）。 */
export async function sourceMapsByProducts(q, platformCode, productIds) {
  if (!productIds.length) return new Map();
  const r = await q('select * from game_source_map where platform_code = $1 and product_id = any($2::text[])', [
    platformCode,
    productIds.map(String),
  ]);
  return new Map(r.rows.map((row) => [String(row.product_id), row]));
}

// PREF_TABS / PREF_SORTS / normalizePrefs / getPrefs / savePrefs 已随 me 域抽到
// me-repository.js（CO-5/B4-2 第六轮）；user_prefs 表 DDL 留本文件（watchCandidates
// 也 join 该表）。recordView 已随 games 域抽到 games-repository.js（CO-5/B4-2 第十五轮，
// 顶部 re-export）。

/** 定期清理：访问记录/采集与任务记录/验证码/Steam 账号日志/自动封禁记录/登录会话（调度器周任务）。返回各表删除行数。 */
export async function purgeOldRows(q, { visitorDays = 180, runDays = 90, emailDays = 7, steamDays = 180, abuseDays = 90, sessionIdleDays = 0 } = {}) {
  const del = async (sql, p) => (await q(sql, p)).rowCount ?? 0;
  const visitorLogs = await del("delete from visitor_logs where created_at < now() - ($1 || ' days')::interval", [String(visitorDays)]);
  const fetchRuns = await del("delete from fetch_runs where started_at < now() - ($1 || ' days')::interval", [String(runDays)]);
  const syncRuns = await del("delete from sync_runs where started_at < now() - ($1 || ' days')::interval", [String(runDays)]);
  const emailCodes = await del("delete from email_codes where created_at < now() - ($1 || ' days')::interval", [String(emailDays)]);
  // AT 批（docs/ADMIN-CONSOLE-IA.md §5）：Steam 账号日志保留 180 天，并入现有 prune（不新建定时任务）
  const steamAccountLogs = await del("delete from steam_account_logs where created_at < now() - ($1 || ' days')::interval", [String(steamDays)]);
  // BJ 批 H1（docs/BAN-AND-SECURITY-FIXES.md §10.4.5）：自动封禁记录保留 90 天——
  // 过期行（banned_until 已过 90 天）与「仅计数」行（banned_until 为空且 updated_at 很旧）都清掉。
  const ipAbuse = await del(
    `delete from ip_abuse
      where (banned_until is not null and banned_until < now() - ($1 || ' days')::interval)
         or (banned_until is null and updated_at < now() - ($1 || ' days')::interval)`,
    [String(abuseDays)],
  );
  // BK 批（docs/SESSION-MANAGEMENT.md §3.5）：过期会话行清理（并入 prune，不新建任务）。
  // sessionIdleDays > 0 时顺带清「空闲超时但绝对上限未到」的行（BK-3 兜底）；0 = 跳过该分支。
  const sessions =
    sessionIdleDays > 0
      ? await del(
          `delete from sessions
            where expires_at < now()
               or (last_seen_at is not null and last_seen_at < now() - ($1 || ' days')::interval)`,
          [String(sessionIdleDays)],
        )
      : await del('delete from sessions where expires_at < now()');
  // CH 批（docs/DISCOVERY-FOR-YOU.md §2/§9-4）：行为与搜索词保留 180 天并入 prune
  const behaviors = await del("delete from user_behaviors where last_at < now() - ($1 || ' days')::interval", [String(180)]);
  const searchLogs = await del("delete from user_search_logs where created_at < now() - ($1 || ' days')::interval", [String(180)]);
  return { visitorLogs, fetchRuns, syncRuns, emailCodes, steamAccountLogs, ipAbuse, sessions, behaviors, searchLogs };
}

/** 清理过期浏览记录（默认保留 90 天）。 */
export async function purgeOldViews(q, { days = 90 } = {}) {
  const r = await q("delete from page_views where created_at < now() - ($1 || ' days')::interval", [String(days)]);
  return r.rowCount ?? 0;
}

// ---- 页面浏览统计（/api/admin/views）----
// CO-5/B4-2 第八轮（docs/DESIGN-AUDIT.md B4）：viewStats 与路径解析增强 SQL 已抽到
// admin-access-repository.js（顶部 re-export 保持 db.* 签名不变）；purgeOldViews /
// insertPageView 等访问记数中间件 SQL（server.js 全链与调度器使用）留本文件。

// ---------------------------------------------------------------- 访问记录与 IP 黑名单

/** 记一条访问。region 未知时先落 null，后台异步补写。blocked=true 表示被拦截（采样写入）。 */
export async function insertVisitorLog(q, { ip, remoteIp = null, region = null, path, method = 'GET', userAgent = null, status = null, blocked = false, blockReason = null }) {
  const r = await q(
    `insert into visitor_logs (ip, remote_ip, region, path, method, user_agent, status, blocked, block_reason)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
    [
      ip,
      remoteIp,
      region,
      String(path ?? '').slice(0, 500),
      method,
      userAgent ? String(userAgent).slice(0, 300) : null,
      status,
      Boolean(blocked),
      blockReason ? String(blockReason).slice(0, 200) : null,
    ],
  );
  return Number(r.rows[0].id);
}

/** 归属地异步解析完成后回填。 */
export async function setVisitorRegion(q, id, region) {
  await q('update visitor_logs set region = $1 where id = $2', [String(region).slice(0, 120), id]);
}

// ---- 访问明细/IP 统计视图（/api/admin/visitors*）----
// CO-5/B4-2 第八轮（docs/DESIGN-AUDIT.md B4）：visitorOrderClause / listVisitorLogs /
// visitorSummary / listVisitorsByIp / visitorIpDetail 只被本域路由使用、已抽到
// admin-access-repository.js（顶部 re-export 保持 db.* 签名不变）；
// insertVisitorLog / setVisitorRegion 是访问记录中间件 SQL（server.js 全链写访问日志），留本文件。
/** 黑名单（BH 批）：每行追加近 7 天访问次数 / 最近访问 / 设备数（无记录为 0/null）。 */
export async function listBlockedIps(q) {
  const r = await q(
    `select b.id, b.ip, b.note, b.created_at,
            coalesce(v.visits, 0)::int as visits, v.last_at, coalesce(d.devices, 0)::int as devices
       from ip_blacklist b
       left join lateral (
         select count(*)::int as visits, max(created_at) as last_at
           from visitor_logs
          where ip = b.ip and created_at >= now() - interval '7 days'
       ) v on true
       left join lateral (
         select count(distinct coalesce(nullif(device_id, ''), fingerprint))::int as devices
           from device_logs
          where ip = b.ip and created_at >= now() - interval '7 days'
       ) d on true
      order by b.id desc`,
  );
  return r.rows;
}

/** 加入黑名单：与白名单互斥（删掉同 IP 的白名单条目），返回 { ip, note, removedFromWhitelist }。 */
export async function addBlockedIp(q, { ip, note = null }) {
  const removed = await q('delete from ip_whitelist where ip = $1', [ip]);
  const r = await q(
    'insert into ip_blacklist (ip, note) values ($1, $2) on conflict (ip) do update set note = excluded.note returning id, ip, note, created_at',
    [ip, note],
  );
  return { ...r.rows[0], removedFromWhitelist: (removed.rowCount ?? 0) > 0 };
}

export async function removeBlockedIp(q, ip) {
  const r = await q('delete from ip_blacklist where ip = $1', [ip]);
  return r.rowCount ?? 0;
}

// ---------------------------------------------------------------- IP 白名单 / 超频记录

// ---- 白名单/超频记录管理（/api/admin/whitelist|abuse）----
// CO-5/B4-2 第八轮（docs/DESIGN-AUDIT.md B4）：listWhitelist / removeWhitelistIp /
// listAbuse 只被本域路由使用、已抽到 admin-access-repository.js（顶部 re-export 保持
// db.* 签名不变）；addWhitelistIp 被 banIpExclusiveSql（server.js #11 批量操作共用
// helper）使用、clearAbuseBan / recordPathStrike / setBanUntil 被 ratelimit.js 限流
// 中间件使用，留本文件。

/**
 * 加入白名单：与黑名单互斥（删掉同 IP 的黑名单条目），返回 { ip, note, removedFromBlacklist }。
 */
export async function addWhitelistIp(q, { ip, note = null }) {
  const removed = await q('delete from ip_blacklist where ip = $1', [ip]);
  const r = await q(
    `insert into ip_whitelist (ip, note) values ($1, $2)
     on conflict (ip) do update set note = excluded.note
     returning ip, note, created_at`,
    [ip, note],
  );
  return { ...r.rows[0], removedFromBlacklist: (removed.rowCount ?? 0) > 0 };
}

/**
 * BJ 批 D1（docs/BAN-AND-SECURITY-FIXES.md §10.4.4）：黑名单优先——写黑名单时把该 IP 的
 * 临时封禁字段置空（行保留做审计，与加白名单清临时封禁同一先例）。返回是否改到行。
 */
export async function clearAbuseBan(q, ip) {
  const r = await q(
    'update ip_abuse set banned_until = null, ban_source = null, updated_at = now() where ip = $1 and banned_until is not null',
    [ip],
  );
  return (r.rowCount ?? 0) > 0;
}

/**
 * 记一次"非法路径"命中，返回 24 小时内第几次。
 * 与超频 strikes 分开计数：路径封禁永远不会因此写进永久黑名单。
 */
export async function recordPathStrike(q, ip, { windowHours = 24 } = {}) {
  const r = await q(
    `insert into ip_abuse (ip, path_strikes, last_path_strike, updated_at)
     values ($1, 1, now(), now())
     on conflict (ip) do update set
       path_strikes = case
         when ip_abuse.last_path_strike is not null
          and ip_abuse.last_path_strike > now() - make_interval(hours => $2)
         then ip_abuse.path_strikes + 1 else 1 end,
       last_path_strike = now(),
       updated_at = now()
     returning path_strikes`,
    [ip, Number(windowHours) || 24],
  );
  return Number(r.rows[0]?.path_strikes ?? 1);
}

/** 写临时封禁（分钟）并标记来源；返回到期时间戳（毫秒）。 */
export async function setBanUntil(q, ip, minutes, source = 'rate') {
  const mins = Math.max(1, Math.round(Number(minutes) || 0));
  const r = await q(
    `update ip_abuse
        set banned_until = now() + make_interval(mins => $2),
            ban_source = $3,
            updated_at = now()
      where ip = $1
      returning banned_until`,
    [ip, mins, String(source)],
  );
  const value = r.rows[0]?.banned_until;
  return value ? new Date(value).getTime() : Date.now() + mins * 60_000;
}

// ---------------------------------------------------------------- 站点公告
// CO-5/B4-2 第五轮（docs/DESIGN-AUDIT.md B4）：公告 CRUD 与已读 SQL 已抽到
// announcements-repository.js（顶部 re-export 保持 db.* 签名不变）；表 DDL 与
// 后台批量操作函数（bulkDeleteAnnouncements/bulkSetAnnouncementsActive）留本文件
// ——announcements 表跨域共用（B4 #11 批量操作也读写），watchlist 先例：无 DDL 搬家。

// ---------------------------------------------------------------- 设备指纹

/** 记一条设备信息（同一设备由调用方节流，避免每次刷新都写库）。 */
export async function insertDeviceLog(q, { ip = null, deviceId = null, fingerprint, userAgent = null, details = {} }) {
  const r = await q(
    `insert into device_logs (ip, device_id, fingerprint, user_agent, details)
     values ($1, $2, $3, $4, $5::jsonb) returning id`,
    [ip, deviceId || null, fingerprint, userAgent ? String(userAgent).slice(0, 400) : null, JSON.stringify(details ?? {})],
  );
  return Number(r.rows[0].id);
}

// ---- 设备指纹管理（/api/admin/devices*）----
// CO-5/B4-2 第八轮（docs/DESIGN-AUDIT.md B4）：listDevices / listDeviceBans 只被本域
// 路由使用、已抽到 admin-access-repository.js（顶部 re-export 保持 db.* 签名不变）；
// insertDeviceLog / activeDeviceBans 被 devices.js 设备拦截中间件使用、
// upsertDeviceBan / removeDeviceBan 被 server.js #11 批量封设备段与 routes/appeal.js
// 申诉解封使用、fingerprintOfDeviceId 被申诉域使用，留本文件。

export async function activeDeviceBans(q) {
  const r = await q(`select fingerprint, device_id, note, until from device_bans where until is null or until > now()`);
  return r.rows;
}

/** until 传 null = 永久。 */
export async function upsertDeviceBan(q, { fingerprint, deviceId = null, note = null, until = null }) {
  const r = await q(
    `insert into device_bans (fingerprint, device_id, note, until)
     values ($1, $2, $3, $4)
     on conflict (fingerprint) do update
       set device_id = coalesce(excluded.device_id, device_bans.device_id),
           note = excluded.note,
           until = excluded.until
     returning fingerprint, device_id, note, until, created_at`,
    [fingerprint, deviceId || null, note ? String(note).slice(0, 300) : null, until],
  );
  return r.rows[0];
}

export async function removeDeviceBan(q, fingerprint) {
  const r = await q('delete from device_bans where fingerprint = $1', [fingerprint]);
  return r.rowCount ?? 0;
}

/** 申诉解封设备用：按设备码回查最近一次上报的指纹（device_bans 按指纹存）。 */
export async function fingerprintOfDeviceId(q, deviceId) {
  const r = await q(
    'select fingerprint from device_logs where device_id = $1 order by id desc limit 1',
    [deviceId],
  );
  return r.rows[0]?.fingerprint ?? null;
}

// ---------------------------------------------------------------- 异常请求审核（不自动封）

// ---- 异常请求审核管理（/api/admin/reviews*）----
// CO-5/B4-2 第八轮（docs/DESIGN-AUDIT.md B4）：listAbuseReviews / getAbuseReview /
// countPendingReviews / lastUaByIp 只被本域路由使用、已抽到 admin-access-repository.js
// （顶部 re-export 保持 db.* 签名不变）；recordAbuseReview / markReviewsAutoBanned /
// finishAbuseReview 被 server.js 拦截链（路径/超频记录与自动标记）与 #11 批量审核段
// 使用，留本文件。

/**
 * 记录一条待审核的异常请求；同一 IP 同一规则在 pending 状态下合并计数。
 * 注意：这只写审核表，**不封禁**。
 */
export async function recordAbuseReview(q, { ip = null, deviceId = null, fingerprint = null, rule, detail = null, path = null, hits = 1 }) {
  const r = await q(
    `insert into abuse_reviews (ip, device_id, fingerprint, rule, detail, path, hits)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (ip, rule) where status = 'pending'
     do update set
       hits = abuse_reviews.hits + 1,
       last_seen = now(),
       path = coalesce(excluded.path, abuse_reviews.path),
       detail = coalesce(excluded.detail, abuse_reviews.detail),
       device_id = coalesce(excluded.device_id, abuse_reviews.device_id),
       fingerprint = coalesce(excluded.fingerprint, abuse_reviews.fingerprint)
     returning id, hits, status`,
    [ip, deviceId || null, fingerprint || null, String(rule), detail ? String(detail).slice(0, 300) : null, path ? String(path).slice(0, 300) : null, Number(hits) || 1],
  );
  return r.rows[0];
}

// 待审口径（docs/BAN-AND-SECURITY-FIXES.md §5）：待审 = 所有 pending。
// v1.9.0 起封禁动作已把该 IP 的旧 pending 标成 auto_banned 永久退出待审，所以列表
// **不再**按"IP 是否处于临时封禁"二次过滤——封禁期间新产生的 pending 恰恰是最该看的，
// 而且状态列本来就写着「待审」。列表与 countPendingReviews 必须同一口径
// （两者 SQL 均已随域抽到 admin-access-repository.js）。

/**
 * 封禁动作发生时的清理：把该 IP 的 pending 审核标记为 auto_banned（旧记录永久退出待审）。
 * 该 IP 之后的新异常仍会生成新 pending（不永久屏蔽）。note 区分自动/手动封禁来源。
 */
export async function markReviewsAutoBanned(q, { ip, note = '自动封禁' }) {
  const r = await q(
    `update abuse_reviews
        set status = 'auto_banned', reviewed_at = now(), note = coalesce(note, $2)
      where ip = $1 and status = 'pending'`,
    [ip, String(note).slice(0, 300)],
  );
  return r.rowCount ?? 0;
}

export async function finishAbuseReview(q, id, { status, reviewedBy = null, note = null }) {
  const r = await q(
    `update abuse_reviews
        set status = $2, reviewed_by = $3, reviewed_at = now(), note = coalesce($4, note)
      where id = $1
      returning id, status, ip, device_id, fingerprint, rule, reviewed_at`,
    [id, String(status), reviewedBy, note ? String(note).slice(0, 300) : null],
  );
  return r.rows[0] ?? null;
}

// ── CH 批（docs/DISCOVERY-FOR-YOU.md §2/§4）：行为学习 ─────────────────────────
// 稳定键 (user_id, game_id, action)，重复上报只加 count（幂等）；搜索行为 game_id 为空。

/** 行为上报（幂等只加 count）。action 白名单由 server 层校验。 */
export async function upsertUserBehavior(q, { userId, gameId = null, action, weight = 1 }) {
  await q(
    `insert into user_behaviors (user_id, game_id, action, weight, count)
     values ($1, $2, $3, $4, 1)
     on conflict (user_id, game_id, action) do update set
       count = user_behaviors.count + 1,
       last_at = now(),
       weight = greatest(user_behaviors.weight, excluded.weight)`,
    [userId, gameId, String(action), Number(weight) || 1],
  );
}

/** 搜索词落库（仅本人画像用；无查询页面）。 */
export async function insertUserSearchLog(q, { userId, query, clickedGameId = null }) {
  await q('insert into user_search_logs (user_id, query, clicked_game_id) values ($1, $2, $3)', [
    userId,
    String(query).slice(0, 300),
    clickedGameId,
  ]);
}

// ---------------------------------------------------------------- 手动同步任务记录

// listSyncRuns 只被本域（admin-sync）路由使用、已抽到 admin-sync-repository.js
// （顶部 re-export 保持 db.* 签名不变）；sync_runs 其余函数跨模块共用（cli.js 同步命令
// /scheduler.js 调度互斥与预算/server.js 启动清理），留本文件。

export async function insertSyncRun(q, { mode, args = null }) {
  const r = await q('insert into sync_runs (mode, args) values ($1, $2) returning id, started_at', [mode, args]);
  return { id: Number(r.rows[0].id), startedAt: r.rows[0].started_at };
}

export async function finishSyncRun(q, id, { status = 'ok', exitCode = null, output = null }) {
  await q(
    'update sync_runs set status = $1, exit_code = $2, output = $3, finished_at = now() where id = $4',
    [status, exitCode, output ? String(output).slice(-8000) : null, id],
  );
}

/** 正在跑的同步（进程内只有一条；服务重启后这行会残留，启动时清掉）。 */
export async function runningSyncRun(q) {
  const r = await q("select id, mode, started_at from sync_runs where status = 'running' order by id desc limit 1");
  return r.rows[0] ?? null;
}

/**
 * B3 批（docs/DESIGN-AUDIT.md B3）：各 mode 最近 sinceDays 天成功运行的平均耗时（秒）——
 * 调度预算从理论估算改实测（AC-4）；样本不足 minRuns 的 mode 不回传（调用方回落理论值）。
 */
export async function observedSyncRunSeconds(q, { sinceDays = 30, minRuns = 2 } = {}) {
  const r = await q(
    `select mode, count(*)::int as runs, avg(extract(epoch from (finished_at - started_at)))::float8 as avg_sec
       from sync_runs
      where status = 'ok' and finished_at is not null and started_at > now() - ($1 || ' days')::interval
      group by mode`,
    [String(sinceDays)],
  );
  const map = new Map();
  for (const row of r.rows ?? []) {
    if (typeof row.mode !== 'string' || !row.mode) continue;
    if ((Number(row.runs) ?? 0) < minRuns) continue;
    const sec = Number(row.avg_sec);
    if (Number.isFinite(sec) && sec > 0) map.set(row.mode, sec);
  }
  return map;
}

/**
 * CO-1/A5（docs/DESIGN-AUDIT.md A5）：任务失败原因——该 mode 最近一条 failed 记录的输出。
 * 子进程退出前已由 runSyncTracked 写入（err.message，≤500 字符），调度器取它作健康条/告警的失败原因。
 */
export async function lastFailedSyncRun(q, mode) {
  const r = await q("select output from sync_runs where mode = $1 and status = 'failed' order by id desc limit 1", [String(mode)]);
  return r.rows[0]?.output ?? null;
}

/**
 * 每个 mode 最近一次开始时间（X 批 P1-1）：调度器重启后用这些值恢复 lastRunMs，
 * 避免每次发版都把全部任务打回首轮延迟重新计时。调用方负责把 mode 名对齐 job.name。
 */
export async function lastSyncRunStartedByMode(q) {
  const r = await q('select mode, max(started_at) as last from sync_runs group by mode');
  return r.rows ?? [];
}

/**
 * 服务启动时把上次中断的 running 记录标成「被重启中断」（EU-1），避免按钮永远禁用；
 * 与 CLI 收到 SIGTERM 时的 interrupted 收尾同语义，前端「同步记录」显示「被重启中断」。
 */
export async function markStaleSyncRuns(q) {
  const r = await q(
    "update sync_runs set status = 'interrupted', finished_at = now(), " +
    "output = coalesce(output, '') || '\n（服务重启，任务中断）' where status = 'running'",
  );
  return r.rowCount ?? 0;
}

/**
 * FP 批（docs/SYNC-HARDENING.md §2 P0）：僵尸锁修复——把「running 超过 staleHours 小时」的
 * sync_runs 记录判为僵尸并标记 interrupted（backup 卡死 39 小时占住 heavy slot 的根因）。
 * 返回被打上僵尸标记的条数；调度器据返回值记 scheduler.stale_run_interrupted。
 */
export async function interruptStaleSyncRuns(q, { staleHours = 2 } = {}) {
  const hours = Number.isFinite(Number(staleHours)) && Number(staleHours) > 0 ? Number(staleHours) : 2;
  const r = await q(
    "update sync_runs set status = 'interrupted', finished_at = now(), " +
    "output = coalesce(output, '') || '\n（运行超过 ' || $1::text || ' 小时，判为僵尸运行并中断）' " +
    "where status = 'running' and started_at < now() - ($1 || ' hours')::interval",
    [String(hours)],
  );
  return r.rowCount ?? 0;
}

// ---------------------------------------------------------------- 元数据写入

/**
 * DS 批（docs/SEARCH-ALIASES.md §3）：写入路径顺带生成 search_tokens。
 * 用「最终生效的名字」重算（upsertGameMeta/ensureGame 的名字覆盖保护在 SQL 里，先 returning 拿到
 * 落库后的真实 name/name_en 再算，永不与保护逻辑漂移）；`is distinct from` 保证幂等——名字没变、
 * token 没变时一行都不写。
 */
export async function refreshSearchTokens(q, { id, name, nameEn }) {
  const tokens = deriveSearchTokens({ name, nameEn });
  await q(
    'update games set search_tokens = $2, search_tokens_at = now() where id = $1 and search_tokens is distinct from $2',
    [id, tokens],
  );
}

/**
 * DS 批（docs/SEARCH-ALIASES.md §3）：增量/全量重建 search_tokens。
 * 增量口径：search_tokens 为空、从未生成过、或名字在生成后被改过（updated_at > search_tokens_at）；
 * 重算后 search_tokens_at 前进，条件收敛，没活时一轮秒退。--full 全量按 id 游标翻页。
 * 每批一条 VALUES 批量 UPDATE；token 没变的行也把 search_tokens_at 推到 now()（否则永远留在候选里不收敛），
 * returning 区分「token 真变化」（written 口径）与「只 touch 时间」。
 * 返回 { processed, written }。
 */
export async function rebuildSearchTokens(q, { full = false, limit = 50000, batch = 500 } = {}) {
  const cond = full
    ? ''
    : "(g.search_tokens = '{}' or g.search_tokens_at is null or g.updated_at > g.search_tokens_at)";
  const where = cond ? `where ${cond} and g.id > $1` : 'where g.id > $1';
  let processed = 0;
  let written = 0;
  let lastId = 0;
  while (processed < limit) {
    const size = Math.min(batch, limit - processed);
    const r = await q(
      `select g.id, g.name, g.name_en, g.search_tokens from games g ${where} order by g.id limit $2`,
      [lastId, size],
    );
    if (!r.rows.length) break;
    const values = [];
    const params = [];
    const changedRows = [];
    for (const row of r.rows) {
      const tokens = deriveSearchTokens({ name: row.name, nameEn: row.name_en });
      params.push(Number(row.id), tokens);
      values.push(`($${params.length - 1}::bigint, $${params.length}::text[])`);
      if (JSON.stringify(row.search_tokens ?? []) !== JSON.stringify(tokens)) changedRows.push(row.id);
    }
    // token 没变的行也把 search_tokens_at 推到 now()（否则永远留在候选里，不收敛）；
    // 「token 真变化」在 JS 侧对比更新前值计数（UPDATE 的 returning 只能看到新值，测不出变化）。
    await q(
      `update games g
          set search_tokens = case when g.search_tokens is distinct from v.tokens then v.tokens else g.search_tokens end,
              search_tokens_at = now()
         from (values ${values.join(', ')}) as v(id, tokens)
        where g.id = v.id`,
      params,
    );
    written += changedRows.length;
    processed += r.rows.length;
    lastId = Number(r.rows[r.rows.length - 1].id);
    if (r.rows.length < size) break;
  }
  return { processed, written };
}

/**
 * 写入/更新游戏元数据。
 *
 * 名字策略：**只补空缺，唯一例外是"机器英文名"**。
 * 目录导入（GetAppList 无本地化）把英文名写进了 name（旧版）或 name_en（新版），
 * 此后回填拿到的中文名一直被 `coalesce` 挡在外面。所以：
 *   - name 为空 → 补上；
 *   - name 是机器英文名（name 不含中文，且 name_en 为空或与 name 相同）→
 *     允许被中文名覆盖，并把被替换的英文名挪进 name_en；
 *   - 其余（人工维护的中文名、或 name_en 与 name 不同的人工英文名）→ 不覆盖，
 *     避免 730 的 sc_schinese 旧名把「反恐精英 2」改坏。
 * 其余字段（类型/封面/发行日期/is_free）仍以元数据为准。
 * DS 批：search_tokens 随本次写入顺带生成（插入走同一条 SQL，更新 returning 最终名字后对齐）。
 */
export async function upsertGameMeta(q, item) {
  // 类型统一小写：老数据里有 PICS 镜像的 'Game'/'DLC' 大小写混用，前端按小写匹配
  const appType = item.appType == null ? null : String(item.appType).toLowerCase();
  const tokens = deriveSearchTokens({ name: item.nameZh ?? null, nameEn: item.nameEn ?? null });
  const r = await q(
    `insert into games (steam_appid, name, name_en, app_type, is_free, header_image, release_date,
                        developers, publishers, genres, tags, description, dlc_appids, search_tokens)
     values ($1, $2, $3, $4, coalesce($5, false), $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::text[])
     on conflict (steam_appid) do update set
       name = case
         when excluded.name is null then games.name
         when games.name is null or games.name = '' then excluded.name
         when (games.name_en is null or games.name_en = games.name)
              and games.name !~ '[一-龥]' then excluded.name
         else games.name
       end,
       name_en = case
         when excluded.name_en is not null and excluded.name_en <> ''
              and (games.name_en is null or games.name_en = '') then excluded.name_en
         when (games.name_en is null or games.name_en = '' or games.name_en = games.name)
              and games.name !~ '[一-龥]'
              and games.name !~ '^appid:[0-9]+$'
              and excluded.name is not null and excluded.name ~ '[一-龥]'
              then games.name
         else games.name_en
       end,
       app_type = coalesce(excluded.app_type, games.app_type),
       is_free = case when $5::boolean is null then games.is_free else $5::boolean end,
       header_image = coalesce(excluded.header_image, games.header_image),
       release_date = coalesce(excluded.release_date, games.release_date),
       developers = coalesce(excluded.developers, games.developers),
       publishers = coalesce(excluded.publishers, games.publishers),
       genres = coalesce(excluded.genres, games.genres),
       tags = coalesce(excluded.tags, games.tags),
       description = coalesce(nullif(games.description, ''), excluded.description),
       -- BP 批（docs/GAME-DLC.md §3.1）：GetItems 路径没有 dlcAppIds（null）——不能把已有值清空
       dlc_appids = case when excluded.dlc_appids is null then games.dlc_appids else excluded.dlc_appids end,
       updated_at = now()
     returning id, name, name_en, (xmax = 0) as inserted`,
    [
      item.steamAppid,
      item.nameZh ?? null,
      item.nameEn ?? null,
      appType,
      item.isFree ?? null,
      item.headerImage ?? null,
      item.releaseDate ?? null,
      item.developers ?? null,
      item.publishers ?? null,
      item.genres ?? null,
      item.tags ?? null,
      item.description ?? null,
      item.dlcAppIds == null ? null : JSON.stringify(item.dlcAppIds),
      tokens,
    ],
  );
  const row = r.rows[0];
  // 更新分支的名字可能被覆盖保护改写（returning 是落库后的真实值），按真实名字对齐 search_tokens；
  // 插入分支已在同一条 SQL 写入，这里 `is distinct from` 不会产生额外写。
  if (row && !row.inserted) {
    await refreshSearchTokens(q, { id: Number(row.id), name: row.name, nameEn: row.name_en });
  }
  return { id: Number(row.id), created: row.inserted === true, name: row.name ?? null, nameEn: row.name_en ?? null };
}

// ---------------------------------------------------------------- BP：DLC（docs/GAME-DLC.md §3.1）

/**
 * 写入 dlc_appids 并同步 game_dlc 占位行：
 * - games.dlc_appids = 去重后的数组（调用方保证已过滤/上限 2000）；空数组 = 确认过没有 DLC（synced 口径）；
 * - 为每个 appid 建占位行（name/price 为空，后续 GetItems 补齐）；已存在不动；
 * - 差集清理：删掉 game_dlc 里不在新数组中的行（DLC 下架/改版也能收敛）。
 * 返回 { gameId, dlc, changed }；appid 不在库（gameId 为 null）不写。
 */
export async function writeDlcAppids(q, { steamAppid, dlcAppIds }) {
  const ids = [...new Set((dlcAppIds ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 2000);
  const json = JSON.stringify(ids);
  const r = await q(
    'update games set dlc_appids = $2::jsonb, updated_at = now() where steam_appid = $1 and dlc_appids is distinct from $2::jsonb returning id',
    [steamAppid, json],
  );
  const gameId = r.rows[0] ? Number(r.rows[0].id) : null;
  if (!gameId) return { gameId, dlc: ids.length, changed: false };
  if (ids.length) {
    await q(
      'insert into game_dlc (game_id, appid) select $1, unnest($2::int[]) on conflict (game_id, appid) do nothing',
      [gameId, ids],
    );
  }
  await q('delete from game_dlc where game_id = $1 and not (appid = any($2::int[]))', [gameId, ids]);
  return { gameId, dlc: ids.length, changed: true };
}

/** GetItems 结果 → game_dlc 补齐名称/价格/折扣/币种/在售（upsert，返回写入条数）。 */
export async function upsertGameDlc(q, { gameId, items }) {
  const rows = (items ?? [])
    .map((it) => ({
      appid: Number(it?.steamAppid),
      name: it?.nameZh ?? null,
      price: it?.priceOverview?.final ?? null,
      original: it?.priceOverview?.initial ?? null,
      discount: Number(it?.priceOverview?.discountPercent ?? 0),
      currency: it?.priceOverview?.currency ?? 'CNY',
    }))
    .filter((r) => Number.isFinite(r.appid) && r.appid > 0);
  if (!rows.length) return 0;
  const values = rows.map((_, i) => {
    const b = i * 6 + 2;
    return `($1, $${b}, $${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, true, now())`;
  });
  const params = [gameId, ...rows.flatMap((r) => [r.appid, r.name, r.price, r.original, r.discount, r.currency])];
  const r = await q(
    `insert into game_dlc (game_id, appid, name, price_cents, original_cents, discount_pct, currency, in_stock, synced_at)
     values ${values.join(', ')}
     on conflict (game_id, appid) do update set
       name = excluded.name,
       price_cents = excluded.price_cents,
       original_cents = excluded.original_cents,
       discount_pct = excluded.discount_pct,
       currency = excluded.currency,
       in_stock = true,
       synced_at = now()`,
    params,
  );
  return r.rowCount ?? 0;
}

/** 指定游戏缺明细的 appid 列表（补齐用）。 */
export async function listDlcMissingAppids(q, { gameIds }) {
  const ids = [...new Set((gameIds ?? []).map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  if (!ids.length) return [];
  const r = await q(
    `select d.game_id as "gameId", d.appid
     from game_dlc d
     where d.game_id = any($1::int[]) and (d.name is null or d.name = '' or d.price_cents is null)
     order by d.game_id, d.appid`,
    [ids],
  );
  return r.rows.map((row) => ({ gameId: Number(row.gameId), appid: Number(row.appid) }));
}

/** steam-status 收尾：有 DLC、但明细没补齐的游戏（按缺明细数取前 N 个）。 */
export async function listDlcFillGames(q, { limit = 50 }) {
  const r = await q(
    `select g.id
     from games g
     where g.dlc_appids is not null
       and jsonb_array_length(g.dlc_appids) > 0
       and exists (
         select 1 from game_dlc d
         where d.game_id = g.id and (d.name is null or d.name = '' or d.price_cents is null)
       )
     order by g.heat desc nulls last, g.id asc
     limit $1`,
    [limit],
  );
  return r.rows.map((row) => Number(row.id));
}

/** 标记这批 appid 已跑过回填（无论有没有拿到报价），让下一次选择跳过它们。 */
export async function markBackfilled(q, appids = []) {
  const ids = [...new Set((appids ?? []).map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  if (!ids.length) return 0;
  const r = await q('update games set backfill_at = now() where steam_appid = any($1::int[])', [ids]);
  return r.rowCount ?? 0;
}

// ---------------------------------------------------------------- BL：回填候选（docs/BACKFILL-THROUGHPUT.md §3.1/§3.3）

/**
 * 回填候选谓词（公共片段，CLI 与统计共用，避免两处分叉）：
 * - 缺描述 / 无 Steam 报价 / 有价缺图 之一即候选（BC 批起为 OR 条件）；
 * - BL-1：排除已定性四态 free / coming_soon / region_locked / not_found——它们永远不会有报价，回填只白烧配额；
 *   no_price（国区无价）保留（可能后续有价）；
 * - BL-3：失败隔离期内（backfill_skip_until）不入选；
 * - 1 天冷却（backfill_at）可选（统计口径不带，运行中候选带）。
 * - GA-2（docs/SYNC-PAGE-REDESIGN.md §3.7）：includeRename=true 时并入 rename 的候选
 *   （name 为空 / 不含简中）——GetItems 本来就是 schinese，同一批响应顺带写中文名；
 *   改名支不受四态排除影响（free/coming_soon 照样要中文名，rename 时代的候选口径如此）。
 */
export function backfillCandidateWhere({ includeCooldown = true, includeSkip = true, excludeStates = true, includeRename = false } = {}) {
  const parts = ['g.steam_appid is not null and not g.deleted'];
  if (includeCooldown) parts.push("(g.backfill_at is null or g.backfill_at < now() - interval '1 day')");
  const fills =
    "(g.description is null or g.description = '' or not exists (select 1 from offers o where o.game_id = g.id and o.platform_code = 'steam') " +
    'or (g.header_image is null and exists (select 1 from offers o where o.game_id = g.id)))';
  if (includeRename) {
    const rename = "(g.name is null or g.name = '' or g.name !~ '[一-龥]')";
    const states = excludeStates ? "coalesce(g.steam_status, '') not in ('free', 'coming_soon', 'region_locked', 'not_found')" : 'true';
    parts.push(`(${rename} or (${fills} and ${states}))`);
  } else {
    parts.push(fills);
    if (excludeStates) parts.push("coalesce(g.steam_status, '') not in ('free', 'coming_soon', 'region_locked', 'not_found')");
  }
  if (includeSkip) parts.push('(g.backfill_skip_until is null or g.backfill_skip_until < now())');
  return parts.join(' and ');
}

/**
 * 回填候选列表（AC-9：新游戏优先，按收录时间倒序）。
 * GA-2（docs/SYNC-PAGE-REDESIGN.md §3.7）：includeRename=true 时候选池 = 回填候选 ∪「中文名待补」候选
 * （backfill 命令默认带上；rename 已合并进 backfill，同一批 GetItems 顺带写中文名，零额外请求）。
 * 统计/其它老调用方不传 → 保持旧口径（不把「只缺中文名」的行算进回填候选数）。
 */
export async function listBackfillCandidates(q, { limit, includeRename = false }) {
  // FP 批 P2（docs/SYNC-HARDENING.md §2）：429 队列优先——上一轮撞 429 的 appid 排最前（attempts 少的先补）
  const r = await q(
    `select g.steam_appid from games g ` +
      `left join sync_429_queue sq on sq.steam_appid = g.steam_appid ` +
      `where ${backfillCandidateWhere({ includeRename })} ` +
      `order by (sq.steam_appid is not null) desc, sq.attempts asc nulls last, g.created_at desc nulls last, g.id desc limit $1`,
    [limit],
  );
  return r.rows.map((row) => Number(row.steam_appid)).filter((n) => Number.isFinite(n) && n > 0);
}

// ---------------------------------------------------------------- FP 批 P2：429 补跑队列（docs/SYNC-HARDENING.md §2）

/** FP P2：429 收轮时把未完成的 appid 记入补跑队列（重复入队 attempts+1、时间刷新）。返回写入条数。 */
export async function record429Appids(q, appids = []) {
  const ids = [...new Set((appids ?? []).map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  if (!ids.length) return 0;
  const r = await q(
    'insert into sync_429_queue (steam_appid) select unnest($1::int[]) ' +
      'on conflict (steam_appid) do update set attempts = sync_429_queue.attempts + 1, last_seen_at = now()',
    [ids],
  );
  return r.rowCount ?? 0;
}

/** FP P2：补跑成功后从队列清除。返回清除条数。 */
export async function clear429Appids(q, appids = []) {
  const ids = [...new Set((appids ?? []).map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  if (!ids.length) return 0;
  const r = await q('delete from sync_429_queue where steam_appid = any($1::int[])', [ids]);
  return r.rowCount ?? 0;
}

/** FP P2：429 队列统计 { count, oldestAt }（后台卡片可见进度）。 */
export async function sync429QueueStats(q) {
  const r = await q(
    'select count(*)::int as count, min(first_seen_at) as oldest_at, max(attempts)::int as max_attempts from sync_429_queue',
  );
  const row = r.rows[0] ?? {};
  return { count: Number(row.count ?? 0), oldestAt: row.oldest_at ?? null, maxAttempts: Number(row.max_attempts ?? 0) };
}

/**
 * FP 批 P2（docs/SYNC-HARDENING.md §2）：数据时效统计——价格/状态/中文名/图片四类数据
 * 各自「超 1/3/7 天未更新」数量（后台「数据时效」卡片 + 一键补跑）。
 * 口径：
 *  - prices：offers.last_seen_at 超 1/3/7 天的报价条数（主键维度 (game,platform,kind,region)）；
 *  - status：games.steam_checked_at 超期的游戏数（从未判定 = 全部计入超 7 天档）；
 *  - names：name 不含简中字符的游戏数（按 updated_at 分档；从未更新计入超 7 天档）；
 *  - images：header_image 为空的游戏数（按 updated_at 分档）。
 */
export async function dataFreshnessStats(q) {
  // 三档口径：d7 = 超 7 天（含从未更新）；d3 = 超 3 天未超 7 天；d1 = 超 1 天未超 3 天
  const parts = (col) => `
    'd1', count(*) filter (where ${col} >= now() - interval '3 days' and ${col} < now() - interval '1 day')::int,
    'd3', count(*) filter (where ${col} >= now() - interval '7 days' and ${col} < now() - interval '3 days')::int,
    'd7', count(*) filter (where ${col} < now() - interval '7 days' or ${col} is null)::int,
    'total', count(*)::int`;
  const r = await q(
    `select ` +
      `(select jsonb_build_object(${parts('o.last_seen_at')}) from offers o) as prices, ` +
      `(select jsonb_build_object(${parts('g.steam_checked_at')}) from games g where g.steam_appid is not null and not g.deleted) as status, ` +
      `(select jsonb_build_object(${parts('g2.updated_at')}) from games g2 where not g2.deleted and (g2.name is null or g2.name !~ '[\\u4e00-\\u9fa5]')) as names, ` +
      `(select jsonb_build_object(${parts('g3.updated_at')}) from games g3 where not g3.deleted and (g3.header_image is null or g3.header_image = '')) as images`,
  );
  const row = r.rows[0] ?? {};
  const clean = (v) => ({ d1: Number(v?.d1 ?? 0), d3: Number(v?.d3 ?? 0), d7: Number(v?.d7 ?? 0), total: Number(v?.total ?? 0) });
  return { prices: clean(row.prices), status: clean(row.status), names: clean(row.names), images: clean(row.images) };
}

/** 回填候选总数（BL-2 进度文件 candidateTotal / 观测口径）。 */
export async function countBackfillCandidates(q, opts = {}) {
  // v2.28.4：兼容「q 函数」与「store 对象（{ query }）」两种调用——B4 拆分后 ops.js 传的是 store，
  // 旧实现直接 q(...) 会 TypeError: q is not a function（backfill 任务每次调度都失败）。
  const query = typeof q === 'function' ? q : (sql, p) => q.query(sql, p);
  const r = await query(`select count(*)::int as n from games g where ${backfillCandidateWhere(opts)}`);
  return Number(r.rows[0]?.n ?? 0);
}

// ---------------------------------------------------------------- BL-3：失败隔离（docs/BACKFILL-THROUGHPUT.md §3.3）

/** 回填失败计数：count+1；达到 3 次 → skip_until = now()+30 天。返回本轮触发跳过的条目（供日志）。 */
export async function recordBackfillFailures(q, appids = []) {
  const ids = [...new Set((appids ?? []).map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  if (!ids.length) return [];
  await q(
    'update games set backfill_fail_count = backfill_fail_count + 1, backfill_skip_until = null where steam_appid = any($1::int[])',
    [ids],
  );
  const r = await q(
    "update games set backfill_skip_until = now() + interval '30 days' " +
      'where steam_appid = any($1::int[]) and backfill_fail_count >= 3 returning steam_appid, backfill_fail_count',
    [ids],
  );
  return r.rows.map((row) => ({ appid: Number(row.steam_appid), count: Number(row.backfill_fail_count) }));
}

/** 回填成功：失败计数清零并解除跳过。 */
export async function clearBackfillFailures(q, appids = []) {
  const ids = [...new Set((appids ?? []).map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  if (!ids.length) return 0;
  const r = await q(
    'update games set backfill_fail_count = 0, backfill_skip_until = null where steam_appid = any($1::int[])',
    [ids],
  );
  return r.rowCount ?? 0;
}

/** 热度回填：无论拿没拿到评测都写 heat_at（续跑游标）；releaseDate/appType 为空时不覆盖已有值。 */
export async function setGameHeat(q, { steamAppid, heat = null, heatReviews = 0, releaseDate = null, appType = null }) {
  await q(
    'update games set heat = $2, heat_reviews = $3, heat_at = now(), release_date = coalesce($4, release_date), app_type = coalesce($5, app_type) where steam_appid = $1',
    [steamAppid, heat, heatReviews, releaseDate, appType],
  );
}

/** 热度批次网络失败时：本批只记 heat_at（下轮再试），避免 heat_at is null 的游标原地打转。 */
export async function markHeatSkipped(q, appids = []) {
  const ids = [...new Set((appids ?? []).map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  if (!ids.length) return 0;
  const r = await q('update games set heat_at = now() where steam_appid = any($1::int[]) and heat_at is null', [ids]);
  return r.rowCount ?? 0;
}

/** 标记感兴趣 / 不感兴趣。不感兴趣只影响展示，不影响采集与金额统计。 */
export async function setInterest(q, { steamAppid = null, gameId = null, interested }) {
  const params = [Boolean(interested)];
  let where = null;
  if (steamAppid != null) {
    where = 'steam_appid = $2';
    params.push(steamAppid);
  } else if (gameId != null) {
    where = 'id = $2';
    params.push(gameId);
  } else {
    throw new Error('setInterest 需要 steamAppid 或 gameId');
  }
  const r = await q(`update games set interested = $1, updated_at = now() where ${where} returning id, name, interested`, params);
  return r.rows[0] ?? null;
}

/** 已拥有标记。已拥有默认在列表里收起，但仍照常采集与统计。支持按 appid 或内部 id。 */
export async function setOwned(q, { steamAppid = null, gameId = null, owned }) {
  const params = [Boolean(owned)];
  let where = null;
  if (steamAppid != null) {
    where = 'steam_appid = $2';
    params.push(steamAppid);
  } else if (gameId != null) {
    where = 'id = $2';
    params.push(gameId);
  } else {
    throw new Error('setOwned 需要 steamAppid 或 gameId');
  }
  const r = await q(`update games set owned = $1, updated_at = now() where ${where} returning id, name, owned`, params);
  return r.rows[0] ?? null;
}

/** 后台游戏同步概览：总数 / 有 appid / 六态分项 / 已删除 / 有报价。
 *  已随 B4 #15 搬到 admin-games-repository.js（pg.js 顶部 re-export，旧 db.* 签名不变）。 */

// ---------------------------------------------------------------- Steam 同步状态与内容分级
// docs/STEAM-SYNC-STATUS-AND-RATING.md：状态判定与分级采集共用同一次 appdetails 请求。

/** 免费游戏批量置位（迁移已含；任务/手工也可幂等重跑）：返回本次置位条数。 */
export async function bulkSetFreeStatus(q) {
  const r = await q(`update games set steam_status = 'free' where is_free and steam_status is null`);
  return r.rowCount ?? 0;
}

/** steam-status 任务选取：未探测（steam_status 为 null）或 30 天过期；免费永远不再选。
 * FP 批 P2（docs/SYNC-HARDENING.md §2）：429 队列里的 appid 优先（attempts 少的先补）。 */
export async function listSteamStatusCandidates(q, { limit = 30 } = {}) {
  const r = await q(
    `select g.id, g.steam_appid from games g
      left join sync_429_queue sq on sq.steam_appid = g.steam_appid
      where g.steam_appid is not null and not g.deleted
        and g.steam_status is distinct from 'free'
        and (g.steam_checked_at is null or g.steam_checked_at < now() - interval '30 days')
      order by (sq.steam_appid is not null) desc, sq.attempts asc nulls last, g.steam_checked_at asc nulls first, g.id
      limit $1`,
    [Math.min(Math.max(Number(limit) || 30, 1), 200)],
  );
  return r.rows.map((row) => ({ id: Number(row.id), steamAppid: Number(row.steam_appid) }));
}

/**
 * 状态写回（docs/STEAM-SYNC-STATUS-AND-RATING.md §14.3 写入语义）：
 * - status 为 null → 不写 steam_status、不推 steam_checked_at 游标（留给 steam-status 判定）；
 * - 分级字段传 null → 不覆盖已有值（coalesce 保留旧值）；
 * - adultFlag / matureFlag 传 null → 不覆盖（false/true 显式写）。
 */
/** BC 批（docs/IMAGE-COVERAGE.md §3.1）：补 header_image——只在库内为空时写，不覆盖已有值。 */
export async function fillHeaderImage(q, { steamAppid, url }) {
  if (!steamAppid || !url) return { rowCount: 0 };
  return q('update games set header_image = $2 where steam_appid = $1 and header_image is null', [steamAppid, url]);
}

/**
 * EC 批（docs/IMAGE-COVERAGE.md §8 EC-2）：header_image 为空的回填候选——
 * 限速逐 appid 元数据重同步（appdetails 响应带 header_image），补完即收敛（谓词不再命中）。
 */
export async function missingHeaderImageAppids(q, { limit = 100 } = {}) {
  const r = await q(
    'select g.id, g.steam_appid, coalesce(nullif(g.name, \'\'), nullif(g.name_en, \'\'), \'appid:\' || g.steam_appid) as name ' +
      'from games g where g.steam_appid is not null and g.header_image is null and not g.deleted ' +
      'order by g.updated_at desc nulls last, g.id desc limit $1',
    [Math.min(Math.max(Number(limit) || 100, 1), 500)],
  );
  return r.rows.map((row) => ({ id: Number(row.id), steamAppid: Number(row.steam_appid), name: String(row.name ?? '') }));
}
export async function setSteamStatus(q, {
  steamAppid,
  status = null,
  requiredAge = null,
  contentDescriptors = null,
  ageRatings = null,
  adultFlag = null,
  explicitFlag = null,
  matureFlag = null,
}) {
  const params = [steamAppid];
  const push = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  const sets = [];
  if (status != null) {
    sets.push(`steam_status = ${push(status)}`, 'steam_checked_at = now()');
  }
  sets.push(`required_age = coalesce(${push(requiredAge == null ? null : Number(requiredAge))}, required_age)`);
  sets.push(
    `content_descriptors = coalesce(${push(Array.isArray(contentDescriptors) ? contentDescriptors.map(Number) : null)}::int[], content_descriptors)`,
  );
  sets.push(`age_ratings = coalesce(${push(ageRatings ? JSON.stringify(ageRatings) : null)}::jsonb, age_ratings)`);
  if (adultFlag != null) sets.push(`adult_flag = ${push(Boolean(adultFlag))}`);
  if (explicitFlag != null) sets.push(`explicit_flag = ${push(Boolean(explicitFlag))}`);
  if (matureFlag != null) sets.push(`mature_flag = ${push(Boolean(matureFlag))}`);
  sets.push('updated_at = now()');
  const r = await q(`update games set ${sets.join(', ')} where steam_appid = $1 returning id, steam_status`, params);
  return r.rows[0] ?? null;
}

/** 已随 B4 #15 搬到 admin-games-repository.js（adminGameLinks 单游戏平台链接 /
 *  listDeletedGames 回收站列表，pg.js 顶部 re-export，旧 db.* 签名不变）。 */
export async function markNotified(q, { watchId, priceCents }) {
  await q('update watchlist set last_notified_at = now(), last_notified_cents = $1 where id = $2', [
    priceCents,
    watchId,
  ]);
}

// ---------------------------------------------------------------- 合并重复游戏

/**
 * 把 fromGame 合并进 toGame（典型场景：先按名称建了无 appid 的行，后来确认了
 * Steam appid，需要并到已有游戏行上）。
 *
 * 顺序很重要：先搬报价（快照跟着 offer_id 走），再搬日聚合（同键取更低价），
 * 再搬别名与关注，最后删源行。同平台同渠道类型的重复报价保留目标行的那条。
 */
export async function mergeGames(q, { fromGameId, toGameId, logger = null }) {
  if (!fromGameId || !toGameId || Number(fromGameId) === Number(toGameId)) {
    return { merged: false, reason: 'same_or_invalid' };
  }

  const source = await q('select id, steam_appid from games where id = $1', [fromGameId]);
  if (!source.rows.length) return { merged: false, reason: 'source_missing' };
  const target = await q('select id from games where id = $1', [toGameId]);
  if (!target.rows.length) return { merged: false, reason: 'target_missing' };

  const offers = await q(
    'select id, platform_code, product_type, region from offers where game_id = $1',
    [fromGameId],
  );
  let moved = 0;
  let dropped = 0;
  for (const offer of offers.rows) {
    const dup = await q(
      'select id from offers where game_id = $1 and platform_code = $2 and product_type = $3 and region = $4',
      [toGameId, offer.platform_code, offer.product_type, offer.region],
    );
    if (dup.rows.length) {
      await q('delete from price_snapshots where offer_id = $1', [offer.id]);
      await q('delete from offers where id = $1', [offer.id]);
      dropped += 1;
    } else {
      await q('update offers set game_id = $1 where id = $2', [toGameId, offer.id]);
      moved += 1;
    }
  }

  await q(
    `insert into daily_prices (game_id, platform_code, region, day, min_price_cents, currency)
     select $1, platform_code, region, day, min_price_cents, currency
       from daily_prices where game_id = $2
     on conflict (game_id, platform_code, region, day)
     do update set min_price_cents = least(daily_prices.min_price_cents, excluded.min_price_cents)`,
    [toGameId, fromGameId],
  );
  await q('delete from daily_prices where game_id = $1', [fromGameId]);

  await q('update game_aliases set game_id = $1 where game_id = $2', [toGameId, fromGameId]);

  // 关注列表：目标已有同区服关注时丢掉源行，避免唯一键冲突
  await q(
    `delete from watchlist w
      where w.game_id = $1
        and exists (select 1 from watchlist t where t.game_id = $2 and t.region = w.region)`,
    [fromGameId, toGameId],
  );
  await q('update watchlist set game_id = $1 where game_id = $2', [toGameId, fromGameId]);

  // AV 批（docs/READ-MODEL.md §4）：合并移动了 offers 与 daily，from/to 两个 game 的读模型都要刷新；
  // from 的 games 行删除时快照由外键级联清掉，这里先把它归零避免删前窗口读到旧价。
  await refreshGameRegionPrices(q, fromGameId);
  await refreshGameRegionPrices(q, toGameId);
  await refreshGameRegionHist(q, toGameId);

  await q('delete from games where id = $1', [fromGameId]);

  const result = { merged: true, moved, dropped, fromGameId: Number(fromGameId), toGameId: Number(toGameId) };
  logger?.info('db.merge_games', result);
  return result;
}

// ---------------------------------------------------------------- 读模型对账与重建（docs/READ-MODEL.md §7）

/**
 * 抽样对账：随机取 N 个快照行，实时聚合 offers/daily_prices 与快照逐字段比对（价格 9 列 + 史低 2 列）。
 * 返回 { checked, diffs, fixed, suspect }；fix=true 对出现差异的 game 就地重刷（价格列 + 历史列）。
 * 口径与 refreshGameRegionPrices / touchDailyAggregate 完全一致（官方渠道、在售、日界 prev）。
 *
 * B5 批（docs/DESIGN-AUDIT.md B5 行）增量校验：候选改「变更优先」——先取「底层数据比快照新」的
 * 疑似陈旧行（offers/daily_prices 有比快照 updated_at 更新的写入 = 快照维护被绕过/漏挂的直接信号，
 * 即 DESIGN-AUDIT B5 的「手动 SQL/迁移绕过双写」场景），不足 sample 再随机补齐保持全表兜底覆盖
 * （防快照行本身被直接篡改）。设计理由见 docs/READ-MODEL.md §13。
 */
export async function readModelCheck(q, { sample = 200, fix = false } = {}) {
  const cap = Math.min(Math.max(Number(sample) || 200, 1), 2000);
  // 疑似陈旧行：底层数据比快照新（写入后快照没跟着刷新）
  const suspect = (
    await q(
      `select rs.game_id, rs.region
         from game_region_snapshot rs
        where exists (select 1 from offers o
                       where o.game_id = rs.game_id and o.region = rs.region
                         and o.updated_at > rs.updated_at)
           or exists (select 1 from daily_prices d
                       where d.game_id = rs.game_id and d.region = rs.region
                         and d.updated_at > rs.updated_at)
        order by rs.updated_at asc
        limit $1`,
      [cap],
    )
  ).rows;
  // 随机补齐到 sample（去重，防同一行重复比对）
  const seen = new Set(suspect.map((r) => `${r.game_id}|${r.region}`));
  const rows = [...suspect];
  if (rows.length < cap) {
    const extra = (
      await q('select game_id, region from game_region_snapshot order by random() limit $1', [cap - rows.length])
    ).rows;
    for (const r of extra) {
      const key = `${r.game_id}|${r.region}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(r);
    }
  }
  const diffs = [];
  let fixed = 0;
  const normArr = (v) => (Array.isArray(v) ? [...v].sort().map(String) : v == null ? null : [String(v)]);
  const toIso = (v) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v).slice(0, 23));
  for (const row of rows) {
    const gameId = Number(row.game_id);
    const region = row.region;
    const snap = (await q('select * from game_region_snapshot where game_id = $1 and region = $2', [gameId, region])).rows[0];
    if (!snap) continue;
    const price = (
      await q(
        `select min(o.price_cents) filter (where o.in_stock and p.kind in ${OFFICIAL_KINDS}) as price_cents,
                (array_agg(o.currency order by o.price_cents) filter (where o.in_stock and p.kind in ${OFFICIAL_KINDS}))[1] as currency,
                min(o.original_cents) filter (where o.in_stock and p.kind in ${OFFICIAL_KINDS}) as original_cents,
                max(o.discount_pct) filter (where o.in_stock and p.kind in ${OFFICIAL_KINDS}) as discount_pct,
                min(o.price_cents) filter (where o.in_stock and o.platform_code = 'steam') as steam_price_cents,
                (array_agg(o.platform_code order by o.price_cents) filter (where o.in_stock and p.kind in ${OFFICIAL_KINDS}))[1] as low_platform,
                (array_agg(p.name order by o.price_cents) filter (where o.in_stock and p.kind in ${OFFICIAL_KINDS}))[1] as low_platform_name,
                array_agg(distinct p.name) filter (where o.in_stock and p.kind in ${OFFICIAL_KINDS}) as platform_names,
                count(*) filter (where o.in_stock and p.kind in ${OFFICIAL_KINDS}) as offers_count,
                max(o.last_seen_at) as last_seen_at
           from offers o join platforms p on p.code = o.platform_code
          where o.game_id = $1 and o.region = $2`,
        [gameId, region],
      )
    ).rows[0];
    const hist = (
      await q(
        `select min(d.min_price_cents) filter (where p.kind in ${OFFICIAL_KINDS}) as hist_low_cents,
                min(d.min_price_cents) filter (where d.day < current_date and p.kind in ${OFFICIAL_KINDS}) as prev_hist_low_cents
           from daily_prices d join platforms p on p.code = d.platform_code
          where d.game_id = $1 and d.region = $2`,
        [gameId, region],
      )
    ).rows[0];
    const pairs = [
      ['price_cents', snap.price_cents, price.price_cents],
      ['currency', snap.currency, price.currency],
      ['original_cents', snap.original_cents, price.original_cents],
      ['discount_pct', snap.discount_pct, price.discount_pct],
      ['steam_price_cents', snap.steam_price_cents, price.steam_price_cents],
      ['low_platform', snap.low_platform, price.low_platform],
      ['low_platform_name', snap.low_platform_name, price.low_platform_name],
      ['platform_names', normArr(snap.platform_names), normArr(price.platform_names)],
      ['offers_count', Number(snap.offers_count ?? 0), Number(price.offers_count ?? 0)],
      ['last_seen_at', toIso(snap.last_seen_at), toIso(price.last_seen_at)],
      ['hist_low_cents', snap.hist_low_cents, hist.hist_low_cents],
      ['prev_hist_low_cents', snap.prev_hist_low_cents, hist.prev_hist_low_cents],
    ];
    const rowDiffs = [];
    for (const [field, a, b] of pairs) {
      if (String(a) !== String(b)) rowDiffs.push({ gameId, region, field, snapshot: a, actual: b });
    }
    if (rowDiffs.length) {
      diffs.push(...rowDiffs);
      if (fix) {
        // B5 批：修复走唯一写入路径的维护钩子（refresh*），不是自拼 SQL
        await refreshGameRegionPrices(q, gameId);
        await refreshGameRegionHist(q, gameId);
        fixed += 1;
      }
    }
  }
  return { checked: rows.length, diffs, fixed, suspect: suspect.length };
}

/** 全量重建：删除（可指定区服）后重跑一次性回填（docs/READ-MODEL.md §7 运维手段）。 */
export async function readModelRebuild(q, { region = null } = {}) {
  const del = region
    ? await snapshotWrite(q, 'clearRegion', [String(region)])
    : await snapshotWrite(q, 'clearAll');
  const deleted = del.rowCount ?? 0;
  await backfillGameRegionSnapshot(q);
  return { deleted };
}
