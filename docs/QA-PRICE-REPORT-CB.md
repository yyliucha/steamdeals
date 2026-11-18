# QA：价格报表邮件 HTML 化 + 内容增强（CB，第 1 轮）

> 基线 `9149a4c` → HEAD `65140cf`；实现 commit `c5fc536`（同一区间的 `8817207`/`92cae3e`/`605e05a` 为 BW/BY 批，已由其它质检判定，不属本轮）。
> 判据：[PRICE-REPORT-EMAIL.md](PRICE-REPORT-EMAIL.md) §4 验收 1–6 + 设计 §3（3.1 渲染 / 3.2 内容 / 3.3 投递 / 3.4 设置）+ §5 本批不做。
> 结论：⚠️ 有条件放行 —— 通过 5 / 缺失 0 / 偏差 1 / 需人工确认 2（验收 4、6）

## 功能清单（本批交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口 | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | CB | 报表邮件正文 HTML 化（品牌头 SteamDeals + 「价格报表」+ 日期 · 近 N 小时） | 每日调度 `report price --notify` 邮件 | ✅ | src/price-report-html.js:97-105 |
| 2 | CB | KPI 三卡：降价 / 涨价 / 新史低大数字 + 说明 | 同上 | ✅ | src/price-report-html.js:91-95,108 |
| 3 | CB | 今日降价 Top 5：名称 / 平台 / ¥原价→现价 / -N% 折扣徽标 / Steam ↗（有 appid 才出） | 同上 | ✅ | src/price-report-html.js:68-80 |
| 4 | CB | 游戏名可点 → 站内搜索链接（encodeURIComponent 防注入） | 同上 | ✅ | src/price-report-html.js:12,73 |
| 5 | CB | 涨价提醒 Top 3：紧凑行 + 「关注中的游戏可能变贵」 | 同上 | ✅ | src/price-report-html.js:82-89,114-116 |
| 6 | CB | 近 7 天趋势：table 双色迷你柱状条 + 每日降/涨/合计数值（无图片） | 同上 | ✅ | src/price-report-html.js:51-66,117-121 |
| 7 | CB | CTA 按钮「打开 SteamDeals」→ 站点首页 | 同上 | ✅ | src/price-report-html.js:122-124 |
| 8 | CB | 页脚：自动发送说明 + 站点链接 + 每天一次频率说明（无退订链接） | 同上 | ✅ | src/price-report-html.js:126-129 |
| 9 | CB | multipart/alternative：HTML + 纯文本 fallback（口径与旧 CLI 完全一致，供不支持 HTML 的客户端与 webhook/企微） | 邮件/通知通道 | ✅ | src/price-report-html.js:36-49；test/price-report-html.test.js:135-146 |
| 10 | CB | webhook / 企业微信仍发纯文本（内容不变） | 通知通道 | ✅ | src/notify.js:332-335 |
| 11 | CB | 邮件主题含日期与数字：`SteamDeals 价格报表 · 11-16 \| 降价 46 / 新史低 46` | 邮件 | ✅ | src/price-report-html.js:34 |
| 12 | CB | 新增设置「站点公开地址」site.publicUrl（env `SITE_PUBLIC_URL`，默认 `https://sd.yyliucha.cn`），邮件站内链接以它为准 | 后台 → 系统设置 → 站点与内容 | ✅ | src/settings.js:76-78；src/cli.js:2359 |
| 13 | CB | 手机端单列适配（≤480px） | 手机邮箱 | ⚠️ | 未实现：src/price-report-html.js 无 `@media`（见打回清单 1） |
| 14 | CB | QQ / 163 / 企业微信邮箱 / 手机客户端显示正常（600px 内、无横向滚动、按钮可点） | 真机 | 🔎 | 验收 4，需真机 |
| 15 | CB | 部署后手动 `node src/cli.js report price --notify` 收到 HTML 邮件 | 部署侧 | 🔎 | 验收 6，需部署 |

## 逐条核对（规格验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | 渲染单测：KPI 数字、Top5/3 条数、金额与折扣、7 天数值、站内与 Steam 链接；`<script>`/引号转义；无外部图片/CSS URL；无 flex/grid | 打开 test/price-report-html.test.js 逐条核对断言（真锁） | 断言逐条见下方 1a-1j；文件 test/price-report-html.test.js | ✅ |
| 1a | KPI 数字 46/83/新史低 | assert `>46<`、`>83<`、`/新史低/` | test/price-report-html.test.js:57-59 | ✅ |
| 1b | Top5 只取 5 条（第 6 条不出现） | `!html.includes('Game F-extra')`（样例 6 条） | :61 | ✅ |
| 1c | Top3 只取 3 条（第 4 条不出现） | `!html.includes('Rise D-extra')`（样例 4 条） | :62 | ✅ |
| 1d | 金额分转元 | `/¥108\.00/`（was=10800）、`/¥54\.00/`（now=5400） | :63-64 | ✅ |
| 1e | 折扣取整徽标 | `/-50%/`（5400/10800） | :65 | ✅ |
| 1f | 7 天日期与数值 | `/2026-11-10\|11-10/`、`/降 40/` | :66-67 | ✅ |
| 1g | 站内搜索与 Steam 链接 | `/\?q=Hades%20II/`（encodeURIComponent）、`/\/app\/1145350\//`；无 appid 行（杉果）不出现 store.steampowered.com | :85-89 | ✅ |
| 1h | `<script>` 转义 | `!html.includes('<script>alert(1)</script>')` 且 `&lt;script&gt;` 存在 | :77-78 | ✅ |
| 1i | 引号不裸出 | `!html.includes('"引号"')` | :79 | ✅ |
| 1j | 无外部图片/CSS/其它 URL；无 flex/grid | 负向正则 `/https?:\/\/(?!sd\.yyliucha\.cn\|store\.steampowered\.com)/`、`!/<img|flex|grid/` | :80-84 | ✅ |
| 1k | 纯文本 fallback 口径与旧 CLI 一致 | `SteamDeals 价格报表（近 24 小时）`、`降价 46 条 / 涨价 83 条 / 新史低 46 条`、`↓ ¥108.00 → ¥54.00（-50%）Hades II · Steam 国区`、`近 7 天：2026-11-10 降10/涨20；`（逐字符对照旧 src/cli.js 拼串，见 git diff 9149a4c..HEAD -- src/cli.js 删除行） | :69-72 | ✅ |
| 2 | deliver 单测：email 收到 html → multipart/alternative 两段；webhook/wecom 只发 text | 假 SMTP + 假 HTTP 端到端；代码签名核对 | src/notify.js:326,331（email 透传 html）、332-335（wecom/webhook 只 text）；test/price-report-html.test.js:93-155 | ✅（wecom 无显式断言，见风险提醒 3） |
| 2a | 假 SMTP 真收到 multipart 两段 | `smtpState.data` 匹配 `/multipart\/alternative/`、`/Content-Type: text\/html/` | test/price-report-html.test.js:135-136 | ✅ |
| 2b | HTML 段可解码且含 KPI | base64 分段解码后 `parts.some(p => p.includes('>46<') && p.includes('价格报表'))` | :137-145 | ✅ |
| 2c | 纯文本段口径不变 | 解码后 `降价 46 条 / 涨价 83 条` | :146 | ✅ |
| 2d | webhook payload 无 html | `!got.html` 且 `got.text` 含统计行 | :147-150 | ✅ |
| 3 | CLI/假 SMTP：`report price --notify` 发 multipart、HTML 段含 KPI、纯文本原口径 | CLI 接线静态断言 + 同一端到端假 SMTP 用例 | src/cli.js:2356-2368（renderPriceReport→deliver(text,html,payload,subject)）；test/price-report-html.test.js:160-163（import/调用/SITE_PUBLIC_URL/传参断言） | ✅ |
| 4 | 真机：QQ/163/企业微信邮箱/手机客户端显示正常（600px 内、无横向滚动、按钮可点） | 本地无法验证 | — | 🔎 |
| 5 | `npm test` 全绿；`npm run scan` 通过 | 亲自重跑 | 见「重跑验证」节 | ✅ |
| 6 | 部署侧：后台邮件配置后手动 `report price --notify` 收到 HTML | 本地无法验证 | — | 🔎 |

### 设计 §3 逐条

| # | 设计条目 | 证据（文件:行） | 判定 |
|---|---|---|---|
| 3.1 | `renderPriceReport({report, daily, siteUrl, siteName, now})` → `{subject, html, text}` 纯函数零依赖 | src/price-report-html.js:23-24（仅 import report.js 的 esc/fmtYuan，无第三方依赖） | ✅ |
| 3.1 | report/daily 数据源对接 | src/cli.js:2325-2326（db.priceChanges / priceChangesByDay）；字段名 steam_appid/name/platform_name/was/now_price/drop_cents 与 src/store/pg.js:735-739 一致；daily {day,drops,rises,changed} 与 pg.js:818-823 一致 | ✅ |
| 3.1 | 内联 CSS + table、600px 居中、无外部图片/字体/CSS、无 flex/grid | price-report-html.js:99-132（全部内联；`width="600"`+`align="center"`+`max-width:600px`；无 `<img>`/`<link>`/`url()`；测试 :80-84 锁定） | ✅ |
| 3.1 | `@media (max-width:480px)` 单列适配 | **grep `@media`/`<style` 无结果**（整文件无任何媒体查询） | ⚠️ |
| 3.1 | 动态字段全转义；金额分→¥x.xx；折扣取整 | esc 覆盖 `&<>"'`（src/report.js:12-13）；fmtYuan 分转元（report.js:15）；pctOf 四舍五入（price-report-html.js:15）；游戏名/平台/日期/siteName 均过 esc（:60-63,73-74,85,104,123,127-128） | ✅ |
| 3.1 | 链接：站内首页/搜索 encodeURIComponent；Steam 有 appid 才出；URL 全部代码构造 | :12,14,70,73,123,128（不从数据取 URL；测试 :82 无第三域 URL） | ✅ |
| 3.2 | ①品牌头+日期+近N小时 ②KPI 三卡 ③降价 Top5（名称链接/平台/¥原价→现价/-N%徽标/Steam↗）④涨价 Top3 紧凑行+提醒文案 ⑤7 天 table 双色柱状+数值 ⑥CTA ⑦页脚+频率说明无退订 | ①:102-105 ②:91-95,108 ③:68-80 ④:82-89,114-116 ⑤:51-66,117-121 ⑥:122-124 ⑦:126-129 | ✅ |
| 3.3 | deliver 签名 `{text, html=null, payload, subject, ...}`；email 传 html、webhook/wecom 仍 text | src/notify.js:326-335 | ✅ |
| 3.3 | `cmdReport --notify` 无论通道都生成 {subject,html,text}；subject 含日期与数字；encodeSubject 兜底 | src/cli.js:2354-2368；subject 生成 :34；encodeSubject 去 CR/LF（notify.js:86-90） | ✅ |
| 3.3 | 邮件失败保持现有语义（ok:false、notify.* 日志、CLI 退出码 1） | src/cli.js:2369-2373 保留；notify.js:310-316 保留 | ✅ |
| 3.4 | `site.publicUrl`（env SITE_PUBLIC_URL，默认 https://sd.yyliucha.cn） | src/settings.js:76-78；CLI 读 env（经 hydrateCliSettings 水合，DB>env>默认，cli.js:124-141,2359）；settings/setup 计数 65 | ✅ |
| 3.4 | 不新增 HTML 开关；企微/webhook 保持纯文本 | 无开关代码；notify.js:332-335 | ✅ |
| §5 | 本批不做：无模板编辑器/无图片或外部托管/未改频率与收件人/无富文本 webhook 企微/无附件 | c5fc536 未动 scheduler.js、邮件设置逻辑；HTML 无 `<img>`；无附件代码；diff 核对 | ✅ |

## 重跑验证（本人执行）

| 命令 | 结果 | 关键输出 |
|---|---|---|
| `npm test`（第 2 次） | exit 0，87 个测试文件 0 失败 | `files completed: 87`、`files with failures: 0`、`not-ok lines: 0` |
| `npm test`（第 1 次） | 瞬时失败于 test/frontend-mobile.test.js:94（BY 批文件） | 归因见「风险提醒 4」：BY 会话 13:53-13:56 半写工作区（新断言已落、Manifest 未落），非 HEAD 缺陷、非 CB 缺陷 |
| `node test/price-report-html.test.js` | 4/4 通过 | CB-1 渲染、CB-1 转义、CB-2 deliver 假 SMTP、CB-3 CLI 接入 |
| `npm run frontend:build` | ✓ built in 3.12s（CB 未动 frontend/，例行验证） | — |
| `npm run scan` | ✅ 扫描 466 文件，无高置信度凭据 | 未发现凭据/可疑密钥赋值 |

## 打回清单（按严重度排序）

- **条目 §3.1（偏差，必修或说明）**：`@media (max-width:480px)` 单列适配缺失——src/price-report-html.js 无任何媒体查询，600px 固定宽表格在手机邮箱（QQ/163/企业微信移动端）存在横向滚动风险，与验收 4「手机客户端显示正常、无横向滚动」直接相关。
  - 补法建议：在 `<head>` 加 `<style>` 块（@media 无法内联；规格「无外部 CSS」不禁止内部 `<style>`）：≤480px 时 KPI 三卡改竖排/窄行、表格 `width:100%`、柱状条 BAR_MAX_PX 收窄（如 60px）、标题字号下调。
  - 若开发者认为当前结构已足够（多数移动客户端会自动缩放），请申辩理由，由所有者裁定豁免（见争议项），并与验收 4 真机复核绑定。
  - 同步补一条单测：`assert.match(html, /@media\s*\(max-width:\s*480px\)/)`。

## 需人工确认

- **验收 4（真机）**：QQ 邮箱、163 邮箱、企业微信邮箱、iOS/Android 手机邮件客户端的实际渲染（600px 内、无横向滚动、链接/CTA 可点）。本地无法验证；与打回清单第 1 条联动——若先补 @media 再真机复核更稳。
- **验收 6（部署侧）**：部署后后台配置好邮件服务，手动执行 `node src/cli.js report price --notify`，确认收到 HTML 邮件（multipart/alternative，客户端显示 HTML 段）。
- 第一次整链 npm test 的瞬时失败（BY 批文件）建议 BY 会话收尾时确认其修复提交后整链仍绿。

## 争议项（待所有者裁定）

- **规格 §3.1 内部张力**：「HTML 只用内联 CSS + table 布局」与「`@media (max-width:480px)` 做单列适配」矛盾——@media 必须写在 `<style>` 块里，不可能内联。开发未实现 @media，也未在提交中申辩。质检意见：规格意图是「不引外部资源 + 手机可用」，应允许内部 `<style>` 块承载 @media（不违反「无外部 CSS」）；请所有者裁定补 @media 或豁免现状。

## 风险提醒（查多 + 纪律）

1. **范围外改动**：`9149a4c..HEAD` 区间含 BW/BY 批文件（android/、frontend/src/pages/*.vue、src/server.js、test/admin-console-mobile.test.js、test/frontend-mobile.test.js、test/serve.test.js、docs/MOBILE-APP-TWA.md、docs/MOBILE-APP-UPDATE.md、docs/DELIVERY.md、README.md）——经 `git log -- 文件` 归因确认全部属于 `8817207`（BW）/`92cae3e`（BY），由其它质检判定，不在本轮。
2. **siteUrl 未校验 http(s) 前缀**：renderPriceReport/cli.js 直接把 `SITE_PUBLIC_URL` 拼进 href（src/cli.js:2359、price-report-html.js:12,123）。URL 不从数据取（注入面只有管理员配置），风险低，但建议在 cli.js 或渲染器内加 `/^https?:\/\//` 校验（规格 §3.1「所有 URL 只接受 http(s)」的严格读法）。记录即可。
3. **wecom「只发 text」无显式单测**：CB-2 假 SMTP 用例覆盖 email+webhook；wecom 分支靠 sendWecom 只收 text 的签名结构锁定（src/notify.js:65,333），现有 test/notify.test.js:170-184 未断言 body 不含 html。建议复检轮补一行断言。记录即可。
4. **并发会话干扰（本次实测）**：BY 会话（第 1 轮打回修复中）在 13:53-13:56 半写工作区（test/frontend-mobile.test.js 新断言已落、AndroidManifest.xml 尚未落），导致第 1 次整链 npm test 在 frontend-mobile.test.js:94 瞬时失败；第 2 次全链 exit 0。BY 修复当前未提交（git status：android/ 3 文件 M + UpdateDialogActivity.java 未跟踪 + test/frontend-mobile.test.js M，TODO 行注明「提交哈希待补」）。HEAD 自身的 manifest 与测试自洽（经 `git show HEAD:...` 核对），纯 HEAD 状态整链可绿。CB 判定不受影响，但报告如实记录。
5. **纪律项**：`git tag --list` 无新增 tag（最新 v2.17.0 / app-v2.16.0 为 2026-11-14，早于基线）；c5fc536 与 65140cf 提交仅含源码/测试/文档，无构建产物与日志；main 与 origin/main 同步（已推）；docs/PROJECT-OVERVIEW.md CB 行已同步；MAIL-CONFIG-PAGE.md §7 已补；未跟踪文件（pf7.log/pf8.log/steamdeals-2.16.0.apk.idsig 等）非 CB 产物，未触碰。
6. **测试主链**：test/price-report-html.test.js 已进 package.json test 主链（notify.test.js 与 watchlist.test.js 之间），主链跑得到。

## 复检记录

- 第 1 轮（2026-11-16）：⚠️ 有条件放行——打回 1 条（§3.1 @media 单列适配缺失），待开发补齐或所有者裁定豁免后复检；复检时只需重查该项 + 新增 diff + `npm test` 兜底。
- 第 2 轮（2026-11-16）：第 1 轮偏差 1 条 → becff89 修复 → 复检（只重查打回项 + 新增 diff + npm test 兜底）→ ✅ 放行（通过 5 / 缺失 0 / 偏差 0 / 需人工确认 2 沿用第 1 轮：验收 4 真机邮箱显示、验收 6 部署后手动 `report price --notify`）。打回项核证：`<style>` 块位于 renderPriceReport 返回 html 的 `<head>` 内且含 `@media (max-width:480px)`（src/price-report-html.js:98-100）；class 与规则逐一配对——`table.main`×1 挂 600px 主表格（:103）、`td.kpi`×3（:110）、`td.stack`×37（5 降×3 + 3 涨×2 + 4 天×4 数据格，test fixture 实证渲染计数一致；趋势表 header 行未加 .stack，≤480px 时 header 保持横向一行、数据行堆叠，属实现取舍，随验收 4 真机目视）；桌面样式不变（主表 `width="600"`/内联 `width:600px;max-width:600px` 原样保留，媒体查询仅 ≤480px 生效）；约束不冲突（无 flex/grid、无 `<link>`/`<img>`、`<style>` 为内嵌块非外部 CSS，负向断言 :80-84 仍锁定）。断言：test/price-report-html.test.js:91-95 新增 4 条（@media 480 / td.stack 堆叠 / td.kpi 堆叠 / table.main 全宽）。重跑：`node test/price-report-html.test.js` 4/4 通过；`npm test` exit 0（87 个测试文件 0 失败）；`npm run frontend:build` ✓ built in 2.50s；`npm run scan` 469 文件无高置信度凭据。新增 diff（65140cf..HEAD）：becff89（4 文件，仅 src/price-report-html.js + 测试 + TODO/INDEX 状态行）与 13ccd9d（TODO 哈希回写）无回归、未碰 android/ 与部署配置、无新增 tag；同区间 8585dba/8d8412b 为 BY 批修复，由另一质检判定，不在本轮。遗留记录（不阻断）：4 条断言锁的是规则存在而非 class 挂载位置（挂载由源码与实证渲染核对）；趋势 header 行横向显示待真机确认观感。
