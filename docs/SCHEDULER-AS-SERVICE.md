# 调度器独立进程化 + 一键安装/删除（EV，待开发，2026-11-23）

> 所有者要求（2026-11-23）：「这些服务能写到服务器上吗？不要和系统重合在一起……
> 写入也要删除，需要提供一个命令可以一键删除所有任务。」

## 1. 现状

- 生产 compose：`command: ["all"]` → 一个容器里同时跑 **Web/API + 调度器**（一体化，`src/cli.js all`）；
- 已有独立调度器入口：entrypoint 无参数时按 `RUN_MODE`（默认 `scheduler`）→ `node src/scheduler.js`；
- 问题：发版重启 app 会**连带重启/打断调度任务**（2026-11-23 steam-prices 被重启打断 → exit -1 误报，见 EU）。

## 2. 目标

1. **调度器独立成服务器上的独立服务**（独立容器/进程），与 app 不重合：
   - app 只跑 Web/API；scheduler 独立跑 `src/scheduler.js`；
   - 发版重启 app **不影响**调度任务；
2. **一键安装/删除**：
   - `scripts/scheduler-service.sh install`：生成独立 service（compose override 或 systemd unit）并启动；
   - `scripts/scheduler-service.sh remove`：**一键删除所有任务**（停 scheduler + 删配置/状态）；
   - `status`：查看调度服务与任务状态；
3. 防止双调度器：切换时确保旧 app 不再跑 `all`（否则两个调度器重复执行任务）。

## 3. 方案（推荐：docker compose 独立 service + 管理脚本）

### 3.1 拆分
- `compose.*.yaml`：app 改 `command: ["serve"]`（只 Web/API）；
- 新增 `compose.scheduler.yaml`（override，或直接写进主 compose 的 `scheduler` service）：
  ```yaml
  services:
    scheduler:
      image: 同 app 镜像
      command: []            # 无参数 → RUN_MODE=scheduler → node src/scheduler.js
      environment: { RUN_MODE: scheduler, DATABASE_URL: ... }
      depends_on: [db]
      restart: unless-stopped
  ```
- `docker compose -f compose.hub.yaml -f compose.scheduler.yaml up -d`（或主 compose 直接加 service）。

### 3.2 一键脚本 `scripts/scheduler-service.sh`
- `install`：检查/生成 scheduler service → `up -d scheduler` → 校验 `scheduler.start` 日志；
- `remove`：**一键删除所有任务**——`stop scheduler` → `rm` 容器 → 删除生成的 override 文件/状态文件
  （`data/scheduler-lastrun.json`、`data/scheduler-retry.json` 等）→ 校验不再有调度器进程；
- `status`：容器状态 + 最近心跳 + heavy slot 当前任务。

### 3.3 发版流程
- DELIVERY/部署文档：**发版只重启 app（web），不重启 scheduler**；需要更新调度器代码时单独 `restart scheduler`；
- 与 EU 配合：app 重启不再打断任务。

## 4. 验收

1. `install` 后：app 容器只跑 Web/API（无 scheduler 日志），scheduler 容器独立跑任务；
2. 重启 app（`docker compose restart app`）→ 正在跑的任务**不中断**（scheduler 独立）；
3. `remove` 一键：scheduler 停止、容器删除、配置/状态清理、不再有任务执行；
4. 无双调度器（切换后 `scheduler.start` 只出现在 scheduler 容器）；
5. `npm test`（分段）+ `scan` 全绿；文档（DELIVERY/README）含安装/删除/发版避让说明。

## 5. 边界

- 不改变任务定义与调度频率（仍由 src/scheduler.js 管理）；
- 不做 systemd timer 拆分（任务互斥/健康/429 冷却依赖调度器进程内状态，独立 timer 会破坏）；
- 一键删除只删「调度服务/任务状态」，不删业务数据（DB 不动）。
