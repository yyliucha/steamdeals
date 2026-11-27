// 设置层：默认值、密钥加密、env 兜底/导入、初始化状态、事务。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import * as settings from '../src/settings.js';
import { channelsFromEnv } from '../src/notify.js';

const SECRET = 'test-secret-key-0123456789abcdef';

async function fresh() {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  await settings.ensureSettingsSchema(store);
  const { ensureEmailSchema } = await import('../src/email-auth.js');
  await ensureEmailSchema(store);
  settings.resetSettingsCache();
  const q = (sql, p) => store.query(sql, p);
  return { store, q };
}

test('设置定义完整：112 项、8 个密钥、关键分组都在', () => {
  assert.equal(settings.SETTINGS.length, 112, '… + CB publicUrl + CC 四源每轮条数 4 项 + CF 自动封禁策略 8 项 + CH 发现与推荐 8 项 + CA-5 手机跳转开关 1 项 + CO-3/C2 App 设备限流 2 项 + CO-1/A5 任务失败邮件告警 1 项 + CO-4/E4 入库告警阈值 2 项 + DR app.syncIntervalMin 1 项 + EI 同步区域 3 项 + EK appSyncProxy 1 项 + EN CSP 模式 1 项 + FK App 同步换源 3 项 + FV head/foot 注入 2 项 + FW heat 三项 + FW-2 切代理与速率闸门 5 项 + FW-3 403 预警节流 2 项');
  assert.equal(settings.SETTINGS.filter((d) => d.secret).length, 8);

test('FV：head/foot 注入设置项——text 类型、默认空、env 兜底、20KB 校验上限', () => {
  const head = settings.SETTING_MAP.get('site.headInjection');
  const foot = settings.SETTING_MAP.get('site.footInjection');
  assert.ok(head && foot, 'FV 批：site.headInjection / site.footInjection 已定义');
  for (const d of [head, foot]) {
    assert.equal(d.type, 'text', `${d.key} 是 text（后台多行输入框）`);
    assert.equal(d.group, 'site', `${d.key} 属 site 分组`);
    assert.equal(d.default, '', `${d.key} 默认空（无注入）`);
    assert.equal(d.section, 'site', `${d.key} 进「站点与内容」卡`);
    assert.equal(d.secret, false, `${d.key} 不是密钥（管理员可见回显）`);
  }
  assert.equal(head.env, 'SITE_HEAD_INJECTION', 'env 兜底 SITE_HEAD_INJECTION');
  assert.equal(foot.env, 'SITE_FOOT_INJECTION', 'env 兜底 SITE_FOOT_INJECTION');
  // 20KB 字节边界：恰好允许、超 1 字节拒绝；trim 两端空白、内部换行保留
  const ok = 'a'.repeat(settings.HEAD_FOOT_INJECTION_MAX_BYTES);
  assert.deepEqual(settings.validateSetting(head, ok), { ok: true, value: ok }, '恰好 20KB 允许');
  assert.equal(settings.validateSetting(head, ok + 'a').ok, false, '超 20KB 拒绝');
  assert.deepEqual(
    settings.validateSetting(foot, '  <script src="x"></script>\n'),
    { ok: true, value: '<script src="x"></script>' },
    'trim 两端空白、内部换行保留',
  );
});
  const appSync = settings.SETTINGS.find((d) => d.key === 'app.syncIntervalMin');
  assert.ok(appSync, 'DR 批：app.syncIntervalMin 设置项存在');
  assert.equal(appSync.default, 15, 'DR 批：App Release 同步间隔默认 15 分钟（原 60）');
  assert.equal(appSync.env, 'APP_RELEASE_SYNC_INTERVAL_MIN', 'env 兜底保留 APP_RELEASE_SYNC_INTERVAL_MIN');
  const tz = settings.SETTINGS.find((d) => d.key === 'system.timezone');
  assert.ok(tz, '要有 system.timezone（时区设置化）');
  assert.equal(tz.default, 'Asia/Shanghai');
  assert.equal(tz.env, 'TZ');
  const keys = settings.SETTINGS.map((d) => d.key);
  for (const key of [
    'sources.itad.apiKey',
    'sources.steam.enabled',
    'sources.gog.regions',
    'alerts.smtp.host',
    'alerts.emailTo',
    'alerts.jobFailureEmail',
    'alerts.ingestAlertMin',
    'alerts.ingestAlertPct',
    'network.steamProxy',
    'network.appSyncProxy',
    'network.appSyncSource',
    'network.appSyncCosBase',
    'network.appSyncFallbackGithub',
    'system.circuitThreshold',
    'system.logLevel',
    'site.adultDisplay',
    'steamStatus.rateMs',
    'steamStatus.limit',
    'steamStatus.intervalMin',
    'steamStatus.initialDelaySec',
    'system.backupEnabled',
  ]) {
    assert.ok(keys.includes(key), `缺少 ${key}`);
  }
  // FR 批（docs/BACKUP-AS-FEATURE.md §2.3）：backupEnabled 语义改为「允许后台手动备份」默认 false
  // ——backup 已移出调度任务，默认不自动；关闭时后台「立即备份」按钮禁用 + POST 403。
  const backupSwitch = settings.SETTINGS.find((d) => d.key === 'system.backupEnabled');
  assert.equal(backupSwitch.default, false, 'FR：允许后台手动备份默认关闭（原每日备份默认开）');
  assert.match(backupSwitch.label, /允许后台手动备份/, 'FR：label 改为「允许后台手动备份」');
  assert.equal(backupSwitch.env, 'BACKUP_ENABLED', 'env 兜底名保留 BACKUP_ENABLED（老 .env 兼容）');
  assert.equal(new Set(keys).size, keys.length, 'key 不能重复');
  // EI 批（docs/STEAM-SYNC-STATUS-AND-RATING.md §11）：双区域三项——内容默认 us、本位币默认 cn/CNY
  const contentRegion = settings.SETTINGS.find((d) => d.key === 'sync.contentRegion');
  assert.ok(contentRegion, 'EI：sync.contentRegion 设置项存在');
  assert.equal(contentRegion.default, 'us', 'EI：内容采集区域默认 us（绕过国区商店隐藏）');
  assert.equal(contentRegion.env, 'SYNC_CONTENT_REGION', 'env 兜底 SYNC_CONTENT_REGION');
  const baseRegion = settings.SETTINGS.find((d) => d.key === 'site.baseRegion');
  assert.ok(baseRegion, 'EI：site.baseRegion 设置项存在');
  assert.equal(baseRegion.default, 'cn', 'EI：本位币区域默认 cn（国区报价是业务核心）');
  assert.equal(baseRegion.env, 'SITE_BASE_REGION', 'env 兜底 SITE_BASE_REGION');
  const baseCurrency = settings.SETTINGS.find((d) => d.key === 'site.baseCurrency');
  assert.ok(baseCurrency, 'EI：site.baseCurrency 设置项存在');
  assert.equal(baseCurrency.default, 'CNY', 'EI：本位币货币默认 CNY');
  assert.equal(baseCurrency.env, 'SITE_BASE_CURRENCY', 'env 兜底 SITE_BASE_CURRENCY');
  // EK 批（docs/APP-RELEASE-SYNC-PROXY.md §4）：App Release 同步专用代理——secret 加密存储、
  // 网络组自动渲染（不触发 demo 硬规则）、默认留空 = 直连 GitHub。
  const appSyncProxy = settings.SETTINGS.find((d) => d.key === 'network.appSyncProxy');
  assert.ok(appSyncProxy, 'EK：network.appSyncProxy 设置项存在');
  assert.equal(appSyncProxy.type, 'secret', 'EK：代理地址是 secret（app_settings.secret_enc 加密存储）');
  assert.equal(appSyncProxy.group, 'network', 'EK：网络组由 def 自动渲染');
  assert.equal(appSyncProxy.default, '', 'EK：默认留空 = 直连');
  assert.equal(appSyncProxy.env, 'APP_RELEASE_SYNC_PROXY', 'env 兜底 APP_RELEASE_SYNC_PROXY');
  // FK 批（docs/APP-SYNC-COS.md）：App 资产同步换源——来源 enum + COS 目录 + 回退开关，
  // 都在 network 平铺组内（schema 驱动自动渲染，无需前端改动）。
  const appSyncSource = settings.SETTINGS.find((d) => d.key === 'network.appSyncSource');
  assert.ok(appSyncSource, 'FK：network.appSyncSource 设置项存在');
  assert.equal(appSyncSource.type, 'enum', 'FK：来源是 enum');
  assert.deepEqual(appSyncSource.options, ['github', 'cos'], 'FK：只允许 github/cos 两源');
  assert.equal(appSyncSource.default, 'github', 'FK：默认仍走 GitHub（换源由所有者显式开启）');
  assert.equal(appSyncSource.env, 'APP_RELEASE_SYNC_SOURCE', 'FK：env 兜底 APP_RELEASE_SYNC_SOURCE');
  assert.equal(appSyncSource.group, 'network', 'FK：网络与代理组（平铺）自动渲染');
  const cosBase = settings.SETTINGS.find((d) => d.key === 'network.appSyncCosBase');
  assert.ok(cosBase, 'FK：network.appSyncCosBase 设置项存在');
  assert.equal(cosBase.type, 'string', 'FK：COS 目录是普通字符串（非密钥，域名不含凭据）');
  assert.equal(cosBase.default, '', 'FK：默认留空（切 cos 后必须填）');
  assert.equal(cosBase.env, 'APP_RELEASE_SYNC_COS_BASE');
  assert.equal(cosBase.group, 'network');
  const fallbackGithub = settings.SETTINGS.find((d) => d.key === 'network.appSyncFallbackGithub');
  assert.ok(fallbackGithub, 'FK：network.appSyncFallbackGithub 设置项存在');
  assert.equal(fallbackGithub.type, 'bool', 'FK：回退开关是布尔');
  assert.equal(fallbackGithub.default, true, 'FK：默认开启自动回退（规格 §2）');
  assert.equal(fallbackGithub.env, 'APP_RELEASE_SYNC_FALLBACK');
  assert.equal(fallbackGithub.group, 'network');
  const jobFailure = settings.SETTINGS.find((d) => d.key === 'alerts.jobFailureEmail');
  assert.equal(jobFailure.type, 'bool', '任务失败邮件告警是布尔开关');
  assert.equal(jobFailure.default, false, 'CO-1/A5：默认关闭，不新增 SMTP 依赖');
  assert.equal(jobFailure.env, 'ALERTS_JOB_FAILURE_EMAIL');
  const ingestAlertMin = settings.SETTINGS.find((d) => d.key === 'alerts.ingestAlertMin');
  assert.equal(ingestAlertMin.default, 5, 'CO-4/E4：入库告警最少条数默认 5');
  assert.equal(ingestAlertMin.env, 'ALERTS_INGEST_ALERT_MIN');
  const ingestAlertPct = settings.SETTINGS.find((d) => d.key === 'alerts.ingestAlertPct');
  assert.equal(ingestAlertPct.default, 50, 'CO-4/E4：入库告警占比默认 50%');
  assert.equal(ingestAlertPct.env, 'ALERTS_INGEST_ALERT_PCT');
  const adult = settings.SETTINGS.find((d) => d.key === 'site.adultDisplay');
  assert.deepEqual(adult.options, ['hide', 'badge', 'show'], '成人内容策略三档');
  const ssl = settings.SETTINGS.find((d) => d.key === 'steamStatus.limit');
  assert.equal(ssl.default, 20000, 'FP 批：steam-status 每轮默认 20000（20 万目录约 10 天一轮，env 可配 3–5 万）');
  const ssi = settings.SETTINGS.find((d) => d.key === 'steamStatus.intervalMin');
  assert.equal(ssi.default, 1440, 'steam-status 默认每天一轮（X 批：原每周）');
  const ssd = settings.SETTINGS.find((d) => d.key === 'steamStatus.initialDelaySec');
  assert.equal(ssd.default, 600, 'steam-status 首轮延迟默认 600 秒（Y 批并入 AB）');
  assert.equal(ssd.env, 'STEAM_STATUS_INITIAL_DELAY_SEC');
});

test('FW-2：403/429 切代理 + 全站速率闸门 5 项——默认值/范围/env/进「调度与熔断」折叠区', () => {
  const expect = [
    ['sync.rotateOn403', 'SYNC_ROTATE_ON_403', 'bool', true, undefined, undefined, '403 切代理默认开（可回滚 AM-1）'],
    ['sync.rotateOn429', 'SYNC_ROTATE_ON_429', 'bool', true, undefined, undefined, '429 切代理默认开（总量不增）'],
    ['sync.rateGatePerMin', 'SYNC_RATE_GATE_PER_MIN', 'int', 30, 1, 40, '闸门 30 次/分钟（硬上限 40 留 25% 余量）'],
    ['sync.rotateMaxPerRequest', 'SYNC_ROTATE_MAX_PER_REQUEST', 'int', 3, 1, 10, '每请求最多 3 条代理'],
    ['sync.rateMaxWaitMs', 'SYNC_RATE_MAX_WAIT_MS', 'int', 300000, 0, 3600000, '闸门等待上限 5 分钟'],
  ];
  const keys = settings.SETTINGS.map((d) => d.key);
  for (const [key, env, type, def, min, max, why] of expect) {
    const d = settings.SETTING_MAP.get(key);
    assert.ok(d, `FW-2：${key} 设置项存在`);
    assert.equal(keys.filter((k) => k === key).length, 1, `${key} 不能重复`);
    assert.equal(d.env, env, `${key} env 兜底 ${env}`);
    assert.equal(d.type, type, `${key} 类型`);
    assert.equal(d.default, def, `${why}`);
    if (type === 'int') {
      assert.equal(d.min, min, `${key} 下限`);
      assert.equal(d.max, max, `${key} 上限`);
      assert.deepEqual(settings.validateSetting(d, String(def)), { ok: true, value: def }, `${key} 默认值合法`);
      assert.equal(settings.validateSetting(d, min - 1).ok, false, `${key} 低于下限拒绝`);
      assert.equal(settings.validateSetting(d, max + 1).ok, false, `${key} 高于上限拒绝`);
    } else {
      assert.equal(settings.validateSetting(d, '1').ok, false, 'bool 只收 true/false（与既有 bool 项一致）');
      assert.deepEqual(settings.validateSetting(d, false), { ok: true, value: false }, `${key} 可关闭（回滚开关）`);
    }
    assert.equal(d.group, 'schedule', `${key} 归「同步与调度」分组（FY-1 分组重划）`);
    assert.equal(d.section, 'schedule', `${key} 进「调度与熔断」卡（与 system.circuitThreshold 同区）`);
    assert.equal(d.tier, 'advanced', `${key} 进折叠区（该卡常用项会超 3，按 CQ 规则）`);
    assert.ok(d.help && d.help.length > 10, `${key} 有面向管理员的说明`);
  }
  // 与既有 setting 的 env 不冲突（水合覆盖会串值）
  const envs = settings.SETTINGS.map((d) => d.env);
  for (const [, env] of expect) assert.equal(envs.filter((e) => e === env).length, 1, `${env} env 不能重复`);
});

// FW-3（docs/SLOW-SYNC.md §1.3 决策 16、§5、§8 验收 6）：403 预警节流两项——与 FW-2 五项同卡折叠区。
test('FW-3：403 预警节流 2 项——默认 3 次 / 60 分钟、范围、env、进「调度与熔断」折叠区', () => {
  const expect = [
    ['sync.forbiddenAlertThreshold', 'SYNC_FORBIDDEN_ALERT_THRESHOLD', 3, 1, 50, '连续 3 次 403 才发预警'],
    ['sync.forbiddenAlertWindowMin', 'SYNC_FORBIDDEN_ALERT_WINDOW_MIN', 60, 10, 1440, '两次预警间隔 60 分钟'],
  ];
  const keys = settings.SETTINGS.map((d) => d.key);
  const envs = settings.SETTINGS.map((d) => d.env);
  for (const [key, env, def, min, max, why] of expect) {
    const d = settings.SETTING_MAP.get(key);
    assert.ok(d, `FW-3：${key} 设置项存在`);
    assert.equal(keys.filter((k) => k === key).length, 1, `${key} 不能重复`);
    assert.equal(d.env, env, `${key} env 兜底 ${env}`);
    assert.equal(d.type, 'int', `${key} 类型`);
    assert.equal(d.default, def, why);
    assert.equal(d.min, min, `${key} 下限`);
    assert.equal(d.max, max, `${key} 上限`);
    assert.deepEqual(settings.validateSetting(d, String(def)), { ok: true, value: def }, `${key} 默认值合法`);
    assert.equal(settings.validateSetting(d, min - 1).ok, false, `${key} 低于下限拒绝`);
    assert.equal(settings.validateSetting(d, max + 1).ok, false, `${key} 高于上限拒绝`);
    assert.equal(d.group, 'schedule', `${key} 归「同步与调度」分组（FY-1 分组重划）`);
    assert.equal(d.section, 'schedule', `${key} 进「调度与熔断」卡（与 FW-2 五项同区）`);
    assert.equal(d.tier, 'advanced', `${key} 进折叠区（CQ：每卡常用 ≤3）`);
    assert.ok(d.help && d.help.length > 10, `${key} 有面向管理员的说明`);
    assert.equal(envs.filter((e) => e === env).length, 1, `${env} env 不能重复`);
  }
});

test('EI 批：区域/货币设置校验归一化（区域两字母小写、货币三字母大写）', () => {
  assert.deepEqual(settings.validateSetting(settings.SETTING_MAP.get('sync.contentRegion'), ' US '), { ok: true, value: 'us' });
  assert.deepEqual(settings.validateSetting(settings.SETTING_MAP.get('site.baseRegion'), 'CN'), { ok: true, value: 'cn' });
  assert.deepEqual(settings.validateSetting(settings.SETTING_MAP.get('site.baseCurrency'), ' usd '), { ok: true, value: 'USD' });
  assert.equal(settings.validateSetting(settings.SETTING_MAP.get('sync.contentRegion'), 'usa').ok, false, '非法区域码拒绝');
  assert.equal(settings.validateSetting(settings.SETTING_MAP.get('site.baseRegion'), 'c1').ok, false, '非字母区域码拒绝');
  assert.equal(settings.validateSetting(settings.SETTING_MAP.get('site.baseCurrency'), 'CN').ok, false, '非法货币码拒绝');
});

test('EK 批：App 同步专用代理校验（仅 http/https，合法值归一化，留空直连）', () => {
  const d = settings.SETTING_MAP.get('network.appSyncProxy');
  assert.deepEqual(settings.validateSetting(d, 'http://steam-proxy:8888/'), { ok: true, value: 'http://steam-proxy:8888' }, '合法 http 代理归一化（去尾部斜杠）');
  assert.deepEqual(settings.validateSetting(d, 'https://user:pw@proxy.example.com'), { ok: true, value: 'https://user:pw@proxy.example.com' }, '合法 https 代理（含凭据）通过');
  assert.equal(settings.validateSetting(d, 'socks5://127.0.0.1:1080').ok, false, 'socks5 拒绝（仅支持 http/https）');
  assert.equal(settings.validateSetting(d, 'not a url').ok, false, '非法地址拒绝');
  assert.deepEqual(settings.validateSetting(d, 'steam-proxy:8888'), { ok: true, value: 'http://steam-proxy:8888' }, '无协议自动补 http://（parseProxy 既有语义）');
  assert.deepEqual(settings.validateSetting(d, ''), { ok: true, value: '' }, '留空 = 直连');
});

test('FK 批：COS 目录校验（仅 http/https、去末尾斜杠、拒绝查询串）', () => {
  const d = settings.SETTING_MAP.get('network.appSyncCosBase');
  assert.deepEqual(
    settings.validateSetting(d, 'https://bucket.cos.ap-guangzhou.myqcloud.com/steamdeals-app/'),
    { ok: true, value: 'https://bucket.cos.ap-guangzhou.myqcloud.com/steamdeals-app' },
    '合法 https 归一化（去末尾斜杠，拼接不出现 //latest.json）',
  );
  assert.deepEqual(settings.validateSetting(d, ''), { ok: true, value: '' }, '留空允许（运行期报 cos_no_base）');
  assert.equal(settings.validateSetting(d, 'bucket.cos.ap-guangzhou.myqcloud.com/steamdeals-app').ok, false, '缺协议拒绝（不自动补 http——COS 一律 https）');
  assert.equal(settings.validateSetting(d, 'ftp://bucket/steamdeals-app').ok, false, '仅 http/https');
  assert.equal(settings.validateSetting(d, 'https://bucket/steamdeals-app?sign=abc').ok, false, '带查询串拒绝（签名不进设置/日志）');
});

test('默认值 + 密钥加密：库里不存明文，公开接口只给 hasValue', async () => {
  const { store, q } = await fresh();
  try {
    const defaults = await settings.readSettings(q, { env: {}, secretKey: SECRET });
    assert.equal(defaults.values['sources.steam.enabled'], true);
    assert.equal(defaults.values['sources.itad.apiKey'], '');
    assert.equal(defaults.values['system.chartOnSync'], false);
    assert.equal(defaults.sources['sources.itad.apiKey'], 'default');

    const saved = await settings.saveSettings(
      q,
      {
        'sources.itad.apiKey': 'itad-key-123456',
        'sources.steam.enabled': false,
        'sources.gog.regions': 'cn,us',
        'alerts.emailTo': 'A@b.com, c@d.com',
      },
      { secretKey: SECRET, updatedBy: 'tester' },
    );
    assert.equal(saved.changed, true);
    assert.ok(saved.revision >= 1);

    const raw = await q("select key, value, secret_enc from app_settings where key = 'sources.itad.apiKey'");
    assert.equal(raw.rows[0].value, null, '密钥不能以 jsonb 明文落库');
    assert.ok(raw.rows[0].secret_enc, '密钥应加密存储');

    const publicView = await settings.getPublicSettings(q, { secretKey: SECRET });
    assert.equal(publicView.values['sources.itad.apiKey'], '');
    assert.equal(publicView.secrets['sources.itad.apiKey'].hasValue, true);
    assert.equal(publicView.values['sources.steam.enabled'], false);
    assert.equal(publicView.values['sources.gog.regions'], 'cn,us');
    assert.equal(publicView.values['alerts.emailTo'], 'a@b.com,c@d.com');

    const read = await settings.readSettings(q, { secretKey: SECRET });
    assert.equal(read.values['sources.itad.apiKey'], 'itad-key-123456');
    assert.equal(read.sources['sources.itad.apiKey'], 'database');
  } finally {
    await store.close();
  }
});

test('环境变量兜底：DB 未写入时读 env，写入后 DB 优先', async () => {
  const { store, q } = await fresh();
  try {
    const env = { ITAD_API_KEY: 'env-key-12345678', STEAM_ENABLED: '0', GOG_REGIONS: 'cn,jp' };
    const before = await settings.readSettings(q, { env, secretKey: SECRET });
    assert.equal(before.values['sources.itad.apiKey'], 'env-key-12345678');
    assert.equal(before.values['sources.steam.enabled'], false);
    assert.equal(before.sources['sources.itad.apiKey'], 'env');
    assert.equal(before.sources['sources.steam.enabled'], 'env');

    await settings.saveSettings(q, { 'sources.itad.apiKey': 'db-key-12345678' }, { env, secretKey: SECRET });
    const after = await settings.readSettings(q, { env, secretKey: SECRET });
    assert.equal(after.values['sources.itad.apiKey'], 'db-key-12345678');
    assert.equal(after.sources['sources.itad.apiKey'], 'database');
    assert.equal(after.values['sources.steam.enabled'], false, '未落库的项仍用 env');
  } finally {
    await store.close();
  }
});

test('水合：把库值写回 env，SMTP 关闭时清空 SMTP_HOST', async () => {
  const { store, q } = await fresh();
  try {
    await settings.saveSettings(
      q,
      {
        'sources.steam.enabled': false,
        'sources.gog.regions': 'us',
        'alerts.emailTo': 'x@y.com',
        'alerts.jobFailureEmail': true,
        'alerts.smtp.host': 'smtp.example.com',
        'alerts.smtp.user': 'u@example.com',
        'alerts.smtp.pass': 'pass-123456',
        'steamStatus.initialDelaySec': 1800,
      },
      { env: {}, secretKey: SECRET },
    );
    const env = { SMTP_HOST: 'old.example.com', SMTP_USER: 'old', SMTP_PASS: 'old', SECRET_KEY: SECRET };
    await settings.hydrateSettings({ store, env, secretKey: SECRET });
    assert.equal(env.STEAM_ENABLED, '0');
    assert.equal(env.GOG_REGIONS, 'us');
    assert.equal(env.ALERT_EMAIL_TO, 'x@y.com');
    assert.equal(env.ALERTS_JOB_FAILURE_EMAIL, '1', 'CO-1/A5：任务失败邮件告警水合成 1（开）');
    assert.equal(env.SMTP_HOST, 'smtp.example.com');
    assert.equal(env.SMTP_USER, 'u@example.com');
    assert.equal(env.SMTP_PASS, 'pass-123456');
    assert.equal(env.SMTP_FROM, 'u@example.com', '发件人留空回退到账号');
    assert.equal(env.STEAM_STATUS_INITIAL_DELAY_SEC, '1800', 'AB 批：steamStatus.initialDelaySec 落库后水合到 env（Y 批）');
  } finally {
    await store.close();
  }
});

test('初始化状态：没有管理员时未完成；已有管理员时自动迁移完成', async () => {
  const { store, q } = await fresh();
  try {
    const env = { DATABASE_URL: 'pglite:', ITAD_API_KEY: 'legacy-key-123456' };
    const first = await settings.initializeSettings({ store, env: { ...env }, secretKey: SECRET });
    assert.equal(first.completed, false);
    assert.equal(first.migrated, false);
    assert.equal(await settings.isSetupComplete(q, { fresh: true }), false);

    await db.createUser(q, { username: 'admin', password: 'admin123456', role: 'admin' });
    settings.resetSettingsCache();
    const second = await settings.initializeSettings({ store, env: { ...env }, secretKey: SECRET });
    assert.equal(second.completed, true);
    assert.equal(second.migrated, true);
    assert.equal(await settings.isSetupComplete(q, { fresh: true }), true);
    const info = await settings.setupInfo(q);
    assert.equal(info.completedBy, 'migration:existing_admin');

    const read = await settings.readSettings(q, { env: {}, secretKey: SECRET });
    assert.equal(read.values['sources.itad.apiKey'], 'legacy-key-123456');
    assert.equal(read.sources['sources.itad.apiKey'], 'database', '老 .env 应导入数据库');
  } finally {
    await store.close();
  }
});

test('SMTP 特殊存储：写 smtp_settings，不写 app_settings', async () => {
  const { store, q } = await fresh();
  try {
    await settings.saveSettings(
      q,
      {
        'alerts.smtp.host': 'smtp.qq.com',
        'alerts.smtp.port': 465,
        'alerts.smtp.secure': true,
        'alerts.smtp.user': 'u@qq.com',
        'alerts.smtp.pass': 'auth-code',
        'alerts.smtp.from': 'u@qq.com',
      },
      { env: {}, secretKey: SECRET },
    );
    const row = (await q('select host, port, secure, username, password_enc, from_addr, enabled from smtp_settings where id = 1')).rows[0];
    assert.equal(row.host, 'smtp.qq.com');
    assert.equal(row.enabled, true);
    assert.ok(row.password_enc);
    const plain = await q("select count(*)::int as n from app_settings where key like 'alerts.smtp.%'");
    assert.equal(plain.rows[0].n, 0, 'SMTP 不应重复写 app_settings');

    const read = await settings.readSettings(q, { env: {}, secretKey: SECRET });
    assert.equal(read.smtp.enabled, true);
    assert.equal(read.smtp.pass, 'auth-code');
    assert.equal(read.values['alerts.smtp.pass'], 'auth-code');
  } finally {
    await store.close();
  }
});

test('SMTP 落库后水合：alerts 能识别邮件通道；停用后不再识别', async () => {
  const { store, q } = await fresh();
  try {
    await settings.saveSettings(
      q,
      {
        'alerts.smtp.host': 'smtp.example.com',
        'alerts.smtp.user': 'u@example.com',
        'alerts.smtp.pass': 'auth-code',
        'alerts.emailTo': 'a@example.com',
      },
      { env: {}, secretKey: SECRET },
    );
    const env = {};
    await settings.hydrateSettings({ store, env, secretKey: SECRET });
    const channels = channelsFromEnv(env);
    assert.equal(channels.length, 1);
    assert.equal(channels[0].kind, 'email');
    assert.equal(channels[0].pass, 'auth-code');

    // 清空 host = 停用邮件；水合必须把 env 里的 SMTP_HOST 清掉，否则 alerts 会误判
    await settings.saveSettings(q, { 'alerts.smtp.host': '' }, { env: {}, secretKey: SECRET });
    await settings.hydrateSettings({ store, env, secretKey: SECRET });
    assert.equal(channelsFromEnv(env).length, 0);
    assert.equal(env.SMTP_HOST, '');
  } finally {
    await store.close();
  }
});

test('事务：回调抛错时整体回滚', async () => {
  const { store, q } = await fresh();
  try {
    await assert.rejects(
      store.tx(async (tx) => {
        await tx("insert into app_meta (key, value) values ('tx.rollback', '1')");
        throw new Error('boom');
      }),
      /boom/,
    );
    const row = await q("select value from app_meta where key = 'tx.rollback'");
    assert.equal(row.rows.length, 0);
  } finally {
    await store.close();
  }
});

// ---------------------------------------------------------------- CQ 批（docs/SETTINGS-IA.md）

test('CQ meta：sources/site/schedule/ops 全有 section+tier；6 张平台卡每卡常用 ≤3；高级拆分后 3 个折叠组', () => {
  const byGroup = {};
  for (const d of settings.SETTINGS) (byGroup[d.group] = byGroup[d.group] || []).push(d);
  // FY-1：原「高级」拆成 schedule（同步与调度）+ ops（运维与存储），两者仍全走卡片渲染 → 必须有 section+tier
  for (const g of ['sources', 'site', 'schedule', 'ops']) {
    for (const d of byGroup[g]) {
      assert.ok(d.section, `${d.key} 缺 section`);
      assert.ok(['primary', 'advanced'].includes(d.tier), `${d.key} tier 非法`);
    }
  }
  const sections = settings.SETTINGS_SECTIONS;
  const src = sections.filter((s) => s.group === 'sources');
  assert.equal(src.length, 7, '6 张平台卡 + 1 张同步区域卡（EI 批）');
  assert.deepEqual(src.map((s) => s.id), ['global', 'steam', 'sonkwo', 'itad', 'gog-humble', 'discovery', 'sync-region'], '卡序（全局/Steam/杉果/ITAD/GOG+Humble/发现与热度/同步区域）');
  for (const s of src) {
    const prim = byGroup.sources.filter((d) => d.section === s.id && d.tier !== 'advanced');
    const rows = s.compact ? Math.ceil(prim.length / s.compact) : prim.length;
    assert.ok(rows <= 3, `${s.id} 常用 ${rows} 行 > 3（验收：每卡常用 ≤3 项）`);
  }
  // EI 批（docs/STEAM-SYNC-STATUS-AND-RATING.md §11）：同步区域卡跨组 keys——
  // 三项一起展示（内容区 + 本位币区域/货币），site 组字段进卡靠显式 keys
  const syncRegion = src.find((s) => s.id === 'sync-region');
  assert.deepEqual(syncRegion.keys, ['sync.contentRegion', 'site.baseRegion', 'site.baseCurrency'], '同步区域卡三项');
  assert.equal(settings.SETTING_MAP.get('site.baseRegion').section, 'sync-region', 'site.baseRegion 展示归同步区域卡');
  assert.equal(settings.SETTING_MAP.get('site.baseCurrency').section, 'sync-region', 'site.baseCurrency 展示归同步区域卡');
  // FY-1（docs/SETTINGS-REDESIGN.md §2）：原「高级 · 4 折叠组」拆到两个对象组——
  // schedule 组只有「调度与熔断」卡；ops 组是「备份与日志 + 缓存与图片」；「时区与显示」卡删除
  // （system.timezone 归 site，已在上面「站点与内容」卡的 keys 里，避免同一个 key 跨两组重复渲染）。
  const sched = sections.filter((s) => s.group === 'schedule');
  assert.deepEqual(sched.map((s) => s.id), ['schedule'], '同步与调度组只有调度与熔断卡');
  const ops = sections.filter((s) => s.group === 'ops');
  assert.deepEqual(ops.map((s) => s.id), ['backup', 'cache'], '运维与存储组 = 备份与日志 + 缓存与图片');
  assert.ok(!sections.some((s) => s.id === 'timezone'), '「时区与显示」重复分区已删除');
  assert.equal(settings.SETTING_MAP.get('system.timezone').group, 'site', '时区归「站点与外观」组');
  assert.equal(settings.SETTING_MAP.get('system.timezone').section, 'site', '时区展示在「站点与内容」卡');
  const site = sections.find((s) => s.group === 'site' && s.id === 'site');
  assert.equal(site.keys.length, 6, '站点常用 6 项（FV 批 head/foot 注入 2 项）');
  assert.ok(site.keys.includes('system.timezone'), '时区在站点常用（§2.3）');
  assert.ok(site.keys.includes('site.headInjection') && site.keys.includes('site.footInjection'), 'FV：head/foot 注入在站点常用');
  const recommend = sections.find((s) => s.group === 'site' && s.id === 'recommend');
  assert.ok(recommend, '推荐与评分折叠存在');
  // 质检打回项：推荐与评分折叠 4 项（口味权重进折叠），行为开关放卡体常用
  const recAdv = byGroup.site.filter((d) => d.section === 'recommend' && d.tier === 'advanced');
  assert.equal(recAdv.length, 4, '推荐与评分折叠 4 项');
  assert.ok(recAdv.some((d) => d.key === 'personal.tasteWeight'), '口味权重在折叠内');
  assert.equal(settings.SETTING_MAP.get('personal.behaviorLogEnabled').tier, 'primary', '行为开关在折叠外');
});

// FY-1（docs/SETTINGS-REDESIGN.md §2 / §5）：分组重划迁移断言——7 个「对象」组，SETTINGS 每一项
// 恰好落进一组（不重不漏），旧组 id（auth/security/advanced）清零，分区注册表全部挂到新组。
// 反向自检：把任一 def() 的 group 改回 'advanced'（或把某张卡挂回旧组）→ 本用例必红。
test('FY-1 分组重划：7 个对象组、112 项每项恰好一组（不重不漏）、旧 auth/security/advanced 清零', async () => {
  const GROUP_IDS = ['sources', 'site', 'access', 'alerts', 'network', 'schedule', 'ops'];
  const groups = settings.GROUPS;
  assert.deepEqual(groups.map((g) => g.id), GROUP_IDS, '7 组，顺序 = 左导航顺序（demo §3.2）');
  assert.deepEqual(
    groups.map((g) => g.title),
    ['数据源', '站点与外观', '账号与安全', '提醒与通知', '网络与代理', '同步与调度', '运维与存储'],
    '组名全部是「对象」维度，不再有「高级」',
  );
  for (const g of groups) {
    assert.ok(g.icon, `${g.id} 有左导航图标`);
    assert.ok(g.description && g.description.length >= 8, `${g.id} 有组描述文案`);
  }
  assert.equal(groups.find((g) => g.id === 'sources').description, '各采集平台的开关、间隔、API Key 与区服。', '「数据源」描述按规格/demo 文案');

  // ① 每个 key 恰好落一个组，且组 id 必须是新 7 组之一（旧组残留 = 漏改，设置页会渲染成空组）
  const owned = new Map();
  for (const d of settings.SETTINGS) {
    assert.ok(GROUP_IDS.includes(d.group), `${d.key} 的 group=${d.group} 不在新 7 组内（漏改）`);
    assert.ok(!owned.has(d.key), `${d.key} 重复定义`);
    owned.set(d.key, d.group);
  }
  assert.equal(owned.size, settings.SETTINGS.length, 'SETTINGS 无重复 key');
  const counts = {};
  for (const id of GROUP_IDS) counts[id] = settings.SETTINGS.filter((d) => d.group === id).length;
  // 迁移快照：以后新增设置项请同步更新本行（防漏归组；「邮件服务」页维护的 8 项也计入本组）
  assert.deepEqual(counts, { sources: 36, site: 15, access: 15, alerts: 16, network: 7, schedule: 12, ops: 11 }, '各组项数快照');
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), 112, '不丢项');

  // ② 旧组 id 三处注册表全部清零
  const legacy = new Set(['auth', 'security', 'advanced']);
  assert.deepEqual(groups.filter((g) => legacy.has(g.id)), [], 'GROUPS 无旧组');
  assert.deepEqual(settings.SETTINGS_SECTIONS.filter((s) => legacy.has(s.group)), [], 'SETTINGS_SECTIONS 无旧组');
  assert.deepEqual([...settings.PLAIN_GROUPS].filter((g) => legacy.has(g)), [], 'PLAIN_GROUPS 无旧组');
  assert.deepEqual([...settings.PLAIN_GROUPS].sort(), ['access', 'alerts', 'network'], '平铺组 = 账号与安全 / 提醒与通知 / 网络与代理');

  // ③ 合并与拆分逐项核对（只改展示归属，key 一个不少）
  assert.equal(settings.SETTINGS.filter((d) => d.group === 'access').length, 15, '账号与安全 = 原账号与登录 4 + 安全与限流 11');
  for (const key of ['auth.registrationEnabled', 'auth.sessionBindUa', 'security.rateLimit.pageMax', 'security.autoBan.mode', 'security.csp.mode']) {
    assert.equal(settings.SETTING_MAP.get(key).group, 'access', `${key} 归账号与安全`);
  }
  for (const key of ['app.syncIntervalMin', 'system.circuitThreshold', 'system.circuitCooldownMin', 'system.chartOnSync', 'system.backupEnabled', 'sync.rotateOn403', 'sync.rotateOn429', 'sync.rateGatePerMin', 'sync.rotateMaxPerRequest', 'sync.rateMaxWaitMs', 'sync.forbiddenAlertThreshold', 'sync.forbiddenAlertWindowMin']) {
    assert.equal(settings.SETTING_MAP.get(key).group, 'schedule', `${key} 归同步与调度`);
  }
  for (const key of ['system.backupIntervalMin', 'system.backupInitialDelaySec', 'system.logsPruneEnabled', 'system.logsPruneDays', 'system.logLevel', 'images.enabled', 'images.intervalMin', 'images.initialDelaySec', 'images.limit', 'images.sleepMs', 'images.maxBytes']) {
    assert.equal(settings.SETTING_MAP.get(key).group, 'ops', `${key} 归运维与存储`);
  }

  // ④ 分区注册表 ↔ SETTINGS 双向一致：section 都挂新组、每个 section 至少渲染 1 项、
  //    key 没有被两张卡同时渲染（不重不漏的渲染口径）。
  const sectionIds = new Set(settings.SETTINGS_SECTIONS.map((s) => s.id));
  assert.equal(sectionIds.size, settings.SETTINGS_SECTIONS.length, 'section id 不重复');
  for (const s of settings.SETTINGS_SECTIONS) {
    assert.ok(GROUP_IDS.includes(s.group), `分区 ${s.id} 挂在旧组 ${s.group}`);
    const fields = s.keys
      ? s.keys.map((k) => settings.SETTING_MAP.get(k)).filter(Boolean)
      : settings.SETTINGS.filter((d) => d.section === s.id);
    assert.ok(fields.length > 0, `分区 ${s.id} 没有任何字段（空卡）`);
    if (s.keys) assert.equal(fields.length, s.keys.length, `分区 ${s.id} 的 keys 有未定义 key`);
  }
  const cardOf = new Map();
  for (const s of settings.SETTINGS_SECTIONS) {
    const keys = s.keys ?? settings.SETTINGS.filter((d) => d.section === s.id).map((d) => d.key);
    for (const key of keys) {
      assert.ok(!cardOf.has(key), `${key} 同时出现在分区 ${cardOf.get(key)} 与 ${s.id}（重复渲染）`);
      cardOf.set(key, s.id);
    }
  }
  for (const d of settings.SETTINGS) {
    if (d.section) assert.ok(sectionIds.has(d.section), `${d.key} 的 section=${d.section} 不在注册表中（会渲染不出）`);
    else assert.ok(settings.PLAIN_GROUPS.has(d.group), `${d.key} 无 section 但组 ${d.group} 不是平铺组（会渲染不出）`);
  }
  // ⑤ 可见项数（左导航项数徽标口径：不含「邮件服务」页维护的 8 项）——前端与后端共用同一份 key 清单
  const { MAIL_SETTING_KEYS, SETTINGS_GROUP_IDS, DEFAULT_SETTINGS_GROUP, isSettingsGroupId, ADVANCED_SETTINGS_GROUPS } = await import('../frontend/src/utils/settings.js');
  const visible = Object.fromEntries(GROUP_IDS.map((id) => [id, 0]));
  for (const d of settings.SETTINGS) if (!MAIL_SETTING_KEYS.includes(d.key)) visible[d.group] += 1;
  assert.deepEqual(visible, { sources: 36, site: 15, access: 15, alerts: 8, network: 7, schedule: 12, ops: 11 }, '左导航项数（邮件 8 项不在设置页）');

  // ⑥ 路由回落的行为锁：前端 id 白名单 = 服务端 7 组；未知组（含旧组 id / 空）一律非法 → 路由回落 sources
  assert.deepEqual(SETTINGS_GROUP_IDS, GROUP_IDS, '前端组 id 白名单与服务端 GROUPS 一一对应');
  assert.equal(DEFAULT_SETTINGS_GROUP, 'sources', '默认组 = sources');
  for (const id of GROUP_IDS) assert.equal(isSettingsGroupId(id), true, `${id} 是合法组`);
  for (const bad of ['advanced', 'auth', 'security', 'unknown', '', null, undefined]) {
    assert.equal(isSettingsGroupId(bad), false, `${String(bad)} 非法组（/console/settings/:group 回落 sources）`);
  }
  assert.deepEqual(ADVANCED_SETTINGS_GROUPS, ['schedule', 'ops'], '初始化向导继续跳过原「高级」拆分出的两组');
});

test('CQ isDefaultValue：int/bool/enum/string 类型敏感比较，null 视作默认', () => {
  const intD = settings.SETTING_MAP.get('sources.steam.priceIntervalMin');
  assert.equal(settings.isDefaultValue(intD, 1440), true);
  assert.equal(settings.isDefaultValue(intD, '1440'), true, '字符串数字与默认相等');
  assert.equal(settings.isDefaultValue(intD, 720), false);
  const boolD = settings.SETTING_MAP.get('sources.steam.enabled');
  assert.equal(settings.isDefaultValue(boolD, true), true);
  assert.equal(settings.isDefaultValue(boolD, null), true, 'null 视作默认');
  const enumD = settings.SETTING_MAP.get('site.adultDisplay');
  assert.equal(settings.isDefaultValue(enumD, 'hide'), true);
  assert.equal(settings.isDefaultValue(enumD, 'show'), false);
});

test('CQ schema 下发：sections/plainGroups/isDefault 随 /api/admin/settings 视图返回', async () => {
  const { store, q } = await fresh();
  try {
    await settings.saveSettings(q, { 'sources.steam.priceIntervalMin': 720, 'sources.gog.regions': 'us' }, { env: {}, secretKey: SECRET });
    const view = await settings.getPublicSettings(q, { secretKey: SECRET });
    assert.ok(Array.isArray(view.sections) && view.sections.length >= 12, '分区注册表下发');
    assert.ok(Array.isArray(view.plainGroups) && view.plainGroups.includes('alerts'), '平铺分组下发');
    assert.equal(view.isDefault['sources.steam.priceIntervalMin'], false, '改过的项非默认');
    assert.equal(view.isDefault['sources.gog.regions'], false, '改过的项非默认');
    assert.equal(view.isDefault['sources.sonkwo.intervalMin'], true, '未改过的项是默认');
    for (const f of view.fields) {
      assert.ok(f.section === null || typeof f.section === 'string', `${f.key} section 形状`);
      assert.ok(['primary', 'advanced'].includes(f.tier), `${f.key} tier 形状`);
    }
    const steamKey = view.fields.find((f) => f.key === 'sources.steam.apiKey');
    assert.equal(steamKey.section, 'steam');
    assert.equal(steamKey.tier, 'primary');
  } finally {
    await store.close();
  }
});

test('CQ 恢复默认：删库覆盖行后值=默认、来源回落 default（无 env 时）；修订号 +1', async () => {
  const { store, q } = await fresh();
  try {
    await settings.saveSettings(q, { 'sources.steam.priceIntervalMin': 720, 'site.adultDisplay': 'show' }, { env: {}, secretKey: SECRET });
    const before = await settings.readSettings(q, { env: {}, secretKey: SECRET });
    assert.equal(before.sources['sources.steam.priceIntervalMin'], 'database');
    const revBefore = await settings.getRevision(q);
    const r = await settings.restoreSettings(q, ['sources.steam.priceIntervalMin'], { updatedBy: 'tester' });
    assert.equal(r.restored, 1);
    const after = await settings.readSettings(q, { env: {}, secretKey: SECRET });
    assert.equal(after.values['sources.steam.priceIntervalMin'], 1440, '恢复后值=默认');
    assert.equal(after.sources['sources.steam.priceIntervalMin'], 'default', '来源回落默认');
    assert.equal(after.values['site.adultDisplay'], 'show', '未恢复的项不动');
    assert.ok(r.revision >= revBefore + 1, '修订号递增');
  } finally {
    await store.close();
  }
});

test('CQ 前端接线（静态）：只看非默认/折叠/恢复本组默认/卡头/搜索高亮都在 AdminModules.vue', () => {
  const admin = readFileSync(new URL('../frontend/src/pages/AdminModules.vue', import.meta.url), 'utf8');
  assert.match(admin, /只看非默认/, '只看非默认开关');
  assert.match(admin, /settings-only-changed/, '只看非默认 localStorage 记忆');
  assert.match(admin, /settings-fold-/, '折叠状态 localStorage 记忆');
  assert.match(admin, /恢复本组默认/, '分组级恢复默认');
  assert.match(admin, /恢复默认/, '行级恢复默认');
  assert.match(admin, /settings-card-head/, '平台卡头');
  assert.match(admin, /settings-fold/, '折叠行');
  assert.match(admin, /foldAutoOpen/, '搜索命中折叠项自动展开');
  assert.match(admin, /foldAutoOpenAll/, '搜索命中无高级字段的折叠组也自动展开（FL 修复）');
  assert.match(admin, /foldTitle \|\| entry\.sec\.title/, '折叠行标题回退到分组标题（FL 修复）');
  assert.match(admin, /else if\(prim\.length\)\{entries\.push/, '无高级字段的分组也生成折叠按钮与折叠体（FL 修复）');
  assert.match(admin, /else if\(prim\.length\)\{.*foldAutoOpenAll\(sec\)/, '无高级字段的分支用 foldAutoOpenAll 判定自动展开（命中常用项就展开，不误开高级折叠）');
  assert.match(admin, /kind:'foldBody',sec,fields:prim/, '无高级字段分组的折叠体用过滤后的 prim（字段不丢、只看非默认生效）');
  assert.match(admin, /fieldHit/, '搜索命中高亮');
  assert.match(admin, /api\/admin\/settings\/restore/, '恢复默认接口接线（二次确认在 restoreField/restoreSection）');
  assert.match(admin, /ElMessageBox\.confirm/, '恢复默认二次确认');
  const server = readFileSync(new URL('../src/settings-routes.js', import.meta.url), 'utf8');
  assert.match(server, /api\/admin\/settings\/restore/, '恢复接口路由');
  assert.match(server, /settings\.restored/, '恢复审计');
  // 质检打回项静态锁：只看非默认过滤折叠内项 / bool 摘要开·关 / 紧凑行每字段恢复入口
  assert.match(admin, /'开':'关'/, 'bool 摘要显示开/关而非 true/false');
  assert.match(admin, /kind:'foldBody',sec,fields:adv/, '折叠展开项与折叠计数同用过滤后的 adv（只看非默认生效）');
  assert.match(admin, /summaryFor\(sec,adv\)/, '折叠摘要按过滤后 adv 计算（与计数口径一致）');
  assert.match(admin, /↺/, '紧凑行每个字段都有恢复入口');
  assert.match(admin, /sources\.\$\{s\.id\}\.enabled/, '卡头开关取与分区同名的平台 enabled（杉果=sonkwo.enabled）');
  assert.match(admin, /s\.id==='gog-humble'/, 'GOG/Humble 卡不挂卡头开关、按平台分两行');
  assert.match(admin, /enabledField\?\[sec\.enabledField\]/, '恢复本组默认包含卡头开关字段');
});

// ---------------------------------------------------------------- FW 批（docs/SLOW-SYNC.md §5/§8 FW-1）

test('FW-1 设置项：heat 三项新增（发现与热度卡）、discovery 三项默认值改新值且 min 60→10', () => {
  const heatLimit = settings.SETTING_MAP.get('heat.limit');
  const heatInterval = settings.SETTING_MAP.get('heat.intervalMin');
  const heatInitial = settings.SETTING_MAP.get('heat.initialDelaySec');
  assert.ok(heatLimit && heatInterval && heatInitial, 'heat 三项已定义');
  assert.deepEqual(
    [heatLimit.env, heatLimit.default, heatLimit.min, heatLimit.max],
    ['STEAM_HEAT_LIMIT', 100, 1, 200000],
    'heat.limit：env STEAM_HEAT_LIMIT、默认 100、范围 1–200000',
  );
  assert.deepEqual(
    [heatInterval.env, heatInterval.default, heatInterval.min, heatInterval.max],
    ['STEAM_HEAT_INTERVAL_MIN', 10, 1, 1440],
    'heat.intervalMin：env STEAM_HEAT_INTERVAL_MIN、默认 10、范围 1–1440',
  );
  assert.deepEqual(
    [heatInitial.env, heatInitial.default, heatInitial.min, heatInitial.max],
    ['STEAM_HEAT_INITIAL_DELAY_SEC', 3600, 0, 86400],
    'heat.initialDelaySec：env STEAM_HEAT_INITIAL_DELAY_SEC、默认 3600（首轮延迟不变）',
  );
  for (const d of [heatLimit, heatInterval, heatInitial]) {
    assert.equal(d.section, 'discovery', `${d.key} 归「发现与热度」卡`);
  }
  // 设置页 DOM 契约：卡片 id=discovery 由后端 sections 驱动，前端按 section 归卡（无需前端改动）
  const sec = settings.SETTINGS_SECTIONS.find((s) => s.id === 'discovery');
  assert.equal(sec.group, 'sources', '发现与热度卡在「数据源与采集」组');
  const prim = settings.SETTINGS.filter((d) => d.section === 'discovery' && d.tier !== 'advanced');
  assert.ok(prim.length <= 3, `发现与热度卡常用项 ${prim.length} 项（CQ 批约束 ≤3，heat 三项在折叠内）`);

  assert.deepEqual(
    [settings.SETTING_MAP.get('discovery.pages').default, settings.SETTING_MAP.get('discovery.intervalMin').default],
    [10, 30],
    'discovery.pages 100→10、intervalMin 1440→30',
  );
  assert.equal(settings.SETTING_MAP.get('discovery.fallbackLimit').default, 10, 'discovery.fallbackLimit 100→10');
  assert.equal(settings.SETTING_MAP.get('discovery.intervalMin').min, 10, '发现间隔下限 60→10');
  // 校验：新范围真的拦得住越界值（行为锁，不是只读 schema）
  assert.equal(settings.validateSetting(heatLimit, 0).ok, false);
  assert.equal(settings.validateSetting(heatLimit, 200001).ok, false);
  assert.equal(settings.validateSetting(heatLimit, 100).ok, true);
  assert.equal(settings.validateSetting(settings.SETTING_MAP.get('discovery.intervalMin'), 10).ok, true, '新下限 10 可保存');
  assert.equal(settings.validateSetting(settings.SETTING_MAP.get('discovery.intervalMin'), 9).ok, false);
});

test('FW-1 升级迁移：旧默认值改成新默认、显式改过的不动、slow_sync.migrated_v1 只生效一次', async () => {
  const { store, q } = await fresh();
  try {
    // 模拟线上库：三项旧默认值已保存 + 一个用户显式改过的值（不能被动）
    await q(
      `insert into app_settings (key, value, updated_by) values
         ('discovery.pages', '100'::jsonb, 'tester'),
         ('discovery.fallbackLimit', '50'::jsonb, 'tester'),
         ('discovery.intervalMin', '1440'::jsonb, 'tester')`,
    );
    const events = [];
    const logger = { info: (e, f) => events.push([e, f]), warn: () => {}, setLevel: () => {} };
    const env = {};
    await settings.initializeSettings({ store, env, secretKey: SECRET, logger });

    const rows = (await q("select key, value from app_settings where key like 'discovery.%' order by key")).rows;
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    assert.equal(byKey['discovery.pages'], 10, '旧默认 100 → 新默认 10');
    assert.equal(byKey['discovery.intervalMin'], 30, '旧默认 1440 → 新默认 30');
    assert.equal(byKey['discovery.fallbackLimit'], 50, '显式改过的值（50）保持不动');
    assert.equal(env.STEAM_DISCOVERY_PAGES, '10', '同一次启动的水合已用新值');
    assert.ok(events.some(([e]) => e === 'settings.slow_sync_migrated'), '迁移落日志 settings.slow_sync_migrated');
    const marker = (await q("select value from app_meta where key = 'slow_sync.migrated_v1'")).rows[0];
    assert.ok(marker?.value, '一次性标记 slow_sync.migrated_v1 已写入');

    // 幂等：把 pages 改回 100 再启动一次——标记已存在，不得再迁移
    await q("update app_settings set value = '100'::jsonb where key = 'discovery.pages'");
    const events2 = [];
    await settings.initializeSettings({ store, env: {}, secretKey: SECRET, logger: { info: (e) => events2.push(e), warn: () => {}, setLevel: () => {} } });
    const pages2 = (await q("select value from app_settings where key = 'discovery.pages'")).rows[0]?.value;
    assert.equal(pages2, 100, '标记存在 → 第二次启动不再迁移（只生效一次）');
    assert.ok(!events2.includes('settings.slow_sync_migrated'), '第二次启动不再记迁移日志');
  } finally {
    await store.close();
  }
});
