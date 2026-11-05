<script setup>
// Element Plus 统一中文：分页的 Total / Go to / N per page、下拉空值占位等都由 locale 决定
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import { NETWORK_ERROR_MESSAGE, networkDown } from './utils/network.js';

// 不做离线缓存，所以"重试"就是重新向服务器要一次页面；恢复网络后即可正常打开
function retryNetwork() {
  window.location.reload();
}
</script>

<template>
  <el-config-provider :locale="zhCn">
    <div v-if="networkDown" class="network-bar" role="alert">
      <span class="network-bar-text">{{ NETWORK_ERROR_MESSAGE }}</span>
      <button type="button" class="network-bar-retry" @click="retryNetwork">重试</button>
    </div>
    <router-view />
  </el-config-provider>
</template>

<style scoped>
.network-bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 10px 16px;
  padding-top: calc(10px + env(safe-area-inset-top, 0px));
  background: var(--danger-bg);
  color: var(--danger);
  border-bottom: 1px solid var(--danger-soft);
  font-size: 14px;
  text-align: center;
}
.network-bar-text { min-width: 0; }
.network-bar-retry {
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
</style>
