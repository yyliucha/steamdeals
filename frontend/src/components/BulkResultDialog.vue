<template>
  <el-dialog
    :model-value="modelValue"
    title="批量操作结果"
    width="min(560px, 92vw)"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="bulk-result-summary">
      <div class="summary-item">
        <span>总数</span>
        <strong>{{ result?.total ?? 0 }}</strong>
      </div>
      <div class="summary-item ok">
        <span>成功</span>
        <strong>{{ result?.ok ?? 0 }}</strong>
      </div>
      <div class="summary-item skip">
        <span>跳过</span>
        <strong>{{ result?.skipped ?? 0 }}</strong>
      </div>
      <div class="summary-item fail">
        <span>失败</span>
        <strong>{{ result?.failed ?? 0 }}</strong>
      </div>
    </div>

    <p v-if="result?.opId" class="bulk-result-tip">
      已记录到「系统 → 批量操作记录」（#{{ result.opId }}）；跳过表示记录不存在或已经是目标状态。
    </p>

    <el-table v-if="rows.length" :data="rows" size="small" max-height="280" class="bulk-result-table">
      <el-table-column prop="key" label="条目" min-width="160" show-overflow-tooltip />
      <el-table-column label="结果" width="80">
        <template #default="{ row }">
          <el-tag :type="row.status === 'failed' ? 'danger' : 'info'" size="small">
            {{ row.status === 'failed' ? '失败' : '跳过' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="reason" label="原因" min-width="180" show-overflow-tooltip />
    </el-table>

    <template #footer>
      <el-button type="primary" @click="$emit('update:modelValue', false)">知道了</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
// 批量执行结果弹窗：成功条数用汇总数字表示，明细只列「跳过 / 失败」（成功不需要逐条念）。
import { computed } from 'vue';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  result: { type: Object, default: null },
});
defineEmits(['update:modelValue']);

const rows = computed(() => (Array.isArray(props.result?.results) ? props.result.results : []));
</script>

<style scoped>
.bulk-result-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}
.summary-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--panel);
}
.summary-item span {
  font-size: 11px;
  color: var(--fg-muted);
}
.summary-item strong {
  font-size: 20px;
}
.summary-item.ok strong {
  color: var(--success);
}
.summary-item.fail strong {
  color: var(--danger);
}
.bulk-result-tip {
  margin: 0 0 10px;
  font-size: 11px;
  color: var(--fg-muted);
  overflow-wrap: anywhere;
}
@media (max-width: 560px) {
  .bulk-result-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
