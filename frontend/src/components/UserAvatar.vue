<template>
  <span
    class="user-avatar"
    :style="{ width: size + 'px', height: size + 'px', fontSize: Math.max(10, Math.round(size * 0.42)) + 'px' }"
    :title="title"
  >
    <img v-if="userId && !failed" :src="`/api/avatar/${userId}`" :alt="title" loading="lazy" @error="failed = true" />
    <span v-else class="fallback">{{ initial }}</span>
  </span>
</template>

<script setup>
// CX 批（docs/USER-PROFILE-EDIT.md §2 #8）：有头像处统一头像组件。
// DQ 批（docs/PROFILE-UI-2026-11-19.md §4）：头像只有 custom 走 /api/avatar/:userId；
// 无头像或加载失败回退首字（昵称首字母英文大写/第一个汉字 + 品牌色），规则统一在 utils/avatar.js。
import { computed, ref, watch } from 'vue';
import { avatarInitial } from '../utils/avatar.js';

const props = defineProps({
  userId: { type: Number, default: null },
  name: { type: String, default: '' },
  size: { type: Number, default: 28 },
});
const failed = ref(false);
watch(
  () => props.userId,
  () => {
    failed.value = false;
  },
);
const initial = computed(() => avatarInitial(props.name, '?'));
const title = computed(() => String(props.name ?? '').trim() || `用户 #${props.userId ?? ''}`);
</script>

<style scoped>
.user-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--brand), #3e4fd8);
  color: #fff;
  font-weight: 700;
  flex: none;
  overflow: hidden;
  vertical-align: middle;
}
.user-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.fallback {
  line-height: 1;
}
</style>
