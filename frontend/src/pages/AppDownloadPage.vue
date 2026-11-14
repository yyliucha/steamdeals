<template>
  <div class="app-page">
    <header class="app-header">
      <a class="back-home" href="/">← 返回 SteamDeals</a>
      <h1>安卓版 App</h1>
      <p class="app-sub">基于 TWA（Trusted Web Activity）打包，与网页版完全一致；不上架应用商店，仅本站与 GitHub 分发。</p>
    </header>

    <main class="app-card">
      <div v-if="loading" class="app-state">正在获取最新版本…</div>
      <el-alert v-else-if="loadError" :title="'版本信息加载失败：' + loadError" type="warning" :closable="false" />
      <template v-else>
        <section class="app-latest">
          <h2>最新版本</h2>
          <div class="app-meta">
            <div><span>版本</span><strong>{{ latest?.version || '—' }}</strong></div>
            <div><span>大小</span><strong>{{ sizeText }}</strong></div>
            <div><span>发布时间</span><strong>{{ releasedText }}</strong></div>
          </div>
          <el-button v-if="latest?.apkPath" type="primary" size="large" tag="a" :href="latest.apkPath" download class="app-dl-btn">下载 APK</el-button>
          <div v-else class="app-state">暂无安装包（发版后开放下载）</div>
          <p v-if="latest?.sha256" class="app-sha">SHA-256：<code>{{ latest.sha256 }}</code></p>
          <p class="app-sha-note">下载后建议校验：<code>certutil -hashfile steamdeals.apk SHA256</code>（Windows）/ <code>sha256sum</code>（Linux/macOS）。</p>
          <p class="app-alt">备用下载：<a href="https://github.com/yyliucha/steamdeals/releases" target="_blank" rel="noopener noreferrer nofollow">GitHub Release ↗</a>（tag <code>app-v&lt;版本号&gt;</code>，含同名 APK 与 .sha256）</p>
        </section>

        <section class="app-steps">
          <h2>安装步骤</h2>
          <ol>
            <li>下载上方 APK；</li>
            <li>首次安装时系统会提示「允许来自此来源的应用」——在弹窗里允许本站（或到 设置 → 安全 → 未知来源 里开启）；</li>
            <li>安装后打开即全屏运行；以后站点发新版，App 内顶部会提示「已更新到 vX.Y.Z，点击刷新」。</li>
          </ol>
        </section>

        <section class="app-limits">
          <h2>已知限制</h2>
          <ul>
            <li>不提供推送与桌面角标（TWA 无法实现；到价提醒仍走邮件 / 企业微信）；</li>
            <li>不展示 Steam「已拥有哪些 DLC」——Steam 公开 API 不提供该数据；</li>
            <li>离线时只能兜住页面观感（图标/样式），价格与列表必须联网；</li>
            <li>App 与手机浏览器是两套独立登录会话。</li>
          </ul>
        </section>
      </template>
    </main>
  </div>
</template>

<script setup>
// BS 批（docs/MOBILE-APP-TWA.md §5.1）：安卓版下载页——版本/大小/SHA-256/安装步骤/已知限制 + GitHub 备用链接。
import { computed, onMounted, ref } from 'vue';

const latest = ref(null);
const loading = ref(true);
const loadError = ref('');
const sizeText = computed(() => {
  const n = Number(latest.value?.size);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
});
const releasedText = computed(() => {
  const t = latest.value?.releasedAt;
  if (!t) return '—';
  try {
    return new Date(t).toLocaleDateString('zh-CN');
  } catch {
    return t;
  }
});

onMounted(async () => {
  try {
    const res = await fetch('/api/app/latest', { credentials: 'same-origin', cache: 'no-store' });
    const data = await res.json().catch(() => null);
    latest.value = data && typeof data === 'object' ? data : null;
    if (!res.ok) loadError.value = data?.error || `HTTP ${res.status}`;
  } catch (e) {
    loadError.value = String(e?.message ?? e).slice(0, 120);
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.app-page{max-width:720px;margin:0 auto;padding:24px 16px 48px;color:var(--fg)}
.app-header{margin-bottom:18px}
.back-home{color:var(--fg-muted);text-decoration:none;font-size:13px}
.back-home:hover{color:var(--brand)}
.app-header h1{margin:12px 0 6px;font-size:24px}
.app-sub{color:var(--fg-muted);font-size:13px;margin:0}
.app-card{background:var(--panel-2);border:1px solid var(--border);border-radius:12px;padding:18px}
.app-card h2{margin:0 0 10px;font-size:16px}
.app-latest{border-bottom:1px dashed var(--border);padding-bottom:14px;margin-bottom:14px}
.app-meta{display:flex;gap:22px;margin-bottom:14px}
.app-meta div{display:flex;flex-direction:column;gap:3px}
.app-meta span{color:var(--fg-muted);font-size:11.5px}
.app-meta strong{font-size:16px}
.app-dl-btn{margin-bottom:10px}
.app-sha{font-size:12px;color:var(--fg-muted);word-break:break-all;margin:6px 0}
.app-sha code{font-size:11.5px}
.app-sha-note{font-size:12px;color:var(--fg-muted);margin:4px 0}
.app-alt{font-size:13px;margin:6px 0}
.app-alt a{color:var(--brand)}
.app-state{color:var(--fg-muted);padding:12px 0}
.app-steps ol,.app-limits ul{margin:0;padding-left:20px;font-size:13.5px;line-height:1.9;color:var(--fg-2)}
.app-limits{margin-top:6px}
</style>
