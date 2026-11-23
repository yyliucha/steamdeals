// EV 批（docs/SCHEDULER-AS-SERVICE.md）：调度器独立进程化 + 一键安装/删除。
// FC 批（docs/SCHEDULER-COMPOSE-SPLIT.md）：compose 文件级拆分——生产变体 app/scheduler 分文件发布。
//
// 静态锁（本机无 Docker，真实 up/rm 由部署人员按 DELIVERY 验证）：
//   1. FC：compose.hub.yaml 不再有 scheduler（只 db+app）；其余 4 个变体保持原状——
//      全部「app=serve + 独立 scheduler 服务」（命令空、RUN_MODE=scheduler、与 app 同镜像/同卷、
//      restart unless-stopped、stop_grace_period 10m）；
//   2. FC：compose.scheduler.hub.yaml 定义齐全且与拆分前一致（独立项目名 / 同镜像 / 空命令 /
//      RUN_MODE=scheduler / restart / 10m 排空 / 无 ports / 与 app 同卷同 DATABASE_URL /
//      external 网络 steamdeals_default + external 卷指向 app 项目 / 无 depends_on）；
//   3. FC：scripts/scheduler-service.sh 拆两个 compose 上下文——SCHEDULER_COMPOSE_FILES 默认
//      -f compose.scheduler.hub.yaml 可被环境变量覆盖；install/remove/status 的 up/stop/rm/ps/logs
//      全部走 scheduler 上下文；防双调度器（app 查询）仍走 app 上下文；
//   4. EV-2 原语义锁：install 防双调度器 + 日志校验、remove 一键清空、status 心跳与 heavy slot；
//   5. 脚本 LF 无 BOM（容器/服务器 bash 执行不炸）。
//
// 反向自检口径：把 compose.scheduler.hub.yaml 的 external 网络名改成别的 → 第 2 组红；
// 把 external 卷名指向别的项目 → 第 2 组红；把脚本 install 的 up 改回 compose（app 上下文）→ 第 3 组红；
// 把 app_container_id 改成 compose_scheduler（防双调度器查错文件）→ 第 3 组红；
// 删掉其余 4 个变体任一 scheduler 服务 → 第 1 组红；删 remove 的 rm -f scheduler-*.json → 第 4 组红。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// FC 拆分后：compose.hub.yaml 只留 db+app；其余 4 个变体保持「app=serve + 独立 scheduler」
const OTHER_COMPOSE = ['compose.yaml', 'compose.cn.yaml', 'compose.hub.external-db.yaml', 'compose.cn.external-db.yaml'];
const WITH_DB = ['compose.yaml', 'compose.cn.yaml'];
const HUB = 'compose.hub.yaml';
const SPLIT = 'compose.scheduler.hub.yaml';

test('EV-1：其余 4 个变体保持原状——app 全部只跑 serve，且都有独立 scheduler 服务（同镜像/空命令/RUN_MODE=scheduler/同卷）', () => {
  for (const f of OTHER_COMPOSE) {
    const doc = parse(read(f));
    assert.deepEqual(doc.services.app.command, ['serve'], `${f}: app 必须只跑 Web/API（不再 all）`);
    const sched = doc.services.scheduler;
    assert.ok(sched, `${f}: 缺少 scheduler 服务（FC 批只拆生产变体，其余变体不动）`);
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

test('FC-1：compose.hub.yaml 不再有 scheduler 服务（只 db + app，app 仍只 serve）', () => {
  const doc = parse(read(HUB));
  assert.equal(doc.services.scheduler, undefined, 'compose.hub.yaml 必须不再定义 scheduler（FC 批拆出）');
  assert.ok(doc.services.db, 'db 服务保留');
  assert.ok(doc.services.app, 'app 服务保留');
  assert.deepEqual(doc.services.app.command, ['serve'], 'app 仍只跑 Web/API');
  assert.equal(doc.name, 'steamdeals', 'app 项目名不变（scheduler 经 external 网络挂到它）');
});

test('FC-1：compose.scheduler.hub.yaml 定义齐全且与拆分前一致（独立项目/同镜像/无 depends_on/external 网络与卷）', () => {
  const split = parse(read(SPLIT));
  const hub = parse(read(HUB));
  // 独立项目：与 app 项目互不干扰
  assert.equal(split.name, 'steamdeals-scheduler', 'scheduler 必须是独立 compose 项目名');
  const sched = split.services.scheduler;
  assert.ok(sched, '必须定义 scheduler 服务');
  assert.deepEqual(Object.keys(split.services), ['scheduler'], '只允许 scheduler 一个服务（db/app 归 app 项目）');
  // 与拆分前 compose.hub.yaml 的 scheduler 定义一致（逐项对照）
  assert.equal(sched.image, hub.services.app.image, '与 app 同镜像（拆分前一致）');
  assert.deepEqual(sched.command, [], 'command 必须为空（entrypoint 按 RUN_MODE 启动）');
  assert.equal(sched.environment.RUN_MODE, 'scheduler', '显式 RUN_MODE=scheduler');
  assert.equal(sched.environment.DATABASE_URL, hub.services.app.environment.DATABASE_URL, '与 app 连同一个库（经 external 网络 db 别名）');
  assert.equal(sched.restart, 'unless-stopped', '需要重启策略');
  assert.equal(sched.ports, undefined, 'scheduler 不暴露端口');
  assert.deepEqual(sched.volumes, hub.services.app.volumes, '与 app 挂同一份 data/logs 卷');
  assert.equal(sched.stop_grace_period, '10m', 'stop_grace_period 10m（排空窗口）');
  assert.equal(sched.depends_on, undefined, '跨项目无法 depends_on db（决策 6），靠 DB_WAIT_SEC 重试 + 启动顺序兜底');
  // 网络：加入 app 项目的默认网络，用 db 网络别名连库
  assert.equal(split.networks?.default?.external, true, 'default 网络必须声明 external');
  assert.equal(split.networks?.default?.name, 'steamdeals_default', '必须指向 app 项目（name: steamdeals）的默认网络');
  // 卷：指向 app 项目的命名卷（状态文件与日志页同源；由 app 项目先 up 创建）
  assert.equal(split.volumes?.appdata?.external, true, 'appdata 卷必须 external（复用 app 项目卷）');
  assert.equal(split.volumes?.appdata?.name, 'steamdeals_appdata', 'appdata 卷名必须指向 app 项目');
  assert.equal(split.volumes?.logs?.external, true, 'logs 卷必须 external（复用 app 项目卷）');
  assert.equal(split.volumes?.logs?.name, 'steamdeals_logs', 'logs 卷名必须指向 app 项目');
});

test('EV-1：带 db 的其余变体 scheduler depends_on db；外部库变体没有 db 依赖', () => {
  for (const f of WITH_DB) {
    const doc = parse(read(f));
    assert.ok(doc.services.scheduler.depends_on?.db, `${f}: scheduler 应等 db 就绪`);
  }
  for (const f of ['compose.hub.external-db.yaml', 'compose.cn.external-db.yaml']) {
    const doc = parse(read(f));
    assert.equal(doc.services.scheduler.depends_on, undefined, `${f}: 外部库模式没有 db 可依赖`);
  }
});

test('FC-2：脚本拆两个 compose 上下文——SCHEDULER_COMPOSE_FILES 默认 scheduler 文件、可被环境变量覆盖', () => {
  const sh = read('scripts/scheduler-service.sh');
  assert.match(sh, /SCHEDULER_COMPOSE_FILES="\$\{SCHEDULER_COMPOSE_FILES:--f compose\.scheduler\.hub\.yaml\}"/, '默认 -f compose.scheduler.hub.yaml');
  assert.match(sh, /:-\s*-f/, '环境变量覆盖语义（空则回退默认）');
  assert.match(sh, /compose_scheduler\(\) \{ docker compose \$SCHEDULER_COMPOSE_FILES "\$@"; \}/, 'scheduler 上下文函数拼 SCHEDULER_COMPOSE_FILES');
  // app 上下文保留：仅查 app（防双调度器），不操作调度服务
  assert.match(sh, /compose\(\) \{ docker compose \$COMPOSE_FILES "\$@"; \}/, 'app 上下文函数拼 COMPOSE_FILES');
  assert.match(sh, /app_container_id\(\) \{ compose ps -q app/, '防双调度器的 app 查询走 app 上下文');
});

test('FC-2：install/remove/status 的 up/stop/rm/ps/logs 全部走 scheduler 上下文', () => {
  const sh = read('scripts/scheduler-service.sh');
  assert.match(sh, /compose_scheduler up -d "\$SVC"/, 'install 的 up 走 scheduler 上下文');
  assert.match(sh, /compose_scheduler stop "\$SVC"/, 'remove 的 stop 走 scheduler 上下文');
  assert.match(sh, /compose_scheduler rm -f "\$SVC"/, 'remove 的 rm 走 scheduler 上下文');
  assert.match(sh, /compose_scheduler ps "\$SVC"/, 'status 的 ps 走 scheduler 上下文');
  assert.match(sh, /scheduler_container_id\(\) \{ compose_scheduler ps -q "\$SVC"/, 'scheduler 容器查询走 scheduler 上下文（容器在 scheduler 项目里）');
  assert.match(sh, /docker compose \$SCHEDULER_COMPOSE_FILES logs scheduler/, '启动日志排查提示走 scheduler 上下文');
  // 防双调度器与 app 查询仍走 app 上下文（反向：app_container_id 若改 compose_scheduler 即红）
  assert.match(sh, /compose ps -q app/, 'app 容器查询必须仍是 app 上下文');
  assert.doesNotMatch(sh, /compose_scheduler ps -q app/, 'app 容器查询不得走 scheduler 上下文');
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
  assert.match(sh, /up -d "\$SVC"/, 'install 启动 scheduler');
  assert.match(sh, /scheduler\.start/, '校验 scheduler.start 启动日志');
  assert.match(sh, /seq 1 30/, '日志校验有超时（90 秒）');
  assert.match(sh, /return 1/, '校验超时非零退出');
});

test('EV-2 remove：一键删除——停容器 + rm 容器 + 清 data/scheduler-*.json + 校验无残留', () => {
  const sh = read('scripts/scheduler-service.sh');
  assert.match(sh, /stop "\$SVC"/, 'remove 先停容器');
  assert.match(sh, /rm -f "\$SVC"/, 'remove 再删容器');
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
  assert.match(sh, /ps "\$SVC"/, 'status 显示容器状态');
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

test('EV-2/FC-2 场景驱动：mock docker 下真实执行 install/remove/status（防双调度器/双上下文/幂等/清空/心跳）', { skip: findBash() ? false : '本机与 CI 均无 bash，跳过脚本实跑（静态锁已覆盖语义）' }, () => {
  const bash = findBash();
  const scenario = fileURLToPath(new URL('../test/fixtures/run-scheduler-service-scenarios.sh', import.meta.url));
  const r = spawnSync(bash, [scenario], { encoding: 'utf8', timeout: 120_000 });
  assert.equal(r.status, 0, `场景脚本非零退出（exit ${r.status}）：\n${r.stdout}\n${r.stderr}`);
  for (const expect of [
    'PASS install', 'PASS up-scheduler-context', 'PASS app-check-app-context', 'PASS sched-check-scheduler-context',
    'PASS idempotent', 'PASS no-dup-guard', 'PASS status-heartbeat', 'PASS status-heavy',
    'PASS remove', 'PASS stop-rm-scheduler-context', 'PASS files-cleared', 'PASS container-gone',
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
