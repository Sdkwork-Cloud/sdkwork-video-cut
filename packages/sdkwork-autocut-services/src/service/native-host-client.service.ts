import type { AutoCutSmartSliceTranscript } from '@sdkwork/autocut-types';

export type { AutoCutSpeechTranscriptionModelDownloadProgressEvent } from '@sdkwork/autocut-types';

export interface AutoCutHostCapabilities {
  contractVersion: string;
  hostKind: string;
  databaseContractReady: boolean;
  sqliteMigrationReady: boolean;
  databaseHealthCommandReady: boolean;
  ffmpegProbeCommandReady: boolean;
  mediaImportCommandReady: boolean;
  mediaFileDescribeCommandReady: boolean;
  localMediaFileSelectCommandReady: boolean;
  localVideoFileSelectCommandReady: boolean;
  localDirectorySelectCommandReady: boolean;
  localMediaPreviewDirectoryScopeCommandReady: boolean;
  openArtifactInFolderCommandReady: boolean;
  audioExtractionCommandReady: boolean;
  audioExtractionFromAssetReady: boolean;
  videoGifCommandReady: boolean;
  videoSliceCommandReady: boolean;
  videoSliceAudioActivityAnalysisCommandReady: boolean;
  videoCompressCommandReady: boolean;
  videoConvertCommandReady: boolean;
  videoEnhanceCommandReady: boolean;
  videoDedupFingerprintCommandReady: boolean;
  videoDedupFileIdentityCommandReady?: boolean;
  audioFingerprintCommandReady?: boolean;
  audioFingerprintAdapterReady?: boolean;
  speechTranscriptionCommandReady: boolean;
  speechTranscriptionToolchainReady: boolean;
  visualEvidenceExtractionContractReady: boolean;
  visualEvidenceExtractionCommandReady: boolean;
  visualEvidenceExtractionAdapterReady: boolean;
  taskEvidenceWriteCommandReady: boolean;
  speechTranscriptionProbeCommandReady: boolean;
  speechTranscriptionFileSelectCommandReady: boolean;
  speechTranscriptionModelDownloadCommandReady: boolean;
  speechTranscriptionExecutableDownloadCommandReady: boolean;
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
  hasAudioStream: boolean;
  hasVideoStream: boolean;
  durationMs?: number;
}

export interface AutoCutLocalMediaFileDescription {
  sourcePath: string;
  byteSize: number;
  name: string;
  mediaType: string;
  mimeType: string;
  hasAudioStream: boolean;
  hasVideoStream: boolean;
  durationMs?: number;
}

export interface AutoCutLocalMediaFileSelectRequest {
  mediaTypes: Array<'audio' | 'video'>;
}

export interface AutoCutLocalMediaPreviewDirectoryRequest {
  directoryPath: string;
}

export interface AutoCutLocalMediaPreviewDirectoryResult {
  directoryPath: string;
  allowed: boolean;
}

export interface AutoCutNativeArtifactInFolderRequest {
  artifactPath: string;
  taskOutputDir?: string;
}

export interface AutoCutNativeArtifactInFolderResult {
  artifactPath: string;
  containingDirectoryPath: string;
  opened: boolean;
}

export interface AutoCutAudioExtractionRequest {
  assetUuid: string;
  outputFormat: string;
  outputQuality: string;
  outputChannel: string;
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
  outputFileName?: string;
  planningEngine?: 'smart-cut-engine';
  smartCutPresetId?: string;
  smartCutPlanId?: string;
  smartCutRunId?: string;
  contentUnitIds?: string[];
  speakerIds?: string[];
  speakerRoles?: string[];
  audioMuteRanges?: Array<{ startMs: number; endMs: number }>;
  sourceSegments?: Array<{ startMs: number; endMs: number }>;
  renderedDurationMs?: number;
  removedSilenceMs?: number;
  internalSilenceTrimCount?: number;
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
  tailTreatment?: 'none' | 'semantic-extend' | 'fade-out';
  transcriptText?: string;
  transcriptSegments?: AutoCutSpeechTranscriptionSegment[];
  transcriptSegmentCount?: number;
  transcriptCoverageScore?: number;
  speechContinuityGrade?: 'strong' | 'repaired' | 'weak';
  risks?: string[];
}

export interface AutoCutVideoSliceAudioActivityAnalysisRequest {
  assetUuid: string;
  workflowTaskId?: string;
  profile: string;
  applyNoiseReduction: boolean;
  outputRootDir?: string;
  clips: AutoCutVideoSliceClipRequest[];
}

export interface AutoCutVideoSliceAudioActivityAnalysis {
  index: number;
  startMs: number;
  durationMs: number;
  sourceStartMs: number;
  sourceEndMs: number;
  audioActivityStartMs?: number;
  audioActivityEndMs?: number;
  leadingSilenceMs?: number;
  trailingSilenceMs?: number;
  internalSilenceIntervals?: Array<{ startMs: number; endMs: number }>;
  confidence: number;
  analysisFilter: string;
}

export interface AutoCutVideoSliceAudioActivityAnalysisResult {
  assetUuid: string;
  profile: string;
  analyses: AutoCutVideoSliceAudioActivityAnalysis[];
}

export interface AutoCutVideoSliceRenderProfile {
  targetAspectRatio: 'auto' | '16:9' | '9:16' | '1:1' | '4:3';
  objectFit: 'contain' | 'cover';
}

export interface AutoCutVideoSliceRequest {
  assetUuid: string;
  workflowTaskId?: string;
  clips: AutoCutVideoSliceClipRequest[];
  outputFormat: 'mp4';
  outputRootDir?: string;
  renderProfile?: AutoCutVideoSliceRenderProfile;
  noiseReduction?: boolean;
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
  sourceSegments?: Array<{ startMs: number; endMs: number }>;
  renderedDurationMs?: number;
  removedSilenceMs?: number;
  internalSilenceTrimCount?: number;
  tailTreatment?: 'none' | 'semantic-extend' | 'fade-out';
  transcriptText?: string;
  transcriptSegments?: AutoCutSpeechTranscriptionSegment[];
  transcriptSegmentCount?: number;
  transcriptCoverageScore?: number;
  speechContinuityGrade?: 'strong' | 'repaired' | 'weak';
  risks?: string[];
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
  words?: AutoCutSpeechTranscriptionWord[];
}

export interface AutoCutSpeechTranscriptionWord {
  startMs: number;
  endMs: number;
  text: string;
  probability?: number;
  prob?: number;
  p?: number;
}

export interface AutoCutSpeechTranscriptionRequest {
  assetUuid: string;
  workflowTaskId?: string;
  providerId?: string;
  language?: string;
  outputRootDir?: string;
  executablePath?: string;
  modelPath?: string;
  workflowPurpose?: string;
  sttPresetId?: string;
  sttExecutionProfile?: string;
  whisperChunkParallelism?: number;
  whisperChunkThreadCount?: number;
  whisperChunkSourceStrategy?: 'audio-first' | 'source-direct';
  whisperAudioContext?: number;
  whisperBeamSize?: number;
  whisperBestOf?: number;
  whisperNoFallback?: boolean;
  dedupeRepeatedSpeech?: boolean;
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
  standardTranscript?: AutoCutSmartSliceTranscript;
  qualityGuard?: AutoCutSpeechTranscriptQualityGuard;
  ffmpegExecutable: string;
  speechExecutable: string;
  sttPresetId?: string;
  executionProfile?: string;
}

export interface AutoCutSpeechTranscriptQualityGuard {
  schema: 'smart-slice.stt-quality-guard.v1' | string;
  status: 'not-run' | 'passed' | 'passed-empty' | 'passed-after-retry' | 'failed' | string;
  passed: boolean;
  scope: string;
  chunkId: string;
  retryCount: number;
  riskCount: number;
  risks: AutoCutSpeechTranscriptQualityRisk[];
  metrics: AutoCutSpeechTranscriptQualityMetrics;
}

export interface AutoCutSpeechTranscriptQualityRisk {
  code: string;
  severity: 'info' | 'warning' | 'blocker' | string;
  message: string;
  example?: string;
  count?: number;
  ratio?: number;
}

export interface AutoCutSpeechTranscriptQualityMetrics {
  segmentCount: number;
  textLength: number;
  uniqueCharacterRatio: number;
  replacementCharacterCount: number;
  repeatedPhraseRunCount: number;
  duplicateWindowRatio: number;
  tinySegmentRatio: number;
}

export interface AutoCutVideoFileFingerprintRequest {
  sourcePath: string;
}

export interface AutoCutVideoFileFingerprintResult {
  sourcePath: string;
  byteSize: number;
  modifiedAtMs?: number;
  sha256: string;
  algorithm: 'sha256' | string;
  fingerprintVersion: string;
  fileIdentityVersion?: string;
}

export interface AutoCutVideoFileIdentityResult {
  sourcePath: string;
  byteSize: number;
  modifiedAtMs: number;
  fileIdentityVersion: string;
}

export interface AutoCutAudioFingerprintRequest {
  assetUuid: string;
  sourcePath?: string;
  workflowTaskId?: string;
  fingerprintProfile: 'audio-energy-v1';
  sampleRateHz?: number;
  windowDurationMs?: number;
  outputRootDir?: string;
}

export interface AutoCutAudioFingerprintResult {
  taskUuid: string;
  sourceAssetUuid: string;
  provider: 'ffmpeg-audio' | string;
  profile: 'audio-energy-v1' | string;
  ready: boolean;
  durationMs: number;
  sampleRateHz: number;
  windowDurationMs: number;
  fingerprint: {
    algorithm: 'audio-energy-v1' | string;
    hash: string;
    energyBuckets: number[];
    silenceRatio: number;
    spectralCentroidBuckets?: number[];
  };
  diagnostics: string[];
}

export interface AutoCutVisualEvidenceExtractionRequest {
  assetUuid: string;
  sourcePath?: string;
  workflowTaskId?: string;
  visualEvidenceProfile: 'shot-boundary-v1' | 'scene-index-v1';
  sceneChangeThreshold?: number;
  minShotDurationMs?: number;
  includeFrameQuality?: boolean;
  includeFrameFingerprint?: boolean;
  outputRootDir?: string;
}

export interface AutoCutVisualEvidenceExtractionResult {
  taskUuid: string;
  sourceAssetUuid: string;
  provider: 'ffmpeg-scene' | string;
  profile: 'shot-boundary-v1' | 'scene-index-v1';
  ready: boolean;
  shots: Array<{
    id: string;
    startMs: number;
    endMs: number;
    confidence: number;
  }>;
  sceneBoundaries: Array<{ startMs: number; endMs: number }>;
  frameQuality?: Array<{
    atMs: number;
    blurScore: number;
    exposureScore: number;
    stabilityScore: number;
  }>;
  frameFingerprints?: Array<{
    atMs: number;
    algorithm: 'ahash-8x8-luma-v1' | string;
    hash: string;
    meanLuma: number;
    histogram: number[];
  }>;
  diagnostics: string[];
}

export interface AutoCutTaskEvidenceWriteRequest {
  workflowTaskId: string;
  outputRootDir?: string;
  relativePath: string;
  contentJson: unknown;
}

export interface AutoCutTaskEvidenceWriteResult {
  taskUuid: string;
  taskOutputDir: string;
  artifactPath: string;
  relativePath: string;
  byteSize: number;
  contentSha256: string;
}

export interface AutoCutSpeechTranscriptionProbeRequest {
  providerId?: string;
  executablePath?: string;
  modelPath?: string;
  sourceKind?: string;
  outputRootDir?: string;
}

export interface AutoCutSpeechTranscriptionProbe {
  ready: boolean;
  executableReady?: boolean;
  modelReady?: boolean;
  gpuReady?: boolean;
  gpuBackend?: string;
  gpuDiagnostics?: string[];
  executablePath: string;
  modelPath: string;
  sourceKind: string;
  diagnostics: string[];
  versionLine?: string;
  defaultExecutableDirectory?: string;
  defaultExecutablePath?: string;
  defaultModelDirectory?: string;
  defaultModelPath?: string;
  executableStrategy?: string;
}

export interface AutoCutSpeechTranscriptionFileSelectRequest {
  kind: 'executable' | 'model';
}

export interface AutoCutSpeechTranscriptionModelDownloadRequest {
  providerId: string;
  presetId: string;
  fileName: string;
  url: string;
  mirrorUrls?: readonly string[];
  sha256: string;
  outputRootDir?: string;
}

export interface AutoCutSpeechTranscriptionModelDownloadResult {
  providerId: string;
  presetId: string;
  fileName: string;
  modelPath: string;
  byteSize: number;
  downloaded: boolean;
  sourceUrl: string;
  sha256: string;
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
  | 'autocut_select_local_media_file'
  | 'autocut_select_local_video_file'
  | 'autocut_select_local_directory'
  | 'autocut_allow_local_media_preview_directory'
  | 'autocut_open_artifact_in_folder'
  | 'autocut_list_native_tasks'
  | 'autocut_cancel_native_task'
  | 'autocut_recover_native_tasks'
  | 'autocut_retry_native_task'
  | 'autocut_extract_audio'
  | 'autocut_generate_gif'
  | 'autocut_slice_video'
  | 'autocut_analyze_video_slice_audio_activity'
  | 'autocut_transcribe_media'
  | 'autocut_fingerprint_video_file'
  | 'autocut_probe_video_file_identity'
  | 'autocut_extract_audio_fingerprint'
  | 'autocut_extract_visual_evidence'
  | 'autocut_write_task_evidence_json'
  | 'autocut_probe_speech_transcription'
  | 'autocut_select_speech_transcription_file'
  | 'autocut_download_speech_transcription_model'
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
  selectLocalMediaFile(request: AutoCutLocalMediaFileSelectRequest): Promise<AutoCutLocalMediaFileDescription | null>;
  selectLocalVideoFile(): Promise<AutoCutLocalMediaFileDescription | null>;
  selectLocalDirectory(): Promise<string | null>;
  allowLocalMediaPreviewDirectory(request: AutoCutLocalMediaPreviewDirectoryRequest): Promise<AutoCutLocalMediaPreviewDirectoryResult>;
  openArtifactInFolder(request: AutoCutNativeArtifactInFolderRequest): Promise<AutoCutNativeArtifactInFolderResult>;
  listNativeTasks(request: AutoCutNativeTaskQueryRequest): Promise<AutoCutNativeTaskSnapshot[]>;
  cancelNativeTask(request: AutoCutNativeTaskCancelRequest): Promise<AutoCutNativeTaskCancelResult>;
  recoverNativeTasks(request: AutoCutNativeTaskRecoveryRequest): Promise<AutoCutNativeTaskRecoveryResult>;
  retryNativeTask(request: AutoCutNativeTaskRetryRequest): Promise<AutoCutNativeTaskRetryResult>;
  extractAudio(request: AutoCutAudioExtractionRequest): Promise<AutoCutAudioExtractionResult>;
  generateGif(request: AutoCutVideoGifRequest): Promise<AutoCutVideoGifResult>;
  analyzeVideoSliceAudioActivity(
    request: AutoCutVideoSliceAudioActivityAnalysisRequest,
  ): Promise<AutoCutVideoSliceAudioActivityAnalysisResult>;
  sliceVideo(request: AutoCutVideoSliceRequest): Promise<AutoCutVideoSliceResult>;
  transcribeMedia(request: AutoCutSpeechTranscriptionRequest): Promise<AutoCutSpeechTranscriptionResult>;
  fingerprintVideoFile(request: AutoCutVideoFileFingerprintRequest): Promise<AutoCutVideoFileFingerprintResult>;
  probeVideoFileIdentity(request: AutoCutVideoFileFingerprintRequest): Promise<AutoCutVideoFileIdentityResult>;
  fingerprintAudio(request: AutoCutAudioFingerprintRequest): Promise<AutoCutAudioFingerprintResult>;
  extractVisualEvidence(request: AutoCutVisualEvidenceExtractionRequest): Promise<AutoCutVisualEvidenceExtractionResult>;
  writeTaskEvidenceJson(request: AutoCutTaskEvidenceWriteRequest): Promise<AutoCutTaskEvidenceWriteResult>;
  probeSpeechTranscription(request: AutoCutSpeechTranscriptionProbeRequest): Promise<AutoCutSpeechTranscriptionProbe>;
  selectSpeechTranscriptionFile(request: AutoCutSpeechTranscriptionFileSelectRequest): Promise<string | null>;
  downloadSpeechTranscriptionModel(request: AutoCutSpeechTranscriptionModelDownloadRequest): Promise<AutoCutSpeechTranscriptionModelDownloadResult>;
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
  localMediaFileSelectCommandReady: false,
  localVideoFileSelectCommandReady: false,
  localDirectorySelectCommandReady: false,
  localMediaPreviewDirectoryScopeCommandReady: false,
  openArtifactInFolderCommandReady: false,
  audioExtractionCommandReady: false,
  audioExtractionFromAssetReady: false,
  videoGifCommandReady: false,
  videoSliceCommandReady: false,
  videoSliceAudioActivityAnalysisCommandReady: false,
  videoCompressCommandReady: false,
  videoConvertCommandReady: false,
  videoEnhanceCommandReady: false,
  videoDedupFingerprintCommandReady: false,
  videoDedupFileIdentityCommandReady: false,
  audioFingerprintCommandReady: false,
  audioFingerprintAdapterReady: false,
  speechTranscriptionCommandReady: false,
  speechTranscriptionToolchainReady: false,
  visualEvidenceExtractionContractReady: false,
  visualEvidenceExtractionCommandReady: false,
  visualEvidenceExtractionAdapterReady: false,
  taskEvidenceWriteCommandReady: false,
  speechTranscriptionProbeCommandReady: false,
  speechTranscriptionFileSelectCommandReady: false,
  speechTranscriptionModelDownloadCommandReady: false,
  speechTranscriptionExecutableDownloadCommandReady: false,
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

const MIN_NATIVE_VIDEO_SLICE_TRANSCRIPT_COVERAGE_SCORE = 0.8;
const NATIVE_VIDEO_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS = 80;
const ACCEPTED_NATIVE_VIDEO_SLICE_SPEECH_CONTINUITY_GRADES = new Set<AutoCutVideoSliceClipRequest['speechContinuityGrade']>([
  'strong',
  'repaired',
]);

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
    selectLocalMediaFile: (request) =>
      invoke<AutoCutLocalMediaFileDescription | null>('autocut_select_local_media_file', {
        request,
      }),
    selectLocalVideoFile: () =>
      invoke<AutoCutLocalMediaFileDescription | null>('autocut_select_local_video_file'),
    selectLocalDirectory: () =>
      invoke<string | null>('autocut_select_local_directory'),
    allowLocalMediaPreviewDirectory: (request) =>
      invoke<AutoCutLocalMediaPreviewDirectoryResult>('autocut_allow_local_media_preview_directory', {
        request,
      }),
    openArtifactInFolder: (request) =>
      invoke<AutoCutNativeArtifactInFolderResult>('autocut_open_artifact_in_folder', {
        request,
      }),
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
    analyzeVideoSliceAudioActivity: (request) => {
      assertAutoCutNativeVideoSliceTranscriptEvidence({ assetUuid: request.assetUuid, clips: request.clips, outputFormat: 'mp4' });
      return invoke<AutoCutVideoSliceAudioActivityAnalysisResult>('autocut_analyze_video_slice_audio_activity', {
        request,
      });
    },
    sliceVideo: (request) => {
      assertAutoCutNativeVideoSliceTranscriptEvidence(request);
      return invoke<AutoCutVideoSliceResult>('autocut_slice_video', {
        request,
      });
    },
    transcribeMedia: (request) =>
      invoke<AutoCutSpeechTranscriptionResult>('autocut_transcribe_media', {
        request,
      }),
    fingerprintVideoFile: (request) =>
      invoke<AutoCutVideoFileFingerprintResult>('autocut_fingerprint_video_file', {
        request,
      }),
    probeVideoFileIdentity: (request) =>
      invoke<AutoCutVideoFileIdentityResult>('autocut_probe_video_file_identity', {
        request,
      }),
    fingerprintAudio: (request) =>
      invoke<AutoCutAudioFingerprintResult>('autocut_extract_audio_fingerprint', {
        request,
      }),
    extractVisualEvidence: (request) =>
      invoke<AutoCutVisualEvidenceExtractionResult>('autocut_extract_visual_evidence', {
        request,
      }),
    writeTaskEvidenceJson: (request) =>
      invoke<AutoCutTaskEvidenceWriteResult>('autocut_write_task_evidence_json', {
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
    downloadSpeechTranscriptionModel: (request) =>
      invoke<AutoCutSpeechTranscriptionModelDownloadResult>('autocut_download_speech_transcription_model', {
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

function assertAutoCutNativeVideoSliceTranscriptEvidence(request: AutoCutVideoSliceRequest) {
  request.clips.forEach((clip, index) => {
    assertAutoCutNativeVideoSliceClipTranscriptEvidence(clip, index + 1);
  });
}

function assertAutoCutNativeVideoSliceClipTranscriptEvidence(
  clip: AutoCutVideoSliceClipRequest,
  clipNumber: number,
) {
  const transcriptSegments = clip.transcriptSegments?.filter((segment) => segment.text.trim());
  if (!transcriptSegments?.length) {
    throw new Error(
      `AutoCut video slice clip ${clipNumber} requires speech-to-text transcript evidence before native rendering.`,
    );
  }

  const transcriptText = clip.transcriptText?.trim();
  if (!transcriptText) {
    throw new Error(
      `AutoCut video slice clip ${clipNumber} requires visible speech-to-text transcript evidence before native rendering.`,
    );
  }

  const expectedTranscriptText = transcriptSegments.map((segment) => segment.text.trim()).join(' ');
  if (
    !expectedTranscriptText ||
    normalizeAutoCutNativeVideoSliceTranscriptText(transcriptText) !==
      normalizeAutoCutNativeVideoSliceTranscriptText(expectedTranscriptText)
  ) {
    throw new Error(
      `AutoCut video slice clip ${clipNumber} transcriptText must match structured speech-to-text transcriptSegments.`,
    );
  }

  if (clip.transcriptSegmentCount !== transcriptSegments.length) {
    throw new Error(
      `AutoCut video slice clip ${clipNumber} transcriptSegmentCount must match structured speech-to-text transcriptSegments.`,
    );
  }

  const audioMuteRanges = clip.audioMuteRanges?.filter((range) =>
    Number.isFinite(range.startMs) &&
      Number.isFinite(range.endMs) &&
      range.endMs > range.startMs
  ) ?? [];
  if (audioMuteRanges.some((range) => range.startMs < clip.startMs || range.endMs > clip.startMs + clip.durationMs)) {
    throw new Error(
      `AutoCut video slice clip ${clipNumber} audioMuteRanges must stay inside rendered clip timing.`,
    );
  }

  const sourceSegments = clip.sourceSegments?.filter((range) =>
    Number.isFinite(range.startMs) &&
      Number.isFinite(range.endMs) &&
      range.endMs > range.startMs
  ) ?? [];
  if (sourceSegments.length > 0) {
    if (sourceSegments.length > 80) {
      throw new Error(`AutoCut video slice clip ${clipNumber} supports at most 80 retained sourceSegments.`);
    }
    let previousSegmentEndMs: number | undefined;
    let retainedDurationMs = 0;
    for (const [segmentIndex, segment] of sourceSegments.entries()) {
      if (
        segment.startMs < clip.startMs ||
        segment.endMs > clip.startMs + clip.durationMs ||
        (previousSegmentEndMs !== undefined && segment.startMs < previousSegmentEndMs)
      ) {
        throw new Error(
          `AutoCut video slice clip ${clipNumber} sourceSegments[${segmentIndex + 1}] must be ordered and stay inside rendered clip timing.`,
        );
      }
      retainedDurationMs += segment.endMs - segment.startMs;
      previousSegmentEndMs = segment.endMs;
    }
    if (
      typeof clip.renderedDurationMs === 'number' &&
      Number.isFinite(clip.renderedDurationMs) &&
      Math.abs(clip.renderedDurationMs - retainedDurationMs) > 1
    ) {
      throw new Error(`AutoCut video slice clip ${clipNumber} renderedDurationMs must match retained sourceSegments duration.`);
    }
  }

  const sourceStartMs = clip.sourceStartMs ?? clip.startMs;
  const sourceEndMs = clip.sourceEndMs ?? clip.startMs + clip.durationMs;
  if (!Number.isFinite(sourceStartMs) || !Number.isFinite(sourceEndMs) || sourceEndMs <= sourceStartMs) {
    throw new Error(`AutoCut video slice clip ${clipNumber} sourceEndMs must be after sourceStartMs.`);
  }
  if (sourceStartMs < clip.startMs || sourceEndMs > clip.startMs + clip.durationMs) {
    throw new Error(`AutoCut video slice clip ${clipNumber} source range must stay inside rendered clip timing.`);
  }
  if (
    sourceSegments.length > 0 &&
    (sourceSegments[0]?.startMs !== sourceStartMs || sourceSegments.at(-1)?.endMs !== sourceEndMs)
  ) {
    throw new Error(
      `AutoCut video slice clip ${clipNumber} source range must span retained sourceSegments.`,
    );
  }

  const speechStartMs = clip.speechStartMs;
  const speechEndMs = clip.speechEndMs;
  if (typeof speechStartMs !== 'number' || !Number.isFinite(speechStartMs)) {
    throw new Error(
      `AutoCut video slice clip ${clipNumber} requires speechStartMs from speech-to-text evidence.`,
    );
  }
  if (typeof speechEndMs !== 'number' || !Number.isFinite(speechEndMs)) {
    throw new Error(`AutoCut video slice clip ${clipNumber} requires speechEndMs from speech-to-text evidence.`);
  }
  if (speechEndMs <= speechStartMs || speechStartMs < sourceStartMs || speechEndMs > sourceEndMs) {
    throw new Error(`AutoCut video slice clip ${clipNumber} speech range must stay inside its source range.`);
  }

  const firstTranscriptSegmentStartMs = transcriptSegments[0]?.startMs;
  const lastTranscriptSegmentEndMs = transcriptSegments.at(-1)?.endMs;
  if (
    firstTranscriptSegmentStartMs === undefined ||
    lastTranscriptSegmentEndMs === undefined ||
    firstTranscriptSegmentStartMs > speechStartMs + NATIVE_VIDEO_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS ||
    lastTranscriptSegmentEndMs < speechEndMs - NATIVE_VIDEO_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS
  ) {
    throw new Error(
      `AutoCut video slice clip ${clipNumber} speech range must stay covered by structured transcript segment boundaries.`,
    );
  }

  let previousEndMs: number | undefined;
  transcriptSegments.forEach((segment, segmentIndex) => {
    const segmentNumber = segmentIndex + 1;
    if (!segment.text.trim()) {
      throw new Error(
        `AutoCut video slice clip ${clipNumber} transcript segment ${segmentNumber} must contain recognized speech text.`,
      );
    }
    if (
      !Number.isFinite(segment.startMs) ||
      !Number.isFinite(segment.endMs) ||
      segment.endMs <= segment.startMs ||
      segment.startMs < sourceStartMs ||
      segment.endMs > sourceEndMs
    ) {
      throw new Error(
        `AutoCut video slice clip ${clipNumber} transcript segment ${segmentNumber} must stay inside the source range.`,
      );
    }
    if (previousEndMs !== undefined && segment.startMs < previousEndMs) {
      throw new Error(`AutoCut video slice clip ${clipNumber} transcript segments must be ordered and non-overlapping.`);
    }
    previousEndMs = segment.endMs;
  });

  if (
    typeof clip.transcriptCoverageScore !== 'number' ||
    !Number.isFinite(clip.transcriptCoverageScore) ||
    clip.transcriptCoverageScore < MIN_NATIVE_VIDEO_SLICE_TRANSCRIPT_COVERAGE_SCORE
  ) {
    throw new Error(
      `AutoCut video slice clip ${clipNumber} transcriptCoverageScore must be at least ${MIN_NATIVE_VIDEO_SLICE_TRANSCRIPT_COVERAGE_SCORE}.`,
    );
  }

  if (!ACCEPTED_NATIVE_VIDEO_SLICE_SPEECH_CONTINUITY_GRADES.has(clip.speechContinuityGrade)) {
    throw new Error(`AutoCut video slice clip ${clipNumber} speechContinuityGrade must be strong or repaired.`);
  }
}

function normalizeAutoCutNativeVideoSliceTranscriptText(value: string) {
  return value.split(/\s+/u).filter(Boolean).join(' ');
}

export async function selectAutoCutTrustedLocalVideoFile() {
  const nativeHostClient = getAutoCutNativeHostClient();
  const capabilities = await nativeHostClient.getCapabilities();
  if (!capabilities.localVideoFileSelectCommandReady) {
    throw new Error('AutoCut trusted local video selection requires the Tauri desktop host.');
  }

  return nativeHostClient.selectLocalVideoFile();
}

export async function selectAutoCutTrustedLocalMediaFile(
  mediaTypes: AutoCutLocalMediaFileSelectRequest['mediaTypes'] = ['audio', 'video'],
) {
  const nativeHostClient = getAutoCutNativeHostClient();
  const capabilities = await nativeHostClient.getCapabilities();
  if (!capabilities.localMediaFileSelectCommandReady) {
    throw new Error('AutoCut trusted local media selection requires the Tauri desktop host.');
  }

  return nativeHostClient.selectLocalMediaFile({ mediaTypes });
}

export async function selectAutoCutTrustedLocalDirectory() {
  const nativeHostClient = getAutoCutNativeHostClient();
  const capabilities = await nativeHostClient.getCapabilities();
  if (!capabilities.localDirectorySelectCommandReady) {
    throw new Error('AutoCut trusted local directory selection requires the Tauri desktop host.');
  }

  return nativeHostClient.selectLocalDirectory();
}

export async function allowAutoCutTrustedLocalMediaPreviewDirectory(directoryPath: string) {
  const nativeHostClient = getAutoCutNativeHostClient();
  const capabilities = await nativeHostClient.getCapabilities();
  if (!capabilities.localMediaPreviewDirectoryScopeCommandReady) {
    throw new Error('AutoCut local media preview directory authorization requires the Tauri desktop host.');
  }

  return nativeHostClient.allowLocalMediaPreviewDirectory({ directoryPath });
}

export async function openAutoCutNativeArtifactInFolder(artifactPath: string, taskOutputDir?: string) {
  const nativeHostClient = getAutoCutNativeHostClient();
  const capabilities = await nativeHostClient.getCapabilities();
  if (!capabilities.openArtifactInFolderCommandReady) {
    throw new Error('AutoCut generated artifact folder opening requires the Tauri desktop host.');
  }

  return nativeHostClient.openArtifactInFolder({
    artifactPath,
    ...(taskOutputDir ? { taskOutputDir } : {}),
  });
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
    selectLocalMediaFile: async () => {
      throw new Error('AutoCut native local media file selection requires the Tauri desktop host.');
    },
    selectLocalVideoFile: async () => {
      throw new Error('AutoCut native local video file selection requires the Tauri desktop host.');
    },
    selectLocalDirectory: async () => {
      throw new Error('AutoCut native local directory selection requires the Tauri desktop host.');
    },
    allowLocalMediaPreviewDirectory: async () => {
      throw new Error('AutoCut local media preview directory authorization requires the Tauri desktop host.');
    },
    openArtifactInFolder: async () => {
      throw new Error('AutoCut generated artifact folder opening requires the Tauri desktop host.');
    },
    probeSpeechTranscription: async () => {
      throw new Error('AutoCut native speech transcription probe requires the Tauri desktop host.');
    },
    selectSpeechTranscriptionFile: async () => {
      throw new Error('AutoCut native speech transcription file selection requires the Tauri desktop host.');
    },
    downloadSpeechTranscriptionModel: async () => {
      throw new Error('AutoCut native speech transcription model download requires the Tauri desktop host.');
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
    analyzeVideoSliceAudioActivity: async () => {
      throw new Error('AutoCut native Smart Slice audio activity analysis requires assetUuid and the Tauri desktop host.');
    },
    sliceVideo: async () => {
      throw new Error('AutoCut native video slicing requires assetUuid and the Tauri desktop host.');
    },
    transcribeMedia: async () => {
      throw new Error('AutoCut native speech transcription requires assetUuid, a local speech transcription toolchain, and the Tauri desktop host.');
    },
    fingerprintVideoFile: async () => {
      throw new Error('AutoCut native video dedup fingerprinting requires a local artifact path and the Tauri desktop host.');
    },
    probeVideoFileIdentity: async () => {
      throw new Error('AutoCut native video dedup file identity probing requires a local artifact path and the Tauri desktop host.');
    },
    fingerprintAudio: async () => {
      throw new Error('AutoCut native audio fingerprint extraction requires assetUuid, source audio evidence, and the Tauri desktop host.');
    },
    extractVisualEvidence: async () => {
      throw new Error('AutoCut native visual evidence extraction requires assetUuid, a source-backed visual evidence adapter, and the Tauri desktop host.');
    },
    writeTaskEvidenceJson: async () => {
      throw new Error('AutoCut workflow task evidence JSON persistence requires the Tauri desktop host.');
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
