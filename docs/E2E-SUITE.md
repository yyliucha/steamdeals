# e2e 测试套件（功能矩阵 + headless Edge + Android 模拟器/真机 + 公网只读 + PDF 报告）（已实现并发布 v2.24.0）

> 状态：**已实现并发布 v2.24.0（2026-11-17，test(e2e) 65af42b；QA ✅ docs/QA-E2E-SUITE-CK.md 第 1 轮）**；DJ 追加（§1 #14 整轮总预算 + steamdeals-test §2.3 独立报告流程）**已发布 v2.24.5（2026-11-18，实现 c87dfe0；QA ✅ docs/QA-DJ.md 第 1 轮）**。使用说明见 [TESTING-E2E.md](TESTING-E2E.md)。
> 关联：[steamdeals-test](../.dsh/skills/steamdeals-test/SKILL.md)（测试方法库与真实测试门槛）、
> [TODO.md](TODO.md) CK 条目、[HANDOVER.md](HANDOVER.md)（流程与状态词）、[DELIVERY.md](DELIVERY.md)（部署后验证）。

## 1. 已确认的决策（所有者 2026-11-17 逐项确认）

| # | 决策 |
|---|---|
| 1 | 两档：`npm run e2e`（**全量**：完整功能矩阵 + 后台建删 e2e 测试账号）/ `npm run e2e:smoke`（核心链路，≤5 分钟）。**发版后由独立报告会话跑全量并出 PDF**（流程见 [steamdeals-test](../.dsh/skills/steamdeals-test/SKILL.md) §2.3 / TODO DJ；不阻塞构建）；**每轮 QA 跑本批相关矩阵行**（`--only`/`--tag`）。 |
| 2 | 功能矩阵文件化、**可自定义**：`test/e2e/matrix.json`，支持 `--only=<id列表>`、`--tag=<组>`；**新功能必须加行**，否则 QA 按覆盖不足打回。 |
| 3 | 真实浏览器：**headless Edge**（`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`）做 DOM/Console/截图断言；不引入 playwright/puppeteer。 |
| 4 | 移动端：**默认 Android 模拟器 `steamdeals35`（API 35，WHPX）**；真机用 `--device=real`。**设备未连接/掉线 → 立即中断**并提示连接步骤（USB 模式选“传输文件(MTP)”、开发者选项开 USB 调试与 USB 调试（安全设置）、手机点允许）。 |
| 5 | 后台测试从**新建用户**开始：`e2e_<时间戳>`（强密码走密码策略）→ 登录/改密 → 后台 13 模块 → 前台行为 → **彻底删除**并断言用户不存在；**开场先清理 `e2e_%` 孤儿账号**，只删该前缀。 |
| 6 | 邮件真实收件：163 测试邮箱凭据放**仓库外** `F:\dsh\e2e-secrets\mail.env`（脚本只读环境变量，严禁入库）；优先 IMAP 拉取断言，网页邮箱登录仅兜底。 |
| 7 | 报告：运行结束生成 HTML → Edge `--print-to-pdf` → 输出 **`F:\dsh\e2e-reports\<日期>-<提交短哈希>.pdf`**（仓库外，**不提交 GitHub**）；含矩阵逐行结果/失败截图/Console/耗时/skip 原因；**HTML 内嵌 `e2e-results` JSON（行级 status/durationMs），供 CO-4/D6 基线门禁联动**（`node scripts/baseline-gate.mjs --mode=e2e --e2e-report=<HTML>`：失败行/超时行即红）。 |
| 8 | 微信内置浏览器**不做**客户端自动化（条款/封号风险）：用 Edge 设微信 UA 做页面级自动断言；真机微信只留一次性人工确认。 |
| 9 | 部署后**公网只读验收**可自动跑（`--online`）：`/api/site` 版本、页面 dump-dom、截图、关键接口 200、TTFB——不碰服务器/生产库。 |
| 10 | 不新增运行时依赖；e2e 仅用 Node 内置能力 + Edge + adb 子进程。 |
| 11 | **后台矩阵深度**：用户 / 愿望单 / 站点通知 / Steam 账号 **四类走增删改**；其余模块到列表/筛选/详情即可。 |
| 12 | **App 覆盖安装**：以 `frontend/public/app/steamdeals-2.19.0.apk` 作为"旧版"包测覆盖安装（同签名、数据保留）。 |
| 13 | **`--online` 公网验收在部署后跑**（带 `--expect-version=X.Y.Z` 断言新版本）；发版前不跑。 |
| 14 | **整轮总预算（DJ 批）**：默认 20 分钟 deadline（`E2E_BUDGET_MS` 环境变量 / `--budget-ms=` 可调，测试可缩短），到点**强制收尾**——剩余未跑项标「预算截断」、照常生成 HTML/PDF 报告；退出码三态：0 全绿 / 1 有失败 / 2 预算截断。 |

## 2. 现状（代码证据，2026-11-17 核对）

- 现有测试：`test/` 99 个 `*.test.js`，主链 `npm test` 95 个（`package.json` 的 `test` 脚本串联）；
  链外 `api.test.js`（真 HTTP + pglite）等。**没有浏览器级/App 级 e2e**。
- 本机能力（实测）：Edge 存在；`F:\Android\sdk\emulator\emulator.exe` + AVD `steamdeals35`；`adb` 可用；
  JDK 17 可构建 APK；`npm ls playwright puppeteer` 为空（不引入）。
- 历史手工验证成本高：BT/BW/BY/CG 等批次都靠“部署后真机/线上目视”收尾，缺少可重复脚本。

## 3. 交付物与目录

```
test/e2e/
  matrix.json          # 功能矩阵（id/name/tag/断言点/步骤/预期）
  runner.mjs           # 入口：解析参数 → 起本地服务 → 跑矩阵 → 报告
  lib/server.mjs       # 本地服务启动/关闭（pglite 临时库 + setup 建管理员）
  lib/browser.mjs      # headless Edge：dump-dom / screenshot / console 采集 / print-to-pdf
  lib/adb.mjs          # 设备预检 / 启动模拟器 / 安装 APK / tap / uiautomator dump / screencap
  lib/report.mjs       # HTML 报告 + PDF
  lib/budget.mjs       # 整轮总预算（DJ 批）：默认 20 分钟 deadline / 到点「预算截断」/ 退出码三态（纯函数，可单测）
  lib/account.mjs      # e2e_ 测试账号：建/登录/改密/删、孤儿清理
  lib/online.mjs       # 公网只读验收（--online）
```

- `package.json` 新增脚本：`e2e`（全量）、`e2e:smoke`（核心）、`e2e:report`（只重渲染上次报告，可选）。
- **不把报告/截图放进仓库**；`test/e2e/` 只放脚本与矩阵。

## 4. 功能矩阵（初始范围）

- **前台**：首页列表/筛选/排序、搜索（中英）、详情（价格历史/DLC/复制名）、愿望单、登录/注册/改密、通知中心、App 下载页（含微信 UA 提示）、移动端窄屏无横向溢出。
- **后台**（13 模块 + 设置）：游戏管理（列表/筛选/编辑/链接抽屉）、同步与回填、访问记录（IP 统计/明细）、封禁与白名单、异常审核（合并视图/证据）、申诉管理（分段控件/空态/详情）、设备、用户管理（新建/禁用/删除）、愿望单、Steam 账号、登录会话、操作日志（5 tab）、系统设置、邮件服务、站点通知。
  **其中 用户 / 愿望单 / 站点通知 / Steam 账号 四类必须走完整增删改**（见 §1 #11），其余模块到列表/筛选/详情。
- **App**：安装/覆盖安装（同签名数据保留）、首次启动游客浏览、登录（验证码）、愿望单、主题、内置更新检查、启动封禁提示、六屏走查。
- **线上**（`--online`）：`/api/site` 版本、首页/后台关键页 dump-dom、`/app` 页版本与下载链接、TTFB 采样。

每行结构：`{ id, name, tag, steps, assert, expect }`；`tag` 用于分组（front/admin/app/online/smoke）。

## 5. 执行流程（全量一次的标准顺序）

1. 预检：Edge 存在；`--device=real` 时 `adb devices` 必须有设备，否则**中断**；模拟器模式自动启动 `steamdeals35`。
2. 起本地服务：临时 pglite 库（随机端口 + 临时目录）→ setup 建管理员 → 最小种子数据（若干游戏/报价/快照）。
3. 清理孤儿 `e2e_%` 用户 → 新建 `e2e_<ts>` → 登录/改密。
4. 跑矩阵（前台 → 后台 → App → 可选线上），逐行记录结果/截图/Console；**整轮总预算**默认 20 分钟（决策 #14），到点剩余未跑项标「预算截断」后照常收尾。
5. 收尾：删除 `e2e_<ts>` 并断言 401/不存在 → 关服务 → 清理临时库 → 生成报告 → 打印摘要（通过/失败/skip/耗时/报告路径）。
6. 失败截图与日志保留在 `F:\dsh\e2e-reports\<run>\`。

## 6. 判定与失败处理

- 断言失败即该行失败，继续跑完其余行（不 fail-fast，除非设备/服务不可用）。
- 设备掉线/服务启动失败 → 立即中断，报告写明原因与已跑行。
- skip 只允许“环境不具备”（如无真机、无外网），且必须写原因并计入报告；**不得 skip 失败项**。
- 真实外部依赖（Steam/ITAD/GOG 真实请求）默认 skip 并在报告注明（本机无出口）。
- **预算截断（DJ 批）**：整轮预算到点 → 剩余未跑项标「预算截断」（不算 skip、不算失败）、报告照常生成、退出码 2；
  按“轮次不完整”处理——不得报全绿，定位拖慢行后延长预算（`E2E_BUDGET_MS`）或拆批重跑。

## 7. 安全与合规

- 测试库为临时 pglite，**不连生产库**、不动服务器。
- 邮箱密码等凭据从 `F:\dsh\e2e-secrets\mail.env` 读取（仓库外）；日志/报告不出现密码。
- 只删除 `e2e_` 前缀账号；报告中不出现真实用户名/邮箱全文（打码）。
- 报告目录在仓库外，`git status` 必须保持干净。

## 8. 验收

1. `npm run e2e:smoke` ≤ 5 分钟通过；`npm run e2e` 全量矩阵逐行有结果，PDF 生成在 `F:\dsh\e2e-reports\`，仓库 `git status` 干净。
2. 设备预检：`--device=real` 无设备时**立即中断**并打印连接步骤；模拟器模式自动拉起 `steamdeals35` 并在结束时关闭。
3. 测试账号：新建 → 登录 → 后台操作 → 删除，结束无 `e2e_` 残留；中断后重跑能清理孤儿。
4. **反向自检**：故意删掉一个页面区块（如 DLC 区块）→ e2e 该行失败、截图与 Console 留档；恢复后通过。
5. `--only=games` 只跑指定行；新增矩阵行必须出现在报告里。
6. `npm test` / `frontend:build` / `scan` 全绿；不新增运行时依赖；不自行打 tag。

## 9. 实施顺序

1. `lib/server.mjs`（起服务 + setup）+ `lib/account.mjs`（建删账号/孤儿清理）——先打通"能本地跑起来"；
2. `lib/browser.mjs`（dump-dom/screenshot/console/print-pdf）+ 前台矩阵行；
3. 后台矩阵行（13 模块，含分段控件/空态断言）；
4. `lib/adb.mjs`（模拟器/真机）+ App 矩阵行；
5. `lib/report.mjs`（HTML→PDF）+ 摘要输出；
6. `lib/online.mjs`（--online 公网只读）；
7. 文档：`docs/TESTING-E2E.md`（怎么跑/怎么加行/报告在哪）、DELIVERY 发版清单加"e2e 全量通过"门禁。

## 10. 待确认问题

无（三项已并入 §1 #11–#13：后台矩阵深度、App 覆盖安装旧版包、`--online` 部署后跑）。

