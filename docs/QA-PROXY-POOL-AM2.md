# QA：Steam 代理池设置页（AM-2 批，第 1 轮）

> 基线 52fe8a4 → HEAD 2f7434a；判据 [docs/PROXY-POOL.md](PROXY-POOL.md) §5 / §7 验收 8、9（AM-2 范围）；
> 开发描述来源：开发会话汇报（b7c49df 代码 + 2f7434a 文档）。
> 结论：✅ 放行 —— 通过 10 / 缺失 0 / 偏差 0 / 需人工确认 1

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | AM-2 | 「网络与代理」显示已配置 N 条（未配置时提示走直连/通用代理） | 后台 → 系统设置 → 网络与代理 | ✅ | AdminModules.vue（proxy-count 模板） |
| 2 | AM-2 | 「查看并编辑」把多条代理装进可编辑列表（明文走现有查看通道） | 同上 → 查看并编辑 | ✅ | AdminModules.vue（revealProxyList + settings/value?key=network.steamProxy） |
| 3 | AM-2 | 每行可上移 / 下移 / 删除；底部 添加一条（满 10 置灰）/ 清空全部 | 同上 | ✅ | AdminModules.vue（moveProxy/removeProxy/addProxy/clearProxyList） |
| 4 | AM-2 | 保存 = 非空行按顺序换行提交；清空传 null；非法行前端报行号、最多 10 条 | 同上 → 保存设置 | ✅ | AdminModules.vue（saveSettings 代理分支）+ settings.js:320-330 服务端兜底 |
| 5 | AM-2 | 保存后下一次请求即生效（服务端同请求内重新水合 env） | 保存后自动 | ✅ | settings-routes.js:29-35（saveSettings → hydrateSettings） |
| 6 | AM-2 | 健康状态表：代理 / 状态 / 连续失败 / 冷却到 / 最近错误（地址脱敏） | 网络与代理下方 | ✅ | AdminModules.vue（proxy-health 表）+ GET /api/admin/proxies |
| 7 | AM-2 | 状态三色：正常（绿）/ 冷却中 mm:ss 倒计时（黄）/ 未知（灰） | 同上 | ✅ | proxyStateType/proxyStateText + healthNow 秒级 tick |
| 8 | AM-2 | 「刷新」按钮 + 分组展开且页面可见时每 10 秒自动刷新 + 保存后立即刷新 | 同上 | ✅ | loadProxyHealth + proxyTick%10===0 + document.hidden 门槛 |

## 逐条核对（规格验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | §7.8 增/删/上移/下移 | 静态断言 + 代码 | AdminModules.vue（addProxy/removeProxy/moveProxy）；test/proxy-pool-ui.test.js:11-24 | ✅ |
| 2 | §7.8 上限 10 条（满 10 置灰 + 提示） | 代码 | `proxyList.length>=10` 禁用「添加一条」+「已达上限 10 条」+ addProxy 守卫 | ✅ |
| 3 | §7.8 非法行被拒且提示行号 | 前端 saveSettings 校验 + 服务端 validateSetting 兜底（AM-1 已测） | AdminModules.vue（第 N 行报错）；settings.js:320-330；test/proxy-pool.test.js:136 | ✅ |
| 4 | §7.8 保存后下一次请求即生效 | POST /api/admin/settings 同请求内 hydrateSettings | settings-routes.js:29-35 | ✅ |
| 5 | §7.9 健康表显示正常/冷却剩余/连续失败/最近错误 | 静态断言列与状态映射 | test/proxy-pool-ui.test.js:35-46 | ✅ |
| 6 | §7.9 状态三色与倒计时 | proxyStateType（ok→success/cooldown→warning）+ 冷却中 mm:ss 由 healthNow 秒级刷新 | AdminModules.vue（proxyStateText） | ✅ |
| 7 | §7.9 刷新按钮 | 代码 | 「刷新」→ loadProxyHealth → GET /api/admin/proxies | ✅ |
| 8 | §7.9 展开分组时每 10 秒自动刷新（页面不可见不刷） | 1 秒 tick × 10 + document.hidden + expandedSettings 含 network | AdminModules.vue（startProxyTimer）；test/proxy-pool-ui.test.js:49-56 | ✅ |
| 9 | §7.9 保存后立即刷新一次 | saveSettings 成功后调 loadProxyHealth | AdminModules.vue（saveSettings 尾部） | ✅ |
| 10 | 纪律：新测试入主链 / 无新 tag / 无产物入提交 / 已推 main / OVERVIEW+DELIVERY 同步 | package.json 主链含 proxy-pool-ui.test.js；git 取证 | 主链 60 文件；diff 7 文件全为前端/测试/文档；origin/main=2f7434a | ✅ |

## 亲自重跑验证（2026-11-09）

```
npm test              → 60 个文件 / pass 499 / fail 0
npm run frontend:build → ✓ built in 1m 13s
npm run scan          → ✅ 未发现高置信度凭据 / 未发现可疑密钥赋值
```

## 打回清单

无。

## 需人工确认

- 真机浏览器操作一遍：后台 → 系统设置 → 网络与代理 → 查看并编辑 → 增删排序 → 保存 → 健康表三色与倒计时
  （项目无浏览器级测试，界面交互以静态断言 + 构建通过为准）。

## 争议项

无。

## 复检记录

- 第 1 轮（2026-11-09）：初检即通过，无打回项。
