# QA：CJ 现场回归修复（/api/app/latest apkPath 回落 + /app/dl/ 302 兜底）（复检轮）

> 基线 v2.22.0 tag（53dad6c）→ HEAD b726af4（fix 仅 src/server.js + test/serve.test.js）；判据 = TODO CJ 条目
> 「现场回归（2026-11-17 线上 v2.22.0，待修）」的修复 3 处 + 规格 [APP-AUTO-UPDATE-PAGE.md](APP-AUTO-UPDATE-PAGE.md) §9 验收③。
> 结论：✅ 放行 —— 通过 4 / 缺失 0 / 偏差 0 / 需人工确认 1

## 功能清单（本轮交付的全部功能，一条一行）

| # | 编号 | 功能（用户视角） | 入口 | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | CJ-回归 | data/app 为空（首轮同步未跑/失败）时，/app 页「下载 APK」仍可下载（apkPath 回落镜像 `/app/<ver>.apk`） | `GET /api/app/latest` | ✅ | src/server.js:appApkPathFor()（data/app → 镜像 → null 三级）；serve.test.js:276 CJ-回归用例断言 |
| 2 | CJ-回归 | `/app/dl/<file>` 文件不存在时 302 到 `/app/<file>`（旧下载链接不死链） | `GET /app/dl/<file>` | ✅ | src/server.js:996-1000（302 + no-store）；serve.test.js 302/location 断言 |
| 3 | CJ-回归 | data/app 有文件时照旧走站点自托管 `/app/dl/`（200 + APK Content-Type） | `GET /app/dl/<file>` | ✅ | src/server.js:1002-1012；serve.test.js「data/app 有文件 → /app/dl/ 200」断言 |
| 4 | CJ-回归 | 两边都没有该版本 APK → apkPath null（BY 契约：缺失不报错，前端隐藏下载按钮） | `GET /api/app/latest` | ✅ | src/server.js:appApkPathFor 返回 null；serve.test.js「镜像与 data/app 都没有 → null」断言 |

## 逐条核对（TODO CJ 修复 3 处 → 证据）

| # | 条目 | 检查手段 | 证据（文件:行） | 判定 |
|---|---|---|---|---|
| ① | apkPath 仅在 data/app 文件存在时用 `/app/dl/…`，否则镜像存在回落 `/app/<ver>.apk`，都没有 null | 读代码 + 真跑 | src/server.js:95-108（`appApkPathFor`：`resolve(cwd, APP_DATA_DIR ?? 'data/app', name)` → `/app/dl/`；镜像 `resolve(frontendDir, 'app', name)` → `/app/<ver>.apk`；否则 null）；handler 调用 src/server.js:1869；serve.test.js 4 分支断言 | ✅ |
| ② | `/app/dl/<file>` 不存在 → 302 到 `/app/<file>` | 读代码 + 真跑 | src/server.js:996-1000（302 location `/app/${file}` + no-store）；serve.test.js 302 + location + no-store 断言 | ✅ |
| ③ | 回归测试锁「data/app 为空时 apkPath 回落」+ 断网/同步失败场景 | 读测试 + 真跑 | serve.test.js:276「CJ-回归」用例（APP_DATA_DIR 隔离：空目录 → 回落镜像 → /app/dl 302 → 有文件 → /app/dl 200 → 两边无 → null）；BS-1/BY-1 断言同步更新 | ✅ |
| ④（发现） | CJ 原 `/app/dl/` 路由位于静态分支之后是死代码（线上 404 的直接原因之一） | 读代码 | src/server.js:985 注释 + 路由已移到 serveFrontendStatic（:1005）之前 | ✅ |

## 四方一致检查

- **后端**：`appApkPathFor` 与 `/app/dl/` 路由共用 `APP_DATA_DIR ?? 'data/app'` 口径；`readLatestMeta` 调用同步传目录（src/server.js:1861）✅
- **测试**：serve.test.js 11/11（CJ-回归 4 分支 + BS-1/BY-1 语义更新）真跑锁行为；npm test 主链 exit 0 ✅
- **文档**：TODO CJ 现场回归段落状态待回写（本报告产出后）；APP-AUTO-UPDATE-PAGE.md 无需改（行为与 §9③ 一致）✅

## 纪律项

- 无新增 tag ✅；diff 仅 2 文件（代码 + 测试）✅；构建产物未入库 ✅；已推 main（b726af4）✅

## 需人工确认

- **线上复测**：部署 v2.22.1 后按原现场回归路径复核——`/api/app/latest` 的 apkPath 在 data/app 为空时指向 `/app/<ver>.apk` 且浏览器下载成功；`app-sync` 首轮成功后 apkPath 切换为 `/app/dl/<ver>.apk` 且 200；旧 `/app/dl/` 链接 302 兜底。

## 复检记录

- 第 1 轮（2026-11-17）：CJ 主体 ✅（docs/QA-CJ.md，517ffb6）。
- 现场回归（2026-11-17 线上 v2.22.0）：/app 页下载 404 —— apkPath 无条件 `/app/dl/` + dl 路由为静态分支后死代码。
- 复检轮（2026-11-17）：b726af4 三处修复 + 死代码位移，QA 重跑 serve.test.js 11/11、npm test 全链 exit 0、frontend:build ✓、scan ✅ → 放行，随 v2.22.1 发布。
