// CO-5/B4-2 第八轮（docs/DESIGN-AUDIT.md B4）：admin-access 域 repository——后台
// 访问安全（views/visitors/blacklist/whitelist/abuse/devices/reviews，B4 队列 #8）的
// 专属 SQL。15 个函数从 src/store/pg.js 巨石搬来（函数签名与拆分前完全一致），
// 其余是本域路由体里内联 SQL 抽出的新函数。
//
// 归属判定（判据：只有本域路由用 → 抽走；跨域/其它域也用 → 留 pg.js）：
//   · viewStats / visitorOrderClause / listVisitorLogs / visitorSummary / listVisitorsByIp /
//     visitorIpDetail / listWhitelist / removeWhitelistIp / listAbuse / listDevices /
//     listDeviceBans / listAbuseReviews / getAbuseReview / countPendingReviews / lastUaByIp
//     只被本域路由（/api/admin/views|visitors|whitelist|abuse|devices|reviews）使用 → 搬家；
//   · listBlockedIps / addBlockedIp / removeBlockedIp 留 pg.js——visitors.js 拦截链
//     （refreshBlocklist）、banIpExclusiveSql（#11 批量操作共用）、routes/appeal.js 都用；
//   · addWhitelistIp 留 pg.js——banIpExclusiveSql（#11 批量操作共用）；
//   · clearAbuseBan / recordPathStrike / setBanUntil 留 pg.js——ratelimit.js 限流中间件用；
//   · insertDeviceLog / activeDeviceBans / upsertDeviceBan / removeDeviceBan /
//     fingerprintOfDeviceId 留 pg.js——devices.js 设备拦截中间件、routes/appeal.js、
//     server.js #11 批量封设备段都用；
//   · recordAbuseReview / markReviewsAutoBanned / finishAbuseReview 留 pg.js——server.js
//     拦截链（路径/超频记录）与 #11 批量审核段都用；
//   · appealStatusByIp（reviews 证据抽屉用）已随申诉域拆到 appeal-repository.js
//     （跨域共用，pg.js re-export，不搬）；
//   · page_views / visitor_logs / ip_blacklist / ip_whitelist / ip_abuse / device_logs /
//     device_bans / abuse_reviews 表 DDL 留 pg.js——中间件/拦截链/批量操作跨域共用表
//     （announcements 先例：无 DDL 搬家）。
//
// 拆分约定（见 docs/ARCHITECTURE.md「域路由拆分模式」）：
//   · 域 SQL 落 src/store/<domain>-repository.js；
//   · pg.js 以 `export { … } from './admin-access-repository.js'` re-export——
//     routes/admin-access.js、server.js 其它段与现有测试一律照旧走 pg.js 聚合壳
//     （db.* 签名不变）。

// ---------------------------------------------------------------- 页面浏览统计（/api/admin/views）

export async function viewStats(q, { limit = 20 } = {}) {
  const r = await q(
    `select path, count(*)::int as views, max(created_at) as last_at
       from page_views group by path order by views desc limit $1`,
    [limit],
  );
  return r.rows;
}

/**
 * /api/admin/views 的路径解析增强：把 /game/<appid> 与 /game/id/<id> 解析成
 * 游戏名与当前最低价（域内联 SQL 抽函数——拆分前直接写在 server.js 路由体里）。
 * 返回行：{ id, steam_appid, name, low }；name 用中文名 → 英文名 → 'appid:<n>' 兜底。
 */
export async function adminViewsGameMap(q, { appids = [], ids = [] }) {
  if (!appids.length && !ids.length) return [];
  const r = await q(
    "select g.id, g.steam_appid, coalesce(nullif(g.name, ''), nullif(g.name_en, ''), 'appid:' || g.steam_appid) as name, " +
    "(select min(o.price_cents) from offers o where o.game_id = g.id and o.in_stock) as low " +
    "from games g where g.steam_appid = any($1::int[]) or g.id = any($2::int[])",
    [appids, ids],
  );
  return r.rows;
}

// ---------------------------------------------------------------- 访问记录（/api/admin/visitors*）

/**
 * 访问明细排序子句（AQ 批 docs/ADMIN-REVIEW-LISTS.md §3.2）。
 * 白名单：sort ∈ time|ip|status，order ∈ asc|desc；非法值回落默认，**不拼接用户输入**。
 * IP 用零填充字符串键排序：等价于数值序，又不会像 ip::inet 那样被脏数据（空串/非 IP）炸掉整条查询。
 */
export function visitorOrderClause(sort = 'time', order = 'desc') {
  const dir = order === 'asc' ? 'asc' : 'desc';
  if (sort === 'ip') {
    const key =
      "case when ip ~ '^[0-9]{1,3}(\\.[0-9]{1,3}){3}$' then " +
      "lpad(split_part(ip,'.',1),3,'0')||'.'||lpad(split_part(ip,'.',2),3,'0')||'.'||" +
      "lpad(split_part(ip,'.',3),3,'0')||'.'||lpad(split_part(ip,'.',4),3,'0') else 'zzz'||ip end";
    return `${key} ${dir} nulls last, id desc`;
  }
  if (sort === 'status') return `blocked ${dir}, id desc`;
  return `id ${dir}`;
}

/**
 * FZ 批（docs/VISITORS-REDESIGN.md §4、§7-5）：访问明细视图的状态口径——与 by-ip 的 IP 状态
 * 派生**同一套**（已封禁 > 已信任 > 临时封 > 被拦截 > 正常），保证「IP 统计」与「明细」两视图对得上。
 *
 * status（新口径，路由显式传入）优先：active / normal / intercepted / banned / blocked / trusted / all；
 * filter（旧口径，仅兼容老书签/老调用方）只在 status 缺省时生效：visits（未拦截）/ blocked（已拦截）/ all。
 * 「有效访问 active」= 该 IP 不在黑名单、也不在白名单（已封禁 / 已信任都移出默认视图；
 * 「临时封」未到期的 IP 仍留在默认视图，见规格 §1 决策 6）。
 */
const VISITOR_IP_FILTERS = {
  notBlockedIp: 'not exists (select 1 from ip_blacklist b where b.ip = visitor_logs.ip)',
  notTrustedIp: 'not exists (select 1 from ip_whitelist w where w.ip = visitor_logs.ip)',
  activeBan: 'exists (select 1 from ip_abuse a where a.ip = visitor_logs.ip and a.banned_until > now())',
};

/** 明细视图状态条件（全静态常量拼接，不拼用户输入）。 */
export function visitorLogStatusCond(status, filter = 'visits') {
  const { notBlockedIp, notTrustedIp, activeBan } = VISITOR_IP_FILTERS;
  const mode = status || (filter === 'blocked' ? 'rowblocked' : filter === 'all' ? 'all' : 'visits');
  switch (mode) {
    case 'active':
      return `${notBlockedIp} and ${notTrustedIp}`;
    case 'blocked':
      return 'exists (select 1 from ip_blacklist b where b.ip = visitor_logs.ip)';
    case 'trusted':
      return 'exists (select 1 from ip_whitelist w where w.ip = visitor_logs.ip)';
    case 'banned':
      return `${notBlockedIp} and ${notTrustedIp} and ${activeBan}`;
    case 'intercepted':
      return `blocked and ${notBlockedIp} and ${notTrustedIp} and not ${activeBan}`;
    case 'normal':
      // 与 by-ip 的「正常」同口径：该 IP 在整个访问历史里没有任何被拦截行（不只当前行未拦截），
      // 否则同一个 IP 会同时出现在「被拦截」与「正常」两个筛选里，两视图对不上。
      return `not blocked and ${notBlockedIp} and ${notTrustedIp} and not ${activeBan} and not exists (select 1 from visitor_logs bl where bl.ip = visitor_logs.ip and bl.blocked)`;
    case 'visits':
      return 'not blocked';
    case 'rowblocked':
      return 'blocked';
    default:
      return '';
  }
}

export async function listVisitorLogs(q, { page = 1, pageSize = 50, ip = null, path = null, filter = 'visits', status = null, sort = 'time', order = 'desc', days = null } = {}) {
  const statusCond = visitorLogStatusCond(status, filter);
  const blockedCond = statusCond ? `and (${statusCond})` : '';
  // BH 批（docs/VISIT-IP-STATS.md §3.1）：时间窗与 IP 统计视图共用；days 由服务端白名单校验后传入
  const where = `where ($1 = '' or ip = $1 or remote_ip = $1) and ($2 = '' or path like '%' || $2 || '%') ${blockedCond} and ($5::int is null or created_at >= now() - ($5::int * interval '1 day'))`;
  // 计数查询只传 3 个参数：未被引用的 $3/$4 会让 PG 无法推断参数类型（42P18），所以把时间窗占位符换成 $3
  const whereCount = where.replaceAll('$5', '$3');
  const cnt = await q(`select count(*)::int as n from visitor_logs ${whereCount}`, [ip ?? '', path ?? '', days]);
  const rows = await q(
    `select id, ip, remote_ip, region, path, method, user_agent, status, blocked, block_reason, created_at
       from visitor_logs ${where}
      order by ${visitorOrderClause(sort, order)} limit $3 offset $4`,
    [ip ?? '', path ?? '', pageSize, (page - 1) * pageSize, days],
  );
  return { total: cnt.rows[0]?.n ?? 0, rows: rows.rows };
}

/** 今日访问量 / 独立 IP / 黑名单数 / 被拦截请求数 + 近 24h 高频 IP（只统计正常访问）。 */
export async function visitorSummary(q) {
  const today = await q(
    `select (select count(*)::int from visitor_logs where not blocked and created_at >= date_trunc('day', now())) as today_visits,
            (select count(distinct ip)::int from visitor_logs where not blocked and created_at >= date_trunc('day', now())) as today_ips,
            (select count(*)::int from visitor_logs where blocked and created_at >= date_trunc('day', now())) as today_blocked,
            (select count(*)::int from ip_blacklist) as blocked_count`,
  );
  const top = await q(
    `select ip, max(region) as region, count(*)::int as n, max(created_at) as last_at
       from visitor_logs
      where not blocked and created_at >= now() - interval '1 day'
      group by ip order by n desc limit 10`,
  );
  return { ...today.rows[0], topIps: top.rows };
}

/** IP 统计视图（BH 批 docs/VISIT-IP-STATS.md §3.1）：时间窗内每 IP 一行，默认按访问次数倒序。 */
export async function listVisitorsByIp(q, { days = 7, page = 1, pageSize = 20, q: kw = '', sort = 'visits', status = 'all' } = {}) {
  const windowSql = `created_at >= now() - ($1::int * interval '1 day')`;
  const kwSql = `($2 = '' or ip ilike '%' || $2 || '%')`;
  // BI 批（docs/VISIT-IP-STATS.md §8）：状态四态 + 状态筛选；手动黑名单优先于自动临时封禁。
  // FZ 批（docs/VISITORS-REDESIGN.md §4）：新增 trusted（白名单派生）与 active（有效访问 = 不在黑/白名单）；
  // 派生顺序固定为 已封禁 > 已信任 > 临时封 > 被拦截 > 正常（与明细视图 visitorLogStatusCond 同口径）。
  // 条件里始终引用 $3（即使 active 分支只用常量），避免未引用参数导致 PG 无法推断类型（42P18）。
  const statusSql = "($3 = 'all' or ($3 = 'active' and status not in ('blocked','trusted')) or status = $3)";
  const base = `
     select ip,
            count(*)::int as visits,
            min(created_at) as first_at,
            max(created_at) as last_at,
            count(distinct path)::int as paths,
            coalesce((select count(distinct coalesce(nullif(d.device_id, ''), d.fingerprint))::int
                        from device_logs d
                       where d.ip = visitor_logs.ip and d.created_at >= now() - ($1::int * interval '1 day')), 0) as devices,
            (select l.region from visitor_logs l
              where l.ip = visitor_logs.ip and l.region is not null
              order by l.created_at desc limit 1) as region,
            (select a.banned_until from ip_abuse a
              where a.ip = visitor_logs.ip and a.banned_until > now()
              order by a.banned_until desc limit 1) as ban_until,
            (select a.ban_source from ip_abuse a
              where a.ip = visitor_logs.ip and a.banned_until > now()
              limit 1) as ban_source,
            case when exists (select 1 from ip_blacklist b where b.ip = visitor_logs.ip) then 'blocked'
                 when exists (select 1 from ip_whitelist w where w.ip = visitor_logs.ip) then 'trusted'
                 when exists (select 1 from ip_abuse a where a.ip = visitor_logs.ip and a.banned_until > now()) then 'banned'
                 when bool_or(blocked) then 'intercepted'
                 else 'normal' end as status
       from visitor_logs
      where ${windowSql} and ${kwSql}
      group by ip`;
  const count = await q(`with agg as (${base}) select count(*)::int as n from agg where ${statusSql}`, [days, kw, status]);
  // 排序白名单：visits（默认）/ lastAt / ip；IP 用补零字符串做 IPv4 数值序（IPv6 退化为字典序）
  const orderSql =
    sort === 'lastAt'
      ? 'order by last_at desc, visits desc'
      : sort === 'ip'
        ? `order by case when ip ~ '^[0-9]{1,3}(\\.[0-9]{1,3}){3}$'
                       then lpad(split_part(ip,'.',1),3,'0')||lpad(split_part(ip,'.',2),3,'0')||lpad(split_part(ip,'.',3),3,'0')||lpad(split_part(ip,'.',4),3,'0')
                       else 'zzz:' || ip end`
        : 'order by visits desc, last_at desc';
  const rows = await q(
    `with agg as (${base}) select * from agg where ${statusSql} ${orderSql} limit $4 offset $5`,
    [days, kw, status, pageSize, (page - 1) * pageSize],
  );
  return { total: count.rows[0]?.n ?? 0, rows: rows.rows };
}

/**
 * FZ 批（docs/VISITORS-REDESIGN.md §2、§4）：访问记录「概览」6 张数字卡——一次查询返回全部 6 个数：
 *   今日请求 today_requests（含被拦截的请求，被拦截是其子集）
 *   被拦截 today_blocked（今日 blocked=true 的请求数）
 *   待审 pending_reviews（待审队列**行数** = 按 IP 合并后的行数，与 /api/admin/reviews 的队列行一致；
 *       与「待审规则条数」是两个数——处置一个 IP 让本数减 1，规格 §7-6 的「计数同步」口径）
 *   临时封 temp_bans（ip_abuse 中 banned_until 未到期的 IP 数）
 *   黑名单 blacklist / 白名单 whitelist（条目数，含 CIDR 条目）
 */
export async function visitorOverview(q) {
  const r = await q(
    `select (select count(*)::int from visitor_logs
              where created_at >= date_trunc('day', now())) as today_requests,
            (select count(*)::int from visitor_logs
              where blocked and created_at >= date_trunc('day', now())) as today_blocked,
            (select count(distinct coalesce(ip, ''))::int from abuse_reviews
              where status = 'pending') as pending_reviews,
            (select count(*)::int from ip_abuse
              where banned_until is not null and banned_until > now()) as temp_bans,
            (select count(*)::int from ip_blacklist) as blacklist,
            (select count(*)::int from ip_whitelist) as whitelist`,
  );
  return r.rows[0];
}

/** 展开行：该 IP 时间窗内最近 20 条访问 + 访问最多的路径 top 5（BH 批 §3.1）。 */
export async function visitorIpDetail(q, { ip, days = 7 } = {}) {
  const recent = await q(
    `select id, path, method, status, blocked, created_at
       from visitor_logs
      where ip = $1 and created_at >= now() - ($2::int * interval '1 day')
      order by created_at desc limit 20`,
    [ip, days],
  );
  const top = await q(
    `select path, count(*)::int as n
       from visitor_logs
      where ip = $1 and created_at >= now() - ($2::int * interval '1 day')
      group by path order by n desc, path limit 5`,
    [ip, days],
  );
  return { recent: recent.rows, topPaths: top.rows };
}

// ---------------------------------------------------------------- IP 白名单 / 超频记录（/api/admin/whitelist|abuse）

/** 白名单（BH 批）：每行追加近 7 天访问次数 / 最近访问 / 设备数。 */
export async function listWhitelist(q) {
  const r = await q(
    `select w.ip, w.note, w.created_at,
            coalesce(v.visits, 0)::int as visits, v.last_at, coalesce(d.devices, 0)::int as devices
       from ip_whitelist w
       left join lateral (
         select count(*)::int as visits, max(created_at) as last_at
           from visitor_logs
          where ip = w.ip and created_at >= now() - interval '7 days'
       ) v on true
       left join lateral (
         select count(distinct coalesce(nullif(device_id, ''), fingerprint))::int as devices
           from device_logs
          where ip = w.ip and created_at >= now() - interval '7 days'
       ) d on true
      order by w.created_at desc`,
  );
  return r.rows;
}

export async function removeWhitelistIp(q, ip) {
  const r = await q('delete from ip_whitelist where ip = $1', [ip]);
  return r.rowCount ?? 0;
}

/**
 * 超频/路径封禁记录（BJ 批 B1，docs/BAN-AND-SECURITY-FIXES.md §10.4.2）：
 * status = active（默认，仅生效中）/ expired（过期或无封禁时间）/ all（全部）；
 * 每行带 active（banned_until > now()）与 blacklist_note（精确等值子查询，CIDR 覆盖由服务端运行时补）。
 */
export async function listAbuse(q, { limit = 50, status = 'active' } = {}) {
  const mode = ['active', 'expired', 'all'].includes(String(status)) ? String(status) : 'active';
  const where =
    mode === 'active'
      ? 'where a.banned_until is not null and a.banned_until > now()'
      : mode === 'expired'
        ? 'where a.banned_until is null or a.banned_until <= now()'
        : '';
  const order = mode === 'active' ? 'order by a.banned_until asc' : 'order by a.banned_until desc nulls last, a.updated_at desc';
  const r = await q(
    `select a.ip, a.strikes, a.path_strikes, a.ban_source, a.banned_until, a.updated_at,
            coalesce(a.banned_until > now(), false) as active,
            (select note from ip_blacklist b where b.ip = a.ip) as blacklist_note
       from ip_abuse a
       ${where}
       ${order}
       limit $1`,
    [Math.min(Math.max(Number(limit) || 50, 1), 200)],
  );
  return r.rows;
}

/**
 * 某 IP 的 ip_abuse 行（BJ 批 C1：只清 ip_abuse，绝不动 ip_blacklist；解封前取
 * banned_until 判 wasActive）。不存在返回 null。
 */
export async function ipAbuseBanRow(q, ip) {
  const r = await q('select banned_until from ip_abuse where ip = $1', [ip]);
  return r.rows[0] ?? null;
}

// ---------------------------------------------------------------- 设备指纹（/api/admin/devices*）

/**
 * 最近设备（BH 批）：按设备码 `device_id` 聚合（无设备码的老记录按 fingerprint 归组），
 * 返回 { key, deviceId, fingerprint, fingerprints, ips, userAgent, lastAt, count, banned }。
 * 封禁仍按指纹（banned = 组内任一指纹在 device_bans）。
 */
export async function listDevices(q, { limit = 50 } = {}) {
  const r = await q(
    `select coalesce(nullif(device_id, ''), fingerprint) as key,
            max(nullif(device_id, '')) as device_id,
            (array_agg(fingerprint order by created_at desc))[1] as fingerprint,
            array_agg(distinct fingerprint) as fingerprints,
            array_agg(distinct ip) filter (where ip is not null) as ips,
            max(user_agent) as user_agent,
            max(created_at) as last_at,
            count(*)::int as count,
            bool_or(exists (select 1 from device_bans b where b.fingerprint = device_logs.fingerprint)) as banned
       from device_logs
      group by 1
      order by last_at desc
      limit $1`,
    [Math.min(Math.max(Number(limit) || 50, 1), 200)],
  );
  return r.rows.map((row) => ({
    key: row.key,
    deviceId: row.device_id ?? null,
    fingerprint: row.fingerprint,
    fingerprints: (row.fingerprints ?? []).filter(Boolean),
    ips: (row.ips ?? []).filter(Boolean),
    userAgent: row.user_agent ?? null,
    lastAt: row.last_at,
    count: row.count,
    banned: Boolean(row.banned),
  }));
}

export async function listDeviceBans(q, { limit = 100 } = {}) {
  const r = await q(
    `select fingerprint, device_id, note, until, created_at from device_bans
      order by created_at desc limit $1`,
    [Math.min(Math.max(Number(limit) || 100, 1), 500)],
  );
  return r.rows;
}

// ---------------------------------------------------------------- 异常请求审核（/api/admin/reviews*）

// 待审口径（docs/BAN-AND-SECURITY-FIXES.md §5）：待审 = 所有 pending。
// v1.9.0 起封禁动作已把该 IP 的旧 pending 标成 auto_banned 永久退出待审，所以这里
// **不再**按"IP 是否处于临时封禁"二次过滤——封禁期间新产生的 pending 恰恰是最该看的，
// 而且状态列本来就写着「待审」。列表与 countPendingReviews 必须同一口径。
export async function listAbuseReviews(q, { status = 'pending', limit = 500 } = {}) {
  // pending：只看待审；all：审计视图（含 auto_banned）。
  const statusCond = status === 'all' ? '' : "and status = 'pending'";
  const r = await q(
    `select id, ip, device_id, fingerprint, rule, detail, path, hits, status, note, reviewed_at, created_at, last_seen
       from abuse_reviews
      where true
        ${statusCond}
      order by last_seen desc
      limit $1`,
    [Math.min(Math.max(Number(limit) || 500, 1), 500)],
  );
  return r.rows;
}

export async function getAbuseReview(q, id) {
  const r = await q('select * from abuse_reviews where id = $1', [id]);
  return r.rows[0] ?? null;
}

export async function countPendingReviews(q) {
  const r = await q(`select count(*)::int as n from abuse_reviews where status = 'pending'`);
  return Number(r.rows[0]?.n ?? 0);
}

/** CF 批：该 IP 最近一次访问的 User-Agent（证据抽屉用，已有数据不新增抓取）。 */
export async function lastUaByIp(q, ip) {
  if (!ip) return null;
  const r = await q('select user_agent from visitor_logs where ip = $1 and user_agent is not null order by created_at desc limit 1', [String(ip)]);
  return r.rows[0]?.user_agent ?? null;
}

/**
 * CF 批单条审核 tempban 动作：写/更新临时封禁行（来源 manual:temp），
 * 内存态由路由层调 ratelimit.applyExternalBan 同步。
 */
export async function applyManualTempBan(q, { ip, until }) {
  await q(
    `insert into ip_abuse (ip, strikes, strike_day, banned_until, ban_source, updated_at)
     values ($1, 1, current_date, $2::timestamptz, 'manual:temp', now())
     on conflict (ip) do update set banned_until = excluded.banned_until, ban_source = excluded.ban_source, updated_at = now()`,
    [ip, new Date(until).toISOString()],
  );
}

/**
 * CF 批单条审核 trust 动作的落库部分：加白移黑 + 清临时封禁（与 BJ/BR 批互斥口径一致），
 * 内存态同步（ratelimit/autoBan/refreshBlocklist）由路由层负责。
 */
export async function trustIpDb(q, { ip, note }) {
  await q('insert into ip_whitelist (ip, note) values ($1, $2) on conflict (ip) do update set note = excluded.note', [ip, note]);
  await q('delete from ip_blacklist where ip = $1', [ip]);
  await q('update ip_abuse set banned_until = null where ip = $1', [ip]);
}
