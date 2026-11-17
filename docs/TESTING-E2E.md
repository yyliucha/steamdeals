# e2e 测试套件使用说明（CK 批）

> 入口：[test/e2e/runner.mjs](../test/e2e/runner.mjs) + [test/e2e/matrix.json](../test/e2e/matrix.json)。
> 规格与验收：[E2E-SUITE.md](E2E-SUITE.md)；测试方法库：[gameprice-test 技能](../.dsh/skills/gameprice-test/SKILL.md)。

## 1. 怎么跑

```powershell
cd F:\dsh\gameprice
npm run e2e            # 全量：完整矩阵 + 后台建删 e2e_ 账号 + 模拟器/真机 + PDF 报告（发版前 / 每轮 QA 必跑）
npm run e2e:smoke      # 冒烟：核心链路（首页/搜索/详情/登录/后台登录/申诉页），≤5 分钟
node test/e2e/runner.mjs --only=game-detail-dlc,search-cn   # 只跑指定行（逗号分隔）
node test/e2e/runner.mjs --tag=admin                        # 按组跑（front/admin/app/online/smoke）
node test/e2e/runner.mjs --device=real                      # 真机模式（无设备立即中断并打印连接步骤）
node test/e2e/runner.mjs --online --expect-version=2.22.0   # 部署后公网只读验收（默认 https://sd.yyliucha.cn，--base= 可换）
```

**前置条件**：

1. Node ≥ 22.5（用内置 WebSocket 直连 Edge DevTools 协议，**没有引入 playwright/puppeteer**）；
2. Microsoft Edge 已安装（`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`）；
3. `frontend/dist` 已构建（缺了会自动跑一次 `npm run frontend:build`）；
4. App 行需要 adb + 模拟器 `steamdeals35`（`F:\Android\sdk`；全量会自动拉起并在结束时关闭，真机用 `--device=real`）；
5. 邮件行需要仓库外凭据 `F:\dsh\e2e-secrets\mail.env`（**严禁入库**），缺了该行按"环境不具备"跳过并写明原因：
   ```ini
   E2E_MAIL_USER=your-box@163.com
   E2E_MAIL_PASS=授权码
   E2E_IMAP_HOST=imap.163.com
   E2E_IMAP_PORT=993
   E2E_SMTP_HOST=smtp.163.com
   E2E_SMTP_PORT=465
   ```

**运行行为**：临时 pglite 库（每次全新、用完即删，**不连生产库**）；开场清 `e2e_%` 孤儿账号（只删该前缀）；
逐行执行矩阵（行失败不中断其余行，设备掉线/服务不可用才整体中断）；结束时断言无 `e2e_` 残留、关闭本次拉起的模拟器、
生成 HTML + PDF 报告。失败行自动留截图与 Console 错误。退出码：0 全过 / 1 有失败。

> 环境适配说明（都在 e2e 进程内，不改仓库生产默认）：
> ① `AUTH_SESSION_BIND_UA=0`——e2e 有微信/移动 UA 仿真行，生产默认的「会话绑定浏览器」会因 UA 切换误踢会话；
> ② 图片回源注入 1x1 PNG、DLC 读路径不回源（本机无 Steam 出口）；③ 模拟器用 detached 进程拉起（沙箱下管道 stdio 会挂起 qemu）。

## 2. 报告在哪

- PDF：`F:\dsh\e2e-reports\<日期>-<提交短哈希>.pdf`（仓库外，**禁止 git add**）；
- 逐次产物（HTML/截图/UI 树/Edge 配置目录）：`F:\dsh\e2e-reports\<日期>-run-<时间>\`；
- 报告内容：环境与版本、矩阵**逐行**结果（含断言明细/失败截图/Console/skip 原因/耗时）、线上验收明细、收尾检查。
- 报告中绝不出现邮箱密码与管理员口令（打码），账号名只保留 `e2e_` 前缀形态。

## 3. 怎么加矩阵行（新功能必须加，否则 QA 按覆盖不足打回）

编辑 [test/e2e/matrix.json](../test/e2e/matrix.json) 的 `rows`，一行一条功能：

```json
{
  "id": "my-feature",                  // 唯一 id（--only 用它）
  "name": "功能：一句话",
  "tag": ["front"],                    // front/admin/app/online/smoke；核心链路加 smoke
  "kind": "browser",                   // browser（Edge 页面）/ api（真实 HTTP）/ adb（设备）/ online（公网只读）
  "steps": ["人工可读的怎么做"],
  "assert": ["守什么行为"],
  "expect": "预期",
  "run": [ { "goto": "/" }, { "waitDom": { "has": "关键文案" } }, { "screenshot": "my-feature" }, { "noConsoleError": {} } ]
}
```

`run` 可用步骤（实现见 [lib/steps.mjs](../test/e2e/lib/steps.mjs)）：

| 步骤 | 说明 |
|---|---|
| `goto` / `waitDom` / `assertEval` / `assertUrl` / `click` / `fill` / `fillCaptcha` / `pressEnter` / `screenshot` / `clearConsole` / `noConsoleError` / `viewport` / `resetViewport` / `sleep` / `logout` | 浏览器行为断言（行为级：等 DOM、看渲染、读页面，不做源码字符串断言） |
| `adminLogin` / `userLogin` / `apiCall` / `sql` / `cleanupOrphans` / `assert` / `eval` | 真实 HTTP + 库内核对（`sql` 是核对落库结果，不是造业务假象） |
| `adbInstall` / `adbLaunchApp` / `adbUpdateCheck` / `adbAssertFocused` / `adbScreencap` / `adbUiDump` / `adbTapText` / `adbPackageVersion` | App 设备层 |
| `imapWaitSubject` / `onlineChecks` | 邮件真实收件 / 线上只读验收 |

字符串里的 `${变量}` 会从上下文取值（`${createdUser.id}` 这类上一步保存的值）。
**skip 只允许"环境不具备"**（无真机/无外网/缺 mail.env/未带 --online），且必须写原因计入报告——不得 skip 失败项。

## 4. 两档边界与真实测试清单

- `e2e:smoke` 只跑 `tag=smoke` 的核心链路；`e2e` 全量跑矩阵每一行（含后台 13 模块、四类增删改、
  App 安装/覆盖安装/启动/更新检查/六屏走查、线上只读）。
- App 登录/愿望单等**写操作**与真机微信渲染属 R2（所有者目视人工项）——TWA 硬编码指向公网站点，
  e2e 不对生产库做写操作；矩阵中对应行在无外网时按环境 skip 并写明原因。
- 每批次的 R1 自动证据由本套件产出，R2/R3 清单仍按 [gameprice-test](../.dsh/skills/gameprice-test/SKILL.md) §5.2
  落 `docs/DELIVERY.md`「部署后验证」表，本套件不代替 R2/R3。
