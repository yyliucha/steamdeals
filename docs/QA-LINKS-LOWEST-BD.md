# QA：链接抽屉「最低价」醒目（BD 批，第 1 轮）

> 基线 aede5bf → HEAD 542adcc（实现提交 0124f79 + 文档同步 542adcc）；判据 docs/ADMIN-LINKS-DRAWER.md §12 验收；
> 开发描述来源 docs/TODO.md 的 BD 条目（所有者 2026-11-10 确认方案 A）。
> 结论：✅ 放行 —— 通过 4 / 缺失 0 / 偏差 0 / 需人工确认 1（真机目视高亮观感）

## 功能清单（本批交付的全部功能，一条功能一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | BD | 链接抽屉里最低价那张卡整卡高亮 + 「★ 最低价」角标 + 价格放大变绿 | 后台 → 游戏管理 → 点游戏名 → 链接抽屉 | ✅ 已交付 | GameLinksDrawer.vue:54,99-103,149-153 |
| 2 | BD | 「最低价」只在同币种内比较（跨币种不折算，不误标） | 同上（多区服链接） | ✅ 已交付 | utils/linkPrices.js:6-19；test/admin-links-drawer.test.js:41-56 |
| 3 | BD | 缺货不参与比较；只有 1 条或全部同价时不标 | 同上 | ✅ 已交付 | linkPrices.js:11-18；test:58-71 |
| 4 | BD | 其余卡片外观不变；移动端抽屉同样生效（同一模板） | 同上 | ✅ 已交付 | GameLinksDrawer.vue:99（仅 `low` class 条件新增）；同一 `sortedLinks` 渲染 |

## 逐条核对（规格 §12 验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | 三渠道（GOG ¥25 / Steam ¥40 / Humble ¥66.66）→ GOG 卡高亮 + 「★ 最低价」角标，其余卡不变 | 单测 + 模板/样式取证 | `linkPrices.js` 返回 2500 的 GOG（test:41-49）；模板 `l === lowestLink` 加 `low` class + `ld-badge`（GameLinksDrawer.vue:99-103）；`.ld-card.low`/`.ld-badge` 样式（:149-153）；demo 截图（docs/DEMO-LINKS-LOWEST.html 渲染）目视一致 | ✅ |
| 2 | 跨币种只在 CNY 内比；无同币种可比项不标 | 单测 | `test/admin-links-drawer.test.js:50-56`：hk HKD 100 不参与、只有 1 条 CNY → null | ✅ |
| 3 | 最低价缺货 → 有货里取最低；单条/全部同价不标 | 单测 | `test:58-71`（cheapOut 排除、单条 null、同价 null、空/null 入参安全） | ✅ |
| 4 | 移动端抽屉同样生效 | 模板取证 | 抽屉是同一模板（无 isMobile 分支），`sortedLinks` 渲染路径相同 | ✅ |

## 纪律固定检查项

1. `git tag --list`：无新增 tag（最新 v2.7.0，未擅自打 tag）✅
2. diff 未碰部署/服务器配置（compose / DEPLOY / 凭据均无）✅
3. 构建产物未进提交（`out/` 截图在 .gitignore；提交内无 dist/log）✅
4. 已推 main（0124f79 → 542adcc）✅
5. docs/PROJECT-OVERVIEW.md 已同步（BD 行，提交 542adcc）✅

## 查多（风险提醒，不判错）

- 本批 diff 同时带入需求会话产出：AZ/BA/BB/BC 四个规格文档与 TODO/INDEX 条目（未开发，仅规格）+
  `docs/DEMO-LINKS-LOWEST.html` 设计 demo —— 属需求阶段产物，与 BD 实现无耦合。
- TODO/INDEX 一并提交了另一会话的 AY 条目（AV 性能待排查），为保证 README 进度块与 HEAD 一致；
  AY 本身未开发、状态未变（待排查）。

## 需人工确认

- 真实浏览器里最低价高亮的观感（绿描边/发光在亮色主题下的对比度）；demo 截图已在暗色主题下核对。

## 打回清单

- 无。

## 复检记录

- 第 1 轮（2026-11-10）：初检即 ✅ 放行，无需复检。
