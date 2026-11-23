// EU-1（docs/SCHEDULER-RESTART-RESILIENCE.md）：SIGTERM 中断收尾（工厂）。
//
// 服务停机时父进程先对 CLI 子进程发 SIGTERM：把 sync_runs 记为 interrupted（含已完成进度）
// 再以 143（128+15）退出——父调度器据此判「被重启中断」（不告警、不熔断、下轮断点续跑）。
// 控制台手动触发的任务（SYNC_RUN_ID 由 web 进程建行，own=false）不写库，由 web 端按
// 「已停止（cancelled）」收尾，避免互相覆盖。
//
// 抽成工厂是为了可测：cli.js 传真实 getRun/finish；测试传假函数验证回调行为与退出码。
//
// Windows 没有 POSIX SIGTERM（child.kill('SIGTERM') 直接强杀、handler 不触发）——
// 真信号行为由 CI（Linux runner）锁住，本机以 shouldMarkInterrupted 纯逻辑覆盖。
export function shouldMarkInterrupted(run) {
  return Boolean(run && run.own && run.id);
}

export function installSigtermHandler({ getRun, finish, logger = null, exitCode = 143 }) {
  let handled = false;
  process.once('SIGTERM', () => {
    if (handled) return;
    handled = true;
    const run = getRun?.();
    if (shouldMarkInterrupted(run)) {
      Promise.resolve(finish(run))
        .catch((err) =>
          logger?.warn?.('sync.interrupt_mark_failed', {
            runId: run.id,
            message: String(err?.message ?? err).slice(0, 160),
          }),
        )
        .finally(() => process.exit(exitCode));
      return;
    }
    process.exit(exitCode);
  });
}
