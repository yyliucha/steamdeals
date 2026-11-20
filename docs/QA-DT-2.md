# QA：DT-2 用户级数据接口 + 5 页数据接入（第 1 轮）

> 基线 7f5edba（DT-1 提交后）→ HEAD（本 worktree 分支 wt-228-front 未提交改动）；判据 docs/ADMIN-PERMISSIONS.md「DT-2」节；开发描述来源：夜班监工派发（worker-1-front）。
> 结论：✅ 放行 —— 通过 10 / 缺失 0 / 偏差 0 / 需人工确认 1

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | DT-2 | 我的登录会话列表（只含本人：设备/IP/归属地/UA/最近活动/到期/当前会话） | 普通用户控制台 → 登录会话（我的设备）→ GET /api/me/sessions | ✅ | src/routes/me.js + me-repository.js |
| 2 | DT-2 | 撤销自己的一个会话（踢自己生效；踢别人 404） | 同页「撤销」按钮 → POST /api/me/sessions/:id/revoke | ✅ | src/routes/me.js + me-repository.js |
| 3 | DT-2 | 我的愿望单（分页/搜索，复用 wishlist 服务层） | 普通用户控制台 → 我的愿望单 → GET /api/me/wishlist | ✅ | src/routes/watchlist.js + steam-accounts.js listWishlists(offset/total) |
| 4 | DT-2 | 我的到价提醒列表 + 取消提醒 | 普通用户控制台 → 我的到价提醒 → GET/DELETE /api/watchlist | ✅ | frontend/src/pages/UserSections.vue |
| 5 | DT-2 | 站点公告只读 + 已读标记 | 普通用户控制台 → 站点公告 → GET /api/announcements + POST /api/announcements/read | ✅ | UserSections.vue |
| 6 | DT-2 | 个人资料不变（仍 ProfilePage + /api/me*） | 普通用户控制台 → 个人资料 | ✅ | Console.vue 分支不变 |
| 7 | DT-2 | 越权防御：接口强制 session.user.id、忽略传入 userId/username | 上述接口带恶意参数请求 | ✅ | 反向自检实测：放开 userId 参数 → 越权用例红 |
| 8 | DT-2 | 管理员页面保持 admin 接口不变 | 控制台（admin 角色） | ✅ | Console.vue 分支 isAdminUser 渲染 AdminModules/AdminExtras |

## 逐条核对（规格验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | GET /api/me/sessions 只返回当前用户会话（设备/IP 归属地/UA 摘要/最近活动/到期/当前会话） | 真 HTTP A/B 双用户 + 字段断言 + 无 token 断言 | test/sessions.test.js DT-2 组 | ✅ |
| 2 | POST /api/me/sessions/:id/revoke 只能踢自己（非自己 404） | 真 HTTP：踢自己生效/踢别人 404 无副作用/幽灵 id 404/匿名 401 | test/sessions.test.js DT-2 组 | ✅ |
| 3 | GET /api/me/wishlist 分页/搜索、复用 wishlist 服务层 | 真 HTTP：limit/offset 翻页、q 搜索、total 真实总数 | test/wishlist-site-only.test.js DT-2 组 | ✅ |
| 4 | 前端 5 页切用户级接口（会话/提醒/愿望单/公告；个人资料不变） | 静态接线断言 + 不得出现 admin 接口 | test/admin-console-ia.test.js DT-2 组 | ✅ |
| 5 | 管理员页面保持 admin 接口 | 静态断言渲染分支 | test/admin-console-ia.test.js DT-1 验收 6 | ✅ |
| 6 | 强制 session.user.id、忽略传入 userId、越权 403/404 并审计 | 反向自检实测 + 参数忽略断言 + logger 事件（session.revoke_self） | 见「重跑验证」反向自检；src/routes/me.js revoke 分支 | ✅ |
| 7 | 新端点放 src/routes/me.js 与 src/routes/watchlist.js，不动 src/server.js | 静态锁：新分支在新文件 + 接线形态不变 | test/profile.test.js / watchlist-user.test.js 补锁；git diff src/server.js 无改动 | ✅ |
| 8 | 动过 API 必跑 api.test.js | 重跑 | 见下 | ✅ |

## 重跑验证（QA 亲自重跑）

- `node test/sessions.test.js` → `# pass 13 / # fail 0`（新增 DT-2 组 2 用例）✅
- `node test/wishlist-site-only.test.js` → `# pass 7 / # fail 0`（新增 DT-2 组 2 用例）✅
- `node test/watchlist-user.test.js` → `# pass 13 / # fail 0` ✅
- `node test/profile.test.js` → `# pass 15 / # fail 0` ✅
- `node test/admin-console-ia.test.js` → `# pass 19 / # fail 0` ✅
- `node test/api.test.js` → `# pass 38 / # fail 0` ✅
- **反向自检（越权）**：临时把 routes/watchlist.js 的 `userId: user.id` 改成
  `Number(params.get('userId')) || user.id` → `not ok 7 - DT-2 愿望单：忽略传入 userId…`（越权用例红，fail 1），恢复后 7/7 全绿 ✅
- `npm run frontend:build` → `✓ built in 4.54s` ✅（沙箱补丁变体，同前轮说明）
- `npm run scan` → `✅ 未发现高置信度凭据` ✅

## 打回清单

无。

## 需人工确认

- 页面目视：普通用户 5 页真实渲染效果（表格/移动卡片/倒计时等），本地无 headless 渲染环境
  （沙箱 spawn 限制），由 DT 批整体验收兜底。

## 争议项

- 规格说「越权返回 403/404 并审计」：用户级接口的越权面是「传入 userId 参数」——实现为**完全忽略**
  该参数（数据面不可能越权），非法请求不可能触及他人数据；revoke 非自己的会话按 404（与规格一致），
  撤销成功落 `session.revoke_self` 日志事件。未额外落审计表（用户级接口是本人操作本人数据，
  admin 接口才写 audit_logs，与既有审计口径一致）——如所有者要求用户级也落审计表可后续补。

## 复检记录

- 第 1 轮（2026-11-20）：10/0/0/1 → ✅ 放行。

## 备注

- TODO 状态由监工统一回写（夜班工人纪律：不改 docs/TODO.md 及任何共用文档）。
- steam-accounts.js 的 listWishlists 增加了 offset 参数与真实 total（分页语义），
  /api/admin/wishlists 调用方不传 offset，返回结构 {items,total} 不变（total 从行数改为全量 count，
  对 admin 页面无影响——AdminModules 只消费 items）。
