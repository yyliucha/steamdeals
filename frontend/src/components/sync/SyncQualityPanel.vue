<script setup>
// GA-1（docs/SYNC-PAGE-REDESIGN.md §2.2 / §3-3 / §3-4）：折叠「数据质量」的内容——
//   ① 内容分级统计 5 卡（只读计数，全库口径）+ 最近回填时间；
//   ② 数据时效 4 卡（超 1/3/7 天，卡片顺序 7/3/1 天）+「补跑」；
//   ③ 429 补跑队列 3 卡 +「立即补 429」。
// 三块原来平铺在页面中部（第 2、5、6 块），现在收进一个折叠区，收起时摘要显示在标题行（SyncAdmin 传入）。
import { useSyncAdmin } from '../../composables/useSyncAdmin.js';

const {
  state,
  kpi,
  dateTime,
  ratingBackfillLastRunAt,
  runFreshness,
  loadFreshness,
  loadGamesStats,
} = useSyncAdmin();

const submitted = state.submitted;
const freshness = () => state.freshness || {};
const nums = (k) => {
  const v = freshness()?.[k] || {};
  return { d7: Number(v.d7) || 0, d3: Number(v.d3) || 0, d1: Number(v.d1) || 0, total: Number(v.total) || 0 };
};
</script>

<template>
  <div class="sync-quality">
    <p class="sync-fold-hint">内容分级统计（只读计数，全库口径含未上架/已禁用）</p>
    <div class="sync-stat-grid">
      <div class="sync-stat"><span>成人内容（宽）</span><b>{{ Number(state.gamesStats?.adult || 0).toLocaleString('zh-CN') }}</b></div>
      <div class="sync-stat"><span>色情游戏（严格）</span><b>{{ Number(state.gamesStats?.explicit || 0).toLocaleString('zh-CN') }}</b></div>
      <div class="sync-stat"><span>成熟内容</span><b>{{ Number(state.gamesStats?.mature || 0).toLocaleString('zh-CN') }}</b></div>
      <div class="sync-stat"><span>分级已回填</span><b>{{ Number(state.gamesStats?.ratingBackfilled || 0).toLocaleString('zh-CN') }}</b></div>
      <div class="sync-stat"><span>分级未回填</span><b>{{ Number(state.gamesStats?.ratingPending || 0).toLocaleString('zh-CN') }}</b></div>
    </div>
    <p class="sync-fold-hint">最近回填 {{ ratingBackfillLastRunAt ? dateTime(ratingBackfillLastRunAt) : '—' }} <el-button link type="primary" size="small" @click="loadGamesStats">刷新</el-button></p>

    <div class="sync-split" />
    <p class="sync-fold-hint">数据时效（超 1 / 3 / 7 天未更新；点「补跑」立即触发对应任务）</p>
    <div class="sync-stat-4">
      <div class="sync-stat">
        <span>价格超期</span><b>{{ nums('prices').d1.toLocaleString('zh-CN') }}</b>
        <small>7 天 {{ nums('prices').d7.toLocaleString('zh-CN') }} · 3 天 {{ nums('prices').d3.toLocaleString('zh-CN') }}</small>
        <div class="sync-stat-act"><el-button size="small" :disabled="submitted.has('fresh:steam-prices')" @click="runFreshness('steam-prices')">{{ submitted.has('fresh:steam-prices') ? '已提交' : '补跑价格' }}</el-button></div>
      </div>
      <div class="sync-stat">
        <span>状态超期</span><b>{{ nums('status').d1.toLocaleString('zh-CN') }}</b>
        <small>7 天 {{ nums('status').d7.toLocaleString('zh-CN') }} · 3 天 {{ nums('status').d3.toLocaleString('zh-CN') }}</small>
        <div class="sync-stat-act"><el-button size="small" :disabled="submitted.has('fresh:steam-status')" @click="runFreshness('steam-status')">{{ submitted.has('fresh:steam-status') ? '已提交' : '补跑状态' }}</el-button></div>
      </div>
      <div class="sync-stat">
        <span>中文名缺失</span><b>{{ nums('names').d1.toLocaleString('zh-CN') }}</b>
        <small>7 天 {{ nums('names').d7.toLocaleString('zh-CN') }} · 3 天 {{ nums('names').d3.toLocaleString('zh-CN') }}</small>
        <div class="sync-stat-act"><el-button size="small" :disabled="submitted.has('fresh:rename')" @click="runFreshness('rename')">{{ submitted.has('fresh:rename') ? '已提交' : '补跑中文名' }}</el-button></div>
      </div>
      <div class="sync-stat">
        <span>缺封面</span><b>{{ nums('images').d1.toLocaleString('zh-CN') }}</b>
        <small>7 天 {{ nums('images').d7.toLocaleString('zh-CN') }} · 3 天 {{ nums('images').d3.toLocaleString('zh-CN') }}</small>
        <div class="sync-stat-act"><el-button size="small" :disabled="submitted.has('fresh:images')" @click="runFreshness('images')">{{ submitted.has('fresh:images') ? '已提交' : '补跑图片' }}</el-button></div>
      </div>
    </div>

    <div class="sync-split" />
    <p class="sync-fold-hint">429 补跑队列（撞 429 收轮的 appid 自动入队，下轮优先补）<el-button link type="primary" size="small" @click="loadFreshness">刷新</el-button></p>
    <div class="sync-stat-4">
      <div class="sync-stat"><span>排队中</span><b>{{ Number(state.queue429?.count || 0).toLocaleString('zh-CN') }}</b></div>
      <div class="sync-stat"><span>最大重试次数</span><b>{{ Number(state.queue429?.maxAttempts || 0) }}</b></div>
      <div class="sync-stat"><span>最早入队</span><b>{{ state.queue429?.oldestAt ? dateTime(state.queue429.oldestAt) : '—' }}</b></div>
      <div class="sync-stat">
        <span>操作</span>
        <div class="sync-stat-act">
          <el-button type="primary" size="small" :disabled="!(kpi.queue > 0) || submitted.has('fresh:backfill')" :title="kpi.queue > 0 ? '立即补跑 429 队列' : '队列为空'" @click="runFreshness('backfill')">{{ submitted.has('fresh:backfill') ? '已提交' : '立即补 429' }}</el-button>
        </div>
      </div>
    </div>
  </div>
</template>
