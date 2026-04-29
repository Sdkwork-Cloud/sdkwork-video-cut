import type { VideoCutSettings, VideoCutSettingsSavePayload } from '../domain/videoCutTypes';

export interface SettingsSecretInputs {
  aiApiKey: string;
  speechApiKey: string;
}

export function buildSettingsSavePayload(
  settings: VideoCutSettings,
  secretInputs: SettingsSecretInputs,
): VideoCutSettingsSavePayload {
  const aiApiKey = secretInputs.aiApiKey.trim();
  const speechApiKey = secretInputs.speechApiKey.trim();

  return {
    ...settings,
    ai: {
      ...settings.ai,
      ...(aiApiKey ? { apiKey: aiApiKey } : {}),
      apiKeyConfigured: settings.ai.apiKeyConfigured || aiApiKey.length > 0,
    },
    speechToText: {
      ...settings.speechToText,
      ...(speechApiKey ? { apiKey: speechApiKey } : {}),
      apiKeyConfigured: settings.speechToText.apiKeyConfigured || speechApiKey.length > 0,
    },
  };
}

export function stripWriteOnlySecretFields(settings: VideoCutSettingsSavePayload): VideoCutSettings {
  const {
    ai: { apiKey: _aiApiKey, ...ai },
    speechToText: { apiKey: _speechApiKey, ...speechToText },
    ...rest
  } = settings;

  return {
    ...rest,
    ai,
    speechToText,
  };
}

export const applySecretInputsToSettings = buildSettingsSavePayload;
