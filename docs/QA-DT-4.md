# QA：DT-4 验证码体验（冷却隔离 + 倒计时 + 重置密码弹窗）（第 1 轮）

> 基线 403e6f2（DT-2 提交后）→ HEAD（本 worktree 分支 wt-228-front 未提交改动）；判据 docs/ADMIN-PERMISSIONS.md「DT-4」节 + demo design/admin-users-2026-11-19.html ③；开发描述来源：夜班监工派发（worker-1-front）。
> 结论：✅ 放行 —— 通过 8 / 缺失 0 / 偏差 0 / 需人工确认 1

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | DT-4 | 验证码冷却按场景分桶：后台「重置密码发码」不占用前台登录/注册/重置发码额度（反之亦然） | 登录/注册/忘记密码页 + 后台用户管理重置弹窗 | ✅ | auth-routes.js + server.js reset-code；反向自检实测 |
| 2 | DT-4 | 发码接口（成功/429）返回 retryAfterSec 供前端倒计时 | 同上接口 | ✅ | email-auth.test.js 断言 retryAfterSec=60 |
| 3 | DT-4 | 所有验证码按钮统一三态：发送中…/剩余秒数/可重发 | 登录页、注册页、后台重置弹窗 | ✅ | auth-pages.test.js DT-4 验收 1 |
| 4 | DT-4 | 重置密码弹窗打开不发码，点「发送验证码」才发 | 后台 → 用户管理 → 重置密码 | ✅ | auth-pages.test.js DT-4 验收 2 |
| 5 | DT-4 | 验证失败不关弹窗，显示「还剩 N 次机会」；过期显示「重新发送」（冷却结束可点） | 同上弹窗 | ✅ | auth-pages.test.js DT-4 验收 3 + server.js 响应字段 |
| 6 | DT-4 | 验证码通过后重置：临时密码只回一次 + 踢全部会话 + 审计 | 同上弹窗「确认重置」 | ✅ | email-auth.test.js 后台验证码模式用例 |

## 逐条核对（规格验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | 后台发码后前台登录不被冷却拦截（分桶） | 真 HTTP：同邮箱 login 发码 → reset 发码 200 → admin_reset 发码 200；同场景 429 | test/email-auth.test.js「DT-4 分桶」 | ✅ |
| 2 | 倒计时正确（retryAfterSec） | 真 HTTP 断言成功 60 / 429 1..60；前端读 d.retryAfterSec 兜底 60 | email-auth.test.js + auth-pages.test.js | ✅ |
| 3 | 失败不关弹窗（还剩 N 次机会） | 真 HTTP 错码 remainingAttempts 递减（5→2）；前端 catch 不关弹窗文案 | email-auth.test.js + auth-pages.test.js | ✅ |
| 4 | 过期可重发 | 后端 expired 提示「请重新发送」；前端 codeSent 状态按钮变「重新发送」 | server.js + AdminExtras.vue + auth-pages.test.js | ✅ |
| 5 | 重开弹窗不自动发码 | 前端 openResetPassword 重置倒计时/状态；发码只在 sendResetCode | auth-pages.test.js DT-4 验收 2 | ✅ |
| 6 | 同场景冷却仍生效 | 真 HTTP：admin_reset 连发第二次 429 | email-auth.test.js「DT-4 分桶」 | ✅ |
| 7 | 权限：发码/验证码重置仅管理员 | 真 HTTP 匿名 401 / 普通用户 403 | email-auth.test.js「DT-4 分桶」第 6 步 | ✅ |
| 8 | 动过 API 必跑 api.test.js | 重跑 38/38 | 见下 | ✅ |

## 重跑验证（QA 亲自重跑）

- `node test/email-auth.test.js` → `# pass 11 / # fail 0`（新增 DT-4 组 2 用例）✅
- `node test/auth-pages.test.js` → `# pass 14 / # fail 0`（新增 DT-4 组 4 用例）✅
- `node test/admin-users.test.js` → `# pass 6 / # fail 0` ✅
- `node test/register.test.js` → `# pass 4 / # fail 0` ✅
- `node test/email-change.test.js` → `# pass 7 / # fail 0` ✅
- `node test/api.test.js` → `# pass 38 / # fail 0` ✅
- **反向自检（分桶）**：把 auth-routes.js 冷却查询退化成 `where email = $1`（不分 purpose）→
  `not ok 11 - DT-4 后台重置密码验证码模式…`（fail 1：admin_reset 发码被前台冷却拦截），恢复后 11/11 全绿 ✅
- `npm run frontend:build` → `✓ built in 4.48s` ✅（沙箱补丁变体，同前轮说明）
- `npm run scan` → `✅ 未发现高置信度凭据` ✅

## 打回清单

无。

## 需人工确认

- 页面目视：三个页面的按钮三态切换、弹窗倒计时与错误文案实际渲染，本地无 headless 渲染环境
  （沙箱 spawn 限制），由 DT 批整体验收兜底。

## 争议项

- 后台重置密码发码/校验接口（POST /api/admin/users/:u/reset-code 与 /api/admin/users/:u/password 的
  code 模式）落在 src/server.js 管理段——该段属 B4 队列 #11（admin 用户批量域，未拆），监工「不动
  server.js」的约束上下文是 DT-2 的 me/watchlist 端点；DT-4 的后台接口无域可放（auth.js 主段无
  requireAdmin 上下文），按规格优先落在 server.js 原管理段，特此说明。
- 既有断言更新一处：auth-pages.test.js 原「重置留空生成临时密码（ElMessageBox.prompt 校验放行空值）」
  锁的是旧 prompt 交互，被 DT-4 规格（demo ③ 验证码弹窗）取代——断言已更新为锁新弹窗的
  「确认重置走验证码校验」，旧直设密码后端模式保留（POST password 不带 code）。

## 复检记录

- 第 1 轮（2026-11-20）：8/0/0/1 → ✅ 放行。

## 备注

- TODO 状态由监工统一回写（夜班工人纪律：不改 docs/TODO.md 及任何共用文档）。
- 邮箱验证码的 IP 小时上限与全站每日上限仍全局（不分桶）——防轰炸语义与场景无关，保持现状。
