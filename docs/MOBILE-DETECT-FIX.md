# 手机端识别增强（桌面模式 UA 漏判 → 前端兜底）（已实现待发版）

> 状态：**已实现待发版（2026-11-18，75a7e7f；三信号判定 + index.html 兜底，待质检）**。
> 关联：[TODO.md](TODO.md) CP 条目、[APP-NATIVE.md](APP-NATIVE.md) §5（手机前台 → `/app` 策略）、
> [MOBILE-VIEWPORT.md](MOBILE-VIEWPORT.md)（Z 批"桌面版网站"模式的判定先例）。

## 1. 现状与缺口（2026-11-17 线上实测）

`app.mobileRedirectEnabled` 开关已在生产打开，实测：

| UA | 结果 |
|---|---|
| iPhone Safari | ✅ 302 → `/app` |
| Android Chrome | ✅ 302 → `/app` |
| **小米浏览器「桌面版网站」模式** | ❌ **200，不跳**（UA = `X11; Linux x86_64 … MiuiBrowser/17.0`，不含 `mobile`） |
| PC Chrome | 200（不跳，符合预期） |

**根因**：`src/server.js:102` `isMobileUa = /mobile/i.test(user-agent)` 只认 UA 字面量；国产浏览器
「桌面版网站」模式（小米/MIUI 等）会把 UA 伪装成桌面 UA，导致检测漏判——用户手机打不开下载页。

## 2. 已确认的决策

| # | 决策 |
|---|---|
| 1 | **三信号判定**：UA 含移动特征 **或** `Sec-CH-UA-Mobile: ?1` **或** 前端 `screen.width` 兜底命中 → 视为手机。 |
| 2 | **前端兜底**：`index.html` 内联脚本在非豁免路径判断 `screen.width <= 640` → `location.replace('/app')`；`sessionStorage` 标记防循环、只跳一次。 |
| 3 | **豁免列表不变**：`/console`、`/login`、`/register`、`/app`、`/banned`、`/appeal`、`/setup`、`/change-password` 与 `/api/*`。 |
| 4 | **PC 永不跳**：桌面 UA/宽屏（`screen.width > 640`）一律不跳；平板按宽屏处理（> 640 不跳）。 |
| 5 | 微信内置浏览器保持现状：跳 `/app` 页后显示「在浏览器打开」提示（不额外拦截）。 |
| 6 | 不引入 UA 库；只加正则特征与一个小脚本。 |

## 3. 改动落点

- `src/server.js`：
  - `isMobileUa(req)` 改为多信号：UA `/mobile|android.+mobile|iphone|ipod|windows phone|miuibrowser|huaweibrowser|vivobrowser|heytapbrowser|oppobrowser/i`，
    或请求头 `sec-ch-ua-mobile === '?1'`；同时**排除**明显桌面特征（`X11; Linux x86_64` 且无 `Mobile`、`Windows NT`、`Macintosh`）。
  - 跳转日志 `http.mobile_redirect` 记录命中信号（`ua|client_hint|`）。
- `frontend/index.html`：内联脚本（在既有 viewport 脚本旁）：
  ```js
  // 仅在非豁免路径、非 /app、且屏幕宽度 <= 640 且当前不是桌面模式跳转循环时执行
  if (screen.width <= 640 && !location.pathname.startsWith('/app') && !sessionStorage.getItem('mred')) {
    sessionStorage.setItem('mred', '1');
    location.replace('/app');
  }
  ```
  豁免路径用白名单数组排除（与 §2 #3 一致）；`/app` 内不跳；跳一次后 `sessionStorage` 阻断循环。
- `test/frontend-mobile.test.js` / `test/serve.test.js`：补静态断言（脚本存在、豁免列表一致、`screen.width` 判断存在）。

## 4. 验收

1. **线上实测四组 UA**：iPhone Safari → 302；Android Chrome → 302；**小米浏览器桌面 UA → 302（或前端兜底跳转）**；PC Chrome → 200 不跳。
2. **真机**（红米 K100 Pro Max + 小米浏览器）：访问 `https://sd.yyliucha.cn/` 应进入 `/app` 下载页；再次访问不会循环跳转。
3. 豁免路径（`/console`、`/login`、`/app`、`/banned`、`/appeal` 等）手机访问不跳。
4. 微信内置浏览器：跳 `/app` 并显示「右上角 ··· → 在浏览器打开」提示。
5. PC/平板（`screen.width > 640`）不跳转。
6. `npm test` / `frontend:build` / `scan` 全绿；不自行打 tag。

## 5. 实施顺序

1. 服务端多信号检测（先让 `Sec-CH-UA-Mobile` 生效，覆盖多数安卓浏览器）；
2. 前端 `screen.width` 兜底（覆盖小米等桌面模式）；
3. 测试与真机复测；
4. 部署后由所有者真机确认（红米）。

## 6. 待确认

1. 平板（如 iPad/安卓平板，`screen.width` 768–1024）是否也跳下载页？**默认：不跳**（只跳手机）。
2. 是否需要给「桌面版模式」用户一个"继续访问网页版"的出口（`/app` 页加"仍要浏览网页版"链接）——默认不加。
