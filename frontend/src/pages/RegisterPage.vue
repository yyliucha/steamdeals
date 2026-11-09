<template>
  <div class="auth-page">
    <main class="auth-card-wrap">
      <form v-if="available" class="auth-card" @submit.prevent="submit">
        <h2>注册 SteamDeals</h2>
        <label class="auth-field">
          <span>用户名（3-32 个字符，不含空格或斜杠）</span>
          <el-input v-model="username" placeholder="用户名" autocomplete="username" />
          <small v-if="fieldError.username" class="auth-error">{{ fieldError.username }}</small>
        </label>
        <label class="auth-field">
          <span>邮箱</span>
          <el-input v-model="email" placeholder="邮箱" autocomplete="email" />
          <small v-if="fieldError.email" class="auth-error">{{ fieldError.email }}</small>
        </label>
        <div class="email-code-row">
          <el-input v-model="code" placeholder="邮箱验证码（6 位）" maxlength="6" />
          <el-button :disabled="codeCooldown > 0" @click="requestCode">{{ codeCooldown > 0 ? `${codeCooldown}s 后重发` : '发送验证码' }}</el-button>
        </div>
        <label class="auth-field">
          <span>密码（≥12 位）</span>
          <el-input v-model="password" type="password" show-password autocomplete="new-password" placeholder="密码（≥12 位）" @input="scheduleStrength" />
          <el-progress v-if="strength" :percentage="Math.max(8, strength.score * 25)" :status="strength.status" :stroke-width="8" :show-text="false" />
          <small v-if="strength" class="strength-note">{{ strength.note }}</small>
          <small v-if="fieldError.password" class="auth-error">{{ fieldError.password }}</small>
        </label>
        <label class="auth-field">
          <span>确认密码</span>
          <el-input v-model="confirm" type="password" show-password autocomplete="new-password" placeholder="再输入一次密码" />
          <small v-if="fieldError.confirm" class="auth-error">{{ fieldError.confirm }}</small>
        </label>
        <el-alert v-if="topError" :title="topError" type="error" :closable="false" class="auth-top-error" />
        <el-button type="primary" class="auth-submit" :loading="loading" native-type="submit">注册并登录</el-button>
        <p class="auth-foot">已有账号？<router-link to="/login">返回登录</router-link></p>
      </form>
      <div v-else class="auth-card">
        <h2>注册暂不可用</h2>
        <p class="muted">{{ unavailableText }}</p>
        <router-link to="/login"><el-button type="primary" class="auth-submit">返回登录</el-button></router-link>
      </div>
    </main>
  </div>
</template>

<script setup>
// 注册页（docs/AUTH-REDESIGN.md §5.3，AL 批）：用户名/邮箱/验证码（60 秒倒计时重发）/密码/确认密码，
// 密码强度条（/api/password/check，300ms 防抖，只提示不阻断）；开关关闭或 SMTP 未配置 → 显示不可用说明 + 返回登录。
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';

const router = useRouter();
const route = useRoute();
const username = ref(''), email = ref(''), code = ref(''), password = ref(''), confirm = ref('');
const codeCooldown = ref(0);
const fieldError = ref({});
const topError = ref('');
const loading = ref(false);
const strength = ref(null);
const available = ref(true);
const unavailableText = ref('暂未开放注册，请联系管理员。');
let cooldownTimer = null;
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

function safeNext() {
  const next = String(route.query.next ?? '');
  return next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

function scheduleStrength() {
  clearTimeout(strengthTimer);
  strengthTimer = setTimeout(async () => {
    if (!password.value) { strength.value = null; return; }
    try {
      const d = await api('/api/password/check', { method: 'POST', body: JSON.stringify({ password: password.value, username: username.value, email: email.value }) });
      strength.value = {
        score: d.score ?? 0,
        status: d.ok ? 'success' : 'exception',
        note: d.ok ? '强度不错' : (d.suggestions?.[0] || '换个更强的密码'),
      };
    } catch { strength.value = null; }
  }, 300);
}

async function requestCode() {
  fieldError.value = {};
  if (!username.value.trim()) { fieldError.value = { username: '请先填写用户名' }; return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) { fieldError.value = { email: '邮箱格式不正确' }; return; }
  try {
    await api('/api/auth/register/request', { method: 'POST', body: JSON.stringify({ username: username.value.trim(), email: email.value.trim() }) });
    ElMessage.info('验证码已发送到邮箱，请查收');
    codeCooldown.value = 60;
    clearInterval(cooldownTimer);
    cooldownTimer = setInterval(() => { codeCooldown.value -= 1; if (codeCooldown.value <= 0) clearInterval(cooldownTimer); }, 1000);
  } catch (e) {
    if (e.status === 403 || e.status === 503) {
      available.value = false;
      unavailableText.value = e.message;
    } else if (e.status === 409) {
      fieldError.value = { email: e.message, username: e.message };
      topError.value = e.message;
    } else {
      topError.value = e.message;
    }
  }
}

async function submit() {
  fieldError.value = {};
  topError.value = '';
  if (password.value !== confirm.value) { fieldError.value = { confirm: '两次输入的密码不一致' }; return; }
  loading.value = true;
  try {
    await api('/api/auth/register/verify', {
      method: 'POST',
      body: JSON.stringify({ email: email.value.trim(), code: code.value.trim(), username: username.value.trim(), password: password.value }),
    });
    ElMessage.success('注册成功，已自动登录');
    router.replace(safeNext());
  } catch (e) {
    const msg = e.message || '注册失败';
    topError.value = msg;
    if (msg.includes('用户名')) fieldError.value = { username: msg };
    else if (msg.includes('邮箱')) fieldError.value = { email: msg };
    else if (msg.includes('验证码')) fieldError.value = { email: msg };
    else if (msg.includes('密码')) fieldError.value = { password: msg };
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  try {
    const d = await api('/api/me');
    if (d.user) { router.replace(d.user.mustChangePassword ? '/change-password?forced=1' : safeNext()); return; }
  } catch { /* 未登录，继续 */ }
  try {
    const s = await api('/api/site');
    if (s.registration && (s.registration.enabled === false || s.registration.smtpReady === false)) {
      available.value = false;
      unavailableText.value = s.registration.enabled === false ? '暂未开放注册，请联系管理员。' : '系统还没有配置发信邮箱，注册暂不可用，请联系管理员。';
    }
  } catch { /* 拿不到站点信息时保持表单可用，服务端仍会拦 */ }
});
onUnmounted(() => { clearInterval(cooldownTimer); clearTimeout(strengthTimer); });
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
.email-code-row{display:flex;align-items:center;gap:9px;margin-bottom:14px}
.email-code-row .el-input{flex:1}
.auth-top-error{margin-bottom:12px}
.auth-submit{width:100%;margin-top:4px}
.auth-foot{margin:14px 0 0;font-size:12px;color:var(--fg-muted);text-align:center}
.auth-foot a{color:var(--brand);text-decoration:none}
.muted{color:var(--fg-muted);font-size:13px;line-height:1.7}
@media (max-width:900px){.auth-submit{min-height:44px}}
</style>
