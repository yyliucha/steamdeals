<template>
  <div class="extra-wrap" :class="{ 'm-console': isMobile }">
    <template v-if="section==='users'">
      <div class="module-card"><div class="card-heading"><div><h3>用户管理</h3><p>这里只留用户列表；新建用户从「＋ 新建用户」右侧抽屉完成（不跳页、列表不刷新）。</p></div><div class="steam-actions"><el-button type="primary" @click="openNewUserDrawer">＋ 新建用户</el-button><el-button @click="loadUsers">刷新列表</el-button><el-button text @click="goOpLogs('user-deletions')">最近删除 ↗</el-button></div></div></div>
      <div class="module-card table-card"><BulkBar :count="sel.users.count" :actions="usersBulkActions" :running="bulkRunning" :hint="usersBulkHint" @run="(a)=>runBulk(a,sel.users,{refresh:loadUsers})" @clear="sel.users.clear()"/><el-table ref="usersTable" row-key="id" :data="pagedUsers" v-loading="loading" stripe @selection-change="sel.users.onSelectionChange"><el-table-column type="selection" width="44"/><el-table-column prop="username" label="用户名" min-width="125"/><el-table-column prop="display_name" label="显示名" min-width="120"><template #default="{row}">{{ row.display_name||'—' }}</template></el-table-column><el-table-column label="邮箱" min-width="200"><template #default="{row}"><span>{{ row.email||'未绑定' }}</span><el-tag v-if="row.email" :type="row.email_verified?'success':'warning'" size="small" class="tag-gap">{{ row.email_verified?'已验证':'未验证' }}</el-tag></template></el-table-column><el-table-column label="角色" width="95"><template #default="{row}"><el-tag :type="row.role==='admin'?'danger':'info'" size="small">{{ row.role==='admin'?'管理员':'普通用户' }}</el-tag></template></el-table-column><el-table-column label="状态" width="215"><template #default="{row}"><el-tag :type="row.disabled?'info':'success'" size="small">{{ row.disabled?'已禁用':'正常' }}</el-tag><el-tag v-if="isLocked(row)" type="danger" size="small" class="tag-gap">已锁定</el-tag><el-tag v-if="row.weak_password" type="danger" size="small" class="tag-gap">弱密码</el-tag><el-tag v-if="row.must_change_password" type="warning" size="small" class="tag-gap">需改密</el-tag><el-button v-if="isLocked(row)" link type="primary" size="small" class="tag-gap" @click="unlockUser(row)">解锁</el-button></template></el-table-column><el-table-column label="最近登录" min-width="155"><template #default="{row}">{{ dateTime(row.last_login_at) }}</template></el-table-column><el-table-column label="管理操作" min-width="255" fixed="right"><template #default="{row}"><el-button link @click="editName(row)">改名</el-button><el-button link @click="editEmail(row)">邮箱</el-button><el-button v-if="row.email&&!row.email_verified" link @click="verifyEmail(row)">验证</el-button><el-button link @click="resetPassword(row)">重置密码</el-button><el-button link :type="row.disabled?'success':'danger'" @click="toggleUser(row)">{{ row.disabled?'启用':'禁用' }}</el-button><el-button v-if="row.id !== me?.id" link type="danger" :disabled="!canDeleteUser(row)" :title="canDeleteUser(row) ? '' : '最后一个可用管理员不能删除'" @click="openDeleteUser(row)">删除</el-button></template></el-table-column></el-table><PaginationBar v-model:page="usersPage" v-model:page-size="usersPageSize" :total="users.length"/></div>
      <el-dialog v-model="deleteDialog.visible" title="彻底删除用户" width="min(480px, 92vw)"><el-alert class="delete-alert" type="error" :closable="false" title="删除后该用户立即退出登录，数据不可恢复" description="将删除：登录会话 N 个、绑定 Steam 账号 M 个、愿望单与游戏标记；用户名可立即重新注册。"><template #default><p class="muted">将删除「{{ deleteDialog.username }}」的：登录会话 {{ deleteDialog.sessions }} 个、绑定 Steam 账号 {{ deleteDialog.steamAccounts }} 个、愿望单与游戏标记；删除后用户名可立即重新注册。</p></template></el-alert><el-input v-model="deleteDialog.confirm" class="delete-confirm-input" :placeholder="`输入用户名 ${deleteDialog.username} 确认删除`" maxlength="80"/><el-input v-model="deleteDialog.reason" type="textarea" :rows="2" maxlength="500" placeholder="删除原因（可选，只进审计，不进邮件）"/><template #footer><el-button @click="deleteDialog.visible=false">取消</el-button><el-button type="danger" :disabled="deleteDialog.confirm !== deleteDialog.username" :loading="deleting" @click="submitDeleteUser">确认删除</el-button></template></el-dialog>
      <el-dialog v-model="tempPwdDialog" title="临时密码（仅显示一次）" width="min(440px, 92vw)"><p class="muted">请立即复制并交给用户；关闭后无法再次查看，用户首次登录必须修改密码。</p><el-input :model-value="tempPwd" readonly/><template #footer><el-button type="primary" @click="copyTempPassword">复制</el-button><el-button @click="tempPwdDialog=false">关闭</el-button></template></el-dialog>
      <UserCreateDrawer v-model:visible="newUserDrawer" @created="loadUsers" />
    </template>
    <template v-else-if="section==='recycle'">
      <div class="module-card recycle-summary"><div><span class="muted">回收站</span><strong>{{ recycleGames.length }}</strong><small>款游戏</small></div><p>这里只做逻辑删除。恢复后会重新出现在前台目录，价格与历史数据会保留。</p><el-button :disabled="!recycleGames.length" @click="selectAllRecycle">全选当前筛选（{{ recycleGames.length }} 条）</el-button><el-button @click="loadRecycle">刷新</el-button></div>
      <div class="module-card table-card"><BulkBar :count="sel.recycle.count" :actions="recycleBulkActions" :running="bulkRunning" hint="最多一次 1000 条" @run="(a)=>runBulk(a,sel.recycle,{refresh:loadRecycle})" @clear="sel.recycle.clear()"/><el-table ref="recycleTable" row-key="id" :data="pagedRecycleGames" v-loading="loading" stripe @selection-change="sel.recycle.onSelectionChange"><el-table-column type="selection" width="44"/><el-table-column prop="steam_appid" label="AppID" width="110"><template #default="{row}">{{ row.steam_appid||'—' }}</template></el-table-column><el-table-column label="游戏" min-width="220"><template #default="{row}"><strong>{{ row.name }}</strong><small>{{ row.name_en||' ' }}</small></template></el-table-column><el-table-column prop="app_type" label="类型" width="90"/><el-table-column label="平台" min-width="150"><template #default="{row}"><el-tag v-for="p in row.platform_names||[]" :key="p" size="small" class="tag-gap">{{ p }}</el-tag><span v-if="!row.platform_names?.length">—</span></template></el-table-column><el-table-column prop="offer_count" label="报价数" width="90" align="right"/><el-table-column label="删除时间" min-width="155"><template #default="{row}">{{ dateTime(row.deleted_at) }}</template></el-table-column><el-table-column label="操作" width="100" fixed="right"><template #default="{row}"><el-button link type="primary" @click="restoreGame(row)">恢复</el-button></template></el-table-column></el-table><PaginationBar v-model:page="recyclePage" v-model:page-size="recyclePageSize" :total="recycleGames.length"/></div>
    </template>
    <template v-else-if="section==='steam'">
      <div class="module-card steam-account">
        <div class="card-heading"><div><h3>绑定的 Steam 账号</h3><p>每个站点用户最多绑定 5 个 Steam 账号，一个 Steam 账号只能属于一个用户；绑定后自动同步游戏库与愿望单。</p><p>Steam API 不返回 DLC 拥有数据，故不展示 DLC 数。</p></div><div class="steam-actions"><el-button type="primary" :disabled="steamAccounts.length>=steamLimit" @click="bindSteam">{{ steamAccounts.length>=steamLimit?'已达绑定上限':'绑定新账号' }}</el-button><el-button @click="loadSteam">刷新</el-button><el-button text @click="goOpLogs('steam')">操作日志 ↗</el-button></div></div>
        <el-alert v-if="steamError" :title="steamError" type="error" :closable="false" class="steam-alert"/>
        <div class="table-scroll" v-if="steamAccounts.length"><el-table :data="steamAccounts" stripe>
          <el-table-column label="账号" min-width="230"><template #default="{row}"><div class="steam-account-cell"><img v-if="row.avatar" :src="row.avatar" class="steam-avatar-img" @error="$event.target.style.display='none'"><div><strong>{{ row.alias||row.persona_name||row.steam_id }}</strong><small>{{ row.alias&&row.persona_name?row.persona_name+' · ':'' }}{{ row.steam_id }}</small></div></div></template></el-table-column>
          <el-table-column label="游戏库" width="90" align="right"><template #default="{row}"><el-button link type="primary" @click="toggleLibrary(row)">{{ row.games }}</el-button></template></el-table-column>
          <el-table-column label="愿望单" width="90" align="right"><template #default="{row}">{{ row.wishlist }}</template></el-table-column>
          <el-table-column label="推送 Key" width="100"><template #default="{row}"><el-tag :type="row.api_key_set?'success':'info'" size="small">{{ row.api_key_set?'已配置':'未配置' }}</el-tag></template></el-table-column>
          <el-table-column label="最近同步" min-width="150"><template #default="{row}">{{ dateTime(row.library_synced_at)||'未同步' }}</template></el-table-column>
          <el-table-column label="操作" min-width="420" fixed="right"><template #default="{row}"><el-button link @click="goOpLogs('steam')">日志</el-button><el-button link type="primary" @click="syncSteam(row,'library')">同步游戏库</el-button><el-button link @click="syncSteam(row,'wishlist')">同步愿望单</el-button><el-button link @click="editAlias(row)">改别名</el-button><el-button link @click="editApiKey(row)">API Key</el-button><el-button link type="danger" @click="unbindSteam(row)">解绑</el-button></template></el-table-column>
        </el-table></div>
        <el-empty v-else description="还没有绑定 Steam 账号，点右上角「绑定新账号」开始"/>
      </div>
      <div v-if="unownedAccounts.length" class="module-card table-card">
        <div class="card-heading padded"><div><h3>未归属的 Steam 账号（迁移认领）</h3><p>历史登录留下的账号还没有归属任何站点用户，认领后即可同步游戏库与愿望单。</p></div></div>
        <div class="table-scroll"><el-table :data="unownedAccounts" stripe><el-table-column label="账号" min-width="240"><template #default="{row}"><div class="steam-account-cell"><div><strong>{{ row.persona_name||row.steam_id }}</strong><small>{{ row.steam_id }}</small></div></div></template></el-table-column><el-table-column label="已同步游戏" width="120" align="right"><template #default="{row}">{{ row.games }}</template></el-table-column><el-table-column label="操作" width="130" fixed="right"><template #default="{row}"><el-button link type="primary" @click="claimSteam(row)">认领到当前管理员</el-button></template></el-table-column></el-table></div>
      </div>
      <div v-if="activeAccount && libraryGames.length" class="module-card table-card">
        <div class="card-heading padded"><div><h3>{{ activeAccount.alias||activeAccount.persona_name||activeAccount.steam_id }} 的游戏库</h3><p>最多显示 500 条，按游玩时长排序。</p></div><el-button text @click="activeAccount=null;libraryGames=[]">收起</el-button></div>
        <el-table :data="pagedSteamGames" v-loading="loading" stripe><el-table-column label="游戏" min-width="260"><template #default="{row}"><div class="game-admin"><img :src="`/img/steam/${row.appid}/capsule_sm_120`" @error="$event.target.style.display='none'"><div><a :href="`https://store.steampowered.com/app/${row.appid}/`" target="_blank" rel="noopener">{{ row.name||`appid:${row.appid}` }}</a><small>AppID {{ row.appid }} · {{ row.in_db?'已在本站目录':'尚未入库' }}</small></div></div></template></el-table-column><el-table-column label="游玩时间" width="155" align="right"><template #default="{row}">{{ Number(row.playtime_minutes||0) }} 分钟 · {{ (Number(row.playtime_minutes||0)/60).toFixed(1) }} 小时</template></el-table-column><el-table-column label="本站最低价" width="130" align="right"><template #default="{row}">{{ price(row.low) }}</template></el-table-column><el-table-column label="最近游玩" min-width="150"><template #default="{row}">{{ dateTime(row.last_played_at) }}</template></el-table-column></el-table>
        <PaginationBar v-model:page="steamPage" v-model:page-size="steamPageSize" :total="libraryGames.length"/>
      </div>
      <el-dialog v-model="apiKeyDialog.visible" :title="`API Key：${apiKeyDialog.row?.alias||apiKeyDialog.row?.persona_name||apiKeyDialog.row?.steam_id||''}`" width="min(480px, 92vw)"><p class="muted">写愿望单（添加/移除）必须用该 Steam 账号自己注册的 Web API Key（在 steamcommunity.com/dev/apikey 注册）。只读同步用系统 STEAM_API_KEY 即可。Key 只存密文、不回显。</p><el-input v-model="apiKeyDialog.value" type="password" show-password placeholder="输入该账号的 API Key（留空保存=清除）" @keyup.enter="saveApiKey"/><template #footer><el-button v-if="apiKeyDialog.row?.api_key_set" type="danger" plain @click="saveApiKey(true)">清除 Key</el-button><el-button type="primary" :loading="saving" @click="saveApiKey(false)">保存</el-button></template></el-dialog>
    </template>
    <template v-else-if="section==='mail'">
      <div class="metric-grid"><div class="metric-card"><span>SMTP 状态</span><strong class="status-text" :class="smtp.ready?'good':'warning'">{{ smtp.ready?'已配置':'未配置' }}</strong></div><div class="metric-card"><span>配置来源</span><strong>{{ smtp.source==='database'?'后台设置':'环境变量' }}</strong></div><div class="metric-card"><span>授权密码</span><strong>{{ smtp.hasPassword?'已保存':'未设置' }}</strong></div></div>
      <div class="mail-page-head"><el-button text @click="goOpLogs('mail')">查看发送记录 ↗</el-button></div>
      <el-tabs v-model="mailPageTab" class="mail-page-tabs"><el-tab-pane label="邮件配置" name="config">
      <div class="module-card"><div class="card-heading"><div><h3>邮件配置</h3><p>SMTP、收件人与申诉邮箱集中在此维护；配置保存在此页，保存后立即生效（调度器约 15 秒内读取新值）。</p></div></div><MailSettingsForm @saved="loadMail"/></div>
      </el-tab-pane><el-tab-pane label="邮件模板" name="templates">
      <div class="module-card mail-tpl-card"><div class="card-heading"><div><h3>邮件模板</h3><p>9 个事件（8 类账号通知 + 验证码）可编辑、启停、预览、发测试、套用示例、恢复默认；保存后下一封即生效。统一页脚由系统追加，模板改不到。</p></div><div class="tpl-head-actions"><el-select v-model="tplSample" placeholder="套用示例" size="small"><el-option v-for="s in tplSamples" :key="s.id" :label="s.label" :value="s.id"/></el-select><el-button size="small" @click="applySample">套用示例</el-button></div></div><el-tabs v-model="tplActive" class="tpl-tabs"><el-tab-pane v-for="t in templates" :key="t.event" :label="t.label" :name="t.event"><div class="tpl-row tpl-switch-row"><span class="muted">{{ t.event }}<template v-if="t.isDefault">（默认）</template></span><el-switch v-model="t.enabled"/></div><div class="tpl-row"><label>主题（≤200 字，换行会被过滤）</label><el-input v-model="t.subject" maxlength="200"/></div><div class="tpl-row"><label>HTML 正文（≤20000 字；变量会自动转义）</label><el-input v-model="t.body_html" type="textarea" :rows="10" maxlength="20000" class="tpl-html"/></div><div class="tpl-vars"><button v-for="v in t.variables" :key="v" type="button" class="tpl-var-btn" @click="insertVar(v)">{{ varLabel(v) }}</button></div><div class="tpl-actions"><el-button @click="previewTemplate(t)">预览</el-button><el-button @click="testTemplate(t)">发送测试</el-button><el-button @click="resetTemplate(t)">恢复默认</el-button><el-button type="primary" :loading="savingTpl" @click="saveTemplate(t)">保存</el-button></div></el-tab-pane></el-tabs></div>
      </el-tab-pane><el-tab-pane label="发送测试" name="test">
      <div class="module-card"><div class="card-heading"><div><h3>发送测试邮件</h3><p>配置保存在此页；保存后立即生效（调度器约 15 秒内读取新值）。</p></div><el-button @click="loadMail">刷新状态</el-button></div><div class="mail-test"><el-input v-model="testEmail" placeholder="接收测试邮件的地址" @keyup.enter="sendTestMail"/><el-button type="primary" :loading="saving" @click="sendTestMail">发送测试</el-button></div><el-alert v-if="mailMessage" :title="mailMessage" :type="mailOk?'success':'error'" :closable="false"/><p v-if="smtpTrace" class="smtp-trace">{{ smtpTrace }}</p></div>
      </el-tab-pane></el-tabs>
      <el-dialog v-model="tplPreview.visible" title="模板预览" width="min(640px, 92vw)"><p class="muted">{{ tplPreview.subject }}</p><div class="tpl-preview-box" v-html="tplPreview.html"></div><details><summary>纯文本兜底</summary><pre class="mail-body">{{ tplPreview.text }}</pre></details><template #footer><el-button type="primary" @click="tplPreview.visible=false">关闭</el-button></template></el-dialog>
      <el-dialog v-model="tplTest.visible" title="发送测试邮件" width="min(440px, 92vw)"><p class="muted">按当前模板渲染发给指定地址（默认你的邮箱），发送记录进「通知」tab。</p><el-input v-model="tplTest.to" placeholder="收件邮箱"/><template #footer><el-button @click="tplTest.visible=false">取消</el-button><el-button type="primary" :loading="tplTest.loading" @click="submitTplTest">发送</el-button></template></el-dialog>
    </template>
    <template v-else>
      <div class="module-card"><el-empty description="未知模块"/></div>
    </template>
      <BulkResultDialog v-model="bulkResult.visible" :result="bulkResult.result"/>
  </div>
</template>

<script setup>
import { computed,onBeforeUnmount,onMounted,reactive,ref,watch } from 'vue';
import { useRoute,useRouter } from 'vue-router';
import PaginationBar from '../components/PaginationBar.vue';
import MailSettingsForm from '../components/MailSettingsForm.vue';
import BulkBar from '../components/BulkBar.vue';
import BulkResultDialog from '../components/BulkResultDialog.vue';
import UserCreateDrawer from '../components/UserCreateDrawer.vue';
import { useBulkSelection,promptBulkConfirm } from '../composables/useBulkSelection.js';
import { useListPagination } from '../composables/useListPagination.js';
import { copyText } from '../utils/clipboard.js';
import { ElMessage,ElMessageBox } from 'element-plus';
import { fmtDateTime as dateTime } from '../utils/siteTime.js';
const props=defineProps({section:{type:String,required:true},me:{type:Object,default:null}});
const route=useRoute(),router=useRouter();
// 窄屏（手机）：其余表格由 .m-console 的「左右滑动查看更多」提示覆盖（docs/MOBILE-FIX.md §3D）
const mobileQuery=typeof window!=='undefined'&&window.matchMedia?window.matchMedia('(max-width: 760px)'):null;
const isMobile=ref(Boolean(mobileQuery&&mobileQuery.matches));
function onMobileChange(e){isMobile.value=e.matches;}
if(mobileQuery){if(mobileQuery.addEventListener)mobileQuery.addEventListener('change',onMobileChange);else mobileQuery.addListener(onMobileChange);}
const loading=ref(false),saving=ref(false),users=ref([]),recycleGames=ref([]),steamAccounts=ref([]),unownedAccounts=ref([]),steamLimit=ref(5),steamError=ref(''),activeAccount=ref(null),libraryGames=ref([]),apiKeyDialog=ref({visible:false,row:null,value:''}),smtp=ref({}),mailMessage=ref(''),mailOk=ref(false),smtpTrace=ref(''),testEmail=ref(''),mailPageTab=ref('config');
// AT 批（docs/ADMIN-CONSOLE-IA.md §3/§7）：新建用户改右侧抽屉；未保存守卫由 UserCreateDrawer 自己注册。
const newUserDrawer=ref(false);
function openNewUserDrawer(){newUserDrawer.value=true;const q={...route.query,drawer:'new'};router.replace({path:'/console',query:q}).catch(()=>{});}
// 抽屉关闭：去掉 URL 里的 drawer（保留 section 与其它参数），刷新不会回到空白页
function closeNewUserDrawer(){if(route.query.drawer){const q={...route.query};delete q.drawer;router.replace({path:'/console',query:q}).catch(()=>{});}}
// ?section=users&drawer=new 直达；drawer 参数被外部清掉时同步关抽屉
watch(()=>route.query.drawer,(d)=>{if(props.section==='users')newUserDrawer.value=String(d??'')==='new';});
function goOpLogs(tab){router.push({path:'/console',query:{section:'op-logs',tab}}).catch(()=>{});}
const usersPager=useListPagination(users), recyclePager=useListPagination(recycleGames), steamPager=useListPagination(libraryGames);
const pagedUsers=usersPager.items, usersPage=usersPager.page, usersPageSize=usersPager.pageSize;
const pagedRecycleGames=recyclePager.items, recyclePage=recyclePager.page, recyclePageSize=recyclePager.pageSize;
const pagedSteamGames=steamPager.items, steamPage=steamPager.page, steamPageSize=steamPager.pageSize;
// ---- 批量操作（docs/ADMIN-BULK-ACTIONS.md）：回收站 + 用户列表 ----
const recycleTable=ref(null),usersTable=ref(null);
const sel={
  recycle:reactive(useBulkSelection((r)=>r.id,recycleTable)),
  users:reactive(useBulkSelection((r)=>r.id,usersTable)),
};
const bulkResult=reactive({visible:false,result:null}),bulkRunning=ref('');
const recycleBulkActions=[{key:'restore',label:'恢复',target:'games',action:'restore'}];
// 「禁用」要拦住两件事：勾到自己、勾掉全部可用管理员（服务端另有 409 兜底）
const activeAdminIds=computed(()=>users.value.filter((u)=>u.role==='admin'&&!u.disabled).map((u)=>u.id));
const disableBlocked=computed(()=>{
  const keys=sel.users.selectedKeys;
  if(!keys.length)return false;
  if(props.me?.id&&keys.includes(props.me.id))return true;
  const admins=activeAdminIds.value;
  return admins.length>0&&admins.every((id)=>keys.includes(id));
});
const usersBulkHint=computed(()=>sel.users.selectedKeys.includes(props.me?.id)?'不能禁用自己的账号':(disableBlocked.value?'不能禁用全部可用管理员':''));
const usersBulkActions=computed(()=>[{key:'disable',label:'禁用',target:'users',action:'disable',risk:'high',disabled:disableBlocked.value},{key:'enable',label:'启用',target:'users',action:'enable'}]);
function api(path,opts={}){return fetch(path,{credentials:'same-origin',...opts,headers:{'content-type':'application/json',...(opts.headers||{})}}).then(async r=>{const t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch{}if(r.status===401){window.location.href='/login?next='+encodeURIComponent(location.pathname+location.search);throw new Error(d.error||'登录已过期');}if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);return d;});}
function body(method,data){return {method,body:JSON.stringify(data)};}
function notify(e){ElMessage.error(e?.message||String(e));}
// AJ 批：账号变更通知回执（docs/USER-LIFECYCLE.md 验收 6/7）——删除/改邮箱是字符串，
// PATCH/重置密码是 { status, error }；发送成功不打扰，跳过与失败要提示
function toastNotify(d){const n=d?.notify;if(!n)return;if(typeof n==='string'){if(n==='skipped_no_email')ElMessage.info('该用户未绑定邮箱，未发送通知');return;}if(n.status==='sent')return;if(n.status==='skipped_no_email')ElMessage.info('已保存（该用户未绑定邮箱，未发送通知）');else if(n.status==='skipped_disabled')ElMessage.info('已保存（通知模板已停用，未发送）');else if(n.status==='failed')ElMessage.warning(`已保存，但通知发送失败：${n.error||''}`);}
function price(v){return v==null?'—':`¥${(Number(v)/100).toFixed(2)}`;}
async function act(fn){saving.value=true;try{await fn();}catch(e){notify(e);}finally{saving.value=false;}}
// 批量执行：高危动作先手输条数（服务端还要校验 confirmCount），成功后弹结果并刷新列表。
async function runBulk(action,selection,{options,refresh}={}){
  const keys=selection.selectedKeys.slice();
  if(!keys.length)return ElMessage.warning('请先勾选要操作的条目');
  let confirmCount;
  if(action.risk==='high'){
    confirmCount=await promptBulkConfirm(keys.length,action.label);
    if(confirmCount==null)return;
  }
  bulkRunning.value=action.key;
  try{
    const payload={target:action.target,action:action.action,keys};
    if(options)payload.options=options;
    if(confirmCount!=null)payload.confirmCount=confirmCount;
    const d=await api('/api/admin/bulk',body('POST',payload));
    bulkResult.result=d;bulkResult.visible=true;
    selection.clear();
    if(refresh)await refresh();
  }catch(e){notify(e);}
  finally{bulkRunning.value='';}
}
// 回收站「全选当前筛选」：列表一次最多拉 1000 条，与后端单次上限一致
function selectAllRecycle(){if(!recycleGames.value.length)return;sel.recycle.selectRows(recycleGames.value);}
async function loadUsers(){sel.users.clear();loading.value=true;try{const d=await api('/api/admin/users');users.value=d.users||[];}catch(e){notify(e);}finally{loading.value=false;}}
// AL 批（docs/AUTH-REDESIGN.md §5.5）：临时密码只在创建/重置后展示一次，可复制、不可再次查看
const tempPwd=ref('');
const tempPwdDialog=ref(false);
function showTempPassword(pwd){tempPwd.value=pwd;tempPwdDialog.value=true;}
async function copyTempPassword(){const ok=await copyText(tempPwd.value);ok?ElMessage.success('已复制'):ElMessage.warning('复制失败，请手动选择');}
async function editName(row){try{const {value}=await ElMessageBox.prompt(`修改 ${row.username} 的显示名；留空清除`,'修改显示名',{inputValue:row.display_name||''});const d=await api(`/api/admin/users/${encodeURIComponent(row.username)}`,body('PATCH',{display_name:value}));toastNotify(d);await loadUsers();}catch(e){if(e!=='cancel'&&e!=='close')notify(e);}}
async function editEmail(row){try{const {value}=await ElMessageBox.prompt('输入登录邮箱；留空解绑','绑定邮箱',{inputValue:row.email||'',inputType:'email'});const d=await api(`/api/admin/users/${encodeURIComponent(row.username)}/email`,body('POST',{email:value.trim()}));if(value.trim()){ElMessage.success(d.notify==='queued'?'邮箱已绑定，需重新验证（变更通知邮件稍后发送）':'邮箱已绑定，需重新验证');}else{ElMessage.success('邮箱已解绑');}await loadUsers();}catch(e){if(e!=='cancel'&&e!=='close')notify(e);}}
async function verifyEmail(row){await act(async()=>{const d=await api(`/api/admin/users/${encodeURIComponent(row.username)}/email/code`,body('POST',{}));const {value}=await ElMessageBox.prompt(`${d.hint||'验证码已发送'}，输入邮件中的 6 位验证码`,'验证邮箱',{inputPattern:/^\d{6}$/,inputErrorMessage:'请输入 6 位验证码'});await api(`/api/admin/users/${encodeURIComponent(row.username)}/email/verify`,body('POST',{code:value.trim()}));ElMessage.success('邮箱已验证');await loadUsers();});}
async function resetPassword(row){try{const {value}=await ElMessageBox.prompt('新密码 ≥12 位；留空将生成临时密码（只显示一次），用户首次登录需修改','重置密码',{inputType:'password',inputPattern:/^$|^.{12,200}$/,inputErrorMessage:'密码至少 12 位，或留空生成临时密码'});const d=await api(`/api/admin/users/${encodeURIComponent(row.username)}/password`,body('POST',{password:value}));if(d.tempPassword)showTempPassword(d.tempPassword);ElMessage.success('密码已重置');toastNotify(d);}catch(e){if(e!=='cancel'&&e!=='close')notify(e);}}
async function toggleUser(row){try{await ElMessageBox.confirm(`${row.disabled?'启用':'禁用'}账号 ${row.username}？`,'确认操作',{type:'warning'});const d=await api(`/api/admin/users/${encodeURIComponent(row.username)}`,body('PATCH',{disabled:!row.disabled}));toastNotify(d);await loadUsers();}catch(e){if(e!=='cancel'&&e!=='close')notify(e);}}
// AK-2（docs/AUTH-REDESIGN.md §4.4）：锁定标记与管理员解锁
function isLocked(row){const t=row?.locked_until;return Boolean(t&&Date.parse(t)>Date.now());}
async function unlockUser(row){try{await api(`/api/admin/users/${encodeURIComponent(row.username)}/unlock`,body('POST',{}));ElMessage.success('已解锁');await loadUsers();}catch(e){notify(e);}}
async function loadRecycle(){sel.recycle.clear();loading.value=true;try{const d=await api('/api/admin/games/deleted?limit=1000');recycleGames.value=d.games||[];}catch(e){notify(e);}finally{loading.value=false;}}
async function restoreGame(row){await act(async()=>{const path=row.steam_appid?`/api/games/${row.steam_appid}/deleted`:`/api/games/id/${row.id}/deleted`;await api(path,body('POST',{deleted:false}));ElMessage.success('游戏已恢复');await loadRecycle();});}
async function loadSteam(){loading.value=true;try{const d=await api('/api/steam/accounts');steamAccounts.value=d.accounts||[];unownedAccounts.value=d.unowned||[];steamLimit.value=Number(d.limit)||5;if(activeAccount.value){const cur=steamAccounts.value.find((a)=>a.steam_id===activeAccount.value.steam_id);if(!cur){activeAccount.value=null;libraryGames.value=[];}}}catch(e){notify(e);}finally{loading.value=false;}}
function bindSteam(){if(steamAccounts.value.length>=steamLimit.value)return;window.location.href='/api/auth/steam/start';}
async function syncSteam(row,kind){await act(async()=>{const d=await api(`/api/steam/accounts/${encodeURIComponent(row.steam_id)}/${kind}/sync`,body('POST',{}));if(kind==='library')ElMessage.success(`已同步 ${d.total||0} 款游戏（差集清理 ${d.deleted||0} 条${d.typeUnknown>0?`，类型未知 ${d.typeUnknown} 款已尝试补全`:''}）`);else ElMessage.success(`已同步 ${d.total||0} 个愿望单（新增提醒 ${d.watches||0}，目录未命中 ${d.skipped||0}）`);await loadSteam();});}
async function editAlias(row){try{const {value}=await ElMessageBox.prompt('给这个 Steam 账号起个别名（留空清除）','修改别名',{inputValue:row.alias||''});await api(`/api/steam/accounts/${encodeURIComponent(row.steam_id)}`,body('PATCH',{alias:value.trim()}));ElMessage.success('别名已保存');await loadSteam();}catch(e){if(e!=='cancel'&&e!=='close')notify(e);}}
function editApiKey(row){apiKeyDialog.value={visible:true,row,value:''};}
async function saveApiKey(clear){const row=apiKeyDialog.value.row;if(!row)return;await act(async()=>{await api(`/api/steam/accounts/${encodeURIComponent(row.steam_id)}`,body('PATCH',clear?{clearApiKey:true}:{apiKey:apiKeyDialog.value.value.trim()}));apiKeyDialog.value.visible=false;ElMessage.success(clear?'API Key 已清除':'API Key 已保存（密文存储，不回显）');await loadSteam();});}
async function unbindSteam(row){try{await ElMessageBox.confirm(`解绑「${row.alias||row.persona_name||row.steam_id}」？游戏库与愿望单数据会被删除，愿望单自动提醒一并清理，手动标记保留。`,'确认解绑',{type:'warning'});await api(`/api/steam/accounts/${encodeURIComponent(row.steam_id)}`,body('DELETE',{}));ElMessage.success('已解绑');activeAccount.value=null;libraryGames.value=[];await loadSteam();}catch(e){if(e!=='cancel'&&e!=='close')notify(e);}}
async function claimSteam(row){await act(async()=>{await api(`/api/steam/accounts/${encodeURIComponent(row.steam_id)}/claim`,body('POST',{}));ElMessage.success('已认领到当前管理员，可用「同步游戏库」拉取数据');await loadSteam();});}
async function toggleLibrary(row){if(activeAccount.value?.steam_id===row.steam_id){activeAccount.value=null;libraryGames.value=[];return;}activeAccount.value=row;libraryGames.value=[];loading.value=true;try{const d=await api(`/api/steam/accounts/${encodeURIComponent(row.steam_id)}/library`);libraryGames.value=d.games||[];}catch(e){notify(e);}finally{loading.value=false;}}
function consumeSteamQuery(){if(typeof window==='undefined')return;const q=new URLSearchParams(window.location.search);const err=q.get('steamError');if(err){steamError.value={state:'绑定链接已失效或过期，请重新发起绑定',conflict:'该 Steam 账号已被其他用户绑定',limit:'最多绑定 5 个 Steam 账号',verify:'Steam 校验失败，请重试'}[err]||'绑定失败，请重试';}if(q.get('steamBound'))ElMessage.success('Steam 账号已绑定，正在自动同步游戏库与愿望单');if(err||q.get('steamBound')){q.delete('steamError');q.delete('steamBound');const s=q.toString();history.replaceState(null,'',location.pathname+(s?'?'+s:''));}}
async function loadMail(){loading.value=true;try{const d=await api('/api/admin/smtp');smtp.value=d.smtp||{};}catch(e){notify(e);}finally{loading.value=false;}}
async function sendTestMail(){if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail.value.trim()))return ElMessage.warning('请输入有效的接收邮箱');mailMessage.value='正在发送…';smtpTrace.value='';await act(async()=>{try{const d=await api('/api/admin/smtp/test',body('POST',{to:testEmail.value.trim()}));mailOk.value=true;mailMessage.value='测试邮件已发送';smtpTrace.value=(d.steps||[]).map(x=>`${x.cmd} → ${x.code}`).join('  |  ');}catch(e){mailOk.value=false;mailMessage.value=e.message;smtpTrace.value=(e.steps||[]).map(x=>`${x.cmd} → ${x.code} ${x.text||''}`).join('\n');throw e;}});await loadMail();}
// ---- 邮件模板（docs/USER-LIFECYCLE.md §5.2，AI 批）；发送记录已搬进操作日志（AT 批）----
const templates=ref([]),tplSamples=ref([]),tplActive=ref('account_disabled'),tplSample=ref(''),savingTpl=ref(false);
const tplPreview=reactive({visible:false,subject:'',html:'',text:''});
const tplTest=reactive({visible:false,event:'',to:'',loading:false});
function varLabel(v){return '{' + '{' + v + '}' + '}';}
async function loadTemplates(){try{const d=await api('/api/admin/mail/templates');templates.value=d.templates||[];tplSamples.value=d.samples||[];}catch(e){notify(e);}}
function applySample(){const s=tplSamples.value.find((x)=>x.id===tplSample.value);const t=templates.value.find((x)=>x.event===tplActive.value);if(!s||!t)return ElMessage.warning('先选择一套示例');t.subject=s.subject;t.body_html=s.bodyHtml;tplSample.value='';ElMessage.info('示例已填入（未保存，点「保存」生效）');}
function insertVar(v){const t=templates.value.find((x)=>x.event===tplActive.value);if(t)t.body_html=(t.body_html||'')+('{{'+v+'}}');}
async function saveTemplate(t){savingTpl.value=true;try{const d=await api(`/api/admin/mail/templates/${t.event}`,body('PUT',{subject:t.subject,body_html:t.body_html,body_text:null,enabled:t.enabled}));ElMessage.success('模板已保存，下一封邮件即生效');(d.warnings||[]).forEach((w)=>ElMessage.warning(w));}catch(e){notify(e);}finally{savingTpl.value=false;}}
async function previewTemplate(t){try{const d=await api(`/api/admin/mail/templates/${t.event}/preview`,body('POST',{}));tplPreview.visible=true;tplPreview.subject=d.subject;tplPreview.html=d.html;tplPreview.text=d.text;}catch(e){notify(e);}}
async function resetTemplate(t){try{await api(`/api/admin/mail/templates/${t.event}/reset`,body('POST',{}));ElMessage.success('已恢复默认');await loadTemplates();}catch(e){notify(e);}}
function testTemplate(t){tplTest.visible=true;tplTest.event=t.event;tplTest.to=props.me?.email||'';tplTest.loading=false;}
async function submitTplTest(){tplTest.loading=true;try{const d=await api(`/api/admin/mail/templates/${tplTest.event}/test`,body('POST',{to:tplTest.to.trim()}));ElMessage.success(d.ok?'测试邮件已发送':'发送失败');tplTest.visible=false;}catch(e){notify(e);}finally{tplTest.loading=false;}}
// ---- 用户彻底删除（docs/USER-LIFECYCLE.md §5.1，AH 批）----
const deleting=ref(false);
const deleteDialog=reactive({visible:false,username:'',sessions:0,steamAccounts:0,confirm:'',reason:''});
function canDeleteUser(row){if(row.role!=='admin'||row.disabled)return true;return !(activeAdminIds.value.length<=1&&activeAdminIds.value.includes(row.id));}
function openDeleteUser(row){deleteDialog.visible=true;deleteDialog.username=row.username;deleteDialog.sessions=Number(row.sessions||0);deleteDialog.steamAccounts=Number(row.steam_accounts||0);deleteDialog.confirm='';deleteDialog.reason='';}
async function submitDeleteUser(){if(deleteDialog.confirm!==deleteDialog.username)return;deleting.value=true;try{const username=deleteDialog.username;const d=await api(`/api/admin/users/${encodeURIComponent(username)}`,body('DELETE',{confirmUsername:deleteDialog.confirm,reason:deleteDialog.reason.trim()||undefined}));ElMessage.success(d.notify==='queued'?'已删除，通知邮件稍后发送':(d.notify==='skipped_no_email'?'已删除（该用户未绑定邮箱，未发送通知）':'已删除'));deleteDialog.visible=false;sel.users.clear();const wasLastOnPage=pagedUsers.value.length===1&&usersPage.value>1;if(wasLastOnPage)usersPage.value-=1;await loadUsers();}catch(e){notify(e);}finally{deleting.value=false;}}
watch(()=>props.section,s=>{if(s==='users'){loadUsers();if(route.query.drawer==='new')newUserDrawer.value=true;}else if(s==='recycle')loadRecycle();else if(s==='steam'){consumeSteamQuery();loadSteam();}else if(s==='mail'){loadMail();loadTemplates();}});
// 翻页清空选择（常规列表只支持本页勾选）；回收站例外：可用「全选当前筛选」一次性选满
watch(recyclePage,()=>sel.recycle.clear());watch(usersPage,()=>sel.users.clear());
watch(newUserDrawer,(v)=>{if(!v)closeNewUserDrawer();});
onMounted(()=>{if(props.section==='users'){loadUsers();if(route.query.drawer==='new')newUserDrawer.value=true;}else if(props.section==='recycle')loadRecycle();else if(props.section==='steam'){consumeSteamQuery();loadSteam();}else if(props.section==='mail'){loadMail();loadTemplates();}});
onBeforeUnmount(()=>{if(mobileQuery){if(mobileQuery.removeEventListener)mobileQuery.removeEventListener('change',onMobileChange);else mobileQuery.removeListener(onMobileChange);}});
</script>

<style scoped>
.extra-wrap{display:flex;flex-direction:column;gap:14px;padding-bottom:24px;min-width:0}.module-card{background:var(--panel);border:1px solid var(--border);border-radius:13px;padding:16px;box-shadow:0 3px 14px #26345a06;min-width:0}.card-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:13px}.card-heading h3{font-size:14px;margin:0;color:var(--fg)}.card-heading p{font-size:11px;color:var(--fg-muted);margin:4px 0 0}.user-create{display:grid;grid-template-columns:1fr 1.2fr 1.4fr 150px auto;gap:8px}.table-card{padding:0;overflow:hidden}.tag-gap{margin-left:7px}.delete-alert{margin-bottom:12px}.delete-confirm-input{margin-bottom:10px}.mail-tpl-card .card-heading{align-items:flex-start}.tpl-head-actions{display:flex;gap:8px;flex:none;align-items:center}.tpl-tabs .tpl-row{display:flex;align-items:center;gap:10px;margin-bottom:10px}.tpl-switch-row{justify-content:space-between}.tpl-row label{flex:none;width:130px;font-size:12px;color:var(--fg-muted)}.tpl-html{flex:1}.tpl-vars{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px 140px}.tpl-var-btn{border:1px solid var(--border);border-radius:8px;background:var(--panel-2);color:var(--brand);font:12px/1.6 ui-monospace,Consolas,monospace;padding:3px 8px;cursor:pointer}.tpl-actions{display:flex;gap:8px;margin-left:140px;flex-wrap:wrap}.tpl-preview-box{border:1px solid var(--border);border-radius:10px;padding:14px;max-height:420px;overflow:auto;background:var(--panel-2)}.mail-log-tabs .el-tabs__header{margin:0 16px}.recycle-summary{display:flex;align-items:center;gap:18px}.recycle-summary>div{display:grid;gap:3px}.recycle-summary>div strong{font-size:24px}.recycle-summary>div small{color:var(--fg-muted);font-size:10px}.recycle-summary p{flex:1;color:var(--fg-muted);font-size:11px}.steam-account{display:block}.steam-account .card-heading .steam-actions{display:flex;gap:6px;flex-wrap:wrap}.steam-alert{margin-bottom:12px}.steam-account-cell{display:flex;align-items:center;gap:10px}.steam-avatar-img{width:36px;height:36px;border-radius:7px;object-fit:cover}.steam-account-cell small{display:block;color:var(--fg-muted);font-size:10px;margin-top:3px}.card-heading.padded{padding:16px 16px 0}.game-admin{display:flex;align-items:center;gap:10px}.game-admin img{width:76px;height:36px;object-fit:cover;border-radius:5px}.game-admin small,.extra-wrap td small{display:block;color:var(--fg-muted);font-size:10px;margin-top:3px}.metric-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.metric-card{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:13px 15px;display:grid;gap:8px}.metric-card span{font-size:11px;color:var(--fg-muted)}.metric-card strong{font-size:16px}.status-text.good{color:var(--success)}.status-text.warning{color:var(--warn)}.mail-test{display:flex;gap:8px;max-width:620px;margin-bottom:12px}.mail-test .el-input{flex:1}.smtp-trace{padding:10px;background:var(--panel-2);border-radius:8px;color:var(--fg-muted);font:11px ui-monospace,Consolas,monospace;white-space:pre-wrap}.mail-body{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--panel-2);padding:14px;border-radius:9px;max-height:50vh;overflow:auto;font:12px/1.6 ui-monospace,Consolas,monospace}.log-filters{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.log-filters>.el-select{width:150px}.log-filters>.el-input{flex:1;min-width:200px}.log-summary{display:flex;align-items:center;gap:12px;color:var(--fg-muted);font-size:10px}.log-summary strong{color:var(--fg)}.log-summary .el-button{margin-left:auto}.log-list{display:grid;gap:7px}.log-entry{display:grid;grid-template-columns:155px 62px minmax(120px,220px) minmax(0,1fr);align-items:start;gap:9px;padding:11px 13px;border:1px solid var(--border);border-left:3px solid var(--fg-subtle);border-radius:9px;background:var(--panel);font-size:10px}.log-entry.error{border-left-color:var(--danger)}.log-entry.warn,.log-entry.warning{border-left-color:var(--warn)}.log-entry time{color:var(--fg-muted)}.log-entry strong{overflow-wrap:anywhere;color:var(--fg)}.log-entry pre{margin:0;color:var(--fg-muted);white-space:pre-wrap;overflow-wrap:anywhere}.muted{color:var(--fg-muted)}
.sync-run-failed{background:var(--danger-bg)!important}.text-danger{color:var(--danger)}
/* AT 批：邮件服务 3 tab + 页头「查看发送记录」入口 */
.mail-page-head{display:flex;justify-content:flex-end;gap:8px}
.mail-page-tabs :deep(.el-tabs__header){margin-bottom:14px}
.mail-page-tabs :deep(.el-tab-pane){display:flex;flex-direction:column;gap:14px}
@media(max-width:900px){.user-create{grid-template-columns:repeat(2,minmax(0,1fr))}.metric-grid{grid-template-columns:repeat(3,minmax(100px,1fr))}.log-entry{grid-template-columns:125px 55px minmax(100px,1fr)}}
@media(max-width:560px){.user-create{grid-template-columns:1fr}.user-create>*{width:100%}.recycle-summary{align-items:flex-start;flex-wrap:wrap}.recycle-summary p{flex-basis:100%;margin:0}.steam-account .card-heading{flex-wrap:wrap}.steam-account .steam-actions{width:100%}.mail-test{flex-wrap:wrap}.mail-test>.el-input{flex-basis:100%}.log-filters>.el-select{flex:1;width:auto}.log-filters>.el-input{flex-basis:100%;min-width:0}.log-entry{grid-template-columns:1fr auto;gap:5px}.log-entry strong,.log-entry pre{grid-column:1/-1}}
:global(.admin-content){overflow-y:auto}
</style>
