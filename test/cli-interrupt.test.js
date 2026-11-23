// EU 批（docs/SCHEDULER-RESTART-RESILIENCE.md §4.1）：重启模拟——真信号 SIGTERM（CI Linux）+ 纯逻辑（全平台）。
//
// 真进程验证 cli-interrupt 的 SIGTERM 收尾（cli.js 实际接线的是同一工厂，静态锁在
// scheduler.test.js）：
//   1. 在跑任务（own=true）收到 SIGTERM → finish 被调（写 sync_runs interrupted 的收尾函数）→ exit 143；
//   2. 控制台手动任务（own=false，记录由 web 进程建行）→ 不写库，直接 exit 143（web 端收尾 cancelled）。
// Windows 没有 POSIX SIGTERM（child.kill('SIGTERM') 直接强杀、handler 不触发），真信号用例在
// win32 上显式跳过、由 CI（Linux runner）锁住；本机以 shouldMarkInterrupted 纯逻辑覆盖判定口径。
//
// 反向自检口径：删掉 installSigtermHandler 里的 process.exit(exitCode) → CI 退出码断言红（进程挂起超时）；
// 把 own 判定删掉 → own=false 场景的「不调 finish」断言红。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { shouldMarkInterrupted } from '../src/cli-interrupt.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHILD = join(ROOT, 'test', 'fixtures', 'interrupt-child.mjs');
const WIN_SKIP = process.platform === 'win32' ? 'Windows 无 POSIX SIGTERM（kill 直接强杀、handler 不触发），真信号由 CI Linux 覆盖' : false;

function spawnChild(activeRun, extraEnv = {}) {
  return spawn(process.execPath, [CHILD], {
    cwd: ROOT,
    env: { ...process.env, INTERRUPT_ACTIVE_RUN: JSON.stringify(activeRun), ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

test('EU-1 判定口径（纯函数）：只有本进程建行（own）的任务才写 interrupted 收尾', () => {
  assert.equal(shouldMarkInterrupted({ id: 42, own: true }), true, '调度器子进程自建记录 → 写 interrupted');
  assert.equal(shouldMarkInterrupted({ id: 7, own: false }), false, '控制台触发（web 建行）→ 不写，由 web 端收尾 cancelled');
  assert.equal(shouldMarkInterrupted({ id: null, own: true }), false, '还没建行 → 不写（残留 running 由启动清理兜底）');
  assert.equal(shouldMarkInterrupted(null), false, '没有在跑任务 → 不写');
});

test('EU-1 重启模拟：在跑任务收到 SIGTERM → 标记 interrupted → exit 143', { skip: WIN_SKIP }, async () => {
  const markFile = join(tmpdir(), `eu-interrupt-${Date.now()}.json`);
  const child = spawnChild({ id: 42, own: true }, { INTERRUPT_MARK_FILE: markFile });
  try {
    await new Promise((res) => setTimeout(res, 300)); // 等 handler 注册完成
    child.kill('SIGTERM');
    const code = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve('timeout'), 10_000);
      child.once('exit', (c) => {
        clearTimeout(timer);
        resolve(c);
      });
    });
    assert.equal(code, 143, `SIGTERM 收尾后以 143（128+15）退出，实际 ${code}`);
    assert.ok(existsSync(markFile), 'finish 收尾函数被调用（真实场景中即写 sync_runs.status=interrupted）');
    const mark = JSON.parse(readFileSync(markFile, 'utf8'));
    assert.deepEqual(mark, { marked: true, id: 42, own: true }, '标记的是在跑的那条任务');
  } finally {
    try {
      child.kill('SIGKILL');
    } catch {
      /* 已退出 */
    }
    rmSync(markFile, { force: true });
  }
});

test('EU-1 手动停止场景：own=false 不写库、直接 exit 143（web 端收尾 cancelled，不互相覆盖）', { skip: WIN_SKIP }, async () => {
  const markFile = join(tmpdir(), `eu-interrupt-own-${Date.now()}.json`);
  const child = spawnChild({ id: 7, own: false }, { INTERRUPT_MARK_FILE: markFile });
  try {
    await new Promise((res) => setTimeout(res, 300));
    child.kill('SIGTERM');
    const code = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve('timeout'), 10_000);
      child.once('exit', (c) => {
        clearTimeout(timer);
        resolve(c);
      });
    });
    assert.equal(code, 143, '同样以 143 退出');
    assert.ok(!existsSync(markFile), 'own=false 不调用收尾写库（记录由 web 进程负责）');
  } finally {
    try {
      child.kill('SIGKILL');
    } catch {
      /* 已退出 */
    }
    rmSync(markFile, { force: true });
  }
});
