<script setup>
// AP 批（docs/PRICE-HISTORY-REPORT.md §4）：价格历史报表——指标条 + SVG 趋势线 + 表格（史低高亮）。
// 纯前端：detail.series 已含全量每日最低（跨官方平台、国区 cn、按天升序）。
import { computed, ref } from 'vue';

// 窄屏（手机）用卡片替代表格（决策 4）；与 Home 的断点保持一致。
const isNarrow = ref(false);
if (typeof window !== 'undefined' && window.matchMedia) {
  const mq = window.matchMedia('(max-width: 760px)');
  isNarrow.value = mq.matches;
  mq.addEventListener('change', (e) => { isNarrow.value = e.matches; });
}

const props = defineProps({
  series: { type: Array, default: () => [] },
  currentLow: { type: Number, default: null },
  currency: { type: String, default: 'CNY' },
});

const CURRENCY_SYMBOL = { CNY: '¥', USD: '$', HKD: 'HK$', TWD: 'NT$', EUR: '€', GBP: '£', JPY: 'JP¥' };
const money = (cents) => (cents == null ? '—' : `${CURRENCY_SYMBOL[String(props.currency ?? '').toUpperCase()] || ''}${(Number(cents) / 100).toFixed(2)}`);
const range = ref('90');
const page = ref(1);
const PAGE_SIZE = 10;

const asc = computed(() => props.series);
const lastDay = computed(() => (asc.value.length ? asc.value[asc.value.length - 1].day : null));
const filtered = computed(() => {
  if (range.value === 'all' || !lastDay.value) return asc.value;
  const days = range.value === '30' ? 30 : 90;
  const end = new Date(`${lastDay.value}T00:00:00`).getTime();
  return asc.value.filter((p) => new Date(`${p.day}T00:00:00`).getTime() > end - days * 86400000);
});
const histLow = computed(() => (asc.value.length ? Math.min(...asc.value.map((p) => p.price_cents)) : null));
const lowDays = computed(() => (histLow.value == null ? [] : asc.value.filter((p) => p.price_cents === histLow.value).map((p) => p.day)));
const rangeMin = computed(() => (filtered.value.length ? Math.min(...filtered.value.map((p) => p.price_cents)) : null));
const rangeMax = computed(() => (filtered.value.length ? Math.max(...filtered.value.map((p) => p.price_cents)) : null));
const curVsHist = computed(() => {
  const cur = props.currentLow;
  if (cur == null || histLow.value == null) return '—';
  if (cur <= histLow.value) return '已是史低';
  return `+${(((cur - histLow.value) / histLow.value) * 100).toFixed(1)}%`;
});
const rows = computed(() => {
  const list = filtered.value;
  const out = [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const p = list[i];
    const prev = i > 0 ? list[i - 1] : null;
    let chg = { text: '—', cls: 'flat' };
    if (prev) {
      const diff = p.price_cents - prev.price_cents;
      if (diff === 0) chg = { text: '持平', cls: 'flat' };
      else if (diff < 0) chg = { text: `↓ ${money(-diff)} · -${((-diff / prev.price_cents) * 100).toFixed(1)}%`, cls: 'down' };
      else chg = { text: `↑ ${money(diff)} · +${((diff / prev.price_cents) * 100).toFixed(1)}%`, cls: 'up' };
    }
    out.push({ ...p, chg, first: !prev, isLow: p.price_cents === histLow.value });
  }
  return out;
});
const paged = computed(() => rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
const totalPages = computed(() => Math.max(1, Math.ceil(rows.value.length / PAGE_SIZE)));

const chart = computed(() => {
  const list = filtered.value;
  if (!list.length) return null;
  const W = 840;
  const H = 76;
  const pad = 6;
  const minV = Math.min(...list.map((p) => p.price_cents));
  const maxV = Math.max(...list.map((p) => p.price_cents));
  const span = maxV - minV || 1;
  // BN 批（docs/PRICE-HISTORY-REPORT.md §10.3）：点坐标一次算好并保留数组，
  // 模板不再对 points 字符串做 split(' ') 二次解析（低点圆点也直接复用 pts）。
  const pts = list.map((p, i) => {
    const x = list.length === 1 ? W / 2 : pad + ((W - 2 * pad) * i) / (list.length - 1);
    const y = H - pad - ((p.price_cents - minV) / span) * (H - 2 * pad);
    return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) };
  });
  const points = pts.map((d) => `${d.x},${d.y}`).join(' ');
  const low = lowDays.value.length ? lowDays.value[lowDays.value.length - 1] : null;
  return { pts, points, area: `${pad},${H} ${points} ${W - pad},${H}`, lowLabel: low ? `${money(histLow.value)} · ${low}` : '' };
});

// BN 批（docs/PRICE-HISTORY-REPORT.md §10.1/§10.2）：史低圆点在 JS 里一次算好（数据 + 坐标），
// 模板只保留 v-for——原写法把 v-for 与 v-if 写在同一个 <circle> 上，Vue 3 里 v-if 优先级更高，
// 编译后判断被提到 renderList 外、引用循环变量 p → 运行时 TypeError → 整个报表组件渲染失败。
const lowDots = computed(() => {
  if (!chart.value) return [];
  const list = filtered.value;
  return chart.value.pts
    .map((pt, i) => ({ ...pt, p: list[i] }))
    .filter((d) => d.p && d.p.price_cents === histLow.value);
});
</script>

<template>
  <div class="phr">
    <div class="phr-stats">
      <div class="phr-stat"><span>区间最低</span><strong>{{ money(rangeMin) }}</strong></div>
      <div class="phr-stat"><span>区间最高</span><strong>{{ money(rangeMax) }}</strong></div>
      <div class="phr-stat"><span>当前较史低</span><strong :class="{ low: curVsHist === '已是史低' }">{{ curVsHist }}</strong></div>
      <div class="phr-stat"><span>记录天数</span><strong>{{ filtered.length }}</strong></div>
    </div>
    <div class="phr-head">
      <h4>价格历史</h4>
      <div class="phr-tabs">
        <button :class="{ on: range === '30' }" @click="range = '30'; page = 1">近 30 天</button>
        <button :class="{ on: range === '90' }" @click="range = '90'; page = 1">近 90 天</button>
        <button :class="{ on: range === 'all' }" @click="range = 'all'; page = 1">全部</button>
      </div>
    </div>
    <template v-if="chart">
      <div class="phr-chart">
        <div class="phr-chart-cap">
          <span>{{ filtered[0].day }}</span>
          <span class="phr-low-tag">● 史低 {{ chart.lowLabel }}</span>
          <span>{{ filtered[filtered.length - 1].day }}</span>
        </div>
        <svg viewBox="0 0 840 76" preserveAspectRatio="none" role="img" aria-label="价格趋势">
          <polygon :points="chart.area" fill="rgba(139,130,245,.12)" />
          <polyline :points="chart.points" fill="none" stroke="#8b82f5" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
          <circle v-for="(d, k) in lowDots" :key="'dot' + k" :cx="d.x" :cy="d.y" r="3.5" fill="#34c39b">
            <title>{{ d.p.day }} · {{ money(d.p.price_cents) }}</title>
          </circle>
        </svg>
      </div>
      <div class="phr-table-wrap" :class="{ card: isNarrow }">
        <table v-if="!isNarrow" class="phr-table">
          <thead><tr><th>日期</th><th>当日最低</th><th>较前一日</th><th>标记</th></tr></thead>
          <tbody>
            <tr v-for="r in paged" :key="r.day" :class="{ low: r.isLow }">
              <td>{{ r.day }}</td><td class="phr-price" :class="{ low: r.isLow }">{{ money(r.price_cents) }}</td>
              <td :class="`phr-chg ${r.chg.cls}`">{{ r.chg.text }}</td>
              <td><span v-if="r.isLow" class="phr-badge">史低</span><span v-if="r.first" class="phr-badge muted">首条</span></td>
            </tr>
          </tbody>
        </table>
        <div v-else class="phr-cards">
          <div v-for="r in paged" :key="r.day" class="phr-card" :class="{ low: r.isLow }">
            <div><span>{{ r.day }}</span><strong>{{ money(r.price_cents) }}</strong></div>
            <div><span :class="`phr-chg ${r.chg.cls}`">{{ r.chg.text }}</span><span v-if="r.isLow" class="phr-badge">史低</span></div>
          </div>
        </div>
        <div class="phr-foot" v-if="totalPages > 1">
          <span>共 {{ rows.length }} 条 · 每天取官方渠道最低价</span>
          <span class="phr-pager"><button :disabled="page <= 1" @click="page -= 1">‹</button><button class="on">{{ page }}/{{ totalPages }}</button><button :disabled="page >= totalPages" @click="page += 1">›</button></span>
        </div>
        <div class="phr-foot" v-else>共 {{ rows.length }} 条 · 每天取官方渠道最低价（不含 C2C）</div>
      </div>
    </template>
    <div v-else class="phr-empty">暂无历史记录</div>
  </div>
</template>
