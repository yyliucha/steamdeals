<script setup>
// FZ 批（docs/VISITORS-REDESIGN.md §2 白名单 / §3-4 / §7-7）：白名单——备注 / 限流口径 / 移出 / 添加。
//
// 口径（BR 批决策不变）：加白自动移黑 + 清临时封禁；白名单 IP 不受频率限制。
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import PaginationBar from '../PaginationBar.vue';
import { useListPagination } from '../../composables/useListPagination.js';
import { adminApi, useVisitorsAdmin } from '../../composables/useVisitorsAdmin.js';
import { fmtDateTime as dateTime } from '../../utils/siteTime.js';

const { isMobile, loadOverview, openIpDetail } = useVisitorsAdmin();

const loading = ref(false);
const saving = ref(false);
const whitelist = ref([]);
const config = ref({});
const q = ref('');
const dialog = ref(false);
const form = ref({ ip: '', note: '' });

const filtered = computed(() => {
  const kw = q.value.trim().toLowerCase();
  if (!kw) return whitelist.value;
  return whitelist.value.filter((row) => String(row.ip).toLowerCase().includes(kw) || String(row.note || '').toLowerCase().includes(kw));
});
const pager = useListPagination(filtered);
const pagedRows = pager.items;
const page = pager.page;
const pageSize = pager.pageSize;

/** 限流口径（页面可查看）：白名单不受限流；这里展示当前阈值，避免「不限制」成一句空话。 */
const limitText = computed(() => {
  const c = config.value || {};
  if (c.enabled === false) return '限流已关闭';
  const parts = [];
  if (c.pageMax) parts.push(`页面 ${c.pageMax}/分`);
  if (c.apiMax) parts.push(`API ${c.apiMax}/分`);
  if (c.assetMax) parts.push(`静态资源 ${c.assetMax}/分`);
  return parts.join(' · ') || '默认阈值';
});

async function load() {
  loading.value = true;
  try {
    const d = await adminApi('/api/admin/whitelist');
    whitelist.value = d.ips || [];
    config.value = d.config || {};
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
    const res = await adminApi('/api/admin/whitelist', { method: 'POST', body: JSON.stringify({ ip, note: form.value.note.trim() }) });
    dialog.value = false;
    ElMessage.success(res.clearedBan ? '已加入白名单，并已清除该 IP 的临时封禁' : '已加入白名单');
    await refresh();
  } catch (e) {
    ElMessage.error(e?.message || String(e));
  } finally {
    saving.value = false;
  }
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(`把 ${row.ip} 移出白名单？移出后该 IP 重新受黑名单与频率限制约束。`, '确认移出', { type: 'warning', confirmButtonText: '移出', cancelButtonText: '取消' });
  } catch { return; }
  saving.value = true;
  try {
    await adminApi(`/api/admin/whitelist/${encodeURIComponent(row.ip)}`, { method: 'DELETE' });
    ElMessage.success('已移出白名单');
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
      <strong>白名单</strong>
      白名单 IP 不受黑名单与频率限制（当前阈值：{{ limitText }}）。<b>加白自动移黑 + 清临时封禁</b>；
      这里只做「添加 / 移出」——「信任」动作在「异常处置」。
    </div>

    <div class="vs-card table-card">
      <div class="vs-card-head padded">
        <div><h3>IP 白名单</h3><p>共 {{ whitelist.length }} 个条目（含 CIDR）</p></div>
        <div class="vs-heading-actions">
          <el-input v-model="q" clearable placeholder="按 IP / 备注搜索" style="width:220px" />
          <el-button text :loading="loading" @click="refresh">刷新</el-button>
          <el-button type="primary" plain @click="openAddDialog">添加</el-button>
        </div>
      </div>

      <template v-if="!isMobile">
        <el-table :data="pagedRows" v-loading="loading" row-key="ip" stripe>
          <el-table-column label="IP / CIDR" min-width="170">
            <template #default="{ row }">
              <span class="mono vs-ip-link" @click="openIpDetail(row.ip, { status: 'trusted', visits: row.visits, last_at: row.last_at, devices: row.devices })">{{ row.ip }}</span>
              <small class="vs-muted" style="display:block">近 7 天 {{ row.visits || 0 }} 次{{ row.last_at ? ' · ' + dateTime(row.last_at) : '' }}</small>
            </template>
          </el-table-column>
          <el-table-column label="备注" min-width="150"><template #default="{ row }">{{ row.note || '—' }}</template></el-table-column>
          <el-table-column label="限流" width="100"><template #default>不限制</template></el-table-column>
          <el-table-column label="操作" width="90" fixed="right">
            <template #default="{ row }"><el-button link type="danger" :loading="saving" @click="remove(row)">移出</el-button></template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!loading && !pagedRows.length" description="白名单为空" />
      </template>

      <div v-else class="game-card-list">
        <div v-for="row in pagedRows" :key="row.ip" class="admin-card">
          <div class="admin-card-main">
            <strong class="mono vs-ip-link" @click="openIpDetail(row.ip, { status: 'trusted', visits: row.visits, last_at: row.last_at, devices: row.devices })">{{ row.ip }}</strong>
            <small>{{ row.note || '—' }} · 限流：不限制</small>
            <span class="vs-muted">近 7 天 {{ row.visits || 0 }} 次{{ row.last_at ? ' · ' + dateTime(row.last_at) : '' }}</span>
          </div>
          <div class="admin-card-foot"><span class="vs-muted">{{ dateTime(row.created_at) }}</span><span><el-button link type="danger" :loading="saving" @click="remove(row)">移出</el-button></span></div>
        </div>
        <el-empty v-if="!loading && !pagedRows.length" description="白名单为空" />
      </div>

      <div class="vs-pager">
        <span>共 {{ filtered.length }} 个条目</span>
        <PaginationBar v-model:page="page" v-model:page-size="pageSize" :total="filtered.length" />
      </div>
    </div>

    <el-dialog v-model="dialog" title="添加 IP 白名单" width="min(520px, 92vw)">
      <p class="vs-muted">支持单个 IP（1.2.3.4）或网段（1.2.3.0/24）；加白会自动移出黑名单并清掉临时封禁。</p>
      <div class="vs-stack" style="margin-top:12px">
        <el-input v-model="form.ip" placeholder="IP 或 CIDR，例如 1.2.3.4 或 1.2.3.0/24" />
        <el-input v-model="form.note" placeholder="备注（可选）" />
      </div>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitAdd">确认添加</el-button>
      </template>
    </el-dialog>
  </div>
</template>
