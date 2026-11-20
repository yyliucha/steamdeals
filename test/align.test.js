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

test('DH 继承参考 skus.json appid：库无映射时不入队并列入补写；pending（恢复）重新入队', () => {
  // A1：断箭类——skus.json 已带 appid、库无映射 → 视为已解决不入队，列入 backfill 由调用方补写
  // B1：恢复为 pending 的组 → 即使 skus.json 带 appid 也要重新入队等待人工处理
  const items = [
    { skuId: 10, name: '断箭', appid: 1604270, titles: ['断箭'] },
    { skuId: 11, name: '内核之心', appid: 1604270, titles: ['内核之心'] },
    { skuId: 12, name: '血色序曲', appid: null, titles: ['血色序曲'] },
  ];
  const maps = new Map([['11', { decision: 'pending', game_id: null }]]);
  const r = align.applyMapInheritance(items, maps);
  assert.equal(r.backfill.length, 1, '库无映射且带 appid → 一条补写');
  assert.equal(r.backfill[0].skuId, 10, '补写对象是 skuId 10');
  assert.equal(r.backfill[0].appid, 1604270, '补写内容来自 skus.json 的 appid');
  assert.equal(r.items.length, 2, '断箭不入队、血色序曲入队、pending 重新入队');
  assert.ok(!r.items.some((i) => i.skuId === 10), 'skus.json 已带 appid 的组不再入队（断箭场景）');
  assert.ok(r.items.some((i) => i.skuId === 11), 'pending（恢复为待处理）重新入队');
  // confirmed 映射优先于 skus.json 自带 appid（库是唯一真相）
  const conflict = align.applyMapInheritance(
    [{ skuId: 20, name: '愚者不灭', appid: 999, titles: ['愚者不灭'] }],
    new Map([['20', { decision: 'confirmed', game_id: 111 }]]),
  );
  assert.equal(conflict.items.length, 0);
  assert.equal(conflict.backfill.length, 0);
  assert.equal(conflict.inheritApplied, 1, '已有 confirmed 映射时不再补写');
});

test('DN 内容词归档：季票/服装/DLC 不进待对齐；本体同键保留；去掉判定必然红（反向自检）', async () => {
  // 口径（docs/TODO.md DN）：内容词类 SKU（含杉果自定义命名）视为无效数据默认归档；
  // 验收②：本体 SKU 不受影响——「龙之剑:觉醒 - 服装」与本体同归一化键，只归档服装 SKU、本体仍入队
  const items = [
    { skuId: 1, name: '巴士模拟器 27 - 第1年季票', appid: null, titles: ['巴士模拟器 27 - 第1年季票'] },
    { skuId: 2, name: '龙之剑:觉醒 - 服装', appid: null, titles: ['龙之剑:觉醒 - 服装'] },
    { skuId: 3, name: '龙之剑:觉醒', appid: null, titles: ['龙之剑:觉醒'] },
    { skuId: 4, name: '内核之心', appid: null, titles: ['内核之心'] },
    { skuId: 5, name: '塔拉萨号', appid: null, titles: ['塔拉萨号', 'The Thalassa: Season Pass'] },
  ];
  const cw = align.archiveContentWordItems(items, new Map());
  assert.deepEqual(cw.items.map((i) => i.skuId), [3, 4], '内容词 SKU 不进 items，本体/普通 SKU 保留');
  assert.deepEqual(cw.archived.map((i) => i.skuId), [1, 2, 5], '无映射的内容词 SKU 全部列入归档（中文/英文名都查）');
  assert.equal(cw.groups, 3, '归档按去重组计数（季票 / 服装 / 英文 Season Pass 各 1 组）');
  assert.equal(cw.skus, 3, '归档 SKU 计数');
  // 正向：过滤后提案里没有内容词组，本体组仍在且只剩本体 SKU
  const filtered = await align.proposeAlignGroupsBudgeted(cw.items, STEAM);
  assert.ok(!filtered.groups.some((g) => g.name === '巴士模拟器 27 - 第1年季票'), '季票组不进队列');
  const base = filtered.groups.find((g) => g.name === '龙之剑:觉醒');
  assert.ok(base, '本体组（与服装 SKU 同键）不受影响');
  assert.deepEqual(base.skuIds, [3], '本体组只剩本体 SKU');
  // 反向自检（验收④）：跳过内容词判定直接提案 → 内容词组重新出现——删掉判定这一步，本条必然红
  const unfiltered = await align.proposeAlignGroupsBudgeted(items, STEAM);
  assert.ok(unfiltered.groups.some((g) => g.name === '巴士模拟器 27 - 第1年季票'), '去掉内容词判定后季票组重新进队列（反向自检）');
  // 人工决定优先：pending（恢复为待处理）不再重复归档、confirmed 也不归档
  const overridden = align.archiveContentWordItems(items, new Map([
    ['1', { decision: 'pending', game_id: null }],
    ['2', { decision: 'confirmed', game_id: 111 }],
  ]));
  assert.ok(overridden.items.some((i) => i.skuId === 1), 'pending（已恢复）不重复归档，交给继承逻辑重新入队');
  assert.ok(!overridden.archived.some((i) => i.skuId === 2), 'confirmed 不归档');
  assert.deepEqual(overridden.archived.map((i) => i.skuId), [5], '恢复/确认后不计入归档，仅无映射内容词归档');
  assert.equal(overridden.groups, 1, '归档计数随人工决定减少（只算仍自动归档的）');
  // 既有内容词归档（ignored + method=content_word）只计数、不重复进待写列表
  const reRun = align.archiveContentWordItems(items, new Map([
    ['1', { decision: 'ignored', game_id: null, match_method: 'content_word' }],
  ]));
  assert.ok(reRun.archived.every((i) => i.skuId !== 1), '已归档的内容词 SKU 不重复写库');
  assert.equal(reRun.groups, 3, '内容词计数跨轮稳定（已归档仍计入）');
});

test('DN 归档落库：写 ignored + method=content_word + 无操作人；失败只告警不中断', async () => {
  const calls = [];
  const q = async (sql, params) => { calls.push({ sql, params }); return { rowCount: 1 }; };
  const written = await align.writeContentWordArchives({
    q,
    archived: [{ skuId: 11, name: '巴士模拟器 27 - 第1年季票' }, { skuId: 12, name: '龙之剑:觉醒 - 服装' }],
  });
  assert.equal(written, 2, '逐 SKU 写归档映射');
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /insert into game_source_map/, '走 game_source_map 统一落库（DH 已忽略视图可查）');
  assert.equal(calls[0].params[0], 'sonkwo');
  assert.equal(calls[0].params[1], '11');
  assert.equal(calls[0].params[3], 'content_word', 'method=content_word（已忽略视图据此标注）');
  assert.equal(calls[0].params[5], 'ignored', 'decision=ignored（与人工忽略同视图、可恢复）');
  assert.equal(calls[0].params[6], null, '自动归档无操作人');
  // 单条失败不影响其余（防一个坏 SKU 拖垮整轮归档）
  let n = 0;
  const flaky = async () => { n += 1; if (n === 1) throw new Error('db down'); return { rowCount: 1 }; };
  const warnings = [];
  const r = await align.writeContentWordArchives({ q: flaky, archived: [{ skuId: 21 }, { skuId: 22 }], logger: { warn: (ev, d) => warnings.push([ev, d]) } });
  assert.equal(r, 1, '失败一条仍写另一条');
  assert.equal(warnings[0][0], 'align.content_word_archive_failed', '失败路径记告警');
});

test('DN 已忽略视图标注：整组 content_word 标「内容词自动归档」，混合人工忽略不误标', async () => {
  const entries = [
    { skuId: 31, name: '巴士模拟器 27 - 第1年季票' },
    { skuId: 32, name: '愚者不灭' },
  ];
  const q = async () => ({
    rows: [
      { product_id: '31', reviewed_by: null, reviewed_at: '2026-11-19T10:00:00Z', username: null, match_method: 'content_word' },
      { product_id: '32', reviewed_by: 1, reviewed_at: '2026-11-19T09:00:00Z', username: 'admin', match_method: 'manual' },
    ],
  });
  const groups = await align.loadIgnoredGroups({ q, entries });
  const cw = groups.find((g) => g.name === '巴士模拟器 27 - 第1年季票');
  assert.equal(cw.method, 'content_word', '整组内容词归档 → 标注 content_word');
  assert.equal(cw.ignoredBy, null, '自动归档无操作人（页面显示「系统」）');
  const manual = groups.find((g) => g.name === '愚者不灭');
  assert.equal(manual.method, null, '人工忽略不标 content_word');
  assert.equal(manual.ignoredBy, 'admin');
});

test('A3 读路径解析：库映射优先、skus.json 只读回落、都无则 null', () => {
  // 库（game_source_map confirmed）为唯一真相；skus.json 自带 appid 只作旧数据回落
  const confirmed = new Map([['7001', 413150]]);
  assert.equal(align.resolveSkuAppid(confirmed, { skuId: 7001, appid: 999 }), 413150, '库映射优先于 skus.json appid');
  assert.equal(align.resolveSkuAppid(confirmed, { skuId: 7002, appid: 888 }), 888, '库无映射回落 skus.json appid（旧数据兼容）');
  assert.equal(align.resolveSkuAppid(confirmed, { skuId: 7002, appid: null }), null, '两边都没有 → null');
  assert.equal(align.resolveSkuAppid(new Map(), { skuId: 7003 }), null, '缺字段安全返回 null');
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
  // CO-5/B4-2 第十轮：runSonkwoMatchStep / cmdSyncSonkwo / cmdSyncItad 已随 cli 同步类域拆到 src/cli/sync.js，断言按新落点指向
  const cliSync = readFileSync(join(process.cwd(), 'src', 'cli', 'sync.js'), 'utf8');
  const pg = readFileSync(join(process.cwd(), 'src', 'store', 'pg.js'), 'utf8');
  const admin = readFileSync(join(process.cwd(), 'frontend', 'src', 'pages', 'AdminModules.vue'), 'utf8');
  const alignAdmin = readFileSync(join(process.cwd(), 'frontend', 'src', 'components', 'AlignAdmin.vue'), 'utf8');
  // DL 批：计算本体已抽到 align-compute.js（server 与 CLI 共用）
  const alignCompute = readFileSync(join(process.cwd(), 'src', 'align-compute.js'), 'utf8');
  const snapMod = readFileSync(join(process.cwd(), 'src', 'align-snapshot.js'), 'utf8');
  const sched = readFileSync(join(process.cwd(), 'src', 'scheduler.js'), 'utf8');
  // CO-5/B4-2 第十四轮：/api/admin/align* 路由已随 admin-align 域抽到 src/routes/admin-align.js，断言按新落点指向
  const alignRoutes = readFileSync(join(process.cwd(), 'src', 'routes', 'admin-align.js'), 'utf8');
  // CO-5/B4-2 第十四轮：align_snapshots 表 DDL 随域抽到 admin-align-repository.js（pg.js migrate 继续消费）
  const alignRepo = readFileSync(join(process.cwd(), 'src', 'store', 'admin-align-repository.js'), 'utf8');

  assert.match(pg, /create table if not exists game_source_map/, '映射表');
  assert.match(pg, /primary key \(platform_code, product_id\)/, 'platform+product 唯一');
  assert.match(alignRoutes, /\/api\/admin\/align' && req\.method === 'GET'/, '队列接口');
  assert.match(alignRoutes, /\/api\/admin\/align\/confirm' && req\.method === 'POST'/, '确认接口');
  assert.match(alignRoutes, /\/api\/admin\/align\/ignore' && req\.method === 'POST'/, '忽略接口');
  assert.match(alignRoutes, /match\.confirmed/, '确认审计');
  assert.match(alignRoutes, /match\.ignored/, '忽略审计');
  assert.ok(/align\\\/preview/.test(alignRoutes), '合并预览接口');
  assert.match(cliSync, /runSonkwoMatchStep/, 'sonkwo 收尾匹配（不新增 cron）');
  assert.match(cli, /match\.summary/, 'match.summary 日志');
  assert.match(cliSync, /MATCH_ON_SONKWO/, '收尾开关');
  assert.match(cliSync, /resolveDealSteamAppid/, 'ITAD 跳转反解接入');
  assert.match(admin, /对齐审核/, '游戏管理新 tab');
  assert.match(alignAdmin, /不可自动撤销/, '确认不可撤销提示');
  assert.match(alignAdmin, /api\/admin\/align\/ignore/, '忽略接线');

  // ── DE 批（docs/ALIGN-REVIEW-UI.md §3/§4）：接口契约与页面结构 ──
  // 接口：200 带 counts 统计；批量确认/忽略；预览 keys
  assert.match(snapMod, /alignGroupCounts/, 'counts 统计口径接入（DL 批移到 align-snapshot.js，含内容词计数透传）');
  assert.match(alignRoutes, /match\.batch_confirmed/, '批量确认审计');
  assert.match(alignRoutes, /match\.batch_ignored/, '批量忽略审计');
  assert.match(alignRoutes, /align\/preview\?keys=|keysParam/, '批量合并预览（批量确认弹窗用）');
  assert.match(alignRoutes, /store\.steampowered\.com\/app/, 'Steam 链接字段');
  assert.match(alignRoutes, /sonkwo\.hk\/sku/, '杉果链接字段');

  // ── DL 批（docs/ALIGN-SNAPSHOT.md §5/§8）：快照落库接线（静态契约）──
  assert.match(alignRepo, /create table if not exists align_snapshots/, 'align_snapshots 建表（migrate 幂等，DDL 随域抽到 repository）');
  assert.match(pg, /alter table game_source_map add column if not exists created_at/, 'gsm.created_at 补列（签名 §4 依赖）');
  assert.match(alignRoutes, /firstRun: true/, '无快照首次 202 firstRun（规格 §8.1）');
  assert.match(alignRoutes, /refresh\?|'refresh'\) === '1'|get\('refresh'\)/, '?refresh=1 后台重算（不阻塞）');
  assert.match(alignRoutes, /loadLatestAlignSnapshot/, 'GET 只读库快照');
  assert.match(alignRoutes, /updateAlignSnapshotAfterAction/, '确认/忽略同事务更新快照（规格 §5）');
  assert.match(alignRoutes, /markAlignSnapshotDirty/, '恢复后快照标脏 + 后台重算');
  assert.match(server, /triggerAlignGeneration/, '后台生成 single-flight 触发（闭包留宿主，经 ctx 传入）');
  assert.match(alignRoutes, /cached: true/, '读快照 cached:true（签名不变无重算）');
  assert.doesNotMatch(server, /alignRunner\.invalidate/, '废弃 invalidate() 内存语义');
  // 内存缓存运行器本体（TTL/single-flight/staleCache/invalidate）已从 align-query.js 删除（DL 批）
  const alignQuery = readFileSync(join(process.cwd(), 'src', 'align-query.js'), 'utf8');
  assert.ok(!alignQuery.includes('export function createAlignRunner'), 'align-query.js 不再导出内存缓存运行器（废弃语义）');
  assert.match(snapMod, /max\(coalesce\(reviewed_at, created_at\)\)/, '签名含 gsm max(reviewed_at)（规格 §4）');
  assert.match(snapMod, /mtimeMs/, '签名含 skus.json mtime');
  assert.match(snapMod, /ALIGN_SNAPSHOT_KEEP = 5/, 'prune 保留最近 5 条');
  assert.match(snapMod, /ALIGN_SNAPSHOT_MAX_AGE_MS_DEFAULT = 24/, '24h 强制重算兜底');
  assert.match(snapMod, /align\.snapshot_failed/, '生成失败日志');
  assert.match(sched, /name: 'align-snapshot'/, '调度任务 align-snapshot 存在（硬规则 9）');
  assert.match(sched, /ALIGN_SNAPSHOT_INTERVAL_MIN, 30/, '默认每 30 分钟');
  assert.match(sched, /ALIGN_SNAPSHOT_INITIAL_DELAY_SEC, 30/, '首轮延迟 30 秒（空表兜底生成）');
  assert.match(cli, /'align-snapshot': cmdAlignSnapshot/, 'CLI 子命令接线（runSyncTracked 健康可见）');
  assert.match(cli, /ensureAlignSnapshot/, 'CLI 走共享 ensureAlignSnapshot');
  // 页面：状态徽标 / 5 统计卡 / 筛选 chip / 批量按钮 / 明细 / 空态互斥；生成中仅首次生成
  assert.match(alignAdmin, /首次生成中/, '首次生成横幅（规格 §6：生成中只在首次生成出现）');
  assert.match(alignAdmin, /上次生成于/, '头部「上次生成于 HH:mm」');
  assert.match(alignAdmin, /生成失败/, '头部状态徽标（生成失败）');
  assert.match(alignAdmin, /已生成/, '头部状态徽标（已生成）');
  assert.match(alignAdmin, /optimisticRemove/, '操作后本地乐观移除已处理组（规格 §6）');
  assert.match(alignAdmin, /数据已更新/, '后台重算完成轻提示（规格 §6）');
  assert.doesNotMatch(alignAdmin, /已完成 \{\{ generating\.processed/, '不再显示生成进度（X/Y）');
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
  // 锁真实代码（不是注释）：空态只在「有快照且 0 组」显示——首次生成/加载中/加载失败/生成失败都不显示
  assert.match(alignAdmin, /!firstRun && !snapshotError && !loading && !loadError && displayedRows\.length === 0/, '空态互斥条件');
  assert.match(alignAdmin, /队列加载失败，请点「刷新」重试/, '加载失败提示（与空态互斥）');
  assert.match(alignAdmin, /疑似本体/, '候选疑似本体提示');
  assert.match(alignAdmin, /api\/admin\/align\/confirm/, '确认接线');
  assert.match(alignAdmin, /api\/admin\/align\/preview/, '单组合并预览接线');

  // ── DH 批（docs/ALIGN-INTEGRITY.md §2/§3）：继承参考 appid、补写映射、已忽略视图/恢复、审阅记录 ──
  assert.match(alignCompute, /align\.writeBackfilledMaps/, '计算时自动补写映射（A1，DL 批移至 align-compute.js）');
  assert.match(alignCompute, /align\.map_backfilled/, '补写映射日志 align.map_backfilled（A1）');
  assert.match(alignRoutes, /\/api\/admin\/align\/ignored' && req\.method === 'GET'/, '已忽略视图接口（B1）');
  assert.match(alignRoutes, /\/api\/admin\/align\/restore' && req\.method === 'POST'/, '恢复为待处理接口（B1）');
  assert.match(alignRoutes, /\/api\/admin\/align\/history' && req\.method === 'GET'/, '审阅记录接口（C1）');
  assert.match(alignRoutes, /align\.restored/, '恢复审计 align.restored（B1）');
  assert.match(alignCompute, /lastReviewed/, '队列行带最近处理（C1）');
  assert.match(cli, /align\.writeBackfilledMaps/, 'CLI 匹配步同样自动补写（A1）');
  assert.match(alignAdmin, /api\/admin\/align\/ignored/, '前端已忽略视图接线（B1）');
  assert.match(alignAdmin, /api\/admin\/align\/restore/, '前端恢复接线（B1）');
  assert.match(alignAdmin, /api\/admin\/align\/history/, '前端审阅记录接线（C1）');
  assert.match(alignAdmin, /确认恢复/, '恢复二次确认按钮（§5.2）');
  assert.match(alignAdmin, /确认后将合并到目标游戏/, '确认弹窗孤儿行合并提示（D1）');
  assert.match(alignAdmin, /最近处理/, '队列「最近处理」列（C1）');

  // ── DN 批（docs/TODO.md DN）：内容词 SKU 默认归档（不进队列/已忽略可查看恢复/反向自检）──
  assert.match(alignCompute, /align\.archiveContentWordItems/, 'computeAlignGroups 内容词判定接线（DN）');
  assert.match(alignCompute, /align\.writeContentWordArchives/, '内容词归档写 game_source_map（DN）');
  assert.match(alignCompute, /align\.content_word_skipped/, '内容词归档日志（含计数）（DN）');
  assert.match(alignAdmin, /内容词自动归档/, '「已忽略」chip 旁注明内容词自动归档（DN）');
  assert.match(alignAdmin, /row\.method === 'content_word'/, '已忽略视图标注内容词归档组（DN）');

  // ── A3 批（docs/DESIGN-AUDIT.md A3）：库为唯一真相、skus.json 只读兼容 ──
  assert.doesNotMatch(alignRoutes, /writeFileSync\(alignSkuFile\(\)/, '确认流程不再写 skus.json');
  assert.match(alignRoutes, /不再写回 skus\.json|只写 game_source_map/, '确认注释锁（A3）');
  assert.match(cliSync, /loadConfirmedAppids/, 'sync sonkwo 读库映射接线（cli 同步域）');
  assert.match(cliSync, /resolveSkuAppid/, 'appid 解析统一走库优先+文件回落');
  assert.doesNotMatch(cli, /entry\.appid = appid/, 'match 全路径不再写 skus.json 的 appid');
  assert.match(cli, /映射已写 game_source_map/, '--confirm 落库文案');
  assert.match(alignAdmin, /写 game_source_map（confirmed）/, '确认弹窗「落地」文案与 A3 一致');
});

// ============================================================ CO-5/B4-2 第十四轮静态锁
// admin-align 域（B4 #17：后台对齐审核）从 server.js/pg.js 巨石拆出后，
// 静态断言按新落点指向：
//   · 路由分支 → src/routes/admin-align.js；
//   · 域专属 SQL（align_snapshots 表 DDL + 域内联 5 新函数）→ src/store/admin-align-repository.js，
//     pg.js 必须 re-export（旧 db.* 导入签名不变），migrate() 继续消费 DDL；
//   · server.js 只留单入口接线（管理段），且必须真实调用——删掉调用即红（防死模块）；
//   · 旧分支不得残留在 server.js（防双实现）。
// 反向自检口径：删掉 routes/admin-align.js 任一路由分支 → 第 1 组断言红；
// 删掉 server.js 的入口接线 → 第 2 组红；把分支抄回 server.js → 第 3 组红；
// 删 pg.js re-export → 第 4 组红。

const AL_ROUTES = readFileSync(join(process.cwd(), 'src', 'routes', 'admin-align.js'), 'utf8');
const AL_REPO = readFileSync(join(process.cwd(), 'src', 'store', 'admin-align-repository.js'), 'utf8');
const AL_SERVER = readFileSync(join(process.cwd(), 'src', 'server.js'), 'utf8');
const AL_PG = readFileSync(join(process.cwd(), 'src', 'store', 'pg.js'), 'utf8');

test('CO-5/B4-2 第十四轮：admin-align 路由分支全部在 src/routes/admin-align.js（管理段单入口，删任一支即红）', () => {
  assert.match(AL_ROUTES, /path === '\/api\/admin\/align' && req\.method === 'GET'/, '队列接口分支在新文件');
  assert.match(AL_ROUTES, /path\.match\(\/\^\\\/api\\\/admin\\\/align\\\/preview\$\/\)/, '合并预览分支在新文件');
  assert.match(AL_ROUTES, /path === '\/api\/admin\/align\/confirm' && req\.method === 'POST'/, '确认分支在新文件');
  assert.match(AL_ROUTES, /path === '\/api\/admin\/align\/ignore' && req\.method === 'POST'/, '忽略分支在新文件');
  assert.match(AL_ROUTES, /path === '\/api\/admin\/align\/ignored' && req\.method === 'GET'/, '已忽略视图分支在新文件');
  assert.match(AL_ROUTES, /path === '\/api\/admin\/align\/restore' && req\.method === 'POST'/, '恢复分支在新文件');
  assert.match(AL_ROUTES, /path === '\/api\/admin\/align\/history' && req\.method === 'GET'/, '审阅记录分支在新文件');
  assert.match(AL_ROUTES, /path === '\/api\/admin\/align\/search' && req\.method === 'GET'/, '搜索候选分支在新文件');
  // 单入口形态（§15.3 位置语义：管理段）
  assert.match(AL_ROUTES, /export async function handleAdminAlignAdmin\(ctx\)/, '管理段入口');
  // 守卫与语义随路由
  assert.match(AL_ROUTES, /if \(!requireAdmin\(\)\) return true/, '管理段守卫');
  assert.match(AL_ROUTES, /runGated\('GET \/api\/admin\/align', 1,/, '读接口并发闸随路由');
  assert.match(AL_ROUTES, /triggerAlignGeneration\(\)/, '首次 202 触发后台生成');
  assert.match(AL_ROUTES, /triggerAlignGeneration\(\{ force: true \}\)/, '?refresh=1 强制重算');
  assert.match(AL_ROUTES, /loadLatestAlignSnapshotForUpdate\(tx\)/, '动作同事务锁快照行');
  assert.match(AL_ROUTES, /updateAlignSnapshotAfterAction\(tx, snap,/, '同事务更新快照');
  assert.match(AL_ROUTES, /markAlignSnapshotDirty\(tx, snap\)/, '恢复标脏');
  assert.match(AL_ROUTES, /cached: true,/, '库快照 cached 语义');
  assert.match(AL_ROUTES, /firstRun: true,/, '无快照 202 firstRun');
  assert.match(AL_ROUTES, /store\.tx\(async \(tx\)/, '动作事务走 store.tx');
  // 路由模块只做编排：SQL 走 repository / align.js（不许出现 SQL 字面量）
  assert.ok(!/select |insert |update |delete from /.test(AL_ROUTES), 'routes/admin-align.js 不写 SQL 字面量');
  // 内联 SQL 全部走 repository 新函数
  assert.match(AL_ROUTES, /db\.gameAliasGameId\(q, 'sonkwo',/, '确认流程别名查询走 repository');
  assert.match(AL_ROUTES, /db\.gameSteamAppidById\(q, fromId\)/, '源行 appid 守卫走 repository');
  assert.match(AL_ROUTES, /db\.listOrphanGameRows\(q, name\)/, '孤儿行查询走 repository');
  assert.match(AL_ROUTES, /db\.gameBySteamAppid\(tx, appid\)/, '目标游戏查询走 repository');
  assert.match(AL_ROUTES, /db\.searchAlignGames\(q, kw\)/, '搜索候选走 repository');
  // 未命中返回 false，宿主继续
  assert.match(AL_ROUTES, /return false;/, '未命中返回 false，宿主继续');
});

test('CO-5/B4-2 第十四轮：server.js 必须真实接线管理段入口（删掉调用即红，防死模块）', () => {
  assert.match(AL_SERVER, /import \{ handleAdminAlignAdmin \} from '\.\/routes\/admin-align\.js'/, 'server.js 必须导入域路由入口');
  // 锁「完整调用形态」：必须是 if (await handleXxx(...)) return;——只断言字符串存在会被 if(false) 包一层绕过
  assert.match(AL_SERVER, /if \(\s*await handleAdminAlignAdmin\(\{[\s\S]{0,1200}?path,[\s\S]{0,1200}?req,[\s\S]{0,1200}?res,[\s\S]{0,1200}?triggerAlignGeneration,[\s\S]{0,400}?\}\)\s*\)\s*return;/, '管理段接线（完整形态，且消费返回值）');
  // 管理段 ctx 关键字段必须传齐：漏传 requireAdmin 守卫失效、漏传 user 审计落空、
  // 漏传 store 事务报错、漏传 runGated 并发闸失效、漏传 triggerAlignGeneration 动作后不重算
  assert.match(AL_SERVER, /await handleAdminAlignAdmin\(\{[\s\S]{0,1200}?requireAdmin,/);
  assert.match(AL_SERVER, /await handleAdminAlignAdmin\(\{[\s\S]{0,1200}?user,/);
  assert.match(AL_SERVER, /await handleAdminAlignAdmin\(\{[\s\S]{0,1200}?store,/);
  assert.match(AL_SERVER, /await handleAdminAlignAdmin\(\{[\s\S]{0,1200}?runGated,/);
  assert.match(AL_SERVER, /await handleAdminAlignAdmin\(\{[\s\S]{0,1200}?triggerAlignGeneration,/);
  // 位置语义锁：调用必须在公告管理段接线之后、管理段 404 兜底之前（本域原位置；
  // bulk 已随 B4 #11 拆到 routes/admin-users.js、steam-logs 已随 B4 #12 拆到
  // routes/admin-reports.js，锚点改为 404 兜底）
  assert.match(AL_SERVER, /await handleAnnouncementsAdmin\(\{[\s\S]*?await handleAdminAlignAdmin\(\{/s, '接线在公告管理段接线之后（本域原位置）');
  assert.match(AL_SERVER, /await handleAdminAlignAdmin\(\{[\s\S]*?return json\(res, 404, \{ error: 'not found' \}\);/s, '接线在管理段 404 兜底之前（本域原位置，bulk/steam-logs 已随 #11/#12 拆走）');
  // 后台生成 single-flight 留宿主（与 CLI align-snapshot 共享 ensureAlignSnapshot；闭包按引用传入）
  assert.match(AL_SERVER, /let alignGeneration = null;/, '后台生成 single-flight 状态留 server.js');
  assert.match(AL_SERVER, /const triggerAlignGeneration = /, 'triggerAlignGeneration 闭包留 server.js（按引用传入）');
  assert.match(AL_SERVER, /createAlignCompute\(\{ q, db, logger \}\)/, 'computeAlignGroups 工厂留 server.js');
});

test('CO-5/B4-2 第十四轮：admin-align 路由分支不得双实现（server.js 里保留旧分支即红，防拆分后两处漂移）', () => {
  assert.ok(!/path === '\/api\/admin\/align' && req\.method/.test(AL_SERVER), '队列接口分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/align\/confirm' && req\.method/.test(AL_SERVER), '确认分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/align\/ignore' && req\.method/.test(AL_SERVER), '忽略分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/align\/ignored' && req\.method/.test(AL_SERVER), '已忽略视图分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/align\/restore' && req\.method/.test(AL_SERVER), '恢复分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/align\/history' && req\.method/.test(AL_SERVER), '审阅记录分支不得残留在 server.js');
  assert.ok(!/path === '\/api\/admin\/align\/search' && req\.method/.test(AL_SERVER), '搜索分支不得残留在 server.js');
  assert.ok(!/const alignPreviewMatch = path\.match/.test(AL_SERVER), '预览分支不得残留在 server.js');
  // 行映射/确认内部步骤随域移出（server.js 不再有域内实现）
  assert.ok(!/const mapAlignRows =/.test(AL_SERVER), 'mapAlignRows 不得残留在 server.js');
  assert.ok(!/const confirmAlignKey =/.test(AL_SERVER), 'confirmAlignKey 不得残留在 server.js');
  // 边界锁：并发闸配置键留宿主（http-guard.test.js 也锁）
  assert.match(AL_SERVER, /'GET \/api\/admin\/align': 1,/, 'HEAVY_GATE_CONFIG 键留 server.js');
  // bulk 派发表无 align 条目（对齐审核不涉 bulk，本域全部走 /api/admin/align*）；
  // B4 #11 拆分后 BULK_ACTIONS 随 admin-users 域移到 src/routes/admin-users.js，断言指向新落点
  const AU_ROUTES = readFileSync(join(process.cwd(), 'src', 'routes', 'admin-users.js'), 'utf8');
  const bulkBlock = (AU_ROUTES.match(/const BULK_ACTIONS = \{[\s\S]*?\n\};/) ?? [''])[0];
  assert.ok(!/align/i.test(bulkBlock), 'BULK_ACTIONS 无 align 条目（派发表已随 #11 拆到 routes/admin-users.js）');
});

test('CO-5/B4-2 第十四轮：admin-align-repository.js 签名不变 + pg.js re-export（删 re-export 即红）', () => {
  // align_snapshots 表 DDL 搬家（migrate 继续消费，建表语义不变）
  assert.match(AL_REPO, /export const ALIGN_SNAPSHOTS_DDL = `/, 'DDL 常量在 repository');
  assert.match(AL_REPO, /create table if not exists align_snapshots \(/, 'align_snapshots 建表语句随常量搬家');
  assert.match(AL_REPO, /create index if not exists idx_align_snapshots_gen/, '生成时间索引随常量搬家');
  // 域内联 SQL 抽新函数（SQL 逐字照抄，语义不变）
  assert.match(AL_REPO, /export async function gameAliasGameId\(q, platformCode, productId\)/, 'gameAliasGameId 签名');
  assert.match(AL_REPO, /select game_id from game_aliases where platform_code = \$1 and platform_product_id = \$2/, '别名查询 SQL 逐字搬家');
  assert.match(AL_REPO, /export async function gameSteamAppidById\(q, gameId\)/, 'gameSteamAppidById 签名');
  assert.match(AL_REPO, /export async function listOrphanGameRows\(q, name\)/, 'listOrphanGameRows 签名');
  assert.match(AL_REPO, /g\.steam_appid is null and g\.name = \$1 and not g\.deleted/, '孤儿行过滤条件逐字搬家');
  assert.match(AL_REPO, /export async function gameBySteamAppid\(q, appid\)/, 'gameBySteamAppid 签名');
  assert.match(AL_REPO, /select id, steam_appid from games where steam_appid = \$1 limit 1/, '目标查询 SQL 逐字搬家');
  assert.match(AL_REPO, /export async function searchAlignGames\(q, kw\)/, 'searchAlignGames 签名');
  assert.match(AL_REPO, /name ilike \$1 or name_en ilike \$1 or steam_appid::text = \$2/, '搜索 SQL 逐字搬家');
  // pg.js 必须 re-export（旧 db.* 导入签名不变；routes/admin-align.js 与现有测试照旧走聚合壳）
  assert.match(AL_PG, /export \{\s*ALIGN_SNAPSHOTS_DDL,[\s\S]{0,800}?gameAliasGameId,[\s\S]{0,800}?searchAlignGames,[\s\S]{0,400}?\} from '\.\/admin-align-repository\.js'/, 'pg.js 必须 re-export（DDL + 5 新函数）');
  assert.match(AL_PG, /await store\.exec\(ALIGN_SNAPSHOTS_DDL\);/, 'migrate() 继续消费 DDL（签名不变）');
  // 旧定义不得残留在 pg.js（双实现会漂移）
  assert.ok(!/const ALIGN_SNAPSHOTS_DDL = `/.test(AL_PG), 'pg.js 不允许保留旧 DDL 定义（只许 re-export）');
});
