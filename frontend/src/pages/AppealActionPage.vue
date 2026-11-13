<script setup>
// 申诉邮件确认页（docs/APPEAL-SYSTEM.md §10.4，BQ 批）：
// 读 location.hash 里的 t=<token> → POST preview 渲染摘要（零副作用）→
// 两个按钮：信任并解封（主）/ 拒绝并保持封禁（可填理由，预填默认文案）。
// 结果四态：已处理（信任）/ 已处理（拒绝）/ 链接已过期 / 链接无效；成功后提示会邮件通知申请人。
// 全部通过 POST /api/appeal/action 执行——页面本身与 preview 都不产生任何状态变化（防邮件预取）。
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';

const token = ref('');
const phase = ref('loading'); // loading | summary | invalid | done-trust | done-reject | already
const info = ref(null);
const note = ref('未通过审核，如仍有疑问请回复本邮件');
const busy = ref(false);

const statusText = computed(() => {
  const s = info.value?.status;
  if (s === 'resolved') return '已处理（信任并解封）';
  if (s === 'rejected') return '已处理（拒绝）';
  return '待处理';
});

async function act(op) {
  busy.value = true;
  try {
    const r = await fetch('/api/appeal/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: token.value, op, note: op === 'reject' ? note.value.trim() : undefined }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.status === 404) {
      phase.value = 'invalid';
      return;
    }
    if (r.status === 409) {
      info.value = { ...(info.value || {}), ...d };
      phase.value = 'already';
      return;
    }
    if (r.status === 429) return ElMessage.warning(d.error || '操作过于频繁，请稍后再试。');
    if (!r.ok) return ElMessage.error(d.error || `处理失败（HTTP ${r.status}）`);
    phase.value = op === 'trust' ? 'done-trust' : 'done-reject';
  } catch {
    ElMessage.error('网络异常，请稍后重试。');
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  const m = /[#&]t=([A-Za-z0-9_-]{20,64})/.exec(window.location.hash || '');
  if (!m) {
    phase.value = 'invalid';
    return;
  }
  token.value = m[1];
  try {
    const r = await fetch('/api/appeal/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: token.value, op: 'preview' }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.status === 404) {
      phase.value = 'invalid';
      return;
    }
    if (!r.ok) {
      phase.value = 'invalid';
      return;
    }
    info.value = d;
    phase.value = 'summary';
  } catch {
    phase.value = 'invalid';
  }
});
</script>

<template>
  <main class="act-page"><section class="act-card">
    <a href="/" class="back-link">← 返回首页</a>
    <p class="eyebrow">APPEAL ACTION</p>
    <h1 v-if="phase === 'loading'">正在打开链接…</h1>
    <h1 v-else-if="phase === 'invalid'">链接无效或已过期</h1>
    <h1 v-else-if="phase === 'done-trust'">已处理（信任）</h1>
    <h1 v-else-if="phase === 'done-reject'">已处理（拒绝）</h1>
    <h1 v-else-if="phase === 'already'">该申诉已处理</h1>
    <h1 v-else>申诉快捷处理</h1>

    <template v-if="phase === 'loading'"><p class="intro">正在校验链接…</p></template>

    <template v-else-if="phase === 'invalid'">
      <p class="intro">这条处理链接不存在、已过期（14 天）或已被处理。请登录后台「访问与安全 → 申诉管理」处理。</p>
    </template>

    <template v-else-if="phase === 'done-trust' || phase === 'done-reject'">
      <el-alert type="success" :closable="false" :title="phase === 'done-trust' ? '已信任并解封（IP 与设备）' : '已拒绝并保持封禁'" description="处理结果会邮件通知申请人；该链接已失效。" />
    </template>

    <template v-else-if="phase === 'already'">
      <el-alert type="info" :closable="false" :title="`该申诉已处理（${statusText}）`" :description="`处理时间：${info?.handledAt ? new Date(info.handledAt).toLocaleString() : '—'}（${info?.handledVia === 'email' ? '邮件' : '后台'}）`" />
    </template>

    <template v-else-if="phase === 'summary'">
      <el-alert v-if="info?.status !== 'pending'" type="info" :closable="false" :title="`该申诉已处理（${statusText}）`" :description="`处理时间：${info?.handledAt ? new Date(info.handledAt).toLocaleString() : '—'}（${info?.handledVia === 'email' ? '邮件' : '后台'}）`" />
      <div class="act-meta"><dl>
        <div><dt>申诉编号</dt><dd><code>{{ info?.code }}</code></dd></div>
        <div><dt>IP</dt><dd class="mono">{{ info?.ipMasked || '—' }}</dd></div>
        <div><dt>封禁原因</dt><dd>{{ info?.reason || '未记录' }}</dd></div>
        <div><dt>封禁到期</dt><dd>{{ info?.banUntil ? new Date(info.banUntil).toLocaleString() : '—' }}</dd></div>
        <div><dt>联系方式</dt><dd>{{ info?.contactMasked || '—' }}</dd></div>
        <div><dt>提交时间</dt><dd>{{ info?.createdAt ? new Date(info.createdAt).toLocaleString() : '—' }}</dd></div>
        <div><dt>申诉说明</dt><dd class="act-message">{{ info?.message || '（空）' }}</dd></div>
      </dl></div>

      <template v-if="info?.canAct">
        <p class="intro">点按钮才执行（打开本页不会改变任何状态）。信任会同时解封 IP 与设备；要分别解封请回后台。</p>
        <div class="act-actions"><el-button type="success" size="large" :loading="busy" @click="act('trust')">信任并解封</el-button><el-button type="danger" size="large" plain :loading="busy" @click="act('reject')">拒绝并保持封禁</el-button></div>
        <el-input v-model="note" type="textarea" :rows="3" maxlength="500" show-word-limit placeholder="拒绝理由（会邮件通知申请人）" />
      </template>
    </template>
  </section></main>
</template>

<style scoped>
.act-page{min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(ellipse at 50% -15%,var(--bg-glow),transparent 48%),var(--bg);color:var(--fg)}.act-card{width:min(620px,100%);padding:28px;border:1px solid var(--border);border-radius:18px;background:var(--panel);box-shadow:0 16px 44px #26345a12}.back-link{color:var(--brand);text-decoration:none;font-size:12px}.eyebrow{margin:22px 0 6px;color:var(--brand);font-size:10px;font-weight:800;letter-spacing:.2em}.act-card h1{margin:0 0 10px;font-size:25px;letter-spacing:-.03em}.intro{margin:6px 0 16px;color:var(--fg-muted);font-size:13px}.act-meta dl{margin:16px 0;border:1px solid var(--border);border-radius:12px;overflow:hidden}.act-meta dl div{display:flex;gap:10px;padding:9px 13px;border-bottom:1px solid var(--border);font-size:13px}.act-meta dl div:last-child{border-bottom:0}.act-meta dt{min-width:76px;color:var(--fg-muted);flex:none}.act-meta dd{margin:0;overflow-wrap:anywhere}.act-message{white-space:pre-wrap}.act-actions{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0}.act-actions .el-button{min-height:44px}@media(max-width:600px){.act-page{padding:14px}.act-card{padding:22px 17px}.act-card h1{font-size:22px}.act-actions{flex-direction:column}.act-actions .el-button{width:100%}}
</style>
