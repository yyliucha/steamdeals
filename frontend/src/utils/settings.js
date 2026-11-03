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
