// AF 批（docs/FRONTEND-STALE-LIST.md）：搜索态下写操作（愿望单加/删、标记、取消提醒）必须失效搜索缓存。
// 静态断言：每个写操作的 invalidateSearchCache() 都在 loadGames 之前调用；deleteWatch 只失效不重拉。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../frontend/src/pages/Home.vue', import.meta.url), 'utf8');

test('AF：invalidateSearchCache 定义存在且清空 searchCache', () => {
  assert.match(src, /function invalidateSearchCache\(\)\{searchCache\.clear\(\);\}/, '必须有 invalidateSearchCache(){searchCache.clear()}');
});

/** 取某 async function 的整行（本页函数是单行风格），断言失效调用在重拉之前。 */
function lineOf(fnName) {
  const i = src.indexOf(`async function ${fnName}(`);
  assert.ok(i >= 0, `应有 ${fnName}`);
  const lineEnd = src.indexOf('\n', i);
  return src.slice(i, lineEnd);
}

test('AF：addWishlist 成功后先失效缓存再 loadGames', () => {
  const line = lineOf('addWishlist');
  assert.ok(line.includes('invalidateSearchCache()'), '加愿望单必须失效缓存');
  assert.ok(line.indexOf('invalidateSearchCache()') < line.indexOf('loadGames(page.value)'), '失效必须在 loadGames 之前');
});

test('AF：confirmWishlistRemove 成功后先失效缓存再 loadGames', () => {
  const line = lineOf('confirmWishlistRemove');
  assert.ok(line.includes('invalidateSearchCache()'));
  assert.ok(line.indexOf('invalidateSearchCache()') < line.indexOf('loadGames(page.value)'));
});

test('AF：setGameFlag 游客与登录两个分支都失效（两个 loadGames 各配一个失效）', () => {
  const line = lineOf('setGameFlag');
  const count = (line.match(/invalidateSearchCache\(\)/g) ?? []).length;
  assert.ok(count >= 2, `两个分支都要失效，实得 ${count}`);
  assert.ok(line.indexOf('invalidateSearchCache()') < line.indexOf('loadGames(page.value)'), '第一个失效在第一次 loadGames 之前');
  assert.ok(line.lastIndexOf('invalidateSearchCache()') < line.lastIndexOf('loadGames(page.value)'), '第二个失效在第二次 loadGames 之前');
});

test('AF：deleteWatch 成功后失效缓存但不重拉列表（列表数据未变）', () => {
  const line = lineOf('deleteWatch');
  assert.ok(line.includes('invalidateSearchCache()'));
  assert.ok(!line.includes('loadGames'), '取消提醒不改列表数据，不应重拉');
});

test('AF：缓存能力保留——loadGames 仍带 30 秒缓存分支', () => {
  const line = lineOf('loadGames');
  assert.match(line, /searchCache\.get\(cacheKey\)/, '缓存读取分支必须保留');
  assert.match(line, /30000/, '30 秒窗口保留');
});
