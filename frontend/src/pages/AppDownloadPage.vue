<template>
  <div class="app-page">
    <header class="app-header">
      <a class="back-home" href="/">← 返回 SteamDeals</a>
      <h1>安卓版 App</h1>
      <p class="app-sub">原生 Android 应用（Kotlin + Compose），与网页版共用同一后端数据；不上架应用商店，仅本站与 GitHub 分发。</p>
    </header>

    <!-- 微信内置浏览器：微信内不能直接下载安装 APK，提示转到系统浏览器（CA-5，docs/APP-NATIVE.md §5） -->
    <main v-if="isWeChat" class="app-card wechat-hint">
      <h2>请用浏览器打开</h2>
      <p class="wechat-text">当前在微信内置浏览器中，无法直接下载安装 APK。请点右上角「···」→「在浏览器打开」，在本站继续下载。</p>
      <ol class="wechat-steps">
        <li>点右上角「···」按钮；</li>
        <li>选择「在浏览器打开」（或复制链接到浏览器地址栏）；</li>
        <li>在浏览器中重新打开本页，即可下载安装。</li>
      </ol>
    </main>

    <main v-else class="app-card">
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
            <li>已装旧版（2.x 网页打包版）可直接覆盖安装——包名与签名一致，数据与登录无需重装；</li>
            <li>首次安装时系统会提示「允许来自此来源的应用」——在弹窗里允许本站（或到 设置 → 安全 → 未知来源 里开启）；</li>
            <li>安装后打开即用；以后发新版，App 内会提示「发现新版本」并支持一键更新。</li>
          </ol>
        </section>

        <section class="app-limits">
          <h2>已知限制</h2>
          <ul>
            <li>App 与网页版是两套独立登录（App 用 Token 登录）；</li>
            <li>第一期不含 Steam 账号绑定/同步与推送通知（到价提醒仍走邮件 / 企业微信）；</li>
            <li>管理后台仍在网页版 /console（App 内不做管理）；</li>
            <li>价格与列表必须联网（与网页版共用同一后端）。</li>
          </ul>
        </section>
      </template>
    </main>
  </div>
</template>

<script setup>
// BS 批（docs/MOBILE-APP-TWA.md §5.1）：安卓版下载页——版本/大小/SHA-256/安装步骤/已知限制 + GitHub 备用链接。
// CA-5（docs/APP-NATIVE.md §5）：改版为原生 App 文案（保留现有 APK 下载）+ 微信内「在浏览器打开」提示。
import { computed, onMounted, ref } from 'vue';

const latest = ref(null);
const loading = ref(true);
const loadError = ref('');
// 微信内置浏览器判定（UA 含 MicroMessenger）：显示「在浏览器打开」提示、隐藏下载区
const isWeChat = typeof navigator !== 'undefined' && /MicroMessenger/i.test(navigator.userAgent);
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
.wechat-hint h2{color:var(--brand)}
.wechat-text{font-size:14px;line-height:1.8;color:var(--fg-2);margin:0 0 10px}
.wechat-steps{margin:0;padding-left:20px;font-size:13.5px;line-height:1.9;color:var(--fg-2)}
</style>
