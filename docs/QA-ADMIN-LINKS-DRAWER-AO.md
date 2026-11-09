# QA：游戏列与平台链接抽屉改版（AO 批，第 1 轮）

> 基线 1038c2a → HEAD af70754；判据 docs/ADMIN-LINKS-DRAWER.md §8；开发描述来源 docs/ADMIN-LINKS-DRAWER.md §7。
> 结论：✅ 放行 —— 通过 9 / 缺失 0 / 偏差 0 / 需人工确认 1

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | AO | 游戏名一行不换行，复制图标固定行尾（悬停才亮、成功变 ✓ 1.2s） | 后台 → 游戏管理 → 游戏列 | ✅ | `AdminModules.vue`（`.game-name-row`/`.copy-btn` + `copiedGameId`）、`main.css` |
| 2 | AO | 一次复制中英文两行（相同/缺失回退单行） | 游戏列复制图标 / 抽屉 | ✅ | `gameNames.js nameCopyText`、`test/admin-links-drawer.test.js` 4 例 |
| 3 | AO | 点游戏名打开链接抽屉、点复制图标只复制 | 游戏列 | ✅ | `@click="openGameLinks(row)"` / `@click.stop="copyGameName(row)"` |
| 4 | AO | 抽屉头部：封面 + 中英文名 + AppID + 两个复制 chip | 链接抽屉 | ✅ | `GameLinksDrawer.vue`（`ld-head`/`ld-chip` ×2） |
| 5 | AO | 每条渠道一张卡：平台色点/区服/现价/划线原价/折扣/库存/相对更新时间/打开 | 链接抽屉 | ✅ | `ld-card`：`regionLabel`、`money`、`del`、`ld-disc`、`in_stock`、`relDay`、`ld-open` |
| 6 | AO | 空态给 Steam 商店兜底按钮 | 链接抽屉（无链接） | ✅ | `ld-empty` + `在 Steam 打开 ↗` |
| 7 | AO | 排序：国区优先 → 价格升序 → 平台名 | 链接抽屉 | ✅ | `sortedLinks` 排序函数 |
| 8 | AO | 缺货卡片降透明度、仍可打开 | 链接抽屉 | ✅ | `.ld-card.out{opacity:.55}` |
| 9 | AO | 英文名悬停 title 看全名 | 游戏列 / 抽屉 | ✅ | `.game-name-en :title`、`ld-en :title` |
| 10 | AO | 移动端全屏抽屉、视觉与交互 | 手机 | 🔎 | 组件 CSS 已含 760 断点；实际目视需页面 |

## 逐条核对（规格 §8 → 证据）

| # | 条目 | 检查手段 | 证据 | 判定 |
|---|---|---|---|---|
| 1 | 250px 列宽不换行、图标同行 | 读代码 | flex 布局 + `flex:0 0 auto` 图标 + 名称省略 | ✅ |
| 2 | 英文名 title、复制拿到完整英文名 | 读代码 + 单测 | `nameCopyText` 用原始 `name_en`（非截断后） | ✅ |
| 3 | 点名字开抽屉、点图标只复制 | 读代码 | `@click`/`@click.stop` | ✅ |
| 4 | 复制内容两行/单行回退 | 单测 | `test/admin-links-drawer.test.js`（4 例全绿） | ✅ |
| 5 | 卡片字段不粘连、缺货/空态/排序 | 读代码 | 组件内 `ld-card` 结构 + `sortedLinks` | ✅ |
| 6 | 空态兜底按钮 | 读代码 | `ld-empty` 内 `<a href="…/app/<appid>">` | ✅ |
| 7 | 国区在前、同区价格升序 | 读代码 | rank cn=0 先比、再比 `price_cents` | ✅ |
| 8 | 移动端全屏 | 读代码 | 抽屉 `size 560px` + 组件媒体查询 760 | 🔎（目视） |
| 9 | 缺货降透明度仍可开 | 读代码 | `.ld-card.out` + 打开按钮不隐藏 | ✅ |
| 10 | npm test / frontend:build / scan | 重跑 | 全链到 secrets.test.js 5/5；build ✓ 1.28s；scan 干净 | ✅ |

## 打回清单

无。

## 需人工确认

- 桌面/移动端抽屉的实际观感（卡片间距、色点、✓ 反馈时长、缺货透明度）需页面目视。

## 争议项

无。

## 复检记录

- 第 1 轮（2026-11-09）：✅ 放行（通过 9 / 缺失 0 / 偏差 0 / 需人工确认 1）。
