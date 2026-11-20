<template>
  <div :class="['storefront', isMobile ? 'm-storefront' : '']">
    <div v-if="debugOn" class="m-debug-bar">{{ debugInfo }}</div>
    <!-- ============ PC 头部 ============ -->
    <template v-if="!isMobile">
      <header class="topbar">
        <a class="brand" href="/"><span class="brand-mark">S</span><span>SteamDeals<small>游戏价格情报</small></span></a>
        <div class="top-actions"><el-badge :value="unreadNoticeCount" :hidden="unreadNoticeCount===0" class="notice-badge"><el-button text class="theme-btn" title="站点通知" @click="noticeDrawer=true"><el-icon><Bell /></el-icon></el-button></el-badge><el-button text class="theme-btn" :title="themeMode === 'dark' ? '切换亮色' : '切换暗色'" @click="toggleTheme">{{ themeMode === 'dark' ? '🌞' : '🌙' }}</el-button><button v-if="user" class="user-chip" title="我的资料" @click="router.push('/console?section=profile')"><UserAvatar :user-id="user.id" :name="user.displayName || user.username" :size="24" /><span class="user-label">{{ user.displayName || user.username }}</span></button><el-button v-if="!user" plain @click="goLogin">登录</el-button><template v-else><el-button plain @click="router.push('/change-password')">修改密码</el-button><el-button plain @click="logout">退出</el-button></template><el-button v-if="user?.role === 'admin'" type="primary" @click="router.push('/console')">管理后台</el-button></div>
      </header>
      <main class="store-main store-head">
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
          <el-select v-model="sort" class="filter-select" aria-label="排序" @change="changeSort"><el-option label="折扣优先" value="discount"/><el-option label="价格优先" value="price"/><el-option label="名称排序" value="name"/><el-option label="综合评分" value="score"/></el-select>
          <el-select v-model="reviewMin" class="filter-select" aria-label="好评率" @change="loadGames(1)"><el-option label="好评率不限" :value="0"/><el-option label="≥7" :value="7"/><el-option label="≥8" :value="8"/><el-option label="≥9" :value="9"/></el-select>
          <el-select v-model="deck" class="filter-select" aria-label="Steam Deck" @change="loadGames(1)"><el-option label="Deck 全部" value="all"/><el-option label="Deck 仅认证" value="verified"/><el-option label="Deck 可玩及以上" value="playable"/><el-option label="Deck 不支持" value="unsupported"/></el-select>
          <!-- EF 批（docs/STEAM-SYNC-STATUS-AND-RATING.md §9）：18R 筛选开关——选中=只看 18R（adult=badge&rating=adult），
               取消恢复全部；与 App 的 18R chip 对齐。 -->
          <el-button :type="adultFilter?'danger':'default'" :plain="!adultFilter" class="filter-select" aria-label="18R 筛选" @click="toggleAdult">{{ adultFilter ? '18R ✓' : '18R' }}</el-button>
          <el-button :loading="loading" @click="loadGames(page)">刷新</el-button>
        </section>
      </main>
    </template>
    <!-- ============ 移动头部 ============ -->
    <template v-else>
      <header class="m-topbar">
        <a class="brand m-brand" href="/"><span class="brand-mark">S</span><span>SteamDeals</span></a>
        <div class="m-topbar-actions"><el-badge :value="unreadNoticeCount" :hidden="unreadNoticeCount===0" class="notice-badge"><el-button text class="theme-btn" title="站点通知" @click="noticeDrawer=true"><el-icon><Bell /></el-icon></el-button></el-badge><el-button text class="theme-btn" title="菜单" @click="mySheet=true">☰</el-button></div>
      </header>
      <div v-if="desktopMode && !desktopHintDismissed" class="m-desktop-hint" role="status"><span>检测到浏览器按「桌面版网站」渲染，建议在浏览器菜单关闭后刷新，获得完整手机版体验</span><div class="m-desktop-hint-actions"><button type="button" @click="reloadNow">刷新</button><button type="button" aria-label="关闭提示" @click="dismissDesktopHint">✕</button></div></div>
      <div v-if="installCanInstall" class="m-install-bar"><button type="button" class="m-install-btn" @click="installApp()">安装到桌面</button></div>
      <div class="m-search-row"><el-input v-model="query" clearable placeholder="搜索游戏名或 AppID" class="m-search" @keyup.enter="onSearchEnter" @compositionstart="composing = true" @compositionend="onCompositionEnd"><template #prefix><el-icon><Search /></el-icon></template></el-input><el-button class="m-filter-btn" @click="openFilterSheet"><el-icon><Filter /></el-icon>筛选</el-button></div>
      <div class="m-chips"><button class="m-chip" @click="openFilterSheet">{{ regionLabel }} ▾</button><button class="m-chip" @click="openFilterSheet">{{ typeLabel }} ▾</button><button class="m-chip" @click="openFilterSheet">{{ sortLabel }} ▾</button><button v-if="released!=='all'" class="m-chip on" @click="released='all';loadGames(1)">发行筛选 ✕</button><button v-if="adultFilter" class="m-chip on" @click="toggleAdult">18R ✕</button></div>
      <div class="m-tabs"><button :class="{on:activeTab==='all'}" @click="setTab('all')">全部</button><button :class="{on:activeTab==='on'}" @click="setTab('on')">感兴趣</button><button :class="{on:activeTab==='off'}" @click="setTab('off')">不感兴趣</button><button v-if="user" :class="{on:activeTab==='watchlist'}" @click="setTab('watchlist')">提醒</button></div><button v-if="user" :class="{on:activeTab==='foryou'}" @click="setTab('foryou');loadForYou()">为你推荐</button>
    </template>
    <!-- ============ 共享列表区（CO-4/D4 合并试点：CSS 优先、同结构响应式适配；断点判定仍走 isMobile） ============ -->
    <main :class="isMobile ? 'm-store-main' : 'store-main store-body'">
      <div v-if="!isMobile || activeTab!=='watchlist'" :class="['result-line', isMobile ? 'm-result-line' : '']"><span>{{ loading ? (isMobile ? '正在加载…' : '正在加载游戏…') : `找到 ${total.toLocaleString()} 款游戏` }}</span><span v-if="!isMobile">价格与地区货币以商店显示为准</span></div>
      <div v-if="activeTab==='watchlist'" :class="isMobile ? 'm-watch-list' : 'module-card watchlist'">
        <div v-if="watchListLoading && !watchList.length" class="muted">加载中…</div>
        <el-empty v-else-if="!watchList.length" description="还没有到价提醒。在游戏详情页设置目标价，降价第一时间知道。"/>
        <template v-else>
          <div v-for="w in watchList" :key="w.id" :class="isMobile ? 'm-watch-row' : 'watch-row'">
            <span :class="isMobile ? 'm-watch-name' : 'watch-name'" @click="openDetail(w)">{{ w.name }}</span>
            <template v-if="!isMobile"><span class="watch-target">{{ w.target_cents==null?'史低提醒':'目标 '+watchMoney(w.target_cents,'CNY') }}</span><span class="watch-now">当前 {{ watchMoney(w.current_cents,w.currency) }}</span><span class="watch-hist">史低 {{ watchMoney(w.hist_low,w.currency) }}</span><span class="watch-time">{{ w.created_at ? fmtDay(w.created_at) : '' }}</span></template>
            <span v-else class="m-watch-info">{{ w.target_cents==null?'史低提醒':'目标 '+watchMoney(w.target_cents,'CNY') }} · 当前 {{ watchMoney(w.current_cents,w.currency) }}</span>
            <el-button size="small" type="danger" plain @click="cancelWatchFromList(w)">取消</el-button>
          </div>
          <div v-if="!isMobile && watchListTotal>20"><el-pagination layout="prev, pager, next" :total="watchListTotal" :page-size="20" :current-page="watchListPage" @current-change="loadWatchList"/></div>
          <div v-if="isMobile && watchListTotal>20" class="m-loadmore-wrap"><el-button class="m-loadmore" :loading="watchListLoading" @click="loadWatchList(watchListPage+1)">加载更多</el-button></div>
        </template>
      </div>
      <div v-if="activeTab==='foryou' && !isMobile" class="module-card foryou"><div v-if="!forYou.profile" class="muted">绑定 Steam 账号后解锁个性化推荐。<el-button link type="primary" @click="openSteamBind">去绑定</el-button></div><div v-else class="foryou-list"><div v-for="g in forYou.games" :key="g.id" class="foryou-item"><span class="game-title">{{ g.name }}</span><small v-if="g.because" class="muted">因为你玩过 {{ g.because }}</small><strong>{{ money(g.min_price) }}</strong></div><el-empty v-if="!forYou.games.length" description="暂无推荐（绑定账号并同步游戏库后出现）"/></div></div>
      <el-skeleton v-if="activeTab!=='watchlist' && loading && !games.length" :rows="isMobile ? 4 : 6" :class="isMobile ? 'm-skeleton' : ''" animated />
      <el-empty v-else-if="activeTab!=='watchlist' && !games.length && listNetworkError" :class="isMobile ? 'm-empty' : ''" :description="NETWORK_ERROR_MESSAGE"><el-button type="primary" @click="retryLoad">重试</el-button></el-empty>
      <el-empty v-else-if="activeTab!=='watchlist' && !games.length" :class="isMobile ? 'm-empty' : ''" description="没有找到匹配的游戏" />
      <section v-else-if="activeTab!=='watchlist'" :class="isMobile ? 'game-grid m-game-list' : 'game-grid'">
        <article v-for="game in games" :key="game.game_id || game.id" :class="isMobile ? 'game-card m-game-card' : 'game-card'" @click="openDetail(game)">
          <div class="cover-wrap" :class="[{ 'img-failed': !game.steam_appid || coverFailed.has(game.id) }, isMobile ? 'm-cover' : '']"><img v-if="game.steam_appid" :src="cover(game)" :alt="game.name" loading="lazy" decoding="async" fetchpriority="low" @error="markCoverFailed(game)"/><span class="cover-placeholder"><CoverPlaceholder :name="game.name" fill/></span><span v-if="discount(game)" :class="isMobile ? 'discount m-discount' : 'discount'">-{{ discount(game) }}%</span></div>
          <div :class="isMobile ? 'game-info m-card-body' : 'game-info'">
            <div :class="isMobile ? 'game-title m-title' : 'game-title'" :title="game.name">{{ game.name }}<el-button v-if="!isMobile" link class="title-copy" title="复制游戏名" @click.stop="copyGameName(game)"><el-icon><CopyDocument /></el-icon></el-button></div>
            <div v-if="game.name_en && game.name_en !== game.name" :class="isMobile ? 'game-subtitle m-subtitle' : 'game-subtitle'">{{ game.name_en }}</div>
            <div class="m-flags mobile-only"><el-tag v-if="game.steam_status==='region_locked'" size="small" type="danger" effect="plain">国区不可售</el-tag><el-tag v-if="game.steam_status==='coming_soon'" size="small" type="warning" effect="plain">未发售</el-tag><el-tag v-if="game.mature_flag" size="small" type="warning" effect="plain">成熟内容</el-tag><el-tag v-if="game.adult_flag && (siteAdultDisplay==='badge'||adultFilter)" size="small" type="danger" effect="plain">18+</el-tag></div>
            <div :class="isMobile ? 'price-row m-price-row' : 'price-row'">
              <div><strong>{{ money(game.current_low, game.currency) }}</strong><del v-if="game.current_original > game.current_low">{{ money(game.current_original, game.currency) }}</del></div>
              <div class="price-tags desktop-only"><el-tag v-if="game.is_free" size="small" type="success" effect="plain"><a :href="`https://store.steampowered.com/app/${game.steam_appid}/`" target="_blank" rel="noopener" @click.stop>免费领取</a></el-tag><el-tag v-if="deckLabel(game.deck_compat)" size="small" type="info" effect="plain" :title="'Steam Deck'">{{ deckLabel(game.deck_compat) }}</el-tag><el-tag v-if="game.review_score" size="small" effect="plain" :class="reviewClass(game.review_score)" :title="game.review_score_desc||'好评率'">好评 {{ game.review_score }}/9</el-tag><el-tag v-if="game.steam_status==='region_locked'" size="small" type="danger" effect="plain">国区不可售</el-tag><el-tag v-if="game.steam_status==='coming_soon'" size="small" type="warning" effect="plain">未发售</el-tag><el-tag v-if="game.mature_flag" size="small" type="warning" effect="plain">成熟内容</el-tag><el-tag v-if="game.adult_flag && (siteAdultDisplay==='badge'||adultFilter)" size="small" type="danger" effect="plain">18+</el-tag><el-tag v-if="game.prev_hist_low != null && game.current_low < game.prev_hist_low" size="small" type="success" effect="plain">新史低</el-tag><el-tag v-if="user && game.owned" size="small" type="warning">已拥有{{ ownedByText(game) }}</el-tag><el-tag v-if="user && game.wishlisted" size="small" type="success" effect="plain">愿望单</el-tag><el-tag v-else-if="game.interested===false" size="small" effect="plain">不感兴趣</el-tag></div>
              <span class="m-platform mobile-only">{{ game.low_platform_name || 'Steam' }}</span>
            </div>
            <div class="m-tags mobile-only"><el-tag v-if="game.prev_hist_low != null && game.current_low < game.prev_hist_low" size="small" type="success" effect="plain">新史低</el-tag><el-tag v-if="user && game.owned" size="small" type="warning">已拥有{{ ownedByText(game) }}</el-tag><el-tag v-if="user && game.wishlisted" size="small" type="success" effect="plain">愿望单</el-tag></div>
            <div class="card-foot desktop-only"><span>{{ game.low_platform_name || 'Steam' }}</span><a v-if="game.steam_appid" class="buy-link" :href="`https://store.steampowered.com/app/${game.steam_appid}/`" target="_blank" rel="noopener" @click.stop><el-button size="small" type="primary">购买</el-button></a><a v-if="game.steam_appid" :href="`https://store.steampowered.com/app/${game.steam_appid}/`" target="_blank" rel="noopener" @click.stop>商店 ↗</a></div>
            <div class="card-flags desktop-only" @click.stop>
              <el-button size="small" :type="isInterested(game) ? 'primary' : 'default'" :plain="!isInterested(game)" @click="setGameFlag(game, 'interested', isInterested(game) ? 'clear' : true)">{{ isInterested(game) ? '✓ 感兴趣' : '感兴趣' }}</el-button>
              <el-button size="small" :type="isUninterested(game) ? 'danger' : 'default'" :plain="!isUninterested(game)" @click="setGameFlag(game, 'interested', isUninterested(game) ? 'clear' : false)">{{ isUninterested(game) ? '✓ 不感兴趣' : '不感兴趣' }}</el-button>
              <div class="card-flags-sec">
                <el-button v-if="user" size="small" :type="game.owned ? 'warning' : 'default'" :plain="!game.owned" @click="toggleOwned(game)">{{ ownedBtnLabel(game) }}</el-button>
                <el-button v-if="user" size="small" :type="game.wishlisted ? 'success' : 'default'" :plain="!game.wishlisted" @click="toggleWishlist(game)">{{ game.wishlisted ? '✓ 愿望单' : '愿望单' }}</el-button>
              </div>
            </div>
            <div class="m-actions mobile-only" @click.stop><el-button size="small" :type="isInterested(game) ? 'primary' : 'default'" :plain="!isInterested(game)" @click="setGameFlag(game, 'interested', isInterested(game) ? 'clear' : true)">{{ isInterested(game) ? '✓ 感兴趣' : '感兴趣' }}</el-button><el-button size="small" :type="isUninterested(game) ? 'danger' : 'default'" :plain="!isUninterested(game)" @click="setGameFlag(game, 'interested', isUninterested(game) ? 'clear' : false)">{{ isUninterested(game) ? '✓ 不感兴趣' : '不感兴趣' }}</el-button><a v-if="game.steam_appid" :href="`https://store.steampowered.com/app/${game.steam_appid}/`" target="_blank" rel="noopener"><el-button size="small" type="primary">购买</el-button></a></div>
          </div>
        </article>
      </section>
      <div v-if="!isMobile" class="pagination"><el-pagination v-if="activeTab!=='watchlist' && pages > 1" background layout="prev, pager, next, sizes" :total="total" :page-size="pageSize" :current-page="page" :page-sizes="[20,50,100]" @current-change="loadGames" @size-change="changePageSize" /></div>
      <div v-if="isMobile && activeTab!=='watchlist' && page < pages" class="m-loadmore-wrap"><el-button class="m-loadmore" :loading="loading" @click="loadGames(page + 1, true)">加载更多</el-button></div>
      <footer v-if="!isMobile" class="store-footer">价格信息仅供参考，实际售价以商店结算页面为准。<a href="/app" class="footer-app-link">安卓版 App</a></footer>
    </main>
    <!-- ============ 移动专属：底导与抽屉 ============ -->
    <template v-if="isMobile">
      <footer class="m-bottomnav"><button v-for="item in mNavItems" :key="item.value" :class="{on:mNavActive(item.value)}" @click="mNav(item.value)"><span class="m-nav-icon">{{ item.icon }}</span><span>{{ item.label }}</span></button></footer>
      <el-drawer v-model="filterDrawer" direction="btt" size="auto" class="m-filter-sheet"><div class="m-filter-body"><div class="m-filter-group"><label>地区</label><div class="m-radio-row"><button v-for="r in regions" :key="r.code" :class="{on:filterTemp.region===r.code}" @click="filterTemp.region=r.code">{{ r.label }}</button></div></div><div class="m-filter-group"><label>游戏类型</label><div class="m-radio-row"><button :class="{on:filterTemp.type==='all'}" @click="filterTemp.type='all'">全部</button><button :class="{on:filterTemp.type==='game'}" @click="filterTemp.type='game'">游戏</button><button :class="{on:filterTemp.type==='dlc'}" @click="filterTemp.type='dlc'">DLC</button></div></div><div class="m-filter-group"><label>排序</label><div class="m-radio-row"><button :class="{on:filterTemp.sort==='discount'}" @click="filterTemp.sort='discount'">折扣优先</button><button :class="{on:filterTemp.sort==='price'}" @click="filterTemp.sort='price'">价格优先</button><button :class="{on:filterTemp.sort==='name'}" @click="filterTemp.sort='name'">名称排序</button></div></div><div class="m-filter-group"><label>发行时间</label><div class="m-radio-row"><button :class="{on:filterTemp.released==='all'}" @click="filterTemp.released='all'">全部</button><button :class="{on:filterTemp.released==='30d'}" @click="filterTemp.released='30d'">近 30 天</button><button :class="{on:filterTemp.released==='1y'}" @click="filterTemp.released='1y'">近 1 年</button><button :class="{on:filterTemp.released==='3y'}" @click="filterTemp.released='3y'">近 3 年</button></div></div><div class="m-filter-group"><label>18R</label><div class="m-radio-row"><button :class="{on:filterTemp.adult===true}" @click="filterTemp.adult=true">只看 18R</button><button :class="{on:filterTemp.adult!==true}" @click="filterTemp.adult=false">全部</button></div></div><div class="m-filter-footer"><el-button @click="resetFilter">重置</el-button><el-button type="primary" @click="applyFilter">应用筛选</el-button></div></div></el-drawer>
      <el-drawer v-model="mySheet" direction="btt" size="auto" class="m-filter-sheet"><div class="m-my-body"><div v-if="desktopMode" class="m-sheet-note">浏览器正在按「桌面版网站」渲染：请在浏览器菜单关闭该选项后刷新，可获得完整手机版体验。</div><div v-if="!installInstalled" class="m-sheet-note">安装到桌面：请用 Chrome 打开本站 → 菜单 →「安装应用」；若之前建过快捷方式，请先删除旧图标再重新安装。</div><el-button block @click="mySheet=false;router.push('/app')">📱 安卓版 App</el-button><el-button block @click="mySheet=false;checkUpdate()">🔄 检查更新</el-button><el-button block @click="mySheet=false;noticeDrawer=true">🔔 站点通知{{ unreadNoticeCount?`（${unreadNoticeCount} 未读）`:'' }}</el-button><el-button block @click="mySheet=false;toggleTheme()">{{ themeMode==='dark'?'🌞 切换亮色':'🌙 切换暗色' }}</el-button><el-button v-if="!user" block type="primary" @click="mySheet=false;goLogin()">登录</el-button><template v-else><el-button block @click="mySheet=false;router.push('/console?section=profile')">👤 我的资料</el-button><el-button block @click="mySheet=false;router.push('/change-password')">修改密码</el-button><el-button block @click="mySheet=false;logout()">退出（{{ user.displayName || user.username }}）</el-button></template><el-button v-if="user?.role === 'admin'" block @click="mySheet=false;router.push('/console')">管理后台</el-button></div></el-drawer>
    </template>
    <el-dialog v-model="detailVisible" :title="detail?.game?.name||'游戏详情'" :width="isMobile ? '100%' : (isNarrow ? '96vw' : '880px')" :class="['detail-dialog', isMobile ? 'mobile-full' : '']"><div v-if="detailLoading" class="detail-loading">正在加载游戏详情…</div><template v-else-if="detail?.game"><div v-if="!(user && detail.game.owned)" class="detail-copy-row"><el-button link size="small" title="复制游戏名" @click="copyGameName(detail.game)"><el-icon><CopyDocument /></el-icon>复制游戏名</el-button></div><img v-if="detail.game.steam_appid && !detailCoverFailed" class="detail-cover" :src="`/img/steam/${detail.game.steam_appid}/header`" @error="detailCoverFailed = true"><div v-if="!detail.game.steam_appid || detailCoverFailed" class="detail-cover detail-cover-ph"><span class="cover-placeholder"><CoverPlaceholder :name="detail.game.name" fill/></span></div><p class="detail-en">{{ detail.game.name_en }}</p><div class="detail-metrics"><span>当前最低 <strong>{{ money(detail.game.current_low,detail.game.currency) }}</strong></span><span>历史最低 <strong>{{ money(detail.game.hist_low,detail.game.currency) }}</strong></span><span>折扣 <strong>{{ discount(detail.game) }}%</strong></span></div><div v-if="user && detail.game.owned_by?.length" class="detail-owned">已拥有账号：<span v-for="(acct,i) in detail.game.owned_by" :key="acct.steamId" class="owned-acct" :title="acct.steamId">{{ acct.name }}<template v-if="i < detail.game.owned_by.length - 1">、</template></span><span class="detail-owned-tip">（悬停查看 SteamID）</span></div><div v-if="user && detail.game.site_wishlisted" class="detail-owned">本站愿望单 <el-tag size="small" type="success">已加入</el-tag></div><p class="detail-description">{{ detail.game.description||'暂无游戏介绍。' }}</p><template v-if="user && detail.game.owned"><div class="detail-owned-final">✓ 已拥有 · <span v-for="(acct,i) in (detail.game.owned_by||[])" :key="acct.steamId" class="owned-acct" :title="acct.steamId">{{ acct.name }}<template v-if="i < (detail.game.owned_by||[]).length - 1">、</template></span></div><div class="detail-actions"><a v-if="detail.game.steam_appid" :href="`https://store.steampowered.com/app/${detail.game.steam_appid}/`" target="_blank" rel="noopener"><el-button type="primary">去 Steam 商店</el-button></a></div></template><template v-else><div class="buy-row"><a v-if="detail.game.steam_appid" :href="`https://store.steampowered.com/app/${detail.game.steam_appid}/`" target="_blank" rel="noopener"><el-button type="primary">去 Steam 购买 {{ money(detail.game.current_low,detail.game.currency) }}</el-button></a></div><p class="sec-label">我的标记</p><div class="detail-chips"><button class="detail-chip" :class="{on:isInterested(detail.game)}" @click="setGameFlag(detail.game, 'interested', isInterested(detail.game) ? 'clear' : true)"><span v-if="isInterested(detail.game)" class="tick">✓</span>感兴趣</button><button class="detail-chip" :class="{on:isUninterested(detail.game)}" @click="setGameFlag(detail.game, 'interested', isUninterested(detail.game) ? 'clear' : false)"><span v-if="isUninterested(detail.game)" class="tick">✓</span>不感兴趣</button><button v-if="user" class="detail-chip" :class="{on:detail.game.wishlisted}" @click="toggleWishlist(detail.game)"><span v-if="detail.game.wishlisted" class="tick">✓</span>愿望单</button><button v-else class="detail-chip" @click="goLogin">愿望单</button></div><div class="alert-block"><template v-if="!user"><div class="alert-title">🔔 到价提醒</div><div class="ref">登录后设置到价提醒。<el-button link type="primary" @click="goLogin">去登录</el-button></div></template><template v-else-if="isMobile && !watchOpen"><div class="alert-fold" @click="watchOpen=true"><span class="l">🔔 到价提醒<template v-if="watchExists"><span class="watch-pill">提醒中 ¥{{ watchTarget }}</span></template></span><span class="r">调整 ▾</span></div></template><template v-else><div class="alert-title">🔔 到价提醒</div><div class="ref">当前 <b>{{ money(detail.game.current_low,detail.game.currency) }}</b> · 史低 <b>{{ money(detail.game.hist_low,detail.game.currency) }}</b></div><div v-if="watchExists" class="saved"><span class="watch-pill">提醒中 ¥{{ watchTarget || '史低' }}</span><el-button link type="danger" @click="deleteWatch">取消提醒</el-button></div><div class="input-row"><span class="money-box">¥<input v-model="watchTarget" placeholder="留空 = 跌到史低时提醒"/></span><el-button size="small" :disabled="detail.game.hist_low==null" @click="setWatchHistLow">按史低</el-button><el-button size="small" :disabled="detail.game.current_low==null" @click="setWatchDiscount10">减 10%</el-button><el-button size="small" type="primary" @click="saveWatch">保存</el-button></div></template></div></template><h3>各区服与平台报价</h3><div class="offer-list"><div v-for="offer in pagedOffers" :key="`${offer.region}-${offer.platform_code}-${offer.price_cents}`" class="offer-row"><span>{{ regionName(offer.region) }}</span><strong>{{ offer.platform_name||offer.platform_code }}</strong><span>{{ money(offer.price_cents,offer.currency) }}</span><del>{{ money(offer.original_cents,offer.currency) }}</del><el-tag v-if="offer.discount_pct" size="small" type="danger">-{{ offer.discount_pct }}%</el-tag><a v-if="offer.buy_url" :href="offer.buy_url" target="_blank" rel="noopener noreferrer nofollow">购买 ↗</a></div><el-empty v-if="!detail.offers?.length" description="当前没有在售报价"/></div><PaginationBar v-model:page="offersPage" v-model:page-size="offersPageSize" :total="detail.offers?.length||0"/><PriceHistoryReport :series="detail.series||[]" :current-low="detail.game?.current_low" :currency="(detail.series?.length ? detail.series[0].currency : 'CNY')"/><div v-if="detail.game.steam_appid && detail.dlc?.total > 0" class="dlc-block"><div class="dlc-head"><h3>DLC（共 {{ detail.dlc.total }} 个）</h3><span class="dlc-note">Steam 不提供 DLC 拥有数据</span></div><div v-if="dlcError" class="dlc-empty">DLC 信息加载失败，稍后重试</div><template v-else-if="dlc"><div v-if="!dlc.items?.length" class="dlc-empty">暂无 DLC</div><template v-else><div v-if="isMobile" class="dlc-cards"><div v-for="d in dlc.items" :key="d.appid" class="dlc-card"><a :href="dlcUrl(d.appid)" target="_blank" rel="noopener noreferrer nofollow" class="dlc-name">{{ d.name }}</a><div class="dlc-meta"><strong>{{ dlcMoney(d.price_cents,d.currency) }}</strong><del v-if="d.original_cents&&d.original_cents>d.price_cents">{{ dlcMoney(d.original_cents,d.currency) }}</del><el-tag v-if="d.discount_pct" size="small" type="danger">-{{ d.discount_pct }}%</el-tag><span v-if="!d.in_stock" class="dlc-oos">缺货</span><a :href="dlcUrl(d.appid)" target="_blank" rel="noopener noreferrer nofollow">Steam ↗</a></div></div></div><div v-else class="dlc-rows"><div v-for="d in dlc.items" :key="d.appid" class="dlc-row"><a :href="dlcUrl(d.appid)" target="_blank" rel="noopener noreferrer nofollow" class="dlc-name">{{ d.name }}</a><span class="dlc-price"><strong>{{ dlcMoney(d.price_cents,d.currency) }}</strong><del v-if="d.original_cents&&d.original_cents>d.price_cents">{{ dlcMoney(d.original_cents,d.currency) }}</del></span><el-tag v-if="d.discount_pct" size="small" type="danger">-{{ d.discount_pct }}%</el-tag><span v-if="!d.in_stock" class="dlc-oos">缺货</span><a :href="dlcUrl(d.appid)" target="_blank" rel="noopener noreferrer nofollow" class="dlc-steam">Steam ↗</a></div></div><PaginationBar v-model:page="dlcPage" :page-size="10" :page-sizes="[10]" :total="dlc.total" @change="loadDlc(dlcPage)"/><p v-if="!dlc.synced" class="dlc-note">部分 DLC 信息待同步</p></template></template></div></template></el-dialog>
    <div v-if="isMobile && detailVisible && detail?.game" class="m-detail-bar"><template v-if="user && detail.game.owned"><a v-if="detail.game.steam_appid" :href="`https://store.steampowered.com/app/${detail.game.steam_appid}/`" target="_blank" rel="noopener"><el-button type="primary">去 Steam 商店</el-button></a></template><template v-else><el-button :type="isInterested(detail.game) ? 'primary' : 'default'" :plain="!isInterested(detail.game)" @click="setGameFlag(detail.game, 'interested', isInterested(detail.game) ? 'clear' : true)">{{ isInterested(detail.game) ? '✓ 感兴趣' : '感兴趣' }}</el-button><el-button :type="isUninterested(detail.game) ? 'danger' : 'default'" :plain="!isUninterested(detail.game)" @click="setGameFlag(detail.game, 'interested', isUninterested(detail.game) ? 'clear' : false)">不感兴趣</el-button><el-button v-if="user" :type="detail.game.wishlisted ? 'success' : 'default'" :plain="!detail.game.wishlisted" @click="toggleWishlist(detail.game)">{{ detail.game.wishlisted ? '✓ 愿望单' : '愿望单' }}</el-button><a v-if="detail.game.steam_appid" :href="`https://store.steampowered.com/app/${detail.game.steam_appid}/`" target="_blank" rel="noopener"><el-button type="primary">去 Steam 购买</el-button></a></template></div>
    <el-drawer v-model="noticeDrawer" title="站点通知" direction="rtl" size="min(420px, 92vw)"><div class="notice-drawer-body"><div v-for="n in notices" :key="n.id" class="notice-item" :class="[n.level, isNoticeRead(n.id) ? 'read' : 'unread']"><div class="notice-head"><strong>{{ n.title }}</strong><el-tag size="small" :type="n.level === 'critical' ? 'danger' : n.level === 'warning' ? 'warning' : 'info'" effect="plain">{{ noticeLevelLabel(n.level) }}</el-tag></div><p>{{ n.body }}</p><time class="notice-time">{{ n.startsAt ? siteDateTime(n.startsAt) : '' }}</time></div><el-empty v-if="!notices.length" description="暂无公告" :image-size="60"/></div><template #footer><el-button :disabled="unreadNoticeCount===0" type="primary" @click="markNoticesRead(false)">全部标为已读</el-button></template></el-drawer>
    <el-dialog v-model="noticeDialog" title="站点通知" width="min(560px, 92vw)" class="notice-dialog"><div class="notice-items"><div v-for="n in unreadNotices" :key="n.id" class="notice-item" :class="n.level"><div class="notice-head"><strong>{{ n.title }}</strong><el-tag size="small" :type="n.level === 'critical' ? 'danger' : n.level === 'warning' ? 'warning' : 'info'" effect="plain">{{ noticeLevelLabel(n.level) }}</el-tag></div><p>{{ n.body }}</p></div><el-empty v-if="!unreadNotices.length" description="暂无未读公告" :image-size="60"/></div><template #footer><el-button type="primary" @click="markNoticesRead(true)">我知道了</el-button></template></el-dialog>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import PaginationBar from '../components/PaginationBar.vue';
import UserAvatar from '../components/UserAvatar.vue';
import PriceHistoryReport from '../components/PriceHistoryReport.vue';
import CoverPlaceholder from '../components/CoverPlaceholder.vue';
import { useBackGuard } from '../composables/useBackGuard.js';
import { useInstallPrompt } from '../composables/useInstallPrompt.js';
import { useListPagination } from '../composables/useListPagination.js';
import { useTheme } from '../composables/useTheme.js';
import { NETWORK_ERROR_MESSAGE } from '../utils/network.js';
// BM-3/BM-4（docs/SESSION-MANAGEMENT.md §8.4.3/§8.4.4）：401 软跳带 reason；主动退出登录标记心跳基线
import { markSessionLoggedOut } from '../composables/useSessionHeartbeat.js';
// BT 批（docs/MOBILE-LOGIN-ENTRY-FIX.md）：登录入口统一硬跳 helper；401 会话失效走 redirectToLogin
import { openLogin } from '../utils/login-entry.js';
import { redirectToLogin } from '../utils/session.js';
import { useRoute, useRouter } from 'vue-router';
import { Search, Bell, Filter, CopyDocument } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { copyText } from '../utils/clipboard.js';
import { yuanAmount } from '../utils/money.js';
import { fmtDay } from '../utils/siteTime.js';
const router = useRouter(), route = useRoute();
const theme = useTheme();
const themeMode = theme.mode;
function toggleTheme(){ const m = themeMode.value === 'dark' ? 'light' : 'dark'; theme.set(m); persistTheme(m); }
async function persistTheme(m){ if(!user.value) return; try { await request('/api/prefs', { method: 'POST', body: JSON.stringify({ theme: m }) }); } catch { /* 忽略 */ } }
const regions = [{code:'cn',label:'中国大陆'},{code:'hk',label:'中国香港'},{code:'tw',label:'中国台湾'},{code:'us',label:'美国'},{code:'jp',label:'日本'},{code:'ru',label:'俄罗斯'},{code:'tr',label:'土耳其'},{code:'ar',label:'阿根廷'}];
// 已拥有 / 愿望单是登录用户专属维度：游客隐藏这些标签页（规格 §6）；
// CL 批（docs/USER-ALERTS.md §4.2）：「到价提醒」列表 tab 仅登录可见
const tabs=computed(()=>{const base=[{value:'all',label:'全部'},{value:'on',label:'感兴趣'},{value:'off',label:'不感兴趣'}];if(user.value)base.push({value:'owned',label:'已拥有'},{value:'wishlist',label:'愿望单'},{value:'watchlist',label:'到价提醒'});return base;});
const games = ref([]), notices = ref([]), total = ref(0), pages = ref(0), page = ref(1), pageSize = ref(20), loading = ref(false), listNetworkError = ref(false);
const catalogCount = ref(0), pricedCount = ref(0), siteAdultDisplay = ref('hide');
const query = ref(''), region = ref('cn'), type = ref('all'), sort = ref('discount'), activeTab=ref('all'), user = ref(null), guestGameFlags=ref({}), released = ref('all');
// EF 批（docs/STEAM-SYNC-STATUS-AND-RATING.md §9）：18R 筛选开关（选中 → adult=badge&rating=adult，取消恢复全部）
const adultFilter = ref(false);
// CH 批（docs/DISCOVERY-FOR-YOU.md §4）：好评率与 Deck 筛选 + 为你推荐
const reviewMin = ref(0), deck = ref('all');
const forYou = ref({ profile: true, games: [] }), forYouLoading = ref(false);
async function loadForYou(){ if(!user.value) return; forYouLoading.value=true; try { forYou.value = await request('/api/games/for-you',{method:'POST',body:JSON.stringify({})}); } catch { forYou.value={profile:true,games:[]}; } finally { forYouLoading.value=false; } }
function deckLabel(d){ return d===3?'✓ 已验证':d===2?'~ 可玩':d===1?'✗ 不支持':''; }
function reviewClass(s){ return s>=9?'r9':s>=7?'r7':''; }
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
// BT 批（docs/MOBILE-LOGIN-ENTRY-FIX.md §4.2）：登录入口改整页硬跳——关浮层触发的 history.back()
// 与 router.push('/login') 抢历史栈（小米浏览器稳定复现"面板关了登录页不出现"），统一走 openLogin。
function goLogin(){openLogin();}
// BY 批（docs/MOBILE-APP-UPDATE.md §4.5）：「我的 → 检查更新」——自定义 scheme 拉起 App 内的检查逻辑；
// 浏览器/非 App 环境该链接无响应，1.5s 后回落 /app 下载页（切后台/隐藏时取消定时，避免误跳）。
let updateFallbackTimer=null;
function checkUpdate(){
  if(typeof window==='undefined')return;
  try{window.location.href='steamdeals://check-update';}catch{/* 忽略 */}
  if(updateFallbackTimer)clearTimeout(updateFallbackTimer);
  updateFallbackTimer=setTimeout(()=>{router.push('/app');},1500);
}
function cancelUpdateFallback(){if(updateFallbackTimer){clearTimeout(updateFallbackTimer);updateFallbackTimer=null;}}
function onVisibilityUpdate(){if(document.hidden)cancelUpdateFallback();}
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
const filterTemp = ref({ region:'cn', type:'all', sort:'discount', released:'all', adult:false });
const regionLabel = computed(()=>regions.find((r)=>r.code===region.value)?.label||region.value);
const typeLabel = computed(()=>({all:'全部类型',game:'游戏',dlc:'DLC'}[type.value]||'类型'));
const sortLabel = computed(()=>({discount:'折扣优先',price:'价格优先',name:'名称排序'}[sort.value]||'排序'));
function openFilterSheet(){filterTemp.value={region:region.value,type:type.value,sort:sort.value,released:released.value,adult:adultFilter.value};filterDrawer.value=true;}
function applyFilter(){region.value=filterTemp.value.region;type.value=filterTemp.value.type;sort.value=filterTemp.value.sort;released.value=filterTemp.value.released;adultFilter.value=filterTemp.value.adult===true;filterDrawer.value=false;saveLocalPrefs();invalidateSearchCache();loadGames(1);}
function resetFilter(){filterTemp.value={region:'cn',type:'all',sort:'discount',released:'all',adult:false};}
// EF 批（docs/STEAM-SYNC-STATUS-AND-RATING.md §9）：18R 筛选开关——开=只看 18R（badge+rating=adult），关=恢复全部
function toggleAdult(){adultFilter.value=!adultFilter.value;invalidateSearchCache();saveLocalPrefs();loadGames(1);}
// 底部导航：首页/心愿单/已拥有/我的（CL 批：登录用户加「提醒」入口）
const mNavItems=computed(()=>{const items=[{value:'all',label:'首页',icon:'🏠'}];if(user.value){items.push({value:'wishlist',label:'心愿单',icon:'★'},{value:'owned',label:'已拥有',icon:'✓'},{value:'watchlist',label:'提醒',icon:'🔔'});}items.push({value:'me',label:'我的',icon:'☰'});return items;});
function mNavActive(value){if(value==='me')return false;return activeTab.value===value;}
function mNav(value){if(value==='me'){mySheet.value=true;return;}if(!user.value){goLogin();return;}setTab(value);}
const detailVisible=ref(false),detailLoading=ref(false),detail=ref(null),watchTarget=ref(''),watchExists=ref(false),dlc=ref(null),dlcPage=ref(1),dlcLoading=ref(false),dlcError=ref(false);
// CL 批（docs/USER-ALERTS.md §4.2）：到价提醒列表（登录 tab）+ 移动端折叠行
const watchList=ref([]),watchListTotal=ref(0),watchListPage=ref(1),watchListLoading=ref(false),watchOpen=ref(false);
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
function money(cents, currency) { if (cents == null) return '暂无报价'; const symbols={CNY:'¥',USD:'$',HKD:'HK$',TWD:'NT$',JPY:'¥',RUB:'₽',TRY:'₺',ARS:'$'}; const fallback={cn:'CNY',hk:'HKD',tw:'TWD',us:'USD',jp:'JPY',ru:'RUB',tr:'TRY',ar:'ARS'}[region.value]||'CNY';const code=currency||fallback;return `${symbols[code] || code+' '}${yuanAmount(cents)}`; }
function discount(g) { return Number(g.discount) || 0; }
function cover(g) { return g.steam_appid ? `/img/steam/${g.steam_appid}/header` : ''; }
// AW 批（docs/IMAGE-FETCH.md §3.5）：加载失败显示 CSS 占位块（渐变 + 游戏名首字），不再用 favicon 兜底
// EC 批（docs/IMAGE-COVERAGE.md §8 EC-3）：占位内容统一为 CoverPlaceholder（S 标 + 首字），列表与详情一致
const coverFailed = ref(new Set());
const detailCoverFailed = ref(false);
function markCoverFailed(game) { if (!game?.id) return; const next = new Set(coverFailed.value); next.add(game.id); coverFailed.value = next; }
async function request(path, options) { const res=await fetch(path,{credentials:'same-origin',...options,headers:{'content-type':'application/json',...(options?.headers||{})}}); const raw=await res.text(); let data={}; try{data=raw?JSON.parse(raw):{}}catch{} if(res.status===401&&path!=='/api/me'&&path!=='/api/login'){redirectToLogin('expired');} if(!res.ok) throw new Error(data.error||`请求失败 (${res.status})`); return data; }
function localFlagIds(field,value){return Object.entries(guestGameFlags.value).filter(([,flags])=>flags?.[field]===value).map(([id])=>id).filter((id)=>/^\d{1,19}$/.test(id));}
// 游客只有本地 感兴趣/不感兴趣 标记；已拥有/愿望单不展示（规格 §6）
function visibleGames(rows){if(user.value)return rows;return rows.map((game)=>{const flags=guestGameFlags.value[String(game.id)]||{};return {...game,interested:typeof flags.interested==='boolean'?flags.interested:null,owned:false,wishlisted:false,wishlisted_by:[],site_wishlisted:false};});}
// 「已拥有」徽标文案：前两个账号名，更多显示 +N（详情页列全）
function ownedByText(game){const by=Array.isArray(game.owned_by)?game.owned_by:[];if(!by.length)return '';const names=by.map((a)=>a.name||a.steamId);if(by.length>2)return ` · ${names.slice(0,2).join('、')} +${by.length-2}`;return ` · ${names.join('、')}`;}
// 已拥有按钮三态：手动 true（可清除）→ 排除 false（可恢复）→ 未标记（跟随推导）
function ownedBtnLabel(game){if(game.user_owned===false)return '恢复已拥有';if(game.owned)return '✓ 已拥有';return '已拥有';}
async function toggleOwned(game){const uo=game.user_owned;if(uo===false)return setGameFlag(game,'owned','clear');if(game.owned)return setGameFlag(game,'owned',uo===true?'clear':false);return setGameFlag(game,'owned',true);}
async function loadGames(nextPage=1,append=false){gameRequestController?.abort();const controller=new AbortController();gameRequestController=controller;const seq=++requestSeq;loading.value=true;page.value=nextPage;const params={page:page.value,pageSize:pageSize.value,region:region.value,type:type.value,sort:sort.value,q:query.value.trim(),interest:activeTab.value==='on'?'on':activeTab.value==='off'?'off':'all',owned:activeTab.value==='owned'?'only':'include',wishlist:activeTab.value==='wishlist'?true:undefined,released:released.value,reviewMin:reviewMin.value||undefined,deck:deck.value||undefined,marks:activeTab.value==='all'?'unmarked':'any',adult:adultFilter.value?'badge':undefined,rating:adultFilter.value?'adult':undefined};const cacheKey=params.q?`${params.q}|${params.region}|${params.sort}|${params.type}|${params.released}|${params.marks}|${params.interest}|${params.owned}|${params.wishlist?'w':''}|${params.page}|${params.pageSize}|${user.value?'u':'g'}|${guestFlagsRev.value}|${adultFilter.value?'18r':''}`:'';const cached=cacheKey&&!append?searchCache.get(cacheKey):null;if(cached&&Date.now()-cached.at<30000){applyGames(cached.data,seq,controller);loading.value=false;gameRequestController=null;return;}try{const interestedIds=localFlagIds('interested',true),uninterestedIds=localFlagIds('interested',false);const flags={interestedIds:activeTab.value==='on'?interestedIds:[],uninterestedIds:activeTab.value==='off'?uninterestedIds:[],excludeIds:activeTab.value==='all'?[...new Set([...interestedIds,...uninterestedIds])]:[]};const options=user.value?params:{...params,guestFlags:flags};const data=await request('/api/games/search',{method:'POST',body:JSON.stringify(options),signal:controller.signal});if(cacheKey&&!append)setCache(cacheKey,data);applyGames(data,seq,controller,append);}catch(e){if(e.name!=='AbortError'){if(!append)games.value=[];listNetworkError.value=e.name==='NetworkError';ElMessage.error(e.message);}}finally{if(gameRequestController===controller){gameRequestController=null;loading.value=false;}}}
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
function saveLocalPrefs(){try{localStorage.setItem('steamdeals.prefs.v1',JSON.stringify({tab:activeTab.value,sort:sort.value,region:region.value,adult:adultFilter.value}));}catch{}}
async function savePrefs(){saveLocalPrefs();if(!user.value)return;try{await request('/api/prefs',{method:'POST',body:JSON.stringify({tab:activeTab.value,sort:sort.value,only_discount:false})});}catch{}}
async function setTab(value){activeTab.value=value;if(value==='watchlist'){await loadWatchList(1);return;}await savePrefs();await loadGames(1);}
async function changeSort(){await savePrefs();await loadGames(1);}
async function changeRegion(){saveLocalPrefs();await loadGames(1);}
async function loadUser(){try{const d=await request('/api/me');user.value=d.user||null;if(d.user?.mustChangePassword){router.replace('/change-password?forced=1');return;}if(d.timezone)siteTimezone.value=d.timezone;const local=(()=>{try{return JSON.parse(localStorage.getItem('steamdeals.prefs.v1')||'{}');}catch{return {};}})();region.value=local.region||'cn';adultFilter.value=local.adult===true;if(user.value){guestGameFlags.value={};try{localStorage.removeItem(guestFlagsStorageKey);}catch{}const serverTheme=d.prefs?.theme;if(serverTheme==='light'||serverTheme==='dark'){if(theme.storedMode()!==serverTheme)theme.set(serverTheme);}else if(theme.storedMode()){persistTheme(theme.storedMode());}if(detailVisible.value&&detail.value?.game)await openDetail(detail.value.game);activeTab.value=d.prefs?.tab??'all';sort.value=d.prefs?.sort??'discount';}else{activeTab.value=['all','on','off'].includes(local.tab)?local.tab:'all';sort.value=local.sort||'discount';}}catch{user.value=null;}}
async function loadNotices() { try { const d=await request('/api/announcements'); notices.value=Array.isArray(d.announcements)?d.announcements:(Array.isArray(d)?d:[]); if(user.value){ noticeReadIds.value=(Array.isArray(d.readIds)?d.readIds:[]).map(Number); } else { const local=readLocalReadIds(); if(local===null)noticeReadIds.value=[]; else if(Array.isArray(local))noticeReadIds.value=local; else { noticeReadIds.value=legacyMaxAsReadIds(local.legacyMax); } } } catch { notices.value=[]; noticeReadIds.value=[]; } }
function dismissNotice(){/* 已被「已读 id 集合」机制取代，见 markNoticesRead */}
async function logout() { try { await request('/api/logout',{method:'POST',body:'{}'}); } finally { markSessionLoggedOut(); user.value=null;activeTab.value='all';await loadGames(1); } }
async function openDetail(game){const gid=Number(game.id??game.game_id);detailVisible.value=true;detailLoading.value=true;detail.value=null;detailCoverFailed.value=false;watchExists.value=false;watchTarget.value='';watchOpen.value=false;dlc.value=null;dlcPage.value=1;dlcError.value=false;try{const path=game.steam_appid?`/api/games/${game.steam_appid}`:`/api/games/by-id/${gid}`;detail.value=await request(`${path}?region=${encodeURIComponent(region.value)}`);if(!user.value)refreshDetailFlags();// CL 批：watch 字段由服务端回显（当前用户），不再走管理员清单
if(detail.value?.watch){watchExists.value=true;watchTarget.value=detail.value.watch.targetCents==null?'':yuanAmount(detail.value.watch.targetCents);}if(detail.value?.game?.steam_appid&&detail.value?.dlc?.total>0){loadDlc(1);}}catch(e){ElMessage.error(e.message);detailVisible.value=false;}finally{detailLoading.value=false;}}
// BP 批（docs/GAME-DLC.md §3.4）：详情最下方内联 DLC 列表——10 条/页、Steam 跳转、移动端卡片；
// 打开详情且 dlc.total>0 时自动拉第 1 页；翻页再请求；失败只显示重试文案，不阻塞详情其它内容。
function dlcUrl(appid){return `https://store.steampowered.com/app/${appid}/`;}
function dlcMoney(cents,currency){return cents==null?'—':money(cents,currency);}
async function loadDlc(nextPage=1){const g=detail.value?.game;if(!g?.steam_appid)return;dlcLoading.value=true;dlcError.value=false;try{const d=await request(`/api/games/${g.steam_appid}/dlc?page=${nextPage}&pageSize=10`);dlc.value=d;dlcPage.value=Number(d.page)||1;}catch(e){dlcError.value=true;dlc.value=null;}finally{dlcLoading.value=false;}}
function regionName(code){return regions.find(r=>r.code===code)?.label||code||'—';}
function isInterested(game){return user.value?game?.user_interested===true:game?.interested===true;}
function isUninterested(game){return user.value?game?.user_interested===false:game?.interested===false;}
function refreshDetailFlags(){if(!detail.value?.game)return;const g=detail.value.game;const flags=guestGameFlags.value[String(g.id)]||{};detail.value={...detail.value,game:{...g,interested:typeof flags.interested==='boolean'?flags.interested:null,owned:false,wishlisted:false}};}
// value：true / false / 'clear'（清除个人标记回退全局）
async function setGameFlag(game,kind,value){const id=String(game.id);if(!user.value){const next={...(guestGameFlags.value[id]||{})};if(value==='clear')delete next[kind];else next[kind]=value;if(Object.keys(next).length)guestGameFlags.value={...guestGameFlags.value,[id]:next};else{const copy={...guestGameFlags.value};delete copy[id];guestGameFlags.value=copy;}guestFlagsRev.value++;try{localStorage.setItem(guestFlagsStorageKey,JSON.stringify(guestGameFlags.value));}catch{ElMessage.warning('浏览器无法保存本地标记');}if(detail.value?.game?.id===game.id)refreshDetailFlags();invalidateSearchCache();await loadGames(page.value);return;}const body={[kind]:value};const path=game.steam_appid?`/api/games/${game.steam_appid}/flags`:`/api/games/id/${game.id}/flags`;try{await request(path,{method:'POST',body:JSON.stringify(body)});if(detail.value?.game?.id===game.id){const refreshed=await request(`${game.steam_appid?`/api/games/${game.steam_appid}`:`/api/games/by-id/${game.id}`}?region=${region.value}`);detail.value=refreshed;}invalidateSearchCache();await loadGames(page.value);}catch(e){ElMessage.error(e.message);}}
// CL 批（docs/USER-ALERTS.md §3.1/§4.1）：用户级到价提醒——保存/取消走 /api/watchlist，成功后重拉详情回显。
async function saveWatch(){if(!detail.value?.game)return;const raw=watchTarget.value.trim();const targetCents=raw===''?null:Math.round(Number(raw)*100);if(targetCents!==null&&(!Number.isFinite(targetCents)||targetCents<0))return ElMessage.warning('目标价不合法');try{await request('/api/watchlist',{method:'POST',body:JSON.stringify({gameId:detail.value.game.id,targetCents})});if(!user.value?.email)ElMessage.warning('已保存。请先在后台绑定邮箱，否则降价时无法收到邮件通知。');else ElMessage.success(watchExists.value?'到价提醒已更新':'到价提醒已保存');await refreshDetailAfterWatch();}catch(e){ElMessage.error(e.message);}}
async function refreshDetailAfterWatch(){const g=detail.value?.game;if(!g)return;const refreshed=await request(`${g.steam_appid?`/api/games/${g.steam_appid}`:`/api/games/by-id/${g.id}`}?region=${region.value}`);detail.value=refreshed;watchExists.value=!!refreshed.watch;watchTarget.value=refreshed.watch?.targetCents==null?'':yuanAmount(refreshed.watch.targetCents);}
async function deleteWatch(){try{const g=detail.value?.game;if(!g)return;await request(`/api/watchlist/${g.id}`,{method:'DELETE'});watchExists.value=false;watchTarget.value='';invalidateSearchCache();ElMessage.success('提醒已取消');await refreshDetailAfterWatch();if(activeTab.value==='watchlist')await loadWatchList(1);}catch(e){ElMessage.error(e.message);}}
// 快捷值：按史低 = 史低价；减 10% = 当前价 × 0.9 按整数分取整（§9.1 对照表）
function setWatchHistLow(){const g=detail.value?.game;if(g?.hist_low==null)return ElMessage.warning('暂无史低数据');watchTarget.value=yuanAmount(Number(g.hist_low));}
function setWatchDiscount10(){const g=detail.value?.game;if(g?.current_low==null)return ElMessage.warning('暂无当前价');watchTarget.value=yuanAmount(Math.floor(Number(g.current_low)*0.9));}
// CL 批（docs/USER-ALERTS.md §4.2）：到价提醒列表（分页 20，取消后立即移除）
async function loadWatchList(nextPage=1){watchListLoading.value=true;try{const d=await request(`/api/watchlist?page=${nextPage}&pageSize=20`);watchList.value=Array.isArray(d.watches)?d.watches:[];watchListTotal.value=Number(d.total)||watchList.value.length;watchListPage.value=nextPage;}catch(e){watchList.value=[];ElMessage.error(e.message);}finally{watchListLoading.value=false;}}
async function cancelWatchFromList(row){try{await request(`/api/watchlist/${row.game_id}`,{method:'DELETE'});ElMessage.success('提醒已取消');await loadWatchList(watchListPage.value);}catch(e){ElMessage.error(e.message);}}
function watchMoney(cents,currency){return cents==null?'—':money(cents,currency);}
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

// AG 批（docs/ADMIN-PLATFORM-LINKS.md）：复制游戏名（clipboard API + execCommand 降级）
async function copyGameName(game){const ok=await copyText(game.name);ok?ElMessage.success('已复制'):ElMessage.warning('复制失败，请手动选择');}
onMounted(async()=>{try{desktopHintDismissed.value=sessionStorage.getItem(DESKTOP_HINT_KEY)==='1';}catch{}document.addEventListener('visibilitychange',onVisibilityUpdate);window.addEventListener('pagehide',cancelUpdateFallback);try{const p=JSON.parse(localStorage.getItem('steamdeals.prefs.v1')||'{}');activeTab.value=p.tab||'all';sort.value=p.sort||'discount';region.value=p.region||'cn';adultFilter.value=p.adult===true;const flags=JSON.parse(localStorage.getItem(guestFlagsStorageKey)||'{}');guestGameFlags.value=flags&&typeof flags==='object'&&!Array.isArray(flags)?flags:{};}catch{}const urlQ=String(route.query.q||'').slice(0,80);if(urlQ){query.value=urlQ;lastSearchedQ=urlQ;}if(typeof window!=='undefined'&&window.matchMedia){narrowQuery=window.matchMedia('(max-width: 640px)');const onChange=(e)=>isNarrow.value=e.matches;narrowQuery.addEventListener?narrowQuery.addEventListener('change',onChange):narrowQuery.addListener(onChange);}applyMobile();refreshDebugInfo();window.addEventListener('resize',()=>{scheduleMobileCheck();refreshDebugInfo();});window.addEventListener('orientationchange',scheduleMobileCheck);await loadUser();await Promise.all([loadGames(),loadNotices(),loadCounts(),loadSiteInfo()]);if(unreadNoticeCount.value)noticeDialog.value=true;});
onBeforeUnmount(()=>{gameRequestController?.abort();clearTimeout(searchTimer);clearTimeout(mobileTimer);cancelUpdateFallback();document.removeEventListener('visibilitychange',onVisibilityUpdate);window.removeEventListener('pagehide',cancelUpdateFallback);window.removeEventListener('resize',scheduleMobileCheck);window.removeEventListener('orientationchange',scheduleMobileCheck);});
</script>

<style scoped>
.store-tabs{display:flex;gap:7px;margin:var(--space-2) 0 var(--space-12)}.store-tabs button,.login-modes button{border:1px solid var(--border);border-radius:var(--radius-9);background:var(--panel);color:var(--fg-muted);padding:var(--space-8) 13px;font-size:var(--font-12);cursor:pointer}.store-tabs button.on,.login-modes button.on{background:var(--brand-soft);border-color:var(--brand-soft);color:var(--brand);font-weight:650}.flag-hint{margin:-4px var(--space-2) var(--space-12);color:var(--fg-muted);font-size:var(--font-11)}.game-card{cursor:pointer;content-visibility:auto;contain-intrinsic-size:0 360px}.card-flags{display:flex;gap:var(--space-6);margin-top:var(--space-10)}.card-flags .el-button,.card-flags-sec .el-button{flex:1;margin-left:0}.captcha-row,.email-code-row{display:flex;align-items:center;gap:9px;width:100%;margin-bottom:var(--space-12)}.captcha-row img{width:132px;height:44px;border-radius:var(--radius-8);cursor:pointer;background:#0f172a;flex:none}.captcha-retry{width:132px;height:44px;border-radius:var(--radius-8);background:var(--panel-2);border:1px dashed var(--border-2);color:var(--fg-muted);font-size:var(--font-11);line-height:1.4;cursor:pointer;flex:none}.email-code-row .el-input,.m-search,.m-actions a,.m-detail-bar a{flex:1}.login-modes{display:flex;gap:var(--space-6);margin:0 0 17px}.login-help{display:block;color:var(--brand);font-size:var(--font-11);margin:7px 0;cursor:pointer}.login-submit{width:100%;margin-top:var(--space-12)}.detail-dialog :deep(.el-dialog__body){padding-top:5px}.detail-cover{display:block;width:min(100%,520px);max-width:100%;height:auto;border-radius:var(--radius-10);margin:0 auto var(--space-8);background:var(--panel-2)}.detail-en{color:var(--fg-muted);font-size:var(--font-12)}.detail-metrics{display:flex;gap:var(--space-10);flex-wrap:wrap;margin:13px 0}.detail-metrics>span{background:var(--panel-2);border:1px solid var(--border-2);border-radius:var(--radius-9);padding:var(--space-8) 11px;font-size:var(--font-11);color:var(--fg-muted)}.detail-metrics strong{display:block;color:var(--brand);font-size:var(--font-17);margin-top:3px}.detail-description{white-space:pre-wrap;max-height:140px;overflow:auto;color:var(--fg-muted);font-size:var(--font-12);line-height:1.65}.detail-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin:var(--space-10) 0}.detail-actions .el-input{max-width:240px}.detail-dialog h3{font-size:var(--font-13);margin:var(--space-16) 0 var(--space-8)}.offer-list{display:grid;border:1px solid var(--border);border-radius:var(--radius-9);overflow:hidden}.offer-row{display:grid;grid-template-columns:minmax(72px,.9fr) minmax(96px,1.1fr) 88px 88px 56px 68px;align-items:center;gap:var(--space-8);padding:9px 11px;border-bottom:var(--space-1) solid var(--border);font-size:var(--font-11)}.offer-row:last-child{border-bottom:0}.offer-row a,.detail-dialog>a{color:var(--brand)}.detail-loading{padding:var(--space-48) var(--space-10);text-align:center;color:var(--fg-muted)}.login-dialog{max-width:100%}@media(max-width:640px){.store-tabs{overflow:auto}.store-tabs button{white-space:nowrap}.offer-row{grid-template-columns:1fr auto auto;grid-template-areas:'plat price buy' 'meta meta meta';gap:var(--space-4) var(--space-8);padding:var(--space-8);font-size:var(--font-11)}.offer-row>*:nth-child(1){grid-area:meta;justify-self:start;color:var(--fg-muted)}.offer-row>*:nth-child(2){grid-area:plat;justify-self:start}.offer-row>*:nth-child(3){grid-area:price;justify-self:end}.offer-row>*:nth-child(4){grid-area:meta;justify-self:start}.offer-row>*:nth-child(5){grid-area:meta;justify-self:start}.offer-row>*:nth-child(6){grid-area:buy;justify-self:end}.detail-actions .el-input{max-width:100%;flex-basis:100%}.detail-metrics>span{flex:1}}
.catalog-stat small{display:block;font-size:var(--font-11);color:var(--fg-subtle);font-weight:500;margin-top:3px}.catalog-priced{display:block;margin-top:5px;font-size:var(--font-11);color:var(--fg-muted)}.notice-dialog .notice-items{max-height:320px;overflow-y:auto;display:flex;flex-direction:column;gap:var(--space-10)}.notice-item{border:1px solid var(--border);border-radius:var(--radius-10);padding:var(--space-12) var(--space-14);background:var(--panel-2)}.notice-item.warning{border-color:var(--warn-soft);background:var(--warn-bg)}.notice-item.critical{border-color:var(--danger-soft);background:var(--danger-bg)}.notice-head{display:flex;align-items:center;justify-content:space-between;gap:var(--space-8);margin-bottom:var(--space-6)}.notice-head strong{font-size:var(--font-13)}.notice-item p{margin:0;color:var(--fg-muted);font-size:var(--font-12);line-height:1.6;white-space:pre-wrap}.card-flags .el-button{padding-left:var(--space-6);padding-right:var(--space-6)}.m-flags{display:flex;flex-wrap:wrap;gap:var(--space-4);margin-top:var(--space-6)}
/* D4 合并试点（docs/DESIGN-AUDIT.md D4 行）：同一 DOM 双态适配——.m-storefront 前缀为移动态覆盖，
   桌面态规则不变（main.css + 上方 scoped 桌面规则）；isMobile 断点判定逻辑未动。 */
.price-tags{display:flex;gap:var(--space-6);flex-wrap:wrap;align-items:center;justify-content:flex-end;min-width:0}
.m-storefront .m-game-list{grid-template-columns:1fr}
.m-storefront .m-game-card{content-visibility:visible;transition:none}
.m-storefront .m-game-card:hover{transform:none;border-color:var(--border);box-shadow:0 3px 14px #26345a06}
.m-storefront .m-cover{height:auto}
.m-storefront .m-discount{box-shadow:none}
.m-storefront .m-title,.m-storefront .m-subtitle{white-space:normal;overflow:visible;text-overflow:clip}
.m-storefront .m-price-row{margin-bottom:0}
.m-storefront .m-price-row strong{letter-spacing:0}
.m-storefront .m-result-line{margin:0}.m-storefront .m-result-line span{display:inline}.theme-btn{font-size:var(--font-17)}.detail-owned{margin:0 0 var(--space-10);padding:var(--space-8) var(--space-12);background:var(--panel-2);border:1px solid var(--border-2);border-radius:var(--radius-9);font-size:var(--font-12);color:var(--fg-muted)}.owned-acct{cursor:help;color:var(--brand);font-weight:600}.detail-owned-tip{margin-left:var(--space-8);opacity:.7}.wish-pick-hint{margin:0 0 var(--space-10);color:var(--fg-muted);font-size:var(--font-12)}.wish-pick-list{display:grid;gap:var(--space-8)}.wish-pick-list .el-checkbox{height:auto;white-space:normal}.wish-pick-list small{display:block;color:var(--fg-subtle);font-size:var(--font-10);margin-left:var(--space-24)}.buy-link{margin-left:auto;display:inline-flex;align-items:center}.buy-link .el-button{margin-left:0}.card-flags-sec{display:flex;gap:var(--space-6);flex:1}.storefront .mobile-only{display:none}.storefront.m-storefront .mobile-only{display:flex}.m-storefront .desktop-only{display:none}.toolbar-filters{display:flex;gap:var(--space-8);flex:1;align-items:center;min-width:0}.toolbar-filters .el-select{width:auto;flex:0 1 auto}.filter-drawer-body{display:grid;gap:var(--space-10);padding:var(--space-4) var(--space-2)}.filter-label{font-size:var(--font-12);color:var(--fg-muted);margin-top:var(--space-6)}.filter-full{width:100%}.filter-apply{margin-top:var(--space-10);min-height:44px}.notice-badge{display:inline-flex;align-items:center}.notice-badge .el-badge__content{transform:translateY(-2px) translateX(2px)}.notice-drawer-body{display:flex;flex-direction:column;gap:var(--space-10)}.notice-item.read{opacity:.62}.notice-item.unread{border-color:var(--brand-soft);background:var(--brand-soft)}.notice-time{display:block;margin-top:var(--space-6);font-size:var(--font-11);color:var(--fg-subtle)}.mobile-full{width:100%!important;max-width:100%!important;height:100%;max-height:100%;height:100dvh;max-height:100dvh;margin:0!important;border-radius:0;top:0}.mobile-full :deep(.el-dialog__body){padding:var(--space-10) var(--space-14) 96px;overflow-y:auto}.mobile-full :deep(.el-dialog__header){padding:var(--space-12) var(--space-14) var(--space-6)}.m-detail-bar{position:fixed;left:0;right:0;bottom:0;z-index:var(--z-detail);display:flex;gap:var(--space-8);padding:var(--space-10) var(--space-12) calc(var(--space-10) + env(safe-area-inset-bottom));background:var(--panel);border-top:var(--space-1) solid var(--border)}.m-detail-bar .el-button{flex:1;min-height:44px;margin-left:0}.m-actions a .el-button,.m-detail-bar a .el-button{width:100%}.m-storefront{font-size:var(--font-14);padding-bottom:calc(var(--space-64) + env(safe-area-inset-bottom))}.m-topbar{position:sticky;top:0;z-index:var(--z-sticky);height:52px;background:var(--glass);border-bottom:var(--space-1) solid var(--border);display:flex;align-items:center;justify-content:space-between;padding:0 var(--space-14);backdrop-filter:blur(14px)}.m-brand{font-size:var(--font-15)}.m-brand .brand-mark{width:30px;height:30px;border-radius:var(--radius-9)}.m-topbar-actions{display:flex;align-items:center;gap:var(--space-4)}.m-search-row{display:flex;gap:var(--space-8);padding:var(--space-10) var(--space-14) 0}.m-search-row :deep(.el-input__wrapper){min-height:44px}.m-filter-btn{min-height:44px;height:44px}.m-chips{display:flex;gap:var(--space-8);overflow-x:auto;padding:var(--space-10) var(--space-14) 0;scrollbar-width:none}.m-chips::-webkit-scrollbar{display:none}.m-chip{flex:0 0 auto;min-height:36px;padding:var(--space-6) var(--space-12);border:1px solid var(--border);border-radius:var(--radius-pill);background:var(--panel);color:var(--fg-muted);font-size:var(--font-14)}.m-chip.on{background:var(--brand-soft);border-color:var(--brand-soft);color:var(--brand)}.m-tabs{display:flex;margin:var(--space-12) var(--space-14) 0;border-radius:var(--radius-12);overflow:hidden;border:1px solid var(--border)}.m-tabs button{flex:1;min-height:44px;background:var(--panel);border:0;color:var(--fg-muted);font-size:var(--font-15)}.m-tabs button.on{background:var(--brand-soft);color:var(--brand);font-weight:650}.m-result-line{padding:var(--space-12) var(--space-14) var(--space-4);color:var(--fg-muted);font-size:var(--font-13)}.m-skeleton,.m-empty{padding:0 var(--space-14)}.m-game-list{display:grid;gap:var(--space-12);padding:var(--space-8) var(--space-14) var(--space-16)}.m-game-card{background:var(--panel);border:1px solid var(--border);border-radius:var(--radius-14);overflow:hidden;box-shadow:0 3px 14px #26345a06}.m-cover{position:relative}.m-cover img{display:block;width:100%;max-width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;background:var(--panel-2)}.m-discount{position:absolute;left:var(--space-10);top:var(--space-10);background:var(--danger);color:#fff;font-size:var(--font-13);font-weight:700;padding:3px 9px;border-radius:var(--radius-9)}.m-card-body{padding:var(--space-12) var(--space-14) var(--space-14)}.m-title{font-size:var(--font-16);font-weight:700;line-height:1.45}.m-subtitle{font-size:var(--font-11);color:var(--fg-muted);margin-top:var(--space-2)}.m-price-row{display:flex;align-items:baseline;gap:var(--space-8);margin-top:var(--space-8)}.m-price-row strong{font-size:var(--font-21);color:var(--brand);font-weight:800}.m-price-row del{font-size:var(--font-13);color:var(--fg-subtle)}.m-platform{margin-left:auto;font-size:var(--font-12);color:var(--fg-muted)}.m-tags{display:flex;gap:var(--space-6);flex-wrap:wrap;margin-top:var(--space-8)}.m-actions{display:flex;gap:var(--space-8);margin-top:var(--space-12)}.m-actions .el-button,.m-filter-footer .el-button,.m-detail-bar .el-button{flex:1;min-height:44px;margin-left:0}.m-loadmore-wrap{padding:0 var(--space-14) var(--space-14)}.m-loadmore{width:100%;min-height:44px}.m-bottomnav{position:fixed;left:0;right:0;bottom:0;z-index:var(--z-bottomnav);display:flex;min-height:56px;background:var(--glass);border-top:var(--space-1) solid var(--border);padding:var(--space-6) var(--space-4) calc(var(--space-6) + env(safe-area-inset-bottom));backdrop-filter:blur(14px)}.m-bottomnav button{flex:1;display:grid;place-items:center;gap:var(--space-2);background:none;border:0;color:var(--fg-muted);font-size:var(--font-12);min-height:48px}.m-bottomnav button.on{color:var(--brand)}.m-nav-icon{font-size:var(--font-18)}.m-filter-sheet :deep(.el-drawer__body){padding:var(--space-16) var(--space-16) var(--space-8);max-height:70vh;overflow-y:auto}.m-filter-body{display:grid;gap:var(--space-14)}.m-filter-group label{display:block;font-size:var(--font-14);color:var(--fg-muted);margin-bottom:var(--space-8)}.m-radio-row{display:flex;flex-wrap:wrap;gap:var(--space-8)}.m-radio-row button{min-height:44px;padding:var(--space-8) var(--space-14);border:1px solid var(--border);border-radius:var(--radius-10);background:var(--panel);color:var(--fg);font-size:var(--font-14)}.m-radio-row button.on{background:var(--brand-soft);border-color:var(--brand);color:var(--brand);font-weight:650}.m-filter-footer{display:flex;gap:var(--space-8);padding:var(--space-6) 0 calc(var(--space-6) + env(safe-area-inset-bottom))}.m-my-body{display:grid;gap:var(--space-8);padding-bottom:calc(var(--space-6) + env(safe-area-inset-bottom))}.m-my-body .el-button{margin-left:0;min-height:44px}.m-desktop-hint{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--space-8);padding:9px var(--space-14);background:var(--warn-bg);border-bottom:var(--space-1) solid var(--warn-soft);color:var(--warn);font-size:var(--font-12);line-height:1.5}.m-desktop-hint-actions{display:flex;gap:var(--space-8);flex:none}.m-desktop-hint-actions button{min-height:36px;padding:var(--space-4) var(--space-14);border:1px solid currentColor;border-radius:var(--radius-9);background:transparent;color:inherit;font:inherit;cursor:pointer}.m-install-bar{display:flex;justify-content:center;padding:var(--space-8) var(--space-14);background:var(--brand-soft);border-bottom:var(--space-1) solid var(--brand-2)}.m-install-btn{min-height:44px;padding:var(--space-8) 22px;border:0;border-radius:var(--radius-10);background:var(--brand);color:#fff;font-size:var(--font-14);font-weight:650;cursor:pointer}.m-sheet-note{padding:var(--space-10) var(--space-12);border:1px solid var(--border-2);border-radius:var(--radius-10);background:var(--panel-2);color:var(--fg-muted);font-size:var(--font-12);line-height:1.6}.m-debug-bar{position:fixed;top:0;left:0;right:0;z-index:var(--z-top);background:#101418;color:#4ade80;font:11px/1.5 ui-monospace,Consolas,monospace;padding:5px var(--space-10);word-break:break-all;opacity:.95}
/* AW 批（docs/IMAGE-FETCH.md §3.5）：封面失败/无 AppID 显示占位块（渐变 + 首字），不再用 favicon 兜底 */
.cover-placeholder{display:none;position:absolute;inset:0;align-items:center;justify-content:center;font-size:42px;font-weight:800;color:var(--fg-subtle);background:linear-gradient(130deg,var(--brand-soft),var(--bg-2));letter-spacing:-.02em}
.img-failed .cover-placeholder{display:flex}
.img-failed img{display:none}
.m-cover .cover-placeholder{font-size:50px}
.detail-cover-ph{display:flex;align-items:center;justify-content:center;height:240px;background:linear-gradient(130deg,var(--brand-soft),var(--bg-2))}
.detail-cover-ph .cover-placeholder{display:flex;position:static;background:transparent;font-size:64px}
.buy-row{display:flex;gap:var(--space-8);margin:0 0 var(--space-12)}.sec-label{font-size:10.5px;color:var(--fg-subtle);letter-spacing:.08em;margin:0 0 7px}.detail-chips{display:flex;gap:var(--space-6);flex-wrap:nowrap;overflow-x:auto;margin:0 0 var(--space-12);padding-bottom:var(--space-2)}.detail-chip{border:1px solid var(--border-2);background:var(--panel-2);color:var(--fg-muted);border-radius:var(--radius-pill);padding:5px var(--space-12);font-size:var(--font-12);cursor:pointer;white-space:nowrap;flex:none}.detail-chip.on{color:var(--fg);background:var(--brand-soft);border-color:var(--brand-soft);font-weight:600}.detail-chip .tick{margin-right:var(--space-2)}.alert-block{border:1px solid var(--border);border-radius:var(--radius-11);padding:11px var(--space-12);background:linear-gradient(180deg,var(--panel-2),var(--panel));margin:0 0 var(--space-12)}.alert-title{display:flex;align-items:center;gap:7px;font-weight:600;font-size:12.5px;margin:0 0 3px}.ref{color:var(--fg-muted);font-size:11.5px;margin:0 0 9px}.ref b{color:var(--fg)}.input-row{display:flex;gap:var(--space-6);align-items:center;flex-wrap:wrap}.money-box{display:flex;align-items:center;gap:5px;background:var(--panel-2);border:1px solid var(--border-2);border-radius:var(--radius-8);padding:0 9px;height:31px}.money-box span{color:var(--fg-subtle)}.money-box input{background:transparent;border:0;outline:0;color:var(--fg);width:150px;font-size:12.5px}.saved{display:flex;align-items:center;gap:9px;margin:0 0 9px}.watch-pill{display:inline-flex;align-items:center;gap:5px;background:var(--brand-soft);border:1px solid var(--brand-soft);color:var(--brand);border-radius:var(--radius-pill);padding:3px 11px;font-size:11.5px}.alert-fold{display:flex;align-items:center;justify-content:space-between;cursor:pointer;font-size:12.5px}.alert-fold .l{display:flex;align-items:center;gap:7px;font-weight:600}.alert-fold .r{color:var(--fg-muted)}.detail-owned-final{margin:0 0 var(--space-10);padding:var(--space-8) var(--space-12);background:var(--panel-2);border:1px solid var(--border-2);border-radius:var(--radius-9);font-size:var(--font-12);color:var(--fg)}.watchlist .watch-row{display:flex;align-items:center;gap:var(--space-10);padding:9px var(--space-6);border-bottom:var(--space-1) dashed var(--border);font-size:12.5px}.watchlist .watch-name{flex:1;cursor:pointer;color:var(--brand);font-weight:600}.watchlist .watch-target{color:var(--fg)}.watchlist .watch-now{color:var(--fg-muted)}.watchlist .watch-hist{color:var(--fg-subtle)}.watchlist .watch-time{color:var(--fg-subtle);font-size:var(--font-11)}.m-watch-row{display:flex;align-items:center;gap:var(--space-8);padding:var(--space-10) var(--space-2);border-bottom:var(--space-1) solid var(--border);font-size:var(--font-13)}.m-watch-name{flex:1;color:var(--brand);font-weight:600}.m-watch-info{color:var(--fg-muted);font-size:11.5px}.m-watch-list{padding:var(--space-6) var(--space-2) var(--space-12)}</style>













