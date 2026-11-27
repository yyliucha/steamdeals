// FZ 批（docs/VISITORS-REDESIGN.md §2/§5）：访问记录页（七块）的共享状态与接口封装。
//
// 一个页面里七个块 + 一个跨块复用的 IP 详情抽屉，彼此要联动三件事：
//   ① 概览数字 / 左侧导航徽标：处置和解封后要同步（§7-6「计数同步」）——统一放这里，30 秒刷新也在这里；
//   ② IP 详情抽屉：任何列表点 IP 都打开同一个抽屉（§3-2），打开状态与数据在这里；
//   ③ 跨块跳转：抽屉「去异常处置（并定位该 IP）」/「去 IP 封禁」要换块并交接待定位的 IP。
//
// 状态放模块级（同一时刻只挂载一个访问记录页），组件卸载时由 shell 调 resetVisitorsUi() 清掉瞬态字段。
import { computed, reactive, ref } from 'vue';
import { redirectToLogin } from '../utils/session.js';

/** 七个块（左侧导航顺序＝规格 §2 顺序；id 与 URL `?view=` 一一对应）。 */
export const VISITOR_VIEWS = [
  { id: 'overview', icon: '📊', label: '概览', desc: '流量、异常与封禁的全貌；有积压会标红。' },
  { id: 'review', icon: '🚨', label: '异常处置', desc: '按 IP 合并的待审队列——封禁 / 信任 / 封设备的**唯一**处置入口。', badge: 'pending_reviews' },
  { id: 'analysis', icon: '📈', label: '访问分析', desc: '流量与路径分析（只读）；点 IP 看详情，处置请去「异常处置」。', badge: 'analysis' },
  { id: 'ban-ip', icon: '⛔', label: 'IP 封禁', desc: 'IP / CIDR 黑名单：解封与手动添加。', badge: 'blacklist' },
  { id: 'ban-device', icon: '🖥️', label: '设备封禁', desc: '按设备指纹生效的封禁：查看与解封。', badge: 'devices' },
  { id: 'ban-temp', icon: '⏳', label: '临时封禁', desc: '自动 / 人工临时封禁记录：只清临时封，不动黑名单。', badge: 'temp_bans' },
  { id: 'whitelist', icon: '✅', label: '白名单', desc: '不受黑名单与频率限制的地址：添加 / 移出。', badge: 'whitelist' },
];

export const VISITOR_VIEW_IDS = VISITOR_VIEWS.map((v) => v.id);

/** 后台统一 fetch（与 AdminModules / AlignAdmin 同口径：401 软跳登录、错误抛 Error）。 */
export function adminApi(path, options = {}) {
  return fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  }).then(async (r) => {
    const text = await r.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { /* 非 JSON 响应 */ }
    if (r.status === 401) {
      redirectToLogin();
      throw new Error(data.error || '登录已过期');
    }
    if (!r.ok) throw Object.assign(new Error(data.error || `HTTP ${r.status}`), { status: r.status });
    return data;
  });
}

/** 空概览（接口未返回前先用 0 占位，模板不用到处判空）。 */
const EMPTY_OVERVIEW = {
  today_requests: 0,
  today_blocked: 0,
  pending_reviews: 0,
  temp_bans: 0,
  blacklist: 0,
  whitelist: 0,
};

const state = reactive({
  /** 概览 6 个数字（/api/admin/visitors/overview）。 */
  overview: { ...EMPTY_OVERVIEW },
  overviewLoaded: false,
  overviewLoading: false,
  overviewError: '',
  /**
   * 本地待审增量：处置会让服务端 pending 立刻 -1；撤销只回滚封禁动作（移出黑/白名单），
   * 审核记录的「已处置」是审计事实、没有回滚接口（规格 §4 未新增），所以撤销后靠本地 +1
   * 让「待审数」与「行已回原位」一致。下次整页刷新回到服务端口径。
   */
  pendingDelta: 0,
  /** 左侧导航徽标里两个接口不直接给的数（访问分析 IP 数 / 设备封禁数），由对应页面加载后回填。 */
  nav: { analysis: 0, devices: 0 },
  /** IP 详情抽屉（跨块复用：任何列表点 IP 都填这里）。 */
  drawer: { visible: false, ip: '', seed: null },
  /** 需要定位的 IP（「去异常处置并定位」）：{ ip, seq }，review 页消费。 */
  focus: null,
  /** 跨块跳转请求：{ view, ip }，shell 消费后置空。 */
  navRequest: null,
});

let focusSeq = 0;

/** 移动端断点（≤760px，与后台其余列表一致）：shell 挂监听，各块共用一份，避免每个组件各挂一次。 */
const isMobile = ref(false);

export function useVisitorsAdmin() {
  /** 拉概览 6 个数字（一次查询）。失败保留上一次的值，只记错误文案。 */
  async function loadOverview() {
    state.overviewLoading = true;
    try {
      const d = await adminApi('/api/admin/visitors/overview');
      for (const key of Object.keys(EMPTY_OVERVIEW)) {
        state.overview[key] = Number(d?.[key]) || 0;
      }
      // 本地待审增量叠加（处置已 real -1、撤销本地 +1；整页刷新时 delta 归零）
      state.overview.pending_reviews = Math.max(0, (Number(d?.pending_reviews) || 0) + state.pendingDelta);
      state.overviewLoaded = true;
      state.overviewError = '';
    } catch (e) {
      state.overviewError = e?.message || String(e);
    } finally {
      state.overviewLoading = false;
    }
  }

  /**
   * 待审数增量（目前只有「撤销」用 +1）：同时改本地显示值与 delta，
   * 之后 loadOverview 用「服务端 + delta」重算。处置/批量不用它——服务端已立即生效，
   * 重复加 delta 会二次扣减。
   */
  function applyPendingDelta(n) {
    const delta = Number(n) || 0;
    if (!delta) return;
    state.pendingDelta += delta;
    state.overview.pending_reviews = Math.max(0, (Number(state.overview.pending_reviews) || 0) + delta);
  }

  /** 审核队列重新从服务端拉取时调用：本地还原的行已被服务端结果替换，撤销增量作废。 */
  function clearPendingDelta() {
    state.pendingDelta = 0;
  }

  /**
   * 处置 / 解封后的局部计数同步（不重新拉接口，避免闪一下再回来）：
   * bumpOverview({ pending_reviews: -1, blacklist: 1 })。数字最小 0，不会出现负数。
   */
  function bumpOverview(delta = {}) {
    for (const [key, value] of Object.entries(delta)) {
      if (!(key in EMPTY_OVERVIEW)) continue;
      state.overview[key] = Math.max(0, (Number(state.overview[key]) || 0) + Number(value || 0));
    }
  }

  /** 打开 IP 详情抽屉。seed = 列表里已有的行（地区/次数等），抽屉会再补齐后自动刷新。 */
  function openIpDetail(ip, seed = null) {
    if (!ip) return;
    state.drawer.ip = String(ip);
    state.drawer.seed = seed || null;
    state.drawer.visible = true;
  }

  function closeIpDetail() {
    state.drawer.visible = false;
    state.drawer.ip = '';
    state.drawer.seed = null;
  }

  /** 请求换块（可带要定位的 IP）；由 shell 转成 URL 变更。 */
  function requestView(view, ip = null) {
    if (!VISITOR_VIEW_IDS.includes(view)) return;
    state.navRequest = { view, ip: ip || null, seq: Date.now() + Math.random() };
  }

  /** 标记「进场后要定位这个 IP」（review 页 watch $state.focus）。 */
  function requestFocus(ip) {
    if (!ip) return;
    focusSeq += 1;
    state.focus = { ip: String(ip), seq: focusSeq };
  }

  function setNavCount(key, value) {
    if (!(key in state.nav)) return;
    state.nav[key] = Math.max(0, Number(value) || 0);
  }

  /** 组件挂载时清瞬态（抽屉/定位/跳转请求），保留概览缓存避免闪 0。 */
  function resetVisitorsUi() {
    state.drawer.visible = false;
    state.drawer.ip = '';
    state.drawer.seed = null;
    state.focus = null;
    state.navRequest = null;
    // 离开页面即回到服务端口径（撤销的本地 +1 只在本次停留内有效）
    state.pendingDelta = 0;
  }

  const pendingCount = computed(() => Number(state.overview.pending_reviews) || 0);

  return {
    state,
    isMobile,
    pendingCount,
    loadOverview,
    bumpOverview,
    applyPendingDelta,
    clearPendingDelta,
    openIpDetail,
    closeIpDetail,
    requestView,
    requestFocus,
    setNavCount,
    resetVisitorsUi,
  };
}
