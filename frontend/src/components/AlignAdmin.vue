<script setup>
// CD 批（docs/SONKWO-STEAM-MATCH.md §4.4）：对齐审核——去重组队列 + 合并预览 + 确认/忽略/手动搜索。
// CN 批（docs/ALIGN-QUERY-PERF.md §2/§3）：服务端缓存 + 分页读；本页显示生成时间/缓存状态，partial 时提示。
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import PaginationBar from './PaginationBar.vue';
import { redirectToLogin } from '../utils/session.js';
import { fmtDateTime } from '../utils/siteTime.js';

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

const groups = ref([]);
const total = ref(0);
const inherited = ref(0);
const meta = ref({ generatedAt: null, cached: false, partial: false });
const loading = ref(false);
const refreshing = ref(false);
const page = ref(1);
const pageSize = ref(20);

async function load(opts = {}) {
  const { refresh = false } = opts;
  if (refresh) refreshing.value = true; else loading.value = true;
  try {
    const d = await api(`/api/admin/align?page=${page.value}&pageSize=${pageSize.value}${refresh ? '&refresh=1' : ''}`);
    groups.value = d.groups || [];
    total.value = d.total || 0;
    inherited.value = d.inherited || 0;
    meta.value = { generatedAt: d.generatedAt ?? null, cached: d.cached ?? false, partial: d.partial ?? false };
  } catch (e) { notifyError(e); } finally { loading.value = false; refreshing.value = false; }
}

const preview = ref({ visible: false, row: null, data: null, loading: false });

async function openPreview(row) {
  if (!row.candidate?.steamAppid) return ElMessage.warning('该组没有候选，请用「换候选」手动搜索指定目标。');
  preview.value = { visible: true, row, data: null, loading: true };
  try {
    const d = await api(`/api/admin/align/preview?key=${encodeURIComponent(row.key)}`);
    preview.value.data = d;
  } catch (e) { notifyError(e); preview.value.visible = false; } finally { preview.value.loading = false; }
}

async function doConfirm() {
  const { row, data } = preview.value;
  if (!row || !data) return;
  try {
    await ElMessageBox.confirm(
      `把「${row.name}」（${row.skuCount} 个 SKU）对齐到 ${data.target.name}（appid ${data.target.steamAppid}）？` +
        `\n将迁移 ${data.orphans.length} 个孤立游戏行的报价与快照、删除源行、丢弃重复报价；该操作不可自动撤销。`,
      '合并预览',
      { type: 'warning', confirmButtonText: '确认合并', cancelButtonText: '取消' },
    );
    await api('/api/admin/align/confirm', { method: 'POST', body: JSON.stringify({ key: row.key, appid: data.target.steamAppid, method: row.method || 'manual' }) });
    ElMessage.success('已确认并对齐整组');
    preview.value.visible = false;
    await load();
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') notifyError(e);
  }
}

async function ignoreGroup(row) {
  try {
    await ElMessageBox.confirm(`忽略「${row.name}」（${row.skuCount} 个 SKU）？同组新 SKU 会自动继承忽略，不再排队。`, '忽略该组', { type: 'warning' });
    await api('/api/admin/align/ignore', { method: 'POST', body: JSON.stringify({ key: row.key }) });
    ElMessage.success('已忽略整组');
    await load();
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') notifyError(e);
  }
}

const search = ref({ visible: false, row: null, q: '', games: [], loading: false });

async function openSearch(row) {
  search.value = { visible: true, row, q: '', games: [], loading: false };
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
  try {
    await ElMessageBox.confirm(`把「${row.name}」（${row.skuCount} 个 SKU）对齐到 ${game.name || game.name_en}（appid ${game.steam_appid}）？将合并孤立行、不可自动撤销。`, '手动指定目标', { type: 'warning' });
    await api('/api/admin/align/confirm', { method: 'POST', body: JSON.stringify({ key: row.key, appid: game.steam_appid, method: 'manual' }) });
    ElMessage.success('已确认并对齐整组');
    search.value.visible = false;
    await load();
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') notifyError(e);
  }
}

onMounted(() => load());
</script>

<template>
  <div>
    <div class="module-card table-card">
      <div class="card-heading padded">
        <div><h3>对齐审核</h3><p>杉果 SKU 按「去重组」排队：同一款游戏的多条 SKU 只出现一行，确认/忽略一次处理整组；已确认/已忽略的决定对同组新 SKU 自动继承。队列计数按组。</p></div>
        <el-button :loading="refreshing" :disabled="loading" @click="load({ refresh: true })">刷新</el-button>
      </div>
      <p v-if="inherited" class="align-inherit muted">本次自动继承已确认/已忽略映射 {{ inherited }} 条。</p>
      <el-alert v-if="meta.partial" class="align-partial" type="warning" :closable="false"
        title="匹配计算超时，当前为部分结果" description="服务端已按 20 秒预算截断计算，稍后点击「刷新」可继续（其余接口不受影响）。" />
      <p class="align-meta muted">生成于 {{ fmtDateTime(meta.generatedAt) }}（{{ meta.cached ? '缓存' : '本次计算' }}）</p>
      <el-table :data="groups" v-loading="loading" stripe>
        <el-table-column prop="name" label="杉果名（组）" min-width="220" show-overflow-tooltip />
        <el-table-column label="SKU 数" width="80" align="right"><template #default="{ row }">{{ row.skuCount }}</template></el-table-column>
        <el-table-column label="候选" min-width="200"><template #default="{ row }"><span v-if="row.candidate">{{ row.candidate.name }}<small class="muted">（appid {{ row.candidate.steamAppid }}）</small></span><span v-else class="muted">—</span></template></el-table-column>
        <el-table-column label="分数" width="80" align="right"><template #default="{ row }">{{ row.score == null ? '—' : row.score.toFixed(2) }}</template></el-table-column>
        <el-table-column label="方式" width="90"><template #default="{ row }">{{ row.method || '—' }}</template></el-table-column>
        <el-table-column label="建议" width="110"><template #default="{ row }"><el-tag v-if="row.auto" type="success" size="small">自动</el-tag><el-tag v-else-if="row.score != null" type="warning" size="small">待确认{{ row.reasons?.length ? `（${row.reasons.join('、')}）` : '' }}</el-tag><el-tag v-else type="info" size="small">无候选</el-tag></template></el-table-column>
        <el-table-column label="操作" width="190" fixed="right"><template #default="{ row }">
          <el-button link type="primary" @click="openPreview(row)">确认</el-button>
          <el-button link @click="openSearch(row)">换候选</el-button>
          <el-button link type="danger" @click="ignoreGroup(row)">忽略</el-button>
        </template></el-table-column>
      </el-table>
      <PaginationBar v-model:page="page" v-model:page-size="pageSize" :total="total" @change="load()" />
      <el-empty v-if="!groups.length && !loading" description="没有待对齐的组（新 SKU 会在杉果同步后进入队列）" />
    </div>

    <el-dialog v-model="preview.visible" title="合并预览" width="min(560px, 92vw)">
      <template v-if="preview.loading">加载中…</template>
      <template v-else-if="preview.data">
        <p>目标：<strong>{{ preview.data.target.name }}</strong>（appid {{ preview.data.target.steamAppid }}）</p>
        <p class="muted">本组 {{ preview.data.skuIds.length }} 个 SKU 将一次处理；以下孤立游戏行会被合并（迁移报价/快照、删除源行、丢弃重复报价）：</p>
        <ul class="align-orphans">
          <li v-for="o in preview.data.orphans" :key="o.id">{{ o.name }}（报价 {{ o.offers }} · 快照 {{ o.snapshots }}）</li>
          <li v-if="!preview.data.orphans.length" class="muted">无孤立游戏行需要合并</li>
        </ul>
        <el-alert type="warning" :closable="false" title="该操作不可自动撤销" />
      </template>
      <template #footer><el-button @click="preview.visible = false">取消</el-button><el-button type="primary" :disabled="!preview.data" @click="doConfirm">确认合并</el-button></template>
    </el-dialog>

    <el-dialog v-model="search.visible" title="手动指定目标" width="min(560px, 92vw)">
      <div class="align-search"><el-input v-model="search.q" placeholder="按名称 / 英文名 / AppID 搜索 Steam 游戏" @keyup.enter="runSearch" /><el-button type="primary" :loading="search.loading" @click="runSearch">搜索</el-button></div>
      <ul class="align-results">
        <li v-for="g in search.games" :key="g.steam_appid"><span>{{ g.name }}<small class="muted">{{ g.name_en }} · appid {{ g.steam_appid }}</small></span><el-button link type="primary" @click="pickGame(g)">选用</el-button></li>
      </ul>
      <template #footer><el-button @click="search.visible = false">关闭</el-button></template>
    </el-dialog>
  </div>
</template>

<style scoped>
.align-inherit{margin:0 16px 10px}.align-meta{margin:0 16px 6px;font-size:12px}.align-partial{margin:0 16px 10px}.align-orphans{margin:8px 0 14px;padding-left:18px}.align-orphans li{margin:4px 0;font-size:12px}.align-search{display:flex;gap:8px}.align-search .el-input{flex:1}.align-results{list-style:none;margin:12px 0 0;padding:0}.align-results li{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid var(--border);font-size:13px}.align-results small{display:block;font-size:11px}
</style>
