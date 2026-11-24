<template>
  <div class="admin-shell" :class="{ 'm-shell': isMobile }">
    <aside v-if="!isMobile" class="admin-sidebar">
      <a href="/" class="admin-brand"><span class="brand-mark">S</span><span>SteamDeals<small>管理控制台</small></span></a>
      <div class="admin-search"><el-input v-model="filter" placeholder="搜索管理功能" clearable @keyup.enter="onFilterEnter"><template #prefix><el-icon><Search /></el-icon></template></el-input></div>
      <nav class="admin-nav">
        <template v-for="group in visibleGroups" :key="group.name">
          <div class="nav-heading">{{ group.name }}</div>
          <button v-for="item in group.items" :key="item.id" :class="{ active: selected === item.id }" @click="select(item)"><span class="nav-glyph">{{ item.glyph }}</span><span>{{ item.label }}</span><span v-if="item.id === 'appeals' && appealsPending" class="nav-count">{{ appealsPending }}</span><span v-if="selected === item.id && menuDirty" class="nav-dirty" title="有未保存的修改">●</span><el-icon v-if="selected === item.id" class="arrow"><ArrowRight /></el-icon></button>
        </template>
        <el-empty v-if="!visibleGroups.length" :image-size="44" description="没有匹配的功能" />
      </nav>
      <div class="admin-bottom">
        <div class="bottom-actions"><el-tag v-if="user" type="success" effect="plain"><UserAvatar :user-id="user.id" :name="user.displayName || user.username" :size="18" class="tag-avatar" />{{ user.displayName || user.username }}</el-tag><el-button text @click="router.push('/')">返回网站 ↗</el-button></div>
      </div>
    </aside>
    <!-- BW 批（docs/MOBILE-REDESIGN.md §5.1）：手机端侧栏收进 ☰ 抽屉，沿用 5 分组 13 模块 -->
    <el-drawer v-if="isMobile" v-model="navDrawer" direction="ltr" :size="'min(300px, 86vw)'" class="m-nav-drawer" :with-header="false">
      <a href="/" class="admin-brand" @click="navDrawer=false"><span class="brand-mark">S</span><span>SteamDeals<small>管理控制台</small></span></a>
      <div class="admin-search"><el-input v-model="filter" placeholder="搜索管理功能" clearable @keyup.enter="onFilterEnter"><template #prefix><el-icon><Search /></el-icon></template></el-input></div>
      <nav class="admin-nav">
        <template v-for="group in visibleGroups" :key="group.name">
          <div class="nav-heading">{{ group.name }}</div>
          <button v-for="item in group.items" :key="item.id" :class="{ active: selected === item.id }" @click="select(item)"><span class="nav-glyph">{{ item.glyph }}</span><span>{{ item.label }}</span><span v-if="item.id === 'appeals' && appealsPending" class="nav-count">{{ appealsPending }}</span><el-icon v-if="selected === item.id" class="arrow"><ArrowRight /></el-icon></button>
        </template>
        <el-empty v-if="!visibleGroups.length" :image-size="44" description="没有匹配的功能" />
      </nav>
      <div class="admin-bottom">
        <div class="bottom-actions"><el-tag v-if="user" type="success" effect="plain"><UserAvatar :user-id="user.id" :name="user.displayName || user.username" :size="18" class="tag-avatar" />{{ user.displayName || user.username }}</el-tag><el-button text @click="router.push('/')">返回网站 ↗</el-button></div>
      </div>
    </el-drawer>
    <main class="admin-content">
      <header class="admin-header">
        <div class="admin-heading">
          <div class="m-head-row">
            <button v-if="isMobile" type="button" class="m-menu-btn" aria-label="打开菜单" @click="navDrawer=true">☰</button>
            <div>
              <div class="admin-crumb">管理中心 <span>/</span> {{ selectedItem?.group }}</div>
              <h1>{{ selectedItem?.label }}</h1>
              <p>{{ selectedItem?.description }}</p>
            </div>
          </div>
        </div>
        <div class="header-actions">
          <el-button v-if="isMobile" text class="theme-btn m-bell" title="站点通知" @click="goAnnouncements">🔔</el-button>
          <span v-if="user && !isMobile" class="header-version" :title="versionTitle" @click="loadVersion(user?.role==='admin')">v{{ verInfo.current || '—' }}<em v-if="verInfo.updateAvailable && verInfo.latest"> ↑ 新版 v{{ String(verInfo.latest).replace(/^v/i, '') }} 可用</em></span>
          <!-- DT-5（docs/ADMIN-PERMISSIONS.md）：Console 全局顶栏（所有 section 共用）——
               版本徽标（FB：所有登录用户可见，移动端隐藏保持紧凑）+ 用户徽标；
               「返回网站 ↗」只在菜单里（FB 去重，单一入口）。
               徽标下拉菜单树：个人资料/修改密码/返回网站/切换账户/退出登录
               （普通用户同样可用；FA 批新增「切换账户」，顺序与 demo docs/design/profile-tab-demo.html 一致） -->
          <el-dropdown v-if="user" trigger="click" class="header-user-dropdown" @command="onUserCommand">
            <button type="button" class="user-chip header-userchip" :title="user.displayName || user.username"><UserAvatar :user-id="user.id" :name="user.displayName || user.username" :size="22" /><span class="user-label">{{ user.displayName || user.username }}</span><span class="user-caret">▾</span></button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="profile">个人资料</el-dropdown-item>
                <el-dropdown-item command="password">修改密码</el-dropdown-item>
                <el-dropdown-item command="site">返回网站 ↗</el-dropdown-item>
                <el-dropdown-item command="switch" divided>切换账户</el-dropdown-item>
                <el-dropdown-item command="logout"><span class="user-menu-danger">退出登录</span></el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-button text class="theme-btn" :title="themeMode === 'dark' ? '切换亮色' : '切换暗色'" @click="toggleTheme">{{ themeMode === 'dark' ? '🌞' : '🌙' }}</el-button>
        </div>
      </header>
      <AdminModules v-if="isAdminUser && nativeSections.includes(selected)" :section="selected" />
      <AdminLogs v-else-if="selected === 'op-logs'" />
      <ProfilePage v-else-if="selected === 'profile'" @profile-updated="loadMe" />
      <!-- DT-1（docs/ADMIN-PERMISSIONS.md）：普通用户 5 页中除个人资料外的 4 页走用户级组件
           （DT-2 接入数据）；admin 走上面分支保持 admin 接口不变 -->
      <UserSections v-else-if="isUserRole" :section="selected" />
      <AdminExtras v-else :section="selected" :me="user" />
    </main>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowRight, Search } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import AdminModules from './AdminModules.vue';
import AdminExtras from './AdminExtras.vue';
import AdminLogs from './AdminLogs.vue';
import ProfilePage from './ProfilePage.vue';
import UserSections from './UserSections.vue';
import UserAvatar from '../components/UserAvatar.vue';
import { useTheme } from '../composables/useTheme.js';
import { fmtDateTime } from '../utils/siteTime.js';
import { requestLeave, bypassNextGuard, hasDirtySources } from '../composables/useUnsavedGuard.js';
// DT-5（docs/ADMIN-PERMISSIONS.md）：主动退出登录标记心跳基线（BM-4），避免心跳把主动退出误判成会话失效
import { markSessionLoggedOut } from '../composables/useSessionHeartbeat.js';
// FA 批（docs/PROFILE-PAGE-SLIM.md §3）：切换账户整页硬跳登录页统一走 openLogin（BM-3 唯一允许入口）
import { openLogin } from '../utils/login-entry.js';

const router=useRouter(), route=useRoute(), filter=ref(''), user=ref(null);
// BW 批（docs/MOBILE-REDESIGN.md §5.1）：≤768px 侧栏收进 ☰ 抽屉
const navDrawer=ref(false);
const isMobile=ref(false);
function applyMobile(){
  if(typeof window==='undefined')return;
  isMobile.value=Boolean(window.matchMedia&&window.matchMedia('(max-width: 768px)').matches);
}
// O 批（docs/APPEAL-SYSTEM.md §5）：侧栏「申诉管理」待处理数量角标
const appealsPending=ref(0);
async function loadAppealsPending(){
  try{
    const r=await fetch('/api/admin/appeals?status=pending&limit=1',{credentials:'same-origin'});
    if(r.ok){const d=await r.json();appealsPending.value=d.pending||0;}
  }catch{/* 角标失败静默 */}
}
const theme = useTheme();
const themeMode = theme.mode;
function toggleTheme(){
  const m = themeMode.value === 'dark' ? 'light' : 'dark';
  theme.set(m);
  if (user.value) {
    fetch('/api/prefs', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ theme: m }) }).catch(() => {});
  }
}
const nativeSections=['games','visitors','announcements','wishlist','watchlist','settings','stats','appeals'];
// AT 批（docs/ADMIN-CONSOLE-IA.md §3）：侧栏删「批量操作记录」「运行日志」，新增「日志审计 / 操作日志」；
// 旧书签 ?section=bulk-ops / ?section=sync 自动落到 op-logs 对应 tab，不 404（§7.4 验收 11）。
// DT-1（docs/ADMIN-PERMISSIONS.md）：删除「Steam 账号」菜单项（账号管理并入个人资料页 CX 账号卡）；
// 管理员看其它用户绑定账号走「用户管理 → 编辑用户」弹窗（DT-3）。
const groups=[
  {name:'内容运营',items:[{id:'games',label:'游戏管理',glyph:'▦',description:'维护游戏目录、采集计划与数据回填'},{id:'recycle',label:'回收站',glyph:'▤',description:'查看并恢复已删除的游戏'},{id:'announcements',label:'站点通知',glyph:'▱',description:'发布和管理网站公告'},{id:'wishlist',label:'愿望单',glyph:'★',description:'全站用户愿望单，可查看与删除'},{id:'watchlist',label:'到价提醒',glyph:'🔔',description:'全站到价提醒清单（用户级 + 站点级），可查看与清理'}]},
  {name:'访问与安全',items:[{id:'visitors',label:'访问记录',glyph:'◉',description:'流量、异常请求和访问控制'},{id:'appeals',label:'申诉管理',glyph:'❧',description:'解封申诉的受理与处理'}]},
  {name:'账号与服务',items:[{id:'profile',label:'个人资料',glyph:'👤',description:'编辑个人资料、头像与 Steam 账号绑定（仅本人可见）'},{id:'users',label:'用户管理',glyph:'♙',description:'管理账号、角色与登录权限'},{id:'sessions',label:'登录会话',glyph:'⟳',description:'查看在线会话、踢下线'},{id:'mail',label:'邮件服务',glyph:'✉',description:'配置 SMTP、邮件模板与发送测试'}]},
  {name:'日志审计',items:[{id:'op-logs',label:'操作日志',glyph:'☰',description:'用户删除 / 批量操作 / Steam 账号 / 邮件发送 / 运行与同步的审计记录'}]},
  {name:'系统',items:[{id:'settings',label:'系统设置',glyph:'⚙',description:'数据源、网络代理与提醒配置'},{id:'stats',label:'数据统计',glyph:'▥',description:'价格变化、缓存、备份与访问排行'}]},
];
// DT-1（docs/ADMIN-PERMISSIONS.md）：普通用户仅 5 页——个人资料 / 登录会话（我的设备）/
// 我的到价提醒 / 我的愿望单 / 站点公告（只读）。文案与 demo
// （design/admin-menu-permissions-2026-11-19.html「普通用户菜单（5 项）」）逐字对齐。
// 守卫与可见性都以本列表为准（不在列表内的 section 对普通用户即「无权限」）。
const USER_SECTIONS = ['profile', 'sessions', 'watchlist', 'wishlist', 'announcements'];
const USER_GROUPS = [
  { name: '我的', items: [
    { id: 'profile', label: '个人资料', glyph: '👤', description: '编辑个人资料、头像与 Steam 账号绑定（仅本人可见）' },
    { id: 'sessions', label: '登录会话（我的设备）', glyph: '⟳', description: '查看我登录过的设备，撤销某个设备的登录' },
    { id: 'watchlist', label: '我的到价提醒', glyph: '🔔', description: '我设置的到价提醒清单' },
    { id: 'wishlist', label: '我的愿望单', glyph: '★', description: '我收藏的愿望单游戏' },
    { id: 'announcements', label: '站点公告', glyph: '▱', description: '站点发布的通知公告（只读）' },
  ] },
];
// 旧书签映射：bulk-ops → op-logs&tab=bulk；sync → op-logs&tab=run（mail&tab=records 在 AdminExtras 内处理）
const LEGACY_SECTION = { 'bulk-ops': { section: 'op-logs', tab: 'bulk' }, sync: { section: 'op-logs', tab: 'run' } };
const selected=ref(String(route.query.section||'games'));
// DT-1（docs/ADMIN-PERMISSIONS.md）：角色判定——isAdminUser 决定管理菜单与 admin 组件；
// isUserRole 决定普通用户 5 页菜单与 UserSections 渲染（loadMe 完成前 user 为 null，按现状渲染）。
const isUserRole = computed(() => Boolean(user.value && user.value.role !== 'admin'));
const isAdminUser = computed(() => user.value?.role === 'admin');
// URL 里的 section 变化（如指标卡「已删除」跳转回收站）时同步选中态
watch(()=>route.query.section,(v)=>{
  const id=String(v??'');
  if(id==='mail'&&route.query.tab==='records'){ // 旧书签 mail 发送记录 → 操作日志 · 邮件发送
    router.replace({path:'/console',query:{section:'op-logs',tab:'mail'}}).catch(()=>{});
    return;
  }
  if(LEGACY_SECTION[id]){
    selected.value=LEGACY_SECTION[id].section;
    router.replace({path:'/console',query:{section:LEGACY_SECTION[id].section,tab:LEGACY_SECTION[id].tab}}).catch(()=>{});
    return;
  }
  // DT-1：普通用户直达无权限 section → 强制回「个人资料」+「无权限」提示（接口另有 requireAdmin 兜底）；
  // 允许集 = USER_SECTIONS（5 页）；无 section 参数静默落 profile 不提示。
  if(isUserRole.value && !USER_SECTIONS.includes(id)){
    selected.value='profile';
    router.replace({path:'/console',query:{section:'profile'}}).catch(()=>{});
    if(id)ElMessage.warning('无权限');
    return;
  }
  if(id&&groups.some(g=>g.items.some(i=>i.id===id)))selected.value=id;
});
const selectedItem=computed(()=>{
  // DT-1：普通用户菜单用「我的」组文案（登录会话（我的设备）/我的到价提醒/…），admin 用管理组文案
  const source=isUserRole.value?USER_GROUPS:groups;
  return source.flatMap(g=>g.items.map(i=>({...i,group:g.name}))).find(i=>i.id===selected.value)||source[0].items[0];
});
// DT-1（docs/ADMIN-PERMISSIONS.md）：admin 全量菜单；普通用户仅 5 页（USER_GROUPS「我的」组）。
// 未加载出 user 时按现状显示全量（loadMe 完成后自动收敛，避免首帧闪烁）。
const visibleGroups=computed(()=>{
  const q=filter.value.trim().toLocaleLowerCase();
  const source=isUserRole.value?USER_GROUPS:groups;
  return source.map(g=>({...g,items:g.items.filter(i=>{
    const allowed=!user.value||user.value.role==='admin'||USER_SECTIONS.includes(i.id);
    const matches=!q||`${i.label} ${i.description} ${g.name}`.toLocaleLowerCase().includes(q);
    return allowed&&matches;
  })})).filter(g=>g.items.length);
});
// AN 批（docs/UNSAVED-GUARD.md §4.3）：切菜单前先过离开确认——不要先改 selected 再拦
async function select(item){ if(item.id===selected.value)return; if(!(await requestLeave()))return; selected.value=item.id; navDrawer.value=false; await router.replace({path:'/console',query:{section:item.id}}); if(item.id==='appeals')loadAppealsPending(); }
// BW 批：手机顶栏通知铃 → 站点通知模块（DT-1：普通用户菜单也有站点公告，按角色取菜单池）
function goAnnouncements(){const pool=isUserRole.value?USER_GROUPS:groups;const item=pool.flatMap((g)=>g.items).find((i)=>i.id==='announcements');if(item)select(item);}
// 当前菜单项的「未保存修改」小圆点（与邮件配置的小标一致）
const menuDirty=ref(false);
let menuDirtyTimer=null;
onBeforeUnmount(()=>{if(menuDirtyTimer){clearInterval(menuDirtyTimer);menuDirtyTimer=null;}});
onMounted(()=>{menuDirtyTimer=setInterval(()=>{menuDirty.value=hasDirtySources();},800);});
// 侧栏搜索按 Enter：直接打开第一个匹配的功能
function onFilterEnter(){const first=visibleGroups.value[0]?.items[0];if(first){filter.value='';select(first);}else if(filter.value.trim()){ElMessage.warning('没有匹配的功能');}}

// 版本检查（FB，docs/CONSOLE-HEADER-FIX.md）：所有登录用户进入控制台自动查一次（走服务端缓存）；
// 点击时管理员带 force=1 强制出网检查，普通用户只读缓存（force 由后端忽略，前端也不主动发）。
const verInfo=ref({current:null,latest:null,updateAvailable:false,url:null,checkedAt:null,error:null});
const versionLoading=ref(false);
const versionTitle=computed(()=>{
  if(versionLoading.value)return '正在检查新版本…';
  if(verInfo.value.error)return '版本检查失败：'+verInfo.value.error;
  if(verInfo.value.checkedAt)return '上次检查：'+fmtDateTime(verInfo.value.checkedAt)+'（点击重新检查）';
  return '点击检查新版本';
});
async function loadVersion(force){
  versionLoading.value=true;
  try{
    const res=await fetch('/api/admin/version'+(force?'?force=1':''),{credentials:'same-origin'});
    const d=await res.json();
    if(!res.ok)throw new Error(d.error||`HTTP ${res.status}`);
    verInfo.value=d;
  }catch(e){verInfo.value={...verInfo.value,error:e.message};}
  finally{versionLoading.value=false;}
}

onMounted(async()=>{try{
  applyMobile();
  if(typeof window!=='undefined'&&window.matchMedia){const mq=window.matchMedia('(max-width: 768px)');const on=()=>{applyMobile();};mq.addEventListener?mq.addEventListener('change',on):mq.addListener(on);}
  const data=await loadMe();
  if(!data.user){ElMessage.warning('请先登录');bypassNextGuard();router.replace('/login');return;}
  if(data.user.must_change_password){ElMessage.warning('请先修改初始密码');bypassNextGuard();router.replace('/change-password?forced=1');return;}
  const isAdmin=data.user.role==='admin';
  // DT-1（docs/ADMIN-PERMISSIONS.md）：普通用户允许集 = USER_SECTIONS（5 页）；
  // 直达无权限 section → 跳 profile + 「无权限」提示；直达允许集 section 保留（UserSections 渲染）；
  // 无参数 → 静默落 profile。
  if(!isAdmin){
    const initial=String(route.query.section??'');
    if(initial&&USER_SECTIONS.includes(initial)){
      selected.value=initial;
    }else{
      selected.value='profile';
      if(initial)ElMessage.warning('无权限');
      router.replace({path:'/console',query:{section:'profile'}}).catch(()=>{});
    }
  }
  // 旧书签映射也要在直开时生效（watch 不触发首帧）
  const legacy=LEGACY_SECTION[selected.value];
  if(legacy){selected.value=legacy.section;router.replace({path:'/console',query:{...legacy}}).catch(()=>{});}
  else if(selected.value==='mail'&&route.query.tab==='records'){router.replace({path:'/console',query:{section:'op-logs',tab:'mail'}}).catch(()=>{});}
  const valid=groups.some(g=>g.items.some(i=>i.id===selected.value));
  if(!valid)selected.value=isAdmin?'games':'profile';
  const st=data.prefs?.theme;if(st==='light'||st==='dark'){if(theme.storedMode()!==st)theme.set(st);}else if(theme.storedMode()){fetch('/api/prefs',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({theme:theme.storedMode()})}).catch(()=>{});}
}catch{ElMessage.error('无法验证登录身份');bypassNextGuard();router.replace('/');return;}
if(user.value?.role==='admin'){loadAppealsPending();}
// FB：版本徽标所有登录用户可见 → 普通用户也自动查一次（服务端缓存，普通用户 force 被后端忽略）
if(user.value){loadVersion(false);}});

// 拉取当前用户（进入控制台 / 个人资料保存后刷新侧栏显示名）
async function loadMe(){
  const res=await fetch('/api/me',{credentials:'same-origin'});
  const data=await res.json();
  user.value=data.user||null;
  return data;
}

// ---- DT-5（docs/ADMIN-PERMISSIONS.md）：全局顶栏用户菜单树（所有 section 共用）----
async function onUserCommand(cmd){
  if(cmd==='profile'){
    const item=(isUserRole.value?USER_GROUPS:groups).flatMap((g)=>g.items).find((i)=>i.id==='profile');
    if(item)await select(item);
  }else if(cmd==='password'){
    bypassNextGuard();
    router.push('/change-password').catch(()=>{});
  }else if(cmd==='site'){
    bypassNextGuard();
    router.push('/').catch(()=>{});
  }else if(cmd==='switch'){
    await doSwitchAccount();
  }else if(cmd==='logout'){
    await doLogout();
  }
}
// FA 批（docs/PROFILE-PAGE-SLIM.md §3）：切换账户 = 退出当前会话 → /login?switch=1 →
// 登录成功后回原页面（openLogin 缺省 next=当前 pathname+search，如 /console?section=profile）；
// 与「退出登录」的区别：退出登录保持现状回首页。
async function doSwitchAccount(){
  try{
    await fetch('/api/logout',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:'{}'});
  }catch{/* 网络失败也照走切换流程（本地态清空） */}
  markSessionLoggedOut(); // BM-4：主动退出标记心跳基线
  user.value=null;
  bypassNextGuard();
  openLogin({ switchAccount: true });
}
async function doLogout(){
  try{
    await fetch('/api/logout',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:'{}'});
  }catch{/* 网络失败也照走退出流程（本地态清空） */}
  markSessionLoggedOut(); // BM-4：主动退出标记心跳基线——心跳不会把「主动退出」误判成会话失效
  user.value=null;
  bypassNextGuard();
  router.replace('/').catch(()=>{});
}
</script>

<style scoped>
.theme-btn{font-size:17px}
.tag-avatar{vertical-align:middle;margin-right:5px}
/* FA 批：用户菜单「退出登录」红字（demo 的 .danger 项）；dropdown teleport 后 scoped 属性仍跟随 slot 内容生效 */
.user-menu-danger{color:var(--danger)}
/* DT-5（docs/ADMIN-PERMISSIONS.md）：全局顶栏「用户徽标」下拉菜单树；FB 起「返回网站」只在菜单里 */
.header-userchip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--border-2);background:var(--panel-2);border-radius:999px;padding:4px 10px 4px 5px;color:var(--fg);font-size:12px;cursor:pointer;min-height:30px}
.header-userchip:hover{border-color:var(--brand)}
.user-label{max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.user-caret{font-size:10px;color:var(--fg-muted)}
@media (max-width:768px){.header-userchip{min-height:44px;padding:6px 12px 6px 6px}}
.nav-dirty{color:var(--warn);font-size:9px;margin-left:auto;line-height:1}
.nav-count{min-width:18px;margin-left:auto;padding:0 5px;border-radius:999px;background:var(--warn);color:#fff;font-size:10px;line-height:17px;text-align:center;font-weight:700}
.header-actions{display:flex;align-items:center;gap:12px;min-width:0}
.header-version{font-size:11px;color:var(--fg-muted);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.header-version em{font-style:normal;color:var(--warn);font-weight:600}
</style>
