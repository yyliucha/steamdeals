<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useBanOnlyPage } from '../composables/useBanOnlyPage.js';

// 客户端复查（docs/BAN-AND-SECURITY-FIXES.md §3.4）：挂载 + 每 30 秒 + 切回标签页查一次，
// 解封后自动回首页——"仅封禁可见"的页面解封后不能继续显示。
useBanOnlyPage();

const router = useRouter();
// 站点信息由服务端注入 window.__APPEAL__（URL 不再带 reason/until/email，见
// docs/URL-PARAM-PRIVACY.md §4.2）。本地 dev 无注入时回退 fetch('/api/site') 只补邮箱。
const injected = window.__APPEAL__ || {};
const appealCode = String(injected.code || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 16);
const email = ref(String(injected.email || '').trim());

// O 批（docs/APPEAL-SYSTEM.md §4）：站内提交入库——邮箱必填 + 说明 10–2000 + 图形验证码；
// 去掉 mailto 流程（保留「复制申诉内容」兜底）。
const contact = ref('');
const explanation = ref('');
const captchaToken = ref('');
const captchaAnswer = ref('');
const captchaImage = ref('');
const submitting = ref(false);
const submitted = ref(false);
const submittedCode = ref('');

async function loadCaptcha() {
  captchaToken.value = '';
  captchaAnswer.value = '';
  captchaImage.value = '';
  try {
    const r = await fetch('/api/captcha', { headers: { accept: 'application/json' } });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    captchaToken.value = d.token || '';
    captchaImage.value = d.svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(d.svg)}` : '';
  } catch {
    captchaToken.value = '';
    captchaImage.value = '';
  }
}

const appealText = computed(() => [
  `申诉编号：${submittedCode.value || appealCode || '未知'}`,
  `联系邮箱：${contact.value.trim() || '未填写'}`,
  '',
  '申诉说明：',
  explanation.value.trim(),
].join('\n'));

// 旧链接兼容（docs/URL-PARAM-PRIVACY.md §4.4）：挂载后把地址栏清洗成只剩 ?code=，
// 忽略 reason/until/email 等旧参数，不留明文在 history；再补一次邮箱回退。
onMounted(async () => {
  const raw = new URLSearchParams(window.location.search).get('code') || '';
  // 与服务端同一口径：整串必须匹配白名单，非法按空处理（不反射）
  const code = /^[A-Za-z0-9-]{1,16}$/.test(raw) ? raw : '';
  router.replace({ path: '/appeal', query: code ? { code } : {} }).catch(() => {});
  if (!email.value) {
    try {
      const r = await fetch('/api/site', { headers: { accept: 'application/json' } });
      const data = await r.json();
      if (data.appealEmail) email.value = String(data.appealEmail).trim();
    } catch {
      /* 离线：保持现状 */
    }
  }
  await loadCaptcha();
});

async function submitAppeal() {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.value.trim())) {
    return ElMessage.warning('请填写有效的联系邮箱。');
  }
  const text = explanation.value.trim();
  if (text.length < 10) return ElMessage.warning('申诉说明至少 10 个字。');
  if (text.length > 2000) return ElMessage.warning('申诉说明最多 2000 字。');
  if (!captchaToken.value) return ElMessage.warning('验证码加载失败，点击图片重试。');
  if (!captchaAnswer.value.trim()) return ElMessage.warning('请填写验证码。');
  submitting.value = true;
  try {
    const r = await fetch('/api/appeal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contact: contact.value.trim(),
        message: text,
        captchaToken: captchaToken.value,
        captchaAnswer: captchaAnswer.value.trim(),
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.status === 429) return ElMessage.warning(d.error || '提交过于频繁，请 1 小时后再试。');
    if (!r.ok) {
      if (String(d.error || '').includes('验证码')) {
        ElMessage.error('验证码错误或已过期');
        await loadCaptcha();
        return;
      }
      return ElMessage.warning(d.error || `提交失败（HTTP ${r.status}）`);
    }
    submittedCode.value = d.code || '';
    submitted.value = true;
  } catch {
    ElMessage.error('网络异常，请稍后重试。');
  } finally {
    submitting.value = false;
  }
}

async function copyAppeal() {
  const text = appealText.value;
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success('申诉内容已复制，可粘贴到邮件中。');
  } catch {
    ElMessage.info('复制失败，请手动记录申诉编号与说明。');
  }
}
</script>

<template>
  <main class="appeal-page"><section class="appeal-card">
    <a href="/" class="back-link">← 返回首页</a>
    <p class="eyebrow">APPEAL</p><h1>申请解除访问限制</h1>
    <p class="intro">请说明当时的操作和网络情况，管理员会根据申诉编号核查访问记录。</p>
    <div class="appeal-meta"><span>申诉编号 <code>{{ appealCode || '未提供' }}</code></span></div>

    <template v-if="!submitted">
      <el-alert v-if="!email" type="warning" :closable="false" title="站点尚未配置申诉邮箱；申诉仍会入库，管理员可在后台处理。" />
      <el-form label-position="top" @submit.prevent="submitAppeal">
        <el-form-item label="联系邮箱（必填，结果会发送到此邮箱）"><el-input v-model="contact" type="email" autocomplete="email" placeholder="例如 user@example.com" /></el-form-item>
        <el-form-item label="申诉说明（10–2000 字）"><el-input v-model="explanation" type="textarea" :rows="6" maxlength="2000" show-word-limit placeholder="请说明你当时在进行什么操作、是否使用自动化脚本、是否与他人共用网络。" /></el-form-item>
        <el-form-item label="图形验证码（点击图片刷新）">
          <div class="captcha-row">
            <img v-if="captchaImage" :src="captchaImage" alt="验证码，点击刷新" title="点击刷新验证码" @click="loadCaptcha">
            <button v-else type="button" class="captcha-retry" @click="loadCaptcha">验证码加载失败<br>点击重试</button>
            <el-input v-model="captchaAnswer" placeholder="验证码" maxlength="6" autocomplete="off" />
          </div>
        </el-form-item>
        <div class="appeal-actions"><el-button type="primary" :loading="submitting" @click="submitAppeal">提交申诉</el-button><el-button plain @click="copyAppeal">复制申诉内容</el-button></div>
      </el-form>
    </template>

    <el-alert v-else class="submitted" type="success" :closable="false" :title="`已受理，申诉编号 ${submittedCode}`" description="处理结果会发送到你填写的邮箱；请勿重复提交。" />
  </section></main>
</template>

<style scoped>
.appeal-page{min-height:100vh;display:grid;place-items:center;padding:28px;background:radial-gradient(ellipse at 50% -15%,var(--bg-glow),transparent 48%),var(--bg);color:var(--fg)}.appeal-card{width:min(690px,100%);padding:30px;border:1px solid var(--border);border-radius:18px;background:var(--panel);box-shadow:0 16px 44px #26345a12}.back-link{color:var(--brand);text-decoration:none;font-size:12px}.eyebrow{margin:26px 0 6px;color:var(--brand);font-size:10px;font-weight:800;letter-spacing:.2em}.appeal-card h1{margin:0;font-size:27px;letter-spacing:-.04em}.intro{margin:8px 0 18px;color:var(--fg-muted);font-size:13px}.appeal-meta{display:grid;gap:9px;padding:13px 15px;margin-bottom:20px;border:1px solid var(--border);border-radius:11px;background:var(--panel-2);color:var(--fg-muted);font-size:12px}.appeal-meta code{margin-left:6px}.appeal-card :deep(.el-form-item){margin-bottom:14px}.appeal-card :deep(.el-form-item__label){font-size:12px;font-weight:650}.appeal-actions{display:flex;gap:8px;flex-wrap:wrap}.submitted{margin-top:14px}.captcha-row{display:flex;align-items:center;gap:9px;width:100%}.captcha-row img{width:132px;height:44px;border-radius:8px;cursor:pointer;background:#0f172a;flex:none}.captcha-retry{width:132px;height:44px;border-radius:8px;background:var(--panel-2);border:1px dashed var(--border-2);color:var(--fg-muted);font-size:11px;line-height:1.4;cursor:pointer;flex:none}.captcha-row .el-input{flex:1}@media(max-width:600px){.appeal-page{padding:14px}.appeal-card{padding:22px 17px}.appeal-card h1{font-size:23px}.captcha-row{flex-wrap:wrap}.captcha-row .el-input{flex:1 1 100%}}
</style>
