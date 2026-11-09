// F 批（docs/TODO.md F 段）：Steam 价格同步优化——限速收紧 + 热点优先/冷门降频。
// 守：① 速率降到 200 次/5 分钟配额以内（1600ms ≈ 187 次/5min）；② 热点（访问/标记/热度）每天刷、
// 冷门按最近快照超过 N 天才刷，选择逻辑在 SQL 里可审计；③ 阈值可通过环境变量调整。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cli = readFileSync(new URL('../src/cli.js', import.meta.url), 'utf8');

test('F：限速 1100 → 1600（不再靠 429 冷却兜底）', () => {
  assert.match(cli, /rateLimitMs: 1600/);
  assert.doesNotMatch(cli, /rateLimitMs: 1100/);
});

test('F：热点优先 + 冷门降频的选取 SQL 落地', () => {
  assert.match(cli, /is_hot/);
  assert.match(cli, /page_views v where v.appid = g.steam_appid/);
  assert.match(cli, /user_game_flags f where f.game_id = g.id/);
  assert.match(cli, /coalesce\(g.heat, 0\) >= \$2/);
  assert.match(cli, /price_snapshots ps/);
  assert.match(cli, /make_interval\(days => \$3\)/);
  assert.match(cli, /order by t.is_hot desc, t.last_snap asc, t.steam_appid/);
});

test('F：阈值可用环境变量调整（默认 热度≥1 / 冷门 3 天）', () => {
  assert.match(cli, /STEAM_PRICES_HOT_HEAT_MIN \?\? '1'/);
  assert.match(cli, /STEAM_PRICES_COLD_DAYS \?\? '3'/);
});
