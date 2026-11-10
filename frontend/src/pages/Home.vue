<template>
  <div :class="['storefront', isMobile ? 'm-storefront' : '']">
    <div v-if="debugOn" class="m-debug-bar">{{ debugInfo }}</div>
    <!-- ============ PC ============ -->
    <template v-if="!isMobile">
      <header class="topbar">
        <a class="brand" href="/"><span class="brand-mark">S</span><span>SteamDeals<small>游戏价格情报</small></span></a>
        <div class="top-actions"><el-badge :value="unreadNoticeCount" :hidden="unreadNoticeCount===0" class="notice-badge"><el-button text class="theme-btn" title="站点通知" @click="noticeDrawer=true"><el-icon><Bell /></el-icon></el-button></el-badge><el-button text class="theme-btn" :title="themeMode === 'dark' ? '切换亮色' : '切换暗色'" @click="toggleTheme">{{ themeMode === 'dark' ? '🌞' : '🌙' }}</el-button><span v-if="user" class="user-label">{{ user.display_name || user.username }}</span><el-button v-if="!user" plain @click="goLogin">登录</el-button><template v-else><el-button plain @click="router.push('/change-password')">修改密码</el-button><el-button plain @click="logout">退出</el-button></template><el-button v-if="user?.role === 'admin'" type="primary" @click="router.push('/console')">管理后台</el-button></div>
      </header>
      <main class="store-main">
        <section class="hero">
          <div><div class="eyebrow">DISCOVER YOUR NEXT GAME</div><h1>好游戏，等个好价格。</h1><p>聚合 Steam 与授权平台报价，快速找到值得入手的折扣。</p></div>
          <div class="catalog-stat"><strong>{{ catalogCount ? catalogCount.toLocaleString() : '…' }}</strong><span>款收录条目<small>（含 DLC/软件）</small></span><span v-if="pricedCount > 0" class="catalog-priced">其中 {{ pricedCount.toLocaleString() }} 款有报价</span></div>
        </section>
        <section class="store-tabs"><button v-for="tab in tabs" :key="tab.value" :class="{on:activeTab===tab.value}" @click="setTab(tab.value)">{{ tab.label }}</button></section>
        <p v-if="!user" class="flag-hint">未登录时的标记只保存在此浏览器；登录后以账号数据库中的标记为准。</p>
        <section class="toolbar">
          <el-input v-model="query" clearable placeholder="搜索中文名、英文名或 AppID" class="search" @keyup.enter="onSearchEnter" @compositionstart="composing = true" @compositionend="onCompositionEnd"><template #prefix><el-icon><Search /></el-icon></template></el-input>
          <el-select v-model="region" class="filter-select" aria-label="地区" @change="changeRegion"><el-option v-for="r in regions" :key="r.code" :label="r.label" :value="r.code" /></el-select>
          <el-select v-model="type" class="filter-select" aria-label="游戏类型" @change="loadGames(1)"><el-option label="全部类型" value="all"/><el-option label="游戏" value="game"/><el-option label="DLC" value="dlc"/></el-select>
          <el-select v-model="released" class="filter-select" aria-label="发行时间" @change="loadGames(1)"><el-option label="全部发行" value="all"/><el-option label="近 30 天" value="30d"/><el-option label="近 1 年" value="1y"/><el-option label="近 3 年" value="3y"/></el-select>
          <el-select v-model="sort" class="filter-select" aria-label="排序" @change="changeSort"><el-option label="折扣优先" value="discount"/><el-option label="价格优先" value="price"/><el-option label="名称排序" value="name"/></el-select>
          <el-button :loading="loading" @click="loadGames(page)">刷新</el-button>
        </section>
        <div class="result-line"><span>{{ loading ? '正在加载游戏…' : `找到 ${total.toLocaleString()} 款游戏` }}</span><span>价格与地区货币以商店显示为准</span></div>
        <el-skeleton v-if="loading && !games.length" :rows="6" animated />
        <el-empty v-else-if="!games.length && listNetworkError" :description="NETWORK_ERROR_MESSAGE"><el-button type="primary" @click="retryLoad">重试</el-button></el-empty>
        <el-empty v-else-if="!games.length" description="没有找到匹配的游戏" />
        <section v-else class="game-grid">
          <article v-for="game in games" :key="game.game_id || game.id" class="game-card" @click="openDetail(game)">
            <div class="cover-wrap" :class="{ 'img-failed': !game.steam_appid || coverFailed.has(game.id) }"><img v-if="game.steam_appid" :src="cover(game)" :alt="game.name" loading="lazy" decoding="async" fetchpriority="low" @error="markCoverFailed(game)"/><span class="cover-placeholder">{{ firstChar(game.name) }}</span><span v-if="discount(game)" class="discount">-{{ discount(game) }}%</span></div>
            <div class="game-info"><div class="game-title" :title="game.name">{{ game.name }}<el-button link class="title-copy" title="复制游戏名" @click.stop="copyGameName(game)"><el-icon><CopyDocument /></el-icon></el-button></div><div v-if="game.name_en && game.name_en !== game.name" class="game-subtitle">{{ game.name_en }}</div>
              <div class="price-row"><div><strong>{{ money(game.current_low, game.currency) }}</strong><del v-if="game.current_original > game.current_low">{{ money(game.current_original, game.currency) }}</del></div><el-tag v-if="game.steam_status==='region_locked'" size="small" type="danger" effect="plain">国区不可售</el-tag><el-tag v-if="game.steam_status==='coming_soon'" size="small" type="warning" effect="plain">未发售</el-tag><el-tag v-if="game.mature_flag" size="small" type="warning" effect="plain">成熟内容</el-tag><el-tag v-if="game.adult_flag && siteAdultDisplay==='badge'" size="small" type="danger" effect="plain">成人内容</el-tag><el-tag v-if="game.prev_hist_low != null && game.current_low < game.prev_hist_low" size="small" type="success" effect="plain">新史低</el-tag><el-tag v-if="user && game.owned" size="small" type="warning">已拥有{{ ownedByText(game) }}</el-tag><el-tag v-if="user && game.wishlisted" size="small" type="success" effect="plain">愿望单</el-tag><el-tag v-else-if="game.interested===false" size="small" effect="plain">不感兴趣</el-tag></div>
              <div class="card-foot"><span>{{ game.low_platform_name || 'Steam' }}</span><a v-if="game.steam_appid" class="buy-link" :href="`https://store.steampowered.com/app/${game.steam_appid}/`" target="_blank" rel="noopener" @click.stop><el-button size="small" type="primary">购买</el-button></a><a v-if="game.steam_appid" :href="`https://store.steampowered.com/app/${game.steam_appid}/`" target="_blank" rel="noopener" @click.stop>商店 ↗</a></div>
              <div class="card-flags" @click.stop>
                <el-button size="small" :type="isInterested(game) ? 'primary' : 'default'" :plain="!isInterested(game)" @click="setGameFlag(game, 'interested', isInterested(game) ? 'clear' : true)">{{ isInterested(game) ? '✓ 感兴趣' : '感兴趣' }}</el-button>
                <el-button size="small" :type="isUninterested(game) ? 'danger' : 'default'" :plain="!isUninterested(game)" @click="setGameFlag(game, 'interested', isUninterested(game) ? 'clear' : false)">{{ isUninterested(game) ? '✓ 不感兴趣' : '不感兴趣' }}</el-button>
                <div class="card-flags-sec">
                  <el-button v-if="user" size="small" :type="game.owned ? 'warning' : 'default'" :plain="!game.owned" @click="toggleOwned(game)">{{ ownedBtnLabel(game) }}</el-button>
                  <el-button v-if="user" size="small" :type="game.wishlisted ? 'success' : 'default'" :plain="!game.wishlisted" @click="toggleWishlist(game)">{{ game.wishlisted ? '✓ 愿望单' : '愿望单' }}</el-button>
                </div>
              </div>
            </div>
          </article>
        </section>
        <div class="pagination"><el-pagination v-if="pages > 1" background layout="prev, pager, next, sizes" :total="total" :page-size="pageSize" :current-page="page" :page-sizes="[20,50,100]" @current-change="loadGames" @size-change="changePageSize" /></div>
        <footer class="store-footer">价格信息仅供参考，实际售价以商店结算页面为准。</footer>
      </main>
    </template>
    <!-- ============ 移动端（独立结构，见 docs/UX-REDESIGN §3） ============ -->
    <template v-else>
      <header class="m-topbar">
        <a class="brand m-brand" href="/"><span class="brand-mark">S</span><span>SteamDeals</span></a>
        <div class="m-topbar-actions"><el-badge :value="unreadNoticeCount" :hidden="unreadNoticeCount===0" class="notice-badge"><el-button text class="theme-btn" title="站点通知" @click="noticeDrawer=true"><el-icon><Bell /></el-icon></el-button></el-badge><el-button text class="theme-btn" title="菜单" @click="mySheet=true">☰</el-button></div>
      </header>
      <div v-if="desktopMode && !desktopHintDismissed" class="m-desktop-hint" role="status"><span>检测到浏览器按「桌面版网站」渲染，建议在浏览器菜单关闭后刷新，获得完整手机版体验</span><div class="m-desktop-hint-actions"><button type="button" @click="reloadNow">刷新</button><button type="button" aria-label="关闭提示" @click="dismissDesktopHint">✕</button></div></div>
      <div v-if="installCanInstall" class="m-install-bar"><button type="button" class="m-install-btn" @click="installApp()">安装到桌面</button></div>
      <div class="m-search-row"><el-input v-model="query" clearable placeholder="搜索游戏名或 AppID" class="m-search" @keyup.enter="onSearchEnter" @compositionstart="composing = true" @compositionend="onCompositionEnd"><template #prefix><el-icon><Search /></el-icon></template></el-input><el-button class="m-filter-btn" @click="openFilterSheet"><el-icon><Filter /></el-icon>筛选</el-button></div>
      <div class="m-chips"><button class="m-chip" @click="openFilterSheet">{{ regionLabel }} ▾</button><button class="m-chip" @click="openFilterSheet">{{ typeLabel }} ▾</button><button class="m-chip" @click="openFilterSheet">{{ sortLabel }} ▾</button><button v-if="released!=='all'" class="m-chip on" @click="released='all';loadGames(1)">发行筛选 ✕</button></div>
      <div class="m-tabs"><button :class="{on:activeTab==='all'}" @click="setTab('all')">全部</button><button :class="{on:activeTab==='on'}" @click="setTab('on')">感兴趣</button><button :class="{on:activeTab==='off'}" @click="setTab('off')">不感兴趣</button></div>
      <div class="m-result-line">{{ loading ? '正在加载…' : `找到 ${total.toLocaleString()} 款游戏` }}</div>
      <el-skeleton v-if="loading && !games.length" :rows="4" animated class="m-skeleton" />
      <el-empty v-else-if="!games.length && listNetworkError" :description="NETWORK_ERROR_MESSAGE" class="m-empty"><el-button type="primary" @click="retryLoad">重试</el-button></el-empty>
      <el-empty v-else-if="!games.length" description="没有找到匹配的游戏" class="m-empty" />
      <section v-else class="m-game-list">
        <article v-for="game in games" :key="game.game_id || game.id" class="m-game-card" @click="openDetail(game)">
          <div class="m-cover" :class="{ 'img-failed': !game.steam_appid || coverFailed.has(game.id) }"><img v-if="game.steam_appid" :src="cover(game)" :alt="game.name" loading="lazy" decoding="async" @error="markCoverFailed(game)"/><span class="cover-placeholder">{{ firstChar(game.name) }}</span><span v-if="discount(game)" class="m-discount">-{{ discount(game) }}%</span></div>
          <div class="m-card-body"><div class="m-title">{{ game.name }}</div><div v-if="game.name_en && game.name_en !== game.name" class="m-subtitle">{{ game.name_en }}</div><div class="m-flags"><el-tag v-if="game.steam_status==='region_locked'" size="small" type="danger" effect="plain">国区不可售</el-tag><el-tag v-if="game.steam_status==='coming_soon'" size="small" type="warning" effect="plain">未发售</el-tag><el-tag v-if="game.mature_flag" size="small" type="warning" effect="plain">成熟内容</el-tag><el-tag v-if="game.adult_flag && siteAdultDisplay==='badge'" size="small" type="danger" effect="plain">成人内容</el-tag></div>
            <div class="m-price-row"><strong>{{ money(game.current_low, game.currency) }}</strong><del v-if="game.current_original > game.current_low">{{ money(game.current_original, game.currency) }}</del><span class="m-platform">{{ game.low_platform_name || 'Steam' }}</span></div>
            <div class="m-tags"><el-tag v-if="game.prev_hist_low != null && game.current_low < game.prev_hist_low" size="small" type="success" effect="plain">新史低</el-tag><el-tag v-if="user && game.owned" size="small" type="warning">已拥有{{ ownedByText(game) }}</el-tag><el-tag v-if="user && game.wishlisted" size="small" type="success" effect="plain">愿望单</el-tag></div>
            <div class="m-actions" @click.stop><el-button size="small" :type="isInterested(game) ? 'primary' : 'default'" :plain="!isInterested(game)" @click="setGameFlag(game, 'interested', isInterested(game) ? 'clear' : true)">{{ isInterested(game) ? '✓ 感兴趣' : '感兴趣' }}</el-button><el-button size="small" :type="isUninterested(game) ? 'danger' : 'default'" :plain="!isUninterested(game)" @click="setGameFlag(game, 'interested', isUninterested(game) ? 'clear' : false)">{{ isUninterested(game) ? '✓ 不感兴趣' : '不感兴趣' }}</el-button><a v-if="game.steam_appid" :href="`https://store.steampowered.com/app/${game.steam_appid}/`" target="_blank" rel="noopener"><el-button size="small" type="primary">购买</el-button></a></div>
          </div>
        </article>
      </section>
      <div v-if="page < pages" class="m-loadmore-wrap"><el-button class="m-loadmore" :loading="loading" @click="loadGames(page + 1, true)">加载更多</el-button></div>
      <footer class="m-bottomnav"><button v-for="item in mNavItems" :key="item.value" :class="{on:mNavActive(item.value)}" @click="mNav(item.value)"><span class="m-nav-icon">{{ item.icon }}</span><span>{{ item.label }}</span></button></footer>
      <el-drawer v-model="filterDrawer" direction="btt" size="auto" class="m-filter-sheet"><div class="m-filter-body"><div class="m-filter-group"><label>地区</label><div class="m-radio-row"><button v-for="r in regions" :key="r.code" :class="{on:filterTemp.region===r.code}" @click="filterTemp.region=r.code">{{ r.label }}</button></div></div><div class="m-filter-group"><label>游戏类型</label><div class="m-radio-row"><button :class="{on:filterTemp.type==='all'}" @click="filterTemp.type='all'">全部</button><button :class="{on:filterTemp.type==='game'}" @click="filterTemp.type='game'">游戏</button><button :class="{on:filterTemp.type==='dlc'}" @click="filterTemp.type='dlc'">DLC</button></div></div><div class="m-filter-group"><label>排序</label><div class="m-radio-row"><button :class="{on:filterTemp.sort==='discount'}" @click="filterTemp.sort='discount'">折扣优先</button><button :class="{on:filterTemp.sort==='price'}" @click="filterTemp.sort='price'">价格优先</button><button :class="{on:filterTemp.sort==='name'}" @click="filterTemp.sort='name'">名称排序</button></div></div><div class="m-filter-group"><label>发行时间</label><div class="m-radio-row"><button :class="{on:filterTemp.released==='all'}" @click="filterTemp.released='all'">全部</button><button :class="{on:filterTemp.released==='30d'}" @click="filterTemp.released='30d'">近 30 天</button><button :class="{on:filterTemp.released==='1y'}" @click="filterTemp.released='1y'">近 1 年</button><button :class="{on:filterTemp.released==='3y'}" @click="filterTemp.released='3y'">近 3 年</button></div></div><div class="m-filter-footer"><el-button @click="resetFilter">重置</el-button><el-button type="primary" @click="applyFilter">应用筛选</el-button></div></div></el-drawer>
      <el-drawer v-model="mySheet" direction="btt" size="auto" class="m-filter-sheet"><div class="m-my-body"><div v-if="desktopMode" class="m-sheet-note">浏览器正在按「桌面版网站」渲染：请在浏览器菜单关闭该选项后刷新，可获得完整手机版体验。</div><div v-if="!installInstalled" class="m-sheet-note">安装到桌面：请用 Chrome 打开本站 → 菜单 →「安装应用」；若之前建过快捷方式，请先删除旧图标再重新安装。</div><el-button block @click="mySheet=false;noticeDrawer=true">🔔 站点通知{{ unreadNoticeCount?`（${unreadNoticeCount} 未读）`:'' }}</el-button><el-button block @click="mySheet=false;toggleTheme()">{{ themeMode==='dark'?'🌞 切换亮色':'🌙 切换暗色' }}</el-button><el-button v-if="!user" block type="primary" @click="mySheet=false;goLogin()">登录</el-button><template v-else><el-button block @click="mySheet=false;router.push('/change-password')">修改密码</el-button><el-button block @click="mySheet=false;logout()">退出（{{ user.display_name || user.username }}）</el-button></template><el-button v-if="user?.role === 'admin'" block @click="mySheet=false;router.push('/console')">管理后台</el-button></div></el-drawer>
    </template>
    <el-dialog v-model="detailVisible" :title="detail?.game?.name||'游戏详情'" :width="isMobile ? '100%' : (isNarrow ? '96vw' : '880px')" :class="['detail-dialog', isMobile ? 'mobile-full' : '']"><div v-if="detailLoading" class="detail-loading">正在加载游戏详情…</div><template v-else-if="detail?.game"><div class="detail-copy-row"><el-button link size="small" title="复制游戏名" @click="copyGameName(detail.game)"><el-icon><CopyDocument /></el-icon>复制游戏名</el-button></div><img v-if="detail.game.steam_appid && !detailCoverFailed" class="detail-cover" :src="`/img/steam/${detail.game.steam_appid}/header`" @error="detailCoverFailed = true"><div v-if="!detail.game.steam_appid || detailCoverFailed" class="detail-cover detail-cover-ph"><span class="cover-placeholder">{{ firstChar(detail.game.name) }}</span></div><p class="detail-en">{{ detail.game.name_en }}</p><div class="detail-metrics"><span>当前最低 <strong>{{ money(detail.game.current_low,detail.game.currency) }}</strong></span><span>历史最低 <strong>{{ money(detail.game.hist_low,detail.game.currency) }}</strong></span><span>折扣 <strong>{{ discount(detail.game) }}%</strong></span></div><div v-if="user && detail.game.owned_by?.length" class="detail-owned">已拥有账号：<span v-for="(acct,i) in detail.game.owned_by" :key="acct.steamId" class="owned-acct" :title="acct.steamId">{{ acct.name }}<template v-if="i < detail.game.owned_by.length - 1">、</template></span><span class="detail-owned-tip">（悬停查看 SteamID）</span></div><div v-if="user && detail.game.site_wishlisted" class="detail-owned">本站愿望单 <el-tag size="small" type="success">已加入</el-tag></div><p class="detail-description">{{ detail.game.description||'暂无游戏介绍。' }}</p><div v-if="!isMobile" class="detail-actions"><a v-if="detail.game.steam_appid" :href="`https://store.steampowered.com/app/${detail.game.steam_appid}/`" target="_blank" rel="noopener"><el-button type="primary">去 Steam 购买</el-button></a><el-button :type="isInterested(detail.game) ? 'primary' : 'default'" :plain="!isInterested(detail.game)" @click="setGameFlag(detail.game, 'interested', isInterested(detail.game) ? 'clear' : true)">{{ isInterested(detail.game) ? '✓ 感兴趣' : '感兴趣' }}</el-button><el-button :type="isUninterested(detail.game) ? 'danger' : 'default'" :plain="!isUninterested(detail.game)" @click="setGameFlag(detail.game, 'interested', isUninterested(detail.game) ? 'clear' : false)">{{ isUninterested(detail.game) ? '✓ 不感兴趣' : '不感兴趣' }}</el-button><el-button v-if="user" :type="detail.game.owned ? 'warning' : 'default'" :plain="!detail.game.owned" @click="toggleOwned(detail.game)">{{ ownedBtnLabel(detail.game) }}</el-button><el-button v-if="user" :type="detail.game.wishlisted ? 'success' : 'default'" :plain="!detail.game.wishlisted" @click="toggleWishlist(detail.game)">{{ detail.game.wishlisted ? '✓ 愿望单' : '愿望单' }}</el-button></div><div v-if="user?.role==='admin'" class="detail-actions"><el-input v-model="watchTarget" placeholder="目标价（元，留空为史低提醒）"/><el-button type="primary" @click="saveWatch">{{ watchExists?'更新到价提醒':'添加到价提醒' }}</el-button><el-button v-if="watchExists" @click="deleteWatch">取消提醒</el-button></div><h3>各区服与平台报价</h3><div class="offer-list"><div v-for="offer in pagedOffers" :key="`${offer.region}-${offer.platform_code}-${offer.price_cents}`" class="offer-row"><span>{{ regionName(offer.region) }}</span><strong>{{ offer.platform_name||offer.platform_code }}</strong><span>{{ money(offer.price_cents,offer.currency) }}</span><del>{{ money(offer.original_cents,offer.currency) }}</del><el-tag v-if="offer.discount_pct" size="small" type="danger">-{{ offer.discount_pct }}%</el-tag><a v-if="offer.buy_url" :href="offer.buy_url" target="_blank" rel="noopener noreferrer nofollow">购买 ↗</a></div><el-empty v-if="!detail.offers?.length" description="当前没有在售报价"/></div><PaginationBar v-model:page="offersPage" v-model:page-size="offersPageSize" :total="detail.offers?.length||0"/><PriceHistoryReport :series="detail.series||[]" :current-low="detail.game?.current_low" :currency="(detail.series?.length ? detail.series[0].currency : 'CNY')"/></template></el-dialog>
    <div v-if="isMobile && detailVisible && detail?.game" class="m-detail-bar"><el-button :type="isInterested(detail.game) ? 'primary' : 'default'" :plain="!isInterested(detail.game)" @click="setGameFlag(detail.game, 'interested', isInterested(detail.game) ? 'clear' : true)">{{ isInterested(detail.game) ? '✓ 感兴趣' : '感兴趣' }}</el-button><el-button :type="isUninterested(detail.game) ? 'danger' : 'default'" :plain="!isUninterested(detail.game)" @click="setGameFlag(detail.game, 'interested', isUninterested(detail.game) ? 'clear' : false)">不感兴趣</el-button><el-button v-if="user" :type="detail.game.owned ? 'warning' : 'default'" :plain="!detail.game.owned" @click="toggleOwned(detail.game)">{{ ownedBtnLabel(detail.game) }}</el-button><el-button v-if="user" :type="detail.game.wishlisted ? 'success' : 'default'" :plain="!detail.game.wishlisted" @click="toggleWishlist(detail.game)">{{ detail.game.wishlisted ? '✓ 愿望单' : '愿望单' }}</el-button><a v-if="detail.game.steam_appid" :href="`https://store.steampowered.com/app/${detail.game.steam_appid}/`" target="_blank" rel="noopener"><el-button type="primary">去 Steam 购买</el-button></a></div>
    <el-drawer v-model="noticeDrawer" title="站点通知" direction="rtl" size="min(420px, 92vw)"><div class="notice-drawer-body"><div v-for="n in notices" :key="n.id" class="notice-item" :class="[n.level, isNoticeRead(n.id) ? 'read' : 'unread']"><div class="notice-head"><strong>{{ n.title }}</strong><el-tag size="small" :type="n.level === 'critical' ? 'danger' : n.level === 'warning' ? 'warning' : 'info'" effect="plain">{{ noticeLevelLabel(n.level) }}</el-tag></div><p>{{ n.body }}</p><time class="notice-time">{{ n.startsAt ? siteDateTime(n.startsAt) : '' }}</time></div><el-empty v-if="!notices.length" description="暂无公告" :image-size="60"/></div><template #footer><el-button :disabled="unreadNoticeCount===0" type="primary" @click="markNoticesRead(false)">全部标为已读</el-button></template></el-drawer>
    <el-dialog v-model="noticeDialog" title="站点通知" width="min(560px, 92vw)" class="notice-dialog"><div class="notice-items"><div v-for="n in unreadNotices" :key="n.id" class="notice-item" :class="n.level"><div class="notice-head"><strong>{{ n.title }}</strong><el-tag size="small" :type="n.level === 'critical' ? 'danger' : n.level === 'warning' ? 'warning' : 'info'" effect="plain">{{ noticeLevelLabel(n.level) }}</el-tag></div><p>{{ n.body }}</p></div><el-empty v-if="!unreadNotices.length" description="暂无未读公告" :image-size="60"/></div><template #footer><el-button type="primary" @click="markNoticesRead(true)">我知道了</el-button></template></el-dialog>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import PaginationBar from '../components/PaginationBar.vue';
import PriceHistoryReport from '../components/PriceHistoryReport.vue';
import { useBackGuard } from '../composables/useBackGuard.js';
import { useInstallPrompt } from '../composables/useInstallPrompt.js';
import { useListPagination } from '../composables/useListPagination.js';
import { useTheme } from '../composables/useTheme.js';
import { NETWORK_ERROR_MESSAGE } from '../utils/network.js';
import { useRoute, useRouter } from 'vue-router';
import { Search, Bell, Filter, CopyDocument } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { copyText } from '../utils/clipboard.js';
const router = useRouter(), route = useRoute();
const theme = useTheme();
const themeMode = theme.mode;
function toggleTheme(){ const m = themeMode.value === 'dark' ? 'light' : 'dark'; theme.set(m); persistTheme(m); }
async function persistTheme(m){ if(!user.value) return; try { await request('/api/prefs', { method: 'POST', body: JSON.stringify({ theme: m }) }); } catch { /* 忽略 */ } }
const regions = [{code:'cn',label:'中国大陆'},{code:'hk',label:'中国香港'},{code:'tw',label:'中国台湾'},{code:'us',label:'美国'},{code:'jp',label:'日本'},{code:'ru',label:'俄罗斯'},{code:'tr',label:'土耳其'},{code:'ar',label:'阿根廷'}];
// 已拥有 / 愿望单是登录用户专属维度：游客隐藏这两个标签页（规格 §6）
const tabs=computed(()=>{const base=[{value:'all',label:'全部'},{value:'on',label:'感兴趣'},{value:'off',label:'不感兴趣'}];if(user.value)base.push({value:'owned',label:'已拥有'},{value:'wishlist',label:'愿望单'});return base;});
const games = ref([]), notices = ref([]), total = ref(0), pages = ref(0), page = ref(1), pageSize = ref(20), loading = ref(false), listNetworkError = ref(false);
const catalogCount = ref(0), pricedCount = ref(0), siteAdultDisplay = ref('hide');
const query = ref(''), region = ref('cn'), type = ref('all'), sort = ref('discount'), activeTab=ref('all'), user = ref(null), guestGameFlags=ref({}), released = ref('all');
const guestFlagsStorageKey='steamdeals.guest-game-flags.v1';
let composing = false, searchTimer = null, requestSeq = 0, cooldownTimer=null, gameRequestController=null, narrowQuery=null;
const guestFlagsRev = ref(0);
const searchCache = new Map();
const isNarrow = ref(typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 640px)').matches);
// 通知：登录用户已读存服务端（readIds 来自 /api/announcements）；游客存本地（数组，兼容旧版 max-id 数字）
const noticeReadKey = 'steamdeals.notice-read.v1';
const siteTimezone = ref('Asia/Shanghai');
function readLocalReadIds(){try{const v=localStorage.getItem(noticeReadKey);if(v==null)return null;const p=JSON.parse(v);if(Array.isArray(p))return p.map(Number).filter((n)=>Number.isFinite(n));const n=Number(p);return Number.isFinite(n)&&n>0?{legacyMax:n}:null;}catch{return null;}}
const noticeReadIds = ref([]);
const noticeDrawer = ref(false);
const noticeDialog = ref(false);
const unreadNotices = computed(() => notices.value.filter((n) => !noticeReadIds.value.includes(Number(n.id))));
const unreadNoticeCount = computed(() => unreadNotices.value.length);
function isNoticeRead(id){ return noticeReadIds.value.includes(Number(id)); }
function noticeLevelLabel(level) { return ({ critical: '重要', warning: '提醒', info: '通知' })[level] || '通知'; }
function siteDateTime(iso){ try { return new Intl.DateTimeFormat('zh-CN', { timeZone: siteTimezone.value, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }).format(new Date(iso)); } catch { return ''; } }
async function markNoticesRead(closeDialog){const ids=notices.value.map((n)=>Number(n.id));if(!ids.length){noticeDialog.value=false;return;}if(user.value){try{await request('/api/announcements/read',{method:'POST',body:JSON.stringify({ids})});}catch{/* 网络失败下次仍会提示未读 */}}else{try{localStorage.setItem(noticeReadKey,JSON.stringify([...new Set([...noticeReadIds.value,...ids])]));}catch{/* 忽略 */}}noticeReadIds.value=[...new Set([...noticeReadIds.value,...ids])];if(closeDialog)noticeDialog.value=false;}
function legacyMaxAsReadIds(legacyMax){return notices.value.map((n)=>Number(n.id)).filter((id)=>id<=legacyMax);}
const filterDrawer = ref(false), mySheet = ref(false);
// AL 批（docs/AUTH-REDESIGN.md §5.1）：登录走独立 /login 页，带回跳 next（只允许站内相对路径）
function goLogin(){router.push({path:'/login',query:{next:route.fullPath}});}
// 移动端判定：CSS 断点之外，「桌面版网站」模式的特征是 screen.width 小但视口宽（WebView 忽略 viewport）。
// 用 v-if 分两套结构，不再用 CSS 断点"压缩"PC 结构。
const isMobile = ref(false);
const desktopMode = ref(false);
let mobileTimer = null;
function applyMobile(){
  if(typeof window==='undefined')return;
  // 「桌面版网站」渲染（docs/MOBILE-FIX.md §3B）：保留 main.js 的 zoom 补偿，这里只负责提示
  const desktop = Boolean(window.screen && window.screen.width <= 640 && window.innerWidth > 700);
  desktopMode.value = desktop;
  const force = (window.matchMedia && window.matchMedia('(max-width: 640px)').matches) || desktop;
  isMobile.value = force;
}
function scheduleMobileCheck(){
  if(typeof window==='undefined')return;
  clearTimeout(mobileTimer);
  mobileTimer = setTimeout(applyMobile, 120);
}
// ?debug=1 调试浮层（docs/MOBILE-VIEWPORT.md §3.4）：真机截图即可判断 viewport 修复是否生效
const debugOn = computed(() => route.query.debug === '1');
const debugInfo = ref('');
function refreshDebugInfo(){
  if(typeof window==='undefined')return;
  const sw = Number(window.screen?.width ?? 0);
  const iw = window.innerWidth;
  const dpr = window.devicePixelRatio || 1;
  debugInfo.value = `innerWidth ${iw} / screen.width ${sw} / DPR ${dpr} / isMobile ${isMobile.value} / desktopMode ${desktopMode.value} / UA ${String(navigator.userAgent || '').slice(0, 60)}`;
}
// 桌面模式提示（docs/MOBILE-FIX.md §3B）：可关闭，关闭状态存 sessionStorage（本次会话不再提示）
const DESKTOP_HINT_KEY='steamdeals.desktop-hint.dismissed.v1';
const desktopHintDismissed=ref(false);
function dismissDesktopHint(){desktopHintDismissed.value=true;try{sessionStorage.setItem(DESKTOP_HINT_KEY,'1');}catch{}}
function reloadNow(){try{window.location.reload();}catch{}}
// PWA 安装提示（docs/MOBILE-FIX.md §3C）：Chrome/Edge 触发 beforeinstallprompt 时出现「安装到桌面」
// （解构到顶层 ref，模板里才能自动 unwrap）
const { canInstall: installCanInstall, installed: installInstalled, install: installApp } = useInstallPrompt();
// 移动端筛选弹层：打开时回填当前值，「应用」才写入真实状态
const filterTemp = ref({ region:'cn', type:'all', sort:'discount', released:'all' });
const regionLabel = computed(()=>regions.find((r)=>r.code===region.value)?.label||region.value);
const typeLabel = computed(()=>({all:'全部类型',game:'游戏',dlc:'DLC'}[type.value]||'类型'));
const sortLabel = computed(()=>({discount:'折扣优先',price:'价格优先',name:'名称排序'}[sort.value]||'排序'));
function openFilterSheet(){filterTemp.value={region:region.value,type:type.value,sort:sort.value,released:released.value};filterDrawer.value=true;}
function applyFilter(){region.value=filterTemp.value.region;type.value=filterTemp.value.type;sort.value=filterTemp.value.sort;released.value=filterTemp.value.released;filterDrawer.value=false;saveLocalPrefs();loadGames(1);}
function resetFilter(){filterTemp.value={region:'cn',type:'all',sort:'discount',released:'all'};}
// 底部导航：首页/心愿单/已拥有/我的
const mNavItems=computed(()=>{const items=[{value:'all',label:'首页',icon:'🏠'}];if(user.value){items.push({value:'wishlist',label:'心愿单',icon:'★'},{value:'owned',label:'已拥有',icon:'✓'});}items.push({value:'me',label:'我的',icon:'☰'});return items;});
function mNavActive(value){if(value==='me')return false;return activeTab.value===value;}
function mNav(value){if(value==='me'){mySheet.value=true;return;}if(!user.value){goLogin();return;}setTab(value);}
const detailVisible=ref(false),detailLoading=ref(false),detail=ref(null),watchTarget=ref(''),watchExists=ref(false);
const offersPager=useListPagination(computed(()=>detail.value?.offers||[]));
const pagedOffers=offersPager.items,offersPage=offersPager.page,offersPageSize=offersPager.pageSize;
// Android 返回键（docs/MOBILE-PWA.md §2）：浮层打开时接管返回键，先关浮层再退出。
// 只在手机结构下登记——PC 端的浏览器返回保持原行为（验收第 6 条：PC 零变化）。
const backGuard = useBackGuard();
backGuard.guard(() => isMobile.value && filterDrawer.value, () => { filterDrawer.value = false; });
backGuard.guard(() => isMobile.value && mySheet.value, () => { mySheet.value = false; });
backGuard.guard(() => isMobile.value && noticeDrawer.value, () => { noticeDrawer.value = false; });
backGuard.guard(() => isMobile.value && noticeDialog.value, () => { noticeDialog.value = false; });
backGuard.guard(() => isMobile.value && detailVisible.value, () => { detailVisible.value = false; });
function money(cents, currency) { if (cents == null) return '暂无报价'; const symbols={CNY:'¥',USD:'$',HKD:'HK$',TWD:'NT$',JPY:'¥',RUB:'₽',TRY:'₺',ARS:'$'}; const fallback={cn:'CNY',hk:'HKD',tw:'TWD',us:'USD',jp:'JPY',ru:'RUB',tr:'TRY',ar:'ARS'}[region.value]||'CNY';const code=currency||fallback;return `${symbols[code] || code+' '}${(Number(cents)/100).toFixed(2)}`; }
function discount(g) { return Number(g.discount) || 0; }
function cover(g) { return g.steam_appid ? `/img/steam/${g.steam_appid}/header` : ''; }
// AW 批（docs/IMAGE-FETCH.md §3.5）：加载失败显示 CSS 占位块（渐变 + 游戏名首字），不再用 favicon 兜底
const coverFailed = ref(new Set());
const detailCoverFailed = ref(false);
function markCoverFailed(game) { if (!game?.id) return; const next = new Set(coverFailed.value); next.add(game.id); coverFailed.value = next; }
function firstChar(name) { return (String(name ?? '').trim().charAt(0) || '?').toUpperCase(); }
async function request(path, options) { const res=await fetch(path,{credentials:'same-origin',...options,headers:{'content-type':'application/json',...(options?.headers||{})}}); const raw=await res.text(); let data={}; try{data=raw?JSON.parse(raw):{}}catch{} if(res.status===401&&path!=='/api/me'&&path!=='/api/login'){router.push({path:'/login',query:{next:route.fullPath}});} if(!res.ok) throw new Error(data.error||`请求失败 (${res.status})`); return data; }
function localFlagIds(field,value){return Object.entries(guestGameFlags.value).filter(([,flags])=>flags?.[field]===value).map(([id])=>id).filter((id)=>/^\d{1,19}$/.test(id));}
// 游客只有本地 感兴趣/不感兴趣 标记；已拥有/愿望单不展示（规格 §6）
function visibleGames(rows){if(user.value)return rows;return rows.map((game)=>{const flags=guestGameFlags.value[String(game.id)]||{};return {...game,interested:typeof flags.interested==='boolean'?flags.interested:null,owned:false,wishlisted:false,wishlisted_by:[],site_wishlisted:false};});}
// 「已拥有」徽标文案：前两个账号名，更多显示 +N（详情页列全）
function ownedByText(game){const by=Array.isArray(game.owned_by)?game.owned_by:[];if(!by.length)return '';const names=by.map((a)=>a.name||a.steamId);if(by.length>2)return ` · ${names.slice(0,2).join('、')} +${by.length-2}`;return ` · ${names.join('、')}`;}
// 已拥有按钮三态：手动 true（可清除）→ 排除 false（可恢复）→ 未标记（跟随推导）
function ownedBtnLabel(game){if(game.user_owned===false)return '恢复已拥有';if(game.owned)return '✓ 已拥有';return '已拥有';}
async function toggleOwned(game){const uo=game.user_owned;if(uo===false)return setGameFlag(game,'owned','clear');if(game.owned)return setGameFlag(game,'owned',uo===true?'clear':false);return setGameFlag(game,'owned',true);}
async function loadGames(nextPage=1,append=false){gameRequestController?.abort();const controller=new AbortController();gameRequestController=controller;const seq=++requestSeq;loading.value=true;page.value=nextPage;const params={page:page.value,pageSize:pageSize.value,region:region.value,type:type.value,sort:sort.value,q:query.value.trim(),interest:activeTab.value==='on'?'on':activeTab.value==='off'?'off':'all',owned:activeTab.value==='owned'?'only':'exclude',wishlist:activeTab.value==='wishlist'?true:undefined,released:released.value,marks:activeTab.value==='all'?'unmarked':'any'};const cacheKey=params.q?`${params.q}|${params.region}|${params.sort}|${params.type}|${params.released}|${params.marks}|${params.interest}|${params.owned}|${params.wishlist?'w':''}|${params.page}|${params.pageSize}|${user.value?'u':'g'}|${guestFlagsRev.value}`:'';const cached=cacheKey&&!append?searchCache.get(cacheKey):null;if(cached&&Date.now()-cached.at<30000){applyGames(cached.data,seq,controller);loading.value=false;gameRequestController=null;return;}try{const interestedIds=localFlagIds('interested',true),uninterestedIds=localFlagIds('interested',false);const flags={interestedIds:activeTab.value==='on'?interestedIds:[],uninterestedIds:activeTab.value==='off'?uninterestedIds:[],excludeIds:activeTab.value==='all'?[...new Set([...interestedIds,...uninterestedIds])]:[]};const options=user.value?params:{...params,guestFlags:flags};const data=await request('/api/games/search',{method:'POST',body:JSON.stringify(options),signal:controller.signal});if(cacheKey&&!append)setCache(cacheKey,data);applyGames(data,seq,controller,append);}catch(e){if(e.name!=='AbortError'){if(!append)games.value=[];listNetworkError.value=e.name==='NetworkError';ElMessage.error(e.message);}}finally{if(gameRequestController===controller){gameRequestController=null;loading.value=false;}}}
// 网络恢复后的重试入口：重新拉用户态、列表、公告与计数（不做离线缓存，没网时仍会回到失败提示）
async function retryLoad(){await loadUser();await Promise.all([loadGames(page.value),loadNotices(),loadCounts(),loadSiteInfo()]);}
function applyGames(data,seq,controller,append=false){if(controller.signal.aborted||seq!==requestSeq)return;const rows=visibleGames(data.games||[]);games.value=append?[...games.value,...rows]:rows;total.value=Number(data.total)||0;pages.value=Number(data.pages)||0;listNetworkError.value=false;}
function setCache(key,data){searchCache.set(key,{at:Date.now(),data});if(searchCache.size>50){const first=searchCache.keys().next().value;searchCache.delete(first);}}
// 边打边查：300ms 防抖 + 中文输入法合成期不查 + 最短长度 + 回车立即 + 清空立即
let lastSearchedQ='';
function onSearchEnter(){clearTimeout(searchTimer);composing=false;lastSearchedQ=null;searchNow();}
function onCompositionEnd(){composing=false;scheduleSearch();}
function searchNow(){clearTimeout(searchTimer);lastSearchedQ=query.value.trim();syncUrlQuery();loadGames(1);}
function scheduleSearch(){if(composing)return;clearTimeout(searchTimer);const v=query.value.trim();if(v===lastSearchedQ)return;if(v===''){searchNow();return;}if(v.length>=2||/^\d{4,}$/.test(v)){searchTimer=setTimeout(searchNow,300);}}
function syncUrlQuery(){const q=query.value.trim();const next={...(route.query||{})};if(q)next.q=q;else delete next.q;router.replace({path:route.path,query:next}).catch(()=>{});}
watch(query,()=>{scheduleSearch();});
async function loadCounts(){try{const d=await request('/api/games/count');catalogCount.value=Number(d.catalog)||0;pricedCount.value=Number(d.priced)||0;}catch{}}
// 成人内容展示策略（docs/STEAM-SYNC-STATUS-AND-RATING.md §5.2）：hide=服务端已过滤；badge=带角标
async function loadSiteInfo(){try{const s=await request('/api/site');siteAdultDisplay.value=s.adultDisplay||'hide';}catch{/* 保持默认 hide */}}
async function changePageSize(value) { pageSize.value=value; await loadGames(1); }
// AF 批（docs/FRONTEND-STALE-LIST.md）：写操作成功后必须失效搜索缓存，否则 30 秒内 loadGames 命中旧缓存不刷新
function invalidateSearchCache(){searchCache.clear();}
function saveLocalPrefs(){try{localStorage.setItem('steamdeals.prefs.v1',JSON.stringify({tab:activeTab.value,sort:sort.value,region:region.value}));}catch{}}
async function savePrefs(){saveLocalPrefs();if(!user.value)return;try{await request('/api/prefs',{method:'POST',body:JSON.stringify({tab:activeTab.value,sort:sort.value,only_discount:false})});}catch{}}
async function setTab(value){activeTab.value=value;await savePrefs();await loadGames(1);}
async function changeSort(){await savePrefs();await loadGames(1);}
async function changeRegion(){saveLocalPrefs();await loadGames(1);}
async function loadUser(){try{const d=await request('/api/me');user.value=d.user||null;if(d.user?.mustChangePassword){router.replace('/change-password?forced=1');return;}if(d.timezone)siteTimezone.value=d.timezone;const local=(()=>{try{return JSON.parse(localStorage.getItem('steamdeals.prefs.v1')||'{}');}catch{return {};}})();region.value=local.region||'cn';if(user.value){guestGameFlags.value={};try{localStorage.removeItem(guestFlagsStorageKey);}catch{}const serverTheme=d.prefs?.theme;if(serverTheme==='light'||serverTheme==='dark'){if(theme.storedMode()!==serverTheme)theme.set(serverTheme);}else if(theme.storedMode()){persistTheme(theme.storedMode());}if(detailVisible.value&&detail.value?.game)await openDetail(detail.value.game);activeTab.value=d.prefs?.tab??'all';sort.value=d.prefs?.sort??'discount';}else{activeTab.value=['all','on','off'].includes(local.tab)?local.tab:'all';sort.value=local.sort||'discount';}}catch{user.value=null;}}
async function loadNotices() { try { const d=await request('/api/announcements'); notices.value=Array.isArray(d.announcements)?d.announcements:(Array.isArray(d)?d:[]); if(user.value){ noticeReadIds.value=(Array.isArray(d.readIds)?d.readIds:[]).map(Number); } else { const local=readLocalReadIds(); if(local===null)noticeReadIds.value=[]; else if(Array.isArray(local))noticeReadIds.value=local; else { noticeReadIds.value=legacyMaxAsReadIds(local.legacyMax); } } } catch { notices.value=[]; noticeReadIds.value=[]; } }
function dismissNotice(){/* 已被「已读 id 集合」机制取代，见 markNoticesRead */}
async function logout() { try { await request('/api/logout',{method:'POST',body:'{}'}); } finally { user.value=null;activeTab.value='all';await loadGames(1); } }
async function openDetail(game){detailVisible.value=true;detailLoading.value=true;detail.value=null;detailCoverFailed.value=false;watchExists.value=false;watchTarget.value='';try{const path=game.steam_appid?`/api/games/${game.steam_appid}`:`/api/games/by-id/${game.id}`;detail.value=await request(`${path}?region=${encodeURIComponent(region.value)}`);if(!user.value)refreshDetailFlags();if(user.value?.role==='admin'){const w=await request('/api/admin/watchlist').catch(()=>({watches:[]}));const found=(w.watches||[]).find(x=>Number(x.game_id)===Number(detail.value.game.id));if(found){watchExists.value=true;watchTarget.value=found.target_cents==null?'':(found.target_cents/100).toFixed(2);}}}catch(e){ElMessage.error(e.message);detailVisible.value=false;}finally{detailLoading.value=false;}}
function regionName(code){return regions.find(r=>r.code===code)?.label||code||'—';}
function isInterested(game){return user.value?game?.user_interested===true:game?.interested===true;}
function isUninterested(game){return user.value?game?.user_interested===false:game?.interested===false;}
function refreshDetailFlags(){if(!detail.value?.game)return;const g=detail.value.game;const flags=guestGameFlags.value[String(g.id)]||{};detail.value={...detail.value,game:{...g,interested:typeof flags.interested==='boolean'?flags.interested:null,owned:false,wishlisted:false}};}
// value：true / false / 'clear'（清除个人标记回退全局）
async function setGameFlag(game,kind,value){const id=String(game.id);if(!user.value){const next={...(guestGameFlags.value[id]||{})};if(value==='clear')delete next[kind];else next[kind]=value;if(Object.keys(next).length)guestGameFlags.value={...guestGameFlags.value,[id]:next};else{const copy={...guestGameFlags.value};delete copy[id];guestGameFlags.value=copy;}guestFlagsRev.value++;try{localStorage.setItem(guestFlagsStorageKey,JSON.stringify(guestGameFlags.value));}catch{ElMessage.warning('浏览器无法保存本地标记');}if(detail.value?.game?.id===game.id)refreshDetailFlags();invalidateSearchCache();await loadGames(page.value);return;}const body={[kind]:value};const path=game.steam_appid?`/api/games/${game.steam_appid}/flags`:`/api/games/id/${game.id}/flags`;try{await request(path,{method:'POST',body:JSON.stringify(body)});if(detail.value?.game?.id===game.id){const refreshed=await request(`${game.steam_appid?`/api/games/${game.steam_appid}`:`/api/games/by-id/${game.id}`}?region=${region.value}`);detail.value=refreshed;}invalidateSearchCache();await loadGames(page.value);}catch(e){ElMessage.error(e.message);}}
async function saveWatch(){if(!detail.value?.game)return;const raw=watchTarget.value.trim();const targetCents=raw===''?null:Math.round(Number(raw)*100);if(targetCents!==null&&(!Number.isFinite(targetCents)||targetCents<0))return ElMessage.warning('目标价不合法');try{await request('/api/admin/watchlist',{method:'POST',body:JSON.stringify({gameId:detail.value.game.id,targetCents})});watchExists.value=true;ElMessage.success('到价提醒已保存');}catch(e){ElMessage.error(e.message);}}
// ---- 手动愿望单（BE 批 docs/WISHLIST-SITE-ONLY.md §5）：只写本站，不再关联/推送 Steam ----
function wishGamePath(game){return game.steam_appid?`/api/wishlist/${game.steam_appid}`:`/api/wishlist/id/${game.id}`;}
function toggleWishlist(game){
  if(game.wishlisted)return removeWishlist(game);
  return addWishlist(game);
}
async function addWishlist(game){
  try{
    const payload=game.steam_appid?{appid:game.steam_appid}:{gameId:game.id};
    await request('/api/wishlist',{method:'POST',body:JSON.stringify(payload)});
    ElMessage.success('已加入本站愿望单');
    await refreshAfterWishlistChange(game);
  }catch(e){ElMessage.error(e.message);}
}
async function removeWishlist(game){
  try{
    await ElMessageBox.confirm(`确定从本站愿望单移除「${game.name||'该游戏'}」？`,'移除愿望单',{type:'warning',confirmButtonText:'移除',cancelButtonText:'取消'});
  }catch{return;}
  try{
    const d=await request(wishGamePath(game),{method:'DELETE',body:'{}'});
    ElMessage.success(d.siteRemoved?'已从愿望单移除':'未做任何移除');
    await refreshAfterWishlistChange(game);
  }catch(e){ElMessage.error(e.message);}
}
async function refreshAfterWishlistChange(game){
  if(detail.value?.game?.id===game.id){const refreshed=await request(`${game.steam_appid?`/api/games/${game.steam_appid}`:`/api/games/by-id/${game.id}`}?region=${region.value}`);detail.value=refreshed;}
  invalidateSearchCache();
  await loadGames(page.value);
}
async function deleteWatch(){try{await request(`/api/admin/watchlist/${detail.value.game.id}`,{method:'DELETE'});invalidateSearchCache();watchExists.value=false;watchTarget.value='';ElMessage.success('提醒已取消');}catch(e){ElMessage.error(e.message);}}
// AG 批（docs/ADMIN-PLATFORM-LINKS.md）：复制游戏名（clipboard API + execCommand 降级）
async function copyGameName(game){const ok=await copyText(game.name);ok?ElMessage.success('已复制'):ElMessage.warning('复制失败，请手动选择');}
onMounted(async()=>{try{desktopHintDismissed.value=sessionStorage.getItem(DESKTOP_HINT_KEY)==='1';}catch{}try{const p=JSON.parse(localStorage.getItem('steamdeals.prefs.v1')||'{}');activeTab.value=p.tab||'all';sort.value=p.sort||'discount';region.value=p.region||'cn';const flags=JSON.parse(localStorage.getItem(guestFlagsStorageKey)||'{}');guestGameFlags.value=flags&&typeof flags==='object'&&!Array.isArray(flags)?flags:{};}catch{}const urlQ=String(route.query.q||'').slice(0,80);if(urlQ){query.value=urlQ;lastSearchedQ=urlQ;}if(typeof window!=='undefined'&&window.matchMedia){narrowQuery=window.matchMedia('(max-width: 640px)');const onChange=(e)=>isNarrow.value=e.matches;narrowQuery.addEventListener?narrowQuery.addEventListener('change',onChange):narrowQuery.addListener(onChange);}applyMobile();refreshDebugInfo();window.addEventListener('resize',()=>{scheduleMobileCheck();refreshDebugInfo();});window.addEventListener('orientationchange',scheduleMobileCheck);await loadUser();await Promise.all([loadGames(),loadNotices(),loadCounts(),loadSiteInfo()]);if(unreadNoticeCount.value)noticeDialog.value=true;});
onBeforeUnmount(()=>{gameRequestController?.abort();clearTimeout(searchTimer);clearTimeout(mobileTimer);window.removeEventListener('resize',scheduleMobileCheck);window.removeEventListener('orientationchange',scheduleMobileCheck);});
</script>

<style scoped>
.store-tabs{display:flex;gap:7px;margin:2px 0 12px}.store-tabs button,.login-modes button{border:1px solid var(--border);border-radius:9px;background:var(--panel);color:var(--fg-muted);padding:8px 13px;font-size:12px;cursor:pointer}.store-tabs button.on,.login-modes button.on{background:var(--brand-soft);border-color:var(--brand-soft);color:var(--brand);font-weight:650}.flag-hint{margin:-4px 2px 12px;color:var(--fg-muted);font-size:11px}.game-card{cursor:pointer;content-visibility:auto;contain-intrinsic-size:0 360px}.card-flags{display:flex;gap:6px;margin-top:10px}.card-flags .el-button{flex:1;margin-left:0}.captcha-row,.email-code-row{display:flex;align-items:center;gap:9px;width:100%;margin-bottom:12px}.captcha-row img{width:132px;height:44px;border-radius:8px;cursor:pointer;background:#0f172a;flex:none}.captcha-retry{width:132px;height:44px;border-radius:8px;background:var(--panel-2);border:1px dashed var(--border-2);color:var(--fg-muted);font-size:11px;line-height:1.4;cursor:pointer;flex:none}.email-code-row .el-input{flex:1}.login-modes{display:flex;gap:6px;margin:0 0 17px}.login-help{display:block;color:var(--brand);font-size:11px;margin:7px 0;cursor:pointer}.login-submit{width:100%;margin-top:12px}.detail-dialog :deep(.el-dialog__body){padding-top:5px}.detail-cover{display:block;width:min(100%,520px);max-width:100%;height:auto;border-radius:10px;margin:0 auto 8px;background:var(--panel-2)}.detail-en{color:var(--fg-muted);font-size:12px}.detail-metrics{display:flex;gap:10px;flex-wrap:wrap;margin:13px 0}.detail-metrics>span{background:var(--panel-2);border:1px solid var(--border-2);border-radius:9px;padding:8px 11px;font-size:11px;color:var(--fg-muted)}.detail-metrics strong{display:block;color:var(--brand);font-size:17px;margin-top:3px}.detail-description{white-space:pre-wrap;max-height:140px;overflow:auto;color:var(--fg-muted);font-size:12px;line-height:1.65}.detail-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin:10px 0}.detail-actions .el-input{max-width:240px}.detail-dialog h3{font-size:13px;margin:16px 0 8px}.offer-list{display:grid;border:1px solid var(--border);border-radius:9px;overflow:hidden}.offer-row{display:grid;grid-template-columns:minmax(72px,.9fr) minmax(96px,1.1fr) 88px 88px 56px 68px;align-items:center;gap:8px;padding:9px 11px;border-bottom:1px solid var(--border);font-size:11px}.offer-row:last-child{border-bottom:0}.offer-row a,.detail-dialog>a{color:var(--brand)}.detail-loading{padding:48px 10px;text-align:center;color:var(--fg-muted)}.login-dialog{max-width:100%}@media(max-width:640px){.store-tabs{overflow:auto}.store-tabs button{white-space:nowrap}.offer-row{grid-template-columns:1fr auto auto;grid-template-areas:'plat price buy' 'meta meta meta';gap:4px 8px;padding:8px;font-size:11px}.offer-row>*:nth-child(1){grid-area:meta;justify-self:start;color:var(--fg-muted)}.offer-row>*:nth-child(2){grid-area:plat;justify-self:start}.offer-row>*:nth-child(3){grid-area:price;justify-self:end}.offer-row>*:nth-child(4){grid-area:meta;justify-self:start}.offer-row>*:nth-child(5){grid-area:meta;justify-self:start}.offer-row>*:nth-child(6){grid-area:buy;justify-self:end}.detail-actions .el-input{max-width:100%;flex-basis:100%}.detail-metrics>span{flex:1}}
.catalog-stat small{display:block;font-size:11px;color:var(--fg-subtle);font-weight:500;margin-top:3px}.catalog-priced{display:block;margin-top:5px;font-size:11px;color:var(--fg-muted)}.notice-dialog .notice-items{max-height:320px;overflow-y:auto;display:flex;flex-direction:column;gap:10px}.notice-item{border:1px solid var(--border);border-radius:10px;padding:12px 14px;background:var(--panel-2)}.notice-item.warning{border-color:var(--warn-soft);background:var(--warn-bg)}.notice-item.critical{border-color:var(--danger-soft);background:var(--danger-bg)}.notice-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}.notice-head strong{font-size:13px}.notice-item p{margin:0;color:var(--fg-muted);font-size:12px;line-height:1.6;white-space:pre-wrap}.card-flags .el-button{padding-left:6px;padding-right:6px}.m-flags{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}.theme-btn{font-size:17px}.detail-owned{margin:0 0 10px;padding:8px 12px;background:var(--panel-2);border:1px solid var(--border-2);border-radius:9px;font-size:12px;color:var(--fg-muted)}.owned-acct{cursor:help;color:var(--brand);font-weight:600}.detail-owned-tip{margin-left:8px;opacity:.7}.wish-pick-hint{margin:0 0 10px;color:var(--fg-muted);font-size:12px}.wish-pick-list{display:grid;gap:8px}.wish-pick-list .el-checkbox{height:auto;white-space:normal}.wish-pick-list small{display:block;color:var(--fg-subtle);font-size:10px;margin-left:24px}.buy-link{margin-left:auto;display:inline-flex;align-items:center}.buy-link .el-button{margin-left:0}.card-flags-sec{display:flex;gap:6px;flex:1}.card-flags-sec .el-button{flex:1;margin-left:0}.mobile-only{display:none}.desktop-only{display:flex}.toolbar-filters{display:flex;gap:8px;flex:1;align-items:center;min-width:0}.toolbar-filters .el-select{width:auto;flex:0 1 auto}.filter-drawer-body{display:grid;gap:10px;padding:4px 2px}.filter-label{font-size:12px;color:var(--fg-muted);margin-top:6px}.filter-full{width:100%}.filter-apply{margin-top:10px;min-height:44px}.notice-badge{display:inline-flex;align-items:center}.notice-badge .el-badge__content{transform:translateY(-2px) translateX(2px)}.notice-drawer-body{display:flex;flex-direction:column;gap:10px}.notice-item.read{opacity:.62}.notice-item.unread{border-color:var(--brand-soft);background:var(--brand-soft)}.notice-time{display:block;margin-top:6px;font-size:11px;color:var(--fg-subtle)}.mobile-full{width:100%!important;max-width:100%!important;height:100%;max-height:100%;height:100dvh;max-height:100dvh;margin:0!important;border-radius:0;top:0}.mobile-full :deep(.el-dialog__body){padding:10px 14px 96px;overflow-y:auto}.mobile-full :deep(.el-dialog__header){padding:12px 14px 6px}.m-detail-bar{position:fixed;left:0;right:0;bottom:0;z-index:2200;display:flex;gap:8px;padding:10px 12px calc(10px + env(safe-area-inset-bottom));background:var(--panel);border-top:1px solid var(--border)}.m-detail-bar .el-button{flex:1;min-height:44px;margin-left:0}.m-detail-bar a{flex:1}.m-detail-bar a .el-button{width:100%}.m-storefront{font-size:14px;padding-bottom:calc(64px + env(safe-area-inset-bottom))}.m-topbar{position:sticky;top:0;z-index:20;height:52px;background:var(--glass);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;padding:0 14px;backdrop-filter:blur(14px)}.m-brand{font-size:15px}.m-brand .brand-mark{width:30px;height:30px;border-radius:9px}.m-topbar-actions{display:flex;align-items:center;gap:4px}.m-search-row{display:flex;gap:8px;padding:10px 14px 0}.m-search{flex:1}.m-search-row :deep(.el-input__wrapper){min-height:44px}.m-filter-btn{min-height:44px;height:44px}.m-chips{display:flex;gap:8px;overflow-x:auto;padding:10px 14px 0;scrollbar-width:none}.m-chips::-webkit-scrollbar{display:none}.m-chip{flex:0 0 auto;min-height:36px;padding:6px 12px;border:1px solid var(--border);border-radius:999px;background:var(--panel);color:var(--fg-muted);font-size:14px}.m-chip.on{background:var(--brand-soft);border-color:var(--brand-soft);color:var(--brand)}.m-tabs{display:flex;margin:12px 14px 0;border-radius:12px;overflow:hidden;border:1px solid var(--border)}.m-tabs button{flex:1;min-height:44px;background:var(--panel);border:0;color:var(--fg-muted);font-size:15px}.m-tabs button.on{background:var(--brand-soft);color:var(--brand);font-weight:650}.m-result-line{padding:12px 14px 4px;color:var(--fg-muted);font-size:13px}.m-skeleton,.m-empty{padding:0 14px}.m-game-list{display:grid;gap:12px;padding:8px 14px 16px}.m-game-card{background:var(--panel);border:1px solid var(--border);border-radius:14px;overflow:hidden;box-shadow:0 3px 14px #26345a06}.m-cover{position:relative}.m-cover img{display:block;width:100%;max-width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;background:var(--panel-2)}.m-discount{position:absolute;left:10px;top:10px;background:var(--danger);color:#fff;font-size:13px;font-weight:700;padding:3px 9px;border-radius:9px}.m-card-body{padding:12px 14px 14px}.m-title{font-size:16px;font-weight:700;line-height:1.45}.m-subtitle{font-size:11px;color:var(--fg-muted);margin-top:2px}.m-price-row{display:flex;align-items:baseline;gap:8px;margin-top:8px}.m-price-row strong{font-size:21px;color:var(--brand);font-weight:800}.m-price-row del{font-size:13px;color:var(--fg-subtle)}.m-platform{margin-left:auto;font-size:12px;color:var(--fg-muted)}.m-tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.m-actions{display:flex;gap:8px;margin-top:12px}.m-actions .el-button{flex:1;min-height:44px;margin-left:0}.m-actions a{flex:1}.m-actions a .el-button{width:100%}.m-loadmore-wrap{padding:0 14px 14px}.m-loadmore{width:100%;min-height:44px}.m-bottomnav{position:fixed;left:0;right:0;bottom:0;z-index:30;display:flex;min-height:56px;background:var(--glass);border-top:1px solid var(--border);padding:6px 4px calc(6px + env(safe-area-inset-bottom));backdrop-filter:blur(14px)}.m-bottomnav button{flex:1;display:grid;place-items:center;gap:2px;background:none;border:0;color:var(--fg-muted);font-size:12px;min-height:48px}.m-bottomnav button.on{color:var(--brand)}.m-nav-icon{font-size:18px}.m-filter-sheet :deep(.el-drawer__body){padding:16px 16px 8px;max-height:70vh;overflow-y:auto}.m-filter-body{display:grid;gap:14px}.m-filter-group label{display:block;font-size:14px;color:var(--fg-muted);margin-bottom:8px}.m-radio-row{display:flex;flex-wrap:wrap;gap:8px}.m-radio-row button{min-height:44px;padding:8px 14px;border:1px solid var(--border);border-radius:10px;background:var(--panel);color:var(--fg);font-size:14px}.m-radio-row button.on{background:var(--brand-soft);border-color:var(--brand);color:var(--brand);font-weight:650}.m-filter-footer{display:flex;gap:8px;padding:6px 0 calc(6px + env(safe-area-inset-bottom))}.m-filter-footer .el-button{flex:1;min-height:44px;margin-left:0}.m-my-body{display:grid;gap:8px;padding-bottom:calc(6px + env(safe-area-inset-bottom))}.m-my-body .el-button{margin-left:0;min-height:44px}.m-desktop-hint{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;padding:9px 14px;background:var(--warn-bg);border-bottom:1px solid var(--warn-soft);color:var(--warn);font-size:12px;line-height:1.5}.m-desktop-hint-actions{display:flex;gap:8px;flex:none}.m-desktop-hint-actions button{min-height:36px;padding:4px 14px;border:1px solid currentColor;border-radius:9px;background:transparent;color:inherit;font:inherit;cursor:pointer}.m-install-bar{display:flex;justify-content:center;padding:8px 14px;background:var(--brand-soft);border-bottom:1px solid var(--brand-2)}.m-install-btn{min-height:44px;padding:8px 22px;border:0;border-radius:10px;background:var(--brand);color:#fff;font-size:14px;font-weight:650;cursor:pointer}.m-sheet-note{padding:10px 12px;border:1px solid var(--border-2);border-radius:10px;background:var(--panel-2);color:var(--fg-muted);font-size:12px;line-height:1.6}.m-debug-bar{position:fixed;top:0;left:0;right:0;z-index:99999;background:#101418;color:#4ade80;font:11px/1.5 ui-monospace,Consolas,monospace;padding:5px 10px;word-break:break-all;opacity:.95}
/* AW 批（docs/IMAGE-FETCH.md §3.5）：封面失败/无 AppID 显示占位块（渐变 + 首字），不再用 favicon 兜底 */
.cover-placeholder{display:none;position:absolute;inset:0;align-items:center;justify-content:center;font-size:42px;font-weight:800;color:var(--fg-subtle);background:linear-gradient(130deg,var(--brand-soft),var(--bg-2));letter-spacing:-.02em}
.img-failed .cover-placeholder{display:flex}
.img-failed img{display:none}
.m-cover{position:relative}
.m-cover .cover-placeholder{font-size:50px}
.detail-cover-ph{display:flex;align-items:center;justify-content:center;height:240px;background:linear-gradient(130deg,var(--brand-soft),var(--bg-2))}
.detail-cover-ph .cover-placeholder{display:flex;position:static;background:transparent;font-size:64px}
</style>



