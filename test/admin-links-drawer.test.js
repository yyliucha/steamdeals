// AO 批（docs/ADMIN-LINKS-DRAWER.md §8）：游戏列布局 + 链接抽屉改版。
// 守：复制是中英文两行；点名字开抽屉、点图标只复制；抽屉卡片字段齐全（区服/原价/折扣/库存/时间）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nameCopyText } from '../frontend/src/utils/gameNames.js';

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
