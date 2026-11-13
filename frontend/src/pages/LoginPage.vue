<template>
  <div class="auth-page">
    <!-- 桌面左品牌区（≤900px 隐藏，单列表单卡） -->
    <aside class="auth-brand" aria-hidden="true">
      <a class="brand" href="/"><span class="brand-mark">S</span><span>SteamDeals<small>游戏价格情报</small></span></a>
      <h1>好游戏，等个好价格。</h1>
      <p>聚合 Steam 与授权平台报价，找到值得入手的折扣。</p>
      <div class="auth-stats">
        <div><strong>{{ catalogCount ? Number(catalogCount).toLocaleString() : '…' }}</strong><span>款收录条目</span></div>
        <div><strong>{{ pricedCount ? Number(pricedCount).toLocaleString() : '…' }}</strong><span>款有报价</span></div>
        <div><strong>5</strong><span>家商店比价</span></div>
      </div>
    </aside>
    <main class="auth-card-wrap">
      <form class="auth-card" @submit.prevent="onSubmit">
        <h2>登录 SteamDeals</h2>
        <div class="auth-modes">
          <button type="button" :class="{ on: mode === 'password' }" @click="mode = 'password'">密码登录</button>
          <button type="button" :class="{ on: mode === 'email' }" @click="mode = 'email'">邮箱验证码</button>
          <button type="button" :class="{ on: mode === 'reset' }" @click="mode = 'reset'">忘记密码</button>
        </div>

        <template v-if="mode === 'password'">
          <label class="auth-field">
            <span>用户名</span>
            <el-input v-model="username" placeholder="用户名" autocomplete="username" />
            <small v-if="fieldError.username" class="auth-error">{{ fieldError.username }}</small>
          </label>
          <label class="auth-field">
            <span>密码</span>
            <el-input v-model="password" type="password" show-password autocomplete="current-password" placeholder="密码" @keyup="onCapsKey" />
            <small v-if="capsOn" class="auth-error">大写锁定已开启</small>
            <small v-if="fieldError.password" class="auth-error">{{ fieldError.password }}</small>
          </label>
          <div class="captcha-row">
            <img v-if="captchaImage" :src="captchaImage" alt="登录验证码，点击刷新" title="点击刷新验证码" @click="loadCaptcha">
            <button v-else type="button" class="captcha-retry" @click="loadCaptcha">验证码加载失败<br>点击重试</button>
            <el-input v-model="captchaAnswer" placeholder="验证码" maxlength="6" autocomplete="off" />
          </div>
          <label class="auth-remember"><el-checkbox v-model="rememberMe">记住我（30 天）</el-checkbox></label>
        </template>

        <template v-else>
          <label class="auth-field">
            <span>邮箱</span>
            <el-input v-model="email" placeholder="账号绑定的邮箱" autocomplete="email" />
            <small v-if="fieldError.email" class="auth-error">{{ fieldError.email }}</small>
          </label>
          <div class="email-code-row">
            <el-input v-model="emailCode" placeholder="6 位验证码" maxlength="6" />
            <el-button :disabled="codeCooldown > 0" @click="requestEmailCode">{{ codeCooldown > 0 ? `${codeCooldown}s 后重发` : '发送验证码' }}</el-button>
          </div>
          <label v-if="mode === 'reset'" class="auth-field">
            <span>新密码（≥12 位）</span>
            <el-input v-model="newPassword" type="password" show-password autocomplete="new-password" placeholder="新密码（≥12 位）" />
            <small v-if="fieldError.newPassword" class="auth-error">{{ fieldError.newPassword }}</small>
          </label>
        </template>

        <el-alert v-if="expiredHint" title="登录已过期，请重新登录" type="warning" :closable="false" class="auth-top-error" />
        <el-alert v-if="topError" :title="topError" type="error" :closable="false" class="auth-top-error" />
        <el-button type="primary" class="auth-submit" :loading="loading" native-type="submit">{{ mode === 'reset' ? '重置密码' : mode === 'password' ? '登录' : '验证码登录' }}</el-button>
        <p class="auth-foot">还没有账号？<router-link to="/register">注册</router-link></p>
      </form>
    </main>
  </div>
</template>

<script setup>
// 独立登录页（docs/AUTH-REDESIGN.md §5.2，AL 批）：三种模式分段切换（切换不丢已填内容）、
// 密码可见切换 + Caps Lock 提示、错误就地显示、记住我 30 天、成功回跳 next（只允许站内相对路径）。
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';

const router = useRouter();
const route = useRoute();
// BM-3（docs/SESSION-MANAGEMENT.md §8.4.3）：会话失效软跳过来时（reason=expired）提示「登录已过期」；
// 直接打开 /login 不带 reason 则不提示。
const expiredHint = computed(() => route.query.reason === 'expired');
const mode = ref('password');
const username = ref(''), password = ref(''), email = ref(''), emailCode = ref(''), newPassword = ref('');
const rememberMe = ref(false);
const captchaAnswer = ref(''), captchaToken = ref(''), captchaImage = ref('');
const topError = ref('');
const fieldError = ref({});
const loading = ref(false);
const capsOn = ref(false);
const codeCooldown = ref(0);
let cooldownTimer = null;
const catalogCount = ref(0), pricedCount = ref(0);

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

async function loadCaptcha() {
  try {
    const d = await api('/api/captcha');
    captchaToken.value = d.token || '';
    captchaImage.value = d.svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(d.svg)}` : '';
  } catch {
    captchaToken.value = '';
    captchaImage.value = '';
  }
}

function onCapsKey(e) { capsOn.value = e.getModifierState?.('CapsLock') ?? false; }

async function requestEmailCode() {
  fieldError.value = {};
  try {
    const d = await api('/api/auth/email/request', { method: 'POST', body: JSON.stringify({ email: email.value.trim(), purpose: mode.value === 'reset' ? 'reset' : 'login' }) });
    topError.value = '';
    ElMessage.info(d.hint || '如果邮箱已绑定且可用，验证码将发送到该邮箱');
    codeCooldown.value = 60;
    clearInterval(cooldownTimer);
    cooldownTimer = setInterval(() => { codeCooldown.value -= 1; if (codeCooldown.value <= 0) clearInterval(cooldownTimer); }, 1000);
  } catch (e) { topError.value = e.message; }
}

async function onSubmit() {
  fieldError.value = {};
  topError.value = '';
  loading.value = true;
  try {
    if (mode.value === 'password') {
      await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ username: username.value.trim(), password: password.value, captchaToken: captchaToken.value, captchaAnswer: captchaAnswer.value, rememberMe: rememberMe.value }),
      });
      router.replace(safeNext());
      return;
    }
    const purpose = mode.value === 'reset' ? 'reset' : 'login';
    const payload = { email: email.value.trim(), code: emailCode.value.trim(), purpose };
    if (purpose === 'reset') payload.password = newPassword.value;
    const d = await api('/api/auth/email/verify', { method: 'POST', body: JSON.stringify(payload) });
    if (purpose === 'reset') {
      ElMessage.success(d.message || '密码已重置，请使用新密码登录');
      mode.value = 'password';
      emailCode.value = '';
      newPassword.value = '';
      await loadCaptcha();
      return;
    }
    router.replace(safeNext());
  } catch (e) {
    const msg = e.message || '登录失败';
    if (e.status === 400 && (msg.includes('验证码') || msg.includes('用户名') || msg.includes('密码'))) {
      // 就地显示：按内容归位到对应字段下方
      if (mode.value === 'password') {
        if (msg.includes('验证码')) fieldError.value = { captcha: msg };
        else if (msg.includes('密码')) fieldError.value = { password: msg };
        else fieldError.value = { username: msg };
        topError.value = msg;
      } else {
        fieldError.value = { email: msg };
        topError.value = msg;
      }
      await loadCaptcha();
    } else {
      topError.value = msg;
      await loadCaptcha();
    }
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  try {
    const d = await api('/api/me');
    if (d.user?.mustChangePassword) {
      router.replace('/change-password?forced=1');
      return;
    }
    if (d.user) {
      router.replace(safeNext());
      return;
    }
  } catch { /* 未登录，停留登录页 */ }
  await loadCaptcha();
  try {
    const c = await api('/api/games/count');
    catalogCount.value = Number(c.catalog) || 0;
    pricedCount.value = Number(c.priced) || 0;
  } catch { /* 品牌区数据点失败不阻塞登录 */ }
});
</script>

<style scoped>
.auth-page{min-height:100vh;min-height:100dvh;display:flex;background:radial-gradient(ellipse at 50% -18%,var(--bg-glow) 0%,transparent 44%),var(--bg)}
.auth-brand{flex:1;display:flex;flex-direction:column;justify-content:center;padding:0 8vw;gap:14px}
.auth-brand .brand{text-decoration:none;color:var(--fg)}
.auth-brand h1{font-size:38px;margin:0;letter-spacing:-.02em}
.auth-brand p{color:var(--fg-muted);font-size:15px;margin:0;max-width:420px}
.auth-stats{display:flex;gap:26px;margin-top:18px}
.auth-stats div{display:grid;gap:4px}
.auth-stats strong{font-size:22px;color:var(--brand)}
.auth-stats span{font-size:11px;color:var(--fg-muted)}
.auth-card-wrap{flex:1;display:flex;align-items:center;justify-content:center;padding:24px}
.auth-card{width:420px;max-width:92vw;background:var(--panel);border:1px solid var(--border);border-radius:16px;padding:26px 26px 20px;box-shadow:0 8px 30px #26345a12}
.auth-card h2{font-size:18px;margin:0 0 16px}
.auth-modes{display:flex;gap:6px;margin-bottom:18px}
.auth-modes button{border:1px solid var(--border);border-radius:9px;background:var(--panel);color:var(--fg-muted);padding:8px 13px;font-size:12px;cursor:pointer}
.auth-modes button.on{background:var(--brand-soft);border-color:var(--brand-soft);color:var(--brand);font-weight:650}
.auth-field{display:grid;gap:6px;margin-bottom:14px}
.auth-field>span{font-size:12px;color:var(--fg-muted)}
.auth-error{color:var(--danger);font-size:11px;margin:0}
.captcha-row,.email-code-row{display:flex;align-items:center;gap:9px;margin-bottom:14px}
.captcha-row img{width:132px;height:44px;border-radius:8px;cursor:pointer;background:#0f172a;flex:none}
.captcha-retry{width:132px;height:44px;border-radius:8px;background:var(--panel-2);border:1px dashed var(--border-2);color:var(--fg-muted);font-size:11px;line-height:1.4;cursor:pointer;flex:none}
.captcha-row .el-input,.email-code-row .el-input{flex:1}
.auth-remember{margin-bottom:14px;display:block}
.auth-top-error{margin-bottom:12px}
.auth-submit{width:100%;margin-top:4px}
.auth-foot{margin:14px 0 0;font-size:12px;color:var(--fg-muted);text-align:center}
.auth-foot a{color:var(--brand);text-decoration:none}
@media (max-width:900px){
  .auth-brand{display:none}
  .auth-card-wrap{flex:none;width:100%}
  .auth-submit,.auth-modes button{min-height:44px}
}
</style>
