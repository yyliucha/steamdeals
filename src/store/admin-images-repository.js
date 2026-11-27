// CO-5/B4-2 第十六轮（docs/DESIGN-AUDIT.md B4）：admin-images 域（B4 队列 #13：后台图片
// /api/admin/images）专属 SQL——从 src/store/pg.js 巨石抽出的第十六个域 repository。
//
// 归属判定（§15.1「域专属 SQL 进 repository，通用 SQL 留 pg.js」）：
//   · 搬入本文件：imageCoverageRows——只被本域路由使用（EC 批 GET /api/admin/images/coverage
//     看板数据行，取 steam_appid/header_image 两列），签名与拆分前完全一致；
//   · 抽新函数：imageCoverageMissingRows——EC 批看板的缺图分页列表 SQL（拆分前直接内联在
//     server.js 路由体内，本轮抽成 repository 新函数）；
//   · 留在 pg.js：图片相关跨模块共用函数——
//     fillHeaderImage（src/image-backfill.js 回填与 steam-status.js 顺带补齐共用）、
//     missingHeaderImageAppids（src/image-backfill.js 回填候选共用）、
//     backfillCandidateWhere（CLI 与统计共用的候选谓词，image-coverage.test.js 有静态锁）——
//     一律不搬；
//   · games 表 DDL 在 pg.js（migrate() 消费），本文件不搬 DDL。
//
// pg.js 顶部 import + re-export 本文件，旧 db.* 导入签名永远不变。

/**
 * EC 批（docs/IMAGE-COVERAGE.md §8 EC-1）：图片覆盖看板数据行——只取 steam_appid/header_image 两列
 * （缺图原因判定与本地缓存比对在路由层做，避免 SQL 与文件系统耦合）。
 *
 * ⚠️ GB 批（docs/IMAGE-PAGE-CONSOLE-FIX.md §1/§2.1）：本函数是**全表查询**——线上约 19.6 万行全部拉到
 * Node 内存再 filter，超过 requestTimeoutMs=15000 → 503，看板数字全空。看板统计已改用
 * imageCoverageTotals（count 聚合）+ imageCoverageHeaderByAppids（只查负缓存 appid），**不要再调用本函数做全量统计**；
 * 签名保留只为兼容旧导入与静态锁（其它入口仍可读单个字段，勿删）。
 */
export async function imageCoverageRows(q) {
  const r = await q('select g.steam_appid, g.header_image from games g where g.steam_appid is not null and not g.deleted');
  return r.rows.map((row) => ({ steamAppid: Number(row.steam_appid), headerImage: row.header_image ?? null }));
}

/**
 * GB 批（docs/IMAGE-PAGE-CONSOLE-FIX.md §2.1）：覆盖看板的总数口径——一条 count 聚合，不再拉行。
 * 口径：只计 steam_appid 非空且未删除的游戏；count(header_image) 只计非 null（= 看板「有 header_image」）；
 * noHeader 由调用方 total - withHeader 得出。
 */
export async function imageCoverageTotals(q) {
  const r = await q(
    'select count(*)::int as total, count(header_image)::int as with_header from games where steam_appid is not null and not deleted',
  );
  const row = r.rows[0] ?? {};
  return { total: Number(row.total ?? 0), withHeader: Number(row.with_header ?? 0) };
}

/**
 * GB 批（docs/IMAGE-PAGE-CONSOLE-FIX.md §2.1）：只查「负缓存里那几个 appid」是否在库、有无 header_image——
 * 负缓存是进程内 Map、量小，any($1::int[]) 走 steam_appid 唯一索引，不再全表扫描。
 * 与 imageCoverageRows 同口径：已删除的游戏不算在库（否则负缓存里已删的游戏会虚增缺图数）。
 */
export async function imageCoverageHeaderByAppids(q, appids = []) {
  if (!appids.length) return [];
  const r = await q('select steam_appid, header_image from games where steam_appid = any($1::int[]) and not deleted', [appids]);
  return r.rows.map((row) => ({ steamAppid: Number(row.steam_appid), headerImage: row.header_image ?? null }));
}

/**
 * EC 批（docs/IMAGE-COVERAGE.md §8 EC-1）：覆盖看板的缺图分页列表——
 * header_image 为空的游戏 ∪ 负缓存命中的 appid（missAppids 可能为空数组，any($1) 恒 false）；
 * header_image 空的排前面，按 updated_at 倒序。
 */
export async function imageCoverageMissingRows(q, { missAppids = [], pageSize = 50, offset = 0 } = {}) {
  const r = await q(
    'select g.id, g.steam_appid, coalesce(nullif(g.name, \'\'), nullif(g.name_en, \'\'), \'appid:\' || g.steam_appid) as name, g.header_image, g.updated_at ' +
      'from games g where g.steam_appid is not null and not g.deleted ' +
      'and (g.header_image is null or g.steam_appid::text = any($1::text[])) ' +
      'order by (g.header_image is null) desc, g.updated_at desc nulls last, g.id desc limit $2 offset $3',
    [missAppids, pageSize, offset],
  );
  return r.rows;
}
