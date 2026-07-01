export {
  AUTOCUT_ZH_CN_MESSAGES,
  AUTOCUT_EN_US_MESSAGES,
  AUTOCUT_TASK_DETAIL_REVIEW_RISK_ZH_CN_MESSAGES,
  AUTOCUT_TASK_DETAIL_REVIEW_RISK_EN_US_MESSAGES,
} from './i18n';

export const AUTOCUT_I18N_SECTIONS = {
  settings: 'settings',
  page: 'page',
  tabs: 'tabs',
  toast: 'toast',
  status: 'status',
} as const;

export type AutoCutI18nSection = keyof typeof AUTOCUT_I18N_SECTIONS;
