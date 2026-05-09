import { resolveAutoCutTrustedSourcePath } from '@sdkwork/autocut-commons';
import {
  AUTOCUT_TASK_STATUS,
  AUTOCUT_TASK_TYPE,
  AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD,
  type AppTask,
  type AutoCutTranscriptSegment,
  type TaskSliceResult,
  type VideoSliceParams,
} from '@sdkwork/autocut-types';
import {
  addAsset,
  addMessage,
  addTask,
  assertAutoCutNativeArtifactInsideTaskOutputDir,
  assertAutoCutNativeVideoCoverInsideTaskCoverDir,
  createAutoCutId,
  createAutoCutTaskName,
  createAutoCutOpenAiCompatibleChatCompletion,
  createAutoCutTimestamp,
  getAutoCutNativeHostClient,
  resolveAutoCutOutputRootDir,
  transcribeAutoCutMediaWithConfiguredProvider,
  failAutoCutProcessingTask,
  failAutoCutUnsupportedNativeProcessingTask,
  reportAutoCutDiagnostic,
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
  buildTranscriptSliceCandidates,
  createDeterministicSlicePlan,
  createTranscriptAssistedSlicePlan,
  getVideoSlicePlanningPolicy,
  normalizeSliceDurationMs,
  parseLlmSlicePlan,
  validateVideoSliceParams,
  type VideoSlicePlanningPolicy,
  type NormalizedSlicePlanClip,
} from './slicePlanner';

const {
  maxLeadingSilenceMs: MAX_SMART_SLICE_LEADING_SILENCE_MS,
  maxTrailingSilenceMs: MAX_SMART_SLICE_TRAILING_SILENCE_MS,
  minTranscriptCoverageScore: MIN_SMART_SLICE_TRANSCRIPT_COVERAGE_SCORE,
  acceptedSpeechContinuityGrades: SMART_SLICE_ACCEPTED_SPEECH_CONTINUITY_GRADES,
} = AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD;
const SMART_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS = 80;
const MAX_SMART_SLICE_TRANSCRIPT_OVERLAP_REPAIR_MS = 250;

type SmartSliceExecutionStepId =
  | 'prepare-source'
  | 'speech-to-text'
  | 'plan-clips'
  | 'native-render'
  | 'verify-artifacts'
  | 'persist-results';

interface SmartSliceExecutionStep {
  id: SmartSliceExecutionStepId;
  label: string;
  progressBefore: number;
  progressAfter: number;
  progressMessage: string;
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
    id: createAutoCutId('newTask'),
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

async function createIntelligentSlicePlan(
  params: VideoSliceParams,
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[] = [],
) {
  const trustedSourceDurationMs = resolveTrustedVideoSliceSourceDurationMs(params);
  if (trustedSourceDurationMs !== undefined && trustedSourceDurationMs < 5_000) {
    throw new Error('AutoCut source video is too short to produce a valid video slice.');
  }

  const planningParams = {
    ...params,
    ...(trustedSourceDurationMs !== undefined ? { sourceDurationMs: trustedSourceDurationMs } : {}),
  };
  const planningPolicy = getVideoSlicePlanningPolicy(planningParams);
  const transcriptCandidates = buildTranscriptSliceCandidates(planningParams, transcriptSegments);
  if (transcriptSegments.length > 0 && transcriptCandidates.length === 0) {
    reportVideoSliceStageDiagnostic('transcript candidate fallback', {
      transcriptSegmentCount: transcriptSegments.length,
      sourceDurationMs: trustedSourceDurationMs,
      reason: 'no transcript candidate windows were generated from timestamped STT segments',
    });
  }

  const fallbackPlan =
    transcriptSegments.length > 0
      ? createTranscriptAssistedSlicePlan(planningParams, transcriptSegments)
      : createDeterministicSlicePlan(planningParams);
  if (transcriptSegments.length > 0 && fallbackPlan.length === 0) {
    throw new Error(
      'AutoCut transcript speech has no renderable timestamped segment. Check speech-to-text output timestamps and retry Smart Slice.',
    );
  }

  try {
    const transcriptTimeline = createCandidateCenteredTranscriptTimeline(transcriptSegments, transcriptCandidates);
    const result = await createAutoCutOpenAiCompatibleChatCompletion({
      model: params.llmModel,
      messages: [
        {
          role: 'system',
          content:
            'You are AutoCut video highlight planner. Select continuous short-video windows only. Return only a compact JSON array with candidateId or startMs, durationMs/endMs, title, qualityScore, continuityScore, and risks.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            mode: params.mode,
            baseAlgorithm: params.baseAlgorithm,
            highlightEngine: params.highlightEngine,
            planningPolicy,
            publishingTarget: {
              platform: planningPolicy.targetPlatform,
              aspectRatio: planningPolicy.targetAspectRatio,
              objectFit: planningPolicy.videoObjectFit,
            },
            minDurationMs: normalizeSliceDurationMs(params.minDuration),
            maxDurationMs: normalizeSliceDurationMs(params.maxDuration),
            idealDurationMs: planningPolicy.idealDurationMs,
            requestedClipCount: planningPolicy.targetSliceCount,
            sliceCountMode: planningPolicy.sliceCountMode,
            continuityLevel: planningPolicy.continuityLevel,
            continuityJoinGapMs: planningPolicy.continuityJoinGapMs,
            continuityOverlapToleranceMs: planningPolicy.continuityOverlapToleranceMs,
            customKeywords: planningPolicy.customKeywords,
            filters: {
              noiseReduction: params.enableNoiseReduction,
              coughFilter: params.enableCoughFilter,
              repeatFilter: params.enableRepeatFilter,
              subtitles: params.enableSubtitles,
            },
            phaseOneRules: [
              'Each output clip must be one continuous source interval.',
              'Prefer candidateWindows because they have deterministic continuity repair.',
              'If transcript candidateWindows are present, choose candidateId instead of inventing raw midpoint timings.',
              'Do not start clips at weak connector words unless the previous context is included.',
              'Do not end clips at trailing connector words; include the next transcript segment when speech is incomplete.',
              'Return fewer high-quality choices before inventing weak fixed-interval clips.',
              'For fixed or coverage-first mode, fill up to requestedClipCount with continuous non-overlapping intervals.',
              'For quality-first mode, return only strong publishable windows even if fewer than requestedClipCount.',
            ],
            transcriptAssisted: transcriptCandidates.length > 0,
            candidateWindows: transcriptCandidates.map((candidate) => ({
              id: candidate.candidateId,
              startMs: candidate.startMs,
              endMs: candidate.endMs,
              durationMs: candidate.durationMs,
              label: candidate.label,
              score: candidate.score,
              qualityScore: candidate.qualityScore,
              continuityScore: candidate.continuityScore,
              storyShape: candidate.storyShape,
              publishabilityScore: candidate.publishabilityScore,
              publishabilityGrade: candidate.publishabilityGrade,
              publishabilityIssues: candidate.publishabilityIssues,
              boundaryQualityScore: candidate.boundaryQualityScore,
              hookStrength: candidate.hookStrength,
              endingCompleteness: candidate.endingCompleteness,
              contentArcScore: candidate.contentArcScore,
              contentArcGrade: candidate.contentArcGrade,
              contentArcStages: candidate.contentArcStages,
              contentArcMissingStages: candidate.contentArcMissingStages,
              topicCoherenceScore: candidate.topicCoherenceScore,
              topicCoherenceGrade: candidate.topicCoherenceGrade,
              topicShiftCount: candidate.topicShiftCount,
              topicKeywords: candidate.topicKeywords,
              platformReadinessScore: candidate.platformReadinessScore,
              platformReadinessGrade: candidate.platformReadinessGrade,
              platformReadinessIssues: candidate.platformReadinessIssues,
              sentenceBoundaryIntegrityScore: candidate.sentenceBoundaryIntegrityScore,
              sentenceBoundaryIntegrityGrade: candidate.sentenceBoundaryIntegrityGrade,
              sentenceBoundaryIssues: candidate.sentenceBoundaryIssues,
              risks: candidate.risks,
              summary: candidate.summary,
              transcriptCoverageScore: candidate.transcriptCoverageScore,
              transcriptSegmentCount: candidate.transcriptSegmentCount,
              speechContinuityGrade: candidate.speechContinuityGrade,
              speechStartMs: candidate.speechStartMs,
              speechEndMs: candidate.speechEndMs,
              boundaryPaddingBeforeMs: candidate.boundaryPaddingBeforeMs,
              boundaryPaddingAfterMs: candidate.boundaryPaddingAfterMs,
              anchorSegmentIndex: candidate.anchorSegmentIndex,
              text: candidate.text,
            })),
            transcriptTimeline,
          }),
        },
      ],
    });

    return parseLlmSlicePlan(result.content, planningParams, fallbackPlan, transcriptCandidates);
  } catch {
    return fallbackPlan;
  }
}

function resolveTrustedVideoSliceSourceDurationMs(params: VideoSliceParams) {
  if (typeof params.sourceDurationMs === 'number' && Number.isFinite(params.sourceDurationMs) && params.sourceDurationMs > 0) {
    return Math.round(params.sourceDurationMs);
  }

  return undefined;
}

function createCandidateCenteredTranscriptTimeline(
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
  transcriptCandidates: readonly NormalizedSlicePlanClip[],
) {
  const maxTimelineSegments = 80;
  const selectedSegmentIndexes = new Set<number>();
  for (const candidate of transcriptCandidates) {
    const speechStartMs = typeof candidate.speechStartMs === 'number' ? candidate.speechStartMs : candidate.startMs;
    const speechEndMs = typeof candidate.speechEndMs === 'number' ? candidate.speechEndMs : candidate.startMs + candidate.durationMs;
    const anchorIndex = transcriptSegments.findIndex((segment) =>
      segment.endMs > speechStartMs && segment.startMs < speechEndMs,
    );
    if (anchorIndex < 0) {
      continue;
    }

    for (
      let index = Math.max(0, anchorIndex - 1);
      index <= Math.min(transcriptSegments.length - 1, anchorIndex + 2);
      index += 1
    ) {
      selectedSegmentIndexes.add(index);
    }
  }

  for (let index = 0; index < transcriptSegments.length && selectedSegmentIndexes.size < maxTimelineSegments; index += 1) {
    selectedSegmentIndexes.add(index);
  }

  return [...selectedSegmentIndexes]
    .sort((firstIndex, secondIndex) => firstIndex - secondIndex)
    .slice(0, maxTimelineSegments)
    .map((index) => transcriptSegments[index])
    .filter((segment): segment is AutoCutSpeechTranscriptionSegment => Boolean(segment))
    .map((segment) => ({
      startMs: segment.startMs,
      endMs: segment.endMs,
      speaker: segment.speaker,
      text: segment.text,
    }));
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
  const sliceTranscriptSegments = createVideoSliceTranscriptSegments(plannedClip, nativeSlice, transcriptSegments);
  const sliceTranscriptText = createVideoSliceTranscriptText(sliceTranscriptSegments);
  const sliceResult = {
    id: nativeSlice.artifactUuid,
    name: `${newTask.name}_${nativeSlice.label || `高光片段 ${index + 1}`}.mp4`,
    duration: Math.max(1, Math.round(nativeSlice.durationMs / 1_000)),
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
    ...(plannedClip?.risks ? { risks: plannedClip.risks } : {}),
    sourceStartMs: plannedClip?.sourceStartMs ?? nativeSlice.startMs,
    sourceEndMs: plannedClip?.sourceEndMs ?? nativeSlice.startMs + nativeSlice.durationMs,
    speechStartMs: plannedClip?.speechStartMs ?? plannedClip?.sourceStartMs ?? nativeSlice.startMs,
    speechEndMs:
      plannedClip?.speechEndMs ??
      plannedClip?.sourceEndMs ??
      nativeSlice.startMs + nativeSlice.durationMs,
    boundaryPaddingBeforeMs: plannedClip?.boundaryPaddingBeforeMs ?? 0,
    boundaryPaddingAfterMs: plannedClip?.boundaryPaddingAfterMs ?? 0,
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

function createVideoSliceTranscriptSegments(
  plannedClip: NormalizedSlicePlanClip | undefined,
  nativeSlice: AutoCutVideoSliceArtifactResult,
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
): AutoCutTranscriptSegment[] {
  const sourceStartMs = plannedClip?.sourceStartMs ?? nativeSlice.startMs;
  const sourceEndMs = plannedClip?.sourceEndMs ?? nativeSlice.startMs + nativeSlice.durationMs;
  if (!Number.isFinite(sourceStartMs) || !Number.isFinite(sourceEndMs) || sourceEndMs <= sourceStartMs) {
    return [];
  }

  const orderedSegments = transcriptSegments
    .filter((segment) =>
      segment.endMs > sourceStartMs &&
      segment.startMs < sourceEndMs &&
      segment.text.trim().length > 0
    )
    .map((segment) => ({
      startMs: Math.max(sourceStartMs, Math.round(segment.startMs)),
      endMs: Math.min(sourceEndMs, Math.round(segment.endMs)),
      text: segment.text.trim().replace(/\s+/gu, ' '),
      ...(segment.speaker?.trim() ? { speaker: segment.speaker.trim() } : {}),
    }))
    .filter((segment) => segment.endMs > segment.startMs && segment.text.length > 0)
    .sort((firstSegment, secondSegment) =>
      firstSegment.startMs - secondSegment.startMs ||
      firstSegment.endMs - secondSegment.endMs,
    );

  return repairLightlyOverlappingVideoSliceTranscriptSegments(orderedSegments);
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
      Math.abs(firstTranscriptSegmentStartMs - speechStartMs) > SMART_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS ||
      Math.abs(lastTranscriptSegmentEndMs - speechEndMs) > SMART_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS
    ) {
      throw new Error(
        `Smart slicing requires slice ${sliceNumber} speech range to match structured transcript segment boundaries.`,
      );
    }
  });
}

function assertSmartSliceMilliseconds(value: unknown, sliceNumber: number, fieldName: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Smart slicing requires slice ${sliceNumber} ${fieldName} to be a non-negative millisecond value.`);
  }

  return Math.round(value);
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
  let previousRenderedEndMs: number | undefined;

  plannedClips.forEach((clip, index) => {
    const clipNumber = index + 1;
    const startMs = assertPlannedSmartSliceMilliseconds(clip.startMs, clipNumber, 'startMs');
    const durationMs = assertPositivePlannedSmartSliceMilliseconds(clip.durationMs, clipNumber, 'durationMs');
    const renderedEndMs = startMs + durationMs;
    if (!Number.isFinite(renderedEndMs)) {
      throw new Error(`Smart slicing requires planned clip ${clipNumber} end time to be finite.`);
    }
    if (previousRenderedEndMs !== undefined && startMs < previousRenderedEndMs) {
      throw new Error(
        `Smart slicing requires planned clip ${clipNumber} to start after the previous rendered clip ends.`,
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
    const speechStartMs = assertPlannedSmartSliceMilliseconds(
      clip.speechStartMs ?? sourceStartMs,
      clipNumber,
      'speechStartMs',
    );
    const speechEndMs = assertPlannedSmartSliceMilliseconds(
      clip.speechEndMs ?? sourceEndMs,
      clipNumber,
      'speechEndMs',
    );

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
        `Smart slicing requires planned clip ${clipNumber} speech range to stay inside its rendered source range.`,
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

    const clipTranscriptSegments = createVideoSliceTranscriptSegments(
      { ...clip, sourceStartMs, sourceEndMs },
      { startMs, durationMs } as AutoCutVideoSliceArtifactResult,
      transcriptSegments,
    );
    if (clipTranscriptSegments.length === 0) {
      throw new Error(
        `Smart slicing requires planned clip ${clipNumber} structured speech-to-text transcript segments before native rendering.`,
      );
    }
    if (
      typeof clip.transcriptSegmentCount === 'number' &&
      clip.transcriptSegmentCount !== clipTranscriptSegments.length
    ) {
      throw new Error(
        `Smart slicing requires planned clip ${clipNumber} transcriptSegmentCount to match structured speech-to-text coverage.`,
      );
    }

    const expectedTranscriptText = createVideoSliceTranscriptText(clipTranscriptSegments);
    if (!expectedTranscriptText) {
      throw new Error(
        `Smart slicing requires planned clip ${clipNumber} visible speech-to-text transcript text before native rendering.`,
      );
    }
    if (
      clip.transcriptText &&
      normalizeVideoSliceTranscriptEvidenceText(clip.transcriptText) !== expectedTranscriptText
    ) {
      throw new Error(
        `Smart slicing requires planned clip ${clipNumber} transcriptText to match structured speech-to-text coverage.`,
      );
    }
    if (
      typeof clip.transcriptCoverageScore !== 'number' ||
      !Number.isFinite(clip.transcriptCoverageScore) ||
      clip.transcriptCoverageScore < MIN_SMART_SLICE_TRANSCRIPT_COVERAGE_SCORE
    ) {
      throw new Error(
        `Smart slicing requires planned clip ${clipNumber} transcriptCoverageScore to be at least ${MIN_SMART_SLICE_TRANSCRIPT_COVERAGE_SCORE}.`,
      );
    }
    if (
      !SMART_SLICE_ACCEPTED_SPEECH_CONTINUITY_GRADES.includes(
        clip.speechContinuityGrade as typeof SMART_SLICE_ACCEPTED_SPEECH_CONTINUITY_GRADES[number],
      )
    ) {
      throw new Error(
        `Smart slicing requires planned clip ${clipNumber} speechContinuityGrade to be strong or repaired.`,
      );
    }

    const firstTranscriptSegmentStartMs = clipTranscriptSegments[0]?.startMs;
    const lastTranscriptSegmentEndMs = clipTranscriptSegments.at(-1)?.endMs;
    if (
      firstTranscriptSegmentStartMs === undefined ||
      lastTranscriptSegmentEndMs === undefined ||
      Math.abs(firstTranscriptSegmentStartMs - speechStartMs) > SMART_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS ||
      Math.abs(lastTranscriptSegmentEndMs - speechEndMs) > SMART_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS
    ) {
      throw new Error(
        `Smart slicing requires planned clip ${clipNumber} speech range to match structured transcript segment boundaries.`,
      );
    }

    previousRenderedEndMs = renderedEndMs;
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
    assertNativeSliceTimingMatchesPlan(nativeSlice, plannedClips[index], sliceNumber);
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

  if (nativeSlice.startMs !== plannedClip.startMs || nativeSlice.durationMs !== plannedClip.durationMs) {
    throw new Error(
      `AutoCut native video slicing slice artifact ${sliceNumber} timing does not match planned clip ${sliceNumber}.`,
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
    (requestedSubtitleMode === 'srt' || requestedSubtitleMode === 'both' || requestedSubtitleMode === undefined);
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
  } else if (requestedSubtitleMode === 'burned' && hasSubtitleArtifact) {
    throw new Error(
      `AutoCut native video slicing slice artifact ${sliceNumber} returned a subtitle sidecar for burned-only subtitle mode.`,
    );
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

function toNativeSliceClipRequest(
  clip: NormalizedSlicePlanClip,
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
): AutoCutVideoSliceClipRequest {
  const clipTranscriptSegments = createVideoSliceTranscriptSegments(
    clip,
    { startMs: clip.startMs, durationMs: clip.durationMs } as AutoCutVideoSliceArtifactResult,
    transcriptSegments,
  );
  const clipTranscriptText = createVideoSliceTranscriptText(clipTranscriptSegments);

  return {
    startMs: clip.startMs,
    durationMs: clip.durationMs,
    label: clip.label,
    outputFileName: createPlannedSliceOutputFileName(clip),
    ...(clip.sourceStartMs !== undefined ? { sourceStartMs: clip.sourceStartMs } : {}),
    ...(clip.sourceEndMs !== undefined ? { sourceEndMs: clip.sourceEndMs } : {}),
    ...(clip.speechStartMs !== undefined ? { speechStartMs: clip.speechStartMs } : {}),
    ...(clip.speechEndMs !== undefined ? { speechEndMs: clip.speechEndMs } : {}),
    ...(clip.boundaryPaddingBeforeMs !== undefined
      ? { boundaryPaddingBeforeMs: clip.boundaryPaddingBeforeMs }
      : {}),
    ...(clip.boundaryPaddingAfterMs !== undefined
      ? { boundaryPaddingAfterMs: clip.boundaryPaddingAfterMs }
      : {}),
    ...(clipTranscriptText ? { transcriptText: clipTranscriptText } : clip.transcriptText ? { transcriptText: clip.transcriptText } : {}),
    ...(clipTranscriptSegments.length ? { transcriptSegments: clipTranscriptSegments } : {}),
    ...(clipTranscriptSegments.length
      ? { transcriptSegmentCount: clipTranscriptSegments.length }
      : clip.transcriptSegmentCount !== undefined
        ? { transcriptSegmentCount: clip.transcriptSegmentCount }
        : {}),
    ...(clip.transcriptCoverageScore !== undefined ? { transcriptCoverageScore: clip.transcriptCoverageScore } : {}),
    ...(clip.speechContinuityGrade ? { speechContinuityGrade: clip.speechContinuityGrade } : {}),
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
  transcriptSegments: AutoCutSpeechTranscriptionSegment[],
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

function createVideoSliceSubtitleSegments(
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
): AutoCutSpeechTranscriptionSegment[] {
  const orderedSegments = transcriptSegments
    .map((segment) => ({
      startMs: Math.round(segment.startMs),
      endMs: Math.round(segment.endMs),
      text: segment.text.trim().replace(/\s+/gu, ' '),
      ...(segment.speaker?.trim() ? { speaker: segment.speaker.trim() } : {}),
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
    const previousSegment = subtitleSegments.at(-1);
    const startMs = previousSegment ? Math.max(segment.startMs, previousSegment.endMs) : segment.startMs;
    if (segment.endMs <= startMs) {
      continue;
    }

    subtitleSegments.push({
      ...segment,
      startMs,
    });
  }

  return subtitleSegments;
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

async function runSmartSliceExecutionStep<TResult>(
  taskId: string,
  stepId: SmartSliceExecutionStepId,
  operation: () => Promise<TResult>,
  details: Record<string, unknown> = {},
): Promise<TResult> {
  const step = SMART_SLICE_EXECUTION_STEP_BY_ID.get(stepId);
  if (!step) {
    throw new Error(`Unknown Smart Slice execution step: ${stepId}`);
  }

  await updateTask(taskId, {
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
    await updateTask(taskId, {
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
    reportVideoSliceStageDiagnostic(`${step.id} failed`, {
      taskId,
      label: step.label,
      progressBefore: step.progressBefore,
      progressAfter: step.progressAfter,
      errorMessage: error instanceof Error ? error.message : String(error),
      ...details,
    });
    throw error;
  }
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

export async function processVideoSlice(params: VideoSliceParams) {
  reportVideoSliceStageDiagnostic('validation started', {
    hasFile: Boolean(params.file),
    hasFileId: Boolean(params.fileId?.trim()),
    hasUrl: Boolean(params.url?.trim()),
    minDuration: params.minDuration,
    maxDuration: params.maxDuration,
    idealDuration: params.idealDuration,
    targetSliceCount: params.targetSliceCount,
    targetPlatform: params.targetPlatform,
    sliceCountMode: params.sliceCountMode,
  });
  validateAutoCutProcessingSource({ ...params, allowExternalUrl: true });
  validateVideoSliceParams(params);

  const newTask = createVideoSliceTask(params);
  await addTask(newTask);

  const nativeHostClient = getAutoCutNativeHostClient();
  const desktopSourcePath = resolveAutoCutTrustedSourcePath(params.file);
  const selectedNativeAssetUuid = params.fileId?.trim() ?? '';
  const capabilities = await nativeHostClient.getCapabilities();
  const canSliceWithNativeHost =
    (desktopSourcePath ? capabilities.mediaImportCommandReady : Boolean(selectedNativeAssetUuid)) &&
    capabilities.videoSliceCommandReady;
  reportVideoSliceStageDiagnostic('native preflight', {
    taskId: newTask.id,
    hasTrustedDesktopSource: Boolean(desktopSourcePath),
    hasSelectedNativeAsset: Boolean(selectedNativeAssetUuid),
    mediaImportCommandReady: capabilities.mediaImportCommandReady,
    videoSliceCommandReady: capabilities.videoSliceCommandReady,
    speechTranscriptionCommandReady: capabilities.speechTranscriptionCommandReady,
    speechTranscriptionToolchainReady: capabilities.speechTranscriptionToolchainReady,
    speechTranscriptionProbeCommandReady: capabilities.speechTranscriptionProbeCommandReady,
    canSliceWithNativeHost,
  });

  if (canSliceWithNativeHost && (desktopSourcePath || selectedNativeAssetUuid)) {
    let durableTaskId = newTask.id;

    try {
      const outputRootDir = await resolveAutoCutOutputRootDir();
      const selectedNativeSourceDurationMs = resolveTrustedVideoSliceSourceDurationMs(params);
      reportSmartSliceExecutionPlan(newTask.id, {
        hasTrustedDesktopSource: Boolean(desktopSourcePath),
        hasSelectedNativeAsset: Boolean(selectedNativeAssetUuid),
        outputRootDir,
        selectedNativeSourceDurationMs,
      });
      const sourceMedia: { assetUuid: string; durationMs?: number } = await runSmartSliceExecutionStep(
        newTask.id,
        'prepare-source',
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
        {
          importedMedia: Boolean(desktopSourcePath),
          selectedNativeAssetUuid: selectedNativeAssetUuid || undefined,
        },
      );
      reportVideoSliceStageDiagnostic('source ready', {
        taskId: newTask.id,
        sourceAssetUuid: sourceMedia.assetUuid,
        sourceDurationMs: sourceMedia.durationMs,
        importedMedia: Boolean(desktopSourcePath),
      });
      let transcriptSegments: AutoCutSpeechTranscriptionSegment[] = [];
      transcriptSegments = await runSmartSliceExecutionStep(
        newTask.id,
        'speech-to-text',
        async () => {
          try {
            const transcription = await transcribeAutoCutMediaWithConfiguredProvider({
              assetUuid: sourceMedia.assetUuid,
              language: 'auto',
              workflowPurpose: 'smart-slice-transcript-evidence',
              ...(outputRootDir ? { outputRootDir } : {}),
            });
            if (transcription.segments.length === 0) {
              throw new Error('Speech-to-text returned no transcript segments.');
            }
            reportVideoSliceStageDiagnostic('speech-to-text ready', {
              taskId: newTask.id,
              sourceAssetUuid: sourceMedia.assetUuid,
              transcriptSegmentCount: transcription.segments.length,
              transcriptStartMs: transcription.segments[0]?.startMs,
              transcriptEndMs: transcription.segments.at(-1)?.endMs,
              providerId: transcription.providerId,
            });
            return transcription.segments;
          } catch (transcriptionError) {
            reportVideoSliceStageDiagnostic('speech-to-text failed', {
              taskId: newTask.id,
              sourceAssetUuid: sourceMedia.assetUuid,
              errorMessage: transcriptionError instanceof Error ? transcriptionError.message : String(transcriptionError),
            });
            throw new Error(
              `Smart slicing requires successful speech-to-text transcription before planning clips. ${String(transcriptionError)}`,
            );
          }
        },
        {
          sourceAssetUuid: sourceMedia.assetUuid,
          sourceDurationMs: sourceMedia.durationMs,
        },
      );
      const planningPolicy = getVideoSlicePlanningPolicy(params);
      const renderProfile = createVideoSliceRenderProfile(planningPolicy);
      const planningParams = {
        ...params,
        ...(sourceMedia.durationMs !== undefined ? { sourceDurationMs: sourceMedia.durationMs } : {}),
      };
      const plannedClips = await runSmartSliceExecutionStep(
        newTask.id,
        'plan-clips',
        async () => {
          const resolvedPlannedClips = await createIntelligentSlicePlan(planningParams, transcriptSegments);
          reportVideoSliceStageDiagnostic('plan ready', {
            taskId: newTask.id,
            sourceAssetUuid: sourceMedia.assetUuid,
            plannedClipCount: resolvedPlannedClips.length,
            transcriptSegmentCount: transcriptSegments.length,
            sourceDurationMs: sourceMedia.durationMs,
          });
          if (resolvedPlannedClips.length === 0) {
            if (transcriptSegments.length > 0) {
              throw new Error(
                'AutoCut transcript speech has no renderable timestamped segment. Check speech-to-text output timestamps and retry Smart Slice.',
              );
            }
            throw new Error('AutoCut source video is too short to produce a valid video slice.');
          }
          assertSmartSlicePlanReadyForNativeRender(resolvedPlannedClips, transcriptSegments, sourceMedia.durationMs);
          return resolvedPlannedClips;
        },
        {
          sourceAssetUuid: sourceMedia.assetUuid,
          transcriptSegmentCount: transcriptSegments.length,
          sourceDurationMs: sourceMedia.durationMs,
        },
      );
      const nativeClips = plannedClips.map((clip) => toNativeSliceClipRequest(clip, transcriptSegments));
      const subtitleRequest = createVideoSliceSubtitleRequest(params, transcriptSegments);
      const nativeResult = await runSmartSliceExecutionStep(
        newTask.id,
        'native-render',
        async () => {
          reportVideoSliceStageDiagnostic('native render started', {
            taskId: newTask.id,
            sourceAssetUuid: sourceMedia.assetUuid,
            clipCount: nativeClips.length,
            noiseReduction: params.enableNoiseReduction === true,
            subtitleMode: subtitleRequest.subtitleMode,
            subtitleSegmentCount: subtitleRequest.subtitleSegments?.length ?? 0,
          });
          const resolvedNativeResult = await nativeHostClient.sliceVideo({
            assetUuid: sourceMedia.assetUuid,
            clips: nativeClips,
            outputFormat: 'mp4',
            ...(outputRootDir ? { outputRootDir } : {}),
            ...(renderProfile ? { renderProfile } : {}),
            noiseReduction: params.enableNoiseReduction === true,
            ...subtitleRequest,
          });
          reportVideoSliceStageDiagnostic('native render completed', {
            taskId: newTask.id,
            nativeTaskId: resolvedNativeResult.taskUuid,
            sourceAssetUuid: sourceMedia.assetUuid,
            sliceCount: resolvedNativeResult.slices.length,
            taskOutputDir: resolvedNativeResult.taskOutputDir,
          });
          return resolvedNativeResult;
        },
        {
          sourceAssetUuid: sourceMedia.assetUuid,
          plannedClipCount: plannedClips.length,
          noiseReduction: params.enableNoiseReduction === true,
          subtitleMode: subtitleRequest.subtitleMode,
        },
      );
      const completedTask: AppTask = {
        ...newTask,
        id: nativeResult.taskUuid,
        sourceFileId: sourceMedia.assetUuid,
      };
      durableTaskId = completedTask.id;
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
          plannedClips[index],
          transcriptSegments,
        ),
      );
      await runSmartSliceExecutionStep(
        newTask.id,
        'verify-artifacts',
        async () => {
          assertNativeSliceArtifactsMatchPlan(
            nativeResult.slices,
            plannedClips,
            nativeResult.taskOutputDir,
            subtitleRequest,
          );
          assertSmartSliceResultsMeetProfessionalStandard(sliceResults);
          reportVideoSliceStageDiagnostic('professional evidence verified', {
            taskId: newTask.id,
            nativeTaskId: nativeResult.taskUuid,
            sliceCount: sliceResults.length,
            slicesWithTranscriptSegments: sliceResults.filter((slice) => slice.transcriptSegments?.length).length,
            slicesWithTranscriptText: sliceResults.filter((slice) => slice.transcriptText?.trim()).length,
          });
        },
        {
          nativeTaskId: nativeResult.taskUuid,
          nativeSliceCount: nativeResult.slices.length,
          plannedClipCount: plannedClips.length,
        },
      );
      const completedData = await runSmartSliceExecutionStep(
        newTask.id,
        'persist-results',
        async () => finishVideoSliceTask(completedTask, sliceResults),
        {
          nativeTaskId: completedTask.id,
          sliceCount: sliceResults.length,
        },
      );

      await updateSmartSliceTaskCompleted(newTask.id, {
        id: completedTask.id,
        sourceFileId: sourceMedia.assetUuid,
        ...completedData,
      });
      reportVideoSliceStageDiagnostic('execution finished', {
        taskId: newTask.id,
        nativeTaskId: completedTask.id,
        sliceCount: sliceResults.length,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      reportAutoCutDiagnostic('error', 'slicer.service', 'Smart Slice execution failed', error);
      return await failAutoCutProcessingTask(
        newTask.id,
        errorMessage,
        createVideoSliceFailureDiagnostics(error),
        error,
      );
    }

    return { success: true, taskId: durableTaskId };
  }

  return await failAutoCutUnsupportedNativeProcessingTask(newTask, 'automatic slicing');
}
