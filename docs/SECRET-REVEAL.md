# 后台密钥查看统一（FX，待开发）

> 状态：**需求与方案已确认（2026-11-27），待开发**。
> 关联：[demo](design/secret-reveal-2026-11-27.html)（分区截图 `-1.png` 核心交互 / `-2.png` 真实卡片 / `-3.png` 安全与断言）、
> `src/settings-routes.js`（查看接口）、`frontend/src/pages/AdminModules.vue`（设置页四种布局分支）、
> [PROXY-POOL.md](PROXY-POOL.md) §5（代理列表编辑器）、[SETTINGS-IA.md](SETTINGS-IA.md)（CQ 批信息架构）

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
| 1 | 交互 = **标准密码框 + 眼睛图标原地切换明文/密文**（所有者原话：「市面上类似密码框的…后面有一个小眼睛，可以控制明文和密文，这个是我理想的功能」）；**不用查看弹窗、不用二次确认** |
| 2 | 明文**懒加载**：页面加载不取明文；点眼睛才调一次 `GET /api/admin/settings/value?key=`，再点眼睛回密文（**不重复请求**） |
| 3 | 明文显示 **30 秒无操作自动回密文**（只切回 `type=password`，不关页面） |
| 4 | 审计写 **`audit_logs`**（`admin.secret_revealed`，只记 key 名，不记值） |
| 5 | 编辑直接在密码框改：**未改动不提交**、留空 = 保持原值（避免「懒加载到的真值」被误保存） |
| 6 | 覆盖全部 **8 个 secret**，且**四种布局分支**（`isPlainGroup` / `grid` / `foldBody` / 代理行）行为一致——抽公共组件一处实现 |
| 7 | 未配置时眼睛**置灰不可点**、不发请求；不做「全部显示」/批量，一次一个 key |
| 8 | 掩码由浏览器 `type=password` 渲染（不手工拼 12 个点；demo 的圆点是静态示意） |

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

**新增组件** `frontend/src/components/SecretField.vue`（替换四处渲染）：

| 状态 | 渲染 | 行为 |
|---|---|---|
| 未配置 | 空密码框（placeholder「尚未设置」）+ 眼睛置灰 + 「设置」 | 不发请求；输入后保存 |
| 已配置 · 密文 | `type=password`（浏览器渲染圆点）+ 眼睛图标 | 点眼睛：首次懒加载明文后切 `type=text` |
| 已配置 · 明文 | `type=text` 等宽字体、可选中复制 + 眼睛图标 | 再点 → 回 `type=password`（不重新请求）；30 秒无操作自动回密文 |
| 编辑中 | 直接改密码框内容 | 未改动不提交；留空 = 保持原值；保存约 15 秒生效 |
| 清除 | 密码框旁「清除」按钮 | `ElMessageBox.confirm` 后保存 `null`，来源回落 env/默认 |

- 眼睛按钮**自实现**（不直接用 `el-input` 的 `show-password`）——因为值要懒加载，需要在点击时先取明文再切 `type`；
- 懒加载值保存在组件内存（`loadedValue`），不写 `localStorage`/不解进 URL；
- **四处替换**：`isPlainGroup` 分支、`grid` 分支、`foldBody` 分支、`network.steamProxy` 代理行；
- **代理（多条）**：眼睛点开后逐行显示两条代理地址（含账号密码），每行可单独复制；管理仍走列表编辑器（[PROXY-POOL.md](PROXY-POOL.md) §5）；
- **移动端**（≤560px）：眼睛保留在输入框内，次要动作换行，触摸目标 ≥44px 等效；
- **demo**：[design/secret-reveal-2026-11-27.html](design/secret-reveal-2026-11-27.html)
  （`?shot=1/2/3` 分区查看；截图 `-1.png` / `-2.png` / `-3.png`），验收必须「与 demo 一致」。

## 5. 设置与配置

- 无新增设置项、无迁移、无默认值变化。

## 6. 安全

| 项 | 要求 |
|---|---|
| 权限 | 仅管理员（沿用 `requireAdmin` + 后端只允许 secret 字段） |
| 审计 | 每次显示明文落 `audit_logs`（`admin.secret_revealed`，只含 key 名） |
| 懒加载 | 页面加载不取明文；**点眼睛才调一次接口**；再点眼睛不重复请求 |
| 明文生命周期 | 只在组件内存；**30 秒无操作自动回密文**；不进 localStorage、不进前端日志、不进 URL |
| 误覆盖防护 | 懒加载到真值后**未改动不提交**（按 diff 判断），留空 = 保持原值 |
| 掩码 | 浏览器 `type=password` 渲染；不手工拼串 |
| 批量 | 不做「全部显示」；一次一个 key |
| 二次认证 | **不做**「查看需重输密码」这类步骤（所有者 2026-11-27：眼睛即可），靠审计追溯 |

## 7. 验收（7 条）

1. **8 个 secret 项在四种布局分支**都有密码框 + 眼睛图标 + 清除（模板静态锁 + 至少两处 DOM 断言）；
2. 已配置默认 `type=password`；点眼睛 → **调 `GET /api/admin/settings/value?key=` 一次** → `type=text` 显示明文；
   再点眼睛 → 回 `type=password` 且**不再调接口**（断言请求次数）；
3. 明文显示 **30 秒无操作后自动回 `type=password`**（不再显示明文）；
4. 未配置：眼睛置灰不可点、不发请求；
5. **未改动不提交**、留空 = 保持原值；清除二次确认后保存 `null` 并回落 env/默认；
6. 显示明文后 `audit_logs` 新增 `admin.secret_revealed`（`detail` 只含 key 名、不含值）；非管理员 401/403；
   非 secret key 返回 400「只能查看敏感字段」（回归）；
7. 移动端 375px 眼睛在框内、次要动作换行、无横向溢出；`npm test`（分段）+ `npm run frontend:build` + `npm run scan` 全绿。

## 8. 实施顺序

**单批 FX-1**：后端补审计 → `SecretField.vue` → 四处替换 → 测试与 demo 对照。

## 9. 待确认

无（4 项已于 2026-11-27 确认：不要确认弹窗 / 30 秒 / 审计写 `audit_logs` / 按此立项）。
