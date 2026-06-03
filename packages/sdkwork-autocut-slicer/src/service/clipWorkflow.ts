import {
  type AutoCutClipWorkflowStepKey,
  type AutoCutClipWorkflowStepPhase,
  type AutoCutClipWorkflowStepTemplate,
  type AutoCutClipWorkflowTemplate,
  type AutoCutSlicingEngineId,
  type AutoCutSliceManualEdit,
  type AutoCutSliceReviewSegment,
  type AutoCutSliceReviewSession,
  type AutoCutStudioClipTimelineSnapshot,
  type AutoCutTranscriptSegment,
  CLIP_PROCESSING_OPERATION_STATUS_CODE,
  type ClipProcessingOperationBlockingReason,
  type ClipProcessingOperationKey,
  type ClipProcessingOperationPlanItem,
  type ClipProcessingOperationStatus,
  type ClipProcessingPlan,
  type StudioClip,
  type StudioClipEvent,
  type StudioClipProcessingOperation,
  type StudioClipRisk,
  type StudioClipSourceRef,
  type StudioClipType,
  type StudioTimeline,
} from '@sdkwork/autocut-types';
import { createAutoCutId, createAutoCutTimestamp, resolveAutoCutTimestampMs } from '@sdkwork/autocut-services';
import { normalizeSmartSliceTranscriptEvidenceText } from './slicePlanner';

function createStableStudioClipWorkflowId(prefix: string, parts: ReadonlyArray<number | string | undefined>) {
  const suffix = parts
    .map((part) =>
      String(part ?? 'none')
        .trim()
        .replace(/[^a-zA-Z0-9_-]+/gu, '-')
        .replace(/^-+|-+$/gu, '')
        .slice(0, 80) || 'none'
    )
    .join('-');
  return `${prefix}-${suffix}`;
}

function createUniqueSmartSliceStringList(values: readonly string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

const SHARED_CLIP_CONVERGENCE_STEP_KEYS: AutoCutClipWorkflowStepKey[] = [
  'generate-clips',
  'timeline-preview-edit',
  'refine-clips',
  'process-clips',
  'render-clips',
  'verify-clips',
  'persist-results',
];

export const AUTOCUT_CLIP_PROCESSING_OPERATION_SEQUENCE: readonly ClipProcessingOperationPlanItem[] = [
  {
    key: 'denoise-audio',
    order: 1,
    label: 'Denoise audio',
    enabled: true,
    executionStage: 'audio-foundation',
    dependencyOperationKeys: [],
    parallelGroup: 'audio-cleanup',
    requiredInputs: ['studio_clip', 'source-audio-range'],
    producedOutputs: ['denoised-audio-evidence'],
    invalidatedByBoundaryEdit: true,
  },
  {
    key: 'normalize-loudness',
    order: 2,
    label: 'Normalize loudness',
    enabled: true,
    executionStage: 'audio-foundation',
    dependencyOperationKeys: ['denoise-audio'],
    parallelGroup: 'audio-cleanup',
    requiredInputs: ['denoised-audio-evidence'],
    producedOutputs: ['loudness-normalized-audio-evidence'],
    invalidatedByBoundaryEdit: true,
  },
  {
    key: 'remove-cough-and-breath-noise',
    order: 3,
    label: 'Remove cough and breath noise',
    enabled: true,
    executionStage: 'speech-cleanup',
    dependencyOperationKeys: ['denoise-audio'],
    parallelGroup: 'audio-cleanup',
    requiredInputs: ['studio_clip', 'transcript-index'],
    producedOutputs: ['speech-cleanup-edit-list'],
    invalidatedByBoundaryEdit: true,
  },
  {
    key: 'trim-silence',
    order: 4,
    label: 'Trim silence',
    enabled: true,
    executionStage: 'speech-cleanup',
    dependencyOperationKeys: ['remove-cough-and-breath-noise'],
    parallelGroup: 'audio-cleanup',
    requiredInputs: ['studio_clip', 'speech-boundary-evidence'],
    producedOutputs: ['silence-trim-edit-list'],
    invalidatedByBoundaryEdit: true,
  },
  {
    key: 'filter-repeated-content',
    order: 5,
    label: 'Filter repeated content',
    enabled: true,
    executionStage: 'content-cleanup',
    dependencyOperationKeys: ['trim-silence'],
    parallelGroup: 'content-cleanup',
    requiredInputs: ['studio_clip', 'transcript-index'],
    producedOutputs: ['repeat-filter-evidence'],
    invalidatedByBoundaryEdit: true,
  },
  {
    key: 'check-duplicate-content',
    order: 6,
    label: 'Check duplicate content',
    enabled: true,
    executionStage: 'content-cleanup',
    dependencyOperationKeys: ['filter-repeated-content'],
    parallelGroup: 'content-cleanup',
    requiredInputs: ['studio_clip', 'media-fingerprint-index'],
    producedOutputs: ['duplicate-content-evidence'],
    invalidatedByBoundaryEdit: true,
  },
  {
    key: 'refine-subtitle-cues',
    order: 7,
    label: 'Refine subtitle cues',
    enabled: true,
    executionStage: 'publishing-assets',
    dependencyOperationKeys: ['trim-silence', 'filter-repeated-content'],
    parallelGroup: 'subtitle',
    requiredInputs: ['studio_clip', 'transcript-index'],
    producedOutputs: ['subtitle-cue-evidence'],
    invalidatedByBoundaryEdit: true,
  },
  {
    key: 'select-cover-frame',
    order: 8,
    label: 'Select cover frame',
    enabled: true,
    executionStage: 'publishing-assets',
    dependencyOperationKeys: ['check-duplicate-content'],
    parallelGroup: 'cover',
    requiredInputs: ['studio_clip', 'source-video-range'],
    producedOutputs: ['cover-frame-evidence'],
    invalidatedByBoundaryEdit: true,
  },
];

const AUTOCUT_CLIP_PROCESSING_OPERATION_KEYS = AUTOCUT_CLIP_PROCESSING_OPERATION_SEQUENCE.map(
  (operation) => operation.key,
);

const AUTOCUT_CLIP_PROCESSING_OPERATION_MAX_ATTEMPTS = 3;
const STUDIO_CLIP_PROCESSING_OPERATION_OUTPUT = 'studio_clip_processing_operation';
const SMART_SLICE_REVIEW_SPLIT_MIN_EDGE_DISTANCE_MS = 500;

interface StudioClipProcessingOperationReadiness {
  status: ClipProcessingOperationStatus;
  blockedByOperationKeys: ClipProcessingOperationKey[];
  blockingReason?: ClipProcessingOperationBlockingReason;
}

export interface SplitSliceReviewSegmentAtTimelinePlayheadResult {
  reviewSession: AutoCutSliceReviewSession;
  segments: AutoCutSliceReviewSegment[];
  manualEdit: AutoCutSliceManualEdit;
  splitAtMs: number;
  createdSegmentIds: [string, string];
}

export interface AdjustSliceReviewSegmentBoundaryOnStudioTimelineResult {
  reviewSession: AutoCutSliceReviewSession;
  segments: AutoCutSliceReviewSegment[];
  segment: AutoCutSliceReviewSegment;
  manualEdit: AutoCutSliceManualEdit;
  clip: StudioClip;
  event: StudioClipEvent;
}

export interface CorrectSliceReviewSegmentOnStudioTimelineResult {
  reviewSession: AutoCutSliceReviewSession;
  segments: AutoCutSliceReviewSegment[];
  segment: AutoCutSliceReviewSegment;
  manualEdit: AutoCutSliceManualEdit;
}

export interface SetSliceReviewSegmentsRenderSelectionForRenderResult {
  reviewSession: AutoCutSliceReviewSession;
  segments: AutoCutSliceReviewSegment[];
  manualEdit: AutoCutSliceManualEdit;
  segmentIds: string[];
}

export interface SetSliceReviewSegmentRenderSelectionOnStudioTimelineResult {
  reviewSession: AutoCutSliceReviewSession;
  segments: AutoCutSliceReviewSegment[];
  segment: AutoCutSliceReviewSegment;
  manualEdit: AutoCutSliceManualEdit;
}

export interface MergeSliceReviewSegmentsOnStudioTimelineResult {
  reviewSession: AutoCutSliceReviewSession;
  segments: AutoCutSliceReviewSegment[];
  segment: AutoCutSliceReviewSegment;
  manualEdit: AutoCutSliceManualEdit;
  mergedSegmentIds: [string, string];
}

export interface MarkSliceReviewSegmentAsDuplicateOnStudioTimelineResult {
  reviewSession: AutoCutSliceReviewSession;
  segments: AutoCutSliceReviewSegment[];
  segment: AutoCutSliceReviewSegment;
  manualEdit: AutoCutSliceManualEdit;
  keepSegmentId?: string;
}

export interface RestoreSliceReviewSegmentOnStudioTimelineResult {
  reviewSession: AutoCutSliceReviewSession;
  segments: AutoCutSliceReviewSegment[];
  segment: AutoCutSliceReviewSegment;
  manualEdit: AutoCutSliceManualEdit;
}

export interface CreateStudioClipTimelineSnapshotForSourcePreviewParams {
  sourceDurationMs: number;
  sourceLabel?: string;
  taskId?: string;
  sourceAssetUuid?: string;
}

export interface CreateStudioClipTimelineSnapshotForSourcePreviewResult {
  reviewSegments: AutoCutSliceReviewSegment[];
  timelineSnapshot: AutoCutStudioClipTimelineSnapshot;
}

export function createSliceReviewSessionFromSegments(
  baseSession: AutoCutSliceReviewSession,
  segments: readonly AutoCutSliceReviewSegment[],
  manualEdits: readonly AutoCutSliceManualEdit[] = [],
): AutoCutSliceReviewSession {
  const selectedSegmentIds = segments
    .filter((segment) => segment.selected && segment.status === 'selected')
    .map((segment) => segment.id);
  return {
    ...baseSession,
    updatedAt: createAutoCutTimestamp(),
    segments: segments.map((segment) => ({ ...segment })),
    manualEdits: [...baseSession.manualEdits, ...manualEdits],
    selectedSegmentIds,
  };
}

export function createSliceReviewManualEdit(
  kind: AutoCutSliceManualEdit['kind'],
  segmentIds: string[],
  detail: Omit<Partial<AutoCutSliceManualEdit>, 'id' | 'kind' | 'segmentIds' | 'createdAt'> = {},
): AutoCutSliceManualEdit {
  return {
    id: createAutoCutId('slice-manual-edit'),
    kind,
    segmentIds,
    createdAt: createAutoCutTimestamp(),
    ...detail,
  };
}

function createStepTemplate(
  key: AutoCutClipWorkflowStepKey,
  phase: AutoCutClipWorkflowStepPhase,
  label: string,
  order: number,
  options: Partial<Pick<AutoCutClipWorkflowStepTemplate, 'runsPerClip' | 'clipProcessingOperationKeys' | 'reviewUiContract' | 'producedOutputs' | 'requiredInputs'>> = {},
): AutoCutClipWorkflowStepTemplate {
  return {
    key,
    phase,
    label,
    order,
    progressWeight: key === 'timeline-preview-edit' ? 0 : 1,
    canResumeFromHere: true,
    reviewUiContract: options.reviewUiContract ?? 'none',
    producedOutputs: options.producedOutputs ?? [],
    requiredInputs: options.requiredInputs ?? [],
    ...(options.runsPerClip !== undefined ? { runsPerClip: options.runsPerClip } : {}),
    ...(options.clipProcessingOperationKeys !== undefined
      ? { clipProcessingOperationKeys: [...options.clipProcessingOperationKeys] }
      : {}),
  };
}

function createSharedClipSteps(startOrder: number): AutoCutClipWorkflowStepTemplate[] {
  return [
    createStepTemplate('generate-clips', 'clip-generation', 'Generate editable clips', startOrder, {
      producedOutputs: ['studio_timeline', 'studio_clip'],
      requiredInputs: ['engine-analysis-evidence'],
    }),
    createStepTemplate('timeline-preview-edit', 'human-review', 'Preview and edit clips on source timeline', startOrder + 1, {
      reviewUiContract: 'source-timeline',
      producedOutputs: ['studio_clip_event'],
      requiredInputs: ['studio_clip'],
    }),
    createStepTemplate('refine-clips', 'processing', 'Refine each clip boundary and transcript evidence', startOrder + 2, {
      runsPerClip: true,
      producedOutputs: ['clip-refinement-evidence'],
      requiredInputs: ['studio_clip'],
    }),
    createStepTemplate('process-clips', 'processing', 'Process each clip for cleanup and deduplication', startOrder + 3, {
      runsPerClip: true,
      clipProcessingOperationKeys: [...AUTOCUT_CLIP_PROCESSING_OPERATION_KEYS],
      producedOutputs: ['processed-clip-evidence', STUDIO_CLIP_PROCESSING_OPERATION_OUTPUT],
      requiredInputs: ['studio_clip'],
    }),
    createStepTemplate('render-clips', 'rendering', 'Render selected clips', startOrder + 4, {
      runsPerClip: true,
      producedOutputs: ['media_artifact'],
      requiredInputs: ['processed-clip-evidence'],
    }),
    createStepTemplate('verify-clips', 'verification', 'Verify rendered clips', startOrder + 5, {
      runsPerClip: true,
      producedOutputs: ['render-verification-evidence'],
      requiredInputs: ['media_artifact'],
    }),
    createStepTemplate('persist-results', 'persistence', 'Persist final clip results', startOrder + 6, {
      producedOutputs: ['task-output'],
      requiredInputs: ['render-verification-evidence'],
    }),
  ];
}

function createWorkflowTemplate(
  id: AutoCutSlicingEngineId,
  label: string,
  clipType: StudioClipType,
  analysisSteps: readonly AutoCutClipWorkflowStepTemplate[],
): AutoCutClipWorkflowTemplate {
  const steps = [
    createStepTemplate('prepare-source', 'source', 'Prepare source media', 1, {
      producedOutputs: ['media_asset'],
    }),
    createStepTemplate('probe-media', 'source', 'Probe source media streams', 2, {
      producedOutputs: ['source-media-metadata'],
      requiredInputs: ['media_asset'],
    }),
    ...analysisSteps,
    ...createSharedClipSteps(analysisSteps.length + 3),
  ];
  return {
    id,
    label,
    version: 1,
    clipType,
    steps,
    sharedConvergenceStepKeys: SHARED_CLIP_CONVERGENCE_STEP_KEYS,
  };
}

const TRANSCRIPT_SEMANTIC_CLIP_WORKFLOW_TEMPLATE = createWorkflowTemplate(
  'transcript-semantic-v2',
  'Transcript semantic clips',
  'speech',
  [
    createStepTemplate('speech-to-text', 'analysis', 'Transcribe source speech', 3, {
      producedOutputs: ['media_text_track', 'media_text_segment'],
      requiredInputs: ['media_asset'],
    }),
    createStepTemplate('build-transcript-index', 'analysis', 'Build transcript index', 4, {
      producedOutputs: ['transcript-index'],
      requiredInputs: ['media_text_segment'],
    }),
    createStepTemplate('content-understanding-segmentation', 'analysis', 'Segment by content understanding', 5, {
      producedOutputs: ['media_content_unit'],
      requiredInputs: ['transcript-index'],
    }),
  ],
);

export const AUTOCUT_INTELLIGENT_SLICING_ENGINE_TEMPLATES: readonly AutoCutClipWorkflowTemplate[] = [
  TRANSCRIPT_SEMANTIC_CLIP_WORKFLOW_TEMPLATE,
  createWorkflowTemplate('dialogue-speaker-v1', 'Dialogue speaker clips', 'dialogue', [
    createStepTemplate('speech-to-text', 'analysis', 'Transcribe dialogue', 3),
    createStepTemplate('speaker-diarization', 'analysis', 'Separate speaker turns', 4),
    createStepTemplate('dialogue-unit-segmentation', 'analysis', 'Build dialogue units', 5),
  ]),
  createWorkflowTemplate('commerce-live-v1', 'Commerce live clips', 'product', [
    createStepTemplate('speech-to-text', 'analysis', 'Transcribe live commerce speech', 3),
    createStepTemplate('product-entity-extraction', 'analysis', 'Extract product offers', 4),
    createStepTemplate('content-understanding-segmentation', 'analysis', 'Segment offer narrative', 5),
  ]),
  createWorkflowTemplate('visual-scene-v1', 'Visual scene clips', 'scene', [
    createStepTemplate('scene-detection', 'analysis', 'Detect visual scenes', 3),
    createStepTemplate('motion-audio-analysis', 'analysis', 'Analyze motion and audio events', 4),
  ]),
  createWorkflowTemplate('pause-keyword-v1', 'Pause and keyword clips', 'manual', [
    createStepTemplate('motion-audio-analysis', 'analysis', 'Analyze pauses and keyword evidence', 3),
  ]),
  createWorkflowTemplate('manual-timeline-v1', 'Manual timeline clips', 'manual', []),
];

export function getAutoCutClipWorkflowTemplate(engineId: AutoCutSlicingEngineId): AutoCutClipWorkflowTemplate {
  return AUTOCUT_INTELLIGENT_SLICING_ENGINE_TEMPLATES.find((template) => template.id === engineId) ??
    TRANSCRIPT_SEMANTIC_CLIP_WORKFLOW_TEMPLATE;
}

export function createStudioClipTimelineFromReviewSession(
  reviewSession: AutoCutSliceReviewSession,
  engineId: AutoCutSlicingEngineId = 'transcript-semantic-v2',
) {
  const timestamp = createAutoCutTimestamp();
  const timeline: StudioTimeline = {
    id: createStableStudioClipWorkflowId('studio-timeline', [reviewSession.id]),
    schema: 'studio.timeline.v1',
    taskId: reviewSession.taskId,
    ...(reviewSession.sourceAssetUuid ? { sourceAssetUuid: reviewSession.sourceAssetUuid } : {}),
    status: resolveStudioTimelineStatus(reviewSession),
    timelineType: 'slice_review',
    durationMs: Math.max(1, Math.round(reviewSession.sourceDurationMs ?? resolveReviewSessionEndMs(reviewSession))),
    createdAt: reviewSession.createdAt,
    updatedAt: timestamp,
    metadata: {
      reviewSessionId: reviewSession.id,
      segmentationAgentId: reviewSession.segmentationAgentId,
    },
  };
  const clips = reviewSession.segments.map((segment, index) =>
    createStudioClipFromReviewSegment(timeline, segment, index, engineId)
  );
  return {
    timeline,
    clips,
    processingOperations: clips.flatMap((clip) => createStudioClipProcessingOperations(timeline, clip)),
  };
}

export function createStudioClipTimelineSnapshotForReviewSession(
  reviewSession: AutoCutSliceReviewSession,
  processingOperations: readonly StudioClipProcessingOperation[] = [],
  engineId: AutoCutSlicingEngineId = 'transcript-semantic-v2',
): AutoCutStudioClipTimelineSnapshot {
  return mergeStudioClipTimelineSnapshotProcessingOperationHistory({
    snapshot: createStudioClipTimelineFromReviewSession(reviewSession, engineId),
    processingOperations,
  });
}

export function createStudioClipTimelineSnapshotForSourcePreview({
  sourceDurationMs,
  sourceLabel = 'Source video',
  taskId = 'source-preview',
  sourceAssetUuid,
}: CreateStudioClipTimelineSnapshotForSourcePreviewParams): CreateStudioClipTimelineSnapshotForSourcePreviewResult {
  const durationMs = Math.max(1, Math.round(sourceDurationMs));
  const timestamp = createAutoCutTimestamp();
  const reviewSegment: AutoCutSliceReviewSegment = {
    id: createStableStudioClipWorkflowId('source-preview-segment', [taskId, sourceLabel, durationMs]),
    sourceClipIndex: 0,
    status: 'selected',
    selected: true,
    title: sourceLabel.trim() || 'Source video',
    summary: 'Source preview before Smart Slice analysis',
    startMs: 0,
    endMs: durationMs,
    durationMs,
    boundaryVersion: 0,
    contentUnitIds: [],
    speakerIds: [],
    speakerRoles: [],
    risks: [],
  };
  const previewReviewSession: AutoCutSliceReviewSession = {
    id: createStableStudioClipWorkflowId('source-preview-review-session', [taskId, sourceLabel, durationMs]),
    schema: 'slice.review.v1',
    status: 'ready_for_review',
    taskId,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...(sourceAssetUuid ? { sourceAssetUuid } : {}),
    sourceDurationMs: durationMs,
    segments: [reviewSegment],
    duplicateGroups: [],
    manualEdits: [],
    selectedSegmentIds: [reviewSegment.id],
  };
  const timelineSnapshot = createStudioClipTimelineFromReviewSession(previewReviewSession, 'manual-timeline-v1');
  return {
    reviewSegments: previewReviewSession.segments,
    timelineSnapshot: {
      ...timelineSnapshot,
      processingOperations: [],
      timeline: {
        ...timelineSnapshot.timeline,
        status: 'draft',
        metadata: {
          ...(timelineSnapshot.timeline.metadata ?? {}),
          sourcePreview: true,
          engineId: 'manual-timeline-v1',
        },
      },
    },
  };
}

export function previewStudioClipBoundaryAdjustment({
  clip,
  timeline,
  side,
  nextMs,
  minDurationMs = 1_000,
}: {
  clip: StudioClip;
  timeline: StudioTimeline;
  side: 'left' | 'right';
  nextMs: number;
  minDurationMs?: number;
}): StudioClip {
  const oldStartMs = clip.startMs;
  const oldEndMs = clip.endMs;
  const timelineEndMs = Math.max(timeline.durationMs, oldEndMs, oldStartMs + 1);
  const minDuration = Math.max(1, Math.min(minDurationMs, timelineEndMs));
  const normalizedNextMs = Math.max(0, Math.min(timelineEndMs, Math.round(nextMs)));
  const startMs = side === 'left'
    ? Math.max(0, Math.min(normalizedNextMs, Math.max(0, oldEndMs - minDuration)))
    : oldStartMs;
  const endMs = side === 'right'
    ? Math.min(timelineEndMs, Math.max(normalizedNextMs, Math.min(timelineEndMs, oldStartMs + minDuration)))
    : oldEndMs;
  const timestamp = createAutoCutTimestamp();
  return {
    ...clip,
    startMs,
    endMs,
    durationMs: Math.max(1, endMs - startMs),
    preview: {
      sourceStartMs: startMs,
      sourceEndMs: endMs,
      loop: true,
    },
    updatedAt: timestamp,
  };
}

export function adjustStudioClipBoundary({
  clip,
  timeline,
  side,
  nextMs,
  minDurationMs = 1_000,
}: {
  clip: StudioClip;
  timeline: StudioTimeline;
  side: 'left' | 'right';
  nextMs: number;
  minDurationMs?: number;
}): { clip: StudioClip; event: StudioClipEvent } {
  const oldStartMs = clip.startMs;
  const oldEndMs = clip.endMs;
  const oldBoundaryVersion = normalizeStudioClipBoundaryVersion(clip.boundaryVersion);
  const newBoundaryVersion = oldBoundaryVersion + 1;
  const adjustedClip = previewStudioClipBoundaryAdjustment({
    clip,
    timeline,
    side,
    nextMs,
    minDurationMs,
  });
  const timestamp = adjustedClip.updatedAt;
  return {
    clip: {
      ...adjustedClip,
      boundaryVersion: newBoundaryVersion,
      metadata: {
        ...(adjustedClip.metadata ?? {}),
        previousBoundaryVersion: oldBoundaryVersion,
        boundaryVersionUpdatedAt: timestamp,
      },
    },
    event: {
      id: createAutoCutId('studio-clip-event'),
      timelineId: timeline.id,
      clipId: clip.id,
      taskId: clip.taskId,
      eventType: 'clip-boundary-adjusted',
      payload: {
        side,
        oldStartMs,
        oldEndMs,
        newStartMs: adjustedClip.startMs,
        newEndMs: adjustedClip.endMs,
        oldBoundaryVersion,
        newBoundaryVersion,
        snapTarget: 'source-timeline',
        invalidatedOperationKeys: [...AUTOCUT_CLIP_PROCESSING_OPERATION_KEYS],
      },
      invalidatedStepKeys: ['refine-clips', 'process-clips', 'render-clips', 'verify-clips', 'persist-results'],
      invalidatedOperationKeys: [...AUTOCUT_CLIP_PROCESSING_OPERATION_KEYS],
      createdAt: timestamp,
      createdBy: 'local-user',
    },
  };
}

export function adjustSliceReviewSegmentBoundaryOnStudioTimeline({
  reviewSession,
  segmentId,
  clip,
  timeline,
  side,
  nextMs,
  minDurationMs,
}: {
  reviewSession: AutoCutSliceReviewSession;
  segmentId: string;
  clip: StudioClip;
  timeline: StudioTimeline;
  side: 'left' | 'right';
  nextMs: number;
  minDurationMs?: number;
}): AdjustSliceReviewSegmentBoundaryOnStudioTimelineResult | null {
  const segment = reviewSession.segments.find((candidate) => candidate.id === segmentId);
  const reviewSegmentId = typeof clip.metadata?.reviewSegmentId === 'string'
    ? clip.metadata.reviewSegmentId
    : segmentId;
  if (!segment || reviewSegmentId !== segment.id) {
    return null;
  }

  const boundaryAdjustment = adjustStudioClipBoundary({
    clip,
    timeline,
    side,
    nextMs,
    ...(minDurationMs !== undefined ? { minDurationMs } : {}),
  });
  const correctedSegment = createSliceReviewSegmentFromWorkflowClipBoundaryAdjustment(segment, boundaryAdjustment.clip);
  const manualEdit: AutoCutSliceManualEdit = {
    id: createAutoCutId('slice-manual-edit'),
    kind: 'correctSegment',
    segmentIds: [segment.id],
    createdAt: createAutoCutTimestamp(),
    reason: `manual ${side} boundary adjusted on studio_clip timeline`,
    patch: {
      startMs: correctedSegment.startMs,
      endMs: correctedSegment.endMs,
      boundaryVersion: boundaryAdjustment.clip.boundaryVersion,
      ...(correctedSegment.speechStartMs !== undefined ? { speechStartMs: correctedSegment.speechStartMs } : {}),
      ...(correctedSegment.speechEndMs !== undefined ? { speechEndMs: correctedSegment.speechEndMs } : {}),
      ...(correctedSegment.transcriptText ? { transcriptText: correctedSegment.transcriptText } : {}),
    },
  };
  const segments = reviewSession.segments.map((candidate) =>
    candidate.id === segment.id ? correctedSegment : candidate
  );
  return {
    reviewSession: createSliceReviewSessionFromSegments(reviewSession, segments, [manualEdit]),
    segments,
    segment: correctedSegment,
    manualEdit,
    clip: boundaryAdjustment.clip,
    event: boundaryAdjustment.event,
  };
}

export function correctSliceReviewSegmentOnStudioTimeline({
  reviewSession,
  segmentId,
  patch,
}: {
  reviewSession: AutoCutSliceReviewSession;
  segmentId: string;
  patch: NonNullable<AutoCutSliceManualEdit['patch']>;
}): CorrectSliceReviewSegmentOnStudioTimelineResult | null {
  const segment = reviewSession.segments.find((candidate) => candidate.id === segmentId);
  if (!segment) {
    return null;
  }

  const correctedSegment = normalizeCorrectedSliceReviewSegment(segment, patch);
  const manualEdit: AutoCutSliceManualEdit = {
    id: createAutoCutId('slice-manual-edit'),
    kind: 'correctSegment',
    segmentIds: [segment.id],
    createdAt: createAutoCutTimestamp(),
    reason: 'manual real-time segment correction',
    patch: {
      title: correctedSegment.title,
      startMs: correctedSegment.startMs,
      endMs: correctedSegment.endMs,
      ...(correctedSegment.speechStartMs !== undefined ? { speechStartMs: correctedSegment.speechStartMs } : {}),
      ...(correctedSegment.speechEndMs !== undefined ? { speechEndMs: correctedSegment.speechEndMs } : {}),
      ...(correctedSegment.transcriptText ? { transcriptText: correctedSegment.transcriptText } : {}),
      speakerIds: correctedSegment.speakerIds,
      speakerRoles: correctedSegment.speakerRoles,
      ...(correctedSegment.manualNotes ? { manualNotes: correctedSegment.manualNotes } : {}),
    },
  };
  const segments = reviewSession.segments.map((candidate) =>
    candidate.id === segment.id ? correctedSegment : candidate
  );
  return {
    reviewSession: createSliceReviewSessionFromSegments(reviewSession, segments, [manualEdit]),
    segments,
    segment: correctedSegment,
    manualEdit,
  };
}

export function setSliceReviewSegmentsRenderSelectionForRender({
  reviewSession,
  selected,
  reason,
}: {
  reviewSession: AutoCutSliceReviewSession;
  selected: boolean;
  reason?: string;
}): SetSliceReviewSegmentsRenderSelectionForRenderResult | null {
  const changedSegmentIds = reviewSession.segments
    .filter((segment) =>
      segment.status !== 'duplicate' &&
        (segment.selected !== selected || segment.status !== (selected ? 'selected' : 'excluded'))
    )
    .map((segment) => segment.id);
  if (changedSegmentIds.length === 0) {
    return null;
  }

  const segments = reviewSession.segments.map((segment) =>
    segment.status === 'duplicate'
      ? segment
      : {
          ...segment,
          selected,
          status: selected ? 'selected' as const : 'excluded' as const,
        }
  );
  const manualEdit = createSliceReviewManualEdit(selected ? 'select' : 'exclude', changedSegmentIds, {
    reason: reason ?? (selected
      ? 'manual bulk select all publishable review segments'
      : 'manual clear selected review segments'),
  });
  return {
    reviewSession: createSliceReviewSessionFromSegments(reviewSession, segments, [manualEdit]),
    segments,
    manualEdit,
    segmentIds: changedSegmentIds,
  };
}

export function selectAllSliceReviewSegmentsForRender({
  reviewSession,
}: {
  reviewSession: AutoCutSliceReviewSession;
}): SetSliceReviewSegmentsRenderSelectionForRenderResult | null {
  return setSliceReviewSegmentsRenderSelectionForRender({
    reviewSession,
    selected: true,
    reason: 'manual bulk select all publishable review segments',
  });
}

export function setSliceReviewSegmentRenderSelectionOnStudioTimeline({
  reviewSession,
  segmentId,
  selected,
}: {
  reviewSession: AutoCutSliceReviewSession;
  segmentId: string;
  selected: boolean;
}): SetSliceReviewSegmentRenderSelectionOnStudioTimelineResult | null {
  const segment = reviewSession.segments.find((candidate) => candidate.id === segmentId);
  if (!segment || segment.status === 'duplicate') {
    return null;
  }
  const nextStatus = selected ? 'selected' : 'excluded';
  if (segment.selected === selected && segment.status === nextStatus) {
    return null;
  }

  const nextSegment: AutoCutSliceReviewSegment = {
    ...segment,
    selected,
    status: nextStatus,
  };
  const manualEdit = createSliceReviewManualEdit(selected ? 'select' : 'exclude', [segment.id], {
    reason: selected ? 'manual segment selected for render' : 'manual segment excluded from render',
  });
  const segments = reviewSession.segments.map((candidate) =>
    candidate.id === segment.id ? nextSegment : candidate
  );
  return {
    reviewSession: createSliceReviewSessionFromSegments(reviewSession, segments, [manualEdit]),
    segments,
    segment: nextSegment,
    manualEdit,
  };
}

export function mergeSliceReviewSegmentsOnStudioTimeline({
  reviewSession,
  segmentId,
  direction,
}: {
  reviewSession: AutoCutSliceReviewSession;
  segmentId: string;
  direction: 'previous' | 'next';
}): MergeSliceReviewSegmentsOnStudioTimelineResult | null {
  const segmentIndex = reviewSession.segments.findIndex((segment) => segment.id === segmentId);
  const neighborIndex = direction === 'previous' ? segmentIndex - 1 : segmentIndex + 1;
  const currentSegment = reviewSession.segments[segmentIndex];
  const neighborSegment = reviewSession.segments[neighborIndex];
  if (!currentSegment || !neighborSegment) {
    return null;
  }
  if (currentSegment.status === 'duplicate' || neighborSegment.status === 'duplicate') {
    return null;
  }

  const mergeSegments = [currentSegment, neighborSegment].sort((firstSegment, secondSegment) =>
    firstSegment.startMs - secondSegment.startMs ||
      firstSegment.endMs - secondSegment.endMs ||
      firstSegment.id.localeCompare(secondSegment.id)
  ) as [AutoCutSliceReviewSegment, AutoCutSliceReviewSegment];
  const mergedSegment = createMergedSliceReviewSegmentForWorkflow(mergeSegments);
  const mergeIds = new Set(mergeSegments.map((segment) => segment.id));
  const firstIndex = Math.min(segmentIndex, neighborIndex);
  const retainedSegments = reviewSession.segments.filter((segment) => !mergeIds.has(segment.id));
  const segments = [
    ...retainedSegments.slice(0, firstIndex),
    mergedSegment,
    ...retainedSegments.slice(firstIndex),
  ];
  const manualEdit = createSliceReviewManualEdit('merge', mergeSegments.map((segment) => segment.id), {
    createdSegmentIds: [mergedSegment.id],
    reason: 'manual merge to preserve continuous context',
  });
  return {
    reviewSession: createSliceReviewSessionFromSegments(reviewSession, segments, [manualEdit]),
    segments,
    segment: mergedSegment,
    manualEdit,
    mergedSegmentIds: [mergeSegments[0].id, mergeSegments[1].id],
  };
}

export function markSliceReviewSegmentAsDuplicateOnStudioTimeline({
  reviewSession,
  segmentId,
}: {
  reviewSession: AutoCutSliceReviewSession;
  segmentId: string;
}): MarkSliceReviewSegmentAsDuplicateOnStudioTimelineResult | null {
  const segment = reviewSession.segments.find((candidate) => candidate.id === segmentId);
  if (!segment) {
    return null;
  }
  const keepSegmentId = resolveSliceReviewDuplicateKeepSegmentId(reviewSession, segment);
  if (segment.status === 'duplicate' && segment.duplicateOfSegmentId === keepSegmentId) {
    return null;
  }

  const nextSegment: AutoCutSliceReviewSegment = {
    ...segment,
    selected: false,
    status: 'duplicate',
    duplicateOfSegmentId: keepSegmentId,
  };
  const segmentIds = keepSegmentId ? [keepSegmentId, segment.id] : [segment.id];
  const manualEdit = createSliceReviewManualEdit('deleteDuplicate', segmentIds, {
    ...(keepSegmentId ? { keepSegmentId } : {}),
    reason: 'manual duplicate content deletion',
  });
  const segments = reviewSession.segments.map((candidate) =>
    candidate.id === segment.id ? nextSegment : candidate
  );
  return {
    reviewSession: createSliceReviewSessionFromSegments(reviewSession, segments, [manualEdit]),
    segments,
    segment: nextSegment,
    manualEdit,
    ...(keepSegmentId ? { keepSegmentId } : {}),
  };
}

export function restoreSliceReviewSegmentOnStudioTimeline({
  reviewSession,
  segmentId,
}: {
  reviewSession: AutoCutSliceReviewSession;
  segmentId: string;
}): RestoreSliceReviewSegmentOnStudioTimelineResult | null {
  const segment = reviewSession.segments.find((candidate) => candidate.id === segmentId);
  if (!segment) {
    return null;
  }
  if (
    segment.selected &&
    segment.status === 'selected' &&
    segment.duplicateGroupId === undefined &&
    segment.duplicateOfSegmentId === undefined
  ) {
    return null;
  }

  const nextSegment: AutoCutSliceReviewSegment = {
    ...segment,
    selected: true,
    status: 'selected',
    duplicateGroupId: undefined,
    duplicateOfSegmentId: undefined,
  };
  const manualEdit = createSliceReviewManualEdit('restore', [segment.id], {
    reason: 'manual restore before render',
  });
  const segments = reviewSession.segments.map((candidate) =>
    candidate.id === segment.id ? nextSegment : candidate
  );
  return {
    reviewSession: createSliceReviewSessionFromSegments(reviewSession, segments, [manualEdit]),
    segments,
    segment: nextSegment,
    manualEdit,
  };
}

function createMergedSliceReviewSegmentForWorkflow(
  segments: readonly [AutoCutSliceReviewSegment, AutoCutSliceReviewSegment],
): AutoCutSliceReviewSegment {
  const orderedSegments = [...segments].sort((firstSegment, secondSegment) =>
    firstSegment.startMs - secondSegment.startMs ||
      firstSegment.endMs - secondSegment.endMs ||
      firstSegment.id.localeCompare(secondSegment.id)
  ) as [AutoCutSliceReviewSegment, AutoCutSliceReviewSegment];
  const [firstSegment, secondSegment] = orderedSegments;
  const mergedStartMs = Math.min(firstSegment.startMs, secondSegment.startMs);
  const mergedEndMs = Math.max(firstSegment.endMs, secondSegment.endMs);
  const mergedTranscriptSegments = createMergedSliceReviewTranscriptSegments(orderedSegments);
  const transcriptTextFromSegments = createSliceReviewTranscriptTextForWorkflow(mergedTranscriptSegments);
  const transcriptText = transcriptTextFromSegments || orderedSegments
    .map((segment) => segment.transcriptText?.trim() ?? '')
    .filter(Boolean)
    .join(' ')
    .trim();
  const mergedSpeechRange = createMergedSliceReviewSpeechRangeForWorkflow(
    orderedSegments,
    mergedStartMs,
    mergedEndMs,
    mergedTranscriptSegments,
  );
  const boundaryVersions = orderedSegments
    .map((segment) => segment.boundaryVersion)
    .filter((version): version is number => typeof version === 'number' && Number.isFinite(version))
    .map((version) => Math.max(1, Math.round(version)));
  const manualNotes = createUniqueSmartSliceStringList(
    orderedSegments
      .map((segment) => segment.manualNotes?.trim() ?? '')
      .filter(Boolean),
  );
  return {
    ...firstSegment,
    id: [firstSegment.id, secondSegment.id].sort().join('::'),
    title: `${firstSegment.title} + ${secondSegment.title}`,
    ...(firstSegment.summary || secondSegment.summary
      ? { summary: [firstSegment.summary, secondSegment.summary].filter(Boolean).join(' ').trim() }
      : {}),
    startMs: mergedStartMs,
    endMs: mergedEndMs,
    durationMs: Math.max(1, mergedEndMs - mergedStartMs),
    ...(boundaryVersions.length > 0 ? { boundaryVersion: Math.max(...boundaryVersions) } : {}),
    ...(mergedSpeechRange.speechStartMs !== undefined ? { speechStartMs: mergedSpeechRange.speechStartMs } : {}),
    ...(mergedSpeechRange.speechEndMs !== undefined ? { speechEndMs: mergedSpeechRange.speechEndMs } : {}),
    contentUnitIds: createUniqueSmartSliceStringList(orderedSegments.flatMap((segment) => segment.contentUnitIds)),
    speakerIds: createUniqueSmartSliceStringList(orderedSegments.flatMap((segment) => segment.speakerIds)),
    speakerRoles: createUniqueSmartSliceStringList(orderedSegments.flatMap((segment) => segment.speakerRoles)),
    ...(mergedTranscriptSegments.length > 0 ? { transcriptSegments: mergedTranscriptSegments } : {}),
    ...(transcriptText ? { transcriptText } : {}),
    risks: createUniqueSmartSliceStringList(orderedSegments.flatMap((segment) => segment.risks)),
    selected: orderedSegments.some((segment) => segment.selected),
    status: orderedSegments.some((segment) => segment.selected) ? 'selected' : 'excluded',
    duplicateGroupId: undefined,
    duplicateOfSegmentId: undefined,
    ...(manualNotes.length > 0 ? { manualNotes: manualNotes.join(' ') } : {}),
  };
}

function createMergedSliceReviewTranscriptSegments(
  segments: readonly [AutoCutSliceReviewSegment, AutoCutSliceReviewSegment],
) {
  const transcriptSegments = segments.flatMap((segment) => {
    if (segment.transcriptSegments && segment.transcriptSegments.length > 0) {
      return segment.transcriptSegments.map((transcriptSegment) => ({ ...transcriptSegment }));
    }
    if (!segment.transcriptText?.trim()) {
      return [];
    }
    const speechStartMs = Math.max(0, Math.round(segment.speechStartMs ?? segment.startMs));
    const speechEndMs = Math.max(
      speechStartMs + 1,
      Math.round(segment.speechEndMs ?? segment.endMs),
    );
    return [{
      startMs: speechStartMs,
      endMs: speechEndMs,
      text: segment.transcriptText.trim(),
      ...(segment.speakerRoles[0]?.trim() ? { speaker: segment.speakerRoles[0].trim() } : {}),
    }];
  });
  return transcriptSegments.sort((firstSegment, secondSegment) =>
    firstSegment.startMs - secondSegment.startMs ||
      firstSegment.endMs - secondSegment.endMs ||
      firstSegment.text.localeCompare(secondSegment.text)
  );
}

function createMergedSliceReviewSpeechRangeForWorkflow(
  segments: readonly [AutoCutSliceReviewSegment, AutoCutSliceReviewSegment],
  startMs: number,
  endMs: number,
  transcriptSegments: readonly AutoCutTranscriptSegment[],
) {
  const speechStartMs = transcriptSegments[0]?.startMs ??
    segments
      .map((segment) => segment.speechStartMs)
      .find((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const speechEndMs = transcriptSegments.at(-1)?.endMs ??
    [...segments]
      .reverse()
      .map((segment) => segment.speechEndMs)
      .find((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (speechStartMs === undefined || speechEndMs === undefined) {
    return {};
  }
  const normalizedSpeechStartMs = Math.max(startMs, Math.min(endMs, Math.round(speechStartMs)));
  const normalizedSpeechEndMs = Math.max(
    normalizedSpeechStartMs,
    Math.min(endMs, Math.round(speechEndMs)),
  );
  return {
    speechStartMs: normalizedSpeechStartMs,
    speechEndMs: normalizedSpeechEndMs,
  };
}

function resolveSliceReviewDuplicateKeepSegmentId(
  reviewSession: AutoCutSliceReviewSession,
  segment: AutoCutSliceReviewSegment,
) {
  if (segment.duplicateOfSegmentId) {
    return segment.duplicateOfSegmentId;
  }

  const duplicateGroup = segment.duplicateGroupId
    ? reviewSession.duplicateGroups.find((group) => group.id === segment.duplicateGroupId)
    : undefined;
  if (duplicateGroup?.keptSegmentId && duplicateGroup.keptSegmentId !== segment.id) {
    return duplicateGroup.keptSegmentId;
  }

  const groupPeerId = duplicateGroup?.segmentIds.find((segmentId) => segmentId !== segment.id);
  if (groupPeerId) {
    return groupPeerId;
  }

  return undefined;
}

export function invalidateStudioClipProcessingOperationsForBoundaryEdit({
  processingOperations,
  event,
}: {
  processingOperations: readonly StudioClipProcessingOperation[];
  event: StudioClipEvent;
}): StudioClipProcessingOperation[] {
  if (event.eventType !== 'clip-boundary-adjusted' || !event.clipId) {
    return [...processingOperations];
  }
  const invalidatedOperationKeys = new Set(event.invalidatedOperationKeys ?? []);
  if (invalidatedOperationKeys.size === 0) {
    return [...processingOperations];
  }
  const newSourceRange = resolveBoundaryEditEventNewSourceRange(event);
  const newBoundaryVersion = resolveBoundaryEditEventNewBoundaryVersion(event);
  return processingOperations.map((operation) => {
    if (
      operation.clipId !== event.clipId ||
      !invalidatedOperationKeys.has(operation.operationKey) ||
      isTerminalStudioClipProcessingOperationStatus(operation.status)
    ) {
      return operation;
    }
    const operationWithoutBlockingReason = clearStudioClipProcessingOperationBlockingReason(operation);
    const inputWithoutBlockingReason = applyStudioClipProcessingOperationReadinessToRecord(operation.input, {
      status: 'invalidated',
      blockedByOperationKeys: [],
    });
    const metadataWithoutBlockingReason = applyStudioClipProcessingOperationReadinessToRecord(operation.metadata, {
      status: 'invalidated',
      blockedByOperationKeys: [],
    });
    return {
      ...operationWithoutBlockingReason,
      status: 'invalidated',
      statusKey: 'invalidated',
      statusCode: CLIP_PROCESSING_OPERATION_STATUS_CODE.invalidated,
      enabled: false,
      blockedByOperationKeys: [],
      completedAt: event.createdAt,
      durationMs: resolveStudioClipProcessingOperationDurationMs(operation, event.createdAt),
      invalidatedByEventId: event.id,
      invalidatedAt: event.createdAt,
      updatedAt: event.createdAt,
      input: inputWithoutBlockingReason,
      metadata: {
        ...metadataWithoutBlockingReason,
        invalidatedByBoundaryEdit: true,
        invalidatedByEventId: event.id,
        invalidatedAt: event.createdAt,
        previousStatus: operation.status,
        previousStatusKey: operation.statusKey,
        previousStatusCode: operation.statusCode,
        previousEnabled: operation.enabled,
        previousBlockedByOperationKeys: [...operation.blockedByOperationKeys],
        ...(operation.blockingReason ? { previousBlockingReason: operation.blockingReason } : {}),
        previousAttemptNo: operation.attemptNo,
        previousMaxAttempts: operation.maxAttempts,
        previousStartedAt: operation.startedAt,
        previousCompletedAt: operation.completedAt,
        previousDurationMs: operation.durationMs,
        previousBoundaryVersion: operation.clipBoundaryVersion,
        ...(newBoundaryVersion ? { newBoundaryVersion } : {}),
        previousSourceRange: resolveProcessingOperationInputSourceRange(operation),
        ...(newSourceRange ? { newSourceRange } : {}),
      },
    };
  });
}

export function mergeStudioClipTimelineSnapshotProcessingOperationHistory({
  snapshot,
  processingOperations,
}: {
  snapshot: AutoCutStudioClipTimelineSnapshot;
  processingOperations: readonly StudioClipProcessingOperation[];
}): AutoCutStudioClipTimelineSnapshot {
  const snapshotClipIds = new Set(snapshot.clips.map((clip) => clip.id));
  const operationById = new Map(processingOperations.map((operation) => [operation.id, operation]));
  for (const operation of processingOperations) {
    if (!snapshotClipIds.has(operation.clipId)) {
      operationById.delete(operation.id);
    }
  }
  for (const operation of snapshot.processingOperations) {
    if (snapshotClipIds.has(operation.clipId)) {
      operationById.set(operation.id, operation);
    }
  }
  const orderedProcessingOperations = Array.from(operationById.values()).sort((firstOperation, secondOperation) =>
    firstOperation.clipId.localeCompare(secondOperation.clipId) ||
    firstOperation.operationOrder - secondOperation.operationOrder ||
    firstOperation.id.localeCompare(secondOperation.id)
  );
  return {
    ...snapshot,
    processingOperations: orderedProcessingOperations,
  };
}

export function createStudioClipPreviewRange(clip: StudioClip) {
  return {
    startMs: clip.startMs,
    endMs: clip.endMs,
    loop: true,
  };
}

export function splitSliceReviewSegmentAtTimelinePlayhead({
  reviewSession,
  segmentId,
  splitAtMs: requestedSplitAtMs,
  minEdgeDistanceMs = SMART_SLICE_REVIEW_SPLIT_MIN_EDGE_DISTANCE_MS,
}: {
  reviewSession: AutoCutSliceReviewSession;
  segmentId: string;
  splitAtMs?: number;
  minEdgeDistanceMs?: number;
}): SplitSliceReviewSegmentAtTimelinePlayheadResult | null {
  const segment = reviewSession.segments.find((candidate) => candidate.id === segmentId);
  if (!segment) {
    return null;
  }

  const minEdgeDistance = Math.max(1, Math.round(minEdgeDistanceMs));
  if (segment.endMs <= segment.startMs + minEdgeDistance * 2) {
    return null;
  }

  const minSplitAtMs = segment.startMs + minEdgeDistance;
  const maxSplitAtMs = segment.endMs - minEdgeDistance;
  const requestedMs = typeof requestedSplitAtMs === 'number' && Number.isFinite(requestedSplitAtMs)
    ? Math.round(requestedSplitAtMs)
    : undefined;
  if (requestedMs !== undefined && (requestedMs < minSplitAtMs || requestedMs > maxSplitAtMs)) {
    return null;
  }

  const transcriptBoundaryMs = requestedMs === undefined
    ? segment.transcriptSegments?.find((transcriptSegment) =>
      transcriptSegment.endMs >= minSplitAtMs &&
        transcriptSegment.endMs <= maxSplitAtMs
    )?.endMs
    : undefined;
  const splitAtMs = requestedMs ??
    transcriptBoundaryMs ??
    Math.round((segment.startMs + segment.endMs) / 2);
  if (splitAtMs < minSplitAtMs || splitAtMs > maxSplitAtMs) {
    return null;
  }

  const createdSegmentIds = createSliceReviewSplitSegmentIds(segment.id, splitAtMs);
  const firstSegment = createSliceReviewSegmentForSplitRange({
    segment,
    id: createdSegmentIds[0],
    title: `${segment.title} A`,
    startMs: segment.startMs,
    endMs: splitAtMs,
  });
  const secondSegment = createSliceReviewSegmentForSplitRange({
    segment,
    id: createdSegmentIds[1],
    title: `${segment.title} B`,
    startMs: splitAtMs,
    endMs: segment.endMs,
  });
  const manualEdit: AutoCutSliceManualEdit = {
    id: createAutoCutId('slice-manual-edit'),
    kind: 'split',
    segmentIds: [segment.id],
    createdAt: createAutoCutTimestamp(),
    splitAtMs,
    createdSegmentIds: [...createdSegmentIds],
    reason: requestedMs === undefined
      ? 'manual split at reviewed transcript boundary'
      : 'manual split at timeline playhead',
  };
  const segments = reviewSession.segments.flatMap((candidate) =>
    candidate.id === segment.id ? [firstSegment, secondSegment] : [candidate]
  );
  return {
    reviewSession: createSliceReviewSessionFromSegments(reviewSession, segments, [manualEdit]),
    segments,
    manualEdit,
    splitAtMs,
    createdSegmentIds,
  };
}

function createSliceReviewSplitSegmentIds(
  segmentId: string,
  splitAtMs: number,
): [string, string] {
  const safeSegmentId = segmentId
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '') || 'segment';
  const safeSplitAtMs = Math.max(0, Math.round(splitAtMs));
  return [
    `${safeSegmentId}-split-${safeSplitAtMs}-a`,
    `${safeSegmentId}-split-${safeSplitAtMs}-b`,
  ];
}

function createSliceReviewSegmentFromWorkflowClipBoundaryAdjustment(
  segment: AutoCutSliceReviewSegment,
  clip: StudioClip,
): AutoCutSliceReviewSegment {
  return createSliceReviewSegmentForWorkflowRange({
    segment,
    id: segment.id,
    title: segment.title,
    startMs: clip.startMs,
    endMs: clip.endMs,
    boundaryVersion: clip.boundaryVersion,
  });
}

function normalizeCorrectedSliceReviewSegment(
  segment: AutoCutSliceReviewSegment,
  patch: NonNullable<AutoCutSliceManualEdit['patch']>,
): AutoCutSliceReviewSegment {
  const startMs = normalizeReviewSegmentPatchMs(patch.startMs, segment.startMs);
  const endMs = Math.max(startMs + 1, normalizeReviewSegmentPatchMs(patch.endMs, segment.endMs));
  const boundaryVersion = normalizeReviewSegmentPatchBoundaryVersion(patch.boundaryVersion, segment.boundaryVersion);
  const speechStartMs = normalizeOptionalReviewSegmentPatchMs(patch.speechStartMs, segment.speechStartMs);
  const speechEndMs = normalizeOptionalReviewSegmentPatchMs(patch.speechEndMs, segment.speechEndMs);
  const patchTranscriptText = typeof patch.transcriptText === 'string'
    ? normalizeSmartSliceTranscriptEvidenceText(patch.transcriptText)
    : undefined;
  const transcriptSegments = patchTranscriptText !== undefined
    ? createCorrectedSliceReviewTranscriptSegments(segment, startMs, endMs, patchTranscriptText)
    : patch.startMs !== undefined || patch.endMs !== undefined
      ? filterSliceReviewTranscriptSegmentsForWorkflow(segment, startMs, endMs)
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
        ? { transcriptText: createSliceReviewTranscriptTextForWorkflow(transcriptSegments) }
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

function createSliceReviewSegmentForSplitRange({
  segment,
  id,
  title,
  startMs,
  endMs,
}: {
  segment: AutoCutSliceReviewSegment;
  id: string;
  title: string;
  startMs: number;
  endMs: number;
}): AutoCutSliceReviewSegment {
  return createSliceReviewSegmentForWorkflowRange({
    segment,
    id,
    title,
    startMs,
    endMs,
  });
}

function createSliceReviewSegmentForWorkflowRange({
  segment,
  id,
  title,
  startMs,
  endMs,
  boundaryVersion,
}: {
  segment: AutoCutSliceReviewSegment;
  id: string;
  title: string;
  startMs: number;
  endMs: number;
  boundaryVersion?: number;
}): AutoCutSliceReviewSegment {
  const normalizedStartMs = Math.max(0, Math.round(startMs));
  const normalizedEndMs = Math.max(normalizedStartMs + 1, Math.round(endMs));
  const transcriptSegments = filterSliceReviewTranscriptSegmentsForWorkflow(
    segment,
    normalizedStartMs,
    normalizedEndMs,
  );
  return {
    ...segment,
    id,
    title,
    startMs: normalizedStartMs,
    endMs: normalizedEndMs,
    durationMs: Math.max(1, normalizedEndMs - normalizedStartMs),
    ...(boundaryVersion !== undefined ? { boundaryVersion } : {}),
    ...createSliceReviewSpeechRangeForWorkflow(segment, normalizedStartMs, normalizedEndMs),
    transcriptSegments,
    transcriptText: createSliceReviewTranscriptTextForWorkflow(transcriptSegments),
  };
}

function filterSliceReviewTranscriptSegmentsForWorkflow(
  segment: AutoCutSliceReviewSegment,
  startMs: number,
  endMs: number,
): AutoCutTranscriptSegment[] {
  return (segment.transcriptSegments ?? [])
    .filter((transcriptSegment) => transcriptSegment.endMs > startMs && transcriptSegment.startMs < endMs)
    .map((transcriptSegment) => ({
      ...transcriptSegment,
      startMs: Math.max(startMs, transcriptSegment.startMs),
      endMs: Math.min(endMs, transcriptSegment.endMs),
    }))
    .filter((transcriptSegment) => transcriptSegment.endMs > transcriptSegment.startMs);
}

function createSliceReviewTranscriptTextForWorkflow(
  transcriptSegments: readonly AutoCutTranscriptSegment[],
) {
  return transcriptSegments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function createCorrectedSliceReviewTranscriptSegments(
  segment: AutoCutSliceReviewSegment,
  startMs: number,
  endMs: number,
  transcriptText: string,
) {
  if (!transcriptText) {
    return [];
  }
  const clippedTranscriptSegments = filterSliceReviewTranscriptSegmentsForWorkflow(segment, startMs, endMs);
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

function normalizeReviewSegmentPatchMs(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : Math.max(0, Math.round(fallback));
}

function normalizeOptionalReviewSegmentPatchMs(value: unknown, fallback: number | undefined) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }
  if (typeof fallback === 'number' && Number.isFinite(fallback)) {
    return Math.max(0, Math.round(fallback));
  }
  return undefined;
}

function normalizeReviewSegmentPatchBoundaryVersion(value: unknown, fallback: number | undefined) {
  const version = value ?? fallback;
  return typeof version === 'number' && Number.isFinite(version)
    ? Math.max(1, Math.round(version))
    : 1;
}

function createSliceReviewSpeechRangeForWorkflow(
  segment: AutoCutSliceReviewSegment,
  startMs: number,
  endMs: number,
) {
  const transcriptSegments = filterSliceReviewTranscriptSegmentsForWorkflow(segment, startMs, endMs);
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

function resolveBoundaryEditEventNewSourceRange(event: StudioClipEvent) {
  const startMs = typeof event.payload.newStartMs === 'number' ? Math.round(event.payload.newStartMs) : undefined;
  const endMs = typeof event.payload.newEndMs === 'number' ? Math.round(event.payload.newEndMs) : undefined;
  return startMs !== undefined && endMs !== undefined
    ? { startMs, endMs }
    : undefined;
}

function resolveBoundaryEditEventNewBoundaryVersion(event: StudioClipEvent) {
  return normalizeOptionalStudioClipBoundaryVersion(event.payload.newBoundaryVersion);
}

function clearStudioClipProcessingOperationBlockingReason(
  operation: StudioClipProcessingOperation,
): Omit<StudioClipProcessingOperation, 'blockingReason'> {
  const { blockingReason: _blockingReason, ...operationWithoutBlockingReason } = operation;
  return operationWithoutBlockingReason;
}

function clearStudioClipProcessingOperationLifecycleState(
  operation: Omit<StudioClipProcessingOperation, 'blockingReason'>,
): Omit<StudioClipProcessingOperation, 'blockingReason' | 'startedAt' | 'completedAt' | 'durationMs'> {
  const {
    startedAt: _startedAt,
    completedAt: _completedAt,
    durationMs: _durationMs,
    ...operationWithoutLifecycleState
  } = operation;
  return operationWithoutLifecycleState;
}

function applyStudioClipProcessingOperationReadinessToRecord(
  record: Record<string, unknown> | undefined,
  readiness: StudioClipProcessingOperationReadiness,
): Record<string, unknown> {
  const { blockingReason: _blockingReason, ...recordWithoutBlockingReason } = record ?? {};
  return {
    ...recordWithoutBlockingReason,
    blockedByOperationKeys: [...readiness.blockedByOperationKeys],
    ...(readiness.blockingReason ? { blockingReason: readiness.blockingReason } : {}),
  };
}

function isTerminalStudioClipProcessingOperationStatus(status: ClipProcessingOperationStatus) {
  return status === 'invalidated' || status === 'skipped' || status === 'succeeded';
}

function resolveProcessingOperationInputSourceRange(operation: StudioClipProcessingOperation) {
  return {
    startMs: operation.sourceStartMs,
    endMs: operation.sourceEndMs,
  };
}

function resolveStudioClipProcessingOperationDurationMs(
  operation: StudioClipProcessingOperation,
  completedAt: string,
) {
  if (!operation.startedAt) {
    return 0;
  }
  const startedAtMs = resolveAutoCutTimestampMs(operation.startedAt);
  const completedAtMs = resolveAutoCutTimestampMs(completedAt);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(completedAtMs)) {
    return 0;
  }
  return Math.max(0, completedAtMs - startedAtMs);
}

function createStudioClipFromReviewSegment(
  timeline: StudioTimeline,
  segment: AutoCutSliceReviewSegment,
  index: number,
  engineId: AutoCutSlicingEngineId,
): StudioClip {
  const timestamp = createAutoCutTimestamp();
  const clipId = createStableStudioClipWorkflowId('studio-clip', [timeline.id, segment.id]);
  const sourceRefs = createStudioClipSourceRefs(segment, clipId);
  const boundaryVersion = normalizeStudioClipBoundaryVersion(segment.boundaryVersion);
  return {
    id: clipId,
    timelineId: timeline.id,
    taskId: timeline.taskId,
    ...(timeline.sourceAssetUuid ? { sourceAssetUuid: timeline.sourceAssetUuid } : {}),
    engineId,
    clipType: resolveStudioClipType(engineId),
    status: segment.status === 'selected'
      ? 'selected'
      : segment.status === 'duplicate'
        ? 'duplicate'
        : 'excluded',
    selected: segment.selected && segment.status === 'selected',
    order: index + 1,
    title: segment.title,
    ...(segment.summary ? { summary: segment.summary } : {}),
    startMs: segment.startMs,
    endMs: segment.endMs,
    durationMs: segment.durationMs,
    boundaryVersion,
    ...(segment.speechStartMs !== undefined ? { speechStartMs: segment.speechStartMs } : {}),
    ...(segment.speechEndMs !== undefined ? { speechEndMs: segment.speechEndMs } : {}),
    ...(segment.transcriptText ? { transcriptTextSnapshot: segment.transcriptText } : {}),
    sourceRefs,
    contentUnitIds: [...(segment.contentUnitIds ?? [])],
    speakerIds: [...(segment.speakerIds ?? [])],
    speakerRoles: [...(segment.speakerRoles ?? [])],
    processingPlan: createDefaultClipProcessingPlanForEngine(engineId),
    quality: {
      ...(segment.qualityScore !== undefined ? { qualityScore: segment.qualityScore } : {}),
      ...(segment.continuityScore !== undefined ? { continuityScore: segment.continuityScore } : {}),
      ...(segment.publishabilityScore !== undefined ? { publishabilityScore: segment.publishabilityScore } : {}),
      ...(segment.publishabilityGrade ? { publishabilityGrade: segment.publishabilityGrade } : {}),
    },
    risks: segment.risks.map(createStudioClipRisk),
    preview: {
      sourceStartMs: segment.startMs,
      sourceEndMs: segment.endMs,
      loop: true,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    metadata: {
      reviewSegmentId: segment.id,
      sourceClipIndex: segment.sourceClipIndex,
      boundaryVersion,
    },
  };
}

function createDefaultClipProcessingPlanForEngine(engineId: AutoCutSlicingEngineId): ClipProcessingPlan {
  const disabledOperationKeys = new Set<ClipProcessingOperationKey>();
  if (engineId === 'visual-scene-v1') {
    disabledOperationKeys.add('remove-cough-and-breath-noise');
    disabledOperationKeys.add('filter-repeated-content');
    disabledOperationKeys.add('refine-subtitle-cues');
  }
  if (engineId === 'manual-timeline-v1') {
    disabledOperationKeys.add('check-duplicate-content');
  }
  const operations = AUTOCUT_CLIP_PROCESSING_OPERATION_SEQUENCE.map((operation) => ({
    ...operation,
    enabled: operation.enabled && !disabledOperationKeys.has(operation.key),
    dependencyOperationKeys: [...operation.dependencyOperationKeys],
    requiredInputs: [...operation.requiredInputs],
    producedOutputs: [...operation.producedOutputs],
    ...(operation.metadata ? { metadata: { ...operation.metadata } } : {}),
  }));
  return {
    schema: 'clip.processing.plan.v1',
    mode: 'per-clip-after-boundary-lock',
    operations,
    operationKeys: operations.map((operation) => operation.key),
  };
}

function createStudioClipProcessingOperations(
  timeline: StudioTimeline,
  clip: StudioClip,
): StudioClipProcessingOperation[] {
  return clip.processingPlan.operations.map((operation) => {
    const readiness = resolveStudioClipProcessingOperationReadiness({
      timeline,
      clip,
      operation,
      succeededOperationKeys: new Set<ClipProcessingOperationKey>(),
    });
    const status = readiness.status;
    const lifecycle = createStudioClipProcessingOperationLifecycle(status, clip);
    return {
      id: createStableStudioClipWorkflowId('studio-clip-processing-operation', [
        clip.id,
        clip.boundaryVersion,
        operation.order,
        operation.key,
        clip.startMs,
        clip.endMs,
      ]),
      timelineId: timeline.id,
      clipId: clip.id,
      taskId: clip.taskId,
      ...(clip.workflowRunId ? { workflowRunId: clip.workflowRunId } : {}),
      operationKey: operation.key,
      operationOrder: operation.order,
      executionStage: operation.executionStage,
      dependencyOperationKeys: [...operation.dependencyOperationKeys],
      blockedByOperationKeys: [...readiness.blockedByOperationKeys],
      ...(readiness.blockingReason ? { blockingReason: readiness.blockingReason } : {}),
      status,
      statusKey: status,
      statusCode: CLIP_PROCESSING_OPERATION_STATUS_CODE[status],
      enabled: status === 'pending',
      attemptNo: lifecycle.attemptNo,
      maxAttempts: AUTOCUT_CLIP_PROCESSING_OPERATION_MAX_ATTEMPTS,
      ...(lifecycle.startedAt ? { startedAt: lifecycle.startedAt } : {}),
      ...(lifecycle.completedAt ? { completedAt: lifecycle.completedAt } : {}),
      ...(lifecycle.durationMs !== undefined ? { durationMs: lifecycle.durationMs } : {}),
      clipBoundaryVersion: clip.boundaryVersion,
      sourceStartMs: clip.startMs,
      sourceEndMs: clip.endMs,
      sourceDurationMs: clip.durationMs,
      input: {
        clipBoundaryVersion: clip.boundaryVersion,
        sourceStartMs: clip.startMs,
        sourceEndMs: clip.endMs,
        executionStage: operation.executionStage,
        dependencyOperationKeys: [...operation.dependencyOperationKeys],
        blockedByOperationKeys: [...readiness.blockedByOperationKeys],
        ...(readiness.blockingReason ? { blockingReason: readiness.blockingReason } : {}),
        dependencyReadinessMode: 'canonical-operation-dag',
        requiredInputs: [...operation.requiredInputs],
      },
      createdAt: clip.createdAt,
      updatedAt: clip.updatedAt,
      metadata: {
        clipBoundaryVersion: clip.boundaryVersion,
        executionStage: operation.executionStage,
        dependencyOperationKeys: [...operation.dependencyOperationKeys],
        blockedByOperationKeys: [...readiness.blockedByOperationKeys],
        ...(readiness.blockingReason ? { blockingReason: readiness.blockingReason } : {}),
        dependencyReadinessMode: 'canonical-operation-dag',
        parallelGroup: operation.parallelGroup,
        producedOutputs: [...operation.producedOutputs],
      },
    };
  });
}

function createStudioClipProcessingOperationLifecycle(
  status: ClipProcessingOperationStatus,
  clip: StudioClip,
): Pick<StudioClipProcessingOperation, 'attemptNo' | 'startedAt' | 'completedAt' | 'durationMs'> {
  if (status === 'succeeded') {
    return {
      attemptNo: 1,
      startedAt: clip.updatedAt,
      completedAt: clip.updatedAt,
      durationMs: 0,
    };
  }
  if (status === 'skipped' || status === 'invalidated' || status === 'failed') {
    return {
      attemptNo: 0,
      completedAt: clip.updatedAt,
      durationMs: 0,
    };
  }
  return {
    attemptNo: 0,
  };
}

export function reconcileStudioClipProcessingOperationReadiness({
  timeline,
  clip,
  processingOperations,
}: {
  timeline: StudioTimeline;
  clip: StudioClip;
  processingOperations: readonly StudioClipProcessingOperation[];
}): StudioClipProcessingOperation[] {
  const succeededOperationKeys = new Set<ClipProcessingOperationKey>(
    processingOperations
      .filter((operation) => operation.clipId === clip.id && operation.status === 'succeeded')
      .map((operation) => operation.operationKey),
  );
  return processingOperations.map((operation) => {
    if (operation.clipId !== clip.id || isTerminalStudioClipProcessingOperationStatus(operation.status)) {
      return operation;
    }
    const planOperation = clip.processingPlan.operations.find((candidate) => candidate.key === operation.operationKey);
    if (!planOperation) {
      return operation;
    }
    const readiness = resolveStudioClipProcessingOperationReadiness({
      timeline,
      clip,
      operation: planOperation,
      succeededOperationKeys,
    });
    const lifecycle = createStudioClipProcessingOperationLifecycle(readiness.status, clip);
    const operationWithoutBlockingReason = clearStudioClipProcessingOperationBlockingReason(operation);
    const operationWithoutTransientState = clearStudioClipProcessingOperationLifecycleState(
      operationWithoutBlockingReason,
    );
    return {
      ...operationWithoutTransientState,
      status: readiness.status,
      statusKey: readiness.status,
      statusCode: CLIP_PROCESSING_OPERATION_STATUS_CODE[readiness.status],
      enabled: readiness.status === 'pending',
      blockedByOperationKeys: [...readiness.blockedByOperationKeys],
      ...(readiness.blockingReason ? { blockingReason: readiness.blockingReason } : {}),
      attemptNo: lifecycle.attemptNo,
      ...(lifecycle.startedAt ? { startedAt: lifecycle.startedAt } : {}),
      ...(lifecycle.completedAt ? { completedAt: lifecycle.completedAt } : {}),
      ...(lifecycle.durationMs !== undefined ? { durationMs: lifecycle.durationMs } : {}),
      updatedAt: clip.updatedAt,
      input: {
        ...applyStudioClipProcessingOperationReadinessToRecord(operation.input, readiness),
        dependencyReadinessMode: 'canonical-operation-dag',
      },
      metadata: {
        ...applyStudioClipProcessingOperationReadinessToRecord(operation.metadata, readiness),
        dependencyReadinessMode: 'canonical-operation-dag',
      },
    };
  });
}

function resolveStudioTimelineStatus(reviewSession: AutoCutSliceReviewSession): StudioTimeline['status'] {
  if (reviewSession.status === 'rendered') {
    return 'rendered';
  }
  if (reviewSession.status === 'rendering') {
    return 'rendering';
  }
  if (reviewSession.status === 'ready_for_render') {
    return 'ready_for_render';
  }
  return 'draft';
}

function resolveStudioClipProcessingOperationReadiness({
  timeline,
  clip,
  operation,
  succeededOperationKeys,
}: {
  timeline: StudioTimeline;
  clip: StudioClip;
  operation: ClipProcessingOperationPlanItem;
  succeededOperationKeys: ReadonlySet<ClipProcessingOperationKey>;
}): StudioClipProcessingOperationReadiness {
  if (!clip.selected || clip.status !== 'selected' || !operation.enabled) {
    return {
      status: 'skipped',
      blockedByOperationKeys: [],
    };
  }
  if (timeline.status === 'rendered') {
    return {
      status: 'succeeded',
      blockedByOperationKeys: [],
    };
  }
  if (timeline.status === 'ready_for_render' || timeline.status === 'rendering') {
    const blockedByOperationKeys = operation.dependencyOperationKeys.filter((operationKey) =>
      !succeededOperationKeys.has(operationKey)
    );
    if (blockedByOperationKeys.length > 0) {
      return {
        status: 'blocked',
        blockedByOperationKeys,
        blockingReason: 'waiting-for-dependencies',
      };
    }
    return {
      status: 'pending',
      blockedByOperationKeys: [],
    };
  }
  return {
    status: 'blocked',
    blockedByOperationKeys: [...operation.dependencyOperationKeys],
    blockingReason: 'timeline-not-ready',
  };
}

function resolveStudioClipType(engineId: AutoCutSlicingEngineId): StudioClipType {
  return getAutoCutClipWorkflowTemplate(engineId).clipType;
}

function normalizeStudioClipBoundaryVersion(version: unknown) {
  return normalizeOptionalStudioClipBoundaryVersion(version) ?? 1;
}

function normalizeOptionalStudioClipBoundaryVersion(version: unknown) {
  if (typeof version !== 'number' || !Number.isFinite(version)) {
    return undefined;
  }
  return Math.max(1, Math.round(version));
}

function createStudioClipSourceRefs(segment: AutoCutSliceReviewSegment, clipId: string): StudioClipSourceRef[] {
  return [
    ...segment.contentUnitIds.map((contentUnitId, index) => ({
      id: createStableStudioClipWorkflowId('studio-clip-source-ref', [clipId, 'content-unit', index + 1, contentUnitId]),
      clipId,
      sourceType: 'content_unit' as const,
      sourceId: contentUnitId,
      sourceIndex: index,
      startMs: segment.startMs,
      endMs: segment.endMs,
      coverageRatio: 1,
    })),
    ...(segment.transcriptSegments ?? []).map((transcriptSegment, index) => ({
      id: createStableStudioClipWorkflowId('studio-clip-source-ref', [clipId, 'text-segment', index + 1]),
      clipId,
      sourceType: 'text_segment' as const,
      sourceId: `${segment.id}-text-${index + 1}`,
      sourceIndex: index,
      startMs: transcriptSegment.startMs,
      endMs: transcriptSegment.endMs,
      coverageRatio: 1,
      metadata: {
        text: transcriptSegment.text,
        speaker: transcriptSegment.speaker,
      },
    })),
  ];
}

function createStudioClipRisk(code: string): StudioClipRisk {
  return {
    code,
    severity: code.includes('missing') || code.includes('broken') ? 'warning' : 'info',
  };
}

function resolveReviewSessionEndMs(reviewSession: AutoCutSliceReviewSession) {
  return reviewSession.segments.reduce((maxEndMs, segment) => Math.max(maxEndMs, segment.endMs), 0);
}
