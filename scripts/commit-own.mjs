#!/usr/bin/env node
// 会话隔离提交脚本（2026-11-19 防暂存区串扰事故 d089bbd/39aaebb 后落地；docs/HANDOVER.md §10.6 配套工具）。
//
// 目的：
//   1) 每个会话用独立临时索引（GIT_INDEX_FILE）+ 底层管道（write-tree/commit-tree/update-ref）提交——
//      别人的暂存区进不了自己的提交；
//   2) 提交前自动 fetch + 新鲜度门禁——origin/main 有本地没有的提交就中止，防陈旧基线"回退重放"提交；
//   3) update-ref 带旧值 CAS——HEAD 被其它会话并发推进时原子失败，不覆盖他人提交；
//   4) 提交后同步共享索引（git reset -- <paths>）——管道提交绕过 git commit 的索引回写，不处理会
//      在别人下次提交时把本批文件当"删除"回退；他人已有在途暂存的路径不动并警告；
//   5) 路径与 ACTIVE-SESSIONS 他人文件面重叠时警告，确认全是自己的 hunk 才放行（--yes-overlap）；
//   6) 附带清单文件锁（lock/unlock）——写 TODO/INDEX/DONE/DELIVERY/ACTIVE-SESSIONS 前的互斥。
//
// 用法（在仓库根执行）：
//   node scripts/commit-own.mjs <条目编号> <提交信息> -- <自己的文件路径...>
//   node scripts/commit-own.mjs <条目编号> <提交信息> --yes-overlap -- <自己的文件路径...>
//   node scripts/commit-own.mjs lock <条目编号>
//   node scripts/commit-own.mjs unlock <条目编号>
//
// 环境变量（测试/特殊场景）：
//   COMMIT_OWN_SKIP_FETCH=1  跳过 fetch 与新鲜度门禁（离线测试）
//   COMMIT_OWN_PUSH=0        只提交不推送
//   COMMIT_OWN_ORIGIN=name   远端名（默认 origin）；COMMIT_OWN_BRANCH=name 目标分支（默认 main）
//
// 注意：不执行 commit 钩子（本仓库无自定义钩子）；提交身份取仓库级 user.name/user.email。
// 退出码：0 成功；2 清单锁被他人持有；3 清单锁非自己持有（unlock 拒绝）；4 origin 有本地没有的提交；
//         5 push 失败；6 路径与其它会话文件面重叠且未 --yes-overlap；7 参数/环境错误；1 其它失败。

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const LOCK_PATH = 'docs/.ledger-lock';
const ACTIVE_PATH = 'docs/ACTIVE-SESSIONS.md';
const ORIGIN = process.env.COMMIT_OWN_ORIGIN ?? 'origin';
const BRANCH = process.env.COMMIT_OWN_BRANCH ?? 'main';

function git(args, extraEnv = {}) {
  const r = spawnSync('git', args, {
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
    windowsHide: true,
  });
  return { code: r.status ?? 1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

class ScriptError extends Error {
  constructor(code, message) {
    super(message);
    this.exitCode = code;
  }
}

function assertRepoRoot() {
  const top = git(['rev-parse', '--show-toplevel']);
  if (top.code !== 0) throw new ScriptError(7, '当前目录不是 git 仓库');
  const cwd = resolve('.');
  const root = resolve(top.out);
  if (cwd !== root) throw new ScriptError(7, `请在仓库根执行（当前 ${cwd}，仓库根 ${root}）`);
}

// ---- 清单锁 ----
function cmdLock(entry) {
  try {
    writeFileSync(LOCK_PATH, JSON.stringify({ entry, at: new Date().toISOString() }, null, 2), { flag: 'wx' });
    console.log(`[commit-own] 已取得清单锁：${LOCK_PATH}（${entry}）`);
    console.log('[commit-own] 写完 TODO/INDEX/DONE/DELIVERY/ACTIVE-SESSIONS 后立即 unlock。');
  } catch (e) {
    if (e.code === 'EEXIST') {
      let holder = '(未知会话)';
      try {
        holder = JSON.parse(readFileSync(LOCK_PATH, 'utf8')).entry ?? holder;
      } catch {
        holder = readFileSync(LOCK_PATH, 'utf8').slice(0, 80);
      }
      throw new ScriptError(2, `清单锁被占用（持有者：${holder}）——按 HANDOVER §10.1 视为被占用，跳过写入照常干活，收尾复盘补`);
    }
    throw e;
  }
}

function cmdUnlock(entry) {
  if (!existsSync(LOCK_PATH)) throw new ScriptError(7, '清单锁不存在（可能已被释放或从未取得）');
  let holder = '';
  try {
    holder = JSON.parse(readFileSync(LOCK_PATH, 'utf8')).entry ?? '';
  } catch {
    /* 内容异常时按非自己持有处理 */
  }
  if (holder !== entry) throw new ScriptError(3, `清单锁不是自己持有的（持有者：${holder || '未知'}），拒绝删除`);
  rmSync(LOCK_PATH, { force: true });
  console.log('[commit-own] 已释放清单锁。');
}

// ---- 重叠检查（读 ACTIVE-SESSIONS，警告级判定） ----
function overlapsFromSessions(myEntry, paths) {
  if (!existsSync(ACTIVE_PATH)) return [];
  const rows = readFileSync(ACTIVE_PATH, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.startsWith('|'))
    .filter((l) => !l.includes('---|---'))
    .filter((l) => !l.includes('（示例）'));
  const overlaps = [];
  for (const row of rows) {
    const cells = row.split('|').map((c) => c.trim());
    const entry = cells[1] ?? '';
    const face = cells[2] ?? '';
    const session = cells[6] ?? '';
    if (!entry || entry === myEntry) continue;
    const bases = face
      .split(/[、；;]/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => t.replace(/\(.*$/, '').replace(/\*$/, '').replace(/\{[^}]*\}/g, '').trim())
      .filter((t) => t.includes('/'));
    for (const p of paths) {
      for (const b of bases) {
        if (p === b || p.startsWith(b + '/') || b.startsWith(p + '/')) {
          overlaps.push(`路径「${p}」落在会话 ${entry}（${session}）登记的文件面「${b}」内`);
        }
      }
    }
  }
  return overlaps;
}

// ---- 真实索引同步（防"幻影删除"） ----
// 管道提交绕过了 git commit 的索引回写。若不处理：共享索引相对新 HEAD 缺少本次提交的路径条目，
// 其它会话下次 commit 时会把本批文件当"删除"回退。因此提交后把「他人没有在途暂存」的路径
// 用 `git reset -- <path>` 同步到新 HEAD（只动索引条目，不碰任何工作区内容）；
// 他人已在途暂存（内容与旧 HEAD 不同）的路径不动并警告，避免覆盖他们的暂存。
function syncRealIndexAfterCommit(paths, oldHead) {
  const pre = git(['ls-files', '--stage', '--', ...paths]).out;
  const preMap = new Map();
  for (const line of pre.split(/\r?\n/).filter(Boolean)) {
    const idx = line.lastIndexOf('\t');
    const sha = line.slice(0, idx).split(' ')[1];
    preMap.set(line.slice(idx + 1), sha);
  }
  const toSync = [];
  for (const p of paths) {
    const stagedSha = preMap.get(p) ?? null;
    const oldHeadSha = git(['rev-parse', `${oldHead}:${p}`]).out;
    if (stagedSha === null || stagedSha === oldHeadSha) toSync.push(p);
    else console.warn(`[commit-own] ⚠ 路径「${p}」上有他人的未提交暂存（与旧 HEAD 不同），不覆盖；对方提交前需自行 git add 重暂存或 rebase。`);
  }
  if (toSync.length) {
    const r = git(['reset', '-q', '--', ...toSync]);
    if (r.code !== 0) {
      console.warn(`[commit-own] ⚠ 共享索引同步失败（${r.err}）——若他人下次提交出现本批文件的"删除"，请 git reset -- <paths> 补正。`);
    }
  }
}

// ---- 主流程：隔离提交 ----
function parseArgs(argv) {
  if (argv[0] === 'lock' || argv[0] === 'unlock') return { mode: argv[0], entry: argv[1] ?? '' };
  const entry = argv[0] ?? '';
  const message = argv[1] ?? '';
  const rest = argv.slice(2);
  const sep = rest.indexOf('--');
  let paths = [];
  let yesOverlap = false;
  if (sep >= 0) {
    const flags = rest.slice(0, sep);
    yesOverlap = flags.includes('--yes-overlap');
    paths = rest.slice(sep + 1);
  }
  return { mode: 'commit', entry, message, paths, yesOverlap };
}

function main() {
  let exitCode = 0;
  let errText = '';
  try {
    assertRepoRoot();
    const a = parseArgs(process.argv.slice(2));
    if (a.mode === 'lock') {
      if (!a.entry) throw new ScriptError(7, '用法：node scripts/commit-own.mjs lock <条目编号>');
      cmdLock(a.entry);
      return;
    }
    if (a.mode === 'unlock') {
      if (!a.entry) throw new ScriptError(7, '用法：node scripts/commit-own.mjs unlock <条目编号>');
      cmdUnlock(a.entry);
      return;
    }
    if (!a.entry || !a.message) throw new ScriptError(7, '用法：node scripts/commit-own.mjs <条目编号> "<提交信息>" [--yes-overlap] -- <paths...>');
    if (!a.paths.length) throw new ScriptError(7, 'paths 为空——必须显式列出自己的文件（防暂存区串扰）');
    if (existsSync('.git/index.lock')) throw new ScriptError(7, '.git/index.lock 存在，有 git 操作在跑，稍后再试');

    // 新鲜度门禁：origin/main 有本地 HEAD 没有的提交 → 中止，要求先 rebase。
    if (process.env.COMMIT_OWN_SKIP_FETCH !== '1') {
      const f = git(['fetch', ORIGIN]);
      if (f.code !== 0) throw new ScriptError(1, `git fetch ${ORIGIN} 失败：${f.err}`);
      const mb = git(['merge-base', '--is-ancestor', `${ORIGIN}/${BRANCH}`, 'HEAD']);
      if (mb.code !== 0) {
        throw new ScriptError(4, `${ORIGIN}/${BRANCH} 有本地没有的提交——先 git pull --rebase（必要时 --autostash）并处理冲突后重跑本命令，禁止基于陈旧基线提交`);
      }
    }

    // 临时索引（物理隔离于共享 .git/index）
    const tmpDir = mkdtempSync(join(tmpdir(), 'dsh-idx-'));
    const idxEnv = { GIT_INDEX_FILE: join(tmpDir, 'index') };
    try {
      let r = git(['read-tree', 'HEAD'], idxEnv);
      if (r.code !== 0) throw new ScriptError(1, `git read-tree 失败：${r.err}`);
      r = git(['add', '--', ...a.paths], idxEnv);
      if (r.code !== 0) throw new ScriptError(1, `git add 失败：${r.err}\n${r.out}`);
      const staged = git(['diff', '--cached', '--name-only', '--', ...a.paths], idxEnv).out.split(/\r?\n/).filter(Boolean);
      if (!staged.length) throw new ScriptError(7, '这些路径相对 HEAD 没有改动，无可提交内容');
      const missing = a.paths.filter((p) => !staged.includes(p));
      if (missing.length) throw new ScriptError(7, `以下路径没有落入暂存（不存在或拼写错误）：${missing.join('、')}`);

      const overlaps = overlapsFromSessions(a.entry, staged);
      if (overlaps.length) {
        console.warn('[commit-own] ⚠ 路径与其它会话登记的文件面重叠：');
        for (const o of overlaps) console.warn(`  - ${o}`);
        if (!a.yesOverlap) throw new ScriptError(6, '请人工确认这些文件的改动全部属于自己；确认后加 --yes-overlap 重跑。');
        console.warn('[commit-own] 已按 --yes-overlap 继续。');
      }

      const stat = git(['diff', '--cached', '--stat'], idxEnv);
      console.log('[commit-own] 将提交以下内容（私有临时索引，不动共享暂存区）：');
      console.log(stat.out || '(二进制/新文件)');

      // 纯底层管道提交：不用 git commit（实测它会把已提交路径写回真实 index）；
      // update-ref 带旧值 CAS，HEAD 被并发推进时原子失败。
      const oldHead = git(['rev-parse', 'HEAD']).out;
      const tree = git(['write-tree'], idxEnv);
      if (tree.code !== 0) throw new ScriptError(1, `git write-tree 失败：${tree.err}`);
      const made = git(['commit-tree', tree.out, '-p', oldHead, '-m', a.message]);
      if (made.code !== 0) throw new ScriptError(1, `git commit-tree 失败：${made.err}\n${made.out}`);
      const upd = git(['update-ref', 'HEAD', made.out, oldHead]);
      if (upd.code !== 0) throw new ScriptError(1, `git update-ref 失败（HEAD 在本脚本运行期间被其它会话推进时也会触发）：${upd.err}。重跑本命令即可。`);

      // 同步共享索引：把他人未在途暂存的路径条目更新到新 HEAD（防幻影删除回退）
      syncRealIndexAfterCommit(a.paths, oldHead);

      const hash = git(['rev-parse', '--short', 'HEAD']).out;
      console.log(`[commit-own] ✅ 已提交 ${hash}（paths：${a.paths.join(' ')}）`);

      if (process.env.COMMIT_OWN_PUSH !== '0') {
        r = git(['push', ORIGIN, BRANCH]);
        if (r.code !== 0) {
          throw new ScriptError(5, `push 失败（可能他人在 fetch 之后又推送了）：${r.err}\n${r.out}\n处理：git pull --rebase 后重跑本命令；禁止强推。`);
        }
        console.log(`[commit-own] ✅ 已推送 ${ORIGIN}/${BRANCH}`);
      } else {
        console.log('[commit-own] COMMIT_OWN_PUSH=0，未推送');
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  } catch (e) {
    if (e instanceof ScriptError) {
      exitCode = e.exitCode;
      errText = e.message;
    } else {
      exitCode = 1;
      errText = String(e?.stack || e);
    }
  }
  if (errText) console.error(`[commit-own] ${errText}`);
  if (exitCode !== 0) process.exit(exitCode);
}

main();
