<script setup>
// FZ 批（docs/VISITORS-REDESIGN.md §2/§3/§5）：访问记录——四个横 tab 重排为**左侧导航七块**。
//
//   概览 / 异常处置 / 访问分析 / IP 封禁 / 设备封禁 / 临时封禁 / 白名单
//
// 三件事由本文件负责（其余在子组件与 useVisitorsAdmin）：
//   ① URL `?view=` 记录当前块：可直达（/console?section=visitors&view=review）、浏览器后退可回（push 而非 replace）；
//   ② 左侧导航（待审数 >0 标红）+ 移动端（≤760px）收成顶部下拉；
//   ③ 概览 30 秒自动刷新：只在页面可见时拉 `/api/admin/visitors/overview`（切回前台立即补一次）。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { VISITOR_VIEWS, VISITOR_VIEW_IDS, useVisitorsAdmin } from '../../composables/useVisitorsAdmin.js';
import './visitors.css';
import VisitorsOverview from './VisitorsOverview.vue';
import VisitorsReview from './VisitorsReview.vue';
import VisitorsAnalysis from './VisitorsAnalysis.vue';
import VisitorsBanIp from './VisitorsBanIp.vue';
import VisitorsBanDevice from './VisitorsBanDevice.vue';
import VisitorsBanTemp from './VisitorsBanTemp.vue';
import VisitorsWhitelist from './VisitorsWhitelist.vue';
import IpDetailDrawer from './IpDetailDrawer.vue';

const route = useRoute();
const router = useRouter();
const { state, isMobile, loadOverview, resetVisitorsUi } = useVisitorsAdmin();

/** 当前块：URL ?view= 优先，未知/缺省落「概览」（直达与后退都靠它）。 */
const activeView = ref(VISITOR_VIEWS.some((v) => v.id === String(route.query.view)) ? String(route.query.view) : 'overview');
const viewItem = computed(() => VISITOR_VIEWS.find((v) => v.id === activeView.value) || VISITOR_VIEWS[0]);

/** 换块写进 URL（push：后退能回上一块；query 里保留 section 等其它参数）。 */
function selectView(id) {
  if (!VISITOR_VIEW_IDS.includes(id) || id === activeView.value) return;
  activeView.value = id;
  router.push({ path: route.path, query: { ...route.query, view: id } }).catch(() => {});
}
watch(() => route.query.view, (v) => {
  const id = String(v ?? '');
  activeView.value = VISITOR_VIEW_IDS.includes(id) ? id : 'overview';
});

/** 导航徽标：待审（>0 标红）/ 访问分析 IP 数 / IP 黑名单 / 设备封禁 / 临时封 / 白名单。 */
function badgeOf(item) {
  if (!item.badge) return 0;
  if (item.badge === 'pending_reviews') return Number(state.overview.pending_reviews) || 0;
  if (item.badge === 'analysis') return Number(state.nav.analysis) || 0;
  if (item.badge === 'devices') return Number(state.nav.devices) || 0;
  return Number(state.overview[item.badge]) || 0;
}
function isHot(item) {
  return item.badge === 'pending_reviews' && badgeOf(item) > 0;
}
function mobileLabel(item) {
  const n = badgeOf(item);
  return `${item.icon} ${item.label}${n ? `（${n}）` : ''}`;
}

// ---- 移动端（≤760px）左导航收成顶部下拉；断点与后台其余列表一致 ----
const mobileQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(max-width: 760px)') : null;
isMobile.value = Boolean(mobileQuery && mobileQuery.matches);
function onMobileChange(e) { isMobile.value = e.matches; }

// ---- 概览 30 秒自动刷新（仅页面可见时）----
let overviewTimer = null;
function pollOverview() {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
  loadOverview();
}
function onVisibilityChange() {
  if (document.visibilityState === 'visible') loadOverview();
}

/** 跨块跳转（抽屉「去异常处置」等）：换块 + 交接待定位的 IP。 */
watch(() => state.navRequest, (req) => {
  if (!req) return;
  const { view, ip } = req;
  state.navRequest = null;
  if (view !== activeView.value) selectView(view);
  if (ip) state.focus = { ip, seq: Date.now() };
});

onMounted(() => {
  resetVisitorsUi();
  loadOverview();
  overviewTimer = setInterval(pollOverview, 30000);
  document.addEventListener('visibilitychange', onVisibilityChange);
  if (mobileQuery) {
    if (mobileQuery.addEventListener) mobileQuery.addEventListener('change', onMobileChange);
    else if (mobileQuery.addListener) mobileQuery.addListener(onMobileChange);
  }
});
onBeforeUnmount(() => {
  if (overviewTimer) { clearInterval(overviewTimer); overviewTimer = null; }
  document.removeEventListener('visibilitychange', onVisibilityChange);
  if (mobileQuery) {
    if (mobileQuery.removeEventListener) mobileQuery.removeEventListener('change', onMobileChange);
    else if (mobileQuery.removeListener) mobileQuery.removeListener(onMobileChange);
  }
});
</script>

<template>
  <div class="vs-page">
    <aside class="vs-nav" aria-label="访问记录分区">
      <button v-for="item in VISITOR_VIEWS" :key="item.id" type="button" class="vs-nav-item" :class="{ on: item.id === activeView }" :aria-current="item.id === activeView ? 'page' : null" @click="selectView(item.id)">
        <span class="vs-nav-ico">{{ item.icon }}</span>
        <span class="vs-nav-name">{{ item.label }}</span>
        <span v-if="badgeOf(item)" class="vs-nav-count" :class="{ hot: isHot(item) }">{{ badgeOf(item) }}</span>
      </button>
      <div class="vs-nav-foot">处置只在「异常处置」；封禁 / 信任后该 IP 从「有效访问」移出。</div>
    </aside>

    <div class="vs-main">
      <div class="vs-nav-mobile">
        <el-select :model-value="activeView" aria-label="访问记录分区" @change="selectView">
          <el-option v-for="item in VISITOR_VIEWS" :key="item.id" :label="mobileLabel(item)" :value="item.id" />
        </el-select>
      </div>
      <div class="vs-crumb">管理控制台 <span>/</span> 访问与安全 <span>/</span> 访问记录</div>
      <div class="vs-head"><h2>{{ viewItem.label }}</h2><p>{{ viewItem.desc }}</p></div>

      <VisitorsOverview v-if="activeView === 'overview'" />
      <VisitorsReview v-else-if="activeView === 'review'" />
      <VisitorsAnalysis v-else-if="activeView === 'analysis'" />
      <VisitorsBanIp v-else-if="activeView === 'ban-ip'" />
      <VisitorsBanDevice v-else-if="activeView === 'ban-device'" />
      <VisitorsBanTemp v-else-if="activeView === 'ban-temp'" />
      <VisitorsWhitelist v-else-if="activeView === 'whitelist'" />
    </div>

    <!-- 跨块复用：任何列表点 IP 都打开同一个只读抽屉（不在这里封禁，规格 §3-1） -->
    <IpDetailDrawer />
  </div>
</template>
