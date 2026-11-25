# 成人内容分级细分：成人内容（宽）/ 色情游戏（严格）（FT，已实现待发版，2026-11-25）

> 所有者要求（2026-11-25）：现在的 `adult_flag`（descriptor 3/4/AO）把 **Cyberpunk 2077** 这类「含部分性内容的正常游戏」
> 也算成成人内容，但我们要的是**色情游戏（黄油）**。需要两级口径：
> - **成人内容（宽）** = Steam descriptor 3/4 或 ESRB AO（含 2077）——用于「含成人内容」提示；
> - **色情游戏（严格，要的）** = Steam descriptor **4**（Frequent Nudity or Sexual Content）**或 ESRB AO**——只出纯黄油。

## 1. 现状

- `src/adapters/steam-meta.js` 的 `classifyContentRating`：`adultFlag = ids.includes(3) || ids.includes(4) || esrb==='AO'`；
  `matureFlag = 2/5 或 PEGI18/required_age≥18`；
- 数据库：`games.adult_flag` / `games.mature_flag`（无 explicit 字段）；
- 前台「18R」筛选（FI）= `rating=adult` → `adult_flag`（把 2077 也算进去）；
- 后台统计「成人（18+）」= adult_flag。

## 2. 需求

### 2.1 数据层
- `classifyContentRating` 返回 `{ adultFlag, explicitFlag, matureFlag }`：
  - `adultFlag`（宽）= 3/4/AO（保持不变）；
  - `explicitFlag`（严格）= **ids 含 4** 或 **esrb === 'AO'**；
- 迁移：`alter table games add column if not exists explicit_flag boolean not null default false`；
- 采集/回填写入 explicit_flag（rating-backfill / steam-status 的元数据写入路径）。

### 2.2 存量回填（关键）
- 现有 adult_flag=**4759** 的游戏没有存 descriptor 原始 ids → 需**重采一遍**判定 explicit：
  新增命令 `node src/cli.js explicit-backfill --limit 5000 --rate 1500`（或复用 rating-backfill 加 `--explicit` 模式）：
  候选 = `adult_flag=true 且 explicit_flag=false`（最多 4759 个，约 2 小时跑完）；
- 后台「立即运行」可触发（复用任务卡片）。

### 2.3 前台
- 筛选入口从「18R」改为「**色情游戏**」（或「成人/色情」）→ `rating=explicit`（explicit_flag）；
- `rating=adult` 保留为「成人内容（宽）」筛选（可选，默认不展示入口）；
- 角标：badge 模式只对 explicit 游戏显示（18+ 角标）；
- show/hide 策略口径：hide 仍排除（宽口径）全部成人内容；show/badge 按站点策略展示。

### 2.4 后台
- 「内容分级统计」拆两行：**成人内容（宽）** = adult_flag；**色情游戏（严格）** = explicit_flag；
- 后台「内容分级」筛选加「色情游戏」选项（rating=explicit）。

## 3. 验收

1. 重新回填后：`explicit_flag=true` 的数量 **<** `adult_flag`（2077 应为 adult_flag=true、explicit_flag=false）；
2. 前台筛选「色情游戏」只出 explicit（抽查：2077 不出现；典型黄油出现）；
3. 后台统计两行数字正确；「内容分级」筛选可选色情游戏；
4. 存量回填命令可跑（4759 个，2 小时内）；`npm test`（分段）+ `frontend:build` + `scan` 全绿；截图。

## 4. 实现记录（2026-11-25）

- **数据层**：`games.explicit_flag`（默认 false）迁移；`classifyContentRating` 返回 `{ adultFlag, explicitFlag, matureFlag }`
  （explicit = descriptor 4 或 ESRB AO）；`setSteamStatus`/`applySteamDetails` 写入路径（null 不覆盖）。
- **存量回填**：`node src/cli.js explicit-backfill --limit 5000 --rate 1500`——候选 = `adult_flag=true 且 explicit_flag=false`
  （backfill_at 1 天冷却断点续跑；explicit=true 退出候选收敛）；429 收轮 exit 75；调度器并入 steam-meta 组
  （默认 7 天兜底，后台任务卡「色情游戏回填 → 立即运行」走 `POST /api/admin/explicit-backfill`）。
- **前台/App**：筛选入口文案「色情游戏」、请求 `rating=explicit`；18+ 角标只对 explicit；`rating=adult` 保留为
  宽口径筛选（契约兼容）；hide 仍排除全部成人内容（宽口径）；App 端 Dtos/GameCard/Home/Search/strings 同步。
- **后台**：「内容分级统计」拆「成人内容（宽）/色情游戏（严格）」两行；「内容分级」筛选加「色情游戏（严格）」。
- **验证**：`test/explicit-rating.test.js` 7 条（判定/迁移/候选/回填收敛/写回/筛选/统计）；主链 test:1~4 共 1263 项全绿；
  api 40/40；headless Chrome DOM 断言 11/11（后台两行 宽=2 严格=1、后台筛选只出黄油、前台按钮/角标/筛选）；
  frontend:build ✓、scan 干净；App testDebugUnitTest 全绿 + assembleDebug 成功。
- **部署后操作**：执行 `node src/cli.js explicit-backfill --limit 5000 --rate 1500`（约 2 小时）或在后台
  「游戏管理 → 同步与回填」任务卡点「色情游戏回填 → 立即运行」；回填完成后 `explicit_flag` 数量应 < `adult_flag`
  （2077 为宽成人、非色情游戏）。
