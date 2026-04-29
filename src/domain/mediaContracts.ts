import type { VideoCutType } from './videoCutTypes';

export const mediaContractSchemaIds = {
  audioExtract: 'video-cut.audio-extract.schema.v1',
  mediaInfo: 'video-cut.media-info.schema.v1',
  nleTimeline: 'video-cut.nle-timeline.schema.v1',
  renderAttemptManifest: 'video-cut.render-attempt.schema.v1',
  renderRequest: 'video-cut.render-request.schema.v1',
  semanticAnalysis: 'video-cut.semantic-analysis.schema.v1',
  silenceRanges: 'video-cut.silence-ranges.schema.v1',
  subtitleDocument: 'video-cut.subtitle-document.schema.v1',
  transcriptDocument: 'video-cut.transcript.schema.v1',
  vadRanges: 'video-cut.vad-ranges.schema.v1',
  videoSplitPlan: 'video-cut.split-plan.schema.v1',
} as const;

export type MediaProbeStatus = 'ok' | 'failed' | 'source-unavailable';
export type AudioExtractStatus = 'ok' | 'failed' | 'source-unavailable';
export type SilenceDetectionStatus = 'ok' | 'failed' | 'audio-unavailable';
export type VadStatus = 'ok' | 'failed' | 'unavailable' | 'audio-unavailable';
export type TranscriptStatus = 'ok' | 'failed' | 'provider-unavailable' | 'audio-unavailable';
export type SemanticAnalysisStatus = 'ok' | 'failed' | 'provider-unavailable' | 'transcript-unavailable';
export type TimestampGranularity = 'segment' | 'word';
export type AudioFilterPreset = 'voice-basic-loudnorm-afftdn.v1';
export type VoiceEnhancementStatus = 'applied' | 'skipped' | 'failed';
export type VoiceEnhancementFilter = 'loudnorm' | 'afftdn';
export type AudioAssetMixStatus = 'mixed' | 'not-configured' | 'unavailable' | 'disabled';
export type RenderAssetPreferenceMode = 'auto' | 'asset' | 'disabled';

export interface RenderAudioAssetProvenance {
  assetId: string;
  path: `assets://${'bgm' | 'sfx'}/${string}`;
  sha256: string;
  license: string;
  source: string;
  version: string;
}

export interface RenderAudioAssetPreference {
  mode: RenderAssetPreferenceMode;
  assetId?: string;
  path?: `assets://${'bgm' | 'sfx'}/${string}`;
}

export interface RenderPreferences {
  audio: {
    bgm: RenderAudioAssetPreference;
    bgmVolumePercent: 20;
    sfx: RenderAudioAssetPreference;
    voiceEnhancement: 'basic';
  };
}

export type TrackKind =
  | 'mediaInfoTrack'
  | 'silenceTrack'
  | 'speechActivityTrack'
  | 'transcriptTrack'
  | 'sceneTrack'
  | 'subjectTrack'
  | 'semanticTrack'
  | 'cutDecisionTrack';

export type SegmentDecisionReason =
  | 'sentence-boundary'
  | 'silence-boundary'
  | 'vad-confidence'
  | 'semantic-boundary'
  | 'duration-fit'
  | 'manual-override';

export interface TimeRangeMs {
  startMs: number;
  endMs: number;
}

export interface TrackProvenance {
  kind: TrackKind;
  sourceArtifactId: string;
  providerId: string;
  adapterVersion: string;
  inputHash: string;
  outputHash: string;
  parameters: Record<string, string | number | boolean>;
  warnings: string[];
}

export interface VideoSplitSegment {
  segmentId: string;
  title: string;
  type: VideoCutType;
  sourceRange: TimeRangeMs;
  outputRange: TimeRangeMs;
  score: number;
  decisionReasons: SegmentDecisionReason[];
  hardConstraints: string[];
  warnings: string[];
}

export interface OutputVideoSpec {
  aspectRatio: '9:16';
  width: number;
  height: number;
  frameRate: 30;
  format: 'mp4';
}

export interface VideoSplitPlan {
  schemaId: typeof mediaContractSchemaIds.videoSplitPlan;
  planVersion: 1;
  planId: string;
  planRevision: number;
  taskId: string;
  sourceName: string;
  type: VideoCutType;
  outputSpec: OutputVideoSpec;
  renderPreferences: RenderPreferences;
  tracks: TrackProvenance[];
  segments: VideoSplitSegment[];
  createdAt: string;
}

export interface SubtitleStyle {
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

export interface SubtitleCue {
  cueId: string;
  sourceRange: TimeRangeMs;
  outputRange: TimeRangeMs;
  text: string;
  highlightWords: string[];
}

export interface SubtitleDocument {
  schemaId: typeof mediaContractSchemaIds.subtitleDocument;
  subtitleVersion: 1;
  subtitleId: string;
  taskId: string;
  planId: string;
  format: 'internal';
  style: SubtitleStyle;
  cues: SubtitleCue[];
  warnings: string[];
  createdAt: string;
}

export interface RenderRequest {
  schemaId: typeof mediaContractSchemaIds.renderRequest;
  requestVersion: 1;
  renderId: string;
  taskId: string;
  planId: string;
  planRevision: number;
  subtitleId: string;
  outputSpec: OutputVideoSpec;
  audio: {
    bgmVolumePercent: 20;
    sfxEnabled: boolean;
    voiceEnhancement: 'basic';
  };
  codec: {
    video: 'libx264';
    audio: 'aac';
  };
  createdAt: string;
}

export interface RenderAttemptManifest {
  schemaId: typeof mediaContractSchemaIds.renderAttemptManifest;
  renderAttemptVersion: 1;
  taskId: string;
  renderId: string;
  planId: string;
  planRevision: number;
  sourceArtifactId: string;
  transcriptArtifactId?: string | null;
  outputArtifactId: string;
  subtitleArtifactId: string;
  coverArtifactId: string;
  logArtifactId: string;
  subtitleBurnIn: boolean;
  subtitleCueCount: number;
  sourceRange: TimeRangeMs;
  outputSpec: OutputVideoSpec;
  renderGraph: {
    engine: 'ffmpeg';
    adapterVersion: 'ffmpeg-media-render.adapter.v1';
    videoFilterPreset: 'standard-vertical-scale-crop-fps.v1' | 'standard-vertical-scale-crop-fps-ass-burn-in.v1';
    audioFilterPreset: AudioFilterPreset;
    voiceEnhancement: {
      status: VoiceEnhancementStatus;
      filters: VoiceEnhancementFilter[];
    };
    bgm: {
      status: AudioAssetMixStatus;
      mixed: boolean;
      volumePercent: 20;
      asset?: RenderAudioAssetProvenance;
    };
    sfx: {
      status: AudioAssetMixStatus;
      mixed: boolean;
      asset?: RenderAudioAssetProvenance;
    };
    codec: {
      video: 'libx264';
      audio: 'aac';
    };
  };
  warnings: string[];
  createdAt: string;
}

export interface MediaFormatInfo {
  formatName: string;
  durationSeconds: number;
  bitRate: number;
}

export interface MediaVideoStream {
  index: number;
  codec: string;
  width: number;
  height: number;
  frameRate: number;
}

export interface MediaAudioStream {
  index: number;
  codec: string;
  sampleRate: number;
  channels: number;
}

export interface MediaInfoDocument {
  schemaId: typeof mediaContractSchemaIds.mediaInfo;
  mediaInfoVersion: 1;
  taskId: string;
  sourceArtifactId: string;
  sourcePath: string;
  providerId: string;
  adapterVersion: string;
  probeStatus: MediaProbeStatus;
  format: MediaFormatInfo;
  videoStreams: MediaVideoStream[];
  audioStreams: MediaAudioStream[];
  warnings: string[];
  createdAt: string;
}

export interface AudioExtractDocument {
  schemaId: typeof mediaContractSchemaIds.audioExtract;
  audioExtractVersion: 1;
  taskId: string;
  sourceArtifactId: string;
  sourcePath: string;
  audioArtifactId: string;
  audioPath: string;
  providerId: string;
  adapterVersion: string;
  extractStatus: AudioExtractStatus;
  audio: {
    format: 'wav';
    codec: 'pcm_s16le';
    sampleRate: 16000;
    channels: 1;
    sizeBytes: number;
  };
  warnings: string[];
  createdAt: string;
}

export interface SilenceRange {
  startMs: number;
  endMs: number;
  durationMs: number;
}

export interface SilenceRangesDocument {
  schemaId: typeof mediaContractSchemaIds.silenceRanges;
  silenceRangesVersion: 1;
  taskId: string;
  audioArtifactId: string;
  audioPath: string;
  providerId: string;
  adapterVersion: string;
  detectionStatus: SilenceDetectionStatus;
  parameters: {
    noiseDb: number;
    minDurationSeconds: number;
  };
  ranges: SilenceRange[];
  warnings: string[];
  createdAt: string;
}

export interface VadRange {
  startMs: number;
  endMs: number;
  confidence: number;
}

export interface VadRangesDocument {
  schemaId: typeof mediaContractSchemaIds.vadRanges;
  vadRangesVersion: 1;
  taskId: string;
  audioArtifactId: string;
  audioPath: string;
  providerId: string;
  adapterVersion: string;
  vadStatus: VadStatus;
  parameters: {
    sampleRate: 16000;
    threshold: number;
    minSpeechDurationMs: number;
    minSilenceDurationMs: number;
  };
  ranges: VadRange[];
  warnings: string[];
  createdAt: string;
}

export interface TranscriptSegment {
  segmentId: string;
  startMs: number;
  endMs: number;
  text: string;
  confidence?: number;
  speakerId?: string;
}

export interface TranscriptDocument {
  schemaId: typeof mediaContractSchemaIds.transcriptDocument;
  transcriptVersion: 1;
  taskId: string;
  audioArtifactId: string;
  audioPath: string;
  providerId: string;
  adapterVersion: string;
  transcriptStatus: TranscriptStatus;
  language: string;
  timestampGranularity: TimestampGranularity[];
  durationSeconds: number;
  text: string;
  segments: TranscriptSegment[];
  warnings: string[];
  createdAt: string;
}

export interface SemanticTopic {
  topicId: string;
  label: string;
  score: number;
}

export interface QaCandidate {
  qaId: string;
  question: string;
  answer: string;
  sourceRange: TimeRangeMs;
  score: number;
}

export interface SemanticAnalysisDocument {
  schemaId: typeof mediaContractSchemaIds.semanticAnalysis;
  semanticAnalysisVersion: 1;
  taskId: string;
  transcriptArtifactId: string;
  providerId: string;
  adapterVersion: string;
  semanticStatus: SemanticAnalysisStatus;
  model: string;
  summary: string;
  topics: SemanticTopic[];
  qaCandidates: QaCandidate[];
  warnings: string[];
  createdAt: string;
}

export interface ContractValidationError {
  field: string;
  code: string;
  message: string;
}

export interface ContractValidationResult {
  valid: boolean;
  errors: ContractValidationError[];
}

const requiredTrackKinds: TrackKind[] = [
  'mediaInfoTrack',
  'silenceTrack',
  'speechActivityTrack',
  'transcriptTrack',
  'sceneTrack',
  'subjectTrack',
  'semanticTrack',
  'cutDecisionTrack',
];

const defaultOutputSpec: OutputVideoSpec = {
  aspectRatio: '9:16',
  width: 1080,
  height: 1920,
  frameRate: 30,
  format: 'mp4',
};

const defaultRenderPreferences: RenderPreferences = {
  audio: {
    bgm: {
      mode: 'auto',
    },
    bgmVolumePercent: 20,
    sfx: {
      mode: 'auto',
    },
    voiceEnhancement: 'basic',
  },
};

function isoNow(): string {
  return new Date().toISOString();
}

function pseudoHash(seed: string): string {
  return `${seed}-hash`.padEnd(64, '0').slice(0, 64);
}

function rangeDurationSeconds(range: TimeRangeMs): number {
  return (range.endMs - range.startMs) / 1000;
}

function segmentRangeForType(type: VideoCutType): TimeRangeMs {
  if (type === 'single-speaker') {
    return {
      startMs: 1_000,
      endMs: 86_000,
    };
  }

  if (type === 'long-interview') {
    return {
      startMs: 12_000,
      endMs: 132_000,
    };
  }

  return {
    startMs: 8_000,
    endMs: 78_000,
  };
}

function createTrack(taskId: string, kind: TrackKind, index: number): TrackProvenance {
  const sourceArtifactId =
    kind === 'mediaInfoTrack'
      ? `${taskId}-media-info`
      : kind === 'silenceTrack'
        ? `${taskId}-silence-ranges`
        : kind === 'speechActivityTrack'
          ? `${taskId}-vad-ranges`
          : kind === 'transcriptTrack'
            ? `${taskId}-transcript`
            : kind === 'semanticTrack'
              ? `${taskId}-semantic-analysis`
            : `${taskId}-source`;

  return {
    kind,
    sourceArtifactId,
    providerId: `mock-${kind}`,
    adapterVersion: 'mock-adapter.v1',
    inputHash: pseudoHash(`${taskId}-${kind}-input`),
    outputHash: pseudoHash(`${taskId}-${kind}-output`),
    parameters: {
      deterministic: true,
      order: index,
    },
    warnings: [],
  };
}

export function createDefaultVideoSplitPlan({
  sourceName,
  taskId,
  type,
}: {
  sourceName: string;
  taskId: string;
  type: VideoCutType;
}): VideoSplitPlan {
  const sourceRange = segmentRangeForType(type);

  return {
    schemaId: mediaContractSchemaIds.videoSplitPlan,
    planVersion: 1,
    planId: `${taskId}-plan-1`,
    planRevision: 1,
    taskId,
    sourceName,
    type,
    outputSpec: defaultOutputSpec,
    renderPreferences: {
      audio: {
        bgm: { ...defaultRenderPreferences.audio.bgm },
        bgmVolumePercent: defaultRenderPreferences.audio.bgmVolumePercent,
        sfx: { ...defaultRenderPreferences.audio.sfx },
        voiceEnhancement: defaultRenderPreferences.audio.voiceEnhancement,
      },
    },
    tracks: requiredTrackKinds.map((kind, index) => createTrack(taskId, kind, index + 1)),
    segments: [
      {
        segmentId: `${taskId}-segment-1`,
        title: type === 'long-interview' ? '长访谈核心问答拆条' : '张老师核心观点',
        type,
        sourceRange,
        outputRange: {
          startMs: 0,
          endMs: sourceRange.endMs - sourceRange.startMs,
        },
        score: 0.86,
        decisionReasons: ['sentence-boundary', 'silence-boundary', 'semantic-boundary', 'duration-fit'],
        hardConstraints: [
          'no-cut-inside-subtitle-sentence',
          'no-cut-inside-word-timestamp',
          type === 'long-interview' ? 'duration-between-60-and-180-seconds' : 'duration-not-over-90-seconds',
        ],
        warnings: [],
      },
    ],
    createdAt: isoNow(),
  };
}

export function createDefaultSubtitleDocument({
  planId,
  taskId,
}: {
  planId: string;
  taskId: string;
}): SubtitleDocument {
  return {
    schemaId: mediaContractSchemaIds.subtitleDocument,
    subtitleVersion: 1,
    subtitleId: `${taskId}-subtitle-1`,
    taskId,
    planId,
    format: 'internal',
    style: {
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
    cues: [
      {
        cueId: `${taskId}-cue-1`,
        sourceRange: {
          startMs: 1_000,
          endMs: 4_000,
        },
        outputRange: {
          startMs: 0,
          endMs: 3_000,
        },
        text: '这段内容的核心，是找到真正的问题。',
        highlightWords: ['核心', '问题'],
      },
      {
        cueId: `${taskId}-cue-2`,
        sourceRange: {
          startMs: 4_200,
          endMs: 7_800,
        },
        outputRange: {
          startMs: 3_200,
          endMs: 6_800,
        },
        text: '把答案讲清楚，视频才有传播价值。',
        highlightWords: ['答案', '价值'],
      },
    ],
    warnings: [],
    createdAt: isoNow(),
  };
}

export function createDefaultRenderRequest({
  plan,
  subtitleDocument,
}: {
  plan: VideoSplitPlan;
  subtitleDocument: SubtitleDocument;
}): RenderRequest {
  return {
    schemaId: mediaContractSchemaIds.renderRequest,
    requestVersion: 1,
    renderId: `${plan.taskId}-render-1`,
    taskId: plan.taskId,
    planId: plan.planId,
    planRevision: plan.planRevision,
    subtitleId: subtitleDocument.subtitleId,
    outputSpec: plan.outputSpec,
    audio: {
      bgmVolumePercent: 20,
      sfxEnabled: true,
      voiceEnhancement: 'basic',
    },
    codec: {
      video: 'libx264',
      audio: 'aac',
    },
    createdAt: isoNow(),
  };
}

function pushError(errors: ContractValidationError[], field: string, code: string, message: string): void {
  errors.push({
    field,
    code,
    message,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isPositiveNumber(value) && Number.isInteger(value);
}

function isStandardOutputVideoSpec(value: unknown): value is OutputVideoSpec {
  if (!isRecord(value)) {
    return false;
  }

  if (
    value.aspectRatio !== '9:16' ||
    !isPositiveInteger(value.width) ||
    !isPositiveInteger(value.height) ||
    value.frameRate !== 30 ||
    value.format !== 'mp4'
  ) {
    return false;
  }

  return value.width * 16 === value.height * 9;
}

function isVoiceEnhancementStatus(value: unknown): value is VoiceEnhancementStatus {
  return value === 'applied' || value === 'skipped' || value === 'failed';
}

function isVoiceEnhancementFilter(value: unknown): value is VoiceEnhancementFilter {
  return value === 'loudnorm' || value === 'afftdn';
}

function isAudioAssetMixStatus(value: unknown): value is AudioAssetMixStatus {
  return value === 'mixed' || value === 'not-configured' || value === 'unavailable' || value === 'disabled';
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function isSafeAssetMetadataValue(value: unknown): value is string {
  if (!isNonEmptyString(value)) {
    return false;
  }

  return (
    !value.includes('\\') &&
    !value.includes('\0') &&
    !value.includes('..') &&
    !value.startsWith('/') &&
    !value.toLowerCase().startsWith('file:') &&
    !/^[a-zA-Z]:[\\/]/.test(value)
  );
}

function isRenderAudioAssetProvenance(value: unknown, kind: 'bgm' | 'sfx'): value is RenderAudioAssetProvenance {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNonEmptyString(value.assetId) &&
    value.assetId.startsWith(`${kind}-`) &&
    typeof value.path === 'string' &&
    value.path.startsWith(`assets://${kind}/`) &&
    !value.path.includes('..') &&
    !value.path.includes('\\') &&
    isSha256(value.sha256) &&
    isSafeAssetMetadataValue(value.license) &&
    isSafeAssetMetadataValue(value.source) &&
    isSafeAssetMetadataValue(value.version)
  );
}

function isRenderAudioAssetPreference(value: unknown, kind: 'bgm' | 'sfx'): value is RenderAudioAssetPreference {
  if (!isRecord(value)) {
    return false;
  }

  if (value.mode === 'auto' || value.mode === 'disabled') {
    return value.assetId === undefined && value.path === undefined;
  }

  if (value.mode !== 'asset') {
    return false;
  }

  return (
    isNonEmptyString(value.assetId) &&
    value.assetId.startsWith(`${kind}-`) &&
    /^[a-f0-9]{16}$/i.test(value.assetId.slice(kind.length + 1)) &&
    typeof value.path === 'string' &&
    value.path.startsWith(`assets://${kind}/`) &&
    !value.path.slice(`assets://${kind}/`.length).includes('/') &&
    !value.path.includes('\\') &&
    !value.path.includes('\0') &&
    !value.path.includes('..')
  );
}

function isRenderPreferences(value: unknown): value is RenderPreferences {
  if (!isRecord(value) || !isRecord(value.audio)) {
    return false;
  }

  return (
    isRenderAudioAssetPreference(value.audio.bgm, 'bgm') &&
    value.audio.bgmVolumePercent === 20 &&
    isRenderAudioAssetPreference(value.audio.sfx, 'sfx') &&
    value.audio.voiceEnhancement === 'basic'
  );
}

function isStandardVoiceFilterList(value: unknown, status: VoiceEnhancementStatus): value is VoiceEnhancementFilter[] {
  if (!Array.isArray(value) || value.some((item) => !isVoiceEnhancementFilter(item))) {
    return false;
  }

  if (status === 'applied') {
    return value.includes('loudnorm') && value.includes('afftdn');
  }

  return true;
}

function isConsistentMixStatus(status: AudioAssetMixStatus, mixed: unknown): mixed is boolean {
  if (typeof mixed !== 'boolean') {
    return false;
  }

  return status === 'mixed' ? mixed : !mixed;
}

function isConsistentAudioAssetSlot(value: Record<string, unknown>, kind: 'bgm' | 'sfx'): boolean {
  if (value.status === 'mixed') {
    return isRenderAudioAssetProvenance(value.asset, kind);
  }

  return value.asset === undefined;
}

function stringArrayAt(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
}

function validateRequiredString(
  errors: ContractValidationError[],
  document: Record<string, unknown>,
  field: string,
): void {
  if (!isNonEmptyString(document[field])) {
    pushError(errors, field, 'REQUIRED_STRING', `${field} is required.`);
  }
}

export function validateMediaInfoDocument(document: unknown): ContractValidationResult {
  const errors: ContractValidationError[] = [];

  if (!isRecord(document)) {
    pushError(errors, 'document', 'MEDIA_INFO_DOCUMENT_INVALID', 'Media info document must be an object.');
    return {
      valid: false,
      errors,
    };
  }

  if (document.schemaId !== mediaContractSchemaIds.mediaInfo) {
    pushError(errors, 'schemaId', 'SCHEMA_ID_MISMATCH', 'Media info document schemaId is invalid.');
  }

  if (document.mediaInfoVersion !== 1) {
    pushError(errors, 'mediaInfoVersion', 'MEDIA_INFO_VERSION_UNSUPPORTED', 'Media info version must be 1.');
  }

  validateRequiredString(errors, document, 'taskId');
  validateRequiredString(errors, document, 'sourceArtifactId');
  validateRequiredString(errors, document, 'providerId');
  validateRequiredString(errors, document, 'adapterVersion');
  validateRequiredString(errors, document, 'createdAt');

  const probeStatus = document.probeStatus;
  if (probeStatus !== 'ok' && probeStatus !== 'failed' && probeStatus !== 'source-unavailable') {
    pushError(errors, 'probeStatus', 'MEDIA_PROBE_STATUS_INVALID', 'Probe status must be ok, failed, or source-unavailable.');
  }

  if (!isRecord(document.format)) {
    pushError(errors, 'format', 'MEDIA_FORMAT_REQUIRED', 'Media format is required.');
  } else {
    if (typeof document.format.formatName !== 'string') {
      pushError(errors, 'format.formatName', 'MEDIA_FORMAT_NAME_INVALID', 'Media format name must be a string.');
    }

    if (!isNonNegativeNumber(document.format.durationSeconds)) {
      pushError(errors, 'format.durationSeconds', 'MEDIA_DURATION_INVALID', 'Media duration must be a non-negative number.');
    }

    if (!isNonNegativeNumber(document.format.bitRate)) {
      pushError(errors, 'format.bitRate', 'MEDIA_BIT_RATE_INVALID', 'Media bit rate must be a non-negative number.');
    }

    if (probeStatus === 'ok' && !isPositiveNumber(document.format.durationSeconds)) {
      pushError(errors, 'format.durationSeconds', 'MEDIA_DURATION_REQUIRED', 'Successful media probe must include a positive duration.');
    }
  }

  if (!Array.isArray(document.videoStreams)) {
    pushError(errors, 'videoStreams', 'MEDIA_VIDEO_STREAMS_REQUIRED', 'Video streams must be an array.');
  } else {
    if (probeStatus === 'ok' && document.videoStreams.length === 0) {
      pushError(errors, 'videoStreams', 'MEDIA_VIDEO_STREAM_REQUIRED', 'Successful media probe must include a video stream.');
    }

    document.videoStreams.forEach((stream, index) => {
      if (!isRecord(stream)) {
        pushError(errors, `videoStreams[${index}]`, 'MEDIA_VIDEO_STREAM_INVALID', 'Video stream must be an object.');
        return;
      }

      if (!isNonEmptyString(stream.codec)) {
        pushError(errors, `videoStreams[${index}].codec`, 'MEDIA_CODEC_REQUIRED', 'Video codec is required.');
      }

      if (!isPositiveNumber(stream.width) || !isPositiveNumber(stream.height)) {
        pushError(
          errors,
          `videoStreams[${index}]`,
          'MEDIA_VIDEO_DIMENSIONS_INVALID',
          'Video stream width and height must be positive numbers.',
        );
      }

      if (!isPositiveNumber(stream.frameRate)) {
        pushError(errors, `videoStreams[${index}].frameRate`, 'MEDIA_FRAME_RATE_INVALID', 'Video frame rate must be positive.');
      }
    });
  }

  if (!Array.isArray(document.audioStreams)) {
    pushError(errors, 'audioStreams', 'MEDIA_AUDIO_STREAMS_REQUIRED', 'Audio streams must be an array.');
  } else {
    document.audioStreams.forEach((stream, index) => {
      if (!isRecord(stream)) {
        pushError(errors, `audioStreams[${index}]`, 'MEDIA_AUDIO_STREAM_INVALID', 'Audio stream must be an object.');
        return;
      }

      if (!isNonEmptyString(stream.codec)) {
        pushError(errors, `audioStreams[${index}].codec`, 'MEDIA_CODEC_REQUIRED', 'Audio codec is required.');
      }

      if (!isPositiveNumber(stream.sampleRate)) {
        pushError(errors, `audioStreams[${index}].sampleRate`, 'MEDIA_SAMPLE_RATE_INVALID', 'Audio sample rate must be positive.');
      }

      if (!isPositiveNumber(stream.channels)) {
        pushError(errors, `audioStreams[${index}].channels`, 'MEDIA_CHANNELS_INVALID', 'Audio channels must be positive.');
      }
    });
  }

  const warnings = stringArrayAt(document.warnings);
  if (!Array.isArray(document.warnings) || warnings.length !== document.warnings.length) {
    pushError(errors, 'warnings', 'MEDIA_WARNINGS_INVALID', 'Media probe warnings must be an array of strings.');
  }

  if ((probeStatus === 'failed' || probeStatus === 'source-unavailable') && warnings.length === 0) {
    pushError(errors, 'warnings', 'MEDIA_PROBE_WARNING_REQUIRED', 'Failed media probe documents must explain the failure.');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateAudioExtractDocument(document: unknown): ContractValidationResult {
  const errors: ContractValidationError[] = [];

  if (!isRecord(document)) {
    pushError(errors, 'document', 'AUDIO_EXTRACT_DOCUMENT_INVALID', 'Audio extract document must be an object.');
    return {
      valid: false,
      errors,
    };
  }

  if (document.schemaId !== mediaContractSchemaIds.audioExtract) {
    pushError(errors, 'schemaId', 'SCHEMA_ID_MISMATCH', 'Audio extract document schemaId is invalid.');
  }

  if (document.audioExtractVersion !== 1) {
    pushError(errors, 'audioExtractVersion', 'AUDIO_EXTRACT_VERSION_UNSUPPORTED', 'Audio extract version must be 1.');
  }

  validateRequiredString(errors, document, 'taskId');
  validateRequiredString(errors, document, 'sourceArtifactId');
  validateRequiredString(errors, document, 'audioArtifactId');
  validateRequiredString(errors, document, 'audioPath');
  validateRequiredString(errors, document, 'providerId');
  validateRequiredString(errors, document, 'adapterVersion');
  validateRequiredString(errors, document, 'createdAt');

  const extractStatus = document.extractStatus;
  if (extractStatus !== 'ok' && extractStatus !== 'failed' && extractStatus !== 'source-unavailable') {
    pushError(errors, 'extractStatus', 'AUDIO_EXTRACT_STATUS_INVALID', 'Extract status must be ok, failed, or source-unavailable.');
  }

  if (!isRecord(document.audio)) {
    pushError(errors, 'audio', 'AUDIO_EXTRACT_AUDIO_REQUIRED', 'Audio extract metadata is required.');
  } else {
    if (document.audio.format !== 'wav') {
      pushError(errors, 'audio.format', 'AUDIO_FORMAT_INVALID', 'Extracted audio format must be wav.');
    }

    if (document.audio.codec !== 'pcm_s16le') {
      pushError(errors, 'audio.codec', 'AUDIO_CODEC_INVALID', 'Extracted audio codec must be pcm_s16le.');
    }

    if (document.audio.sampleRate !== 16_000) {
      pushError(errors, 'audio.sampleRate', 'AUDIO_SAMPLE_RATE_INVALID', 'Extracted audio sample rate must be 16000.');
    }

    if (document.audio.channels !== 1) {
      pushError(errors, 'audio.channels', 'AUDIO_CHANNELS_INVALID', 'Extracted audio must be mono.');
    }

    if (!isNonNegativeNumber(document.audio.sizeBytes)) {
      pushError(errors, 'audio.sizeBytes', 'AUDIO_SIZE_INVALID', 'Audio size must be a non-negative number.');
    }

    if (extractStatus === 'ok' && !isPositiveNumber(document.audio.sizeBytes)) {
      pushError(errors, 'audio.sizeBytes', 'AUDIO_SIZE_REQUIRED', 'Successful audio extraction must include non-empty audio.');
    }
  }

  const warnings = stringArrayAt(document.warnings);
  if (!Array.isArray(document.warnings) || warnings.length !== document.warnings.length) {
    pushError(errors, 'warnings', 'AUDIO_EXTRACT_WARNINGS_INVALID', 'Audio extract warnings must be an array of strings.');
  }

  if ((extractStatus === 'failed' || extractStatus === 'source-unavailable') && warnings.length === 0) {
    pushError(errors, 'warnings', 'AUDIO_EXTRACT_WARNING_REQUIRED', 'Failed audio extraction documents must explain the failure.');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateSilenceRangesDocument(document: unknown): ContractValidationResult {
  const errors: ContractValidationError[] = [];

  if (!isRecord(document)) {
    pushError(errors, 'document', 'SILENCE_RANGES_DOCUMENT_INVALID', 'Silence ranges document must be an object.');
    return {
      valid: false,
      errors,
    };
  }

  if (document.schemaId !== mediaContractSchemaIds.silenceRanges) {
    pushError(errors, 'schemaId', 'SCHEMA_ID_MISMATCH', 'Silence ranges document schemaId is invalid.');
  }

  if (document.silenceRangesVersion !== 1) {
    pushError(errors, 'silenceRangesVersion', 'SILENCE_RANGES_VERSION_UNSUPPORTED', 'Silence ranges version must be 1.');
  }

  validateRequiredString(errors, document, 'taskId');
  validateRequiredString(errors, document, 'audioArtifactId');
  validateRequiredString(errors, document, 'audioPath');
  validateRequiredString(errors, document, 'providerId');
  validateRequiredString(errors, document, 'adapterVersion');
  validateRequiredString(errors, document, 'createdAt');

  const detectionStatus = document.detectionStatus;
  if (detectionStatus !== 'ok' && detectionStatus !== 'failed' && detectionStatus !== 'audio-unavailable') {
    pushError(errors, 'detectionStatus', 'SILENCE_DETECTION_STATUS_INVALID', 'Detection status must be ok, failed, or audio-unavailable.');
  }

  if (!isRecord(document.parameters)) {
    pushError(errors, 'parameters', 'SILENCE_PARAMETERS_REQUIRED', 'Silence detection parameters are required.');
  } else {
    if (typeof document.parameters.noiseDb !== 'number' || !Number.isFinite(document.parameters.noiseDb)) {
      pushError(errors, 'parameters.noiseDb', 'SILENCE_NOISE_DB_INVALID', 'Silence noise threshold must be numeric.');
    }

    if (!isPositiveNumber(document.parameters.minDurationSeconds)) {
      pushError(errors, 'parameters.minDurationSeconds', 'SILENCE_MIN_DURATION_INVALID', 'Minimum silence duration must be positive.');
    }
  }

  if (!Array.isArray(document.ranges)) {
    pushError(errors, 'ranges', 'SILENCE_RANGES_REQUIRED', 'Silence ranges must be an array.');
  } else {
    document.ranges.forEach((range, index) => {
      if (!isRecord(range)) {
        pushError(errors, `ranges[${index}]`, 'SILENCE_RANGE_INVALID', 'Silence range must be an object.');
        return;
      }

      if (
        !isNonNegativeNumber(range.startMs) ||
        !isPositiveNumber(range.endMs) ||
        !isPositiveNumber(range.durationMs) ||
        range.endMs <= range.startMs
      ) {
        pushError(errors, `ranges[${index}]`, 'SILENCE_RANGE_INVALID', 'Silence range must have positive duration.');
      }
    });
  }

  const warnings = stringArrayAt(document.warnings);
  if (!Array.isArray(document.warnings) || warnings.length !== document.warnings.length) {
    pushError(errors, 'warnings', 'SILENCE_WARNINGS_INVALID', 'Silence warnings must be an array of strings.');
  }

  if ((detectionStatus === 'failed' || detectionStatus === 'audio-unavailable') && warnings.length === 0) {
    pushError(errors, 'warnings', 'SILENCE_WARNING_REQUIRED', 'Failed silence detection documents must explain the failure.');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateVadRangesDocument(document: unknown): ContractValidationResult {
  const errors: ContractValidationError[] = [];

  if (!isRecord(document)) {
    pushError(errors, 'document', 'VAD_RANGES_DOCUMENT_INVALID', 'VAD ranges document must be an object.');
    return {
      valid: false,
      errors,
    };
  }

  if (document.schemaId !== mediaContractSchemaIds.vadRanges) {
    pushError(errors, 'schemaId', 'SCHEMA_ID_MISMATCH', 'VAD ranges document schemaId is invalid.');
  }

  if (document.vadRangesVersion !== 1) {
    pushError(errors, 'vadRangesVersion', 'VAD_RANGES_VERSION_UNSUPPORTED', 'VAD ranges version must be 1.');
  }

  validateRequiredString(errors, document, 'taskId');
  validateRequiredString(errors, document, 'audioArtifactId');
  validateRequiredString(errors, document, 'audioPath');
  validateRequiredString(errors, document, 'providerId');
  validateRequiredString(errors, document, 'adapterVersion');
  validateRequiredString(errors, document, 'createdAt');

  const vadStatus = document.vadStatus;
  if (vadStatus !== 'ok' && vadStatus !== 'failed' && vadStatus !== 'unavailable' && vadStatus !== 'audio-unavailable') {
    pushError(errors, 'vadStatus', 'VAD_STATUS_INVALID', 'VAD status must be ok, failed, unavailable, or audio-unavailable.');
  }

  if (!isRecord(document.parameters)) {
    pushError(errors, 'parameters', 'VAD_PARAMETERS_REQUIRED', 'VAD parameters are required.');
  } else {
    if (document.parameters.sampleRate !== 16_000) {
      pushError(errors, 'parameters.sampleRate', 'VAD_SAMPLE_RATE_INVALID', 'VAD sample rate must be 16000.');
    }

    if (typeof document.parameters.threshold !== 'number' || document.parameters.threshold <= 0 || document.parameters.threshold >= 1) {
      pushError(errors, 'parameters.threshold', 'VAD_THRESHOLD_INVALID', 'VAD threshold must be between 0 and 1.');
    }

    if (!isPositiveNumber(document.parameters.minSpeechDurationMs)) {
      pushError(errors, 'parameters.minSpeechDurationMs', 'VAD_MIN_SPEECH_INVALID', 'Minimum speech duration must be positive.');
    }

    if (!isPositiveNumber(document.parameters.minSilenceDurationMs)) {
      pushError(errors, 'parameters.minSilenceDurationMs', 'VAD_MIN_SILENCE_INVALID', 'Minimum silence duration must be positive.');
    }
  }

  if (!Array.isArray(document.ranges)) {
    pushError(errors, 'ranges', 'VAD_RANGES_REQUIRED', 'VAD ranges must be an array.');
  } else {
    document.ranges.forEach((range, index) => {
      if (!isRecord(range)) {
        pushError(errors, `ranges[${index}]`, 'VAD_RANGE_INVALID', 'VAD range must be an object.');
        return;
      }

      if (
        !isNonNegativeNumber(range.startMs) ||
        !isPositiveNumber(range.endMs) ||
        range.endMs <= range.startMs ||
        typeof range.confidence !== 'number' ||
        range.confidence < 0 ||
        range.confidence > 1
      ) {
        pushError(errors, `ranges[${index}]`, 'VAD_RANGE_INVALID', 'VAD range must have positive duration and confidence between 0 and 1.');
      }
    });
  }

  const warnings = stringArrayAt(document.warnings);
  if (!Array.isArray(document.warnings) || warnings.length !== document.warnings.length) {
    pushError(errors, 'warnings', 'VAD_WARNINGS_INVALID', 'VAD warnings must be an array of strings.');
  }

  if ((vadStatus === 'failed' || vadStatus === 'unavailable' || vadStatus === 'audio-unavailable') && warnings.length === 0) {
    pushError(errors, 'warnings', 'VAD_WARNING_REQUIRED', 'Unavailable VAD documents must explain the reason.');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateTranscriptDocument(document: unknown): ContractValidationResult {
  const errors: ContractValidationError[] = [];

  if (!isRecord(document)) {
    pushError(errors, 'document', 'TRANSCRIPT_DOCUMENT_INVALID', 'Transcript document must be an object.');
    return {
      valid: false,
      errors,
    };
  }

  if (document.schemaId !== mediaContractSchemaIds.transcriptDocument) {
    pushError(errors, 'schemaId', 'SCHEMA_ID_MISMATCH', 'Transcript document schemaId is invalid.');
  }

  if (document.transcriptVersion !== 1) {
    pushError(errors, 'transcriptVersion', 'TRANSCRIPT_VERSION_UNSUPPORTED', 'Transcript version must be 1.');
  }

  validateRequiredString(errors, document, 'taskId');
  validateRequiredString(errors, document, 'audioArtifactId');
  validateRequiredString(errors, document, 'audioPath');
  validateRequiredString(errors, document, 'providerId');
  validateRequiredString(errors, document, 'adapterVersion');
  validateRequiredString(errors, document, 'language');
  validateRequiredString(errors, document, 'createdAt');

  const transcriptStatus = document.transcriptStatus;
  if (
    transcriptStatus !== 'ok' &&
    transcriptStatus !== 'failed' &&
    transcriptStatus !== 'provider-unavailable' &&
    transcriptStatus !== 'audio-unavailable'
  ) {
    pushError(
      errors,
      'transcriptStatus',
      'TRANSCRIPT_STATUS_INVALID',
      'Transcript status must be ok, failed, provider-unavailable, or audio-unavailable.',
    );
  }

  if (!Array.isArray(document.timestampGranularity) || document.timestampGranularity.length === 0) {
    pushError(errors, 'timestampGranularity', 'TIMESTAMP_GRANULARITY_REQUIRED', 'Timestamp granularity is required.');
  } else {
    document.timestampGranularity.forEach((granularity, index) => {
      if (granularity !== 'segment' && granularity !== 'word') {
        pushError(
          errors,
          `timestampGranularity[${index}]`,
          'TIMESTAMP_GRANULARITY_INVALID',
          'Timestamp granularity must be segment or word.',
        );
      }
    });
  }

  if (!isNonNegativeNumber(document.durationSeconds)) {
    pushError(errors, 'durationSeconds', 'TRANSCRIPT_DURATION_INVALID', 'Transcript duration must be a non-negative number.');
  }

  if (typeof document.text !== 'string') {
    pushError(errors, 'text', 'TRANSCRIPT_TEXT_INVALID', 'Transcript text must be a string.');
  }

  if (!Array.isArray(document.segments)) {
    pushError(errors, 'segments', 'TRANSCRIPT_SEGMENTS_REQUIRED', 'Transcript segments must be an array.');
  } else {
    document.segments.forEach((segment, index) => {
      if (!isRecord(segment)) {
        pushError(errors, `segments[${index}]`, 'TRANSCRIPT_SEGMENT_INVALID', 'Transcript segment must be an object.');
        return;
      }

      if (!isNonEmptyString(segment.segmentId)) {
        pushError(errors, `segments[${index}].segmentId`, 'TRANSCRIPT_SEGMENT_ID_REQUIRED', 'Transcript segment id is required.');
      }

      if (!isNonNegativeNumber(segment.startMs) || !isPositiveNumber(segment.endMs) || segment.endMs <= segment.startMs) {
        pushError(errors, `segments[${index}]`, 'TRANSCRIPT_SEGMENT_RANGE_INVALID', 'Transcript segment range must be positive.');
      }

      if (!isNonEmptyString(segment.text)) {
        pushError(errors, `segments[${index}].text`, 'TRANSCRIPT_SEGMENT_TEXT_REQUIRED', 'Transcript segment text is required.');
      }

      if (
        segment.confidence !== undefined &&
        (typeof segment.confidence !== 'number' || segment.confidence < 0 || segment.confidence > 1)
      ) {
        pushError(errors, `segments[${index}].confidence`, 'TRANSCRIPT_CONFIDENCE_INVALID', 'Transcript confidence must be between 0 and 1.');
      }
    });
  }

  const warnings = stringArrayAt(document.warnings);
  if (!Array.isArray(document.warnings) || warnings.length !== document.warnings.length) {
    pushError(errors, 'warnings', 'TRANSCRIPT_WARNINGS_INVALID', 'Transcript warnings must be an array of strings.');
  }

  if (
    (transcriptStatus === 'failed' || transcriptStatus === 'provider-unavailable' || transcriptStatus === 'audio-unavailable') &&
    warnings.length === 0
  ) {
    pushError(errors, 'warnings', 'TRANSCRIPT_WARNING_REQUIRED', 'Unavailable transcript documents must explain the reason.');
  }

  if (transcriptStatus !== 'ok' && Array.isArray(document.segments) && document.segments.length > 0) {
    pushError(errors, 'segments', 'TRANSCRIPT_UNAVAILABLE_SEGMENTS_FORBIDDEN', 'Unavailable transcript documents must not include segments.');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateSemanticAnalysisDocument(document: unknown): ContractValidationResult {
  const errors: ContractValidationError[] = [];

  if (!isRecord(document)) {
    pushError(errors, 'document', 'SEMANTIC_ANALYSIS_DOCUMENT_INVALID', 'Semantic analysis document must be an object.');
    return {
      valid: false,
      errors,
    };
  }

  if (document.schemaId !== mediaContractSchemaIds.semanticAnalysis) {
    pushError(errors, 'schemaId', 'SCHEMA_ID_MISMATCH', 'Semantic analysis document schemaId is invalid.');
  }

  if (document.semanticAnalysisVersion !== 1) {
    pushError(errors, 'semanticAnalysisVersion', 'SEMANTIC_VERSION_UNSUPPORTED', 'Semantic analysis version must be 1.');
  }

  validateRequiredString(errors, document, 'taskId');
  validateRequiredString(errors, document, 'transcriptArtifactId');
  validateRequiredString(errors, document, 'providerId');
  validateRequiredString(errors, document, 'adapterVersion');
  validateRequiredString(errors, document, 'model');
  validateRequiredString(errors, document, 'createdAt');

  const semanticStatus = document.semanticStatus;
  if (
    semanticStatus !== 'ok' &&
    semanticStatus !== 'failed' &&
    semanticStatus !== 'provider-unavailable' &&
    semanticStatus !== 'transcript-unavailable'
  ) {
    pushError(
      errors,
      'semanticStatus',
      'SEMANTIC_STATUS_INVALID',
      'Semantic status must be ok, failed, provider-unavailable, or transcript-unavailable.',
    );
  }

  if (typeof document.summary !== 'string') {
    pushError(errors, 'summary', 'SEMANTIC_SUMMARY_INVALID', 'Semantic summary must be a string.');
  }

  if (!Array.isArray(document.topics)) {
    pushError(errors, 'topics', 'SEMANTIC_TOPICS_REQUIRED', 'Semantic topics must be an array.');
  } else {
    document.topics.forEach((topic, index) => {
      if (!isRecord(topic)) {
        pushError(errors, `topics[${index}]`, 'SEMANTIC_TOPIC_INVALID', 'Semantic topic must be an object.');
        return;
      }

      if (!isNonEmptyString(topic.topicId)) {
        pushError(errors, `topics[${index}].topicId`, 'SEMANTIC_TOPIC_ID_REQUIRED', 'Semantic topic id is required.');
      }

      if (!isNonEmptyString(topic.label)) {
        pushError(errors, `topics[${index}].label`, 'SEMANTIC_TOPIC_LABEL_REQUIRED', 'Semantic topic label is required.');
      }

      if (typeof topic.score !== 'number' || topic.score < 0 || topic.score > 1) {
        pushError(errors, `topics[${index}].score`, 'SEMANTIC_TOPIC_SCORE_INVALID', 'Semantic topic score must be between 0 and 1.');
      }
    });
  }

  if (!Array.isArray(document.qaCandidates)) {
    pushError(errors, 'qaCandidates', 'QA_CANDIDATES_REQUIRED', 'QA candidates must be an array.');
  } else {
    document.qaCandidates.forEach((candidate, index) => {
      if (!isRecord(candidate)) {
        pushError(errors, `qaCandidates[${index}]`, 'QA_CANDIDATE_INVALID', 'QA candidate must be an object.');
        return;
      }

      if (!isNonEmptyString(candidate.qaId)) {
        pushError(errors, `qaCandidates[${index}].qaId`, 'QA_ID_REQUIRED', 'QA candidate id is required.');
      }

      if (!isNonEmptyString(candidate.question) || !isNonEmptyString(candidate.answer)) {
        pushError(errors, `qaCandidates[${index}]`, 'QA_TEXT_REQUIRED', 'QA question and answer are required.');
      }

      if (!isRecord(candidate.sourceRange)) {
        pushError(errors, `qaCandidates[${index}].sourceRange`, 'QA_SOURCE_RANGE_REQUIRED', 'QA source range is required.');
      } else if (
        !isNonNegativeNumber(candidate.sourceRange.startMs) ||
        !isPositiveNumber(candidate.sourceRange.endMs) ||
        candidate.sourceRange.endMs <= candidate.sourceRange.startMs
      ) {
        pushError(errors, `qaCandidates[${index}].sourceRange`, 'QA_SOURCE_RANGE_INVALID', 'QA source range must be positive.');
      }

      if (typeof candidate.score !== 'number' || candidate.score < 0 || candidate.score > 1) {
        pushError(errors, `qaCandidates[${index}].score`, 'QA_SCORE_INVALID', 'QA candidate score must be between 0 and 1.');
      }
    });
  }

  const warnings = stringArrayAt(document.warnings);
  if (!Array.isArray(document.warnings) || warnings.length !== document.warnings.length) {
    pushError(errors, 'warnings', 'SEMANTIC_WARNINGS_INVALID', 'Semantic warnings must be an array of strings.');
  }

  if (
    (semanticStatus === 'failed' || semanticStatus === 'provider-unavailable' || semanticStatus === 'transcript-unavailable') &&
    warnings.length === 0
  ) {
    pushError(errors, 'warnings', 'SEMANTIC_WARNING_REQUIRED', 'Unavailable semantic analysis documents must explain the reason.');
  }

  if (semanticStatus !== 'ok') {
    if (typeof document.summary === 'string' && document.summary.length > 0) {
      pushError(errors, 'summary', 'SEMANTIC_UNAVAILABLE_SUMMARY_FORBIDDEN', 'Unavailable semantic analysis must not include a summary.');
    }

    if (Array.isArray(document.topics) && document.topics.length > 0) {
      pushError(errors, 'topics', 'SEMANTIC_UNAVAILABLE_TOPICS_FORBIDDEN', 'Unavailable semantic analysis must not include topics.');
    }

    if (Array.isArray(document.qaCandidates) && document.qaCandidates.length > 0) {
      pushError(errors, 'qaCandidates', 'SEMANTIC_UNAVAILABLE_QA_FORBIDDEN', 'Unavailable semantic analysis must not include QA candidates.');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateVideoSplitPlan(plan: VideoSplitPlan): ContractValidationResult {
  const errors: ContractValidationError[] = [];
  const existingTrackKinds = new Set(plan.tracks.map((track) => track.kind));

  if (!isStandardOutputVideoSpec(plan.outputSpec)) {
    pushError(errors, 'outputSpec', 'OUTPUT_SPEC_INVALID', 'Output spec must be mp4, 30fps, and use positive 9:16 dimensions.');
  }

  if (!isRenderPreferences(plan.renderPreferences)) {
    pushError(
      errors,
      'renderPreferences.audio.bgm',
      'RENDER_ASSET_REFERENCE_INVALID',
      'Render asset preferences must use auto, disabled, or safe assets:// catalog references.',
    );
  }

  requiredTrackKinds.forEach((kind) => {
    if (!existingTrackKinds.has(kind)) {
      pushError(errors, 'tracks', 'TRACK_REQUIRED', `${kind} is required.`);
    }
  });

  plan.tracks.forEach((track, index) => {
    if (!track.providerId || !track.adapterVersion || !track.inputHash || !track.outputHash) {
      pushError(errors, `tracks[${index}]`, 'TRACK_PROVENANCE_REQUIRED', 'Track provenance is incomplete.');
    }
  });

  plan.segments.forEach((segment, index) => {
    if (segment.sourceRange.endMs <= segment.sourceRange.startMs) {
      pushError(errors, `segments[${index}].sourceRange`, 'INVALID_TIME_RANGE', 'Segment source range must have positive duration.');
    }

    const durationSeconds = rangeDurationSeconds(segment.outputRange);
    if (segment.type === 'single-speaker' && durationSeconds > 90) {
      pushError(errors, `segments[${index}].outputRange`, 'SINGLE_SPEAKER_DURATION_TOO_LONG', 'Single speaker output must not exceed 90 seconds.');
    }

    if (segment.type === 'long-interview' && (durationSeconds < 60 || durationSeconds > 180)) {
      pushError(
        errors,
        `segments[${index}].outputRange`,
        'LONG_INTERVIEW_DURATION_OUT_OF_RANGE',
        'Long interview output must be between 60 and 180 seconds.',
      );
    }
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateSubtitleDocument(subtitleDocument: SubtitleDocument): ContractValidationError[] {
  const errors: ContractValidationError[] = [];
  const sortedCues = [...subtitleDocument.cues].sort((left, right) => left.outputRange.startMs - right.outputRange.startMs);

  sortedCues.forEach((cue, index) => {
    if (cue.outputRange.endMs <= cue.outputRange.startMs) {
      pushError(errors, `cues[${index}].outputRange`, 'INVALID_TIME_RANGE', 'Subtitle cue output range must have positive duration.');
    }

    const previousCue = sortedCues[index - 1];
    if (previousCue && cue.outputRange.startMs < previousCue.outputRange.endMs) {
      pushError(
        errors,
        `cues[${index}].outputRange.startMs`,
        'SUBTITLE_CUE_OVERLAP',
        'Subtitle cues must not overlap on the output timeline.',
      );
    }
  });

  return errors;
}

export function validateRenderRequest(
  renderRequest: RenderRequest,
  plan: VideoSplitPlan,
  subtitleDocument: SubtitleDocument,
): ContractValidationResult {
  const errors: ContractValidationError[] = [];

  if (renderRequest.taskId !== plan.taskId) {
    pushError(errors, 'taskId', 'TASK_MISMATCH', 'Render request must target the same task as the split plan.');
  }

  if (renderRequest.planId !== plan.planId) {
    pushError(errors, 'planId', 'PLAN_ID_MISMATCH', 'Render request must target the selected split plan.');
  }

  if (renderRequest.planRevision !== plan.planRevision) {
    pushError(errors, 'planRevision', 'PLAN_REVISION_MISMATCH', 'Render request must bind the current immutable plan revision.');
  }

  if (renderRequest.subtitleId !== subtitleDocument.subtitleId) {
    pushError(errors, 'subtitleId', 'SUBTITLE_MISMATCH', 'Render request must target the selected subtitle document.');
  }

  validateSubtitleDocument(subtitleDocument).forEach((error) => errors.push(error));

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function parseRenderAttemptManifest(raw: string): RenderAttemptManifest | undefined {
  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch {
    return undefined;
  }

  if (!isRecord(document) || document.schemaId !== mediaContractSchemaIds.renderAttemptManifest) {
    return undefined;
  }

  if (
    document.renderAttemptVersion !== 1 ||
    !isNonEmptyString(document.taskId) ||
    !isNonEmptyString(document.renderId) ||
    !isNonEmptyString(document.planId) ||
    typeof document.planRevision !== 'number' ||
    !isNonEmptyString(document.sourceArtifactId) ||
    !isNonEmptyString(document.outputArtifactId) ||
    !isNonEmptyString(document.subtitleArtifactId) ||
    !isNonEmptyString(document.coverArtifactId) ||
    !isNonEmptyString(document.logArtifactId) ||
    typeof document.subtitleBurnIn !== 'boolean' ||
    !isNonNegativeNumber(document.subtitleCueCount) ||
    !isRecord(document.sourceRange) ||
    !isRecord(document.outputSpec) ||
    !isRecord(document.renderGraph) ||
    !Array.isArray(document.warnings) ||
    !isNonEmptyString(document.createdAt)
  ) {
    return undefined;
  }

  if (
    !isNonNegativeNumber(document.sourceRange.startMs) ||
    !isPositiveNumber(document.sourceRange.endMs) ||
    document.sourceRange.endMs <= document.sourceRange.startMs
  ) {
    return undefined;
  }

  if (!isStandardOutputVideoSpec(document.outputSpec)) {
    return undefined;
  }

  if (
    document.renderGraph.engine !== 'ffmpeg' ||
    document.renderGraph.adapterVersion !== 'ffmpeg-media-render.adapter.v1' ||
    (document.renderGraph.videoFilterPreset !== 'standard-vertical-scale-crop-fps.v1' &&
      document.renderGraph.videoFilterPreset !== 'standard-vertical-scale-crop-fps-ass-burn-in.v1') ||
    document.renderGraph.audioFilterPreset !== 'voice-basic-loudnorm-afftdn.v1' ||
    !isRecord(document.renderGraph.voiceEnhancement) ||
    !isVoiceEnhancementStatus(document.renderGraph.voiceEnhancement.status) ||
    !isStandardVoiceFilterList(document.renderGraph.voiceEnhancement.filters, document.renderGraph.voiceEnhancement.status) ||
    !isRecord(document.renderGraph.bgm) ||
    !isAudioAssetMixStatus(document.renderGraph.bgm.status) ||
    !isConsistentMixStatus(document.renderGraph.bgm.status, document.renderGraph.bgm.mixed) ||
    document.renderGraph.bgm.volumePercent !== 20 ||
    !isConsistentAudioAssetSlot(document.renderGraph.bgm, 'bgm') ||
    !isRecord(document.renderGraph.sfx) ||
    !isAudioAssetMixStatus(document.renderGraph.sfx.status) ||
    !isConsistentMixStatus(document.renderGraph.sfx.status, document.renderGraph.sfx.mixed) ||
    !isConsistentAudioAssetSlot(document.renderGraph.sfx, 'sfx') ||
    !isRecord(document.renderGraph.codec) ||
    document.renderGraph.codec.video !== 'libx264' ||
    document.renderGraph.codec.audio !== 'aac'
  ) {
    return undefined;
  }

  if (document.warnings.some((warning) => typeof warning !== 'string')) {
    return undefined;
  }

  return document as unknown as RenderAttemptManifest;
}
