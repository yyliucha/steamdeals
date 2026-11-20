<template>
  <!-- CW 批（docs/ADMIN-GAME-POPUP.md）：后台游戏详情弹窗——游戏目录与回收站共用；
       数据只用站内已同步的 Steam 数据（GET /api/games/:appid），不做实时 Steam 请求。 -->
  <el-dialog
    :model-value="modelValue"
    class="game-detail-dialog"
    width="640px"
    :show-close="false"
    append-to-body
    @update:model-value="(v) => emit('update:modelValue', v)"
    @closed="onClosed"
  >
    <template #header>
      <div class="gdd-head">
        <h3 class="gdd-title">游戏详情</h3>
        <span v-if="game && !isDeleted" class="gdd-tag" :class="synced ? 'ok' : 'warn'">{{ synced ? '已同步' : '未同步' }}</span>
        <span v-if="game?.adult_flag" class="gdd-tag danger">成人</span>
        <span v-else-if="game?.mature_flag" class="gdd-tag mature">成熟</span>
        <span v-if="isDeleted" class="gdd-tag danger">已删除</span>
        <button type="button" class="gdd-x" aria-label="关闭" @click="close">✕</button>
      </div>
    </template>

    <div v-if="loading" class="gdd-loading">正在加载游戏详情…</div>
    <div v-else-if="error" class="gdd-loading">详情加载失败：{{ error }}（数据来自站内已同步的 Steam 数据，可稍后重试）</div>
    <div v-else class="gdd-body">
      <div class="gdd-hero" :class="{ 'ph': coverFailed || !appid }">
        <img v-if="appid && !coverFailed" :src="coverUrl" alt="" loading="lazy" @error="coverFailed = true">
        <CoverPlaceholder v-if="coverFailed || !appid" class="gdd-ph-box" :name="displayName" fill/>
        <i class="gdd-hero-fade"></i>
      </div>

      <p v-if="syncHint" class="gdd-hint">{{ syncHint }}</p>

      <div class="gdd-title-row">
        <h2>{{ displayName || '未命名游戏' }}</h2>
        <span v-if="game?.name_en" class="gdd-en">{{ game.name_en }}</span>
      </div>

      <div class="gdd-appid">
        <template v-if="appid">AppID {{ appid }}</template>
        <template v-else><strong class="gdd-no-steam">未关联 Steam</strong></template>
        <template v-if="appid">
          <span class="gdd-sep">·</span><span>DLC {{ dlcTotal }}</span>
          <span class="gdd-sep">·</span><span>Steam 评测 {{ reviewCount }}</span>
        </template>
      </div>

      <div class="gdd-meta">
        <div><b>发售日期</b><span>{{ fmtList(game?.release_date) }}</span></div>
        <div><b>开发商</b><span>{{ fmtList(game?.developers) }}</span></div>
        <div><b>发行商</b><span>{{ fmtList(game?.publishers) }}</span></div>
        <div><b>类型</b><span>{{ fmtList(game?.genres) }}</span></div>
        <div><b>平台</b><span>{{ platformText }}</span></div>
        <div><b>分级</b><span>{{ ratingText }}</span></div>
      </div>

      <div class="gdd-price">
        <div><div class="gdd-lbl">当前最低</div><strong>{{ money(game?.current_low, game?.currency) }}</strong></div>
        <div><div class="gdd-lbl">史低</div><s>{{ money(game?.hist_low, game?.currency) }}</s></div>
        <div><div class="gdd-lbl">折扣</div>{{ discountText }}</div>
      </div>

      <p
        ref="descEl"
        class="gdd-desc"
        :class="{ clamp: !expanded }"
      >{{ game?.description || '暂无简介。' }}</p>
      <button v-if="showMore" type="button" class="gdd-more" @click="expanded = !expanded">{{ expanded ? '收起简介' : '展开全部简介' }} {{ expanded ? '‹' : '›' }}</button>
    </div>

    <template #footer>
      <div class="gdd-foot">
        <span class="gdd-note">{{ footerNote }}</span>
        <el-button @click="close">关闭</el-button>
        <a
          v-if="appid"
          class="el-button el-button--primary"
          :href="storeUrl"
          target="_blank"
          rel="noopener"
        >在 Steam 商店查看 ↗</a>
        <span v-else :title="'该游戏未关联 Steam'"><el-button type="primary" disabled>在 Steam 商店查看 ↗</el-button></span>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
// CW 批（docs/ADMIN-GAME-POPUP.md §2/§3）：
// - 普通模式（游戏目录）：点游戏名 → 本组件拉 GET /api/games/:appid（站内数据）渲染；
// - deleted 模式（回收站）：详情接口不返回已删除游戏，直接用列表行数据渲染（规格 §5.1 组件复用）；
// - 无 appid：本地兜底——「未关联 Steam」、按钮禁用、不报错（规格 §2.4/§4）。
import { computed, nextTick, ref, watch } from 'vue';
import { fmtDateTime as dateTime } from '../utils/siteTime.js';
import { formatMoney } from '../utils/money.js';
import CoverPlaceholder from './CoverPlaceholder.vue';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  appid: { type: [Number, String], default: null },
  row: { type: Object, default: null },
  deleted: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue']);

const loading = ref(false);
const error = ref('');
const game = ref(null);
const dlc = ref(null);
const coverFailed = ref(false);
const expanded = ref(false);
const showMore = ref(false);
const descEl = ref(null);

const appid = computed(() => {
  const n = Number(props.appid);
  return Number.isInteger(n) && n > 0 ? n : null;
});
const isDeleted = computed(() => props.deleted);
const coverUrl = computed(() => (appid.value ? `/img/steam/${appid.value}/header` : ''));
const storeUrl = computed(() => (appid.value ? `https://store.steampowered.com/app/${appid.value}/` : ''));
const displayName = computed(() => game.value?.name || props.row?.name || game.value?.name_en || props.row?.name_en || '');
// 已同步判定：steam_status === 'ok'（free/coming_soon/region_locked 等其它状态都按「未同步」展示）
const synced = computed(() => game.value?.steam_status === 'ok');
// 未同步兜底提示（规格 §2.5）：steam_status 非 ok 或无简介时，顶部一行提示、其余已有字段照常显示
const syncHint = computed(() => {
  if (!game.value || isDeleted.value) return '';
  if (!appid.value) return '该游戏未关联 Steam，无站内 Steam 数据可展示';
  if (!synced.value || !game.value.description) return '详情待同步，可稍后重试';
  return '';
});
const dlcTotal = computed(() => {
  const n = dlc.value?.total;
  return n == null ? '—' : String(n);
});
const reviewCount = computed(() => {
  const n = game.value?.heat_reviews;
  if (n == null) return '—';
  return Number(n).toLocaleString('en-US');
});
const platformText = computed(() => {
  const fromOffers = (game.value?.all_offers || []).map((o) => o.platform_name).filter(Boolean);
  const fromRow = props.row?.platform_names || [];
  const list = [...new Set([...fromOffers, ...fromRow])];
  return list.length ? list.join(' · ') : '—';
});
const ratingText = computed(() => {
  const g = game.value || {};
  let label = '';
  if (g.adult_flag) label = '成人';
  else if (g.mature_flag) label = '成熟';
  else label = '未标注';
  const age = Number(g.required_age);
  if (label !== '未标注' && Number.isInteger(age) && age > 0) label += `（${age}+）`;
  return label;
});
const discountText = computed(() => {
  const d = game.value?.discount;
  return d == null ? '—' : `-${d}%`;
});
const footerNote = computed(() => {
  if (isDeleted.value) return '该游戏已在回收站，站内详情随删除下线；数据来源：站内已同步的 Steam 数据';
  const checkedAt = game.value?.steam_checked_at;
  return `数据来源：站内已同步的 Steam 数据${checkedAt ? ` · 更新于 ${dateTime(checkedAt)}` : ''}`;
});

function close() {
  emit('update:modelValue', false);
}
function onClosed() {
  game.value = null;
  dlc.value = null;
  error.value = '';
  coverFailed.value = false;
  expanded.value = false;
  showMore.value = false;
}
function money(cents, currency) {
  return formatMoney(cents, currency);
}
// text[] / 字符串统一按「·」连接；空值显示「—」（规格 §2.3 缺字段显示 —）
function fmtList(v) {
  if (Array.isArray(v)) {
    const parts = v.map((x) => String(x ?? '').trim()).filter(Boolean);
    return parts.length ? parts.join(' · ') : '—';
  }
  const s = String(v ?? '').trim();
  return s || '—';
}
// 简介是否超过 4 行截断线：渲染后按实际高度测量，超了才显示「展开全部简介」（规格 §2.2/§4）
function checkClamp() {
  nextTick(() => {
    const el = descEl.value;
    if (!el) {
      showMore.value = false;
      return;
    }
    showMore.value = el.scrollHeight > el.clientHeight + 2;
  });
}

watch(
  () => props.modelValue,
  async (v) => {
    if (!v) return;
    loading.value = false;
    error.value = '';
    game.value = null;
    dlc.value = null;
    coverFailed.value = false;
    expanded.value = false;
    showMore.value = false;
    if (isDeleted.value) {
      // 回收站：直接用行数据渲染（deleted 游戏详情接口 404，规格 §5.1 组件复用 + 行内兜底）
      game.value = { ...(props.row || {}), name: props.row?.name || props.row?.name_en || '' };
      checkClamp();
      return;
    }
    if (!appid.value) {
      // 无 appid：本地兜底（规格 §4），不请求、不报错
      game.value = { ...(props.row || {}) };
      checkClamp();
      return;
    }
    loading.value = true;
    try {
      const r = await fetch(`/api/games/${appid.value}`, { credentials: 'same-origin' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      game.value = d.game || null;
      dlc.value = d.dlc || null;
    } catch (e) {
      error.value = e?.message || String(e);
    } finally {
      loading.value = false;
    }
    checkClamp();
  },
);
</script>

<style scoped>
/* CW 批（docs/ADMIN-GAME-POPUP.md）：弹窗与 demo（docs/design/admin-game-popup-2026-11-18.html）对齐 */
.gdd-head{display:flex;align-items:center;gap:8px;width:100%}
.gdd-title{font-size:14px;margin:0;flex:1;color:var(--fg)}
.gdd-tag{font-size:11px;border:1px solid var(--border);background:var(--panel-2);border-radius:999px;padding:1px 9px;color:var(--fg-muted);line-height:1.7;flex:none}
.gdd-tag.ok{color:#fff;border-color:var(--success);background:var(--success)}
.gdd-tag.warn,.gdd-tag.mature{color:var(--warn);border-color:var(--warn);background:var(--warn-soft)}
.gdd-tag.danger{color:#fff;border-color:var(--danger);background:var(--danger)}
.gdd-x{flex:none;border:0;background:transparent;color:var(--fg-muted);font-size:15px;line-height:1;cursor:pointer;padding:2px 4px}
.gdd-x:hover{color:var(--fg)}
.gdd-loading{padding:26px 6px;text-align:center;color:var(--fg-muted);font-size:13px}
.gdd-body{padding:2px 4px 8px;max-height:min(62vh,520px);overflow-y:auto}
.gdd-hero{position:relative;height:150px;border-radius:10px;overflow:hidden;background:var(--panel-2)}
.gdd-hero img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.gdd-hero.ph{display:grid;place-items:center}
.gdd-ph-box{position:absolute;inset:0;border-radius:inherit}
.gdd-hero-fade{position:absolute;inset:0;background:linear-gradient(180deg,transparent 40%,var(--panel));pointer-events:none}
.gdd-hint{margin:10px 2px 0;font-size:11.5px;color:var(--warn)}
.gdd-title-row{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin:12px 0 2px}
.gdd-title-row h2{font-size:17px;margin:0}
.gdd-en{color:var(--fg-muted);font-size:12px}
.gdd-appid{font-size:12px;color:var(--fg-muted);margin-bottom:4px}
.gdd-appid .gdd-sep{margin:0 4px;color:var(--fg-subtle)}
.gdd-no-steam{color:var(--warn)}
.gdd-meta{display:grid;grid-template-columns:1fr 1fr;gap:7px 18px;margin:10px 0 12px;font-size:12.5px}
.gdd-meta div{display:flex;gap:8px;min-width:0}
.gdd-meta b{color:var(--fg-subtle);font-weight:600;min-width:56px;flex:none}
.gdd-meta span{min-width:0;overflow-wrap:anywhere}
.gdd-price{display:flex;gap:20px;align-items:baseline;background:var(--panel-2);border:1px solid var(--border);border-radius:10px;padding:9px 12px;margin-bottom:12px}
.gdd-price strong{font-size:16px;color:var(--success)}
.gdd-price s{color:var(--fg-subtle)}
.gdd-price .gdd-lbl{color:var(--fg-subtle);font-size:11.5px}
.gdd-desc{color:var(--fg-muted);font-size:12.5px;line-height:1.7;margin:0 0 6px;overflow-wrap:anywhere}
.gdd-desc.clamp{display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.gdd-more{display:inline-block;border:0;background:transparent;color:var(--brand-2);font-size:12px;cursor:pointer;padding:0;border-bottom:1px dashed var(--brand-2)}
.gdd-more:hover{color:var(--brand)}
.gdd-foot{display:flex;align-items:center;gap:10px;width:100%}
.gdd-note{color:var(--fg-subtle);font-size:11.5px;flex:1;min-width:0}
/* 移动端：弹窗 100% 宽、内容可滚动、底部按钮固定可见（规格 §4） */
@media(max-width:760px){
  .gdd-meta{grid-template-columns:1fr}
  .gdd-price{flex-wrap:wrap;gap:6px 20px}
  .gdd-foot{flex-wrap:wrap}
  .gdd-note{flex-basis:100%}
}
</style>

<style>
/* 弹窗本体宽度（非 scoped：el-dialog 渲染到 body） */
.game-detail-dialog{max-width:94vw;border-radius:14px}
@media(max-width:760px){
  .game-detail-dialog{width:100%!important;max-width:100%!important;margin:0!important}
}
</style>
