<script setup>
// FZ 批（docs/VISITORS-REDESIGN.md §2 概览 / §7-2）：6 张数字卡——今日请求 / 被拦截 / 待审 / 临时封 /
// 黑名单 / 白名单，数据来自 `GET /api/admin/visitors/overview`（一次查询 6 个数，与卡片一一对应）。
// 「待审」>0 标红并可点（跳异常处置）；临时封 >0 标黄；黑名单 / 白名单 / 临时封也可点进各自页面。
// 30 秒自动刷新在 shell（VisitorsAdmin）里做，这里只负责展示与手动刷新。
import { computed } from 'vue';
import { useVisitorsAdmin } from '../../composables/useVisitorsAdmin.js';

const { state, requestView, loadOverview } = useVisitorsAdmin();

const cards = computed(() => [
  { key: 'today_requests', label: '今日请求', value: state.overview.today_requests },
  { key: 'today_blocked', label: '被拦截', value: state.overview.today_blocked },
  { key: 'pending_reviews', label: '待审异常', value: state.overview.pending_reviews, hot: Number(state.overview.pending_reviews) > 0, view: 'review' },
  { key: 'temp_bans', label: '临时封', value: state.overview.temp_bans, warn: Number(state.overview.temp_bans) > 0, view: 'ban-temp' },
  { key: 'blacklist', label: 'IP 黑名单', value: state.overview.blacklist, view: 'ban-ip' },
  { key: 'whitelist', label: '白名单', value: state.overview.whitelist, view: 'whitelist' },
]);

function fmtNum(value) {
  const n = Number(value) || 0;
  return n.toLocaleString('zh-CN');
}
</script>

<template>
  <div class="vs-stack">
    <div class="vs-toolbar">
      <span class="vs-muted">每 30 秒自动刷新（页面可见时）；有积压会标红。</span>
      <span style="flex:1"></span>
      <el-button :loading="state.overviewLoading" @click="loadOverview">刷新</el-button>
    </div>

    <div class="vs-cards">
      <component
        :is="card.view ? 'button' : 'div'"
        v-for="card in cards"
        :key="card.key"
        type="button"
        class="vs-kpi"
        :class="{ hot: card.hot, warn: card.warn, clickable: Boolean(card.view) }"
        :title="card.view ? `查看${card.label}` : null"
        @click="card.view && requestView(card.view)"
      >
        <span>{{ card.label }}</span>
        <b>{{ fmtNum(card.value) }}</b>
      </component>
    </div>

    <p v-if="state.overviewError" class="vs-muted">概览数字加载失败：{{ state.overviewError }}（保留上一次的数字）</p>

    <div class="vs-note">
      <strong>处置入口只有「异常处置」</strong>
      封禁 / 信任 / 封设备 / 忽略都在异常处置的待审队列里做（行内 + 批量）；处置后该行立即消失、待审数减 1。
      访问分析只读，点 IP 看详情；封禁与信任后的 IP 从「有效访问（默认）」移出，历史仍可在「已封禁 / 已信任」查。
    </div>
    <div class="vs-note warn">
      <strong>四类解封各在自己那页</strong>
      IP 封禁 / 设备封禁 / 临时封禁 / 白名单 各自解封；「解除临时封禁」只清自动临时封禁（ip_abuse），<b>不会</b>移除 IP 黑名单。
    </div>
  </div>
</template>
