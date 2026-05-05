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

export interface AutoCutWorkspaceSettings {
  defaultStoragePath: string;
  outputDirectory: string;
  hardwareAcceleration: boolean;
  completionSound: boolean;
  language: 'zh' | 'en' | string;
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

export interface AutoCutSpeechTranscriptionSettings {
  executablePath: string;
  modelPath: string;
  language: 'auto' | 'zh' | 'en' | string;
  configured: boolean;
  lastTestedAt?: string;
  lastProbeReady?: boolean;
  lastProbeDiagnostics?: string[];
}

export type ModelVendor = 'deepseek' | 'openai' | 'qwen' | 'moonshot' | 'gemini' | 'custom';

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
  label: string;
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
    'gpt-5.5': {
      id: 'gpt-5.5',
      label: 'GPT-5.5',
      contextWindowTokens: 1050000,
      minOutputTokens: 1,
      maxOutputTokens: 128000,
      defaultMaxTokens: 8192,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'gpt-5.4': {
      id: 'gpt-5.4',
      label: 'GPT-5.4',
      contextWindowTokens: 1050000,
      minOutputTokens: 1,
      maxOutputTokens: 128000,
      defaultMaxTokens: 8192,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'gpt-5.4-mini': {
      id: 'gpt-5.4-mini',
      label: 'GPT-5.4 Mini',
      contextWindowTokens: 400000,
      minOutputTokens: 1,
      maxOutputTokens: 128000,
      defaultMaxTokens: 8192,
      temperature: AUTOCUT_STANDARD_TEMPERATURE,
    },
    'gpt-5.4-nano': {
      id: 'gpt-5.4-nano',
      label: 'GPT-5.4 Nano',
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
  qwen: {
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
    'gemini-2.5-flash': {
      id: 'gemini-2.5-flash',
      label: 'Gemini 2.5 Flash',
      contextWindowTokens: 1048576,
      minOutputTokens: 1,
      maxOutputTokens: 65536,
      defaultMaxTokens: 8192,
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
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-v4-flash',
    models: Object.values(AUTOCUT_MODEL_PRESETS.deepseek),
    openAiCompatible: true,
  },
  openai: {
    vendor: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.5',
    models: Object.values(AUTOCUT_MODEL_PRESETS.openai),
    openAiCompatible: true,
  },
  qwen: {
    vendor: 'qwen',
    label: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen3.6-plus',
    models: Object.values(AUTOCUT_MODEL_PRESETS.qwen),
    openAiCompatible: true,
  },
  moonshot: {
    vendor: 'moonshot',
    label: 'Moonshot',
    baseUrl: 'https://api.moonshot.ai/v1',
    defaultModel: 'moonshot-v1-8k',
    models: Object.values(AUTOCUT_MODEL_PRESETS.moonshot),
    openAiCompatible: true,
  },
  gemini: {
    vendor: 'gemini',
    label: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-3.1-pro-preview',
    models: Object.values(AUTOCUT_MODEL_PRESETS.gemini),
    openAiCompatible: true,
  },
  custom: {
    vendor: 'custom',
    label: '自定义兼容接口',
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
  'deepseek',
  'qwen',
  'moonshot',
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

// ========================
// Tool Models
// ========================
export type ToolCategory = 'video' | 'audio' | 'ai';

export interface AppTool {
  id: string;
  name: string;
  icon: string;
  category: ToolCategory;
  description: string;
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
export const AUTOCUT_TASK_TYPES = [
  '视频切片',
  '文案提取',
  '视频提音',
  '视频转gif',
  '视频压缩',
  '视频格式转换',
  '视频高清化',
  '视频字幕翻译',
  '视频人声翻译',
] as const;
export type TaskType = typeof AUTOCUT_TASK_TYPES[number];

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
  resultCount?: number;
  generatedAssetIds?: string[];
  sliceResults?: TaskSliceResult[]; // Used when type is '视频切片'
  sourceFileId?: string;
  extractedText?: { time: string, speaker: string, text: string }[]; // Used for '文案提取'
  audioUrl?: string; // Used for '视频提音'
  videoUrl?: string; // Used for video conversions, enhance, translate, etc.
  gifUrl?: string; // Used for '视频转gif'
  fileSizeStats?: { originalSize: number, newSize: number, compressionRatio: number }; // Used for '视频压缩'
}

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
  | 'gpt-5.5'
  | 'gpt-5.4'
  | 'gpt-5.4-mini'
  | 'gpt-5.4-nano'
  | 'gpt-4o'
  | 'gpt-4o-mini'
  | 'gpt-4.1-mini'
  | 'claude-3.5-sonnet'
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
  minDuration: number;
  maxDuration: number;
  baseAlgorithm: SliceAlgorithm;
  highlightEngine: SliceHighlightEngine;
  enableNoiseReduction: boolean;
  enableCoughFilter: boolean;
  enableRepeatFilter: boolean;
  enableSubtitles?: boolean;
  subtitleStyleId?: string;
}
