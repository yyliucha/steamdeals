<script setup>
// FZ 批（docs/VISITORS-REDESIGN.md §2 IP 封禁 / §3-4 / §7-7）：IP / CIDR 黑名单——**这一页只做两件事**：
// 解封、手动添加（CIDR 支持）。封禁入口（封 IP）只在「异常处置」，这里不提供批量封禁。
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import PaginationBar from '../PaginationBar.vue';
import { useListPagination } from '../../composables/useListPagination.js';
import { adminApi, useVisitorsAdmin } from '../../composables/useVisitorsAdmin.js';
import { fmtDateTime as dateTime } from '../../utils/siteTime.js';

const { isMobile, loadOverview, openIpDetail } = useVisitorsAdmin();

const loading = ref(false);
const saving = ref(false);
const blacklist = ref([]);
const q = ref('');
const dialog = ref(false);
const form = ref({ ip: '', note: '' });

const filtered = computed(() => {
  const kw = q.value.trim().toLowerCase();
  if (!kw) return blacklist.value;
  return blacklist.value.filter((row) => String(row.ip).toLowerCase().includes(kw) || String(row.note || '').toLowerCase().includes(kw));
});
const pager = useListPagination(filtered);
const pagedRows = pager.items;
const page = pager.page;
const pageSize = pager.pageSize;

async function load() {
  loading.value = true;
  try {
    const d = await adminApi('/api/admin/blacklist');
    blacklist.value = d.ips || [];
  } catch (e) {
    ElMessage.error(e?.message || String(e));
  } finally {
    loading.value = false;
  }
}
async function refresh() { await load(); await loadOverview(); }

function openAddDialog() {
  form.value = { ip: '', note: '' };
  dialog.value = true;
}

async function submitAdd() {
  const ip = form.value.ip.trim();
  if (!ip) return ElMessage.warning('请填写 IP 或 CIDR');
  saving.value = true;
  try {
    const res = await adminApi('/api/admin/blacklist', { method: 'POST', body: JSON.stringify({ ip, note: form.value.note.trim() }) });
    dialog.value = false;
    ElMessage.success(res.removedFromWhitelist ? '已封禁，并已移出白名单' : '已封禁');
    await refresh();
  } catch (e) {
    ElMessage.error(e?.message || String(e));
  } finally {
    saving.value = false;
  }
}

async function unban(row) {
  try {
    await ElMessageBox.confirm(`把 ${row.ip} 移出黑名单？该操作不会恢复该 IP 的自动封禁记录。`, '确认解封', { type: 'warning', confirmButtonText: '解封', cancelButtonText: '取消' });
  } catch { return; }
  saving.value = true;
  try {
    await adminApi(`/api/admin/blacklist/${encodeURIComponent(row.ip)}`, { method: 'DELETE' });
    ElMessage.success('已解封');
    await refresh();
  } catch (e) {
    ElMessage.error(e?.message || String(e));
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="vs-stack">
    <div class="vs-note">
      <strong>IP 封禁（IP / CIDR 黑名单）</strong>
      封禁后该 IP 无法访问站点；加黑自动移白，并清掉该 IP 的临时封禁。手动添加支持单个 IP 与 <b>1.2.3.0/24</b> 网段。
      这里只做「解封 / 添加」——封 IP 在「异常处置」。
    </div>

    <div class="vs-card table-card">
      <div class="vs-card-head padded">
        <div><h3>IP 黑名单</h3><p>共 {{ blacklist.length }} 个条目（含 CIDR）</p></div>
        <div class="vs-heading-actions">
          <el-input v-model="q" clearable placeholder="按 IP / 备注搜索" style="width:220px" />
          <el-button text :loading="loading" @click="refresh">刷新</el-button>
          <el-button type="danger" plain @click="openAddDialog">手动添加</el-button>
        </div>
      </div>

      <template v-if="!isMobile">
        <el-table :data="pagedRows" v-loading="loading" row-key="ip" stripe>
          <el-table-column label="IP / CIDR" min-width="170">
            <template #default="{ row }"><span class="mono vs-ip-link" @click="openIpDetail(row.ip, { status: 'blocked', region: null, visits: row.visits, last_at: row.last_at, devices: row.devices })">{{ row.ip }}</span></template>
          </el-table-column>
          <el-table-column label="备注" min-width="160"><template #default="{ row }">{{ row.note || '—' }}</template></el-table-column>
          <el-table-column label="近 7 天访问" width="110" align="right"><template #default="{ row }">{{ row.visits || 0 }}</template></el-table-column>
          <el-table-column label="最近访问" width="150"><template #default="{ row }">{{ row.last_at ? dateTime(row.last_at) : '—' }}</template></el-table-column>
          <el-table-column label="设备数" width="90" align="right"><template #default="{ row }">{{ row.devices || 0 }}</template></el-table-column>
          <el-table-column label="加入时间" width="150"><template #default="{ row }">{{ dateTime(row.created_at) }}</template></el-table-column>
          <el-table-column label="操作" width="90">
            <template #default="{ row }"><el-button link type="primary" :loading="saving" @click="unban(row)">解封</el-button></template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!loading && !pagedRows.length" description="黑名单为空" />
      </template>

      <div v-else class="game-card-list">
        <div v-for="row in pagedRows" :key="row.ip" class="admin-card">
          <div class="admin-card-main">
            <strong class="mono vs-ip-link" @click="openIpDetail(row.ip, { status: 'blocked', visits: row.visits, last_at: row.last_at, devices: row.devices })">{{ row.ip }}</strong>
            <small>{{ row.note || '—' }}</small>
            <span class="vs-muted">近 7 天 {{ row.visits || 0 }} 次 · {{ row.devices || 0 }} 设备{{ row.last_at ? ' · ' + dateTime(row.last_at) : '' }}</span>
          </div>
          <div class="admin-card-foot"><span class="vs-muted">{{ dateTime(row.created_at) }}</span><span><el-button link type="primary" :loading="saving" @click="unban(row)">解封</el-button></span></div>
        </div>
        <el-empty v-if="!loading && !pagedRows.length" description="黑名单为空" />
      </div>

      <div class="vs-pager">
        <span>共 {{ filtered.length }} 个条目</span>
        <PaginationBar v-model:page="page" v-model:page-size="pageSize" :total="filtered.length" />
      </div>
    </div>

    <el-dialog v-model="dialog" title="手动添加 IP 黑名单" width="min(520px, 92vw)">
      <p class="vs-muted">支持单个 IP（1.2.3.4）或网段（1.2.3.0/24）；加黑会自动移出白名单。</p>
      <div class="vs-stack" style="margin-top:12px">
        <el-input v-model="form.ip" placeholder="IP 或 CIDR，例如 1.2.3.4 或 1.2.3.0/24" />
        <el-input v-model="form.note" placeholder="备注（可选）" />
      </div>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="danger" :loading="saving" @click="submitAdd">确认封禁</el-button>
      </template>
    </el-dialog>
  </div>
</template>
