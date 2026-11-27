<script setup>
// FZ 批（docs/VISITORS-REDESIGN.md §2 访问分析 / §1 决策 4/7/11 / §7-3/§7-5）：
// **只读**的访问分析——IP 统计（默认）/ 明细子视图 + 时间窗 1/7/30 + 状态筛选（默认「有效访问」）+ 搜索 + 展开详情。
//
// 只读红线：行内只留「详情」（打开 IP 详情抽屉），**不提供封禁 / 信任**——处置入口只有「异常处置」。
// 口径红线：默认 active 排除已封禁 + 已信任（临时封保留）；切「已封禁 / 已信任 / 全部」可查历史；
// 明细子视图与 IP 统计同一套 status 口径（服务端同源 SQL）。
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import PaginationBar from '../PaginationBar.vue';
import { adminApi, useVisitorsAdmin } from '../../composables/useVisitorsAdmin.js';
import { VISITOR_STATUS_FILTERS, visitorStatusMeta, visitorStatusText } from '../../utils/visitorStatus.js';
import { fmtDateTime as dateTime } from '../../utils/siteTime.js';

const { isMobile, setNavCount, openIpDetail } = useVisitorsAdmin();

const mode = ref('ip');           // ip = IP 统计（默认）/ detail = 明细
const days = ref(7);
const status = ref('active');     // 默认「有效访问」：排除已封禁 + 已信任
const q = ref('');
const loading = ref(false);

// ---- IP 统计（服务端分页）----
const ipRows = ref([]);
const ipTotal = ref(0);
const ipPage = ref(1);
const ipPageSize = ref(20);
const ipDetails = reactive({});
const hidden = reactive({ blocked: 0, trusted: 0 });
// AQ 批（docs/ADMIN-REVIEW-LISTS.md §3）：排序持久化沿用同一 localStorage 键（admin.visitorSort）；
// FZ 批把它作用在 IP 统计视图（访问次数 / 最近访问 / IP），服务端 sort 白名单不变。
const VISITOR_SORT_FIELD = { visits: 'visits', last_at: 'lastAt', ip: 'ip' };
function loadSortState(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    if (v && typeof v.prop === 'string' && (v.order === 'ascending' || v.order === 'descending')) return v;
  } catch { /* 坏数据回落默认 */ }
  return fallback;
}
function saveSortState(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 隐私模式忽略 */ } }
const ipSortState = ref((() => {
  const saved = loadSortState('admin.visitorSort', { prop: 'visits', order: 'descending' });
  // 老的明细排序键 last_at 已无对应列（最近访问收进抽屉），回落访问次数
  return { prop: saved.prop === 'ip' ? 'ip' : 'visits', order: saved.order };
})());
function visitorSortParams() {
  const { prop, order } = ipSortState.value;
  return { sort: VISITOR_SORT_FIELD[prop] || 'visits', order: order === 'ascending' ? 'asc' : 'desc' };
}

// ---- 明细（服务端分页，同口径）----
const rows = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const pathQuery = ref('');

const statusLabel = computed(() => VISITOR_STATUS_FILTERS.find((f) => f.value === status.value)?.label || status.value);

async function loadHiddenCounts() {
  if (status.value !== 'active') return;
  try {
    const [blocked, trusted] = await Promise.all([
      adminApi(`/api/admin/visitors/by-ip?days=${days.value}&status=blocked&pageSize=5`),
      adminApi(`/api/admin/visitors/by-ip?days=${days.value}&status=trusted&pageSize=5`),
    ]);
    hidden.blocked = Number(blocked.total) || 0;
    hidden.trusted = Number(trusted.total) || 0;
  } catch { /* 统计「已隐藏」只是提示，失败不影响列表 */ }
}

async function loadIpStats(pageNo = ipPage.value) {
  ipPage.value = pageNo;
  loading.value = true;
  try {
    const qs = new URLSearchParams({ days: String(days.value), page: String(pageNo), pageSize: String(ipPageSize.value), ...visitorSortParams(), status: status.value });
    if (q.value.trim()) qs.set('q', q.value.trim());
    const d = await adminApi(`/api/admin/visitors/by-ip?${qs}`);
    ipRows.value = d.items || [];
    ipTotal.value = Number(d.total) || 0;
    // 左侧导航「访问分析」徽标 = 默认口径下的 IP 数
    if (status.value === 'active' && !q.value.trim()) setNavCount('analysis', ipTotal.value);
    await loadHiddenCounts();
  } catch (e) {
    ElMessage.error(e?.message || String(e));
  } finally {
    loading.value = false;
  }
}

async function loadDetail(pageNo = page.value) {
  page.value = pageNo;
  loading.value = true;
  try {
    const qs = new URLSearchParams({ days: String(days.value), page: String(pageNo), pageSize: String(pageSize.value), status: status.value, sort: 'time', order: 'desc' });
    if (q.value.trim()) qs.set('ip', q.value.trim());
    if (pathQuery.value.trim()) qs.set('path', pathQuery.value.trim());
    const d = await adminApi(`/api/admin/visitors?${qs}`);
    rows.value = d.rows || [];
    total.value = Number(d.total) || 0;
  } catch (e) {
    ElMessage.error(e?.message || String(e));
  } finally {
    loading.value = false;
  }
}

function reload(resetPage = true) {
  if (mode.value === 'ip') loadIpStats(resetPage ? 1 : ipPage.value);
  else loadDetail(resetPage ? 1 : page.value);
}

function switchMode(next) {
  if (mode.value === next) return;
  mode.value = next;
  if (next === 'ip') loadIpStats(1);
  else loadDetail(1);
}

/** 时间窗切换：清空展开缓存后重拉（规格 §3-6）。 */
function onDaysChange() {
  for (const key of Object.keys(ipDetails)) delete ipDetails[key];
  reload(true);
}
function onStatusChange() { reload(true); }
function onSortChange({ prop, order }) {
  ipSortState.value = prop && order ? { prop, order } : { prop: 'visits', order: 'descending' };
  saveSortState('admin.visitorSort', ipSortState.value);
  loadIpStats(1);
}

async function onExpand(row, expandedRows) {
  const open = Boolean(expandedRows && expandedRows.length);
  if (!open || ipDetails[row.ip]) return;
  try {
    ipDetails[row.ip] = await adminApi(`/api/admin/visitors/by-ip/${encodeURIComponent(row.ip)}?days=${days.value}`);
  } catch (e) {
    ElMessage.error(e?.message || String(e));
  }
}

/** 行内唯一动作：详情（只读抽屉）。 */
function showDetail(row) { openIpDetail(row.ip, row); }

function statusTag(row) { return visitorStatusMeta(row.status).tag; }
function fmtNum(n) { return (Number(n) || 0).toLocaleString('zh-CN'); }

onMounted(() => loadIpStats(1));
</script>

<template>
  <div class="vs-stack">
    <div class="vs-note">
      <strong>访问分析（只读）</strong>
      这里没有封禁 / 信任按钮——封禁、信任、封设备统一去「异常处置」。默认筛选是<b>有效访问</b>
      （排除已封禁 + 已信任；临时封保留，到期自动恢复）；点任意 IP 打开只读详情抽屉，含地区 / 状态 / 访问次数 / 独立路径 / 设备 / 最近访问 / 异常规则。
    </div>

    <div class="vs-card">
      <div class="vs-toolbar">
        <div class="vs-seg" role="tablist" aria-label="访问分析子视图">
          <button type="button" :class="{ on: mode === 'ip' }" @click="switchMode('ip')">IP 统计</button>
          <button type="button" :class="{ on: mode === 'detail' }" @click="switchMode('detail')">明细</button>
        </div>
        <el-select v-model="days" style="width:120px" aria-label="时间窗" @change="onDaysChange">
          <el-option label="近 1 天" :value="1" />
          <el-option label="近 7 天" :value="7" />
          <el-option label="近 30 天" :value="30" />
        </el-select>
        <el-select v-model="status" style="width:180px" aria-label="状态筛选" @change="onStatusChange">
          <el-option v-for="f in VISITOR_STATUS_FILTERS" :key="f.value" :label="f.label" :value="f.value" />
        </el-select>
        <el-input v-model="q" clearable :placeholder="mode === 'ip' ? '按 IP 搜索' : '按 IP 筛选'" @keyup.enter="reload(true)" />
        <el-input v-if="mode === 'detail'" v-model="pathQuery" clearable placeholder="按路径筛选" @keyup.enter="reload(true)" />
        <el-button type="primary" plain @click="reload(true)">查询</el-button>
        <el-button text :loading="loading" @click="reload(false)">刷新</el-button>
      </div>
      <p class="vs-muted" style="margin:10px 0 0">
        <template v-if="mode === 'ip'">
          共 {{ fmtNum(ipTotal) }} 个 IP（{{ statusLabel }} · 近 {{ days }} 天）
          <template v-if="status === 'active' && (hidden.blocked || hidden.trusted)"> · 已隐藏 {{ hidden.blocked }} 个已封禁 / {{ hidden.trusted }} 个已信任（切状态可查）</template>
        </template>
        <template v-else>共 {{ fmtNum(total) }} 条访问记录（{{ statusLabel }} · 近 {{ days }} 天）</template>
      </p>
    </div>

    <!-- IP 统计（默认） -->
    <div v-if="mode === 'ip'" class="vs-card table-card">
      <template v-if="!isMobile">
        <el-table :data="ipRows" v-loading="loading" row-key="ip" stripe :default-sort="ipSortState" @sort-change="onSortChange" @expand-change="onExpand">
          <el-table-column type="expand">
            <template #default="{ row }">
              <div class="ip-detail">
                <template v-if="ipDetails[row.ip]">
                  <h4>最近访问（最近 {{ days }} 天内最多 20 条）</h4>
                  <div v-for="r in ipDetails[row.ip].recent" :key="r.id" class="log-line">
                    <span class="mono">{{ dateTime(r.created_at) }}</span>
                    <span class="mono">{{ r.method }} {{ r.path }}</span>
                    <span>{{ r.status || '—' }}</span>
                    <el-tag v-if="r.blocked" type="danger" size="small">拦截</el-tag>
                  </div>
                  <el-empty v-if="!ipDetails[row.ip].recent.length" description="时间窗内没有访问" :image-size="40" />
                  <h4>访问最多的路径</h4>
                  <div v-for="p in ipDetails[row.ip].topPaths" :key="p.path" class="log-line"><span>{{ p.path }}</span><span>{{ p.n }}</span></div>
                  <el-empty v-if="!ipDetails[row.ip].topPaths.length" description="没有路径" :image-size="40" />
                </template>
                <span v-else class="vs-muted">加载中…</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="ip" sortable="custom" label="IP" min-width="150">
            <template #default="{ row }"><span class="mono vs-ip-link" @click="showDetail(row)">{{ row.ip }}</span></template>
          </el-table-column>
          <el-table-column label="地区" width="92"><template #default="{ row }">{{ row.region || '—' }}</template></el-table-column>
          <el-table-column prop="visits" sortable="custom" label="访问次数" width="86" align="right" />
          <el-table-column prop="paths" label="独立路径" width="80" align="right" />
          <el-table-column prop="devices" label="设备数" width="78" align="right" />
          <el-table-column label="状态" width="118">
            <template #default="{ row }">
              <el-tag :type="statusTag(row)" size="small">{{ visitorStatusText(row) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="78" fixed="right">
            <template #default="{ row }"><el-button link type="primary" @click="showDetail(row)">详情</el-button></template>
          </el-table-column>
        </el-table>
      </template>
      <div v-else class="game-card-list">
        <div v-for="row in ipRows" :key="row.ip" class="admin-card">
          <div class="admin-card-main">
            <strong class="mono vs-ip-link" @click="showDetail(row)">{{ row.ip }}</strong>
            <small>{{ row.region || '—' }} · {{ dateTime(row.first_at) }} → {{ dateTime(row.last_at) }}</small>
            <span class="vs-muted">访问 {{ fmtNum(row.visits) }} 次 · 路径 {{ row.paths }} · 设备 {{ row.devices }}</span>
            <div><el-tag :type="statusTag(row)" size="small">{{ visitorStatusText(row) }}</el-tag></div>
          </div>
          <div class="admin-card-foot">
            <span></span>
            <span><el-button link type="primary" @click="showDetail(row)">详情</el-button></span>
          </div>
        </div>
        <el-empty v-if="!loading && !ipRows.length" description="时间窗内没有符合条件的 IP" />
      </div>
      <div class="vs-pager">
        <span>共 {{ fmtNum(ipTotal) }} 个 IP</span>
        <PaginationBar v-model:page="ipPage" v-model:page-size="ipPageSize" :total="ipTotal" @change="loadIpStats" />
      </div>
    </div>

    <!-- 明细（与 IP 统计同口径） -->
    <div v-else class="vs-card table-card">
      <template v-if="!isMobile">
        <el-table :data="rows" v-loading="loading" stripe>
          <el-table-column label="时间" min-width="150"><template #default="{ row }">{{ dateTime(row.created_at) }}</template></el-table-column>
          <el-table-column label="IP" min-width="140">
            <template #default="{ row }">
              <span class="mono vs-ip-link" @click="showDetail(row)">{{ row.ip }}</span>
              <small v-if="row.remote_ip && row.remote_ip !== row.ip" class="vs-muted"> 直连 {{ row.remote_ip }}</small>
            </template>
          </el-table-column>
          <el-table-column label="地区" width="100"><template #default="{ row }">{{ row.region || '—' }}</template></el-table-column>
          <el-table-column label="路径" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">{{ row.path }}<small v-if="row.block_reason"> · {{ row.block_reason }}</small></template>
          </el-table-column>
          <el-table-column label="结果" width="100">
            <template #default="{ row }">
              <el-tag v-if="row.blocked" type="danger" size="small">拦截 {{ row.status }}</el-tag>
              <el-tag v-else-if="row.status >= 400" type="warning" size="small">{{ row.status }}</el-tag>
              <span v-else>{{ row.status || '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="80" fixed="right">
            <template #default="{ row }"><el-button link type="primary" @click="showDetail(row)">详情</el-button></template>
          </el-table-column>
        </el-table>
      </template>
      <div v-else class="game-card-list">
        <div v-for="row in rows" :key="row.id" class="admin-card">
          <div class="admin-card-main">
            <strong class="mono vs-ip-link" @click="showDetail(row)">{{ row.ip }}</strong>
            <small>{{ row.region || '—' }} · {{ dateTime(row.created_at) }}</small>
            <p class="admin-card-path">{{ row.path }}<small v-if="row.block_reason"> · {{ row.block_reason }}</small></p>
            <div>
              <el-tag v-if="row.blocked" type="danger" size="small">拦截 {{ row.status }}</el-tag>
              <el-tag v-else-if="row.status >= 400" type="warning" size="small">{{ row.status }}</el-tag>
              <span v-else class="vs-muted">{{ row.status || '—' }}</span>
            </div>
          </div>
          <div class="admin-card-foot">
            <span></span>
            <span><el-button link type="primary" @click="showDetail(row)">详情</el-button></span>
          </div>
        </div>
        <el-empty v-if="!loading && !rows.length" description="时间窗内没有符合条件的访问记录" />
      </div>
      <div class="vs-pager">
        <span>共 {{ fmtNum(total) }} 条</span>
        <PaginationBar v-model:page="page" v-model:page-size="pageSize" :total="total" @change="loadDetail" />
      </div>
    </div>
  </div>
</template>
