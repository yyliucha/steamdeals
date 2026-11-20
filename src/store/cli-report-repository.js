// B4 #19 cli 报表类域专属 SQL（CO-5/B4-2 第十一轮拆分）。
// 按 ARCHITECTURE §15.5 第 4 步：拆分前这些 SQL 直接内联在 src/cli.js 的报表类命令体内，
// 本轮抽成本文件的 repository 新函数（拆分前没有同名函数，无旧消费者，不需要 pg.js re-export）。
// 禁改 src/store/pg.js：cli 命令对 pg.js 现有 db.* 函数的调用保持不动。

/** 多区服对比的取数行（cmdCompare）：按 appid 取游戏行（含 name_en / steam_appid）。 */
export async function compareGameBySteamAppid(q, { appid }) {
  const r = await q('select id, name, name_en, steam_appid from games where steam_appid = $1', [appid]);
  return r.rows[0] ?? null;
}
