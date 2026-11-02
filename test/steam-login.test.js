// Steam 登录 baseUrl：只有可信反代才采纳 X-Forwarded-*，防 Host/协议伪造。
import test from 'node:test';
import assert from 'node:assert/strict';
import { baseUrl, verifyCallback, buildLoginUrl, issueBindState, consumeBindState } from '../src/steam-login.js';

const okResponse = (body) => async () => ({
  ok: true,
  status: 200,
  url: 'https://steamcommunity.com/openid/login',
  headers: new Headers({ 'content-type': 'text/plain' }),
  text: async () => body,
});

test('verifyCallback：正确读取 fetchText 的 body 文本（is_valid:true 才通过）', async () => {
  const callback = new URL(
    'https://sd.example/api/auth/steam/callback?openid.claimed_id=' +
      encodeURIComponent('https://steamcommunity.com/openid/id/76561198123456789') +
      '&openid.sig=x',
  );
  // 历史 bug：把 fetchText 返回的对象当字符串 → snippet 打印 [object Object]，这里回归住
  assert.equal(await verifyCallback(callback, { fetchImpl: okResponse('ns:http://specs.openid.net/auth/2.0\nis_valid:true\n') }), '76561198123456789');
  assert.equal(await verifyCallback(callback, { fetchImpl: okResponse('ns:http://specs.openid.net/auth/2.0\nis_valid:false\n') }), null, 'is_valid:false 必须拒绝');
  assert.equal(await verifyCallback(callback, { fetchImpl: okResponse('<html>blocked</html>') }), null, '非 OpenID 响应必须拒绝');
});

const req = (headers = {}, remote = '1.2.3.4', encrypted = false) => ({
  headers,
  socket: { remoteAddress: remote, encrypted },
});

test('直连请求（不可信来源）：忽略 X-Forwarded-*，用 Host 与 socket 协议', () => {
  delete process.env.TRUST_PROXY;
  delete process.env.TRUSTED_PROXY_IPS;
  assert.equal(baseUrl(req({ host: 'site.example', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' })), 'http://site.example');
  assert.equal(baseUrl(req({ host: 'site.example' }, '1.2.3.4', true)), 'https://site.example');
});

test('TRUST_PROXY=1 且来源在 TRUSTED_PROXY_IPS：采纳 X-Forwarded-*', () => {
  process.env.TRUST_PROXY = '1';
  process.env.TRUSTED_PROXY_IPS = '10.0.0.0/8';
  assert.equal(baseUrl(req({ host: 'internal', 'x-forwarded-host': 'site.example', 'x-forwarded-proto': 'https' }, '10.0.0.5')), 'https://site.example');
  // 不在白名单的来源即使是 TRUST_PROXY=1 也不信
  assert.equal(baseUrl(req({ host: 'site.example', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' }, '1.2.3.4')), 'http://site.example');
  delete process.env.TRUST_PROXY;
  delete process.env.TRUSTED_PROXY_IPS;
});

test('私有网段来源自动信任（反向代理直连场景）', () => {
  delete process.env.TRUST_PROXY;
  assert.equal(baseUrl(req({ host: 'internal', 'x-forwarded-host': 'site.example', 'x-forwarded-proto': 'https' }, '127.0.0.1')), 'https://site.example');
});

test('绑定 state：一次性消费，重放 / 过期 / 不存在都拒绝', () => {
  const map = new Map();
  const now = Date.now();
  const state = issueBindState(map, 42, { nowMs: now });
  assert.equal(consumeBindState(map, state, { nowMs: now + 1000 }), 42, '首次消费返回 userId');
  assert.equal(consumeBindState(map, state, { nowMs: now + 2000 }), null, '同一 state 重放无效');
  const stale = issueBindState(map, 7, { nowMs: now + 3000, ttlMs: 1000 });
  assert.equal(consumeBindState(map, stale, { nowMs: now + 5000 }), null, '过期 state 无效');
  assert.equal(consumeBindState(map, 'nope', { nowMs: now }), null, '不存在的 state 无效');
  // 过期项在下次签发时被顺手清理
  issueBindState(map, 8, { nowMs: now + 6000 });
  assert.equal(map.size, 1, '过期登记项被清掉');
});

test('buildLoginUrl：state 写入 return_to 查询参数（回调按它防 CSRF）', () => {
  const withState = new URL(buildLoginUrl('https://sd.example', 'abc123'));
  assert.equal(withState.searchParams.get('openid.mode'), 'checkid_setup');
  const returnTo = new URL(withState.searchParams.get('openid.return_to'));
  assert.equal(returnTo.pathname, '/api/auth/steam/callback');
  assert.equal(returnTo.searchParams.get('state'), 'abc123');
  const bare = new URL(buildLoginUrl('https://sd.example'));
  assert.equal(new URL(bare.searchParams.get('openid.return_to')).searchParams.get('state'), null, '不带 state 也不破坏旧用法');
});
