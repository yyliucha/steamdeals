# 后台密钥查看统一（FX，待开发）

> 状态：**需求与方案已确认（2026-11-27），待开发**。
> 关联：[demo](design/secret-reveal-2026-11-27.html)（+ 同名 `.png`）、`src/settings-routes.js`（查看接口）、
> `frontend/src/pages/AdminModules.vue`（设置页四种布局分支）、[PROXY-POOL.md](PROXY-POOL.md) §5（代理列表编辑器）、
> [SETTINGS-IA.md](SETTINGS-IA.md)（CQ 批信息架构）

## 0. 背景与现状（2026-11-27 代码核实）

所有者反馈（截图）：「后台所有查看 key 的地方，都是有一个『已设置』，然后无法查看已经录入的值」。

核对结论——**不是没做，是 CQ 批卡片化把入口弄丢了**，且各分支行为不一致：

| 层 | 现状 | 证据 |
|---|---|---|
| 后端 | ✅ 已有 `GET /api/admin/settings/value?key=`：只允许 secret 字段（否则 400）、单 key、记 `settings.revealed` 日志 | `src/settings-routes.js:47-56` |
| 旧布局分支 | ✅ 有「查看」按钮 + 「清除」checkbox；但「查看」把明文**载入密码输入框** | `AdminModules.vue:204`（`isPlainGroup` 分支）、`:767` `revealSecret` |
| **卡片 / 网格 / 折叠分支**（线上实际） | ❌ 只渲染密码框 + placeholder「已设置，留空保持原值」，**无任何查看入口** | `AdminModules.vue:204`（`grid` / `foldBody` 分支） |
| 代理类 3 项 | ⚠️ 走「编辑弹窗 → 查看当前值」，明文进输入框，**误保存即覆盖** | `:222` `secretDialog` + `:772` `revealSecretInDialog` |

受影响的 **8 个 secret 设置项**（`src/settings.js` 中 `type: 'secret'`）：

1. `sources.steam.apiKey`（Steam Web API Key）
2. `sources.itad.apiKey`（ITAD API Key）
3. `alerts.smtp.pass`（SMTP 授权码，独立加密列 `smtp_settings.password_enc`）
4. `alerts.webhookUrl`（通用 Webhook）
5. `alerts.wecomUrl`（企业微信群机器人）
6. `network.steamProxy`（Steam 专用代理，多条）
7. `network.httpsProxy`（通用出网代理）
8. `network.appSyncProxy`（App 同步专用代理）

## 1. 已确认的决策（所有者 2026-11-27）

| # | 决策 |
|---|---|
| 1 | 点「查看」**不要二次确认**，直接显示明文（Demo 区块 C） |
| 2 | 明文 **30 秒自动隐藏**；手动关闭立即清除（Demo 区块 D） |
| 3 | 审计写 **`audit_logs`**（`admin.secret_revealed`，只记 key 名，不记值） |
| 4 | **查看只读、编辑才写、清除二次确认**——三动作彻底分离（不再「查看即载入输入框」） |
| 5 | 覆盖全部 **8 个 secret**，且在**四种布局分支**（`isPlainGroup` / `grid` / `foldBody` / 代理行）行为一致 |
| 6 | 抽公共组件，**一处实现四处分发**（根治「换个布局就丢入口」） |
| 7 | 不做「全部显示」/批量；一次一个 key（后端本来就是单 key 接口） |
| 8 | 掩码固定 **12 点**，不透露真实长度 |

## 2. 数据模型

- **不改表结构**。审计复用 `audit_logs`（沿用现有 action / actor / detail / ip / ua 字段）；
- 明文不进库、不进 `localStorage`、不进前端日志。

## 3. 服务端

- 既有接口保持契约：`GET /api/admin/settings/value?key=` → `{ key, value, source }`；
  仅 `field.secret === true` 可通过（否则 400「只能查看敏感字段」）；单 key、不批量；`requireAdmin` 不变；
- **新增**：在现有 `logger.info('settings.revealed')` 之外，写一条 `audit_logs`：
  - `action`: `admin.secret_revealed`
  - `detail`: `{ key }`（**不含值**）
  - `actor` / `ip` / `ua` 沿用现有审计写入函数；
- 日志事件保持 `settings.revealed`（应用日志，排障用），审计供后台「审计日志」页查询。

## 4. 前端 / 后台

**新增组件** `frontend/src/components/SecretField.vue`：

| 状态 | 渲染 | 行为 |
|---|---|---|
| 未配置 | 「尚未设置」+ 「设置」按钮 | 打开编辑弹窗 |
| 已配置 | 掩码 12 点（`••••••••••••`）+ 「查看」「编辑」「清除」 | 见下 |
| 查看中 | 弹窗：等宽明文 + 「复制」+ 倒计时「N 秒后隐藏」 | 关闭或倒计时归零 → 清空并关弹窗 |
| 编辑中 | 弹窗：空输入框（placeholder「已设置，留空保持原值」） | 留空保存不改值；填写则覆盖；保存后约 15 秒生效 |

- 点「查看」→ **直接** `GET /api/admin/settings/value?key=<key>`，**不弹确认**；
- 「复制」用 `navigator.clipboard`；非安全上下文降级为「已选中，请 Ctrl+C」提示；
- 「清除」走 `ElMessageBox.confirm` → 保存 `null`（来源回落 env/默认）；
- **四处替换**：`isPlainGroup` 分支、`grid` 分支、`foldBody` 分支、`network.steamProxy` 代理行；
- **代理（多条）**：查看弹窗逐条列出明文（含账号密码的 URL），并显示条数；沿用列表编辑器管理（[PROXY-POOL.md](PROXY-POOL.md) §5）；
- **移动端**（≤560px）：三动作换行、按钮触摸目标 ≥44px 等效、输入框不溢出；
- **demo**：[design/secret-reveal-2026-11-27.html](design/secret-reveal-2026-11-27.html)，
  验收必须「与 demo 一致」；demo 内嵌「状态 ↔ 自动化断言」对照表。

## 5. 设置与配置

- 无新增设置项、无迁移、无默认值变化。

## 6. 安全

| 项 | 要求 |
|---|---|
| 权限 | 仅管理员（沿用 `requireAdmin` + 后端只允许 secret 字段） |
| 审计 | 每次查看落 `audit_logs`（`admin.secret_revealed`，只含 key 名） |
| 明文生命周期 | 只在弹窗内存；关闭 / 30 秒即清；**不进表单**（避免误保存）、不进 localStorage、不进日志 |
| 掩码 | 固定 12 点，不透露长度 |
| 批量 | 不做「全部显示」；一次一个 key |
| 复制 | Clipboard API；HTTP 环境降级提示手动复制 |
| 不新增 | 不加「查看需重输密码」这类二次认证（所有者 2026-11-27 明确：无确认步骤），靠审计追溯 |

## 7. 验收（7 条）

1. **8 个 secret 项在四种布局分支**都出现「查看 / 编辑 / 清除」三动作（模板静态锁 + 至少两处 DOM 断言）；
2. 点「查看」**无确认弹窗**，直接调 `GET /api/admin/settings/value?key=` 一次；明文等宽显示 + 复制按钮 + 倒计时；
3. 明文弹窗 30 秒倒计时后自动关闭，**DOM 中不再存在该值**；手动关闭同样清空（断言弹窗关闭后页面文本不含明文）；
4. 查看后 `audit_logs` 新增一条 `admin.secret_revealed`，`detail` 只含 key 名、**不含值**；后台「审计日志」可查到；
5. 非管理员访问该接口 401/403；非 secret key 返回 400「只能查看敏感字段」（回归）；
6. 代理（多条）查看弹窗逐条显示明文与条数；编辑留空保存不改值；清除二次确认后回落 env/默认；
7. 移动端 375px 三动作换行且无横向溢出；`npm test`（分段）+ `npm run frontend:build` + `npm run scan` 全绿。

## 8. 实施顺序

**单批 FX-1**：后端补审计 → `SecretField.vue` → 四处替换 → 测试与 demo 对照。

## 9. 待确认

无（4 项已于 2026-11-27 确认：不要确认弹窗 / 30 秒 / 审计写 `audit_logs` / 按此立项）。
