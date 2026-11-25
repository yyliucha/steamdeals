// 逻辑备份：核心表导出成 gzip JSON，保留最近 N 份；顺带清理过期浏览记录与邮件记录。
//
// 同一份逻辑被 CLI（node src/cli.js backup）和后台「立即备份」按钮共用，
// 避免两处实现漂移。
//
// FP 批 P1（docs/SYNC-HARDENING.md §2）：改流式/分页写出——不再 `select *` 全量拉进内存
// 再一次 gzip（20 万游戏曾把 backup 卡死 39 小时）；每批行数受 BACKUP_BATCH_ROWS 限制、
// 逐行写 gzip 流；单轮超时（BACKUP_TIMEOUT_MIN，默认 30 分钟）自动中断并抛 BACKUP_TIMEOUT
// （调用方按 interrupted 收尾，不占 heavy slot）。
import { mkdirSync, writeFileSync, readdirSync, rmSync, statSync, createWriteStream } from 'node:fs';
import { createGzip } from 'node:zlib';
import { join } from 'node:path';
import * as db from './store/pg.js';
import { purgeOldCodes } from './email-auth.js';
import { formatDayUtc } from './format.js';

export const BACKUP_TABLES = [
  'platforms',
  'games',
  'game_aliases',
  'offers',
  'price_snapshots',
  'daily_prices',
  'watchlist',
  'users',
];

// FP 批 P1：分页游标——每表的稳定排序键与字段（全部来自 schema 白名单，不接用户输入）。
// daily_prices 是复合主键，用完整主键作行值比较游标，避免漏行。
const TABLE_CURSOR = {
  platforms: { order: 'code', fields: ['code'] },
  games: { order: 'id', fields: ['id'] },
  game_aliases: { order: 'id', fields: ['id'] },
  offers: { order: 'id', fields: ['id'] },
  price_snapshots: { order: 'id', fields: ['id'] },
  daily_prices: { order: 'game_id, platform_code, region, day', fields: ['game_id', 'platform_code', 'region', 'day'] },
  watchlist: { order: 'id', fields: ['id'] },
  users: { order: 'id', fields: ['id'] },
};

/** FP 批 P1：每批拉取行数（内存占用上限 ≈ 批行数 × 单行大小）。 */
export const BACKUP_BATCH_ROWS = 2000;

/** FP 批 P1：备份单轮超时（毫秒）——env BACKUP_TIMEOUT_MIN（分钟），默认 30。纯函数。 */
export function backupTimeoutMs(env = process.env) {
  const min = Number(env.BACKUP_TIMEOUT_MIN ?? 30);
  return (Number.isFinite(min) && min > 0 ? min : 30) * 60_000;
}

/** 现有备份文件（新→旧），带大小。 */
export function listBackups(dir = 'data/backup') {
  try {
    return readdirSync(dir)
      .filter((n) => n.startsWith('backup-') && n.endsWith('.gz'))
      .map((name) => {
        const file = join(dir, name);
        let size = 0;
        try {
          size = statSync(file).size;
        } catch {
          /* 统计失败忽略 */
        }
        return { name, size, path: file };
      })
      .sort((a, b) => b.name.localeCompare(a.name));
  } catch {
    return [];
  }
}

/**
 * 执行一次逻辑备份（FP 批 P1：流式/分页写出 + 单轮超时）。
 * @param {(sql: string, params?: any[]) => Promise<{rows: any[]}>} q
 * @param {{dir?: string, keep?: number, viewDays?: number, logger?: any, timeoutMs?: number}} opts
 */
export async function createBackup(q, { dir = 'data/backup', keep = 7, viewDays = 90, logger = null, timeoutMs = null } = {}) {
  mkdirSync(dir, { recursive: true });
  const stamp = formatDayUtc(new Date());
  const file = `${dir}/backup-${stamp}.json.gz`;
  const timeout = timeoutMs ?? backupTimeoutMs(process.env);
  const startedAt = Date.now();

  // FP 批 P1：超时中断——超过 BACKUP_TIMEOUT_MIN（默认 30 分钟）抛 BACKUP_TIMEOUT；
  // 调用方（CLI runSyncTracked）识别后把 sync_runs 记 interrupted + exit 75，不永久占槽。
  const checkTimeout = () => {
    if (Date.now() - startedAt > timeout) {
      const err = new Error(
        `备份超过 ${Math.round(timeout / 60000)} 分钟未完成，已自动中断（env BACKUP_TIMEOUT_MIN 可调，默认 30）`,
      );
      err.code = 'BACKUP_TIMEOUT';
      throw err;
    }
  };

  const gz = createGzip();
  const out = createWriteStream(file);
  gz.pipe(out);
  /** 写一块文本到 gzip 流（背压：write 返回 false 时等 drain）。 */
  const write = (chunk) =>
    new Promise((resolve, reject) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        gz.off('drain', done);
        gz.off('error', fail);
        resolve();
      };
      const fail = (err) => {
        if (settled) return;
        settled = true;
        gz.off('drain', done);
        gz.off('error', fail);
        reject(err);
      };
      gz.once('error', fail);
      if (gz.write(chunk)) done();
      else gz.once('drain', done);
    });

  const abort = async (err) => {
    try {
      gz.destroy();
    } catch {
      /* 已关闭 */
    }
    // 等底层写流关闭再删（Windows 下流未关时 rmSync 会 EBUSY 留半成品）
    await new Promise((resolve) => {
      out.once('close', resolve);
      out.once('error', resolve);
      setTimeout(resolve, 500);
    });
    try {
      rmSync(file, { force: true }); // 半成品备份不留在磁盘上
    } catch {
      /* 删除失败不影响报错 */
    }
    throw err;
  };

  let rows = 0;
  try {
    await write(`{"generatedAt":${JSON.stringify(new Date().toISOString())},"dump":{`);
    let firstTable = true;
    for (const table of BACKUP_TABLES) {
      checkTimeout();
      const cur = TABLE_CURSOR[table];
      if (!cur) throw new Error(`备份表 ${table} 缺少分页游标配置`);
      await write(`${firstTable ? '' : ','}${JSON.stringify(table)}:[`);
      firstTable = false;
      let firstRow = true;
      let last = null;
      while (true) {
        checkTimeout();
        const params = last ? [...cur.fields.map((f) => last[f]), BACKUP_BATCH_ROWS] : [BACKUP_BATCH_ROWS];
        const where = last
          ? ` where (${cur.fields.join(',')}) > (${cur.fields.map((_, i) => `$${i + 1}`).join(',')})`
          : '';
        const sql = `select * from ${table}${where} order by ${cur.order} limit $${params.length}`;
        const r = await q(sql, params);
        for (const row of r.rows ?? []) {
          await write(`${firstRow ? '' : ','}${JSON.stringify(row)}`);
          firstRow = false;
          last = row;
          rows += 1;
        }
        if (!r.rows?.length || r.rows.length < BACKUP_BATCH_ROWS) break;
      }
      await write(']');
    }
    await write('}}');
    await new Promise((resolve, reject) => {
      gz.once('close', resolve);
      gz.once('error', reject);
      gz.end();
    });
    checkTimeout();

    const purgedViews = await db.purgeOldViews(q, { days: viewDays });
    // 邮件记录只保留 3 天。email_codes 由 ensureEmailSchema 建表，
    // 少数场景（测试/未初始化）可能不存在——清理失败不应让整个备份失败。
    let purgedCodes = 0;
    try {
      purgedCodes = await purgeOldCodes(q, { days: 3 });
    } catch (err) {
      logger?.warn('backup.purge_codes_skipped', { message: String(err.message).slice(0, 120) });
    }
    checkTimeout();

    const files = readdirSync(dir).filter((n) => n.startsWith('backup-')).sort();
    let removed = 0;
    for (const old of files.slice(0, Math.max(0, files.length - Math.max(1, keep)))) {
      rmSync(`${dir}/${old}`, { force: true });
      removed += 1;
    }

    const result = { file, tables: BACKUP_TABLES.length, rows, removedOld: removed, purgedViews, purgedCodes };
    logger?.info('backup.done', result);
    return result;
  } catch (err) {
    await abort(err);
  }
}
