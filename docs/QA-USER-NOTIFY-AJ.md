# QA：账号变更通知（AJ 批，第 1 轮）

> 基线 45e1411 → HEAD f503fd6；判据 [docs/USER-LIFECYCLE.md](USER-LIFECYCLE.md) §4.2 / §6 / §8 验收 5–7、11；
> 开发描述来源：开发会话汇报（dfdad47 代码 + f503fd6 文档）。
> 结论：✅ 放行 —— 通过 17 / 缺失 0 / 偏差 0 / 需人工确认 1

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | AJ | 禁用/启用用户后，该用户邮箱收到「账号停用/账号恢复」通知 | 后台 → 用户管理 → 禁用/启用 | ✅ 已交付 | server.js:1839；test/account-notify.test.js:297 |
| 2 | AJ | 删除用户后，被删用户邮箱异步收到「账号已被删除」通知（响应立即返回） | 后台 → 用户管理 → 删除 | ✅ 已交付 | server.js:1795-1806；test:415 |
| 3 | AJ | 修改显示名后，用户邮箱收到「显示名已修改」通知（含新显示名，HTML 转义） | 后台 → 用户管理 → 改名 | ✅ 已交付 | server.js:1832-1835；test:297 |
| 4 | AJ | 修改角色后，用户邮箱收到「权限已变更」通知（管理员/普通用户） | PATCH /api/admin/users/:username | ✅ 已交付 | server.js:1828-1831；test:297 |
| 5 | AJ | 绑定新邮箱发两封：旧邮箱收「登录邮箱已变更」（新邮箱打码）+ 新邮箱收「绑定成功」；新旧相同只发一封；旧邮箱未验证改发新邮箱；解绑不发 | 后台 → 用户管理 → 邮箱 | ✅ 已交付 | server.js:2263-2291；test:368 |
| 6 | AJ | 重置密码后，用户邮箱收到「密码已被重置」通知，正文绝不包含新密码 | 后台 → 用户管理 → 重置密码 | ✅ 已交付 | server.js:1868-1874；test:346 |
| 7 | AJ | 未绑定邮箱 / 模板停用：操作照常成功，后台提示「未发送」 | 上述各入口 | ✅ 已交付 | account-notify.js:94-108；AdminExtras.vue:105 |
| 8 | AJ | 发送失败：业务操作不受影响，PATCH 类界面提示「通知发送失败」，删除类只进日志 | 上述各入口 | ✅ 已交付 | account-notify.js:151-159；AdminExtras.vue:105；test:201 |
| 9 | AJ | 批量禁用/启用不向用户发任何邮件（只记日志） | 后台 → 用户管理 → 批量栏 | ✅ 已交付 | server.js:3184（注释）；test:415 |
| 10 | AJ | 「最近发送记录 → 通知」tab 可见账号通知的成功/失败记录（含操作者） | 后台 → 邮件服务 → 最近发送记录 | ✅ 已交付 | account-notify.js:137-153；test:123/415 |
| 11 | AJ | 同一请求同时改多项时最多发一封（优先级 禁用 > 角色 > 显示名） | PATCH /api/admin/users/:username | ✅ 已交付 | server.js:1809-1835；test:297 |

## 逐条核对（规格验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | §8.5：7 类操作各触发通知，SMTP 桩断言收件人/主题/正文 | 假 SMTP 服务器逐行断言（比桩更强）；测试覆盖禁用/启用/删除/改名/改邮箱/改角色/重置密码 | test/account-notify.test.js:297（PATCH 四类）、:346（密码）、:368（改邮箱两封）、:415（删除） | ✅ |
| 2 | §8.5：正文不含密码/token/API Key/IP/完整邮箱 | 模板变量白名单（无敏感变量）+ 测试断言密码/原因/完整新邮箱不进正文 | mail-templates.js:7-19；test:346、:368、:415 | ✅ |
| 3 | §8.5：改邮箱两封（旧邮箱未验证改发新邮箱；新旧相同只发一封） | 读代码 + 假 SMTP 收件人断言 | server.js:2279-2291；test:368 | ✅ |
| 4 | §8.6：未绑定邮箱 → 操作成功、notify=skipped_no_email、界面提示「未发送」 | 后端状态 + 前端 toast 分支 | account-notify.js:94-97；server.js:1795/1849；AdminExtras.vue:105、:185 | ✅ |
| 5 | §8.7：SMTP 失败 → 业务仍成功，日志 admin.user_notify_failed、mail_log.ok=false | 失败路径单元测试（发送器抛异常/返回 ok:false 均收敛） | account-notify.js:147-159；test:201 | ✅ |
| 6 | §8.7：PATCH 类界面提示「通知发送失败」，删除类只进日志 | toastNotify warning 分支；删除 fire-and-forget 无同步回执 | AdminExtras.vue:105；server.js:1798（void） | ✅ |
| 7 | §8.11：批量禁用/启用只记日志、不发任何用户邮件 | 批量走 SQL（bulkUserDisable/Enable）无通知调用；全仓 grep 调用点仅 5 处（无 bulk） | server.js:3184 注释；grep notifyUserAction → server.js 仅 1798/1839/1868/2288/2290 | ✅ |
| 8 | §4.2：一次请求最多一封，优先级 disabled > role > display_name | 代码分支顺序 + 测试断言 rcpt 只 +1 | server.js:1809-1835；test:297 | ✅ |
| 9 | §4.2：串行队列、单封超时 8 秒、失败不重试 | 模块级 queue；timeoutMs 8000；无重试循环 | account-notify.js:141、:161-177；test:258（maxInFlight=1） | ✅ |
| 10 | §4.2：操作者统一「站点管理员」 | 默认 operator 参数；测试断言正文不出现真实操作者 | account-notify.js:84；test:123 | ✅ |
| 11 | §4.2：每次发送写 mail_log（成功/失败），actor 记真实操作者 | 单元 + HTTP 测试断言行数与 actor | account-notify.js:137-153；test:123（10 行）、:415（actor=admin） | ✅ |
| 12 | §4.2：删除/改邮箱异步（响应 notify:'queued'），PATCH/重置同步（notify 进响应） | 路由代码 + 响应断言 | server.js:1797/2291（异步）、1849/1874（同步）；test:368、:415 | ✅ |
| 13 | §4.2：创建用户不通知 | POST /api/admin/users 无通知调用（grep 取证） | grep notifyUserAction → 调用点不含 2431+ 的建号路由 | ✅ |
| 14 | 纪律 1：无擅自 tag（硬规则 5） | git tag --list | 最新 tag v1.18.0，无新增 | ✅ |
| 15 | 纪律 2/3：diff 不碰部署/服务器配置，无构建产物入提交 | git diff --stat | 8 文件全为代码/测试/文档，无 dist/log/data | ✅ |
| 16 | 纪律 4/5：已推 main；PROJECT-OVERVIEW 已同步 | git status / 文档 diff | origin/main=f503fd6；PROJECT-OVERVIEW.md 新增 AJ 行 | ✅ |
| 17 | 纪律 7：新测试进主链 | package.json test 脚本 | `node test/account-notify.test.js` 已插入主链（notify-html 之后） | ✅ |

## 亲自重跑验证（2026-11-06 18:2x）

```
npm test            → 57 个文件 / pass 480 / fail 0
npm run frontend:build → ✓ built in 943ms
npm run scan        → ✅ 未发现高置信度凭据 / 未发现可疑密钥赋值
```

## 打回清单

无。

## 需人工确认

- 条目（真机）：本地只有协议级假 SMTP，真实 QQ/163 邮箱客户端里 HTML 版式与统一页脚的渲染效果需上线后人工确认（与 AI 批验收 8 同类）。

## 争议项

无。

## 复检记录

- 第 1 轮（2026-11-06）：初检即通过，无打回项。
