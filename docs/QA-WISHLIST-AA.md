# QA：愿望单缺陷修复批（AA 批，第 1 轮）

> 基线 20b7ade → HEAD 5b59bfa；判据 [docs/WISHLIST-FIX.md](WISHLIST-FIX.md) §4/§6（六项产品缺陷 + 验收 6 条）；
> 开发描述来源：开发会话汇报（5b59bfa 代码 + 文档）。
> 结论：✅ 放行 —— 通过 9 / 缺失 0 / 偏差 0 / 需人工确认 2

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/接口/行为） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | AA | 加愿望单失败时，提示直接写明每个账号的**原因**（未配 Key / 解密失败 / Steam 拒绝） | 首页卡片 / 详情页「愿望单」 | ✅ | Home.vue（addWishlist toast 带 reason）；test/wishlist.test.js:168 |
| 2 | AA | 服务端日志 `steam.wishlist_manual_add` 的 failed 项带 `{steamId, reason}`，排障不再只有 id | 日志 | ✅ | server.js（failed.map 记原因）；test:86 |
| 3 | AA | 无 Steam AppID 的条目：不弹多选、明确「该条目无 Steam AppID，仅本站」 | 加愿望单 | ✅ | Home.vue（toggleWishlist 直达 + toast）；test:168 |
| 4 | AA | 没有绑定 Steam 账号：不弹空弹窗，直接加入并提示「绑定 Steam 账号可同步推送」 | 加愿望单 | ✅ | Home.vue；test:168 |
| 5 | AA | 弹窗中未配 API Key 的账号置灰并注明「未配置 API Key，不可推送」；空选按钮「仅加入本站」 | 多选弹窗 | ✅ | Home.vue（dialog）；test:168 |
| 6 | AA | 未配 Key / 解密失败 / 推送失败三种情况，接口响应与日志均带明确 reason | POST /api/wishlist | ✅ | server.js；test/wishlist.test.js:105/122/140 |

## 逐条核对（规格验收 → 证据）

| # | 条目（规格验收 §6） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | §6-1 未配 Key：弹窗置灰注明 + 确认后提示未推送原因 | 静态断言 + HTTP 测试 reason | Home.vue；test/wishlist.test.js:86-103 | ✅ |
| 2 | §6-2 正常账号提示「推送到 N 个账号」+ steam_wishlist 有行 | HTTP 测试（注入 push 成功） | test:127-138 | ✅ |
| 3 | §6-3 已在愿望单 → ✓ 按钮进移除流程（不误报添加失败） | 既有代码 + HTTP alreadyIn | Home.vue:40；test:133-136 | ✅ |
| 4 | §6-4 未登录不显示按钮；401 有提示 | 既有 `v-if="user"` + AL 批 401 跳登录 | Home.vue:40 | ✅ |
| 5 | §6-5 日志含每个失败账号原因 | HTTP 测试断言日志对象 | test:100-102、155-157 | ✅ |
| 6 | §6-6 npm test 全绿 + 新增 test/wishlist.test.js（7 项：reason 透传 + 空选） | 亲自重跑 | test/wishlist.test.js 7/7；主链 67 文件/549 项 fail 0 | ✅ |
| 7 | 主链/链外/构建/扫描 | 亲自重跑 | npm test 549 项 fail 0；api 22；build ✓；scan 干净 | ✅ |
| 8 | 纪律：无新 tag / 无产物入提交 / 已推 main / OVERVIEW+DELIVERY 同步 | git 取证 | 无新 tag；origin/main=5b59bfa | ✅ |
| 9 | 根因范围不越界（本批只做六项缺陷，根因等日志） | 代码审查 | 未改 pushWishlistItem 逻辑 | ✅ |

## 亲自重跑验证（2026-11-09）

```
node test/wishlist.test.js     → 7 / 7 全绿
npm test                       → 67 个文件 / pass 549 / fail 0
node test/api.test.js          → pass 22 / fail 0
npm run frontend:build         → ✓
npm run scan                   → ✅ 未发现高置信度凭据 / 未发现可疑密钥赋值
```

## 打回清单

无。

## 需人工确认

1. 真机走一遍六项对应的交互（无浏览器级测试；静态断言 + HTTP 测试为准）；
2. **根因仍在等所有者**：`adapter.steam.wishlist_add_failed` 日志（TODO AA 三分支判定）——本批不覆盖根因修复。

## 争议项

无。

## 复检记录

- 第 1 轮（2026-11-09）：初检即通过，无打回项。
