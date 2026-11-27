<template>
  <div class="secret-field" :class="{ 'is-revealed': revealed, 'is-empty': !hasValue }">
    <div class="secret-box">
      <el-input
        v-if="mode === 'single' || !revealed"
        v-model="inputValue"
        class="secret-input"
        :type="revealed ? 'text' : 'password'"
        :placeholder="placeholder"
        :disabled="disabled || loading"
        :readonly="mode === 'proxy'"
        autocomplete="new-password"
        @input="onDraftInput"
      />
      <div v-else class="secret-proxy-lines">
        <div v-for="(line, i) in proxyLines" :key="i" class="secret-proxy-line">
          <code class="secret-mono">{{ line }}</code>
          <el-button link type="primary" size="small" @click="copyLine(line)">复制</el-button>
        </div>
        <p v-if="!proxyLines.length" class="secret-hint">未配置代理</p>
      </div>
      <button
        type="button"
        class="secret-eye"
        :disabled="!canReveal"
        :aria-label="eyeLabel"
        :aria-pressed="revealed ? 'true' : 'false'"
        :title="eyeTitle"
        @click="toggleEye"
      >
        <!-- 眼睛 / 眼睛-划线：自实现（不直接用 el-input show-password，因为要先懒加载明文再切 type） -->
        <svg v-if="!revealed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true">
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3.2" />
        </svg>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true">
          <path d="M3 3l18 18" />
          <path d="M10.6 5.1A11 11 0 0 1 22 12s-1.4 2.7-4 4.6M6.2 6.4C3.6 8.2 2 12 2 12s3.6 7 10 7a11 11 0 0 0 4.5-1" />
          <path d="M9.9 9.9a3.2 3.2 0 0 0 4.2 4.2" />
        </svg>
      </button>
    </div>
    <div class="secret-actions">
      <el-button v-if="canSubmit" size="small" type="primary" :loading="saving" @click="submit">保存</el-button>
      <el-button v-if="canSubmit" size="small" :disabled="saving || clearing" @click="resetEdit">取消</el-button>
      <el-button v-if="hasValue" size="small" text type="danger" :loading="clearing" :disabled="saving || clearing" @click="clearValue">清除</el-button>
      <slot name="extra" />
      <span class="secret-hint">{{ hintText }}</span>
    </div>
  </div>
</template>

<script setup>
// FX 批（docs/SECRET-REVEAL.md §4/§6）：后台密钥查看统一为「标准密码框 + 眼睛图标」原地切换。
// - 明文懒加载：页面加载不取明文，第一次点眼睛才调一次 GET /api/admin/settings/value?key=，
//   再点眼睛只切 type=password，不重复请求（eyeAction 纯函数）；
// - 30 秒无操作自动回密文（只切回 type=password，不关页面、不清缓存）；
// - 编辑直接改框内容：懒加载到的真值只作比较基线（loadedOriginal），未改动不提交、留空保持原值；
// - 清除：二次确认后提交 null，来源回落 env/默认；
// - 代理多条：眼睛点开逐行显示、每行可复制，列表增删仍走父组件的列表编辑器。
// 复用于四处布局分支：isPlainGroup / grid / foldBody / 代理行（替换旧的 revealSecret + 弹窗）。
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { redirectToLogin } from '../utils/session.js';
import { copyText } from '../utils/clipboard.js';
import { PROXY_MASK, SECRET_AUTO_HIDE_MS, eyeAction, parseProxyLines, submitDecision } from '../utils/secretField.js';

const props = defineProps({
  // 父组件下发的字段元数据：{ key, label, help, hasValue, source }
  field: { type: Object, required: true },
  // 受控草稿（父组件可绑定 settingValues[key]；组件内部以 draft 为准，输入时同步回去）
  modelValue: { type: String, default: '' },
  // single = 单值编辑；proxy = 多条代理（只读展示 + 逐行复制，管理走父组件列表编辑器）
  mode: { type: String, default: 'single' },
  // 设置修订号：父组件保存别的设置后 +1，用来丢弃过期的明文缓存
  version: { type: [Number, String], default: 0 },
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue', 'saved']);

const revealed = ref(false);
const loading = ref(false);
const saving = ref(false);
const clearing = ref(false);
// 懒加载缓存：null = 还没取过（第一次点眼睛要请求）；取过之后切来切去不再请求
const loadedValue = ref(null);
// 懒加载到的真值 = 防误覆盖的比较基线（值未变不提交）
const loadedOriginal = ref(null);
const draft = ref(String(props.modelValue ?? ''));
let hideTimer = null;

const hasValue = computed(() => Boolean(props.field?.hasValue));
const label = computed(() => props.field?.label || props.field?.key || '密钥');
const placeholder = computed(() => (hasValue.value ? '已设置，点右侧眼睛查看' : '尚未设置'));
const proxyLines = computed(() => parseProxyLines(loadedValue.value));
// 代理多条在密文态只显示固定 12 位掩码（不随真实长度变化）；单值态显示草稿/明文
const inputValue = computed({
  get() {
    if (props.mode === 'proxy') {
      if (!hasValue.value) return ''; // 未配置：空框 + 「尚未设置」，眼睛置灰
      return revealed.value ? String(loadedValue.value ?? '') : PROXY_MASK;
    }
    return draft.value;
  },
  set(value) {
    if (props.mode !== 'single') return;
    draft.value = String(value ?? '');
  },
});
const canReveal = computed(() => hasValue.value && !props.disabled && !loading.value);
// 有草稿才出现「保存/取消」：用户没点过眼睛、没动过 → 根本没有提交入口（决策 5）
const canSubmit = computed(
  () => props.mode === 'single' && !props.disabled && String(draft.value ?? '').trim() !== '',
);
const eyeLabel = computed(() => (revealed.value ? '隐藏明文' : '显示明文'));
const eyeTitle = computed(() => {
  if (!hasValue.value) return '尚未设置，无法查看';
  return revealed.value ? '隐藏明文（30 秒无操作自动隐藏）' : '显示明文（只取一次，不再重复请求）';
});
const hintText = computed(() => {
  if (revealed.value) return '明文 30 秒无操作自动隐藏';
  if (props.mode === 'proxy') return hasValue.value ? '点眼睛逐行查看（每行可复制）；代理列表用上方「编辑」管理' : '尚未设置';
  return hasValue.value ? '点眼睛查看明文；输入新值后保存，留空保持原值' : '尚未设置';
});

function api(path, options = {}) {
  return fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  }).then(async (r) => {
    const text = await r.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      // 非 JSON 响应按空对象处理，错误信息走下面的兜底
    }
    if (r.status === 401) {
      redirectToLogin();
      throw new Error(data.error || '登录已过期');
    }
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
  });
}
function notifyError(e) {
  ElMessage.error(e?.message || String(e));
}

function clearHideTimer() {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}
function hidePlain() {
  revealed.value = false;
  clearHideTimer();
}
function scheduleHide() {
  clearHideTimer();
  hideTimer = setTimeout(hidePlain, SECRET_AUTO_HIDE_MS);
}
// 用户在明文态还有操作（输入/点击）就重新计时；30 秒没动静自动回密文
function onActivity() {
  if (revealed.value) scheduleHide();
}
function onDraftInput(value) {
  emit('update:modelValue', value);
  onActivity();
}
onBeforeUnmount(clearHideTimer);

// 第一次点眼睛才取明文（一次）；失败不切明文态
async function loadPlaintext() {
  loading.value = true;
  try {
    const d = await api(`/api/admin/settings/value?key=${encodeURIComponent(props.field.key)}`);
    const value = String(d?.value ?? '');
    loadedValue.value = value;
    loadedOriginal.value = value;
    if (props.mode === 'single') draft.value = value; // 懒加载成功才把明文放进输入框
  } catch (e) {
    notifyError(e);
    return false;
  } finally {
    loading.value = false;
  }
  return true;
}

async function toggleEye() {
  if (!hasValue.value || props.disabled || loading.value) return;
  // 用户先输入了新值、还没取过旧明文：眼睛只切换这段草稿的明文/密文，
  // 不去拉旧值（否则懒加载赋值会把用户刚输入的内容覆盖掉）。
  if (props.mode === 'single' && loadedValue.value == null && String(draft.value ?? '').trim() !== '') {
    if (revealed.value) hidePlain();
    else {
      revealed.value = true;
      scheduleHide();
    }
    return;
  }
  const action = eyeAction({ hasValue: hasValue.value, loaded: loadedValue.value, revealed: revealed.value });
  if (action === 'ignore') return; // 未配置：按钮置灰 + 不发任何请求
  if (action === 'hide') {
    hidePlain();
    return;
  }
  if (action === 'fetch') {
    const ok = await loadPlaintext();
    if (!ok) return;
  } else if (props.mode === 'single' && !String(draft.value ?? '').trim()) {
    // 命中缓存：直接复用明文，不再调接口（用户已输入的新值优先，不覆盖）
    draft.value = loadedValue.value ?? '';
  }
  revealed.value = true; // type=password → type=text
  scheduleHide();
}

function resetEdit() {
  draft.value = '';
  loadedValue.value = null;
  loadedOriginal.value = null;
  emit('update:modelValue', '');
  hidePlain();
}

async function submit() {
  const decision = submitDecision({ draft: draft.value, baseline: loadedOriginal.value });
  if (!decision.submit) {
    if (decision.reason === 'unchanged') ElMessage.info('没有变化，未提交');
    return;
  }
  saving.value = true;
  try {
    const d = await api('/api/admin/settings', {
      method: 'POST',
      body: JSON.stringify({ values: { [props.field.key]: decision.value } }),
    });
    ElMessage.success(`已保存「${label.value}」（约 15 秒内生效）`);
    resetEdit();
    emit('saved', d);
  } catch (e) {
    notifyError(e);
  } finally {
    saving.value = false;
  }
}

async function clearValue() {
  try {
    await ElMessageBox.confirm(
      `清除「${label.value}」后，该值将回落到环境变量或默认值，确定继续？`,
      '清除密钥',
      { type: 'warning', confirmButtonText: '确认清除', cancelButtonText: '取消' },
    );
  } catch {
    return; // 取消 / 关闭
  }
  clearing.value = true;
  try {
    const d = await api('/api/admin/settings', {
      method: 'POST',
      body: JSON.stringify({ values: { [props.field.key]: null } }),
    });
    ElMessage.success(`已清除「${label.value}」`);
    resetEdit();
    emit('saved', d);
  } catch (e) {
    notifyError(e);
  } finally {
    clearing.value = false;
  }
}

async function copyLine(line) {
  const ok = await copyText(line);
  ElMessage[ok ? 'success' : 'error'](ok ? '已复制' : '复制失败，请手动选中复制');
}

// 父组件保存别的设置 / 代理列表编辑器回写后（revision 变化）：丢弃明文缓存并回密文；
// 未改动的草稿一起清掉，已输入的新值保留（避免一次无关保存吞掉正在编辑的内容）。
watch(
  () => props.version,
  () => {
    const unchanged = !loadedOriginal.value || String(draft.value ?? '').trim() === String(loadedOriginal.value).trim();
    if (unchanged) draft.value = '';
    loadedValue.value = null;
    loadedOriginal.value = null;
    hidePlain();
  },
);
</script>

<style scoped>
.secret-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.secret-box {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.secret-input {
  flex: 1;
  min-width: 0;
}
/* 眼睛在框内：给输入框右侧留出 44px 触摸目标（≥44px 等效，验收 §7.7） */
.secret-box :deep(.el-input__wrapper) {
  padding-right: 46px;
}
.secret-eye {
  position: absolute;
  top: 50%;
  right: 2px;
  transform: translateY(-50%);
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
}
.secret-eye:hover:not(:disabled) {
  background: var(--brand-soft);
  color: var(--brand);
}
.secret-eye:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.secret-eye svg {
  width: 22px;
  height: 22px;
}
/* 代理多条：明文逐行展示（等宽、可单独复制） */
.secret-proxy-lines {
  flex: 1;
  min-width: 0;
  padding: 10px 52px 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--panel-2);
}
.secret-proxy-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}
.secret-mono {
  font-family: ui-monospace, Consolas, 'Courier New', monospace;
  font-size: 12.5px;
  color: var(--fg);
  overflow-wrap: anywhere;
}
.secret-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.secret-hint {
  font-size: 12px;
  color: var(--fg-muted);
}
/* 移动端（≤560px）：眼睛保留在框内，次要动作换行，触摸目标 ≥44px */
@media (max-width: 560px) {
  .secret-actions {
    flex-wrap: wrap;
  }
  .secret-actions :deep(.el-button) {
    min-height: 44px;
  }
  .secret-hint {
    flex-basis: 100%;
  }
}
</style>
