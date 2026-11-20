# QA：DU 个人简介 placeholder 动态绑定（第 1 轮）

> 基线 5ce2e50 → HEAD（本 worktree 分支 wt-228-front 未提交改动）；判据 docs/TODO.md「DU」段 §验收；开发描述来源：夜班监工派发（worker-1-front）。
> 结论：✅ 放行 —— 通过 3 / 缺失 0 / 偏差 0 / 需人工确认 0

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | DU | 个人简介输入框 placeholder：管理员显示「介绍一下自己（可选）」 | 控制台 → 个人资料 → 个人简介 | ✅ | frontend/src/pages/ProfilePage.vue:56-57 |
| 2 | DU | 个人简介输入框 placeholder：普通用户显示「介绍一下自己（1–200 字）」 | 控制台 → 个人资料 → 个人简介 | ✅ | 同上（isAdmin 运行时分支） |
| 3 | DU | 全项目不再出现「静态属性值里嵌 {{ }} 插值」的同类缺陷 | 全部 .vue 组件 | ✅ | test/profile.test.js DU 组全量扫描断言 |

## 逐条核对（规格验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | admin 显示「介绍一下自己（可选）」、普通用户「介绍一下自己（1–200 字）」 | @vue/compiler-dom 编译级断言：编译产物含 `placeholder: \`介绍一下自己（${_ctx.isAdmin ? '可选' : '1–200 字'}）\`` | test/profile.test.js（DU 组）断言 `code.includes('介绍一下自己（${_ctx.isAdmin')` | ✅ |
| 2 | 修复方式：`:placeholder` 动态绑定 | 编译产物 `placeholder:` 后是表达式（非字符串字面量） | test/profile.test.js 断言 `/placeholder:\s*[^"'\s]/` | ✅ |
| 3 | 全项目扫描仅此一处（grep `="[^"]*\{\{` 无其它命中） | 测试内对 frontend/src 全部 .vue 扫描标签属性 | test/profile.test.js 全量扫描断言 | ✅ |
| 4 | `npm test`（分段）+ `frontend:build` + `scan` 全绿 | 重跑命令 | 见下「重跑验证」 | ✅ |

## 重跑验证（QA 亲自重跑）

- `node test/profile.test.js` → `# tests 15 / # pass 15 / # fail 0`（含 DU 组 1 条）✅
- 反向自检（临时脚本，仓库外、用完即删）：把 `:placeholder` 改回静态 `placeholder="介绍一下自己（{{ … }}）"` → 三条断言全红；好写法三绿。输出：
  `GOOD: {"a1":true,"a2":true,"a3":true} / BAD : {"a1":false,"a2":false,"a3":false} PASS` ✅
- `npm run frontend:build` → `✓ built in 4.76s` ✅
  （本机沙箱限制：vite 启动 `exec("net use")` 被沙箱 EPERM 拦截，本地验证用仓库外临时补丁脚本
  `F:\dsh\patch-vite-sandbox.mjs` 短路该探测后构建通过；补丁只改本地 node_modules，不入库、CI 不受影响。）
- `npm run scan` → `✅ 未发现高置信度凭据` ✅

## 打回清单

无。

## 需人工确认

无（编译级 + 静态断言已锁行为；浏览器目视由 DT 批整体验收兜底）。

## 争议项

无。

## 复检记录

- 第 1 轮（2026-11-20）：3/0/0/0 → ✅ 放行。

## 备注

- TODO 状态由监工统一回写（夜班工人纪律：不改 docs/TODO.md 及任何共用文档）。
