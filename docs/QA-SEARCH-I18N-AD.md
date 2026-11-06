# QA：AD——搜索支持中英文（含平台中文别名）（第 1 轮）

> 基线 `08a110c` → 交付 `8037187`；判据 [docs/SEARCH-I18N.md](SEARCH-I18N.md) §4 影响面 + §5 验收六条 + §6 四项决策；TODO 条目 AD。
> 结论：**✅ 放行 —— 通过 10 / 缺失 0 / 偏差 0 / 需人工确认 1**

| # | 条目 | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| 1 | A：搜索命中 `game_aliases.platform_title`（exists 防重复行） | grep `game_aliases a` | pg.js `gameKeywordSql`：`exists (select 1 from game_aliases a …)` | ✅ |
| 2 | B：空格/全角空格归一化（关键词与字段两侧） | grep `replace(replace(lower(` | pg.js `gameKeywordSql`：`kw` 与 `f(col)` 两侧都归一化 | ✅ |
| 3 | 前台搜索（GET /api/games 与 POST search 同走 gameSearch） | grep `gameKeywordSql\('\$2'` | pg.js gameSearch 两个分支（数字走 AppID 索引、非数字三源模糊） | ✅ |
| 4 | 后台「游戏管理」搜索同口径 | grep `gameKeywordSql\('\$1'` | server.js `baseWhere` 收敛到同一 helper（`appidAsText` 安全比较） | ✅ |
| 5 | 决策 1：rename 放开为「name 不含中文即补」 | grep `name !~` | cli.js 候选条件 `(name is null or name = '' or name !~ '[一-龥]')`；写入仍走 `upsertGameMeta`（覆盖保护不被绕过） | ✅ |
| 6 | 决策 2/4：不做人工别名、不做拼音 | grep `name_zh_alias\|pinyin` | 无相关代码 | ✅ |
| 7 | 前端输入 trim | grep `query.value.trim()` | Home.vue `loadGames`/`searchNow` 已 trim（本批无需改动） | ✅ |
| 8 | 测试真锁住：中文命中 name/别名、英文回归、空格/全角一致、AppID、后台 HTTP | 单跑 + 主链 | `test/store-browse.test.js` 15 项（新增 3 项：三源命中、归一化一致、后台 HTTP 同口径） | ✅ |
| 9 | §5.6 验证重跑 | 命令输出 | `npm test` EXIT=0（51 文件全绿）；`frontend:build` EXIT=0（1.34s）；`scan` EXIT=0 | ✅ |
| 10 | 纪律：无 tag、未碰部署配置、已推 main | git 取证 | 无新增 tag；diff 仅 9 个源码/测试/文档文件；8037187 在 main | ✅ |

## 需人工确认（部署后验证）

1. §5.1/5.5：生产实测搜「英雄连」命中 CoH3、搜索耗时不超过现状 2 倍（198k 行基线约 114ms；归一化 replace 后 like 仍不走索引，与现状同量级，但需线上实测确认）。

## 查多

- 无需求外改动；README 未动（本批无环境变量/功能表变化）。

## 复检记录

第 1 轮（2026-11-06）：无打回项，✅ 放行（1 项转线上验收）。
