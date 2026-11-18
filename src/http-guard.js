// B1 批（docs/DESIGN-AUDIT.md B1）：重型接口并发闸——
// 同一 key 的请求最多 max 个并发执行，其余按 FIFO 排队；队列长度超 maxQueue 立即拒绝（GATE_BUSY），
// 排队等待超 waitMs 拒绝（GATE_WAIT_TIMEOUT）。排队是异步等待，不占事件循环；
// 排队期间请求自身的统一超时（server.js 的 15s 看门狗）仍兜底。
//
// 与 CN 批的 single-flight 不同：闸门不共享计算结果，只限制"同时执行的数量"——
// 语义是"同一接口同一时刻最多 N 个在执行"，适用于 admin 列表这类结果因人而异的重查询。

export function createConcurrencyGate({ max = 1, maxQueue = 20, waitMs = 15000 } = {}) {
  let running = 0;
  const waiters = [];

  const drain = () => {
    while (running < max && waiters.length > 0) {
      const w = waiters.shift();
      running += 1;
      w.start();
    }
  };
  const release = () => {
    running -= 1;
    drain();
  };

  /** 拿到执行槽位后跑 fn；排队超限/超时抛 code=GATE_BUSY / GATE_WAIT_TIMEOUT 的错误。 */
  const run = async (fn) => {
    if (running < max) {
      running += 1;
      try {
        return await fn();
      } finally {
        release();
      }
    }
    if (waiters.length >= maxQueue) {
      const err = new Error('gate busy');
      err.code = 'GATE_BUSY';
      throw err;
    }
    return new Promise((resolve, reject) => {
      const entry = {
        start: () => {
          clearTimeout(timer);
          (async () => {
            try {
              resolve(await fn());
            } catch (e) {
              reject(e);
            } finally {
              release();
            }
          })();
        },
      };
      const timer = setTimeout(() => {
        const i = waiters.indexOf(entry);
        if (i >= 0) waiters.splice(i, 1);
        const err = new Error('gate wait timeout');
        err.code = 'GATE_WAIT_TIMEOUT';
        reject(err);
      }, waitMs);
      timer.unref?.();
      waiters.push(entry);
    });
  };

  return {
    run,
    /** 当前排队数（观测用）。 */
    get pending() {
      return waiters.length;
    },
    /** 当前执行数（观测用）。 */
    get active() {
      return running;
    },
  };
}
