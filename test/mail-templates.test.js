// 邮件模板（docs/USER-LIFECYCLE.md §3.1/§4.3/§4.4/§6，AI 批）：
// 9 事件默认齐全、渲染变量转义、未知变量原样保留、统一页脚、text 兜底、
// 保存前校验（主题去 CR/LF、{{code}} 仅验证码可用）、3 套示例版式、DB 存取与 mail_log。
import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store/index.js';
import * as db from '../src/store/pg.js';
import { ensureEmailSchema } from '../src/email-auth.js';
import {
  DEFAULT_TEMPLATES,
  TEMPLATE_EVENTS,
  SAMPLE_THEMES,
  renderTemplate,
  htmlToText,
  unknownVariables,
  validateTemplatePayload,
  resolveTemplate,
} from '../src/mail-templates.js';

test('9 个事件默认模板齐全：verify_code 才含 {{code}}，其余都不含', () => {
  assert.equal(TEMPLATE_EVENTS.length, 9, '8 类账号通知 + 验证码');
  for (const def of TEMPLATE_EVENTS) {
    const tpl = DEFAULT_TEMPLATES[def.event];
    assert.ok(tpl?.subject, `${def.event} 缺默认主题`);
    assert.ok(tpl?.bodyHtml, `${def.event} 缺默认 HTML`);
  }
  assert.match(DEFAULT_TEMPLATES.verify_code.bodyHtml, /\{\{code\}\}/);
  for (const def of TEMPLATE_EVENTS.filter((d) => d.event !== 'verify_code')) {
    assert.ok(!/\{\{\s*code\s*\}\}/.test(DEFAULT_TEMPLATES[def.event].bodyHtml), `${def.event} 不应含 {{code}}`);
  }
});

test('渲染：变量转义、未知变量原样保留、页脚追加、text 自动兜底', () => {
  const out = renderTemplate({
    subject: '你好 {{username}}',
    bodyHtml: '<p>{{username}}</p><p>{{badVar}}</p>',
    bodyText: '',
    vars: { username: '<script>alert(1)</script>', siteUrl: 'https://x.example', contactEmail: 'a@x.example' },
  });
  assert.equal(out.subject, '你好 &lt;script&gt;alert(1)&lt;/script&gt;', '主题变量也转义');
  assert.match(out.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(out.html, /\{\{badVar\}\}/, '未知变量原样保留');
  assert.match(out.html, /本邮件由系统自动发送，请勿直接回复/, '统一页脚必须由代码追加');
  assert.match(out.text, /本邮件由系统自动发送/, '纯文本也带页脚');
  assert.ok(!out.text.includes('<p>'), 'text 兜底由 HTML 去标签生成');
  // bodyText 给了就用它（仍渲染变量）
  const withText = renderTemplate({ subject: 's', bodyHtml: '<p>x</p>', bodyText: 'hi {{username}}', vars: { username: 'u' } });
  assert.match(withText.text, /hi u/);
});

test('htmlToText：去标签、解实体', () => {
  assert.equal(htmlToText('<p>a&amp;b <b>c</b></p><style>x{}</style>'), 'a&b c');
});

test('unknownVariables：白名单外的变量被揪出来', () => {
  assert.deepEqual(unknownVariables('{{username}} {{password}}'), ['password']);
  assert.deepEqual(unknownVariables('ok'), []);
});

test('validateTemplatePayload：主题去 CR/LF、{{code}} 仅验证码可用、未知变量只警告', () => {
  const ok = validateTemplatePayload('account_deleted', { subject: '好\r\nBcc: x', bodyHtml: '<p>{{username}}</p>' });
  assert.equal(ok.ok, true);
  assert.equal(ok.subject, '好 Bcc: x', '主题里的换行必须被过滤（防头注入）');
  assert.deepEqual(ok.warnings, []);
  const badCode = validateTemplatePayload('account_deleted', { subject: 's', bodyHtml: '{{code}}' });
  assert.equal(badCode.ok, false, '非验证码事件禁 {{code}}');
  const warn = validateTemplatePayload('verify_code', { subject: 's', bodyHtml: '{{code}} {{password}}' });
  assert.equal(warn.ok, true, '验证码事件允许 {{code}}');
  assert.ok(warn.warnings.length === 1 && warn.warnings[0].includes('password'), '未知变量返回警告');
  const empty = validateTemplatePayload('verify_code', { subject: '  ', bodyHtml: 'x' });
  assert.equal(empty.ok, false, '主题必填');
});

test('3 套示例版式：都带常用变量、可直接填入编辑器', () => {
  assert.equal(SAMPLE_THEMES.length, 3);
  for (const s of SAMPLE_THEMES) {
    assert.ok(s.id && s.label && s.subject && s.bodyHtml, `${s.label} 不完整`);
    assert.match(s.bodyHtml, /\{\{username\}\}/);
  }
});

test('DB 存取：upsert → 读出合并 → reset 恢复默认；mail_log 增查', async () => {
  const store = await openStore('pglite:', {});
  await db.migrate(store);
  await ensureEmailSchema(store);
  const q = (sql, p) => store.query(sql, p);
  try {
    await db.upsertMailTemplate(q, { event: 'account_deleted', subject: '自定义主题', bodyHtml: '<p>{{username}}</p>', bodyText: null, enabled: false, updatedBy: 'admin1' });
    const merged = await resolveTemplate(q, 'account_deleted');
    assert.equal(merged.subject, '自定义主题');
    assert.equal(merged.enabled, false, '启停要落库');
    assert.equal(merged.isDefault, false);
    const def = await resolveTemplate(q, 'account_enabled');
    assert.equal(def.isDefault, true, '没存过的事件回落默认');

    await db.resetMailTemplate(q, 'account_deleted');
    const reset = await resolveTemplate(q, 'account_deleted');
    assert.equal(reset.isDefault, true, '恢复默认 = 删表行');

    await db.insertMailLog(q, { event: 'test', toEmail: 'x@y.com', subject: 't', ok: true, actor: 'admin1' });
    await db.insertMailLog(q, { event: 'test', toEmail: 'z@y.com', subject: 't2', ok: false, error: 'boom', actor: 'admin1' });
    const rows = await db.listMailLog(q, { limit: 10 });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].to_email, 'z@y.com', '倒序');
    assert.equal(rows[0].ok, false);
    assert.equal(rows[0].error, 'boom');
  } finally {
    await store.close();
  }
});
