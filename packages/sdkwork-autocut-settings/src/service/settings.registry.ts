import type { AutoCutAppLocale } from '@sdkwork/autocut-types';

export type AutoCutSettingsTabId =
  | 'speech'
  | 'account'
  | 'workspace'
  | 'billing'
  | 'api'
  | 'llm'
  | 'storage'
  | 'notifications'
  | 'security';

export type AutoCutSettingsIconId =
  | 'bell'
  | 'brain'
  | 'credit-card'
  | 'database'
  | 'key'
  | 'monitor'
  | 'shield'
  | 'user';

export interface AutoCutSettingsTabDefinition {
  id: AutoCutSettingsTabId;
  icon: AutoCutSettingsIconId;
  labelKey: string;
  descriptionKey: string;
}

export interface AutoCutSettingsLocaleOption {
  value: AutoCutAppLocale;
  labelKey: string;
  descriptionKey: string;
}

export const AUTOCUT_SETTINGS_TABS = [
  {
    id: 'speech',
    icon: 'monitor',
    labelKey: 'settings.tabs.speech.label',
    descriptionKey: 'settings.tabs.speech.description',
  },
  {
    id: 'account',
    icon: 'user',
    labelKey: 'settings.tabs.account.label',
    descriptionKey: 'settings.tabs.account.description',
  },
  {
    id: 'workspace',
    icon: 'monitor',
    labelKey: 'settings.tabs.workspace.label',
    descriptionKey: 'settings.tabs.workspace.description',
  },
  {
    id: 'billing',
    icon: 'credit-card',
    labelKey: 'settings.tabs.billing.label',
    descriptionKey: 'settings.tabs.billing.description',
  },
  {
    id: 'api',
    icon: 'key',
    labelKey: 'settings.tabs.api.label',
    descriptionKey: 'settings.tabs.api.description',
  },
  {
    id: 'llm',
    icon: 'brain',
    labelKey: 'settings.tabs.llm.label',
    descriptionKey: 'settings.tabs.llm.description',
  },
  {
    id: 'storage',
    icon: 'database',
    labelKey: 'settings.tabs.storage.label',
    descriptionKey: 'settings.tabs.storage.description',
  },
  {
    id: 'notifications',
    icon: 'bell',
    labelKey: 'settings.tabs.notifications.label',
    descriptionKey: 'settings.tabs.notifications.description',
  },
  {
    id: 'security',
    icon: 'shield',
    labelKey: 'settings.tabs.security.label',
    descriptionKey: 'settings.tabs.security.description',
  },
] as const satisfies readonly [AutoCutSettingsTabDefinition, ...AutoCutSettingsTabDefinition[]];

export const AUTOCUT_SETTINGS_LOCALE_OPTIONS: readonly AutoCutSettingsLocaleOption[] = [
  {
    value: 'zh-CN',
    labelKey: 'settings.locale.zhCN.label',
    descriptionKey: 'settings.locale.zhCN.description',
  },
  {
    value: 'en-US',
    labelKey: 'settings.locale.enUS.label',
    descriptionKey: 'settings.locale.enUS.description',
  },
] as const;

export function isAutoCutSettingsTabId(value: string | null | undefined): value is AutoCutSettingsTabId {
  return AUTOCUT_SETTINGS_TABS.some((tab) => tab.id === value);
}
