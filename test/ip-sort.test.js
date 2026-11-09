// IP 排序（AQ 批 docs/ADMIN-REVIEW-LISTS.md §3.1）：数值序而不是字符串序。
// 守的是"同一 IP 聚在一起 + 9.x < 45.x < 100.x < 193.x"这个用户直觉。
import test from 'node:test';
import assert from 'node:assert/strict';
import { compareIp, isIpv4, ipv4ToInt } from '../frontend/src/utils/ipSort.js';

test('IPv4 按数值排序，而不是字符串顺序', () => {
  const list = ['193.122.153.190', '45.139.104.172', '9.1.1.1', '100.1.1.1'];
  list.sort(compareIp);
  assert.deepEqual(list, ['9.1.1.1', '45.139.104.172', '100.1.1.1', '193.122.153.190']);
});

test('同一 IP 的多条记录在排序后连续（分组前提）', () => {
  const list = ['45.1.1.1', '9.9.9.9', '45.1.1.1', '193.0.0.1'];
  list.sort(compareIp);
  assert.deepEqual(list, ['9.9.9.9', '45.1.1.1', '45.1.1.1', '193.0.0.1']);
});

test('IPv6 / 异常值排在 IPv4 之后，空值最后', () => {
  const list = ['', '::1', '45.1.1.1', 'not-an-ip', '9.9.9.9'];
  list.sort(compareIp);
  assert.equal(list[0], '9.9.9.9');
  assert.equal(list[1], '45.1.1.1');
  assert.equal(list[list.length - 1], '');
  assert.ok(list.indexOf('::1') > list.indexOf('45.1.1.1'));
  assert.ok(list.indexOf('not-an-ip') > list.indexOf('45.1.1.1'));
});

test('ipv4ToInt 只接受合法四段地址', () => {
  assert.equal(ipv4ToInt('255.255.255.255'), 2 ** 32 - 1);
  assert.equal(ipv4ToInt('1.2.3.4'), 1 * 2 ** 24 + 2 * 2 ** 16 + 3 * 2 ** 8 + 4);
  assert.equal(ipv4ToInt('1.2.3'), null);
  assert.equal(ipv4ToInt('256.1.1.1'), null);
  assert.equal(ipv4ToInt('::1'), null);
  assert.equal(isIpv4(' 10.0.0.1 '), true);
  assert.equal(isIpv4('10.0.0.999'), false);
});
