# QA：CI 提醒邮件 HTML + 申诉页视觉对齐（第 1 轮）

> 基线 f65c09c → HEAD 待提交；判据 [ALERT-MAIL-APPEAL-UX.md](ALERT-MAIL-APPEAL-UX.md) §9。
> 结论：✅ 放行 —— 通过 3 / 缺失 0 / 偏差 0 / 需人工确认 1

## 功能清单（用户视角，一条一行）

| # | 编号 | 功能 | 入口 | 状态 | 证据 |
|---|---|---|---|---|---|
| 1 | CI-1 | 到价提醒邮件为 HTML（品牌头+逐条卡片+Steam 链接，multipart 两段）；webhook/企微仍纯文本 | 邮件通道 | ✅ | src/alerts-html.js；cli.js deliver 多传 html；test/alerts-html.test.js |
| 2 | CI-1 | 动态字段转义（`<>&`）、无外部资源、纯文本兜底保留 | 邮件渲染 | ✅ | alerts-html.test.js 转义/无外链断言 |
| 3 | CI-2 | 申诉页分段控件主色选中 + 卡片式空态 + 「到期」并入封禁原因副行 + 移动卡片不变 | 后台 → 申诉管理 | ✅ | AppealsAdmin.vue（seg-tabs/empty/到期合并）；alerts-html.test.js 静态断言 |
| 4 | 通用 | npm test 92 文件 0 fail / frontend:build ✓ / scan 干净 | — | ✅ | 实跑输出 |

## 需人工确认
- 邮件在真实邮箱（QQ/163/企业微信邮箱）的渲染效果与申诉页视觉按效果图目视核对（部署后由所有者确认）。

## 复检记录
- 第 1 轮（2026-11-17）：实跑 npm test（NPM_EXIT=0）/ frontend:build / scan → ✅ 放行。
