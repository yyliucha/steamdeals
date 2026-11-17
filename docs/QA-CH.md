# QA：CH 个性化推荐 + Deck 认证 + 好评率（第 1 轮）

> 基线 e7eee34（CH 补建认领）→ HEAD b575dcc；判据 [DISCOVERY-FOR-YOU.md](DISCOVERY-FOR-YOU.md) §9。
> 结论：✅ 放行 —— 通过 7 / 缺失 0 / 偏差 0 / 需人工确认 1

## 功能清单（用户视角，一条一行）

| # | 功能 | 入口 | 状态 | 证据 |
|---|---|---|---|---|
| 1 | 每天采集 Deck 认证+好评率（100 页翻页+热门名称回退，回退 7 天/2^n 退避，round_done 日志） | 定时任务 steam-discovery | ✅ | src/discovery.js:43-127；test/discovery.test.js runDiscoveryRound 用例；scheduler.test.js 默认参数断言 |
| 2 | 列表 Deck 徽标（✓/~/✗）+好评率色点+筛选（Deck/好评率）+「综合评分」排序（0.4/0.35/0.25 权重设置化） | 前台工具栏/卡片 | ✅ | Home.vue 筛选与徽标；pg.js gameSearch score/reviewMin/deck 条件；test/discovery.test.js 静态断言 |
| 3 | 为你推荐：绑定账号 20 条+because；未绑定引导；游客无入口；排除已拥有/不感兴趣/成人；15 分钟缓存 | 前台 tab / POST /api/games/for-you | ✅ | src/discovery.js computeForYou（画像+排除+because）；server.js 接口；Home.vue tab（v-if=user）；test/discovery.test.js because 用例 |
| 4 | 行为上报白名单+幂等只加 count+60 次/分+开关关闭 202 不落库+180 天 prune；标记优先于行为 | POST /api/behavior | ✅ | pg.js upsertUserBehavior（unique 冲突只加 count）/prune；server.js 白名单与 202；test/discovery.test.js behaviorActionWeight |
| 5 | 免费角标+去 Steam 领取 | 卡片 | ✅ | Home.vue「免费领取」tag（is_free） |
| 6 | 通用验证 | npm test 92 文件 0 fail（NPM_EXIT=0）；api.test.js 27/27；frontend:build ✓；scan 干净 | ✅ | 实跑输出 |
| 7 | 生产待核实（§11 四条：search/results 字段映射、tags 覆盖率、回退接口限流、review_total 口径） | 部署侧 | 🔎 | 本地无真实 Steam 出口，字段映射按实测可调（parseQualityRow 白名单） |

## 需人工确认
- 验收 7（§11 四条）需部署侧一次只读实测后校准字段映射；「未探测下降」类效果需上线观察。

## 复检记录
- 第 1 轮（2026-11-17）：实跑 npm test（92 文件 0 fail）/ api.test.js 27-27 / frontend:build / scan → ✅ 放行。
