<script setup>
// AT 批（docs/ADMIN-CONSOLE-IA.md §7.7）：价格变化「变化」列悬停弹出的近 7 天线图。
// 纯前端手写 SVG（与 PriceHistoryReport.vue 同风格，不引图表库）；
// 数据来自 /api/admin/reports/price 的 series（随列表一次返回，悬停零额外请求）。
import { computed } from 'vue';

const props = defineProps({
  points: { type: Array, default: () => [] },
  current: { type: Number, default: null },
  currency: { type: String, default: 'CNY' },
});

const CURRENCY_SYMBOL = { CNY: '¥', USD: '$', HKD: 'HK$', TWD: 'NT$', EUR: '€', GBP: '£', JPY: 'JP¥' };
const money = (cents) =>
  cents == null ? '—' : `${CURRENCY_SYMBOL[String(props.currency ?? '').toUpperCase()] || ''}${(Number(cents) / 100).toFixed(2)}`;

const low7 = computed(() => (props.points.length ? Math.min(...props.points.map((p) => p.price_cents)) : null));

const chart = computed(() => {
  const list = props.points;
  if (!list.length) return null;
  const W = 240;
  const H = 64;
  const pad = 6;
  const minV = Math.min(...list.map((p) => p.price_cents));
  const maxV = Math.max(...list.map((p) => p.price_cents));
  const span = maxV - minV || 1;
  const pts = list.map((p, i) => {
    const x = list.length === 1 ? W / 2 : pad + ((W - 2 * pad) * i) / (list.length - 1);
    const y = H - pad - ((p.price_cents - minV) / span) * (H - 2 * pad);
    return { x: x.toFixed(1), y: y.toFixed(1), ...p };
  });
  return { pts, points: pts.map((p) => `${p.x},${p.y}`).join(' '), firstDay: list[0].day, lastDay: list[list.length - 1].day };
});
</script>

<template>
  <div class="ps">
    <div class="ps-head">
      <span>近 7 天每日最低</span>
      <span class="ps-now">当前 {{ money(current) }}</span>
    </div>
    <template v-if="chart">
      <div class="ps-lows"><span>7 天最低 <strong>{{ money(low7) }}</strong></span><span>{{ chart.firstDay }} → {{ chart.lastDay }}</span></div>
      <svg viewBox="0 0 240 64" preserveAspectRatio="none" role="img" aria-label="近 7 天价格走势">
        <polyline :points="chart.points" fill="none" stroke="#8b82f5" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
        <circle
          v-for="(p, i) in chart.pts"
          :key="i"
          :cx="p.x"
          :cy="p.y"
          r="3"
          :fill="p.price_cents === low7 ? '#34c39b' : '#8b82f5'"
        >
          <title>{{ p.day }} · {{ money(p.price_cents) }}</title>
        </circle>
      </svg>
    </template>
    <div v-else class="ps-empty">暂无 7 天数据</div>
  </div>
</template>

<style scoped>
.ps{width:248px;padding:2px 4px}
.ps-head{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:var(--fg-muted);margin-bottom:4px}
.ps-now{color:var(--fg);font-weight:600}
.ps-lows{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:var(--fg-muted);margin-bottom:2px}
.ps-lows strong{color:var(--success)}
.ps svg{display:block;width:100%;height:64px}
.ps-empty{padding:18px 0;text-align:center;font-size:12px;color:var(--fg-muted)}
</style>
