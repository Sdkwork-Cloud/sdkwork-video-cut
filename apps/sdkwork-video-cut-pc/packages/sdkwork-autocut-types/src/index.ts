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
  iflytekLongForm: 'iflytek-long-form',
  volcengineAsr: 'volcengine-asr',
  qwenParaformer: 'qwen-paraformer',
  tencentCloudAsr: 'tencent-cloud-asr',
  baiduCloudAsr: 'baidu-cloud-asr',
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
    sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
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
  supportsWords: boolean;
  supportsSpeakerDiarization: boolean;
  preferredForLongForm: boolean;
  requiresLongAudio?: boolean;
  requiresSegmentTimestamps?: boolean;
}

export type AutoCutSpeechTranscriptionProviderOptionValue = string | number | boolean | string[] | number[];

export type AutoCutSpeechTranscriptionProviderOptions =
  Record<string, AutoCutSpeechTranscriptionProviderOptionValue>;

export interface AutoCutSpeechTranscriptionProviderOptionChoice {
  value: string | number | boolean;
  label: string;
}

export interface AutoCutSpeechTranscriptionProviderOptionDefinition {
  key: string;
  kind: 'boolean' | 'number' | 'text' | 'select' | 'multi-select';
  label: string;
  description: string;
  officialParameterName?: string;
  required?: boolean;
  requiredForSmartSlice?: boolean;
  locked?: boolean;
  defaultValue: AutoCutSpeechTranscriptionProviderOptionValue;
  choices?: readonly AutoCutSpeechTranscriptionProviderOptionChoice[];
  min?: number;
  max?: number;
  step?: number;
}

export type AutoCutSpeechTranscriptionProviderIntegrationMode =
  | 'local-long-audio-cli'
  | 'openai-compatible-audio'
  | 'dashscope-paraformer-task'
  | 'iflytek-lfasr-task'
  | 'volcengine-bigmodel-recorded-audio'
  | 'tencent-cloud-recorded-task'
  | 'baidu-cloud-audio-transcription-task';

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
  officialName?: string;
  officialDocsUrl?: string;
  integrationMode?: AutoCutSpeechTranscriptionProviderIntegrationMode;
  optionSchema?: readonly AutoCutSpeechTranscriptionProviderOptionDefinition[];
  defaultProviderOptions?: AutoCutSpeechTranscriptionProviderOptions;
  capabilities: AutoCutSpeechTranscriptionProviderCapabilities;
}

const AUTOCUT_LOCAL_SPEECH_TRANSCRIPTION_CAPABILITIES = {
  requiresExecutablePath: true,
  requiresModelPath: true,
  usesNativeAssetTranscription: true,
  usesModelVendorRuntime: false,
  supportsTimestamps: true,
  supportsSegments: true,
  supportsWords: true,
  supportsSpeakerDiarization: false,
  preferredForLongForm: false,
  requiresLongAudio: false,
  requiresSegmentTimestamps: true,
} as const satisfies AutoCutSpeechTranscriptionProviderCapabilities;

const AUTOCUT_API_SPEECH_TRANSCRIPTION_CAPABILITIES = {
  requiresExecutablePath: false,
  requiresModelPath: false,
  usesNativeAssetTranscription: false,
  usesModelVendorRuntime: true,
  supportsTimestamps: true,
  supportsSegments: true,
  supportsWords: true,
  supportsSpeakerDiarization: true,
  preferredForLongForm: true,
  requiresLongAudio: true,
  requiresSegmentTimestamps: true,
} as const satisfies AutoCutSpeechTranscriptionProviderCapabilities;

const AUTOCUT_API_SPEECH_TRANSCRIPTION_SEGMENT_TIMESTAMP_OPTION = {
  key: 'enableSegmentTimestamps',
  kind: 'boolean',
  label: 'Segment timestamps',
  description: 'Required by Smart Slice. Provider responses must include start/end time for every recognized sentence or utterance.',
  required: true,
  requiredForSmartSlice: true,
  locked: true,
  defaultValue: true,
} as const satisfies AutoCutSpeechTranscriptionProviderOptionDefinition;

const AUTOCUT_API_SPEECH_TRANSCRIPTION_WORD_TIMESTAMP_OPTION = {
  key: 'enableWordTimestamps',
  kind: 'boolean',
  label: 'Word timestamps',
  description: 'Request word-level timings when the provider supports detailed recognition results.',
  defaultValue: true,
} as const satisfies AutoCutSpeechTranscriptionProviderOptionDefinition;

const AUTOCUT_API_SPEECH_TRANSCRIPTION_SPEAKER_OPTION = {
  key: 'enableSpeakerDiarization',
  kind: 'boolean',
  label: 'Speaker diarization',
  description: 'Request speaker labels so dialogue clips can preserve complete speaker turns.',
  defaultValue: true,
} as const satisfies AutoCutSpeechTranscriptionProviderOptionDefinition;

const AUTOCUT_API_SPEECH_TRANSCRIPTION_HOTWORDS_OPTION = {
  key: 'hotwords',
  kind: 'text',
  label: 'Hotwords',
  description: 'Optional provider hotwords or glossary text for domain terms. Use the provider-native separator documented by the selected service.',
  defaultValue: '',
} as const satisfies AutoCutSpeechTranscriptionProviderOptionDefinition;

const AUTOCUT_STANDARD_OPENAI_COMPATIBLE_STT_OPTIONS = [
  AUTOCUT_API_SPEECH_TRANSCRIPTION_SEGMENT_TIMESTAMP_OPTION,
  AUTOCUT_API_SPEECH_TRANSCRIPTION_WORD_TIMESTAMP_OPTION,
  {
    key: 'responseFormat',
    kind: 'select',
    label: 'Response format',
    description: 'Bridge request format. Verbose JSON is required so timestamps can be normalized into Smart Slice transcript segments.',
    officialParameterName: 'response_format',
    required: true,
    requiredForSmartSlice: true,
    locked: true,
    defaultValue: 'verbose_json',
    choices: [
      { value: 'verbose_json', label: 'Verbose JSON' },
    ],
  },
] as const satisfies readonly AutoCutSpeechTranscriptionProviderOptionDefinition[];

const AUTOCUT_QWEN_PARAFORMER_STT_OPTIONS = [
  AUTOCUT_API_SPEECH_TRANSCRIPTION_SEGMENT_TIMESTAMP_OPTION,
  AUTOCUT_API_SPEECH_TRANSCRIPTION_WORD_TIMESTAMP_OPTION,
  AUTOCUT_API_SPEECH_TRANSCRIPTION_SPEAKER_OPTION,
  {
    key: 'audioFormat',
    kind: 'select',
    label: 'Audio format',
    description: 'Audio/video input format hint for Paraformer file recognition.',
    defaultValue: 'auto',
    choices: [
      { value: 'auto', label: 'Auto detect' },
      { value: 'wav', label: 'WAV' },
      { value: 'mp3', label: 'MP3' },
      { value: 'mp4', label: 'MP4' },
      { value: 'm4a', label: 'M4A' },
      { value: 'flac', label: 'FLAC' },
      { value: 'webm', label: 'WebM' },
    ],
  },
  {
    key: 'channelId',
    kind: 'number',
    label: 'Channel ID',
    description: 'Default audio channel index. Paraformer also supports multi-channel arrays through the bridge.',
    officialParameterName: 'channel_id',
    defaultValue: 0,
    min: 0,
    max: 7,
    step: 1,
  },
  {
    key: 'disfluencyRemovalEnabled',
    kind: 'boolean',
    label: 'Remove disfluency',
    description: 'Maps to disfluency_removal_enabled. Keep off by default so clip text matches spoken timeline evidence.',
    officialParameterName: 'disfluency_removal_enabled',
    defaultValue: false,
  },
  {
    key: 'timestampAlignmentEnabled',
    kind: 'boolean',
    label: 'Timestamp alignment',
    description: 'Maps to timestamp_alignment_enabled for Paraformer timestamp calibration.',
    officialParameterName: 'timestamp_alignment_enabled',
    defaultValue: true,
  },
  {
    key: 'speakerCount',
    kind: 'number',
    label: 'Speaker count',
    description: 'Optional reference speaker count. Use 0 when unknown and let the provider infer speakers.',
    officialParameterName: 'speaker_count',
    defaultValue: 0,
    min: 0,
    max: 20,
    step: 1,
  },
  {
    key: 'languageHints',
    kind: 'multi-select',
    label: 'Language hints',
    description: 'Maps to language_hints for Paraformer v2.',
    officialParameterName: 'language_hints',
    defaultValue: ['zh', 'en'],
    choices: [
      { value: 'zh', label: 'Chinese' },
      { value: 'en', label: 'English' },
      { value: 'ja', label: 'Japanese' },
      { value: 'ko', label: 'Korean' },
    ],
  },
] as const satisfies readonly AutoCutSpeechTranscriptionProviderOptionDefinition[];

const AUTOCUT_IFLYTEK_LONG_FORM_STT_OPTIONS = [
  AUTOCUT_API_SPEECH_TRANSCRIPTION_SEGMENT_TIMESTAMP_OPTION,
  AUTOCUT_API_SPEECH_TRANSCRIPTION_WORD_TIMESTAMP_OPTION,
  AUTOCUT_API_SPEECH_TRANSCRIPTION_SPEAKER_OPTION,
  {
    key: 'language',
    kind: 'select',
    label: 'Language',
    description: 'Maps to iFlytek lfasr language. cn is the official default for Chinese/English mixed recognition.',
    officialParameterName: 'language',
    defaultValue: 'cn',
    choices: [
      { value: 'cn', label: 'Chinese / Chinese-English' },
      { value: 'en', label: 'English' },
    ],
  },
  {
    key: 'hasParticiple',
    kind: 'boolean',
    label: 'Participle result',
    description: 'Maps to has_participle and requests word-like timing evidence when available.',
    officialParameterName: 'has_participle',
    defaultValue: true,
  },
  {
    key: 'engVadMargin',
    kind: 'select',
    label: 'VAD margin',
    description: 'Maps to eng_vad_margin. Keep silence margin visible so the bridge can normalize provider offsets safely.',
    officialParameterName: 'eng_vad_margin',
    defaultValue: 1,
    choices: [
      { value: 0, label: 'Hide silence margin' },
      { value: 1, label: 'Show silence margin' },
    ],
  },
  {
    key: 'hasSeparate',
    kind: 'boolean',
    label: 'Speaker separation',
    description: 'Maps to has_seperate in the iFlytek API.',
    officialParameterName: 'has_seperate',
    defaultValue: true,
  },
  {
    key: 'speakerNumber',
    kind: 'number',
    label: 'Speaker number',
    description: 'Maps to speaker_number. Use 0 for blind diarization.',
    officialParameterName: 'speaker_number',
    defaultValue: 0,
    min: 0,
    max: 10,
    step: 1,
  },
  {
    key: 'roleType',
    kind: 'select',
    label: 'Role type',
    description: 'Maps to role_type when the iFlytek account has role separation enabled.',
    officialParameterName: 'role_type',
    defaultValue: '1',
    choices: [
      { value: '1', label: 'General role separation' },
    ],
  },
  {
    key: 'domain',
    kind: 'select',
    label: 'Domain',
    description: 'Maps to pd for iFlytek vertical-domain recognition.',
    officialParameterName: 'pd',
    defaultValue: 'general',
    choices: [
      { value: 'general', label: 'General' },
      { value: 'edu', label: 'Education' },
      { value: 'finance', label: 'Finance' },
      { value: 'tech', label: 'Technology' },
      { value: 'ecom', label: 'E-commerce' },
      { value: 'medical', label: 'Medical' },
    ],
  },
  AUTOCUT_API_SPEECH_TRANSCRIPTION_HOTWORDS_OPTION,
] as const satisfies readonly AutoCutSpeechTranscriptionProviderOptionDefinition[];

const AUTOCUT_VOLCENGINE_ASR_OPTIONS = [
  {
    ...AUTOCUT_API_SPEECH_TRANSCRIPTION_SEGMENT_TIMESTAMP_OPTION,
    key: 'showUtterances',
    label: 'Utterance timestamps',
    description: 'Required by Smart Slice. Volcengine result.utterances carries start_time/end_time and words.',
  },
  AUTOCUT_API_SPEECH_TRANSCRIPTION_WORD_TIMESTAMP_OPTION,
  AUTOCUT_API_SPEECH_TRANSCRIPTION_SPEAKER_OPTION,
  {
    key: 'resourceId',
    kind: 'select',
    label: 'Resource ID',
    description: 'Maps to X-Api-Resource-Id for recorded bigmodel ASR.',
    officialParameterName: 'X-Api-Resource-Id',
    required: true,
    defaultValue: 'volc.bigasr.auc_turbo',
    choices: [
      { value: 'volc.bigasr.auc_turbo', label: 'Bigmodel flash' },
      { value: 'volc.bigasr.auc', label: 'Bigmodel standard' },
    ],
  },
  {
    key: 'modelName',
    kind: 'select',
    label: 'Model name',
    description: 'Maps to request.model_name.',
    officialParameterName: 'model_name',
    required: true,
    defaultValue: 'bigmodel',
    choices: [
      { value: 'bigmodel', label: 'Bigmodel' },
    ],
  },
  {
    key: 'enablePunctuation',
    kind: 'boolean',
    label: 'Punctuation',
    description: 'Maps to enable_punc when supported by the selected Volcengine endpoint.',
    officialParameterName: 'enable_punc',
    defaultValue: true,
  },
  {
    key: 'enableItn',
    kind: 'boolean',
    label: 'ITN',
    description: 'Maps to enable_itn when supported by the selected Volcengine endpoint.',
    officialParameterName: 'enable_itn',
    defaultValue: true,
  },
] as const satisfies readonly AutoCutSpeechTranscriptionProviderOptionDefinition[];

const AUTOCUT_TENCENT_CLOUD_ASR_OPTIONS = [
  {
    ...AUTOCUT_API_SPEECH_TRANSCRIPTION_SEGMENT_TIMESTAMP_OPTION,
    key: 'resTextFormatDetailed',
    label: 'Detailed result',
    description: 'Required by Smart Slice. Maps to ResTextFormat=3 so ResultDetail contains sentence and word timestamps for subtitles.',
    officialParameterName: 'ResTextFormat',
    defaultValue: true,
  },
  AUTOCUT_API_SPEECH_TRANSCRIPTION_WORD_TIMESTAMP_OPTION,
  AUTOCUT_API_SPEECH_TRANSCRIPTION_SPEAKER_OPTION,
  {
    key: 'engineModelType',
    kind: 'select',
    label: 'Engine model',
    description: 'Maps to EngineModelType. Use 16k_zh_en for Chinese/English/fangyan long video by default.',
    officialParameterName: 'EngineModelType',
    required: true,
    defaultValue: '16k_zh_en',
    choices: [
      { value: '16k_zh_en', label: '16k Chinese-English large model' },
      { value: '16k_zh_large', label: '16k Chinese large model' },
      { value: '16k_zh', label: '16k Chinese' },
      { value: '16k_en', label: '16k English' },
      { value: '16k_multi_lang', label: '16k multilingual' },
      { value: '8k_zh', label: '8k Chinese phone' },
    ],
  },
  {
    key: 'channelNum',
    kind: 'select',
    label: 'Channels',
    description: 'Maps to ChannelNum. 16k engines require mono; 8k phone audio can use dual-channel speaker separation.',
    officialParameterName: 'ChannelNum',
    required: true,
    defaultValue: 1,
    choices: [
      { value: 1, label: 'Mono' },
      { value: 2, label: 'Dual channel' },
    ],
  },
  {
    key: 'sentenceMaxLength',
    kind: 'number',
    label: 'Subtitle max length',
    description: 'Maps to SentenceMaxLength and controls max characters per subtitle sentence when ResTextFormat is 3.',
    officialParameterName: 'SentenceMaxLength',
    defaultValue: 22,
    min: 6,
    max: 40,
    step: 1,
  },
  {
    key: 'speakerNumber',
    kind: 'number',
    label: 'Speaker number',
    description: 'Maps to SpeakerNumber. Use 0 for automatic diarization.',
    officialParameterName: 'SpeakerNumber',
    defaultValue: 0,
    min: 0,
    max: 10,
    step: 1,
  },
  {
    key: 'filterModal',
    kind: 'select',
    label: 'Modal word filter',
    description: 'Maps to FilterModal. Keep disabled by default so transcript text remains aligned with speech.',
    officialParameterName: 'FilterModal',
    defaultValue: 0,
    choices: [
      { value: 0, label: 'Off' },
      { value: 1, label: 'Partial' },
      { value: 2, label: 'Strict' },
    ],
  },
  AUTOCUT_API_SPEECH_TRANSCRIPTION_HOTWORDS_OPTION,
] as const satisfies readonly AutoCutSpeechTranscriptionProviderOptionDefinition[];

const AUTOCUT_BAIDU_CLOUD_ASR_OPTIONS = [
  {
    ...AUTOCUT_API_SPEECH_TRANSCRIPTION_SEGMENT_TIMESTAMP_OPTION,
    key: 'enableTimestamps',
    label: 'Timestamp output',
    description: 'Required by Smart Slice. The Baidu bridge must request timestamp/cue output and normalize it into startMs/endMs segments.',
    defaultValue: true,
  },
  AUTOCUT_API_SPEECH_TRANSCRIPTION_WORD_TIMESTAMP_OPTION,
  {
    key: 'product',
    kind: 'select',
    label: 'Product',
    description: 'Baidu audio file transcription product route used by the provider bridge.',
    defaultValue: 'audio-file-transcription',
    choices: [
      { value: 'audio-file-transcription', label: 'Audio file transcription' },
      { value: 'long-speech-recognition', label: 'Long speech recognition' },
    ],
  },
  {
    key: 'pid',
    kind: 'select',
    label: 'Language model PID',
    description: 'Baidu speech model identifier. 1537 is the common Mandarin input model in Baidu speech APIs.',
    officialParameterName: 'pid',
    defaultValue: 1537,
    choices: [
      { value: 1537, label: 'Mandarin Chinese' },
      { value: 1737, label: 'English' },
    ],
  },
  {
    key: 'audioRate',
    kind: 'select',
    label: 'Sample rate',
    description: 'Audio sample rate hint for Baidu speech recognition.',
    officialParameterName: 'rate',
    defaultValue: 16000,
    choices: [
      { value: 16000, label: '16 kHz' },
      { value: 8000, label: '8 kHz' },
    ],
  },
] as const satisfies readonly AutoCutSpeechTranscriptionProviderOptionDefinition[];

export function createAutoCutSpeechTranscriptionProviderDefaultOptions(
  provider: Pick<AutoCutSpeechTranscriptionProviderDefinition, 'optionSchema'>,
): AutoCutSpeechTranscriptionProviderOptions {
  const options: AutoCutSpeechTranscriptionProviderOptions = {};
  for (const option of provider.optionSchema ?? []) {
    options[option.key] = option.defaultValue;
  }

  return options;
}

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
    officialName: 'OpenAI Audio Transcriptions',
    officialDocsUrl: 'https://platform.openai.com/docs/guides/speech-to-text',
    integrationMode: 'openai-compatible-audio',
    optionSchema: AUTOCUT_STANDARD_OPENAI_COMPATIBLE_STT_OPTIONS,
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
    officialName: 'Qwen audio transcription',
    officialDocsUrl: 'https://help.aliyun.com/zh/model-studio/paraformer-api/',
    integrationMode: 'openai-compatible-audio',
    optionSchema: AUTOCUT_STANDARD_OPENAI_COMPATIBLE_STT_OPTIONS,
    capabilities: AUTOCUT_API_SPEECH_TRANSCRIPTION_CAPABILITIES,
  },
  {
    id: AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER.iflytekLongForm,
    kind: 'api',
    engine: 'model-vendor-api',
    nameKey: 'speechTranscription.provider.iflytekLongForm.name',
    descriptionKey: 'speechTranscription.provider.iflytekLongForm.description',
    defaultName: 'iFlytek long-form ASR',
    defaultDescription: 'Use iFlytek long-form audio transcription through the standard STT provider bridge.',
    modelVendor: 'custom',
    defaultModel: 'iflytek-lfasr',
    officialName: 'iFlytek Long Form ASR',
    officialDocsUrl: 'https://www.xfyun.cn/doc/asr/lfasr/API.html',
    integrationMode: 'iflytek-lfasr-task',
    optionSchema: AUTOCUT_IFLYTEK_LONG_FORM_STT_OPTIONS,
    capabilities: AUTOCUT_API_SPEECH_TRANSCRIPTION_CAPABILITIES,
  },
  {
    id: AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER.volcengineAsr,
    kind: 'api',
    engine: 'model-vendor-api',
    nameKey: 'speechTranscription.provider.volcengineAsr.name',
    descriptionKey: 'speechTranscription.provider.volcengineAsr.description',
    defaultName: 'Volcengine ASR',
    defaultDescription: 'Use Volcengine recorded audio ASR through the standard STT provider bridge.',
    modelVendor: 'doubao',
    defaultModel: 'bigmodel',
    officialName: 'Volcengine recorded audio ASR',
    officialDocsUrl: 'https://www.volcengine.com/docs/6561/1631584',
    integrationMode: 'volcengine-bigmodel-recorded-audio',
    optionSchema: AUTOCUT_VOLCENGINE_ASR_OPTIONS,
    capabilities: AUTOCUT_API_SPEECH_TRANSCRIPTION_CAPABILITIES,
  },
  {
    id: AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER.qwenParaformer,
    kind: 'api',
    engine: 'model-vendor-api',
    nameKey: 'speechTranscription.provider.qwenParaformer.name',
    descriptionKey: 'speechTranscription.provider.qwenParaformer.description',
    defaultName: 'Alibaba Qwen Paraformer',
    defaultDescription: 'Use DashScope Paraformer recorded file recognition through the standard STT provider bridge.',
    modelVendor: 'qwen',
    defaultModel: 'paraformer-v2',
    officialName: 'DashScope Paraformer recorded speech recognition',
    officialDocsUrl: 'https://www.alibabacloud.com/help/doc-detail/2869541.html',
    integrationMode: 'dashscope-paraformer-task',
    optionSchema: AUTOCUT_QWEN_PARAFORMER_STT_OPTIONS,
    capabilities: AUTOCUT_API_SPEECH_TRANSCRIPTION_CAPABILITIES,
  },
  {
    id: AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER.tencentCloudAsr,
    kind: 'api',
    engine: 'model-vendor-api',
    nameKey: 'speechTranscription.provider.tencentCloudAsr.name',
    descriptionKey: 'speechTranscription.provider.tencentCloudAsr.description',
    defaultName: 'Tencent Cloud ASR',
    defaultDescription: 'Use Tencent Cloud recorded file recognition through the standard STT provider bridge.',
    modelVendor: 'hunyuan',
    defaultModel: '16k_zh_en',
    officialName: 'Tencent Cloud CreateRecTask',
    officialDocsUrl: 'https://cloud.tencent.com/document/api/1093/37822',
    integrationMode: 'tencent-cloud-recorded-task',
    optionSchema: AUTOCUT_TENCENT_CLOUD_ASR_OPTIONS,
    capabilities: AUTOCUT_API_SPEECH_TRANSCRIPTION_CAPABILITIES,
  },
  {
    id: AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER.baiduCloudAsr,
    kind: 'api',
    engine: 'model-vendor-api',
    nameKey: 'speechTranscription.provider.baiduCloudAsr.name',
    descriptionKey: 'speechTranscription.provider.baiduCloudAsr.description',
    defaultName: 'Baidu Cloud ASR',
    defaultDescription: 'Use Baidu Cloud long audio transcription through the standard STT provider bridge.',
    modelVendor: 'baidu',
    defaultModel: 'audio-file-transcription',
    officialName: 'Baidu Cloud audio file transcription',
    officialDocsUrl: 'https://ai.baidu.com/ai-doc/SPEECH/Clhohwkbv',
    integrationMode: 'baidu-cloud-audio-transcription-task',
    optionSchema: AUTOCUT_BAIDU_CLOUD_ASR_OPTIONS,
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
    officialName: 'Gemini audio understanding',
    officialDocsUrl: 'https://ai.google.dev/gemini-api/docs/audio',
    integrationMode: 'openai-compatible-audio',
    optionSchema: AUTOCUT_STANDARD_OPENAI_COMPATIBLE_STT_OPTIONS,
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
    officialName: 'Custom OpenAI-compatible transcription API',
    officialDocsUrl: 'https://platform.openai.com/docs/guides/speech-to-text',
    integrationMode: 'openai-compatible-audio',
    optionSchema: AUTOCUT_STANDARD_OPENAI_COMPATIBLE_STT_OPTIONS,
    capabilities: AUTOCUT_API_SPEECH_TRANSCRIPTION_CAPABILITIES,
  },
] as const satisfies readonly AutoCutSpeechTranscriptionProviderDefinition[];

export const AUTOCUT_SMART_SLICE_CLOUD_STT_PROVIDER_IDS = [
  AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER.iflytekLongForm,
  AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER.volcengineAsr,
  AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER.qwenParaformer,
  AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER.tencentCloudAsr,
  AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER.baiduCloudAsr,
] as const satisfies readonly AutoCutSpeechTranscriptionProviderId[];

export const AUTOCUT_DEFAULT_SPEECH_TRANSCRIPTION_PROVIDER_ID: AutoCutSpeechTranscriptionProviderId =
  AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER.openAiTranscription;

export type AutoCutSpeechTranscriptionExecutionProfile =
  | 'balanced'
  | 'fast-preview'
  | 'quality'
  | 'cloud'
  | 'gpu';

export interface AutoCutSpeechTranscriptionWorkflowPreset {
  id: string;
  label: string;
  description: string;
  providerId: AutoCutSpeechTranscriptionProviderId;
  executionProfile: AutoCutSpeechTranscriptionExecutionProfile;
  modelPresetId?: string;
  modelVendor?: ModelVendor;
  model?: string;
  localWhisper?: {
    chunkParallelism: number;
    chunkThreadCount: number;
    chunkSourceStrategy: 'audio-first' | 'source-direct';
    decode?: {
      audioContext?: number;
      beamSize?: number;
      bestOf?: number;
      noFallback?: boolean;
    };
  };
  recommended?: boolean;
  available: boolean;
  unavailableReason?: string;
}

export const AUTOCUT_SPEECH_TRANSCRIPTION_WORKFLOW_PRESETS = [
  {
    id: 'smart-slice-balanced-local',
    label: 'Local privacy',
    description: 'Offline Whisper mode for privacy-sensitive runs when cloud transcription is not allowed.',
    providerId: AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER.localWhisperCli,
    executionProfile: 'balanced',
    modelPresetId: 'whisper-cpp-large-v3-turbo-q5',
    localWhisper: {
      chunkParallelism: 3,
      chunkThreadCount: 2,
      chunkSourceStrategy: 'source-direct',
      decode: {
        beamSize: 1,
        bestOf: 1,
        noFallback: true,
      },
    },
    available: true,
  },
  {
    id: 'smart-slice-fast-preview',
    label: 'Fast preview',
    description: 'Prioritize long-video turnaround for preview segmentation by running more local Whisper chunks concurrently.',
    providerId: AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER.localWhisperCli,
    executionProfile: 'fast-preview',
    modelPresetId: 'whisper-cpp-large-v3-turbo-q5',
    localWhisper: {
      chunkParallelism: 4,
      chunkThreadCount: 2,
      chunkSourceStrategy: 'source-direct',
      decode: {
        beamSize: 1,
        bestOf: 1,
        noFallback: true,
      },
    },
    available: true,
  },
  {
    id: 'smart-slice-quality-local',
    label: 'Quality local',
    description: 'Prioritize transcript quality and machine stability for final Smart Slice production runs.',
    providerId: AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER.localWhisperCli,
    executionProfile: 'quality',
    modelPresetId: 'whisper-cpp-large-v3-turbo-q5',
    localWhisper: {
      chunkParallelism: 1,
      chunkThreadCount: 6,
      chunkSourceStrategy: 'audio-first',
    },
    available: true,
  },
  {
    id: 'smart-slice-cloud-stt',
    label: 'Smart cloud',
    description: 'Commercial default for long videos: cloud STT with structured timestamps and speaker diarization when the provider supports it.',
    providerId: AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER.qwenParaformer,
    executionProfile: 'cloud',
    modelVendor: 'qwen',
    model: 'paraformer-v2',
    recommended: true,
    available: true,
  },
  {
    id: 'smart-slice-gpu-local',
    label: 'GPU local',
    description: 'Use a GPU-enabled local whisper.cpp runtime when CUDA, Vulkan, Metal, Core ML, or OpenVINO support is detected.',
    providerId: AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER.localWhisperCli,
    executionProfile: 'gpu',
    modelPresetId: 'whisper-cpp-large-v3-turbo-q5',
    localWhisper: {
      chunkParallelism: 2,
      chunkThreadCount: 2,
      chunkSourceStrategy: 'audio-first',
    },
    available: true,
    unavailableReason: 'GPU local STT requires a CUDA, Vulkan, Metal, Core ML, or OpenVINO enabled whisper.cpp runtime selected in Speech-to-Text settings.',
  },
] as const satisfies readonly AutoCutSpeechTranscriptionWorkflowPreset[];

export const AUTOCUT_DEFAULT_SPEECH_TRANSCRIPTION_WORKFLOW_PRESET_ID =
  'smart-slice-cloud-stt' as const;

export function getAutoCutSpeechTranscriptionWorkflowPreset(
  presetId: string | undefined,
): AutoCutSpeechTranscriptionWorkflowPreset {
  return AUTOCUT_SPEECH_TRANSCRIPTION_WORKFLOW_PRESETS.find((preset) => preset.id === presetId) ??
    AUTOCUT_SPEECH_TRANSCRIPTION_WORKFLOW_PRESETS[0];
}

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
  providerOptions?: AutoCutSpeechTranscriptionProviderOptions;
  apiKeyConfigured?: boolean;
  configured: boolean;
  lastTestedAt?: string;
  lastProbeReady?: boolean;
  lastProbeDiagnostics?: string[];
}

export interface AutoCutSmartSliceTranscriptSpeaker {
  id: string;
  label: string;
  confidence?: number;
  role?: string;
}

export interface AutoCutSmartSliceTranscriptWord {
  startMs: number;
  endMs: number;
  text: string;
  confidence?: number;
}

export interface AutoCutSmartSliceTranscriptSegment {
  id: string;
  startMs: number;
  endMs: number;
  speakerId: string;
  text: string;
  confidence?: number;
  words?: AutoCutSmartSliceTranscriptWord[];
}

export interface AutoCutSmartSliceTranscript {
  schema: 'smart-slice.transcript.v1';
  providerId: AutoCutSpeechTranscriptionProviderId | (string & {});
  language: string;
  durationMs?: number;
  text: string;
  speakers: AutoCutSmartSliceTranscriptSpeaker[];
  segments: AutoCutSmartSliceTranscriptSegment[];
  qualityGuard?: {
    status: string;
    passed: boolean;
    risks: Array<{ code: string; severity: string; message: string }>;
  };
  createdAt: string;
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

const AUTOCUT_TRANSCRIPT_EVIDENCE_FILLER_SEPARATOR_CLASS = String.raw`[\s,.;:!?\u3001\u3002\uff0c\uff1b\uff1a\uff01\uff1f\u2026]`;
const AUTOCUT_TRANSCRIPT_EVIDENCE_AUDIBLE_ENGLISH_FILLER_PATTERN = String.raw`(?:um+|uh+|er+|erm|ah+|hmm+|mm+)`;
const AUTOCUT_TRANSCRIPT_EVIDENCE_SAFE_ENGLISH_FILLER_PHRASE_PATTERN = String.raw`(?:${AUTOCUT_TRANSCRIPT_EVIDENCE_AUDIBLE_ENGLISH_FILLER_PATTERN}|well|you know|i mean|okay|ok)`;
const AUTOCUT_TRANSCRIPT_EVIDENCE_CHINESE_AUDIBLE_FILLER_PATTERN = String.raw`[\u55ef\u5443\u989d\u554a\u54ce\u5514\u5594\u54e6]+`;
const AUTOCUT_TRANSCRIPT_EVIDENCE_SAFE_CHINESE_FILLER_PHRASE_PATTERN = String.raw`(?:\u90a3\u4e2a|\u8fd9\u4e2a|\u5c31\u662f)`;
const AUTOCUT_TRANSCRIPT_EVIDENCE_FILLER_PREFIX_PATTERN = new RegExp(
  String.raw`^(?:(?:${AUTOCUT_TRANSCRIPT_EVIDENCE_SAFE_ENGLISH_FILLER_PHRASE_PATTERN})(?=$|${AUTOCUT_TRANSCRIPT_EVIDENCE_FILLER_SEPARATOR_CLASS})|${AUTOCUT_TRANSCRIPT_EVIDENCE_CHINESE_AUDIBLE_FILLER_PATTERN}|(?:${AUTOCUT_TRANSCRIPT_EVIDENCE_SAFE_CHINESE_FILLER_PHRASE_PATTERN})(?=$|${AUTOCUT_TRANSCRIPT_EVIDENCE_FILLER_SEPARATOR_CLASS}))${AUTOCUT_TRANSCRIPT_EVIDENCE_FILLER_SEPARATOR_CLASS}*`,
  'iu',
);
const AUTOCUT_TRANSCRIPT_EVIDENCE_FILLER_SUFFIX_PATTERN = new RegExp(
  String.raw`(?:${AUTOCUT_TRANSCRIPT_EVIDENCE_FILLER_SEPARATOR_CLASS}+(?:${AUTOCUT_TRANSCRIPT_EVIDENCE_SAFE_ENGLISH_FILLER_PHRASE_PATTERN})(?=$|${AUTOCUT_TRANSCRIPT_EVIDENCE_FILLER_SEPARATOR_CLASS})|${AUTOCUT_TRANSCRIPT_EVIDENCE_CHINESE_AUDIBLE_FILLER_PATTERN}|(?:${AUTOCUT_TRANSCRIPT_EVIDENCE_SAFE_CHINESE_FILLER_PHRASE_PATTERN})(?=$|${AUTOCUT_TRANSCRIPT_EVIDENCE_FILLER_SEPARATOR_CLASS}))${AUTOCUT_TRANSCRIPT_EVIDENCE_FILLER_SEPARATOR_CLASS}*$`,
  'iu',
);
const AUTOCUT_TRANSCRIPT_EVIDENCE_FILLER_TOKEN_PATTERN = new RegExp(
  String.raw`\b${AUTOCUT_TRANSCRIPT_EVIDENCE_SAFE_ENGLISH_FILLER_PHRASE_PATTERN}\b|${AUTOCUT_TRANSCRIPT_EVIDENCE_CHINESE_AUDIBLE_FILLER_PATTERN}|${AUTOCUT_TRANSCRIPT_EVIDENCE_SAFE_CHINESE_FILLER_PHRASE_PATTERN}`,
  'giu',
);
const AUTOCUT_TRANSCRIPT_EVIDENCE_DANGLING_SEPARATOR_PATTERN = new RegExp(
  String.raw`^[\s,;:\u3001\uff0c\uff1b\uff1a]+|[\s,;:\u3001\uff0c\uff1b\uff1a]+$`,
  'gu',
);
const AUTOCUT_TRANSCRIPT_EVIDENCE_FILLER_ONLY_EDGE_PATTERN = new RegExp(
  String.raw`^${AUTOCUT_TRANSCRIPT_EVIDENCE_FILLER_SEPARATOR_CLASS}+|${AUTOCUT_TRANSCRIPT_EVIDENCE_FILLER_SEPARATOR_CLASS}+$`,
  'gu',
);
const AUTOCUT_TRANSCRIPT_EVIDENCE_NOISE_ONLY_PATTERN = new RegExp(
  String.raw`^(?:[\[\(\uFF08\u3010]?\s*(?:cough(?:ing)?|coughs?|laugh(?:ing)?|laughter|applause|music(?:\s+(?:playing|continues?))?|background music|silence|silent|noise|background noise|ambient noise|blank[\s_-]*audio|no[\s_-]*(?:speech|audio|sound)|non[\s_-]*speech|breath(?:ing)?|sigh|inaudible|unintelligible|bgm|\u54b3\u55fd|\u7b11\u58f0|\u5927\u7b11|\u638c\u58f0|\u97f3\u4e50|\u9759\u97f3|\u566a\u58f0|\u6742\u97f3|\u547c\u5438|\u5598\u6c14|\u53f9\u6c14|\u542c\u4e0d\u6e05|\u65e0\u58f0)\s*[\]\)\uFF09\u3011]?|(?:ha|haha|hahaha|[\u54c8\u5475\u563f]{2,})+)$`,
  'iu',
);

function trimAutoCutTranscriptEvidenceEdgePunctuation(text: string) {
  return text.replace(AUTOCUT_TRANSCRIPT_EVIDENCE_DANGLING_SEPARATOR_PATTERN, '').trim();
}

function trimAutoCutTranscriptEvidenceFillerOnlyPunctuation(text: string) {
  return text.replace(AUTOCUT_TRANSCRIPT_EVIDENCE_FILLER_ONLY_EDGE_PATTERN, '').trim();
}

export function normalizeAutoCutTranscriptEvidenceText(text: string) {
  let normalizedText = text.trim().replace(/\s+/gu, ' ');
  if (!normalizedText) {
    return '';
  }

  let previousText = '';
  while (normalizedText && normalizedText !== previousText) {
    previousText = normalizedText;
    normalizedText = normalizedText
      .replace(AUTOCUT_TRANSCRIPT_EVIDENCE_FILLER_PREFIX_PATTERN, '')
      .replace(AUTOCUT_TRANSCRIPT_EVIDENCE_FILLER_SUFFIX_PATTERN, '');
    normalizedText = trimAutoCutTranscriptEvidenceEdgePunctuation(normalizedText).replace(/\s+/gu, ' ');
  }

  return normalizedText;
}

export function isLowInformationAutoCutTranscriptEvidenceText(text: string) {
  const normalizedText = text.trim().replace(/\s+/gu, ' ');
  if (!normalizedText) {
    return true;
  }

  const noiseCandidate = trimAutoCutTranscriptEvidenceEdgePunctuation(
    normalizedText
      .replace(/^[\[\(\uFF08\u3010\s]*/u, '')
      .replace(/[\]\)\uFF09\u3011\s]*$/u, ''),
  ).replace(/\s+/gu, ' ');
  if (AUTOCUT_TRANSCRIPT_EVIDENCE_NOISE_ONLY_PATTERN.test(noiseCandidate)) {
    return true;
  }

  const normalizedEvidenceText = normalizeAutoCutTranscriptEvidenceText(normalizedText);
  if (!normalizedEvidenceText) {
    return true;
  }

  const withoutFiller = trimAutoCutTranscriptEvidenceEdgePunctuation(
    normalizedEvidenceText.replace(AUTOCUT_TRANSCRIPT_EVIDENCE_FILLER_TOKEN_PATTERN, ' '),
  ).replace(/\s+/gu, ' ');

  return withoutFiller.length === 0 ||
    trimAutoCutTranscriptEvidenceFillerOnlyPunctuation(withoutFiller).length === 0;
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
  gpu: {
    ready: boolean;
    backend?: string;
    diagnostics: string[];
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

export interface AutoCutSmartSliceSegmentationAgentDefinition {
  id: string;
  label: string;
  description: string;
  systemPrompt: string;
}

export const AUTOCUT_SMART_SLICE_SEGMENTATION_AGENTS = [
  {
    id: 'semantic-story-agent',
    label: 'Semantic story agent',
    description: 'Ranks STT-backed candidates by one complete idea arc with hook, setup, conflict, and payoff.',
    systemPrompt:
      'Agent id: semantic-story-agent. Select coherent semantic story segments from provided candidate ids. Prefer candidates whose contentUnitIds form one complete idea arc with setup, tension, and payoff. Penalize topic drift, broken sentence boundaries, missing context, and open endings. Use only provided candidate ids and contentUnitIds. Do not output timestamps, startMs, endMs, durationMs, frame numbers, or new cut ranges.',
  },
  {
    id: 'dialogue-turn-agent',
    label: 'Dialogue turn agent',
    description: 'Ranks interview, meeting, and multi-speaker candidates by complete speaker turn exchange continuity.',
    systemPrompt:
      'Agent id: dialogue-turn-agent. Select dialogue and meeting segments from provided candidate ids. Preserve speaker turn continuity, question-answer completeness, moderator context, objections, decisions, and action items. Prefer candidates whose contentUnitIds include the needed prior speaker turn and the resolving turn. Penalize orphan answers, missing questions, interrupted turns, and unresolved multi-speaker exchanges. Use only provided candidate ids and contentUnitIds. Do not output timestamps, startMs, endMs, durationMs, frame numbers, or new cut ranges.',
  },
  {
    id: 'teaching-step-agent',
    label: 'Teaching step agent',
    description: 'Ranks tutorials, lectures, and knowledge clips by complete instructional step boundaries.',
    systemPrompt:
      'Agent id: teaching-step-agent. Select teaching and tutorial segments from provided candidate ids. Prefer candidates whose contentUnitIds contain a complete teaching step: problem statement, explanation, example or procedure, and takeaway. Penalize missing prerequisites, cut-off examples, dangling references, and steps that require unseen context. Use only provided candidate ids and contentUnitIds. Do not output timestamps, startMs, endMs, durationMs, frame numbers, or new cut ranges.',
  },
] as const satisfies readonly AutoCutSmartSliceSegmentationAgentDefinition[];

export type AutoCutSmartSliceSegmentationAgentId =
  typeof AUTOCUT_SMART_SLICE_SEGMENTATION_AGENTS[number]['id'];

export const AUTOCUT_SMART_SLICE_SEGMENTATION_AGENT_IDS =
  AUTOCUT_SMART_SLICE_SEGMENTATION_AGENTS.map((agent) => agent.id);

export const AUTOCUT_DEFAULT_SMART_SLICE_SEGMENTATION_AGENT_ID: AutoCutSmartSliceSegmentationAgentId =
  'semantic-story-agent';

export function getAutoCutSmartSliceSegmentationAgentDefinition(
  agentId: unknown,
): (typeof AUTOCUT_SMART_SLICE_SEGMENTATION_AGENTS)[number] {
  return AUTOCUT_SMART_SLICE_SEGMENTATION_AGENTS.find((agent) => agent.id === agentId) ??
    AUTOCUT_SMART_SLICE_SEGMENTATION_AGENTS[0];
}

export interface AutoCutLlmSettings {
  modelVendor: ModelVendor;
  baseUrl: string;
  model: string;
  apiKey?: string;
  maskedApiKey?: string;
  apiKeyConfigured: boolean;
  temperature: number;
  maxTokens: number;
  defaultSegmentationAgentId: AutoCutSmartSliceSegmentationAgentId;
}

export interface AutoCutLlmRuntimeConfig {
  modelVendor: ModelVendor;
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
  sessionApiKey?: string;
  temperature: number;
  maxTokens: number;
  defaultSegmentationAgentId: AutoCutSmartSliceSegmentationAgentId;
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
  idealDuration: number;
  continuityLevel: SliceContinuityLevel;
  segmentationDensity: SliceSegmentationDensity;
  sttPresetId: string;
  customKeywordsInput: string;
  minDuration: number;
  maxDuration: number;
  llmModel: SliceLLM;
  segmentationAgentId: AutoCutSmartSliceSegmentationAgentId;
  baseAlgorithm: SliceAlgorithm;
  highlightEngine: SliceHighlightEngine;
  enableNoiseReduction: boolean;
  enableCoughFilter: boolean;
  enableRepeatFilter: boolean;
  enableSmartDedup: boolean;
  videoDedupParams: VideoDedupParams;
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
  reviewing: 'reviewing',
  completed: 'completed',
  failed: 'failed',
  canceled: 'canceled',
  interrupted: 'interrupted',
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
  videoDedup: 'video-dedup',
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
  AUTOCUT_TASK_TYPE.videoDedup,
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

export interface AutoCutTranscriptCorrectionAudit {
  source: 'task-detail';
  correctedAt: string;
  originalTranscriptText: string;
  correctionCount: number;
}

export interface AutoCutVideoSliceSourceSegment {
  startMs: number;
  endMs: number;
}

export type AutoCutSliceReviewSegmentStatus = 'selected' | 'excluded' | 'duplicate';
export type AutoCutSliceManualEditKind =
  | 'select'
  | 'exclude'
  | 'split'
  | 'merge'
  | 'deleteDuplicate'
  | 'restore'
  | 'correctSegment';

export interface AutoCutSliceReviewSegment {
  id: string;
  sourceClipIndex: number;
  status: AutoCutSliceReviewSegmentStatus;
  selected: boolean;
  title: string;
  summary?: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  boundaryVersion?: number;
  speechStartMs?: number;
  speechEndMs?: number;
  contentUnitIds: string[];
  speakerIds: string[];
  speakerRoles: string[];
  transcriptText?: string;
  transcriptSegments?: AutoCutTranscriptSegment[];
  risks: string[];
  qualityScore?: number;
  continuityScore?: number;
  publishabilityScore?: number;
  publishabilityGrade?: 'excellent' | 'good' | 'review' | 'reject';
  duplicateGroupId?: string | undefined;
  duplicateOfSegmentId?: string | undefined;
  manualNotes?: string;
}

export interface AutoCutSliceDuplicateGroup {
  id: string;
  segmentIds: string[];
  keptSegmentId: string;
  reason: 'semantic-repeat' | 'manual-duplicate' | 'smart-dedup';
  matchIds?: string[];
  sourceAssetIds?: string[];
  targetAssetIds?: string[];
  confidence?: number;
  evidenceLabels?: string[];
}

export interface AutoCutSliceManualEdit {
  id: string;
  kind: AutoCutSliceManualEditKind;
  segmentIds: string[];
  createdAt: string;
  reason?: string;
  splitAtMs?: number;
  keepSegmentId?: string;
  createdSegmentIds?: string[];
  patch?: Partial<Pick<
    AutoCutSliceReviewSegment,
    | 'title'
    | 'summary'
    | 'startMs'
    | 'endMs'
    | 'speechStartMs'
    | 'speechEndMs'
    | 'boundaryVersion'
    | 'speakerIds'
    | 'speakerRoles'
    | 'transcriptText'
    | 'manualNotes'
  >>;
}

export interface AutoCutSliceReviewSession {
  id: string;
  schema: 'slice.review.v1';
  status: 'ready_for_review' | 'ready_for_render' | 'rendering' | 'rendered';
  taskId: string;
  createdAt: string;
  updatedAt: string;
  sourceAssetUuid?: string;
  sourceDurationMs?: number;
  segmentationAgentId?: AutoCutSmartSliceSegmentationAgentId;
  smartDedupReport?: VideoDedupReport;
  segments: AutoCutSliceReviewSegment[];
  duplicateGroups: AutoCutSliceDuplicateGroup[];
  manualEdits: AutoCutSliceManualEdit[];
  selectedSegmentIds: string[];
}

export interface AutoCutSliceRenderSelection {
  reviewSessionId: string;
  selectedSegmentIds: string[];
  manualEdits?: AutoCutSliceManualEdit[];
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
  audioCleanupProfile?: string;
  noiseReductionApplied?: boolean;
  boundaryDecisionSource?: 'transcript' | 'audio' | 'combined';
  audioActivityStartMs?: number;
  audioActivityEndMs?: number;
  audioActivityConfidence?: number;
  audioActivityAnalysisFilter?: string;
  leadingSilenceMs?: number;
  trailingSilenceMs?: number;
  leadingSilenceTrimMs?: number;
  trailingSilenceTrimMs?: number;
  sourceSegments?: AutoCutVideoSliceSourceSegment[];
  renderedDurationMs?: number;
  removedSilenceMs?: number;
  internalSilenceTrimCount?: number;
  tailTreatment?: 'none' | 'semantic-extend' | 'fade-out';
  transcriptText?: string;
  transcriptSegments?: AutoCutTranscriptSegment[];
  transcriptSegmentCount?: number;
  transcriptCoverageScore?: number;
  speechContinuityGrade?: 'strong' | 'repaired' | 'weak';
  transcriptCorrection?: AutoCutTranscriptCorrectionAudit;
}

export type AutoCutTaskExecutionStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelRequested'
  | 'canceled'
  | 'interrupted'
  | 'skipped';

export type AutoCutTaskExecutionLogSeverity = 'debug' | 'info' | 'warning' | 'error';

export interface AutoCutTaskExecutionStep {
  id: string;
  label: string;
  status: AutoCutTaskExecutionStepStatus;
  progress: number;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  attempts: number;
  canResumeFromHere: boolean;
  checkpointKey?: string;
  inputArtifactRefs?: string[];
  outputArtifactRefs?: string[];
  message?: string;
  errorMessage?: string;
  diagnostics?: string;
}

export interface AutoCutTaskExecutionLog {
  id: string;
  taskId: string;
  stepId?: string;
  eventType: string;
  severity: AutoCutTaskExecutionLogSeverity;
  message: string;
  progress?: number;
  phase?: string;
  source?: string;
  timestamp: string;
  elapsedMs?: number;
  details?: Record<string, unknown>;
}

export interface AutoCutTaskExecutionCheckpoint {
  workflowId: string;
  version: number;
  resumeFromStepIds: string[];
  completedStepIds: string[];
  artifacts: Record<string, unknown>;
  updatedAt: string;
  source?: {
    kind: 'trusted-local-file' | 'native-asset' | 'url' | 'unknown';
    sourcePath?: string;
    fileId?: string;
    fileName?: string;
    byteSize?: number;
    mediaType?: string;
    mimeType?: string;
    hasAudioStream?: boolean;
    hasVideoStream?: boolean;
    url?: string;
  };
  params?: Record<string, unknown>;
}

export type AutoCutSlicingEngineId =
  | 'transcript-semantic-v2'
  | 'dialogue-speaker-v1'
  | 'commerce-live-v1'
  | 'visual-scene-v1'
  | 'pause-keyword-v1'
  | 'manual-timeline-v1';

export type AutoCutClipWorkflowStepKey =
  | 'prepare-source'
  | 'probe-media'
  | 'engine-analysis'
  | 'speech-to-text'
  | 'build-transcript-index'
  | 'content-understanding-segmentation'
  | 'speaker-diarization'
  | 'dialogue-unit-segmentation'
  | 'product-entity-extraction'
  | 'scene-detection'
  | 'motion-audio-analysis'
  | 'generate-clips'
  | 'timeline-preview-edit'
  | 'refine-clips'
  | 'process-clips'
  | 'render-clips'
  | 'verify-clips'
  | 'persist-results';

export type AutoCutClipWorkflowStepPhase =
  | 'source'
  | 'analysis'
  | 'clip-generation'
  | 'human-review'
  | 'processing'
  | 'rendering'
  | 'verification'
  | 'persistence';

export interface AutoCutClipWorkflowStepTemplate {
  key: AutoCutClipWorkflowStepKey;
  phase: AutoCutClipWorkflowStepPhase;
  label: string;
  order: number;
  progressWeight: number;
  canResumeFromHere: boolean;
  runsPerClip?: boolean;
  clipProcessingOperationKeys?: ClipProcessingOperationKey[];
  reviewUiContract?: 'source-timeline' | 'clip-list' | 'none';
  producedOutputs: string[];
  requiredInputs: string[];
}

export interface AutoCutClipWorkflowTemplate {
  id: AutoCutSlicingEngineId;
  label: string;
  version: number;
  clipType: StudioClipType;
  steps: AutoCutClipWorkflowStepTemplate[];
  sharedConvergenceStepKeys: AutoCutClipWorkflowStepKey[];
}

export type StudioClipType =
  | 'speech'
  | 'dialogue'
  | 'scene'
  | 'product'
  | 'meeting'
  | 'performance'
  | 'manual';

export type StudioTimelineStatus = 'draft' | 'ready_for_render' | 'rendering' | 'rendered';
export type StudioClipStatus =
  | 'candidate'
  | 'selected'
  | 'excluded'
  | 'duplicate'
  | 'processing'
  | 'processed'
  | 'rendering'
  | 'rendered'
  | 'failed';
export type StudioClipSourceRefType =
  | 'text_segment'
  | 'content_unit'
  | 'speaker_turn'
  | 'scene_segment'
  | 'motion_event'
  | 'audio_event'
  | 'product_entity'
  | 'manual_marker';

export type ClipProcessingOperationKey =
  | 'denoise-audio'
  | 'normalize-loudness'
  | 'remove-cough-and-breath-noise'
  | 'trim-silence'
  | 'filter-repeated-content'
  | 'check-duplicate-content'
  | 'refine-subtitle-cues'
  | 'select-cover-frame';

export type ClipProcessingOperationExecutionStage =
  | 'audio-foundation'
  | 'speech-cleanup'
  | 'content-cleanup'
  | 'publishing-assets';

export type ClipProcessingOperationStatus =
  | 'blocked'
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'skipped'
  | 'failed'
  | 'invalidated';

export type ClipProcessingOperationBlockingReason =
  | 'waiting-for-dependencies'
  | 'timeline-not-ready'
  | 'clip-not-selected';

export const CLIP_PROCESSING_OPERATION_STATUS_CODE = {
  blocked: 10,
  pending: 20,
  running: 30,
  succeeded: 40,
  skipped: 50,
  failed: 60,
  invalidated: 70,
} as const satisfies Record<ClipProcessingOperationStatus, number>;

export type ClipProcessingOperationStatusCode =
  typeof CLIP_PROCESSING_OPERATION_STATUS_CODE[ClipProcessingOperationStatus];

export const CLIP_PROCESSING_OPERATION_STATUS_KEY_BY_CODE = {
  10: 'blocked',
  20: 'pending',
  30: 'running',
  40: 'succeeded',
  50: 'skipped',
  60: 'failed',
  70: 'invalidated',
} as const satisfies Record<ClipProcessingOperationStatusCode, ClipProcessingOperationStatus>;

export interface ClipProcessingOperationPlanItem {
  key: ClipProcessingOperationKey;
  order: number;
  label: string;
  enabled: boolean;
  executionStage: ClipProcessingOperationExecutionStage;
  dependencyOperationKeys: ClipProcessingOperationKey[];
  parallelGroup: 'audio-cleanup' | 'content-cleanup' | 'subtitle' | 'cover';
  requiredInputs: string[];
  producedOutputs: string[];
  invalidatedByBoundaryEdit: boolean;
  metadata?: Record<string, unknown>;
}

export interface ClipProcessingPlan {
  schema: 'clip.processing.plan.v1';
  mode: 'per-clip-after-boundary-lock';
  operations: ClipProcessingOperationPlanItem[];
  operationKeys: ClipProcessingOperationKey[];
}

export interface StudioClipQuality {
  qualityScore?: number;
  continuityScore?: number;
  publishabilityScore?: number;
  publishabilityGrade?: 'excellent' | 'good' | 'review' | 'reject';
  transcriptCoverageScore?: number;
  speechContinuityGrade?: 'strong' | 'repaired' | 'weak';
}

export interface StudioClipRisk {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message?: string;
}

export interface StudioTimeline {
  id: string;
  schema: 'studio.timeline.v1';
  taskId: string;
  workflowRunId?: string;
  sourceAssetUuid?: string;
  status: StudioTimelineStatus;
  timelineType: 'slice_review';
  durationMs: number;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface StudioClipSourceRef {
  id: string;
  clipId: string;
  sourceType: StudioClipSourceRefType;
  sourceId: string;
  sourceIndex?: number;
  startMs?: number;
  endMs?: number;
  coverageRatio?: number;
  metadata?: Record<string, unknown>;
}

export interface StudioClipProcessingOperation {
  id: string;
  timelineId: string;
  clipId: string;
  taskId: string;
  workflowRunId?: string;
  stepRunId?: string;
  operationKey: ClipProcessingOperationKey;
  operationOrder: number;
  executionStage: ClipProcessingOperationExecutionStage;
  dependencyOperationKeys: ClipProcessingOperationKey[];
  blockedByOperationKeys: ClipProcessingOperationKey[];
  blockingReason?: ClipProcessingOperationBlockingReason;
  status: ClipProcessingOperationStatus;
  statusKey: ClipProcessingOperationStatus;
  statusCode: ClipProcessingOperationStatusCode;
  enabled: boolean;
  attemptNo: number;
  maxAttempts: number;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  workerId?: string;
  clipBoundaryVersion: number;
  sourceStartMs: number;
  sourceEndMs: number;
  sourceDurationMs: number;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  evidenceArtifactUuid?: string;
  errorCode?: string;
  errorMessage?: string;
  invalidatedByEventId?: string;
  invalidatedAt?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface StudioClip {
  id: string;
  timelineId: string;
  taskId: string;
  workflowRunId?: string;
  sourceAssetUuid?: string;
  engineId: AutoCutSlicingEngineId;
  clipType: StudioClipType;
  status: StudioClipStatus;
  selected: boolean;
  order: number;
  title?: string;
  summary?: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  boundaryVersion: number;
  speechStartMs?: number;
  speechEndMs?: number;
  transcriptTextSnapshot?: string;
  sourceRefs: StudioClipSourceRef[];
  contentUnitIds: string[];
  speakerIds: string[];
  speakerRoles: string[];
  processingPlan: ClipProcessingPlan;
  quality: StudioClipQuality;
  risks: StudioClipRisk[];
  preview: {
    sourceStartMs: number;
    sourceEndMs: number;
    loop: boolean;
  };
  renderArtifactUuid?: string;
  thumbnailArtifactUuid?: string;
  subtitleArtifactUuid?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface StudioClipEvent {
  id: string;
  timelineId: string;
  clipId?: string;
  taskId: string;
  eventType:
    | 'clip-boundary-adjusted'
    | 'clip-selected'
    | 'clip-excluded'
    | 'clip-split'
    | 'clip-merged'
    | 'clip-restored'
    | 'duplicate-deleted'
    | 'clip-rendered';
  payload: Record<string, unknown>;
  invalidatedStepKeys: AutoCutClipWorkflowStepKey[];
  invalidatedOperationKeys?: ClipProcessingOperationKey[];
  createdAt: string;
  createdBy: 'local-user' | 'engine' | 'system';
}

export interface AutoCutStudioClipTimelineSnapshot {
  timeline: StudioTimeline;
  clips: StudioClip[];
  processingOperations: StudioClipProcessingOperation[];
}

export interface AutoCutNativeTaskProgressEvent {
  taskUuid: string;
  workflowTaskId?: string;
  nativeTaskId?: string;
  eventUuid?: string;
  eventType: number | string;
  progress?: number;
  operation?: string;
  phase?: string;
  stepId?: string;
  message?: string;
  severity?: AutoCutTaskExecutionLogSeverity;
  source?: string;
  timestamp?: string;
  payload?: Record<string, unknown>;
}

export interface AppTask {
  id: string;
  type: TaskType;
  name: string;
  status: TaskStatus;
  progress: number;
  progressMessage?: string;
  currentStepId?: string;
  executionSteps?: AutoCutTaskExecutionStep[];
  executionLogs?: AutoCutTaskExecutionLog[];
  executionCheckpoint?: AutoCutTaskExecutionCheckpoint;
  studioClipTimeline?: AutoCutStudioClipTimelineSnapshot;
  createdAt: string;
  completedAt?: string;
  errorMessage?: string;
  failureDiagnostics?: string;
  resultCount?: number;
  generatedAssetIds?: string[];
  sliceResults?: TaskSliceResult[]; // Used when type is AUTOCUT_TASK_TYPE.videoSlice
  sliceReviewSession?: AutoCutSliceReviewSession;
  sourceFileId?: string;
  nativeTaskId?: string;
  extractedText?: { time: string, speaker: string, text: string }[]; // Used for AUTOCUT_TASK_TYPE.textExtraction
  transcriptText?: string; // Used for speech-to-text task evidence.
  transcriptSegments?: AutoCutTranscriptSegment[];
  transcriptSegmentCount?: number;
  translationText?: string; // Used for translated subtitle and voice-translation subtitle output.
  translationSegments?: AutoCutTranscriptSegment[];
  transcriptProviderId?: AutoCutSpeechTranscriptionProviderId | (string & {});
  transcriptSourceAssetId?: string;
  videoDedupReport?: VideoDedupReport;
  subtitleUrl?: string; // Used for subtitle extraction and translation outputs.
  subtitleFormat?: 'srt' | string;
  audioUrl?: string; // Used for AUTOCUT_TASK_TYPE.audioExtraction
  videoUrl?: string; // Used for video conversions, enhance, translate, etc.
  gifUrl?: string; // Used for AUTOCUT_TASK_TYPE.videoGif
  fileSizeStats?: { originalSize: number, newSize: number, compressionRatio: number }; // Used for AUTOCUT_TASK_TYPE.videoCompress
}

export const AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD = {
  maxLeadingSilenceMs: 200,
  maxTrailingSilenceMs: 250,
  minTranscriptCoverageScore: 0.8,
  minAudioActivityConfidence: 0.8,
  maxAudioTranscriptBoundaryDisagreementMs: 1_500,
  minAudioTranscriptBoundaryOverlapRatio: 0.85,
  requiredAudioActivityAnalysisFilter: 'highpass=f=80,lowpass=f=12000,afftdn=nr=10:nf=-25,silencedetect=noise=-35dB:d=0.08',
  rawAudioActivityAnalysisFilter: 'silencedetect=noise=-35dB:d=0.08',
  audioCleanupProfile: 'smart-slice-speech-denoise-v1',
  defaultNoiseReductionApplied: true,
  fallbackNoiseReductionApplied: true,
  acceptedSpeechContinuityGrades: ['strong', 'repaired'],
  acceptedBoundaryDecisionSources: ['transcript', 'audio', 'combined'],
  acceptedTailTreatments: ['none', 'semantic-extend', 'fade-out'],
} as const;

export interface AutoCutSmartSliceReviewRiskDefinition {
  code: string;
  severity: 'review';
  title: string;
  message: string;
  remediation: string;
  labelKey: string;
  messageKey: string;
  remediationKey: string;
}

export const AUTOCUT_SMART_SLICE_REVIEW_RISK_CATALOG = {
  'audio-transcript-boundary-conflict': {
    code: 'audio-transcript-boundary-conflict',
    severity: 'review',
    title: 'Audio/STT boundary conflict',
    message: 'Denoised audio activity disagreed with transcript speech timing, so transcript-protected boundaries were preserved.',
    remediation: 'Review the slice boundary and transcript text before publishing; keep the transcript-protected range when speech is intact.',
    labelKey: 'taskDetail.reviewRisk.audioTranscriptBoundaryConflict.label',
    messageKey: 'taskDetail.reviewRisk.audioTranscriptBoundaryConflict.message',
    remediationKey: 'taskDetail.reviewRisk.audioTranscriptBoundaryConflict.remediation',
  },
  'audio-boundary-refined': {
    code: 'audio-boundary-refined',
    severity: 'review',
    title: 'Audio boundary refined',
    message: 'Denoised audio activity was used to tighten the rendered start or end around verified speech.',
    remediation: 'Review the adjusted boundary and keep it when the first and last spoken words remain intact.',
    labelKey: 'taskDetail.reviewRisk.audioBoundaryRefined.label',
    messageKey: 'taskDetail.reviewRisk.audioBoundaryRefined.message',
    remediationKey: 'taskDetail.reviewRisk.audioBoundaryRefined.remediation',
  },
  'connector-repaired': {
    code: 'connector-repaired',
    severity: 'review',
    title: 'Connector repaired',
    message: 'The planner expanded the start to include connector speech that keeps the sentence coherent.',
    remediation: 'Review the first seconds of the slice and trim only if the repaired connector is not needed for context.',
    labelKey: 'taskDetail.reviewRisk.connectorRepaired.label',
    messageKey: 'taskDetail.reviewRisk.connectorRepaired.message',
    remediationKey: 'taskDetail.reviewRisk.connectorRepaired.remediation',
  },
  'trailing-connector-extended': {
    code: 'trailing-connector-extended',
    severity: 'review',
    title: 'Trailing connector extended',
    message: 'The planner extended the end because the selected speech ended on a connector phrase.',
    remediation: 'Review the ending and keep the extension when it completes the spoken thought.',
    labelKey: 'taskDetail.reviewRisk.trailingConnectorExtended.label',
    messageKey: 'taskDetail.reviewRisk.trailingConnectorExtended.message',
    remediationKey: 'taskDetail.reviewRisk.trailingConnectorExtended.remediation',
  },
  'open-sentence-extended': {
    code: 'open-sentence-extended',
    severity: 'review',
    title: 'Open sentence extended',
    message: 'The planner extended the slice to avoid ending on an unfinished sentence.',
    remediation: 'Review the final sentence and confirm the payoff remains concise after the extension.',
    labelKey: 'taskDetail.reviewRisk.openSentenceExtended.label',
    messageKey: 'taskDetail.reviewRisk.openSentenceExtended.message',
    remediationKey: 'taskDetail.reviewRisk.openSentenceExtended.remediation',
  },
  'excess-leading-silence-trimmed': {
    code: 'excess-leading-silence-trimmed',
    severity: 'review',
    title: 'Leading silence trimmed',
    message: 'The planner removed extra leading silence while preserving speech boundary padding.',
    remediation: 'Preview the first second and restore padding only if the opening sounds too abrupt.',
    labelKey: 'taskDetail.reviewRisk.excessLeadingSilenceTrimmed.label',
    messageKey: 'taskDetail.reviewRisk.excessLeadingSilenceTrimmed.message',
    remediationKey: 'taskDetail.reviewRisk.excessLeadingSilenceTrimmed.remediation',
  },
  'excess-trailing-silence-trimmed': {
    code: 'excess-trailing-silence-trimmed',
    severity: 'review',
    title: 'Trailing silence trimmed',
    message: 'The planner removed extra trailing silence after the verified speech ending.',
    remediation: 'Preview the ending and keep the trimmed version when the payoff still has a natural finish.',
    labelKey: 'taskDetail.reviewRisk.excessTrailingSilenceTrimmed.label',
    messageKey: 'taskDetail.reviewRisk.excessTrailingSilenceTrimmed.message',
    remediationKey: 'taskDetail.reviewRisk.excessTrailingSilenceTrimmed.remediation',
  },
  'transcript-repeat-filtered': {
    code: 'transcript-repeat-filtered',
    severity: 'review',
    title: 'Repeated transcript filtered',
    message: 'Similar transcript windows were detected and filtered so the final slice set stays varied.',
    remediation: 'Review neighboring slices to confirm the same spoken idea is not published twice.',
    labelKey: 'taskDetail.reviewRisk.transcriptRepeatFiltered.label',
    messageKey: 'taskDetail.reviewRisk.transcriptRepeatFiltered.message',
    remediationKey: 'taskDetail.reviewRisk.transcriptRepeatFiltered.remediation',
  },
  'content-topic-segment': {
    code: 'content-topic-segment',
    severity: 'review',
    title: 'Content topic segment',
    message: 'The planner grouped multiple ASR transcript segments into one coherent content topic clip.',
    remediation: 'Review the topic boundary and keep the grouped clip when the segments explain the same subject.',
    labelKey: 'taskDetail.reviewRisk.contentTopicSegment.label',
    messageKey: 'taskDetail.reviewRisk.contentTopicSegment.message',
    remediationKey: 'taskDetail.reviewRisk.contentTopicSegment.remediation',
  },
  'transcript-noise-bridge-repaired': {
    code: 'transcript-noise-bridge-repaired',
    severity: 'review',
    title: 'Noise bridge repaired',
    message: 'The planner bridged a short noisy gap between transcript segments to preserve speech continuity.',
    remediation: 'Review the bridged point and confirm the audio transition is natural after denoise.',
    labelKey: 'taskDetail.reviewRisk.transcriptNoiseBridgeRepaired.label',
    messageKey: 'taskDetail.reviewRisk.transcriptNoiseBridgeRepaired.message',
    remediationKey: 'taskDetail.reviewRisk.transcriptNoiseBridgeRepaired.remediation',
  },
  'transcript-overlap-repaired': {
    code: 'transcript-overlap-repaired',
    severity: 'review',
    title: 'Transcript overlap repaired',
    message: 'Tiny overlapping STT segment timings were tolerated and repaired during slice planning.',
    remediation: 'Review the transcript around the join and regenerate STT if repeated or missing words remain visible.',
    labelKey: 'taskDetail.reviewRisk.transcriptOverlapRepaired.label',
    messageKey: 'taskDetail.reviewRisk.transcriptOverlapRepaired.message',
    remediationKey: 'taskDetail.reviewRisk.transcriptOverlapRepaired.remediation',
  },
  'transcript-internal-repeat': {
    code: 'transcript-internal-repeat',
    severity: 'review',
    title: 'Internal transcript repeat',
    message: 'The candidate slice contains repeated meaning inside the same transcript window.',
    remediation: 'Review whether the repeated section should be shortened, split, or replaced with a cleaner clip.',
    labelKey: 'taskDetail.reviewRisk.transcriptInternalRepeat.label',
    messageKey: 'taskDetail.reviewRisk.transcriptInternalRepeat.message',
    remediationKey: 'taskDetail.reviewRisk.transcriptInternalRepeat.remediation',
  },
  'smart-dedup-review': {
    code: 'smart-dedup-review',
    severity: 'review',
    title: 'Smart dedup match',
    message: 'The video dedup component found likely reused source or reference content overlapping this review segment.',
    remediation: 'Review the matched segment before rendering and use duplicate deletion only when the repeated content should not be exported.',
    labelKey: 'taskDetail.reviewRisk.smartDedupReview.label',
    messageKey: 'taskDetail.reviewRisk.smartDedupReview.message',
    remediationKey: 'taskDetail.reviewRisk.smartDedupReview.remediation',
  },
  'sparse-transcript-speech': {
    code: 'sparse-transcript-speech',
    severity: 'review',
    title: 'Sparse transcript speech',
    message: 'The slice has limited transcript evidence, usually from very short speech or isolated phrases.',
    remediation: 'Review whether the clip has enough context and regenerate STT if speech is missing.',
    labelKey: 'taskDetail.reviewRisk.sparseTranscriptSpeech.label',
    messageKey: 'taskDetail.reviewRisk.sparseTranscriptSpeech.message',
    remediationKey: 'taskDetail.reviewRisk.sparseTranscriptSpeech.remediation',
  },
  'smart-cut-engine': {
    code: 'smart-cut-engine',
    severity: 'review',
    title: 'Smart Cut Engine planned',
    message: 'This slice was planned by the Smart Cut Engine from transcript, speaker, and content-unit evidence.',
    remediation: 'Review the transcript evidence, speaker labels, and semantic scores before publishing.',
    labelKey: 'taskDetail.reviewRisk.smartCutEngine.label',
    messageKey: 'taskDetail.reviewRisk.smartCutEngine.message',
    remediationKey: 'taskDetail.reviewRisk.smartCutEngine.remediation',
  },
  'short-transcript-window': {
    code: 'short-transcript-window',
    severity: 'review',
    title: 'Short transcript window',
    message: 'The transcript-backed speech window is shorter than the preferred smart-slice duration.',
    remediation: 'Review whether the short phrase is publishable alone or should be merged with adjacent context.',
    labelKey: 'taskDetail.reviewRisk.shortTranscriptWindow.label',
    messageKey: 'taskDetail.reviewRisk.shortTranscriptWindow.message',
    remediationKey: 'taskDetail.reviewRisk.shortTranscriptWindow.remediation',
  },
  'llm-timing-snapped-to-transcript': {
    code: 'llm-timing-snapped-to-transcript',
    severity: 'review',
    title: 'LLM timing snapped to transcript',
    message: 'The LLM-selected timing was snapped to verified transcript boundaries.',
    remediation: 'Review the adjusted start and end to confirm the rendered clip still matches the intended moment.',
    labelKey: 'taskDetail.reviewRisk.llmTimingSnappedToTranscript.label',
    messageKey: 'taskDetail.reviewRisk.llmTimingSnappedToTranscript.message',
    remediationKey: 'taskDetail.reviewRisk.llmTimingSnappedToTranscript.remediation',
  },
  'llm-timing-without-transcript': {
    code: 'llm-timing-without-transcript',
    severity: 'review',
    title: 'LLM timing without transcript',
    message: 'The LLM-selected timing could not be aligned to a verified transcript candidate.',
    remediation: 'Review the rendered speech manually and rerun STT if the clip should be transcript-protected.',
    labelKey: 'taskDetail.reviewRisk.llmTimingWithoutTranscript.label',
    messageKey: 'taskDetail.reviewRisk.llmTimingWithoutTranscript.message',
    remediationKey: 'taskDetail.reviewRisk.llmTimingWithoutTranscript.remediation',
  },
  'fallback-plan': {
    code: 'fallback-plan',
    severity: 'review',
    title: 'Fallback plan',
    message: 'A deterministic fallback plan was used because the preferred planning path could not produce enough verified slices.',
    remediation: 'Review slice quality manually and rerun with stronger transcript or LLM settings if the result feels generic.',
    labelKey: 'taskDetail.reviewRisk.fallbackPlan.label',
    messageKey: 'taskDetail.reviewRisk.fallbackPlan.message',
    remediationKey: 'taskDetail.reviewRisk.fallbackPlan.remediation',
  },
  'no-transcript-boundary': {
    code: 'no-transcript-boundary',
    severity: 'review',
    title: 'No transcript boundary',
    message: 'The slice was planned without complete transcript boundary evidence.',
    remediation: 'Regenerate STT or manually review the start and end before publishing.',
    labelKey: 'taskDetail.reviewRisk.noTranscriptBoundary.label',
    messageKey: 'taskDetail.reviewRisk.noTranscriptBoundary.message',
    remediationKey: 'taskDetail.reviewRisk.noTranscriptBoundary.remediation',
  },
  'source-duration-tail': {
    code: 'source-duration-tail',
    severity: 'review',
    title: 'Source tail clipped',
    message: 'The planned duration reached the end of the source media and was clipped to the available tail.',
    remediation: 'Review the ending and confirm no payoff was cut off by the source limit.',
    labelKey: 'taskDetail.reviewRisk.sourceDurationTail.label',
    messageKey: 'taskDetail.reviewRisk.sourceDurationTail.message',
    remediationKey: 'taskDetail.reviewRisk.sourceDurationTail.remediation',
  },
  'timing-metadata-repaired': {
    code: 'timing-metadata-repaired',
    severity: 'review',
    title: 'Timing metadata repaired',
    message: 'Invalid or inconsistent slice timing metadata was normalized before rendering.',
    remediation: 'Review the source, speech, and rendered ranges to confirm the repaired timing matches the intended moment.',
    labelKey: 'taskDetail.reviewRisk.timingMetadataRepaired.label',
    messageKey: 'taskDetail.reviewRisk.timingMetadataRepaired.message',
    remediationKey: 'taskDetail.reviewRisk.timingMetadataRepaired.remediation',
  },
  'missing-payoff': {
    code: 'missing-payoff',
    severity: 'review',
    title: 'Missing payoff',
    message: 'The content arc may not include a clear result, answer, or takeaway.',
    remediation: 'Review whether the slice should be extended or replaced with a clip that contains the payoff.',
    labelKey: 'taskDetail.reviewRisk.missingPayoff.label',
    messageKey: 'taskDetail.reviewRisk.missingPayoff.message',
    remediationKey: 'taskDetail.reviewRisk.missingPayoff.remediation',
  },
  'missing-hook': {
    code: 'missing-hook',
    severity: 'review',
    title: 'Missing hook',
    message: 'The slice may start without a clear attention hook.',
    remediation: 'Review the opening and consider choosing a stronger start point.',
    labelKey: 'taskDetail.reviewRisk.missingHook.label',
    messageKey: 'taskDetail.reviewRisk.missingHook.message',
    remediationKey: 'taskDetail.reviewRisk.missingHook.remediation',
  },
  'missing-setup': {
    code: 'missing-setup',
    severity: 'review',
    title: 'Missing setup',
    message: 'The slice may jump to the payoff without enough setup for viewers.',
    remediation: 'Review whether the previous sentence should be included for context.',
    labelKey: 'taskDetail.reviewRisk.missingSetup.label',
    messageKey: 'taskDetail.reviewRisk.missingSetup.message',
    remediationKey: 'taskDetail.reviewRisk.missingSetup.remediation',
  },
  'missing-content-hook': {
    code: 'missing-content-hook',
    severity: 'review',
    title: 'Missing content hook',
    message: 'The content-arc detector did not find a clear opening hook in the transcript.',
    remediation: 'Review the first line and consider a stronger start point, title, or cover caption.',
    labelKey: 'taskDetail.reviewRisk.missingContentHook.label',
    messageKey: 'taskDetail.reviewRisk.missingContentHook.message',
    remediationKey: 'taskDetail.reviewRisk.missingContentHook.remediation',
  },
  'missing-content-setup': {
    code: 'missing-content-setup',
    severity: 'review',
    title: 'Missing content setup',
    message: 'The content-arc detector did not find enough setup or context for the payoff.',
    remediation: 'Review whether the previous sentence should be included to make the clip understandable.',
    labelKey: 'taskDetail.reviewRisk.missingContentSetup.label',
    messageKey: 'taskDetail.reviewRisk.missingContentSetup.message',
    remediationKey: 'taskDetail.reviewRisk.missingContentSetup.remediation',
  },
  'missing-content-conflict': {
    code: 'missing-content-conflict',
    severity: 'review',
    title: 'Missing content conflict',
    message: 'The content-arc detector did not find a clear problem, tension, or reason to keep watching.',
    remediation: 'Review whether the slice needs a sharper pain point or should be replaced with a higher-tension moment.',
    labelKey: 'taskDetail.reviewRisk.missingContentConflict.label',
    messageKey: 'taskDetail.reviewRisk.missingContentConflict.message',
    remediationKey: 'taskDetail.reviewRisk.missingContentConflict.remediation',
  },
  'missing-content-payoff': {
    code: 'missing-content-payoff',
    severity: 'review',
    title: 'Missing content payoff',
    message: 'The content-arc detector did not find a clear result, answer, or takeaway.',
    remediation: 'Review whether the slice should extend to the next payoff or be replaced with a more complete clip.',
    labelKey: 'taskDetail.reviewRisk.missingContentPayoff.label',
    messageKey: 'taskDetail.reviewRisk.missingContentPayoff.message',
    remediationKey: 'taskDetail.reviewRisk.missingContentPayoff.remediation',
  },
  'low-transcript-coverage': {
    code: 'low-transcript-coverage',
    severity: 'review',
    title: 'Low transcript coverage',
    message: 'The verified transcript covers too little of the rendered speech range.',
    remediation: 'Review the subtitle coverage and rerun STT or adjust boundaries when speech is missing.',
    labelKey: 'taskDetail.reviewRisk.lowTranscriptCoverage.label',
    messageKey: 'taskDetail.reviewRisk.lowTranscriptCoverage.message',
    remediationKey: 'taskDetail.reviewRisk.lowTranscriptCoverage.remediation',
  },
  'no-transcript-segments': {
    code: 'no-transcript-segments',
    severity: 'review',
    title: 'No transcript segments',
    message: 'The slice has no structured STT segment evidence.',
    remediation: 'Regenerate STT before publishing so subtitles and speech boundaries can be verified.',
    labelKey: 'taskDetail.reviewRisk.noTranscriptSegments.label',
    messageKey: 'taskDetail.reviewRisk.noTranscriptSegments.message',
    remediationKey: 'taskDetail.reviewRisk.noTranscriptSegments.remediation',
  },
  'weak-speech-continuity': {
    code: 'weak-speech-continuity',
    severity: 'review',
    title: 'Weak speech continuity',
    message: 'The speech continuity grade is weak, usually because transcript coverage or timing is unreliable.',
    remediation: 'Review the full clip and regenerate STT or choose a more continuous speech window.',
    labelKey: 'taskDetail.reviewRisk.weakSpeechContinuity.label',
    messageKey: 'taskDetail.reviewRisk.weakSpeechContinuity.message',
    remediationKey: 'taskDetail.reviewRisk.weakSpeechContinuity.remediation',
  },
  'topic-drift': {
    code: 'topic-drift',
    severity: 'review',
    title: 'Topic drift',
    message: 'The transcript suggests a topic shift inside the slice.',
    remediation: 'Review whether the slice should be split or shortened around one coherent topic.',
    labelKey: 'taskDetail.reviewRisk.topicDrift.label',
    messageKey: 'taskDetail.reviewRisk.topicDrift.message',
    remediationKey: 'taskDetail.reviewRisk.topicDrift.remediation',
  },
  'weak-hook': {
    code: 'weak-hook',
    severity: 'review',
    title: 'Weak hook',
    message: 'The opening may be understandable but not strong enough for short-form publishing.',
    remediation: 'Review the first line and consider a tighter title, cover, or earlier start point.',
    labelKey: 'taskDetail.reviewRisk.weakHook.label',
    messageKey: 'taskDetail.reviewRisk.weakHook.message',
    remediationKey: 'taskDetail.reviewRisk.weakHook.remediation',
  },
  'open-ending': {
    code: 'open-ending',
    severity: 'review',
    title: 'Open ending',
    message: 'The ending may feel unfinished even if the speech boundary is valid.',
    remediation: 'Review the last sentence and extend to the next payoff when needed.',
    labelKey: 'taskDetail.reviewRisk.openEnding.label',
    messageKey: 'taskDetail.reviewRisk.openEnding.message',
    remediationKey: 'taskDetail.reviewRisk.openEnding.remediation',
  },
  'broken-sentence-boundary': {
    code: 'broken-sentence-boundary',
    severity: 'review',
    title: 'Broken sentence boundary',
    message: 'The sentence boundary model found a likely broken start or ending.',
    remediation: 'Review the transcript and regenerate or manually adjust the slice boundary.',
    labelKey: 'taskDetail.reviewRisk.brokenSentenceBoundary.label',
    messageKey: 'taskDetail.reviewRisk.brokenSentenceBoundary.message',
    remediationKey: 'taskDetail.reviewRisk.brokenSentenceBoundary.remediation',
  },
  'unrepaired-sentence-boundary': {
    code: 'unrepaired-sentence-boundary',
    severity: 'review',
    title: 'Unrepaired sentence boundary',
    message: 'The sentence boundary detector found an unrepaired start or ending issue.',
    remediation: 'Review and manually adjust the slice boundary before publishing.',
    labelKey: 'taskDetail.reviewRisk.unrepairedSentenceBoundary.label',
    messageKey: 'taskDetail.reviewRisk.unrepairedSentenceBoundary.message',
    remediationKey: 'taskDetail.reviewRisk.unrepairedSentenceBoundary.remediation',
  },
  'sentence-boundary-unavailable': {
    code: 'sentence-boundary-unavailable',
    severity: 'review',
    title: 'Sentence boundary unavailable',
    message: 'Sentence boundary integrity could not be verified because transcript text was unavailable or empty.',
    remediation: 'Regenerate STT or add corrected transcript text before publishing.',
    labelKey: 'taskDetail.reviewRisk.sentenceBoundaryUnavailable.label',
    messageKey: 'taskDetail.reviewRisk.sentenceBoundaryUnavailable.message',
    remediationKey: 'taskDetail.reviewRisk.sentenceBoundaryUnavailable.remediation',
  },
  'sentence-leading-connector-unrepaired': {
    code: 'sentence-leading-connector-unrepaired',
    severity: 'review',
    title: 'Leading connector unrepaired',
    message: 'The slice may start on a connector phrase without enough previous context.',
    remediation: 'Review the opening and extend backward if the first sentence depends on earlier speech.',
    labelKey: 'taskDetail.reviewRisk.sentenceLeadingConnectorUnrepaired.label',
    messageKey: 'taskDetail.reviewRisk.sentenceLeadingConnectorUnrepaired.message',
    remediationKey: 'taskDetail.reviewRisk.sentenceLeadingConnectorUnrepaired.remediation',
  },
  'sentence-trailing-connector-unrepaired': {
    code: 'sentence-trailing-connector-unrepaired',
    severity: 'review',
    title: 'Trailing connector unrepaired',
    message: 'The slice may end on a connector phrase without the following thought.',
    remediation: 'Review the ending and extend forward if the sentence continues.',
    labelKey: 'taskDetail.reviewRisk.sentenceTrailingConnectorUnrepaired.label',
    messageKey: 'taskDetail.reviewRisk.sentenceTrailingConnectorUnrepaired.message',
    remediationKey: 'taskDetail.reviewRisk.sentenceTrailingConnectorUnrepaired.remediation',
  },
  'sentence-open-ending-unrepaired': {
    code: 'sentence-open-ending-unrepaired',
    severity: 'review',
    title: 'Open ending unrepaired',
    message: 'The slice appears to end before the sentence or idea is complete.',
    remediation: 'Review the last sentence and extend to the next complete ending when needed.',
    labelKey: 'taskDetail.reviewRisk.sentenceOpenEndingUnrepaired.label',
    messageKey: 'taskDetail.reviewRisk.sentenceOpenEndingUnrepaired.message',
    remediationKey: 'taskDetail.reviewRisk.sentenceOpenEndingUnrepaired.remediation',
  },
  'platform-duration-too-short': {
    code: 'platform-duration-too-short',
    severity: 'review',
    title: 'Platform duration too short',
    message: 'The slice is shorter than the preferred duration for the target platform.',
    remediation: 'Review whether the clip works as a short standalone moment or should include more context.',
    labelKey: 'taskDetail.reviewRisk.platformDurationTooShort.label',
    messageKey: 'taskDetail.reviewRisk.platformDurationTooShort.message',
    remediationKey: 'taskDetail.reviewRisk.platformDurationTooShort.remediation',
  },
  'platform-duration-too-long': {
    code: 'platform-duration-too-long',
    severity: 'review',
    title: 'Platform duration too long',
    message: 'The slice is longer than the preferred duration for the target platform.',
    remediation: 'Review whether the clip should be shortened, split, or targeted at a longer-form platform.',
    labelKey: 'taskDetail.reviewRisk.platformDurationTooLong.label',
    messageKey: 'taskDetail.reviewRisk.platformDurationTooLong.message',
    remediationKey: 'taskDetail.reviewRisk.platformDurationTooLong.remediation',
  },
  'platform-duration-reject': {
    code: 'platform-duration-reject',
    severity: 'review',
    title: 'Platform duration rejected',
    message: 'The slice exceeds the maximum review duration for the target platform.',
    remediation: 'Shorten or split the slice before publishing to this platform.',
    labelKey: 'taskDetail.reviewRisk.platformDurationReject.label',
    messageKey: 'taskDetail.reviewRisk.platformDurationReject.message',
    remediationKey: 'taskDetail.reviewRisk.platformDurationReject.remediation',
  },
  'platform-hook-not-strong': {
    code: 'platform-hook-not-strong',
    severity: 'review',
    title: 'Platform hook not strong',
    message: 'The target platform requires a stronger opening hook than this slice currently provides.',
    remediation: 'Review the first line and improve the opening, title, or cover before publishing.',
    labelKey: 'taskDetail.reviewRisk.platformHookNotStrong.label',
    messageKey: 'taskDetail.reviewRisk.platformHookNotStrong.message',
    remediationKey: 'taskDetail.reviewRisk.platformHookNotStrong.remediation',
  },
  'platform-weak-hook': {
    code: 'platform-weak-hook',
    severity: 'review',
    title: 'Platform weak hook',
    message: 'The opening hook is weak for the target platform.',
    remediation: 'Choose a sharper opening or add a clear cover title before publishing.',
    labelKey: 'taskDetail.reviewRisk.platformWeakHook.label',
    messageKey: 'taskDetail.reviewRisk.platformWeakHook.message',
    remediationKey: 'taskDetail.reviewRisk.platformWeakHook.remediation',
  },
  'platform-open-ending': {
    code: 'platform-open-ending',
    severity: 'review',
    title: 'Platform open ending',
    message: 'The slice ending is too open-ended for the target platform.',
    remediation: 'Extend to a clear payoff or choose a clip with a stronger ending.',
    labelKey: 'taskDetail.reviewRisk.platformOpenEnding.label',
    messageKey: 'taskDetail.reviewRisk.platformOpenEnding.message',
    remediationKey: 'taskDetail.reviewRisk.platformOpenEnding.remediation',
  },
  'platform-broken-sentence-boundary': {
    code: 'platform-broken-sentence-boundary',
    severity: 'review',
    title: 'Platform broken sentence boundary',
    message: 'The target platform review gate detected a broken sentence boundary.',
    remediation: 'Adjust the slice boundary so the first and last sentences are complete.',
    labelKey: 'taskDetail.reviewRisk.platformBrokenSentenceBoundary.label',
    messageKey: 'taskDetail.reviewRisk.platformBrokenSentenceBoundary.message',
    remediationKey: 'taskDetail.reviewRisk.platformBrokenSentenceBoundary.remediation',
  },
  'platform-incomplete-arc': {
    code: 'platform-incomplete-arc',
    severity: 'review',
    title: 'Platform incomplete arc',
    message: 'The content arc is incomplete for the target platform.',
    remediation: 'Add the missing hook, setup, conflict, or payoff before publishing.',
    labelKey: 'taskDetail.reviewRisk.platformIncompleteArc.label',
    messageKey: 'taskDetail.reviewRisk.platformIncompleteArc.message',
    remediationKey: 'taskDetail.reviewRisk.platformIncompleteArc.remediation',
  },
  'platform-topic-drift': {
    code: 'platform-topic-drift',
    severity: 'review',
    title: 'Platform topic drift',
    message: 'The target platform review gate detected topic drift inside the slice.',
    remediation: 'Shorten or split the slice so it stays focused on one topic.',
    labelKey: 'taskDetail.reviewRisk.platformTopicDrift.label',
    messageKey: 'taskDetail.reviewRisk.platformTopicDrift.message',
    remediationKey: 'taskDetail.reviewRisk.platformTopicDrift.remediation',
  },
  'needs-cover-title': {
    code: 'needs-cover-title',
    severity: 'review',
    title: 'Needs cover title',
    message: 'The slice likely needs a clearer cover title or caption to publish well.',
    remediation: 'Add a concise cover title that states the hook or payoff before publishing.',
    labelKey: 'taskDetail.reviewRisk.needsCoverTitle.label',
    messageKey: 'taskDetail.reviewRisk.needsCoverTitle.message',
    remediationKey: 'taskDetail.reviewRisk.needsCoverTitle.remediation',
  },
} as const satisfies Record<string, AutoCutSmartSliceReviewRiskDefinition>;

export type AutoCutSmartSliceReviewRiskCode = keyof typeof AUTOCUT_SMART_SLICE_REVIEW_RISK_CATALOG;

// ========================
// Slicer Models
// ========================
export type SliceMode =
  | 'general'
  | 'talking-head'
  | 'commerce-live'
  | 'dialogue'
  | 'meeting'
  | 'performance'
  | 'film';

export type SliceAlgorithm = 'nlp' | 'pause' | 'scene';
export type SliceHighlightEngine = 'emotion' | 'keyword' | 'motion';
export type SliceTargetPlatform = 'douyin' | 'kuaishou' | 'shipinhao' | 'xiaohongshu' | 'bilibili' | 'generic';
export type SliceTargetAspectRatio = 'auto' | '16:9' | '9:16' | '1:1' | '4:3';
export type SliceVideoObjectFit = 'contain' | 'cover';
export type SliceContinuityLevel = 'standard' | 'strict';
export type SliceSegmentationDensity = 'default' | 'maximize-continuity';
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
}

export type VideoDedupStrategyId =
  | 'exact-file-hash'
  | 'container-normalized'
  | 'visual-fingerprint'
  | 'temporal-video-copy'
  | 'audio-fingerprint'
  | 'transcript-semantic'
  | 'template-reuse';

export type VideoDedupMode =
  | 'quick-scan'
  | 'standard'
  | 'deep-audit'
  | 'publish-risk'
  | 'slice-result-dedup'
  | 'library-monitor';

export type VideoDedupSensitivity = 'low' | 'balanced' | 'high' | 'forensic';
export type VideoDedupActionMode = 'report-only' | 'review-before-action' | 'archive-duplicates';

export interface VideoDedupParams {
  mode: VideoDedupMode;
  sourceAssetIds: string[];
  referenceAssetIds?: string[];
  strategies: VideoDedupStrategyId[];
  sensitivity: VideoDedupSensitivity;
  minMatchDurationMs: number;
  ignoreIntroOutro: boolean;
  introOutroMaxDurationMs: number;
  actionMode: VideoDedupActionMode;
}

export interface VideoDedupEvidence {
  strategyId: VideoDedupStrategyId;
  score: number;
  label: string;
  detail: string;
  sourceStartMs?: number;
  sourceEndMs?: number;
  targetStartMs?: number;
  targetEndMs?: number;
}

export interface VideoDuplicateMatch {
  id: string;
  sourceAssetId: string;
  targetAssetId: string;
  matchKind: 'exact' | 'near-duplicate' | 'partial-copy' | 'same-audio' | 'same-speech' | 'template-only';
  confidence: number;
  visualScore?: number;
  audioScore?: number;
  transcriptScore?: number;
  temporalCoverageRatio: number;
  sourceStartMs: number;
  sourceEndMs: number;
  targetStartMs: number;
  targetEndMs: number;
  evidence: VideoDedupEvidence[];
  recommendation: 'keep-both' | 'archive-target' | 'manual-review' | 'ignore-template-only';
}

export interface VideoDuplicateGroup {
  id: string;
  canonicalAssetId: string;
  duplicateAssetIds: string[];
  reviewAssetIds: string[];
  groupScore: number;
  reason: string;
  matches: VideoDuplicateMatch[];
}

export interface VideoDedupReport {
  id: string;
  createdAt: string;
  params: VideoDedupParams;
  scannedAssetCount: number;
  duplicateGroupCount: number;
  matchCount: number;
  reclaimableBytes: number;
  strategies: VideoDedupStrategyId[];
  groups: VideoDuplicateGroup[];
  matches: VideoDuplicateMatch[];
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
  idealDuration?: number;
  sourceDurationMs?: number;
  continuityLevel?: SliceContinuityLevel;
  segmentationDensity?: SliceSegmentationDensity;
  sttPresetId?: string;
  customKeywords?: string[];
  minDuration: number;
  maxDuration: number;
  baseAlgorithm: SliceAlgorithm;
  highlightEngine: SliceHighlightEngine;
  segmentationAgentId?: AutoCutSmartSliceSegmentationAgentId;
  enableNoiseReduction?: boolean;
  enableCoughFilter: boolean;
  enableRepeatFilter: boolean;
  enableSmartDedup?: boolean;
  videoDedupParams?: VideoDedupParams;
  enableSubtitles?: boolean;
  subtitleMode?: SliceSubtitleMode;
  subtitleStyleId?: string;
  mergeShortClips?: boolean;
  mergeShortClipThresholdSeconds?: number;
}
