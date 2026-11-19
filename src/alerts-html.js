// CI-1（docs/ALERT-MAIL-APPEAL-UX.md §3）：价格提醒邮件 HTML 化——
// 复用 CB 批每日报表的品牌风格（600px 内联 CSS + table 布局），每条提醒一张卡片；
// 所有动态字段 HTML 转义、无外部资源；webhook/企微仍用纯文本（调用方只多传 html）。
import { formatDayUtc, yuanAmount } from './format.js';

const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const money = (cents) => (cents == null ? null : `¥${yuanAmount(cents)}`);

const REASON_LABEL = { target: '达到目标价', hist_low: '新史低', wishlist: '愿望单', manual: '手动推送' };

export function renderAlertsHtml(hits, { now = new Date(), siteUrl = 'https://sd.yyliucha.cn' } = {}) {
  const dateStr = formatDayUtc(now);
  const cards = (hits ?? []).map((h) => {
    const url = h.steamAppid ? `https://store.steampowered.com/app/${h.steamAppid}/` : null;
    const rows = [
      `<span style="color:#8b82f5;font-size:11px;font-weight:700">${esc(REASON_LABEL[h.reason] ?? h.reason ?? '到价')}</span>`,
      `<strong style="font-size:15px;color:#0f172a">${money(h.currentCents) ?? '—'}</strong>`,
      h.targetCents != null ? `<span style="color:#64748b;font-size:12px">目标 ${money(h.targetCents)}</span>` : '',
      h.histLowCents != null ? `<span style="color:#64748b;font-size:12px">史低 ${money(h.histLowCents)}</span>` : '',
      url ? `<a href="${esc(url)}" style="color:#8b82f5;text-decoration:none;font-size:12px">Steam 商店 ↗</a>` : '',
    ].filter(Boolean).join(' &nbsp; ');
    return `
  <tr><td style="border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;background:#f8fafc">
    <div style="font-size:14px;font-weight:650;color:#0f172a;margin-bottom:6px">${esc(h.name)}</div>
    <div>${rows}</div>
  </td></tr>`;
  }).join('');

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#eef1f7;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f7;padding:18px 8px"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0">
  <tr><td style="background:linear-gradient(120deg,#7c74f0,#8b82f5);padding:18px 22px">
    <div style="color:#ffffff;font-size:18px;font-weight:800">SteamDeals</div>
    <div style="color:#dcd8ff;font-size:12px;margin-top:3px">价格提醒 · ${esc(dateStr)} · 共 ${hits?.length ?? 0} 条</div>
  </td></tr>
  <tr><td style="padding:16px 18px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-spacing:0 10px">${cards}</table>
    <p style="color:#94a3b8;font-size:11px;margin:6px 0 0">价格以商店结算页为准；点击卡片内链接前往 Steam 商店。</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

  const text = (hits ?? []).map((h) =>
    [`${h.name}  ${money(h.currentCents)}`, h.targetCents != null ? `目标 ${money(h.targetCents)}` : null, h.histLowCents != null ? `史低 ${money(h.histLowCents)}` : null, h.steamAppid ? `https://store.steampowered.com/app/${h.steamAppid}/` : null].filter(Boolean).join(' · '),
  ).join('\n');

  return { subject: `游戏价格提醒：${hits?.length ?? 0} 款到价`, html, text };
}
