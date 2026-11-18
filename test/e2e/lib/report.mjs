// 报告（CK 批，docs/E2E-SUITE.md §1 #7、§6.4）：HTML → Edge --print-to-pdf → F:\dsh\e2e-reports\<日期>-<短哈希>.pdf。
// 内容：环境与版本 / 矩阵逐行结果 / 失败截图与 Console / skip 原因 / 耗时 / 真实测试清单状态。
// 报告与截图一律在仓库外（F:\dsh\e2e-reports\），禁止 git add。
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { edgePrintHtmlToPdf } from './browser.mjs';

const esc = (s) =>
  String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const STATUS_BADGE = {
  pass: '<span class="badge pass">通过</span>',
  fail: '<span class="badge fail">失败</span>',
  skip: '<span class="badge skip">跳过</span>',
  truncated: '<span class="badge trunc">预算截断</span>',
};

function maskSecrets(text) {
  // 报告里绝不出现邮箱密码等凭据（§7）
  return String(text ?? '')
    .replace(/E2E_MAIL_PASS\s*=\s*\S+/gi, 'E2E_MAIL_PASS=***')
    .replace(/E2eAdmin#\S+/g, '***');
}

export function renderHtml(run) {
  const rows = run.rows
    .map((r) => {
      const shots = (r.artifacts ?? [])
        .filter((a) => /\.png$/.test(a))
        .map((a) => {
          const rel = relative(run.reportDir, a).replaceAll('\\', '/');
          return `<div class="shot"><a href="${rel}" target="_blank"><img src="${rel}" /></a><div>${esc(rel)}</div></div>`;
        })
        .join('');
      const consoleErr = r.consoleErrors?.length
        ? `<div class="cons">Console：<ul>${r.consoleErrors.map((c) => `<li>${esc(maskSecrets(c))}</li>`).join('')}</ul></div>`
        : '';
      return `<tr class="row-${r.status}">
        <td class="rid">${esc(r.id)}</td>
        <td>${esc(r.name)}${r.tag?.includes('smoke') ? ' <span class="tag-smoke">smoke</span>' : ''}</td>
        <td>${STATUS_BADGE[r.status] ?? esc(r.status)}</td>
        <td class="sec">${r.durationMs != null ? `${(r.durationMs / 1000).toFixed(1)}s` : '—'}</td>
        <td>${esc(r.expect ?? '')}</td>
        <td class="detail">${r.status === 'skip' || r.status === 'truncated' ? `原因：${esc(r.skipReason ?? '')}` : esc(maskSecrets(r.error ?? r.summary ?? ''))}${consoleErr}${shots}</td>
      </tr>`;
    })
    .join('');

  const checks = (run.extraSections ?? [])
    .map((s) => `<h3>${esc(s.title)}</h3><table class="checks"><tbody>${(s.checks ?? [])
      .map((c) => `<tr><td>${esc(c.name)}</td><td>${c.ok ? '<span class="badge pass">✓</span>' : '<span class="badge fail">✗</span>'}</td><td>${esc(c.detail ?? '')}</td></tr>`)
      .join('')}</tbody></table>`)
    .join('');

  // 预算截断警示（DJ 批）：轮次不完整，报告中必须显眼、不允许按"全绿"上报。
  const budgetNote = run.budgetExceeded
    ? `<p style="color:#b45309;font-weight:600">⚠️ 整轮预算耗尽：剩余 ${run.truncated} 行未执行（标「预算截断」），
    本轮 e2e 不完整——不得按"全绿"上报；修复问题或延长预算（E2E_BUDGET_MS / --budget-ms=）后重跑全量。</p>`
    : '';

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>e2e 报告 ${esc(run.label)}</title>
<style>
body{font-family:'Segoe UI','Microsoft YaHei',sans-serif;margin:24px;color:#1f2430;font-size:12px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:18px 0 8px}h3{font-size:13px;margin:12px 0 6px}
.meta{display:grid;grid-template-columns:repeat(4,1fr);gap:6px 18px;background:#f4f6fa;border:1px solid #e3e8f1;border-radius:8px;padding:10px 14px}
.meta b{color:#475}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid #dde3ee;padding:5px 8px;text-align:left;vertical-align:top}
th{background:#eef2f9;position:sticky;top:0}
.rid{font-family:Consolas,monospace;white-space:nowrap}
.sec{white-space:nowrap}
.badge{display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;font-weight:600;color:#fff}
.badge.pass{background:#16a34a}.badge.fail{background:#dc2626}.badge.skip{background:#9aa4b2}.badge.trunc{background:#d97706}
.row-fail{background:#fef2f2}.row-skip{background:#fafafa;color:#777}.row-truncated{background:#fffbeb}
.tag-smoke{font-size:10px;color:#7c5cff;border:1px solid #c9bfff;border-radius:8px;padding:0 5px}
.cons{background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;padding:4px 8px;margin-top:4px}
.cons ul{margin:2px 0 2px 16px}
.shot{display:inline-block;margin:6px 8px 0 0;vertical-align:top}
.shot img{max-width:220px;max-height:300px;border:1px solid #dde3ee;border-radius:4px;display:block}
.shot div{font-size:10px;color:#888;max-width:220px;word-break:break-all}
.detail{color:#555}
.summary{display:flex;gap:14px;font-size:13px}
.summary b{font-size:16px}
.checks{max-width:760px}
@media print{ .shot img{max-height:180px} }
</style></head><body>
<h1>SteamDeals e2e 测试报告</h1>
<div class="meta">
  <div><b>运行标签</b><br>${esc(run.label)}</div>
  <div><b>日期</b><br>${esc(run.startedAt)}</div>
  <div><b>提交</b><br>${esc(run.gitHash)}</div>
  <div><b>设备模式</b><br>${esc(run.deviceMode)}</div>
  <div><b>Node / Edge</b><br>${esc(run.nodeVersion)} / ${esc(run.edgePath ?? '—')}</div>
  <div><b>总耗时</b><br>${(run.elapsedMs / 1000).toFixed(1)}s</div>
  <div><b>通过 / 失败 / 跳过</b><br>${run.passed} / ${run.failed} / ${run.skipped}</div>
  <div><b>预算截断</b><br>${run.truncated ?? 0}${run.budgetMs > 0 ? `（预算 ${(run.budgetMs / 1000).toFixed(0)}s）` : ''}</div>
  <div><b>矩阵行数</b><br>${run.rows.length}</div>
</div>
<h2>矩阵逐行结果</h2>
<table><thead><tr><th>ID</th><th>功能</th><th>结果</th><th>耗时</th><th>预期</th><th>断言明细 / 失败截图</th></tr></thead>
<tbody>${rows}</tbody></table>
${checks}
${budgetNote}
<h2>真实测试清单状态</h2>
<p>本报告覆盖 R1（本地全栈 + headless Edge + Android 模拟器/真机 + 公网只读）。R2（所有者目视：真机微信/邮箱客户端/字体触控）与
R3（部署）清单见 docs/DELIVERY.md「部署后验证」表；本套件不代替 R2/R3，只提供 R1 自动证据。</p>
<p style="color:#888">生成自 test/e2e/runner.mjs · 报告目录 F:\\dsh\\e2e-reports\\（仓库外，不入库）</p>
</body></html>`;
}

/**
 * 写 HTML + 生成 PDF。PDF 路径：F:\dsh\e2e-reports\<YYYY-MM-DD>-<短哈希>.pdf。
 */
/**
 * 写 HTML 报告（PDF 由 runner 用现有 Edge CDP 打印，避免再起一个 Edge 进程）。
 */
export function writeHtml(run) {
  const htmlPath = join(run.reportDir, 'report.html');
  writeFileSync(htmlPath, renderHtml(run), 'utf8');
  return htmlPath;
}

/** PDF 路径：F:\dsh\e2e-reports\<YYYY-MM-DD>-<短哈希>.pdf（仓库外，不入库）。 */
export function pdfTargetPath(run) {
  return join(run.reportRoot, `${run.startedAt.slice(0, 10)}-${run.gitHash}.pdf`);
}

/**
 * 兜底打印：独立 Edge 进程 --print-to-pdf（runner 首选 CDP 打印，失败才用它）。
 */
export function edgePrintHtmlToPdfPath(htmlPath, pdfPath) {
  mkdirSync(dirname(pdfPath), { recursive: true });
  edgePrintHtmlToPdf(htmlPath, pdfPath);
  return pdfPath;
}
