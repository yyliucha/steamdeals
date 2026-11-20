// DX 批（docs/SEARCH-FIX-PERF.md §DX）：前台列表/搜索的短 TTL 内存缓存工具。
//
// 设计（规格 §DX 方案 2）：
//   · 纯逻辑、无 DB 依赖——TTL / 容量淘汰 / 数据世代校验都锁在 test/search-perf.test.js；
//   · key = 归一化筛选参数 + region + userId 摘要（由调用方 server.js 组装）；
//   · 失效三路：① TTL（默认 45s，规格 30–60s 区间内）；② 进程内主动 invalidate()
//     （管理员写操作 / 手动同步子进程结束后调用）；③ 数据世代 gen 不匹配即视为过期——
//     gen 来自 sync_runs 最大 id（调度器是独立进程，同步完成无法回调 HTTP 进程，
//     靠每次列表请求顺带读一次 max(id) 主键查询感知跨进程变化）。
//   · 每个服务实例各建一份（多副本各自缓存，语义与 adminGamesCache / imgMissCache 先例一致）。

/**
 * 稳定字符串摘要（FNV-1a 32 位，非密码学用途）：
 * 游客 guestFlags 的 id 数组最长 5000 个，直接进 key 会让 Map 键膨胀；哈希后 key 长度恒定。
 */
export function stableHash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * 短 TTL 内存缓存：key → { payload, gen, at }。
 * get(key, gen)：TTL 过期或 gen 不匹配（且调用方给了 gen）都视为 miss 并删除条目。
 * 淘汰策略：超过 maxEntries 时按插入顺序逐出最旧（Map 保序，FIFO 近似 LRU）。
 */
export function createListCache({ ttlMs = 45_000, maxEntries = 512, now = Date.now } = {}) {
  const entries = new Map();
  return {
    get(key, gen = null) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (now() - entry.at >= ttlMs) {
        entries.delete(key);
        return undefined;
      }
      if (gen !== null && entry.gen !== gen) {
        entries.delete(key);
        return undefined;
      }
      return entry.payload;
    },
    set(key, payload, gen = null) {
      if (entries.size >= maxEntries && !entries.has(key)) {
        entries.delete(entries.keys().next().value);
      }
      entries.set(key, { payload, gen, at: now() });
    },
    invalidate() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
}
