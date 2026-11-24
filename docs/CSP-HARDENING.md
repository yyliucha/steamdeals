# CSP 安全加固（EN，待开发，2026-11-24 所有者决策）

> 所有者决策（2026-11-24）：CSP **切正式** + 允许清单按 Report-Only 日志收敛。
> 注意：当前代码 `src/` 下**没有任何 CSP 实现**（连 Report-Only 都没有）——需按两步走：
> ① 上 Report-Only 收集违规；② 按日志收敛 allowlist；③ 切正式。

## 1. 现状（代码证据）

- `grep -r "Content-Security-Policy" src/` → 零命中（无 CSP）；
- ROADMAP「安全排查结论」三件套：`x-forwarded-host` 信任门（steam-login.js）✅、`VISITOR_GEO=0` 开关（visitors.js）✅、
  **CSP 未落地**（本条目）；
- 外部资源来源（allowlist 依据）：本站 CDN 图片（`/img/steam/...` 自代理）、Google Fonts？（需核对）、
  支付/跳转链接（仅 `<a>` 外链，不需要 CSP 放行）、企业微信/邮件为服务端出站（无关）。

## 2. 方案（两步 + 切正式）

### 第一步：Report-Only + 违规收集
- 中间件加 `Content-Security-Policy-Report-Only`（默认策略，保守 allowlist）；
- 违规上报：`report-to`/`report-uri` 到本站端点（如 `POST /api/csp-report`，只记日志不落敏感数据），
  或仅 `console`/日志（先简单：记录到 logger `csp.violation`）；
- 观察 3–7 天，按日志收敛 allowlist（去掉未用来源、补必要来源）。

### 第二步：切正式
- 收敛后的 allowlist 写为正式 `Content-Security-Policy`；
- 保留违规上报端点（生产可选开启）；
- 策略要点（保守）：
  - `default-src 'self'`；
  - `img-src 'self' data: https:`（图片走本站代理 + 少量外部图标）；
  - `script-src 'self'`（Vue 构建产物；**不用 unsafe-inline**，若 Element Plus 内联样式需要 `style-src 'self' 'unsafe-inline'`——按实测）；
  - `style-src 'self' 'unsafe-inline'`；
  - `connect-src 'self'`（API 同源）；
  - `font-src 'self' data:`；
  - `frame-ancestors 'none'`；`base-uri 'self'`；`object-src 'none'`；
- 需要与现有 302/静态资源/`/img` 代理路径验证不误伤。

## 3. 验收

1. Report-Only 上线后：页面无功能性破坏；违规日志可查（`csp.violation`）；
2. 按 3–7 天日志收敛后的 allowlist 切正式：页面/后台/App WebView 核心功能正常（登录、列表、图片、支付跳转）；
3. `curl -I` 能看到 `Content-Security-Policy` 头；
4. `npm test`（分段）+ `frontend:build` + `scan` 全绿；截图/curl 证据。
