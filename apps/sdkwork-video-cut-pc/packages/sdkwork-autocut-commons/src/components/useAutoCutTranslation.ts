import { useTranslation, type UseTranslationResponse } from 'react-i18next';

export function useAutoCutTranslation(): UseTranslationResponse<'translation', undefined> {
  return useTranslation();
}
