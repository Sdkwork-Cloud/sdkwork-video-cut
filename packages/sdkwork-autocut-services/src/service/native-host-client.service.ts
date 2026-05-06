export interface AutoCutHostCapabilities {
  contractVersion: string;
  hostKind: string;
  databaseContractReady: boolean;
  sqliteMigrationReady: boolean;
  databaseHealthCommandReady: boolean;
  ffmpegProbeCommandReady: boolean;
  mediaImportCommandReady: boolean;
  mediaFileDescribeCommandReady: boolean;
  localVideoFileSelectCommandReady: boolean;
  localDirectorySelectCommandReady: boolean;
  audioExtractionCommandReady: boolean;
  audioExtractionFromAssetReady: boolean;
  videoGifCommandReady: boolean;
  videoSliceCommandReady: boolean;
  videoCompressCommandReady: boolean;
  videoConvertCommandReady: boolean;
  videoEnhanceCommandReady: boolean;
  speechTranscriptionCommandReady: boolean;
  speechTranscriptionToolchainReady: boolean;
  speechTranscriptionProbeCommandReady: boolean;
  speechTranscriptionFileSelectCommandReady: boolean;
  llmHttpCommandReady: boolean;
  llmSecretStoreReady: boolean;
  nativeTaskQueryCommandReady: boolean;
  nativeTaskCancelCommandReady: boolean;
  nativeTaskRecoveryCommandReady: boolean;
  nativeTaskRetryCommandReady: boolean;
  nativeTaskProgressEventsReady: boolean;
  nativeWorkerLeaseReady: boolean;
  ffmpegToolchainManifestReady: boolean;
  ffmpegToolchainResolverReady: boolean;
  ffmpegBundledReady: boolean;
  ffmpegExecutionReady: boolean;
  supportedCommands: string[];
  database?: unknown;
}

export interface AutoCutDatabaseHealth {
  ready: boolean;
  databasePath: string;
  appliedMigrations: string[];
  verifiedTables: string[];
  missingTables: string[];
  diagnostics: string[];
}

export interface AutoCutFfmpegProbe {
  available: boolean;
  executable: string;
  sourceKind: string;
  manifestReady: boolean;
  bundledReady: boolean;
  versionLine?: string;
  diagnostics: string[];
}

export interface AutoCutMediaImportRequest {
  sourcePath: string;
  outputRootDir?: string;
}

export interface AutoCutMediaImportResult {
  assetUuid: string;
  sandboxPath: string;
  byteSize: number;
  name: string;
  mediaType: string;
  mimeType: string;
  durationMs?: number;
}

export interface AutoCutLocalMediaFileDescription {
  sourcePath: string;
  byteSize: number;
  name: string;
  mediaType: string;
  mimeType: string;
  durationMs?: number;
}

export interface AutoCutAudioExtractionRequest {
  assetUuid: string;
  outputFormat: string;
  outputRootDir?: string;
}

export interface AutoCutAudioExtractionResult {
  artifactUuid: string;
  taskUuid: string;
  sourceAssetUuid: string;
  artifactPath: string;
  taskOutputDir: string;
  byteSize: number;
  format: string;
  ffmpegExecutable: string;
}

export interface AutoCutVideoGifRequest {
  assetUuid: string;
  fps: string;
  resolution: string;
  dither: boolean;
  outputRootDir?: string;
}

export interface AutoCutVideoGifResult {
  artifactUuid: string;
  taskUuid: string;
  sourceAssetUuid: string;
  artifactPath: string;
  taskOutputDir: string;
  byteSize: number;
  format: 'gif';
  ffmpegExecutable: string;
}

export interface AutoCutVideoSliceClipRequest {
  startMs: number;
  durationMs: number;
  label: string;
}

export interface AutoCutVideoSliceRenderProfile {
  targetAspectRatio: 'auto' | '16:9' | '9:16' | '1:1' | '4:3';
  objectFit: 'contain' | 'cover';
}

export interface AutoCutVideoSliceRequest {
  assetUuid: string;
  clips: AutoCutVideoSliceClipRequest[];
  outputFormat: 'mp4';
  outputRootDir?: string;
  renderProfile?: AutoCutVideoSliceRenderProfile;
  subtitleFormat?: 'srt';
  subtitleMode?: 'none' | 'srt' | 'burned' | 'both';
  subtitleStyleId?: string;
  subtitleSegments?: AutoCutSpeechTranscriptionSegment[];
}

export interface AutoCutVideoSliceArtifactResult {
  artifactUuid: string;
  artifactPath: string;
  thumbnailArtifactUuid: string;
  thumbnailArtifactPath: string;
  subtitleArtifactUuid?: string;
  subtitleArtifactPath?: string;
  taskOutputDir: string;
  byteSize: number;
  thumbnailByteSize: number;
  subtitleByteSize?: number;
  subtitleFormat?: 'srt' | string;
  format: string;
  startMs: number;
  durationMs: number;
  label: string;
}

export interface AutoCutVideoSliceResult {
  taskUuid: string;
  sourceAssetUuid: string;
  taskOutputDir: string;
  slices: AutoCutVideoSliceArtifactResult[];
  ffmpegExecutable: string;
}

export interface AutoCutSpeechTranscriptionSegment {
  startMs: number;
  endMs: number;
  text: string;
  speaker?: string;
}

export interface AutoCutSpeechTranscriptionRequest {
  assetUuid: string;
  language?: string;
  outputRootDir?: string;
  executablePath?: string;
  modelPath?: string;
}

export interface AutoCutSpeechTranscriptionResult {
  artifactUuid: string;
  taskUuid: string;
  sourceAssetUuid: string;
  transcriptPath: string;
  taskOutputDir: string;
  language: string;
  segments: AutoCutSpeechTranscriptionSegment[];
  text: string;
  ffmpegExecutable: string;
  speechExecutable: string;
}

export interface AutoCutSpeechTranscriptionProbeRequest {
  executablePath?: string;
  modelPath?: string;
  sourceKind?: string;
}

export interface AutoCutSpeechTranscriptionProbe {
  ready: boolean;
  executablePath: string;
  modelPath: string;
  sourceKind: string;
  diagnostics: string[];
  versionLine?: string;
}

export interface AutoCutSpeechTranscriptionFileSelectRequest {
  kind: 'executable' | 'model';
}

export interface AutoCutVideoCompressRequest {
  assetUuid: string;
  compressionMode: string;
  outputRootDir?: string;
}

export interface AutoCutVideoCompressResult {
  artifactUuid: string;
  taskUuid: string;
  sourceAssetUuid: string;
  artifactPath: string;
  taskOutputDir: string;
  byteSize: number;
  originalByteSize: number;
  format: 'mp4';
  ffmpegExecutable: string;
}

export interface AutoCutVideoConvertRequest {
  assetUuid: string;
  targetFormat: string;
  videoCodec: string;
  audioCodec: string;
  resolution: string;
  outputRootDir?: string;
}

export interface AutoCutVideoConvertResult {
  artifactUuid: string;
  taskUuid: string;
  sourceAssetUuid: string;
  artifactPath: string;
  taskOutputDir: string;
  byteSize: number;
  format: string;
  ffmpegExecutable: string;
}

export interface AutoCutVideoEnhanceRequest {
  assetUuid: string;
  targetResolution: string;
  enhanceMode: string;
  frameRate: string;
  outputRootDir?: string;
}

export interface AutoCutVideoEnhanceResult {
  artifactUuid: string;
  taskUuid: string;
  sourceAssetUuid: string;
  artifactPath: string;
  taskOutputDir: string;
  byteSize: number;
  format: 'mp4';
  ffmpegExecutable: string;
}

export interface AutoCutLlmHttpRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  bodyText?: string;
}

export interface AutoCutLlmHttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyText: string;
}

export interface AutoCutLlmSecretRequest {
  secretName: string;
}

export interface AutoCutSaveLlmSecretRequest extends AutoCutLlmSecretRequest {
  secretValue: string;
}

export interface AutoCutSaveLlmSecretResult {
  secretName: string;
  saved: boolean;
}

export interface AutoCutGetLlmSecretResult {
  secretName: string;
  configured: boolean;
  secretValue?: string;
}

export interface AutoCutDeleteLlmSecretResult {
  secretName: string;
  deleted: boolean;
}

export interface AutoCutNativeTaskQueryRequest {
  limit?: number;
  taskUuid?: string;
}

export interface AutoCutNativeTaskCancelRequest {
  taskUuid: string;
}

export interface AutoCutNativeTaskCancelResult {
  taskUuid: string;
  status: number;
  canceled: boolean;
  message: string;
}

export interface AutoCutNativeTaskRecoveryRequest {
  limit?: number;
}

export interface AutoCutNativeTaskRecoveryResult {
  inspected: number;
  recovered: number;
  interrupted: number;
  canceled: number;
  expiredLeases: number;
  deferred: number;
  taskUuids: string[];
}

export interface AutoCutNativeTaskRetryRequest {
  taskUuid: string;
}

export interface AutoCutNativeTaskRetryResult {
  taskUuid: string;
  retryTaskUuid: string;
  status: number;
  retried: boolean;
  message: string;
}

export interface AutoCutNativeStageRunSnapshot {
  uuid: string;
  stageType: number;
  status: number;
  startedAt?: string;
  finishedAt?: string;
  diagnosticsJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutoCutNativeTaskEventSnapshot {
  uuid: string;
  eventType: number;
  payload: Record<string, unknown>;
  payloadJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutoCutNativeWorkerLeaseSnapshot {
  uuid: string;
  workerId: string;
  leaseStatus: number;
  leaseToken: string;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
  releasedAt?: string;
  diagnosticsJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutoCutNativeTaskSnapshot {
  uuid: string;
  taskType: number;
  status: number;
  progress: number;
  sourceAssetUuid?: string;
  inputJson: string;
  outputJson: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  stages: AutoCutNativeStageRunSnapshot[];
  events: AutoCutNativeTaskEventSnapshot[];
  workerLeases: AutoCutNativeWorkerLeaseSnapshot[];
}

export type AutoCutNativeAssetUrlFactory = (artifactPath: string) => string;

export type AutoCutNativeInvoke = <TResult>(
  command: AutoCutNativeCommand,
  args?: Record<string, unknown>,
) => Promise<TResult>;

export type AutoCutNativeCommand =
  | 'autocut_host_capabilities'
  | 'autocut_database_health'
  | 'autocut_ffmpeg_probe'
  | 'autocut_import_media_file'
  | 'autocut_describe_local_media_file'
  | 'autocut_select_local_video_file'
  | 'autocut_select_local_directory'
  | 'autocut_list_native_tasks'
  | 'autocut_cancel_native_task'
  | 'autocut_recover_native_tasks'
  | 'autocut_retry_native_task'
  | 'autocut_extract_audio'
  | 'autocut_generate_gif'
  | 'autocut_slice_video'
  | 'autocut_transcribe_media'
  | 'autocut_probe_speech_transcription'
  | 'autocut_select_speech_transcription_file'
  | 'autocut_compress_video'
  | 'autocut_convert_video'
  | 'autocut_enhance_video'
  | 'autocut_llm_http_request'
  | 'autocut_save_llm_secret'
  | 'autocut_get_llm_secret'
  | 'autocut_delete_llm_secret'
  | 'autocut_audio_smoke';

export interface AutoCutNativeHostClient {
  getCapabilities(): Promise<AutoCutHostCapabilities>;
  getDatabaseHealth(): Promise<AutoCutDatabaseHealth>;
  probeFfmpeg(): Promise<AutoCutFfmpegProbe>;
  importMediaFile(request: AutoCutMediaImportRequest): Promise<AutoCutMediaImportResult>;
  describeLocalMediaFile(request: AutoCutMediaImportRequest): Promise<AutoCutLocalMediaFileDescription>;
  selectLocalVideoFile(): Promise<AutoCutLocalMediaFileDescription | null>;
  selectLocalDirectory(): Promise<string | null>;
  listNativeTasks(request: AutoCutNativeTaskQueryRequest): Promise<AutoCutNativeTaskSnapshot[]>;
  cancelNativeTask(request: AutoCutNativeTaskCancelRequest): Promise<AutoCutNativeTaskCancelResult>;
  recoverNativeTasks(request: AutoCutNativeTaskRecoveryRequest): Promise<AutoCutNativeTaskRecoveryResult>;
  retryNativeTask(request: AutoCutNativeTaskRetryRequest): Promise<AutoCutNativeTaskRetryResult>;
  extractAudio(request: AutoCutAudioExtractionRequest): Promise<AutoCutAudioExtractionResult>;
  generateGif(request: AutoCutVideoGifRequest): Promise<AutoCutVideoGifResult>;
  sliceVideo(request: AutoCutVideoSliceRequest): Promise<AutoCutVideoSliceResult>;
  transcribeMedia(request: AutoCutSpeechTranscriptionRequest): Promise<AutoCutSpeechTranscriptionResult>;
  probeSpeechTranscription(request: AutoCutSpeechTranscriptionProbeRequest): Promise<AutoCutSpeechTranscriptionProbe>;
  selectSpeechTranscriptionFile(request: AutoCutSpeechTranscriptionFileSelectRequest): Promise<string | null>;
  compressVideo(request: AutoCutVideoCompressRequest): Promise<AutoCutVideoCompressResult>;
  convertVideo(request: AutoCutVideoConvertRequest): Promise<AutoCutVideoConvertResult>;
  enhanceVideo(request: AutoCutVideoEnhanceRequest): Promise<AutoCutVideoEnhanceResult>;
  sendLlmHttpRequest(request: AutoCutLlmHttpRequest): Promise<AutoCutLlmHttpResponse>;
  saveLlmSecret(request: AutoCutSaveLlmSecretRequest): Promise<AutoCutSaveLlmSecretResult>;
  getLlmSecret(request: AutoCutLlmSecretRequest): Promise<AutoCutGetLlmSecretResult>;
  deleteLlmSecret(request: AutoCutLlmSecretRequest): Promise<AutoCutDeleteLlmSecretResult>;
  runAudioSmoke(): Promise<AutoCutAudioExtractionResult>;
  createAssetUrl: AutoCutNativeAssetUrlFactory;
}

const unsupportedCapabilities: AutoCutHostCapabilities = {
  contractVersion: 'browser-unsupported',
  hostKind: 'browser',
  databaseContractReady: false,
  sqliteMigrationReady: false,
  databaseHealthCommandReady: false,
  ffmpegProbeCommandReady: false,
  mediaImportCommandReady: false,
  mediaFileDescribeCommandReady: false,
  localVideoFileSelectCommandReady: false,
  localDirectorySelectCommandReady: false,
  audioExtractionCommandReady: false,
  audioExtractionFromAssetReady: false,
  videoGifCommandReady: false,
  videoSliceCommandReady: false,
  videoCompressCommandReady: false,
  videoConvertCommandReady: false,
  videoEnhanceCommandReady: false,
  speechTranscriptionCommandReady: false,
  speechTranscriptionToolchainReady: false,
  speechTranscriptionProbeCommandReady: false,
  speechTranscriptionFileSelectCommandReady: false,
  llmHttpCommandReady: false,
  llmSecretStoreReady: false,
  nativeTaskQueryCommandReady: false,
  nativeTaskCancelCommandReady: false,
  nativeTaskRecoveryCommandReady: false,
  nativeTaskRetryCommandReady: false,
  nativeTaskProgressEventsReady: false,
  nativeWorkerLeaseReady: false,
  ffmpegToolchainManifestReady: false,
  ffmpegToolchainResolverReady: false,
  ffmpegBundledReady: false,
  ffmpegExecutionReady: false,
  supportedCommands: [],
};

let configuredNativeHostClient: AutoCutNativeHostClient = createUnsupportedNativeHostClient();

export function createAutoCutNativeHostClient(
  invoke: AutoCutNativeInvoke,
  options: { createAssetUrl?: AutoCutNativeAssetUrlFactory } = {},
): AutoCutNativeHostClient {
  return {
    getCapabilities: () => invoke<AutoCutHostCapabilities>('autocut_host_capabilities'),
    getDatabaseHealth: () => invoke<AutoCutDatabaseHealth>('autocut_database_health'),
    probeFfmpeg: () => invoke<AutoCutFfmpegProbe>('autocut_ffmpeg_probe'),
    importMediaFile: (request) =>
      invoke<AutoCutMediaImportResult>('autocut_import_media_file', {
        request,
      }),
    describeLocalMediaFile: (request) =>
      invoke<AutoCutLocalMediaFileDescription>('autocut_describe_local_media_file', {
        request,
      }),
    selectLocalVideoFile: () =>
      invoke<AutoCutLocalMediaFileDescription | null>('autocut_select_local_video_file'),
    selectLocalDirectory: () =>
      invoke<string | null>('autocut_select_local_directory'),
    listNativeTasks: (request) =>
      invoke<AutoCutNativeTaskSnapshot[]>('autocut_list_native_tasks', {
        request,
      }),
    cancelNativeTask: (request) =>
      invoke<AutoCutNativeTaskCancelResult>('autocut_cancel_native_task', {
        request,
      }),
    recoverNativeTasks: (request) =>
      invoke<AutoCutNativeTaskRecoveryResult>('autocut_recover_native_tasks', {
        request,
      }),
    retryNativeTask: (request) =>
      invoke<AutoCutNativeTaskRetryResult>('autocut_retry_native_task', {
        request,
      }),
    extractAudio: (request) =>
      invoke<AutoCutAudioExtractionResult>('autocut_extract_audio', {
        request,
      }),
    generateGif: (request) =>
      invoke<AutoCutVideoGifResult>('autocut_generate_gif', {
        request,
      }),
    sliceVideo: (request) =>
      invoke<AutoCutVideoSliceResult>('autocut_slice_video', {
        request,
      }),
    transcribeMedia: (request) =>
      invoke<AutoCutSpeechTranscriptionResult>('autocut_transcribe_media', {
        request,
      }),
    probeSpeechTranscription: (request) =>
      invoke<AutoCutSpeechTranscriptionProbe>('autocut_probe_speech_transcription', {
        request,
      }),
    selectSpeechTranscriptionFile: (request) =>
      invoke<string | null>('autocut_select_speech_transcription_file', {
        request,
      }),
    compressVideo: (request) =>
      invoke<AutoCutVideoCompressResult>('autocut_compress_video', {
        request,
      }),
    convertVideo: (request) =>
      invoke<AutoCutVideoConvertResult>('autocut_convert_video', {
        request,
      }),
    enhanceVideo: (request) =>
      invoke<AutoCutVideoEnhanceResult>('autocut_enhance_video', {
        request,
      }),
    sendLlmHttpRequest: (request) =>
      invoke<AutoCutLlmHttpResponse>('autocut_llm_http_request', {
        request,
      }),
    saveLlmSecret: (request) =>
      invoke<AutoCutSaveLlmSecretResult>('autocut_save_llm_secret', {
        request,
      }),
    getLlmSecret: (request) =>
      invoke<AutoCutGetLlmSecretResult>('autocut_get_llm_secret', {
        request,
      }),
    deleteLlmSecret: (request) =>
      invoke<AutoCutDeleteLlmSecretResult>('autocut_delete_llm_secret', {
        request,
      }),
    runAudioSmoke: () => invoke<AutoCutAudioExtractionResult>('autocut_audio_smoke'),
    createAssetUrl:
      options.createAssetUrl ??
      (() => {
        throw new Error('AutoCut native asset URL conversion requires the Tauri desktop host.');
      }),
  };
}

export function configureAutoCutNativeHostClient(client: AutoCutNativeHostClient) {
  configuredNativeHostClient = client;
}

export function getAutoCutNativeHostClient() {
  return configuredNativeHostClient;
}

export async function selectAutoCutTrustedLocalVideoFile() {
  const nativeHostClient = getAutoCutNativeHostClient();
  const capabilities = await nativeHostClient.getCapabilities();
  if (!capabilities.localVideoFileSelectCommandReady) {
    throw new Error('AutoCut trusted local video selection requires the Tauri desktop host.');
  }

  return nativeHostClient.selectLocalVideoFile();
}

export async function selectAutoCutTrustedLocalDirectory() {
  const nativeHostClient = getAutoCutNativeHostClient();
  const capabilities = await nativeHostClient.getCapabilities();
  if (!capabilities.localDirectorySelectCommandReady) {
    throw new Error('AutoCut trusted local directory selection requires the Tauri desktop host.');
  }

  return nativeHostClient.selectLocalDirectory();
}

export async function selectAutoCutSpeechTranscriptionFile(kind: AutoCutSpeechTranscriptionFileSelectRequest['kind']) {
  const nativeHostClient = getAutoCutNativeHostClient();
  const capabilities = await nativeHostClient.getCapabilities();
  if (!capabilities.speechTranscriptionFileSelectCommandReady) {
    throw new Error('AutoCut local speech transcription file selection requires the Tauri desktop host.');
  }

  return nativeHostClient.selectSpeechTranscriptionFile({ kind });
}

export function resetAutoCutNativeHostClient() {
  configuredNativeHostClient = createUnsupportedNativeHostClient();
}

function createUnsupportedNativeHostClient(): AutoCutNativeHostClient {
  return {
    getCapabilities: async () => unsupportedCapabilities,
    getDatabaseHealth: async () => ({
      ready: false,
      databasePath: '',
      appliedMigrations: [],
      verifiedTables: [],
      missingTables: [],
      diagnostics: ['AutoCut native host is not available in this runtime.'],
    }),
    probeFfmpeg: async () => ({
      available: false,
      executable: '',
      sourceKind: 'browser',
      manifestReady: false,
      bundledReady: false,
      diagnostics: ['AutoCut native host is not available in this runtime.'],
    }),
    importMediaFile: async () => {
      throw new Error('AutoCut native media import requires the Tauri desktop host.');
    },
    describeLocalMediaFile: async () => {
      throw new Error('AutoCut native local file describe requires the Tauri desktop host.');
    },
    selectLocalVideoFile: async () => {
      throw new Error('AutoCut native local video file selection requires the Tauri desktop host.');
    },
    selectLocalDirectory: async () => {
      throw new Error('AutoCut native local directory selection requires the Tauri desktop host.');
    },
    probeSpeechTranscription: async () => {
      throw new Error('AutoCut native speech transcription probe requires the Tauri desktop host.');
    },
    selectSpeechTranscriptionFile: async () => {
      throw new Error('AutoCut native speech transcription file selection requires the Tauri desktop host.');
    },
    listNativeTasks: async () => {
      throw new Error('AutoCut native task query requires the Tauri desktop host.');
    },
    cancelNativeTask: async () => {
      throw new Error('AutoCut native task cancellation requires the Tauri desktop host.');
    },
    recoverNativeTasks: async () => {
      throw new Error('AutoCut native task recovery requires the Tauri desktop host.');
    },
    retryNativeTask: async () => {
      throw new Error('AutoCut native task retry requires the Tauri desktop host.');
    },
    extractAudio: async () => {
      throw new Error('AutoCut native audio extraction requires assetUuid and the Tauri desktop host.');
    },
    generateGif: async () => {
      throw new Error('AutoCut native video GIF generation requires assetUuid and the Tauri desktop host.');
    },
    sliceVideo: async () => {
      throw new Error('AutoCut native video slicing requires assetUuid and the Tauri desktop host.');
    },
    transcribeMedia: async () => {
      throw new Error('AutoCut native speech transcription requires assetUuid, a local speech transcription toolchain, and the Tauri desktop host.');
    },
    compressVideo: async () => {
      throw new Error('AutoCut native video compression requires assetUuid and the Tauri desktop host.');
    },
    convertVideo: async () => {
      throw new Error('AutoCut native video conversion requires assetUuid and the Tauri desktop host.');
    },
    enhanceVideo: async () => {
      throw new Error('AutoCut native video enhancement requires assetUuid and the Tauri desktop host.');
    },
    sendLlmHttpRequest: async () => {
      throw new Error('AutoCut native LLM HTTP request requires the Tauri desktop host.');
    },
    saveLlmSecret: async () => {
      throw new Error('AutoCut native LLM secret store requires the Tauri desktop host.');
    },
    getLlmSecret: async () => ({
      secretName: 'default',
      configured: false,
    }),
    deleteLlmSecret: async () => ({
      secretName: 'default',
      deleted: false,
    }),
    runAudioSmoke: async () => {
      throw new Error('AutoCut native audio smoke requires the Tauri desktop host.');
    },
    createAssetUrl: () => {
      throw new Error('AutoCut native asset URL conversion requires the Tauri desktop host.');
    },
  };
}
