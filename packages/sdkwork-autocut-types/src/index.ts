// Base Models
export interface AppConfig {
  appName: string;
  version: string;
}

// ========================
// Settings Models
// ========================
export interface AutoCutAccountSettings {
  displayName: string;
  email: string;
  avatarChangeRequestedAt?: string;
}

export const AUTOCUT_APP_LOCALES = ['zh-CN', 'en-US'] as const;
export type AutoCutAppLocale = typeof AUTOCUT_APP_LOCALES[number];

export interface AutoCutWorkspaceSettings {
  defaultStoragePath: string;
  outputDirectory: string;
  hardwareAcceleration: boolean;
  completionSound: boolean;
  language: AutoCutAppLocale;
}

export interface AutoCutBillingSettings {
  planName: string;
  monthlyPrice: number;
  nextBillingDate: string;
  subscriptionActive: boolean;
  invoicesLoaded: number;
  subscriptionManagementOpenedAt?: string;
}

export interface AutoCutApiKeySettings {
  id: string;
  name: string;
  maskedKey: string;
  createdAt: string;
  revokedAt?: string;
}

export interface AutoCutStorageSettings {
  usedGb: number;
  quotaGb: number;
  videoGb: number;
  documentGb: number;
  cacheGb: number;
  cachedItems: number;
}

export interface AutoCutNotificationSettings {
  taskCompleted: boolean;
  appUpdates: boolean;
  accountBilling: boolean;
  productAnnouncements: boolean;
  usageReports: boolean;
}

export const AUTOCUT_SPEECH_TRANSCRIPTION_LANGUAGE_OPTIONS = [
  { value: 'auto', label: 'Auto detect' },
  { value: 'zh', label: 'Chinese' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'es', label: 'Spanish' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'it', label: 'Italian' },
  { value: 'ru', label: 'Russian' },
  { value: 'ar', label: 'Arabic' },
  { value: 'hi', label: 'Hindi' },
] as const;

export const AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_EXTENSIONS = [
  '.bin',
  '.gguf',
  '.onnx',
  '.pt',
  '.safetensors',
] as const;

export interface AutoCutLocalSpeechTranscriptionModelPreset {
  id: string;
  providerId: AutoCutSpeechTranscriptionProviderId;
  engine: AutoCutSpeechTranscriptionLocalEngine;
  label: string;
  fileName: string;
  url: string;
  mirrorUrls?: readonly string[];
  sha256: string;
  sizeLabel: string;
  minimumByteSize: number;
  qualityLabel: string;
  speedLabel: string;
  languageScope: string;
  recommended?: boolean;
}

export type AutoCutLocalSpeechTranscriptionExecutablePlatform =
  | 'windows-x86_64'
  | 'linux-x86_64'
  | 'macos-x86_64'
  | 'macos-aarch64';

export const AUTOCUT_LOCAL_SPEECH_TRANSCRIPTION_EXECUTABLE_PLATFORMS = [
  'windows-x86_64',
  'linux-x86_64',
  'macos-x86_64',
  'macos-aarch64',
] as const satisfies readonly AutoCutLocalSpeechTranscriptionExecutablePlatform[];

export const AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER = {
  localWhisperCli: 'local-whisper-cli',
  openAiTranscription: 'openai-transcription',
  qwenTranscription: 'qwen-transcription',
  geminiTranscription: 'gemini-transcription',
  customOpenAiCompatibleTranscription: 'custom-openai-compatible-transcription',
} as const;

export type AutoCutSpeechTranscriptionProviderId =
  typeof AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER[keyof typeof AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER];

export type AutoCutSpeechTranscriptionProviderKind = 'local' | 'api';

export type AutoCutSpeechTranscriptionLocalEngine = 'whisper-cli';

export const AUTOCUT_LOCAL_SPEECH_TRANSCRIPTION_MODEL_PRESETS = [
  {
    id: 'whisper-cpp-large-v3-turbo-q5',
    providerId: AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER.localWhisperCli,
    engine: 'whisper-cli',
    label: 'Whisper large-v3-turbo Q5',
    fileName: 'ggml-large-v3-turbo-q5_0.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin',
    mirrorUrls: [
      'https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin',
    ],
    sha256: 'edb2095566f2da8d5a5e8a14438ccd70a713fe75a3ec5f0899c47d22338755d4',
    sizeLabel: '547 MiB',
    minimumByteSize: 512 * 1024 * 1024,
    qualityLabel: 'High multilingual accuracy',
    speedLabel: 'Balanced local CPU/GPU throughput',
    languageScope: 'Multilingual',
    recommended: true,
  },
  {
    id: 'whisper-cpp-large-v3-turbo',
    providerId: AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER.localWhisperCli,
    engine: 'whisper-cli',
    label: 'Whisper large-v3-turbo',
    fileName: 'ggml-large-v3-turbo.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin',
    mirrorUrls: [
      'https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin',
    ],
    sha256: '4af2b29d7ec73d781377bfd1758ca957a807e941eaa98bcd26bb9cecc10c2a71',
    sizeLabel: '1.6 GB',
    minimumByteSize: 1536 * 1024 * 1024,
    qualityLabel: 'Highest local Whisper turbo accuracy',
    speedLabel: 'Heavier local runtime',
    languageScope: 'Multilingual',
    recommended: false,
  },
  {
    id: 'whisper-cpp-medium-q5',
    providerId: AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER.localWhisperCli,
    engine: 'whisper-cli',
    label: 'Whisper medium Q5',
    fileName: 'ggml-medium-q5_0.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium-q5_0.bin',
    mirrorUrls: [
      'https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-medium-q5_0.bin',
    ],
    sha256: '2b946f41d4493450e3cfee8b911e6bd5359f00cf84a7dc37b4c81a8c8d301d1a',
    sizeLabel: '540 MB',
    minimumByteSize: 512 * 1024 * 1024,
    qualityLabel: 'Practical multilingual accuracy',
    speedLabel: 'Faster lower-memory local runtime',
    languageScope: 'Multilingual',
    recommended: false,
  },
] as const satisfies readonly AutoCutLocalSpeechTranscriptionModelPreset[];

export const AUTOCUT_DEFAULT_LOCAL_SPEECH_TRANSCRIPTION_MODEL_PRESET_ID =
  'whisper-cpp-large-v3-turbo-q5' as const;

export interface AutoCutSpeechTranscriptionProviderCapabilities {
  requiresExecutablePath: boolean;
  requiresModelPath: boolean;
  usesNativeAssetTranscription: boolean;
  usesModelVendorRuntime: boolean;
  supportsTimestamps: true;
  supportsSegments: true;
}

export interface AutoCutSpeechTranscriptionProviderDefinition {
  id: AutoCutSpeechTranscriptionProviderId;
  kind: AutoCutSpeechTranscriptionProviderKind;
  engine: AutoCutSpeechTranscriptionLocalEngine | 'model-vendor-api';
  nameKey: string;
  descriptionKey: string;
  defaultName: string;
  defaultDescription: string;
  modelVendor?: ModelVendor;
  defaultModel?: string;
  capabilities: AutoCutSpeechTranscriptionProviderCapabilities;
}

const AUTOCUT_LOCAL_SPEECH_TRANSCRIPTION_CAPABILITIES = {
  requiresExecutablePath: true,
  requiresModelPath: true,
  usesNativeAssetTranscription: true,
  usesModelVendorRuntime: false,
  supportsTimestamps: true,
  supportsSegments: true,
} as const satisfies AutoCutSpeechTranscriptionProviderCapabilities;

const AUTOCUT_API_SPEECH_TRANSCRIPTION_CAPABILITIES = {
  requiresExecutablePath: false,
  requiresModelPath: false,
  usesNativeAssetTranscription: false,
  usesModelVendorRuntime: true,
  supportsTimestamps: true,
  supportsSegments: true,
} as const satisfies AutoCutSpeechTranscriptionProviderCapabilities;

export const AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER_DEFINITIONS = [
  {
    id: AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER.localWhisperCli,
    kind: 'local',
    engine: 'whisper-cli',
    nameKey: 'speechTranscription.provider.localWhisperCli.name',
    descriptionKey: 'speechTranscription.provider.localWhisperCli.description',
    defaultName: 'Local Whisper CLI',
    defaultDescription: 'Run a local Whisper-compatible command line tool through the desktop native host.',
    capabilities: AUTOCUT_LOCAL_SPEECH_TRANSCRIPTION_CAPABILITIES,
  },
  {
    id: AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER.openAiTranscription,
    kind: 'api',
    engine: 'model-vendor-api',
    nameKey: 'speechTranscription.provider.openAiTranscription.name',
    descriptionKey: 'speechTranscription.provider.openAiTranscription.description',
    defaultName: 'OpenAI transcription API',
    defaultDescription: 'Use the configured OpenAI Model Vendor credentials through the STT provider bridge.',
    modelVendor: 'openai',
    defaultModel: 'gpt-4o-transcribe',
    capabilities: AUTOCUT_API_SPEECH_TRANSCRIPTION_CAPABILITIES,
  },
  {
    id: AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER.qwenTranscription,
    kind: 'api',
    engine: 'model-vendor-api',
    nameKey: 'speechTranscription.provider.qwenTranscription.name',
    descriptionKey: 'speechTranscription.provider.qwenTranscription.description',
    defaultName: 'Qwen transcription API',
    defaultDescription: 'Use the configured Qwen Model Vendor credentials through the STT provider bridge.',
    modelVendor: 'qwen',
    defaultModel: 'qwen-audio-asr',
    capabilities: AUTOCUT_API_SPEECH_TRANSCRIPTION_CAPABILITIES,
  },
  {
    id: AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER.geminiTranscription,
    kind: 'api',
    engine: 'model-vendor-api',
    nameKey: 'speechTranscription.provider.geminiTranscription.name',
    descriptionKey: 'speechTranscription.provider.geminiTranscription.description',
    defaultName: 'Gemini transcription API',
    defaultDescription: 'Use the configured Gemini Model Vendor credentials through the STT provider bridge.',
    modelVendor: 'gemini',
    defaultModel: 'gemini-3-flash-preview',
    capabilities: AUTOCUT_API_SPEECH_TRANSCRIPTION_CAPABILITIES,
  },
  {
    id: AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER.customOpenAiCompatibleTranscription,
    kind: 'api',
    engine: 'model-vendor-api',
    nameKey: 'speechTranscription.provider.customOpenAiCompatibleTranscription.name',
    descriptionKey: 'speechTranscription.provider.customOpenAiCompatibleTranscription.description',
    defaultName: 'Custom OpenAI-compatible transcription API',
    defaultDescription: 'Use a custom OpenAI-compatible transcription endpoint through the STT provider bridge.',
    modelVendor: 'custom',
    capabilities: AUTOCUT_API_SPEECH_TRANSCRIPTION_CAPABILITIES,
  },
] as const satisfies readonly AutoCutSpeechTranscriptionProviderDefinition[];

export const AUTOCUT_DEFAULT_SPEECH_TRANSCRIPTION_PROVIDER_ID: AutoCutSpeechTranscriptionProviderId =
  AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER.localWhisperCli;

export function getAutoCutSpeechTranscriptionProviderDefinition(
  providerId: string | undefined,
): AutoCutSpeechTranscriptionProviderDefinition {
  return AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER_DEFINITIONS.find((provider) => provider.id === providerId) ??
    AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER_DEFINITIONS[0];
}

export interface AutoCutSpeechTranscriptionSettings {
  providerId: AutoCutSpeechTranscriptionProviderId;
  executablePath: string;
  modelPath: string;
  language: 'auto' | 'zh' | 'en' | string;
  modelVendor?: ModelVendor;
  baseUrl?: string;
  model?: string;
  apiKeyConfigured?: boolean;
  configured: boolean;
  lastTestedAt?: string;
  lastProbeReady?: boolean;
  lastProbeDiagnostics?: string[];
}

export const AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS = {
  ready: 'ready',
  needsExecutable: 'needs-executable',
  needsModel: 'needs-model',
  needsTest: 'needs-test',
  downloading: 'downloading',
  unsupported: 'unsupported',
  failed: 'failed',
} as const;

export type AutoCutLocalSpeechTranscriptionSetupReadiness =
  typeof AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS[keyof typeof AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS];

export const AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_NEXT_ACTION = {
  none: 'none',
  initialize: 'initialize',
  selectExecutable: 'select-executable',
  downloadModel: 'download-model',
  testProvider: 'test-provider',
} as const;

export type AutoCutLocalSpeechTranscriptionSetupNextAction =
  typeof AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_NEXT_ACTION[keyof typeof AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_NEXT_ACTION];

export const AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_PHASE = {
  started: 'started',
  downloading: 'downloading',
  completed: 'completed',
  failed: 'failed',
  skipped: 'skipped',
} as const;

export type AutoCutSpeechTranscriptionModelDownloadPhase =
  typeof AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_PHASE[keyof typeof AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_PHASE];

export function isAutoCutSpeechTranscriptionModelDownloadPhase(
  phase: unknown,
): phase is AutoCutSpeechTranscriptionModelDownloadPhase {
  return typeof phase === 'string' &&
    Object.values(AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_PHASE).includes(
      phase as AutoCutSpeechTranscriptionModelDownloadPhase,
    );
}

export const AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_TERMINAL_PHASES = [
  AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_PHASE.completed,
  AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_PHASE.failed,
  AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_PHASE.skipped,
] as const;

export function isAutoCutSpeechTranscriptionModelDownloadTerminalPhase(
  phase: AutoCutSpeechTranscriptionModelDownloadPhase,
) {
  return AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_TERMINAL_PHASES.includes(
    phase as (typeof AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_TERMINAL_PHASES)[number],
  );
}

export interface AutoCutSpeechTranscriptionModelDownloadProgressEvent {
  providerId: string;
  presetId: string;
  fileName: string;
  phase: AutoCutSpeechTranscriptionModelDownloadPhase;
  downloadedBytes: number;
  totalBytes?: number;
  progress?: number;
  modelPath?: string;
  sourceUrl?: string;
  errorMessage?: string;
}

export interface AutoCutLocalSpeechTranscriptionSetupStatus {
  providerId: AutoCutSpeechTranscriptionProviderId;
  localProviderIds: AutoCutSpeechTranscriptionProviderId[];
  readiness: AutoCutLocalSpeechTranscriptionSetupReadiness;
  nextAction: AutoCutLocalSpeechTranscriptionSetupNextAction;
  executable: {
    ready: boolean;
    path: string;
    sourceKind: string;
  };
  model: {
    ready: boolean;
    path: string;
    preset: AutoCutLocalSpeechTranscriptionModelPreset;
  };
  test: {
    ready: boolean;
    lastTestedAt?: string;
  };
  capabilities: {
    commandReady: boolean;
    probeReady: boolean;
    toolchainReady: boolean;
    modelDownloadReady: boolean;
    executableDownloadReady: boolean;
  };
  defaults: {
    executableDirectory: string;
    executablePath: string;
    modelDirectory: string;
    modelPath: string;
    executableStrategy: string;
  };
  diagnostics: string[];
}

export interface AutoCutLocalSpeechTranscriptionModelSetupResult {
  preset: AutoCutLocalSpeechTranscriptionModelPreset;
  providerId: AutoCutSpeechTranscriptionProviderId;
  modelPath: string;
  downloaded: boolean;
  nativeDownload: boolean;
  settings: AppSettings;
}

export interface AutoCutLocalSpeechTranscriptionSetupInitializationResult {
  status: AutoCutLocalSpeechTranscriptionSetupStatus;
  settings: AppSettings;
  modelSetup?: AutoCutLocalSpeechTranscriptionModelSetupResult;
}

export type ModelVendor =
  | 'deepseek'
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'xai'
  | 'qwen'
  | 'moonshot'
  | 'baidu'
  | 'zhipu'
  | 'minimax'
  | 'hunyuan'
  | 'doubao'
  | 'custom';

export type AutoCutModelVendorRegion = 'china' | 'us' | 'global';

export interface AutoCutModelTemperaturePreset {
  min: number;
  max: number;
  step: number;
  default: number;
}

export interface AutoCutModelPreset {
  id: string;
  label: string;
  contextWindowTokens: number;
  minOutputTokens: number;
  maxOutputTokens: number;
  defaultMaxTokens: number;
  temperature: AutoCutModelTemperaturePreset;
}

export interface AutoCutModelVendorPreset {
  vendor: ModelVendor;
  labelKey: string;
  descriptionKey: string;
  region: AutoCutModelVendorRegion;
  baseUrl: string;
  defaultModel: string;
  models: AutoCutModelPreset[];
  openAiCompatible: true;
}

const AUTOCUT_STANDARD_TEMPERATURE: AutoCutModelTemperaturePreset = {
  min: 0,
  max: 2,
  step: 0.1,
  default: 0.2,
};

export const AUTOCUT_MODEL_PRESETS: Record<ModelVendor, Record<string, AutoCutModelPreset>> = {
  deepseek: {
    'deepseek-v4-flash': {
      id: 'deepseek-v4-flash',
      label: 'DeepSeek V4 Flash',
      contextWindowTokens: 1048576,
      minOutputTokens: 1,
      maxOutputTokens: 393216,
      defaultMaxTokens: 8192,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'deepseek-v4-pro': {
      id: 'deepseek-v4-pro',
      label: 'DeepSeek V4 Pro',
      contextWindowTokens: 1048576,
      minOutputTokens: 1,
      maxOutputTokens: 393216,
      defaultMaxTokens: 8192,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'deepseek-chat': {
      id: 'deepseek-chat',
      label: 'DeepSeek Chat',
      contextWindowTokens: 1048576,
      minOutputTokens: 1,
      maxOutputTokens: 393216,
      defaultMaxTokens: 8192,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'deepseek-reasoner': {
      id: 'deepseek-reasoner',
      label: 'DeepSeek Reasoner',
      contextWindowTokens: 1048576,
      minOutputTokens: 1,
      maxOutputTokens: 393216,
      defaultMaxTokens: 8192,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
  },
  openai: {
    'gpt-5.2': {
      id: 'gpt-5.2',
      label: 'GPT-5.2',
      contextWindowTokens: 1050000,
      minOutputTokens: 1,
      maxOutputTokens: 128000,
      defaultMaxTokens: 8192,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'gpt-5.2-chat-latest': {
      id: 'gpt-5.2-chat-latest',
      label: 'GPT-5.2 Chat Latest',
      contextWindowTokens: 1050000,
      minOutputTokens: 1,
      maxOutputTokens: 128000,
      defaultMaxTokens: 8192,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'gpt-5.2-pro': {
      id: 'gpt-5.2-pro',
      label: 'GPT-5.2 Pro',
      contextWindowTokens: 1050000,
      minOutputTokens: 1,
      maxOutputTokens: 128000,
      defaultMaxTokens: 8192,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'gpt-5.1': {
      id: 'gpt-5.1',
      label: 'GPT-5.1',
      contextWindowTokens: 1050000,
      minOutputTokens: 1,
      maxOutputTokens: 128000,
      defaultMaxTokens: 8192,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'gpt-5.1-chat-latest': {
      id: 'gpt-5.1-chat-latest',
      label: 'GPT-5.1 Chat Latest',
      contextWindowTokens: 1050000,
      minOutputTokens: 1,
      maxOutputTokens: 128000,
      defaultMaxTokens: 8192,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'gpt-5.1-codex': {
      id: 'gpt-5.1-codex',
      label: 'GPT-5.1 Codex',
      contextWindowTokens: 400000,
      minOutputTokens: 1,
      maxOutputTokens: 128000,
      defaultMaxTokens: 8192,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'gpt-5.1-codex-mini': {
      id: 'gpt-5.1-codex-mini',
      label: 'GPT-5.1 Codex Mini',
      contextWindowTokens: 400000,
      minOutputTokens: 1,
      maxOutputTokens: 128000,
      defaultMaxTokens: 4096,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'gpt-4o-mini': {
      id: 'gpt-4o-mini',
      label: 'GPT-4o Mini',
      contextWindowTokens: 128000,
      minOutputTokens: 1,
      maxOutputTokens: 16384,
      defaultMaxTokens: 4096,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'gpt-4o': {
      id: 'gpt-4o',
      label: 'GPT-4o',
      contextWindowTokens: 128000,
      minOutputTokens: 1,
      maxOutputTokens: 16384,
      defaultMaxTokens: 4096,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'gpt-4.1-mini': {
      id: 'gpt-4.1-mini',
      label: 'GPT-4.1 Mini',
      contextWindowTokens: 1047576,
      minOutputTokens: 1,
      maxOutputTokens: 32768,
      defaultMaxTokens: 4096,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'gpt-4.1': {
      id: 'gpt-4.1',
      label: 'GPT-4.1',
      contextWindowTokens: 1047576,
      minOutputTokens: 1,
      maxOutputTokens: 32768,
      defaultMaxTokens: 4096,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
  },
  anthropic: {
    'claude-opus-4-5-20251101': {
      id: 'claude-opus-4-5-20251101',
      label: 'Claude Opus 4.5',
      contextWindowTokens: 200000,
      minOutputTokens: 1,
      maxOutputTokens: 128000,
      defaultMaxTokens: 8192,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'claude-sonnet-4-5-20250929': {
      id: 'claude-sonnet-4-5-20250929',
      label: 'Claude Sonnet 4.5',
      contextWindowTokens: 200000,
      minOutputTokens: 1,
      maxOutputTokens: 64000,
      defaultMaxTokens: 8192,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'claude-haiku-4-5-20251001': {
      id: 'claude-haiku-4-5-20251001',
      label: 'Claude Haiku 4.5',
      contextWindowTokens: 200000,
      minOutputTokens: 1,
      maxOutputTokens: 64000,
      defaultMaxTokens: 4096,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
  },
  gemini: {
    'gemini-3.1-pro-preview': {
      id: 'gemini-3.1-pro-preview',
      label: 'Gemini 3.1 Pro Preview',
      contextWindowTokens: 1048576,
      minOutputTokens: 1,
      maxOutputTokens: 65536,
      defaultMaxTokens: 8192,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'gemini-3-flash-preview': {
      id: 'gemini-3-flash-preview',
      label: 'Gemini 3 Flash Preview',
      contextWindowTokens: 1048576,
      minOutputTokens: 1,
      maxOutputTokens: 65536,
      defaultMaxTokens: 8192,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'gemini-3.1-flash-lite-preview': {
      id: 'gemini-3.1-flash-lite-preview',
      label: 'Gemini 3.1 Flash-Lite Preview',
      contextWindowTokens: 1048576,
      minOutputTokens: 1,
      maxOutputTokens: 65536,
      defaultMaxTokens: 4096,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'gemini-2.5-pro': {
      id: 'gemini-2.5-pro',
      label: 'Gemini 2.5 Pro',
      contextWindowTokens: 1048576,
      minOutputTokens: 1,
      maxOutputTokens: 65536,
      defaultMaxTokens: 8192,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'gemini-2.5-flash': {
      id: 'gemini-2.5-flash',
      label: 'Gemini 2.5 Flash',
      contextWindowTokens: 1048576,
      minOutputTokens: 1,
      maxOutputTokens: 65536,
      defaultMaxTokens: 8192,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'gemini-2.0-flash': {
      id: 'gemini-2.0-flash',
      label: 'Gemini 2.0 Flash',
      contextWindowTokens: 1048576,
      minOutputTokens: 1,
      maxOutputTokens: 8192,
      defaultMaxTokens: 4096,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'gemini-1.5-pro': {
      id: 'gemini-1.5-pro',
      label: 'Gemini 1.5 Pro',
      contextWindowTokens: 2097152,
      minOutputTokens: 1,
      maxOutputTokens: 8192,
      defaultMaxTokens: 4096,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'gemini-1.5-flash': {
      id: 'gemini-1.5-flash',
      label: 'Gemini 1.5 Flash',
      contextWindowTokens: 1048576,
      minOutputTokens: 1,
      maxOutputTokens: 8192,
      defaultMaxTokens: 4096,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
  },
  xai: {
    'grok-4.1': {
      id: 'grok-4.1',
      label: 'Grok 4.1',
      contextWindowTokens: 256000,
      minOutputTokens: 1,
      maxOutputTokens: 32768,
      defaultMaxTokens: 8192,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'grok-4.1-fast': {
      id: 'grok-4.1-fast',
      label: 'Grok 4.1 Fast',
      contextWindowTokens: 256000,
      minOutputTokens: 1,
      maxOutputTokens: 32768,
      defaultMaxTokens: 8192,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'grok-4.1-mini': {
      id: 'grok-4.1-mini',
      label: 'Grok 4.1 Mini',
      contextWindowTokens: 128000,
      minOutputTokens: 1,
      maxOutputTokens: 32768,
      defaultMaxTokens: 8192,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'grok-4-fast-reasoning': {
      id: 'grok-4-fast-reasoning',
      label: 'Grok 4 Fast Reasoning',
      contextWindowTokens: 256000,
      minOutputTokens: 1,
      maxOutputTokens: 32768,
      defaultMaxTokens: 8192,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
  },
  qwen: {
    'qwen3-max': {
      id: 'qwen3-max',
      label: 'Qwen3 Max',
      contextWindowTokens: 1048576,
      minOutputTokens: 1,
      maxOutputTokens: 65536,
      defaultMaxTokens: 8192,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'qwen3.5-plus': {
      id: 'qwen3.5-plus',
      label: 'Qwen3.5 Plus',
      contextWindowTokens: 1048576,
      minOutputTokens: 1,
      maxOutputTokens: 65536,
      defaultMaxTokens: 8192,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'qwen3.6-plus': {
      id: 'qwen3.6-plus',
      label: 'Qwen3.6 Plus',
      contextWindowTokens: 1048576,
      minOutputTokens: 1,
      maxOutputTokens: 65536,
      defaultMaxTokens: 8192,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'qwen3.6-flash': {
      id: 'qwen3.6-flash',
      label: 'Qwen3.6 Flash',
      contextWindowTokens: 1048576,
      minOutputTokens: 1,
      maxOutputTokens: 65536,
      defaultMaxTokens: 8192,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'qwen-plus': {
      id: 'qwen-plus',
      label: 'Qwen Plus',
      contextWindowTokens: 131072,
      minOutputTokens: 1,
      maxOutputTokens: 8192,
      defaultMaxTokens: 4096,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'qwen-max': {
      id: 'qwen-max',
      label: 'Qwen Max',
      contextWindowTokens: 32768,
      minOutputTokens: 1,
      maxOutputTokens: 8192,
      defaultMaxTokens: 4096,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'qwen-turbo': {
      id: 'qwen-turbo',
      label: 'Qwen Turbo',
      contextWindowTokens: 1000000,
      minOutputTokens: 1,
      maxOutputTokens: 8192,
      defaultMaxTokens: 4096,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'qwen-long': {
      id: 'qwen-long',
      label: 'Qwen Long',
      contextWindowTokens: 1000000,
      minOutputTokens: 1,
      maxOutputTokens: 8192,
      defaultMaxTokens: 4096,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
  },
  moonshot: {
    'kimi-k2-0905-preview': {
      id: 'kimi-k2-0905-preview',
      label: 'Kimi K2 0905 Preview',
      contextWindowTokens: 256000,
      minOutputTokens: 1,
      maxOutputTokens: 65536,
      defaultMaxTokens: 8192,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'kimi-latest': {
      id: 'kimi-latest',
      label: 'Kimi Latest',
      contextWindowTokens: 256000,
      minOutputTokens: 1,
      maxOutputTokens: 65536,
      defaultMaxTokens: 8192,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'moonshot-v1-8k': {
      id: 'moonshot-v1-8k',
      label: 'Moonshot V1 8K',
      contextWindowTokens: 8192,
      minOutputTokens: 1,
      maxOutputTokens: 8192,
      defaultMaxTokens: 2048,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'moonshot-v1-32k': {
      id: 'moonshot-v1-32k',
      label: 'Moonshot V1 32K',
      contextWindowTokens: 32768,
      minOutputTokens: 1,
      maxOutputTokens: 32768,
      defaultMaxTokens: 4096,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'moonshot-v1-128k': {
      id: 'moonshot-v1-128k',
      label: 'Moonshot V1 128K',
      contextWindowTokens: 131072,
      minOutputTokens: 1,
      maxOutputTokens: 131072,
      defaultMaxTokens: 4096,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
  },
  baidu: {
    'ernie-5.0-preview': {
      id: 'ernie-5.0-preview',
      label: 'ERNIE 5.0 Preview',
      contextWindowTokens: 131072,
      minOutputTokens: 1,
      maxOutputTokens: 65536,
      defaultMaxTokens: 8192,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'ernie-4.5-turbo-128k': {
      id: 'ernie-4.5-turbo-128k',
      label: 'ERNIE 4.5 Turbo 128K',
      contextWindowTokens: 131072,
      minOutputTokens: 1,
      maxOutputTokens: 65536,
      defaultMaxTokens: 8192,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
  },
  zhipu: {
    'glm-4.6': {
      id: 'glm-4.6',
      label: 'GLM-4.6',
      contextWindowTokens: 1048576,
      minOutputTokens: 1,
      maxOutputTokens: 128000,
      defaultMaxTokens: 8192,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'glm-4.5': {
      id: 'glm-4.5',
      label: 'GLM-4.5',
      contextWindowTokens: 131072,
      minOutputTokens: 1,
      maxOutputTokens: 98304,
      defaultMaxTokens: 8192,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
  },
  minimax: {
    'MiniMax-M2.7': {
      id: 'MiniMax-M2.7',
      label: 'MiniMax M2.7',
      contextWindowTokens: 256000,
      minOutputTokens: 1,
      maxOutputTokens: 65536,
      defaultMaxTokens: 8192,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'MiniMax-M2.7-highspeed': {
      id: 'MiniMax-M2.7-highspeed',
      label: 'MiniMax M2.7 High Speed',
      contextWindowTokens: 256000,
      minOutputTokens: 1,
      maxOutputTokens: 65536,
      defaultMaxTokens: 8192,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
  },
  hunyuan: {
    'hunyuan-t1-latest': {
      id: 'hunyuan-t1-latest',
      label: 'Hunyuan T1 Latest',
      contextWindowTokens: 256000,
      minOutputTokens: 1,
      maxOutputTokens: 65536,
      defaultMaxTokens: 8192,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'hunyuan-turbos-latest': {
      id: 'hunyuan-turbos-latest',
      label: 'Hunyuan Turbos Latest',
      contextWindowTokens: 256000,
      minOutputTokens: 1,
      maxOutputTokens: 65536,
      defaultMaxTokens: 8192,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
  },
  doubao: {
    'doubao-seed-2-0-pro-250828': {
      id: 'doubao-seed-2-0-pro-250828',
      label: 'Doubao Seed 2.0 Pro 250828',
      contextWindowTokens: 256000,
      minOutputTokens: 1,
      maxOutputTokens: 65536,
      defaultMaxTokens: 8192,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'doubao-seed-2-0-flash-250828': {
      id: 'doubao-seed-2-0-flash-250828',
      label: 'Doubao Seed 2.0 Flash 250828',
      contextWindowTokens: 256000,
      minOutputTokens: 1,
      maxOutputTokens: 65536,
      defaultMaxTokens: 8192,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
  },
  custom: {},
};

const AUTOCUT_CUSTOM_MODEL_PRESET: AutoCutModelPreset = {
  id: 'custom-openai-compatible',
  label: 'Custom OpenAI-Compatible Model',
  contextWindowTokens: 128000,
  minOutputTokens: 1,
  maxOutputTokens: 8192,
  defaultMaxTokens: 4096,
  temperature: AUTOCUT_STANDARD_TEMPERATURE,
};

export const AUTOCUT_MODEL_VENDOR_PRESETS: Record<ModelVendor, AutoCutModelVendorPreset> = {
  deepseek: {
    vendor: 'deepseek',
    labelKey: 'settings.llm.vendor.deepseek.label',
    descriptionKey: 'settings.llm.vendor.deepseek.description',
    region: 'china',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-v4-flash',
    models: Object.values(AUTOCUT_MODEL_PRESETS.deepseek),
    openAiCompatible: true,
  },
  openai: {
    vendor: 'openai',
    labelKey: 'settings.llm.vendor.openai.label',
    descriptionKey: 'settings.llm.vendor.openai.description',
    region: 'us',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.2',
    models: Object.values(AUTOCUT_MODEL_PRESETS.openai),
    openAiCompatible: true,
  },
  anthropic: {
    vendor: 'anthropic',
    labelKey: 'settings.llm.vendor.anthropic.label',
    descriptionKey: 'settings.llm.vendor.anthropic.description',
    region: 'us',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-5-20250929',
    models: Object.values(AUTOCUT_MODEL_PRESETS.anthropic),
    openAiCompatible: true,
  },
  gemini: {
    vendor: 'gemini',
    labelKey: 'settings.llm.vendor.gemini.label',
    descriptionKey: 'settings.llm.vendor.gemini.description',
    region: 'us',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-3.1-pro-preview',
    models: Object.values(AUTOCUT_MODEL_PRESETS.gemini),
    openAiCompatible: true,
  },
  xai: {
    vendor: 'xai',
    labelKey: 'settings.llm.vendor.xai.label',
    descriptionKey: 'settings.llm.vendor.xai.description',
    region: 'us',
    baseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-4.1',
    models: Object.values(AUTOCUT_MODEL_PRESETS.xai),
    openAiCompatible: true,
  },
  qwen: {
    vendor: 'qwen',
    labelKey: 'settings.llm.vendor.qwen.label',
    descriptionKey: 'settings.llm.vendor.qwen.description',
    region: 'china',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen3.6-plus',
    models: Object.values(AUTOCUT_MODEL_PRESETS.qwen),
    openAiCompatible: true,
  },
  moonshot: {
    vendor: 'moonshot',
    labelKey: 'settings.llm.vendor.moonshot.label',
    descriptionKey: 'settings.llm.vendor.moonshot.description',
    region: 'china',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-k2-0905-preview',
    models: Object.values(AUTOCUT_MODEL_PRESETS.moonshot),
    openAiCompatible: true,
  },
  baidu: {
    vendor: 'baidu',
    labelKey: 'settings.llm.vendor.baidu.label',
    descriptionKey: 'settings.llm.vendor.baidu.description',
    region: 'china',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    defaultModel: 'ernie-5.0-preview',
    models: Object.values(AUTOCUT_MODEL_PRESETS.baidu),
    openAiCompatible: true,
  },
  zhipu: {
    vendor: 'zhipu',
    labelKey: 'settings.llm.vendor.zhipu.label',
    descriptionKey: 'settings.llm.vendor.zhipu.description',
    region: 'china',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4.6',
    models: Object.values(AUTOCUT_MODEL_PRESETS.zhipu),
    openAiCompatible: true,
  },
  minimax: {
    vendor: 'minimax',
    labelKey: 'settings.llm.vendor.minimax.label',
    descriptionKey: 'settings.llm.vendor.minimax.description',
    region: 'china',
    baseUrl: 'https://api.minimax.io/v1',
    defaultModel: 'MiniMax-M2.7',
    models: Object.values(AUTOCUT_MODEL_PRESETS.minimax),
    openAiCompatible: true,
  },
  hunyuan: {
    vendor: 'hunyuan',
    labelKey: 'settings.llm.vendor.hunyuan.label',
    descriptionKey: 'settings.llm.vendor.hunyuan.description',
    region: 'china',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    defaultModel: 'hunyuan-t1-latest',
    models: Object.values(AUTOCUT_MODEL_PRESETS.hunyuan),
    openAiCompatible: true,
  },
  doubao: {
    vendor: 'doubao',
    labelKey: 'settings.llm.vendor.doubao.label',
    descriptionKey: 'settings.llm.vendor.doubao.description',
    region: 'china',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'doubao-seed-2-0-pro-250828',
    models: Object.values(AUTOCUT_MODEL_PRESETS.doubao),
    openAiCompatible: true,
  },
  custom: {
    vendor: 'custom',
    labelKey: 'settings.llm.vendor.custom.label',
    descriptionKey: 'settings.llm.vendor.custom.description',
    region: 'global',
    baseUrl: '',
    defaultModel: '',
    models: [],
    openAiCompatible: true,
  },
};

export function getAutoCutModelPreset(modelVendor: ModelVendor, model: string): AutoCutModelPreset {
  return AUTOCUT_MODEL_PRESETS[modelVendor][model] ?? AUTOCUT_CUSTOM_MODEL_PRESET;
}

export interface AutoCutLlmModelOption {
  vendor: Exclude<ModelVendor, 'custom'>;
  id: string;
  label: string;
}

const AUTOCUT_SLICE_LLM_MODEL_VENDORS: Exclude<ModelVendor, 'custom'>[] = [
  'gemini',
  'openai',
  'anthropic',
  'xai',
  'deepseek',
  'qwen',
  'moonshot',
  'baidu',
  'zhipu',
  'minimax',
  'hunyuan',
  'doubao',
];

export const AUTOCUT_SLICE_LLM_MODEL_OPTIONS: AutoCutLlmModelOption[] = AUTOCUT_SLICE_LLM_MODEL_VENDORS.flatMap(
  (vendor) => AUTOCUT_MODEL_VENDOR_PRESETS[vendor].models.map((model) => ({
    vendor,
    id: model.id,
    label: model.label,
  })),
);

export interface AutoCutLlmSettings {
  modelVendor: ModelVendor;
  baseUrl: string;
  model: string;
  apiKey?: string;
  maskedApiKey?: string;
  apiKeyConfigured: boolean;
  temperature: number;
  maxTokens: number;
}

export interface AutoCutLlmRuntimeConfig {
  modelVendor: ModelVendor;
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
  sessionApiKey?: string;
  temperature: number;
  maxTokens: number;
  requestFormat: 'openai-chat-completions';
  chatCompletionsPath: '/chat/completions';
}

export interface AutoCutLlmConnectionTestResult {
  success: true;
  modelVendor: ModelVendor;
  baseUrl: string;
  model: string;
  content: string;
}

export interface AutoCutTaskProcessResult {
  success: true;
  taskId: string;
}

export interface AutoCutSecuritySettings {
  twoFactorEnabled: boolean;
  passwordChangeRequestedAt?: string;
  sessionsRevokedAt?: string;
  accountDeletedAt?: string;
}

export interface AppSettings {
  account: AutoCutAccountSettings;
  workspace: AutoCutWorkspaceSettings;
  billing: AutoCutBillingSettings;
  apiKeys: AutoCutApiKeySettings[];
  storage: AutoCutStorageSettings;
  notifications: AutoCutNotificationSettings;
  speechTranscription: AutoCutSpeechTranscriptionSettings;
  llm: AutoCutLlmSettings;
  security: AutoCutSecuritySettings;
  updatedAt: string;
}

export interface AutoCutVideoSlicePreferences {
  mode: SliceMode | (string & {});
  targetPlatform: SliceTargetPlatform;
  targetAspectRatio: SliceTargetAspectRatio;
  videoObjectFit: SliceVideoObjectFit;
  sliceCountMode: SliceCountMode;
  targetSliceCount: number;
  idealDuration: number;
  continuityLevel: SliceContinuityLevel;
  customKeywordsInput: string;
  minDuration: number;
  maxDuration: number;
  llmModel: SliceLLM;
  baseAlgorithm: SliceAlgorithm;
  highlightEngine: SliceHighlightEngine;
  enableNoiseReduction: boolean;
  enableCoughFilter: boolean;
  enableRepeatFilter: boolean;
  enableSubtitles: boolean;
  subtitleMode: SliceSubtitleMode;
  subtitleStyleId: string;
}

export interface AutoCutTextExtractionPreferences {
  language: string;
  separateSpeakers: boolean;
  filterWords: boolean;
}

export interface AutoCutWorkflowPreferences {
  videoSlice: AutoCutVideoSlicePreferences;
  textExtraction: AutoCutTextExtractionPreferences;
  updatedAt: string;
}

// ========================
// Tool Models
// ========================
export type ToolCategory = 'video' | 'audio' | 'ai';

export interface AppTool {
  id: string;
  name: string;
  nameKey?: string;
  icon: string;
  category: ToolCategory;
  description: string;
  descriptionKey?: string;
  route?: string;
}

export interface IToolModule {
  tool: AppTool;
  // Dynamic component to load for this tool's work page
  component: unknown;
}

// ========================
// Asset Models
// ========================
export type AssetType = 'video' | 'audio' | 'doc' | 'image' | 'folder';

export interface AppAsset {
  id: string;
  name: string;
  type: AssetType;
  size: number; // in bytes
  url?: string;
  thumbnailUrl?: string; // For videos/images
  artifactPath?: string;
  taskOutputDir?: string;
  createdAt: string;
  updatedAt: string;
  parentId?: string; // For folders structure
  sourceTaskId?: string;
  sourceTaskType?: TaskType;
}

export interface AssetStorageInfo {
  used: number; // in bytes
  total: number; // in bytes
}

// ========================
// Message Models
// ========================
export type MessageType = 'success' | 'warning' | 'error' | 'info';

export interface AppMessage {
  id: string;
  type: MessageType;
  title: string;
  description: string;
  createdAt: string;
  read: boolean;
  actionUrl?: string; // Optional URL linking to an action (e.g., a specific task)
  actionLabel?: string; // Optional label for the action button
}

// ========================
// Task Models
// ========================
export const AUTOCUT_TASK_STATUS = {
  pending: 'pending',
  processing: 'processing',
  completed: 'completed',
  failed: 'failed',
} as const;
export type TaskStatus = typeof AUTOCUT_TASK_STATUS[keyof typeof AUTOCUT_TASK_STATUS];
export function isAutoCutTaskActiveStatus(status: TaskStatus) {
  return status === AUTOCUT_TASK_STATUS.pending || status === AUTOCUT_TASK_STATUS.processing;
}
export const AUTOCUT_TASK_TYPE = {
  videoSlice: 'video-slice',
  textExtraction: 'text-extraction',
  audioExtraction: 'audio-extraction',
  videoGif: 'video-gif',
  videoCompress: 'video-compress',
  videoConvert: 'video-convert',
  videoEnhance: 'video-enhance',
  subtitleTranslate: 'subtitle-translate',
  voiceTranslate: 'voice-translate',
} as const;

export const AUTOCUT_TASK_TYPES = [
  AUTOCUT_TASK_TYPE.videoSlice,
  AUTOCUT_TASK_TYPE.textExtraction,
  AUTOCUT_TASK_TYPE.audioExtraction,
  AUTOCUT_TASK_TYPE.videoGif,
  AUTOCUT_TASK_TYPE.videoCompress,
  AUTOCUT_TASK_TYPE.videoConvert,
  AUTOCUT_TASK_TYPE.videoEnhance,
  AUTOCUT_TASK_TYPE.subtitleTranslate,
  AUTOCUT_TASK_TYPE.voiceTranslate,
] as const;
export type TaskType = typeof AUTOCUT_TASK_TYPES[number];

export interface AutoCutTranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
  speaker?: string;
}

export interface TaskSliceResult {
  id: string;
  name: string;
  duration: number; // in seconds
  size: number; // in bytes
  resolution: string;
  thumbnailUrl: string;
  url: string;
  subtitleUrl?: string;
  subtitleFormat?: 'srt' | string;
  artifactPath?: string;
  taskOutputDir?: string;
  title?: string;
  summary?: string;
  reason?: string;
  qualityScore?: number;
  continuityScore?: number;
  storyShape?: 'complete' | 'setupOnly' | 'payoffOnly' | 'contextOnly' | 'thin';
  publishabilityScore?: number;
  publishabilityGrade?: 'excellent' | 'good' | 'review' | 'reject';
  publishabilityIssues?: string[];
  boundaryQualityScore?: number;
  hookStrength?: 'strong' | 'contextual' | 'weak';
  endingCompleteness?: 'complete' | 'soft' | 'open';
  contentArcScore?: number;
  contentArcGrade?: 'complete' | 'partial' | 'thin';
  contentArcStages?: Array<'hook' | 'setup' | 'conflict' | 'payoff'>;
  contentArcMissingStages?: Array<'hook' | 'setup' | 'conflict' | 'payoff'>;
  topicCoherenceScore?: number;
  topicCoherenceGrade?: 'strong' | 'mixed' | 'weak';
  topicShiftCount?: number;
  topicKeywords?: string[];
  platformReadinessScore?: number;
  platformReadinessGrade?: 'ready' | 'review' | 'reject';
  platformReadinessIssues?: string[];
  sentenceBoundaryIntegrityScore?: number;
  sentenceBoundaryIntegrityGrade?: 'clean' | 'repaired' | 'broken';
  sentenceBoundaryIssues?: string[];
  risks?: string[];
  sourceStartMs?: number;
  sourceEndMs?: number;
  speechStartMs?: number;
  speechEndMs?: number;
  boundaryPaddingBeforeMs?: number;
  boundaryPaddingAfterMs?: number;
  transcriptText?: string;
  transcriptSegments?: AutoCutTranscriptSegment[];
  transcriptSegmentCount?: number;
  transcriptCoverageScore?: number;
  speechContinuityGrade?: 'strong' | 'repaired' | 'weak';
}

export interface AppTask {
  id: string;
  type: TaskType;
  name: string;
  status: TaskStatus;
  progress: number;
  progressMessage?: string;
  createdAt: string;
  completedAt?: string;
  errorMessage?: string;
  failureDiagnostics?: string;
  resultCount?: number;
  generatedAssetIds?: string[];
  sliceResults?: TaskSliceResult[]; // Used when type is AUTOCUT_TASK_TYPE.videoSlice
  sourceFileId?: string;
  extractedText?: { time: string, speaker: string, text: string }[]; // Used for AUTOCUT_TASK_TYPE.textExtraction
  transcriptText?: string; // Used for speech-to-text task evidence.
  transcriptSegments?: AutoCutTranscriptSegment[];
  transcriptSegmentCount?: number;
  transcriptProviderId?: AutoCutSpeechTranscriptionProviderId | (string & {});
  transcriptSourceAssetId?: string;
  audioUrl?: string; // Used for AUTOCUT_TASK_TYPE.audioExtraction
  videoUrl?: string; // Used for video conversions, enhance, translate, etc.
  gifUrl?: string; // Used for AUTOCUT_TASK_TYPE.videoGif
  fileSizeStats?: { originalSize: number, newSize: number, compressionRatio: number }; // Used for AUTOCUT_TASK_TYPE.videoCompress
}

export const AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD = {
  maxLeadingSilenceMs: 200,
  maxTrailingSilenceMs: 250,
  minTranscriptCoverageScore: 0.8,
  acceptedSpeechContinuityGrades: ['strong', 'repaired'],
} as const;

// ========================
// Slicer Models
// ========================
export type SliceMode =
  | "商品直播"
  | "单人讲解"
  | "双人连线直播"
  | "多人连线直播"
  | "在线会议"
  | "才艺表演"
  | "电影"
  | "通用";

export type SliceAlgorithm = 'nlp' | 'pause' | 'scene';
export type SliceHighlightEngine = 'emotion' | 'keyword' | 'motion';
export type SliceTargetPlatform = 'douyin' | 'kuaishou' | 'shipinhao' | 'xiaohongshu' | 'bilibili' | 'generic';
export type SliceTargetAspectRatio = 'auto' | '16:9' | '9:16' | '1:1' | '4:3';
export type SliceVideoObjectFit = 'contain' | 'cover';
export type SliceCountMode = 'auto' | 'fixed' | 'qualityFirst' | 'coverageFirst';
export type SliceContinuityLevel = 'standard' | 'strict';
export type SliceSubtitleMode = 'none' | 'srt' | 'burned' | 'both';
export type SliceLLM =
  | 'deepseek-chat'
  | 'deepseek-v4-flash'
  | 'deepseek-v4-pro'
  | 'deepseek-reasoner'
  | 'gemini-3.1-pro-preview'
  | 'gemini-3-flash-preview'
  | 'gemini-3.1-flash-lite-preview'
  | 'gemini-2.5-pro'
  | 'gemini-2.5-flash'
  | 'gemini-2.0-flash'
  | 'gemini-1.5-pro'
  | 'gemini-1.5-flash'
  | 'gpt-5.2'
  | 'gpt-5.2-chat-latest'
  | 'gpt-5.2-pro'
  | 'gpt-5.1'
  | 'gpt-5.1-chat-latest'
  | 'gpt-5.1-codex'
  | 'gpt-5.1-codex-mini'
  | 'gpt-4o'
  | 'gpt-4o-mini'
  | 'gpt-4.1'
  | 'gpt-4.1-mini'
  | 'claude-opus-4-5-20251101'
  | 'claude-sonnet-4-5-20250929'
  | 'claude-haiku-4-5-20251001'
  | 'grok-4.1'
  | 'grok-4.1-fast'
  | 'grok-4.1-mini'
  | 'grok-4-fast-reasoning'
  | 'qwen3-max'
  | 'qwen3.5-plus'
  | 'qwen3.6-plus'
  | 'qwen3.6-flash'
  | 'kimi-k2-0905-preview'
  | 'kimi-latest'
  | 'ernie-5.0-preview'
  | 'ernie-4.5-turbo-128k'
  | 'glm-4.6'
  | 'glm-4.5'
  | 'MiniMax-M2.7'
  | 'MiniMax-M2.7-highspeed'
  | 'hunyuan-t1-latest'
  | 'hunyuan-turbos-latest'
  | 'doubao-seed-2-0-pro-250828'
  | 'doubao-seed-2-0-flash-250828'
  | 'deepseek-r1'
  | (string & {});

export interface AudioExtractionParams {
  file?: File | null;
  fileId?: string;
  format: 'mp3' | 'wav' | 'flac' | 'aac' | string;
  quality: '320' | '256' | '192' | '128' | string;
  channel: 'stereo' | 'smart-stereo' | 'mono';
}

export interface ExtractorTextParams {
  file?: File | null;
  fileId?: string;
  language: string;
  format: string; // 'raw' | 'filtered'
  separateSpeakers: boolean;
}

export interface VideoCompressParams {
  file?: File | null;
  fileId?: string;
  compressionMode: 'quality' | 'balanced' | 'extreme' | string;
}

export interface VideoConvertParams {
  file?: File | null;
  fileId?: string;
  targetFormat: string;
  videoCodec: string;
  audioCodec: string;
  resolution: string;
}

export interface VideoEnhanceParams {
  file?: File | null;
  fileId?: string;
  targetResolution: string;
  enhanceMode: string;
  frameRate: string;
}

export interface VideoGifParams {
  file?: File | null;
  fileId?: string;
  fps: string;
  resolution: string;
  dither: boolean;
}

export interface SubtitleTranslateParams {
  file?: File | null;
  fileId?: string;
  sourceLang: string;
  targetLang: string;
  keepOriginal: boolean;
  hardcode: boolean;
}

export interface VoiceTranslateParams {
  file?: File | null;
  fileId?: string;
  sourceLang: string;
  targetLang: string;
  voiceCloneSync: boolean;
  bgmHandling: string;
}

export interface VideoSliceParams {
  mode: SliceMode;
  fileId?: string; // If selected from assets
  file?: File | null; // If uploaded
  url?: string; // If external url

  // Advanced Settings
  llmModel: SliceLLM;
  targetPlatform?: SliceTargetPlatform;
  targetAspectRatio?: SliceTargetAspectRatio;
  videoObjectFit?: SliceVideoObjectFit;
  sliceCountMode?: SliceCountMode;
  targetSliceCount?: number;
  idealDuration?: number;
  sourceDurationMs?: number;
  continuityLevel?: SliceContinuityLevel;
  customKeywords?: string[];
  minDuration: number;
  maxDuration: number;
  baseAlgorithm: SliceAlgorithm;
  highlightEngine: SliceHighlightEngine;
  enableNoiseReduction: boolean;
  enableCoughFilter: boolean;
  enableRepeatFilter: boolean;
  enableSubtitles?: boolean;
  subtitleMode?: SliceSubtitleMode;
  subtitleStyleId?: string;
}
