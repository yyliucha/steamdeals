# 设置页布局系统修复（ET，已实现并发布 v2.28.2，2026-11-23）

> 现象（2026-11-23 所有者截图）：系统设置 →「数据源与采集」布局错乱——卡片头与字段分家、
> 左右错位、大片空白。所有者要求彻查所有设置页面。

## 1. 根因（代码证据）

`frontend/src/pages/AdminModules.vue` 的设置 tab（约 127 行）用**扁平 entry 序列**渲染：

```html
<div class="settings-sections">   <!-- grid: repeat(auto-fill,minmax(360px,1fr)) -->
  <template v-for="entry in displaySettingsFields(group.id)">
    cardHead / cardBody / rows / grid / fold / foldBody / cardEnd  ← 全部是网格直接子项
  </template>
</div>
```

`displaySettingsFields()` 返回的每个 entry（卡片头、卡身体、字段行/字段网格、高级折叠）都是 `.settings-sections`
的**独立 grid item** → 卡片零件被拆散到不同列：

- 「全局」的 cardHead 占格 1、字段行占格 2 → 左侧标题卡片 + 右侧延迟输入框错位（截图）；
- 「Steam」的 cardHead / 字段网格 / 高级折叠分占三格；
- `align-items:start` + 卡片高度不一 → 大片空白；
- `.settings-card-head`/`.settings-card-body` 仅靠边框拼接假装一张卡片，网格不会粘合。

## 2. 受影响范围（彻查结果）

| tab（group） | 渲染分支 | 状态 |
|---|---|---|
| **数据源与采集（sources）** | `settings-sections` 扁平 entry | ❌ **错位（截图）** |
| **站点与内容（site）** | `settings-sections` 扁平 entry | ❌ **同上** |
| **高级（advanced）** | `settings-sections` 扁平 entry | ❌ **同上** |
| 账号与登录（auth） | plain → `setting-grid`（字段卡片 2 列） | ✅ 正常 |
| 安全与限流（security） | plain → `setting-grid` | ✅ 正常 |
| 通知与提醒（alerts） | plain → `setting-grid` | ✅ 正常 |
| 网络与代理（network） | plain → `setting-grid` | ✅ 正常 |

其它设置相关页面：**邮件服务（MailSettingsForm.vue）** `.mail-settings-grid` 两列 el-form-item → ✅ 正常；
**初始化页（Setup.vue）** `setup-card/setup-grid` → ✅ 正常。本条目**只改 AdminModules 设置页的非 plain 分支**。

依据：`src/settings.js` `GROUPS`（7 组）、`PLAIN_GROUPS = ['alerts','auth','security','network']`、
`SETTINGS_SECTIONS`（sources/site/advanced 的 section 定义）。

## 3. 方案 A（所有者 2026-11-23 选定）：每个 section 一张卡片

### 模板
- `displaySettingsFields(gid)` 改为返回**按 section 分组**的结构：`[{ sec, entries:[...] }]`
  （entries 保留 cardHead/cardBody/rows/grid/fold/foldBody 语义，但渲染时包在卡片内）；
- 模板：`<div class="settings-sections"><section v-for="g in groupedSettingsFields(group.id)" class="settings-card">…</section></div>`；
- 卡片内顺序：卡片头（图标/标题/标签/开关）→ 卡片体（字段行或字段网格）→ 高级折叠（全宽）→ 展开内容（全宽）。

### 样式
- `.settings-sections{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start}`（≤960px 单列）；
- `.settings-card{border:1px solid var(--border);border-radius:12px;background:var(--panel);overflow:hidden;min-width:0}`；
- `.settings-card-head`：去掉独立边框（只留 `border-bottom:1px solid var(--border)`、背景 `panel-2`）；
- `.settings-card-body`：去边框，`padding:12px 14px 14px`；
- `.settings-fold`：全宽、卡片内末尾；
- 字段行 `.setting-row` 保持现有（label / 控件 / 来源标签 / 恢复按钮）对齐。

### 不变
- 字段功能/保存逻辑/搜索/只看非默认/折叠状态（localStorage）/恢复默认/secret 交互全部不变；
- plain 组（auth/security/alerts/network）模板与样式**不动**。

## 4. 参考稿

- `docs/design/settings-layout-demo.html`（方案 A 原型）
- `docs/design/settings-layout-demo.png`（截图）

## 5. 验收

1. 「数据源与采集 / 站点与内容 / 高级」三个 tab 布局与 demo 一致：每个源一张卡片、字段对齐、折叠在卡片内；
2. 移动端（≤960px）单列全宽可用；
3. 全部设置项功能不变（保存/恢复默认/搜索/只看非默认/折叠记忆/secret 编辑）；
4. plain 组与邮件/初始化页不受影响（回归确认）；
5. `npm test`（分段）+ `frontend:build` + `scan` 全绿；截图对照（改前/改后）。
