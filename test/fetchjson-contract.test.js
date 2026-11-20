// fetchJson 新契约回归锁（AB 批 v1.16.4 起：fetchJson 返回 { ...res, json }）：
// 2026-11-09 线上定位（TODO C1）：heat 与 steam-catalog 还在按旧契约「返回即 JSON」解包，
// 导致 heat 全量无效跳过（写 0 条热度）、catalog 同步空跑——用静态断言锁住正确写法，防回归。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
// CO-5/B4-2 第十二轮：cmdHeat 已随 cli 运维类域拆到 src/cli/ops.js，断言按新落点指向
const cliOps = read('../src/cli/ops.js');
const catalog = read('../src/adapters/steam-catalog.js');
const steamMeta = read('../src/adapters/steam-meta.js');
const steamPrices = read('../src/adapters/steam.js');
const regions = read('../src/sync-regions.js');

test('heat：appdetails 必须经 .json 再按 appid 解包（旧写法取不到 → 全量无效跳过）', () => {
  assert.match(cliOps, /const entry = data\?\.json\?\.\[String\(appid\)\];/, 'heat 必须 data.json[appid]');
  assert.ok(!cliOps.includes('const entry = data?.[String(appid)];'), '旧契约写法不得残留');
  assert.match(cliOps, /filters=recommendations,release_date&cc=cn&l=schinese/, 'heat 请求参数保持（单 appid 才支持 recommendations）');
});

test('catalog：apps 数组必须经 .json 解包（旧写法 findAppArray(data) 空跑）', () => {
  assert.match(catalog, /findAppArray\(body\)/, 'findAppArray 吃 .json 解包后的 body');
  assert.ok(!catalog.includes('findAppArray(data)'), '旧契约写法不得残留');
  assert.match(catalog, /const body = data\?\.json \?\? \{\};/, 'catalog 先取 .json');
});

test('EI：元数据/价格区域走配置（内容默认 us、价格默认 cn/CNY），cc 参数化契约保持', () => {
  assert.match(steamMeta, /const url = `\$\{OFFICIAL_DETAILS\}\?appids=\$\{appid\}&cc=\$\{cc\}&l=schinese`;/, '元数据请求 cc 走参数（fetchMetadata 默认读 sync.contentRegion）');
  assert.ok(steamMeta.includes('cc = contentRegion()'), 'fetchMetadata 默认 cc 读 sync.contentRegion——国区商店隐藏成人内容，默认 us 采全量');
  assert.match(steamPrices, /url\.searchParams\.set\('cc', region\)/, '价格接口 cc 仍由 region 决定（与元数据解耦）');
  assert.ok(steamPrices.includes('get defaultRegion()') && steamPrices.includes('return baseRegion();'), '价格适配器默认区域读 site.baseRegion（getter 热加载，默认 cn）——本位币价格口径');
  // 默认值契约锁在 sync-regions.js 单点（EI 验收①：默认内容 us / 价格 cn+CNY）
  assert.match(regions, /return String\(env\.SYNC_CONTENT_REGION \?\? ''\)\.trim\(\)\.toLowerCase\(\) \|\| 'us';/, 'contentRegion 默认 us');
  assert.match(regions, /return String\(env\.SITE_BASE_REGION \?\? ''\)\.trim\(\)\.toLowerCase\(\) \|\| 'cn';/, 'baseRegion 默认 cn');
  assert.match(regions, /return String\(env\.SITE_BASE_CURRENCY \?\? ''\)\.trim\(\)\.toUpperCase\(\) \|\| 'CNY';/, 'baseCurrency 默认 CNY');
});
