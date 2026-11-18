# QA：封面图回源优化（AW 批，第 1 轮）

> 基线 9d6a110 → HEAD cb3fbf1；判据 docs/IMAGE-FETCH.md §5 验收 1–8；开发描述来源 docs/TODO.md AW 条目。
> 结论：✅ 放行 —— 通过 8 / 缺失 0 / 偏差 0 / 需人工确认 1（上线实测：新 appid 首次请求 <1s 404，规格 §6）

## 功能清单（本批交付的全部功能，一条功能一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | AW | 不存在的图只请求 1 次就 404，不再连试 3 个 CDN | `/img/steam/<appid>/<size>` | ✅ 已交付 | images.js:169-203；test/images.test.js:165-175 |
| 2 | AW | 单候选超时 8s→3s、整次兜底预算 5s（不再累加到 24s）；超时仍换候选 | 同上 | ✅ 已交付 | images.js:169,178-180；test/images.test.js:177-196 |
| 3 | AW | 404 负缓存 24 小时不再触发网络；网络错误 10 分钟后可重试 | 同上 | ✅ 已交付 | server.js:194,1152；test/images.test.js:189-244 |
| 4 | AW | 新游戏封面优先用 Steam 新资产直链（`games.header_image`），非 steamstatic 域名/非 https 一律拒绝 | `/img/steam/<appid>/header` | ✅ 已交付 | server.js:196-205,1158-1169；test/images.test.js:246-300 |
| 5 | AW | 封面加载失败/无 AppID 显示占位块（渐变 + 游戏名首字），不再显示站点小图标 | 首页卡片 / 移动卡片 / 详情弹窗 | ✅ 已交付 | Home.vue:31,67,80,202-203,278-284；test/images.test.js:302-314 |
| 6 | AW | `images pull` 预取统计 404 缺图数（notFound），不混进失败告警 | CLI `images pull` | ✅ 已交付 | cli.js:2450-2462,2468-2470；test/images.test.js:312-315 |
| 7 | AW | 已缓存的图仍本地 200、不触发网络（不回归） | 同上 | ✅ 已交付 | test/images.test.js:104-138（既有用例 imageFetch 抛错断言） |

## 逐条核对（规格 §5 验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | 注入恒 404 → 只调用 1 次、返回 notFound | 跑 test/images.test.js | :165-175（`calls.length===1`、`notFound===true`、`status===404`） | ✅ |
| 2 | 前两次超时第三次成功 → 3 次调用并 ok | 跑测试 | :177-190（`calls.length===3`、`ok===true`、落盘） | ✅ |
| 3 | 三候选都超时 → 总耗时 ≤ totalBudgetMs+单次超时 | 跑测试 | :192-200（慢候选 50ms×2，`calls<3`、`timeout===true`、`elapsed ≤ 130ms`） | ✅ |
| 4 | 404 后 24h 不触发网络；网络错误 10min 可重试 | 跑测试 + 常量断言 | server.js:194（`IMG_MISS_TTL` 24h/10min 导出）；test :189-244（error 类 3→3→6；notfound 类 1→1，TTL 注入验证过期重试） | ✅ |
| 5 | header_image 优先；非白名单拒绝并回退 | 跑测试 | test :246-300（fetchLog[0]=header_image；evil/http 从未请求且回退老路径；直链 404 → 老路径 2 次调用后 200；非 header 尺寸不走直链） | ✅ |
| 6 | 前端无 favicon 兜底、有占位元素 | 静态断言 | test :302-308（`!includes('/favicon.svg')` + `cover-placeholder`/`markCoverFailed`/`img-failed`/`firstChar`）；Home.vue:31,67,80,278-284 | ✅ |
| 7 | 已缓存图仍 200 不触发网络；pull 统计 notFound | 跑测试 + 静态断言 | test :104-138（imageFetch 抛错仍 200）；:312-315（cli 源码 `notFound`/「404 缺图」） | ✅ |
| 8 | npm test 全绿（新测试进主链）/ build / scan | 亲自重跑 | `npm test` → 75 个文件 exit 0（images.test.js 10 项在主链内）；`frontend:build` → ✓ built in 1.28s；`scan` → ✅ 无命中 | ✅ |

## 纪律固定检查项

1. `git tag --list`：无新增 tag（最新 v2.6.0）✅
2. diff 未碰部署/服务器配置（无 compose/DEPLOY/凭据）✅
3. 构建产物未进提交 ✅
4. 已推 main（cb3fbf1）✅
5. docs/PROJECT-OVERVIEW.md 已同步（AW 行 + 数据概念无新增表）✅

## 查多（风险提醒，不判错）

- 提交未纳入需求会话的 **AX** 条目与 `docs/ADMIN-REVIEW-LISTS.md`（同批工作区残留，拆分暂存正确）。
- `startApiServer` 新增 `imgMissTtl` 测试注入参数——生产默认 `IMG_MISS_TTL`，行为不变；既有测试全部兼容。
- `downloadImage` 默认 `timeoutMs` 8000→3000：生产调用点 `server.js` 已不再传 `timeoutMs:8000`（走默认 3000）；
  `cli.js images pull` 显式传 `timeoutMs: 12000`（预取是后台批量任务，保留宽超时，规格 §3.6 未要求收紧）——
  与规格一致，但属「CLI 与在线路由超时不同」的既定差异，留档说明。

## 需人工确认

- 规格 §6「上线后实测」：新 appid（4266020 等）首次请求 <1s 返回 404、老游戏未缓存图仍 200——本地无真实
  Steam 网络，须部署后按同口径 curl 核对；预期日志 `steam.img_fast_fail` / `steam.img_fallback`。

## 打回清单

- 无。

## 复检记录

- 第 1 轮（2026-11-10）：初检即 ✅ 放行，无需复检。
