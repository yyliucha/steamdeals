<script setup>
// Element Plus 统一中文：分页的 Total / Go to / N per page、下拉空值占位等都由 locale 决定
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import { NETWORK_ERROR_MESSAGE, networkDown } from './utils/network.js';
import { dismissUpdate, updateNotice } from './composables/useVersionGuard.js';
import UnsavedLeaveDialog from './components/UnsavedLeaveDialog.vue';

// 不做离线缓存，所以"重试"就是重新向服务器要一次页面；恢复网络后即可正常打开
function retryNetwork() {
  window.location.reload();
}
// 版本更新提示（docs/MOBILE-PWA.md §2.1）：刷新拿到新版，不阻塞其它交互
function refreshUpdate() {
  window.location.reload();
}
</script>

<template>
  <el-config-provider :locale="zhCn">
    <div v-if="updateNotice.visible || networkDown" class="top-bars">
      <div v-if="updateNotice.visible" class="update-bar" role="status">
        <span class="top-bar-text">已更新到 v{{ updateNotice.version }}，点击刷新</span>
        <button type="button" class="top-bar-action" @click="refreshUpdate">刷新</button>
        <button type="button" class="top-bar-close" aria-label="关闭更新提示" @click="dismissUpdate">✕</button>
      </div>
      <div v-if="networkDown" class="network-bar" role="alert">
        <span class="top-bar-text">{{ NETWORK_ERROR_MESSAGE }}</span>
        <button type="button" class="top-bar-action" @click="retryNetwork">重试</button>
      </div>
    </div>
    <router-view />
    <UnsavedLeaveDialog />
  </el-config-provider>
</template>

<style scoped>
.top-bars {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 3000;
  padding-top: env(safe-area-inset-top, 0px);
}
.update-bar,
.network-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 10px 16px;
  font-size: 14px;
  text-align: center;
}
.update-bar {
  background: var(--brand-soft);
  color: var(--brand);
  border-bottom: 1px solid var(--brand-2);
}
.network-bar {
  background: var(--danger-bg);
  color: var(--danger);
  border-bottom: 1px solid var(--danger-soft);
}
.top-bar-text { min-width: 0; }
.top-bar-action {
  flex: none;
  min-height: 32px;
  padding: 4px 14px;
  border: 1px solid currentColor;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.top-bar-close {
  flex: none;
  min-height: 32px;
  min-width: 32px;
  padding: 0 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
</style>
