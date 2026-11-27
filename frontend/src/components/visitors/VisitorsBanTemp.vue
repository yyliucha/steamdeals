<script setup>
// FZ 批（docs/VISITORS-REDESIGN.md §2 临时封禁 / §3-4 / §7-7）：ip_abuse 记录——生效中 / 已过期 / 全部 + 解除。
//
// BJ 批决策不变：**解除临时封禁只清 ip_abuse（自动临时封禁），绝不移除 IP 黑名单**——
// 该 IP 若在黑名单里仍无法访问。按钮文案按状态切换（解除封禁 / 清除记录）。
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import PaginationBar from '../PaginationBar.vue';
import { useListPagination } from '../../composables/useListPagination.js';
import { adminApi, useVisitorsAdmin } from '../../composables/useVisitorsAdmin.js';
import { abuseSourceLabel, banRemaining } from '../../utils/visitorStatus.js';
import { fmtDateTime as dateTime } from '../../utils/siteTime.js';

const { isMobile, loadOverview, openIpDetail } = useVisitorsAdmin();

const loading = ref(false);
const saving = ref('');
const abuse = ref([]);
const abuseFilter = ref('active');

const pager = useListPagination(abuse);
const pagedRows = pager.items;
const page = pager.page;
const pageSize = pager.pageSize;

async function load(status = abuseFilter.value) {
  abuseFilter.value = status;
  loading.value = true;
  try {
    const d = await adminApi(`/api/admin/abuse?limit=200&status=${abuseFilter.value}`);
    abuse.value = d.abuse || [];
  } catch (e) {
    ElMessage.error(e?.message || String(e));
  } finally {
    loading.value = false;
  }
}
function onAbuseFilter(value) { page.value = 1; load(value); }

async function unbanAbuse(row) {
  const ip = row.ip;
  const active = Boolean(row.active);
  try {
    await ElMessageBox.confirm(
      active
        ? `解除 ${ip} 的临时封禁？只解除自动临时封禁，不会移除 IP 黑名单；该 IP 若在黑名单中仍无法访问。`
        : `清除 ${ip} 的封禁记录？只删除记录，不会移除 IP 黑名单；该 IP 若在黑名单中仍无法访问。`,
      '确认',
      { type: 'warning', confirmButtonText: '确认', cancelButtonText: '取消' },
    );
  } catch { return; }
  saving.value = ip;
  try {
    await adminApi(`/api/admin/abuse/${encodeURIComponent(ip)}`, { method: 'DELETE' });
    ElMessage.success(active ? '临时封禁已解除' : '记录已清除');
    await load();
    await loadOverview();
  } catch (e) {
    ElMessage.error(e?.message || String(e));
  } finally {
    saving.value = '';
  }
}

function blacklistTitle(row) {
  return `已在黑名单：${row.blacklist_entry || row.ip}${row.blacklist_note ? `（${row.blacklist_note}）` : ''}`;
}

onMounted(() => load());
</script>

<template>
  <div class="vs-stack">
    <div class="vs-note warn">
      <strong>临时封禁记录（ip_abuse）</strong>
      来源：频率超限 / 路径规则 / 异常 UA / 人工临时封。<b>解除临时封禁只清自动临时封禁，不会移除 IP 黑名单</b>
      ——该 IP 若在黑名单里仍无法访问（解封请去「IP 封禁」页）。已过期记录保留 90 天后由清理任务删除。
    </div>

    <div class="vs-card table-card">
      <div class="vs-card-head padded">
        <div><h3>自动封禁记录</h3><p>默认只显示生效中；共 {{ abuse.length }} 条（上限 200）</p></div>
        <div class="vs-heading-actions">
          <el-select v-model="abuseFilter" style="width:130px" @change="onAbuseFilter">
            <el-option label="生效中" value="active" />
            <el-option label="已过期" value="expired" />
            <el-option label="全部" value="all" />
          </el-select>
          <el-button text :loading="loading" @click="load()">刷新</el-button>
        </div>
      </div>

      <template v-if="!isMobile">
        <el-table :data="pagedRows" v-loading="loading" row-key="ip" size="small">
          <el-table-column label="IP" min-width="160">
            <template #default="{ row }">
              <span class="mono vs-ip-link" @click="openIpDetail(row.ip, { status: row.active ? 'banned' : 'normal' })">{{ row.ip }}</span>
              <el-tag v-if="row.in_blacklist" type="danger" size="small" :title="blacklistTitle(row)" class="vs-tag-gap">已在黑名单</el-tag>
              <small class="vs-muted" style="display:block">频率 {{ row.strikes || 0 }} · 路径 {{ row.path_strikes || 0 }}</small>
            </template>
          </el-table-column>
          <el-table-column label="来源" width="115"><template #default="{ row }">{{ abuseSourceLabel(row.ban_source) }}</template></el-table-column>
          <el-table-column label="封禁至 / 剩余" min-width="180">
            <template #default="{ row }">
              <span>{{ row.banned_until ? dateTime(row.banned_until) : '—' }}</span>
              <small v-if="row.active && banRemaining(row.banned_until)" class="vs-muted" style="display:block">{{ banRemaining(row.banned_until) }}</small>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag v-if="row.active" type="warning" size="small">生效中</el-tag>
              <el-tag v-else-if="row.banned_until" type="info" size="small">已过期</el-tag>
              <el-tag v-else type="info" size="small">仅计数</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="110" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" :loading="saving === row.ip" @click="unbanAbuse(row)">{{ row.active ? '解除封禁' : '清除记录' }}</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!loading && !pagedRows.length" :description="abuseFilter === 'active' ? '当前没有生效中的自动封禁；可切换到「已过期 / 全部」查看' : '暂无记录'" />
      </template>

      <div v-else class="game-card-list">
        <div v-for="row in pagedRows" :key="row.ip" class="admin-card">
          <div class="admin-card-main">
            <strong class="mono vs-ip-link" @click="openIpDetail(row.ip, { status: row.active ? 'banned' : 'normal' })">{{ row.ip }}</strong>
            <div>
              <el-tag v-if="row.in_blacklist" type="danger" size="small" :title="blacklistTitle(row)">已在黑名单</el-tag>
              <el-tag v-if="row.active" type="warning" size="small" class="vs-tag-gap">生效中</el-tag>
              <el-tag v-else-if="row.banned_until" type="info" size="small" class="vs-tag-gap">已过期</el-tag>
              <el-tag v-else type="info" size="small" class="vs-tag-gap">仅计数</el-tag>
            </div>
            <small>{{ abuseSourceLabel(row.ban_source) }} · 频率命中 {{ row.strikes || 0 }} · 路径命中 {{ row.path_strikes || 0 }}</small>
            <span class="vs-muted">封禁至 {{ row.banned_until ? dateTime(row.banned_until) : '—' }}<template v-if="row.active && banRemaining(row.banned_until)"> · {{ banRemaining(row.banned_until) }}</template></span>
          </div>
          <div class="admin-card-foot"><span></span><span><el-button link type="primary" :loading="saving === row.ip" @click="unbanAbuse(row)">{{ row.active ? '解除封禁' : '清除记录' }}</el-button></span></div>
        </div>
        <el-empty v-if="!loading && !pagedRows.length" :description="abuseFilter === 'active' ? '当前没有生效中的自动封禁' : '暂无记录'" />
      </div>

      <div class="vs-pager">
        <span>共 {{ abuse.length }} 条</span>
        <PaginationBar v-model:page="page" v-model:page-size="pageSize" :total="abuse.length" />
      </div>
    </div>
  </div>
</template>
