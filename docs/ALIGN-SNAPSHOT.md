# 对齐审核快照落库（DL，质检通过）

> 状态：**质检通过（2026-11-19，QA docs/QA-DL.md 第 1 轮 ✅ 9/0/0/0；实现 1e49eeb）**——需求与方案已确认（2026-11-19 所有者），开发交付按本规格 §8 验收。
> 关联：[ALIGN-QUERY-PERF.md](ALIGN-QUERY-PERF.md)（CN 缓存/单飞）、[ALIGN-DB-SLOW.md](ALIGN-DB-SLOW.md)（CS 后台生成）、
> [ALIGN-INTEGRITY.md](ALIGN-INTEGRITY.md)（DH 继承/忽略/审阅）、[ALIGN-REVIEW-UI.md](ALIGN-REVIEW-UI.md)（DE 页改版）。

## 1. 已确认的决策（2026-11-19 所有者）

| # | 决策 |
|---|---|
| 1 | 对齐审核结果**落库**（快照表），不再依赖内存缓存与实时计算 |
| 2 | **动态检测数据变化**：签名变了才重算，否则一直用库里的快照（默认缓存） |
| 3 | 生成放**后台**（调度任务 + 后台触发），前台只读快照、不显示等待/进度；首次生成除外 |

## 2. 现状（代码证据）

- 缓存是**内存**的：`src/align-query.js` `createAlignRunner`（TTL 10 分钟、single-flight、invalidate），
  `server.js:674` `ALIGN_CACHE_TTL_MS = 10 * 60 * 1000` 硬编码；
- 服务重启 → 缓存清空 → 首次进入必然触发后台生成（202），前端轮询 3s 显示「生成中 0/0」；
- 计算本体 `computeAlignGroups` 返回 `{ items, inheritApplied, ignoredGroups, backfill }`（`src/align.js`）；
- 决定/映射已落库：`game_source_map`（decision/reviewed_by/reviewed_at），可作签名来源与一致性依据。

## 3. 数据模型

```sql
create table if not exists align_snapshots (
  id            bigserial primary key,
  payload       jsonb not null,        -- { items: [...], inheritApplied, ignoredGroups, backfill }
  counts        jsonb not null,        -- { groups, skus, auto, manual, noCandidate, inherited, ignored }
  signature     text  not null,        -- 数据签名（见 §4）
  generated_at  timestamptz not null default now(),
  generated_ms  int,
  error         text                   -- 最近一次生成失败原因（成功为 null）
);
create index if not exists idx_align_snapshots_gen on align_snapshots (generated_at desc);
```

- **当前快照** = `select ... order by generated_at desc limit 1`；
- 保留最近 **5** 条（`prune` 扩展删除更旧的），避免表膨胀；
- 迁移方式：`migrate()` 内 `create table if not exists`（老库升级幂等）。

## 4. 数据签名（动态失效判据）

```
signature = sha1(join '|' [
  'skus:'   + size(skus.json) + ':' + mtimeMs(skus.json),
  'games:'  + count(*) + ':' + max(updated_at)        -- games 表
  'gsm:'    + count(*) + ':' + max(coalesce(reviewed_at, created_at))  -- game_source_map
])
```

- 签名与最新快照相同 → **直接用库快照**（日志 `align.snapshot_fresh`，默认缓存）；
- 签名不同 → 后台重算并写新快照（日志 `align.snapshot_generated`）；
- **24h 强制重算兜底**（防漏检：如外部直接改库未更新 `updated_at`）。

## 5. 服务端

- **新调度任务 `align-snapshot`**（并入 `jobsFromEnv`）：`ALIGN_SNAPSHOT_ENABLED`（默认开）、
  `ALIGN_SNAPSHOT_INTERVAL_MIN`（默认 30）、`ALIGN_SNAPSHOT_INITIAL_DELAY_SEC`（默认 30）；
  每轮：算签名 → 比对最新快照 → 不同则重算写库；失败写 `error` 字段 + 日志 `align.snapshot_failed`（任务健康条可见）。
- `GET /api/admin/align`：**读最新快照**（分页在内存切片，参数 `page/pageSize` 不变）→
  `{ groups, total, counts, generatedAt, cached: true, dirty, refreshing }`；
  - 无快照（首次部署）→ `202 { generating: true, firstRun: true }` 并触发一次后台生成（single-flight）；
  - `?refresh=1` → 请求后台立即重算（**不阻塞**），返回当前快照 + `refreshing: true`；
  - **快照永远是「操作后有效队列」**（见下条），`dirty` 只表示后台将重算一致性，**不阻断返回**。
- **确认/忽略成功后立即同事务更新快照**（2026-11-19 追加，彻底解决「确认后要再审」）：
  从 `payload.items` 移除已处理的组（keys）、`counts` 相应递减、`dirty = true`、`last_action_at = now()` ——
  任何随后的读请求立刻拿到**不含已处理组**的队列，**不再经过「生成中 + 旧列表」**；
  后台重算完成后写新快照（覆盖），做一致性校验（日志差异）。
- **废弃现有内存语义**：不再需要 `alignRunner.invalidate()` 清缓存、也不再需要 `staleCache`（库快照即真相）；
  「生成中」只在**首次无快照**时出现，日常操作/读请求不再出现生成中进度。
- 观测：`align.snapshot_generated`（groups/counts/ms/signature）、`align.snapshot_fresh`、
  `align.snapshot_failed`（reason）、`align.snapshot_read`（stale/refreshing）。

## 6. 前端（AlignAdmin.vue）

- 进入页面：只读快照，**不再显示进度条/「生成中 0/0」**（首次生成除外：显示「首次生成中，完成后自动展示」）；
- **确认/忽略成功后立即本地移除已处理组并更新 counts**（乐观更新），再 `load()` 读快照（必为新队列）——
  不依赖「生成中轮询」刷新；操作后这几行必须**立刻消失**，不出现「要再审一遍」；
- 头部显示「上次生成于 HH:mm」+ 「刷新」按钮（触发后台重算，按钮短暂 loading）；
- 数据变化（签名变化被后台重算）时轻提示「数据已更新」，完成后静默刷新；
- 分页/搜索/筛选、确认/忽略交互不变（DE 批的 demo 布局保留）。

## 7. 补充约定（需求会话增补）

1. **首次部署兜底**：空表时后台任务 `initialDelaySec` 30 秒内生成；前台首次只显示「首次生成中」一次；
2. **生成失败可见**：快照 `error` 字段 + 任务健康条红标（A5 能力）；
3. **操作一致性**：确认/忽略后必须触发重算（否则快照残留已处理组）；
4. **prune**：保留最近 5 条快照；
5. **多实例**：读走库快照天然多实例安全；生成用 single-flight + 写库前比对签名避免重复写；
6. **兼容**：接口路径/参数/返回字段结构与既有语义保持（`202` 语义保留，仅 `firstRun` 新增）。

## 8. 验收

1. 部署重启后首次进入：有库快照 → 秒回（无「生成中」）；无快照 → 202 firstRun，后台生成后自动展示；
2. **确认 3 组后立即刷新页面 → 这 3 组立刻消失、counts 递减、不再出现「生成中」**（2026-11-19 追加，彻底解决）；
3. 签名不变时连续访问：`cached: true`、无重算（日志 `snapshot_fresh`）；
4. 数据变化（改 skus.json / games / game_source_map）→ 下一轮后台任务生成新快照（签名变化可观测）；
5. 确认/忽略后：快照同事务更新 + 触发后台重算；**操作后队列即刻正确**；
6. 24h 强制重算兜底生效（可用 env 缩短验证）；
7. 生成失败：快照 `error` 写入 + 任务健康可见；
8. prune 只保留最近 5 条；
9. `npm test`（分段）+ `npm run frontend:build` + `npm run scan` 全绿。
