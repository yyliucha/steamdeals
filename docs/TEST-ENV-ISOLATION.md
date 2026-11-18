# 测试环境隔离与主链分段（DI，待开发）

> 状态：**开发中（2026-11-18 认领）**。
> 关联：[TODO.md](TODO.md) DI 条目、[test/serve.test.js](../test/serve.test.js) CJ-回归用例、`package.json` test 主链。

## 1. 已确认的决策（2026-11-18 所有者拍板）

| # | 决策 |
|---|---|
| 1 | **A 测试隔离**：测试不再读工作区 `data/` 运行时产物；`serve.test.js` 的 CJ-回归用例改用临时目录注入 |
| 2 | **B 主链分段**：`package.json` 的 `test` 拆成 `test:1`~`test:4` 四段逐段串行，中断后从失败段续跑 |
| 3 | **C 环境复位脚本**：`npm run test:reset` 白名单精确移走运行时产物到仓库外备份目录（可恢复）；**绝不整删 `data/`** |

## 2. 现状（代码证据，2026-11-18）

- **干扰 1（CO-3 会话实测）**：本机跑过 `app-sync` 后 `data/app/latest.json` 存在，`test/serve.test.js:338-381`
  的 CJ-回归用例断言「`data/app` 为空 → apkPath 回落镜像路径」被破坏 → 整链红；CO-3 手工把 `data/app`
  移到仓库外 `F:\dsh\data-app-co3-bak` 才绿。**根因：测试读的是真实工作区 `data/`，不是临时目录**。
- **干扰 2（CO-3 会话实测）**：主链 `test` 是 100+ 文件一条 `&&` 链（单进程 8–15 分钟），中途被中断就要
  从头重跑；CO-3 手工改成 4 段串行后顺利完成。
- **有利事实**：`src/server.js:163/168/1255/2118` 已支持 **`APP_DATA_DIR` 环境变量**覆盖 data 目录
  （注释原文「APP_DATA_DIR 可覆盖 data 目录（测试隔离/运维）」）——A 无需改服务端，只需测试用起来。
- `data/` 目录三类内容，**不可混删**：
  - 入库源数据（绝不删）：`data/skus.json`（杉果源）、`data/games.json`、`data/secret.key`、`data/wishlist.example.txt`；
  - 本地调试库（.gitignore 已忽略）：`data/pgdata/`、`data/catalog-pgdata/`、`data/demo-pgdata/`、`data/images/`、`data/pages/`、`data/backup/`；
  - 运行时产物（干扰源、未跟踪）：`data/app/`、`data/scheduler-status.json`、`data/scheduler-retry.json`、
    `data/backfill-progress.json`、`data/steam-429.json`、`data/sonkwo-discovery.json`、`data/proxy-health.json`。

## 3. 改动落点

### A 测试隔离（治本）

- `test/serve.test.js`：CJ-回归用例（现 338–381 行）改为**每用例前设置**
  `process.env.APP_DATA_DIR = mkdtemp(join(tmpdir(), 'gp-data-'))`，用例内按需创建/清空 `app/` 子目录，
  覆盖「空 → 回落镜像」与「有文件 → `/app/dl/`」两种状态；用例结束清理临时目录。
- 反向自检（必须做）：临时去掉 `APP_DATA_DIR` 设置、并在工作区 `data/app` 放一个假 `latest.json` →
  用例必须红；放回设置 → 绿。
- 顺带审计（只读确认，不改）：`test/app-release.test.js` 已用 mkdtemp 临时目录（正确示范）；`test/deploy.test.js:64`
  读 `data/games.json`/`data/skus.json` 属部署清单检查（入库源数据），**保留**；`test/app-release-sync.test.js:81`
  是静态正则断言，不读文件。

### B 主链分段

- `package.json`：新增 `test:1` / `test:2` / `test:3` / `test:4` 四个脚本，按现有 `test` 链的**原顺序**
  切成四段（每段约 25–30 个文件，段界以「段内无共享状态」为准）；`"test": "npm run test:1 && npm run test:2 && npm run test:3 && npm run test:4"`。
- 段序沿用 CO-3 会话已验证可行的手工分段思路（其段 1/2 = 56 个文件全绿）。
- 要求：每段独立退出码；段间不依赖前段工作区状态（违者修到独立为止）。
- 同步文档：`steamdeals-dev` §7、`steamdeals-test` §7、`steamdeals-qa` §3.6、`steamdeals-build` §3.3 的
  验证命令补一句「主链分段，中断从失败段续跑（`npm run test:N`）」。

### C 环境复位脚本

- 新增 `scripts/test-env-reset.mjs` + `package.json` 的 `test:reset` 脚本。
- 白名单（脚本内**显式清单**，单一真相）：`data/app`、`data/scheduler-status.json`、`data/scheduler-retry.json`、
  `data/backfill-progress.json`、`data/steam-429.json`、`data/sonkwo-discovery.json`、`data/proxy-health.json`、
  `data/*.jsonl`、根目录 `npmtest-*.log`、`qa-*.log`、`qa-*.js` 探针、`pf*.log`。
- 行为：默认 **dry-run**（打印将移走的项与目标路径，不动作）；`--apply` 才执行——把命中项移到
  **仓库外** `F:\dsh\test-env-bak\<时间戳>\`（保留相对结构）；`--restore <时间戳>` 可移回。
- 幂等：重复执行不报错、备份按时间戳分目录；清单外文件（`skus.json` 等源数据、`*pgdata*`）**永不入选**。

## 4. 验收

1. **A**：工作区 `data/app` 有真实同步产物时，`node test/serve.test.js` 全绿（无需手工移走）；
   反向自检（去掉注入 + 放假产物）→ 用例红；测试结束后工作区 `data/app` 原样未动。
2. **B**：`npm test` 四段逐段运行且互不依赖；模拟第 3 段失败后 `npm run test:3` 可单独续跑；
   `test:1`/`test:2` 无需重跑。
3. **C**：`npm run test:reset` 默认 dry-run 只打印不动作；`--apply` 后命中项进 `F:\dsh\test-env-bak\<时间戳>\`、
   `data/skus.json`/`games.json`/`secret.key` 原位完好；重复执行不报错；`--restore` 可移回。
4. **通用**：`npm test` 全绿 + `npm run scan` 干净；改动只提交本条目相关文件。

## 5. 去重与幂等

- 复位白名单是脚本内显式清单，不允许运行时拼接路径；重复项去重后一次移走；
- 备份目录按时间戳唯一命名，同一次执行的目标目录只有一个；
- `--restore` 只作用于指定时间戳目录，恢复后该目录清空（不移走源数据）。

## 6. 实施顺序

A（根除干扰，先做）→ B（防长链白跑）→ C（兜底复位；A 完成后白名单可保持最小）。
