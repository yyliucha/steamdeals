# CSP 安全加固（EN，已实现并发布 v2.28.10，2026-11-24 所有者决策）

> 所有者决策（2026-11-24）：CSP **默认直接切正式（enforce）**，同时保留 `report-only` 观察档与 `off` 紧急关闭档；
> 允许清单按 `csp.violation` 日志收敛（实现见 §2 的三档设计）。
> **实现状态（v2.28.10，commit 5c637a1/bce21bd）**：`src/server.js` 三档 CSP + per-request nonce + 严格档 hash；
> `src/settings.js` 模式设置项（热加载）；`POST /api/csp-report` 违规上报 → `csp.violation` 日志；`test/csp.test.js` 11 条。

## 1. 现状（代码证据）

- `grep -r "Content-Security-Policy" src/` → 零命中（无 CSP）；
- ROADMAP「安全排查结论」三件套：`x-forwarded-host` 信任门（steam-login.js）✅、`VISITOR_GEO=0` 开关（visitors.js）✅、
  **CSP 未落地**（本条目）；
- 外部资源来源（allowlist 依据）：本站 CDN 图片（`/img/steam/...` 自代理）、Google Fonts？（需核对）、
  支付/跳转链接（仅 `<a>` 外链，不需要 CSP 放行）、企业微信/邮件为服务端出站（无关）。

## 2. 方案（三档，默认正式）

### 默认：正式（enforce）
- 中间件对所有响应输出正式 `Content-Security-Policy`（默认 `mode=enforce`）：SPA 用严格档（`self` + `'nonce-…'` + 内联样式 hash，
  不放 `'unsafe-inline'`），旧 `web/` 回退页用兼容档；
- 内联脚本（封禁页/申诉页注入）带 per-request nonce 放行；
- 违规上报：`report-to`/`report-uri` → `POST /api/csp-report`，只记 `csp.violation` 日志（不落敏感数据）。

### 可选一：观察（report-only）
- 把同一套策略以 `Content-Security-Policy-Report-Only` 输出，只收集违规不改行为——供收敛 allowlist 期间使用。

### 可选二：关闭（off）
- 紧急回滚用：只关 CSP，不影响其它安全头与业务。

### 策略要点（保守）
- `default-src 'self'`；
- `img-src 'self' data: https:`（图片走本站代理 + 少量外部图标）；
- `script-src 'self'`（Vue 构建产物；**不用 unsafe-inline**，内联脚本靠 nonce/hash）；
- `style-src 'self' 'unsafe-inline'`（Element Plus 内联样式）；
- `connect-src 'self'`（API 同源）；`font-src 'self' data:`；
- `frame-ancestors 'none'`；`base-uri 'self'`；`object-src 'none'`；
- 需要与现有 302/静态资源/`/img` 代理路径验证不误伤。

## 3. 验收

1. 默认正式（enforce）上线后：页面/后台/App WebView 核心功能正常（登录、列表、图片、支付跳转），控制台无阻断性 CSP 报错；
2. 可切 `report-only` 观察档（违规可查 `csp.violation` 日志）与 `off` 紧急关闭档，切换在设置保存后热加载生效；
3. `curl -I` 能看到 `Content-Security-Policy` 头；
4. `npm test`（分段）+ `frontend:build` + `scan` 全绿；截图/curl 证据。
