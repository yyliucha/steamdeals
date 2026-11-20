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
 */
export async function imageCoverageRows(q) {
  const r = await q('select g.steam_appid, g.header_image from games g where g.steam_appid is not null and not g.deleted');
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
