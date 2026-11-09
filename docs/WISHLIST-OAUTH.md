# 需求：愿望单 Steam 推送失败（AA 根因与改造方案）

> 状态：**需求草案，待所有者确认立项**（2026-11-09 排查结论；按分工本会话只排查与出需求，不写业务代码）。
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

## 3. 方案（三选一，待所有者决策）

### 方案 A：改为「诚实提示 + 明确不可用」（低成本，推荐先做）
- 账号未具备写能力时，弹窗/提示明确：「Steam 暂不支持网页端写入愿望单，已加入本站愿望单」；
- 卡片/详情页不再显示「推送失败」这种误导性文案，改为中性说明；
- 每日只读同步照常（`steam_wishlist` 数据仍然具备参考价值）；
- **不动凭据模型，不做未文档化接口逆向**。

### 方案 B：Steam 授权改造（中高成本，需验证可行性）
- 目标是获得写接口可用的会话凭据（access_token 类），加密存 `steam_accounts`，与 API Key 分列存储；
- **前置验证（必须先做）**：用该账号的网页会话 token 手工打一次 `AddToWishlist`，确认 200/success 后再立项；
  如果该接口对网页 token 也拒绝，方案 B 不成立；
- 若成立：绑定流程新增授权步骤；token 失效提示重新授权；日志不得输出 token；测试覆盖成功/401/过期三路径。
- 风险：依赖未文档化接口，Steam 随时可能变更或封禁；账号安全与合规需要所有者认可。

### 方案 C：研究第三方/逆向接口
- 不建议（封号与合规风险）。

## 4. 验收要点（方案 A）

1. 手动加愿望单：成功后提示「已加入本站愿望单（Steam 推送暂不支持）」——不含「失败」字样；
2. 已能推送到 Steam 的账号（若未来方案 B 实现）走原提示；
3. 服务端日志仍记 `adapter.steam.wishlist_add_failed` + reason（保留排障能力）；
4. 文档（WEB.md / STEAM-ACCOUNTS.md）同步「Steam 写愿望单暂不可用」的说明；
5. `npm test` 全绿（复用 `test/wishlist.test.js` 的 failed 路径）。

## 5. 需要所有者决策

1. 选 **A**（诚实提示，立即见效）还是 **B**（先做可行性验证再定）？
2. 若选 B：是否接受「未文档化接口 + 账号会话凭据」的风险？
3. 方案 A 的文案口径（「暂不支持」还是「Steam 侧不可写」）。
