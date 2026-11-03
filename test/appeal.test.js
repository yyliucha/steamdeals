// 申诉邮箱回退链：水合空串不能截断回退（docs/APPEAL-EMAIL.md §3.1）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { appealEmailFrom } from '../src/appeal.js';

test('空串不截断：ALERT_EMAIL_TO=空 时继续回退到 SMTP_FROM', () => {
  assert.equal(appealEmailFrom({ ALERT_EMAIL_TO: '', SMTP_FROM: 'a@b.c' }), 'a@b.c');
  assert.equal(appealEmailFrom({ APPEAL_EMAIL: '', ALERT_EMAIL_TO: '', SMTP_FROM: 'a@b.c' }), 'a@b.c');
});

test('优先级：申诉邮箱 > 收件人 > 发件人 > SMTP 账号', () => {
  assert.equal(appealEmailFrom({ APPEAL_EMAIL: 'x@y.z', ALERT_EMAIL_TO: 'a@b.c' }), 'x@y.z');
  assert.equal(appealEmailFrom({ ALERT_EMAIL_TO: 'a@b.c', SMTP_FROM: 'from@x.c', SMTP_USER: 'u@v.w' }), 'a@b.c');
  assert.equal(appealEmailFrom({ SMTP_FROM: 'from@x.c', SMTP_USER: 'u@v.w' }), 'from@x.c');
});

test('SMTP_FROM 为空时回退到 SMTP_USER；全空返回空串', () => {
  assert.equal(appealEmailFrom({ SMTP_FROM: '', SMTP_USER: 'u@v.w' }), 'u@v.w');
  assert.equal(appealEmailFrom({}), '');
  assert.equal(appealEmailFrom({ APPEAL_EMAIL: '  ' }), '', '空白串 trim 后视为空');
});

test('前后空白会被 trim', () => {
  assert.equal(appealEmailFrom({ SMTP_USER: '  u@v.w  ' }), 'u@v.w');
});
