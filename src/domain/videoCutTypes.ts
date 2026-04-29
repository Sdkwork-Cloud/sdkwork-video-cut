export type DeploymentMode =
  | 'desktop-local'
  | 'desktop-private'
  | 'web-private'
  | 'server-private'
  | 'container-private'
  | 'kubernetes-private';

export type AuthMode = 'none' | 'single-user-token' | 'reverse-proxy';

export type TaskStatus =
  | 'draft'
  | 'sourceReady'
  | 'analyzing'
  | 'planReady'
  | 'rendering'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export type VideoCutType = 'single-speaker' | 'interview-qa' | 'long-interview';

export interface AiProviderSettings {
  enabled: boolean;
  baseUrl: string;
  apiKeyConfigured: boolean;
  chatModel: string;
  structuredOutputMode: 'json-schema' | 'json-object-fallback';
  temperature: number;
  timeoutSeconds: number;
  retryCount: number;
}

export type SpeechToTextProviderProfile =
  | 'openai-audio-transcriptions'
  | 'volcengine-bigasr-flash'
  | 'aliyun-qwen-asr';

export interface SpeechToTextSettings {
  enabled: boolean;
  providerProfile: SpeechToTextProviderProfile;
  reuseAiProviderConnection: boolean;
  baseUrl: string;
  apiKeyConfigured: boolean;
  transcriptionModel: string;
  resourceId: string;
  languageHint: string;
  timestampGranularity: 'segment' | 'word';
  diarizationEnabled: boolean;
  localWhisperFallbackEnabled: boolean;
}

export interface SubtitleSettings {
  language: 'zh-CN';
  fontFamily: string;
  fontFallback: string;
  fontSize: number;
  maxLines: number;
  shadowOpacity: number;
  shadowBlur: number;
  highlightColor: string;
  position: 'bottom-safe' | 'middle' | 'top';
}

export interface MediaToolSettings {
  ffmpegPath: string;
  ffprobePath: string;
  onnxRuntimeEnabled: boolean;
  sileroVadModelPath: string;
  workerConcurrency: number;
  maxUploadBytes: number;
}

export interface AssetSettings {
  fonts: string;
  bgm: string;
  sfx: string;
  coverTemplates: string;
}

export type AssetCatalogKind = 'fonts' | 'bgm' | 'sfx' | 'coverTemplates';
export type AssetCatalogStatus = 'available' | 'not-configured' | 'unavailable';

export interface AssetCatalogEntry {
  assetId: string;
  path: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  license: string;
  source: string;
  version: string;
}

export interface AssetCatalogSlot {
  kind: AssetCatalogKind;
  status: AssetCatalogStatus;
  configuredPath: string;
  manifestPath: string;
  supportedExtensions: string[];
  entries: AssetCatalogEntry[];
  warnings: string[];
}

export interface AssetCatalog {
  schemaId: 'video-cut.asset-catalog.schema.v1';
  assetCatalogVersion: 1;
  generatedAt: string;
  slots: AssetCatalogSlot[];
}

export interface StorageSettings {
  workspaceRoot: string;
  artifactRoot: string;
  tempRoot: string;
  retentionDays: number;
}

export interface RuntimeSettings {
  deploymentMode: DeploymentMode;
  bindHost: string;
  port: number;
  publicBaseUrl: string;
  authMode: AuthMode;
}

export interface SecuritySettings {
  secretProvider: 'local-secure-store' | 'env' | 'kubernetes-secret';
  corsAllowedOrigins: string[];
  diagnosticsIncludeSourceMedia: boolean;
  diagnosticsIncludeTranscript: boolean;
  redactionEnabled: boolean;
}

export interface VideoCutSettings {
  ai: AiProviderSettings;
  speechToText: SpeechToTextSettings;
  subtitle: SubtitleSettings;
  mediaTools: MediaToolSettings;
  assets: AssetSettings;
  storage: StorageSettings;
  runtime: RuntimeSettings;
  security: SecuritySettings;
}

export type VideoCutSettingsSavePayload = Omit<VideoCutSettings, 'ai' | 'speechToText'> & {
  ai: AiProviderSettings & {
    apiKey?: string;
  };
  speechToText: SpeechToTextSettings & {
    apiKey?: string;
  };
};

export interface CapabilityStatus {
  status: 'ok' | 'warn' | 'fail';
  label: string;
  actionHint?: string;
  checkedTools?: Record<string, string>;
  missingTools?: string[];
}

export interface CapabilityReport {
  reportVersion: 'video-cut.capability.v1';
  deploymentMode: DeploymentMode;
  qualityTier: 'basic' | 'standard' | 'interview' | 'pro' | 'batch';
  health: 'ok' | 'degraded' | 'unavailable';
  ai: CapabilityStatus;
  speechToText: CapabilityStatus;
  media: CapabilityStatus;
  storage: CapabilityStatus;
  security: CapabilityStatus;
  providers: ProviderContractPolicy;
}

export interface DeploymentDoctorCheck {
  checkId: string;
  status: 'ok' | 'warn' | 'fail';
  label: string;
  actionHint?: string | null;
  details?: Record<string, unknown>;
}

export interface DeploymentDoctorReport {
  reportVersion: 'video-cut.doctor.v1';
  deploymentMode: DeploymentMode;
  generatedAt: string;
  health: 'ok' | 'degraded' | 'unavailable';
  capability: CapabilityReport;
  checks: DeploymentDoctorCheck[];
  redactedConfig: VideoCutSettings;
}

export interface DiagnosticBundle {
  bundleVersion: 'video-cut.diagnostics-bundle.v1';
  generatedAt: string;
  deploymentMode: DeploymentMode;
  includes: {
    sourceMedia: boolean;
    transcript: boolean;
  };
  supportRequest?: DiagnosticSupportBundleRequestEvidence;
  capability: CapabilityReport;
  doctor: DeploymentDoctorReport;
  redactedConfig: VideoCutSettings;
  artifacts: DiagnosticBundleArtifact[];
}

export interface DiagnosticSupportBundleRequest {
  taskId?: string;
  includeSourceMedia: boolean;
  includeTranscript: boolean;
  consentAccepted: boolean;
}

export interface DiagnosticSupportBundleRequestEvidence extends DiagnosticSupportBundleRequest {
  schemaId: 'video-cut.diagnostics-support-bundle-request.v1';
}

export interface DiagnosticBundleArtifact {
  kind: 'sourceMedia' | 'transcript';
  taskId?: string;
  artifactId?: string;
  path?: string;
  contentRef?: string;
  contentType?: string;
  included: boolean;
  redacted: boolean;
  reason?: string;
  sizeBytes?: number;
  sha256?: string;
}

export type ProviderConformanceTarget = 'ai' | 'speechToText' | 'all';

export interface ProviderConformanceCheck {
  checkId: string;
  status: 'ok' | 'warn' | 'fail';
  label: string;
  actionHint?: string | null;
  details: Record<string, unknown>;
}

export interface ProviderConformanceReport {
  reportVersion: 'video-cut.provider-conformance.v1';
  providerId: string;
  status: 'ok' | 'warn' | 'fail';
  generatedAt: string;
  checks: ProviderConformanceCheck[];
}

export interface ProviderContractPolicy {
  providerCapabilityVersion: 'video-cut.provider-capability.schema.v1';
  configurationSchemaId: 'video-cut.openai-compatible-provider-config.schema.v1';
  openAiCompatible: {
    chatCompletionsEndpoint: '/v1/chat/completions';
    audioTranscriptionsEndpoint: '/v1/audio/transcriptions';
    structuredOutputModes: Array<'json-schema' | 'json-object-fallback'>;
    ollamaAllowed: false;
  };
  speechToTextProviderProfiles: SpeechToTextProviderProfile[];
  requiredPorts: Array<'LlmProviderPort' | 'SpeechToTextPort' | 'SubtitlePort' | 'SecretStorePort'>;
}

export interface VideoCutTask {
  taskId: string;
  title: string;
  type: VideoCutType;
  status: TaskStatus;
  progress: number;
  durationSeconds: number;
  sourceName?: string;
  updatedAt: string;
  currentStage?: string;
}

export interface VideoCutArtifact {
  artifactId: string;
  taskId: string;
  renderId?: string;
  kind: 'source' | 'audio' | 'analysis' | 'plan' | 'render' | 'subtitle' | 'cover' | 'render-manifest' | 'log';
  path: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

export interface AttachTaskSourceInput {
  sourceName: string;
  sizeBytes?: number;
  contentType?: string;
}

export interface ManualTranscriptSegmentInput {
  startMs: number;
  endMs: number;
  text: string;
  speakerId?: string;
}

export interface ManualTranscriptInput {
  language?: string;
  text?: string;
  segments: ManualTranscriptSegmentInput[];
}

export type SubtitleFormat = 'srt' | 'vtt';

export interface SubtitleImportInput {
  format: SubtitleFormat;
  content: string;
  language?: string;
}

export interface SubtitleExportOutput {
  format: SubtitleFormat;
  content: string;
  artifactId: string;
  path: string;
}

export interface ArtifactDownloadDescriptor {
  artifactId: string;
  taskId: string;
  path: string;
  sizeBytes: number;
  sha256: string;
  contentType: string;
  downloadMode: 'host-content-endpoint' | 'signed-url';
  url: string;
  expiresAt?: string;
}

export interface DeleteTaskResult {
  taskId: string;
  deleted: boolean;
  artifactsDeleted: number;
  eventsDeleted: number;
}

export interface VideoCutProgressEvent {
  eventId: string;
  taskId: string;
  stage: string;
  progress: number;
  message: string;
  level?: 'info' | 'warn' | 'error';
  traceId?: string;
  metadata?: VideoCutProgressEventMetadata;
}

export interface VideoCutProgressEventMetadata {
  recoveryHint?: TaskRecoveryHint;
}

export type TaskRecoveryAction =
  | 'upload-source'
  | 'retry-analysis'
  | 'retry-render'
  | 'open-settings'
  | 'open-diagnostics'
  | 'review-render-log'
  | 'none';

export interface TaskRecoveryHint {
  code: string;
  action: TaskRecoveryAction;
  label: string;
  message: string;
  retryable: boolean;
  targetStage?: string;
}

export interface CreateTaskInput {
  title: string;
  type: VideoCutType;
}

export interface ValidationError {
  field: string;
  code: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export function createDefaultSettings(): VideoCutSettings {
  return {
    ai: {
      enabled: false,
      baseUrl: 'https://api.openai.com',
      apiKeyConfigured: false,
      chatModel: 'gpt-4.1-mini',
      structuredOutputMode: 'json-schema',
      temperature: 0.2,
      timeoutSeconds: 45,
      retryCount: 2,
    },
    speechToText: {
      enabled: false,
      providerProfile: 'openai-audio-transcriptions',
      reuseAiProviderConnection: true,
      baseUrl: 'https://api.openai.com',
      apiKeyConfigured: false,
      transcriptionModel: 'gpt-4o-mini-transcribe',
      resourceId: 'volc.bigasr.auc',
      languageHint: 'zh',
      timestampGranularity: 'segment',
      diarizationEnabled: false,
      localWhisperFallbackEnabled: false,
    },
    subtitle: {
      language: 'zh-CN',
      fontFamily: '极宋',
      fontFallback: 'Noto Serif SC',
      fontSize: 64,
      maxLines: 2,
      shadowOpacity: 0.95,
      shadowBlur: 0.09,
      highlightColor: '#ffd84d',
      position: 'bottom-safe',
    },
    mediaTools: {
      ffmpegPath: 'ffmpeg',
      ffprobePath: 'ffprobe',
      onnxRuntimeEnabled: true,
      sileroVadModelPath: 'models/silero-vad.onnx',
      workerConcurrency: 2,
      maxUploadBytes: 8 * 1024 * 1024 * 1024,
    },
    assets: {
      fonts: 'assets/fonts',
      bgm: 'assets/bgm',
      sfx: 'assets/sfx',
      coverTemplates: 'assets/cover-templates',
    },
    storage: {
      workspaceRoot: './workspace',
      artifactRoot: './workspace/artifacts',
      tempRoot: './workspace/tmp',
      retentionDays: 30,
    },
    runtime: {
      deploymentMode: 'desktop-local',
      bindHost: '127.0.0.1',
      port: 6177,
      publicBaseUrl: 'http://127.0.0.1:6177',
      authMode: 'none',
    },
    security: {
      secretProvider: 'local-secure-store',
      corsAllowedOrigins: ['http://127.0.0.1:5173', 'http://localhost:5173'],
      diagnosticsIncludeSourceMedia: false,
      diagnosticsIncludeTranscript: false,
      redactionEnabled: true,
    },
  };
}
