// commit-own 会话隔离提交脚本的行为锁（docs/HANDOVER.md §10.6 配套）：
// 用真实 git + 本地 bare origin（零网络）验证四件事——
// ① 只提交自己的 paths，他人暂存（共享 index）不进提交也不被破坏；
// ② origin 前进时中止（退出码 4），rebase 后重跑成功——防陈旧基线回退重放；
// ③ 清单锁 acquire/release 语义（他人持有→2，非自己→3，自己→0）；
// ④ 路径与 ACTIVE-SESSIONS 他人文件面重叠 → 无 --yes-overlap 中止（6），加旗标放行。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/commit-own.mjs', import.meta.url));

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  return { code: r.status ?? 1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

function commitOwn(cwd, args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', windowsHide: true });
}

/** 一套独立环境：bare origin + 工作仓库（含初始提交 a.txt 并已推送）。 */
function makeEnv() {
  const base = mkdtempSync(join(tmpdir(), 'co-'));
  const origin = join(base, 'origin.git');
  const work = join(base, 'work');
  mkdirSync(work, { recursive: true });
  git(base, ['init', '--bare', origin, '--quiet']);
  // 显式把 bare 仓库 HEAD 指向 main：Linux runner 上 bare init 默认是 master，
  // clone 会因「remote HEAD 指向不存在的分支」而检不出分支（本机 Windows git 默认 main，两平台行为不同）。
  git(origin, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  git(work, ['init', '-b', 'main', '--quiet']);
  git(work, ['config', 'user.name', 'tester']);
  git(work, ['config', 'user.email', 'tester@example.com']);
  git(work, ['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(work, 'a.txt'), 'a\n');
  git(work, ['add', 'a.txt']);
  git(work, ['commit', '-m', 'init', '--quiet']);
  git(work, ['remote', 'add', 'origin', origin]);
  git(work, ['push', '-u', 'origin', 'main', '--quiet']);
  return { base, origin, work };
}

test('隔离提交：只提交自己的 paths；他人暂存既不进提交也不被破坏；推送到位', () => {
  const { base, origin, work } = makeEnv();
  try {
    // 模拟他人：b.txt 已暂存进共享 index（未提交）
    writeFileSync(join(work, 'b.txt'), 'b\n');
    git(work, ['add', 'b.txt']);
    // 自己：c.txt 未暂存
    writeFileSync(join(work, 'c.txt'), 'c\n');
    const r = commitOwn(work, ['T1', 'test: c', '--', 'c.txt']);
    assert.equal(r.status, 0, r.stderr || r.stdout);

    assert.equal(git(work, ['show', 'HEAD:c.txt']).out, 'c', '自己的文件进了提交');
    assert.notEqual(git(work, ['show', 'HEAD:b.txt']).code, 0, '他人的暂存没有混进提交');
    assert.equal(git(work, ['diff', '--cached', '--name-only']).out, 'b.txt', '共享暂存区原样未动（他人可继续）');
    assert.equal(git(work, ['rev-parse', 'HEAD']).out, git(origin, ['rev-parse', 'main']).out, '提交已推送 origin/main');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('新鲜度门禁：origin 前进 → 中止（退出码 4）；rebase 后重跑成功', () => {
  const { base, origin, work } = makeEnv();
  try {
    // 他人先推进 origin：work2 克隆 → 提交 x.txt → 推送
    const work2 = join(base, 'work2');
    git(base, ['clone', '-b', 'main', origin, work2, '--quiet']);
    git(work2, ['config', 'user.name', 't2']);
    git(work2, ['config', 'user.email', 't2@example.com']);
    git(work2, ['config', 'commit.gpgsign', 'false']);
    writeFileSync(join(work2, 'x.txt'), 'x\n');
    git(work2, ['add', 'x.txt']);
    git(work2, ['commit', '-m', 'x', '--quiet']);
    git(work2, ['push', 'origin', 'main', '--quiet']);

    // 本仓库基于陈旧基线想提交 d.txt → 必须被拦下
    writeFileSync(join(work, 'd.txt'), 'd\n');
    const r1 = commitOwn(work, ['T1', 'test: d', '--', 'd.txt']);
    assert.equal(r1.status, 4, 'origin 前进时中止（防回退重放）');
    assert.notEqual(git(work, ['show', 'HEAD:d.txt']).code, 0, '中止时不产生提交');

    // rebase 后重跑 → 成功
    const rb = git(work, ['pull', '--rebase', '--quiet']);
    assert.equal(rb.code, 0, rb.err);
    const r2 = commitOwn(work, ['T1', 'test: d', '--', 'd.txt']);
    assert.equal(r2.status, 0, r2.stderr || r2.stdout);
    assert.equal(git(work, ['show', 'HEAD:d.txt']).out, 'd');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('清单锁：他人持有 → 2；非自己持有 → 3（不误删）；自己 → 0 并删除', () => {
  const { base, work } = makeEnv();
  try {
    mkdirSync(join(work, 'docs'), { recursive: true });
    const l1 = commitOwn(work, ['lock', 'T9']);
    assert.equal(l1.status, 0, l1.stderr || l1.stdout);
    const lockPath = join(work, 'docs', '.ledger-lock');
    assert.ok(existsSync(lockPath), '锁文件已创建');

    const l2 = commitOwn(work, ['lock', 'T8']);
    assert.equal(l2.status, 2, '被占用时拒绝并提示持有者');
    assert.ok(existsSync(lockPath));

    const u1 = commitOwn(work, ['unlock', 'T8']);
    assert.equal(u1.status, 3, '非自己持有拒绝删除');
    assert.ok(existsSync(lockPath), '锁仍在（未被误删）');

    const u2 = commitOwn(work, ['unlock', 'T9']);
    assert.equal(u2.status, 0, u2.stderr || u2.stdout);
    assert.ok(!existsSync(lockPath), '自己释放后锁删除');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('重叠警告：路径落在 ACTIVE-SESSIONS 他人文件面 → 需 --yes-overlap 才放行', () => {
  const { base, work } = makeEnv();
  try {
    mkdirSync(join(work, 'docs'), { recursive: true });
    writeFileSync(
      join(work, 'docs', 'ACTIVE-SESSIONS.md'),
      [
        '| 条目 | 文件面 | 独占资源 | 开始 | 预计结束 | 会话 |',
        '|---|---|---|---|---|---|',
        '| XX | src/aaa.js、frontend/pages | 无 | 11-19 | 11-19 | other |',
        '',
      ].join('\n'),
    );
    mkdirSync(join(work, 'src'), { recursive: true });
    writeFileSync(join(work, 'src', 'aaa.js'), 'export const x = 1;\n');

    const r1 = commitOwn(work, ['T1', 'test: aaa', '--', 'src/aaa.js']);
    assert.equal(r1.status, 6, '与其它会话文件面重叠且未确认 → 中止');

    const r2 = commitOwn(work, ['T1', 'test: aaa', '--yes-overlap', '--', 'src/aaa.js']);
    assert.equal(r2.status, 0, r2.stderr || r2.stdout);
    assert.equal(git(work, ['show', 'HEAD:src/aaa.js']).out, 'export const x = 1;');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
