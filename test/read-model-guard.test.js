// B5 批（docs/DESIGN-AUDIT.md B5 行）：game_region_snapshot 唯一写入路径的静态锁。
// 守的约束：src/ 下对 game_region_snapshot 的全部 INSERT/UPDATE/DELETE 语句只能存在于
// src/store/pg.js 的 <snapshot-write-gateway> 标记块内——任何新代码/迁移想绕过维护钩子
// 直写快照都会让本测试变红（静态锁「真锁住」，不是只看全绿）。
// 注意：test/ 目录不在扫描范围（测试允许人为构造不一致来验证对账），只锁 src/ 生产代码。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');
const WRITE_RE = /(insert\s+into\s+game_region_snapshot|update\s+game_region_snapshot|delete\s+from\s+game_region_snapshot)/gi;
const GATEWAY_RE = /\/\/ <snapshot-write-gateway>([\s\S]*?)\/\/ <\/snapshot-write-gateway>/;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (/\.(js|mjs|cjs)$/.test(name)) out.push(p);
  }
  return out;
}

test('B5 静态锁：快照写语句全部收在 pg.js 的 snapshotWrite 网关块内', () => {
  const pgPath = join(SRC, 'store', 'pg.js');
  const pg = readFileSync(pgPath, 'utf8');
  const m = pg.match(GATEWAY_RE);
  assert.ok(m, '网关标记块必须存在（<snapshot-write-gateway>…</snapshot-write-gateway>）');
  const inside = m[1];
  const wholeCount = (pg.match(WRITE_RE) ?? []).length;
  const insideCount = (inside.match(WRITE_RE) ?? []).length;
  assert.ok(insideCount > 0, '网关内应有快照写语句（当前实现 9 条）');
  assert.equal(
    wholeCount,
    insideCount,
    `pg.js 里所有快照写语句必须都在网关块内（文件 ${wholeCount} 条，块内 ${insideCount} 条）`,
  );

  // 其它 src/ 文件一条都不许有（含未来新增的迁移/路由/适配器）
  for (const f of walk(SRC)) {
    if (f === pgPath) continue;
    const text = readFileSync(f, 'utf8');
    const hits = (text.match(WRITE_RE) ?? []).length;
    assert.equal(hits, 0, `${f} 直写 game_region_snapshot（${hits} 处）——必须经 pg.js 的 snapshotWrite 网关`);
  }
});

test('B5 静态锁自带反向自检：写语句一旦挪出网关，计数必然不一致', () => {
  // 守的是「检查器本身没坏」：构造一段网关外有写语句的文本，检查器必须能发现（计数 2 ≠ 1）。
  const synthetic =
    '// <snapshot-write-gateway>\nconst A = `update game_region_snapshot set price_cents=1`;\n// </snapshot-write-gateway>\n' +
    'const B = `insert into game_region_snapshot values (1)`;\n';
  const m = synthetic.match(GATEWAY_RE);
  assert.ok(m, '反向自检样本应有网关块');
  const insideCount = (m[1].match(WRITE_RE) ?? []).length;
  const wholeCount = (synthetic.match(WRITE_RE) ?? []).length;
  assert.equal(insideCount, 1, '块内 1 条');
  assert.equal(wholeCount, 2, '整体 2 条 ≠ 块内 1 条 → 检查器会判不一致（反向自检成立）');
});
