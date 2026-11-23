// EV 批（docs/SCHEDULER-AS-SERVICE.md）：调度器独立进程化 + 一键安装/删除。
//
// 静态锁（本机无 Docker，真实 up/rm 由部署人员按 DELIVERY 验证）：
//   1. 五个 compose 变体全部「app=serve + 独立 scheduler 服务」（命令空、RUN_MODE=scheduler、
//      与 app 同镜像/同卷、restart unless-stopped）——发版重启 app 不打断任务；
//   2. scripts/scheduler-service.sh 三动作语义齐全：install 防双调度器 + 日志校验、
//      remove 一键清空（容器 + data/scheduler-*.json + 校验）、status 心跳与 heavy slot；
//   3. 脚本 LF 无 BOM（容器/服务器 bash 执行不炸）。
//
// 反向自检口径：把任一 compose 的 scheduler 服务删掉 → 第 1 组红；把 app.command 改回 all → 第 1 组红；
// 删掉脚本 install 里的 check_no_legacy_all 调用 → 第 2 组红；删 remove 的 rm -f scheduler-*.json → 第 2 组红。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const COMPOSE_FILES = ['compose.yaml', 'compose.hub.yaml', 'compose.cn.yaml', 'compose.hub.external-db.yaml', 'compose.cn.external-db.yaml'];
const WITH_DB = ['compose.yaml', 'compose.hub.yaml', 'compose.cn.yaml'];

test('EV-1：五个 compose 变体的 app 全部只跑 serve，且都有独立 scheduler 服务（同镜像/空命令/RUN_MODE=scheduler/同卷）', () => {
  for (const f of COMPOSE_FILES) {
    const doc = parse(read(f));
    assert.deepEqual(doc.services.app.command, ['serve'], `${f}: app 必须只跑 Web/API（不再 all）`);
    const sched = doc.services.scheduler;
    assert.ok(sched, `${f}: 缺少 scheduler 服务`);
    assert.deepEqual(sched.command, [], `${f}: scheduler command 必须为空（entrypoint 按 RUN_MODE 启动）`);
    assert.equal(sched.environment?.RUN_MODE, 'scheduler', `${f}: scheduler 显式 RUN_MODE=scheduler`);
    assert.equal(sched.restart, 'unless-stopped', `${f}: scheduler 需要重启策略`);
    assert.equal(sched.image, doc.services.app.image, `${f}: scheduler 与 app 同镜像`);
    assert.equal(sched.ports, undefined, `${f}: scheduler 不暴露端口`);
    // 与 app 挂同一份 data/logs：后台「同步与回填」状态文件、日志页同源
    assert.deepEqual(sched.volumes, doc.services.app.volumes, `${f}: scheduler 必须与 app 共享 data/logs 卷`);
    assert.equal(sched.environment?.DATABASE_URL, doc.services.app.environment?.DATABASE_URL, `${f}: scheduler 与 app 连同一个库`);
    // EU-5 排空：docker stop 时给调度器留 10 分钟等在跑任务自然完成（配合 SCHEDULER_DRAIN_TIMEOUT_MS）
    assert.equal(sched.stop_grace_period, '10m', `${f}: scheduler 需要 stop_grace_period 10m（排空窗口）`);
  }
});

test('EV-1：带 db 的变体 scheduler depends_on db；外部库变体没有 db 依赖', () => {
  for (const f of WITH_DB) {
    const doc = parse(read(f));
    assert.ok(doc.services.scheduler.depends_on?.db, `${f}: scheduler 应等 db 就绪`);
  }
  for (const f of ['compose.hub.external-db.yaml', 'compose.cn.external-db.yaml']) {
    const doc = parse(read(f));
    assert.equal(doc.services.scheduler.depends_on, undefined, `${f}: 外部库模式没有 db 可依赖`);
  }
});

test('EV-2 install：防双调度器检查 + up -d scheduler + 校验 scheduler.start 日志', () => {
  const sh = read('scripts/scheduler-service.sh');
  assert.match(sh, /case "\$\{1:-\}" in/, '支持 install/remove/status 三个子命令');
  assert.match(sh, /install\) install/, 'install 分发');
  assert.match(sh, /remove\) remove/, 'remove 分发');
  assert.match(sh, /status\) status/, 'status 分发');
  // 防双调度器：app 容器 command 含 all → 拒绝安装
  assert.match(sh, /check_no_legacy_all/, 'install 前必须做防双调度器检查');
  assert.match(sh, /docker inspect -f '\{\{\.Config\.Cmd\}\}'/, '检查 app 容器的实际 command');
  assert.match(sh, /\*"all"\*\)/, 'app 仍在跑 all 时拦截');
  assert.match(sh, /command: \[\\"serve\\"\]/, '错误提示给出修改方向（serve）');
  assert.match(sh, /fail\(/, '拒绝安装必须非零退出');
  // 启动 + 日志校验
  assert.match(sh, /compose up -d "\$SVC"/, 'install 启动 scheduler');
  assert.match(sh, /scheduler\.start/, '校验 scheduler.start 启动日志');
  assert.match(sh, /seq 1 30/, '日志校验有超时（90 秒）');
  assert.match(sh, /return 1/, '校验超时非零退出');
});

test('EV-2 remove：一键删除——停容器 + rm 容器 + 清 data/scheduler-*.json + 校验无残留', () => {
  const sh = read('scripts/scheduler-service.sh');
  assert.match(sh, /compose stop "\$SVC"/, 'remove 先停容器');
  assert.match(sh, /compose rm -f "\$SVC"/, 'remove 再删容器');
  assert.match(sh, /rm -f "\$DATA_DIR"\/scheduler-status\.json/, '删除 scheduler-status.json');
  assert.match(sh, /scheduler-retry\.json/, '删除 retry 状态');
  assert.match(sh, /scheduler-resume\.json/, '删除断点状态');
  assert.match(sh, /scheduler-lastrun\.json/, '兼容删除旧 lastrun 状态');
  assert.match(sh, /scheduler_container_id\)" \]; then\s*\n\s*fail/, '删除后校验容器不存在（否则失败）');
  // 删除只清调度状态，不碰业务数据
  assert.match(sh, /业务数据.*不动/, '明确只删调度状态、不动数据库');
});

test('EV-2 status：容器状态 + 最近心跳（updatedAt）+ 当前 heavy slot 任务', () => {
  const sh = read('scripts/scheduler-service.sh');
  assert.match(sh, /compose ps "\$SVC"/, 'status 显示容器状态');
  assert.match(sh, /updatedAt/, 'status 读状态文件心跳');
  assert.match(sh, /秒前/, 'status 显示心跳距今时长');
  assert.match(sh, /"running": true/, 'status 读当前运行任务');
  assert.match(sh, /HEAVY_JOBS=/, 'status 判断 heavy slot');
  assert.match(sh, /steam-prices\|rename\|backfill\|rating-backfill\|heat\|steam-status\|steam-discovery\|catalog/, 'heavy 名单与 src/scheduler.js STEAM_HEAVY 一致');
  assert.match(sh, /STEAM_HEAVY 保持同步/, 'heavy 名单注明与 scheduler.js 同步');
});

test('EV-2：脚本 LF 无 BOM（Windows 编辑导致 CRLF/BOM 会执行失败）', () => {
  const buf = readFileSync(new URL('../scripts/scheduler-service.sh', import.meta.url));
  assert.notEqual(buf[0], 0xef, '不能有 UTF-8 BOM');
  const crlf = [...buf].some((b, i, arr) => b === 0x0a && arr[i - 1] === 0x0d);
  assert.equal(crlf, false, '不能出现 CRLF');
});

test('EV-4：发布冒烟仍走 all 命令（CI 冒烟验证 Web/API 进程，与 app 容器 serve 不冲突）', () => {
  const wf = read('.github/workflows/docker-hub.yml');
  assert.match(wf, /steamdeals:ci all/, 'CI 冒烟保持 all（命令仍存在于 CLI，容器内 app 才用 serve）');
});

test('EV-2 场景驱动：mock docker 下真实执行 install/remove/status（防双调度器/幂等/清空/心跳）', { skip: findBash() ? false : '本机与 CI 均无 bash，跳过脚本实跑（静态锁已覆盖语义）' }, () => {
  const bash = findBash();
  const scenario = fileURLToPath(new URL('../test/fixtures/run-scheduler-service-scenarios.sh', import.meta.url));
  const r = spawnSync(bash, [scenario], { encoding: 'utf8', timeout: 120_000 });
  assert.equal(r.status, 0, `场景脚本非零退出（exit ${r.status}）：\n${r.stdout}\n${r.stderr}`);
  for (const expect of [
    'PASS install', 'PASS idempotent', 'PASS no-dup-guard', 'PASS status-heartbeat', 'PASS status-heavy',
    'PASS remove', 'PASS files-cleared', 'PASS container-gone',
  ]) {
    assert.match(r.stdout, new RegExp(expect), `场景缺少 ${expect}：\n${r.stdout}`);
  }
});

/** 探测可用的 bash（Git Bash / 系统 bash）；找不到返回 null。 */
function findBash() {
  const candidates =
    process.platform === 'win32'
      ? ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files\\Git\\usr\\bin\\bash.exe']
      : ['/bin/bash', '/usr/bin/bash'];
  for (const p of candidates) if (existsSync(p)) return p;
  // PATH 里也可能有
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['bash'], { encoding: 'utf8' });
  const found = (probe.stdout ?? '').split(/\r?\n/).find((l) => l && existsSync(l.trim()));
  return found ? found.trim() : null;
}
