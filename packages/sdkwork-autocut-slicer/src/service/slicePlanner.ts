import type { VideoSliceParams } from '@sdkwork/autocut-types';
import type {
  AutoCutSpeechTranscriptionSegment,
  AutoCutVideoSliceClipRequest,
} from '@sdkwork/autocut-services';

export const DEFAULT_SLICE_COUNT = 5;
export const MIN_TARGET_SLICE_COUNT = 1;
export const MAX_TARGET_SLICE_COUNT = 20;
export const MIN_SLICE_DURATION_MS = 5_000;
export const MAX_SLICE_DURATION_MS = 10 * 60 * 1_000;
const DEFAULT_IDEAL_SLICE_DURATION_MS = 45_000;
const STANDARD_TRANSCRIPT_SEGMENT_JOIN_GAP_MS = 2_500;
const STRICT_TRANSCRIPT_SEGMENT_JOIN_GAP_MS = 800;
const MAX_PLAN_RISK_TAGS = 12;
const MAX_LLM_PLAN_ITEMS_TO_INSPECT = MAX_TARGET_SLICE_COUNT * 4;
const TRANSCRIPT_BOUNDARY_PADDING_BEFORE_MS = 200;
const TRANSCRIPT_BOUNDARY_PADDING_AFTER_MS = 250;
const CONTENT_ARC_STAGES = ['hook', 'setup', 'conflict', 'payoff'] as const;

export type SliceContentArcStage = typeof CONTENT_ARC_STAGES[number];
export type SliceContentArcGrade = 'complete' | 'partial' | 'thin';
export type SliceTopicCoherenceGrade = 'strong' | 'mixed' | 'weak';
export type SlicePlatformReadinessGrade = 'ready' | 'review' | 'reject';
export type SliceSentenceBoundaryIntegrityGrade = 'clean' | 'repaired' | 'broken';

interface SlicePlatformProfile {
  targetAspectRatio: NonNullable<VideoSliceParams['targetAspectRatio']>;
  videoObjectFit: NonNullable<VideoSliceParams['videoObjectFit']>;
  targetSliceCount: number;
  idealDurationMs: number;
  readyScoreThreshold: number;
  rejectScoreThreshold: number;
  idealMinDurationMs: number;
  idealMaxDurationMs: number;
  maxReviewDurationMs: number;
  requireStrongHook: boolean;
  tolerateMixedTopic: boolean;
}

export interface VideoSlicePlanningPolicy {
  targetPlatform: NonNullable<VideoSliceParams['targetPlatform']>;
  targetAspectRatio: NonNullable<VideoSliceParams['targetAspectRatio']>;
  videoObjectFit: NonNullable<VideoSliceParams['videoObjectFit']>;
  sliceCountMode: NonNullable<VideoSliceParams['sliceCountMode']>;
  targetSliceCount: number;
  idealDurationMs: number;
  sourceDurationMs?: number;
  continuityLevel: NonNullable<VideoSliceParams['continuityLevel']>;
  continuityJoinGapMs: number;
  customKeywords: string[];
}

export interface NormalizedSlicePlanClip extends AutoCutVideoSliceClipRequest {
  index: number;
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
  contentArcGrade?: SliceContentArcGrade;
  contentArcStages?: SliceContentArcStage[];
  contentArcMissingStages?: SliceContentArcStage[];
  topicCoherenceScore?: number;
  topicCoherenceGrade?: SliceTopicCoherenceGrade;
  topicShiftCount?: number;
  topicKeywords?: string[];
  platformReadinessScore?: number;
  platformReadinessGrade?: SlicePlatformReadinessGrade;
  platformReadinessIssues?: string[];
  sentenceBoundaryIntegrityScore?: number;
  sentenceBoundaryIntegrityGrade?: SliceSentenceBoundaryIntegrityGrade;
  sentenceBoundaryIssues?: string[];
  risks?: string[];
  sourceStartMs?: number;
  sourceEndMs?: number;
  speechStartMs?: number;
  speechEndMs?: number;
  boundaryPaddingBeforeMs?: number;
  boundaryPaddingAfterMs?: number;
  transcriptText?: string;
  transcriptCoverageScore?: number;
  subtitleSegmentCount?: number;
  speechContinuityGrade?: 'strong' | 'repaired' | 'weak';
}

export interface TranscriptSliceCandidate extends NormalizedSlicePlanClip {
  candidateId: string;
  endMs: number;
  text: string;
  score: number;
  anchorSegmentIndex: number;
}

interface NormalizeSlicePlanOptions {
  fillPrecedingGaps?: boolean;
  fillTrailingClips?: boolean;
}

const SLICE_PLATFORM_PROFILES: Record<VideoSlicePlanningPolicy['targetPlatform'], SlicePlatformProfile> = {
  douyin: {
    targetAspectRatio: '9:16',
    videoObjectFit: 'cover',
    targetSliceCount: DEFAULT_SLICE_COUNT,
    idealDurationMs: 45_000,
    readyScoreThreshold: 0.78,
    rejectScoreThreshold: 0.42,
    idealMinDurationMs: 12_000,
    idealMaxDurationMs: 60_000,
    maxReviewDurationMs: 75_000,
    requireStrongHook: true,
    tolerateMixedTopic: false,
  },
  kuaishou: {
    targetAspectRatio: '9:16',
    videoObjectFit: 'cover',
    targetSliceCount: DEFAULT_SLICE_COUNT,
    idealDurationMs: 45_000,
    readyScoreThreshold: 0.76,
    rejectScoreThreshold: 0.4,
    idealMinDurationMs: 12_000,
    idealMaxDurationMs: 65_000,
    maxReviewDurationMs: 80_000,
    requireStrongHook: true,
    tolerateMixedTopic: false,
  },
  shipinhao: {
    targetAspectRatio: '9:16',
    videoObjectFit: 'cover',
    targetSliceCount: DEFAULT_SLICE_COUNT,
    idealDurationMs: 45_000,
    readyScoreThreshold: 0.74,
    rejectScoreThreshold: 0.38,
    idealMinDurationMs: 15_000,
    idealMaxDurationMs: 75_000,
    maxReviewDurationMs: 90_000,
    requireStrongHook: false,
    tolerateMixedTopic: true,
  },
  xiaohongshu: {
    targetAspectRatio: '9:16',
    videoObjectFit: 'cover',
    targetSliceCount: DEFAULT_SLICE_COUNT,
    idealDurationMs: 35_000,
    readyScoreThreshold: 0.8,
    rejectScoreThreshold: 0.44,
    idealMinDurationMs: 10_000,
    idealMaxDurationMs: 50_000,
    maxReviewDurationMs: 65_000,
    requireStrongHook: true,
    tolerateMixedTopic: false,
  },
  bilibili: {
    targetAspectRatio: '16:9',
    videoObjectFit: 'contain',
    targetSliceCount: 3,
    idealDurationMs: 90_000,
    readyScoreThreshold: 0.72,
    rejectScoreThreshold: 0.34,
    idealMinDurationMs: 35_000,
    idealMaxDurationMs: 120_000,
    maxReviewDurationMs: 180_000,
    requireStrongHook: false,
    tolerateMixedTopic: true,
  },
  generic: {
    targetAspectRatio: 'auto',
    videoObjectFit: 'contain',
    targetSliceCount: DEFAULT_SLICE_COUNT,
    idealDurationMs: DEFAULT_IDEAL_SLICE_DURATION_MS,
    readyScoreThreshold: 0.74,
    rejectScoreThreshold: 0.36,
    idealMinDurationMs: 15_000,
    idealMaxDurationMs: 90_000,
    maxReviewDurationMs: 120_000,
    requireStrongHook: false,
    tolerateMixedTopic: true,
  },
};

const SLICE_PLAN_METADATA_KEYS = [
  'title',
  'summary',
  'reason',
  'qualityScore',
  'continuityScore',
  'storyShape',
  'publishabilityScore',
  'publishabilityGrade',
  'publishabilityIssues',
  'boundaryQualityScore',
  'hookStrength',
  'endingCompleteness',
  'contentArcScore',
  'contentArcGrade',
  'contentArcStages',
  'contentArcMissingStages',
  'topicCoherenceScore',
  'topicCoherenceGrade',
  'topicShiftCount',
  'topicKeywords',
  'platformReadinessScore',
  'platformReadinessGrade',
  'platformReadinessIssues',
  'sentenceBoundaryIntegrityScore',
  'sentenceBoundaryIntegrityGrade',
  'sentenceBoundaryIssues',
  'risks',
  'sourceStartMs',
  'sourceEndMs',
  'speechStartMs',
  'speechEndMs',
  'boundaryPaddingBeforeMs',
  'boundaryPaddingAfterMs',
  'transcriptText',
  'transcriptCoverageScore',
  'subtitleSegmentCount',
  'speechContinuityGrade',
] as const;

function sortSliceClipsByStartMs(clips: NormalizedSlicePlanClip[]) {
  const sorted: NormalizedSlicePlanClip[] = [];
  for (const clip of clips) {
    const insertIndex = sorted.findIndex((existingClip) => clip.startMs < existingClip.startMs);
    if (insertIndex < 0) {
      sorted.push(clip);
    } else {
      sorted.splice(insertIndex, 0, clip);
    }
  }

  return sorted;
}

function sortTranscriptSegmentsByStartMs(segments: AutoCutSpeechTranscriptionSegment[]) {
  const sorted: AutoCutSpeechTranscriptionSegment[] = [];
  for (const segment of segments) {
    const insertIndex = sorted.findIndex((existingSegment) => segment.startMs < existingSegment.startMs);
    if (insertIndex < 0) {
      sorted.push(segment);
    } else {
      sorted.splice(insertIndex, 0, segment);
    }
  }

  return sorted;
}

function sortTranscriptSliceCandidatesByScore(candidates: TranscriptSliceCandidate[]) {
  const sorted: TranscriptSliceCandidate[] = [];
  for (const candidate of candidates) {
    const insertIndex = sorted.findIndex(
      (existingCandidate) =>
        candidate.score > existingCandidate.score ||
        (candidate.score === existingCandidate.score && candidate.startMs < existingCandidate.startMs),
    );
    if (insertIndex < 0) {
      sorted.push(candidate);
    } else {
      sorted.splice(insertIndex, 0, candidate);
    }
  }

  return sorted;
}

function clampScore(value: unknown) {
  const numericValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : undefined;

  if (!Number.isFinite(numericValue)) {
    return undefined;
  }

  return Math.max(0, Math.min(1, Number(numericValue)));
}

function normalizePlanText(value: unknown, maxLength: number) {
  return typeof value === 'string' && value.trim()
    ? value.trim().replace(/\s+/g, ' ').slice(0, maxLength)
    : undefined;
}

function normalizePlanRisks(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const risks = value
    .map((risk) => normalizePlanText(risk, 48))
    .filter((risk): risk is string => Boolean(risk))
    .slice(0, MAX_PLAN_RISK_TAGS);

  return risks.length > 0 ? risks : undefined;
}

function mergePlanRisks(...riskGroups: (readonly string[] | undefined)[]) {
  const seen = new Set<string>();
  const risks: string[] = [];

  for (const group of riskGroups) {
    if (!group) {
      continue;
    }

    for (const risk of group) {
      const normalizedRisk = normalizePlanText(risk, 48);
      if (!normalizedRisk || seen.has(normalizedRisk)) {
        continue;
      }

      seen.add(normalizedRisk);
      risks.push(normalizedRisk);
      if (risks.length >= MAX_PLAN_RISK_TAGS) {
        return risks;
      }
    }
  }

  return risks.length > 0 ? risks : undefined;
}

function createNormalizedSliceTimingMetadata(
  metadata: Partial<NormalizedSlicePlanClip>,
  startMs: number,
  durationMs: number,
) {
  const renderEndMs = startMs + durationMs;
  const requestedSourceStartMs = metadata.sourceStartMs;
  const requestedSourceEndMs = metadata.sourceEndMs;
  const requestedSpeechStartMs = metadata.speechStartMs;
  const requestedSpeechEndMs = metadata.speechEndMs;
  const requestedBoundaryPaddingBeforeMs = metadata.boundaryPaddingBeforeMs;
  const requestedBoundaryPaddingAfterMs = metadata.boundaryPaddingAfterMs;

  let sourceStartMs = typeof requestedSourceStartMs === 'number'
    ? Math.max(startMs, Math.min(requestedSourceStartMs, renderEndMs))
    : startMs;
  let sourceEndMs = typeof requestedSourceEndMs === 'number'
    ? Math.max(startMs, Math.min(requestedSourceEndMs, renderEndMs))
    : renderEndMs;
  if (sourceEndMs <= sourceStartMs) {
    sourceStartMs = startMs;
    sourceEndMs = renderEndMs;
  }

  let speechStartMs = typeof requestedSpeechStartMs === 'number'
    ? Math.max(sourceStartMs, Math.min(requestedSpeechStartMs, sourceEndMs))
    : sourceStartMs;
  let speechEndMs = typeof requestedSpeechEndMs === 'number'
    ? Math.max(sourceStartMs, Math.min(requestedSpeechEndMs, sourceEndMs))
    : sourceEndMs;
  if (speechEndMs < speechStartMs) {
    speechStartMs = sourceStartMs;
    speechEndMs = sourceEndMs;
  }

  const boundaryPaddingBeforeMs = Math.max(0, speechStartMs - sourceStartMs);
  const boundaryPaddingAfterMs = Math.max(0, sourceEndMs - speechEndMs);
  const timingMetadataRepaired =
    requestedSourceStartMs !== undefined && requestedSourceStartMs !== sourceStartMs ||
    requestedSourceEndMs !== undefined && requestedSourceEndMs !== sourceEndMs ||
    requestedSpeechStartMs !== undefined && requestedSpeechStartMs !== speechStartMs ||
    requestedSpeechEndMs !== undefined && requestedSpeechEndMs !== speechEndMs ||
    requestedBoundaryPaddingBeforeMs !== undefined && requestedBoundaryPaddingBeforeMs !== boundaryPaddingBeforeMs ||
    requestedBoundaryPaddingAfterMs !== undefined && requestedBoundaryPaddingAfterMs !== boundaryPaddingAfterMs;

  return {
    sourceStartMs,
    sourceEndMs,
    speechStartMs,
    speechEndMs,
    boundaryPaddingBeforeMs,
    boundaryPaddingAfterMs,
    timingMetadataRepaired,
  };
}

function normalizeStoryShape(value: unknown): NormalizedSlicePlanClip['storyShape'] {
  return value === 'complete' ||
    value === 'setupOnly' ||
    value === 'payoffOnly' ||
    value === 'contextOnly' ||
    value === 'thin'
    ? value
    : undefined;
}

function normalizeSpeechContinuityGrade(value: unknown): NormalizedSlicePlanClip['speechContinuityGrade'] {
  return value === 'strong' || value === 'repaired' || value === 'weak' ? value : undefined;
}

function normalizePublishabilityGrade(value: unknown): NormalizedSlicePlanClip['publishabilityGrade'] {
  return value === 'excellent' || value === 'good' || value === 'review' || value === 'reject'
    ? value
    : undefined;
}

function normalizePlatformReadinessGrade(value: unknown): NormalizedSlicePlanClip['platformReadinessGrade'] {
  return value === 'ready' || value === 'review' || value === 'reject' ? value : undefined;
}

function normalizeSentenceBoundaryIntegrityGrade(
  value: unknown,
): NormalizedSlicePlanClip['sentenceBoundaryIntegrityGrade'] {
  return value === 'clean' || value === 'repaired' || value === 'broken' ? value : undefined;
}

function normalizeHookStrength(value: unknown): NormalizedSlicePlanClip['hookStrength'] {
  return value === 'strong' || value === 'contextual' || value === 'weak' ? value : undefined;
}

function normalizeEndingCompleteness(value: unknown): NormalizedSlicePlanClip['endingCompleteness'] {
  return value === 'complete' || value === 'soft' || value === 'open' ? value : undefined;
}

function normalizeContentArcGrade(value: unknown): NormalizedSlicePlanClip['contentArcGrade'] {
  return value === 'complete' || value === 'partial' || value === 'thin' ? value : undefined;
}

function normalizeTopicCoherenceGrade(value: unknown): NormalizedSlicePlanClip['topicCoherenceGrade'] {
  return value === 'strong' || value === 'mixed' || value === 'weak' ? value : undefined;
}

function normalizeContentArcStages(value: unknown): SliceContentArcStage[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const seen = new Set<SliceContentArcStage>();
  const stages: SliceContentArcStage[] = [];
  for (const stage of value) {
    if (
      (stage === 'hook' || stage === 'setup' || stage === 'conflict' || stage === 'payoff') &&
      !seen.has(stage)
    ) {
      seen.add(stage);
      stages.push(stage);
    }
  }

  return stages.length > 0 ? stages : undefined;
}

function normalizeTopicShiftCount(value: unknown) {
  const numericValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : undefined;

  if (!Number.isFinite(numericValue)) {
    return undefined;
  }

  return Math.max(0, Math.min(50, Math.round(Number(numericValue))));
}

function normalizeTopicKeywords(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const keyword of value) {
    const normalizedKeyword = normalizePlanText(keyword, 24)?.toLowerCase();
    if (!normalizedKeyword || seen.has(normalizedKeyword)) {
      continue;
    }

    seen.add(normalizedKeyword);
    keywords.push(normalizedKeyword);
    if (keywords.length >= 8) {
      break;
    }
  }

  return keywords.length > 0 ? keywords : undefined;
}

function normalizeSubtitleSegmentCount(value: unknown) {
  const numericValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : undefined;

  if (!Number.isFinite(numericValue)) {
    return undefined;
  }

  return Math.max(0, Math.min(500, Math.round(Number(numericValue))));
}

function normalizeNonNegativeMs(value: unknown) {
  const numericValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : undefined;

  if (!Number.isFinite(numericValue)) {
    return undefined;
  }

  return Math.max(0, Math.round(Number(numericValue)));
}

function pickPlanMetadata(clip: NormalizedSlicePlanClip): Partial<NormalizedSlicePlanClip> {
  const metadata: Partial<NormalizedSlicePlanClip> = {};

  for (const key of SLICE_PLAN_METADATA_KEYS) {
    if (clip[key] !== undefined) {
      metadata[key] = clip[key] as never;
    }
  }

  if (metadata.storyShape !== undefined) {
    const storyShape = normalizeStoryShape(metadata.storyShape);
    if (storyShape !== undefined) {
      metadata.storyShape = storyShape;
    } else {
      delete metadata.storyShape;
    }
  }

  if (metadata.transcriptText !== undefined) {
    const transcriptText = normalizePlanText(metadata.transcriptText, 4_000);
    if (transcriptText !== undefined) {
      metadata.transcriptText = transcriptText;
    } else {
      delete metadata.transcriptText;
    }
  }

  if (metadata.transcriptCoverageScore !== undefined) {
    const transcriptCoverageScore = clampScore(metadata.transcriptCoverageScore);
    if (transcriptCoverageScore !== undefined) {
      metadata.transcriptCoverageScore = transcriptCoverageScore;
    } else {
      delete metadata.transcriptCoverageScore;
    }
  }

  if (metadata.subtitleSegmentCount !== undefined) {
    const subtitleSegmentCount = normalizeSubtitleSegmentCount(metadata.subtitleSegmentCount);
    if (subtitleSegmentCount !== undefined) {
      metadata.subtitleSegmentCount = subtitleSegmentCount;
    } else {
      delete metadata.subtitleSegmentCount;
    }
  }

  if (metadata.speechContinuityGrade !== undefined) {
    const speechContinuityGrade = normalizeSpeechContinuityGrade(metadata.speechContinuityGrade);
    if (speechContinuityGrade !== undefined) {
      metadata.speechContinuityGrade = speechContinuityGrade;
    } else {
      delete metadata.speechContinuityGrade;
    }
  }

  if (metadata.publishabilityScore !== undefined) {
    const publishabilityScore = clampScore(metadata.publishabilityScore);
    if (publishabilityScore !== undefined) {
      metadata.publishabilityScore = publishabilityScore;
    } else {
      delete metadata.publishabilityScore;
    }
  }

  if (metadata.publishabilityGrade !== undefined) {
    const publishabilityGrade = normalizePublishabilityGrade(metadata.publishabilityGrade);
    if (publishabilityGrade !== undefined) {
      metadata.publishabilityGrade = publishabilityGrade;
    } else {
      delete metadata.publishabilityGrade;
    }
  }

  if (metadata.publishabilityIssues !== undefined) {
    const publishabilityIssues = normalizePlanRisks(metadata.publishabilityIssues);
    if (publishabilityIssues !== undefined) {
      metadata.publishabilityIssues = publishabilityIssues;
    } else {
      delete metadata.publishabilityIssues;
    }
  }

  if (metadata.boundaryQualityScore !== undefined) {
    const boundaryQualityScore = clampScore(metadata.boundaryQualityScore);
    if (boundaryQualityScore !== undefined) {
      metadata.boundaryQualityScore = boundaryQualityScore;
    } else {
      delete metadata.boundaryQualityScore;
    }
  }

  if (metadata.hookStrength !== undefined) {
    const hookStrength = normalizeHookStrength(metadata.hookStrength);
    if (hookStrength !== undefined) {
      metadata.hookStrength = hookStrength;
    } else {
      delete metadata.hookStrength;
    }
  }

  if (metadata.endingCompleteness !== undefined) {
    const endingCompleteness = normalizeEndingCompleteness(metadata.endingCompleteness);
    if (endingCompleteness !== undefined) {
      metadata.endingCompleteness = endingCompleteness;
    } else {
      delete metadata.endingCompleteness;
    }
  }

  if (metadata.contentArcScore !== undefined) {
    const contentArcScore = clampScore(metadata.contentArcScore);
    if (contentArcScore !== undefined) {
      metadata.contentArcScore = contentArcScore;
    } else {
      delete metadata.contentArcScore;
    }
  }

  if (metadata.contentArcGrade !== undefined) {
    const contentArcGrade = normalizeContentArcGrade(metadata.contentArcGrade);
    if (contentArcGrade !== undefined) {
      metadata.contentArcGrade = contentArcGrade;
    } else {
      delete metadata.contentArcGrade;
    }
  }

  if (metadata.contentArcStages !== undefined) {
    const contentArcStages = normalizeContentArcStages(metadata.contentArcStages);
    if (contentArcStages !== undefined) {
      metadata.contentArcStages = contentArcStages;
    } else {
      delete metadata.contentArcStages;
    }
  }

  if (metadata.contentArcMissingStages !== undefined) {
    const contentArcMissingStages = normalizeContentArcStages(metadata.contentArcMissingStages);
    if (contentArcMissingStages !== undefined) {
      metadata.contentArcMissingStages = contentArcMissingStages;
    } else {
      metadata.contentArcMissingStages = [];
    }
  }

  if (metadata.topicCoherenceScore !== undefined) {
    const topicCoherenceScore = clampScore(metadata.topicCoherenceScore);
    if (topicCoherenceScore !== undefined) {
      metadata.topicCoherenceScore = topicCoherenceScore;
    } else {
      delete metadata.topicCoherenceScore;
    }
  }

  if (metadata.topicCoherenceGrade !== undefined) {
    const topicCoherenceGrade = normalizeTopicCoherenceGrade(metadata.topicCoherenceGrade);
    if (topicCoherenceGrade !== undefined) {
      metadata.topicCoherenceGrade = topicCoherenceGrade;
    } else {
      delete metadata.topicCoherenceGrade;
    }
  }

  if (metadata.topicShiftCount !== undefined) {
    const topicShiftCount = normalizeTopicShiftCount(metadata.topicShiftCount);
    if (topicShiftCount !== undefined) {
      metadata.topicShiftCount = topicShiftCount;
    } else {
      delete metadata.topicShiftCount;
    }
  }

  if (metadata.topicKeywords !== undefined) {
    const topicKeywords = normalizeTopicKeywords(metadata.topicKeywords);
    if (topicKeywords !== undefined) {
      metadata.topicKeywords = topicKeywords;
    } else {
      delete metadata.topicKeywords;
    }
  }

  if (metadata.platformReadinessScore !== undefined) {
    const platformReadinessScore = clampScore(metadata.platformReadinessScore);
    if (platformReadinessScore !== undefined) {
      metadata.platformReadinessScore = platformReadinessScore;
    } else {
      delete metadata.platformReadinessScore;
    }
  }

  if (metadata.platformReadinessGrade !== undefined) {
    const platformReadinessGrade = normalizePlatformReadinessGrade(metadata.platformReadinessGrade);
    if (platformReadinessGrade !== undefined) {
      metadata.platformReadinessGrade = platformReadinessGrade;
    } else {
      delete metadata.platformReadinessGrade;
    }
  }

  if (metadata.platformReadinessIssues !== undefined) {
    const platformReadinessIssues = normalizePlanRisks(metadata.platformReadinessIssues);
    if (platformReadinessIssues !== undefined) {
      metadata.platformReadinessIssues = platformReadinessIssues;
    } else {
      delete metadata.platformReadinessIssues;
    }
  }

  if (metadata.sentenceBoundaryIntegrityScore !== undefined) {
    const sentenceBoundaryIntegrityScore = clampScore(metadata.sentenceBoundaryIntegrityScore);
    if (sentenceBoundaryIntegrityScore !== undefined) {
      metadata.sentenceBoundaryIntegrityScore = sentenceBoundaryIntegrityScore;
    } else {
      delete metadata.sentenceBoundaryIntegrityScore;
    }
  }

  if (metadata.sentenceBoundaryIntegrityGrade !== undefined) {
    const sentenceBoundaryIntegrityGrade = normalizeSentenceBoundaryIntegrityGrade(metadata.sentenceBoundaryIntegrityGrade);
    if (sentenceBoundaryIntegrityGrade !== undefined) {
      metadata.sentenceBoundaryIntegrityGrade = sentenceBoundaryIntegrityGrade;
    } else {
      delete metadata.sentenceBoundaryIntegrityGrade;
    }
  }

  if (metadata.sentenceBoundaryIssues !== undefined) {
    const sentenceBoundaryIssues = normalizePlanRisks(metadata.sentenceBoundaryIssues);
    if (sentenceBoundaryIssues !== undefined) {
      metadata.sentenceBoundaryIssues = sentenceBoundaryIssues;
    } else {
      delete metadata.sentenceBoundaryIssues;
    }
  }

  for (const key of [
    'sourceStartMs',
    'sourceEndMs',
    'speechStartMs',
    'speechEndMs',
    'boundaryPaddingBeforeMs',
    'boundaryPaddingAfterMs',
  ] as const) {
    if (metadata[key] !== undefined) {
      const normalizedMs = normalizeNonNegativeMs(metadata[key]);
      if (normalizedMs !== undefined) {
        metadata[key] = normalizedMs;
      } else {
        delete metadata[key];
      }
    }
  }

  return metadata;
}

function hasPlanMetadata(metadata: Partial<NormalizedSlicePlanClip>) {
  return SLICE_PLAN_METADATA_KEYS.some((key) => metadata[key] !== undefined);
}

function getClipEndMs(clip: Pick<NormalizedSlicePlanClip, 'startMs' | 'durationMs'>) {
  return clip.startMs + clip.durationMs;
}

function calculateClipOverlapRatio(
  firstClip: Pick<NormalizedSlicePlanClip, 'startMs' | 'durationMs'>,
  secondClip: Pick<NormalizedSlicePlanClip, 'startMs' | 'durationMs'>,
) {
  const overlapMs = Math.max(
    0,
    Math.min(getClipEndMs(firstClip), getClipEndMs(secondClip)) -
      Math.max(firstClip.startMs, secondClip.startMs),
  );
  const shorterDurationMs = Math.min(firstClip.durationMs, secondClip.durationMs);
  if (shorterDurationMs <= 0) {
    return 0;
  }

  return overlapMs / shorterDurationMs;
}

function getClipSelectionScore(clip: NormalizedSlicePlanClip, policy: VideoSlicePlanningPolicy) {
  const qualityScore = typeof clip.qualityScore === 'number' ? clip.qualityScore : 0.5;
  const continuityScore = typeof clip.continuityScore === 'number' ? clip.continuityScore : 0.7;
  const publishabilityScore = typeof clip.publishabilityScore === 'number'
    ? clip.publishabilityScore
    : createPublishabilityMetadata(clip).publishabilityScore;
  const platformReadinessScore = typeof clip.platformReadinessScore === 'number'
    ? clip.platformReadinessScore
    : createPlatformReadinessMetadata(clip, policy).platformReadinessScore;
  const storyShapeBonus = clip.storyShape === 'complete'
    ? 0.12
    : clip.storyShape === 'setupOnly' || clip.storyShape === 'payoffOnly'
      ? -0.06
    : clip.storyShape === 'thin'
      ? -0.08
      : 0;
  const contentArcBonus = clip.contentArcGrade === 'complete'
    ? 0.08
    : clip.contentArcGrade === 'thin'
      ? -0.08
      : 0;
  const topicCoherenceBonus = clip.topicCoherenceGrade === 'strong'
    ? 0.06
    : clip.topicCoherenceGrade === 'weak'
      ? -0.1
      : 0;
  const platformReadinessGrade = clip.platformReadinessGrade ??
    createPlatformReadinessMetadata(clip, policy).platformReadinessGrade;
  const platformReadinessIssues = clip.platformReadinessIssues ?? [];
  const platformGateModifier = platformReadinessGrade === 'ready'
    ? 0.08
    : platformReadinessGrade === 'reject'
      ? -0.22
      : -0.03;
  const platformDurationRejectPenalty = platformReadinessIssues.includes('platform-duration-reject')
    ? -0.16
    : 0;
  const sentenceBoundaryIntegrityScore = typeof clip.sentenceBoundaryIntegrityScore === 'number'
    ? clip.sentenceBoundaryIntegrityScore
    : 0.68;
  const sentenceBoundaryGrade = clip.sentenceBoundaryIntegrityGrade;
  const sentenceBoundaryModifier = sentenceBoundaryGrade === 'clean'
    ? 0.09
    : sentenceBoundaryGrade === 'broken'
      ? -0.28
      : sentenceBoundaryGrade === 'repaired'
        ? 0.02
        : 0;

  return qualityScore * 0.3 +
    continuityScore * 0.2 +
    publishabilityScore * 0.31 +
    platformReadinessScore * 0.1 +
    sentenceBoundaryIntegrityScore * 0.08 +
    storyShapeBonus +
    contentArcBonus +
    topicCoherenceBonus +
    platformGateModifier +
    platformDurationRejectPenalty +
    sentenceBoundaryModifier;
}

function sortSliceClipsBySelectionScore(
  candidates: NormalizedSlicePlanClip[],
  policy: VideoSlicePlanningPolicy,
) {
  const sorted: NormalizedSlicePlanClip[] = [];
  for (const candidate of candidates) {
    const candidateScore = getClipSelectionScore(candidate, policy);
    const insertIndex = sorted.findIndex((existingCandidate) =>
      candidateScore > getClipSelectionScore(existingCandidate, policy) ||
      (candidateScore === getClipSelectionScore(existingCandidate, policy) &&
        candidate.startMs < existingCandidate.startMs),
    );
    if (insertIndex < 0) {
      sorted.push(candidate);
    } else {
      sorted.splice(insertIndex, 0, candidate);
    }
  }

  return sorted;
}

export function normalizeSliceDurationMs(durationSeconds: number) {
  const durationMs = Math.round(durationSeconds * 1_000);
  if (!Number.isFinite(durationMs)) {
    return 15_000;
  }

  return Math.max(MIN_SLICE_DURATION_MS, Math.min(durationMs, MAX_SLICE_DURATION_MS));
}

function normalizeTargetSliceCount(value: unknown, fallback: number) {
  const numericValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : fallback;

  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.round(numericValue);
}

function normalizeSourceDurationMs(value: unknown) {
  const numericValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : undefined;

  if (!Number.isFinite(numericValue)) {
    return undefined;
  }

  const durationMs = Math.round(Number(numericValue));
  return durationMs > 0 ? durationMs : undefined;
}

function normalizeCustomKeywords(value: VideoSliceParams['customKeywords']) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const keyword of value) {
    const normalizedKeyword = typeof keyword === 'string'
      ? keyword.trim().replace(/\s+/g, ' ').toLowerCase()
      : '';
    if (!normalizedKeyword || seen.has(normalizedKeyword)) {
      continue;
    }

    seen.add(normalizedKeyword);
    keywords.push(normalizedKeyword);
  }

  return keywords.slice(0, 20);
}

export function getVideoSlicePlanningPolicy(params: VideoSliceParams): VideoSlicePlanningPolicy {
  const targetPlatform = params.targetPlatform ?? 'generic';
  const platformProfile = SLICE_PLATFORM_PROFILES[targetPlatform] ?? SLICE_PLATFORM_PROFILES.generic;
  const { minDurationMs, maxDurationMs } = getVideoSliceDurationBounds(params);
  const profileIdealDurationMs = Math.max(minDurationMs, Math.min(platformProfile.idealDurationMs, maxDurationMs));
  const requestedIdealDurationMs = params.idealDuration !== undefined
    ? normalizeSliceDurationMs(params.idealDuration)
    : params.targetPlatform !== undefined
      ? profileIdealDurationMs
      : minDurationMs;
  const idealDurationMs = Math.max(minDurationMs, Math.min(requestedIdealDurationMs, maxDurationMs));
  const targetSliceCount = normalizeTargetSliceCount(params.targetSliceCount, platformProfile.targetSliceCount);
  const sourceDurationMs = normalizeSourceDurationMs(params.sourceDurationMs);
  const continuityLevel = params.continuityLevel ?? 'standard';

  return {
    targetPlatform,
    targetAspectRatio:
      params.targetAspectRatio && params.targetAspectRatio !== 'auto'
        ? params.targetAspectRatio
        : platformProfile.targetAspectRatio,
    videoObjectFit: params.videoObjectFit ?? platformProfile.videoObjectFit,
    sliceCountMode: params.sliceCountMode ?? 'auto',
    targetSliceCount,
    idealDurationMs,
    ...(sourceDurationMs !== undefined ? { sourceDurationMs } : {}),
    continuityLevel,
    continuityJoinGapMs: continuityLevel === 'strict'
      ? STRICT_TRANSCRIPT_SEGMENT_JOIN_GAP_MS
      : STANDARD_TRANSCRIPT_SEGMENT_JOIN_GAP_MS,
    customKeywords: normalizeCustomKeywords(params.customKeywords),
  };
}

export function getVideoSliceDurationBounds(params: VideoSliceParams) {
  const minDurationMs = normalizeSliceDurationMs(params.minDuration);
  const maxDurationMs = normalizeSliceDurationMs(params.maxDuration);

  return {
    minDurationMs: Math.min(minDurationMs, maxDurationMs),
    maxDurationMs: Math.max(minDurationMs, maxDurationMs),
  };
}

export function validateVideoSliceParams(params: VideoSliceParams) {
  const minDurationMs = normalizeSliceDurationMs(params.minDuration);
  const maxDurationMs = normalizeSliceDurationMs(params.maxDuration);

  if (minDurationMs > maxDurationMs) {
    throw new Error('AutoCut minimum slice duration must be less than or equal to the maximum slice duration.');
  }

  const platformProfile = SLICE_PLATFORM_PROFILES[params.targetPlatform ?? 'generic'] ?? SLICE_PLATFORM_PROFILES.generic;
  const targetSliceCount = normalizeTargetSliceCount(params.targetSliceCount, platformProfile.targetSliceCount);
  if (targetSliceCount < MIN_TARGET_SLICE_COUNT || targetSliceCount > MAX_TARGET_SLICE_COUNT) {
    throw new Error(`AutoCut target slice count must be between ${MIN_TARGET_SLICE_COUNT} and ${MAX_TARGET_SLICE_COUNT}.`);
  }
}

function normalizeTranscriptSegments(
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
): AutoCutSpeechTranscriptionSegment[] {
  return sortTranscriptSegmentsByStartMs(transcriptSegments
    .filter((segment) => segment.text.trim())
    .filter((segment) => Number.isFinite(segment.startMs) && Number.isFinite(segment.endMs))
    .map((segment) => ({
      ...segment,
      startMs: Math.max(0, Math.round(segment.startMs)),
      endMs: Math.max(0, Math.round(segment.endMs)),
      text: segment.text.trim().replace(/\s+/g, ' '),
    }))
    .filter((segment) => segment.endMs > segment.startMs));
}

function canJoinTranscriptSegments(
  current: AutoCutSpeechTranscriptionSegment,
  next: AutoCutSpeechTranscriptionSegment,
  policy: VideoSlicePlanningPolicy,
) {
  return next.startMs >= current.endMs && next.startMs - current.endMs <= policy.continuityJoinGapMs;
}

function clampTranscriptBoundaryPaddingToMaxDuration(
  speechDurationMs: number,
  paddingBeforeMs: number,
  paddingAfterMs: number,
  maxDurationMs: number,
) {
  let beforeMs = paddingBeforeMs;
  let afterMs = paddingAfterMs;
  const overflowMs = speechDurationMs + beforeMs + afterMs - maxDurationMs;
  if (overflowMs <= 0) {
    return { beforeMs, afterMs };
  }

  const beforeReductionMs = Math.min(beforeMs, overflowMs);
  beforeMs -= beforeReductionMs;
  const remainingOverflowMs = overflowMs - beforeReductionMs;
  if (remainingOverflowMs > 0) {
    afterMs = Math.max(0, afterMs - remainingOverflowMs);
  }

  return { beforeMs, afterMs };
}

function createTranscriptBoundaryTiming(
  segments: readonly AutoCutSpeechTranscriptionSegment[],
  startIndex: number,
  endIndex: number,
  policy: VideoSlicePlanningPolicy,
  minDurationMs: number,
  maxDurationMs: number,
) {
  const startSegment = segments[startIndex];
  const endSegment = segments[endIndex];
  if (!startSegment || !endSegment) {
    return undefined;
  }

  const speechStartMs = startSegment.startMs;
  const speechEndMs = endSegment.endMs;
  const speechDurationMs = Math.max(0, speechEndMs - speechStartMs);
  if (speechDurationMs <= 0) {
    return undefined;
  }

  const previousSegment = segments[startIndex - 1];
  const nextSegment = segments[endIndex + 1];
  const previousGapMs = previousSegment ? Math.max(0, speechStartMs - previousSegment.endMs) : speechStartMs;
  const nextGapMs = nextSegment ? Math.max(0, nextSegment.startMs - speechEndMs) : Number.POSITIVE_INFINITY;
  const maxLeadingPaddingMs = previousSegment
    ? Math.floor(previousGapMs / 2)
    : speechStartMs;
  const maxTrailingPaddingByGapMs = nextSegment
    ? Math.floor(nextGapMs / 2)
    : Number.POSITIVE_INFINITY;
  const maxTrailingPaddingBySourceMs = policy.sourceDurationMs !== undefined
    ? Math.max(0, policy.sourceDurationMs - speechEndMs)
    : Number.POSITIVE_INFINITY;

  let boundaryPaddingBeforeMs = Math.min(
    TRANSCRIPT_BOUNDARY_PADDING_BEFORE_MS,
    Math.max(0, maxLeadingPaddingMs),
  );
  let boundaryPaddingAfterMs = Math.min(
    TRANSCRIPT_BOUNDARY_PADDING_AFTER_MS,
    Math.max(0, maxTrailingPaddingByGapMs),
    Math.max(0, maxTrailingPaddingBySourceMs),
  );
  const maxDurationClampedPadding = clampTranscriptBoundaryPaddingToMaxDuration(
    speechDurationMs,
    boundaryPaddingBeforeMs,
    boundaryPaddingAfterMs,
    maxDurationMs,
  );
  boundaryPaddingBeforeMs = maxDurationClampedPadding.beforeMs;
  boundaryPaddingAfterMs = maxDurationClampedPadding.afterMs;

  let startMs = Math.max(0, speechStartMs - boundaryPaddingBeforeMs);
  let endMs = speechEndMs + boundaryPaddingAfterMs;
  const paddedDurationMs = endMs - startMs;
  if (paddedDurationMs < minDurationMs) {
    const minDurationEndMs = startMs + minDurationMs;
    const nextSpeechBoundaryMs = nextSegment ? nextSegment.startMs : Number.POSITIVE_INFINITY;
    const sourceBoundedEndMs = policy.sourceDurationMs !== undefined
      ? Math.min(minDurationEndMs, policy.sourceDurationMs, nextSpeechBoundaryMs)
      : Math.min(minDurationEndMs, nextSpeechBoundaryMs);
    if (sourceBoundedEndMs < minDurationEndMs) {
      return undefined;
    }

    endMs = Math.max(endMs, sourceBoundedEndMs);
  }

  if (endMs - startMs < minDurationMs) {
    return undefined;
  }

  const maxDurationEndMs = startMs + maxDurationMs;
  if (endMs > maxDurationEndMs) {
    endMs = maxDurationEndMs;
  }
  if (policy.sourceDurationMs !== undefined && endMs > policy.sourceDurationMs) {
    endMs = policy.sourceDurationMs;
    const sourceBoundedStartMs = Math.max(0, Math.min(startMs, endMs - MIN_SLICE_DURATION_MS));
    const previousSpeechBoundaryMs = previousSegment ? previousSegment.endMs : 0;
    if (sourceBoundedStartMs < previousSpeechBoundaryMs) {
      return undefined;
    }
    startMs = sourceBoundedStartMs;
  }

  if (endMs - startMs < MIN_SLICE_DURATION_MS) {
    return undefined;
  }

  if (endMs <= startMs) {
    return undefined;
  }

  return {
    startMs,
    endMs,
    durationMs: endMs - startMs,
    speechStartMs,
    speechEndMs,
    boundaryPaddingBeforeMs: Math.max(0, speechStartMs - startMs),
    boundaryPaddingAfterMs: Math.max(0, endMs - speechEndMs),
  };
}

const CHINESE_WEAK_START_CONNECTORS = [
  '\u7136\u540e',
  '\u6240\u4ee5',
  '\u4f46\u662f',
  '\u4e0d\u8fc7',
  '\u800c\u4e14',
  '\u63a5\u7740',
  '\u5176\u6b21',
  '\u6700\u540e',
  '\u56e0\u6b64',
  '\u540c\u65f6',
  '\u53e6\u5916',
  '\u90a3\u4e48',
  '\u90a3\u5176\u5b9e',
  '\u5176\u5b9e',
  '\u5e76\u4e14',
] as const;

const CHINESE_WEAK_END_CONNECTORS = [
  '\u56e0\u4e3a',
  '\u5982\u679c',
  '\u5f53',
  '\u867d\u7136',
  '\u4f46\u662f',
  '\u4e0d\u8fc7',
  '\u800c\u4e14',
  '\u6240\u4ee5',
  '\u7136\u540e',
  '\u6216\u8005',
  '\u4ee5\u53ca',
  '\u5e76\u4e14',
  '\u53ea\u8981',
  '\u9664\u975e',
  '\u540c\u65f6',
] as const;

const CHINESE_HOOK_MARKERS = [
  '\u4e3a\u4ec0\u4e48',
  '\u600e\u4e48',
  '\u5982\u4f55',
  '\u4ec0\u4e48',
  '\u95ee\u9898',
  '\u75db\u70b9',
  '\u5173\u952e',
  '\u79d8\u8bc0',
  '\u6280\u5de7',
  '\u6ce8\u610f',
  '\u5f00\u5934',
  '\u5b8c\u64ad',
  '\u7559\u5b58',
  '\u5438\u5f15',
] as const;

const CHINESE_CONTEXT_MARKERS = [
  '\u56e0\u4e3a',
  '\u539f\u56e0',
  '\u6848\u4f8b',
  '\u4f8b\u5b50',
  '\u80cc\u666f',
  '\u573a\u666f',
  '\u6570\u636e',
  '\u9996\u5148',
  '\u7b2c\u4e00',
  '\u7b2c\u4e8c',
  '\u8868\u660e',
  '\u8bf4\u660e',
  '\u53d1\u751f',
  '\u5bfc\u81f4',
] as const;

const CHINESE_PAYOFF_MARKERS = [
  '\u6240\u4ee5',
  '\u56e0\u6b64',
  '\u7ed3\u679c',
  '\u7ed3\u8bba',
  '\u89e3\u51b3',
  '\u529e\u6cd5',
  '\u65b9\u6cd5',
  '\u7b54\u6848',
  '\u5efa\u8bae',
  '\u6700\u540e',
  '\u8fd9\u6837',
  '\u4f60\u5e94\u8be5',
  '\u9700\u8981',
  '\u4fee\u590d',
  '\u63d0\u5347',
] as const;

function includesAnyMarker(text: string, markers: readonly string[]) {
  return markers.some((marker) => text.includes(marker));
}

function stripTrailingSentencePunctuation(text: string) {
  return text.trim().replace(/[.,;:!?\u3002\uff0c\uff1b\uff1a\uff01\uff1f\u2026]+$/u, '').trim();
}

function stripLeadingWeakConnector(text: string) {
  const trimmedText = text.trim();
  for (const connector of CHINESE_WEAK_START_CONNECTORS) {
    if (trimmedText.startsWith(connector)) {
      return trimmedText.slice(connector.length).trimStart();
    }
  }

  return trimmedText.replace(
    /^(then\b|so\b|but\b|and\b|also\b|next\b|finally\b|therefore\b)\s*/i,
    '',
  );
}

function looksLikeCorruptedTranscriptEncoding(text: string) {
  return /[\u00c0-\u00ff\ufffd]/u.test(text) ||
    /[閹鐒鍏鎵绋娑灞偓儴绻柌倸鎮庡灇崇暚佸鐓憴鍡涱暥]/u.test(text);
}

function startsWithWeakConnector(text: string) {
  const trimmedText = text.trim();
  if (CHINESE_WEAK_START_CONNECTORS.some((connector) => trimmedText.startsWith(connector))) {
    return true;
  }

  return /^(然后|所以|但是|不过|而且|接着|其次|最后|因此|同时|另外|那么|那其实|其实|并且|then\b|so\b|but\b|and\b|also\b|next\b|finally\b|therefore\b)/i.test(
    text.trim(),
  );
}

function endsWithWeakConnector(text: string) {
  const normalizedText = stripTrailingSentencePunctuation(text);
  if (CHINESE_WEAK_END_CONNECTORS.some((connector) => normalizedText.endsWith(connector))) {
    return true;
  }

  return /(then|so|but|and|also|because|therefore|while|when|if|or|plus|with)$/i.test(
    text.trim().replace(/[.,;:!?]+$/u, ''),
  );
}

function endsWithTerminalPunctuation(text: string) {
  if (/[.!?\u3002\uff01\uff1f\u2026]$/u.test(text.trim())) {
    return true;
  }

  return /[.!?。！？]$/u.test(text.trim());
}

function canTreatAsOpenSentence(text: string) {
  const trimmedText = text.trim();
  if (/[\u4e00-\u9fff]/u.test(trimmedText) && !looksLikeCorruptedTranscriptEncoding(trimmedText)) {
    return !endsWithTerminalPunctuation(trimmedText);
  }

  if (/[^\x20-\x7E]/u.test(trimmedText)) {
    return false;
  }

  return /^[\x20-\x7E]+$/u.test(trimmedText) && !endsWithTerminalPunctuation(trimmedText);
}

function createTranscriptSliceLabel(segments: readonly AutoCutSpeechTranscriptionSegment[], anchorIndex: number) {
  const anchorText = segments[anchorIndex]?.text.trim() ?? '';
  const strippedAnchorText = stripLeadingWeakConnector(anchorText);
  if (strippedAnchorText !== anchorText) {
    return (strippedAnchorText || anchorText || `Smart slice ${anchorIndex + 1}`).slice(0, 48);
  }

  const cleanedAnchorText = anchorText.replace(
    /^(然后|所以|但是|不过|而且|接着|其次|最后|因此|同时|另外|那么|那其实|其实|并且)\s*/u,
    '',
  );
  return (cleanedAnchorText || anchorText || `高光片段 ${anchorIndex + 1}`).slice(0, 48);
}

function createPlannerSliceLabel(index: number) {
  return `Smart slice ${index + 1}`;
}

function clampSlicePlannerScore(value: number) {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function splitTranscriptSentences(text: string) {
  return text
    .split(/(?<=[.!?\u3002\uff01\uff1f\u2026])\s+|[\n\r]+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function inferHookStrength(text: string): NonNullable<NormalizedSlicePlanClip['hookStrength']> {
  const normalizedText = text.toLowerCase();
  const firstSentence = splitTranscriptSentences(text)[0] ?? text.trim();
  const normalizedFirstSentence = firstSentence.toLowerCase();

  if (startsWithWeakConnector(firstSentence)) {
    return 'weak';
  }

  if (
    includesAnyMarker(normalizedFirstSentence, CHINESE_HOOK_MARKERS) ||
    /\b(why|how|what|mistake|secret|problem|pain|watch|attention|result|tip|seconds?|scroll)\b/.test(normalizedFirstSentence) ||
    /[?？]/u.test(firstSentence)
  ) {
    return 'strong';
  }

  if (
    includesAnyMarker(normalizedText, CHINESE_HOOK_MARKERS) ||
    includesAnyMarker(normalizedFirstSentence, CHINESE_CONTEXT_MARKERS) ||
    /\b(because|case|example|first|reason|context|data|launch)\b/.test(normalizedFirstSentence)
  ) {
    return 'contextual';
  }

  return 'weak';
}

function inferEndingCompleteness(text: string): NonNullable<NormalizedSlicePlanClip['endingCompleteness']> {
  const normalizedText = text.toLowerCase();
  const sentences = splitTranscriptSentences(text);
  const lastSentence = sentences.at(-1) ?? text.trim();
  const normalizedLastSentence = lastSentence.toLowerCase();

  if (endsWithWeakConnector(lastSentence)) {
    return 'open';
  }

  if (
    includesAnyMarker(normalizedLastSentence, CHINESE_PAYOFF_MARKERS) ||
    /\b(so|therefore|result|fix|solution|finally|lesson|answer|works|improves|do this|you should)\b/.test(normalizedLastSentence)
  ) {
    return 'complete';
  }

  if (includesAnyMarker(normalizedText, CHINESE_PAYOFF_MARKERS) || /\b(result|fix|solution|lesson|answer)\b/.test(normalizedText)) {
    return 'soft';
  }

  if (looksLikeCorruptedTranscriptEncoding(lastSentence) || looksLikeCorruptedTranscriptEncoding(text)) {
    return 'soft';
  }

  if (canTreatAsOpenSentence(lastSentence)) {
    return 'open';
  }

  return endsWithTerminalPunctuation(lastSentence) ? 'soft' : 'open';
}

function createBoundaryQualityMetadata(text: string, risks: readonly string[] = []) {
  const hookStrength = inferHookStrength(text);
  const endingCompleteness = inferEndingCompleteness(text);
  const hookScore = hookStrength === 'strong' ? 1 : hookStrength === 'contextual' ? 0.72 : 0.28;
  const endingScore = endingCompleteness === 'complete' ? 1 : endingCompleteness === 'soft' ? 0.74 : 0.25;
  const repairPenalty = risks.some((risk) =>
    risk === 'connector-repaired' ||
    risk === 'trailing-connector-extended' ||
    risk === 'open-sentence-extended'
  )
    ? 0.05
    : 0;
  const boundaryQualityScore = clampSlicePlannerScore(hookScore * 0.5 + endingScore * 0.5 - repairPenalty);

  return {
    boundaryQualityScore,
    hookStrength,
    endingCompleteness,
  } satisfies Pick<NormalizedSlicePlanClip, 'boundaryQualityScore' | 'hookStrength' | 'endingCompleteness'>;
}

function createSentenceBoundaryIntegrityMetadata(
  text: string,
  risks: readonly string[] = [],
) {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return {
      sentenceBoundaryIntegrityScore: 0.68,
      sentenceBoundaryIntegrityGrade: 'repaired',
      sentenceBoundaryIssues: ['sentence-boundary-unavailable'],
    } satisfies Pick<
      NormalizedSlicePlanClip,
      'sentenceBoundaryIntegrityScore' | 'sentenceBoundaryIntegrityGrade' | 'sentenceBoundaryIssues'
    >;
  }

  const sentences = splitTranscriptSentences(text);
  const firstSentence = sentences[0] ?? text.trim();
  const lastSentence = sentences.at(-1) ?? text.trim();
  const issues: string[] = [];
  const hasConnectorRepair = risks.includes('connector-repaired');
  const hasTrailingConnectorRepair = risks.includes('trailing-connector-extended');
  const hasOpenSentenceRepair = risks.includes('open-sentence-extended');

  if (startsWithWeakConnector(firstSentence) || hasConnectorRepair) {
    issues.push(hasConnectorRepair
      ? 'sentence-leading-connector-repaired'
      : 'sentence-leading-connector-unrepaired');
  } else {
    issues.push('sentence-clean-start');
  }

  if (endsWithWeakConnector(lastSentence) || hasTrailingConnectorRepair) {
    issues.push(hasTrailingConnectorRepair
      ? 'sentence-trailing-connector-repaired'
      : 'sentence-trailing-connector-unrepaired');
  }

  if (canTreatAsOpenSentence(lastSentence) || hasOpenSentenceRepair) {
    issues.push(hasOpenSentenceRepair
      ? 'sentence-open-ending-repaired'
      : 'sentence-open-ending-unrepaired');
  } else if (!endsWithWeakConnector(lastSentence)) {
    issues.push('sentence-clean-ending');
  }

  const hasBrokenBoundary = issues.some((issue) => issue.endsWith('-unrepaired'));
  const hasRepairedBoundary = issues.some((issue) => issue.endsWith('-repaired'));
  const sentenceBoundaryIntegrityGrade: SliceSentenceBoundaryIntegrityGrade = hasBrokenBoundary
    ? 'broken'
    : hasRepairedBoundary
      ? 'repaired'
      : 'clean';
  const sentenceBoundaryIntegrityScore = clampSlicePlannerScore(
    sentenceBoundaryIntegrityGrade === 'clean'
      ? 0.96
      : sentenceBoundaryIntegrityGrade === 'repaired'
        ? 0.82
        : 0.28,
  );
  const normalizedIssues = mergePlanRisks(issues) ?? [];

  return {
    sentenceBoundaryIntegrityScore,
    sentenceBoundaryIntegrityGrade,
    sentenceBoundaryIssues: normalizedIssues,
  } satisfies Pick<
    NormalizedSlicePlanClip,
    'sentenceBoundaryIntegrityScore' | 'sentenceBoundaryIntegrityGrade' | 'sentenceBoundaryIssues'
  >;
}

function createContentArcRisks(missingStages: readonly SliceContentArcStage[]) {
  return missingStages.map((stage) => `missing-content-${stage}`);
}

function inferContentArcStages(text: string): SliceContentArcStage[] {
  const normalizedText = text.toLowerCase();
  const stages: SliceContentArcStage[] = [];
  const addStage = (stage: SliceContentArcStage) => {
    if (!stages.includes(stage)) {
      stages.push(stage);
    }
  };

  if (
    includesAnyMarker(normalizedText, CHINESE_HOOK_MARKERS) ||
    /\b(why|how|what|when|secret|mistake|watch|attention|important|key|tip|seconds?|scroll)\b/.test(normalizedText) ||
    /[?\uff1f]/u.test(text)
  ) {
    addStage('hook');
  }

  if (
    includesAnyMarker(normalizedText, CHINESE_CONTEXT_MARKERS) ||
    /\b(because|case|example|first|second|context|reason|means|shows|happened|launch|background|scenario)\b/.test(normalizedText)
  ) {
    addStage('setup');
  }

  if (
    includesAnyMarker(normalizedText, ['\u95ee\u9898', '\u75db\u70b9', '\u4e0d\u591f', '\u5931\u8d25', '\u4e0d\u77e5\u9053', '\u56f0\u96be']) ||
    /\b(problem|pain|mistake|risk|tradeoff|unclear|unresolved|difficult|fails?|failure|before people scroll|should care)\b/.test(normalizedText)
  ) {
    addStage('conflict');
  }

  if (
    includesAnyMarker(normalizedText, CHINESE_PAYOFF_MARKERS) ||
    /\b(so|therefore|result|fix|solution|finally|lesson|answer|works|improves|do this|you should|payoff)\b/.test(normalizedText)
  ) {
    addStage('payoff');
  }

  return stages;
}

function createContentArcMetadata(text: string) {
  const contentArcStages = inferContentArcStages(text);
  const contentArcMissingStages = CONTENT_ARC_STAGES.filter((stage) => !contentArcStages.includes(stage));
  const contentArcScore = clampSlicePlannerScore(contentArcStages.length / CONTENT_ARC_STAGES.length);
  const contentArcGrade: SliceContentArcGrade =
    contentArcStages.length >= CONTENT_ARC_STAGES.length
      ? 'complete'
      : contentArcStages.length >= 2
        ? 'partial'
        : 'thin';

  return {
    contentArcScore,
    contentArcGrade,
    contentArcStages,
    contentArcMissingStages,
  } satisfies Pick<
    NormalizedSlicePlanClip,
    'contentArcScore' | 'contentArcGrade' | 'contentArcStages' | 'contentArcMissingStages'
  >;
}

const TOPIC_STOPWORDS = new Set([
  'about',
  'after',
  'again',
  'also',
  'and',
  'annual',
  'are',
  'because',
  'before',
  'care',
  'concrete',
  'does',
  'fast',
  'for',
  'from',
  'had',
  'has',
  'have',
  'how',
  'into',
  'next',
  'not',
  'one',
  'people',
  'prove',
  'section',
  'should',
  'that',
  'the',
  'they',
  'then',
  'this',
  'through',
  'uses',
  'when',
  'why',
  'with',
  'you',
  'your',
]);

const TOPIC_KEYWORD_GROUPS = [
  ['opening', 'viewer', 'viewers', 'pain', 'retention', 'scroll', 'hook', 'result', 'fix', 'lead'],
  ['pricing', 'price', 'invoice', 'invoices', 'refund', 'terms', 'annual', 'model'],
  ['launch', 'implementation', 'details', 'tradeoff', 'tradeoffs'],
  ['背景', '案例', '原因', '用户', '痛点', '爆发', '适合', '完整', '短视频', '完播', '开头', '问题', '场景', '结果', '例子', '解决', '办法'],
] as const;

const CHINESE_TOPIC_KEYWORDS = [
  '背景',
  '案例',
  '原因',
  '用户',
  '痛点',
  '爆发',
  '适合',
  '完整',
  '短视频',
  '完播',
  '开头',
  '问题',
  '场景',
  '结果',
  '例子',
  '解决',
  '办法',
  '方法',
  '结论',
  '建议',
] as const;

function extractTopicKeywords(text: string) {
  const englishKeywords = Array.from(text.toLowerCase().matchAll(/\b[a-z][a-z0-9-]{3,}\b/g))
    .map((match) => match[0].replace(/s$/u, ''))
    .filter((keyword) => !TOPIC_STOPWORDS.has(keyword));
  const chineseDictionaryKeywords = CHINESE_TOPIC_KEYWORDS.filter((keyword) => text.includes(keyword));
  const chineseFallbackKeywords = chineseDictionaryKeywords.length > 0
    ? []
    : Array.from(text.matchAll(/[\u4e00-\u9fff]{2,4}/gu)).map((match) => match[0]);
  return normalizeTopicKeywords([...englishKeywords, ...chineseDictionaryKeywords, ...chineseFallbackKeywords]) ?? [];
}

function calculateKeywordSimilarity(firstKeywords: readonly string[], secondKeywords: readonly string[]) {
  if (firstKeywords.length === 0 || secondKeywords.length === 0) {
    return 0;
  }

  const firstSet = new Set(firstKeywords);
  const secondSet = new Set(secondKeywords);
  let intersectionCount = 0;
  for (const keyword of firstSet) {
    if (secondSet.has(keyword)) {
      intersectionCount += 1;
    }
  }

  const unionCount = new Set([...firstSet, ...secondSet]).size;
  return unionCount > 0 ? intersectionCount / unionCount : 0;
}

function hasSharedTopicGroup(firstKeywords: readonly string[], secondKeywords: readonly string[]) {
  const firstSet = new Set(firstKeywords);
  const secondSet = new Set(secondKeywords);
  return TOPIC_KEYWORD_GROUPS.some((group) =>
    group.some((keyword) => firstSet.has(keyword)) &&
    group.some((keyword) => secondSet.has(keyword)),
  );
}

function createTopicCoherenceMetadataFromTexts(texts: readonly string[]) {
  const joinedText = texts.join(' ');
  const segmentKeywordSets = texts
    .map((text) => extractTopicKeywords(text))
    .filter((keywords) => keywords.length > 0);
  const allKeywords = extractTopicKeywords(joinedText);
  const corruptedEncoding = looksLikeCorruptedTranscriptEncoding(joinedText);
  if (corruptedEncoding) {
    return {
      topicCoherenceScore: 0.72,
      topicCoherenceGrade: 'mixed',
      topicShiftCount: 0,
      topicKeywords: allKeywords.slice(0, 8),
    } satisfies Pick<
      NormalizedSlicePlanClip,
      'topicCoherenceScore' | 'topicCoherenceGrade' | 'topicShiftCount' | 'topicKeywords'
    >;
  }

  if (segmentKeywordSets.length <= 1) {
    return {
      topicCoherenceScore: allKeywords.length > 0 ? 1 : 0.45,
      topicCoherenceGrade: allKeywords.length > 0 ? 'strong' : 'mixed',
      topicShiftCount: 0,
      topicKeywords: allKeywords.slice(0, 8),
    } satisfies Pick<
      NormalizedSlicePlanClip,
      'topicCoherenceScore' | 'topicCoherenceGrade' | 'topicShiftCount' | 'topicKeywords'
    >;
  }

  let similaritySum = 0;
  let comparisonCount = 0;
  let topicShiftCount = 0;
  for (let index = 1; index < segmentKeywordSets.length; index += 1) {
    const previousKeywords = segmentKeywordSets[index - 1];
    const currentKeywords = segmentKeywordSets[index];
    if (!previousKeywords || !currentKeywords) {
      continue;
    }

    const directSimilarity = calculateKeywordSimilarity(previousKeywords, currentKeywords);
    const similarity = directSimilarity > 0 || hasSharedTopicGroup(previousKeywords, currentKeywords)
      ? Math.max(directSimilarity, 0.55)
      : directSimilarity;
    similaritySum += similarity;
    comparisonCount += 1;
    if (similarity < 0.12 && !hasSharedTopicGroup(previousKeywords, currentKeywords)) {
      topicShiftCount += 1;
    }
  }

  const averageSimilarity = comparisonCount > 0 ? similaritySum / comparisonCount : 0;
  const shiftPenalty = topicShiftCount / Math.max(1, comparisonCount);
  const topicCoherenceScore = clampSlicePlannerScore(0.55 + averageSimilarity * 0.55 - shiftPenalty * 0.35);
  const topicCoherenceGrade: SliceTopicCoherenceGrade =
    topicShiftCount > 0
      ? 'weak'
      : topicCoherenceScore >= 0.75
      ? 'strong'
      : topicCoherenceScore >= 0.45
        ? 'mixed'
        : 'weak';

  return {
    topicCoherenceScore,
    topicCoherenceGrade,
    topicShiftCount,
    topicKeywords: allKeywords.slice(0, 8),
  } satisfies Pick<
    NormalizedSlicePlanClip,
    'topicCoherenceScore' | 'topicCoherenceGrade' | 'topicShiftCount' | 'topicKeywords'
  >;
}

function createPublishabilityMetadata(clip: Partial<NormalizedSlicePlanClip>) {
  const qualityScore = typeof clip.qualityScore === 'number' ? clip.qualityScore : 0.5;
  const continuityScore = typeof clip.continuityScore === 'number' ? clip.continuityScore : 0.6;
  const transcriptCoverageScore = typeof clip.transcriptCoverageScore === 'number'
    ? clip.transcriptCoverageScore
    : 0;
  const storyShapeScore = clip.storyShape === 'complete'
    ? 1
    : clip.storyShape === 'contextOnly'
      ? 0.68
      : clip.storyShape === 'setupOnly' || clip.storyShape === 'payoffOnly'
        ? 0.45
        : 0.25;
  const speechScore = clip.speechContinuityGrade === 'strong'
    ? 1
    : clip.speechContinuityGrade === 'repaired'
      ? 0.78
      : 0.25;
  const sentenceBoundaryScore = typeof clip.sentenceBoundaryIntegrityScore === 'number'
    ? clip.sentenceBoundaryIntegrityScore
    : 0.68;
  const sentenceBoundaryPenalty = clip.sentenceBoundaryIntegrityGrade === 'broken'
    ? 0.1
    : clip.sentenceBoundaryIntegrityGrade === 'repaired'
      ? 0.03
      : 0;
  const subtitleScore = typeof clip.subtitleSegmentCount === 'number' && clip.subtitleSegmentCount > 0
    ? 1
    : 0.2;
  const boundaryQualityScore = typeof clip.boundaryQualityScore === 'number'
    ? clip.boundaryQualityScore
    : 0.25;
  const contentArcScore = typeof clip.contentArcScore === 'number'
    ? clip.contentArcScore
    : clip.storyShape === 'complete'
      ? 1
      : clip.storyShape === 'contextOnly'
        ? 0.5
        : clip.storyShape === 'setupOnly' || clip.storyShape === 'payoffOnly'
          ? 0.5
          : 0.25;
  const topicCoherenceScore = typeof clip.topicCoherenceScore === 'number'
    ? clip.topicCoherenceScore
    : 0.6;
  const riskCount = Array.isArray(clip.risks) ? clip.risks.length : 0;
  const riskPenalty = Math.min(0.2, riskCount * 0.04);
  const publishabilityScore = clampSlicePlannerScore(
    qualityScore * 0.19 +
      continuityScore * 0.17 +
      storyShapeScore * 0.13 +
      transcriptCoverageScore * 0.12 +
      speechScore * 0.12 +
      subtitleScore * 0.04 +
      boundaryQualityScore * 0.09 +
      contentArcScore * 0.08 +
      topicCoherenceScore * 0.05 +
      sentenceBoundaryScore * 0.01 -
      sentenceBoundaryPenalty -
      riskPenalty,
  );
  const publishabilityGrade: NonNullable<NormalizedSlicePlanClip['publishabilityGrade']> =
    publishabilityScore >= 0.86 && qualityScore >= 0.86 && continuityScore >= 0.86
      ? 'excellent'
      : publishabilityScore >= 0.68
      ? 'good'
      : publishabilityScore >= 0.2
        ? 'review'
        : 'reject';

  const issues = mergePlanRisks(
    clip.publishabilityIssues,
    clip.risks,
    clip.storyShape && clip.storyShape !== 'complete' ? createStoryShapeRisks(clip.storyShape) : undefined,
    clip.contentArcMissingStages?.length ? createContentArcRisks(clip.contentArcMissingStages) : undefined,
    clip.topicCoherenceGrade === 'weak' || (clip.topicShiftCount ?? 0) > 0 ? ['topic-drift'] : undefined,
    clip.hookStrength === 'weak' ? ['weak-hook'] : undefined,
    clip.endingCompleteness === 'open' ? ['open-ending'] : undefined,
    clip.speechContinuityGrade === 'weak' ? ['weak-speech-continuity'] : undefined,
    clip.sentenceBoundaryIntegrityGrade === 'broken' ? ['broken-sentence-boundary'] : undefined,
    clip.sentenceBoundaryIssues?.some((issue) => issue.endsWith('-unrepaired'))
      ? ['unrepaired-sentence-boundary']
      : undefined,
    transcriptCoverageScore < 0.65 ? ['low-transcript-coverage'] : undefined,
    typeof clip.subtitleSegmentCount === 'number' && clip.subtitleSegmentCount <= 0 ? ['no-subtitle-segments'] : undefined,
  ) ?? [];

  return {
    publishabilityScore,
    publishabilityGrade,
    publishabilityIssues: issues,
  } satisfies Pick<NormalizedSlicePlanClip, 'publishabilityScore' | 'publishabilityGrade' | 'publishabilityIssues'>;
}

function createPlatformReadinessMetadata(
  clip: Partial<NormalizedSlicePlanClip>,
  policy: VideoSlicePlanningPolicy,
) {
  const platformProfile = SLICE_PLATFORM_PROFILES[policy.targetPlatform] ?? SLICE_PLATFORM_PROFILES.generic;
  const publishabilityScore = typeof clip.publishabilityScore === 'number'
    ? clip.publishabilityScore
    : createPublishabilityMetadata(clip).publishabilityScore;
  const qualityScore = typeof clip.qualityScore === 'number' ? clip.qualityScore : 0.5;
  const continuityScore = typeof clip.continuityScore === 'number' ? clip.continuityScore : 0.6;
  const boundaryQualityScore = typeof clip.boundaryQualityScore === 'number' ? clip.boundaryQualityScore : 0.25;
  const sentenceBoundaryScore = typeof clip.sentenceBoundaryIntegrityScore === 'number'
    ? clip.sentenceBoundaryIntegrityScore
    : 0.68;
  const contentArcScore = typeof clip.contentArcScore === 'number'
    ? clip.contentArcScore
    : clip.storyShape === 'complete'
      ? 1
      : 0.35;
  const topicCoherenceScore = typeof clip.topicCoherenceScore === 'number' ? clip.topicCoherenceScore : 0.6;
  const durationMs = typeof clip.durationMs === 'number' ? clip.durationMs : 0;
  const durationCenterMs = Math.max(
    1,
    (platformProfile.idealMinDurationMs + platformProfile.idealMaxDurationMs) / 2,
  );
  const durationDistance = Math.abs(durationMs - durationCenterMs) / durationCenterMs;
  const durationFitScore = durationMs >= platformProfile.idealMinDurationMs &&
    durationMs <= platformProfile.idealMaxDurationMs
    ? 1
    : durationMs <= platformProfile.maxReviewDurationMs
      ? Math.max(0.42, 0.82 - durationDistance * 0.7)
      : Math.max(0.08, 0.38 - durationDistance * 0.4);
  const hookScore = clip.hookStrength === 'strong'
    ? 1
    : clip.hookStrength === 'contextual'
      ? 0.68
      : 0.18;
  const endingScore = clip.endingCompleteness === 'complete'
    ? 1
    : clip.endingCompleteness === 'soft'
      ? 0.76
      : 0.2;
  const topicFitScore = clip.topicCoherenceGrade === 'strong'
    ? Math.max(0.88, topicCoherenceScore)
    : clip.topicCoherenceGrade === 'mixed' && platformProfile.tolerateMixedTopic
      ? Math.max(0.62, Math.min(0.78, topicCoherenceScore))
    : clip.topicCoherenceGrade === 'mixed'
        ? Math.min(0.5, topicCoherenceScore)
        : Math.min(0.22, topicCoherenceScore);
  const issueGroups: string[][] = [];

  if (durationMs > 0 && durationMs < platformProfile.idealMinDurationMs) {
    issueGroups.push(['platform-duration-too-short']);
  }
  if (durationMs > platformProfile.idealMaxDurationMs) {
    issueGroups.push(['platform-duration-too-long']);
  }
  if (durationMs > platformProfile.maxReviewDurationMs) {
    issueGroups.push(['platform-duration-reject']);
  }
  if (platformProfile.requireStrongHook && clip.hookStrength !== 'strong') {
    issueGroups.push(['platform-hook-not-strong']);
  } else if (clip.hookStrength === 'weak') {
    issueGroups.push(['platform-weak-hook']);
  }
  if (clip.endingCompleteness === 'open') {
    issueGroups.push(['platform-open-ending']);
  }
  if (clip.sentenceBoundaryIntegrityGrade === 'broken' && clip.sentenceBoundaryIssues?.some((issue) => issue.endsWith('-unrepaired'))) {
    issueGroups.push(['platform-broken-sentence-boundary']);
  }
  if (clip.contentArcGrade !== 'complete') {
    issueGroups.push(['platform-incomplete-arc']);
  }
  if (clip.topicCoherenceGrade === 'weak' || (!platformProfile.tolerateMixedTopic && clip.topicCoherenceGrade === 'mixed')) {
    issueGroups.push(['platform-topic-drift']);
  }

  const issues = mergePlanRisks(
    ...issueGroups,
    clip.platformReadinessIssues,
  ) ?? [];
  const normalizedIssues = issues.filter((issue) => issue !== 'platform-ready');
  const issuePenalty = Math.min(0.22, issues.filter((issue) => issue !== 'platform-ready').length * 0.035);
  const platformReadinessScore = clampSlicePlannerScore(
    publishabilityScore * 0.22 +
      qualityScore * 0.11 +
      continuityScore * 0.12 +
      boundaryQualityScore * 0.13 +
      contentArcScore * 0.13 +
      topicFitScore * 0.08 +
      durationFitScore * 0.1 +
      sentenceBoundaryScore * 0.02 +
      hookScore * 0.06 +
      endingScore * 0.03 -
      issuePenalty,
  );
  const platformReadinessGrade: SlicePlatformReadinessGrade =
    normalizedIssues.includes('platform-duration-reject') ||
    platformReadinessScore < platformProfile.rejectScoreThreshold ||
    clip.endingCompleteness === 'open' ||
    clip.hookStrength === 'weak' ||
    (clip.sentenceBoundaryIntegrityGrade === 'broken' && normalizedIssues.includes('platform-broken-sentence-boundary'))
      ? 'reject'
      : platformReadinessScore >= platformProfile.readyScoreThreshold && normalizedIssues.length === 0
        ? 'ready'
        : 'review';

  return {
    platformReadinessScore,
    platformReadinessGrade,
    platformReadinessIssues: normalizedIssues,
  } satisfies Pick<
    NormalizedSlicePlanClip,
    'platformReadinessScore' | 'platformReadinessGrade' | 'platformReadinessIssues'
  >;
}

function summarizeTranscriptText(text: string) {
  const normalizedText = normalizePlanText(text, 150);
  return normalizedText
    ? `Speech-to-text window: ${normalizedText}`
    : 'Speech-to-text window selected from continuous transcript segments.';
}

function createDeterministicSliceMetadata(
  index: number,
  startMs: number,
  durationMs: number,
  policy: VideoSlicePlanningPolicy,
  risks: readonly string[] = [],
) {
  const normalizedRisks = mergePlanRisks(['fallback-plan', 'no-transcript-boundary'], risks);
  const metadata = {
    title: createPlannerSliceLabel(index),
    summary: 'Deterministic fallback window generated because no reliable speech-to-text or AI slice boundary was available.',
    reason: 'The planner keeps fallback intervals continuous, bounded, and non-overlapping so rendering can still produce reviewable short videos.',
    qualityScore: 0.5,
    continuityScore: 0.7,
    storyShape: 'thin',
    ...(normalizedRisks ? { risks: normalizedRisks } : {}),
    sourceStartMs: startMs,
    sourceEndMs: startMs + durationMs,
    speechStartMs: startMs,
    speechEndMs: startMs + durationMs,
    boundaryPaddingBeforeMs: 0,
    boundaryPaddingAfterMs: 0,
    transcriptCoverageScore: 0,
    subtitleSegmentCount: 0,
    speechContinuityGrade: 'weak',
    boundaryQualityScore: 0.25,
    hookStrength: 'weak',
    endingCompleteness: 'open',
    sentenceBoundaryIntegrityScore: 0.68,
    sentenceBoundaryIntegrityGrade: 'repaired',
    sentenceBoundaryIssues: ['sentence-boundary-unavailable'],
    contentArcScore: 0,
    contentArcGrade: 'thin',
    contentArcStages: [],
    contentArcMissingStages: [...CONTENT_ARC_STAGES],
    topicCoherenceScore: 0.35,
    topicCoherenceGrade: 'weak',
    topicShiftCount: 0,
    topicKeywords: [],
  } satisfies Partial<NormalizedSlicePlanClip>;

  const metadataWithPublishability = {
    ...metadata,
    ...createPublishabilityMetadata(metadata),
  } satisfies Partial<NormalizedSlicePlanClip>;

  return attachPlatformReadinessMetadata(
    metadataWithPublishability,
    policy,
  );
}

function attachPlatformReadinessMetadata(
  clip: Partial<NormalizedSlicePlanClip>,
  policy: VideoSlicePlanningPolicy,
): Partial<NormalizedSlicePlanClip> {
  return {
    ...clip,
    ...createPlatformReadinessMetadata(clip, policy),
  };
}

function inferTranscriptStoryShape(text: string): NormalizedSlicePlanClip['storyShape'] {
  const normalizedText = text.toLowerCase();
  const hasChineseHook = includesAnyMarker(normalizedText, CHINESE_HOOK_MARKERS);
  const hasChineseContext = includesAnyMarker(normalizedText, CHINESE_CONTEXT_MARKERS);
  const hasChinesePayoff = includesAnyMarker(normalizedText, CHINESE_PAYOFF_MARKERS);
  if (hasChineseHook && hasChineseContext && hasChinesePayoff) {
    return 'complete';
  }

  if (hasChinesePayoff && !hasChineseHook && !hasChineseContext) {
    return 'payoffOnly';
  }

  if (hasChineseContext && !hasChinesePayoff) {
    return 'setupOnly';
  }

  if (hasChineseHook || hasChinesePayoff) {
    return 'contextOnly';
  }

  const hasHook = /\b(why|how|what|when|secret|mistake|problem|pain|scroll|seconds?|watch|attention|important|key|result|tip)\b/.test(normalizedText);
  const hasContext = /\b(because|case|example|data|first|second|context|reason|means|shows|happened|launch|team)\b/.test(normalizedText);
  const hasPayoff = /\b(so|therefore|result|fix|solution|payoff|finally|lesson|do this|you should|the answer|works|improves)\b/.test(normalizedText);

  if (hasHook && hasContext && hasPayoff) {
    return 'complete';
  }

  if (hasPayoff && !hasHook && !hasContext) {
    return 'payoffOnly';
  }

  if (hasContext && !hasPayoff) {
    return 'setupOnly';
  }

  if (hasHook || hasPayoff) {
    return 'contextOnly';
  }

  return 'thin';
}

function createStoryShapeRisks(storyShape: NormalizedSlicePlanClip['storyShape']) {
  if (storyShape === 'complete') {
    return [];
  }

  if (storyShape === 'payoffOnly') {
    return ['missing-setup'];
  }

  if (storyShape === 'setupOnly' || storyShape === 'contextOnly') {
    return ['missing-payoff'];
  }

  return ['missing-hook', 'missing-payoff'];
}

function createTranscriptSliceMetadata(
  label: string,
  text: string,
  score: number,
  startMs: number,
  endMs: number,
  speechStartMs: number,
  speechEndMs: number,
  boundaryPaddingBeforeMs: number,
  boundaryPaddingAfterMs: number,
  risks: readonly string[],
  subtitleSegmentCount: number,
  transcriptSpeechDurationMs: number,
  transcriptTexts: readonly string[] = [text],
) {
  const hasConnectorRepair = risks.includes('connector-repaired');
  const hasTrailingExtension = risks.includes('trailing-connector-extended');
  const hasOpenSentenceExtension = risks.includes('open-sentence-extended');
  const continuityPenalty =
    (hasConnectorRepair ? 0.05 : 0) +
    (hasTrailingExtension ? 0.03 : 0) +
    (hasOpenSentenceExtension ? 0.04 : 0);
  const normalizedRisks = mergePlanRisks(risks);
  const storyShape = inferTranscriptStoryShape(text);
  const boundaryMetadata = createBoundaryQualityMetadata(text, risks);
  const sentenceBoundaryMetadata = createSentenceBoundaryIntegrityMetadata(text, risks);
  const contentArcMetadata = createContentArcMetadata(text);
  const topicCoherenceMetadata = createTopicCoherenceMetadataFromTexts(transcriptTexts);
  const mergedRisks = mergePlanRisks(
    normalizedRisks,
    createStoryShapeRisks(storyShape),
    contentArcMetadata.contentArcMissingStages.length > 0
      ? createContentArcRisks(contentArcMetadata.contentArcMissingStages)
      : undefined,
    topicCoherenceMetadata.topicCoherenceGrade === 'weak' || topicCoherenceMetadata.topicShiftCount > 0
      ? ['topic-drift']
      : undefined,
    boundaryMetadata.hookStrength === 'weak' ? ['weak-hook'] : undefined,
    boundaryMetadata.endingCompleteness === 'open' ? ['open-ending'] : undefined,
    sentenceBoundaryMetadata.sentenceBoundaryIntegrityGrade === 'broken'
      ? ['broken-sentence-boundary']
      : undefined,
  );
  const transcriptCoverageScore = clampSlicePlannerScore(
    speechEndMs > speechStartMs ? transcriptSpeechDurationMs / (speechEndMs - speechStartMs) : 0,
  );
  const speechContinuityGrade: NonNullable<NormalizedSlicePlanClip['speechContinuityGrade']> =
    subtitleSegmentCount <= 0 || transcriptCoverageScore < 0.5
      ? 'weak'
      : hasConnectorRepair || hasTrailingExtension || hasOpenSentenceExtension || transcriptCoverageScore < 0.85
        ? 'repaired'
        : 'strong';

  const metadata = {
    title: label,
    summary: summarizeTranscriptText(text),
    reason: 'Planner selected a continuous speech-to-text window and aligned slice boundaries to transcript segment edges for complete voice content.',
    qualityScore: clampSlicePlannerScore(score),
    continuityScore: clampSlicePlannerScore(0.93 - continuityPenalty),
    ...(storyShape ? { storyShape } : {}),
    ...(mergedRisks ? { risks: mergedRisks } : {}),
    sourceStartMs: startMs,
    sourceEndMs: endMs,
    speechStartMs,
    speechEndMs,
    boundaryPaddingBeforeMs,
    boundaryPaddingAfterMs,
    transcriptText: text,
    transcriptCoverageScore,
    subtitleSegmentCount,
    speechContinuityGrade,
    ...boundaryMetadata,
    ...sentenceBoundaryMetadata,
    ...contentArcMetadata,
    ...topicCoherenceMetadata,
  } satisfies Partial<NormalizedSlicePlanClip>;

  return {
    ...metadata,
    ...createPublishabilityMetadata(metadata),
  } satisfies Partial<NormalizedSlicePlanClip>;
}

function findBestOverlappingTranscriptCandidate(
  transcriptCandidates: readonly TranscriptSliceCandidate[],
  startMs: number,
  durationMs: number,
) {
  const endMs = startMs + durationMs;
  let bestCandidate: TranscriptSliceCandidate | undefined;
  let bestOverlapMs = 0;

  for (const candidate of transcriptCandidates) {
    const overlapMs = Math.max(0, Math.min(endMs, candidate.endMs) - Math.max(startMs, candidate.startMs));
    if (
      overlapMs > bestOverlapMs ||
      (overlapMs === bestOverlapMs && bestCandidate && candidate.score > bestCandidate.score)
    ) {
      bestCandidate = candidate;
      bestOverlapMs = overlapMs;
    }
  }

  return bestOverlapMs > 0 ? bestCandidate : undefined;
}

function createLlmTimingRisks(
  existingRisks: readonly string[] | undefined,
  matchedCandidate: TranscriptSliceCandidate | undefined,
  snappedToTranscript: boolean,
) {
  return mergePlanRisks(
    existingRisks,
    snappedToTranscript ? ['llm-timing-snapped-to-transcript'] : undefined,
    matchedCandidate ? undefined : ['llm-timing-without-transcript'],
  );
}

function scoreTranscriptCandidate(
  params: VideoSliceParams,
  policy: VideoSlicePlanningPolicy,
  text: string,
  durationMs: number,
  minDurationMs: number,
  maxDurationMs: number,
) {
  const normalizedText = text.toLowerCase();
  const targetDurationMs = Math.min(maxDurationMs, Math.max(minDurationMs, policy.idealDurationMs));
  const durationDistance = Math.abs(durationMs - targetDurationMs) / Math.max(targetDurationMs, 1);
  let score = 0.55 + Math.max(0, 0.2 - durationDistance * 0.2);

  if (params.highlightEngine === 'keyword' && /重点|关键|核心|方法|步骤|原因|结果|建议|总结|案例|参数|爆发|痛点|important|key|reason|result|tip|case/.test(normalizedText)) {
    score += 0.18;
  }

  if (params.highlightEngine === 'emotion' && /惊喜|震撼|真实|爆了|爆发|痛点|喜欢|反转|问题|解决|wow|amazing|surprise|pain|love/.test(normalizedText)) {
    score += 0.18;
  }

  if (params.highlightEngine === 'motion' && /看这里|展示|演示|画面|动作|镜头|变化|show|demo|watch|move/.test(normalizedText)) {
    score += 0.14;
  }

  if (params.mode === '商品直播' && /价格|优惠|下单|库存|卖点|产品|参数|购买/.test(normalizedText)) {
    score += 0.16;
  }

  if (params.mode === '单人讲解' && /第一|第二|第三|方法|技巧|重点|总结|原因/.test(normalizedText)) {
    score += 0.12;
  }

  if (startsWithWeakConnector(text)) {
    score -= 0.08;
  }

  if (policy.customKeywords.some((keyword) => normalizedText.includes(keyword))) {
    score += 0.22;
  }

  const storyShape = inferTranscriptStoryShape(text);
  if (storyShape === 'complete') {
    score += 0.12;
  } else if (storyShape === 'thin') {
    score -= 0.08;
  }

  return Math.max(0, Math.min(1, score));
}

export function buildTranscriptSliceCandidates(
  params: VideoSliceParams,
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
): TranscriptSliceCandidate[] {
  const { minDurationMs, maxDurationMs } = getVideoSliceDurationBounds(params);
  const policy = getVideoSlicePlanningPolicy(params);
  const segments = normalizeTranscriptSegments(transcriptSegments);
  const candidates: TranscriptSliceCandidate[] = [];

  for (let anchorIndex = 0; anchorIndex < segments.length; anchorIndex += 1) {
    const anchorSegment = segments[anchorIndex];
    if (!anchorSegment) {
      continue;
    }

    let startIndex = anchorIndex;
    const previousAnchorSegment = segments[anchorIndex - 1];
    if (
      previousAnchorSegment &&
      startsWithWeakConnector(anchorSegment.text) &&
      canJoinTranscriptSegments(previousAnchorSegment, anchorSegment, policy) &&
      anchorSegment.endMs - previousAnchorSegment.startMs <= maxDurationMs
    ) {
      startIndex = anchorIndex - 1;
    }
    const repairedConnectorStart = startIndex !== anchorIndex;

    let endIndex = anchorIndex;
    while (endIndex + 1 < segments.length) {
      const currentEndSegment = segments[endIndex];
      const nextSegment = segments[endIndex + 1];
      const startSegment = segments[startIndex];
      if (
        !currentEndSegment ||
        !nextSegment ||
        !startSegment ||
        !canJoinTranscriptSegments(currentEndSegment, nextSegment, policy) ||
        nextSegment.endMs - startSegment.startMs > maxDurationMs ||
        currentEndSegment.endMs - startSegment.startMs >= minDurationMs
      ) {
        break;
      }

      endIndex += 1;
    }

    let extendedTrailingConnector = false;
    let extendedOpenSentence = false;
    while (endIndex + 1 < segments.length) {
      const currentEndSegment = segments[endIndex];
      const nextSegment = segments[endIndex + 1];
      const startSegment = segments[startIndex];
      const currentDurationMs = currentEndSegment && startSegment
        ? currentEndSegment.endMs - startSegment.startMs
        : 0;
      const shouldExtendCompleteSpeech =
        currentEndSegment &&
        currentDurationMs >= minDurationMs &&
        (endsWithWeakConnector(currentEndSegment.text) || canTreatAsOpenSentence(currentEndSegment.text));
      if (
        !currentEndSegment ||
        !nextSegment ||
        !startSegment ||
        (currentDurationMs >= minDurationMs && !shouldExtendCompleteSpeech) ||
        !canJoinTranscriptSegments(currentEndSegment, nextSegment, policy) ||
        nextSegment.endMs - startSegment.startMs > maxDurationMs
      ) {
        break;
      }

      if (currentDurationMs >= minDurationMs) {
        if (endsWithWeakConnector(currentEndSegment.text)) {
          extendedTrailingConnector = true;
        } else if (canTreatAsOpenSentence(currentEndSegment.text)) {
          extendedOpenSentence = true;
        }
      }
      endIndex += 1;
    }

    while (startIndex > 0) {
      const currentStartSegment = segments[startIndex];
      const previousSegment = segments[startIndex - 1];
      const endSegment = segments[endIndex];
      if (
        !currentStartSegment ||
        !previousSegment ||
        !endSegment ||
        endSegment.endMs - currentStartSegment.startMs >= minDurationMs ||
        !canJoinTranscriptSegments(previousSegment, currentStartSegment, policy) ||
        endSegment.endMs - previousSegment.startMs > maxDurationMs
      ) {
        break;
      }

      startIndex -= 1;
    }

    const startSegment = segments[startIndex];
    const endSegment = segments[endIndex];
    if (!startSegment || !endSegment) {
      continue;
    }

    const timing = createTranscriptBoundaryTiming(
      segments,
      startIndex,
      endIndex,
      policy,
      minDurationMs,
      maxDurationMs,
    );
    if (!timing || timing.durationMs < MIN_SLICE_DURATION_MS) {
      continue;
    }

    const text = segments
      .slice(startIndex, endIndex + 1)
      .map((segment) => segment.text)
      .join(' ')
      .trim();
    const candidateSegments = segments.slice(startIndex, endIndex + 1);
    const transcriptSpeechDurationMs = candidateSegments.reduce(
      (durationSumMs, segment) => durationSumMs + Math.max(0, segment.endMs - segment.startMs),
      0,
    );
    const startMs = timing.startMs;
    const endMs = timing.endMs;
    const durationMs = timing.durationMs;
    const label = createTranscriptSliceLabel(segments, anchorIndex);
    const score = scoreTranscriptCandidate(params, policy, text, durationMs, minDurationMs, maxDurationMs);
    const joinsConnectorInsideWindow = candidateSegments
      .slice(1)
      .some((segment) => startsWithWeakConnector(segment.text));
    const risks = [
      ...(repairedConnectorStart || joinsConnectorInsideWindow ? ['connector-repaired'] : []),
      ...(extendedTrailingConnector ? ['trailing-connector-extended'] : []),
      ...(extendedOpenSentence ? ['open-sentence-extended'] : []),
    ];

    candidates.push({
      candidateId: `transcript-${anchorIndex + 1}`,
      index: candidates.length,
      anchorSegmentIndex: anchorIndex,
      startMs,
      endMs,
      durationMs,
      text,
      label,
      score,
      ...createTranscriptSliceMetadata(
        label,
        text,
        score,
        startMs,
        endMs,
        timing.speechStartMs,
        timing.speechEndMs,
        timing.boundaryPaddingBeforeMs,
        timing.boundaryPaddingAfterMs,
        risks,
        candidateSegments.length,
        transcriptSpeechDurationMs,
        candidateSegments.map((segment) => segment.text),
      ),
    });
  }

  return sortTranscriptSliceCandidatesByScore(candidates.map((candidate) => ({
    ...candidate,
    ...createPlatformReadinessMetadata(candidate, policy),
  }))).slice(
    0,
    Math.max(policy.targetSliceCount * 2, policy.targetSliceCount),
  );
}

export function createDeterministicSlicePlan(params: VideoSliceParams): NormalizedSlicePlanClip[] {
  const policy = getVideoSlicePlanningPolicy(params);
  const { minDurationMs, maxDurationMs } = getVideoSliceDurationBounds(params);
  const durationMs = Math.max(minDurationMs, Math.min(policy.idealDurationMs, maxDurationMs));
  const spacingMs = Math.max(durationMs, 10_000);
  const clips: NormalizedSlicePlanClip[] = [];

  for (let index = 0; index < policy.targetSliceCount; index += 1) {
    const startMs = index * spacingMs;
    if (policy.sourceDurationMs !== undefined && startMs >= policy.sourceDurationMs) {
      break;
    }

    const remainingDurationMs = policy.sourceDurationMs !== undefined
      ? policy.sourceDurationMs - startMs
      : durationMs;
    const safeDurationMs = Math.min(durationMs, remainingDurationMs);
    if (safeDurationMs < MIN_SLICE_DURATION_MS) {
      break;
    }

    const risks = safeDurationMs < durationMs ? ['source-duration-tail'] : [];
    clips.push({
      ...createDeterministicSliceMetadata(clips.length, startMs, safeDurationMs, policy, risks),
      index: clips.length,
      startMs,
      durationMs: safeDurationMs,
      label: `Smart slice ${clips.length + 1}`,
    });
  }

  return clips;
}

export function createTranscriptAssistedSlicePlan(
  params: VideoSliceParams,
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
): NormalizedSlicePlanClip[] {
  const policy = getVideoSlicePlanningPolicy(params);
  const candidates = buildTranscriptSliceCandidates(params, transcriptSegments);

  if (candidates.length === 0) {
    return createDeterministicSlicePlan(params);
  }

  return normalizeCandidateSlicePlan(candidates, params, {
    fillPrecedingGaps: policy.sliceCountMode === 'coverageFirst' || policy.sliceCountMode === 'fixed',
    fillTrailingClips: policy.sliceCountMode === 'coverageFirst' || policy.sliceCountMode === 'fixed',
  });
}

function normalizeCandidateSlicePlanWithQualityStandards(
  candidates: NormalizedSlicePlanClip[],
  params: VideoSliceParams,
  options: NormalizeSlicePlanOptions,
): NormalizedSlicePlanClip[] {
  const { minDurationMs, maxDurationMs } = getVideoSliceDurationBounds(params);
  const policy = getVideoSlicePlanningPolicy(params);
  const fallbackDurationMs = Math.max(minDurationMs, Math.min(policy.idealDurationMs, maxDurationMs));
  const rawCandidates = candidates
    .filter((clip) =>
      Number.isFinite(clip.startMs) &&
      clip.startMs >= 0 &&
      Number.isFinite(clip.durationMs) &&
      clip.durationMs > 0
    )
    .map((clip, index): NormalizedSlicePlanClip | null => {
      const startMs = Math.round(clip.startMs);
      if (policy.sourceDurationMs !== undefined && startMs >= policy.sourceDurationMs) {
        return null;
      }

      const maxCandidateDurationMs = policy.sourceDurationMs !== undefined
        ? Math.min(maxDurationMs, policy.sourceDurationMs - startMs)
        : maxDurationMs;
      if (maxCandidateDurationMs < MIN_SLICE_DURATION_MS) {
        return null;
      }

      const requestedDurationMs = Math.max(minDurationMs, Math.min(Math.round(clip.durationMs), maxDurationMs));
      const durationMs = Math.min(requestedDurationMs, maxCandidateDurationMs);
      if (durationMs < MIN_SLICE_DURATION_MS) {
        return null;
      }

      const metadata = pickPlanMetadata(clip);
      const timingRisks = durationMs < requestedDurationMs ? ['source-duration-tail'] : [];
      const timingMetadata = createNormalizedSliceTimingMetadata(metadata, startMs, durationMs);
      const risks = mergePlanRisks(
        metadata.risks,
        timingRisks,
        timingMetadata.timingMetadataRepaired ? ['timing-metadata-repaired'] : undefined,
      );
      const metadataWithRisks = {
        ...metadata,
        ...(risks ? { risks } : {}),
      } satisfies Partial<NormalizedSlicePlanClip>;
      const sentenceBoundaryMetadata =
        metadataWithRisks.sentenceBoundaryIntegrityScore !== undefined ||
        metadataWithRisks.sentenceBoundaryIntegrityGrade ||
        metadataWithRisks.sentenceBoundaryIssues
          ? {}
          : createSentenceBoundaryIntegrityMetadata(
              metadataWithRisks.transcriptText ?? '',
              metadataWithRisks.risks ?? [],
            );
      const metadataWithSentenceBoundary = {
        ...metadataWithRisks,
        ...sentenceBoundaryMetadata,
      } satisfies Partial<NormalizedSlicePlanClip>;
      const publishabilityMetadata = createPublishabilityMetadata(metadataWithSentenceBoundary);
      const platformReadinessMetadata = createPlatformReadinessMetadata({
        ...metadataWithSentenceBoundary,
        ...publishabilityMetadata,
        startMs,
        durationMs,
      }, policy);

      return {
        ...metadataWithSentenceBoundary,
        ...publishabilityMetadata,
        ...platformReadinessMetadata,
        index,
        startMs,
        durationMs,
        label: clip.label?.trim() || `Smart slice ${index + 1}`,
        sourceStartMs: timingMetadata.sourceStartMs,
        sourceEndMs: timingMetadata.sourceEndMs,
        speechStartMs: timingMetadata.speechStartMs,
        speechEndMs: timingMetadata.speechEndMs,
        boundaryPaddingBeforeMs: timingMetadata.boundaryPaddingBeforeMs,
        boundaryPaddingAfterMs: timingMetadata.boundaryPaddingAfterMs,
      };
    })
    .filter((clip): clip is NormalizedSlicePlanClip => Boolean(clip));

  const selectedCandidates: NormalizedSlicePlanClip[] = [];
  for (const candidate of sortSliceClipsBySelectionScore(rawCandidates, policy)) {
    if (selectedCandidates.some((existingCandidate) => calculateClipOverlapRatio(existingCandidate, candidate) >= 0.65)) {
      continue;
    }

    selectedCandidates.push(candidate);
  }
  const normalizedCandidates = sortSliceClipsByStartMs(selectedCandidates);
  const clips: NormalizedSlicePlanClip[] = [];

  if (policy.sliceCountMode === 'qualityFirst' && options.fillPrecedingGaps !== true && options.fillTrailingClips !== true) {
    return sortSliceClipsByStartMs(
      sortSliceClipsBySelectionScore(selectedCandidates, policy).slice(0, policy.targetSliceCount),
    ).map((candidate, index) => ({
      ...candidate,
      index,
    }));
  }

  const appendClip = (
    startMs: number,
    durationMs: number,
    label: string,
    metadata: Partial<NormalizedSlicePlanClip> = {},
  ) => {
    if (clips.length >= policy.targetSliceCount) {
      return false;
    }
    if (policy.sourceDurationMs !== undefined && startMs >= policy.sourceDurationMs) {
      return false;
    }

    const remainingDurationMs = policy.sourceDurationMs !== undefined
      ? policy.sourceDurationMs - startMs
      : durationMs;
    const safeDurationMs = Math.min(durationMs, remainingDurationMs);
    if (safeDurationMs < MIN_SLICE_DURATION_MS) {
      return false;
    }

    const timingRisks = safeDurationMs < durationMs ? ['source-duration-tail'] : [];
    const fallbackMetadata: Partial<NormalizedSlicePlanClip> = hasPlanMetadata(metadata)
      ? {}
      : createDeterministicSliceMetadata(clips.length, startMs, safeDurationMs, policy, timingRisks);
    const mergedMetadata = {
      ...fallbackMetadata,
      ...metadata,
    } satisfies Partial<NormalizedSlicePlanClip>;
    const timingMetadata = createNormalizedSliceTimingMetadata(mergedMetadata, startMs, safeDurationMs);
    const risks = mergePlanRisks(
      fallbackMetadata.risks,
      metadata.risks,
      timingRisks,
      timingMetadata.timingMetadataRepaired ? ['timing-metadata-repaired'] : undefined,
    );
    const metadataWithRisks = {
      ...mergedMetadata,
      ...(risks ? { risks } : {}),
    } satisfies Partial<NormalizedSlicePlanClip>;
    const sentenceBoundaryMetadata =
      metadataWithRisks.sentenceBoundaryIntegrityScore !== undefined ||
      metadataWithRisks.sentenceBoundaryIntegrityGrade ||
      metadataWithRisks.sentenceBoundaryIssues
        ? {}
        : createSentenceBoundaryIntegrityMetadata(
            metadataWithRisks.transcriptText ?? '',
            metadataWithRisks.risks ?? [],
          );
    const metadataWithSentenceBoundary = {
      ...metadataWithRisks,
      ...sentenceBoundaryMetadata,
    } satisfies Partial<NormalizedSlicePlanClip>;
    const publishabilityMetadata = createPublishabilityMetadata(metadataWithSentenceBoundary);
    const platformReadinessMetadata = createPlatformReadinessMetadata({
      ...metadataWithSentenceBoundary,
      ...publishabilityMetadata,
      startMs,
      durationMs: safeDurationMs,
    }, policy);

    clips.push({
      ...metadataWithSentenceBoundary,
      ...publishabilityMetadata,
      ...platformReadinessMetadata,
      index: clips.length,
      startMs,
      durationMs: safeDurationMs,
      label,
      sourceStartMs: timingMetadata.sourceStartMs,
      sourceEndMs: timingMetadata.sourceEndMs,
      speechStartMs: timingMetadata.speechStartMs,
      speechEndMs: timingMetadata.speechEndMs,
      boundaryPaddingBeforeMs: timingMetadata.boundaryPaddingBeforeMs,
      boundaryPaddingAfterMs: timingMetadata.boundaryPaddingAfterMs,
    });
    return true;
  };

  for (const candidate of normalizedCandidates) {
    if (clips.length >= policy.targetSliceCount) {
      break;
    }

    let nextAvailableStartMs = clips.reduce(
      (maxEnd, clip) => Math.max(maxEnd, clip.startMs + clip.durationMs),
      0,
    );

    if (options.fillPrecedingGaps !== false) {
      while (clips.length < policy.targetSliceCount && nextAvailableStartMs + fallbackDurationMs <= candidate.startMs) {
        if (!appendClip(nextAvailableStartMs, fallbackDurationMs, `Smart slice ${clips.length + 1}`)) {
          break;
        }
        nextAvailableStartMs += fallbackDurationMs;
      }
    }

    if (clips.length >= policy.targetSliceCount) {
      break;
    }

    nextAvailableStartMs = clips.reduce(
      (maxEnd, clip) => Math.max(maxEnd, clip.startMs + clip.durationMs),
      0,
    );
    if (candidate.startMs >= nextAvailableStartMs) {
      appendClip(candidate.startMs, candidate.durationMs, candidate.label, pickPlanMetadata(candidate));
    }
  }

  if (options.fillTrailingClips === true || (clips.length === 0 && policy.sliceCountMode !== 'qualityFirst')) {
    while (clips.length < policy.targetSliceCount) {
      const startMs = clips.reduce((maxEnd, clip) => Math.max(maxEnd, clip.startMs + clip.durationMs), 0);
      if (!appendClip(startMs, fallbackDurationMs, `Smart slice ${clips.length + 1}`)) {
        break;
      }
    }
  }

  return clips;
}

export function normalizeCandidateSlicePlan(
  candidates: NormalizedSlicePlanClip[],
  params: VideoSliceParams,
  options: NormalizeSlicePlanOptions = {},
): NormalizedSlicePlanClip[] {
  return normalizeCandidateSlicePlanWithQualityStandards(candidates, params, options);
}

export function parseLlmSlicePlan(
  content: string,
  params: VideoSliceParams,
  fallbackPlan: NormalizedSlicePlanClip[],
  transcriptCandidatesOrSegments: readonly TranscriptSliceCandidate[] | readonly AutoCutSpeechTranscriptionSegment[] = [],
): NormalizedSlicePlanClip[] {
  const policy = getVideoSlicePlanningPolicy(params);
  const transcriptCandidates = resolveTranscriptSliceCandidates(params, transcriptCandidatesOrSegments);
  const jsonStart = content.indexOf('[');
  const jsonEnd = content.lastIndexOf(']');
  if (jsonStart < 0 || jsonEnd <= jsonStart) {
    return fallbackPlan;
  }

  try {
    const parsed = JSON.parse(content.slice(jsonStart, jsonEnd + 1));
    if (!Array.isArray(parsed)) {
      return fallbackPlan;
    }

    const { minDurationMs, maxDurationMs } = getVideoSliceDurationBounds(params);
    const normalized = parsed
      .slice(0, MAX_LLM_PLAN_ITEMS_TO_INSPECT)
      .map((clip, index): NormalizedSlicePlanClip | null => {
        const candidateId = typeof clip?.candidateId === 'string' ? clip.candidateId.trim() : '';
        const explicitMatchedCandidate = candidateId
          ? transcriptCandidates.find((candidate) => candidate.candidateId === candidateId)
          : undefined;
        const requestedStartMs = Number(clip?.startMs);
        const requestedDurationMs = Number(clip?.durationMs);
        const requestedEndMs = Number(clip?.endMs);
        const requestedDurationValue =
          Number.isFinite(requestedDurationMs)
            ? requestedDurationMs
            : Number.isFinite(requestedEndMs) && Number.isFinite(requestedStartMs)
              ? requestedEndMs - Number(requestedStartMs)
              : undefined;
        const snappedMatchedCandidate = !explicitMatchedCandidate &&
          Number.isFinite(requestedStartMs) &&
          Number.isFinite(requestedDurationValue)
          ? findBestOverlappingTranscriptCandidate(
              transcriptCandidates,
              Number(requestedStartMs),
              Number(requestedDurationValue),
            )
          : undefined;
        const matchedCandidate = explicitMatchedCandidate ?? snappedMatchedCandidate;
        const snappedToTranscript = Boolean(snappedMatchedCandidate);
        const startMs = matchedCandidate?.startMs ?? (Number.isFinite(requestedStartMs) ? requestedStartMs : undefined);
        const durationMs = matchedCandidate?.durationMs ?? requestedDurationValue;
        const rawLabel =
          typeof clip?.title === 'string'
            ? clip.title
            : typeof clip?.label === 'string'
              ? clip.label
              : matchedCandidate?.label ?? '';

        const label = rawLabel.trim().slice(0, 48) || `楂樺厜鐗囨 ${index + 1}`;

        if (
          !Number.isFinite(startMs) ||
          Number(startMs) < 0 ||
          !Number.isFinite(durationMs) ||
          Number(durationMs) <= 0
        ) {
          return null;
        }

        const safeDurationMs = Number(durationMs);
        const normalizedStartMs = Math.round(Number(startMs));
        const normalizedDurationMs = Math.max(minDurationMs, Math.min(Math.round(safeDurationMs), maxDurationMs));
        const title = normalizePlanText(clip?.title, 48) ?? label;
        const summary = normalizePlanText(clip?.summary, 160);
        const reason = normalizePlanText(clip?.reason, 180);
        const qualityScore = clampScore(clip?.qualityScore);
        const continuityScore = clampScore(clip?.continuityScore);
        const storyShape = normalizeStoryShape(clip?.storyShape) ?? matchedCandidate?.storyShape;
        const risks = createLlmTimingRisks(normalizePlanRisks(clip?.risks), matchedCandidate, snappedToTranscript);
        const transcriptText = matchedCandidate?.transcriptText ?? normalizePlanText(clip?.transcriptText, 4_000);
        const transcriptCoverageScore = matchedCandidate?.transcriptCoverageScore ?? clampScore(clip?.transcriptCoverageScore);
        const subtitleSegmentCount = matchedCandidate?.subtitleSegmentCount ?? normalizeSubtitleSegmentCount(clip?.subtitleSegmentCount);
        const speechContinuityGrade =
          matchedCandidate?.speechContinuityGrade ?? normalizeSpeechContinuityGrade(clip?.speechContinuityGrade);
        const boundaryQualityScore = matchedCandidate?.boundaryQualityScore ?? clampScore(clip?.boundaryQualityScore);
        const hookStrength = matchedCandidate?.hookStrength ?? normalizeHookStrength(clip?.hookStrength);
        const endingCompleteness = matchedCandidate?.endingCompleteness ?? normalizeEndingCompleteness(clip?.endingCompleteness);
        const contentArcScore = matchedCandidate?.contentArcScore ?? clampScore(clip?.contentArcScore);
        const contentArcGrade = matchedCandidate?.contentArcGrade ?? normalizeContentArcGrade(clip?.contentArcGrade);
        const contentArcStages = matchedCandidate?.contentArcStages ?? normalizeContentArcStages(clip?.contentArcStages);
        const contentArcMissingStages =
          matchedCandidate?.contentArcMissingStages ?? normalizeContentArcStages(clip?.contentArcMissingStages);
        const topicCoherenceScore = matchedCandidate?.topicCoherenceScore ?? clampScore(clip?.topicCoherenceScore);
        const topicCoherenceGrade =
          matchedCandidate?.topicCoherenceGrade ?? normalizeTopicCoherenceGrade(clip?.topicCoherenceGrade);
        const topicShiftCount = matchedCandidate?.topicShiftCount ?? normalizeTopicShiftCount(clip?.topicShiftCount);
        const topicKeywords = matchedCandidate?.topicKeywords ?? normalizeTopicKeywords(clip?.topicKeywords);
        const speechStartMs = matchedCandidate?.speechStartMs ?? normalizeNonNegativeMs(clip?.speechStartMs);
        const speechEndMs = matchedCandidate?.speechEndMs ?? normalizeNonNegativeMs(clip?.speechEndMs);
        const boundaryPaddingBeforeMs =
          matchedCandidate?.boundaryPaddingBeforeMs ?? normalizeNonNegativeMs(clip?.boundaryPaddingBeforeMs);
        const boundaryPaddingAfterMs =
          matchedCandidate?.boundaryPaddingAfterMs ?? normalizeNonNegativeMs(clip?.boundaryPaddingAfterMs);
        const platformReadinessScore = matchedCandidate?.platformReadinessScore ?? clampScore(clip?.platformReadinessScore);
        const platformReadinessGrade =
          matchedCandidate?.platformReadinessGrade ?? normalizePlatformReadinessGrade(clip?.platformReadinessGrade);
        const platformReadinessIssues =
          matchedCandidate?.platformReadinessIssues ?? normalizePlanRisks(clip?.platformReadinessIssues);
        const sentenceBoundaryIntegrityScore =
          matchedCandidate?.sentenceBoundaryIntegrityScore ?? clampScore(clip?.sentenceBoundaryIntegrityScore);
        const sentenceBoundaryIntegrityGrade =
          matchedCandidate?.sentenceBoundaryIntegrityGrade ??
          normalizeSentenceBoundaryIntegrityGrade(clip?.sentenceBoundaryIntegrityGrade);
        const sentenceBoundaryIssues =
          matchedCandidate?.sentenceBoundaryIssues ?? normalizePlanRisks(clip?.sentenceBoundaryIssues);
        const publishabilityIssues = normalizePlanRisks(clip?.publishabilityIssues);
        const sentenceBoundaryMetadata =
          sentenceBoundaryIntegrityScore !== undefined || sentenceBoundaryIntegrityGrade || sentenceBoundaryIssues
            ? {
                ...(sentenceBoundaryIntegrityScore !== undefined
                  ? { sentenceBoundaryIntegrityScore }
                  : {}),
                ...(sentenceBoundaryIntegrityGrade ? { sentenceBoundaryIntegrityGrade } : {}),
                ...(sentenceBoundaryIssues ? { sentenceBoundaryIssues } : {}),
              }
            : createSentenceBoundaryIntegrityMetadata(transcriptText ?? '', risks ?? []);
        const publishabilityInput = {
          ...(qualityScore !== undefined
            ? { qualityScore }
            : matchedCandidate?.qualityScore !== undefined
              ? { qualityScore: matchedCandidate.qualityScore }
              : {}),
          ...(continuityScore !== undefined
            ? { continuityScore }
            : matchedCandidate?.continuityScore !== undefined
              ? { continuityScore: matchedCandidate.continuityScore }
              : {}),
          ...(storyShape ? { storyShape } : {}),
          ...(risks ? { risks } : {}),
          ...(transcriptCoverageScore !== undefined ? { transcriptCoverageScore } : {}),
          ...(subtitleSegmentCount !== undefined ? { subtitleSegmentCount } : {}),
          ...(speechContinuityGrade ? { speechContinuityGrade } : {}),
          ...(boundaryQualityScore !== undefined ? { boundaryQualityScore } : {}),
          ...(hookStrength ? { hookStrength } : {}),
          ...(endingCompleteness ? { endingCompleteness } : {}),
          ...(contentArcScore !== undefined ? { contentArcScore } : {}),
          ...(contentArcGrade ? { contentArcGrade } : {}),
          ...(contentArcStages ? { contentArcStages } : {}),
          ...(contentArcMissingStages ? { contentArcMissingStages } : {}),
          ...(topicCoherenceScore !== undefined ? { topicCoherenceScore } : {}),
          ...(topicCoherenceGrade ? { topicCoherenceGrade } : {}),
          ...(topicShiftCount !== undefined ? { topicShiftCount } : {}),
          ...(topicKeywords ? { topicKeywords } : {}),
          ...sentenceBoundaryMetadata,
          ...(publishabilityIssues ? { publishabilityIssues } : {}),
        } satisfies Partial<NormalizedSlicePlanClip>;
        const publishabilityMetadata = createPublishabilityMetadata(publishabilityInput);
        const sourceStartMs = matchedCandidate?.startMs ?? normalizedStartMs;
        const sourceEndMs = matchedCandidate?.endMs ?? normalizedStartMs + normalizedDurationMs;
        const platformReadinessMetadata = platformReadinessScore !== undefined || platformReadinessGrade || platformReadinessIssues
          ? {
              ...(platformReadinessScore !== undefined ? { platformReadinessScore } : {}),
              ...(platformReadinessGrade ? { platformReadinessGrade } : {}),
              ...(platformReadinessIssues ? { platformReadinessIssues } : {}),
            }
          : createPlatformReadinessMetadata({
              ...publishabilityInput,
              ...publishabilityMetadata,
              startMs: normalizedStartMs,
              durationMs: normalizedDurationMs,
            }, policy);

        return {
          index,
          startMs: normalizedStartMs,
          durationMs: normalizedDurationMs,
          title,
          ...(summary ? { summary } : matchedCandidate?.summary ? { summary: matchedCandidate.summary } : {}),
          ...(reason ? { reason } : matchedCandidate?.reason ? { reason: matchedCandidate.reason } : {}),
          ...(qualityScore !== undefined
            ? { qualityScore }
            : matchedCandidate?.qualityScore !== undefined
              ? { qualityScore: matchedCandidate.qualityScore }
              : {}),
          ...(continuityScore !== undefined
            ? { continuityScore }
            : matchedCandidate?.continuityScore !== undefined
              ? { continuityScore: matchedCandidate.continuityScore }
              : {}),
          ...(storyShape ? { storyShape } : {}),
          ...publishabilityMetadata,
          ...platformReadinessMetadata,
          ...sentenceBoundaryMetadata,
          ...(risks ? { risks } : {}),
          sourceStartMs,
          sourceEndMs,
          speechStartMs: speechStartMs ?? sourceStartMs,
          speechEndMs: speechEndMs ?? sourceEndMs,
          boundaryPaddingBeforeMs: boundaryPaddingBeforeMs ?? 0,
          boundaryPaddingAfterMs: boundaryPaddingAfterMs ?? 0,
          ...(transcriptText ? { transcriptText } : {}),
          ...(transcriptCoverageScore !== undefined ? { transcriptCoverageScore } : {}),
          ...(subtitleSegmentCount !== undefined ? { subtitleSegmentCount } : {}),
          ...(speechContinuityGrade ? { speechContinuityGrade } : {}),
          ...(boundaryQualityScore !== undefined ? { boundaryQualityScore } : {}),
          ...(hookStrength ? { hookStrength } : {}),
          ...(endingCompleteness ? { endingCompleteness } : {}),
          ...(contentArcScore !== undefined ? { contentArcScore } : {}),
          ...(contentArcGrade ? { contentArcGrade } : {}),
          ...(contentArcStages ? { contentArcStages } : {}),
          ...(contentArcMissingStages ? { contentArcMissingStages } : {}),
          ...(topicCoherenceScore !== undefined ? { topicCoherenceScore } : {}),
          ...(topicCoherenceGrade ? { topicCoherenceGrade } : {}),
          ...(topicShiftCount !== undefined ? { topicShiftCount } : {}),
          ...(topicKeywords ? { topicKeywords } : {}),
          label,
        };
      })
      .filter((clip): clip is NormalizedSlicePlanClip => Boolean(clip));

    return normalized.length > 0
      ? normalizeCandidateSlicePlan(normalized, params, {
        fillPrecedingGaps:
            (transcriptCandidates.length === 0 && policy.sliceCountMode !== 'qualityFirst') ||
            policy.sliceCountMode === 'coverageFirst' ||
            policy.sliceCountMode === 'fixed',
        fillTrailingClips:
            (transcriptCandidates.length === 0 && policy.sliceCountMode !== 'qualityFirst') ||
            policy.sliceCountMode === 'coverageFirst' ||
            policy.sliceCountMode === 'fixed',
      })
      : fallbackPlan;
  } catch {
    return fallbackPlan;
  }
}

function resolveTranscriptSliceCandidates(
  params: VideoSliceParams,
  candidatesOrSegments: readonly TranscriptSliceCandidate[] | readonly AutoCutSpeechTranscriptionSegment[],
) {
  const [firstItem] = candidatesOrSegments;
  if (!firstItem) {
    return [];
  }

  if ('candidateId' in firstItem) {
    return candidatesOrSegments as readonly TranscriptSliceCandidate[];
  }

  return buildTranscriptSliceCandidates(params, candidatesOrSegments as readonly AutoCutSpeechTranscriptionSegment[]);
}
