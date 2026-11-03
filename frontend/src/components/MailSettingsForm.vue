<template>
  <div class="mail-settings-form">
    <div v-if="loading" class="muted">正在加载邮件配置…</div>
    <div v-else-if="error" class="muted">配置加载失败：{{ error }}</div>
    <template v-else>
      <div class="mail-settings-grid">
        <div v-for="field in mailFields" :key="field.key" class="mail-field">
          <div class="mail-field-head"><label :for="mailFieldId(field.key)">{{ field.label }}</label><el-tag size="small" effect="plain">{{ sourceLabel(field.key) }}</el-tag></div>
          <div v-if="field.type === 'bool'" class="mail-control">
            <el-switch :id="mailFieldId(field.key)" v-model="values[field.key]" @change="dirty = true" />
            <span>{{ values[field.key] ? '启用' : '关闭' }}</span>
          </div>
          <div v-else-if="field.type === 'secret'" class="mail-secret">
            <el-input :id="mailFieldId(field.key)" v-model="values[field.key]" type="password" show-password autocomplete="new-password" :placeholder="hasSecret(field.key) ? '已设置，留空保持原值' : '尚未设置'" @input="dirty = true" />
            <el-button v-if="hasSecret(field.key)" text @click="reveal(field.key)">查看</el-button>
            <el-checkbox v-if="hasSecret(field.key)" v-model="clearFlags[field.key]" @change="dirty = true">清除</el-checkbox>
          </div>
          <el-input v-else :id="mailFieldId(field.key)" v-model="values[field.key]" :type="field.type === 'int' ? 'number' : 'text'" :min="field.min" :max="field.max" @input="dirty = true" />
          <p v-if="field.help" class="setting-help">{{ field.help }}</p>
        </div>
      </div>
      <div class="mail-actions">
        <el-button :disabled="!dirty" :loading="saving" type="primary" @click="save">保存邮件配置</el-button>
        <span v-if="dirty" class="dirty-dot">未保存的修改</span>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { isMailSettingKey } from '../utils/settings.js';

const emit = defineEmits(['saved']);

const loading = ref(true);
const error = ref('');
const saving = ref(false);
const dirty = ref(false);
const schema = ref(null);
const values = ref({});
const clearFlags = ref({});

const mailFields = computed(() => (schema.value?.fields || []).filter((f) => isMailSettingKey(f.key)));

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* 忽略 */ }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function mailFieldId(key) { return 'mail-' + key.replace(/[^a-zA-Z0-9]/g, '-'); }
function hasSecret(key) { return Boolean(schema.value?.secrets?.[key]?.hasValue); }
function sourceLabel(key) { return schema.value?.sources?.[key] ? '后台设置' : '环境变量/默认'; }

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const d = await api('/api/admin/settings');
    schema.value = d;
    const next = {};
    for (const field of d.fields || []) {
      if (!isMailSettingKey(field.key)) continue;
      next[field.key] = field.type === 'secret' ? '' : d.values?.[field.key] ?? field.default ?? (field.type === 'bool' ? false : '');
    }
    values.value = next;
    clearFlags.value = {};
    dirty.value = false;
  } catch (e) {
    error.value = e?.message || String(e);
  } finally {
    loading.value = false;
  }
}

async function reveal(key) {
  try {
    const d = await api(`/api/admin/settings/value?key=${encodeURIComponent(key)}`);
    values.value[key] = d.value ?? '';
    ElMessage.info('密钥已载入输入框；保存会保留该值');
  } catch (e) {
    ElMessage.error(e?.message || String(e));
  }
}

async function save() {
  const patch = {};
  for (const field of mailFields.value) {
    const v = values.value[field.key];
    if (field.type === 'secret') {
      if (clearFlags.value[field.key]) patch[field.key] = null;
      else if (String(v ?? '').trim() !== '') patch[field.key] = v;
    } else if (field.type === 'int') {
      patch[field.key] = v === '' || v == null ? null : Number(v);
    } else if (field.type === 'bool') {
      patch[field.key] = Boolean(v);
    } else {
      patch[field.key] = v;
    }
  }
  saving.value = true;
  try {
    const d = await api('/api/admin/settings', { method: 'POST', body: JSON.stringify({ values: patch }) });
    schema.value = d;
    for (const field of mailFields.value) {
      if (field.type === 'secret') values.value[field.key] = '';
    }
    dirty.value = false;
    ElMessage.success(`已保存 ${d.keys?.length || 0} 项邮件配置`);
    emit('saved');
  } catch (e) {
    ElMessage.error(e?.message || String(e));
  } finally {
    saving.value = false;
  }
}

onMounted(load);
defineExpose({ reload: load });
</script>

<style scoped>
.mail-settings-grid{display:grid;grid-template-columns:repeat(2,minmax(220px,1fr));gap:12px 16px}
.mail-field{min-width:0}
.mail-field-head{display:flex;align-items:center;gap:8px;margin-bottom:5px}
.mail-field-head label{font-size:12px;color:var(--fg-muted)}
.mail-control{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--fg-muted)}
.mail-secret{display:flex;align-items:center;gap:6px}
.mail-secret .el-input{flex:1}
.mail-actions{display:flex;align-items:center;gap:10px;margin-top:14px}
.dirty-dot{color:var(--warn);font-size:12px}
.setting-help{margin:4px 0 0;color:var(--fg-subtle);font-size:11px}
@media(max-width:640px){.mail-settings-grid{grid-template-columns:1fr}}
</style>
