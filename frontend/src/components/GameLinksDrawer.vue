<script setup>
// AO 批（docs/ADMIN-LINKS-DRAWER.md §4）：平台链接抽屉——头部/渠道卡片/空态/移动端。
// 只读展示 + 复制 + 跳转；纯前端，数据由父组件传 `links`（GET /api/admin/games/:id/links）。
import { computed } from 'vue';
import { ElMessage } from 'element-plus';
import { copyText } from '../utils/clipboard.js';
import { nameCopyText } from '../utils/gameNames.js';
import { pickLowestLink } from '../utils/linkPrices.js';
import { fmtDateTime } from '../utils/siteTime.js';

const props = defineProps({
  visible: { type: Boolean, default: false },
  game: { type: Object, default: null },
  links: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
});
const emit = defineEmits(['update:visible', 'copied']);

const REGION_LABELS = { cn: '国区', hk: '港区', tw: '台区', us: '美区', jp: '日区', gb: '英区', de: '德区', fr: '法区' };
const CURRENCY_SYMBOL = { CNY: '¥', USD: '$', HKD: 'HK$', TWD: 'NT$', EUR: '€', GBP: '£', JPY: 'JP¥' };
const PLATFORM_DOT = { steam: 'steam', gog: 'gog', sonkwo: 'sonkwo', humble: 'humble', itad: 'itad' };

function regionLabel(code) {
  const c = String(code ?? '').toLowerCase();
  return REGION_LABELS[c] || String(code || '');
}
function money(cents, currency) {
  if (cents == null) return '—';
  const symbol = CURRENCY_SYMBOL[String(currency ?? '').toUpperCase()] || (String(currency ?? '') ? String(currency) : '');
  return `${symbol}${(Number(cents) / 100).toFixed(2)}`;
}
function relDay(value) {
  if (!value) return '';
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return '';
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  return `${days} 天前`;
}

const sortedLinks = computed(() => {
  const list = [...props.links];
  const rank = (l) => (String(l.region ?? '').toLowerCase() === 'cn' ? 0 : 1);
  return list.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if ((a.price_cents ?? 0) !== (b.price_cents ?? 0)) return (a.price_cents ?? 0) - (b.price_cents ?? 0);
    return String(a.platform_name ?? '').localeCompare(String(b.platform_name ?? ''));
  });
});
// BD 批（docs/ADMIN-LINKS-DRAWER.md §12）：最低价醒目——同币种内比、缺货不参与、全部同价不标。
const lowestLink = computed(() => pickLowestLink(sortedLinks.value));

async function doCopy(text, tip) {
  const ok = await copyText(text);
  ok ? ElMessage.success(tip) : ElMessage.warning('复制失败，请手动选择');
  return ok;
}
async function copyNames() {
  const ok = await doCopy(nameCopyText(props.game), '已复制中英文名');
  if (ok) emit('copied');
}
async function copyAppid() {
  await doCopy(String(props.game?.steam_appid ?? ''), '已复制 AppID');
}
function close() {
  emit('update:visible', false);
}
</script>

<template>
  <el-drawer
    :model-value="visible"
    :size="'560px'"
    :with-header="false"
    direction="rtl"
    class="links-drawer"
    @update:model-value="(v) => emit('update:visible', v)"
    @close="close"
  >
    <div v-if="game" class="ld-wrap">
      <div class="ld-head">
        <img v-if="game.steam_appid" class="ld-cover" :src="`/img/steam/${game.steam_appid}/capsule_sm_120`" alt="封面" @error="$event.target.style.display='none'" />
        <div class="ld-title">
          <h3 :title="game.name">{{ game.name }}</h3>
          <div class="ld-en" :title="game.name_en">{{ game.name_en }}</div>
          <div class="ld-tools">
            <button class="ld-chip" @click="copyNames">⧉ 复制中英文名</button>
            <button v-if="game.steam_appid" class="ld-chip" @click="copyAppid">⧉ AppID {{ game.steam_appid }}</button>
          </div>
        </div>
        <button class="ld-close" aria-label="关闭" @click="close">×</button>
      </div>
      <div class="ld-body" v-loading="loading">
        <template v-if="sortedLinks.length">
          <div class="ld-sec"><h4>可跳转的购买渠道</h4><span>{{ sortedLinks.length }} 个链接</span></div>
          <div v-for="l in sortedLinks" :key="`${l.platform_code}|${l.region}|${l.buy_url}`" class="ld-card" :class="{ out: !l.in_stock, low: l === lowestLink }">
            <div class="ld-card-main">
              <div class="ld-top">
                <span class="ld-plat"><span class="dot" :class="PLATFORM_DOT[l.platform_code] || 'other'"></span>{{ l.platform_name || l.platform_code }}</span>
                <span v-if="l === lowestLink" class="ld-badge">最低价</span>
                <span class="ld-region">{{ regionLabel(l.region) }}</span>
              </div>
              <div class="ld-price">
                <strong>{{ money(l.price_cents, l.currency) }}</strong>
                <del v-if="l.original_cents && l.original_cents > l.price_cents">{{ money(l.original_cents, l.currency) }}</del>
                <span v-if="l.discount_pct" class="ld-disc">-{{ l.discount_pct }}%</span>
              </div>
              <div class="ld-meta">
                最后更新：{{ relDay(l.last_seen_at) }} {{ fmtDateTime(l.last_seen_at) }} · {{ l.in_stock ? '有货' : '缺货' }}
              </div>
            </div>
            <a :href="l.buy_url" target="_blank" rel="noopener noreferrer"><button class="ld-open">打开 ↗</button></a>
          </div>
        </template>
        <div v-else class="ld-empty">
          <strong>这个游戏还没有可跳转的购买链接</strong>
          <a v-if="game.steam_appid" :href="`https://store.steampowered.com/app/${game.steam_appid}/`" target="_blank" rel="noopener noreferrer">
            <button class="ld-open">在 Steam 打开 ↗</button>
          </a>
        </div>
      </div>
      <div class="ld-foot">价格与库存以平台页面为准 · 链接由采集任务维护</div>
    </div>
  </el-drawer>
</template>

<style scoped>
.links-drawer :deep(.el-drawer__body){padding:0;display:flex}
.ld-wrap{flex:1;display:flex;flex-direction:column;min-height:0}
.ld-head{display:flex;gap:14px;align-items:center;padding:18px 20px 14px;border-bottom:1px solid var(--border);position:relative}
.ld-cover{width:56px;height:56px;border-radius:12px;object-fit:cover;flex:0 0 auto;background:var(--panel-2)}
.ld-title{min-width:0;flex:1}
.ld-title h3{margin:0;font-size:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--fg)}
.ld-en{color:var(--fg-muted);font-size:12px;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ld-tools{display:flex;gap:8px;margin-top:9px;flex-wrap:wrap}
.ld-chip{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:7px;border:1px solid var(--border);background:var(--panel-2);color:var(--fg-2);font-size:12px;cursor:pointer}
.ld-chip:hover{border-color:var(--brand);color:var(--fg)}
.ld-close{position:absolute;top:12px;right:14px;width:28px;height:28px;border:0;border-radius:7px;background:transparent;color:var(--fg-muted);font-size:20px;cursor:pointer}
.ld-close:hover{background:var(--panel-2);color:var(--fg)}
.ld-body{flex:1;overflow:auto;padding:16px 20px}
.ld-sec{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.ld-sec h4{margin:0;font-size:13px;color:var(--fg-2)}
.ld-sec span{color:var(--fg-muted);font-size:12px}
.ld-card{display:flex;align-items:center;gap:12px;padding:13px 14px;border:1px solid var(--border);border-radius:12px;background:var(--panel-2);margin-bottom:10px}
.ld-card.out{opacity:.55}
/* BD 批（docs/ADMIN-LINKS-DRAWER.md §12）：最低价整卡高亮 + 角标 */
.ld-card.low{border-color:var(--success);background:linear-gradient(180deg,rgba(52,195,155,.13),var(--panel-2) 70%);box-shadow:0 0 0 1px rgba(52,195,155,.22),0 8px 24px rgba(52,195,155,.10)}
.ld-card.low .ld-price strong{color:var(--success);font-size:21px}
.ld-badge{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 8px;border-radius:6px;background:var(--success);color:#06231b;font-size:11px;font-weight:800;letter-spacing:.02em}
.ld-badge::before{content:'★';font-size:10px}
.ld-card-main{flex:1;min-width:0}
.ld-top{display:flex;align-items:center;gap:8px}
.ld-plat{display:inline-flex;align-items:center;gap:7px;font-weight:700;font-size:13px;color:var(--fg)}
.dot{width:8px;height:8px;border-radius:50%}
.dot.steam{background:#66c0f4}.dot.gog{background:#a06bff}.dot.sonkwo{background:#ff8a5c}.dot.humble{background:#f0717e}.dot.itad{background:#38d9f0}.dot.other{background:var(--fg-muted)}
.ld-region{font-size:11px;color:var(--fg-muted);border:1px solid var(--border);border-radius:5px;padding:0 6px}
.ld-price{display:flex;align-items:baseline;gap:8px;margin-top:5px}
.ld-price strong{font-size:18px;letter-spacing:-.02em;color:var(--brand-2)}
.ld-price del{color:var(--fg-muted);font-size:11.5px}
.ld-disc{font-size:10.5px;color:#ffd7db;background:rgba(240,113,126,.16);border:1px solid rgba(240,113,126,.35);border-radius:5px;padding:0 6px}
.ld-meta{color:var(--fg-muted);font-size:11.5px;margin-top:5px}
.ld-open{height:34px;padding:0 14px;border-radius:8px;border:1px solid var(--brand);background:rgba(139,130,245,.14);color:#c9c4ff;font-size:12.5px;font-weight:600;cursor:pointer}
.ld-open:hover{background:rgba(139,130,245,.26);color:#fff}
.ld-empty{padding:26px 16px;border:1px dashed var(--border);border-radius:12px;text-align:center;color:var(--fg-muted)}
.ld-empty strong{display:block;color:var(--fg-2);font-size:13px;margin-bottom:12px}
.ld-foot{padding:13px 20px 16px;border-top:1px solid var(--border);color:var(--fg-muted);font-size:11.5px}
@media(max-width:760px){.ld-head{padding:14px 14px 12px}.ld-body{padding:12px 14px}}
</style>
