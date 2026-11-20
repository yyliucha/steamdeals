// B4 #19 cli 报表类域（CO-5/B4-2 第十一轮拆分）：report / alerts / stats / history / list / chart / compare。
// 按 ARCHITECTURE §15 模式：本模块**不 import cli.js**（入口文件带 main() 副作用），
// 宿主（cli.js）把共享上下文打包成 ctx 传入（§15.2 类比），createCliReport(ctx) 返回：
//   - commands        7 个报表类命令（commands 注册表条目指这里）
//   - trackedCommands alerts / report（写 sync_runs + fetch_runs，TRACKED_COMMANDS 语义保持）
// 契约零变化：命令名/参数/输出/退出码与拆分前逐字节一致。
// yuan / pad 是跨域显示工具（cmdWatch/cmdMatch/cmdDiagnose 也用）→ 留宿主经 ctx 传入；
// sparkline/BLOCKS 只有 history 命令用 → 随域移入本文件。

import * as db from '../store/pg.js';
import { buildSite } from '../report.js';
import { evaluateAlerts, renderDigest, toPayload, groupAlertsByUser } from '../alerts.js';
import { channelsFromEnv, deliver } from '../notify.js';
// CB 批（docs/PRICE-REPORT-EMAIL.md §3.3）：价格报表邮件 HTML 渲染
import { renderPriceReport } from '../price-report-html.js';
import { renderCompare, groupOffersByRegion } from '../compare.js';
import { yuanAmount } from '../format.js';
import * as cliReportRepo from '../store/cli-report-repository.js';

const BLOCKS = '▁▂▃▄▅▆▇█';
const sparkline = (values) => {
  if (!values.length) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values.map((v) => BLOCKS[Math.min(7, Math.floor(((v - min) / span) * 7))]).join('');
};

export function createCliReport(ctx) {
  const { args, flag, logger, withStore, yuan, pad } = ctx;

  async function cmdAlerts() {
    const rows = await withStore((store) => db.watchCandidates((sql, p) => store.query(sql, p)));
    const hits = evaluateAlerts(rows, { now: new Date() });
    const extraWebhook = flag('webhook', null);
    const channels = channelsFromEnv();
    if (typeof extraWebhook === 'string') channels.push({ name: 'webhook(cli)', kind: 'webhook', url: extraWebhook });
    const mark = flag('mark', false) === true || flag('mark', false) === 'true';

    // CL 批（docs/USER-ALERTS.md §3.3）：按 user_id 分组——站点级走原全通道，用户级一人一封邮件。
    const { site: siteHits, users: userGroups } = groupAlertsByUser(hits);

    logger.info('alert.evaluated', {
      watched: rows.length,
      hits: hits.length,
      siteHits: siteHits.length,
      userGroups: userGroups.length,
      channels: channels.map((c) => c.name),
      reasons: hits.reduce((acc, h) => ({ ...acc, [h.reason]: (acc[h.reason] ?? 0) + 1 }), {}),
    });

    if (!hits.length) {
      console.log('没有需要提醒的价格。');
      return;
    }

    if (flag('json', false) === true) {
      console.log(JSON.stringify(toPayload(hits, { now: new Date() }), null, 2));
    } else {
      console.log(renderDigest(hits, { now: new Date() }));
    }

    const marked = []; // 成功投递后才记 last_notified（同价位不重复打扰）
    let delivered = false;

    // ---- 站点级（NULL）：行为不变（webhook / 企微 / 邮件到 ALERT_EMAIL_TO）----
    if (siteHits.length && channels.length) {
      const { renderAlertsHtml } = await import('../alerts-html.js');
      const mail = renderAlertsHtml(siteHits, { now: new Date() });
      const result = await deliver(channels, {
        text: renderDigest(siteHits, { now: new Date() }),
        html: mail.html,
        payload: toPayload(siteHits, { now: new Date() }),
        subject: mail.subject,
        logger,
      });
      delivered = delivered || result.ok;
      for (const r of result.results) {
        const detail = r.ok ? `HTTP ${r.status ?? ''}`.trim() : (r.error ?? `errcode=${r.errcode}`);
        console.log(`  ${r.ok ? '✔' : '✘'} ${r.channel}  ${detail}`);
      }
      if (result.ok) marked.push(...siteHits);
    } else if (siteHits.length && !channels.length) {
      console.log('\n未配置任何提醒通道（ALERT_WEBHOOK_URL / WECOM_WEBHOOK_URL / SMTP_HOST+ALERT_EMAIL_TO），仅输出到终端。');
      // 与旧行为一致：无通道时 --mark 仍记录（终端已展示，避免每轮重复评估）
      if (mark) marked.push(...siteHits);
    }

    // ---- 用户级：一人一封邮件（收件人 = 用户绑定邮箱）；无邮箱跳过并记日志 ----
    if (userGroups.length) {
      const { renderAlertsHtml } = await import('../alerts-html.js');
      for (const group of userGroups) {
        if (!group.email) {
          logger.info('alert.skipped_no_email', { userId: group.userId, count: group.hits.length });
          console.log(`  ✘ 用户 ${group.userId} 未绑定邮箱，跳过 ${group.hits.length} 条提醒。`);
          continue;
        }
        // CX 批（docs/USER-PROFILE-EDIT.md §2 #5）：到价提醒邮件开关——用户关闭后不投递（仍会继续参与评估/记录）
        if (!group.emailAlerts) {
          logger.info('alert.skipped_email_off', { userId: group.userId, count: group.hits.length });
          console.log(`  ✘ 用户 ${group.userId} 已关闭到价提醒邮件，跳过 ${group.hits.length} 条提醒。`);
          continue;
        }
        if (!process.env.SMTP_HOST || !process.env.SMTP_FROM && !process.env.SMTP_USER) {
          logger.warn('alert.user_skipped_no_smtp', { userId: group.userId, count: group.hits.length });
          console.log(`  ✘ SMTP 未配置，跳过用户 ${group.userId}（${group.email}）。`);
          continue;
        }
        const mail = renderAlertsHtml(group.hits, { now: new Date() });
        const emailChannel = {
          name: `email(user:${group.userId})`,
          kind: 'email',
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT ?? 465),
          secure: (process.env.SMTP_SECURE ?? '1') !== '0',
          user: process.env.SMTP_USER ?? '',
          pass: process.env.SMTP_PASS ?? '',
          from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? '',
          to: [group.email],
        };
        const result = await deliver([emailChannel], {
          text: renderDigest(group.hits, { now: new Date() }),
          html: mail.html,
          payload: toPayload(group.hits, { now: new Date() }),
          subject: mail.subject,
          logger,
        });
        const r = result.results[0];
        console.log(`  ${r?.ok ? '✔' : '✘'} ${emailChannel.name} ${r?.ok ? `HTTP ${r.status ?? ''}`.trim() : (r?.error ?? '')}`);
        if (result.ok) {
          delivered = true;
          marked.push(...group.hits);
        }
      }
    }

    if (mark && marked.length) {
      await withStore(async (store) => {
        const q = (sql, p) => store.query(sql, p);
        for (const h of marked) await db.markNotified(q, { watchId: h.watchId, priceCents: h.currentCents });
      });
      logger.info('alert.marked', { count: marked.length });
      console.log(`已记录 ${marked.length} 条提醒，同价位不会重复通知。`);
    } else if (mark && hits.length && !marked.length) {
      logger.warn('alert.not_marked', { reason: 'delivery_failed', hits: hits.length });
      console.log('投递全部失败（或全部跳过），未记录提醒状态（下轮会重试）。');
    }
  }

  /** 多区服对比：同一款游戏在各区服的报价并排展示（不同币种不折算）。 */
  async function cmdCompare() {
    const appid = Number(args[1]);
    if (!Number.isFinite(appid)) throw new Error('用法: node src/cli.js compare <steamAppid> [--region cn] [--json]');
    const regionFlag = flag('region', null);
    const region = typeof regionFlag === 'string' ? regionFlag : null;

    const data = await withStore(async (store) => {
      const q = (sql, p) => store.query(sql, p);
      const game = await cliReportRepo.compareGameBySteamAppid(q, { appid });
      if (!game) return null;
      const rows = await db.regionOffers(q, { steamAppid: appid, region });
      return { game, rows };
    });

    if (!data) throw new Error(`库里没有 appid ${appid}，先 add 或 seed`);

    const groups = groupOffersByRegion(data.rows);
    logger.info('compare.done', {
      appid,
      regions: groups.map((g) => g.region),
      offers: data.rows.length,
    });

    if (flag('json', false) === true) {
      console.log(
        JSON.stringify(
          {
            game: data.game,
            regions: groups.map((g) => ({
              region: g.region,
              currency: g.currency,
              offers: g.offers.map((o) => ({
                platform: o.platform_code,
                price: o.price_cents,
                currency: o.currency,
                discount: o.discount_pct,
                cheapest: o.isCheapest,
              })),
            })),
          },
          null,
          2,
        ),
      );
      return;
    }

    console.log(
      renderCompare({
        game: data.game,
        rows: data.rows,
        generatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      }),
    );
  }

  async function cmdChart() {
    const outDir = String(flag('out', process.env.OUT_DIR ?? 'out'));
    const days = Number(flag('days', 90));
    const limit = Number(flag('limit', 200));
    const result = await withStore((store) =>
      buildSite((sql, p) => store.query(sql, p), { outDir, days, limit, logger }),
    );
    console.log(`已生成 ${result.games} 款游戏的价格页（${result.files.length} 个文件）→ ${result.outDir}/index.html`);
    console.log(`耗时 ${(result.elapsedMs / 1000).toFixed(2)}s`);
  }

  async function cmdList() {
    const rows = await withStore((store) => db.lowestOffers((sql, p) => store.query(sql, p), { limit: Number(flag('limit', 30)) }));
    if (!rows.length) {
      console.log('还没有报价数据。先 init → seed → sync steam/sonkwo');
      return;
    }
    console.log(`${pad('游戏', 30)} ${pad('平台', 14)} ${pad('现价', 10)} ${pad('原价', 10)} ${pad('折扣', 6)} ${pad('史低', 10)}`);
    console.log('-'.repeat(92));
    for (const r of rows) {
      const atLow = r.hist_low != null && r.price_cents <= r.hist_low ? '★' : '';
      console.log(
        `${pad(r.name, 30)} ${pad(r.platform_code, 14)} ${pad(yuan(r.price_cents), 10)} ${pad(yuan(r.original_cents), 10)} ` +
          `${pad(`-${r.discount_pct}%`, 6)} ${pad(yuan(r.hist_low), 10)} ${atLow}`,
      );
    }
  }

  async function cmdHistory() {
    const appid = Number(args[1]);
    if (!Number.isFinite(appid)) throw new Error('用法: node src/cli.js history <steamAppid> [--days 90]');
    const days = Number(flag('days', 90));
    const rows = await withStore((store) => db.priceHistory((sql, p) => store.query(sql, p), { steamAppid: appid, days }));
    if (!rows.length) {
      console.log(`appid ${appid} 没有历史数据`);
      return;
    }
    const byDay = new Map();
    for (const r of rows) {
      const cur = byDay.get(String(r.day));
      if (cur == null || r.min_price_cents < cur) byDay.set(String(r.day), r.min_price_cents);
    }
    const values = [...byDay.values()];
    console.log(`appid ${appid} 近 ${days} 天最低价（${values.length} 天有数据）`);
    console.log(`  ${sparkline(values)}   ${yuan(Math.min(...values))} ~ ${yuan(Math.max(...values))}`);
    for (const [day, price] of byDay) console.log(`  ${day}  ${yuan(price)}`);
    const low = await withStore((store) => db.isAtHistoricalLow((sql, p) => store.query(sql, p), { steamAppid: appid }));
    if (low) console.log(`\n当前最低 ${yuan(low.current)} / 史低 ${yuan(low.histLow)} → ${low.atLow ? '已是史低' : '还没到史低'}`);
  }

  async function cmdStats() {
    const s = await withStore((store) => db.stats((sql, p) => store.query(sql, p)));
    console.log(`游戏 ${s.games} / 报价 ${s.offers} / 快照 ${s.snapshots} / 日聚合 ${s.dailyRows}`);
    console.log(`平台：${s.platforms.map((p) => `${p.code}(${p.kind})`).join(', ') || '(空)'}`);
    if (s.lastRuns.length) {
      console.log('最近采集：');
      for (const r of s.lastRuns) {
        console.log(`  ${r.platform_code} ${r.started_at?.toISOString?.() ?? r.started_at} → ${r.status} 请求${r.requests} 成功${r.ok} 跳过${r.skipped} 失败${r.failed} ${r.note ?? ''}`);
      }
    }
  }

  async function cmdReport() {
    const sub = String(args[1] ?? 'price');
    if (sub !== 'price') {
      throw new Error('用法: node src/cli.js report price [--hours 24] [--limit 10] [--csv] [--days 7]');
    }
    const hours = Number(flag('hours', 24));
    const limit = Number(flag('limit', 10));

    // CSV 输出：重定向到文件即可用 Excel 打开
    if (flag('csv', false) === true) {
      const rows = await withStore((store) => db.priceChangeRows((sql, p) => store.query(sql, p), { hours }));
      const cell = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
      console.log('appid,name,platform,platform_name,old_price,new_price,drop_pct,captured_at');
      for (const r of rows) {
        const pct = r.was > 0 ? (((r.was - r.now_price) / r.was) * 100).toFixed(1) : '';
        console.log([r.steam_appid ?? '', r.name, r.platform, r.platform_name,
          yuanAmount(r.was), yuanAmount(r.now_price), pct,
          String(r.captured_at).slice(0, 19).replace('T', ' ')].map(cell).join(','));
      }
      return;
    }

    const rep = await withStore((store) => db.priceChanges((sql, p) => store.query(sql, p), { hours, limit }));
    const daily = await withStore((store) => db.priceChangesByDay((sql, p) => store.query(sql, p), { days: Number(flag('days', 7)) }));
    console.log(`近 ${rep.hours} 小时价格变动：降价 ${rep.drops} 条 / 涨价 ${rep.rises} 条 / 新史低 ${rep.newLows} 条（共 ${rep.changed} 条）`);
    if (!rep.changed) {
      console.log('（没有变动：要么价格没变，要么快照是在加入 prev_price_cents 之前写的）');
    } else {
      const fmt = (x) => `¥${yuanAmount(x)}`;
      const when = (t) => String(t).slice(0, 16).replace('T', ' ');
      console.log('\n降价 Top：');
      for (const d of rep.topDrops) {
        const pct = d.was > 0 ? Math.round((d.drop_cents / d.was) * 100) : 0;
        console.log(`  ${fmt(d.was)} → ${fmt(d.now_price)}  -${pct}%  ${d.name} · ${d.platform_name}  ${when(d.captured_at)}`);
      }
      console.log('\n涨价 Top：');
      for (const r of rep.topRises) {
        console.log(`  ${fmt(r.was)} → ${fmt(r.now_price)}  ${r.name} · ${r.platform_name}  ${when(r.captured_at)}`);
      }
    }
    if (daily.length) {
      console.log('\n近 ' + daily.length + ' 天趋势：');
      for (const d of daily) console.log(`  ${d.day}  降价 ${d.drops} / 涨价 ${d.rises}（共 ${d.changed}）`);
    }

    // --notify：把报表推到已配置的提醒通道（webhook / 企微 / 邮件）
    if (flag('notify', false) === true) {
      const channels = channelsFromEnv();
      if (!channels.length) {
        console.log('\n没有配置任何提醒通道，跳过推送（ALERT_WEBHOOK_URL / WECOM_WEBHOOK_URL / SMTP_HOST+ALERT_EMAIL_TO）');
      } else {
        // CB 批（docs/PRICE-REPORT-EMAIL.md §3.3）：无论通道类型都先生成 {subject, html, text}——
        // email 通道发 multipart/alternative（HTML + 纯文本 fallback），webhook / 企微仍只发 text。
        const { subject, html, text } = renderPriceReport({
          report: rep,
          daily,
          siteUrl: String(process.env.SITE_PUBLIC_URL ?? '').trim() || 'https://sd.yyliucha.cn',
          siteName: String(process.env.SITE_NAME ?? '').trim() || 'SteamDeals',
        });
        const result = await deliver(channels, {
          text,
          html,
          payload: { type: 'steamdeals.price_report', text },
          subject,
          logger,
        });
        for (const r of result.results) {
          console.log(`  ${r.ok ? '✔' : '✘'} ${r.channel}  ${r.ok ? `HTTP ${r.status ?? ''}` : (r.error ?? `errcode=${r.errcode}`)}`);
        }
        console.log(result.ok ? '报表已推送。' : '报表推送失败，见日志 notify.* 事件。');
        if (!result.ok) process.exitCode = 1;
      }
    }
    logger.info('report.price', { hours: rep.hours, changed: rep.changed, drops: rep.drops, rises: rep.rises, newLows: rep.newLows });
  }

  return {
    commands: {
      report: cmdReport,
      alerts: cmdAlerts,
      stats: cmdStats,
      history: cmdHistory,
      list: cmdList,
      chart: cmdChart,
      compare: cmdCompare,
    },
    trackedCommands: {
      alerts: cmdAlerts,
      report: cmdReport,
    },
  };
}
