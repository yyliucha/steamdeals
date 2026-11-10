<template>
  <div class="logs-wrap" :class="{ 'm-console': isMobile }">
    <el-tabs v-model="activeTab" class="logs-tabs" @tab-change="onTabChange">
      <!-- 1. 用户删除 -->
      <el-tab-pane name="user-deletions">
        <template #label><span>用户删除<span v-if="counts.user_deletions != null" class="tab-count">{{ counts.user_deletions }}</span></span></template>
        <div class="module-card filterbar">
          <el-input v-model="delQuery" clearable placeholder="按用户名搜索" @keyup.enter="loadDeletions" @clear="loadDeletions" />
          <el-button :loading="loading.user_deletions" @click="loadDeletions">搜索</el-button>
          <el-date-picker v-model="delRange" type="daterange" value-format="YYYY-MM-DD" start-placeholder="删除日期起" end-placeholder="止" style="width:250px" />
          <el-button text @click="delRange=null">清除日期</el-button>
          <el-button text :loading="loading.user_deletions" @click="loadDeletions">刷新</el-button>
        </div>
        <div class="module-card table-card">
          <el-table :data="pagedDeletions" v-loading="loading.user_deletions" stripe>
            <el-table-column prop="username" label="用户名" min-width="110" />
            <el-table-column label="角色" width="90"><template #default="{ row }">{{ row.role === 'admin' ? '管理员' : '普通用户' }}</template></el-table-column>
            <el-table-column label="删除时间" min-width="155"><template #default="{ row }">{{ dateTime(row.created_at) }}</template></el-table-column>
            <el-table-column prop="deleted_by" label="操作者" width="120" />
            <el-table-column prop="steam_accounts" label="Steam 账号" width="95" align="right" />
            <el-table-column label="原因" min-width="150" show-overflow-tooltip><template #default="{ row }">{{ row.reason || '—' }}</template></el-table-column>
          </el-table>
          <el-empty v-if="!deletions.length && !loading.user_deletions" description="暂无删除记录" />
          <PaginationBar v-model:page="delPage" v-model:page-size="delPageSize" :total="deletions.length" />
        </div>
      </el-tab-pane>

      <!-- 2. 批量操作 -->
      <el-tab-pane name="bulk">
        <template #label><span>批量操作<span v-if="counts.bulk != null" class="tab-count">{{ counts.bulk }}</span></span></template>
        <div class="notice-card"><strong>批量操作的审计记录</strong><p>每次批量执行都会落一条记录（谁、何时、对哪个列表、成功/失败多少）；被拒绝的请求不会执行，只写日志。点「详情」可看这次操作的键样本（最多 50 个）。</p></div>
        <div class="module-card filterbar">
          <el-select v-model="bulkTarget" style="width:180px" @change="loadBulkOps"><el-option v-for="t in bulkOpsTargets" :key="t.value" :label="t.label" :value="t.value" /></el-select>
          <el-button :loading="loading.bulk" @click="loadBulkOps">刷新</el-button>
        </div>
        <div class="module-card table-card">
          <el-table :data="bulkOps" v-loading="loading.bulk" stripe>
            <el-table-column label="时间" min-width="155"><template #default="{ row }">{{ dateTime(row.created_at) }}</template></el-table-column>
            <el-table-column label="操作者" width="120"><template #default="{ row }">{{ row.actor || '—' }}</template></el-table-column>
            <el-table-column label="列表" width="150"><template #default="{ row }">{{ bulkTargetLabel(row.target) }}</template></el-table-column>
            <el-table-column label="动作" width="110"><template #default="{ row }">{{ bulkActionLabel(row) }}</template></el-table-column>
            <el-table-column prop="total" label="总数" width="70" align="right" />
            <el-table-column prop="ok" label="成功" width="70" align="right" />
            <el-table-column prop="skipped" label="跳过" width="70" align="right" />
            <el-table-column label="失败" width="70" align="right"><template #default="{ row }"><span :class="row.failed > 0 ? 'text-danger' : ''">{{ row.failed }}</span></template></el-table-column>
            <el-table-column label="耗时" width="95" align="right"><template #default="{ row }">{{ row.duration_ms == null ? '—' : row.duration_ms + ' ms' }}</template></el-table-column>
            <el-table-column label="操作" width="80" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="openBulkOp(row)">详情</el-button></template></el-table-column>
          </el-table>
          <el-empty v-if="!bulkOps.length && !loading.bulk" description="还没有批量操作记录" />
        </div>
      </el-tab-pane>

      <!-- 3. Steam 账号 -->
      <el-tab-pane name="steam">
        <template #label><span>Steam 账号<span v-if="counts.steam != null" class="tab-count">{{ counts.steam }}</span></span></template>
        <div class="module-card filterbar">
          <el-select v-model="steamFilter.action" placeholder="全部动作" clearable style="width:150px" @change="loadSteamLogs"><el-option v-for="a in steamActions" :key="a.value" :label="a.label" :value="a.value" /></el-select>
          <el-select v-model="steamFilter.result" placeholder="全部结果" clearable style="width:110px" @change="loadSteamLogs"><el-option label="成功" value="ok" /><el-option label="失败" value="failed" /></el-select>
          <el-select v-model="steamFilter.days" style="width:120px" @change="loadSteamLogs"><el-option label="近 7 天" :value="7" /><el-option label="近 30 天" :value="30" /><el-option label="近 90 天" :value="90" /><el-option label="近 180 天" :value="180" /></el-select>
          <el-input v-model="steamFilter.steamId" clearable placeholder="按 SteamID 精确查" @keyup.enter="loadSteamLogs" @clear="loadSteamLogs" />
          <el-button :loading="loading.steam" @click="loadSteamLogs">刷新</el-button>
        </div>
        <div class="module-card table-card">
          <el-table :data="pagedSteamLogs" v-loading="loading.steam" stripe>
            <el-table-column label="时间" min-width="155"><template #default="{ row }">{{ dateTime(row.created_at) }}</template></el-table-column>
            <el-table-column label="动作" width="120"><template #default="{ row }">{{ steamActionLabel(row.action) }}</template></el-table-column>
            <el-table-column label="账号" min-width="190"><template #default="{ row }"><div class="steam-log-cell"><strong>{{ row.persona_name || row.steam_id }}</strong><small>{{ row.steam_id }}</small></div></template></el-table-column>
            <el-table-column label="归属用户" width="110"><template #default="{ row }">{{ row.username || '—' }}</template></el-table-column>
            <el-table-column label="操作者" width="110"><template #default="{ row }">{{ actorLabel(row.actor) }}</template></el-table-column>
            <el-table-column label="结果" width="80"><template #default="{ row }"><el-tag :type="row.result === 'ok' ? 'success' : 'danger'" size="small">{{ row.result === 'ok' ? '成功' : '失败' }}</el-tag></template></el-table-column>
            <el-table-column label="耗时" width="90" align="right"><template #default="{ row }">{{ row.elapsed_ms == null ? '—' : row.elapsed_ms + ' ms' }}</template></el-table-column>
            <el-table-column label="详情" min-width="140" show-overflow-tooltip><template #default="{ row }">{{ detailText(row.detail) }}</template></el-table-column>
            <el-table-column label="错误" min-width="130" show-overflow-tooltip><template #default="{ row }">{{ row.error || '—' }}</template></el-table-column>
          </el-table>
          <el-empty v-if="!steamLogs.length && !loading.steam" description="还没有 Steam 账号操作记录" />
          <PaginationBar v-model:page="steamPage" v-model:page-size="steamPageSize" :total="steamLogs.length" />
        </div>
      </el-tab-pane>

      <!-- 4. 邮件发送 -->
      <el-tab-pane name="mail">
        <template #label><span>邮件发送<span v-if="counts.mail != null" class="tab-count">{{ counts.mail }}</span></span></template>
        <div class="module-card table-card">
          <div class="card-heading padded"><div><h3>发送记录</h3><p>验证码读 email_codes，通知类读 mail_log；最多各 500 条</p></div><el-button text :loading="loading.mail" @click="loadMailLogs">刷新</el-button></div>
          <el-tabs v-model="mailTab" class="mail-log-tabs">
            <el-tab-pane label="验证码" name="codes">
              <el-table :data="pagedMailRecords" v-loading="loading.mail" stripe>
                <el-table-column prop="email" label="收件人" min-width="190" />
                <el-table-column prop="purpose" label="用途" width="130" />
                <el-table-column label="结果" min-width="180"><template #default="{ row }"><el-tag :type="row.sent_ok ? 'success' : 'danger'" size="small">{{ row.sent_ok ? '发送成功' : '发送失败' }}</el-tag><small v-if="row.error">{{ row.error }}</small></template></el-table-column>
                <el-table-column label="发送时间" min-width="160"><template #default="{ row }">{{ dateTime(row.created_at) }}</template></el-table-column>
                <el-table-column label="正文" width="90"><template #default="{ row }"><el-button v-if="row.body" link @click="openMail(row)">查看</el-button><span v-else>—</span></template></el-table-column>
              </el-table>
              <PaginationBar v-model:page="mailPage" v-model:page-size="mailPageSize" :total="mailRecords.length" />
            </el-tab-pane>
            <el-tab-pane label="通知" name="notify">
              <el-table :data="mailLogEntries" v-loading="loading.mail" stripe>
                <el-table-column label="时间" min-width="155"><template #default="{ row }">{{ dateTime(row.created_at) }}</template></el-table-column>
                <el-table-column label="事件" width="150"><template #default="{ row }">{{ mailEventLabel(row.event) }}</template></el-table-column>
                <el-table-column prop="to_email" label="收件人" min-width="180" />
                <el-table-column prop="subject" label="主题" min-width="180" show-overflow-tooltip />
                <el-table-column label="结果" width="90"><template #default="{ row }"><el-tag :type="row.ok ? 'success' : 'danger'" size="small">{{ row.ok ? '成功' : '失败' }}</el-tag></template></el-table-column>
                <el-table-column label="错误" min-width="140" show-overflow-tooltip><template #default="{ row }">{{ row.error || '—' }}</template></el-table-column>
              </el-table>
            </el-tab-pane>
          </el-tabs>
        </div>
      </el-tab-pane>

      <!-- 5. 运行与同步 -->
      <el-tab-pane name="run">
        <template #label><span>运行与同步<span v-if="counts.run != null" class="tab-count">{{ counts.run }}</span></span></template>
        <!-- BA 批（docs/RUN-SYNC-REDESIGN.md）：任务健康条（点 chip 过滤日志） -->
        <div class="module-card health-bar">
          <div class="health-head"><div><h3>任务健康</h3><p>最近一次运行 · 点任务筛选日志 · 每 60 秒自动刷新</p></div><el-button text :loading="loading.health" @click="loadHealth">刷新</el-button></div>
          <div class="health-chips">
            <button v-for="j in jobs" :key="j.name" type="button" class="health-chip" :class="[jobState(j), { on: jobFilter === j.name }]" @click="toggleJobFilter(j.name)">
              <span class="dot" /><strong>{{ jobLabel(j.name) }}</strong>
              <span class="chip-state">{{ jobStateText(j) }}</span>
              <span v-if="j.lastElapsedMs != null">{{ fmtDur(j.lastElapsedMs) }}</span>
              <span class="chip-next">{{ nextRunText(j) }}</span>
            </button>
            <el-empty v-if="!jobs.length" description="调度器状态尚未生成（未启动？）" :image-size="40" />
          </div>
        </div>

        <!-- 同步记录：6 列 · 默认最近 5 轮 -->
        <div class="module-card table-card">
          <div class="card-heading padded"><div><h3>同步记录</h3><p>最近 {{ visibleRuns.length }} / {{ syncRuns.length }} 轮数据任务</p></div><div class="heading-actions"><el-button text @click="showAllRuns = !showAllRuns">{{ showAllRuns ? '收起为最近 5 轮' : '展开全部（' + syncRuns.length + ' 轮）' }}</el-button><el-button text :loading="loading.run" @click="loadSyncRuns">刷新</el-button></div></div>
          <el-table :data="visibleRuns" v-loading="loading.run" stripe :row-class-name="syncRunRowClass">
            <el-table-column label="时间" min-width="155"><template #default="{ row }">{{ dateTime(row.started_at) }}</template></el-table-column>
            <el-table-column label="模式" width="120"><template #default="{ row }"><el-tag size="small">{{ syncModeLabel(row.mode) }}</el-tag></template></el-table-column>
            <el-table-column label="状态" width="95"><template #default="{ row }"><el-tag :type="row.status === 'ok' ? 'success' : row.status === 'running' ? 'primary' : 'danger'" size="small">{{ { ok: '成功', running: '运行中', failed: '失败', stopped: '已停止' }[row.status] || row.status || '—' }}</el-tag></template></el-table-column>
            <el-table-column label="结果" min-width="200"><template #default="{ row }">{{ runResult(row) }}</template></el-table-column>
            <el-table-column label="耗时" width="100"><template #default="{ row }">{{ syncDuration(row) }}</template></el-table-column>
            <el-table-column label="备注" min-width="220" show-overflow-tooltip><template #default="{ row }">{{ row.fetch_note || String(row.output || '').split('\n').filter(Boolean).slice(-1)[0] || '—' }}</template></el-table-column>
          </el-table>
        </div>

        <!-- 日志面板：固定高度内部滚动（sticky 筛选条） -->
        <div class="module-card log-panel">
          <div class="log-panel-head">
            <div class="log-filters">
              <el-select v-model="logScope" @change="loadLogs"><el-option label="所有模块" value="" /><el-option label="应用" value="app" /><el-option label="Steam 与同步" value="steam" /><el-option label="用户与登录" value="user" /><el-option label="错误" value="error" /></el-select>
              <el-select v-model="logMinutes" @change="loadLogs"><el-option label="全部时间" value="0" /><el-option label="近 15 分钟" value="15" /><el-option label="近 1 小时" value="60" /><el-option label="近 24 小时" value="1440" /></el-select>
              <el-input v-model="logQuery" clearable placeholder="搜索日志内容（点任务 chip 也会填这里）" @keyup.enter="loadLogs" />
              <el-button type="primary" @click="loadLogs">刷新日志</el-button>
              <el-checkbox v-model="autoLogs">每 10 秒自动刷新</el-checkbox>
              <el-button v-if="jobFilter" text @click="clearJobFilter">清除任务筛选：{{ jobLabel(jobFilter) }}</el-button>
            </div>
            <div class="log-meta"><span>{{ logFiles.join('、') || '日志文件读取中' }}</span><strong>{{ logEntries.length }} 条</strong><el-button text @click="logEntries = []">清空当前显示</el-button></div>
          </div>
          <div class="log-panel-body">
            <article v-for="(entry, index) in pagedLogEntries" :key="entry.ts + '-' + index" class="log-line" :class="String(entry.level || 'info').toLowerCase()" @click="toggleLogExpanded(index)">
              <time>{{ dateTime(entry.ts || entry.time) }}</time>
              <el-tag :type="logTag(entry.level)" size="small">{{ String(entry.level || 'info').toUpperCase() }}</el-tag>
              <strong class="log-event">{{ entry.event || entry.msg || '日志事件' }}</strong>
              <span class="log-brief">{{ logBrief(entry) }}</span>
              <pre v-if="expandedLogs.has(index)" class="log-full">{{ logDetails(entry) }}</pre>
            </article>
            <el-empty v-if="!logEntries.length" description="没有匹配的日志" />
          </div>
          <div class="log-panel-foot"><PaginationBar v-model:page="logsPage" v-model:page-size="logsPageSize" :total="logEntries.length" /></div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="bulkOpDialog" title="批量操作详情" width="min(560px, 92vw)"><p class="muted">{{ bulkOpDetail?.actor || '—' }} · {{ dateTime(bulkOpDetail?.created_at) }} · {{ bulkTargetLabel(bulkOpDetail?.target) }} / {{ bulkActionLabel(bulkOpDetail) }}</p><p class="muted">总数 {{ bulkOpDetail?.total || 0 }} · 成功 {{ bulkOpDetail?.ok || 0 }} · 跳过 {{ bulkOpDetail?.skipped || 0 }} · 失败 {{ bulkOpDetail?.failed || 0 }} · 来源 IP {{ bulkOpDetail?.ip || '—' }} · 耗时 {{ bulkOpDetail?.duration_ms == null ? '—' : bulkOpDetail.duration_ms + ' ms' }}</p><div class="bulk-op-keys"><el-tag v-for="key in bulkOpDetail?.keys_sample || []" :key="key" size="small" class="tag-gap">{{ key }}</el-tag><span v-if="!(bulkOpDetail?.keys_sample || []).length" class="muted">没有键样本</span></div><template #footer><el-button type="primary" @click="bulkOpDialog = false">关闭</el-button></template></el-dialog>

    <el-dialog v-model="mailDialog" :title="activeMail?.subject || '邮件正文'" width="min(600px, 92vw)"><p class="muted">{{ activeMail?.email }} · {{ activeMail?.purpose }} · {{ dateTime(activeMail?.created_at) }}</p><pre class="mail-body">{{ activeMail?.body || '无正文' }}</pre><template #footer><el-button :disabled="!mailCode" @click="copyCode">复制验证码</el-button><el-button type="primary" @click="mailDialog = false">关闭</el-button></template></el-dialog>
  </div>
</template>

<script setup>
// AT 批（docs/ADMIN-CONSOLE-IA.md §4）：操作日志——一页 5 tab 收拢全站日志：
// 用户删除 / 批量操作 / Steam 账号 / 邮件发送 / 运行与同步。
// 数据与改版前各单页一致（同一批接口）；切 tab 懒加载 + 内存缓存（第二次走缓存）；
// ?section=op-logs&tab=xxx 直达与刷新保持（tab 与 URL 双向同步）；
// 「运行与同步」的 10 秒轮询只在该 tab 打开时跑，离开即停。
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import PaginationBar from '../components/PaginationBar.vue';
import { useListPagination } from '../composables/useListPagination.js';
import { fmtDateTime as dateTime } from '../utils/siteTime.js';

const route = useRoute();
const router = useRouter();

const TABS = [
  { id: 'user-deletions', label: '用户删除' },
  { id: 'bulk', label: '批量操作' },
  { id: 'steam', label: 'Steam 账号' },
  { id: 'mail', label: '邮件发送' },
  { id: 'run', label: '运行与同步' },
];
const validTab = (t) => TABS.some((x) => x.id === t);
const activeTab = ref(validTab(String(route.query.tab ?? '')) ? String(route.query.tab) : TABS[0].id);

// 窄屏（手机）：表格由 .m-console 的「左右滑动查看更多」提示覆盖
const mobileQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(max-width: 760px)') : null;
const isMobile = ref(Boolean(mobileQuery && mobileQuery.matches));
function onMobileChange(e) { isMobile.value = e.matches; }
if (mobileQuery) { if (mobileQuery.addEventListener) mobileQuery.addEventListener('change', onMobileChange); else mobileQuery.addListener(onMobileChange); }

function api(path, opts = {}) {
  return fetch(path, { credentials: 'same-origin', ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } }).then(async (r) => {
    const t = await r.text();
    let d = {};
    try { d = t ? JSON.parse(t) : {}; } catch {}
    if (r.status === 401) { window.location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search); throw new Error(d.error || '登录已过期'); }
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    return d;
  });
}
function notify(e) { ElMessage.error(e?.message || String(e)); }

const loading = reactive({ user_deletions: false, bulk: false, steam: false, mail: false, run: false, health: false });
const loaded = reactive({ user_deletions: false, bulk: false, steam: false, mail: false, run: false });
const counts = reactive({ user_deletions: null, bulk: null, steam: null, mail: null, run: null });

// 切 tab：懒加载一次（内存缓存，第二次不重复请求），tab 同步进 URL（刷新/收藏/从别页跳转可用）
function onTabChange(tab) {
  if (!validTab(tab)) return;
  const q = { ...route.query, tab };
  router.replace({ path: '/console', query: q }).catch(() => {});
  if (!loaded[tab]) loadTab(tab);
}
watch(
  () => route.query.tab,
  (t) => {
    if (validTab(String(t ?? '')) && t !== activeTab.value) {
      activeTab.value = String(t);
      if (!loaded[activeTab.value]) loadTab(activeTab.value);
    }
  },
);
function loadTab(tab) {
  if (tab === 'user-deletions') loadDeletions();
  else if (tab === 'bulk') loadBulkOps();
  else if (tab === 'steam') loadSteamLogs();
  else if (tab === 'mail') loadMailLogs();
  else if (tab === 'run') loadRun();
}

// ------------------------------------------------ 1. 用户删除（上限 200 + 日期范围，Q6 默认）
const deletions = ref([]);
const delQuery = ref('');
const delRange = ref(null);
const delPager = useListPagination(computed(() => {
  const [from, to] = delRange.value || [null, null];
  return deletions.value.filter((d) => {
    const day = String(d.created_at || '').slice(0, 10);
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  });
}));
const pagedDeletions = delPager.items, delPage = delPager.page, delPageSize = delPager.pageSize;
async function loadDeletions() {
  loading.user_deletions = true;
  try {
    const q = new URLSearchParams({ limit: '200' });
    if (delQuery.value.trim()) q.set('q', delQuery.value.trim());
    const d = await api(`/api/admin/users/deletions?${q}`);
    deletions.value = d.deletions || [];
    counts.user_deletions = deletions.value.length;
    loaded.user_deletions = true;
    delPage.value = 1;
  } catch (e) { notify(e); } finally { loading.user_deletions = false; }
}

// ------------------------------------------------ 2. 批量操作
const bulkOps = ref([]);
const bulkTarget = ref('');
const bulkOpsTargets = [
  { value: '', label: '全部列表' },
  { value: 'reviews', label: '异常审核' }, { value: 'visitors', label: '访问明细' }, { value: 'games', label: '游戏目录 / 回收站' },
  { value: 'announcements', label: '站点通知' }, { value: 'blacklist', label: 'IP 黑名单' }, { value: 'whitelist', label: 'IP 白名单' },
  { value: 'device-bans', label: '已封设备' }, { value: 'abuse', label: '自动封禁' }, { value: 'devices', label: '最近设备' }, { value: 'users', label: '用户管理' },
];
const BULK_TARGET_LABEL = { reviews: '异常审核', visitors: '访问明细', games: '游戏目录 / 回收站', announcements: '站点通知', blacklist: 'IP 黑名单', whitelist: 'IP 白名单', 'device-bans': '已封设备', abuse: '自动封禁', devices: '最近设备', users: '用户管理' };
const BULK_ACTION_LABEL = { 'approve-ip': '封 IP', 'approve-device': '封设备', reject: '忽略', restore: '恢复', block: '禁用', unblock: '启用', delete: '删除', activate: '启用', deactivate: '停用', unban: '解封', remove: '移出白名单', ban: '封禁', trust: '信任', disable: '禁用', enable: '启用' };
function bulkTargetLabel(v) { return BULK_TARGET_LABEL[v] || v || '—'; }
function bulkActionLabel(row) { return BULK_ACTION_LABEL[row?.action] || row?.action || '—'; }
const bulkOpDialog = ref(false);
const bulkOpDetail = ref(null);
async function loadBulkOps() {
  loading.bulk = true;
  try {
    const qs = new URLSearchParams({ limit: '100' });
    if (bulkTarget.value) qs.set('target', bulkTarget.value);
    const d = await api(`/api/admin/bulk-ops?${qs}`);
    bulkOps.value = d.ops || [];
    counts.bulk = bulkOps.value.length;
    loaded.bulk = true;
  } catch (e) { notify(e); } finally { loading.bulk = false; }
}
async function openBulkOp(row) {
  try {
    const d = await api(`/api/admin/bulk-ops/${row.id}`);
    bulkOpDetail.value = d.op || null;
    bulkOpDialog.value = true;
  } catch (e) { notify(e); }
}

// ------------------------------------------------ 3. Steam 账号（新表 steam_account_logs）
const steamLogs = ref([]);
const steamFilter = reactive({ action: '', result: '', days: 30, steamId: '' });
const steamActions = [
  { value: 'bind', label: '绑定' }, { value: 'unbind', label: '解绑' }, { value: 'claim', label: '认领' },
  { value: 'sync-library', label: '同步游戏库' }, { value: 'sync-wishlist', label: '同步愿望单' },
  { value: 'api-key', label: '更换 API Key' }, { value: 'delete-cascade', label: '级联删除' },
];
const STEAM_ACTION_LABEL = Object.fromEntries(steamActions.map((a) => [a.value, a.label]));
function steamActionLabel(v) { return STEAM_ACTION_LABEL[v] || v || '—'; }
function actorLabel(v) {
  if (String(v).startsWith('admin:')) return `管理员 ${String(v).slice(6)}`;
  if (v === 'scheduler') return '调度器';
  if (v === 'self') return '用户本人';
  return v || '—';
}
function detailText(detail) {
  if (detail == null) return '—';
  if (typeof detail !== 'object') return String(detail);
  return Object.entries(detail).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ');
}
const steamPager = useListPagination(steamLogs);
const pagedSteamLogs = steamPager.items, steamPage = steamPager.page, steamPageSize = steamPager.pageSize;
async function loadSteamLogs() {
  loading.steam = true;
  try {
    const qs = new URLSearchParams({ limit: '500', days: String(steamFilter.days) });
    if (steamFilter.action) qs.set('action', steamFilter.action);
    if (steamFilter.result) qs.set('result', steamFilter.result);
    if (steamFilter.steamId.trim()) qs.set('steamId', steamFilter.steamId.trim());
    const d = await api(`/api/admin/steam-logs?${qs}`);
    steamLogs.value = d.entries || [];
    counts.steam = Number(d.total ?? steamLogs.value.length);
    loaded.steam = true;
    steamPage.value = 1;
  } catch (e) { notify(e); } finally { loading.steam = false; }
}

// ------------------------------------------------ 4. 邮件发送（验证码 / 通知两个子筛选）
const mailTab = ref('codes');
const mailRecords = ref([]);
const mailLogEntries = ref([]);
const mailPager = useListPagination(mailRecords);
const pagedMailRecords = mailPager.items, mailPage = mailPager.page, mailPageSize = mailPager.pageSize;
const mailDialog = ref(false);
const activeMail = ref(null);
const mailCode = ref(null);
const EVENT_LABELS = { account_disabled: '账号停用', account_enabled: '账号恢复', account_deleted: '账号删除', account_renamed: '显示名修改', account_email_changed: '登录邮箱变更', account_email_bound: '邮箱绑定', account_role_changed: '权限变更', account_password_reset: '密码重置', verify_code: '验证码', test: '测试邮件' };
function mailEventLabel(e) { return EVENT_LABELS[e] || e || '—'; }
async function loadMailLogs() {
  loading.mail = true;
  try {
    const [m, n] = await Promise.all([api('/api/admin/emails?limit=500'), api('/api/admin/mail/log?limit=500')]);
    mailRecords.value = m.records || [];
    mailLogEntries.value = n.entries || [];
    counts.mail = mailRecords.value.length + mailLogEntries.value.length;
    loaded.mail = true;
  } catch (e) { notify(e); } finally { loading.mail = false; }
}
function openMail(row) {
  activeMail.value = row;
  mailCode.value = (row.body || '').match(/(\d{6})/)?.[1] || null;
  mailDialog.value = true;
}
async function copyCode() {
  if (!mailCode.value) return;
  try { await navigator.clipboard.writeText(mailCode.value); ElMessage.success('验证码已复制'); } catch { ElMessage.warning(`复制失败，请手动复制：${mailCode.value}`); }
}

// ------------------------------------------------ 5. 运行与同步（10 秒轮询只在该 tab 打开时跑）
const syncRuns = ref([]);
const logEntries = ref([]);
const logFiles = ref([]);
const logQuery = ref('');
const logScope = ref('');
const logMinutes = ref('0');
const autoLogs = ref(false);
const logsPager = useListPagination(logEntries);
const pagedLogEntries = logsPager.items, logsPage = logsPager.page, logsPageSize = logsPager.pageSize;
function loadRun() { loadSyncRuns(); loadLogs(); loadHealth(); }
async function loadSyncRuns() {
  loading.run = true;
  try {
    const d = await api('/api/admin/sync/runs?limit=20');
    syncRuns.value = d.runs || [];
    counts.run = syncRuns.value.length;
    loaded.run = true;
  } catch (e) { notify(e); } finally { loading.run = false; }
}
async function loadLogs() {
  try {
    const q = new URLSearchParams({ limit: '300', grep: logQuery.value.trim(), scope: logScope.value, minutes: logMinutes.value });
    const d = await api(`/api/admin/logs?${q}`);
    logEntries.value = (d.entries || []).slice().reverse();
    logFiles.value = d.files || [];
    loaded.run = true;
  } catch (e) { notify(e); }
}
function syncModeLabel(mode) { return ({ 'steam-prices': '价格刷新', catalog: '目录同步', backfill: '增量回填', rename: '重写名字', heat: '热度回填', discover: '发现队列', images: '图片预取' })[mode] || mode || '—'; }
function syncDuration(row) {
  if (!row.started_at) return '—';
  const end = row.finished_at ? new Date(row.finished_at).getTime() : Date.now();
  const sec = Math.max(0, Math.round((end - new Date(row.started_at).getTime()) / 1000));
  if (sec < 60) return `${sec} 秒`;
  return `${Math.floor(sec / 60)} 分 ${sec % 60} 秒`;
}
function syncRunRowClass({ row }) { return row.status === 'failed' ? 'sync-run-failed' : ''; }
function logTag(level) {
  const v = String(level || '').toLowerCase();
  return v === 'error' || v === 'fatal' ? 'danger' : v === 'warn' || v === 'warning' ? 'warning' : 'info';
}
function logDetails(entry) {
  return Object.entries(entry).filter(([k]) => !['ts', 'time', 'level', 'event', 'msg'].includes(k)).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join('  ');
}

// BA 批（docs/RUN-SYNC-REDESIGN.md §3）：任务健康条 + 记录精简 + 固定高度日志面板
const jobs = ref([]);
const showAllRuns = ref(false);
const jobFilter = ref('');
const expandedLogs = ref(new Set());
const JOB_LABELS = {
  'steam-prices': '价格刷新', 'steam-status': '状态判定', 'steam-accounts': 'Steam 账号', 'steam-claim': '愿望单认领',
  catalog: '目录同步', backfill: '增量回填', rename: '重写名字', heat: '热度回填', discover: '发现队列',
  images: '图片预取', sonkwo: '杉果', itad: 'ITAD', gog: 'GOG', humble: 'Humble', alerts: '到价提醒',
  prune: '清理', backup: '备份', logs: '日志清理', report: '静态页', readmodel: '读模型对账', 'proxy-probe': '代理探测',
};
const jobLabel = (n) => JOB_LABELS[n] || n || '—';
const visibleRuns = computed(() => (showAllRuns.value ? syncRuns.value : syncRuns.value.slice(0, 5)));
function jobState(j) {
  if (j.running) return 'idle';
  if (j.openUntil) return 'failed';
  if (j.lastResult === 'ok') return 'ok';
  if (j.lastResult === 'failed') return 'failed';
  return 'idle';
}
function jobStateText(j) {
  if (j.running) return '运行中';
  if (j.openUntil) return '熔断至 ' + dateTime(j.openUntil);
  if (j.lastResult === 'ok') return '成功';
  if (j.lastResult === 'failed') return '失败';
  return j.lastRunAt ? '待运行' : '未运行';
}
function fmtDur(ms) {
  const v = Number(ms);
  if (!Number.isFinite(v) || v < 0) return '—';
  if (v < 1000) return Math.round(v) + ' ms';
  if (v < 60000) return (v / 1000).toFixed(1) + ' 秒';
  const m = Math.floor(v / 60000), s = Math.round((v % 60000) / 1000);
  return m + ' 分 ' + s + ' 秒';
}
function nextRunText(j) {
  if (!j.nextRunAt) return '—';
  const ms = new Date(j.nextRunAt).getTime() - Date.now();
  if (!Number.isFinite(ms)) return '—';
  if (ms <= 0) return '即将';
  const min = Math.round(ms / 60000);
  if (min < 60) return min + ' 分后';
  const h = Math.round(min / 60);
  return h < 24 ? h + ' 小时' : Math.round(h / 24) + ' 天';
}
async function loadHealth() {
  loading.health = true;
  try {
    const d = await api('/api/admin/sync/status');
    jobs.value = d.schedule && Array.isArray(d.schedule.jobs) ? d.schedule.jobs : [];
  } catch (e) { notify(e); } finally { loading.health = false; }
}
function toggleJobFilter(name) {
  if (jobFilter.value === name) return clearJobFilter();
  jobFilter.value = name;
  logQuery.value = name;
  loadLogs();
}
function clearJobFilter() { jobFilter.value = ''; logQuery.value = ''; loadLogs(); }
function runResult(row) {
  const parts = [];
  if (row.ok != null) parts.push('成功 ' + row.ok);
  if (row.skipped != null) parts.push('跳过 ' + row.skipped);
  if (row.failed != null) parts.push('失败 ' + row.failed);
  return parts.length ? parts.join(' / ') : '—';
}
function logBrief(entry) {
  return Object.entries(entry)
    .filter(([k]) => !['ts', 'time', 'level', 'event', 'msg'].includes(k))
    .map(([k, v]) => k + '=' + (typeof v === 'object' ? JSON.stringify(v) : String(v)))
    .join('  ');
}
function toggleLogExpanded(i) {
  const next = new Set(expandedLogs.value);
  if (next.has(i)) next.delete(i); else next.add(i);
  expandedLogs.value = next;
}
// 10 秒轮询：只在「运行与同步」tab 打开时跑（规格 Q3）
const timer = setInterval(() => {
  if (activeTab.value === 'run' && autoLogs.value && !document.hidden) loadLogs();
}, 10000);
// BA 批：任务健康条每 60 秒刷新一次（只在页面可见且当前是运行与同步 tab）
const healthTimer = setInterval(() => {
  if (activeTab.value === 'run' && !document.hidden) loadHealth();
}, 60000);

onMounted(() => {
  if (!loaded[activeTab.value]) loadTab(activeTab.value);
});
onBeforeUnmount(() => {
  clearInterval(timer);
  clearInterval(healthTimer);
  if (mobileQuery) { if (mobileQuery.removeEventListener) mobileQuery.removeEventListener('change', onMobileChange); else mobileQuery.removeListener(onMobileChange); }
});
</script>

<style scoped>
.logs-wrap{display:flex;flex-direction:column;gap:14px;min-width:0;padding-bottom:24px}
.logs-tabs{background:transparent}
.module-card{background:var(--panel);border:1px solid var(--border);border-radius:13px;padding:16px;box-shadow:0 3px 14px #26345a06;min-width:0}
.module-card.table-card{padding:0;overflow:hidden}
.filterbar{display:flex;gap:9px;align-items:center;flex-wrap:wrap}
.filterbar>.el-input{flex:1 1 230px;max-width:340px}
.tab-count{display:inline-block;margin-left:6px;padding:0 7px;border-radius:9px;background:var(--brand-soft);color:var(--brand);font-size:11px;line-height:18px}
.notice-card{border:1px solid var(--border);border-radius:12px;padding:12px 14px;background:var(--panel)}
.notice-card strong{font-size:13px}
.notice-card p{margin:4px 0 0;font-size:12px;color:var(--fg-muted)}
.card-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
.card-heading.padded{padding:14px 16px;border-bottom:1px solid var(--border)}
.card-heading h3{margin:0;font-size:14px}
.card-heading p{margin:4px 0 0;font-size:12px;color:var(--fg-muted)}
.log-filters{display:flex;gap:9px;align-items:center;flex-wrap:wrap}
.log-filters>.el-select{width:150px}
.log-filters>.el-input{flex:1 1 220px;max-width:340px}
.log-summary{display:flex;gap:10px;align-items:center;font-size:12px;color:var(--fg-muted)}
.log-summary strong{color:var(--fg)}
.log-list{display:flex;flex-direction:column;gap:6px}
.log-entry{border:1px solid var(--border);border-radius:10px;padding:10px 12px;background:var(--panel);display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:12px}
.log-entry.error{border-color:var(--danger)}
.log-entry time{color:var(--fg-muted);font-size:11px}
.log-entry pre{margin:4px 0 0;width:100%;font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--fg-muted);white-space:pre-wrap;word-break:break-all}
.steam-log-cell strong{display:block;font-size:12px}
.steam-log-cell small{display:block;font-size:10px;color:var(--fg-muted);margin-top:2px}
.mail-body{white-space:pre-wrap;word-break:break-all;max-height:50vh;overflow:auto;background:var(--bg);padding:12px;border-radius:8px}
.muted{color:var(--fg-muted);font-size:12px}
.text-danger{color:var(--danger)}
.bulk-op-keys{display:flex;flex-wrap:wrap;gap:4px;max-height:180px;overflow:auto}
.tag-gap{margin:2px}
.mail-log-tabs :deep(.el-tabs__header){margin:0 14px}
.mail-log-tabs :deep(.el-tab-pane){padding:0 14px 8px}
/* BA 批（docs/RUN-SYNC-REDESIGN.md）：任务健康条 + 记录精简 + 固定高度日志面板 */
.health-bar{display:flex;flex-direction:column;gap:10px}
.health-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
.health-head h3{margin:0;font-size:14px}
.health-head p{margin:4px 0 0;font-size:12px;color:var(--fg-muted)}
.health-chips{display:flex;gap:8px;flex-wrap:wrap}
.health-chip{display:flex;align-items:center;gap:8px;border:1px solid var(--border);background:var(--panel-2);border-radius:10px;padding:7px 10px;font-size:12px;color:var(--fg-2);cursor:pointer;font:inherit}
.health-chip:hover{border-color:var(--brand)}
.health-chip.on{border-color:var(--brand);background:var(--brand-soft)}
.health-chip .dot{width:7px;height:7px;border-radius:50%;background:var(--fg-subtle);flex:none}
.health-chip.ok .dot{background:var(--success)}
.health-chip.failed .dot{background:var(--danger)}
.health-chip .chip-state{color:var(--fg-muted);font-size:11px}
.health-chip .chip-next{color:var(--fg-subtle);font-size:11px}
.heading-actions{display:flex;gap:6px;align-items:center}
.log-panel{display:flex;flex-direction:column;padding:0;overflow:hidden}
.log-panel-head{position:sticky;top:0;z-index:2;background:var(--panel);border-bottom:1px solid var(--border);padding:12px 14px;display:flex;flex-direction:column;gap:8px}
.log-meta{display:flex;gap:10px;align-items:center;font-size:12px;color:var(--fg-muted)}
.log-meta strong{color:var(--fg)}
.log-panel-body{max-height:55vh;overflow-y:auto;padding:8px 12px;display:flex;flex-direction:column;gap:4px}
.log-line{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;border:1px solid transparent;font-size:12px;cursor:pointer;min-width:0;flex-wrap:wrap}
.log-line:hover{background:var(--panel-2)}
.log-line.error,.log-line.fatal{border-color:var(--danger-bg);background:var(--danger-bg)}
.log-line time{color:var(--fg-muted);font-size:11px;flex:none}
.log-line .log-event{font-size:12px;color:var(--fg-2);flex:none}
.log-line .log-brief{color:var(--fg-muted);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}
.log-line .log-full{width:100%;margin:4px 0 0;font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--fg-muted);white-space:pre-wrap;word-break:break-all}
.log-panel-foot{border-top:1px solid var(--border);padding:6px 12px}
@media (max-width:760px){.log-panel-body{max-height:50vh}.health-chips{flex-wrap:nowrap;overflow-x:auto;padding-bottom:4px}.log-line .log-brief{white-space:normal}}</style>
