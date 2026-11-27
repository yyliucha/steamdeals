<script setup>
// FZ 批（docs/VISITORS-REDESIGN.md §1 决策 12 / §2 IP 详情抽屉 / §3-2 / §7-4）：
// 跨块复用的**只读** IP 详情抽屉——地区 / 状态 / 访问次数 / 独立路径 / 设备 / 最近访问 / 异常规则，一处看全。
//
// 只读红线（§3-1 处置入口唯一）：抽屉**不提供封禁 / 信任按钮**，只给两条跳转——
//   有待审 →「去异常处置」并定位该 IP；已封禁 →「去 IP 封禁」。
//
// 数据来源（全部是既有接口，未新增/未改动响应）：
//   GET /api/admin/visitors/by-ip?q=<ip>&status=all   该 IP 的访问统计行
//   GET /api/admin/visitors/by-ip/<ip>?days=7          最近访问 + 路径 top 5
//   GET /api/admin/reviews?status=pending              该 IP 的待审异常规则
//   GET /api/admin/blacklist | /whitelist              已封禁 / 已信任判定（含备注）
//   GET /api/admin/devices?limit=200                   该 IP 关联的设备指纹
import { computed, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { adminApi, useVisitorsAdmin } from '../../composables/useVisitorsAdmin.js';
import { banRemaining, visitorStatusMeta, visitorStatusText } from '../../utils/visitorStatus.js';
import { fmtDateTime as dateTime } from '../../utils/siteTime.js';

const { state, isMobile, closeIpDetail, requestView } = useVisitorsAdmin();

const loading = ref(false);
const stats = ref(null);
const recent = ref([]);
const topPaths = ref([]);
const pendingRules = ref([]);
const blackEntry = ref(null);
const whiteEntry = ref(null);
const devices = ref([]);

const ip = computed(() => state.drawer.ip);
const seed = computed(() => state.drawer.seed);

const status = computed(() => {
  if (blackEntry.value) return 'blocked';
  if (whiteEntry.value) return 'trusted';
  if (seed.value?.status) return seed.value.status;
  if (stats.value?.status) return stats.value.status;
  return 'normal';
});
const statusText = computed(() => visitorStatusText({ ...stats.value, ...seed.value, status: status.value, ban_until: stats.value?.ban_until || seed.value?.ban_until }));
const statusTag = computed(() => visitorStatusMeta(status.value).tag);
const pendingCount = computed(() => pendingRules.value.length);

const visits = computed(() => Number(stats.value?.visits ?? seed.value?.visits) || 0);
const paths = computed(() => Number(stats.value?.paths ?? seed.value?.paths) || 0);
const deviceCount = computed(() => (devices.value.length ? devices.value.length : Number(stats.value?.devices ?? seed.value?.devices) || 0));
const region = computed(() => stats.value?.region || seed.value?.region || '—');

async function load() {
  const target = state.drawer.ip;
  if (!target) return;
  loading.value = true;
  stats.value = null;
  recent.value = [];
  topPaths.value = [];
  pendingRules.value = [];
  blackEntry.value = null;
  whiteEntry.value = null;
  devices.value = [];
  try {
    const [statsRes, detail, reviews, blacklist, whitelist, deviceRes] = await Promise.all([
      adminApi(`/api/admin/visitors/by-ip?q=${encodeURIComponent(target)}&status=all&days=7&pageSize=20`),
      adminApi(`/api/admin/visitors/by-ip/${encodeURIComponent(target)}?days=7`),
      adminApi('/api/admin/reviews?status=pending'),
      adminApi('/api/admin/blacklist'),
      adminApi('/api/admin/whitelist'),
      adminApi('/api/admin/devices?limit=200').catch(() => ({ devices: [] })),
    ]);
    stats.value = (statsRes.items || []).find((row) => row.ip === target) || null;
    recent.value = detail.recent || [];
    topPaths.value = detail.topPaths || [];
    pendingRules.value = (reviews.reviews || []).filter((r) => r.ip === target && r.status === 'pending');
    blackEntry.value = (blacklist.ips || []).find((row) => row.ip === target) || null;
    whiteEntry.value = (whitelist.ips || []).find((row) => row.ip === target) || null;
    devices.value = (deviceRes.devices || []).filter((d) => (d.ips || []).includes(target));
  } catch (e) {
    ElMessage.error(e?.message || String(e));
  } finally {
    loading.value = false;
  }
}

watch(() => [state.drawer.visible, state.drawer.ip], ([visible]) => { if (visible) load(); });

/** 「去异常处置」并定位该 IP（readOnly 抽屉 → 换块 + 交接 IP）。 */
function goReview() {
  const target = ip.value;
  closeIpDetail();
  requestView('review', target);
}
/** 「去 IP 封禁」（解封在自己那页做）。 */
function goBanIp() {
  closeIpDetail();
  requestView('ban-ip');
}
</script>

<template>
  <el-drawer
    :model-value="state.drawer.visible"
    :size="isMobile ? '100%' : '520px'"
    direction="rtl"
    class="vs-ip-drawer"
    :with-header="true"
    @update:model-value="(v) => { if (!v) closeIpDetail(); }"
  >
    <template #header>
      <div class="vs-drawer-head">
        <span>IP 详情</span>
        <span class="mono">{{ ip }}</span>
      </div>
    </template>

    <div v-loading="loading" class="vs-drawer-body">
      <div class="vs-kv"><span>地区</span><b>{{ region }}</b></div>
      <div class="vs-kv">
        <span>状态</span>
        <b><el-tag :type="statusTag" size="small">{{ statusText }}</el-tag></b>
      </div>
      <div v-if="blackEntry" class="vs-kv">
        <span>黑名单</span>
        <b>{{ blackEntry.note || '已封禁' }}<template v-if="blackEntry.created_at"> · {{ dateTime(blackEntry.created_at) }}</template></b>
      </div>
      <div v-if="whiteEntry" class="vs-kv">
        <span>白名单</span>
        <b>{{ whiteEntry.note || '已信任' }}<template v-if="whiteEntry.created_at"> · {{ dateTime(whiteEntry.created_at) }}</template></b>
      </div>

      <div class="vs-kpi3">
        <div>访问次数<b>{{ visits.toLocaleString('zh-CN') }}</b></div>
        <div>独立路径<b>{{ paths }}</b></div>
        <div>设备<b>{{ deviceCount }}</b></div>
      </div>

      <h4>最近访问</h4>
      <table v-if="recent.length" class="vs-mini">
        <tr><th>时间</th><th>路径</th><th>结果</th></tr>
        <tr v-for="r in recent.slice(0, 8)" :key="r.id">
          <td class="vs-muted">{{ dateTime(r.created_at) }}</td>
          <td class="mono">{{ r.method }} {{ r.path }}</td>
          <td>{{ r.status || '—' }}<el-tag v-if="r.blocked" type="danger" size="small" class="vs-tag-gap">拦截</el-tag></td>
        </tr>
      </table>
      <p v-else class="vs-empty">近 7 天没有访问记录</p>

      <h4>异常规则（{{ pendingCount }} 条待审）</h4>
      <table v-if="pendingCount" class="vs-mini">
        <tr><th>规则</th><th>命中</th><th>状态</th></tr>
        <tr v-for="r in pendingRules" :key="r.id">
          <td>{{ r.rule }}</td>
          <td>×{{ r.hits }}</td>
          <td><el-tag type="success" size="small">待审</el-tag></td>
        </tr>
      </table>
      <p v-else class="vs-empty">没有待审异常（历史已处置 / 已忽略的记录在「异常处置 → 全部（审计）」可查）</p>

      <h4>设备</h4>
      <table v-if="devices.length" class="vs-mini">
        <tr><th>设备码 / 指纹</th><th>最近出现</th><th>状态</th></tr>
        <tr v-for="d in devices.slice(0, 8)" :key="d.key">
          <td class="mono">{{ d.deviceId || '无设备码' }} / {{ (d.fingerprint || '').slice(0, 12) }}…</td>
          <td class="vs-muted">{{ dateTime(d.lastAt) }}</td>
          <td><el-tag :type="d.banned ? 'danger' : 'info'" size="small">{{ d.banned ? '已封设备' : '正常' }}</el-tag></td>
        </tr>
      </table>
      <p v-else class="vs-empty">没有设备指纹记录</p>

      <p v-if="status === 'banned' && banRemaining(stats?.ban_until)" class="vs-muted">临时封禁 {{ banRemaining(stats?.ban_until) }} 到期，可在「临时封禁」页手动解除。</p>
      <p class="vs-muted">只读：封禁 / 信任 / 封设备只在「异常处置」操作，解封在各封禁页操作。</p>
    </div>

    <template #footer>
      <div class="vs-drawer-foot">
        <el-button @click="closeIpDetail">关闭</el-button>
        <el-button v-if="pendingCount" type="primary" @click="goReview">去异常处置</el-button>
        <el-button v-else-if="status === 'blocked'" type="danger" plain @click="goBanIp">去 IP 封禁</el-button>
      </div>
    </template>
  </el-drawer>
</template>
