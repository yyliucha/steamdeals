// CO-5/B4-2 第十四轮（docs/DESIGN-AUDIT.md B4）：admin-align 域（B4 队列 #17：后台对齐审核
// /api/admin/align*）专属 SQL——从 src/server.js 巨石（域内联 SQL）与 src/store/pg.js 巨石
// （align_snapshots 表 DDL）抽出的第十四个域 repository。
//
// 归属判定（§15.1「域专属 SQL 进 repository，通用 SQL 留 pg.js」）：
//   · 搬入本文件：ALIGN_SNAPSHOTS_DDL——align_snapshots 表只有本域读写
//     （对齐审核快照，§5 队列真相；CLI align-snapshot 走 align-snapshot.js 共享函数，
//     建表仍在 pg.js migrate() 消费本常量，不重复落两处）；
//   · 搬入本文件（域内联 SQL 抽新函数）：5 个——确认流程的别名/目标守卫查询、
//     合并预览的孤儿行查询、目标游戏查询、搜索候选查询（此前直接写在 server.js 路由体里）；
//   · 留在 pg.js / 其它模块：game_source_map / game_aliases 等跨域共用表 DDL；
//     mergeGames 等通用函数；align-snapshot.js 的快照读写函数被 CLI align-snapshot
//     调度任务共用，保持独立模块不动（本域经 import 引用，见 routes/admin-align.js）；
//   · 路由体内的其余行为（confirmGroup/ignoreGroup/restoreIgnoredGroup/loadIgnoredGroups/
//     loadGroupHistory/skuIdsForGroupKey 等）在 src/align.js（纯业务模块，非 SQL 层），不搬。
//
// pg.js 顶部 import + re-export 本文件，旧 db.* 导入签名永远不变。

// DL 批（docs/ALIGN-SNAPSHOT.md §3）：对齐审核快照落库——payload=当前队列全量组、
// counts=统计卡口径、signature=数据签名（§4）、error=最近一次生成失败原因（成功为 null）；
// dirty/last_action_at=确认/忽略同事务更新标记（§5）；保留最近 5 条由 prune 扩展删除。
export const ALIGN_SNAPSHOTS_DDL = `
create table if not exists align_snapshots (
  id             bigserial primary key,
  payload        jsonb not null,
  counts         jsonb not null,
  signature      text  not null,
  generated_at   timestamptz not null default now(),
  generated_ms   int,
  dirty          boolean not null default false,
  last_action_at timestamptz,
  error          text
);
create index if not exists idx_align_snapshots_gen on align_snapshots (generated_at desc);
`;

/** 确认流程：SKU 别名 → game_id（无别名返回 null）。 */
export async function gameAliasGameId(q, platformCode, productId) {
  const r = await q('select game_id from game_aliases where platform_code = $1 and platform_product_id = $2', [platformCode, productId]);
  return r.rows[0] ?? null;
}

/** 确认流程合并孤立行守卫：源游戏行的 steam_appid（无行返回 null）。 */
export async function gameSteamAppidById(q, gameId) {
  const r = await q('select steam_appid from games where id = $1', [gameId]);
  return r.rows[0] ?? null;
}

/** 合并预览：该组同归一化名的孤立游戏行（报价/快照数 + 不可撤销提示）。 */
export async function listOrphanGameRows(q, name) {
  const r = await q(
    `select g.id, g.name, (select count(*)::int from offers o where o.game_id = g.id) as offers,
            (select count(*)::int from price_snapshots s join offers o2 on o2.id = s.offer_id where o2.game_id = g.id) as snapshots
       from games g
      where g.steam_appid is null and g.name = $1 and not g.deleted`,
    [name],
  );
  return r.rows;
}

/** 确认守卫/同事务目标查询：按 steam_appid 取游戏行（无行返回 null）。 */
export async function gameBySteamAppid(q, appid) {
  const r = await q('select id, steam_appid from games where steam_appid = $1 limit 1', [appid]);
  return r.rows[0] ?? null;
}

/** 手动搜索候选：name/name_en 模糊 + steam_appid 精确，最多 20 条。 */
export async function searchAlignGames(q, kw) {
  const like = `%${kw}%`;
  const r = await q(
    `select id, steam_appid, name, name_en from games
      where steam_appid is not null and not deleted
        and (name ilike $1 or name_en ilike $1 or steam_appid::text = $2)
      order by id limit 20`,
    [like, kw],
  );
  return r.rows;
}
