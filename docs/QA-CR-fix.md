# QA：CR 批迁移 22P02 线上事故回归修复（第 1 轮）

> 基线 `v2.24.1` → HEAD `9dd508e`；判据 docs/APP-DEV-PUBLISHER-NAMES.md §3 CR-2 + §5 验收 + 修复核心约束
> （任何生产脏元素不能让 migrate 抛错 / 清洗幂等稳定 / 不误删合法数据）；证据范围 `git diff v2.24.1..9dd508e`
> （修复提交 9dd508e 本身只改 `src/store/pg.js` +7/-2、`test/dev-publisher-names.test.js` +37）。
> 结论：✅ 放行 —— 通过 8 / 缺失 0 / 偏差 0 / 需人工确认 1（部署后 bootstrap 正常，本地无法代验生产）

## 功能清单（本次修复交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮/接口） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | CR-fix | 升级启动（bootstrap）不再因任何脏开发商/发行商元素崩溃重启循环 | 容器启动 `node src/cli.js bootstrap` | ✅ | src/store/pg.js:579（无任何 cast）+ 测试 6 元素夹具 + 反向自检（换回 ::jsonb → 22P02 必红） |
| 2 | CR-fix | 生产残留占位符元素（{CRYTIME} 等）原样保留、不被当 JSON 二次解析 | 同上（migrate 清洗） | ✅ | src/store/pg.js:583（WHERE 收紧 `"name":` 特征）+ pglite 事故形态验证脚本输出 |
| 3 | CR-fix | 清洗幂等稳定：二次 migrate 结果不变 | 同上 | ✅ | test/dev-publisher-names.test.js:90-92 + 事故形态脚本两轮一致 |
| 4 | CR-fix | 合法 `"name":` 脏元素仍被清洗为纯名称（原有 CR-2 能力不回退） | 同上 | ✅ | test/dev-publisher-names.test.js:37-57（CR-2 原用例仍绿） |
| 5 | CR-fix | 回归用例进主链，锁住事故形态（非法 JSON/占位符/花括号名/转义引号/二次幂等） | `npm test` | ✅ | package.json test 链含 dev-publisher-names.test.js；反向自检换回 ::jsonb 该用例必红 |

## 逐条核对（修复约束 + 规格验收 → 证据）

| # | 条目 | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | 任何生产脏元素都不能让 migrate 抛错（bootstrap 不崩） | 读 SQL + 亲自跑 | src/store/pg.js:579 提取与 WHERE 全部为纯文本正则（`~`/`substring`/`btrim`/`left`），无 `::jsonb`/任何 cast；pglite 事故形态脚本（占位符×4 + 截断 JSON）两轮零异常 | ✅ |
| 2 | WHERE 收紧为 `"name":` 特征，占位符元素不再命中 | 读 SQL + 亲自跑 | src/store/pg.js:583 `where … e ~ '"name"\s*:'`；脚本场景 A：`{CRYTIME}`×2/`{COMPANY_NAME_GOES_HERE}`/`{uni}` → UPDATE no-op、元素原样 | ✅ |
| 3 | 幂等稳定：清洗产物不被二次误解析 | 亲自跑 | test/dev-publisher-names.test.js:84-92（`{ 花括号名 }` 第二轮不再命中）；脚本两轮 `developers`/`publishers` 完全一致（PASS） | ✅ |
| 4 | 不误删合法数据：纯文本/无特征元素保留 | 亲自跑 | test:86（`{name: "无引号键"}`/`{}`/`纯文本 Studio` 原样保留）；脚本 `{CRYTIME}` 保留 | ✅ |
| 5 | 规格 §5.3：造脏行 `{"name":"Y"}` → `['Y']`，二次无变化 | 主链测试 | test/dev-publisher-names.test.js:37-57（CR-2 原用例）——本次修复下仍绿 | ✅ |
| 6 | 规格 §5.5：migrate 连跑两次不报错、测试全绿 | 亲自重跑 | `node test/dev-publisher-names.test.js`（6/6 绿）、`node test/pg.test.js`（18/18 绿）、`npm test`（主链全绿，输出见下）、`npm run scan` 干净 | ✅ |
| 7 | 反向自检声明属实（换回 ::jsonb 用例必红） | 亲自反向自检 | 临时把迁移换回 v2.24.1 的 `::jsonb ->> 'name'` → 新回归用例 `not ok`，`error: 'invalid input syntax for type json'`，`code: '22P02'`（与事故错误码一致）；恢复后 `git diff` 为空、重跑 6/6 绿 | ✅（注：注释「与 CR-2 用例必红」后半句不成立，见风险 5） |
| 8 | 修复只碰 pg.js 迁移 SQL + 测试，无需求外改动 | git 取证 | `git show --stat 9dd508e`：仅 2 文件 +44/-2；无部署/凭据/构建产物 | ✅ |

## 打回清单（按严重度排序）

- 无必修项。以下为风险提示（不判错，供 v2.24.2 发版文档同步）：
  1. **规格文档实现描述未同步**：docs/APP-DEV-PUBLISHER-NAMES.md §3 CR-2 行仍写「元素以 `{` 开头的用 `::jsonb ->> 'name'` 解析」，
     与修复后实现不一致（修复说明已写在 pg.js:569-573 注释）。§3 属「建议」非验收，故不判错；建议构建会话发版时把该行更新为「按 `"name":` 特征正则提取」。
  2. **规格 §6 统计口径与新设计不一致**：§6 用 `e like '{%'` 期望「脏行归零」；修复后占位符类 `{` 元素**按设计保留**（App 端兜底丢弃），
     该统计不会归 0。建议发版说明把统计口径改为按 `"name":` 特征计数（生产已为 0）。
  3. **边界（低风险）**：元素值内部若含字面量 `"name":`（如 `{"desc":"x \"name\": y"}`）会被特征命中并可能提取错误值；
     生产脏元素均为 GetItems 对象形态（name 键在前），无此形态；旧实现对此类元素也会先 22P02 崩溃，新实现为「永不抛错、尽力提取」的设计取舍。
  4. **边界（低风险）**：某行全部 `"name":` 元素均提取失败时，该列被置 NULL（沿用旧「去空」口径；旧代码在此场景是先崩溃）。
     生产 `"name":` 元素已 0，无实际影响。
  5. **测试注释措辞**：test/dev-publisher-names.test.js:62 写「本用例与 CR-2 用例必红」——反向自检实测只有本用例（新回归用例）红，
     CR-2 原用例在旧实现下仍绿（其夹具全部为合法 JSON/纯文本）。断言有效性不受影响（事故形态已锁死），建议顺手把注释改为「本用例必红」。

## 需人工确认

- 部署后：升级到 v2.24.2 时 bootstrap 正常完成、容器不再重启循环（本地 pglite 已验证零异常；
  pglite 与生产 PostgreSQL 正则/文本语义一致，理论零风险，但生产现场效果需部署后目视确认一次）。

## 纪律固定检查项

1. `git tag --list`：最新 tag 为 **v2.24.1**，无擅自新增 tag（硬规则 5）✅
2. diff 未碰部署/服务器配置（compose/DEPLOY/凭据）✅（9dd508e 仅 2 文件）
3. 构建产物未进提交（`git show --stat 9dd508e` 仅 pg.js + 测试）✅
4. 已推 main：`git rev-parse HEAD origin/main` 均为 `9dd508e479…` ✅
5. 文档收尾：PROJECT-OVERVIEW/CHANGELOG/DELIVERY 同步由**构建会话**负责（本会话任务书明示），修复说明已随代码注释落地；不判错 ✅

## 复检记录

- 第 1 轮（2026-11-18）：聚焦打回风险点（不崩溃/占位符/幂等/反向自检/主链全绿）——全部通过，无打回项 → ✅ 放行。

## 附：亲自重跑的关键输出

```
$ node test/dev-publisher-names.test.js
# tests 6 / # pass 6 / # fail 0

$ node test/pg.test.js
# tests 18 / # pass 18 / # fail 0

$ node .qa-cr-incident-check.mjs（临时脚本，已删）
第一轮 developers: ["{CRYTIME}","{CRYTIME}","{COMPANY_NAME_GOES_HERE}","{uni}"]
第一轮 publishers: ["Pub Co","{CRYTIME}"]
第二轮 developers/publishers 与第一轮完全一致 → 幂等: PASS

反向自检（临时换回 v2.24.1 ::jsonb 实现，已 git restore 复原）：
ok 3 - CR-2：migrate 清洗历史脏元素（幂等，二次运行无变化）
not ok 4 - CR-2 修复：生产非法 JSON 元素不抛 22P02…  error: 'invalid input syntax for type json'  code: '22P02'
# fail 1 → 事故形态用例必红，成立

$ npm run scan
✅ 未发现高置信度凭据 / ✅ 未发现可疑的密钥赋值

$ npm test
主链 98 个测试文件全部通过：total_tests=822 / total_pass=822 / fail=0，exit code 0（含
dev-publisher-names.test.js 新回归用例 ok 4、pg.test.js 18 项）；临时日志已删除
```
