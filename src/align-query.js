// CN 批（docs/ALIGN-QUERY-PERF.md §2/§3）：对齐审核查询运行器——
// 结果缓存（TTL 10 分钟）+ single-flight（并发请求共享同一个计算 Promise）。
// CS 批（docs/ALIGN-DB-SLOW.md §2 #2/#3，2026-11-18）：改为「后台生成」模型——
// 接口冷缓存时触发后台计算（setImmediate 分片、无 20s 硬截断）并立即返回 generating 状态，
// 前端轮询直到缓存就绪；前处理不再计入预算（预算语义：只约束匹配循环，由调用方传 startedAt）。
//
// 用法：
//   const runner = createAlignRunner({ compute: async ({ onProgress }) => ({ ... }) });
//   const s = runner.background({ refresh });   // { ready:true } | { generating:true, processed, total }
//   await runner.run({ refresh });              // 同步等待结果（缓存命中 / 共享计算）
//   runner.invalidate();                        // 队列被 confirm/ignore 修改后失效

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
  let progress = null; // { processed, total, startedAt }

  const startCompute = () => {
    const startedAt = Date.now();
    progress = { processed: 0, total: 0, startedAt };
    computing = (async () => {
      try {
        const result = await compute({
          onProgress: (processed, total) => {
            progress = { processed, total, startedAt };
          },
        });
        cache = result;
        cachedAt = Date.now();
        return result;
      } finally {
        computing = null;
        progress = null;
      }
    })();
    log('align.compute_started', { startedAt });
    return computing;
  };

  const hitCache = ({ refresh = false } = {}) =>
    !refresh && cache && Date.now() - cachedAt < ttlMs;

  return {
    /** 同步等待结果：缓存命中立即返回；冷缓存等待计算完成（与并发请求共享同一 Promise）。 */
    run({ refresh = false } = {}) {
      if (hitCache({ refresh })) {
        lastFromCache = true;
        log('align.cache_hit', { cachedAt });
        return cache;
      }
      if (computing) {
        log('align.single_flight_shared', {});
        return computing;
      }
      lastFromCache = false;
      return startCompute();
    },

    /**
     * 后台生成（CS 批）：冷缓存时启动计算但**不等待**，立即返回状态；
     * 缓存就绪返回 { ready:true }；计算中/刚触发返回 { generating:true, processed, total }。
     * 连续调用共享同一个计算 Promise（single-flight），不会叠加计算。
     */
    background({ refresh = false } = {}) {
      if (hitCache({ refresh })) {
        lastFromCache = true;
        log('align.cache_hit', { cachedAt });
        return { ready: true };
      }
      if (computing) {
        return { generating: true, processed: progress?.processed ?? 0, total: progress?.total ?? 0 };
      }
      lastFromCache = false;
      startCompute();
      return { generating: true, processed: 0, total: 0 };
    },

    /** 队列内容变化（confirm/ignore）后调用，下一次 run/background 重新计算。 */
    invalidate() {
      cache = null;
      cachedAt = 0;
    },

    /** 观测状态（测试/日志用）：cached 有缓存、computing 计算中、fromCache 最近一次 run 是否命中缓存、progress 进度。 */
    getState() {
      return {
        cached: cache != null,
        cachedAt,
        computing: computing != null,
        fromCache: lastFromCache,
        processed: progress?.processed ?? 0,
        total: progress?.total ?? 0,
      };
    },
  };
}
