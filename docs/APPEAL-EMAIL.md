# 申诉邮箱：配置缺失与回退链缺陷（待开发）

> 状态：**已定位，待开发**（2026-11-03 15:50）。适用 v1.12.0。
> 关联：[FRONTEND-RENDER-FIX.md](FRONTEND-RENDER-FIX.md)（封禁页跳转，尚未修复）。

## 1. 现象

封禁页/申诉页提示「站点尚未配置申诉邮箱，请联系站点管理员」，但后台「邮件服务」显示
**SMTP 状态=已配置、配置来源=后台设置、授权密码=已保存**，且「系统设置 → 邮件与提醒」里：

| 字段 | 变量 | 用户实际值 |
|---|---|---|
| 邮件收件人 | `ALERT_EMAIL_TO` | 空 |
| 发件人 | `SMTP_FROM` | 空（占位提示"留空则使用 SMTP 账号"） |
| SMTP 账号 | `SMTP_USER` | `yyliucha@163.com`（已填） |
| SMTP 授权码 | `SMTP_PASS` | 已保存 |

## 2. 根因：`??` 遇到空字符串不继续回退

[server.js](../src/server.js)：

```js
const appealEmail = () =>
  String(process.env.APPEAL_EMAIL ?? process.env.ALERT_EMAIL_TO ?? process.env.SMTP_FROM ?? '').trim();
```

- `hydrateSettings` 会把 `alerts.emailTo` 写回 `env.ALERT_EMAIL_TO = ''`（空字符串，不是 undefined）；
- `??` **只对 null/undefined 回退**，遇到 `''` 就停住并返回 `''`；
- 所以即使 `SMTP_FROM`（`applySmtpEnv` 会把它设成 `from_addr || username`）或 `SMTP_USER` 有值，
  也不会被使用 → 申诉邮箱恒为空。

> 补充：`settings.js` 里 `smtp.from` 的计算已经带了 `from_addr || username` 回退，所以 `SMTP_FROM`
> 在用户场景下其实已被水合成 `yyliucha@163.com`；真正的问题就是 `??` 链被 `ALERT_EMAIL_TO=''` 截断。

## 3. 修复方案

### 3.1 回退链改用 `||` 并补最后一级 `SMTP_USER`

新增可测试的纯函数（建议放 `src/appeal.js`，便于单测）：

```js
// src/appeal.js
/** 申诉邮箱回退链：专用设置 → 告警收件人 → SMTP 发件人 → SMTP 账号。 */
export function appealEmailFrom(env = process.env) {
  return String(
    (env.APPEAL_EMAIL || '').trim() ||
      (env.ALERT_EMAIL_TO || '').trim() ||
      (env.SMTP_FROM || '').trim() ||
      (env.SMTP_USER || '').trim(),
  );
}
```

`server.js` 改为 `import { appealEmailFrom } from './appeal.js'; const appealEmail = () => appealEmailFrom(process.env);`

### 3.2 新增设置项「申诉邮箱」

`src/settings.js`（放在「邮件与提醒」分组，紧跟发件人）：

```js
def('alerts.appealEmail', 'APPEAL_EMAIL', 'alerts', '申诉邮箱', 'string', '', {
  help: '封禁页/申诉页展示的邮箱。留空则依次回退到：邮件收件人 → 发件人 → SMTP 账号。',
}),
```

- 设置页由 schema 自动渲染，前端无需改动；
- 保存后 `settings-routes` 会 `hydrateSettings` → `process.env.APPEAL_EMAIL` 立即更新，
  申诉页每次请求实时计算，**无需重启**。

### 3.3 测试

1. `test/settings.test.js`：设置总数 51 → **52**（secrets 仍为 7）。
2. `test/setup.test.js`：`schema.fields.length` 51 → **52**。
3. 新增 `test/appeal.test.js`：

```js
import { appealEmailFrom } from '../src/appeal.js';
// 空串不再截断：ALERT_EMAIL_TO='' 时继续用 SMTP_FROM
assert.equal(appealEmailFrom({ ALERT_EMAIL_TO: '', SMTP_FROM: 'a@b.c' }), 'a@b.c');
assert.equal(appealEmailFrom({ APPEAL_EMAIL: 'x@y.z', ALERT_EMAIL_TO: 'a@b.c' }), 'x@y.z');
assert.equal(appealEmailFrom({ SMTP_FROM: '', SMTP_USER: 'u@v.w' }), 'u@v.w');
assert.equal(appealEmailFrom({}), '');
```

### 3.4 文档与版本

- README「封禁提示页」一段补一句：申诉邮箱 = 「申诉邮箱」设置 → 邮件收件人 → 发件人 → SMTP 账号；
- CHANGELOG 增条目（建议版本 **1.12.1**，修复类）；
- 本文件状态改为"已实现"。

## 4. 验收

1. 系统设置 → 邮件与提醒出现「申诉邮箱」；
2. 只配 SMTP 账号（发件人、收件人、申诉邮箱都留空）→ 封禁页显示 SMTP 账号；
3. 只填「申诉邮箱」→ 封禁页显示该邮箱（优先于其它回退）；
4. 保存后**不重启**，刷新封禁页即生效；
5. `npm test` 全绿（新增 appeal 用例）、`npm run frontend:build` 通过（前端无改动也应通过）、`npm run scan` 干净；
6. **不自行构建**（硬规则 5）。

## 5. 线上临时缓解（无需发版）

当前版本的 `appealEmail()` 只认链上**第一个非空**值，顺序：`APPEAL_EMAIL → ALERT_EMAIL_TO → SMTP_FROM`。
因此线上立即恢复只有三个有效做法（按省事程度）：

1. **填「邮件收件人」**（`ALERT_EMAIL_TO`，系统设置 → 邮件与提醒）：它是链上第二位，填了就能被取到，
   保存后热加载即生效，**不用重启**（推荐，最快）；
2. **compose 加 `APPEAL_EMAIL=yyliucha@163.com` 并重启**：`process.env.APPEAL_EMAIL` 非空，`??` 直接取它；
3. 等本修复发版后，在设置页填「申诉邮箱」，或依赖 `SMTP_FROM → SMTP_USER` 回退。

> 注意：**只填「发件人」在当前版本不生效**——`SMTP_FROM` 是链上第三位，会被第二位的水合空串
> `ALERT_EMAIL_TO=''` 截断（§2 的缺陷）。这点容易踩坑，文档特意写明。
