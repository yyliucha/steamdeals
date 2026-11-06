// 版本比较与新版本检查（fetch 用注入的假实现，不发真实请求）。
// AE 批（docs/VERSION-SOURCE.md）：geo → 仓库选源 → GitHub 兜底。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseVersion,
  compareVersions,
  checkLatest,
  versionInfo,
  resetVersionCache,
  pickSourceOrder,
  fetchRegistryLatest,
} from '../src/version.js';

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: 'https://api.github.com/test',
    headers: new Headers({ 'content-type': 'application/json; charset=utf-8' }),
    text: async () => JSON.stringify(body),
  };
}

test('版本解析与比较', () => {
  assert.deepEqual(parseVersion('v0.20.2'), [0, 20, 2]);
  assert.deepEqual(parseVersion('1.2.3-rc1'), [1, 2, 3]);
  assert.equal(parseVersion('dev'), null);
  assert.equal(parseVersion(''), null);

  assert.ok(compareVersions('0.20.3', '0.20.2') > 0);
  assert.ok(compareVersions('v0.20.2', '0.20.2') === 0);
  assert.ok(compareVersions('0.9.9', '0.10.0') < 0, '数值比较而不是字符串比较');
  assert.equal(compareVersions('bad', '0.20.2'), 0);
});

test('检查更新：没有 release 时退回 tags，并识别出更新', async () => {
  resetVersionCache();
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('/releases/latest')) return jsonResponse({ message: 'Not Found' }, 404);
    return jsonResponse([{ name: 'v0.20.1' }, { name: 'v0.20.3' }, { name: 'v0.19.9' }, { name: 'nightly' }]);
  };

  const info = await versionInfo({ current: '0.20.2', fetchImpl, force: true });
  assert.equal(info.latest, 'v0.20.3');
  assert.equal(info.updateAvailable, true);
  assert.match(info.url, /releases\/tag\/v0\.20\.3/);
  assert.equal(info.error, null);
  assert.ok(calls.some((u) => u.includes('/releases/latest')));
  assert.ok(calls.some((u) => u.includes('/tags')));
});

test('当前已是最新时 updateAvailable=false', async () => {
  resetVersionCache();
  const fetchImpl = async (url) =>
    url.includes('/releases/latest')
      ? jsonResponse({ tag_name: 'v0.20.2', html_url: 'https://github.com/y/steamdeals/releases/tag/v0.20.2' })
      : jsonResponse([]);
  const info = await versionInfo({ current: '0.20.2', fetchImpl, force: true });
  assert.equal(info.latest, 'v0.20.2');
  assert.equal(info.updateAvailable, false);
});

test('检查结果有缓存，force 才重新请求；网络失败只记 error', async () => {
  resetVersionCache();
  let count = 0;
  const fetchImpl = async (url) => {
    count += 1;
    if (url.includes('/releases/latest')) return jsonResponse({ tag_name: 'v0.20.5' });
    return jsonResponse([]);
  };
  const first = await checkLatest({ fetchImpl, force: true });
  assert.equal(first.latest, 'v0.20.5');
  const before = count;
  const second = await checkLatest({ fetchImpl });
  assert.equal(count, before, '未强制时走缓存');
  assert.equal(second.latest, 'v0.20.5');

  resetVersionCache();
  const info = await versionInfo({
    current: '0.20.2',
    force: true,
    fetchImpl: async () => {
      throw Object.assign(new Error('boom'), {});
    },
  });
  assert.equal(info.latest, null);
  assert.equal(info.updateAvailable, false);
  assert.match(info.error, /boom/);
});

// ---------------------------------------------------------------- AE 批（docs/VERSION-SOURCE.md §5 验收）

const err = (status, message = 'x') => Object.assign(new Error(message), { status });

test('AE：pickSourceOrder——CN 先 TCR，其余先 Hub', () => {
  assert.deepEqual(pickSourceOrder('cn'), ['tcr', 'hub']);
  assert.deepEqual(pickSourceOrder('global'), ['hub', 'tcr']);
  assert.deepEqual(pickSourceOrder('unknown'), ['hub', 'tcr']);
});

test('AE：CN → 只请求 TCR，tag 无 v 前缀取最大，source=tcr', async () => {
  resetVersionCache();
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('ipinfo.io')) return jsonResponse({ country: 'CN' });
    if (url.includes('/service/token')) return jsonResponse({ token: 'tcr-token' });
    if (url.includes('/tags/list')) return jsonResponse({ tags: ['1.5.0', 'latest', '1.16', 'sha-abc123', '1.17.0'] });
    throw err(500, 'github 不应被调用');
  };
  const info = await versionInfo({ current: '1.16.0', force: true, fetchImpl });
  assert.equal(info.latest, '1.17.0', '无 v 前缀的 tag 也能解析取最大');
  assert.equal(info.source, 'tcr');
  assert.equal(info.region, 'cn');
  assert.equal(info.updateAvailable, true);
  assert.ok(calls.some((u) => u.includes('ccr.ccs.tencentyun.com')), '只打 TCR');
  assert.ok(!calls.some((u) => u.includes('registry-1.docker.io')), 'CN 优先时不应请求 Hub');
  assert.ok(!calls.some((u) => u.includes('api.github.com')), 'TCR 成功时不应回退 GitHub');
});

test('AE：US → 先 Hub，source=hub', async () => {
  resetVersionCache();
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('ipinfo.io')) return jsonResponse({ country: 'US' });
    if (url.includes('auth.docker.io')) return jsonResponse({ token: 'hub-token' });
    if (url.includes('registry-1.docker.io/v2')) return jsonResponse({ tags: ['1.16.4', 'latest'] });
    throw err(500, 'tcr 不应被调用');
  };
  const info = await versionInfo({ current: '1.16.4', force: true, fetchImpl });
  assert.equal(info.latest, '1.16.4');
  assert.equal(info.source, 'hub');
  assert.equal(info.region, 'global');
  assert.equal(info.updateAvailable, false);
  assert.ok(!calls.some((u) => u.includes('ccr.ccs.tencentyun.com')), 'global 优先时 Hub 成功不应再打 TCR');
});

test('AE：TCR tags 首次 401 → 换新 token 重试成功（不直接判失败）', async () => {
  resetVersionCache();
  const tagsCalls = [];
  const fetchImpl = async (url) => {
    if (url.includes('ipinfo.io')) return jsonResponse({ country: 'CN' });
    if (url.includes('/service/token')) return jsonResponse({ token: 'fresh-token' });
    if (url.includes('/tags/list')) {
      tagsCalls.push(url);
      if (tagsCalls.length === 1) throw err(401, 'unauthorized');
      return jsonResponse({ tags: ['1.16.4'] });
    }
    throw err(500, 'unexpected ' + url);
  };
  const info = await versionInfo({ current: '1.16.0', force: true, fetchImpl });
  assert.equal(info.latest, '1.16.4');
  assert.equal(info.source, 'tcr', '401 换 token 重试成功，不得回退 Hub');
  assert.equal(tagsCalls.length, 2, 'tags 请求两次（首次 401 → 换 token 重试）');
});

test('AE：geo 超时与双仓库全失败 → GitHub 兜底，source=github、region=unknown', async () => {
  resetVersionCache();
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('ipinfo.io')) throw err(408, 'geo timeout');
    if (url.includes('/releases/latest')) return jsonResponse({ tag_name: 'v0.20.5', html_url: 'https://github.com/y/steamdeals/releases/tag/v0.20.5' });
    return jsonResponse([]);
  };
  const info = await versionInfo({ current: '0.20.2', force: true, fetchImpl });
  assert.equal(info.latest, 'v0.20.5');
  assert.equal(info.source, 'github');
  assert.equal(info.region, 'unknown', 'geo 超时不阻塞，按双探降级');
  assert.ok(calls.some((u) => u.includes('auth.docker.io')), 'unknown 时两个仓库都探测（Hub token 已请求）');
  assert.ok(calls.some((u) => u.includes('ccr.ccs.tencentyun.com')), 'unknown 时两个仓库都探测（TCR token 已请求）');
});

test('AE：结果缓存——成功 6h、全失败 10min，force 才重查', async () => {
  resetVersionCache();
  let count = 0;
  const fetchImpl = async (url) => {
    count += 1;
    if (url.includes('ipinfo.io')) return jsonResponse({ country: 'CN' });
    if (url.includes('/service/token')) return jsonResponse({ token: 't' });
    if (url.includes('/tags/list')) return jsonResponse({ tags: ['1.16.4'] });
    throw err(500, 'x');
  };
  const first = await versionInfo({ current: '1.16.0', force: true, fetchImpl });
  assert.equal(first.source, 'tcr');
  const before = count;
  await versionInfo({ current: '1.16.0', fetchImpl });
  assert.equal(count, before, '成功结果 6h 内走缓存');

  resetVersionCache();
  count = 0;
  const failImpl = async () => {
    count += 1;
    throw err(500, 'all down');
  };
  const failed = await versionInfo({ current: '1.16.0', force: true, fetchImpl: failImpl });
  assert.equal(failed.latest, null);
  const before2 = count;
  await versionInfo({ current: '1.16.0', fetchImpl: failImpl });
  assert.equal(count, before2, '全失败结果 10min 内也走缓存，避免每次刷新都重打');
});

test('AE：fetchRegistryLatest——非 X.Y.Z 的 tag 全被过滤（latest/sha/两段版本）', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/service/token')) return jsonResponse({ token: 't' });
    if (url.includes('/tags/list')) return jsonResponse({ tags: ['latest', '1.16', 'sha-abc', 'nightly', '2.1.0'] });
    throw err(500, 'x');
  };
  const latest = await fetchRegistryLatest('tcr', { fetchImpl });
  assert.equal(latest, '2.1.0');
});
