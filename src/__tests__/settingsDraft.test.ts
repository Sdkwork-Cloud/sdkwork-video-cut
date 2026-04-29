import { describe, expect, it } from 'vitest';

import { createDefaultSettings } from '../domain/videoCutTypes';
import {
  buildSettingsSavePayload,
  stripWriteOnlySecretFields,
} from '../services/settingsDraft';

describe('applySecretInputsToSettings', () => {
  it('builds a write-only settings payload with entered model credentials', () => {
    const settings = createDefaultSettings();

    const result = buildSettingsSavePayload(settings, {
      aiApiKey: 'sk-ai',
      speechApiKey: 'sk-stt',
    });

    expect(result.ai.apiKeyConfigured).toBe(true);
    expect(result.speechToText.apiKeyConfigured).toBe(true);
    expect(result.ai.apiKey).toBe('sk-ai');
    expect(result.speechToText.apiKey).toBe('sk-stt');

    const redacted = stripWriteOnlySecretFields(result);
    expect(redacted.ai.apiKeyConfigured).toBe(true);
    expect(redacted.speechToText.apiKeyConfigured).toBe(true);
    expect(JSON.stringify(redacted)).not.toContain('sk-ai');
    expect(JSON.stringify(redacted)).not.toContain('sk-stt');
    expect(JSON.stringify(redacted)).not.toContain('"apiKey"');
  });

  it('preserves existing configured flags when no new secret is entered', () => {
    const settings = createDefaultSettings();
    settings.ai.apiKeyConfigured = true;

    const result = buildSettingsSavePayload(settings, {
      aiApiKey: '',
      speechApiKey: '',
    });

    expect(result.ai.apiKeyConfigured).toBe(true);
    expect(result.speechToText.apiKeyConfigured).toBe(false);
    expect(result.ai).not.toHaveProperty('apiKey');
    expect(result.speechToText).not.toHaveProperty('apiKey');
  });
});
