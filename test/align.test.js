// CD 批（docs/SONKWO-STEAM-MATCH.md §4/§5/§8）：跨平台对齐——去重分组/决定继承/
// 英文名匹配/ITAD 跳转反解/审核接口接线。守的约束：同归一化名多 SKU 只出一行、
// 确认/忽略一次处理整组、决定对新 SKU 自动继承、ITAD 反解不出错挂。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bestMatchMulti, alignGroupKey } from '../src/match.js';
import * as align from '../src/align.js';
import { resolveDealSteamAppid, normalizeDeals } from '../src/adapters/itad.js';

const STEAM = [
  { id: 1, steam_appid: 111, name: '塔拉萨号', name_en: 'The Thalassa' },
  { id: 2, steam_appid: 222, name: '消逝的光芒：困兽', name_en: 'Dying Light: The Beast' },
];

test('CD 英文名匹配：中英无交集的 SKU 经杉果英文名命中 name_en 并自动', () => {
  // 候选只有英文名（Steam 侧无中文名）——塔拉萨号这类必须靠英文名
  const fields = (c) => [c.name, c.name_en];
  const best = bestMatchMulti(['塔拉萨号', 'The Thalassa'], [{ id: 1, steam_appid: 111, name: null, name_en: 'The Thalassa' }], { getFields: fields });
  assert.equal(best.candidate.steam_appid, 111, '经英文名匹配到塔拉萨号');
  assert.equal(best.method, 'name_en');
  assert.equal(best.auto, true);
  // 中英文都有的候选同样能自动（method 记实际命中的字段）
  const zh = bestMatchMulti(['塔拉萨号'], [{ id: 1, steam_appid: 111, name: '塔拉萨号', name_en: 'The Thalassa' }], { getFields: fields });
  assert.equal(zh.auto, true);
});

test('CD 去重组：同归一化名的多 SKU 只出一行（组），队列按组计数', () => {
  const items = [
    { skuId: 1, name: '愚者不灭', appid: null, titles: ['愚者不灭'] },
    { skuId: 2, name: '愚者不灭：荣光痴人版', appid: null, titles: ['愚者不灭：荣光痴人版'] },
  ];
  assert.notEqual(alignGroupKey('sonkwo', '愚者不灭'), alignGroupKey('sonkwo', '愚者不灭：荣光痴人版'), '版次不同归一化名不同 → 不同组（按规格：组键=归一化名）');
  const groups = align.proposeAlignGroups(items, [{ id: 9, steam_appid: 999, name: '愚者不灭', name_en: null }]);
  assert.equal(groups.length, 2);
  const same = align.proposeAlignGroups(
    [
      { skuId: 1, name: '内核之心', appid: null, titles: ['内核之心'] },
      { skuId: 2, name: '内核之心', appid: null, titles: ['内核之心'] },
    ],
    [{ id: 9, steam_appid: 999, name: '内核之心', name_en: 'Kernel Core' }],
  );
  assert.equal(same.length, 1, '同名多 SKU 归一组');
  assert.equal(same[0].skuIds.length, 2, '组内一次处理全部 SKU');
  assert.equal(same[0].auto, true, '完整名相等自动');
});

test('CD 决定继承：confirmed 回填 appid；ignored 自动跳过不再排队', () => {
  const items = [
    { skuId: 1, name: '忙作一团', appid: null, titles: ['忙作一团'] },
    { skuId: 2, name: '血色序曲', appid: null, titles: ['血色序曲'] },
  ];
  const maps = new Map([
    ['1', { decision: 'confirmed', game_id: 111 }],
    ['2', { decision: 'ignored', game_id: null }],
  ]);
  const { items: rest, inheritApplied } = align.applyMapInheritance(items, maps);
  assert.equal(inheritApplied, 1);
  assert.equal(rest.length, 0, 'ignored 不排队');
  assert.equal(items[0].appid, 111, 'confirmed 继承 appid');
});

test('CD ITAD 跳转反解：跟随重定向取最终 URL 反解 appid；非 Steam 返回 null', async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes('itad.link/good')) return { url: 'https://store.steampowered.com/app/1091500/Cyberpunk/?cc=cn' };
    if (String(url).includes('itad.link/gog')) return { url: 'https://www.gog.com/en/game/cyberpunk_2077' };
    throw new Error('network down');
  };
  assert.equal(await resolveDealSteamAppid('https://itad.link/good', { fetchImpl }), 1091500);
  assert.equal(await resolveDealSteamAppid('https://itad.link/gog', { fetchImpl }), null);
  assert.equal(await resolveDealSteamAppid('https://itad.link/dead', { fetchImpl }), null, '失败返回 null 回退名称匹配');
});

test('CD ITAD 同游戏多商店 deal 挂同一 appid', () => {
  const games = [
    {
      id: 'g1',
      title: 'Cyberpunk 2077',
      deals: [
        { shop: { id: 1, name: 'Steam' }, price: { amount: 99, currency: 'CNY' }, url: 'https://itad.link/x' },
        { shop: { id: 2, name: 'GOG' }, price: { amount: 88, currency: 'CNY' }, url: 'https://itad.link/y' },
      ],
    },
  ];
  const { offers } = normalizeDeals(games, { gameAppids: new Map([['g1', 1091500]]) });
  assert.equal(offers.length, 2);
  assert.ok(offers.every((o) => o.steamAppid === 1091500), '同一 ITAD game 的所有商店 deal 挂同一 Steam 游戏');
});

test('CD 接线：审核 API / 对齐页 / 调度收尾 / 映射表 静态契约', () => {
  const server = readFileSync(join(process.cwd(), 'src', 'server.js'), 'utf8');
  const cli = readFileSync(join(process.cwd(), 'src', 'cli.js'), 'utf8');
  const pg = readFileSync(join(process.cwd(), 'src', 'store', 'pg.js'), 'utf8');
  const admin = readFileSync(join(process.cwd(), 'frontend', 'src', 'pages', 'AdminModules.vue'), 'utf8');
  const alignAdmin = readFileSync(join(process.cwd(), 'frontend', 'src', 'components', 'AlignAdmin.vue'), 'utf8');

  assert.match(pg, /create table if not exists game_source_map/, '映射表');
  assert.match(pg, /primary key \(platform_code, product_id\)/, 'platform+product 唯一');
  assert.match(server, /\/api\/admin\/align' && req\.method === 'GET'/, '队列接口');
  assert.match(server, /\/api\/admin\/align\/confirm' && req\.method === 'POST'/, '确认接口');
  assert.match(server, /\/api\/admin\/align\/ignore' && req\.method === 'POST'/, '忽略接口');
  assert.match(server, /match\.confirmed/, '确认审计');
  assert.match(server, /match\.ignored/, '忽略审计');
  assert.ok(/align\\\/preview/.test(server), '合并预览接口');
  assert.match(cli, /runSonkwoMatchStep/, 'sonkwo 收尾匹配（不新增 cron）');
  assert.match(cli, /match\.summary/, 'match.summary 日志');
  assert.match(cli, /MATCH_ON_SONKWO/, '收尾开关');
  assert.match(cli, /resolveDealSteamAppid/, 'ITAD 跳转反解接入');
  assert.match(admin, /对齐审核/, '游戏管理新 tab');
  assert.match(alignAdmin, /不可自动撤销/, '确认不可撤销提示');
  assert.match(alignAdmin, /api\/admin\/align\/ignore/, '忽略接线');

  // ── DE 批（docs/ALIGN-REVIEW-UI.md §3/§4）：接口契约与页面结构 ──
  // 接口：202 带 stale 旧结果分页；200 带 counts 5 项；批量确认/忽略；预览 keys
  assert.match(server, /cachedRows/, '202 返回上一轮缓存分页（stale 旧结果）');
  assert.match(server, /body\.stale = true/, '202 stale 标记');
  assert.match(server, /alignGroupCounts\(groups, inherit\)/, '完成响应带 counts 5 项统计');
  assert.match(server, /match\.batch_confirmed/, '批量确认审计');
  assert.match(server, /match\.batch_ignored/, '批量忽略审计');
  assert.match(server, /align\/preview\?keys=|keysParam/, '批量合并预览（批量确认弹窗用）');
  assert.match(server, /onGrouped/, '分组完成立即上报总数（进度不出现 0/0）');
  assert.match(server, /store\.steampowered\.com\/app/, 'Steam 链接字段');
  assert.match(server, /sonkwo\.hk\/sku/, '杉果链接字段');
  // 页面：状态徽标 / 5 统计卡 / 进度条 / 筛选 chip / 批量按钮 / 明细 / 空态互斥
  assert.match(alignAdmin, /生成中/, '头部状态徽标（生成中）');
  assert.match(alignAdmin, /生成失败/, '头部状态徽标（生成失败）');
  assert.match(alignAdmin, /已生成/, '头部状态徽标（已生成）');
  assert.match(alignAdmin, /自动匹配（≥0\.94）/, '统计卡：自动匹配');
  assert.match(alignAdmin, /需人工（0\.86–0\.94）/, '统计卡：需人工');
  assert.match(alignAdmin, /本次自动继承/, '统计卡：本次自动继承');
  assert.match(alignAdmin, /高置信/, '筛选 chip：高置信');
  assert.match(alignAdmin, /无候选/, '筛选 chip：无候选');
  assert.match(alignAdmin, /已忽略/, '筛选 chip：已忽略');
  assert.match(alignAdmin, /批量确认/, '批量确认按钮');
  assert.match(alignAdmin, /批量忽略/, '批量忽略按钮');
  assert.match(alignAdmin, /明细/, '明细面板入口');
  assert.match(alignAdmin, /没有待对齐的组（新 SKU 会在杉果同步后进入队列）/, '空态文案');
  assert.match(alignAdmin, /生成中不显示|!generating\.active && !loading && displayedRows/, '空态互斥（生成中不显示空态）');
  assert.match(alignAdmin, /疑似本体/, '候选疑似本体提示');
  assert.match(alignAdmin, /api\/admin\/align\/confirm/, '确认接线');
  assert.match(alignAdmin, /api\/admin\/align\/preview/, '单组合并预览接线');
});
