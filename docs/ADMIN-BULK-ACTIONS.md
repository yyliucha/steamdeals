# 后台列表批量操作（多选 + 批量执行）

> 状态：**已实现并发布（v1.14.0，2026-11-03）**——代码与测试已进主链，tag `v1.14.0` 已推送触发镜像构建。
> 关联：[PROJECT-OVERVIEW.md](PROJECT-OVERVIEW.md)（功能与代码落点）、[WEB.md](WEB.md)（后台模块）、
> [ADMIN-PARITY.md](ADMIN-PARITY.md)（后台功能对齐的前一批改动）、[TODO.md](TODO.md)（待办条目）。
>
> 起因：后台所有可操作的列表目前只能逐行点，缺少多选批量；所有者确认「A+B 两组列表都要」。
> 实现落点与实际偏差见 §11。

## 1. 需求与已确认的决策

| # | 决策 |
|---|---|
| 1 | 范围 **A + B**：A = 安全处置与内容维护类 8 个列表；B = 游戏目录 / 最近设备 / 用户列表 3 个列表（共 11 个，见 §2） |
| 2 | 实现方式：**后端新增批量接口**（一次请求、逐条回执、统一限流与审计），不做"前端循环调单条" |
| 3 | 选择方式：常规列表**只支持本页勾选**（翻页清空）；**回收站**额外支持「按当前筛选全选」（≤1000 条） |
| 4 | 高危动作需要限制：单次上限 + 二次确认（见 §3.3） |
| 5 | 用户列表的批量动作**只有禁用/启用**（不做批量重置密码、批量改邮箱、批量改角色） |
| 6 | 需要「批量操作记录」页（审计：谁、什么时候、对哪个列表、做了什么、成功/失败多少） |

## 2. 范围：11 个列表 × 批量动作

现状核对（2026-11-03）：后台 15 个列表里，**0 个有多选**（`frontend/src/pages/*.vue` 无 `type="selection"`），
**0 个批量接口**（`src/server.js` 的 `/api/admin/*` 全部单条）。以下 11 个纳入，其余 4 个明确不做。

| # | 菜单 → 列表 | 批量动作 | key（行标识） | 单次上限 | 风险 |
|---|---|---|---|---|---|
| 1 | 访问记录 → **待审列表** | 封 IP / 封设备 / 忽略 | `abuse_reviews.id` | 封 50、忽略 200 | 高 / 低 |
| 2 | 访问记录 → **访问明细** | 封 IP / 信任（加白） | `ip` | 封 50、信任 200 | 高 / 低 |
| 3 | **回收站** | 恢复 | `games.id` | 1000（可全选筛选结果） | 低 |
| 4 | **站点通知** | 删除 / 启用 / 停用 | `announcements.id` | 删除 50、启停 200 | 高 / 低 |
| 5 | 访问记录 → **IP 黑名单** | 解封 | `ip` | 200 | 低 |
| 6 | 访问记录 → **IP 白名单** | 移除 | `ip` | 200 | 低 |
| 7 | 访问记录 → **已封设备** | 解封 | `fingerprint` | 200 | 低 |
| 8 | 访问记录 → **自动封禁记录** | 解封 | `ip` | 200 | 低 |
| 9 | 游戏管理 → **游戏目录** | 禁用 / 启用 / 删除（进回收站） | `games.id` | 禁用/删除 50、启用 200 | 高 / 低 |
| 10 | 访问记录 → **最近设备** | 封禁（10 分钟 / 1 小时 / 1 天 / 永久） | `fingerprint` | 50 | 高 |
| 11 | **用户管理** | 禁用 / 启用 | `users.id` | 禁用 50、启用 200 | 高 / 低 |

**明确不做（写进文档避免下次重提）**：

| 列表 | 原因 |
|---|---|
| Steam 账号（绑定 / 未归属认领） | 同步已由调度器每日自动跑，手动批量会抢 Steam 配额（200 次/5 分钟）；认领是身份绑定必须逐条 |
| 游戏管理 → 投放任务 | 任务本身已是整批语义 |
| 邮件服务 → 发送记录、运行日志 → 同步记录/日志 | 只读，无操作可批量 |
| 用户管理 → 重置密码 / 改邮箱 / 改角色 | 逐条语义，批量误操作代价高，所有者未纳入 |

## 3. 接口：`POST /api/admin/bulk`（统一入口）

### 3.1 为什么是一个入口而不是 11 个接口

上限、二次确认、权限、审计、部分失败这五件事对 11 个列表完全相同；抄 11 遍必然漂移。
统一入口 + **白名单派发表**（target+action 必须在表里，未知组合直接 400）能保证新增列表必须显式登记。

### 3.2 请求与响应

```http
POST /api/admin/bulk      （需要管理员；普通用户 403）
Content-Type: application/json

{
  "target": "blacklist",
  "action": "unban",
  "keys": ["1.2.3.4", "5.6.7.0/24"],
  "options": {},                  // 可选：如 devices.ban 的 {minutes|permanent, note}
  "confirmCount": 2               // 高危动作必填：必须等于 keys 去重后的条数
}
```

```json
200 OK
{
  "opId": 128,                    // 审计记录 id，便于到「批量操作记录」页对照
  "total": 3, "ok": 2, "failed": 0, "skipped": 1,
  "results": [                    // 只回失败与跳过明细（成功条数用 ok 表示），最多 200 条
    { "key": "9.9.9.9", "status": "skipped", "reason": "不在黑名单中" }
  ]
}
```

错误（**整单拒绝，不执行任何一条**）：

| 状态码 | 场景 |
|---|---|
| 400 | 未知 target/action 组合、keys 为空或非数组、key 格式非法、超过单次上限、高危动作缺 `confirmCount` 或数量不符 |
| 403 | 非管理员 |
| 409 | 用户批量禁用会禁用自己、或会禁用最后一个可用管理员 |

**逐条失败 vs 整单失败**：参数类问题整单 400；单个 key 业务上不可执行（记录不存在/已处理/已解封）记为 `skipped`，
业务执行异常记为 `failed` 并带 `reason`，**不影响其它条**（与 `ingest` 的失败模型一致）。

### 3.3 上限与高危确认

| 类别 | 上限 | 二次确认 |
|---|---|---|
| 高危（封禁 / 删除 / 禁用）：`reviews.approve-*`、`visitors.ban-ip`、`devices.ban`、`games.block`、`games.delete`、`announcements.delete`、`users.disable` | 50 | 必须：前端弹窗要求**手工输入本次条数**，服务端校验 `confirmCount === keys.length` |
| 常规：其余动作 | 200 | 无（列表本页最多 200 条，天然受限） |
| 回收站恢复 | 1000 | 无（恢复是安全动作），按钮显示「已选 N 条 / 共 M 条」 |

服务端以 `{target, action}` 查表得 `{max, risk}`，**前端同样按这张表渲染**（前端只做引导，判定以服务端为准）。

### 3.4 幂等与重复

- keys 先按 target 规范化（IP 用 `visitors.normalizeBanInput`、指纹小写、id 转数字）再 `Set` 去重；
- 重复执行同一批：已解封/已恢复/已忽略的返回 `skipped` 而不是报错；
- 单条接口保持不变，不改成批量逻辑（避免回归）。

## 4. 数据模型：审计表 `admin_bulk_ops`

```sql
create table if not exists admin_bulk_ops (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  actor_id    bigint references users(id) on delete set null,
  actor       text,                      -- 冗余用户名，用户删除后仍可读
  target      text not null,
  action      text not null,
  total       int not null,
  ok          int not null default 0,
  failed      int not null default 0,
  skipped     int not null default 0,
  keys_sample jsonb,                     -- 最多 50 个 key（IP/指纹/AppID），用于事后追溯
  options     jsonb,
  ip          text,                      -- 操作者来源 IP
  duration_ms int
);
create index if not exists admin_bulk_ops_time on admin_bulk_ops (created_at desc);
create index if not exists admin_bulk_ops_target on admin_bulk_ops (target, created_at desc);
```

迁移按现有风格追加到 `src/store/pg.js` 的 `migrate()`（全部 `if not exists`，幂等）。

## 5. 服务端实现

### 5.1 派发表（`src/server.js` 内，新增 `BULK_ACTIONS` 常量）

```js
const BULK_ACTIONS = {
  'reviews/approve-ip':      { max: 50,  risk: 'high', run: bulkReviewApproveIp },
  'reviews/approve-device':  { max: 50,  risk: 'high', run: bulkReviewApproveDevice },
  'reviews/reject':          { max: 200, risk: 'low',  run: bulkReviewReject },
  'visitors/ban-ip':         { max: 50,  risk: 'high', run: bulkVisitorBan },
  'visitors/trust':          { max: 200, risk: 'low',  run: bulkVisitorTrust },
  'games/restore':           { max: 1000,risk: 'low',  run: bulkGameRestore },
  'games/block':             { max: 50,  risk: 'high', run: bulkGameBlock },
  'games/unblock':           { max: 200, risk: 'low',  run: bulkGameUnblock },
  'games/delete':            { max: 50,  risk: 'high', run: bulkGameDelete },
  'announcements/delete':    { max: 50,  risk: 'high', run: bulkAnnouncementDelete },
  'announcements/activate':  { max: 200, risk: 'low',  run: bulkAnnouncementActive },
  'announcements/deactivate':{ max: 200, risk: 'low',  run: bulkAnnouncementInactive },
  'blacklist/unban':         { max: 200, risk: 'low',  run: bulkBlacklistUnban },
  'whitelist/remove':        { max: 200, risk: 'low',  run: bulkWhitelistRemove },
  'device-bans/unban':       { max: 200, risk: 'low',  run: bulkDeviceBanRemove },
  'abuse/unban':             { max: 200, risk: 'low',  run: bulkAbuseUnban },
  'devices/ban':             { max: 50,  risk: 'high', run: bulkDeviceBan },
  'users/disable':           { max: 50,  risk: 'high', run: bulkUserDisable },
  'users/enable':            { max: 200, risk: 'low',  run: bulkUserEnable },
};
```

### 5.2 两种执行形态

| 形态 | 适用 | 做法 |
|---|---|---|
| **批量 SQL** | 解封 IP/白名单移除/设备解封/恢复/禁用-启用/公告启停/删除/忽略 | `update ... where id = any($1::bigint[]) returning id`（或 `delete ... returning ip`），返回的 id 集合即成功集，其余为 `skipped` |
| **逐条复用单条逻辑** | 待审「封 IP / 封设备」、访问明细「封 IP / 信任」、最近设备「封禁」、自动封禁「解封」 | `for` + `try/catch`，每步复用现有函数（`db.addBlockedIp` / `db.markReviewsAutoBanned` / `db.upsertDeviceBan` / `ratelimit.unban` …），**上限只有 50，串行可接受** |

**内存态同步（容易漏，必须逐项做）**：

- 黑名单变动后 `await visitors.refreshBlocklist(q)`（否则拦截仍按旧内存表）；
- 白名单移除后逐条 `ratelimit.removeWhitelist(ip)`；
- 设备封禁/解封后 `await devices.loadBans(q)`；
- 用户被禁用后，其会话立即失效（删 `sessions` 中该用户的行，或依赖逐请求校验——按现有单条逻辑为准）。

### 5.3 新增 store 函数（`src/store/pg.js`，SQL 只放这里）

`bulkSetGamesBlocked`、`bulkSetGamesDeleted`、`bulkDeleteAnnouncements`、`bulkSetAnnouncementsActive`、
`bulkFinishAbuseReviews`、`bulkRemoveBlockedIps`、`bulkRemoveWhitelistIps`、`bulkRemoveDeviceBans`、
`bulkSetUsersDisabled`、`createBulkOp`、`listBulkOps`。

### 5.4 审计查询接口

- `GET /api/admin/bulk-ops?limit=100&target=` → `{ ops: [...] }`（管理员）
- `GET /api/admin/bulk-ops/:id` → 单条详情（含 keys_sample）

### 5.5 日志事件

| 事件 | 时机 | 字段 |
|---|---|---|
| `admin.bulk` | 每次批量执行后（含拒绝也要记一条 `admin.bulk_rejected`） | `opId, target, action, total, ok, failed, skipped, by` |
| `admin.bulk_rejected` | 参数/上限/确认/权限守卫拒绝 | `target, action, reason, count, by` |
| `admin.bulk_item_failed` | 有 `failed` 时逐条（上限 20 条） | `target, action, key（IP 截断/指纹前 16 位）, message` |

## 6. 前端实现

### 6.1 复用件（新增）

- `frontend/src/composables/useBulkSelection.js`：`selectedKeys`、`onSelectionChange`、`clear()`、`count`；
  用 `row-key` + 受控数组，**翻页时清空**（回收站例外）。
- `frontend/src/components/BulkBar.vue`：`props { count, actions }`；显示「已选 N 条」+ 操作按钮，`count === 0` 时禁用/隐藏。
- `frontend/src/components/BulkResultDialog.vue`：展示 `ok / failed / skipped` 与明细，可关闭。
- 请求封装沿用页面里的 `api()`；**不要新引 Element Plus 组件**（勾选列是 `el-table-column type="selection"`，
  `ElTable/ElTableColumn` 已在 `frontend/src/admin-ui.js` 注册）。若确需新组件，必须同时改
  `admin-ui.js` 的 `import` / `style/css` / `app.use` 三处，并补 `test/frontend-registration.test.js`。

### 6.2 每个列表的接入改动（11 处）

1. `<el-table>` 加 `row-key` 与 `<el-table-column type="selection" width="44" />`；
2. 表格上方加 `<BulkBar>`（按 §2 的按钮，高危按钮加 `type="danger"`）；
3. 动作前先 `ElMessageBox.confirm`（普通）或 `ElMessageBox.prompt`（高危，要求输入条数）；
4. 调 `POST /api/admin/bulk` → 成功后 `BulkResultDialog` 展示 → 清空选择 → 刷新列表；
5. 回收站额外加「全选当前筛选（N 条，≤1000）」，与表头全选（本页）并存。

**特殊项**：

- 最近设备「批量封禁」需要先选时长：沿用现有 `deviceBanDialog` 的 `el-radio-group`，改为批量弹窗；
- 用户列表：批量禁用后若列表里包含自己/最后一个管理员，按钮置灰并提示（服务端 409 兜底）。

### 6.3 移动端

后台列表在手机上已是卡片式（游戏目录、访问记录）。批量工具条在窄屏折叠成「已选 N 条」+ 一个「批量」下拉/抽屉；
触摸目标 ≥44px。其余列表按现有断点 1024/768/420 处理。

## 7. 权限与安全

- 全部动作仅管理员；沿用 `requireAdmin()`。
- 高危动作服务端二次校验 `confirmCount`（**不能只靠前端弹窗**）。
- 用户批量禁用守卫：不能禁用自己；不能把最后一个可用管理员禁用掉（409）。
- 键值必须逐条校验格式（IP 走 `visitors.normalizeBanInput`，指纹 `^[a-f0-9]{32,64}$`，id 为正整数），非法 key 整单 400。
- 审计只存 key 样本（≤50），避免一次把 1000 条 IP 写进 jsonb。
- 请求体限制沿用现有 `readBody` 上限；`keys` 数组长度服务端再卡一次（防绕过前端直接打接口）。

## 8. 验收

1. 11 个列表都出现勾选列；勾选后工具条显示「已选 N 条」，未勾选时批量按钮禁用。
2. 常规列表翻页后选择清空；回收站「全选当前筛选」一次可恢复 ≤1000 条。
3. 批量解封 3 条黑名单 → 一次请求 → 3 条消失，且**刷新页面后仍能正常访问**（证明内存黑名单已刷新）。
4. 批量忽略 3 条待审 → 状态变 `rejected`，待审计数 -3。
5. 批量封 IP 选 51 条 → 400「单次最多 50 条」，且数据库无任何变化。
6. 批量封 IP 选 50 条但未填确认数 → 400；填 50 → 成功，弹窗显示 `ok=50`。
7. 混入一个不存在的公告 id → 返回 `ok=2 skipped=1`，弹窗列出跳过原因；另外两条真的被删。
8. 普通用户调用 `/api/admin/bulk` → 403。
9. 「系统 → 批量操作记录」出现该次记录（操作者/时间/目标/动作/总数/成功/失败/耗时），点开可见 key 样本。
10. 用户批量禁用：勾选自己 → 按钮置灰；绕过前端直接调接口 → 409；禁用最后一个管理员 → 409。
11. 最近设备批量封禁 2 个指纹 → 设备封禁列表出现 2 条，对应设备请求 403。
12. 通用验证：`npm test` 全绿（新增 `test/admin-bulk.test.js` 已加入 `package.json` 的 test 链）、
    `npm run frontend:build` 通过、`npm run scan` 干净；**不自行打 tag / 触发构建**（硬规则 5）。

## 9. 实施顺序

1. 迁移：`admin_bulk_ops` 表 + `src/store/pg.js` 批量 SQL 函数（先跑通纯 SQL 层）；
2. `POST /api/admin/bulk` 派发表 + 上限/确认/守卫/审计/日志；
3. 审计查询接口 + 后台「系统 → 批量操作记录」页（`AdminModules.vue` 加 section，`Console.vue` 加菜单项）；
4. 前端复用件（composable + 两个组件）；
5. 接入 A 组 8 个列表（先在待审列表打通一条链路，再复制）；
6. 接入 B 组 3 个列表（含高危确认与用户守卫）；
7. 测试：`test/admin-bulk.test.js`（真 PGlite + 真 HTTP，参照 `test/reviews.test.js` 的 `boot()` 写法）→ 主链；
8. 文档收尾：本文件状态改「已实现并发布」、`docs/PROJECT-OVERVIEW.md` 功能表、`README.md` 功能表、
   `docs/WEB.md` 后台模块说明、`docs/TODO.md` 条目、`CHANGELOG.md`（随发版）。

## 10. 待确认问题（开发前可一次问完）

| # | 问题 | 默认取向 |
|---|---|---|
| 1 | 高危确认要求输入"条数"还是固定词（如 `DELETE`）？ | 输入条数（与操作直接对应，误触概率低） |
| 2 | 审计页放在「系统」下，还是「访问与安全」下？ | 系统 → 批量操作记录（它跨所有模块） |
| 3 | 批量操作的键统一用内部 `games.id` / `users.id`（而非 appid / username）？ | 是（appid 可为空，id 稳定） |
| 4 | 回收站「全选筛选」上限 1000 是否够？ | 够（现有一次只拉 1000 条） |
| 5 | 是否保留"操作后自动刷新当前列表"（不跳页）？ | 保留，不清空筛选条件 |

> 已按上表默认取向实现：输入条数确认、审计页在「系统」下、键用内部 id、回收站全选上限 1000、操作后原地刷新。

## 11. 实现落点（2026-11-03，待发版）

| 层 | 文件 | 内容 |
|---|---|---|
| 迁移 | `src/store/pg.js` | `admin_bulk_ops` 表 + 两个索引（`if not exists`，幂等） |
| SQL | `src/store/pg.js` | `bulkSetGamesBlocked` / `bulkSetGamesDeleted` / `bulkDeleteAnnouncements` / `bulkSetAnnouncementsActive` / `bulkGetAbuseReviews` / `bulkRejectAbuseReviews` / `bulkRemoveBlockedIps` / `bulkRemoveWhitelistIps` / `bulkRemoveDeviceBans` / `usersForBulk` / `countActiveAdmins` / `bulkSetUsersDisabled` / `deleteSessionsOfUsers` / `createBulkOp` / `listBulkOps` / `getBulkOp` |
| 接口 | `src/server.js` | `BULK_ACTIONS` 派发表（19 个 target/action）+ `POST /api/admin/bulk` + `GET /api/admin/bulk-ops`、`GET /api/admin/bulk-ops/:id` |
| 前端复用件 | `frontend/src/composables/useBulkSelection.js`、`components/BulkBar.vue`、`components/BulkResultDialog.vue` | 多选状态（键去重 + 翻页清空）、工具条、结果弹窗 |
| 页面接入 | `pages/AdminModules.vue`（9 个列表 + 审计页）、`pages/AdminExtras.vue`（回收站、用户）、`pages/Console.vue`（菜单项） | 勾选列 / 卡片勾选 + 工具条 + 高危确认 |
| 测试 | `test/admin-bulk.test.js`（已加入 `package.json` 的 test 链） | 12 项：前端接入静态断言、鉴权、参数拒绝、上限、高危确认、内存态同步、公告部分失败、用户守卫与会话失效、设备封禁/解封、回收站、审计、键规范化 |

**与本文原方案的偏差（都已落地，记录以免下次重提）**：

1. **列表分布是 9 + 2**：§2 的 11 个列表里，`AdminModules.vue` 有 9 个（游戏目录、访问明细、待审、最近设备、已封设备、
   黑名单、白名单、自动封禁、站点通知），`AdminExtras.vue` 有 2 个（回收站、用户管理）——回收站本来就在 Extras 里。
2. **站点通知用卡片勾选而不是勾选列**：该页是 `<article>` 卡片列表（没有表格），所以用 `el-checkbox` 勾选，
   移动端游戏目录 / 访问明细的卡片列表同理。
3. **`admin_bulk_ops.actor_id` 用 `integer`** 而不是 `bigint`：与 `users.id`（serial）及其它表的 `created_by`/`user_id`
   保持一致，避免外键类型不一致。
4. **用户批量禁用会删 `sessions`**：禁用必须立即生效（单条 `PATCH /api/admin/users/:username` 目前不删会话，
   本次没有改动单条接口，属于已知差异，后续可单独收紧）。
5. **补注册 `ElRadio` / `ElRadioGroup`**：单条设备封禁弹窗原本就在用 `<el-radio-group>`，但 `admin-ui.js` 漏注册
   （页面静默不渲染）。本次批量封禁复用同一交互，顺手补齐并在 `test/frontend-registration.test.js` 加了防回归。
6. **高危确认的条数按"去重后的键"算**：访问明细里同一个 IP 可能出现在多行，前端 `selectedKeys` 已去重，
   弹窗提示与 `confirmCount` 都用去重后的数字，和后端判定完全一致。
