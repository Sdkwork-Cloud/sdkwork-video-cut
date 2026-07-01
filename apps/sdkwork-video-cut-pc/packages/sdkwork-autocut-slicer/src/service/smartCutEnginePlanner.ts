import {
  createSmartCutSpeechFirstExecutionPackage,
  createSmartCutVisualSceneExecutionPackage,
  SMART_CUT_STANDARD_VERSION,
  type SmartCutCandidate,
  type SmartCutContentUnit,
  type SmartCutExecutionPackageBlocker,
  type SmartCutMediaKind,
  type SmartCutProductPresetId,
  type SmartCutSourceMedia,
  type SmartCutSpeakerEvidence,
  type SmartCutSpeakerProfile,
  type SmartCutSpeakerRole,
  type SmartCutSpeakerSegment,
  type SmartCutTranscriptEvidence,
  type SmartCutTranscriptSegment,
  type SmartCutVisualEvidence,
  type SmartCutVisualEvidenceQualityValidationReport,
} from '@sdkwork/autocut-smart-cut-engine';
import {
  getAutoCutSmartSliceSegmentationAgentDefinition,
  type AutoCutSmartSliceSegmentationAgentDefinition,
  type AutoCutSmartSliceSegmentationAgentId,
  type VideoSliceParams,
} from '@sdkwork/autocut-types';
import type {
  AutoCutOpenAiCompatibleChatCompletionResult,
  AutoCutSpeechTranscriptionSegment,
  AutoCutVisualEvidenceExtractionResult,
} from '@sdkwork/autocut-services';
import {
  getVideoSlicePlanningPolicy,
  isAutoCutNgOrRetakeTranscriptText,
  isEligibleSmartSliceTranscriptCoverageText,
  normalizeSliceDurationMs,
  normalizeSmartSlicePlanRenderedTimelineForNativeRender,
  normalizeSmartSliceTranscriptEvidenceText,
  type NormalizedSlicePlanClip,
  type SmartSliceSourceSegment,
} from './slicePlanner.ts';

const SMART_CUT_LLM_REVIEW_SCHEMA_VERSION = 'smart-cut-llm-review/v1' as const;
const SMART_CUT_LLM_REVIEW_KIND = 'candidate-id-semantic-segmentation-review' as const;

export type SmartCutEngineLlmReviewCreator = (input: SmartCutEngineLlmReviewInput) => Promise<unknown>;

export interface SmartCutEngineLlmReviewInput {
  model: string;
  presetId: SmartCutProductPresetId;
  customKeywords: readonly string[];
  contentUnits: readonly SmartCutContentUnit[];
  candidates: readonly SmartCutCandidate[];
  segmentationAgentId?: AutoCutSmartSliceSegmentationAgentId;
  segmentationAgent?: AutoCutSmartSliceSegmentationAgentDefinition;
  rules?: readonly string[];
}

interface SmartCutEngineLlmReviewTimeSlicePayload {
  timeSliceId: string;
  candidateId: string;
  sourceStartMs: number;
  sourceEndMs: number;
  durationMs: number;
  contentUnitIds: readonly string[];
  speakerIds: readonly string[];
  speakerRoles: readonly string[];
  speakerTurnIds: readonly string[];
}

interface SmartCutEngineLlmReviewSpeakerPayload {
  speakerId: string;
  roles: readonly string[];
  displayName: string;
  contentUnitIds: readonly string[];
  timeSliceIds: readonly string[];
  speakerTurnIds: readonly string[];
}

interface SmartCutEngineLlmReviewSpeakerTurnPayload {
  speakerTurnId: string;
  speakerId: string;
  speakerRole: string;
  sourceStartMs: number;
  sourceEndMs: number;
  durationMs: number;
  contentUnitIds: readonly string[];
  timeSliceIds: readonly string[];
}

export interface CreateSmartCutEngineSlicePlanInput {
  params: VideoSliceParams;
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[];
  visualEvidence?: SmartCutVisualEvidence;
  sourceAssetUuid?: string;
  sourceDurationMs?: number;
  targetCandidateCount?: number;
  llmReview?: SmartCutEngineLlmReviewCreator;
}

export interface SmartCutEngineSlicePlanResult {
  clips: NormalizedSlicePlanClip[];
  presetId: SmartCutProductPresetId;
  transcriptEvidence: SmartCutTranscriptEvidence;
  speakerEvidence: SmartCutSpeakerEvidence;
  visualEvidence?: SmartCutVisualEvidence;
  visualEvidenceQuality?: SmartCutVisualEvidenceQualityValidationReport;
  blockers: readonly SmartCutExecutionPackageBlocker[];
  llmReviewAudit?: SmartCutEngineLlmReviewAudit;
  usedFallback?: boolean;
  fallbackReason?: string | undefined;
}

export interface SmartCutEngineLlmReviewAudit {
  schema: 'smart-cut-engine.llm-review-audit.v1';
  model: string;
  presetId: SmartCutProductPresetId;
  segmentationAgent: Pick<AutoCutSmartSliceSegmentationAgentDefinition, 'id' | 'label' | 'description' | 'systemPrompt'>;
  rules: readonly string[];
  input: {
    contentUnits: readonly SmartCutContentUnit[];
    candidates: readonly SmartCutCandidate[];
  };
  rawProjectedReview: unknown;
  normalizedReview: unknown;
  finalPackage: unknown;
}

export function createSmartCutVisualEvidenceFromNativeResult(
  result: AutoCutVisualEvidenceExtractionResult,
): SmartCutVisualEvidence {
  return {
    kind: 'visual',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    provider: result.provider,
    profile: result.profile,
    shots: result.shots.map((shot) => ({
      id: shot.id,
      startMs: Math.round(shot.startMs),
      endMs: Math.round(shot.endMs),
      confidence: shot.confidence,
      boundarySource: result.provider === 'ffmpeg-scene' ? 'ffmpeg-scene' : 'model',
    })),
    sceneBoundaries: result.sceneBoundaries.map((sceneBoundary) => ({
      startMs: Math.round(sceneBoundary.startMs),
      endMs: Math.round(sceneBoundary.endMs),
    })),
    ...(result.frameQuality !== undefined
      ? {
        frameQuality: result.frameQuality.map((sample) => ({
          atMs: Math.round(sample.atMs),
          blurScore: sample.blurScore,
          exposureScore: sample.exposureScore,
          stabilityScore: sample.stabilityScore,
        })),
      }
      : {}),
  };
}

export class SmartCutEngineSlicePlanningError extends Error {
  readonly blockers: readonly SmartCutExecutionPackageBlocker[];

  constructor(message: string, blockers: readonly SmartCutExecutionPackageBlocker[]) {
    const blockerCodes = blockers.map((blocker) => blocker.code).filter(Boolean);
    super(blockerCodes.length > 0 ? `${message} Blockers: ${blockerCodes.join(', ')}.` : message);
    this.name = 'SmartCutEngineSlicePlanningError';
    this.blockers = blockers;
  }
}

interface SpeakerRangeAccumulator {
  speakerId: string;
  startMs: number;
  endMs: number;
}

const minimumSourceDurationMs = 5_000;
const minimumRenderableSpeechDurationMs = 1_000;
const defaultTranscriptConfidence = 0.92;
const defaultSpeakerConfidence = 0.9;
const defaultLanguage = 'zh-CN';
const maximumRetakeFilterTailExtensionMs = 350;
const maximumLlmReviewPromptContentUnits = 80;
const visualOrAudioNativePresetIds = new Set<SmartCutProductPresetId>([
  'film-scene-index',
  'documentary-story-chapters',
  'music-beat-clips',
  'sports-highlight-reel',
  'gaming-highlight-reel',
  'screen-recording-tutorial',
]);

export async function createSmartCutEngineSlicePlan(
  input: CreateSmartCutEngineSlicePlanInput,
): Promise<SmartCutEngineSlicePlanResult> {
  const sourceDurationMs = resolveSourceDurationMs(input);
  if (sourceDurationMs < minimumSourceDurationMs) {
    throw new SmartCutEngineSlicePlanningError(
      'Smart Cut Engine requires a source video of at least 5 seconds before semantic slicing.',
      [{
        code: 'SOURCE_TOO_SHORT',
        message: `Source video duration ${sourceDurationMs}ms is too short for semantic slicing.`,
        remediation: 'Provide a longer source video before running Smart Cut Engine slicing.',
        source: 'evidence-quality',
      }],
    );
  }

  const transcriptEvidence = createSmartCutTranscriptEvidence(input.transcriptSegments, sourceDurationMs);
  const presetId = resolveSmartCutProductPresetId(input.params, transcriptEvidence);
  const sourceMedia = createSmartCutSourceMedia(input, presetId, sourceDurationMs);
  const maximumCandidateDurationMs = normalizeSliceDurationMs(input.params.maxDuration);
  const maximumCandidateGapMs = resolveSmartCutEngineMaximumCandidateGapMs(input.params);
  if (presetId === 'film-scene-index') {
    return createSmartCutEngineVisualSceneSlicePlan({
      input,
      sourceMedia,
      sourceDurationMs,
      presetId,
      transcriptEvidence,
    });
  }

  const speakerEvidence = createSmartCutSpeakerEvidence(transcriptEvidence, presetId);
  const preflightBlockers = validateSmartCutEnginePlannerEvidence({
    transcriptEvidence,
    speakerEvidence,
    presetId,
    ...(input.visualEvidence !== undefined ? { visualEvidence: input.visualEvidence } : {}),
  });
  if (preflightBlockers.length > 0) {
    throw new SmartCutEngineSlicePlanningError(
      'Smart Cut Engine requires canonical transcript and speaker evidence before semantic slicing.',
      preflightBlockers,
    );
  }

  const dryRun = createSmartCutSpeechFirstExecutionPackage({
    runId: createSmartCutRunId(input, 'candidate-build'),
    sourceMedia,
    presetId,
    transcriptEvidence,
    speakerEvidence,
    maximumCandidateDurationMs,
    maximumCandidateGapMs,
    llmReviewModel: input.params.llmModel,
    rawLlmReview: {
      rankedCandidateIds: [],
      referencedUnitIds: [],
      reviewNotes: [],
    },
  });
  const candidateBuildBlockers = dryRun.blockers.filter((blocker) =>
    blocker.source !== 'llm-review' &&
      blocker.code !== 'LLM_REVIEW_SELECTED_CANDIDATE_NOT_REFERENCED' &&
      blocker.code !== 'LLM_REVIEW_SELECTED_UNIT_NOT_REFERENCED' &&
      blocker.code !== 'LLM_REVIEW_REPORT_BLOCKED'
  );
  if (candidateBuildBlockers.length > 0 || dryRun.plan.candidates.length === 0 || dryRun.plan.contentUnitBuildReport.units.length === 0) {
    throw new SmartCutEngineSlicePlanningError(
      'Smart Cut Engine could not build executable semantic candidates from transcript and speaker evidence.',
      candidateBuildBlockers.length > 0 ? candidateBuildBlockers : dryRun.blockers,
    );
  }

  const llmReviewProjection = createSmartCutEngineLlmReviewProjection({
    candidates: dryRun.plan.candidates,
    contentUnits: dryRun.plan.contentUnitBuildReport.units,
    customKeywords: normalizeSmartCutCustomKeywords(input.params.customKeywords),
  });
  const segmentationAgent = getAutoCutSmartSliceSegmentationAgentDefinition(input.params.segmentationAgentId);
  const llmReviewRules = createSmartCutEngineLlmReviewRules(segmentationAgent);
  let rawProjectedLlmReview: { rankedCandidateIds: string[]; referencedUnitIds: string[]; reviewNotes: string[] };
  let usedLlmFallback = false;
  let llmFallbackReason: string | undefined;
  if (input.llmReview) {
    try {
      const LLM_REVIEW_TIMEOUT_MS = 30_000;
      const llmResultPromise = input.llmReview({
        model: input.params.llmModel,
        presetId,
        customKeywords: normalizeSmartCutCustomKeywords(input.params.customKeywords),
        contentUnits: llmReviewProjection.contentUnits,
        candidates: llmReviewProjection.candidates,
        segmentationAgentId: segmentationAgent.id,
        segmentationAgent,
        rules: llmReviewRules,
      });
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`LLM review timed out after ${LLM_REVIEW_TIMEOUT_MS}ms`)), LLM_REVIEW_TIMEOUT_MS);
      });
      try {
        const rawResult = await Promise.race([llmResultPromise, timeoutPromise]);
        rawProjectedLlmReview = validateSmartCutEngineLlmReviewResult(rawResult);
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
      }
    } catch (llmError) {
      usedLlmFallback = true;
      llmFallbackReason = llmError instanceof Error && llmError.message.includes('timed out')
        ? 'llm-review-timeout'
        : 'llm-review-error';
      rawProjectedLlmReview = createDeterministicSmartCutLlmReview(
        dryRun.plan.candidates,
        dryRun.plan.contentUnitBuildReport.units,
        normalizeSmartCutCustomKeywords(input.params.customKeywords),
      );
      rawProjectedLlmReview.reviewNotes = [
        ...(rawProjectedLlmReview.reviewNotes ?? []),
        `LLM review call failed (${llmError instanceof Error ? llmError.message : String(llmError)}); falling back to deterministic review.`,
      ];
    }
  } else {
    rawProjectedLlmReview = createDeterministicSmartCutLlmReview(
      dryRun.plan.candidates,
      dryRun.plan.contentUnitBuildReport.units,
      normalizeSmartCutCustomKeywords(input.params.customKeywords),
    );
  }
  const rawLlmReview = input.llmReview
    ? createCompleteSmartCutEngineExecutionLlmReview(
      rawProjectedLlmReview,
      dryRun.plan.candidates,
      dryRun.plan.contentUnitBuildReport.units,
    )
    : rawProjectedLlmReview;
  const finalPackage = createSmartCutSpeechFirstExecutionPackage({
    runId: createSmartCutRunId(input, 'execution'),
    sourceMedia,
    presetId,
    transcriptEvidence,
    speakerEvidence,
    maximumCandidateDurationMs,
    maximumCandidateGapMs,
    llmReviewModel: input.params.llmModel,
    rawLlmReview,
    ...(input.targetCandidateCount !== undefined ? { targetCandidateCount: input.targetCandidateCount } : {}),
  });
  if (!finalPackage.ready) {
    throw new SmartCutEngineSlicePlanningError(
      'Smart Cut Engine blocked semantic slicing before filters or render.',
      finalPackage.blockers,
    );
  }

  const publishBatchCandidates = selectSmartCutEnginePublishBatchCandidates(
    finalPackage.executionPackage.candidateSelection.selectedCandidates,
    finalPackage.plan.contentUnitBuildReport.units,
    input.targetCandidateCount,
  );
  const clips = normalizeSmartSlicePlanRenderedTimelineForNativeRender(
    publishBatchCandidates
      .map((candidate, index) => createSmartCutEngineSliceClip({
        index,
        candidate,
        presetId,
        runId: finalPackage.executionPackage.runId,
        planId: finalPackage.plan.id,
        contentUnits: finalPackage.plan.contentUnitBuildReport.units,
        transcriptEvidence,
        params: input.params,
      })),
    getVideoSlicePlanningPolicy({
      ...input.params,
      sourceDurationMs,
    }),
  ).map((clip) => applySmartCutTranscriptPostSliceFilters(clip, transcriptEvidence));
  const renderableClips = clips.filter(isRenderableSmartCutEngineClip);
  if (renderableClips.length === 0) {
    throw new SmartCutEngineSlicePlanningError(
      'AutoCut transcript speech has no renderable timestamped segment.',
      [{
        code: 'NO_RENDERABLE_TRANSCRIPT_SEGMENT',
        message: 'Smart Cut Engine produced only transcript-backed speech windows shorter than the native renderable speech floor.',
        remediation: 'Merge adjacent semantic units with complete context, or rerun speech-to-text when segment timestamps are too fragmented.',
        source: 'candidate-validation',
      }],
    );
  }

  return {
    clips: renderableClips.map((clip, index) => ({ ...clip, index })),
    presetId,
    transcriptEvidence,
    speakerEvidence: finalPackage.speakerAlignment.speakerEvidence,
    blockers: finalPackage.blockers,
    ...(usedLlmFallback ? { usedFallback: true, fallbackReason: llmFallbackReason } : {}),
    llmReviewAudit: {
      schema: 'smart-cut-engine.llm-review-audit.v1',
      model: input.params.llmModel,
      presetId,
      segmentationAgent: {
        id: segmentationAgent.id,
        label: segmentationAgent.label,
        description: segmentationAgent.description,
        systemPrompt: segmentationAgent.systemPrompt,
      },
      rules: llmReviewRules,
      input: {
        contentUnits: llmReviewProjection.contentUnits,
        candidates: llmReviewProjection.candidates,
      },
      rawProjectedReview: rawProjectedLlmReview,
      normalizedReview: rawLlmReview,
      finalPackage,
    },
  };
}

function selectSmartCutEnginePublishBatchCandidates(
  candidates: readonly SmartCutCandidate[],
  contentUnits: readonly SmartCutContentUnit[],
  targetCandidateCount: number | undefined,
): readonly SmartCutCandidate[] {
  const dedupedCandidates = createRepeatFilteredSmartCutCandidates(candidates, contentUnits);
  if (targetCandidateCount === undefined || targetCandidateCount >= dedupedCandidates.length) {
    return dedupedCandidates;
  }
  return dedupedCandidates.slice(0, Math.max(1, Math.floor(targetCandidateCount)));
}

function createSmartCutEngineLlmReviewProjection({
  candidates,
  contentUnits,
  customKeywords,
}: {
  candidates: readonly SmartCutCandidate[];
  contentUnits: readonly SmartCutContentUnit[];
  customKeywords: readonly string[];
}): { candidates: readonly SmartCutCandidate[]; contentUnits: readonly SmartCutContentUnit[] } {
  const projectedCandidates = createSmartCutEngineReviewCandidates({
    candidates: createRepeatFilteredSmartCutCandidates(candidates, contentUnits),
    contentUnits,
  });
  const projectedUnitIds = selectSmartCutEngineLlmReviewContentUnitIds(
    projectedCandidates,
    contentUnits,
    customKeywords,
  );
  const projectedUnitIdSet = new Set(projectedUnitIds);
  const projectedContentUnits = contentUnits.filter((unit) => projectedUnitIdSet.has(unit.id));
  const projectedContentUnitIds = new Set(projectedContentUnits.map((unit) => unit.id));
  return {
    candidates: projectedCandidates.filter((candidate) =>
      candidate.unitIds.every((unitId) => projectedContentUnitIds.has(unitId))
    ),
    contentUnits: projectedContentUnits,
  };
}

function createSmartCutEngineReviewCandidates({
  candidates,
  contentUnits,
}: {
  candidates: readonly SmartCutCandidate[];
  contentUnits: readonly SmartCutContentUnit[];
}): readonly SmartCutCandidate[] {
  const contentUnitById = new Map(contentUnits.map((unit) => [unit.id, unit]));
  return candidates.map((candidate) => {
    const speechDurationMs = Math.max(0, candidate.endMs - candidate.startMs);
    const unitCount = candidate.unitIds.length;
    const risks = uniqueStrings([
      ...candidate.risks,
      ...(unitCount <= 1 || speechDurationMs < 10_000 ? ['sparse-transcript-speech'] : []),
    ]);
    const units = candidate.unitIds
      .map((unitId) => contentUnitById.get(unitId))
      .filter((unit): unit is SmartCutContentUnit => unit !== undefined);
    const title = candidate.title || createSmartCutCandidateReviewTitle(units);
    return {
      ...candidate,
      title,
      risks,
    };
  });
}

function createCompleteSmartCutEngineExecutionLlmReview(
  projectedReview: unknown,
  candidates: readonly SmartCutCandidate[],
  contentUnits: readonly SmartCutContentUnit[],
): { rankedCandidateIds: string[]; referencedUnitIds: string[]; reviewNotes: string[] } {
  const projectedReviewRecord = isSmartCutEngineRecord(projectedReview) ? projectedReview : {};
  const candidateIdSet = new Set(candidates.map((candidate) => candidate.id));
  const unitIdSet = new Set(contentUnits.map((unit) => unit.id));
  const rankedCandidateIds = uniqueStrings([
    ...readSmartCutEngineStringArray(projectedReviewRecord.rankedCandidateIds),
    ...candidates.map((candidate) => candidate.id),
  ]).filter((candidateId) => candidateIdSet.has(candidateId));
  const referencedUnitIds = uniqueStrings([
    ...readSmartCutEngineStringArray(projectedReviewRecord.referencedUnitIds),
    ...candidates.flatMap((candidate) => candidate.unitIds),
  ]).filter((unitId) => unitIdSet.has(unitId));
  const reviewNotes = [
    ...readSmartCutEngineStringArray(projectedReviewRecord.reviewNotes),
    'Service expanded bounded ID-only LLM review to complete engine candidate/unit coverage without changing timestamps.',
  ];
  return {
    rankedCandidateIds,
    referencedUnitIds,
    reviewNotes: uniqueStrings(reviewNotes),
  };
}

function createRepeatFilteredSmartCutCandidates(
  candidates: readonly SmartCutCandidate[],
  contentUnits: readonly SmartCutContentUnit[],
): readonly SmartCutCandidate[] {
  const contentUnitById = new Map(contentUnits.map((unit) => [unit.id, unit]));
  const bestCandidateByTextKey = new Map<string, SmartCutCandidate>();
  const duplicateKeys = new Set<string>();

  for (const candidate of candidates) {
    const textKey = createSmartCutCandidateRepeatKey(candidate, contentUnitById);
    if (!textKey) {
      continue;
    }
    const existingCandidate = bestCandidateByTextKey.get(textKey);
    if (existingCandidate === undefined) {
      bestCandidateByTextKey.set(textKey, candidate);
      continue;
    }
    duplicateKeys.add(textKey);
    if (compareRepeatCandidatePreference(candidate, existingCandidate) < 0) {
      bestCandidateByTextKey.set(textKey, candidate);
    }
  }

  if (duplicateKeys.size === 0) {
    return candidates;
  }

  const selectedCandidateIds = new Set(Array.from(bestCandidateByTextKey.values(), (candidate) => candidate.id));
  return candidates
    .filter((candidate) => {
      const textKey = createSmartCutCandidateRepeatKey(candidate, contentUnitById);
      return !textKey || !duplicateKeys.has(textKey) || selectedCandidateIds.has(candidate.id);
    })
    .map((candidate) => {
      const textKey = createSmartCutCandidateRepeatKey(candidate, contentUnitById);
      return textKey && duplicateKeys.has(textKey)
        ? { ...candidate, risks: uniqueStrings([...candidate.risks, 'transcript-repeat-filtered']) }
        : candidate;
    });
}

function createSmartCutCandidateRepeatKey(
  candidate: SmartCutCandidate,
  contentUnitById: ReadonlyMap<string, SmartCutContentUnit>,
): string {
  const text = normalizeSmartCutKeywordText(
    candidate.unitIds
      .map((unitId) => contentUnitById.get(unitId)?.text ?? '')
      .join(' '),
  );
  return text.length >= 12 ? text : '';
}

function compareRepeatCandidatePreference(
  left: SmartCutCandidate,
  right: SmartCutCandidate,
): number {
  return right.confidence - left.confidence ||
    (left.endMs - left.startMs) - (right.endMs - right.startMs) ||
    left.startMs - right.startMs ||
    left.id.localeCompare(right.id);
}

function selectSmartCutEngineLlmReviewContentUnitIds(
  candidates: readonly SmartCutCandidate[],
  contentUnits: readonly SmartCutContentUnit[],
  customKeywords: readonly string[],
): readonly string[] {
  const candidateUnitIds = uniqueStrings(candidates.flatMap((candidate) => candidate.unitIds));
  if (candidateUnitIds.length <= maximumLlmReviewPromptContentUnits) {
    return candidateUnitIds;
  }

  const candidateUnitIdSet = new Set(candidateUnitIds);
  const orderedCandidateUnits = contentUnits.filter((unit) => candidateUnitIdSet.has(unit.id));
  const contentUnitById = new Map(orderedCandidateUnits.map((unit) => [unit.id, unit]));
  const requiredIds = new Set<string>();

  addSmartCutEngineLlmReviewUnitId(requiredIds, orderedCandidateUnits[0]);
  addSmartCutEngineLlmReviewUnitId(requiredIds, orderedCandidateUnits.at(-1));

  for (const keyword of customKeywords) {
    for (const unit of orderedCandidateUnits) {
      if (requiredIds.size >= maximumLlmReviewPromptContentUnits) {
        break;
      }
      if (normalizeSmartCutKeywordText(unit.text ?? '').includes(keyword)) {
        requiredIds.add(unit.id);
      }
    }
  }

  const semanticPriorityUnits = candidates
    .flatMap((candidate) =>
      candidate.unitIds
        .map((unitId) => contentUnitById.get(unitId))
        .filter((unit): unit is SmartCutContentUnit => unit !== undefined)
    )
    .filter((unit, index, units) => units.findIndex((candidateUnit) => candidateUnit.id === unit.id) === index)
    .sort(compareSmartCutLlmReviewUnitPriority);
  for (const unit of semanticPriorityUnits) {
    if (requiredIds.size >= maximumLlmReviewPromptContentUnits) {
      break;
    }
    requiredIds.add(unit.id);
  }

  while (requiredIds.size < maximumLlmReviewPromptContentUnits) {
    const slotsRemaining = maximumLlmReviewPromptContentUnits - requiredIds.size;
    const unselectedUnits = orderedCandidateUnits.filter((unit) => !requiredIds.has(unit.id));
    if (unselectedUnits.length === 0) {
      break;
    }
    const stride = Math.max(1, Math.floor(unselectedUnits.length / slotsRemaining));
    let addedThisPass = 0;
    for (let index = 0; index < unselectedUnits.length && requiredIds.size < maximumLlmReviewPromptContentUnits; index += stride) {
      const unit = unselectedUnits[index];
      if (unit === undefined) {
        continue;
      }
      requiredIds.add(unit.id);
      addedThisPass += 1;
    }
    if (addedThisPass === 0) {
      break;
    }
  }

  for (let index = orderedCandidateUnits.length - 1; index >= 0 && requiredIds.size < maximumLlmReviewPromptContentUnits; index -= 1) {
    const unit = orderedCandidateUnits[index];
    if (unit !== undefined) {
      requiredIds.add(unit.id);
    }
  }

  return orderedCandidateUnits
    .filter((unit) => requiredIds.has(unit.id))
    .map((unit) => unit.id);
}

function addSmartCutEngineLlmReviewUnitId(
  unitIds: Set<string>,
  unit: SmartCutContentUnit | undefined,
) {
  if (unit !== undefined && unitIds.size < maximumLlmReviewPromptContentUnits) {
    unitIds.add(unit.id);
  }
}

function compareSmartCutLlmReviewUnitPriority(
  left: SmartCutContentUnit,
  right: SmartCutContentUnit,
): number {
  return scoreSmartCutLlmReviewUnitPriority(right) - scoreSmartCutLlmReviewUnitPriority(left) ||
    left.startMs - right.startMs ||
    left.id.localeCompare(right.id);
}

function scoreSmartCutLlmReviewUnitPriority(unit: SmartCutContentUnit): number {
  const text = normalizeSmartCutKeywordText(unit.text ?? '');
  let score = (unit.publishabilityScore ?? 0) * 4 + (unit.completenessScore ?? 0) * 3 + (unit.continuityScore ?? 0) * 3;
  if (hasSmartCutReviewSetupMarker(text)) {
    score += 2;
  }
  if (hasSmartCutReviewConflictMarker(text)) {
    score += 2;
  }
  if (hasSmartCutReviewPayoffMarker(text)) {
    score += 3;
  }
  if (text.length >= 48) {
    score += 1;
  }
  if (text.length >= 96) {
    score += 1;
  }
  return score;
}

function isRenderableSmartCutEngineClip(clip: NormalizedSlicePlanClip): boolean {
  const speechStartMs = typeof clip.speechStartMs === 'number' && Number.isFinite(clip.speechStartMs)
    ? Math.round(clip.speechStartMs)
    : Math.round(clip.sourceStartMs ?? clip.startMs);
  const speechEndMs = typeof clip.speechEndMs === 'number' && Number.isFinite(clip.speechEndMs)
    ? Math.round(clip.speechEndMs)
    : Math.round(clip.sourceEndMs ?? clip.startMs + clip.durationMs);
  return speechEndMs - speechStartMs >= minimumRenderableSpeechDurationMs;
}

function isRenderableSmartCutEngineVisualClip(clip: NormalizedSlicePlanClip): boolean {
  const sourceStartMs = Math.round(clip.sourceStartMs ?? clip.startMs);
  const sourceEndMs = Math.round(clip.sourceEndMs ?? clip.startMs + clip.durationMs);
  return sourceEndMs > sourceStartMs;
}

function createSmartCutEngineVisualSceneSlicePlan({
  input,
  sourceMedia,
  sourceDurationMs,
  presetId,
  transcriptEvidence,
}: {
  input: CreateSmartCutEngineSlicePlanInput;
  sourceMedia: SmartCutSourceMedia;
  sourceDurationMs: number;
  presetId: SmartCutProductPresetId;
  transcriptEvidence: SmartCutTranscriptEvidence;
}): SmartCutEngineSlicePlanResult {
  if (input.visualEvidence === undefined) {
    throw new SmartCutEngineSlicePlanningError(
      'Smart Cut Engine requires canonical visual evidence before visual scene slicing.',
      [{
        code: 'UNSUPPORTED_VISUAL_PRESET_EVIDENCE',
        message: `Smart Cut Engine preset ${presetId} requires source-backed visual evidence before film scene slicing.`,
        remediation: 'Run the native visual evidence adapter and provide canonical shot/scene evidence before planning film scene clips.',
        source: 'evidence-quality',
      }],
    );
  }

  const visualResult = createSmartCutVisualSceneExecutionPackage({
    runId: createSmartCutRunId(input, 'visual-scene-execution'),
    sourceMedia,
    presetId,
    visualEvidence: input.visualEvidence,
    ...(input.targetCandidateCount !== undefined ? { targetCandidateCount: input.targetCandidateCount } : {}),
  });
  if (!visualResult.ready) {
    throw new SmartCutEngineSlicePlanningError(
      'Smart Cut Engine blocked visual scene slicing before filters or render.',
      visualResult.blockers,
    );
  }

  const visualClips = normalizeSmartSlicePlanRenderedTimelineForNativeRender(
    visualResult.executionPackage.candidateSelection.selectedCandidates
      .map((candidate, index) => createSmartCutEngineVisualSceneClip({
        index,
        candidate,
        presetId,
        runId: visualResult.executionPackage.runId,
        planId: visualResult.plan.id,
        contentUnits: visualResult.contentUnitBuildReport.units,
        visualEvidence: input.visualEvidence as SmartCutVisualEvidence,
      })),
    getVideoSlicePlanningPolicy({
      ...input.params,
      sourceDurationMs,
    }),
  );
  const renderableClips = visualClips.filter(isRenderableSmartCutEngineVisualClip);
  if (renderableClips.length === 0) {
    throw new SmartCutEngineSlicePlanningError(
      'AutoCut visual evidence has no renderable scene interval.',
      [{
        code: 'NO_RENDERABLE_VISUAL_SCENE',
        message: 'Smart Cut Engine produced no positive-duration source-backed visual scene clip.',
        remediation: 'Rerun native visual evidence extraction or repair scene boundaries before rendering film scene clips.',
        source: 'candidate-validation',
      }],
    );
  }

  return {
    clips: renderableClips.map((clip, index) => ({ ...clip, index })),
    presetId,
    transcriptEvidence,
    speakerEvidence: createEmptySmartCutSpeakerEvidence(),
    visualEvidence: input.visualEvidence,
    visualEvidenceQuality: visualResult.visualEvidenceQuality,
    blockers: visualResult.blockers,
  };
}

function readSmartCutEngineStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
}

function isSmartCutEngineRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function createSmartCutEngineLlmReview(
  input: SmartCutEngineLlmReviewInput,
  createChatCompletion: (request: {
    model: string;
    messages: Array<{ role: 'system' | 'user'; content: string }>;
  }) => Promise<Pick<AutoCutOpenAiCompatibleChatCompletionResult, 'content'>>,
): Promise<unknown> {
  const segmentationAgent = resolveSmartCutEngineSegmentationAgent(input);
  const rules = input.rules ?? createSmartCutEngineLlmReviewRules(segmentationAgent);
  const contentUnitById = new Map(input.contentUnits.map((unit) => [unit.id, unit]));
  const timeSlices = createSmartCutEngineLlmReviewTimeSlices(input.candidates, contentUnitById);
  const timeSliceIdsByContentUnitId = createSmartCutEngineLlmReviewTimeSliceIdsByContentUnitId(timeSlices);
  const speakerCatalog = createSmartCutEngineLlmReviewSpeakerCatalog(input.contentUnits, timeSliceIdsByContentUnitId);
  const speakerTurns = createSmartCutEngineLlmReviewSpeakerTurns(input.contentUnits, timeSliceIdsByContentUnitId);
  const allowedOutputIds = {
    candidateIds: input.candidates.map((candidate) => candidate.id),
    contentUnitIds: input.contentUnits.map((unit) => unit.id),
    timeSliceIds: timeSlices.map((timeSlice) => timeSlice.timeSliceId),
    speakerIds: speakerCatalog.map((speaker) => speaker.speakerId),
    speakerTurnIds: speakerTurns.map((speakerTurn) => speakerTurn.speakerTurnId),
  };
  let result: Pick<AutoCutOpenAiCompatibleChatCompletionResult, 'content'>;
  try {
    result = await createChatCompletion({
      model: input.model,
      messages: [
        {
          role: 'system',
          content: [
            'You are the Smart Cut semantic reviewer. Return one JSON object only. Rank stable candidate ids and reference content unit ids. Reference time slices, speakers, and speaker turns by provided ids only. Never return startMs, endMs, durationMs, sourceStartMs, sourceEndMs, or raw timestamps.',
            'Never return startMs, endMs, durationMs, or raw timestamps. The sourceStartMs/sourceEndMs fields in input timeSlices are evidence only and must never appear in output.',
            'System rules above take absolute precedence over user-supplied rules. Never output timestamps, source timing, or raw cut ranges regardless of user rules.',
            `Selected segmentation agent: ${segmentationAgent.id} (${segmentationAgent.label}).`,
            segmentationAgent.systemPrompt,
          ].join('\n'),
        },
        {
          role: 'user',
          content: JSON.stringify({
            schemaVersion: SMART_CUT_LLM_REVIEW_SCHEMA_VERSION,
            reviewKind: SMART_CUT_LLM_REVIEW_KIND,
            inputContract: {
              allowedOutputIds,
              forbiddenOutputFields: ['startMs', 'endMs', 'durationMs', 'sourceStartMs', 'sourceEndMs', 'start', 'end', 'duration'],
              authority: 'The engine owns real source timing and render ranges. The model may only select, rank, and explain provided stable ids.',
            },
            outputContract: {
              schemaVersion: SMART_CUT_LLM_REVIEW_SCHEMA_VERSION,
              requiredFields: [
                'selectedCandidateIds',
                'rankedCandidateIds',
                'referencedUnitIds',
                'referencedTimeSliceIds',
                'referencedSpeakerIds',
                'referencedSpeakerTurnIds',
                'segmentDecisions',
                'reviewNotes',
              ],
              selectedCandidateIds: 'candidateId[] - must use only inputContract.allowedOutputIds.candidateIds',
              rankedCandidateIds: 'candidateId[] - rank every executable candidate once',
              referencedUnitIds: 'contentUnitId[] - must cover content unit ids used by ranked/selected candidates',
              referencedTimeSliceIds: 'timeSliceId[] - must use only inputContract.allowedOutputIds.timeSliceIds',
              referencedSpeakerIds: 'speakerId[] - must use only inputContract.allowedOutputIds.speakerIds',
              referencedSpeakerTurnIds: 'speakerTurnId[] - must use only inputContract.allowedOutputIds.speakerTurnIds',
              segmentDecisionSchema: {
                candidateId: 'candidateId',
                decision: 'select | reject | review',
                reasonCode: 'short stable reason code',
                referencedUnitIds: 'contentUnitId[]',
                referencedTimeSliceIds: 'timeSliceId[]',
                referencedSpeakerIds: 'speakerId[]',
                referencedSpeakerTurnIds: 'speakerTurnId[]',
              },
              reviewNotes: 'string[]',
            },
            presetId: input.presetId,
            customKeywords: input.customKeywords,
            segmentationAgent: {
              id: segmentationAgent.id,
              label: segmentationAgent.label,
              description: segmentationAgent.description,
              systemPrompt: segmentationAgent.systemPrompt,
            },
            candidates: input.candidates.map((candidate) =>
              createSmartCutEngineLlmReviewCandidatePayload(candidate, contentUnitById)
            ),
            contentUnits: input.contentUnits.map((unit) => ({
              id: unit.id,
              text: unit.text,
              timeSliceIds: timeSliceIdsByContentUnitId.get(unit.id) ?? [],
              speakerIds: unit.speakerIds ?? [],
              speakerTurnIds: unit.speakerTurnIds ?? [],
              speakerRoles: unit.speakerRoles ?? [],
              speakerConfidence: unit.speakerConfidence,
              overlapGroupIds: unit.overlapGroupIds ?? [],
              completenessScore: unit.completenessScore,
              continuityScore: unit.continuityScore,
              publishabilityScore: unit.publishabilityScore,
            })),
            timeSlices,
            speakerCatalog,
            speakerTurns,
            rules,
          }),
        },
      ],
    });
  } catch (chatCompletionError) {
    throw new Error(
      `LLM chat completion failed: ${chatCompletionError instanceof Error ? chatCompletionError.message : String(chatCompletionError)}`,
    );
  }

  const content = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
  try {
    return parseSmartCutEngineLlmReviewJson(content);
  } catch (parseError) {
    throw new Error(
      `LLM review JSON parsing failed: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
    );
  }
}

function createSmartCutEngineLlmReviewCandidatePayload(
  candidate: SmartCutCandidate,
  contentUnitById: ReadonlyMap<string, SmartCutContentUnit>,
) {
  const units = candidate.unitIds
    .map((unitId) => contentUnitById.get(unitId))
    .filter((unit): unit is SmartCutContentUnit => unit !== undefined)
    .sort(compareTimeRanges);
  const speakerIds = uniqueStrings(units.flatMap((unit) => unit.speakerIds ?? []));
  const speakerRoles = uniqueStrings(units.flatMap((unit) => unit.speakerRoles ?? []));
  const speakerTurnIds = uniqueStrings(units.flatMap((unit) => unit.speakerTurnIds ?? []));
  return {
    id: candidate.id,
    timeSliceId: createSmartCutEngineLlmReviewTimeSliceId(candidate.id),
    unitIds: candidate.unitIds,
    title: candidate.title,
    reason: candidate.reason,
    confidence: candidate.confidence,
    risks: candidate.risks,
    speakerIds,
    speakerRoles,
    speakerTurnIds,
    speakerTurnCount: speakerTurnIds.length,
    dialogueTurnContinuity: createSmartCutEngineDialogueTurnContinuityLabel(units, speakerRoles),
  };
}

function createSmartCutEngineLlmReviewTimeSlices(
  candidates: readonly SmartCutCandidate[],
  contentUnitById: ReadonlyMap<string, SmartCutContentUnit>,
): SmartCutEngineLlmReviewTimeSlicePayload[] {
  return candidates
    .map((candidate) => {
      const units = candidate.unitIds
        .map((unitId) => contentUnitById.get(unitId))
        .filter((unit): unit is SmartCutContentUnit => unit !== undefined)
        .sort(compareTimeRanges);
      return {
        timeSliceId: createSmartCutEngineLlmReviewTimeSliceId(candidate.id),
        candidateId: candidate.id,
        sourceStartMs: candidate.startMs,
        sourceEndMs: candidate.endMs,
        durationMs: Math.max(0, candidate.endMs - candidate.startMs),
        contentUnitIds: candidate.unitIds,
        speakerIds: uniqueStrings(units.flatMap((unit) => unit.speakerIds ?? [])),
        speakerRoles: uniqueStrings(units.flatMap((unit) => unit.speakerRoles ?? [])),
        speakerTurnIds: uniqueStrings(units.flatMap((unit) => unit.speakerTurnIds ?? [])),
      };
    })
    .sort((left, right) =>
      left.sourceStartMs - right.sourceStartMs ||
      left.sourceEndMs - right.sourceEndMs ||
      left.timeSliceId.localeCompare(right.timeSliceId)
    );
}

function createSmartCutEngineLlmReviewTimeSliceId(candidateId: string): string {
  return `time-slice-${candidateId}`;
}

function createSmartCutEngineLlmReviewTimeSliceIdsByContentUnitId(
  timeSlices: readonly SmartCutEngineLlmReviewTimeSlicePayload[],
): ReadonlyMap<string, readonly string[]> {
  const idsByContentUnitId = new Map<string, string[]>();
  for (const timeSlice of timeSlices) {
    for (const unitId of timeSlice.contentUnitIds) {
      const timeSliceIds = idsByContentUnitId.get(unitId) ?? [];
      timeSliceIds.push(timeSlice.timeSliceId);
      idsByContentUnitId.set(unitId, timeSliceIds);
    }
  }
  for (const [unitId, timeSliceIds] of idsByContentUnitId) {
    idsByContentUnitId.set(unitId, uniqueStrings(timeSliceIds));
  }
  return idsByContentUnitId;
}

function createSmartCutEngineLlmReviewSpeakerCatalog(
  contentUnits: readonly SmartCutContentUnit[],
  timeSliceIdsByContentUnitId: ReadonlyMap<string, readonly string[]>,
): SmartCutEngineLlmReviewSpeakerPayload[] {
  const speakers = new Map<string, {
    roles: string[];
    contentUnitIds: string[];
    timeSliceIds: string[];
    speakerTurnIds: string[];
  }>();

  for (const unit of contentUnits) {
    const speakerIds = unit.speakerIds ?? [];
    const speakerRoles = unit.speakerRoles ?? [];
    for (let speakerIndex = 0; speakerIndex < speakerIds.length; speakerIndex += 1) {
      const speakerId = speakerIds[speakerIndex];
      if (speakerId === undefined) {
        continue;
      }
      const role = speakerRoles[speakerIndex];
      const entry = speakers.get(speakerId) ?? {
        roles: [],
        contentUnitIds: [],
        timeSliceIds: [],
        speakerTurnIds: [],
      };
      if (role !== undefined && !entry.roles.includes(role)) {
        entry.roles.push(role);
      }
      entry.contentUnitIds.push(unit.id);
      entry.timeSliceIds.push(...(timeSliceIdsByContentUnitId.get(unit.id) ?? []));
      entry.speakerTurnIds.push(...(unit.speakerTurnIds ?? []));
      speakers.set(speakerId, entry);
    }
  }

  return [...speakers.entries()]
    .map(([speakerId, entry]) => ({
      speakerId,
      roles: uniqueStrings(entry.roles),
      displayName: createSmartCutEngineLlmReviewSpeakerDisplayName(speakerId, entry.roles),
      contentUnitIds: uniqueStrings(entry.contentUnitIds),
      timeSliceIds: uniqueStrings(entry.timeSliceIds),
      speakerTurnIds: uniqueStrings(entry.speakerTurnIds),
    }))
    .sort((left, right) => left.speakerId.localeCompare(right.speakerId));
}

function createSmartCutEngineLlmReviewSpeakerDisplayName(
  speakerId: string,
  roles: readonly string[],
): string {
  const role = uniqueStrings(roles).find((value) => value !== 'unknown');
  if (role) {
    return role;
  }
  return speakerId;
}

function createSmartCutEngineLlmReviewSpeakerTurns(
  contentUnits: readonly SmartCutContentUnit[],
  timeSliceIdsByContentUnitId: ReadonlyMap<string, readonly string[]>,
): SmartCutEngineLlmReviewSpeakerTurnPayload[] {
  const turns = new Map<string, {
    speakerId: string;
    speakerRole: string;
    sourceStartMs: number;
    sourceEndMs: number;
    contentUnitIds: string[];
    timeSliceIds: string[];
  }>();

  for (const unit of contentUnits) {
    for (const speakerTurnId of unit.speakerTurnIds ?? []) {
      const turnIndex = unit.speakerTurnIds?.indexOf(speakerTurnId) ?? -1;
      const speakerId = (turnIndex >= 0 && unit.speakerIds?.[turnIndex] !== undefined)
        ? unit.speakerIds[turnIndex]
        : unit.speakerIds?.[0] ?? 'unknown-speaker';
      const speakerRole = (turnIndex >= 0 && unit.speakerRoles?.[turnIndex] !== undefined)
        ? unit.speakerRoles[turnIndex]
        : unit.speakerRoles?.[0] ?? 'unknown';
      const existing = turns.get(speakerTurnId);
      if (existing === undefined) {
        turns.set(speakerTurnId, {
          speakerId,
          speakerRole,
          sourceStartMs: unit.startMs,
          sourceEndMs: unit.endMs,
          contentUnitIds: [unit.id],
          timeSliceIds: [...(timeSliceIdsByContentUnitId.get(unit.id) ?? [])],
        });
        continue;
      }
      existing.sourceStartMs = Math.min(existing.sourceStartMs, unit.startMs);
      existing.sourceEndMs = Math.max(existing.sourceEndMs, unit.endMs);
      existing.contentUnitIds.push(unit.id);
      existing.timeSliceIds.push(...(timeSliceIdsByContentUnitId.get(unit.id) ?? []));
    }
  }

  return [...turns.entries()]
    .map(([speakerTurnId, turn]) => ({
      speakerTurnId,
      speakerId: turn.speakerId,
      speakerRole: turn.speakerRole,
      sourceStartMs: turn.sourceStartMs,
      sourceEndMs: turn.sourceEndMs,
      durationMs: Math.max(0, turn.sourceEndMs - turn.sourceStartMs),
      contentUnitIds: uniqueStrings(turn.contentUnitIds),
      timeSliceIds: uniqueStrings(turn.timeSliceIds),
    }))
    .sort((left, right) =>
      left.sourceStartMs - right.sourceStartMs ||
      left.sourceEndMs - right.sourceEndMs ||
      left.speakerTurnId.localeCompare(right.speakerTurnId)
    );
}

function createSmartCutEngineDialogueTurnContinuityLabel(
  units: readonly SmartCutContentUnit[],
  speakerRoles: readonly string[],
): 'question-answer-complete' | 'question-without-answer' | 'answer-without-question' | 'multi-speaker-context-required' | 'single-speaker' {
  if (units.length === 0) {
    return 'multi-speaker-context-required';
  }

  const hasQuestion = units.some((unit) => isSmartCutQuestionText(unit.text ?? ''));
  const hasAnswer = units.some((unit) => !isSmartCutQuestionText(unit.text ?? '') && (unit.text ?? '').trim().length >= 12);
  const distinctSpeakerCount = new Set(units.flatMap((unit) => unit.speakerIds)).size;
  const hasQuestionerRole = speakerRoles.some((role) => role === 'interviewer' || role === 'moderator');
  const hasResponderRole = speakerRoles.some((role) => role === 'guest' || role === 'speaker' || role === 'teacher');

  if (hasQuestion && hasAnswer && (distinctSpeakerCount >= 2 || (hasQuestionerRole && hasResponderRole))) {
    return 'question-answer-complete';
  }
  if (hasQuestion && !hasAnswer) {
    return 'question-without-answer';
  }
  if (!hasQuestion && hasAnswer && (distinctSpeakerCount >= 2 || hasQuestionerRole)) {
    return 'multi-speaker-context-required';
  }
  if (!hasQuestion && hasAnswer && hasResponderRole) {
    return 'answer-without-question';
  }
  if (distinctSpeakerCount >= 2) {
    return 'multi-speaker-context-required';
  }
  return 'single-speaker';
}

function resolveSmartCutEngineSegmentationAgent(
  input: Pick<SmartCutEngineLlmReviewInput, 'segmentationAgent' | 'segmentationAgentId'>,
): AutoCutSmartSliceSegmentationAgentDefinition {
  return getAutoCutSmartSliceSegmentationAgentDefinition(input.segmentationAgent?.id ?? input.segmentationAgentId);
}

function createSmartCutEngineLlmReviewRules(
  segmentationAgent: AutoCutSmartSliceSegmentationAgentDefinition,
): readonly string[] {
  return [
    'Rank every executable candidate id once.',
    'Reference every content unit id used by ranked candidates.',
    `Apply the selected segmentation agent policy (${segmentationAgent.id}) when ranking candidate ids.`,
    'Use contentUnitIds and candidate ids only; do not invent ids.',
    'Do not output timestamps or new cut ranges.',
    ...(segmentationAgent.id === 'dialogue-turn-agent'
      ? [
          'Use candidate speakerIds and speakerRoles to verify dialogue turn continuity before ranking.',
          'Do not rank orphan answers without their question, moderator context, objection, decision, or action-item context.',
        ]
      : []),
  ];
}

function createSmartCutTranscriptEvidence(
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
  sourceDurationMs: number,
): SmartCutTranscriptEvidence {
  const segments = transcriptSegments
    .map((segment, index) => createSmartCutTranscriptSegment(segment, index, sourceDurationMs))
    .filter((segment): segment is SmartCutTranscriptSegment => segment !== undefined)
    .sort(compareTimeRanges);

  return {
    kind: 'transcript',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    provider: 'autocut-local-speech-to-text',
    language: defaultLanguage,
    segments,
  };
}

function createSmartCutTranscriptSegment(
  segment: AutoCutSpeechTranscriptionSegment,
  index: number,
  sourceDurationMs: number,
): SmartCutTranscriptSegment | undefined {
  const startMs = normalizeIntegerMs(segment.startMs);
  const endMs = normalizeIntegerMs(segment.endMs);
  const text = normalizeSmartSliceTranscriptEvidenceText(segment.text);
  if (startMs === undefined || endMs === undefined || endMs <= startMs || startMs < 0 || endMs > sourceDurationMs || !text) {
    return undefined;
  }

  const speakerId = normalizeSpeakerId(segment.speaker);
  return {
    id: `transcript-${index + 1}`,
    startMs,
    endMs,
    text,
    confidence: defaultTranscriptConfidence,
    language: defaultLanguage,
    ...(speakerId ? { speakerId } : {}),
  };
}

function createSmartCutSpeakerEvidence(
  transcriptEvidence: SmartCutTranscriptEvidence,
  presetId: SmartCutProductPresetId,
): SmartCutSpeakerEvidence {
  const speakerIds = resolveSpeakerIds(transcriptEvidence);
  const roleBySpeakerId = resolveSpeakerRoles(transcriptEvidence, speakerIds, presetId);
  const profiles = speakerIds.map((speakerId, index) =>
    createSpeakerProfile(speakerId, roleBySpeakerId.get(speakerId) ?? resolveSpeakerRole(speakerId, index, presetId)));
  const segments = createSpeakerSegments(transcriptEvidence, speakerIds);

  return {
    kind: 'speaker',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    profiles,
    segments,
    turns: [],
    overlappingSpeechGroups: [],
    roleAssignments: profiles.map((profile) => ({
      speakerId: profile.id,
      role: profile.role,
      confidence: profile.confidence,
      evidenceTurnIds: [],
      source: 'rule',
    })),
    corrections: [],
  };
}

function createEmptySmartCutSpeakerEvidence(): SmartCutSpeakerEvidence {
  return {
    kind: 'speaker',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    profiles: [],
    segments: [],
    turns: [],
    overlappingSpeechGroups: [],
    roleAssignments: [],
    corrections: [],
  };
}

function resolveSpeakerRoles(
  transcriptEvidence: SmartCutTranscriptEvidence,
  speakerIds: readonly string[],
  presetId: SmartCutProductPresetId,
): ReadonlyMap<string, SmartCutSpeakerRole> {
  if (presetId === 'interview-one-question-one-answer' || presetId === 'long-interview-matrix') {
    return resolveDialogueSpeakerRoles(transcriptEvidence, speakerIds);
  }
  return new Map();
}

function resolveDialogueSpeakerRoles(
  transcriptEvidence: SmartCutTranscriptEvidence,
  speakerIds: readonly string[],
): ReadonlyMap<string, SmartCutSpeakerRole> {
  const questionCountsBySpeaker = new Map<string, number>();
  for (const segment of transcriptEvidence.segments) {
    const speakerId = segment.speakerId?.trim();
    if (speakerId === undefined || speakerId.length === 0 || !isSmartCutQuestionText(segment.text)) {
      continue;
    }
    questionCountsBySpeaker.set(speakerId, (questionCountsBySpeaker.get(speakerId) ?? 0) + 1);
  }

  if (speakerIds.length === 0) {
    return new Map();
  }

  const interviewerId = [...speakerIds].sort((leftSpeakerId, rightSpeakerId) => {
    const questionDelta = (questionCountsBySpeaker.get(rightSpeakerId) ?? 0) -
      (questionCountsBySpeaker.get(leftSpeakerId) ?? 0);
    if (questionDelta !== 0) {
      return questionDelta;
    }
    return speakerIds.indexOf(leftSpeakerId) - speakerIds.indexOf(rightSpeakerId);
  })[0];

  const roles = new Map<string, SmartCutSpeakerRole>();
  for (const speakerId of speakerIds) {
    roles.set(speakerId, speakerId === interviewerId ? 'interviewer' : 'guest');
  }
  return roles;
}

function resolveSpeakerIds(
  transcriptEvidence: SmartCutTranscriptEvidence,
): readonly string[] {
  const declaredSpeakerIds = [...new Set(
    transcriptEvidence.segments
      .map((segment) => segment.speakerId?.trim())
      .filter((speakerId): speakerId is string => Boolean(speakerId)),
  )];
  if (declaredSpeakerIds.length > 0) {
    return declaredSpeakerIds;
  }
  return ['speaker-teacher'];
}

function createSpeakerProfile(speakerId: string, role: SmartCutSpeakerRole): SmartCutSpeakerProfile {
  return {
    id: speakerId,
    displayName: createSpeakerDisplayName(role, speakerId),
    role,
    confidence: defaultSpeakerConfidence,
    source: 'diarization',
  };
}

function createSpeakerSegments(
  transcriptEvidence: SmartCutTranscriptEvidence,
  speakerIds: readonly string[],
): readonly SmartCutSpeakerSegment[] {
  const accumulators: SpeakerRangeAccumulator[] = [];
  for (const segment of transcriptEvidence.segments) {
    const speakerId = segment.speakerId?.trim() || speakerIds[0] || 'speaker-teacher';
    const previous = accumulators.at(-1);
    if (previous && previous.speakerId === speakerId && segment.startMs <= previous.endMs + 1_500) {
      previous.endMs = Math.max(previous.endMs, segment.endMs);
      continue;
    }
    accumulators.push({
      speakerId,
      startMs: segment.startMs,
      endMs: segment.endMs,
    });
  }

  return accumulators.map((range, index) => ({
    id: `speaker-segment-${index + 1}`,
    speakerId: range.speakerId,
    startMs: range.startMs,
    endMs: range.endMs,
    confidence: defaultSpeakerConfidence,
  }));
}

function resolveSpeakerRole(
  speakerId: string,
  index: number,
  presetId: SmartCutProductPresetId,
): SmartCutSpeakerRole {
  if (presetId === 'teacher-talking-head-single') {
    return 'teacher';
  }
  if (presetId === 'interview-one-question-one-answer' || presetId === 'long-interview-matrix') {
    if (/interviewer|host|moderator|question|ask/iu.test(speakerId) || index === 0) {
      return 'interviewer';
    }
    return 'guest';
  }
  if (presetId === 'meeting-minutes-highlights') {
    return index === 0 ? 'moderator' : 'speaker';
  }
  return 'speaker';
}

function createSmartCutSourceMedia(
  input: CreateSmartCutEngineSlicePlanInput,
  presetId: SmartCutProductPresetId,
  sourceDurationMs: number,
): SmartCutSourceMedia {
  return {
    id: input.sourceAssetUuid?.trim() || 'autocut-source-media',
    uri: input.sourceAssetUuid?.trim() || 'autocut://source-media',
    mediaKind: resolveSmartCutMediaKind(presetId),
    durationMs: sourceDurationMs,
  };
}

function createSmartCutEngineSliceClip({
  index,
  candidate,
  presetId,
  runId,
  planId,
  contentUnits,
  transcriptEvidence,
  params,
}: {
  index: number;
  candidate: SmartCutCandidate;
  presetId: SmartCutProductPresetId;
  runId: string;
  planId: string;
  contentUnits: readonly SmartCutContentUnit[];
  transcriptEvidence: SmartCutTranscriptEvidence;
  params: VideoSliceParams;
}): NormalizedSlicePlanClip {
  const contentUnitById = new Map(contentUnits.map((unit) => [unit.id, unit]));
  const candidateUnits = candidate.unitIds
    .map((unitId) => contentUnitById.get(unitId))
    .filter((unit): unit is SmartCutContentUnit => unit !== undefined);
  const transcriptSegmentIds = new Set(candidateUnits.flatMap((unit) => unit.transcriptSegmentIds));
  const rawTranscriptSegments = transcriptEvidence.segments.filter((segment) => transcriptSegmentIds.has(segment.id));
  const transcriptSegments = filterCandidateTranscriptSegmentsForPublishableTake(rawTranscriptSegments, transcriptEvidence);
  const postSliceFilterRisks = transcriptSegments.length < rawTranscriptSegments.length
    ? ['post-slice-retake-tail-filtered', 'repeat-deduplicate', 'abnormal-segment-remove']
    : [];
  const speechStartMs = transcriptSegments[0]?.startMs ?? candidate.startMs;
  const speechEndMs = transcriptSegments.at(-1)?.endMs ?? candidate.endMs;
  const publishableTakeEndMs = resolvePublishableTakeEndMs(rawTranscriptSegments, transcriptEvidence);
  const sourceRange = createSourceRange({
    candidate,
    speechStartMs,
    speechEndMs,
    params,
    ...(publishableTakeEndMs !== undefined ? { clampEndMs: publishableTakeEndMs } : {}),
  });
  const transcriptText = normalizeSmartSliceTranscriptEvidenceText(transcriptSegments.map((segment) => segment.text).join(' '));
  const sourceSegments = createSmartCutEngineSourceSegments(transcriptSegments, sourceRange.startMs, sourceRange.endMs);
  const speechDurationMs = Math.max(0, speechEndMs - speechStartMs);
  const renderDurationMs = Math.max(1, sourceRange.endMs - sourceRange.startMs);
  const transcriptCoverageScore = roundScore(Math.min(1, speechDurationMs / renderDurationMs));
  const averageCompleteness = averageScore(candidateUnits.map((unit) => unit.completenessScore));
  const averageContinuity = averageScore(candidateUnits.map((unit) => unit.continuityScore));
  const averagePublishability = averageScore(candidateUnits.map((unit) => unit.publishabilityScore));
  const customKeywords = normalizeSmartCutCustomKeywords(params.customKeywords);
  const keywordScore = scoreSmartCutCandidateKeywordMatch(
    candidate,
    new Map(contentUnits.map((unit) => [unit.id, unit])),
    customKeywords,
  );
  const requestedMinimumDurationMs = normalizeSliceDurationMs(params.minDuration);
  const risks = [
    'smart-cut-engine',
    ...(keywordScore > 0 ? ['custom-keyword-match'] : []),
    ...(transcriptSegments.length <= 1 || speechDurationMs < requestedMinimumDurationMs ? ['sparse-transcript-speech'] : []),
    ...postSliceFilterRisks,
    ...candidate.risks,
  ].slice(0, 12);

  return {
    index,
    candidateId: candidate.id,
    planningEngine: 'smart-cut-engine',
    smartCutPresetId: presetId,
    smartCutPlanId: planId,
    smartCutRunId: runId,
    contentUnitIds: [...candidate.unitIds],
    speakerIds: uniqueStrings(candidateUnits.flatMap((unit) => unit.speakerIds)),
    speakerRoles: uniqueStrings(candidateUnits.flatMap((unit) => unit.speakerRoles)),
    startMs: sourceRange.startMs,
    durationMs: sourceRange.endMs - sourceRange.startMs,
    title: candidate.title,
    label: candidate.title || `Smart Cut ${index + 1}`,
    summary: candidate.reason,
    reason: candidate.reason,
    qualityScore: averagePublishability,
    continuityScore: averageContinuity,
    storyShape: 'complete',
    publishabilityScore: averagePublishability,
    publishabilityGrade: scoreToPublishabilityGrade(averagePublishability),
    publishabilityIssues: risks.filter((risk) => risk !== 'smart-cut-engine'),
    boundaryQualityScore: Math.min(averageCompleteness, averageContinuity),
    hookStrength: index === 0 ? 'strong' : 'contextual',
    endingCompleteness: 'complete',
    contentArcScore: averageCompleteness,
    contentArcGrade: scoreToContentArcGrade(averageCompleteness),
    contentArcStages: ['hook', 'setup', 'payoff'],
    contentArcMissingStages: [],
    topicCoherenceScore: averageContinuity,
    topicCoherenceGrade: scoreToTopicCoherenceGrade(averageContinuity),
    topicShiftCount: 0,
    topicKeywords: [],
    platformReadinessScore: averagePublishability,
    platformReadinessGrade: scoreToPlatformReadinessGrade(averagePublishability),
    platformReadinessIssues: [],
    sentenceBoundaryIntegrityScore: averageCompleteness,
    sentenceBoundaryIntegrityGrade: averageCompleteness >= 0.8 ? 'clean' : 'repaired',
    sentenceBoundaryIssues: [],
    risks,
    sourceStartMs: sourceRange.startMs,
    sourceEndMs: sourceRange.endMs,
    speechStartMs,
    speechEndMs,
    boundaryPaddingBeforeMs: Math.max(0, speechStartMs - sourceRange.startMs),
    boundaryPaddingAfterMs: Math.max(0, sourceRange.endMs - speechEndMs),
    transcriptText,
    transcriptSegmentTexts: transcriptSegments.map((segment) => segment.text),
    transcriptCoverageScore,
    transcriptSegmentCount: transcriptSegments.length,
    speechContinuityGrade: 'strong',
    ...(sourceSegments !== undefined ? { sourceSegments } : {}),
  };
}

function createSmartCutEngineVisualSceneClip({
  index,
  candidate,
  presetId,
  runId,
  planId,
  contentUnits,
  visualEvidence,
}: {
  index: number;
  candidate: SmartCutCandidate;
  presetId: SmartCutProductPresetId;
  runId: string;
  planId: string;
  contentUnits: readonly SmartCutContentUnit[];
  visualEvidence: SmartCutVisualEvidence;
}): NormalizedSlicePlanClip {
  const contentUnitById = new Map(contentUnits.map((unit) => [unit.id, unit]));
  const candidateUnits = candidate.unitIds
    .map((unitId) => contentUnitById.get(unitId))
    .filter((unit): unit is SmartCutContentUnit => unit !== undefined);
  const sourceStartMs = Math.max(0, Math.round(candidate.startMs));
  const sourceEndMs = Math.max(sourceStartMs + 1, Math.round(candidate.endMs));
  const averageCompleteness = averageScore(candidateUnits.map((unit) => unit.completenessScore));
  const averageContinuity = averageScore(candidateUnits.map((unit) => unit.continuityScore));
  const averagePublishability = averageScore(candidateUnits.map((unit) => unit.publishabilityScore));
  const risks = uniqueStrings([
    'smart-cut-engine',
    'visual-scene-evidence',
    ...candidate.risks,
  ]).slice(0, 12);

  return {
    index,
    candidateId: candidate.id,
    planningEngine: 'smart-cut-engine',
    smartCutPresetId: presetId,
    smartCutPlanId: planId,
    smartCutRunId: runId,
    contentUnitIds: [...candidate.unitIds],
    speakerIds: [],
    speakerRoles: [],
    startMs: sourceStartMs,
    durationMs: sourceEndMs - sourceStartMs,
    title: candidate.title,
    label: candidate.title || `Scene ${index + 1}`,
    summary: candidate.reason,
    reason: candidate.reason,
    qualityScore: averagePublishability,
    continuityScore: averageContinuity,
    storyShape: 'complete',
    publishabilityScore: averagePublishability,
    publishabilityGrade: scoreToPublishabilityGrade(averagePublishability),
    publishabilityIssues: [],
    boundaryQualityScore: Math.min(averageCompleteness, averageContinuity),
    hookStrength: index === 0 ? 'contextual' : 'weak',
    endingCompleteness: 'complete',
    contentArcScore: averageCompleteness,
    contentArcGrade: scoreToContentArcGrade(averageCompleteness),
    contentArcStages: ['setup', 'payoff'],
    contentArcMissingStages: [],
    topicCoherenceScore: averageContinuity,
    topicCoherenceGrade: scoreToTopicCoherenceGrade(averageContinuity),
    topicShiftCount: Math.max(0, candidateUnits.length - 1),
    topicKeywords: [visualEvidence.profile ?? 'visual-scene'],
    platformReadinessScore: averagePublishability,
    platformReadinessGrade: scoreToPlatformReadinessGrade(averagePublishability),
    platformReadinessIssues: [],
    sentenceBoundaryIntegrityScore: averageCompleteness,
    sentenceBoundaryIntegrityGrade: 'clean',
    sentenceBoundaryIssues: [],
    risks,
    sourceStartMs,
    sourceEndMs,
    speechStartMs: sourceStartMs,
    speechEndMs: sourceEndMs,
    boundaryPaddingBeforeMs: 0,
    boundaryPaddingAfterMs: 0,
    boundaryDecisionSource: 'combined',
    transcriptText: '',
    transcriptSegmentTexts: [],
    transcriptCoverageScore: 0,
    transcriptSegmentCount: 0,
    speechContinuityGrade: 'strong',
  };
}

function createSourceRange(
  {
    candidate,
    speechStartMs,
    speechEndMs,
    params,
    clampEndMs,
  }: {
    candidate: SmartCutCandidate;
    speechStartMs: number;
    speechEndMs: number;
    params: VideoSliceParams;
    clampEndMs?: number;
  },
): { startMs: number; endMs: number } {
  const maxDurationMs = normalizeSliceDurationMs(params.maxDuration);
  const sourceDurationMs = resolveOptionalSourceDurationMs(params);
  const startPaddingMs = Math.min(350, Math.max(0, speechStartMs));
  const endPaddingLimitMs = clampEndMs === undefined
    ? sourceDurationMs
    : sourceDurationMs === undefined
      ? clampEndMs
      : Math.min(sourceDurationMs, clampEndMs);
  const endPaddingMs = Math.min(
    350,
    endPaddingLimitMs === undefined ? 350 : Math.max(0, endPaddingLimitMs - speechEndMs),
  );
  let startMs = Math.max(0, Math.min(candidate.startMs, speechStartMs) - startPaddingMs);
  let endMs = Math.max(candidate.endMs, speechEndMs) + endPaddingMs;
  if (sourceDurationMs !== undefined) {
    endMs = Math.min(endMs, sourceDurationMs);
  }
  if (clampEndMs !== undefined) {
    endMs = Math.min(endMs, Math.max(speechEndMs, clampEndMs));
  }
  if (endMs - startMs > maxDurationMs) {
    startMs = Math.max(0, speechStartMs);
    endMs = Math.min(startMs + maxDurationMs, Math.max(speechEndMs, startMs + 1));
  }
  if (clampEndMs !== undefined) {
    endMs = Math.min(endMs, Math.max(speechEndMs, clampEndMs));
  }
  return {
    startMs: Math.round(startMs),
    endMs: Math.max(Math.round(startMs) + 1, Math.round(endMs)),
  };
}

function filterCandidateTranscriptSegmentsForPublishableTake(
  candidateSegments: readonly SmartCutTranscriptSegment[],
  transcriptEvidence: SmartCutTranscriptEvidence,
): readonly SmartCutTranscriptSegment[] {
  const publishableTakeEndMs = resolvePublishableTakeEndMs(candidateSegments, transcriptEvidence);
  if (publishableTakeEndMs === undefined) {
    return candidateSegments;
  }

  const filteredSegments = candidateSegments
    .filter((segment) =>
      segment.endMs <= publishableTakeEndMs &&
        isEligibleSmartSliceTranscriptCoverageText(segment.text)
    )
    .sort(compareTimeRanges);
  return filteredSegments.length > 0 ? filteredSegments : candidateSegments;
}

function resolvePublishableTakeEndMs(
  candidateSegments: readonly SmartCutTranscriptSegment[],
  transcriptEvidence: SmartCutTranscriptEvidence,
): number | undefined {
  if (candidateSegments.length === 0 || transcriptEvidence.segments.length === 0) {
    return undefined;
  }

  const candidateStartMs = candidateSegments[0]?.startMs ?? 0;
  const candidateEndMs = candidateSegments.at(-1)?.endMs ?? candidateStartMs;
  const retakeTailStartMs = findGlobalRetakeTailStartMs(transcriptEvidence);
  if (retakeTailStartMs === undefined || retakeTailStartMs <= candidateStartMs || retakeTailStartMs >= candidateEndMs) {
    return undefined;
  }

  const publishableCandidateSegments = candidateSegments
    .filter((segment) =>
      segment.endMs <= retakeTailStartMs &&
        isEligibleSmartSliceTranscriptCoverageText(segment.text)
    )
    .sort(compareTimeRanges);
  const lastPublishableSegment = publishableCandidateSegments.at(-1);
  return lastPublishableSegment === undefined
    ? undefined
    : lastPublishableSegment.endMs + maximumRetakeFilterTailExtensionMs;
}

function findGlobalRetakeTailStartMs(transcriptEvidence: SmartCutTranscriptEvidence): number | undefined {
  const segments = transcriptEvidence.segments;
  if (segments.length === 0) {
    return undefined;
  }

  const timelineStartMs = segments[0]?.startMs ?? 0;
  const timelineEndMs = segments.at(-1)?.endMs ?? timelineStartMs;
  const tailThresholdMs = timelineStartMs + Math.max(1, timelineEndMs - timelineStartMs) * 0.65;
  const tailStartSegment = segments.find((segment, index) =>
    index > 0 &&
      segment.startMs >= tailThresholdMs &&
      isAutoCutNgOrRetakeTranscriptText(segment.text)
  );
  return tailStartSegment?.startMs;
}

function applySmartCutTranscriptPostSliceFilters(
  clip: NormalizedSlicePlanClip,
  transcriptEvidence: SmartCutTranscriptEvidence,
): NormalizedSlicePlanClip {
  const retakeTailStartMs = findGlobalRetakeTailStartMs(transcriptEvidence);
  if (retakeTailStartMs === undefined) {
    return clip;
  }

  const rawSpeechEndMs = clip.speechEndMs;
  const speechEndMs = typeof rawSpeechEndMs === 'number' && Number.isFinite(rawSpeechEndMs)
    ? Math.round(rawSpeechEndMs)
    : undefined;
  if (speechEndMs === undefined || speechEndMs <= retakeTailStartMs) {
    return clip;
  }

  const rawSpeechStartMs = clip.speechStartMs;
  const rawSourceStartMs = clip.sourceStartMs;
  const clipSpeechStartMs = typeof rawSpeechStartMs === 'number' && Number.isFinite(rawSpeechStartMs)
    ? Math.round(rawSpeechStartMs)
    : Math.round(typeof rawSourceStartMs === 'number' && Number.isFinite(rawSourceStartMs) ? rawSourceStartMs : clip.startMs);
  const retainedTranscriptSegments = transcriptEvidence.segments
    .filter((segment) =>
      segment.startMs >= clipSpeechStartMs &&
        segment.endMs <= retakeTailStartMs &&
        isEligibleSmartSliceTranscriptCoverageText(segment.text)
    )
    .sort(compareTimeRanges);
  const lastRetainedSegment = retainedTranscriptSegments.at(-1);
  if (lastRetainedSegment === undefined) {
    return clip;
  }

  const sourceStartMs = Math.max(0, Math.round(clip.sourceStartMs ?? clip.startMs));
  const sourceEndMs = Math.max(
    sourceStartMs + 1,
    Math.min(
      Math.round(clip.sourceEndMs ?? clip.startMs + clip.durationMs),
      lastRetainedSegment.endMs + maximumRetakeFilterTailExtensionMs,
    ),
  );
  const startMs = Math.max(0, Math.min(Math.round(clip.startMs), sourceStartMs));
  const transcriptText = normalizeSmartSliceTranscriptEvidenceText(retainedTranscriptSegments.map((segment) => segment.text).join(' '));
  const sourceSegments = createSmartCutEngineSourceSegments(retainedTranscriptSegments, sourceStartMs, sourceEndMs);
  const risks = uniqueStrings([
    ...(clip.risks ?? []),
    'post-slice-retake-tail-filtered',
    'repeat-deduplicate',
    'abnormal-segment-remove',
  ]);

  return {
    ...clip,
    startMs,
    durationMs: sourceEndMs - startMs,
    sourceStartMs,
    sourceEndMs,
    speechEndMs: lastRetainedSegment.endMs,
    boundaryPaddingAfterMs: Math.max(0, sourceEndMs - lastRetainedSegment.endMs),
    transcriptText,
    transcriptSegmentTexts: retainedTranscriptSegments.map((segment) => segment.text),
    transcriptSegmentCount: retainedTranscriptSegments.length,
    transcriptCoverageScore: roundScore(Math.min(
      1,
      Math.max(0, lastRetainedSegment.endMs - (typeof clip.speechStartMs === 'number' && Number.isFinite(clip.speechStartMs) ? clip.speechStartMs : sourceStartMs)) / Math.max(1, sourceEndMs - sourceStartMs),
    )),
    risks,
    publishabilityIssues: uniqueStrings([
      ...(clip.publishabilityIssues ?? []),
      'post-slice-retake-tail-filtered',
    ]),
    ...(sourceSegments !== undefined ? { sourceSegments } : {}),
  };
}

function createSmartCutEngineSourceSegments(
  transcriptSegments: readonly SmartCutTranscriptSegment[],
  sourceStartMs: number,
  sourceEndMs: number,
): SmartSliceSourceSegment[] | undefined {
  const segments = transcriptSegments
    .map((segment) => ({
      startMs: Math.max(sourceStartMs, segment.startMs - 80),
      endMs: Math.min(sourceEndMs, segment.endMs + 80),
    }))
    .filter((segment) => segment.endMs > segment.startMs)
    .sort(compareTimeRanges);
  if (segments.length <= 1) {
    return undefined;
  }

  const merged: SmartSliceSourceSegment[] = [];
  for (const segment of segments) {
    const previous = merged.at(-1);
    if (previous && segment.startMs <= previous.endMs + 350) {
      previous.endMs = Math.max(previous.endMs, segment.endMs);
      continue;
    }
    merged.push({ ...segment });
  }
  return merged.length > 1 ? merged : undefined;
}

function createDeterministicSmartCutLlmReview(
  candidates: readonly SmartCutCandidate[],
  contentUnits: readonly SmartCutContentUnit[],
  customKeywords: readonly string[],
): { rankedCandidateIds: string[]; referencedUnitIds: string[]; reviewNotes: string[] } {
  const contentUnitById = new Map(contentUnits.map((unit) => [unit.id, unit]));
  const rankedCandidates = candidates
    .map((candidate, index) => ({
      candidate,
      index,
      keywordScore: scoreSmartCutCandidateKeywordMatch(candidate, contentUnitById, customKeywords),
    }))
    .sort((left, right) =>
      right.keywordScore - left.keywordScore ||
        (right.candidate.confidence ?? 0) - (left.candidate.confidence ?? 0) ||
        left.index - right.index ||
        left.candidate.id.localeCompare(right.candidate.id)
    )
    .map((entry) => entry.candidate);
  const topCandidateUnitIds = uniqueStrings(
    rankedCandidates.flatMap((candidate) => candidate.unitIds ?? []),
  );
  return {
    rankedCandidateIds: rankedCandidates.map((candidate) => candidate.id),
    referencedUnitIds: topCandidateUnitIds,
    reviewNotes: [
      customKeywords.length > 0
        ? 'Deterministic ID-only review ranked candidates with customKeywords while preserving engine-owned timestamps.'
        : 'Deterministic ID-only review used because no external LLM reviewer was provided.',
    ],
  };
}

function scoreSmartCutCandidateKeywordMatch(
  candidate: SmartCutCandidate,
  contentUnitById: ReadonlyMap<string, SmartCutContentUnit>,
  customKeywords: readonly string[],
): number {
  if (customKeywords.length === 0) {
    return 0;
  }
  const searchableText = normalizeSmartCutKeywordText([
    candidate.title,
    candidate.reason,
    ...candidate.unitIds.map((unitId) => contentUnitById.get(unitId)?.text ?? ''),
  ].join(' '));
  return customKeywords.reduce((score, keyword) =>
    searchableText.includes(keyword) ? score + 1 : score, 0);
}

function normalizeSmartCutCustomKeywords(value: readonly string[] | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueStrings(
    value
      .map((keyword) => normalizeSmartCutKeywordText(keyword))
      .filter((keyword) => keyword.length > 0 && keyword.length <= 64 && !/[{}"\\]/.test(keyword)),
  ).slice(0, 24);
}

function normalizeSmartCutKeywordText(value: string): string {
  return normalizeSmartSliceTranscriptEvidenceText(value).toLowerCase();
}

function createSmartCutCandidateReviewTitle(units: readonly SmartCutContentUnit[]): string {
  const text = normalizeSmartSliceTranscriptEvidenceText(units.map((unit) => unit.text ?? '').join(' '));
  return text.length > 56 ? text.slice(0, 56) : text || 'Speech semantic clip';
}

function hasSmartCutReviewSetupMarker(text: string): boolean {
  return /\b(?:watch|why|what|how|setup|context|background|onboarding|creator|analytics|funnel|workflow|case|problem|condition)\b/iu.test(text) ||
    /(?:\u80cc\u666f|\u95ee\u9898|\u6761\u4ef6|\u7533\u8bf7|\u7ecf\u9a8c|\u8def\u5f84)/u.test(text);
}

function hasSmartCutReviewConflictMarker(text: string): boolean {
  return /\b(?:pain|dropoff|drop-off|conflict|pricing|queue|risk|retention|support|escalation|conversion|boundary|fails?)\b/iu.test(text) ||
    /(?:\u75db\u70b9|\u51b2\u7a81|\u98ce\u9669|\u56f0\u96be|\u7559\u5b58|\u8f6c\u5316)/u.test(text);
}

function hasSmartCutReviewPayoffMarker(text: string): boolean {
  return /\b(?:payoff|result|answer|solution|complete|activation|publishing|retention|legal|entry|benefit|outcome|preserves?|clamps?)\b/iu.test(text) ||
    /(?:\u7ed3\u679c|\u7b54\u6848|\u89e3\u51b3|\u56de\u62a5|\u6700\u5feb|\u5408\u6cd5|\u5165\u5883|\u5bb6\u4eba|\u5b8c\u6574)/u.test(text);
}

function validateSmartCutEnginePlannerEvidence({
  transcriptEvidence,
  speakerEvidence,
  presetId,
  visualEvidence: _visualEvidence,
}: {
  transcriptEvidence: SmartCutTranscriptEvidence;
  speakerEvidence: SmartCutSpeakerEvidence;
  presetId: SmartCutProductPresetId;
  visualEvidence?: SmartCutVisualEvidence;
}): readonly SmartCutExecutionPackageBlocker[] {
  const blockers: SmartCutExecutionPackageBlocker[] = [];
  if (visualOrAudioNativePresetIds.has(presetId)) {
    blockers.push({
      code: 'UNSUPPORTED_MULTIMODAL_PRESET_EVIDENCE',
      message: `Smart Cut Engine preset ${presetId} requires visual, audio-event, music, OCR, or motion evidence adapters that are not all implemented in the current execution planner.`,
      remediation: 'Use a speech-semantic mode, or enable every required native evidence adapter before running this multimodal preset.',
      source: 'evidence-quality',
    });
  }
  if (transcriptEvidence.segments.length === 0) {
    blockers.push({
      code: 'MISSING_TRANSCRIPT_EVIDENCE',
      message: 'Smart Cut Engine planner received no valid timestamped transcript segments.',
      remediation: 'Run speech-to-text and provide non-empty timestamped transcript evidence before slicing.',
      source: 'speech-to-text',
    });
  }
  if (speakerEvidence.profiles.length === 0 || speakerEvidence.segments.length === 0) {
    blockers.push({
      code: 'MISSING_SPEAKER_DIARIZATION',
      message: 'Smart Cut Engine planner received no speaker profiles or speaker ranges.',
      remediation: 'Run speaker diarization, or create a rule-based single-speaker evidence adapter for talking-head videos.',
      source: 'speaker-diarization',
    });
  }
  if (requiresRealMultiSpeakerDiarization(presetId)) {
    const declaredTranscriptSpeakerIds = new Set(
      transcriptEvidence.segments
        .map((segment) => segment.speakerId?.trim())
        .filter((speakerId): speakerId is string => Boolean(speakerId)),
    );
    const segmentSpeakerIds = new Set(
      speakerEvidence.segments
        .map((segment) => segment.speakerId.trim())
        .filter(Boolean),
    );
    if (declaredTranscriptSpeakerIds.size < 2 || segmentSpeakerIds.size < 2) {
      blockers.push({
        code: 'MISSING_MULTI_SPEAKER_DIARIZATION',
        message: `Smart Cut Engine preset ${presetId} requires real speaker diarization from transcript evidence before dialogue slicing.`,
        remediation: 'Run speaker diarization and preserve at least interviewer/guest or moderator/speaker labels before Q/A, meeting, or multi-speaker semantic slicing.',
        source: 'speaker-diarization',
      });
    }
  }
  return blockers;
}

function requiresRealMultiSpeakerDiarization(presetId: SmartCutProductPresetId): boolean {
  return presetId === 'interview-one-question-one-answer' ||
    presetId === 'long-interview-matrix' ||
    presetId === 'meeting-minutes-highlights';
}

function resolveSmartCutProductPresetId(
  params: VideoSliceParams,
  transcriptEvidence: SmartCutTranscriptEvidence,
): SmartCutProductPresetId {
  const mode = normalizeSmartCutMode(params.mode);
  const durationMs = resolveOptionalSourceDurationMs(params) ?? transcriptEvidence.segments.at(-1)?.endMs ?? 0;
  const segmentationAgent = getAutoCutSmartSliceSegmentationAgentDefinition(params.segmentationAgentId);

  if (mode === 'meeting') {
    return 'meeting-minutes-highlights';
  }
  if (mode === 'dialogue') {
    return durationMs >= 180_000 ? 'long-interview-matrix' : 'interview-one-question-one-answer';
  }
  if (mode === 'commerce-live') {
    return 'commerce-live-product-cards';
  }
  if (mode === 'film') {
    return 'film-scene-index';
  }
  if (/meeting|conference|agenda|minutes|standup|\u5728\u7ebf\u4f1a\u8bae|\u4f1a\u8bae/iu.test(mode)) {
    return 'meeting-minutes-highlights';
  }
  if (/commerce|live|\u5546\u54c1|\u76f4\u64ad/iu.test(mode)) {
    return 'commerce-live-product-cards';
  }
  if (/documentary|\u7eaa\u5f55\u7247/iu.test(mode)) {
    return 'documentary-story-chapters';
  }
  if (/film|movie|\u7535\u5f71/iu.test(mode)) {
    return 'film-scene-index';
  }
  if (/interview|dialogue|qa|q&a|\u8bbf\u8c08|\u5bf9\u8bdd|\u95ee\u7b54|\u8fde\u7ebf|\u53cc\u4eba|\u591a\u4eba/iu.test(mode)) {
    return durationMs >= 180_000 ? 'long-interview-matrix' : 'interview-one-question-one-answer';
  }
  if (/long|matrix/iu.test(mode) && durationMs >= 180_000) {
    return 'long-interview-matrix';
  }
  if (segmentationAgent.id === 'dialogue-turn-agent') {
    return durationMs >= 180_000 ? 'long-interview-matrix' : 'interview-one-question-one-answer';
  }
  if (segmentationAgent.id === 'teaching-step-agent') {
    return 'teacher-talking-head-single';
  }
  return 'teacher-talking-head-single';
}

export function resolveSmartCutEngineMaximumCandidateGapMs(params: VideoSliceParams): number {
  return getVideoSlicePlanningPolicy(params).candidateJoinGapMs;
}

function resolveSmartCutMediaKind(presetId: SmartCutProductPresetId): SmartCutMediaKind {
  if (presetId === 'interview-one-question-one-answer' || presetId === 'long-interview-matrix') {
    return 'interview';
  }
  if (presetId === 'meeting-minutes-highlights') {
    return 'meeting';
  }
  if (presetId === 'commerce-live-product-cards') {
    return 'commerce-live';
  }
  if (presetId === 'film-scene-index') {
    return 'film';
  }
  if (presetId === 'documentary-story-chapters') {
    return 'documentary';
  }
  if (presetId === 'music-beat-clips') {
    return 'music-video';
  }
  if (presetId === 'sports-highlight-reel') {
    return 'sports';
  }
  if (presetId === 'gaming-highlight-reel') {
    return 'gaming';
  }
  if (presetId === 'screen-recording-tutorial') {
    return 'screen-recording';
  }
  return 'talking-head';
}

function normalizeSmartCutMode(mode: VideoSliceParams['mode']): string {
  return String(mode ?? '').trim().toLowerCase();
}

export function isSmartCutVisualSceneMode(mode: VideoSliceParams['mode']): boolean {
  return resolveSmartCutProductPresetIdFromMode(mode) === 'film-scene-index';
}

export function isSmartCutUnsupportedMultimodalMode(mode: VideoSliceParams['mode']): boolean {
  return resolveSmartCutProductPresetIdFromMode(mode) !== undefined &&
    resolveSmartCutProductPresetIdFromMode(mode) !== 'film-scene-index';
}

function resolveSmartCutProductPresetIdFromMode(
  mode: VideoSliceParams['mode'],
): SmartCutProductPresetId | undefined {
  const normalizedMode = normalizeSmartCutMode(mode);
  if (normalizedMode === 'film' || /film|movie|\u7535\u5f71/iu.test(normalizedMode)) {
    return 'film-scene-index';
  }
  if (/documentary|\u7eaa\u5f55\u7247/iu.test(normalizedMode)) {
    return 'documentary-story-chapters';
  }
  if (/music|beat|\u97f3\u4e50/iu.test(normalizedMode)) {
    return 'music-beat-clips';
  }
  if (/sports?|highlight|\u4f53\u80b2/iu.test(normalizedMode)) {
    return 'sports-highlight-reel';
  }
  if (/gaming|game|\u6e38\u620f/iu.test(normalizedMode)) {
    return 'gaming-highlight-reel';
  }
  if (/screen|recording|tutorial|\u5f55\u5c4f/iu.test(normalizedMode)) {
    return 'screen-recording-tutorial';
  }
  return undefined;
}

function resolveSourceDurationMs(input: CreateSmartCutEngineSlicePlanInput): number {
  const explicitDurationMs = input.sourceDurationMs ?? input.params.sourceDurationMs;
  if (typeof explicitDurationMs === 'number' && Number.isFinite(explicitDurationMs) && explicitDurationMs > 0) {
    return Math.round(explicitDurationMs);
  }
  const transcriptEndMs = input.transcriptSegments.reduce(
    (max, segment) => Math.max(max, Number(segment.endMs) || 0), 0,
  );
  return Math.max(minimumSourceDurationMs, Math.round(transcriptEndMs));
}

function resolveOptionalSourceDurationMs(params: VideoSliceParams): number | undefined {
  return typeof params.sourceDurationMs === 'number' && Number.isFinite(params.sourceDurationMs) && params.sourceDurationMs > 0
    ? Math.round(params.sourceDurationMs)
    : undefined;
}

function createSmartCutRunId(input: CreateSmartCutEngineSlicePlanInput, suffix: string): string {
  return `smart-cut-engine-${input.sourceAssetUuid?.trim() || 'source'}-${suffix}`;
}

function validateSmartCutEngineLlmReviewResult(raw: unknown): { rankedCandidateIds: string[]; referencedUnitIds: string[]; reviewNotes: string[] } {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('LLM review result is not an object');
  }
  if (Array.isArray(raw)) {
    throw new Error('LLM review result is an array, expected an object');
  }
  const obj = raw as Record<string, unknown>;
  const rankedCandidateIds = Array.isArray(obj.rankedCandidateIds)
    ? obj.rankedCandidateIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : [];
  const referencedUnitIds = Array.isArray(obj.referencedUnitIds)
    ? obj.referencedUnitIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : [];
  const reviewNotes = Array.isArray(obj.reviewNotes)
    ? obj.reviewNotes.filter((note): note is string => typeof note === 'string')
    : [];
  if (rankedCandidateIds.length === 0 && Array.isArray(obj.rankedCandidateIds) && obj.rankedCandidateIds.length > 0) {
    reviewNotes.push('LLM review rankedCandidateIds contained no valid non-empty string IDs after validation.');
  }
  return { rankedCandidateIds, referencedUnitIds, reviewNotes };
}

function parseSmartCutEngineLlmReviewJson(content: string): unknown {
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // fall through to code block extraction
  }
  const jsonBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch?.[1]) {
    try {
      const parsed = JSON.parse(jsonBlockMatch[1]);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // fall through to brace-matching strategy
    }
  }
  let depth = 0;
  let objectStart = -1;
  let inString = false;
  let escapeNext = false;
  for (let index = 0; index < content.length; index += 1) {
    const ch = content[index];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escapeNext = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') {
      if (depth === 0) {
        objectStart = index;
      }
      depth += 1;
    } else if (ch === '}') {
      depth = Math.max(0, depth - 1);
      if (depth === 0 && objectStart >= 0) {
        try {
          const parsed = JSON.parse(content.slice(objectStart, index + 1));
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            return parsed;
          }
          objectStart = -1;
        } catch {
          objectStart = -1;
        }
      }
    }
  }
  return {
    rankedCandidateIds: [],
    referencedUnitIds: [],
    reviewNotes: ['LLM reviewer returned invalid JSON; Smart Cut Engine will block if review coverage is incomplete.'],
  };
}

function normalizeIntegerMs(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.round(value);
}

function normalizeSpeakerId(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }
  return `speaker-${value.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/giu, '-').replace(/^-+|-+$/gu, '') || 'unknown'}`;
}

function isSmartCutQuestionText(text: string): boolean {
  const normalizedText = text.replace(/\s+/gu, ' ').trim();
  return /[?\uFF1F]\s*$/u.test(normalizedText) ||
    /^(?:when|what|why|how|who|where|which|should|can|could|would|is|are|do|does)\b/iu.test(normalizedText) ||
    /^(?:\u4ec0\u4e48|\u4e3a\u4ec0\u4e48|\u600e\u4e48|\u5982\u4f55|\u8c01|\u54ea\u91cc|\u54ea\u4e2a|\u662f\u5426|\u80fd\u5426|\u8981\u4e0d\u8981)/u.test(normalizedText);
}

function createSpeakerDisplayName(role: SmartCutSpeakerRole, speakerId: string): string {
  if (role === 'teacher') {
    return 'Teacher';
  }
  if (role === 'interviewer') {
    return 'Interviewer';
  }
  if (role === 'guest') {
    return 'Guest';
  }
  return speakerId;
}

function averageScore(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const finiteValues = values.filter(Number.isFinite);
  if (finiteValues.length === 0) {
    return 0;
  }
  return roundScore(finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length);
}

function scoreToPublishabilityGrade(score: number): NonNullable<NormalizedSlicePlanClip['publishabilityGrade']> {
  if (score >= 0.86) {
    return 'excellent';
  }
  if (score >= 0.72) {
    return 'good';
  }
  if (score >= 0.5) {
    return 'review';
  }
  return 'reject';
}

function scoreToContentArcGrade(score: number): NonNullable<NormalizedSlicePlanClip['contentArcGrade']> {
  if (score >= 0.86) {
    return 'complete';
  }
  if (score >= 0.68) {
    return 'partial';
  }
  return 'thin';
}

function scoreToTopicCoherenceGrade(score: number): NonNullable<NormalizedSlicePlanClip['topicCoherenceGrade']> {
  if (score >= 0.84) {
    return 'strong';
  }
  if (score >= 0.62) {
    return 'mixed';
  }
  return 'weak';
}

function scoreToPlatformReadinessGrade(score: number): NonNullable<NormalizedSlicePlanClip['platformReadinessGrade']> {
  if (score >= 0.86) {
    return 'ready';
  }
  if (score >= 0.58) {
    return 'review';
  }
  return 'reject';
}

function roundScore(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function compareTimeRanges(
  left: { startMs: number; endMs: number; id?: string },
  right: { startMs: number; endMs: number; id?: string },
): number {
  return left.startMs - right.startMs ||
    left.endMs - right.endMs ||
    (left.id !== undefined && right.id !== undefined ? left.id.localeCompare(right.id) : 0);
}
