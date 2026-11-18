<template>
  <div class="profile-wrap" :class="{ 'm-console': isMobile }">
    <!-- 基本信息 -->
    <section class="module-card">
      <div class="card-heading">
        <div>
          <h3>基本信息</h3>
          <p>带 <span class="req">*</span> 为必填 · 管理员昵称/简介可空</p>
        </div>
      </div>
      <div class="profile-body">
        <div class="avatar-row">
          <div class="avatar-box" @click="pickFile">
            <img v-if="avatarImgUrl" :src="avatarImgUrl" alt="头像" />
            <span v-else class="avatar-letter">{{ initial }}</span>
            <span class="avatar-edit">✎</span>
          </div>
          <div class="avatar-side">
            <div class="avatar-actions">
              <el-button size="small" @click="pickFile">更换头像</el-button>
              <el-button size="small" :disabled="!avatarSource" @click="removeAvatar">移除</el-button>
            </div>
            <p class="hint">JPG/PNG/WebP ≤512KB，客户端自动裁剪 256×256</p>
            <p class="hint">默认头像（已绑 {{ accounts.length }} 个 Steam 账号，可选其一或自定义上传）：</p>
            <div class="avatar-opts">
              <button
                v-for="a in accounts"
                :key="a.steamId"
                type="button"
                class="avopt"
                :class="{ on: avatarSource === 'steam:' + a.steamId }"
                @click="chooseSteamAvatar(a)"
              >
                <span class="dot">{{ (a.name || 'S').slice(0, 1).toUpperCase() }}</span>Steam · {{ a.name }}
              </button>
              <button type="button" class="avopt" :class="{ on: avatarSource === 'custom' }" @click="pickFile">
                <span class="dot">↑</span>自定义上传
              </button>
            </div>
            <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp,image/gif" class="hidden-input" @change="onFilePicked" />
          </div>
        </div>
        <div class="grid2">
          <div class="field">
            <label>昵称<span class="req" v-if="!isAdmin">*</span></label>
            <el-input v-model="form.displayName" :maxlength="20" placeholder="2–20 个字符" />
            <div class="hint">2–20 个字符{{ isAdmin ? '（管理员可留空）' : '' }}</div>
          </div>
          <div class="field">
            <label>邮箱<span class="req">*</span></label>
            <div class="ro-input">
              <span>{{ me?.email || '未绑定' }}</span>
              <el-tag v-if="me?.email" :type="me?.emailVerified ? 'success' : 'warning'" size="small" class="tag-gap">已验证</el-tag>
            </div>
            <div class="hint">只读；更换邮箱（二期）需验证码</div>
          </div>
          <div class="field">
            <label>用户名（登录名）</label>
            <div class="ro-input muted">{{ me?.username }}</div>
            <div class="hint">不可修改</div>
          </div>
          <div class="field">
            <label>角色 / 注册时间</label>
            <div class="ro-input muted">{{ roleLabel }} · {{ fmtDateTime(me?.createdAt) }}</div>
            <div class="hint">角色由所有者分配</div>
          </div>
        </div>
        <div class="field bio-field">
          <label>个人简介<span class="req" v-if="!isAdmin">*</span></label>
          <el-input v-model="form.bio" type="textarea" :rows="3" :maxlength="200" show-word-limit placeholder="介绍一下自己（{{ isAdmin ? '可选' : '1–200 字' }}）" />
        </div>
      </div>
    </section>

    <!-- Steam 绑定账号 -->
    <section class="module-card">
      <div class="card-heading">
        <div>
          <h3>Steam 绑定账号</h3>
          <p>可解绑 / 新增 / 更换 · 共 {{ accounts.length }} 个</p>
        </div>
        <el-button size="small" @click="bindNew">＋ 绑定新的 Steam 账号</el-button>
      </div>
      <div class="steam-list">
        <div v-for="a in accounts" :key="a.steamId" class="steam-row">
          <span class="sav">{{ (a.name || 'S').slice(0, 1).toUpperCase() }}</span>
          <div class="name">
            <b>{{ a.name }}</b>
            <span v-if="a.isDefault" class="def">默认</span>
            <div class="id">SteamID {{ a.steamId.slice(0, 8) }}…{{ a.steamId.slice(-4) }} · 绑定于 {{ fmtDay(a.boundAt) }}</div>
          </div>
          <div class="ops">
            <el-button size="small" :disabled="a.isDefault" @click="setDefault(a)">设为默认</el-button>
            <el-button size="small" type="danger" plain @click="unbind(a)">解绑</el-button>
          </div>
        </div>
        <el-empty v-if="!accounts.length" description="还没有绑定 Steam 账号" :image-size="56" />
      </div>
      <p class="hint pad">解绑只停止后续检测，历史「曾拥有」记录保留。已拥有游戏的展示以当前绑定账号为准。</p>
    </section>

    <!-- 偏好与通知 -->
    <section class="module-card">
      <div class="card-heading">
        <div>
          <h3>偏好与通知</h3>
        </div>
      </div>
      <div class="grid2">
        <div class="field">
          <label>主题</label>
          <el-select v-model="form.theme" style="width: 100%">
            <el-option label="跟随系统" value="system" />
            <el-option label="深色" value="dark" />
            <el-option label="浅色" value="light" />
          </el-select>
        </div>
        <div class="field">
          <label>到价提醒邮件</label>
          <div class="switch-row">
            <el-switch v-model="form.emailAlerts" />
            <span>{{ form.emailAlerts ? '开启' : '关闭' }}</span>
          </div>
          <div class="hint">只影响发给你的提醒邮件；关闭后不再投递到价提醒邮件</div>
        </div>
      </div>
    </section>

    <!-- 我的游戏库（仅本人） -->
    <section class="module-card">
      <div class="card-heading">
        <div>
          <h3>我的游戏库</h3>
          <p>{{ accounts.length }} 个 Steam 账号 · 每账号一张卡 · 仅本人可见</p>
        </div>
      </div>
      <div v-if="accounts.length" class="grid2">
        <div v-for="a in accounts" :key="a.steamId" class="acct">
          <div class="acct-h">
            <span class="av">{{ (a.name || 'S').slice(0, 1).toUpperCase() }}</span>
            <div>
              <b>{{ a.name }}</b>
              <span v-if="a.isDefault" class="def">默认</span>
              <div class="id">SteamID {{ a.steamId.slice(0, 8) }}…{{ a.steamId.slice(-4) }}</div>
            </div>
          </div>
          <div class="acct-stats">
            <div>已拥有<b>{{ a.owned }}</b></div>
            <div>愿望单<b>{{ a.wishlist }}</b></div>
            <div v-if="!isMobile">最近同步<b class="sync">{{ fmtDateTime(a.lastSyncedAt) }}</b></div>
          </div>
          <div class="acct-ops">
            <el-button size="small" @click="openDialog(a, 'library')">查看已拥有</el-button>
            <el-button size="small" @click="openDialog(a, 'wishlist')">查看愿望单</el-button>
            <el-button size="small" :disabled="a.isDefault" @click="setDefault(a)">设为默认</el-button>
            <el-button size="small" type="danger" plain @click="unbind(a)">解绑</el-button>
          </div>
        </div>
      </div>
      <el-empty v-else description="绑定 Steam 账号并同步后，这里会按账号分别展示游戏库" :image-size="56" />
    </section>

    <!-- 我的统计 -->
    <section class="module-card">
      <div class="card-heading">
        <div>
          <h3>我的统计</h3>
          <p>仅本人可见</p>
        </div>
      </div>
      <div class="statsline">
        <span>已拥有合计 <b>{{ stats.ownedTotal }}</b></span>
        <span>愿望单合计 <b>{{ stats.wishlistTotal }}</b></span>
        <span>本站愿望单 <b>{{ stats.siteWishlist }}</b></span>
        <span>到价提醒 <b>{{ stats.alerts }}</b></span>
        <span>史低命中 <b>{{ stats.histLowHits }}</b></span>
      </div>
    </section>

    <div class="profile-foot">
      <el-button @click="reset">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存修改</el-button>
    </div>

    <!-- 查看已拥有/愿望单弹窗（Web=对话框） -->
    <el-dialog
      v-model="dialog.open"
      :title="`${dialog.name} · 游戏库`"
      width="720px"
      :close-on-click-modal="false"
      class="lib-dialog"
    >
      <div class="d-tag">SteamID {{ dialog.steamId }} · 仅本人可见</div>
      <el-tabs v-model="dialog.tab" class="d-tabs" @tab-change="switchTab">
        <el-tab-pane :label="`已拥有 ${dialog.owned}`" name="library" />
        <el-tab-pane :label="`愿望单 ${dialog.wishlist}`" name="wishlist" />
      </el-tabs>
      <div class="d-toolbar">
        <el-input v-model="dialog.q" clearable placeholder="🔍 搜索游戏名 / AppID" @keyup.enter="loadItems(1)" @clear="loadItems(1)" />
        <el-button @click="loadItems(1)">搜索</el-button>
      </div>
      <div v-loading="dialog.loading" class="d-list">
        <div v-for="g in dialog.items" :key="g.appid" class="grow">
          <img v-if="g.appid" :src="`/img/steam/${g.appid}/capsule_sm_120`" class="gcover" alt="" @error="$event.target.style.display='none'" />
          <div class="gname">
            {{ g.name || ('appid:' + g.appid) }}
            <div class="en">{{ g.name_en || ' ' }}</div>
          </div>
          <div class="gp">
            {{ money(g.current_low) }}
            <s v-if="g.hist_low != null">史低 {{ money(g.hist_low) }}</s>
          </div>
        </div>
        <el-empty v-if="!dialog.loading && !dialog.items.length" description="没有符合条件的游戏" :image-size="56" />
      </div>
      <div class="d-foot">
        <span>共 {{ dialog.total }} 款 · 第 {{ dialog.page }}/{{ Math.max(1, dialog.pages) }} 页</span>
        <el-pagination
          small
          layout="prev, pager, next"
          :total="dialog.total"
          :page-size="dialog.pageSize"
          :current-page="dialog.page"
          @current-change="loadItems"
        />
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
// CX 批（docs/USER-PROFILE-EDIT.md §3）：个人资料页（管理员与普通用户同一套页面，只改自己）。
// 结构对齐 docs/design/profile-web-2026-11-18.html（上半部）+ my-profile-web-2026-11-18.html（下半部 + 弹窗）。
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { fmtDateTime, fmtDay } from '../utils/siteTime.js';
import { formatMoney } from '../utils/money.js';
import { registerUnsavedSource } from '../composables/useUnsavedGuard.js';

const emit = defineEmits(['profile-updated']);

const mobileQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(max-width: 768px)') : null;
const isMobile = ref(Boolean(mobileQuery && mobileQuery.matches));
function onMobileChange(e) {
  isMobile.value = e.matches;
}
if (mobileQuery) {
  if (mobileQuery.addEventListener) mobileQuery.addEventListener('change', onMobileChange);
  else mobileQuery.addListener(onMobileChange);
}
onBeforeUnmount(() => {
  if (mobileQuery) {
    if (mobileQuery.removeEventListener) mobileQuery.removeEventListener('change', onMobileChange);
    else mobileQuery.removeListener(onMobileChange);
  }
});

const me = ref(null);
const prefs = ref(null);
const accounts = ref([]);
const stats = reactive({ ownedTotal: 0, wishlistTotal: 0, siteWishlist: 0, alerts: 0, histLowHits: 0 });
const form = reactive({ displayName: '', bio: '', theme: 'system', emailAlerts: true });
const saving = ref(false);
const fileInput = ref(null);
const dirty = ref(false);

const isAdmin = computed(() => me.value?.role === 'admin');
const initial = computed(() => {
  const s = String(me.value?.displayName || me.value?.username || '').trim();
  return s ? [...s][0].toUpperCase() : 'S';
});
const avatarSource = computed(() => me.value?.avatarSource ?? null);
// 头像图片地址：自定义 → /api/avatar/:id（带 cache-bust）；steam:<id> → /api/avatar 302 到 Steam CDN；空 → 首字
const avatarImgUrl = computed(() => (avatarSource.value ? `/api/avatar/${me.value.id}?v=${encodeURIComponent(me.value.avatarUpdatedAt || '0')}` : null));
const roleLabel = computed(() => (isAdmin.value ? '管理员' : '普通用户'));
const money = (cents) => formatMoney(cents, 'CNY');

async function loadMe() {
  const res = await fetch('/api/me', { credentials: 'same-origin' });
  const data = await res.json();
  me.value = data.user;
  prefs.value = data.prefs;
  if (!dirty.value) {
    form.displayName = data.user?.displayName ?? '';
    form.bio = data.user?.bio ?? '';
    form.theme = data.prefs?.theme || 'system';
    form.emailAlerts = data.prefs?.email_alerts !== false;
  }
  return data;
}

async function loadLibrary() {
  const res = await fetch('/api/me/library', { credentials: 'same-origin' });
  if (!res.ok) return;
  const data = await res.json();
  accounts.value = data.accounts || [];
  Object.assign(stats, data.stats || {});
}

async function load() {
  await Promise.all([loadMe(), loadLibrary()]);
}

function markDirty() {
  dirty.value = true;
}

async function save() {
  saving.value = true;
  try {
    const res = await fetch('/api/me/profile', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        displayName: form.displayName.trim(),
        bio: form.bio.trim(),
        theme: form.theme === 'system' ? null : form.theme,
        emailAlerts: Boolean(form.emailAlerts),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    dirty.value = false;
    ElMessage.success('资料已保存');
    await load();
    emit('profile-updated');
  } catch (e) {
    ElMessage.error(e.message || '保存失败');
  } finally {
    saving.value = false;
  }
}

function reset() {
  dirty.value = false;
  load();
}

function pickFile() {
  fileInput.value?.click();
}

async function onFilePicked(ev) {
  const file = ev.target.files?.[0];
  ev.target.value = '';
  if (!file) return;
  try {
    const dataUrl = await cropToSquare(file, 256);
    if (dataUrl.length > 512 * 1024) throw new Error('裁剪后的头像仍超过 512KB，请换一张图');
    const res = await fetch('/api/me/avatar', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dataUrl }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    ElMessage.success('头像已更新');
    dirty.value = false;
    await load();
    emit('profile-updated');
  } catch (e) {
    ElMessage.error(e.message || '头像上传失败');
  }
}

// 客户端裁剪：cover 居中裁成正方形 → 缩放 256×256 → 导出（PNG/WebP 保留透明度，其余 JPEG）
function cropToSquare(file, size) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const sx = (img.naturalWidth - side) / 2;
        const sy = (img.naturalHeight - side) / 2;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        const isPngLike = /png|gif/i.test(file.type);
        const mime = isPngLike ? 'image/png' : /webp/i.test(file.type) ? 'image/webp' : 'image/jpeg';
        resolve(canvas.toDataURL(mime, 0.9));
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('无法读取这张图片'));
    };
    img.src = url;
  });
}

async function removeAvatar() {
  try {
    await ElMessageBox.confirm('移除当前头像？之后将显示昵称首字，也可以重新选择 Steam 账号或上传自定义头像。', '移除头像', { type: 'warning' });
    const res = await fetch('/api/me/avatar', { method: 'DELETE', credentials: 'same-origin' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    ElMessage.success('头像已移除');
    await load();
    emit('profile-updated');
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(e.message || '移除失败');
  }
}

async function chooseSteamAvatar(a) {
  if (avatarSource.value === 'steam:' + a.steamId) return;
  await setDefault(a);
}

async function setDefault(a) {
  try {
    const res = await fetch(`/api/steam/accounts/${encodeURIComponent(a.steamId)}/default`, { method: 'POST', credentials: 'same-origin' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    ElMessage.success(`已将「${a.name}」设为默认账号，头像默认取该账号`);
    await load();
    emit('profile-updated');
  } catch (e) {
    ElMessage.error(e.message || '设置失败');
  }
}

async function unbind(a) {
  try {
    await ElMessageBox.confirm(
      `解绑「${a.name}」？该账号的游戏库与愿望单数据会被删除，愿望单自动提醒一并清理；历史「曾拥有」记录保留。`,
      '确认解绑',
      { type: 'warning', confirmButtonText: '解绑', confirmButtonClass: 'el-button--danger' },
    );
    const res = await fetch(`/api/steam/accounts/${encodeURIComponent(a.steamId)}`, { method: 'DELETE', credentials: 'same-origin' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    ElMessage.success('已解绑');
    await load();
    emit('profile-updated');
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(e.message || '解绑失败');
  }
}

function bindNew() {
  // 绑定流程在 Steam 完成，成功后回跳本页（back=profile）
  window.location.href = '/api/auth/steam/start?back=profile';
}

// ---- 查看已拥有/愿望单弹窗 ----
const dialog = reactive({ open: false, steamId: '', name: '', owned: 0, wishlist: 0, tab: 'library', q: '', items: [], total: 0, page: 1, pageSize: 10, pages: 1, loading: false });

async function openDialog(a, tab) {
  dialog.steamId = a.steamId;
  dialog.name = a.name;
  dialog.owned = a.owned;
  dialog.wishlist = a.wishlist;
  dialog.tab = tab;
  dialog.q = '';
  dialog.open = true;
  await loadItems(1);
}

async function switchTab() {
  dialog.q = '';
  await loadItems(1);
}

async function loadItems(page) {
  dialog.loading = true;
  try {
    const res = await fetch(
      `/api/steam/accounts/${encodeURIComponent(dialog.steamId)}/${dialog.tab}?page=${page || 1}&pageSize=${dialog.pageSize}&q=${encodeURIComponent(dialog.q.trim())}`,
      { credentials: 'same-origin' },
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const list = dialog.tab === 'library' ? data.games : data.items;
    dialog.items = list || [];
    dialog.total = data.total ?? 0;
    dialog.page = data.page ?? 1;
    dialog.pageSize = data.pageSize ?? 10;
    dialog.pages = Math.max(1, Math.ceil(dialog.total / dialog.pageSize));
  } catch (e) {
    ElMessage.error(e.message || '加载失败');
  } finally {
    dialog.loading = false;
  }
}

// 未保存修改守卫：切菜单/离开路由时提示
const unregister = registerUnsavedSource({
  id: 'profile',
  label: '个人资料',
  isDirty: () => dirty.value,
  save,
  discard: () => {
    dirty.value = false;
    load();
  },
});
onBeforeUnmount(unregister);

onMounted(load);
</script>

<style scoped>
.profile-wrap {
  display: flex;
  flex-direction: column;
  gap: var(--space-14);
  min-width: 0;
  padding-bottom: var(--space-24);
}
.profile-wrap .card-heading {
  justify-content: space-between;
  margin-bottom: var(--space-12);
}
.profile-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-12);
}
.avatar-row {
  display: flex;
  gap: var(--space-16);
  align-items: flex-start;
  padding-bottom: var(--space-12);
  border-bottom: 1px dashed var(--border);
}
.avatar-box {
  width: 84px;
  height: 84px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--brand), #3e4fd8);
  position: relative;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30px;
  font-weight: 700;
  color: #fff;
  border: 2px solid var(--border-2);
  cursor: pointer;
  overflow: hidden;
}
.avatar-box img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.avatar-edit {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--brand);
  color: #fff;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--panel);
}
.avatar-side {
  flex: 1;
  min-width: 0;
}
.avatar-actions {
  display: flex;
  gap: var(--space-8);
  align-items: center;
}
.avatar-opts {
  display: flex;
  gap: var(--space-8);
  flex-wrap: wrap;
  margin-top: var(--space-8);
}
.avopt {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: 1px solid var(--border-2);
  background: var(--panel-2);
  border-radius: var(--radius-10);
  padding: 5px 10px;
  font-size: var(--font-12);
  color: var(--fg-muted);
  cursor: pointer;
}
.avopt.on {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px var(--brand-soft);
  color: var(--fg);
}
.avopt .dot {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--brand), #3e4fd8);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  color: #fff;
}
.hidden-input {
  display: none;
}
.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-12);
}
.field label {
  display: block;
  font-size: var(--font-12);
  color: var(--fg-muted);
  margin-bottom: var(--space-6);
}
.req {
  color: var(--danger);
}
.hint {
  color: var(--fg-subtle);
  font-size: var(--font-11);
  margin-top: var(--space-4);
}
.hint.pad {
  padding-top: var(--space-8);
  margin-top: 0;
}
.ro-input {
  background: var(--panel-2);
  border: 1px solid var(--border-2);
  border-radius: var(--radius-9);
  padding: 8px 11px;
  color: var(--fg);
  font-size: var(--font-13);
  min-height: 34px;
  display: flex;
  align-items: center;
  gap: var(--space-8);
}
.ro-input.muted {
  color: var(--fg-subtle);
}
.bio-field {
  margin-top: var(--space-2);
}
.steam-list {
  display: flex;
  flex-direction: column;
}
.steam-row {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 11px 0;
  border-top: 1px dashed var(--border);
}
.steam-row:first-of-type {
  border-top: 0;
  padding-top: 0;
}
.sav {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-9);
  background: linear-gradient(135deg, var(--brand), #3e4fd8);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-13);
  font-weight: 700;
  flex: none;
}
.steam-row .name {
  flex: 1;
  min-width: 0;
}
.steam-row .name b {
  font-size: var(--font-13);
  font-weight: 600;
}
.steam-row .id,
.acct-h .id {
  color: var(--fg-subtle);
  font-size: var(--font-11);
}
.def {
  font-size: var(--font-10);
  color: var(--success);
  border: 1px solid var(--border);
  background: var(--panel-2);
  border-radius: var(--radius-pill);
  padding: 0 7px;
  margin-left: 6px;
}
.steam-row .ops {
  display: flex;
  gap: var(--space-8);
  align-items: center;
}
.switch-row {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  font-size: var(--font-13);
  min-height: 34px;
}
.acct {
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-12);
  padding: 11px;
}
.acct-h {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: var(--space-8);
}
.acct-h .av {
  width: 34px;
  height: 34px;
  border-radius: var(--radius-9);
  background: linear-gradient(135deg, var(--brand), #3e4fd8);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  color: #fff;
  font-size: var(--font-13);
  flex: none;
}
.acct-h b {
  font-size: var(--font-13);
}
.acct-stats {
  display: flex;
  gap: var(--space-16);
  padding: 7px 0;
  border-top: 1px dashed var(--border);
}
.acct-stats div {
  font-size: var(--font-11);
  color: var(--fg-subtle);
}
.acct-stats b {
  display: block;
  font-size: var(--font-15);
  color: var(--fg);
}
.acct-stats b.sync {
  font-size: var(--font-12);
  font-weight: 500;
}
.acct-ops {
  display: flex;
  gap: var(--space-6);
  flex-wrap: wrap;
  margin-top: var(--space-6);
  padding-top: 7px;
  border-top: 1px dashed var(--border);
}
.statsline {
  display: flex;
  gap: var(--space-16);
  color: var(--fg-muted);
  font-size: var(--font-12);
  flex-wrap: wrap;
}
.statsline b {
  color: var(--brand);
}
.profile-foot {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-10);
}
/* 弹窗 */
.d-tag {
  color: var(--fg-subtle);
  font-size: var(--font-11);
  margin-bottom: var(--space-4);
}
.d-toolbar {
  display: flex;
  gap: var(--space-8);
  padding: var(--space-10) 0;
}
.d-toolbar .el-input {
  flex: 1;
}
.d-list {
  min-height: 180px;
  max-height: 46vh;
  overflow: auto;
}
.grow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 2px;
  border-top: 1px solid var(--border);
}
.gcover {
  width: 56px;
  height: 26px;
  border-radius: var(--radius-6);
  background: var(--panel-2);
  object-fit: cover;
  flex: none;
}
.gname {
  flex: 1;
  min-width: 0;
  font-size: var(--font-13);
}
.gname .en {
  color: var(--fg-subtle);
  font-size: var(--font-11);
}
.gp {
  font-size: var(--font-12);
  color: var(--brand);
  white-space: nowrap;
}
.gp s {
  color: var(--fg-subtle);
  margin-left: 6px;
}
.d-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: var(--space-10);
  color: var(--fg-subtle);
  font-size: var(--font-11);
  gap: var(--space-10);
  flex-wrap: wrap;
}
/* 移动端（demo：单列、卡片吸底保存条） */
@media (max-width: 768px) {
  .grid2 {
    grid-template-columns: 1fr;
  }
  .avatar-box {
    width: 76px;
    height: 76px;
    font-size: 26px;
  }
  .profile-foot {
    position: sticky;
    bottom: 0;
    padding: var(--space-10) 0 var(--space-4);
    background: linear-gradient(180deg, transparent, var(--bg));
  }
  .steam-row {
    flex-wrap: wrap;
  }
  .steam-row .ops {
    width: 100%;
    justify-content: flex-end;
  }
}
</style>
