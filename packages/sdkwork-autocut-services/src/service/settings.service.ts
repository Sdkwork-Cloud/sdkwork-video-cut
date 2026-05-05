import type {
  AppSettings,
  AutoCutAccountSettings,
  AutoCutModelPreset,
  AutoCutLlmRuntimeConfig,
  AutoCutLlmSettings,
  AutoCutNotificationSettings,
  AutoCutSpeechTranscriptionSettings,
  AutoCutWorkspaceSettings,
  ModelVendor,
} from '@sdkwork/autocut-types';
import { AUTOCUT_MODEL_VENDOR_PRESETS, getAutoCutModelPreset } from '@sdkwork/autocut-types';
import { dispatchAutoCutEvent } from './events.service';
import { createAutoCutId, createAutoCutTimestamp } from './identity.service';
import { readAutoCutStorage, writeAutoCutStorage } from './storage.service';
import { randomDelay } from './timing';
import { getAutoCutNativeHostClient } from './native-host-client.service';
import { createAutoCutRuntimeScopedName, getAutoCutRuntimeEnvironment } from './runtime-environment.service';

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
    language: 'zh',
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
  },
  security: {
    twoFactorEnabled: false,
  },
  updatedAt: createAutoCutTimestamp(),
};

const transientAutoCutLlmApiKeys = new Map<string, string>();

const AUTO_CUT_LLM_SECRET_NAME = 'default';

type StoredAppSettings = Omit<Partial<AppSettings>, 'llm'> & {
  llm?: Partial<AutoCutLlmSettings>;
  speechTranscription?: Partial<AutoCutSpeechTranscriptionSettings>;
};

function readSettings() {
  const storedSettings = readAutoCutStorage<StoredAppSettings>('settings', INITIAL_SETTINGS);
  return normalizeAutoCutSettings(storedSettings);
}

function writeSettings(settings: AppSettings) {
  const safeSettings = normalizeAutoCutSettings(settings);
  writeAutoCutStorage('settings', safeSettings);
  dispatchAutoCutEvent('settingsUpdated', safeSettings);
  return safeSettings;
}

function updateSettings(updater: (settings: AppSettings) => AppSettings) {
  return writeSettings(updater(readSettings()));
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

function sanitizeAutoCutSpeechTranscriptionSettings(
  settings: Partial<AutoCutSpeechTranscriptionSettings>,
): AutoCutSpeechTranscriptionSettings {
  const executablePath = normalizeOptionalText(settings.executablePath) ?? '';
  const modelPath = normalizeOptionalText(settings.modelPath) ?? '';
  const language = normalizeOptionalText(settings.language) ?? 'auto';
  const lastProbeDiagnostics = Array.isArray(settings.lastProbeDiagnostics)
    ? settings.lastProbeDiagnostics.filter((diagnostic): diagnostic is string => typeof diagnostic === 'string')
    : undefined;

  return {
    executablePath,
    modelPath,
    language,
    configured: Boolean(executablePath && modelPath),
    ...(settings.lastTestedAt ? { lastTestedAt: settings.lastTestedAt } : {}),
    ...(typeof settings.lastProbeReady === 'boolean' ? { lastProbeReady: settings.lastProbeReady } : {}),
    ...(lastProbeDiagnostics ? { lastProbeDiagnostics } : {}),
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

function normalizeAutoCutOutputDirectory(value: string | undefined) {
  return normalizeOptionalText(value) ?? '';
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
    speechTranscription: sanitizeAutoCutSpeechTranscriptionSettings(speechTranscription),
    updatedAt: createAutoCutTimestamp(),
  }));
}

export async function resolveAutoCutSpeechTranscriptionRuntimeConfig(): Promise<AutoCutSpeechTranscriptionRuntimeConfig> {
  await randomDelay(20, 50);
  return readSettings().speechTranscription;
}

export async function testAutoCutSpeechTranscriptionToolchain() {
  await randomDelay(20, 50);
  const speechRuntimeConfig = await resolveAutoCutSpeechTranscriptionRuntimeConfig();
  if (!speechRuntimeConfig.configured) {
    throw new Error('AutoCut local speech-to-text requires both executablePath and modelPath.');
  }

  const nativeHostClient = getAutoCutNativeHostClient();
  const capabilities = await nativeHostClient.getCapabilities();
  if (!capabilities.speechTranscriptionProbeCommandReady) {
    throw new Error('AutoCut local speech-to-text test requires the Tauri desktop host.');
  }

  const probe = await nativeHostClient.probeSpeechTranscription({
    executablePath: speechRuntimeConfig.executablePath,
    modelPath: speechRuntimeConfig.modelPath,
    sourceKind: 'settings',
  });

  updateSettings((settings) => ({
    ...settings,
    speechTranscription: sanitizeAutoCutSpeechTranscriptionSettings({
      ...settings.speechTranscription,
      lastTestedAt: createAutoCutTimestamp(),
      lastProbeReady: probe.ready,
      lastProbeDiagnostics: probe.diagnostics,
    }),
    updatedAt: createAutoCutTimestamp(),
  }));

  if (!probe.ready) {
    throw new Error(probe.diagnostics[0] ?? 'AutoCut local speech-to-text toolchain is not ready.');
  }

  return probe;
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
