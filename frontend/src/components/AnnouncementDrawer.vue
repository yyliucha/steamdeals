<template>
  <el-drawer
    v-model="open"
    :title="form.id ? '编辑通知' : '新建通知'"
    size="min(660px, 100vw)"
    :before-close="onClose"
    class="an-drawer"
  >
    <div class="an-body">
      <el-form :model="form" label-position="top" class="an-form" @submit.prevent="submit">
        <el-form-item label="标题"><el-input v-model="form.title" maxlength="120" show-word-limit placeholder="例如：价格同步维护通知" /></el-form-item>
        <el-form-item label="正文"><el-input v-model="form.body" type="textarea" :rows="4" maxlength="3000" show-word-limit placeholder="填写用户需要知道的内容" /></el-form-item>
        <div class="an-row">
          <el-form-item label="级别"><el-select v-model="form.level"><el-option label="普通通知" value="info" /><el-option label="提醒" value="warning" /><el-option label="重要" value="critical" /></el-select></el-form-item>
          <el-form-item label="状态"><el-switch v-model="form.active" active-text="启用" inactive-text="停用" /></el-form-item>
        </div>
        <div class="an-row">
          <el-form-item label="开始时间"><el-date-picker v-model="form.startsAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ssZ" placeholder="立即生效" /></el-form-item>
          <el-form-item label="结束时间"><el-date-picker v-model="form.endsAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ssZ" placeholder="永不过期" /></el-form-item>
        </div>
        <div class="an-section"><h4>前台预览</h4><p class="muted">用户看到的公告卡片样式</p></div>
        <div class="an-preview">
          <span class="an-preview-badge" :class="form.level">{{ levelLabel(form.level) }}</span>
          <div class="an-preview-copy"><h5>{{ form.title || '（标题）' }}</h5><p>{{ form.body || '（正文）' }}</p><small>{{ form.startsAt ? fmtDateTime(form.startsAt) : '立即生效' }} — {{ form.endsAt ? fmtDateTime(form.endsAt) : '长期有效' }}</small></div>
        </div>
        <div class="an-actions"><el-button @click="onClose(null)">取消</el-button><el-button type="primary" :loading="saving" @click="submit">{{ form.id ? '保存修改' : '发布通知' }}</el-button></div>
      </el-form>
    </div>
  </el-drawer>
</template>

<script setup>
// AT 批（docs/ADMIN-CONSOLE-IA.md §3/§7）：新建/编辑站点通知改右侧抽屉（不跳页），带前台预览。
// 编辑与新建共用同一抽屉：父组件传 edit（公告行）；?section=announcements&drawer=new&id=… 可直达。
// 未保存守卫：脏判定沿用旧口径（与进入编辑/重置后的快照做 JSON 比较）；
// save 抛错版——发布失败留在本页；点遮罩/✕/Esc 先过 requestLeave()。
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { fmtDateTime } from '../utils/siteTime.js';
// BM-3（docs/SESSION-MANAGEMENT.md §8.4.3）：401 统一软跳登录页
import { redirectToLogin } from '../utils/session.js';
import { registerUnsavedSource, requestLeave } from '../composables/useUnsavedGuard.js';

const props = defineProps({
  visible: { type: Boolean, default: false },
  edit: { type: Object, default: null },
});
const emit = defineEmits(['update:visible', 'saved', 'closed']);
const open = computed({ get: () => props.visible, set: (v) => emit('update:visible', v) });

const form = reactive({ id: null, title: '', body: '', level: 'info', active: true, startsAt: null, endsAt: null });
const saving = ref(false);
// BG 批（docs/UNSAVED-GUARD.md §11）：初始快照 = 初始表单——抽屉未打开时不算脏；
// fillFrom()（抽屉打开/编辑）仍会重置快照。
let snapshot = JSON.stringify(form);

function fillFrom(a) {
  Object.assign(form, {
    id: a?.id ?? null,
    title: a?.title ?? '',
    body: a?.body ?? '',
    level: a?.level ?? 'info',
    active: Boolean(a?.active),
    startsAt: a?.starts_at ?? null,
    endsAt: a?.ends_at ?? null,
  });
  snapshot = JSON.stringify(form);
}
function resetForm() {
  fillFrom(null);
}
watch(
  () => props.visible,
  (v) => {
    if (v) fillFrom(props.edit);
  },
  { immediate: true },
);
watch(
  () => props.edit,
  (a) => {
    if (props.visible && a) fillFrom(a);
  },
);

function isDirty() {
  return JSON.stringify(form) !== snapshot;
}
const unregister = registerUnsavedSource({ id: 'announcement', label: '站点通知', isDirty, save: submit, discard: resetForm });
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

function levelLabel(level) {
  return ({ critical: '重要', warning: '提醒', info: '通知' })[level] || '通知';
}

async function submit() {
  if (!form.title.trim() || !form.body.trim()) throw new Error('标题和正文都要填写');
  const payload = {
    title: form.title.trim(),
    body: form.body.trim(),
    level: form.level,
    active: form.active,
    startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
    endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
  };
  saving.value = true;
  try {
    await api(form.id ? `/api/admin/announcements/${form.id}` : '/api/admin/announcements', { method: form.id ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
    ElMessage.success(form.id ? '通知已更新' : '通知已发布');
    emit('saved');
    resetForm();
    open.value = false;
  } catch (e) {
    ElMessage.error(e?.message || String(e));
    throw e;
  } finally {
    saving.value = false;
  }
}

async function onClose() {
  if (isDirty()) {
    if (!(await requestLeave())) return;
    if (isDirty()) return;
  }
  resetForm();
  open.value = false;
  emit('closed');
}
</script>

<style scoped>
.an-body{padding:0 4px}
.an-row{display:flex;gap:16px;align-items:flex-start}
.an-row .el-form-item{flex:1}
.an-section{border-top:1px solid var(--border);margin-top:14px;padding-top:12px}
.an-section h4{margin:0 0 4px;font-size:13px}
.an-section p{margin:0;font-size:12px;color:var(--fg-muted)}
.an-preview{border:1px solid var(--border);border-radius:12px;padding:12px 14px;display:flex;gap:10px;align-items:flex-start;background:var(--bg)}
.an-preview-badge{flex:none;font-size:11px;padding:2px 8px;border-radius:6px;background:var(--brand-soft);color:var(--brand)}
.an-preview-badge.warning{background:#fdf3d8;color:#b7791f}
.an-preview-badge.critical{background:#fde8e8;color:#c0392b}
.an-preview-copy{min-width:0}
.an-preview-copy h5{margin:0 0 4px;font-size:13px}
.an-preview-copy p{margin:0 0 4px;font-size:12px;color:var(--fg-muted);overflow-wrap:anywhere}
.an-preview-copy small{font-size:11px;color:var(--fg-muted)}
.an-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}
:deep(.el-drawer__body){padding:16px 20px}
@media(max-width:768px){.an-row{flex-direction:column;gap:0}.an-actions{position:sticky;bottom:0;background:var(--panel);padding-top:10px}}
</style>
