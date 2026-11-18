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

test('设置定义完整：59 项、7 个密钥、关键分组都在', () => {
  assert.equal(settings.SETTINGS.length, 91, '… + CB publicUrl + CC 四源每轮条数 4 项 + CF 自动封禁策略 8 项 + CH 发现与推荐 8 项 + CA-5 手机跳转开关 1 项 + CO-3/C2 App 设备限流 2 项 + CO-1/A5 任务失败邮件告警 1 项 + CO-4/E4 入库告警阈值 2 项');
  assert.equal(settings.SETTINGS.filter((d) => d.secret).length, 7);
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
    'system.circuitThreshold',
    'system.logLevel',
    'site.adultDisplay',
    'steamStatus.rateMs',
    'steamStatus.limit',
    'steamStatus.intervalMin',
    'steamStatus.initialDelaySec',
  ]) {
    assert.ok(keys.includes(key), `缺少 ${key}`);
  }
  assert.equal(new Set(keys).size, keys.length, 'key 不能重复');
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
  assert.equal(ssl.default, 6000, 'steam-status 每轮默认 6000（AB 批从 12000 下调，约 5 小时/轮）');
  const ssi = settings.SETTINGS.find((d) => d.key === 'steamStatus.intervalMin');
  assert.equal(ssi.default, 1440, 'steam-status 默认每天一轮（X 批：原每周）');
  const ssd = settings.SETTINGS.find((d) => d.key === 'steamStatus.initialDelaySec');
  assert.equal(ssd.default, 600, 'steam-status 首轮延迟默认 600 秒（Y 批并入 AB）');
  assert.equal(ssd.env, 'STEAM_STATUS_INITIAL_DELAY_SEC');
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

test('CQ meta：sources/site/advanced 全有 section+tier；6 张平台卡每卡常用 ≤3；高级 4 折叠组', () => {
  const byGroup = {};
  for (const d of settings.SETTINGS) (byGroup[d.group] = byGroup[d.group] || []).push(d);
  for (const g of ['sources', 'site', 'advanced']) {
    for (const d of byGroup[g]) {
      assert.ok(d.section, `${d.key} 缺 section`);
      assert.ok(['primary', 'advanced'].includes(d.tier), `${d.key} tier 非法`);
    }
  }
  const sections = settings.SETTINGS_SECTIONS;
  const src = sections.filter((s) => s.group === 'sources');
  assert.equal(src.length, 6, '6 张平台卡');
  assert.deepEqual(src.map((s) => s.id), ['global', 'steam', 'sonkwo', 'itad', 'gog-humble', 'discovery'], '卡序（全局/Steam/杉果/ITAD/GOG+Humble/发现与热度）');
  for (const s of src) {
    const prim = byGroup.sources.filter((d) => d.section === s.id && d.tier !== 'advanced');
    const rows = s.compact ? Math.ceil(prim.length / s.compact) : prim.length;
    assert.ok(rows <= 3, `${s.id} 常用 ${rows} 行 > 3（验收：每卡常用 ≤3 项）`);
  }
  const adv = sections.filter((s) => s.group === 'advanced');
  assert.equal(adv.length, 4, '高级 4 折叠组');
  assert.deepEqual(adv.map((s) => s.id), ['schedule', 'backup', 'cache', 'timezone'], '调度与熔断/备份与日志/缓存与图片/时区与显示');
  const site = sections.find((s) => s.group === 'site' && s.id === 'site');
  assert.equal(site.keys.length, 4, '站点常用 4 项');
  assert.ok(site.keys.includes('system.timezone'), '时区在站点常用（§2.3）');
  const recommend = sections.find((s) => s.group === 'site' && s.id === 'recommend');
  assert.ok(recommend, '推荐与评分折叠存在');
  // 质检打回项：推荐与评分折叠 4 项（口味权重进折叠），行为开关放卡体常用
  const recAdv = byGroup.site.filter((d) => d.section === 'recommend' && d.tier === 'advanced');
  assert.equal(recAdv.length, 4, '推荐与评分折叠 4 项');
  assert.ok(recAdv.some((d) => d.key === 'personal.tasteWeight'), '口味权重在折叠内');
  assert.equal(settings.SETTING_MAP.get('personal.behaviorLogEnabled').tier, 'primary', '行为开关在折叠外');
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
  assert.match(admin, /fieldHit/, '搜索命中高亮');
  assert.match(admin, /api\/admin\/settings\/restore/, '恢复默认接口接线（二次确认在 restoreField/restoreSection）');
  assert.match(admin, /ElMessageBox\.confirm/, '恢复默认二次确认');
  const server = readFileSync(new URL('../src/settings-routes.js', import.meta.url), 'utf8');
  assert.match(server, /api\/admin\/settings\/restore/, '恢复接口路由');
  assert.match(server, /settings\.restored/, '恢复审计');
  // 质检打回项静态锁：只看非默认过滤折叠内项 / bool 摘要开·关 / 紧凑行每字段恢复入口
  assert.match(admin, /'开':'关'/, 'bool 摘要显示开/关而非 true/false');
  assert.match(admin, /kind:'foldBody',sec,fields:adv/, '折叠展开项与折叠计数同用过滤后的 adv（只看非默认生效）');
  assert.match(admin, /↺/, '紧凑行每个字段都有恢复入口');
  assert.match(admin, /en\[0\]\.key/, '卡头启用开关取第一个 .enabled（杉果卡启用状态）');
});
