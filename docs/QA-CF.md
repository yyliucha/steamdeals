# QA：CF 后台体验与安全策略（第 1 轮）

> 基线 0483ef0（CA-1 提交）→ HEAD 31483fb（CF 实现）；判据 [ADMIN-UX-SECURITY.md](ADMIN-UX-SECURITY.md) §6 验收 1–12 + [TODO.md](TODO.md) CF 条目。
> 结论：✅ 放行 —— 通过 12 / 缺失 0 / 偏差 0 / 需人工确认 1

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口 | 状态 | 证据 |
|---|---|---|---|---|---|
| 1 | CF | 桌面 Steam 账号页不再出现重复卡片（移动卡片分支只对手机生效） | 后台 → 账号与数据 → Steam 账号 | ✅ | AdminExtras.vue `<template v-else-if="isMobile">`；admin-ux-security.test.js |
| 2 | CF | 申诉管理：筛选行左侧分段（待处理(N)/已处理/全部）+ 右侧刷新；标题区只留说明 + 「邮件处理说明」 | 后台 → 访问与安全 → 申诉管理 | ✅ | AppealsAdmin.vue（appeal-filter-row + showMailNote）；admin-ux-security.test.js |
| 3 | CF | 游戏管理只显示 4 个主指标（目录/已同步/有报价/待回填），其余 12 项收进「更多指标」折叠 chips；表格上移 | 后台 → 游戏管理 | ✅ | AdminModules.vue（metric-grid 4 卡 + details.more-metrics 12 chips）；admin-ux-security.test.js |
| 4 | CF | 普通超频只 429（不封禁、不三振）；strict 模式默认开启 | 全站请求 | ✅ | ratelimit.js（mode strict/off/legacy）；ratelimit.test.js strict/off/legacy 三用例 |
| 5 | CF | 漏洞路径探测：10 分钟内 ≥3 个不同签名路径 → 自动临时封 + 审核记录 | 服务端自动 | ✅ | auto-ban.js recordPathSignature + server 接入；auto-ban.test.js |
| 6 | CF | 登录凭据爆破：同 IP 15 分钟失败 ≥50 → 自动临时封（20 次起仍 429、账号 5 次锁不变） | 服务端自动 | ✅ | auto-ban.js recordCredentialFail + web/token 登录双接入；auto-ban.test.js |
| 7 | CF | 极端频率：任一桶 5 倍阈值连续 2 个窗口 → 自动临时封；单窗口只 429 | 服务端自动 | ✅ | auto-ban.js recordRateOver + server 429 分支；auto-ban.test.js |
| 8 | CF | 异常 UA 名单：10 分钟 ≥2 次 → 自动临时封；空 UA 只进审核 | 服务端自动 | ✅ | guard.js ua-list/empty-ua + server 接入；guard.test.js 3 用例 |
| 9 | CF | 阶梯封禁 10min→1h→1d 封顶、跨天重置、永不自动永久；白名单豁免 | 服务端自动 | ✅ | auto-ban.js applyAutoBan（ladder 读 ip_abuse strike_day）；auto-ban.test.js 阶梯用例 |
| 10 | CF | 审核证据抽屉：规则/路径样本/UA/地区/首末/申诉状态；四操作（临时封 10min/1h/1d、永久封、信任、忽略）全部审计 | 后台 → 访问记录 → 异常审核 | ✅ | server.js `/api/admin/reviews/act` + 证据补充（region/last_ua/appeal_status）；AdminModules.vue 行内四按钮 + 证据字段 |
| 11 | CF | 申诉对所有封禁类型开放；未被封访问只提示「当前未被封禁，无需申诉」不展示表单；提交接口校验封禁上下文 | /appeal 页 | ✅ | AppealPage.vue（/api/ban/state + 提示）；server.js 提交校验 + BAN_ONLY_PAGES 移出 /appeal |
| 12 | CF | 设置 security.autoBan.* 8 项热加载（mode/阈值/UA 名单/阶梯）；自动封禁记录显示来源标签 | 后台 → 系统设置 → 安全 | ✅ | settings.js 8 defs + server 启动 configureFromEnv；AdminModules.vue abuseSourceLabel |

## 逐条核对（规格 §6 验收 → 证据）

| # | 验收 | 检查手段 | 证据 | 判定 |
|---|---|---|---|---|
| 1 | 图二 bug：桌面无重复卡片、移动只卡片 | grep + 静态断言 | AdminExtras.vue（v-else-if="isMobile"）；admin-ux-security.test.js「CF 图二」 | ✅ |
| 2 | 图一：筛选行左分段右刷新 | grep | AppealsAdmin.vue appeal-filter-row | ✅ |
| 3 | 图三：4 主指标 + 更多指标折叠 + 表格上移 | grep | AdminModules.vue metric-grid 4 卡 + details 12 chips | ✅ |
| 4 | 普通超频 121/151 → 429 不封 | 单测 | ratelimit.test.js strict：over=true、bannedUntil=null、不写 ip_abuse | ✅ |
| 5 | 漏洞探测 ≥3 签名 → 自动封 10 分钟 + 审核；白名单不受影响 | 单测 | auto-ban.test.js（3 规则触发；whitelist 豁免） | ✅ |
| 6 | 凭据爆破 ≥50 → 自动封；20–49 只 429；账号锁不变 | 单测 + 代码 | auto-ban.test.js；server.js 两登录入口 recordCredentialFail | ✅ |
| 7 | 极端频率 5 倍 × 2 窗口 → 封；单窗口 429 | 单测 | auto-ban.test.js recordRateOver（窗口注入） | ✅ |
| 8 | UA 名单 ≥2 → 封；空 UA 只审核 | 单测 | guard.test.js 3 用例 | ✅ |
| 9 | 阶梯 10min/1h/1d、跨天重置、永不永久、手动解封/转永久 | 单测 | auto-ban.test.js 阶梯用例（第 4 次仍 1d） | ✅ |
| 10 | 证据抽屉 + 四操作 + 审计 | 代码 + api 测试 | server.js reviews/act（tempban/permban/trust/ignore + review.action 审计）；api.test.js 26/26（含既有审核） | ✅ |
| 11 | 申诉开放 + 未封提示 + mode=off 只 429+审核 | 代码 + 测试 | AppealPage.vue / server.js 400 校验 / ratelimit off 用例 | ✅ |
| 12 | npm test / frontend:build / scan 全绿 | 实跑 | npm test 90 文件 0 fail（NPM_EXIT=0）；frontend:build ✓；scan 干净 | ✅ |

## 四方一致

- 后端：auto-ban.js ↔ server.js（recordRateOver/recordPathSignature/recordUaHit/recordCredentialFail/applyAutoBan 全部接线）✅
- 前端：AppealsAdmin/AdminExtras/AdminModules/AppealPage 四处改动 + ElDropdown 三处注册 ✅
- 测试：主链新增 auto-ban.test.js（7 项）+ admin-ux-security.test.js（6 项）；扩展 ratelimit/guard/appeal-security/reviews/setup/settings/admin-links-drawer ✅
- 文档：TODO/INDEX/ADMIN-UX-SECURITY/PROJECT-OVERVIEW 同步（开发中 → 已实现待发版随提交）✅

## 需人工确认

- 验收 4/5/6/7/8 的线上效果（真实扫描器/共享出口场景）需部署后观察 `auto_ban.applied` 日志与误封率；本地只能单测验证触发逻辑。
- 图一/图三的视觉还原度以效果图 [design/admin-ux-security-2026-11-16.png](design/admin-ux-security-2026-11-16.png) 为准，需所有者目视确认。

## 复检记录

- 第 1 轮（2026-11-17）：实跑 `npm test` 90 文件 0 fail（NPM_EXIT=0，修复 AO 静态断言后重跑全绿）；
  `node test/api.test.js` 26/26；`npm run frontend:build` ✓ 2.70s；`npm run scan` 干净 → ✅ 放行。
