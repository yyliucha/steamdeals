// FY-2（docs/SETTINGS-REDESIGN.md §3.3「即时保存」）：设置页「改一项即存」的合并队列。
//
// 为什么不是一个「改完立刻 POST」：规格还要求「1.5 秒窗口内的多次改动合并成一次 POST」，
// 否则连续改 3 项会让 app_settings 的 revision 涨 3 次、调度器反复水合（§3.3 决策 2）。
// 两条计时器同时满足 §7 的验收 4 与验收 5：
//   - 静默 flush（QUIET_FLUSH_MS=700）：最后一次改动后 700ms 没有新改动就发 → 单改一项 1 秒内出「✓ 已保存」；
//   - 合并上限（MERGE_WINDOW_MS=1500）：从本批第一项改动起最多等 1500ms，到点必发 → 1.5 秒内的连续改动
//     全部进同一批，只发 1 次 POST。
// int / string / text 另加 600ms 输入防抖（INPUT_DEBOUNCE_MS）：停止输入 600ms 才把草稿并入队列并立刻 flush；
// 失焦（blur）走 commitNow，草稿立即并入同一批（不等 600ms）。
//
// 纯逻辑：不发请求、不依赖 Vue——save/回滚/状态回调全部注入，测试用假计时器逐毫秒驱动
// （test/settings-immediate-save.test.js）。
export const MERGE_WINDOW_MS = 1500;
export const QUIET_FLUSH_MS = 700;
export const INPUT_DEBOUNCE_MS = 600;
export const SAVED_FADE_MS = 2000;

/** 把任意错误规整成一行可读原因（行内红字用；服务端 400 已带中文原因）。 */
export function errorText(err) {
  const raw = String(err?.message ?? err ?? '').trim();
  return raw || '保存失败';
}

/**
 * 创建合并保存队列。
 *
 * @param {object} opts
 * @param {(values: Record<string, unknown>) => Promise<any>} opts.save 提交一批改动（POST /api/admin/settings）
 * @param {(key: string, kind: 'saving'|'saved'|'error'|'idle', message?: string) => void} [opts.onState] 行内状态
 * @param {(key: string, previous: unknown) => void} [opts.onRollback] 失败回滚（回上次成功保存的值）
 * @param {(view: any, values: Record<string, unknown>, keys: string[]) => void} [opts.onSaved] 成功后同步 schema
 * @param {{setTimeout: Function, clearTimeout: Function}} [opts.timers] 计时器（测试注入假实现）
 * @param {number} [opts.mergeWindowMs]
 * @param {number} [opts.quietMs]
 * @param {number} [opts.inputDebounceMs]
 * @param {number} [opts.savedFadeMs]
 */
export function createSettingsSaver({
  save,
  onState = () => {},
  onRollback = () => {},
  onSaved = () => {},
  timers = { setTimeout: (...args) => setTimeout(...args), clearTimeout: (id) => clearTimeout(id) },
  mergeWindowMs = MERGE_WINDOW_MS,
  quietMs = QUIET_FLUSH_MS,
  inputDebounceMs = INPUT_DEBOUNCE_MS,
  savedFadeMs = SAVED_FADE_MS,
} = {}) {
  if (typeof save !== 'function') throw new TypeError('createSettingsSaver 需要 save(values) 回调');

  const pending = new Map(); // key -> 待提交值（本批）
  const previous = new Map(); // key -> 本批第一次改动前的已保存值（回滚目标）
  const drafts = new Map(); // key -> { value, previous } 输入防抖中的草稿
  const states = new Map(); // key -> { kind, message }
  const inputTimers = new Map();
  const fadeTimers = new Map();
  let quietTimer = null;
  let capTimer = null;
  let flushing = null;
  let rerun = false;
  let disposed = false;

  const pick = (value) => (typeof value === 'function' ? value() : value);
  const clearTimer = (timer) => {
    if (timer != null) timers.clearTimeout(timer);
    return null;
  };

  function setState(key, kind, message = '') {
    if (kind === 'idle') states.delete(key);
    else states.set(key, { kind, message });
    onState(key, kind, message);
  }

  function scheduleFade(key) {
    clearTimer(fadeTimers.get(key));
    fadeTimers.set(
      key,
      timers.setTimeout(() => {
        fadeTimers.delete(key);
        if (states.get(key)?.kind === 'saved') setState(key, 'idle');
      }, savedFadeMs),
    );
  }

  function armQuiet() {
    quietTimer = clearTimer(quietTimer);
    quietTimer = timers.setTimeout(() => {
      quietTimer = null;
      void flush().catch(() => {});
    }, quietMs);
  }

  function armCap() {
    if (capTimer != null) return;
    capTimer = timers.setTimeout(() => {
      capTimer = null;
      void flush().catch(() => {});
    }, mergeWindowMs);
  }

  function cancelInput(key) {
    if (!inputTimers.has(key)) return;
    clearTimer(inputTimers.get(key));
    inputTimers.delete(key);
  }

  /** 把一次改动并入本批；prev 为回滚目标（函数形式 = 提交时再取，避免拿到刚输入的草稿）。 */
  function queue(key, value, prev) {
    if (disposed) return;
    if (!pending.has(key)) previous.set(key, pick(prev));
    pending.set(key, value);
    clearTimer(fadeTimers.get(key));
    fadeTimers.delete(key);
    setState(key, 'saving');
    armQuiet();
    armCap();
  }

  /** 提交本批（幂等：并发调用复用同一个 Promise；提交中又有改动 → 结束后再发一批）。 */
  function flush() {
    if (disposed) return Promise.resolve(null);
    quietTimer = clearTimer(quietTimer);
    capTimer = clearTimer(capTimer);
    if (flushing) {
      rerun = true;
      return flushing;
    }
    if (!pending.size) return Promise.resolve(null);
    const values = {};
    const keys = [];
    const rollbackTo = new Map();
    for (const [key, value] of pending) {
      values[key] = value;
      keys.push(key);
      rollbackTo.set(key, previous.get(key));
    }
    pending.clear();
    previous.clear();
    flushing = Promise.resolve()
      .then(() => save(values))
      .then((view) => {
        for (const key of keys) {
          setState(key, 'saved');
          scheduleFade(key);
        }
        onSaved(view, values, keys);
        return view;
      })
      .catch((err) => {
        const message = errorText(err);
        for (const key of keys) {
          onRollback(key, rollbackTo.get(key));
          setState(key, 'error', message);
        }
        throw err;
      })
      .finally(() => {
        flushing = null;
        if (pending.size) {
          armQuiet();
          armCap();
        }
        if (rerun) {
          rerun = false;
          void flush().catch(() => {});
        }
      });
    return flushing;
  }

  return {
    /** bool / enum 等离散控件：改动即并入本批（静默 700ms 或上限 1.5s 后发）。 */
    set(key, value, prev) {
      cancelInput(key);
      drafts.delete(key);
      queue(key, value, prev);
    },
    /** 输入类控件（int / string / text）逐字调用：600ms 防抖后并入队列并立即提交。 */
    input(key, value, prev) {
      if (disposed) return;
      cancelInput(key);
      drafts.set(key, { value, previous: prev });
      inputTimers.set(
        key,
        timers.setTimeout(() => {
          inputTimers.delete(key);
          const draft = drafts.get(key);
          drafts.delete(key);
          if (!draft) return;
          queue(key, draft.value, draft.previous);
          void flush().catch(() => {});
        }, inputDebounceMs),
      );
    },
    /** 失焦 / 下拉确认等「立即提交」入口：草稿立刻并入本批并发出。 */
    commitNow(key, value, prev) {
      cancelInput(key);
      drafts.delete(key);
      queue(key, value, prev);
      return flush();
    },
    /** 页面离开：把还在 600ms 防抖里的草稿一起并入，强制发一次（可能返回 null = 没有待发改动）。 */
    flushAll() {
      for (const [key, draft] of [...drafts]) {
        cancelInput(key);
        drafts.delete(key);
        queue(key, draft.value, draft.previous);
      }
      return flush();
    },
    /** 只提交本批（不吃防抖草稿）。 */
    flush,
    cancelInput,
    pendingCount: () => pending.size,
    draftCount: () => drafts.size,
    hasPending: () => pending.size > 0 || drafts.size > 0,
    hasErrors: () => [...states.values()].some((s) => s.kind === 'error'),
    errorKeys: () => [...states.entries()].filter(([, s]) => s.kind === 'error').map(([k]) => k),
    stateOf: (key) => states.get(key) ?? null,
    dispose() {
      disposed = true;
      quietTimer = clearTimer(quietTimer);
      capTimer = clearTimer(capTimer);
      for (const id of inputTimers.values()) clearTimer(id);
      for (const id of fadeTimers.values()) clearTimer(id);
      inputTimers.clear();
      fadeTimers.clear();
      pending.clear();
      previous.clear();
      drafts.clear();
    },
  };
}
