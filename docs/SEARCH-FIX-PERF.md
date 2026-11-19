# 搜索参数错位修复 + 列表/接口性能优化（DW / DX，待开发）

> 状态：**已确认待开发（2026-11-19 线上实测定位）**。
> 实测基线（v2.27.0，串行 3–4 次）：列表平均 582ms（345–749）、搜索 389–478ms、详情 46ms、公告 37ms、
> `/api/site` 257ms、首页 32ms。
> 关联：`src/store/pg.js` `gameSearch` / `gameKeywordSql`、`src/search-derive.js`、`src/server.js` `/api/site`。

## DW. 🐞 缺陷：搜索关键词参数错位（精确名匹配实际在匹配 region）

- **根因**：`src/store/pg.js:1763` `kwNorm = replace(replace(lower($1),' ',''),'　','')`，
  而 `filterParams = [region, kw]`（`pg.js:1743`）——`$1` 是 **region（'cn'）**、`$2` 才是关键词。
  实测绑定确认：`$1='cn'`、`$2='侠盗猎车手'`；候选查询/计数/排序里的「精确名 LIKE」实际在匹配 `'cn'`。
- **线上表现（2026-11-19）**：
  - 搜「侠盗猎车手」「侠盗猎车手 V」→ **0 条**（GTA V 的 name=侠盗猎车手 V 明明存在）；
  - 搜「侠盗」98 条、「Grand Theft Auto」142 条、「GTA」75 条——全部靠派生 token / trgm 模糊兜底命中，
    精确名匹配从失效开始就没人发现；
  - 本地 DS 测试 9/9 全绿：用例全走 token/拼音/fuzzy 路径，**没有「仅靠 name 精确匹配」的用例**，掩盖了 bug。
- **修复**：`kwNorm` 改用 `${kw 的占位}`（即 `$2`）；同步检查所有引用点：
  `gameKeywordSql` 的 tokenCond 分支、候选查询（`pg.js:1786-1790`）、
  `fuzzyCandidateIds(q, kw, kwNorm, …)` 传入的表达式、排序分级用的 `kwNorm2`（已是 `$2`，保持）。
  若改 `filterParams` 顺序为 `[kw, region]` 则需同步所有 `$1/$2` 引用——**不采用，避免波及 region 条件**。
- **补测试（反向自检，必须）**：
  1. 新用例：**无 `search_tokens` 的游戏**（seed 后清空 tokens）搜中文名「侠盗猎车手」/英文名「Grand Theft Auto V」**必须命中**；
     用修复前的 `kwNorm($1)` 跑该用例 → 0 条 → 红（证明测试真锁住）；
  2. 回归用例：`gta5`/`gta6`/`xdlc6`/`grand theft auto` 仍命中；`zzz不存在词` → 0；`cn` → 0；
  3. 搜索不相关词不得因 region 值命中（防再次把参数写错）。
- **验收**：本地 pglite 上述用例全绿；线上部署后「侠盗猎车手」返回 GTA 系列（首个应为 GTA V/IV 等）；
  `npm test`（分段）+ `frontend:build` + `scan` 全绿。

## DX. 🧹 技术债：列表/站点接口性能优化

- **目标**（v2.27.0 基线 → 目标）：
  - 列表/搜索 P95：**≤150ms**（基线 340–580ms）；
  - `/api/site`：**≤50ms**（基线 257ms）；
  - total 正确性不变（与 `count(*)` 一致）。
- **方案（按收益）**：
  1. **count 合并**：`gameSearch` 当前先 `select count(*)` 再查 rows（两次 round-trip + 两次 join）；
     改为一次查询（`count(*) over()` 或 rows+count 合并），或 count 走「rs.game_id is not null」的 index-only scan；
  2. **短 TTL 内存缓存**（30–60s）：key = 归一化筛选参数 + region + userId 摘要；
     同步任务完成 / 后台操作（删除/屏蔽/改名）后**主动失效**；命中率观测（日志 `search.cache_hit`）；
  3. `/api/site` 60s 缓存（版本/开关/SMTP 状态在配置变更或重启时失效）；
  4. 基准测试：新增 `test/search-perf.test.js`（本地 198k 行 seed 或压测脚本）断言 P95；
     线上只读压测（`scripts/bench` 或手工 curl）记录结果到 DELIVERY；
  5. 不做：换搜索引擎、前端改动（另条）。
- **验收**：同条件压测列表/搜索 P95 ≤150ms、`/api/site` ≤50ms；total 与 `count(*)` 一致（对比测试）；
  缓存失效正确（sync 后搜索结果更新）；`npm test`（分段）+ `scan` 全绿；压测结果贴进交付说明。

## 依赖与并行

| 条目 | 依赖 | 说明 |
|---|---|---|
| DW | 无 | 修复小、优先做（搜索功能正确性） |
| DX | DW（同文件 pg.js 的 gameSearch 区域，避免冲突） | 串行在同一会话或先后 |

## 备注

- 线上「GTA 结果不相关」属排序口径（默认按折扣排序），不在 DW 范围；如需「搜索时相关度优先」另立条目。
- 本地 pglite 有 similarity 能力时 fuzzy 兜底生效，因此 DW 的测试必须显式覆盖「无 tokens 的精确名匹配」。
