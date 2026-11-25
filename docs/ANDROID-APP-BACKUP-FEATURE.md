# backup 改为后台功能（FR，待开发，2026-11-25 修订）

> 所有者要求（2026-11-25）：「backup 我要做成功能，不要走命令」——不再作为调度任务/CLI 命令自动跑，
> 改为**后台手动功能**（按钮 + 列表 + 下载/删除），默认不自动备份。

## 1. 现状

| 项 | 现状 |
|---|---|
| 调度任务 | `scheduler.js` 的 `backup` 任务（每天 1440min，`enabled: BACKUP_ENABLED !== '0'`）——**卡死源头（39 小时）** |
| CLI 命令 | `node src/cli.js backup`（ops.js cmdBackup） |
| 后台 API | ✅ 已有 `POST /api/admin/backup`（手动触发）+ `GET /api/admin/backups`（列表） |
| 后台 UI | ✅ 已有「统计 → 图片与备份」的备份卡片（创建 + 列表，`pagedBackups`）——用户可能没找到入口 |
| 设置项 | `system.backupEnabled`（默认 true） |

## 2. 需求（修订）

1. **移除调度任务**：`scheduler.js` 的 `backup` 任务从 jobs 列表移除（不再定时跑、不再走 CLI 命令）；
2. **保留并完善后台功能**（后台 → 统计 → 图片与备份）：
   - 「立即备份」按钮：二次确认 + loading + 成功提示（备份文件名）；
   - 备份列表：文件名/大小/时间 + **下载**按钮（`GET /api/admin/backups/:name` 或静态下载）+ **删除**按钮（保留最近 N 份自动清理，手动删除可选）；
   - 说明文案：手动备份，不自动；
3. **设置项**：`system.backupEnabled` 语义改为「允许后台手动备份」默认 **false**（关闭时隐藏/禁用备份按钮）；
4. **依赖 FP**：backup 导出改流式+超时（FP 的 P1）——本条目复用改进后的 `createBackup`。

## 3. 验收

1. 调度器任务列表**不再有 backup 行**（不再自动跑）；
2. 后台「图片与备份」可手动「立即备份」（确认→loading→成功提示），列表显示新文件；
3. 备份文件可**下载**、可**删除**（删除需确认）；
4. `system.backupEnabled=false` 时按钮禁用/隐藏（或提示「备份功能已关闭」）；
5. `npm test`（分段）+ `frontend:build` + `scan` 全绿；截图。
