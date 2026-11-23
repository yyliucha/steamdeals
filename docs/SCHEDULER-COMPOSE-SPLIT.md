# 调度器 compose 文件级拆分（FC，已确认待开发，2026-11-23）

> 状态：**需求与方案已确认（2026-11-23 所有者拍板），待开发**。
> 关联：[SCHEDULER-AS-SERVICE.md](SCHEDULER-AS-SERVICE.md)（EV 批：调度器独立进程化，本条目在其上做文件级隔离）、
> [DELIVERY.md](DELIVERY.md)（部署与发版流程）。
> 背景：EV 批后 app 与 scheduler 在同一个 compose 文件里，发版 `pull && up -d`（不带服务名）会同时重建
> app 与 scheduler 两个容器——每次发版都动到调度器。本条目把两个服务的 **compose 文件与发布命令拆开**：
> 业务不剥离（同镜像、同 data/logs、同数据库），只剥离文件与命令。

## 1. 已确认的决策

| # | 决策（所有者 2026-11-23 确认） |
|---|---|
| 1 | **文件级隔离**：生产变体 `compose.hub.yaml` 里的 scheduler 服务拆出 → 新文件 `compose.scheduler.hub.yaml`（独立项目 `name: steamdeals-scheduler`） |
| 2 | **只拆生产变体一份**（B1 档）；其余 4 个变体（compose.yaml / compose.cn.yaml / compose.hub.external-db.yaml / compose.cn.external-db.yaml）保持现状，用到哪份再拆哪份 |
| 3 | **业务不剥离**：app 与 scheduler 仍同镜像（`s1065420329/steamdeals:latest`）、挂同一份 `./logs` 与 `./data`、连同一个库；scheduler 不暴露端口 |
| 4 | **发布命令两套、互不牵连**：app 发版只动 app 文件；scheduler 升级/回滚只动 scheduler 文件；调度器代码不变时发版不重建 scheduler 容器 |
| 5 | **网络**：scheduler 项目声明 `external: true, name: steamdeals_default`（app 项目的默认网络），经该网络用 `db` 网络别名连库；**启动顺序先 app 项目、后 scheduler 项目**（文档写死） |
| 6 | 跨项目无法 `depends_on db`：去掉该字段，靠应用层 `DB_WAIT_SEC=60` 等库重试 + 启动顺序兜底 |
| 7 | **脚本**：`scripts/scheduler-service.sh` 拆两个 compose 上下文——`COMPOSE_FILES`（查 app、防双调度器）与新增 `SCHEDULER_COMPOSE_FILES`（默认 `-f compose.scheduler.hub.yaml`，up/stop/rm/ps/logs 全部走它），保留环境变量覆盖（服务器文件名不同时传入） |
| 8 | **文档同步（所有者特别要求）**：DEPLOY.md 新增「**命令与文件归属**」表——以后要调整哪一部分，直接照表找文件与命令；DELIVERY.md 部署提示、README 部署能力表 EV 行同步更新 |
| 9 | env 仍**双份一致**：app 文件与 scheduler 文件各一份 environment 列表，新增采集/告警环境变量必须**两处同步**（归属表写明，防止只改一处） |

## 2. 现状（证据）

- `compose.hub.yaml` 一个文件三个服务：db / app（`command: ["serve"]`）/ scheduler（`command: []`，
  `RUN_MODE=scheduler`、`stop_grace_period: 10m`、与 app 同镜像同卷同库）——见 compose.hub.yaml。
- 发版命令（docs/DEPLOY.md）：`docker compose -f compose.hub.yaml pull app && docker compose -f compose.hub.yaml up -d`——
  `up -d` 不带服务名 → 镜像 tag 变化时 app 与 scheduler **都重建**（痛点）。
- 脚本 `scripts/scheduler-service.sh`（146 行）：单一 `COMPOSE_FILES` 上下文，install/remove/status 全走它。
- 测试 `test/scheduler-service.test.js`（133 行）五个 compose 变体静态锁 + 脚本语义锁 + mock docker 场景实跑；
  `test/deploy.test.js` EV 段断言 compose.yaml 的 scheduler 服务。

## 3. 拆分方案（compose 文件）

### 3.1 新文件 `compose.scheduler.hub.yaml`（约 60 行）

- `name: steamdeals-scheduler`（独立项目，与 app 项目互不干扰）；
- 仅 `scheduler` 一个服务：image / restart / command / stop_grace_period / environment 全套 / volumes
  全部照搬自 `compose.hub.yaml` 的 scheduler 定义（**删掉 `depends_on.db`**，见决策 6）；
- `networks: default: { external: true, name: steamdeals_default }`；
- 文件头注释写清：本文件只管定时服务；启动前必须已 `up` 过 app 项目（网络与 db 由它提供）；
  回滚/升级只动本文件与 `docker compose -f compose.scheduler.hub.yaml` 命令。

### 3.2 改 `compose.hub.yaml`

- 删除 scheduler 服务整段；文件头注释补一句「定时服务见 compose.scheduler.hub.yaml」。
- 其余 4 个变体**不动**。

### 3.3 网络与启动顺序

- app 项目（`name: steamdeals`）up 时创建默认网络 `steamdeals_default`，db 容器注册服务名别名 `db`；
- scheduler 项目加入该 external 网络后，`db:5432` 可解析；
- 首次部署/全部重建时：`docker compose -f compose.hub.yaml up -d` **先**，
  再 `docker compose -f compose.scheduler.hub.yaml up -d`；
- scheduler 自身 `DB_WAIT_SEC=60` 在库未就绪时重试，顺序错也不致命（文档仍写死顺序）。

## 4. 脚本改动（scripts/scheduler-service.sh）

- 新增变量：`SCHEDULER_COMPOSE_FILES="${SCHEDULER_COMPOSE_FILES:--f compose.scheduler.hub.yaml}"`；
- 新增 `compose_scheduler()` 函数（`docker compose $SCHEDULER_COMPOSE_FILES "$@"`）；
- 调用点替换：install 的 `up -d`、remove 的 `stop`/`rm`、status 的 `ps`、启动日志提示 → `compose_scheduler`；
  `app_container_id` 与 `check_no_legacy_all` 继续用原 `compose`（app 文件）；
- 帮助注释更新：两个 compose 上下文的用途与默认值。

## 5. 命令与文件归属表（落地到 docs/DEPLOY.md，开发会话复制）

| 要调整什么 | 改哪个文件 | 命令 |
|---|---|---|
| 站点（app）发版 | compose.hub.yaml | `docker compose -f compose.hub.yaml pull app && docker compose -f compose.hub.yaml up -d app` |
| 站点（app）回滚 | compose.hub.yaml（image tag 改旧版本） | 同上（或整文件 up） |
| 定时服务（scheduler）升级/回滚 | compose.scheduler.hub.yaml | `docker compose -f compose.scheduler.hub.yaml pull && docker compose -f compose.scheduler.hub.yaml up -d` |
| 调度服务安装/删除/状态 | scripts/scheduler-service.sh（`SCHEDULER_COMPOSE_FILES` 默认已指 scheduler 文件） | `./scripts/scheduler-service.sh install \| remove \| status` |
| 新增采集/告警环境变量 | compose.hub.yaml（app env）**和** compose.scheduler.hub.yaml（scheduler env）**两处同步** | — |
| 首次全量重建顺序 | 先 app 后 scheduler | 见 §3.3 |

## 6. 验收

1. `compose.hub.yaml` 不再有 scheduler 服务；`compose.scheduler.hub.yaml` 定义齐全且与拆分前一致：
   同镜像 / `command: []` / `RUN_MODE=scheduler` / `restart: unless-stopped` / `stop_grace_period: 10m` /
   无 ports / volumes 与 app 相同 / DATABASE_URL 相同 / `external: true, name: steamdeals_default` / 无 depends_on；
2. 其余 4 个 compose 变体保持原状（静态锁仍断言它们有 scheduler 服务，防误删）；
3. `scripts/scheduler-service.sh`：`SCHEDULER_COMPOSE_FILES` 默认 `-f compose.scheduler.hub.yaml` 可被环境变量覆盖；
   install/remove/status 的 up/stop/rm/ps/logs 全部走 scheduler 上下文；防双调度器与 app 查询仍走原上下文；LF 无 BOM；
4. 测试：`test/scheduler-service.test.js` 静态锁与脚本语义锁随拆分更新（含反向自检：改错 external 网络名 /
   把 up 改回原上下文 → 红）；`test/deploy.test.js` EV 段断言改指新文件；mock docker 场景实跑通过（本机有 bash 时）；
   `node test/docs.test.js` 断链绿；
5. 不涉及 src/frontend/web 业务代码、无 schema 变更、无新增依赖；`npm run scan` 通过；
6. 文档落地：docs/DEPLOY.md 两套命令 + §5 归属表 + 启动顺序；docs/DELIVERY.md 部署提示更新；
   README 部署能力表 EV 行补「compose 文件级拆分」一句；本规格状态随发版改「已实现并发布」；
7. 部署侧验证清单（服务器实跑，写进 DELIVERY）：app 发版命令执行后 **scheduler 容器未重建**（`docker ps` 的
   scheduler Created 时间不变、`scheduler.start` 无新日志）；scheduler 命令独立重建后任务表正常心跳；
8. 回滚演练：scheduler 文件 image tag 改旧版本 → up -d 后容器回到旧镜像，app 不受影响。

## 7. 实施顺序

1. 新增 compose.scheduler.hub.yaml + 删 compose.hub.yaml 的 scheduler 段（同一 commit）；
2. 改 scripts/scheduler-service.sh（双上下文）；
3. 更新 test/scheduler-service.test.js、test/deploy.test.js 与 mock 场景，跑绿；
4. 文档落地（DEPLOY/DELIVERY/README/本规格状态词），docs.test.js 校验；
5. 提交推 main → steamdeals-qa 质检（报告 docs/QA-FC.md）。

## 8. 待确认问题

- 无（服务器实际 compose 文件名差异由 `SCHEDULER_COMPOSE_FILES` / 显式 `-f` 覆盖，已内置兜底）。
