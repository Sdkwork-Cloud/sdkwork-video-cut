import i18next, { type i18n, type Resource, type TOptions } from 'i18next';
import { AUTOCUT_APP_LOCALES, type AutoCutAppLocale, type TaskType } from '@sdkwork/autocut-types';
import { AUTOCUT_EN_US_MESSAGES, AUTOCUT_ZH_CN_MESSAGES } from './i18n-resources.service';

export const AUTOCUT_LOCALES = AUTOCUT_APP_LOCALES;
export type AutoCutLocale = AutoCutAppLocale;

export const AUTOCUT_I18N_DEFAULT_LOCALE: AutoCutLocale = 'zh-CN';
export const AUTOCUT_I18N_NAMESPACE = 'translation';

export const AUTOCUT_I18N_RESOURCES = {
  'zh-CN': {
    [AUTOCUT_I18N_NAMESPACE]: AUTOCUT_ZH_CN_MESSAGES,
  },
  'en-US': {
    [AUTOCUT_I18N_NAMESPACE]: AUTOCUT_EN_US_MESSAGES,
  },
} satisfies Resource;

const autocutI18n = i18next.createInstance();
let activeAutoCutLocale: AutoCutLocale = AUTOCUT_I18N_DEFAULT_LOCALE;

export function normalizeAutoCutLocale(locale: string | null | undefined): AutoCutLocale {
  const normalizedLocale = locale?.trim().replace(/_/gu, '-');

  switch (normalizedLocale) {
    case 'zh':
    case 'zh-Hans':
    case 'zh-CN':
      return 'zh-CN';
    case 'en':
    case 'en-US':
      return 'en-US';
    default:
      return AUTOCUT_LOCALES.includes(normalizedLocale as AutoCutLocale)
        ? normalizedLocale as AutoCutLocale
        : AUTOCUT_I18N_DEFAULT_LOCALE;
  }
}

export function initializeAutoCutI18n(locale: string | null | undefined = AUTOCUT_I18N_DEFAULT_LOCALE): i18n {
  const language = normalizeAutoCutLocale(locale);
  activeAutoCutLocale = language;
  if (autocutI18n.isInitialized) {
    void autocutI18n.changeLanguage(language);
    return autocutI18n;
  }

  void autocutI18n.init({
    resources: AUTOCUT_I18N_RESOURCES,
    lng: language,
    fallbackLng: AUTOCUT_I18N_DEFAULT_LOCALE,
    supportedLngs: [...AUTOCUT_LOCALES],
    interpolation: {
      escapeValue: false,
    },
    initAsync: false,
  });

  return autocutI18n;
}

export function getAutoCutI18n(): i18n {
  return initializeAutoCutI18n(activeAutoCutLocale);
}

export function createAutoCutTaskTypeI18nKey(taskType: TaskType) {
  return `task.type.${taskType}`;
}

export function getAutoCutI18nText(
  key: string,
  locale?: string | null,
  defaultValue?: string,
  options?: TOptions,
) {
  const i18n = getAutoCutI18n();
  return i18n.t(key, {
    ...options,
    lng: locale ? normalizeAutoCutLocale(locale) : undefined,
    defaultValue: defaultValue ?? key,
  });
}

export function getAutoCutTaskTypeLabel(taskType: TaskType, locale?: string | null) {
  return getAutoCutI18nText(createAutoCutTaskTypeI18nKey(taskType), locale, taskType);
}

initializeAutoCutI18n();
