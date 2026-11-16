// CB 批（docs/PRICE-REPORT-EMAIL.md §3.1）：价格报表邮件 HTML 渲染。
// 纯函数、零依赖：内联 CSS + table 布局、600px 居中、无外部图片/CSS/字体、无 flex/grid；
// 动态字段（游戏名/平台名/日期）全部 HTML 转义；金额整数分 → ¥x.xx；折扣取整；
// 链接全部由代码构造（站内首页/站内搜索/Steam 商店），不从数据取 URL。
import { esc, fmtYuan } from './report.js';

const BAR_MAX_PX = 110; // 迷你柱状条最大宽度（px）
const CELL = 'padding:7px 10px;border-bottom:1px solid #e8ebf1;font-size:13px;line-height:1.6;color:#202a3d';
const MUTED = 'color:#8791a3;font-size:12px';

/** 站内搜索链接（encodeURIComponent 防注入） */
const searchUrl = (siteUrl, name) => `${siteUrl}/?q=${encodeURIComponent(String(name ?? ''))}`;
/** Steam 商店链接：有 appid 才出 */
const steamUrl = (appid) => `https://store.steampowered.com/app/${encodeURIComponent(String(appid))}/`;
const pctOf = (r) => (Number(r.was) > 0 ? Math.round((Math.abs(Number(r.drop_cents)) / Number(r.was)) * 100) : 0);
const dayShort = (day) => String(day ?? '').slice(5); // MM-DD

/**
 * 渲染价格报表邮件。
 * @returns {{subject:string, html:string, text:string}} text 为纯文本 fallback（口径与 CLI 输出一致，
 *   同时供 webhook / 企业微信使用）。
 */
export function renderPriceReport({ report, daily = [], siteUrl = 'https://sd.yyliucha.cn', siteName = 'SteamDeals', now = new Date() }) {
  const drops = Number(report?.drops ?? 0);
  const rises = Number(report?.rises ?? 0);
  const newLows = Number(report?.newLows ?? 0);
  const changed = Number(report?.changed ?? 0);
  const hours = report?.hours == null ? 24 : Number(report.hours);
  const topDrops = (report?.topDrops ?? []).slice(0, 5);
  const topRises = (report?.topRises ?? []).slice(0, 3);

  const pad2 = (n) => String(n).padStart(2, '0');
  const dateLabel = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const subject = `${siteName} 价格报表 · ${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} | 降价 ${drops} / 新史低 ${newLows}`;

  // ---- 纯文本（保持原口径，multipart fallback 与 webhook/企微共用）----
  const fmt = (x) => fmtYuan(x);
  const lines = [
    `${siteName} 价格报表（近 ${hours} 小时）`,
    `降价 ${drops} 条 / 涨价 ${rises} 条 / 新史低 ${newLows} 条`,
  ];
  for (const d of topDrops) {
    lines.push(`↓ ${fmt(d.was)} → ${fmt(d.now_price)}（-${pctOf(d)}%）${d.name} · ${d.platform_name}`);
  }
  for (const r of topRises) {
    lines.push(`↑ ${fmt(r.was)} → ${fmt(r.now_price)}  ${r.name} · ${r.platform_name}`);
  }
  if (daily.length) lines.push(`近 7 天：${daily.map((d) => `${d.day} 降${d.drops}/涨${d.rises}`).join('；')}`);
  const text = lines.join('\n');

  // ---- 近 7 天迷你柱状条（table + inline 背景色，不依赖图片）----
  const barMax = Math.max(1, ...daily.map((d) => Math.max(Number(d.drops ?? 0), Number(d.rises ?? 0))));
  const barCell = (value, color) => {
    const w = Math.max(3, Math.round((Number(value) / barMax) * BAR_MAX_PX));
    return `<span style="display:inline-block;width:${w}px;height:10px;background:${color};border-radius:3px;vertical-align:middle"></span>`;
  };
  const dailyRows = daily
    .map(
      (d) => `<tr>
        <td style="${CELL}">${esc(dayShort(d.day))}</td>
        <td style="${CELL}">${barCell(d.drops, '#13876f')}&nbsp;<span style="${MUTED}">降 ${esc(d.drops)}</span></td>
        <td style="${CELL}">${barCell(d.rises, '#d9485f')}&nbsp;<span style="${MUTED}">涨 ${esc(d.rises)}</span></td>
        <td style="${CELL}">共 ${esc(d.changed)}</td>
      </tr>`,
    )
    .join('');

  const dropRows = topDrops
    .map((d) => {
      const steam = d.steam_appid ? ` <a href="${steamUrl(d.steam_appid)}" style="color:#635bdf;text-decoration:none">Steam ↗</a>` : '';
      return `<tr>
        <td style="${CELL}">
          <a href="${searchUrl(siteUrl, d.name)}" style="color:#202a3d;text-decoration:none;font-weight:600">${esc(d.name)}</a><br>
          <span style="${MUTED}">${esc(d.platform_name)}</span>
        </td>
        <td style="${CELL};white-space:nowrap"><span style="color:#8791a3;text-decoration:line-through">${fmtYuan(d.was)}</span> → <strong>${fmtYuan(d.now_price)}</strong></td>
        <td style="${CELL}"><span style="display:inline-block;padding:2px 8px;border-radius:999px;background:#13876f;color:#ffffff;font-size:12px">-${pctOf(d)}%</span>${steam}</td>
      </tr>`;
    })
    .join('');

  const riseRows = topRises
    .map(
      (r) => `<tr>
        <td style="${CELL}"><a href="${searchUrl(siteUrl, r.name)}" style="color:#202a3d;text-decoration:none">${esc(r.name)}</a><br><span style="${MUTED}">${esc(r.platform_name)}</span></td>
        <td style="${CELL};white-space:nowrap"><span style="color:#8791a3">${fmtYuan(r.was)}</span> → <span style="color:#d9485f">${fmtYuan(r.now_price)}</span></td>
      </tr>`,
    )
    .join('');

  const kpi = (value, label, color) => `
    <td style="padding:12px 8px;text-align:center;border-right:1px solid #e8ebf1">
      <div style="font-size:26px;font-weight:800;color:${color}">${esc(value)}</div>
      <div style="${MUTED}">${label}</div>
    </td>`;

  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fb"><tr><td align="center" style="padding:16px 8px">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border:1px solid #e8ebf1;border-radius:12px;overflow:hidden">
      <tr><td style="padding:18px 22px;background:linear-gradient(135deg,#635bdf,#22d3ee)">
        <span style="font-size:17px;font-weight:800;color:#ffffff">${esc(siteName)}</span>
        <span style="float:right;color:rgba(255,255,255,.92);font-size:13px">价格报表 · ${esc(dateLabel)} · 近 ${esc(hours)} 小时</span>
      </td></tr>
      <tr><td style="padding:0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid #e8ebf1">
          <tr>${kpi(drops, '降价', '#13876f')}${kpi(rises, '涨价', '#d9485f')}${kpi(newLows, '新史低', '#d97706')}</tr>
        </table>
      </td></tr>
      <tr><td style="padding:6px 22px">
        <h3 style="font-size:14px;color:#202a3d;margin:12px 0 2px">今日降价 Top ${topDrops.length}</h3>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${dropRows || `<tr><td style="${CELL}">暂无降价</td></tr>`}</table>
        <h3 style="font-size:14px;color:#202a3d;margin:14px 0 2px">涨价提醒 Top ${topRises.length}</h3>
        <p style="${MUTED};margin:0 0 4px">关注中的游戏可能变贵（共 ${esc(changed)} 条变动）</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${riseRows || `<tr><td style="${CELL}">暂无涨价</td></tr>`}</table>
        ${daily.length ? `<h3 style="font-size:14px;color:#202a3d;margin:14px 0 2px">近 7 天趋势</h3>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="${CELL};font-weight:600">日期</td><td style="${CELL};font-weight:600">降价</td><td style="${CELL};font-weight:600">涨价</td><td style="${CELL};font-weight:600">合计</td></tr>
          ${dailyRows}
        </table>` : ''}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:18px 0 6px">
          <a href="${siteUrl}/" style="display:inline-block;padding:10px 26px;border-radius:9px;background:#635bdf;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600">打开 ${esc(siteName)}</a>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding:14px 22px;background:#f5f7fb;border-top:1px solid #e8ebf1;${MUTED}">
        本邮件由 ${esc(siteName)} 自动发送 · 价格报表每天推送一次，收件人与频率可在后台「邮件服务 / 系统设置」调整。<br>
        <a href="${siteUrl}/" style="color:#635bdf;text-decoration:none">${esc(siteUrl)}</a>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  return { subject, html, text };
}
