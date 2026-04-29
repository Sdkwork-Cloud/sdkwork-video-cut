import { describe, expect, it } from 'vitest';

import { createDefaultSettings } from '../domain/videoCutTypes';
import { validateRuntimeSettings } from '../services/settingsValidation';

describe('validateRuntimeSettings', () => {
  it('defaults runtime settings to the canonical standalone host endpoint', () => {
    const settings = createDefaultSettings();

    expect(settings.runtime.port).toBe(6177);
    expect(settings.runtime.publicBaseUrl).toBe('http://127.0.0.1:6177');
  });

  it('accepts the default desktop-local settings', () => {
    const result = validateRuntimeSettings(createDefaultSettings());

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects wildcard and invalid CORS origins', () => {
    const settings = createDefaultSettings();
    settings.security.corsAllowedOrigins = ['https://video.example.test', '*', 'not-a-url'];

    const result = validateRuntimeSettings(settings);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'security.corsAllowedOrigins',
          code: 'CORS_ORIGIN_WILDCARD_NOT_ALLOWED',
        }),
        expect.objectContaining({
          field: 'security.corsAllowedOrigins',
          code: 'INVALID_URL',
        }),
      ]),
    );
  });

  it('rejects CORS origins that include a path, query, or fragment', () => {
    const settings = createDefaultSettings();
    settings.security.corsAllowedOrigins = ['https://video.example.test/app?tenant=demo#settings'];

    const result = validateRuntimeSettings(settings);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        field: 'security.corsAllowedOrigins',
        code: 'INVALID_URL',
      }),
    );
  });

  it('rejects an invalid OpenAI-compatible base URL when AI is enabled', () => {
    const settings = createDefaultSettings();
    settings.ai.enabled = true;
    settings.ai.baseUrl = 'not-a-url';

    const result = validateRuntimeSettings(settings);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        field: 'ai.baseUrl',
        code: 'INVALID_URL',
      }),
    );
  });

  it('rejects Ollama endpoints and missing credentials when AI is enabled', () => {
    const settings = createDefaultSettings();
    settings.ai.enabled = true;
    settings.ai.baseUrl = 'http://127.0.0.1:11434';
    settings.ai.apiKeyConfigured = false;

    const result = validateRuntimeSettings(settings);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        field: 'ai.baseUrl',
        code: 'OLLAMA_NOT_ALLOWED',
      }),
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        field: 'ai.apiKey',
        code: 'REQUIRED',
      }),
    );
  });

  it('rejects an empty chat model when AI is enabled', () => {
    const settings = createDefaultSettings();
    settings.ai.enabled = true;
    settings.ai.chatModel = ' ';

    const result = validateRuntimeSettings(settings);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        field: 'ai.chatModel',
        code: 'REQUIRED',
      }),
    );
  });

  it('rejects speech-to-text without a usable OpenAI-compatible credential path', () => {
    const settings = createDefaultSettings();
    settings.ai.enabled = false;
    settings.ai.apiKeyConfigured = false;
    settings.speechToText.enabled = true;
    settings.speechToText.reuseAiProviderConnection = true;
    settings.speechToText.apiKeyConfigured = false;

    const result = validateRuntimeSettings(settings);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        field: 'speechToText.apiKey',
        code: 'REQUIRED',
      }),
    );
  });

  it('accepts the standard Volcengine and Alibaba speech provider profiles', () => {
    const volcengine = createDefaultSettings();
    volcengine.speechToText.enabled = true;
    volcengine.speechToText.providerProfile = 'volcengine-bigasr-flash';
    volcengine.speechToText.reuseAiProviderConnection = false;
    volcengine.speechToText.baseUrl = 'https://openspeech.bytedance.com';
    volcengine.speechToText.apiKeyConfigured = true;
    volcengine.speechToText.transcriptionModel = 'bigmodel';

    const aliyun = createDefaultSettings();
    aliyun.speechToText.enabled = true;
    aliyun.speechToText.providerProfile = 'aliyun-qwen-asr';
    aliyun.speechToText.reuseAiProviderConnection = false;
    aliyun.speechToText.baseUrl = 'https://dashscope.aliyuncs.com';
    aliyun.speechToText.apiKeyConfigured = true;
    aliyun.speechToText.transcriptionModel = 'qwen3-asr-flash';

    expect(validateRuntimeSettings(volcengine).valid).toBe(true);
    expect(validateRuntimeSettings(aliyun).valid).toBe(true);
  });

  it('requires Volcengine speech provider resource id metadata', () => {
    const settings = createDefaultSettings();
    settings.speechToText.enabled = true;
    settings.speechToText.providerProfile = 'volcengine-bigasr-flash';
    settings.speechToText.reuseAiProviderConnection = false;
    settings.speechToText.baseUrl = 'https://openspeech.bytedance.com';
    settings.speechToText.apiKeyConfigured = true;
    settings.speechToText.transcriptionModel = 'bigmodel';
    (settings.speechToText as typeof settings.speechToText & { resourceId: string }).resourceId = ' ';

    const result = validateRuntimeSettings(settings);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        field: 'speechToText.resourceId',
        code: 'REQUIRED',
      }),
    );
  });

  it('rejects unknown speech provider profiles', () => {
    const settings = createDefaultSettings();
    settings.speechToText.enabled = true;
    settings.speechToText.apiKeyConfigured = true;
    settings.speechToText.providerProfile = 'vendor-private' as typeof settings.speechToText.providerProfile;

    const result = validateRuntimeSettings(settings);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        field: 'speechToText.providerProfile',
        code: 'UNSUPPORTED_PROVIDER_PROFILE',
      }),
    );
  });

  it('rejects a public server bind without authentication', () => {
    const settings = createDefaultSettings();
    settings.runtime.deploymentMode = 'server-private';
    settings.runtime.bindHost = '0.0.0.0';
    settings.runtime.authMode = 'none';

    const result = validateRuntimeSettings(settings);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        field: 'runtime.authMode',
        code: 'AUTH_REQUIRED',
      }),
    );
  });
});
