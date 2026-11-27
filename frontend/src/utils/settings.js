// 邮件相关设置 key：在「邮件服务」页统一维护（docs/MAIL-CONFIG-PAGE.md），
// 系统设置页渲染时过滤掉这些字段。
export const MAIL_SETTING_KEYS = [
  'alerts.smtp.host',
  'alerts.smtp.port',
  'alerts.smtp.secure',
  'alerts.smtp.user',
  'alerts.smtp.pass',
  'alerts.smtp.from',
  'alerts.emailTo',
  'alerts.appealEmail',
];

export const isMailSettingKey = (key) => MAIL_SETTING_KEYS.includes(key);

// FY-1（docs/SETTINGS-REDESIGN.md §2/§3.1）：设置页 7 个「对象」组的 id——
// 路由校验（/console/settings/:group）、未知组回落、左导航顺序共用；组标题/图标/描述仍以服务端 schema 为准。
export const SETTINGS_GROUP_IDS = ['sources', 'site', 'access', 'alerts', 'network', 'schedule', 'ops'];
export const DEFAULT_SETTINGS_GROUP = 'sources';
export const isSettingsGroupId = (id) => SETTINGS_GROUP_IDS.includes(String(id ?? ''));

// FY-1：原「高级」组拆成「同步与调度 / 运维与存储」两组——首次初始化（/setup）仍跳过这两组，
// 保持「向导只收基础配置」的既有行为（原先跳过 group === 'advanced'）。
export const ADVANCED_SETTINGS_GROUPS = ['schedule', 'ops'];
export const isAdvancedSettingsGroup = (id) => ADVANCED_SETTINGS_GROUPS.includes(String(id ?? ''));
