# QA：未保存修改的离开提醒（AN 批，第 1 轮）

> 基线 8e0265a → HEAD 625763a；判据 [docs/UNSAVED-GUARD.md](UNSAVED-GUARD.md) §3/§4/§6 验收 1–11；
> 开发描述来源：开发会话汇报（ac9cbf4 代码 + d691f5c 文档 + 625763a 修复）。
> 结论：✅ 放行 —— 通过 11 / 缺失 0 / 偏差 0 / 需人工确认 1

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/行为） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | AN | 五个编辑面（系统设置/邮件配置/站点通知/编辑游戏/新建用户）有未保存修改时，切菜单或离开页面弹「还有没保存的修改」 | 后台任意编辑面 → 切菜单/后退/返回网站 | ✅ | Console.vue（select 先 requestLeave）；router/index.js（beforeEach） |
| 2 | AN | 弹窗三选一：保存并离开 / 放弃修改 / 留在本页（文案与 §3.1 一致） | 弹窗 | ✅ | UnsavedLeaveDialog.vue |
| 3 | AN | 保存并离开：按注册顺序逐个保存，全部成功才离开并 toast「已保存」 | 弹窗 → 保存并离开 | ✅ | useUnsavedGuard.js（saveAndLeave）；UnsavedLeaveDialog.vue |
| 4 | AN | 任一保存失败：关弹窗、留在本页、ElMessage.error 显示原因，不丢已填内容 | 弹窗 → 保存并离开 | ✅ | useUnsavedGuard.js:settle(false)+throw；UnsavedLeaveDialog.vue catch |
| 5 | AN | 放弃修改：直接离开，不二次确认 | 弹窗 → 放弃修改 | ✅ | useUnsavedGuard.js（discard） |
| 6 | AN | 留在本页 / × / Esc：取消本次导航，修改还在 | 弹窗 | ✅ | UnsavedLeaveDialog.vue（@close="stay"） |
| 7 | AN | 多来源时正文列出全部来源名（「系统设置」「站点通知」…） | 弹窗 | ✅ | UnsavedLeaveDialog.vue（labels.join） |
| 8 | AN | 左侧当前菜单项旁显示「未保存修改」小圆点 | 控制台侧栏 | ✅ | Console.vue（nav-dirty + hasDirtySources 800ms 轮询） |
| 9 | AN | 刷新/关闭标签不弹；401/非管理员跳转不弹（bypass） | 浏览器行为 | ✅ | 无 beforeunload；Console.vue bypassNextGuard×2 |
| 10 | AN | 无修改时切换零打扰 | 切菜单 | ✅ | requestLeave 无脏来源直接 true |

## 逐条核对（规格验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | §6.1 系统设置改一项→切菜单→弹窗；三按钮语义正确 | 代码 + 静态断言 | AdminModules（settingsDirty + submitSettings）；test/unsaved-guard.test.js:41-55 | ✅ |
| 2 | §6.2 邮件配置同样弹窗，「保存并离开」后生效 | 代码 + 静态断言 | MailSettingsForm（dirty + submit 抛错版）；test:41-55 | ✅ |
| 3 | §6.3 站点通知编辑到一半→弹窗；保存并离开后列表是新内容 | 快照比较 | AdminModules（announcementSnapshot/announcementDirty/submitAnnouncement）；test:49 | ✅ |
| 4 | §6.4 编辑游戏弹窗改动后路由离开→弹窗 | 快照 + beforeEach | AdminModules（gameSnapshot/gameDirty/submitGameSave）；router/index.js | ✅ |
| 5 | §6.5 新建用户填了字段→弹窗；保存并离开=创建成功才离开，失败留在本页 | isDirty 非空判定 + submitCreateUser 抛错 | AdminExtras.vue；test:52 | ✅ |
| 6 | §6.6 返回网站触发同一弹窗 | router.push('/') 走 beforeEach | Console.vue:14 + router/index.js | ✅ |
| 7 | §6.7 保存失败→留在本页+错误提示 | settle(false)+throw → 组件 ElMessage.error | useUnsavedGuard.js；UnsavedLeaveDialog.vue；test:20 | ✅ |
| 8 | §6.8 401/退出登录不弹 | bypassNextGuard（非管理员两处） | Console.vue（onMounted 两个分支）；test:34 | ✅ |
| 9 | §6.9 刷新/关闭不弹 | 无 beforeunload | test:59-63 | ✅ |
| 10 | §6.10 无修改不弹 | requestLeave 空脏直接 true | useUnsavedGuard.js | ✅ |
| 11 | §6.11 npm test 全绿（新增 test/unsaved-guard.test.js 入主链）+ frontend:build + scan | 亲自重跑 | npm test 61 文件/504 项 fail 0；frontend:build ✓ 1.32s；scan 干净 | ✅ |

## 亲自重跑验证（2026-11-09）

```
npm test              → 61 个文件 / pass 504 / fail 0
npm run frontend:build → ✓ built in 1.32s
npm run scan          → ✅ 未发现高置信度凭据 / 未发现可疑密钥赋值
```

## 打回清单

无。

## 需人工确认

- 真机浏览器逐项走一遍验收 1–6（无浏览器级测试框架，交互以静态断言 + 构建通过为准）：改一项 → 切菜单弹窗 → 三按钮三种走向。

## 争议项

无。

## 复检记录

- 第 1 轮（2026-11-09）：初检发现保存失败时弹窗未关闭（settle(false) 缺失），开发补齐（625763a）后复测通过。
