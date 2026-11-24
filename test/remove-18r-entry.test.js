// FG/FH 批（docs/REMOVE-18R-ENTRY.md + docs/ADULT-STATS.md）：移除 18R 查询入口 + 成人内容统计。
// 锁住的行为：
//   1) 三端入口移除：Home.vue 无 18R 按钮/移动端抽屉项/adultFilter 状态；后台游戏管理无
//      「内容分级」筛选（下拉与成人/成熟点击 chip）；App 侧由 steamdeals-app 仓库
//      HomeFilterParamsTest 锁（adult 固定 hide）。
//   2) 能力保留：Home.vue 的 18+ 角标仍跟随站点策略 siteAdultDisplay==='badge'（国外部署）；
//      /api/games 的 adult/rating 参数与 /api/admin/games 的 rating 参数保留（契约断言在
//      api.test.js / steam-status.test.js / game-search-filter.test.js，本文件不重复）。
//   3) FH 统计：/api/admin/games/stats 新增 ratingBackfilled/ratingPending（required_age 口径，
//      与 rating-backfill 候选谓词一致），后台「同步与回填」页有「内容分级统计」只读卡片。
// 反向自检：把 Home.vue 的 18R 按钮放回 → 用例 1/3 红；把 stats 的 rating_backfilled 口径
// 改成 required_age is null → 用例 5 红；把卡片 ratingBackfilled 显示换成 adult → 用例 6 红。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const HOME = '../frontend/src/pages/Home.vue';
const ADMIN = '../frontend/src/pages/AdminModules.vue';

test('FG：Home.vue 无 18R 查询入口（按钮/移动端 chip/抽屉项/开关状态/切换函数全部移除）', () => {
  const home = read(HOME);
  // 这条断言守的是：前台（PC + 移动端）不再有任何 18R 筛选入口——
  // 旧实现是 PC 按钮「18R」、移动端 chips「18R ✕」、筛选抽屉「只看 18R」、
  // adultFilter ref 与 toggleAdult 函数；任一放回都应红。
  assert.doesNotMatch(home, /18R/, '无任何 18R 文案（按钮/chip/抽屉项）');
  assert.doesNotMatch(home, /只看 18R/, '移动端筛选抽屉无 18R 分组');
  assert.doesNotMatch(home, /adultFilter/, '18R 筛选开关状态已移除');
  assert.doesNotMatch(home, /toggleAdult/, '18R 切换函数已移除');
  assert.doesNotMatch(home, /filterTemp\.adult/, '筛选抽屉临时状态无 adult 字段');
  // 查询参数不再带 adult/rating（前台默认 hide 由服务端处理）
  assert.doesNotMatch(home, /adult:\s*[^'"}]+\?'badge'/, 'loadGames 不再构造 adult=badge 参数');
  assert.doesNotMatch(home, /rating:\s*[^'"}]+\?'adult'/, 'loadGames 不再构造 rating=adult 参数');
});

test('FG：Home.vue 保留站点策略角标能力（18+ 角标只随 siteAdultDisplay==="badge" 出现）', () => {
  const home = read(HOME);
  // 这条断言守的是：数据与展示能力保留——国外部署（SITE_ADULT_DISPLAY=badge）时成人游戏
  // 仍带 18+ 角标；但筛选开关（adultFilter）不再参与角标条件。
  assert.match(home, /game\.adult_flag && siteAdultDisplay==='badge'/, '18+ 角标跟随站点策略 badge');
  assert.doesNotMatch(home, /siteAdultDisplay==='badge'\|\|adultFilter/, '角标条件不再依赖已移除的筛选开关');
  assert.match(home, /siteAdultDisplay/, '站点成人展示策略仍被读取（默认 hide）');
});

test('FG：Home.vue 模板可编译（移除入口后模板仍合法）', async () => {
  const { compile } = await import('@vue/compiler-dom');
  const src = read(HOME);
  const start = src.indexOf('<template>');
  const end = src.lastIndexOf('</template>');
  assert.ok(start >= 0 && end > start, '能取出 SFC 模板');
  const tpl = src.slice(start + '<template>'.length, end);
  const code = compile(tpl, { mode: 'module' }).code;
  assert.ok(code.length > 0, '模板编译成功');
});

test('FG：后台游戏管理无「内容分级」筛选入口（下拉/成人成熟点击 chip/状态全部移除）', () => {
  const admin = read(ADMIN);
  // 这条断言守的是：后台游戏目录不再提供按 adult/mature 筛选的查询入口
  // （FH 统计卡片替代数字展示）；/api/admin/games 的 rating 参数保留在后端。
  assert.doesNotMatch(admin, /全部内容分级/, '无内容分级筛选下拉');
  assert.doesNotMatch(admin, /gameRating/, '无内容分级筛选状态');
  assert.doesNotMatch(admin, /rating:\s*'adult'/, '指标卡无 adult 点击筛选目标');
  assert.doesNotMatch(admin, /rating:\s*'mature'/, '指标卡无 mature 点击筛选目标');
  assert.doesNotMatch(admin, /clickMetric\('adult'\)/, '无成人点击筛选 chip');
  assert.doesNotMatch(admin, /clickMetric\('mature'\)/, '无成熟点击筛选 chip');
});

test('FH：/api/admin/games/stats 返回回填覆盖（required_age 口径）与成人/成熟计数', async () => {
  const store = await openStore('pglite:', {});
  try {
    await db.migrate(store);
    const q = (sql, p) => store.query(sql, p);
    // required_age 已采到（含 0）= 已回填；null = 未回填（rating-backfill 候选谓词口径）
    await q("insert into games (steam_appid, name, required_age, adult_flag, mature_flag) values (9001, 'g9001', 18, true, false), (9002, 'g9002', 0, false, true), (9003, 'g9003', null, false, false)");
    const s = await db.adminGameStats(q);
    assert.equal(s.ratingBackfilled, 2, 'required_age 已采到（18/0）算已回填');
    assert.equal(s.ratingPending, 1, 'required_age 为 null 算未回填（回填候选）');
    assert.equal(s.adult, 1, '成人计数');
    assert.equal(s.mature, 1, '成熟计数');
  } finally {
    await store.close();
  }
});

test('FH：后台「同步与回填」页有「内容分级统计」只读卡片（数字 + 最近回填时间）', () => {
  const admin = read(ADMIN);
  // 这条断言守的是：统计区只展示数字（成人/成熟/已回填/未回填/最近回填时间），
  // 不提供成人内容列表或查询入口（配合 FG 用例 4）。
  assert.match(admin, /内容分级统计/, '统计卡片标题存在');
  assert.match(admin, /gameStats\.adult/, '显示成人总数');
  assert.match(admin, /gameStats\.mature/, '显示成熟总数');
  assert.match(admin, /gameStats\.ratingBackfilled/, '显示已回填数');
  assert.match(admin, /gameStats\.ratingPending/, '显示未回填数');
  assert.match(admin, /ratingBackfillLastRunAt/, '显示最近回填时间');
  assert.match(admin, /find\(\(x\)=>x\.name==='rating-backfill'\)/, '最近回填时间取自调度状态里的 rating-backfill 任务');
  assert.match(admin, /loadGamesStats/, '统计卡有独立加载函数');
});
