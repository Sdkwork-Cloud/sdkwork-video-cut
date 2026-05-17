import { useMemo } from 'react';
import { useAutoCutTranslation } from './useAutoCutTranslation';

export function useAutoCutCommonLabels() {
  const { t, i18n } = useAutoCutTranslation();

  return useMemo(() => ({
    fileUpload: {
      dropReady: t('common.fileUpload.dropReady'),
      dropActive: t('common.fileUpload.dropActive'),
      unknownFormat: t('common.fileUpload.unknownFormat'),
      maxSizePrefix: t('common.fileUpload.maxSizePrefix'),
      sizeTooLarge: (maxSizeMB: number) => t('common.fileUpload.sizeTooLarge', { maxSizeMB }),
      typeMismatch: (accept: string) => t('common.fileUpload.typeMismatch', { accept }),
    },
    taskFailure: {
      fallbackErrorMessage: t('common.taskFailure.fallbackErrorMessage'),
      title: t('common.taskFailure.title'),
      copyError: t('common.taskFailure.copyError'),
      copied: t('common.taskFailure.copied'),
      copyErrorMessage: t('common.taskFailure.copyErrorMessage'),
      copiedErrorMessage: t('common.taskFailure.copiedErrorMessage'),
      retry: t('common.taskFailure.retry'),
      diagnosticsSummary: t('common.taskFailure.diagnosticsSummary'),
    },
  }), [i18n.language, t]);
}
