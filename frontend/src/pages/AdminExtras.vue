<template>
  <div class="extra-wrap" :class="{ 'm-console': isMobile }">
    <template v-if="section==='users'">
      <div class="module-card"><div class="card-heading"><div><h3>用户管理</h3><p>管理账号与角色；用户只能自助注册，不提供新增入口。</p></div><div class="steam-actions"><el-button @click="loadUsers">刷新列表</el-button><el-button text @click="goOpLogs('user-deletions')">最近删除 ↗</el-button></div></div></div>
      <div v-if="!isMobile" class="module-card table-card"><BulkBar :count="sel.users.count" :actions="usersBulkActions" :running="bulkRunning" :hint="usersBulkHint" @run="(a)=>runBulk(a,sel.users,{refresh:loadUsers})" @clear="sel.users.clear()"/><el-table ref="usersTable" row-key="id" :data="pagedUsers" v-loading="loading" stripe @selection-change="sel.users.onSelectionChange"><el-table-column type="selection" width="44"/><el-table-column label="用户" min-width="150"><template #default="{row}"><span class="user-cell"><UserAvatar :user-id="row.id" :name="row.display_name||row.username" :size="22" /><span>{{ row.display_name||row.username }}</span></span></template></el-table-column><el-table-column label="邮箱" min-width="200"><template #default="{row}"><span>{{ row.email||'未绑定' }}</span><el-tag v-if="row.email" :type="row.email_verified?'success':'warning'" size="small" class="tag-gap">{{ row.email_verified?'已验证':'未验证' }}</el-tag></template></el-table-column><el-table-column label="角色" width="95"><template #default="{row}"><el-tag :type="row.role==='admin'?'danger':'info'" size="small">{{ row.role==='admin'?'管理员':'普通用户' }}</el-tag></template></el-table-column><el-table-column label="状态" width="215"><template #default="{row}"><el-tag :type="row.disabled?'info':'success'" size="small">{{ row.disabled?'已禁用':'正常' }}</el-tag><el-tag v-if="isLocked(row)" type="danger" size="small" class="tag-gap">已锁定</el-tag><el-tag v-if="row.weak_password" type="danger" size="small" class="tag-gap">弱密码</el-tag><el-tag v-if="row.must_change_password" type="warning" size="small" class="tag-gap">需改密</el-tag><el-button v-if="isLocked(row)" link type="primary" size="small" class="tag-gap" @click="unlockUser(row)">解锁</el-button></template></el-table-column><el-table-column label="最近登录" min-width="155"><template #default="{row}">{{ dateTime(row.last_login_at) }}</template></el-table-column><el-table-column label="管理操作" min-width="255" fixed="right"><template #default="{row}"><el-button link type="primary" @click="openEditUser(row)">编辑</el-button><el-button link @click="openResetPassword(row)">重置密码</el-button><el-button link type="warning" @click="kickAllSessions(row)">踢会话</el-button><el-button link :type="row.disabled?'success':'danger'" @click="toggleUser(row)">{{ row.disabled?'启用':'禁用' }}</el-button><el-button v-if="row.id !== me?.id" link type="danger" :disabled="!canDeleteUser(row)" :title="canDeleteUser(row) ? '' : '最后一个可用管理员不能删除'" @click="openDeleteUser(row)">删除</el-button></template></el-table-column></el-table><PaginationBar v-model:page="usersPage" v-model:page-size="usersPageSize" :total="users.length"/></div>
      <template v-else>
        <BulkBar :count="sel.users.count" :actions="usersBulkActions" :running="bulkRunning" :hint="usersBulkHint" @run="(a)=>runBulk(a,sel.users,{refresh:loadUsers})" @clear="sel.users.clear()"/>
        <div class="game-card-list"><div v-for="u in pagedUsers" :key="u.id" class="admin-card">
          <div class="admin-card-pick"><el-checkbox :model-value="sel.users.has(u)" @change="sel.users.toggle(u)">选择</el-checkbox></div>
          <div class="admin-card-main"><strong><UserAvatar :user-id="u.id" :name="u.display_name||u.username" :size="20" class="card-avatar" /> {{ u.display_name||u.username }}</strong><small>{{ u.email||'未绑定' }}</small><small class="muted">{{ u.role==='admin'?'管理员':'普通用户' }} · 最近登录 {{ dateTime(u.last_login_at) }}</small><p class="admin-card-tags"><el-tag v-if="u.disabled" type="info" size="small">已禁用</el-tag><el-tag v-if="isLocked(u)" type="danger" size="small">已锁定</el-tag><el-tag v-if="u.weak_password" type="danger" size="small">弱密码</el-tag><el-tag v-if="u.must_change_password" type="warning" size="small">需改密</el-tag></p></div>
          <div class="admin-card-actions"><el-button link type="primary" @click="openEditUser(u)">编辑</el-button><el-button link @click="openResetPassword(u)">重置密码</el-button><el-button link type="warning" @click="kickAllSessions(u)">踢会话</el-button><el-button link :type="u.disabled?'success':'danger'" @click="toggleUser(u)">{{ u.disabled?'启用':'禁用' }}</el-button><el-button v-if="u.id !== me?.id" link type="danger" :disabled="!canDeleteUser(u)" @click="openDeleteUser(u)">删除</el-button></div>
        </div><el-empty v-if="!pagedUsers.length" description="暂无用户"/></div>
        <PaginationBar v-model:page="usersPage" v-model:page-size="usersPageSize" :total="users.length"/>
      </template>
      <el-dialog v-model="deleteDialog.visible" title="彻底删除用户" width="min(480px, 92vw)"><el-alert class="delete-alert" type="error" :closable="false" title="删除后该用户立即退出登录，数据不可恢复" description="将删除：登录会话 N 个、绑定 Steam 账号 M 个、愿望单与游戏标记；用户名可立即重新注册。"><template #default><p class="muted">将删除「{{ deleteDialog.username }}」的：登录会话 {{ deleteDialog.sessions }} 个、绑定 Steam 账号 {{ deleteDialog.steamAccounts }} 个、愿望单与游戏标记；删除后用户名可立即重新注册。</p></template></el-alert><el-input v-model="deleteDialog.confirm" class="delete-confirm-input" :placeholder="`输入用户名 ${deleteDialog.username} 确认删除`" maxlength="80"/><el-input v-model="deleteDialog.reason" type="textarea" :rows="2" maxlength="500" placeholder="删除原因（可选，只进审计，不进邮件）"/><template #footer><el-button @click="deleteDialog.visible=false">取消</el-button><el-button type="danger" :disabled="deleteDialog.confirm !== deleteDialog.username" :loading="deleting" @click="submitDeleteUser">确认删除</el-button></template></el-dialog>      <el-dialog v-model="tempPwdDialog" title="临时密码（仅显示一次）" width="min(440px, 92vw)"><p class="muted">请立即复制并交给用户；关闭后无法再次查看，用户首次登录必须修改密码。</p><el-input :model-value="tempPwd" readonly/><template #footer><el-button type="primary" @click="copyTempPassword">复制</el-button><el-button @click="tempPwdDialog=false">关闭</el-button></template></el-dialog>
      <!-- DT-4（docs/ADMIN-PERMISSIONS.md）：重置密码弹窗——打开不发码，点「发送验证码」才发；
           验证失败不关弹窗（还剩 N 次机会）；过期显示「重新发送」（demo ③ admin-users-2026-11-19.html） -->
      <el-dialog v-model="resetPwd.visible" title="重置密码" width="min(420px, 92vw)" :close-on-click-modal="false" @closed="closeResetPwd">
        <p class="muted">给「{{ resetPwd.username }}」发送重置验证码（发到绑定邮箱）</p>
        <div class="rp-field"><label>邮箱</label><div class="rp-ro">{{ resetPwd.email }}</div></div>
        <div class="rp-field"><label>验证码</label>
          <div class="rp-code-row"><el-input v-model="resetPwd.code" placeholder="6 位数字" maxlength="6" /><el-button type="primary" :disabled="!resetPwd.email || resetPwd.sending || resetPwd.cooldown > 0" @click="sendResetCode">{{ resetPwd.sending ? '发送中…' : resetPwd.cooldown > 0 ? `${resetPwd.cooldown}s 后重发` : resetPwd.codeSent ? '重新发送' : '发送验证码' }}</el-button></div>
        </div>
        <p v-if="resetPwd.hint" class="rp-hint-ok">{{ resetPwd.hint }}</p>
        <p v-if="resetPwd.error" class="rp-hint-err">{{ resetPwd.error }}</p>
        <template #footer>
          <el-button @click="resetPwd.visible=false">取消</el-button>
          <el-button type="primary" :loading="resetPwd.verifying" :disabled="!/^\d{6}$/.test(resetPwd.code.trim())" @click="confirmResetPwd">确认重置</el-button>
        </template>
      </el-dialog>
      <!-- DT-3（docs/ADMIN-PERMISSIONS.md DT-3）：编辑用户弹窗——仅可改角色；用户名/邮箱/绑定 Steam 账号只读 -->
      <el-dialog v-model="editUserDialog.visible" title="编辑用户" width="min(440px, 92vw)"><p class="muted">{{ editUserDialog.row?.display_name || editUserDialog.row?.username }} · 仅可修改角色</p><div class="edit-user-field"><label>用户名（只读）</label><div class="val">{{ editUserDialog.row?.username }}</div></div><div class="edit-user-field"><label>邮箱（只读）</label><div class="val">{{ editUserDialog.row?.email || '未绑定' }}</div></div><div class="edit-user-field"><label>角色</label><div class="role-opts"><div class="role-opt" :class="{on:editUserDialog.role==='user'}" @click="editUserDialog.role='user'">普通用户</div><div class="role-opt" :class="{on:editUserDialog.role==='admin'}" @click="editUserDialog.role='admin'">管理员</div></div></div><div class="edit-user-field"><label>绑定的 Steam 账号（只读）</label><div class="bound"><template v-if="editUserDialog.accounts.length"><div v-for="a in editUserDialog.accounts" :key="a.steamId"><b>{{ a.alias || a.personaName || a.steamId }}</b> · {{ a.steamId }}</div></template><span v-else>未绑定</span></div></div><template #footer><el-button @click="editUserDialog.visible=false">取消</el-button><el-button type="primary" :loading="saving" @click="submitUserEdit">保存</el-button></template></el-dialog>
    </template>
    <template v-else-if="section==='recycle'">
      <div class="module-card recycle-summary"><div><span class="muted">回收站</span><strong>{{ recycleGames.length }}</strong><small>款游戏</small></div><p>这里只做逻辑删除。恢复后会重新出现在前台目录，价格与历史数据会保留。</p><el-button :disabled="!recycleGames.length" @click="selectAllRecycle">全选当前筛选（{{ recycleGames.length }} 条）</el-button><el-button @click="loadRecycle">刷新</el-button></div>
      <div v-if="!isMobile" class="module-card table-card"><BulkBar :count="sel.recycle.count" :actions="recycleBulkActions" :running="bulkRunning" hint="最多一次 1000 条" @run="(a)=>runBulk(a,sel.recycle,{refresh:loadRecycle})" @clear="sel.recycle.clear()"/><el-table ref="recycleTable" row-key="id" :data="pagedRecycleGames" v-loading="loading" stripe @selection-change="sel.recycle.onSelectionChange"><el-table-column type="selection" width="44"/><el-table-column prop="steam_appid" label="AppID" width="110"><template #default="{row}">{{ row.steam_appid||'—' }}</template></el-table-column><el-table-column label="游戏" min-width="220"><template #default="{row}"><div class="game-name-row"><button class="game-name" :title="row.name" @click="openGameDetail(row)">{{ row.name }}</button></div><small>{{ row.name_en||' ' }}</small></template></el-table-column><el-table-column prop="app_type" label="类型" width="90"/><el-table-column label="平台" min-width="150"><template #default="{row}"><el-tag v-for="p in row.platform_names||[]" :key="p" size="small" class="tag-gap">{{ p }}</el-tag><span v-if="!row.platform_names?.length">—</span></template></el-table-column><el-table-column prop="offer_count" label="报价数" width="90" align="right"/><el-table-column label="删除时间" min-width="155"><template #default="{row}">{{ dateTime(row.deleted_at) }}</template></el-table-column><el-table-column label="操作" width="100" fixed="right"><template #default="{row}"><el-button link type="primary" @click="restoreGame(row)">恢复</el-button></template></el-table-column></el-table><PaginationBar v-model:page="recyclePage" v-model:page-size="recyclePageSize" :total="recycleGames.length"/></div>
      <template v-else>
        <BulkBar :count="sel.recycle.count" :actions="recycleBulkActions" :running="bulkRunning" hint="最多一次 1000 条" @run="(a)=>runBulk(a,sel.recycle,{refresh:loadRecycle})" @clear="sel.recycle.clear()"/>
        <div class="game-card-list"><div v-for="g in pagedRecycleGames" :key="g.id" class="admin-card">
          <div class="admin-card-pick"><el-checkbox :model-value="sel.recycle.has(g)" @change="sel.recycle.toggle(g)">选择</el-checkbox></div>
          <div class="admin-card-main"><button class="game-name" :title="g.name" @click="openGameDetail(g)">{{ g.name }}</button><small>{{ g.name_en||' ' }} · AppID {{ g.steam_appid||'—' }} · {{ g.app_type||'—' }}</small><small class="muted">报价数 {{ g.offer_count }} · 删除于 {{ dateTime(g.deleted_at) }}</small><p class="admin-card-tags"><el-tag v-for="p in g.platform_names||[]" :key="p" size="small">{{ p }}</el-tag></p></div>
          <div class="admin-card-actions"><el-button link type="primary" @click="restoreGame(g)">恢复</el-button></div>
        </div><el-empty v-if="!pagedRecycleGames.length" description="回收站为空"/></div>
        <PaginationBar v-model:page="recyclePage" v-model:page-size="recyclePageSize" :total="recycleGames.length"/>
      </template>
    </template>
    <template v-else-if="section==='steam'">
      <div class="module-card steam-account">
        <div class="card-heading"><div><h3>绑定的 Steam 账号</h3><p>每个站点用户最多绑定 5 个 Steam 账号，一个 Steam 账号只能属于一个用户；绑定后请先为该账号配置 API Key，再点同步。</p><p>Steam API 不返回 DLC 拥有数据，故不展示 DLC 数。</p></div><div class="steam-actions"><el-button type="primary" :disabled="steamAccounts.length>=steamLimit" @click="bindSteam">{{ steamAccounts.length>=steamLimit?'已达绑定上限':'绑定新账号' }}</el-button><el-button @click="loadSteam">刷新</el-button><el-button text @click="goOpLogs('steam')">操作日志 ↗</el-button></div></div>
        <el-alert v-if="steamError" :title="steamError" type="error" :closable="false" class="steam-alert"/>
        <div v-if="!isMobile && steamAccounts.length" class="table-scroll"><el-table :data="steamAccounts" stripe>
          <el-table-column label="账号" min-width="230"><template #default="{row}"><div class="steam-account-cell"><img v-if="row.avatar" :src="row.avatar" class="steam-avatar-img" @error="$event.target.style.display='none'"><div><strong>{{ row.alias||row.persona_name||row.steam_id }}</strong><small>{{ row.alias&&row.persona_name?row.persona_name+' · ':'' }}{{ row.steam_id }}</small></div></div></template></el-table-column>
          <el-table-column label="游戏库" width="90" align="right"><template #default="{row}"><el-button link type="primary" @click="toggleLibrary(row)">{{ row.games }}</el-button></template></el-table-column>
          <el-table-column label="愿望单" width="90" align="right"><template #default="{row}">{{ row.wishlist }}</template></el-table-column>
          <el-table-column label="API Key" width="100"><template #default="{row}"><el-tag :type="row.api_key_set?'success':'info'" size="small">{{ row.api_key_set?'已配置':'未配置' }}</el-tag></template></el-table-column>
          <el-table-column label="最近同步" min-width="150"><template #default="{row}">{{ dateTime(row.library_synced_at)||'未同步' }}</template></el-table-column>
          <el-table-column label="操作" min-width="420" fixed="right"><template #default="{row}"><el-button link @click="goOpLogs('steam')">日志</el-button><el-button link type="primary" :loading="syncing(row,'library')" @click="syncSteam(row,'library')">{{ syncing(row,'library')?'同步中…':'同步游戏库' }}</el-button><el-button link :loading="syncing(row,'wishlist')" @click="syncSteam(row,'wishlist')">{{ syncing(row,'wishlist')?'同步中…':'同步愿望单' }}</el-button><el-button link @click="editAlias(row)">改别名</el-button><el-button link @click="editApiKey(row)">API Key</el-button><el-button link type="danger" @click="unbindSteam(row)">解绑</el-button></template></el-table-column>
        </el-table></div>
        <el-empty v-else-if="!isMobile" description="还没有绑定 Steam 账号，点右上角「绑定新账号」开始"/>
      </div>
      <div v-if="unownedAccounts.length" class="module-card table-card">
        <div class="card-heading padded"><div><h3>未归属的 Steam 账号（迁移认领）</h3><p>历史登录留下的账号还没有归属任何站点用户，认领后即可同步游戏库与愿望单。</p></div></div>
        <template v-if="!isMobile"><div class="table-scroll"><el-table :data="unownedAccounts" stripe><el-table-column label="账号" min-width="240"><template #default="{row}"><div class="steam-account-cell"><div><strong>{{ row.persona_name||row.steam_id }}</strong><small>{{ row.steam_id }}</small></div></div></template></el-table-column><el-table-column label="已同步游戏" width="120" align="right"><template #default="{row}">{{ row.games }}</template></el-table-column><el-table-column label="操作" width="130" fixed="right"><template #default="{row}"><el-button link type="primary" @click="claimSteam(row)">认领到当前管理员</el-button></template></el-table-column></el-table></div></template><div v-else class="game-card-list"><div v-for="row in unownedAccounts" :key="row.steam_id" class="admin-card"><div class="admin-card-main"><strong>{{ row.persona_name||row.steam_id }}</strong><small>{{ row.steam_id }} · 已同步 {{ row.games }} 款</small></div><div class="admin-card-foot"><span></span><span><el-button link type="primary" @click="claimSteam(row)">认领到当前管理员</el-button></span></div></div></div>
      </div>
      <div v-if="!isMobile && activeAccount && libraryGames.length" class="module-card table-card">
        <div class="card-heading padded"><div><h3>{{ activeAccount.alias||activeAccount.persona_name||activeAccount.steam_id }} 的游戏库</h3><p>最多显示 500 条，按游玩时长排序。</p></div><el-button text @click="activeAccount=null;libraryGames=[]">收起</el-button></div>
        <el-table :data="pagedSteamGames" v-loading="loading" stripe><el-table-column label="游戏" min-width="260"><template #default="{row}"><div class="game-admin"><img v-if="!row.coverFailed" :src="`/img/steam/${row.appid}/capsule_sm_120`" @error="row.coverFailed=true"><CoverPlaceholder v-else :name="row.name" size="sm"/><div><a :href="`https://store.steampowered.com/app/${row.appid}/`" target="_blank" rel="noopener">{{ row.name||`appid:${row.appid}` }}</a><small>AppID {{ row.appid }} · {{ row.in_db?'已在本站目录':'尚未入库' }}</small></div></div></template></el-table-column><el-table-column label="游玩时间" width="155" align="right"><template #default="{row}">{{ Number(row.playtime_minutes||0) }} 分钟 · {{ (Number(row.playtime_minutes||0)/60).toFixed(1) }} 小时</template></el-table-column><el-table-column label="本站最低价" width="130" align="right"><template #default="{row}">{{ price(row.current_low) }}</template></el-table-column><el-table-column label="最近游玩" min-width="150"><template #default="{row}">{{ dateTime(row.last_played_at) }}</template></el-table-column></el-table>
        <PaginationBar v-model:page="steamPage" v-model:page-size="steamPageSize" :total="libraryGames.length"/>
      </div>
      <template v-else-if="isMobile">
        <el-empty v-if="!steamAccounts.length" description="还没有绑定 Steam 账号，点右上角「绑定新账号」开始"/>
        <div v-if="steamAccounts.length" class="game-card-list"><div v-for="a in steamAccounts" :key="a.steam_id" class="admin-card">
          <div class="admin-card-main"><strong>{{ a.alias||a.persona_name||a.steam_id }}</strong><small class="mono">{{ a.steam_id }}</small><small class="muted">游戏库 {{ a.games }} · 愿望单 {{ a.wishlist }} · {{ a.api_key_set?'API Key 已配置':'API Key 未配置' }} · 最近同步 {{ dateTime(a.library_synced_at)||'未同步' }}</small></div>
          <div class="admin-card-actions"><el-button link @click="goOpLogs('steam')">日志</el-button><el-button link type="primary" :loading="syncing(a,'library')" @click="syncSteam(a,'library')">{{ syncing(a,'library')?'同步中…':'同步游戏库' }}</el-button><el-button link :loading="syncing(a,'wishlist')" @click="syncSteam(a,'wishlist')">{{ syncing(a,'wishlist')?'同步中…':'同步愿望单' }}</el-button><el-button link @click="toggleLibrary(a)">{{ activeAccount?.steam_id===a.steam_id?'收起游戏库':'游戏库' }}</el-button><el-button link @click="editAlias(a)">改别名</el-button><el-button link @click="editApiKey(a)">API Key</el-button><el-button link type="danger" @click="unbindSteam(a)">解绑</el-button></div>
        </div></div>
        <div v-if="unownedAccounts.length" class="game-card-list"><div v-for="a in unownedAccounts" :key="a.steam_id" class="admin-card"><div class="admin-card-main"><strong>{{ a.persona_name||a.steam_id }}</strong><small class="mono">{{ a.steam_id }} · 已同步游戏 {{ a.games }}</small></div><div class="admin-card-actions"><el-button link type="primary" @click="claimSteam(a)">认领到当前管理员</el-button></div></div></div>
        <template v-if="activeAccount && libraryGames.length">
          <div class="card-heading padded"><div><h3>{{ activeAccount.alias||activeAccount.persona_name||activeAccount.steam_id }} 的游戏库</h3><p>最多显示 500 条，按游玩时长排序。</p></div><el-button text @click="activeAccount=null;libraryGames=[]">收起</el-button></div>
          <div class="game-card-list"><div v-for="g in pagedSteamGames" :key="g.appid" class="admin-card"><div class="admin-card-main"><strong>{{ g.name||('appid:'+g.appid) }}</strong><small class="mono">AppID {{ g.appid }} · 游玩 {{ Number(g.playtime_minutes||0) }} 分钟 · 最近 {{ dateTime(g.last_played_at) }}</small></div><div class="admin-card-actions"><el-button link type="primary" tag="a" :href="`https://store.steampowered.com/app/${g.appid}/`" target="_blank" rel="noopener">Steam ↗</el-button><span class="muted">{{ price(g.low) }}</span></div></div></div>
          <PaginationBar v-model:page="steamPage" v-model:page-size="steamPageSize" :total="libraryGames.length"/>
        </template>
      </template>
      <el-dialog v-model="apiKeyDialog.visible" :title="`API Key：${apiKeyDialog.row?.alias||apiKeyDialog.row?.persona_name||apiKeyDialog.row?.steam_id||''}`" width="min(480px, 92vw)"><p class="muted">用于该账号同步游戏库/愿望单（在 steamcommunity.com/dev/apikey 注册）。未配置时无法同步；系统级采集任务仍用全局 STEAM_API_KEY。Key 只存密文、不回显。</p><el-input v-model="apiKeyDialog.value" type="password" show-password placeholder="输入该账号的 API Key（留空保存=清除）" @keyup.enter="saveApiKey"/><template #footer><el-button v-if="apiKeyDialog.row?.api_key_set" type="danger" plain @click="saveApiKey(true)">清除 Key</el-button><el-button type="primary" :loading="saving" @click="saveApiKey(false)">保存</el-button></template></el-dialog>
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
    <template v-else-if="section==='sessions'">
      <div class="module-card"><div class="card-heading"><div><h3>登录会话</h3><p>查看全部登录会话、按用户踢下线；默认只列未过期，被禁用的用户会话带「已禁用」标记。</p></div><div class="sess-head-actions"><el-input v-model="sessFilter.user" placeholder="用户名筛选" size="small" clearable @keyup.enter="loadSessions" @clear="loadSessions"/><el-input v-model="sessFilter.ip" placeholder="IP 筛选" size="small" clearable @keyup.enter="loadSessions" @clear="loadSessions"/><el-checkbox v-model="sessFilter.includeExpired" @change="loadSessions">包含已失效</el-checkbox><el-button size="small" @click="loadSessions">刷新</el-button></div></div></div>
      <div v-if="!isMobile" class="module-card table-card"><BulkBar :count="sel.sessions.count" :actions="sessionsBulkActions" :running="bulkRunning" @run="(a)=>runBulk(a,sel.sessions,{refresh:loadSessions})" @clear="sel.sessions.clear()"/><el-table ref="sessTable" row-key="id" :data="sessions" v-loading="loading" size="small" @selection-change="sel.sessions.onSelectionChange"><el-table-column type="selection" width="44"/><el-table-column label="用户" min-width="140"><template #default="{row}"><strong>{{ row.displayName || row.username }}</strong><el-tag :type="row.role==='admin'?'danger':'info'" size="small" class="tag-gap">{{ row.role==='admin'?'管理员':'用户' }}</el-tag><el-tag v-if="row.disabled" type="info" size="small" class="tag-gap">已禁用</el-tag></template></el-table-column><el-table-column label="IP / 归属地" min-width="150"><template #default="{row}"><span class="mono">{{ row.ip||'—' }}</span><small v-if="row.region">{{ row.region }}</small></template></el-table-column><el-table-column label="设备 / 浏览器" min-width="160" show-overflow-tooltip><template #default="{row}"><el-tooltip v-if="row.userAgent" :content="row.userAgent" placement="top"><span class="sess-ua">{{ uaShort(row.userAgent) }}</span></el-tooltip><span v-else>—</span><small v-if="row.deviceId">{{ row.deviceId.slice(0,10) }}…</small></template></el-table-column><el-table-column label="登录时间" min-width="150"><template #default="{row}">{{ dateTime(row.createdAt) }}</template></el-table-column><el-table-column label="最近活动" min-width="150"><template #default="{row}">{{ dateTime(row.lastSeenAt) }}</template></el-table-column><el-table-column label="到期时间" min-width="150"><template #default="{row}">{{ dateTime(row.expiresAt) }}</template></el-table-column><el-table-column label="当前" width="80"><template #default="{row}"><el-tag v-if="row.current" type="success" size="small">当前会话</el-tag><span v-else class="muted">—</span></template></el-table-column><el-table-column label="操作" width="100"><template #default="{row}"><el-button link type="primary" @click="kickSession(row)">踢下线</el-button></template></el-table-column></el-table><el-empty v-if="!sessions.length" description="当前没有在线会话"/><PaginationBar v-model:page="sessPage" v-model:page-size="sessPageSize" :total="sessionsTotal"/></div>
      <template v-else>
        <BulkBar :count="sel.sessions.count" :actions="sessionsBulkActions" :running="bulkRunning" @run="(a)=>runBulk(a,sel.sessions,{refresh:loadSessions})" @clear="sel.sessions.clear()"/>
        <div class="game-card-list"><div v-for="s in sessions" :key="s.id" class="admin-card">
          <div class="admin-card-pick"><el-checkbox :model-value="sel.sessions.has(s)" @change="sel.sessions.toggle(s)">选择</el-checkbox></div>
          <div class="admin-card-main"><strong>{{ s.displayName || s.username }}</strong><small class="mono">{{ s.ip||'—' }}<template v-if="s.region"> · {{ s.region }}</template></small><small class="muted">{{ s.userAgent?uaShort(s.userAgent):'—' }} · 登录 {{ dateTime(s.createdAt) }} · 活动 {{ dateTime(s.lastSeenAt) }} · 到期 {{ dateTime(s.expiresAt) }}</small><p class="admin-card-tags"><el-tag v-if="s.role==='admin'" type="danger" size="small">管理员</el-tag><el-tag v-if="s.disabled" type="info" size="small">已禁用</el-tag><el-tag v-if="s.current" type="success" size="small">当前会话</el-tag></p></div>
          <div class="admin-card-actions"><el-button link type="danger" @click="kickSession(s)">踢下线</el-button><el-button link type="danger" @click="kickAllSessions(s)">踢全部</el-button></div>
        </div><el-empty v-if="!sessions.length" description="当前没有在线会话"/></div>
        <PaginationBar v-model:page="sessPage" v-model:page-size="sessPageSize" :total="sessionsTotal"/>
      </template>
    </template>
    <template v-else>
      <div class="module-card"><el-empty description="未知模块"/></div>
    </template>
      <BulkResultDialog v-model="bulkResult.visible" :result="bulkResult.result"/>
      <GameDetailDialog v-model="recycleDetail.visible" :appid="recycleDetail.appid" :row="recycleDetail.row" deleted/>
  </div>
</template>

<script setup>
import { computed,onBeforeUnmount,onMounted,reactive,ref,watch } from 'vue';
import { useRoute,useRouter } from 'vue-router';
import PaginationBar from '../components/PaginationBar.vue';
import MailSettingsForm from '../components/MailSettingsForm.vue';
import BulkBar from '../components/BulkBar.vue';
import BulkResultDialog from '../components/BulkResultDialog.vue';
import GameDetailDialog from '../components/GameDetailDialog.vue';
import UserAvatar from '../components/UserAvatar.vue';
import CoverPlaceholder from '../components/CoverPlaceholder.vue';
// BM-3（docs/SESSION-MANAGEMENT.md §8.4.3）：401 统一软跳登录页
import { redirectToLogin } from '../utils/session.js';
import { useBulkSelection,promptBulkConfirm } from '../composables/useBulkSelection.js';
import { useListPagination } from '../composables/useListPagination.js';
import { copyText } from '../utils/clipboard.js';
import { ElMessage,ElMessageBox } from 'element-plus';
import { fmtDateTime as dateTime } from '../utils/siteTime.js';
import { yuanAmount } from '../utils/money.js';
const props=defineProps({section:{type:String,required:true},me:{type:Object,default:null}});
const route=useRoute(),router=useRouter();
// 窄屏（手机）：其余表格由 .m-console 的「左右滑动查看更多」提示覆盖（docs/MOBILE-FIX.md §3D）
const mobileQuery=typeof window!=='undefined'&&window.matchMedia?window.matchMedia('(max-width: 768px)'):null;
const isMobile=ref(Boolean(mobileQuery&&mobileQuery.matches));
function onMobileChange(e){isMobile.value=e.matches;}
if(mobileQuery){if(mobileQuery.addEventListener)mobileQuery.addEventListener('change',onMobileChange);else mobileQuery.addListener(onMobileChange);}
const loading=ref(false),saving=ref(false),users=ref([]),recycleGames=ref([]),steamAccounts=ref([]),unownedAccounts=ref([]),steamLimit=ref(5),steamError=ref(''),activeAccount=ref(null),libraryGames=ref([]),apiKeyDialog=ref({visible:false,row:null,value:''}),smtp=ref({}),mailMessage=ref(''),mailOk=ref(false),smtpTrace=ref(''),testEmail=ref(''),mailPageTab=ref('config');
// DT-3（docs/ADMIN-PERMISSIONS.md DT-3）：新建用户入口下线——用户只能自助注册；
// 行内操作 = 编辑（仅角色）/ 重置密码 / 禁用·启用 / 踢会话 / 删除，批量只保留「批量踢会话」。
function goOpLogs(tab){router.push({path:'/console',query:{section:'op-logs',tab}}).catch(()=>{});}
const usersPager=useListPagination(users), recyclePager=useListPagination(recycleGames), steamPager=useListPagination(libraryGames);
const pagedUsers=usersPager.items, usersPage=usersPager.page, usersPageSize=usersPager.pageSize;
const pagedRecycleGames=recyclePager.items, recyclePage=recyclePager.page, recyclePageSize=recyclePager.pageSize;
const pagedSteamGames=steamPager.items, steamPage=steamPager.page, steamPageSize=steamPager.pageSize;
// ---- 批量操作（docs/ADMIN-BULK-ACTIONS.md）：回收站 + 用户列表 + 登录会话 ----
const recycleTable=ref(null),usersTable=ref(null),sessTable=ref(null);
const sel={
  recycle:reactive(useBulkSelection((r)=>r.id,recycleTable)),
  users:reactive(useBulkSelection((r)=>r.id,usersTable)),
  sessions:reactive(useBulkSelection((r)=>r.id,sessTable)),
};
const bulkResult=reactive({visible:false,result:null}),bulkRunning=ref('');
const recycleBulkActions=[{key:'restore',label:'恢复',target:'games',action:'restore'}];
// DT-3（docs/ADMIN-PERMISSIONS.md DT-3）：批量只保留「批量踢会话」——禁用/启用/删除/重置密码不做批量
const activeAdminIds=computed(()=>users.value.filter((u)=>u.role==='admin'&&!u.disabled).map((u)=>u.id));
const usersBulkHint=computed(()=>sel.users.selectedKeys.length?'踢掉所选用户全部会话（各设备下一次请求即退出登录）':'');
const usersBulkActions=computed(()=>[{key:'kick',label:'批量踢会话',target:'users',action:'kick',risk:'high'}]);
// DT-4 批：api 抛错带 err.data（重置密码弹窗读 retryAfterSec/剩余次数）
function api(path,opts={}){return fetch(path,{credentials:'same-origin',...opts,headers:{'content-type':'application/json',...(opts.headers||{})}}).then(async r=>{const t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch{}if(r.status===401){redirectToLogin();const err=new Error(d.error||'登录已过期');err.data=d;throw err;}if(!r.ok){const err=new Error(d.error||`HTTP ${r.status}`);err.data=d;throw err;}return d;});}
function body(method,data){return {method,body:JSON.stringify(data)};}
function notify(e){ElMessage.error(e?.message||String(e));}
// AJ 批：账号变更通知回执（docs/USER-LIFECYCLE.md 验收 6/7）——删除/改邮箱是字符串，
// PATCH/重置密码是 { status, error }；发送成功不打扰，跳过与失败要提示
function toastNotify(d){const n=d?.notify;if(!n)return;if(typeof n==='string'){if(n==='skipped_no_email')ElMessage.info('该用户未绑定邮箱，未发送通知');return;}if(n.status==='sent')return;if(n.status==='skipped_no_email')ElMessage.info('已保存（该用户未绑定邮箱，未发送通知）');else if(n.status==='skipped_disabled')ElMessage.info('已保存（通知模板已停用，未发送）');else if(n.status==='failed')ElMessage.warning(`已保存，但通知发送失败：${n.error||''}`);}
function price(v){return v==null?'—':`¥${yuanAmount(v)}`;}
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
// ---- BK 批（docs/SESSION-MANAGEMENT.md §3.3）：登录会话列表（服务端分页）与踢下线 ----
const sessions=ref([]),sessionsTotal=ref(0),sessPage=ref(1),sessPageSize=ref(20);
const sessFilter=reactive({user:'',ip:'',includeExpired:false});
const sessionsBulkActions=[{key:'kick',label:'踢下线',target:'sessions',action:'kick'}];
function uaShort(ua){const m=String(ua||'').match(/^[^\s(]+/);return m?m[1]:String(ua||'').slice(0,60);}
async function loadSessions(){sel.sessions.clear();loading.value=true;try{const p=new URLSearchParams({limit:String(sessPageSize.value),offset:String((sessPage.value-1)*sessPageSize.value)});if(sessFilter.user.trim())p.set('user',sessFilter.user.trim());if(sessFilter.ip.trim())p.set('ip',sessFilter.ip.trim());if(sessFilter.includeExpired)p.set('includeExpired','1');const d=await api('/api/admin/sessions?'+p.toString());sessions.value=d.sessions||[];sessionsTotal.value=d.total??0;}catch(e){notify(e);}finally{loading.value=false;}}
async function kickSession(row){try{await ElMessageBox.confirm(`踢下线「${row.displayName || row.username}」的会话（${row.ip||'未知 IP'}）？该设备下一次请求即退出登录。`,'确认踢下线',{type:'warning'});await api(`/api/admin/sessions/${row.id}`,body('DELETE',{}));ElMessage.success('已踢下线');await loadSessions();}catch(e){if(e!=='cancel'&&e!=='close')notify(e);}}
async function kickAllSessions(row){try{await ElMessageBox.confirm(`踢掉「${row.display_name || row.username}」的全部会话？该用户所有设备下一次请求即退出登录。`,'确认踢全部',{type:'warning'});const d=await api(`/api/admin/users/${encodeURIComponent(row.username)}/sessions`,body('DELETE',{}));ElMessage.success(`已踢掉 ${d.removed} 个会话`);await loadSessions();}catch(e){if(e!=='cancel'&&e!=='close')notify(e);}}
// AL 批（docs/AUTH-REDESIGN.md §5.5）：临时密码只在创建/重置后展示一次，可复制、不可再次查看
const tempPwd=ref('');
const tempPwdDialog=ref(false);
function showTempPassword(pwd){tempPwd.value=pwd;tempPwdDialog.value=true;}
async function copyTempPassword(){const ok=await copyText(tempPwd.value);ok?ElMessage.success('已复制'):ElMessage.warning('复制失败，请手动选择');}
// ---- DT-4（docs/ADMIN-PERMISSIONS.md）：重置密码弹窗（demo ③ admin-users-2026-11-19.html）----
// 打开不发码；点「发送验证码」才发（purpose=admin_reset，不占前台额度）；三态按钮
// （发送中/剩余秒数/可重发，过期后显示「重新发送」）；验证失败不关弹窗（显示「还剩 N 次机会」）。
const resetPwd=reactive({visible:false,username:'',email:'',code:'',codeSent:false,sending:false,verifying:false,cooldown:0,hint:'',error:''});
let resetPwdTimer=null;
function startResetCountdown(sec){clearInterval(resetPwdTimer);resetPwd.cooldown=Math.max(0,Math.round(Number(sec)||0));if(resetPwd.cooldown<=0)return;resetPwdTimer=setInterval(()=>{resetPwd.cooldown-=1;if(resetPwd.cooldown<=0)clearInterval(resetPwdTimer);},1000);}
function openResetPassword(row){
  if(!row.email){ElMessage.warning('该用户还没有绑定邮箱，无法发送验证码');return;}
  resetPwd.visible=true;
  resetPwd.username=row.username;
  resetPwd.email=row.email;
  resetPwd.code='';resetPwd.codeSent=false;resetPwd.sending=false;resetPwd.verifying=false;
  resetPwd.hint='';resetPwd.error='';
  clearInterval(resetPwdTimer);resetPwd.cooldown=0; // 重开弹窗不自动发码、不沿用旧倒计时
}
function closeResetPwd(){clearInterval(resetPwdTimer);resetPwd.cooldown=0;resetPwd.codeSent=false;resetPwd.hint='';resetPwd.error='';}
async function sendResetCode(){
  if(!resetPwd.email||resetPwd.sending||resetPwd.cooldown>0)return;
  resetPwd.sending=true;resetPwd.error='';resetPwd.hint='';
  try{
    const res=await fetch(`/api/admin/users/${encodeURIComponent(resetPwd.username)}/reset-code`,body('POST',{}));
    const t=await res.text();let d={};try{d=t?JSON.parse(t):{}}catch{}
    if(!res.ok)throw Object.assign(new Error(d.error||`HTTP ${res.status}`),{data:d});
    resetPwd.codeSent=true;
    resetPwd.hint=`已发送，${Number(d.retryAfterSec)||60} 秒后可重发；验证码 10 分钟有效`;
    startResetCountdown(Number(d.retryAfterSec)||60);
  }catch(e){
    resetPwd.error=e.message;
    // 429 冷却：继续倒计时（按钮显示剩余秒数），不用报错提示代替（规格）
    if(e.data?.retryAfterSec)startResetCountdown(e.data.retryAfterSec);
  }finally{resetPwd.sending=false;}
}
async function confirmResetPwd(){
  if(resetPwd.verifying)return;
  resetPwd.verifying=true;resetPwd.error='';
  try{
    const d=await api(`/api/admin/users/${encodeURIComponent(resetPwd.username)}/password`,body('POST',{code:resetPwd.code.trim()}));
    resetPwd.visible=false;
    if(d.tempPassword)showTempPassword(d.tempPassword);
    ElMessage.success(d.message||'密码已重置');
    await loadUsers();
  }catch(e){
    // DT-4：验证失败不关弹窗；后端给 remainingAttempts 时显示「还剩 N 次机会」
    if(e.data?.remainingAttempts!=null)resetPwd.error=`${e.message}（还剩 ${e.data.remainingAttempts} 次机会）——弹窗不关闭，可直接重试`;
    else resetPwd.error=e.message;
  }finally{resetPwd.verifying=false;}
}
// DT-3（docs/ADMIN-PERMISSIONS.md DT-3）：编辑用户弹窗——仅可改角色；用户名/邮箱/绑定 Steam 账号只读展示
const editUserDialog=reactive({visible:false,row:null,role:'user',accounts:[]});
async function openEditUser(row){
  editUserDialog.row=row;editUserDialog.role=row.role==='admin'?'admin':'user';editUserDialog.accounts=[];
  editUserDialog.visible=true;
  try{
    const d=await api(`/api/admin/users/${encodeURIComponent(row.username)}/steam-accounts`);
    editUserDialog.accounts=d.accounts||[];
  }catch(e){notify(e);}
}
async function submitUserEdit(){
  const row=editUserDialog.row;
  if(!row)return;
  if(editUserDialog.role===row.role){editUserDialog.visible=false;return;}
  // 角色变更二次确认（DT-3 验收：角色变更、禁用、删除都要确认）
  try{await ElMessageBox.confirm(`把「${row.display_name || row.username}」的角色改为${editUserDialog.role==='admin'?'管理员':'普通用户'}？`,'确认角色变更',{type:'warning',confirmButtonText:'确认变更',cancelButtonText:'取消'});}catch{return;}
  await act(async()=>{
    await api(`/api/admin/users/${encodeURIComponent(row.username)}`,body('PATCH',{role:editUserDialog.role}));
    ElMessage.success('角色已变更');
    editUserDialog.visible=false;
    await loadUsers();
  });
}
async function toggleUser(row){try{await ElMessageBox.confirm(`${row.disabled?'启用':'禁用'}账号「${row.display_name || row.username}」？`,'确认操作',{type:'warning'});const d=await api(`/api/admin/users/${encodeURIComponent(row.username)}`,body('PATCH',{disabled:!row.disabled}));toastNotify(d);await loadUsers();}catch(e){if(e!=='cancel'&&e!=='close')notify(e);}}
// AK-2（docs/AUTH-REDESIGN.md §4.4）：锁定标记与管理员解锁
function isLocked(row){const t=row?.locked_until;return Boolean(t&&Date.parse(t)>Date.now());}
async function unlockUser(row){try{await api(`/api/admin/users/${encodeURIComponent(row.username)}/unlock`,body('POST',{}));ElMessage.success('已解锁');await loadUsers();}catch(e){notify(e);}}
async function loadRecycle(){sel.recycle.clear();loading.value=true;try{const d=await api('/api/admin/games/deleted?limit=1000');recycleGames.value=d.games||[];}catch(e){notify(e);}finally{loading.value=false;}}
async function restoreGame(row){await act(async()=>{const path=row.steam_appid?`/api/games/${row.steam_appid}/deleted`:`/api/games/id/${row.id}/deleted`;await api(path,body('POST',{deleted:false}));ElMessage.success('游戏已恢复');await loadRecycle();});}
// CW 批（docs/ADMIN-GAME-POPUP.md §5.1）：回收站同样支持详情弹窗——
// 已删除游戏的详情接口不再返回，弹窗用列表行数据渲染（组件 deleted 模式）
const recycleDetail=reactive({visible:false,appid:null,row:null});
function openGameDetail(row){recycleDetail.visible=true;recycleDetail.appid=row.steam_appid??null;recycleDetail.row=row;}
async function loadSteam(){loading.value=true;try{const d=await api('/api/steam/accounts');steamAccounts.value=d.accounts||[];unownedAccounts.value=d.unowned||[];steamLimit.value=Number(d.limit)||5;if(activeAccount.value){const cur=steamAccounts.value.find((a)=>a.steam_id===activeAccount.value.steam_id);if(!cur){activeAccount.value=null;libraryGames.value=[];}}}catch(e){notify(e);}finally{loading.value=false;}}
function bindSteam(){if(steamAccounts.value.length>=steamLimit.value)return;window.location.href='/api/auth/steam/start';}
// ---- EM 批（docs/STEAM-SYNC-TIMEOUT.md EL-3）：同步改「触发后台任务 + 轮询」——
// 点同步 → 按钮「同步中…」→ 每 2s 轮询 sync-status（最长 60s）→ 完成后刷新列表并提示结果；
// 失败显示原因（点按钮可重试），不再出现笼统的「请求超时」报错。
const syncPolling=reactive({}); // steam_id -> { running, kind }
function syncing(row,kind){const t=syncPolling[row?.steam_id];return Boolean(t?.running&&t?.kind===kind);}
function applySyncResult(st,kind){
  const r=st?.lastResult;
  if(!r)return ElMessage.info('还没有同步记录');
  if(!r.ok)return ElMessage.error(`同步失败：${r.error||'未知原因'}（可点「同步游戏库 / 同步愿望单」重试）`);
  const isLib=(kind==='library')||(r.kind==='library');
  if(isLib)ElMessage.success(`已同步 ${r.total||0} 款游戏（差集清理 ${r.deleted||0} 条${r.typeUnknown>0?`，类型未知 ${r.typeUnknown} 款已尝试补全`:''}）`);
  else ElMessage.success(`已同步 ${r.total||0} 个愿望单（新增提醒 ${r.watches||0}，目录未命中 ${r.skipped||0}）`);
}
async function pollSync(row,kind){
  const steamId=row.steam_id;
  const started=Date.now();
  while(Date.now()-started<60000){
    await new Promise((r)=>setTimeout(r,2000));
    try{
      const st=await api(`/api/steam/accounts/${encodeURIComponent(steamId)}/sync-status`);
      if(st.status!=='running'){
        syncPolling[steamId]={running:false,kind};
        applySyncResult(st,kind);
        await loadSteam();
        return;
      }
    }catch(e){
      syncPolling[steamId]={running:false,kind};
      notify(e);
      return;
    }
  }
  syncPolling[steamId]={running:false,kind};
  ElMessage.warning('同步仍在后台进行中，稍后点「刷新」查看结果');
  await loadSteam();
}
async function syncSteam(row,kind){
  if(!row.api_key_set)return ElMessage.warning('该账号未配置 API Key，请先在「API Key」里填写');
  if(syncing(row,kind))return;
  try{
    const d=await api(`/api/steam/accounts/${encodeURIComponent(row.steam_id)}/${kind}/sync`,body('POST',{}));
    if(d.accepted){
      syncPolling[row.steam_id]={running:true,kind};
      ElMessage.info('已开始后台同步…');
      await pollSync(row,kind);
    }else{
      const st=await api(`/api/steam/accounts/${encodeURIComponent(row.steam_id)}/sync-status`);
      applySyncResult(st,kind);
      await loadSteam();
    }
  }catch(e){notify(e);}
}
async function editAlias(row){try{const {value}=await ElMessageBox.prompt('给这个 Steam 账号起个别名（留空清除）','修改别名',{inputValue:row.alias||''});await api(`/api/steam/accounts/${encodeURIComponent(row.steam_id)}`,body('PATCH',{alias:value.trim()}));ElMessage.success('别名已保存');await loadSteam();}catch(e){if(e!=='cancel'&&e!=='close')notify(e);}}
function editApiKey(row){apiKeyDialog.value={visible:true,row,value:''};}
async function saveApiKey(clear){const row=apiKeyDialog.value.row;if(!row)return;await act(async()=>{await api(`/api/steam/accounts/${encodeURIComponent(row.steam_id)}`,body('PATCH',clear?{clearApiKey:true}:{apiKey:apiKeyDialog.value.value.trim()}));apiKeyDialog.value.visible=false;ElMessage.success(clear?'API Key 已清除':'API Key 已保存（密文存储，不回显）');await loadSteam();});}
async function unbindSteam(row){try{await ElMessageBox.confirm(`解绑「${row.alias||row.persona_name||row.steam_id}」？游戏库与愿望单数据会被删除，愿望单自动提醒一并清理，手动标记保留。`,'确认解绑',{type:'warning'});await api(`/api/steam/accounts/${encodeURIComponent(row.steam_id)}`,body('DELETE',{}));ElMessage.success('已解绑');activeAccount.value=null;libraryGames.value=[];await loadSteam();}catch(e){if(e!=='cancel'&&e!=='close')notify(e);}}
async function claimSteam(row){await act(async()=>{await api(`/api/steam/accounts/${encodeURIComponent(row.steam_id)}/claim`,body('POST',{}));ElMessage.success('已认领到当前管理员，可用「同步游戏库」拉取数据');await loadSteam();});}
async function toggleLibrary(row){if(activeAccount.value?.steam_id===row.steam_id){activeAccount.value=null;libraryGames.value=[];return;}activeAccount.value=row;libraryGames.value=[];loading.value=true;try{const d=await api(`/api/steam/accounts/${encodeURIComponent(row.steam_id)}/library`);libraryGames.value=d.games||[];}catch(e){notify(e);}finally{loading.value=false;}}
function consumeSteamQuery(){if(typeof window==='undefined')return;const q=new URLSearchParams(window.location.search);const err=q.get('steamError');if(err){steamError.value={state:'绑定链接已失效或过期，请重新发起绑定',conflict:'该 Steam 账号已被其他用户绑定',limit:'最多绑定 5 个 Steam 账号',verify:'Steam 校验失败，请重试'}[err]||'绑定失败，请重试';}if(q.get('steamBound')){if(q.get('steamNeedKey'))ElMessage.success('Steam 账号已绑定；请先为该账号配置 API Key，再点同步');else ElMessage.success('Steam 账号已绑定');}if(err||q.get('steamBound')){q.delete('steamError');q.delete('steamBound');q.delete('steamNeedKey');const s=q.toString();history.replaceState(null,'',location.pathname+(s?'?'+s:''));}}
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
watch(()=>props.section,s=>{if(s==='users'){loadUsers();}else if(s==='recycle')loadRecycle();else if(s==='steam'){consumeSteamQuery();loadSteam();}else if(s==='mail'){loadMail();loadTemplates();}else if(s==='sessions')loadSessions();});
// 翻页清空选择（常规列表只支持本页勾选）；回收站例外：可用「全选当前筛选」一次性选满
watch(recyclePage,()=>sel.recycle.clear());watch(usersPage,()=>sel.users.clear());
watch([sessPage,sessPageSize],()=>{sel.sessions.clear();loadSessions();});
onMounted(()=>{if(props.section==='users'){loadUsers();}else if(props.section==='recycle')loadRecycle();else if(props.section==='steam'){consumeSteamQuery();loadSteam();}else if(props.section==='mail'){loadMail();loadTemplates();}else if(props.section==='sessions')loadSessions();});
onBeforeUnmount(()=>{if(mobileQuery){if(mobileQuery.removeEventListener)mobileQuery.removeEventListener('change',onMobileChange);else mobileQuery.removeListener(onMobileChange);}});
</script>

<style scoped>
.extra-wrap{display:flex;flex-direction:column;gap:var(--space-14);padding-bottom:var(--space-24);min-width:0}.user-cell{display:inline-flex;align-items:center;gap:8px}.card-avatar{vertical-align:middle;margin-right:4px}.module-card{background:var(--panel);border:1px solid var(--border);border-radius:var(--radius-13);padding:var(--space-16);box-shadow:0 3px 14px #26345a06;min-width:0}.card-heading{display:flex;align-items:center;justify-content:space-between;gap:var(--space-12);margin-bottom:13px}.card-heading h3{font-size:var(--font-14);margin:0;color:var(--fg)}.card-heading p{font-size:var(--font-11);color:var(--fg-muted);margin:var(--space-4) 0 0}.user-create{display:grid;grid-template-columns:1fr 1.2fr 1.4fr 150px auto;gap:var(--space-8)}.table-card{padding:0;overflow:hidden}.tag-gap{margin-left:7px}.delete-alert,.steam-alert{margin-bottom:var(--space-12)}.delete-confirm-input{margin-bottom:var(--space-10)}.mail-tpl-card .card-heading{align-items:flex-start}.tpl-head-actions{display:flex;gap:var(--space-8);flex:none;align-items:center}.tpl-tabs .tpl-row{display:flex;align-items:center;gap:var(--space-10);margin-bottom:var(--space-10)}.tpl-switch-row{justify-content:space-between}.tpl-row label{flex:none;width:130px;font-size:var(--font-12);color:var(--fg-muted)}.tpl-html,.mail-test .el-input{flex:1}.tpl-vars{display:flex;flex-wrap:wrap;gap:var(--space-6);margin:0 0 var(--space-12) 140px}.tpl-var-btn{border:1px solid var(--border);border-radius:var(--radius-8);background:var(--panel-2);color:var(--brand);font:12px/1.6 ui-monospace,Consolas,monospace;padding:3px var(--space-8);cursor:pointer}.tpl-actions{display:flex;gap:var(--space-8);margin-left:140px;flex-wrap:wrap}.tpl-preview-box{border:1px solid var(--border);border-radius:var(--radius-10);padding:var(--space-14);max-height:420px;overflow:auto;background:var(--panel-2)}.mail-log-tabs .el-tabs__header{margin:0 var(--space-16)}.recycle-summary{display:flex;align-items:center;gap:var(--space-18)}.recycle-summary>div{display:grid;gap:3px}.recycle-summary>div strong{font-size:var(--font-24)}.recycle-summary>div small{color:var(--fg-muted);font-size:var(--font-10)}.recycle-summary p{flex:1;color:var(--fg-muted);font-size:var(--font-11)}.steam-account{display:block}.steam-account .card-heading .steam-actions{display:flex;gap:var(--space-6);flex-wrap:wrap}.steam-account-cell,.game-admin{display:flex;align-items:center;gap:var(--space-10)}.steam-avatar-img{width:36px;height:36px;border-radius:7px;object-fit:cover}.steam-account-cell small,.game-admin small,.extra-wrap td small{display:block;color:var(--fg-muted);font-size:var(--font-10);margin-top:3px}.card-heading.padded{padding:var(--space-16) var(--space-16) 0}.game-admin img{width:76px;height:36px;object-fit:cover;border-radius:5px}.metric-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--space-10)}.metric-card{background:var(--panel);border:1px solid var(--border);border-radius:var(--radius-12);padding:13px 15px;display:grid;gap:var(--space-8)}.metric-card span{font-size:var(--font-11);color:var(--fg-muted)}.metric-card strong{font-size:var(--font-16)}.status-text.good{color:var(--success)}.status-text.warning{color:var(--warn)}.mail-test{display:flex;gap:var(--space-8);max-width:620px;margin-bottom:var(--space-12)}.smtp-trace{padding:var(--space-10);background:var(--panel-2);border-radius:var(--radius-8);color:var(--fg-muted);font:11px ui-monospace,Consolas,monospace;white-space:pre-wrap}.mail-body{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--panel-2);padding:var(--space-14);border-radius:var(--radius-9);max-height:50vh;overflow:auto;font:12px/1.6 ui-monospace,Consolas,monospace}.log-filters{display:flex;align-items:center;gap:var(--space-8);flex-wrap:wrap}.log-filters>.el-select{width:150px}.log-filters>.el-input{flex:1;min-width:200px}.log-summary{display:flex;align-items:center;gap:var(--space-12);color:var(--fg-muted);font-size:var(--font-10)}.log-summary strong{color:var(--fg)}.log-summary .el-button{margin-left:auto}.log-list{display:grid;gap:7px}.log-entry{display:grid;grid-template-columns:155px 62px minmax(120px,220px) minmax(0,1fr);align-items:start;gap:9px;padding:11px 13px;border:1px solid var(--border);border-left:3px solid var(--fg-subtle);border-radius:var(--radius-9);background:var(--panel);font-size:var(--font-10)}.log-entry.error{border-left-color:var(--danger)}.log-entry.warn,.log-entry.warning{border-left-color:var(--warn)}.log-entry time,.muted{color:var(--fg-muted)}.log-entry strong{overflow-wrap:anywhere;color:var(--fg)}.log-entry pre{margin:0;color:var(--fg-muted);white-space:pre-wrap;overflow-wrap:anywhere}
.sync-run-failed{background:var(--danger-bg)!important}.text-danger{color:var(--danger)}
/* DT-4（docs/ADMIN-PERMISSIONS.md）：重置密码弹窗（demo ③ 交互：打开不发码/失败不关/还剩 N 次） */
.rp-field{margin-bottom:var(--space-12)}
.rp-field label{display:block;font-size:var(--font-11);color:var(--fg-muted);margin-bottom:var(--space-6)}
.rp-ro{background:var(--panel-2);border:1px solid var(--border-2);border-radius:var(--radius-8);padding:var(--space-8) var(--space-12);font-size:var(--font-12);color:var(--fg)}
.rp-code-row{display:flex;gap:var(--space-8)}
.rp-code-row .el-input{flex:1}
.rp-hint-ok{font-size:var(--font-11);color:var(--fg-muted);margin-top:var(--space-8)}
.rp-hint-ok em{color:var(--warn);font-weight:700;font-style:normal}
.rp-hint-err{font-size:var(--font-11);color:var(--danger);margin-top:var(--space-8)}
/* AT 批：邮件服务 3 tab + 页头「查看发送记录」入口 */
.mail-page-head{display:flex;justify-content:flex-end;gap:var(--space-8)}
.mail-page-tabs :deep(.el-tabs__header){margin-bottom:var(--space-14)}
/* DT-3（docs/ADMIN-PERMISSIONS.md DT-3）：编辑用户弹窗（对齐 design/admin-users-2026-11-19.html ②） */
.edit-user-field{margin-bottom:13px}.edit-user-field label{display:block;font-size:11.5px;color:var(--fg-muted);margin-bottom:6px}.edit-user-field .val{background:var(--panel-2);border:1px solid var(--border);border-radius:8px;padding:9px 12px;font-size:12.5px;color:var(--fg)}.role-opts{display:flex;gap:10px}.role-opt{flex:1;border:1px solid var(--border);border-radius:9px;padding:9px 12px;font-size:12.5px;color:var(--fg);background:var(--panel-2);cursor:pointer;text-align:center}.role-opt.on{border-color:var(--brand);background:var(--brand-soft);color:var(--brand);font-weight:700}.edit-user-field .bound{background:var(--panel-2);border:1px solid var(--border);border-radius:8px;padding:9px 12px;font-size:12px;color:var(--fg-muted);line-height:1.7}.edit-user-field .bound b{color:var(--fg)}
.mail-page-tabs :deep(.el-tab-pane){display:flex;flex-direction:column;gap:var(--space-14)}
@media(max-width:900px){.user-create{grid-template-columns:repeat(2,minmax(0,1fr))}.metric-grid{grid-template-columns:repeat(3,minmax(100px,1fr))}.log-entry{grid-template-columns:125px 55px minmax(100px,1fr)}}
@media(max-width:560px){.user-create{grid-template-columns:1fr}.user-create>*,.steam-account .steam-actions{width:100%}.recycle-summary{align-items:flex-start;flex-wrap:wrap}.recycle-summary p{flex-basis:100%;margin:0}.steam-account .card-heading,.mail-test{flex-wrap:wrap}.mail-test>.el-input{flex-basis:100%}.log-filters>.el-select{flex:1;width:auto}.log-filters>.el-input{flex-basis:100%;min-width:0}.log-entry{grid-template-columns:1fr auto;gap:5px}.log-entry strong,.log-entry pre{grid-column:1/-1}}
/* BW 批（docs/MOBILE-REDESIGN.md §5.2）：手机卡片列表（用户/回收站/Steam 账号/会话） */
.game-card-list{display:flex;flex-direction:column;gap:var(--space-8);padding-bottom:var(--space-10)}
.admin-card{border:1px solid var(--border);border-radius:var(--radius-12);padding:var(--space-10) var(--space-12);background:var(--panel);display:flex;flex-direction:column;gap:var(--space-8)}
.admin-card-main{display:flex;flex-direction:column;gap:var(--space-4);min-width:0}
.admin-card-main strong{font-size:var(--font-14);overflow-wrap:anywhere}
.admin-card-main small{color:var(--fg-muted);font-size:var(--font-12);overflow-wrap:anywhere}
.admin-card-main .mono{font-family:ui-monospace,Consolas,monospace;font-size:var(--font-12)}
.admin-card-tags{display:flex;flex-wrap:wrap;gap:var(--space-4);margin:var(--space-2) 0 0}
.admin-card-pick{display:flex;align-items:center;min-height:32px}
.admin-card-actions{display:flex;flex-wrap:wrap;gap:var(--space-2)}
.admin-card-actions .el-button{margin-left:0}
:global(.admin-content){overflow-y:auto}
/* EP 批：手机端卡片内操作按钮触摸目标 ≥44px（与 BulkBar/个人资料页同一验收口径） */
@media (max-width: 760px) {
  .admin-card .el-button { min-height: 44px; }
}
</style>
