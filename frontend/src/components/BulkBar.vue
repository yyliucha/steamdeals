<template>
  <div class="bulk-bar" :class="{ active: count > 0 }">
    <div class="bulk-info">
      <strong class="bulk-count">已选 {{ count }} 条</strong>
      <span v-if="hint" class="bulk-hint">{{ hint }}</span>
      <el-button v-if="count > 0" link size="small" @click="$emit('clear')">清空</el-button>
    </div>
    <div class="bulk-actions">
      <el-button
        v-for="item in actions"
        :key="item.key"
        size="small"
        class="bulk-btn"
        :type="item.risk === 'high' ? 'danger' : 'default'"
        :plain="item.risk === 'high'"
        :disabled="count === 0 || item.disabled"
        :loading="running === item.key"
        @click="$emit('run', item)"
      >{{ item.label }}</el-button>
      <slot />
    </div>
  </div>
</template>

<script setup>
// 批量工具条：11 个列表共用。count 为 0 时按钮禁用（不隐藏，保持布局稳定）。
defineProps({
  count: { type: Number, default: 0 },
  actions: { type: Array, default: () => [] },
  running: { type: String, default: '' },
  hint: { type: String, default: '' },
});
defineEmits(['run', 'clear']);
</script>

<style scoped>
.bulk-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 12px;
  margin-bottom: 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--panel);
}
.bulk-bar.active {
  border-color: var(--brand);
  background: var(--brand-soft);
}
.bulk-info {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.bulk-count {
  font-size: 12px;
  color: var(--fg);
  white-space: nowrap;
}
.bulk-hint {
  font-size: 11px;
  color: var(--fg-muted);
}
.bulk-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
/* 触摸目标 ≥44px（移动端验收项）；PC 上靠 padding 撑开即可 */
.bulk-btn {
  min-height: 32px;
}
@media (max-width: 760px) {
  .bulk-bar {
    flex-direction: column;
    align-items: stretch;
  }
  .bulk-actions {
    overflow-x: auto;
    flex-wrap: nowrap;
    padding-bottom: 2px;
  }
  .bulk-btn {
    min-height: 44px;
    flex: none;
  }
}
</style>
