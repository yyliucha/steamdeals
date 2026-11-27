<script setup>
// GA-1（docs/SYNC-PAGE-REDESIGN.md §2.2 / §3-1）：概览 4 卡。
// 数字口径（全部来自现有只读接口，无新接口）：
//   运行中     = sync/status.running（+ 当前任务名与已跑分钟）
//   需要关注   = schedule.groups 里健康为「失败」的组数（点击滚到最近失败组并展开）
//   429 补跑队列 = sync/429queue.count（最早入队时间来自 429queue.oldestAt）
//   今日待补   = sync/freshness 四类「超 1 天」之和（副标题给出每类 d1）
import { fmtHM } from '../../composables/useSyncAdmin.js';

defineProps({
  kpi: { type: Object, required: true },
});
defineEmits(['jump']);
</script>

<template>
  <div class="sync-kpis" role="group" aria-label="同步概览">
    <button type="button" class="sync-kpi run" data-jump="run" @click="$emit('jump', 'run')">
      <span>运行中</span>
      <b>{{ kpi.running }}</b>
      <small>
        <template v-if="kpi.running">{{ kpi.runningLabel }}<template v-if="kpi.runningElapsedMin != null"> · 已跑 {{ kpi.runningElapsedMin }} 分钟</template></template>
        <template v-else>当前没有运行中的任务</template>
      </small>
      <small v-if="kpi.runningProgress">已补 {{ kpi.runningProgress.done.toLocaleString('zh-CN') }} / {{ kpi.runningProgress.limit.toLocaleString('zh-CN') }}（{{ kpi.runningProgress.percent }}%） · {{ kpi.runningProgress.ratePerMin }} 款/分钟</small>
    </button>
    <button type="button" class="sync-kpi fail" data-jump="fail" @click="$emit('jump', 'fail')">
      <span>需要关注</span>
      <b>{{ kpi.failed }}</b>
      <small>
        <template v-if="kpi.failed">{{ kpi.failedNames.join(' · ') }}<template v-if="kpi.failed > kpi.failedNames.length"> 等</template></template>
        <template v-else>没有失败的任务组</template>
      </small>
    </button>
    <button type="button" class="sync-kpi queue" data-jump="queue" @click="$emit('jump', 'queue')">
      <span>429 补跑队列</span>
      <b>{{ kpi.queue }}</b>
      <small>
        <template v-if="kpi.queueOldestAt">最早入队 {{ fmtHM(kpi.queueOldestAt) }}</template>
        <template v-else>队列为空</template>
      </small>
    </button>
    <button type="button" class="sync-kpi" data-jump="today" @click="$emit('jump', 'today')">
      <span>今日待补</span>
      <b>{{ kpi.today.toLocaleString('zh-CN') }}</b>
      <small>价格 {{ kpi.parts.prices.toLocaleString('zh-CN') }} · 状态 {{ kpi.parts.status.toLocaleString('zh-CN') }} · 中文名 {{ kpi.parts.names.toLocaleString('zh-CN') }} · 缺封面 {{ kpi.parts.images.toLocaleString('zh-CN') }}</small>
    </button>
  </div>
</template>
