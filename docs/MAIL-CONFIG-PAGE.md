# 邮件配置合并到「邮件服务」页（方案 A，待开发）

> 状态：**方案已确认（A，2026-11-03），待开发**。
> 关联：[APPEAL-EMAIL.md](APPEAL-EMAIL.md)（申诉邮箱设置项，本批一起做）。

## 1. 目标

把散在两处的邮件配置合并到**「邮件服务」页**，形成一页闭环：

```
邮件服务页 = 状态卡（已配置/来源/授权码） + 邮件配置表单 + 发送测试 + 最近发送记录
系统设置   = 只保留 通知开关 / 间隔 / Webhook / 企业微信
```

后端**零改动**：`/api/admin/settings` 已支持按 key 读写，保存后 `hydrateSettings` 即时生效。

## 2. 字段归属清单

| key | 标签 | 类型 | 去处 |
|---|---|---|---|
| `alerts.smtp.host` | SMTP 主机 | string | **邮件服务页** |
| `alerts.smtp.port` | SMTP 端口 | int | **邮件服务页** |
| `alerts.smtp.secure` | SMTP 加密 | bool | **邮件服务页** |
| `alerts.smtp.user` | SMTP 账号 | string | **邮件服务页** |
| `alerts.smtp.pass` | SMTP 授权码 | secret | **邮件服务页** |
| `alerts.smtp.from` | 发件人 | string | **邮件服务页** |
| `alerts.emailTo` | 邮件收件人 | string | **邮件服务页** |
| `alerts.appealEmail` | 申诉邮箱 | string | **邮件服务页**（本批新增，见 APPEAL-EMAIL.md） |
| `alerts.enabled` | 启用降价提醒 | bool | 系统设置 |
| `alerts.intervalMin` | 提醒检查间隔 | int | 系统设置 |
| `alerts.initialDelaySec` | 提醒检查首轮延迟 | int | 系统设置 |
| `alerts.webhookUrl` | 通用 Webhook | secret | 系统设置 |
| `alerts.wecomUrl` | 企业微信群机器人 | secret | 系统设置 |

## 3. 前端实现

### 3.1 共享 key 判定

新增 `frontend/src/utils/settings.js`：

```js
export const MAIL_SETTING_KEYS = [
  'alerts.smtp.host', 'alerts.smtp.port', 'alerts.smtp.secure', 'alerts.smtp.user',
  'alerts.smtp.pass', 'alerts.smtp.from', 'alerts.emailTo', 'alerts.appealEmail',
];
export const isMailSettingKey = (key) => MAIL_SETTING_KEYS.includes(key);
```

### 3.2 新增 `frontend/src/components/MailSettingsForm.vue`

自包含组件（加载 + 渲染 + 保存），字段来自 `/api/admin/settings` 的 `fields` 中
`isMailSettingKey(key)` 的子集，按 schema 顺序渲染：

- string/int → `el-input` / `el-input-number`
- bool → `el-switch`
- secret → `el-input`（placeholder 用 `secrets[key].hasValue ? '已设置，留空保持原值' : '尚未设置'`）
  + 「查看」（调 `/api/admin/settings/value?key=`）+ 「清空」勾选；
- 「保存邮件配置」按钮 → `PATCH /api/admin/settings`，只提交邮件 key；
  保存成功后 `ElMessage.success` 并 emit `saved`（父组件刷新状态卡）。

保存语义（与 AdminModules 一致）：

- secret 留空 → 不提交该 key（保持原值）；
- secret 勾选「清空」→ 提交 `null`；
- 其它字段按值提交。

### 3.3 邮件服务页（AdminExtras.vue `section='mail'`）

现有结构保留：状态卡 → **新增「邮件配置」卡片（MailSettingsForm）** → 发送测试 → 发送记录。
说明文字从「SMTP 配置统一在系统设置 → 邮件与提醒中修改」改为
「配置保存在此页；保存后立即生效（调度器约 15 秒内读取新值）」。

### 3.4 系统设置页（AdminModules.vue）

- `fieldsByGroup()` 增加过滤：`!isMailSettingKey(f.key)`；
- 分组标题 `alerts` 由「降价提醒」改为「通知与提醒」，描述改为
  「提醒开关与间隔、Webhook / 企业微信；邮件配置在『邮件服务』页。」
- 保存逻辑不变（只提交当前页面可见字段，天然不含邮件 key）。

## 4. 后端（零改动，确认项）

- `PATCH /api/admin/settings` 已支持任意 key；`store:'smtp'` 字段落 `smtp_settings` 表；
- 保存后 `settings-routes` 调 `hydrateSettings` → `process.env.SMTP_* / ALERT_EMAIL_TO / APPEAL_EMAIL`
  即时更新，发信与封禁页实时生效；
- 唯一后端改动来自 [APPEAL-EMAIL.md](APPEAL-EMAIL.md)：新增 `alerts.appealEmail` def（`APPEAL_EMAIL`）
  与 `appealEmailFrom()` 回退链修复 + 测试计数 51→52。

## 5. 验收

1. 邮件服务页：8 个字段全部可编辑、可保存；保存成功提示；状态卡（SMTP 状态/来源/授权码）随之刷新；
2. 授权码：已保存时显示「已设置，留空保持原值」；「查看」可载入；勾选清空并保存后变「尚未设置」；
3. 系统设置「通知与提醒」只剩：启用降价提醒、检查间隔、首轮延迟、通用 Webhook、企业微信；
4. 邮件页保存 SMTP 后，发送测试邮件可成功（真实 SMTP 可用时）；
5. 申诉邮箱在邮件页填写后，封禁页显示该邮箱（依赖 APPEAL-EMAIL 修复）；
6. 刷新页面后配置仍在（数据库持久），重启后仍在（水合）；
7. `npm test` 全绿、`npm run frontend:build` 通过、`npm run scan` 干净；
8. **不自行构建**（硬规则 5）。

## 6. 实施顺序

1. 先做 [APPEAL-EMAIL.md](APPEAL-EMAIL.md)（`appealEmailFrom` + 新设置项 + 测试）；
2. 抽 `utils/settings.js` + `MailSettingsForm.vue`；
3. 邮件服务页接入表单，系统设置过滤邮件字段并改分组标题；
4. 构建验证（`npm run frontend:build`）+ 手动/无头核对；
5. 提交推 main，等所有者指令再发版。
