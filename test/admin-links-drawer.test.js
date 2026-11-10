// AO 批（docs/ADMIN-LINKS-DRAWER.md §8）：游戏列布局 + 链接抽屉改版。
// 守：复制是中英文两行；点名字开抽屉、点图标只复制；抽屉卡片字段齐全（区服/原价/折扣/库存/时间）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nameCopyText } from '../frontend/src/utils/gameNames.js';
import { pickLowestLink } from '../frontend/src/utils/linkPrices.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('nameCopyText：中英文两行 / 相同单行 / 缺失回退', () => {
  assert.equal(nameCopyText({ name: '雷霆小队2', name_en: 'SHOCK TROOPERS 2nd Squad' }), '雷霆小队2\nSHOCK TROOPERS 2nd Squad');
  assert.equal(nameCopyText({ name: 'METAL SLUG XX', name_en: 'METAL SLUG XX' }), 'METAL SLUG XX');
  assert.equal(nameCopyText({ name: '只有中文', name_en: '' }), '只有中文');
  assert.equal(nameCopyText({ name: '', name_en: 'Only English' }), 'Only English');
});

test('AO 前端接线：点名字开抽屉、点图标复制、中英文复制、Check 反馈', () => {
  const vue = read('../frontend/src/pages/AdminModules.vue');
  assert.match(vue, /import GameLinksDrawer/);
  assert.match(vue, /import \{ nameCopyText \}/);
  assert.match(vue, /import \{ CopyDocument, Check \}/);
  assert.match(vue, /class="game-name" :title="row.name" @click="openGameLinks\(row\)"/);
  assert.match(vue, /@click.stop="copyGameName\(row\)"/);
  assert.match(vue, /copiedGameId/);
  assert.match(vue, /<GameLinksDrawer v-model:visible="linksDrawer.visible"/);
});

test('AO 抽屉组件：头部复制中英文/AppID、卡片字段齐全、空态兜底', () => {
  const drawer = read('../frontend/src/components/GameLinksDrawer.vue');
  assert.match(drawer, /复制中英文名/);
  assert.match(drawer, /AppID \{\{ game.steam_appid \}\}/);
  assert.match(drawer, /regionLabel\(l.region\)/);
  assert.match(drawer, /l.original_cents && l.original_cents > l.price_cents/);
  assert.match(drawer, /l.in_stock \? '有货' : '缺货'/);
  assert.match(drawer, /relDay\(l.last_seen_at\)/);
  assert.match(drawer, /这个游戏还没有可跳转的购买链接/);
  assert.match(drawer, /在 Steam 打开/);
  assert.match(drawer, /target="_blank" rel="noopener noreferrer"/);
});

// BD 批（docs/ADMIN-LINKS-DRAWER.md §12）：最低价醒目——币种不折算 / 缺货不参与 / 唯一最低才标。
test('pickLowestLink：同币种内取唯一最低，跨币种不比较', () => {
  const gog = { platform_code: 'gog', region: 'cn', currency: 'CNY', price_cents: 2500, in_stock: true };
  const steam = { platform_code: 'steam', region: 'cn', currency: 'CNY', price_cents: 4000, in_stock: true };
  const humble = { platform_code: 'humble', region: 'cn', currency: 'CNY', price_cents: 6666, in_stock: true };
  assert.equal(pickLowestLink([gog, steam, humble]), gog, 'CNY 内最低 2500');
  // 首项锚定币种：hk 的 HKD 数值更低也不参与
  const hk = { platform_code: 'steam', region: 'hk', currency: 'HKD', price_cents: 100, in_stock: true };
  assert.equal(pickLowestLink([steam, hk]), null, '只有 1 条 CNY 可比 → 不标（跨币种不比）');
  assert.equal(pickLowestLink([gog, steam, hk]), gog, 'HKD 再低也不参与 CNY 的比较');
});

test('pickLowestLink：缺货排除；唯一最低才标（单条/同价返回 null）', () => {
  const cheapOut = { currency: 'CNY', price_cents: 1000, in_stock: false };
  const a = { currency: 'CNY', price_cents: 2500, in_stock: true };
  const b = { currency: 'CNY', price_cents: 4000, in_stock: true };
  assert.equal(pickLowestLink([cheapOut, a, b]), a, '缺货的 1000 不参与，最低为有货的 2500');
  assert.equal(pickLowestLink([a]), null, '只有 1 条 → 不标');
  const same1 = { currency: 'CNY', price_cents: 3000, in_stock: true };
  const same2 = { currency: 'CNY', price_cents: 3000, in_stock: true };
  assert.equal(pickLowestLink([same1, same2]), null, '全部同价 → 没有「最低」');
  assert.equal(pickLowestLink([]), null);
  assert.equal(pickLowestLink(null), null);
});

test('BD 抽屉接线：最低价 computed + 整卡 low 样式 + 「最低价」角标', () => {
  const drawer = read('../frontend/src/components/GameLinksDrawer.vue');
  assert.match(drawer, /import \{ pickLowestLink \}/);
  assert.match(drawer, /const lowestLink = computed\(\(\) => pickLowestLink\(sortedLinks\.value\)\)/);
  assert.match(drawer, /:class="\{ out: !l\.in_stock, low: l === lowestLink \}"/);
  assert.match(drawer, /class="ld-badge">最低价/);
  assert.match(drawer, /\.ld-card\.low\{/);
  assert.match(drawer, /\.ld-badge\{/);
});
