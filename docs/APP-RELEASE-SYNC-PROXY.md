# App Release 同步代理支持（已实现待发版）

> 状态：**已实现待发版（2026-11-20 开发完成，待质检与发版）**。
> 关联：[APP-SYNC-404.md](APP-SYNC-404.md)（同步 404 修复）、[APP-INSTANT-UPDATE.md](APP-INSTANT-UPDATE.md)（立即同步）、
> 站点设置体系 `src/settings.js`（DB > env > 默认、热加载）。

## 1. 已确认的决策

| # | 决策 |
|---|---|
| 1 | 核心逻辑（所有者 2026-11-20 确认）：**有代理配置则走代理，没有代理配置则直连 GitHub**。 |
| 2 | 新增**专用**设置项 `network.appSyncProxy`（env `APP_RELEASE_SYNC_PROXY`），只作用于 App Release 同步的资产下载；不复用 `network.httpsProxy`（会波及 itad/gog/humble/images 等全部非 Steam 出站）。 |
| 3 | 复用 `src/http.js` 的 `proxyAgentOptions` + `undici.ProxyAgent`（零新依赖）。 |
| 4 | 走代理时下载超时 30s；直连保持现状 10s。仅支持 http/https。 |
| 5 | 生产建议值 `http://<代理主机>:<端口>`（容器内美区 sidecar，2026-11-20 实测可拉 GitHub 资产）；部署时在后台设置页填写，最终以部署时为准。 |

## 2. 背景（线上缺陷，2026-11-20）

- `app-release-sync`（每 15 分钟）连续失败：`reason=apk_download / latest_download`，`message="The operation was aborted due to timeout"`——大陆服务器直连 GitHub 资产域名（`release-assets.githubusercontent.com`）超时（实测宿主机下载 756B 需 3.3s，波动时超过下载超时 10s 撞线）。
- 站点容器网络内已有美区代理 sidecar（`STEAM_PROXY=http://<代理主机>:<端口>`，Steam 采集同款通路），但同步下载是裸 `fetch`（`src/app-release.js` `doFetch = fetchImpl ?? fetch`），不走代理。
- 性质：**🐞 线上缺陷修复**（现有同步功能在生产跑不通），非新功能面；手工兜底（`undici.ProxyAgent` 强制走 sidecar 下载后 `docker cp`）2026-11-20 已验证通路可用。

## 3. 服务端

- `src/app-release.js` `syncAppRelease` 新增选项 `proxy`（默认 `process.env.APP_RELEASE_SYNC_PROXY`，空字符串=直连）。
  下载函数（latest.json / APK / sha256 三处）在 `proxy` 非空时改用 `undici.fetch` + `ProxyAgent(proxyAgentOptions(proxy))`
  （`proxyAgentOptions` 与 `undici` 均复用 `src/http.js`），该次下载超时 30s；`proxy` 为空时保持现状（全局 fetch、10s）。
- 日志：下载前记 `app.release_proxy`（`{ via: 'proxy' | 'direct', proxy: redactProxy(url) }`——复用 http.js 的 `redactProxy` 打码）；失败事件名不变（`latest_download` / `apk_download`，带 message）。
- 生效路径：设置热加载（hydrate 写回 env，约 15s）→ 调度任务子进程 `app-sync`（每 15 分钟）启动时继承 env；CLI `node src/cli.js app-sync` 同入口同样生效。
- **不新建调度任务**：这是对现有 `app-release-sync` 任务的增强（合并评估：目标数据就在该任务自己的下载环节，无需新请求形态、无配额影响）。

## 4. 设置与配置

- `def('network.appSyncProxy', 'APP_RELEASE_SYNC_PROXY', 'network', 'App 同步专用代理', 'secret', '', { help: '只作用于 GitHub Release 资产下载（latest.json/APK/sha256）；留空直连。仅支持 http/https，如 http://<代理主机>:<端口>。' })`
- 后台「系统设置 → 网络」组由 def 自动渲染，无新页面设计（不触发 demo 硬规则）。

## 5. 安全

- secret 类型加密存储（`app_settings.secret_enc`，SECRET_KEY 派生解密）；日志与健康视图一律 `redactProxy` 打码；仅 http/https（沿用 `parseProxy` 校验语义）。

## 6. 验收（6 条）

1. 设置页网络组出现「App 同步专用代理」；保存后 getPublicSettings 可见（热加载 ~15s）。
2. 配代理：三件套下载走代理——单测注入 fake fetch 断言收到 `opts.dispatcher`（ProxyAgent）；日志 `app.release_proxy` via=proxy 且地址打码。
3. 留空：行为与现状完全一致（无 dispatcher、直连、10s 超时）——回归用例。
4. 反向自检：把「配代理走直连」与「留空走代理」的断言改反，测试必须红。
5. 代理不可用：reason 仍为 `latest_download` / `apk_download` 且 message 可见；任务健康条红（A5 接线不变）。
6. 通用：相关段 `npm test` 全绿 + `frontend:build` + `npm run scan`；线上验证（部署后）：后台填 `http://<代理主机>:<端口>` → 下一轮同步出现 `app.release_synced`（version 2.24.1）。

## 7. 实施顺序

1. `src/settings.js` 加 def（+ `test/settings.test.js` 断言新 key）；
2. `src/app-release.js` 下载路径改造 + `app.release_proxy` 日志；
3. `test/app-release.test.js` / `test/app-release-sync.test.js` 按 fetch 注入模式加代理/直连/反向用例；
4. 交付时同步 `docs/PROJECT-OVERVIEW.md` 功能落点行。

## 8. 待确认问题

无。生产代理值以部署时后台填写为准（建议 `http://<代理主机>:<端口>`，2026-11-20 实测可用）。
