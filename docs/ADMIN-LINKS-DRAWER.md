# 后台游戏列与平台链接抽屉改版（已确认待开发）

> 状态：**需求与方案已确认（2026-11-09），待开发**。编号待入 [TODO.md](TODO.md) 时落定（暂记 **AO**）。
> 关联：[ADMIN-PLATFORM-LINKS.md](ADMIN-PLATFORM-LINKS.md)（AG 批初版）、[WEB.md](WEB.md)。

## 1. 问题（2026-11-09 截图与实测）

| # | 现象 | 根因 |
|---|---|---|
| 1 | 游戏名旁边的复制图标会**换行到第二行** | 名称 `<strong>` 与 `<el-button>` 是**行内元素并排**，列宽 250px 时名字一长就把图标挤下去（`AdminModules.vue:9` 的 `.game-admin`） |
| 2 | 英文名被省略号截断，**没法复制** | 英文名只是纯文本 `<small>`，没有 title、没有复制入口 |
| 3 | 链接抽屉「很简陋」：`Steam 国区 cn · ¥99.992026/11/08 20:15:09` 全挤在一行，价格与时间粘连 | 初版抽屉只有一行文本 + 一个「打开」按钮，没有分区、没有间距 |
| 4 | 抽屉里 AppID、游戏名、复制入口混排，层级不清 | 头部没有"封面 + 标题 + 元信息 + 操作"的结构 |

## 2. 已确认的决策（2026-11-09 所有者）

| # | 决策 |
|---|---|
| 1 | **方案 A**：重做抽屉；**点游戏名 = 打开抽屉**（抽屉就是"选哪个平台打开"），复制只点图标 |
| 2 | **一次复制 = 中英文两行**：`中文名\n英文名`；只有中文时复制中文；英文名与中文名相同时只复制一行 |
| 3 | 英文名被截断时用 `title` 显示全名（悬停可见），复制拿到的仍是完整英文名 |
| 4 | 抽屉里显示**原价划线 + 折扣 + 库存状态 + 最近更新时间**（默认取向，未单独确认） |
| 5 | 排序：**国区优先 → 同区按价格升序**（默认取向，未单独确认） |
| 6 | 桌面抽屉宽 **560px**，移动端**全屏**（默认取向，未单独确认） |

> 4/5/6 是 demo 里的默认值，所有者未单独拍板；开发按此实现，若要改只在规格这一处改。

## 3. 表格「游戏」列

```html
<div class="game-cell">
  <img class="cover">
  <div class="game-meta">
    <div class="game-name-row">
      <button class="game-name" @click="openGameLinks(row)" :title="row.name">{{ row.name }}</button>
      <button class="copy-btn" title="复制中英文名" @click.stop="copyGameName(row)">
        <el-icon><CopyDocument v-if="!copiedId(row)"/><Check v-else/></el-icon>
      </button>
    </div>
    <div class="game-name-en" :title="row.name_en">{{ row.name_en }}</div>
  </div>
</div>
```

样式要点：

```css
.game-cell{display:flex;align-items:center;gap:10px;min-width:0}
.game-meta{min-width:0;flex:1}
.game-name-row{display:flex;align-items:center;gap:5px;min-width:0}
.game-name{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
           font-weight:700;border:0;background:none;color:var(--fg);cursor:pointer;text-align:left;padding:0}
.game-name:hover{color:var(--brand-2)}
.copy-btn{flex:0 0 auto;width:20px;height:20px;border:0;border-radius:5px;background:transparent;
          color:var(--fg-muted);cursor:pointer;opacity:.55}
tr:hover .copy-btn{opacity:1}
.copy-btn:hover{background:var(--panel-2);color:var(--brand-2)}
.copy-btn.copied{color:var(--success);opacity:1}
.game-name-en{font-size:11px;color:var(--fg-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:3px}
```

- 名称点击 → `openGameLinks(row)`；复制按钮 `@click.stop`，互不影响；
- 复制成功：图标变 ✓、保持 1.2 秒，同时 `ElMessage.success('已复制中英文名')`；
- 复制内容（详见 §5）。

## 4. 抽屉

`el-drawer` 的 `:with-header="false"`，自绘头部；桌面 `size=560px`，移动端 `size=100%` + `mobile-full`。

### 4.1 结构

```
┌ 头部 ─────────────────────────────────────────┐
│ [封面 56]  METAL SLUG XX                    × │
│            METAL SLUG XX（英文名）             │
│            [⧉ 复制中英文名] [⧉ AppID 975680]  │
├ 正文 ─────────────────────────────────────────┤
│ 可跳转的购买渠道                    3 个链接   │
│ ┌──────────────────────────────────────────┐ │
│ │● Steam  国区                        打开 ↗│ │
│ │  ¥99.99  ¥199.99  -50%                   │ │
│ │  最后更新：昨天 20:15 · 有货               │ │
│ └──────────────────────────────────────────┘ │
│ …（每条渠道一张卡，间距 10px）                  │
│                                               │
│ 空态：还没有可跳转的购买链接 + Steam 商店兜底   │
├ 底部 ─────────────────────────────────────────┤
│ 价格与库存以平台页面为准 · 链接由采集任务维护    │
└───────────────────────────────────────────────┘
```

### 4.2 渠道卡片

| 区域 | 内容 | 数据来源 |
|---|---|---|
| 平台 | 色点 + 平台名（Steam / GOG / 杉果 / Humble…） | `platform_code` / `platform_name` |
| 区服 | 标签：`cn→国区`、`hk→港区`、`tw→台区`、`us→美区`、`jp→日区`、`gb→英区`，未知原样 | `region` |
| 价格 | 当前价（币种符号 + 两位小数），有原价时后面划线原价 + 折扣标签 | `price_cents` / `original_cents` / `discount_pct` / `currency` |
| 状态 | 「有货 / 缺货」；缺货卡片整体降透明度 | `in_stock` |
| 时间 | 「最后更新：今天 09:12 / 昨天 / 3 天前」（站点时区），完整时间放 `title` | `last_seen_at` |
| 操作 | 「打开 ↗」按钮，`target="_blank" rel="noopener noreferrer"` | `buy_url` |

- 金额一律用 `price_cents / 100` 显示，不折算币种；
- 缺货的卡片仍可打开，但按钮弱化为普通按钮；
- 排序：`cn` 优先 → `price_cents` 升序 → 平台名；
- 全部链接 `buy_url` 必须是 `http(s)`（后端已过滤）。

### 4.3 空态 / 加载 / 错误

- 加载：抽屉正文 `v-loading`（沿用现有）；
- 空态：图标 + 「这个游戏还没有可跳转的购买链接」+ 有 `steam_appid` 时给「在 Steam 打开 ↗」兜底按钮；
- 请求失败：`ElMessage.error` + 正文显示「加载失败，点此重试」。

### 4.4 移动端

- 抽屉全屏，头部保持一行两行结构，按钮 ≥44px 触摸目标；
- 卡片单列，价格与按钮同一行右对齐，时间单独一行。

## 5. 复制规范

```js
function nameCopyText(game) {
  const zh = String(game.name ?? '').trim();
  const en = String(game.name_en ?? '').trim();
  if (!en || en === zh) return zh;
  if (!zh) return en;
  return `${zh}\n${en}`;   // 两行：先中文后英文
}
```

- 表格列、抽屉头部共用同一个函数（抽屉里 AppID 单独复制，不拼进去）；
- 复制失败（浏览器拒绝）沿用现有 `copyText()` 的降级 + `ElMessage.warning('复制失败，请手动选择')`；
- 前端站点（`Home.vue`）的复制按钮保持现状（前台卡片标题只显示一个名字，不需要中英两行）。

## 6. 接口

**不改后端**：`GET /api/admin/games/:id/links` 已返回 `platform_code / platform_name / region / currency / price_cents / original_cents / discount_pct / in_stock / buy_url / last_seen_at`；
列表接口已返回 `link_count` 与 `name_en`。本批纯前端。

## 7. 文件落点

| 文件 | 改动 |
|---|---|
| `frontend/src/components/GameLinksDrawer.vue` | **新增**：抽屉组件（头部 / 卡片 / 空态 / 移动端），props：`visible`、`game`、`links`、`loading`；emit `update:visible`、`copy` |
| `frontend/src/pages/AdminModules.vue` | 游戏列改 flex 布局 + 名称点击 + 复制按钮；抽屉改用它；删掉旧的 `links-drawer-head` / `link-row` 样式 |
| `frontend/src/utils/clipboard.js` | 不需要改；新增 `nameCopyText()` 放 `utils/gameNames.js`（可单测） |
| `test/admin-links-drawer.test.js` | **新增**：静态断言（组件存在、flex 类名、复制两行逻辑、空态文案、560/全屏） |
| `docs/WEB.md` | 补一句"后台点游戏名打开链接抽屉；复制含中英文两行" |

## 8. 验收

1. 250px 列宽下，任意长名称**不换行**：名称单行省略，复制图标始终在名称右侧同一行；
2. 英文名超长显示省略号，鼠标悬停 `title` 可见全名；复制拿到的是完整英文名；
3. 点游戏名 → 抽屉打开；点复制图标 → 只复制、**不打开抽屉**；
4. 复制内容：`雷霆小队2\nSHOCK TROOPERS 2nd Squad`；只有中文时仅一行；中英文相同时仅一行；成功图标变 ✓ 1.2 秒 + toast；
5. 抽屉：一个链接 → 一张卡；同平台多区服 → 多张卡（区服不同）；价格/原价/折扣/库存/时间分别显示，**不再粘连**；
6. 空态：无链接时有兜底按钮；有 `steam_appid` 时按钮可打开 Steam 商店页；
7. 排序：国区在前，同区按价格升序；
8. 移动端：抽屉全屏、卡片单列、按钮 ≥44px；
9. 缺货卡片降透明度且仍可打开；
10. `npm test` 全绿（新增静态测试并入主链）、`npm run frontend:build`、`npm run scan`。

## 9. 实施顺序

单批 **AO**：§7 的 5 个文件，预计半天；不动后端、不动数据库。

## 10. 本期不做（写清楚，避免被当成漏项）

- 平台 logo 图片（用色点 + 文字，避免引入图标资源）；
- 抽屉里改价/改链接（只读展示，编辑走「编辑游戏」）；
- 前台（用户侧）的抽屉复用——前台不展示平台链接（AG 批已定）；
- 链接有效性探测（404 照常显示）。

## 11. 待确认

无。4/5/6 三条默认取向见 §2 备注，所有者若要改，只改规格一处即可。

## 12. 2026-11-10 追加（BD）：最低价醒目

> 状态：**已实现并发布 v2.8.0（2026-11-10，0124f79）**。

**问题（2026-11-10 所有者）**：链接抽屉里多个渠道价格并列，没有视觉重点，要自己比价。

**决策（所有者 2026-11-10 确认方案 A）**：最低价那张卡**整卡高亮**——绿色描边 + 淡绿底 + 轻微发光 + 「★ 最低价」角标 + 价格放大变绿；其余卡片不变。

**口径（与产品原则一致）**

1. **币种不折算**：只在**同一币种**内比大小；以排序后第一项（国区优先）的币种为基准，没有同币种的可比较项就不标；
2. **缺货不参与**：缺货价格不可购买，标最低价会误导；
3. **至少 2 条可比且唯一最低**才标：只有 1 条或全部同价 → 不标；
4. 纯前端，无后端改动；不算折扣/折扣价本身（price_cents 即当前价）。

**改动清单**

- rontend/src/utils/linkPrices.js（新增）：pickLowestLink(links) 纯函数（上述口径，可单测）；
- rontend/src/components/GameLinksDrawer.vue：lowestLink computed + 卡片 low class + 「★ 最低价」角标 + 样式；
- 	est/admin-links-drawer.test.js：pickLowestLink 单测（同币种/跨币种/缺货/单条/同价）+ 抽屉静态接线断言。

**验收**

1. 三个渠道（GOG ¥25 / Steam ¥40 / Humble ¥66.66）→ GOG 卡高亮 + 「★ 最低价」角标，其余卡不变；
2. 跨币种（如国区 CNY + 港区 HKD）→ 只在 CNY 内比；没有同币种可比项时不标；
3. 最低价缺货 → 在有货里取最低；只有 1 条或全部同价 → 不标；
4. 移动端抽屉同样生效；
pm test 全绿（新单测进主链）、
pm run frontend:build、
pm run scan。
