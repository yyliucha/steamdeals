# App 功能补齐（CM：与 Web 对齐的差异项）（待开发）

> 状态：**已确认待开发（2026-11-17，模拟器实测后确认）**。
> 关联：[APP-NATIVE.md](APP-NATIVE.md) §4.4（功能对齐矩阵）、[USER-ALERTS.md](USER-ALERTS.md)（已拥有终态规则）、
> [GAME-DLC.md](GAME-DLC.md)（Web 的 DLC 口径）、[PRICE-HISTORY-REPORT.md](PRICE-HISTORY-REPORT.md)（Web 价格历史口径）、
> [APP-API.md](APP-API.md)（App 契约）。

## 1. 已确认的决策

| # | 决策 |
|---|---|
| 1 | 本批只做**差异补齐**：CM-1 开发商/发行商 JSON bug、CM-2 DLC 列表、CM-3 价格历史区间与指标、CM-4 复制游戏名。 |
| 2 | **已拥有终态**（[USER-ALERTS.md](USER-ALERTS.md) §1 #3）App **一期不实现**：App 无 Steam 账号绑定，无法识别已拥有；等 App 接入 Steam 绑定后再套用终态规则（联动删愿望单/提醒行由服务端负责）。 |
| 3 | **筛选/排序服务端化**列为 **CM-5（二阶段可选）**：站点 `/api/app/games` 透传 `discountOnly / histLowOnly / freeOnly / comingSoonOnly` 与 `sort=heat\|release\|price`，App 去掉"本地筛已加载数据"。 |
| 4 | **公告角标/通知入口**（CM-6）为**待核实项**：App 未登录时不可见，需登录态确认；不阻塞本批。 |
| 5 | 改动在两个仓库：**App 代码在 `F:\dsh\steamdeals-app`**（独立仓库），CM-5 的服务端改动在**站点仓库**；同一编号交付、分别提交。 |

## 2. 现状（2026-11-17 模拟器实测）

环境：`steamdeals35`（API 35）+ `steamdeals-2.19.0.apk`，连生产后端只读浏览。

| 项 | 实测 |
|---|---|
| 多平台报价 | ✅ 泰拉瑞亚详情并列 **GOG ¥36 / Steam 国区 ¥42 / Humble ¥66.63** |
| 价格历史 | ✅ 有曲线 + 史低绿点 + 日期轴；❌ 无 30/90/全部切换、无区间指标条 |
| DLC 列表 | ❌ 纪元1800（有 DLC）从顶滚到底**无 DLC 区块**；接口 `/api/app/games/:appid/dlc` 已就绪 |
| 复制游戏名 | ❌ 详情无复制入口 |
| **开发商/发行商** | ❌ **显示原始 JSON**：纪元1800 = `{"name":"Ubisoft Mainz"}` / `{"name":"Ubisoft","creator_clan_account_id":33075774}`；泰拉瑞亚正常（Re-Logic） |
| 已拥有 | ❌ 未做（App 无 Steam 绑定） |
| 底部操作条 | 感兴趣 / 不感兴趣 / ♡愿望单 / 去 Steam 购买（无「已拥有」，与现状一致） |

## 3. 条目拆分与改动落点

### CM-1 开发商/发行商 JSON 修复（App）

- 现象：服务端 `developers`/`publishers` 可能是**对象数组**（`[{name, creator_clan_account_id}]`），App 直接 toString 显示原始 JSON。
- 修复：App 解析时取 `name` 字段（兼容字符串数组/单对象），空值显示 `—`。
- 验收：纪元1800 显示「Ubisoft Mainz」「Ubisoft」；泰拉瑞亚仍「Re-Logic」；其他游戏不回归。

### CM-2 DLC 列表（App）

- 契约：`GET /api/app/games/:appid/dlc?page=1&pageSize=10`（已有）。
- UI：详情底部「**DLC（共 N 个）**」区块，分页 10、名称升序、价格/折扣/缺货、点击行跳 Steam 商店（外部浏览器）；
  底部标注「Steam 不提供 DLC 拥有数据」；无 DLC/非 Steam 游戏不显示区块。
- 与 Web 口径一致（见 [GAME-DLC.md](GAME-DLC.md)）。

### CM-3 价格历史区间与指标（App）

- 对齐 Web（[PRICE-HISTORY-REPORT.md](PRICE-HISTORY-REPORT.md) §11）：区间切换「近 30 天 / 近 90 天 / 全部」；
  指标条：区间最低 / 区间最高 / 当前较史低 / 记录天数；趋势线保留史低参考线与低点标记；无历史显示空态。

### CM-4 复制游戏名（App）

- 详情标题旁「复制」按钮（点击复制中英文名），或长按标题复制；提示「已复制」。
- 复制内容与 Web 一致（中英文两行，缺一回退单行）。

### CM-5 筛选/排序服务端化（二阶段，可选）

- 站点：`/api/app/games` 接受 `discountOnly / histLowOnly / freeOnly / comingSoonOnly / sort=heat|release|price`，走服务端查询（与 Web 口径一致）。
- App：移除「本地筛已加载数据」，改为带参数请求；翻页后筛选结果仍正确。
- 需服务端 + App 双仓库改动，单独验收。

### CM-6 公告角标/通知入口（待核实）

- App 未登录不可见；登录后确认是否有未读角标/通知列表；无则登记为后续补齐项。

## 4. 验收

1. **CM-1**：纪元1800 开发商「Ubisoft Mainz」、发行商「Ubisoft」；泰拉瑞亚不变；无 JSON 字样。
2. **CM-2**：有 DLC 的游戏（纪元1800）详情底部出现 DLC 区块，共 N 个、分页 10、价格/折扣/缺货正确、点击跳 Steam；
   无 DLC 游戏不显示；区块有「Steam 不提供 DLC 拥有数据」说明。
3. **CM-3**：区间切换生效（30/90/全部），指标条数值与 Web 同游戏一致；史低线/低点保留；无历史空态。
4. **CM-4**：复制成功（中英文两行），提示可见；分享到其他 App 内容正确。
5. 既有功能不回归：多平台报价、搜索、愿望单、登录、主题、内置更新。
6. 验证方式：模拟器（`steamdeals35`）安装新包 → 截图逐项核对；关键项补 e2e 矩阵行（CK 落地后）。
7. `npm test` / `frontend:build` / `scan`（站点仓库，若动服务端）；App 侧 `gradlew assembleRelease` 成功、同签名可覆盖安装。

## 5. 实施顺序

1. CM-1（最小、马上可见）→ 2. CM-2 → 3. CM-3 → 4. CM-4 → 5.（可选）CM-5 → 6. CM-6 核实。

## 6. 待确认

1. CM-5 是否本期做（涉及服务端 + App 双仓库）？建议放二期。
2. CM-6 公告入口需要登录态核实——需要一个测试账号或等 CL 的用户体系落地后一起验。
3. App 版本号（`app-v<X.Y.Z>`）按 App 仓库规则递增，本批不承诺具体版本。
