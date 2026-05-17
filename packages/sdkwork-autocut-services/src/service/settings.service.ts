import type {
  AppSettings,
  AutoCutAccountSettings,
  AutoCutAppLocale,
  AutoCutModelPreset,
  AutoCutLlmRuntimeConfig,
  AutoCutLlmSettings,
  AutoCutNotificationSettings,
  AutoCutSpeechTranscriptionProviderDefinition,
  AutoCutSpeechTranscriptionSettings,
  AutoCutWorkspaceSettings,
  ModelVendor,
} from '@sdkwork/autocut-types';
import {
  AUTOCUT_DEFAULT_SMART_SLICE_SEGMENTATION_AGENT_ID,
  AUTOCUT_DEFAULT_SPEECH_TRANSCRIPTION_PROVIDER_ID,
  AUTOCUT_MODEL_VENDOR_PRESETS,
  AUTOCUT_SPEECH_TRANSCRIPTION_LANGUAGE_OPTIONS,
  AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_EXTENSIONS,
  getAutoCutModelPreset,
  getAutoCutSmartSliceSegmentationAgentDefinition,
  getAutoCutSpeechTranscriptionProviderDefinition,
} from '@sdkwork/autocut-types';
import { dispatchAutoCutEvent } from './events.service';
import { createAutoCutId, createAutoCutTimestamp } from './identity.service';
import { readAutoCutStorage, writeAutoCutStorage } from './storage.service';
import { randomDelay } from './timing';
import { getAutoCutNativeHostClient } from './native-host-client.service';
import { createAutoCutRuntimeScopedName, getAutoCutRuntimeEnvironment } from './runtime-environment.service';
import { testAutoCutSpeechTranscriptionProvider } from './speech-transcription.service';
import { initializeAutoCutI18n, normalizeAutoCutLocale } from './i18n.service';

const INITIAL_SETTINGS: AppSettings = {
  account: {
    displayName: 'User_001',
    email: 'user_001@example.com',
  },
  workspace: {
    defaultStoragePath: '',
    outputDirectory: '',
    hardwareAcceleration: true,
    completionSound: true,
    language: 'zh-CN',
  },
  billing: {
    planName: 'Pro',
    monthlyPrice: 19,
    nextBillingDate: '2023-12-20',
    subscriptionActive: true,
    invoicesLoaded: 2,
  },
  apiKeys: [
    {
      id: 'api-production',
      name: 'Production Key',
      maskedKey: 'sk_live_*******************************************a8c',
      createdAt: '2023-10-15',
    },
  ],
  storage: {
    usedGb: 12.5,
    quotaGb: 500,
    videoGb: 10,
    documentGb: 2,
    cacheGb: 0.5,
    cachedItems: 32,
  },
  notifications: {
    taskCompleted: true,
    appUpdates: true,
    accountBilling: true,
    productAnnouncements: false,
    usageReports: true,
  },
  speechTranscription: {
    providerId: AUTOCUT_DEFAULT_SPEECH_TRANSCRIPTION_PROVIDER_ID,
    executablePath: '',
    modelPath: '',
    language: 'auto',
    configured: false,
  },
  llm: {
    modelVendor: 'deepseek',
    baseUrl: AUTOCUT_MODEL_VENDOR_PRESETS.deepseek.baseUrl,
    model: AUTOCUT_MODEL_VENDOR_PRESETS.deepseek.defaultModel,
    apiKeyConfigured: false,
    temperature: 0.2,
    maxTokens: getAutoCutModelPreset('deepseek', AUTOCUT_MODEL_VENDOR_PRESETS.deepseek.defaultModel).defaultMaxTokens,
    defaultSegmentationAgentId: AUTOCUT_DEFAULT_SMART_SLICE_SEGMENTATION_AGENT_ID,
  },
  security: {
    twoFactorEnabled: false,
  },
  updatedAt: createAutoCutTimestamp(),
};

const transientAutoCutLlmApiKeys = new Map<string, string>();

const AUTO_CUT_LLM_SECRET_NAME = 'default';

type StoredAutoCutWorkspaceSettings = Partial<Omit<AutoCutWorkspaceSettings, 'language'>> & {
  language?: string;
};

type StoredAppSettings = Omit<Partial<AppSettings>, 'llm' | 'workspace'> & {
  workspace?: StoredAutoCutWorkspaceSettings;
  llm?: Partial<AutoCutLlmSettings>;
  speechTranscription?: Partial<AutoCutSpeechTranscriptionSettings>;
};

function readSettings() {
  const storedSettings = readAutoCutStorage<StoredAppSettings>('settings', INITIAL_SETTINGS);
  const settings = normalizeAutoCutSettings(storedSettings);
  initializeAutoCutI18n(settings.workspace.language);
  return settings;
}

function writeSettings(settings: AppSettings) {
  const safeSettings = normalizeAutoCutSettings(settings);
  initializeAutoCutI18n(safeSettings.workspace.language);
  writeAutoCutStorage('settings', safeSettings);
  dispatchAutoCutEvent('settingsUpdated', safeSettings);
  return safeSettings;
}

function updateSettings(updater: (settings: AppSettings) => AppSettings) {
  return writeSettings(updater(readSettings()));
}

export function markAutoCutSpeechTranscriptionProviderTested(probe: {
  ready: boolean;
  diagnostics: string[];
}) {
  return updateSettings((settings) => ({
    ...settings,
    speechTranscription: sanitizeAutoCutSpeechTranscriptionSettings({
      ...settings.speechTranscription,
      lastTestedAt: createAutoCutTimestamp(),
      lastProbeReady: probe.ready,
      lastProbeDiagnostics: probe.diagnostics,
    }),
    updatedAt: createAutoCutTimestamp(),
  }));
}

function normalizeAutoCutSettings(settings: StoredAppSettings): AppSettings {
  return {
    ...INITIAL_SETTINGS,
    ...settings,
    account: {
      ...INITIAL_SETTINGS.account,
      ...settings.account,
    },
    workspace: {
      ...INITIAL_SETTINGS.workspace,
      ...settings.workspace,
      outputDirectory: normalizeAutoCutOutputDirectory(settings.workspace?.outputDirectory),
      language: normalizeAutoCutWorkspaceLanguage(settings.workspace?.language),
    },
    billing: {
      ...INITIAL_SETTINGS.billing,
      ...settings.billing,
    },
    apiKeys: settings.apiKeys ?? INITIAL_SETTINGS.apiKeys,
    storage: {
      ...INITIAL_SETTINGS.storage,
      ...settings.storage,
    },
    notifications: {
      ...INITIAL_SETTINGS.notifications,
      ...settings.notifications,
    },
    speechTranscription: sanitizeAutoCutSpeechTranscriptionSettings(
      settings.speechTranscription ?? INITIAL_SETTINGS.speechTranscription,
    ),
    llm: sanitizeAutoCutLlmSettings(settings.llm ?? INITIAL_SETTINGS.llm),
    security: {
      ...INITIAL_SETTINGS.security,
      ...settings.security,
    },
    updatedAt: settings.updatedAt ?? INITIAL_SETTINGS.updatedAt,
  };
}

type AutoCutSpeechTranscriptionSettingsInput = Partial<AutoCutSpeechTranscriptionSettings> & {
  previousSpeechTranscription?: AutoCutSpeechTranscriptionSettings;
};

function sanitizeAutoCutSpeechTranscriptionSettings(
  settings: AutoCutSpeechTranscriptionSettingsInput,
): AutoCutSpeechTranscriptionSettings {
  const previousSpeechTranscription = settings.previousSpeechTranscription;
  const provider = getAutoCutSpeechTranscriptionProviderDefinition(settings.providerId);
  const executablePath = provider.kind === 'local'
    ? normalizeAutoCutSpeechTranscriptionExecutablePath(settings.executablePath)
    : normalizeOptionalText(settings.executablePath) ?? '';
  const modelPath = provider.kind === 'local'
    ? normalizeAutoCutSpeechTranscriptionModelPath(settings.modelPath)
    : normalizeOptionalText(settings.modelPath) ?? '';
  const language = normalizeAutoCutSpeechTranscriptionLanguage(settings.language);
  const providerApiSettings = sanitizeAutoCutSpeechTranscriptionApiSettings(settings, provider);
  const lastProbeDiagnostics = Array.isArray(settings.lastProbeDiagnostics)
    ? settings.lastProbeDiagnostics.filter((diagnostic): diagnostic is string => typeof diagnostic === 'string')
    : undefined;
  const probeStateStillApplies = previousSpeechTranscription
    ? createAutoCutSpeechTranscriptionProbeConfigKey({
        providerId: provider.id,
        executablePath,
        modelPath,
        language,
        ...providerApiSettings,
      }) === createAutoCutSpeechTranscriptionProbeConfigKey(previousSpeechTranscription)
    : true;

  return {
    providerId: provider.id,
    executablePath,
    modelPath,
    language,
    ...providerApiSettings,
    configured: provider.kind === 'local'
      ? Boolean(executablePath && modelPath)
      : Boolean(providerApiSettings.apiKeyConfigured),
    ...(probeStateStillApplies && settings.lastTestedAt ? { lastTestedAt: settings.lastTestedAt } : {}),
    ...(probeStateStillApplies && typeof settings.lastProbeReady === 'boolean' ? { lastProbeReady: settings.lastProbeReady } : {}),
    ...(probeStateStillApplies && lastProbeDiagnostics ? { lastProbeDiagnostics } : {}),
  };
}

function createAutoCutSpeechTranscriptionProbeConfigKey(
  settings: Pick<
    AutoCutSpeechTranscriptionSettings,
    'providerId' | 'executablePath' | 'modelPath' | 'language'
  > & Partial<Pick<AutoCutSpeechTranscriptionSettings, 'modelVendor' | 'baseUrl' | 'model' | 'apiKeyConfigured'>>,
) {
  return JSON.stringify({
    providerId: settings.providerId,
    executablePath: settings.executablePath,
    modelPath: settings.modelPath,
    language: settings.language,
    modelVendor: settings.modelVendor ?? null,
    baseUrl: settings.baseUrl ?? null,
    model: settings.model ?? null,
    apiKeyConfigured: settings.apiKeyConfigured ?? null,
  });
}

function sanitizeAutoCutSpeechTranscriptionApiSettings(
  settings: Partial<AutoCutSpeechTranscriptionSettings>,
  provider: AutoCutSpeechTranscriptionProviderDefinition,
) {
  if (provider.kind !== 'api') {
    return {};
  }

  const modelVendor = isAutoCutModelVendor(settings.modelVendor)
    ? settings.modelVendor
    : provider.modelVendor ?? 'custom';
  const preset = AUTOCUT_MODEL_VENDOR_PRESETS[modelVendor];
  const baseUrl = normalizeAutoCutBaseUrl(settings.baseUrl ?? preset.baseUrl);
  const model = normalizeAutoCutModel(settings.model ?? provider.defaultModel ?? preset.defaultModel);

  return {
    modelVendor,
    baseUrl,
    model,
    apiKeyConfigured: Boolean(settings.apiKeyConfigured),
  };
}

function sanitizeAutoCutLlmSettings(settings: Partial<AutoCutLlmSettings>): AutoCutLlmSettings {
  const modelVendor = isAutoCutModelVendor(settings.modelVendor) ? settings.modelVendor : 'deepseek';
  const preset = AUTOCUT_MODEL_VENDOR_PRESETS[modelVendor];
  const baseUrl = normalizeAutoCutBaseUrl(settings.baseUrl ?? preset.baseUrl);
  const model = normalizeAutoCutModel(settings.model ?? preset.defaultModel);
  const modelPreset = getAutoCutModelPreset(modelVendor, model);
  const maskedApiKey = settings.apiKey
    ? maskAutoCutLlmApiKey(settings.apiKey)
    : normalizeOptionalText(settings.maskedApiKey);

  return {
    modelVendor,
    baseUrl,
    model,
    ...(maskedApiKey ? { maskedApiKey } : {}),
    apiKeyConfigured: Boolean(maskedApiKey || settings.apiKeyConfigured),
    temperature: normalizeAutoCutLlmTemperature(settings.temperature, modelPreset),
    maxTokens: normalizeAutoCutLlmMaxTokens(settings.maxTokens, modelPreset),
    defaultSegmentationAgentId: getAutoCutSmartSliceSegmentationAgentDefinition(
      settings.defaultSegmentationAgentId,
    ).id,
  };
}

function normalizeAutoCutLlmSaveInput(current: AutoCutLlmSettings, next: AutoCutLlmSettings): AutoCutLlmSettings {
  const modelVendor = isAutoCutModelVendor(next.modelVendor) ? next.modelVendor : current.modelVendor;
  const vendorChanged = modelVendor !== current.modelVendor;
  const preset = AUTOCUT_MODEL_VENDOR_PRESETS[modelVendor];
  const requestedBaseUrl = normalizeAutoCutBaseUrl(next.baseUrl);
  const baseUrl = vendorChanged && modelVendor !== 'custom'
    ? preset.baseUrl
    : requestedBaseUrl || preset.baseUrl;
  const requestedModel = normalizeAutoCutModel(next.model);
  const model = vendorChanged && modelVendor !== 'custom'
    ? preset.defaultModel
    : requestedModel || preset.defaultModel;
  const modelChanged = model !== current.model;
  const modelPreset = getAutoCutModelPreset(modelVendor, model);
  const maskedApiKey = next.apiKey
    ? maskAutoCutLlmApiKey(next.apiKey)
    : normalizeOptionalText(next.maskedApiKey) ?? normalizeOptionalText(current.maskedApiKey);
  const maxTokensChanged = next.maxTokens !== current.maxTokens;
  const maxTokens = (vendorChanged || modelChanged) && !maxTokensChanged
    ? modelPreset.defaultMaxTokens
    : next.maxTokens;

  return sanitizeAutoCutLlmSettings({
    modelVendor,
    baseUrl,
    model,
    ...(maskedApiKey ? { maskedApiKey } : {}),
    apiKeyConfigured: Boolean(maskedApiKey || next.apiKeyConfigured || current.apiKeyConfigured),
    temperature: next.temperature,
    maxTokens,
    defaultSegmentationAgentId: getAutoCutSmartSliceSegmentationAgentDefinition(
      next.defaultSegmentationAgentId ?? current.defaultSegmentationAgentId,
    ).id,
  });
}

async function captureTransientAutoCutLlmApiKey(llm: AutoCutLlmSettings) {
  const apiKey = normalizeOptionalText(llm.apiKey);
  if (apiKey) {
    transientAutoCutLlmApiKeys.set(getAutoCutRuntimeEnvironment(), apiKey);
    await saveAutoCutLlmSecretToNativeStore(apiKey);
  }
}

async function saveAutoCutLlmSecretToNativeStore(apiKey: string) {
  const nativeHostClient = getAutoCutNativeHostClient();
  const capabilities = await nativeHostClient.getCapabilities();
  if (!capabilities.llmSecretStoreReady) {
    return;
  }

  await nativeHostClient.saveLlmSecret({
    secretName: createAutoCutRuntimeScopedName(AUTO_CUT_LLM_SECRET_NAME),
    secretValue: apiKey,
  });
}

async function resolveAutoCutNativeLlmApiKey() {
  const runtimeEnvironment = getAutoCutRuntimeEnvironment();
  const transientApiKey = transientAutoCutLlmApiKeys.get(runtimeEnvironment);
  if (transientApiKey) {
    return transientApiKey;
  }

  const nativeHostClient = getAutoCutNativeHostClient();
  const capabilities = await nativeHostClient.getCapabilities();
  if (!capabilities.llmSecretStoreReady) {
    return undefined;
  }

  const secret = await nativeHostClient.getLlmSecret({
    secretName: createAutoCutRuntimeScopedName(AUTO_CUT_LLM_SECRET_NAME),
  });
  if (secret.configured && secret.secretValue) {
    transientAutoCutLlmApiKeys.set(runtimeEnvironment, secret.secretValue);
    return secret.secretValue;
  }

  return undefined;
}

function isAutoCutModelVendor(value: unknown): value is ModelVendor {
  return typeof value === 'string' && value in AUTOCUT_MODEL_VENDOR_PRESETS;
}

function normalizeAutoCutBaseUrl(baseUrl: string | undefined) {
  const value = baseUrl?.trim().replace(/\/+$/u, '') ?? '';
  if (!value) {
    return '';
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return '';
    }
    return parsed.toString().replace(/\/+$/u, '');
  } catch {
    return '';
  }
}

function normalizeAutoCutModel(model: string | undefined) {
  return model?.trim() ?? '';
}

function normalizeOptionalText(value: string | undefined) {
  const normalized = value?.trim();
  return normalized || undefined;
}

function normalizeAutoCutSpeechTranscriptionLanguage(value: string | undefined) {
  const normalized = normalizeOptionalText(value) ?? 'auto';
  const sanitized = normalized
    .replace(/_/gu, '-')
    .split('-')
    .map((part, index) => index === 0 ? part.toLowerCase() : part.toUpperCase())
    .join('-');
  const supportedValues = new Set<string>(
    AUTOCUT_SPEECH_TRANSCRIPTION_LANGUAGE_OPTIONS.map((option) => option.value),
  );
  if (supportedValues.has(sanitized)) {
    return sanitized;
  }

  return /^[a-z]{2,3}(?:-[A-Z0-9]{2,8}){0,2}$/u.test(sanitized) ? sanitized : 'auto';
}

function normalizeAutoCutSpeechTranscriptionModelPath(value: string | undefined) {
  const modelPath = normalizeOptionalText(value) ?? '';
  if (!modelPath) {
    return '';
  }

  assertAutoCutAbsoluteLocalModelFilePath(modelPath);
  assertAutoCutSupportedSpeechModelExtension(modelPath);
  return modelPath;
}

function normalizeAutoCutSpeechTranscriptionExecutablePath(value: string | undefined) {
  const executablePath = normalizeOptionalText(value) ?? '';
  if (!executablePath) {
    return '';
  }

  assertAutoCutAbsoluteLocalExecutableFilePath(executablePath);
  return executablePath;
}

function assertAutoCutAbsoluteLocalExecutableFilePath(executablePath: string) {
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(executablePath)) {
    throw new Error('AutoCut local speech-to-text executablePath must be an absolute local executable file path, not a URL.');
  }
  if (executablePath.endsWith('/') || executablePath.endsWith('\\')) {
    throw new Error('AutoCut local speech-to-text executablePath must be an absolute local executable file path, not a directory.');
  }
  const isWindowsAbsolute = /^[a-z]:[\\/]/iu.test(executablePath) || /^\\\\[^\\/]+[\\/][^\\/]+/u.test(executablePath);
  const isPosixAbsolute = executablePath.startsWith('/');
  if (!isWindowsAbsolute && !isPosixAbsolute) {
    throw new Error('AutoCut local speech-to-text executablePath must be an absolute local executable file path.');
  }
}

function assertAutoCutAbsoluteLocalModelFilePath(modelPath: string) {
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(modelPath)) {
    throw new Error('AutoCut local speech-to-text modelPath must be an absolute local model file path, not a URL.');
  }
  if (modelPath.endsWith('/') || modelPath.endsWith('\\')) {
    throw new Error('AutoCut local speech-to-text modelPath must be an absolute local model file path, not a directory.');
  }
  const isWindowsAbsolute = /^[a-z]:[\\/]/iu.test(modelPath) || /^\\\\[^\\/]+[\\/][^\\/]+/u.test(modelPath);
  const isPosixAbsolute = modelPath.startsWith('/');
  if (!isWindowsAbsolute && !isPosixAbsolute) {
    throw new Error('AutoCut local speech-to-text modelPath must be an absolute local model file path.');
  }
}

function assertAutoCutSupportedSpeechModelExtension(modelPath: string) {
  const normalized = modelPath.toLowerCase();
  const hasSupportedExtension = AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_EXTENSIONS.some((extension) =>
    normalized.endsWith(extension),
  );
  if (!hasSupportedExtension) {
    throw new Error(
      `AutoCut local speech-to-text modelPath must use a supported model file extension: ${AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_EXTENSIONS.join(', ')}.`,
    );
  }
}

function normalizeAutoCutOutputDirectory(value: string | undefined) {
  return normalizeOptionalText(value) ?? '';
}

function normalizeAutoCutWorkspaceLanguage(value: string | undefined): AutoCutAppLocale {
  return normalizeAutoCutLocale(value);
}

function clampAutoCutNumber(value: number | undefined, min: number, max: number, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function normalizeAutoCutLlmTemperature(value: number | undefined, modelPreset: AutoCutModelPreset) {
  return clampAutoCutNumber(
    value,
    modelPreset.temperature.min,
    modelPreset.temperature.max,
    modelPreset.temperature.default,
  );
}

function normalizeAutoCutLlmMaxTokens(value: number | undefined, modelPreset: AutoCutModelPreset) {
  return Math.round(clampAutoCutNumber(
    value,
    modelPreset.minOutputTokens,
    modelPreset.maxOutputTokens,
    modelPreset.defaultMaxTokens,
  ));
}

function maskAutoCutLlmApiKey(apiKey: string) {
  const normalized = apiKey.trim();
  if (normalized.length <= 8) {
    return normalized.replace(/.(?=.{2})/gu, '*');
  }
  return `${normalized.slice(0, 5)}*************${normalized.slice(-4)}`;
}

export async function getAutoCutSettings(): Promise<AppSettings> {
  await randomDelay(20, 50);
  return readSettings();
}

export async function saveAutoCutAccountSettings(account: AutoCutAccountSettings): Promise<AppSettings> {
  await randomDelay(80, 140);
  return updateSettings((settings) => ({
    ...settings,
    account,
    updatedAt: createAutoCutTimestamp(),
  }));
}

export async function saveAutoCutWorkspaceSettings(workspace: AutoCutWorkspaceSettings): Promise<AppSettings> {
  await randomDelay(80, 140);
  return updateSettings((settings) => ({
    ...settings,
    workspace: {
      ...settings.workspace,
      ...workspace,
      outputDirectory: normalizeAutoCutOutputDirectory(workspace.outputDirectory),
      language: normalizeAutoCutWorkspaceLanguage(workspace.language),
    },
    updatedAt: createAutoCutTimestamp(),
  }));
}

export async function resolveAutoCutOutputRootDir(): Promise<string | undefined> {
  await randomDelay(20, 50);
  return normalizeOptionalText(readSettings().workspace.outputDirectory);
}

export async function saveAutoCutNotificationSettings(
  notifications: AutoCutNotificationSettings,
): Promise<AppSettings> {
  await randomDelay(80, 140);
  return updateSettings((settings) => ({
    ...settings,
    notifications,
    updatedAt: createAutoCutTimestamp(),
  }));
}

export interface AutoCutSpeechTranscriptionRuntimeConfig extends AutoCutSpeechTranscriptionSettings {}

export async function saveAutoCutSpeechTranscriptionSettings(
  speechTranscription: AutoCutSpeechTranscriptionSettings,
): Promise<AppSettings> {
  await randomDelay(80, 140);
  return updateSettings((settings) => ({
    ...settings,
    speechTranscription: sanitizeAutoCutSpeechTranscriptionSettings({
      ...speechTranscription,
      previousSpeechTranscription: settings.speechTranscription,
    }),
    updatedAt: createAutoCutTimestamp(),
  }));
}

export async function resolveAutoCutSpeechTranscriptionRuntimeConfig(): Promise<AutoCutSpeechTranscriptionRuntimeConfig> {
  await randomDelay(20, 50);
  return readSettings().speechTranscription;
}

export async function testAutoCutSpeechTranscriptionToolchain() {
  return testAutoCutSpeechTranscriptionProvider();
}

export async function saveAutoCutLlmSettings(llm: AutoCutLlmSettings): Promise<AppSettings> {
  await randomDelay(80, 140);
  await captureTransientAutoCutLlmApiKey(llm);
  return updateSettings((settings) => ({
    ...settings,
    llm: normalizeAutoCutLlmSaveInput(settings.llm, llm),
    updatedAt: createAutoCutTimestamp(),
  }));
}

export async function initializeAutoCutDefaultLlmSettingsFromEnvironment(): Promise<AppSettings | null> {
  await randomDelay(20, 50);
  const settings = readSettings();
  if (settings.llm.apiKeyConfigured) {
    if (settings.llm.modelVendor === 'deepseek') {
      await resolveAutoCutNativeLlmApiKey();
    }
    return null;
  }

  const apiKey = await resolveAutoCutNativeLlmApiKey();
  if (!apiKey) {
    return null;
  }

  return saveAutoCutLlmSettings({
    ...settings.llm,
    modelVendor: 'deepseek',
    baseUrl: AUTOCUT_MODEL_VENDOR_PRESETS.deepseek.baseUrl,
    model: AUTOCUT_MODEL_VENDOR_PRESETS.deepseek.defaultModel,
    apiKey,
  });
}

export async function resolveAutoCutLlmRuntimeConfig(): Promise<AutoCutLlmRuntimeConfig> {
  await randomDelay(20, 50);
  const settings = readSettings();
  const sessionApiKey = await resolveAutoCutNativeLlmApiKey();
  return {
    modelVendor: settings.llm.modelVendor,
    baseUrl: settings.llm.baseUrl,
    model: settings.llm.model,
    apiKeyConfigured: settings.llm.apiKeyConfigured,
    ...(sessionApiKey ? { sessionApiKey } : {}),
    temperature: settings.llm.temperature,
    maxTokens: settings.llm.maxTokens,
    defaultSegmentationAgentId: settings.llm.defaultSegmentationAgentId,
    requestFormat: 'openai-chat-completions',
    chatCompletionsPath: '/chat/completions',
  };
}

export async function clearAutoCutLlmApiKey(): Promise<AppSettings> {
  await randomDelay(80, 140);
  transientAutoCutLlmApiKeys.delete(getAutoCutRuntimeEnvironment());
  const nativeHostClient = getAutoCutNativeHostClient();
  const capabilities = await nativeHostClient.getCapabilities();
  if (capabilities.llmSecretStoreReady) {
    await nativeHostClient.deleteLlmSecret({
      secretName: createAutoCutRuntimeScopedName(AUTO_CUT_LLM_SECRET_NAME),
    });
  }

  return updateSettings((settings) => ({
    ...settings,
    llm: sanitizeAutoCutLlmSettings({
      modelVendor: settings.llm.modelVendor,
      baseUrl: settings.llm.baseUrl,
      model: settings.llm.model,
      apiKeyConfigured: false,
      temperature: settings.llm.temperature,
      maxTokens: settings.llm.maxTokens,
      defaultSegmentationAgentId: settings.llm.defaultSegmentationAgentId,
    }),
    updatedAt: createAutoCutTimestamp(),
  }));
}

export function clearTransientAutoCutLlmApiKeyForTest() {
  transientAutoCutLlmApiKeys.clear();
}

export async function createAutoCutApiKey(name = 'Production Key'): Promise<AppSettings> {
  await randomDelay(120, 220);
  const suffix = createAutoCutId('key').slice(-3);
  return updateSettings((settings) => ({
    ...settings,
    apiKeys: [
      {
        id: createAutoCutId('api-key'),
        name,
        maskedKey: `sk_live_*******************************************${suffix}`,
        createdAt: createAutoCutTimestamp(),
      },
      ...settings.apiKeys,
    ],
    updatedAt: createAutoCutTimestamp(),
  }));
}

export async function revokeAutoCutApiKey(apiKeyId: string): Promise<AppSettings> {
  await randomDelay(80, 160);
  return updateSettings((settings) => ({
    ...settings,
    apiKeys: settings.apiKeys.map((apiKey) =>
      apiKey.id === apiKeyId ? { ...apiKey, revokedAt: createAutoCutTimestamp() } : apiKey,
    ),
    updatedAt: createAutoCutTimestamp(),
  }));
}

export async function clearAutoCutStorageCache(): Promise<AppSettings> {
  await randomDelay(150, 240);
  return updateSettings((settings) => ({
    ...settings,
    storage: {
      ...settings.storage,
      usedGb: Math.max(0, settings.storage.usedGb - settings.storage.cacheGb),
      cacheGb: 0,
      cachedItems: 0,
    },
    updatedAt: createAutoCutTimestamp(),
  }));
}

export async function loadMoreAutoCutInvoices(): Promise<AppSettings> {
  await randomDelay(100, 180);
  return updateSettings((settings) => ({
    ...settings,
    billing: {
      ...settings.billing,
      invoicesLoaded: settings.billing.invoicesLoaded + 2,
    },
    updatedAt: createAutoCutTimestamp(),
  }));
}

export async function requestAutoCutAvatarChange(): Promise<AppSettings> {
  await randomDelay(80, 140);
  return updateSettings((settings) => ({
    ...settings,
    account: {
      ...settings.account,
      avatarChangeRequestedAt: createAutoCutTimestamp(),
    },
    updatedAt: createAutoCutTimestamp(),
  }));
}

export async function openAutoCutSubscriptionManagement(): Promise<AppSettings> {
  await randomDelay(80, 140);
  return updateSettings((settings) => ({
    ...settings,
    billing: {
      ...settings.billing,
      subscriptionManagementOpenedAt: createAutoCutTimestamp(),
    },
    updatedAt: createAutoCutTimestamp(),
  }));
}

export async function requestAutoCutPasswordChange(): Promise<AppSettings> {
  await randomDelay(80, 140);
  return updateSettings((settings) => ({
    ...settings,
    security: {
      ...settings.security,
      passwordChangeRequestedAt: createAutoCutTimestamp(),
    },
    updatedAt: createAutoCutTimestamp(),
  }));
}

export async function setAutoCutTwoFactorEnabled(enabled: boolean): Promise<AppSettings> {
  await randomDelay(80, 140);
  return updateSettings((settings) => ({
    ...settings,
    security: {
      ...settings.security,
      twoFactorEnabled: enabled,
    },
    updatedAt: createAutoCutTimestamp(),
  }));
}

export async function revokeAutoCutSessions(): Promise<AppSettings> {
  await randomDelay(120, 200);
  return updateSettings((settings) => ({
    ...settings,
    security: {
      ...settings.security,
      sessionsRevokedAt: createAutoCutTimestamp(),
    },
    updatedAt: createAutoCutTimestamp(),
  }));
}

export async function cancelAutoCutSubscription(): Promise<AppSettings> {
  await randomDelay(120, 200);
  return updateSettings((settings) => ({
    ...settings,
    billing: {
      ...settings.billing,
      subscriptionActive: false,
    },
    updatedAt: createAutoCutTimestamp(),
  }));
}

export async function deleteAutoCutAccount(): Promise<AppSettings> {
  await randomDelay(120, 200);
  return updateSettings((settings) => ({
    ...settings,
    security: {
      ...settings.security,
      accountDeletedAt: createAutoCutTimestamp(),
    },
    updatedAt: createAutoCutTimestamp(),
  }));
}
