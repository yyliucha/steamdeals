<script setup>
// FZ 批（docs/VISITORS-REDESIGN.md §2 设备封禁 / §3-4 / §7-7）：设备封禁列表——**这一页只做解封**。
// 封设备入口收进「异常处置」（行内 / 批量，二次确认），这里不提供「封禁」按钮，避免再造入口。
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import PaginationBar from '../PaginationBar.vue';
import { useListPagination } from '../../composables/useListPagination.js';
import { adminApi, useVisitorsAdmin } from '../../composables/useVisitorsAdmin.js';
import { fmtDateTime as dateTime } from '../../utils/siteTime.js';

const { isMobile, setNavCount } = useVisitorsAdmin();

const loading = ref(false);
const saving = ref(false);
const bans = ref([]);
const q = ref('');

const filtered = computed(() => {
  const kw = q.value.trim().toLowerCase();
  if (!kw) return bans.value;
  return bans.value.filter((row) => String(row.fingerprint).toLowerCase().includes(kw) || String(row.device_id || '').toLowerCase().includes(kw) || String(row.note || '').toLowerCase().includes(kw));
});
const pager = useListPagination(filtered);
const pagedRows = pager.items;
const page = pager.page;
const pageSize = pager.pageSize;

function untilText(row) {
  if (!row.until) return '永久';
  if (Date.parse(row.until) <= Date.now()) return `已过期（${dateTime(row.until)}）`;
  return dateTime(row.until);
}

async function load() {
  loading.value = true;
  try {
    const d = await adminApi('/api/admin/device-bans');
    bans.value = d.bans || [];
    setNavCount('devices', bans.value.length);
  } catch (e) {
    ElMessage.error(e?.message || String(e));
  } finally {
    loading.value = false;
  }
}

async function unban(row) {
  try {
    await ElMessageBox.confirm(`解封设备指纹 ${String(row.fingerprint).slice(0, 12)}…？解封后该设备恢复访问。`, '确认解封', { type: 'warning', confirmButtonText: '解封', cancelButtonText: '取消' });
  } catch { return; }
  saving.value = true;
  try {
    await adminApi(`/api/admin/device-bans/${encodeURIComponent(row.fingerprint)}`, { method: 'DELETE' });
    ElMessage.success('已解封');
    await load();
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
      <strong>设备封禁（按指纹生效）</strong>
      换 IP 也会命中；白名单 IP 不受影响。封设备入口只在「异常处置」（行内 / 批量，二次确认），
      这一页只做解封。
    </div>

    <div class="vs-card table-card">
      <div class="vs-card-head padded">
        <div><h3>已封设备</h3><p>共 {{ bans.length }} 个设备 · 封禁至为空 = 永久</p></div>
        <div class="vs-heading-actions">
          <el-input v-model="q" clearable placeholder="按设备码 / 指纹搜索" style="width:220px" />
          <el-button text :loading="loading" @click="load">刷新</el-button>
        </div>
      </div>

      <template v-if="!isMobile">
        <el-table :data="pagedRows" v-loading="loading" row-key="fingerprint" stripe>
          <el-table-column label="设备码 / 指纹" min-width="220">
            <template #default="{ row }">
              <span class="mono">{{ row.device_id || '无设备码' }}</span>
              <small class="vs-muted" style="display:block">{{ String(row.fingerprint).slice(0, 24) }}…<template v-if="row.note"> · {{ row.note }}</template></small>
            </template>
          </el-table-column>
          <el-table-column label="最近出现" width="150"><template #default="{ row }">{{ dateTime(row.created_at) }}</template></el-table-column>
          <el-table-column label="封禁至" width="160"><template #default="{ row }">{{ untilText(row) }}</template></el-table-column>
          <el-table-column label="操作" width="90" fixed="right">
            <template #default="{ row }"><el-button link type="primary" :loading="saving" @click="unban(row)">解封</el-button></template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!loading && !pagedRows.length" description="没有已封禁的设备" />
      </template>

      <div v-else class="game-card-list">
        <div v-for="row in pagedRows" :key="row.fingerprint" class="admin-card">
          <div class="admin-card-main">
            <strong class="mono">{{ row.device_id || '无设备码' }}</strong>
            <small class="mono">{{ String(row.fingerprint).slice(0, 24) }}…</small>
            <span class="vs-muted">封禁至 {{ untilText(row) }} · 加入 {{ dateTime(row.created_at) }}</span>
            <p class="admin-card-path">{{ row.note || '—' }}</p>
          </div>
          <div class="admin-card-foot"><span></span><span><el-button link type="primary" :loading="saving" @click="unban(row)">解封</el-button></span></div>
        </div>
        <el-empty v-if="!loading && !pagedRows.length" description="没有已封禁的设备" />
      </div>

      <div class="vs-pager">
        <span>共 {{ filtered.length }} 个设备</span>
        <PaginationBar v-model:page="page" v-model:page-size="pageSize" :total="filtered.length" />
      </div>
    </div>
  </div>
</template>
