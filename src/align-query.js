// CN 批（docs/ALIGN-QUERY-PERF.md §2/§3）：对齐审核查询运行器——
// 结果缓存（TTL 10 分钟）+ single-flight（并发请求共享同一个计算 Promise）。
// 线上事故根因之一：GET /api/admin/align 每次请求都在主线程全量重算，
// 连续刷新会叠加多份计算。本模块把「算一次、大家读」与「refresh 强制重算」收敛成可单测的纯逻辑。
//
// 用法：
//   const runner = createAlignRunner({ compute: async () => ({ ... }) });
//   await runner.run();              // 缓存命中 / 首次计算（并发共享同一 Promise）
//   await runner.run({ refresh: 1 }); // 绕过缓存强制重算
//   runner.invalidate();             // 队列被 confirm/ignore 修改后失效

/**
 * CN 批：align 分页参数解析——非法/越界回落（page≥1；1≤pageSize≤50，默认 20）。
 * 纯函数可单测；query 传 URL.searchParams。
 */
export function parseAlignPage(query) {
  const num = (v, fallback) => {
    const n = Number.parseInt(String(v ?? ''), 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const page = Math.max(1, num(query.get('page'), 1));
  const pageSize = Math.min(50, Math.max(1, num(query.get('pageSize'), 20)));
  return { page, pageSize };
}

export function createAlignRunner({ compute, ttlMs = 10 * 60 * 1000, log = () => {} }) {
  let cache = null;
  let cachedAt = 0;
  let computing = null;
  let lastFromCache = false;

  return {
    /** 读取结果；refresh=true 强制重算。并发调用共享同一个计算 Promise（single-flight）。 */
    run({ refresh = false } = {}) {
      if (!refresh && cache && Date.now() - cachedAt < ttlMs) {
        lastFromCache = true;
        log('align.cache_hit', { cachedAt });
        return cache;
      }
      if (computing) {
        log('align.single_flight_shared', {});
        return computing;
      }
      lastFromCache = false;
      const startedAt = Date.now();
      computing = (async () => {
        try {
          const result = await compute();
          cache = result;
          cachedAt = Date.now();
          return result;
        } finally {
          computing = null;
        }
      })();
      log('align.compute_started', { startedAt });
      return computing;
    },

    /** 队列内容变化（confirm/ignore）后调用，下一次 run 重新计算。 */
    invalidate() {
      cache = null;
      cachedAt = 0;
    },

    /** 观测状态（测试/日志用）：cached 有缓存、computing 计算中、fromCache 最近一次 run 是否命中缓存。 */
    getState() {
      return { cached: cache != null, cachedAt, computing: computing != null, fromCache: lastFromCache };
    },
  };
}
