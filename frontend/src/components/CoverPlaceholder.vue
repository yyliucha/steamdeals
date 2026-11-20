<template>
  <!-- EC 批（docs/IMAGE-COVERAGE.md §8 EC-3）：缺图品牌占位——S 标（SteamDeals）+ 游戏名首字；
       列表与详情共用，图片失败时显示，不再空白块。 -->
  <span class="cover-ph" :class="[size, { fill }]" aria-hidden="true">
    <i class="ph-s">S</i>
    <b class="ph-char">{{ ch }}</b>
  </span>
</template>

<script setup>
import { computed } from 'vue';
const props = defineProps({
  name: { type: String, default: '' },
  size: { type: String, default: 'sm' }, // sm=后台小图（胶囊比例）/ lg=列表与详情 header（16:9）
  fill: { type: Boolean, default: false }, // true=跟随父容器铺满（绝对定位场景）
});
const ch = computed(() => (props.name || 'S').trim().charAt(0).toUpperCase() || 'S');
</script>

<style scoped>
.cover-ph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
  background: linear-gradient(130deg, var(--brand-soft), var(--bg-2));
  color: var(--fg-subtle);
  overflow: hidden;
  flex: none;
}
.cover-ph .ph-s {
  position: absolute;
  left: 5px;
  top: 1px;
  font-size: 10px;
  font-weight: 900;
  font-style: normal;
  line-height: 1;
  opacity: 0.5;
}
.cover-ph .ph-char {
  font-weight: 800;
  letter-spacing: -0.02em;
}
.cover-ph.sm {
  width: 48px;
  height: 27px;
  border-radius: 6px;
  font-size: 12px;
}
.cover-ph.lg {
  width: 100%;
  aspect-ratio: 460 / 215;
  border-radius: 8px;
  font-size: 32px;
}
.cover-ph.fill {
  width: 100%;
  height: 100%;
  border-radius: inherit;
}
</style>
