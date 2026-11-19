// CN 批（docs/ALIGN-QUERY-PERF.md §2/§3）：对齐审核分页参数解析。
// DL 批（docs/ALIGN-SNAPSHOT.md §5）：内存缓存运行器（createAlignRunner 的 TTL/single-flight/
// invalidate/staleCache）已废弃删除——队列真相改为 align_snapshots 库快照（见 align-snapshot.js），
// 本文件只保留与缓存无关的纯函数。

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
