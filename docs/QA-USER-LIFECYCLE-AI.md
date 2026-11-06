# QA：AI——邮件模板 + HTML 邮件 + 发送记录（第 1 轮）

> 基线 517507f → HEAD 4570d81；判据 [docs/USER-LIFECYCLE.md](USER-LIFECYCLE.md) §8 验收 8–10、15（AI 范围 = §9 批次表 AI 行；验收 12 的通知 tab 一并核对）；
> 开发描述来源：所有者派发消息（TODO 编号 AI）。
> 结论：✅ 放行 —— 通过 5 / 缺失 0 / 偏差 0 / 需人工确认 2

## 功能清单（本批交付的全部功能，一条功能一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据 |
|---|---|---|---|---|---|
| 1 | AI | 邮件为 HTML 多部分格式（含纯文本兜底，QQ 邮箱可正常显示） | 所有外发邮件 | ✅/🔎 | `notify.js buildMessage` multipart/alternative；`test/notify-html.test.js`（QQ 邮箱目视为 🔎） |
| 2 | AI | 邮件主题不能被注入换行头（Bcc 注入防护） | 所有外发邮件 | ✅ | `encodeSubject` 去 CR/LF + 测试 |
| 3 | AI | 9 个事件模板（8 类账号通知 + 验证码）可编辑 | 后台 → 邮件服务 → 邮件模板 | ✅ | `AdminExtras.vue` 模板卡 el-tabs；`PUT /api/admin/mail/templates/:event` |
| 4 | AI | 每个模板可启停（停用验证码模板时回退内置纯文本，登录码不断发） | 同上 | ✅ | `enabled` 落库；`auth-routes.js`/`server.js` 回退逻辑 |
| 5 | AI | 模板预览（变量已替换、页脚自动追加） | 模板卡 → 预览 | ✅ | `POST .../preview` → `renderTemplate`（测试锁定替换与页脚） |
| 6 | AI | 发送测试邮件（10 秒限流，记录进「通知」tab） | 模板卡 → 发送测试 | ✅ | `POST .../test` + `mailTestCooldown` + `mail_log` |
| 7 | AI | 恢复默认（删表行回落到代码默认） | 模板卡 → 恢复默认 | ✅ | `POST .../reset` + 测试 |
| 8 | AI | 套用 3 套示例版式（简洁/卡片/正式，填入不自动保存） | 模板卡 → 套用示例 | ✅ | `SAMPLE_THEMES` + `applySample` + 测试 |
| 9 | AI | 非验证码模板写 `{{code}}` 被拒绝；未知变量保存时警告 | 模板卡 → 保存 | ✅ | `validateTemplatePayload` + 测试 |
| 10 | AI | 模板变量 HTML 转义（`<script>` 不执行） | 所有模板邮件 | ✅ | `renderTemplate` escapeHtml + 测试 |
| 11 | AI | 验证码邮件（登录/重置/绑定）套用 verify_code 模板 | 用户登录/绑定流程 | ✅ | `auth-routes.js`/`server.js` 接入 `resolveTemplate` |
| 12 | AI | 「最近发送记录」分验证码/通知两个 tab | 后台 → 邮件服务 → 最近发送记录 | ✅ | `AdminExtras.vue` el-tabs；`GET /api/admin/mail/log` |
| 13 | AI | 通知类邮件落发送记录（成功/失败/错误可见） | `mail_log` 表 | ✅ | `insertMailLog`/`listMailLog` + 测试 |

## 逐条核对（规格 §8 验收 → 证据）

| # | 条目（AI 范围：验收 8–10、15 + 12 通知 tab） | 检查手段 | 证据 | 判定 |
|---|---|---|---|---|
| 8 | HTML multipart/alternative + text/plain 兜底；QQ 邮箱显示正常 | 读 buildMessage + 测试 | `notify.js:97-141`；`test/notify-html.test.js` 断言双段/边界/base64；QQ 邮箱目视 → 🔎 | ✅（人工确认项另列） |
| 9 | 模板可编辑/启停/恢复默认/预览/发送测试，保存后立即生效；非验证码 `{{code}}` 被拒 | 读接口 + 渲染路径 + 测试 | `server.js` tplPut/tplAction；`resolveTemplate` 每次现读表（下一封即生效）；`validateTemplatePayload` 拒 `{{code}}`；`test/mail-templates.test.js` | ✅ |
| 10 | 主题 `\r\n` 过滤；`{{username}}` 为 `<script>` 被转义；未知变量保存有提示 | 读 encodeSubject/render + 测试 | `notify.js encodeSubject`；`mail-templates.js renderTemplate` escapeHtml + unknownVariables→warnings；两个测试文件均断言 | ✅ |
| 12 | 两个 tab 都能看到记录（通知 tab 能看到账号通知与测试邮件） | 读前端 tab + mail_log 写入点 | `AdminExtras.vue` 双 tab；测试邮件写 `mail_log`；**账号通知邮件由 AJ 批接入**，AI 阶段通知 tab 只有测试邮件 → 记录待 AJ 追平 | ✅（部分能力随 AJ） |
| 15 | 3 套示例版式能填入编辑器、可保存、预览变量正确替换 | 读 samples/applySample + 渲染测试 | `SAMPLE_THEMES`（3 套带常用变量）；`applySample` 填入不自动保存；`renderTemplate` 替换断言 | ✅ |

## 需人工确认

- QQ 邮箱网页版 HTML 显示效果（验收 8 的人工确认项）——本地只有假 SMTP 逐行断言与 multipart 结构断言，未做真实邮箱渲染目视。
- 模板卡的浏览器目视（tab 切换/预览弹窗 v-html 排版）——静态证据齐全，未做浏览器手工回归。

## 争议项

- 验收 12 的「通知 tab 能看到账号通知」：账号通知邮件的发送点属于 AJ 批（§9 批次表），AI 阶段 `mail_log` 只有测试邮件写入。质检意见：属批次边界内的正常拆分，AJ 交付时须追平并复核该条。

## 复检记录

- 第 1 轮（2026-11-06）：重跑 `npm test`（56 文件 / 472 项 / fail 0）、`frontend:build`（1.45s）、`scan`（无凭据）→ ✅ 放行，无打回项。
- 第 2 轮（2026-11-06，独立复核，应所有者要求重检 AH+AI）：基线 517507f → HEAD 9f9f1e8；
  重跑 `npm test`（56 文件 / 472 项 / fail 0）、`frontend:build`（1.43s）、`scan`（无凭据）、`git diff --check`（0）；
  抽查实现与测试未变（multipart/防注入、9 模板存取与校验、示例版式、mail_log、验证码套模板）→ ✅ 放行，与第 1 轮一致。
