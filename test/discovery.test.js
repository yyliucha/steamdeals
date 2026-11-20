// CH 批（docs/DISCOVERY-FOR-YOU.md）：Deck/好评率采集与个性化推荐。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseQualityRow, runDiscoveryRound, computeForYou, behaviorActionWeight } from '../src/discovery.js';

const fakeQ = (rows) => {
  const calls = [];
  const q = async (sql, params) => {
    calls.push({ sql, params });
    for (const [re, result] of rows) if (re.test(sql)) return result(params, calls);
    return { rows: [], rowCount: 0 };
  };
  q.calls = calls;
  return q;
};

test('CH parseQualityRow：deck 0-3 白名单、review 1-9、缺字段 null', () => {
  const row = parseQualityRow({ appid: 730, deck_compat: 3, review_score: 9, review_desc: '好评如潮', review_total: 123 });
  assert.equal(row.deckCompat, 3);
  assert.equal(row.reviewScore, 9);
  assert.equal(row.reviewTotal, 123);
  assert.equal(parseQualityRow({ appid: 1, deck_compat: 9 }).deckCompat, null, '非法 deck 值按未采集');
  assert.equal(parseQualityRow({ appid: 1, review_score: 42 }).reviewScore, null);
});

test('CH runDiscoveryRound：翻页只写库内 appid，未覆盖走名称回退（≥0.86 采纳，否则 nomatch）', async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes('start=')) {
      return { json: { items: [{ appid: 730, deck_compat: 3, review_score: 9, review_desc: '好评如潮', review_total: 10 }] } };
    }
    const term = decodeURIComponent(String(url).split('term=')[1]?.split('&')[0] ?? '');    if (term === 'Dying Light: The Beast') return { json: { items: [{ appid: 222, name: 'Dying Light: The Beast', deck_compat: 2, review_score: 8 }] } };
    return { json: { items: [{ appid: 999, name: '无关游戏' }] } };
  };
  const q = fakeQ([
    [/select steam_appid from games where steam_appid = any/, () => ({ rows: [{ steam_appid: 730 }] })],
    [/select g\.id, g\.steam_appid, g\.name, g\.name_en, g\.heat, g\.is_free[\s\S]*game_source_sync/, () => ({ rows: [{ id: 2, steam_appid: 222, name: '消逝的光芒：困兽', name_en: 'Dying Light: The Beast', heat: 1 }] })],
  ]);
  const stats = await runDiscoveryRound({ q, pages: 1, fallbackLimit: 5, fetchImpl, rateMs: 0 });
  assert.equal(stats.matched >= 1, true, '翻页命中写库');
  assert.equal(stats.fallbackMatched >= 1, true, '名称回退采纳');
  const marks = q.calls.filter((c) => /game_source_sync/.test(c.sql));
  assert.ok(marks.some((c) => c.params.includes('matched')), '回退采纳落 matched 状态');
});

test('CH computeForYou：未绑定 profile=false；绑定后 20 条带 because；排除已拥有', async () => {
  const q0 = fakeQ([[/select 1 from steam_accounts where user_id = \$1 limit 1/, () => ({ rows: [] })]]);
  const noProfile = await computeForYou(q0, { userId: 7 });
  assert.equal(noProfile.profile, false);

  const q = fakeQ([
    [/select 1 from steam_accounts/, () => ({ rows: [{ '?column?': 1 }] })],
    [/steam_accounts a\s+join steam_games/, () => ({ rows: [{ id: 1, name: '赛博朋克 2077', tags: ['科幻', '开放世界'], playtime_minutes: 6000, last_played_at: new Date().toISOString() }] })],
    [/select f\.game_id, f\.interested/, () => ({ rows: [{ game_id: 1, interested: true, flag_owned: true, wishlisted: false }, { game_id: 2, interested: false, flag_owned: false, wishlisted: false }] })],
    [/select id, name, tags from games where id = any/, () => ({ rows: [{ id: 1, name: '赛博朋克 2077', tags: ['科幻'] }, { id: 2, name: '不感兴趣游戏', tags: ['恐怖'] }] })],
    [/from user_behaviors b/, () => ({ rows: [] })],
    [/g\.tags && \$1::text\[\]/, () => ({ rows: [{ id: 9, steam_appid: 999, name: '推荐候选', tags: ['科幻'], heat: 0.8, review_score: 8, is_free: false, min_price: 5000, hist_min: 10000 }] })],
  ]);
  const result = await computeForYou(q, { userId: 7, tasteWeight: 0 });
  assert.equal(result.profile, true);
  assert.equal(result.games.length, 1);
  assert.equal(result.games[0].because, '赛博朋克 2077', 'because=贡献最大的已拥有游戏名');
});

test('CH behaviorActionWeight：白名单 + 标记优先（uninterested 负权重不进推荐）', () => {
  assert.equal(behaviorActionWeight('detail'), 2);
  assert.equal(behaviorActionWeight('buy_click'), 4);
  assert.equal(behaviorActionWeight('hack'), null, '非白名单 null');
});

test('CH 接线：调度任务/STEAM_HEAVY/设置/接口/前端 静态契约', () => {
  const sched = readFileSync(join(process.cwd(), 'src', 'scheduler.js'), 'utf8');
  const settings = readFileSync(join(process.cwd(), 'src', 'settings.js'), 'utf8');
  const server = readFileSync(join(process.cwd(), 'src', 'server.js'), 'utf8');
  const gamesRoutes = readFileSync(join(process.cwd(), 'src', 'routes', 'games.js'), 'utf8');
  const home = readFileSync(join(process.cwd(), 'frontend', 'src', 'pages', 'Home.vue'), 'utf8');
  const pg = readFileSync(join(process.cwd(), 'src', 'store', 'pg.js'), 'utf8');

  assert.match(sched, /name: 'steam-discovery'/, '调度任务');
  assert.match(sched, /STEAM_DISCOVERY_PAGES, 100/, '默认 100 页');
  assert.match(sched, /STEAM_HEAVY = new Set\(\[[\s\S]*'steam-discovery'/, '归入 STEAM_HEAVY 互斥串行');
  for (const k of ['discovery.pages', 'discovery.fallbackLimit', 'discovery.intervalMin', 'personal.tasteWeight', 'personal.scoreDiscountWeight', 'personal.scoreReviewWeight', 'personal.scoreHeatWeight', 'personal.behaviorLogEnabled']) {
    assert.ok(settings.includes(`'${k}'`), `设置 ${k}`);
  }
  // CO-5/B4-2 第十五轮：/api/games/for-you 已随 games 域抽到 src/routes/games.js，断言指向新落点
  assert.match(gamesRoutes, /\/api\/games\/for-you' && req\.method === 'POST'/, '为你推荐接口在 games 域路由模块');
  assert.ok(!/\/api\/games\/for-you' && req\.method === 'POST'/.test(server), '为你推荐接口分支不得残留在 server.js（防双实现）');
  assert.match(server, /\/api\/behavior' && req\.method === 'POST'/, '行为上报接口留 server.js');
  assert.match(server, /PERSONAL_BEHAVIOR_LOG_ENABLED[\s\S]{0,120}202/, '开关关闭 202 不落库');
  assert.match(home, /综合评分/, '排序项');
  assert.match(home, /好评率不限/, '好评率筛选');
  assert.match(home, /为你推荐/, 'tab');
  assert.match(home, /免费领取/, '免费角标');
  assert.match(home, /deckLabel/, 'Deck 徽标');
  assert.match(pg, /user_behaviors/, '行为表');
  assert.match(pg, /user_search_logs/, '搜索词表');
  assert.match(pg, /games_tags_gin/, 'tags GIN 索引');
  assert.match(pg, /deck_compat smallint/, '5 列之一');
});
