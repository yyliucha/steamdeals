// Steam 代理池设置页（docs/PROXY-POOL.md §5/§7 验收 8、9，AM-2 批）：
// 前端没有组件级测试框架，沿用 frontend-registration.test.js 的静态源码断言惯例，
// 锁住 AdminModules.vue 里代理列表编辑器与健康状态表的必需行为；编译正确性由 frontend:build 兜底。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = readFileSync(fileURLToPath(new URL('../frontend/src/pages/AdminModules.vue', import.meta.url)), 'utf8');

test('验收 8：列表编辑器——查看并编辑走明文通道、增/删/上移/下移/清空、上限 10 条、未配置文案', () => {
  assert.match(src, /已配置 \{\{ proxyList\.length \}\} 条/, '卡片显示已配置 N 条');
  assert.match(src, /未配置，Steam 走直连\/通用代理/, 'N=0 时提示未配置');
  assert.match(src, /revealProxyList/, '查看并编辑按钮');
  assert.match(src, /\/api\/admin\/settings\/value\?key=network\.steamProxy/, '明文走现有查看通道（§5.1）');
  assert.match(src, /上移/, '每行上移');
  assert.match(src, /下移/, '每行下移');
  assert.match(src, /removeProxy\(i\)/, '每行删除');
  assert.match(src, /添加一条/, '底部添加一条');
  assert.match(src, /proxyList\.length>=10/, '满 10 条置灰');
  assert.match(src, /清空全部/, '清空全部');
  assert.match(src, /moveProxy\(i,-1\)/, '上移是 moveProxy(i,-1)');
  assert.match(src, /moveProxy\(i,1\)/, '下移是 moveProxy(i,1)');
});

test('验收 8：保存语义——非空行 join("\\n") 提交、清空传 null、前端校验 http/https 与 ≤10（服务端兜底）', () => {
  assert.match(src, /lines\.join\('\\n'\)/, '多行用换行 join 提交 network.steamProxy');
  assert.match(src, /values\[f\.key\]=lines\.length\?lines\.join\(/, '非空才写值');
  assert.match(src, /:null/, '清空传 null');
  assert.match(src, /第 \$\{i\+1\} 行不是合法的 http\/https 代理/, '前端校验报行号');
  assert.match(src, /Steam 代理池最多 10 条/, '前端校验 ≤10');
  assert.ok(src.includes('/^https?:\\/\\//i'), '只允许 http/https（/^https?:\\/\\//i 正则）');
});

test('验收 9：健康状态表——列齐全、状态映射（正常/冷却中倒计时/未知）、刷新按钮、脱敏由 API 保证', () => {
  assert.match(src, /连续失败/, '连续失败列');
  assert.match(src, /冷却到/, '冷却到列');
  assert.match(src, /最近错误/, '最近错误列');
  assert.match(src, /proxyStateType\(row\)/, '状态列走映射');
  assert.match(src, /row\.state==='ok'\?'success'/, '正常=绿');
  assert.match(src, /row\.state==='cooldown'\?'warning'/, '冷却=黄');
  assert.match(src, /冷却中 \$\{String\(Math\.floor\(left\/60\)\)/, '冷却中带倒计时 mm:ss');
  assert.match(src, /'未知'/, '未知状态');
  assert.match(src, /\/api\/admin\/proxies/, '健康数据来自 GET /api/admin/proxies（地址脱敏在服务端）');
  assert.match(src, /刷新/, '刷新按钮');
});

test('验收 9：刷新时机——分组展开且页面可见时每 10 秒自动刷新；保存后立即刷新一次', () => {
  assert.match(src, /proxyTick%10===0/, '每 10 秒一次（1 秒 tick × 10）');
  assert.match(src, /document\.hidden/, '页面不可见时不刷');
  assert.match(src, /activeSettingsTab\.value==='network'/, '只在网络 tab 打开时刷（AT 批：设置折叠改 tab）');
  assert.match(src, /startProxyTimer\(\)/, '定时器随组件挂载启动');
  assert.match(src, /clearInterval\(proxyTimer\)/, '卸载时清理定时器');
  assert.match(src, /ElMessage\.success\(`已保存/, '保存成功后');
  assert.match(src, /loadProxyHealth\(\)/, '保存后立即刷新健康状态（saveSettings 内调用）');
});
