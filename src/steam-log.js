// Steam 账号操作审计（docs/ADMIN-CONSOLE-IA.md §5，AT 批）。
//
// 7 类动作落 steam_account_logs：bind | unbind | claim | sync-library | sync-wishlist | api-key | delete-cascade。
// 设计约束：
//   - user_id 故意不挂外键：用户被删后这条证据必须留下（验收 6）；
//   - 写入失败吞异常：审计失败不能影响绑定/同步主流程（规格 §5「失败不能影响主流程」）；
//   - error 截断 200 字符，detail 只放计数与状态码，不写 API Key / 密码 / 完整邮箱（规格 §10）。
// 表结构由 steam-login.js 的 ensureSteamSchema 幂等创建（与 steam 系表同处，老库自动补）。

/** 7 类动作白名单（写入与筛选共用，杜绝脏 action 进库）。 */
export const STEAM_LOG_ACTIONS = ['bind', 'unbind', 'claim', 'sync-library', 'sync-wishlist', 'api-key', 'delete-cascade'];

/**
 * 记一条审计（永不抛出）。entry: { action, steamId, personaName?, userId?, username?, actor?, result?, detail?, elapsedMs?, error? }
 * actor 约定：'admin:xxx' | 'scheduler' | 'self'。
 */
export async function recordSteamLog(q, entry) {
  try {
    const action = String(entry.action ?? '');
    if (!STEAM_LOG_ACTIONS.includes(action)) return false;
    await q(
      `insert into steam_account_logs
         (action, steam_id, persona_name, user_id, username, actor, result, detail, elapsed_ms, error)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        action,
        String(entry.steamId ?? '').slice(0, 64),
        entry.personaName != null ? String(entry.personaName).slice(0, 200) : null,
        entry.userId != null ? Number(entry.userId) : null,
        entry.username != null ? String(entry.username).slice(0, 200) : null,
        String(entry.actor ?? 'self').slice(0, 200),
        entry.result === 'failed' ? 'failed' : 'ok',
        entry.detail != null ? JSON.stringify(entry.detail) : null,
        entry.elapsedMs != null ? Math.round(Number(entry.elapsedMs)) : null,
        entry.error != null ? String(entry.error).slice(0, 200) : null,
      ],
    );
    return true;
  } catch {
    // 审计表未建好 / 写入失败：只吞掉，不影响主流程
    return false;
  }
}

/**
 * 查询审计（docs/ADMIN-CONSOLE-IA.md §6）：limit ≤ 500 / steamId / action / result / days（默认 30）。
 * 返回 { entries, total }；total 与 entries 同一过滤口径（分页显示条数用）。
 */
export async function listSteamLogs(q, { limit = 100, steamId = null, action = null, result = null, days = 30 } = {}) {
  const cap = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const span = Math.min(Math.max(Number(days) || 30, 1), 365);
  const where = [];
  const params = [];
  where.push(`created_at > now() - ($1::text || ' days')::interval`);
  params.push(String(span));
  if (steamId) {
    params.push(String(steamId).slice(0, 64));
    where.push(`steam_id = $${params.length}`);
  }
  if (action && STEAM_LOG_ACTIONS.includes(String(action))) {
    params.push(String(action));
    where.push(`action = $${params.length}`);
  }
  if (result === 'ok' || result === 'failed') {
    params.push(result);
    where.push(`result = $${params.length}`);
  }
  const cond = 'where ' + where.join(' and ');
  const count = await q(`select count(*)::int as n from steam_account_logs ${cond}`, params);
  params.push(cap);
  const rows = await q(
    `select id, created_at, action, steam_id, persona_name, user_id, username, actor, result, detail, elapsed_ms, error
       from steam_account_logs ${cond}
      order by id desc limit $${params.length}`,
    params,
  );
  return {
    total: Number(count.rows[0]?.n ?? 0),
    entries: rows.rows.map((r) => ({ ...r, id: Number(r.id) })),
  };
}
