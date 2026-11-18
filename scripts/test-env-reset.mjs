#!/usr/bin/env node
// DI 批（docs/TEST-ENV-ISOLATION.md §3C/§5）：测试环境复位——
// 白名单精确移走运行时产物到仓库外备份目录；绝不整删 data/。
// 入库源数据（data/skus.json、data/games.json、data/secret.key、wishlist.example.txt）与
// 本地调试库（*pgdata*、images、pages、backup）不在白名单里，永不入选。
//
// 用法：
//   node scripts/test-env-reset.mjs                # dry-run：只打印将移走的项与目标路径，不动作
//   node scripts/test-env-reset.mjs --apply        # 执行：把命中项移到 <备份根>\<时间戳>\（保留相对结构）
//   node scripts/test-env-reset.mjs --restore <时间戳>  # 把该时间戳备份移回原位；目标已存在则跳过不覆盖
// 退出码：0 = 正常（含 dry-run 与「无命中项」）；1 = 参数错误 / 恢复目标不存在。
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
// 备份根固定仓库外（DI 规格：F:\dsh\test-env-bak\<时间戳>\）；换机器可用 TEST_ENV_BAK_DIR 覆盖。
const BAK_ROOT = process.env.TEST_ENV_BAK_DIR ?? 'F:\\dsh\\test-env-bak';

// 白名单 = 脚本内显式清单（单一真相，不运行时拼接路径）。全部是运行时产物 / 本地临时文件：
// data/app（GitHub Release 每小时同步产物）与各调度/代理状态文件、data/*.jsonl 轮转日志、
// 仓库根的 npm test / 质检 / 探针临时文件。
const WHITELIST = [
  'data/app',
  'data/scheduler-status.json',
  'data/scheduler-retry.json',
  'data/backfill-progress.json',
  'data/steam-429.json',
  'data/sonkwo-discovery.json',
  'data/proxy-health.json',
  'data/*.jsonl',
  'npmtest-*.log',
  'qa-*.log',
  'qa-*.js',
  'pf*.log',
];

const wildcardRe = (pattern) =>
  new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i');

// 命中项去重后按相对路径排序返回（§5：重复项去重后一次移走）。
function listHits() {
  const hits = new Map();
  for (const entry of WHITELIST) {
    const parts = entry.split('/');
    if (parts.length > 1) {
      // data/ 下的条目：只在该子目录里匹配文件名
      const dir = join(REPO_ROOT, parts.slice(0, -1).join('/'));
      if (!existsSync(dir)) continue;
      for (const name of readdirSync(dir)) {
        if (!wildcardRe(parts[parts.length - 1]).test(name)) continue;
        const abs = join(dir, name);
        if (hits.has(abs)) continue;
        hits.set(abs, { rel: relative(REPO_ROOT, abs).replace(/\\/g, '/'), abs, isDir: statSync(abs).isDirectory() });
      }
    } else {
      // 仓库根条目
      for (const name of readdirSync(REPO_ROOT)) {
        if (!wildcardRe(entry).test(name)) continue;
        const abs = join(REPO_ROOT, name);
        if (hits.has(abs)) continue;
        hits.set(abs, { rel: name, abs, isDir: statSync(abs).isDirectory() });
      }
    }
  }
  return [...hits.values()].sort((a, b) => a.rel.localeCompare(b.rel));
}

const pad2 = (n) => String(n).padStart(2, '0');
const timestamp = () => {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
};

// 同一次执行的目标目录只有一个；撞名就加 -1/-2 后缀（§5：备份按时间戳唯一命名）。
function uniqueTsDir() {
  const ts = timestamp();
  let dir = join(BAK_ROOT, ts);
  for (let n = 1; existsSync(dir); n += 1) dir = join(BAK_ROOT, `${ts}-${n}`);
  return dir;
}

// 同盘 rename；跨盘（EXDEV）退化为复制+删除。保留相对结构靠 dest 的路径本身。
function moveEntry(abs, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  try {
    renameSync(abs, dest);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    cpSync(abs, dest, { recursive: true, force: false });
    rmSync(abs, { recursive: true, force: true });
  }
}

function doDryRun() {
  const hits = listHits();
  if (!hits.length) {
    console.log('无命中项：白名单运行时产物都不存在，工作区已干净。');
    return 0;
  }
  console.log(`dry-run：将移走 ${hits.length} 项到 ${join(BAK_ROOT, timestamp())}\\（未执行；加 --apply 才动作）\n`);
  for (const h of hits) console.log(`  将移走：${h.rel}${h.isDir ? '/' : ''}`);
  console.log('\n清单外文件（skus.json/games.json/secret.key/*pgdata* 等）永不入选。');
  return 0;
}

function doApply() {
  const hits = listHits();
  if (!hits.length) {
    console.log('无命中项：白名单运行时产物都不存在，工作区已干净（幂等：重复执行不报错）。');
    return 0;
  }
  const destRoot = uniqueTsDir();
  mkdirSync(destRoot, { recursive: true });
  console.log(`--apply：把 ${hits.length} 项移到 ${destRoot}\\`);
  for (const h of hits) {
    moveEntry(h.abs, join(destRoot, h.rel));
    console.log(`  已移走：${h.rel}${h.isDir ? '/' : ''}`);
  }
  console.log(`\n完成：${hits.length} 项已备份。--restore ${basename(destRoot)} 可移回原位。`);
  return 0;
}

// 自底向上删除恢复后变空的层级目录；src 本身清空后也删除。
function removeEmptyDirs(dir) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      removeEmptyDirs(abs);
      if (readdirSync(abs).length === 0) rmSync(abs, { recursive: true, force: true });
    }
  }
}

function doRestore(src) {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else files.push(abs);
    }
  };
  walk(src);
  if (!files.length) {
    console.log(`备份目录 ${src} 为空，无需恢复；目录已清理。`);
    rmSync(src, { recursive: true, force: true });
    return 0;
  }
  console.log(`--restore ${basename(src)}：把 ${files.length} 个文件移回原位`);
  let restored = 0;
  let skipped = 0;
  for (const abs of files) {
    const rel = relative(src, abs).replace(/\\/g, '/');
    const target = resolve(REPO_ROOT, rel);
    if (!target.startsWith(REPO_ROOT + sep)) {
      console.error(`  拒绝恢复越界路径：${rel}`);
      skipped += 1;
      continue;
    }
    if (existsSync(target)) {
      console.log(`  已存在，跳过（不覆盖）：${rel}`);
      skipped += 1;
      continue;
    }
    moveEntry(abs, target);
    console.log(`  已移回：${rel}`);
    restored += 1;
  }
  removeEmptyDirs(src);
  if (readdirSync(src).length === 0) {
    rmSync(src, { recursive: true, force: true });
    console.log(`完成：恢复 ${restored} 个、跳过 ${skipped} 个；备份目录已清空并删除。`);
  } else {
    console.log(`完成：恢复 ${restored} 个、跳过 ${skipped} 个；仍有被跳过项留在备份目录（${src}）。`);
  }
  return 0;
}

function usage() {
  console.log([
    '测试环境复位（DI 批）：白名单精确移走运行时产物到仓库外备份目录。',
    '  node scripts/test-env-reset.mjs                dry-run（默认，只打印）',
    '  node scripts/test-env-reset.mjs --apply        执行移动',
    '  node scripts/test-env-reset.mjs --restore <时间戳>  移回原位',
  ].join('\n'));
  return 0;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) return usage();
  const restoreIdx = args.indexOf('--restore');
  if (restoreIdx >= 0) {
    const ts = args[restoreIdx + 1];
    if (!ts || !/^[\w.-]+$/.test(ts)) {
      console.error('用法：--restore <时间戳>（时间戳只能是字母/数字/._-）');
      return 1;
    }
    const src = resolve(BAK_ROOT, ts);
    if (!src.startsWith(resolve(BAK_ROOT) + sep) || !existsSync(src) || !statSync(src).isDirectory()) {
      console.error(`备份目录不存在：${src}`);
      return 1;
    }
    return doRestore(src);
  }
  return args.includes('--apply') ? doApply() : doDryRun();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = main();
}
