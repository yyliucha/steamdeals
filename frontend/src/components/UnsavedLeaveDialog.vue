<template>
  <el-dialog
    :model-value="unsavedDialog.open"
    title="还有没保存的修改"
    width="min(420px, 92vw)"
    :close-on-click-modal="false"
    @close="stay"
  >
    <p class="unsaved-text">{{ leaveText }}</p>
    <template #footer>
      <el-button type="primary" :loading="saving" @click="onSaveAndLeave">保存并离开</el-button>
      <el-button @click="discard">放弃修改</el-button>
      <el-button @click="stay">留在本页</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
// 未保存修改的三选一弹窗（docs/UNSAVED-GUARD.md §3.1，AN 批）：
// 挂在 App.vue 与 <router-view/> 同级，跨路由存活；状态读 useUnsavedGuard 的模块级 reactive。
// 「保存并离开」全部成功才离开并 toast；任一失败 → 关闭弹窗、留在本页、显示失败原因。
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { unsavedDialog, saveAndLeave, discard, stay } from '../composables/useUnsavedGuard.js';

const saving = ref(false);

const leaveText = computed(() => `「${unsavedDialog.labels.join('」「')}」还有修改没保存，离开后会丢失。要先保存吗？`);

async function onSaveAndLeave() {
  saving.value = true;
  try {
    await saveAndLeave();
    ElMessage.success('已保存');
  } catch (err) {
    ElMessage.error(err?.message || String(err) || '保存失败');
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.unsaved-text {
  margin: 4px 0 8px;
  font-size: 14px;
  line-height: 1.7;
  color: var(--fg-2);
}
</style>
