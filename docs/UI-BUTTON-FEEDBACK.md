# 按钮点击反馈规范（FQ，待开发，2026-11-25）

> 所有者要求（2026-11-25 后台截图）：所有「刷新」类按钮及类似操作按钮，点击后必须在前端给出**可见响应**；
> 不能点了没反应。范围：后台（同步与回填页优先，扩展到后台全部操作按钮）。

## 1. 现状（代码证据）

- 「内容分级统计」卡「刷新」按钮（AdminModules.vue:22）与最近设备/IP 黑名单/白名单/全站愿望单等「刷新」按钮：
  直接 `@click="loadXxx"`——**无 loading 态、无成功/失败提示**（数据静默刷新）；
- 「立即运行」（runGroup）、「立即同步 App」（syncAppNow）、「认领账号」（runSteamClaim）已有 ElMessage ✅；
- 后台其它模块（设置保存、批量操作等）反馈程度不一。

## 2. 规范（统一）

| 交互 | 要求 |
|---|---|
| 点击瞬间 | 按钮进入 **loading/禁用**（防连点）；持续时间 ≥ 200ms（避免闪烁） |
| 成功 | `ElMessage.success`（简短文案，如「已刷新」「已保存」「已启动」）；刷新类可只显示「已刷新」+ 时间戳微提示 |
| 失败 | `ElMessage.error`（已有 notifyError 统一）；错误文案可读 |
| 无变化 | 「已刷新（无变化）」或静默成功（刷新类必须有可见反馈） |
| 长任务 | 按钮禁用 + 「运行中」状态（同步页已有任务状态列） |

## 3. 实现

1. 新增 composable `useActionFeedback`（或复用现有 `run()`）：
   `const { loading, run } = useAction(() => api(...), { success: '已保存', refresh })`；
2. 后台 AdminModules 同步页所有按钮接入（刷新/立即运行/立即同步/认领/停止/恢复默认等）；
3. 其它后台页面（AdminSettings/AdminUsers/AdminAnnouncements 等）按同规范逐步接入；
4. 前端统一样式：按钮 loading 用 el-button `:loading`；无 el-button 的场景加禁用态。

## 4. 验收

1. 同步与回填页：点「刷新」（内容分级统计）、各刷新按钮 → 有 loading + 「已刷新」提示；
2. 「立即运行」「立即同步」「认领」「恢复默认」→ loading + 成功/失败提示（已有项回归不破坏）；
3. 连续快速点击不会重复请求（禁用/loading 生效）；
4. `npm run frontend:build` + `npm test`（相关）+ `scan` 全绿；截图（点击前后 + 提示）。
