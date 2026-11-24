<template>
  <!-- DT-2（docs/ADMIN-PERMISSIONS.md）：普通用户版 Console 页面（4 个数据页 + 个人资料由 Console 直接渲染 ProfilePage）。
       数据源全部用户级接口：会话 /api/me/sessions*、到价提醒 /api/watchlist、
       愿望单 /api/me/wishlist、公告 /api/announcements；管理员页面保持 admin 接口（不走本组件）。 -->
  <div class="user-sections-wrap" :class="{ 'm-console': isMobile }">
    <!-- 登录会话（我的设备） -->
    <template v-if="section === 'sessions'">
      <div class="module-card">
        <div class="card-heading">
          <div>
            <h3>登录会话（我的设备）</h3>
            <p>我登录过的设备；撤销后该设备下一次请求即退出登录。</p>
          </div>
          <el-button size="small" @click="loadSessions">刷新</el-button>
        </div>
        <el-table v-if="!isMobile" :data="sessions" size="small" v-loading="sessLoading">
          <el-table-column label="设备 / 浏览器" min-width="180" show-overflow-tooltip>
            <template #default="{ row }"><span class="sess-ua">{{ uaShort(row.userAgent) }}</span><small v-if="row.deviceId" class="muted"> · {{ row.deviceId.slice(0, 10) }}…</small></template>
          </el-table-column>
          <el-table-column label="IP / 归属地" min-width="150">
            <template #default="{ row }"><span class="mono">{{ row.ip || '—' }}</span><small v-if="row.region" class="muted"> · {{ row.region }}</small></template>
          </el-table-column>
          <el-table-column label="登录时间" min-width="150"><template #default="{ row }">{{ fmtDateTime(row.createdAt) }}</template></el-table-column>
          <el-table-column label="最近活动" min-width="150"><template #default="{ row }">{{ fmtDateTime(row.lastSeenAt) }}</template></el-table-column>
          <el-table-column label="到期时间" min-width="150"><template #default="{ row }">{{ fmtDateTime(row.expiresAt) }}</template></el-table-column>
          <el-table-column label="状态" width="92"><template #default="{ row }"><el-tag v-if="row.current" type="success" size="small">当前会话</el-tag><span v-else class="muted">—</span></template></el-table-column>
          <el-table-column label="操作" width="84" fixed="right"><template #default="{ row }"><el-button v-if="!row.current" link type="danger" @click="revokeSession(row)">撤销</el-button></template></el-table-column>
        </el-table>
        <div v-else class="game-card-list">
          <div v-for="s in sessions" :key="s.id" class="admin-card">
            <div class="admin-card-main">
              <strong>{{ uaShort(s.userAgent) }}<el-tag v-if="s.current" type="success" size="small" class="tag-gap">当前会话</el-tag></strong>
              <small>{{ s.ip || '—' }}<template v-if="s.region"> · {{ s.region }}</template></small>
              <small class="muted">登录 {{ fmtDateTime(s.createdAt) }} · 最近活动 {{ fmtDateTime(s.lastSeenAt) }} · 到期 {{ fmtDateTime(s.expiresAt) }}</small>
            </div>
            <div class="admin-card-actions"><el-button v-if="!s.current" link type="danger" @click="revokeSession(s)">撤销</el-button></div>
          </div>
        </div>
        <el-empty v-if="!sessLoading && !sessions.length" description="当前没有在线会话" :image-size="64" />
      </div>
    </template>

    <!-- 我的到价提醒 -->
    <template v-else-if="section === 'watchlist'">
      <div class="module-card">
        <div class="card-heading">
          <div>
            <h3>我的到价提醒</h3>
            <p>我设置的到价提醒；目标价留空时按历史最低价提醒。添加/修改目标价请到游戏详情页。</p>
          </div>
          <el-button size="small" @click="loadWatches">刷新</el-button>
        </div>
        <el-table v-if="!isMobile" :data="watches" size="small" v-loading="watchLoading">
          <el-table-column label="游戏" min-width="200"><template #default="{ row }"><button class="game-name" @click="openGame(row)">{{ row.name }}</button></template></el-table-column>
          <el-table-column label="当前价" width="110"><template #default="{ row }">{{ money(row.current_cents, row.currency) }}</template></el-table-column>
          <el-table-column label="目标价" width="130"><template #default="{ row }"><span v-if="row.target_cents != null">{{ money(row.target_cents, row.currency) }}</span><span v-else class="muted">史低提醒</span></template></el-table-column>
          <el-table-column label="备注" min-width="160" show-overflow-tooltip><template #default="{ row }">{{ row.note || '—' }}</template></el-table-column>
          <el-table-column label="创建时间" min-width="150"><template #default="{ row }">{{ fmtDateTime(row.created_at) }}</template></el-table-column>
          <el-table-column label="操作" width="84" fixed="right"><template #default="{ row }"><el-button link type="danger" @click="removeWatch(row)">取消提醒</el-button></template></el-table-column>
        </el-table>
        <div v-else class="game-card-list">
          <div v-for="w in watches" :key="w.id" class="admin-card">
            <div class="admin-card-main">
              <strong><button class="game-name" @click="openGame(w)">{{ w.name }}</button></strong>
              <small>当前 {{ money(w.current_cents, w.currency) }} · 目标 <template v-if="w.target_cents != null">{{ money(w.target_cents, w.currency) }}</template><template v-else>史低提醒</template></small>
              <small class="muted">{{ w.note || '—' }}</small>
            </div>
            <div class="admin-card-actions"><el-button link type="danger" @click="removeWatch(w)">取消提醒</el-button></div>
          </div>
        </div>
        <el-empty v-if="!watchLoading && !watches.length" description="还没有到价提醒。在游戏详情页设置目标价，降价第一时间知道。" :image-size="64" />
      </div>
    </template>

    <!-- 我的愿望单 -->
    <template v-else-if="section === 'wishlist'">
      <div class="module-card">
        <div class="card-heading">
          <div>
            <h3>我的愿望单</h3>
            <p>我收藏的愿望单游戏：本站手动添加 + 已绑定 Steam 账号导入（Steam 行只读）。</p>
          </div>
          <div class="wish-actions"><el-input v-model="wishQuery" placeholder="搜索游戏名 / AppID" clearable size="small" style="width: 200px" @keyup.enter="loadWishlist(1)" @clear="loadWishlist(1)" /><el-button size="small" @click="loadWishlist(1)">搜索</el-button></div>
        </div>
        <el-table v-if="!isMobile" :data="wishItems" size="small" v-loading="wishLoading">
          <el-table-column label="游戏" min-width="220"><template #default="{ row }"><button class="game-name" @click="openGameById(row.game_id)">{{ row.name }}</button></template></el-table-column>
          <el-table-column label="AppID" width="110"><template #default="{ row }">{{ row.steam_appid || '—' }}</template></el-table-column>
          <!-- EY（docs/MY-WISHLIST-MERGED.md §2-2）：来源列——本站 / Steam / 本站 + Steam；Steam-only 标「只读」 -->
          <el-table-column label="来源" width="150"><template #default="{ row }"><span v-if="wishHasSite(row)" class="tag-site">本站</span><span v-if="wishHasSite(row) && wishHasSteam(row)" class="wish-src-plus">+</span><span v-if="wishHasSteam(row)" class="tag-steam">Steam</span><span v-if="!wishHasSite(row)" class="tag-readonly">只读</span></template></el-table-column>
          <el-table-column label="Steam 账号" min-width="170"><template #default="{ row }"><div v-if="wishAccts(row).length" class="wish-acct"><span v-for="name in wishAccts(row).slice(0, 2)" :key="name" class="acct-chip"><span class="acct-avatar">{{ name.slice(0, 1).toUpperCase() }}</span><span class="acct-name">{{ name }}</span></span><span v-if="wishAccts(row).length === 1" class="tag-steam">导入</span><span v-if="wishAccts(row).length > 2" class="tag-more">+{{ wishAccts(row).length - 2 }}</span></div><span v-else class="muted">本站添加（无 Steam 来源）</span></template></el-table-column>
          <el-table-column label="当前价" width="110"><template #default="{ row }">{{ money(row.current_low, 'CNY') }}</template></el-table-column>
          <el-table-column label="史低" width="110"><template #default="{ row }">{{ money(row.hist_low, 'CNY') }}</template></el-table-column>
          <el-table-column label="加入时间" min-width="150"><template #default="{ row }">{{ fmtDateTime(row.created_at) }}</template></el-table-column>
          <!-- EY §2-2：移除按钮仅本站行显示；Steam-only 行只读（没有任何操作按钮） -->
          <el-table-column label="操作" width="132" fixed="right"><template #default="{ row }"><el-button v-if="wishHasSite(row)" link type="danger" @click="removeWish(row)">移除</el-button><span v-else class="wish-readonly">Steam 导入（只读）</span></template></el-table-column>
        </el-table>
        <div v-else class="game-card-list">
          <div v-for="w in wishItems" :key="w.game_id" class="admin-card">
            <div class="admin-card-main">
              <strong><button class="game-name" @click="openGameById(w.game_id)">{{ w.name }}</button></strong>
              <small>当前 {{ money(w.current_low, 'CNY') }} · 史低 {{ money(w.hist_low, 'CNY') }}</small>
              <small class="wish-src-line">来源：{{ wishSourceLabel(w) }}</small>
              <small class="wish-acct-line">Steam 账号：{{ wishAcctLine(w) }}</small>
              <small class="muted">加入于 {{ fmtDateTime(w.created_at) }}</small>
            </div>
            <div class="admin-card-actions"><el-button v-if="wishHasSite(w)" link type="danger" @click="removeWish(w)">移除</el-button><small v-else class="wish-readonly">Steam 导入（只读）</small></div>
          </div>
        </div>
        <el-empty v-if="!wishLoading && !wishItems.length" description="愿望单是空的。去前台逛一逛，把想玩的游戏加入愿望单；已绑定 Steam 账号导入的愿望单也会显示在这里。" :image-size="64" />
        <div v-if="wishTotal > wishPageSize" class="wish-pager"><el-pagination layout="prev, pager, next" :total="wishTotal" :page-size="wishPageSize" :current-page="wishPage" @current-change="loadWishlist" /></div>
      </div>
    </template>

    <!-- 站点公告（只读） -->
    <template v-else-if="section === 'announcements'">
      <div class="module-card">
        <div class="card-heading">
          <div>
            <h3>站点公告</h3>
            <p>站点发布的通知公告（只读）。</p>
          </div>
          <div class="wish-actions"><el-button size="small" :disabled="!unreadIds.length" @click="markAllRead">全部标记已读</el-button></div>
        </div>
        <div v-if="!notices.length && !noticeLoading" class="muted">暂无公告。</div>
        <div v-for="n in notices" :key="n.id" class="notice-row" :class="{ unread: !readIds.includes(Number(n.id)) }">
          <div class="notice-head"><el-tag :type="levelType(n.level)" size="small">{{ levelLabel(n.level) }}</el-tag><strong>{{ n.title }}</strong><span class="muted">发布于 {{ fmtDateTime(n.startsAt) }}</span></div>
          <p class="notice-body">{{ n.body }}</p>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
// DT-2（docs/ADMIN-PERMISSIONS.md）：普通用户 4 页数据全部走用户级接口。
// 管理员页面保持 admin 接口（Console.vue 按角色渲染 AdminModules/AdminExtras，不进本组件）。
import { computed, onMounted, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { fmtDateTime } from '../utils/siteTime.js';
import { yuanAmount } from '../utils/money.js';

const props = defineProps({ section: { type: String, required: true } });

const isMobile = ref(false);
function applyMobile() {
  if (typeof window === 'undefined') return;
  isMobile.value = Boolean(window.matchMedia && window.matchMedia('(max-width: 768px)').matches);
}

async function api(path, options = {}) {
  const res = await fetch(path, { credentials: 'same-origin', ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* 忽略 */ }
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
}

function uaShort(ua) {
  const s = String(ua ?? '');
  if (!s) return '未知设备';
  const m = s.match(/\(([^)]+)\)/);
  const browser = (s.match(/(?:Chrome|Firefox|Edg|Safari)\/[\d.]+/) || [])[0] || '';
  return m ? `${m[1].split(';').slice(-1)[0]?.trim() || s.slice(0, 40)}${browser ? ' · ' + browser.split('/')[0] : ''}` : s.slice(0, 60);
}
function money(cents, currency) {
  if (cents == null) return '—';
  const symbols = { CNY: '¥', USD: '$', HKD: 'HK$', TWD: 'NT$', JPY: '¥', RUB: '₽', TRY: '₺', ARS: '$' };
  return `${symbols[currency] || currency + ' '}${yuanAmount(cents)}`;
}
function levelLabel(level) { return ({ critical: '重要', warning: '提醒', info: '通知' })[level] || '通知'; }
function levelType(level) { return ({ critical: 'danger', warning: 'warning', info: 'info' })[level] || 'info'; }
function openGame(row) { if (row.steam_appid) window.open(`/?game=${row.steam_appid}`, '_self'); }
function openGameById(gameId) { if (gameId) window.open(`/?game=${gameId}`, '_self'); }
// EW（docs/WISHLIST-STEAM-ACCOUNT.md §7）：愿望单行的 Steam 账号（接口 steam_accounts 数组，只读展示）——
// 桌面列（头像首字母 + 名字并排、单账号带「导入」、>2 折叠 +N）；移动行「Steam 账号：…（+N）」；
// 无来源显示「本站添加（无 Steam 来源）」。防御：接口缺字段/非数组一律按空处理。
function wishAccts(row) { return Array.isArray(row.steam_accounts) ? row.steam_accounts : []; }
function wishAcctLine(row) {
  const accts = wishAccts(row);
  if (!accts.length) return '本站添加（无 Steam 来源）';
  if (accts.length > 2) return `${accts.slice(0, 2).join('、')}（+${accts.length - 2}）`;
  return accts.join('、');
}
// EY（docs/MY-WISHLIST-MERGED.md §2-2/§3）：合并视图行语义——sources 决定来源标注与可操作性：
//   ['site'] → 本站（可移除）；['steam'] → Steam 导入（只读、无任何操作按钮）；
//   ['site','steam'] → 本站 + Steam（移除只删本站，Steam 侧不受影响）。
// 防御：旧接口没有 sources 字段时按「有 id/site_wishlist_id 即本站行、有账号即 Steam 行」回退。
function wishHasSite(row) {
  if (Array.isArray(row.sources)) return row.sources.includes('site');
  return row.site_wishlist_id != null || row.id != null;
}
function wishHasSteam(row) {
  if (Array.isArray(row.sources)) return row.sources.includes('steam');
  return wishAccts(row).length > 0;
}
function wishSourceLabel(row) {
  const site = wishHasSite(row);
  const steam = wishHasSteam(row);
  if (site && steam) return '本站 + Steam';
  return site ? '本站' : 'Steam';
}

// ---- 登录会话（我的设备）：/api/me/sessions* ----
const sessions = ref([]);
const sessLoading = ref(false);
async function loadSessions() {
  sessLoading.value = true;
  try {
    const d = await api('/api/me/sessions?limit=200');
    sessions.value = d.sessions || [];
  } catch (e) {
    sessions.value = [];
    ElMessage.error(e.message);
  } finally {
    sessLoading.value = false;
  }
}
async function revokeSession(row) {
  try {
    await ElMessageBox.confirm(`撤销「${uaShort(row.userAgent)}」的登录？该设备下一次请求即退出登录。`, '撤销登录会话', { type: 'warning' });
    await api(`/api/me/sessions/${row.id}/revoke`, { method: 'POST', body: '{}' });
    ElMessage.success('已撤销');
    await loadSessions();
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(e.message);
  }
}

// ---- 我的到价提醒：/api/watchlist ----
const watches = ref([]);
const watchLoading = ref(false);
async function loadWatches() {
  watchLoading.value = true;
  try {
    const d = await api('/api/watchlist');
    watches.value = Array.isArray(d.watches) ? d.watches : [];
  } catch (e) {
    watches.value = [];
    ElMessage.error(e.message);
  } finally {
    watchLoading.value = false;
  }
}
async function removeWatch(row) {
  try {
    await ElMessageBox.confirm(`取消对「${row.name}」的到价提醒？`, '取消提醒', { type: 'warning' });
    await api(`/api/watchlist/${row.game_id}`, { method: 'DELETE' });
    ElMessage.success('提醒已取消');
    await loadWatches();
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(e.message);
  }
}

// ---- 我的愿望单：/api/me/wishlist + DELETE /api/wishlist/id/:gameId ----
const wishItems = ref([]);
const wishTotal = ref(0);
const wishPage = ref(1);
const wishPageSize = 20;
const wishQuery = ref('');
const wishLoading = ref(false);
async function loadWishlist(page = 1) {
  wishLoading.value = true;
  try {
    const p = new URLSearchParams({ limit: String(wishPageSize), offset: String((page - 1) * wishPageSize) });
    if (wishQuery.value.trim()) p.set('q', wishQuery.value.trim());
    const d = await api(`/api/me/wishlist?${p}`);
    wishItems.value = d.items || [];
    wishTotal.value = Number(d.total) || 0;
    wishPage.value = page;
  } catch (e) {
    wishItems.value = [];
    ElMessage.error(e.message);
  } finally {
    wishLoading.value = false;
  }
}
async function removeWish(row) {
  try {
    // EY §2-2：合并行移除只删本站记录，Steam 愿望单（只读导入）不受影响——确认框写明。
    const extra = wishHasSteam(row) ? '（Steam 愿望单不受影响）' : '';
    await ElMessageBox.confirm(`把「${row.name}」移出本站愿望单？${extra}`, '移除愿望单', { type: 'warning' });
    await api(`/api/wishlist/id/${row.game_id}`, { method: 'DELETE' });
    ElMessage.success('已移出愿望单');
    await loadWishlist(wishPage.value);
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(e.message);
  }
}

// ---- 站点公告：/api/announcements + POST /api/announcements/read ----
const notices = ref([]);
const readIds = ref([]);
const noticeLoading = ref(false);
const unreadIds = computed(() => notices.value.map((n) => Number(n.id)).filter((id) => !readIds.value.includes(id)));
async function loadNotices() {
  noticeLoading.value = true;
  try {
    const d = await api('/api/announcements');
    notices.value = d.announcements || [];
    readIds.value = (d.readIds || []).map(Number);
  } catch (e) {
    notices.value = [];
    ElMessage.error(e.message);
  } finally {
    noticeLoading.value = false;
  }
}
async function markAllRead() {
  try {
    const ids = unreadIds.value;
    if (!ids.length) return;
    await api('/api/announcements/read', { method: 'POST', body: JSON.stringify({ ids }) });
    readIds.value = [...new Set([...readIds.value, ...ids])];
    ElMessage.success('已标记为已读');
  } catch (e) {
    ElMessage.error(e.message);
  }
}

watch(() => props.section, (s) => {
  if (s === 'sessions') loadSessions();
  else if (s === 'watchlist') loadWatches();
  else if (s === 'wishlist') loadWishlist(1);
  else if (s === 'announcements') loadNotices();
});
onMounted(() => {
  applyMobile();
  if (typeof window !== 'undefined' && window.matchMedia) {
    const mq = window.matchMedia('(max-width: 768px)');
    const on = () => applyMobile();
    mq.addEventListener ? mq.addEventListener('change', on) : mq.addListener(on);
  }
  const s = props.section;
  if (s === 'sessions') loadSessions();
  else if (s === 'watchlist') loadWatches();
  else if (s === 'wishlist') loadWishlist(1);
  else if (s === 'announcements') loadNotices();
});
</script>

<style scoped>
.user-sections-wrap{display:flex;flex-direction:column;gap:var(--space-14);padding-bottom:var(--space-24);min-width:0}
.module-card{background:var(--panel);border:1px solid var(--border);border-radius:var(--radius-13);padding:var(--space-16);box-shadow:0 3px 14px #26345a06;min-width:0}
.card-heading{display:flex;align-items:center;justify-content:space-between;gap:var(--space-12);margin-bottom:13px}
.card-heading h3{font-size:var(--font-14);margin:0;color:var(--fg)}
.card-heading p{font-size:var(--font-11);color:var(--fg-muted);margin:var(--space-4) 0 0}
.wish-actions{display:flex;gap:var(--space-8);align-items:center;flex:none}
.sess-ua{font-size:var(--font-12)}
.mono{font-family:ui-monospace,Consolas,monospace;font-size:var(--font-12)}
.game-name{border:0;background:transparent;color:var(--brand);cursor:pointer;font-size:var(--font-12);padding:0;text-align:left}
.game-card-list{display:flex;flex-direction:column;gap:var(--space-8)}
.admin-card{border:1px solid var(--border-2);border-radius:var(--radius-10);padding:var(--space-10) var(--space-12);display:flex;justify-content:space-between;gap:var(--space-10);background:var(--panel-2)}
.admin-card-main{display:flex;flex-direction:column;gap:var(--space-4);min-width:0}
.admin-card-main strong{font-size:var(--font-13);display:flex;align-items:center;gap:var(--space-6)}
.admin-card-main small{font-size:var(--font-11);color:var(--fg-muted)}
.admin-card-actions{display:flex;align-items:center;gap:var(--space-6);flex:none}
.notice-row{border:1px solid var(--border-2);border-radius:var(--radius-10);padding:var(--space-12);margin-bottom:var(--space-10)}
.notice-row.unread{border-color:var(--brand-soft);background:var(--brand-soft)}
.notice-head{display:flex;align-items:center;gap:var(--space-8);font-size:var(--font-13)}
.notice-head .muted{margin-left:auto;font-size:var(--font-11)}
.notice-body{font-size:var(--font-12);color:var(--fg-muted);margin:var(--space-8) 0 0;white-space:pre-wrap}
.wish-pager{display:flex;justify-content:flex-end;margin-top:var(--space-12)}
/* EW（docs/WISHLIST-STEAM-ACCOUNT.md §7）：Steam 账号列（demo 对齐：头像首字母 + 名字并排、导入/折叠小标签） */
.wish-acct{display:flex;align-items:center;gap:var(--space-6);flex-wrap:wrap}
.acct-chip{display:inline-flex;align-items:center;gap:var(--space-4);white-space:nowrap}
.acct-avatar{width:18px;height:18px;border-radius:5px;background:var(--brand-soft);border:1px solid var(--border-2);display:inline-flex;align-items:center;justify-content:center;font-size:10px;color:var(--brand);flex:none}
.acct-name{font-size:var(--font-12);color:var(--fg)}
.tag-steam,.tag-more{font-size:10px;color:var(--fg-muted);border:1px solid var(--border-2);border-radius:999px;padding:1px 6px;white-space:nowrap;background:var(--panel-2)}
/* EY（docs/MY-WISHLIST-MERGED.md §2-2）：合并视图来源标记 + Steam-only 行只读提示 */
.tag-site{font-size:10px;color:var(--brand);border:1px solid var(--brand-soft);border-radius:999px;padding:1px 6px;white-space:nowrap;background:var(--brand-soft)}
.tag-readonly{font-size:10px;color:var(--fg-muted);border:1px dashed var(--border-2);border-radius:999px;padding:1px 6px;white-space:nowrap}
.wish-src-plus{font-size:10px;color:var(--fg-muted);padding:0 2px}
.wish-src-line{color:var(--fg-muted)}
.wish-readonly{font-size:var(--font-11);color:var(--fg-muted);white-space:nowrap}
.wish-acct-line{color:var(--brand)}
@media (max-width: 768px){
  .card-heading{flex-direction:column;align-items:flex-start}
  .wish-actions{width:100%}
  .wish-actions .el-input{width:100%!important;flex:1}
}
</style>
