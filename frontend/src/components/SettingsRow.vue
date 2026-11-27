<template>
  <!--
    FY-2（docs/SETTINGS-REDESIGN.md §3.2/§3.5）：设置页「一行一项」的行组件。
    左「label + 高级小标 + 帮注 + hover/focus 才出的来源徽标与恢复默认」，右「控件 + 保存状态」；
    ≤560px 改上下两段（label 在上、控件占满宽、状态在控件下），触摸目标 ≥44px。
    控件类型与旧卡片完全一致（bool/int/enum/string/text/secret），secret 复用 FX 的 SecretField。
  -->
  <div class="setting-item" :class="{ 'is-hit': hit }" :data-setting-key="field.key">
    <div class="item-label">
      <label class="item-name" :for="inputId">
        <span class="item-text">{{ field.label }}</span>
        <span v-if="isAdvanced" class="item-adv" title="高级项：低频或排障用，按需修改">高级</span>
      </label>
      <p v-if="field.help" class="item-help">{{ field.help }}</p>
      <div class="item-meta">
        <span class="item-src">{{ sourceText }}</span>
        <button type="button" class="item-restore" @click="$emit('restore')">恢复默认</button>
      </div>
    </div>
    <div class="item-ctrl">
      <el-switch
        v-if="field.type === 'bool'"
        :id="inputId"
        :model-value="Boolean(value)"
        @change="(v) => $emit('commit', Boolean(v))"
      />
      <el-select
        v-else-if="field.type === 'enum'"
        :id="inputId"
        :model-value="value"
        class="item-select"
        @change="(v) => $emit('commit', v)"
      >
        <el-option v-for="option in field.options || []" :key="option" :label="option" :value="option" />
      </el-select>
      <el-input
        v-else-if="field.type === 'text'"
        :id="inputId"
        :model-value="textValue"
        type="textarea"
        :rows="6"
        :maxlength="20480"
        class="item-textarea"
        @update:model-value="onInput"
        @blur="onBlur"
      />
      <el-input
        v-else-if="field.type === 'int'"
        :id="inputId"
        :model-value="textValue"
        type="number"
        :min="field.min"
        :max="field.max"
        class="item-number"
        @update:model-value="onInput"
        @blur="onBlur"
      />
      <SecretField
        v-else-if="field.type === 'secret'"
        :field="secretMeta"
        :version="revision"
        :mode="field.key === 'network.steamProxy' ? 'proxy' : 'single'"
        @saved="(d) => $emit('saved', d)"
      />
      <el-input
        v-else
        :id="inputId"
        :model-value="textValue"
        class="item-string"
        @update:model-value="onInput"
        @blur="onBlur"
      />
      <slot name="after" />
      <span v-if="state" class="item-state" :class="`is-${state.kind}`" role="status" aria-live="polite">
        <span v-if="state.kind === 'saving'" class="item-spin" aria-hidden="true"></span>{{ state.text }}
      </span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
// FX 批（docs/SECRET-REVEAL.md §4）：密钥字段直接复用「密码框 + 眼睛」组件，本批不重写密钥框逻辑。
import SecretField from '../components/SecretField.vue';

const props = defineProps({
  // 服务端 schema 下发的字段定义：{ key, label, help, type, options, min, max, default, tier }
  field: { type: Object, required: true },
  value: { type: [String, Number, Boolean], default: '' },
  // 值来源：database / env / default（hover 才显示）
  source: { type: String, default: null },
  // 行内保存状态：{ kind: 'saving'|'saved'|'error', message }
  status: { type: Object, default: null },
  // 密钥字段是否已配置（来自 schema.secrets[key].hasValue）
  hasValue: { type: Boolean, default: false },
  // 设置修订号：交给 SecretField 丢弃过期明文缓存
  revision: { type: [Number, String], default: 0 },
  // 搜索跳组后的高亮
  hit: { type: Boolean, default: false },
});
const emit = defineEmits(['commit', 'input', 'commit-now', 'restore', 'saved']);

const SOURCE_TEXT = { database: '数据库', env: '环境变量', default: '默认值' };
const sourceText = computed(() => SOURCE_TEXT[props.source] || '默认值');
const isAdvanced = computed(() => props.field?.tier === 'advanced');
const textValue = computed(() => (props.value == null ? '' : String(props.value)));
// label for= 指向控件内部 input（ElInput/ElSelect/ElSwitch 都支持 id 透传）
const inputId = computed(() => `setting-${String(props.field?.key ?? '').replace(/[^a-zA-Z0-9_-]/g, '-')}-input`);
const secretMeta = computed(() => ({
  key: props.field.key,
  label: props.field.label,
  help: props.field.help,
  hasValue: props.hasValue,
  source: props.source,
}));
const state = computed(() => {
  const status = props.status;
  if (!status || status.kind === 'idle') return null;
  if (status.kind === 'saving') return { kind: 'saving', text: '保存中…' };
  if (status.kind === 'saved') return { kind: 'saved', text: '✓ 已保存' };
  return { kind: 'error', text: `✕ ${status.message || '保存失败，已回滚'}` };
});
// 输入类控件逐字上报（600ms 防抖在父组件的保存队列里做），失焦立即提交（§3.3）
function onInput(value) {
  emit('input', String(value ?? ''));
}
function onBlur(event) {
  emit('commit-now', String(event?.target?.value ?? textValue.value ?? ''));
}
</script>

<style scoped>
/* 一行一项：左 label/help/来源，右控件 + 状态（demo ?shot=1 的 .item） */
.setting-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-18);
  align-items: center;
  padding: var(--space-12) var(--space-6);
  border-bottom: 1px solid var(--border);
  transition: background 0.15s;
}
.setting-item:hover {
  background: var(--panel-2);
}
.setting-item.is-hit {
  background: var(--brand-soft);
  box-shadow: inset 3px 0 0 var(--brand);
}
.item-label {
  min-width: 0;
}
.item-name {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  min-width: 0;
  font-size: var(--font-13);
  font-weight: 600;
  color: var(--fg);
  cursor: pointer;
}
.item-text {
  overflow-wrap: anywhere;
}
.item-adv {
  flex: none;
  font-size: var(--font-10);
  font-weight: 500;
  color: var(--warn);
  background: var(--warn-bg);
  border: 1px solid var(--warn-soft);
  border-radius: var(--radius-6);
  padding: 0 6px;
  line-height: 1.6;
}
.item-help {
  margin: 3px 0 0;
  font-size: var(--font-11);
  line-height: 1.5;
  color: var(--fg-muted);
}
/* 来源徽标 + 恢复默认：默认不可见（opacity 0 保留占位，不抖动），hover / focus-within 才出现 */
.item-meta {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  margin-top: 5px;
  min-height: 18px;
  opacity: 0;
  transition: opacity 0.15s;
}
.setting-item:hover .item-meta,
.setting-item:focus-within .item-meta {
  opacity: 1;
}
/* 触屏没有 hover：始终显示，否则手机上「恢复默认」点不到 */
@media (hover: none) {
  .item-meta {
    opacity: 1;
  }
}
.item-src {
  font-size: var(--font-10);
  color: var(--fg-muted);
  border: 1px solid var(--border);
  border-radius: var(--radius-6);
  padding: 1px 7px;
}
.item-restore {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--fg-muted);
  font-size: var(--font-11);
  cursor: pointer;
  text-decoration: underline dotted;
}
.item-restore:hover {
  color: var(--brand);
}
.item-ctrl {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-10);
  min-width: 0;
}
.item-select {
  width: 190px;
}
.item-number {
  width: 120px;
}
.item-string {
  width: 260px;
}
.item-textarea {
  width: 100%;
}
.item-textarea :deep(.el-textarea__inner) {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: var(--font-12);
  line-height: 1.6;
}
/* 保存状态三态（demo ?shot=2 ①）：保存中（spinner）/ ✓ 已保存（2 秒后淡出，由父组件切 idle）/ ✕ 原因 */
.item-state {
  display: inline-flex;
  align-items: center;
  gap: var(--space-6);
  white-space: nowrap;
  font-size: var(--font-11);
  transition: opacity 0.4s;
}
.item-state.is-saving {
  color: var(--warn);
}
.item-state.is-saved {
  color: var(--success);
}
.item-state.is-error {
  color: var(--danger);
  white-space: normal;
  max-width: 220px;
  text-align: right;
}
.item-spin {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid var(--warn-soft);
  border-top-color: var(--warn);
  border-radius: 50%;
  animation: item-spin 0.8s linear infinite;
}
@keyframes item-spin {
  to {
    transform: rotate(360deg);
  }
}
/* ≤560px（规格 §3.5）：上下两段，控件占满宽，状态在控件下方；触摸目标 ≥44px */
@media (max-width: 560px) {
  .setting-item {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-8);
    padding: var(--space-12) var(--space-2);
    align-items: stretch;
  }
  .item-ctrl {
    flex-direction: column;
    align-items: stretch;
    justify-content: flex-start;
    gap: var(--space-6);
    width: 100%;
  }
  .item-select,
  .item-number,
  .item-string,
  .item-textarea {
    width: 100%;
  }
  .item-ctrl :deep(.el-input__wrapper),
  .item-ctrl :deep(.el-select__wrapper) {
    min-height: 44px;
  }
  .item-ctrl :deep(.el-switch) {
    align-self: flex-start;
    min-height: 44px;
    padding: 12px 0;
  }
  .item-ctrl :deep(.el-button) {
    min-height: 44px;
  }
  .item-state {
    justify-content: flex-start;
  }
  .item-state.is-error {
    max-width: none;
    text-align: left;
  }
}
</style>
