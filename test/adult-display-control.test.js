// FI 批（docs/ADMIN-RATING-FILTER.md）：内容分级——后台可筛 + 前台/App 按 site.adultDisplay 参数控制。
// 锁住的行为：
//   1) 前台三态（/api/site 的 adultDisplay）：
//      hide（默认）= 无 18R 入口（PC 按钮/移动 chip/抽屉组均 v-if 隐藏）、列表请求 adult=hide；
//      badge = 显示 18R 入口；选中 → adult=badge&rating=adult 只看 18R；卡片 18+ 红色角标；
//      show = 显示 18R 入口；选中 → adult=show&rating=adult；成人按普通展示、无 18+ 角标。
//   2) 后台游戏管理恢复「内容分级」筛选：全部/成人（18+）/成熟/未分级 → rating=adult|mature|none，
//      不受 site.adultDisplay 影响（管理端始终可查）；FH「内容分级统计」只读卡片保留。
//   3) 后端契约（/api/games 的 adult/rating、/api/admin/games 的 rating）由 game-search-filter.test.js /
//      admin-games.test.js 等已有测试锁，本文件不重复；FH 的 stats 回填口径用例自 remove-18r-entry.test.js
//      （FG/FH 批，已随本批淘汰）平移保留。
// 反向自检：把 Home.vue 18R 按钮的 v-if 去掉 → 用例 1 红；把 loadGames 的 adult 参数写死 'hide' → 用例 2 红；
// 把 18+ 角标条件改成 game.adult_flag 无条件 → 用例 3 红；把后台下拉的 none 选项删掉 → 用例 5 红。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const HOME = '../frontend/src/pages/Home.vue';
const ADMIN = '../frontend/src/pages/AdminModules.vue';

test('FI：Home.vue 18R 入口存在但按 siteAdultDisplay 显隐（hide 不显示，badge/show 显示）', () => {
  const home = read(HOME);
  // 这条断言守的是：前台有 18R 入口（FG 已由本批覆盖），但显示条件绑定站点策略——
  // PC 按钮 / 移动 chip / 筛选抽屉组三处都是 v-if siteAdultDisplay!=='hide'；
  // hide（默认，大陆合规）时任何入口都不渲染。把任一处 v-if 去掉都应红。
  assert.match(home, /aria-label="18R 筛选"/, 'PC 工具栏有 18R 按钮');
  assert.match(home, /siteAdultDisplay!=='hide'/, '入口显隐绑定站点策略');
  const pcBtn = home.match(/<el-button v-if="siteAdultDisplay!=='hide'"[^>]*aria-label="18R 筛选"/);
  assert.ok(pcBtn, 'PC 18R 按钮 v-if siteAdultDisplay!==\'hide\'');
  assert.match(home, /v-if="adultFilter && siteAdultDisplay!=='hide'"[^>]*>18R ✕/, '移动 chip 18R ✕ 同样按策略显隐');
  assert.match(home, /v-if="siteAdultDisplay!=='hide'" class="m-filter-group"><label>18R<\/label>/, '移动筛选抽屉 18R 组按策略显隐');
});

test('FI：Home.vue loadGames 恒传 adult=站点策略；rating=adult 仅在非 hide 且选中 18R 时', () => {
  const home = read(HOME);
  // 这条断言守的是参数口径：
  //   hide → adult=hide（服务端过滤成人）；badge/show → adult=badge/show（不过滤、展示方式由前端角标决定）；
  //   rating=adult 只在站点策略非 hide 且用户选中 18R（adultFilter）时带上——hide 时残留开关不生效。
  assert.match(home, /adult:siteAdultDisplay\.value,rating:adultOn\?'adult':undefined/, 'adult 恒传站点策略 + rating 由 adultOn 控制');
  assert.match(home, /const adultOn=siteAdultDisplay\.value!=='hide'&&adultFilter\.value/, 'adultOn = 非 hide 且开关选中');
});

test('FI：Home.vue 18+ 角标仅 siteAdultDisplay==="badge"（show 无角标、hide 不可见）', () => {
  const home = read(HOME);
  // 这条断言守的是角标口径：badge=成人带红色 18+ 角标（type=danger，与成熟内容 warning 区分）；
  // show=成人按普通展示无角标；hide=成人根本不返回。条件必须是 adult_flag && siteAdultDisplay==='badge'。
  assert.match(home, /game\.adult_flag && siteAdultDisplay==='badge'/, '角标条件 = adult_flag 且站点策略 badge');
  assert.match(home, /type="danger" effect="plain">18\+<\/el-tag>/, '18+ 角标红色 danger（与成熟内容 warning 区分）');
  assert.doesNotMatch(home, /siteAdultDisplay==='badge'\|\|adultFilter/, '角标不依赖筛选开关（show 态选中 18R 也不出角标）');
});

test('FI：Home.vue 模板可编译（恢复入口后模板仍合法）', async () => {
  const { compile } = await import('@vue/compiler-dom');
  const src = read(HOME);
  const start = src.indexOf('<template>');
  const end = src.lastIndexOf('</template>');
  assert.ok(start >= 0 && end > start, '能取出 SFC 模板');
  const tpl = src.slice(start + '<template>'.length, end);
  const code = compile(tpl, { mode: 'module' }).code;
  assert.ok(code.length > 0, '模板编译成功');
});

test('FI：后台游戏管理恢复「内容分级」筛选（全部/成人 18+/成熟/未分级 → adult|mature|none）', () => {
  const admin = read(ADMIN);
  // 这条断言守的是：管理端筛选入口恢复且不受 site.adultDisplay 影响——
  // 下拉四选项映射 rating=adult|mature|none（空=全部）；loadGames 请求带上 rating 参数。
  assert.match(admin, /v-model="gameRating"/, '内容分级下拉绑定 gameRating 状态');
  assert.match(admin, /label="全部内容分级" value=""/, '「全部内容分级」空值选项');
  assert.match(admin, /label="成人（18\+）" value="adult"/, '「成人（18+）」→ rating=adult');
  assert.match(admin, /label="成熟" value="mature"/, '「成熟」→ rating=mature');
  assert.match(admin, /label="未分级" value="none"/, '「未分级」→ rating=none');
  assert.match(admin, /rating:gameRating\.value/, 'loadGames 请求带 rating 参数');
  assert.doesNotMatch(admin, /siteAdultDisplay/, '后台筛选不读 site.adultDisplay（管理端始终可查）');
});

test('FH（保留）：后台「同步与回填」页仍有「内容分级统计」只读卡片（数字 + 最近回填时间）', () => {
  const admin = read(ADMIN);
  // 这条断言守的是 FH 承诺：统计区只展示数字（成人/成熟/已回填/未回填/最近回填时间），
  // 不提供成人内容列表；FI 恢复的是「游戏目录」筛选入口，统计卡片不被取代。
  assert.match(admin, /内容分级统计/, '统计卡片标题存在');
  assert.match(admin, /gameStats\.adult/, '显示成人总数');
  assert.match(admin, /gameStats\.mature/, '显示成熟总数');
  assert.match(admin, /gameStats\.ratingBackfilled/, '显示已回填数');
  assert.match(admin, /gameStats\.ratingPending/, '显示未回填数');
  assert.match(admin, /ratingBackfillLastRunAt/, '显示最近回填时间');
  assert.match(admin, /find\(\(x\)=>x\.name==='rating-backfill'\)/, '最近回填时间取自调度状态里的 rating-backfill 任务');
});

test('FH（保留）：/api/admin/games/stats 返回回填覆盖（required_age 口径）与成人/成熟计数', async () => {
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

test('FI：前台 compact 列表响应带 adult_flag/mature_flag/steam_status（角标渲染前提，读模型与 legacy 双口径）', async () => {
  const store = await openStore('pglite:', {});
  try {
    await db.migrate(store);
    const q = (sql, p) => store.query(sql, p);
    await q("insert into games (steam_appid, name, adult_flag, mature_flag, steam_status) values (9201, 'adult-x', true, false, 'ok')");
    await q("insert into game_region_snapshot (game_id, region, price_cents, currency, hist_low_cents) select id, 'cn', 1000, 'CNY', 1000 from games where steam_appid = 9201");
    // legacy compact 路径前置：exists(daily_prices)（读模型路径不需要，但双口径用例要同种子跑两遍）
    await q("insert into platforms (code, name, kind) values ('steam', 'Steam', 'official') on conflict (code) do nothing");
    await q("insert into daily_prices (game_id, platform_code, region, day, min_price_cents, currency) select id, 'steam', 'cn', current_date, 1000, 'CNY' from games where steam_appid = 9201");
    // 读模型（默认）与 legacy 两种路径的 compact 行都要带分级/状态字段——
    // 这是 18+/成熟内容/锁国区/未发售角标的渲染前提（POST /api/games/search 强制 compact）。
    for (const legacy of [false, true]) {
      const prev = process.env.READ_MODEL;
      if (legacy) process.env.READ_MODEL = 'legacy'; else delete process.env.READ_MODEL;
      try {
        const r = await db.gameSearch(q, { region: 'cn', compact: true, adult: 'badge' });
        assert.equal(r.rows.length, 1, `${legacy ? 'legacy' : '读模型'} compact 命中种子行`);
        const row = r.rows[0];
        assert.equal(row.adult_flag, true, `${legacy ? 'legacy' : '读模型'}：adult_flag 返回（18+ 角标）`);
        assert.equal(row.mature_flag, false, `${legacy ? 'legacy' : '读模型'}：mature_flag 返回（成熟内容角标）`);
        assert.equal(row.steam_status, 'ok', `${legacy ? 'legacy' : '读模型'}：steam_status 返回（锁国区/未发售角标）`);
      } finally {
        if (prev === undefined) delete process.env.READ_MODEL; else process.env.READ_MODEL = prev;
      }
    }
  } finally {
    await store.close();
  }
});
