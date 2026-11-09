# QA：账号流程（AK-3 批，第 1 轮）

> 基线 b512d95 → HEAD fba4097；判据 [docs/AUTH-REDESIGN.md](AUTH-REDESIGN.md) §4.5–4.8/§6.4/§7 验收 7、8、9、12（AK-3 范围）；
> 开发描述来源：开发会话汇报（df79db2 代码 + fba4097 文档）。
> 结论：✅ 放行 —— 通过 12 / 缺失 0 / 偏差 0 / 需人工确认 2

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/接口/行为） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | AK-3 | 后台建号密码可留空 → 16 位随机临时密码（响应只回一次），该账号首登必须改密 | 后台 → 用户管理 → 新建 | ✅ | server.js（建号路由）；test/password-change.test.js:32 |
| 2 | AK-3 | 后台重置密码可留空 → 临时密码；重置不再顺带启用禁用账号 | 后台 → 重置密码 | ✅ | server.js；pg.js（setUserPassword）；test:55 |
| 3 | AK-3 | 开放自助注册：邮箱验证码 → 建号（普通用户、邮箱即验证）并自动登录 | POST /api/auth/register/request + verify | ✅ | auth-routes.js；test/register.test.js:60 |
| 4 | AK-3 | 注册唯一性（用户名/邮箱 409）、用户名 3-32 无空格斜杠、密码策略、图形验证码、发码三级限流 | 注册 | ✅ | auth-routes.js；test/register.test.js:88 |
| 5 | AK-3 | 注册开关关闭 403、SMTP 未配置 503 | 注册 | ✅ | auth-routes.js；test/register.test.js:122 |
| 6 | AK-3 | 登录用户修改密码：旧密码错 400、策略校验、踢其它会话保留当前、weak_password 清除 | POST /api/user/password | ✅ | server.js；test/password-change.test.js:76 |
| 7 | AK-3 | 首登强制改密：must_change_password 用户业务接口 403（code=must_change_password），白名单放行，改密后恢复 | 登录后任意接口 | ✅ | server.js（守卫）；test/password-change.test.js:105 |
| 8 | AK-3 | 系统设置新增「账号与登录」分组 + 开放注册开关 | 后台 → 系统设置 | ✅ | settings.js（def + GROUPS） |

## 逐条核对（规格验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | §7.7 建号/重置留空 → 临时密码（只显示一次）+ must_change=true | HTTP 测试断言 tempPassword 格式与 DB 标记 | test/password-change.test.js:32-53、55-73 | ✅ |
| 2 | §7.7 重置不再顺带解除禁用 | 禁用账号重置后 disabled 仍 true | test:55-73 | ✅ |
| 3 | §7.7 首登强制改密：业务接口 403 + 前端跳改密（标记在登录/me 响应） | 403 断言 + code 字段 | test:105-125 | ✅ |
| 4 | §7.8 注册：验证码 → 建号自动登录；唯一性 409；开关 403；SMTP 503 | 注册流全链路 HTTP 测试 | test/register.test.js:60-86、88-119、122-141 | ✅ |
| 5 | §7.9 修改密码：旧密码错 400；成功后其它会话失效、当前保留；weak_password 清除 | HTTP 测试 | test/password-change.test.js:76-103 | ✅ |
| 6 | §4.6 用户名 3-32 不含空格/斜杠 | 400 断言 | test/register.test.js:88-119 | ✅ |
| 7 | §4.6 发码频率复用三级限流 | 代码（checkRateLimit/checkIpRateLimit/checkGlobalDailyLimit） | auth-routes.js | ✅ |
| 8 | §4.6 并发唯一性靠唯一索引兜底（23505 → 409） | 代码 catch | auth-routes.js（verify 23505 分支） | ✅ |
| 9 | §4.8 白名单路径 | 代码 + 405/404 断言（check 在白名单） | server.js；test:105-125 | ✅ |
| 10 | §6.4 临时密码只在响应出现一次、不进日志 | 代码审查（logger 无密码字段） | server.js | ✅ |
| 11 | §7.12 两个新测试入主链 + npm test/build/scan | 亲自重跑 | npm test 65 文件/529 项 fail 0；api 22；email-auth 9；cli ✓；build ✓；scan 干净 | ✅ |
| 12 | 纪律：无新 tag / 无产物入提交 / 已推 main / OVERVIEW+DELIVERY 同步 | git 取证 | 无新 tag；origin/main=fba4097 | ✅ |

## 亲自重跑验证（2026-11-09）

```
npm test                → 65 个文件 / pass 529 / fail 0
node test/api.test.js   → pass 22 / fail 0
node test/email-auth.test.js → pass 9 / fail 0
node test/cli-dispatch.test.js → pass 0 fail（全过）
npm run frontend:build  → ✓
npm run scan            → ✅ 未发现高置信度凭据 / 未发现可疑密钥赋值
```

## 打回清单

无。

## 需人工确认

1. 真实邮箱收到注册验证码（本地假 SMTP 验证协议对话，真实服务商送达需上线确认）；
2. 注册开关关闭时前端页面表现由 AL 批实现（本批只保证接口 403/503）。

## 争议项

无。

## 复检记录

- 第 1 轮（2026-11-09）：开发自测阶段修复 3 处（注册路由未检查 sendMail 结果、假 SMTP 缺 AUTH 分支、EHLO 多行格式），复检通过。
