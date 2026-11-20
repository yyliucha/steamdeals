// B4 #18 cli 同步类域专属 SQL（CO-5/B4-2 第十轮拆分）。
// 按 ARCHITECTURE §15.5 第 4 步：拆分前这些 SQL 直接内联在 src/cli.js 的同步类命令体内，
// 本轮抽成本文件的 repository 新函数（拆分前没有同名函数，无旧消费者，不需要 pg.js re-export）。
// 禁改 src/store/pg.js：cli 命令对 pg.js 现有 db.* 函数的调用保持不动（§15.1 例外说明见 QA 报告边界判定）。

/** 同步候选：全部带 appid 的游戏（cmdSyncSteam，按 id 序取前 limit 个）。 */
export async function listSyncSteamAppids(q, { limit }) {
  const r = await q('select steam_appid from games where steam_appid is not null order by id limit $1', [limit]);
  return r.rows.map((x) => x.steam_appid);
}

/**
 * 每日刷新候选（cmdSyncSteamPrices，F 批：热点优先 + 冷门降频）。
 * 热点 = 近 90 天有访问 / 有用户标记 / 热度达标；冷门 = 最近价格快照超过 N 天未更新。
 * 返回数值 appid 数组（与拆分前内联查询的过滤行为一致）。
 */
export async function listSteamPriceRefreshAppids(q, { limit, hotHeatMin, coldDays }) {
  const r = await q(
    `select steam_appid from (
       select g.steam_appid,
              (exists (select 1 from page_views v where v.appid = g.steam_appid and v.created_at > now() - interval '90 days')
                or exists (select 1 from user_game_flags f where f.game_id = g.id)
                or coalesce(g.heat, 0) >= $2) as is_hot,
              coalesce((select max(ps.captured_at) from price_snapshots ps
                         join offers po on po.id = ps.offer_id and po.platform_code = 'steam'
                        where po.game_id = g.id), '1970-01-01'::timestamptz) as last_snap
         from games g
         join offers o on o.game_id = g.id and o.platform_code = 'steam'
        where g.steam_appid is not null and not g.deleted and not g.blocked
        group by g.id, g.steam_appid, g.heat
     ) t
     where t.is_hot or t.last_snap < now() - make_interval(days => $3)
     order by t.is_hot desc, t.last_snap asc, t.steam_appid
     limit $1`,
    [limit, hotHeatMin, coldDays],
  );
  return r.rows.map((x) => Number(x.steam_appid)).filter((n) => Number.isFinite(n) && n > 0);
}

/**
 * sync steamall 候选行（只挑"还没有 Steam 价格或说明"的游戏，新游戏优先）。
 * 原样返回行数组，数值过滤留在命令体（与拆分前一致）。
 */
export async function listSteamAllCandidates(q, { limit }) {
  const r = await q(
    'select g.steam_appid from games g where g.steam_appid is not null ' +
      'and not g.deleted ' +
      "and (g.backfill_at is null or g.backfill_at < now() - interval '1 day') " +
      "and (g.description is null or g.description = '' or not exists (select 1 from offers o where o.game_id = g.id and o.platform_code = 'steam')) " +
      // AC-3/AC9：新游戏优先（按收录时间倒序）
      'order by g.created_at desc nulls last, g.id desc limit $1',
    [limit],
  );
  return r.rows;
}

/** 有 appid 的游戏基础行（runSonkwoMatchStep 的匹配底表）。 */
export async function allSteamGamesBasic(q) {
  return (await q('select id, steam_appid, name, name_en from games where steam_appid is not null')).rows;
}

/** 按 appid 取游戏行（applySkuMapping / cmdSyncSonkwo 状态回写共用）。 */
export async function gameBySteamAppid(q, { appid }) {
  const r = await q('select id, name from games where steam_appid = $1', [appid]);
  return r.rows[0] ?? null;
}

/** 游戏是否存在（cmdSyncItad 的 ITAD deal 反解 appid 存在性检查）。 */
export async function gameExistsByAppid(q, { appid }) {
  const r = await q('select 1 from games where steam_appid = $1', [appid]);
  return r.rows.length > 0;
}

/** Steam 账号的加密 API Key（cmdSteamAccounts 逐账号取 key）。 */
export async function steamAccountApiKeyEnc(q, { steamId }) {
  const r = await q('select api_key_enc from steam_accounts where steam_id = $1', [steamId]);
  return r.rows[0]?.api_key_enc ?? null;
}

/** 杉果 SKU 的别名映射 game_id（applySkuMapping 合并孤立行前检查）。 */
export async function sonkwoAliasGameId(q, { skuId }) {
  const r = await q(
    'select game_id from game_aliases where platform_code = $1 and platform_product_id = $2',
    ['sonkwo', String(skuId)],
  );
  return r.rows[0]?.game_id ?? null;
}

/** 按游戏 id 取行（applySkuMapping 合并前检查；返回行对象以区分「行不存在」与「steam_appid 为空」）。 */
export async function gameAppidRowById(q, { id }) {
  const r = await q('select steam_appid from games where id = $1', [id]);
  return r.rows[0] ?? null;
}
