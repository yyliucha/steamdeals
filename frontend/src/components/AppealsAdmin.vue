<script setup>
// 申诉管理（docs/APPEAL-SYSTEM.md §5，O-9/O-10/O-11/O-12）：
// 列表（待处理/已处理/全部）+ 详情抽屉（内容/设备指纹/封禁记录/处理表单/复制回复）。
// 处理动作联动解封：unban_ip（删黑名单 + 清 ip_abuse + 清内存封禁）/ unban_device（删 device_bans + 清设备内存）
// / both / reject（理由必填）/ note（仅备注，状态保持待处理）。
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import PaginationBar from './PaginationBar.vue';
import { copyText } from '../utils/clipboard.js';
import { fmtDateTime as dateTime } from '../utils/siteTime.js';
import { redirectToLogin } from '../utils/session.js';

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

const mobileQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(max-width: 760px)') : null;
const isMobile = ref(Boolean(mobileQuery && mobileQuery.matches));
if (mobileQuery && mobileQuery.addEventListener) mobileQuery.addEventListener('change', (e) => { isMobile.value = e.matches; });

const STATUS_LABEL = { pending: '待处理', resolved: '已解封', rejected: '已拒绝' };
const STATUS_TAG = { pending: 'warning', resolved: 'success', rejected: 'danger' };
const ACTION_LABEL = { unban_ip: '解封 IP', unban_device: '解封设备', both: '解封 IP + 设备', reject: '拒绝', note: '仅备注' };

const filter = ref('pending'); // pending | done | all
const appeals = ref([]);
const total = ref(0);
const pendingCount = ref(0);
const page = ref(1);
const pageSize = ref(20);
const loading = ref(false);

const drawer = ref({ visible: false, row: null, action: '', note: '', saving: false, replied: '' });

async function loadAppeals(p = page.value) {
  page.value = p;
  loading.value = true;
  try {
    const status = filter.value === 'pending' ? 'pending' : filter.value === 'all' ? 'all' : 'done';
    const qs = new URLSearchParams({ status, limit: String(pageSize.value), page: String(p) });
    const d = await api(`/api/admin/appeals?${qs}`);
    appeals.value = d.appeals || [];
    total.value = d.total || 0;
    pendingCount.value = d.pending || 0;
  } catch (e) {
    notifyError(e);
  } finally {
    loading.value = false;
  }
}

function openDrawer(row) {
  drawer.value = { visible: true, row, action: '', note: '', saving: false, replied: '' };
}

const replyText = computed(() => {
  const row = drawer.value.row;
  if (!row) return '';
  const resolved = drawer.value.action !== 'reject';
  if (resolved) return `你的解封申诉（${row.code}）已通过，相关限制已解除，现在可以正常访问站点。`;
  return `你的解封申诉（${row.code}）未通过。原因：${drawer.value.note.trim() || '未通过审核'}。如有疑问请回复申诉邮件。`;
});

async function copyReply() {
  if (!drawer.value.action) return ElMessage.warning('先选择处理动作，再复制回复内容。');
  try {
    await copyText(replyText.value);
    ElMessage.success('回复内容已复制');
  } catch {
    ElMessage.info('复制失败，请手动选中复制。');
  }
}

async function submitResolve() {
  const row = drawer.value.row;
  if (!drawer.value.action) return ElMessage.warning('请选择处理动作。');
  const note = drawer.value.note.trim();
  if (drawer.value.action === 'reject' && !note) return ElMessage.warning('拒绝必须填写理由。');
  if (note.length > 500) return ElMessage.warning('备注/理由最多 500 字。');
  drawer.value.saving = true;
  try {
    await api(`/api/admin/appeals/${row.id}/resolve`, { method: 'POST', body: JSON.stringify({ action: drawer.value.action, note }) });
    ElMessage.success('处理完成；结果邮件已发送申请人（SMTP 可用时）。');
    drawer.value.visible = false;
    await loadAppeals();
  } catch (e) {
    if (e?.status === 409) {
      ElMessage.warning('该申诉已被处理（邮件或其它会话），列表已刷新。');
      drawer.value.visible = false;
      await loadAppeals();
      return;
    }
    notifyError(e);
  } finally {
    drawer.value.saving = false;
  }
}

async function confirmReject(action) {
  if (action !== 'reject') return;
  await ElMessageBox.alert('拒绝将保持封禁状态，并邮件通知申请人未通过。', '拒绝申诉');
}

onMounted(() => loadAppeals());
</script>

<template>
  <div>
    <div class="module-card"><div class="card-heading"><div><h3>申诉管理</h3><p>用户在被封禁时提交的解封申诉。处理动作会联动解封（IP / 设备），结果邮件通知申请人；邮件内一键处理与这里共用同一状态机（先到先得）。</p></div><el-button :loading="loading" @click="loadAppeals()">刷新</el-button></div>
      <div class="module-tabs">
        <button :class="{ on: filter === 'pending' }" @click="filter = 'pending'; loadAppeals(1)">待处理<template v-if="pendingCount">（{{ pendingCount }}）</template></button>
        <button :class="{ on: filter === 'done' }" @click="filter = 'done'; loadAppeals(1)">已处理</button>
        <button :class="{ on: filter === 'all' }" @click="filter = 'all'; loadAppeals(1)">全部</button>
      </div>
    </div>

    <div v-if="isMobile" class="game-card-list">
      <div v-for="a in appeals" :key="a.id" class="admin-card">
        <div class="admin-card-main"><strong class="mono">{{ a.code }}</strong><small>{{ dateTime(a.created_at) }} · {{ a.ip || '未知 IP' }}</small><small class="muted">{{ a.contact }} · {{ a.reason || '原因未记录' }}</small><el-tag :type="STATUS_TAG[a.status] || 'info'" size="small">{{ STATUS_LABEL[a.status] || a.status }}</el-tag></div>
        <el-button size="small" @click="openDrawer(a)">{{ a.status === 'pending' ? '处理' : '查看' }}</el-button>
      </div>
      <el-empty v-if="!appeals.length" description="没有申诉记录" />
    </div>

    <div v-else class="module-card table-card">
      <el-table :data="appeals" v-loading="loading" stripe>
        <el-table-column prop="code" label="编号" width="120"><template #default="{ row }"><span class="mono">{{ row.code }}</span></template></el-table-column>
        <el-table-column prop="created_at" label="提交时间" min-width="150"><template #default="{ row }">{{ dateTime(row.created_at) }}</template></el-table-column>
        <el-table-column prop="ip" label="IP" width="140"><template #default="{ row }"><span class="mono">{{ row.ip || '—' }}</span></template></el-table-column>
        <el-table-column prop="contact" label="联系方式" min-width="180" show-overflow-tooltip />
        <el-table-column prop="reason" label="封禁原因" width="130"><template #default="{ row }">{{ row.reason || '—' }}</template></el-table-column>
        <el-table-column label="到期" min-width="150"><template #default="{ row }">{{ row.ban_until ? dateTime(row.ban_until) : '—' }}</template></el-table-column>
        <el-table-column label="状态" width="110"><template #default="{ row }"><el-tag :type="STATUS_TAG[row.status] || 'info'" size="small">{{ STATUS_LABEL[row.status] || row.status }}</el-tag><small v-if="row.handled_via" class="muted">（{{ row.handled_via === 'email' ? '邮件' : '后台' }}）</small></template></el-table-column>
        <el-table-column label="操作" width="90"><template #default="{ row }"><el-button link type="primary" @click="openDrawer(row)">{{ row.status === 'pending' ? '处理' : '查看' }}</el-button></template></el-table-column>
      </el-table>
      <PaginationBar v-model:page="page" v-model:page-size="pageSize" :total="total" @change="loadAppeals(page)" />
    </div>

    <el-drawer v-model="drawer.visible" :title="`申诉 ${drawer.row?.code || ''}`" :size="isMobile ? '100%' : '520px'">
      <template v-if="drawer.row">
        <div class="appeal-detail"><dl>
          <div><dt>提交时间</dt><dd>{{ dateTime(drawer.row.created_at) }}</dd></div>
          <div><dt>IP</dt><dd class="mono">{{ drawer.row.ip || '—' }}</dd></div>
          <div><dt>联系方式</dt><dd><a :href="`mailto:${drawer.row.contact}`">{{ drawer.row.contact }}</a></dd></div>
          <div><dt>设备指纹</dt><dd class="mono">{{ drawer.row.fingerprint || drawer.row.device_id || '未上报' }}</dd></div>
          <div><dt>封禁记录</dt><dd>{{ drawer.row.reason || '原因未记录' }}<template v-if="drawer.row.ban_until"> · 到期 {{ dateTime(drawer.row.ban_until) }}</template></dd></div>
          <div><dt>申诉说明</dt><dd class="appeal-message">{{ drawer.row.message || '（空）' }}</dd></div>
          <div><dt>状态</dt><dd><el-tag :type="STATUS_TAG[drawer.row.status] || 'info'" size="small">{{ STATUS_LABEL[drawer.row.status] || drawer.row.status }}</el-tag><template v-if="drawer.row.handled_at"><small class="muted"> · {{ dateTime(drawer.row.handled_at) }}（{{ drawer.row.handled_via === 'email' ? '邮件' : '后台' }}）</small></template></dd></div>
          <div v-if="drawer.row.note"><dt>{{ drawer.row.status === 'rejected' ? '拒绝理由' : '备注' }}</dt><dd>{{ drawer.row.note }}</dd></div>
        </dl></div>

        <template v-if="drawer.row.status === 'pending'">
          <h4 class="resolve-title">处理</h4>
          <el-radio-group v-model="drawer.action" class="resolve-actions">
            <el-radio value="unban_ip">解封 IP</el-radio>
            <el-radio value="unban_device">解封设备</el-radio>
            <el-radio value="both">两者都解</el-radio>
            <el-radio value="reject" @change="confirmReject('reject')">拒绝</el-radio>
            <el-radio value="note">仅备注</el-radio>
          </el-radio-group>
          <el-input v-model="drawer.note" type="textarea" :rows="3" maxlength="500" show-word-limit :placeholder="drawer.action === 'reject' ? '拒绝理由（必填，会邮件通知申请人）' : '备注（可选）'" />
          <div class="resolve-buttons">
            <el-button type="primary" :loading="drawer.saving" @click="submitResolve">提交处理</el-button>
            <el-button plain @click="copyReply">复制回复内容</el-button>
          </div>
        </template>
      </template>
    </el-drawer>
  </div>
</template>

<style scoped>
.appeal-detail dl{margin:0;border:1px solid var(--border);border-radius:12px;overflow:hidden}.appeal-detail dl div{display:flex;gap:10px;padding:9px 13px;border-bottom:1px solid var(--border);font-size:13px}.appeal-detail dl div:last-child{border-bottom:0}.appeal-detail dt{min-width:76px;color:var(--fg-muted);flex:none}.appeal-detail dd{margin:0;overflow-wrap:anywhere}.appeal-detail a{color:var(--brand);text-decoration:none}.appeal-message{white-space:pre-wrap}.resolve-title{margin:18px 0 10px;font-size:14px}.resolve-actions{display:flex;flex-direction:column;align-items:flex-start;gap:8px;margin-bottom:12px}.resolve-buttons{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
</style>
