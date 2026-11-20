<template>
  <div class="module-wrap" :class="{ 'm-console': isMobile }">
    <!-- 游戏管理 -->
    <template v-if="section==='games'">
      <div class="module-tabs"><button :class="{on:gameView==='directory'}" @click="gameView='directory'">游戏目录</button><button :class="{on:gameView==='tasks'}" @click="gameView='tasks'">同步与回填</button><button :class="{on:gameView==='align'}" @click="gameView='align'">对齐审核</button></div>
      <template v-if="gameView==='directory'">
        <div class="module-card filterbar"><el-input v-model="gameQuery" clearable placeholder="搜索名称或 AppID" @keyup.enter="loadGames(1)"/><el-select v-model="gamePlatform" placeholder="全部平台" @change="loadGames(1)"><el-option label="全部平台" value=""/><el-option v-for="p in platforms" :key="p.value" :label="p.label" :value="p.value"/></el-select><el-select v-model="gameStatus" placeholder="全部同步状态" @change="gameOffers='';loadGames(1)"><el-option label="全部同步状态" value=""/><el-option label="未探测" value="pending"/><el-option label="已同步" value="synced"/><el-option label="免费" value="free"/><el-option label="未发售" value="coming_soon"/><el-option label="锁国区" value="region_locked"/><el-option label="国区无价" value="no_price"/><el-option label="国区不可售" value="not_found"/><el-option label="其他" value="other"/></el-select><el-select v-model="gameRating" placeholder="全部内容分级" @change="loadGames(1)"><el-option label="全部内容分级" value=""/><el-option label="成人（18+）" value="adult"/><el-option label="成熟" value="mature"/><el-option label="未标注" value="none"/></el-select><el-button :loading="loading" @click="refreshGames">刷新</el-button><el-button @click="mergeDialog=true">高级</el-button></div>
<div class="metric-grid clickable-grid"><div class="metric-card" :class="{on:activeMetric==='all'}" role="button" tabindex="0" @click="clickMetric('all')" @keydown.enter="clickMetric('all')"><span>目录游戏</span><strong>{{ gameStats.total||0 }}</strong></div><div class="metric-card" :class="{on:activeMetric==='synced'}" role="button" tabindex="0" @click="clickMetric('synced')" @keydown.enter="clickMetric('synced')"><span>已同步</span><strong>{{ gameStats.synced||0 }}</strong></div><div class="metric-card" :class="{on:activeMetric==='offers'}" role="button" tabindex="0" @click="clickMetric('offers')" @keydown.enter="clickMetric('offers')"><span>有报价</span><strong>{{ gameStats.withOffers||0 }}</strong></div><div class="metric-card" :class="{on:false}"><span>待回填</span><strong>{{ gameStats.backfillPending||0 }}</strong></div></div><details class="more-metrics"><summary>更多指标（12）&#9662;</summary><div class="metric-chips"><button type="button" class="metric-chip" :class="{on:activeMetric==='pending'}" @click="clickMetric('pending')">未探测 <strong>{{ gameStats.pendingProbe||0 }}</strong></button><button type="button" class="metric-chip" :class="{on:activeMetric==='free'}" @click="clickMetric('free')">免费 <strong>{{ gameStats.free||0 }}</strong></button><button type="button" class="metric-chip" :class="{on:activeMetric==='coming_soon'}" @click="clickMetric('coming_soon')">未发售 <strong>{{ gameStats.comingSoon||0 }}</strong></button><button type="button" class="metric-chip" :class="{on:activeMetric==='region_locked'}" @click="clickMetric('region_locked')">锁国区 <strong>{{ gameStats.regionLocked||0 }}</strong></button><button type="button" class="metric-chip" :class="{on:activeMetric==='no_price'}" @click="clickMetric('no_price')">国区无价 <strong>{{ gameStats.noPrice||0 }}</strong></button><button type="button" class="metric-chip" :class="{on:activeMetric==='not_found'}" @click="clickMetric('not_found')">国区不可售 <strong>{{ gameStats.notFound||0 }}</strong></button><button type="button" class="metric-chip" :class="{on:activeMetric==='other'}" @click="clickMetric('other')">其他 <strong>{{ gameStats.other||0 }}</strong></button><button type="button" class="metric-chip" :class="{on:activeMetric==='adult'}" @click="clickMetric('adult')">成人 <strong>{{ gameStats.adult||0 }}</strong></button><button type="button" class="metric-chip" :class="{on:activeMetric==='mature'}" @click="clickMetric('mature')">成熟 <strong>{{ gameStats.mature||0 }}</strong></button><button type="button" class="metric-chip" :class="{on:activeMetric==='deleted'}" @click="clickMetric('deleted')">已删除 <strong>{{ gameStats.deleted||0 }}</strong></button><span class="metric-chip plain">已排除 <strong>{{ gameStats.backfillExcluded||0 }}</strong></span><span class="metric-chip plain">跳过中 <strong>{{ gameStats.backfillSkipped||0 }}</strong></span></div></details>
        <BulkBar :count="sel.games.count" :actions="gamesBulkActions" :running="bulkRunning" @run="(a)=>runBulk(a,sel.games,{refresh:refreshGames})" @clear="sel.games.clear()"/><div class="module-card table-card"><template v-if="!isMobile"><el-table ref="gamesTable" row-key="id" :data="games" v-loading="loading" stripe @selection-change="sel.games.onSelectionChange"><el-table-column type="selection" width="44"/><el-table-column label="游戏" min-width="250"><template #default="{row}"><div class="game-cell"><img v-if="row.steam_appid && !row.coverFailed" :src="`/img/steam/${row.steam_appid}/capsule_sm_120`" @error="row.coverFailed=true"><CoverPlaceholder v-else-if="row.steam_appid" :name="row.name" size="sm"/><div class="game-meta"><div class="game-name-row"><button class="game-name" :title="row.name" @click="openGameDetail(row)">{{ row.name }}</button><button class="copy-btn" :class="{copied:copiedGameId===row.id}" title="复制中英文名" @click.stop="copyGameName(row)"><el-icon><Check v-if="copiedGameId===row.id"/><CopyDocument v-else/></el-icon></button></div><div class="game-name-en" :title="row.name_en">{{ row.name_en || (row.steam_appid ? `AppID ${row.steam_appid}` : '无 Steam AppID') }}</div></div></div></template></el-table-column><el-table-column label="平台" min-width="130"><template #default="{row}"><el-tag v-for="p in row.platform_names||[]" :key="p" size="small" class="tag-gap">{{ p }}</el-tag><span v-if="!row.platform_names?.length" class="muted">—</span></template></el-table-column><el-table-column label="Steam 价" width="105" align="right"><template #default="{row}">{{ price(row.steam_price) }}</template></el-table-column><el-table-column label="信息" width="100"><template #default="{row}"><el-tag :type="row.has_desc?'success':'info'" size="small">{{ row.has_desc?'有简介':'缺简介' }}</el-tag></template></el-table-column><el-table-column label="报价" prop="offer_count" width="72" align="right"/><el-table-column label="状态" width="90"><template #default="{row}"><el-tag :type="row.blocked?'danger':'success'" size="small">{{ row.blocked?'已禁用':'正常' }}</el-tag></template></el-table-column><el-table-column label="同步状态" width="105"><template #default="{row}"><el-tag :type="row.steam_status==='ok'?'success':row.steam_status==='region_locked'?'danger':row.steam_status==='coming_soon'?'warning':'info'" size="small">{{ steamStatusLabel(row) }}</el-tag></template></el-table-column><el-table-column label="分级" width="80"><template #default="{row}"><el-tag v-if="row.adult_flag" type="danger" size="small">成人</el-tag><el-tag v-else-if="row.mature_flag" type="warning" size="small">成熟</el-tag><span v-else class="muted">—</span></template></el-table-column><el-table-column label="链接" width="85" align="right"><template #default="{row}"><el-button v-if="row.link_count" link type="primary" @click="openGameLinks(row)">{{ row.link_count }} 个</el-button><span v-else class="muted">—</span></template></el-table-column><el-table-column label="操作" width="170" fixed="right"><template #default="{row}"><el-button v-if="row.steam_appid" link type="primary" @click="editGame(row)">编辑</el-button><el-button v-if="row.steam_appid" link @click="toggleGame(row)">{{ row.blocked?'启用':'禁用' }}</el-button><el-button link type="danger" @click="deleteGame(row)">删除</el-button></template></el-table-column></el-table></template><div v-else class="game-card-list"><div v-for="row in games" :key="row.id" class="admin-card"><div class="admin-card-pick"><el-checkbox :model-value="sel.games.has(row)" @change="sel.games.toggle(row)">选择</el-checkbox></div><div class="admin-card-main"><div class="game-cell"><img v-if="row.steam_appid && !row.coverFailed" :src="`/img/steam/${row.steam_appid}/capsule_sm_120`" @error="row.coverFailed=true"><CoverPlaceholder v-else-if="row.steam_appid" :name="row.name" size="sm"/><div class="game-meta"><div class="game-name-row"><button class="game-name" :title="row.name" @click="openGameDetail(row)">{{ row.name }}</button><button class="copy-btn" :class="{copied:copiedGameId===row.id}" title="复制中英文名" @click.stop="copyGameName(row)"><el-icon><Check v-if="copiedGameId===row.id"/><CopyDocument v-else/></el-icon></button></div><div class="game-name-en" :title="row.name_en">{{ row.name_en || (row.steam_appid ? `AppID ${row.steam_appid}` : '无 Steam AppID') }}</div></div></div><div class="admin-card-tags"><el-tag v-for="p in row.platform_names||[]" :key="p" size="small" class="tag-gap">{{ p }}</el-tag><el-tag size="small" :type="row.has_desc?'success':'info'">{{ row.has_desc?'有简介':'缺简介' }}</el-tag><el-tag size="small" :type="row.blocked?'danger':'success'">{{ row.blocked?'已禁用':'正常' }}</el-tag><el-tag size="small" :type="row.steam_status==='ok'?'success':row.steam_status==='region_locked'?'danger':row.steam_status==='coming_soon'?'warning':'info'">{{ steamStatusLabel(row) }}</el-tag><el-tag v-if="row.adult_flag" size="small" type="danger">成人</el-tag><el-tag v-else-if="row.mature_flag" size="small" type="warning">成熟</el-tag></div></div><div class="admin-card-foot"><span>Steam {{ price(row.steam_price) }} · 报价 {{ row.offer_count }}<template v-if="row.link_count"> · <el-button link type="primary" @click="openGameLinks(row)">链接 {{ row.link_count }}</el-button></template></span><span><el-button v-if="row.steam_appid" link type="primary" @click="editGame(row)">编辑</el-button><el-button v-if="row.steam_appid" link @click="toggleGame(row)">{{ row.blocked?'启用':'禁用' }}</el-button><el-button link type="danger" @click="deleteGame(row)">删除</el-button></span></div></div></div><GameLinksDrawer v-model:visible="linksDrawer.visible" :game="linksDrawer.game" :links="linksDrawer.links" :loading="linksDrawer.loading"/>
          <div class="pager"><span>共 {{ gameTotal }} 款 · 第 {{ gamePage }}/{{ gamePages }} 页</span><el-pagination background layout="prev, pager, next, sizes" :total="gameTotal" :current-page="gamePage" :page-size="gamePageSize" :page-sizes="[20,50,100]" @current-change="loadGames" @size-change="changeGameSize"/></div>
        </div>
        <el-dialog v-model="gameDialog" title="编辑游戏" width="min(560px, 92vw)"><p class="muted">{{ activeGame?.name }} · AppID {{ activeGame?.steam_appid }}</p><el-form label-position="top"><el-form-item label="游戏简介"><el-input v-model="gameDescription" type="textarea" :rows="5" maxlength="10000" show-word-limit/></el-form-item><el-form-item><el-checkbox v-model="gameBlocked">在前台隐藏并停止常规展示</el-checkbox></el-form-item></el-form><template #footer><el-button @click="closeGameDialog">取消</el-button><el-button type="primary" :loading="saving" @click="saveGame">保存</el-button></template></el-dialog>
        <el-dialog v-model="mergeDialog" title="合并重复游戏" width="min(480px, 92vw)"><p class="muted">用于同一游戏被收录两次（不同 AppID）时人工合并；报价与历史会迁到目标游戏。</p><el-form label-position="top"><el-form-item label="源 AppID（被合并方，合并后删除）"><el-input v-model="mergeForm.from" type="number" placeholder="例如 440"/></el-form-item><el-form-item label="目标 AppID（保留方）"><el-input v-model="mergeForm.to" type="number" placeholder="例如 730"/></el-form-item></el-form><template #footer><el-button @click="mergeDialog=false">取消</el-button><el-button type="primary" :loading="saving" @click="mergeGames">合并</el-button></template></el-dialog>
      </template>
      <template v-else-if="gameView==='align'">
        <AlignAdmin />
      </template>
      <template v-else>
        <div class="notice-card"><strong>数据任务由服务器自动执行</strong><p>下表是调度计划与运行状态；需要立即执行时点「立即运行」（使用默认参数）。任务之间自动互斥，不会同时抢占 Steam 配额。价格刷新间隔可在「系统设置 → 数据源与采集」调整。</p></div>
        <!-- DR 批（docs/APP-INSTANT-UPDATE.md §3.1）：App 版本卡——当前版本 / 上次同步 / 失败原因 / 立即同步 -->
        <div class="module-card app-version-card"><div class="card-heading"><div><h3>App 版本</h3><p>站点自托管的安卓最新版（App 内置更新读 /api/app/latest）；发版后点「立即同步」手机最快数十秒可检测到更新。</p></div><el-button type="primary" :loading="appSyncRunning" @click="syncAppNow">立即同步</el-button></div>
          <div class="app-version-grid"><div class="metric-card"><span>当前版本</span><strong>{{ appCard.latest ? `${appCard.latest.version}（${appCard.latest.versionCode}）` : '—' }}</strong></div><div class="metric-card"><span>上次同步时间</span><strong>{{ appCard.lastSyncAt ? dateTime(appCard.lastSyncAt) : '—' }}</strong></div><div class="metric-card"><span>失败原因</span><strong :class="{'text-danger':appCard.lastError}" class="app-version-reason">{{ appCard.lastError || '—' }}</strong></div><div class="metric-card"><span>状态</span><strong>{{ appSyncRunning || appCard.syncing ? '同步中…' : '就绪' }}</strong></div></div></div>
        <div v-if="runningJob && backfillProgress" class="notice-card"><strong>任务实时进度：{{ TASK_META[runningJob]?.label||runningJob }}</strong><p>{{ backfillProgress.done }} / {{ backfillProgress.limit }}（{{ backfillProgress.percent }}%）· 速度 {{ backfillProgress.ratePerMin }} 款/分钟<template v-if="backfillProgress.ratePerMin>0 && backfillProgress.limit>backfillProgress.done"> · 预计剩余约 {{ Math.max(1, Math.round((backfillProgress.limit-backfillProgress.done)/backfillProgress.ratePerMin)) }} 分钟</template></p></div>
        <div class="module-card table-card"><el-alert v-if="syncWarnings.length" type="warning" :closable="false" class="task-warnings"><p v-for="w in syncWarnings" :key="w.name">任务 <strong>{{ w.name }}</strong> 缺失：{{ w.reason }}</p></el-alert><el-table :data="taskRows" v-loading="loading"><el-table-column prop="label" label="任务" min-width="110"/><el-table-column label="覆盖" min-width="120"><template #default="{row}"><template v-if="row.stats"><span class="muted">匹配 {{ row.stats.matched }} · 未命中 {{ row.stats.nomatch }}<br>待探测 {{ row.stats.pending }}</span></template><span v-else class="muted">—</span></template></el-table-column><el-table-column prop="freq" label="频率" width="90"/><el-table-column label="上次运行" min-width="155"><template #default="{row}">{{ row.lastRunAt ? dateTime(row.lastRunAt) : '—' }}</template></el-table-column><el-table-column label="下次运行" min-width="155"><template #default="{row}">{{ row.nextRunAt ? dateTime(row.nextRunAt) : '—' }}</template></el-table-column><el-table-column label="上次结果" width="95"><template #default="{row}"><el-tag v-if="row.lastResult==='ok'" type="success" size="small">成功</el-tag><el-tag v-else-if="row.lastResult==='partial'" type="warning" size="small" :title="partialTitle(row)">部分完成</el-tag><el-tag v-else-if="row.lastResult==='failed'" type="danger" size="small">失败</el-tag><span v-else class="muted">—</span></template></el-table-column><el-table-column label="耗时" width="185" align="right"><template #default="{row}"><template v-if="row.lastElapsedMs!=null">{{ fmtDur(row.lastElapsedMs) }}</template><span v-else class="muted">—</span><template v-if="row.estimate"><div class="muted task-estimate">估算 {{ estimateText(row) }}<span v-if="deltaText(row)" :class="estimateOver(row)?'delta-over':''"> · {{ deltaText(row) }}</span></div></template></template></el-table-column><el-table-column label="失败原因" min-width="150" show-overflow-tooltip><template #default="{row}">{{ partialReason(row) }}</template></el-table-column><el-table-column label="状态" width="140"><template #default="{row}"><el-tag v-if="row.name === runningJob" type="primary" size="small">运行中</el-tag><el-tag v-else-if="row.waitingFor" type="info" size="small">等待 {{ row.waitingFor.occupiedBy }}</el-tag><el-tag v-else-if="row.openUntil" type="danger" size="small">熔断至 {{ dateTime(row.openUntil) }}</el-tag><el-tag v-else-if="row.failures" type="warning" size="small">失败 {{ row.failures }} 次</el-tag><span v-else-if="row.retryAt" class="muted">重试于 {{ fmtHM(row.retryAt) }}</span><span v-else class="muted">空闲</span></template></el-table-column><el-table-column label="操作" width="200"><template #default="{row}"><el-button link type="primary" :disabled="Boolean(runningJob)" @click="runTask(row.name)">立即运行</el-button><el-button v-if="row.openUntil" link type="danger" @click="resetCircuit(row)">重置熔断</el-button></template></el-table-column></el-table></div>
        <div class="module-card task-state"><div><span class="eyebrow-small">当前任务</span><strong>{{ runningJob ? (TASK_META[runningJob]?.label || runningJob) : '空闲' }}</strong></div><div v-if="syncStatus?.run" class="muted">{{ syncStatus.run.mode }} · {{ dateTime(syncStatus.run.startedAt) }}</div><pre v-if="syncStatus?.output">{{ syncStatus.output }}</pre><div v-if="runningJob" class="task-actions"><el-button type="danger" plain @click="stopCurrent">停止</el-button></div></div>
      </template>
    </template>

    <!-- 访问与安全 -->
    <template v-else-if="section==='visitors'">
      <div class="module-tabs"><button v-for="tab in visitorTabs" :key="tab.value" :class="{on:visitorView===tab.value}" @click="visitorView=tab.value;loadVisitorView()">{{ tab.label }}</button></div>
      <template v-if="visitorView==='visits'">
        <div class="module-tabs sub-tabs"><button :class="{on:visitMode==='ip'}" @click="switchVisitMode('ip')">IP 统计</button><button :class="{on:visitMode==='detail'}" @click="switchVisitMode('detail')">明细</button><span class="muted">时间窗</span><el-select v-model="visitDays" style="width:104px" @change="onVisitDaysChange"><el-option label="近 1 天" :value="1"/><el-option label="近 7 天" :value="7"/><el-option label="近 30 天" :value="30"/></el-select></div>
        <template v-if="visitMode==='detail'">
        <div class="metric-grid"><div class="metric-card"><span>今日访问</span><strong>{{ visitorSummary.today_visits||0 }}</strong></div><div class="metric-card"><span>今日独立 IP</span><strong>{{ visitorSummary.today_ips||0 }}</strong></div><div class="metric-card"><span>今日拦截</span><strong>{{ visitorSummary.today_blocked||0 }}</strong></div><div class="metric-card"><span>黑名单</span><strong>{{ visitorSummary.blocked_count||0 }}</strong></div></div>
        <div class="module-card filterbar"><el-select v-model="visitorFilter" @change="loadVisitors(1)"><el-option label="正常访问" value="visits"/><el-option label="已拦截" value="blocked"/><el-option label="全部记录" value="all"/></el-select><el-input v-model="visitorIp" clearable placeholder="按 IP 筛选" @keyup.enter="loadVisitors(1)"/><el-input v-model="visitorPath" clearable placeholder="按路径筛选" @keyup.enter="loadVisitors(1)"/><el-button @click="loadVisitors(1)">查询</el-button></div>
        <BulkBar :count="sel.visitors.count" :actions="visitorsBulkActions" :running="bulkRunning" @run="(a)=>runBulk(a,sel.visitors,{refresh:()=>loadVisitors(visitorPage)})" @clear="sel.visitors.clear()"/><div class="module-card table-card"><template v-if="!isMobile"><el-table ref="visitorsTable" :data="visitors" v-loading="loading" stripe :default-sort="visitorSort" @sort-change="onVisitorSortChange" @selection-change="sel.visitors.onSelectionChange"><el-table-column type="selection" width="44"/><el-table-column prop="ip" sortable="custom" label="IP" min-width="155"><template #default="{row}"><span class="mono">{{ row.ip }}</span><small v-if="row.remote_ip && row.remote_ip!==row.ip">直连 {{ row.remote_ip }}</small></template></el-table-column><el-table-column prop="region" label="地区" width="100"/><el-table-column label="路径" min-width="220" show-overflow-tooltip><template #default="{row}">{{ row.path }}<small v-if="row.block_reason">{{ row.block_reason }}</small></template></el-table-column><el-table-column prop="status" sortable="custom" label="结果" width="100"><template #default="{row}"><el-tag v-if="row.blocked" type="danger" size="small">拦截 {{ row.status }}</el-tag><el-tag v-else-if="row.status>=400" type="warning" size="small">{{ row.status }}</el-tag><span v-else>{{ row.status||'—' }}</span></template></el-table-column><el-table-column prop="created_at" sortable="custom" label="时间" min-width="160"><template #default="{row}">{{ dateTime(row.created_at) }}</template></el-table-column><el-table-column label="操作" width="140"><template #default="{row}"><el-button link type="danger" @click="banIp(row.ip)">封禁 IP</el-button><el-button link @click="addWhitelist(row.ip)">信任</el-button></template></el-table-column></el-table></template><div v-else class="game-card-list"><div v-for="row in visitors" :key="row.id" class="admin-card"><div class="admin-card-pick"><el-checkbox :model-value="sel.visitors.has(row)" @change="sel.visitors.toggle(row)">选择</el-checkbox></div><div class="admin-card-main"><strong class="mono">{{ row.ip }}</strong><small v-if="row.remote_ip && row.remote_ip!==row.ip">直连 {{ row.remote_ip }}</small><span class="muted">{{ row.region||'—' }}</span><p class="admin-card-path">{{ row.path }}<small v-if="row.block_reason"> · {{ row.block_reason }}</small></p></div><div class="admin-card-foot"><span><el-tag v-if="row.blocked" type="danger" size="small">拦截 {{ row.status }}</el-tag><el-tag v-else-if="row.status>=400" type="warning" size="small">{{ row.status }}</el-tag><span v-else>{{ row.status||'—' }}</span> · {{ dateTime(row.created_at) }}</span><span><el-button link type="danger" @click="banIp(row.ip)">封禁 IP</el-button><el-button link @click="addWhitelist(row.ip)">信任</el-button></span></div></div></div><div class="pager"><span>共 {{ visitorTotal }} 条</span><PaginationBar v-model:page="visitorPage" v-model:page-size="visitorPageSize" :total="visitorTotal" @change="loadVisitors"/></div></div>
        </template>
        <template v-else>
          <div class="module-card filterbar"><el-input v-model="ipQuery" clearable placeholder="按 IP 搜索" @keyup.enter="loadVisitorsByIp(1)"/><el-button @click="loadVisitorsByIp(1)">查询</el-button><el-select v-model="ipStatus" style="width:128px" @change="loadVisitorsByIp(1)"><el-option label="全部状态" value="all"/><el-option label="正常" value="normal"/><el-option label="被拦截" value="intercepted"/><el-option label="封禁中" value="banned"/><el-option label="已封禁" value="blocked"/></el-select><span class="muted">共 {{ ipTotal }} 个 IP（每页 {{ ipPageSize }}）</span></div>
          <div class="module-card table-card"><template v-if="!isMobile"><el-table :data="ipRows" v-loading="loading" row-key="ip" stripe @sort-change="onIpSortChange" @expand-change="onIpExpand"><el-table-column type="expand"><template #default="{row}"><div class="ip-detail"><template v-if="ipDetails[row.ip]"><h4>最近访问（{{ visitDays }} 天内最多 20 条）</h4><div v-for="r in ipDetails[row.ip].recent" :key="r.id" class="log-line"><span class="mono">{{ dateTime(r.created_at) }}</span><span class="mono">{{ r.method }} {{ r.path }}</span><span>{{ r.status||'—' }}</span><el-tag v-if="r.blocked" type="danger" size="small">拦截</el-tag></div><el-empty v-if="!ipDetails[row.ip].recent.length" description="时间窗内没有访问" :image-size="40"/><h4>访问最多的路径</h4><div v-for="p in ipDetails[row.ip].topPaths" :key="p.path" class="log-line"><span>{{ p.path }}</span><span>{{ p.n }}</span></div><el-empty v-if="!ipDetails[row.ip].topPaths.length" description="没有路径" :image-size="40"/></template><span v-else class="muted">加载中…</span></div></template></el-table-column><el-table-column prop="ip" sortable="custom" label="IP" min-width="150"><template #default="{row}"><span class="mono">{{ row.ip }}</span></template></el-table-column><el-table-column label="地区" width="100"><template #default="{row}">{{ row.region||'—' }}</template></el-table-column><el-table-column prop="visits" sortable="custom" label="访问次数" width="100" align="right"/><el-table-column prop="last_at" sortable="custom" label="首次 → 最近" min-width="230"><template #default="{row}"><span class="muted">{{ dateTime(row.first_at) }} → {{ dateTime(row.last_at) }}</span></template></el-table-column><el-table-column prop="paths" label="独立路径" width="100" align="right"/><el-table-column prop="devices" label="设备数" width="90" align="right"/><el-table-column label="状态" width="110"><template #default="{row}"><el-tag :type="row.status==='blocked'?'danger':row.status==='banned'?'warning':row.status==='intercepted'?'warning':'info'" :effect="row.status==='intercepted'?'plain':'dark'" size="small">{{ row.status==='blocked'?'已封禁':row.status==='banned'?'封禁中 · '+banLeft(row):row.status==='intercepted'?'被拦截':'正常' }}</el-tag></template></el-table-column><el-table-column label="操作" width="140"><template #default="{row}"><el-button link type="danger" @click="banIp(row.ip)">封禁 IP</el-button><el-button link @click="addWhitelist(row.ip)">信任</el-button></template></el-table-column></el-table></template><div v-else class="game-card-list"><div v-for="row in ipRows" :key="row.ip" class="admin-card"><div class="admin-card-main"><strong class="mono">{{ row.ip }}</strong><small>{{ row.region||'—' }} · {{ dateTime(row.first_at) }} → {{ dateTime(row.last_at) }}</small><span class="muted">访问 {{ row.visits }} 次 · 路径 {{ row.paths }} · 设备 {{ row.devices }}</span><div><el-tag :type="row.status==='blocked'?'danger':row.status==='banned'?'warning':row.status==='intercepted'?'warning':'info'" :effect="row.status==='intercepted'?'plain':'dark'" size="small">{{ row.status==='blocked'?'已封禁':row.status==='banned'?'封禁中 · '+banLeft(row):row.status==='intercepted'?'被拦截':'正常' }}</el-tag></div></div><div class="admin-card-foot"><span></span><span><el-button link type="danger" @click="banIp(row.ip)">封禁</el-button><el-button link @click="addWhitelist(row.ip)">信任</el-button></span></div></div><el-empty v-if="!ipRows.length" description="时间窗内没有访问记录"/></div><div class="pager"><span>共 {{ ipTotal }} 个 IP</span><PaginationBar v-model:page="ipPage" v-model:page-size="ipPageSize" :total="ipTotal" @change="loadVisitorsByIp"/></div></div>
        </template>
      </template>      <template v-else-if="visitorView==='review'">
        <div class="notice-card"><strong>异常请求由管理员审核</strong><p>系统记录异常但不自动永久封禁；审核后可封 IP、封设备或忽略。白名单可保护自己的管理出口 IP。封禁发生时该 IP 的旧待审会标记为 auto_banned 永久退出待审（「全部」视图可查）；封禁期间产生的新异常仍会以「待审」出现（状态列可据此判断是否已处理）。</p></div>
        <div class="module-card table-card"><div class="card-heading padded"><div><h3>待审列表</h3><p>同一 IP 合并为一行，展开看逐条规则 · 共 {{ reviews.length }} 条（上限 500）</p></div><el-select v-model="reviewStatus" style="width:130px" @change="loadReviews"><el-option label="只看待审" value="pending"/><el-option label="全部（审计）" value="all"/></el-select></div><div class="merge-bar"><span>已选 {{ mergedPicked.size }} 个 IP · {{ mergedPickedCount }} 条待审</span><el-button size="small" type="danger" plain :disabled="!mergedPicked.size" :loading="bulkRunning==='approve-ip'" @click="runMergedBulk('approve-ip')">封 IP</el-button><el-button size="small" type="danger" plain :disabled="!mergedPicked.size" :loading="bulkRunning==='approve-device'" @click="runMergedBulk('approve-device')">封设备</el-button><el-button size="small" :disabled="!mergedPicked.size" :loading="bulkRunning==='reject'" @click="runMergedBulk('reject')">忽略</el-button></div><template v-if="!isMobile"><el-table ref="mergedReviewsTable" row-key="key" :data="pagedMergedReviews" v-loading="loading" :default-sort="mergedSort" @sort-change="onMergedSortChange"><el-table-column width="44"><template #default="{row}"><el-checkbox :model-value="mergedPicked.has(row.key)" :disabled="!row.pendingCount" @change="toggleMergedPick(row)"/></template></el-table-column><el-table-column type="expand"><template #default="{row}"><div class="merged-detail"><div v-for="r in row.rows" :key="r.id" class="merged-detail-row"><span class="muted">{{ r.rule }}</span><span>命中 {{ r.hits }} 次</span><span class="muted">{{ r.path||r.detail }}</span><span class="muted">{{ dateTime(r.last_seen) }}</span><el-tag v-if="r.status==='pending'" type="success" size="small">待审</el-tag><el-tag v-else-if="r.status==='approved'" type="danger" size="small">已封禁</el-tag><el-tag v-else-if="r.status==='rejected'" type="info" size="small">已忽略</el-tag><el-tag v-else type="info" size="small">自动退出</el-tag><span v-if="r.region" class="muted">{{ r.region }}</span><span v-if="r.last_ua" class="muted" :title="r.last_ua">{{ (r.last_ua||'').slice(0,40) }}</span><el-tag v-if="r.appeal_status" size="small" type="info">申诉：{{ r.appeal_status }}</el-tag><template v-if="r.status==='pending'"><el-dropdown size="small" @command="(m)=>reviewAct(r.id,'tempban',m)"><el-button link size="small">临时封<el-icon class="el-icon--right"><ArrowDown/></el-icon></el-button><template #dropdown><el-dropdown-menu><el-dropdown-item :command="10">10 分钟</el-dropdown-item><el-dropdown-item :command="60">1 小时</el-dropdown-item><el-dropdown-item :command="1440">1 天</el-dropdown-item></el-dropdown-menu></template></el-dropdown><el-button link size="small" type="danger" @click="reviewAct(r.id,'permban')">永久封</el-button><el-button link size="small" type="success" @click="reviewAct(r.id,'trust')">信任</el-button><el-button link size="small" @click="reviewAct(r.id,'ignore')">忽略</el-button></template></div></div></template></el-table-column><el-table-column prop="ip" sortable="custom" label="IP" min-width="180"><template #default="{row}"><span class="mono">{{ row.ip }}</span><small v-if="row.devices>1" style="margin-left:8px">· {{ row.devices }} 个设备</small></template></el-table-column><el-table-column prop="ruleCount" sortable="custom" label="规则摘要" width="250"><template #default="{row}"><el-popover placement="top" trigger="hover" :width="240" :disabled="!row.rules || row.rules.length<=1"><div class="rule-pop"><div v-for="r in row.rules" :key="r.rule">{{ r.rule }} ×{{ r.n }}</div></div><template #reference><span class="rule-summary">{{ row.rules[0]?.rule }} ×{{ row.rules[0]?.n }} · 共 {{ row.ruleCount }} 条规则</span></template></el-popover></template></el-table-column><el-table-column prop="hitsTotal" sortable="custom" label="总次数" width="80" align="right"/><el-table-column prop="last_seen" sortable="custom" label="首次 → 最近" min-width="190"><template #default="{row}">{{ dateTime(row.firstSeen) }} → {{ dateTime(row.lastSeen) }}</template></el-table-column><el-table-column label="状态" width="110"><template #default="{row}"><el-tag v-if="row.status==='pending'" type="success" size="small">待审</el-tag><el-tag v-else-if="row.status==='auto_banned'" type="info" size="small">已封禁</el-tag><el-tag v-else type="warning" size="small">部分已处理</el-tag></template></el-table-column><el-table-column label="操作" width="190"><template #default="{row}"><el-button v-if="row.pendingCount" link type="danger" @click="mergedAct(row,'approve-ip')">封 IP</el-button><el-button v-if="row.pendingCount && row.devices" link type="danger" @click="mergedAct(row,'approve-device')">封设备</el-button><el-button v-if="row.pendingCount" link @click="mergedAct(row,'reject')">忽略</el-button></template></el-table-column></el-table></template><div v-else class="game-card-list"><div v-for="row in pagedMergedReviews" :key="row.key" class="admin-card"><div class="admin-card-pick"><el-checkbox :model-value="mergedPicked.has(row.key)" :disabled="!row.pendingCount" @change="toggleMergedPick(row)">选择</el-checkbox></div><div class="admin-card-main"><strong class="mono">{{ row.ip }}</strong><small>首次 {{ dateTime(row.firstSeen) }} → 最近 {{ dateTime(row.lastSeen) }}</small><span class="muted">{{ row.rules[0]?.rule }} ×{{ row.rules[0]?.n }} · 共 {{ row.ruleCount }} 条规则</span><el-tag v-if="row.status==='pending'" type="success" size="small">待审</el-tag><el-tag v-else-if="row.status==='auto_banned'" type="info" size="small">已封禁</el-tag><el-tag v-else type="warning" size="small">部分已处理</el-tag><p class="admin-card-path">共 {{ row.ruleCount }} 条规则 · {{ row.hitsTotal }} 次命中 · {{ row.devices }} 个设备</p></div><div class="admin-card-foot"><span></span><span><el-button v-if="row.pendingCount" link type="danger" @click="mergedAct(row,'approve-ip')">封 IP</el-button><el-button v-if="row.pendingCount && row.devices" link type="danger" @click="mergedAct(row,'approve-device')">封设备</el-button><el-button v-if="row.pendingCount" link @click="mergedAct(row,'reject')">忽略</el-button></span></div></div></div><PaginationBar v-model:page="mergedPage" v-model:page-size="mergedPageSize" :total="sortedMergedReviews.length"/></div>
      </template>
      <template v-else-if="visitorView==='devices'">
        <div class="notice-card"><strong>设备封禁按指纹生效</strong><p>换 IP 也会命中；白名单 IP 不受影响。审核弹窗「封设备」产生的封禁同样在这里管理。解封后该设备仍会出现在「最近设备」里（历史记录不删）。</p></div>
        <div class="module-card table-card"><div class="card-heading padded"><div><h3>最近设备</h3><p>按设备指纹去重，最多 100 条</p></div><el-button text @click="loadDevices">刷新</el-button></div><BulkBar :count="sel.devices.count" :actions="devicesBulkActions" :running="bulkRunning" @run="openBulkDeviceBan" @clear="sel.devices.clear()"/><template v-if="!isMobile"><el-table ref="devicesTable" row-key="key" :data="pagedDevices" v-loading="loading" stripe @selection-change="sel.devices.onSelectionChange"><el-table-column type="selection" width="44" :selectable="(row)=>Boolean(row.fingerprint)"/><el-table-column label="最近出现" min-width="155"><template #default="{row}">{{ dateTime(row.lastAt) }}</template></el-table-column><el-table-column label="设备（按设备码聚合）" min-width="190"><template #default="{row}"><span class="mono">{{ row.deviceId||'无设备码' }}</span><small class="muted"> · 指纹 {{ String(row.fingerprint||'').slice(0,10) }}…</small></template></el-table-column><el-table-column label="IP" min-width="170" show-overflow-tooltip><template #default="{row}">{{ (row.ips||[]).join('、')||'—' }}</template></el-table-column><el-table-column prop="count" label="出现次数" width="100" align="right"/><el-table-column label="状态" width="100"><template #default="{row}"><el-tag v-if="row.banned" type="danger" size="small">已封禁</el-tag><span v-else class="muted">正常</span></template></el-table-column><el-table-column label="UA" min-width="200" show-overflow-tooltip><template #default="{row}"><span class="muted">{{ String(row.user_agent||'').slice(0,60) }}</span></template></el-table-column><el-table-column label="操作" width="100" fixed="right"><template #default="{row}"><el-button v-if="row.fingerprint" link type="danger" @click="openDeviceBan(row)">封禁</el-button></template></el-table-column></el-table></template><div v-else class="game-card-list"><div v-for="row in pagedDevices" :key="row.key" class="admin-card"><div class="admin-card-pick"><el-checkbox :model-value="sel.devices.has(row)" :disabled="!row.fingerprint" @change="sel.devices.toggle(row)">选择</el-checkbox></div><div class="admin-card-main"><strong class="mono">{{ row.deviceId||'无设备码' }}</strong><small>{{ (row.ips||[]).join('、')||'—' }} · {{ dateTime(row.lastAt) }}</small><span class="mono muted">指纹 {{ String(row.fingerprint||'').slice(0,12) }}… · 出现 {{ row.count }} 次<el-tag v-if="row.banned" type="danger" size="small" style="margin-left:6px">已封禁</el-tag></span><p class="admin-card-path">{{ String(row.user_agent||'').slice(0,60) }}</p></div><div class="admin-card-foot"><span></span><span><el-button v-if="row.fingerprint" link type="danger" @click="openDeviceBan(row)">封禁</el-button></span></div></div></div><PaginationBar v-model:page="devicesPage" v-model:page-size="devicesPageSize" :total="devices.length"/></div>
        <div class="module-card table-card"><div class="card-heading padded"><div><h3>已封设备</h3><p>封禁至为空 = 永久</p></div><el-button text @click="loadDevices">刷新</el-button></div><BulkBar :count="sel.deviceBans.count" :actions="deviceBansBulkActions" :running="bulkRunning" @run="(a)=>runBulk(a,sel.deviceBans,{refresh:loadDevices})" @clear="sel.deviceBans.clear()"/><template v-if="!isMobile"><el-table ref="deviceBansTable" row-key="fingerprint" :data="pagedDeviceBans" v-loading="loading" stripe @selection-change="sel.deviceBans.onSelectionChange"><el-table-column type="selection" width="44"/><el-table-column label="指纹" min-width="150"><template #default="{row}"><span class="mono" :title="row.fingerprint">{{ String(row.fingerprint||'').slice(0,12) }}…</span></template></el-table-column><el-table-column label="设备 ID" min-width="130" show-overflow-tooltip><template #default="{row}"><span class="mono">{{ row.device_id||'—' }}</span></template></el-table-column><el-table-column label="封禁至" width="170"><template #default="{row}">{{ row.until ? dateTime(row.until) : '永久' }}</template></el-table-column><el-table-column label="备注" min-width="160" show-overflow-tooltip><template #default="{row}">{{ row.note||'—' }}</template></el-table-column><el-table-column label="操作" width="100" fixed="right"><template #default="{row}"><el-button link type="primary" @click="unbanDevice(row)">解封</el-button></template></el-table-column></el-table></template><div v-else class="game-card-list"><div v-for="row in pagedDeviceBans" :key="row.fingerprint||row.device_id" class="admin-card"><div class="admin-card-pick"><el-checkbox :model-value="sel.deviceBans.has(row)" @change="sel.deviceBans.toggle(row)">选择</el-checkbox></div><div class="admin-card-main"><strong class="mono">{{ String(row.fingerprint||'').slice(0,12) }}…</strong><small>{{ row.device_id||'—' }} · 封禁至 {{ row.until ? dateTime(row.until) : '永久' }}</small><p class="admin-card-path">{{ row.note||'—' }}</p></div><div class="admin-card-foot"><span></span><span><el-button link type="primary" @click="unbanDevice(row)">解封</el-button></span></div></div></div><PaginationBar v-model:page="deviceBansPage" v-model:page-size="deviceBansPageSize" :total="deviceBans.length"/></div>
        <el-dialog v-model="deviceBanDialog.visible" title="封禁设备" width="min(400px, 92vw)"><p class="muted">指纹 {{ String(deviceBanDialog.row?.fingerprint||'').slice(0,12) }}…；该设备所有请求将被拒绝（白名单 IP 除外）。</p><el-radio-group v-model="deviceBanDialog.duration"><el-radio :value="10">10 分钟</el-radio><el-radio :value="60">1 小时</el-radio><el-radio :value="1440">1 天</el-radio><el-radio :value="'permanent'">永久</el-radio></el-radio-group><template #footer><el-button @click="deviceBanDialog.visible=false">取消</el-button><el-button type="danger" :loading="saving" @click="banDevice">确认封禁</el-button></template></el-dialog>
      </template>
      <template v-else>
        <div class="security-grid"><div class="module-card"><div class="card-heading"><div><h3>IP 黑名单</h3><p>封禁后该 IP 无法访问站点</p></div><span class="heading-actions"><el-button text @click="loadSecurity">刷新</el-button><el-button type="danger" plain @click="openIpDialog('black')">添加黑名单</el-button></span></div><BulkBar :count="sel.blacklist.count" :actions="blacklistBulkActions" :running="bulkRunning" @run="(a)=>runBulk(a,sel.blacklist,{refresh:loadSecurity})" @clear="sel.blacklist.clear()"/><template v-if="!isMobile"><el-table ref="blacklistTable" row-key="ip" :data="pagedBlacklist" size="small" @selection-change="sel.blacklist.onSelectionChange"><el-table-column type="selection" width="44"/><el-table-column prop="ip" label="IP / CIDR"/><el-table-column prop="note" label="备注"/><el-table-column prop="visits" label="访问" width="80" align="right"/><el-table-column label="最近访问" width="150"><template #default="{row}">{{ row.last_at?dateTime(row.last_at):"—" }}</template></el-table-column><el-table-column prop="devices" label="设备数" width="80" align="right"/><el-table-column label="操作" width="80"><template #default="{row}"><el-button link type="primary" @click="removeBlacklist(row.ip)">解封</el-button></template></el-table-column></el-table></template><div v-else class="game-card-list"><div v-for="row in pagedBlacklist" :key="row.ip" class="admin-card"><div class="admin-card-pick"><el-checkbox :model-value="sel.blacklist.has(row)" @change="sel.blacklist.toggle(row)">选择</el-checkbox></div><div class="admin-card-main"><strong class="mono">{{ row.ip }}</strong><small class="muted">近 7 天 {{ row.visits||0 }} 次 · {{ row.devices||0 }} 设备{{ row.last_at?' · '+dateTime(row.last_at):'' }}</small><p class="admin-card-path">{{ row.note||'—' }}</p></div><div class="admin-card-foot"><span></span><span><el-button link type="primary" @click="removeBlacklist(row.ip)">解封</el-button></span></div></div></div><PaginationBar v-model:page="blacklistPage" v-model:page-size="blacklistPageSize" :total="blacklist.length"/></div>
        <div class="module-card"><div class="card-heading"><div><h3>IP 白名单</h3><p>白名单 IP 不受自动频率封禁</p></div><span class="heading-actions"><el-button text @click="loadSecurity">刷新</el-button><el-button type="primary" plain @click="openIpDialog('white')">添加白名单</el-button></span></div><BulkBar :count="sel.whitelist.count" :actions="whitelistBulkActions" :running="bulkRunning" @run="(a)=>runBulk(a,sel.whitelist,{refresh:loadSecurity})" @clear="sel.whitelist.clear()"/><template v-if="!isMobile"><el-table ref="whitelistTable" row-key="ip" :data="pagedWhitelist" size="small" @selection-change="sel.whitelist.onSelectionChange"><el-table-column type="selection" width="44"/><el-table-column prop="ip" label="IP / CIDR"/><el-table-column prop="note" label="备注"/><el-table-column prop="visits" label="访问" width="80" align="right"/><el-table-column label="最近访问" width="150"><template #default="{row}">{{ row.last_at?dateTime(row.last_at):"—" }}</template></el-table-column><el-table-column prop="devices" label="设备数" width="80" align="right"/><el-table-column label="操作" width="80"><template #default="{row}"><el-button link type="danger" @click="removeWhitelist(row.ip)">移除</el-button></template></el-table-column></el-table></template><div v-else class="game-card-list"><div v-for="row in pagedWhitelist" :key="row.ip" class="admin-card"><div class="admin-card-pick"><el-checkbox :model-value="sel.whitelist.has(row)" @change="sel.whitelist.toggle(row)">选择</el-checkbox></div><div class="admin-card-main"><strong class="mono">{{ row.ip }}</strong><small class="muted">近 7 天 {{ row.visits||0 }} 次 · {{ row.devices||0 }} 设备{{ row.last_at?' · '+dateTime(row.last_at):'' }}</small><p class="admin-card-path">{{ row.note||'—' }}</p></div><div class="admin-card-foot"><span></span><span><el-button link type="danger" @click="removeWhitelist(row.ip)">移除</el-button></span></div></div></div><PaginationBar v-model:page="whitelistPage" v-model:page-size="whitelistPageSize" :total="whitelist.length"/></div></div>
        <div class="module-card table-card security-events"><div class="card-heading"><div><h3>自动封禁记录</h3><p>临时频率限制或路径规则命中的地址；默认只显示生效中，已过期记录保留 90 天后由清理任务删除</p></div><el-select v-model="abuseFilter" size="small" class="abuse-filter" @change="onAbuseFilter"><el-option label="生效中" value="active"/><el-option label="已过期" value="expired"/><el-option label="全部" value="all"/></el-select></div><BulkBar :count="sel.abuse.count" :actions="abuseBulkActions" :running="bulkRunning" @run="(a)=>runBulk(a,sel.abuse,{refresh:loadSecurity})" @clear="sel.abuse.clear()"/><template v-if="!isMobile"><el-table ref="abuseTable" row-key="ip" :data="pagedAbuse" size="small" @selection-change="sel.abuse.onSelectionChange"><el-table-column type="selection" width="44"/><el-table-column prop="ip" label="IP" min-width="150"><template #default="{row}"><span class="mono">{{ row.ip }}</span><el-tag v-if="row.in_blacklist" type="danger" size="small" :title="`已在黑名单：${row.blacklist_entry||row.ip}${row.blacklist_note?`（${row.blacklist_note}）`:''}`">已在黑名单</el-tag></template></el-table-column><el-table-column prop="strikes" label="频率命中"/><el-table-column prop="path_strikes" label="路径命中"/><el-table-column prop="ban_source" label="来源"><template #default="{row}">{{ abuseSourceLabel(row.ban_source) }}</template></el-table-column><el-table-column label="封禁至"><template #default="{row}">{{ row.banned_until?dateTime(row.banned_until):'—' }}</template></el-table-column><el-table-column label="状态" width="90"><template #default="{row}"><el-tag v-if="row.active" type="warning" size="small">生效中</el-tag><el-tag v-else-if="row.banned_until" type="info" size="small">已过期</el-tag><el-tag v-else type="info" size="small">仅计数</el-tag></template></el-table-column><el-table-column label="操作" width="100"><template #default="{row}"><el-button link type="primary" @click="unbanAbuse(row)">{{ row.active?'解除封禁':'清除记录' }}</el-button></template></el-table-column></el-table><el-empty v-if="!pagedAbuse.length" :description="abuseFilter==='active'?'当前没有生效中的自动封禁；可切换到「已过期 / 全部」查看':'暂无记录'"/></template><div v-else class="game-card-list"><div v-for="row in pagedAbuse" :key="row.ip" class="admin-card"><div class="admin-card-pick"><el-checkbox :model-value="sel.abuse.has(row)" @change="sel.abuse.toggle(row)">选择</el-checkbox></div><div class="admin-card-main"><strong class="mono">{{ row.ip }}</strong><el-tag v-if="row.in_blacklist" type="danger" size="small">已在黑名单</el-tag><el-tag v-if="row.active" type="warning" size="small">生效中</el-tag><el-tag v-else-if="row.banned_until" type="info" size="small">已过期</el-tag><el-tag v-else type="info" size="small">仅计数</el-tag><small>频率命中 {{ row.strikes }} · 路径命中 {{ row.path_strikes }} · {{ row.ban_source||'—' }}</small><span class="muted">封禁至 {{ row.banned_until?dateTime(row.banned_until):'—' }}</span></div><div class="admin-card-foot"><span></span><span><el-button link type="primary" @click="unbanAbuse(row)">{{ row.active?'解除封禁':'清除记录' }}</el-button></span></div></div></div><PaginationBar v-model:page="abusePage" v-model:page-size="abusePageSize" :total="abuse.length"/></div>
        <!-- EL 批（docs/ADMIN-EDIT-DIALOG.md EK-1/EK-2）：IP 黑/白名单添加弹窗（IP/备注/确认） -->
        <el-dialog v-model="ipDialog.visible" :title="ipDialog.kind==='black'?'添加 IP 黑名单':'添加 IP 白名单'" width="min(520px, 92vw)"><p class="muted">{{ ipDialog.kind==='black'?'封禁后该 IP 无法访问站点。':'白名单 IP 不受自动频率封禁（审核弹窗「信任」也会加到这里）。' }}</p><el-form label-position="top"><el-form-item label="IP 或 CIDR"><el-input v-model="ipDialog.ip" placeholder="例如 203.0.113.7 或 203.0.113.0/24" @keyup.enter="submitIpDialog"/></el-form-item><el-form-item label="备注（可选）"><el-input v-model="ipDialog.note" maxlength="200" placeholder="备注" @keyup.enter="submitIpDialog"/></el-form-item></el-form><template #footer><el-button @click="ipDialog.visible=false">取消</el-button><el-button :type="ipDialog.kind==='black'?'danger':'primary'" :loading="saving" @click="submitIpDialog">{{ ipDialog.kind==='black'?'封禁':'信任' }}</el-button></template></el-dialog>
      </template>
    </template>

    <!-- 愿望单（BE 批 docs/WISHLIST-SITE-ONLY.md §6；CY 批改为只读：用户私有数据，管理员不可删） -->
    <template v-else-if="section==='wishlist'">
      <div class="module-card"><div class="card-heading"><div><h3>全站愿望单</h3><p>用户私有数据，管理员只读；新增与删除请由用户在前台自行操作。</p></div><el-button :loading="loading" @click="loadWishlists">刷新</el-button></div>
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
    <template v-else-if="section==='settings'">
      <div class="settings-toolbar"><el-input v-model="settingQuery" clearable placeholder="搜索设置项，例如 Steam、代理、SMTP（命中折叠项会自动展开）" @keyup.enter="onSettingsEnter"/><el-checkbox v-model="settingsOnlyChanged">只看非默认</el-checkbox><el-button v-if="theme.storedMode()" text @click="resetTheme">跟随系统</el-button><el-button @click="loadSettings">重新加载</el-button><el-button type="primary" :loading="saving" @click="saveSettings">保存设置</el-button></div>
      <div class="settings-meta">版本 {{ settingsSchema?.version||'—' }} · 配置修订 {{ settingsSchema?.revision||0 }} · 保存后调度器约 15 秒内生效 <span v-if="settingsDirty || proxyDialogDirty" class="dirty-dot">未保存的修改</span></div>
      <el-empty v-if="!filteredGroups.length && settingsSchema" description="没有匹配的设置项"/>
      <el-tabs v-else v-model="activeSettingsTab" class="settings-tabs"><el-tab-pane v-for="group in filteredGroups" :key="group.id" :name="group.id"><template #label><span class="settings-group-title"><strong>{{ group.title }}</strong><span>{{ visibleSettingCount(group.id) }} 项</span></span></template><p v-if="group.description" class="settings-description">{{ group.description }}</p><div v-if="isPlainGroup(group.id)" class="setting-grid"><article v-for="field in fieldsByGroup(group.id)" :key="field.key" class="setting-field" :class="{hit: fieldHit(field)}"><div class="setting-head"><label :for="settingId(field.key)">{{ field.label }}</label><el-tag size="small" effect="plain">{{ sourceLabel(settingsSchema?.sources?.[field.key]) }}</el-tag><el-button link size="small" class="setting-restore" @click="restoreField(field)">恢复默认</el-button></div><div v-if="field.type==='bool'" class="setting-control"><el-switch v-model="settingValues[field.key]" @change="settingsDirty=true"/><span>{{ settingValues[field.key]?'启用':'关闭' }}</span></div><el-select v-else-if="field.type==='enum'" :id="settingId(field.key)" v-model="settingValues[field.key]" @change="settingsDirty=true"><el-option v-for="option in field.options||[]" :key="option" :label="option" :value="option"/></el-select><div v-else-if="field.key==='network.steamProxy'" class="proxy-editor"><div class="proxy-head"><span class="proxy-count"><template v-if="proxySavedCount!=null">已配置 {{ proxySavedCount }} 条<template v-if="!proxySavedCount">（未配置，Steam 走直连/通用代理）</template></template><template v-else>{{ settingsSchema?.secrets?.[field.key]?.hasValue?'已设置（点「编辑」查看并修改）':'尚未设置（Steam 走直连/通用代理）' }}</template></span><el-button text @click="openProxyDialog">编辑</el-button></div></div><div v-else-if="field.key==='network.httpsProxy'||field.key==='network.appSyncProxy'" class="secret-control"><el-tag size="small" :type="settingsSchema?.secrets?.[field.key]?.hasValue?'success':'info'" effect="plain">{{ settingsSchema?.secrets?.[field.key]?.hasValue?'已设置':'尚未设置' }}</el-tag><el-button text type="primary" @click="openSecretDialog(field)">编辑</el-button></div><div v-else-if="field.type==='secret'" class="secret-control"><el-input v-model="settingValues[field.key]" type="password" show-password autocomplete="new-password" :placeholder="secretPlaceholder(field.key)" @input="settingsDirty=true"/><el-button v-if="settingsSchema?.secrets?.[field.key]?.hasValue" text @click="revealSecret(field.key)">查看</el-button><el-checkbox v-if="settingsSchema?.secrets?.[field.key]?.hasValue" v-model="clearSecrets[field.key]" @change="settingsDirty=true">清除</el-checkbox></div><el-input v-else :id="settingId(field.key)" v-model="settingValues[field.key]" :type="field.type==='int'?'number':'text'" :min="field.min" :max="field.max" @input="settingsDirty=true"/><p v-if="field.help" class="setting-help">{{ field.help }}</p><div v-if="field.key!=='network.steamProxy' && field.type==='secret' && settingsSchema?.secrets?.[field.key]?.hasValue" class="setting-help">已保存密钥不会自动回显；留空表示保持原值。</div></article></div><div v-else class="settings-sections"><template v-for="entry in displaySettingsFields(group.id)" :key="entry.k"><div v-if="entry.kind==='cardHead'" class="settings-card-head"><span class="settings-ico">{{ entry.sec.icon }}</span><h3>{{ entry.sec.title }}</h3><span v-if="entry.sec.hint" class="settings-card-tag">{{ entry.sec.hint }}</span><span v-if="entry.sec.enabledKey" class="settings-card-tag" :class="settingValues[entry.sec.enabledKey]?'ok':''">{{ settingValues[entry.sec.enabledKey]?'已启用':'已停用' }}</span><el-switch v-if="entry.sec.enabledKey" v-model="settingValues[entry.sec.enabledKey]" @change="settingsDirty=true"/></div><div v-else-if="entry.kind==='cardBody'" class="settings-card-body"></div><div v-else-if="entry.kind==='rows'" class="setting-rows"><div v-for="row in entry.rows" :key="row.label" class="setting-row" :class="{hit: row.fields.some(f=>fieldHit(f))}"><span class="k">{{ row.label }}</span><template v-for="field in row.fields" :key="field.key"><el-switch v-if="field.type==='bool'" v-model="settingValues[field.key]" @change="settingsDirty=true"/><el-select v-else-if="field.type==='enum'" v-model="settingValues[field.key]" @change="settingsDirty=true"><el-option v-for="o in field.options||[]" :key="o" :label="o" :value="o"/></el-select><el-input v-else v-model="settingValues[field.key]" :type="field.type==='int'?'number':'text'" @input="settingsDirty=true" class="row-input"/><el-button link size="small" class="setting-restore" :title="`恢复 ${field.label} 默认`" @click="restoreField(field)">↺</el-button></template><span class="src">{{ sourceLabel(settingsSchema?.sources?.[row.fields[0].key]) }}</span></div></div><div v-else-if="entry.kind==='grid'" class="setting-grid"><article v-for="field in entry.fields" :key="field.key" class="setting-field" :class="{hit: fieldHit(field)}"><div class="setting-head"><label :for="settingId(field.key)">{{ field.label }}</label><el-tag size="small" effect="plain">{{ sourceLabel(settingsSchema?.sources?.[field.key]) }}</el-tag><el-button link size="small" class="setting-restore" @click="restoreField(field)">恢复默认</el-button></div><div v-if="field.type==='bool'" class="setting-control"><el-switch v-model="settingValues[field.key]" @change="settingsDirty=true"/><span>{{ settingValues[field.key]?'启用':'关闭' }}</span></div><el-select v-else-if="field.type==='enum'" :id="settingId(field.key)" v-model="settingValues[field.key]" @change="settingsDirty=true"><el-option v-for="option in field.options||[]" :key="option" :label="option" :value="option"/></el-select><el-input v-else-if="field.type==='secret'" type="password" show-password autocomplete="new-password" :placeholder="secretPlaceholder(field.key)" @input="settingsDirty=true" v-model="settingValues[field.key]"/><el-input v-else :id="settingId(field.key)" v-model="settingValues[field.key]" :type="field.type==='int'?'number':'text'" :min="field.min" :max="field.max" @input="settingsDirty=true"/><p v-if="field.help" class="setting-help">{{ field.help }}</p></article></div><button v-else-if="entry.kind==='fold'" type="button" class="settings-fold" @click="toggleFold(entry.sec.id)"><span class="arrow">{{ foldOpen(entry.sec.id)?'▾':'▸' }}</span>{{ entry.sec.foldTitle }} <b>{{ entry.count }} 项</b><span v-if="entry.summary" class="sum">{{ entry.summary }}</span></button><div v-else-if="entry.kind==='foldBody'" class="settings-fold-body"><div class="setting-grid"><article v-for="field in entry.fields" :key="field.key" class="setting-field" :class="{hit: fieldHit(field)}"><div class="setting-head"><label :for="settingId(field.key)">{{ field.label }}</label><el-tag size="small" effect="plain">{{ sourceLabel(settingsSchema?.sources?.[field.key]) }}</el-tag><el-button link size="small" class="setting-restore" @click="restoreField(field)">恢复默认</el-button></div><div v-if="field.type==='bool'" class="setting-control"><el-switch v-model="settingValues[field.key]" @change="settingsDirty=true"/><span>{{ settingValues[field.key]?'启用':'关闭' }}</span></div><el-select v-else-if="field.type==='enum'" :id="settingId(field.key)" v-model="settingValues[field.key]" @change="settingsDirty=true"><el-option v-for="option in field.options||[]" :key="option" :label="option" :value="option"/></el-select><el-input v-else-if="field.type==='secret'" type="password" show-password autocomplete="new-password" :placeholder="secretPlaceholder(field.key)" @input="settingsDirty=true" v-model="settingValues[field.key]"/><el-input v-else :id="settingId(field.key)" v-model="settingValues[field.key]" :type="field.type==='int'?'number':'text'" :min="field.min" :max="field.max" @input="settingsDirty=true"/><p v-if="field.help" class="setting-help">{{ field.help }}</p></article></div><div class="settings-foot"><el-button link type="primary" @click="restoreSection(entry.sec)">恢复本组默认</el-button></div></div><div v-else-if="entry.kind==='cardEnd'"></div></template></div></el-tab-pane></el-tabs>
    </template>

    <!-- 统计 -->
    <template v-else-if="section==='stats'">
      <div class="module-tabs"><button :class="{on:statsView==='price'}" @click="statsView='price'">价格变化</button><button :class="{on:statsView==='views'}" @click="statsView='views'">浏览排行</button><button :class="{on:statsView==='assets'}" @click="statsView='assets'">图片与备份</button></div>
      <template v-if="statsView==='price'"><div class="report-heading"><div><h2>价格变化 · 近 24 小时</h2><p>只统计有前次价格快照的变化</p></div><el-button @click="loadStats">刷新数据</el-button><el-button tag="a" href="/api/admin/reports/price.csv?hours=24" target="_blank">导出 CSV</el-button></div><div class="metric-grid"><div v-for="item in priceMetrics" :key="item.label" class="metric-card" :class="item.tone"><span>{{ item.label }}</span><strong>{{ item.value }}</strong></div></div><div class="module-card table-card"><el-table :data="priceRows" stripe><el-table-column prop="name" label="游戏" min-width="220"/><el-table-column prop="platform_name" label="平台" width="140"/><el-table-column label="原价" width="110" align="right"><template #default="{row}">{{ price(row.was) }}</template></el-table-column><el-table-column label="现价" width="110" align="right"><template #default="{row}">{{ price(row.now_price) }}</template></el-table-column><el-table-column label="变化" width="110" align="right"><template #default="{row}"><el-popover placement="left" :width="264" trigger="hover"><template #reference><span class="price-change-cell" :class="row.drop_cents>0?'price-down':'price-up'">{{ row.drop_cents>0?'−':'+' }}{{ Math.round(Math.abs(row.drop_cents)/Math.max(1,row.was)*100) }}%</span></template><PriceSparkline :points="priceSeries[row.game_id]||[]" :current="row.now_price" :currency="(priceSeries[row.game_id]||[])[0]?.currency||'CNY'"/></el-popover></template></el-table-column><el-table-column label="时间" min-width="160"><template #default="{row}">{{ dateTime(row.captured_at) }}</template></el-table-column></el-table><PaginationBar v-model:page="pricePage" v-model:page-size="pricePageSize" :total="priceChanges.length"/></div></template>
      <template v-else-if="statsView==='views'"><div class="module-card table-card"><div class="card-heading padded"><div><h3>浏览排行</h3><p>累计页面访问数据</p></div><el-checkbox v-model="aggregateViews">按游戏聚合</el-checkbox></div><el-table :data="viewRowsPage" stripe><el-table-column prop="name" label="游戏 / 页面" min-width="180"/><el-table-column prop="path" label="路径" min-width="180" show-overflow-tooltip/><el-table-column label="现价" width="100" align="right"><template #default="{row}">{{ price(row.price) }}</template></el-table-column><el-table-column prop="views" label="访问" width="90" align="right"/><el-table-column label="最近访问" min-width="160"><template #default="{row}">{{ dateTime(row.last_at) }}</template></el-table-column></el-table><PaginationBar v-model:page="viewsPage" v-model:page-size="viewsPageSize" :total="viewRows.length"/></div></template>
      <template v-else><div class="module-card cache-card"><div class="card-heading"><div><h3>封面缓存</h3><p>本机缓存的 Steam 封面图片</p></div><span class="heading-actions"><el-button type="warning" plain @click="resetImageMiss">清除缺图缓存</el-button><el-button @click="loadStats">刷新</el-button></span></div><div class="cache-stats"><div><strong>{{ imageStats.images||0 }}</strong><span>张图片</span></div><div><strong>{{ imageStats.games||0 }}</strong><span>款游戏</span></div><div><strong>{{ imageMb }} MB</strong><span>占用空间</span></div></div><small class="muted">{{ imageStats.root||'data/images' }}</small></div><div class="module-card coverage-card"><div class="card-heading padded"><div><h3>图片覆盖看板</h3><p>header_image 覆盖与本地缓存统计；缺图游戏按原因列出（header_image 空 / CDN 404 / 抓取失败）。</p></div><span class="heading-actions"><el-button type="primary" plain :loading="backfillRunning" @click="runImagesBackfill">重同步缺图</el-button><el-button text @click="loadCoverage">刷新</el-button></span></div><div class="metric-grid"><div class="metric-card"><span>游戏总数</span><strong>{{ coverage.stats.totalGames??'—' }}</strong></div><div class="metric-card"><span>有 header_image</span><strong>{{ coverage.stats.withHeaderImage??'—' }}</strong></div><div class="metric-card"><span>本地已缓存</span><strong>{{ coverage.stats.cachedGames??'—' }}<small class="muted">款 / {{ coverage.stats.cachedImages||0 }} 张</small></strong></div><div class="metric-card"><span>缺图</span><strong :class="{'text-danger':(coverage.stats.missing||0)>0}">{{ coverage.stats.missing??'—' }}</strong><small class="muted">空 {{ coverage.stats.missingByReason?.noHeader??0 }} · CDN 404 {{ coverage.stats.missingByReason?.cdn404??0 }} · 抓取失败 {{ coverage.stats.missingByReason?.fetchFailed??0 }}</small></div></div><div class="module-card table-card coverage-list"><el-table :data="coverage.list.items" size="small" stripe><el-table-column label="游戏" min-width="240"><template #default="{row}">{{ row.name }}</template></el-table-column><el-table-column prop="steam_appid" label="AppID" width="100"/><el-table-column label="缺图原因" width="140"><template #default="{row}"><el-tag size="small" :type="row.reason==='CDN 404'?'warning':row.reason==='抓取失败'?'danger':'info'">{{ row.reason }}</el-tag></template></el-table-column></el-table><el-empty v-if="!coverage.list.items?.length" description="暂无缺图游戏" :image-size="48"/><PaginationBar v-model:page="coveragePage" v-model:page-size="coveragePageSize" :total="coverage.list.total||0" @change="loadCoverage"/></div></div><div class="module-card backup-box"><div class="card-heading"><div><h3>数据备份</h3><p>核心表压缩备份，保留最近 7 份</p></div><el-button type="primary" :loading="saving" @click="createBackup">立即备份</el-button></div><div v-for="b in pagedBackups" :key="b.name" class="backup-row"><span>{{ b.name }}</span><span>{{ (b.size/1024/1024).toFixed(2) }} MB</span></div><small v-if="!backups.length" class="muted">还没有备份</small><PaginationBar v-model:page="backupPage" v-model:page-size="backupPageSize" :total="backups.length"/></div></template>
    </template>

    <!-- 申诉管理（O 批，docs/APPEAL-SYSTEM.md §5） -->
    <AppealsAdmin v-else-if="section==='appeals'"/>
      <!-- 批量封禁设备：时长沿用单条弹窗的 radio（复用其 UI 约定），执行仍走统一批量接口 -->
      <el-dialog v-model="bulkDeviceBan.visible" title="批量封禁设备" width="min(420px, 92vw)"><p class="muted">将对已选的 {{ sel.devices.count }} 个设备指纹生效；换 IP 也会命中（白名单 IP 除外）。</p><el-radio-group v-model="bulkDeviceBan.minutes"><el-radio :value="10">10 分钟</el-radio><el-radio :value="60">1 小时</el-radio><el-radio :value="1440">1 天</el-radio><el-radio :value="'permanent'">永久</el-radio></el-radio-group><template #footer><el-button @click="bulkDeviceBan.visible=false">取消</el-button><el-button type="danger" :loading="bulkRunning==='ban'" @click="submitBulkDeviceBan">确认封禁</el-button></template></el-dialog>
      <!-- EL 批（docs/ADMIN-EDIT-DIALOG.md EK-4）：Steam 专用代理内联编辑器改为弹窗（列表增删/排序/健康表/保存回写） -->
      <el-dialog v-model="proxyDialogOpen" title="Steam 专用代理" width="min(680px, 92vw)" :before-close="closeProxyDialog"><p class="muted">只作用于 Steam 域名；可配多条（按顺序尝试、最多 10 条），仅支持 http/https。保存后调度器约 15 秒内生效。</p><div class="proxy-row" v-for="(row,i) in proxyList" :key="i"><span class="proxy-index">{{ i+1 }}</span><el-input v-model="row.value" placeholder="http://127.0.0.1:7890" autocomplete="off" @input="markProxyDirty"/><el-button text size="small" :disabled="i===0" @click="moveProxy(i,-1)">上移</el-button><el-button text size="small" :disabled="i===proxyList.length-1" @click="moveProxy(i,1)">下移</el-button><el-button text size="small" type="danger" @click="removeProxy(i)">删除</el-button></div><div class="proxy-actions"><el-button text type="primary" size="small" :disabled="proxyList.length>=10" @click="addProxy">添加一条</el-button><el-button text type="danger" size="small" :disabled="!proxyList.length" @click="clearProxyList">清空全部</el-button><span v-if="proxyList.length>=10" class="muted">已达上限 10 条</span></div><div class="proxy-health"><div class="proxy-health-head"><strong>健康状态</strong><el-button text size="small" :loading="proxyProbing" @click="probeProxies">立即检测</el-button><el-button text size="small" @click="loadProxyHealth">刷新</el-button></div><el-table v-if="proxyHealth.proxies?.length" :data="proxyHealth.proxies" size="small" stripe><el-table-column prop="index" label="#" width="46"/><el-table-column prop="proxy" label="代理" min-width="190" show-overflow-tooltip/><el-table-column label="状态" width="130"><template #default="{row}"><el-tag :type="proxyStateType(row)" size="small">{{ proxyStateText(row) }}</el-tag></template></el-table-column><el-table-column label="最近检测" width="150"><template #default="{row}">{{ row.probeAt?dateTime(row.probeAt):"—" }}</template></el-table-column><el-table-column prop="fails" label="连续失败" width="82" align="right"/><el-table-column label="冷却到" min-width="150"><template #default="{row}">{{ row.downUntil?dateTime(row.downUntil):'—' }}</template></el-table-column><el-table-column label="最近错误" min-width="140" show-overflow-tooltip><template #default="{row}">{{ row.lastError || row.probeError || "—" }}</template></el-table-column></el-table><p v-else class="muted">未配置代理，或还没有健康记录</p></div><template #footer><el-button @click="cancelProxyDialog">取消</el-button><el-button type="primary" :loading="proxySaving" @click="onSaveProxyDialog">保存</el-button></template></el-dialog>
      <!-- EL 批（docs/ADMIN-EDIT-DIALOG.md EK-5）：通用出网代理 / App 同步专用代理——编辑按钮 + 弹窗（掩码显示、http/https 校验） -->
      <el-dialog v-model="secretDialog.visible" :title="secretDialog.field?.label" width="min(520px, 92vw)"><p class="muted">{{ secretDialog.field?.help }}</p><el-form label-position="top"><el-form-item :label="secretDialog.field?.label"><el-input v-model="secretDialog.value" type="password" show-password autocomplete="new-password" :placeholder="secretDialog.hasValue?'已设置，留空保持原值':'尚未设置'" @keyup.enter="saveSecretDialog"/></el-form-item></el-form><div class="secret-dialog-actions"><el-button v-if="secretDialog.hasValue" text @click="revealSecretInDialog">查看当前值</el-button><el-checkbox v-if="secretDialog.hasValue" v-model="secretDialog.clear">清除该代理（留空直连）</el-checkbox></div><template #footer><el-button @click="secretDialog.visible=false">取消</el-button><el-button type="primary" :loading="secretSaving" @click="saveSecretDialog">保存</el-button></template></el-dialog>
      <BulkResultDialog v-model="bulkResult.visible" :result="bulkResult.result"/>
      <GameDetailDialog v-model="gameDetail.visible" :appid="gameDetail.appid" :row="gameDetail.row"/>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import PaginationBar from '../components/PaginationBar.vue';
import BulkBar from '../components/BulkBar.vue';
import BulkResultDialog from '../components/BulkResultDialog.vue';
import { useBulkSelection, promptBulkConfirm } from '../composables/useBulkSelection.js';
// BM-3（docs/SESSION-MANAGEMENT.md §8.4.3）：401 统一软跳登录页（不再 window.location.href 整页跳）
import { redirectToLogin } from '../utils/session.js';
import { useListPagination } from '../composables/useListPagination.js';
import { useTheme } from '../composables/useTheme.js';
import { fmtDateTime as dateTime } from '../utils/siteTime.js';
import { yuanAmount } from '../utils/money.js';
import { isMailSettingKey } from '../utils/settings.js';
import { copyText } from '../utils/clipboard.js';
import { compareIp } from '../utils/ipSort.js';
import { nameCopyText } from '../utils/gameNames.js';
import GameLinksDrawer from '../components/GameLinksDrawer.vue';
import GameDetailDialog from '../components/GameDetailDialog.vue';
import AnnouncementDrawer from '../components/AnnouncementDrawer.vue';
import AppealsAdmin from '../components/AppealsAdmin.vue';
import PriceSparkline from '../components/PriceSparkline.vue';
import CoverPlaceholder from '../components/CoverPlaceholder.vue';
import { CopyDocument, Check, ArrowDown } from '@element-plus/icons-vue';
import AlignAdmin from '../components/AlignAdmin.vue';
import { registerUnsavedSource } from '../composables/useUnsavedGuard.js';

const props=defineProps({section:{type:String,required:true}});
const router=useRouter();const route=useRoute();
const loading=ref(false),saving=ref(false),error=ref('');
const platforms=[{value:'steam',label:'Steam'},{value:'sonkwo',label:'杉果'},{value:'gog',label:'GOG'},{value:'humble',label:'Humble'},{value:'itad',label:'ITAD'},{value:'steampy',label:'SteamPy'}];
// 窄屏（手机）时游戏目录/访问记录改用卡片式渲染（docs/MOBILE-FIX.md §3D）：
// 响应式监听 760 断点（含窗口缩放/旋转）；其余表格由 .m-console 的滑动提示覆盖
const mobileQuery=typeof window!=='undefined'&&window.matchMedia?window.matchMedia('(max-width: 760px)'):null;
const isMobile=ref(Boolean(mobileQuery&&mobileQuery.matches));
function onMobileChange(e){isMobile.value=e.matches;}
const theme=useTheme();
function resetTheme(){ theme.resetToSystem(); fetch('/api/prefs',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({theme:null})}).catch(()=>{}); }
const games=ref([]),gameStats=ref({}),gameQuery=ref(''),gamePlatform=ref(''),gameStatus=ref(''),gameRating=ref(''),gameOffers=ref(''),gamePage=ref(1),gamePageSize=ref(20),gamePages=ref(1),gameTotal=ref(0),gameView=ref('directory'),gameDialog=ref(false),activeGame=ref(null),gameDescription=ref(''),gameBlocked=ref(false),mergeDialog=ref(false),mergeForm=reactive({from:'',to:''});
const visitorTabs=[{value:'visits',label:'访问明细'},{value:'review',label:'异常审核'},{value:'security',label:'封禁与白名单'},{value:'devices',label:'设备'}],visitorView=ref('visits'),visitorFilter=ref('visits'),visitorIp=ref(''),visitorPath=ref(''),visitors=ref([]),visitorSummary=ref({}),visitorPage=ref(1),visitorPageSize=ref(20),visitorTotal=ref(0),reviews=ref([]),reviewStatus=ref('pending'),blacklist=ref([]),whitelist=ref([]),abuse=ref([]),devices=ref([]),deviceBans=ref([]),deviceBanDialog=reactive({visible:false,row:null,duration:60});
// BH 批（docs/VISIT-IP-STATS.md）：访问明细默认 IP 统计视图、可切回明细；时间窗 1/7/30 天
const visitMode=ref('ip'), visitDays=ref(7), ipRows=ref([]), ipTotal=ref(0), ipPage=ref(1), ipPageSize=ref(20), ipQuery=ref(''), ipStatus=ref('all'), ipSort=ref('visits'), ipDetails=reactive({});
async function loadVisitorsByIp(page=ipPage.value){ipPage.value=page;loading.value=true;try{const qs=new URLSearchParams({days:String(visitDays.value),page:String(page),pageSize:String(ipPageSize.value),sort:ipSort.value,status:ipStatus.value});if(ipQuery.value.trim())qs.set('q',ipQuery.value.trim());const d=await api(`/api/admin/visitors/by-ip?${qs}`);ipRows.value=d.items||[];ipTotal.value=d.total||0;}catch(e){notifyError(e);}finally{loading.value=false;}}
// BI 批：自动临时封禁剩余时间（小时级显示「h 小时 m 分」，否则 m:ss）
function banLeft(row){if(!row.ban_until)return '';const ms=Date.parse(row.ban_until)-Date.now();if(!(ms>0))return '';const h=Math.floor(ms/3600000),m=Math.floor(ms%3600000/60000),s=Math.floor(ms%60000/1000);return h?'剩余 '+h+' 小时 '+m+' 分':'剩余 '+m+':'+String(s).padStart(2,'0');}
async function onIpExpand(row){if(ipDetails[row.ip])return;try{ipDetails[row.ip]=await api(`/api/admin/visitors/by-ip/${encodeURIComponent(row.ip)}?days=${visitDays.value}`);}catch(e){notifyError(e);}}
function onIpSortChange({prop,order}){ipSort.value=!order?'visits':prop==='ip'?'ip':prop==='last_at'?'lastAt':'visits';loadVisitorsByIp(1);}
function onVisitDaysChange(){Object.keys(ipDetails).forEach((k)=>delete ipDetails[k]);if(visitMode.value==='ip')loadVisitorsByIp(1);else loadVisitors(1);}
function switchVisitMode(mode){visitMode.value=mode;if(mode==='ip')loadVisitorsByIp(1);else loadVisitors(1);}
const announcements=ref([]);
// AT 批（docs/ADMIN-CONSOLE-IA.md §3/§7）：新建/编辑通知改弹窗（表单与未保存守卫在 AnnouncementDrawer 内；EL 批由抽屉改弹窗）
const announcementDrawer=reactive({visible:false,edit:null});
const settingsSchema=ref(null),settingValues=reactive({}),clearSecrets=reactive({}),settingQuery=ref(''),activeSettingsTab=ref(''),settingsDirty=ref(false);
const priceReport=ref({}),priceSeries=ref({}),views=ref([]),imageStats=ref({}),backups=ref([]),aggregateViews=ref(false),statsView=ref('price');
// EC 批（docs/IMAGE-COVERAGE.md §8 EC-1）：图片覆盖看板状态（stats → 图片与备份）
const coverage=ref({stats:{},list:{items:[],total:0}}),coveragePage=ref(1),coveragePageSize=ref(10),backfillRunning=ref(false);
// AQ 批（docs/ADMIN-REVIEW-LISTS.md §3）：两个列表的排序状态（localStorage 持久化）
// AQ 批（docs/ADMIN-REVIEW-LISTS.md §3）：访问明细排序（localStorage 持久化）；异常审核的明细表排序随
// AX 批（§4.5）删除——合并视图是唯一视图，表头排序只保留合并视图的 admin.reviewMergeSort。
const SORT_STORAGE = { visitor: 'admin.visitorSort' };
function loadSortState(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    if (v && typeof v.prop === 'string' && (v.order === 'ascending' || v.order === 'descending')) return v;
  } catch { /* 坏数据回落默认 */ }
  return fallback;
}
function saveSortState(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 隐私模式忽略 */ } }
const visitorSort = ref(loadSortState(SORT_STORAGE.visitor, { prop: 'created_at', order: 'descending' }));
const VISITOR_SORT_FIELD = { created_at: 'time', ip: 'ip', status: 'status' };
function visitorSortParams() {
  const { prop, order } = visitorSort.value;
  return { sort: VISITOR_SORT_FIELD[prop] || 'time', order: order === 'ascending' ? 'asc' : 'desc' };
}
function onVisitorSortChange({ prop, order }) {
  visitorSort.value = prop && order ? { prop, order } : { prop: 'created_at', order: 'descending' };
  saveSortState(SORT_STORAGE.visitor, visitorSort.value);
  loadVisitors(1);
}
// AX 批（docs/ADMIN-REVIEW-LISTS.md §4.5）：异常审核合并视图为默认且唯一视图——
// 不再有「按 IP 合并」开关及其 localStorage 键，明细表与逐条处置已删除。
const mergedPicked = ref(new Set());
function toggleMergedPick(row) { const next = new Set(mergedPicked.value); if (next.has(row.key)) next.delete(row.key); else next.add(row.key); mergedPicked.value = next; }
const mergedSort = ref(loadSortState('admin.reviewMergeSort', { prop: 'last_seen', order: 'descending' }));
function onMergedSortChange({ prop, order }) {
  mergedSort.value = prop && order ? { prop, order } : { prop: 'last_seen', order: 'descending' };
  saveSortState('admin.reviewMergeSort', mergedSort.value);
  mergedPager.page.value = 1;
}
const sortedMergedReviews = computed(() => {
  const byIp = new Map();
  for (const r of reviews.value) {
    const key = r.ip || '(空)';
    if (!byIp.has(key)) byIp.set(key, { ip: r.ip || '', rows: [] });
    byIp.get(key).rows.push(r);
  }
  const list = [];
  for (const g of byIp.values()) {
    const pending = g.rows.filter((r) => r.status === 'pending');
    const statuses = new Set(g.rows.map((r) => r.status));
    const ruleMap = new Map();
    for (const r of g.rows) ruleMap.set(r.rule, (ruleMap.get(r.rule) || 0) + 1);
    const days = g.rows.map((r) => r.last_seen || '').filter(Boolean).sort();
    const firsts = g.rows.map((r) => r.created_at || '').filter(Boolean).sort();
    list.push({
      key: g.ip || '(空)',
      ip: g.ip,
      rows: g.rows,
      rules: [...ruleMap.entries()].map(([rule, n]) => ({ rule, n })).sort((a, b) => b.n - a.n),
      ruleCount: ruleMap.size,
      hitsTotal: g.rows.reduce((s, r) => s + (Number(r.hits) || 0), 0),
      firstSeen: firsts[0] || '',
      lastSeen: days[days.length - 1] || '',
      devices: new Set(g.rows.map((r) => r.fingerprint || r.device_id).filter(Boolean)).size,
      status: pending.length ? 'pending' : (statuses.size === 1 && statuses.has('auto_banned') ? 'auto_banned' : 'partial'),
      pendingIds: pending.map((r) => r.id),
      pendingCount: pending.length,
    });
  }
  const { prop, order } = mergedSort.value;
  const dir = order === 'ascending' ? 1 : -1;
  return list.sort((a, b) => {
    let va; let vb;
    if (prop === 'ip') return compareIp(a.ip, b.ip) * dir;
    if (prop === 'hitsTotal') { va = a.hitsTotal; vb = b.hitsTotal; }
    else if (prop === 'ruleCount') { va = a.ruleCount; vb = b.ruleCount; }
    else { va = a.lastSeen; vb = b.lastSeen; }
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return 0;
  });
});
const mergedPager = useListPagination(sortedMergedReviews);
const pagedMergedReviews = mergedPager.items;
const mergedPickedCount = computed(() => sortedMergedReviews.value.filter((g) => mergedPicked.value.has(g.key)).reduce((s, g) => s + g.pendingCount, 0));
const mergedPage = mergedPager.page, mergedPageSize = mergedPager.pageSize;
async function mergedAct(row, actionKey) {
  const labels = { 'approve-ip': '封 IP', 'approve-device': '封设备', reject: '忽略' };
  const label = labels[actionKey];
  let ids = row.pendingIds.slice();
  if (actionKey === 'approve-device') {
    const seen = new Set();
    ids = row.rows.filter((r) => r.status === 'pending' && r.fingerprint && !seen.has(r.fingerprint) && seen.add(r.fingerprint)).map((r) => r.id);
  }
  if (!ids.length) return ElMessage.warning('该 IP 没有可处理的待审记录');
  let confirmCount = null;
  try {
    const { value } = await ElMessageBox.prompt(
      `将处理 ${row.ip} 的 ${row.ruleCount} 条规则 / ${row.hitsTotal} 次命中 / ${row.devices} 个设备（共 ${ids.length} 条记录）执行「${label}」，请再次输入这个数字确认`,
      `确认${label}`,
      { inputPattern: /^\d+$/, inputErrorMessage: '请输入数字', confirmButtonText: '确认执行', cancelButtonText: '取消', type: 'warning' },
    );
    if (Number(String(value).trim()) !== Number(ids.length)) { ElMessage.warning('输入的条数与待处理记录数不一致，已取消'); return; }
    confirmCount = Number(ids.length);
  } catch (e) { if (e === 'cancel' || e === 'close') return; throw e; }
  bulkRunning.value = actionKey;
  try {
    const d = await api('/api/admin/bulk', json('POST', { target: 'reviews', action: actionKey, keys: ids, confirmCount }));
    bulkResult.result = d; bulkResult.visible = true;
    mergedPicked.value = new Set();
    await loadReviews();
  } catch (e) { notifyError(e); } finally { bulkRunning.value = ''; }
}
async function runMergedBulk(actionKey) {
  const groups = sortedMergedReviews.value.filter((g) => mergedPicked.value.has(g.key));
  if (!groups.length) return ElMessage.warning('请先勾选要操作的 IP');
  let ids = [];
  for (const g of groups) ids.push(...g.pendingIds);
  if (actionKey === 'approve-device') {
    const seen = new Set();
    const all = groups.flatMap((g) => g.rows);
    ids = all.filter((r) => r.status === 'pending' && r.fingerprint && !seen.has(r.fingerprint) && seen.add(r.fingerprint)).map((r) => r.id);
  }
  if (!ids.length) return ElMessage.warning('所选 IP 没有可处理的待审记录');
  const labels = { 'approve-ip': '封 IP', 'approve-device': '封设备', reject: '忽略' };
  const label = labels[actionKey];
  const confirmCount = await promptBulkConfirm(ids.length, label);
  if (confirmCount == null) return;
  bulkRunning.value = actionKey;
  try {
    const d = await api('/api/admin/bulk', json('POST', { target: 'reviews', action: actionKey, keys: ids, confirmCount }));
    bulkResult.result = d; bulkResult.visible = true;
    mergedPicked.value = new Set();
    await loadReviews();
  } catch (e) { notifyError(e); } finally { bulkRunning.value = ''; }
}
const blacklistPager=useListPagination(blacklist), whitelistPager=useListPagination(whitelist), abusePager=useListPagination(abuse), announcementsPager=useListPagination(announcements), backupsPager=useListPagination(backups), devicesPager=useListPagination(devices), deviceBansPager=useListPagination(deviceBans);
const pagedBlacklist=blacklistPager.items,blacklistPage=blacklistPager.page,blacklistPageSize=blacklistPager.pageSize;
const pagedWhitelist=whitelistPager.items,whitelistPage=whitelistPager.page,whitelistPageSize=whitelistPager.pageSize;
const pagedAbuse=abusePager.items,abusePage=abusePager.page,abusePageSize=abusePager.pageSize;
const pagedDevices=devicesPager.items,devicesPage=devicesPager.page,devicesPageSize=devicesPager.pageSize;
const pagedDeviceBans=deviceBansPager.items,deviceBansPage=deviceBansPager.page,deviceBansPageSize=deviceBansPager.pageSize;
// ---- 批量操作（docs/ADMIN-BULK-ACTIONS.md）：每张表一个 table ref + 一份多选状态 ----
// sel.* 用 reactive 包一层，模板里才能直接写 sel.games.count（reactive 会展开内部 ref）。
const gamesTable=ref(null),visitorsTable=ref(null),blacklistTable=ref(null),whitelistTable=ref(null),abuseTable=ref(null),devicesTable=ref(null),deviceBansTable=ref(null);
const sel={
  games:reactive(useBulkSelection((r)=>r.id,gamesTable)),
  visitors:reactive(useBulkSelection((r)=>r.ip,visitorsTable)),
  announcements:reactive(useBulkSelection((r)=>r.id,null)),
  blacklist:reactive(useBulkSelection((r)=>r.ip,blacklistTable)),
  whitelist:reactive(useBulkSelection((r)=>r.ip,whitelistTable)),
  abuse:reactive(useBulkSelection((r)=>r.ip,abuseTable)),
  devices:reactive(useBulkSelection((r)=>r.fingerprint,devicesTable)),
  deviceBans:reactive(useBulkSelection((r)=>r.fingerprint,deviceBansTable)),
};
const bulkResult=reactive({visible:false,result:null}),bulkRunning=ref('');
const gamesBulkActions=[{key:'block',label:'禁用',target:'games',action:'block',risk:'high'},{key:'unblock',label:'启用',target:'games',action:'unblock'},{key:'delete',label:'删除（进回收站）',target:'games',action:'delete',risk:'high'}];
const visitorsBulkActions=[{key:'ban-ip',label:'封 IP',target:'visitors',action:'ban-ip',risk:'high'},{key:'trust',label:'信任（加白）',target:'visitors',action:'trust'}];
const announcementsBulkActions=[{key:'activate',label:'启用',target:'announcements',action:'activate'},{key:'deactivate',label:'停用',target:'announcements',action:'deactivate'},{key:'delete',label:'删除',target:'announcements',action:'delete',risk:'high'}];
// CY 批（docs/DATA-ISOLATION.md §3）：wishlistBulkActions 已移除——愿望单属用户私有数据，管理员只读
const blacklistBulkActions=[{key:'unban',label:'解封',target:'blacklist',action:'unban'}];
const whitelistBulkActions=[{key:'remove',label:'移出白名单',target:'whitelist',action:'remove'}];
const abuseBulkActions=[{key:'unban',label:'解除临时封禁',target:'abuse',action:'unban'}];
const deviceBansBulkActions=[{key:'unban',label:'解封',target:'device-bans',action:'unban'}];
const devicesBulkActions=[{key:'ban',label:'封禁',target:'devices',action:'ban',risk:'high'}];
const bulkDeviceBan=reactive({visible:false,minutes:60});
// ---- 站点通知列表（新建/编辑走 AnnouncementDrawer；批量操作记录已搬进操作日志，AT 批）----
const pagedAnnouncements=announcementsPager.items,announcementsPage=announcementsPager.page,announcementsPageSize=announcementsPager.pageSize;
const pagedPriceChanges=useListPagination(computed(()=>[...(priceReport.value.topDrops||[]),...(priceReport.value.topRises||[])]));
const pagedBackups=backupsPager.items;
const pagedViews=useListPagination(computed(()=>{const rows=views.value.slice();if(!aggregateViews.value)return rows;const map=new Map();for(const v of rows){const key=v.name||v.path;const current=map.get(key)||{name:v.name,path:'多个页面',views:0,last_at:v.last_at};current.views+=v.views;if(v.last_at>current.last_at)current.last_at=v.last_at;map.set(key,current);}return [...map.values()].sort((a,b)=>b.views-a.views);}));
const pricePage=pagedPriceChanges.page,pricePageSize=pagedPriceChanges.pageSize,priceRows=pagedPriceChanges.items;
const backupPage=backupsPager.page,backupPageSize=backupsPager.pageSize;
const viewsPage=pagedViews.page,viewsPageSize=pagedViews.pageSize,viewRowsPage=pagedViews.items;
const syncStatus=ref(null),backfillProgress=ref(null);
const TASK_META={'steam-prices':{label:'价格刷新'},catalog:{label:'目录同步'},backfill:{label:'增量回填'},rename:{label:'重写名字'},heat:{label:'热度回填'},itad:{label:'ITAD 匹配'},gog:{label:'GOG 匹配'},humble:{label:'Humble 匹配'},sonkwo:{label:'杉果同步'}};
const TASK_ORDER=['steam-prices','catalog','backfill','rename','heat','itad','gog','humble','sonkwo'];
const fmtInterval=(m)=>{const n=Number(m)||0;if(n<60)return `每 ${n} 分钟`;if(n<1440)return `每 ${Math.round(n/60)} 小时`;const d=Math.round(n/1440);return d===7?'每周':`每 ${d} 天`;};
const runningJob=computed(()=>{const st=syncStatus.value;if(!st?.running)return '';return String(st?.run?.mode||'');});
const taskRows=computed(()=>{const jobs=syncStatus.value?.schedule?.jobs||[];const p=syncStatus.value?.backfillProgress||null;const ss=syncStatus.value?.sourceStats?.byPlatform||{};return TASK_ORDER.map(name=>{const j=jobs.find(x=>x.name===name)||{};const partial=name==='backfill'&&j.lastResult==='partial'?{done:p?.done||0,limit:p?.limit||0,remaining:p?.remaining||0,count429:p?.count429||0,last429At:p?.last429At||null,etaDays:p?.done>0?Math.max(1,Math.round((p?.remaining||0)/p.done)):null}:null;const s=ss[name]||null;return {name,label:TASK_META[name].label,freq:fmtInterval(j.intervalMin),lastRunAt:j.lastRunAt||null,nextRunAt:j.nextRunAt||null,openUntil:j.openUntil||null,failures:j.failures||0,lastElapsedMs:j.lastElapsedMs??null,lastResult:j.lastResult||null,lastError:j.lastError||null,waitingFor:j.waitingFor||null,retryAt:j.retryAt||null,estimate:j.estimate||null,partial,stats:s};});});
// BL 批（docs/BACKFILL-THROUGHPUT.md §3.4）：任务卡 partial 观测（hover 详情 / 失败原因 / 重试时间）
function fmtHM(v){if(!v)return '';try{const d=new Date(v);return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');}catch{return '';}}
function partialTitle(row){const p=row.partial;if(!p)return '';const eta=p.etaDays?` · 预计约 ${p.etaDays} 天`:` · 剩余约 ${p.remaining}`;return `HTTP 429 · 已处理 ${p.done}/${p.limit}${eta}`;}
function partialReason(row){const p=row.partial;if(!p)return row.lastError||'—';const t=p.last429At?fmtHM(p.last429At):'';return `429 累计 ${p.count429} 次${t?` · 最近 ${t}`:''}`;}
// AC1：该有但没有的任务（缺 STEAM_API_KEY / 被 *_ENABLED=0 关闭），后台显式提示
const syncWarnings=computed(()=>syncStatus.value?.warnings||[]);
function fmtDur(ms){if(ms==null)return '—';const s=Math.round(ms/1000);if(s<60)return s+' 秒';const m=Math.floor(s/60);if(m<60)return m+' 分';const h=Math.floor(m/60);return h+' 小时 '+(m%60)+' 分';}
// B3 批（docs/DESIGN-AUDIT.md B3）：任务卡「实际 vs 估算」——估算取实测（sync_runs 平均），无实测回落理论值并标注
function estimateText(row){const e=row.estimate;if(!e)return '—';const sec=e.obsSec??e.estSec;return fmtDur(Math.round(sec*1000))+(e.obsSec==null?'（理论）':'');}
function deltaText(row){if(row.lastElapsedMs==null||!row.estimate)return null;const est=(row.estimate.obsSec??row.estimate.estSec)*1000;const d=row.lastElapsedMs-Math.round(est);const sign=d>=0?'+':'-';return sign+fmtDur(Math.abs(d));}
function estimateOver(row){if(row.lastElapsedMs==null||!row.estimate)return false;return row.lastElapsedMs>(row.estimate.obsSec??row.estimate.estSec)*1000;}
function api(path,options={}){return fetch(path,{credentials:'same-origin',...options,headers:{'content-type':'application/json',...(options.headers||{})}}).then(async r=>{const t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch{}if(r.status===401){redirectToLogin();throw new Error(d.error||'登录已过期');}if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);return d;});}
function json(method,body){return {method,body:JSON.stringify(body)};}
function price(cents){return cents==null?'—':`¥${yuanAmount(cents)}`;}
function notifyError(e){ElMessage.error(e?.message||String(e));}async function run(action){saving.value=true;try{await action();}catch(e){notifyError(e);}finally{saving.value=false;}}
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
function openBulkDeviceBan(){if(!sel.devices.count)return ElMessage.warning('请先勾选设备');bulkDeviceBan.minutes=60;bulkDeviceBan.visible=true;}
async function submitBulkDeviceBan(){
  bulkDeviceBan.visible=false;
  const options={minutes:bulkDeviceBan.minutes==='permanent'?0:Number(bulkDeviceBan.minutes)};
  await runBulk({key:'ban',label:'封禁设备',target:'devices',action:'ban',risk:'high'},sel.devices,{options,refresh:loadDevices});
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
// 状态分项口径见 docs/STEAM-SYNC-STATUS-AND-RATING.md §4；分级筛选见 §13.2。
const activeMetric=computed(()=>gameOffers.value==='priced'?'offers':gameRating.value?gameRating.value:gameStatus.value?gameStatus.value:'all');
const METRIC_TARGETS={all:{},pending:{status:'pending'},synced:{status:'synced'},free:{status:'free'},coming_soon:{status:'coming_soon'},region_locked:{status:'region_locked'},no_price:{status:'no_price'},not_found:{status:'not_found'},other:{status:'other'},adult:{rating:'adult'},mature:{rating:'mature'},offers:{offers:'priced'}};
function clickMetric(key){
  if(key==='deleted'){router.push({path:'/console',query:{section:'recycle'}});return;}
  const target=METRIC_TARGETS[key];
  if(!target)return;
  if(activeMetric.value===key){gameStatus.value='';gameRating.value='';gameOffers.value='';}
  else{gameStatus.value=target.status||'';gameRating.value=target.rating||'';gameOffers.value=target.offers||'';}
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

async function loadVisitors(page=visitorPage.value){sel.visitors.clear();loading.value=true;visitorPage.value=page;try{const qs=new URLSearchParams({page:String(page),pageSize:String(visitorPageSize.value),filter:visitorFilter.value,ip:visitorIp.value.trim(),path:visitorPath.value.trim(),...visitorSortParams()});const d=await api(`/api/admin/visitors?${qs}`);visitors.value=d.rows||[];visitorTotal.value=d.total||0;visitorSummary.value=d.summary||{};}catch(e){notifyError(e);}finally{loading.value=false;}}
async function loadReviews(){mergedPicked.value=new Set();loading.value=true;try{const d=await api(`/api/admin/reviews?status=${reviewStatus.value}`);reviews.value=d.reviews||[];}catch(e){notifyError(e);}finally{loading.value=false;}}
// CF 批（docs/ADMIN-UX-SECURITY.md §4）：自动封禁来源 → 可读标签（含四类硬规则来源）
function abuseSourceLabel(s){const m={'rate':'频率超限','rate-day':'频率超限（当天）','path':'路径规则','manual:temp':'人工临时封','auto:path-probe':'漏洞路径探测','auto:credential':'登录凭据爆破','auto:extreme-rate':'极端频率','auto:ua-list':'异常 UA 名单'};return m[s]||s||'—';}
// CF 批（docs/ADMIN-UX-SECURITY.md §4）：单条审核四操作——临时封（10min/1h/1d）/永久封/信任/忽略
async function reviewAct(id,action,minutes){try{const r=await fetch('/api/admin/reviews/act',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({id,action,minutes})});const d=await r.json().catch(()=>({}));if(!r.ok){ElMessage.error(d.error||`HTTP ${r.status}`);return;}ElMessage.success('已处理');await loadReviews();}catch(e){notifyError(e);}}
// BJ 批 B1：自动封禁记录筛选（生效中=默认 / 已过期 / 全部），切换回第 1 页
const abuseFilter=ref('active');
function onAbuseFilter(){abusePage.value=1;loadSecurity();}
async function loadSecurity(){sel.blacklist.clear();sel.whitelist.clear();sel.abuse.clear();loading.value=true;try{const [b,w,a]=await Promise.all([api('/api/admin/blacklist'),api('/api/admin/whitelist'),api(`/api/admin/abuse?limit=200&status=${abuseFilter.value}`)]);blacklist.value=b.ips||[];whitelist.value=w.ips||[];abuse.value=a.abuse||[];}catch(e){notifyError(e);}finally{loading.value=false;}}
function loadVisitorView(){if(visitorView.value==='visits'){if(visitMode.value==='ip')loadVisitorsByIp(1);else loadVisitors(1);}else if(visitorView.value==='review')loadReviews();else if(visitorView.value==='devices')loadDevices();else loadSecurity();}
async function loadDevices(){sel.devices.clear();sel.deviceBans.clear();loading.value=true;try{const [d,b]=await Promise.all([api('/api/admin/devices?limit=100'),api('/api/admin/device-bans')]);devices.value=d.devices||[];deviceBans.value=b.bans||[];}catch(e){notifyError(e);}finally{loading.value=false;}}
function openDeviceBan(row){deviceBanDialog.visible=true;deviceBanDialog.row=row;deviceBanDialog.duration=60;}
async function banDevice(){const row=deviceBanDialog.row;if(!row?.fingerprint)return;await run(async()=>{await api('/api/admin/devices/ban',json('POST',{fingerprint:row.fingerprint,deviceId:row.deviceId,minutes:deviceBanDialog.duration==='permanent'?0:Number(deviceBanDialog.duration)}));deviceBanDialog.visible=false;deviceBanDialog.row=null;ElMessage.success('设备已封禁');await loadDevices();});}
async function unbanDevice(row){try{await ElMessageBox.confirm(`解封设备指纹 ${String(row.fingerprint).slice(0,12)}…？解封后该设备恢复访问。`,'确认解封',{type:'warning'});await run(async()=>{await api(`/api/admin/device-bans/${encodeURIComponent(row.fingerprint)}`,json('DELETE',{}));ElMessage.success('已解封');await loadDevices();});}catch(e){if(e!=='cancel'&&e!=='close')notifyError(e);}}
async function mergeGames(){if(!mergeForm.from||!mergeForm.to)return ElMessage.warning('请填写源与目标 AppID');const fromAppid=Number(mergeForm.from),toAppid=Number(mergeForm.to);if(!Number.isFinite(fromAppid)||!Number.isFinite(toAppid))return ElMessage.warning('AppID 必须是数字');await run(async()=>{const d=await api('/api/admin/games/merge',json('POST',{fromAppid,toAppid}));const r=d.result||{};if(!r.merged)throw new Error({source_missing:'源游戏不存在',target_missing:'目标游戏不存在'}[r.reason]||'合并失败');mergeDialog.value=false;mergeForm.from='';mergeForm.to='';ElMessage.success(`合并完成：迁移 ${r.moved??0} 条报价，去重丢弃 ${r.dropped??0} 条`);await loadGames(1);});}
async function banIp(ip){try{const {value:note}=await ElMessageBox.prompt(`封禁 ${ip} 后，该地址将无法访问站点。`,'确认封禁',{inputPlaceholder:'备注（可选）',confirmButtonText:'封禁',cancelButtonText:'取消'});await api('/api/admin/blacklist',json('POST',{ip,note:note?.trim()||''}));ElMessage.success('IP 已加入黑名单');await loadSecurity();}catch(e){if(e!=='cancel'&&e!=='close')notifyError(e);}}
// EL 批（docs/ADMIN-EDIT-DIALOG.md EK-1/EK-2）：IP 黑/白名单添加从内联表单改为按钮 + 弹窗
const ipDialog=reactive({visible:false,kind:'black',ip:'',note:''});
function openIpDialog(kind){ipDialog.kind=kind;ipDialog.ip='';ipDialog.note='';ipDialog.visible=true;}
async function submitIpDialog(){
  const ip=ipDialog.ip.trim();
  if(!ip)return ElMessage.warning('请填写 IP 或 CIDR');
  if(ipDialog.kind==='black'){
    await run(async()=>{await api('/api/admin/blacklist',json('POST',{ip,note:ipDialog.note.trim()}));ipDialog.visible=false;ElMessage.success('已封禁');await loadSecurity();});
  }else{
    await run(async()=>{const res=await api('/api/admin/whitelist',json('POST',{ip,note:ipDialog.note.trim()}));ipDialog.visible=false;ElMessage.success(res.clearedBan?'已加入白名单，并已清除该 IP 的临时封禁':'已加入白名单');await loadSecurity();});
  }
}
async function removeBlacklist(ip){try{await ElMessageBox.confirm(`把 ${ip} 移出黑名单？该操作不会恢复该 IP 的自动封禁记录。`,'确认解封',{type:'warning'});}catch{return;}await run(async()=>{await api(`/api/admin/blacklist/${encodeURIComponent(ip)}`,{method:'DELETE'});ElMessage.success('已解封');await loadSecurity();});}
// EL 批（docs/ADMIN-EDIT-DIALOG.md EK-2）：内联表单已改弹窗；行内快捷入口（访问明细「信任」）仍直接加白
async function addWhitelist(existingIp){const ip=existingIp||'';if(!ip)return ElMessage.warning('请填写 IP 或 CIDR');await run(async()=>{const res=await api('/api/admin/whitelist',json('POST',{ip,note:''}));ElMessage.success(res.clearedBan?'已加入白名单，并已清除该 IP 的临时封禁':'已加入白名单');await loadSecurity();});}
async function removeWhitelist(ip){await run(async()=>{await api(`/api/admin/whitelist/${encodeURIComponent(ip)}`,{method:'DELETE'});ElMessage.success('已移出白名单');await loadSecurity();});}
// BJ 批 C1：解封粒度——只清自动封禁（ip_abuse），绝不移除 IP 黑名单；按钮文案按状态切换
async function unbanAbuse(row){const ip=row.ip;const active=Boolean(row.active);try{await ElMessageBox.confirm(active?`解除 ${ip} 的临时封禁？只解除自动临时封禁，不会移除 IP 黑名单；该 IP 若在黑名单中仍无法访问。`:`清除 ${ip} 的封禁记录？只删除记录，不会移除 IP 黑名单；该 IP 若在黑名单中仍无法访问。`,'确认',{type:'warning'});}catch{return;}await run(async()=>{await api(`/api/admin/abuse/${encodeURIComponent(ip)}`,{method:'DELETE'});ElMessage.success(active?'临时封禁已解除':'记录已清除');await loadSecurity();});}
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

function fieldsByGroup(groupId){const q=settingQuery.value.trim().toLocaleLowerCase();return (settingsSchema.value?.fields||[]).filter(f=>f.group===groupId&&!isMailSettingKey(f.key)&&(!q||`${f.label} ${f.key} ${f.help||''}`.toLocaleLowerCase().includes(q))&&onlyChangedFilter(f));}
// 设置搜索按 Enter：有未保存修改时先提醒；没有匹配项给出提示；然后重新加载设置定义
function onSettingsEnter(){if(settingsDirty.value){ElMessage.warning('有未保存的修改，先保存再重新加载');return;}const q=settingQuery.value.trim().toLocaleLowerCase();if(q&&!(settingsSchema.value?.fields||[]).some(f=>`${f.label} ${f.key} ${f.help||''}`.toLocaleLowerCase().includes(q)))ElMessage.warning('没有匹配的设置项');loadSettings();}
const filteredGroups=computed(()=>{const groups=settingsSchema.value?.groups||[];return groups.filter(g=>fieldsByGroup(g.id).length);});
function visibleSettingCount(id){return fieldsByGroup(id).length;}
function sourceLabel(src){return ({database:'数据库',env:'环境变量',default:'默认值'})[src]||src||'默认值';}
function settingId(key){return `setting-${String(key).replace(/[^a-zA-Z0-9_-]/g,'-')}`;}
function secretPlaceholder(key){return settingsSchema.value?.secrets?.[key]?.hasValue?'已设置，留空保持原值':'尚未设置';}
async function loadSettings(){loading.value=true;try{const d=await api('/api/admin/settings');settingsSchema.value=d;for(const key of Object.keys(settingValues))delete settingValues[key];for(const field of d.fields||[]){settingValues[field.key]=field.type==='secret'?'':d.values?.[field.key]??field.default??(field.type==='bool'?false:'');}for(const key of Object.keys(clearSecrets))delete clearSecrets[key];activeSettingsTab.value=String((d.groups||[])[0]?.id??'');restoreFoldState();settingsDirty.value=false;}catch(e){notifyError(e);}finally{loading.value=false;}}
// 放弃修改（2026-11-09 修复）：重置代理编辑态并重拉设置，草稿与脏标记一起清
function discardSettings(){proxyDialogDirty.value=false;proxyList.value=[];void loadSettings();}
async function revealSecret(key){try{const d=await api(`/api/admin/settings/value?key=${encodeURIComponent(key)}`);settingValues[key]=d.value??'';ElMessage.info('密钥已载入输入框；保存会保留该值');}catch(e){notifyError(e);}}
// EL 批（docs/ADMIN-EDIT-DIALOG.md EK-5）：通用出网代理 / App 同步专用代理的编辑弹窗（掩码显示、http/https 校验、留空保持、清除直连）
const secretDialog=reactive({visible:false,field:null,value:'',hasValue:false,clear:false});
const secretSaving=ref(false);
function openSecretDialog(field){secretDialog.field=field;secretDialog.value='';secretDialog.hasValue=Boolean(settingsSchema.value?.secrets?.[field.key]?.hasValue);secretDialog.clear=false;secretDialog.visible=true;}
async function revealSecretInDialog(){if(!secretDialog.field?.key)return;try{const d=await api(`/api/admin/settings/value?key=${encodeURIComponent(secretDialog.field.key)}`);secretDialog.value=d.value??'';}catch(e){notifyError(e);}}
async function saveSecretDialog(){
  const key=secretDialog.field?.key;
  if(!key)return;
  const raw=String(secretDialog.value??'').trim();
  let values=null;
  if(secretDialog.clear)values={[key]:null};
  else if(raw){if(!/^https?:\/\//i.test(raw)){ElMessage.error('仅支持 http/https 代理地址（如 http://127.0.0.1:7890）');return;}values={[key]:raw};}
  else{secretDialog.visible=false;return;}
  secretSaving.value=true;
  try{
    const d=await api('/api/admin/settings',json('POST',{values}));
    syncSettingsAfterSave(d,key);
    secretDialog.visible=false;
    ElMessage.success(`已保存「${secretDialog.field?.label||key}」（约 15 秒内生效）`);
  }catch(e){notifyError(e);}finally{secretSaving.value=false;}
}
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
    syncSettingsAfterSave(d,'network.steamProxy');
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
function startProxyTimer(){if(proxyTimer)return;proxyTimer=setInterval(()=>{proxyTick+=1;healthNow.value=Date.now();const active=props.section==='settings'&&!document.hidden&&activeSettingsTab.value==='network';if(active&&proxyTick%10===0)loadProxyHealth();},1000);}
// EL 批（docs/ADMIN-EDIT-DIALOG.md EK-4/EK-5）：代理草稿先落（守卫「保存并离开」走弹窗路径），其余字段照旧收集
async function submitSettings(){
  if(proxyDialogDirty.value){await saveProxyDialog();}
  const values={};
  for(const f of settingsSchema.value?.fields||[]){
    if(isMailSettingKey(f.key))continue;
    const v=settingValues[f.key];
    if(f.type==='secret'){if(clearSecrets[f.key])values[f.key]=null;else if(String(v??'').trim()!=='')values[f.key]=v;}
    else if(f.type==='int'){values[f.key]=v===''||v==null?null:Number(v);}
    else if(f.type==='bool')values[f.key]=Boolean(v);
    else values[f.key]=v;
  }
  const d=await api('/api/admin/settings',json('POST',{values}));
  settingsSchema.value=d;
  for(const f of d.fields||[]){if(f.type==='secret')settingValues[f.key]='';else settingValues[f.key]=d.values?.[f.key]??f.default??'';}
  settingsDirty.value=false;
  return d;
}
// 弹窗局部保存后同步 schema/values（只刷新对应 key，保留页面其它未保存输入，不误清脏标记）
function syncSettingsAfterSave(d,key){
  settingsSchema.value=d;
  const f=(d.fields||[]).find((x)=>x.key===key);
  if(f){if(f.type==='secret')settingValues[f.key]='';else settingValues[f.key]=d.values?.[f.key]??f.default??'';}
}
async function saveSettings(){await run(async()=>{const d=await submitSettings();ElMessage.success(`已保存 ${d.keys?.length||0} 项设置`);loadProxyHealth();});}
// 搜索跨 tab：命中时自动切到第一个有命中的 tab（tab 上已显示命中数）
watch(settingQuery,()=>{if(settingQuery.value.trim()){const first=filteredGroups.value[0];if(first&&first.id!==activeSettingsTab.value)activeSettingsTab.value=first.id;}});

// ── CQ 批（docs/SETTINGS-IA.md）：平台卡片/折叠/只看非默认/恢复默认/搜索展开 ──
const settingsOnlyChanged=ref(false);const settingsFolds=reactive({});
try{settingsOnlyChanged.value=localStorage.getItem('settings-only-changed')==='1';}catch{}
watch(settingsOnlyChanged,(v)=>{try{localStorage.setItem('settings-only-changed',v?'1':'0');}catch{}});
function isPlainGroup(gid){return Boolean(settingsSchema.value?.plainGroups?.includes(gid));}
function onlyChangedFilter(f){if(!settingsOnlyChanged.value)return true;return !(settingsSchema.value?.isDefault?.[f.key]??true);}
function sectionDefs(gid){const regs=settingsSchema.value?.sections||[];const fieldList=settingsSchema.value?.fields||[];const byKey=new Map(fieldList.map((f)=>[f.key,f]));return regs.filter((s)=>s.group===gid).map((s)=>{const keys=s.keys??fieldList.filter((f)=>f.section===s.id).map((f)=>f.key);const fields=keys.map((k)=>byKey.get(k)).filter(Boolean);const primary=fields.filter((f)=>f.tier!=='advanced');const advanced=fields.filter((f)=>f.tier==='advanced');const en=primary.filter((f)=>f.type==='bool'&&String(f.key).endsWith('.enabled'));const named=primary.find((f)=>f.key===`sources.${s.id}.enabled`);const enabledKey=named?named.key:(en.length===1?en[0].key:null);const enabledField=enabledKey?byKey.get(enabledKey):null;const body=primary.filter((f)=>f.key!==enabledKey);let rows=null;if(s.compact){if(s.id==='gog-humble'){const pick=(p)=>body.filter((f)=>String(f.key).startsWith(p));rows=[pick('sources.gog.'),pick('sources.humble.')].filter((fs)=>fs.length).map((fs)=>({label:fs.map((f)=>f.label).join(' / '),fields:fs}));}else{rows=body.reduce((acc,f,i)=>{const r=Math.floor(i/(s.compact||2));if(!acc[r])acc[r]=[];acc[r].push(f);return acc;},[]).map((fs)=>({label:fs.map((f)=>f.label).join(' / '),fields:fs}));}}return {...s,fields,primary:body,advanced,enabledKey,enabledField,rows};});}
function sectionForId(secId){for(const g of settingsSchema.value?.groups||[]){const s=sectionDefs(g.id).find((x)=>x.id===secId);if(s)return s;}return null;}
function foldOpen(secId){return Boolean(settingsFolds[secId]);}
function toggleFold(secId){settingsFolds[secId]=!settingsFolds[secId];try{localStorage.setItem(`settings-fold-${secId}`,settingsFolds[secId]?'1':'0');}catch{}}
function restoreFoldState(){for(const s of settingsSchema.value?.sections||[]){try{if(localStorage.getItem(`settings-fold-${s.id}`)==='1')settingsFolds[s.id]=true;}catch{}}}
function fieldHit(f){const q=settingQuery.value.trim().toLocaleLowerCase();if(!q)return false;return `${f.label} ${f.key}`.toLocaleLowerCase().includes(q);}
function foldAutoOpen(sec){const q=settingQuery.value.trim().toLocaleLowerCase();if(!q)return false;return (sec.advanced||[]).some((f)=>`${f.label} ${f.key} ${f.help||''}`.toLocaleLowerCase().includes(q));}
function summaryFor(sec,fields){const list=fields??(sec.advanced||[]);const parts=list.filter((f)=>f.sum).map((f)=>{const raw=settingValues[f.key]??f.default??'';const v=typeof raw==='boolean'?(raw?'开':'关'):raw;return String(f.sum).replace('{v}',v);});return parts.length?parts.join(' · '):null;}
function displaySettingsFields(gid){const q=settingQuery.value.trim().toLocaleLowerCase();const entries=[];for(const sec of sectionDefs(gid)){const prim=sec.primary.filter((f)=>(!q||`${f.label} ${f.key} ${f.help||''}`.toLocaleLowerCase().includes(q))&&onlyChangedFilter(f));const adv=sec.advanced.filter((f)=>(!q||`${f.label} ${f.key} ${f.help||''}`.toLocaleLowerCase().includes(q))&&onlyChangedFilter(f));entries.push({k:`${sec.id}:head`,kind:'cardHead',sec});entries.push({k:`${sec.id}:body`,kind:'cardBody',sec});if(prim.length){if(sec.compact){const rows=prim.reduce((acc,f,i)=>{const r=Math.floor(i/(sec.compact||2));if(!acc[r])acc[r]=[];acc[r].push(f);return acc;},[]).map((fs)=>({label:fs.map((f)=>f.label).join(' / '),fields:fs}));entries.push({k:`${sec.id}:rows`,kind:'rows',rows,sec});}else entries.push({k:`${sec.id}:grid`,kind:'grid',fields:prim,sec});}if(adv.length){entries.push({k:`${sec.id}:fold`,kind:'fold',sec,count:adv.length,summary:summaryFor(sec,adv)});if(foldOpen(sec.id)||foldAutoOpen(sec))entries.push({k:`${sec.id}:foldBody`,kind:'foldBody',sec,fields:adv});}entries.push({k:`${sec.id}:end`,kind:'cardEnd',sec});}return entries;}
async function submitSettingsPartial(patch){const d=await api('/api/admin/settings',json('POST',{values:patch}));applySettingsSchema(d);return d;}
function applySettingsSchema(d){settingsSchema.value=d;for(const f of d.fields||[]){if(f.type==='secret')settingValues[f.key]='';else settingValues[f.key]=d.values?.[f.key]??f.default??'';}settingsDirty.value=false;}
async function restoreField(field){try{await ElMessageBox.confirm(`把「${field.label}」恢复为默认值（${field.default??''}）？来源将回落为环境变量或默认。`,'恢复默认',{type:'warning',confirmButtonText:'确认恢复',cancelButtonText:'取消'});}catch{return;}try{const d=await api('/api/admin/settings/restore',json('POST',{keys:[field.key]}));applySettingsSchema(d);ElMessage.success('已恢复默认');}catch(e){notifyError(e);}}
async function restoreSection(sec){const all=[...(sec.primary||[]),...(sec.advanced||[]),...(sec.enabledField?[sec.enabledField]:[])];try{await ElMessageBox.confirm(`把「${sec.title}」的 ${all.length} 项全部恢复为默认值？来源将回落为环境变量或默认。`,'恢复本组默认',{type:'warning',confirmButtonText:'确认恢复',cancelButtonText:'取消'});}catch{return;}try{const d=await api('/api/admin/settings/restore',json('POST',{keys:all.map((f)=>f.key)}));applySettingsSchema(d);ElMessage.success(`已恢复 ${all.length} 项默认值`);}catch(e){notifyError(e);}}
// 翻页清空选择（决策：常规列表只支持本页勾选）。这些表是客户端分页，翻页不会走 load 函数，
// 所以单独 watch 页码；游戏目录 / 访问明细是服务端分页，已在 load 里清空。
watch(mergedPage,()=>mergedPicked.value=new Set());watch(blacklistPage,()=>sel.blacklist.clear());watch(whitelistPage,()=>sel.whitelist.clear());watch(abusePage,()=>sel.abuse.clear());watch(devicesPage,()=>sel.devices.clear());watch(deviceBansPage,()=>sel.deviceBans.clear());watch(announcementsPage,()=>sel.announcements.clear());
watch(gameView,(view)=>{if(view==='tasks'){loadSyncStatus();loadAppCard();}else loadGames(1);});

const priceMetrics=computed(()=>[{label:'降价',value:priceReport.value.drops||0,tone:'metric-red'},{label:'涨价',value:priceReport.value.rises||0,tone:''},{label:'新史低',value:priceReport.value.newLows||0,tone:'metric-green'},{label:'价格变化',value:priceReport.value.changed||0,tone:''}]);
const priceChanges=computed(()=>[...(priceReport.value.topDrops||[]),...(priceReport.value.topRises||[])]);
const viewRows=computed(()=>{const rows=views.value.slice();if(!aggregateViews.value)return rows;const map=new Map();for(const v of rows){const key=v.name||v.path;const current=map.get(key)||{name:v.name,path:'多个页面',views:0,last_at:v.last_at};current.views+=v.views;if(v.last_at>current.last_at)current.last_at=v.last_at;map.set(key,current);}return [...map.values()].sort((a,b)=>b.views-a.views);});
const imageMb=computed(()=>((imageStats.value.bytes||0)/1024/1024).toFixed(1));
// BC 批（docs/IMAGE-COVERAGE.md §3.3）：清除缺图负缓存，前台下一次请求会重新取图
async function resetImageMiss(){
  try{
    await ElMessageBox.confirm('清空后前台会重新尝试取图（已缓存的图片不受影响）。','清除缺图缓存',{type:'warning',confirmButtonText:'清除',cancelButtonText:'取消'});
  }catch{ return; }
  try{
    const d=await api('/api/admin/images/reset-miss',json('POST',{}));
    ElMessage.success('已清除 '+(d.cleared||0)+' 条缺图记录');
  }catch(e){ ElMessage.error(e.message||'操作失败'); }
}
async function loadStats(){loading.value=true;try{const [r,v,i,b]=await Promise.all([api('/api/admin/reports/price?hours=24&limit=100&days=7'),api('/api/admin/views?limit=500'),api('/api/admin/images'),api('/api/admin/backups')]);priceReport.value=r.report||{};priceSeries.value=r.series||{};views.value=v.views||[];imageStats.value=i.images||{};backups.value=b.backups||[];}catch(e){notifyError(e);}finally{loading.value=false;}}
// EC 批（docs/IMAGE-COVERAGE.md §8 EC-1）：图片覆盖看板——数字与缺图列表（分页 + 原因）
async function loadCoverage(){try{const qs=new URLSearchParams({page:String(coveragePage.value),pageSize:String(coveragePageSize.value)});coverage.value=await api(`/api/admin/images/coverage?${qs}`);}catch(e){notifyError(e);}}
// EC 批（docs/IMAGE-COVERAGE.md §8 EC-2）：手动触发缺图回填（服务器后台跑，限速防 429）
async function runImagesBackfill(){try{await ElMessageBox.confirm('扫描 header_image 为空的游戏并逐款重同步元数据补封面（限速防 429，可随时到「同步与回填」看进度）。','重同步缺图',{type:'warning',confirmButtonText:'开始回填',cancelButtonText:'取消'});}catch{return;}backfillRunning.value=true;try{const d=await api('/api/admin/images/backfill',json('POST',{}));ElMessage.success(`缺图回填已提交（runId ${d.runId}），完成后刷新本页可见缺图数下降`);setTimeout(()=>{loadCoverage();backfillRunning.value=false;},3000);}catch(e){backfillRunning.value=false;ElMessage.error(e.message||'提交失败');}}
async function createBackup(){await run(async()=>{const d=await api('/api/admin/backup',json('POST',{}));backups.value=d.backups||backups.value;ElMessage.success(`备份完成：${d.result?.rows||0} 行`);});}

async function loadSyncStatus(){try{syncStatus.value=await api('/api/admin/sync/status');if(syncStatus.value?.running){try{const d=await api('/api/admin/backfill/status');backfillProgress.value=d.progress||null;}catch{/* 忽略 */}}else backfillProgress.value=null;}catch(e){notifyError(e);}}
// DR 批（docs/APP-INSTANT-UPDATE.md §3.1）：App 版本卡——状态轮询（与任务表同一 8 秒 timer）+ 手动立即同步
const appCard=ref({latest:null,source:null,lastSyncAt:null,lastError:null,syncing:false});
const appSyncRunning=ref(false);
async function loadAppCard(){try{appCard.value=await api('/api/admin/app-sync/status');}catch{/* 卡片读失败静默，不打断任务表 */}}
async function syncAppNow(){await run(async()=>{
  const r=await fetch('/api/admin/app-sync',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:'{}'});
  const d=await r.json().catch(()=>({}));
  await loadAppCard();
  if(d.ok){ElMessage.success(d.version?`App 已同步到 ${d.version}${d.reason?`（${d.reason}）`:''}`:'App 已同步');}
  else{ElMessage.error(`App 同步失败：${d.reason||`HTTP ${r.status}`}`);}
});}
// AC-4/AC2（docs/SYNC-FAILURE-MODES.md AC2）：手动重置任务熔断（6 小时冷却 → 立即可跑）
async function resetCircuit(row){await run(async()=>{const d=await api('/api/admin/circuit/reset',json('POST',{name:row.name}));ElMessage.success(d.handled?'熔断已重置':'本进程无调度器，重置不影响（重启即清）');await loadSyncStatus();});}
async function runTask(name){await run(async()=>{if(['steam-prices','catalog','itad','gog','humble','sonkwo'].includes(name)){await api('/api/admin/sync',json('POST',{mode:name}));}else{await api(`/api/admin/${name}`,json('POST',{}));}ElMessage.success('任务已提交到服务器');await loadSyncStatus();});}
async function stopCurrent(){await run(async()=>{const mode=syncStatus.value?.run?.mode||'';const path=mode==='rename'?'/api/admin/rename/stop':mode==='heat'?'/api/admin/heat/stop':'/api/admin/backfill/stop';await api(path,json('POST',{}));ElMessage.success('已请求停止');await loadSyncStatus();});}

watch(()=>props.section,(section)=>{if(section==='games')loadGames(1);else if(section==='visitors')loadVisitorView();else if(section==='announcements'){loadAnnouncements();if(route.query.drawer==='new'){pendingEditId=Number(route.query.id)||null;resolveAnnouncementDrawer();}}else if(section==='wishlist')loadWishlists();else if(section==='watchlist')loadAdminWatches(1);else if(section==='settings')loadSettings();else if(section==='stats'){loadStats();loadCoverage();}});
// AN 批（docs/UNSAVED-GUARD.md §4.4）：本组件注册三个编辑面——系统设置 / 站点通知 / 编辑游戏
const unregisterUnsaved=[];
onMounted(()=>{if(props.section==='games')loadGames(1);else if(props.section==='visitors')loadVisitorView();else if(props.section==='announcements'){loadAnnouncements();if(route.query.drawer==='new'){pendingEditId=Number(route.query.id)||null;resolveAnnouncementDrawer();}}else if(props.section==='wishlist')loadWishlists();else if(props.section==='settings'){loadSettings();loadProxyHealth();}else if(props.section==='stats'){loadStats();loadCoverage();}startProxyTimer();unregisterUnsaved.push(registerUnsavedSource({id:'settings',label:'系统设置',isDirty:()=>settingsDirty.value||proxyDialogDirty.value,save:submitSettings,discard:discardSettings}),registerUnsavedSource({id:'edit-game',label:'编辑游戏',isDirty:gameDirty,save:submitGameSave,discard:closeGameDialog}));if(window.matchMedia){const mq=window.matchMedia('(max-width: 720px)');const on=()=>isMobile.value=mq.matches;mq.addEventListener?mq.addEventListener('change',on):mq.addListener(on);}});
const statusTimer=setInterval(()=>{if(props.section==='games'&&gameView.value==='tasks'){loadSyncStatus();loadAppCard();}},8000);
onBeforeUnmount(()=>{clearInterval(statusTimer);if(proxyTimer){clearInterval(proxyTimer);proxyTimer=null;}unregisterUnsaved.forEach((fn)=>fn());if(mobileQuery){if(mobileQuery.removeEventListener)mobileQuery.removeEventListener('change',onMobileChange);else mobileQuery.removeListener(onMobileChange);}});
if(mobileQuery){if(mobileQuery.addEventListener)mobileQuery.addEventListener('change',onMobileChange);else mobileQuery.addListener(onMobileChange);}
</script>

<style scoped>
.module-wrap{display:flex;flex-direction:column;gap:var(--space-14);min-width:0;padding-bottom:var(--space-24)}.module-card{background:var(--panel);border:1px solid var(--border);border-radius:var(--radius-13);padding:var(--space-16);box-shadow:0 3px 14px #26345a06;min-width:0}.module-tabs{display:flex;gap:5px;border-bottom:var(--space-1) solid var(--border);padding:0 var(--space-2) var(--space-10)}.module-tabs button{border:0;background:transparent;border-radius:var(--radius-8);padding:var(--space-8) 13px;color:var(--fg-muted);font-size:var(--font-12);cursor:pointer}.module-tabs button.on{background:var(--brand-soft);color:var(--brand);font-weight:650}.filterbar{display:flex;gap:9px;align-items:center;flex-wrap:wrap}.filterbar>.el-input{flex:1 1 230px;max-width:360px}.filterbar>.el-select{width:155px}.metric-grid{display:grid;grid-template-columns:repeat(5,minmax(110px,1fr));gap:var(--space-10)}.metric-card{background:var(--panel);border:1px solid var(--border);border-radius:var(--radius-12);padding:13px 15px;display:flex;flex-direction:column;gap:9px}.clickable-grid .metric-card{cursor:pointer;transition:border-color .15s,background .15s}.clickable-grid .metric-card:hover{border-color:var(--brand)}.clickable-grid .metric-card.on{border-color:var(--brand);background:var(--brand-soft)}.clickable-grid .metric-card.on>strong{color:var(--brand)}.more-metrics{margin:var(--space-10) 0 0}.more-metrics summary{cursor:pointer;display:inline-flex;align-items:center;gap:var(--space-6);padding:var(--space-6) 11px;border:1px solid var(--border);border-radius:var(--radius-9);font-size:var(--font-12);color:var(--fg-muted);background:var(--panel);user-select:none}.more-metrics summary:hover{color:var(--brand);border-color:var(--brand)}.metric-chips{display:flex;flex-wrap:wrap;gap:7px;padding-top:var(--space-10)}.metric-chip{display:inline-flex;align-items:center;gap:var(--space-6);border:1px solid var(--border);background:var(--panel);color:var(--fg-muted);border-radius:var(--radius-pill);padding:var(--space-4) 11px;font-size:var(--font-11);cursor:pointer}.metric-chip strong{color:var(--fg);font-size:var(--font-12)}.metric-chip:hover{border-color:var(--brand);color:var(--brand)}.metric-chip.on{border-color:var(--brand);background:var(--brand-soft);color:var(--brand)}.metric-chip.plain,.price-change-cell{cursor:default}.metric-chip.plain:hover{border-color:var(--border);color:var(--fg-muted)}.metric-card>span{font-size:var(--font-11);color:var(--fg-muted)}.metric-card>strong{font-size:23px;letter-spacing:-.04em;color:var(--fg)}.metric-red strong,.price-down{color:var(--danger)!important}.metric-green strong,.price-up{color:var(--success)!important}.table-card{padding:0;overflow:hidden}.game-admin{display:flex;align-items:center;gap:var(--space-10);min-width:0}.game-admin img{width:70px;height:33px;object-fit:cover;border-radius:5px;background:var(--border);flex:none}.game-admin>div,.inline-form .el-input{min-width:0}.game-admin strong,.game-admin small,.module-wrap td small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.game-admin strong,.proxy-health-head strong{font-size:var(--font-12)}.game-admin small,.module-wrap td small{font-size:var(--font-10);color:var(--fg-muted);margin-top:3px}.tag-gap{margin:var(--space-2)}.pager{display:flex;justify-content:space-between;align-items:center;gap:var(--space-12);padding:var(--space-12) 15px;color:var(--fg-muted);font-size:var(--font-11)}.notice-card{border:1px solid var(--brand-soft);border-radius:var(--radius-12);background:var(--brand-soft);padding:var(--space-16) var(--space-18);color:var(--fg-2);font-size:var(--font-12)}.notice-card p{margin:var(--space-6) 0 0;color:var(--fg-muted);line-height:1.6}.task-actions{display:flex;align-items:center;gap:var(--space-10);flex-wrap:wrap}.task-actions label{display:flex;align-items:center;gap:5px;color:var(--fg-muted);font-size:var(--font-11)}.task-actions .el-input-number{width:118px}.task-state{display:flex;align-items:flex-start;justify-content:space-between;gap:15px;flex-wrap:wrap}.task-state>div:first-child{display:grid;gap:7px}.task-state strong{font-size:var(--font-15)}.eyebrow-small,.cache-stats span{font-size:var(--font-10);color:var(--fg-muted)}.task-state pre{flex-basis:100%;max-height:210px;overflow:auto;background:var(--panel-2);border-radius:var(--radius-9);padding:var(--space-12);color:var(--fg-muted);font-size:var(--font-11);white-space:pre-wrap}.visitor-tabs{display:flex}.security-grid,.stats-columns{display:grid;grid-template-columns:1fr 1fr;gap:var(--space-12)}.security-grid>.module-card{padding:var(--space-14)}.card-heading{display:flex;align-items:center;justify-content:space-between;gap:var(--space-12);margin-bottom:13px}.card-heading h3,.announcement-copy h3{font-size:var(--font-14);margin:0;color:var(--fg)}.card-heading p,.report-heading p{font-size:var(--font-11);color:var(--fg-muted);margin:var(--space-4) 0 0}.inline-form{display:flex;gap:7px;margin-bottom:var(--space-12)}.security-events{margin-top:var(--space-1)}.announcement-list{display:grid;gap:var(--space-10)}.announcement-item{display:flex;align-items:flex-start;gap:var(--space-14)}.announcement-badge{flex:none;border-radius:var(--radius-8);padding:5px var(--space-8);font-size:var(--font-10);color:var(--brand);background:var(--brand-soft)}.announcement-badge.warning{color:var(--warn);background:var(--warn-bg)}.announcement-badge.critical{color:var(--danger);background:var(--danger-bg)}.announcement-copy{flex:1;min-width:0}.announcement-copy .card-heading{justify-content:flex-start;margin:0}.announcement-copy p{font-size:var(--font-12);color:var(--fg-muted);line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere}.announcement-copy small{color:var(--fg-muted);font-size:var(--font-10)}.item-actions{display:flex;gap:3px}.settings-toolbar{display:flex;align-items:center;gap:var(--space-8);position:sticky;top:0;z-index:var(--z-nav);background:var(--bg-2);padding:var(--space-4) 0 var(--space-8)}.settings-toolbar .el-input{max-width:420px;flex:1}.settings-meta{font-size:var(--font-10);color:var(--fg-muted);margin-top:-8px}.dirty-dot{margin-left:var(--space-8);color:var(--warn)}.settings-group-title{display:flex;align-items:center;gap:var(--space-10)}.settings-group-title strong{font-size:var(--font-13);color:var(--fg)}.settings-group-title span{font-size:var(--font-10);color:var(--fg-muted);background:var(--panel-2);padding:var(--space-2) 7px;border-radius:20px}.settings-description{font-size:var(--font-11);color:var(--fg-muted);margin:0 0 var(--space-10)}.setting-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.setting-field{min-width:0;border:1px solid var(--border);border-radius:var(--radius-9);padding:11px}.setting-head{display:flex;align-items:center;justify-content:space-between;gap:var(--space-8);margin-bottom:var(--space-8)}.setting-head label{font-size:var(--font-11);font-weight:650;color:var(--fg-2)}.setting-field>.el-input,.setting-field>.el-select,.setting-field :deep(.el-input-number){width:100%}.setting-control{display:flex;align-items:center;gap:var(--space-8);color:var(--fg-muted);font-size:var(--font-11)}.secret-control{display:flex;align-items:center;gap:5px}.secret-control>.el-input{flex:1;min-width:100px}.secret-control :deep(.el-checkbox){margin-left:0;white-space:nowrap}.setting-help{font-size:var(--font-10);line-height:1.5;color:var(--fg-muted);margin:var(--space-6) 0 0}.report-heading{display:flex;align-items:center;gap:var(--space-8)}.report-heading>div{flex:1}.report-heading h2{font-size:var(--font-15);color:var(--fg);margin:0}.card-heading.padded{padding:var(--space-14) 15px 0}.cache-card{padding:17px}.cache-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--space-10);margin:var(--space-18) 0 11px}.cache-stats>div{display:grid;gap:var(--space-4)}.cache-stats strong{font-size:var(--font-21);color:var(--brand)}.backup-box{margin-top:var(--space-20);padding-top:var(--space-16);border-top:var(--space-1) solid var(--border)}.backup-row{display:flex;justify-content:space-between;gap:var(--space-10);padding:var(--space-8) 0;border-top:var(--space-1) solid var(--panel-2);font-size:var(--font-10);color:var(--fg-muted)}.backup-row span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mono{font-family:ui-monospace,Consolas,monospace;font-size:var(--font-11)}.muted{color:var(--fg-muted)}
.app-version-grid{display:grid;grid-template-columns:repeat(4,minmax(110px,1fr));gap:var(--space-10);margin-top:var(--space-10)}.app-version-card .card-heading{margin-bottom:0}.app-version-reason{font-size:var(--font-12);overflow-wrap:anywhere}
@media(max-width:900px){.metric-grid{grid-template-columns:repeat(3,minmax(100px,1fr))}.setting-grid{grid-template-columns:1fr}.security-grid,.stats-columns{grid-template-columns:1fr}.pager{align-items:flex-start;flex-direction:column}.form-row{gap:5px}.announcement-item{flex-wrap:wrap}.item-actions{margin-left:auto}}
@media(max-width:560px){.filterbar>.el-select{flex:1;width:auto}.metric-grid{grid-template-columns:repeat(2,minmax(100px,1fr))}.app-version-grid{grid-template-columns:repeat(2,minmax(100px,1fr))}.task-actions label{width:100%;justify-content:space-between}.task-actions label .el-input-number{width:150px}.report-heading{flex-wrap:wrap}.report-heading>div{flex-basis:100%}.inline-form{flex-wrap:wrap}.inline-form .el-input{flex:1 1 100%}.settings-toolbar{flex-wrap:wrap}.settings-toolbar .el-input{flex:1 1 100%;max-width:none}.announcement-item{gap:var(--space-8)}.announcement-copy{flex-basis:calc(100% - 55px)}.item-actions{width:100%;justify-content:flex-end}}
.task-hint{width:100%;margin:var(--space-8) 0 0;font-size:var(--font-12);color:var(--fg-muted);overflow-wrap:anywhere}.task-estimate{font-size:11px;margin-top:2px}.task-estimate .delta-over{color:var(--warn)}
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
.settings-tabs :deep(.el-tabs__header){margin-bottom:var(--space-14)}
.settings-tabs :deep(.el-tab-pane){padding-top:var(--space-4)}
.settings-tabs :deep(.el-tabs__nav-wrap){overflow-x:auto}
.announcement-head .card-heading{margin-bottom:0}
.rule-summary{display:block;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.rule-pop>div{font-size:var(--font-12);line-height:1.8;white-space:nowrap}/* BH 批（docs/VISIT-IP-STATS.md §3.1）：IP 统计展开行 */
.ip-detail h4{margin:var(--space-6) 0 var(--space-4);font-size:var(--font-13);font-weight:600}
.ip-detail .log-line{display:flex;gap:var(--space-12);font-size:var(--font-12);line-height:1.7;align-items:center}
.ip-detail .log-line span:first-child{min-width:150px;color:var(--muted)}
.settings-sections{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:14px;align-items:start}.setting-rows{display:flex;flex-direction:column;gap:6px;padding:4px 0 8px}.setting-row{display:flex;align-items:center;gap:9px;font-size:12.5px;border:1px solid var(--border);border-radius:9px;padding:7px 11px;background:var(--panel-2);flex-wrap:wrap}.setting-row .k{min-width:170px;color:var(--fg);font-weight:600;flex:1 1 170px}.setting-row .row-input{width:110px}.setting-row .src{color:var(--fg-muted);font-size:11px;margin-left:auto}.setting-row.hit{background:var(--brand-soft)}.settings-sections .settings-card-head{display:flex;align-items:center;gap:9px;padding:11px 14px;border:1px solid var(--border);border-bottom:0;border-radius:var(--radius-12) var(--radius-12) 0 0;background:var(--panel-2)}.settings-sections .settings-card-head h3{font-size:13px;margin:0;flex:1;font-weight:600}.settings-ico{width:26px;height:26px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;font-size:14px;background:var(--brand-soft);border:1px solid var(--border)}.settings-card-tag{font-size:10.5px;color:var(--fg-muted);border:1px solid var(--border);background:var(--panel);border-radius:999px;padding:1px 8px}.settings-card-tag.ok{color:var(--good);border-color:var(--good);background:var(--good-bg)}.settings-sections .settings-card-body{padding:12px 14px 6px;border:1px solid var(--border);border-radius:0 0 var(--radius-12) var(--radius-12);background:var(--panel);min-width:0}.settings-fold{display:flex;align-items:center;gap:7px;width:100%;border:0;background:var(--panel-2);color:var(--fg);padding:8px 12px;border-radius:9px;margin:8px 0 10px;cursor:pointer;font-size:12.5px;text-align:left}.settings-fold .arrow{color:var(--fg-muted)}.settings-fold b{font-weight:600}.settings-fold .sum{margin-left:auto;color:var(--fg-muted);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60%}.settings-fold-body{border-top:1px dashed var(--border);padding-top:4px;margin-bottom:8px}.settings-foot{display:flex;justify-content:flex-end;padding:2px 0 10px}.setting-field.hit{background:var(--brand-soft);border-radius:9px}.setting-restore{font-size:11px}.settings-toolbar .el-checkbox{white-space:nowrap}
@media(max-width:760px){.settings-sections{grid-template-columns:1fr}.settings-fold .sum{max-width:45%}}
/* DF 批（docs/ALERT-MANUAL-PUSH.md + design/alert-manual-push-2026-11-18.html）：推送确认弹窗 */
.push-line{display:flex;gap:10px;padding:5px 0;font-size:12.5px;align-items:baseline}.push-line b{width:82px;color:var(--fg-subtle);font-weight:500;flex:none}.push-list{background:var(--panel-2);border:1px solid var(--border);border-radius:9px;padding:6px 10px;margin:6px 0}.push-list>div{display:flex;justify-content:space-between;gap:8px;padding:2px 0;font-size:12.5px}.push-list .push-name{color:var(--fg)}.push-opt{display:flex;align-items:flex-start;gap:8px;margin-top:9px;font-size:12px;color:var(--fg-muted);cursor:pointer}.push-opt b{color:var(--fg);font-weight:600}.push-notice{background:var(--warn-bg);border:1px solid var(--warn-soft);color:var(--warn);border-radius:9px;padding:7px 10px;font-size:11.5px;margin-top:10px}
</style>








