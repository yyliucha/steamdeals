# QA：CM 批 App 功能补齐（第 1 轮）

> 基线 App 仓库 `6745e99` → HEAD `e183584`（steamdeals-app，branch main）；站点仓库 HEAD `5f42776`（docs 回写，当前站点 main 已推进到 `51d1cb5` v2.23.0，`5f42776` 为其祖先）。
> 判据：docs/APP-PARITY.md §4 验收 1–7（唯一判据）；参考 docs/APP-NATIVE.md §4.4、docs/APP-API.md §4.3/4.4、docs/GAME-DLC.md §3.4、docs/PRICE-HISTORY-REPORT.md §11。
> 结论：**✅ 放行 —— 通过 7 / 缺失 0 / 偏差 0 / 需人工确认 3**

## 功能清单（本批交付的全部功能，一条一行，不许合并/抽样）

| # | 编号 | 功能（用户视角） | 入口（页面/按钮） | 状态 | 证据（文件:行 / 命令） |
|---|---|---|---|---|---|
| 1 | CM-1 | 详情开发商/发行商显示**名称**（纪元1800：Ubisoft Mainz / Ubisoft），不再显示原始 JSON；泰拉瑞亚 Re-Logic 不回归 | App 详情页 → 元信息区（开发商/发行商行） | ✅ | Dtos.kt:28-69（NameListSerializer）；NameListSerializerTest 5 项（生产报文夹具）；模拟器 ui-09-detail.xml（Ubisoft Mainz/Ubisoft、无 `{"name"`）；ui-29（Re-Logic）；QA 独立生产只读复核（916440=JSON 文本串 / 105600="Re-Logic"） |
| 2 | CM-2 | 详情底部 **DLC（共 N 个）** 区块：10 条/页翻页、价格/折扣/缺货、点行跳 Steam 商店（Chrome Custom Tab）、标注「Steam 不提供 DLC 拥有数据」；无 DLC/非 Steam 不显示区块 | App 详情页 → 底部 DLC 区块 | ✅ | DetailScreen.kt:581-639、936-978；SteamDealsApi.kt:131-137（pageSize 固定 10、整页替换非追加）；mock e2e ui-38（24 个/页1/价格折扣缺货）、ui-39/40（第 1/3、2/3 页、Pack 1-10/11-20）、ui-41（package=com.android.chrome Custom Tab）；生产 916440 `dlc.total=0` → 区块不显示（API 复核 + ui-09 无区块） |
| 3 | CM-3 | 价格历史**区间切换**（近 30 天/近 90 天/全部，默认 90）+ **指标条**（区间最低/区间最高/当前较史低/记录天数）+ 史低虚线参考线与全部史低日绿点；无历史空态 | App 详情页 → 「价格历史」区块 | ✅ | PriceHistoryModel.kt:40-66（口径逐行对齐 Web）；PriceHistoryChart.kt:106-115/143-153；DetailScreen.kt:690-837；PriceHistoryModelTest 7 项；生产 ui-14/ui-29（泰拉瑞亚：区间最低/最高 ¥36.00、已是史低、记录天数 20、区间 2026-10-28 → 2026-11-16、¥36.00 · 史低线）；mock ui-32/33/35/36/37（记录天数 90/30/90/30/120） |
| 4 | CM-4 | 标题旁**复制游戏名**按钮：中英文两行（缺一回退单行），Toast「已复制」 | App 详情页 → 标题旁复制图标 | ✅ | GameNameText.kt:8-14（与 Web gameNames.js 同口径）；DetailScreen.kt:444-458、673-682（系统 ClipboardManager）；GameNameTextTest 6 项；模拟器 ui-09（content-desc=复制游戏名）、ui-18-toast、shot-10/11（剪贴板面板，所有者目视） |

## 逐条核对（规格 §4 验收 → 证据）

| # | 条目（规格验收） | 检查手段 | 证据（文件:行 / dump） | 判定 |
|---|---|---|---|---|
| 1 | CM-1：纪元1800 开发商「Ubisoft Mainz」、发行商「Ubisoft」；泰拉瑞亚不变；无 JSON 字样 | 读代码 + 单测 + 模拟器 dump + 生产 API 只读复核 | Dtos.kt:44-68（数组/JSON 对象文本/对象/单串四种形态取 name）；NameListSerializerTest:21-28（生产夹具）；ui-09-detail.xml：开发商=Ubisoft Mainz、发行商=Ubisoft、全文无 `{"name"`；ui-29：Re-Logic×2；QA 只读 GET `/api/app/games/916440`：`developers="{\"name\":\"Ubisoft Mainz\"}"`（裸 JSON 文本串，serializer 同分支覆盖）、105600=`"Re-Logic"` | ✅ |
| 2 | CM-2：有 DLC 的游戏详情底部出现 DLC 区块、共 N 个、分页 10、价格/折扣/缺货正确、点击跳 Steam；无 DLC 游戏不显示；区块有「Steam 不提供 DLC 拥有数据」说明 | 读代码 + mock e2e dump + 生产 API 复核 | DetailScreen.kt:582（`if (detail.dlc.total > 0)` 才显示）、584-590（标题+说明）、608（totalPages=ceil(total/10)）、616-633（上一页/下一页，整页替换）；DlcRow:936-978（价格/折扣/缺货/Steam ↗/名称回退）；SteamDealsApi.kt:131-137（pageSize=10）；mock：ui-38「DLC（共 24 个）」+ Pack 1-7 + ¥49/¥50/-51%/缺货；ui-39「第 1 / 3 页」Pack 1-10；ui-40「第 2 / 3 页」Pack 11-20；ui-41 package=com.android.chrome（Custom Tab）；生产 916440 `{"total":0,"synced":false,"filled":0}` + ui-09 无 DLC 区块 | ✅（生产区块出现需 game_dlc 同步后复验，见 🔎） |
| 3 | CM-3：区间切换生效（30/90/全部），指标条数值与 Web 同游戏一致；史低线/低点保留；无历史空态 | 读纯函数 + 单测 + 生产/mock dump + 与 Web 源码逐行对照 | PriceHistoryModel.kt:40-46（`epochDay>end-N`，与 Web `> end-days*86400000` 同语义）、49-55（史低=全期 min；低点=全期=史低日）、61-66（cur<=histLow→已是史低，否则 +X.X% Locale.US，与 Web curVsHist 同）；ui-29 生产泰拉瑞亚（区间 ¥36/¥36、已是史低、记录天数 20）；mock ui-32/33/35/36/37（30 天=30 条、90 天=90 条、全部=120 条，与 mock 数据构造一致）；空态 DetailScreen.kt:756-764「暂无历史记录」 | ✅ |
| 4 | CM-4：复制成功（中英文两行），提示可见；分享到其他 App 内容正确 | 读代码 + 单测 + 模拟器 dump | GameNameText.kt:8-14 与 Web `gameNames.js` 逐分支一致（缺英/相同→单行；缺中→英文；全缺→空；trim）；GameNameTextTest:16-46 六态锁定（含 `纪元1800\nAnno 1800`）；DetailScreen.kt:673-682（ClipboardManager.setPrimaryClip + toast）；ui-09 content-desc=复制游戏名；shot-10/11 剪贴板面板存档（所有者目视，🔎） | ✅ |
| 5 | 既有功能不回归：多平台报价、搜索、愿望单、登录、主题、内置更新 | 模拟器 dump + 代码审读 | ui-29 泰拉瑞亚多平台并列：GOG ¥36.00 / Steam 国区 ¥42.00 / Humble ¥66.63（与开发声称逐字一致）；ui-13 搜索（共 80 个结果）；ui-42 首页筛选 chips；ui-43/44/45 登录门槛/登录页/愿望单；ui-09 底部操作条（感兴趣/不感兴趣/愿望单/去 Steam 购买）；主题/内置更新代码路径本批未触碰（diff 无相关文件） | ✅ |
| 6 | 验证方式：模拟器安装新包 → 截图逐项核对；关键项补 e2e 矩阵行 | 证据文件复核 | F:\dsh\cm-e2e：ui-01~45 dump 文本（已逐项复核关键 dump）+ shot-01~24 PNG 存档 + cm-matrix-rows.jsonc（4 行 e2e 矩阵草案，CK 落地后并入）；截图 PNG 本 QA 模型不支持图像输入，已存档供所有者目视 | ✅（PNG 目视转 🔎） |
| 7 | 站点仓库 npm test / frontend:build / scan（若动服务端）；App 侧 gradlew assembleRelease 成功、同签名可覆盖 | 亲自重跑 | **App 重跑（QA 独立复核）**：`gradlew.bat testDebugUnitTest --rerun-tasks` → BUILD SUCCESSFUL，XML 报告 3 类 18 项（NameListSerializerTest 5 / PriceHistoryModelTest 7 / GameNameTextTest 6）0 失败；`gradlew.bat assembleRelease` → BUILD SUCCESSFUL，产物 `app-release.apk`（1.93 MB）；`apksigner verify --print-certs` → cert SHA-256 `48a30df9...7a05` 与 App README 指纹 `48:A3:0D:F9:…:7A:05` 一致；versionCode 22000 > 21900 单调递增 → 同签名覆盖安装成立。**站点仓库**：5f42776 仅改 3 个 docs 文件（TODO/INDEX/APP-NATIVE），无业务代码 → npm test/frontend:build/scan 按技能 §3 降级为文档抽查（已逐段核对 diff），不跑全量测试；另工作树含 CL/CK 会话未提交业务代码（M docs/DELIVERY.md、docs/E2E-SUITE.md、package.json 等），不属于本批范围 | ✅（降级说明如上） |

## 打回清单（按严重度排序）

**无必修项。**

## 风险提醒 / 备注（记录即可，不打回）

1. **InfoLine 空值隐藏整行 vs 规格 §3 文案「空值显示 —」**：DetailScreen.kt:840-841 `if (value.isBlank()) return`——开发商/发行商为空时**整行隐藏**而非显示「—」。规格 §4 验收未要求空值展示、纪元1800/泰拉瑞亚实测均通过，判 ✅；如严格按 §3 文案，可把开发商/发行商两行改为空值显示「—」（一行改动，可选）。
2. **`.gitignore` 未覆盖 `build-release.log`**：当前忽略模式是 `build-log-*.txt`，与文件名 `build-release.log` 不匹配——本批该文件未入库（✅ 纪律达成），但后续会话有误 `git add .` 风险，建议补 `build-*.log`。
3. **APK SHA-256 非可复现构建**：开发产物（17:37）SHA-256 `A9621E02...B468` 与声称一致；QA 重跑产物 `564533D9...E0B`（同源码、同证书、不同字节——AGP 默认非可复现构建，zip 时间戳差异所致）。证书指纹一致 → 覆盖安装语义不受影响；发版以站点/App 侧实际发布包为准。
4. **测试反向自检**：三个测试文件均含反向自检注释（NameListSerializerTest:12-13、PriceHistoryModelTest:13-15、GameNameTextTest:10-11）；开发声称「改坏实现 → 4 项变红后恢复」为会话内记录，QA 按「只判不改」未独立重演变异，逐条阅读确认断言确实锁住对应行为（删除对象文本分支 → 用例 1 红；`>` 改 `>=` → 边界用例红；`<=` 改 `<` → 已是史低用例红；删 trim → 空白用例红）。

## 需人工确认（🔎）

1. **CM-2 生产 DLC 区块**：生产 `game_dlc` 尚未同步（QA 只读复核 916440 `dlc.total=0, synced=false`，开发声称所有抽查游戏均如此）→ 生产 App 目前不显示 DLC 区块属预期。等 steam-status/backfill 同步后，在真机打开纪元1800 详情复核「DLC（共 24 个）」区块出现、翻页与跳转。
2. **CM-4 剪贴板两行内容**：两行文本（`纪元1800\nAnno 1800`）由 JVM 单测 + 代码路径锁定；系统剪贴板面板目视截图（shot-10/11）已存档 F:\dsh\cm-e2e，供所有者目视复核。
3. **截图 PNG 目视**：shot-01~24 PNG 存档完整，本 QA 会话模型不支持图像输入，已用同时间点 uiautomator dump 文本逐项替代核验；所有者可抽查截图。

## 纪律项核对

1. **无擅自 tag**：App 仓库 `git tag --points-at HEAD` 为空（仅历史 app-v2.19.0）；站点 `5f42776` 无 tag（当前 HEAD v2.23.0 属 CL 会话发版，与 CM 无关）。✅
2. **无部署/服务器配置改动**：两仓库 diff 无 compose/DEPLOY/凭据。✅
3. **构建产物未入库**：App 提交 12 文件无 apk/log；`build-release.log` 未跟踪。✅（gitignore 提醒见上）
4. **已推 main**：App `main` = `origin/main` = e183584。✅
5. **文档收尾**：App README 已同步（版本 2.20.0/22000、CM 功能段、已知限制 6/7 条、测试行）；站点 TODO/INDEX/APP-NATIVE §4.4 已回写（5f42776）。**PROJECT-OVERVIEW 本批未同步**：该文件被 CL/CK 会话占用，按 HANDOVER §10 跳过——**待收尾复盘补**（如实记录；另注：PROJECT-OVERVIEW 行均为站点侧代码，App 侧文档落在 App README 已同步）。

## 复检记录

- 第 1 轮（2026-11-17）：一次通过，无打回项。✅ 放行。
