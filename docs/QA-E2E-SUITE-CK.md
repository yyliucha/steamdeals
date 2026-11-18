# QA：CK e2e 测试套件（第 1 轮）

> 基线 51d1cb5（v2.23.0 发布）→ HEAD 65af42b；判据 [E2E-SUITE.md](E2E-SUITE.md) §8 验收；
> 开发描述来源：docs/TODO.md CK 条目（状态回写因 TODO 被占用暂未落，按 HANDOVER §10 记录于提交 65af42b 的信息）。
> 结论：**✅ 放行 —— 通过 6 / 缺失 0 / 偏差 0 / 需人工确认 0**

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | CK | 一键全量 e2e（完整矩阵 + 后台建删 e2e_ 账号 + 模拟器/真机 + PDF 报告） | `npm run e2e` | ✅ | package.json:58；42 通过/0 失败/3 环境 skip |
| 2 | CK | 一键冒烟（核心链路 ≤5 分钟） | `npm run e2e:smoke` | ✅ | package.json:59；8/8 通过、37.9s |
| 3 | CK | 功能矩阵文件化、可自定义（--only/--tag） | `test/e2e/matrix.json` | ✅ | matrix.json 45 行；--only=game-detail-dlc 单行跑通 |
| 4 | CK | headless Edge 真实浏览器断言（DOM/截图/Console，零新依赖） | `test/e2e/lib/browser.mjs`（CDP 直连） | ✅ | browser.mjs:1-280；npm ls playwright/puppeteer 为空 |
| 5 | CK | 前台链路自动验收（首页/筛选/搜索/详情/DLC/登录/申诉/通知/微信 UA/移动端） | `--tag=front` 16 行 | ✅ | 矩阵 1-16 行全绿 |
| 6 | CK | 后台 13 模块自动验收 | `--tag=admin` 浏览器行 | ✅ | 矩阵 18-30 行全绿 |
| 7 | CK | 后台四类模块完整增删改（用户/愿望单/站点通知/Steam 账号） | api 行 | ✅ | 矩阵 31-38 行全绿（含改密/踢会话/级联删除断言） |
| 8 | CK | e2e_ 测试账号生命周期（开场清孤儿 → 建号 → 收尾无残留） | `lib/account.mjs` | ✅ | account.mjs:60-108；account-delete-assert 行 |
| 9 | CK | Android 模拟器自动拉起/收尾关闭；真机模式无设备立即中断并打印连接步骤 | `lib/adb.mjs` | ✅ | adb.mjs:110-160；--device=real 负例 exit 1 + 步骤文案 |
| 10 | CK | App 安装/覆盖安装（数据保留）/启动/六屏走查 | `--tag=app` 5 行 | ✅ | app-install/cover-install/launch/guest-walk 全绿；update-check 按环境 skip |
| 11 | CK | 部署后公网只读验收（版本/页面/接口 200/TTFB） | `--online --expect-version=` | ✅ | lib/online.mjs；本机未部署按规格 skip（决策 #13） |
| 12 | CK | 邮件真实收件（SMTP 发测试信 + IMAP 拉取断言） | mail 行 | 🔎 | lib/mail.mjs；缺 mail.env 按环境 skip（决策 #6，凭据仓库外） |
| 13 | CK | HTML 报告 → PDF（仓库外，逐行结果/截图/Console/skip 原因/耗时） | `F:\dsh\e2e-reports\` | ✅ | report.mjs；2026-11-17-65af42b.pdf 763KB、45 行齐全 |
| 14 | CK | 发版清单 e2e 全量门禁 + 使用文档 | docs/DELIVERY.md、docs/TESTING-E2E.md | ✅ | DELIVERY.md:66-69；TESTING-E2E.md |

## 逐条核对（规格 §8 验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据 | 判定 |
|---|---|---|---|---|
| 1 | e2e:smoke ≤5 分钟通过；全量矩阵逐行有结果；PDF 在 F:\dsh\e2e-reports\；git status 干净 | 亲自重跑 | smoke 8/8、37.9s；全量 42/0/3、186.4s；report.html 45 行；2026-11-17-65af42b.pdf 763KB；报告目录仓库外 | ✅ |
| 2 | --device=real 无设备立即中断并打印步骤；模拟器自动拉起/关闭 steamdeals35 | 亲自重跑 + 代码 | 负例 exit 1 + 三步连接文案；全量日志「设备就绪…本次自动拉起」+「已关闭本次拉起的模拟器」；adb.mjs:110-160 | ✅ |
| 3 | e2e_ 账号建删无残留、中断后重跑能清孤儿 | 重跑 + 代码 | account-orphan-cleanup / account-delete-assert 行全绿（SQL 断言 0 残留）；收尾检查「无 e2e_ 残留」；只删 e2e_ 前缀 account.mjs:60-76 | ✅ |
| 4 | 反向自检：删 DLC 区块 → 该行失败且截图/Console 留档；恢复后通过 | 已执行并留证 | 删块后 game-detail-dlc 红（「等待 DOM 超时：has=DLC（共 2 个）」），fail-game-detail-dlc.png 91KB 存档；恢复后同命令绿 | ✅ |
| 5 | --only 生效；新增矩阵行必须出现在报告 | 重跑 + 报告 | --only=game-detail-dlc 只跑 1 行；报告 45 行与 matrix.json 行数一致 | ✅ |
| 6 | npm test / frontend:build / scan 全绿；不新增运行时依赖；不自行打 tag | 重跑 + git 取证 | npm test exit 0（19:05 全链）；frontend:build ✓；scan 无凭据；diff 51d1cb5..65af42b 仅 +2 行 scripts（无 dependencies）；git tag 无新增 | ✅ |

## 打回清单

无。

## 需人工确认

- **mail 行（邮件真实收件）**：`F:\dsh\e2e-secrets\mail.env`（163 测试邮箱凭据）由所有者提供后，跑 `npm run e2e` 即可让 mail-smtp-roundtrip 从 skip 转真跑；代码路径已实现（lib/mail.mjs 手写最小 IMAP，零依赖），当前无凭据无法本机验证——按规格 §6 属合法环境 skip，不计失败。
- **app-update-check / app-guest-walk 的内容级断言**：2.19.0 原生包未注册 `steamdeals://check-update` scheme（TWA 世代入口），该行 skip 并注明原因；六屏走查已通（42/0 轮），站内写操作（登录/愿望单）属 R2 真机人工项。
- **online 行**：按决策 #13 部署后带 `--online --expect-version=` 跑，本机未部署故 skip。

## 复检记录

- 第 1 轮（2026-11-17）：✅ 放行（通过 6 / 缺失 0 / 偏差 0 / 需人工确认 0；🔎 2 项为环境依赖项，已列入「需人工确认」）。

## 状态回写

docs/TODO.md 与 REQUIREMENTS-INDEX.md 在质检时被其他会话占用（HANDOVER §10 探测命中），状态回写待收尾复盘补齐：CK → 质检通过（本报告结论）。
