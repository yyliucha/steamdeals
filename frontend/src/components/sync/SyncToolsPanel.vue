<script setup>
// GA-1（docs/SYNC-PAGE-REDESIGN.md §2.2 / §3-4）：折叠「工具」的内容——
//   ① 初始化全量同步（危险动作，二次确认；文案保留「默认 20 万上限」）；
//   ② App 版本（4 卡：当前版本 / 上次同步 / 失败原因 / 状态 + 立即同步）。
// 两块原来平铺在页面顶部与底部（第 3、7 块），现在收进一个折叠区，收起时摘要显示在标题行。
import { useSyncAdmin } from '../../composables/useSyncAdmin.js';

const { state, dateTime, runInitSync, syncAppNow } = useSyncAdmin();
const submitted = state.submitted;
</script>

<template>
  <div class="sync-tools">
    <div class="sync-tool-row">
      <div class="sync-tool-text">
        <h3>初始化全量同步</h3>
        <p>新部署 / 大规模补数专用：全量回填目录元数据与国区价格（默认 20 万上限、429 自动收尾保留进度）。日常增量维护用上面的任务表。</p>
      </div>
      <el-button type="warning" :disabled="submitted.has('init') || Boolean(state.status?.running)" @click="runInitSync">{{ submitted.has('init') ? '已提交' : '初始化全量同步' }}</el-button>
    </div>
    <div class="sync-tool-row">
      <div class="sync-tool-text">
        <h3>App 版本</h3>
        <p>站点自托管安卓最新版；发版后点「立即同步」，手机数十秒内可检测到更新。</p>
      </div>
      <el-button type="primary" :disabled="submitted.has('app')" @click="syncAppNow">{{ submitted.has('app') ? '已提交' : '立即同步' }}</el-button>
    </div>
    <div class="sync-stat-4">
      <div class="sync-stat"><span>当前版本</span><b>{{ state.appCard?.latest ? `${state.appCard.latest.version}（${state.appCard.latest.versionCode}）` : '—' }}</b></div>
      <div class="sync-stat"><span>上次同步</span><b>{{ state.appCard?.lastSyncAt ? dateTime(state.appCard.lastSyncAt) : '—' }}</b></div>
      <div class="sync-stat"><span>失败原因</span><b class="sync-text-danger">{{ state.appCard?.lastError || '—' }}</b></div>
      <div class="sync-stat"><span>状态</span><b>{{ state.appCard?.syncing ? '同步中…' : '就绪' }}</b></div>
    </div>
  </div>
</template>
