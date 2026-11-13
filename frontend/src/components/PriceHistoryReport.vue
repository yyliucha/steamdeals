<script setup>
// BO 批（docs/PRICE-HISTORY-REPORT.md §11）：价格历史报表 = 指标条 + 区间切换 + 150px SVG 趋势线。
// 按所有者要求删掉「日期表格 / 移动卡片 / 分页」（与趋势线重复），把空间给趋势线；史低位置画虚线参考线。
// 纯前端：detail.series 已含全量每日最低（跨官方平台、国区 cn、按天升序）。
import { computed, ref } from 'vue';

const props = defineProps({
  series: { type: Array, default: () => [] },
  currentLow: { type: Number, default: null },
  currency: { type: String, default: 'CNY' },
});

const CURRENCY_SYMBOL = { CNY: '¥', USD: '$', HKD: 'HK$', TWD: 'NT$', EUR: '€', GBP: '£', JPY: 'JP¥' };
const money = (cents) => (cents == null ? '—' : `${CURRENCY_SYMBOL[String(props.currency ?? '').toUpperCase()] || ''}${(Number(cents) / 100).toFixed(2)}`);
const range = ref('90');

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

const chart = computed(() => {
  const list = filtered.value;
  if (!list.length) return null;
  const W = 840;
  const H = 150;
  const pad = 12;
  const minV = Math.min(...list.map((p) => p.price_cents));
  const maxV = Math.max(...list.map((p) => p.price_cents));
  const span = maxV - minV || 1;
  // BO 批（§11.3）：平线（区间最低 = 最高）垂直居中，不再贴底；
  // 点坐标一次算好并保留数组（BN 批），低点圆点直接复用 pts。
  const priceY = (v) => (maxV === minV ? H / 2 : H - pad - ((v - minV) / span) * (H - 2 * pad));
  const pts = list.map((p, i) => {
    const x = list.length === 1 ? W / 2 : pad + ((W - 2 * pad) * i) / (list.length - 1);
    return { x: Number(x.toFixed(1)), y: Number(priceY(p.price_cents).toFixed(1)) };
  });
  const points = pts.map((d) => `${d.x},${d.y}`).join(' ');
  const low = lowDays.value.length ? lowDays.value[lowDays.value.length - 1] : null;
  // 史低虚线参考线的 y：夹在绘图区内（区间不含史低时贴边显示，仍能看出"史低在本区间之外/之下"）
  const lowY = histLow.value == null ? pad : Number(Math.min(H - pad, Math.max(pad, priceY(histLow.value))).toFixed(1));
  return { pts, points, area: `${pad},${H - pad} ${points} ${W - pad},${H - pad}`, lowY, minV, maxV, lowLabel: low ? `${money(histLow.value)} · ${low}` : '' };
});

// BN 批（§10.1/§10.2）：史低圆点在 JS 里一次算好（数据 + 坐标），模板只保留 v-for——
// 原写法把 v-for 与 v-if 写在同一个 <circle> 上，Vue 3 里 v-if 优先级更高，
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
        <button :class="{ on: range === '30' }" @click="range = '30'">近 30 天</button>
        <button :class="{ on: range === '90' }" @click="range = '90'">近 90 天</button>
        <button :class="{ on: range === 'all' }" @click="range = 'all'">全部</button>
      </div>
    </div>
    <template v-if="chart">
      <div class="phr-chart">
        <div class="phr-axis">
          <span class="phr-axis-low">{{ money(rangeMin) }} · 史低线</span>
          <span class="phr-axis-range">区间 {{ filtered[0].day }} → {{ filtered[filtered.length - 1].day }}</span>
        </div>
        <svg viewBox="0 0 840 150" preserveAspectRatio="none" role="img" aria-label="价格趋势">
          <line x1="12" :y1="chart.lowY" x2="828" :y2="chart.lowY" stroke="rgba(52,195,155,.55)" stroke-width="1" stroke-dasharray="4 4" />
          <polygon :points="chart.area" fill="rgba(139,130,245,.12)" />
          <polyline :points="chart.points" fill="none" stroke="#8b82f5" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
          <circle v-for="(d, k) in lowDots" :key="'dot' + k" :cx="d.x" :cy="d.y" r="3.5" fill="#34c39b">
            <title>{{ d.p.day }} · {{ money(d.p.price_cents) }}</title>
          </circle>
        </svg>
        <div class="phr-chart-cap">
          <span>{{ filtered[0].day }}</span>
          <span class="phr-low-tag">● 史低 {{ chart.lowLabel }}</span>
          <span>{{ filtered[filtered.length - 1].day }}</span>
        </div>
      </div>
      <div class="phr-foot">共 {{ filtered.length }} 条 · 每天取官方渠道最低价（不含 C2C）· 史低已标出</div>
    </template>
    <div v-else class="phr-empty">暂无历史记录</div>
  </div>
</template>
