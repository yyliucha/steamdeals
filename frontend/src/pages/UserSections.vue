<template>
  <!-- DT-1/DT-2（docs/ADMIN-PERMISSIONS.md）：普通用户版 Console 页面分发。
       DT-1 建壳（菜单与守卫），DT-2 接入用户级接口数据。
       admin 用户不走本组件（Console.vue 按角色分支，管理员渲染 AdminModules/AdminExtras）。 -->
  <div class="user-sections-wrap" :class="{ 'm-console': isMobile }">
    <div class="module-card">
      <div class="card-heading">
        <div>
          <h3>{{ title }}</h3>
          <p>{{ desc }}</p>
        </div>
      </div>
      <el-empty :description="emptyText" :image-size="64" />
    </div>
  </div>
</template>

<script setup>
// DT-1 壳：DT-2 接入用户级接口（sessions → /api/me/sessions*、watchlist → /api/watchlist、
// wishlist → /api/me/wishlist、announcements → /api/announcements）。
import { computed, ref } from 'vue';

const props = defineProps({ section: { type: String, required: true } });

const isMobile = ref(false);
function applyMobile() {
  if (typeof window === 'undefined') return;
  isMobile.value = Boolean(window.matchMedia && window.matchMedia('(max-width: 768px)').matches);
}
if (typeof window !== 'undefined') {
  applyMobile();
  const mq = window.matchMedia('(max-width: 768px)');
  const on = () => applyMobile();
  mq.addEventListener ? mq.addEventListener('change', on) : mq.addListener(on);
}

// DT-1 普通用户 5 页文案（demo：design/admin-menu-permissions-2026-11-19.html 普通用户菜单）
const META = {
  sessions: { title: '登录会话（我的设备）', desc: '查看我登录过的设备与会话，可以撤销某个设备的登录。', emptyText: '数据接入开发中（DT-2）' },
  watchlist: { title: '我的到价提醒', desc: '我设置的到价提醒清单。', emptyText: '数据接入开发中（DT-2）' },
  wishlist: { title: '我的愿望单', desc: '我收藏的愿望单游戏。', emptyText: '数据接入开发中（DT-2）' },
  announcements: { title: '站点公告', desc: '站点发布的通知公告（只读）。', emptyText: '数据接入开发中（DT-2）' },
};
const meta = computed(() => META[props.section] ?? { title: props.section, desc: '', emptyText: '未知页面' });
const title = computed(() => meta.value.title);
const desc = computed(() => meta.value.desc);
const emptyText = computed(() => meta.value.emptyText);
</script>
