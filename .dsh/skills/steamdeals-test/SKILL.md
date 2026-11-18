---
name: steamdeals-test
description: SteamDeals/gameprice 的测试方法库与真实测试门槛：分层策略（纯函数 / pglite 数据层 / 真 HTTP / 前端编译级与 headless 渲染）、断言质量三原则（断言行为、反向自检、注释约束）、项目踩坑模式库、全量 e2e 与冒烟两档（功能矩阵 + 后台建删 e2e_ 测试账号 + headless Edge + Android 模拟器/真机 adb + 公网只读验收）、真实测试即上线门槛（R1 自动 / R2 所有者目视 / R3 部署）、报告生成 PDF 不入库；写测试、排查测试失败、判断"测试是否真锁住行为"时使用。
---

# 测试（SteamDeals / gameprice）

> **开工前自检（2026-11-18 修订：允许复用会话，不再强制新开会话）**：动手/回复实质内容前先自检：
> 1. 交接消息是否满足 `docs/HANDOVER.md` §7 的**自包含 8 项**（仓库与 HEAD、技能、编号、规格路径、范围、验收、纪律、汇报格式）——不完整先补全，不得凭记忆开工；
> 2. 本会话是否残留**别的编号的未完成任务**（未提交改动、写到一半的报告）——有则先收尾旧任务或说明归属，不把多个编号的工作混进同一批提交；
> 3. 目标编号是否已被其他会话占用（TODO 状态 / 未提交改动 / 对话声明）——占用就跳过并等待（HANDOVER §10.5）。
>

> **路径基准**：下文 `docs/…`、`src/…`、`test/…` 都相对**仓库根** `F:\dsh\gameprice`。
>
> **分工**：`steamdeals-dev` 写代码 + 写测试（交付物）；**本技能给"怎么写、怎么写才算数"**；
> `steamdeals-qa` 判"测试是否真锁住行为"；`steamdeals-build` 发版前确认测试与真实测试清单齐全。
>
> **技能镜像**：同一份文件镜像在私有仓库 `yyliucha/dsh-skills`；修改后执行
> `pwsh F:\dsh\gameprice-skills\sync.ps1` 同步（见该仓库 README）。

## 0. 三条硬规则

1. **能自动化的真实测试，必须落成脚本**——不允许用"人工验一下"代替可自动化的项；人工只能留给物理设备/真实客户端/主观验收。
2. **测试必须能抓住坏实现**：每条新增断言都要做**反向自检**（故意改坏实现 → 测试变红）；做不到就说明它没锁住行为。
3. **真实测试 = 上线门槛**：CI 双绿 ≠ 上线，质检通过 ≠ 上线；只有「部署 + 真实测试清单全过 + 结果回填」才算上线。

## 1. 分层策略（按改动类型选层，别全都写成静态断言）

| 层 | 范围 | 做法 | 例子 |
|---|---|---|---|
| **L1 纯函数/单元** | 解析、匹配、格式、策略 | `node:test` + `node:assert/strict`，最快最多 | `match.js`、`price-report-html.js`、`password-policy.js` |
| **L2 数据层** | 迁移、SQL 口径、幂等/唯一键 | **pglite 真 SQL**（DDL 10–30s 属正常；迁移跑两次验幂等） | `pg.test.js`、`store.test.js` |
| **L3 HTTP/API** | 鉴权、权限、限流、封禁、状态码 | **真 HTTP + pglite**（`test/api.test.js` 模式；起服务监听随机端口） | `api.test.js`、`appeal-system.test.js` |
| **L4 前端** | 页面渲染、交互、响应式 | 静态断言 **+ `@vue/compiler-dom` 编译级断言**；关键区块用 headless Edge 真实渲染断言 | `price-history-report.test.js`（BN 批回归）、`admin-console-mobile.test.js` |
| **L5 真实环境 e2e** | 全站/全后台/App | 见 §2/§6（headless Edge + 模拟器/真机 adb + 公网只读） | `test/e2e/*` |

**解析类一律打真实夹具**（`test/fixtures/real-*`），**禁止假 HTML/假 JSON**——假数据测不出站点改版。

## 2. 功能矩阵与两档 e2e

### 2.1 功能矩阵（全量的依据，可自定义）

- 文件：`test/e2e/matrix.json`（或 `.mjs`），每行一项功能：
  `{ id, name, tag, 断言点, 步骤, 预期 }`；来源 = `docs/PROJECT-OVERVIEW.md` 功能表 + 后台 13 模块 + App 六屏 + 前台页面。
- **可自定义**：`npm run e2e -- --only=games,appeals` 只跑指定项；`--tag=admin` 按组跑；矩阵可增删行。
- **规则：新功能必须加矩阵行**，否则 QA 按"覆盖不足"打回；报告逐行输出，漏项一眼可见。
- **页面类批次（2026-11-17 起）**：规格附 `docs/design/*.html` demo 时，**demo 的每个关键状态必须映射成矩阵行**
  （一状态一行、每行至少一条断言）。例：CL 详情页 =「未设置（无取消按钮）/ 已设置（提醒中 chip + 取消）/
  已拥有隐藏（普通用户）/ 移动端折叠」四行。**没有对应矩阵行的 demo 状态视为没测**。

### 2.2 两档

| 命令 | 内容 | 何时跑 |
|---|---|---|
| `npm run e2e`（全量） | 完整矩阵 + 后台**建删 e2e_ 测试账号**全流程 | **发版前必跑**（`steamdeals-build` §3.3 门禁）；**QA 轮只跑本批相关矩阵行**（`--only`/`--tag`，2026-11-18 降档） |
| `npm run e2e:smoke` | 核心链路（首页/搜索/详情/登录/后台登录/申诉页） | 日常提交前 |

全量不允许"抽几条代表性跑"——矩阵里每一行都要有结果；跳过项必须写明原因并在报告中单列。

## 3. 断言质量三原则

1. **断言行为，不断言实现字面量**：`assert(code.includes('xxx'))` 这种静态断言只能证明"字符串还在"，不能证明"页面会渲染/接口会返回正确"；必须补运行级/编译级断言。
2. **反向自检**：新测试写完，故意把实现改坏（或把旧 bug 放回去），确认测试变红；把这次自检写进测试注释。
3. **注释写清守的约束**：`// 这条断言守的是：列表读模型新老实现 total 一致`。

## 4. 踩坑模式库（本项目真实案例 → 正确写法）

| 踩过的坑 | 错误写法 | 正确写法 |
|---|---|---|
| `v-for`+`v-if` 同元素 → 整块不渲染（BN 批） | 断言源码里出现 `p.price_cents === histLow` | 用 `@vue/compiler-dom` 编译产物断言 + 全组件扫描禁止同元素写法；旧写法放回必须红 |
| `fetchJson` 契约变更（C1 批） | 只断言"请求成功" | 断言解包后的 `data.json` 形状与关键字段 |
| 调度器默认参数漂移 | 只断言"任务存在" | 断言默认参数值、开关、环境变量覆盖（`scheduler.test.js`） |
| 迁移非幂等 | 只跑一次 migrate | **连跑两次 migrate** 不报错、不重复建对象 |
| 去重/幂等失效 | 断言"插入成功" | 同键二次写入只加计数/不新增行；`unique` 约束存在 |
| 限流/封禁顺序错误 | 只断言 429 | 断言"黑名单不计数、白名单不升级、页面桶与 API 桶分离" |
| 日期/时区偏移 | 断言 `Date` 对象 | 断言 `::text` 的 `YYYY-MM-DD` 字符串 |
| 金额浮点误差 | 断言 `=== 99.99` | 一律整数分 `*_cents` |
| 路由白名单漏登记 | 断言页面可打开 | 白名单一致性 + 未命中路径 404（`serve.test.js`） |
| 邮件 HTML 注入/外部资源 | 断言含关键字符串 | 断言转义、无 `http(s)://` 外部资源、`multipart` 两段 |
| PG16+ 语法 | 本地新库能过 | CI/测试里禁 `any_value`/`json_table` 等 |

## 5. 真实测试 = 上线门槛

### 5.1 三级（谁验、验什么）

| 级别 | 内容 | 执行者 | 说明 |
|---|---|---|---|
| **R1 自动真实环境** | 本地全栈 + **headless Edge**（DOM/Console/截图）+ **Android 模拟器/真机 adb**（安装/覆盖/走查/截图）+ **公网只读**（部署后 `/api/site`、页面、TTFB） | **会话自己** | 默认模拟器 `steamdeals35`；`--device=real` 用真机 |
| **R2 所有者目视** | 模拟器覆盖不了的真机特性（小米浏览器 history 时序、微信内置浏览器渲染、真机字体/触控）、QQ/163 邮箱 App 与企微客户端渲染、主观验收 | 所有者 | 清单由会话生成，所有者逐项勾选 |
| **R3 部署人员** | 部署动作（pull/up/重启）、迁移执行、生产侧检查（尽量改用后台页面目视，不碰生产库） | 部署人员 | 硬规则 4 |

微信客户端**不做**自动化（违反其条款、有封号风险）：用 headless Edge **设微信 UA** 做页面级自动断言，真机微信只留一次性人工确认。

### 5.2 清单规则与落点

- 每批次按改动面生成「真实测试清单」，每项必须含 **怎么验（步骤/路径/命令）· 预期 · 判读标准**；禁止"验证一下没问题"。
- 纯文档/内部重构可写"无真实测试项"（R1 的自动检查仍要跑）。
- 落点三处：① TODO 条目「真实测试」段（开发交付时写）；② QA 报告「需人工确认」表（质检核对完整性）；
  ③ `docs/DELIVERY.md`「部署后验证」回填（`编号 | 项 | 谁验 | 时间 | 结论`）。
- 不通过 → TODO 回「质检打回」或新开 bug 条目；**不得把未验写成通过**，本机跑不了写「待真机/待部署」。
- 会话不得替所有者勾选，不得用 pglite 推断线上，不得因 CI 绿就报"上线"。

## 6. e2e 执行规范

### 6.1 设备前置检查（必须）

- 默认模拟器：启动 `F:\Android\sdk\emulator\emulator.exe -avd steamdeals35`，等 `adb wait-for-device` + `sys.boot_completed=1`。
- **真机模式**（`--device=real`）：先 `adb devices`；**没有设备就立即中断**并提示：
  「请连接手机：① USB 模式选**传输文件（MTP）**；② 开发者选项打开 **USB 调试** 与 **USB 调试（安全设置）**（小米需要后者才能模拟点击）；③ 手机上点"允许 USB 调试"」。
- 设备断开（`adb devices` 掉线）→ 中断并报告，不跳过当通过。

### 6.2 测试账号生命周期（后台全流程的起点）

1. 开场清理孤儿：列出 `e2e_%` 前缀账号 → 逐个「彻底删除」；**只删 `e2e_` 前缀**，绝不碰真实用户。
2. 新建：`e2e_<时间戳>` + 邮箱别名 + ≥12 位强密码（走密码策略）。
3. 走流程：登录（验证码）→ 改密 → 后台 13 模块 → 前台行为 → 会话/踢下线。
4. 收尾删除：后台「彻底删除」→ 断言该用户 401/不存在、会话级联清掉。

### 6.3 邮件真实收件

- 163 测试邮箱凭据从**本机非仓库文件**读取（`F:\dsh\e2e-secrets\mail.env`，**严禁入库**）；
- 优先 IMAP 拉邮件断言主题/HTML/链接；网页邮箱登录只作兜底（可能触发风控）。
- 报告中不得出现邮箱密码；只记"收件人/主题/结论"。

### 6.4 报告（PDF，不入库）

- 运行结束生成 HTML 报告 → Edge `--print-to-pdf` → 输出 **`F:\dsh\e2e-reports\<日期>-<提交短哈希>.pdf`**（仓库外，**不提交 GitHub**）。
- 内容：环境与版本、矩阵逐行结果、失败截图与 Console 错误、skip 及原因、耗时、真实测试清单状态。
- 失败时必须保留截图与日志；不允许只留一句"失败"。

## 7. 运行与判读

> 验证命令以 `steamdeals-dev` §7 为**唯一版本**（本技能不重复贴命令，避免两处漂移）。
> 测试侧要点：主链已分段 `test:1~test:4` 串行（DI 批），中断从失败段续跑（`npm run test:N`）；
> `npm run e2e:smoke` 日常核心链路；`npm run e2e` 全量 + PDF 报告由**发版后独立报告会话**执行（见 §2.3）。

- **相关优先（2026-11-18 所有者调整）**：优先保证「改动的功能正常」，跑与改动直接相关的测试文件即可；
  主链全量不是每次门槛——它由 CI 在每次推送时自动跑，本机只在改动面广/触及共享底层/发版前兜底时全量。
- 主链首个失败即中断：按报错文件单独跑定位。
- 新增测试**必须加进 `package.json` 的 test 链**（主链）或 e2e 矩阵（全量），否则等于没写。
- 本地无 Docker、无 Steam 出口：采集类网络失败属预期，报告里注明"未做真实抓取"。

## 8. 测试数据与凭据安全

- 数据库一律 pglite 临时库；**不连生产库**、不执行 `docker exec`。
- 测试邮箱密码、令牌只从本机 env/非仓库文件读取；`npm run scan` 必须干净。
- 夹具从真实响应脱敏复制，不含个人信息/密钥。
- e2e 报告目录在仓库外，禁止 `git add`；`test/e2e/` 只放脚本与矩阵，不放报告与截图。

## 9. 时长与性能

- 单文件秒级；主链总时长作为基线记录（变慢要说明原因）。
- 禁止无意义 `sleep`：用可注入时钟/轮询等待条件（如等接口返回、等 DOM 出现）。
- e2e 全量目标 ≤ 15 分钟；超时必须拆批或降频并说明。
- 性能只做**阈值断言**（如列表 P95 < 150ms、count < 30ms、for-you < 300ms），不做压测。

## 10. 反模式清单（出现即打回）

1. 静态字符串断言当行为断言（只看"源码里有这行"）。
2. 断言只判"没抛错/请求 200"，不判内容与状态。
3. 假 HTML/假 JSON 夹具。
4. 无反向自检（改坏实现测试仍绿）。
5. 用 `skip` 静默跳过失败项且报告不列原因。
6. 测试里改生产数据、连生产库。
7. 依赖测试执行顺序/共享可变状态。
8. 用超长 `sleep` 掩盖竞态。
9. 新测试没加进主链/矩阵。
10. 报告里"通过"，但真实测试清单未回填。

## 11. 模板附录

### 11.1 纯函数（L1）

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPriceReport } from '../src/price-report-html.js';

test('价格报表 HTML：动态字段必须转义、无外部资源', () => {
  const { html } = renderPriceReport({ rows: [{ name: '<script>x</script>' }] /* … */ });
  assert.ok(!html.includes('<script>x</script>'));          // 守：注入
  assert.ok(/^[^]*?(?<!http:\/\/)(?<!https:\/\/)/.test(html)); // 守：无外链（按实际断言细化）
});
```

### 11.2 数据层（L2）

```js
test('迁移幂等：连跑两次不报错、不重复建对象', async () => {
  const s = await openPgliteStore();
  await s.migrate();
  await s.migrate(); // 第二次必须静默成功
  const r = await s.query(`select count(*)::int n from information_schema.tables where table_name='appeals'`);
  assert.equal(r.rows[0].n, 1);
});
```

### 11.3 HTTP（L3）

```js
test('非管理员访问后台接口 → 403；未登录 → 401', async () => {
  const { base } = await startTestServer(); // 随机端口 + pglite
  assert.equal((await fetch(`${base}/api/admin/appeals`)).status, 401);
  assert.equal((await fetch(`${base}/api/admin/appeals`, { headers: userCookie() })).status, 403);
});
```

### 11.4 前端编译级（L4）

```js
import { compile } from '@vue/compiler-dom';
import { readFileSync } from 'node:fs';

test('组件不允许同元素 v-for + v-if（BN 批回归）', () => {
  const src = readFileSync('frontend/src/components/PriceHistoryReport.vue', 'utf8');
  assert.ok(!/<[^>]+v-for[^>]*v-if/.test(src), '同元素 v-for+v-if 会让 v-if 提到循环外');
  // 再用 compile 断言产物不引用循环变量（见 BN 批测试）
});
```

### 11.5 headless Edge 渲染断言（L5）

```js
// 起本地服务后：
// & "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --disable-gpu `
//   --dump-dom "http://127.0.0.1:8090/" > dom.html
// 断言 dom.html 含关键区块文本；再 --screenshot 出图存档
```

### 11.6 e2e 报告（PDF）

```
HTML 报告 → msedge --headless=new --disable-gpu --print-to-pdf="F:\dsh\e2e-reports\<日期>-<hash>.pdf" report.html
```

## 12. 与其它技能的衔接

- `steamdeals-dev`：交付时按 §2 加测试、按 §5.2 写「真实测试」段、贴命令与输出。
- `steamdeals-qa`：按 §3/§10 判"是否真锁住"、按 §5.2 核对真实测试清单完整性、报告里复现矩阵覆盖情况。
- `steamdeals-build`：发版前确认 `npm run e2e` 全量通过 + 真实测试清单已回填，否则拒绝构建。

