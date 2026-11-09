// fetchJson 新契约回归锁（AB 批 v1.16.4 起：fetchJson 返回 { ...res, json }）：
// 2026-11-09 线上定位（TODO C1）：heat 与 steam-catalog 还在按旧契约「返回即 JSON」解包，
// 导致 heat 全量无效跳过（写 0 条热度）、catalog 同步空跑——用静态断言锁住正确写法，防回归。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const cli = read('../src/cli.js');
const catalog = read('../src/adapters/steam-catalog.js');

test('heat：appdetails 必须经 .json 再按 appid 解包（旧写法取不到 → 全量无效跳过）', () => {
  assert.match(cli, /const entry = data\?\.json\?\.\[String\(appid\)\];/, 'heat 必须 data.json[appid]');
  assert.ok(!cli.includes('const entry = data?.[String(appid)];'), '旧契约写法不得残留');
  assert.match(cli, /filters=recommendations,release_date&cc=cn&l=schinese/, 'heat 请求参数保持（单 appid 才支持 recommendations）');
});

test('catalog：apps 数组必须经 .json 解包（旧写法 findAppArray(data) 空跑）', () => {
  assert.match(catalog, /findAppArray\(body\)/, 'findAppArray 吃 .json 解包后的 body');
  assert.ok(!catalog.includes('findAppArray(data)'), '旧契约写法不得残留');
  assert.match(catalog, /const body = data\?\.json \?\? \{\};/, 'catalog 先取 .json');
});
