# QA：FX 后台密钥查看统一——密码框 + 眼睛懒加载 + 审计（第 2 轮）

> 基线 `ed2feb2` → 实现 HEAD `9d55aad`；实现提交 `975bfce`（主体）+ `9d55aad`（第 1 轮偏差修复）。
> 范围说明：`ed2feb2..9d55aad` 里另有监工 docs 提交（`3decbdd`/`e888089`：TODO、ACTIVE-SESSIONS、SETTINGS-REDESIGN、visitor-ban demo），
> 不属于 FX；FX 只含下列 10 个文件。QA 取证时 HEAD = `9d55aad`，此后监工又有 docs 提交（`8b67d82` FZ 设计），不涉及本批代码。
> 判据：[SECRET-REVEAL.md](SECRET-REVEAL.md) §7「验收 1~7」+ §1 八项决策 + §3/§4/§6；demo：[secret-reveal-2026-11-27.html](design/secret-reveal-2026-11-27.html)（`-1/-2/-3.png`）。
> 范围：只判 FX（8 个 secret 的四分支统一 + 审计），不含 FY（设置页整体重设计）。
> 结论：**✅ 放行 —— 通过 7 / 缺失 0 / 偏差 1（第 1 轮发现、第 2 轮已修复）/ 需人工确认 3**。

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | FX | 8 个密钥项（Steam API Key / ITAD Key / SMTP 授权码 / 通用 Webhook / 企业微信 / Steam 代理 / 通用出网代理 / App 同步代理）在设置页四种布局里都变成「密码框 + 眼睛 + 清除」 | 后台 → 系统设置 → 各分组（平铺 / 平台卡 / 折叠区 / 网络与代理） | ✅ 已交付 | `AdminModules.vue:204`（模板同一行 5 处 `<SecretField`：isPlainGroup / grid / foldBody / steamProxy(proxy) / httpsProxy+appSyncProxy）；`SecretField.vue:4-47` |
| 2 | FX | 已配置默认密文（`type=password`）；点眼睛查看明文，明文只在第一次点眼睛时向后台取一次 | 设置页每个密钥框右侧眼睛 | ✅ 已交付 | `SecretField.vue:9`（type 切换）、`:206`（eyeAction）；`utils/secretField.js:26`；`test/secret-reveal.test.js:33` |
| 3 | FX | 再点眼睛回密文、**不重复请求**；点开期间 30 秒无操作自动回密文 | 同上 | ✅ 已交付 | `SecretField.vue:164`（`setTimeout(hidePlain, SECRET_AUTO_HIDE_MS)`）、`:206-218`；`utils/secretField.js:11`（30000）；`test/secret-reveal.test.js:33`（首点 fetch / 再点 reveal-cached / 已开 hide） |
| 4 | FX | 未配置：空框 + placeholder「尚未设置」+ 眼睛置灰不可点、**不发任何请求** | 同上（未配置的密钥项） | ✅ 已交付 | `SecretField.vue:26`（`:disabled="!canReveal"`）、`:207`（ignore 直接 return）；SSR DOM 断言 `test/secret-reveal.test.js:87` |
| 5 | FX | 编辑直接改框内容：出现「保存/取消」；**未改动不提交**（提示「没有变化，未提交」）、留空 = 保持原值 | 设置页密钥框 | ✅ 已交付 | `SecretField.vue:44-46`、`:232-236`；`utils/secretField.js:37`；`test/secret-reveal.test.js:42` |
| 6 | FX | 清除：二次确认 → 提交 `null` → 来源回落 env/默认 | 密钥框旁「清除」 | ✅ 已交付 | `SecretField.vue:47`、`:255-271`；`test/secret-reveal.test.js:58`（静态锁） |
| 7 | FX | 代理多条：眼睛点开逐行显示两条地址（含账号密码）、每行可单独复制；列表增删仍走原「编辑」弹窗 | 网络与代理 → Steam 专用代理 | ✅ 已交付 | `SecretField.vue:16-21`（逐行 + 复制）、`:25`；`AdminModules.vue:204`（`mode="proxy"` + 保留「已配置 N 条 / 编辑」）；`utils/secretField.js:45`；`test/secret-reveal.test.js:50` |
| 8 | FX | 每次查看明文写审计 `audit_logs`（`admin.secret_revealed`，**只记 key 名、不含值**，含操作人与 IP） | 后台「审计日志」（op-logs 已有查询） | ✅ 已交付 | `src/settings-routes.js:57-65`；`src/server.js:1470`（ip 传入）；`src/store/pg.js:2250`（失败吞掉）；真 HTTP 断言 `test/secret-reveal.test.js:190` |
| 9 | FX | 权限不变：仅管理员；非 secret key 返回 400「只能查看敏感字段」；匿名 401 / 普通用户 403 | `GET /api/admin/settings/value?key=` | ✅ 已交付 | `src/settings-routes.js:52`；`src/server.js:1359-1369`（requireAdmin）；`test/secret-reveal.test.js:190` |
| 10 | FX | 旧的「查看」按钮（明文塞输入框）、代理查看弹窗、「已保存密钥不会自动回显」提示全部移除；批量「保存设置」不再提交密钥 | 设置页 | ✅ 已交付 | `AdminModules.vue:254/768/770/814`；`test/secret-reveal.test.js:168`；`test/admin-edit-dialog.test.js:68` |
| 11 | FX | 移动端 ≤560px：眼睛保留在框内、次要动作换行、触摸目标 ≥44px | 手机浏览器后台设置页 | 🔎 待人工确认 | `SecretField.vue:387-397`（`@media (max-width: 560px)` + `min-height:44px`）；眼睛固定 44×44（`:333-334`）；375px 实际渲染见「需人工确认」 |
| 12 | FX | 明文态等宽字体、可选中复制（demo 状态②） | 点眼睛后的密钥框 | ✅ 已交付 | `SecretField.vue:8`（`is-plain` 类）、`:317-321`；第 1 轮偏差已修 `9d55aad`；`test/secret-reveal.test.js:58` 静态锁 |

## 逐条核对（规格 §7 验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | 8 个 secret 在四种布局分支都有密码框 + 眼睛 + 清除（模板静态锁 + 至少两处 DOM 断言） | grep 模板分支 + SSR 渲染断言 + 8 项 key 清单比对 | `AdminModules.vue:204`（5 处 `<SecretField`：`<div v-else-if="field.type==='secret'" class="secret-control"><SecretField`、两处 `<SecretField v-else-if="field.type==='secret'"`、`<SecretField mode="proxy"`、`<SecretField v-else-if="field.key==='network.httpsProxy'\|\|...appSyncProxy'"`）；`test/secret-reveal.test.js:139`（四处分支 + 8 key）；DOM 断言 `test/secret-reveal.test.js:87`（SSR：已配置 `type="password"` + `secret-eye` + 「清除」；未配置 `secret-eye disabled`） | ✅ 通过 |
| 2 | 已配置默认 `type=password`；点眼睛调 `value` 接口一次 → `type=text`；再点回 `password` 且不再调接口 | 纯函数 + 静态锁 + 代码核对 | `SecretField.vue:9`、`:206-218`（fetch 仅当 `loaded==null`）、`:206` 缓存分支不请求；`utils/secretField.js:26-31`；`test/secret-reveal.test.js:33`（4 种动作断言） | ✅ 通过 |
| 3 | 明文 30 秒无操作自动回 `type=password` | 常量 + 定时器代码 + 静态锁 | `utils/secretField.js:11`（`SECRET_AUTO_HIDE_MS = 30000`）；`SecretField.vue:164`（`setTimeout(hidePlain, SECRET_AUTO_HIDE_MS)`）、`:167-173`（输入/操作重新计时）、`:174`（卸载清理）；`test/secret-reveal.test.js:58` | ✅ 通过 |
| 4 | 未配置：眼睛置灰不可点、不发请求 | 纯函数 + 代码 + SSR DOM | `utils/secretField.js:26-28`（`!hasValue → 'ignore'`）；`SecretField.vue:207`（ignore 直接 return）、`:26`（disabled）、`:100`（代理未配置空框）；`test/secret-reveal.test.js:33/87` | ✅ 通过 |
| 5 | 未改动不提交、留空 = 保持原值；清除二次确认后保存 `null` 回落 env/默认 | 纯函数 + 代码 + 静态锁 | `utils/secretField.js:37-43`；`SecretField.vue:232-236`（unchanged → 提示「没有变化，未提交」）、`:255-271`（confirm → `values:{key:null}`）；批量保存跳过密钥 `AdminModules.vue:814`；`test/secret-reveal.test.js:42` | ✅ 通过 |
| 6 | 显示明文后 `audit_logs` 新增 `admin.secret_revealed`（detail 只含 key、不含值）；非管理员 401/403；非 secret 400（回归） | 真 pglite + 真 HTTP 重跑 | `src/settings-routes.js:57-65`（actorId/actor/action/target/detail:{key}/ip）；`src/server.js:1470`；`test/secret-reveal.test.js:190`（断言：200 + 明文；审计 1 条、`target=key`、`detail` 深等于 `{key}`、`actor=admin`、`actor_id` 匹配、`ip` 非空、序列化后不含明文值；非 secret 400「只能查看敏感字段」；不存在 key 400；匿名 401；普通用户 403；删 `audit_logs` 表后仍 200 说明审计失败不阻塞） | ✅ 通过 |
| 7 | 移动端 375px 眼睛在框内、次要动作换行、无横向溢出；`npm test`（分段）+ `frontend:build` + `scan` 全绿 | CSS 静态 + 构建/扫描重跑；375px 实际渲染需目视 | `SecretField.vue:387-397`（≤560px 动作换行、按钮 `min-height:44px`）、`:333-334` 眼睛 `width/height:44px` + 绝对定位在 `.secret-box` 内；构建/扫描输出见下；375px 目视见「需人工确认」 | ✅ 通过（自动化部分）/ 🔎 目视部分 |

### 重跑输出（实现 HEAD `9d55aad`，命令按 steamdeals-dev §7；`api.test.js` 在 `975bfce` 上跑，`9d55aad` 只改前端组件与测试断言、不触后端路径）

| 命令 | 关键输出 |
|---|---|
| `node test/secret-reveal.test.js` | `tests 9 / pass 9 / fail 0`（9.1s） |
| `node test/settings.test.js` | `tests 21 / pass 21 / fail 0`（29.1s） |
| `node test/api.test.js` | `tests 41 / pass 41 / fail 0`（119.7s；含「系统设置：敏感字段默认不回显，可单独查看明文，非敏感字段拒绝查看」） |
| `node test/admin-edit-dialog.test.js` | `tests 6 / pass 6 / fail 0` |
| `node test/proxy-pool-ui.test.js` | `tests 4 / pass 4 / fail 0` |
| `node test/frontend-registration.test.js` | `tests 9 / pass 9 / fail 0` |
| `node node_modules/vite/bin/vite.js build --config frontend/vite.config.js` | `✓ built`（最终 2.09s） |
| `node scripts/scan-secrets.js` | `✅ 未发现高置信度凭据` / `✅ 未发现可疑的密钥赋值` |

## demo 对照（`?shot=1/2/3` + `-1/-2/-3.png`）

| demo 状态 | 实现 | 结论 |
|---|---|---|
| ① 密文态：密码框 + 框内眼睛 + 圆点 | 密码框 + 框内 44px 眼睛；**懒加载前不预置假值，故未取过明文时是 placeholder「已设置，点右侧眼睛查看」而不是圆点**（决策 8 明确「demo 圆点是静态示意、不手工拼点」） | ✅（按决策 8；视觉差异已记录） |
| ② 明文态：原地变等宽明文 + 眼睛；再点回密文；30 秒自动回 | `type=text` + 等宽字体（`is-plain`）+ 眼睛；再点回 `password`；30 秒定时器 | ✅ |
| ③ 未配置：空框「尚未设置」+ 眼睛置灰 | 一致（SSR DOM 断言锁定） | ✅ |
| ④ 编辑态：保存 / 取消 / 留空保持原值 | 输入后出现「保存 / 取消」，提示「输入新值后保存，留空保持原值」 | ✅ |
| ⑤ 清除：二次确认、回落 env/默认 | 「清除」按钮 + `ElMessageBox.confirm` → 提交 `null` | ✅（按钮在框下方动作行，demo 桌面态在框右侧——移动端形态，行为一致） |
| 图 2：8 个 secret 四类卡片一致；代理多条逐行可复制 | 同一组件四处复用；代理 `mode="proxy"` 逐行展示 + 每行「复制」 | ✅ |
| 图 2 移动端 390px：眼睛在框内、动作换行 | ≤560px 动作换行 + 44px 触摸目标 | 🔎 375px 实机目视 |

## 打回清单（按严重度排序）

| # | 轮次 | 条目 | 问题 | 处置 |
|---|---|---|---|---|
| 1 | 第 1 轮 | 验收 1 / demo 状态② | 明文态不是等宽字体（demo 与规格 §4「等宽字体」不一致） | ✅ 已修：`9d55aad` 增加 `.secret-input.is-plain` 等宽样式 + 静态断言；第 2 轮复检通过 |

第 2 轮无未决打回项。

## 需人工确认

1. **移动端 375px 目视**：本地没有 headless 浏览器运行（本批不跑 e2e/报告会话），只做了 SSR DOM + CSS 断点静态断言；上线/本地起站点后看：眼睛是否在框内、保存/取消/清除是否换行、无横向溢出、触摸目标 ≥44px。
2. **密文态圆点**：见 demo 对照①——实现按决策 8 不预置假掩码，未取过明文时显示 placeholder；需所有者确认这种「未加载不显示假圆点」的视觉可接受。
3. **「清除」按钮位置**：实现统一放在输入框下方动作行（与移动端 demo 一致），桌面 demo 状态⑤画在框右侧；行为一致，需目视确认布局可接受。

## 纪律检查（steamdeals-qa §6）

| 项 | 结论 | 证据 |
|---|---|---|
| 擅自新增 tag | ✅ 无 | `git tag --points-at 9d55aad` 输出为空（无 tag 指向本批） |
| 碰部署/服务器配置/凭据 | ✅ 无 | `git diff --name-only ed2feb2..9d55aad` 过滤 `compose\|DEPLOY\|.env\|credential` 为空 |
| 构建产物/日志入库 | ✅ 无 | `ed2feb2..9d55aad` 无 `frontend/dist`、`*.log`、`pgdata`、`out/` |
| 推送 main | ✅ 已推 | `975bfce`、`9d55aad` 均已 `push origin main` |
| PROJECT-OVERVIEW / TODO / INDEX 文档收尾 | ⏳ 由监工统一更新（本批红线：工人不改发布文档） | 本报告不写状态行；建议监工把 FX 改为「已实现待发版 / 质检通过」并在发布文档统一记录 |

## 复检记录

- **第 1 轮（`975bfce`，2026-11-27）**：规格 §7 逐条取证 → 通过 6 / 偏差 1（明文态非等宽字体，demo 状态②）/ 需人工确认 3；打回 1 条。
- **开发修复（`9d55aad`）**：`SecretField.vue` 明文态加 `is-plain` 等宽字体 + `test/secret-reveal.test.js` 静态断言；重跑 FX 测试 9/9、`frontend:build` ✓、`scan` 干净。
- **第 2 轮（`9d55aad`）**：只重查打回项 + 新增 diff（SecretField.vue +7 行 / 测试 +2 行）+ 相关测试 → **✅ 放行**（通过 7 / 缺失 0 / 偏差 1 已修 / 需人工确认 3）。

## 备注（实现取舍，供监工/所有者知悉）

- 审计失败不阻塞：`writeAuditLog` 在 `src/store/pg.js:2250` 内部 `try/catch` 吞异常；`test/secret-reveal.test.js:190` 用「删表后仍 200」锁定该行为。
- 再点眼睛不重复请求：明文缓存在组件内存 `loadedValue`；父组件批量「保存设置」跳过 secret（`AdminModules.vue:814`），避免懒加载真值被误写库。
- 先输入新值再点眼睛**不会**被旧值覆盖：`SecretField.vue:195-205` 走「只切草稿明文」分支（静态锁 `test/secret-reveal.test.js:58`）。
- 代理列表编辑器打开时会取一次明文（原有 EK-4 行为），现在同样落 `admin.secret_revealed` 审计。
