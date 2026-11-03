# 2026-11-03（二批）：PC 筛选修复 + 移动端独立设计 + 封禁标记

> 状态：**已实现并发布（v1.9.0，2026-11-03）**。需求与设计已确认（2026-11-03）。
> 效果图（所有者已确认）：[design/pc-home.png](design/pc-home.png)、
> [design/mobile-home.png](design/mobile-home.png)、[design/mobile-filter.png](design/mobile-filter.png)、
> [design/mobile-detail.png](design/mobile-detail.png)；同目录含 HTML 源文件，可直接改后重渲染。

## 背景（v1.8.0 实测问题）

1. **PC 被改坏**：筛选区下拉塌缩成小图标，抽屉内容以竖排大面板形式串在页面里
   （截图：`地区/游戏类型/发行时间/排序` + 「应用」按钮铺满一行）。这不是设计意图，是模板/CSS 作用域问题。
2. **手机不达标**：仍按桌面宽度渲染（3 列、小字），说明浏览器处于「桌面版网站」模式或 WebView 忽略 viewport，
   v1.8.0 的 `mobile-layout` 兜底没有真正接管布局。
3. 所有者确认：**PC 与手机分开设计**（效果图已确认），并且封禁 IP 的旧审核记录改为**永久退出待审**。

## 1. 已确认的设计决策

| 项 | 决策 |
|---|---|
| PC | **只修筛选区**：恢复一行工具栏（搜索 + 地区/类型/发行/排序 4 个下拉 + 刷新）；hero 与 4 列卡片不变 |
| 手机列表 | **单列大卡**：标题 16px、价格 21px、按钮 ≥44px，一屏约 1.5 张卡 |
| 手机导航 | **底部 4 入口**：首页 / 心愿单 / 已拥有 / 我的；顶部只保留 全部 / 感兴趣 / 不感兴趣 分段 |
| 手机筛选 | 搜索行右侧「筛选」→ **底部弹层**（标签单选组 + 应用筛选） |
| 手机详情 | 全屏：封面 → 标题 → 价格三宫格 → 已拥有/愿望单账号标签 → 简介 → 平台报价；底部固定操作栏 |
| 配色 | 沿用现有深色主题（品牌紫 + 蓝色主按钮） |
| 「我的」 | 登录/退出、主题切换、通知、管理后台入口 |

## 2. PC 筛选区修复（阻断级）

### 根因

- `Home.vue`：v1.8.0 把筛选拆成 `.toolbar-filters.desktop-only` + `el-drawer`（`.mobile-only` 按钮），
  `.desktop-only` / `.mobile-only` 的显隐规则与抽屉内容在 PC 上同时命中，导致：
  - 工具栏里的 4 个 `el-select` 被窄断点规则 `flex:1 1 calc(50% - 5px); width:auto` 覆盖 → 塌缩成小方块；
  - 抽屉的 `filter-drawer-body`（label + 全宽 select + 应用按钮）在 PC 上以普通块级内容出现。

### 修复

1. `Home.vue` 模板：PC 工具栏恢复单行结构（与 v1.7.0 一致）：

```html
<section class="toolbar">
  <el-input class="search" .../>
  <el-select class="filter-select" v-model="region">…</el-select>   <!-- 4 个 -->
  <el-button @click="loadGames(page)">刷新</el-button>
  <el-button class="mobile-only" @click="filterDrawer=true">筛选</el-button>
</section>
```

2. `main.css`：

```css
.toolbar .el-select{flex:0 0 132px;width:132px}
/* 移动端覆盖必须限定作用域，不能影响 PC */
.mobile-layout .toolbar .el-select, @media(max-width:560px){ ... }
```

3. `el-drawer`（筛选弹层）只在 `isMobile` 为真时渲染（`v-if="isMobile"`），PC 不实例化。
4. 删除 `.toolbar-filters` 包裹与 `desktop-only` 相关样式（或改为仅控制显隐，不改变宽度）。

### 验收

1. 1920 / 1440 / 1280 三档：工具栏一行，4 个下拉各 132px，刷新按钮尾部，**无竖排筛选面板**。
2. 与 [design/pc-home.png](design/pc-home.png) 对照一致。
3. 手机布局不受这轮改动影响。

## 3. 移动端独立设计

### 3.1 结构切换（不依赖 viewport 是否正确）

```js
const isMobile = ref(
  matchMedia('(max-width: 640px)').matches ||
  (screen.width <= 640 && innerWidth > 700)   // 「桌面版网站」/WebView 忽略 viewport 的兜底
);
```

- 模板用 `v-if="isMobile"` 分两套结构（PC / Mobile），**共用** `games`、筛选状态与请求函数；
- 不再用 CSS 断点"压缩"PC 结构；
- `resize`/`orientationchange` 时重算（节流）。

### 3.2 移动端结构（按效果图）

| 区块 | 规格 |
|---|---|
| 顶栏 52px | Logo + 铃铛（未读角标）+ ☰（主题/登录/退出/后台） |
| 搜索行 | 搜索框（flex）+ 「筛选」按钮 |
| chips | 地区 / 类型 / 排序（横向滚动，点击开弹层，显示当前值） |
| 分段 tab | 全部 / 感兴趣 / 不感兴趣（吸顶可选） |
| 结果行 | 「找到 N 款」+ 价格说明 |
| 卡片 | 单列；封面 16:9 + 折扣角标；标题 16px/700；副标题 11px；价格 21px 品牌色 + 原价；已拥有/愿望单标签；操作行「感兴趣」「不感兴趣」（≥44px）+「购买」 |
| 底部导航 56px | 首页 / 心愿单 / 已拥有 / 我的（当前高亮，fixed，安全区 padding） |
| 分页 | 「加载更多」按钮（pageSize=20，保留 page 逻辑） |
| 详情 | 全屏 dialog：封面 → 标题/英文名 → 三宫格（当前/历史/折扣）→ 已拥有·账号 / 愿望单·账号标签 → 简介 → 平台报价列表 → 底部固定操作栏（感兴趣/不感兴趣/去 Steam 购买） |

### 3.3 筛选弹层

- `el-drawer direction="btt"`（或自绘 sheet），高度按内容；
- 标签组单选（地区/类型/排序/发行），打开时回填当前值；
- 「应用筛选」→ 关闭 + `loadGames(1)`；「重置」→ 回默认值。

### 3.4 触摸与字号

- 正文 ≥13px；卡片标题 16px；价格 21px；按钮高度 ≥44px；圆角 12–14px；
- 底部导航与安全区：`padding-bottom: env(safe-area-inset-bottom)`。

### 3.5 验收

1. iPhone 12 / SE（DevTools 模拟）：单列大卡、字号可读、无横向滚动、底部导航可切换、筛选弹层可应用。
2. 模拟「桌面版网站」（`screen.width<=640 && innerWidth>700`）→ 仍进入移动布局。
3. PC 三档无回归；`npm run frontend:build` 通过。

## 4. 封禁标记（替代 v1.8.0 的「仅过滤」）

### 现状

- v1.8.0 只做查询过滤（`NOT_ACTIVE_BAN`）：封禁期内隐藏，**到期后旧记录恢复**。
- 实例：45.138.12.10 封禁至 2026/11/02 10:01，11/03 又出现在待审列表。

### 已确认

- **封禁动作发生时，把该 IP 的所有 `pending` 审核标记为 `auto_banned`**（旧记录永久退出待审）；
- 该 IP **之后的新异常**仍会生成新的 pending（不永久屏蔽，避免漏掉真实攻击）；
- 保留 `NOT_ACTIVE_BAN` 作为双保险。

### 改动

1. `ratelimit.applyBan`（rate / rate-day / path 自动封禁）写 `ip_abuse.banned_until` 后：

```sql
update abuse_reviews
   set status = 'auto_banned', reviewed_at = now(),
       note = coalesce(note, '自动封禁')
 where ip = $1 and status = 'pending'
```

2. 手动黑名单（`POST /api/admin/blacklist`、审核「封 IP」）同样执行该清理（note 写「手动封禁」）。
3. 审核列表：`status` 参数支持 `pending | all`（默认 pending）；`all` 时可见 `auto_banned`（审计用）。
4. 测试（PGlite）：
   - 封禁 → 该 IP 的 pending 全部变 `auto_banned`，`listAbuseReviews` / 计数都不含；
   - 解封后不恢复；
   - 封禁后同 IP 新异常 → 生成新的 pending（可审核）。

### 验收

1. 自动封禁后异常审核立即看不到该 IP 的旧记录；「封禁与白名单」仍显示封禁记录。
2. 解封后旧审核不回来；同 IP 新异常会重新出现（新记录）。
3. `npm test` 全绿。

## 5. 通用要求

- 五条硬规则：验证（`npm test` + `npm run frontend:build` + `npm run scan`）、日志、调度器、服务器归属、
  **不自行构建**。
- 建议顺序：4 封禁标记（最小）→ 2 PC 修复（阻断级）→ 3 移动端（工作量大，单独验收）。
- 完成后更新 CHANGELOG / TODO，提交推 main（不 tag）。
