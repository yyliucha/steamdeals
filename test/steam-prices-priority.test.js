// F 批（docs/TODO.md F 段）：Steam 价格同步优化——限速收紧 + 热点优先/冷门降频。
// 守：① 速率降到 200 次/5 分钟配额以内（1600ms ≈ 187 次/5min）；② 热点（访问/标记/热度）每天刷、
// 冷门按最近快照超过 N 天才刷，选择逻辑在 SQL 里可审计；③ 阈值可通过环境变量调整。
// CO-5/B4-2 第十轮：cmdSyncSteamPrices 已随 cli 同步类域拆到 src/cli/sync.js、
// 选取 SQL 抽到 src/store/cli-sync-repository.js，断言按新落点指向。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cliSync = readFileSync(new URL('../src/cli/sync.js', import.meta.url), 'utf8');
const cliSyncRepo = readFileSync(new URL('../src/store/cli-sync-repository.js', import.meta.url), 'utf8');

test('F：限速 1100 → 1600（不再靠 429 冷却兜底）', () => {
  assert.match(cliSync, /rateLimitMs: 1600/);
  assert.doesNotMatch(cliSync, /rateLimitMs: 1100/);
});

test('F：热点优先 + 冷门降频的选取 SQL 落地', () => {
  assert.match(cliSyncRepo, /is_hot/);
  assert.match(cliSyncRepo, /page_views v where v.appid = g.steam_appid/);
  assert.match(cliSyncRepo, /user_game_flags f where f.game_id = g.id/);
  assert.match(cliSyncRepo, /coalesce\(g.heat, 0\) >= \$2/);
  assert.match(cliSyncRepo, /price_snapshots ps/);
  assert.match(cliSyncRepo, /make_interval\(days => \$3\)/);
  assert.match(cliSyncRepo, /order by t.is_hot desc, t.last_snap asc, t.steam_appid/);
});

test('F：阈值可用环境变量调整（默认 热度≥1 / 冷门 3 天）', () => {
  assert.match(cliSync, /STEAM_PRICES_HOT_HEAT_MIN \?\? '1'/);
  assert.match(cliSync, /STEAM_PRICES_COLD_DAYS \?\? '3'/);
});
