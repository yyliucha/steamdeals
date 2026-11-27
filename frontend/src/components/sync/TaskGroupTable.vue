<script setup>
// GA-1（docs/SYNC-PAGE-REDESIGN.md §2.2 / §3-2 / §3-4 / §3-6 / §4）：任务组表（页面主区）。
//
// 结构（顺序与 demo 一致）：
//   面板头「任务与调度」+ 统计（N 个任务组 · M 个定时任务 + K 个手动任务）+「全部收起」
//   任务告警提示条（缺 Key / 被 *_ENABLED=0 关闭的任务——GA-1 从独立区块收进表头）
//   11~12 个任务组行（点行展开/收起子步骤；组级「立即运行」）
//   末尾「手动任务（不进调度器）」组（catalog / logs / report / steam-claim，只保留立即运行）
//
// 数据全部来自 /api/admin/sync/status（schedule.groups / schedule.jobs / manualJobs / warnings），
// 组数与子步骤**不写死**——后端精简任务后这里自然变少。
import { computed, reactive, ref } from 'vue';
import { useSyncAdmin } from '../../composables/useSyncAdmin.js';

const {
  state,
  groups,
  manualJobs,
  warnings,
  groupState,
  groupFailTitle,
  groupOpenText,
  forbiddenTagText,
  rateGateTagText,
  dateTime,
  runnableStep,
  stepRunLabel,
  fmtDur,
  fmtHM,
  loadStatus,
  runStep,
  runGroup,
  runManual,
  runSteamClaim,
  stopCurrent,
  resetCircuit,
} = useSyncAdmin();

/** 状态对象（含 loading 与已提交标记；模板里读 submitted.has 保持响应）。 */
const submitted = state.submitted;

const expanded = reactive(new Set());
function toggle(name) {
  if (expanded.has(name)) expanded.delete(name);
  else expanded.add(name);
}
function collapseAll() {
  expanded.clear();
}

/** 组内最近一次失败原因（悬停看全文）。 */
function failReason(row) {
  const f = (row.steps || []).find((s) => s.lastResult === 'failed' && s.lastError);
  return f ? f.lastError : '—';
}
/** 429 观测（与旧页同口径：BL 批 partial）。 */
function partialTitle(row) {
  const p = row.partial;
  if (!p) return '';
  const eta = p.etaDays ? ` · 预计约 ${p.etaDays} 天` : ` · 剩余约 ${p.remaining}`;
  return `HTTP 429 · 已处理 ${p.done}/${p.limit}${eta}`;
}
function partialReason(row) {
  const p = row.partial;
  if (!p) return row.lastError || '—';
  const t = p.last429At ? fmtHM(p.last429At) : '';
  return `429 累计 ${p.count429} 次${t ? ` · 最近 ${t}` : ''}`;
}

const scheduledCount = computed(() => groups.value.reduce((n, g) => n + (g.steps || []).length, 0));
const groupCount = computed(() => groups.value.length);

/** 概览卡「需要关注」跳转用：展开指定组（返回组名供 shell 滚动）。 */
function expandGroup(name) {
  if (!name) return;
  expanded.add(name);
}
defineExpose({ expandGroup });

/** 子步骤行状态标签（沿用旧页口径：运行中/等待/熔断/失败次数/重试/空闲）。 */
function stepStateText(s) {
  if (s.running) return '运行中';
  if (s.waitingFor) return `等待 ${s.waitingFor.occupiedBy}`;
  if (s.openUntil) return `熔断至 ${dateTime(s.openUntil)}`;
  if (s.failures) return `失败 ${s.failures} 次`;
  if (s.retryAt) return `重试于 ${fmtHM(s.retryAt)}`;
  return '空闲';
}
function stepStateType(s) {
  if (s.running) return 'primary';
  if (s.openUntil) return 'danger';
  if (s.failures) return 'warning';
  return 'info';
}
function resultText(s) {
  return s.lastResult === 'ok' ? '成功'
    : s.lastResult === 'partial' ? '部分完成'
      : s.lastResult === 'interrupted' ? '被重启中断'
        : s.lastResult === 'failed' ? '失败' : '';
}
function resultType(s) {
  return s.lastResult === 'ok' ? 'success'
    : s.lastResult === 'partial' ? 'warning'
      : s.lastResult === 'failed' ? 'danger' : 'info';
}

/** 组健康标签（运行中/失败/熔断/正常/—）。 */
function healthText(row) {
  const st = groupState(row);
  return st === 'running' ? '运行中' : st === 'failed' ? '失败' : st === 'open' ? '熔断' : st === 'ok' ? '正常' : '—';
}
function healthType(row) {
  const st = groupState(row);
  return st === 'running' ? 'primary' : st === 'failed' || st === 'open' ? 'danger' : st === 'ok' ? 'success' : 'info';
}
function healthTitle(row) {
  return groupState(row) === 'failed' ? groupFailTitle(row) : groupState(row) === 'open' ? groupOpenText(row) : '';
}

// 首次进入加载一次（轮询由 SyncAdmin 统一启停，避免每个块各拉一遍）
if (!state.status) loadStatus();
</script>

<template>
  <div class="sync-panel">
    <div class="sync-panel-head">
      <div>
        <h2>任务与调度</h2>
        <p>{{ groupCount }} 个任务组 · <b>{{ scheduledCount }} 个定时任务 + {{ manualJobs.length }} 个手动任务</b> · 点组行展开子步骤；「立即运行」使用默认参数</p>
      </div>
      <el-button text @click="collapseAll">全部收起</el-button>
    </div>

    <!-- 告警收进表头提示条（原「任务告警」独立区块已删除） -->
    <el-alert v-if="warnings.length" type="warning" :closable="false" class="sync-warn">
      <p v-for="w in warnings" :key="w.name">任务 <strong>{{ w.name }}</strong> 缺失：{{ w.reason }}</p>
    </el-alert>

    <div class="sync-rows">
      <div v-for="g in groups" :key="g.name" class="sync-group" :class="{ open: expanded.has(g.name) }">
        <div
          class="sync-row"
          role="button"
          tabindex="0"
          :aria-expanded="expanded.has(g.name)"
          :data-group="g.name"
          @click="toggle(g.name)"
          @keydown.enter.prevent="toggle(g.name)"
          @keydown.space.prevent="toggle(g.name)"
        >
          <span class="sync-caret" :class="{ on: expanded.has(g.name) }">▸</span>
          <span class="sync-gname"><span class="sync-gname-text">{{ g.label }}</span></span>
          <span class="sync-muted col-hide">{{ g.steps.length }} 步</span>
          <span class="sync-muted col-hide">最近 {{ g.lastRunAt ? dateTime(g.lastRunAt) : '—' }}</span>
          <span class="col-hide"><el-tag :type="healthType(g)" size="small" :title="healthTitle(g)">{{ healthText(g) }}</el-tag></span>
          <span class="col-hide">
            <el-button size="small" :disabled="submitted.has(`group:${g.name}`)" @click.stop="runGroup(g)">{{ submitted.has(`group:${g.name}`) ? '已提交' : '立即运行' }}</el-button>
          </span>
          <!-- ≤980px：任务组行改两行（第二行 = 健康 + 最近运行 + 立即运行） -->
          <span class="sync-row-2">
            <el-tag :type="healthType(g)" size="small" :title="healthTitle(g)">{{ healthText(g) }}</el-tag>
            <span class="sync-muted">{{ g.steps.length }} 步 · 最近 {{ g.lastRunAt ? dateTime(g.lastRunAt) : '—' }}</span>
            <span class="sync-row-2-act"><el-button size="small" :disabled="submitted.has(`group:${g.name}`)" @click.stop="runGroup(g)">{{ submitted.has(`group:${g.name}`) ? '已提交' : '立即运行' }}</el-button></span>
          </span>
        </div>

        <div v-show="expanded.has(g.name)" class="sync-steps-scroll">
          <table class="sync-steps">
            <thead>
              <tr><th>子步骤</th><th>频率</th><th>上次运行</th><th>下次运行</th><th>上次结果</th><th>耗时</th><th>失败原因</th><th>状态</th><th>操作</th></tr>
            </thead>
            <tbody>
              <tr v-for="s in g.steps" :key="s.name">
                <td>{{ s.label }}<small v-if="s.stats" class="sync-step-stats">匹配 {{ s.stats.matched }} · 未命中 {{ s.stats.nomatch }} · 待探测 {{ s.stats.pending }}</small></td>
                <td class="sync-mono sync-muted">{{ s.freq }}</td>
                <td class="sync-muted">{{ s.lastRunAt ? dateTime(s.lastRunAt) : '—' }}</td>
                <td class="sync-muted">{{ s.nextRunAt ? dateTime(s.nextRunAt) : '—' }}</td>
                <td><el-tag v-if="resultText(s)" :type="resultType(s)" size="small" :title="s.lastResult === 'partial' ? partialTitle(s) : ''">{{ resultText(s) }}</el-tag><span v-else class="sync-muted">—</span></td>
                <td class="sync-muted">{{ s.lastElapsedMs != null ? fmtDur(s.lastElapsedMs) : '—' }}<template v-if="s.estimate"> · 估算 {{ fmtDur(Math.round((s.estimate.obsSec ?? s.estimate.estSec) * 1000)) }}{{ s.estimate.obsSec == null ? '（理论）' : '' }}</template></td>
                <td class="sync-muted" :title="failReason(s)">{{ partialReason(s) }}</td>
                <td>
                  <el-tag :type="stepStateType(s)" size="small">{{ stepStateText(s) }}</el-tag>
                  <el-tag v-if="forbiddenTagText" type="info" size="small" class="sync-tag-gap">{{ forbiddenTagText }}</el-tag>
                  <el-tag v-if="rateGateTagText" type="info" size="small" class="sync-tag-gap">{{ rateGateTagText }}</el-tag>
                </td>
                <td>
                  <el-button v-if="s.running" link type="danger" @click="stopCurrent()">停止</el-button>
                  <el-button v-if="runnableStep(s.name)" link type="primary" :disabled="Boolean(state.status?.running) || submitted.has(`step:${s.name}`)" @click="runStep(s.name)">{{ submitted.has(`step:${s.name}`) ? '已提交' : stepRunLabel(s.name) }}</el-button>
                  <el-button v-if="s.openUntil" link type="danger" @click="resetCircuit(s)">重置熔断</el-button>
                  <span v-if="!s.running && !runnableStep(s.name) && !s.openUntil" class="sync-muted">—</span>
                </td>
              </tr>
              <tr v-if="!g.steps.length"><td colspan="9" class="sync-empty">该组当前没有启用的子步骤（缺 Key 或被 *_ENABLED=0 关闭，见上方提示）</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 手动任务（不进调度器）：只保留「立即运行」 -->
      <div class="sync-group">
        <div
          class="sync-row"
          role="button"
          tabindex="0"
          :aria-expanded="expanded.has('__manual__')"
          data-group="manual"
          @click="toggle('__manual__')"
          @keydown.enter.prevent="toggle('__manual__')"
          @keydown.space.prevent="toggle('__manual__')"
        >
          <span class="sync-caret" :class="{ on: expanded.has('__manual__') }">▸</span>
          <span class="sync-gname"><span class="sync-gname-text">手动任务（不进调度器）</span></span>
          <span class="sync-muted col-hide">{{ manualJobs.length }} 个</span>
          <span class="sync-muted col-hide">—</span>
          <span class="col-hide"><el-tag type="info" size="small">手动</el-tag></span>
          <span class="col-hide" />
          <span class="sync-row-2">
            <el-tag type="info" size="small">手动</el-tag>
            <span class="sync-muted">{{ manualJobs.length }} 个 · 不占调度槽</span>
          </span>
        </div>
        <div v-show="expanded.has('__manual__')" class="sync-steps-scroll">
          <table class="sync-steps">
            <thead>
              <tr><th>任务</th><th>频率</th><th>上次运行</th><th>下次运行</th><th>上次结果</th><th>耗时</th><th>失败原因</th><th>状态</th><th>操作</th></tr>
            </thead>
            <tbody>
              <tr v-for="job in manualJobs" :key="job.name" :data-manual="job.name">
                <td>{{ job.label }}</td>
                <td class="sync-muted">手动</td>
                <td class="sync-muted">—</td>
                <td class="sync-muted">—</td>
                <td><el-tag type="info" size="small">手动</el-tag></td>
                <td class="sync-muted">—</td>
                <td class="sync-muted" :title="job.reason || ''">{{ job.reason || '—' }}</td>
                <td><el-tag v-if="job.runnable" type="info" size="small">可立即运行</el-tag><el-tag v-else type="warning" size="small">不可运行</el-tag></td>
                <td>
                  <el-button
                    link
                    type="primary"
                    :disabled="!job.runnable || submitted.has(`manual:${job.name}`) || submitted.has(`step:${job.name}`)"
                    :title="job.runnable ? '使用默认参数立即运行一次' : (job.reason || '当前不可运行')"
                    @click="job.name === 'steam-claim' ? runSteamClaim() : runManual(job)"
                  >{{ submitted.has(`manual:${job.name}`) || submitted.has(`step:${job.name}`) ? '已提交' : '立即运行' }}</el-button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>
