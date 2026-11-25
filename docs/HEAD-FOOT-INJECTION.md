# 站点 head/foot 注入（后台可配置）（FV，待开发，2026-11-25）

> 所有者建议（2026-11-25）：后台做可配置的「head 注入 / foot 注入」（类似 Halo 主题的 head/footer 代码），
> 以后 RUM（腾讯云前端监控）、统计脚本等直接后台填，不用改代码发版。

## 1. 现状

- SPA 页面（`/`、`/console` 等 `FRONTEND_PAGES`）由 `serveFrontendStatic()` → `serveStatic(res, frontendDir, '/index.html')`
  **原样发送** dist/index.html（无注入点）；
- 封禁页/申诉页已有「per-request nonce 注入内联脚本」的先例（`res.cspNonce`）；
- 设置项机制可扩展（`src/settings.js` 的 `def()` + 后台自动渲染）。

## 2. 需求

1. **设置项**（后台「站点与内容」分组，`text` 类型多行）：
   - `site.headInjection`（env `SITE_HEAD_INJECTION`）：注入到 `</head>` 之前；
   - `site.footInjection`（env `SITE_FOOT_INJECTION`）：注入到 `</body>` 之前；
   - 默认空；仅管理员可改；help 说明「原样 HTML 注入，仅填可信代码」；
2. **注入实现**：
   - `serveFrontendStatic` 对 `FRONTEND_PAGES` 分支改为：读 dist/index.html → 注入 head/foot → 发送（无配置时保持原静态发送）；
   - 注入内容中的**内联 `<script>` 自动打 nonce**（`res.cspNonce`，CSP 严格档兼容）；外部 `<script src>` 不动；
   - 缓存：`cache-control: no-cache`（或按内容 hash 的 ETag），避免注入内容更新后客户端拿旧 HTML；
3. **RUM 用例**：后台填腾讯云 RUM 的 script 标签（SDK + 初始化），保存后刷新页面即生效（无需发版）；
4. **安全**：管理员信任内容；限制注入长度（如 ≤ 20KB）；不注入到 API/静态资源；CSP 严格档下 nonce 由服务端处理。

## 3. 验收

1. 后台设置页出现「Head 注入 / Foot 注入」两个多行输入框，保存后：
   - 前台页面源码在 `</head>`/`</body>` 前出现注入内容；刷新生效；
2. 未配置时页面与现在完全一致（HTML 字节级相同，除 no-cache 头）；
3. 注入含内联 `<script>` 时，严格 CSP 档下带 nonce 正常执行（控制台无 CSP 报错）；
4. 注入外部 script（如 RUM SDK）可正常加载并上报；
5. `npm test`（分段）+ `frontend:build` + `scan` 全绿；截图/源码核对。
