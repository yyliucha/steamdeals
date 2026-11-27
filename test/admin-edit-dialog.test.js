// EL 批（docs/ADMIN-EDIT-DIALOG.md §5）：后台「添加/编辑」统一弹窗静态契约——
// EK-1~EK-6 全部为弹窗（页面无新增内联表单/添加编辑类抽屉）；搜索栏 inline-form 与只读查看抽屉保留。
// 前端无组件级测试框架，沿用静态源码断言惯例；编译正确性与交互由 frontend:build + e2e/目视兜底。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const modules = read('../frontend/src/pages/AdminModules.vue');
const anDialog = read('../frontend/src/components/AnnouncementDrawer.vue');
const appeals = read('../frontend/src/components/AppealsAdmin.vue');
const align = read('../frontend/src/components/AlignAdmin.vue');
const links = read('../frontend/src/components/GameLinksDrawer.vue');

test('EK-1/EK-2：IP 黑/白名单添加改按钮 + 弹窗，页面不再有添加内联表单', () => {
  assert.doesNotMatch(modules, /newBlockIp/, '黑名单内联输入已移除');
  assert.doesNotMatch(modules, /newAllowIp/, '白名单内联输入已移除');
  assert.match(modules, /添加黑名单/, '黑名单添加按钮');
  assert.match(modules, /添加白名单/, '白名单添加按钮');
  assert.match(modules, /openIpDialog\('black'\)/, '黑名单弹窗入口');
  assert.match(modules, /openIpDialog\('white'\)/, '白名单弹窗入口');
  assert.match(modules, /v-model="ipDialog\.visible"/, 'IP 添加弹窗挂载');
  assert.match(modules, /width="min\(520px, 92vw\)"/, '弹窗宽度 min(520px, 92vw)');
  assert.match(modules, /label="IP 或 CIDR"/, '弹窗含 IP 输入');
  assert.match(modules, /label="备注（可选）"/, '弹窗含备注输入');
  assert.match(modules, /submitIpDialog/, '弹窗确认提交');
  assert.match(modules, /\/api\/admin\/blacklist/, '黑名单提交接口不变');
  assert.match(modules, /\/api\/admin\/whitelist/, '白名单提交接口不变');
  // 行内快捷入口（访问明细「信任」）仍保留直接加白
  assert.match(modules, /addWhitelist\(row\.ip\)/, '行内信任快捷入口保留');
});

test('EK-3：站点通知新建/编辑由抽屉改弹窗（表单一致、URL 直达、未保存守卫保留）', () => {
  assert.match(modules, /<AnnouncementDrawer v-model:visible="announcementDrawer\.visible"/, '通知编辑组件挂载');
  assert.match(modules, /新建 \/ 编辑通知走弹窗/, '页面文案改为弹窗');
  assert.doesNotMatch(anDialog, /<el-drawer/, '组件不再用抽屉');
  assert.match(anDialog, /<el-dialog/, '组件改用 el-dialog');
  assert.match(anDialog, /width="min\(660px, 92vw\)"/, '宽度自适应（92vw 上限）');
  assert.match(anDialog, /label-position="top"/, '表单 label-position=top 一致');
  assert.match(anDialog, /前台预览/, '前台预览保留');
  assert.match(anDialog, /form\.id \? 'PATCH' : 'POST'/, '新建/编辑共用（同接口两态）');
  assert.match(anDialog, /requestLeave/, '关闭前过未保存守卫');
  assert.match(anDialog, /:before-close="onClose"/, '✕/Esc 走 before-close 脏确认');
  assert.match(modules, /drawer:'new'/, '?section=announcements&drawer=new 直达保留');
});

test('EK-4：Steam 专用代理内联编辑器改弹窗（列表增删/排序/健康表/保存回写）', () => {
  assert.doesNotMatch(modules, /proxyEditing/, '内联展开编辑态已移除');
  assert.match(modules, /openProxyDialog/, '弹窗打开动作');
  assert.match(modules, /v-model="proxyDialogOpen"/, '代理编辑弹窗挂载');
  assert.match(modules, /title="Steam 专用代理"/, '弹窗标题');
  assert.match(modules, /moveProxy\(i,-1\)/, '上移保留');
  assert.match(modules, /moveProxy\(i,1\)/, '下移保留');
  assert.match(modules, /removeProxy\(i\)/, '删除保留');
  assert.match(modules, /添加一条/, '添加一条保留');
  assert.match(modules, /清空全部/, '清空全部保留');
  assert.match(modules, /saveProxyDialog/, '弹窗保存');
  assert.match(modules, /values:\{'network\.steamProxy':lines\.length\?lines\.join\('\\n'\):null\}/, '保存回写：非空 join 换行 / 清空 null');
  assert.match(modules, /第 \$\{i\+1\} 行不是合法的 http\/https 代理/, 'http/https 校验报行号');
  assert.match(modules, /Steam 代理池最多 10 条/, '≤10 校验');
  assert.match(modules, /\/api\/admin\/settings\/value\?key=network\.steamProxy/, '打开弹窗走明文通道');
  assert.match(modules, /proxyStateType\(row\)/, '健康状态表搬进弹窗');
  assert.match(modules, /立即检测/, '测试（立即检测）保留');
  assert.match(modules, /约 15 秒内生效/, '保存后 15 秒生效提示');
});

test('FX（docs/SECRET-REVEAL.md §4，取代 EK-5 的查看/编辑弹窗）：两个代理密钥改眼睛式密码框', () => {
  // FX 批把 EK-5 的「编辑按钮 + 弹窗」统一成行内 SecretField（密码框 + 眼睛懒加载 + 清除）；
  // 这里锁的是「入口没被卡片化弄丢」：两个代理 key 仍走同一分支，且渲染 SecretField。
  assert.match(modules, /field\.key==='network\.httpsProxy'\|\|field\.key==='network\.appSyncProxy'/, '两个代理 key 走同一分支');
  assert.match(modules, /<SecretField v-else-if="field\.key==='network\.httpsProxy'\|\|field\.key==='network\.appSyncProxy'"/, '分支渲染 SecretField（密码框 + 眼睛）');
  assert.match(modules, /已设置（点眼睛查看，或用「编辑」修改）/, 'Steam 代理卡保留「点眼睛查看 / 编辑管理」文案');
  assert.doesNotMatch(modules, /openSecretDialog/, '旧编辑弹窗入口已移除');
  assert.doesNotMatch(modules, /v-model="secretDialog\.visible"/, '旧代理编辑弹窗挂载已移除');
  assert.doesNotMatch(modules, /revealSecretInDialog/, '旧「查看当前值」入口已移除');
  const secretField = read('../frontend/src/components/SecretField.vue');
  assert.match(secretField, /ElMessageBox\.confirm/, '清除保留二次确认');
  assert.match(secretField, /清除「.*」后，该值将回落到环境变量或默认值/, '清除语义：回落 env/默认');
});

test('EK-6：申诉处理抽屉改弹窗（处理表单在弹窗内、动作放 footer）', () => {
  assert.doesNotMatch(appeals, /<el-drawer/, '申诉不再用抽屉');
  assert.match(appeals, /<el-dialog/, '申诉改用弹窗');
  assert.match(appeals, /width="min\(560px, 92vw\)"/, '弹窗宽度');
  assert.match(appeals, /resolve-actions/, '处理动作表单保留在弹窗内');
  assert.match(appeals, /提交处理/, 'footer 提交处理');
  assert.match(appeals, /复制回复内容/, 'footer 复制回复');
});

test('保留面：搜索栏 inline-form 与只读查看抽屉不受影响；后台不再有添加/编辑类抽屉', () => {
  assert.match(modules, /inline-form"><el-input v-model="wishQuery"/, '愿望单搜索栏保留');
  assert.match(modules, /inline-form"><el-input v-model="watchQuery"/, '到价提醒搜索栏保留');
  assert.match(align, /el-drawer[^>]*title="审阅记录"/, '审阅记录只读抽屉保留');
  assert.match(links, /<el-drawer/, '游戏链接只读抽屉保留');
});
