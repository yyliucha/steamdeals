<script setup>
// GA-1（docs/SYNC-PAGE-REDESIGN.md §3-3）：折叠区容器。
// 标题行整行可点开合；收起时标题行右侧仍显示关键摘要（summary 由调用方给，已含数字）。
import { ref } from 'vue';

const props = defineProps({
  title: { type: String, required: true },
  summary: { type: String, default: '' },
  /** 初始是否展开（默认收起——页面上主区是任务表）。 */
  defaultOpen: { type: Boolean, default: false },
});

const open = ref(props.defaultOpen);
function toggle() {
  open.value = !open.value;
}
defineExpose({ open, expand: () => { open.value = true; } });
</script>

<template>
  <section class="sync-fold" :class="{ open }">
    <button type="button" class="sync-fold-head" :aria-expanded="open" @click="toggle">
      <span class="sync-caret" :class="{ on: open }">▸</span>
      <h2>{{ title }}</h2>
      <span class="sync-fold-sum">{{ summary }}</span>
    </button>
    <div v-show="open" class="sync-fold-body">
      <slot />
    </div>
  </section>
</template>
