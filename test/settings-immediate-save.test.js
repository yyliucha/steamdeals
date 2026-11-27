// FY-2（docs/SETTINGS-REDESIGN.md §3.2/§3.3/§3.4/§3.5、§7 验收 3/4/5/6/7/8）：
// 设置页「分区标题 + 一行一项」+ 每项即时保存 + 跨组搜索/只看非默认 + 移动端两段式。
//
// 前端没有组件级测试框架，按项目惯例分三层锁行为：
//  1) 纯逻辑 frontend/src/utils/settingsSave.js——合并窗口 1.5s、静默 700ms、输入防抖 600ms、
//     失败回滚上次值、离开页面 flush（验收 4/5，用假计时器逐毫秒驱动，断言 POST 次数与时刻）；
//  2) SSR 真渲染 frontend/src/components/SettingsRow.vue——一行一项的 DOM 结构：label/高级小标/帮注/
//     来源徽标/恢复默认/控件/保存状态三态、密钥复用 SecretField（验收 3/6）；
//  3) 静态接线锁 AdminModules.vue——分区标题 + 一行一项、无卡片盒子/无「高级 N 项」折叠、
//     搜索跨 7 组 + 跳组高亮、只看非默认 localStorage、≤560px 两段式（验收 3/6/7/8）。
//
// 反向自检（改动后应立刻变红，见 docs/QA-FY-2.md「反向自检」）：
//   - 把 settingsSave 的静默 flush 改成立刻发 → 「1.5 秒内连改 3 项只发 1 次」红；
//   - 把 QUIET_FLUSH_MS 调到 > 1000 → 「单改一项 1 秒内 ✓」红；
//   - 把失败分支的 onRollback 删掉 → 「失败回滚上次值」红；
//   - 把 SettingsRow 的 .item-meta opacity:0 / :hover / :focus-within 删掉 → 验收 6 静态锁红；
//   - 把 AdminModules 的 SettingsRow 换回 settings-card 卡片 → 验收 3 静态锁红。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  INPUT_DEBOUNCE_MS,
  MERGE_WINDOW_MS,
  QUIET_FLUSH_MS,
  SAVED_FADE_MS,
  createSettingsSaver,
  errorText,
} from '../frontend/src/utils/settingsSave.js';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const ADMIN = read('../frontend/src/pages/AdminModules.vue');
const ROW = read('../frontend/src/components/SettingsRow.vue');
const SAVER = read('../frontend/src/utils/settingsSave.js');

// ---------------------------------------------------------------- 假时钟（毫秒级驱动合并窗口）

function makeClock() {
  let now = 0;
  let seq = 0;
  const jobs = new Map();
  const timers = {
    setTimeout(fn, ms) {
      const id = ++seq;
      jobs.set(id, { at: now + Math.max(0, Number(ms) || 0), fn, seq: id });
      return id;
    },
    clearTimeout(id) {
      jobs.delete(id);
    },
  };
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return {
    timers,
    now: () => now,
    pendingTimers: () => jobs.size,
    /** 推进 ms 毫秒：按到期时间顺序执行到期的计时器，每步之后清一遍微任务（保存 Promise 链）。 */
    async tick(ms) {
      const target = now + ms;
      for (;;) {
        await settle();
        let next = null;
        for (const [id, job] of jobs) {
          if (job.at > target) continue;
          if (!next || job.at < next.job.at || (job.at === next.job.at && job.seq < next.job.seq)) next = { id, job };
        }
        if (!next) break;
        jobs.delete(next.id);
        now = next.job.at;
        next.job.fn();
      }
      now = target;
      await settle();
    },
  };
}

/** 建一个记录 POST 的 saver：calls = 每次提交的 values；states = [key, kind, message]。 */
function makeSaver({ save, clock = makeClock() } = {}) {
  const calls = [];
  const states = [];
  const rollbacks = [];
  const saver = createSettingsSaver({
    save: async (values) => {
      calls.push(values);
      if (save) return save(values, calls.length);
      return { ok: true, values, revision: calls.length };
    },
    onState: (key, kind, message) => states.push([key, kind, message]),
    onRollback: (key, previous) => rollbacks.push([key, previous]),
    timers: clock.timers,
  });
  return { saver, clock, calls, states, rollbacks };
}

// ---------------------------------------------------------------- 验收 4：单改一项 1 秒内出 ✓

test('验收 4：toggle 改动后 1 秒内完成保存（静默 700ms 即发，不用点保存按钮）', async () => {
  const { saver, clock, calls, states } = makeSaver();
  saver.set('sources.steam.enabled', false, () => true);
  assert.equal(QUIET_FLUSH_MS, 700, '静默窗口 700ms：单改一项远小于验收 4 的 1 秒');
  await clock.tick(QUIET_FLUSH_MS - 1);
  assert.equal(calls.length, 0, '静默窗口内不发（这就是合并窗口，1.5 秒内连改只发 1 次的前提）');
  assert.deepEqual(states.at(-1).slice(0, 2), ['sources.steam.enabled', 'saving'], '改动即显示「保存中…」');
  await clock.tick(1);
  assert.equal(calls.length, 1, '静默 700ms 后发一次 POST');
  assert.deepEqual(calls[0], { 'sources.steam.enabled': false }, '只发改动的 key（局部 values）');
  assert.ok(clock.now() <= 1000, `从改动到提交 ≤1 秒（实际 ${clock.now()}ms）`);
  assert.deepEqual(states.at(-1).slice(0, 2), ['sources.steam.enabled', 'saved'], '成功后行内出现 ✓ 已保存');
});

test('验收 4：✓ 已保存 2 秒后淡出（回到无状态）', async () => {
  const { saver, clock, states } = makeSaver();
  saver.set('a.b', 1, () => 0);
  await clock.tick(QUIET_FLUSH_MS);
  await clock.tick(SAVED_FADE_MS - 1);
  assert.equal(saver.stateOf('a.b').kind, 'saved', '2 秒内一直显示 ✓ 已保存');
  await clock.tick(1);
  assert.equal(saver.stateOf('a.b'), null, '2 秒后淡出（父组件删掉行内状态）');
  assert.deepEqual(states.at(-1).slice(0, 2), ['a.b', 'idle'], '淡出走 idle 事件');
});

test('验收 4：int 输入停止 600ms 后保存（期间逐字不发请求）', async () => {
  const { saver, clock, calls } = makeSaver();
  saver.input('sources.steam.priceIntervalMin', 7, () => 1440);
  await clock.tick(300);
  saver.input('sources.steam.priceIntervalMin', 72, () => 1440); // 继续输入 → 防抖重计时
  await clock.tick(INPUT_DEBOUNCE_MS - 1);
  assert.equal(calls.length, 0, '停止输入 599ms 时还没发（防抖未到）');
  await clock.tick(1);
  assert.equal(calls.length, 1, '停止输入 600ms 后保存');
  assert.deepEqual(calls[0], { 'sources.steam.priceIntervalMin': 72 }, '只提交最后的值（中间草稿不提交）');
  assert.equal(INPUT_DEBOUNCE_MS, 600, '防抖窗口 600ms（规格 §3.3）');
});

test('验收 4：int 失焦立即提交（不等 600ms），且取消掉原来的防抖计时', async () => {
  const { saver, clock, calls } = makeSaver();
  saver.input('sources.steam.priceIntervalMin', 9, () => 1440);
  await clock.tick(100);
  await saver.commitNow('sources.steam.priceIntervalMin', 900, () => 1440);
  assert.equal(calls.length, 1, 'blur 立即发一次');
  assert.deepEqual(calls[0], { 'sources.steam.priceIntervalMin': 900 });
  await clock.tick(2000);
  assert.equal(calls.length, 1, '原 600ms 防抖已被取消，不会再补发一次');
});

// ---------------------------------------------------------------- 验收 5：1.5 秒内连改 3 项只发 1 次

test('验收 5：连续改 3 项（1.5 秒内）只发 1 次 POST，values 含三项', async () => {
  const { saver, clock, calls } = makeSaver();
  saver.set('sources.steam.enabled', false, () => true);
  await clock.tick(300);
  saver.set('site.adultDisplay', 'show', () => 'hide');
  await clock.tick(300);
  saver.set('alerts.webhookUrl', 'https://x.test/hook', () => '');
  await clock.tick(MERGE_WINDOW_MS - 600);
  assert.equal(calls.length, 1, '1.5 秒窗口内 3 项改动合并成 1 次 POST（revision 只涨 1）');
  assert.deepEqual(Object.keys(calls[0]).sort(), ['alerts.webhookUrl', 'site.adultDisplay', 'sources.steam.enabled']);
});

test('验收 5：合并上限 1.5 秒——持续每 400ms 改一项也只在 1.5 秒时发一次', async () => {
  const { saver, clock, calls } = makeSaver();
  for (const [key, at] of [['a.1', 0], ['a.2', 400], ['a.3', 800], ['a.4', 1200]]) {
    if (at) await clock.tick(400);
    saver.set(key, true, () => false);
  }
  await clock.tick(MERGE_WINDOW_MS - 1200);
  assert.equal(calls.length, 1, '上限到点必发（不会一直攒着）');
  assert.equal(Object.keys(calls[0]).length, 4, '四项都在同一批');
  assert.equal(MERGE_WINDOW_MS, 1500, '合并窗口 1500ms（规格 §3.3）');
});

test('验收 5：超过合并窗口后的新改动单独发第二次（不会把两批混成一批或丢掉）', async () => {
  const { saver, clock, calls } = makeSaver();
  saver.set('a.1', true, () => false);
  await clock.tick(QUIET_FLUSH_MS);
  assert.equal(calls.length, 1);
  await clock.tick(1000);
  saver.set('a.2', true, () => false);
  await clock.tick(QUIET_FLUSH_MS);
  assert.equal(calls.length, 2, '两批改动 → 两次 POST');
  assert.deepEqual(calls[1], { 'a.2': true });
});

// ---------------------------------------------------------------- 验收 4：失败回滚 + 红字

test('验收 4：提交失败 → 回滚上次值 + 红字原因（不静默丢改动）', async () => {
  let attempts = 0;
  const { saver, clock, calls, rollbacks, states } = makeSaver({
    save: async (values) => {
      attempts += 1;
      if (attempts === 1) throw new Error('超出上限，已回滚'); // 第一次失败（服务端 400 的等价物）
      return { ok: true, values, revision: 2 };
    },
  });
  saver.set('steamStatus.limit', 60000, () => 20000);
  await clock.tick(QUIET_FLUSH_MS);
  assert.equal(calls.length, 1);
  assert.deepEqual(rollbacks, [['steamStatus.limit', 20000]], '回滚到上次成功保存的值');
  assert.deepEqual(states.at(-1), ['steamStatus.limit', 'error', '超出上限，已回滚'], '行内标红并带原因');
  assert.equal(saver.hasErrors(), true, '有失败项 → 未保存守卫仍然生效');
  // 再改一次 → 重新 saving → saved，错误态清除
  saver.set('steamStatus.limit', 15000, () => 20000);
  await clock.tick(QUIET_FLUSH_MS);
  assert.equal(calls.length, 2, '第二次提交已发出');
  assert.equal(saver.hasErrors(), false, '成功一次后失败态清除');
  assert.deepEqual(states.at(-1).slice(0, 2), ['steamStatus.limit', 'saved']);
});

test('验收 4：服务端 400 的中文原因原样传到行内（errorText 不吞信息）', async () => {
  assert.equal(errorText(new Error('价格刷新间隔需要整数')), '价格刷新间隔需要整数');
  assert.equal(errorText(null), '保存失败', '无原因时有兜底文案');
});

// ---------------------------------------------------------------- 离开页面 flush / 边界

test('离开页面：600ms 防抖里的草稿也强制 flush 一次（§3.3）', async () => {
  const { saver, clock, calls } = makeSaver();
  saver.set('a.done', true, () => false);
  await clock.tick(200);
  saver.input('a.typing', 'half-typed', () => '');
  assert.equal(calls.length, 0, '还没到任何窗口');
  await saver.flushAll();
  assert.equal(calls.length, 1, '离开时强制发一次');
  assert.deepEqual(calls[0], { 'a.done': true, 'a.typing': 'half-typed' }, '待发的队列 + 防抖草稿一起发');
  assert.equal(saver.hasPending(), false, '发完没有残留');
  await clock.tick(3000);
  assert.equal(calls.length, 1, '不会因为过了防抖时间再补发');
});

test('并发保护：提交进行中又改一项 → 结束后再发一批，不丢改动', async () => {
  const clock = makeClock();
  const calls = [];
  let release;
  const saver = createSettingsSaver({
    save: (values) => {
      calls.push(values);
      if (calls.length === 1) return new Promise((resolve) => {
        release = () => resolve({ values, revision: 1 });
      });
      return Promise.resolve({ values, revision: 2 });
    },
    timers: clock.timers,
  });
  saver.set('a.1', 1, () => 0);
  await clock.tick(QUIET_FLUSH_MS);
  assert.equal(calls.length, 1, '第一次提交已发出');
  saver.set('a.2', 2, () => 0); // 第一次还在飞
  await clock.tick(100);
  release();
  await clock.tick(QUIET_FLUSH_MS * 2);
  assert.equal(calls.length, 2, '飞行中的新改动会在结束后补发（不丢）');
  assert.deepEqual(calls[1], { 'a.2': 2 });
});

test('dispose 之后不再发请求（组件卸载后计时器不泄漏）', async () => {
  const { saver, clock, calls } = makeSaver();
  saver.set('a.b', true, () => false);
  saver.dispose();
  await clock.tick(5000);
  assert.equal(calls.length, 0, 'dispose 清掉计时器与待发队列');
});

// ---------------------------------------------------------------- 验收 3/6：SettingsRow 真渲染（SSR）

async function renderRows(cases) {
  const { createServer } = await import('vite');
  const { createSSRApp } = await import('vue');
  const { renderToString } = await import('@vue/server-renderer');
  const { ElButton, ElInput, ElOption, ElSelect, ElSwitch } = await import('element-plus');
  const server = await createServer({
    configFile: 'frontend/vite.config.js',
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  });
  try {
    const mod = await server.ssrLoadModule('/src/components/SettingsRow.vue');
    const html = {};
    for (const [name, props] of Object.entries(cases)) {
      const app = createSSRApp(mod.default, props);
      for (const component of [ElButton, ElInput, ElOption, ElSelect, ElSwitch]) app.use(component);
      app.config.warnHandler = () => {}; // SSR 下 el-* 解析告警与断言无关
      html[name] = await renderToString(app);
    }
    return html;
  } finally {
    await server.close();
  }
}

const boolField = {
  key: 'steamStatus.rateMs',
  label: '状态判定限速（毫秒）',
  help: '两次状态判定之间的最小间隔，越大越不容易撞 429。',
  type: 'int',
  tier: 'advanced',
  default: 1500,
  min: 500,
  max: 5000,
};

test('验收 3/6：一行一项的 DOM 结构（label + 高级小标 + 帮注 + 来源徽标 + 恢复默认 + 控件 + 状态）', async () => {
  const html = await renderRows({
    saved: {
      field: boolField,
      value: 1500,
      source: 'database',
      status: { kind: 'saved', message: '' },
      domId: 'setting-steamStatus-rateMs',
    },
    plain: {
      field: { key: 'network.noProxy', label: '不走代理的域名', help: '逗号分隔', type: 'string', tier: 'primary', default: '' },
      value: 'localhost',
      source: 'env',
      domId: 'setting-network-noProxy',
    },
    saving: { field: boolField, value: 1600, source: 'default', status: { kind: 'saving' } },
    failed: { field: boolField, value: 60000, source: 'database', status: { kind: 'error', message: '超出上限，已回滚' } },
  });
  // 一行一项：没有卡片盒子 / 折叠容器
  assert.match(html.saved, /class="setting-item"/, '行容器');
  assert.match(html.saved, /data-setting-key="steamStatus\.rateMs"/, '行带 key（便于跳组定位）');
  assert.doesNotMatch(html.saved, /settings-card|settings-fold/, '行内没有卡片盒子 / 折叠');
  // 左：label + 高级小标 + 帮注 + 来源 + 恢复默认
  assert.match(html.saved, /状态判定限速（毫秒）/, 'label');
  assert.match(html.saved, /class="item-adv"[^>]*>高级</, '高级项不再折叠，行内加「高级」小标');
  assert.match(html.saved, /两次状态判定之间的最小间隔/, '帮注（help）');
  assert.match(html.saved, /class="item-src"[^>]*>数据库</, '来源徽标：数据库');
  assert.match(html.saved, />恢复默认</, '恢复默认入口在行内');
  assert.match(html.plain, /class="item-src"[^>]*>环境变量</, '来源徽标：环境变量');
  assert.match(html.saving, /class="item-src"[^>]*>默认值</, '来源徽标：默认值');
  assert.doesNotMatch(html.plain, /class="item-adv"/, '非高级项没有「高级」小标');
  // 右：控件 + 保存状态
  assert.match(html.saved, /class="el-input/, 'int 控件');
  assert.match(html.saved, /class="is-saved item-state"|class="item-state is-saved"/, '保存状态类 = 已保存');
  assert.match(html.saved, /✓ 已保存/, '✓ 已保存文案');
  assert.match(html.saving, /class="item-spin"/, '保存中带 spinner');
  assert.match(html.saving, /保存中…/, '保存中文案');
  assert.match(html.failed, /class="is-error item-state"|class="item-state is-error"/, '失败态红色');
  assert.match(html.failed, /✕ 超出上限，已回滚/, '失败显示原因');
});

test('验收 3：四种控件都还在（bool 开关 / enum 下拉 / int 数字 / text 多行），密钥复用 SecretField', async () => {
  const html = await renderRows({
    bool: { field: { key: 'sources.steam.enabled', label: '启用', type: 'bool', tier: 'primary' }, value: true, source: 'database' },
    enum: {
      field: { key: 'site.adultDisplay', label: '成人内容展示策略', type: 'enum', options: ['hide', 'badge', 'show'], tier: 'primary' },
      value: 'badge',
      source: 'database',
    },
    text: { field: { key: 'site.headInjection', label: 'head 注入', type: 'text', tier: 'primary' }, value: '<meta/>', source: 'database' },
    secret: {
      field: { key: 'sources.itad.apiKey', label: 'ITAD API Key', type: 'secret', tier: 'primary' },
      value: '',
      source: 'database',
      hasValue: true,
    },
  });
  assert.match(html.bool, /class="el-switch/, 'bool → el-switch');
  assert.match(html.enum, /class="el-select/, 'enum → el-select');
  // el-select 的选项在 teleport 里（SSR 只出占位注释），选项来源改用静态锁核对
  assert.match(ROW, /<el-option v-for="option in field\.options \|\| \[\]" :key="option" :label="option" :value="option" \/>/, 'enum 选项按 schema options 渲染');
  assert.match(html.text, /el-textarea/, 'text → 多行输入框');
  // 密钥：复用 FX 的 SecretField（密码框 + 眼睛），不自己再写密钥框
  assert.match(html.secret, /class="secret-field/, '复用 SecretField');
  assert.match(html.secret, /class="secret-eye"/, '眼睛按钮在行内');
  assert.match(html.secret, /type="password"/, '默认密文');
});

test('验收 6：来源徽标与「恢复默认」默认 opacity:0，hover/focus 该行才出现（CSS 静态锁）', () => {
  assert.match(ROW, /\.item-meta\s*\{[^}]*opacity:\s*0/, '默认不可见（opacity:0 保留占位，不抖动）');
  assert.match(ROW, /\.setting-item:hover \.item-meta,\s*\n?\s*\.setting-item:focus-within \.item-meta\s*\{\s*\n?\s*opacity:\s*1/, 'hover / focus-within 该行才出现');
  assert.match(ROW, /@media \(hover: none\)/, '触屏没有 hover：始终显示，否则手机上点不到「恢复默认」');
  // 行内一定有这两个元素（不是 hover 时才创建，否则键盘/读屏拿不到）
  assert.match(ROW, /class="item-src"/, '来源徽标常驻 DOM');
  assert.match(ROW, /class="item-restore"[^>]*>恢复默认</, '恢复默认常驻 DOM（hover 只是显隐）');
});

// ---------------------------------------------------------------- 验收 3/7/8：AdminModules 接线静态锁

test('验收 3：右侧是「分区标题 + 一行一项」——无 settings-card 卡片盒子、无「高级 N 项」折叠（静态锁）', () => {
  assert.match(ADMIN, /class="settings-section"/, '分区容器');
  assert.match(ADMIN, /class="section-head"><h3>\{\{ sec\.title \}\}<\/h3><span class="section-n">\{\{ sec\.fields\.length \}\} 项<\/span><span v-if="sec\.enabledKey" class="section-st"/, '分区标题 = 名称 + 项数 + 启用状态徽标');
  assert.match(ADMIN, /<SettingsRow v-for="field in sec\.fields"/, '每项一行（SettingsRow 循环）');
  assert.ok(!ADMIN.includes('settings-card'), '不再有 settings-card 卡片盒子（含 CSS）');
  assert.ok(!ADMIN.includes('settings-fold'), '不再有「高级 N 项」折叠（含 CSS 与 localStorage 折叠态）');
  assert.ok(!ADMIN.includes('setting-rows'), '旧的紧凑多列行（一行多项）已移除');
  assert.match(ADMIN, /tier==='advanced'\?'高级'|hit\.tier==='advanced'/, '高级项用行内小标区分（搜索面板也带）');
  // 一行一项：不再把 compact 字段合并成「A / B」多列行
  assert.ok(!ADMIN.includes('row.fields'), '不再有「一行塞多个字段」的 rows 渲染');
  assert.ok(!ADMIN.includes('sec.compact') && !ADMIN.includes('s.compact'), '不再按 compact 合并成多列行（规格：一行一项）');
});

test('验收 4：即时保存接线——bool/enum set、int 输入防抖 + blur 立即提交、失败回滚、无「保存设置」按钮', () => {
  assert.match(ADMIN, /createSettingsSaver\(\{/, 'SettingsRow 的改动进合并队列');
  assert.match(ADMIN, /save:\(values\)=>api\('\/api\/admin\/settings',json\('POST',\{values\}\)\)/, '提交走既有 POST /api/admin/settings（局部 values，不改后端）');
  assert.match(ADMIN, /@commit="\(v\)=>commitSetting\(field,v\)"/, 'bool/enum change → commit（立即入队）');
  assert.match(ADMIN, /@input="\(v\)=>inputSetting\(field,v\)"/, 'int/string/text 输入 → 防抖入队');
  assert.match(ADMIN, /@commit-now="\(v\)=>commitSettingNow\(field,v\)"/, 'blur → 立即提交');
  assert.match(ADMIN, /settingsSaver\.input\(field\.key,v,/, '输入防抖交给保存队列（600ms）');
  assert.match(ADMIN, /settingsSaver\.commitNow\(/, 'blur 走 commitNow');
  assert.match(ADMIN, /onRollback:\(key,previous\)=>\{settingValues\[key\]=previous\?\?defaultValueOf\(key\);\}/, '失败回滚上次值');
  assert.match(ADMIN, /onState:\(key,kind,message\)=>\{[\s\S]{0,220}?kind==='error'[\s\S]{0,120}?settingsConflict\.value=true/, '失败 → 未保存守卫重新生效');
  assert.match(ADMIN, /flushAll\(\)/, '离开页面强制 flush 待发改动');
  assert.match(ADMIN, /watch\(\(\)=>props\.section,\(next,prev\)=>\{if\(prev==='settings'&&next!=='settings'\)void flushSettings\(\)\.catch/, '切到别的模块（共用实例不卸载）也要 flush');
  // 工具栏只剩搜索 + 只看非默认：三个全局控件全部移除
  const toolbar = /<div class="settings-toolbar">([\s\S]*?)<\/div>/.exec(ADMIN)?.[1] ?? '';
  assert.match(toolbar, /settings-search/, '工具栏保留搜索');
  assert.match(toolbar, /只看非默认/, '工具栏保留「只看非默认」');
  for (const gone of ['保存设置', '重新加载', '跟随系统']) {
    assert.ok(!toolbar.includes(gone), `工具栏不再有「${gone}」`);
    assert.ok(!ADMIN.includes(`>${gone}<`), `页面不再有「${gone}」控件`);
  }
  assert.ok(!ADMIN.includes('saveSettings'), '旧的全局保存函数已删除');
  assert.ok(!ADMIN.includes('submitSettings'), '旧的整份提交函数已删除（改为局部 values 即时保存）');
});

test('验收 4：useUnsavedGuard 语义跟着改——即时保存后只有「提交失败」才算未保存', () => {
  assert.match(ADMIN, /registerUnsavedSource\(\{id:'settings',label:'系统设置',isDirty:\(\)=>settingsConflict\.value,save:flushSettings,discard:discardSettings\}\)/, '设置面：脏 = 保存失败；「保存并离开」= flush');
  assert.match(ADMIN, /registerUnsavedSource\(\{id:'settings-proxy',label:'Steam 专用代理',isDirty:\(\)=>proxyDialogDirty\.value/, '代理弹窗草稿单独注册（弹窗里还是草稿式）');
  assert.ok(!ADMIN.includes('settingsDirty'), '旧的 settingsDirty（改一项即脏）已不存在');
});

test('验收 7：搜索跨 7 组匹配 label/key/help，命中面板「组 · 分区」，点击跳组并高亮；?q= 可深链', () => {
  assert.match(ADMIN, /const settingSearchHits=computed\(\(\)=>\{const q=settingQuery\.value\.trim\(\)\.toLocaleLowerCase\(\);if\(!q\)return \[\];return \(settingsSchema\.value\?\.fields\|\|\[\]\)\.filter\(\(f\)=>!isMailSettingKey\(f\.key\)&&`\$\{f\.label\} \$\{f\.key\} \$\{f\.help\|\|''\}`/, '跨组匹配（不按 group 过滤）+ label/key/help');
  assert.match(ADMIN, /class="settings-hits"/, '命中结果面板');
  assert.match(ADMIN, /groupTitle\(hit\.group\)/, '面板显示组名');
  assert.match(ADMIN, /sectionTitleOf\(hit\)/, '面板显示分区（组 · 项）');
  assert.match(ADMIN, /@click="jumpToSetting\(hit\)"/, '点结果跳转');
  assert.match(ADMIN, /if\(hit\.group!==activeSettingsGroup\.value\)goSettingsGroup\(hit\.group\)/, '跳组（换 URL，可后退）');
  assert.match(ADMIN, /highlightKey\.value=hit\.key/, '高亮目标行');
  assert.match(ADMIN, /scrollIntoView\(\{block:'center',behavior:'smooth'\}\)/, '滚到目标行');
  assert.match(ADMIN, /f\.key===highlightKey\.value\)/, '高亮行不受搜索/只看非默认过滤影响（跳过去一定看得到）');
  assert.match(ADMIN, /if\(route\.query\.q\)settingQuery\.value=String\(route\.query\.q\)/, '?q= 进组即带搜索词（可分享）');
});

test('验收 7：「只看非默认」过滤生效（含高级项）且刷新后仍生效（localStorage 记忆）', () => {
  assert.match(ADMIN, /settings-only-changed/, '沿用既有 localStorage key（刷新后仍生效）');
  assert.match(ADMIN, /localStorage\.setItem\('settings-only-changed',v\?'1':'0'\)/, '开关变化写回 localStorage');
  assert.match(ADMIN, /function onlyChangedFilter\(f\)\{if\(!settingsOnlyChanged\.value\)return true;return !\(settingsSchema\.value\?\.isDefault\?\.\[f\.key\]\?\?true\);\}/, '过滤依据 = schema.isDefault');
  // 过滤作用于分区里的全部字段（primary + advanced 一视同仁，因为不再折叠）
  assert.match(ADMIN, /const fields=ordered\.filter\(match\)/, '分区字段（含高级项）统一过滤');
  assert.ok(!ADMIN.includes('sec.advanced'), '不再有「高级项单独一组」——过滤口径与展示一致');
});

test('验收 8：≤560px 行改上下两段、控件占满宽、状态在控件下、触摸目标 ≥44px（CSS 静态锁）', () => {
  assert.match(ROW, /@media \(max-width: 560px\)/, '断点 560px（规格 §3.5）');
  assert.match(ROW, /\.setting-item \{\s*grid-template-columns: minmax\(0, 1fr\);/, '≤560px 行从两列改成单列（label 在上、控件在下）');
  assert.match(ROW, /\.item-ctrl \{\s*flex-direction: column;/, '控件区纵向排列');
  assert.match(ROW, /\.item-select,\s*\n?\s*\.item-number,\s*\n?\s*\.item-string,\s*\n?\s*\.item-textarea \{\s*\n?\s*width: 100%/, '控件占满宽');
  assert.match(ROW, /min-height: 44px/, '触摸目标 ≥44px');
  // 管理页：≤560px 左导航收成顶部下拉（FY-1 保留）+ 工具栏换行
  assert.match(ADMIN, /@media\(max-width:560px\)\{\.settings-page\{display:block\}\.settings-nav\{display:none\}/, '≤560px 竖排导航隐藏');
  assert.match(ADMIN, /\.settings-toolbar\{flex-wrap:wrap\}/, '≤560px 工具栏换行');
});

// ---------------------------------------------------------------- 反向自检辅助：常量与源码一致性

test('常量与实现一致（防止改常量不改行为）', () => {
  assert.equal(MERGE_WINDOW_MS, 1500, '合并窗口 1.5 秒');
  assert.equal(QUIET_FLUSH_MS, 700, '静默窗口 700ms（<1 秒，满足验收 4）');
  assert.equal(INPUT_DEBOUNCE_MS, 600, 'int 防抖 600ms');
  assert.equal(SAVED_FADE_MS, 2000, '✓ 已保存 2 秒后淡出');
  for (const token of ['MERGE_WINDOW_MS', 'QUIET_FLUSH_MS', 'INPUT_DEBOUNCE_MS', 'SAVED_FADE_MS']) {
    assert.match(SAVER, new RegExp(`export const ${token} = `), `${token} 由 settingsSave.js 导出（前端与测试共用一份）`);
  }
});
