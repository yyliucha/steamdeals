// B4 #20 cli 运维类域专属 SQL（CO-5/B4-2 第十二轮拆分）。
// 按 ARCHITECTURE §15.5 第 4 步：拆分前这些 SQL 直接内联在 src/cli.js 的运维类命令体内，
// 本轮抽成本文件的 repository 新函数（拆分前没有同名函数，无旧消费者，不需要 pg.js re-export）。
// 禁改 src/store/pg.js：cli 命令对 pg.js 现有 db.* 函数的调用保持不动。

/**
 * 重写名字候选（cmdRename，AD 批 SEARCH-I18N.md 决策 1）：name 不含中文的都尝试补中文名
 * （upsertGameMeta 的覆盖保护仍在：人工维护的名字不会被冲掉，没有简中的不覆盖）。
 * 原样返回 query 结果（{ rows }），数值过滤留在命令体（与拆分前一致）。
 */
export async function listRenameCandidates(q, { size }) {
  return q(
    'select g.steam_appid from games g where g.steam_appid is not null and not g.deleted ' +
      // AD 批（SEARCH-I18N.md 决策 1）：放开候选——name 不含中文的都尝试补中文名
      // （upsertGameMeta 的覆盖保护仍在：人工维护的名字不会被冲掉，没有简中的不覆盖）。
      "and (g.name is null or g.name = '' or g.name !~ '[一-龥]') " +
      "and (g.backfill_at is null or g.backfill_at < now() - interval '1 day') " +
      'order by g.id limit $1',
    [size],
  );
}

/** 热度回填候选（cmdHeat）：heat_at 为空或过期 7 天且有报价的游戏。返回 { rows }。 */
export async function listHeatCandidates(q, { size }) {
  return q(
    'select g.id, g.steam_appid from games g where g.steam_appid is not null and not g.deleted ' +
      'and (g.heat_at is null or (g.heat_at < now() - interval \'7 days\' ' +
      'and exists (select 1 from offers o where o.game_id = g.id))) ' +
      'order by g.heat_at asc nulls first, g.id limit $1',
    [size],
  );
}

/** 封面图补图候选（cmdImages pull）：只补「有价格数据」的游戏（列表/详情才用得到图）。返回 { rows }。 */
export async function listImagePullCandidates(q, { limit }) {
  return q(
    'select g.steam_appid from games g where g.steam_appid is not null ' +
      'and exists (select 1 from daily_prices d where d.game_id = g.id) ' +
      'order by g.updated_at desc nulls last, g.id desc limit $1',
    [limit],
  );
}

/** 库表清单（cmdDiagnose）：公开 schema 全部表名（诊断检查项用）。返回 { rows }。 */
export async function listPublicTableNames(q) {
  return q(`select table_name from information_schema.tables where table_schema='public' order by table_name`);
}
