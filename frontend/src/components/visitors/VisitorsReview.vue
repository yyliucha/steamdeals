<script setup>
// FZ 批（docs/VISITORS-REDESIGN.md §2 异常处置 / §3-1/§3-3 / §7-3/§7-6）：
// **唯一处置入口**——按 IP 合并的待审队列（沿用 GET /api/admin/reviews 与既有合并逻辑）。
//
//   行内四动作：临时封（10 分钟 / 1 小时 / 1 天）/ 永久封 / 信任 / 忽略
//   批量三动作：封 IP / 封设备 / 忽略
//   处置后：该行立即从队列消失、待审数减 1；封禁/信任给 toast「撤销」5 秒（撤销 = 移出黑/白名单，
//   行回原位，规格 §1 决策 5）。当前页空了自动回上一页。
//
// 说明：撤销只能回滚「封禁/信任」这个动作本身（移出黑/白名单）；审核记录状态（已处置）是审计事实，
// 没有回滚接口（规格 §4 未新增），所以行是本地回原位——刷新后以服务端为准。
import { computed, h, nextTick, onMounted, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowDown } from '@element-plus/icons-vue';
import PaginationBar from '../PaginationBar.vue';
import { useListPagination } from '../../composables/useListPagination.js';
import { promptBulkConfirm } from '../../composables/useBulkSelection.js';
import { adminApi, useVisitorsAdmin } from '../../composables/useVisitorsAdmin.js';
import { reviewStatusMeta } from '../../utils/visitorStatus.js';
import { fmtDateTime as dateTime } from '../../utils/siteTime.js';
import { compareIp } from '../../utils/ipSort.js';

const { state, isMobile, applyPendingDelta, bumpOverview, clearPendingDelta, loadOverview, openIpDetail } = useVisitorsAdmin();

const loading = ref(false);
const reviews = ref([]);
const reviewStatus = ref('pending');
const rowAction = ref('');
const expanded = ref(new Set());

// ---- 排序（AQ 批 admin.reviewMergeSort 持久化，口径不变）----
function loadSortState(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    if (v && typeof v.prop === 'string' && (v.order === 'ascending' || v.order === 'descending')) return v;
  } catch { /* 坏数据回落默认 */ }
  return fallback;
}
function saveSortState(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 隐私模式忽略 */ } }
const mergedSort = ref(loadSortState('admin.reviewMergeSort', { prop: 'last_seen', order: 'descending' }));
function onMergedSortChange({ prop, order }) {
  mergedSort.value = prop && order ? { prop, order } : { prop: 'last_seen', order: 'descending' };
  saveSortState('admin.reviewMergeSort', mergedSort.value);
  mergedPager.page.value = 1;
}

/** 按 IP 合并（沿用 AX 批口径）：rules/ruleCount/hitsTotal/首次→最近/设备数/待审条数。 */
const sortedMergedReviews = computed(() => {
  const byIp = new Map();
  for (const r of reviews.value) {
    const key = r.ip || '(空)';
    if (!byIp.has(key)) byIp.set(key, { ip: r.ip || '', rows: [] });
    byIp.get(key).rows.push(r);
  }
  const list = [];
  for (const g of byIp.values()) {
    const pending = g.rows.filter((r) => r.status === 'pending');
    const statuses = new Set(g.rows.map((r) => r.status));
    const ruleMap = new Map();
    for (const r of g.rows) ruleMap.set(r.rule, (ruleMap.get(r.rule) || 0) + 1);
    const days = g.rows.map((r) => r.last_seen || '').filter(Boolean).sort();
    const firsts = g.rows.map((r) => r.created_at || '').filter(Boolean).sort();
    list.push({
      key: g.ip || '(空)',
      ip: g.ip,
      rows: g.rows,
      rules: [...ruleMap.entries()].map(([rule, n]) => ({ rule, n })).sort((a, b) => b.n - a.n),
      ruleCount: ruleMap.size,
      hitsTotal: g.rows.reduce((s, r) => s + (Number(r.hits) || 0), 0),
      firstSeen: firsts[0] || '',
      lastSeen: days[days.length - 1] || '',
      devices: new Set(g.rows.map((r) => r.fingerprint || r.device_id).filter(Boolean)).size,
      status: pending.length ? 'pending' : (statuses.size === 1 && statuses.has('auto_banned') ? 'auto_banned' : 'partial'),
      pendingIds: pending.map((r) => r.id),
      pendingCount: pending.length,
    });
  }
  const { prop, order } = mergedSort.value;
  const dir = order === 'ascending' ? 1 : -1;
  return list.sort((a, b) => {
    let va; let vb;
    if (prop === 'ip') return compareIp(a.ip, b.ip) * dir;
    if (prop === 'hitsTotal') { va = a.hitsTotal; vb = b.hitsTotal; }
    else if (prop === 'ruleCount') { va = a.ruleCount; vb = b.ruleCount; }
    else { va = a.lastSeen; vb = b.lastSeen; }
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return 0;
  });
});
const mergedPager = useListPagination(sortedMergedReviews);
const pagedMergedReviews = mergedPager.items;
const mergedPage = mergedPager.page;
const mergedPageSize = mergedPager.pageSize;

// ---- 批量勾选（本页勾选，翻页清空）----
const mergedPicked = ref(new Set());
function toggleMergedPick(row) {
  const next = new Set(mergedPicked.value);
  if (next.has(row.key)) next.delete(row.key); else next.add(row.key);
  mergedPicked.value = next;
}
const mergedPickedCount = computed(() => sortedMergedReviews.value.filter((g) => mergedPicked.value.has(g.key)).reduce((s, g) => s + g.pendingCount, 0));
watch(mergedPage, () => { mergedPicked.value = new Set(); });

function isExpanded(row) { return expanded.value.has(row.key); }
function toggleExpanded(row) {
  const next = new Set(expanded.value);
  if (next.has(row.key)) next.delete(row.key); else next.add(row.key);
  expanded.value = next;
}
function onExpandChange(row, rows) {
  const next = new Set(expanded.value);
  if (rows && rows.length) next.add(row.key); else next.delete(row.key);
  expanded.value = next;
}
function ruleSummary(row) {
  const first = row.rules[0];
  return first ? `${first.rule} ×${first.n} · 共 ${row.ruleCount} 条规则` : '—';
}

async function loadReviews(page = mergedPage.value) {
  mergedPicked.value = new Set();
  mergedPager.page.value = page;
  loading.value = true;
  try {
    const d = await adminApi(`/api/admin/reviews?status=${reviewStatus.value}`);
    reviews.value = d.reviews || [];
    // 从服务端重拉后，撤销时本地还原的行已被服务端结果替换 → 撤销增量作废，数字回到服务端口径
    if (state.pendingDelta !== 0) { clearPendingDelta(); loadOverview(); }
  } catch (e) {
    ElMessage.error(e?.message || String(e));
  } finally {
    loading.value = false;
  }
}
function onReviewStatusChange() { loadReviews(1); }

// ---- 处置（唯一入口）----
const ipLabel = (row) => row.ip || '(空)';

function confirmRow(row, action, minutes) {
  const label = { tempban: `临时封禁 ${minutes === 10 ? '10 分钟' : minutes === 60 ? '1 小时' : '1 天'}`, permban: '永久封禁（加入 IP 黑名单）', trust: '信任（加入白名单）', ignore: '忽略' }[action];
  const detail = `${ipLabel(row)} · ${row.ruleCount} 条规则 / ${row.hitsTotal} 次命中 / ${row.devices} 个设备（共 ${row.pendingCount} 条待审记录）`;
  return ElMessageBox.confirm(`对 ${detail} 执行「${label}」？处置后该行从待审队列消失、待审数减 1。`, `确认${label}`, {
    type: action === 'permban' || action === 'trust' ? 'warning' : 'info',
    confirmButtonText: '确认执行',
    cancelButtonText: '取消',
  }).then(() => true).catch(() => false);
}

async function actRow(row, action, minutes) {
  if (!row?.pendingIds?.length) return ElMessage.warning('该 IP 没有可处理的待审记录');
  if (!(await confirmRow(row, action, minutes))) return;
  rowAction.value = `${row.key}:${action}`;
  try {
    if (action === 'tempban') {
      for (const id of row.pendingIds) {
        await adminApi('/api/admin/reviews/act', { method: 'POST', body: JSON.stringify({ id, action: 'tempban', minutes }) });
      }
    } else if (action === 'trust') {
      for (const id of row.pendingIds) {
        await adminApi('/api/admin/reviews/act', { method: 'POST', body: JSON.stringify({ id, action: 'trust' }) });
      }
    } else if (action === 'permban') {
      // 永久封 = 批量封 IP（服务端互斥：加黑移白 + 把该 IP 的 pending 标记为 auto_banned）
      await adminApi('/api/admin/bulk', {
        method: 'POST',
        body: JSON.stringify({ target: 'reviews', action: 'approve-ip', keys: row.pendingIds, confirmCount: row.pendingIds.length }),
      });
    } else {
      await adminApi('/api/admin/bulk', {
        method: 'POST',
        body: JSON.stringify({ target: 'reviews', action: 'reject', keys: row.pendingIds }),
      });
    }
    afterDispose(row, action);
  } catch (e) {
    ElMessage.error(e?.message || String(e));
  } finally {
    rowAction.value = '';
  }
}

/** 封设备（批量动作，按指纹去重后提交 approve-device）。 */
async function banDeviceRow(row) {
  const ids = [];
  const seen = new Set();
  for (const r of row.rows) {
    if (r.status === 'pending' && r.fingerprint && !seen.has(r.fingerprint)) { seen.add(r.fingerprint); ids.push(r.id); }
  }
  if (!ids.length) return ElMessage.warning('该 IP 没有可封禁的设备指纹');
  if (!(await confirmCountPrompt(ids.length, '封设备'))) return;
  rowAction.value = `${row.key}:device`;
  try {
    await adminApi('/api/admin/bulk', {
      method: 'POST',
      body: JSON.stringify({ target: 'reviews', action: 'approve-device', keys: ids, confirmCount: ids.length }),
    });
    afterDispose(row, 'device');
  } catch (e) {
    ElMessage.error(e?.message || String(e));
  } finally {
    rowAction.value = '';
  }
}

async function confirmCountPrompt(count, label) {
  try {
    const { value } = await ElMessageBox.prompt(
      `将处理 ${count} 条待审记录执行「${label}」，请再次输入这个数字确认`,
      `确认${label}`,
      { inputPattern: /^\d+$/, inputErrorMessage: '请输入数字', confirmButtonText: '确认执行', cancelButtonText: '取消', type: 'warning' },
    );
    if (Number(String(value).trim()) !== Number(count)) { ElMessage.warning('输入的条数与待处理记录数不一致，已取消'); return false; }
    return true;
  } catch { return false; }
}

/** 处置成功后：行消失（+ 补页）、待审数减 1、封禁/信任给 5 秒撤销。 */
let lastUndo = null;
function afterDispose(row, action) {
  const index = sortedMergedReviews.value.findIndex((g) => g.key === row.key);
  lastUndo = { row, index, raw: row.rows.slice(), action };
  reviews.value = reviews.value.filter((r) => (r.ip || '(空)') !== row.key);
  // 计数同步：待审 -1 立即可见，再从接口对齐（服务端已生效，不用 delta 重复扣减）
  bumpOverview({ pending_reviews: -1 });
  loadOverview();
  // 当前页空了自动回上一页（useListPagination 也会兜底，这里显式一次保证及时）
  if (!mergedPager.items.value.length && mergedPager.page.value > 1) mergedPager.page.value -= 1;
  const label = { tempban: '已临时封禁', permban: '已永久封禁', trust: '已加入白名单', ignore: '已忽略', device: '已封禁设备' }[action] || '已处置';
  if (action === 'ignore' || action === 'device') {
    ElMessage.success(`${ipLabel(row)} ${label}`);
    return;
  }
  showUndoToast(`${ipLabel(row)} ${label}`, () => undoDispose(lastUndo));
}

/** 5 秒撤销 toast（Element Plus 消息支持 VNode）。 */
function showUndoToast(text, onUndo) {
  let handle = null;
  handle = ElMessage({
    duration: 5000,
    showClose: true,
    message: h('span', { class: 'vs-toast' }, [
      h('span', text),
      h('a', { class: 'vs-toast-act', onClick: () => { handle?.close(); onUndo(); } }, '撤销'),
    ]),
  });
}

/** 撤销 = 移出黑/白名单（或清临时封），行回原位、待审数 +1。 */
async function undoDispose(entry) {
  if (!entry?.row?.ip) return;
  const ip = entry.row.ip;
  try {
    if (entry.action === 'permban') await adminApi(`/api/admin/blacklist/${encodeURIComponent(ip)}`, { method: 'DELETE' });
    else if (entry.action === 'trust') await adminApi(`/api/admin/whitelist/${encodeURIComponent(ip)}`, { method: 'DELETE' });
    else if (entry.action === 'tempban') await adminApi(`/api/admin/abuse/${encodeURIComponent(ip)}`, { method: 'DELETE' });
    const insertAt = Math.min(entry.index < 0 ? reviews.value.length : entry.index, reviews.value.length);
    reviews.value.splice(insertAt, 0, ...entry.raw);
    applyPendingDelta(1);
    await loadOverview();
    ElMessage.success('已撤销，行已回原位');
  } catch (e) {
    ElMessage.error(e?.message || String(e));
  }
}

// ---- 批量三动作：封 IP / 封设备 / 忽略 ----
async function runMergedBulk(actionKey) {
  const groups = sortedMergedReviews.value.filter((g) => mergedPicked.value.has(g.key));
  if (!groups.length) return ElMessage.warning('请先勾选要操作的 IP');
  let ids = [];
  for (const g of groups) ids.push(...g.pendingIds);
  if (actionKey === 'approve-device') {
    const seen = new Set();
    const all = groups.flatMap((g) => g.rows);
    ids = all.filter((r) => r.status === 'pending' && r.fingerprint && !seen.has(r.fingerprint) && seen.add(r.fingerprint)).map((r) => r.id);
  }
  if (!ids.length) return ElMessage.warning('所选 IP 没有可处理的待审记录');
  const labels = { 'approve-ip': '封 IP', 'approve-device': '封设备', reject: '忽略' };
  const confirmCount = await promptBulkConfirm(ids.length, labels[actionKey]);
  if (confirmCount == null) return;
  rowAction.value = `bulk:${actionKey}`;
  try {
    const d = await adminApi('/api/admin/bulk', {
      method: 'POST',
      body: JSON.stringify({ target: 'reviews', action: actionKey, keys: ids, confirmCount }),
    });
    const pickedKeys = new Set(groups.map((g) => g.key));
    reviews.value = reviews.value.filter((r) => !pickedKeys.has(r.ip || '(空)'));
    mergedPicked.value = new Set();
    bumpOverview({ pending_reviews: -groups.length });
    await loadOverview();
    ElMessage.success(`已处置 ${groups.length} 个 IP（成功 ${d.ok ?? ids.length} 条）`);
  } catch (e) {
    ElMessage.error(e?.message || String(e));
  } finally {
    rowAction.value = '';
  }
}

// ---- 「去异常处置并定位该 IP」（IP 抽屉 / 其他块跳过来）----
const highlightKey = ref('');
async function focusIp(ip) {
  if (!ip) return;
  // 只在「待审」视图能定位到待审行；若当前在「全部（审计）」也允许
  const row = sortedMergedReviews.value.find((g) => g.ip === ip);
  if (!row) {
    ElMessage.info(`${ip} 当前没有待审记录（可能已处置或已忽略）`);
    return;
  }
  mergedPager.page.value = Math.max(1, Math.ceil((sortedMergedReviews.value.findIndex((g) => g.key === row.key) + 1) / mergedPageSize.value));
  const next = new Set(expanded.value);
  next.add(row.key);
  expanded.value = next;
  highlightKey.value = ip;
  await nextTick();
  const el = document.querySelector('.vs-row-focus') || document.querySelector(`[data-review-ip="${ip}"]`);
  if (el?.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  setTimeout(() => { highlightKey.value = ''; }, 2600);
}
watch(() => state.focus, (f) => { if (f?.ip) focusIp(f.ip); }, { immediate: true });

function rowClassName({ row }) {
  return highlightKey.value && row.ip === highlightKey.value ? 'vs-row-focus' : '';
}

onMounted(() => { loadReviews(1); });
</script>

<template>
  <div class="vs-stack">
    <div class="vs-note">
      <strong>按 IP 合并的待审队列——唯一处置入口</strong>
      系统记录异常但不自动永久封禁；这里的行内动作（临时封 / 永久封 / 信任 / 忽略）与批量动作（封 IP / 封设备 / 忽略）
      是**全站唯一**的处置入口。处置后该行立即消失、待审数减 1；封禁 / 信任给 5 秒「撤销」。
      访问分析只读，不提供封禁按钮。
      <p>封禁发生时该 IP 的旧待审会标记为 auto_banned 永久退出待审（「全部（审计）」视图可查）；封禁期间产生的新异常仍会以「待审」出现（状态列可据此判断是否已处理）。</p>
    </div>

    <div class="vs-card table-card">
      <div class="vs-card-head padded">
        <div>
          <h3>待审列表</h3>
          <p>同一 IP 合并为一行，展开看逐条规则 · 共 {{ reviews.length }} 条记录（上限 500）</p>
        </div>
        <div class="vs-heading-actions">
          <el-select v-model="reviewStatus" style="width:150px" @change="onReviewStatusChange">
            <el-option label="只看待审" value="pending" />
            <el-option label="全部（审计）" value="all" />
          </el-select>
          <el-button text :loading="loading" @click="loadReviews(mergedPage)">刷新</el-button>
        </div>
      </div>

      <div class="merge-bar">
        <span>已选 {{ mergedPicked.size }} 个 IP · {{ mergedPickedCount }} 条待审</span>
        <el-button size="small" type="danger" plain :disabled="!mergedPicked.size" :loading="rowAction === 'bulk:approve-ip'" @click="runMergedBulk('approve-ip')">封 IP</el-button>
        <el-button size="small" type="danger" plain :disabled="!mergedPicked.size" :loading="rowAction === 'bulk:approve-device'" @click="runMergedBulk('approve-device')">封设备</el-button>
        <el-button size="small" :disabled="!mergedPicked.size" :loading="rowAction === 'bulk:reject'" @click="runMergedBulk('reject')">忽略</el-button>
      </div>

      <template v-if="!isMobile">
        <el-table
          ref="mergedReviewsTable"
          row-key="key"
          :data="pagedMergedReviews"
          v-loading="loading"
          :default-sort="mergedSort"
          :expand-row-keys="[...expanded]"
          :row-class-name="rowClassName"
          @sort-change="onMergedSortChange"
          @expand-change="onExpandChange"
        >
          <el-table-column width="44">
            <template #default="{ row }">
              <el-checkbox :model-value="mergedPicked.has(row.key)" :disabled="!row.pendingCount" @change="toggleMergedPick(row)" />
            </template>
          </el-table-column>
          <el-table-column type="expand">
            <template #default="{ row }">
              <div class="merged-detail">
                <div v-for="r in row.rows" :key="r.id" class="merged-detail-row">
                  <span class="vs-mono">{{ r.rule }}</span>
                  <span>命中 {{ r.hits }} 次</span>
                  <span class="vs-muted">{{ r.path || r.detail }}</span>
                  <span class="vs-muted">{{ dateTime(r.last_seen) }}</span>
                  <el-tag :type="reviewStatusMeta(r.status).tag" size="small">{{ reviewStatusMeta(r.status).label }}</el-tag>
                  <span v-if="r.region" class="vs-muted">{{ r.region }}</span>
                  <span v-if="r.last_ua" class="vs-muted" :title="r.last_ua">{{ (r.last_ua || '').slice(0, 40) }}</span>
                  <el-tag v-if="r.appeal_status" size="small" type="info">申诉：{{ r.appeal_status }}</el-tag>
                </div>
                <p v-if="!row.rows.length" class="vs-empty">没有记录</p>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="ip" sortable="custom" label="IP" min-width="180">
            <template #default="{ row }">
              <span class="vs-mono vs-ip-link" @click="openIpDetail(row.ip, { status: 'intercepted' })">{{ row.ip || '(空)' }}</span>
              <small v-if="row.devices > 1" class="vs-tag-gap">· {{ row.devices }} 个设备</small>
            </template>
          </el-table-column>
          <el-table-column prop="ruleCount" sortable="custom" label="规则摘要" width="250">
            <template #default="{ row }">
              <el-popover placement="top" trigger="hover" :width="240" :disabled="!row.rules || row.rules.length <= 1">
                <div class="rule-pop"><div v-for="r in row.rules" :key="r.rule">{{ r.rule }} ×{{ r.n }}</div></div>
                <template #reference><span class="rule-summary">{{ ruleSummary(row) }}</span></template>
              </el-popover>
            </template>
          </el-table-column>
          <el-table-column prop="hitsTotal" sortable="custom" label="总次数" width="80" align="right" />
          <el-table-column prop="last_seen" sortable="custom" label="首次 → 最近" min-width="190">
            <template #default="{ row }">{{ dateTime(row.firstSeen) }} → {{ dateTime(row.lastSeen) }}</template>
          </el-table-column>
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <el-tag v-if="row.status === 'pending'" type="success" size="small">待审</el-tag>
              <el-tag v-else-if="row.status === 'auto_banned'" type="info" size="small">已封禁</el-tag>
              <el-tag v-else type="warning" size="small">部分已处理</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="300">
            <template #default="{ row }">
              <template v-if="row.pendingCount">
                <el-dropdown size="small" @command="(m) => actRow(row, 'tempban', m)">
                  <el-button link type="danger" size="small">临时封<el-icon class="el-icon--right"><ArrowDown /></el-icon></el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item :command="10">10 分钟</el-dropdown-item>
                      <el-dropdown-item :command="60">1 小时</el-dropdown-item>
                      <el-dropdown-item :command="1440">1 天</el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
                <el-button link size="small" type="danger" @click="actRow(row, 'permban')">永久封</el-button>
                <el-button link size="small" type="success" @click="actRow(row, 'trust')">信任</el-button>
                <el-button link size="small" @click="actRow(row, 'ignore')">忽略</el-button>
                <el-button v-if="row.devices" link size="small" type="danger" @click="banDeviceRow(row)">封设备</el-button>
              </template>
              <span v-else class="vs-muted">已处置</span>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!loading && !pagedMergedReviews.length" description="没有待审的异常请求" />
      </template>

      <div v-else class="game-card-list">
        <div v-for="row in pagedMergedReviews" :key="row.key" class="admin-card" :class="{ 'vs-row-focus': highlightKey === row.ip }" :data-review-ip="row.ip">
          <div class="admin-card-pick">
            <el-checkbox :model-value="mergedPicked.has(row.key)" :disabled="!row.pendingCount" @change="toggleMergedPick(row)">选择</el-checkbox>
          </div>
          <div class="admin-card-main">
            <strong class="mono vs-ip-link" @click="openIpDetail(row.ip, { status: 'intercepted' })">{{ row.ip || '(空)' }}</strong>
            <small>首次 {{ dateTime(row.firstSeen) }} → 最近 {{ dateTime(row.lastSeen) }}</small>
            <span class="vs-muted">{{ ruleSummary(row) }}</span>
            <div>
              <el-tag v-if="row.status === 'pending'" type="success" size="small">待审</el-tag>
              <el-tag v-else-if="row.status === 'auto_banned'" type="info" size="small">已封禁</el-tag>
              <el-tag v-else type="warning" size="small">部分已处理</el-tag>
              <el-tag v-if="row.pendingCount" type="warning" size="small" class="vs-tag-gap">{{ row.pendingCount }} 条待审</el-tag>
            </div>
            <p class="admin-card-path">共 {{ row.ruleCount }} 条规则 · {{ row.hitsTotal }} 次命中 · {{ row.devices }} 个设备</p>
            <el-button link size="small" @click="toggleExpanded(row)">{{ isExpanded(row) ? '收起规则' : '展开逐条规则' }}</el-button>
            <div v-if="isExpanded(row)" class="merged-detail">
              <div v-for="r in row.rows" :key="r.id" class="merged-detail-row">
                <span class="vs-mono">{{ r.rule }}</span>
                <span>命中 {{ r.hits }} 次</span>
                <el-tag :type="reviewStatusMeta(r.status).tag" size="small">{{ reviewStatusMeta(r.status).label }}</el-tag>
                <span class="vs-muted">{{ dateTime(r.last_seen) }}</span>
                <span v-if="r.region" class="vs-muted">{{ r.region }}</span>
              </div>
            </div>
          </div>
          <div class="admin-card-foot">
            <span></span>
            <span v-if="row.pendingCount">
              <el-dropdown size="small" @command="(m) => actRow(row, 'tempban', m)">
                <el-button link type="danger" size="small">临时封</el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item :command="10">10 分钟</el-dropdown-item>
                    <el-dropdown-item :command="60">1 小时</el-dropdown-item>
                    <el-dropdown-item :command="1440">1 天</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
              <el-button link type="danger" size="small" @click="actRow(row, 'permban')">永久封</el-button>
              <el-button link type="success" size="small" @click="actRow(row, 'trust')">信任</el-button>
              <el-button link size="small" @click="actRow(row, 'ignore')">忽略</el-button>
              <el-button v-if="row.devices" link type="danger" size="small" @click="banDeviceRow(row)">封设备</el-button>
            </span>
          </div>
        </div>
        <el-empty v-if="!loading && !pagedMergedReviews.length" description="没有待审的异常请求" />
      </div>

      <div class="vs-pager">
        <span>共 {{ sortedMergedReviews.length }} 个 IP（上限 500 条待审记录）</span>
        <PaginationBar v-model:page="mergedPage" v-model:page-size="mergedPageSize" :total="sortedMergedReviews.length" />
      </div>
    </div>
  </div>
</template>
