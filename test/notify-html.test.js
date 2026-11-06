// HTML 邮件（docs/USER-LIFECYCLE.md §4.4，AI 批）：
// buildMessage 有 html 时输出 multipart/alternative（text/plain + text/html 双段 base64），
// 无 html 时保持纯文本单段（向后兼容）；encodeSubject 过滤 CR/LF 防头注入。
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMessage, encodeSubject } from '../src/notify.js';

test('encodeSubject：CR/LF 必须被过滤（防注入 Bcc/换行头）', () => {
  const evil = encodeSubject('普通主题\r\nBcc: evil@x.com\r\nX-Hack: 1');
  assert.ok(!evil.includes('\r') && !evil.includes('\n'), '主题里不能残留换行');
  assert.match(evil, /^=\?UTF-8\?B\?/, '含中文主题走 RFC 2047');
  assert.equal(encodeSubject('plain ascii'), 'plain ascii', '纯 ASCII 主题不编码');
});

test('buildMessage：带 html → multipart/alternative 双段；不带 → 纯文本单段', () => {
  const multi = buildMessage({ from: 'a@x.com', to: 'b@y.com', subject: '测试', text: '纯文本', html: '<p>富文本</p>' });
  assert.match(multi, /Content-Type: multipart\/alternative; boundary="/, '必须是 multipart/alternative');
  assert.match(multi, /Content-Type: text\/plain; charset=UTF-8/, '要有 text/plain 兜底');
  assert.match(multi, /Content-Type: text\/html; charset=UTF-8/, '要有 text/html 段');
  assert.match(multi, /Content-Transfer-Encoding: base64/, '两段都 base64');
  assert.ok(multi.includes('--'), '边界分隔存在');
  // 解码验证两段内容都在
  const boundary = /boundary="([^"]+)"/.exec(multi)[1];
  assert.ok(multi.includes(`--${boundary}`) && multi.includes(`--${boundary}--`), '边界开闭完整');

  const plain = buildMessage({ from: 'a@x.com', to: 'b@y.com', subject: 's', text: '只有文本' });
  assert.ok(!plain.includes('multipart'), '无 html 时保持旧格式单段');
  assert.match(plain, /Content-Type: text\/plain; charset=UTF-8/);
});

test('buildMessage：html 为空串/空值都按纯文本处理', () => {
  for (const html of [null, '', undefined]) {
    const msg = buildMessage({ from: 'a@x.com', to: 'b@y.com', subject: 's', text: 't', html });
    assert.ok(!msg.includes('multipart'), '空 html 不得产生 multipart');
  }
});
