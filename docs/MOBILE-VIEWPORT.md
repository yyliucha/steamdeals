# 移动端真机适配补丁（三批）：强制 viewport + 功能自检

> 状态：**已定位，待开发**（2026-11-03 12:22 红米 K100 Pro Max 真机反馈）。
> 前置：v1.9.0 已发布移动端结构（单列卡、底部导航、筛选弹层、加载更多、详情底栏）。

## 1. 现象（真机）

- 红米 K100 Pro Max（浏览器/WebView）访问前台：**字体明显偏小、按钮点不中、部分功能不可用**。
- v1.9.0 的移动端模板已生效（能看到单列卡与移动顶栏），说明 `isMobile` 判定为真；
  但整体视觉仍像"桌面页面缩小"。

## 2. 根因（已定位）

浏览器处于**「桌面版网站」模式**（或 WebView 忽略 viewport）：按 ~980px 布局，再整体缩放显示。
`screen.width <= 640 && innerWidth > 700` 命中，所以 `isMobile` 类/模板生效（单列），
但**布局宽度还是 980px**，14px 字视觉上只有 5–6px，所有点击区域也按 980px 比例缩小。

**代码证据（v1.9.0）**：

- `frontend/index.html` 只有默认 meta：`<meta name="viewport" content="width=device-width, initial-scale=1.0" />`；
- `Home.vue` 只有 `isMobile` 判定与模板切换，**没有任何改写 viewport 的逻辑**；
- 结论：v1.8.0/v1.9.0 都只做了"换布局"，没做"改布局宽度"。

## 3. 修复方案（关键）

### 3.1 强制 viewport（必须，放在 `index.html` 内联脚本，CSS/JS 加载前）

```html
<script>
  (function () {
    try {
      // 桌面版模式特征：屏宽小（CSS px）但布局视口很宽
      var desktopMode = window.screen.width <= 640 && window.innerWidth > 700;
      if (desktopMode) {
        var meta = document.querySelector('meta[name="viewport"]');
        if (meta) {
          meta.setAttribute('content', 'width=390, initial-scale=1, maximum-scale=1, user-scalable=no');
        }
        // 部分 WebView 改写 meta 不重排：用 sessionStorage 防循环后 reload 一次
        if (!sessionStorage.getItem('vp-fixed')) {
          sessionStorage.setItem('vp-fixed', '1');
          location.reload();
        }
      } else {
        sessionStorage.removeItem('vp-fixed');
      }
    } catch (e) { /* 忽略 */ }
  })();
</script>
```

- `width=390` 固定设计宽度（与效果图一致），浏览器会把布局宽度压回 390 CSS px → 字号/点击区域恢复正常；
- `maximum-scale=1, user-scalable=no` 防止用户缩放导致的布局抖动；
- reload 兜底兼容"改写 meta 不即时生效"的内核；`sessionStorage` 防止无限刷新。

### 3.2 兜底：zoom 补偿（仅 Chromium，meta 改写无效时）

```js
// main.js 里，仅当 desktopMode 仍检测到 innerWidth > 700 时
document.documentElement.style.zoom = String(innerWidth / screen.width);
```

注意：`zoom` 会影响 `position:fixed` 元素（底部导航、详情底栏）——优先 3.1，`zoom` 只作最后手段；
若使用 zoom，底部导航需改为 `position:sticky` 或随 `zoom` 一起缩放验证。

### 3.3 字号/触摸基线（随 3.1 一并校准）

- `html { -webkit-text-size-adjust: 100%; }`（防系统二次缩放）；
- 正文 ≥14px；卡片标题 16px；价格 21px；按钮 ≥44px；底部导航 56px + `env(safe-area-inset-bottom)`；
- 移动端不使用 `max-width` 断点压缩 PC 结构（v1.9.0 已按模板分开，保持）。
- `el-drawer`（筛选/我的）在移动端 `size="auto"`，内容区 `max-height: 70vh; overflow-y: auto`。

### 3.4 调试浮层（`?debug=1`）

页面上显示一行（仅带参数时）：
`innerWidth / screen.width / DPR / isMobile / desktopMode / UA 前 60 字符`。
真机截图即可判断是否仍处于桌面版模式，便于快速验证 3.1 是否生效。

## 4. 真机功能自检清单（必须在红米 K100 Pro Max 上逐项过）

| # | 功能 | 通过标准 |
|---|---|---|
| 1 | 页面宽度 | 无横向滚动：`document.documentElement.scrollWidth === innerWidth` |
| 2 | 字号 | 卡片标题约 16px、价格约 21px（截图目测不被缩小） |
| 3 | 搜索 | 中文输入不误触发；回车/搜索按钮生效 |
| 4 | 筛选弹层 | 打开/关闭正常；地区/类型/排序/发行四组可切换；「应用筛选」刷新列表 |
| 5 | 排序 | 折扣/价格/名称切换生效 |
| 6 | 加载更多 | 点击追加下一页；按钮 ≥44px |
| 7 | 卡片操作 | 感兴趣/不感兴趣可点、状态正确；购买链接可打开 |
| 8 | 详情 | 全屏；关闭按钮可点；底部操作栏固定可见；购买/拥有/愿望单按钮可点 |
| 9 | 登录 | 弹窗不超宽；验证码可点刷新；登录成功 |
| 10 | Steam 绑定 | 跳转与回跳正常；回跳后账号列表刷新 |
| 11 | 通知 | 铃铛角标可见；抽屉可打开；「全部标为已读」生效 |
| 12 | 我的菜单 | 主题切换、退出、管理后台入口可用 |
| 13 | 底部导航 | 首页/心愿单/已拥有/我的 切换正确、当前项高亮、不遮挡列表底部 |
| 14 | 桌面版模式 | 浏览器「请求桌面网站」打开 → 仍进入移动布局且字号正常（3.1 生效） |

> 若逐项发现"点了没反应"的功能，除 viewport 原因外，重点检查：`@click.stop` 吞事件、
> 移动端模板漏渲染按钮、`el-drawer` 被父级 `overflow:hidden` 裁切、fixed 元素层级。

## 5. 验收标准

1. 红米 K100 Pro Max（系统浏览器 + 微信/QQ 内打开）各测一遍：字号正常、14 项清单全过。
2. 桌面版模式（`screen.width<=640 && innerWidth>700`）下仍进入移动布局。
3. PC 端 1920/1440 无回归（筛选一行、4 列卡）。
4. `npm run frontend:build` 通过；`npm test` 全绿；不自行构建（等指令）。

## 6. 实施提示

- 改动集中在 `frontend/index.html`（内联脚本）+ `Home.vue`（调试浮层、字号基线）+
  `main.css`（text-size-adjust、底部导航安全区）；
- 建议一次提交：`fix(mobile): 强制 viewport 修复桌面版模式下的字体与点击区域 + 真机自检项`；
- 需要真机验证时，可先本地 `npm run frontend:build` 后用手机访问部署环境（部署由所有者执行）。
