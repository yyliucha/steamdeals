// CO-5/B4-2 第十轮（docs/DESIGN-AUDIT.md B4）：admin-settings 域路由模块——从 src/server.js
// 巨石抽出的第十个域（B4 队列 #10：后台系统设置 smtp/mail/emails/proxies/version）。
//
// 域边界（外部契约零变化，路径/参数/响应/错误码与拆分前完全一致）：
//   · GET  /api/admin/version                    版本与更新检查（UPDATE_CHECK=0 时只报当前版本，不出网）
//   · GET  /api/admin/smtp                       SMTP 配置视图（密码只回 hasPassword）
//   · POST /api/admin/smtp                       SMTP 配置保存（密码留空保持原值；保存后热加载限流阈值）
//   · POST /api/admin/smtp/test                  发测试邮件（收件人留空时发给发件人自己）
//   · GET  /api/admin/emails                     验证码/测试邮件发送记录列表
//   · GET  /api/admin/mail/templates             邮件模板列表（9 事件 + 3 套示例版式 + 变量表）
//   · POST /api/admin/mail/templates/:event/(reset|preview|test)  恢复默认 / 渲染预览 / 发测试信
//   · PUT  /api/admin/mail/templates/:event      模板保存（校验 + 主题去 CR/LF + 未知变量只警告）
//   · GET  /api/admin/mail/log                   通知类邮件发送记录（倒序）
//   · GET  /api/admin/proxies                    代理池健康状态（地址一律脱敏）
//   · POST /api/admin/proxies/probe              立即检测（CONNECT 逐条探测并写健康文件）
//
// 单入口（位置语义，见 docs/ARCHITECTURE.md「域路由拆分模式」§15.3）：
//   · handleAdminSettingsAdmin(ctx)：requireAdmin 就绪后的管理段——本域全部 11 条路由
//     （管理段形态先例=申诉域 handleAppealAdmin / admin-access 域 handleAdminAccessAdmin /
//     admin-sync 域 handleAdminSyncAdmin）。
//   返回值约定：true = 已处理并结束响应；false = 未命中本域，宿主继续。凡写过响应的分支
//   必须返回 true（json(...) 自身返回 undefined，直接 return json(...) 会让宿主误判未命中
//   继续跑完整条链 → 二次写头 ERR_HTTP_HEADERS_SENT）。
//
// 留在 server.js 的中间件与未拆段（不属于本域）：
//   · appealEmail 宿主闭包（appealEmailFrom(process.env) 派生）——经 ctx 按引用传入
//     （语义共享：与申诉/公告等域共用宿主同一份 env 派生值）；
//   · store（createApiServer 参数，真实 pg store 实例）——经 ctx 按引用传入
//     （语义共享：POST /api/admin/smtp 保存后 settings.hydrateSettings({ store, logger })
//     必须写宿主同一个库并热加载限流阈值，不能另开实例）；
//   · invalidateSiteCache 宿主闭包——SMTP 保存后失效 /api/site 短缓存（DX 批，
//     docs/SEARCH-FIX-PERF.md §DX），与 settings-routes afterHydrate 共用同一份缓存；
//   · /api/admin/settings*（settings-routes.js 独立模块）与 /api/admin/users 邮件绑定
//     等其它 admin 域路由（B4 #11/#12）留宿主不动；
//   · 跨域共用 SQL（insertMailLog 等）留 pg.js（见 admin-settings-repository.js 头部归属判定）。
//
// 域内状态：mailTestCooldown（同一管理员 10 秒最多 1 封测试邮件，docs/USER-LIFECYCLE.md
// §7.5）只被本域使用，随域移入模块级（先例：watchlist 域 watchUserFails、site 域 banState）。
import * as db from '../store/pg.js';
import * as settings from '../settings.js';
import * as ratelimit from '../ratelimit.js';
import * as appRateLimit from '../app-ratelimit.js';
import * as mailTemplates from '../mail-templates.js';
import * as notify from '../notify.js';
import * as proxyPool from '../proxy-pool.js';
import { versionInfo } from '../version.js';
import { VERSION } from '../settings.js';
import { maskEmail } from '../auth-routes.js';

// 测试邮件限流：同一管理员 10 秒 1 次（docs/USER-LIFECYCLE.md §7.5）
const mailTestCooldown = new Map();

/**
 * 管理段：server.js 在 requireAdmin 就绪之后调用——后台系统设置全部路由。
 * 每条分支自己 requireAdmin()（401/403 文案由宿主守卫统一输出，契约不变）。
 * ctx 域特有字段（§15.2，按引用传入、语义共享，勿改成拷贝）：
 *   · ctx.appealEmail   宿主闭包——模板联系人邮箱（appealEmailFrom(process.env) 派生）；
 *   · ctx.store         宿主 pg store 实例——SMTP 保存后 hydrateSettings 写同一库；
 *   · ctx.invalidateSiteCache 宿主闭包——SMTP 保存后失效 /api/site 短缓存。
 */
export async function handleAdminSettingsAdmin(ctx) {
  const { path, req, res, url, q, logger, json, readBody, user, requireAdmin, store, appealEmail, invalidateSiteCache } = ctx;

  // ---- 管理员：版本与更新检查 ----
  if (path === '/api/admin/version' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    const force = url.searchParams.get('force') === '1';
    const repo = process.env.UPDATE_REPO || undefined;
    // UPDATE_CHECK=0 时只报当前版本，不出网
    if (process.env.UPDATE_CHECK === '0') {
      json(res, 200, {
        current: VERSION,
        latest: null,
        updateAvailable: false,
        url: null,
        checkedAt: new Date().toISOString(),
        error: null,
        repo: repo ?? null,
        source: null,
        region: null,
      });
      return true;
    }
    json(res, 200, await versionInfo({ current: VERSION, repo, logger, force }));
    return true;
  }

  // ---- 管理员：邮箱（SMTP）配置与验证码发送记录 ----
  if (path === '/api/admin/smtp' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    const auth = await import('../email-auth.js');
    const cfg = await auth.smtpConfig(q);
    // 拆分前这里还有一条读取 smtp_settings 表 from_addr 的查询，但结果变量从未进入
    // 响应（cfg.from 已含「发件人留空回退账号」兜底）——属死代码，随域搬家时删除，
    // 响应体与拆分前完全一致。
    json(res, 200, {
      smtp: {
        source: cfg.source,
        host: cfg.host ?? '',
        port: cfg.port ?? 465,
        secure: cfg.secure !== false,
        user: cfg.user ?? '',
        from: cfg.from ?? '',
        hasPassword: Boolean(cfg.pass),
        ready: auth.isSmtpConfigured(cfg),
      },
    });
    return true;
  }

  if (path === '/api/admin/smtp' && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const auth = await import('../email-auth.js');
    const body = await readBody(req);
    const pass = body.pass ? auth.encryptSecret(String(body.pass), auth.loadSecretKey()) : null;
    // 发件人留空就用账号，保存时就补全，避免后续判断为"未配置"
    const mailUser = String(body.user ?? '').trim();
    const mailFrom = String(body.from ?? '').trim(); // 存原值；留空表示用账号，由读取时兜底
    await db.saveSmtpSettings(q, {
      host: String(body.host ?? '').trim(),
      port: Number(body.port ?? 465),
      secure: body.secure !== false,
      username: mailUser,
      passwordEnc: pass,
      fromAddr: mailFrom,
      enabled: body.enabled !== false,
    });
    logger?.info('api.smtp_saved', { by: user.username, host: String(body.host ?? '').trim() });
    // DX 批：SMTP 就绪状态是 /api/site 响应字段——保存后立即失效 site 缓存
    invalidateSiteCache();
    if (store) {
      await settings.hydrateSettings({ store, logger }).catch((err) => {
        logger?.warn('settings.hydrate_failed', { message: String(err.message).slice(0, 160) });
      });
      ratelimit.configureFromEnv(process.env); // BR 批：设置保存后立即热加载限流阈值
      appRateLimit.configureFromEnv(process.env); // CO-3/C2：App 设备限流阈值同步热加载
    }
    json(res, 200, { ok: true });
    return true;
  }

  if (path === '/api/admin/smtp/test' && req.method === 'POST') {
    if (!requireAdmin()) return true;
    const auth = await import('../email-auth.js');
    const { sendMail } = await import('../notify.js');
    const body = await readBody(req);
    const cfg = await auth.smtpConfig(q);
    if (!auth.isSmtpConfigured(cfg)) {
      const missing = [];
      if (!cfg.host) missing.push('主机');
      if (!cfg.from) missing.push('发件人（留空时应回填账号，请再保存一次）');
      logger?.warn('api.smtp_incomplete', { missing, by: user.username });
      json(res, 400, { error: 'SMTP 配置不完整：缺少 ' + missing.join('、') });
      return true;
    }
    // 收件人留空时发给发件人自己，前端不用重复填
    const to = String(body.to ?? '').trim() || cfg.from;
    if (!auth.normalizeEmail(to)) {
      json(res, 400, { error: '收件邮箱不合法' });
      return true;
    }
    const recordId = await db.insertTestEmailCode(q, {
      email: to,
      subject: 'SteamDeals 测试邮件',
      body: '这是一封测试邮件。收到说明 SMTP 配置可用。',
    });
    try {
      const result = await sendMail(
        {
          host: cfg.host,
          port: cfg.port,
          secure: cfg.secure,
          user: cfg.user,
          pass: cfg.pass,
          from: cfg.fromRaw,
          effectiveFrom: cfg.from,
          to,
          subject: 'SteamDeals 测试邮件',
          text: '这是一封测试邮件。收到说明 SMTP 配置可用。',
        },
        { logger },
      );
      await db.markEmailCodeSent(q, recordId);
      logger?.info('api.smtp_test_ok', { to, by: user.username, steps: result?.steps ?? null });
      json(res, 200, { ok: true, steps: result?.steps ?? [] });
      return true;
    } catch (err) {
      const message = String(err.message).slice(0, 200);
      await db.markEmailCodeFailed(q, recordId, message);
      logger?.warn('api.smtp_test_failed', { message, to, steps: err.steps ?? null });
      json(res, 502, { error: message, steps: err.steps ?? [] });
      return true;
    }
  }

  if (path === '/api/admin/emails' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 100) || 100, 1), 500);
    json(res, 200, { records: await db.listEmailCodes(q, { limit }) });
    return true;
  }

  // ---- 邮件模板与发送记录（docs/USER-LIFECYCLE.md §4.3/§4.5，AI 批）----
  if (path === '/api/admin/mail/templates' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    const saved = await db.listMailTemplates(q);
    const contactEmail = appealEmail();
    const templates = mailTemplates.TEMPLATE_EVENTS.map((def) => {
      const row = saved.get(def.event);
      const overrides = row
        ? { subject: row.subject, bodyHtml: row.body_html, bodyText: row.body_text, enabled: row.enabled }
        : { subject: def.subject ?? '', bodyHtml: mailTemplates.DEFAULT_TEMPLATES[def.event]?.bodyHtml ?? '', bodyText: mailTemplates.DEFAULT_TEMPLATES[def.event]?.bodyText ?? '', enabled: true };
      return {
        event: def.event,
        label: def.label,
        variables: def.variables,
        subject: overrides.subject,
        body_html: overrides.bodyHtml,
        body_text: overrides.bodyText,
        enabled: overrides.enabled,
        isDefault: !row,
        contactEmail,
      };
    });
    json(res, 200, { templates, samples: mailTemplates.SAMPLE_THEMES, variables: mailTemplates.TEMPLATE_VARIABLES });
    return true;
  }

  const tplAction = path.match(/^\/api\/admin\/mail\/templates\/([a-z_]+)\/(reset|preview|test)$/);
  if (tplAction) {
    if (!requireAdmin()) return true;
    const event = tplAction[1];
    const action = tplAction[2];
    const known = mailTemplates.TEMPLATE_EVENTS.some((d) => d.event === event);
    if (!known) {
      json(res, 404, { error: '没有该模板事件' });
      return true;
    }
    if (action === 'reset') {
      await db.resetMailTemplate(q, event);
      json(res, 200, { ok: true });
      return true;
    }
    const body = await readBody(req);
    const vars = mailTemplates.templateVarsForPreview(event, String(body.to ?? user.email ?? ''), appealEmail());
    const target = await db.listMailTemplates(q).then((m) => m.get(event));
    const rendered = mailTemplates.renderTemplate({
      subject: target?.subject ?? mailTemplates.DEFAULT_TEMPLATES[event].subject,
      bodyHtml: target?.body_html ?? mailTemplates.DEFAULT_TEMPLATES[event].bodyHtml,
      bodyText: target?.body_text ?? mailTemplates.DEFAULT_TEMPLATES[event].bodyText ?? '',
      vars,
    });
    if (action === 'preview') {
      json(res, 200, rendered);
      return true;
    }
    // test：发给指定地址（默认当前管理员邮箱），走同一发送路径并写 mail_log
    const to = String(body.to ?? '').trim() || String(user.email ?? '');
    if (!to || !to.includes('@')) {
      json(res, 400, { error: '请提供有效的收件邮箱' });
      return true;
    }
    const nowMs = Date.now();
    const last = mailTestCooldown.get(user.id) ?? 0;
    if (nowMs - last < 10_000) {
      json(res, 429, { error: '测试邮件 10 秒内只能发一次' });
      return true;
    }
    mailTestCooldown.set(user.id, nowMs);
    const auth = await import('../email-auth.js');
    const cfg = await auth.smtpConfig(q);
    if (!auth.isSmtpConfigured(cfg)) {
      json(res, 503, { error: 'SMTP 未配置，无法发送测试邮件' });
      return true;
    }
    const sendResult = await notify.sendMail(
      { host: cfg.host, port: cfg.port, secure: cfg.secure, user: cfg.user, pass: cfg.pass, from: cfg.from, to, subject: rendered.subject, text: rendered.text, html: rendered.html },
      { logger, timeoutMs: 8000 },
    );
    await db.insertMailLog(q, { event, toEmail: to, subject: rendered.subject, ok: sendResult.ok, error: sendResult.error ?? null, actor: user.username });
    if (!sendResult.ok) {
      json(res, 502, { error: '发送失败：' + String(sendResult.error ?? '未知错误').slice(0, 200) });
      return true;
    }
    logger?.info('admin.mail_test_sent', { event, to: maskEmail(to), by: user.username });
    json(res, 200, { ok: true });
    return true;
  }

  const tplPut = path.match(/^\/api\/admin\/mail\/templates\/([a-z_]+)$/);
  if (tplPut && req.method === 'PUT') {
    if (!requireAdmin()) return true;
    const event = tplPut[1];
    const known = mailTemplates.TEMPLATE_EVENTS.some((d) => d.event === event);
    if (!known) {
      json(res, 404, { error: '没有该模板事件' });
      return true;
    }
    const body = await readBody(req);
    const check = mailTemplates.validateTemplatePayload(event, {
      subject: body.subject,
      bodyHtml: body.body_html,
      bodyText: body.body_text == null ? null : String(body.body_text),
    });
    if (!check.ok) {
      json(res, 400, { error: check.error });
      return true;
    }
    await db.upsertMailTemplate(q, {
      event,
      subject: check.subject,
      bodyHtml: check.bodyHtml,
      bodyText: check.bodyText,
      enabled: body.enabled !== false,
      updatedBy: user.username,
    });
    json(res, 200, { ok: true, warnings: check.warnings });
    return true;
  }

  if (path === '/api/admin/mail/log' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 200) || 200, 1), 500);
    json(res, 200, { entries: await db.listMailLog(q, { limit }) });
    return true;
  }

  // ---- 代理池健康状态（docs/PROXY-POOL.md §4.5，AM-1 批）：仅管理员；地址一律脱敏 ----
  if (path === '/api/admin/proxies' && req.method === 'GET') {
    if (!requireAdmin()) return true;
    json(res, 200, proxyPool.proxyHealth(process.env, { logger }));
    return true;
  }

  // BB 批（docs/PROXY-POOL.md §11.3）：立即检测——CONNECT 逐条探测代理池并写健康文件（不写业务冷却）
  if (path === '/api/admin/proxies/probe' && req.method === 'POST') {
    if (!requireAdmin()) return true;
    try {
      const out = await proxyPool.probeAllProxies(process.env, { logger });
      json(res, 200, out);
      return true;
    } catch (err) {
      logger.error('proxy.probe_failed', { message: String(err?.message ?? err).slice(0, 200) });
      json(res, 500, { error: String(err?.message ?? err) });
      return true;
    }
  }

  return false;
}
