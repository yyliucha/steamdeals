# 需求：愿望单 Steam 推送失败（AA 根因与改造方案）

> 状态：**方案 A 已确认（2026-11-09 所有者决策）——「诚实提示 + 明确不可用」，待开发排期**。
> 按分工本会话只排查与出需求，不写业务代码；开发描述见 §4。
> 关联：[WISHLIST-FIX.md](WISHLIST-FIX.md)（六项产品缺陷，已修复待发版）、[STEAM-ACCOUNTS.md](STEAM-ACCOUNTS.md)、[TODO.md](TODO.md) 的 AA 条目。

## 1. 现象与定案证据（2026-11-09）

线上复现（v2.1.0）后拿到完整日志：

```
2026-11-09T16:10:43 WARN adapter.steam.wishlist_add_failed
  {"steamId":"76561199509090255","appid":916470,"reason":"HTTP 401 → api.steampowered.com · 经 steam-proxy(http://steam-proxy:8888)"}
2026-11-09T16:10:43 INFO steam.wishlist_manual_add
  {... "steamIds":["76561199509090255"],"added":[],"alreadyIn":[],"failed":["76561199509090255"]}
```

同时：同账号的**只读**愿望单每日同步正常（`steam.wishlist_synced total:4`）——
即 **Web API Key 有效**，`GetWishlist`（只读，`IWishlistService/GetWishlist`）可用；
失败只发生在**写**接口 `AddToWishlist` 上，返回 **HTTP 401**。

结论：写愿望单接口不接受「Web API Key」这种凭据（或该 Key 权限不足以写）。两种待验证假设：
1. **`IWishlistService/AddToWishlist` 实际不接受 Web API Key**（未文档化接口，可能需要网页/客户端会话凭据）——与玩家社区已知情况一致；
2. 该 Key 有效但**账号级权限不足**（极少见，Steam 没有写愿望单的官方 key 权限开关）。

## 2. 影响面

- 手动「加入愿望单」：本站 `user_wishlist` 写入成功，**Steam 侧推送 100% 失败**（HTTP 401）；
- 手动「移除愿望单」的 Steam 回推（同接口体系）同样失败；
- 每日 `steam-accounts` 只读同步**不受影响**（key 可用）；
- 产品缺陷（失败原因不透明等）已由 AA 修复批解决：现在提示与日志都带 `reason`。

## 3. 方案决策（2026-11-09 所有者确认）

**采纳方案 A：「诚实提示 + 明确不可用」**（低成本、立即见效、不动凭据模型、不做未文档化接口逆向）。
方案 B（Steam 授权改造）作为未来可选项暂不立项——若将来要评估，必须先做「网页会话 token 手工打 AddToWishlist」的可行性验证；
方案 C 不采用。

### 方案 A 的具体改动（开发描述）

1. **前端 `Home.vue` 愿望单弹窗与提示**：
   - 弹窗标题/说明改为中性口径：加入"仅本站"与"Steam 推送暂不支持"的说明；未配 Key 账号仍置灰（现状保留）；
   - 加入成功后 toast 改为「已加入本站愿望单（Steam 推送暂不支持）」——**不含「失败」字样**；
   - 若未来某账号推送成功（方案 B 实现后），仍走原「推送到 N 个账号」文案（代码保留分支）。
2. **服务端日志保留**：`adapter.steam.wishlist_add_failed` + reason、`steam.wishlist_manual_add` 的 failed 带原因（AA 修复批已完成）——排障能力不丢。
3. **文档同步**：`WEB.md` 与 `STEAM-ACCOUNTS.md` 补一句「网页端写愿望单暂不可用，仅本站保存」。
4. **不改**：每日只读同步（`steam-accounts` 的 GetWishlist）、`user_wishlist`/`steam_wishlist` 数据结构、移除流程逻辑（提示口径同改）。

## 4. 开发描述（可直接派发）

| 项 | 内容 |
|---|---|
| 规格 | 本文 §3「方案 A 的具体改动」 |
| 文件落点 | `frontend/src/pages/Home.vue`（wishlist 弹窗/提示文案）、`docs/WEB.md`、`docs/STEAM-ACCOUNTS.md` |
| 验收 | §5 的 1/3/4/5 条（方案 A 口径）；`npm test`（`test/wishlist.test.js` 复用）全绿 |
| 注意 | 保留「失败原因带 reason」的服务端日志（AA 修复批）；不要删推送分支代码 |

## 5. 验收要点（方案 A）

1. 手动加愿望单：成功后提示「已加入本站愿望单（Steam 推送暂不支持）」——不含「失败」字样；
2. 已能推送到 Steam 的账号（未来方案 B）走原「推送到 N 个账号」提示；
3. 服务端日志仍记 `adapter.steam.wishlist_add_failed` + reason（保留排障能力）；
4. 文档（WEB.md / STEAM-ACCOUNTS.md）同步「Steam 写愿望单暂不可用」的说明；
5. `npm test` 全绿（复用 `test/wishlist.test.js` 的 failed 路径）。

## 6. 已确认（2026-11-09）

1. 选 **A**（诚实提示，立即见效）；
2. 不投入 OAuth 改造（方案 B 仅作未来可选项，需先做可行性验证）；
3. 文案口径：「已加入本站愿望单（Steam 推送暂不支持）」。方案 C 不采用。
