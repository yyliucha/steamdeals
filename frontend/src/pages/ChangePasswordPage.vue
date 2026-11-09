<template>
  <div class="auth-page">
    <main class="auth-card-wrap">
      <div v-if="!authed" class="auth-card">
        <h2>修改密码</h2>
        <p class="muted">需要先登录才能修改密码。</p>
        <router-link to="/login"><el-button type="primary" class="auth-submit">去登录</el-button></router-link>
      </div>
      <form v-else class="auth-card" @submit.prevent="submit">
        <h2>修改密码</h2>
        <el-alert v-if="forced" title="首次登录请修改初始密码" description="改完才能进入其它页面。" type="warning" :closable="false" class="auth-top-error" />
        <label class="auth-field">
          <span>当前密码</span>
          <el-input v-model="oldPassword" type="password" show-password autocomplete="current-password" placeholder="当前密码" />
          <small v-if="fieldError.oldPassword" class="auth-error">{{ fieldError.oldPassword }}</small>
        </label>
        <label class="auth-field">
          <span>新密码（≥12 位）</span>
          <el-input v-model="newPassword" type="password" show-password autocomplete="new-password" placeholder="新密码（≥12 位）" @input="scheduleStrength" />
          <el-progress v-if="strength" :percentage="Math.max(8, strength.score * 25)" :status="strength.status" :stroke-width="8" :show-text="false" />
          <small v-if="strength" class="strength-note">{{ strength.note }}</small>
          <small v-if="fieldError.newPassword" class="auth-error">{{ fieldError.newPassword }}</small>
        </label>
        <label class="auth-field">
          <span>确认新密码</span>
          <el-input v-model="confirm" type="password" show-password autocomplete="new-password" placeholder="再输入一次新密码" />
          <small v-if="fieldError.confirm" class="auth-error">{{ fieldError.confirm }}</small>
        </label>
        <el-alert v-if="topError" :title="topError" type="error" :closable="false" class="auth-top-error" />
        <el-button type="primary" class="auth-submit" :loading="loading" native-type="submit">修改密码</el-button>
      </form>
    </main>
  </div>
</template>

<script setup>
// 修改密码页（docs/AUTH-REDESIGN.md §5.4，AL 批）：当前密码/新密码/确认 + 强度条；
// forced=1 时顶部不可关闭的「首次登录请修改初始密码」；成功后提示并回首页。
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';

const router = useRouter();
const route = useRoute();
const forced = computed(() => route.query.forced === '1');
const authed = ref(false);
const oldPassword = ref(''), newPassword = ref(''), confirm = ref('');
const fieldError = ref({});
const topError = ref('');
const loading = ref(false);
const strength = ref(null);
let strengthTimer = null;

async function api(path, options = {}) {
  const res = await fetch(path, { credentials: 'same-origin', ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* 忽略 */ }
  if (!res.ok) {
    const err = new Error(data.error || `请求失败 (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function scheduleStrength() {
  clearTimeout(strengthTimer);
  strengthTimer = setTimeout(async () => {
    if (!newPassword.value) { strength.value = null; return; }
    try {
      const d = await api('/api/password/check', { method: 'POST', body: JSON.stringify({ password: newPassword.value }) });
      strength.value = { score: d.score ?? 0, status: d.ok ? 'success' : 'exception', note: d.ok ? '强度不错' : (d.suggestions?.[0] || '换个更强的密码') };
    } catch { strength.value = null; }
  }, 300);
}

async function submit() {
  fieldError.value = {};
  topError.value = '';
  if (newPassword.value !== confirm.value) { fieldError.value = { confirm: '两次输入的新密码不一致' }; return; }
  loading.value = true;
  try {
    await api('/api/user/password', { method: 'POST', body: JSON.stringify({ oldPassword: oldPassword.value, newPassword: newPassword.value }) });
    ElMessage.success('密码已修改，其它设备已退出登录');
    router.replace('/');
  } catch (e) {
    const msg = e.message || '修改失败';
    topError.value = msg;
    if (msg.includes('当前密码')) fieldError.value = { oldPassword: msg };
    else if (msg.includes('密码')) fieldError.value = { newPassword: msg };
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  try {
    const d = await api('/api/me');
    authed.value = Boolean(d.user);
  } catch {
    authed.value = false;
  }
});
onUnmounted(() => { clearTimeout(strengthTimer); });
</script>

<style scoped>
.auth-page{min-height:100vh;min-height:100dvh;display:flex;background:radial-gradient(ellipse at 50% -18%,var(--bg-glow) 0%,transparent 44%),var(--bg)}
.auth-card-wrap{flex:1;display:flex;align-items:center;justify-content:center;padding:24px}
.auth-card{width:420px;max-width:92vw;background:var(--panel);border:1px solid var(--border);border-radius:16px;padding:26px 26px 20px;box-shadow:0 8px 30px #26345a12}
.auth-card h2{font-size:18px;margin:0 0 16px}
.auth-field{display:grid;gap:6px;margin-bottom:14px}
.auth-field>span{font-size:12px;color:var(--fg-muted)}
.auth-error{color:var(--danger);font-size:11px;margin:0}
.strength-note{color:var(--fg-muted);font-size:11px;margin:0}
.auth-top-error{margin-bottom:12px}
.auth-submit{width:100%;margin-top:4px}
.muted{color:var(--fg-muted);font-size:13px;line-height:1.7}
@media (max-width:900px){.auth-submit{min-height:44px}}
</style>
