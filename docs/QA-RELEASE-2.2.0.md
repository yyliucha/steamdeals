# QA：v2.2.0 发版批次（C1 修复 / AN 回归修复 / AA 需求文档 / AQ 批，第 1 轮）

> 基线 `v2.1.0`（f01c7cc）→ HEAD `62d39c6`；判据：C1 = [TODO.md](TODO.md) C 段「已定案」条目 + 线上取证；
> AN 回归 = [UNSAVED-GUARD.md](UNSAVED-GUARD.md) §7；AA = [WISHLIST-OAUTH.md](WISHLIST-OAUTH.md) §3/§4/§6（方案 A 已确认）
> + [WISHLIST-FIX.md](WISHLIST-FIX.md) §4/§6（六项缺陷，独立报告已放行）；
> AQ = [ADMIN-REVIEW-LISTS.md](ADMIN-REVIEW-LISTS.md) §3.4（另有独立报告 [QA-ADMIN-REVIEW-LISTS-AQ.md](QA-ADMIN-REVIEW-LISTS-AQ.md) 第 1 轮 ✅）。
> 结论：✅ 放行 —— 通过 15 / 缺失 0 / 偏差 0 / 需人工确认 3

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | C1 | heat 任务恢复正常：不再全「无效跳过」，热度能写进库 | 定时任务 heat（自动） | ✅ | `src/cli.js:2118`（`data?.json?.[appid]`）+ 修复前线上日志对照 |
| 2 | C1 | catalog 每周目录同步恢复正常（新游戏能进库） | 定时任务 catalog（自动） | ✅ | `src/adapters/steam-catalog.js:71-74`（`body = data?.json ?? {}` → `findAppArray(body)`） |
| 3 | C1 | 该类回归被测试锁住（旧契约写法再出现会挂测试） | `npm test` | ✅ | `test/fetchjson-contract.test.js`（2 项，已入主链） |
| 4 | AN | 点「放弃修改」后草稿真的清掉，后续切菜单/离开不再反复弹窗 | 后台五个编辑面 | ✅ | `useUnsavedGuard.js:77-87`（`void source.discard?.()`）、五个面均注册 `discard` |
| 5 | AN | 系统设置/站点通知/编辑游戏/邮件配置/新建用户五面各自清草稿 | 同上 | ✅ | `AdminModules.vue`（3 处 `discard:`）、`MailSettingsForm.vue`（`discardDraft`）、`AdminExtras.vue`（`discardNewUser`） |
| 6 | AN | 回归行为被测试锁住（「放弃后不再脏、下次导航不弹」） | `npm test` | ✅ | `test/unsaved-guard.test.js`（7 项，含 2 项回归） |
| 7 | AA | 方案 A 决策落档：愿望单推送失败改为「诚实提示」的完整开发描述 | [WISHLIST-OAUTH.md](WISHLIST-OAUTH.md) | ✅ | §3 具体改动、§4 开发描述、§6 已确认（仅文档，无代码） |
| 7a | AA | 打算加入愿望单时，失败提示写明每个账号的原因（未配 Key / 解密失败 / Steam 拒绝） | 首页/详情页「愿望单」 | ✅ | QA-WISHLIST-AA.md（第 1 轮 ✅ 放行）；`test/wishlist.test.js` 7 项 |
| 7b | AA | 服务端日志记 `{steamId, reason}`；无 Steam AppID 条目明确「仅本站」不弹多选 | 日志 / 愿望单入口 | ✅ | 同上 |
| 7c | AA | 无绑定账号提示可绑定同步；未配 Key 账号弹窗置灰注明；空选按钮「仅加入本站」 | 愿望单弹窗 | ✅ | 同上 |
| 8 | AQ | 异常审核表头排序（最近出现/IP/次数/规则，默认最近出现↓） | 后台 → 访问记录 → 异常审核 | ✅ | 独立复核：`sortable="custom"` 共 12 处、`reviewSort` + localStorage 状态；详见 AQ 报告 |
| 9 | AQ | IP 按数值排序 + IPv6 排后 | 两个列表 | ✅ | `frontend/src/utils/ipSort.js`（`export function compareIp`，IPv6 分支） |
| 10 | AQ | 访问明细服务端排序（白名单 sort/order，非法回落默认） | `/api/admin/visitors?sort=&order=` | ✅ | `src/server.js`（`['time','ip','status']` 白名单）+ `test/admin-review-lists.test.js` |
| 11 | AQ | 待审上限 300 → 500 + 列表头计数 | 后台 → 异常审核 | ✅ | `src/store/pg.js`（500）+ 列表头「共 N 条（上限 500）」 |
| 12 | AQ | 排序状态刷新后保留、换排序回第 1 页 | 同上 | ✅ | `loadSortState/saveSortState` + `onVisitorSortChange→loadVisitors(1)` |

## 逐条核对（验收 → 证据）

| # | 条目 | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | C1 根因 = fetchJson 契约（heat） | 读代码 + 对照线上日志 | `src/cli.js:2118`；线上 `heat.entry_invalid` shape 为包装对象（2026-11-09 16:10 日志） | ✅ |
| 2 | C1 同类问题（catalog）一并修 | 读代码 | `src/adapters/steam-catalog.js:71` | ✅ |
| 3 | C1 回归测试真锁行为 | 读测试断言 | `test/fetchjson-contract.test.js`（断言 `.json` 解包写法 + 旧写法不得残留） | ✅ |
| 4 | AN discard 调来源回调后放行 | 读代码 | `useUnsavedGuard.js:77-87` | ✅ |
| 5 | AN 五面都有 discard | grep 计数 | AdminModules ×3、MailForm、AdminExtras | ✅ |
| 6 | AN 回归测试锁行为（真断言） | 读测试 + 重跑 | `test/unsaved-guard.test.js` 7/7（含「放弃后 dirtySources 为 0、下次 requestLeave 直接放行」） | ✅ |
| 7 | AA 方案 A 文档完整（决策/改动/验收/开发描述） | 读文档 | WISHLIST-OAUTH.md §3/§4/§5/§6 | ✅ |
| 7a | AA 六项缺陷修复 | 引用独立报告 + 重跑测试 | [QA-WISHLIST-AA.md](QA-WISHLIST-AA.md)（✅ 放行 9/0/0/2）；`test/wishlist.test.js` 7/7 | ✅ |
| 8 | AQ 规格 §3.4 七条 | 独立复核 + 依赖 AQ 报告 | 见上表 8-12 行；独立复核 `sortable="custom"` 12 处、白名单、500、compareIp | ✅ |
| 9 | 纪律：无擅自 tag | `git tag --list` | 仅 v1.9.0/v2.0.0/v2.1.0，未新增 | ✅ |
| 10 | 纪律：无构建产物/日志入库、未碰部署配置 | `git status --short` + diff | diff 仅代码/文档/测试；无 dist/log/data | ✅ |
| 11 | 已验证：npm test / api / build / scan | 亲自重跑 | 见下 | ✅ |
| 12 | AQ 上线后性能 | — | 本地无生产数据（AQ 报告同为 🔎） | 🔎 |

## 亲自重跑验证（2026-11-09 16:2x）

```
npm test                       → 70 个文件 / pass 563 / fail 0
node test/api.test.js          → pass 22 / fail 0
node test/email-auth.test.js   → 9/9 全绿
npm run frontend:build         → ✓
npm run scan                   → ✅ 未发现高置信度凭据 / 未发现可疑密钥赋值
```

## 打回清单

无。

## 需人工确认

1. **C1 上线后**：部署后 `heat --limit 5` 应 `withHeat>0`、catalog 手动跑一次能补进新游戏（另见 TODO C1 的「数据恢复」建议）；
2. **AQ 排序性能**：十万行访问明细按 IP 排序的耗时（上线后 EXPLAIN 抽查，超阈值再补索引）；
3. **AN 交互**：真机上「放弃修改」后不再弹窗（本地无浏览器级测试，静态断言 + 行为单测为准）。

## 争议项

无。

## 复检记录

- 第 1 轮（2026-11-09）：✅ 放行（通过 15 / 缺失 0 / 偏差 0 / 需人工确认 3）。AQ 与 AA 六项各有独立报告（本轮引用结论并独立复核关键证据）。
