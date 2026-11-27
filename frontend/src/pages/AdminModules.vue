<template>
  <div class="module-wrap" :class="{ 'm-console': isMobile }">
    <!-- 游戏目录（GA-1：游戏管理拆三个一级菜单后的第一项；维护游戏目录、筛选与编辑） -->
    <template v-if="section==='games'">
        <div class="module-card filterbar"><el-input v-model="gameQuery" clearable placeholder="搜索名称或 AppID" @keyup.enter="loadGames(1)"/><el-select v-model="gamePlatform" placeholder="全部平台" @change="loadGames(1)"><el-option label="全部平台" value=""/><el-option-group label="平台"><el-option v-for="p in platforms" :key="p.value" :label="p.label" :value="p.value"/></el-option-group><el-option-group label="来源"><el-option label="ITAD（来源）" value="itad"/></el-option-group></el-select><el-select v-model="gameStatus" placeholder="全部同步状态" @change="gameOffers='';loadGames(1)"><el-option label="全部同步状态" value=""/><el-option label="未探测" value="pending"/><el-option label="已同步" value="synced"/><el-option label="免费" value="free"/><el-option label="未发售" value="coming_soon"/><el-option label="锁国区" value="region_locked"/><el-option label="国区无价" value="no_price"/><el-option label="国区不可售" value="not_found"/><el-option label="其他" value="other"/></el-select><el-select v-model="gameRating" placeholder="全部内容分级" @change="loadGames(1)"><el-option label="全部内容分级" value=""/><el-option label="成人内容（宽）" value="adult"/><el-option label="色情游戏（严格）" value="explicit"/><el-option label="成熟" value="mature"/><el-option label="未分级" value="none"/></el-select><el-button :loading="gamesLoading" @click="refreshGamesAction">刷新</el-button><el-button @click="mergeDialog=true">高级</el-button></div>
<div class="metric-grid clickable-grid"><div class="metric-card" :class="{on:activeMetric==='all'}" role="button" tabindex="0" @click="clickMetric('all')" @keydown.enter="clickMetric('all')"><span>目录游戏</span><strong>{{ gameStats.total||0 }}</strong></div><div class="metric-card" :class="{on:activeMetric==='synced'}" role="button" tabindex="0" @click="clickMetric('synced')" @keydown.enter="clickMetric('synced')"><span>已同步</span><strong>{{ gameStats.synced||0 }}</strong></div><div class="metric-card" :class="{on:activeMetric==='offers'}" role="button" tabindex="0" @click="clickMetric('offers')" @keydown.enter="clickMetric('offers')"><span>有报价</span><strong>{{ gameStats.withOffers||0 }}</strong></div><div class="metric-card" :class="{on:false}"><span>待回填</span><strong>{{ gameStats.backfillPending||0 }}</strong></div></div><details class="more-metrics"><summary>更多指标（10）&#9662;</summary><div class="metric-chips"><button type="button" class="metric-chip" :class="{on:activeMetric==='pending'}" @click="clickMetric('pending')">未探测 <strong>{{ gameStats.pendingProbe||0 }}</strong></button><button type="button" class="metric-chip" :class="{on:activeMetric==='free'}" @click="clickMetric('free')">免费 <strong>{{ gameStats.free||0 }}</strong></button><button type="button" class="metric-chip" :class="{on:activeMetric==='coming_soon'}" @click="clickMetric('coming_soon')">未发售 <strong>{{ gameStats.comingSoon||0 }}</strong></button><button type="button" class="metric-chip" :class="{on:activeMetric==='region_locked'}" @click="clickMetric('region_locked')">锁国区 <strong>{{ gameStats.regionLocked||0 }}</strong></button><button type="button" class="metric-chip" :class="{on:activeMetric==='no_price'}" @click="clickMetric('no_price')">国区无价 <strong>{{ gameStats.noPrice||0 }}</strong></button><button type="button" class="metric-chip" :class="{on:activeMetric==='not_found'}" @click="clickMetric('not_found')">国区不可售 <strong>{{ gameStats.notFound||0 }}</strong></button><button type="button" class="metric-chip" :class="{on:activeMetric==='other'}" @click="clickMetric('other')">其他 <strong>{{ gameStats.other||0 }}</strong></button><button type="button" class="metric-chip" :class="{on:activeMetric==='deleted'}" @click="clickMetric('deleted')">已删除 <strong>{{ gameStats.deleted||0 }}</strong></button><span class="metric-chip plain">已排除 <strong>{{ gameStats.backfillExcluded||0 }}</strong></span><span class="metric-chip plain">跳过中 <strong>{{ gameStats.backfillSkipped||0 }}</strong></span></div></details>
        <BulkBar :count="sel.games.count" :actions="gamesBulkActions" :running="bulkRunning" @run="(a)=>runBulk(a,sel.games,{refresh:refreshGames})" @clear="sel.games.clear()"/><div class="module-card table-card"><template v-if="!isMobile"><el-table ref="gamesTable" row-key="id" :data="games" v-loading="loading" stripe @selection-change="sel.games.onSelectionChange"><el-table-column type="selection" width="44"/><el-table-column label="游戏" min-width="250"><template #default="{row}"><div class="game-cell"><img v-if="row.steam_appid && !row.coverFailed" :src="`/img/steam/${row.steam_appid}/capsule_sm_120`" @error="row.coverFailed=true"><CoverPlaceholder v-else-if="row.steam_appid" :name="row.name" size="sm"/><div class="game-meta"><div class="game-name-row"><button class="game-name" :title="row.name" @click="openGameDetail(row)">{{ row.name }}</button><button class="copy-btn" :class="{copied:copiedGameId===row.id}" title="复制中英文名" @click.stop="copyGameName(row)"><el-icon><Check v-if="copiedGameId===row.id"/><CopyDocument v-else/></el-icon></button></div><div class="game-name-en" :title="row.name_en">{{ row.name_en || (row.steam_appid ? `AppID ${row.steam_appid}` : '无 Steam AppID') }}</div></div></div></template></el-table-column><el-table-column label="平台" min-width="130"><template #default="{row}"><el-tag v-for="p in row.platform_names||[]" :key="p" size="small" class="tag-gap">{{ p }}</el-tag><span v-if="!row.platform_names?.length" class="muted">—</span></template></el-table-column><el-table-column label="Steam 价" width="105" align="right"><template #default="{row}">{{ price(row.steam_price) }}</template></el-table-column><el-table-column label="信息" width="100"><template #default="{row}"><el-tag :type="row.has_desc?'success':'info'" size="small">{{ row.has_desc?'有简介':'缺简介' }}</el-tag></template></el-table-column><el-table-column label="报价" prop="offer_count" width="72" align="right"/><el-table-column label="状态" width="90"><template #default="{row}"><el-tag :type="row.blocked?'danger':'success'" size="small">{{ row.blocked?'已禁用':'正常' }}</el-tag></template></el-table-column><el-table-column label="同步状态" width="105"><template #default="{row}"><el-tag :type="row.steam_status==='ok'?'success':row.steam_status==='region_locked'?'danger':row.steam_status==='coming_soon'?'warning':'info'" size="small">{{ steamStatusLabel(row) }}</el-tag></template></el-table-column><el-table-column label="分级" width="80"><template #default="{row}"><el-tag v-if="row.adult_flag" type="danger" size="small">成人</el-tag><el-tag v-else-if="row.mature_flag" type="warning" size="small">成熟</el-tag><span v-else class="muted">—</span></template></el-table-column><el-table-column label="链接" width="85" align="right"><template #default="{row}"><el-button v-if="row.link_count" link type="primary" @click="openGameLinks(row)">{{ row.link_count }} 个</el-button><span v-else class="muted">—</span></template></el-table-column><el-table-column label="操作" width="170" fixed="right"><template #default="{row}"><el-button v-if="row.steam_appid" link type="primary" @click="editGame(row)">编辑</el-button><el-button v-if="row.steam_appid" link @click="toggleGame(row)">{{ row.blocked?'启用':'禁用' }}</el-button><el-button link type="danger" @click="deleteGame(row)">删除</el-button></template></el-table-column></el-table></template><div v-else class="game-card-list"><div v-for="row in games" :key="row.id" class="admin-card"><div class="admin-card-pick"><el-checkbox :model-value="sel.games.has(row)" @change="sel.games.toggle(row)">选择</el-checkbox></div><div class="admin-card-main"><div class="game-cell"><img v-if="row.steam_appid && !row.coverFailed" :src="`/img/steam/${row.steam_appid}/capsule_sm_120`" @error="row.coverFailed=true"><CoverPlaceholder v-else-if="row.steam_appid" :name="row.name" size="sm"/><div class="game-meta"><div class="game-name-row"><button class="game-name" :title="row.name" @click="openGameDetail(row)">{{ row.name }}</button><button class="copy-btn" :class="{copied:copiedGameId===row.id}" title="复制中英文名" @click.stop="copyGameName(row)"><el-icon><Check v-if="copiedGameId===row.id"/><CopyDocument v-else/></el-icon></button></div><div class="game-name-en" :title="row.name_en">{{ row.name_en || (row.steam_appid ? `AppID ${row.steam_appid}` : '无 Steam AppID') }}</div></div></div><div class="admin-card-tags"><el-tag v-for="p in row.platform_names||[]" :key="p" size="small" class="tag-gap">{{ p }}</el-tag><el-tag size="small" :type="row.has_desc?'success':'info'">{{ row.has_desc?'有简介':'缺简介' }}</el-tag><el-tag size="small" :type="row.blocked?'danger':'success'">{{ row.blocked?'已禁用':'正常' }}</el-tag><el-tag size="small" :type="row.steam_status==='ok'?'success':row.steam_status==='region_locked'?'danger':row.steam_status==='coming_soon'?'warning':'info'">{{ steamStatusLabel(row) }}</el-tag><el-tag v-if="row.adult_flag" size="small" type="danger">成人</el-tag><el-tag v-else-if="row.mature_flag" size="small" type="warning">成熟</el-tag></div></div><div class="admin-card-foot"><span>Steam {{ price(row.steam_price) }} · 报价 {{ row.offer_count }}<template v-if="row.link_count"> · <el-button link type="primary" @click="openGameLinks(row)">链接 {{ row.link_count }}</el-button></template></span><span><el-button v-if="row.steam_appid" link type="primary" @click="editGame(row)">编辑</el-button><el-button v-if="row.steam_appid" link @click="toggleGame(row)">{{ row.blocked?'启用':'禁用' }}</el-button><el-button link type="danger" @click="deleteGame(row)">删除</el-button></span></div></div></div><GameLinksDrawer v-model:visible="linksDrawer.visible" :game="linksDrawer.game" :links="linksDrawer.links" :loading="linksDrawer.loading"/>
          <div class="pager"><span>共 {{ gameTotal }} 款 · 第 {{ gamePage }}/{{ gamePages }} 页</span><el-pagination background layout="prev, pager, next, sizes" :total="gameTotal" :current-page="gamePage" :page-size="gamePageSize" :page-sizes="[20,50,100]" @current-change="loadGames" @size-change="changeGameSize"/></div>
        </div>
        <el-dialog v-model="gameDialog" title="编辑游戏" width="min(560px, 92vw)"><p class="muted">{{ activeGame?.name }} · AppID {{ activeGame?.steam_appid }}</p><el-form label-position="top"><el-form-item label="游戏简介"><el-input v-model="gameDescription" type="textarea" :rows="5" maxlength="10000" show-word-limit/></el-form-item><el-form-item><el-checkbox v-model="gameBlocked">在前台隐藏并停止常规展示</el-checkbox></el-form-item></el-form><template #footer><el-button @click="closeGameDialog">取消</el-button><el-button type="primary" :loading="saving" @click="saveGame">保存</el-button></template></el-dialog>
        <el-dialog v-model="mergeDialog" title="合并重复游戏" width="min(480px, 92vw)"><p class="muted">用于同一游戏被收录两次（不同 AppID）时人工合并；报价与历史会迁到目标游戏。</p><el-form label-position="top"><el-form-item label="源 AppID（被合并方，合并后删除）"><el-input v-model="mergeForm.from" type="number" placeholder="例如 440"/></el-form-item><el-form-item label="目标 AppID（保留方）"><el-input v-model="mergeForm.to" type="number" placeholder="例如 730"/></el-form-item></el-form><template #footer><el-button @click="mergeDialog=false">取消</el-button><el-button type="primary" :loading="saving" @click="mergeGames">合并</el-button></template></el-dialog>
    </template>

    <!-- GA-1（docs/SYNC-PAGE-REDESIGN.md §2.1/§5）：原「游戏管理」三 tab 拆成三个一级菜单——
         游戏目录（本段，原「游戏目录」tab）/ 同步与回填（components/sync/SyncAdmin）/ 对齐审核（AlignAdmin）。
         三个 section 各自是被点击的菜单项，页内不再有 tab；同步页的实现全部收在 components/sync/ 下。 -->
    <template v-else-if="section==='sync'"><SyncAdmin /></template>
    <template v-else-if="section==='align'"><AlignAdmin /></template>

    <!-- 访问与安全 -->
    <!-- FZ 批（docs/VISITORS-REDESIGN.md）：访问记录改「七块任务导向」（左导航 + ?view=），
         实现全部收在 components/visitors/ 下；本文件只剩挂载点，games 段不动。 -->
    <template v-else-if="section==='visitors'"><VisitorsAdmin /></template>

    <!-- 愿望单（BE 批 docs/WISHLIST-SITE-ONLY.md §6；CY 批改为只读：用户私有数据，管理员不可删） -->
    <template v-else-if="section==='wishlist'">
      <div class="module-card"><div class="card-heading"><div><h3>全站愿望单</h3><p>用户私有数据，管理员只读；新增与删除请由用户在前台自行操作。</p></div><el-button :loading="wishlistsLoading" @click="refreshWishlists">刷新</el-button></div>
        <div class="inline-form"><el-input v-model="wishQuery" clearable placeholder="搜索用户名 / 游戏名 / AppID" style="max-width:360px" @keyup.enter="loadWishlists" @clear="loadWishlists"/><el-button :loading="loading" @click="loadWishlists">搜索</el-button><span class="muted">共 {{ wishlists.length }} 条（上限 200）</span></div>
      </div>
      <div v-if="isMobile" class="game-card-list"><div v-for="w in pagedWishlists" :key="w.id" class="admin-card"><div class="admin-card-main"><strong>{{ w.name||w.name_en||('appid:'+w.steam_appid) }}<el-tag type="info" size="small" class="tag-gap">只读</el-tag></strong><small>{{ w.display_name || w.username }} · 加入 {{ dateTime(w.created_at) }}</small><span class="muted">当前 {{ price(w.current_low) }} · 史低 {{ price(w.hist_low) }}</span></div></div><el-empty v-if="!wishlists.length" description="没有愿望单记录"/></div>
      <div v-else class="module-card table-card"><el-table :data="pagedWishlists" v-loading="loading" stripe>
        <el-table-column label="用户" min-width="120"><template #default="{row}">{{ row.display_name || row.username }}</template></el-table-column>
        <el-table-column label="游戏" min-width="260"><template #default="{row}"><div class="game-name-row"><span class="game-name-static">{{ row.name||row.name_en||('appid:'+row.steam_appid) }}</span><span v-if="row.steam_appid" class="muted mono">{{ row.steam_appid }}</span></div></template></el-table-column>
        <el-table-column label="当前价" width="110" align="right"><template #default="{row}">{{ price(row.current_low) }}</template></el-table-column>
        <el-table-column label="史低" width="110" align="right"><template #default="{row}">{{ price(row.hist_low) }}</template></el-table-column>
        <el-table-column label="加入时间" min-width="160"><template #default="{row}">{{ dateTime(row.created_at) }}</template></el-table-column>
        <el-table-column label="权限" width="90"><template #default="{row}"><el-tag type="info" size="small">只读</el-tag></template></el-table-column>
      </el-table><PaginationBar v-model:page="wishPage" v-model:page-size="wishPageSize" :total="wishlists.length"/></div>
    </template>
    <!-- CL 批（docs/USER-ALERTS.md §4.3；CY 批：用户级只读，站点级可清理） -->
    <template v-else-if="section==='watchlist'">
      <div class="module-card"><div class="card-heading"><div><h3>全站到价提醒</h3><p>用户级提醒为私有数据、管理员只读（请用户自行操作）；站点级提醒可清理。新增请走前台详情页。</p></div></div>
      <div class="inline-form"><el-input v-model="watchQuery" clearable placeholder="搜索用户名" @keyup.enter="loadAdminWatches(1)" @clear="loadAdminWatches(1)"/><el-select v-model="watchStatus" style="width:150px" @change="loadAdminWatches(1)"><el-option label="全部状态" value=""/><el-option label="无报价" value="no_price"/></el-select><el-button type="primary" :loading="loading" @click="loadAdminWatches(1)">搜索</el-button><span class="muted">共 {{ watchTotal }} 条 · 无在售报价时不触发提醒</span><template v-if="watchSel.size"><span class="muted"> · 已选 {{ watchSel.size }} 条</span><el-button size="small" type="primary" plain :disabled="!pushChannels.length" :title="pushChannels.length?'':'先在系统设置配置通知通道'" @click="openWatchPush(null)">推送选中（{{ watchSel.size }}）</el-button><el-button size="small" type="primary" :loading="migrateRunning" @click="openWatchMigrate(null)">迁移给用户</el-button><el-button size="small" type="danger" plain :loading="bulkWatchDeleteRunning" @click="batchDeleteWatches">批量删除</el-button></template></div></div>
      <div v-if="isMobile" class="game-card-list"><div v-for="w in adminWatches" :key="w.id" class="admin-card"><div class="admin-card-main"><strong>{{ w.name||('appid:'+w.steam_appid) }}<el-tag v-if="!w.hasPrice" type="warning" size="small" title="该游戏无任何在售报价，提醒不会触发">无报价</el-tag><el-tag v-if="w.user_id!=null" type="info" size="small" class="tag-gap">只读</el-tag><el-tag v-if="w.user_id==null&&w.claimableUsers.length" type="info" size="small" class="tag-gap" :title="'Steam 愿望单候选：'+w.claimableUsers.map(u=>u.display_name||u.username).join('、')">候选 {{ w.claimableUsers.length }} 人</el-tag></strong><small>{{ w.display_name || w.username || '站点级' }} · 加入 {{ dateTime(w.created_at) }}</small><span class="muted">目标 {{ w.target_cents==null?'史低':price(w.target_cents) }} · 当前 {{ price(w.current_cents) }} · 史低 {{ price(w.hist_low) }}</span></div><div><el-button v-if="w.user_id==null" type="primary" plain size="small" :disabled="!pushChannels.length" :title="pushChannels.length?'':'先在系统设置配置通知通道'" @click="openWatchPush([w])">推送</el-button><el-button v-if="w.user_id==null&&w.claimableUsers.length" type="primary" plain size="small" @click="openWatchMigrate([w])">迁移</el-button><el-button v-if="w.user_id==null" type="danger" plain size="small" @click="removeAdminWatch(w)">删除</el-button></div></div><el-empty v-if="!adminWatches.length" description="没有到价提醒"/></div>
      <div v-else class="module-card table-card"><el-table :data="adminWatches" v-loading="loading" stripe @selection-change="onWatchSelChange">
        <el-table-column type="selection" width="40" :selectable="(row)=>row.user_id==null"/>
        <el-table-column label="用户" min-width="120"><template #default="{row}">{{ row.display_name || row.username || '站点级' }}</template></el-table-column>
        <el-table-column label="游戏" min-width="240"><template #default="{row}"><div class="game-name-row"><span class="game-name-static">{{ row.name||row.name_en||('appid:'+row.steam_appid) }}</span><span v-if="row.steam_appid" class="muted mono">{{ row.steam_appid }}</span><el-tag v-if="!row.hasPrice" type="warning" size="small" title="该游戏无任何在售报价，提醒不会触发">无报价</el-tag><el-tag v-if="row.user_id==null&&row.claimableUsers.length" type="info" size="small" :title="'Steam 愿望单候选：'+row.claimableUsers.map(u=>u.display_name||u.username).join('、')">候选 {{ row.claimableUsers.length }} 人</el-tag></div></template></el-table-column>
        <el-table-column label="目标价" width="110" align="right"><template #default="{row}">{{ row.target_cents==null?'史低':price(row.target_cents) }}</template></el-table-column>
        <el-table-column label="当前价" width="110" align="right"><template #default="{row}">{{ price(row.current_cents) }}</template></el-table-column>
        <el-table-column label="史低" width="110" align="right"><template #default="{row}">{{ price(row.hist_low) }}</template></el-table-column>
        <el-table-column label="加入时间" min-width="150"><template #default="{row}">{{ dateTime(row.created_at) }}</template></el-table-column>
        <el-table-column label="最近提醒" min-width="150"><template #default="{row}">{{ row.last_notified_at?dateTime(row.last_notified_at):'—' }}</template></el-table-column>
        <el-table-column label="操作" width="210"><template #default="{row}"><el-button v-if="row.user_id==null" link type="primary" :disabled="!pushChannels.length" :title="pushChannels.length?'':'先在系统设置配置通知通道'" @click="openWatchPush([row])">推送</el-button><el-button v-if="row.user_id==null&&row.claimableUsers.length" link type="primary" @click="openWatchMigrate([row])">迁移</el-button><el-button v-if="row.user_id==null" link type="danger" @click="removeAdminWatch(row)">删除</el-button><el-tag v-else type="info" size="small">只读</el-tag></template></el-table-column>
      </el-table><PaginationBar v-model:page="watchAdminPage" :page-size="20" :total="watchTotal" @change="loadAdminWatches(watchAdminPage)"/></div>
      <el-dialog v-model="migrateDialog.visible" title="迁移站点级提醒给用户" width="min(460px, 92vw)"><p class="muted">已选 {{ migrateDialog.ids.length }} 条站点级提醒；迁移后归该用户所有，达标提醒邮件将发送到该用户的邮箱。</p><p v-if="migrateDialog.rows.length" class="muted">游戏：{{ migrateDialog.rows.map(r=>r.name||('appid:'+r.steam_appid)).join('、') }}</p><el-select v-model="migrateDialog.targetId" placeholder="选择目标用户（Steam 愿望单反查候选）" style="width:100%"><el-option v-for="u in migrateDialog.users" :key="u.userId" :value="u.userId" :label="u.email?`${u.display_name || u.username}（${u.email}）`:u.display_name || u.username"/></el-select><template #footer><el-button @click="migrateDialog.visible=false">取消</el-button><el-button type="primary" :disabled="!migrateDialog.targetId" :loading="migrateRunning" @click="submitWatchMigrate">确认迁移</el-button></template></el-dialog>
      <!-- DF 批（docs/ALERT-MANUAL-PUSH.md §2/§3 + design/alert-manual-push-2026-11-18.html）：单条推送确认弹窗（游戏/用户/当前价/史低/上次提醒/渠道）；
           批量弹窗对齐 design/admin-confirm-no-toggle-2026-11-18.html（收件人/游戏列表/合并 1 封邮件）；强制推送与更新最近提醒时间（默认勾选）。 -->
      <el-dialog v-model="pushDialog.visible" :title="pushDialog.rows.length>1?`批量推送 ${pushDialog.rows.length} 条提醒`:'推送提醒'" width="min(520px, 92vw)">
        <template v-if="pushDialog.rows.length===1">
          <div class="push-line"><b>游戏</b><span>{{ pushDialog.rows[0].name||('appid:'+pushDialog.rows[0].steam_appid) }}<el-tag v-if="pushDialog.rows[0].steam_appid" size="small" class="tag-gap">appid {{ pushDialog.rows[0].steam_appid }}</el-tag></span></div>
          <div class="push-line"><b>用户</b><span>站点级（发到站点负责人邮箱）</span></div>
          <div class="push-line"><b>当前 / 史低</b><span>{{ price(pushDialog.rows[0].current_cents) }} / {{ price(pushDialog.rows[0].hist_low) }}</span></div>
          <div class="push-line"><b>上次提醒</b><span>{{ pushDialog.rows[0].last_notified_at?dateTime(pushDialog.rows[0].last_notified_at):'—（从未提醒）' }}</span></div>
          <div class="push-line"><b>发送渠道</b><span>{{ channelLabel('email') }} · {{ channelLabel('webhook') }} · {{ channelLabel('wecom') }}</span></div>
        </template>
        <template v-else>
          <div class="push-line"><b>收件人</b><span v-if="pushChannels.includes('email')">站点负责人邮箱 · 已配置</span><span v-else>已配置通道：{{ pushChannels.join(' / ') }}（无邮件收件人）</span></div>
          <div class="push-list"><div v-for="r in pushDialog.rows" :key="r.id"><span class="push-name">{{ r.name||('appid:'+r.steam_appid) }}</span><span class="muted">当前 {{ price(r.current_cents) }} / 史低 {{ price(r.hist_low) }}</span></div></div>
          <div class="push-line"><b>发送方式</b><span><b>合并为 1 封邮件</b>（正文列出以上 {{ pushDialog.rows.length }} 款）</span></div>
        </template>
        <label class="push-opt"><el-checkbox v-model="pushDialog.force"><span><b>强制推送</b>：即使当前价未达目标价/史低也发送（用于测试或补发）</span></el-checkbox></label>
        <label class="push-opt"><el-checkbox v-model="pushDialog.mark"><span><b>更新最近提醒时间</b>：写入 last_notified 后，自动任务不会对同价格重复提醒</span></el-checkbox></label>
        <p class="push-notice">这会立即向收件人发送「到价提醒」邮件，发送后不可撤回；本次操作将记入审计日志。</p>
        <template #footer><el-button @click="pushDialog.visible=false">取消</el-button><el-button type="primary" :loading="pushRunning" @click="submitWatchPush">确认推送</el-button></template>
      </el-dialog>
    </template>
    <!-- 公告 -->
    <template v-else-if="section==='announcements'">
      <div class="module-card announcement-head"><div class="card-heading"><div><h3>站点通知</h3><p>这里只留公告列表；新建 / 编辑通知走弹窗（带前台预览，不跳页）。</p></div><el-button type="primary" @click="openAnnouncementDrawer()">＋ 新建通知</el-button></div></div>
      <BulkBar :count="sel.announcements.count" :actions="announcementsBulkActions" :running="bulkRunning" @run="(a)=>runBulk(a,sel.announcements,{refresh:loadAnnouncements})" @clear="sel.announcements.clear()"/><div class="announcement-list"><article v-for="a in pagedAnnouncements" :key="a.id" class="module-card announcement-item"><el-checkbox class="announcement-pick" :model-value="sel.announcements.has(a)" @change="sel.announcements.toggle(a)"/><div class="announcement-badge" :class="a.level">{{ levelLabel(a.level) }}</div><div class="announcement-copy"><div class="card-heading"><h3>{{ a.title }}</h3><el-tag :type="a.active?'success':'info'" size="small">{{ a.active?'启用':'停用' }}</el-tag></div><p>{{ a.body }}</p><small>{{ a.starts_at?dateTime(a.starts_at):'立即生效' }} — {{ a.ends_at?dateTime(a.ends_at):'长期有效' }}</small></div><div class="item-actions"><el-button @click="openAnnouncementDrawer(a)">编辑</el-button><el-button type="danger" plain @click="removeAnnouncement(a.id)">删除</el-button></div></article><el-empty v-if="!announcements.length" description="还没有站点通知"/></div>
      <AnnouncementDrawer v-model:visible="announcementDrawer.visible" :edit="announcementDrawer.edit" @saved="loadAnnouncements" @closed="closeAnnouncementDrawerUrl" />
    </template>

    <!-- 设置 -->
    <!-- FY-1（docs/SETTINGS-REDESIGN.md §2/§3.1/§3.2）：横向 7 tab → 左侧竖排导航（7 个对象组）+ 二级路由；
         FY-2（§3.2/§3.3/§3.4/§3.5）：右侧改成「分区标题 + 一行一项」+ 每项即时保存 + 跨组搜索/只看非默认 + 移动端两段式。 -->
    <template v-else-if="section==='settings'">
      <div class="settings-page">
        <aside class="settings-nav" aria-label="设置分组">
          <button v-for="g in settingsGroups" :key="g.id" type="button" class="settings-nav-item" :class="{ on: g.id===activeSettingsGroup }" :aria-current="g.id===activeSettingsGroup?'page':null" @click="goSettingsGroup(g.id)"><span class="settings-nav-ico">{{ g.icon }}</span><span class="settings-nav-name">{{ g.title }}</span><span class="settings-nav-count">{{ groupItemCount(g.id) }}</span></button>
          <div class="settings-nav-foot"><div>版本 {{ settingsSchema?.version||'—' }} · 配置修订 {{ settingsSchema?.revision||0 }}</div><div>改一项即存，约 15 秒生效</div><span v-if="settingsConflict || proxyDialogDirty" class="dirty-dot">{{ proxyDialogDirty ? '代理有未保存的修改' : '设置保存失败，待重试' }}</span></div>
        </aside>
        <div class="settings-main">
          <div class="settings-nav-mobile"><el-select :model-value="activeSettingsGroup" class="settings-nav-select" @change="goSettingsGroup"><el-option v-for="g in settingsGroups" :key="g.id" :label="`${g.icon} ${g.title} · ${groupItemCount(g.id)} 项`" :value="g.id"/></el-select></div>
          <div class="settings-crumb">管理控制台 <span>/</span> 系统设置 <span>/</span> {{ activeSettingsGroupItem?.title }}</div>
          <div class="settings-head"><h2>{{ activeSettingsGroupItem?.title }}</h2><p v-if="activeSettingsGroupItem?.description">{{ activeSettingsGroupItem.description }}</p></div>
          <div class="settings-toolbar"><el-input v-model="settingQuery" class="settings-search" clearable placeholder="搜索设置项，例如 Steam、代理、SMTP（跨 7 组匹配，点结果跳组）"/><el-checkbox v-model="settingsOnlyChanged">只看非默认</el-checkbox></div>
          <!-- FY-2（docs/SETTINGS-REDESIGN.md §3.4）：搜索常驻组顶、跨 7 组匹配 label/key/help；命中面板显示「组 · 分区」，点击跳组并高亮该行 -->
          <div v-if="settingQuery.trim()" class="settings-hits" aria-label="跨组搜索结果">
            <button v-for="hit in settingSearchHits" :key="hit.key" type="button" class="settings-hit" :class="{ on: hit.key===highlightKey }" @click="jumpToSetting(hit)"><span class="hit-label">{{ hit.label }}<span v-if="hit.tier==='advanced'" class="hit-adv">高级</span></span><span class="hit-meta">{{ groupTitle(hit.group) }}<template v-if="sectionTitleOf(hit)"> · {{ sectionTitleOf(hit) }}</template></span></button>
            <p v-if="!settingSearchHits.length" class="settings-hits-empty">没有匹配的设置项</p>
          </div>
          <el-empty v-if="settingsSchema && !visibleSections.length" description="没有匹配的设置项"/>
          <!-- FY-2（§3.2）：每个分区 = 分区标题（名称 + 项数 + 启用状态徽标）+ 一行一项；没有卡片盒子、高级项不再折叠 -->
          <div v-else class="settings-sections">
            <section v-for="sec in visibleSections" :key="sec.id" class="settings-section">
              <div v-if="!sec.plain" class="section-head"><h3>{{ sec.title }}</h3><span class="section-n">{{ sec.fields.length }} 项</span><span v-if="sec.enabledKey" class="section-st" :class="{ off: !settingValues[sec.enabledKey] }">{{ settingValues[sec.enabledKey] ? '已启用' : '已停用' }}</span></div>
              <SettingsRow v-for="field in sec.fields" :key="field.key" :dom-id="settingId(field.key)" :field="field" :value="settingValues[field.key]" :source="settingsSchema?.sources?.[field.key]" :has-value="Boolean(settingsSchema?.secrets?.[field.key]?.hasValue)" :revision="settingsSchema?.revision" :status="rowStatus[field.key]" :hit="highlightKey===field.key" @commit="(v)=>commitSetting(field,v)" @input="(v)=>inputSetting(field,v)" @commit-now="(v)=>commitSettingNow(field,v)" @restore="restoreField(field)" @saved="(d)=>onSecretSaved(d,field.key)">
                <template #after><template v-if="field.key==='network.steamProxy'"><span class="proxy-count">{{ proxySavedCount!=null ? `已配置 ${proxySavedCount} 条` : (settingsSchema?.secrets?.[field.key]?.hasValue ? '已设置（点眼睛查看，或用「编辑」修改）' : '尚未设置（Steam 走直连/通用代理）') }}</span><el-button text @click="openProxyDialog">编辑</el-button></template></template>
              </SettingsRow>
            </section>
          </div>
        </div>
      </div>
    </template>

    <!-- 统计 -->
    <template v-else-if="section==='stats'">
      <div class="module-tabs"><button :class="{on:statsView==='price'}" @click="statsView='price'">价格变化</button><button :class="{on:statsView==='views'}" @click="statsView='views'">浏览排行</button><button :class="{on:statsView==='assets'}" @click="statsView='assets'">图片与备份</button></div>
      <template v-if="statsView==='price'"><div class="report-heading"><div><h2>价格变化 · 近 24 小时</h2><p>只统计有前次价格快照的变化</p></div><el-button :loading="statsLoading" @click="refreshStats">刷新数据</el-button><el-button tag="a" href="/api/admin/reports/price.csv?hours=24" target="_blank">导出 CSV</el-button></div><div class="metric-grid"><div v-for="item in priceMetrics" :key="item.label" class="metric-card" :class="item.tone"><span>{{ item.label }}</span><strong>{{ item.value }}</strong></div></div><div class="module-card table-card"><template v-if="!isMobile"><el-table :data="priceRows" stripe><el-table-column prop="name" label="游戏" min-width="220"/><el-table-column prop="platform_name" label="平台" width="140"/><el-table-column label="原价" width="110" align="right"><template #default="{row}">{{ price(row.was) }}</template></el-table-column><el-table-column label="现价" width="110" align="right"><template #default="{row}">{{ price(row.now_price) }}</template></el-table-column><el-table-column label="变化" width="110" align="right"><template #default="{row}"><el-popover placement="left" :width="264" trigger="hover"><template #reference><span class="price-change-cell" :class="row.drop_cents>0?'price-down':'price-up'">{{ row.drop_cents>0?'−':'+' }}{{ Math.round(Math.abs(row.drop_cents)/Math.max(1,row.was)*100) }}%</span></template><PriceSparkline :points="priceSeries[row.game_id]||[]" :current="row.now_price" :currency="(priceSeries[row.game_id]||[])[0]?.currency||'CNY'"/></el-popover></template></el-table-column><el-table-column label="时间" min-width="160"><template #default="{row}">{{ dateTime(row.captured_at) }}</template></el-table-column></el-table></template><div v-else class="game-card-list"><div v-for="row in priceRows" :key="row.game_id + '-' + row.captured_at" class="admin-card"><div class="admin-card-main"><strong>{{ row.name }}</strong><small>{{ row.platform_name }} · {{ dateTime(row.captured_at) }}</small><div class="admin-card-tags"><span class="price-change-cell" :class="row.drop_cents>0?'price-down':'price-up'">{{ row.drop_cents>0?'−':'+' }}{{ Math.round(Math.abs(row.drop_cents)/Math.max(1,row.was)*100) }}%</span><small class="muted">原价 {{ price(row.was) }} → 现价 {{ price(row.now_price) }}</small></div></div></div></div><PaginationBar v-model:page="pricePage" v-model:page-size="pricePageSize" :total="priceChanges.length"/></div></template>
      <template v-else-if="statsView==='views'"><div class="module-card table-card"><div class="card-heading padded"><div><h3>浏览排行</h3><p>累计页面访问数据</p></div><el-checkbox v-model="aggregateViews">按游戏聚合</el-checkbox></div><template v-if="!isMobile"><el-table :data="viewRowsPage" stripe><el-table-column prop="name" label="游戏 / 页面" min-width="180"/><el-table-column prop="path" label="路径" min-width="180" show-overflow-tooltip/><el-table-column label="现价" width="100" align="right"><template #default="{row}">{{ price(row.price) }}</template></el-table-column><el-table-column prop="views" label="访问" width="90" align="right"/><el-table-column label="最近访问" min-width="160"><template #default="{row}">{{ dateTime(row.last_at) }}</template></el-table-column></el-table></template><div v-else class="game-card-list"><div v-for="(row, i) in viewRowsPage" :key="(row.path||'') + '-' + i" class="admin-card"><div class="admin-card-main"><strong>{{ row.name }}</strong><p class="admin-card-path">{{ row.path }}</p><div class="admin-card-tags"><span class="muted">现价 {{ price(row.price) }}</span><span class="muted">访问 {{ row.views }}</span><small class="muted">{{ dateTime(row.last_at) }}</small></div></div></div></div><PaginationBar v-model:page="viewsPage" v-model:page-size="viewsPageSize" :total="viewRows.length"/></div></template>
      <template v-else><div class="module-card cache-card"><div class="card-heading"><div><h3>封面缓存</h3><p>本机缓存的 Steam 封面图片</p></div><span class="heading-actions"><el-button type="warning" plain :loading="imageResetLoading" @click="resetImageMiss">清除缺图缓存</el-button><el-button :loading="statsLoading" @click="refreshStats">刷新</el-button></span></div><div class="cache-stats"><div><strong>{{ imageStats.images||0 }}</strong><span>张图片</span></div><div><strong>{{ imageStats.games||0 }}</strong><span>款游戏</span></div><div><strong>{{ imageMb }} MB</strong><span>占用空间</span></div></div><small class="muted">{{ imageStats.root||'data/images' }}</small></div><div class="module-card coverage-card"><div class="card-heading padded"><div><h3>图片覆盖看板</h3><p>header_image 覆盖与本地缓存统计；缺图游戏按原因列出（header_image 空 / CDN 404 / 抓取失败）。</p></div><span class="heading-actions"><el-button type="primary" plain :loading="backfillRunning" @click="runImagesBackfill">重同步缺图</el-button><el-button text :loading="coverageLoading" @click="refreshCoverage">刷新</el-button></span></div><div class="metric-grid"><div class="metric-card"><span>游戏总数</span><strong>{{ coverage.stats.totalGames??'—' }}</strong></div><div class="metric-card"><span>有 header_image</span><strong>{{ coverage.stats.withHeaderImage??'—' }}</strong></div><div class="metric-card"><span>本地已缓存</span><strong>{{ coverage.stats.cachedGames??'—' }}<small class="muted">款 / {{ coverage.stats.cachedImages||0 }} 张</small></strong></div><div class="metric-card"><span>缺图</span><strong :class="{'text-danger':(coverage.stats.missing||0)>0}">{{ coverage.stats.missing??'—' }}</strong><small class="muted">空 {{ coverage.stats.missingByReason?.noHeader??0 }} · CDN 404 {{ coverage.stats.missingByReason?.cdn404??0 }} · 抓取失败 {{ coverage.stats.missingByReason?.fetchFailed??0 }}</small></div></div><div class="module-card table-card coverage-list"><template v-if="!isMobile"><el-table :data="coverage.list.items" size="small" stripe><el-table-column label="游戏" min-width="240"><template #default="{row}">{{ row.name }}</template></el-table-column><el-table-column prop="steam_appid" label="AppID" width="100"/><el-table-column label="缺图原因" width="140"><template #default="{row}"><el-tag size="small" :type="row.reason==='CDN 404'?'warning':row.reason==='抓取失败'?'danger':'info'">{{ row.reason }}</el-tag></template></el-table-column></el-table></template><div v-else class="game-card-list"><div v-for="row in coverage.list.items" :key="row.steam_appid || row.name" class="admin-card"><div class="admin-card-main"><strong>{{ row.name }}</strong><small>AppID {{ row.steam_appid || '—' }}</small><div class="admin-card-tags"><el-tag size="small" :type="row.reason==='CDN 404'?'warning':row.reason==='抓取失败'?'danger':'info'">{{ row.reason }}</el-tag></div></div></div></div><el-empty v-if="!coverage.list.items?.length" description="暂无缺图游戏" :image-size="48"/><PaginationBar v-model:page="coveragePage" v-model:page-size="coveragePageSize" :total="coverage.list.total||0" @change="loadCoverage"/></div></div><div class="module-card backup-box"><div class="card-heading"><div><h3>数据备份</h3><p>核心表压缩备份，仅手动触发、不自动执行；保留最近 7 份</p></div><template v-if="backupEnabled"><el-button type="primary" :loading="backupLoading" @click="createBackupNow">立即备份</el-button></template><template v-else><span class="heading-actions"><el-button type="primary" disabled>立即备份</el-button><small class="muted">备份功能已关闭（系统设置 → 高级 → 备份与日志）</small></span></template></div><div v-for="b in pagedBackups" :key="b.name" class="backup-row"><span class="backup-name" :title="b.name">{{ b.name }}</span><span class="muted">{{ b.mtime?dateTime(b.mtime):'—' }}</span><span>{{ (b.size/1024/1024).toFixed(2) }} MB</span><span class="backup-row-actions"><el-button link type="primary" @click="downloadBackup(b)">下载</el-button><el-button link type="danger" :loading="backupDeleteLoading" @click="removeBackup(b)">删除</el-button></span></div><small v-if="!backups.length" class="muted">还没有备份</small><PaginationBar v-model:page="backupPage" v-model:page-size="backupPageSize" :total="backups.length"/></div></template>
    </template>

    <!-- 申诉管理（O 批，docs/APPEAL-SYSTEM.md §5） -->
    <AppealsAdmin v-else-if="section==='appeals'"/>
      <!-- EL 批（docs/ADMIN-EDIT-DIALOG.md EK-4）：Steam 专用代理内联编辑器改为弹窗（列表增删/排序/健康表/保存回写） -->
      <el-dialog v-model="proxyDialogOpen" title="Steam 专用代理" width="min(680px, 92vw)" :before-close="closeProxyDialog"><p class="muted">只作用于 Steam 域名；可配多条（按顺序尝试、最多 10 条），仅支持 http/https。保存后调度器约 15 秒内生效。</p><div class="proxy-row" v-for="(row,i) in proxyList" :key="i"><span class="proxy-index">{{ i+1 }}</span><el-input v-model="row.value" placeholder="http://127.0.0.1:7890" autocomplete="off" @input="markProxyDirty"/><el-button text size="small" :disabled="i===0" @click="moveProxy(i,-1)">上移</el-button><el-button text size="small" :disabled="i===proxyList.length-1" @click="moveProxy(i,1)">下移</el-button><el-button text size="small" type="danger" @click="removeProxy(i)">删除</el-button></div><div class="proxy-actions"><el-button text type="primary" size="small" :disabled="proxyList.length>=10" @click="addProxy">添加一条</el-button><el-button text type="danger" size="small" :disabled="!proxyList.length" @click="clearProxyList">清空全部</el-button><span v-if="proxyList.length>=10" class="muted">已达上限 10 条</span></div><div class="proxy-health"><div class="proxy-health-head"><strong>健康状态</strong><el-button text size="small" :loading="proxyProbing" @click="probeProxies">立即检测</el-button><el-button text size="small" @click="loadProxyHealth">刷新</el-button></div><el-table v-if="proxyHealth.proxies?.length" :data="proxyHealth.proxies" size="small" stripe><el-table-column prop="index" label="#" width="46"/><el-table-column prop="proxy" label="代理" min-width="190" show-overflow-tooltip/><el-table-column label="状态" width="130"><template #default="{row}"><el-tag :type="proxyStateType(row)" size="small">{{ proxyStateText(row) }}</el-tag></template></el-table-column><el-table-column label="最近检测" width="150"><template #default="{row}">{{ row.probeAt?dateTime(row.probeAt):"—" }}</template></el-table-column><el-table-column prop="fails" label="连续失败" width="82" align="right"/><el-table-column label="冷却到" min-width="150"><template #default="{row}">{{ row.downUntil?dateTime(row.downUntil):'—' }}</template></el-table-column><el-table-column label="最近错误" min-width="140" show-overflow-tooltip><template #default="{row}">{{ row.lastError || row.probeError || "—" }}</template></el-table-column></el-table><p v-else class="muted">未配置代理，或还没有健康记录</p></div><template #footer><el-button @click="cancelProxyDialog">取消</el-button><el-button type="primary" :loading="proxySaving" @click="onSaveProxyDialog">保存</el-button></template></el-dialog>
      <!-- FX 批（docs/SECRET-REVEAL.md §4）：通用出网代理 / App 同步专用代理改行内「密码框 + 眼睛」（懒加载 + 清除），EK-5 的查看/编辑弹窗已移除 -->
      <BulkResultDialog v-model="bulkResult.visible" :result="bulkResult.result"/>
      <GameDetailDialog v-model="gameDetail.visible" :appid="gameDetail.appid" :row="gameDetail.row"/>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import PaginationBar from '../components/PaginationBar.vue';
import BulkBar from '../components/BulkBar.vue';
import BulkResultDialog from '../components/BulkResultDialog.vue';
import { useBulkSelection, promptBulkConfirm } from '../composables/useBulkSelection.js';
// FQ 批（docs/UI-BUTTON-FEEDBACK.md §3）：按钮点击反馈——loading 防连点（≥200ms）+ 成功/失败提示
import { useAction } from '../composables/useAction.js';
// BM-3（docs/SESSION-MANAGEMENT.md §8.4.3）：401 统一软跳登录页（不再 window.location.href 整页跳）
import { redirectToLogin } from '../utils/session.js';
import { useListPagination } from '../composables/useListPagination.js';
import { useTheme } from '../composables/useTheme.js';
import { fmtDateTime as dateTime } from '../utils/siteTime.js';
import { yuanAmount } from '../utils/money.js';
import { isMailSettingKey, SETTINGS_GROUP_IDS, DEFAULT_SETTINGS_GROUP, isSettingsGroupId } from '../utils/settings.js';
import { copyText } from '../utils/clipboard.js';
import { nameCopyText } from '../utils/gameNames.js';
import GameLinksDrawer from '../components/GameLinksDrawer.vue';
import GameDetailDialog from '../components/GameDetailDialog.vue';
import AnnouncementDrawer from '../components/AnnouncementDrawer.vue';
import AppealsAdmin from '../components/AppealsAdmin.vue';
import PriceSparkline from '../components/PriceSparkline.vue';
import CoverPlaceholder from '../components/CoverPlaceholder.vue';
// FX 批（docs/SECRET-REVEAL.md §4）：密钥字段统一「密码框 + 眼睛懒加载」组件（平铺/网格/折叠/代理四处复用）
import SecretField from '../components/SecretField.vue';
// FY-2（docs/SETTINGS-REDESIGN.md §3.2）：设置页行组件——分区标题 + 一行一项（左 label/帮注/来源，右控件/保存状态）
import SettingsRow from '../components/SettingsRow.vue';
// FY-2（§3.3）：每项即时保存的合并队列（静默 700ms / 上限 1.5s，回滚与行内状态由它驱动）
import { createSettingsSaver } from '../utils/settingsSave.js';
import { CopyDocument, Check, ArrowDown } from '@element-plus/icons-vue';
import SyncAdmin from '../components/sync/SyncAdmin.vue';
import AlignAdmin from '../components/AlignAdmin.vue';
// FZ 批（docs/VISITORS-REDESIGN.md）：访问记录七块页面（左导航 + ?view= + IP 详情抽屉）独立组件
import VisitorsAdmin from '../components/visitors/VisitorsAdmin.vue';
import { registerUnsavedSource, bypassNextGuard } from '../composables/useUnsavedGuard.js';

const props=defineProps({section:{type:String,required:true}});
const router=useRouter();const route=useRoute();
const loading=ref(false),saving=ref(false),error=ref('');
// FQ 批（docs/UI-BUTTON-FEEDBACK.md §3）：按钮反馈实例——刷新类各自独立 loading（互不串扰），
// 操作类按域分开；settingsAction 供「恢复默认/重新加载」共用（设置页为低频操作）。
const statsAction=useAction(),coverageAction=useAction(),devicesAction=useAction(),securityAction=useAction(),wishlistsAction=useAction(),settingsAction=useAction(),backupAction=useAction(),backupDeleteAction=useAction(),imageResetAction=useAction(),gamesAction=useAction();
// FQ 批：Vue 模板 ref 解包仅限顶层——loading 必须提为顶层别名绑定，
// 否则 :loading="backupLoading" 传入的是 Ref 对象（恒 truthy → 按钮永远 loading）。
const statsLoading=statsAction.loading,coverageLoading=coverageAction.loading,devicesLoading=devicesAction.loading,securityLoading=securityAction.loading,wishlistsLoading=wishlistsAction.loading,backupLoading=backupAction.loading,backupDeleteLoading=backupDeleteAction.loading,imageResetLoading=imageResetAction.loading,gamesLoading=gamesAction.loading;
// DV 批（docs/ITAD-SOURCE-FILTER.md §2 方案 A）：itad 不在平台数组里，单独在「来源」分组渲染「ITAD（来源）」
const platforms=[{value:'steam',label:'Steam'},{value:'sonkwo',label:'杉果'},{value:'gog',label:'GOG'},{value:'humble',label:'Humble'},{value:'steampy',label:'SteamPy'}];
// 窄屏（手机）时游戏目录/访问记录改用卡片式渲染（docs/MOBILE-FIX.md §3D）：
// 响应式监听 760 断点（含窗口缩放/旋转）；其余表格由 .m-console 的滑动提示覆盖
const mobileQuery=typeof window!=='undefined'&&window.matchMedia?window.matchMedia('(max-width: 760px)'):null;
const isMobile=ref(Boolean(mobileQuery&&mobileQuery.matches));
function onMobileChange(e){isMobile.value=e.matches;}
const theme=useTheme();
function resetTheme(){ theme.resetToSystem(); fetch('/api/prefs',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({theme:null})}).catch(()=>{}); }
const games=ref([]),gameStats=ref({}),gameQuery=ref(''),gamePlatform=ref(''),gameStatus=ref(''),gameRating=ref(''),gameOffers=ref(''),gamePage=ref(1),gamePageSize=ref(20),gamePages=ref(1),gameTotal=ref(0),gameDialog=ref(false),activeGame=ref(null),gameDescription=ref(''),gameBlocked=ref(false),mergeDialog=ref(false),mergeForm=reactive({from:'',to:''});
const announcements=ref([]);
// AT 批（docs/ADMIN-CONSOLE-IA.md §3/§7）：新建/编辑通知改弹窗（表单与未保存守卫在 AnnouncementDrawer 内；EL 批由抽屉改弹窗）
const announcementDrawer=reactive({visible:false,edit:null});
const settingsSchema=ref(null),settingValues=reactive({}),settingQuery=ref('');
const priceReport=ref({}),priceSeries=ref({}),views=ref([]),imageStats=ref({}),backups=ref([]),aggregateViews=ref(false),statsView=ref('price');
// FR 批（docs/BACKUP-AS-FEATURE.md §2）：system.backupEnabled =「允许后台手动备份」，
// false 时「立即备份」按钮禁用并提示「备份功能已关闭」（值来自 GET /api/admin/backups 响应）。
const backupEnabled=ref(true);
// EC 批（docs/IMAGE-COVERAGE.md §8 EC-1）：图片覆盖看板状态（stats → 图片与备份）
const coverage=ref({stats:{},list:{items:[],total:0}}),coveragePage=ref(1),coveragePageSize=ref(10),backfillRunning=ref(false);
const announcementsPager=useListPagination(announcements), backupsPager=useListPagination(backups);
// ---- 批量操作（docs/ADMIN-BULK-ACTIONS.md）：每张表一个 table ref + 一份多选状态 ----
// sel.* 用 reactive 包一层，模板里才能直接写 sel.games.count（reactive 会展开内部 ref）。
const gamesTable=ref(null);
const sel={
  games:reactive(useBulkSelection((r)=>r.id,gamesTable)),
  announcements:reactive(useBulkSelection((r)=>r.id,null)),
};
const bulkResult=reactive({visible:false,result:null}),bulkRunning=ref('');
const gamesBulkActions=[{key:'block',label:'禁用',target:'games',action:'block',risk:'high'},{key:'unblock',label:'启用',target:'games',action:'unblock'},{key:'delete',label:'删除（进回收站）',target:'games',action:'delete',risk:'high'}];
const announcementsBulkActions=[{key:'activate',label:'启用',target:'announcements',action:'activate'},{key:'deactivate',label:'停用',target:'announcements',action:'deactivate'},{key:'delete',label:'删除',target:'announcements',action:'delete',risk:'high'}];
// CY 批（docs/DATA-ISOLATION.md §3）：wishlistBulkActions 已移除——愿望单属用户私有数据，管理员只读
// ---- 站点通知列表（新建/编辑走 AnnouncementDrawer；批量操作记录已搬进操作日志，AT 批）----
const pagedAnnouncements=announcementsPager.items,announcementsPage=announcementsPager.page,announcementsPageSize=announcementsPager.pageSize;
const pagedPriceChanges=useListPagination(computed(()=>[...(priceReport.value.topDrops||[]),...(priceReport.value.topRises||[])]));
const pagedBackups=backupsPager.items;
const pagedViews=useListPagination(computed(()=>{const rows=views.value.slice();if(!aggregateViews.value)return rows;const map=new Map();for(const v of rows){const key=v.name||v.path;const current=map.get(key)||{name:v.name,path:'多个页面',views:0,last_at:v.last_at};current.views+=v.views;if(v.last_at>current.last_at)current.last_at=v.last_at;map.set(key,current);}return [...map.values()].sort((a,b)=>b.views-a.views);}));
const pricePage=pagedPriceChanges.page,pricePageSize=pagedPriceChanges.pageSize,priceRows=pagedPriceChanges.items;
const backupPage=backupsPager.page,backupPageSize=backupsPager.pageSize;
const viewsPage=pagedViews.page,viewsPageSize=pagedViews.pageSize,viewRowsPage=pagedViews.items;
function api(path,options={}){return fetch(path,{credentials:'same-origin',...options,headers:{'content-type':'application/json',...(options.headers||{})}}).then(async r=>{const t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch{}if(r.status===401){redirectToLogin();throw new Error(d.error||'登录已过期');}if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);return d;});}
function json(method,body){return {method,body:JSON.stringify(body)};}
function price(cents){return cents==null?'—':`¥${yuanAmount(cents)}`;}
function notifyError(e){ElMessage.error(e?.message||String(e));}
// FQ 批（docs/UI-BUTTON-FEEDBACK.md §3）：run() 升级——防连点（loading 期间忽略再次触发）+
// loading 至少 200ms（不闪烁）；成功提示由各调用方内部 ElMessage.success（回归不破坏），失败统一 notifyError。
let runBusy=false;
async function run(action){
  if(runBusy)return;
  runBusy=true;
  saving.value=true;
  const startedAt=Date.now();
  try{await action();}
  catch(e){notifyError(e);}
  finally{
    const done=()=>{saving.value=false;runBusy=false;};
    const left=200-(Date.now()-startedAt);
    if(left>0)setTimeout(done,left);else done();
  }
}
// FQ 批：刷新类按钮包装——点击即 loading + 「已刷新」提示；自动加载路径（onMounted/watch）仍走原函数、不弹提示。
async function refreshGamesAction(){await gamesAction.run(()=>refreshGames(),{success:'已刷新'});}
async function refreshStats(){await statsAction.run(()=>loadStats(),{success:'已刷新'});}
async function refreshCoverage(){await coverageAction.run(()=>loadCoverage(),{success:'已刷新'});}
async function refreshWishlists(){await wishlistsAction.run(()=>loadWishlists(),{success:'已刷新'});}
async function reloadSettings(){await settingsAction.run(()=>loadSettings(),{success:'已重新加载'});}
// 批量执行：高危动作先让用户手输条数（服务端还会再校验 confirmCount），成功后弹结果并刷新列表。
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
    const d=await api('/api/admin/bulk',json('POST',payload));
    bulkResult.result=d;bulkResult.visible=true;
    selection.clear();
    if(refresh)await refresh();
  }catch(e){notifyError(e);}
  finally{bulkRunning.value='';}
}

// AG 批（docs/ADMIN-PLATFORM-LINKS.md）：平台链接抽屉 + 复制游戏名（clipboard API + execCommand 降级）
const linksDrawer=reactive({visible:false,game:null,links:[],loading:false});
const copiedGameId=ref(null);let copiedTimer=null;
async function copyGameName(row,appid=false){const text=appid?String(row.steam_appid):nameCopyText(row);const ok=await copyText(text);if(ok){if(!appid){copiedGameId.value=row.id;clearTimeout(copiedTimer);copiedTimer=setTimeout(()=>{copiedGameId.value=null;},1200);}ElMessage.success(appid?'已复制 AppID':'已复制中英文名');}else{ElMessage.warning('复制失败，请手动选择');}}
async function openGameLinks(row){linksDrawer.visible=true;linksDrawer.game=row;linksDrawer.links=[];linksDrawer.loading=true;try{const d=await api(`/api/admin/games/${row.id}/links`);linksDrawer.links=d.links||[];linksDrawer.game=d.game||row;}catch(e){notifyError(e);}finally{linksDrawer.loading=false;}}
// CW 批（docs/ADMIN-GAME-POPUP.md §3）：点游戏名弹详情弹窗（数据走 GET /api/games/:appid，站内已同步 Steam 数据）
const gameDetail=reactive({visible:false,appid:null,row:null});
function openGameDetail(row){gameDetail.visible=true;gameDetail.appid=row.steam_appid??null;gameDetail.row=row;}
async function loadGames(page=gamePage.value){sel.games.clear();loading.value=true;gamePage.value=page;try{const qs=new URLSearchParams({page:String(page),pageSize:String(gamePageSize.value),q:gameQuery.value.trim(),platform:gamePlatform.value,status:gameStatus.value,rating:gameRating.value,offers:gameOffers.value});const [d,s]=await Promise.all([api(`/api/admin/games?${qs}`),api('/api/admin/games/stats')]);games.value=d.games||[];gameTotal.value=d.total||0;gamePages.value=d.pages||1;gameStats.value=s.stats||{};}catch(e){notifyError(e);}finally{loading.value=false;}}
// 指标卡即筛选：activeMetric 决定哪张卡高亮；点击切换对应筛选并回到第 1 页；再点一次取消。
// 已删除没有列表筛选（恢复操作在回收站页），点击跳转到回收站。
// 状态分项口径见 docs/STEAM-SYNC-STATUS-AND-RATING.md §4。
// FI（docs/ADMIN-RATING-FILTER.md）：「内容分级」筛选入口（全部/成人内容（宽）/色情游戏（严格）/成熟/未分级 →
// rating=adult|explicit|mature|none；管理端不受 site.adultDisplay 影响）；adult/explicit/mature 只读数字
// 由「同步与回填」页的「内容分级统计」卡片（FH，docs/ADULT-STATS.md）展示，
// /api/admin/games 的 rating 参数后端始终支持。
const activeMetric=computed(()=>gameOffers.value==='priced'?'offers':gameStatus.value?gameStatus.value:'all');
const METRIC_TARGETS={all:{},pending:{status:'pending'},synced:{status:'synced'},free:{status:'free'},coming_soon:{status:'coming_soon'},region_locked:{status:'region_locked'},no_price:{status:'no_price'},not_found:{status:'not_found'},other:{status:'other'},offers:{offers:'priced'}};
function clickMetric(key){
  if(key==='deleted'){router.push({path:'/console',query:{section:'recycle'}});return;}
  const target=METRIC_TARGETS[key];
  if(!target)return;
  if(activeMetric.value===key){gameStatus.value='';gameOffers.value='';}
  else{gameStatus.value=target.status||'';gameOffers.value=target.offers||'';}
  gameRating.value='';
  loadGames(1);
}
// Steam 同步状态 / 分级列
const STEAM_STATUS_LABELS={ok:'正常',free:'免费',coming_soon:'未发售',region_locked:'锁国区',no_price:'国区无价',not_found:'国区不可售'};
function steamStatusLabel(row){return row.steam_status?STEAM_STATUS_LABELS[row.steam_status]||row.steam_status:'未探测';}
function refreshGames(){return loadGames(gamePage.value);}
async function changeGameSize(n){gamePageSize.value=n;await loadGames(1);}
async function toggleGame(row){await run(async()=>{await api(`/api/games/${row.steam_appid}/blocked`,json('POST',{blocked:!row.blocked}));ElMessage.success(row.blocked?'游戏已启用':'游戏已禁用');await refreshGames();});}
async function deleteGame(row){try{await ElMessageBox.confirm(`删除“${row.name}”？数据会进入回收站，可恢复。`,'确认删除',{type:'warning',confirmButtonText:'移入回收站'});await api(row.steam_appid?`/api/games/${row.steam_appid}/deleted`:`/api/games/id/${row.id}/deleted`,json('POST',{deleted:true}));ElMessage.success('已移入回收站');await refreshGames();}catch(e){if(e!=='cancel'&&e!=='close')notifyError(e);}}
async function editGame(row){activeGame.value=row;gameBlocked.value=Boolean(row.blocked);try{const d=await api(`/api/games/${row.steam_appid}`);gameDescription.value=d.game?.description||'';}catch(e){notifyError(e);return;}gameDialog.value=true;gameSnapshot=JSON.stringify({description:gameDescription.value,blocked:Boolean(gameBlocked.value)});}
function closeGameDialog(){gameDialog.value=false;gameSnapshot=null;}
async function submitGameSave(){if(!activeGame.value)return;await api(`/api/games/${activeGame.value.steam_appid}/description`,json('POST',{description:gameDescription.value,overwrite:true}));await api(`/api/games/${activeGame.value.steam_appid}/blocked`,json('POST',{blocked:gameBlocked.value}));}
async function saveGame(){if(!activeGame.value)return;await run(async()=>{await submitGameSave();gameDialog.value=false;gameSnapshot=null;ElMessage.success('游戏资料已保存');await refreshGames();});}
// AN 批（docs/UNSAVED-GUARD.md §4.4）：编辑游戏弹窗的脏判定（字段与打开时快照比较）
let gameSnapshot=null;
function gameDirty(){return gameDialog.value&&gameSnapshot!==null&&JSON.stringify({description:gameDescription.value,blocked:Boolean(gameBlocked.value)})!==gameSnapshot;}

async function mergeGames(){if(!mergeForm.from||!mergeForm.to)return ElMessage.warning('请填写源与目标 AppID');const fromAppid=Number(mergeForm.from),toAppid=Number(mergeForm.to);if(!Number.isFinite(fromAppid)||!Number.isFinite(toAppid))return ElMessage.warning('AppID 必须是数字');await run(async()=>{const d=await api('/api/admin/games/merge',json('POST',{fromAppid,toAppid}));const r=d.result||{};if(!r.merged)throw new Error({source_missing:'源游戏不存在',target_missing:'目标游戏不存在'}[r.reason]||'合并失败');mergeDialog.value=false;mergeForm.from='';mergeForm.to='';ElMessage.success(`合并完成：迁移 ${r.moved??0} 条报价，去重丢弃 ${r.dropped??0} 条`);await loadGames(1);});}
// 状态列悬停提示：备注 + 处理时间（docs/BAN-AND-SECURITY-FIXES.md §5.2）

async function loadAnnouncements(){sel.announcements.clear();loading.value=true;try{const d=await api('/api/admin/announcements?limit=200');announcements.value=d.announcements||[];}catch(e){notifyError(e);}finally{loading.value=false;}}
function levelLabel(level){return ({critical:'重要',warning:'提醒',info:'通知'})[level]||'通知';}
// BE 批（docs/WISHLIST-SITE-ONLY.md §6；CY 批改为只读：用户私有数据，删除入口已移除）
const wishlists=ref([]), wishQuery=ref('');
const wishPager=useListPagination(wishlists);
const pagedWishlists=wishPager.items, wishPage=wishPager.page, wishPageSize=wishPager.pageSize;
async function loadWishlists(){loading.value=true;try{const qs=new URLSearchParams({limit:'200'});if(wishQuery.value.trim())qs.set('q',wishQuery.value.trim());const d=await api(`/api/admin/wishlists?${qs}`);wishlists.value=d.items||[];}catch(e){notifyError(e);}finally{loading.value=false;}}
// CL 批（docs/USER-ALERTS.md §4.3）：全站到价提醒清单——分页 + 用户名筛选 + 删除确认（审计在服务端 api.watch_deleted）；
// CY 批：仅站点级行（user_id 为空）显示删除入口，用户行只读
const adminWatches=ref([]),watchTotal=ref(0),watchQuery=ref(''),watchAdminPage=ref(1),watchStatus=ref('');
// DF 批（docs/ALERT-MANUAL-PUSH.md §2 #5）：已配置的推送渠道名（来自列表接口 notifyChannels），无通道时「推送」按钮禁用
const pushChannels=ref([]),pushRunning=ref(false);
const pushDialog=reactive({visible:false,rows:[],force:false,mark:true});
function channelLabel(kind){const name={email:'邮件',webhook:'Webhook',wecom:'企业微信'}[kind]||kind;return `${name}（${pushChannels.value.includes(kind)?'已配置':'未配置'}）`;}
async function loadAdminWatches(nextPage=1){loading.value=true;try{const qs=new URLSearchParams({page:String(nextPage),pageSize:'20'});if(watchQuery.value.trim())qs.set('username',watchQuery.value.trim());if(watchStatus.value)qs.set('status',watchStatus.value);const d=await api(`/api/admin/watchlist?${qs}`);adminWatches.value=d.items||[];watchTotal.value=Number(d.total)||0;watchAdminPage.value=Number(d.page)||1;pushChannels.value=Array.isArray(d.notifyChannels)?d.notifyChannels:[];}catch(e){notifyError(e);}finally{loading.value=false;}}
async function removeAdminWatch(row){
  try{await ElMessageBox.confirm(`删除「${row.display_name || row.username || '站点级'}」的到价提醒「${row.name||row.steam_appid}」？`,'删除到价提醒',{type:'warning',confirmButtonText:'删除',cancelButtonText:'取消'});}catch{return;}
  try{await api(`/api/admin/watchlist/${row.id}`,{method:'DELETE'});ElMessage.success('已删除');await loadAdminWatches(watchAdminPage.value);}catch(e){notifyError(e);}
}
// CU-2（docs/USER-ALERTS-GOVERNANCE.md §2）：站点级提醒多选 → 按 Steam 愿望单反查候选用户 → 迁移/批量删除
const watchSel=ref(new Set()),migrateRunning=ref(false),bulkWatchDeleteRunning=ref(false);
const migrateDialog=reactive({visible:false,ids:[],rows:[],users:[],targetId:null});
function onWatchSelChange(rows){watchSel.value=new Set((rows||[]).filter(r=>r.user_id==null).map(r=>r.id));}
function claimableUnion(rows){
  const byUser=new Map();
  for(const w of rows)for(const u of (w.claimableUsers||[]))if(!byUser.has(u.userId))byUser.set(u.userId,{userId:u.userId,username:u.username,display_name:u.display_name,email:u.email});
  return [...byUser.values()];
}
function openWatchMigrate(rows){
  const list=(rows||adminWatches.value.filter(w=>w.user_id==null&&watchSel.value.has(w.id))).filter(w=>w.user_id==null);
  if(!list.length){ElMessage.warning('请选择站点级提醒（用户级只读）');return;}
  const users=claimableUnion(list);
  if(!users.length){ElMessage.warning('所选游戏均无 Steam 愿望单反查候选（无人认领保持站点级）');return;}
  migrateDialog.rows=list;migrateDialog.ids=list.map(w=>w.id);migrateDialog.users=users;migrateDialog.targetId=null;migrateDialog.visible=true;
}
async function submitWatchMigrate(){
  migrateRunning.value=true;
  try{
    const d=await api(`/api/admin/watchlist/migrate`,json('POST',{ids:migrateDialog.ids,userId:migrateDialog.targetId}));
    const target=migrateDialog.users.find(u=>u.userId===d.target?.id);
    const targetLabel=(target&&(target.display_name||target.username))||d.target.username;
    ElMessage.success(`已迁移 ${d.migrated} 条给 ${targetLabel}${d.merged?`，另有 ${d.merged} 条该用户已有提醒（合并）`:''}`);
    migrateDialog.visible=false;watchSel.value=new Set();await loadAdminWatches(watchAdminPage.value);
  }catch(e){notifyError(e);}finally{migrateRunning.value=false;}
}
async function batchDeleteWatches(){
  const list=adminWatches.value.filter(w=>w.user_id==null&&watchSel.value.has(w.id));
  if(!list.length){ElMessage.warning('请选择站点级提醒（用户级只读）');return;}
  try{await ElMessageBox.confirm(`删除已选的 ${list.length} 条站点级到价提醒？`,'批量删除到价提醒',{type:'warning',confirmButtonText:'删除',cancelButtonText:'取消'});}catch{return;}
  bulkWatchDeleteRunning.value=true;
  try{
    await api(`/api/admin/watchlist/delete`,json('POST',{ids:list.map(w=>w.id)}));
    ElMessage.success(`已删除 ${list.length} 条`);watchSel.value=new Set();await loadAdminWatches(watchAdminPage.value);
  }catch(e){notifyError(e);}finally{bulkWatchDeleteRunning.value=false;}
}
// DF 批（docs/ALERT-MANUAL-PUSH.md §2/§3）：手动推送——单条立即发送；批量合并一封邮件；
// 强制推送（force，默认关）/ 更新最近提醒时间（mark，默认勾选）；无通道按钮已禁用。
function openWatchPush(rows){
  const list=(rows||adminWatches.value.filter(w=>w.user_id==null&&watchSel.value.has(w.id))).filter(w=>w.user_id==null);
  if(!list.length){ElMessage.warning('请选择站点级提醒（用户级只读）');return;}
  pushDialog.rows=list;pushDialog.force=false;pushDialog.mark=true;pushDialog.visible=true;
}
async function submitWatchPush(){
  const rows=pushDialog.rows;const force=pushDialog.force;const mark=pushDialog.mark;
  pushRunning.value=true;
  try{
    if(rows.length===1){
      const d=await api(`/api/admin/watchlist/${rows[0].id}/push`,json('POST',{force,mark}));
      if(d.sent){ElMessage.success(`已推送「${rows[0].name||('appid:'+rows[0].steam_appid)}」`);}
      else if(d.reason==='no_price'){ElMessage.warning('该游戏无在售报价，无法推送');}
      else{ElMessage.warning(`当前未达提醒条件（当前 ${price(d.currentCents)} / 目标 ${d.targetCents==null?'史低':price(d.targetCents)}），不勾选强制推送时不发送`);}
    }else{
      const d=await api('/api/admin/watchlist/push',json('POST',{ids:rows.map(r=>r.id),force,mark}));
      const sentN=(d.results||[]).filter(r=>r.sent).length;
      if(sentN){ElMessage.success(`已推送 ${sentN}/${d.results.length} 条（合并为 1 封邮件）`);}
      else{ElMessage.warning('未发送：所选提醒均未达条件（可勾选强制推送）');}
    }
    pushDialog.visible=false;watchSel.value=new Set();await loadAdminWatches(watchAdminPage.value);
  }catch(e){notifyError(e);}finally{pushRunning.value=false;}
}
// AT 批（docs/ADMIN-CONSOLE-IA.md §7.3）：弹窗状态与 URL 双向同步——
// ?section=announcements&drawer=new[&id=…] 可直达；关闭去掉 drawer/id，保留其它参数。
// 带 id 直达时等列表加载完再定位行（列表未就绪会闪一帧空表单）。
let pendingEditId=null;
async function resolveAnnouncementDrawer(){
  const id=pendingEditId;
  pendingEditId=null;
  if(id!=null&&!announcements.value.length)await loadAnnouncements();
  announcementDrawer.edit=(id!=null?announcements.value.find((a)=>Number(a.id)===id):null)||null;
  announcementDrawer.visible=true;
}
function openAnnouncementDrawer(row){
  pendingEditId=row?Number(row.id):null;
  const q={...route.query,drawer:'new'};
  if(row)q.id=String(row.id);else delete q.id;
  router.replace({path:'/console',query:q}).catch(()=>{});
  resolveAnnouncementDrawer();
}
function closeAnnouncementDrawerUrl(){
  if(route.query.drawer){const q={...route.query};delete q.drawer;delete q.id;router.replace({path:'/console',query:q}).catch(()=>{});}
}
watch(()=>route.query.drawer,(d)=>{
  if(props.section!=='announcements')return;
  if(String(d??'')==='new'){
    pendingEditId=Number(route.query.id)||null;
    resolveAnnouncementDrawer();
  }else{
    announcementDrawer.visible=false;
  }
});
async function removeAnnouncement(id){try{await ElMessageBox.confirm('删除后无法恢复，确定继续？','删除通知',{type:'warning'});await api(`/api/admin/announcements/${id}`,{method:'DELETE'});ElMessage.success('已删除');await loadAnnouncements();}catch(e){if(e!=='cancel'&&e!=='close')notifyError(e);}}

// ── FY-1（docs/SETTINGS-REDESIGN.md §2/§3.1/§3.2）：设置页 7 组对象组左导航 + `/console/settings/:group` 二级路由 ──
// 组标题/图标/描述以服务端 GROUPS（随 schema 下发）为准；前端只维护 id 白名单与默认组（utils/settings.js）。
// 当前组唯一事实源是 URL（route.params.group）——点左导航 push 新 URL，浏览器后退即可回上一组。
const settingsGroups=computed(()=>{const list=settingsSchema.value?.groups||[];return SETTINGS_GROUP_IDS.map((id)=>list.find((g)=>g.id===id)).filter(Boolean);});
const activeSettingsGroup=computed(()=>{const id=String(route.params.group??'');return isSettingsGroupId(id)?id:DEFAULT_SETTINGS_GROUP;});
const activeSettingsGroupItem=computed(()=>settingsGroups.value.find((g)=>g.id===activeSettingsGroup.value)||null);
// 左导航项数徽标：本组可见项（与旧 tab 徽标同口径：不含「邮件服务」页维护的 8 项）
function groupItemCount(id){return (settingsSchema.value?.fields||[]).filter((f)=>f.group===id&&!isMailSettingKey(f.key)).length;}
// 换组：push 换 URL（可后退）；FY-2 改即时保存后换组不再有草稿，故放过未保存守卫的离开询问
function goSettingsGroup(id,{replace=false}={}){if(!id||id===activeSettingsGroup.value)return;bypassNextGuard();const path=`/console/settings/${id}`;const nav=replace?router.replace(path):router.push(path);nav.catch(()=>{});}
function settingId(key){return `setting-${String(key).replace(/[^a-zA-Z0-9_-]/g,'-')}`;}

// ── FY-2（§3.4 搜索与过滤）：搜索常驻当前组顶部、跨 7 组匹配；「只看非默认」沿用 localStorage 记忆 ──
const settingsOnlyChanged=ref(false);try{settingsOnlyChanged.value=localStorage.getItem('settings-only-changed')==='1';}catch{}
watch(settingsOnlyChanged,(v)=>{try{localStorage.setItem('settings-only-changed',v?'1':'0');}catch{}});
function isPlainGroup(gid){return Boolean(settingsSchema.value?.plainGroups?.includes(gid));}
function onlyChangedFilter(f){if(!settingsOnlyChanged.value)return true;return !(settingsSchema.value?.isDefault?.[f.key]??true);}
const highlightKey=ref('');let highlightTimer=null;
function groupTitle(id){return settingsGroups.value.find((g)=>g.id===id)?.title||id;}
function sectionTitleOf(field){const id=field?.section;if(!id)return '';return (settingsSchema.value?.sections||[]).find((s)=>s.id===id)?.title||'';}
// 跨 7 组命中（label / key / help），面板最多列 30 条；点一条跳组 + 高亮该行
const settingSearchHits=computed(()=>{const q=settingQuery.value.trim().toLocaleLowerCase();if(!q)return [];return (settingsSchema.value?.fields||[]).filter((f)=>!isMailSettingKey(f.key)&&`${f.label} ${f.key} ${f.help||''}`.toLocaleLowerCase().includes(q)).slice(0,30);});
// 分区字段顺序 = 服务端 keys（显式卡）或 SETTINGS 定义顺序（按 section 归卡）；一行一项（不再按 compact 合并成多列行）
function sectionFields(sec){const all=settingsSchema.value?.fields||[];if(Array.isArray(sec.keys)){const byKey=new Map(all.map((f)=>[f.key,f]));return sec.keys.map((k)=>byKey.get(k)).filter(Boolean);}return all.filter((f)=>f.section===sec.id);}
// 分区头「启用状态徽标」绑定的开关：与分区同名平台的 enabled（杉果=sonkwo.enabled）；GOG/Humble 有两个开关故不挂徽标
function sectionEnabledKey(sec,fields){const named=fields.find((f)=>f.key===`sources.${sec.id}.enabled`);if(named)return named.key;const bools=fields.filter((f)=>f.type==='bool'&&String(f.key).endsWith('.enabled'));return bools.length===1?bools[0].key:null;}
// 右侧可见分区：分区标题（名称 + 项数 + 启用状态徽标）+ 一行一项。
// 平铺组（alerts/access/network）没有分区定义 → 单段且不重复打标题（组标题已在页头）。
const visibleSections=computed(()=>{const schema=settingsSchema.value;if(!schema)return [];const gid=activeSettingsGroup.value;const q=settingQuery.value.trim().toLocaleLowerCase();
  // 高亮行不受搜索/只看非默认过滤影响，否则跳过去看不到目标项
  const match=(f)=>(!q||`${f.label} ${f.key} ${f.help||''}`.toLocaleLowerCase().includes(q))&&(onlyChangedFilter(f)||f.key===highlightKey.value);
  const mine=(schema.fields||[]).filter((f)=>f.group===gid&&!isMailSettingKey(f.key));
  if(isPlainGroup(gid)){const fields=mine.filter(match);return fields.length?[{id:gid,title:activeSettingsGroupItem.value?.title||gid,plain:true,fields,enabledKey:null}]:[];}
  const out=[];
  for(const sec of (schema.sections||[]).filter((s)=>s.group===gid)){
    const ordered=sectionFields(sec);
    const enabledKey=sectionEnabledKey(sec,ordered);
    const fields=ordered.filter(match).map((f)=>(enabledKey&&f.key===enabledKey&&f.type==='bool'?{...f,label:'启用'}:f));
    if(!fields.length)continue;
    out.push({id:sec.id,title:sec.title,plain:false,fields,enabledKey});
  }
  return out;});
// 点命中结果：跳组 + 高亮该行 + 滚到可视区
async function jumpToSetting(hit){
  highlightKey.value=hit.key;
  if(hit.group!==activeSettingsGroup.value)goSettingsGroup(hit.group);
  await nextTick();
  document.getElementById(settingId(hit.key))?.scrollIntoView({block:'center',behavior:'smooth'});
  if(highlightTimer)clearTimeout(highlightTimer);
  highlightTimer=setTimeout(()=>{highlightKey.value='';},4000);
}

// ── FY-2（§3.3 即时保存）：改动入合并队列 → 行内「保存中…」→「✓ 已保存」（2 秒淡出）；失败回滚上次值 + 红字原因 ──
// 合并规则见 utils/settingsSave.js 头注释（静默 700ms / 上限 1.5s → 单改 1 秒内出 ✓、1.5 秒内连改只发 1 次 POST）。
const rowStatus=reactive({});   // key -> { kind: saving|saved|error, message }
const savedValues={};           // key -> 上次成功保存的值（回滚目标）
const lastAttempt={};           // key -> 最近一次尝试提交的值（失败后「保存并离开」重试用）
const saveError=ref('');        // 最近一次提交失败原因
const settingsConflict=ref(false); // 有保存失败 = 仍存在「未保存」态（其余情况即时保存已完成，离开不拦）
const settingsSaver=createSettingsSaver({
  save:(values)=>api('/api/admin/settings',json('POST',{values})),
  // 行内状态 + 失败联动未保存守卫：只有「提交失败」才重新变成「未保存」态（§3.3 语义调整）
  onState:(key,kind,message)=>{if(kind==='idle'||kind==='saved')delete lastAttempt[key];if(kind==='idle')delete rowStatus[key];else rowStatus[key]={kind,message};if(kind==='error'){settingsConflict.value=true;saveError.value=message||'保存失败';}},
  onRollback:(key,previous)=>{settingValues[key]=previous??defaultValueOf(key);},
  onSaved:(view,values)=>{applySavedView(view,values);settingsConflict.value=false;saveError.value='';},
});
function defaultValueOf(key){return (settingsSchema.value?.fields||[]).find((f)=>f.key===key)?.default??'';}
function isSecretKey(key){return Boolean(settingsSchema.value?.secrets&&Object.prototype.hasOwnProperty.call(settingsSchema.value.secrets,key));}
// 只同步本批提交的 key：避免整份 schema 回写覆盖掉别的行正在输入的内容。
// 密钥值（明文）绝不落进 settingValues/savedValues——密钥的展示与保存都在 SecretField 内部（FX 决策 5）。
function applySavedView(view,values){
  if(!view)return;
  const schema=settingsSchema.value;
  for(const key of Object.keys(values||{})){
    if(!isSecretKey(key)&&view.values&&Object.prototype.hasOwnProperty.call(view.values,key)){savedValues[key]=view.values[key];settingValues[key]=view.values[key];}
    if(schema?.sources&&view.sources?.[key]!=null)schema.sources[key]=view.sources[key];
    if(schema?.isDefault&&key in (view.isDefault||{}))schema.isDefault[key]=view.isDefault[key];
    if(schema?.secrets&&view.secrets?.[key])schema.secrets[key]=view.secrets[key];
  }
  if(schema&&view.revision!=null)schema.revision=view.revision;
  if(schema&&view.version)schema.version=view.version;
}
// int：空输入框 = 放弃本次输入（不提交，避免误报 400）；非法数字原样提交，让服务端 400 → 回滚 + 红字
function typedValue(field,raw){
  if(field.type!=='int')return raw;
  const s=String(raw??'').trim();
  if(s==='')return undefined;
  const n=Number(s);
  return Number.isFinite(n)?n:s;
}
function commitSetting(field,value){settingValues[field.key]=value;lastAttempt[field.key]=value;settingsSaver.set(field.key,value,()=>savedValues[field.key]);}
function inputSetting(field,raw){
  settingValues[field.key]=raw; // 输入中的草稿只留在页面，600ms 后才入库
  const v=typedValue(field,raw);
  if(v===undefined){settingsSaver.cancelInput(field.key);return;}
  lastAttempt[field.key]=v;
  settingsSaver.input(field.key,v,()=>savedValues[field.key]);
}
function commitSettingNow(field,raw){
  const v=typedValue(field,raw);
  if(v===undefined){settingValues[field.key]=savedValues[field.key]??defaultValueOf(field.key);settingsSaver.cancelInput(field.key);return;}
  settingValues[field.key]=v;
  lastAttempt[field.key]=v;
  settingsSaver.commitNow(field.key,v,()=>savedValues[field.key]).catch((e)=>{saveError.value=e?.message||String(e);settingsConflict.value=true;});
}
// 页面离开（路由卸载 / 切到别的模块 / 标签隐藏）时若有未发出的改动，强制 flush 一次（§3.3：即时保存后不再有「未保存」态）；
// 未保存守卫的「保存并离开」也走这里：先把待发改动发出去，再把上次失败的值重试一次，仍失败则抛错留在本页。
async function flushSettings(){
  const fail=(e)=>{saveError.value=e?.message||String(e);settingsConflict.value=true;};
  try{await settingsSaver.flushAll();}catch(e){fail(e);}
  const retry=Object.entries(lastAttempt);
  if(retry.length){
    for(const [key,value] of retry)settingsSaver.set(key,value,()=>savedValues[key]);
    try{await settingsSaver.flush();}catch(e){fail(e);}
  }
  if(settingsSaver.hasErrors())throw new Error(saveError.value||'保存失败');
  return null;
}
function onSettingsPageHide(){void flushSettings().catch(() => {});}
// Console 里系统设置与其它 native 模块共用 AdminModules 实例（只换 section prop，不卸载）→ 切走时也要 flush
watch(()=>props.section,(next,prev)=>{if(prev==='settings'&&next!=='settings')void flushSettings().catch(() => {});});
async function loadSettings(){loading.value=true;try{const d=await api('/api/admin/settings');settingsSchema.value=d;for(const key of Object.keys(settingValues))delete settingValues[key];for(const field of d.fields||[]){settingValues[field.key]=field.type==='secret'?'':d.values?.[field.key]??field.default??(field.type==='bool'?false:'');savedValues[field.key]=settingValues[field.key];}settingsConflict.value=false;saveError.value='';}catch(e){notifyError(e);}finally{loading.value=false;}}
// 放弃修改（保存失败后离开时用）：重置代理编辑态并重拉设置，错误态一起清
function discardSettings(){proxyDialogDirty.value=false;proxyList.value=[];settingsConflict.value=false;saveError.value='';void loadSettings();}
// SecretField 自行保存/清除后回传最新设置视图：只同步该 key 的 schema/值，不清掉页面其它输入
function onSecretSaved(d,key){if(d?.fields)applySavedView(d,{[key]:''});if(key==='network.steamProxy')proxySavedCount.value=null;}
// AM-2（docs/PROXY-POOL.md §5）：Steam 代理池列表编辑器 + 健康状态表。
// 保存：非空行按顺序 join('\n') 提交 network.steamProxy，清空传 null；前端先做 http/https 与 ≤10 校验，服务端兜底。
// 健康表：状态 正常/冷却中(倒计时)/未知；「刷新」+ 网络分组展开且页面可见时每 10 秒自动刷新；保存后立即刷新一次。
const proxyList=ref([]),proxyDialogOpen=ref(false),proxyRevealLoading=ref(false),proxyDialogDirty=ref(false),proxySaving=ref(false),proxySavedCount=ref(null),proxyHealth=ref({proxies:[],lastGood:null,updatedAt:null}),proxyProbing=ref(false),healthNow=ref(Date.now());
let proxyTimer=null,proxyTick=0;
// EL 批（docs/ADMIN-EDIT-DIALOG.md EK-4）：代理列表编辑器搬进弹窗——打开拉取明文、草稿独立脏标记、保存即时提交回写
function markProxyDirty(){proxyDialogDirty.value=true;}
async function openProxyDialog(){proxyDialogOpen.value=true;proxyRevealLoading.value=true;try{const d=await api('/api/admin/settings/value?key=network.steamProxy');proxyList.value=String(d.value??'').split(/\r?\n/).filter(Boolean).map(v=>({value:v}));proxySavedCount.value=proxyList.value.length;}catch(e){notifyError(e);}finally{proxyRevealLoading.value=false;}proxyDialogDirty.value=false;}
function addProxy(){if(proxyList.value.length>=10){ElMessage.warning('Steam 代理池最多 10 条');return;}proxyList.value.push({value:''});markProxyDirty();}
function removeProxy(i){proxyList.value.splice(i,1);markProxyDirty();}
function moveProxy(i,dir){const j=i+dir;if(j<0||j>=proxyList.value.length)return;const arr=proxyList.value;[arr[i],arr[j]]=[arr[j],arr[i]];markProxyDirty();}
function clearProxyList(){proxyList.value=[];markProxyDirty();}
// 保存校验与提交（抛错版：校验/接口失败不关弹窗、守卫路径失败留在本页）
async function saveProxyDialog(){
  const lines=proxyList.value.map(r=>String(r.value??'').trim()).filter(Boolean);
  for(let i=0;i<lines.length;i+=1){if(!/^https?:\/\//i.test(lines[i]))throw new Error(`第 ${i+1} 行不是合法的 http/https 代理`);}
  if(lines.length>10)throw new Error('Steam 代理池最多 10 条');
  proxySaving.value=true;
  try{
    const d=await api('/api/admin/settings',json('POST',{values:{'network.steamProxy':lines.length?lines.join('\n'):null}}));
    applySavedView(d,{'network.steamProxy':lines.length?lines.join('\n'):null});
    proxyDialogDirty.value=false;proxySavedCount.value=lines.length;proxyDialogOpen.value=false;
    ElMessage.success('Steam 专用代理已保存（约 15 秒内生效）');loadProxyHealth();
  }finally{proxySaving.value=false;}
}
function onSaveProxyDialog(){saveProxyDialog().catch((e)=>notifyError(e));}
async function closeProxyDialog(done){if(proxyDialogDirty.value){try{await ElMessageBox.confirm('Steam 代理列表有未保存的修改，关闭后将丢失。','放弃修改',{type:'warning',confirmButtonText:'放弃修改',cancelButtonText:'留在弹窗'});}catch{return;}}proxyDialogDirty.value=false;done?.();}
function cancelProxyDialog(){void closeProxyDialog(()=>{proxyDialogOpen.value=false;});}
function proxyStateType(row){if(row.state==='cooldown')return 'warning';if(row.state==='ok'||row.probeOk===true)return 'success';if(row.probeOk===false)return 'danger';return 'info';}
function proxyStateText(row){if(row.state==='cooldown'){const left=Math.max(0,(Date.parse(row.downUntil||'')-healthNow.value)/1000);return '冷却中 '+String(Math.floor(left/60)).padStart(2,'0')+':'+String(Math.floor(left%60)).padStart(2,'0');}if(row.state==='ok')return '正常';if(row.probeOk===true)return '正常（探测）';if(row.probeOk===false)return '探测失败';return '未检测';}
async function loadProxyHealth(){try{const d=await api('/api/admin/proxies');proxyHealth.value=d;}catch{/* 健康接口失败不影响设置页其它功能 */}}
// BB 批（docs/PROXY-POOL.md §11.5）：立即检测——服务端逐条 CONNECT 探测，返回脱敏结果
async function probeProxies(){proxyProbing.value=true;try{const d=await api('/api/admin/proxies/probe',json('POST',{}));proxyHealth.value=d;ElMessage.success('已检测 '+(d.probed||0)+' 条，可用 '+(d.ok||0)+' 条');}catch(e){ElMessage.error(e.message);}finally{proxyProbing.value=false;}}
function startProxyTimer(){if(proxyTimer)return;proxyTimer=setInterval(()=>{proxyTick+=1;healthNow.value=Date.now();const active=props.section==='settings'&&!document.hidden&&activeSettingsGroup.value==='network';if(active&&proxyTick%10===0)loadProxyHealth();},1000);}
// 「恢复默认」：删库覆盖行后值/来源回落 env→默认（二次确认；先 flush 待发改动，避免被整份视图回写覆盖）
async function restoreField(field){
  try{await ElMessageBox.confirm(`把「${field.label}」恢复为默认值（${field.default??''}）？来源将回落为环境变量或默认。`,'恢复默认',{type:'warning',confirmButtonText:'确认恢复',cancelButtonText:'取消'});}catch{return;}
  await settingsAction.run(async()=>{await flushSettings();const d=await api('/api/admin/settings/restore',json('POST',{keys:[field.key]}));applySettingsSchema(d);},{success:'已恢复默认'});
}
// 恢复默认后整份视图回写（值/来源/修订号一起刷新）
function applySettingsSchema(d){settingsSchema.value=d;for(const f of d.fields||[]){if(f.type==='secret')settingValues[f.key]='';else settingValues[f.key]=d.values?.[f.key]??f.default??'';savedValues[f.key]=settingValues[f.key];}settingsConflict.value=false;saveError.value='';}
// 翻页清空选择（决策：常规列表只支持本页勾选）。这些表是客户端分页，翻页不会走 load 函数，
// 所以单独 watch 页码；游戏目录 / 访问明细是服务端分页，已在 load 里清空。
watch(announcementsPage,()=>sel.announcements.clear());

const priceMetrics=computed(()=>[{label:'降价',value:priceReport.value.drops||0,tone:'metric-red'},{label:'涨价',value:priceReport.value.rises||0,tone:''},{label:'新史低',value:priceReport.value.newLows||0,tone:'metric-green'},{label:'价格变化',value:priceReport.value.changed||0,tone:''}]);
const priceChanges=computed(()=>[...(priceReport.value.topDrops||[]),...(priceReport.value.topRises||[])]);
const viewRows=computed(()=>{const rows=views.value.slice();if(!aggregateViews.value)return rows;const map=new Map();for(const v of rows){const key=v.name||v.path;const current=map.get(key)||{name:v.name,path:'多个页面',views:0,last_at:v.last_at};current.views+=v.views;if(v.last_at>current.last_at)current.last_at=v.last_at;map.set(key,current);}return [...map.values()].sort((a,b)=>b.views-a.views);});
const imageMb=computed(()=>((imageStats.value.bytes||0)/1024/1024).toFixed(1));
// BC 批（docs/IMAGE-COVERAGE.md §3.3）：清除缺图负缓存，前台下一次请求会重新取图
async function resetImageMiss(){
  try{
    await ElMessageBox.confirm('清空后前台会重新尝试取图（已缓存的图片不受影响）。','清除缺图缓存',{type:'warning',confirmButtonText:'清除',cancelButtonText:'取消'});
  }catch{ return; }
  await imageResetAction.run(async()=>{
    const d=await api('/api/admin/images/reset-miss',json('POST',{}));
    return d;
  },{success:(d)=>'已清除 '+(d?.cleared||0)+' 条缺图记录'});
}
async function loadStats(){loading.value=true;try{const [r,v,i,b]=await Promise.all([api('/api/admin/reports/price?hours=24&limit=100&days=7'),api('/api/admin/views?limit=500'),api('/api/admin/images'),api('/api/admin/backups')]);priceReport.value=r.report||{};priceSeries.value=r.series||{};views.value=v.views||[];imageStats.value=i.images||{};backups.value=b.backups||[];backupEnabled.value=b.backupEnabled!==false;}catch(e){notifyError(e);}finally{loading.value=false;}}
// EC 批（docs/IMAGE-COVERAGE.md §8 EC-1）：图片覆盖看板——数字与缺图列表（分页 + 原因）
async function loadCoverage(){try{const qs=new URLSearchParams({page:String(coveragePage.value),pageSize:String(coveragePageSize.value)});coverage.value=await api(`/api/admin/images/coverage?${qs}`);}catch(e){notifyError(e);}}
// EC 批（docs/IMAGE-COVERAGE.md §8 EC-2）：手动触发缺图回填（服务器后台跑，限速防 429）
async function runImagesBackfill(){try{await ElMessageBox.confirm('扫描 header_image 为空的游戏并逐款重同步元数据补封面（限速防 429，可随时到「同步与回填」看进度）。','重同步缺图',{type:'warning',confirmButtonText:'开始回填',cancelButtonText:'取消'});}catch{return;}backfillRunning.value=true;try{const d=await api('/api/admin/images/backfill',json('POST',{}));ElMessage.success(`缺图回填已提交（runId ${d.runId}），完成后刷新本页可见缺图数下降`);setTimeout(()=>{loadCoverage();backfillRunning.value=false;},3000);}catch(e){backfillRunning.value=false;ElMessage.error(e.message||'提交失败');}}
// FR 批（docs/BACKUP-AS-FEATURE.md §2）：立即备份——二次确认 + loading + 成功提示（文件名）+
// 失败提示；开关 false 时按钮已禁用（模板），后端仍会 403 双保险。
async function createBackupNow(){
  try{await ElMessageBox.confirm('将立即生成一份全库压缩备份（大库可能需要数分钟）。备份仅手动触发，不会自动执行。','立即备份',{type:'warning',confirmButtonText:'开始备份',cancelButtonText:'取消'});}catch{return;}
  await backupAction.run(async()=>{
    const d=await api('/api/admin/backup',json('POST',{}));
    backups.value=d.backups||backups.value;
    backupEnabled.value=d.backupEnabled!==false;
    return d;
  },{success:(d)=>`备份完成：${String(d?.result?.file||'').split('/').pop()||'已生成新文件'}（${d?.result?.rows??0} 行）`});
}
// FR 批：单备份下载（GET /api/admin/backups/:name 流式下载，同源带会话 cookie）。
function downloadBackup(b){const a=document.createElement('a');a.href=`/api/admin/backups/${encodeURIComponent(b.name)}`;a.download=b.name;document.body.appendChild(a);a.click();a.remove();}
// FR 批：单备份删除——二次确认 + loading + 成功提示，删除后刷新列表。
async function removeBackup(b){
  try{await ElMessageBox.confirm(`删除备份 ${b.name}？删除后无法恢复。`,'删除备份',{type:'warning',confirmButtonText:'删除',cancelButtonText:'取消'});}catch{return;}
  await backupDeleteAction.run(async()=>{
    const d=await api(`/api/admin/backups/${encodeURIComponent(b.name)}`,{method:'DELETE'});
    backups.value=d.backups||[];
  },{success:'备份已删除'});
}


watch(()=>props.section,(section)=>{if(section==='games')loadGames(1);else if(section==='announcements'){loadAnnouncements();if(route.query.drawer==='new'){pendingEditId=Number(route.query.id)||null;resolveAnnouncementDrawer();}}else if(section==='wishlist')loadWishlists();else if(section==='watchlist')loadAdminWatches(1);else if(section==='settings')loadSettings();else if(section==='stats'){loadStats();loadCoverage();}});
// AN 批（docs/UNSAVED-GUARD.md §4.4）：本组件注册三个编辑面——系统设置 / 站点通知 / 编辑游戏
const unregisterUnsaved=[];
onMounted(()=>{if(props.section==='games')loadGames(1);else if(props.section==='announcements'){loadAnnouncements();if(route.query.drawer==='new'){pendingEditId=Number(route.query.id)||null;resolveAnnouncementDrawer();}}else if(props.section==='wishlist')loadWishlists();else if(props.section==='settings'){if(route.query.q)settingQuery.value=String(route.query.q);loadSettings();loadProxyHealth();window.addEventListener('pagehide',onSettingsPageHide);}else if(props.section==='stats'){loadStats();loadCoverage();}startProxyTimer();unregisterUnsaved.push(registerUnsavedSource({id:'settings',label:'系统设置',isDirty:()=>settingsConflict.value,save:flushSettings,discard:discardSettings}),registerUnsavedSource({id:'settings-proxy',label:'Steam 专用代理',isDirty:()=>proxyDialogDirty.value,save:saveProxyDialog,discard:()=>{proxyDialogDirty.value=false;proxyDialogOpen.value=false;}}),registerUnsavedSource({id:'edit-game',label:'编辑游戏',isDirty:gameDirty,save:submitGameSave,discard:closeGameDialog}));if(mobileQuery){if(mobileQuery.addEventListener)mobileQuery.addEventListener('change',onMobileChange);else mobileQuery.addListener(onMobileChange);}});
onBeforeUnmount(()=>{if(props.section==='settings'){void flushSettings().catch(() => {});window.removeEventListener('pagehide',onSettingsPageHide);}settingsSaver.dispose();if(proxyTimer){clearInterval(proxyTimer);proxyTimer=null;}unregisterUnsaved.forEach((fn)=>fn());if(mobileQuery){if(mobileQuery.removeEventListener)mobileQuery.removeEventListener('change',onMobileChange);else mobileQuery.removeListener(onMobileChange);}});
if(mobileQuery){if(mobileQuery.addEventListener)mobileQuery.addEventListener('change',onMobileChange);else mobileQuery.addListener(onMobileChange);}
</script>

<style scoped>
.module-wrap{display:flex;flex-direction:column;gap:var(--space-14);min-width:0;padding-bottom:var(--space-24)}.module-card{background:var(--panel);border:1px solid var(--border);border-radius:var(--radius-13);padding:var(--space-16);box-shadow:0 3px 14px #26345a06;min-width:0}.module-tabs{display:flex;gap:5px;border-bottom:var(--space-1) solid var(--border);padding:0 var(--space-2) var(--space-10)}.module-tabs button{border:0;background:transparent;border-radius:var(--radius-8);padding:var(--space-8) 13px;color:var(--fg-muted);font-size:var(--font-12);cursor:pointer}.module-tabs button.on{background:var(--brand-soft);color:var(--brand);font-weight:650}.filterbar{display:flex;gap:9px;align-items:center;flex-wrap:wrap}.filterbar>.el-input{flex:1 1 230px;max-width:360px}.filterbar>.el-select{width:155px}.metric-grid{display:grid;grid-template-columns:repeat(5,minmax(110px,1fr));gap:var(--space-10)}.metric-card{background:var(--panel);border:1px solid var(--border);border-radius:var(--radius-12);padding:13px 15px;display:flex;flex-direction:column;gap:9px}.clickable-grid .metric-card{cursor:pointer;transition:border-color .15s,background .15s}.clickable-grid .metric-card:hover{border-color:var(--brand)}.clickable-grid .metric-card.on{border-color:var(--brand);background:var(--brand-soft)}.clickable-grid .metric-card.on>strong{color:var(--brand)}.more-metrics{margin:var(--space-10) 0 0}.more-metrics summary{cursor:pointer;display:inline-flex;align-items:center;gap:var(--space-6);padding:var(--space-6) 11px;border:1px solid var(--border);border-radius:var(--radius-9);font-size:var(--font-12);color:var(--fg-muted);background:var(--panel);user-select:none}.more-metrics summary:hover{color:var(--brand);border-color:var(--brand)}.metric-chips{display:flex;flex-wrap:wrap;gap:7px;padding-top:var(--space-10)}.metric-chip{display:inline-flex;align-items:center;gap:var(--space-6);border:1px solid var(--border);background:var(--panel);color:var(--fg-muted);border-radius:var(--radius-pill);padding:var(--space-4) 11px;font-size:var(--font-11);cursor:pointer}.metric-chip strong{color:var(--fg);font-size:var(--font-12)}.metric-chip:hover{border-color:var(--brand);color:var(--brand)}.metric-chip.on{border-color:var(--brand);background:var(--brand-soft);color:var(--brand)}.metric-chip.plain,.price-change-cell{cursor:default}.metric-chip.plain:hover{border-color:var(--border);color:var(--fg-muted)}.metric-card>span{font-size:var(--font-11);color:var(--fg-muted)}.metric-card>strong{font-size:23px;letter-spacing:-.04em;color:var(--fg)}.metric-red strong,.price-down{color:var(--danger)!important}.metric-green strong,.price-up{color:var(--success)!important}.table-card{padding:0;overflow:hidden}.game-admin{display:flex;align-items:center;gap:var(--space-10);min-width:0}.game-admin img{width:70px;height:33px;object-fit:cover;border-radius:5px;background:var(--border);flex:none}.game-admin>div,.inline-form .el-input{min-width:0}.game-admin strong,.game-admin small,.module-wrap td small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.game-admin strong,.proxy-health-head strong{font-size:var(--font-12)}.game-admin small,.module-wrap td small{font-size:var(--font-10);color:var(--fg-muted);margin-top:3px}.tag-gap{margin:var(--space-2)}.pager{display:flex;justify-content:space-between;align-items:center;gap:var(--space-12);padding:var(--space-12) 15px;color:var(--fg-muted);font-size:var(--font-11)}.notice-card{border:1px solid var(--brand-soft);border-radius:var(--radius-12);background:var(--brand-soft);padding:var(--space-16) var(--space-18);color:var(--fg-2);font-size:var(--font-12)}.notice-card p{margin:var(--space-6) 0 0;color:var(--fg-muted);line-height:1.6}.task-actions .el-input-number{width:118px}.eyebrow-small,.cache-stats span{font-size:var(--font-10);color:var(--fg-muted)}.visitor-tabs{display:flex}.security-grid,.stats-columns{display:grid;grid-template-columns:1fr 1fr;gap:var(--space-12)}.security-grid>.module-card{padding:var(--space-14)}.card-heading{display:flex;align-items:center;justify-content:space-between;gap:var(--space-12);margin-bottom:13px}.card-heading h3,.announcement-copy h3{font-size:var(--font-14);margin:0;color:var(--fg)}.card-heading p,.report-heading p{font-size:var(--font-11);color:var(--fg-muted);margin:var(--space-4) 0 0}.inline-form{display:flex;gap:7px;margin-bottom:var(--space-12)}.security-events{margin-top:var(--space-1)}.announcement-list{display:grid;gap:var(--space-10)}.announcement-item{display:flex;align-items:flex-start;gap:var(--space-14)}.announcement-badge{flex:none;border-radius:var(--radius-8);padding:5px var(--space-8);font-size:var(--font-10);color:var(--brand);background:var(--brand-soft)}.announcement-badge.warning{color:var(--warn);background:var(--warn-bg)}.announcement-badge.critical{color:var(--danger);background:var(--danger-bg)}.announcement-copy{flex:1;min-width:0}.announcement-copy .card-heading{justify-content:flex-start;margin:0}.announcement-copy p{font-size:var(--font-12);color:var(--fg-muted);line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere}.announcement-copy small{color:var(--fg-muted);font-size:var(--font-10)}.item-actions{display:flex;gap:3px}.settings-toolbar{display:flex;align-items:center;gap:var(--space-8);position:sticky;top:0;z-index:var(--z-nav);background:var(--bg-2);padding:var(--space-4) 0 var(--space-8)}.settings-toolbar .el-input{max-width:420px;flex:1}.dirty-dot{margin-left:var(--space-8);color:var(--warn)}.report-heading{display:flex;align-items:center;gap:var(--space-8)}.report-heading>div{flex:1}.report-heading h2{font-size:var(--font-15);color:var(--fg);margin:0}.card-heading.padded{padding:var(--space-14) 15px 0}.cache-card{padding:17px}.cache-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--space-10);margin:var(--space-18) 0 11px}.cache-stats>div{display:grid;gap:var(--space-4)}.cache-stats strong{font-size:var(--font-21);color:var(--brand)}.backup-box{margin-top:var(--space-20);padding-top:var(--space-16);border-top:var(--space-1) solid var(--border)}.backup-row{display:flex;align-items:center;gap:var(--space-10);padding:var(--space-8) 0;border-top:var(--space-1) solid var(--panel-2);font-size:var(--font-12);color:var(--fg-muted)}.backup-row .backup-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.backup-row .backup-row-actions{display:flex;gap:var(--space-4);margin-left:auto;flex:none}.mono{font-family:ui-monospace,Consolas,monospace;font-size:var(--font-11)}.muted{color:var(--fg-muted)}
@media(max-width:900px){.metric-grid{grid-template-columns:repeat(3,minmax(100px,1fr))}.security-grid,.stats-columns{grid-template-columns:1fr}.pager{align-items:flex-start;flex-direction:column}.form-row{gap:5px}.announcement-item{flex-wrap:wrap}.item-actions{margin-left:auto}}
@media(max-width:560px){.filterbar>.el-select{flex:1;width:auto}.metric-grid{grid-template-columns:repeat(2,minmax(100px,1fr))}.report-heading{flex-wrap:wrap}.report-heading>div{flex-basis:100%}.inline-form{flex-wrap:wrap}.inline-form .el-input{flex:1 1 100%}.settings-toolbar{flex-wrap:wrap}.settings-toolbar .el-input{flex:1 1 100%;max-width:none}.announcement-item{gap:var(--space-8)}.announcement-copy{flex-basis:calc(100% - 55px)}.item-actions{width:100%;justify-content:flex-end}}
.game-card-list{display:flex;flex-direction:column;gap:var(--space-8)}
.admin-card{border:1px solid var(--border);border-radius:var(--radius-12);padding:var(--space-10) var(--space-12);background:var(--panel)}
.admin-card-main{display:flex;flex-direction:column;gap:var(--space-6)}
.admin-card-main .mono{font-family:ui-monospace,Consolas,monospace;font-size:var(--font-13)}
.admin-card-tags{display:flex;flex-wrap:wrap;gap:var(--space-4)}
.admin-card-path{margin:0;color:var(--fg-muted);font-size:var(--font-12);overflow-wrap:anywhere}
.admin-card-foot{display:flex;justify-content:space-between;align-items:center;gap:var(--space-8);margin-top:var(--space-8);font-size:var(--font-12);color:var(--fg-muted)}
:global(.admin-content){overflow-y:auto}
/* 移动端卡片式列表的勾选（桌面对应表格首列的 selection 列） */
.admin-card-pick{display:flex;align-items:center;min-height:32px}
.announcement-pick{margin-right:var(--space-2);flex:none;align-self:flex-start}
.text-danger{color:var(--danger)}
.bulk-op-keys{display:flex;flex-wrap:wrap;gap:var(--space-4);max-height:180px;overflow:auto}
.proxy-editor{display:flex;flex-direction:column;gap:var(--space-10);width:100%}.proxy-head{display:flex;align-items:center;justify-content:space-between;gap:var(--space-10)}.proxy-count{font-size:var(--font-12);color:var(--fg-muted)}.proxy-row{display:flex;align-items:center;gap:var(--space-6)}.proxy-row>.el-input{flex:1;max-width:430px}.proxy-index{width:22px;text-align:right;font-size:var(--font-12);color:var(--fg-muted);flex:none}.proxy-actions{display:flex;align-items:center;gap:var(--space-14)}.proxy-health{border-top:var(--space-1) solid var(--border);padding-top:var(--space-10);display:flex;flex-direction:column;gap:var(--space-8)}.proxy-health-head{display:flex;align-items:center;justify-content:space-between}
.heading-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.secret-dialog-actions{display:flex;align-items:center;gap:var(--space-10);margin-top:var(--space-10)}
/* AT 批：系统设置折叠改 tab / 价格变化悬停线图 / 站点通知列表化 */
/* FY-1（docs/SETTINGS-REDESIGN.md §3.2）：设置页左导航（236px、7 组对象组）+ 右侧「面包屑 / 组标题+描述 / 工具栏 / 分区列表」。
   横向 7 tab 已下线：当前组高亮带左侧品牌色条，点一下换 URL（/console/settings/<group>），浏览器后退可回上一组。 */
.settings-page{display:flex;gap:22px;align-items:flex-start;width:100%;min-width:0}
.settings-nav{width:236px;flex:none;position:sticky;top:var(--space-12);display:flex;flex-direction:column;gap:2px;background:var(--panel);border:1px solid var(--border);border-radius:var(--radius-12);padding:10px 9px}
.settings-nav-item{display:flex;align-items:center;gap:9px;width:100%;min-height:40px;padding:9px 11px;border:0;border-radius:9px;background:transparent;color:var(--fg-2);font-size:var(--font-13);text-align:left;cursor:pointer}
.settings-nav-item:hover{background:var(--panel-2)}
.settings-nav-item.on{background:var(--brand-soft);color:var(--fg);font-weight:650;box-shadow:inset 3px 0 0 var(--brand)}
.settings-nav-ico{flex:none;font-size:var(--font-14);line-height:1}
.settings-nav-name{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.settings-nav-count{flex:none;font-size:var(--font-10);color:var(--fg-muted);background:var(--panel-2);border-radius:999px;padding:1px 8px}
.settings-nav-item.on .settings-nav-count{color:var(--brand);background:var(--panel)}
.settings-nav-foot{margin-top:var(--space-12);padding:11px 11px 3px;border-top:1px solid var(--border);font-size:var(--font-11);line-height:1.7;color:var(--fg-muted)}
.settings-main{flex:1;min-width:0}
.settings-crumb{font-size:var(--font-11);color:var(--fg-muted);margin:0 0 var(--space-8)}
.settings-crumb span{padding:0 6px;color:var(--fg-subtle)}
.settings-head h2{font-size:var(--font-18);letter-spacing:-.02em;margin:0;color:var(--fg)}
.settings-head p{font-size:var(--font-12);color:var(--fg-muted);margin:5px 0 0}
.settings-nav-mobile{display:none}
.announcement-head .card-heading{margin-bottom:0}
.rule-summary{display:block;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.rule-pop>div{font-size:var(--font-12);line-height:1.8;white-space:nowrap}/* BH 批（docs/VISIT-IP-STATS.md §3.1）：IP 统计展开行 */
.ip-detail h4{margin:var(--space-6) 0 var(--space-4);font-size:var(--font-13);font-weight:600}
.ip-detail .log-line{display:flex;gap:var(--space-12);font-size:var(--font-12);line-height:1.7;align-items:center}
.ip-detail .log-line span:first-child{min-width:150px;color:var(--muted)}
/* FY-2（docs/SETTINGS-REDESIGN.md §3.2/§3.4/§3.5）：右侧「分区标题 + 一行一项」——无卡片盒子、无「高级 N 项」折叠 */
.settings-toolbar{display:flex;align-items:center;gap:var(--space-10);position:sticky;top:0;z-index:var(--z-nav);background:var(--bg-2);padding:var(--space-6) 0 var(--space-8)}
.settings-toolbar .settings-search{max-width:420px;flex:1}
.settings-hits{display:flex;flex-direction:column;gap:var(--space-2);margin:0 0 var(--space-12);padding:var(--space-6);border:1px solid var(--border);border-radius:var(--radius-12);background:var(--panel);max-height:320px;overflow:auto}
.settings-hit{display:flex;align-items:center;justify-content:space-between;gap:var(--space-12);width:100%;min-height:38px;padding:var(--space-6) var(--space-10);border:0;border-radius:var(--radius-8);background:transparent;color:var(--fg);font-size:var(--font-12);text-align:left;cursor:pointer}
.settings-hit:hover,.settings-hit.on{background:var(--brand-soft);color:var(--brand)}
.settings-hit .hit-label{display:inline-flex;align-items:center;gap:var(--space-6);min-width:0;font-weight:600}
.settings-hit .hit-adv{flex:none;font-size:var(--font-10);font-weight:500;color:var(--warn);background:var(--warn-bg);border:1px solid var(--warn-soft);border-radius:var(--radius-6);padding:0 6px}
.settings-hit .hit-meta{flex:none;font-size:var(--font-10);color:var(--fg-muted)}
.settings-hits-empty{margin:0;padding:var(--space-8) var(--space-10);font-size:var(--font-11);color:var(--fg-muted)}
.settings-sections{display:flex;flex-direction:column;gap:var(--space-14);min-width:0}
.settings-section{border-top:1px solid var(--border);padding-top:var(--space-10);min-width:0}
.section-head{display:flex;align-items:center;gap:var(--space-10);margin-bottom:var(--space-2)}
.section-head h3{margin:0;font-size:var(--font-14);font-weight:650;color:var(--fg)}
.section-head .section-n{font-size:var(--font-11);color:var(--fg-muted)}
.section-head .section-st{font-size:var(--font-10);color:var(--success);border:1px solid var(--border);background:var(--panel);border-radius:var(--radius-6);padding:1px 8px}
.section-head .section-st.off{color:var(--fg-muted)}
.proxy-count{font-size:var(--font-11);color:var(--fg-muted)}
/* ≤560px（§3.5）：左导航收成顶部「<组名> · N 项 ▾」下拉（行内两段布局在 SettingsRow.vue） */
@media(max-width:560px){.settings-page{display:block}.settings-nav{display:none}.settings-nav-mobile{display:block;margin-bottom:var(--space-10)}.settings-nav-select{width:100%}.settings-nav-select :deep(.el-select__wrapper){min-height:44px}.settings-toolbar{flex-wrap:wrap}.settings-toolbar .settings-search{flex:1 1 100%;max-width:none}.settings-hit{min-height:44px}}
/* DF 批（docs/ALERT-MANUAL-PUSH.md + design/alert-manual-push-2026-11-18.html）：推送确认弹窗 */
.push-line{display:flex;gap:10px;padding:5px 0;font-size:12.5px;align-items:baseline}.push-line b{width:82px;color:var(--fg-subtle);font-weight:500;flex:none}.push-list{background:var(--panel-2);border:1px solid var(--border);border-radius:9px;padding:6px 10px;margin:6px 0}.push-list>div{display:flex;justify-content:space-between;gap:8px;padding:2px 0;font-size:12.5px}.push-list .push-name{color:var(--fg)}.push-opt{display:flex;align-items:flex-start;gap:8px;margin-top:9px;font-size:12px;color:var(--fg-muted);cursor:pointer}.push-opt b{color:var(--fg);font-weight:600}.push-notice{background:var(--warn-bg);border:1px solid var(--warn-soft);color:var(--warn);border-radius:9px;padding:7px 10px;font-size:11.5px;margin-top:10px}
/* FJ 批（docs/SYNC-JOB-GROUPS.md）：任务组视图——组展开子步骤表 / Steam 账号组认领按钮 / 移动端组卡片 */
/* EP 批：手机端卡片内操作按钮触摸目标 ≥44px（与 BulkBar/个人资料页同一验收口径） */
@media (max-width: 760px) {
  .admin-card .el-button { min-height: 44px; }
}
</style>
