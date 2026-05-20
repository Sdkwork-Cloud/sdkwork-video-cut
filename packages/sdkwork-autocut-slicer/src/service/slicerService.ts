import { createAutoCutTrustedLocalFile, resolveAutoCutTrustedSourcePath } from '@sdkwork/autocut-commons';
import {
  AUTOCUT_DEFAULT_SPEECH_TRANSCRIPTION_WORKFLOW_PRESET_ID,
  AUTOCUT_DEFAULT_SMART_SLICE_SEGMENTATION_AGENT_ID,
  AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER,
  getAutoCutSmartSliceSegmentationAgentDefinition,
  AUTOCUT_TASK_STATUS,
  AUTOCUT_TASK_TYPE,
  AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_PHASE,
  AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD,
  type AppAsset,
  type AppTask,
  type AutoCutSliceDuplicateGroup,
  type AutoCutSliceManualEdit,
  type AutoCutSliceRenderSelection,
  type AutoCutSliceReviewSegment,
  type AutoCutSliceReviewSession,
  type AutoCutSmartSliceSegmentationAgentId,
  type AutoCutTaskExecutionCheckpoint,
  type AutoCutTaskExecutionLog,
  type AutoCutTaskExecutionLogSeverity,
  type AutoCutTaskExecutionStep,
  type AutoCutTaskExecutionStepStatus,
  type AutoCutTranscriptSegment,
  type AutoCutSpeechTranscriptionModelDownloadProgressEvent,
  type TaskSliceResult,
  type VideoDedupParams,
  type VideoDedupReport,
  type VideoDuplicateMatch,
  type StudioClipProcessingOperation,
  type VideoSliceParams,
} from '@sdkwork/autocut-types';
import {
  addAsset,
  addMessage,
  addTask,
  analyzeAutoCutVideoDedup,
  assertAutoCutNativeArtifactInsideTaskOutputDir,
  assertAutoCutNativeVideoCoverInsideTaskCoverDir,
  createDefaultAutoCutVideoDedupParams,
  createAutoCutOpenAiCompatibleChatCompletion,
  createAutoCutId,
  createAutoCutTaskId,
  createAutoCutTaskName,
  createAutoCutRelativeTimestampMs,
  createAutoCutTimestamp,
  getAutoCutNativeHostClient,
  getTasks,
  isAutoCutTaskCancellationRequested,
  listenAutoCutEvent,
  registerAutoCutTaskCancelHandler,
  registerAutoCutTaskResumeHandler,
  resolveAutoCutOutputRootDir,
  resolveAutoCutLlmRuntimeConfig,
  resolveAutoCutSpeechTranscriptionRuntimeConfig,
  transcribeAutoCutMediaWithConfiguredProvider,
  AutoCutProcessingTaskError,
  failAutoCutProcessingTask,
  getAutoCutTimestampMs,
  isAutoCutProcessingTaskCanceledError,
  reportAutoCutDiagnostic,
  clearAutoCutTaskCancellationRequest,
  updateTask,
  validateAutoCutProcessingSource,
  normalizeAutoCutNativePathForContainment,
  type AutoCutSpeechTranscriptionSegment,
  type AutoCutVideoSliceRenderProfile,
  type AutoCutVideoSliceClipRequest,
  type AutoCutVideoSliceRequest,
  type AutoCutVideoSliceArtifactResult,
} from '@sdkwork/autocut-services';
import {
  SMART_CUT_STANDARD_VERSION,
  type SmartCutProductPresetId,
  type SmartCutSpeakerEvidence,
  type SmartCutTranscriptEvidence,
} from '@sdkwork/autocut-smart-cut-engine';
import {
  buildTranscriptSliceCandidates,
  createSmartSliceAudioActivitySourceSegments,
  createDeterministicSlicePlan,
  createTranscriptAssistedSlicePlan,
  createSmartSliceSpeechSourceSegments,
  createSmartSliceTranscriptAudioMuteRanges,
  getEligibleSmartSliceTranscriptCoverageSegments,
  getVideoSlicePlanningPolicy,
  isEligibleSmartSliceTranscriptCoverageText,
  normalizeSmartSliceTranscriptEvidenceText,
  normalizeSmartSliceTranscriptSegmentsForPlanning,
  normalizeCandidateSlicePlanForCoverageRepair,
  normalizeSmartSlicePlanRenderedTimelineForNativeRender,
  repairSmartSliceClipTimingForNativeRender,
  refineSmartSlicePlanWithAudioActivityBoundaries,
  repairReleasePlanSpeechCoverage,
  SMART_SLICE_AUDIO_CLEANUP_PROFILE,
  SMART_SLICE_RAW_AUDIO_ACTIVITY_ANALYSIS_FILTER,
  normalizeSliceDurationMs,
  validateVideoSliceParams,
  type VideoSlicePlanningPolicy,
  type NormalizedSlicePlanClip,
} from './slicePlanner';
import {
  createSmartCutEngineLlmReview,
  createSmartCutEngineSlicePlan,
  SmartCutEngineSlicePlanningError,
  type SmartCutEngineSlicePlanResult,
  type SmartCutEngineLlmReviewCreator,
} from './smartCutEnginePlanner';
import { createStudioClipTimelineSnapshotForReviewSession } from './clipWorkflow';

const {
  maxLeadingSilenceMs: MAX_SMART_SLICE_LEADING_SILENCE_MS,
  maxTrailingSilenceMs: MAX_SMART_SLICE_TRAILING_SILENCE_MS,
  minTranscriptCoverageScore: MIN_SMART_SLICE_TRANSCRIPT_COVERAGE_SCORE,
  acceptedSpeechContinuityGrades: SMART_SLICE_ACCEPTED_SPEECH_CONTINUITY_GRADES,
  fallbackNoiseReductionApplied: SMART_SLICE_FALLBACK_NOISE_REDUCTION_APPLIED,
  minAudioActivityConfidence: MIN_SMART_SLICE_AUDIO_ACTIVITY_CONFIDENCE,
  requiredAudioActivityAnalysisFilter: SMART_SLICE_REQUIRED_AUDIO_ACTIVITY_ANALYSIS_FILTER,
  maxAudioTranscriptBoundaryDisagreementMs: MAX_SMART_SLICE_TRANSCRIPT_SOURCE_TAIL_REPAIR_MS,
} = AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD;
const SMART_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS = 80;
const MAX_SMART_SLICE_NATIVE_SOURCE_SEGMENTS = 80;
const MIN_SMART_SLICE_TRUSTED_AUDIO_SOURCE_SEGMENT_RETAINED_RATIO = 0.35;
const MAX_SMART_SLICE_TRANSCRIPT_OVERLAP_REPAIR_MS = 250;
const SMART_SLICE_TRANSCRIPT_SECONDS_UNIT_MIN_SOURCE_DURATION_MS = 30_000;
const SMART_SLICE_TRANSCRIPT_SECONDS_UNIT_MAX_TIMELINE_MS = 600;
const SMART_SLICE_TRANSCRIPT_SECONDS_UNIT_MAX_SEGMENT_DURATION_MS = 120;
const SMART_SLICE_TRANSCRIPT_SECONDS_UNIT_MIN_SEGMENTS = 2;
const SMART_SLICE_TRANSCRIPT_SECONDS_UNIT_MIN_SCALED_SEGMENT_DURATION_MS = 1_000;
const SMART_SLICE_TRANSCRIPT_SECONDS_UNIT_MIN_UNKNOWN_DURATION_EVIDENCE_UNITS = 5;
const SMART_SLICE_TRANSCRIPT_SECONDS_UNIT_MIN_UNKNOWN_DURATION_TEXT_UNITS_PER_SECOND = 80;
const SMART_SLICE_TRANSCRIPT_SECONDS_UNIT_MIN_UNKNOWN_DURATION_SEGMENT_TEXT_UNITS = 8;
const SMART_SLICE_TRANSCRIPT_SECONDS_UNIT_MIN_UNKNOWN_DURATION_RICH_SEGMENTS = 2;
const SMART_SLICE_PLANNING_DIAGNOSTIC_SAMPLE_LIMIT = 6;
const SMART_SLICE_PLANNING_DIAGNOSTIC_TEXT_PREVIEW_LENGTH = 80;
const SMART_SLICE_LONG_RUNNING_PROGRESS_MILESTONE_PERCENT = 5;
const SMART_SLICE_LONG_SOURCE_SINGLE_SHORT_TARGET_CANDIDATE_COUNT = 5;
const SMART_SLICE_LONG_SOURCE_TARGET_THRESHOLD_MS = 10 * 60 * 1000;
const SMART_SLICE_LLM_REVIEW_MAX_TOKENS = 4096;
const SMART_SLICE_DEDUP_REVIEW_RISK_CODE = 'smart-dedup-review';
const SMART_SLICE_DEDUP_MIN_SEGMENT_OVERLAP_MS = 500;
const SMART_SLICE_DEDUP_MIN_SEGMENT_OVERLAP_RATIO = 0.08;

type SmartSliceTaskEvidenceWriteResult = Awaited<
  ReturnType<ReturnType<typeof getAutoCutNativeHostClient>['writeTaskEvidenceJson']>
>;
type SmartSliceCheckpointEvidenceWriteResult =
  SmartSliceTaskEvidenceWriteResult | SmartSliceBestEffortEvidenceWriteResult;

interface SmartSlicePlanningDiagnostics {
  reason: string;
  sourceAssetUuid?: string;
  sourceDurationMs?: number;
  params: {
    mode: VideoSliceParams['mode'];
    llmModel: VideoSliceParams['llmModel'];
    minDuration: number;
    maxDuration: number;
    idealDuration?: number;
    minDurationMs: number;
    maxDurationMs: number;
    idealDurationMs: number;
    targetPlatform: NonNullable<VideoSlicePlanningPolicy['targetPlatform']>;
    targetAspectRatio: NonNullable<VideoSlicePlanningPolicy['targetAspectRatio']>;
    videoObjectFit: NonNullable<VideoSlicePlanningPolicy['videoObjectFit']>;
    continuityLevel: NonNullable<VideoSlicePlanningPolicy['continuityLevel']>;
    segmentationDensity: NonNullable<VideoSlicePlanningPolicy['segmentationDensity']>;
    continuityJoinGapMs: number;
    candidateJoinGapMs: number;
    continuityOverlapToleranceMs: number;
    segmentationAgentId: VideoSliceParams['segmentationAgentId'];
    baseAlgorithm: VideoSliceParams['baseAlgorithm'];
    highlightEngine: VideoSliceParams['highlightEngine'];
    customKeywordCount: number;
    enableNoiseReduction: boolean;
    enableCoughFilter: boolean;
    enableRepeatFilter: boolean;
    enableSubtitles: boolean;
    subtitleMode?: VideoSliceParams['subtitleMode'];
    subtitleStyleId?: string;
    hasFile: boolean;
    hasFileId: boolean;
    hasUrl: boolean;
  };
  transcript: {
    transcriptSegmentCount: number;
    normalizedPlanningSegmentCount: number;
    realContentSegmentCount: number;
    lowInformationSegmentCount: number;
    invalidTimingSegmentCount: number;
    transcriptStartMs?: number;
    transcriptEndMs?: number;
    minStartMs?: number;
    maxEndMs?: number;
    longestSegmentDurationMs: number;
    shortestSegmentDurationMs: number;
    totalSpeechDurationMs: number;
    averageSegmentDurationMs: number;
    sampleSegments: Array<{
      index: number;
      startMs?: number;
      endMs?: number;
      durationMs?: number;
      textLength: number;
      normalizedTextLength: number;
      textPreview: string;
      speaker?: string;
    }>;
  };
  planning: {
    plannedClipCount: number;
    engineClipSample: Array<{
      candidateId?: string;
      planningEngine?: NormalizedSlicePlanClip['planningEngine'];
      smartCutPresetId?: string;
      contentUnitIds?: string[];
      speakerIds?: string[];
      speakerRoles?: string[];
      startMs: number;
      endMs?: number;
      durationMs: number;
      transcriptSegmentCount?: number;
      transcriptCoverageScore?: number;
      speechContinuityGrade?: NormalizedSlicePlanClip['speechContinuityGrade'];
      publishabilityGrade?: NormalizedSlicePlanClip['publishabilityGrade'];
      platformReadinessGrade?: NormalizedSlicePlanClip['platformReadinessGrade'];
      risks?: string[];
    }>;
  };
}

interface SmartSliceAudioCleanupAttemptResult {
  audioActivityResult: SmartSliceAudioActivityAnalysisResult;
  refinedClips: NormalizedSlicePlanClip[];
  noiseReductionApplied: boolean;
}

interface SmartSliceBestEffortEvidenceWriteResult {
  skipped?: boolean;
  reason?: string;
  taskUuid?: string;
  taskOutputDir?: string;
  artifactPath?: string;
  relativePath?: string;
  byteSize?: number;
  contentSha256?: string;
}

class SmartSlicePlanningError extends Error {
  readonly diagnostics: SmartSlicePlanningDiagnostics;

  constructor(message: string, diagnostics: SmartSlicePlanningDiagnostics) {
    super(`${message} ${formatSmartSlicePlanningDiagnosticsSummary(diagnostics)}`);
    this.name = 'SmartSlicePlanningError';
    this.diagnostics = diagnostics;
  }
}

type SmartSliceExecutionStepId =
  | 'prepare-source'
  | 'speech-to-text'
  | 'plan-clips'
  | 'analyze-audio-boundaries'
  | 'analyze-duplicates'
  | 'human-review'
  | 'native-render'
  | 'verify-artifacts'
  | 'persist-results';

const SMART_SLICE_WORKFLOW_ID = 'smart-slice';
const SMART_SLICE_CHECKPOINT_VERSION = 3;

interface SmartSliceExecutionStep {
  id: SmartSliceExecutionStepId;
  label: string;
  progressBefore: number;
  progressAfter: number;
  progressMessage: string;
}

interface SmartSliceCheckpointSource {
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
}

interface SmartSliceCheckpointParams {
  mode: VideoSliceParams['mode'];
  fileId?: string;
  url?: string;
  llmModel: VideoSliceParams['llmModel'];
  targetPlatform?: VideoSliceParams['targetPlatform'];
  targetAspectRatio?: VideoSliceParams['targetAspectRatio'];
  videoObjectFit?: VideoSliceParams['videoObjectFit'];
  idealDuration?: number;
  sourceDurationMs?: number;
  continuityLevel?: VideoSliceParams['continuityLevel'];
  segmentationDensity?: VideoSliceParams['segmentationDensity'];
  sttPresetId?: string;
  segmentationAgentId: VideoSliceParams['segmentationAgentId'];
  customKeywords?: string[];
  minDuration: number;
  maxDuration: number;
  baseAlgorithm: VideoSliceParams['baseAlgorithm'];
  highlightEngine: VideoSliceParams['highlightEngine'];
  enableNoiseReduction?: boolean;
  enableCoughFilter: boolean;
  enableRepeatFilter: boolean;
  enableSmartDedup?: boolean;
  videoDedupParams?: VideoDedupParams;
  enableSubtitles?: boolean;
  subtitleMode?: VideoSliceParams['subtitleMode'];
  subtitleStyleId?: string;
}

interface SmartSliceCheckpointArtifacts {
  'prepare-source'?: {
    sourceMedia: SmartSlicePreparedSourceMedia;
    outputRootDir?: string;
    desktopSourcePath?: string;
    selectedNativeAssetUuid?: string;
  };
  'speech-to-text'?: {
    transcriptSegments: AutoCutSpeechTranscriptionSegment[];
      speechToTextEvidence?: SmartSliceCheckpointEvidenceWriteResult;
      normalizedTranscriptEvidence?: SmartSliceCheckpointEvidenceWriteResult;
  };
  'plan-clips'?: {
    plannedClips: NormalizedSlicePlanClip[];
    semanticSegmentationEvidence?: SmartSliceCheckpointEvidenceWriteResult;
  };
  'human-review'?: {
    reviewSession: AutoCutSliceReviewSession;
    approvedClips?: NormalizedSlicePlanClip[];
    reviewSessionEvidence?: SmartSliceCheckpointEvidenceWriteResult;
    manualEditsEvidence?: SmartSliceCheckpointEvidenceWriteResult;
    reviewEventsEvidence?: SmartSliceCheckpointEvidenceWriteResult;
    renderSelectionEvidence?: SmartSliceCheckpointEvidenceWriteResult;
  };
  'analyze-audio-boundaries'?: {
    refinedPlannedClips: NormalizedSlicePlanClip[];
    noiseReductionApplied: boolean;
  };
  'analyze-duplicates'?: {
    enabled: boolean;
    smartDedupReport?: VideoDedupReport;
    duplicateGroups: AutoCutSliceDuplicateGroup[];
    matchedSegmentIds: string[];
  };
  'native-render'?: {
    nativeResult: Awaited<ReturnType<ReturnType<typeof getAutoCutNativeHostClient>['sliceVideo']>>;
    nativeClips: AutoCutVideoSliceClipRequest[];
    subtitleRequest: VideoSliceSubtitleRequestProjection;
    appliedSmartSliceNoiseReduction: boolean;
  };
  'verify-artifacts'?: {
    sliceResults: TaskSliceResult[];
    renderArtifactManifestEvidence?: SmartSliceCheckpointEvidenceWriteResult;
  };
  'persist-results'?: {
    completedData: Pick<AppTask, 'resultCount' | 'generatedAssetIds' | 'sliceResults'>;
  };
}

interface SmartSliceExecutionContext {
  task: AppTask;
  params: VideoSliceParams;
  checkpoint: AutoCutTaskExecutionCheckpoint;
  currentStepId?: SmartSliceExecutionStepId;
  resumeFromStepId?: SmartSliceExecutionStepId;
  reviewMode?: 'auto-render' | 'review-before-render';
  renderSelection?: AutoCutSliceRenderSelection;
}

interface SmartSlicePreparedSourceMedia {
  assetUuid: string;
  sandboxPath?: string;
  byteSize?: number;
  name?: string;
  mediaType?: string;
  mimeType?: string;
  hasAudioStream?: boolean;
  hasVideoStream?: boolean;
  durationMs?: number;
}

interface SmartSliceDedupAnalysis {
  enabled: boolean;
  smartDedupReport?: VideoDedupReport;
  duplicateGroups: AutoCutSliceDuplicateGroup[];
  matchedSegmentIds: string[];
}

const SMART_SLICE_EXECUTION_STEPS: readonly SmartSliceExecutionStep[] = [
  {
    id: 'prepare-source',
    label: 'Prepare native source media',
    progressBefore: 15,
    progressAfter: 45,
    progressMessage: 'Preparing native Smart Slice source...',
  },
  {
    id: 'speech-to-text',
    label: 'Transcribe source speech',
    progressBefore: 50,
    progressAfter: 55,
    progressMessage: 'Running local speech-to-text for Smart Slice...',
  },
  {
    id: 'plan-clips',
    label: 'Plan publishable clips',
    progressBefore: 60,
    progressAfter: 65,
    progressMessage: 'Planning transcript-assisted highlight clips...',
  },
  {
    id: 'analyze-audio-boundaries',
    label: 'Analyze speech boundaries',
    progressBefore: 66,
    progressAfter: 69,
    progressMessage: 'Analyzing speech boundaries...',
  },
  {
    id: 'analyze-duplicates',
    label: 'Analyze duplicate content',
    progressBefore: 69,
    progressAfter: 70,
    progressMessage: 'Checking Smart Slice duplicate risk...',
  },
  {
    id: 'human-review',
    label: 'Human review approval',
    progressBefore: 70,
    progressAfter: 70,
    progressMessage: 'Waiting for segment review approval...',
  },
  {
    id: 'native-render',
    label: 'Render clips with native FFmpeg',
    progressBefore: 70,
    progressAfter: 88,
    progressMessage: 'Rendering video slices with native FFmpeg...',
  },
  {
    id: 'verify-artifacts',
    label: 'Verify generated artifacts',
    progressBefore: 90,
    progressAfter: 94,
    progressMessage: 'Verifying generated slice artifacts...',
  },
  {
    id: 'persist-results',
    label: 'Persist task results',
    progressBefore: 96,
    progressAfter: 99,
    progressMessage: 'Saving generated slice results...',
  },
];

const SMART_SLICE_EXECUTION_STEP_BY_ID = new Map(
  SMART_SLICE_EXECUTION_STEPS.map((step) => [step.id, step]),
);

function shouldAllowSmartSliceNoiseReduction(params: Pick<VideoSliceParams, 'enableNoiseReduction'>) {
  return params.enableNoiseReduction !== false;
}

function isSmartSliceTaskEvidenceWriteReady(
  capabilities: Awaited<ReturnType<ReturnType<typeof getAutoCutNativeHostClient>['getCapabilities']>>,
) {
  return capabilities.taskEvidenceWriteCommandReady === true &&
    capabilities.supportedCommands?.includes('autocut_write_task_evidence_json') === true;
}

function shouldStartSmartSliceWithNoiseReduction(_params: Pick<VideoSliceParams, 'enableNoiseReduction'>) {
  // Raw-first preserves clean source audio. Denoise is used only as a fallback when raw boundary evidence is unusable.
  return false;
}

function resolveSmartSliceSegmentationAgentId(
  agentId: unknown,
): AutoCutSmartSliceSegmentationAgentId {
  return getAutoCutSmartSliceSegmentationAgentDefinition(
    agentId ?? AUTOCUT_DEFAULT_SMART_SLICE_SEGMENTATION_AGENT_ID,
  ).id;
}

async function resolveSmartSliceExecutionParams(params: VideoSliceParams): Promise<VideoSliceParams> {
  const sttPresetId = await resolveSmartSliceSttPresetId(params.sttPresetId);
  if (params.segmentationAgentId) {
    return {
      ...params,
      segmentationAgentId: resolveSmartSliceSegmentationAgentId(params.segmentationAgentId),
      segmentationDensity: params.segmentationDensity ?? 'default',
      sttPresetId,
    };
  }

  try {
    const runtime = await resolveAutoCutLlmRuntimeConfig();
    return {
      ...params,
      segmentationAgentId: resolveSmartSliceSegmentationAgentId(runtime.defaultSegmentationAgentId),
      segmentationDensity: params.segmentationDensity ?? 'default',
      sttPresetId,
    };
  } catch {
    return {
      ...params,
      segmentationAgentId: AUTOCUT_DEFAULT_SMART_SLICE_SEGMENTATION_AGENT_ID,
      segmentationDensity: params.segmentationDensity ?? 'default',
      sttPresetId,
    };
  }
}

async function resolveSmartSliceSttPresetId(requestedPresetId?: string) {
  if (requestedPresetId) {
    return requestedPresetId;
  }

  if (AUTOCUT_DEFAULT_SPEECH_TRANSCRIPTION_WORKFLOW_PRESET_ID !== 'smart-slice-cloud-stt') {
    return AUTOCUT_DEFAULT_SPEECH_TRANSCRIPTION_WORKFLOW_PRESET_ID;
  }

  try {
    const llmRuntime = await resolveAutoCutLlmRuntimeConfig();
    if (llmRuntime.modelVendor === 'openai' && llmRuntime.apiKeyConfigured) {
      return AUTOCUT_DEFAULT_SPEECH_TRANSCRIPTION_WORKFLOW_PRESET_ID;
    }
    const speechRuntime = await resolveAutoCutSpeechTranscriptionRuntimeConfig();
    if (
      speechRuntime.lastProbeReady === true ||
      Boolean(speechRuntime.executablePath?.trim()) ||
      Boolean(speechRuntime.modelPath?.trim())
    ) {
      return 'smart-slice-balanced-local';
    }
    const capabilities = await getAutoCutNativeHostClient().getCapabilities();
    if (
      capabilities.speechTranscriptionCommandReady === true &&
      capabilities.speechTranscriptionProbeCommandReady === true &&
      capabilities.speechTranscriptionToolchainReady === true
    ) {
      return 'smart-slice-balanced-local';
    }
  } catch (error) {
    reportVideoSliceStageDiagnostic('default cloud STT fallback inspection failed', {
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }

  return AUTOCUT_DEFAULT_SPEECH_TRANSCRIPTION_WORKFLOW_PRESET_ID;
}

function getSmartSliceRequiredAudioActivityAnalysisFilter(noiseReductionApplied: boolean) {
  return noiseReductionApplied
    ? SMART_SLICE_REQUIRED_AUDIO_ACTIVITY_ANALYSIS_FILTER
    : SMART_SLICE_RAW_AUDIO_ACTIVITY_ANALYSIS_FILTER;
}

function createSmartSliceAudioBoundaryAnalysisRequirementLabel(noiseReductionApplied: boolean) {
  void noiseReductionApplied;
  return 'audio boundary analysis';
}

function getVideoSliceSourceName(params: VideoSliceParams) {
  if (params.file) {
    return params.file.name;
  }

  if (params.url) {
    try {
      return new URL(params.url).hostname || params.url;
    } catch {
      return params.url;
    }
  }

  if (params.fileId?.trim()) {
    return params.fileId.trim();
  }

  return 'video-slice-source.mp4';
}

function createVideoSliceTask(params: VideoSliceParams): AppTask {
  const createdAt = createAutoCutTimestamp();
  return {
    id: createAutoCutTaskId('slice'),
    name: createAutoCutTaskName({
      file: params.file,
      url: params.url,
      fallbackSourceName: getVideoSliceSourceName(params),
      createdAt,
    }),
    type: AUTOCUT_TASK_TYPE.videoSlice,
    status: AUTOCUT_TASK_STATUS.pending,
    progress: 0,
    progressMessage: '任务排队中...',
    createdAt,
    ...(params.fileId ? { sourceFileId: params.fileId } : {}),
  };
}

function getSmartSlicePlanningSourceAssetUuid(params: VideoSliceParams) {
  const sourceAssetUuid = (params as VideoSliceParams & { sourceAssetUuid?: unknown }).sourceAssetUuid;
  return typeof sourceAssetUuid === 'string' && sourceAssetUuid.trim()
    ? sourceAssetUuid.trim()
    : undefined;
}

function formatSmartSlicePlanningDiagnosticValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.round(value));
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  return 'missing';
}

function formatSmartSlicePlanningDiagnosticsSummary(diagnostics: SmartSlicePlanningDiagnostics) {
  return [
    'Runtime params:',
    `sourceAssetUuid=${formatSmartSlicePlanningDiagnosticValue(diagnostics.sourceAssetUuid)}`,
    `sourceDurationMs=${formatSmartSlicePlanningDiagnosticValue(diagnostics.sourceDurationMs)}`,
    `minDurationMs=${formatSmartSlicePlanningDiagnosticValue(diagnostics.params.minDurationMs)}`,
    `maxDurationMs=${formatSmartSlicePlanningDiagnosticValue(diagnostics.params.maxDurationMs)}`,
    `idealDurationMs=${formatSmartSlicePlanningDiagnosticValue(diagnostics.params.idealDurationMs)}`,
    `targetPlatform=${formatSmartSlicePlanningDiagnosticValue(diagnostics.params.targetPlatform)}`,
    `targetAspectRatio=${formatSmartSlicePlanningDiagnosticValue(diagnostics.params.targetAspectRatio)}`,
    `videoObjectFit=${formatSmartSlicePlanningDiagnosticValue(diagnostics.params.videoObjectFit)}`,
    `continuityLevel=${formatSmartSlicePlanningDiagnosticValue(diagnostics.params.continuityLevel)}`,
    `segmentationDensity=${formatSmartSlicePlanningDiagnosticValue(diagnostics.params.segmentationDensity)}`,
    `continuityJoinGapMs=${formatSmartSlicePlanningDiagnosticValue(diagnostics.params.continuityJoinGapMs)}`,
    `candidateJoinGapMs=${formatSmartSlicePlanningDiagnosticValue(diagnostics.params.candidateJoinGapMs)}`,
    `segmentationAgentId=${formatSmartSlicePlanningDiagnosticValue(diagnostics.params.segmentationAgentId)}`,
    `baseAlgorithm=${formatSmartSlicePlanningDiagnosticValue(diagnostics.params.baseAlgorithm)}`,
    `highlightEngine=${formatSmartSlicePlanningDiagnosticValue(diagnostics.params.highlightEngine)}`,
    `enableNoiseReduction=${formatSmartSlicePlanningDiagnosticValue(diagnostics.params.enableNoiseReduction)}`,
    `enableCoughFilter=${formatSmartSlicePlanningDiagnosticValue(diagnostics.params.enableCoughFilter)}`,
    `enableRepeatFilter=${formatSmartSlicePlanningDiagnosticValue(diagnostics.params.enableRepeatFilter)}`,
    `enableSubtitles=${formatSmartSlicePlanningDiagnosticValue(diagnostics.params.enableSubtitles)}`,
    `transcriptSegmentCount=${formatSmartSlicePlanningDiagnosticValue(diagnostics.transcript.transcriptSegmentCount)}`,
    `normalizedPlanningSegmentCount=${formatSmartSlicePlanningDiagnosticValue(diagnostics.transcript.normalizedPlanningSegmentCount)}`,
    `realContentSegmentCount=${formatSmartSlicePlanningDiagnosticValue(diagnostics.transcript.realContentSegmentCount)}`,
    `transcriptStartMs=${formatSmartSlicePlanningDiagnosticValue(diagnostics.transcript.transcriptStartMs)}`,
    `transcriptEndMs=${formatSmartSlicePlanningDiagnosticValue(diagnostics.transcript.transcriptEndMs)}`,
    `longestSegmentDurationMs=${formatSmartSlicePlanningDiagnosticValue(diagnostics.transcript.longestSegmentDurationMs)}`,
    `totalSpeechDurationMs=${formatSmartSlicePlanningDiagnosticValue(diagnostics.transcript.totalSpeechDurationMs)}`,
    `plannedClipCount=${formatSmartSlicePlanningDiagnosticValue(diagnostics.planning.plannedClipCount)}`,
    `transcriptCandidateCount=${formatSmartSlicePlanningDiagnosticValue(diagnostics.planning.plannedClipCount)}`,
    `reason=${diagnostics.reason}`,
  ].join(' ');
}

function createSmartSlicePlanningTextPreview(text: string) {
  const normalizedText = text.trim().replace(/\s+/gu, ' ');
  if (normalizedText.length <= SMART_SLICE_PLANNING_DIAGNOSTIC_TEXT_PREVIEW_LENGTH) {
    return normalizedText;
  }

  return `${normalizedText.slice(0, SMART_SLICE_PLANNING_DIAGNOSTIC_TEXT_PREVIEW_LENGTH)}...`;
}

function createSmartSlicePlanningTranscriptDiagnostics(
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
): SmartSlicePlanningDiagnostics['transcript'] {
  const normalizedPlanningSegments = normalizeSmartSliceTranscriptSegmentsForPlanning(transcriptSegments);
  const timingSegments = transcriptSegments.filter((segment) =>
    typeof segment.startMs === 'number' &&
    typeof segment.endMs === 'number' &&
    Number.isFinite(segment.startMs) &&
    Number.isFinite(segment.endMs) &&
    segment.endMs > segment.startMs
  );
  const invalidTimingSegmentCount = transcriptSegments.length - timingSegments.length;
  const durations = timingSegments.map((segment) => Math.max(0, Math.round(segment.endMs - segment.startMs)));
  const totalSpeechDurationMs = durations.reduce((totalDurationMs, durationMs) => totalDurationMs + durationMs, 0);
  const normalizedTexts = transcriptSegments.map((segment) =>
    normalizeSmartSliceTranscriptEvidenceText(segment.text),
  );
  const realContentSegmentCount = normalizedTexts.filter((text) => text.length > 0).length;
  const minStartMs = timingSegments.length > 0
    ? Math.round(Math.min(...timingSegments.map((segment) => segment.startMs)))
    : undefined;
  const maxEndMs = timingSegments.length > 0
    ? Math.round(Math.max(...timingSegments.map((segment) => segment.endMs)))
    : undefined;
  const firstTranscriptSegment = transcriptSegments[0];
  const lastTranscriptSegment = transcriptSegments.at(-1);
  const transcriptStartMs = firstTranscriptSegment &&
    typeof firstTranscriptSegment.startMs === 'number' &&
    Number.isFinite(firstTranscriptSegment.startMs)
      ? Math.round(firstTranscriptSegment.startMs)
      : undefined;
  const transcriptEndMs = lastTranscriptSegment &&
    typeof lastTranscriptSegment.endMs === 'number' &&
    Number.isFinite(lastTranscriptSegment.endMs)
      ? Math.round(lastTranscriptSegment.endMs)
      : undefined;

  return {
    transcriptSegmentCount: transcriptSegments.length,
    normalizedPlanningSegmentCount: normalizedPlanningSegments.length,
    realContentSegmentCount,
    lowInformationSegmentCount: transcriptSegments.length - realContentSegmentCount,
    invalidTimingSegmentCount,
    ...(transcriptStartMs !== undefined ? { transcriptStartMs } : {}),
    ...(transcriptEndMs !== undefined ? { transcriptEndMs } : {}),
    ...(minStartMs !== undefined ? { minStartMs } : {}),
    ...(maxEndMs !== undefined ? { maxEndMs } : {}),
    longestSegmentDurationMs: durations.length > 0 ? Math.max(...durations) : 0,
    shortestSegmentDurationMs: durations.length > 0 ? Math.min(...durations) : 0,
    totalSpeechDurationMs,
    averageSegmentDurationMs: durations.length > 0 ? Math.round(totalSpeechDurationMs / durations.length) : 0,
    sampleSegments: transcriptSegments
      .slice(0, SMART_SLICE_PLANNING_DIAGNOSTIC_SAMPLE_LIMIT)
      .map((segment, index) => {
        const startMs = typeof segment.startMs === 'number' && Number.isFinite(segment.startMs)
          ? Math.round(segment.startMs)
          : undefined;
        const endMs = typeof segment.endMs === 'number' && Number.isFinite(segment.endMs)
          ? Math.round(segment.endMs)
          : undefined;
        const normalizedText = normalizeSmartSliceTranscriptEvidenceText(segment.text);
        return {
          index,
          ...(startMs !== undefined ? { startMs } : {}),
          ...(endMs !== undefined ? { endMs } : {}),
          ...(startMs !== undefined && endMs !== undefined && endMs > startMs ? { durationMs: endMs - startMs } : {}),
          textLength: segment.text.length,
          normalizedTextLength: normalizedText.length,
          textPreview: createSmartSlicePlanningTextPreview(segment.text),
          ...(segment.speaker?.trim() ? { speaker: segment.speaker.trim() } : {}),
        };
      }),
  };
}

function createSmartSlicePlanningClipSample(
  clips: readonly NormalizedSlicePlanClip[],
) {
  return clips.slice(0, SMART_SLICE_PLANNING_DIAGNOSTIC_SAMPLE_LIMIT).map((clip) => ({
    ...(clip.candidateId ? { candidateId: clip.candidateId } : {}),
    ...(clip.planningEngine ? { planningEngine: clip.planningEngine } : {}),
    ...(clip.smartCutPresetId ? { smartCutPresetId: clip.smartCutPresetId } : {}),
    ...(clip.contentUnitIds?.length ? { contentUnitIds: clip.contentUnitIds.slice(0, 8) } : {}),
    ...(clip.speakerIds?.length ? { speakerIds: clip.speakerIds.slice(0, 8) } : {}),
    ...(clip.speakerRoles?.length ? { speakerRoles: clip.speakerRoles.slice(0, 8) } : {}),
    startMs: Math.round(clip.startMs),
    ...('endMs' in clip && typeof clip.endMs === 'number' ? { endMs: Math.round(clip.endMs) } : {}),
    durationMs: Math.round(clip.durationMs),
    ...(typeof clip.transcriptSegmentCount === 'number' ? { transcriptSegmentCount: clip.transcriptSegmentCount } : {}),
    ...(typeof clip.transcriptCoverageScore === 'number' ? { transcriptCoverageScore: clip.transcriptCoverageScore } : {}),
    ...(clip.speechContinuityGrade ? { speechContinuityGrade: clip.speechContinuityGrade } : {}),
    ...(clip.publishabilityGrade ? { publishabilityGrade: clip.publishabilityGrade } : {}),
    ...(clip.platformReadinessGrade ? { platformReadinessGrade: clip.platformReadinessGrade } : {}),
    ...(clip.risks?.length ? { risks: clip.risks.slice(0, 8) } : {}),
  }));
}

function createSmartSlicePlanningDiagnostics(
  params: VideoSliceParams,
  planningPolicy: VideoSlicePlanningPolicy,
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
  plannedClips: readonly NormalizedSlicePlanClip[],
  reason: string,
): SmartSlicePlanningDiagnostics {
  const minDurationMs = normalizeSliceDurationMs(params.minDuration);
  const maxDurationMs = normalizeSliceDurationMs(params.maxDuration);
  const sourceAssetUuid = getSmartSlicePlanningSourceAssetUuid(params);

  return {
    reason,
    ...(sourceAssetUuid ? { sourceAssetUuid } : {}),
    ...(planningPolicy.sourceDurationMs !== undefined ? { sourceDurationMs: planningPolicy.sourceDurationMs } : {}),
    params: {
      mode: params.mode,
      llmModel: params.llmModel,
      minDuration: params.minDuration,
      maxDuration: params.maxDuration,
      ...(params.idealDuration !== undefined ? { idealDuration: params.idealDuration } : {}),
      minDurationMs: Math.min(minDurationMs, maxDurationMs),
      maxDurationMs: Math.max(minDurationMs, maxDurationMs),
      idealDurationMs: planningPolicy.idealDurationMs,
      targetPlatform: planningPolicy.targetPlatform,
      targetAspectRatio: planningPolicy.targetAspectRatio,
      videoObjectFit: planningPolicy.videoObjectFit,
      continuityLevel: planningPolicy.continuityLevel,
      segmentationDensity: planningPolicy.segmentationDensity,
      ...(params.sttPresetId ? { sttPresetId: params.sttPresetId } : {}),
      continuityJoinGapMs: planningPolicy.continuityJoinGapMs,
      candidateJoinGapMs: planningPolicy.candidateJoinGapMs,
      continuityOverlapToleranceMs: planningPolicy.continuityOverlapToleranceMs,
      segmentationAgentId: params.segmentationAgentId,
      baseAlgorithm: params.baseAlgorithm,
      highlightEngine: params.highlightEngine,
      customKeywordCount: planningPolicy.customKeywords.length,
      enableNoiseReduction: shouldAllowSmartSliceNoiseReduction(params),
      enableCoughFilter: params.enableCoughFilter,
      enableRepeatFilter: params.enableRepeatFilter,
      enableSubtitles: params.enableSubtitles === true,
      ...(params.subtitleMode ? { subtitleMode: params.subtitleMode } : {}),
      ...(params.subtitleStyleId ? { subtitleStyleId: params.subtitleStyleId } : {}),
      hasFile: Boolean(params.file),
      hasFileId: Boolean(params.fileId?.trim()),
      hasUrl: Boolean(params.url?.trim()),
    },
    transcript: createSmartSlicePlanningTranscriptDiagnostics(transcriptSegments),
    planning: {
      plannedClipCount: plannedClips.length,
      engineClipSample: createSmartSlicePlanningClipSample(plannedClips),
    },
  };
}

function createAutoCutSliceReviewSessionFromClips({
  taskId,
  params,
  sourceAssetUuid,
  sourceDurationMs,
  clips,
  transcriptSegments,
  smartDedupAnalysis,
}: {
  taskId: string;
  params: VideoSliceParams;
  sourceAssetUuid?: string;
  sourceDurationMs?: number;
  clips: readonly NormalizedSlicePlanClip[];
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[];
  smartDedupAnalysis?: SmartSliceDedupAnalysis;
}): AutoCutSliceReviewSession {
  const timestamp = createAutoCutTimestamp();
  const baseSegments = clips.map((clip) =>
    createAutoCutSliceReviewSegmentFromClip(clip, transcriptSegments),
  );
  const smartDedupSegmentIds = new Set(smartDedupAnalysis?.matchedSegmentIds ?? []);
  const segments = smartDedupSegmentIds.size
    ? baseSegments.map((segment) =>
        smartDedupSegmentIds.has(segment.id)
          ? {
              ...segment,
              risks: createUniqueSmartSliceStringList([...segment.risks, SMART_SLICE_DEDUP_REVIEW_RISK_CODE]),
            }
          : segment,
      )
    : baseSegments;
  const duplicateGroups = [
    ...createAutoCutSliceDuplicateGroups(segments),
    ...(smartDedupAnalysis?.duplicateGroups ?? []),
  ];
  const segmentsWithDuplicateGroupLinks = applyAutoCutSliceDuplicateGroupLinks(segments, duplicateGroups);
  return {
    id: createAutoCutId('slice-review'),
    schema: 'slice.review.v1',
    status: 'ready_for_review',
    taskId,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...(sourceAssetUuid ? { sourceAssetUuid } : {}),
    ...(sourceDurationMs !== undefined ? { sourceDurationMs } : {}),
    segmentationAgentId: resolveSmartSliceSegmentationAgentId(params.segmentationAgentId),
    ...(smartDedupAnalysis?.smartDedupReport ? { smartDedupReport: smartDedupAnalysis.smartDedupReport } : {}),
    segments: segmentsWithDuplicateGroupLinks,
    duplicateGroups,
    manualEdits: [],
    selectedSegmentIds: segmentsWithDuplicateGroupLinks
      .filter((segment) => segment.selected && segment.status === 'selected')
      .map((segment) => segment.id),
  };
}

function createAutoCutSliceReviewSegmentFromClip(
  clip: NormalizedSlicePlanClip,
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
): AutoCutSliceReviewSegment {
  const startMs = Math.max(0, Math.round(clip.sourceStartMs ?? clip.startMs));
  const endMs = Math.max(startMs + 1, Math.round(clip.sourceEndMs ?? clip.startMs + clip.durationMs));
  const segmentTranscriptSegments = createVideoSliceTranscriptSegments(
    clip,
    { startMs: clip.startMs, durationMs: clip.durationMs } as AutoCutVideoSliceArtifactResult,
    transcriptSegments,
  );
  return {
    id: createAutoCutSliceReviewSegmentId(clip.index),
    sourceClipIndex: clip.index,
    status: clip.publishabilityGrade === 'reject' ? 'excluded' : 'selected',
    selected: clip.publishabilityGrade !== 'reject',
    title: clip.title ?? clip.label ?? `Segment ${clip.index + 1}`,
    ...(clip.summary ? { summary: clip.summary } : {}),
    startMs,
    endMs,
    durationMs: Math.max(1, endMs - startMs),
    ...(clip.speechStartMs !== undefined ? { speechStartMs: clip.speechStartMs } : {}),
    ...(clip.speechEndMs !== undefined ? { speechEndMs: clip.speechEndMs } : {}),
    contentUnitIds: [...(clip.contentUnitIds ?? [])],
    speakerIds: [...(clip.speakerIds ?? [])],
    speakerRoles: [...(clip.speakerRoles ?? [])],
    ...(segmentTranscriptSegments.length
      ? {
          transcriptSegments: segmentTranscriptSegments,
          transcriptText: createVideoSliceTranscriptText(segmentTranscriptSegments),
        }
      : clip.transcriptText
        ? { transcriptText: clip.transcriptText }
        : {}),
    risks: [...(clip.risks ?? [])],
    ...(clip.qualityScore !== undefined ? { qualityScore: clip.qualityScore } : {}),
    ...(clip.continuityScore !== undefined ? { continuityScore: clip.continuityScore } : {}),
    ...(clip.publishabilityScore !== undefined ? { publishabilityScore: clip.publishabilityScore } : {}),
    ...(clip.publishabilityGrade ? { publishabilityGrade: clip.publishabilityGrade } : {}),
  };
}

function applyAutoCutSliceDuplicateGroupLinks(
  segments: readonly AutoCutSliceReviewSegment[],
  duplicateGroups: readonly AutoCutSliceDuplicateGroup[],
): AutoCutSliceReviewSegment[] {
  return segments.map((segment) => {
    const duplicateGroup = duplicateGroups.find((group) => group.segmentIds.includes(segment.id));
    if (!duplicateGroup) {
      return clearAutoCutSliceDuplicateGroupLinks(segment);
    }
    return {
      ...segment,
      duplicateGroupId: duplicateGroup.id,
      duplicateOfSegmentId: duplicateGroup.keptSegmentId !== segment.id
        ? duplicateGroup.keptSegmentId
        : undefined,
    };
  });
}

function clearAutoCutSliceDuplicateGroupLinks(segment: AutoCutSliceReviewSegment): AutoCutSliceReviewSegment {
  const nextSegment = { ...segment };
  delete nextSegment.duplicateGroupId;
  delete nextSegment.duplicateOfSegmentId;
  return nextSegment;
}

function createAutoCutSliceReviewSegmentId(index: number) {
  return `segment-${String(index + 1).padStart(2, '0')}`;
}

function createAutoCutSliceDuplicateGroups(
  segments: readonly AutoCutSliceReviewSegment[],
) {
  const segmentByFingerprint = new Map<string, AutoCutSliceReviewSegment[]>();
  for (const segment of segments) {
    const fingerprint = createAutoCutSliceReviewSegmentFingerprint(segment);
    if (!fingerprint) {
      continue;
    }
    const group = segmentByFingerprint.get(fingerprint) ?? [];
    group.push(segment);
    segmentByFingerprint.set(fingerprint, group);
  }

  return [...segmentByFingerprint.values()]
    .filter((group) => group.length > 1)
    .map((group, index) => ({
      id: `duplicate-${String(index + 1).padStart(2, '0')}`,
      segmentIds: group.map((segment) => segment.id),
      keptSegmentId: group[0]?.id ?? '',
      reason: 'semantic-repeat' as const,
    }));
}

function createAutoCutSliceReviewSegmentFingerprint(segment: AutoCutSliceReviewSegment) {
  const contentUnitFingerprint = segment.contentUnitIds.join('|');
  if (contentUnitFingerprint) {
    return `units:${contentUnitFingerprint}`;
  }
  const normalizedTranscriptText = normalizeSmartSliceTranscriptEvidenceText(segment.transcriptText ?? '').toLowerCase();
  return normalizedTranscriptText.length >= 24 ? `text:${normalizedTranscriptText.slice(0, 120)}` : '';
}

function createUniqueSmartSliceStringList(values: readonly string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function shouldRunSmartSliceDedup(params: Pick<VideoSliceParams, 'enableSmartDedup'>) {
  return params.enableSmartDedup === true;
}

function createDisabledSmartSliceDedupAnalysis(): SmartSliceDedupAnalysis {
  return {
    enabled: false,
    duplicateGroups: [],
    matchedSegmentIds: [],
  };
}

function createSmartSliceVideoDedupParams(
  params: VideoSliceParams,
  sourceAssetUuid?: string,
): VideoDedupParams {
  const configuredParams = params.videoDedupParams;
  const configuredSourceAssetIds = configuredParams?.sourceAssetIds?.filter((assetId) => assetId.trim()) ?? [];
  const sourceAssetIds = configuredSourceAssetIds.length
    ? createUniqueSmartSliceStringList(configuredSourceAssetIds)
    : createUniqueSmartSliceStringList([
        params.fileId?.trim() ?? '',
        sourceAssetUuid?.trim() ?? '',
      ]);

  return createDefaultAutoCutVideoDedupParams({
    mode: 'slice-result-dedup',
    actionMode: 'review-before-action',
    ...(configuredParams ?? {}),
    sourceAssetIds,
    ...(configuredParams?.referenceAssetIds
      ? { referenceAssetIds: createUniqueSmartSliceStringList(configuredParams.referenceAssetIds) }
      : {}),
  });
}

async function analyzeSmartSliceDedup({
  params,
  sourceAssetUuid,
  runtimeSourceAsset,
  clips,
  transcriptSegments,
}: {
  params: VideoSliceParams;
  sourceAssetUuid?: string;
  runtimeSourceAsset?: AppAsset;
  clips: readonly NormalizedSlicePlanClip[];
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[];
}): Promise<SmartSliceDedupAnalysis> {
  if (!shouldRunSmartSliceDedup(params)) {
    return createDisabledSmartSliceDedupAnalysis();
  }

  const smartDedupParams = createSmartSliceVideoDedupParams(params, sourceAssetUuid);
  const smartDedupReport = await analyzeAutoCutVideoDedup(
    smartDedupParams,
    runtimeSourceAsset ? { runtimeAssets: [runtimeSourceAsset] } : undefined,
  );
  const reviewSegments = clips.map((clip) =>
    createAutoCutSliceReviewSegmentFromClip(clip, transcriptSegments),
  );
  const duplicateGroups = createSmartSliceDedupDuplicateGroups(smartDedupReport, reviewSegments);
  const matchedSegmentIds = createUniqueSmartSliceStringList(
    duplicateGroups.flatMap((group) => group.segmentIds),
  );

  return {
    enabled: true,
    smartDedupReport,
    duplicateGroups,
    matchedSegmentIds,
  };
}

function createSmartSliceDedupDuplicateGroups(
  report: VideoDedupReport,
  segments: readonly AutoCutSliceReviewSegment[],
): AutoCutSliceDuplicateGroup[] {
  if (!report.matches.length || !segments.length) {
    return [];
  }

  return report.groups
    .map((group, index): AutoCutSliceDuplicateGroup | undefined => {
      const matches = group.matches.length
        ? group.matches
        : report.matches.filter((match) =>
            match.sourceAssetId === group.canonicalAssetId ||
            match.targetAssetId === group.canonicalAssetId ||
            group.duplicateAssetIds.includes(match.sourceAssetId) ||
            group.duplicateAssetIds.includes(match.targetAssetId) ||
            group.reviewAssetIds.includes(match.sourceAssetId) ||
            group.reviewAssetIds.includes(match.targetAssetId),
          );
      const segmentIds = createUniqueSmartSliceStringList(
        matches.flatMap((match) =>
          segments
            .filter((segment) => doesSmartSliceReviewSegmentOverlapDedupMatch(segment, match))
            .map((segment) => segment.id),
        ),
      );
      if (!segmentIds.length) {
        return undefined;
      }
      const confidence = matches.reduce(
        (current, match) => Math.max(current, match.confidence),
        0,
      );
      const targetAssetIds = createUniqueSmartSliceStringList(
        matches.flatMap((match) => [match.targetAssetId, ...group.duplicateAssetIds, ...group.reviewAssetIds]),
      );

      return {
        id: `smart-dedup-${String(index + 1).padStart(2, '0')}`,
        segmentIds,
        keptSegmentId: segmentIds[0] ?? '',
        reason: 'smart-dedup',
        matchIds: createUniqueSmartSliceStringList(matches.map((match) => match.id)),
        sourceAssetIds: createUniqueSmartSliceStringList(matches.map((match) => match.sourceAssetId)),
        targetAssetIds,
        confidence: Math.round(confidence * 1000) / 1000,
        evidenceLabels: createUniqueSmartSliceStringList(
          matches.flatMap((match) =>
            match.evidence.map((evidence) => `${evidence.strategyId}:${evidence.label}`),
          ),
        ),
      };
    })
    .filter((group): group is AutoCutSliceDuplicateGroup => Boolean(group));
}

function doesSmartSliceReviewSegmentOverlapDedupMatch(
  segment: AutoCutSliceReviewSegment,
  match: VideoDuplicateMatch,
) {
  const overlapStartMs = Math.max(segment.startMs, match.sourceStartMs);
  const overlapEndMs = Math.min(segment.endMs, match.sourceEndMs);
  const overlapMs = Math.max(0, overlapEndMs - overlapStartMs);
  if (overlapMs >= SMART_SLICE_DEDUP_MIN_SEGMENT_OVERLAP_MS) {
    return true;
  }

  const segmentDurationMs = Math.max(1, segment.endMs - segment.startMs);
  const matchDurationMs = Math.max(1, match.sourceEndMs - match.sourceStartMs);
  return overlapMs / segmentDurationMs >= SMART_SLICE_DEDUP_MIN_SEGMENT_OVERLAP_RATIO ||
    overlapMs / matchDurationMs >= SMART_SLICE_DEDUP_MIN_SEGMENT_OVERLAP_RATIO;
}

function applyAutoCutSliceManualEdits(
  reviewSession: AutoCutSliceReviewSession,
  manualEdits: readonly AutoCutSliceManualEdit[] = [],
): AutoCutSliceReviewSession {
  if (manualEdits.length === 0) {
    return {
      ...reviewSession,
      selectedSegmentIds: reviewSession.segments
        .filter((segment) => segment.selected && segment.status === 'selected')
        .map((segment) => segment.id),
    };
  }

  let segments = reviewSession.segments.map((segment) => ({ ...segment }));
  let duplicateGroups = reviewSession.duplicateGroups.map((group) => ({ ...group, segmentIds: [...group.segmentIds] }));
  const segmentIdAliases = createSmartSliceReviewSegmentIdAliasMap(reviewSession);
  const appliedManualEdits = [...reviewSession.manualEdits];
  const appliedManualEditIds = new Set(appliedManualEdits.map((manualEdit) => manualEdit.id).filter(Boolean));

  for (const manualEdit of manualEdits) {
    if (appliedManualEditIds.has(manualEdit.id)) {
      continue;
    }
    const resolvedManualEdit = resolveSmartSliceManualEditSegmentAliases(manualEdit, segmentIdAliases);
    if (manualEdit.kind === 'select') {
      assertSmartSliceManualEditHasNoDuplicateTargets(segments, resolvedManualEdit, 'select');
      segments = segments.map((segment) =>
        resolvedManualEdit.segmentIds.includes(segment.id)
          ? { ...segment, selected: true, status: 'selected' }
          : segment,
      );
    } else if (manualEdit.kind === 'exclude') {
      assertSmartSliceManualEditHasNoDuplicateTargets(segments, resolvedManualEdit, 'exclude');
      segments = segments.map((segment) =>
        resolvedManualEdit.segmentIds.includes(segment.id)
          ? { ...segment, selected: false, status: 'excluded' }
          : segment,
      );
    } else if (manualEdit.kind === 'restore') {
      const restoredSegmentIds = new Set(resolvedManualEdit.segmentIds);
      segments = segments.map((segment) =>
        resolvedManualEdit.segmentIds.includes(segment.id)
          ? {
              ...segment,
              selected: true,
              status: 'selected',
              duplicateOfSegmentId: undefined,
              duplicateGroupId: undefined,
            }
          : segment,
      );
      duplicateGroups = duplicateGroups
        .map((group) => {
          const remainingSegmentIds = group.segmentIds.filter((segmentId) => !restoredSegmentIds.has(segmentId));
          return {
            ...group,
            segmentIds: remainingSegmentIds,
            keptSegmentId: restoredSegmentIds.has(group.keptSegmentId)
              ? remainingSegmentIds[0] ?? group.keptSegmentId
              : group.keptSegmentId,
          };
        })
        .filter((group) => group.segmentIds.length > 1);
    } else if (manualEdit.kind === 'deleteDuplicate') {
      const keepSegmentId = resolvedManualEdit.keepSegmentId ??
        (resolvedManualEdit.segmentIds.length > 1 ? resolvedManualEdit.segmentIds[0] : undefined);
      const keepSegment = keepSegmentId ? segments.find((segment) => segment.id === keepSegmentId) : undefined;
      const duplicateSegmentIds = resolvedManualEdit.segmentIds.filter((segmentId) => segmentId !== keepSegmentId && segments.some((segment) => segment.id === segmentId));
      const externalDuplicateSegmentIds = !keepSegment && !resolvedManualEdit.keepSegmentId && resolvedManualEdit.segmentIds.length === 1
        ? duplicateSegmentIds
        : [];
      if (!keepSegment && externalDuplicateSegmentIds.length > 0) {
        const externalKeptSegmentId = externalDuplicateSegmentIds[0];
        if (!externalKeptSegmentId) {
          continue;
        }
        const duplicateGroupId = `manual-external-duplicate-${manualEdit.id}`;
        duplicateGroups = [
          ...duplicateGroups,
          {
            id: duplicateGroupId,
            segmentIds: externalDuplicateSegmentIds,
            keptSegmentId: externalKeptSegmentId,
            reason: 'manual-duplicate',
          },
        ];
        segments = segments.map((segment) =>
          externalDuplicateSegmentIds.includes(segment.id)
            ? {
                ...segment,
                selected: false,
                status: 'duplicate',
                duplicateGroupId,
                duplicateOfSegmentId: undefined,
              }
            : segment,
        );
        appliedManualEdits.push(manualEdit);
        appliedManualEditIds.add(manualEdit.id);
        continue;
      }
      if (!keepSegment || duplicateSegmentIds.length === 0) {
        continue;
      }
      const duplicateGroupId = `manual-duplicate-${manualEdit.id}`;
      duplicateGroups = [
        ...duplicateGroups,
        {
          id: duplicateGroupId,
          segmentIds: [keepSegment.id, ...duplicateSegmentIds],
          keptSegmentId: keepSegment.id,
          reason: 'manual-duplicate',
        },
      ];
      segments = segments.map((segment) =>
        duplicateSegmentIds.includes(segment.id)
          ? {
              ...segment,
              selected: false,
              status: 'duplicate',
              duplicateGroupId,
              duplicateOfSegmentId: keepSegment.id,
            }
          : segment,
      );
    } else if (manualEdit.kind === 'split') {
      const splitSegmentId = resolvedManualEdit.segmentIds[0];
      const splitSegment = splitSegmentId ? segments.find((segment) => segment.id === splitSegmentId) : undefined;
      const createdSegmentIds = resolveSmartSliceManualEditCreatedSegmentIds(resolvedManualEdit, splitSegmentId);
      segments = splitAutoCutSliceReviewSegments(segments, {
        ...resolvedManualEdit,
        createdSegmentIds,
      });
      if (splitSegment && splitSegmentId && createdSegmentIds.length >= 2) {
        const activeCreatedSegmentIds = createdSegmentIds.filter((segmentId) =>
          segments.some((segment) => segment.id === segmentId),
        );
        if (activeCreatedSegmentIds.length >= 2) {
          setSmartSliceReviewSegmentIdAlias(segmentIdAliases, splitSegmentId, activeCreatedSegmentIds);
          duplicateGroups = remapSmartSliceDuplicateGroupsForSplitSegment(
            duplicateGroups,
            splitSegment,
            activeCreatedSegmentIds,
          );
        }
      }
    } else if (manualEdit.kind === 'merge') {
      assertSmartSliceManualEditHasNoDuplicateTargets(segments, resolvedManualEdit, 'merge');
      assertSmartSliceManualMergeTargetsAreAdjacent(segments, resolvedManualEdit);
      segments = mergeAutoCutSliceReviewSegments(segments, resolvedManualEdit);
      const mergedSegmentId = resolvedManualEdit.createdSegmentIds?.[0] ??
        createSmartSliceMergedReviewSegmentId(resolvedManualEdit.segmentIds);
      if (mergedSegmentId && segments.some((segment) => segment.id === mergedSegmentId)) {
        for (const segmentId of resolvedManualEdit.segmentIds) {
          setSmartSliceReviewSegmentIdAlias(segmentIdAliases, segmentId, [mergedSegmentId]);
        }
      }
    } else if (manualEdit.kind === 'correctSegment') {
      segments = correctAutoCutSliceReviewSegments(segments, resolvedManualEdit);
    }
    appliedManualEdits.push(manualEdit);
    appliedManualEditIds.add(manualEdit.id);
  }

  segments = applyAutoCutSliceDuplicateGroupLinks(segments, duplicateGroups);

  return {
    ...reviewSession,
    updatedAt: createAutoCutTimestamp(),
    segments,
    duplicateGroups,
    manualEdits: appliedManualEdits,
    selectedSegmentIds: segments
      .filter((segment) => segment.selected && segment.status === 'selected')
      .map((segment) => segment.id),
  };
}

function assertSmartSliceManualEditHasNoDuplicateTargets(
  segments: readonly AutoCutSliceReviewSegment[],
  manualEdit: AutoCutSliceManualEdit,
  action: 'select' | 'exclude' | 'merge',
) {
  const segmentById = new Map(segments.map((segment) => [segment.id, segment]));
  const duplicateSegment = manualEdit.segmentIds
    .map((segmentId) => segmentById.get(segmentId))
    .find((segment) => segment?.status === 'duplicate');
  if (duplicateSegment) {
    throw new Error(
      `Smart Slice review ${action} cannot target duplicate review segment ${duplicateSegment.id}; restore it before changing render eligibility.`,
    );
  }
}

function assertSmartSliceManualMergeTargetsAreAdjacent(
  segments: readonly AutoCutSliceReviewSegment[],
  manualEdit: AutoCutSliceManualEdit,
) {
  const mergeSegmentIds = createUniqueSmartSliceStringList(manualEdit.segmentIds);
  const mergeSegmentIndexes = mergeSegmentIds
    .map((segmentId) => segments.findIndex((segment) => segment.id === segmentId))
    .filter((segmentIndex) => segmentIndex >= 0)
    .sort((firstIndex, secondIndex) => firstIndex - secondIndex);
  if (mergeSegmentIndexes.length !== mergeSegmentIds.length || mergeSegmentIndexes.length < 2) {
    throw new Error('Smart Slice review merge requires at least two existing review segments.');
  }

  const firstMergeSegmentIndex = mergeSegmentIndexes[0] ?? 0;
  const hasGap = mergeSegmentIndexes.some((segmentIndex, index) => segmentIndex !== firstMergeSegmentIndex + index);
  if (hasGap) {
    throw new Error('Smart Slice review merge can only target adjacent review segments.');
  }
}

function createSmartSliceReviewSegmentIdAliasMap(reviewSession: AutoCutSliceReviewSession) {
  const aliasMap = new Map<string, string[]>();
  for (const segment of reviewSession.segments) {
    setSmartSliceReviewSegmentIdAlias(aliasMap, segment.id, [segment.id]);
  }
  return aliasMap;
}

function setSmartSliceReviewSegmentIdAlias(
  aliasMap: Map<string, string[]>,
  sourceSegmentId: string,
  targetSegmentIds: readonly string[],
) {
  const normalizedTargetSegmentIds = createUniqueSmartSliceStringList(
    targetSegmentIds.flatMap((targetSegmentId) => aliasMap.get(targetSegmentId) ?? [targetSegmentId]),
  );
  if (sourceSegmentId && normalizedTargetSegmentIds.length > 0) {
    aliasMap.set(sourceSegmentId, normalizedTargetSegmentIds);
  }
}

function resolveSmartSliceReviewSegmentIdAliases(
  segmentIds: readonly string[],
  aliasMap: Map<string, string[]>,
) {
  return createUniqueSmartSliceStringList(
    segmentIds.flatMap((segmentId) => aliasMap.get(segmentId) ?? [segmentId]),
  );
}

function resolveSmartSliceManualEditSegmentAliases(
  manualEdit: AutoCutSliceManualEdit,
  aliasMap: Map<string, string[]>,
): AutoCutSliceManualEdit {
  if (manualEdit.kind === 'deleteDuplicate') {
    const rawKeepSegmentId = manualEdit.keepSegmentId ??
      (manualEdit.segmentIds.length > 1 ? manualEdit.segmentIds[0] : undefined);
    const keepSegmentId = rawKeepSegmentId
      ? resolveSmartSliceReviewSegmentIdAliases([rawKeepSegmentId], aliasMap)[0] ?? rawKeepSegmentId
      : undefined;
    const segmentIds = createUniqueSmartSliceStringList(
      manualEdit.segmentIds.flatMap((segmentId, index) => {
        const isKeepReference = segmentId === rawKeepSegmentId || (!rawKeepSegmentId && index === 0);
        const aliases = resolveSmartSliceReviewSegmentIdAliases([segmentId], aliasMap);
        return isKeepReference ? [aliases[0] ?? segmentId] : aliases;
      }),
    );
    return {
      ...manualEdit,
      segmentIds,
      ...(keepSegmentId ? { keepSegmentId } : {}),
    };
  }

  const segmentIds = resolveSmartSliceReviewSegmentIdAliases(manualEdit.segmentIds, aliasMap);
  const keepSegmentAliases = manualEdit.keepSegmentId
    ? resolveSmartSliceReviewSegmentIdAliases([manualEdit.keepSegmentId], aliasMap)
    : [];
  const keepSegmentId = keepSegmentAliases[0] ?? manualEdit.keepSegmentId;
  return {
    ...manualEdit,
    segmentIds,
    ...(keepSegmentId ? { keepSegmentId } : {}),
  };
}

function resolveSmartSliceManualEditCreatedSegmentIds(
  manualEdit: AutoCutSliceManualEdit,
  sourceSegmentId: string | undefined,
) {
  const createdSegmentIds = createUniqueSmartSliceStringList(manualEdit.createdSegmentIds ?? []);
  if (createdSegmentIds.length >= 2) {
    return createdSegmentIds;
  }
  if (!sourceSegmentId) {
    return createdSegmentIds;
  }
  return [`${sourceSegmentId}-a`, `${sourceSegmentId}-b`];
}

function createSmartSliceMergedReviewSegmentId(segmentIds: readonly string[]) {
  return createUniqueSmartSliceStringList(segmentIds).join('-');
}

function remapSmartSliceDuplicateGroupsForSplitSegment(
  duplicateGroups: AutoCutSliceDuplicateGroup[],
  splitSegment: AutoCutSliceReviewSegment,
  createdSegmentIds: readonly string[],
) {
  const createdIds = createUniqueSmartSliceStringList(createdSegmentIds);
  if (!splitSegment.id || createdIds.length === 0) {
    return duplicateGroups;
  }

  return duplicateGroups
    .map((group) => {
      if (!group.segmentIds.includes(splitSegment.id)) {
        return group;
      }
      const segmentIds = createUniqueSmartSliceStringList(
        group.segmentIds.flatMap((segmentId) => (segmentId === splitSegment.id ? createdIds : [segmentId])),
      );
      return {
        ...group,
        segmentIds,
        keptSegmentId: group.keptSegmentId === splitSegment.id
          ? createdIds[0] ?? group.keptSegmentId
          : group.keptSegmentId,
      };
    })
    .filter((group) => group.segmentIds.length > 1);
}

function correctAutoCutSliceReviewSegments(
  segments: AutoCutSliceReviewSegment[],
  manualEdit: AutoCutSliceManualEdit,
) {
  const patch = manualEdit.patch;
  if (!patch || typeof patch !== 'object') {
    return segments;
  }
  const segmentIds = new Set(manualEdit.segmentIds);
  return segments.map((segment) => {
    if (!segmentIds.has(segment.id)) {
      return segment;
    }
    return normalizeCorrectedAutoCutSliceReviewSegment(segment, patch);
  });
}

function normalizeCorrectedAutoCutSliceReviewSegment(
  segment: AutoCutSliceReviewSegment,
  patch: NonNullable<AutoCutSliceManualEdit['patch']>,
): AutoCutSliceReviewSegment {
  const startMs = normalizeAutoCutSliceReviewPatchMs(patch.startMs, segment.startMs);
  const endMs = Math.max(startMs + 1, normalizeAutoCutSliceReviewPatchMs(patch.endMs, segment.endMs));
  const boundaryVersion = normalizeAutoCutSliceReviewPatchBoundaryVersion(patch.boundaryVersion, segment.boundaryVersion);
  const speechStartMs = normalizeOptionalAutoCutSliceReviewPatchMs(patch.speechStartMs, segment.speechStartMs);
  const speechEndMs = normalizeOptionalAutoCutSliceReviewPatchMs(patch.speechEndMs, segment.speechEndMs);
  const patchTranscriptText = typeof patch.transcriptText === 'string'
    ? normalizeSmartSliceTranscriptEvidenceText(patch.transcriptText)
    : undefined;
  const transcriptSegments = patchTranscriptText !== undefined
    ? createCorrectedAutoCutSliceReviewTranscriptSegments(segment, startMs, endMs, patchTranscriptText)
    : patch.startMs !== undefined || patch.endMs !== undefined
      ? filterAutoCutSliceReviewTranscriptSegments(segment, startMs, endMs)
      : segment.transcriptSegments;
  const correctedSegment: AutoCutSliceReviewSegment = {
    ...segment,
    ...(typeof patch.title === 'string' && patch.title.trim() ? { title: patch.title.trim() } : {}),
    ...(typeof patch.summary === 'string' ? { summary: patch.summary.trim() } : {}),
    startMs,
    endMs,
    durationMs: endMs - startMs,
    boundaryVersion,
    ...(speechStartMs !== undefined
      ? { speechStartMs: Math.max(startMs, Math.min(endMs, speechStartMs)) }
      : {}),
    ...(speechEndMs !== undefined
      ? { speechEndMs: Math.max(startMs, Math.min(endMs, speechEndMs)) }
      : {}),
    ...(Array.isArray(patch.speakerIds) ? { speakerIds: createUniqueSmartSliceStringList(patch.speakerIds) } : {}),
    ...(Array.isArray(patch.speakerRoles) ? { speakerRoles: createUniqueSmartSliceStringList(patch.speakerRoles) } : {}),
    ...(transcriptSegments ? { transcriptSegments } : {}),
    ...(patchTranscriptText !== undefined
      ? { transcriptText: patchTranscriptText }
      : transcriptSegments
        ? { transcriptText: createVideoSliceTranscriptText(transcriptSegments) }
        : {}),
    ...(typeof patch.manualNotes === 'string' ? { manualNotes: patch.manualNotes.trim() } : {}),
  };
  if (
    correctedSegment.speechStartMs !== undefined &&
    correctedSegment.speechEndMs !== undefined &&
    correctedSegment.speechEndMs < correctedSegment.speechStartMs
  ) {
    correctedSegment.speechEndMs = correctedSegment.speechStartMs;
  }
  return correctedSegment;
}

function createCorrectedAutoCutSliceReviewTranscriptSegments(
  segment: AutoCutSliceReviewSegment,
  startMs: number,
  endMs: number,
  transcriptText: string,
) {
  if (!transcriptText) {
    return [];
  }
  const clippedTranscriptSegments = filterAutoCutSliceReviewTranscriptSegments(segment, startMs, endMs);
  const firstTranscriptSegment = clippedTranscriptSegments[0];
  const lastTranscriptSegment = clippedTranscriptSegments.at(-1);
  const transcriptStartMs = Math.max(startMs, Math.round(firstTranscriptSegment?.startMs ?? segment.speechStartMs ?? startMs));
  const transcriptEndMs = Math.max(
    transcriptStartMs + 1,
    Math.min(endMs, Math.round(lastTranscriptSegment?.endMs ?? segment.speechEndMs ?? endMs)),
  );
  return [{
    startMs: transcriptStartMs,
    endMs: transcriptEndMs,
    text: transcriptText,
    ...(firstTranscriptSegment?.speaker?.trim() ? { speaker: firstTranscriptSegment.speaker.trim() } : {}),
  }];
}

function normalizeAutoCutSliceReviewPatchMs(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : Math.max(0, Math.round(fallback));
}

function normalizeOptionalAutoCutSliceReviewPatchMs(value: unknown, fallback: number | undefined) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }
  if (typeof fallback === 'number' && Number.isFinite(fallback)) {
    return Math.max(0, Math.round(fallback));
  }
  return undefined;
}

function normalizeAutoCutSliceReviewPatchBoundaryVersion(value: unknown, fallback: number | undefined) {
  const version = value ?? fallback;
  return typeof version === 'number' && Number.isFinite(version)
    ? Math.max(1, Math.round(version))
    : 1;
}

function splitAutoCutSliceReviewSegments(
  segments: AutoCutSliceReviewSegment[],
  manualEdit: AutoCutSliceManualEdit,
) {
  const splitSegmentId = manualEdit.segmentIds[0];
  const splitAtMs = manualEdit.splitAtMs;
  if (!splitSegmentId || typeof splitAtMs !== 'number' || !Number.isFinite(splitAtMs)) {
    return segments;
  }

  const sourceSegment = segments.find((segment) => segment.id === splitSegmentId);
  if (!sourceSegment || splitAtMs <= sourceSegment.startMs || splitAtMs >= sourceSegment.endMs) {
    return segments;
  }

  const beforeId = manualEdit.createdSegmentIds?.[0] ?? `${sourceSegment.id}-a`;
  const afterId = manualEdit.createdSegmentIds?.[1] ?? `${sourceSegment.id}-b`;
  return segments.flatMap((segment) => {
    if (segment.id !== splitSegmentId) {
      return [segment];
    }
    const beforeTranscriptSegments = filterAutoCutSliceReviewTranscriptSegments(segment, segment.startMs, splitAtMs);
    const afterTranscriptSegments = filterAutoCutSliceReviewTranscriptSegments(segment, splitAtMs, segment.endMs);
    const beforeSpeechRange = createClippedAutoCutSliceReviewSpeechRange(segment, segment.startMs, splitAtMs);
    const afterSpeechRange = createClippedAutoCutSliceReviewSpeechRange(segment, splitAtMs, segment.endMs);
    return [
      {
        ...segment,
        id: beforeId,
        endMs: Math.round(splitAtMs),
        durationMs: Math.max(1, Math.round(splitAtMs - segment.startMs)),
        ...beforeSpeechRange,
        transcriptSegments: beforeTranscriptSegments,
        transcriptText: createVideoSliceTranscriptText(beforeTranscriptSegments),
        title: `${segment.title} A`,
      },
      {
        ...segment,
        id: afterId,
        startMs: Math.round(splitAtMs),
        durationMs: Math.max(1, Math.round(segment.endMs - splitAtMs)),
        ...afterSpeechRange,
        transcriptSegments: afterTranscriptSegments,
        transcriptText: createVideoSliceTranscriptText(afterTranscriptSegments),
        title: `${segment.title} B`,
      },
    ];
  });
}

function filterAutoCutSliceReviewTranscriptSegments(
  segment: AutoCutSliceReviewSegment,
  startMs: number,
  endMs: number,
) {
  return (segment.transcriptSegments ?? [])
    .filter((transcriptSegment) => transcriptSegment.endMs > startMs && transcriptSegment.startMs < endMs)
    .map((transcriptSegment) => ({
      ...transcriptSegment,
      startMs: Math.max(startMs, transcriptSegment.startMs),
      endMs: Math.min(endMs, transcriptSegment.endMs),
    }))
    .filter((transcriptSegment) => transcriptSegment.endMs > transcriptSegment.startMs);
}

function createClippedAutoCutSliceReviewSpeechRange(
  segment: AutoCutSliceReviewSegment,
  startMs: number,
  endMs: number,
) {
  const transcriptSegments = filterAutoCutSliceReviewTranscriptSegments(segment, startMs, endMs);
  const speechStartMs = transcriptSegments[0]?.startMs ?? segment.speechStartMs;
  const speechEndMs = transcriptSegments.at(-1)?.endMs ?? segment.speechEndMs;
  if (speechStartMs === undefined || speechEndMs === undefined) {
    return {};
  }
  const clippedSpeechStartMs = Math.max(startMs, Math.min(endMs, Math.round(speechStartMs)));
  const clippedSpeechEndMs = Math.max(clippedSpeechStartMs, Math.min(endMs, Math.round(speechEndMs)));
  return {
    speechStartMs: clippedSpeechStartMs,
    speechEndMs: clippedSpeechEndMs,
  };
}

function mergeAutoCutSliceReviewSegments(
  segments: AutoCutSliceReviewSegment[],
  manualEdit: AutoCutSliceManualEdit,
) {
  const segmentIds = new Set(manualEdit.segmentIds);
  const mergeSegments = segments
    .filter((segment) => segmentIds.has(segment.id))
    .sort((a, b) => a.startMs - b.startMs);
  if (mergeSegments.length < 2) {
    return segments;
  }

  const baseSegment = mergeSegments[0];
  if (!baseSegment) {
    return segments;
  }

  const mergedStartMs = Math.min(...mergeSegments.map((segment) => segment.startMs));
  const mergedEndMs = Math.max(...mergeSegments.map((segment) => segment.endMs));
  const mergedTranscriptSegments = repairLightlyOverlappingVideoSliceTranscriptSegments(
    mergeSegments
      .flatMap((segment) => segment.transcriptSegments ?? [])
      .map((segment) => ({
        ...segment,
        startMs: Math.max(mergedStartMs, Math.round(segment.startMs)),
        endMs: Math.min(mergedEndMs, Math.round(segment.endMs)),
        text: normalizeSmartSliceTranscriptEvidenceText(segment.text),
      }))
      .filter((segment) => segment.endMs > segment.startMs && segment.text.length > 0)
      .sort((firstSegment, secondSegment) =>
        firstSegment.startMs - secondSegment.startMs ||
        firstSegment.endMs - secondSegment.endMs,
      ),
  );
  const mergedSpeechStartMs = Math.max(
    mergedStartMs,
    Math.min(
      mergedEndMs,
      Math.min(...mergeSegments.map((segment) => segment.speechStartMs ?? segment.startMs)),
    ),
  );
  const mergedSpeechEndMs = Math.max(
    mergedSpeechStartMs,
    Math.min(
      mergedEndMs,
      Math.max(...mergeSegments.map((segment) => segment.speechEndMs ?? segment.endMs)),
    ),
  );

  const mergedSegment: AutoCutSliceReviewSegment = {
    ...baseSegment,
    id: manualEdit.createdSegmentIds?.[0] ?? mergeSegments.map((segment) => segment.id).join('-'),
    title: mergeSegments.map((segment) => segment.title).filter(Boolean).join(' + '),
    startMs: mergedStartMs,
    endMs: mergedEndMs,
    durationMs: Math.max(1, mergedEndMs - mergedStartMs),
    speechStartMs: mergedSpeechStartMs,
    speechEndMs: mergedSpeechEndMs,
    contentUnitIds: [...new Set(mergeSegments.flatMap((segment) => segment.contentUnitIds))],
    speakerIds: [...new Set(mergeSegments.flatMap((segment) => segment.speakerIds))],
    speakerRoles: [...new Set(mergeSegments.flatMap((segment) => segment.speakerRoles))],
    transcriptSegments: mergedTranscriptSegments,
    transcriptText: mergedTranscriptSegments.length
      ? createVideoSliceTranscriptText(mergedTranscriptSegments)
      : mergeSegments.map((segment) => segment.transcriptText).filter(Boolean).join(' '),
    risks: [...new Set(mergeSegments.flatMap((segment) => segment.risks))],
    selected: mergeSegments.some((segment) => segment.selected),
    status: mergeSegments.some((segment) => segment.selected) ? 'selected' : 'excluded',
  };

  const firstMergedIndex = segments.findIndex((segment) => segmentIds.has(segment.id));
  const retainedSegments = segments.filter((segment) => !segmentIds.has(segment.id));
  const insertIndex = Math.max(0, Math.min(firstMergedIndex, retainedSegments.length));
  return [
    ...retainedSegments.slice(0, insertIndex),
    mergedSegment,
    ...retainedSegments.slice(insertIndex),
  ];
}

function trimReviewedSmartSliceClipSourceSegmentsToRange(
  sourceSegments: readonly { startMs: number; endMs: number }[] | undefined,
  sourceStartMs: number,
  sourceEndMs: number,
) {
  if (!Array.isArray(sourceSegments) || sourceSegments.length === 0) {
    return undefined;
  }

  const trimmedSegments = sourceSegments
    .map((segment) => ({
      startMs: Math.max(sourceStartMs, Math.round(segment.startMs)),
      endMs: Math.min(sourceEndMs, Math.round(segment.endMs)),
    }))
    .filter((segment) => segment.endMs > segment.startMs)
    .sort((firstSegment, secondSegment) =>
      firstSegment.startMs - secondSegment.startMs ||
      firstSegment.endMs - secondSegment.endMs,
    );

  return trimmedSegments.length > 0 ? trimmedSegments : undefined;
}

function normalizeReviewedSmartSliceClipEvidence(
  clip: NormalizedSlicePlanClip,
) {
  const sourceStartMs = Math.max(0, Math.round(clip.sourceStartMs ?? clip.startMs));
  const sourceEndMs = Math.max(
    sourceStartMs + 1,
    Math.round(clip.sourceEndMs ?? clip.startMs + clip.durationMs),
  );
  const speechStartMs = Math.max(
    sourceStartMs,
    Math.min(
      Math.round(clip.speechStartMs ?? sourceStartMs),
      sourceEndMs,
    ),
  );
  const speechEndMs = Math.max(
    speechStartMs,
    Math.min(
      Math.round(clip.speechEndMs ?? sourceEndMs),
      sourceEndMs,
    ),
  );
  let normalizedClip: NormalizedSlicePlanClip = {
    ...clip,
    startMs: sourceStartMs,
    durationMs: sourceEndMs - sourceStartMs,
    sourceStartMs,
    sourceEndMs,
    speechStartMs,
    speechEndMs,
    boundaryPaddingBeforeMs: Math.max(0, speechStartMs - sourceStartMs),
    boundaryPaddingAfterMs: Math.max(0, sourceEndMs - speechEndMs),
  };

  if (
    typeof normalizedClip.audioActivityStartMs === 'number' &&
    Number.isFinite(normalizedClip.audioActivityStartMs) &&
    typeof normalizedClip.audioActivityEndMs === 'number' &&
    Number.isFinite(normalizedClip.audioActivityEndMs)
  ) {
    const audioActivityStartMs = Math.max(
      sourceStartMs,
      Math.min(Math.round(normalizedClip.audioActivityStartMs), sourceEndMs),
    );
    const audioActivityEndMs = Math.max(
      audioActivityStartMs,
      Math.min(Math.round(normalizedClip.audioActivityEndMs), sourceEndMs),
    );
    if (audioActivityEndMs > audioActivityStartMs) {
      normalizedClip.audioActivityStartMs = audioActivityStartMs;
      normalizedClip.audioActivityEndMs = audioActivityEndMs;
      normalizedClip.leadingSilenceMs = Math.max(0, audioActivityStartMs - sourceStartMs);
      normalizedClip.trailingSilenceMs = Math.max(0, sourceEndMs - audioActivityEndMs);
    } else {
      delete normalizedClip.audioActivityStartMs;
      delete normalizedClip.audioActivityEndMs;
      delete normalizedClip.audioActivityConfidence;
      delete normalizedClip.audioActivityAnalysisFilter;
      delete normalizedClip.leadingSilenceMs;
      delete normalizedClip.trailingSilenceMs;
    }
  } else {
    delete normalizedClip.audioActivityStartMs;
    delete normalizedClip.audioActivityEndMs;
    delete normalizedClip.audioActivityConfidence;
    delete normalizedClip.audioActivityAnalysisFilter;
    delete normalizedClip.leadingSilenceMs;
    delete normalizedClip.trailingSilenceMs;
  }
  if (hasTrustedSmartSliceAudioActivityEvidence(normalizedClip)) {
    const audioActivityStartMs = Math.round(normalizedClip.audioActivityStartMs as number);
    const audioActivityEndMs = Math.round(normalizedClip.audioActivityEndMs as number);
    const leadingSilenceMs = audioActivityStartMs - sourceStartMs;
    const trailingSilenceMs = sourceEndMs - audioActivityEndMs;
    if (
      audioActivityEndMs <= audioActivityStartMs ||
      audioActivityStartMs < sourceStartMs ||
      audioActivityEndMs > sourceEndMs ||
      leadingSilenceMs > MAX_SMART_SLICE_LEADING_SILENCE_MS ||
      trailingSilenceMs > MAX_SMART_SLICE_TRAILING_SILENCE_MS
    ) {
      normalizedClip = stripTrustedSmartSliceAudioActivityEvidence(normalizedClip);
    } else {
      normalizedClip.leadingSilenceMs = leadingSilenceMs;
      normalizedClip.trailingSilenceMs = trailingSilenceMs;
    }
  }

  const trimmedSourceSegments = trimReviewedSmartSliceClipSourceSegmentsToRange(
    normalizedClip.sourceSegments,
    sourceStartMs,
    sourceEndMs,
  );
  if (
    trimmedSourceSegments &&
    trimmedSourceSegments.length > 1 &&
    doSmartSliceSourceSegmentsSpanSourceRange(trimmedSourceSegments, sourceStartMs, sourceEndMs)
  ) {
    const renderedDurationMs = trimmedSourceSegments.reduce(
      (durationMs, segment) => durationMs + Math.max(0, segment.endMs - segment.startMs),
      0,
    );
    normalizedClip.sourceSegments = trimmedSourceSegments;
    normalizedClip.renderedDurationMs = renderedDurationMs;
    normalizedClip.removedSilenceMs = Math.max(0, sourceEndMs - sourceStartMs - renderedDurationMs);
    normalizedClip.internalSilenceTrimCount = trimmedSourceSegments.length - 1;
  } else {
    delete normalizedClip.sourceSegments;
    delete normalizedClip.renderedDurationMs;
    delete normalizedClip.removedSilenceMs;
    delete normalizedClip.internalSilenceTrimCount;
  }

  return normalizedClip;
}

function createReviewedSmartSliceClips(
  plannedClips: readonly NormalizedSlicePlanClip[],
  reviewSession: AutoCutSliceReviewSession,
  renderSelection?: AutoCutSliceRenderSelection,
): NormalizedSlicePlanClip[] {
  const reviewedSession = applyAutoCutSliceManualEdits(reviewSession, renderSelection?.manualEdits ?? []);
  const selectedSegmentIds = new Set(
    (renderSelection?.selectedSegmentIds?.length
      ? renderSelection.selectedSegmentIds
      : reviewedSession.selectedSegmentIds
    ).filter(Boolean),
  );
  const clipByReviewSegmentId = new Map(
    plannedClips.map((clip) => [createAutoCutSliceReviewSegmentId(clip.index), clip]),
  );
  return reviewedSession.segments
    .filter((segment) =>
      selectedSegmentIds.has(segment.id) &&
      segment.selected &&
      segment.status === 'selected'
    )
    .flatMap((segment, index): NormalizedSlicePlanClip[] => {
      const sourceClip = clipByReviewSegmentId.get(segment.id) ?? plannedClips[segment.sourceClipIndex];
      if (!sourceClip) {
        return [];
      }
      const reviewedTranscriptSegments = segment.transcriptSegments ?? [];
      const reviewedTranscriptText = segment.transcriptText?.trim() ||
        (reviewedTranscriptSegments.length ? createVideoSliceTranscriptText(reviewedTranscriptSegments) : '');
      const reviewedClip: NormalizedSlicePlanClip = {
        ...sourceClip,
        index,
        label: segment.title,
        title: segment.title,
        sourceStartMs: segment.startMs,
        sourceEndMs: segment.endMs,
        startMs: segment.startMs,
        durationMs: segment.durationMs,
        contentUnitIds: segment.contentUnitIds.length ? segment.contentUnitIds : (sourceClip.contentUnitIds ?? []),
        speakerIds: segment.speakerIds.length ? segment.speakerIds : (sourceClip.speakerIds ?? []),
        speakerRoles: segment.speakerRoles.length ? segment.speakerRoles : (sourceClip.speakerRoles ?? []),
        ...(reviewedTranscriptText ? { transcriptText: reviewedTranscriptText } : {}),
        ...(reviewedTranscriptSegments.length ? { transcriptSegments: reviewedTranscriptSegments } : {}),
        ...(reviewedTranscriptSegments.length ? { transcriptSegmentCount: reviewedTranscriptSegments.length } : {}),
        risks: [...new Set([...(sourceClip.risks ?? []), ...segment.risks])],
      };
      if (segment.manualNotes) {
        reviewedClip.reason = segment.manualNotes;
      }
      const reviewedSummary = segment.summary ?? sourceClip.summary;
      if (reviewedSummary !== undefined) {
        reviewedClip.summary = reviewedSummary;
      }
      const reviewedSpeechStartMs = segment.speechStartMs ?? sourceClip.speechStartMs;
      if (reviewedSpeechStartMs !== undefined) {
        reviewedClip.speechStartMs = reviewedSpeechStartMs;
      }
      const reviewedSpeechEndMs = segment.speechEndMs ?? sourceClip.speechEndMs;
      if (reviewedSpeechEndMs !== undefined) {
        reviewedClip.speechEndMs = reviewedSpeechEndMs;
      }
      const sourceClipStartMs = Math.round(sourceClip.sourceStartMs ?? sourceClip.startMs);
      const sourceClipEndMs = Math.round(sourceClip.sourceEndMs ?? sourceClip.startMs + sourceClip.durationMs);
      const expandsBeyondSourceClip = segment.startMs < sourceClipStartMs || segment.endMs > sourceClipEndMs;
      if (expandsBeyondSourceClip) {
        const transcriptAudioActivityStartMs = Math.max(segment.startMs, Math.min(segment.endMs, reviewedClip.speechStartMs ?? segment.startMs));
        const transcriptAudioActivityEndMs = Math.max(
          transcriptAudioActivityStartMs,
          Math.min(segment.endMs, reviewedClip.speechEndMs ?? segment.endMs),
        );
        reviewedClip.boundaryDecisionSource = 'transcript';
        reviewedClip.audioActivityStartMs = transcriptAudioActivityStartMs;
        reviewedClip.audioActivityEndMs = transcriptAudioActivityEndMs;
        reviewedClip.audioActivityConfidence = 0.97;
        reviewedClip.audioActivityAnalysisFilter = getSmartSliceRequiredAudioActivityAnalysisFilter(
          reviewedClip.noiseReductionApplied ?? false,
        );
        reviewedClip.leadingSilenceMs = Math.max(0, transcriptAudioActivityStartMs - segment.startMs);
        reviewedClip.trailingSilenceMs = Math.max(0, segment.endMs - transcriptAudioActivityEndMs);
        delete reviewedClip.leadingSilenceTrimMs;
        delete reviewedClip.trailingSilenceTrimMs;
      }
      return [normalizeReviewedSmartSliceClipEvidence(reviewedClip)];
    });
}

function assertReviewedSmartSliceRenderSelection(
  reviewedSession: AutoCutSliceReviewSession,
  selectedSegmentIds: readonly string[],
) {
  const uniqueSelectedSegmentIds = [...new Set(selectedSegmentIds.filter(Boolean))];
  if (uniqueSelectedSegmentIds.length === 0) {
    throw new Error('Smart Slice render selected requires at least one selected review segment.');
  }

  const segmentById = new Map(reviewedSession.segments.map((segment) => [segment.id, segment]));
  const unknownSegmentId = uniqueSelectedSegmentIds.find((segmentId) => !segmentById.has(segmentId));
  if (unknownSegmentId) {
    throw new Error(`Smart Slice render selected rejected unknown review segment ${unknownSegmentId}.`);
  }

  const nonRenderableSegment = uniqueSelectedSegmentIds
    .map((segmentId) => segmentById.get(segmentId))
    .find((segment) => segment !== undefined && (!segment.selected || segment.status !== 'selected'));
  if (nonRenderableSegment) {
    throw new Error(
      `Smart Slice render selected requires every requested segment to be a selected non-duplicate review segment. Segment ${nonRenderableSegment.id} is ${nonRenderableSegment.status}.`,
    );
  }
}

function resolveReviewedSmartSliceRenderableSegmentIds(
  reviewedSession: AutoCutSliceReviewSession,
  selectedSegmentIds: readonly string[],
) {
  const uniqueSelectedSegmentIds = [...new Set(selectedSegmentIds.filter(Boolean))];
  const segmentById = new Map(reviewedSession.segments.map((segment) => [segment.id, segment]));
  return uniqueSelectedSegmentIds.filter((segmentId) => {
    const segment = segmentById.get(segmentId);
    return Boolean(segment && segment.selected && segment.status === 'selected');
  });
}

function resolveReviewedSmartSliceDraftSegmentIds(
  reviewedSession: AutoCutSliceReviewSession,
  selectedSegmentIds: readonly string[],
) {
  const uniqueSelectedSegmentIds = [...new Set(selectedSegmentIds.filter(Boolean))];
  const segmentById = new Map(reviewedSession.segments.map((segment) => [segment.id, segment]));
  return uniqueSelectedSegmentIds.filter((segmentId) => {
    const segment = segmentById.get(segmentId);
    return Boolean(segment && segment.selected && segment.status === 'selected');
  });
}

function assertReviewedSmartSliceDraftSelection(
  reviewedSession: AutoCutSliceReviewSession,
  selectedSegmentIds: readonly string[],
) {
  const uniqueSelectedSegmentIds = [...new Set(selectedSegmentIds.filter(Boolean))];
  const segmentById = new Map(reviewedSession.segments.map((segment) => [segment.id, segment]));
  const unknownSegmentId = uniqueSelectedSegmentIds.find((segmentId) => !segmentById.has(segmentId));
  if (unknownSegmentId) {
    throw new Error(`Smart Slice review draft rejected unknown review segment ${unknownSegmentId}.`);
  }

  const nonDraftSelectableSegment = uniqueSelectedSegmentIds
    .map((segmentId) => segmentById.get(segmentId))
    .find((segment) => segment !== undefined && segment.status === 'duplicate');
  if (nonDraftSelectableSegment) {
    throw new Error(
      `Smart Slice review draft requires selected segment ids to exclude duplicate review segments. Segment ${nonDraftSelectableSegment.id} is ${nonDraftSelectableSegment.status}.`,
    );
  }
}

function resolveSmartSliceProductTargetCandidateCount(
  params: VideoSliceParams,
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
  sourceDurationMs: number | undefined,
): number | undefined {
  const explicitTargetCandidateCount = (params as VideoSliceParams & { targetCandidateCount?: unknown }).targetCandidateCount;
  if (typeof explicitTargetCandidateCount === 'number' && Number.isFinite(explicitTargetCandidateCount)) {
    return Math.max(1, Math.floor(explicitTargetCandidateCount));
  }

  const mode = String(params.mode ?? '');
  if (/meeting|conference|agenda|minutes|interview|dialogue|qa|q&a|\u4f1a\u8bae|\u8bbf\u8c08|\u5bf9\u8bdd|\u95ee\u7b54|\u53cc\u4eba|\u591a\u4eba/iu.test(mode)) {
    return undefined;
  }

  const transcriptEndMs = Math.max(0, ...transcriptSegments.map((segment) =>
    typeof segment.endMs === 'number' && Number.isFinite(segment.endMs) ? Math.round(segment.endMs) : 0,
  ));
  const planningDurationMs = sourceDurationMs ?? transcriptEndMs;
  if (planningDurationMs >= SMART_SLICE_LONG_SOURCE_TARGET_THRESHOLD_MS) {
    return SMART_SLICE_LONG_SOURCE_SINGLE_SHORT_TARGET_CANDIDATE_COUNT;
  }

  return undefined;
}

async function createIntelligentSlicePlanResult(
  params: VideoSliceParams,
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[] = [],
): Promise<SmartCutEngineSlicePlanResult> {
  const trustedSourceDurationMs = resolveTrustedVideoSliceSourceDurationMs(params);
  if (trustedSourceDurationMs !== undefined && trustedSourceDurationMs < 5_000) {
    throw new Error('AutoCut source video is too short to produce a valid video slice.');
  }

  const planningParams = {
    ...params,
    segmentationAgentId: resolveSmartSliceSegmentationAgentId(params.segmentationAgentId),
    segmentationDensity: params.segmentationDensity ?? 'default',
    ...(trustedSourceDurationMs !== undefined ? { sourceDurationMs: trustedSourceDurationMs } : {}),
  };
  const fallbackPlanResult = (
    fallbackReason = 'smart-cut-engine-unavailable',
    fallbackTranscriptSegments: readonly AutoCutSpeechTranscriptionSegment[] = transcriptSegments,
  ) => createFallbackSmartSlicePlanResult(
    planningParams,
    fallbackTranscriptSegments,
    fallbackReason,
  );
  try {
    assertSmartSliceTranscriptTimelineWithinSourceDuration(
      transcriptSegments,
      trustedSourceDurationMs,
      'clip planning',
    );
  } catch (error) {
    reportVideoSliceStageDiagnostic('transcript timeline invalid; fallback planning used', {
      sourceDurationMs: trustedSourceDurationMs,
      transcriptSegmentCount: transcriptSegments.length,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return fallbackPlanResult(
      error instanceof Error ? error.message : String(error),
      [],
    );
  }
  if (transcriptSegments.length > 0 && !hasRealSmartSliceTranscriptContentEvidence(transcriptSegments)) {
    reportVideoSliceStageDiagnostic('transcript content unavailable; fallback planning used', {
      sourceDurationMs: trustedSourceDurationMs,
      transcriptSegmentCount: transcriptSegments.length,
      reason: 'speech-to-text returned only silence, filler, or low-information transcript segments',
    });
    return fallbackPlanResult(
      'speech-to-text returned only silence, filler, or low-information transcript segments',
      [],
    );
  }

  try {
    const sourceAssetUuid = getSmartSlicePlanningSourceAssetUuid(planningParams);
    const targetCandidateCount = resolveSmartSliceProductTargetCandidateCount(
      planningParams,
      transcriptSegments,
      trustedSourceDurationMs,
    );
    const llmReview = await resolveSmartCutEngineLlmReview(planningParams);
    const result = await createSmartCutEngineSlicePlan({
      params: planningParams,
      transcriptSegments,
      ...(sourceAssetUuid !== undefined ? { sourceAssetUuid } : {}),
      ...(trustedSourceDurationMs !== undefined ? { sourceDurationMs: trustedSourceDurationMs } : {}),
      ...(targetCandidateCount !== undefined ? { targetCandidateCount } : {}),
      ...(llmReview !== undefined ? { llmReview } : {}),
    });
    reportVideoSliceStageDiagnostic('smart cut engine plan ready', {
      sourceDurationMs: trustedSourceDurationMs,
      transcriptSegmentCount: result.transcriptEvidence.segments.length,
      speakerProfileCount: result.speakerEvidence.profiles.length,
      speakerSegmentCount: result.speakerEvidence.segments.length,
      plannedClipCount: result.clips.length,
      presetId: result.presetId,
      targetCandidateCount,
      segmentationDensity: planningParams.segmentationDensity,
      candidateJoinGapMs: getVideoSlicePlanningPolicy(planningParams).candidateJoinGapMs,
    });
    return result;
  } catch (error) {
    if (error instanceof SmartCutEngineSlicePlanningError) {
      reportVideoSliceStageDiagnostic('smart cut engine planning blocked', {
        sourceDurationMs: trustedSourceDurationMs,
        transcriptSegmentCount: transcriptSegments.length,
        blockerCount: error.blockers.length,
        blockers: error.blockers.map((blocker) => ({
          code: blocker.code,
          source: blocker.source,
          message: blocker.message,
        })).slice(0, 8),
      });
    } else {
      reportVideoSliceStageDiagnostic('smart cut engine planning failed', {
        sourceDurationMs: trustedSourceDurationMs,
        transcriptSegmentCount: transcriptSegments.length,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
    return createFallbackSmartSlicePlanResult(
      planningParams,
      transcriptSegments,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function createFallbackSmartSlicePlanResult(
  params: VideoSliceParams,
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
  reason: string,
): SmartCutEngineSlicePlanResult {
  const sourceDurationMs = resolveTrustedVideoSliceSourceDurationMs(params);
  const transcriptPlan = transcriptSegments.length > 0
    ? createTranscriptAssistedSlicePlan(params, transcriptSegments)
    : [];
  const fallbackClips = transcriptPlan.length > 0
    ? transcriptPlan
    : createDeterministicSlicePlan(params);
  if (fallbackClips.length === 0) {
    throw new SmartSlicePlanningError(
      'Smart Slice fallback could not create a renderable clip plan from the available source metadata.',
      createSmartSlicePlanningDiagnostics(
        params,
        getVideoSlicePlanningPolicy(params),
        transcriptSegments,
        [],
        reason,
      ),
    );
  }

  const clips = fallbackClips.map((clip, index) => ({
    ...clip,
    index,
    risks: createUniqueSmartSliceStringList([
      ...(clip.risks ?? []),
      transcriptPlan.length > 0 ? 'transcript-assisted-fallback' : 'deterministic-no-transcript-fallback',
      'smart-cut-engine-fallback',
    ]),
  }));
  reportVideoSliceStageDiagnostic('fallback plan ready', {
    sourceDurationMs,
    transcriptSegmentCount: transcriptSegments.length,
    plannedClipCount: clips.length,
    reason,
  });

  return {
    clips,
    presetId: 'teacher-talking-head-single' satisfies SmartCutProductPresetId,
    transcriptEvidence: createFallbackSmartCutTranscriptEvidence(transcriptSegments),
    speakerEvidence: createFallbackSmartCutSpeakerEvidence(transcriptSegments),
    blockers: [],
  };
}

function createFallbackSmartCutTranscriptEvidence(
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
): SmartCutTranscriptEvidence {
  return {
    kind: 'transcript',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    provider: 'fallback',
    language: 'auto',
    segments: transcriptSegments
      .map((segment, index) => ({
        id: `fallback-transcript-${String(index + 1).padStart(4, '0')}`,
        startMs: Math.max(0, Math.round(segment.startMs)),
        endMs: Math.max(0, Math.round(segment.endMs)),
        text: normalizeSmartSliceTranscriptEvidenceText(segment.text),
        confidence: 0.5,
        language: 'auto',
        speakerId: segment.speaker?.trim()
          ? `speaker-${segment.speaker.trim().toLowerCase().replace(/[^a-z0-9]+/gu, '-')}`
          : 'speaker-1',
      }))
      .filter((segment) => segment.endMs > segment.startMs && segment.text.length > 0),
  };
}

function createFallbackSmartCutSpeakerEvidence(
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
): SmartCutSpeakerEvidence {
  const speakerLabels = createUniqueSmartSliceStringList(
    transcriptSegments.map((segment) => segment.speaker?.trim() || 'Speaker 1'),
  );
  const profiles = (speakerLabels.length ? speakerLabels : ['Speaker 1']).map((label, index) => ({
    id: `speaker-${index + 1}`,
    displayName: label,
    role: 'speaker' as const,
    confidence: 0.5,
    source: 'metadata' as const,
  }));
  const speakerIdByLabel = new Map(profiles.map((profile) => [profile.displayName, profile.id]));
  return {
    kind: 'speaker',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    profiles,
    segments: transcriptSegments
      .map((segment, index) => {
        const label = segment.speaker?.trim() || 'Speaker 1';
        return {
          id: `fallback-speaker-segment-${String(index + 1).padStart(4, '0')}`,
          speakerId: speakerIdByLabel.get(label) ?? 'speaker-1',
          startMs: Math.max(0, Math.round(segment.startMs)),
          endMs: Math.max(0, Math.round(segment.endMs)),
          confidence: 0.5,
        };
      })
      .filter((segment) => segment.endMs > segment.startMs),
    turns: [],
    overlappingSpeechGroups: [],
    roleAssignments: profiles.map((profile) => ({
      speakerId: profile.id,
      role: profile.role,
      confidence: profile.confidence,
      evidenceTurnIds: [],
      source: 'metadata' as const,
    })),
    corrections: [],
  };
}

async function resolveSmartCutEngineLlmReview(
  params: VideoSliceParams,
): Promise<SmartCutEngineLlmReviewCreator | undefined> {
  try {
    const runtime = await resolveAutoCutLlmRuntimeConfig();
    if (!runtime.apiKeyConfigured || !runtime.baseUrl || !runtime.model) {
      reportVideoSliceStageDiagnostic('smart cut engine llm review disabled', {
        llmModel: params.llmModel,
        segmentationAgentId: params.segmentationAgentId,
        runtimeModel: runtime.model,
        modelVendor: runtime.modelVendor,
        apiKeyConfigured: runtime.apiKeyConfigured,
      });
      return undefined;
    }
  } catch (error) {
    reportVideoSliceStageDiagnostic('smart cut engine llm review runtime unavailable', {
      llmModel: params.llmModel,
      segmentationAgentId: params.segmentationAgentId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }

  return async (input) => {
    try {
      const review = await createSmartCutEngineLlmReview(input, async (request) =>
        createAutoCutOpenAiCompatibleChatCompletion({
          model: request.model,
          messages: request.messages,
          maxTokens: SMART_SLICE_LLM_REVIEW_MAX_TOKENS,
        })
      );
      if (isCompleteSmartCutEngineLlmReview(review, input)) {
        return review;
      }

      reportVideoSliceStageDiagnostic('smart cut engine llm review coverage invalid', {
        llmModel: input.model,
        presetId: input.presetId,
        segmentationAgentId: input.segmentationAgent?.id ?? input.segmentationAgentId,
        candidateCount: input.candidates.length,
        contentUnitCount: input.contentUnits.length,
      });
      return createDeterministicSmartCutEngineServiceLlmReview(
        input,
        'External LLM review was incomplete or invalid; deterministic ID-only review preserved Smart Cut Engine timestamps.',
      );
    } catch (error) {
      reportVideoSliceStageDiagnostic('smart cut engine llm review provider unavailable', {
        llmModel: input.model,
        presetId: input.presetId,
        segmentationAgentId: input.segmentationAgent?.id ?? input.segmentationAgentId,
        candidateCount: input.candidates.length,
        contentUnitCount: input.contentUnits.length,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return createDeterministicSmartCutEngineServiceLlmReview(
        input,
        'External LLM review was unavailable; deterministic ID-only review preserved Smart Cut Engine timestamps.',
      );
    }
  };
}

function createDeterministicSmartCutEngineServiceLlmReview(
  input: Parameters<SmartCutEngineLlmReviewCreator>[0],
  reviewNote: string,
): { rankedCandidateIds: string[]; referencedUnitIds: string[]; reviewNotes: string[] } {
  return {
    rankedCandidateIds: input.candidates.map((candidate) => candidate.id),
    referencedUnitIds: uniqueSmartSliceStrings(input.candidates.flatMap((candidate) => candidate.unitIds)),
    reviewNotes: [
      input.segmentationAgent?.id
        ? `${reviewNote} Segmentation agent ${input.segmentationAgent.id} remained ID-only.`
        : reviewNote,
    ],
  };
}

function isCompleteSmartCutEngineLlmReview(
  review: unknown,
  input: Parameters<SmartCutEngineLlmReviewCreator>[0],
) {
  if (!isSmartSliceRecord(review) || containsSmartSliceRawTimeRange(review)) {
    return false;
  }

  const rankedCandidateIds = readSmartSliceStringArray(review.rankedCandidateIds);
  const referencedUnitIds = readSmartSliceStringArray(review.referencedUnitIds);
  const coversCandidateAndUnitIds = coversSmartCutEngineRequiredIds(
    rankedCandidateIds,
    input.candidates.map((candidate) => candidate.id),
  ) && coversSmartCutEngineRequiredIds(
    referencedUnitIds,
    uniqueSmartSliceStrings(input.candidates.flatMap((candidate) => candidate.unitIds)),
  );
  if (!coversCandidateAndUnitIds) {
    return false;
  }

  if (!isCanonicalSmartCutEngineLlmReview(review)) {
    return true;
  }

  const referencedTimeSliceIds = readSmartSliceStringArray(review.referencedTimeSliceIds);
  const referencedSpeakerIds = readSmartSliceStringArray(review.referencedSpeakerIds);
  const referencedSpeakerTurnIds = readSmartSliceStringArray(review.referencedSpeakerTurnIds);
  const segmentDecisions = readSmartCutEngineSegmentDecisionRecords(review.segmentDecisions);
  const requiredTimeSliceIds = input.candidates.map((candidate) => `time-slice-${candidate.id}`);
  const requiredSpeakerIds = uniqueSmartSliceStrings(input.contentUnits.flatMap((unit) => unit.speakerIds ?? []));
  const requiredSpeakerTurnIds = uniqueSmartSliceStrings(input.contentUnits.flatMap((unit) => unit.speakerTurnIds ?? []));

  return coversSmartCutEngineRequiredIds(referencedTimeSliceIds, requiredTimeSliceIds) &&
    (requiredSpeakerIds.length === 0 || coversSmartCutEngineRequiredIds(referencedSpeakerIds, requiredSpeakerIds)) &&
    (requiredSpeakerTurnIds.length === 0 || coversSmartCutEngineRequiredIds(referencedSpeakerTurnIds, requiredSpeakerTurnIds)) &&
    coversSmartCutEngineSegmentDecisions(segmentDecisions, input);
}

function isCanonicalSmartCutEngineLlmReview(review: Record<string, unknown>): boolean {
  return review.schemaVersion === 'smart-cut-llm-review/v1' ||
    review.reviewKind === 'candidate-id-semantic-segmentation-review' ||
    Array.isArray(review.segmentDecisions) ||
    Array.isArray(review.referencedTimeSliceIds) ||
    Array.isArray(review.referencedSpeakerTurnIds);
}

function readSmartCutEngineSegmentDecisionRecords(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is Record<string, unknown> => isSmartSliceRecord(entry));
}

function coversSmartCutEngineSegmentDecisions(
  segmentDecisions: readonly Record<string, unknown>[],
  input: Parameters<SmartCutEngineLlmReviewCreator>[0],
): boolean {
  if (segmentDecisions.length === 0) {
    return false;
  }
  const candidateIds = input.candidates.map((candidate) => candidate.id);
  const candidateIdSet = new Set(candidateIds);
  const candidateIdsWithDecisions = new Set<string>();
  for (const segmentDecision of segmentDecisions) {
    const candidateId = typeof segmentDecision.candidateId === 'string' ? segmentDecision.candidateId.trim() : '';
    if (!candidateId || !candidateIdSet.has(candidateId)) {
      return false;
    }
    candidateIdsWithDecisions.add(candidateId);
  }
  return candidateIds.every((candidateId) => candidateIdsWithDecisions.has(candidateId));
}

function coversSmartCutEngineRequiredIds(
  values: readonly string[],
  requiredValues: readonly string[],
) {
  if (values.length === 0 || values.length !== uniqueSmartSliceStrings(values).length) {
    return false;
  }
  const requiredValueSet = new Set(requiredValues);
  const valueSet = new Set(values);
  return values.every((value) => requiredValueSet.has(value)) &&
    requiredValues.every((value) => valueSet.has(value));
}

function readSmartSliceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function containsSmartSliceRawTimeRange(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsSmartSliceRawTimeRange(item));
  }
  if (!isSmartSliceRecord(value)) {
    return false;
  }
  if (
    (typeof value.startMs === 'number' || typeof value.start === 'number') &&
    (typeof value.endMs === 'number' || typeof value.end === 'number')
  ) {
    return true;
  }
  if (
    (typeof value.startMs === 'number' || typeof value.start === 'number') &&
    (typeof value.durationMs === 'number' || typeof value.duration === 'number')
  ) {
    return true;
  }
  return Object.values(value).some((nestedValue) => containsSmartSliceRawTimeRange(nestedValue));
}

function isSmartSliceRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function uniqueSmartSliceStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function resolveTrustedVideoSliceSourceDurationMs(params: VideoSliceParams) {
  if (typeof params.sourceDurationMs === 'number' && Number.isFinite(params.sourceDurationMs) && params.sourceDurationMs > 0) {
    return Math.round(params.sourceDurationMs);
  }

  return undefined;
}

function hasRealSmartSliceTranscriptContentEvidence(
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
) {
  return transcriptSegments.some((segment) =>
    normalizeSmartSliceTranscriptEvidenceText(segment.text).length > 0,
  );
}

function hasSmartSliceRenderTranscriptEvidence(
  plannedClips: readonly NormalizedSlicePlanClip[],
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
) {
  return transcriptSegments.length > 0 &&
    plannedClips.length > 0 &&
    plannedClips.every((clip) =>
      Array.isArray(clip.transcriptSegments) &&
      clip.transcriptSegments.length > 0 &&
      typeof clip.transcriptText === 'string' &&
      clip.transcriptText.trim().length > 0 &&
      typeof clip.transcriptSegmentCount === 'number' &&
      clip.transcriptSegmentCount === clip.transcriptSegments.length
    );
}

function resolveSmartSliceRenderTranscriptSegments(
  plannedClips: readonly NormalizedSlicePlanClip[],
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
) {
  return hasSmartSliceRenderTranscriptEvidence(plannedClips, transcriptSegments)
    ? transcriptSegments
    : [];
}

function normalizeSmartSliceTranscriptTimelineForSourceDuration(
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
  sourceDurationMs: number | undefined,
): AutoCutSpeechTranscriptionSegment[] {
  const trustedSourceDurationMs =
    typeof sourceDurationMs === 'number' && Number.isFinite(sourceDurationMs) && sourceDurationMs > 0
      ? Math.round(sourceDurationMs)
      : undefined;
  const unitNormalizedTranscriptSegments = normalizeSmartSliceTranscriptTimeUnit(
    transcriptSegments,
    trustedSourceDurationMs,
  );

  const sourceBoundedTranscriptSegments = unitNormalizedTranscriptSegments.flatMap((segment, index) => {
    const normalizedSegment = {
      ...segment,
      startMs: Math.round(segment.startMs),
      endMs: Math.round(segment.endMs),
    };
    if (trustedSourceDurationMs === undefined) {
      return [normalizedSegment];
    }

    const overflowMs = normalizedSegment.endMs - trustedSourceDurationMs;
    if (overflowMs <= 0) {
      return [normalizedSegment];
    }

    const startsOutsideSource = normalizedSegment.startMs >= trustedSourceDurationMs;
    const hasRealTranscriptContent =
      normalizeSmartSliceTranscriptEvidenceText(normalizedSegment.text).length > 0;
    const canDropTailFiller =
      !hasRealTranscriptContent &&
      normalizedSegment.startMs < trustedSourceDurationMs;
    if (canDropTailFiller) {
      reportVideoSliceStageDiagnostic('transcript timeline tail filler dropped', {
        sourceDurationMs: trustedSourceDurationMs,
        segmentNumber: index + 1,
        originalStartMs: normalizedSegment.startMs,
        originalEndMs: normalizedSegment.endMs,
        overflowMs,
      });
      return [];
    }

    const canRepairFinalTail =
      overflowMs > 0 &&
      overflowMs <= MAX_SMART_SLICE_TRANSCRIPT_SOURCE_TAIL_REPAIR_MS &&
      normalizedSegment.startMs < trustedSourceDurationMs;
    if (canRepairFinalTail) {
      reportVideoSliceStageDiagnostic('transcript timeline tail clamped', {
        sourceDurationMs: trustedSourceDurationMs,
        segmentNumber: index + 1,
        originalStartMs: normalizedSegment.startMs,
        originalEndMs: normalizedSegment.endMs,
        repairedEndMs: trustedSourceDurationMs,
        overflowMs,
      });
      return [{
        ...normalizedSegment,
        endMs: trustedSourceDurationMs,
      }];
    }

    const canDropOutOfSourceTailFiller =
      startsOutsideSource &&
      !hasRealTranscriptContent;
    if (canDropOutOfSourceTailFiller) {
      reportVideoSliceStageDiagnostic('transcript timeline tail filler dropped', {
        sourceDurationMs: trustedSourceDurationMs,
        segmentNumber: index + 1,
        originalStartMs: normalizedSegment.startMs,
        originalEndMs: normalizedSegment.endMs,
        overflowMs,
      });
      return [];
    }

    return [normalizedSegment];
  });

  return normalizeSmartSliceTranscriptSegmentsForPlanning(sourceBoundedTranscriptSegments);
}

function normalizeSmartSliceTranscriptTimeUnit(
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
  sourceDurationMs: number | undefined,
): AutoCutSpeechTranscriptionSegment[] {
  if (!shouldScaleSmartSliceTranscriptSecondsToMilliseconds(transcriptSegments, sourceDurationMs)) {
    return transcriptSegments.slice();
  }

  reportVideoSliceStageDiagnostic('transcript timeline seconds normalized', {
    sourceDurationMs,
    transcriptSegmentCount: transcriptSegments.length,
    transcriptStartMs: transcriptSegments[0]?.startMs,
    transcriptEndMs: transcriptSegments.at(-1)?.endMs,
  });

  return transcriptSegments.map((segment) => ({
    ...segment,
    startMs: Math.round(segment.startMs * 1_000),
    endMs: Math.round(segment.endMs * 1_000),
    ...(Array.isArray(segment.words) && segment.words.length > 0
      ? {
          words: segment.words.map((word) => ({
            ...word,
            startMs: Math.round(word.startMs * 1_000),
            endMs: Math.round(word.endMs * 1_000),
          })),
        }
      : {}),
  }));
}

function shouldScaleSmartSliceTranscriptSecondsToMilliseconds(
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
  sourceDurationMs: number | undefined,
) {
  if (
    transcriptSegments.length < SMART_SLICE_TRANSCRIPT_SECONDS_UNIT_MIN_SEGMENTS
  ) {
    return false;
  }

  const timestampedSegments = transcriptSegments.filter((segment) =>
    typeof segment.startMs === 'number' &&
    typeof segment.endMs === 'number' &&
    Number.isFinite(segment.startMs) &&
    Number.isFinite(segment.endMs) &&
    segment.endMs > segment.startMs
  );
  if (timestampedSegments.length < SMART_SLICE_TRANSCRIPT_SECONDS_UNIT_MIN_SEGMENTS) {
    return false;
  }

  const transcriptStartMs = Math.min(...timestampedSegments.map((segment) => segment.startMs));
  const transcriptEndMs = Math.max(...timestampedSegments.map((segment) => segment.endMs));
  const longestSegmentDurationMs = Math.max(
    ...timestampedSegments.map((segment) => segment.endMs - segment.startMs),
  );
  if (
    transcriptStartMs < 0 ||
    transcriptEndMs <= 0 ||
    transcriptEndMs > SMART_SLICE_TRANSCRIPT_SECONDS_UNIT_MAX_TIMELINE_MS ||
    longestSegmentDurationMs > SMART_SLICE_TRANSCRIPT_SECONDS_UNIT_MAX_SEGMENT_DURATION_MS
  ) {
    return false;
  }

  const scaledTranscriptEndMs = transcriptEndMs * 1_000;
  const scaledLongestSegmentDurationMs = longestSegmentDurationMs * 1_000;
  if (sourceDurationMs === undefined) {
    return shouldScaleSmartSliceTranscriptSecondsToMillisecondsWithoutSourceDuration(
      timestampedSegments,
      transcriptStartMs,
      transcriptEndMs,
      scaledLongestSegmentDurationMs,
    );
  }

  if (sourceDurationMs < SMART_SLICE_TRANSCRIPT_SECONDS_UNIT_MIN_SOURCE_DURATION_MS) {
    return false;
  }

  return scaledTranscriptEndMs <= sourceDurationMs + MAX_SMART_SLICE_TRANSCRIPT_SOURCE_TAIL_REPAIR_MS &&
    scaledLongestSegmentDurationMs >= SMART_SLICE_TRANSCRIPT_SECONDS_UNIT_MIN_SCALED_SEGMENT_DURATION_MS;
}

function shouldScaleSmartSliceTranscriptSecondsToMillisecondsWithoutSourceDuration(
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
  transcriptStartMs: number,
  transcriptEndMs: number,
  scaledLongestSegmentDurationMs: number,
) {
  if (
    transcriptEndMs - transcriptStartMs < SMART_SLICE_TRANSCRIPT_SECONDS_UNIT_MIN_UNKNOWN_DURATION_EVIDENCE_UNITS ||
    scaledLongestSegmentDurationMs < SMART_SLICE_TRANSCRIPT_SECONDS_UNIT_MIN_SCALED_SEGMENT_DURATION_MS
  ) {
    return false;
  }

  const speechDurationUnits = transcriptSegments.reduce(
    (totalDurationUnits, segment) => totalDurationUnits + Math.max(0, segment.endMs - segment.startMs),
    0,
  );
  if (speechDurationUnits <= 0) {
    return false;
  }

  const transcriptEvidenceTextUnits = transcriptSegments.reduce(
    (totalTextUnits, segment) =>
      totalTextUnits + normalizeSmartSliceTranscriptEvidenceText(segment.text).length,
    0,
  );
  const richSegmentCount = transcriptSegments.filter(
    (segment) =>
      normalizeSmartSliceTranscriptEvidenceText(segment.text).length >=
        SMART_SLICE_TRANSCRIPT_SECONDS_UNIT_MIN_UNKNOWN_DURATION_SEGMENT_TEXT_UNITS,
  ).length;
  if (
    richSegmentCount < SMART_SLICE_TRANSCRIPT_SECONDS_UNIT_MIN_UNKNOWN_DURATION_RICH_SEGMENTS ||
    transcriptEvidenceTextUnits < SMART_SLICE_TRANSCRIPT_SECONDS_UNIT_MIN_UNKNOWN_DURATION_EVIDENCE_UNITS
  ) {
    return false;
  }

  const textUnitsPerUnscaledSecond = transcriptEvidenceTextUnits * 1_000 / speechDurationUnits;
  return textUnitsPerUnscaledSecond >=
    SMART_SLICE_TRANSCRIPT_SECONDS_UNIT_MIN_UNKNOWN_DURATION_TEXT_UNITS_PER_SECOND;
}

async function finishVideoSliceTask(newTask: AppTask, sliceResults: TaskSliceResult[]) {
  const timestamp = createAutoCutTimestamp();

  for (const sliceResult of sliceResults) {
    await addAsset({
      id: sliceResult.id,
      name: sliceResult.name,
      type: 'video',
      size: sliceResult.size,
      url: sliceResult.url,
      thumbnailUrl: sliceResult.thumbnailUrl,
      ...(sliceResult.artifactPath ? { artifactPath: sliceResult.artifactPath } : {}),
      ...(sliceResult.taskOutputDir ? { taskOutputDir: sliceResult.taskOutputDir } : {}),
      sourceTaskId: newTask.id,
      sourceTaskType: newTask.type,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  await addMessage({
    id: createAutoCutId('msg'),
    type: 'success',
    title: '视频切片完成',
    description: `任务 "${newTask.name}" 已生成 ${sliceResults.length} 个视频片段。`,
    createdAt: createAutoCutTimestamp(),
    read: false,
    actionUrl: '/tasks/' + newTask.id,
    actionLabel: '查看任务',
  });

  return {
    resultCount: sliceResults.length,
    generatedAssetIds: sliceResults.map((sliceResult) => sliceResult.id),
    sliceResults,
  };
}

function createNativeSliceResult(
  newTask: AppTask,
  nativeSlice: AutoCutVideoSliceArtifactResult,
  index: number,
  url: string,
  thumbnailUrl: string,
  subtitleUrl?: string,
  plannedClip?: NormalizedSlicePlanClip,
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[] = [],
): TaskSliceResult {
  const sliceName = createPlannedSliceOutputFileName(plannedClip, nativeSlice, index);
  const sourceStartMs = Math.max(
    0,
    Math.round(
      nativeSlice.sourceStartMs ??
        plannedClip?.sourceStartMs ??
        nativeSlice.startMs,
    ),
  );
  const sourceEndMs = Math.max(
    sourceStartMs + 1,
    Math.round(
      nativeSlice.sourceEndMs ??
        plannedClip?.sourceEndMs ??
        nativeSlice.startMs + nativeSlice.durationMs,
    ),
  );
  const speechStartMs = Math.max(
    sourceStartMs,
    Math.min(
      Math.round(
        nativeSlice.speechStartMs ??
          plannedClip?.speechStartMs ??
          sourceStartMs,
      ),
      sourceEndMs,
    ),
  );
  const speechEndMs = Math.max(
    speechStartMs,
    Math.min(
      Math.round(
        nativeSlice.speechEndMs ??
          plannedClip?.speechEndMs ??
          sourceEndMs,
      ),
      sourceEndMs,
    ),
  );
  const sliceTranscriptSegments = createVideoSliceTranscriptSegments(plannedClip, nativeSlice, transcriptSegments);
  const sliceTranscriptText = createVideoSliceTranscriptText(sliceTranscriptSegments);
  const sliceSourceSegmentSpeechEvidence: Pick<
    NormalizedSlicePlanClip | TaskSliceResult,
    | 'speechStartMs'
    | 'speechEndMs'
    | 'audioActivityStartMs'
    | 'audioActivityEndMs'
    | 'audioActivityConfidence'
    | 'audioActivityAnalysisFilter'
    | 'noiseReductionApplied'
  > = {
    speechStartMs,
    speechEndMs,
  };
  const sourceSegmentAudioActivityStartMs = nativeSlice.audioActivityStartMs ?? plannedClip?.audioActivityStartMs;
  const sourceSegmentAudioActivityEndMs = nativeSlice.audioActivityEndMs ?? plannedClip?.audioActivityEndMs;
  const sourceSegmentAudioActivityConfidence = nativeSlice.audioActivityConfidence ?? plannedClip?.audioActivityConfidence;
  const sourceSegmentAudioActivityAnalysisFilter = nativeSlice.audioActivityAnalysisFilter ?? plannedClip?.audioActivityAnalysisFilter;
  const sourceSegmentNoiseReductionApplied = nativeSlice.noiseReductionApplied ?? plannedClip?.noiseReductionApplied;
  if (typeof sourceSegmentAudioActivityStartMs === 'number') {
    sliceSourceSegmentSpeechEvidence.audioActivityStartMs = sourceSegmentAudioActivityStartMs;
  }
  if (typeof sourceSegmentAudioActivityEndMs === 'number') {
    sliceSourceSegmentSpeechEvidence.audioActivityEndMs = sourceSegmentAudioActivityEndMs;
  }
  if (typeof sourceSegmentAudioActivityConfidence === 'number') {
    sliceSourceSegmentSpeechEvidence.audioActivityConfidence = sourceSegmentAudioActivityConfidence;
  }
  if (typeof sourceSegmentAudioActivityAnalysisFilter === 'string') {
    sliceSourceSegmentSpeechEvidence.audioActivityAnalysisFilter = sourceSegmentAudioActivityAnalysisFilter;
  }
  if (typeof sourceSegmentNoiseReductionApplied === 'boolean') {
    sliceSourceSegmentSpeechEvidence.noiseReductionApplied = sourceSegmentNoiseReductionApplied;
  }
  const nativeSliceSourceSegments = normalizeSmartSliceRenderableArtifactSourceSegments(
    nativeSlice.sourceSegments,
    sourceStartMs,
    sourceEndMs,
    nativeSlice.durationMs,
    sliceSourceSegmentSpeechEvidence,
    sliceTranscriptSegments,
  );
  const plannedSliceSourceSegments = nativeSliceSourceSegments
    ? undefined
    : normalizeSmartSliceRenderableArtifactSourceSegments(
        plannedClip?.sourceSegments,
        sourceStartMs,
        sourceEndMs,
        nativeSlice.durationMs,
        sliceSourceSegmentSpeechEvidence,
        sliceTranscriptSegments,
      );
  const sliceSourceSegments = nativeSliceSourceSegments ?? plannedSliceSourceSegments;
  const renderedDurationMs = sliceSourceSegments
    ? sliceSourceSegments.reduce((durationMs, segment) => durationMs + Math.max(0, segment.endMs - segment.startMs), 0)
    : sourceEndMs - sourceStartMs;
  const removedSilenceMs = sliceSourceSegments
    ? Math.max(0, sourceEndMs - sourceStartMs - renderedDurationMs)
    : undefined;
  const internalSilenceTrimCount = sliceSourceSegments
    ? sliceSourceSegments.length - 1
    : undefined;
  const audioCleanupProfile = nativeSlice.audioCleanupProfile ?? plannedClip?.audioCleanupProfile;
  const noiseReductionApplied = nativeSlice.noiseReductionApplied ?? plannedClip?.noiseReductionApplied;
  const boundaryDecisionSource = nativeSlice.boundaryDecisionSource ?? plannedClip?.boundaryDecisionSource;
  const audioActivityStartMs = nativeSlice.audioActivityStartMs ?? plannedClip?.audioActivityStartMs;
  const audioActivityEndMs = nativeSlice.audioActivityEndMs ?? plannedClip?.audioActivityEndMs;
  const audioActivityConfidence = nativeSlice.audioActivityConfidence ?? plannedClip?.audioActivityConfidence;
  const audioActivityAnalysisFilter = nativeSlice.audioActivityAnalysisFilter ?? plannedClip?.audioActivityAnalysisFilter;
  const leadingSilenceMs = nativeSlice.leadingSilenceMs ?? plannedClip?.leadingSilenceMs;
  const trailingSilenceMs = nativeSlice.trailingSilenceMs ?? plannedClip?.trailingSilenceMs;
  const leadingSilenceTrimMs = nativeSlice.leadingSilenceTrimMs ?? plannedClip?.leadingSilenceTrimMs;
  const trailingSilenceTrimMs = nativeSlice.trailingSilenceTrimMs ?? plannedClip?.trailingSilenceTrimMs;
  const tailTreatment = nativeSlice.tailTreatment ?? plannedClip?.tailTreatment;
  const risks = mergeSmartSliceServiceRisks(plannedClip?.risks, nativeSlice.risks);
  const sliceResult = {
    id: nativeSlice.artifactUuid,
    name: `${newTask.name}_${nativeSlice.label || `高光片段 ${index + 1}`}.mp4`,
    duration: Math.max(1, Math.round(renderedDurationMs / 1_000)),
    size: nativeSlice.byteSize,
    resolution: '1080P',
    thumbnailUrl,
    url,
    ...(subtitleUrl ? { subtitleUrl } : {}),
    ...(nativeSlice.subtitleFormat ? { subtitleFormat: nativeSlice.subtitleFormat } : {}),
    ...(plannedClip?.title ? { title: plannedClip.title } : {}),
    ...(plannedClip?.summary ? { summary: plannedClip.summary } : {}),
    ...(plannedClip?.reason ? { reason: plannedClip.reason } : {}),
    ...(plannedClip?.qualityScore !== undefined ? { qualityScore: plannedClip.qualityScore } : {}),
    ...(plannedClip?.continuityScore !== undefined ? { continuityScore: plannedClip.continuityScore } : {}),
    ...(plannedClip?.storyShape ? { storyShape: plannedClip.storyShape } : {}),
    ...(plannedClip?.publishabilityScore !== undefined ? { publishabilityScore: plannedClip.publishabilityScore } : {}),
    ...(plannedClip?.publishabilityGrade ? { publishabilityGrade: plannedClip.publishabilityGrade } : {}),
    ...(plannedClip?.publishabilityIssues ? { publishabilityIssues: plannedClip.publishabilityIssues } : {}),
    ...(plannedClip?.boundaryQualityScore !== undefined ? { boundaryQualityScore: plannedClip.boundaryQualityScore } : {}),
    ...(plannedClip?.hookStrength ? { hookStrength: plannedClip.hookStrength } : {}),
    ...(plannedClip?.endingCompleteness ? { endingCompleteness: plannedClip.endingCompleteness } : {}),
    ...(plannedClip?.contentArcScore !== undefined ? { contentArcScore: plannedClip.contentArcScore } : {}),
    ...(plannedClip?.contentArcGrade ? { contentArcGrade: plannedClip.contentArcGrade } : {}),
    ...(plannedClip?.contentArcStages ? { contentArcStages: plannedClip.contentArcStages } : {}),
    ...(plannedClip?.contentArcMissingStages ? { contentArcMissingStages: plannedClip.contentArcMissingStages } : {}),
    ...(plannedClip?.topicCoherenceScore !== undefined ? { topicCoherenceScore: plannedClip.topicCoherenceScore } : {}),
    ...(plannedClip?.topicCoherenceGrade ? { topicCoherenceGrade: plannedClip.topicCoherenceGrade } : {}),
    ...(plannedClip?.topicShiftCount !== undefined ? { topicShiftCount: plannedClip.topicShiftCount } : {}),
    ...(plannedClip?.topicKeywords ? { topicKeywords: plannedClip.topicKeywords } : {}),
    ...(plannedClip?.platformReadinessScore !== undefined ? { platformReadinessScore: plannedClip.platformReadinessScore } : {}),
    ...(plannedClip?.platformReadinessGrade ? { platformReadinessGrade: plannedClip.platformReadinessGrade } : {}),
    ...(plannedClip?.platformReadinessIssues ? { platformReadinessIssues: plannedClip.platformReadinessIssues } : {}),
    ...(plannedClip?.sentenceBoundaryIntegrityScore !== undefined
      ? { sentenceBoundaryIntegrityScore: plannedClip.sentenceBoundaryIntegrityScore }
      : {}),
    ...(plannedClip?.sentenceBoundaryIntegrityGrade
      ? { sentenceBoundaryIntegrityGrade: plannedClip.sentenceBoundaryIntegrityGrade }
      : {}),
    ...(plannedClip?.sentenceBoundaryIssues ? { sentenceBoundaryIssues: plannedClip.sentenceBoundaryIssues } : {}),
    ...(risks ? { risks } : {}),
    sourceStartMs,
    sourceEndMs,
    speechStartMs,
    speechEndMs,
    boundaryPaddingBeforeMs: Math.max(0, speechStartMs - sourceStartMs),
    boundaryPaddingAfterMs: Math.max(0, sourceEndMs - speechEndMs),
    ...(audioCleanupProfile ? { audioCleanupProfile } : {}),
    ...(noiseReductionApplied !== undefined
      ? { noiseReductionApplied }
      : {}),
    ...(boundaryDecisionSource ? { boundaryDecisionSource } : {}),
    ...(audioActivityStartMs !== undefined
      ? { audioActivityStartMs }
      : {}),
    ...(audioActivityEndMs !== undefined
      ? { audioActivityEndMs }
      : {}),
    ...(audioActivityConfidence !== undefined
      ? { audioActivityConfidence }
      : {}),
    ...(audioActivityAnalysisFilter
      ? { audioActivityAnalysisFilter }
      : {}),
    ...(leadingSilenceMs !== undefined ? { leadingSilenceMs } : {}),
    ...(trailingSilenceMs !== undefined ? { trailingSilenceMs } : {}),
    ...(leadingSilenceTrimMs !== undefined
      ? { leadingSilenceTrimMs }
      : {}),
    ...(trailingSilenceTrimMs !== undefined
      ? { trailingSilenceTrimMs }
      : {}),
    ...(sliceSourceSegments?.length ? { sourceSegments: sliceSourceSegments } : {}),
    ...(renderedDurationMs !== undefined ? { renderedDurationMs } : {}),
    ...(removedSilenceMs !== undefined ? { removedSilenceMs } : {}),
    ...(internalSilenceTrimCount !== undefined
      ? { internalSilenceTrimCount }
      : {}),
    ...(tailTreatment ? { tailTreatment } : {}),
    ...(sliceTranscriptText ? { transcriptText: sliceTranscriptText } : {}),
    ...(sliceTranscriptSegments.length > 0
      ? {
          transcriptSegments: sliceTranscriptSegments,
          transcriptSegmentCount: sliceTranscriptSegments.length,
        }
      : {}),
    ...(plannedClip?.transcriptCoverageScore !== undefined
      ? { transcriptCoverageScore: plannedClip.transcriptCoverageScore }
      : {}),
    ...(plannedClip?.speechContinuityGrade ? { speechContinuityGrade: plannedClip.speechContinuityGrade } : {}),
  };

  return {
    ...sliceResult,
    name: sliceName,
    artifactPath: nativeSlice.artifactPath,
    taskOutputDir: nativeSlice.taskOutputDir,
  };
}

export function normalizeSmartSliceRenderableSourceSegments(
  sourceSegments: readonly { startMs: number; endMs: number }[] | undefined,
  sourceStartMs: number,
  sourceEndMs: number,
) {
  const trimmedSourceSegments = trimReviewedSmartSliceClipSourceSegmentsToRange(
    sourceSegments,
    sourceStartMs,
    sourceEndMs,
  );
  if (
    !trimmedSourceSegments ||
    trimmedSourceSegments.length <= 1 ||
    !doSmartSliceSourceSegmentsSpanSourceRange(trimmedSourceSegments, sourceStartMs, sourceEndMs) ||
    !areSmartSliceSourceSegmentsOrderedInsideRange(trimmedSourceSegments, sourceStartMs, sourceEndMs)
  ) {
    return undefined;
  }

  return trimmedSourceSegments;
}

function areSmartSliceSourceSegmentsOrderedInsideRange(
  sourceSegments: readonly { startMs: number; endMs: number }[],
  sourceStartMs: number,
  sourceEndMs: number,
) {
  let previousEndMs: number | undefined;
  return sourceSegments.every((segment) => {
    const segmentStartMs = Math.round(segment.startMs);
    const segmentEndMs = Math.round(segment.endMs);
    const isOrderedInsideRange = Number.isFinite(segmentStartMs) &&
      Number.isFinite(segmentEndMs) &&
      segmentEndMs > segmentStartMs &&
      segmentStartMs >= sourceStartMs &&
      segmentEndMs <= sourceEndMs &&
      (previousEndMs === undefined || segmentStartMs >= previousEndMs);
    previousEndMs = segmentEndMs;
    return isOrderedInsideRange;
  });
}

function normalizeSmartSliceRenderableTimelineEntrySourceSegments<
  T extends SmartSliceRenderableTimelineEntry,
>(
  entry: T,
  sourceStartMs: number,
  sourceEndMs: number,
): T {
  const normalizedSourceSegments = normalizeSmartSliceRenderableSourceSegments(
    entry.sourceSegments,
    sourceStartMs,
    sourceEndMs,
  );
  if (!normalizedSourceSegments || normalizedSourceSegments.length > MAX_SMART_SLICE_NATIVE_SOURCE_SEGMENTS) {
    const normalizedEntry = { ...entry };
    delete normalizedEntry.sourceSegments;
    delete normalizedEntry.renderedDurationMs;
    delete normalizedEntry.removedSilenceMs;
    delete normalizedEntry.internalSilenceTrimCount;
    return normalizedEntry;
  }

  const renderedDurationMs = normalizedSourceSegments.reduce(
    (durationMs, segment) => durationMs + Math.max(0, segment.endMs - segment.startMs),
    0,
  );
  return {
    ...entry,
    sourceSegments: normalizedSourceSegments,
    renderedDurationMs,
    removedSilenceMs: Math.max(0, sourceEndMs - sourceStartMs - renderedDurationMs),
    internalSilenceTrimCount: normalizedSourceSegments.length - 1,
  };
}

function normalizeSmartSliceRenderableArtifactSourceSegments(
  sourceSegments: readonly { startMs: number; endMs: number }[] | undefined,
  sourceStartMs: number,
  sourceEndMs: number,
  artifactDurationMs: number | undefined,
  speechEvidence?: Pick<
    NormalizedSlicePlanClip | TaskSliceResult,
    | 'speechStartMs'
    | 'speechEndMs'
    | 'audioActivityStartMs'
    | 'audioActivityEndMs'
    | 'audioActivityConfidence'
    | 'audioActivityAnalysisFilter'
    | 'noiseReductionApplied'
  >,
  transcriptSegments: readonly AutoCutTranscriptSegment[] = [],
) {
  const normalizedSourceSegments = normalizeSmartSliceRenderableSourceSegments(
    sourceSegments,
    sourceStartMs,
    sourceEndMs,
  );
  if (!normalizedSourceSegments || normalizedSourceSegments.length > MAX_SMART_SLICE_NATIVE_SOURCE_SEGMENTS) {
    return undefined;
  }

  const renderedDurationMs = normalizedSourceSegments.reduce(
    (durationMs, segment) => durationMs + Math.max(0, segment.endMs - segment.startMs),
    0,
  );
  if (
    typeof artifactDurationMs === 'number' &&
    Number.isFinite(artifactDurationMs) &&
    Math.abs(Math.round(artifactDurationMs) - renderedDurationMs) > 1
  ) {
    return undefined;
  }

  if (
    transcriptSegments.length > 0 &&
    speechEvidence &&
    !doesSmartSliceSourceSegmentsCoverSpeechEvidence(
      speechEvidence,
      normalizedSourceSegments,
      transcriptSegments,
    )
  ) {
    return undefined;
  }

  return normalizedSourceSegments;
}

function applySmartSliceRenderableSourceSegmentsToEntry<
  T extends SmartSliceRenderableTimelineEntry,
>(
  entry: T,
  sourceSegments: readonly { startMs: number; endMs: number }[] | undefined,
  sourceStartMs: number,
  sourceEndMs: number,
): T {
  if (!sourceSegments?.length) {
    const normalizedEntry = { ...entry };
    delete normalizedEntry.sourceSegments;
    delete normalizedEntry.renderedDurationMs;
    delete normalizedEntry.removedSilenceMs;
    delete normalizedEntry.internalSilenceTrimCount;
    return normalizedEntry;
  }

  const renderedDurationMs = sourceSegments.reduce(
    (durationMs, segment) => durationMs + Math.max(0, segment.endMs - segment.startMs),
    0,
  );
  return {
    ...entry,
    sourceSegments: [...sourceSegments],
    renderedDurationMs,
    removedSilenceMs: Math.max(0, sourceEndMs - sourceStartMs - renderedDurationMs),
    internalSilenceTrimCount: sourceSegments.length - 1,
  };
}

function normalizeSmartSlicePlannedClipSourceSegmentsForContinuousFallback(
  clip: NormalizedSlicePlanClip,
): NormalizedSlicePlanClip {
  const hadSourceSegmentEvidence = Array.isArray(clip.sourceSegments) && clip.sourceSegments.length > 0;
  const sourceStartMs = typeof clip.sourceStartMs === 'number' && Number.isFinite(clip.sourceStartMs)
    ? Math.max(0, Math.round(clip.sourceStartMs))
    : typeof clip.startMs === 'number' && Number.isFinite(clip.startMs)
      ? Math.max(0, Math.round(clip.startMs))
      : undefined;
  const sourceEndMs = sourceStartMs !== undefined &&
    typeof clip.sourceEndMs === 'number' &&
    Number.isFinite(clip.sourceEndMs)
    ? Math.max(sourceStartMs + 1, Math.round(clip.sourceEndMs))
    : sourceStartMs !== undefined &&
        typeof clip.startMs === 'number' &&
        typeof clip.durationMs === 'number' &&
        Number.isFinite(clip.startMs) &&
        Number.isFinite(clip.durationMs)
      ? Math.max(sourceStartMs + 1, Math.round(clip.startMs + clip.durationMs))
      : undefined;
  if (sourceStartMs === undefined || sourceEndMs === undefined) {
    return clip;
  }

  const normalizedClip = normalizeSmartSliceRenderableTimelineEntrySourceSegments(
    clip,
    sourceStartMs,
    sourceEndMs,
  );
  if (normalizedClip.sourceSegments?.length) {
    return normalizedClip;
  }
  if (!hadSourceSegmentEvidence) {
    return normalizedClip;
  }

  return {
    ...normalizedClip,
    startMs: sourceStartMs,
    durationMs: Math.max(1, sourceEndMs - sourceStartMs),
    sourceStartMs,
    sourceEndMs,
  };
}

function normalizeSmartSlicePlanSourceSegmentsForNativeRender(
  plannedClips: readonly NormalizedSlicePlanClip[],
): NormalizedSlicePlanClip[] {
  return plannedClips.map((clip) => normalizeSmartSlicePlannedClipSourceSegmentsForContinuousFallback(clip));
}

function normalizeNativeSliceArtifactSourceSegmentsForPlan(
  nativeSlice: AutoCutVideoSliceArtifactResult,
  plannedClip: NormalizedSlicePlanClip | undefined,
): AutoCutVideoSliceArtifactResult {
  if (!nativeSlice.sourceSegments?.length) {
    return nativeSlice;
  }

  const sourceStartMs = typeof nativeSlice.sourceStartMs === 'number' && Number.isFinite(nativeSlice.sourceStartMs)
    ? Math.max(0, Math.round(nativeSlice.sourceStartMs))
    : typeof plannedClip?.sourceStartMs === 'number' && Number.isFinite(plannedClip.sourceStartMs)
      ? Math.max(0, Math.round(plannedClip.sourceStartMs))
      : typeof nativeSlice.startMs === 'number' && Number.isFinite(nativeSlice.startMs)
        ? Math.max(0, Math.round(nativeSlice.startMs))
        : undefined;
  const sourceEndMs = sourceStartMs !== undefined &&
    typeof nativeSlice.sourceEndMs === 'number' &&
    Number.isFinite(nativeSlice.sourceEndMs)
    ? Math.max(sourceStartMs + 1, Math.round(nativeSlice.sourceEndMs))
    : sourceStartMs !== undefined &&
        typeof plannedClip?.sourceEndMs === 'number' &&
        Number.isFinite(plannedClip.sourceEndMs)
      ? Math.max(sourceStartMs + 1, Math.round(plannedClip.sourceEndMs))
      : sourceStartMs !== undefined &&
          typeof nativeSlice.durationMs === 'number' &&
          Number.isFinite(nativeSlice.durationMs)
        ? Math.max(sourceStartMs + 1, sourceStartMs + Math.round(nativeSlice.durationMs))
        : undefined;

  if (sourceStartMs === undefined || sourceEndMs === undefined) {
    return nativeSlice;
  }

  const sourceSegments = normalizeSmartSliceRenderableArtifactSourceSegments(
    nativeSlice.sourceSegments,
    sourceStartMs,
    sourceEndMs,
    nativeSlice.durationMs,
  );
  return applySmartSliceRenderableSourceSegmentsToEntry(
    nativeSlice,
    sourceSegments,
    sourceStartMs,
    sourceEndMs,
  );
}

function createVideoSliceTranscriptSegments(
  plannedClip: NormalizedSlicePlanClip | undefined,
  nativeSlice: AutoCutVideoSliceArtifactResult,
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
): AutoCutTranscriptSegment[] {
  const sourceStartMs = typeof nativeSlice.sourceStartMs === 'number' && Number.isFinite(nativeSlice.sourceStartMs)
    ? Math.max(0, Math.round(nativeSlice.sourceStartMs))
    : typeof plannedClip?.sourceStartMs === 'number' && Number.isFinite(plannedClip.sourceStartMs)
      ? Math.max(0, Math.round(plannedClip.sourceStartMs))
      : Math.round(nativeSlice.startMs);
  const sourceEndMs = typeof nativeSlice.sourceEndMs === 'number' && Number.isFinite(nativeSlice.sourceEndMs)
    ? Math.max(sourceStartMs + 1, Math.round(nativeSlice.sourceEndMs))
    : typeof plannedClip?.sourceEndMs === 'number' && Number.isFinite(plannedClip.sourceEndMs)
      ? Math.max(sourceStartMs + 1, Math.round(plannedClip.sourceEndMs))
      : Math.round(nativeSlice.startMs + nativeSlice.durationMs);
  if (!Number.isFinite(sourceStartMs) || !Number.isFinite(sourceEndMs) || sourceEndMs <= sourceStartMs) {
    return [];
  }
  const speechStartMs = typeof nativeSlice.speechStartMs === 'number' && Number.isFinite(nativeSlice.speechStartMs)
    ? Math.max(sourceStartMs, Math.min(Math.round(nativeSlice.speechStartMs), sourceEndMs))
    : typeof plannedClip?.speechStartMs === 'number' && Number.isFinite(plannedClip.speechStartMs)
      ? Math.max(sourceStartMs, Math.min(Math.round(plannedClip.speechStartMs), sourceEndMs))
      : sourceStartMs;
  const speechEndMs = typeof nativeSlice.speechEndMs === 'number' && Number.isFinite(nativeSlice.speechEndMs)
    ? Math.max(speechStartMs, Math.min(Math.round(nativeSlice.speechEndMs), sourceEndMs))
    : typeof plannedClip?.speechEndMs === 'number' && Number.isFinite(plannedClip.speechEndMs)
      ? Math.max(speechStartMs, Math.min(Math.round(plannedClip.speechEndMs), sourceEndMs))
      : sourceEndMs;
  if (speechEndMs <= speechStartMs) {
    return [];
  }

  const plannedClipTranscriptSegments = plannedClip?.transcriptSegments;
  if (Array.isArray(plannedClipTranscriptSegments) && plannedClipTranscriptSegments.length > 0) {
    const orderedPlannedSegments = plannedClipTranscriptSegments
      .filter((segment) =>
        segment.endMs > speechStartMs &&
        segment.startMs < speechEndMs &&
        normalizeSmartSliceTranscriptEvidenceText(segment.text).length > 0
      )
      .map((segment) => ({
        startMs: Math.max(speechStartMs, Math.round(segment.startMs)),
        endMs: Math.min(speechEndMs, Math.round(segment.endMs)),
        text: normalizeSmartSliceTranscriptEvidenceText(segment.text),
        ...(segment.speaker?.trim() ? { speaker: segment.speaker.trim() } : {}),
      }))
      .filter((segment) => segment.endMs > segment.startMs && segment.text.length > 0)
      .sort((firstSegment, secondSegment) =>
        firstSegment.startMs - secondSegment.startMs ||
        firstSegment.endMs - secondSegment.endMs,
      );
    if (orderedPlannedSegments.length > 0) {
      return repairLightlyOverlappingVideoSliceTranscriptSegments(orderedPlannedSegments);
    }
  }

  const orderedSegments = transcriptSegments
    .filter((segment) =>
      segment.endMs > speechStartMs &&
      segment.startMs < speechEndMs &&
      normalizeSmartSliceTranscriptEvidenceText(segment.text).length > 0
    )
    .map((segment) => ({
      startMs: Math.max(speechStartMs, Math.round(segment.startMs)),
      endMs: Math.min(speechEndMs, Math.round(segment.endMs)),
      text: normalizeSmartSliceTranscriptEvidenceText(segment.text),
      ...(segment.speaker?.trim() ? { speaker: segment.speaker.trim() } : {}),
    }))
    .filter((segment) => segment.endMs > segment.startMs && segment.text.length > 0)
    .sort((firstSegment, secondSegment) =>
      firstSegment.startMs - secondSegment.startMs ||
      firstSegment.endMs - secondSegment.endMs,
    );

  return repairLightlyOverlappingVideoSliceTranscriptSegments(orderedSegments);
}

function createVideoSliceBoundaryTranscriptSegments(
  plannedClip: NormalizedSlicePlanClip,
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
): AutoCutTranscriptSegment[] {
  const sourceStartMs = typeof plannedClip.sourceStartMs === 'number' && Number.isFinite(plannedClip.sourceStartMs)
    ? Math.round(plannedClip.sourceStartMs)
    : Math.round(plannedClip.startMs);
  const sourceEndMs = typeof plannedClip.sourceEndMs === 'number' && Number.isFinite(plannedClip.sourceEndMs)
    ? Math.round(plannedClip.sourceEndMs)
    : Math.round(plannedClip.startMs + plannedClip.durationMs);
  if (!Number.isFinite(sourceStartMs) || !Number.isFinite(sourceEndMs) || sourceEndMs <= sourceStartMs) {
    return [];
  }

  const hasRenderableSpeechRange =
    typeof plannedClip.speechStartMs === 'number' &&
    typeof plannedClip.speechEndMs === 'number' &&
    Number.isFinite(plannedClip.speechStartMs) &&
    Number.isFinite(plannedClip.speechEndMs) &&
    plannedClip.speechEndMs > plannedClip.speechStartMs;
  const selectionStartMs = hasRenderableSpeechRange ? Math.round(plannedClip.speechStartMs as number) : sourceStartMs;
  const selectionEndMs = hasRenderableSpeechRange ? Math.round(plannedClip.speechEndMs as number) : sourceEndMs;
  if (selectionEndMs <= selectionStartMs) {
    return [];
  }

  const orderedSegments = transcriptSegments
    .filter((segment) => {
      const normalizedText = normalizeSmartSliceTranscriptEvidenceText(segment.text);
      if (!normalizedText) {
        return false;
      }
      const overlapsSelectedSpeech = segment.endMs > selectionStartMs && segment.startMs < selectionEndMs;
      const fullyInsideSource = segment.startMs >= sourceStartMs && segment.endMs <= sourceEndMs;
      const sourceCutsThroughSegment =
        (segment.startMs < sourceStartMs && segment.endMs > sourceStartMs) ||
        (segment.startMs < sourceEndMs && segment.endMs > sourceEndMs);
      return overlapsSelectedSpeech && (fullyInsideSource || sourceCutsThroughSegment);
    })
    .map((segment) => ({
      startMs: Math.max(0, Math.round(segment.startMs)),
      endMs: Math.max(0, Math.round(segment.endMs)),
      text: normalizeSmartSliceTranscriptEvidenceText(segment.text),
      ...(segment.speaker?.trim() ? { speaker: segment.speaker.trim() } : {}),
    }))
    .filter((segment) => segment.endMs > segment.startMs && segment.text.length > 0)
    .sort((firstSegment, secondSegment) =>
      firstSegment.startMs - secondSegment.startMs ||
      firstSegment.endMs - secondSegment.endMs,
    );

  return repairLightlyOverlappingVideoSliceTranscriptSegments(orderedSegments);
}

function createSmartSliceSilenceCompactedClip(
  clip: NormalizedSlicePlanClip,
  clipTranscriptSegments: readonly AutoCutTranscriptSegment[],
  audioActivityAnalysis?: SmartSliceAudioActivityAnalysisResult['analyses'][number],
): NormalizedSlicePlanClip {
  if (
    clip.sourceSegments &&
    clip.sourceSegments.length > 1 &&
    clip.renderedDurationMs !== undefined &&
    clip.removedSilenceMs !== undefined &&
    clip.internalSilenceTrimCount !== undefined
  ) {
    return clip;
  }

  const audioActivitySourceSegments = createSmartSliceAudioActivitySourceSegments(clip, audioActivityAnalysis);
  const transcriptSourceSegments = createSmartSliceSpeechSourceSegments(clip, clipTranscriptSegments);
  const sourceSegments = doesSmartSliceSourceSegmentsCoverSpeechEvidence(
    clip,
    audioActivitySourceSegments,
    clipTranscriptSegments,
  )
    ? audioActivitySourceSegments
    : transcriptSourceSegments;
  if (sourceSegments.length <= 1) {
    return clip;
  }

  const sourceStartMs = sourceSegments[0]?.startMs ?? clip.sourceStartMs ?? clip.startMs;
  const sourceEndMs = sourceSegments.at(-1)?.endMs ?? clip.sourceEndMs ?? clip.startMs + clip.durationMs;
  const renderedDurationMs = sourceSegments.reduce(
    (durationMs, segment) => durationMs + Math.max(0, segment.endMs - segment.startMs),
    0,
  );
  const originalSourceDurationMs = Math.max(0, sourceEndMs - sourceStartMs);
  const removedSilenceMs = Math.max(0, originalSourceDurationMs - renderedDurationMs);
  if (renderedDurationMs <= 0 || removedSilenceMs <= 0) {
    return clip;
  }
  const speechStartMs = typeof clip.speechStartMs === 'number'
    ? Math.max(sourceStartMs, Math.min(Math.round(clip.speechStartMs), sourceEndMs))
    : sourceStartMs;
  const speechEndMs = typeof clip.speechEndMs === 'number'
    ? Math.max(speechStartMs, Math.min(Math.round(clip.speechEndMs), sourceEndMs))
    : sourceEndMs;
  if (speechEndMs <= speechStartMs) {
    return clip;
  }

  const risks = mergeSmartSliceServiceRisks(clip.risks, ['internal-silence-trimmed']);
  return {
    ...clip,
    startMs: sourceStartMs,
    durationMs: originalSourceDurationMs,
    sourceStartMs,
    sourceEndMs,
    speechStartMs,
    speechEndMs,
    boundaryPaddingBeforeMs: Math.max(0, speechStartMs - sourceStartMs),
    boundaryPaddingAfterMs: Math.max(0, sourceEndMs - speechEndMs),
    sourceSegments,
    renderedDurationMs,
    removedSilenceMs,
    internalSilenceTrimCount: sourceSegments.length - 1,
    ...(risks ? { risks } : {}),
  };
}

function isSmartSliceTimeRangeCoveredBySourceSegments(
  startMs: number,
  endMs: number,
  sourceSegments: readonly { startMs: number; endMs: number }[],
) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return false;
  }

  const normalizedStartMs = Math.round(startMs);
  const normalizedEndMs = Math.round(endMs);
  const coverageRanges = sourceSegments
    .filter((sourceSegment) =>
      Number.isFinite(sourceSegment.startMs) &&
        Number.isFinite(sourceSegment.endMs) &&
        sourceSegment.endMs > sourceSegment.startMs
    )
    .map((sourceSegment) => ({
      startMs: Math.max(normalizedStartMs, Math.round(sourceSegment.startMs)),
      endMs: Math.min(normalizedEndMs, Math.round(sourceSegment.endMs)),
    }))
    .filter((sourceSegment) => sourceSegment.endMs > sourceSegment.startMs)
    .sort((firstSegment, secondSegment) =>
      firstSegment.startMs - secondSegment.startMs ||
        firstSegment.endMs - secondSegment.endMs,
    );

  let coveredUntilMs = normalizedStartMs;
  for (const range of coverageRanges) {
    if (range.endMs <= coveredUntilMs) {
      continue;
    }
    if (range.startMs > coveredUntilMs + SMART_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS) {
      return false;
    }
    coveredUntilMs = Math.max(coveredUntilMs, range.endMs);
    if (coveredUntilMs >= normalizedEndMs - SMART_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS) {
      return true;
    }
  }

  return coveredUntilMs >= normalizedEndMs - SMART_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS;
}

function hasTrustedSmartSliceAudioActivityEvidence(
  value: Pick<
    NormalizedSlicePlanClip | TaskSliceResult,
    | 'audioActivityStartMs'
    | 'audioActivityEndMs'
    | 'audioActivityConfidence'
    | 'audioActivityAnalysisFilter'
    | 'noiseReductionApplied'
  >,
) {
  const expectedAnalysisFilter = typeof value.noiseReductionApplied === 'boolean'
    ? getSmartSliceRequiredAudioActivityAnalysisFilter(value.noiseReductionApplied)
    : undefined;
  const audioActivityAnalysisFilter = typeof value.audioActivityAnalysisFilter === 'string'
    ? value.audioActivityAnalysisFilter.trim()
    : '';
  const hasTrustedAnalysisFilter = expectedAnalysisFilter !== undefined
    ? audioActivityAnalysisFilter === expectedAnalysisFilter
    : audioActivityAnalysisFilter === SMART_SLICE_REQUIRED_AUDIO_ACTIVITY_ANALYSIS_FILTER ||
      audioActivityAnalysisFilter === SMART_SLICE_RAW_AUDIO_ACTIVITY_ANALYSIS_FILTER;

  return typeof value.audioActivityStartMs === 'number' &&
    typeof value.audioActivityEndMs === 'number' &&
    typeof value.audioActivityConfidence === 'number' &&
    Number.isFinite(value.audioActivityStartMs) &&
    Number.isFinite(value.audioActivityEndMs) &&
    Number.isFinite(value.audioActivityConfidence) &&
    value.audioActivityEndMs > value.audioActivityStartMs &&
    value.audioActivityConfidence >= MIN_SMART_SLICE_AUDIO_ACTIVITY_CONFIDENCE &&
    hasTrustedAnalysisFilter;
}

function createTrustedAudioBoundedTranscriptCoverageRange(
  clip: Pick<
    NormalizedSlicePlanClip | TaskSliceResult,
    | 'audioActivityStartMs'
    | 'audioActivityEndMs'
    | 'audioActivityConfidence'
    | 'audioActivityAnalysisFilter'
    | 'noiseReductionApplied'
  >,
  transcriptSegment: Pick<AutoCutTranscriptSegment, 'startMs' | 'endMs'>,
) {
  const segmentStartMs = Math.round(transcriptSegment.startMs);
  const segmentEndMs = Math.round(transcriptSegment.endMs);
  if (
    !Number.isFinite(segmentStartMs) ||
    !Number.isFinite(segmentEndMs) ||
    segmentEndMs <= segmentStartMs ||
    !hasTrustedSmartSliceAudioActivityEvidence(clip)
  ) {
    return { startMs: segmentStartMs, endMs: segmentEndMs };
  }

  const audioActivityStartMs = typeof clip.audioActivityStartMs === 'number'
    ? Math.round(clip.audioActivityStartMs)
    : segmentStartMs;
  const audioActivityEndMs = typeof clip.audioActivityEndMs === 'number'
    ? Math.round(clip.audioActivityEndMs)
    : segmentEndMs;
  const audioOverlapStartMs = Math.max(segmentStartMs, audioActivityStartMs);
  const audioOverlapEndMs = Math.min(segmentEndMs, audioActivityEndMs);
  const audioOverlapMs = Math.max(0, audioOverlapEndMs - audioOverlapStartMs);
  const segmentDurationMs = segmentEndMs - segmentStartMs;
  const safeAudioTrim =
    audioOverlapMs > 0 &&
    audioOverlapMs / segmentDurationMs >= MIN_SMART_SLICE_TRUSTED_AUDIO_SOURCE_SEGMENT_RETAINED_RATIO;

  return safeAudioTrim
    ? { startMs: audioOverlapStartMs, endMs: audioOverlapEndMs }
    : { startMs: segmentStartMs, endMs: segmentEndMs };
}

function doesSmartSliceTrustedAudioCompactedSourceSegmentsCoverTranscriptRange(
  clip: Pick<
    NormalizedSlicePlanClip | TaskSliceResult,
    | 'audioActivityStartMs'
    | 'audioActivityEndMs'
    | 'audioActivityConfidence'
    | 'audioActivityAnalysisFilter'
    | 'noiseReductionApplied'
  >,
  sourceSegments: readonly { startMs: number; endMs: number }[],
  transcriptSegment: Pick<AutoCutTranscriptSegment, 'startMs' | 'endMs'>,
) {
  if (sourceSegments.length <= 1 || !hasTrustedSmartSliceAudioActivityEvidence(clip)) {
    return false;
  }

  const coverageRange = createTrustedAudioBoundedTranscriptCoverageRange(clip, transcriptSegment);
  if (
    !Number.isFinite(coverageRange.startMs) ||
    !Number.isFinite(coverageRange.endMs) ||
    coverageRange.endMs <= coverageRange.startMs
  ) {
    return false;
  }

  const retainedCoverageMs = sourceSegments.reduce(
    (durationMs, sourceSegment) =>
      durationMs + Math.max(
        0,
        Math.min(coverageRange.endMs, Math.round(sourceSegment.endMs)) -
          Math.max(coverageRange.startMs, Math.round(sourceSegment.startMs)),
      ),
    0,
  );
  const coverageDurationMs = coverageRange.endMs - coverageRange.startMs;
  if (
    retainedCoverageMs / coverageDurationMs < MIN_SMART_SLICE_TRUSTED_AUDIO_SOURCE_SEGMENT_RETAINED_RATIO
  ) {
    return false;
  }

  const firstCoveringSegment = sourceSegments.find((sourceSegment) =>
    sourceSegment.endMs > coverageRange.startMs
  );
  const lastCoveringSegment = sourceSegments
    .slice()
    .reverse()
    .find((sourceSegment) => sourceSegment.startMs < coverageRange.endMs);

  return firstCoveringSegment !== undefined &&
    lastCoveringSegment !== undefined &&
    firstCoveringSegment.startMs <= coverageRange.startMs + SMART_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS &&
    lastCoveringSegment.endMs >= coverageRange.endMs - SMART_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS;
}

function doesSmartSliceSourceSegmentsCoverTranscriptEvidence(
  clip: Pick<
    NormalizedSlicePlanClip | TaskSliceResult,
    | 'audioActivityStartMs'
    | 'audioActivityEndMs'
    | 'audioActivityConfidence'
    | 'audioActivityAnalysisFilter'
    | 'noiseReductionApplied'
  >,
  sourceSegments: readonly { startMs: number; endMs: number }[],
  transcriptSegments: readonly AutoCutTranscriptSegment[] = [],
) {
  if (sourceSegments.length <= 1 || transcriptSegments.length === 0) {
    return false;
  }

  const sourceStartMs = sourceSegments[0]?.startMs;
  const sourceEndMs = sourceSegments.at(-1)?.endMs;
  if (
    typeof sourceStartMs !== 'number' ||
    typeof sourceEndMs !== 'number' ||
    !Number.isFinite(sourceStartMs) ||
    !Number.isFinite(sourceEndMs) ||
    sourceEndMs <= sourceStartMs
  ) {
    return false;
  }

  return transcriptSegments.every((segment) =>
    !normalizeSmartSliceTranscriptEvidenceText(segment.text) ||
      (() => {
        const coverageRange = createTrustedAudioBoundedTranscriptCoverageRange(clip, segment);
        return isSmartSliceTimeRangeCoveredBySourceSegments(
          coverageRange.startMs,
          coverageRange.endMs,
          sourceSegments,
        ) ||
          doesSmartSliceTrustedAudioCompactedSourceSegmentsCoverTranscriptRange(
            clip,
            sourceSegments,
            segment,
          );
      })()
  );
}

function doesSmartSliceSourceSegmentsCoverSpeechEvidence(
  clip: Pick<
    NormalizedSlicePlanClip | TaskSliceResult,
    | 'speechStartMs'
    | 'speechEndMs'
    | 'audioActivityStartMs'
    | 'audioActivityEndMs'
    | 'audioActivityConfidence'
    | 'audioActivityAnalysisFilter'
    | 'noiseReductionApplied'
  >,
  sourceSegments: readonly { startMs: number; endMs: number }[],
  transcriptSegments: readonly AutoCutTranscriptSegment[] = [],
) {
  if (sourceSegments.length <= 1) {
    return false;
  }
  const sourceStartMs = sourceSegments[0]?.startMs;
  const sourceEndMs = sourceSegments.at(-1)?.endMs;
  if (
    typeof sourceStartMs !== 'number' ||
    typeof sourceEndMs !== 'number' ||
    sourceEndMs <= sourceStartMs
  ) {
    return false;
  }
  if (
    typeof clip.speechStartMs !== 'number' ||
    typeof clip.speechEndMs !== 'number' ||
    !Number.isFinite(clip.speechStartMs) ||
    !Number.isFinite(clip.speechEndMs)
  ) {
    return true;
  }

  const coversSpeechRange = clip.speechEndMs > clip.speechStartMs &&
    clip.speechStartMs >= sourceStartMs &&
    clip.speechEndMs <= sourceEndMs;
  if (!coversSpeechRange) {
    return false;
  }

  return transcriptSegments.length === 0 ||
    doesSmartSliceSourceSegmentsCoverTranscriptEvidence(clip, sourceSegments, transcriptSegments);
}

function canExpandSmartSliceSourceRangeToTranscriptBoundary(
  clip: Pick<
    NormalizedSlicePlanClip | TaskSliceResult,
    | 'audioActivityStartMs'
    | 'audioActivityEndMs'
    | 'audioActivityConfidence'
    | 'audioActivityAnalysisFilter'
    | 'noiseReductionApplied'
  >,
  sourceStartMs: number,
  sourceEndMs: number,
) {
  if (!hasTrustedSmartSliceAudioActivityEvidence(clip)) {
    return true;
  }

  const audioActivityStartMs = Math.round(clip.audioActivityStartMs as number);
  const audioActivityEndMs = Math.round(clip.audioActivityEndMs as number);
  return audioActivityStartMs >= sourceStartMs &&
    audioActivityEndMs <= sourceEndMs &&
    audioActivityStartMs - sourceStartMs <= MAX_SMART_SLICE_LEADING_SILENCE_MS &&
    sourceEndMs - audioActivityEndMs <= MAX_SMART_SLICE_TRAILING_SILENCE_MS;
}

function refreshTrustedSmartSliceAudioActivityPaddingEvidence<T extends NormalizedSlicePlanClip>(clip: T): T {
  if (!hasTrustedSmartSliceAudioActivityEvidence(clip)) {
    return clip;
  }

  const sourceStartMs = typeof clip.sourceStartMs === 'number' && Number.isFinite(clip.sourceStartMs)
    ? Math.max(0, Math.round(clip.sourceStartMs))
    : Math.max(0, Math.round(clip.startMs));
  const sourceEndMs = typeof clip.sourceEndMs === 'number' && Number.isFinite(clip.sourceEndMs)
    ? Math.max(sourceStartMs, Math.round(clip.sourceEndMs))
    : Math.max(sourceStartMs, Math.round(clip.startMs + clip.durationMs));
  const audioActivityStartMs = Math.round(clip.audioActivityStartMs as number);
  const audioActivityEndMs = Math.round(clip.audioActivityEndMs as number);
  if (
    audioActivityStartMs < sourceStartMs ||
    audioActivityEndMs > sourceEndMs ||
    audioActivityEndMs <= audioActivityStartMs
  ) {
    return clip;
  }

  const leadingSilenceMs = audioActivityStartMs - sourceStartMs;
  const trailingSilenceMs = sourceEndMs - audioActivityEndMs;
  if (
    clip.leadingSilenceMs === leadingSilenceMs &&
    clip.trailingSilenceMs === trailingSilenceMs
  ) {
    return clip;
  }

  return {
    ...clip,
    leadingSilenceMs,
    trailingSilenceMs,
  };
}

function stripTrustedSmartSliceAudioActivityEvidence<T extends NormalizedSlicePlanClip>(clip: T): T {
  const strippedClip = { ...clip };
  delete strippedClip.audioCleanupProfile;
  delete strippedClip.noiseReductionApplied;
  delete strippedClip.boundaryDecisionSource;
  delete strippedClip.audioActivityStartMs;
  delete strippedClip.audioActivityEndMs;
  delete strippedClip.audioActivityConfidence;
  delete strippedClip.audioActivityAnalysisFilter;
  delete strippedClip.leadingSilenceMs;
  delete strippedClip.trailingSilenceMs;
  delete strippedClip.leadingSilenceTrimMs;
  delete strippedClip.trailingSilenceTrimMs;
  delete strippedClip.tailTreatment;
  return strippedClip;
}

function repairTrustedSmartSliceAudioActivityPaddingForNativeRender(
  clip: NormalizedSlicePlanClip,
): NormalizedSlicePlanClip {
  if (!hasTrustedSmartSliceAudioActivityEvidence(clip)) {
    return clip;
  }

  const currentStartMs = typeof clip.startMs === 'number' && Number.isFinite(clip.startMs)
    ? Math.max(0, Math.round(clip.startMs))
    : 0;
  const currentEndMs = currentStartMs + Math.max(0, Math.round(clip.durationMs));
  const sourceStartMs = typeof clip.sourceStartMs === 'number' && Number.isFinite(clip.sourceStartMs)
    ? Math.max(0, Math.round(clip.sourceStartMs))
    : currentStartMs;
  const sourceEndMs = typeof clip.sourceEndMs === 'number' && Number.isFinite(clip.sourceEndMs)
    ? Math.max(sourceStartMs, Math.round(clip.sourceEndMs))
    : Math.max(sourceStartMs, currentEndMs);
  const audioActivityStartMs = Math.round(clip.audioActivityStartMs as number);
  const audioActivityEndMs = Math.round(clip.audioActivityEndMs as number);
  if (
    currentEndMs <= currentStartMs ||
    sourceEndMs <= sourceStartMs ||
    audioActivityEndMs <= audioActivityStartMs ||
    audioActivityStartMs < sourceStartMs ||
    audioActivityEndMs > sourceEndMs
  ) {
    return refreshTrustedSmartSliceAudioActivityPaddingEvidence(clip);
  }

  const targetSourceStartMs = Math.max(
    sourceStartMs,
    audioActivityStartMs - MAX_SMART_SLICE_LEADING_SILENCE_MS,
  );
  const targetSourceEndMs = Math.min(
    sourceEndMs,
    audioActivityEndMs + MAX_SMART_SLICE_TRAILING_SILENCE_MS,
  );
  const timingAlreadyReady =
    targetSourceStartMs === sourceStartMs &&
    targetSourceEndMs === sourceEndMs;
  if (timingAlreadyReady) {
    return refreshTrustedSmartSliceAudioActivityPaddingEvidence(clip);
  }
  if (
    targetSourceEndMs <= targetSourceStartMs ||
    audioActivityStartMs < targetSourceStartMs ||
    audioActivityEndMs > targetSourceEndMs
  ) {
    return refreshTrustedSmartSliceAudioActivityPaddingEvidence(clip);
  }

  const clipTranscriptSegments = Array.isArray(clip.transcriptSegments)
    ? clip.transcriptSegments
    : [];
  const wouldTrimTranscriptCoverage = clipTranscriptSegments.some((segment) => {
    const segmentStartMs = Math.round(segment.startMs);
    const segmentEndMs = Math.round(segment.endMs);
    const normalizedText = normalizeSmartSliceTranscriptEvidenceText(segment.text);
    if (
      !normalizedText ||
      !Number.isFinite(segmentStartMs) ||
      !Number.isFinite(segmentEndMs) ||
      segmentEndMs <= segmentStartMs
    ) {
      return false;
    }

    const sourceClippedStartMs = Math.max(segmentStartMs, targetSourceStartMs);
    const sourceClippedEndMs = Math.min(segmentEndMs, targetSourceEndMs);
    const sourceClippedDurationMs = Math.max(0, sourceClippedEndMs - sourceClippedStartMs);
    if (
      sourceClippedDurationMs > 0 &&
      sourceClippedDurationMs / (segmentEndMs - segmentStartMs) >=
        MIN_SMART_SLICE_TRUSTED_AUDIO_SOURCE_SEGMENT_RETAINED_RATIO
    ) {
      return false;
    }

    return segmentStartMs < targetSourceStartMs - SMART_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS ||
      segmentEndMs > targetSourceEndMs + SMART_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS;
  });
  if (wouldTrimTranscriptCoverage) {
    return stripTrustedSmartSliceAudioActivityEvidence(clip);
  }

  const speechStartMs = typeof clip.speechStartMs === 'number' && Number.isFinite(clip.speechStartMs)
    ? Math.max(targetSourceStartMs, Math.min(Math.round(clip.speechStartMs), targetSourceEndMs))
    : targetSourceStartMs;
  const speechEndMs = typeof clip.speechEndMs === 'number' && Number.isFinite(clip.speechEndMs)
    ? Math.max(speechStartMs, Math.min(Math.round(clip.speechEndMs), targetSourceEndMs))
    : targetSourceEndMs;
  const trimmedSourceSegments = trimReviewedSmartSliceClipSourceSegmentsToRange(
    clip.sourceSegments,
    targetSourceStartMs,
    targetSourceEndMs,
  );
  const sourceSegments = trimmedSourceSegments && trimmedSourceSegments.length > 1
    ? trimmedSourceSegments
    : undefined;
  const renderedDurationMs = sourceSegments
    ? sourceSegments.reduce((durationMs, segment) => durationMs + Math.max(0, segment.endMs - segment.startMs), 0)
    : undefined;
  const removedSilenceMs = renderedDurationMs !== undefined
    ? Math.max(0, targetSourceEndMs - targetSourceStartMs - renderedDurationMs)
    : undefined;
  const risks = mergeSmartSliceServiceRisks(
    clip.risks,
    ['audio-activity-padding-repaired'],
  );
  const repairedClip: NormalizedSlicePlanClip = {
    ...clip,
    startMs: targetSourceStartMs,
    durationMs: targetSourceEndMs - targetSourceStartMs,
    sourceStartMs: targetSourceStartMs,
    sourceEndMs: targetSourceEndMs,
    speechStartMs,
    speechEndMs,
    boundaryPaddingBeforeMs: Math.max(0, speechStartMs - targetSourceStartMs),
    boundaryPaddingAfterMs: Math.max(0, targetSourceEndMs - speechEndMs),
    leadingSilenceMs: audioActivityStartMs - targetSourceStartMs,
    trailingSilenceMs: targetSourceEndMs - audioActivityEndMs,
    leadingSilenceTrimMs: Math.max(0, (clip.leadingSilenceTrimMs ?? 0) + targetSourceStartMs - sourceStartMs),
    trailingSilenceTrimMs: Math.max(0, (clip.trailingSilenceTrimMs ?? 0) + sourceEndMs - targetSourceEndMs),
    ...(risks ? { risks } : {}),
  };
  if (sourceSegments) {
    repairedClip.sourceSegments = sourceSegments;
    if (renderedDurationMs !== undefined) {
      repairedClip.renderedDurationMs = renderedDurationMs;
    }
    if (removedSilenceMs !== undefined) {
      repairedClip.removedSilenceMs = removedSilenceMs;
    }
    repairedClip.internalSilenceTrimCount = sourceSegments.length - 1;
  } else {
    delete repairedClip.sourceSegments;
    delete repairedClip.renderedDurationMs;
    delete repairedClip.removedSilenceMs;
    delete repairedClip.internalSilenceTrimCount;
  }
  delete repairedClip.transcriptText;
  delete repairedClip.transcriptSegments;
  delete repairedClip.transcriptSegmentTexts;
  delete repairedClip.transcriptSegmentCount;
  delete repairedClip.transcriptCoverageScore;
  delete repairedClip.speechContinuityGrade;
  return repairedClip;
}

function normalizeTrustedSmartSliceAudioActivityEvidenceForNativeRender(
  clip: NormalizedSlicePlanClip,
): NormalizedSlicePlanClip {
  if (!hasTrustedSmartSliceAudioActivityEvidence(clip)) {
    return clip;
  }

  const sourceStartMs = typeof clip.sourceStartMs === 'number' && Number.isFinite(clip.sourceStartMs)
    ? Math.max(0, Math.round(clip.sourceStartMs))
    : Math.max(0, Math.round(clip.startMs));
  const sourceEndMs = typeof clip.sourceEndMs === 'number' && Number.isFinite(clip.sourceEndMs)
    ? Math.max(sourceStartMs + 1, Math.round(clip.sourceEndMs))
    : Math.max(sourceStartMs + 1, Math.round(clip.startMs + clip.durationMs));
  const audioActivityStartMs = Math.max(
    sourceStartMs,
    Math.min(Math.round(clip.audioActivityStartMs as number), sourceEndMs),
  );
  const audioActivityEndMs = Math.max(
    audioActivityStartMs,
    Math.min(Math.round(clip.audioActivityEndMs as number), sourceEndMs),
  );
  if (audioActivityEndMs <= audioActivityStartMs) {
    return stripTrustedSmartSliceAudioActivityEvidence(clip);
  }

  return {
    ...clip,
    sourceStartMs,
    sourceEndMs,
    audioActivityStartMs,
    audioActivityEndMs,
    leadingSilenceMs: audioActivityStartMs - sourceStartMs,
    trailingSilenceMs: sourceEndMs - audioActivityEndMs,
    leadingSilenceTrimMs: Math.max(0, Math.round(clip.leadingSilenceTrimMs ?? 0)),
    trailingSilenceTrimMs: Math.max(0, Math.round(clip.trailingSilenceTrimMs ?? 0)),
  };
}

function mergeSmartSliceServiceRisks(...riskGroups: (readonly string[] | undefined)[]) {
  const risks: string[] = [];
  const seen = new Set<string>();
  for (const group of riskGroups) {
    for (const risk of group ?? []) {
      const normalizedRisk = risk.trim();
      if (!normalizedRisk || seen.has(normalizedRisk)) {
        continue;
      }

      seen.add(normalizedRisk);
      risks.push(normalizedRisk);
    }
  }

  return risks.length ? risks : undefined;
}

function repairLightlyOverlappingVideoSliceTranscriptSegments(
  transcriptSegments: readonly AutoCutTranscriptSegment[],
): AutoCutTranscriptSegment[] {
  const repairedSegments: AutoCutTranscriptSegment[] = [];

  for (const segment of transcriptSegments) {
    const previousSegment = repairedSegments.at(-1);
    if (!previousSegment || segment.startMs >= previousSegment.endMs) {
      repairedSegments.push(segment);
      continue;
    }

    const overlapMs = previousSegment.endMs - segment.startMs;
    if (overlapMs > MAX_SMART_SLICE_TRANSCRIPT_OVERLAP_REPAIR_MS) {
      repairedSegments.push(segment);
      continue;
    }

    const repairedSegment = {
      ...segment,
      startMs: previousSegment.endMs,
    };
    if (repairedSegment.endMs > repairedSegment.startMs) {
      repairedSegments.push(repairedSegment);
    }
  }

  return repairedSegments;
}

function createVideoSliceTranscriptText(transcriptSegments: readonly AutoCutTranscriptSegment[]) {
  return transcriptSegments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function createSmartSliceTranscriptEvidenceCoverageScore(
  transcriptSegments: readonly AutoCutTranscriptSegment[],
  speechStartMs: number,
  speechEndMs: number,
  sourceSegments?: readonly { startMs: number; endMs: number }[],
) {
  if (
    transcriptSegments.length === 0 ||
    !Number.isFinite(speechStartMs) ||
    !Number.isFinite(speechEndMs) ||
    speechEndMs <= speechStartMs
  ) {
    return 0;
  }

  const coverageRanges = transcriptSegments
    .map((segment) => ({
      startMs: Math.max(speechStartMs, Math.round(segment.startMs)),
      endMs: Math.min(speechEndMs, Math.round(segment.endMs)),
    }))
    .filter((segment) => segment.endMs > segment.startMs)
    .sort((firstSegment, secondSegment) =>
      firstSegment.startMs - secondSegment.startMs ||
      firstSegment.endMs - secondSegment.endMs,
    );
  const normalizedSourceSegments = sourceSegments
    ?.map((segment) => ({
      startMs: Math.max(speechStartMs, Math.round(segment.startMs)),
      endMs: Math.min(speechEndMs, Math.round(segment.endMs)),
    }))
    .filter((segment) => segment.endMs > segment.startMs)
    .sort((firstSegment, secondSegment) =>
      firstSegment.startMs - secondSegment.startMs ||
      firstSegment.endMs - secondSegment.endMs,
    ) ?? [];
  const denominatorDurationMs = normalizedSourceSegments.length > 1
    ? normalizedSourceSegments.reduce(
        (durationMs, segment) => durationMs + Math.max(0, segment.endMs - segment.startMs),
        0,
      )
    : speechEndMs - speechStartMs;
  if (denominatorDurationMs <= 0) {
    return 0;
  }

  const mergedRanges: Array<{ startMs: number; endMs: number }> = [];
  for (const range of coverageRanges) {
    const previousRange = mergedRanges.at(-1);
    if (!previousRange || range.startMs > previousRange.endMs) {
      mergedRanges.push({ ...range });
      continue;
    }

    previousRange.endMs = Math.max(previousRange.endMs, range.endMs);
  }

  const coveredDurationMs = mergedRanges.reduce(
    (durationMs, range) => durationMs + Math.max(0, range.endMs - range.startMs),
    0,
  );
  const coverageScore = coveredDurationMs / denominatorDurationMs;
  return Math.max(0, Math.min(1, Number(coverageScore.toFixed(2))));
}

function resolveSmartSliceTranscriptEvidenceContinuityGrade(
  clip: NormalizedSlicePlanClip,
  transcriptSegments: readonly AutoCutTranscriptSegment[],
  transcriptCoverageScore: number,
): NonNullable<NormalizedSlicePlanClip['speechContinuityGrade']> {
  if (
    transcriptSegments.length === 0 ||
    transcriptCoverageScore < MIN_SMART_SLICE_TRANSCRIPT_COVERAGE_SCORE
  ) {
    return 'weak';
  }

  const hasRepairEvidence =
    (clip.sourceSegments?.length ?? 0) > 1 ||
    (clip.internalSilenceTrimCount ?? 0) > 0 ||
    Boolean(clip.risks?.length);
  return hasRepairEvidence || transcriptCoverageScore < 0.85 ? 'repaired' : 'strong';
}

function removeSmartSliceRisk(
  risks: readonly string[] | undefined,
  riskToRemove: string,
) {
  const retainedRisks = risks?.filter((risk) => risk !== riskToRemove) ?? [];
  return retainedRisks.length ? retainedRisks : undefined;
}

function doSmartSliceSourceSegmentsSpanSourceRange(
  sourceSegments: readonly { startMs: number; endMs: number }[] | undefined,
  sourceStartMs: number,
  sourceEndMs: number,
) {
  if (!Array.isArray(sourceSegments) || sourceSegments.length === 0) {
    return true;
  }

  const firstSourceSegment = sourceSegments[0];
  const lastSourceSegment = sourceSegments.at(-1);
  return firstSourceSegment !== undefined &&
    lastSourceSegment !== undefined &&
    Math.round(firstSourceSegment.startMs) === sourceStartMs &&
    Math.round(lastSourceSegment.endMs) === sourceEndMs;
}

function removeSmartSliceSourceSegmentEvidence(
  clip: NormalizedSlicePlanClip,
): NormalizedSlicePlanClip {
  const repairedClip: NormalizedSlicePlanClip = { ...clip };
  const risks = removeSmartSliceRisk(clip.risks, 'internal-silence-trimmed');
  if (risks) {
    repairedClip.risks = risks;
  } else {
    delete repairedClip.risks;
  }
  delete repairedClip.sourceSegments;
  delete repairedClip.renderedDurationMs;
  delete repairedClip.removedSilenceMs;
  delete repairedClip.internalSilenceTrimCount;
  return repairedClip;
}

function refreshSmartSliceClipSourceSegmentsForTranscriptEvidence(
  clip: NormalizedSlicePlanClip,
  transcriptSegments: readonly AutoCutTranscriptSegment[],
): NormalizedSlicePlanClip {
  const sourceStartMs = typeof clip.sourceStartMs === 'number' && Number.isFinite(clip.sourceStartMs)
    ? Math.round(clip.sourceStartMs)
    : Math.round(clip.startMs);
  const sourceEndMs = typeof clip.sourceEndMs === 'number' && Number.isFinite(clip.sourceEndMs)
    ? Math.round(clip.sourceEndMs)
    : Math.round(clip.startMs + clip.durationMs);

  if (
    !Array.isArray(clip.sourceSegments) ||
    clip.sourceSegments.length <= 1
  ) {
    return clip;
  }
  if (
    doSmartSliceSourceSegmentsSpanSourceRange(clip.sourceSegments, sourceStartMs, sourceEndMs) &&
    doesSmartSliceSourceSegmentsCoverTranscriptEvidence(clip, clip.sourceSegments, transcriptSegments)
  ) {
    return clip;
  }

  const transcriptSourceSegments = createSmartSliceSpeechSourceSegments(clip, transcriptSegments);
  if (
    transcriptSourceSegments.length > 1 &&
    doSmartSliceSourceSegmentsSpanSourceRange(transcriptSourceSegments, sourceStartMs, sourceEndMs) &&
    doesSmartSliceSourceSegmentsCoverTranscriptEvidence(clip, transcriptSourceSegments, transcriptSegments)
  ) {
    const renderedDurationMs = transcriptSourceSegments.reduce(
      (durationMs, segment) => durationMs + Math.max(0, segment.endMs - segment.startMs),
      0,
    );
    const removedSilenceMs = Math.max(0, sourceEndMs - sourceStartMs - renderedDurationMs);
    const risks = mergeSmartSliceServiceRisks(clip.risks, ['internal-silence-trimmed']);
    return {
      ...clip,
      startMs: sourceStartMs,
      durationMs: Math.max(0, sourceEndMs - sourceStartMs),
      sourceStartMs,
      sourceEndMs,
      ...(typeof clip.speechStartMs === 'number'
        ? { boundaryPaddingBeforeMs: Math.max(0, Math.round(clip.speechStartMs) - sourceStartMs) }
        : {}),
      ...(typeof clip.speechEndMs === 'number'
        ? { boundaryPaddingAfterMs: Math.max(0, sourceEndMs - Math.round(clip.speechEndMs)) }
        : {}),
      sourceSegments: transcriptSourceSegments,
      renderedDurationMs,
      removedSilenceMs,
      internalSilenceTrimCount: transcriptSourceSegments.length - 1,
      ...(risks ? { risks } : {}),
    };
  }

  return removeSmartSliceSourceSegmentEvidence(clip);
}

export function refreshSmartSlicePlanTranscriptEvidence(
  plannedClips: readonly NormalizedSlicePlanClip[],
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
  sourceDurationMs?: number,
): NormalizedSlicePlanClip[] {
  const trustedSourceDurationMs =
    typeof sourceDurationMs === 'number' && Number.isFinite(sourceDurationMs) && sourceDurationMs > 0
      ? Math.round(sourceDurationMs)
      : undefined;
  const sourceBoundedTranscriptSegments = normalizeSmartSliceTranscriptTimelineForSourceDuration(
    transcriptSegments,
    trustedSourceDurationMs,
  );

  return plannedClips.map((clip) => {
    const sourceStartMs = typeof clip.sourceStartMs === 'number' && Number.isFinite(clip.sourceStartMs)
      ? Math.max(0, Math.round(clip.sourceStartMs))
      : typeof clip.startMs === 'number' && Number.isFinite(clip.startMs)
        ? Math.max(0, Math.round(clip.startMs))
        : undefined;
    const sourceEndMs = typeof clip.sourceEndMs === 'number' && Number.isFinite(clip.sourceEndMs)
      ? Math.max(sourceStartMs ?? 0, Math.round(clip.sourceEndMs))
      : sourceStartMs !== undefined && typeof clip.durationMs === 'number' && Number.isFinite(clip.durationMs)
        ? Math.max(sourceStartMs, Math.round(clip.startMs + clip.durationMs))
        : undefined;
    const refreshedClip: NormalizedSlicePlanClip = { ...clip };
    const boundaryTranscriptSegments = createVideoSliceBoundaryTranscriptSegments(
      sourceStartMs !== undefined && sourceEndMs !== undefined
        ? { ...clip, sourceStartMs, sourceEndMs }
        : clip,
      sourceBoundedTranscriptSegments,
    );
    const hasNativeReadyExistingSpeechPadding =
      typeof refreshedClip.speechStartMs === 'number' &&
      typeof refreshedClip.speechEndMs === 'number' &&
      Number.isFinite(refreshedClip.speechStartMs) &&
      Number.isFinite(refreshedClip.speechEndMs) &&
      refreshedClip.speechEndMs > refreshedClip.speechStartMs &&
      sourceStartMs !== undefined &&
      sourceEndMs !== undefined &&
      refreshedClip.speechStartMs >= sourceStartMs &&
      refreshedClip.speechEndMs <= sourceEndMs &&
      refreshedClip.speechStartMs - sourceStartMs <= MAX_SMART_SLICE_LEADING_SILENCE_MS &&
      sourceEndMs - refreshedClip.speechEndMs <= MAX_SMART_SLICE_TRAILING_SILENCE_MS;
    const shouldPreserveExistingRenderReadyBoundary =
      !hasPostCleanupSmartSliceAudioEvidenceShape(refreshedClip) &&
      hasNativeReadyExistingSpeechPadding;
    const canTrustAudioTrimmedBoundaryTranscriptSegments =
      boundaryTranscriptSegments.length > 0 &&
      Array.isArray(refreshedClip.sourceSegments) &&
      refreshedClip.sourceSegments.length > 1 &&
      boundaryTranscriptSegments.every((segment) =>
        doesSmartSliceTrustedAudioCompactedSourceSegmentsCoverTranscriptRange(
          refreshedClip,
          refreshedClip.sourceSegments ?? [],
          segment,
        )
      );
    if (
      boundaryTranscriptSegments.length > 0 &&
      !canTrustAudioTrimmedBoundaryTranscriptSegments &&
      sourceStartMs !== undefined &&
      sourceEndMs !== undefined &&
      !shouldPreserveExistingRenderReadyBoundary
    ) {
      const renderedStartMs = Math.round(refreshedClip.startMs);
      const renderedEndMs = renderedStartMs + Math.max(0, Math.round(refreshedClip.durationMs));
      const boundarySpeechStartMs = Math.max(0, Math.round(boundaryTranscriptSegments[0]?.startMs ?? sourceStartMs));
      const boundarySpeechEndMs = Math.max(
        boundarySpeechStartMs,
        Math.round(boundaryTranscriptSegments.at(-1)?.endMs ?? sourceEndMs),
      );
      const expandedSourceStartMs = Math.min(sourceStartMs, boundarySpeechStartMs);
      const expandedSourceEndMs = Math.max(sourceEndMs, boundarySpeechEndMs);
      const canExpandSourceRange = canExpandSmartSliceSourceRangeToTranscriptBoundary(
        refreshedClip,
        expandedSourceStartMs,
        expandedSourceEndMs,
      );
      refreshedClip.startMs = canExpandSourceRange
        ? Math.min(renderedStartMs, boundarySpeechStartMs)
        : renderedStartMs;
      refreshedClip.durationMs = (canExpandSourceRange
        ? Math.max(renderedEndMs, sourceEndMs, boundarySpeechEndMs)
        : renderedEndMs) - refreshedClip.startMs;
      refreshedClip.sourceStartMs = canExpandSourceRange ? expandedSourceStartMs : sourceStartMs;
      refreshedClip.sourceEndMs = canExpandSourceRange ? expandedSourceEndMs : sourceEndMs;
      refreshedClip.speechStartMs = Math.min(
        typeof refreshedClip.speechStartMs === 'number' && Number.isFinite(refreshedClip.speechStartMs)
          ? Math.round(refreshedClip.speechStartMs)
          : boundarySpeechStartMs,
        boundarySpeechStartMs,
      );
      refreshedClip.speechEndMs = Math.max(
        typeof refreshedClip.speechEndMs === 'number' && Number.isFinite(refreshedClip.speechEndMs)
          ? Math.round(refreshedClip.speechEndMs)
          : boundarySpeechEndMs,
        boundarySpeechEndMs,
      );
      if (!canExpandSourceRange) {
        refreshedClip.speechStartMs = Math.max(
          refreshedClip.sourceStartMs,
          Math.min(refreshedClip.speechStartMs, refreshedClip.sourceEndMs),
        );
        refreshedClip.speechEndMs = Math.max(
          refreshedClip.speechStartMs,
          Math.min(refreshedClip.speechEndMs, refreshedClip.sourceEndMs),
        );
      }
      if (
        refreshedClip.sourceStartMs !== sourceStartMs ||
        refreshedClip.sourceEndMs !== sourceEndMs
      ) {
        refreshedClip.leadingSilenceMs = typeof refreshedClip.audioActivityStartMs === 'number' &&
          Number.isFinite(refreshedClip.audioActivityStartMs)
          ? Math.max(0, Math.round(refreshedClip.audioActivityStartMs) - refreshedClip.sourceStartMs)
          : Math.max(0, refreshedClip.speechStartMs - refreshedClip.sourceStartMs);
        refreshedClip.trailingSilenceMs = typeof refreshedClip.audioActivityEndMs === 'number' &&
          Number.isFinite(refreshedClip.audioActivityEndMs)
          ? Math.max(0, refreshedClip.sourceEndMs - Math.round(refreshedClip.audioActivityEndMs))
          : Math.max(0, refreshedClip.sourceEndMs - refreshedClip.speechEndMs);
      }
    }

    const clipTranscriptSegments = boundaryTranscriptSegments.length > 0 && !canTrustAudioTrimmedBoundaryTranscriptSegments
      && !shouldPreserveExistingRenderReadyBoundary
      ? boundaryTranscriptSegments
      : createVideoSliceTranscriptSegments(
          refreshedClip,
          { startMs: refreshedClip.startMs, durationMs: refreshedClip.durationMs } as AutoCutVideoSliceArtifactResult,
          sourceBoundedTranscriptSegments,
        );
    if (clipTranscriptSegments.length === 0) {
      delete refreshedClip.transcriptText;
      delete refreshedClip.transcriptSegments;
      delete refreshedClip.transcriptSegmentTexts;
      delete refreshedClip.transcriptSegmentCount;
      delete refreshedClip.transcriptCoverageScore;
      delete refreshedClip.speechContinuityGrade;
      return refreshedClip;
    }

    const sourceSegmentRepairedClip = refreshTrustedSmartSliceAudioActivityPaddingEvidence(
      refreshSmartSliceClipSourceSegmentsForTranscriptEvidence(
        refreshedClip,
        clipTranscriptSegments,
      ),
    );
    const finalSourceStartMs = sourceSegmentRepairedClip.sourceStartMs ?? Math.round(sourceSegmentRepairedClip.startMs);
    const finalSourceEndMs = sourceSegmentRepairedClip.sourceEndMs ??
      Math.round(sourceSegmentRepairedClip.startMs + sourceSegmentRepairedClip.durationMs);
    const finalClipTranscriptSegments = createVideoSliceTranscriptSegments(
      sourceSegmentRepairedClip,
      {
        startMs: sourceSegmentRepairedClip.startMs,
        durationMs: sourceSegmentRepairedClip.durationMs,
      } as AutoCutVideoSliceArtifactResult,
      sourceBoundedTranscriptSegments,
    );
    if (finalClipTranscriptSegments.length === 0) {
      delete sourceSegmentRepairedClip.transcriptText;
      delete sourceSegmentRepairedClip.transcriptSegments;
      delete sourceSegmentRepairedClip.transcriptSegmentTexts;
      delete sourceSegmentRepairedClip.transcriptSegmentCount;
      delete sourceSegmentRepairedClip.transcriptCoverageScore;
      delete sourceSegmentRepairedClip.speechContinuityGrade;
      return sourceSegmentRepairedClip;
    }
    const transcriptText = createVideoSliceTranscriptText(finalClipTranscriptSegments);
    const transcriptSpeechStartMs = Math.max(
      finalSourceStartMs,
      Math.min(Math.round(finalClipTranscriptSegments[0]?.startMs ?? finalSourceStartMs), finalSourceEndMs),
    );
    const transcriptSpeechEndMs = Math.max(
      transcriptSpeechStartMs,
      Math.min(Math.round(finalClipTranscriptSegments.at(-1)?.endMs ?? finalSourceEndMs), finalSourceEndMs),
    );
    const existingSpeechStartMs = typeof sourceSegmentRepairedClip.speechStartMs === 'number' &&
      Number.isFinite(sourceSegmentRepairedClip.speechStartMs)
      ? Math.round(sourceSegmentRepairedClip.speechStartMs)
      : undefined;
    const existingSpeechEndMs = typeof sourceSegmentRepairedClip.speechEndMs === 'number' &&
      Number.isFinite(sourceSegmentRepairedClip.speechEndMs)
      ? Math.round(sourceSegmentRepairedClip.speechEndMs)
      : undefined;
    const hasRenderableExistingSpeechRange =
      existingSpeechStartMs !== undefined &&
      existingSpeechEndMs !== undefined &&
      existingSpeechEndMs > existingSpeechStartMs &&
      existingSpeechStartMs >= finalSourceStartMs &&
      existingSpeechEndMs <= finalSourceEndMs &&
      transcriptSpeechStartMs <= existingSpeechStartMs + SMART_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS &&
      transcriptSpeechEndMs >= existingSpeechEndMs - SMART_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS;
    const speechStartMs = hasRenderableExistingSpeechRange ? existingSpeechStartMs : transcriptSpeechStartMs;
    const speechEndMs = hasRenderableExistingSpeechRange ? existingSpeechEndMs : transcriptSpeechEndMs;
    const transcriptCoverageScore = createSmartSliceTranscriptEvidenceCoverageScore(
      finalClipTranscriptSegments,
      speechStartMs,
      speechEndMs,
      sourceSegmentRepairedClip.sourceSegments,
    );

    return {
      ...sourceSegmentRepairedClip,
      transcriptText,
      transcriptSegments: finalClipTranscriptSegments,
      transcriptSegmentTexts: finalClipTranscriptSegments.map((segment) => segment.text).slice(0, 20),
      transcriptSegmentCount: finalClipTranscriptSegments.length,
      speechStartMs,
      speechEndMs,
      boundaryPaddingBeforeMs: Math.max(0, speechStartMs - finalSourceStartMs),
      boundaryPaddingAfterMs: Math.max(0, finalSourceEndMs - speechEndMs),
      transcriptCoverageScore,
      speechContinuityGrade: resolveSmartSliceTranscriptEvidenceContinuityGrade(
        sourceSegmentRepairedClip,
        finalClipTranscriptSegments,
        transcriptCoverageScore,
      ),
    };
  });
}

function forceRepairSmartSliceSourceSegmentCoverage(
  plannedClips: readonly NormalizedSlicePlanClip[],
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
  sourceDurationMs: number | undefined,
): NormalizedSlicePlanClip[] {
  if (isSmartSliceHighlightSelectionPlan(plannedClips, transcriptSegments)) {
    return [...plannedClips];
  }

  const eligibleSegments = getEligibleSmartSliceTranscriptCoverageSegments(transcriptSegments);
  const uncoveredSegments = eligibleSegments.filter((segment) =>
    !isTranscriptSegmentCoveredByRepeatFilteredClip(plannedClips, segment) &&
    !doesSmartSlicePlannedClipsCoverTranscriptSegment(plannedClips, segment),
  );
  if (uncoveredSegments.length === 0) {
    return [...plannedClips];
  }

  const mutableClips: NormalizedSlicePlanClip[] = plannedClips.map((clip) => ({ ...clip }));
  for (const segment of uncoveredSegments) {
    const segStartMs = Math.round(segment.startMs);
    const segEndMs = Math.round(segment.endMs);
    if (!Number.isFinite(segStartMs) || !Number.isFinite(segEndMs) || segEndMs <= segStartMs) {
      continue;
    }

    const containingClipIndex = mutableClips.findIndex((clip) => {
      const clipSourceStart = clip.sourceStartMs ?? clip.startMs;
      const clipSourceEnd = clip.sourceEndMs ?? clip.startMs + clip.durationMs;
      return clipSourceStart <= segStartMs + SMART_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS &&
        clipSourceEnd >= segEndMs - SMART_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS;
    });

    if (containingClipIndex >= 0) {
      const clip = mutableClips[containingClipIndex];
      if (clip && Array.isArray(clip.sourceSegments) && clip.sourceSegments.length > 0) {
        const expandedSegments = expandSourceSegmentsToCoverRange(
          clip.sourceSegments,
          segStartMs,
          segEndMs,
        );
        mutableClips[containingClipIndex] = { ...clip, sourceSegments: expandedSegments };
      }
      continue;
    }

    const nearestClipIndex = findNearestClipIndexForSegment(mutableClips, segStartMs, segEndMs);
    if (nearestClipIndex < 0) {
      continue;
    }

    const nearestClip = mutableClips[nearestClipIndex];
    if (!nearestClip) {
      continue;
    }
    const existingSegments = Array.isArray(nearestClip.sourceSegments) && nearestClip.sourceSegments.length > 0
      ? nearestClip.sourceSegments
      : [{
          startMs: nearestClip.sourceStartMs ?? nearestClip.startMs,
          endMs: nearestClip.sourceEndMs ?? nearestClip.startMs + nearestClip.durationMs,
        }];
    const expandedSegments = expandSourceSegmentsToCoverRange(existingSegments, segStartMs, segEndMs);
    const expandedSourceStartMs = expandedSegments[0]?.startMs ?? segStartMs;
    const expandedSourceEndMs = expandedSegments.at(-1)?.endMs ?? segEndMs;
    const existingSpeechStartMs = typeof nearestClip.speechStartMs === 'number' && Number.isFinite(nearestClip.speechStartMs)
      ? Math.round(nearestClip.speechStartMs)
      : undefined;
    const existingSpeechEndMs = typeof nearestClip.speechEndMs === 'number' && Number.isFinite(nearestClip.speechEndMs)
      ? Math.round(nearestClip.speechEndMs)
      : undefined;
    const expandedSpeechStartMs = existingSpeechStartMs !== undefined
      ? Math.min(existingSpeechStartMs, segStartMs)
      : segStartMs;
    const expandedSpeechEndMs = existingSpeechEndMs !== undefined
      ? Math.max(existingSpeechEndMs, segEndMs)
      : segEndMs;
    const expandedStartMs = Math.min(Math.round(nearestClip.startMs), expandedSourceStartMs);
    const expandedEndMs = Math.max(
      expandedStartMs + Math.max(1, Math.round(nearestClip.durationMs)),
      expandedSourceEndMs,
    );
    mutableClips[nearestClipIndex] = {
      ...nearestClip,
      startMs: expandedStartMs,
      durationMs: expandedEndMs - expandedStartMs,
      sourceStartMs: expandedSourceStartMs,
      sourceEndMs: expandedSourceEndMs,
      speechStartMs: expandedSpeechStartMs,
      speechEndMs: expandedSpeechEndMs,
      boundaryPaddingBeforeMs: Math.max(0, expandedSpeechStartMs - expandedSourceStartMs),
      boundaryPaddingAfterMs: Math.max(0, expandedSourceEndMs - expandedSpeechEndMs),
      sourceSegments: expandedSegments,
    };
  }

  return refreshSmartSlicePlanTranscriptEvidence(mutableClips, transcriptSegments, sourceDurationMs);
}

function expandSourceSegmentsToCoverRange(
  sourceSegments: readonly { startMs: number; endMs: number }[],
  rangeStartMs: number,
  rangeEndMs: number,
): Array<{ startMs: number; endMs: number }> {
  const sorted = [...sourceSegments]
    .map((s) => ({ startMs: Math.round(s.startMs), endMs: Math.round(s.endMs) }))
    .filter((s) => s.endMs > s.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  const overlappingOrAdjacentIndex = sorted.findIndex((s) =>
    s.endMs >= rangeStartMs - SMART_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS &&
    s.startMs <= rangeEndMs + SMART_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS,
  );

  if (overlappingOrAdjacentIndex >= 0) {
    let mergeStart = overlappingOrAdjacentIndex;
    let mergeEnd = overlappingOrAdjacentIndex;
    for (let i = overlappingOrAdjacentIndex + 1; i < sorted.length; i++) {
      const sortedEntry = sorted[i];
      if (sortedEntry && sortedEntry.startMs <= rangeEndMs + SMART_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS) {
        mergeEnd = i;
      } else {
        break;
      }
    }
    const mergeStartEntry = sorted[mergeStart];
    const mergeEndEntry = sorted[mergeEnd];
    const mergedStartMs = Math.min(mergeStartEntry ? mergeStartEntry.startMs : rangeStartMs, rangeStartMs);
    const mergedEndMs = Math.max(mergeEndEntry ? mergeEndEntry.endMs : rangeEndMs, rangeEndMs);
    return [
      ...sorted.slice(0, mergeStart),
      { startMs: mergedStartMs, endMs: mergedEndMs },
      ...sorted.slice(mergeEnd + 1),
    ];
  }

  const insertIndex = sorted.findIndex((s) => s.startMs > rangeEndMs);
  const newSegment = { startMs: rangeStartMs, endMs: rangeEndMs };
  if (insertIndex < 0) {
    return [...sorted, newSegment];
  }
  return [...sorted.slice(0, insertIndex), newSegment, ...sorted.slice(insertIndex)];
}

function findNearestClipIndexForSegment(
  clips: readonly NormalizedSlicePlanClip[],
  segStartMs: number,
  segEndMs: number,
): number {
  let bestIndex = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    if (!clip) {
      continue;
    }
    const clipSourceStart = clip.sourceStartMs ?? clip.startMs;
    const clipSourceEnd = clip.sourceEndMs ?? clip.startMs + clip.durationMs;
    const distance = Math.min(
      Math.abs(clipSourceEnd - segStartMs),
      Math.abs(clipSourceStart - segEndMs),
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return bestIndex;
}

export function repairSmartSlicePlanForNativeRender(
  plannedClips: readonly NormalizedSlicePlanClip[],
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
  params: VideoSliceParams,
): NormalizedSlicePlanClip[] {
  const sourceDurationMs = resolveTrustedVideoSliceSourceDurationMs(params);
  if (transcriptSegments.length === 0) {
    const policy = getVideoSlicePlanningPolicy({
      ...params,
      ...(sourceDurationMs !== undefined ? { sourceDurationMs } : {}),
    });
    return normalizeSmartSlicePlanSourceSegmentsForNativeRender(
      normalizeSmartSlicePlanRenderedTimelineForNativeRender(plannedClips, policy)
        .map((clip, index) => ({
        ...clip,
        index,
        sourceStartMs: clip.sourceStartMs ?? clip.startMs,
        sourceEndMs: clip.sourceEndMs ?? clip.startMs + clip.durationMs,
        speechStartMs: clip.speechStartMs ?? clip.sourceStartMs ?? clip.startMs,
        speechEndMs: clip.speechEndMs ?? clip.sourceEndMs ?? clip.startMs + clip.durationMs,
        boundaryPaddingBeforeMs: clip.boundaryPaddingBeforeMs ?? 0,
        boundaryPaddingAfterMs: clip.boundaryPaddingAfterMs ?? 0,
        boundaryDecisionSource: clip.boundaryDecisionSource ?? 'transcript',
        tailTreatment: clip.tailTreatment ?? 'none',
        risks: createUniqueSmartSliceStringList([
          ...(clip.risks ?? []),
          'no-transcript-render-fallback',
        ]),
        })),
    );
  }
  const sourceBoundedTranscriptSegments = normalizeSmartSliceTranscriptTimelineForSourceDuration(
    transcriptSegments,
    sourceDurationMs,
  );
  const refreshedPlan = refreshSmartSlicePlanTranscriptEvidence(
    plannedClips,
    sourceBoundedTranscriptSegments,
    sourceDurationMs,
  );
  const repairParams = {
    ...params,
    ...(sourceDurationMs !== undefined ? { sourceDurationMs } : {}),
  };
  const policy = getVideoSlicePlanningPolicy(repairParams);
  const coverageCandidates = normalizeCandidateSlicePlanForCoverageRepair(
    buildTranscriptSliceCandidates(repairParams, sourceBoundedTranscriptSegments, { disableRepeatFilter: true }),
    repairParams,
  );
  const coverageRepairedPlan = repairReleasePlanSpeechCoverage(
    refreshedPlan,
    coverageCandidates,
    sourceBoundedTranscriptSegments,
    policy,
    false,
  );
  const refreshedRepairedPlan = refreshSmartSlicePlanTranscriptEvidence(
    coverageRepairedPlan,
    sourceBoundedTranscriptSegments,
    sourceDurationMs,
  );
  const sourceSegmentRepairedPlan = forceRepairSmartSliceSourceSegmentCoverage(
    refreshedRepairedPlan,
    sourceBoundedTranscriptSegments,
    sourceDurationMs,
  );
  const speechPaddingRepairedPlan = sourceSegmentRepairedPlan.map((clip) =>
    repairSmartSliceClipTimingForNativeRender(clip, policy)
  );
  const timelineNormalizedPlan = normalizeSmartSlicePlanRenderedTimelineForNativeRender(
    speechPaddingRepairedPlan,
    policy,
  );
  const audioActivityPaddingRepairedPlan = timelineNormalizedPlan.map((clip) =>
    repairTrustedSmartSliceAudioActivityPaddingForNativeRender(clip)
  );
  const coverageRepairedAfterAudioPlan = forceRepairSmartSliceSourceSegmentCoverage(
    audioActivityPaddingRepairedPlan,
    sourceBoundedTranscriptSegments,
    sourceDurationMs,
  );
  const timelineNormalizedAfterCoveragePlan = normalizeSmartSlicePlanRenderedTimelineForNativeRender(
    coverageRepairedAfterAudioPlan,
    policy,
  );
  const refreshedAfterCoveragePlan = refreshSmartSlicePlanTranscriptEvidence(
    timelineNormalizedAfterCoveragePlan,
    sourceBoundedTranscriptSegments,
    sourceDurationMs,
  );
  return normalizeSmartSlicePlanSourceSegmentsForNativeRender(
    refreshedAfterCoveragePlan.map((clip) =>
      normalizeTrustedSmartSliceAudioActivityEvidenceForNativeRender(clip)
    ),
  );
}

function normalizeVideoSliceTranscriptEvidenceText(value: string | undefined) {
  return value?.trim().replace(/\s+/gu, ' ') ?? '';
}

export function assertVideoSliceResultsHaveTranscripts(sliceResults: readonly TaskSliceResult[]) {
  sliceResults.forEach((sliceResult, index) => {
    const sliceNumber = index + 1;
    if (!sliceResult.transcriptSegments?.length || !sliceResult.transcriptText?.trim()) {
      throw new Error(
        `Smart slicing requires structured speech-to-text transcript segments for every generated slice. Slice ${sliceNumber} has no transcript coverage.`,
      );
    }

    if (
      typeof sliceResult.transcriptSegmentCount !== 'number' ||
      sliceResult.transcriptSegmentCount !== sliceResult.transcriptSegments.length
    ) {
      throw new Error(
        `Smart slicing requires slice ${sliceNumber} transcriptSegmentCount to match structured transcriptSegments.`,
      );
    }

    const expectedTranscriptText = createVideoSliceTranscriptText(sliceResult.transcriptSegments);
    if (normalizeVideoSliceTranscriptEvidenceText(sliceResult.transcriptText) !== expectedTranscriptText) {
      throw new Error(
        `Smart slicing requires slice ${sliceNumber} transcriptText to match structured transcriptSegments.`,
      );
    }
  });
}

export function assertSmartSliceResultsMeetProfessionalStandard(sliceResults: readonly TaskSliceResult[]) {
  assertVideoSliceResultsHaveTranscripts(sliceResults);

  sliceResults.forEach((sliceResult, index) => {
    const sliceNumber = index + 1;
    const transcriptSegments = sliceResult.transcriptSegments ?? [];

    const sourceStartMs = assertSmartSliceMilliseconds(sliceResult.sourceStartMs, sliceNumber, 'sourceStartMs');
    const sourceEndMs = assertSmartSliceMilliseconds(sliceResult.sourceEndMs, sliceNumber, 'sourceEndMs');
    const speechStartMs = assertSmartSliceMilliseconds(sliceResult.speechStartMs, sliceNumber, 'speechStartMs');
    const speechEndMs = assertSmartSliceMilliseconds(sliceResult.speechEndMs, sliceNumber, 'speechEndMs');

    if (sourceEndMs <= sourceStartMs) {
      throw new Error(`Smart slicing requires slice ${sliceNumber} sourceEndMs to be after sourceStartMs.`);
    }
    if (speechEndMs <= speechStartMs || speechStartMs < sourceStartMs || speechEndMs > sourceEndMs) {
      throw new Error(`Smart slicing requires slice ${sliceNumber} speech range to stay inside its rendered source range.`);
    }

    const boundaryPaddingBeforeMs = speechStartMs - sourceStartMs;
    const boundaryPaddingAfterMs = sourceEndMs - speechEndMs;
    if (
      boundaryPaddingBeforeMs > MAX_SMART_SLICE_LEADING_SILENCE_MS ||
      boundaryPaddingAfterMs > MAX_SMART_SLICE_TRAILING_SILENCE_MS
    ) {
      throw new Error(
        `Smart slicing requires slice ${sliceNumber} to keep no more than ${MAX_SMART_SLICE_LEADING_SILENCE_MS}ms leading and ${MAX_SMART_SLICE_TRAILING_SILENCE_MS}ms trailing silence around speech.`,
      );
    }
    assertTrustedSmartSliceAudioActivityPadding(
      sliceResult,
      sourceStartMs,
      sourceEndMs,
      `slice ${sliceNumber}`,
      { requireTrustedEvidence: true },
    );

    if (
      typeof sliceResult.transcriptCoverageScore !== 'number' ||
      !Number.isFinite(sliceResult.transcriptCoverageScore) ||
      sliceResult.transcriptCoverageScore < MIN_SMART_SLICE_TRANSCRIPT_COVERAGE_SCORE
    ) {
      throw new Error(
        `Smart slicing requires slice ${sliceNumber} transcriptCoverageScore to be at least ${MIN_SMART_SLICE_TRANSCRIPT_COVERAGE_SCORE}.`,
      );
    }

    if (
      !SMART_SLICE_ACCEPTED_SPEECH_CONTINUITY_GRADES.includes(
        sliceResult.speechContinuityGrade as typeof SMART_SLICE_ACCEPTED_SPEECH_CONTINUITY_GRADES[number],
      )
    ) {
      throw new Error(
        `Smart slicing requires slice ${sliceNumber} speechContinuityGrade to be strong or repaired.`,
      );
    }

    if (sliceResult.audioCleanupProfile !== SMART_SLICE_AUDIO_CLEANUP_PROFILE) {
      throw new Error(
        `Smart slicing requires slice ${sliceNumber} audio cleanup profile evidence to use ${SMART_SLICE_AUDIO_CLEANUP_PROFILE}.`,
      );
    }
    if (typeof sliceResult.noiseReductionApplied !== 'boolean') {
      throw new Error(
        `Smart slicing requires slice ${sliceNumber} noise reduction decision evidence before boundary cleanup.`,
      );
    }
    if (
      sliceResult.boundaryDecisionSource !== 'transcript' &&
      sliceResult.boundaryDecisionSource !== 'audio' &&
      sliceResult.boundaryDecisionSource !== 'combined'
    ) {
      throw new Error(
        `Smart slicing requires slice ${sliceNumber} boundary decision evidence to identify transcript, audio, or combined timing.`,
      );
    }
    if (
      sliceResult.tailTreatment !== 'none' &&
      sliceResult.tailTreatment !== 'semantic-extend' &&
      sliceResult.tailTreatment !== 'fade-out'
    ) {
      throw new Error(
        `Smart slicing requires slice ${sliceNumber} tail treatment evidence for final audio handling.`,
      );
    }
    assertSmartSliceMilliseconds(
      sliceResult.leadingSilenceTrimMs ?? 0,
      sliceNumber,
      'leadingSilenceTrimMs',
    );
    assertSmartSliceMilliseconds(
      sliceResult.trailingSilenceTrimMs ?? 0,
      sliceNumber,
      'trailingSilenceTrimMs',
    );
    assertSmartSliceSourceSegments(sliceResult, sourceStartMs, sourceEndMs, sliceNumber);

    let previousTranscriptSegmentEndMs: number | undefined;
    for (const [segmentIndex, segment] of transcriptSegments.entries()) {
      const segmentNumber = segmentIndex + 1;
      const segmentStartMs = assertSmartSliceMilliseconds(
        segment.startMs,
        sliceNumber,
        `transcriptSegments[${segmentIndex}].startMs`,
      );
      const segmentEndMs = assertSmartSliceMilliseconds(
        segment.endMs,
        sliceNumber,
        `transcriptSegments[${segmentIndex}].endMs`,
      );
      if (!segment.text.trim()) {
        throw new Error(`Smart slicing requires slice ${sliceNumber} transcript segment ${segmentNumber} to have text.`);
      }
      if (segmentEndMs <= segmentStartMs || segmentStartMs < sourceStartMs || segmentEndMs > sourceEndMs) {
        throw new Error(`Smart slicing requires slice ${sliceNumber} transcript segment ${segmentNumber} to stay inside its rendered source range.`);
      }
      if (previousTranscriptSegmentEndMs !== undefined && segmentStartMs < previousTranscriptSegmentEndMs) {
        throw new Error(
          `Smart slicing requires slice ${sliceNumber} transcript segments to be ordered and non-overlapping.`,
        );
      }
      previousTranscriptSegmentEndMs = segmentEndMs;
    }

    const firstTranscriptSegmentStartMs = transcriptSegments[0]?.startMs;
    const lastTranscriptSegmentEndMs = transcriptSegments.at(-1)?.endMs;
    if (
      firstTranscriptSegmentStartMs === undefined ||
      lastTranscriptSegmentEndMs === undefined ||
      firstTranscriptSegmentStartMs > speechStartMs + SMART_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS ||
      lastTranscriptSegmentEndMs < speechEndMs - SMART_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS
    ) {
      throw new Error(
        `Smart slicing requires slice ${sliceNumber} speech range to stay covered by structured transcript segment boundaries.`,
      );
    }
  });
}

function assertSmartSliceSourceSegments(
  sliceResult: SmartSliceRenderableTimelineEntry,
  sourceStartMs: number,
  sourceEndMs: number,
  sliceNumber: number,
) {
  const normalizedSliceResult = normalizeSmartSliceRenderableTimelineEntrySourceSegments(
    sliceResult,
    sourceStartMs,
    sourceEndMs,
  );
  const sourceSegments = normalizedSliceResult.sourceSegments;
  if (!sourceSegments?.length) {
    return;
  }

  let previousEndMs: number | undefined;
  const renderedDurationMs = sourceSegments.reduce((durationMs, segment, segmentIndex) => {
    const segmentStartMs = assertSmartSliceMilliseconds(
      segment.startMs,
      sliceNumber,
      `sourceSegments[${segmentIndex}].startMs`,
    );
    const segmentEndMs = assertSmartSliceMilliseconds(
      segment.endMs,
      sliceNumber,
      `sourceSegments[${segmentIndex}].endMs`,
    );
    if (
      segmentEndMs <= segmentStartMs ||
      segmentStartMs < sourceStartMs ||
      segmentEndMs > sourceEndMs ||
      (previousEndMs !== undefined && segmentStartMs < previousEndMs)
    ) {
      throw new Error(`Smart slicing requires slice ${sliceNumber} sourceSegments to be ordered inside the source range.`);
    }

    previousEndMs = segmentEndMs;
    return durationMs + segmentEndMs - segmentStartMs;
  }, 0);
  const removedSilenceMs = sourceEndMs - sourceStartMs - renderedDurationMs;
  if (
    normalizedSliceResult.renderedDurationMs !== renderedDurationMs ||
    normalizedSliceResult.removedSilenceMs !== removedSilenceMs ||
    normalizedSliceResult.internalSilenceTrimCount !== sourceSegments.length - 1
  ) {
    throw new Error(`Smart slicing requires slice ${sliceNumber} silence compaction evidence to match retained sourceSegments.`);
  }
  if (
    sliceResult.transcriptSegments?.length &&
    !doesSmartSliceSourceSegmentsCoverSpeechEvidence(
      sliceResult,
      sourceSegments,
      sliceResult.transcriptSegments,
    )
  ) {
    throw new Error(
      `Smart slicing requires slice ${sliceNumber} retained sourceSegments to cover every structured speech-to-text transcript segment.`,
    );
  }
}

function assertSmartSliceMilliseconds(value: unknown, sliceNumber: number, fieldName: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Smart slicing requires slice ${sliceNumber} ${fieldName} to be a non-negative millisecond value.`);
  }

  return Math.round(value);
}

function assertTrustedSmartSliceAudioActivityPadding(
  value: Pick<
    NormalizedSlicePlanClip | TaskSliceResult,
    | 'sourceStartMs'
    | 'sourceEndMs'
    | 'audioActivityStartMs'
    | 'audioActivityEndMs'
    | 'audioActivityConfidence'
    | 'audioActivityAnalysisFilter'
    | 'noiseReductionApplied'
    | 'leadingSilenceMs'
    | 'trailingSilenceMs'
  >,
  sourceStartMs: number,
  sourceEndMs: number,
  label: string,
  options: { requireTrustedEvidence?: boolean } = {},
) {
  const audioActivityAnalysisFilter = typeof value.audioActivityAnalysisFilter === 'string'
    ? value.audioActivityAnalysisFilter.trim()
    : '';
  const expectedAnalysisFilter = typeof value.noiseReductionApplied === 'boolean'
    ? getSmartSliceRequiredAudioActivityAnalysisFilter(value.noiseReductionApplied)
    : undefined;
  const hasTrustedAnalysisFilter = expectedAnalysisFilter !== undefined
    ? audioActivityAnalysisFilter === expectedAnalysisFilter
    : audioActivityAnalysisFilter === SMART_SLICE_REQUIRED_AUDIO_ACTIVITY_ANALYSIS_FILTER ||
      audioActivityAnalysisFilter === SMART_SLICE_RAW_AUDIO_ACTIVITY_ANALYSIS_FILTER;
  if (
    typeof value.audioActivityStartMs !== 'number' ||
    typeof value.audioActivityEndMs !== 'number' ||
    typeof value.audioActivityConfidence !== 'number' ||
    !Number.isFinite(value.audioActivityStartMs) ||
    !Number.isFinite(value.audioActivityEndMs) ||
    !Number.isFinite(value.audioActivityConfidence) ||
    value.audioActivityConfidence < MIN_SMART_SLICE_AUDIO_ACTIVITY_CONFIDENCE ||
    !hasTrustedAnalysisFilter
  ) {
    if (options.requireTrustedEvidence) {
      throw new Error(
        `Smart slicing requires ${label} trusted audio activity evidence before accepting audio-cleaned Smart Slice output.`,
      );
    }
    return;
  }

  const audioActivityStartMs = Math.round(value.audioActivityStartMs);
  const audioActivityEndMs = Math.round(value.audioActivityEndMs);
  if (
    audioActivityEndMs <= audioActivityStartMs ||
    audioActivityStartMs < sourceStartMs ||
    audioActivityEndMs > sourceEndMs
  ) {
    throw new Error(
      `Smart slicing requires ${label} audio activity range to stay inside its rendered source range before native rendering.`,
    );
  }

  const audioActivityLeadingPaddingMs = audioActivityStartMs - sourceStartMs;
  const audioActivityTrailingPaddingMs = sourceEndMs - audioActivityEndMs;
  if (
    value.leadingSilenceMs !== audioActivityLeadingPaddingMs ||
    value.trailingSilenceMs !== audioActivityTrailingPaddingMs
  ) {
    throw new Error(
      `Smart slicing requires ${label} audio silence evidence to match trusted audio activity padding before native rendering.`,
    );
  }
  if (
    audioActivityLeadingPaddingMs > MAX_SMART_SLICE_LEADING_SILENCE_MS ||
    audioActivityTrailingPaddingMs > MAX_SMART_SLICE_TRAILING_SILENCE_MS
  ) {
    throw new Error(
      `Smart slicing requires ${label} audio activity padding to keep no more than ${MAX_SMART_SLICE_LEADING_SILENCE_MS}ms leading and ${MAX_SMART_SLICE_TRAILING_SILENCE_MS}ms trailing audible silence before native rendering.`,
    );
  }
}

function hasPostCleanupSmartSliceAudioEvidenceShape(clip: NormalizedSlicePlanClip) {
  return clip.audioCleanupProfile !== undefined ||
    clip.noiseReductionApplied !== undefined ||
    clip.boundaryDecisionSource !== undefined ||
    clip.audioActivityStartMs !== undefined ||
    clip.audioActivityEndMs !== undefined ||
    clip.audioActivityConfidence !== undefined ||
    clip.audioActivityAnalysisFilter !== undefined ||
    clip.leadingSilenceTrimMs !== undefined ||
    clip.trailingSilenceTrimMs !== undefined ||
    clip.tailTreatment !== undefined;
}

type SmartSliceRenderableTimelineEntry = Pick<
  NormalizedSlicePlanClip | TaskSliceResult,
  | 'sourceStartMs'
  | 'sourceEndMs'
  | 'speechStartMs'
  | 'speechEndMs'
  | 'sourceSegments'
  | 'renderedDurationMs'
  | 'removedSilenceMs'
  | 'internalSilenceTrimCount'
  | 'transcriptSegments'
  | 'transcriptText'
  | 'transcriptSegmentCount'
>;

function hasCompleteTrustedSmartSliceAudioActivityEvidence(
  value: Pick<
    NormalizedSlicePlanClip | TaskSliceResult,
    | 'sourceStartMs'
    | 'sourceEndMs'
    | 'audioActivityStartMs'
    | 'audioActivityEndMs'
    | 'audioActivityConfidence'
    | 'audioActivityAnalysisFilter'
    | 'noiseReductionApplied'
    | 'leadingSilenceMs'
    | 'trailingSilenceMs'
  >,
) {
  if (
    typeof value.sourceStartMs !== 'number' ||
    typeof value.sourceEndMs !== 'number' ||
    !Number.isFinite(value.sourceStartMs) ||
    !Number.isFinite(value.sourceEndMs) ||
    value.sourceEndMs <= value.sourceStartMs ||
    !hasTrustedSmartSliceAudioActivityEvidence(value)
  ) {
    return false;
  }

  const sourceStartMs = Math.round(value.sourceStartMs);
  const sourceEndMs = Math.round(value.sourceEndMs);
  const audioActivityStartMs = Math.round(value.audioActivityStartMs as number);
  const audioActivityEndMs = Math.round(value.audioActivityEndMs as number);
  return audioActivityStartMs >= sourceStartMs &&
    audioActivityEndMs <= sourceEndMs &&
    audioActivityEndMs > audioActivityStartMs &&
    value.leadingSilenceMs === audioActivityStartMs - sourceStartMs &&
    value.trailingSilenceMs === sourceEndMs - audioActivityEndMs;
}

function hasCompleteTrustedSmartSliceAudioActivityEvidenceForEverySlice(
  sliceResults: readonly SmartSliceRenderableTimelineEntry[],
) {
  return sliceResults.length > 0 &&
    sliceResults.every((sliceResult) => hasCompleteTrustedSmartSliceAudioActivityEvidence(sliceResult));
}

function assertSmartSliceResultsHaveRenderableTimeline(sliceResults: readonly SmartSliceRenderableTimelineEntry[]) {
  sliceResults.forEach((sliceResult, index) => {
    const sliceNumber = index + 1;
    const sourceStartMs = assertSmartSliceMilliseconds(sliceResult.sourceStartMs, sliceNumber, 'sourceStartMs');
    const sourceEndMs = assertSmartSliceMilliseconds(sliceResult.sourceEndMs, sliceNumber, 'sourceEndMs');
    if (sourceEndMs <= sourceStartMs) {
      throw new Error(`Smart slicing requires slice ${sliceNumber} sourceEndMs to be after sourceStartMs.`);
    }

    const speechStartMs = typeof sliceResult.speechStartMs === 'number' && Number.isFinite(sliceResult.speechStartMs)
      ? Math.round(sliceResult.speechStartMs)
      : sourceStartMs;
    const speechEndMs = typeof sliceResult.speechEndMs === 'number' && Number.isFinite(sliceResult.speechEndMs)
      ? Math.round(sliceResult.speechEndMs)
      : sourceEndMs;
    if (speechEndMs <= speechStartMs || speechStartMs < sourceStartMs || speechEndMs > sourceEndMs) {
      throw new Error(`Smart slicing requires slice ${sliceNumber} speech range to stay inside its rendered source range.`);
    }

    assertSmartSliceSourceSegments(sliceResult, sourceStartMs, sourceEndMs, sliceNumber);
  });
}

function createFallbackSmartSliceAudioCleanupAttemptResult(
  sourceAssetUuid: string,
  plannedClips: readonly NormalizedSlicePlanClip[],
): SmartSliceAudioCleanupAttemptResult {
  return {
    audioActivityResult: {
      assetUuid: sourceAssetUuid,
      profile: SMART_SLICE_AUDIO_CLEANUP_PROFILE,
      analyses: [],
    },
    refinedClips: plannedClips.map((clip) => stripTrustedSmartSliceAudioActivityEvidence(clip)),
    noiseReductionApplied: false,
  };
}

function assertPlannedSmartSliceMilliseconds(value: unknown, clipNumber: number, fieldName: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(
      `Smart slicing requires planned clip ${clipNumber} ${fieldName} to be a non-negative millisecond value.`,
    );
  }

  return Math.round(value);
}

function assertPositivePlannedSmartSliceMilliseconds(value: unknown, clipNumber: number, fieldName: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(
      `Smart slicing requires planned clip ${clipNumber} ${fieldName} to be a positive millisecond value.`,
    );
  }

  const roundedValue = Math.round(value);
  if (roundedValue <= 0) {
    throw new Error(
      `Smart slicing requires planned clip ${clipNumber} ${fieldName} to be a positive millisecond value.`,
    );
  }

  return roundedValue;
}

function assertSmartSliceTranscriptTimelineWithinSourceDuration(
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
  sourceDurationMs: number | undefined,
  stageLabel: 'clip planning' | 'native rendering',
) {
  let previousSegmentEndMs: number | undefined;

  transcriptSegments.forEach((segment, index) => {
    const segmentNumber = index + 1;
    if (
      typeof segment.startMs !== 'number' ||
      typeof segment.endMs !== 'number' ||
      !Number.isFinite(segment.startMs) ||
      !Number.isFinite(segment.endMs)
    ) {
      throw new Error(
        `Smart slicing requires transcript segment ${segmentNumber} timing to be finite before ${stageLabel}.`,
      );
    }

    const segmentStartMs = Math.round(segment.startMs);
    const segmentEndMs = Math.round(segment.endMs);
    if (segmentStartMs < 0 || segmentEndMs <= segmentStartMs) {
      throw new Error(
        `Smart slicing requires transcript segment ${segmentNumber} to have a valid non-negative speech range before ${stageLabel}.`,
      );
    }
    if (previousSegmentEndMs !== undefined && segmentStartMs < previousSegmentEndMs) {
      throw new Error(
        `Smart slicing requires transcript segment ${segmentNumber} to start after the previous transcript segment ends before ${stageLabel}.`,
      );
    }
    if (sourceDurationMs !== undefined && segmentEndMs > sourceDurationMs) {
      throw new Error(
        `Smart slicing requires transcript segment ${segmentNumber} to stay inside the imported media duration before ${stageLabel}.`,
      );
    }

    previousSegmentEndMs = segmentEndMs;
  });
}

function assertSmartSliceSourceSegmentsReadyForNativeRender(
  clip: NormalizedSlicePlanClip,
  clipNumber: number,
  startMs: number,
  durationMs: number,
  sourceStartMs: number,
  sourceEndMs: number,
  speechStartMs: number,
  speechEndMs: number,
) {
  const normalizedClip = normalizeSmartSlicePlannedClipSourceSegmentsForContinuousFallback({
    ...clip,
    startMs,
    durationMs,
    sourceStartMs,
    sourceEndMs,
  });
  const sourceSegments = normalizedClip.sourceSegments;
  if (!Array.isArray(sourceSegments) || sourceSegments.length === 0) {
    return;
  }

  let previousSourceSegmentEndMs: number | undefined;
  let retainedDurationMs = 0;
  const renderedEndMs = startMs + durationMs;
  for (const [segmentIndex, sourceSegment] of sourceSegments.entries()) {
    const segmentNumber = segmentIndex + 1;
    if (
      typeof sourceSegment.startMs !== 'number' ||
      typeof sourceSegment.endMs !== 'number' ||
      !Number.isFinite(sourceSegment.startMs) ||
      !Number.isFinite(sourceSegment.endMs)
    ) {
      throw new Error(
        `Smart slicing requires planned clip ${clipNumber} sourceSegments[${segmentNumber}] timing to be finite before native rendering. ${formatSmartSliceNativeRenderClipRuntimeParams(normalizedClip, clipNumber, startMs, durationMs, sourceStartMs, sourceEndMs, speechStartMs, speechEndMs)}`,
      );
    }

    const segmentStartMs = Math.round(sourceSegment.startMs);
    const segmentEndMs = Math.round(sourceSegment.endMs);
    if (
      segmentEndMs <= segmentStartMs ||
      segmentStartMs < startMs ||
      segmentEndMs > renderedEndMs ||
      (previousSourceSegmentEndMs !== undefined && segmentStartMs < previousSourceSegmentEndMs)
    ) {
      throw new Error(
        `Smart slicing requires planned clip ${clipNumber} sourceSegments[${segmentNumber}] to be ordered and stay inside rendered clip timing. ${formatSmartSliceNativeRenderClipRuntimeParams(normalizedClip, clipNumber, startMs, durationMs, sourceStartMs, sourceEndMs, speechStartMs, speechEndMs)}`,
      );
    }

    retainedDurationMs += segmentEndMs - segmentStartMs;
    previousSourceSegmentEndMs = segmentEndMs;
  }

  if (
    typeof normalizedClip.renderedDurationMs === 'number' &&
    Number.isFinite(normalizedClip.renderedDurationMs) &&
    Math.abs(Math.round(normalizedClip.renderedDurationMs) - retainedDurationMs) > 1
  ) {
    throw new Error(
      `Smart slicing requires planned clip ${clipNumber} renderedDurationMs to match retained sourceSegments duration. ${formatSmartSliceNativeRenderClipRuntimeParams(normalizedClip, clipNumber, startMs, durationMs, sourceStartMs, sourceEndMs, speechStartMs, speechEndMs)}`,
    );
  }

  if (!doSmartSliceSourceSegmentsSpanSourceRange(sourceSegments, sourceStartMs, sourceEndMs)) {
    throw new Error(
      `Smart slicing requires planned clip ${clipNumber} source range to span retained sourceSegments. ${formatSmartSliceNativeRenderClipRuntimeParams(normalizedClip, clipNumber, startMs, durationMs, sourceStartMs, sourceEndMs, speechStartMs, speechEndMs)}`,
    );
  }
}

function createSmartSliceClipSourceCoverageSegments(
  clip: NormalizedSlicePlanClip,
): Array<{ startMs: number; endMs: number }> {
  const sourceSegments = Array.isArray(clip.sourceSegments) && clip.sourceSegments.length > 0
    ? clip.sourceSegments
    : [
        {
          startMs: clip.sourceStartMs ?? clip.startMs,
          endMs: clip.sourceEndMs ?? clip.startMs + clip.durationMs,
        },
      ];

  return sourceSegments
    .filter((sourceSegment) =>
      typeof sourceSegment.startMs === 'number' &&
        typeof sourceSegment.endMs === 'number' &&
        Number.isFinite(sourceSegment.startMs) &&
        Number.isFinite(sourceSegment.endMs) &&
        sourceSegment.endMs > sourceSegment.startMs
    )
    .map((sourceSegment) => ({
      startMs: Math.round(sourceSegment.startMs),
      endMs: Math.round(sourceSegment.endMs),
    }));
}

function doesSmartSlicePlannedClipsCoverTranscriptSegment(
  plannedClips: readonly NormalizedSlicePlanClip[],
  segment: AutoCutSpeechTranscriptionSegment,
) {
  if (
    typeof segment.startMs !== 'number' ||
    typeof segment.endMs !== 'number' ||
    !Number.isFinite(segment.startMs) ||
    !Number.isFinite(segment.endMs) ||
    segment.endMs <= segment.startMs
  ) {
    return false;
  }

  const segmentStartMs = Math.round(segment.startMs);
  const segmentEndMs = Math.round(segment.endMs);
  if (
    plannedClips.some((clip) =>
      Array.isArray(clip.sourceSegments) &&
        doesSmartSliceTrustedAudioCompactedSourceSegmentsCoverTranscriptRange(
          clip,
          clip.sourceSegments,
          segment,
        )
    )
  ) {
    return true;
  }
  const coverageRanges = plannedClips
    .flatMap((clip) => createSmartSliceClipSourceCoverageSegments(clip))
    .map((sourceSegment) => ({
      startMs: Math.max(segmentStartMs, sourceSegment.startMs),
      endMs: Math.min(segmentEndMs, sourceSegment.endMs),
    }))
    .filter((sourceSegment) => sourceSegment.endMs > sourceSegment.startMs)
    .sort((firstSegment, secondSegment) =>
      firstSegment.startMs - secondSegment.startMs ||
        firstSegment.endMs - secondSegment.endMs,
    );

  let coveredUntilMs = segmentStartMs;
  for (const range of coverageRanges) {
    if (range.endMs <= coveredUntilMs) {
      continue;
    }
    if (range.startMs > coveredUntilMs + SMART_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS) {
      return plannedClips.some((clip) =>
        Array.isArray(clip.sourceSegments) &&
          doesSmartSliceTrustedAudioCompactedSourceSegmentsCoverTranscriptRange(
            clip,
            clip.sourceSegments,
            segment,
          )
      );
    }

    coveredUntilMs = Math.max(coveredUntilMs, range.endMs);
    if (coveredUntilMs >= segmentEndMs - SMART_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS) {
      return true;
    }
  }

  return coveredUntilMs >= segmentEndMs - SMART_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS ||
    plannedClips.some((clip) =>
      Array.isArray(clip.sourceSegments) &&
        doesSmartSliceTrustedAudioCompactedSourceSegmentsCoverTranscriptRange(
          clip,
          clip.sourceSegments,
          segment,
        )
    );
}

function createSmartSliceUncoveredTranscriptSegmentMessage(
  missingSegments: readonly { index: number; segment: AutoCutSpeechTranscriptionSegment }[],
) {
  return missingSegments
    .slice(0, SMART_SLICE_PLANNING_DIAGNOSTIC_SAMPLE_LIMIT)
    .map(({ index, segment }) =>
      [
        `segment=${index + 1}`,
        `startMs=${Math.round(segment.startMs)}`,
        `endMs=${Math.round(segment.endMs)}`,
        `text="${createSmartSlicePlanningTextPreview(segment.text)}"`,
      ].join(' ')
    )
    .join('; ');
}

function assertSmartSlicePlanCoversEligibleTranscriptSpeech(
  plannedClips: readonly NormalizedSlicePlanClip[],
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
) {
  if (isSmartSliceHighlightSelectionPlan(plannedClips, transcriptSegments)) {
    return;
  }

  const missingSegments = getEligibleSmartSliceTranscriptCoverageSegments(transcriptSegments)
    .map((segment, index) => ({ segment, index }))
    .filter(({ segment }) =>
      !isTranscriptSegmentCoveredByRepeatFilteredClip(plannedClips, segment)
    )
    .filter(({ segment }) =>
      !doesSmartSlicePlannedClipsCoverTranscriptSegment(plannedClips, segment)
    );

  if (missingSegments.length === 0) {
    return;
  }

  throw new Error(
    [
      'Smart slicing requires planned clips to cover every eligible transcript speech segment before native rendering.',
      `Uncovered transcript segment count=${missingSegments.length}.`,
      createSmartSliceUncoveredTranscriptSegmentMessage(missingSegments),
    ].filter(Boolean).join(' '),
  );
}

function isSmartSliceHighlightSelectionPlan(
  plannedClips: readonly NormalizedSlicePlanClip[],
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
) {
  const eligibleSegments = transcriptSegments.filter((segment) =>
    isEligibleSmartSliceTranscriptCoverageText(segment.text)
  );
  if (eligibleSegments.length <= 80 || plannedClips.length === 0) {
    return false;
  }

  const coveredSegmentCount = eligibleSegments.filter((segment) =>
    doesSmartSlicePlannedClipsCoverTranscriptSegment(plannedClips, segment) ||
      isTranscriptSegmentCoveredByRepeatFilteredClip(plannedClips, segment)
  ).length;
  if (coveredSegmentCount === 0) {
    return false;
  }

  const coveredRatio = coveredSegmentCount / eligibleSegments.length;
  return coveredRatio <= 0.35 &&
    plannedClips.every((clip) =>
      clip.transcriptText?.trim() &&
      typeof clip.transcriptCoverageScore === 'number' &&
      clip.transcriptCoverageScore >= MIN_SMART_SLICE_TRANSCRIPT_COVERAGE_SCORE &&
      SMART_SLICE_ACCEPTED_SPEECH_CONTINUITY_GRADES.includes(
        clip.speechContinuityGrade as typeof SMART_SLICE_ACCEPTED_SPEECH_CONTINUITY_GRADES[number],
      )
    );
}

function isTranscriptSegmentCoveredByRepeatFilteredClip(
  plannedClips: readonly NormalizedSlicePlanClip[],
  segment: AutoCutSpeechTranscriptionSegment,
) {
  const normalizedSegmentText = normalizeVideoSliceTranscriptEvidenceText(segment.text);
  if (!normalizedSegmentText) {
    return false;
  }

  return plannedClips.some((clip) =>
    clip.risks?.includes('transcript-repeat-filtered') === true &&
    normalizeVideoSliceTranscriptEvidenceText(clip.transcriptText ?? '') === normalizedSegmentText
  );
}

function formatSmartSliceNativeRenderClipRuntimeParams(
  clip: NormalizedSlicePlanClip,
  clipNumber: number,
  startMs: number,
  durationMs: number,
  sourceStartMs: number,
  sourceEndMs: number,
  speechStartMs: number,
  speechEndMs: number,
  transcriptEvidence?: {
    computedTranscriptSegmentCount?: number;
    computedTranscriptCoverageScore?: number;
    computedTranscriptText?: string;
  },
) {
  const sourceSegments = clip.sourceSegments?.map((segment) =>
    `${Math.round(segment.startMs)}-${Math.round(segment.endMs)}`
  ).join(',');
  const transcriptTextPreview = transcriptEvidence?.computedTranscriptText
    ? createSmartSlicePlanningTextPreview(transcriptEvidence.computedTranscriptText)
    : undefined;
  return [
    'Clip runtime params:',
    `clipNumber=${clipNumber}`,
    `index=${formatSmartSlicePlanningDiagnosticValue(clip.index)}`,
    `candidateId=${formatSmartSlicePlanningDiagnosticValue(clip.candidateId)}`,
    `startMs=${formatSmartSlicePlanningDiagnosticValue(startMs)}`,
    `durationMs=${formatSmartSlicePlanningDiagnosticValue(durationMs)}`,
    `sourceStartMs=${formatSmartSlicePlanningDiagnosticValue(sourceStartMs)}`,
    `sourceEndMs=${formatSmartSlicePlanningDiagnosticValue(sourceEndMs)}`,
    `speechStartMs=${formatSmartSlicePlanningDiagnosticValue(speechStartMs)}`,
    `speechEndMs=${formatSmartSlicePlanningDiagnosticValue(speechEndMs)}`,
    `boundaryPaddingBeforeMs=${formatSmartSlicePlanningDiagnosticValue(clip.boundaryPaddingBeforeMs)}`,
    `boundaryPaddingAfterMs=${formatSmartSlicePlanningDiagnosticValue(clip.boundaryPaddingAfterMs)}`,
    `audioActivityStartMs=${formatSmartSlicePlanningDiagnosticValue(clip.audioActivityStartMs)}`,
    `audioActivityEndMs=${formatSmartSlicePlanningDiagnosticValue(clip.audioActivityEndMs)}`,
    `leadingSilenceMs=${formatSmartSlicePlanningDiagnosticValue(clip.leadingSilenceMs)}`,
    `trailingSilenceMs=${formatSmartSlicePlanningDiagnosticValue(clip.trailingSilenceMs)}`,
    `sourceSegmentCount=${formatSmartSlicePlanningDiagnosticValue(clip.sourceSegments?.length ?? 0)}`,
    `sourceSegments=${formatSmartSlicePlanningDiagnosticValue(sourceSegments)}`,
    `cachedTranscriptSegmentCount=${formatSmartSlicePlanningDiagnosticValue(clip.transcriptSegmentCount)}`,
    `computedTranscriptSegmentCount=${formatSmartSlicePlanningDiagnosticValue(transcriptEvidence?.computedTranscriptSegmentCount)}`,
    `cachedTranscriptCoverageScore=${formatSmartSlicePlanningDiagnosticValue(clip.transcriptCoverageScore)}`,
    `computedTranscriptCoverageScore=${formatSmartSlicePlanningDiagnosticValue(transcriptEvidence?.computedTranscriptCoverageScore)}`,
    `computedTranscriptText=${formatSmartSlicePlanningDiagnosticValue(transcriptTextPreview)}`,
  ].join(' ');
}

export function assertSmartSliceSemanticPlanReadyForAudioAnalysis(
  plannedClips: readonly NormalizedSlicePlanClip[],
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
  sourceDurationMs?: number,
) {
  if (plannedClips.length === 0) {
    throw new Error('Smart slicing requires at least one semantic planned clip before audio cleanup.');
  }
  if (transcriptSegments.length === 0) {
    throw new Error(
      'Smart slicing requires structured speech-to-text transcript segments before semantic audio cleanup.',
    );
  }

  const trustedSourceDurationMs =
    typeof sourceDurationMs === 'number' && Number.isFinite(sourceDurationMs) && sourceDurationMs > 0
      ? Math.round(sourceDurationMs)
      : undefined;
  const sourceBoundedTranscriptSegments = normalizeSmartSliceTranscriptTimelineForSourceDuration(
    transcriptSegments,
    trustedSourceDurationMs,
  );
  assertSmartSliceTranscriptTimelineWithinSourceDuration(
    sourceBoundedTranscriptSegments,
    trustedSourceDurationMs,
    'clip planning',
  );

  const renderReadyPlannedClips = normalizeSmartSlicePlanSourceSegmentsForNativeRender(plannedClips);
  let previousRenderedEndMs: number | undefined;
  renderReadyPlannedClips.forEach((clip, index) => {
    const clipNumber = index + 1;
    const startMs = assertPlannedSmartSliceMilliseconds(clip.startMs, clipNumber, 'startMs');
    const durationMs = assertPositivePlannedSmartSliceMilliseconds(clip.durationMs, clipNumber, 'durationMs');
    const renderedEndMs = startMs + durationMs;
    if (!Number.isFinite(renderedEndMs)) {
      throw new Error(`Smart slicing requires semantic planned clip ${clipNumber} end time to be finite.`);
    }
    if (previousRenderedEndMs !== undefined && startMs < previousRenderedEndMs) {
      throw new Error(
        `Smart slicing requires semantic planned clip ${clipNumber} to start after the previous rendered clip ends.`,
      );
    }
    if (trustedSourceDurationMs !== undefined && renderedEndMs > trustedSourceDurationMs) {
      throw new Error(
        `Smart slicing requires semantic planned clip ${clipNumber} to stay inside the imported media duration.`,
      );
    }

    const sourceStartMs = assertPlannedSmartSliceMilliseconds(
      clip.sourceStartMs ?? startMs,
      clipNumber,
      'sourceStartMs',
    );
    const sourceEndMs = assertPlannedSmartSliceMilliseconds(
      clip.sourceEndMs ?? renderedEndMs,
      clipNumber,
      'sourceEndMs',
    );
    if (
      typeof clip.speechStartMs !== 'number' ||
      typeof clip.speechEndMs !== 'number' ||
      !Number.isFinite(clip.speechStartMs) ||
      !Number.isFinite(clip.speechEndMs)
    ) {
      throw new Error(
        `Smart slicing requires semantic planned clip ${clipNumber} explicit STT speechStartMs and speechEndMs before audio cleanup.`,
      );
    }
    const speechStartMs = assertPlannedSmartSliceMilliseconds(clip.speechStartMs, clipNumber, 'speechStartMs');
    const speechEndMs = assertPlannedSmartSliceMilliseconds(clip.speechEndMs, clipNumber, 'speechEndMs');

    if (sourceEndMs <= sourceStartMs) {
      throw new Error(`Smart slicing requires semantic planned clip ${clipNumber} sourceEndMs to be after sourceStartMs.`);
    }
    if (sourceStartMs < startMs || sourceEndMs > renderedEndMs) {
      throw new Error(
        `Smart slicing requires semantic planned clip ${clipNumber} source range to stay inside its rendered clip timing.`,
      );
    }
    if (speechEndMs <= speechStartMs || speechStartMs < sourceStartMs || speechEndMs > sourceEndMs) {
      throw new Error(
        `Smart slicing requires semantic planned clip ${clipNumber} speech range to stay inside its source range. ${formatSmartSliceNativeRenderClipRuntimeParams(clip, clipNumber, startMs, durationMs, sourceStartMs, sourceEndMs, speechStartMs, speechEndMs)}`,
      );
    }

    const clipTranscriptSegments = createVideoSliceTranscriptSegments(
      { ...clip, sourceStartMs, sourceEndMs },
      { startMs, durationMs } as AutoCutVideoSliceArtifactResult,
      sourceBoundedTranscriptSegments,
    );
    const expectedTranscriptText = createVideoSliceTranscriptText(clipTranscriptSegments);
    const computedTranscriptCoverageScore = createSmartSliceTranscriptEvidenceCoverageScore(
      clipTranscriptSegments,
      speechStartMs,
      speechEndMs,
    );
    const transcriptEvidenceRuntimeParams = {
      computedTranscriptSegmentCount: clipTranscriptSegments.length,
      computedTranscriptCoverageScore,
      computedTranscriptText: expectedTranscriptText,
    };
    if (clipTranscriptSegments.length === 0) {
      throw new Error(
        `Smart slicing requires semantic planned clip ${clipNumber} structured speech-to-text transcript segments before audio cleanup. ${formatSmartSliceNativeRenderClipRuntimeParams(clip, clipNumber, startMs, durationMs, sourceStartMs, sourceEndMs, speechStartMs, speechEndMs, transcriptEvidenceRuntimeParams)}`,
      );
    }
    if (
      Array.isArray(clip.sourceSegments) &&
      clip.sourceSegments.length > 1 &&
      !doesSmartSliceSourceSegmentsCoverSpeechEvidence(clip, clip.sourceSegments, clipTranscriptSegments)
    ) {
      throw new Error(
        `Smart slicing requires semantic planned clip ${clipNumber} retained sourceSegments to cover every structured speech-to-text transcript segment. ${formatSmartSliceNativeRenderClipRuntimeParams(clip, clipNumber, startMs, durationMs, sourceStartMs, sourceEndMs, speechStartMs, speechEndMs, transcriptEvidenceRuntimeParams)}`,
      );
    }
    if (
      typeof clip.transcriptSegmentCount === 'number' &&
      clip.transcriptSegmentCount !== clipTranscriptSegments.length
    ) {
      throw new Error(
        `Smart slicing requires semantic planned clip ${clipNumber} transcriptSegmentCount to match structured speech-to-text coverage. ${formatSmartSliceNativeRenderClipRuntimeParams(clip, clipNumber, startMs, durationMs, sourceStartMs, sourceEndMs, speechStartMs, speechEndMs, transcriptEvidenceRuntimeParams)}`,
      );
    }
    if (!expectedTranscriptText) {
      throw new Error(
        `Smart slicing requires semantic planned clip ${clipNumber} visible speech-to-text transcript text before audio cleanup. ${formatSmartSliceNativeRenderClipRuntimeParams(clip, clipNumber, startMs, durationMs, sourceStartMs, sourceEndMs, speechStartMs, speechEndMs, transcriptEvidenceRuntimeParams)}`,
      );
    }
    if (
      clip.transcriptText &&
      normalizeVideoSliceTranscriptEvidenceText(clip.transcriptText) !== expectedTranscriptText
    ) {
      throw new Error(
        `Smart slicing requires semantic planned clip ${clipNumber} transcriptText to match structured speech-to-text coverage. ${formatSmartSliceNativeRenderClipRuntimeParams(clip, clipNumber, startMs, durationMs, sourceStartMs, sourceEndMs, speechStartMs, speechEndMs, transcriptEvidenceRuntimeParams)}`,
      );
    }
    if (
      typeof clip.transcriptCoverageScore !== 'number' ||
      !Number.isFinite(clip.transcriptCoverageScore) ||
      clip.transcriptCoverageScore < MIN_SMART_SLICE_TRANSCRIPT_COVERAGE_SCORE
    ) {
      throw new Error(
        `Smart slicing requires semantic planned clip ${clipNumber} transcriptCoverageScore to be at least ${MIN_SMART_SLICE_TRANSCRIPT_COVERAGE_SCORE}. ${formatSmartSliceNativeRenderClipRuntimeParams(clip, clipNumber, startMs, durationMs, sourceStartMs, sourceEndMs, speechStartMs, speechEndMs, transcriptEvidenceRuntimeParams)}`,
      );
    }
    if (
      !SMART_SLICE_ACCEPTED_SPEECH_CONTINUITY_GRADES.includes(
        clip.speechContinuityGrade as typeof SMART_SLICE_ACCEPTED_SPEECH_CONTINUITY_GRADES[number],
      )
    ) {
      throw new Error(
        `Smart slicing requires semantic planned clip ${clipNumber} speechContinuityGrade to be strong or repaired. ${formatSmartSliceNativeRenderClipRuntimeParams(clip, clipNumber, startMs, durationMs, sourceStartMs, sourceEndMs, speechStartMs, speechEndMs, transcriptEvidenceRuntimeParams)}`,
      );
    }

    const firstTranscriptSegmentStartMs = clipTranscriptSegments[0]?.startMs;
    const lastTranscriptSegmentEndMs = clipTranscriptSegments.at(-1)?.endMs;
    if (
      firstTranscriptSegmentStartMs === undefined ||
      lastTranscriptSegmentEndMs === undefined ||
      firstTranscriptSegmentStartMs > speechStartMs + SMART_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS ||
      lastTranscriptSegmentEndMs < speechEndMs - SMART_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS
    ) {
      throw new Error(
        `Smart slicing requires semantic planned clip ${clipNumber} speech range to stay covered by structured transcript segment boundaries. ${formatSmartSliceNativeRenderClipRuntimeParams(clip, clipNumber, startMs, durationMs, sourceStartMs, sourceEndMs, speechStartMs, speechEndMs, transcriptEvidenceRuntimeParams)}`,
      );
    }

    previousRenderedEndMs = renderedEndMs;
  });
  assertSmartSlicePlanCoversEligibleTranscriptSpeech(renderReadyPlannedClips, sourceBoundedTranscriptSegments);
}

export function assertSmartSlicePlanReadyForNativeRender(
  plannedClips: readonly NormalizedSlicePlanClip[],
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
  sourceDurationMs?: number,
) {
  if (plannedClips.length === 0) {
    throw new Error('Smart slicing requires at least one planned clip before native rendering.');
  }
  if (transcriptSegments.length === 0) {
    throw new Error(
      'Smart slicing requires structured speech-to-text transcript segments before native rendering.',
    );
  }

  const trustedSourceDurationMs =
    typeof sourceDurationMs === 'number' && Number.isFinite(sourceDurationMs) && sourceDurationMs > 0
      ? Math.round(sourceDurationMs)
      : undefined;
  const sourceBoundedTranscriptSegments = normalizeSmartSliceTranscriptTimelineForSourceDuration(
    transcriptSegments,
    trustedSourceDurationMs,
  );
  assertSmartSliceTranscriptTimelineWithinSourceDuration(
    sourceBoundedTranscriptSegments,
    trustedSourceDurationMs,
    'native rendering',
  );
  const renderReadyPlannedClips = normalizeSmartSlicePlanSourceSegmentsForNativeRender(plannedClips);
  let previousRenderedEndMs: number | undefined;

  renderReadyPlannedClips.forEach((clip, index) => {
    const clipNumber = index + 1;
    const startMs = assertPlannedSmartSliceMilliseconds(clip.startMs, clipNumber, 'startMs');
    const durationMs = assertPositivePlannedSmartSliceMilliseconds(clip.durationMs, clipNumber, 'durationMs');
    const renderedEndMs = startMs + durationMs;
    if (!Number.isFinite(renderedEndMs)) {
      throw new Error(`Smart slicing requires planned clip ${clipNumber} end time to be finite.`);
    }
    if (previousRenderedEndMs !== undefined && startMs < previousRenderedEndMs) {
      throw new Error(
        `Smart slicing requires planned clip ${clipNumber} to start after the previous rendered clip ends. previousRenderedEndMs=${previousRenderedEndMs} ${formatSmartSliceNativeRenderClipRuntimeParams(clip, clipNumber, startMs, durationMs, clip.sourceStartMs ?? startMs, clip.sourceEndMs ?? renderedEndMs, clip.speechStartMs ?? clip.sourceStartMs ?? startMs, clip.speechEndMs ?? clip.sourceEndMs ?? renderedEndMs)}`,
      );
    }
    if (trustedSourceDurationMs !== undefined && renderedEndMs > trustedSourceDurationMs) {
      throw new Error(
        `Smart slicing requires planned clip ${clipNumber} to stay inside the imported media duration.`,
      );
    }

    const sourceStartMs = assertPlannedSmartSliceMilliseconds(
      clip.sourceStartMs ?? startMs,
      clipNumber,
      'sourceStartMs',
    );
    const sourceEndMs = assertPlannedSmartSliceMilliseconds(
      clip.sourceEndMs ?? renderedEndMs,
      clipNumber,
      'sourceEndMs',
    );
    if (
      typeof clip.speechStartMs !== 'number' ||
      typeof clip.speechEndMs !== 'number' ||
      !Number.isFinite(clip.speechStartMs) ||
      !Number.isFinite(clip.speechEndMs)
    ) {
      throw new Error(
        `Smart slicing requires planned clip ${clipNumber} explicit STT speechStartMs and speechEndMs before native rendering.`,
      );
    }
    const speechStartMs = assertPlannedSmartSliceMilliseconds(clip.speechStartMs, clipNumber, 'speechStartMs');
    const speechEndMs = assertPlannedSmartSliceMilliseconds(clip.speechEndMs, clipNumber, 'speechEndMs');

    if (sourceEndMs <= sourceStartMs) {
      throw new Error(`Smart slicing requires planned clip ${clipNumber} sourceEndMs to be after sourceStartMs.`);
    }
    if (sourceStartMs < startMs || sourceEndMs > renderedEndMs) {
      throw new Error(
        `Smart slicing requires planned clip ${clipNumber} source range to stay inside its rendered clip timing.`,
      );
    }
    if (speechEndMs <= speechStartMs || speechStartMs < sourceStartMs || speechEndMs > sourceEndMs) {
      throw new Error(
        `Smart slicing requires planned clip ${clipNumber} speech range to stay inside its rendered source range. ${formatSmartSliceNativeRenderClipRuntimeParams(clip, clipNumber, startMs, durationMs, sourceStartMs, sourceEndMs, speechStartMs, speechEndMs)}`,
      );
    }

    const leadingSilenceMs = speechStartMs - sourceStartMs;
    const trailingSilenceMs = sourceEndMs - speechEndMs;
    if (
      leadingSilenceMs > MAX_SMART_SLICE_LEADING_SILENCE_MS ||
      trailingSilenceMs > MAX_SMART_SLICE_TRAILING_SILENCE_MS
    ) {
      throw new Error(
        `Smart slicing requires planned clip ${clipNumber} to keep no more than ${MAX_SMART_SLICE_LEADING_SILENCE_MS}ms leading and ${MAX_SMART_SLICE_TRAILING_SILENCE_MS}ms trailing silence around speech.`,
      );
    }
    assertTrustedSmartSliceAudioActivityPadding(
      clip,
      sourceStartMs,
      sourceEndMs,
      `planned clip ${clipNumber}`,
      { requireTrustedEvidence: hasPostCleanupSmartSliceAudioEvidenceShape(clip) },
    );
    assertSmartSliceSourceSegmentsReadyForNativeRender(
      clip,
      clipNumber,
      startMs,
      durationMs,
      sourceStartMs,
      sourceEndMs,
      speechStartMs,
      speechEndMs,
    );

    const clipTranscriptSegments = createVideoSliceTranscriptSegments(
      { ...clip, sourceStartMs, sourceEndMs },
      { startMs, durationMs } as AutoCutVideoSliceArtifactResult,
      sourceBoundedTranscriptSegments,
    );
    const expectedTranscriptText = createVideoSliceTranscriptText(clipTranscriptSegments);
    const computedTranscriptCoverageScore = createSmartSliceTranscriptEvidenceCoverageScore(
      clipTranscriptSegments,
      speechStartMs,
      speechEndMs,
    );
    const transcriptEvidenceRuntimeParams = {
      computedTranscriptSegmentCount: clipTranscriptSegments.length,
      computedTranscriptCoverageScore,
      computedTranscriptText: expectedTranscriptText,
    };
    if (clipTranscriptSegments.length === 0) {
      throw new Error(
        `Smart slicing requires planned clip ${clipNumber} structured speech-to-text transcript segments before native rendering. ${formatSmartSliceNativeRenderClipRuntimeParams(clip, clipNumber, startMs, durationMs, sourceStartMs, sourceEndMs, speechStartMs, speechEndMs, transcriptEvidenceRuntimeParams)}`,
      );
    }
    if (
      Array.isArray(clip.sourceSegments) &&
      clip.sourceSegments.length > 1 &&
      !doesSmartSliceSourceSegmentsCoverSpeechEvidence(clip, clip.sourceSegments, clipTranscriptSegments)
    ) {
      throw new Error(
        `Smart slicing requires planned clip ${clipNumber} retained sourceSegments to cover every structured speech-to-text transcript segment. ${formatSmartSliceNativeRenderClipRuntimeParams(clip, clipNumber, startMs, durationMs, sourceStartMs, sourceEndMs, speechStartMs, speechEndMs, transcriptEvidenceRuntimeParams)}`,
      );
    }
    if (
      typeof clip.transcriptSegmentCount === 'number' &&
      clip.transcriptSegmentCount !== clipTranscriptSegments.length
    ) {
      throw new Error(
        `Smart slicing requires planned clip ${clipNumber} transcriptSegmentCount to match structured speech-to-text coverage. ${formatSmartSliceNativeRenderClipRuntimeParams(clip, clipNumber, startMs, durationMs, sourceStartMs, sourceEndMs, speechStartMs, speechEndMs, transcriptEvidenceRuntimeParams)}`,
      );
    }

    if (!expectedTranscriptText) {
      throw new Error(
        `Smart slicing requires planned clip ${clipNumber} visible speech-to-text transcript text before native rendering. ${formatSmartSliceNativeRenderClipRuntimeParams(clip, clipNumber, startMs, durationMs, sourceStartMs, sourceEndMs, speechStartMs, speechEndMs, transcriptEvidenceRuntimeParams)}`,
      );
    }
    if (
      clip.transcriptText &&
      normalizeVideoSliceTranscriptEvidenceText(clip.transcriptText) !== expectedTranscriptText
    ) {
      throw new Error(
        `Smart slicing requires planned clip ${clipNumber} transcriptText to match structured speech-to-text coverage. ${formatSmartSliceNativeRenderClipRuntimeParams(clip, clipNumber, startMs, durationMs, sourceStartMs, sourceEndMs, speechStartMs, speechEndMs, transcriptEvidenceRuntimeParams)}`,
      );
    }
    if (
      typeof clip.transcriptCoverageScore !== 'number' ||
      !Number.isFinite(clip.transcriptCoverageScore) ||
      clip.transcriptCoverageScore < MIN_SMART_SLICE_TRANSCRIPT_COVERAGE_SCORE
    ) {
      throw new Error(
        `Smart slicing requires planned clip ${clipNumber} transcriptCoverageScore to be at least ${MIN_SMART_SLICE_TRANSCRIPT_COVERAGE_SCORE}. ${formatSmartSliceNativeRenderClipRuntimeParams(clip, clipNumber, startMs, durationMs, sourceStartMs, sourceEndMs, speechStartMs, speechEndMs, transcriptEvidenceRuntimeParams)}`,
      );
    }
    if (
      !SMART_SLICE_ACCEPTED_SPEECH_CONTINUITY_GRADES.includes(
        clip.speechContinuityGrade as typeof SMART_SLICE_ACCEPTED_SPEECH_CONTINUITY_GRADES[number],
      )
    ) {
      throw new Error(
        `Smart slicing requires planned clip ${clipNumber} speechContinuityGrade to be strong or repaired. ${formatSmartSliceNativeRenderClipRuntimeParams(clip, clipNumber, startMs, durationMs, sourceStartMs, sourceEndMs, speechStartMs, speechEndMs, transcriptEvidenceRuntimeParams)}`,
      );
    }

    const firstTranscriptSegmentStartMs = clipTranscriptSegments[0]?.startMs;
    const lastTranscriptSegmentEndMs = clipTranscriptSegments.at(-1)?.endMs;
    if (
      firstTranscriptSegmentStartMs === undefined ||
      lastTranscriptSegmentEndMs === undefined ||
      firstTranscriptSegmentStartMs > speechStartMs + SMART_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS ||
      lastTranscriptSegmentEndMs < speechEndMs - SMART_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS
    ) {
      throw new Error(
        `Smart slicing requires planned clip ${clipNumber} speech range to stay covered by structured transcript segment boundaries. ${formatSmartSliceNativeRenderClipRuntimeParams(clip, clipNumber, startMs, durationMs, sourceStartMs, sourceEndMs, speechStartMs, speechEndMs, transcriptEvidenceRuntimeParams)}`,
      );
    }

    previousRenderedEndMs = renderedEndMs;
  });
  assertSmartSlicePlanCoversEligibleTranscriptSpeech(renderReadyPlannedClips, sourceBoundedTranscriptSegments);
}

type SmartSliceAudioActivityAnalysisResult = Awaited<
  ReturnType<ReturnType<typeof getAutoCutNativeHostClient>['analyzeVideoSliceAudioActivity']>
>;

async function analyzeAndRefineSmartSliceAudioBoundaries(
  nativeHostClient: ReturnType<typeof getAutoCutNativeHostClient>,
  workflowTaskId: string,
  sourceAssetUuid: string,
  plannedClips: readonly NormalizedSlicePlanClip[],
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
  params: VideoSliceParams,
  outputRootDir: string | undefined,
  noiseReductionApplied: boolean,
): Promise<SmartSliceAudioCleanupAttemptResult> {
  const analysisRequestClips = plannedClips.map((clip) =>
    toNativeSliceClipRequest(
      {
        ...clip,
        audioCleanupProfile: SMART_SLICE_AUDIO_CLEANUP_PROFILE,
        noiseReductionApplied,
        boundaryDecisionSource: 'transcript',
        tailTreatment: clip.tailTreatment ?? 'none',
      },
      transcriptSegments,
      params,
    )
  );
  const audioAnalysisPlanClips = createSmartSliceAudioAnalysisPlanClips(
    plannedClips,
    analysisRequestClips,
  );

  reportVideoSliceStageDiagnostic('audio boundary analysis started', {
    sourceAssetUuid,
    plannedClipCount: analysisRequestClips.length,
    profile: SMART_SLICE_AUDIO_CLEANUP_PROFILE,
    noiseReduction: noiseReductionApplied,
  });

  let audioActivityResult: SmartSliceAudioActivityAnalysisResult;
  try {
    audioActivityResult = await nativeHostClient.analyzeVideoSliceAudioActivity({
      assetUuid: sourceAssetUuid,
      workflowTaskId,
      profile: SMART_SLICE_AUDIO_CLEANUP_PROFILE,
      applyNoiseReduction: noiseReductionApplied,
      ...(outputRootDir ? { outputRootDir } : {}),
      clips: analysisRequestClips,
    });
  } catch (analysisError) {
    throw new Error(
      `Smart slicing requires ${createSmartSliceAudioBoundaryAnalysisRequirementLabel(noiseReductionApplied)} before native rendering. ${String(analysisError)}`,
    );
  }

  try {
    assertSmartSliceAudioActivityAnalysisComplete(
      audioActivityResult,
      audioAnalysisPlanClips,
      sourceAssetUuid,
      noiseReductionApplied,
    );
  } catch (analysisValidationError) {
    throw analysisValidationError;
  }
  const refinedClips = refineSmartSlicePlanWithAudioActivityBoundaries(
    plannedClips,
    audioActivityResult.analyses,
    { noiseReductionApplied },
  ).map((clip, index) =>
    createSmartSliceSilenceCompactedClip(
      clip,
      createVideoSliceTranscriptSegments(
        clip,
        { startMs: clip.startMs, durationMs: clip.durationMs } as AutoCutVideoSliceArtifactResult,
        transcriptSegments,
      ),
      audioActivityResult.analyses[index],
    )
  );

  return {
    audioActivityResult,
    refinedClips,
    noiseReductionApplied,
  };
}

async function analyzeAndRefineSmartSliceAudioBoundariesWithDenoiseFallback(
  nativeHostClient: ReturnType<typeof getAutoCutNativeHostClient>,
  workflowTaskId: string,
  sourceAssetUuid: string,
  plannedClips: readonly NormalizedSlicePlanClip[],
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
  params: VideoSliceParams,
  outputRootDir: string | undefined,
  sourceDurationMs: number | undefined,
): Promise<SmartSliceAudioCleanupAttemptResult> {
  const initialNoiseReductionApplied = shouldStartSmartSliceWithNoiseReduction(params);
  let rawAttempt: SmartSliceAudioCleanupAttemptResult;
  try {
    rawAttempt = await analyzeAndRefineSmartSliceAudioBoundaries(
      nativeHostClient,
      workflowTaskId,
      sourceAssetUuid,
      plannedClips,
      transcriptSegments,
      params,
      outputRootDir,
      initialNoiseReductionApplied,
    );
  } catch (rawAnalysisError) {
    if (
      !isRepairableSmartSliceRawAudioAnalysisError(rawAnalysisError) ||
      !shouldAllowSmartSliceNoiseReduction(params) ||
      initialNoiseReductionApplied
    ) {
      throw rawAnalysisError;
    }

    reportVideoSliceStageDiagnostic('raw audio boundary analysis fallback to denoise', {
      sourceAssetUuid,
      plannedClipCount: plannedClips.length,
      profile: SMART_SLICE_AUDIO_CLEANUP_PROFILE,
      errorMessage: rawAnalysisError instanceof Error ? rawAnalysisError.message : String(rawAnalysisError),
    });
    const denoisedAttempt = await analyzeAndRefineSmartSliceAudioBoundaries(
      nativeHostClient,
      workflowTaskId,
      sourceAssetUuid,
      plannedClips,
      transcriptSegments,
      params,
      outputRootDir,
      SMART_SLICE_FALLBACK_NOISE_REDUCTION_APPLIED,
    );
    return finalizeSmartSliceAudioCleanupAttemptForNativeRender(
      nativeHostClient,
      workflowTaskId,
      sourceAssetUuid,
      denoisedAttempt,
      transcriptSegments,
      params,
      outputRootDir,
      sourceDurationMs,
      SMART_SLICE_FALLBACK_NOISE_REDUCTION_APPLIED,
    );
  }

  try {
    return await finalizeSmartSliceAudioCleanupAttemptForNativeRender(
      nativeHostClient,
      workflowTaskId,
      sourceAssetUuid,
      rawAttempt,
      transcriptSegments,
      params,
      outputRootDir,
      sourceDurationMs,
      initialNoiseReductionApplied,
    );
  } catch (rawReadinessError) {
    if (
      (
        !isRepairableSmartSliceRawAudioPaddingReadinessError(rawReadinessError) &&
        !isRepairableSmartSliceTranscriptCoverageReadinessError(rawReadinessError) &&
        !isRepairableSmartSliceRenderTimelineReadinessError(rawReadinessError)
      ) ||
      !shouldAllowSmartSliceNoiseReduction(params) ||
      initialNoiseReductionApplied
    ) {
      throw rawReadinessError;
    }

    reportVideoSliceStageDiagnostic('raw audio boundary padding fallback to denoise', {
      sourceAssetUuid,
      plannedClipCount: plannedClips.length,
      profile: SMART_SLICE_AUDIO_CLEANUP_PROFILE,
      errorMessage: rawReadinessError instanceof Error ? rawReadinessError.message : String(rawReadinessError),
    });
    const denoisedAttempt = await analyzeAndRefineSmartSliceAudioBoundaries(
      nativeHostClient,
      workflowTaskId,
      sourceAssetUuid,
      plannedClips,
      transcriptSegments,
      params,
      outputRootDir,
      SMART_SLICE_FALLBACK_NOISE_REDUCTION_APPLIED,
    );
    return finalizeSmartSliceAudioCleanupAttemptForNativeRender(
      nativeHostClient,
      workflowTaskId,
      sourceAssetUuid,
      denoisedAttempt,
      transcriptSegments,
      params,
      outputRootDir,
      sourceDurationMs,
      SMART_SLICE_FALLBACK_NOISE_REDUCTION_APPLIED,
    );
  }
}

function isRepairableSmartSliceRawAudioPaddingReadinessError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('audio activity padding');
}

function isRepairableSmartSliceTranscriptCoverageReadinessError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('cover every eligible transcript speech segment');
}

function isRepairableSmartSliceRenderTimelineReadinessError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('to start after the previous rendered clip ends');
}

function isRepairableSmartSlicePlannedSpeechPaddingReadinessError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('planned clip') &&
    message.includes('leading and 250ms trailing silence around speech');
}

function createSmartSliceNativeRenderRepairParams(
  params: VideoSliceParams,
  sourceDurationMs: number | undefined,
): VideoSliceParams {
  return {
    ...params,
    ...(typeof sourceDurationMs === 'number' && Number.isFinite(sourceDurationMs) && sourceDurationMs > 0
      ? { sourceDurationMs: Math.round(sourceDurationMs) }
      : {}),
  };
}

function haveSameSmartSliceAudioAnalysisPlanTiming(
  firstPlan: readonly NormalizedSlicePlanClip[],
  secondPlan: readonly NormalizedSlicePlanClip[],
) {
  return firstPlan.length === secondPlan.length &&
    firstPlan.every((firstClip, index) => {
      const secondClip = secondPlan[index];
      return secondClip !== undefined &&
        firstClip.startMs === secondClip.startMs &&
        firstClip.durationMs === secondClip.durationMs &&
        firstClip.sourceStartMs === secondClip.sourceStartMs &&
        firstClip.sourceEndMs === secondClip.sourceEndMs &&
        firstClip.speechStartMs === secondClip.speechStartMs &&
        firstClip.speechEndMs === secondClip.speechEndMs &&
        firstClip.transcriptText === secondClip.transcriptText &&
        firstClip.transcriptSegmentCount === secondClip.transcriptSegmentCount;
    });
}

async function finalizeSmartSliceAudioCleanupAttemptForNativeRender(
  nativeHostClient: ReturnType<typeof getAutoCutNativeHostClient>,
  workflowTaskId: string,
  sourceAssetUuid: string,
  cleanupAttempt: SmartSliceAudioCleanupAttemptResult,
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
  params: VideoSliceParams,
  outputRootDir: string | undefined,
  sourceDurationMs: number | undefined,
  noiseReductionApplied: boolean,
): Promise<SmartSliceAudioCleanupAttemptResult> {
  const renderRepairParams = createSmartSliceNativeRenderRepairParams(params, sourceDurationMs);
  const refreshedClips = refreshSmartSlicePlanTranscriptEvidence(
    cleanupAttempt.refinedClips,
    transcriptSegments,
    sourceDurationMs,
  );
  try {
    assertSmartSlicePlanReadyForNativeRender(
      refreshedClips,
      transcriptSegments,
      sourceDurationMs,
    );
    return {
      ...cleanupAttempt,
      refinedClips: refreshedClips,
    };
  } catch (readinessError) {
    const isTranscriptCoverageReadinessError =
      isRepairableSmartSliceTranscriptCoverageReadinessError(readinessError);
    const isRenderTimelineReadinessError =
      isRepairableSmartSliceRenderTimelineReadinessError(readinessError);
    const isPlannedSpeechPaddingReadinessError =
      isRepairableSmartSlicePlannedSpeechPaddingReadinessError(readinessError);
    const isAudioActivityPaddingReadinessError =
      isRepairableSmartSliceRawAudioPaddingReadinessError(readinessError);
    const canRepairAudioActivityPaddingInCurrentAttempt =
      isAudioActivityPaddingReadinessError &&
      (
        noiseReductionApplied ||
        !shouldAllowSmartSliceNoiseReduction(params)
      );
    if (
      !isTranscriptCoverageReadinessError &&
      !isRenderTimelineReadinessError &&
      !isPlannedSpeechPaddingReadinessError &&
      !canRepairAudioActivityPaddingInCurrentAttempt
    ) {
      throw readinessError;
    }

    const repairedClips = repairSmartSlicePlanForNativeRender(
      refreshedClips,
      transcriptSegments,
      renderRepairParams,
    );
    if (haveSameSmartSliceAudioAnalysisPlanTiming(refreshedClips, repairedClips)) {
      if (!isTranscriptCoverageReadinessError) {
        throw readinessError;
      }
      const forceCoveredClips = forceRepairSmartSliceSourceSegmentCoverage(
        refreshedClips,
        transcriptSegments,
        sourceDurationMs,
      );
      reportVideoSliceStageDiagnostic('audio boundary force coverage repair applied', {
        sourceAssetUuid,
        plannedClipCount: refreshedClips.length,
        profile: SMART_SLICE_AUDIO_CLEANUP_PROFILE,
        noiseReduction: noiseReductionApplied,
        errorMessage: readinessError instanceof Error ? readinessError.message : String(readinessError),
      });
      return {
        ...cleanupAttempt,
        refinedClips: forceCoveredClips,
      };
    }

    reportVideoSliceStageDiagnostic('audio boundary coverage repair reanalysis', {
      sourceAssetUuid,
      plannedClipCount: refreshedClips.length,
      repairedClipCount: repairedClips.length,
      profile: SMART_SLICE_AUDIO_CLEANUP_PROFILE,
      noiseReduction: noiseReductionApplied,
      errorMessage: readinessError instanceof Error ? readinessError.message : String(readinessError),
    });
    const repairedAttempt = await analyzeAndRefineSmartSliceAudioBoundaries(
      nativeHostClient,
      workflowTaskId,
      sourceAssetUuid,
      repairedClips,
      transcriptSegments,
      params,
      outputRootDir,
      noiseReductionApplied,
    );
    const refreshedRepairedClips = refreshSmartSlicePlanTranscriptEvidence(
      repairedAttempt.refinedClips,
      transcriptSegments,
      sourceDurationMs,
    );
    try {
      assertSmartSlicePlanReadyForNativeRender(
        refreshedRepairedClips,
        transcriptSegments,
        sourceDurationMs,
      );
      return {
        ...repairedAttempt,
        refinedClips: refreshedRepairedClips,
      };
    } catch (secondReadinessError) {
      const isSecondTranscriptCoverageReadinessError =
        isRepairableSmartSliceTranscriptCoverageReadinessError(secondReadinessError);
      const isSecondRenderTimelineReadinessError =
        isRepairableSmartSliceRenderTimelineReadinessError(secondReadinessError);
      const isSecondPlannedSpeechPaddingReadinessError =
        isRepairableSmartSlicePlannedSpeechPaddingReadinessError(secondReadinessError);
      const isSecondAudioActivityPaddingReadinessError =
        isRepairableSmartSliceRawAudioPaddingReadinessError(secondReadinessError);
      const canRepairSecondAudioActivityPaddingInCurrentAttempt =
        isSecondAudioActivityPaddingReadinessError &&
        (
          noiseReductionApplied ||
          !shouldAllowSmartSliceNoiseReduction(params)
        );
      if (
        !isSecondTranscriptCoverageReadinessError &&
        !isSecondRenderTimelineReadinessError &&
        !isSecondPlannedSpeechPaddingReadinessError &&
        !canRepairSecondAudioActivityPaddingInCurrentAttempt
      ) {
        throw secondReadinessError;
      }
      if (
        isSecondRenderTimelineReadinessError ||
        isSecondPlannedSpeechPaddingReadinessError ||
        canRepairSecondAudioActivityPaddingInCurrentAttempt
      ) {
        const timelineRepairedClips = repairSmartSlicePlanForNativeRender(
          refreshedRepairedClips,
          transcriptSegments,
          renderRepairParams,
        );
        assertSmartSlicePlanReadyForNativeRender(
          timelineRepairedClips,
          transcriptSegments,
          sourceDurationMs,
        );
        reportVideoSliceStageDiagnostic('audio boundary timeline repair after reanalysis', {
          sourceAssetUuid,
          plannedClipCount: refreshedRepairedClips.length,
          repairedClipCount: timelineRepairedClips.length,
          profile: SMART_SLICE_AUDIO_CLEANUP_PROFILE,
          noiseReduction: noiseReductionApplied,
          errorMessage: secondReadinessError instanceof Error ? secondReadinessError.message : String(secondReadinessError),
        });
        return {
          ...repairedAttempt,
          refinedClips: timelineRepairedClips,
        };
      }
      const forceCoveredClips = forceRepairSmartSliceSourceSegmentCoverage(
        refreshedRepairedClips,
        transcriptSegments,
        sourceDurationMs,
      );
      reportVideoSliceStageDiagnostic('audio boundary force coverage repair after reanalysis', {
        sourceAssetUuid,
        plannedClipCount: refreshedRepairedClips.length,
        profile: SMART_SLICE_AUDIO_CLEANUP_PROFILE,
        noiseReduction: noiseReductionApplied,
        errorMessage: secondReadinessError instanceof Error ? secondReadinessError.message : String(secondReadinessError),
      });
      return {
        ...repairedAttempt,
        refinedClips: forceCoveredClips,
      };
    }
  }
}

function isRepairableSmartSliceRawAudioAnalysisError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith('Smart slicing requires audio boundary analysis before native rendering.');
}

function assertSmartSliceAudioActivityAnalysisComplete(
  audioActivityResult: unknown,
  plannedClips: readonly Pick<
    NormalizedSlicePlanClip,
    'startMs' | 'durationMs' | 'sourceStartMs' | 'sourceEndMs'
  >[],
  sourceAssetUuid: string,
  noiseReductionApplied: boolean,
): asserts audioActivityResult is SmartSliceAudioActivityAnalysisResult {
  const analysisRequirementLabel = createSmartSliceAudioBoundaryAnalysisRequirementLabel(noiseReductionApplied);
  const requiredAudioActivityAnalysisFilter =
    getSmartSliceRequiredAudioActivityAnalysisFilter(noiseReductionApplied);
  if (!audioActivityResult || typeof audioActivityResult !== 'object') {
    throw new Error(
      `Smart slicing requires complete ${analysisRequirementLabel} before native rendering.`,
    );
  }

  const resultEnvelope = audioActivityResult as Partial<SmartSliceAudioActivityAnalysisResult> & {
    analyses?: unknown;
  };
  if (resultEnvelope.assetUuid !== sourceAssetUuid) {
    throw new Error(
      `Smart slicing requires complete ${analysisRequirementLabel} for the selected source asset before native rendering.`,
    );
  }
  if (resultEnvelope.profile !== SMART_SLICE_AUDIO_CLEANUP_PROFILE) {
    throw new Error(
      `Smart slicing requires complete ${analysisRequirementLabel} with profile ${SMART_SLICE_AUDIO_CLEANUP_PROFILE} before native rendering.`,
    );
  }
  if (!Array.isArray(resultEnvelope.analyses)) {
    throw new Error(
      `Smart slicing requires complete ${analysisRequirementLabel} for every planned clip before native rendering.`,
    );
  }

  const analyses = resultEnvelope.analyses as SmartSliceAudioActivityAnalysisResult['analyses'];
  if (analyses.length !== plannedClips.length) {
    throw new Error(
      `Smart slicing requires complete ${analysisRequirementLabel} for every planned clip before native rendering. Expected ${plannedClips.length} analyses but received ${analyses.length}.`,
    );
  }

  const expectedIndexes = new Set(plannedClips.map((_, index) => index));
  const seenIndexes = new Set<number>();
  analyses.forEach((analysis) => {
    if (!expectedIndexes.has(analysis.index) || seenIndexes.has(analysis.index)) {
      throw new Error(
        `Smart slicing requires complete ${analysisRequirementLabel} with one unique result for each planned clip before native rendering.`,
      );
    }
    seenIndexes.add(analysis.index);
    const plannedClip = plannedClips[analysis.index];
    if (!plannedClip) {
      throw new Error(
        `Smart slicing requires complete ${analysisRequirementLabel} to match planned clip indexes before native rendering.`,
      );
    }
    const plannedSourceStartMs = plannedClip.sourceStartMs ?? plannedClip.startMs;
    const plannedSourceEndMs = plannedClip.sourceEndMs ?? plannedClip.startMs + plannedClip.durationMs;
    if (
      analysis.startMs !== plannedClip.startMs ||
      analysis.durationMs !== plannedClip.durationMs ||
      analysis.sourceStartMs !== plannedSourceStartMs ||
      analysis.sourceEndMs !== plannedSourceEndMs
    ) {
      throw new Error(
        `Smart slicing requires ${analysisRequirementLabel} timing to match the planned clip before native rendering.`,
      );
    }
    const audioActivityAnalysisFilter = typeof analysis.analysisFilter === 'string'
      ? analysis.analysisFilter.trim()
      : '';
    if (
      typeof analysis.confidence !== 'number' ||
      !Number.isFinite(analysis.confidence) ||
      analysis.confidence < MIN_SMART_SLICE_AUDIO_ACTIVITY_CONFIDENCE ||
      typeof analysis.audioActivityStartMs !== 'number' ||
      typeof analysis.audioActivityEndMs !== 'number' ||
      !Number.isFinite(analysis.audioActivityStartMs) ||
      !Number.isFinite(analysis.audioActivityEndMs) ||
      analysis.audioActivityEndMs <= analysis.audioActivityStartMs ||
      analysis.analysisFilter !== requiredAudioActivityAnalysisFilter ||
      audioActivityAnalysisFilter !== requiredAudioActivityAnalysisFilter
    ) {
      throw new Error(
        `Smart slicing requires high-confidence ${analysisRequirementLabel} activity evidence before native rendering.`,
      );
    }
    if (
      analysis.audioActivityStartMs < plannedSourceStartMs ||
      analysis.audioActivityEndMs > plannedSourceEndMs
    ) {
      throw new Error(
        `Smart slicing requires ${analysisRequirementLabel} activity range to stay inside planned source range before native rendering.`,
      );
    }
  });
}

function createSmartSliceAudioAnalysisPlanClips(
  plannedClips: readonly NormalizedSlicePlanClip[],
  analysisRequestClips: readonly AutoCutVideoSliceClipRequest[],
): NormalizedSlicePlanClip[] {
  return plannedClips.map((clip, index) => {
    const requestClip = analysisRequestClips[index];
    if (!requestClip) {
      return clip;
    }

    return {
      ...clip,
      startMs: requestClip.startMs,
      durationMs: requestClip.durationMs,
      ...(requestClip.sourceStartMs !== undefined ? { sourceStartMs: requestClip.sourceStartMs } : {}),
      ...(requestClip.sourceEndMs !== undefined ? { sourceEndMs: requestClip.sourceEndMs } : {}),
      ...(requestClip.speechStartMs !== undefined ? { speechStartMs: requestClip.speechStartMs } : {}),
      ...(requestClip.speechEndMs !== undefined ? { speechEndMs: requestClip.speechEndMs } : {}),
      ...(requestClip.boundaryPaddingBeforeMs !== undefined
        ? { boundaryPaddingBeforeMs: requestClip.boundaryPaddingBeforeMs }
        : {}),
      ...(requestClip.boundaryPaddingAfterMs !== undefined
        ? { boundaryPaddingAfterMs: requestClip.boundaryPaddingAfterMs }
        : {}),
      ...(requestClip.sourceSegments?.length ? { sourceSegments: requestClip.sourceSegments } : {}),
      ...(requestClip.renderedDurationMs !== undefined ? { renderedDurationMs: requestClip.renderedDurationMs } : {}),
      ...(requestClip.removedSilenceMs !== undefined ? { removedSilenceMs: requestClip.removedSilenceMs } : {}),
      ...(requestClip.internalSilenceTrimCount !== undefined
        ? { internalSilenceTrimCount: requestClip.internalSilenceTrimCount }
        : {}),
      ...(requestClip.transcriptText ? { transcriptText: requestClip.transcriptText } : {}),
      ...(requestClip.transcriptSegments?.length ? { transcriptSegments: requestClip.transcriptSegments } : {}),
      ...(requestClip.transcriptSegmentCount !== undefined
        ? { transcriptSegmentCount: requestClip.transcriptSegmentCount }
        : {}),
      ...(requestClip.transcriptCoverageScore !== undefined
        ? { transcriptCoverageScore: requestClip.transcriptCoverageScore }
        : {}),
      ...(requestClip.speechContinuityGrade ? { speechContinuityGrade: requestClip.speechContinuityGrade } : {}),
      ...(requestClip.risks ? { risks: requestClip.risks } : {}),
    };
  });
}

function assertNativeSliceArtifactsMatchPlan(
  nativeSlices: readonly AutoCutVideoSliceArtifactResult[],
  plannedClips: readonly NormalizedSlicePlanClip[],
  nativeTaskOutputDir: unknown,
  subtitleRequest: VideoSliceSubtitleRequestProjection = {},
) {
  if (nativeSlices.length !== plannedClips.length) {
    throw new Error(
      `AutoCut native video slicing returned ${nativeSlices.length} slice artifacts for ${plannedClips.length} planned clips.`,
    );
  }

  const taskResultOutputDir = assertRequiredNativeTaskText(nativeTaskOutputDir, 'taskOutputDir');
  nativeSlices.forEach((nativeSlice, index) => {
    const sliceNumber = index + 1;
    assertRequiredNativeSliceText(nativeSlice.artifactUuid, sliceNumber, 'artifactUuid');
    const artifactPath = assertRequiredNativeSliceText(nativeSlice.artifactPath, sliceNumber, 'artifactPath');
    assertRequiredNativeSliceText(nativeSlice.thumbnailArtifactUuid, sliceNumber, 'thumbnailArtifactUuid');
    const thumbnailPath = assertRequiredNativeSliceText(
      nativeSlice.thumbnailArtifactPath,
      sliceNumber,
      'thumbnailArtifactPath',
    );
    const taskOutputDir = assertRequiredNativeSliceText(nativeSlice.taskOutputDir, sliceNumber, 'taskOutputDir');
    assertNativeSliceTaskOutputDirMatchesResult(taskOutputDir, taskResultOutputDir, sliceNumber);
    assertNativeSlicePathInsideTaskOutputDir(artifactPath, taskOutputDir, sliceNumber, 'artifactPath');
    assertNativeSliceThumbnailPathInsideCoverDir(thumbnailPath, taskOutputDir, sliceNumber);
    if (nativeSlice.subtitleArtifactPath) {
      assertNativeSlicePathInsideTaskOutputDir(
        nativeSlice.subtitleArtifactPath,
        taskOutputDir,
        sliceNumber,
        'subtitleArtifactPath',
      );
    }
    assertPositiveNativeSliceNumber(nativeSlice.byteSize, sliceNumber, 'byteSize');
    assertPositiveNativeSliceNumber(nativeSlice.thumbnailByteSize, sliceNumber, 'thumbnailByteSize');
    assertNonNegativeNativeSliceNumber(nativeSlice.startMs, sliceNumber, 'startMs');
    assertPositiveNativeSliceNumber(nativeSlice.durationMs, sliceNumber, 'durationMs');
    const plannedClip = plannedClips[index];
    const renderReadyPlannedClip = plannedClip
      ? normalizeSmartSlicePlannedClipSourceSegmentsForContinuousFallback(plannedClip)
      : undefined;
    const renderReadyNativeSlice = normalizeNativeSliceArtifactSourceSegmentsForPlan(
      nativeSlice,
      renderReadyPlannedClip,
    );
    assertNativeSliceTimingMatchesPlan(renderReadyNativeSlice, renderReadyPlannedClip, sliceNumber);
    assertNativeSliceAudioCleanupMetadataMatchesPlan(renderReadyNativeSlice, renderReadyPlannedClip, sliceNumber);
    assertNativeSliceSubtitleArtifactMatchesRequest(nativeSlice, subtitleRequest, sliceNumber);
  });
}

function assertRequiredNativeSliceText(value: unknown, sliceNumber: number, fieldName: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`AutoCut native video slicing slice artifact ${sliceNumber} is missing ${fieldName}.`);
  }
  return value;
}

function assertRequiredNativeTaskText(value: unknown, fieldName: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`AutoCut native video slicing result is missing ${fieldName}.`);
  }
  return value;
}

function assertPositiveNativeSliceNumber(value: unknown, sliceNumber: number, fieldName: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`AutoCut native video slicing slice artifact ${sliceNumber} has invalid ${fieldName}.`);
  }
}

function assertNonNegativeNativeSliceNumber(value: unknown, sliceNumber: number, fieldName: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`AutoCut native video slicing slice artifact ${sliceNumber} has invalid ${fieldName}.`);
  }
}

function assertNativeSliceTimingMatchesPlan(
  nativeSlice: AutoCutVideoSliceArtifactResult,
  plannedClip: NormalizedSlicePlanClip | undefined,
  sliceNumber: number,
) {
  if (!plannedClip) {
    throw new Error(`AutoCut native video slicing slice artifact ${sliceNumber} is missing planned clip ${sliceNumber}.`);
  }

  const renderReadyPlannedClip = normalizeSmartSlicePlannedClipSourceSegmentsForContinuousFallback(plannedClip);
  const expectedSourceSegments = renderReadyPlannedClip.sourceSegments;
  const expectedDurationMs = expectedSourceSegments?.length
    ? expectedSourceSegments.reduce(
        (durationMs, segment) => durationMs + Math.max(0, segment.endMs - segment.startMs),
        0,
      )
    : renderReadyPlannedClip.durationMs;
  if (nativeSlice.startMs !== renderReadyPlannedClip.startMs || nativeSlice.durationMs !== expectedDurationMs) {
    throw new Error(
      `AutoCut native video slicing slice artifact ${sliceNumber} timing does not match planned clip ${sliceNumber}.`,
    );
  }
}

function assertNativeSliceAudioCleanupMetadataMatchesPlan(
  nativeSlice: AutoCutVideoSliceArtifactResult,
  plannedClip: NormalizedSlicePlanClip | undefined,
  sliceNumber: number,
) {
  if (!plannedClip) {
    throw new Error(`AutoCut native video slicing slice artifact ${sliceNumber} is missing planned clip ${sliceNumber}.`);
  }

  assertOptionalNativeSliceMetadataMatchesPlan(
    nativeSlice.audioCleanupProfile,
    plannedClip.audioCleanupProfile,
    sliceNumber,
    'audioCleanupProfile',
  );
  assertOptionalNativeSliceBoolean(nativeSlice.noiseReductionApplied, sliceNumber, 'noiseReductionApplied');
  assertOptionalNativeSliceMilliseconds(nativeSlice.audioActivityStartMs, sliceNumber, 'audioActivityStartMs');
  assertOptionalNativeSliceMilliseconds(nativeSlice.audioActivityEndMs, sliceNumber, 'audioActivityEndMs');
  if (
    typeof nativeSlice.audioActivityStartMs === 'number' &&
    typeof nativeSlice.audioActivityEndMs === 'number' &&
    nativeSlice.audioActivityEndMs <= nativeSlice.audioActivityStartMs
  ) {
    throw new Error(
      `AutoCut native video slicing slice artifact ${sliceNumber} audioActivityEndMs must be after audioActivityStartMs.`,
    );
  }
  assertOptionalNativeSliceConfidence(nativeSlice.audioActivityConfidence, sliceNumber);
  assertOptionalNativeSliceAudioActivityAnalysisFilter(nativeSlice, sliceNumber);
  assertOptionalNativeSliceMilliseconds(nativeSlice.leadingSilenceMs, sliceNumber, 'leadingSilenceMs');
  assertOptionalNativeSliceMilliseconds(nativeSlice.trailingSilenceMs, sliceNumber, 'trailingSilenceMs');
  assertOptionalNativeSliceMilliseconds(nativeSlice.leadingSilenceTrimMs, sliceNumber, 'leadingSilenceTrimMs');
  assertOptionalNativeSliceMilliseconds(nativeSlice.trailingSilenceTrimMs, sliceNumber, 'trailingSilenceTrimMs');
  assertNativeSliceSourceSegmentsAreValid(nativeSlice, sliceNumber);
  assertOptionalNativeSliceMetadataMatchesPlan(
    nativeSlice.tailTreatment,
    plannedClip.tailTreatment,
    sliceNumber,
    'tailTreatment',
  );
}

function assertOptionalNativeSliceBoolean(value: unknown, sliceNumber: number, fieldName: string) {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new Error(
      `AutoCut native video slicing slice artifact ${sliceNumber} ${fieldName} must be a boolean post-cut cleanup decision.`,
    );
  }
}

function assertOptionalNativeSliceMilliseconds(value: unknown, sliceNumber: number, fieldName: string) {
  if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
    throw new Error(
      `AutoCut native video slicing slice artifact ${sliceNumber} ${fieldName} must be a non-negative millisecond value.`,
    );
  }
}

function assertOptionalNativeSliceConfidence(value: unknown, sliceNumber: number) {
  if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new Error(
      `AutoCut native video slicing slice artifact ${sliceNumber} audioActivityConfidence must be a confidence value between 0 and 1.`,
    );
  }
}

function assertOptionalNativeSliceAudioActivityAnalysisFilter(
  nativeSlice: AutoCutVideoSliceArtifactResult,
  sliceNumber: number,
) {
  if (nativeSlice.audioActivityAnalysisFilter === undefined) {
    return;
  }
  const audioActivityAnalysisFilter = typeof nativeSlice.audioActivityAnalysisFilter === 'string'
    ? nativeSlice.audioActivityAnalysisFilter.trim()
    : '';
  const expectedAnalysisFilter = typeof nativeSlice.noiseReductionApplied === 'boolean'
    ? getSmartSliceRequiredAudioActivityAnalysisFilter(nativeSlice.noiseReductionApplied)
    : undefined;
  const hasAcceptedAnalysisFilter = expectedAnalysisFilter !== undefined
    ? audioActivityAnalysisFilter === expectedAnalysisFilter
    : audioActivityAnalysisFilter === SMART_SLICE_REQUIRED_AUDIO_ACTIVITY_ANALYSIS_FILTER ||
      audioActivityAnalysisFilter === SMART_SLICE_RAW_AUDIO_ACTIVITY_ANALYSIS_FILTER;

  if (!hasAcceptedAnalysisFilter) {
    throw new Error(
      `AutoCut native video slicing slice artifact ${sliceNumber} audioActivityAnalysisFilter must match the post-cut cleanup noise reduction decision.`,
    );
  }
}

function assertNativeSliceSourceSegmentsAreValid(
  nativeSlice: AutoCutVideoSliceArtifactResult,
  sliceNumber: number,
) {
  if (!nativeSlice.sourceSegments?.length) {
    return;
  }

  const sourceStartMs = nativeSlice.sourceStartMs ?? nativeSlice.startMs;
  const sourceEndMs = nativeSlice.sourceEndMs ?? sourceStartMs + nativeSlice.durationMs;
  let previousEndMs: number | undefined;
  let renderedDurationMs = 0;
  for (const [segmentIndex, segment] of nativeSlice.sourceSegments.entries()) {
    const segmentNumber = segmentIndex + 1;
    if (
      typeof segment.startMs !== 'number' ||
      typeof segment.endMs !== 'number' ||
      !Number.isFinite(segment.startMs) ||
      !Number.isFinite(segment.endMs) ||
      segment.endMs <= segment.startMs ||
      segment.startMs < sourceStartMs ||
      segment.endMs > sourceEndMs ||
      (previousEndMs !== undefined && segment.startMs < previousEndMs)
    ) {
      throw new Error(
        `AutoCut native video slicing slice artifact ${sliceNumber} sourceSegments[${segmentNumber}] is invalid.`,
      );
    }

    renderedDurationMs += segment.endMs - segment.startMs;
    previousEndMs = segment.endMs;
  }

  if (nativeSlice.durationMs !== renderedDurationMs) {
    throw new Error(
      `AutoCut native video slicing slice artifact ${sliceNumber} durationMs must match retained sourceSegments duration.`,
    );
  }
}

function assertOptionalNativeSliceMetadataMatchesPlan(
  nativeValue: unknown,
  plannedValue: unknown,
  sliceNumber: number,
  fieldName: string,
) {
  if (plannedValue === undefined) {
    return;
  }

  if (nativeValue !== plannedValue) {
    throw new Error(
      `AutoCut native video slicing slice artifact ${sliceNumber} ${fieldName} does not match planned Smart Slice audio cleanup metadata.`,
    );
  }
}

function assertNativeSliceSubtitleArtifactMatchesRequest(
  nativeSlice: AutoCutVideoSliceArtifactResult,
  subtitleRequest: VideoSliceSubtitleRequestProjection,
  sliceNumber: number,
) {
  const requestedSubtitleMode = subtitleRequest.subtitleMode;
  const writesSrtSidecar =
    subtitleRequest.subtitleFormat === 'srt' &&
    requestedSubtitleMode !== 'none';
  const hasSubtitleArtifact = Boolean(nativeSlice.subtitleArtifactPath || nativeSlice.subtitleArtifactUuid || nativeSlice.subtitleFormat);

  if (!subtitleRequest.subtitleFormat && hasSubtitleArtifact) {
    throw new Error(
      `AutoCut native video slicing slice artifact ${sliceNumber} subtitle artifact was returned even though subtitle rendering was not requested.`,
    );
  }

  if (writesSrtSidecar) {
    if (!nativeSlice.subtitleArtifactPath || !nativeSlice.subtitleArtifactUuid || nativeSlice.subtitleFormat !== 'srt') {
      throw new Error(
        `AutoCut native video slicing slice artifact ${sliceNumber} is missing the requested SRT subtitle artifact.`,
      );
    }
  }
}

function assertNativeSliceTaskOutputDirMatchesResult(
  taskOutputDir: string,
  nativeTaskOutputDir: string,
  sliceNumber: number,
) {
  if (
    normalizeAutoCutNativePathForContainment(taskOutputDir) !==
    normalizeAutoCutNativePathForContainment(nativeTaskOutputDir)
  ) {
    throw new Error(
      `AutoCut native video slicing slice artifact ${sliceNumber} taskOutputDir does not match the native task output directory.`,
    );
  }
}

function assertNativeSlicePathInsideTaskOutputDir(
  artifactPath: string,
  taskOutputDir: string,
  sliceNumber: number,
  fieldName: string,
) {
  try {
    assertAutoCutNativeArtifactInsideTaskOutputDir({ artifactPath, taskOutputDir }, `slice artifact ${sliceNumber}`);
  } catch {
    throw new Error(
      `AutoCut native video slicing slice artifact ${sliceNumber} ${fieldName} is outside its task output directory.`,
    );
  }
}

function assertNativeSliceThumbnailPathInsideCoverDir(
  artifactPath: string,
  taskOutputDir: string,
  sliceNumber: number,
) {
  try {
    assertAutoCutNativeVideoCoverInsideTaskCoverDir({ artifactPath, taskOutputDir }, `slice artifact ${sliceNumber}`);
  } catch (error) {
    if (error instanceof Error && error.message.includes('task output directory')) {
      throw new Error(
        `AutoCut native video slicing slice artifact ${sliceNumber} thumbnailArtifactPath is outside its task output directory.`,
      );
    }
    throw new Error(
      `AutoCut native video slicing slice artifact ${sliceNumber} thumbnailArtifactPath is outside its task cover directory.`,
    );
  }
}

const DEFAULT_MERGE_SHORT_CLIP_THRESHOLD_MS = 5_000;
const MAX_SMART_SLICE_SHORT_CLIP_MERGE_GAP_MS = 900;

function mergeShortSmartSliceClips(
  plannedClips: readonly NormalizedSlicePlanClip[],
  params: VideoSliceParams,
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
): NormalizedSlicePlanClip[] {
  if (params.mergeShortClips !== true || plannedClips.length <= 1) {
    return [...plannedClips];
  }

  const thresholdMs = typeof params.mergeShortClipThresholdSeconds === 'number' &&
    Number.isFinite(params.mergeShortClipThresholdSeconds) &&
    params.mergeShortClipThresholdSeconds > 0
      ? Math.round(params.mergeShortClipThresholdSeconds * 1_000)
      : DEFAULT_MERGE_SHORT_CLIP_THRESHOLD_MS;

  const sorted = [...plannedClips].sort((a, b) => a.startMs - b.startMs);
  const merged: NormalizedSlicePlanClip[] = [];

  for (const clip of sorted) {
    const renderedDurationMs = clip.renderedDurationMs ?? clip.durationMs;
    if (renderedDurationMs >= thresholdMs || merged.length === 0) {
      merged.push({ ...clip });
      continue;
    }

    const previousClip = merged[merged.length - 1];
    if (!previousClip) {
      merged.push({ ...clip });
      continue;
    }

    if (!canMergeAdjacentShortSmartSliceClips(previousClip, clip, thresholdMs)) {
      merged.push({ ...clip });
      continue;
    }

    const prevSourceEnd = previousClip.sourceEndMs ?? previousClip.startMs + previousClip.durationMs;
    const clipSourceEnd = clip.sourceEndMs ?? clip.startMs + clip.durationMs;
    const mergedSourceEndMs = Math.max(prevSourceEnd, clipSourceEnd);
    const mergedDurationMs = mergedSourceEndMs - previousClip.startMs;
    const mergedSpeechEndMs = Math.max(
      previousClip.speechEndMs ?? prevSourceEnd,
      clip.speechEndMs ?? clipSourceEnd,
    );

    const mergedSourceSegments = mergeClipSourceSegments(
      previousClip.sourceSegments,
      clip.sourceSegments,
      previousClip.sourceStartMs ?? previousClip.startMs,
      mergedSourceEndMs,
    );

    const mergedClip: NormalizedSlicePlanClip = {
      ...previousClip,
      durationMs: mergedDurationMs,
      sourceEndMs: mergedSourceEndMs,
      speechEndMs: mergedSpeechEndMs,
      ...(mergedSourceSegments ? { sourceSegments: mergedSourceSegments } : {}),
      renderedDurationMs: mergedSourceSegments
        ? mergedSourceSegments.reduce((total, seg) => total + Math.max(0, seg.endMs - seg.startMs), 0)
        : mergedDurationMs,
      label: previousClip.label,
    };

    merged[merged.length - 1] = refreshSmartSlicePlanTranscriptEvidence(
      [mergedClip],
      transcriptSegments,
      undefined,
    )[0] ?? mergedClip;
  }

  return merged.map((clip, index) => ({ ...clip, index }));
}

function canMergeAdjacentShortSmartSliceClips(
  previousClip: NormalizedSlicePlanClip,
  nextClip: NormalizedSlicePlanClip,
  thresholdMs: number,
) {
  const previousRenderedDurationMs = previousClip.renderedDurationMs ?? previousClip.durationMs;
  const nextRenderedDurationMs = nextClip.renderedDurationMs ?? nextClip.durationMs;
  if (previousRenderedDurationMs >= thresholdMs || nextRenderedDurationMs >= thresholdMs) {
    return false;
  }

  const previousSourceEndMs = previousClip.sourceEndMs ?? previousClip.startMs + previousClip.durationMs;
  const nextSourceStartMs = nextClip.sourceStartMs ?? nextClip.startMs;
  const sourceGapMs = nextSourceStartMs - previousSourceEndMs;
  if (sourceGapMs < 0 || sourceGapMs > MAX_SMART_SLICE_SHORT_CLIP_MERGE_GAP_MS) {
    return false;
  }

  const hasSharedContentUnit =
    Array.isArray(previousClip.contentUnitIds) &&
    Array.isArray(nextClip.contentUnitIds) &&
    previousClip.contentUnitIds.some((unitId) => nextClip.contentUnitIds?.includes(unitId));
  if (hasSharedContentUnit) {
    return true;
  }

  const previousSpeakerIds = new Set(previousClip.speakerIds ?? []);
  const hasSharedSpeaker =
    previousSpeakerIds.size === 0 ||
    (nextClip.speakerIds ?? []).some((speakerId) => previousSpeakerIds.has(speakerId));
  return hasSharedSpeaker &&
    previousClip.boundaryDecisionSource === nextClip.boundaryDecisionSource &&
    previousClip.noiseReductionApplied === nextClip.noiseReductionApplied;
}

function mergeClipSourceSegments(
  prevSegments: readonly { startMs: number; endMs: number }[] | undefined,
  nextSegments: readonly { startMs: number; endMs: number }[] | undefined,
  overallStartMs: number,
  overallEndMs: number,
): Array<{ startMs: number; endMs: number }> | undefined {
  const prev = Array.isArray(prevSegments) && prevSegments.length > 0
    ? prevSegments
    : undefined;
  const next = Array.isArray(nextSegments) && nextSegments.length > 0
    ? nextSegments
    : undefined;

  if (!prev && !next) {
    return undefined;
  }

  const allSegments = [
    ...(prev ?? [{ startMs: overallStartMs, endMs: overallEndMs }]),
    ...(next ?? []),
  ]
    .map((s) => ({ startMs: Math.round(s.startMs), endMs: Math.round(s.endMs) }))
    .filter((s) => s.endMs > s.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  const merged: Array<{ startMs: number; endMs: number }> = [];
  for (const seg of allSegments) {
    const last = merged[merged.length - 1];
    if (last && seg.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, seg.endMs);
    } else {
      merged.push({ ...seg });
    }
  }

  return merged.length > 1 ? merged : undefined;
}

function toNativeSliceClipRequest(
  clip: NormalizedSlicePlanClip,
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
  params: VideoSliceParams,
): AutoCutVideoSliceClipRequest {
  const hasTranscriptEvidence = transcriptSegments.length > 0;
  const initialClipTranscriptSegments = hasTranscriptEvidence
    ? createVideoSliceTranscriptSegments(
    clip,
    { startMs: clip.startMs, durationMs: clip.durationMs } as AutoCutVideoSliceArtifactResult,
    transcriptSegments,
  )
    : [];
  const renderClip = normalizeSmartSlicePlannedClipSourceSegmentsForContinuousFallback(
    !hasTranscriptEvidence || hasPostCleanupSmartSliceAudioEvidenceShape(clip)
      ? clip
      : createSmartSliceSilenceCompactedClip(clip, initialClipTranscriptSegments),
  );
  const clipTranscriptSegments = hasTranscriptEvidence
    ? createVideoSliceTranscriptSegments(
    renderClip,
    { startMs: renderClip.startMs, durationMs: renderClip.durationMs } as AutoCutVideoSliceArtifactResult,
    transcriptSegments,
  )
    : [];
  const clipTranscriptText = createVideoSliceTranscriptText(clipTranscriptSegments);
  const renderSpeechStartMs = renderClip.speechStartMs ?? renderClip.sourceStartMs ?? renderClip.startMs;
  const renderSpeechEndMs =
    renderClip.speechEndMs ?? renderClip.sourceEndMs ?? renderClip.startMs + renderClip.durationMs;
  const renderTranscriptCoverageScore = clipTranscriptSegments.length
    ? createSmartSliceTranscriptEvidenceCoverageScore(
        clipTranscriptSegments,
        renderSpeechStartMs,
        renderSpeechEndMs,
        renderClip.sourceSegments,
      )
    : renderClip.transcriptCoverageScore;
  const renderSpeechContinuityGrade = clipTranscriptSegments.length &&
    typeof renderTranscriptCoverageScore === 'number'
      ? resolveSmartSliceTranscriptEvidenceContinuityGrade(
          renderClip,
          clipTranscriptSegments,
          renderTranscriptCoverageScore,
        )
      : renderClip.speechContinuityGrade;
  const audioMuteRanges = params.enableCoughFilter === true && hasTranscriptEvidence
    ? createSmartSliceTranscriptAudioMuteRanges(
        renderClip.sourceStartMs ?? renderClip.startMs,
        renderClip.sourceEndMs ?? renderClip.startMs + renderClip.durationMs,
        transcriptSegments,
      )
    : [];

  return {
    startMs: renderClip.startMs,
    durationMs: renderClip.durationMs,
    label: renderClip.label,
    outputFileName: createPlannedSliceOutputFileName(renderClip),
    ...(renderClip.planningEngine ? { planningEngine: renderClip.planningEngine } : {}),
    ...(renderClip.smartCutPresetId ? { smartCutPresetId: renderClip.smartCutPresetId } : {}),
    ...(renderClip.smartCutPlanId ? { smartCutPlanId: renderClip.smartCutPlanId } : {}),
    ...(renderClip.smartCutRunId ? { smartCutRunId: renderClip.smartCutRunId } : {}),
    ...(renderClip.contentUnitIds?.length ? { contentUnitIds: [...renderClip.contentUnitIds] } : {}),
    ...(renderClip.speakerIds?.length ? { speakerIds: [...renderClip.speakerIds] } : {}),
    ...(renderClip.speakerRoles?.length ? { speakerRoles: [...renderClip.speakerRoles] } : {}),
    ...(audioMuteRanges.length ? { audioMuteRanges } : {}),
    ...(renderClip.sourceSegments?.length ? { sourceSegments: renderClip.sourceSegments } : {}),
    ...(renderClip.renderedDurationMs !== undefined ? { renderedDurationMs: renderClip.renderedDurationMs } : {}),
    ...(renderClip.removedSilenceMs !== undefined ? { removedSilenceMs: renderClip.removedSilenceMs } : {}),
    ...(renderClip.internalSilenceTrimCount !== undefined
      ? { internalSilenceTrimCount: renderClip.internalSilenceTrimCount }
      : {}),
    ...(renderClip.sourceStartMs !== undefined ? { sourceStartMs: renderClip.sourceStartMs } : {}),
    ...(renderClip.sourceEndMs !== undefined ? { sourceEndMs: renderClip.sourceEndMs } : {}),
    ...(renderClip.speechStartMs !== undefined ? { speechStartMs: renderClip.speechStartMs } : {}),
    ...(renderClip.speechEndMs !== undefined ? { speechEndMs: renderClip.speechEndMs } : {}),
    ...(renderClip.boundaryPaddingBeforeMs !== undefined
      ? { boundaryPaddingBeforeMs: renderClip.boundaryPaddingBeforeMs }
      : {}),
    ...(renderClip.boundaryPaddingAfterMs !== undefined
      ? { boundaryPaddingAfterMs: renderClip.boundaryPaddingAfterMs }
      : {}),
    ...(renderClip.audioCleanupProfile ? { audioCleanupProfile: renderClip.audioCleanupProfile } : {}),
    ...(renderClip.noiseReductionApplied !== undefined ? { noiseReductionApplied: renderClip.noiseReductionApplied } : {}),
    ...(renderClip.boundaryDecisionSource ? { boundaryDecisionSource: renderClip.boundaryDecisionSource } : {}),
    ...(renderClip.audioActivityStartMs !== undefined ? { audioActivityStartMs: renderClip.audioActivityStartMs } : {}),
    ...(renderClip.audioActivityEndMs !== undefined ? { audioActivityEndMs: renderClip.audioActivityEndMs } : {}),
    ...(renderClip.audioActivityConfidence !== undefined ? { audioActivityConfidence: renderClip.audioActivityConfidence } : {}),
    ...(renderClip.audioActivityAnalysisFilter ? { audioActivityAnalysisFilter: renderClip.audioActivityAnalysisFilter } : {}),
    ...(renderClip.leadingSilenceMs !== undefined ? { leadingSilenceMs: renderClip.leadingSilenceMs } : {}),
    ...(renderClip.trailingSilenceMs !== undefined ? { trailingSilenceMs: renderClip.trailingSilenceMs } : {}),
    ...(renderClip.leadingSilenceTrimMs !== undefined ? { leadingSilenceTrimMs: renderClip.leadingSilenceTrimMs } : {}),
    ...(renderClip.trailingSilenceTrimMs !== undefined ? { trailingSilenceTrimMs: renderClip.trailingSilenceTrimMs } : {}),
    ...(renderClip.tailTreatment ? { tailTreatment: renderClip.tailTreatment } : {}),
    ...(clipTranscriptText ? { transcriptText: clipTranscriptText } : hasTranscriptEvidence && renderClip.transcriptText ? { transcriptText: renderClip.transcriptText } : {}),
    ...(clipTranscriptSegments.length ? { transcriptSegments: clipTranscriptSegments } : {}),
    ...(clipTranscriptSegments.length
      ? { transcriptSegmentCount: clipTranscriptSegments.length }
      : renderClip.transcriptSegmentCount !== undefined
        ? { transcriptSegmentCount: renderClip.transcriptSegmentCount }
        : {}),
    ...(renderTranscriptCoverageScore !== undefined ? { transcriptCoverageScore: renderTranscriptCoverageScore } : {}),
    ...(renderSpeechContinuityGrade ? { speechContinuityGrade: renderSpeechContinuityGrade } : {}),
    ...(renderClip.risks ? { risks: renderClip.risks } : {}),
  };
}

function createPlannedSliceOutputFileName(
  clip: Pick<NormalizedSlicePlanClip, 'index' | 'title' | 'label'> | undefined,
  nativeSlice?: Pick<AutoCutVideoSliceArtifactResult, 'artifactPath' | 'label'>,
  fallbackIndex = 0,
) {
  const index = typeof clip?.index === 'number' && Number.isFinite(clip.index) ? clip.index : fallbackIndex;
  const title = clip?.title ?? clip?.label ?? nativeSlice?.label ?? `slice-${index + 1}`;
  if (clip?.title || clip?.label || nativeSlice?.label) {
    return `${String(index + 1).padStart(2, '0')}-${createAutoCutSafeFileNameStem(title, `slice-${index + 1}`)}.mp4`;
  }

  const artifactFileName = nativeSlice?.artifactPath ? readAutoCutPathFileName(nativeSlice.artifactPath) : undefined;
  if (artifactFileName) {
    return artifactFileName;
  }

  return `${String(index + 1).padStart(2, '0')}-${createAutoCutSafeFileNameStem(title, `slice-${index + 1}`)}.mp4`;
}

function createAutoCutSafeFileNameStem(value: string, fallback: string) {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .trim()
    .toLowerCase()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/gu, '-')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .replace(/-{2,}/gu, '-')
    .slice(0, 72)
    .replace(/-+$/gu, '');

  return normalized || fallback;
}

function readAutoCutPathFileName(filePath: string) {
  const normalized = filePath.replace(/\\/gu, '/');
  const fileName = normalized.split('/').filter(Boolean).at(-1)?.trim();
  return fileName || undefined;
}

function createVideoSliceRenderProfile(
  planningPolicy: VideoSlicePlanningPolicy,
): AutoCutVideoSliceRenderProfile | undefined {
  if (planningPolicy.targetAspectRatio === 'auto') {
    return undefined;
  }

  return {
    targetAspectRatio: planningPolicy.targetAspectRatio,
    objectFit: planningPolicy.videoObjectFit,
  };
}

type VideoSliceSubtitleRequestProjection = Partial<Pick<
  AutoCutVideoSliceRequest,
  'subtitleFormat' | 'subtitleMode' | 'subtitleStyleId' | 'subtitleSegments'
>>;

const SMART_SLICE_SUBTITLE_MAX_CUE_DURATION_MS = 3_600;
const SMART_SLICE_SUBTITLE_SENTENCE_COMPLETE_GRACE_MS = 900;
const SMART_SLICE_SUBTITLE_MIN_CUE_DURATION_MS = 650;
const SMART_SLICE_SUBTITLE_MAX_LATIN_CHARS = 42;
const SMART_SLICE_SUBTITLE_MAX_CJK_CHARS = 18;
const SMART_SLICE_SUBTITLE_PUNCTUATION_PATTERN = /^[,.;:!?\u3001\u3002\uff0c\uff01\uff1f\uff1b\uff1a]/u;
const SMART_SLICE_SUBTITLE_TERMINAL_PUNCTUATION_PATTERN = /[.!?\u3002\uff01\uff1f]$/u;

function shouldGenerateVideoSliceSubtitles(params: VideoSliceParams) {
  if (params.enableSubtitles === true && params.subtitleMode === 'none') {
    throw new Error('Subtitle rendering was enabled but subtitleMode is none.');
  }
  return params.enableSubtitles === true && params.subtitleMode !== 'none';
}

function normalizeVideoSliceSubtitleOverlayMode(params: VideoSliceParams) {
  const subtitleMode = params.subtitleMode ?? 'both';
  if (subtitleMode === 'srt' || subtitleMode === 'burned' || subtitleMode === 'both') {
    return subtitleMode;
  }

  return 'both';
}

function createVideoSliceSubtitleRequest(
  params: VideoSliceParams,
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
): VideoSliceSubtitleRequestProjection {
  if (!shouldGenerateVideoSliceSubtitles(params)) {
    return {};
  }

  const subtitleSegments = createVideoSliceSubtitleSegments(transcriptSegments);
  if (subtitleSegments.length === 0) {
    throw new Error('Subtitle rendering requires successful speech-to-text transcription with non-empty transcript segments.');
  }

  return {
    subtitleFormat: 'srt',
    subtitleMode: normalizeVideoSliceSubtitleOverlayMode(params),
    ...(params.subtitleStyleId ? { subtitleStyleId: params.subtitleStyleId } : {}),
    subtitleSegments,
  };
}

function createBestEffortVideoSliceSubtitleRequest(
  params: VideoSliceParams,
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
): VideoSliceSubtitleRequestProjection {
  try {
    return createVideoSliceSubtitleRequest(params, transcriptSegments);
  } catch (error) {
    reportVideoSliceStageDiagnostic('subtitle rendering skipped', {
      errorMessage: error instanceof Error ? error.message : String(error),
      transcriptSegmentCount: transcriptSegments.length,
      enableSubtitles: params.enableSubtitles === true,
      subtitleMode: params.subtitleMode,
    });
    return {};
  }
}

function createVideoSliceSubtitleSegments(
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
): AutoCutSpeechTranscriptionSegment[] {
  const orderedSegments = transcriptSegments
    .map((segment) => ({
      startMs: Math.round(segment.startMs),
      endMs: Math.round(segment.endMs),
      text: normalizeSmartSliceTranscriptEvidenceText(segment.text),
      ...(segment.speaker?.trim() ? { speaker: segment.speaker.trim() } : {}),
      ...(Array.isArray(segment.words) && segment.words.length > 0 ? { words: segment.words } : {}),
    }))
    .filter((segment) =>
      Number.isFinite(segment.startMs) &&
      Number.isFinite(segment.endMs) &&
      segment.endMs > segment.startMs &&
      segment.text.length > 0
    )
    .sort((firstSegment, secondSegment) =>
      firstSegment.startMs - secondSegment.startMs ||
      firstSegment.endMs - secondSegment.endMs,
    );
  const subtitleSegments: AutoCutSpeechTranscriptionSegment[] = [];

  for (const segment of orderedSegments) {
    for (const subtitleSegment of createSmartSlicePacedSubtitleSegments(segment)) {
      const previousSegment = subtitleSegments.at(-1);
      const startMs = previousSegment ? Math.max(subtitleSegment.startMs, previousSegment.endMs) : subtitleSegment.startMs;
      if (subtitleSegment.endMs <= startMs) {
        continue;
      }

      subtitleSegments.push({
        ...subtitleSegment,
        startMs,
      });
    }
  }

  return subtitleSegments;
}

function createSmartSlicePacedSubtitleSegments(
  segment: AutoCutSpeechTranscriptionSegment,
): AutoCutSpeechTranscriptionSegment[] {
  const durationMs = Math.max(0, segment.endMs - segment.startMs);
  if (durationMs <= SMART_SLICE_SUBTITLE_MIN_CUE_DURATION_MS) {
    return [segment];
  }
  const wordTimedSegments = createSmartSliceWordTimedSubtitleSegments(segment);
  if (wordTimedSegments.length > 0) {
    return wordTimedSegments;
  }
  const chunks = fitSmartSliceSubtitleChunksToDuration(
    splitSmartSliceSubtitleTextIntoPacedChunks(segment.text),
    durationMs,
  );
  if (chunks.length <= 1) {
    return [segment];
  }

  const totalWeight = chunks.reduce((weight, chunk) => weight + getSmartSliceSubtitleTimingWeight(chunk), 0) || chunks.length;
  let cursorMs = segment.startMs;
  return chunks.map((chunk, index) => {
    const remainingChunks = chunks.length - index;
    const isLast = index === chunks.length - 1;
    const targetDurationMs = isLast
      ? segment.endMs - cursorMs
      : Math.round(durationMs * getSmartSliceSubtitleTimingWeight(chunk) / totalWeight);
    const remainingAfterThisCue = Math.max(0, remainingChunks - 1);
    const latestEndMs = segment.endMs - remainingAfterThisCue * SMART_SLICE_SUBTITLE_MIN_CUE_DURATION_MS;
    const earliestEndMs = segment.endMs - remainingAfterThisCue * SMART_SLICE_SUBTITLE_MAX_CUE_DURATION_MS;
    const boundedDurationMs = Math.max(
      SMART_SLICE_SUBTITLE_MIN_CUE_DURATION_MS,
      Math.min(SMART_SLICE_SUBTITLE_MAX_CUE_DURATION_MS, targetDurationMs),
    );
    const endMs = isLast
      ? segment.endMs
      : Math.max(
          cursorMs + SMART_SLICE_SUBTITLE_MIN_CUE_DURATION_MS,
          Math.min(latestEndMs, Math.max(earliestEndMs, cursorMs + boundedDurationMs)),
        );
    const pacedSegment = {
      ...segment,
      startMs: cursorMs,
      endMs: Math.max(cursorMs + 1, endMs),
      text: chunk,
    };
    cursorMs = pacedSegment.endMs;
    return pacedSegment;
  }).filter((subtitleSegment) => subtitleSegment.endMs > subtitleSegment.startMs);
}

function createSmartSliceWordTimedSubtitleSegments(
  segment: AutoCutSpeechTranscriptionSegment,
): AutoCutSpeechTranscriptionSegment[] {
  const words = normalizeSmartSliceSubtitleWords(segment);
  if (words.length === 0) {
    return [];
  }

  const subtitleSegments: AutoCutSpeechTranscriptionSegment[] = [];
  let currentWords: typeof words = [];
  for (const word of words) {
    const candidateText = joinSmartSliceSubtitleWords(currentWords, word);
    if (
      currentWords.length > 0 &&
      shouldFlushSmartSliceWordTimedSubtitleSegment(currentWords, word, candidateText)
    ) {
      const subtitleSegment = createSmartSliceWordTimedSubtitleSegment(segment, currentWords);
      if (subtitleSegment) {
        subtitleSegments.push(subtitleSegment);
      }
      currentWords = [];
    }
    currentWords.push(word);
  }

  const subtitleSegment = createSmartSliceWordTimedSubtitleSegment(segment, currentWords);
  if (subtitleSegment) {
    subtitleSegments.push(subtitleSegment);
  }

  return subtitleSegments;
}

function normalizeSmartSliceSubtitleWords(segment: AutoCutSpeechTranscriptionSegment) {
  if (!Array.isArray(segment.words)) {
    return [];
  }

  const words = segment.words
    .map((word) => ({
      startMs: Math.max(segment.startMs, Math.round(word.startMs)),
      endMs: Math.min(segment.endMs, Math.round(word.endMs)),
      text: normalizeSmartSliceTranscriptEvidenceText(word.text),
      ...(typeof word.probability === 'number' && Number.isFinite(word.probability)
        ? { probability: Math.min(1, Math.max(0, word.probability)) }
        : {}),
    }))
    .filter((word) =>
      Number.isFinite(word.startMs) &&
      Number.isFinite(word.endMs) &&
      word.endMs > word.startMs &&
      word.text.length > 0
    )
    .sort((firstWord, secondWord) =>
      firstWord.startMs - secondWord.startMs ||
      firstWord.endMs - secondWord.endMs,
    );

  const repairedWords: typeof words = [];
  for (const word of words) {
    const previousWord = repairedWords.at(-1);
    const startMs = previousWord ? Math.max(word.startMs, previousWord.endMs) : word.startMs;
    if (word.endMs <= startMs) {
      continue;
    }
    repairedWords.push({ ...word, startMs });
  }

  return repairedWords;
}

function shouldFlushSmartSliceWordTimedSubtitleSegment(
  currentWords: ReturnType<typeof normalizeSmartSliceSubtitleWords>,
  nextWord: ReturnType<typeof normalizeSmartSliceSubtitleWords>[number],
  candidateText: string,
) {
  const firstWord = currentWords.at(0);
  const lastWord = currentWords.at(-1);
  if (!firstWord || !lastWord) {
    return false;
  }

  const maxChars = /\p{Script=Han}/u.test(candidateText)
    ? SMART_SLICE_SUBTITLE_MAX_CJK_CHARS
    : SMART_SLICE_SUBTITLE_MAX_LATIN_CHARS;
  const nextWordIsStandalonePunctuation = SMART_SLICE_SUBTITLE_PUNCTUATION_PATTERN.test(nextWord.text);
  const displayOverflow = !nextWordIsStandalonePunctuation && countSmartSliceSubtitleDisplayUnits(candidateText) > maxChars * 2;
  const sentenceBoundary =
    SMART_SLICE_SUBTITLE_TERMINAL_PUNCTUATION_PATTERN.test(lastWord.text) &&
    lastWord.endMs - firstWord.startMs >= SMART_SLICE_SUBTITLE_MIN_CUE_DURATION_MS;
  const nextWordCompletesSentence = SMART_SLICE_SUBTITLE_TERMINAL_PUNCTUATION_PATTERN.test(nextWord.text);
  const durationLimitMs = nextWordCompletesSentence
    ? SMART_SLICE_SUBTITLE_MAX_CUE_DURATION_MS + SMART_SLICE_SUBTITLE_SENTENCE_COMPLETE_GRACE_MS
    : SMART_SLICE_SUBTITLE_MAX_CUE_DURATION_MS;
  const durationOverflow = nextWord.endMs - firstWord.startMs > durationLimitMs;

  return displayOverflow || durationOverflow || sentenceBoundary;
}

function createSmartSliceWordTimedSubtitleSegment(
  segment: AutoCutSpeechTranscriptionSegment,
  words: ReturnType<typeof normalizeSmartSliceSubtitleWords>,
): AutoCutSpeechTranscriptionSegment | undefined {
  const firstWord = words.at(0);
  const lastWord = words.at(-1);
  if (!firstWord || !lastWord) {
    return undefined;
  }
  const text = joinSmartSliceSubtitleWords(words);
  if (!text) {
    return undefined;
  }

  return {
    startMs: firstWord.startMs,
    endMs: lastWord.endMs,
    text,
    ...(segment.speaker?.trim() ? { speaker: segment.speaker.trim() } : {}),
    words,
  };
}

function joinSmartSliceSubtitleWords(
  words: ReturnType<typeof normalizeSmartSliceSubtitleWords>,
  nextWord?: ReturnType<typeof normalizeSmartSliceSubtitleWords>[number],
) {
  return [...words, ...(nextWord ? [nextWord] : [])]
    .reduce((current, word) => joinSmartSliceSubtitleTextUnit(current, word.text), '')
    .trim();
}

function splitSmartSliceSubtitleTextIntoPacedChunks(text: string) {
  const normalizedText = normalizeSmartSliceTranscriptEvidenceText(text);
  if (!normalizedText) {
    return [];
  }

  const units = splitSmartSliceSubtitleTextUnits(normalizedText);
  const chunks: string[] = [];
  let current = '';
  for (const unit of units) {
    const candidate = joinSmartSliceSubtitleTextUnit(current, unit);
    if (current && shouldStartNewSmartSliceSubtitleChunk(current, candidate, unit)) {
      chunks.push(trimSmartSliceSubtitleChunkPunctuation(current));
      current = unit;
    } else {
      current = candidate;
    }
  }
  if (current.trim()) {
    chunks.push(trimSmartSliceSubtitleChunkPunctuation(current));
  }

  return chunks.filter(Boolean);
}

function fitSmartSliceSubtitleChunksToDuration(
  chunks: readonly string[],
  durationMs: number,
) {
  const maxChunkCount = Math.max(1, Math.floor(durationMs / SMART_SLICE_SUBTITLE_MIN_CUE_DURATION_MS));
  const targetChunkCount = Math.max(
    1,
    Math.min(
      maxChunkCount,
      Math.ceil(durationMs / SMART_SLICE_SUBTITLE_MAX_CUE_DURATION_MS),
    ),
  );
  const adjustedChunks = chunks.map((chunk) => chunk.trim()).filter(Boolean);
  if (adjustedChunks.length === 0) {
    return [];
  }

  while (adjustedChunks.length > maxChunkCount) {
    const mergeIndex = findSmartSliceSubtitleChunkMergeIndex(adjustedChunks);
    adjustedChunks.splice(
      mergeIndex,
      2,
      joinSmartSliceSubtitleTextUnit(adjustedChunks[mergeIndex] ?? '', adjustedChunks[mergeIndex + 1] ?? ''),
    );
  }

  while (adjustedChunks.length < targetChunkCount) {
    const splitIndex = findSmartSliceSubtitleChunkSplitIndex(adjustedChunks);
    if (splitIndex < 0) {
      break;
    }

    const splitChunks = splitSmartSliceSubtitleChunkNearHalf(adjustedChunks[splitIndex] ?? '');
    if (!splitChunks) {
      break;
    }
    adjustedChunks.splice(splitIndex, 1, ...splitChunks);
  }

  return adjustedChunks;
}

function findSmartSliceSubtitleChunkMergeIndex(chunks: readonly string[]) {
  let bestIndex = 0;
  let bestWeight = Number.POSITIVE_INFINITY;
  for (let index = 0; index < chunks.length - 1; index += 1) {
    const weight =
      countSmartSliceSubtitleDisplayUnits(chunks[index] ?? '') +
      countSmartSliceSubtitleDisplayUnits(chunks[index + 1] ?? '');
    if (weight < bestWeight) {
      bestIndex = index;
      bestWeight = weight;
    }
  }
  return bestIndex;
}

function findSmartSliceSubtitleChunkSplitIndex(chunks: readonly string[]) {
  let bestIndex = -1;
  let bestWeight = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    const units = splitSmartSliceSubtitleTextUnits(chunks[index] ?? '');
    const weight = countSmartSliceSubtitleDisplayUnits(chunks[index] ?? '');
    if (units.length >= 2 && weight > bestWeight) {
      bestIndex = index;
      bestWeight = weight;
    }
  }
  return bestIndex;
}

function splitSmartSliceSubtitleChunkNearHalf(chunk: string) {
  const units = splitSmartSliceSubtitleTextUnits(chunk);
  if (units.length < 2) {
    return undefined;
  }

  const totalWeight = countSmartSliceSubtitleDisplayUnits(chunk);
  const targetWeight = Math.max(1, totalWeight / 2);
  let left = '';
  let splitAfterIndex = 0;
  for (let index = 0; index < units.length - 1; index += 1) {
    left = joinSmartSliceSubtitleTextUnit(left, units[index] ?? '');
    splitAfterIndex = index;
    if (countSmartSliceSubtitleDisplayUnits(left) >= targetWeight) {
      break;
    }
  }

  const firstChunk = trimSmartSliceSubtitleChunkPunctuation(
    units.slice(0, splitAfterIndex + 1).reduce(joinSmartSliceSubtitleTextUnit, ''),
  );
  const secondChunk = trimSmartSliceSubtitleChunkPunctuation(
    units.slice(splitAfterIndex + 1).reduce(joinSmartSliceSubtitleTextUnit, ''),
  );
  return firstChunk && secondChunk ? [firstChunk, secondChunk] : undefined;
}

function splitSmartSliceSubtitleTextUnits(text: string) {
  if (/\p{Script=Han}/u.test(text)) {
    const units = text.match(/\p{Script=Han}|[A-Za-z0-9]+|[^\s\p{Script=Han}A-Za-z0-9]/gu) ?? [];
    return units.map((unit) => unit.trim()).filter(Boolean);
  }

  return text.split(/\s+/u).map((unit) => unit.trim()).filter(Boolean);
}

function joinSmartSliceSubtitleTextUnit(current: string, unit: string) {
  if (!current) {
    return unit;
  }
  if (SMART_SLICE_SUBTITLE_PUNCTUATION_PATTERN.test(unit)) {
    return `${current}${unit}`;
  }
  if (/\p{Script=Han}$/u.test(current) || /^\p{Script=Han}/u.test(unit)) {
    return `${current}${unit}`;
  }
  return `${current} ${unit}`;
}

function shouldStartNewSmartSliceSubtitleChunk(current: string, candidate: string, unit: string) {
  const hasCjk = /\p{Script=Han}/u.test(candidate);
  const maxChars = hasCjk ? SMART_SLICE_SUBTITLE_MAX_CJK_CHARS : SMART_SLICE_SUBTITLE_MAX_LATIN_CHARS;
  if (countSmartSliceSubtitleDisplayUnits(candidate) <= maxChars) {
    return false;
  }

  return !SMART_SLICE_SUBTITLE_PUNCTUATION_PATTERN.test(unit) && countSmartSliceSubtitleDisplayUnits(current) >= Math.max(6, Math.floor(maxChars * 0.55));
}

function countSmartSliceSubtitleDisplayUnits(text: string) {
  let units = 0;
  for (const character of text) {
    units += /\p{Script=Han}/u.test(character) ? 2 : 1;
  }
  return units;
}

function trimSmartSliceSubtitleChunkPunctuation(text: string) {
  return text.trim().replace(/^[,.;:!?\u3001\u3002\uff0c\uff01\uff1f\uff1b\uff1a]+/u, '').trim();
}

function getSmartSliceSubtitleTimingWeight(text: string) {
  return Math.max(1, countSmartSliceSubtitleDisplayUnits(text));
}

function createVideoSliceFailureDiagnostics(error: unknown) {
  const lines = [
    'AutoCut smart-slice execution diagnostic trace',
    `Original error: ${error instanceof Error ? error.message : String(error)}`,
    'Stack:',
    error instanceof Error && error.stack ? error.stack : 'No JavaScript stack was available.',
  ];

  if (error instanceof Error && error.cause !== undefined) {
    const cause = error.cause;
    lines.push(
      `Cause: ${cause instanceof Error ? cause.message : String(cause)}`,
      'Cause stack:',
      cause instanceof Error && cause.stack ? cause.stack : 'No cause stack was available.',
    );
  }

  return lines.join('\n');
}

function createSmartSlicePlanningFailureDiagnostics(error: unknown) {
  if (!(error instanceof SmartSlicePlanningError)) {
    return '';
  }

  return [
    'Smart Slice planning failure context:',
    JSON.stringify(error.diagnostics, null, 2),
  ].join('\n');
}

function createVideoSliceStageDiagnosticPayload(stage: string, details: Record<string, unknown>) {
  return { stage, ...details };
}

function writeSmartSliceConsoleDiagnostic(
  level: 'info' | 'warn' | 'error',
  message: string,
  payload: Record<string, unknown>,
) {
  if (typeof console === 'undefined') {
    return;
  }

  try {
    const writer = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
    if (typeof writer === 'function') {
      writer(message, payload);
    }
  } catch {
    // Console diagnostics must never interrupt Smart Slice execution.
  }
}

function reportVideoSliceStageDiagnostic(stage: string, details: Record<string, unknown> = {}) {
  writeSmartSliceConsoleDiagnostic(
    'info',
    `[AutoCut:slicer.service] Smart Slice ${stage}`,
    createVideoSliceStageDiagnosticPayload(stage, details),
  );
}

function reportSmartSliceExecutionPlan(taskId: string, details: Record<string, unknown> = {}) {
  writeSmartSliceConsoleDiagnostic(
    'info',
    '[AutoCut:slicer.service] Smart Slice execution plan',
    {
      taskId,
      stage: 'execution plan',
      steps: SMART_SLICE_EXECUTION_STEPS.map((step, index) => ({
        order: index + 1,
        id: step.id,
        label: step.label,
        progressBefore: step.progressBefore,
        progressAfter: step.progressAfter,
      })),
      ...details,
    },
  );
}

interface SmartSliceStepTaskUpdateParams {
  step: SmartSliceExecutionStep;
  status: AutoCutTaskExecutionStepStatus;
  eventType: string;
  severity: AutoCutTaskExecutionLogSeverity;
  message: string;
  progress: number;
  startedAt?: string;
  completedAt?: string;
  details?: Record<string, unknown>;
}

interface SmartSliceExecutionStepUpdateParams {
  step: SmartSliceExecutionStep;
  status: AutoCutTaskExecutionStepStatus;
  startedAt?: string;
  completedAt?: string;
  progress: number;
  message: string;
}

interface SmartSliceExecutionLogUpdateParams {
  taskId: string;
  step: SmartSliceExecutionStep;
  eventType: string;
  severity: AutoCutTaskExecutionLogSeverity;
  message: string;
  progress: number;
  timestamp: string;
  details?: Record<string, unknown>;
}

async function readSmartSliceTaskExecutionState(taskId: string) {
  try {
    return (await getTasks()).find((task) => task.id === taskId);
  } catch {
    return undefined;
  }
}

async function createSmartSliceStepTaskUpdate(
  taskId: string,
  params: SmartSliceStepTaskUpdateParams,
): Promise<Pick<AppTask, 'currentStepId' | 'executionSteps' | 'executionLogs'>> {
  const existingTask = await readSmartSliceTaskExecutionState(taskId);
  const timestamp = params.completedAt ?? params.startedAt ?? createAutoCutTimestamp();

  return {
    currentStepId: params.step.id,
    executionSteps: updateSmartSliceTaskExecutionSteps(existingTask?.executionSteps, {
      step: params.step,
      status: params.status,
      progress: params.progress,
      message: params.message,
      ...(params.startedAt ? { startedAt: params.startedAt } : {}),
      ...(params.completedAt ? { completedAt: params.completedAt } : {}),
    }),
    executionLogs: createSmartSliceTaskExecutionLog(existingTask?.executionLogs, {
      taskId,
      step: params.step,
      eventType: params.eventType,
      severity: params.severity,
      message: params.message,
      progress: params.progress,
      timestamp,
      ...(params.details ? { details: params.details } : {}),
    }),
  };
}

function updateSmartSliceTaskExecutionSteps(
  existingSteps: readonly AutoCutTaskExecutionStep[] | undefined,
  params: SmartSliceExecutionStepUpdateParams,
): AutoCutTaskExecutionStep[] {
  const stepIndex = existingSteps?.findIndex((step) => step.id === params.step.id) ?? -1;
  const existingStep = stepIndex >= 0 ? existingSteps?.[stepIndex] : undefined;
  const startedAt = existingStep?.startedAt ?? params.startedAt;
  const completedAt = params.completedAt ?? (
    params.status === 'completed' ||
    params.status === 'failed' ||
    params.status === 'canceled' ||
    params.status === 'interrupted' ||
    params.status === 'skipped'
      ? createAutoCutTimestamp()
      : existingStep?.completedAt
  );
  const attempts = existingStep?.attempts ?? 1;
  const nextStep: AutoCutTaskExecutionStep = {
    id: params.step.id,
    label: params.step.label,
    status: params.status,
    progress: Math.min(100, Math.max(0, Math.round(params.progress))),
    ...(startedAt ? { startedAt } : {}),
    ...(completedAt ? { completedAt } : {}),
    attempts,
    canResumeFromHere: canResumeFromSmartSliceStep(params.step.id, params.status),
    checkpointKey: `smart-slice:${params.step.id}`,
    message: params.message,
    ...(params.status === 'failed' ? { errorMessage: params.message } : existingStep?.errorMessage ? { errorMessage: existingStep.errorMessage } : {}),
  };
  if (nextStep.startedAt && nextStep.completedAt) {
    const durationMs = createSmartSliceTimestampDurationMs(nextStep.startedAt, nextStep.completedAt);
    if (durationMs !== undefined) {
      nextStep.durationMs = durationMs;
    }
  }

  if (!existingSteps || stepIndex < 0) {
    return [...(existingSteps ?? []), nextStep];
  }

  return existingSteps.map((step, index) => (index === stepIndex ? nextStep : step));
}

function createSmartSliceTaskExecutionLog(
  existingLogs: readonly AutoCutTaskExecutionLog[] | undefined,
  params: SmartSliceExecutionLogUpdateParams,
): AutoCutTaskExecutionLog[] {
  const startedAt = existingLogs?.find((log) => log.stepId === params.step.id && log.eventType === 'step-started')?.timestamp;
  const elapsedMs = startedAt ? createSmartSliceTimestampDurationMs(startedAt, params.timestamp) : undefined;
  const nextLog: AutoCutTaskExecutionLog = {
    id: createAutoCutId('task-log'),
    taskId: params.taskId,
    stepId: params.step.id,
    eventType: params.eventType,
    severity: params.severity,
    message: params.message,
    progress: Math.min(100, Math.max(0, Math.round(params.progress))),
    phase: params.step.id,
    source: 'smart-slice-service',
    timestamp: params.timestamp,
    ...(elapsedMs !== undefined ? { elapsedMs } : {}),
    details: {
      stepId: params.step.id,
      label: params.step.label,
      progressBefore: params.step.progressBefore,
      progressAfter: params.step.progressAfter,
      ...(params.details ?? {}),
    },
  };

  return [...(existingLogs ?? []), nextLog].slice(-500);
}

function canResumeFromSmartSliceStep(
  stepId: SmartSliceExecutionStepId,
  status: AutoCutTaskExecutionStepStatus,
) {
  if (status !== 'completed' && status !== 'failed' && status !== 'interrupted' && status !== 'canceled') {
    return false;
  }
  return stepId === 'prepare-source' ||
    stepId === 'speech-to-text' ||
    stepId === 'plan-clips' ||
    stepId === 'human-review' ||
    stepId === 'analyze-audio-boundaries' ||
    stepId === 'analyze-duplicates' ||
    stepId === 'native-render' ||
    stepId === 'verify-artifacts' ||
    stepId === 'persist-results';
}

function createSmartSliceTimestampDurationMs(startedAt: string, completedAt: string) {
  const started = getAutoCutTimestampMs(startedAt);
  const completed = getAutoCutTimestampMs(completedAt);
  return completed >= started
    ? completed - started
    : undefined;
}

async function runSmartSliceExecutionStep<TResult>(
  context: SmartSliceExecutionContext,
  stepId: SmartSliceExecutionStepId,
  operation: () => Promise<TResult>,
  details: Record<string, unknown> = {},
): Promise<TResult> {
  const taskId = context.task.id;
  await assertSmartSliceTaskNotCanceled(context, stepId);
  const step = SMART_SLICE_EXECUTION_STEP_BY_ID.get(stepId);
  if (!step) {
    throw new Error(`Unknown Smart Slice execution step: ${stepId}`);
  }
  context.currentStepId = stepId;

  const startedAt = createAutoCutTimestamp();
  const startedTaskUpdate = await createSmartSliceStepTaskUpdate(taskId, {
    step,
    status: 'running',
    eventType: 'step-started',
    severity: 'info',
    message: step.progressMessage,
    progress: step.progressBefore,
    startedAt,
    details,
  });
  await updateTask(taskId, {
    ...startedTaskUpdate,
    status: AUTOCUT_TASK_STATUS.processing,
    progress: step.progressBefore,
    progressMessage: step.progressMessage,
  });
  reportVideoSliceStageDiagnostic(`${step.id} started`, {
    taskId,
    label: step.label,
    progressBefore: step.progressBefore,
    progressAfter: step.progressAfter,
    ...details,
  });

  try {
    const result = await operation();
    await assertSmartSliceTaskNotCanceled(context, stepId);
    const completedAt = createAutoCutTimestamp();
    const taskUpdate = await createSmartSliceStepTaskUpdate(taskId, {
      step,
      status: 'completed',
      eventType: 'step-completed',
      severity: 'info',
      message: step.progressMessage,
      progress: step.progressAfter,
      completedAt,
      details,
    });
    await updateTask(taskId, {
      ...taskUpdate,
      status: AUTOCUT_TASK_STATUS.processing,
      progress: step.progressAfter,
      progressMessage: step.progressMessage,
    });
    reportVideoSliceStageDiagnostic(`${step.id} completed`, {
      taskId,
      label: step.label,
      progressBefore: step.progressBefore,
      progressAfter: step.progressAfter,
      ...details,
    });
    return result;
  } catch (error) {
    if (isAutoCutProcessingTaskCanceledError(error)) {
      throw error;
    }
    const failedAt = createAutoCutTimestamp();
    const taskUpdate = await createSmartSliceStepTaskUpdate(taskId, {
      step,
      status: 'failed',
      eventType: 'step-failed',
      severity: 'error',
      message: error instanceof Error ? error.message : String(error),
      progress: step.progressBefore,
      completedAt: failedAt,
      details,
    });
    await updateTask(taskId, {
      ...taskUpdate,
      status: AUTOCUT_TASK_STATUS.processing,
      progress: step.progressBefore,
      progressMessage: `Smart Slice ${step.label} failed.`,
    });
    reportVideoSliceStageDiagnostic(`${step.id} failed`, {
      taskId,
      label: step.label,
      progressBefore: step.progressBefore,
      progressAfter: step.progressAfter,
      errorMessage: error instanceof Error ? error.message : String(error),
      ...details,
    });
    throw error;
  } finally {
    if (context.currentStepId === stepId) {
      delete context.currentStepId;
    }
  }
}

async function runSmartSliceLongRunningExecutionStep<TResult>(
  context: SmartSliceExecutionContext,
  stepId: SmartSliceExecutionStepId,
  operation: () => Promise<TResult>,
  details: Record<string, unknown> = {},
): Promise<TResult> {
  const stopProgressMonitor = startSmartSliceLongRunningStageProgressMonitor(context, stepId);
  try {
    return await runSmartSliceExecutionStep(context, stepId, operation, details);
  } finally {
    stopProgressMonitor();
  }
}

function startSmartSliceLongRunningStageProgressMonitor(
  context: SmartSliceExecutionContext,
  stepId: SmartSliceExecutionStepId,
) {
  const step = SMART_SLICE_EXECUTION_STEP_BY_ID.get(stepId);
  if (!step) {
    return () => undefined;
  }
  const taskId = context.task.id;
  const startedAtMs = createAutoCutRelativeTimestampMs();
  let lastObservedAtMs = startedAtMs;
  let lastRecordedProgressValue: number | undefined;
  let lastRecordedPhase: string | undefined;
  return listenAutoCutEvent('nativeTaskProgress', (progress) => {
    const workflowTaskId = progress.workflowTaskId?.trim() || String(progress.payload?.workflowTaskId ?? '').trim();
    const progressStepId = progress.stepId?.trim() || String(progress.payload?.stepId ?? '').trim();
    if (workflowTaskId !== taskId || progressStepId !== stepId) {
      return;
    }

    const nowMs = createAutoCutRelativeTimestampMs();
    if (nowMs - lastObservedAtMs < 1_000) {
      return;
    }
    lastObservedAtMs = nowMs;
    const elapsedMs = Math.max(0, nowMs - startedAtMs);
    const progressValue = resolveSmartSliceLongRunningStageProgressValue(step, progress);
    const progressPhase = progress.phase?.trim() || String(progress.payload?.phase ?? '').trim();
    if (!shouldRecordSmartSliceLongRunningStageProgress({
      progressValue,
      progressPhase,
      lastRecordedProgressValue,
      lastRecordedPhase,
    })) {
      return;
    }
    lastRecordedProgressValue = progressValue;
    lastRecordedPhase = progressPhase;
    void recordSmartSliceLongRunningStageProgress(context, step, progress, elapsedMs);
  });
}

function resolveSmartSliceLongRunningStageProgressValue(
  step: SmartSliceExecutionStep,
  progress: { progress?: number },
) {
  return typeof progress.progress === 'number'
    ? Math.min(step.progressAfter - 1, Math.max(step.progressBefore, Math.round(progress.progress)))
    : step.progressBefore;
}

function shouldRecordSmartSliceLongRunningStageProgress(params: {
  progressValue: number;
  progressPhase: string;
  lastRecordedProgressValue: number | undefined;
  lastRecordedPhase: string | undefined;
}) {
  if (params.lastRecordedProgressValue === undefined) {
    return true;
  }
  if (params.progressPhase && params.progressPhase !== params.lastRecordedPhase) {
    return true;
  }
  if (
    params.progressValue <= 1 ||
    params.progressValue >= 99 ||
    params.progressValue % SMART_SLICE_LONG_RUNNING_PROGRESS_MILESTONE_PERCENT === 0
  ) {
    return params.progressValue !== params.lastRecordedProgressValue;
  }

  return Math.floor(params.progressValue / SMART_SLICE_LONG_RUNNING_PROGRESS_MILESTONE_PERCENT) >
    Math.floor(params.lastRecordedProgressValue / SMART_SLICE_LONG_RUNNING_PROGRESS_MILESTONE_PERCENT);
}

async function recordSmartSliceLongRunningStageProgress(
  context: SmartSliceExecutionContext,
  step: SmartSliceExecutionStep,
  progress: { progress?: number; message?: string; phase?: string; source?: string; payload?: Record<string, unknown> },
  elapsedMs: number,
) {
  const existingTask = await readSmartSliceTaskExecutionState(context.task.id);
  const progressValue = resolveSmartSliceLongRunningStageProgressValue(step, progress);
  const message = createSmartSliceLongRunningStageProgressMessage(step, progress, elapsedMs);
  await updateTask(context.task.id, {
    executionLogs: createSmartSliceTaskExecutionLog(existingTask?.executionLogs, {
      taskId: context.task.id,
      step,
      eventType: 'long-running-progress',
      severity: 'info',
      message,
      progress: progressValue,
      timestamp: createAutoCutTimestamp(),
      details: {
        elapsedMs,
        nativeProgress: progress.progress,
        nativePhase: progress.phase,
        nativeSource: progress.source,
        ...(progress.payload ?? {}),
      },
    }),
    progress: Math.max(existingTask?.progress ?? 0, progressValue),
    progressMessage: message,
  });
}

function createSmartSliceLongRunningStageProgressMessage(
  step: SmartSliceExecutionStep,
  progress: { message?: string; phase?: string },
  elapsedMs: number,
) {
  const elapsedSeconds = Math.max(1, Math.round(elapsedMs / 1_000));
  const stageMessage = progress.message?.trim() || progress.phase?.trim() || step.progressMessage;
  return `${stageMessage} Elapsed ${elapsedSeconds}s.`;
}

function startSmartSliceSpeechTranscriptionSetupProgressBridge(taskId: string) {
  return listenAutoCutEvent('speechTranscriptionModelDownloadProgress', (progress) => {
    const step = SMART_SLICE_EXECUTION_STEP_BY_ID.get('speech-to-text');
    if (!step) {
      return;
    }

    void updateTask(taskId, {
      status: AUTOCUT_TASK_STATUS.processing,
      progress: step.progressBefore,
      progressMessage: createSmartSliceSpeechTranscriptionSetupProgressMessage(progress),
    });
    reportVideoSliceStageDiagnostic('speech-to-text model setup progress', {
      taskId,
      phase: progress.phase,
      downloadedBytes: progress.downloadedBytes,
      totalBytes: progress.totalBytes,
      progress: progress.progress,
      modelPath: progress.modelPath,
      errorMessage: progress.errorMessage,
    });
  });
}

function createSmartSliceSpeechTranscriptionSetupProgressMessage(
  progress: AutoCutSpeechTranscriptionModelDownloadProgressEvent,
) {
  const progressSuffix = typeof progress.progress === 'number'
    ? ` ${Math.min(100, Math.max(0, Math.round(progress.progress)))}%`
    : '';
  if (progress.phase === AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_PHASE.completed) {
    return 'Speech recognition model is ready. Verifying local speech-to-text before transcription.';
  }
  if (progress.phase === AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_PHASE.failed) {
    return progress.errorMessage
      ? `Speech recognition model setup failed: ${progress.errorMessage}`
      : 'Speech recognition model setup failed. Check the local speech-to-text settings and retry.';
  }
  if (progress.phase === AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_PHASE.skipped) {
    return 'Speech recognition model needs a manual download. Copy the model link or select the completed local model file.';
  }
  if (progress.phase === AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_PHASE.downloading) {
    return `Downloading speech recognition model${progressSuffix}. Smart Slice will continue after local speech-to-text is ready.`;
  }

  return 'Preparing speech recognition model download. Smart Slice will continue after local speech-to-text is ready.';
}

async function updateSmartSliceTaskCompleted(
  taskId: string,
  update: Parameters<typeof updateTask>[1],
) {
  await updateTask(taskId, {
    ...update,
    status: AUTOCUT_TASK_STATUS.completed,
    progress: 100,
    progressMessage: 'Video slicing completed.',
    completedAt: createAutoCutTimestamp(),
  });
}

function createSmartSliceCheckpoint(params: VideoSliceParams): AutoCutTaskExecutionCheckpoint {
  return {
    workflowId: SMART_SLICE_WORKFLOW_ID,
    version: SMART_SLICE_CHECKPOINT_VERSION,
    resumeFromStepIds: [],
    completedStepIds: [],
    artifacts: {},
    updatedAt: createAutoCutTimestamp(),
    source: createSmartSliceCheckpointSource(params),
    params: createSerializableSmartSliceParams(params) as unknown as Record<string, unknown>,
  };
}

function createSerializableSmartSliceParams(params: VideoSliceParams): SmartSliceCheckpointParams {
  return {
    mode: params.mode,
    ...(params.fileId?.trim() ? { fileId: params.fileId.trim() } : {}),
    ...(params.url?.trim() ? { url: params.url.trim() } : {}),
    llmModel: params.llmModel,
    ...(params.targetPlatform ? { targetPlatform: params.targetPlatform } : {}),
    ...(params.targetAspectRatio ? { targetAspectRatio: params.targetAspectRatio } : {}),
    ...(params.videoObjectFit ? { videoObjectFit: params.videoObjectFit } : {}),
    ...(typeof params.idealDuration === 'number' ? { idealDuration: params.idealDuration } : {}),
    ...(typeof params.sourceDurationMs === 'number' ? { sourceDurationMs: params.sourceDurationMs } : {}),
    ...(params.continuityLevel ? { continuityLevel: params.continuityLevel } : {}),
    ...(params.segmentationDensity ? { segmentationDensity: params.segmentationDensity } : {}),
    ...(params.sttPresetId ? { sttPresetId: params.sttPresetId } : {}),
    segmentationAgentId: resolveSmartSliceSegmentationAgentId(params.segmentationAgentId),
    ...(params.customKeywords?.length ? { customKeywords: [...params.customKeywords] } : {}),
    minDuration: params.minDuration,
    maxDuration: params.maxDuration,
    baseAlgorithm: params.baseAlgorithm,
    highlightEngine: params.highlightEngine,
    ...(params.enableNoiseReduction !== undefined ? { enableNoiseReduction: params.enableNoiseReduction } : {}),
    enableCoughFilter: params.enableCoughFilter,
    enableRepeatFilter: params.enableRepeatFilter,
    ...(params.enableSmartDedup !== undefined ? { enableSmartDedup: params.enableSmartDedup } : {}),
    ...(params.videoDedupParams ? { videoDedupParams: createDefaultAutoCutVideoDedupParams(params.videoDedupParams) } : {}),
    ...(params.enableSubtitles !== undefined ? { enableSubtitles: params.enableSubtitles } : {}),
    ...(params.subtitleMode ? { subtitleMode: params.subtitleMode } : {}),
    ...(params.subtitleStyleId ? { subtitleStyleId: params.subtitleStyleId } : {}),
  };
}

function createSmartSliceCheckpointSource(params: VideoSliceParams): SmartSliceCheckpointSource {
  const trustedSourcePath = resolveAutoCutTrustedSourcePath(params.file);
  if (trustedSourcePath && params.file) {
    const trustedFile = params.file as File & {
      byteSize?: number;
      mediaType?: string;
      hasAudioStream?: boolean;
      hasVideoStream?: boolean;
    };
    return {
      kind: 'trusted-local-file',
      sourcePath: trustedSourcePath,
      fileName: params.file.name,
      byteSize: trustedFile.byteSize ?? params.file.size,
      mediaType: trustedFile.mediaType ?? (params.file.type.startsWith('video/') ? 'video' : 'binary'),
      mimeType: params.file.type || 'application/octet-stream',
      hasAudioStream: trustedFile.hasAudioStream ?? trustedFile.mediaType === 'audio',
      hasVideoStream: trustedFile.hasVideoStream ?? trustedFile.mediaType === 'video',
      ...(params.fileId?.trim() ? { fileId: params.fileId.trim() } : {}),
    };
  }
  if (params.fileId?.trim()) {
    return {
      kind: 'native-asset',
      fileId: params.fileId.trim(),
    };
  }
  if (params.url?.trim()) {
    return {
      kind: 'url',
      url: params.url.trim(),
    };
  }
  return { kind: 'unknown' };
}

function restoreSmartSliceParamsFromCheckpoint(checkpoint: AutoCutTaskExecutionCheckpoint): VideoSliceParams {
  if (checkpoint.workflowId !== SMART_SLICE_WORKFLOW_ID) {
    throw new Error('Smart Slice resume requires a Smart Slice execution checkpoint.');
  }
  if (checkpoint.version !== SMART_SLICE_CHECKPOINT_VERSION) {
    throw new Error(
      'Smart Slice resume failed because the checkpoint was created by an older slicing algorithm. Restart Smart Slice so clip planning, silence compaction, and rotation cleanup are regenerated.',
    );
  }
  const params = checkpoint.params as Partial<SmartSliceCheckpointParams> | undefined;
  if (!params?.mode || !params.llmModel || !params.baseAlgorithm || !params.highlightEngine) {
    throw new Error('Smart Slice resume failed because the checkpoint params are incomplete.');
  }
  if (typeof params.minDuration !== 'number' || typeof params.maxDuration !== 'number') {
    throw new Error('Smart Slice resume failed because checkpoint duration settings are incomplete.');
  }

  const source = checkpoint.source;
  const restoredFile =
    source?.kind === 'trusted-local-file' && source.sourcePath && source.fileName
      ? createAutoCutTrustedLocalFile({
          sourcePath: source.sourcePath,
          name: source.fileName,
          byteSize: source.byteSize ?? 0,
          mediaType: source.mediaType ?? 'video',
          mimeType: source.mimeType ?? 'video/mp4',
          hasAudioStream: source.hasAudioStream ?? true,
          hasVideoStream: source.hasVideoStream ?? true,
        })
      : undefined;

  return {
    mode: params.mode,
    ...(source?.fileId ?? params.fileId ? { fileId: source?.fileId ?? params.fileId } : {}),
    ...(restoredFile ? { file: restoredFile } : {}),
    ...(source?.url ?? params.url ? { url: source?.url ?? params.url } : {}),
    llmModel: params.llmModel,
    ...(params.targetPlatform ? { targetPlatform: params.targetPlatform } : {}),
    ...(params.targetAspectRatio ? { targetAspectRatio: params.targetAspectRatio } : {}),
    ...(params.videoObjectFit ? { videoObjectFit: params.videoObjectFit } : {}),
    ...(typeof params.idealDuration === 'number' ? { idealDuration: params.idealDuration } : {}),
    ...(typeof params.sourceDurationMs === 'number' ? { sourceDurationMs: params.sourceDurationMs } : {}),
    ...(params.continuityLevel ? { continuityLevel: params.continuityLevel } : {}),
    ...(params.segmentationDensity ? { segmentationDensity: params.segmentationDensity } : {}),
    ...(params.sttPresetId ? { sttPresetId: params.sttPresetId } : {}),
    segmentationAgentId: resolveSmartSliceSegmentationAgentId(params.segmentationAgentId),
    ...(params.customKeywords?.length ? { customKeywords: [...params.customKeywords] } : {}),
    minDuration: params.minDuration,
    maxDuration: params.maxDuration,
    baseAlgorithm: params.baseAlgorithm,
    highlightEngine: params.highlightEngine,
    ...(params.enableNoiseReduction !== undefined ? { enableNoiseReduction: params.enableNoiseReduction } : {}),
    enableCoughFilter: params.enableCoughFilter ?? true,
    enableRepeatFilter: params.enableRepeatFilter ?? true,
    ...(params.enableSmartDedup !== undefined ? { enableSmartDedup: params.enableSmartDedup } : {}),
    ...(params.videoDedupParams ? { videoDedupParams: createDefaultAutoCutVideoDedupParams(params.videoDedupParams) } : {}),
    ...(params.enableSubtitles !== undefined ? { enableSubtitles: params.enableSubtitles } : {}),
    ...(params.subtitleMode ? { subtitleMode: params.subtitleMode } : {}),
    ...(params.subtitleStyleId ? { subtitleStyleId: params.subtitleStyleId } : {}),
  };
}

function readSmartSliceCheckpointArtifacts(
  checkpoint: AutoCutTaskExecutionCheckpoint,
): SmartSliceCheckpointArtifacts {
  return checkpoint.artifacts as unknown as SmartSliceCheckpointArtifacts;
}

function createSmartSliceCompletedCheckpoint(
  checkpoint: AutoCutTaskExecutionCheckpoint,
  stepId: SmartSliceExecutionStepId,
  artifact: Record<string, unknown>,
): AutoCutTaskExecutionCheckpoint {
  const completedStepIds = addUniqueCheckpointStepId(checkpoint.completedStepIds, stepId);
  const resumeFromStepIds = createSmartSliceResumeFromStepIds(completedStepIds, []);
  return {
    ...checkpoint,
    completedStepIds,
    resumeFromStepIds,
    artifacts: {
      ...checkpoint.artifacts,
      [stepId]: artifact,
    },
    updatedAt: createAutoCutTimestamp(),
  };
}

function createSmartSliceFailedCheckpoint(
  checkpoint: AutoCutTaskExecutionCheckpoint,
  stepId: SmartSliceExecutionStepId,
): AutoCutTaskExecutionCheckpoint {
  return {
    ...checkpoint,
    resumeFromStepIds: createSmartSliceResumeFromStepIds(checkpoint.completedStepIds, [stepId]),
    updatedAt: createAutoCutTimestamp(),
  };
}

function createSmartSliceCanceledCheckpoint(
  checkpoint: AutoCutTaskExecutionCheckpoint,
  stepId: SmartSliceExecutionStepId,
): AutoCutTaskExecutionCheckpoint {
  return createSmartSliceFailedCheckpoint(checkpoint, stepId);
}

function addUniqueCheckpointStepId(
  stepIds: readonly string[],
  stepId: SmartSliceExecutionStepId,
) {
  return [...new Set([...stepIds, stepId])];
}

function createSmartSliceResumeFromStepIds(
  completedStepIds: readonly string[],
  extraStepIds: readonly SmartSliceExecutionStepId[],
) {
  const completedStepIdSet = new Set(completedStepIds);
  return [
    ...SMART_SLICE_EXECUTION_STEPS
      .filter((step) => completedStepIdSet.has(step.id) && canResumeFromSmartSliceStep(step.id, 'completed'))
      .map((step) => step.id),
    ...extraStepIds.filter((stepId) => canResumeFromSmartSliceStep(stepId, 'failed')),
  ];
}

function getSmartSliceExecutionStepIndex(stepId: SmartSliceExecutionStepId) {
  return SMART_SLICE_EXECUTION_STEPS.findIndex((step) => step.id === stepId);
}

function shouldReuseSmartSliceCheckpoint(
  context: SmartSliceExecutionContext,
  stepId: SmartSliceExecutionStepId,
) {
  if (!context.resumeFromStepId) {
    return false;
  }
  const stepIndex = getSmartSliceExecutionStepIndex(stepId);
  const resumeStepIndex = getSmartSliceExecutionStepIndex(context.resumeFromStepId);
  return stepIndex >= 0 && resumeStepIndex >= 0 && stepIndex < resumeStepIndex;
}

function createSmartSliceTaskCanceledMessage(stepId?: SmartSliceExecutionStepId) {
  return stepId
    ? `Smart Slice canceled during ${stepId}.`
    : 'Smart Slice task canceled.';
}

async function assertSmartSliceTaskNotCanceled(
  context: SmartSliceExecutionContext,
  stepId?: SmartSliceExecutionStepId,
): Promise<void> {
  if (!isAutoCutTaskCancellationRequested(context.task.id)) {
    return;
  }
  return await markSmartSliceTaskCanceled(context, stepId, createSmartSliceTaskCanceledMessage(stepId));
}

async function markSmartSliceTaskCanceled(
  context: SmartSliceExecutionContext,
  stepId: SmartSliceExecutionStepId | undefined,
  message: string,
): Promise<never> {
  const resolvedStepId = stepId ?? context.currentStepId ?? context.resumeFromStepId;
  clearAutoCutTaskCancellationRequest(context.task.id);
  const timestamp = createAutoCutTimestamp();
  const existingTask = await readSmartSliceTaskExecutionState(context.task.id);
  const updates: Parameters<typeof updateTask>[1] = {
    status: AUTOCUT_TASK_STATUS.canceled,
    progressMessage: 'Task canceled.',
    errorMessage: message,
    completedAt: timestamp,
  };

  if (resolvedStepId) {
    const step = SMART_SLICE_EXECUTION_STEP_BY_ID.get(resolvedStepId);
    if (step) {
      const taskUpdate = await createSmartSliceStepTaskUpdate(context.task.id, {
        step,
        status: 'canceled',
        eventType: 'step-canceled',
        severity: 'warning',
        message,
        progress: Math.max(
          step.progressBefore,
          Math.min(step.progressAfter, existingTask?.progress ?? context.task.progress ?? step.progressBefore),
        ),
        completedAt: timestamp,
        details: {
          cancellationRequested: true,
          resumeFromStepId: resolvedStepId,
        },
      });
      context.checkpoint = createSmartSliceCanceledCheckpoint(context.checkpoint, resolvedStepId);
      Object.assign(updates, taskUpdate, {
        currentStepId: resolvedStepId,
        executionCheckpoint: context.checkpoint,
      });
    } else {
      context.checkpoint = createSmartSliceCanceledCheckpoint(context.checkpoint, resolvedStepId);
      Object.assign(updates, {
        currentStepId: resolvedStepId,
        executionCheckpoint: context.checkpoint,
      });
    }
  }

  await updateTask(context.task.id, updates);
  throw createSmartSliceTaskCanceledError(context.task.id, message);
}

function createSmartSliceTaskCanceledError(
  taskId: string,
  message: string,
) {
  return new AutoCutProcessingTaskError(message, taskId, {
    terminalStatus: AUTOCUT_TASK_STATUS.canceled,
  });
}

interface SmartSliceCheckpointReuse<TResult> {
  found: boolean;
  value?: TResult;
}

interface SmartSliceSpeechToTextEvidenceStepResult {
  transcriptSegments: AutoCutSpeechTranscriptionSegment[];
  speechToTextEvidence: SmartSliceCheckpointEvidenceWriteResult;
  normalizedTranscriptEvidence: SmartSliceCheckpointEvidenceWriteResult;
}

interface SmartSliceSemanticSegmentationEvidenceStepResult {
  plannedClips: NormalizedSlicePlanClip[];
  semanticSegmentationEvidence: SmartSliceCheckpointEvidenceWriteResult;
}

interface SmartSliceHumanReviewEvidenceStepResult {
  reviewSession: AutoCutSliceReviewSession;
  reviewSessionEvidence?: SmartSliceCheckpointEvidenceWriteResult;
  manualEditsEvidence?: SmartSliceCheckpointEvidenceWriteResult;
  reviewEventsEvidence?: SmartSliceCheckpointEvidenceWriteResult;
  renderSelectionEvidence?: SmartSliceCheckpointEvidenceWriteResult;
}

interface SmartSliceVerifyArtifactsEvidenceStepResult {
  sliceResults: TaskSliceResult[];
  renderArtifactManifestEvidence?: SmartSliceCheckpointEvidenceWriteResult;
}

async function runSmartSliceCheckpointedExecutionStep<TResult>(
  context: SmartSliceExecutionContext,
  stepId: SmartSliceExecutionStepId,
  readCheckpoint: (artifacts: SmartSliceCheckpointArtifacts) => SmartSliceCheckpointReuse<TResult>,
  operation: () => Promise<TResult>,
  createArtifact: (result: TResult) => Record<string, unknown>,
  details: Record<string, unknown> = {},
): Promise<TResult> {
  await assertSmartSliceTaskNotCanceled(context, stepId);
  if (shouldReuseSmartSliceCheckpoint(context, stepId)) {
    const checkpointValue = readCheckpoint(readSmartSliceCheckpointArtifacts(context.checkpoint));
    if (checkpointValue.found) {
      await assertSmartSliceTaskNotCanceled(context, stepId);
      await recordSmartSliceCheckpointReuse(context.task.id, stepId);
      await assertSmartSliceTaskNotCanceled(context, stepId);
      return checkpointValue.value as TResult;
    }
    await recordSmartSliceCheckpointRefresh(context.task.id, stepId);
  }

  try {
    const result = await runSmartSliceExecutionStep(context, stepId, operation, details);
    await assertSmartSliceTaskNotCanceled(context, stepId);
    context.checkpoint = createSmartSliceCompletedCheckpoint(context.checkpoint, stepId, createArtifact(result));
    await updateTask(context.task.id, { executionCheckpoint: context.checkpoint });
    return result;
  } catch (error) {
    if (!isAutoCutProcessingTaskCanceledError(error)) {
      context.checkpoint = createSmartSliceFailedCheckpoint(context.checkpoint, stepId);
      await updateTask(context.task.id, { executionCheckpoint: context.checkpoint });
    }
    throw error;
  }
}

async function runSmartSliceCheckpointedLongRunningExecutionStep<TResult>(
  context: SmartSliceExecutionContext,
  stepId: SmartSliceExecutionStepId,
  readCheckpoint: (artifacts: SmartSliceCheckpointArtifacts) => SmartSliceCheckpointReuse<TResult>,
  operation: () => Promise<TResult>,
  createArtifact: (result: TResult) => Record<string, unknown>,
  details: Record<string, unknown> = {},
): Promise<TResult> {
  await assertSmartSliceTaskNotCanceled(context, stepId);
  if (shouldReuseSmartSliceCheckpoint(context, stepId)) {
    const checkpointValue = readCheckpoint(readSmartSliceCheckpointArtifacts(context.checkpoint));
    if (checkpointValue.found) {
      await assertSmartSliceTaskNotCanceled(context, stepId);
      await recordSmartSliceCheckpointReuse(context.task.id, stepId);
      await assertSmartSliceTaskNotCanceled(context, stepId);
      return checkpointValue.value as TResult;
    }
    await recordSmartSliceCheckpointRefresh(context.task.id, stepId);
  }

  try {
    const result = await runSmartSliceLongRunningExecutionStep(context, stepId, operation, details);
    await assertSmartSliceTaskNotCanceled(context, stepId);
    context.checkpoint = createSmartSliceCompletedCheckpoint(context.checkpoint, stepId, createArtifact(result));
    await updateTask(context.task.id, { executionCheckpoint: context.checkpoint });
    return result;
  } catch (error) {
    if (!isAutoCutProcessingTaskCanceledError(error)) {
      context.checkpoint = createSmartSliceFailedCheckpoint(context.checkpoint, stepId);
      await updateTask(context.task.id, { executionCheckpoint: context.checkpoint });
    }
    throw error;
  }
}

async function recordSmartSliceCheckpointReuse(
  taskId: string,
  stepId: SmartSliceExecutionStepId,
) {
  const step = SMART_SLICE_EXECUTION_STEP_BY_ID.get(stepId);
  const existingTask = await readSmartSliceTaskExecutionState(taskId);
  if (!step) {
    return;
  }
  await updateTask(taskId, {
    executionLogs: createSmartSliceTaskExecutionLog(existingTask?.executionLogs, {
      taskId,
      step,
      eventType: 'checkpoint-reused',
      severity: 'info',
      message: `Reused Smart Slice checkpoint for ${step.label}.`,
      progress: step.progressAfter,
      timestamp: createAutoCutTimestamp(),
      details: {
        checkpointKey: `smart-slice:${step.id}`,
      },
    }),
  });
}

async function recordSmartSliceCheckpointRefresh(
  taskId: string,
  stepId: SmartSliceExecutionStepId,
) {
  const step = SMART_SLICE_EXECUTION_STEP_BY_ID.get(stepId);
  const existingTask = await readSmartSliceTaskExecutionState(taskId);
  if (!step) {
    return;
  }
  await updateTask(taskId, {
    executionLogs: createSmartSliceTaskExecutionLog(existingTask?.executionLogs, {
      taskId,
      step,
      eventType: 'checkpoint-refreshed',
      severity: 'warning',
      message: `Smart Slice checkpoint ${stepId} was incomplete and will be rebuilt.`,
      progress: step.progressBefore,
      timestamp: createAutoCutTimestamp(),
      details: {
        resumeFromStepId: existingTask?.currentStepId,
        reason: 'checkpoint-output-missing-or-incomplete',
      },
    }),
  });
}

function readPrepareSourceCheckpoint(
  artifacts: SmartSliceCheckpointArtifacts,
): SmartSliceCheckpointReuse<SmartSlicePreparedSourceMedia> {
  const sourceMedia = artifacts['prepare-source']?.sourceMedia;
  return sourceMedia?.assetUuid
    ? { found: true, value: sourceMedia }
    : { found: false };
}

function createSmartSliceRuntimeSourceAsset({
  sourceMedia,
  task,
  sourceFile,
  desktopSourcePath,
  createAssetUrl,
}: {
  sourceMedia: SmartSlicePreparedSourceMedia;
  task: AppTask;
  sourceFile?: File | null | undefined;
  desktopSourcePath?: string | null;
  createAssetUrl: (artifactPath: string) => string;
}): AppAsset | undefined {
  const assetUuid = sourceMedia.assetUuid.trim();
  if (!assetUuid || !desktopSourcePath?.trim()) {
    return undefined;
  }

  if (sourceMedia.hasVideoStream === false && sourceMedia.mediaType !== 'video') {
    return undefined;
  }

  const artifactPath = sourceMedia.sandboxPath?.trim();
  let url: string | undefined;
  if (artifactPath) {
    try {
      url = createAssetUrl(artifactPath);
    } catch {
      url = undefined;
    }
  }

  const timestamp = createAutoCutTimestamp();
  return {
    id: assetUuid,
    name: sourceMedia.name?.trim() || sourceFile?.name?.trim() || task.name,
    type: 'video',
    size: Math.max(0, sourceMedia.byteSize ?? sourceFile?.size ?? 0),
    ...(url ? { url } : {}),
    ...(artifactPath ? { artifactPath } : {}),
    sourceTaskId: task.id,
    sourceTaskType: task.type,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function readSpeechToTextCheckpoint(
  artifacts: SmartSliceCheckpointArtifacts,
): SmartSliceCheckpointReuse<SmartSliceSpeechToTextEvidenceStepResult> {
  const speechToText = artifacts['speech-to-text'];
  const transcriptSegments = speechToText?.transcriptSegments;
  return speechToText &&
    transcriptSegments?.length &&
    speechToText.speechToTextEvidence &&
    speechToText.normalizedTranscriptEvidence
    ? {
      found: true,
      value: {
        transcriptSegments,
        speechToTextEvidence: speechToText.speechToTextEvidence,
        normalizedTranscriptEvidence: speechToText.normalizedTranscriptEvidence,
      },
    }
    : { found: false };
}

function readPlanClipsCheckpoint(
  artifacts: SmartSliceCheckpointArtifacts,
): SmartSliceCheckpointReuse<SmartSliceSemanticSegmentationEvidenceStepResult> {
  const planClips = artifacts['plan-clips'];
  const plannedClips = planClips?.plannedClips;
  return planClips && plannedClips?.length && planClips.semanticSegmentationEvidence
    ? {
      found: true,
      value: {
        plannedClips,
        semanticSegmentationEvidence: planClips.semanticSegmentationEvidence,
      },
    }
    : { found: false };
}

function readAudioBoundaryCheckpoint(
  artifacts: SmartSliceCheckpointArtifacts,
): SmartSliceCheckpointReuse<NormalizedSlicePlanClip[]> {
  const refinedPlannedClips = artifacts['analyze-audio-boundaries']?.refinedPlannedClips;
  return refinedPlannedClips?.length
    ? { found: true, value: refinedPlannedClips }
    : { found: false };
}

function readAnalyzeDuplicatesCheckpoint(
  artifacts: SmartSliceCheckpointArtifacts,
): SmartSliceCheckpointReuse<SmartSliceDedupAnalysis> {
  const duplicateAnalysis = artifacts['analyze-duplicates'];
  return typeof duplicateAnalysis?.enabled === 'boolean'
    ? {
        found: true,
        value: {
          enabled: duplicateAnalysis.enabled,
          ...(duplicateAnalysis.smartDedupReport ? { smartDedupReport: duplicateAnalysis.smartDedupReport } : {}),
          duplicateGroups: duplicateAnalysis.duplicateGroups ?? [],
          matchedSegmentIds: duplicateAnalysis.matchedSegmentIds ?? [],
        },
      }
    : { found: false };
}

function readHumanReviewCheckpoint(
  artifacts: SmartSliceCheckpointArtifacts,
): SmartSliceCheckpointReuse<SmartSliceHumanReviewEvidenceStepResult> {
  const reviewSession = artifacts['human-review']?.reviewSession;
  return reviewSession?.segments?.length
    ? {
        found: true,
        value: {
          reviewSession,
          ...(artifacts['human-review']?.reviewSessionEvidence
            ? { reviewSessionEvidence: artifacts['human-review'].reviewSessionEvidence }
            : {}),
          ...(artifacts['human-review']?.manualEditsEvidence
            ? { manualEditsEvidence: artifacts['human-review'].manualEditsEvidence }
            : {}),
          ...(artifacts['human-review']?.reviewEventsEvidence
            ? { reviewEventsEvidence: artifacts['human-review'].reviewEventsEvidence }
            : {}),
          ...(artifacts['human-review']?.renderSelectionEvidence
            ? { renderSelectionEvidence: artifacts['human-review'].renderSelectionEvidence }
            : {}),
        },
      }
    : { found: false };
}

function readNativeRenderCheckpoint(
  artifacts: SmartSliceCheckpointArtifacts,
): SmartSliceCheckpointReuse<Awaited<ReturnType<ReturnType<typeof getAutoCutNativeHostClient>['sliceVideo']>>> {
  const nativeResult = artifacts['native-render']?.nativeResult;
  return nativeResult?.taskUuid && nativeResult.slices?.length
    ? { found: true, value: nativeResult }
    : { found: false };
}

function readVerifyArtifactsCheckpoint(
  artifacts: SmartSliceCheckpointArtifacts,
): SmartSliceCheckpointReuse<SmartSliceVerifyArtifactsEvidenceStepResult> {
  const sliceResults = artifacts['verify-artifacts']?.sliceResults;
  return sliceResults?.length
    ? {
        found: true,
        value: {
          sliceResults,
          ...(artifacts['verify-artifacts']?.renderArtifactManifestEvidence
            ? { renderArtifactManifestEvidence: artifacts['verify-artifacts'].renderArtifactManifestEvidence }
            : {}),
        },
      }
    : { found: false };
}

function readPersistResultsCheckpoint(
  artifacts: SmartSliceCheckpointArtifacts,
): SmartSliceCheckpointReuse<Pick<AppTask, 'resultCount' | 'generatedAssetIds' | 'sliceResults'>> {
  const completedData = artifacts['persist-results']?.completedData;
  return completedData?.sliceResults?.length
    ? { found: true, value: completedData }
    : { found: false };
}

async function writeSmartSliceTaskEvidenceJson({
  nativeHostClient,
  workflowTaskId,
  outputRootDir,
  relativePath,
  contentJson,
}: {
  nativeHostClient: ReturnType<typeof getAutoCutNativeHostClient>;
  workflowTaskId: string;
  outputRootDir?: string;
  relativePath: string;
  contentJson: Record<string, unknown>;
}) {
  const result = await nativeHostClient.writeTaskEvidenceJson({
    workflowTaskId,
    relativePath,
    contentJson,
    ...(outputRootDir ? { outputRootDir } : {}),
  });
  reportVideoSliceStageDiagnostic('task evidence persisted', {
    taskId: workflowTaskId,
    relativePath,
    artifactPath: result.artifactPath,
    byteSize: result.byteSize,
    contentSha256: result.contentSha256,
  });
  return result;
}

async function writeBestEffortSmartSliceTaskEvidenceJson({
  nativeHostClient,
  workflowTaskId,
  outputRootDir,
  relativePath,
  contentJson,
}: {
  nativeHostClient: ReturnType<typeof getAutoCutNativeHostClient>;
  workflowTaskId: string;
  outputRootDir?: string;
  relativePath: string;
  contentJson: Record<string, unknown>;
}): Promise<SmartSliceCheckpointEvidenceWriteResult> {
  try {
    return await writeSmartSliceTaskEvidenceJson({
      nativeHostClient,
      workflowTaskId,
      relativePath,
      contentJson,
      ...(outputRootDir ? { outputRootDir } : {}),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    reportVideoSliceStageDiagnostic('task evidence persistence skipped', {
      taskId: workflowTaskId,
      relativePath,
      reason,
    });
    return {
      skipped: true,
      reason,
      relativePath,
    };
  }
}

async function writeSmartSliceReviewEvidenceJson({
  nativeHostClient,
  task,
  sourceMedia,
  reviewSession,
  renderSelection,
  outputRootDir,
}: {
  nativeHostClient: ReturnType<typeof getAutoCutNativeHostClient>;
  task: AppTask;
  sourceMedia: SmartSlicePreparedSourceMedia;
  reviewSession: AutoCutSliceReviewSession;
  renderSelection?: AutoCutSliceRenderSelection;
  outputRootDir?: string;
}) {
  const reviewSessionEvidence = await writeBestEffortSmartSliceTaskEvidenceJson({
    nativeHostClient,
    workflowTaskId: task.id,
    relativePath: 'evidence/review-session.json',
    contentJson: createSmartSliceReviewSessionEvidencePayload({
      task,
      sourceMedia,
      reviewSession,
    }),
    ...(outputRootDir ? { outputRootDir } : {}),
  });
  const manualEditsEvidence = renderSelection
    ? await writeBestEffortSmartSliceTaskEvidenceJson({
        nativeHostClient,
        workflowTaskId: task.id,
        relativePath: 'evidence/manual-edits.json',
        contentJson: createSmartSliceManualEditsEvidencePayload({
          task,
          reviewSession,
        }),
        ...(outputRootDir ? { outputRootDir } : {}),
      })
    : undefined;
  const reviewEventsEvidence = renderSelection
    ? await writeBestEffortSmartSliceTaskEvidenceJson({
        nativeHostClient,
        workflowTaskId: task.id,
        relativePath: 'evidence/review-events.json',
        contentJson: createSmartSliceReviewEventsEvidencePayload({
          task,
          reviewSession,
        }),
        ...(outputRootDir ? { outputRootDir } : {}),
      })
    : undefined;
  const renderSelectionEvidence = renderSelection
    ? await writeBestEffortSmartSliceTaskEvidenceJson({
        nativeHostClient,
        workflowTaskId: task.id,
        relativePath: 'evidence/render-selection.json',
        contentJson: createSmartSliceRenderSelectionEvidencePayload({
          task,
          reviewSession,
          renderSelection,
        }),
        ...(outputRootDir ? { outputRootDir } : {}),
      })
    : undefined;
  return {
    reviewSessionEvidence,
    ...(manualEditsEvidence ? { manualEditsEvidence } : {}),
    ...(reviewEventsEvidence ? { reviewEventsEvidence } : {}),
    ...(renderSelectionEvidence ? { renderSelectionEvidence } : {}),
  };
}

function createSmartSliceSpeechToTextEvidencePayload({
  task,
  sourceMedia,
  transcription,
  transcriptSegments,
}: {
  task: AppTask;
  sourceMedia: SmartSlicePreparedSourceMedia;
  transcription: Awaited<ReturnType<typeof transcribeAutoCutMediaWithConfiguredProvider>>;
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[];
}) {
  return {
    schema: 'smart-slice.speech-to-text.v1',
    taskId: task.id,
    sourceAssetUuid: sourceMedia.assetUuid,
    ...(sourceMedia.durationMs !== undefined ? { sourceDurationMs: sourceMedia.durationMs } : {}),
    providerId: transcription.providerId,
    ...(transcription.sttPresetId ? { sttPresetId: transcription.sttPresetId } : {}),
    ...(transcription.executionProfile ? { executionProfile: transcription.executionProfile } : {}),
    language: transcription.language,
    text: transcription.text,
    segments: transcriptSegments,
    nativeTranscriptPath: transcription.transcriptPath,
    nativeTranscriptTaskUuid: transcription.taskUuid,
    nativeTranscriptTaskOutputDir: transcription.taskOutputDir,
    createdAt: createAutoCutTimestamp(),
  };
}

function createSkippedSmartSliceTranscriptionResult(
  reason: string,
): Awaited<ReturnType<typeof transcribeAutoCutMediaWithConfiguredProvider>> {
  return {
    providerId: AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER.localWhisperCli,
    artifactUuid: '',
    taskUuid: '',
    sourceAssetUuid: '',
    transcriptPath: '',
    taskOutputDir: '',
    language: 'auto',
    segments: [],
    text: '',
    ffmpegExecutable: '',
    speechExecutable: '',
    executionProfile: 'fallback-skipped',
    standardTranscript: {
      schema: 'smart-slice.transcript.v1',
      providerId: 'fallback-skipped',
      language: 'auto',
      text: '',
      speakers: [],
      segments: [],
      createdAt: createAutoCutTimestamp(),
      qualityGuard: {
        status: 'skipped',
        passed: false,
        risks: [{
          code: 'speech-to-text-skipped',
          severity: 'warning',
          message: reason,
        }],
      },
    },
  };
}

function createSmartSliceNormalizedTranscriptEvidencePayload({
  task,
  sourceMedia,
  transcription,
  transcriptSegments,
}: {
  task: AppTask;
  sourceMedia: SmartSlicePreparedSourceMedia;
  transcription: Awaited<ReturnType<typeof transcribeAutoCutMediaWithConfiguredProvider>>;
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[];
}) {
  const speakerLabels = [...new Set(transcriptSegments.map((segment) => segment.speaker?.trim() || 'Speaker 1'))];
  const speakerIdByLabel = new Map(speakerLabels.map((label, index) => [label, `speaker-${index + 1}`]));
  return {
    schema: 'smart-slice.transcript-artifact.v1',
    taskId: task.id,
    sourceAssetUuid: sourceMedia.assetUuid,
    ...(sourceMedia.durationMs !== undefined ? { durationMs: sourceMedia.durationMs } : {}),
    normalizedFor: 'smart-slice-llm-and-human-review',
    transcript: transcription.standardTranscript ?? {
      schema: 'smart-slice.transcript.v1',
      providerId: transcription.providerId,
      language: transcription.language,
      text: transcription.text,
      speakers: speakerLabels.map((label) => ({
        id: speakerIdByLabel.get(label) ?? 'speaker-1',
        label,
      })),
      segments: transcriptSegments.map((segment, index) => ({
        id: `seg-${String(index + 1).padStart(4, '0')}`,
        startMs: segment.startMs,
        endMs: segment.endMs,
        speakerId: speakerIdByLabel.get(segment.speaker?.trim() || 'Speaker 1') ?? 'speaker-1',
        text: segment.text,
      })),
      createdAt: createAutoCutTimestamp(),
    },
  };
}

function createSmartSliceSemanticSegmentationEvidencePayload({
  task,
  params,
  sourceMedia,
  planResult,
  plannedClips,
  transcriptSegments,
}: {
  task: AppTask;
  params: VideoSliceParams;
  sourceMedia: SmartSlicePreparedSourceMedia;
  planResult: SmartCutEngineSlicePlanResult;
  plannedClips: readonly NormalizedSlicePlanClip[];
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[];
}) {
  const segmentationAgent = getAutoCutSmartSliceSegmentationAgentDefinition(params.segmentationAgentId);
  return {
    schema: 'smart-slice.semantic-segmentation.v1',
    taskId: task.id,
    sourceAssetUuid: sourceMedia.assetUuid,
    ...(sourceMedia.durationMs !== undefined ? { sourceDurationMs: sourceMedia.durationMs } : {}),
    llmModel: params.llmModel,
    mode: params.mode,
    ...(params.targetPlatform ? { targetPlatform: params.targetPlatform } : {}),
    segmentationDensity: params.segmentationDensity ?? 'default',
    segmentationAgentId: segmentationAgent.id,
    segmentationAgent: {
      id: segmentationAgent.id,
      label: segmentationAgent.label,
      description: segmentationAgent.description,
      systemPrompt: segmentationAgent.systemPrompt,
    },
    presetId: planResult.presetId,
    transcriptSegmentCount: transcriptSegments.length,
    contentUnitCount: planResult.llmReviewAudit?.input.contentUnits.length ?? 0,
    candidateCount: planResult.llmReviewAudit?.input.candidates.length ?? 0,
    speakerProfileCount: planResult.speakerEvidence.profiles.length,
    speakerSegmentCount: planResult.speakerEvidence.segments.length,
    blockers: planResult.blockers,
    transcriptEvidence: planResult.transcriptEvidence,
    speakerEvidence: planResult.speakerEvidence,
    ...(planResult.llmReviewAudit ? { llmReviewAudit: planResult.llmReviewAudit } : {}),
    clips: plannedClips.map((clip, index) => ({
      index,
      candidateId: clip.candidateId,
      title: clip.title,
      label: clip.label,
      startMs: clip.startMs,
      endMs: clip.startMs + clip.durationMs,
      durationMs: clip.durationMs,
      sourceStartMs: clip.sourceStartMs,
      sourceEndMs: clip.sourceEndMs,
      speechStartMs: clip.speechStartMs,
      speechEndMs: clip.speechEndMs,
      contentUnitIds: clip.contentUnitIds ?? [],
      speakerIds: clip.speakerIds ?? [],
      speakerRoles: clip.speakerRoles ?? [],
      transcriptText: clip.transcriptText,
      transcriptSegmentCount: clip.transcriptSegments?.length ?? clip.transcriptSegmentCount ?? 0,
      transcriptCoverageScore: clip.transcriptCoverageScore,
      speechContinuityGrade: clip.speechContinuityGrade,
      risks: clip.risks ?? [],
    })),
    createdAt: createAutoCutTimestamp(),
  };
}

function createSmartSliceReviewSegmentSummary(segment: AutoCutSliceReviewSegment, index: number) {
  return {
    index,
    id: segment.id,
    sourceClipIndex: segment.sourceClipIndex,
    status: segment.status,
    selected: segment.selected,
    title: segment.title,
    startMs: segment.startMs,
    endMs: segment.endMs,
    durationMs: segment.durationMs,
    ...(segment.speechStartMs !== undefined ? { speechStartMs: segment.speechStartMs } : {}),
    ...(segment.speechEndMs !== undefined ? { speechEndMs: segment.speechEndMs } : {}),
    contentUnitIds: segment.contentUnitIds,
    speakerIds: segment.speakerIds,
    speakerRoles: segment.speakerRoles,
    transcriptSegmentCount: segment.transcriptSegments?.length ?? 0,
    ...(segment.transcriptText ? { transcriptText: segment.transcriptText } : {}),
    ...(segment.risks.length ? { risks: segment.risks } : {}),
    ...(segment.qualityScore !== undefined ? { qualityScore: segment.qualityScore } : {}),
    ...(segment.continuityScore !== undefined ? { continuityScore: segment.continuityScore } : {}),
    ...(segment.publishabilityScore !== undefined ? { publishabilityScore: segment.publishabilityScore } : {}),
    ...(segment.publishabilityGrade ? { publishabilityGrade: segment.publishabilityGrade } : {}),
    ...(segment.duplicateGroupId ? { duplicateGroupId: segment.duplicateGroupId } : {}),
    ...(segment.duplicateOfSegmentId ? { duplicateOfSegmentId: segment.duplicateOfSegmentId } : {}),
  };
}

function createSmartSliceReviewSessionEvidencePayload({
  task,
  sourceMedia,
  reviewSession,
}: {
  task: AppTask;
  sourceMedia: SmartSlicePreparedSourceMedia;
  reviewSession: AutoCutSliceReviewSession;
}) {
  const sourceDurationMs = reviewSession.sourceDurationMs ?? sourceMedia.durationMs;
  const selectedSegments = reviewSession.segments.filter((segment) =>
    reviewSession.selectedSegmentIds.includes(segment.id) &&
    segment.selected &&
    segment.status === 'selected'
  );
  return {
    schema: 'smart-slice.review-session.v1',
    taskId: task.id,
    reviewSessionId: reviewSession.id,
    status: reviewSession.status,
    sourceAssetUuid: reviewSession.sourceAssetUuid ?? sourceMedia.assetUuid,
    ...(sourceDurationMs !== undefined ? { sourceDurationMs } : {}),
    segmentationAgentId: reviewSession.segmentationAgentId,
    segmentCount: reviewSession.segments.length,
    selectedSegmentCount: selectedSegments.length,
    duplicateGroupCount: reviewSession.duplicateGroups.length,
    manualEditCount: reviewSession.manualEdits.length,
    selectedSegmentIds: reviewSession.selectedSegmentIds,
    duplicateGroups: reviewSession.duplicateGroups,
    segments: reviewSession.segments.map(createSmartSliceReviewSegmentSummary),
    createdAt: createAutoCutTimestamp(),
  };
}

function createSmartSliceManualEditsEvidencePayload({
  task,
  reviewSession,
}: {
  task: AppTask;
  reviewSession: AutoCutSliceReviewSession;
}) {
  return {
    schema: 'smart-slice.manual-edits.v1',
    taskId: task.id,
    reviewSessionId: reviewSession.id,
    editCount: reviewSession.manualEdits.length,
    selectedSegmentIds: reviewSession.selectedSegmentIds,
    manualEdits: reviewSession.manualEdits,
    segments: reviewSession.segments.map(createSmartSliceReviewSegmentSummary),
    createdAt: createAutoCutTimestamp(),
  };
}

function createSmartSliceReviewEventsEvidencePayload({
  task,
  reviewSession,
}: {
  task: AppTask;
  reviewSession: AutoCutSliceReviewSession;
}) {
  const events = reviewSession.manualEdits.map((manualEdit, index) => ({
    index,
    editId: manualEdit.id,
    kind: manualEdit.kind,
    segmentIds: manualEdit.segmentIds,
    createdAt: manualEdit.createdAt,
    ...(manualEdit.reason ? { reason: manualEdit.reason } : {}),
    ...(manualEdit.splitAtMs !== undefined ? { splitAtMs: manualEdit.splitAtMs } : {}),
    ...(manualEdit.keepSegmentId ? { keepSegmentId: manualEdit.keepSegmentId } : {}),
    ...(manualEdit.createdSegmentIds?.length ? { createdSegmentIds: manualEdit.createdSegmentIds } : {}),
    ...(manualEdit.patch ? { patch: manualEdit.patch } : {}),
    resultingSelectedSegmentIds: reviewSession.selectedSegmentIds,
  }));
  return {
    schema: 'smart-slice.review-events.v1',
    taskId: task.id,
    reviewSessionId: reviewSession.id,
    reviewVersion: reviewSession.manualEdits.length,
    eventCount: events.length,
    events,
    createdAt: createAutoCutTimestamp(),
  };
}

function createSmartSliceRenderSelectionEvidencePayload({
  task,
  reviewSession,
  renderSelection,
}: {
  task: AppTask;
  reviewSession: AutoCutSliceReviewSession;
  renderSelection: AutoCutSliceRenderSelection;
}) {
  const selectedSegmentIds = [...new Set(renderSelection.selectedSegmentIds.filter(Boolean))];
  const selectedSegmentIdSet = new Set(selectedSegmentIds);
  const selectedSegments = reviewSession.segments
    .filter((segment) => selectedSegmentIdSet.has(segment.id))
    .map(createSmartSliceReviewSegmentSummary);
  return {
    schema: 'smart-slice.render-selection.v1',
    taskId: task.id,
    reviewSessionId: reviewSession.id,
    selectedSegmentIds,
    selectedSegmentCount: selectedSegments.length,
    submittedManualEditCount: renderSelection.manualEdits?.length ?? 0,
    appliedManualEditCount: reviewSession.manualEdits.length,
    manualEdits: reviewSession.manualEdits,
    selectedSegments,
    createdAt: createAutoCutTimestamp(),
  };
}

function createReviewedSmartSliceSegmentIdsForClip(
  clip: NormalizedSlicePlanClip | undefined,
  reviewSession: AutoCutSliceReviewSession,
) {
  if (!clip) {
    return [];
  }
  const clipStartMs = Math.round(clip.sourceStartMs ?? clip.startMs);
  const clipEndMs = Math.round(clip.sourceEndMs ?? clip.startMs + clip.durationMs);
  return reviewSession.segments
    .filter((segment) =>
      segment.selected &&
      segment.status === 'selected' &&
      segment.startMs < clipEndMs &&
      segment.endMs > clipStartMs
    )
    .map((segment) => segment.id);
}

function createSmartSliceRenderArtifactManifestPayload({
  task,
  sourceMedia,
  nativeResult,
  nativeClips,
  sliceResults,
  plannedClips,
  reviewSession,
  subtitleRequest,
}: {
  task: AppTask;
  sourceMedia: SmartSlicePreparedSourceMedia;
  nativeResult: Awaited<ReturnType<ReturnType<typeof getAutoCutNativeHostClient>['sliceVideo']>>;
  nativeClips: readonly AutoCutVideoSliceClipRequest[];
  sliceResults: readonly TaskSliceResult[];
  plannedClips: readonly NormalizedSlicePlanClip[];
  reviewSession: AutoCutSliceReviewSession;
  subtitleRequest: VideoSliceSubtitleRequestProjection;
}) {
  return {
    schema: 'smart-slice.render-artifact-manifest.v1',
    taskId: task.id,
    nativeTaskId: nativeResult.taskUuid,
    sourceAssetUuid: sourceMedia.assetUuid,
    ...(sourceMedia.durationMs !== undefined ? { sourceDurationMs: sourceMedia.durationMs } : {}),
    taskOutputDir: nativeResult.taskOutputDir,
    sliceCount: sliceResults.length,
    subtitleMode: subtitleRequest.subtitleMode ?? 'none',
    subtitleFormat: subtitleRequest.subtitleFormat ?? 'none',
    reviewSessionId: reviewSession.id,
    selectedSegmentIds: reviewSession.selectedSegmentIds,
    slices: sliceResults.map((sliceResult, index) => {
      const nativeSlice = nativeResult.slices[index];
      const nativeClip = nativeClips[index];
      const plannedClip = plannedClips[index];
      return {
        index,
        id: sliceResult.id,
        name: sliceResult.name,
        title: sliceResult.title,
        artifactUuid: nativeSlice?.artifactUuid ?? sliceResult.id,
        artifactPath: nativeSlice?.artifactPath ?? sliceResult.artifactPath,
        url: sliceResult.url,
        thumbnailArtifactUuid: nativeSlice?.thumbnailArtifactUuid,
        thumbnailArtifactPath: nativeSlice?.thumbnailArtifactPath,
        thumbnailUrl: sliceResult.thumbnailUrl,
        ...(nativeSlice?.subtitleArtifactUuid ? { subtitleArtifactUuid: nativeSlice.subtitleArtifactUuid } : {}),
        ...(nativeSlice?.subtitleArtifactPath ? { subtitleArtifactPath: nativeSlice.subtitleArtifactPath } : {}),
        ...(sliceResult.subtitleUrl ? { subtitleUrl: sliceResult.subtitleUrl } : {}),
        ...(sliceResult.subtitleFormat ? { subtitleFormat: sliceResult.subtitleFormat } : {}),
        sourceStartMs: sliceResult.sourceStartMs,
        sourceEndMs: sliceResult.sourceEndMs,
        speechStartMs: sliceResult.speechStartMs,
        speechEndMs: sliceResult.speechEndMs,
        durationSeconds: sliceResult.duration,
        byteSize: sliceResult.size,
        nativeClip,
        reviewSegmentIds: createReviewedSmartSliceSegmentIdsForClip(plannedClip, reviewSession),
        transcriptSegmentCount: sliceResult.transcriptSegments?.length ?? sliceResult.transcriptSegmentCount ?? 0,
        ...(sliceResult.transcriptText ? { transcriptText: sliceResult.transcriptText } : {}),
        ...(sliceResult.sourceSegments?.length ? { sourceSegments: sliceResult.sourceSegments } : {}),
        ...(sliceResult.removedSilenceMs !== undefined ? { removedSilenceMs: sliceResult.removedSilenceMs } : {}),
        ...(sliceResult.noiseReductionApplied !== undefined ? { noiseReductionApplied: sliceResult.noiseReductionApplied } : {}),
        ...(sliceResult.risks?.length ? { risks: sliceResult.risks } : {}),
      };
    }),
    createdAt: createAutoCutTimestamp(),
  };
}

async function resumeSmartSliceTaskFromStep(
  task: AppTask,
  stepId: string,
) {
  if (!isSmartSliceExecutionStepId(stepId)) {
    throw new Error(`Smart Slice resume failed because step ${stepId} is unknown.`);
  }
  if (!task.executionCheckpoint) {
    throw new Error('Smart Slice resume failed because the task checkpoint is missing.');
  }

  const params = restoreSmartSliceParamsFromCheckpoint(task.executionCheckpoint);
  const result = await executeSmartSliceTask({
    task,
    params,
    checkpoint: task.executionCheckpoint,
    resumeFromStepId: stepId,
  });
  return {
    ...result,
    stepId,
  };
}

export async function saveVideoSliceReviewDraft(
  taskId: string,
  renderSelection: AutoCutSliceRenderSelection,
  processingOperations: readonly StudioClipProcessingOperation[] = [],
) {
  const normalizedTaskId = taskId.trim();
  const task = (await getTasks()).find((candidate) => candidate.id === normalizedTaskId);
  if (!task) {
    throw new Error('Smart Slice review draft save failed because the review task was not found.');
  }
  if (task.status !== AUTOCUT_TASK_STATUS.reviewing || !task.sliceReviewSession) {
    throw new Error('Smart Slice review draft save requires a task waiting in human review.');
  }
  if (renderSelection.reviewSessionId !== task.sliceReviewSession.id) {
    throw new Error('Smart Slice review draft save failed because the review session does not match the task.');
  }
  if (!task.executionCheckpoint) {
    throw new Error('Smart Slice review draft save failed because the review checkpoint is missing.');
  }

  const artifacts = readSmartSliceCheckpointArtifacts(task.executionCheckpoint);
  const sourceMedia = artifacts['prepare-source']?.sourceMedia;
  if (!sourceMedia?.assetUuid) {
    throw new Error('Smart Slice review draft save failed because prepared source evidence is missing.');
  }

  const reviewedSession = applyAutoCutSliceManualEdits(task.sliceReviewSession, renderSelection.manualEdits ?? []);
  assertReviewedSmartSliceDraftSelection(reviewedSession, renderSelection.selectedSegmentIds);
  const normalizedRenderSelection = {
    ...renderSelection,
    selectedSegmentIds: resolveReviewedSmartSliceDraftSegmentIds(reviewedSession, renderSelection.selectedSegmentIds),
  };
  const draftReviewSession: AutoCutSliceReviewSession = {
    ...reviewedSession,
    status: 'ready_for_review',
    selectedSegmentIds: normalizedRenderSelection.selectedSegmentIds,
    updatedAt: createAutoCutTimestamp(),
  };
  const outputRootDir = artifacts['prepare-source']?.outputRootDir;
  const evidence = await writeSmartSliceReviewEvidenceJson({
    nativeHostClient: getAutoCutNativeHostClient(),
    task,
    sourceMedia,
    reviewSession: draftReviewSession,
    renderSelection: {
      reviewSessionId: renderSelection.reviewSessionId,
      selectedSegmentIds: draftReviewSession.selectedSegmentIds,
      manualEdits: renderSelection.manualEdits ?? [],
    },
    ...(outputRootDir ? { outputRootDir } : {}),
  });
  const checkpoint = {
    ...task.executionCheckpoint,
    artifacts: {
      ...task.executionCheckpoint.artifacts,
      'human-review': {
        ...(artifacts['human-review'] ?? {}),
        reviewSession: draftReviewSession,
        approvedClips: artifacts['human-review']?.approvedClips ?? [],
        ...evidence,
      },
    },
    updatedAt: draftReviewSession.updatedAt,
  };
  await updateTask(task.id, {
    status: AUTOCUT_TASK_STATUS.reviewing,
    progress: 70,
    progressMessage: 'Segment Review Workbench draft saved. Continue reviewing or render selected segments.',
    currentStepId: 'human-review',
    sliceReviewSession: draftReviewSession,
    studioClipTimeline: createStudioClipTimelineSnapshotForReviewSession(
      draftReviewSession,
      processingOperations.length > 0 ? processingOperations : task.studioClipTimeline?.processingOperations ?? [],
    ),
    executionCheckpoint: checkpoint,
  });
  return {
    success: true,
    taskId: task.id,
    reviewSessionId: draftReviewSession.id,
    selectedSegmentIds: draftReviewSession.selectedSegmentIds,
    manualEditCount: draftReviewSession.manualEdits.length,
    evidence,
  };
}

function cancelSmartSliceTask(task: AppTask) {
  return {
    success: true,
    taskId: task.id,
    ...(task.nativeTaskId ? { nativeTaskId: task.nativeTaskId } : {}),
    message: 'Cancel requested',
  };
}

function isSmartSliceExecutionStepId(stepId: string): stepId is SmartSliceExecutionStepId {
  return SMART_SLICE_EXECUTION_STEP_BY_ID.has(stepId as SmartSliceExecutionStepId);
}

let smartSliceResumeHandlerRegistered = false;
let smartSliceCancelHandlerRegistered = false;

export function registerSmartSliceTaskResumeHandler() {
  if (smartSliceResumeHandlerRegistered) {
    return;
  }
  registerAutoCutTaskResumeHandler(AUTOCUT_TASK_TYPE.videoSlice, resumeSmartSliceTaskFromStep);
  smartSliceResumeHandlerRegistered = true;
}

export function registerSmartSliceTaskCancelHandler() {
  if (smartSliceCancelHandlerRegistered) {
    return;
  }
  registerAutoCutTaskCancelHandler(AUTOCUT_TASK_TYPE.videoSlice, cancelSmartSliceTask);
  smartSliceCancelHandlerRegistered = true;
}

registerSmartSliceTaskResumeHandler();
registerSmartSliceTaskCancelHandler();

async function prepareVideoSliceTaskForExecution(params: VideoSliceParams) {
  const executionParams = await resolveSmartSliceExecutionParams(params);
  reportVideoSliceStageDiagnostic('validation started', {
    hasFile: Boolean(executionParams.file),
    hasFileId: Boolean(executionParams.fileId?.trim()),
    hasUrl: Boolean(executionParams.url?.trim()),
    minDuration: executionParams.minDuration,
    maxDuration: executionParams.maxDuration,
    idealDuration: executionParams.idealDuration,
    targetPlatform: executionParams.targetPlatform,
    segmentationAgentId: executionParams.segmentationAgentId,
  });
  validateAutoCutProcessingSource({ ...executionParams, allowExternalUrl: true });
  validateVideoSliceParams(executionParams);

  if (executionParams.url?.trim()) {
    throw new Error(
      'Smart slicing does not support external URL sources yet. Select a trusted local desktop video or an existing native media asset.',
    );
  }

  const checkpoint = createSmartSliceCheckpoint(executionParams);
  const newTask: AppTask = {
    ...createVideoSliceTask(executionParams),
    executionCheckpoint: checkpoint,
  };
  await addTask(newTask);
  return { executionParams, checkpoint, task: newTask };
}

export async function processVideoSlice(params: VideoSliceParams) {
  const { executionParams, checkpoint, task } = await prepareVideoSliceTaskForExecution(params);

  return executeSmartSliceTask({
    task,
    params: executionParams,
    checkpoint,
    reviewMode: 'auto-render',
  });
}

export async function analyzeVideoSlicePlan(params: VideoSliceParams) {
  const { executionParams, checkpoint, task } = await prepareVideoSliceTaskForExecution(params);

  return executeSmartSliceTask({
    task,
    params: executionParams,
    checkpoint,
    reviewMode: 'review-before-render',
  });
}

export async function renderVideoSlicePlan(
  taskId: string,
  renderSelection: AutoCutSliceRenderSelection,
) {
  const normalizedTaskId = taskId.trim();
  const task = (await getTasks()).find((candidate) => candidate.id === normalizedTaskId);
  if (!task) {
    throw new Error('Smart Slice render failed because the review task was not found.');
  }
  if (task.status !== AUTOCUT_TASK_STATUS.reviewing || !task.sliceReviewSession) {
    throw new Error('Smart Slice render selected requires a task waiting in human review.');
  }
  if (renderSelection.reviewSessionId !== task.sliceReviewSession.id) {
    throw new Error('Smart Slice render selected failed because the review session does not match the task.');
  }
  if (!task.executionCheckpoint) {
    throw new Error('Smart Slice render selected failed because the review checkpoint is missing.');
  }
  const params = restoreSmartSliceParamsFromCheckpoint(task.executionCheckpoint);
  const reviewedSession = applyAutoCutSliceManualEdits(task.sliceReviewSession, renderSelection.manualEdits ?? []);
  assertReviewedSmartSliceRenderSelection(reviewedSession, renderSelection.selectedSegmentIds);
  const normalizedRenderSelection = {
    ...renderSelection,
    selectedSegmentIds: resolveReviewedSmartSliceRenderableSegmentIds(reviewedSession, renderSelection.selectedSegmentIds),
  };
  const readyForRenderReviewSession: AutoCutSliceReviewSession = {
    ...reviewedSession,
    status: 'ready_for_render',
    selectedSegmentIds: normalizedRenderSelection.selectedSegmentIds,
    updatedAt: createAutoCutTimestamp(),
  };
  await updateTask(task.id, {
    status: AUTOCUT_TASK_STATUS.processing,
    progressMessage: 'Rendering selected reviewed Smart Slice segments...',
    sliceReviewSession: readyForRenderReviewSession,
    studioClipTimeline: createStudioClipTimelineSnapshotForReviewSession(
      readyForRenderReviewSession,
      task.studioClipTimeline?.processingOperations ?? [],
    ),
  });
  return executeSmartSliceTask({
    task: {
      ...task,
      status: AUTOCUT_TASK_STATUS.processing,
      sliceReviewSession: readyForRenderReviewSession,
      studioClipTimeline: createStudioClipTimelineSnapshotForReviewSession(
        readyForRenderReviewSession,
        task.studioClipTimeline?.processingOperations ?? [],
      ),
    },
    params,
    checkpoint: task.executionCheckpoint,
    resumeFromStepId: 'human-review',
    reviewMode: 'auto-render',
    renderSelection: normalizedRenderSelection,
  });
}

async function executeSmartSliceTask(
  context: SmartSliceExecutionContext,
): Promise<{ success: true; taskId: string; nativeTaskId?: string }> {
  const { params, task } = context;
  await assertSmartSliceTaskNotCanceled(context);

  const nativeHostClient = getAutoCutNativeHostClient();
  const desktopSourcePath = resolveAutoCutTrustedSourcePath(params.file);
  const selectedNativeAssetUuid = params.file || params.url?.trim() ? '' : (params.fileId?.trim() ?? '');
  const capabilities = await nativeHostClient.getCapabilities();
  await assertSmartSliceTaskNotCanceled(context);
  const canSliceWithNativeHost =
    (desktopSourcePath ? capabilities.mediaImportCommandReady : Boolean(selectedNativeAssetUuid)) &&
    capabilities.videoSliceCommandReady;
  const canRunSpeechToText =
    capabilities.speechTranscriptionCommandReady &&
    capabilities.speechTranscriptionToolchainReady;
  const canAnalyzeAudioBoundaries =
    capabilities.videoSliceAudioActivityAnalysisCommandReady &&
    canRunSpeechToText;
  reportVideoSliceStageDiagnostic('native preflight', {
    taskId: task.id,
    hasTrustedDesktopSource: Boolean(desktopSourcePath),
    hasSelectedNativeAsset: Boolean(selectedNativeAssetUuid),
    mediaImportCommandReady: capabilities.mediaImportCommandReady,
    videoSliceCommandReady: capabilities.videoSliceCommandReady,
    videoSliceAudioActivityAnalysisCommandReady: capabilities.videoSliceAudioActivityAnalysisCommandReady,
    speechTranscriptionCommandReady: capabilities.speechTranscriptionCommandReady,
    taskEvidenceWriteCommandReady: capabilities.taskEvidenceWriteCommandReady,
    speechTranscriptionToolchainReady: capabilities.speechTranscriptionToolchainReady,
    speechTranscriptionProbeCommandReady: capabilities.speechTranscriptionProbeCommandReady,
    canSliceWithNativeHost,
    canRunSpeechToText,
    canAnalyzeAudioBoundaries,
  });

  if (canSliceWithNativeHost && (desktopSourcePath || selectedNativeAssetUuid)) {
    let nativeTaskId: string | undefined = task.nativeTaskId;
    const durableTaskId = task.id;

    try {
      await assertSmartSliceTaskNotCanceled(context);
      const checkpointArtifacts = readSmartSliceCheckpointArtifacts(context.checkpoint);
      const outputRootDir = checkpointArtifacts['prepare-source']?.outputRootDir ?? await resolveAutoCutOutputRootDir();
      await assertSmartSliceTaskNotCanceled(context);
      const selectedNativeSourceDurationMs = resolveTrustedVideoSliceSourceDurationMs(params);
      reportSmartSliceExecutionPlan(task.id, {
        hasTrustedDesktopSource: Boolean(desktopSourcePath),
        hasSelectedNativeAsset: Boolean(selectedNativeAssetUuid),
        outputRootDir,
        selectedNativeSourceDurationMs,
        ...(context.resumeFromStepId ? { resumeFromStepId: context.resumeFromStepId } : {}),
      });
      const sourceMedia: SmartSlicePreparedSourceMedia = await runSmartSliceCheckpointedExecutionStep(
        context,
        'prepare-source',
        readPrepareSourceCheckpoint,
        async () =>
          desktopSourcePath
            ? await nativeHostClient.importMediaFile({
                sourcePath: desktopSourcePath,
                ...(outputRootDir ? { outputRootDir } : {}),
              })
            : {
                assetUuid: selectedNativeAssetUuid,
                ...(selectedNativeSourceDurationMs !== undefined ? { durationMs: selectedNativeSourceDurationMs } : {}),
              },
        (result) => ({
          sourceMedia: result,
          ...(outputRootDir ? { outputRootDir } : {}),
          ...(desktopSourcePath ? { desktopSourcePath } : {}),
          ...(selectedNativeAssetUuid ? { selectedNativeAssetUuid } : {}),
        }),
        {
          importedMedia: Boolean(desktopSourcePath),
          selectedNativeAssetUuid: selectedNativeAssetUuid || undefined,
        },
      );
      const runtimeSourceAsset = createSmartSliceRuntimeSourceAsset({
        sourceMedia,
        task,
        sourceFile: params.file,
        desktopSourcePath,
        createAssetUrl: nativeHostClient.createAssetUrl,
      });
      reportVideoSliceStageDiagnostic('source ready', {
        taskId: task.id,
        sourceAssetUuid: sourceMedia.assetUuid,
        sourceDurationMs: sourceMedia.durationMs,
        importedMedia: Boolean(desktopSourcePath),
      });
      await assertSmartSliceTaskNotCanceled(context, 'prepare-source');
      let transcriptSegments: AutoCutSpeechTranscriptionSegment[] = [];
      const speechToTextStepResult = await runSmartSliceCheckpointedLongRunningExecutionStep(
        context,
        'speech-to-text',
        readSpeechToTextCheckpoint,
        async () => {
          if (!canRunSpeechToText) {
            const reason = createSmartSliceSpeechTranscriptionPreflightErrorMessage(capabilities);
            reportVideoSliceStageDiagnostic('speech-to-text skipped; deterministic fallback will be used', {
              taskId: task.id,
              sourceAssetUuid: sourceMedia.assetUuid,
              reason,
            });
            const skippedTranscription = createSkippedSmartSliceTranscriptionResult(reason);
            const speechToTextEvidence = await writeBestEffortSmartSliceTaskEvidenceJson({
              nativeHostClient,
              workflowTaskId: task.id,
              relativePath: 'evidence/speech-to-text.json',
              contentJson: createSmartSliceSpeechToTextEvidencePayload({
                task,
                sourceMedia,
                transcription: skippedTranscription,
                transcriptSegments: [],
              }),
              ...(outputRootDir ? { outputRootDir } : {}),
            });
            const normalizedTranscriptEvidence = await writeBestEffortSmartSliceTaskEvidenceJson({
              nativeHostClient,
              workflowTaskId: task.id,
              relativePath: 'evidence/transcript.normalized.json',
              contentJson: createSmartSliceNormalizedTranscriptEvidencePayload({
                task,
                sourceMedia,
                transcription: skippedTranscription,
                transcriptSegments: [],
              }),
              ...(outputRootDir ? { outputRootDir } : {}),
            });
            return {
              transcriptSegments: [],
              speechToTextEvidence,
              normalizedTranscriptEvidence,
            };
          }

          const stopSpeechTranscriptionSetupProgressBridge =
            startSmartSliceSpeechTranscriptionSetupProgressBridge(task.id);
          try {
            const transcription = await transcribeAutoCutMediaWithConfiguredProvider({
              assetUuid: sourceMedia.assetUuid,
              workflowTaskId: task.id,
              language: 'auto',
              workflowPurpose: 'smart-slice-transcript-evidence',
              dedupeRepeatedSpeech: params.enableRepeatFilter === true,
              ...(params.sttPresetId ? { sttPresetId: params.sttPresetId } : {}),
              ...(outputRootDir ? { outputRootDir } : {}),
            });
            context.currentStepId = 'speech-to-text';
            await assertSmartSliceTaskNotCanceled(context, 'speech-to-text');
            if (transcription.segments.length === 0) {
              throw new Error('Speech-to-text returned no transcript segments.');
            }
            reportVideoSliceStageDiagnostic('speech-to-text ready', {
              taskId: task.id,
              sourceAssetUuid: sourceMedia.assetUuid,
              transcriptSegmentCount: transcription.segments.length,
              transcriptStartMs: transcription.segments[0]?.startMs,
              transcriptEndMs: transcription.segments.at(-1)?.endMs,
              providerId: transcription.providerId,
              sttPresetId: transcription.sttPresetId,
              executionProfile: transcription.executionProfile,
            });
            const normalizedTranscriptSegments = normalizeSmartSliceTranscriptTimelineForSourceDuration(
              transcription.segments,
              sourceMedia.durationMs,
            );
            const speechToTextEvidence = await writeBestEffortSmartSliceTaskEvidenceJson({
              nativeHostClient,
              workflowTaskId: task.id,
              relativePath: 'evidence/speech-to-text.json',
              contentJson: createSmartSliceSpeechToTextEvidencePayload({
                task,
                sourceMedia,
                transcription,
                transcriptSegments: normalizedTranscriptSegments,
              }),
              ...(outputRootDir ? { outputRootDir } : {}),
            });
            const normalizedTranscriptEvidence = await writeBestEffortSmartSliceTaskEvidenceJson({
              nativeHostClient,
              workflowTaskId: task.id,
              relativePath: 'evidence/transcript.normalized.json',
              contentJson: createSmartSliceNormalizedTranscriptEvidencePayload({
                task,
                sourceMedia,
                transcription,
                transcriptSegments: normalizedTranscriptSegments,
              }),
              ...(outputRootDir ? { outputRootDir } : {}),
            });
            return {
              transcriptSegments: normalizedTranscriptSegments,
              speechToTextEvidence,
              normalizedTranscriptEvidence,
            };
          } catch (transcriptionError) {
            if (isAutoCutProcessingTaskCanceledError(transcriptionError)) {
              throw transcriptionError;
            }
            reportVideoSliceStageDiagnostic('speech-to-text failed', {
              taskId: task.id,
              sourceAssetUuid: sourceMedia.assetUuid,
              errorMessage: transcriptionError instanceof Error ? transcriptionError.message : String(transcriptionError),
            });
            const failedTranscription = createSkippedSmartSliceTranscriptionResult(String(transcriptionError));
            const speechToTextEvidence = await writeBestEffortSmartSliceTaskEvidenceJson({
              nativeHostClient,
              workflowTaskId: task.id,
              relativePath: 'evidence/speech-to-text.json',
              contentJson: createSmartSliceSpeechToTextEvidencePayload({
                task,
                sourceMedia,
                transcription: failedTranscription,
                transcriptSegments: [],
              }),
              ...(outputRootDir ? { outputRootDir } : {}),
            });
            const normalizedTranscriptEvidence = await writeBestEffortSmartSliceTaskEvidenceJson({
              nativeHostClient,
              workflowTaskId: task.id,
              relativePath: 'evidence/transcript.normalized.json',
              contentJson: createSmartSliceNormalizedTranscriptEvidencePayload({
                task,
                sourceMedia,
                transcription: failedTranscription,
                transcriptSegments: [],
              }),
              ...(outputRootDir ? { outputRootDir } : {}),
            });
            return {
              transcriptSegments: [],
              speechToTextEvidence,
              normalizedTranscriptEvidence,
            };
          } finally {
            stopSpeechTranscriptionSetupProgressBridge();
          }
        },
        (result) => ({
          transcriptSegments: result.transcriptSegments,
          speechToTextEvidence: result.speechToTextEvidence,
          normalizedTranscriptEvidence: result.normalizedTranscriptEvidence,
        }),
        {
          sourceAssetUuid: sourceMedia.assetUuid,
          sourceDurationMs: sourceMedia.durationMs,
        },
      );
      transcriptSegments = speechToTextStepResult.transcriptSegments;
      transcriptSegments = normalizeSmartSliceTranscriptTimelineForSourceDuration(
        transcriptSegments,
        sourceMedia.durationMs,
      );
      await assertSmartSliceTaskNotCanceled(context, 'speech-to-text');
      const planningPolicy = getVideoSlicePlanningPolicy(params);
      const renderProfile = createVideoSliceRenderProfile(planningPolicy);
      const planningParams = {
        ...params,
        ...(sourceMedia.durationMs !== undefined ? { sourceDurationMs: sourceMedia.durationMs } : {}),
        sourceAssetUuid: sourceMedia.assetUuid,
      };
      const planClipsStepResult = await runSmartSliceCheckpointedExecutionStep(
        context,
        'plan-clips',
        readPlanClipsCheckpoint,
        async () => {
          const resolvedPlanResult = await createIntelligentSlicePlanResult(planningParams, transcriptSegments);
          const resolvedPlannedClips = resolvedPlanResult.clips;
          reportVideoSliceStageDiagnostic('plan ready', {
            taskId: task.id,
            sourceAssetUuid: sourceMedia.assetUuid,
            plannedClipCount: resolvedPlannedClips.length,
            transcriptSegmentCount: transcriptSegments.length,
            sourceDurationMs: sourceMedia.durationMs,
          });
          const renderReadyPlannedClips = repairSmartSlicePlanForNativeRender(
            resolvedPlannedClips,
            transcriptSegments,
            createSmartSliceNativeRenderRepairParams(params, sourceMedia.durationMs),
          );
          const planRenderTranscriptSegments = resolveSmartSliceRenderTranscriptSegments(
            renderReadyPlannedClips,
            transcriptSegments,
          );
          if (planRenderTranscriptSegments.length > 0) {
            assertSmartSliceSemanticPlanReadyForAudioAnalysis(
              renderReadyPlannedClips,
              planRenderTranscriptSegments,
              sourceMedia.durationMs,
            );
          }
          const semanticSegmentationEvidence = await writeBestEffortSmartSliceTaskEvidenceJson({
            nativeHostClient,
            workflowTaskId: task.id,
            relativePath: 'evidence/semantic-segmentation.json',
            contentJson: createSmartSliceSemanticSegmentationEvidencePayload({
              task,
              params,
              sourceMedia,
              planResult: resolvedPlanResult,
              plannedClips: renderReadyPlannedClips,
              transcriptSegments,
            }),
            ...(outputRootDir ? { outputRootDir } : {}),
          });
          return {
            plannedClips: renderReadyPlannedClips,
            semanticSegmentationEvidence,
          };
        },
        (result) => ({
          plannedClips: result.plannedClips,
          semanticSegmentationEvidence: result.semanticSegmentationEvidence,
        }),
        {
          sourceAssetUuid: sourceMedia.assetUuid,
          transcriptSegmentCount: transcriptSegments.length,
          sourceDurationMs: sourceMedia.durationMs,
        },
      );
      const plannedClips = repairSmartSlicePlanForNativeRender(
        planClipsStepResult.plannedClips,
        transcriptSegments,
        createSmartSliceNativeRenderRepairParams(params, sourceMedia.durationMs),
      );
      const plannedRenderTranscriptSegments = resolveSmartSliceRenderTranscriptSegments(
        plannedClips,
        transcriptSegments,
      );
      if (plannedRenderTranscriptSegments.length > 0) {
        assertSmartSliceSemanticPlanReadyForAudioAnalysis(
          plannedClips,
          plannedRenderTranscriptSegments,
          sourceMedia.durationMs,
        );
      }
      await assertSmartSliceTaskNotCanceled(context, 'plan-clips');
      const checkpointedRefinedPlannedClips = await runSmartSliceCheckpointedExecutionStep(
        context,
        'analyze-audio-boundaries',
        readAudioBoundaryCheckpoint,
        async () => {
          if (!canAnalyzeAudioBoundaries || plannedRenderTranscriptSegments.length === 0) {
            reportVideoSliceStageDiagnostic('audio boundary analysis skipped; render fallback plan directly', {
              taskId: task.id,
              sourceAssetUuid: sourceMedia.assetUuid,
              plannedClipCount: plannedClips.length,
              transcriptSegmentCount: plannedRenderTranscriptSegments.length,
              videoSliceAudioActivityAnalysisCommandReady: capabilities.videoSliceAudioActivityAnalysisCommandReady,
              canRunSpeechToText,
            });
            return plannedClips;
          }
          let cleanupAttempt: SmartSliceAudioCleanupAttemptResult;
          try {
            cleanupAttempt = await analyzeAndRefineSmartSliceAudioBoundariesWithDenoiseFallback(
              nativeHostClient,
              task.id,
              sourceMedia.assetUuid,
              plannedClips,
              plannedRenderTranscriptSegments,
              params,
              outputRootDir,
              sourceMedia.durationMs,
            );
          } catch (error) {
            reportVideoSliceStageDiagnostic('audio boundary analysis failed; render fallback plan directly', {
              taskId: task.id,
              sourceAssetUuid: sourceMedia.assetUuid,
              plannedClipCount: plannedClips.length,
              transcriptSegmentCount: plannedRenderTranscriptSegments.length,
              errorMessage: error instanceof Error ? error.message : String(error),
            });
            cleanupAttempt = createFallbackSmartSliceAudioCleanupAttemptResult(
              sourceMedia.assetUuid,
              plannedClips,
            );
          }
          await assertSmartSliceTaskNotCanceled(context, 'analyze-audio-boundaries');
          reportVideoSliceStageDiagnostic('audio boundary analysis completed', {
            taskId: task.id,
            sourceAssetUuid: sourceMedia.assetUuid,
            analyzedClipCount: cleanupAttempt.audioActivityResult.analyses.length,
            refinedClipCount: cleanupAttempt.refinedClips.length,
            profile: cleanupAttempt.audioActivityResult.profile,
            noiseReduction: cleanupAttempt.noiseReductionApplied,
          });
          const renderReadyRefinedClips = repairSmartSlicePlanForNativeRender(
            cleanupAttempt.refinedClips,
            plannedRenderTranscriptSegments,
            createSmartSliceNativeRenderRepairParams(params, sourceMedia.durationMs),
          );
          if (hasCompleteTrustedSmartSliceAudioActivityEvidenceForEverySlice(renderReadyRefinedClips)) {
            assertSmartSlicePlanReadyForNativeRender(
              renderReadyRefinedClips,
              plannedRenderTranscriptSegments,
              sourceMedia.durationMs,
            );
          } else {
            assertSmartSliceResultsHaveRenderableTimeline(renderReadyRefinedClips);
          }
          return renderReadyRefinedClips;
        },
        (result) => ({
          refinedPlannedClips: result,
          noiseReductionApplied: result.some((clip) => clip.noiseReductionApplied === true),
        }),
        {
          sourceAssetUuid: sourceMedia.assetUuid,
          plannedClipCount: plannedClips.length,
          profile: SMART_SLICE_AUDIO_CLEANUP_PROFILE,
          noiseReduction: shouldStartSmartSliceWithNoiseReduction(params),
        },
      );
      const refinedPlannedClips = repairSmartSlicePlanForNativeRender(
        checkpointedRefinedPlannedClips,
        plannedRenderTranscriptSegments,
        createSmartSliceNativeRenderRepairParams(params, sourceMedia.durationMs),
      );
      const renderTranscriptSegments = resolveSmartSliceRenderTranscriptSegments(
        refinedPlannedClips,
        plannedRenderTranscriptSegments,
      );
      if (renderTranscriptSegments.length > 0) {
        if (hasCompleteTrustedSmartSliceAudioActivityEvidenceForEverySlice(refinedPlannedClips)) {
          assertSmartSlicePlanReadyForNativeRender(
            refinedPlannedClips,
            renderTranscriptSegments,
            sourceMedia.durationMs,
          );
        } else {
          assertSmartSliceResultsHaveRenderableTimeline(refinedPlannedClips);
        }
      }
      await assertSmartSliceTaskNotCanceled(context, 'analyze-audio-boundaries');
      const smartDedupAnalysis = await runSmartSliceCheckpointedExecutionStep(
        context,
        'analyze-duplicates',
        readAnalyzeDuplicatesCheckpoint,
        async () => {
          let result: SmartSliceDedupAnalysis;
          try {
            result = await analyzeSmartSliceDedup({
              params,
              sourceAssetUuid: sourceMedia.assetUuid,
              ...(runtimeSourceAsset ? { runtimeSourceAsset } : {}),
              clips: refinedPlannedClips,
              transcriptSegments: renderTranscriptSegments,
            });
          } catch (error) {
            reportVideoSliceStageDiagnostic('duplicate analysis skipped after failure', {
              taskId: task.id,
              sourceAssetUuid: sourceMedia.assetUuid,
              errorMessage: error instanceof Error ? error.message : String(error),
            });
            result = createDisabledSmartSliceDedupAnalysis();
          }
          await assertSmartSliceTaskNotCanceled(context, 'analyze-duplicates');
          reportVideoSliceStageDiagnostic('duplicate analysis completed', {
            taskId: task.id,
            sourceAssetUuid: sourceMedia.assetUuid,
            enabled: result.enabled,
            matchCount: result.smartDedupReport?.matchCount ?? 0,
            duplicateGroupCount: result.duplicateGroups.length,
            matchedSegmentCount: result.matchedSegmentIds.length,
          });
          return result;
        },
        (result) => ({
          enabled: result.enabled,
          ...(result.smartDedupReport ? { smartDedupReport: result.smartDedupReport } : {}),
          duplicateGroups: result.duplicateGroups,
          matchedSegmentIds: result.matchedSegmentIds,
        }),
        {
          sourceAssetUuid: sourceMedia.assetUuid,
          enabled: shouldRunSmartSliceDedup(params),
          strategyCount: params.videoDedupParams?.strategies.length ?? 0,
          plannedClipCount: refinedPlannedClips.length,
        },
      );
      await assertSmartSliceTaskNotCanceled(context, 'analyze-duplicates');
      const checkpointedReviewSession = await runSmartSliceCheckpointedExecutionStep(
        context,
        'human-review',
        readHumanReviewCheckpoint,
        async () => {
          const baseReviewSession = task.sliceReviewSession ?? createAutoCutSliceReviewSessionFromClips({
            taskId: task.id,
            params,
            sourceAssetUuid: sourceMedia.assetUuid,
            ...(sourceMedia.durationMs !== undefined ? { sourceDurationMs: sourceMedia.durationMs } : {}),
            clips: refinedPlannedClips,
            transcriptSegments: renderTranscriptSegments,
            smartDedupAnalysis,
          });
          const reviewedSession = applyAutoCutSliceManualEdits(
            baseReviewSession,
            context.renderSelection?.manualEdits ?? [],
          );
          const normalizedRenderSelection = context.renderSelection
            ? {
                ...context.renderSelection,
                selectedSegmentIds: resolveReviewedSmartSliceRenderableSegmentIds(
                  reviewedSession,
                  context.renderSelection.selectedSegmentIds,
                ),
              }
            : null;
          const resolvedReviewSession = normalizedRenderSelection
            ? {
                ...reviewedSession,
                status: 'rendering',
                selectedSegmentIds: [...normalizedRenderSelection.selectedSegmentIds],
                updatedAt: createAutoCutTimestamp(),
              } satisfies AutoCutSliceReviewSession
            : reviewedSession;
          const evidence = await writeSmartSliceReviewEvidenceJson({
            nativeHostClient,
            task,
            sourceMedia,
            reviewSession: resolvedReviewSession,
            ...(normalizedRenderSelection ? { renderSelection: normalizedRenderSelection } : {}),
            ...(outputRootDir ? { outputRootDir } : {}),
          });
          return {
            reviewSession: resolvedReviewSession,
            ...evidence,
          };
        },
        (result) => ({
          reviewSession: result.reviewSession,
          approvedClips: createReviewedSmartSliceClips(refinedPlannedClips, result.reviewSession),
          reviewSessionEvidence: result.reviewSessionEvidence,
          ...(result.manualEditsEvidence ? { manualEditsEvidence: result.manualEditsEvidence } : {}),
          ...(result.reviewEventsEvidence ? { reviewEventsEvidence: result.reviewEventsEvidence } : {}),
          ...(result.renderSelectionEvidence ? { renderSelectionEvidence: result.renderSelectionEvidence } : {}),
        }),
        {
          sourceAssetUuid: sourceMedia.assetUuid,
          plannedClipCount: refinedPlannedClips.length,
          reviewMode: context.reviewMode ?? 'auto-render',
        },
      );
      let reviewSession = checkpointedReviewSession.reviewSession;
      let reviewSessionEvidence = checkpointedReviewSession.reviewSessionEvidence;
      let manualEditsEvidence = checkpointedReviewSession.manualEditsEvidence;
      let reviewEventsEvidence = checkpointedReviewSession.reviewEventsEvidence;
      let renderSelectionEvidence = checkpointedReviewSession.renderSelectionEvidence;
      if (context.renderSelection) {
        const refreshedHumanReviewArtifact = readSmartSliceCheckpointArtifacts(context.checkpoint)['human-review'];
        const shouldRefreshRenderSelectionEvidence =
          !manualEditsEvidence ||
          !reviewEventsEvidence ||
          !renderSelectionEvidence ||
          refreshedHumanReviewArtifact?.reviewSession?.id !== context.renderSelection.reviewSessionId;
        if (shouldRefreshRenderSelectionEvidence) {
          const reviewedSession = applyAutoCutSliceManualEdits(reviewSession, context.renderSelection.manualEdits ?? []);
          const normalizedRenderSelection = {
            ...context.renderSelection,
            selectedSegmentIds: resolveReviewedSmartSliceRenderableSegmentIds(
              reviewedSession,
              context.renderSelection.selectedSegmentIds,
            ),
          };
          reviewSession = {
            ...reviewedSession,
            status: 'rendering',
            selectedSegmentIds: [...normalizedRenderSelection.selectedSegmentIds],
            updatedAt: createAutoCutTimestamp(),
          };
          const evidence = await writeSmartSliceReviewEvidenceJson({
            nativeHostClient,
            task,
            sourceMedia,
            reviewSession,
            renderSelection: normalizedRenderSelection,
            ...(outputRootDir ? { outputRootDir } : {}),
          });
          reviewSessionEvidence = evidence.reviewSessionEvidence;
          manualEditsEvidence = evidence.manualEditsEvidence;
          reviewEventsEvidence = evidence.reviewEventsEvidence;
          renderSelectionEvidence = evidence.renderSelectionEvidence;
          context.checkpoint = createSmartSliceCompletedCheckpoint(context.checkpoint, 'human-review', {
            reviewSession,
            approvedClips: createReviewedSmartSliceClips(refinedPlannedClips, reviewSession),
            reviewSessionEvidence,
            manualEditsEvidence,
            reviewEventsEvidence,
            renderSelectionEvidence,
          });
          await updateTask(context.task.id, { executionCheckpoint: context.checkpoint });
        }
      }
      const reviewedPlannedClips = createReviewedSmartSliceClips(
        refinedPlannedClips,
        reviewSession,
        context.renderSelection,
      );
      if (reviewedPlannedClips.length === 0) {
        throw new Error('Smart Slice render selected requires at least one selected review segment.');
      }
      if (context.reviewMode === 'review-before-render' && !context.renderSelection) {
        const reviewReadySession = {
          ...reviewSession,
          status: 'ready_for_review' as const,
          updatedAt: createAutoCutTimestamp(),
        };
        context.checkpoint = {
          ...context.checkpoint,
          artifacts: {
            ...context.checkpoint.artifacts,
            'human-review': {
              reviewSession: reviewReadySession,
              approvedClips: createReviewedSmartSliceClips(refinedPlannedClips, reviewReadySession),
              ...(reviewSessionEvidence ? { reviewSessionEvidence } : {}),
              ...(reviewEventsEvidence ? { reviewEventsEvidence } : {}),
            },
          },
          updatedAt: reviewReadySession.updatedAt,
        };
        await updateTask(task.id, {
          status: AUTOCUT_TASK_STATUS.reviewing,
          progress: 70,
          progressMessage: 'Segment Review Workbench is ready. Review, select, split, merge, or remove duplicate content before rendering.',
          currentStepId: 'human-review',
          sourceFileId: sourceMedia.assetUuid,
          sliceReviewSession: reviewReadySession,
          studioClipTimeline: createStudioClipTimelineSnapshotForReviewSession(
            reviewReadySession,
            context.task.studioClipTimeline?.processingOperations ?? [],
          ),
          ...(smartDedupAnalysis.smartDedupReport ? { videoDedupReport: smartDedupAnalysis.smartDedupReport } : {}),
          executionCheckpoint: context.checkpoint,
        });
        reportVideoSliceStageDiagnostic('human review ready', {
          taskId: task.id,
          sourceAssetUuid: sourceMedia.assetUuid,
          reviewSegmentCount: reviewReadySession.segments.length,
          selectedSegmentCount: reviewReadySession.selectedSegmentIds.length,
          duplicateGroupCount: reviewReadySession.duplicateGroups.length,
        });
        return { success: true, taskId: durableTaskId };
      }
      const appliedSmartSliceNoiseReduction = shouldAllowSmartSliceNoiseReduction(params);
      const mergedPlannedClips = mergeShortSmartSliceClips(reviewedPlannedClips, params, renderTranscriptSegments);
      const mergedRenderTranscriptSegments = resolveSmartSliceRenderTranscriptSegments(
        mergedPlannedClips,
        renderTranscriptSegments,
      );
      const nativeClips = mergedPlannedClips.map((clip) =>
        toNativeSliceClipRequest(clip, mergedRenderTranscriptSegments, params)
      );
      const subtitleRequest = createBestEffortVideoSliceSubtitleRequest(params, mergedRenderTranscriptSegments);
      const nativeResult = await runSmartSliceCheckpointedExecutionStep(
        context,
        'native-render',
        readNativeRenderCheckpoint,
        async () => {
          reportVideoSliceStageDiagnostic('native render started', {
            taskId: task.id,
            sourceAssetUuid: sourceMedia.assetUuid,
            clipCount: nativeClips.length,
            audioMuteRangeCount: nativeClips.reduce(
              (count, clip) => count + (clip.audioMuteRanges?.length ?? 0),
              0,
            ),
            clipsWithAudioActivityEvidence: nativeClips.filter((clip) =>
              typeof clip.audioActivityStartMs === 'number' &&
                typeof clip.audioActivityEndMs === 'number' &&
                typeof clip.audioActivityConfidence === 'number' &&
                typeof clip.audioActivityAnalysisFilter === 'string',
            ).length,
            clipsWithSourceSegments: nativeClips.filter((clip) =>
              Array.isArray(clip.sourceSegments) && clip.sourceSegments.length > 1,
            ).length,
            nativeAudioPostprocessPolicy: 'use-upstream-audio-boundary-plan',
            noiseReduction: appliedSmartSliceNoiseReduction,
            subtitleMode: subtitleRequest.subtitleMode,
            subtitleSegmentCount: subtitleRequest.subtitleSegments?.length ?? 0,
          });
          const resolvedNativeResult = await nativeHostClient.sliceVideo({
            assetUuid: sourceMedia.assetUuid,
            workflowTaskId: task.id,
            clips: nativeClips,
            outputFormat: 'mp4',
            ...(outputRootDir ? { outputRootDir } : {}),
            ...(renderProfile ? { renderProfile } : {}),
            noiseReduction: appliedSmartSliceNoiseReduction,
            ...subtitleRequest,
          });
          await assertSmartSliceTaskNotCanceled(context, 'native-render');
          reportVideoSliceStageDiagnostic('native render completed', {
            taskId: task.id,
            nativeTaskId: resolvedNativeResult.taskUuid,
            sourceAssetUuid: sourceMedia.assetUuid,
            sliceCount: resolvedNativeResult.slices.length,
            taskOutputDir: resolvedNativeResult.taskOutputDir,
          });
          return resolvedNativeResult;
        },
        (result) => ({
          nativeResult: result,
          nativeClips,
          subtitleRequest,
          appliedSmartSliceNoiseReduction,
        }),
        {
          sourceAssetUuid: sourceMedia.assetUuid,
          plannedClipCount: reviewedPlannedClips.length,
          noiseReduction: appliedSmartSliceNoiseReduction,
          subtitleMode: subtitleRequest.subtitleMode,
        },
      );
      nativeTaskId = nativeResult.taskUuid;
      await assertSmartSliceTaskNotCanceled(context, 'native-render');
      const completedTask: AppTask = {
        ...task,
        nativeTaskId: nativeResult.taskUuid,
        sourceFileId: sourceMedia.assetUuid,
        sliceReviewSession: reviewSession,
        ...(smartDedupAnalysis.smartDedupReport ? { videoDedupReport: smartDedupAnalysis.smartDedupReport } : {}),
      };
      const sliceResults = nativeResult.slices.map((nativeSlice, index) =>
        createNativeSliceResult(
          completedTask,
          nativeSlice,
          index,
          nativeHostClient.createAssetUrl(nativeSlice.artifactPath),
          nativeHostClient.createAssetUrl(nativeSlice.thumbnailArtifactPath),
          nativeSlice.subtitleArtifactPath
            ? nativeHostClient.createAssetUrl(nativeSlice.subtitleArtifactPath)
            : undefined,
          mergedPlannedClips[index],
          mergedRenderTranscriptSegments,
        ),
      );
      assertNativeSliceArtifactsMatchPlan(
        nativeResult.slices,
        mergedPlannedClips,
        nativeResult.taskOutputDir,
        subtitleRequest,
      );
      const verifiedSliceResults = await runSmartSliceCheckpointedExecutionStep(
        context,
        'verify-artifacts',
        readVerifyArtifactsCheckpoint,
        async () => {
          if (hasCompleteTrustedSmartSliceAudioActivityEvidenceForEverySlice(sliceResults)) {
            assertSmartSliceResultsMeetProfessionalStandard(sliceResults);
          } else {
            assertSmartSliceResultsHaveRenderableTimeline(sliceResults);
          }
          reportVideoSliceStageDiagnostic('professional evidence verified', {
            taskId: task.id,
            nativeTaskId: nativeResult.taskUuid,
            sliceCount: sliceResults.length,
            slicesWithTranscriptSegments: sliceResults.filter((slice) => slice.transcriptSegments?.length).length,
            slicesWithTranscriptText: sliceResults.filter((slice) => slice.transcriptText?.trim()).length,
          });
          const renderArtifactManifestEvidence = await writeBestEffortSmartSliceTaskEvidenceJson({
            nativeHostClient,
            workflowTaskId: task.id,
            relativePath: 'evidence/render-artifact-manifest.json',
            contentJson: createSmartSliceRenderArtifactManifestPayload({
              task,
              sourceMedia,
              nativeResult,
              nativeClips,
              sliceResults,
              plannedClips: mergedPlannedClips,
              reviewSession,
              subtitleRequest,
            }),
            ...(outputRootDir ? { outputRootDir } : {}),
          });
          return {
            sliceResults,
            renderArtifactManifestEvidence,
          };
        },
        (result) => ({
          sliceResults: result.sliceResults,
          renderArtifactManifestEvidence: result.renderArtifactManifestEvidence,
        }),
        {
          nativeTaskId: nativeResult.taskUuid,
          nativeSliceCount: nativeResult.slices.length,
          plannedClipCount: refinedPlannedClips.length,
        },
      );
      await assertSmartSliceTaskNotCanceled(context, 'verify-artifacts');
      const completedData = await runSmartSliceCheckpointedExecutionStep(
        context,
        'persist-results',
        readPersistResultsCheckpoint,
        async () => {
          await assertSmartSliceTaskNotCanceled(context, 'persist-results');
          return finishVideoSliceTask(completedTask, verifiedSliceResults.sliceResults);
        },
        (result) => ({ completedData: result }),
        {
          nativeTaskId: nativeResult.taskUuid,
          sliceCount: verifiedSliceResults.sliceResults.length,
        },
      );
      await assertSmartSliceTaskNotCanceled(context, 'persist-results');
      const renderedReviewSession: AutoCutSliceReviewSession = {
        ...reviewSession,
        status: 'rendered',
        selectedSegmentIds: context.renderSelection?.selectedSegmentIds ?? reviewSession.selectedSegmentIds,
        updatedAt: createAutoCutTimestamp(),
      };

      await updateSmartSliceTaskCompleted(task.id, {
        nativeTaskId: nativeResult.taskUuid,
        sourceFileId: sourceMedia.assetUuid,
        sliceReviewSession: renderedReviewSession,
        studioClipTimeline: createStudioClipTimelineSnapshotForReviewSession(
          renderedReviewSession,
          task.studioClipTimeline?.processingOperations ?? [],
        ),
        ...(smartDedupAnalysis.smartDedupReport ? { videoDedupReport: smartDedupAnalysis.smartDedupReport } : {}),
        executionCheckpoint: context.checkpoint,
        ...completedData,
      });
      reportVideoSliceStageDiagnostic('execution finished', {
        taskId: task.id,
        nativeTaskId: nativeResult.taskUuid,
        sliceCount: verifiedSliceResults.sliceResults.length,
      });
    } catch (error) {
      if (isAutoCutProcessingTaskCanceledError(error)) {
        if (nativeTaskId) {
          await updateTask(task.id, { nativeTaskId });
        }
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      reportAutoCutDiagnostic('error', 'slicer.service', 'Smart Slice execution failed', error);
      if (nativeTaskId) {
        await updateTask(task.id, { nativeTaskId });
      }
      return await failAutoCutProcessingTask(
        task.id,
        errorMessage,
        [
          createSmartSlicePlanningFailureDiagnostics(error),
          createVideoSliceFailureDiagnostics(error),
        ].filter(Boolean).join('\n\n'),
        error,
      );
    }

    if (nativeTaskId) {
      return { success: true, taskId: durableTaskId, nativeTaskId };
    }
    return { success: true, taskId: durableTaskId };
  }

  const errorMessage = createSmartSliceNativePreflightErrorMessage(capabilities, {
    hasTrustedDesktopSource: Boolean(desktopSourcePath),
    hasSelectedNativeAsset: Boolean(selectedNativeAssetUuid),
  });
  reportVideoSliceStageDiagnostic('native preflight failed', {
    taskId: task.id,
    hasTrustedDesktopSource: Boolean(desktopSourcePath),
    hasSelectedNativeAsset: Boolean(selectedNativeAssetUuid),
    mediaImportCommandReady: capabilities.mediaImportCommandReady,
    videoSliceCommandReady: capabilities.videoSliceCommandReady,
    speechTranscriptionCommandReady: capabilities.speechTranscriptionCommandReady,
    speechTranscriptionToolchainReady: capabilities.speechTranscriptionToolchainReady,
    errorMessage,
  });
  return await failAutoCutProcessingTask(task.id, errorMessage);
}

function createSmartSliceSpeechTranscriptionPreflightErrorMessage(
  capabilities: Awaited<ReturnType<ReturnType<typeof getAutoCutNativeHostClient>['getCapabilities']>>,
) {
  const reasons: string[] = [];
  if (!capabilities.speechTranscriptionCommandReady) {
    reasons.push('the native speech-to-text command is unavailable');
  }
  if (!isSmartSliceTaskEvidenceWriteReady(capabilities)) {
    reasons.push('the native workflow task evidence JSON write command is unavailable');
  }
  if (!capabilities.speechTranscriptionToolchainReady) {
    reasons.push('the local speech-to-text toolchain or model is not ready');
  }

  return [
    'Smart slicing requires successful speech-to-text transcription before planning clips.',
    reasons.length ? `Current preflight failed because ${reasons.join(' and ')}.` : '',
    'Open Speech-to-Text settings, complete local model setup, then retry Smart Slice.',
  ].filter(Boolean).join(' ');
}

function createSmartSliceNativePreflightErrorMessage(
  capabilities: Awaited<ReturnType<ReturnType<typeof getAutoCutNativeHostClient>['getCapabilities']>>,
  context: {
    hasTrustedDesktopSource: boolean;
    hasSelectedNativeAsset: boolean;
  },
) {
  const reasons: string[] = [];
  if (!context.hasTrustedDesktopSource && !context.hasSelectedNativeAsset) {
    reasons.push('a trusted local desktop media file or existing native media asset is required');
  }
  if (context.hasTrustedDesktopSource && !capabilities.mediaImportCommandReady) {
    reasons.push('the native media import command is unavailable');
  }
  if (!capabilities.videoSliceCommandReady) {
    reasons.push('the native video slicing command is unavailable');
  }
  if (!capabilities.videoSliceAudioActivityAnalysisCommandReady) {
    reasons.push('the native Smart Slice audio activity analysis command is unavailable');
  }
  if (!capabilities.speechTranscriptionCommandReady) {
    reasons.push('the native speech-to-text command is unavailable');
  }
  if (!capabilities.speechTranscriptionToolchainReady) {
    reasons.push('the local speech-to-text toolchain or model is not ready');
  }

  return [
    'Smart slicing cannot start because the native Smart Slice preflight is incomplete.',
    reasons.length
      ? `Current preflight failed because ${reasons.join(' and ')}.`
      : 'Current native host capabilities do not satisfy Smart Slice preflight.',
    'Fix the listed native desktop prerequisite, then retry Smart Slice.',
  ].join(' ');
}
