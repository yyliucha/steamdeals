<script setup>
// GA-1（docs/SYNC-PAGE-REDESIGN.md §2.2 / §3）：同步与回填页——页面壳。
//
// 自上而下（与 demo design/sync-page-redesign-2026-11-27.html 一致）：
//   概览 4 卡（SyncKpiBar）
//   任务组表（主区，TaskGroupTable；告警收进表头、手动任务组在末尾）
//   折叠「数据质量」（SyncQualityPanel：分级统计 + 数据时效 + 429 队列）
//   折叠「工具」（SyncToolsPanel：初始化全量同步 + App 版本）
//
// 这一层只做三件事：① 挂载即拉一次 + 8 秒轮询（页面不可见时跳过）；② 概览卡跳转
// （「需要关注」滚到最近失败组并展开、「429 队列 / 今日待补」打开数据质量折叠）；
// ③ 离开页面清瞬态（已提交标记、定时器）。
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useSyncAdmin } from '../../composables/useSyncAdmin.js';
import './sync.css';
import SyncKpiBar from './SyncKpiBar.vue';
import TaskGroupTable from './TaskGroupTable.vue';
import SyncFold from './SyncFold.vue';
import SyncQualityPanel from './SyncQualityPanel.vue';
import SyncToolsPanel from './SyncToolsPanel.vue';

const {
  state,
  kpi,
  failedGroups,
  qualitySummary,
  toolsSummary,
  refreshAll,
  loadStatus,
  resetSyncUi,
} = useSyncAdmin();

const groupTable = ref(null);
const qualityFold = ref(null);
const toolsFold = ref(null);

/** 概览卡跳转：fail → 滚到最近失败组并展开；queue/today → 打开数据质量；run → 提示当前任务。 */
async function onJump(kind) {
  if (kind === 'run') {
    if (kpi.value.running) {
      ElMessage.info(`运行中任务：${kpi.value.runningLabel}${kpi.value.runningElapsedMin != null ? `（已跑 ${kpi.value.runningElapsedMin} 分钟）` : ''}`);
    } else {
      ElMessage.info('当前没有运行中的任务');
    }
    return;
  }
  if (kind === 'fail') {
    const first = failedGroups.value[0];
    if (!first) {
      ElMessage.success('没有失败的任务组');
      return;
    }
    groupTable.value?.expandGroup?.(first.name);
    await nextTick();
    document.querySelector(`.sync-row[data-group="${first.name}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    ElMessage.info(`已定位到「${first.label}」`);
    return;
  }
  // queue / today：数字都在「数据质量」折叠里，展开并滚过去
  qualityFold.value?.expand?.();
  await nextTick();
  qualityFold.value?.$el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
}

/** 8 秒轮询（页面不可见时跳过，切回前台立即补一次）。 */
let timer = null;
function poll() {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
  loadStatus();
}
function onVisibility() {
  if (document.visibilityState === 'visible') loadStatus();
}

onMounted(() => {
  refreshAll();
  timer = setInterval(poll, 8000);
  document.addEventListener('visibilitychange', onVisibility);
});
onBeforeUnmount(() => {
  if (timer) { clearInterval(timer); timer = null; }
  document.removeEventListener('visibilitychange', onVisibility);
  resetSyncUi();
});

defineExpose({ qualityFold, toolsFold });
</script>

<template>
  <div class="sync-page">
    <SyncKpiBar :kpi="kpi" @jump="onJump" />
    <TaskGroupTable ref="groupTable" />
    <SyncFold ref="qualityFold" title="数据质量" :summary="qualitySummary">
      <SyncQualityPanel />
    </SyncFold>
    <SyncFold ref="toolsFold" title="工具" :summary="toolsSummary">
      <SyncToolsPanel />
    </SyncFold>
  </div>
</template>
