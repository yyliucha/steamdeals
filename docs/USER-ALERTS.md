# 用户级到价提醒（列表页 + 已拥有隐藏 + 后台全站清单）（待开发）

> 状态：**已确认待开发（2026-11-17）**。
> 关联：[TODO.md](TODO.md) CL 条目、[WISHLIST-SITE-ONLY.md](WISHLIST-SITE-ONLY.md)（愿望单口径）、
> [PRICE-REPORT-EMAIL.md](PRICE-REPORT-EMAIL.md)（邮件 HTML 样式）、[ALERT-MAIL-APPEAL-UX.md](ALERT-MAIL-APPEAL-UX.md)（提醒邮件 HTML 化）。

## 1. 已确认的决策（所有者 2026-11-17）

| # | 决策 |
|---|---|
| 1 | **到价提醒改为用户级**：每个登录用户管理自己的提醒；未登录不可用。 |
| 2 | **详情页普通用户可加/删**；新增「**到价提醒**」列表页（可取消）——解决"忘了哪款游戏就移不掉"。 |
| 3 | **已拥有的游戏对普通用户隐藏「加入提醒」**（Steam 库并集或手动已拥有）；**管理员不隐藏**（永远能看到按钮）。 |
| 4 | 降价通知发**用户本人邮箱**（`users.email`）；未绑定邮箱 → 跳过并发日志，前端提示先绑定；企业微信仍是站点级通道，不按用户拆分。 |
| 5 | 后台新增「**到价提醒**」全站清单（只读 + 清理），管理员不再通过详情弹窗管别人的提醒。 |
| 6 | **旧的站点级 watchlist（`user_id IS NULL`）行为不变**：继续按原逻辑发到 `ALERT_EMAIL_TO`，避免破坏现有提醒。 |
| 7 | **不新建调度任务**：沿用现有 `alerts` 任务（每 360 分钟），内部改为按用户分组发信。 |

## 2. 数据模型

- `watchlist` 加列：`user_id bigint references users(id) on delete cascade`（**nullable**：NULL = 站点级历史数据）。
- **迁移**（`src/store/pg.js`，幂等）：
  1. `alter table watchlist add column if not exists user_id bigint references users(id) on delete cascade;`
  2. `alter table watchlist drop constraint if exists watchlist_game_id_region_key;`（原 `unique (game_id, region)`）
  3. 部分唯一索引：
     `create unique index if not exists watchlist_user_game_uq on watchlist (user_id, game_id, region) where user_id is not null;`
     `create unique index if not exists watchlist_site_game_uq on watchlist (game_id, region) where user_id is null;`
  4. 查询索引：`create index if not exists idx_watchlist_user on watchlist (user_id, created_at desc);`
- **注意**：PG 的 `unique` 对 NULL 视为互不相等，所以站点级必须用**部分唯一索引**单独约束，不能用普通唯一约束。

## 3. 服务端

### 3.1 用户接口（登录必需）

| 方法 | 路径 | 行为 |
|---|---|---|
| GET | `/api/watchlist` | 当前用户的提醒列表（join games + 当前价/史低/货币），按加入时间倒序 |
| POST | `/api/watchlist` | `{ gameId \| appid, targetCents, note? }`：upsert（同键重复只更新目标价/备注） |
| DELETE | `/api/watchlist/:gameId` | 只删**当前用户**该游戏的提醒（幂等，返回 removed 0/1） |

- 校验：`targetCents` 为 null 或 ≥0 整数；`note` ≤200 字；非法 400；未登录 401。
- 详情接口（`GET /api/games/:appid`、`/api/games/by-id/:id`）增加 `watch: { targetCents, note, createdAt } | null`（当前用户），供详情页回显与"取消"。

### 3.2 管理员接口（保留 + 扩展）

- `GET /api/admin/watchlist`：改为**全站列表**（含 `user_id`、用户名、游戏名、目标价、当前价、史低、加入时间、最近提醒；分页 + 可选用户名筛选）。
- `DELETE /api/admin/watchlist/:id`：按提醒 id 清理任意一条（记审计 `api.watch_deleted`）。
- 旧的"按游戏删除"参数保持不变以兼容。

### 3.3 提醒评估（`src/alerts.js` + `alerts` 任务）

- `watchCandidates` 带上 `user_id`、用户邮箱；评估逻辑（目标价 / 史低）不变。
- 分组：**按 user_id 分组，一人一封邮件**（复用现有 HTML 提醒邮件渲染）；站点级（NULL）仍发 `ALERT_EMAIL_TO`。
- 无邮箱用户：跳过并记 `alert.skipped_no_email`（不 5xx、不阻塞其它用户）。
- 幂等沿用 `last_notified_cents/at`，同一价格不重复提醒。

## 4. 前端 / 后台

### 4.1 详情弹窗（`Home.vue`，UI 按 demo：[design/detail-actions-2026-11-17.html](design/detail-actions-2026-11-17.html)，截图同名 `.png`）

**三段式布局**（替换现有"按钮全堆在两行"）：

1. **购买**（主操作，独占一行）：`去 Steam 购买 ¥<当前价>`；
2. **我的标记**：感兴趣 / 不感兴趣 / 已拥有 / 愿望单 → 改为**可切换 chip**（选中 = 淡色底 + ✓；点击逻辑不变）；
3. **到价提醒区块**：
   - 参考行（小字）：`当前 ¥X · 史低 ¥Y`；
   - 输入行：¥ 前缀输入框（占位「留空 = 跌到史低时提醒」）+ 快捷按钮 **「按史低」「减 10%」** + 「保存」；
   - 快捷值：按史低 = 史低价；减 10% = 当前价 × 0.9 后按整数分取整；
   - **已设置**：显示绿色 chip「提醒中 ¥X」+「取消提醒」；**未设置时不显示取消**；
   - 普通用户且 `game.owned === true` → **隐藏整个提醒区**（提示「已在库中，无需提醒」）；管理员始终显示；
4. **移动端**：标记 chips 横向滚动；提醒区折叠为一行「🔔 到价提醒 · 提醒中 ¥X · 调整 ▾」，点开展开输入行；
5. 保存/取消后刷新详情与「到价提醒」列表；保存中按钮 loading，防重复提交；目标价非法（负数/非数字）就地提示。

### 4.2 新增「到价提醒」列表（解决忘记游戏无法移除）

- 桌面：Home 顶部 tab 增加「到价提醒」（仅在登录时出现）；移动端：底部「我的」面板加入口。
- 列表字段：游戏名（可点开详情）/ 目标价 / 当前价 / 史低 / 加入时间 / 取消按钮；空态引导「在游戏详情页设置到价提醒」；分页 20。
- 取消后立即从列表移除并提示。

### 4.3 后台「到价提醒」清单（`AdminModules.vue`）

- 新 section：全站提醒列表（用户 / 游戏 / 目标价 / 当前价 / 加入时间 / 最近提醒 / 删除），分页 + 用户名筛选，移动端卡片，删除有确认。

## 5. 设置与配置

- 无新增设置项；邮件开关/收件人沿用现有「通知与提醒 / 邮件服务」。
- 行为变化：用户级提醒的收件人 = 该用户绑定邮箱（不是站点收件人）。

## 6. 调度与自动化

- **不新建任务**：`alerts` 仍每 360 分钟跑；改动仅在"分组与收件人"。
- 合并评估：无新外部请求，无配额影响；单轮时长不变（用户量小，分组发信串行）。
- 幂等：`last_notified_*` 现有机制；同用户多游戏合并成一封邮件。

## 7. 去重与幂等（硬约束节）

- **稳定键**：`(user_id, game_id, region)`；重复加入只更新目标价/备注（upsert），不产生重复行。
- **用户隔离**：普通用户只能读写自己的提醒（A 删 B 的返回 404/403）；管理员按 id 清理。
- **站点级与用户级并存**：`user_id IS NULL` 走部分唯一索引，与用户级互不冲突。
- **邮件去重**：同一游戏同一价格不重复提醒（沿用 `last_notified_cents`）。

## 8. 安全

- 所有用户接口要求登录；POST/DELETE 每用户限流（30 次/分）。
- 参数校验（整数/长度）；不返回其他用户信息；后台操作记审计。
- 邮件正文不包含其他用户信息；无邮箱不报错。

## 9. 验收

1. 普通用户详情页可加/删提醒；**已拥有的游戏隐藏提醒区**；管理员始终可见（含已拥有）。
2. 「到价提醒」列表页：显示自己的提醒、可取消、空态、分页；**忘了游戏也能在这里删**。
3. 用户隔离：A 看不到/删不掉 B 的提醒（接口返回 404/403），后台管理员可见全部。
4. 提醒评估：目标价触发后**收件人 = 该用户邮箱**；同用户多游戏合并一封；无邮箱跳过并记 `alert.skipped_no_email`；站点级（NULL）行为不变。
5. 后台「到价提醒」清单可分页/筛选/删除，删除有审计。
6. 迁移幂等：连跑两次 `migrate()` 不报错；旧站点级数据保留且行为不变。
7. `npm test`（新增 `test/watchlist-user.test.js` 进主链）/ `frontend:build` / `scan` 全绿。
8. **详情页 UI 与 demo 一致**（`design/detail-actions-2026-11-17`）：三段式（购买 / 我的标记 chips / 到价提醒区块）；
   chips 有选中态；参考行显示当前价与史低；「按史低」「减 10%」可用且计算正确；
   未设置时不出现「取消」；已设置显示「提醒中 ¥X」+ 取消；移动端为折叠形态；已拥有隐藏仅对普通用户生效。

### 9.1 demo 状态 ↔ 自动化断言对照表（`gameprice-requirements` 2026-11-17 起要求）

| demo 状态 | 断言点 | 预期 |
|---|---|---|
| 未设置 | 到价提醒区块 / 取消按钮 | 区块存在；**不存在**「取消」按钮/链接 |
| 已设置 | 「提醒中」chip + 取消 | 两者都存在；chip 文案含目标价 |
| 已拥有（普通用户） | 提醒区块 | 隐藏；**管理员视角可见**（双视角断言） |
| 移动端折叠 | 折叠行 | 窄屏渲染折叠行「🔔 到价提醒 · 调整 ▾」，非两行按钮 |
| 快捷按钮 | 按史低 / 减 10% | 按史低 = 史低价；减 10% = 当前价 × 0.9 取整分 |

## 10. 实施顺序

1. 迁移（加列 + 部分唯一索引）与数据层函数（list/upsert/delete by user、admin 全站列表）；
2. 用户接口 + 详情 `watch` 字段 + 权限与隔离测试；
3. `alerts` 按用户分组发信（含无邮箱跳过）+ 测试；
4. 前端详情弹窗（三段式布局 + 状态 chips + 提醒区块/快捷按钮 + 已拥有隐藏/管理员例外 + 移动端折叠）+ 到价提醒列表 tab/移动入口；
5. 后台全站清单；
6. 文档：PROJECT-OVERVIEW / WEB.md / README 已知限制（到价提醒改为用户级）同步。

## 11. 待确认问题

无（三项决策已确认：用户级 / 已拥有隐藏 / 管理员不隐藏）。实现时若发现"列表页放 tab 还是独立页"的取舍，按 §4.2 的 tab 方案执行；如需独立路由再另议。
