<template>
  <el-drawer
    v-model="open"
    :title="'新建用户'"
    size="min(560px, 100vw)"
    :with-header="true"
    :before-close="onClose"
    class="uc-drawer"
  >
    <div class="uc-body">
      <template v-if="done">
        <div class="uc-done">
          <h4>账号已创建</h4>
          <template v-if="tempPassword">
            <p class="muted">请立即复制并交给用户；关闭后无法再次查看，用户首次登录必须修改密码。</p>
            <el-input :model-value="tempPassword" readonly />
            <div class="uc-actions"><el-button type="primary" @click="copyTempPassword">复制临时密码</el-button><el-button @click="closeNow">关闭</el-button></div>
          </template>
          <template v-else>
            <p class="muted">该用户将使用你设置的初始密码登录（首次登录必须修改密码）。</p>
            <div class="uc-actions"><el-button type="primary" @click="closeNow">关闭</el-button></div>
          </template>
        </div>
      </template>
      <el-form v-else :model="form" label-position="top" class="uc-form" @submit.prevent="submit">
        <div class="uc-section"><h4>账号信息</h4></div>
        <el-form-item label="用户名"><el-input v-model="form.username" placeholder="用户名" autocomplete="username" maxlength="64" @keyup.enter.prevent="submit" /></el-form-item>
        <el-form-item label="登录邮箱（可选）"><el-input v-model="form.email" placeholder="登录邮箱（可选）" @keyup.enter.prevent="submit" /></el-form-item>
        <el-form-item label="角色"><el-select v-model="form.role" style="width:100%"><el-option label="普通用户" value="user" /><el-option label="管理员" value="admin" /></el-select></el-form-item>
        <div class="uc-section"><h4>初始密码</h4><p class="muted">留空自动生成 16 位临时密码（只在创建后显示一次）；填了必须 ≥12 位。</p></div>
        <el-form-item label="初始密码">
          <div class="uc-pwd"><el-input v-model="form.password" type="password" show-password placeholder="留空自动生成临时密码" autocomplete="new-password" @keyup.enter.prevent="submit" /><el-button @click="randomPassword">随机生成</el-button></div>
        </el-form-item>
        <div class="uc-section"><h4>创建后通知</h4><p class="muted">创建成功后临时密码只在本抽屉内展示一次，可复制后交给用户。</p></div>
        <div class="uc-actions"><el-button @click="onClose(null)">取消</el-button><el-button type="primary" :loading="saving" @click="submit">创建账号</el-button></div>
      </el-form>
    </div>
  </el-drawer>
</template>

<script setup>
// AT 批（docs/ADMIN-CONSOLE-IA.md §3/§7）：新建用户改右侧抽屉（不跳页）。
// 表单从用户管理页内嵌卡搬进这里；成功后抽屉内一次性展示临时密码（可复制），关闭即回列表。
// 未保存守卫（docs/UNSAVED-GUARD.md §4.4）：脏判定沿用旧口径（任一字段非空即脏），
// save 抛错版——创建失败留在本页；点遮罩/✕/Esc 都先过 requestLeave()。
import { computed, onBeforeUnmount, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { copyText } from '../utils/clipboard.js';
// BM-3（docs/SESSION-MANAGEMENT.md §8.4.3）：401 统一软跳登录页
import { redirectToLogin } from '../utils/session.js';
import { registerUnsavedSource, requestLeave } from '../composables/useUnsavedGuard.js';

const props = defineProps({ visible: { type: Boolean, default: false } });
const emit = defineEmits(['update:visible', 'created']);
const open = computed({ get: () => props.visible, set: (v) => emit('update:visible', v) });

const form = ref({ username: '', password: '', email: '', role: 'user' });
const saving = ref(false);
const done = ref(false);
const tempPassword = ref('');

function isDirty() {
  return Boolean(form.value.username.trim() || form.value.password || form.value.email.trim() || form.value.role !== 'user');
}
function resetForm() {
  form.value = { username: '', password: '', email: '', role: 'user' };
  done.value = false;
  tempPassword.value = '';
}
const unregister = registerUnsavedSource({ id: 'new-user', label: '新建用户', isDirty, save: submit, discard: resetForm });
onBeforeUnmount(() => unregister());

function api(path, opts = {}) {
  return fetch(path, { credentials: 'same-origin', ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } }).then(async (r) => {
    const t = await r.text();
    let d = {};
    try { d = t ? JSON.parse(t) : {}; } catch {}
    if (r.status === 401) { redirectToLogin(); throw new Error(d.error || '登录已过期'); }
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    return d;
  });
}

function randomPassword() {
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  form.value.password = btoa(String.fromCharCode(...buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function submit() {
  if (!form.value.username.trim()) return ElMessage.warning('用户名必填');
  if (form.value.password && form.value.password.length < 12) return ElMessage.warning('密码至少 12 位（留空将自动生成临时密码）');
  saving.value = true;
  try {
    const d = await api('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({ username: form.value.username.trim(), password: form.value.password, role: form.value.role, email: form.value.email.trim() || undefined }),
    });
    form.value = { username: '', password: '', email: '', role: 'user' };
    tempPassword.value = d.tempPassword || '';
    done.value = true;
    ElMessage.success('账号已创建');
    emit('created');
  } catch (e) {
    ElMessage.error(e?.message || String(e));
    throw e;
  } finally {
    saving.value = false;
  }
}

async function copyTempPassword() {
  const ok = await copyText(tempPassword.value);
  ok ? ElMessage.success('已复制') : ElMessage.warning('复制失败，请手动选择');
}

function closeNow() {
  resetForm();
  open.value = false;
}

// 点遮罩 / ✕ / Esc：先过未保存守卫（脏表单要弹「保存并离开/放弃修改/留在本页」）
async function onClose() {
  if (!done.value && isDirty()) {
    if (!(await requestLeave())) return;
    if (isDirty()) return; // 留在本页：草稿还在，不关
    open.value = false;
    return;
  }
  resetForm();
  open.value = false;
}
</script>

<style scoped>
.uc-body{padding:0 4px}
.uc-section h4{margin:0 0 4px;font-size:13px}
.uc-section p{margin:0;font-size:12px;color:var(--fg-muted)}
.uc-section{border-top:1px solid var(--border);margin-top:14px;padding-top:12px}
.uc-section:first-child{border-top:0;margin-top:0;padding-top:0}
.uc-pwd{display:flex;gap:8px;width:100%}
.uc-pwd .el-input{flex:1}
.uc-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}
.uc-done h4{margin:0 0 8px;font-size:14px}
.uc-done .muted{margin:0 0 10px;font-size:12px}
:deep(.el-drawer__body){padding:16px 20px}
@media(max-width:768px){.uc-actions{position:sticky;bottom:0;background:var(--panel);padding-top:10px}}
</style>
