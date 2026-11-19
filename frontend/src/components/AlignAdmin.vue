<script setup>
// DE 批（docs/ALIGN-REVIEW-UI.md）：对齐审核页按 demo 重做——
// 头部状态徽标（已生成/生成中/生成失败 + 生成于 HH:mm + 刷新）→ 5 统计卡 →
// 生成中进度条（X/Y，Y 在分组后立即上报，不再 0/0，可先用旧结果）→
// 工具栏（搜索 + 全部/高置信/需人工/无候选/已忽略 5 chip + 批量确认/忽略）→
// 表格（勾选/组名/SKU 数/候选/分数色条/方式/建议徽标/操作/链接明细）→ 明细展开面板 → 分页。
// 空态互斥：仅「已完成且 0 组」显示「没有待对齐的组」；生成中不显示空态；筛选无命中给轻提示。
// 筛选/搜索前端过滤（队列数据量小）：前端拉全量行（分页 50 逐页取），本地筛选 + 本地分页。
// 风险控制 = 二次确认弹窗（单组显示组名+候选+合并预览；批量显示「将确认 N 组、合并 M 条孤儿行」）+ 审计 + 结果提示。
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import PaginationBar from './PaginationBar.vue';
import { redirectToLogin } from '../utils/session.js';
import { fmtDateTime, siteTimezone } from '../utils/siteTime.js';

function api(path, options = {}) {
  return fetch(path, { credentials: 'same-origin', ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } }).then(async (r) => {
    const t = await r.text();
    let d = {};
    try { d = t ? JSON.parse(t) : {}; } catch { /* 非 JSON */ }
    if (r.status === 401) { redirectToLogin(); throw new Error(d.error || '登录已过期'); }
    if (!r.ok) throw Object.assign(new Error(d.error || `HTTP ${r.status}`), { status: r.status });
    return d;
  });
}
function notifyError(e) { ElMessage.error(e?.message || String(e)); }

/** 「生成于 YYYY-MM-DD HH:mm」（demo 口径，站点时区，不带秒）。 */
function fmtMin(value) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: siteTimezone(),
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d);
  } catch {
    return fmtDateTime(value);
  }
}

const REASON_TEXT = {
  content_word: '内容词',
  number_conflict: '数字不一致',
  score_below_auto: '低于自动阈值',
  title_too_short: '标题过短',
  subtitle: '副标题匹配',
};
function reasonText(reasons) { return (reasons || []).map((r) => REASON_TEXT[r] || r).join('、'); }

// ── 数据状态 ──────────────────────────────────────────────
const allRows = ref([]);        // 新结果全量行
const staleRows = ref([]);      // 生成期间的旧结果（可为空）
const usingStale = ref(false);
const counts = ref(null);       // 新结果 counts（5 统计卡）
const staleCounts = ref(null);
const generatedAt = ref(null);
const staleGeneratedAt = ref(null);
const partial = ref(false);
const generating = reactive({ active: false, processed: 0, total: 0, failed: false, error: '' });
const loading = ref(false);
const refreshing = ref(false);
const loadError = ref(false); // 最近一次加载是否失败（失败时空态不得显示「没有待对齐的组」）

const displayedRows = computed(() => (usingStale.value ? staleRows.value : allRows.value));
const shownCounts = computed(() => (usingStale.value ? staleCounts.value : counts.value));
const shownGeneratedAt = computed(() => (usingStale.value ? staleGeneratedAt.value : generatedAt.value));
const progressPct = computed(() => {
  const t = generating.total || 0;
  if (!t) return 0;
  return Math.min(100, Math.max(0, Math.round(((generating.processed || 0) / t) * 100)));
});

let pollTimer = null;
function schedulePoll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(() => load(), 3000);
}

/**
 * 拉全量行：pageSize=50 逐页取（队列数据量小）。
 * - 200：返回 { fresh: true, rows, counts, generatedAt, partial }；
 * - 202 + stale：逐页收集旧结果，返回 { fresh: false, rows, counts, generatedAt, gen }；
 * - 202 无 stale：返回 { fresh: false, rows: null, gen }（冷生成中，无旧数据）。
 * 中途若 202 转 200（生成完成），丢弃已收集的旧行、从第 1 页重收。
 */
async function collectAll(refresh) {
  const rows = [];
  let pageIdx = 1;
  let meta = null;
  let staleSeen = false;
  for (let guard = 0; guard < 40; guard += 1) {
    const d = await api(`/api/admin/align?page=${pageIdx}&pageSize=50${refresh ? '&refresh=1' : ''}`);
    if (d.generating) {
      if (d.stale) {
        staleSeen = true;
        rows.push(...(d.cachedRows || []));
        if (rows.length >= d.cachedTotal) {
          return {
            fresh: false,
            rows,
            counts: d.cachedCounts,
            generatedAt: d.cachedGeneratedAt ?? null,
            gen: { active: true, processed: d.processed ?? 0, total: d.total ?? 0, failed: Boolean(d.failed), error: d.error || '' },
          };
        }
        pageIdx += 1;
        continue;
      }
      return {
        fresh: false,
        rows: null,
        gen: { active: true, processed: d.processed ?? 0, total: d.total ?? 0, failed: Boolean(d.failed), error: d.error || '' },
      };
    }
    if (staleSeen) {
      // 生成完成：丢弃旧行，从第 1 页重收新结果
      staleSeen = false;
      rows.length = 0;
      meta = null;
      pageIdx = 0;
    }
    if (meta === null) meta = { counts: d.counts, generatedAt: d.generatedAt ?? null, partial: Boolean(d.partial), total: d.total ?? 0 };
    rows.push(...(d.groups || []));
    if (rows.length >= meta.total) return { fresh: true, rows, ...meta };
    pageIdx += 1;
  }
  return { fresh: false, rows: null, gen: { active: true, processed: 0, total: 0, failed: false, error: '' } };
}

async function load(opts = {}) {
  const { refresh = false } = opts;
  if (refresh) refreshing.value = true; else loading.value = true;
  try {
    loadError.value = false; // 拿到任何合法响应（200 / 202）都不算失败
    const collected = await collectAll(refresh);
    if (collected.fresh) {
      allRows.value = collected.rows;
      usingStale.value = false;
      counts.value = collected.counts;
      generatedAt.value = collected.generatedAt;
      partial.value = collected.partial;
      Object.assign(generating, { active: false, processed: 0, total: 0, failed: false, error: '' });
      clearTimeout(pollTimer);
    } else if (collected.rows !== null) {
      staleRows.value = collected.rows;
      usingStale.value = true;
      staleCounts.value = collected.counts;
      staleGeneratedAt.value = collected.generatedAt;
      Object.assign(generating, collected.gen);
      schedulePoll();
    } else {
      // 冷生成中、无旧数据：只显示进度横幅，不显示空态
      staleRows.value = [];
      usingStale.value = false;
      staleCounts.value = null;
      Object.assign(generating, collected.gen);
      schedulePoll();
    }
  } catch (e) {
    loadError.value = true;
    notifyError(e);
    if (generating.active) schedulePoll(); // 生成中轮询失败继续重试
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

// ── 筛选 / 搜索 / 分页（前端过滤，数据量小）────────────────────
const query = ref('');
const filter = ref('all'); // all | high | manual | none | ignored
const page = ref(1);
const pageSize = ref(20);

const filteredRows = computed(() => {
  const q = query.value.trim().toLowerCase();
  return displayedRows.value.filter((row) => {
    if (filter.value === 'high' && !(row.score != null && row.score >= 0.94)) return false;
    if (filter.value === 'manual' && !(row.score != null && row.score >= 0.86 && row.score < 0.94)) return false;
    if (filter.value === 'none' && row.score != null) return false;
    if (filter.value === 'ignored') return false; // 已忽略组不在待对齐队列（查看/恢复随 DH 批提供）
    if (q) {
      const hay = [row.name, row.nameEn, row.candidate?.name].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
});
const pagedRows = computed(() => {
  const start = (page.value - 1) * pageSize.value;
  return filteredRows.value.slice(start, start + pageSize.value);
});
watch([query, filter], () => { page.value = 1; });

// DN 批（docs/TODO.md DN）：内容词自动归档组数（counts.contentWords，跨轮稳定）
const contentWords = computed(() => shownCounts.value?.contentWords ?? 0);

const chips = computed(() => {
  const c = shownCounts.value;
  return [
    { key: 'all', label: '全部', n: c?.groups ?? 0 },
    { key: 'high', label: '高置信', n: c?.auto ?? 0 },
    { key: 'manual', label: '需人工', n: c?.manual ?? 0 },
    { key: 'none', label: '无候选', n: c?.noCandidate ?? 0 },
    // DH 批：真实已忽略组数（GET /api/admin/align/ignored，含内容词自动归档）；
    // DN 批：计数包含内容词归档并在 chip 旁注明（口径见 DN 条目）。
    { key: 'ignored', label: '已忽略', n: ignored.total, note: contentWords.value > 0 ? `内容词自动归档 ${contentWords.value}` : null },
  ];
});

// ── 表格：勾选 / 明细展开 ────────────────────────────────────
const alignTable = ref(null);
const selectedRows = ref([]);
function onSelection(rows) { selectedRows.value = rows; }
function toggleDetail(row) { alignTable.value?.toggleRowExpansion(row); }
watch(displayedRows, () => {
  page.value = 1;
  selectedRows.value = [];
  alignTable.value?.clearSelection?.();
});

function scoreClass(score) {
  if (score == null) return 'lo';
  if (score >= 0.94) return 'hi';
  return 'mid';
}
function scoreBarPct(score) {
  if (score == null) return 0;
  return Math.max(4, Math.round(score * 100));
}
function suggest(row) {
  if (!row.candidate) return { type: 'info', text: '无候选' };
  if (row.contentWord) return { type: 'warning', text: '需人工 · 内容词' };
  if (row.auto) return { type: 'success', text: '高置信' };
  return { type: 'warning', text: '需人工' };
}
function rowNote(row) {
  if (row.contentWord) return '内容词';
  if ((row.reasons || []).includes('subtitle')) return '副标题匹配';
  if (!row.auto) return '需人工';
  return '';
}

// ── 单组确认（二次确认弹窗：组名 + 候选 + 合并预览 + 审计）────────
const confirmDlg = reactive({ visible: false, row: null, data: null, loading: false, submitting: false });

async function openConfirm(row) {
  if (!row.candidate?.steamAppid) return ElMessage.warning('该组没有候选，请用「换候选」手动搜索指定目标。');
  confirmDlg.row = row;
  confirmDlg.data = null;
  confirmDlg.loading = true;
  confirmDlg.submitting = false;
  confirmDlg.visible = true;
  try {
    confirmDlg.data = await api(`/api/admin/align/preview?key=${encodeURIComponent(row.key)}`);
  } catch (e) {
    notifyError(e);
    confirmDlg.visible = false;
  } finally {
    confirmDlg.loading = false;
  }
}
async function submitConfirm() {
  const { row, data } = confirmDlg;
  if (!row || !data) return;
  confirmDlg.submitting = true;
  try {
    const r = await api('/api/admin/align/confirm', {
      method: 'POST',
      body: JSON.stringify({ key: row.key, appid: data.target.steamAppid, method: row.method || 'manual' }),
    });
    ElMessage.success(`已确认并对齐整组${r.merged ? `（合并孤儿行 ${r.merged} 条）` : ''}`);
    confirmDlg.visible = false;
    await load();
  } catch (e) {
    notifyError(e);
  } finally {
    confirmDlg.submitting = false;
  }
}

// ── 批量确认 / 批量忽略 ───────────────────────────────────────
const batchConfirmDlg = reactive({ visible: false, rows: [], previews: [], loading: false, submitting: false });
const batchIgnoreDlg = reactive({ visible: false, rows: [], submitting: false });

const batchOrphans = computed(() => {
  const names = [];
  for (const p of batchConfirmDlg.previews) for (const o of p.orphans || []) if (!names.includes(o.name)) names.push(o.name);
  return { count: batchConfirmDlg.previews.reduce((s, p) => s + (p.orphans?.length || 0), 0), names };
});
const batchSkuTotal = computed(() => batchConfirmDlg.rows.reduce((s, r) => s + r.skuCount, 0));
const ignoreSkuTotal = computed(() => batchIgnoreDlg.rows.reduce((s, r) => s + r.skuCount, 0));

function openBatchConfirm() {
  const rows = selectedRows.value.filter((r) => r.candidate?.steamAppid != null);
  if (rows.length !== selectedRows.value.length) {
    return ElMessage.warning('所选组中有无候选的组，请先取消勾选或对它们单独「换候选」处理。');
  }
  if (!rows.length) return;
  batchConfirmDlg.rows = rows;
  batchConfirmDlg.previews = [];
  batchConfirmDlg.loading = true;
  batchConfirmDlg.submitting = false;
  batchConfirmDlg.visible = true;
  api(`/api/admin/align/preview?keys=${encodeURIComponent(rows.map((r) => r.key).join(','))}`)
    .then((d) => { batchConfirmDlg.previews = d.previews || []; })
    .catch((e) => { notifyError(e); batchConfirmDlg.visible = false; })
    .finally(() => { batchConfirmDlg.loading = false; });
}
async function submitBatchConfirm() {
  const rows = batchConfirmDlg.rows;
  if (!rows.length) return;
  batchConfirmDlg.submitting = true;
  try {
    const r = await api('/api/admin/align/confirm', { method: 'POST', body: JSON.stringify({ keys: rows.map((x) => x.key) }) });
    const errs = (r.results || []).filter((x) => x.error);
    if (errs.length) ElMessage.warning(`部分组失败：${errs.map((x) => `${x.key}：${x.error}`).join('；')}`);
    else ElMessage.success(`已确认 ${r.results?.length ?? rows.length} 组${r.totalMerged ? `（合并孤儿行 ${r.totalMerged} 条）` : ''}`);
    batchConfirmDlg.visible = false;
    await load();
  } catch (e) {
    notifyError(e);
  } finally {
    batchConfirmDlg.submitting = false;
  }
}

function openBatchIgnore() {
  if (!selectedRows.value.length) return;
  batchIgnoreDlg.rows = selectedRows.value;
  batchIgnoreDlg.submitting = false;
  batchIgnoreDlg.visible = true;
}
async function submitBatchIgnore() {
  const rows = batchIgnoreDlg.rows;
  if (!rows.length) return;
  batchIgnoreDlg.submitting = true;
  try {
    const r = await api('/api/admin/align/ignore', { method: 'POST', body: JSON.stringify({ keys: rows.map((x) => x.key) }) });
    const errs = (r.results || []).filter((x) => x.error);
    if (errs.length) ElMessage.warning(`部分组失败：${errs.map((x) => `${x.key}：${x.error}`).join('；')}`);
    else ElMessage.success(`已忽略 ${r.results?.length ?? rows.length} 组（${r.ignored ?? ignoreSkuTotal.value} 个 SKU）`);
    batchIgnoreDlg.visible = false;
    await load();
    await loadIgnored(); // DH 批：已忽略 chip 计数同步刷新
  } catch (e) {
    notifyError(e);
  } finally {
    batchIgnoreDlg.submitting = false;
  }
}

// ── 单组忽略 / 换候选 ─────────────────────────────────────────
async function ignoreGroup(row) {
  try {
    await ElMessageBox.confirm(
      `忽略「${row.name}」（${row.skuCount} 个 SKU）？同组新 SKU 会自动继承忽略，不再排队。本次操作记入审计日志。`,
      '忽略该组',
      { type: 'warning', confirmButtonText: '确认忽略', cancelButtonText: '取消' },
    );
    await api('/api/admin/align/ignore', { method: 'POST', body: JSON.stringify({ key: row.key }) });
    ElMessage.success('已忽略整组');
    await load();
    await loadIgnored(); // DH 批：已忽略 chip 计数同步刷新
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') notifyError(e);
  }
}

const search = ref({ visible: false, row: null, q: '', games: [], loading: false, picking: null });

async function openSearch(row) {
  search.value = { visible: true, row, q: '', games: [], loading: false, picking: null };
}
async function runSearch() {
  const kw = search.value.q.trim();
  if (!kw) return;
  search.value.loading = true;
  try {
    const d = await api(`/api/admin/align/search?q=${encodeURIComponent(kw)}`);
    search.value.games = d.games || [];
    if (!search.value.games.length) ElMessage.info('没有匹配的 Steam 游戏');
  } catch (e) { notifyError(e); } finally { search.value.loading = false; }
}
async function pickGame(game) {
  const { row } = search.value;
  search.value.picking = game.steam_appid;
  try {
    await ElMessageBox.confirm(
      `把「${row.name}」（${row.skuCount} 个 SKU）对齐到 ${game.name || game.name_en}（appid ${game.steam_appid}）？将合并孤立行、不可自动撤销；本次操作记入审计日志。`,
      '手动指定目标',
      { type: 'warning', confirmButtonText: '确认合并', cancelButtonText: '取消' },
    );
    await api('/api/admin/align/confirm', { method: 'POST', body: JSON.stringify({ key: row.key, appid: game.steam_appid, method: 'manual' }) });
    ElMessage.success('已确认并对齐整组');
    search.value.visible = false;
    await load();
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') notifyError(e);
  } finally {
    search.value.picking = null;
  }
}

// ── DH 批（docs/ALIGN-INTEGRITY.md）：已忽略视图 / 恢复为待处理（二次确认）/ 审阅记录抽屉 ──
const view = ref('queue'); // queue | ignored
const ignored = reactive({ rows: [], total: 0, loading: false });

async function loadIgnored() {
  ignored.loading = true;
  try {
    const d = await api('/api/admin/align/ignored');
    ignored.rows = d.groups || [];
    ignored.total = d.total ?? 0;
  } catch (e) {
    notifyError(e);
  } finally {
    ignored.loading = false;
  }
}
function showIgnoredView() {
  view.value = 'ignored';
  loadIgnored();
}
function onChip(c) {
  if (c.key === 'ignored') { showIgnoredView(); return; }
  filter.value = c.key;
  view.value = 'queue';
}
async function restoreIgnored(row) {
  try {
    // §5.2：恢复已忽略需要二次确认（避免误恢复大批量）
    await ElMessageBox.confirm(
      `恢复「${row.name}」（${row.skus.length} 个 SKU）为待处理？该组会重新回到对齐队列等待处理。本次操作记入审计日志。`,
      '恢复已忽略组',
      { type: 'warning', confirmButtonText: '确认恢复', cancelButtonText: '取消' },
    );
    const r = await api('/api/admin/align/restore', { method: 'POST', body: JSON.stringify({ key: row.key }) });
    ElMessage.success(`已恢复 ${r.restored} 个 SKU 为待处理`);
    await loadIgnored();
    await load();
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') notifyError(e);
  }
}

const ACTION_TEXT = { confirmed: '确认', ignored: '忽略', pending: '恢复' };
const history = reactive({ visible: false, row: null, records: [], loading: false });
async function openHistory(row) {
  history.row = row;
  history.records = [];
  history.loading = true;
  history.visible = true;
  try {
    const d = await api(`/api/admin/align/history?key=${encodeURIComponent(row.key)}`);
    history.records = d.records || [];
  } catch (e) {
    notifyError(e);
  } finally {
    history.loading = false;
  }
}

onMounted(() => { load(); loadIgnored(); });
onUnmounted(() => clearTimeout(pollTimer));
</script>

<template>
  <div class="align-admin">
    <!-- 头部：标题 + 说明 + 状态徽标 + 生成时间 + 刷新 -->
    <div class="align-head">
      <div>
        <h3>对齐审核</h3>
        <p>杉果 SKU 按「去重组」排队：同一款游戏的多条 SKU 只出现一行，确认/忽略一次处理整组；已确认/已忽略的决定对同组新 SKU 自动继承。队列计数按组。</p>
      </div>
      <div class="align-head-right">
        <el-tag v-if="generating.active && generating.failed" type="danger" effect="dark" size="small">生成失败</el-tag>
        <el-tag v-else-if="generating.active" type="warning" effect="dark" size="small">生成中</el-tag>
        <el-tag v-else type="success" effect="dark" size="small">已生成</el-tag>
        <el-tag v-if="partial" type="warning" size="small" effect="plain">部分结果</el-tag>
        <span class="muted" v-if="shownGeneratedAt">生成于 {{ fmtMin(shownGeneratedAt) }}<template v-if="usingStale">（旧结果）</template></span>
        <el-button :loading="refreshing" :disabled="loading" @click="load({ refresh: true })">刷新</el-button>
      </div>
    </div>

    <!-- 5 统计卡（全局统计，不随筛选变化） -->
    <div class="align-stats">
      <div class="align-stat"><div class="k">待对齐组</div><div class="v">{{ shownCounts?.groups ?? '—' }}</div></div>
      <div class="align-stat"><div class="k">涉及 SKU</div><div class="v">{{ shownCounts?.skus ?? '—' }}</div></div>
      <div class="align-stat"><div class="k">自动匹配（≥0.94）</div><div class="v auto">{{ shownCounts?.auto ?? '—' }}</div></div>
      <div class="align-stat"><div class="k">需人工（0.86–0.94）</div><div class="v manual">{{ shownCounts?.manual ?? '—' }}</div></div>
      <div class="align-stat"><div class="k">本次自动继承</div><div class="v">{{ shownCounts?.inherited ?? '—' }}<small v-if="shownCounts">条</small></div></div>
    </div>

    <!-- 进度横幅：仅生成中显示（失败为红色错误条，成功前可先用旧结果） -->
    <div v-if="generating.active" class="align-banner" :class="{ failed: generating.failed }">
      <span>{{ generating.failed ? '⚠️' : '⏳' }}</span>
      <div class="align-banner-title">{{ generating.failed ? `生成失败：${generating.error || '未知错误'}` : '后台生成中' }}</div>
      <template v-if="!generating.failed">
        <div class="align-bar"><i :style="{ width: `${progressPct}%` }" /></div>
        <div class="align-banner-num">已完成 {{ generating.processed }} / 共 {{ generating.total }} 组</div>
      </template>
      <span class="align-banner-hint">{{ generating.failed ? '将自动重试' : usingStale ? '（完成后自动刷新，可先用旧结果）' : '（完成后自动刷新）' }}</span>
    </div>

    <!-- 工具栏：搜索 + 5 筛选 chip + 批量确认/忽略（批量只在队列视图显示） -->
    <div class="align-toolbar">
      <el-input v-model="query" class="align-search" clearable placeholder="搜索杉果 SKU 名 / 候选游戏名" />
      <button v-for="c in chips" :key="c.key" type="button" class="align-chip"
        :class="{ on: c.key === 'ignored' ? view === 'ignored' : (view === 'queue' && filter === c.key) }"
        @click="onChip(c)">{{ c.label }} <strong>{{ c.n }}</strong><small v-if="c.note" class="align-chip-note">（{{ c.note }}）</small></button>
      <el-button v-if="view === 'queue'" size="small" type="primary" plain :disabled="!selectedRows.length" :loading="batchConfirmDlg.submitting" @click="openBatchConfirm">批量确认{{ selectedRows.length ? `（${selectedRows.length}）` : '' }}</el-button>
      <el-button v-if="view === 'queue'" size="small" type="danger" plain :disabled="!selectedRows.length" :loading="batchIgnoreDlg.submitting" @click="openBatchIgnore">批量忽略{{ selectedRows.length ? `（${selectedRows.length}）` : '' }}</el-button>
    </div>

    <!-- 表格：队列视图 / 已忽略视图（DH 批：已忽略 chip 切换视图，恢复为待处理需二次确认） -->
    <div class="module-card table-card align-card" v-loading="loading">
      <el-table v-if="view === 'queue' && displayedRows.length > 0" ref="alignTable" class="align-table" row-key="key" :data="pagedRows" :empty-text="' '" stripe
        @selection-change="onSelection">
        <el-table-column type="expand" width="30">
          <template #default="{ row }">
            <div class="align-detail">
              <div class="align-detail-skus">
                <span class="muted">该组全部 SKU 杉果链接：</span>
                <a v-for="(u, i) in row.skuUrls" :key="row.skuIds[i]" :href="u" target="_blank" rel="noopener noreferrer">SKU {{ row.skuIds[i] }} ↗</a>
              </div>
              <div class="align-detail-cands">
                <div v-for="c in row.candidates" :key="c.steamAppid ?? c.name" class="align-detail-cand">
                  <div class="n">
                    <a :href="c.steamUrl" target="_blank" rel="noopener noreferrer">{{ c.name }}</a>
                    <span class="muted mono">appid {{ c.steamAppid }}</span>
                  </div>
                  <div class="m">
                    <span class="align-detail-score" :class="scoreClass(c.score)">{{ c.score.toFixed(2) }}</span>
                    <span class="muted" v-if="reasonText(c.reasons)">· {{ reasonText(c.reasons) }}</span>
                    <span class="muted">· 来源 Steam（命中 {{ c.matchedField }}）</span>
                  </div>
                </div>
                <div v-if="!row.candidates.length" class="muted">无候选（可点「换候选」手动搜索指定目标）。</div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column type="selection" width="44" />
        <el-table-column label="杉果名（组）" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            <div class="align-gname"><b>{{ row.name }}</b><div v-if="row.nameEn" class="en">{{ row.nameEn }}</div></div>
          </template>
        </el-table-column>
        <el-table-column label="SKU 数" width="84" align="right">
          <template #default="{ row }"><span class="muted">{{ row.skuCount }}</span></template>
        </el-table-column>
        <el-table-column label="候选" min-width="210">
          <template #default="{ row }">
            <div v-if="row.candidate" class="align-cand">
              <div class="n">{{ row.candidate.name }}</div>
              <div class="m">Steam · appid {{ row.candidate.steamAppid }}<template v-if="row.contentWord"> · 疑似本体（SKU 含内容词）</template></div>
            </div>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="分数" width="118">
          <template #default="{ row }">
            <div class="align-score">
              <div class="b" :class="scoreClass(row.score)"><i :class="scoreClass(row.score)" :style="{ width: `${scoreBarPct(row.score)}%` }" /></div>
              <span>{{ row.score == null ? '—' : row.score.toFixed(2) }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="方式" width="92">
          <template #default="{ row }"><span class="muted">{{ row.method || '—' }}</span></template>
        </el-table-column>
        <el-table-column label="建议" width="150">
          <template #default="{ row }">
            <el-tag :type="suggest(row).type" size="small" effect="light">{{ suggest(row).text }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="最近处理" min-width="172">
          <template #default="{ row }">
            <span v-if="row.lastReviewed" class="muted">{{ row.lastReviewed.action }} · {{ row.lastReviewed.by || '系统' }} · {{ fmtMin(row.lastReviewed.at) }}</span>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="196" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" :disabled="!row.candidate" @click="openConfirm(row)">确认</el-button>
            <el-button link @click="openSearch(row)">换候选</el-button>
            <el-button link type="danger" @click="ignoreGroup(row)">忽略</el-button>
          </template>
        </el-table-column>
        <el-table-column label="链接 / 明细" width="232" fixed="right">
          <template #default="{ row }">
            <span class="align-links">
              <a v-if="row.candidate?.steamUrl" :href="row.candidate.steamUrl" target="_blank" rel="noopener noreferrer" class="lnk">Steam ↗</a>
              <a :href="row.skuUrls[0]" target="_blank" rel="noopener noreferrer" class="lnk">杉果 ↗</a>
              <el-button link type="primary" @click="toggleDetail(row)">明细</el-button>
              <el-button link @click="openHistory(row)">记录</el-button>
            </span>
          </template>
        </el-table-column>
      </el-table>

      <!-- DH 批：已忽略视图（组名/SKU/忽略时间/操作人/恢复二次确认）；DN 批：内容词自动归档组标注 -->
      <el-table v-else-if="view === 'ignored'" class="align-table" row-key="key" :data="ignored.rows" v-loading="ignored.loading" stripe>
        <el-table-column label="杉果名（组）" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            <div class="align-gname"><b>{{ row.name }}</b><el-tag v-if="row.method === 'content_word'" type="info" size="small" class="align-cw-tag">内容词自动归档</el-tag></div>
          </template>
        </el-table-column>
        <el-table-column label="SKU" min-width="190">
          <template #default="{ row }">
            <span class="align-links">
              <a v-for="id in row.skus" :key="id" class="lnk" :href="`https://www.sonkwo.hk/sku/${id}`" target="_blank" rel="noopener noreferrer">SKU {{ id }} ↗</a>
            </span>
          </template>
        </el-table-column>
        <el-table-column label="忽略时间" min-width="155">
          <template #default="{ row }"><span class="muted">{{ row.ignoredAt ? fmtMin(row.ignoredAt) : '—' }}</span></template>
        </el-table-column>
        <el-table-column label="操作人" width="110">
          <template #default="{ row }"><span class="muted">{{ row.ignoredBy || '系统' }}</span></template>
        </el-table-column>
        <el-table-column label="操作" width="152" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="restoreIgnored(row)">恢复</el-button>
            <el-button link @click="openHistory(row)">记录</el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页（前端分页：翻页保留筛选；仅队列视图） -->
      <PaginationBar v-if="view === 'queue' && displayedRows.length > 0" v-model:page="page" v-model:page-size="pageSize" :total="filteredRows.length" />

      <!-- 空态互斥：仅「已完成且 0 组」显示；生成中/加载中/加载失败不显示；筛选无命中给轻提示 -->
      <el-empty v-if="view === 'ignored' && !ignored.loading && ignored.rows.length === 0"
        description="没有已忽略的组（忽略的组会在这里列出，可恢复为待处理）" />
      <el-empty v-else-if="view === 'queue' && !generating.active && !loading && !loadError && displayedRows.length === 0"
        description="没有待对齐的组（新 SKU 会在杉果同步后进入队列）" />
      <p v-else-if="view === 'queue' && displayedRows.length > 0 && filteredRows.length === 0" class="align-filter-empty muted">
        没有符合当前筛选的组（可调整搜索或筛选条件）。
      </p>
      <p v-else-if="view === 'queue' && generating.active && displayedRows.length === 0" class="align-filter-empty muted">
        后台生成中，完成后自动展示队列…
      </p>
      <p v-else-if="view === 'queue' && loadError && displayedRows.length === 0" class="align-filter-empty muted">
        队列加载失败，请点「刷新」重试。
      </p>
    </div>

    <!-- 单组确认（二次确认：组名 + 候选 + 合并预览 + 审计） -->
    <el-dialog v-model="confirmDlg.visible" title="确认对齐" width="min(560px, 92vw)">
      <template v-if="confirmDlg.loading">加载中…</template>
      <template v-else-if="confirmDlg.data">
        <div class="align-dlg-line"><b>组</b><span>{{ confirmDlg.row.name }}（{{ confirmDlg.row.skuCount }} 个 SKU）</span></div>
        <div class="align-dlg-line"><b>候选</b><span>{{ confirmDlg.data.target.name }}（appid {{ confirmDlg.data.target.steamAppid }}）<a class="lnk" :href="`https://store.steampowered.com/app/${confirmDlg.data.target.steamAppid}/`" target="_blank" rel="noopener noreferrer">Steam ↗</a></span></div>
        <div class="align-dlg-line"><b>将合并</b><span>{{ confirmDlg.data.orphans.length ? `该组包含 ${confirmDlg.data.orphans.length} 条孤儿游戏行（${confirmDlg.data.orphans.map((o) => o.name).join('、')}），确认后将合并到目标游戏` : '无孤立游戏行需要合并' }}</span></div>
        <div class="align-dlg-line"><b>落地</b><span>写 game_source_map（confirmed），同组新 SKU 自动继承</span></div>
        <el-alert type="warning" :closable="false" title="确认后不可撤销；本次操作记入审计日志。" />
      </template>
      <template #footer>
        <el-button @click="confirmDlg.visible = false">取消</el-button>
        <el-button type="primary" :disabled="!confirmDlg.data" :loading="confirmDlg.submitting" @click="submitConfirm">确认合并</el-button>
      </template>
    </el-dialog>

    <!-- 批量确认（显示将确认 N 组、合并 M 条孤儿行） -->
    <el-dialog v-model="batchConfirmDlg.visible" title="批量确认" width="min(560px, 92vw)">
      <div v-if="batchConfirmDlg.loading" class="muted">加载合并预览…</div>
      <template v-else>
        <div class="align-dlg-list">
          <div v-for="row in batchConfirmDlg.rows" :key="row.key">
            <span class="n">{{ row.name }} → {{ row.candidate?.steamAppid }}</span>
            <span class="muted">{{ row.skuCount }} SKU<template v-if="rowNote(row)"> · {{ rowNote(row) }}</template></span>
          </div>
        </div>
        <div class="align-dlg-line"><b>将确认</b><span>{{ batchConfirmDlg.rows.length }} 组（共 {{ batchSkuTotal }} 个 SKU）</span></div>
        <div class="align-dlg-line"><b>将合并</b><span>{{ batchOrphans.count ? `将合并 ${batchOrphans.count} 条孤儿游戏行（${batchOrphans.names.join('、')}），确认后并入目标游戏` : '无孤立游戏行需要合并' }}</span></div>
        <div class="align-dlg-line"><b>落地</b><span>写 game_source_map（confirmed），同组新 SKU 自动继承</span></div>
        <el-alert type="warning" :closable="false" title="确认后不可撤销；本次操作记入审计日志。" />
      </template>
      <template #footer>
        <el-button @click="batchConfirmDlg.visible = false">取消</el-button>
        <el-button type="primary" :loading="batchConfirmDlg.submitting" @click="submitBatchConfirm">确认 {{ batchConfirmDlg.rows.length }} 组</el-button>
      </template>
    </el-dialog>

    <!-- 批量忽略 -->
    <el-dialog v-model="batchIgnoreDlg.visible" title="批量忽略" width="min(480px, 92vw)">
      <div class="align-dlg-list">
        <div v-for="row in batchIgnoreDlg.rows" :key="row.key">
          <span class="n">{{ row.name }}</span>
          <span class="muted">{{ row.skuCount }} SKU</span>
        </div>
      </div>
      <div class="align-dlg-line"><b>将忽略</b><span>{{ batchIgnoreDlg.rows.length }} 组（共 {{ ignoreSkuTotal }} 个 SKU）；同组新 SKU 会自动继承忽略，不再排队。</span></div>
      <el-alert type="warning" :closable="false" title="本次操作记入审计日志。" />
      <template #footer>
        <el-button @click="batchIgnoreDlg.visible = false">取消</el-button>
        <el-button type="danger" :loading="batchIgnoreDlg.submitting" @click="submitBatchIgnore">确认忽略</el-button>
      </template>
    </el-dialog>

    <!-- 换候选（单组手动搜索，本批范围） -->
    <el-dialog v-model="search.visible" title="手动指定目标" width="min(560px, 92vw)">
      <div class="align-search"><el-input v-model="search.q" placeholder="按名称 / 英文名 / AppID 搜索 Steam 游戏" @keyup.enter="runSearch" /><el-button type="primary" :loading="search.loading" @click="runSearch">搜索</el-button></div>
      <ul class="align-results">
        <li v-for="g in search.games" :key="g.steam_appid">
          <span>{{ g.name }}<small class="muted">{{ g.name_en }} · appid {{ g.steam_appid }}</small></span>
          <el-button link type="primary" :loading="search.picking === g.steam_appid" @click="pickGame(g)">选用</el-button>
        </li>
      </ul>
      <template #footer><el-button @click="search.visible = false">关闭</el-button></template>
    </el-dialog>

    <!-- DH 批：审阅记录抽屉（操作人/时间/动作，确认/忽略/恢复） -->
    <el-drawer v-model="history.visible" title="审阅记录" size="min(480px, 92vw)">
      <div v-if="history.loading" class="muted">加载中…</div>
      <div v-else class="history-list">
        <div v-if="history.row" class="align-dlg-line"><b>组</b><span>{{ history.row.name }}（{{ history.row.skuCount ?? (history.row.skus ? history.row.skus.length : 0) }} 个 SKU）</span></div>
        <el-empty v-if="!history.records.length" description="暂无处理记录" :image-size="48" />
        <div v-for="r in history.records" :key="`${r.product_id}-${r.reviewed_at ?? 'null'}-${r.decision}`" class="history-item">
          <el-tag :type="r.decision === 'ignored' ? 'danger' : r.decision === 'pending' ? 'warning' : 'success'" size="small">{{ ACTION_TEXT[r.decision] || r.decision }}</el-tag>
          <span class="mono">SKU {{ r.product_id }}</span>
          <span class="muted">{{ r.username || '系统' }} · {{ r.reviewed_at ? fmtMin(r.reviewed_at) : '—' }}</span>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
.align-admin{padding:0 2px}
.align-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:4px}
.align-head h3{margin:0 0 2px;font-size:17px}
.align-head p{color:var(--fg-muted);font-size:12px;margin:0}
.align-head-right{margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
.align-head-right .muted{font-size:12px}

/* 统计卡（5 列；移动端两列，第 5 卡跨两列） */
.align-stats{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin:14px 0}
.align-stat{background:var(--panel-2);border:1px solid var(--border);border-radius:12px;padding:10px 13px}
.align-stat .k{font-size:11px;color:var(--fg-muted)}
.align-stat .v{font-size:20px;font-weight:700;margin-top:2px;color:var(--fg)}
.align-stat .v.auto{color:var(--success)}
.align-stat .v.manual{color:var(--warn)}
.align-stat .v small{font-size:11px;color:var(--fg-muted);font-weight:400;margin-left:4px}
@media(max-width:640px){
  .align-stats{grid-template-columns:repeat(2,1fr)}
  .align-stat:last-child{grid-column:span 2}
  .align-head{flex-direction:column;gap:8px}
  .align-head-right{margin-left:0;justify-content:flex-start}
}

/* 生成中进度横幅（失败变红） */
.align-banner{display:flex;align-items:center;gap:12px;background:var(--warn-bg);border:1px solid var(--warn-soft);color:var(--warn);border-radius:12px;padding:10px 14px;margin-bottom:12px;font-size:12.5px;flex-wrap:wrap}
.align-banner.failed{background:var(--danger-bg);border-color:var(--danger-soft);color:var(--danger)}
.align-banner-title{min-width:96px;font-weight:600}
.align-bar{flex:1;min-width:120px;height:6px;border-radius:999px;background:var(--panel-2);overflow:hidden}
.align-bar i{display:block;height:100%;background:linear-gradient(90deg,var(--warn),#f3c06a);border-radius:999px;transition:width .4s}
.align-banner-num{min-width:150px;text-align:right}
.align-banner-hint{opacity:.85}
@media(max-width:640px){.align-banner-num{min-width:0;text-align:left}}

/* 工具栏：搜索 + chips + 批量按钮 */
.align-toolbar{display:flex;gap:9px;align-items:center;margin-bottom:12px;flex-wrap:wrap}
.align-search{flex:1;min-width:240px}
.align-chip{border:1px solid var(--border-2);background:var(--panel-2);color:var(--fg-muted);border-radius:999px;padding:4px 12px;font-size:12px;cursor:pointer}
.align-chip strong{font-weight:600}
.align-chip-note{color:var(--fg-subtle);font-weight:400}
.align-chip.on{background:var(--brand-soft);color:var(--brand);border-color:var(--brand)}
.align-cw-tag{margin-left:7px}

/* 表格内元素 */
.align-card{padding-bottom:0}
.align-table :deep(.el-table__expand-column .cell){display:none}
.align-gname b{font-size:13px;font-weight:700}
.align-gname .en{color:var(--fg-muted);font-size:11px}
.align-cand{min-width:0}
.align-cand .n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px}
.align-cand .m{color:var(--fg-muted);font-size:11px;margin-top:2px}
.align-score{display:flex;align-items:center;gap:7px}
.align-score .b{width:52px;height:5px;border-radius:999px;background:var(--border-2);overflow:hidden;flex:none}
.align-score .b.lo{background:var(--danger-soft)}
.align-score .b i{display:block;height:100%;border-radius:999px}
.align-score i.hi{background:linear-gradient(90deg,var(--success),#7fe0ae)}
.align-score i.mid{background:linear-gradient(90deg,var(--warn),#f3c06a)}
.align-links{display:flex;gap:8px;align-items:center}
.lnk{color:var(--brand);font-size:12px;text-decoration:none;border-bottom:1px dashed var(--brand-soft)}
.lnk:hover{color:var(--brand-2)}

/* 明细展开面板 */
.align-detail{padding:10px 14px;background:var(--panel-2)}
.align-detail-skus{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:8px}
.align-detail-skus a{color:var(--brand);font-size:12px}
.align-detail-cand{display:flex;justify-content:space-between;gap:10px;padding:7px 2px;border-bottom:1px dashed var(--border);font-size:12px;flex-wrap:wrap}
.align-detail-cand:last-child{border-bottom:0}
.align-detail-cand .n{min-width:0}
.align-detail-cand .n a{color:var(--fg);font-weight:600;text-decoration:none}
.align-detail-cand .n a:hover{color:var(--brand)}
.align-detail-cand .m{color:var(--fg-muted);font-size:11px;display:flex;gap:6px;align-items:center}
.align-detail-score{padding:1px 7px;border-radius:999px;font-weight:700;color:#fff}
.align-detail-score.hi{background:var(--success)}
.align-detail-score.mid{background:var(--warn)}
.align-detail-score.lo{background:var(--danger)}

/* 弹窗 */
.align-dlg-line{display:flex;gap:8px;padding:4px 0;font-size:12.5px}
.align-dlg-line b{width:74px;color:var(--fg-muted);font-weight:500;flex:none}
.align-dlg-list{background:var(--panel-2);border:1px solid var(--border);border-radius:8px;padding:6px 9px;margin:6px 0}
.align-dlg-list>div{display:flex;justify-content:space-between;gap:8px;padding:3px 0;font-size:12.5px}
.align-dlg-list .n{color:var(--fg);font-weight:600}
.align-filter-empty{padding:18px 16px;text-align:center;font-size:12px}
.align-search{display:flex;gap:8px}
.align-search .el-input{flex:1}
.align-results{list-style:none;margin:12px 0 0;padding:0}
.align-results li{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid var(--border);font-size:13px}
.align-results small{display:block;font-size:11px}
.history-list{display:flex;flex-direction:column;gap:8px}
.history-item{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--border);border-radius:9px;font-size:12px;flex-wrap:wrap}
.history-item .muted{margin-left:auto}
</style>
