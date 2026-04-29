import type { ValidationError, ValidationResult, VideoCutSettings } from '../domain/videoCutTypes';

const speechProviderProfiles = ['openai-audio-transcriptions', 'volcengine-bigasr-flash', 'aliyun-qwen-asr'] as const;

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidHttpOrigin(value: string): boolean {
  const normalized = value.trim();
  try {
    const url = new URL(normalized);
    return (url.protocol === 'http:' || url.protocol === 'https:') && normalized === url.origin;
  } catch {
    return false;
  }
}

function isOllamaEndpoint(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.includes('ollama') || normalized.includes('localhost:11434') || normalized.includes('127.0.0.1:11434');
}

function pushRequired(errors: ValidationError[], field: string, label: string): void {
  errors.push({
    field,
    code: 'REQUIRED',
    message: `${label} is required.`,
  });
}

export function validateRuntimeSettings(settings: VideoCutSettings): ValidationResult {
  const errors: ValidationError[] = [];

  if (settings.ai.enabled) {
    if (!isValidUrl(settings.ai.baseUrl)) {
      errors.push({
        field: 'ai.baseUrl',
        code: 'INVALID_URL',
        message: 'OpenAI-compatible base URL must be a valid HTTP(S) URL.',
      });
    }

    if (isOllamaEndpoint(settings.ai.baseUrl)) {
      errors.push({
        field: 'ai.baseUrl',
        code: 'OLLAMA_NOT_ALLOWED',
        message: 'Ollama-compatible endpoints are not allowed by this product contract.',
      });
    }

    if (!settings.ai.apiKeyConfigured) {
      pushRequired(errors, 'ai.apiKey', 'AI provider API key');
    }

    if (!settings.ai.chatModel.trim()) {
      pushRequired(errors, 'ai.chatModel', 'Chat model');
    }
  }

  if (settings.speechToText.enabled && !settings.speechToText.reuseAiProviderConnection) {
    if (!isValidUrl(settings.speechToText.baseUrl)) {
      errors.push({
        field: 'speechToText.baseUrl',
        code: 'INVALID_URL',
        message: 'Transcription base URL must be a valid HTTP(S) URL.',
      });
    }

    if (isOllamaEndpoint(settings.speechToText.baseUrl)) {
      errors.push({
        field: 'speechToText.baseUrl',
        code: 'OLLAMA_NOT_ALLOWED',
        message: 'Ollama-compatible endpoints are not allowed by this product contract.',
      });
    }
  }

  if (settings.speechToText.enabled && !speechProviderProfiles.includes(settings.speechToText.providerProfile)) {
    errors.push({
      field: 'speechToText.providerProfile',
      code: 'UNSUPPORTED_PROVIDER_PROFILE',
      message: 'Speech-to-text provider profile must be one of the standard bridge profiles.',
    });
  }

  if (settings.speechToText.enabled && !settings.speechToText.transcriptionModel.trim()) {
    pushRequired(errors, 'speechToText.transcriptionModel', 'Transcription model');
  }

  if (
    settings.speechToText.enabled &&
    settings.speechToText.providerProfile === 'volcengine-bigasr-flash' &&
    !settings.speechToText.resourceId.trim()
  ) {
    pushRequired(errors, 'speechToText.resourceId', 'Volcengine BigASR Flash resource ID');
  }

  if (settings.speechToText.enabled) {
    const canReuseAiCredential =
      settings.speechToText.reuseAiProviderConnection && settings.ai.enabled && settings.ai.apiKeyConfigured;

    if (!settings.speechToText.apiKeyConfigured && !canReuseAiCredential) {
      pushRequired(errors, 'speechToText.apiKey', 'Speech-to-text API key');
    }
  }

  if (
    settings.runtime.deploymentMode !== 'desktop-local' &&
    settings.runtime.bindHost === '0.0.0.0' &&
    settings.runtime.authMode === 'none'
  ) {
    errors.push({
      field: 'runtime.authMode',
      code: 'AUTH_REQUIRED',
      message: 'Server modes that bind 0.0.0.0 must enable auth or reverse proxy protection.',
    });
  }

  for (const origin of settings.security.corsAllowedOrigins) {
    const normalizedOrigin = origin.trim();
    if (normalizedOrigin === '*') {
      errors.push({
        field: 'security.corsAllowedOrigins',
        code: 'CORS_ORIGIN_WILDCARD_NOT_ALLOWED',
        message: 'CORS origins must be explicit HTTP(S) origins; wildcard origin is not allowed.',
      });
    } else if (!isValidHttpOrigin(normalizedOrigin)) {
      errors.push({
        field: 'security.corsAllowedOrigins',
        code: 'INVALID_URL',
        message: 'CORS origins must be valid HTTP(S) origins.',
      });
    }
  }

  if (settings.mediaTools.workerConcurrency < 1) {
    errors.push({
      field: 'mediaTools.workerConcurrency',
      code: 'OUT_OF_RANGE',
      message: 'Worker concurrency must be at least 1.',
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
