import {
  AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD,
  isLowInformationAutoCutTranscriptEvidenceText,
  normalizeAutoCutTranscriptEvidenceText,
  type VideoSliceParams,
} from '@sdkwork/autocut-types';
import type {
  AutoCutSpeechTranscriptionSegment,
  AutoCutVideoSliceClipRequest,
} from '@sdkwork/autocut-services';

export const MIN_SLICE_DURATION_MS = 5_000;
export const MIN_TRANSCRIPT_ALIGNED_SLICE_DURATION_MS = 1_000;
export const MAX_SLICE_DURATION_MS = 10 * 60 * 1_000;
export const SMART_SLICE_AUDIO_CLEANUP_PROFILE = AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD.audioCleanupProfile;
export const SMART_SLICE_RAW_AUDIO_ACTIVITY_ANALYSIS_FILTER = 'silencedetect=noise=-35dB:d=0.08';
const DEFAULT_IDEAL_SLICE_DURATION_MS = 45_000;
const STANDARD_TRANSCRIPT_SEGMENT_JOIN_GAP_MS = 2_500;
const STRICT_TRANSCRIPT_SEGMENT_JOIN_GAP_MS = 800;
const DEFAULT_CANDIDATE_SEGMENT_JOIN_GAP_MS = 1_500;
const MAXIMIZE_CONTINUITY_CANDIDATE_SEGMENT_JOIN_GAP_MS = 8_000;
const STANDARD_TRANSCRIPT_SEGMENT_OVERLAP_TOLERANCE_MS = 250;
const STRICT_TRANSCRIPT_SEGMENT_OVERLAP_TOLERANCE_MS = 80;
const MAX_TRANSCRIPT_SILENCE_COMPACTION_BRIDGE_MS = 16_000;
const MAX_TRANSCRIPT_NOISE_BRIDGE_MS = 3_000;
const MAX_PLAN_RISK_TAGS = 12;
const MAX_LLM_PLAN_ITEMS_TO_INSPECT = 80;
const {
  maxLeadingSilenceMs: TRANSCRIPT_BOUNDARY_PADDING_BEFORE_MS,
  maxTrailingSilenceMs: TRANSCRIPT_BOUNDARY_PADDING_AFTER_MS,
  minTranscriptCoverageScore: MIN_TRANSCRIPT_RENDER_SPEECH_COVERAGE_SCORE,
  minAudioActivityConfidence: MIN_SMART_SLICE_AUDIO_ACTIVITY_CONFIDENCE,
  requiredAudioActivityAnalysisFilter: SMART_SLICE_REQUIRED_AUDIO_ACTIVITY_ANALYSIS_FILTER,
  maxAudioTranscriptBoundaryDisagreementMs: MAX_AUDIO_TRANSCRIPT_BOUNDARY_DISAGREEMENT_MS,
  minAudioTranscriptBoundaryOverlapRatio: MIN_AUDIO_TRANSCRIPT_BOUNDARY_OVERLAP_RATIO,
} = AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD;
const MAX_RENDER_LEADING_SILENCE_MS = TRANSCRIPT_BOUNDARY_PADDING_BEFORE_MS;
const MAX_RENDER_TRAILING_SILENCE_MS = TRANSCRIPT_BOUNDARY_PADDING_AFTER_MS;
const SLICE_CANDIDATE_DP_BEAM_WIDTH = 8;
const MAX_TRANSCRIPT_SLICE_CANDIDATE_POOL_SIZE = 160;
const MAX_SMART_SLICE_AUDIO_MUTE_RANGE_MS = 3_000;
const MAX_SMART_SLICE_RETAINED_INTERNAL_SILENCE_MS = 350;
const MIN_SMART_SLICE_INTERNAL_SILENCE_TRIM_MS = 150;
const MAX_SMART_SLICE_SOURCE_SEGMENTS = 80;
const MIN_COARSE_TRANSCRIPT_SEGMENT_SPLIT_DURATION_MS = 30_000;
const MIN_COARSE_TRANSCRIPT_SEGMENT_SPLIT_SENTENCE_COUNT = 4;
const MIN_SPEECH_COVERAGE_REPAIR_GAIN_MS = 1_000;
const SMART_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS = 80;
const MIN_LLM_TRANSCRIPT_SNAP_OVERLAP_MS = 1_000;
const MIN_LLM_TRANSCRIPT_SNAP_REQUEST_COVERAGE = 0.6;
const MAX_ISOLATED_MICRO_SPEECH_REPEAT_DURATION_MS = 3_000;
const MIN_ISOLATED_MICRO_SPEECH_REPEAT_SEPARATION_MS = 5_000;
const CONTENT_ARC_STAGES = ['hook', 'setup', 'conflict', 'payoff'] as const;
const MIN_SEMANTIC_STORY_MERGE_SEGMENTS = 2;
const MAX_SEMANTIC_STORY_MERGE_SEGMENTS = 12;
const MIN_CONTENT_TOPIC_SEGMENT_COUNT = 2;
const CONTENT_TOPIC_SEGMENT_RISK = 'content-topic-segment';
const SEMANTIC_STORY_FRAGMENT_BOUNDARY_TOLERANCE_MS = Math.max(
  TRANSCRIPT_BOUNDARY_PADDING_BEFORE_MS,
  TRANSCRIPT_BOUNDARY_PADDING_AFTER_MS,
);
const ENGLISH_CONTENT_SECTION_ORDINAL_WORDS = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve';
const ENGLISH_CONTENT_SECTION_NOUNS = 'tip|step|part|point|reason|mistake|problem|bug|method|lesson|case|example|fix|rule|pattern|principle|question|idea|chapter|section';
const ENGLISH_CONTENT_SECTION_STARTER_WORDS = 'why|how|what|when|problem|pain|mistake|reason|case|example|tip|step|lesson|fix|solution';
const ENGLISH_POSITIONAL_ORDINAL_WORDS = 'first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth';
const ENGLISH_ADVERBIAL_ORDINAL_WORDS = 'firstly|secondly|thirdly|fourthly|fifthly|sixthly|seventhly|eighthly|ninthly|tenthly|lastly|finally';
const ENGLISH_NUMBER_WORD_CONTENT_SECTION_OPENING_PATTERN = new RegExp(
  `^number\\s+(?:${ENGLISH_CONTENT_SECTION_ORDINAL_WORDS}|\\d+)\\b(?:\\s*[:;.)\\-]|\\s*,?\\s+(?=(?:${ENGLISH_CONTENT_SECTION_STARTER_WORDS})\\b))`,
  'iu',
);
const ENGLISH_NUMERIC_ENUMERATOR_PATTERN = String.raw`(?:no\.?\s*)?#?\d+(?:st|nd|rd|th)?`;
const ENGLISH_LETTER_ENUMERATOR_PATTERN = String.raw`(?:(?:part|option)\s+[a-c]|[a-c])`;
const ENGLISH_LETTER_CONTENT_SECTION_OPENING_PATTERN = new RegExp(
  `^${ENGLISH_LETTER_ENUMERATOR_PATTERN}\\b(?:\\s*[:;.)\\-]|\\s*,\\s+(?=(?:${ENGLISH_CONTENT_SECTION_STARTER_WORDS})\\b)|\\s+(?=(?:${ENGLISH_CONTENT_SECTION_STARTER_WORDS})\\b))`,
  'iu',
);
const ENGLISH_CONTENT_SECTION_OPENING_PATTERN = new RegExp(
  `^(?:${ENGLISH_CONTENT_SECTION_NOUNS})\\s*(?:${ENGLISH_CONTENT_SECTION_ORDINAL_WORDS}|\\d+)\\b`,
  'iu',
);
const ENGLISH_REVERSED_CONTENT_SECTION_OPENING_PATTERN = new RegExp(
  `^(?:${ENGLISH_POSITIONAL_ORDINAL_WORDS})\\s+(?:${ENGLISH_CONTENT_SECTION_NOUNS})\\b`,
  'iu',
);
const ENGLISH_ORDINAL_ONLY_CONTENT_SECTION_OPENING_PATTERN = new RegExp(
  `^(?:${ENGLISH_POSITIONAL_ORDINAL_WORDS}|${ENGLISH_ADVERBIAL_ORDINAL_WORDS})\\b(?:\\s*[:;.)\\-]|\\s*,?\\s+(?=(?:${ENGLISH_CONTENT_SECTION_STARTER_WORDS})\\b))`,
  'iu',
);
const ENGLISH_NUMERIC_CONTENT_SECTION_OPENING_PATTERN = new RegExp(
  `^${ENGLISH_NUMERIC_ENUMERATOR_PATTERN}\\b(?:\\s*[:;.)\\-]|\\s*,\\s+(?=(?:${ENGLISH_CONTENT_SECTION_STARTER_WORDS})\\b)|\\s+(?=(?:${ENGLISH_CONTENT_SECTION_STARTER_WORDS})\\b))`,
  'iu',
);
const ENGLISH_GENERIC_ENUMERATED_CONTENT_HEADING_PATTERN = new RegExp(
  `^(?:[a-z][a-z0-9'-]{2,}\\s+){0,2}[a-z][a-z0-9'-]{2,}\\s*(?:${ENGLISH_CONTENT_SECTION_ORDINAL_WORDS}|\\d+)\\s*(?=[:;,.)\\-])`,
  'iu',
);
const ENGLISH_INLINE_CONTENT_SECTION_OPENING_PATTERN = new RegExp(
  `(?:(?:${ENGLISH_CONTENT_SECTION_NOUNS})\\s*(?:${ENGLISH_CONTENT_SECTION_ORDINAL_WORDS}|\\d+)\\b|` +
    `number\\s+(?:${ENGLISH_CONTENT_SECTION_ORDINAL_WORDS}|\\d+)\\b(?:\\s*[:;.)\\-]|\\s*,?\\s+(?=(?:${ENGLISH_CONTENT_SECTION_STARTER_WORDS})\\b))|` +
    `${ENGLISH_NUMERIC_ENUMERATOR_PATTERN}\\b(?:\\s*[:;.)\\-]|\\s*,\\s+(?=(?:${ENGLISH_CONTENT_SECTION_STARTER_WORDS})\\b)|\\s+(?=(?:${ENGLISH_CONTENT_SECTION_STARTER_WORDS})\\b))|` +
    `${ENGLISH_LETTER_ENUMERATOR_PATTERN}\\b(?:\\s*[:;.)\\-]|\\s*,\\s+(?=(?:${ENGLISH_CONTENT_SECTION_STARTER_WORDS})\\b)|\\s+(?=(?:${ENGLISH_CONTENT_SECTION_STARTER_WORDS})\\b))|` +
    `(?:${ENGLISH_POSITIONAL_ORDINAL_WORDS}|${ENGLISH_ADVERBIAL_ORDINAL_WORDS})\\b(?:\\s*[:;.)\\-]|\\s*,?\\s+(?=(?:${ENGLISH_CONTENT_SECTION_STARTER_WORDS})\\b))|` +
    `[a-z][a-z0-9'-]{2,}\\s*(?:${ENGLISH_CONTENT_SECTION_ORDINAL_WORDS}|\\d+)\\s*(?=[:;,.)\\-]))`,
  'giu',
);
const CHINESE_INLINE_CONTENT_SECTION_OPENING_PATTERN =
  /(?:第[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\d]+(?:点|个|条|步|部分|章|节|课|种|类|件|(?=为什么|怎么|如何|问题|痛点|原因|案例|方法|解决|修复|开头|激活|设置|用户|首屏|是))|[一二三四五六七八九十](?=为什么|怎么|如何|问题|痛点|原因|案例|方法|解决|修复|开头|激活|设置|用户|首屏|是)|其[一二三四五六七八九十](?=为什么|怎么|如何|问题|痛点|原因|案例|方法|解决|修复|开头|激活|设置|用户|首屏|是)|[ABC]方案(?=为什么|怎么|如何|问题|痛点|原因|案例|方法|解决|修复|开头|激活|设置|用户|首屏)|首先|其次|再次|另外|接下来)/gu;
const MIN_EXPLICIT_STORY_OPENINGS_FOR_COARSE_SEGMENT_SPLIT = 2;
const TRANSCRIPT_SEMANTIC_REPEAT_TOKEN_MAP: ReadonlyMap<string, string> = new Map([
  ['returns', 'refund'],
  ['return', 'refund'],
  ['refunds', 'refund'],
  ['repair', 'fix'],
  ['repairs', 'fix'],
  ['repaired', 'fix'],
  ['fixes', 'fix'],
  ['fixed', 'fix'],
  ['solution', 'fix'],
  ['solutions', 'fix'],
  ['boost', 'improve'],
  ['boosts', 'improve'],
  ['boosted', 'improve'],
  ['improv', 'improve'],
  ['improves', 'improve'],
  ['improved', 'improve'],
  ['increase', 'improve'],
  ['increas', 'improve'],
  ['increases', 'improve'],
  ['increased', 'improve'],
  ['retains', 'retention'],
  ['retained', 'retention'],
  ['viewer', 'audience'],
  ['viewers', 'audience'],
  ['customer', 'user'],
  ['customers', 'user'],
  ['users', 'user'],
  ['client', 'user'],
  ['clients', 'user'],
  ['cancel', 'churn'],
  ['cancell', 'churn'],
  ['leave', 'churn'],
  ['left', 'churn'],
  ['unclear', 'confusing'],
  ['confus', 'confusing'],
  ['confusing', 'confusing'],
  ['confused', 'confusing'],
  ['price', 'pricing'],
  ['prices', 'pricing'],
  ['invoice', 'billing'],
  ['invoic', 'billing'],
  ['invoices', 'billing'],
  ['bill', 'billing'],
  ['bills', 'billing'],
  ['launches', 'launch'],
  ['onboarding', 'activation'],
]);

export type SliceContentArcStage = typeof CONTENT_ARC_STAGES[number];
export type SliceContentArcGrade = 'complete' | 'partial' | 'thin';
export type SliceTopicCoherenceGrade = 'strong' | 'mixed' | 'weak';
export type SlicePlatformReadinessGrade = 'ready' | 'review' | 'reject';
export type SliceSentenceBoundaryIntegrityGrade = 'clean' | 'repaired' | 'broken';

interface SlicePlatformProfile {
  targetAspectRatio: NonNullable<VideoSliceParams['targetAspectRatio']>;
  videoObjectFit: NonNullable<VideoSliceParams['videoObjectFit']>;
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
  minDurationMs: number;
  maxDurationMs: number;
  idealDurationMs: number;
  sourceDurationMs?: number;
  continuityLevel: NonNullable<VideoSliceParams['continuityLevel']>;
  segmentationDensity: NonNullable<VideoSliceParams['segmentationDensity']>;
  continuityJoinGapMs: number;
  candidateJoinGapMs: number;
  continuityOverlapToleranceMs: number;
  customKeywords: string[];
}

export interface NormalizedSlicePlanClip extends AutoCutVideoSliceClipRequest {
  index: number;
  candidateId?: string;
  planningEngine?: 'smart-cut-engine';
  smartCutPresetId?: string;
  smartCutPlanId?: string;
  smartCutRunId?: string;
  contentUnitIds?: string[];
  speakerIds?: string[];
  speakerRoles?: string[];
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
  sourceSegments?: SmartSliceSourceSegment[];
  renderedDurationMs?: number;
  removedSilenceMs?: number;
  internalSilenceTrimCount?: number;
  tailTreatment?: 'none' | 'semantic-extend' | 'fade-out';
  transcriptText?: string;
  transcriptSegmentTexts?: string[];
  transcriptCoverageScore?: number;
  transcriptSegmentCount?: number;
  speechContinuityGrade?: 'strong' | 'repaired' | 'weak';
}

export interface SmartSliceSourceSegment {
  startMs: number;
  endMs: number;
}

export interface SmartSliceAudioActivityBoundaryAnalysis {
  index: number;
  startMs: number;
  durationMs: number;
  sourceStartMs: number;
  sourceEndMs: number;
  audioActivityStartMs?: number;
  audioActivityEndMs?: number;
  leadingSilenceMs?: number;
  trailingSilenceMs?: number;
  internalSilenceIntervals?: SmartSliceSourceSegment[];
  confidence: number;
  analysisFilter: string;
}

export interface TranscriptSliceCandidate extends NormalizedSlicePlanClip {
  candidateId: string;
  endMs: number;
  text: string;
  score: number;
  anchorSegmentIndex: number;
}

interface BuildTranscriptSliceCandidatesOptions {
  disableRepeatFilter?: boolean;
}

type CoverageWeightedSlicePlanClip = NormalizedSlicePlanClip & {
  __coverageSpeechMs?: number;
};

type TranscriptPlanningSegment = AutoCutSpeechTranscriptionSegment & {
  noiseBridgeBeforeMs?: number;
};

const SLICE_PLATFORM_PROFILES: Record<VideoSlicePlanningPolicy['targetPlatform'], SlicePlatformProfile> = {
  douyin: {
    targetAspectRatio: '9:16',
    videoObjectFit: 'cover',
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
  'candidateId',
  'planningEngine',
  'smartCutPresetId',
  'smartCutPlanId',
  'smartCutRunId',
  'contentUnitIds',
  'speakerIds',
  'speakerRoles',
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
  'audioCleanupProfile',
  'noiseReductionApplied',
  'boundaryDecisionSource',
  'audioActivityStartMs',
  'audioActivityEndMs',
  'audioActivityConfidence',
  'audioActivityAnalysisFilter',
  'leadingSilenceMs',
  'trailingSilenceMs',
  'leadingSilenceTrimMs',
  'trailingSilenceTrimMs',
  'tailTreatment',
  'transcriptText',
  'transcriptSegmentTexts',
  'transcriptCoverageScore',
  'transcriptSegmentCount',
  'speechContinuityGrade',
  'sourceSegments',
  'renderedDurationMs',
  'removedSilenceMs',
  'internalSilenceTrimCount',
] as const;

function sortSliceClipsByStartMs<T extends NormalizedSlicePlanClip>(clips: readonly T[]): T[] {
  return clips.slice().sort((firstClip, secondClip) => firstClip.startMs - secondClip.startMs);
}

function sortSliceClipsByEndMs<T extends NormalizedSlicePlanClip>(clips: readonly T[]): T[] {
  return clips.slice().sort((firstClip, secondClip) =>
    firstClip.startMs + firstClip.durationMs - (secondClip.startMs + secondClip.durationMs) ||
      firstClip.startMs - secondClip.startMs,
  );
}

function sortTranscriptSegmentsByStartMs<T extends AutoCutSpeechTranscriptionSegment>(segments: readonly T[]) {
  return segments.slice().sort((firstSegment, secondSegment) => firstSegment.startMs - secondSegment.startMs);
}

function sortTranscriptSliceCandidatesByScore(candidates: TranscriptSliceCandidate[]) {
  return candidates.slice().sort((firstCandidate, secondCandidate) =>
    Number(isSemanticStoryMergeCandidate(firstCandidate) || isContentTopicSegmentCandidate(firstCandidate)) -
      Number(isSemanticStoryMergeCandidate(secondCandidate) || isContentTopicSegmentCandidate(secondCandidate)) ||
      secondCandidate.score - firstCandidate.score ||
      firstCandidate.startMs - secondCandidate.startMs,
  );
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

function normalizeKnownSpeechBoundaryMs(value: unknown, minMs: number, maxMs: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(minMs, Math.min(Math.round(value), maxMs));
}

function createSilenceGuardedSliceTiming(
  startMs: number,
  durationMs: number,
  metadata: Partial<NormalizedSlicePlanClip>,
  policy: VideoSlicePlanningPolicy,
  minimumDurationMs = MIN_SLICE_DURATION_MS,
): { startMs: number; durationMs: number; risks: string[] } | undefined {
  const renderStartMs = Math.max(0, Math.round(startMs));
  const requestedRenderEndMs = renderStartMs + Math.max(0, Math.round(durationMs));
  const renderEndMs = policy.sourceDurationMs !== undefined
    ? Math.min(requestedRenderEndMs, policy.sourceDurationMs)
    : requestedRenderEndMs;
  if (renderEndMs - renderStartMs < minimumDurationMs) {
    return undefined;
  }

  const speechStartMs = normalizeKnownSpeechBoundaryMs(metadata.speechStartMs, renderStartMs, renderEndMs);
  const speechEndMs = normalizeKnownSpeechBoundaryMs(metadata.speechEndMs, renderStartMs, renderEndMs);
  const hasValidSpeechRange =
    speechStartMs !== undefined &&
    speechEndMs !== undefined &&
    speechEndMs > speechStartMs;
  if (
    (speechStartMs === undefined && speechEndMs === undefined) ||
    (speechStartMs !== undefined && speechEndMs !== undefined && !hasValidSpeechRange)
  ) {
    return { startMs: renderStartMs, durationMs: renderEndMs - renderStartMs, risks: [] };
  }

  let guardedStartMs = renderStartMs;
  let guardedEndMs = renderEndMs;
  if (speechStartMs !== undefined && (speechEndMs === undefined || speechEndMs > speechStartMs)) {
    guardedStartMs = Math.max(renderStartMs, speechStartMs - MAX_RENDER_LEADING_SILENCE_MS);
  }
  if (speechEndMs !== undefined && (speechStartMs === undefined || speechEndMs > speechStartMs)) {
    guardedEndMs = Math.min(renderEndMs, speechEndMs + MAX_RENDER_TRAILING_SILENCE_MS);
  }

  if (guardedEndMs <= guardedStartMs) {
    return { startMs: renderStartMs, durationMs: renderEndMs - renderStartMs, risks: [] };
  }

  if (guardedEndMs - guardedStartMs < minimumDurationMs) {
    if (hasValidSpeechRange) {
      const renderDurationMs = renderEndMs - renderStartMs;
      const speechDurationMs = speechEndMs - speechStartMs;
      if (
        renderDurationMs <= minimumDurationMs &&
        speechDurationMs / renderDurationMs >= MIN_TRANSCRIPT_RENDER_SPEECH_COVERAGE_SCORE
      ) {
        return { startMs: renderStartMs, durationMs: renderDurationMs, risks: [] };
      }

      return undefined;
    }

    if (guardedStartMs > renderStartMs) {
      guardedStartMs = Math.max(renderStartMs, guardedEndMs - minimumDurationMs);
    }
    if (guardedEndMs < renderEndMs) {
      guardedEndMs = Math.min(renderEndMs, guardedStartMs + minimumDurationMs);
    }
    if (guardedEndMs - guardedStartMs < minimumDurationMs) {
      return undefined;
    }
  }

  const risks = [
    ...(guardedStartMs > renderStartMs ? ['excess-leading-silence-trimmed'] : []),
    ...(guardedEndMs < renderEndMs ? ['excess-trailing-silence-trimmed'] : []),
  ];
  if (metadata.sourceSegments && guardedStartMs === renderStartMs && guardedEndMs === renderEndMs) {
    return { startMs: renderStartMs, durationMs: renderEndMs - renderStartMs, risks };
  }

  return {
    startMs: guardedStartMs,
    durationMs: guardedEndMs - guardedStartMs,
    risks,
  };
}

function normalizeAudioBoundaryMs(value: unknown, minMs: number, maxMs: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(minMs, Math.min(Math.round(value), maxMs));
}

function mergeAudioCleanupEvidenceRisks(
  risks: readonly string[] | undefined,
  leadingSilenceTrimMs: number,
  trailingSilenceTrimMs: number,
  extraRisks?: readonly string[],
) {
  return mergePlanRisks(
    risks,
    leadingSilenceTrimMs > 0 || trailingSilenceTrimMs > 0 ? ['audio-boundary-refined'] : undefined,
    extraRisks,
  );
}

function resolveTailTreatmentAfterAudioBoundaryRefinement(
  clip: NormalizedSlicePlanClip,
  trailingSilenceTrimMs: number,
): NonNullable<NormalizedSlicePlanClip['tailTreatment']> {
  if (clip.tailTreatment) {
    return clip.tailTreatment;
  }
  return trailingSilenceTrimMs > 0 ? 'fade-out' : 'none';
}

function createAudioActivityBoundaryEvidence(
  analysis: SmartSliceAudioActivityBoundaryAnalysis,
  audioActivityStartMs: number | undefined,
  audioActivityEndMs: number | undefined,
  activityConfidence: number,
) {
  const evidence: Partial<NormalizedSlicePlanClip> = {
    audioActivityConfidence: activityConfidence,
    audioActivityAnalysisFilter: analysis.analysisFilter,
  };

  if (audioActivityStartMs !== undefined) {
    evidence.audioActivityStartMs = audioActivityStartMs;
  }
  if (audioActivityEndMs !== undefined) {
    evidence.audioActivityEndMs = audioActivityEndMs;
  }
  if (audioActivityStartMs !== undefined) {
    evidence.leadingSilenceMs = Math.max(0, audioActivityStartMs - analysis.sourceStartMs);
  } else if (analysis.leadingSilenceMs !== undefined) {
    evidence.leadingSilenceMs = analysis.leadingSilenceMs;
  }
  if (audioActivityEndMs !== undefined) {
    evidence.trailingSilenceMs = Math.max(0, analysis.sourceEndMs - audioActivityEndMs);
  } else if (analysis.trailingSilenceMs !== undefined) {
    evidence.trailingSilenceMs = analysis.trailingSilenceMs;
  }

  return evidence;
}

function createUnrefinedAudioCleanupClip(
  clip: NormalizedSlicePlanClip,
  boundaryDecisionSource: NonNullable<NormalizedSlicePlanClip['boundaryDecisionSource']>,
  noiseReductionApplied: boolean,
  audioActivityEvidence?: Partial<NormalizedSlicePlanClip>,
  extraRisks?: readonly string[],
): NormalizedSlicePlanClip {
  const risks = mergePlanRisks(clip.risks, extraRisks);

  return {
    ...clip,
    audioCleanupProfile: SMART_SLICE_AUDIO_CLEANUP_PROFILE,
    noiseReductionApplied,
    boundaryDecisionSource,
    ...(audioActivityEvidence ?? {}),
    leadingSilenceTrimMs: 0,
    trailingSilenceTrimMs: 0,
    tailTreatment: resolveTailTreatmentAfterAudioBoundaryRefinement(clip, 0),
    ...(risks !== undefined ? { risks } : {}),
  };
}

function createAudioActivityRefinedClip(
  clip: NormalizedSlicePlanClip,
  renderStartMs: number,
  renderEndMs: number,
  boundaryStartMs: number,
  boundaryEndMs: number,
  boundaryDecisionSource: NonNullable<NormalizedSlicePlanClip['boundaryDecisionSource']>,
  audioActivityEvidence: Partial<NormalizedSlicePlanClip>,
  noiseReductionApplied: boolean,
  speechTiming?: { speechStartMs: number; speechEndMs: number },
  extraRisks?: readonly string[],
): NormalizedSlicePlanClip {
  const refinedStartMs = Math.max(
    renderStartMs,
    boundaryStartMs - TRANSCRIPT_BOUNDARY_PADDING_BEFORE_MS,
  );
  const refinedEndMs = Math.min(
    renderEndMs,
    boundaryEndMs + TRANSCRIPT_BOUNDARY_PADDING_AFTER_MS,
  );

  if (refinedEndMs <= refinedStartMs) {
    return createUnrefinedAudioCleanupClip(
      clip,
      boundaryDecisionSource,
      noiseReductionApplied,
      audioActivityEvidence,
      extraRisks,
    );
  }

  const leadingSilenceTrimMs = Math.max(0, refinedStartMs - renderStartMs);
  const trailingSilenceTrimMs = Math.max(0, renderEndMs - refinedEndMs);
  const risks = mergeAudioCleanupEvidenceRisks(clip.risks, leadingSilenceTrimMs, trailingSilenceTrimMs, extraRisks);
  const audioActivityStartMs = typeof audioActivityEvidence.audioActivityStartMs === 'number'
    ? Math.max(refinedStartMs, Math.min(Math.round(audioActivityEvidence.audioActivityStartMs), refinedEndMs))
    : undefined;
  const audioActivityEndMs = typeof audioActivityEvidence.audioActivityEndMs === 'number'
    ? Math.max(refinedStartMs, Math.min(Math.round(audioActivityEvidence.audioActivityEndMs), refinedEndMs))
    : undefined;
  const hasProjectedAudioActivityRange =
    audioActivityStartMs !== undefined &&
    audioActivityEndMs !== undefined &&
    audioActivityEndMs > audioActivityStartMs;
  const refinedAudioActivityEvidence = {
    ...audioActivityEvidence,
    ...(audioActivityStartMs !== undefined ? { audioActivityStartMs } : {}),
    ...(audioActivityEndMs !== undefined ? { audioActivityEndMs } : {}),
    ...(hasProjectedAudioActivityRange
      ? { leadingSilenceMs: Math.max(0, audioActivityStartMs - refinedStartMs) }
      : {}),
    ...(hasProjectedAudioActivityRange
      ? { trailingSilenceMs: Math.max(0, refinedEndMs - audioActivityEndMs) }
      : {}),
  };
  const originalSourceStartMs = clip.sourceStartMs ?? renderStartMs;
  const originalSourceEndMs = clip.sourceEndMs ?? renderEndMs;
  const timingChanged =
    originalSourceStartMs !== refinedStartMs ||
    originalSourceEndMs !== refinedEndMs ||
    (speechTiming !== undefined &&
      (clip.speechStartMs !== speechTiming.speechStartMs || clip.speechEndMs !== speechTiming.speechEndMs));
  const clipWithCurrentTranscriptMetadata = { ...clip };
  if (timingChanged) {
    delete clipWithCurrentTranscriptMetadata.transcriptText;
    delete clipWithCurrentTranscriptMetadata.transcriptSegmentCount;
  }
  delete clipWithCurrentTranscriptMetadata.sourceSegments;
  delete clipWithCurrentTranscriptMetadata.renderedDurationMs;
  delete clipWithCurrentTranscriptMetadata.removedSilenceMs;
  delete clipWithCurrentTranscriptMetadata.internalSilenceTrimCount;

  return {
    ...clipWithCurrentTranscriptMetadata,
    startMs: refinedStartMs,
    durationMs: refinedEndMs - refinedStartMs,
    sourceStartMs: refinedStartMs,
    sourceEndMs: refinedEndMs,
    ...(speechTiming ?? {}),
    boundaryPaddingBeforeMs: Math.max(0, boundaryStartMs - refinedStartMs),
    boundaryPaddingAfterMs: Math.max(0, refinedEndMs - boundaryEndMs),
    audioCleanupProfile: SMART_SLICE_AUDIO_CLEANUP_PROFILE,
    noiseReductionApplied,
    boundaryDecisionSource,
    ...refinedAudioActivityEvidence,
    leadingSilenceTrimMs,
    trailingSilenceTrimMs,
    tailTreatment: resolveTailTreatmentAfterAudioBoundaryRefinement(clip, trailingSilenceTrimMs),
    ...(risks !== undefined ? { risks } : {}),
  };
}

function resolveCombinedAudioTranscriptBoundaryMs(
  audioActivityBoundaryMs: number,
  transcriptBoundaryMs: number,
  direction: 'start' | 'end',
) {
  return direction === 'start'
    ? Math.max(audioActivityBoundaryMs, transcriptBoundaryMs)
    : Math.min(audioActivityBoundaryMs, transcriptBoundaryMs);
}

function resolveAudioTranscriptBoundaryConflictRisks(
  audioActivityStartMs: number,
  audioActivityEndMs: number,
  speechStartMs: number,
  speechEndMs: number,
) {
  const speechDurationMs = speechEndMs - speechStartMs;
  const overlapMs = Math.max(
    0,
    Math.min(audioActivityEndMs, speechEndMs) - Math.max(audioActivityStartMs, speechStartMs),
  );
  const transcriptCoverageRatio = speechDurationMs > 0 ? overlapMs / speechDurationMs : 0;
  const transcriptHeadTrimMs = Math.max(0, audioActivityStartMs - speechStartMs);
  const transcriptTailTrimMs = Math.max(0, speechEndMs - audioActivityEndMs);
  const audioWouldDropTranscriptSpeech =
    transcriptHeadTrimMs > MAX_AUDIO_TRANSCRIPT_BOUNDARY_DISAGREEMENT_MS ||
    transcriptTailTrimMs > MAX_AUDIO_TRANSCRIPT_BOUNDARY_DISAGREEMENT_MS ||
    transcriptCoverageRatio < MIN_AUDIO_TRANSCRIPT_BOUNDARY_OVERLAP_RATIO;

  return audioWouldDropTranscriptSpeech ? ['audio-transcript-boundary-conflict'] : undefined;
}

export function refineSmartSlicePlanWithAudioActivityBoundaries(
  clips: readonly NormalizedSlicePlanClip[],
  analyses: readonly SmartSliceAudioActivityBoundaryAnalysis[],
  options: { noiseReductionApplied?: boolean } = {},
): NormalizedSlicePlanClip[] {
  const inferredNoiseReductionApplied = options.noiseReductionApplied ??
    analyses.some((analysis) => analysis.analysisFilter === SMART_SLICE_REQUIRED_AUDIO_ACTIVITY_ANALYSIS_FILTER);
  const noiseReductionApplied = inferredNoiseReductionApplied;
  const requiredAnalysisFilter = noiseReductionApplied
    ? SMART_SLICE_REQUIRED_AUDIO_ACTIVITY_ANALYSIS_FILTER
    : SMART_SLICE_RAW_AUDIO_ACTIVITY_ANALYSIS_FILTER;
  const analysisByIndex = new Map<number, SmartSliceAudioActivityBoundaryAnalysis>();
  analyses.forEach((analysis) => {
    if (Number.isInteger(analysis.index) && analysis.index >= 0) {
      analysisByIndex.set(analysis.index, analysis);
    }
  });

  return clips.map((clip, index) => {
    const renderStartMs = Math.max(0, Math.round(clip.startMs));
    const renderEndMs = renderStartMs + Math.max(0, Math.round(clip.durationMs));
    const sourceStartMs = Math.max(
      renderStartMs,
      Math.min(Math.round(clip.sourceStartMs ?? renderStartMs), renderEndMs),
    );
    const sourceEndMs = Math.max(
      sourceStartMs,
      Math.min(Math.round(clip.sourceEndMs ?? renderEndMs), renderEndMs),
    );
    const speechStartMs = normalizeAudioBoundaryMs(clip.speechStartMs, sourceStartMs, sourceEndMs);
    const speechEndMs = normalizeAudioBoundaryMs(clip.speechEndMs, sourceStartMs, sourceEndMs);
    const analysis = analysisByIndex.get(clip.index) ?? analysisByIndex.get(index);

    if (!analysis) {
      return createUnrefinedAudioCleanupClip(clip, 'transcript', noiseReductionApplied);
    }

    const audioActivityStartMs = normalizeAudioBoundaryMs(
      analysis.audioActivityStartMs,
      sourceStartMs,
      sourceEndMs,
    );
    const audioActivityEndMs = normalizeAudioBoundaryMs(
      analysis.audioActivityEndMs,
      sourceStartMs,
      sourceEndMs,
    );
    const activityConfidence = clampScore(analysis.confidence) ?? 0;
    const audioRangeReady =
      activityConfidence >= MIN_SMART_SLICE_AUDIO_ACTIVITY_CONFIDENCE &&
      analysis.analysisFilter === requiredAnalysisFilter &&
      audioActivityStartMs !== undefined &&
      audioActivityEndMs !== undefined &&
      audioActivityEndMs > audioActivityStartMs;

    const audioActivityEvidence = createAudioActivityBoundaryEvidence(
      analysis,
      audioActivityStartMs,
      audioActivityEndMs,
      activityConfidence,
    );

    if (speechStartMs === undefined || speechEndMs === undefined || speechEndMs <= speechStartMs) {
      if (audioRangeReady) {
        const audioOnlyRenderDurationMs = Math.min(
          renderEndMs,
          audioActivityEndMs + TRANSCRIPT_BOUNDARY_PADDING_AFTER_MS,
        ) - Math.max(
          renderStartMs,
          audioActivityStartMs - TRANSCRIPT_BOUNDARY_PADDING_BEFORE_MS,
        );
        if (audioOnlyRenderDurationMs < MIN_TRANSCRIPT_ALIGNED_SLICE_DURATION_MS) {
          return createUnrefinedAudioCleanupClip(
            clip,
            'audio',
            noiseReductionApplied,
            audioActivityEvidence,
            ['audio-only-boundary-too-short'],
          );
        }

        return createAudioActivityRefinedClip(
          clip,
          renderStartMs,
          renderEndMs,
          audioActivityStartMs,
          audioActivityEndMs,
          'audio',
          audioActivityEvidence,
          noiseReductionApplied,
        );
      }

      return createUnrefinedAudioCleanupClip(
        clip,
        'transcript',
        noiseReductionApplied,
        audioActivityEvidence,
      );
    }

    const combinedBoundaryStartMs = audioRangeReady
      ? resolveCombinedAudioTranscriptBoundaryMs(audioActivityStartMs, speechStartMs, 'start')
      : speechStartMs;
    const combinedBoundaryEndMs = audioRangeReady
      ? resolveCombinedAudioTranscriptBoundaryMs(audioActivityEndMs, speechEndMs, 'end')
      : speechEndMs;
    const combinedRangeReady = combinedBoundaryEndMs > combinedBoundaryStartMs;
    const conflictRisks = audioRangeReady
      ? resolveAudioTranscriptBoundaryConflictRisks(
        audioActivityStartMs,
        audioActivityEndMs,
        speechStartMs,
        speechEndMs,
      )
      : undefined;
    const rawAudioConflictNeedsDenoiseRetry =
      audioRangeReady &&
      !noiseReductionApplied &&
      (Boolean(conflictRisks) || !combinedRangeReady);
    if (rawAudioConflictNeedsDenoiseRetry) {
      return createAudioActivityRefinedClip(
        clip,
        renderStartMs,
        renderEndMs,
        speechStartMs,
        speechEndMs,
        'transcript',
        audioActivityEvidence,
        noiseReductionApplied,
        {
          speechStartMs,
          speechEndMs,
        },
        conflictRisks,
      );
    }

    const useAudioBoundary = audioRangeReady && (Boolean(conflictRisks) || !combinedRangeReady);
    if (useAudioBoundary) {
      const audioBoundaryRenderDurationMs = Math.min(
        renderEndMs,
        audioActivityEndMs + TRANSCRIPT_BOUNDARY_PADDING_AFTER_MS,
      ) - Math.max(
        renderStartMs,
        audioActivityStartMs - TRANSCRIPT_BOUNDARY_PADDING_BEFORE_MS,
      );
      const audioBoundaryRisks = mergePlanRisks(
        conflictRisks,
        audioBoundaryRenderDurationMs < MIN_TRANSCRIPT_ALIGNED_SLICE_DURATION_MS
          ? ['audio-only-boundary-too-short']
          : undefined,
      );

      return createAudioActivityRefinedClip(
        clip,
        renderStartMs,
        renderEndMs,
        audioActivityStartMs,
        audioActivityEndMs,
        'audio',
        audioActivityEvidence,
        noiseReductionApplied,
        {
          speechStartMs: audioActivityStartMs,
          speechEndMs: audioActivityEndMs,
        },
        audioBoundaryRisks,
      );
    }

    return createAudioActivityRefinedClip(
      clip,
      renderStartMs,
      renderEndMs,
      combinedRangeReady ? combinedBoundaryStartMs : speechStartMs,
      combinedRangeReady ? combinedBoundaryEndMs : speechEndMs,
      audioRangeReady && combinedRangeReady ? 'combined' : 'transcript',
      audioActivityEvidence,
      noiseReductionApplied,
      {
        speechStartMs: combinedRangeReady ? combinedBoundaryStartMs : speechStartMs,
        speechEndMs: combinedRangeReady ? combinedBoundaryEndMs : speechEndMs,
      },
      conflictRisks,
    );
  });
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

function normalizeTranscriptSegmentCount(value: unknown) {
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

  if (metadata.transcriptSegmentTexts !== undefined) {
    const transcriptSegmentTexts = metadata.transcriptSegmentTexts
      .map((text) => normalizePlanText(text, 1_000))
      .filter((text): text is string => text !== undefined);
    if (transcriptSegmentTexts.length > 0) {
      metadata.transcriptSegmentTexts = transcriptSegmentTexts.slice(0, 20);
    } else {
      delete metadata.transcriptSegmentTexts;
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

  if (metadata.transcriptSegmentCount !== undefined) {
    const transcriptSegmentCount = normalizeTranscriptSegmentCount(metadata.transcriptSegmentCount);
    if (transcriptSegmentCount !== undefined) {
      metadata.transcriptSegmentCount = transcriptSegmentCount;
    } else {
      delete metadata.transcriptSegmentCount;
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

  if (metadata.sourceSegments !== undefined) {
    const normalizedSourceSegments = metadata.sourceSegments
      .map((segment) => ({
        startMs: normalizeNonNegativeMs(segment.startMs),
        endMs: normalizeNonNegativeMs(segment.endMs),
      }))
      .filter((segment): segment is SmartSliceSourceSegment =>
        segment.startMs !== undefined &&
        segment.endMs !== undefined &&
        segment.endMs > segment.startMs
      )
      .sort((firstSegment, secondSegment) =>
        firstSegment.startMs - secondSegment.startMs ||
          firstSegment.endMs - secondSegment.endMs,
      );
    if (normalizedSourceSegments.length > 1) {
      metadata.sourceSegments = normalizedSourceSegments.slice(0, MAX_SMART_SLICE_SOURCE_SEGMENTS);
    } else {
      delete metadata.sourceSegments;
    }
  }

  for (const key of [
    'renderedDurationMs',
    'removedSilenceMs',
    'internalSilenceTrimCount',
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

function isTranscriptAlignedSliceClip(clip: Partial<NormalizedSlicePlanClip>) {
  return Boolean(
    clip.transcriptText ||
      clip.transcriptSegmentCount !== undefined ||
      clip.speechStartMs !== undefined ||
      clip.speechEndMs !== undefined ||
      clip.speechContinuityGrade,
  );
}

function normalizeTranscriptTextForRepeatDetection(text: string | undefined) {
  return typeof text === 'string'
    ? text
        .trim()
        .toLowerCase()
        .replace(/[\p{P}\p{S}]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim()
    : '';
}

const TRANSCRIPT_REPEAT_TOKEN_STOPWORDS = new Set([
  'about',
  'again',
  'also',
  'and',
  'after',
  'because',
  'but',
  'can',
  'case',
  'complete',
  'does',
  'final',
  'first',
  'for',
  'from',
  'how',
  'into',
  'next',
  'now',
  'payoff',
  'only',
  'second',
  'that',
  'the',
  'then',
  'this',
  'through',
  'viewer',
  'viewers',
  'watch',
  'when',
  'why',
  'with',
  'you',
  'your',
]);

const TRANSCRIPT_REPEAT_TOPIC_STRUCTURE_TOKENS = new Set([
  'answer',
  'case',
  'completion',
  'complete',
  'conflict',
  'confusing',
  'context',
  'example',
  'fail',
  'failure',
  'fix',
  'hide',
  'hidden',
  'improve',
  'lesson',
  'outcome',
  'pain',
  'payoff',
  'problem',
  'result',
  'risk',
  'show',
  'solution',
  'unclear',
  'watch',
]);

const TRANSCRIPT_REPEAT_TOPIC_DISTINCTIVE_STOPWORDS = new Set([
  ...TRANSCRIPT_REPEAT_TOPIC_STRUCTURE_TOKENS,
  'because',
  'before',
  'first',
  'hide',
  'hid',
  'show',
  'that',
  'viewer',
  'viewers',
  'user',
  'workflow',
]);

function normalizeTranscriptRepeatTextSemantics(text: string) {
  return text.replace(/\b[a-z][a-z0-9']{2,}\b/giu, (token) => {
    const normalizedToken = normalizeTranscriptRepeatToken(token);
    return normalizedToken || token.toLowerCase();
  });
}

function normalizeTranscriptRepeatToken(token: string) {
  const lowerToken = token.toLowerCase().replace(/'s$/u, '');
  const normalizedToken = lowerToken
    .replace(/ies$/u, 'y')
    .replace(/(?:ing|ed|es|s)$/u, '');
  const semanticToken = TRANSCRIPT_SEMANTIC_REPEAT_TOKEN_MAP.get(normalizedToken) ?? normalizedToken;
  return semanticToken.length >= 3 && !TRANSCRIPT_REPEAT_TOKEN_STOPWORDS.has(semanticToken)
    ? semanticToken
    : '';
}

function createChineseRepeatShingles(text: string) {
  return Array.from(text.matchAll(/[\u4e00-\u9fff]{2,}/gu))
    .flatMap((match) => {
      const value = match[0];
      if (value.length <= 4) {
        return [value];
      }

      const shingles: string[] = [];
      for (let index = 0; index <= value.length - 2; index += 1) {
        shingles.push(value.slice(index, index + 2));
      }
      return shingles;
    });
}

function extractTranscriptRepeatTokens(text: string) {
  const normalizedText = normalizeTranscriptTextForRepeatDetection(text);
  const englishTokens = Array.from(normalizedText.matchAll(/\b[a-z][a-z0-9']{2,}\b/gu))
    .map((match) => normalizeTranscriptRepeatToken(match[0]))
    .filter(Boolean);
  const chineseTokens = createChineseRepeatShingles(normalizedText);
  return [...new Set([...englishTokens, ...chineseTokens])];
}

function calculateTranscriptTokenOverlapScore(firstText: string, secondText: string) {
  const firstTokens = extractTranscriptRepeatTokens(firstText);
  const secondTokens = extractTranscriptRepeatTokens(secondText);
  if (firstTokens.length < 2 || secondTokens.length < 2) {
    return 0;
  }

  const firstTokenSet = new Set(firstTokens);
  const secondTokenSet = new Set(secondTokens);
  let intersectionCount = 0;
  for (const token of firstTokenSet) {
    if (secondTokenSet.has(token)) {
      intersectionCount += 1;
    }
  }

  const unionCount = new Set([...firstTokenSet, ...secondTokenSet]).size;
  const shorterTokenCount = Math.min(firstTokenSet.size, secondTokenSet.size);
  const jaccardScore = unionCount > 0 ? intersectionCount / unionCount : 0;
  const containmentScore = shorterTokenCount > 0 ? intersectionCount / shorterTokenCount : 0;
  if (
    (shorterTokenCount < 5 && intersectionCount >= 2 && containmentScore >= 0.9 && jaccardScore >= 0.65) ||
    jaccardScore >= 0.72 ||
    (intersectionCount >= 6 && containmentScore >= 0.86)
  ) {
    return Math.max(jaccardScore, containmentScore);
  }

  return 0;
}

function calculateTranscriptRepeatedTokenDensity(texts: readonly string[]) {
  const tokenCounts = new Map<string, number>();
  let tokenCount = 0;

  for (const text of texts) {
    for (const token of extractTranscriptRepeatTokens(text)) {
      tokenCount += 1;
      tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
    }
  }

  if (tokenCount < 4 || tokenCounts.size < 2) {
    return 0;
  }

  const repeatedTokenCount = [...tokenCounts.values()]
    .filter((count) => count > 1)
    .reduce((sum, count) => sum + count, 0);
  return repeatedTokenCount / tokenCount;
}

function hasTranscriptInternalRepeatedMeaning(texts: readonly string[]) {
  const meaningfulTexts = texts
    .map((text) => normalizeTranscriptRepeatTextSemantics(normalizeTranscriptTextForRepeatDetection(text)))
    .filter((text) => text.length >= 18);
  if (meaningfulTexts.length < 2) {
    return false;
  }

  for (let firstIndex = 0; firstIndex < meaningfulTexts.length; firstIndex += 1) {
    const firstText = meaningfulTexts[firstIndex];
    if (!firstText) {
      continue;
    }
    for (let secondIndex = firstIndex + 1; secondIndex < meaningfulTexts.length; secondIndex += 1) {
      const secondText = meaningfulTexts[secondIndex];
      if (!secondText) {
        continue;
      }
      if (
        firstText === secondText ||
        firstText.includes(secondText) ||
        secondText.includes(firstText) ||
        calculateTranscriptTokenOverlapScore(firstText, secondText) > 0
      ) {
        return true;
      }
    }
  }

  return calculateTranscriptRepeatedTokenDensity(meaningfulTexts) >= 0.58;
}

function createRepeatTopicSignature(keywords: readonly string[] | undefined) {
  if (!keywords || keywords.length === 0) {
    return [];
  }

  return [...new Set(keywords
    .map((keyword) => normalizeTranscriptRepeatToken(keyword))
    .filter((keyword) => keyword && !TRANSCRIPT_REPEAT_TOPIC_STRUCTURE_TOKENS.has(keyword)))];
}

function createDistinctiveRepeatTopicSignature(keywords: readonly string[] | undefined) {
  if (!keywords || keywords.length === 0) {
    return [];
  }

  return [...new Set(keywords
    .map((keyword) => normalizeTranscriptRepeatToken(keyword))
    .filter((keyword) => keyword && !TRANSCRIPT_REPEAT_TOPIC_DISTINCTIVE_STOPWORDS.has(keyword)))];
}

function haveConflictingRepeatTopicEvidence(
  firstClip: Partial<NormalizedSlicePlanClip>,
  secondClip: Partial<NormalizedSlicePlanClip>,
) {
  const firstKeywords = normalizeTopicKeywords(firstClip.topicKeywords);
  const secondKeywords = normalizeTopicKeywords(secondClip.topicKeywords);
  const firstDistinctiveSignature = createDistinctiveRepeatTopicSignature(firstKeywords);
  const secondDistinctiveSignature = createDistinctiveRepeatTopicSignature(secondKeywords);
  if (firstDistinctiveSignature.length > 0 && secondDistinctiveSignature.length > 0) {
    const distinctiveSimilarity = calculateKeywordSimilarity(firstDistinctiveSignature, secondDistinctiveSignature);
    if (distinctiveSimilarity <= 0) {
      return true;
    }
  }

  const firstSignature = createRepeatTopicSignature(firstKeywords);
  const secondSignature = createRepeatTopicSignature(secondKeywords);
  if (firstSignature.length === 0 || secondSignature.length === 0) {
    return false;
  }

  const keywordSimilarity = calculateKeywordSimilarity(firstSignature, secondSignature);
  if (keywordSimilarity > 0) {
    return false;
  }

  return true;
}

function areTranscriptSliceClipsRepeated(
  firstClip: Partial<NormalizedSlicePlanClip>,
  secondClip: Partial<NormalizedSlicePlanClip>,
) {
  if (haveConflictingRepeatTopicEvidence(firstClip, secondClip)) {
    return false;
  }

  const firstText = normalizeTranscriptRepeatTextSemantics(
    normalizeTranscriptTextForRepeatDetection(firstClip.transcriptText),
  );
  const secondText = normalizeTranscriptRepeatTextSemantics(
    normalizeTranscriptTextForRepeatDetection(secondClip.transcriptText),
  );
  if (!firstText || !secondText) {
    return false;
  }

  if (firstText === secondText) {
    return true;
  }

  if (areSeparatedIsolatedMicroSpeechClips(firstClip, secondClip)) {
    return false;
  }

  const shorterLength = Math.min(firstText.length, secondText.length);
  if (shorterLength < 18) {
    return false;
  }

  if (firstText.includes(secondText) || secondText.includes(firstText)) {
    return true;
  }

  return calculateTranscriptTokenOverlapScore(firstText, secondText) > 0;
}

function areSeparatedIsolatedMicroSpeechClips(
  firstClip: Partial<NormalizedSlicePlanClip>,
  secondClip: Partial<NormalizedSlicePlanClip>,
) {
  return isIsolatedMicroSpeechRepeatProtectedClip(firstClip) &&
    isIsolatedMicroSpeechRepeatProtectedClip(secondClip) &&
    getClipTimelineGapMs(firstClip, secondClip) >= MIN_ISOLATED_MICRO_SPEECH_REPEAT_SEPARATION_MS;
}

function isIsolatedMicroSpeechRepeatProtectedClip(clip: Partial<NormalizedSlicePlanClip>) {
  const durationMs = typeof clip.durationMs === 'number' ? clip.durationMs : 0;
  const speechDurationMs = typeof clip.speechStartMs === 'number' && typeof clip.speechEndMs === 'number'
    ? Math.max(0, clip.speechEndMs - clip.speechStartMs)
    : durationMs;
  return clip.risks?.includes('sparse-transcript-speech') === true &&
    (clip.transcriptSegmentCount ?? 0) === 1 &&
    durationMs > 0 &&
    durationMs <= MAX_ISOLATED_MICRO_SPEECH_REPEAT_DURATION_MS &&
    speechDurationMs <= MAX_ISOLATED_MICRO_SPEECH_REPEAT_DURATION_MS;
}

function getClipTimelineGapMs(
  firstClip: Partial<NormalizedSlicePlanClip>,
  secondClip: Partial<NormalizedSlicePlanClip>,
) {
  if (
    typeof firstClip.startMs !== 'number' ||
    typeof firstClip.durationMs !== 'number' ||
    typeof secondClip.startMs !== 'number' ||
    typeof secondClip.durationMs !== 'number'
  ) {
    return 0;
  }

  const firstEndMs = firstClip.startMs + firstClip.durationMs;
  const secondEndMs = secondClip.startMs + secondClip.durationMs;
  return Math.max(0, Math.max(firstClip.startMs, secondClip.startMs) - Math.min(firstEndMs, secondEndMs));
}

function isSemanticStoryMergeCandidate(candidate: Partial<NormalizedSlicePlanClip>) {
  return candidate.risks?.includes('semantic-story-merged') === true;
}

function isSparseCompleteStandaloneTranscriptCandidate(candidate: Partial<NormalizedSlicePlanClip>) {
  const risks = Array.isArray(candidate.risks) ? candidate.risks : [];
  const hasOnlyStandaloneReviewRisks = risks.every((risk) => risk === 'sparse-transcript-speech');
  return risks.includes('sparse-transcript-speech') &&
    hasOnlyStandaloneReviewRisks &&
    (candidate.transcriptSegmentCount ?? 0) === 1 &&
    candidate.storyShape === 'complete' &&
    candidate.endingCompleteness === 'complete' &&
    candidate.contentArcGrade === 'complete' &&
    candidate.topicCoherenceGrade === 'strong' &&
    candidate.speechContinuityGrade !== 'weak' &&
    candidate.sentenceBoundaryIntegrityGrade !== 'broken' &&
    !candidate.risks?.includes('transcript-internal-repeat');
}

function filterRepeatedTranscriptCandidates(
  candidates: TranscriptSliceCandidate[],
  enableRepeatFilter: boolean,
) {
  if (!enableRepeatFilter) {
    return candidates;
  }

  const selectedCandidates: TranscriptSliceCandidate[] = [];
  for (const candidate of candidates) {
    const candidateRepeatBucket = getTranscriptSliceCandidateRepeatBucket(candidate);
    const repeatedCandidateIndex = selectedCandidates.findIndex((existingCandidate) => {
      if (candidateRepeatBucket !== getTranscriptSliceCandidateRepeatBucket(existingCandidate)) {
        return false;
      }

      return areTranscriptSliceClipsRepeated(existingCandidate, candidate);
    });
    const repeatedCandidate = repeatedCandidateIndex >= 0 ? selectedCandidates[repeatedCandidateIndex] : undefined;
    if (repeatedCandidate) {
      if (shouldPreferRepeatedTranscriptCandidate(candidate, repeatedCandidate)) {
        const mergedRisks = mergePlanRisks(candidate.risks, ['transcript-repeat-filtered']);
        selectedCandidates[repeatedCandidateIndex] = {
          ...candidate,
          ...(mergedRisks ? { risks: mergedRisks } : {}),
        };
      } else {
        const mergedRisks = mergePlanRisks(repeatedCandidate.risks, ['transcript-repeat-filtered']);
        if (mergedRisks) {
          repeatedCandidate.risks = mergedRisks;
        } else {
          delete repeatedCandidate.risks;
        }
      }
      continue;
    }

    selectedCandidates.push(candidate);
  }

  return selectedCandidates;
}

function isStrongSemanticStoryContentCandidate(
  candidate: Partial<NormalizedSlicePlanClip>,
  policy: VideoSlicePlanningPolicy,
) {
  return candidate.risks?.includes('semantic-story-merged') === true &&
    isStrongContentDerivedSliceClip(candidate, policy);
}

function isContentTopicSegmentCandidate(candidate: Partial<NormalizedSlicePlanClip>) {
  return candidate.risks?.includes(CONTENT_TOPIC_SEGMENT_RISK) === true &&
    typeof candidate.transcriptText === 'string' &&
    candidate.transcriptText.trim().length > 0 &&
    typeof candidate.transcriptCoverageScore === 'number' &&
    candidate.transcriptCoverageScore >= MIN_TRANSCRIPT_RENDER_SPEECH_COVERAGE_SCORE &&
    (candidate.transcriptSegmentCount ?? 0) >= MIN_CONTENT_TOPIC_SEGMENT_COUNT &&
    (candidate.speechContinuityGrade === 'strong' || candidate.speechContinuityGrade === 'repaired') &&
    candidate.topicCoherenceGrade !== 'weak';
}

function getTranscriptSliceCandidateRepeatBucket(candidate: Partial<NormalizedSlicePlanClip>) {
  if (isSemanticStoryMergeCandidate(candidate)) {
    return 'semantic-story';
  }
  if (isContentTopicSegmentCandidate(candidate)) {
    return 'content-topic';
  }
  return 'transcript-window';
}

function isContentTopicSegmentRisk(risk: string) {
  return risk === 'missing-payoff' ||
    risk === 'missing-hook' ||
    risk === 'missing-setup' ||
    risk === 'missing-content-hook' ||
    risk === 'missing-content-setup' ||
    risk === 'missing-content-conflict' ||
    risk === 'missing-content-payoff' ||
    risk === 'weak-hook' ||
    risk === 'open-ending' ||
    risk === 'platform-hook-not-strong' ||
    risk === 'platform-weak-hook' ||
    risk === 'platform-open-ending' ||
    risk === 'platform-incomplete-arc';
}

function normalizeContentTopicSegmentRisks(
  risks: readonly string[] | undefined,
) {
  return mergePlanRisks(risks?.filter((risk) => !isContentTopicSegmentRisk(risk))) ?? [];
}

function isIsolatedPayoffFragmentCandidate(candidate: Partial<NormalizedSlicePlanClip>) {
  const stages = Array.isArray(candidate.contentArcStages) ? candidate.contentArcStages : [];
  const payoffOnlyShape = candidate.storyShape === 'payoffOnly';
  const payoffWithoutSetup =
    stages.includes('payoff') &&
    !stages.includes('setup') &&
    candidate.contentArcGrade !== 'complete';
  if (!payoffOnlyShape && !payoffWithoutSetup) {
    return false;
  }

  return !hasNonPayoffTopicContextEvidence(candidate);
}

function hasNonPayoffTopicContextEvidence(candidate: Partial<NormalizedSlicePlanClip>) {
  const text = typeof candidate.transcriptText === 'string' ? candidate.transcriptText : '';
  const evidenceTexts = Array.isArray(candidate.transcriptSegmentTexts) && candidate.transcriptSegmentTexts.length > 0
    ? candidate.transcriptSegmentTexts
    : splitTranscriptSentences(text);
  if (evidenceTexts.length === 0) {
    return false;
  }

  return evidenceTexts.some((sentence) => {
    const normalizedSentence = sentence.trim();
    const minimumContextLength = /[\u4e00-\u9fff]/u.test(normalizedSentence) ? 8 : 16;
    if (normalizedSentence.length < minimumContextLength || startsWithWeakConnector(normalizedSentence)) {
      return false;
    }

    const stages = inferContentArcStages(normalizedSentence);
    return !stages.includes('payoff') && extractTopicKeywords(normalizedSentence).length > 0;
  });
}

function hasContentTopicReleaseStructure(candidate: Partial<NormalizedSlicePlanClip>) {
  const stages = Array.isArray(candidate.contentArcStages) ? candidate.contentArcStages : [];
  const hasNonOpenEnding = candidate.endingCompleteness === 'complete' || candidate.endingCompleteness === 'soft';
  if (!hasNonOpenEnding) {
    return false;
  }

  if (isIsolatedPayoffFragmentCandidate(candidate)) {
    return false;
  }

  if (candidate.storyShape === 'complete' || candidate.contentArcGrade === 'complete') {
    return true;
  }

  if (stages.includes('payoff')) {
    return stages.includes('setup') && hasNonPayoffTopicContextEvidence(candidate);
  }

  return (
    (candidate.transcriptSegmentCount ?? 0) >= MIN_CONTENT_TOPIC_SEGMENT_COUNT &&
    candidate.topicCoherenceGrade === 'strong' &&
    !stages.includes('conflict') &&
    hasExpositoryContentTopicEvidence(candidate)
  );
}

function hasExpositoryContentTopicEvidence(candidate: Partial<NormalizedSlicePlanClip>) {
  const evidenceTexts = Array.isArray(candidate.transcriptSegmentTexts) && candidate.transcriptSegmentTexts.length > 0
    ? candidate.transcriptSegmentTexts
    : splitTranscriptSentences(typeof candidate.transcriptText === 'string' ? candidate.transcriptText : '');
  if (evidenceTexts.length < MIN_CONTENT_TOPIC_SEGMENT_COUNT) {
    return false;
  }

  const normalizedEvidenceText = evidenceTexts.join(' ').toLowerCase();
  return /\b(?:convert|converts|converted|representation|representations|layer|retrieval|system|systems|measure|measures|measured|ranking|rank|ranks|compare|compares|concept|concepts|document|documents|chunk|chunks|chunking|indexed|metadata|pipeline|model|models|vector|vectors|embedding|embeddings|semantic|similarity|score|scores|unit|units)\b/i.test(normalizedEvidenceText) ||
    /(?:\u6982\u5ff5|\u5b9a\u4e49|\u539f\u7406|\u7cfb\u7edf|\u6a21\u578b|\u6d41\u7a0b|\u673a\u5236|\u65b9\u6cd5|\u6b65\u9aa4|\u8868\u793a|\u8ba1\u7b97|\u6d4b\u91cf|\u68c0\u7d22|\u5411\u91cf|\u8bed\u4e49|\u76f8\u4f3c|\u6392\u540d|\u6587\u6863|\u5206\u5757|\u7ba1\u9053)/u.test(normalizedEvidenceText);
}

function isContentTopicReleaseCandidate(
  candidate: Partial<NormalizedSlicePlanClip>,
  policy: VideoSlicePlanningPolicy,
) {
  const platformProfile = SLICE_PLATFORM_PROFILES[policy.targetPlatform] ?? SLICE_PLATFORM_PROFILES.generic;
  const durationMs = typeof candidate.durationMs === 'number' ? candidate.durationMs : 0;
  return isContentTopicSegmentCandidate(candidate) &&
    durationMs >= platformProfile.idealMinDurationMs &&
    hasContentTopicReleaseStructure(candidate) &&
    candidate.publishabilityGrade !== 'reject' &&
    candidate.platformReadinessGrade !== 'reject' &&
    candidate.sentenceBoundaryIntegrityGrade !== 'broken' &&
    !candidate.risks?.includes('transcript-internal-repeat');
}

function selectContentDerivedCandidateOutputPool(
  candidates: TranscriptSliceCandidate[],
  policy: VideoSlicePlanningPolicy,
  candidatePoolLimit: number,
) {
  const strongSemanticStoryCandidates = candidates.filter((candidate) =>
    isStrongSemanticStoryContentCandidate(candidate, policy)
  );
  const topicSegmentCandidates = candidates.filter(isContentTopicSegmentCandidate);
  const prunedCandidates = pruneTranscriptSliceCandidatePool(candidates, policy, candidatePoolLimit);
  if (strongSemanticStoryCandidates.length === 0 && topicSegmentCandidates.length === 0) {
    return prunedCandidates;
  }

  const prunedById = new Map(prunedCandidates.map((candidate) => [candidate.candidateId, candidate]));
  for (const storyCandidate of strongSemanticStoryCandidates) {
    prunedById.set(storyCandidate.candidateId, storyCandidate);
  }
  for (const topicCandidate of topicSegmentCandidates) {
    prunedById.set(topicCandidate.candidateId, topicCandidate);
  }

  return sortTranscriptSliceCandidatesByScore([...prunedById.values()]);
}

function shouldPreferRepeatedTranscriptCandidate(
  candidate: TranscriptSliceCandidate,
  existingCandidate: TranscriptSliceCandidate,
) {
  if (
    isSparseCompleteStandaloneTranscriptCandidate(candidate) &&
    existingCandidate.risks?.includes('semantic-story-merged') &&
    doesSemanticStoryCandidateCoverClip(existingCandidate, candidate)
  ) {
    return true;
  }

  if (
    candidate.risks?.includes('semantic-story-merged') &&
    isSparseCompleteStandaloneTranscriptCandidate(existingCandidate) &&
    doesSemanticStoryCandidateCoverClip(candidate, existingCandidate)
  ) {
    return false;
  }

  const candidateStoryScore = (candidate.risks?.includes('semantic-story-merged') ? 4 : 0) +
    (candidate.contentArcGrade === 'complete' ? 2 : 0) +
    (candidate.contentArcGrade === 'complete' && candidate.topicCoherenceGrade !== 'weak' ? 1 : 0) +
    (candidate.contentArcGrade === 'complete' ? Math.min(3, candidate.transcriptSegmentCount ?? 0) * 0.2 : 0);
  const existingStoryScore = (existingCandidate.risks?.includes('semantic-story-merged') ? 4 : 0) +
    (existingCandidate.contentArcGrade === 'complete' ? 2 : 0) +
    (existingCandidate.contentArcGrade === 'complete' && existingCandidate.topicCoherenceGrade !== 'weak' ? 1 : 0) +
    (existingCandidate.contentArcGrade === 'complete' ? Math.min(3, existingCandidate.transcriptSegmentCount ?? 0) * 0.2 : 0);
  if (candidateStoryScore !== existingStoryScore) {
    return candidateStoryScore > existingStoryScore;
  }

  const repairRiskScore = (value: TranscriptSliceCandidate) =>
    (value.risks?.includes('connector-repaired') ? 2 : 0) +
    (value.risks?.includes('trailing-connector-extended') ? 1 : 0) +
    (value.risks?.includes('open-sentence-extended') ? 1 : 0) +
    (value.risks?.includes('internal-silence-trimmed') ? 1.5 : 0);
  const candidateRepairScore = repairRiskScore(candidate);
  const existingRepairScore = repairRiskScore(existingCandidate);
  if (candidateRepairScore !== existingRepairScore) {
    return candidateRepairScore > existingRepairScore;
  }

  if (candidate.score !== existingCandidate.score) {
    return candidate.score > existingCandidate.score;
  }

  return candidate.anchorSegmentIndex < existingCandidate.anchorSegmentIndex;
}

function getTranscriptSliceCandidatePoolLimit(policy: VideoSlicePlanningPolicy) {
  void policy;
  return Math.min(
    MAX_TRANSCRIPT_SLICE_CANDIDATE_POOL_SIZE,
    MAX_TRANSCRIPT_SLICE_CANDIDATE_POOL_SIZE,
  );
}

function pruneTranscriptSliceCandidatePool(
  candidates: TranscriptSliceCandidate[],
  policy: VideoSlicePlanningPolicy,
  candidatePoolLimit: number,
) {
  if (candidates.length <= candidatePoolLimit) {
    return candidates;
  }

  const topQualityCount = Math.ceil(candidatePoolLimit * 0.75);
  const topQualityCandidates = sortTranscriptSliceCandidatesByScore(candidates).slice(0, topQualityCount);
  const selectedById = new Map(topQualityCandidates.map((candidate) => [candidate.candidateId, candidate]));
  const remainingCandidates = candidates
    .filter((candidate) => !selectedById.has(candidate.candidateId))
    .sort((first, second) =>
      first.startMs - second.startMs ||
      first.endMs - second.endMs ||
      second.score - first.score ||
      first.anchorSegmentIndex - second.anchorSegmentIndex
    );

  const distributionSlots = Math.max(0, candidatePoolLimit - selectedById.size);
  if (distributionSlots > 0 && remainingCandidates.length > 0) {
    const sourceDurationMs = policy.sourceDurationMs
      ?? Math.max(...candidates.map((candidate) => candidate.endMs));
    const bucketDurationMs = Math.max(1, Math.ceil(sourceDurationMs / distributionSlots));
    const bestByBucket = new Map<number, TranscriptSliceCandidate>();
    for (const candidate of remainingCandidates) {
      const bucketIndex = Math.min(distributionSlots - 1, Math.floor(candidate.startMs / bucketDurationMs));
      const existingCandidate = bestByBucket.get(bucketIndex);
      if (!existingCandidate || shouldPreferTranscriptCandidateForPool(candidate, existingCandidate, policy)) {
        bestByBucket.set(bucketIndex, candidate);
      }
    }

    for (const candidate of [...bestByBucket.values()].sort((first, second) =>
      first.startMs - second.startMs ||
      second.score - first.score ||
      first.anchorSegmentIndex - second.anchorSegmentIndex
    )) {
      if (selectedById.size >= candidatePoolLimit) {
        break;
      }
      selectedById.set(candidate.candidateId, candidate);
    }
  }

  return sortTranscriptSliceCandidatesByScore([...selectedById.values()]).slice(0, candidatePoolLimit);
}

function shouldPreferTranscriptCandidateForPool(
  candidate: TranscriptSliceCandidate,
  existingCandidate: TranscriptSliceCandidate,
  policy: VideoSlicePlanningPolicy,
) {
  const candidateSelectionScore = getClipSelectionScore(candidate, policy);
  const existingSelectionScore = getClipSelectionScore(existingCandidate, policy);
  if (candidateSelectionScore !== existingSelectionScore) {
    return candidateSelectionScore > existingSelectionScore;
  }

  if (candidate.score !== existingCandidate.score) {
    return candidate.score > existingCandidate.score;
  }

  return candidate.durationMs > existingCandidate.durationMs;
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

function isSliceCandidateCompatibleWithPlan(
  plan: readonly NormalizedSlicePlanClip[],
  candidate: NormalizedSlicePlanClip,
  enableRepeatFilter: boolean,
) {
  return !plan.some((existingCandidate) =>
    doSliceCandidatesOverlap(existingCandidate, candidate) ||
      (enableRepeatFilter && areTranscriptSliceClipsRepeated(existingCandidate, candidate))
  );
}

function doSliceCandidatesOverlap(
  firstClip: Pick<NormalizedSlicePlanClip, 'startMs' | 'durationMs'>,
  secondClip: Pick<NormalizedSlicePlanClip, 'startMs' | 'durationMs'>,
) {
  return calculateClipOverlapRatio(firstClip, secondClip) > 0;
}

function calculateSliceCandidateSetScore(
  candidates: readonly NormalizedSlicePlanClip[],
  policy: VideoSlicePlanningPolicy,
) {
  const selectionScore = candidates.reduce(
    (score, candidate) => score + getClipSelectionScore(candidate, policy),
    0,
  );
  const completeArcCount = candidates.filter((candidate) => candidate.contentArcGrade === 'complete').length;
  const incompleteArcCount = candidates.filter((candidate) =>
    candidate.contentArcGrade === 'partial' || candidate.contentArcGrade === 'thin'
  ).length;
  const transcriptAlignedCount = candidates.filter((candidate) => isTranscriptAlignedSliceClip(candidate)).length;
  const semanticStoryMergedCount = candidates.filter((candidate) =>
    candidate.risks?.includes('semantic-story-merged')
  ).length;
  const transcriptSegmentScore = candidates.reduce(
    (score, candidate) => score + Math.min(3, candidate.transcriptSegmentCount ?? 0) * 0.11,
    0,
  );
  const singleSegmentPenalty = candidates.filter((candidate) =>
    isTranscriptAlignedSliceClip(candidate) && (candidate.transcriptSegmentCount ?? 0) <= 1
  ).length * 0.22;
  const sparseTranscriptPenalty = candidates.filter((candidate) =>
    candidate.risks?.includes('sparse-transcript-speech')
  ).length * 0.26;
  const incompleteStoryPenalty = candidates.filter((candidate) =>
    candidate.risks?.includes('missing-payoff') ||
      candidate.risks?.includes('missing-content-payoff') ||
      candidate.risks?.includes('missing-hook') ||
      candidate.risks?.includes('missing-content-hook') ||
      candidate.risks?.includes('missing-content-conflict') ||
      candidate.risks?.includes('missing-setup')
  ).length * 0.16;
  const repeatedAuditCount = candidates.filter((candidate) =>
    candidate.risks?.includes('transcript-repeat-filtered')
  ).length;
  const silenceCompactedCount = candidates.filter((candidate) =>
    candidate.risks?.includes('internal-silence-trimmed')
  ).length;
  const repairedBoundaryCount = candidates.filter((candidate) =>
    candidate.risks?.includes('connector-repaired') ||
      candidate.risks?.includes('trailing-connector-extended') ||
      candidate.risks?.includes('open-sentence-extended')
  ).length;

  return selectionScore +
    completeArcCount * 0.24 +
    semanticStoryMergedCount * 0.34 +
    transcriptAlignedCount * 0.08 +
    transcriptSegmentScore +
    repeatedAuditCount * 0.03 +
    silenceCompactedCount * 0.11 +
    repairedBoundaryCount * 0.02 -
    incompleteArcCount * 0.08 -
    singleSegmentPenalty -
    sparseTranscriptPenalty -
    incompleteStoryPenalty;
}

function compareSliceCandidateSets(
  firstCandidates: readonly NormalizedSlicePlanClip[],
  secondCandidates: readonly NormalizedSlicePlanClip[],
  policy: VideoSlicePlanningPolicy,
) {
  if (firstCandidates.length !== secondCandidates.length && (firstCandidates.length === 0 || secondCandidates.length === 0)) {
    return firstCandidates.length - secondCandidates.length;
  }

  const firstStrongContentCount = firstCandidates.filter((candidate) =>
    isStrongContentDerivedSliceClip(candidate, policy)
  ).length;
  const secondStrongContentCount = secondCandidates.filter((candidate) =>
    isStrongContentDerivedSliceClip(candidate, policy)
  ).length;
  if (firstStrongContentCount !== secondStrongContentCount) {
    return firstStrongContentCount - secondStrongContentCount;
  }

  const firstPreferredContentCount = firstCandidates.filter((candidate) =>
    isPreferredContentCandidate(candidate, policy)
  ).length;
  const secondPreferredContentCount = secondCandidates.filter((candidate) =>
    isPreferredContentCandidate(candidate, policy)
  ).length;
  if (firstPreferredContentCount !== secondPreferredContentCount) {
    return firstPreferredContentCount - secondPreferredContentCount;
  }

  const firstCompleteSemanticStoryCount = firstCandidates.filter(isCompleteSemanticStoryCandidate).length;
  const secondCompleteSemanticStoryCount = secondCandidates.filter(isCompleteSemanticStoryCandidate).length;
  if (firstCompleteSemanticStoryCount !== secondCompleteSemanticStoryCount) {
    return firstCompleteSemanticStoryCount - secondCompleteSemanticStoryCount;
  }

  const firstBlockingContentRiskCount = firstCandidates.filter(hasBlockingContentRisk).length;
  const secondBlockingContentRiskCount = secondCandidates.filter(hasBlockingContentRisk).length;
  if (firstBlockingContentRiskCount !== secondBlockingContentRiskCount) {
    return secondBlockingContentRiskCount - firstBlockingContentRiskCount;
  }

  const firstReleaseReadyCount = firstCandidates.filter((candidate) =>
    isReleaseReadySliceCandidate(candidate, policy)
  ).length;
  const secondReleaseReadyCount = secondCandidates.filter((candidate) =>
    isReleaseReadySliceCandidate(candidate, policy)
  ).length;
  if (firstReleaseReadyCount !== secondReleaseReadyCount) {
    return firstReleaseReadyCount - secondReleaseReadyCount;
  }

  const firstScore = calculateSliceCandidateSetScore(firstCandidates, policy);
  const secondScore = calculateSliceCandidateSetScore(secondCandidates, policy);
  if (firstScore !== secondScore) {
    return firstScore - secondScore;
  }

  if (firstCandidates.length !== secondCandidates.length) {
    return firstCandidates.length - secondCandidates.length;
  }

  const firstCompleteArcCount = firstCandidates.filter((candidate) => candidate.contentArcGrade === 'complete').length;
  const secondCompleteArcCount = secondCandidates.filter((candidate) => candidate.contentArcGrade === 'complete').length;
  if (firstCompleteArcCount !== secondCompleteArcCount) {
    return firstCompleteArcCount - secondCompleteArcCount;
  }

  const firstDurationMs = firstCandidates.reduce((durationMs, candidate) => durationMs + candidate.durationMs, 0);
  const secondDurationMs = secondCandidates.reduce((durationMs, candidate) => durationMs + candidate.durationMs, 0);
  if (firstDurationMs !== secondDurationMs) {
    return secondDurationMs - firstDurationMs;
  }

  const firstStartMs = firstCandidates[0]?.startMs ?? Number.POSITIVE_INFINITY;
  const secondStartMs = secondCandidates[0]?.startMs ?? Number.POSITIVE_INFINITY;
  return secondStartMs - firstStartMs;
}

function selectOptimalSliceCandidateSet(
  candidates: NormalizedSlicePlanClip[],
  policy: VideoSlicePlanningPolicy,
  enableRepeatFilter: boolean,
) {
  return selectOptimalSliceCandidateSetByDynamicProgramming(candidates, policy, enableRepeatFilter);
}

function selectOptimalSliceCandidateSetByDynamicProgramming(
  candidates: NormalizedSlicePlanClip[],
  policy: VideoSlicePlanningPolicy,
  enableRepeatFilter: boolean,
) {
  const orderedCandidates = sortSliceClipsByEndMs(candidates);
  const previousCompatibleIndexes = findPreviousCompatibleSliceCandidateIndexes(
    orderedCandidates,
    enableRepeatFilter,
  );
  const selectionLimit = orderedCandidates.length;
  const emptyPlanBuckets = createEmptySliceCandidatePlanBuckets(selectionLimit);
  const planBucketsByCandidateIndex: NormalizedSlicePlanClip[][][][] = [
    emptyPlanBuckets,
  ];

  for (let candidateIndex = 0; candidateIndex < orderedCandidates.length; candidateIndex += 1) {
    const candidate = orderedCandidates[candidateIndex];
    const previousBuckets = planBucketsByCandidateIndex[candidateIndex] ?? emptyPlanBuckets;
    const nextBuckets = cloneSliceCandidatePlanBuckets(previousBuckets);
    if (!candidate) {
      planBucketsByCandidateIndex.push(nextBuckets);
      continue;
    }

    const compatibleCandidateIndex = previousCompatibleIndexes[candidateIndex] ?? -1;
    const compatibleBuckets = planBucketsByCandidateIndex[compatibleCandidateIndex + 1] ?? emptyPlanBuckets;
    for (let count = 1; count <= selectionLimit; count += 1) {
      for (const compatiblePlan of compatibleBuckets[count - 1] ?? []) {
        const nextPlan = sortSliceClipsByStartMs([...compatiblePlan, candidate]);
        if (
          nextPlan.length === count &&
          isSliceCandidatePlanInternallyCompatible(nextPlan, enableRepeatFilter)
        ) {
          nextBuckets[count] = addSliceCandidatePlanToBucket(nextBuckets[count] ?? [], nextPlan, policy);
        }
      }
    }

    planBucketsByCandidateIndex.push(nextBuckets);
  }

  return (planBucketsByCandidateIndex.at(-1) ?? emptyPlanBuckets).flat().reduce(
    (bestPlan, plan) => compareSliceCandidateSets(plan, bestPlan, policy) > 0 ? plan : bestPlan,
    [] as NormalizedSlicePlanClip[],
  );
}

function createEmptySliceCandidatePlanBuckets(selectionLimit: number) {
  return Array.from(
    { length: selectionLimit + 1 },
    (_, count) => count === 0 ? [[] as NormalizedSlicePlanClip[]] : [],
  );
}

function cloneSliceCandidatePlanBuckets(planBuckets: readonly NormalizedSlicePlanClip[][][]) {
  return planBuckets.map((bucket) => bucket.map((plan) => plan.slice()));
}

function addSliceCandidatePlanToBucket(
  bucket: NormalizedSlicePlanClip[][],
  nextPlan: NormalizedSlicePlanClip[],
  policy: VideoSlicePlanningPolicy,
) {
  const mergedBucket = bucket.filter((plan) => !areSliceCandidateSetsEquivalent(plan, nextPlan));
  mergedBucket.push(nextPlan);
  return mergedBucket
    .sort((firstPlan, secondPlan) => compareSliceCandidateSets(secondPlan, firstPlan, policy))
    .slice(0, SLICE_CANDIDATE_DP_BEAM_WIDTH);
}

function areSliceCandidateSetsEquivalent(
  firstPlan: readonly NormalizedSlicePlanClip[],
  secondPlan: readonly NormalizedSlicePlanClip[],
) {
  if (firstPlan.length !== secondPlan.length) {
    return false;
  }

  return firstPlan.every((firstClip, index) => {
    const secondClip = secondPlan[index];
    if (!secondClip) {
      return false;
    }

    return (
      firstClip.startMs === secondClip.startMs &&
      firstClip.durationMs === secondClip.durationMs &&
      firstClip.label === secondClip.label
    );
  });
}

function isSliceCandidatePlanInternallyCompatible(
  plan: readonly NormalizedSlicePlanClip[],
  enableRepeatFilter: boolean,
) {
  return plan.every((candidate, candidateIndex) =>
    isSliceCandidateCompatibleWithPlan(plan.slice(0, candidateIndex), candidate, enableRepeatFilter)
  );
}

function findPreviousCompatibleSliceCandidateIndexes(
  candidates: readonly NormalizedSlicePlanClip[],
  enableRepeatFilter: boolean,
) {
  return candidates.map((candidate, candidateIndex) => {
    for (let previousIndex = candidateIndex - 1; previousIndex >= 0; previousIndex -= 1) {
      const previousCandidate = candidates[previousIndex];
      if (
        previousCandidate &&
        isSliceCandidateCompatibleWithPlan([previousCandidate], candidate, enableRepeatFilter)
      ) {
        return previousIndex;
      }
    }

    return -1;
  });
}

export function normalizeSliceDurationMs(durationSeconds: number) {
  const durationMs = Math.round(durationSeconds * 1_000);
  if (!Number.isFinite(durationMs)) {
    return 15_000;
  }

  return Math.max(MIN_SLICE_DURATION_MS, Math.min(durationMs, MAX_SLICE_DURATION_MS));
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
  const sourceDurationMs = normalizeSourceDurationMs(params.sourceDurationMs);
  const continuityLevel = params.continuityLevel ?? 'standard';
  const segmentationDensity = params.segmentationDensity ?? 'default';

  return {
    targetPlatform,
    targetAspectRatio:
      params.targetAspectRatio && params.targetAspectRatio !== 'auto'
        ? params.targetAspectRatio
        : platformProfile.targetAspectRatio,
    videoObjectFit: params.videoObjectFit ?? platformProfile.videoObjectFit,
    minDurationMs,
    maxDurationMs,
    idealDurationMs,
    ...(sourceDurationMs !== undefined ? { sourceDurationMs } : {}),
    continuityLevel,
    segmentationDensity,
    continuityJoinGapMs: continuityLevel === 'strict'
      ? STRICT_TRANSCRIPT_SEGMENT_JOIN_GAP_MS
      : STANDARD_TRANSCRIPT_SEGMENT_JOIN_GAP_MS,
    candidateJoinGapMs: segmentationDensity === 'maximize-continuity'
      ? MAXIMIZE_CONTINUITY_CANDIDATE_SEGMENT_JOIN_GAP_MS
      : DEFAULT_CANDIDATE_SEGMENT_JOIN_GAP_MS,
    continuityOverlapToleranceMs: continuityLevel === 'strict'
      ? STRICT_TRANSCRIPT_SEGMENT_OVERLAP_TOLERANCE_MS
      : STANDARD_TRANSCRIPT_SEGMENT_OVERLAP_TOLERANCE_MS,
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
  assertFiniteSliceDurationSeconds(params.minDuration, 'minimum slice duration');
  assertFiniteSliceDurationSeconds(params.maxDuration, 'maximum slice duration');
  if (params.idealDuration !== undefined) {
    assertFiniteSliceDurationSeconds(params.idealDuration, 'ideal slice duration');
  }
  if (params.sourceDurationMs !== undefined) {
    assertFinitePositiveSliceMilliseconds(params.sourceDurationMs, 'source media duration');
  }

  const minDurationMs = normalizeSliceDurationMs(params.minDuration);
  const maxDurationMs = normalizeSliceDurationMs(params.maxDuration);

  if (minDurationMs > maxDurationMs) {
    throw new Error('AutoCut minimum slice duration must be less than or equal to the maximum slice duration.');
  }

}

function assertFiniteSliceDurationSeconds(value: unknown, fieldName: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`AutoCut ${fieldName} must be a finite number of seconds.`);
  }
  const durationMs = Math.round(value * 1_000);
  if (durationMs < MIN_SLICE_DURATION_MS || durationMs > MAX_SLICE_DURATION_MS) {
    throw new Error(
      `AutoCut ${fieldName} must be between ${MIN_SLICE_DURATION_MS / 1_000} and ${MAX_SLICE_DURATION_MS / 1_000} seconds.`,
    );
  }
}

function assertFinitePositiveSliceMilliseconds(value: unknown, fieldName: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`AutoCut ${fieldName} must be a finite positive number of milliseconds.`);
  }
  if (value < MIN_SLICE_DURATION_MS) {
    throw new Error(`AutoCut ${fieldName} must be at least ${MIN_SLICE_DURATION_MS} milliseconds.`);
  }
}

function normalizeTranscriptSegmentTextForPlanning(text: string) {
  return normalizeAutoCutTranscriptEvidenceText(text);
}

export function normalizeSmartSliceTranscriptEvidenceText(text: string) {
  const normalizedText = normalizeAutoCutTranscriptEvidenceText(text);
  return normalizedText && !isLowInformationAutoCutTranscriptEvidenceText(normalizedText)
    ? normalizedText
    : '';
}

function splitTranscriptSegmentTextIntoPlanningSentences(text: string) {
  const normalizedText = normalizeTranscriptSegmentTextForPlanning(text);
  if (!normalizedText) {
    return [];
  }

  return splitTranscriptSentences(normalizedText);
}

function hasMultipleExplicitStoryOpenings(sentences: readonly string[]) {
  let openingCount = 0;
  for (const sentence of sentences) {
    if (hasExplicitContentSectionOpening(sentence)) {
      openingCount += 1;
      if (openingCount >= MIN_EXPLICIT_STORY_OPENINGS_FOR_COARSE_SEGMENT_SPLIT) {
        return true;
      }
    }
  }

  return false;
}

function splitCoarseTranscriptSegmentForPlanning(
  segment: AutoCutSpeechTranscriptionSegment,
): AutoCutSpeechTranscriptionSegment[] {
  const startMs = Math.max(0, Math.round(segment.startMs));
  const endMs = Math.max(0, Math.round(segment.endMs));
  if (endMs <= startMs) {
    return [];
  }

  const text = normalizeTranscriptSegmentTextForPlanning(segment.text);
  if (!text || isLowInformationTranscriptFillerSegment(text)) {
    return [{
      ...segment,
      startMs,
      endMs,
      text,
    }];
  }

  const sentences = splitTranscriptSegmentTextIntoPlanningSentences(text);
  const durationMs = endMs - startMs;
  const shouldSplitExplicitStories = hasMultipleExplicitStoryOpenings(sentences);
  if (
    !shouldSplitExplicitStories &&
    (durationMs < MIN_COARSE_TRANSCRIPT_SEGMENT_SPLIT_DURATION_MS ||
    sentences.length < MIN_COARSE_TRANSCRIPT_SEGMENT_SPLIT_SENTENCE_COUNT
    )
  ) {
    return [{
      ...segment,
      startMs,
      endMs,
      text,
    }];
  }

  const totalTextWeight = sentences.reduce(
    (weight, sentence) => weight + Math.max(1, Array.from(sentence).length),
    0,
  );
  let cursorMs = startMs;
  let accumulatedTextWeight = 0;

  return sentences.map((sentence, index) => {
    accumulatedTextWeight += Math.max(1, Array.from(sentence).length);
    const sentenceEndMs = index === sentences.length - 1
      ? endMs
      : Math.max(
          cursorMs + 1,
          Math.min(
            endMs - (sentences.length - index - 1),
            startMs + Math.round((durationMs * accumulatedTextWeight) / totalTextWeight),
          ),
        );
    const sentenceSegment = {
      ...segment,
      startMs: cursorMs,
      endMs: sentenceEndMs,
      text: sentence,
      ...selectTranscriptWordsForPlanningSentence(segment.words, cursorMs, sentenceEndMs),
    };
    cursorMs = sentenceEndMs;
    return sentenceSegment;
  });
}

function selectTranscriptWordsForPlanningSentence(
  words: AutoCutSpeechTranscriptionSegment['words'],
  startMs: number,
  endMs: number,
): Pick<AutoCutSpeechTranscriptionSegment, 'words'> {
  if (!Array.isArray(words) || words.length === 0) {
    return {};
  }

  const sentenceWords = words
    .filter((word) =>
      typeof word.startMs === 'number' &&
      typeof word.endMs === 'number' &&
      Number.isFinite(word.startMs) &&
      Number.isFinite(word.endMs) &&
      word.endMs > startMs &&
      word.startMs < endMs &&
      typeof word.text === 'string' &&
      word.text.trim().length > 0
    )
    .map((word) => ({
      ...word,
      startMs: Math.max(startMs, Math.round(word.startMs)),
      endMs: Math.min(endMs, Math.round(word.endMs)),
      text: word.text.trim(),
    }))
    .filter((word) => word.endMs > word.startMs);

  return sentenceWords.length > 0 ? { words: sentenceWords } : {};
}

export function normalizeSmartSliceTranscriptSegmentsForPlanning(
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
): AutoCutSpeechTranscriptionSegment[] {
  return sortTranscriptSegmentsByStartMs(transcriptSegments
    .filter((segment) => Number.isFinite(segment.startMs) && Number.isFinite(segment.endMs))
    .flatMap((segment) => splitCoarseTranscriptSegmentForPlanning(segment))
    .filter((segment) =>
      Number.isFinite(segment.startMs) &&
      Number.isFinite(segment.endMs) &&
      segment.endMs > segment.startMs
    ));
}

export interface SmartSliceTranscriptAudioMuteRange {
  startMs: number;
  endMs: number;
}

export function createSmartSliceSpeechSourceSegments(
  clip: Pick<NormalizedSlicePlanClip, 'sourceStartMs' | 'sourceEndMs' | 'startMs' | 'durationMs'>,
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
): SmartSliceSourceSegment[] {
  const clipStartMs = Math.max(0, Math.round(clip.sourceStartMs ?? clip.startMs));
  const clipEndMs = Math.max(
    clipStartMs,
    Math.round(clip.sourceEndMs ?? clip.startMs + clip.durationMs),
  );
  if (clipEndMs <= clipStartMs) {
    return [];
  }

  const speechSegments = transcriptSegments
    .filter((segment) =>
      Number.isFinite(segment.startMs) &&
      Number.isFinite(segment.endMs) &&
      segment.endMs > clipStartMs &&
      segment.startMs < clipEndMs &&
      normalizeSmartSliceTranscriptEvidenceText(segment.text).length > 0
    )
    .map((segment) => ({
      startMs: Math.max(clipStartMs, Math.round(segment.startMs)),
      endMs: Math.min(clipEndMs, Math.round(segment.endMs)),
    }))
    .filter((segment) => segment.endMs > segment.startMs)
    .sort((firstSegment, secondSegment) =>
      firstSegment.startMs - secondSegment.startMs ||
        firstSegment.endMs - secondSegment.endMs,
    );
  if (speechSegments.length === 0) {
    return [];
  }

  const paddedSpeechRanges = speechSegments.map((segment) => ({
    startMs: Math.max(clipStartMs, segment.startMs - TRANSCRIPT_BOUNDARY_PADDING_BEFORE_MS),
    endMs: Math.min(clipEndMs, segment.endMs + TRANSCRIPT_BOUNDARY_PADDING_AFTER_MS),
  }));
  const sourceSegments: SmartSliceSourceSegment[] = [];
  for (const range of paddedSpeechRanges) {
    const previousRange = sourceSegments.at(-1);
    if (
      previousRange &&
      (
        range.startMs - previousRange.endMs <= MAX_SMART_SLICE_RETAINED_INTERNAL_SILENCE_MS ||
        speechSegments.some((segment) =>
          segment.startMs < previousRange.endMs &&
            segment.endMs > range.startMs &&
            segment.startMs >= previousRange.startMs &&
            segment.endMs <= range.endMs
        )
      )
    ) {
      previousRange.endMs = Math.max(previousRange.endMs, range.endMs);
      continue;
    }

    sourceSegments.push({ ...range });
  }

  if (sourceSegments.length <= 1 || sourceSegments.length > MAX_SMART_SLICE_SOURCE_SEGMENTS) {
    return [];
  }

  const retainedDurationMs = sourceSegments.reduce(
    (totalDurationMs, segment) => totalDurationMs + Math.max(0, segment.endMs - segment.startMs),
    0,
  );
  if (clipEndMs - clipStartMs - retainedDurationMs < MIN_SMART_SLICE_INTERNAL_SILENCE_TRIM_MS) {
    return [];
  }

  return sourceSegments;
}

export function createSmartSliceAudioActivitySourceSegments(
  clip: Pick<NormalizedSlicePlanClip, 'sourceStartMs' | 'sourceEndMs' | 'startMs' | 'durationMs'>,
  analysis: Pick<
    SmartSliceAudioActivityBoundaryAnalysis,
    'audioActivityStartMs' | 'audioActivityEndMs' | 'internalSilenceIntervals' | 'confidence' | 'analysisFilter'
  > | undefined,
): SmartSliceSourceSegment[] {
  const clipStartMs = Math.max(0, Math.round(clip.sourceStartMs ?? clip.startMs));
  const clipEndMs = Math.max(
    clipStartMs,
    Math.round(clip.sourceEndMs ?? clip.startMs + clip.durationMs),
  );
  if (
    clipEndMs <= clipStartMs ||
    !analysis ||
    (clampScore(analysis.confidence) ?? 0) < MIN_SMART_SLICE_AUDIO_ACTIVITY_CONFIDENCE ||
    (
      analysis.analysisFilter !== SMART_SLICE_REQUIRED_AUDIO_ACTIVITY_ANALYSIS_FILTER &&
      analysis.analysisFilter !== SMART_SLICE_RAW_AUDIO_ACTIVITY_ANALYSIS_FILTER
    )
  ) {
    return [];
  }

  const sourceSilenceIntervals: SmartSliceSourceSegment[] = [];
  if (
    typeof analysis.audioActivityStartMs === 'number' &&
    Number.isFinite(analysis.audioActivityStartMs) &&
    analysis.audioActivityStartMs > clipStartMs
  ) {
    sourceSilenceIntervals.push({
      startMs: clipStartMs,
      endMs: Math.min(clipEndMs, Math.round(analysis.audioActivityStartMs)),
    });
  }
  sourceSilenceIntervals.push(...(analysis.internalSilenceIntervals ?? []));
  if (
    typeof analysis.audioActivityEndMs === 'number' &&
    Number.isFinite(analysis.audioActivityEndMs) &&
    analysis.audioActivityEndMs < clipEndMs
  ) {
    sourceSilenceIntervals.push({
      startMs: Math.max(clipStartMs, Math.round(analysis.audioActivityEndMs)),
      endMs: clipEndMs,
    });
  }

  const silenceIntervals = sourceSilenceIntervals
    .filter((interval) =>
      Number.isFinite(interval.startMs) &&
      Number.isFinite(interval.endMs) &&
      interval.endMs > interval.startMs &&
      interval.endMs > clipStartMs &&
      interval.startMs < clipEndMs
    )
    .map((interval) => ({
      startMs: Math.max(clipStartMs, Math.round(interval.startMs)),
      endMs: Math.min(clipEndMs, Math.round(interval.endMs)),
    }))
    .filter((interval) =>
      interval.endMs - interval.startMs >= MIN_SMART_SLICE_INTERNAL_SILENCE_TRIM_MS
    )
    .sort((firstInterval, secondInterval) =>
      firstInterval.startMs - secondInterval.startMs ||
        firstInterval.endMs - secondInterval.endMs,
    );
  if (silenceIntervals.length === 0) {
    return [];
  }

  const retainedSegments: SmartSliceSourceSegment[] = [];
  let cursorMs = clipStartMs;
  for (const interval of silenceIntervals) {
    const retainedPaddingBeforeIntervalMs = interval.endMs >= clipEndMs
      ? TRANSCRIPT_BOUNDARY_PADDING_AFTER_MS
      : Math.floor(MAX_SMART_SLICE_RETAINED_INTERNAL_SILENCE_MS / 2);
    const retainedPaddingAfterIntervalMs = interval.startMs <= clipStartMs
      ? TRANSCRIPT_BOUNDARY_PADDING_BEFORE_MS
      : Math.ceil(MAX_SMART_SLICE_RETAINED_INTERNAL_SILENCE_MS / 2);
    const trimStartMs = Math.max(
      cursorMs,
      interval.startMs <= clipStartMs
        ? clipStartMs
        : interval.startMs + retainedPaddingBeforeIntervalMs,
    );
    const trimEndMs = Math.min(
      clipEndMs,
      interval.endMs >= clipEndMs
        ? clipEndMs
        : interval.endMs - retainedPaddingAfterIntervalMs,
    );
    if (trimEndMs <= trimStartMs || trimEndMs - trimStartMs < MIN_SMART_SLICE_INTERNAL_SILENCE_TRIM_MS) {
      continue;
    }
    if (trimStartMs > cursorMs) {
      retainedSegments.push({ startMs: cursorMs, endMs: trimStartMs });
    }
    cursorMs = Math.max(cursorMs, trimEndMs);
  }
  if (cursorMs < clipEndMs) {
    retainedSegments.push({ startMs: cursorMs, endMs: clipEndMs });
  }

  const sourceSegments = retainedSegments
    .filter((segment) => segment.endMs > segment.startMs)
    .slice(0, MAX_SMART_SLICE_SOURCE_SEGMENTS + 1);
  if (sourceSegments.length <= 1 || sourceSegments.length > MAX_SMART_SLICE_SOURCE_SEGMENTS) {
    return [];
  }

  const retainedDurationMs = sourceSegments.reduce(
    (totalDurationMs, segment) => totalDurationMs + Math.max(0, segment.endMs - segment.startMs),
    0,
  );
  if (clipEndMs - clipStartMs - retainedDurationMs < MIN_SMART_SLICE_INTERNAL_SILENCE_TRIM_MS) {
    return [];
  }

  return sourceSegments;
}

export function createSmartSliceTranscriptAudioMuteRanges(
  clipStartMs: number,
  clipEndMs: number,
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
): SmartSliceTranscriptAudioMuteRange[] {
  if (!Number.isFinite(clipStartMs) || !Number.isFinite(clipEndMs) || clipEndMs <= clipStartMs) {
    return [];
  }

  const muteRanges: SmartSliceTranscriptAudioMuteRange[] = [];
  const normalizedClipStartMs = Math.max(0, Math.round(clipStartMs));
  const normalizedClipEndMs = Math.max(normalizedClipStartMs, Math.round(clipEndMs));
  for (const segment of transcriptSegments) {
    if (!Number.isFinite(segment.startMs) || !Number.isFinite(segment.endMs)) {
      continue;
    }

    const segmentStartMs = Math.max(normalizedClipStartMs, Math.round(segment.startMs));
    const segmentEndMs = Math.min(normalizedClipEndMs, Math.round(segment.endMs));
    const durationMs = segmentEndMs - segmentStartMs;
    if (durationMs <= 0 || durationMs > MAX_SMART_SLICE_AUDIO_MUTE_RANGE_MS) {
      continue;
    }

    if (normalizeSmartSliceTranscriptEvidenceText(segment.text).length === 0) {
      muteRanges.push({ startMs: segmentStartMs, endMs: segmentEndMs });
    }
  }

  return mergeSmartSliceTranscriptAudioMuteRanges(muteRanges).filter(
    (range) => range.endMs - range.startMs <= MAX_SMART_SLICE_AUDIO_MUTE_RANGE_MS,
  );
}

function mergeSmartSliceTranscriptAudioMuteRanges(
  ranges: readonly SmartSliceTranscriptAudioMuteRange[],
) {
  const sortedRanges = ranges.slice().sort((firstRange, secondRange) =>
    firstRange.startMs - secondRange.startMs ||
      firstRange.endMs - secondRange.endMs,
  );
  const mergedRanges: SmartSliceTranscriptAudioMuteRange[] = [];

  for (const range of sortedRanges) {
    const previousRange = mergedRanges.at(-1);
    if (!previousRange || range.startMs > previousRange.endMs) {
      mergedRanges.push({ ...range });
      continue;
    }

    previousRange.endMs = Math.max(previousRange.endMs, range.endMs);
  }

  return mergedRanges;
}

function isLowInformationTranscriptFillerSegment(text: string) {
  return isLowInformationAutoCutTranscriptEvidenceText(text);
}

function normalizeTranscriptFragmentText(text: string) {
  return normalizeTranscriptSegmentTextForPlanning(text)
    .replace(/[\s,;:.!?，。！？；：、]+/gu, '')
    .toLowerCase();
}

function isRepeatedTranscriptFragmentNoise(
  segments: readonly AutoCutSpeechTranscriptionSegment[],
  index: number,
) {
  const segment = segments[index];
  const previousSegment = segments[index - 1];
  const nextSegment = segments[index + 1];
  if (!segment || !previousSegment || !nextSegment) {
    return false;
  }

  const fragmentText = normalizeTranscriptFragmentText(segment.text);
  if (!fragmentText) {
    return false;
  }

  const fragmentLength = Array.from(fragmentText).length;
  if (fragmentLength > 4) {
    return false;
  }

  const previousText = normalizeTranscriptFragmentText(previousSegment.text);
  const nextText = normalizeTranscriptFragmentText(nextSegment.text);
  return previousText.length >= fragmentLength * 3 &&
    nextText.length >= fragmentLength * 3 &&
    previousText.includes(fragmentText) &&
    nextText.includes(fragmentText);
}

function normalizeTranscriptSegments(
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
): TranscriptPlanningSegment[] {
  const normalizedSegments = normalizeSmartSliceTranscriptSegmentsForPlanning(transcriptSegments
    .map((segment) => ({
      ...segment,
      text: normalizeTranscriptSegmentTextForPlanning(segment.text),
    })));
  const speechSegments: TranscriptPlanningSegment[] = [];
  let pendingNoiseBridgeDurationMs = 0;
  let pendingNoiseBridgeEndMs: number | undefined;

  for (let index = 0; index < normalizedSegments.length; index += 1) {
    const segment = normalizedSegments[index];
    if (!segment) {
      continue;
    }

    if (
      !segment.text ||
      isLowInformationTranscriptFillerSegment(segment.text) ||
      isRepeatedTranscriptFragmentNoise(normalizedSegments, index)
    ) {
      const bridgeStartMs = pendingNoiseBridgeEndMs === undefined
        ? segment.startMs
        : Math.max(segment.startMs, pendingNoiseBridgeEndMs);
      pendingNoiseBridgeDurationMs += Math.max(0, segment.endMs - bridgeStartMs);
      pendingNoiseBridgeEndMs = pendingNoiseBridgeEndMs === undefined
        ? segment.endMs
        : Math.max(pendingNoiseBridgeEndMs, segment.endMs);
      continue;
    }

    const previousSpeechSegment = speechSegments.at(-1);
    const noiseBridgeBeforeMs = previousSpeechSegment ? pendingNoiseBridgeDurationMs : 0;
    speechSegments.push({
      ...segment,
      ...(noiseBridgeBeforeMs > 0 ? { noiseBridgeBeforeMs } : {}),
    });
    pendingNoiseBridgeDurationMs = 0;
    pendingNoiseBridgeEndMs = undefined;
  }

  return speechSegments;
}

function canJoinTranscriptSegments(
  current: TranscriptPlanningSegment,
  next: TranscriptPlanningSegment,
  policy: VideoSlicePlanningPolicy,
) {
  const gapMs = next.startMs - current.endMs;
  const noiseBridgeBeforeMs = next.noiseBridgeBeforeMs ?? 0;
  const effectiveGapMs = noiseBridgeBeforeMs > MAX_TRANSCRIPT_NOISE_BRIDGE_MS
    ? gapMs
    : Math.max(0, gapMs - noiseBridgeBeforeMs);
  return gapMs >= -policy.continuityOverlapToleranceMs && effectiveGapMs <= policy.continuityJoinGapMs;
}

function canBridgeTranscriptSegmentsWithSilenceCompaction(
  current: TranscriptPlanningSegment,
  next: TranscriptPlanningSegment,
  policy: VideoSlicePlanningPolicy,
) {
  const gapMs = next.startMs - current.endMs;
  const noiseBridgeBeforeMs = next.noiseBridgeBeforeMs ?? 0;
  if (noiseBridgeBeforeMs > 0) {
    return false;
  }

  return gapMs >= -policy.continuityOverlapToleranceMs &&
    gapMs <= MAX_TRANSCRIPT_SILENCE_COMPACTION_BRIDGE_MS;
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
  if (speechDurationMs > maxDurationMs) {
    return undefined;
  }
  if (policy.sourceDurationMs !== undefined && speechEndMs > policy.sourceDurationMs) {
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
  if (endMs - startMs < MIN_TRANSCRIPT_ALIGNED_SLICE_DURATION_MS) {
    return undefined;
  }

  const maxDurationEndMs = startMs + maxDurationMs;
  if (endMs > maxDurationEndMs) {
    if (speechEndMs > maxDurationEndMs) {
      return undefined;
    }
    endMs = maxDurationEndMs;
  }
  if (policy.sourceDurationMs !== undefined && endMs > policy.sourceDurationMs) {
    if (speechEndMs > policy.sourceDurationMs) {
      return undefined;
    }
    endMs = policy.sourceDurationMs;
    const sourceBoundedStartMs = Math.max(
      0,
      Math.min(startMs, endMs - MIN_TRANSCRIPT_ALIGNED_SLICE_DURATION_MS),
    );
    const previousSpeechBoundaryMs = previousSegment ? previousSegment.endMs : 0;
    if (sourceBoundedStartMs < previousSpeechBoundaryMs) {
      return undefined;
    }
    startMs = sourceBoundedStartMs;
  }

  if (endMs - startMs < MIN_TRANSCRIPT_ALIGNED_SLICE_DURATION_MS) {
    return undefined;
  }

  const renderDurationMs = endMs - startMs;
  if (speechDurationMs / renderDurationMs < MIN_TRANSCRIPT_RENDER_SPEECH_COVERAGE_SCORE) {
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

function createSilenceCompactedTranscriptBoundaryTiming(
  segments: readonly TranscriptPlanningSegment[],
  startIndex: number,
  endIndex: number,
  policy: VideoSlicePlanningPolicy,
  maxDurationMs: number,
) {
  const timing = createTranscriptBoundaryTiming(segments, startIndex, endIndex, policy, maxDurationMs);
  if (!timing) {
    return undefined;
  }

  const candidateSegments = segments.slice(startIndex, endIndex + 1);
  const sourceSegments = createSmartSliceSpeechSourceSegments(timing, candidateSegments);
  if (sourceSegments.length <= 1) {
    return undefined;
  }

  const renderedDurationMs = sourceSegments.reduce(
    (durationMs, segment) => durationMs + Math.max(0, segment.endMs - segment.startMs),
    0,
  );
  if (renderedDurationMs <= 0 || renderedDurationMs > maxDurationMs) {
    return undefined;
  }

  const sourceStartMs = sourceSegments[0]?.startMs ?? timing.startMs;
  const sourceEndMs = sourceSegments.at(-1)?.endMs ?? timing.endMs;
  const removedSilenceMs = Math.max(0, sourceEndMs - sourceStartMs - renderedDurationMs);
  if (removedSilenceMs <= 0) {
    return undefined;
  }

  return {
    ...timing,
    startMs: sourceStartMs,
    endMs: sourceEndMs,
    durationMs: sourceEndMs - sourceStartMs,
    sourceSegments,
    renderedDurationMs,
    removedSilenceMs,
    internalSilenceTrimCount: sourceSegments.length - 1,
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
  '\u806a\u660e\u7684',
  '\u9ad8\u8ba4\u77e5',
  '\u60f3\u518d\u53bb',
  '\u60f3\u957f\u671f',
  '\u518d\u53bb\u7f8e\u56fd',
  '\u957f\u671f\u5728\u7f8e\u56fd',
  '\u5934\u7b49\u8231',
  '\u901a\u5411\u7f8e\u56fd',
  '\u5f88\u591a\u4eba\u89c9\u5f97',
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
  '\u8bbf\u5b66',
  '\u6211\u505a',
  '\u5e2e\u52a9',
  '\u884c\u4e1a\u7ecf\u9a8c',
  '\u53ea\u8981',
  '\u4ed6\u4eec\u4f1a\u7528',
  '\u8def\u5f84',
  '\u5f88\u591a\u4eba\u89c9\u5f97',
  '\u6211\u544a\u8bc9\u4f60',
  '\u7ed9\u81ea\u5df1',
  '\u7ed9\u5bb6\u4eba',
  '\u957f\u671f',
  '\u7559\u8db3',
  '\u56fd\u5185',
  '\u9ad8\u8ba4\u77e5',
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
  '\u5c31\u80fd',
  '\u80fd\u7533\u8bf7',
  '\u6700\u5feb',
  '\u5408\u6cd5\u5165\u5883',
  '\u5408\u6cd5',
  '\u91cd\u56de',
  '\u8f7b\u677e\u81ea\u5728',
  '\u7559\u8db3',
  '\u5165\u573a\u5238',
  '\u5934\u7b49\u8231',
] as const;

const CHINESE_RESULT_PAYOFF_MARKER = '\u7ed3\u679c';
const CHINESE_STRONG_PAYOFF_MARKERS = CHINESE_PAYOFF_MARKERS.filter((marker) =>
  marker !== CHINESE_RESULT_PAYOFF_MARKER
);

function includesAnyMarker(text: string, markers: readonly string[]) {
  return markers.some((marker) => text.includes(marker));
}

function includesChinesePayoffMarker(text: string) {
  const normalizedText = text.trim();
  if (includesAnyMarker(normalizedText, CHINESE_STRONG_PAYOFF_MARKERS)) {
    return true;
  }

  if (!normalizedText.includes(CHINESE_RESULT_PAYOFF_MARKER)) {
    return false;
  }

  if (/(?:\u9690\u85cf|\u85cf\u4f4f|\u770b\u4e0d\u89c1|\u770b\u4e0d\u5230|\u770b\u4e0d\u6e05|\u906e\u4f4f|\u6321\u4f4f|\u6ca1\u6709\u770b\u5230|\u627e\u4e0d\u5230)\u7ed3\u679c/u.test(normalizedText)) {
    return false;
  }

  return /(?:\u6240\u4ee5|\u56e0\u6b64|\u6700\u540e|\u8fd9\u6837|\u7ed3\u8bba|\u7b54\u6848|\u529e\u6cd5|\u65b9\u6848|\u4fee\u590d|\u89e3\u51b3)[^\u3002\uff01\uff1f\uff1b\uff0c]{0,18}\u7ed3\u679c/u.test(normalizedText) ||
    /\u7ed3\u679c(?:\u662f|\u5c31\u662f|\u4f1a|\u80fd|\u53ef\u4ee5|\u80fd\u591f|\u8ba9|\u53d8\u6210|\u51fa\u6765|\u51fa\u73b0|\u63d0\u5347|\u6539\u5584|\u66f4\u597d|\u66f4\u6e05\u695a)/u.test(normalizedText) ||
    /(?:\u5c55\u793a|\u7ed9\u51fa|\u5448\u73b0|\u770b\u5230|\u770b\u89c1|\u516c\u5e03|\u8bf4\u660e)\u7ed3\u679c/u.test(normalizedText);
}

function includesEnglishPayoffMarker(text: string) {
  const normalizedText = text.toLowerCase().trim();
  if (
    /\b(?:so|therefore|finally)\b[^.!?]{0,64}\b(?:fix|solution|answer|takeaway|payoff|outcome|result|works|improves?|improved|resolve|resolves|resolved)\b/.test(normalizedText) ||
    /\b(?:the\s+)?(?:fix|solution|answer|takeaway|payoff|outcome|result)\s+(?:is|are|comes|starts|ends|works|improves?|improved|resolves?|resolved)\b/.test(normalizedText)
  ) {
    return true;
  }

  if (
    /\b(?:without|no|not|never|missing|lacks?|lack|does not|doesn't|cannot|can't)\b[^.!?]{0,48}\b(?:payoff|result|outcome|answer|solution|fix|takeaway)\b/.test(normalizedText)
  ) {
    return false;
  }

  if (
    /\b(so|therefore|fix|solution|finally|lesson|answer|works|improves?|improved|outcome|resolve|resolves|resolved|do this|you should|payoff|takeaway)\b/.test(normalizedText)
  ) {
    return true;
  }

  return /\b(show|shows|showing|lead|leads|leading|name|names|naming|package|packages|packaging|start|starts|starting|finish|finishes|finishing|prove|proves|proving)\b[^.!?]{0,48}\b(result|outcome|payoff|takeaway)\b/.test(normalizedText);
}

function stripTrailingSentencePunctuation(text: string) {
  return text.trim().replace(/[.,;:!?\u3002\uff0c\uff1b\uff1a\uff01\uff1f\u2026]+$/u, '').trim();
}

function stripLeadingWeakConnector(text: string) {
  const trimmedText = text.trim();
  if (ENGLISH_ORDINAL_ONLY_CONTENT_SECTION_OPENING_PATTERN.test(trimmedText.toLowerCase())) {
    return trimmedText;
  }

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

function normalizeTranscriptSliceLabelText(text: string, fallback: string) {
  const normalizedText = text
    .trim()
    .replace(/\s+/gu, ' ')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .trim();

  return /[\p{L}\p{N}]/u.test(normalizedText) ? normalizedText.slice(0, 48) : fallback;
}

function looksLikeCorruptedTranscriptEncoding(text: string) {
  return /[\u00c0-\u00ff\ufffd]/u.test(text) ||
    /[閹鐒鍏鎵绋娑灞偓儴绻柌倸鎮庡灇崇暚佸鐓憴鍡涱暥]/u.test(text);
}

function startsWithWeakConnector(text: string) {
  const trimmedText = text.trim();
  if (hasExplicitContentSectionOpening(trimmedText)) {
    return false;
  }

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
    return isChineseTranscriptSentenceExplicitlyOpen(trimmedText);
  }

  if (/[^\x20-\x7E]/u.test(trimmedText)) {
    return false;
  }

  return /^[\x20-\x7E]+$/u.test(trimmedText) && !endsWithTerminalPunctuation(trimmedText);
}

function isChineseTranscriptSentenceExplicitlyOpen(text: string) {
  const normalizedText = stripTrailingSentencePunctuation(text.trim());
  if (!normalizedText || endsWithTerminalPunctuation(normalizedText)) {
    return false;
  }

  if (endsWithWeakConnector(normalizedText)) {
    return true;
  }

  return /(?:还没(?:有)?|没有|未).{0,18}(?:说完|讲完|讲清楚|讲明白|解释完|交代完|完成|结束)$/u.test(normalizedText) ||
    /(?:需要|要|应该|可以|能够|能|会|才|就|再|继续|接着|进入|开始|准备|为了|用来|帮你|让你|给你|把|将|包括|比如|如果|当|只要|除非|因为|所以|但是|不过|而且|同时|然后|以及|或者)$/u.test(normalizedText);
}

function createTranscriptSliceLabel(segments: readonly AutoCutSpeechTranscriptionSegment[], anchorIndex: number) {
  const anchorText = segments[anchorIndex]?.text.trim() ?? '';
  const fallbackLabel = createPlannerSliceLabel(anchorIndex);
  const strippedAnchorText = stripLeadingWeakConnector(anchorText);
  if (strippedAnchorText !== anchorText) {
    return normalizeTranscriptSliceLabelText(strippedAnchorText || anchorText, fallbackLabel);
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

function splitTranscriptTextAtInlineContentOpenings(text: string) {
  const matches = [
    ...Array.from(text.matchAll(ENGLISH_INLINE_CONTENT_SECTION_OPENING_PATTERN)),
    ...Array.from(text.matchAll(CHINESE_INLINE_CONTENT_SECTION_OPENING_PATTERN)),
  ]
    .filter((match) =>
      typeof match.index === 'number' &&
      isInlineContentOpeningBoundary(text, match.index)
    );
  matches.sort((firstMatch, secondMatch) => (firstMatch.index ?? 0) - (secondMatch.index ?? 0));
  if (matches.length <= 1) {
    return [text];
  }

  const parts: string[] = [];
  for (let matchIndex = 0; matchIndex < matches.length; matchIndex += 1) {
    const match = matches[matchIndex];
    const nextMatch = matches[matchIndex + 1];
    const startIndex = match?.index ?? 0;
    const endIndex = nextMatch?.index ?? text.length;
    const rawPart = text.slice(startIndex, endIndex).trim();
    const part = rawPart && !endsWithTerminalPunctuation(rawPart) ? `${rawPart}.` : rawPart;
    if (part) {
      parts.push(part);
    }
  }

  const leadingText = text.slice(0, matches[0]?.index ?? 0).trim();
  return leadingText ? [leadingText, ...parts] : parts;
}

function isInlineContentOpeningBoundary(text: string, matchIndex: number) {
  if (matchIndex <= 0) {
    return true;
  }

  const previousText = text.slice(0, matchIndex).trimEnd();
  if (!previousText) {
    return true;
  }

  if (/[.!?\u3002\uff01\uff1f\u2026\n\r]$/u.test(previousText)) {
    return true;
  }

  return /\b(?:improves?|improved|works|resolved|resolve|completion|conversion|confidence|signups?|retention|payoff|answer|takeaway)\s*$/iu.test(previousText) ||
    /(?:提升|改善|解决|完成|转化|信心|答案|结果|完播|下降|减少|降低|修复|变好|更清楚)\s*$/u.test(previousText);
}

function splitTranscriptSentences(text: string) {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return [];
  }
  const protectedNoDotText = normalizedText.replace(/\bNo\.\s+(?=\d+\b)/giu, 'No ');

  const punctuationDelimitedSentences = protectedNoDotText.match(
    /[^.!?\u3002\uff01\uff1f\u2026\n\r]+(?:[.!?\u3002\uff01\uff1f\u2026]+|(?=[\n\r]|$))/gu,
  ) ?? [protectedNoDotText];

  return punctuationDelimitedSentences
    .flatMap((sentence) =>
      sentence
        .split(/[\n\r]+|(?=(?:Why|How|What|When)\b)/u)
    )
    .flatMap((sentence) => splitTranscriptTextAtInlineContentOpenings(sentence))
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
    hasExplicitContentSectionOpening(firstSentence) ||
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
    includesChinesePayoffMarker(normalizedLastSentence) ||
    includesEnglishPayoffMarker(normalizedLastSentence)
  ) {
    return 'complete';
  }

  if (includesChinesePayoffMarker(normalizedText) || includesEnglishPayoffMarker(normalizedText)) {
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
    hasExplicitContentSectionOpening(text) ||
    /\b(why|how|what|when|secret|mistake|opening|watch|watching|attention|important|matters?|key|tip|seconds?|scroll|starts?\s+with|keep\s+watching)\b/.test(normalizedText) ||
    /[?\uff1f]/u.test(text)
  ) {
    addStage('hook');
  }

  if (
    includesAnyMarker(normalizedText, CHINESE_CONTEXT_MARKERS) ||
    /\b(because|case|example|first|second|context|reason|means|shows|happened|launch|background|scenario|setup|workflow|funnel|queue|analytics|packaging|convert|converts|converted|represent|represents|representation|representations|layer|retrieval|system|systems|measure|measures|measured|ranking|rank|ranks|compare|compares|concept|concepts|document|documents|chunk|chunks|chunking|indexed|metadata|pipeline)\b/.test(normalizedText)
  ) {
    addStage('setup');
  }

  if (
    includesAnyMarker(normalizedText, [
      '\u95ee\u9898',
      '\u75db\u70b9',
      '\u4e0d\u591f',
      '\u5931\u8d25',
      '\u4e0d\u77e5\u9053',
      '\u56f0\u96be',
      '\u4e0b\u964d',
      '\u9690\u85cf',
      '\u770b\u4e0d\u5230',
      '\u770b\u4e0d\u6e05',
      '\u5361\u4f4f',
      '\u4e0d\u6324',
      '\u4e0d\u4f1a\u518d',
      '\u522b\u53bb',
      '\u5e7b\u60f3',
      '\u82e6\u903c',
      '\u5de5\u94b1',
      '\u653e\u5f03',
      '\u8d4c\u4e00\u628a',
      '\u4e0d\u780d',
    ]) ||
    /\b(problem|pain|mistake|risk|tradeoff|conflict|blocks?|blocked|blocking|unsafe|unclear|unresolved|difficult|fails?|failure|drops?|leaves?|left|missing|stale|spikes?|hidden|hides?|overlaps?|overlapping|overlapped|out[-\s]?of[-\s]?order|before people scroll|should care)\b/.test(normalizedText)
  ) {
    addStage('conflict');
  }

  if (
    includesChinesePayoffMarker(normalizedText) ||
    includesEnglishPayoffMarker(normalizedText)
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
  'index',
  'how',
  'into',
  'compare',
  'concept',
  'next',
  'not',
  'one',
  'people',
  'passage',
  'prove',
  'related',
  'section',
  'should',
  'source',
  'that',
  'the',
  'they',
  'then',
  'this',
  'through',
  'uses',
  'vector',
  'when',
  'why',
  'with',
  'you',
  'your',
]);

const TOPIC_SEMANTIC_TOKEN_MAP: ReadonlyMap<string, string> = new Map([
  ['embeddings', 'embedding'],
  ['embedding', 'embedding'],
  ['tokens', 'token'],
  ['vectors', 'embedding'],
  ['vector', 'embedding'],
  ['representations', 'representation'],
  ['semantic', 'meaning'],
  ['meanings', 'meaning'],
  ['keywords', 'keyword'],
  ['chunks', 'chunk'],
  ['chunking', 'chunk'],
  ['overlaps', 'chunk'],
  ['overlap', 'chunk'],
  ['boundary', 'chunk'],
  ['boundaries', 'chunk'],
]);

const TOPIC_KEYWORD_GROUPS = [
  ['opening', 'viewer', 'viewers', 'pain', 'retention', 'scroll', 'hook', 'result', 'fix', 'lead'],
  ['case', 'background', 'spike', 'user', 'pain', 'payoff', 'complete', 'short-video', 'watch'],
  ['pricing', 'price', 'invoice', 'invoices', 'refund', 'terms', 'annual', 'model'],
  ['launch', 'implementation', 'details', 'tradeoff', 'tradeoffs'],
  ['背景', '案例', '原因', '用户', '痛点', '爆发', '适合', '完整', '短视频', '完播', '开头', '问题', '场景', '结果', '例子', '解决', '办法'],
  ['美国', '留学', '海归', '访学', '签证', '路径', '申请', '行业经验', '家人', '合法', '入境', '生活', '发展', '入场券'],
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
  '美国',
  '留学',
  '海归',
  '访学',
  '签证',
  '路径',
  '申请',
  '行业经验',
  '家人',
  '自己',
  '国内',
  '高认知',
  '合法',
  '入境',
  '长期',
  '生活',
  '留足',
  '发展',
  '入场券',
] as const;

const NON_PUBLISHABILITY_PENALTY_RISKS = new Set([
  CONTENT_TOPIC_SEGMENT_RISK,
  'connector-repaired',
  'trailing-connector-extended',
  'open-sentence-extended',
  'transcript-repeat-filtered',
  'transcript-overlap-repaired',
  'transcript-noise-bridge-repaired',
  'sparse-transcript-speech',
  'short-transcript-window',
  'llm-timing-snapped-to-transcript',
  'timing-metadata-repaired',
]);

function hasTranscriptSegmentOverlapRepair(
  segments: readonly AutoCutSpeechTranscriptionSegment[],
  policy: VideoSlicePlanningPolicy,
) {
  return segments.some((segment, index) => {
    const previousSegment = segments[index - 1];
    if (!previousSegment) {
      return false;
    }

    const gapMs = segment.startMs - previousSegment.endMs;
    return gapMs < 0 && gapMs >= -policy.continuityOverlapToleranceMs;
  });
}

function extractTopicKeywords(text: string) {
  const englishKeywords = Array.from(text.toLowerCase().matchAll(/\b[a-z][a-z0-9-]{3,}\b/g))
    .map((match) => {
      const exactToken = TOPIC_SEMANTIC_TOKEN_MAP.get(match[0]);
      if (exactToken) {
        return exactToken;
      }
      const normalizedToken = match[0].replace(/ies$/u, 'y').replace(/(?:ed|es|s)$/u, '');
      return TOPIC_SEMANTIC_TOKEN_MAP.get(normalizedToken) ?? normalizedToken;
    })
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

function hasSemanticTopicContinuationBridge(firstText: string, secondText: string) {
  const normalizedFirstText = firstText.toLowerCase();
  const normalizedSecondText = secondText.toLowerCase();
  const firstStages = inferContentArcStages(firstText);
  const secondStages = inferContentArcStages(secondText);
  const mergedStageSet = new Set([...firstStages, ...secondStages]);
  const firstIsUnresolvedHook =
    firstStages.includes('hook') &&
    !firstStages.includes('payoff') &&
    /\b(?:why|how|what|when)\b/.test(normalizedFirstText);
  const secondExplainsHook =
    secondStages.includes('setup') &&
    /\b(?:because|reason|means|shows|happened|scenario|context)\b/.test(normalizedSecondText);
  const firstLeavesOpenProblem =
    firstStages.includes('conflict') &&
    !firstStages.includes('payoff') &&
    /\b(problem|pain|drops?|hidden|unclear|risk|mistake|conflict|do not understand|context)\b/.test(normalizedFirstText);
  const secondResolvesOrIllustrates =
    secondStages.includes('payoff') &&
    /\b(so|therefore|example|case|fix|solution|result|outcome|completion|improves?|improved|resolve|resolves|resolved|conversion|decision|confidence|moment|calibration|payoff|answer)\b/.test(normalizedSecondText);
  const chineseConditionToPayoff =
    /(?:只要|行业经验|能申请|可以申请|申请条件)/u.test(firstText) &&
    /(?:最快|三个月|就能|带着家人|合法|入境|重回|生活|长期)/u.test(secondText);
  const chineseBenefitContinuation =
    /(?:最快|三个月|带着家人|合法|入境|重回|生活|长期)/u.test(firstText) &&
    /(?:最快|三个月|带着家人|合法|入境|重回|生活|长期|发展)/u.test(secondText);
  const chineseOptionContinuation =
    /(?:留足|发展|国内|赌一把|高认知|入场券)/u.test(firstText) &&
    /(?:留足|发展|国内|赌一把|高认知|入场券|拿一张)/u.test(secondText);

  return (
    chineseConditionToPayoff ||
      chineseBenefitContinuation ||
      chineseOptionContinuation ||
      (
    firstIsUnresolvedHook &&
      secondExplainsHook &&
      !secondStages.includes('hook')
      )
  ) ||
    (
      CONTENT_ARC_STAGES.every((stage) => mergedStageSet.has(stage)) &&
      firstLeavesOpenProblem &&
      secondResolvesOrIllustrates
    );
}

function calculateSegmentTopicBoundaryScore(
  previousText: string,
  currentText: string,
) {
  const previousKeywords = extractTopicKeywords(previousText);
  const currentKeywords = extractTopicKeywords(currentText);
  const directSimilarity = calculateKeywordSimilarity(previousKeywords, currentKeywords);
  const sharedTopicGroup = hasSharedTopicGroup(previousKeywords, currentKeywords);
  const semanticContinuationBridge = hasSemanticTopicContinuationBridge(previousText, currentText);

  return directSimilarity > 0 || sharedTopicGroup || semanticContinuationBridge
    ? Math.max(directSimilarity, 0.55)
    : directSimilarity;
}

function calculateRawTopicSimilarityFromTexts(firstText: string, secondText: string) {
  return calculateKeywordSimilarity(extractTopicKeywords(firstText), extractTopicKeywords(secondText));
}

function countSharedTopicKeywords(firstKeywords: readonly string[], secondKeywords: readonly string[]) {
  const secondKeywordSet = new Set(secondKeywords);
  return firstKeywords.filter((keyword) => secondKeywordSet.has(keyword)).length;
}

function extractLeadingTopicKeywords(text: string) {
  const leadingText = text.split(/[.;:!?\u3002\uff0c\uff1b\uff1a\uff01\uff1f]/u)[0] ?? text;
  return extractTopicKeywords(leadingText).slice(0, 2);
}

function hasFreshContentTopicOpening(
  currentKeywords: readonly string[],
  nextText: string,
) {
  const currentKeywordSet = new Set(currentKeywords);
  const leadingKeywords = extractLeadingTopicKeywords(nextText);
  return leadingKeywords.length > 0 &&
    leadingKeywords.every((keyword) => !currentKeywordSet.has(keyword));
}

function shouldStartNewContentTopicBlock(
  currentTopicTexts: readonly string[],
  nextText: string,
) {
  const currentTopicText = currentTopicTexts.join(' ');
  const currentKeywords = extractTopicKeywords(currentTopicText);
  const nextKeywords = extractTopicKeywords(nextText);
  const currentToNextSimilarity = calculateKeywordSimilarity(currentKeywords, nextKeywords);
  const lastTopicText = currentTopicTexts.at(-1) ?? currentTopicText;
  const lastToNextSimilarity = calculateRawTopicSimilarityFromTexts(lastTopicText, nextText);
  const sharedKeywordCount = countSharedTopicKeywords(currentKeywords, nextKeywords);
  const sharedTopicGroup = hasSharedTopicGroup(currentKeywords, nextKeywords);
  const semanticContinuationBridge = hasSemanticTopicContinuationBridge(lastTopicText, nextText);

  if (
    currentTopicTexts.length >= 1 &&
    isCompleteSemanticStoryText(currentTopicTexts) &&
    hasExplicitContentSectionOpening(nextText)
  ) {
    return true;
  }

  if (
    currentTopicTexts.length >= MIN_CONTENT_TOPIC_SEGMENT_COUNT &&
    hasFreshContentTopicOpening(currentKeywords, nextText) &&
    !semanticContinuationBridge
  ) {
    return true;
  }

  return sharedKeywordCount === 0 &&
    currentToNextSimilarity < 0.12 &&
    lastToNextSimilarity < 0.12 &&
    !sharedTopicGroup &&
    !semanticContinuationBridge;
}

function canFormFollowingContentTopicBlock(
  segments: readonly TranscriptPlanningSegment[],
  startIndex: number,
  policy: VideoSlicePlanningPolicy,
  maxDurationMs: number,
) {
  const startSegment = segments[startIndex];
  if (!startSegment) {
    return false;
  }

  let endIndex = startIndex;
  while (endIndex + 1 < segments.length && endIndex + 1 < startIndex + MAX_SEMANTIC_STORY_MERGE_SEGMENTS) {
    const currentSegment = segments[endIndex];
    const nextSegment = segments[endIndex + 1];
    if (!currentSegment || !nextSegment || !canJoinTranscriptSegments(currentSegment, nextSegment, policy)) {
      break;
    }
    const timing = createTranscriptBoundaryTiming(segments, startIndex, endIndex + 1, policy, maxDurationMs);
    if (!timing) {
      break;
    }
    endIndex += 1;
    if (endIndex >= startIndex + MIN_CONTENT_TOPIC_SEGMENT_COUNT - 1) {
      return true;
    }
  }

  return endIndex >= startIndex + MIN_CONTENT_TOPIC_SEGMENT_COUNT - 1;
}

function createTopicCoherenceMetadataFromTexts(texts: readonly string[]) {
  const joinedText = texts.join(' ');
  const segmentTopicSignals = texts
    .map((text) => ({
      text,
      keywords: extractTopicKeywords(text),
    }))
    .filter((signal) => signal.keywords.length > 0);
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

  if (segmentTopicSignals.length <= 1) {
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
  for (let index = 1; index < segmentTopicSignals.length; index += 1) {
    const previousSignal = segmentTopicSignals[index - 1];
    const currentSignal = segmentTopicSignals[index];
    if (!previousSignal || !currentSignal) {
      continue;
    }

    const sharedTopicGroup = hasSharedTopicGroup(previousSignal.keywords, currentSignal.keywords);
    const semanticContinuationBridge = hasSemanticTopicContinuationBridge(
      previousSignal.text,
      currentSignal.text,
    );
    const similarity = calculateSegmentTopicBoundaryScore(previousSignal.text, currentSignal.text);
    similaritySum += similarity;
    comparisonCount += 1;
    if (similarity < 0.12 && !sharedTopicGroup && !semanticContinuationBridge) {
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
  const isTopicSegment = isContentTopicSegmentCandidate(clip);
  const storyShapeScore = clip.storyShape === 'complete'
    ? 1
    : isTopicSegment
      ? 0.76
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
  const transcriptSegmentScore = typeof clip.transcriptSegmentCount === 'number' && clip.transcriptSegmentCount > 0
    ? 1
    : 0.2;
  const boundaryQualityScore = typeof clip.boundaryQualityScore === 'number'
    ? clip.boundaryQualityScore
    : 0.25;
  const contentArcScore = typeof clip.contentArcScore === 'number'
    ? isTopicSegment
      ? Math.max(0.72, clip.contentArcScore)
      : clip.contentArcScore
    : clip.storyShape === 'complete'
      ? 1
      : isTopicSegment
        ? 0.72
      : clip.storyShape === 'contextOnly'
        ? 0.5
        : clip.storyShape === 'setupOnly' || clip.storyShape === 'payoffOnly'
          ? 0.5
          : 0.25;
  const topicCoherenceScore = typeof clip.topicCoherenceScore === 'number'
    ? clip.topicCoherenceScore
    : 0.6;
  const riskCount = Array.isArray(clip.risks)
    ? clip.risks.filter((risk) => !NON_PUBLISHABILITY_PENALTY_RISKS.has(risk)).length
    : 0;
  const riskPenalty = Math.min(0.2, riskCount * 0.04);
  const publishabilityScore = clampSlicePlannerScore(
    qualityScore * 0.19 +
      continuityScore * 0.17 +
      storyShapeScore * 0.13 +
      transcriptCoverageScore * 0.12 +
      speechScore * 0.12 +
      transcriptSegmentScore * 0.04 +
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
    !isTopicSegment && clip.storyShape && clip.storyShape !== 'complete'
      ? createStoryShapeRisks(clip.storyShape)
      : undefined,
    !isTopicSegment && clip.contentArcMissingStages?.length
      ? createContentArcRisks(clip.contentArcMissingStages)
      : undefined,
    clip.topicCoherenceGrade === 'weak' || (clip.topicShiftCount ?? 0) > 0 ? ['topic-drift'] : undefined,
    !isTopicSegment && clip.hookStrength === 'weak' ? ['weak-hook'] : undefined,
    !isTopicSegment && clip.endingCompleteness === 'open' ? ['open-ending'] : undefined,
    clip.speechContinuityGrade === 'weak' ? ['weak-speech-continuity'] : undefined,
    clip.sentenceBoundaryIntegrityGrade === 'broken' ? ['broken-sentence-boundary'] : undefined,
    clip.sentenceBoundaryIssues?.some((issue) => issue.endsWith('-unrepaired'))
      ? ['unrepaired-sentence-boundary']
      : undefined,
    transcriptCoverageScore < 0.65 ? ['low-transcript-coverage'] : undefined,
    typeof clip.transcriptSegmentCount === 'number' && clip.transcriptSegmentCount <= 0 ? ['no-transcript-segments'] : undefined,
  ) ?? [];
  const normalizedIssues = isTopicSegment ? normalizeContentTopicSegmentRisks(issues) : issues;

  return {
    publishabilityScore,
    publishabilityGrade,
    publishabilityIssues: normalizedIssues,
  } satisfies Pick<NormalizedSlicePlanClip, 'publishabilityScore' | 'publishabilityGrade' | 'publishabilityIssues'>;
}

function createPlatformReadinessMetadata(
  clip: Partial<NormalizedSlicePlanClip>,
  policy: VideoSlicePlanningPolicy,
) {
  const platformProfile = SLICE_PLATFORM_PROFILES[policy.targetPlatform] ?? SLICE_PLATFORM_PROFILES.generic;
  const isTopicSegment = isContentTopicSegmentCandidate(clip);
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
    ? isTopicSegment
      ? Math.max(0.72, clip.contentArcScore)
      : clip.contentArcScore
    : clip.storyShape === 'complete'
      ? 1
      : isTopicSegment
        ? 0.72
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
    : isTopicSegment
      ? 0.74
    : clip.hookStrength === 'contextual'
      ? 0.68
      : 0.18;
  const endingScore = clip.endingCompleteness === 'complete'
    ? 1
    : isTopicSegment
      ? 0.74
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
  if (!isTopicSegment && platformProfile.requireStrongHook && clip.hookStrength !== 'strong') {
    issueGroups.push(['platform-hook-not-strong']);
  } else if (!isTopicSegment && clip.hookStrength === 'weak') {
    issueGroups.push(['platform-weak-hook']);
  }
  if (!isTopicSegment && clip.endingCompleteness === 'open') {
    issueGroups.push(['platform-open-ending']);
  }
  if (clip.sentenceBoundaryIntegrityGrade === 'broken' && clip.sentenceBoundaryIssues?.some((issue) => issue.endsWith('-unrepaired'))) {
    issueGroups.push(['platform-broken-sentence-boundary']);
  }
  if (!isTopicSegment && clip.contentArcGrade !== 'complete') {
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
  const hasSparseTranscriptReviewEvidence =
    isSparseTranscriptReviewClip(clip) &&
    !normalizedIssues.includes('platform-duration-reject');
  const hasRecoverableTranscriptBoundary =
    clip.sentenceBoundaryIntegrityGrade === 'broken' &&
    normalizedIssues.includes('platform-broken-sentence-boundary') &&
    typeof clip.transcriptText === 'string' &&
    clip.transcriptText.trim().length > 0 &&
    typeof clip.transcriptCoverageScore === 'number' &&
    clip.transcriptCoverageScore >= MIN_TRANSCRIPT_RENDER_SPEECH_COVERAGE_SCORE &&
    (clip.transcriptSegmentCount ?? 0) >= MIN_CONTENT_TOPIC_SEGMENT_COUNT &&
    (clip.speechContinuityGrade === 'strong' || clip.speechContinuityGrade === 'repaired') &&
    clip.endingCompleteness !== 'open' &&
    clip.topicCoherenceGrade !== 'weak' &&
    (clip.storyShape === 'complete' || clip.contentArcGrade === 'complete');
  const rawPlatformReadinessGrade: SlicePlatformReadinessGrade =
    normalizedIssues.includes('platform-duration-reject') ||
    platformReadinessScore < platformProfile.rejectScoreThreshold ||
    (!isTopicSegment && clip.endingCompleteness === 'open') ||
    (!isTopicSegment && clip.hookStrength === 'weak') ||
    (clip.sentenceBoundaryIntegrityGrade === 'broken' && normalizedIssues.includes('platform-broken-sentence-boundary'))
      ? 'reject'
      : platformReadinessScore >= platformProfile.readyScoreThreshold && normalizedIssues.length === 0
        ? 'ready'
        : 'review';
  const platformReadinessGrade: SlicePlatformReadinessGrade =
    rawPlatformReadinessGrade === 'reject' && (hasSparseTranscriptReviewEvidence || hasRecoverableTranscriptBoundary)
      ? 'review'
      : rawPlatformReadinessGrade;

  return {
    platformReadinessScore,
    platformReadinessGrade,
    platformReadinessIssues: normalizedIssues,
  } satisfies Pick<
    NormalizedSlicePlanClip,
    'platformReadinessScore' | 'platformReadinessGrade' | 'platformReadinessIssues'
  >;
}

function isSparseTranscriptReviewClip(clip: Partial<NormalizedSlicePlanClip>) {
  const risks = Array.isArray(clip.risks) ? clip.risks : [];
  const speechDurationMs =
    typeof clip.speechStartMs === 'number' &&
    typeof clip.speechEndMs === 'number' &&
    clip.speechEndMs > clip.speechStartMs
      ? clip.speechEndMs - clip.speechStartMs
      : 0;

  return (
    risks.includes('sparse-transcript-speech') &&
    typeof clip.transcriptText === 'string' &&
    clip.transcriptText.trim().length > 0 &&
    typeof clip.transcriptCoverageScore === 'number' &&
    clip.transcriptCoverageScore >= MIN_TRANSCRIPT_RENDER_SPEECH_COVERAGE_SCORE &&
    typeof clip.transcriptSegmentCount === 'number' &&
    clip.transcriptSegmentCount > 0 &&
    (clip.speechContinuityGrade === 'strong' || clip.speechContinuityGrade === 'repaired') &&
    speechDurationMs >= MIN_TRANSCRIPT_ALIGNED_SLICE_DURATION_MS &&
    (clip.boundaryPaddingBeforeMs ?? 0) <= TRANSCRIPT_BOUNDARY_PADDING_BEFORE_MS &&
    (clip.boundaryPaddingAfterMs ?? 0) <= TRANSCRIPT_BOUNDARY_PADDING_AFTER_MS
  );
}

function isIncompletePayoffSparseTranscriptReviewClip(clip: Partial<NormalizedSlicePlanClip>) {
  const stages = Array.isArray(clip.contentArcStages) ? clip.contentArcStages : [];
  return isSparseTranscriptReviewClip(clip) &&
    clip.contentArcGrade !== 'complete' &&
    (
      stages.includes('payoff') ||
      clip.storyShape === 'payoffOnly' ||
      (
        clip.endingCompleteness === 'complete' &&
        (clip.storyShape === 'contextOnly' || clip.contentArcGrade === 'partial')
      )
    );
}

function isTranscriptBackedReviewReleaseClip(clip: Partial<NormalizedSlicePlanClip>) {
  const risks = Array.isArray(clip.risks) ? clip.risks : [];
  const stages = Array.isArray(clip.contentArcStages) ? clip.contentArcStages : [];
  const hasRenderableTranscript =
    typeof clip.transcriptText === 'string' &&
    clip.transcriptText.trim().length > 0 &&
    typeof clip.transcriptCoverageScore === 'number' &&
    clip.transcriptCoverageScore >= MIN_TRANSCRIPT_RENDER_SPEECH_COVERAGE_SCORE &&
    typeof clip.transcriptSegmentCount === 'number' &&
    clip.transcriptSegmentCount >= MIN_CONTENT_TOPIC_SEGMENT_COUNT &&
    (clip.speechContinuityGrade === 'strong' || clip.speechContinuityGrade === 'repaired');
  const hasEnoughContentStructure =
    clip.storyShape === 'complete' ||
    clip.contentArcGrade === 'complete' ||
    (
      clip.topicCoherenceGrade === 'strong' &&
      stages.includes('setup') &&
      stages.includes('payoff') &&
      hasNonPayoffTopicContextEvidence(clip)
    );

  return hasRenderableTranscript &&
    hasEnoughContentStructure &&
    clip.publishabilityGrade !== 'reject' &&
    clip.platformReadinessGrade !== 'reject' &&
    clip.endingCompleteness !== 'open' &&
    clip.topicCoherenceGrade !== 'weak' &&
    !risks.includes('sparse-transcript-speech') &&
    !risks.includes('weak-hook') &&
    !risks.includes('weak-speech-continuity') &&
    !risks.includes('topic-drift') &&
    !risks.includes('transcript-internal-repeat') &&
    !isIsolatedPayoffFragmentCandidate(clip);
}

function isReleaseReadySliceCandidate(
  clip: Partial<NormalizedSlicePlanClip>,
  policy: VideoSlicePlanningPolicy,
) {
  const platformProfile = SLICE_PLATFORM_PROFILES[policy.targetPlatform] ?? SLICE_PLATFORM_PROFILES.generic;
  if (isContentTopicReleaseCandidate(clip, policy)) {
    return true;
  }

  return (
    clip.publishabilityGrade !== 'reject' &&
    clip.platformReadinessGrade !== 'reject' &&
    (clip.publishabilityScore ?? 0) >= platformProfile.readyScoreThreshold &&
    !clip.risks?.some((risk) =>
      risk === 'missing-payoff' ||
      risk === 'missing-hook' ||
      risk === 'missing-setup' ||
      risk === 'missing-content-hook' ||
      risk === 'missing-content-setup' ||
      risk === 'missing-content-conflict' ||
      risk === 'missing-content-payoff' ||
      risk === 'topic-drift' ||
      risk === 'weak-speech-continuity'
    )
  );
}

function hasBlockingContentRisk(clip: Partial<NormalizedSlicePlanClip>) {
  if (isContentTopicSegmentCandidate(clip)) {
    return clip.risks?.some((risk) =>
      risk === 'topic-drift' ||
      risk === 'weak-speech-continuity'
    ) === true;
  }

  return clip.risks?.some((risk) =>
    risk === 'missing-payoff' ||
    risk === 'missing-hook' ||
    risk === 'missing-setup' ||
    risk === 'missing-content-hook' ||
    risk === 'missing-content-setup' ||
    risk === 'missing-content-conflict' ||
    risk === 'missing-content-payoff' ||
    risk === 'topic-drift' ||
    risk === 'weak-speech-continuity'
  ) === true;
}

function isPreferredContentCandidate(
  clip: Partial<NormalizedSlicePlanClip>,
  policy: VideoSlicePlanningPolicy,
) {
  const platformProfile = SLICE_PLATFORM_PROFILES[policy.targetPlatform] ?? SLICE_PLATFORM_PROFILES.generic;
  if (isContentTopicReleaseCandidate(clip, policy)) {
    return true;
  }

  return (
    clip.publishabilityGrade !== 'reject' &&
    clip.platformReadinessGrade !== 'reject' &&
    (clip.publishabilityScore ?? 0) >= platformProfile.rejectScoreThreshold &&
    (clip.storyShape === 'complete' || clip.contentArcGrade === 'complete') &&
    clip.speechContinuityGrade !== 'weak' &&
    (clip.transcriptCoverageScore === undefined ||
      clip.transcriptCoverageScore >= MIN_TRANSCRIPT_RENDER_SPEECH_COVERAGE_SCORE) &&
    !hasBlockingContentRisk(clip)
  );
}

function isStrongContentDerivedSliceClip(
  clip: Partial<NormalizedSlicePlanClip>,
  policy: VideoSlicePlanningPolicy,
) {
  if (isContentTopicReleaseCandidate(clip, policy)) {
    return true;
  }

  return (
    isReleaseReadySliceCandidate(clip, policy) &&
    typeof clip.transcriptText === 'string' &&
    clip.transcriptText.trim().length > 0 &&
    typeof clip.transcriptCoverageScore === 'number' &&
    clip.transcriptCoverageScore >= MIN_TRANSCRIPT_RENDER_SPEECH_COVERAGE_SCORE &&
    (clip.transcriptSegmentCount ?? 0) >= 2 &&
    (clip.speechContinuityGrade === 'strong' || clip.speechContinuityGrade === 'repaired') &&
    clip.storyShape === 'complete' &&
    clip.contentArcGrade === 'complete' &&
    clip.topicCoherenceGrade !== 'weak'
  );
}

function isStandaloneContentDerivedSliceClip(
  clip: Partial<NormalizedSlicePlanClip>,
  policy: VideoSlicePlanningPolicy,
) {
  const speechDurationMs =
    typeof clip.speechStartMs === 'number' &&
    typeof clip.speechEndMs === 'number' &&
    clip.speechEndMs > clip.speechStartMs
      ? clip.speechEndMs - clip.speechStartMs
      : 0;

  return (
    isSparseCompleteStandaloneTranscriptCandidate(clip) &&
    isReleaseReadySliceCandidate(clip, policy) &&
    typeof clip.transcriptText === 'string' &&
    clip.transcriptText.trim().length > 0 &&
    typeof clip.transcriptCoverageScore === 'number' &&
    clip.transcriptCoverageScore >= MIN_TRANSCRIPT_RENDER_SPEECH_COVERAGE_SCORE &&
    (clip.transcriptSegmentCount ?? 0) === 1 &&
    (clip.speechContinuityGrade === 'strong' || clip.speechContinuityGrade === 'repaired') &&
    speechDurationMs >= MIN_SLICE_DURATION_MS
  );
}

function isContentDerivedReleaseClip(
  clip: Partial<NormalizedSlicePlanClip>,
  policy: VideoSlicePlanningPolicy,
) {
  return isStrongContentDerivedSliceClip(clip, policy) ||
    isStandaloneContentDerivedSliceClip(clip, policy);
}

export function isAutoCutNgOrRetakeTranscriptText(text: string) {
  const normalizedText = normalizeTranscriptSegmentTextForPlanning(text).toLowerCase();
  if (!normalizedText) {
    return true;
  }

  return /(?:\u5570\u55e6|\u91cd\u65b0\u5f55|\u91cd\u5f55|\u7b97\u4e86|ng|retake|re-record|record again|show you the same thing)/iu.test(
    normalizedText,
  );
}

export function isEligibleSmartSliceTranscriptCoverageText(text: string) {
  const normalizedText = normalizeSmartSliceTranscriptEvidenceText(text);
  return normalizedText.length > 0 && !isAutoCutNgOrRetakeTranscriptText(normalizedText);
}

function findSmartSliceDiscardedTailStartIndex(
  segments: readonly AutoCutSpeechTranscriptionSegment[],
) {
  if (segments.length === 0) {
    return -1;
  }

  const timelineStartMs = segments[0]?.startMs ?? 0;
  const timelineEndMs = segments.at(-1)?.endMs ?? timelineStartMs;
  const timelineDurationMs = Math.max(1, timelineEndMs - timelineStartMs);
  return segments.findIndex((segment, index) =>
    index > 0 &&
      isAutoCutNgOrRetakeTranscriptText(segment.text) &&
      segment.startMs >= timelineStartMs + timelineDurationMs * 0.65
  );
}

export function getEligibleSmartSliceTranscriptCoverageSegments(
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
) {
  const normalizedSegments = normalizeSmartSliceTranscriptSegmentsForPlanning(transcriptSegments);
  const discardedTailStartIndex = findSmartSliceDiscardedTailStartIndex(normalizedSegments);
  const publishableTimelineSegments = discardedTailStartIndex >= 0
    ? normalizedSegments.slice(0, discardedTailStartIndex)
    : normalizedSegments;
  return publishableTimelineSegments.filter((segment) =>
    isEligibleSmartSliceTranscriptCoverageText(segment.text)
  );
}

function getClipSpeechCoverageRanges(
  clip: Partial<NormalizedSlicePlanClip>,
): SmartSliceSourceSegment[] {
  if (Array.isArray(clip.sourceSegments) && clip.sourceSegments.length > 0) {
    return clip.sourceSegments
      .map((segment) => ({
        startMs: Math.max(0, Math.round(segment.startMs)),
        endMs: Math.max(0, Math.round(segment.endMs)),
      }))
      .filter((segment) => segment.endMs > segment.startMs);
  }

  const speechStartMs = typeof clip.speechStartMs === 'number'
    ? Math.max(0, Math.round(clip.speechStartMs))
    : typeof clip.sourceStartMs === 'number'
      ? Math.max(0, Math.round(clip.sourceStartMs))
      : typeof clip.startMs === 'number'
        ? Math.max(0, Math.round(clip.startMs))
        : undefined;
  const speechEndMs = typeof clip.speechEndMs === 'number'
    ? Math.max(0, Math.round(clip.speechEndMs))
    : typeof clip.sourceEndMs === 'number'
      ? Math.max(0, Math.round(clip.sourceEndMs))
      : typeof clip.startMs === 'number' && typeof clip.durationMs === 'number'
        ? Math.max(0, Math.round(clip.startMs + clip.durationMs))
        : undefined;
  return speechStartMs !== undefined && speechEndMs !== undefined && speechEndMs > speechStartMs
    ? [{ startMs: speechStartMs, endMs: speechEndMs }]
    : [];
}

function mergeSpeechCoverageRanges(
  ranges: readonly SmartSliceSourceSegment[],
): SmartSliceSourceSegment[] {
  const sortedRanges = ranges
    .map((range) => ({
      startMs: Math.max(0, Math.round(range.startMs)),
      endMs: Math.max(0, Math.round(range.endMs)),
    }))
    .filter((range) => range.endMs > range.startMs)
    .sort((firstRange, secondRange) =>
      firstRange.startMs - secondRange.startMs ||
        firstRange.endMs - secondRange.endMs,
    );
  const mergedRanges: SmartSliceSourceSegment[] = [];
  for (const range of sortedRanges) {
    const previousRange = mergedRanges.at(-1);
    if (!previousRange || range.startMs > previousRange.endMs) {
      mergedRanges.push({ ...range });
      continue;
    }

    previousRange.endMs = Math.max(previousRange.endMs, range.endMs);
  }

  return mergedRanges;
}

function calculateSpeechRangeDurationMs(ranges: readonly SmartSliceSourceSegment[]) {
  return ranges.reduce(
    (durationMs, range) => durationMs + Math.max(0, range.endMs - range.startMs),
    0,
  );
}

function getPlanSpeechCoverageRanges(
  clips: readonly Partial<NormalizedSlicePlanClip>[],
) {
  return mergeSpeechCoverageRanges(clips.flatMap((clip) => getClipSpeechCoverageRanges(clip)));
}

function doesClipCoverTranscriptSegment(
  clip: Partial<NormalizedSlicePlanClip>,
  segment: Pick<AutoCutSpeechTranscriptionSegment, 'startMs' | 'endMs'>,
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
  const coverageRanges = getClipSpeechCoverageRanges(clip)
    .map((range) => ({
      startMs: Math.max(segmentStartMs, range.startMs),
      endMs: Math.min(segmentEndMs, range.endMs),
    }))
    .filter((range) => range.endMs > range.startMs)
    .sort((firstRange, secondRange) =>
      firstRange.startMs - secondRange.startMs ||
        firstRange.endMs - secondRange.endMs,
    );

  let coveredUntilMs = segmentStartMs;
  for (const range of coverageRanges) {
    if (range.endMs <= coveredUntilMs) {
      continue;
    }
    if (range.startMs > coveredUntilMs + SMART_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS) {
      return false;
    }

    coveredUntilMs = Math.max(coveredUntilMs, range.endMs);
    if (coveredUntilMs >= segmentEndMs - SMART_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS) {
      return true;
    }
  }

  return coveredUntilMs >= segmentEndMs - SMART_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS;
}

function hasEligibleTranscriptTextOverlap(
  clip: Partial<NormalizedSlicePlanClip>,
  eligibleSegments: readonly AutoCutSpeechTranscriptionSegment[],
) {
  return eligibleSegments.some((segment) => doesClipCoverTranscriptSegment(clip, segment));
}

function isChineseConditionToLegalEntryBridge(firstText: string, secondText: string) {
  return /(?:\u53ea\u8981|\u884c\u4e1a\u7ecf\u9a8c|\u80fd\u7533\u8bf7|\u957f\u671f\u7684\u5408\u6cd5|\u5e26\u7740\u5bb6\u4eba)/u.test(firstText) &&
    /(?:\u6700\u5feb\u4e09\u4e2a\u6708|\u5c31\u80fd|\u5408\u6cd5\u5165\u5883|\u91cd\u56de|\u8f7b\u677e\u81ea\u5728|\u7f8e\u56fd\u751f\u6d3b)/u.test(secondText);
}

function isContinuityCriticalTranscriptPair(
  firstText: string,
  secondText: string,
) {
  return startsWithWeakConnector(secondText) ||
    hasSemanticTopicContinuationBridge(firstText, secondText) ||
    isChineseConditionToLegalEntryBridge(firstText, secondText);
}

function doesClipCoverTranscriptSegmentPair(
  clip: Partial<NormalizedSlicePlanClip>,
  firstSegment: Pick<AutoCutSpeechTranscriptionSegment, 'startMs' | 'endMs'>,
  secondSegment: Pick<AutoCutSpeechTranscriptionSegment, 'startMs' | 'endMs'>,
) {
  return doesClipCoverTranscriptSegment(clip, firstSegment) &&
    doesClipCoverTranscriptSegment(clip, secondSegment);
}

function calculatePlanTranscriptContinuityScore(
  plan: readonly Partial<NormalizedSlicePlanClip>[],
  eligibleSegments: readonly AutoCutSpeechTranscriptionSegment[],
) {
  let continuityScore = 0;
  for (let index = 0; index < eligibleSegments.length - 1; index += 1) {
    const firstSegment = eligibleSegments[index];
    const secondSegment = eligibleSegments[index + 1];
    if (!firstSegment || !secondSegment) {
      continue;
    }

    const coveredTogether = plan.some((clip) =>
      doesClipCoverTranscriptSegmentPair(clip, firstSegment, secondSegment)
    );
    if (!coveredTogether) {
      continue;
    }

    continuityScore += isContinuityCriticalTranscriptPair(firstSegment.text, secondSegment.text) ? 4 : 1;
  }

  return continuityScore;
}

function calculateClipEligibleSpeechCoverageMs(
  clip: Partial<NormalizedSlicePlanClip>,
  eligibleSegments: readonly AutoCutSpeechTranscriptionSegment[],
) {
  let coverageMs = 0;
  const clipCoverageRanges = getClipSpeechCoverageRanges(clip);
  for (const segment of eligibleSegments) {
    for (const range of clipCoverageRanges) {
      coverageMs += Math.max(
        0,
        Math.min(range.endMs, segment.endMs) - Math.max(range.startMs, segment.startMs),
      );
    }
  }

  return coverageMs;
}

function calculatePlanEligibleSpeechCoverageMs(
  plan: readonly Partial<NormalizedSlicePlanClip>[],
  eligibleSegments: readonly AutoCutSpeechTranscriptionSegment[],
) {
  if (eligibleSegments.length === 0) {
    return plan.reduce(
      (durationMs, clip) => durationMs + Math.max(0, (clip as CoverageWeightedSlicePlanClip).__coverageSpeechMs ?? 0),
      0,
    );
  }

  let coverageMs = 0;
  const planCoverageRanges = getPlanSpeechCoverageRanges(plan);
  for (const segment of eligibleSegments) {
    for (const range of planCoverageRanges) {
      coverageMs += Math.max(
        0,
        Math.min(range.endMs, segment.endMs) - Math.max(range.startMs, segment.startMs),
      );
    }
  }

  return coverageMs;
}

function calculatePlanCoveredEligibleSegmentCount(
  plan: readonly Partial<NormalizedSlicePlanClip>[],
  eligibleSegments: readonly AutoCutSpeechTranscriptionSegment[],
) {
  return eligibleSegments.filter((segment) =>
    isTranscriptSegmentCoveredByRepeatFilteredClip(plan, segment) ||
      plan.some((clip) => doesClipCoverTranscriptSegment(clip, segment))
  ).length;
}

function getUncoveredEligibleTranscriptSegments(
  plan: readonly Partial<NormalizedSlicePlanClip>[],
  eligibleSegments: readonly AutoCutSpeechTranscriptionSegment[],
) {
  return eligibleSegments.filter((segment) =>
    !isTranscriptSegmentCoveredByRepeatFilteredClip(plan, segment) &&
    !plan.some((clip) => doesClipCoverTranscriptSegment(clip, segment))
  );
}

function isTranscriptSegmentCoveredByRepeatFilteredClip(
  plan: readonly Partial<NormalizedSlicePlanClip>[],
  segment: AutoCutSpeechTranscriptionSegment,
) {
  const normalizedSegmentText = normalizeSmartSliceTranscriptEvidenceText(segment.text);
  if (!normalizedSegmentText) {
    return false;
  }

  return plan.some((clip) =>
    clip.risks?.includes('transcript-repeat-filtered') === true &&
      normalizeSmartSliceTranscriptEvidenceText(clip.transcriptText ?? '') === normalizedSegmentText
  );
}

export function isCoverageRepairReleaseClip(
  clip: Partial<NormalizedSlicePlanClip>,
  policy: VideoSlicePlanningPolicy,
  eligibleSegments: readonly AutoCutSpeechTranscriptionSegment[],
) {
  const hasRenderableCompleteTranscript =
    typeof clip.transcriptText === 'string' &&
    clip.transcriptText.trim().length > 0 &&
    typeof clip.transcriptCoverageScore === 'number' &&
    clip.transcriptCoverageScore >= MIN_TRANSCRIPT_RENDER_SPEECH_COVERAGE_SCORE &&
    (clip.transcriptSegmentCount ?? 0) >= MIN_CONTENT_TOPIC_SEGMENT_COUNT &&
    (clip.speechContinuityGrade === 'strong' || clip.speechContinuityGrade === 'repaired') &&
    (clip.storyShape === 'complete' || clip.contentArcGrade === 'complete');

  return hasEligibleTranscriptTextOverlap(clip, eligibleSegments) &&
    (
      isContentDerivedReleaseClip(clip, policy) ||
      isTranscriptBackedReviewReleaseClip(clip) ||
      isSparseCompleteStandaloneTranscriptCandidate(clip) ||
      isIsolatedMicroSpeechCoverageRepairClip(clip) ||
      isContentTopicReleaseCandidate(clip, policy) ||
      hasRenderableCompleteTranscript
    ) &&
    clip.publishabilityGrade !== 'reject' &&
    clip.platformReadinessGrade !== 'reject' &&
    clip.topicCoherenceGrade !== 'weak' &&
    !clip.risks?.includes('transcript-internal-repeat') &&
    (
      !clip.risks?.includes('sparse-transcript-speech') ||
      isSparseCompleteStandaloneTranscriptCandidate(clip) ||
      isIsolatedMicroSpeechCoverageRepairClip(clip)
    ) &&
    !isIsolatedPayoffFragmentCandidate(clip) &&
    (
      !clip.transcriptText ||
      !isAutoCutNgOrRetakeTranscriptText(clip.transcriptText)
    );
}

function isIsolatedMicroSpeechCoverageRepairClip(clip: Partial<NormalizedSlicePlanClip>) {
  return isIsolatedMicroSpeechRepeatProtectedClip(clip) &&
    isSparseTranscriptReviewClip(clip) &&
    clip.topicCoherenceGrade !== 'weak' &&
    clip.sentenceBoundaryIntegrityGrade !== 'broken' &&
    !clip.risks?.includes('transcript-internal-repeat') &&
    (
      !clip.transcriptText ||
      !isAutoCutNgOrRetakeTranscriptText(clip.transcriptText)
    );
}

function isSparsePayoffCoverageRepairClip(
  clip: Partial<NormalizedSlicePlanClip>,
  selectedClips: readonly NormalizedSlicePlanClip[],
) {
  const stages = Array.isArray(clip.contentArcStages) ? clip.contentArcStages : [];
  return isSparseTranscriptReviewClip(clip) &&
    (stages.includes('payoff') || clip.storyShape === 'payoffOnly') &&
    clip.endingCompleteness === 'complete' &&
    clip.topicCoherenceGrade !== 'weak' &&
    !clip.risks?.includes('transcript-internal-repeat') &&
    selectedClips.some((selectedClip) =>
      selectedClip.startMs < (clip.startMs ?? 0) &&
      selectedClip.topicCoherenceGrade !== 'weak' &&
      !selectedClip.risks?.includes('transcript-internal-repeat') &&
      !isIsolatedPayoffFragmentCandidate(selectedClip)
    ) &&
    (
      !clip.transcriptText ||
      !isAutoCutNgOrRetakeTranscriptText(clip.transcriptText)
    );
}

function calculatePlanRequiredSemanticContinuityScore(
  plan: readonly Partial<NormalizedSlicePlanClip>[],
) {
  return plan.reduce((score, clip) => {
    const text = clip.transcriptText ?? '';
    let nextScore = score;
    if (
      /(?:\u53ea\u8981\u4f60\u6709\u4e00\u5b9a\u7684\u884c\u4e1a\u7ecf\u9a8c|\u884c\u4e1a\u7ecf\u9a8c\u5c31\u80fd\u7533\u8bf7)/u.test(text) &&
      /(?:\u5408\u6cd5\u5165\u5883|\u91cd\u56de\u4f60\u719f\u6089\u7684\u7f8e\u56fd\u751f\u6d3b)/u.test(text)
    ) {
      nextScore += 8;
    }
    if (/\u5165\u573a\u5238/u.test(text)) {
      nextScore += 5;
    }
    return nextScore;
  }, 0);
}

function compareCoverageFirstClipPlans(
  firstPlan: readonly CoverageWeightedSlicePlanClip[],
  secondPlan: readonly CoverageWeightedSlicePlanClip[],
  policy: VideoSlicePlanningPolicy,
  eligibleSegments: readonly AutoCutSpeechTranscriptionSegment[] = [],
) {
  if (eligibleSegments.length > 0) {
    const firstCoveredSegmentCount = calculatePlanCoveredEligibleSegmentCount(firstPlan, eligibleSegments);
    const secondCoveredSegmentCount = calculatePlanCoveredEligibleSegmentCount(secondPlan, eligibleSegments);
    if (firstCoveredSegmentCount !== secondCoveredSegmentCount) {
      return firstCoveredSegmentCount - secondCoveredSegmentCount;
    }
  }

  const firstCoverageMs = calculatePlanEligibleSpeechCoverageMs(firstPlan, eligibleSegments);
  const secondCoverageMs = calculatePlanEligibleSpeechCoverageMs(secondPlan, eligibleSegments);
  if (firstCoverageMs !== secondCoverageMs) {
    return firstCoverageMs - secondCoverageMs;
  }

  if (eligibleSegments.length > 0) {
    const firstContinuityScore = calculatePlanTranscriptContinuityScore(firstPlan, eligibleSegments);
    const secondContinuityScore = calculatePlanTranscriptContinuityScore(secondPlan, eligibleSegments);
    if (firstContinuityScore !== secondContinuityScore) {
      return firstContinuityScore - secondContinuityScore;
    }
  }

  const firstRequiredSemanticContinuityScore = calculatePlanRequiredSemanticContinuityScore(firstPlan);
  const secondRequiredSemanticContinuityScore = calculatePlanRequiredSemanticContinuityScore(secondPlan);
  if (firstRequiredSemanticContinuityScore !== secondRequiredSemanticContinuityScore) {
    return firstRequiredSemanticContinuityScore - secondRequiredSemanticContinuityScore;
  }

  return compareSliceCandidateSets(firstPlan, secondPlan, policy);
}

function createSlicePlanClipCandidateKey(clip: Partial<NormalizedSlicePlanClip>) {
  if (clip.candidateId) {
    return `candidate:${clip.candidateId}`;
  }

  return [
    'range',
    Math.round(clip.startMs ?? 0),
    Math.round((clip.startMs ?? 0) + (clip.durationMs ?? 0)),
    normalizeTranscriptTextForRepeatDetection(clip.transcriptText),
  ].join(':');
}

function createCoverageRepairTranscriptClip(
  segments: readonly AutoCutSpeechTranscriptionSegment[],
  repairIndex: number,
  policy: VideoSlicePlanningPolicy,
): NormalizedSlicePlanClip | undefined {
  const eligibleSegments = segments.filter((segment) => isEligibleSmartSliceTranscriptCoverageText(segment.text));
  if (eligibleSegments.length === 0) {
    return undefined;
  }

  const firstSegment = eligibleSegments[0];
  const lastSegment = eligibleSegments.at(-1);
  if (!firstSegment || !lastSegment) {
    return undefined;
  }

  const speechStartMs = Math.max(0, Math.round(firstSegment.startMs));
  const speechEndMs = Math.max(speechStartMs, Math.round(lastSegment.endMs));
  if (speechEndMs <= speechStartMs) {
    return undefined;
  }

  const sourceDurationMs = policy.sourceDurationMs;
  const sourceStartMs = Math.max(0, speechStartMs - TRANSCRIPT_BOUNDARY_PADDING_BEFORE_MS);
  const unclampedSourceEndMs = speechEndMs + TRANSCRIPT_BOUNDARY_PADDING_AFTER_MS;
  const sourceEndMs = sourceDurationMs !== undefined
    ? Math.min(sourceDurationMs, unclampedSourceEndMs)
    : unclampedSourceEndMs;
  if (sourceEndMs <= sourceStartMs) {
    return undefined;
  }

  const sourceSegments = createSmartSliceSpeechSourceSegments(
    {
      startMs: sourceStartMs,
      durationMs: sourceEndMs - sourceStartMs,
      sourceStartMs,
      sourceEndMs,
    },
    eligibleSegments,
  );
  const renderedDurationMs = sourceSegments.length > 1
    ? sourceSegments.reduce(
        (durationMs, segment) => durationMs + Math.max(0, segment.endMs - segment.startMs),
        0,
      )
    : sourceEndMs - sourceStartMs;
  if (renderedDurationMs < MIN_TRANSCRIPT_ALIGNED_SLICE_DURATION_MS || renderedDurationMs > MAX_SLICE_DURATION_MS) {
    return undefined;
  }

  const transcriptTexts = eligibleSegments.map((segment) =>
    normalizeSmartSliceTranscriptEvidenceText(segment.text)
  ).filter(Boolean);
  const text = transcriptTexts.join(' ').trim();
  if (!text) {
    return undefined;
  }

  const transcriptSpeechDurationMs = eligibleSegments.reduce(
    (durationMs, segment) => durationMs + Math.max(0, segment.endMs - segment.startMs),
    0,
  );
  const score = clampSlicePlannerScore(
    0.68 +
      Math.min(0.12, eligibleSegments.length * 0.015) +
      Math.min(0.12, transcriptSpeechDurationMs / Math.max(1, policy.idealDurationMs) * 0.08),
  );
  const label = createTranscriptSliceLabel(eligibleSegments, 0);
  const risks = [
    'transcript-coverage-repaired',
    ...(sourceSegments.length > 1 ? ['internal-silence-trimmed'] : []),
    ...(eligibleSegments.length <= 1 || renderedDurationMs < policy.minDurationMs ? ['sparse-transcript-speech'] : []),
    ...(renderedDurationMs < policy.minDurationMs ? ['short-transcript-window'] : []),
  ];
  const metadata = createTranscriptSliceMetadata(
    label,
    text,
    score,
    sourceStartMs,
    sourceEndMs,
    speechStartMs,
    speechEndMs,
    Math.max(0, speechStartMs - sourceStartMs),
    Math.max(0, sourceEndMs - speechEndMs),
    risks,
    eligibleSegments.length,
    transcriptSpeechDurationMs,
    transcriptTexts,
  );
  const contentArcMetadata = createContentArcMetadata(text);
  const topicCoherenceMetadata = createTopicCoherenceMetadataFromTexts(transcriptTexts);
  const publishabilityMetadata = createPublishabilityMetadata({
    ...metadata,
    ...contentArcMetadata,
    ...topicCoherenceMetadata,
  });
  const platformReadinessMetadata = createPlatformReadinessMetadata({
    ...metadata,
    ...contentArcMetadata,
    ...topicCoherenceMetadata,
    ...publishabilityMetadata,
    durationMs: renderedDurationMs,
  }, policy);
  const sourceSegmentEvidence = sourceSegments.length > 1
    ? {
        sourceSegments,
        renderedDurationMs,
        removedSilenceMs: Math.max(0, sourceEndMs - sourceStartMs - renderedDurationMs),
        internalSilenceTrimCount: sourceSegments.length - 1,
      }
    : {};

  return {
    ...metadata,
    ...contentArcMetadata,
    ...topicCoherenceMetadata,
    ...publishabilityMetadata,
    ...platformReadinessMetadata,
    ...sourceSegmentEvidence,
    candidateId: `transcript-coverage-repair-${repairIndex + 1}`,
    index: repairIndex,
    startMs: sourceStartMs,
    durationMs: sourceEndMs - sourceStartMs,
    label,
    sourceStartMs,
    sourceEndMs,
    speechStartMs,
    speechEndMs,
    boundaryPaddingBeforeMs: Math.max(0, speechStartMs - sourceStartMs),
    boundaryPaddingAfterMs: Math.max(0, sourceEndMs - speechEndMs),
  };
}

function createCoverageRepairTranscriptClips(
  eligibleSegments: readonly AutoCutSpeechTranscriptionSegment[],
  policy: VideoSlicePlanningPolicy,
) {
  const clips: NormalizedSlicePlanClip[] = [];
  let windowStartIndex = 0;
  while (windowStartIndex < eligibleSegments.length) {
    const windowStartSegment = eligibleSegments[windowStartIndex];
    if (!windowStartSegment) {
      windowStartIndex += 1;
      continue;
    }

    let windowEndIndex = windowStartIndex;
    while (windowEndIndex + 1 < eligibleSegments.length) {
      const currentSegment = eligibleSegments[windowEndIndex];
      const nextSegment = eligibleSegments[windowEndIndex + 1];
      if (
        !currentSegment ||
        !nextSegment ||
        !canJoinTranscriptSegments(
          currentSegment as TranscriptPlanningSegment,
          nextSegment as TranscriptPlanningSegment,
          policy,
        ) ||
        nextSegment.endMs - windowStartSegment.startMs > policy.maxDurationMs
      ) {
        break;
      }

      windowEndIndex += 1;
    }

    const clip = createCoverageRepairTranscriptClip(
      eligibleSegments.slice(windowStartIndex, windowEndIndex + 1),
      clips.length,
      policy,
    );
    if (clip) {
      clips.push(clip);
    }
    windowStartIndex = Math.max(windowEndIndex + 1, windowStartIndex + 1);
  }

  return clips;
}

function repairPlanWithFallbackTranscriptCoverageClips(
  plan: readonly NormalizedSlicePlanClip[],
  eligibleSegments: readonly AutoCutSpeechTranscriptionSegment[],
  policy: VideoSlicePlanningPolicy,
) {
  let repairedPlan = sortSliceClipsByStartMs([...plan]);
  let missingSegments = getUncoveredEligibleTranscriptSegments(repairedPlan, eligibleSegments);
  const maxRepairIterations = Math.max(1, eligibleSegments.length);
  for (let iteration = 0; missingSegments.length > 0 && iteration < maxRepairIterations; iteration += 1) {
    const repairClips = createCoverageRepairTranscriptClips(missingSegments, policy);
    const repairClip = repairClips
      .filter((candidate) => missingSegments.some((segment) => doesClipCoverTranscriptSegment(candidate, segment)))
      .sort((firstCandidate, secondCandidate) =>
        calculateClipEligibleSpeechCoverageMs(secondCandidate, missingSegments) -
          calculateClipEligibleSpeechCoverageMs(firstCandidate, missingSegments)
      )[0];
    if (!repairClip) {
      break;
    }

    const appendedPlan = sortSliceClipsByStartMs([...repairedPlan, repairClip]);
    if (getUncoveredEligibleTranscriptSegments(appendedPlan, eligibleSegments).length < missingSegments.length) {
      repairedPlan = appendedPlan;
      missingSegments = getUncoveredEligibleTranscriptSegments(repairedPlan, eligibleSegments);
      continue;
    }

    const overlappingClips = repairedPlan.filter((clip) => doSliceCandidatesOverlap(clip, repairClip));
    const overlappingPlanCoversRepairSpeech = missingSegments
      .filter((segment) => doesClipCoverTranscriptSegment(repairClip, segment))
      .every((segment) => overlappingClips.some((clip) => doesClipCoverTranscriptSegment(clip, segment)));
    if (overlappingPlanCoversRepairSpeech) {
      break;
    }
    const replacedPlan = sortSliceClipsByStartMs([
      ...repairedPlan.filter((clip) => !doSliceCandidatesOverlap(clip, repairClip)),
      repairClip,
    ]);
    if (getUncoveredEligibleTranscriptSegments(replacedPlan, eligibleSegments).length >= missingSegments.length) {
      break;
    }
    repairedPlan = replacedPlan;
    missingSegments = getUncoveredEligibleTranscriptSegments(repairedPlan, eligibleSegments);
  }

  return repairedPlan.map((clip, index) => ({ ...clip, index }));
}

function trimSmartSliceSourceSegmentsToRange(
  sourceSegments: readonly SmartSliceSourceSegment[] | undefined,
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

export function normalizeSmartSlicePlanRenderedTimelineForNativeRender(
  plan: readonly NormalizedSlicePlanClip[],
  policy: VideoSlicePlanningPolicy,
): NormalizedSlicePlanClip[] {
  const sourceDurationMs = policy.sourceDurationMs !== undefined
    ? Math.max(0, Math.round(policy.sourceDurationMs))
    : undefined;
  const timeline = sortSliceClipsByStartMs([...plan])
    .map((clip) => createNormalizedSmartSliceTimelineClip(clip, sourceDurationMs))
    .filter((clip): clip is NormalizedSmartSliceTimelineClip => clip !== undefined);

  for (let index = 0; index < timeline.length - 1; index += 1) {
    const currentClip = timeline[index];
    const nextClip = timeline[index + 1];
    if (currentClip === undefined || nextClip === undefined || currentClip.sourceEndMs <= nextClip.sourceStartMs) {
      continue;
    }

    const hasSpeechGapForPaddingSplit =
      currentClip.speechEndMs <= nextClip.speechStartMs &&
      currentClip.speechEndMs >= currentClip.sourceStartMs &&
      nextClip.speechStartMs <= nextClip.sourceEndMs;
    if (!hasSpeechGapForPaddingSplit) {
      continue;
    }

    const splitBoundaryMs = Math.round((currentClip.speechEndMs + nextClip.speechStartMs) / 2);
    currentClip.sourceEndMs = Math.max(
      currentClip.speechEndMs,
      Math.min(currentClip.sourceEndMs, splitBoundaryMs),
    );
    nextClip.sourceStartMs = Math.min(
      nextClip.speechStartMs,
      Math.max(nextClip.sourceStartMs, splitBoundaryMs),
    );

    if (currentClip.sourceEndMs > nextClip.sourceStartMs) {
      const fallbackBoundaryMs = Math.max(
        currentClip.speechEndMs,
        Math.min(nextClip.speechStartMs, currentClip.sourceEndMs, nextClip.sourceStartMs),
      );
      currentClip.sourceEndMs = Math.max(currentClip.speechEndMs, Math.min(currentClip.sourceEndMs, fallbackBoundaryMs));
      nextClip.sourceStartMs = Math.min(nextClip.speechStartMs, Math.max(nextClip.sourceStartMs, fallbackBoundaryMs));
    }
  }

  return timeline.map((clip, index) => finalizeNormalizedSmartSliceTimelineClip(clip, index));
}

interface NormalizedSmartSliceTimelineClip {
  clip: NormalizedSlicePlanClip;
  sourceStartMs: number;
  sourceEndMs: number;
  speechStartMs: number;
  speechEndMs: number;
}

function createNormalizedSmartSliceTimelineClip(
  clip: NormalizedSlicePlanClip,
  sourceDurationMs: number | undefined,
): NormalizedSmartSliceTimelineClip | undefined {
  const startMs = Math.max(0, Math.round(clip.startMs));
  const durationMs = Math.max(0, Math.round(clip.durationMs));
  const requestedRenderEndMs = startMs + durationMs;
  const renderEndMs = sourceDurationMs !== undefined
    ? Math.min(sourceDurationMs, requestedRenderEndMs)
    : requestedRenderEndMs;
  if (renderEndMs <= startMs) {
    return undefined;
  }

  const sourceStartMs = Math.max(
    startMs,
    Math.min(
      Math.round(clip.sourceStartMs ?? startMs),
      renderEndMs - 1,
    ),
  );
  const sourceEndMs = Math.max(
    sourceStartMs + 1,
    Math.min(
      Math.round(clip.sourceEndMs ?? renderEndMs),
      renderEndMs,
    ),
  );
  let speechStartMs = typeof clip.speechStartMs === 'number' && Number.isFinite(clip.speechStartMs)
    ? Math.round(clip.speechStartMs)
    : sourceStartMs;
  let speechEndMs = typeof clip.speechEndMs === 'number' && Number.isFinite(clip.speechEndMs)
    ? Math.round(clip.speechEndMs)
    : sourceEndMs;

  speechStartMs = Math.max(sourceStartMs, Math.min(speechStartMs, sourceEndMs));
  speechEndMs = Math.max(sourceStartMs, Math.min(speechEndMs, sourceEndMs));
  if (speechEndMs <= speechStartMs) {
    speechStartMs = sourceStartMs;
    speechEndMs = sourceEndMs;
  }

  return {
    clip,
    sourceStartMs,
    sourceEndMs,
    speechStartMs,
    speechEndMs,
  };
}

function finalizeNormalizedSmartSliceTimelineClip(
  timelineClip: NormalizedSmartSliceTimelineClip,
  index: number,
): NormalizedSlicePlanClip {
  const normalizedSourceStartMs = Math.max(0, Math.round(timelineClip.sourceStartMs));
  const normalizedSourceEndMs = Math.max(
    normalizedSourceStartMs + 1,
    Math.round(timelineClip.sourceEndMs),
  );
  const speechStartMs = Math.max(
    normalizedSourceStartMs,
    Math.min(Math.round(timelineClip.speechStartMs), normalizedSourceEndMs),
  );
  const speechEndMs = Math.max(
    speechStartMs,
    Math.min(Math.round(timelineClip.speechEndMs), normalizedSourceEndMs),
  );
  const normalizedClip: NormalizedSlicePlanClip = {
    ...timelineClip.clip,
    index,
    startMs: normalizedSourceStartMs,
    durationMs: normalizedSourceEndMs - normalizedSourceStartMs,
    sourceStartMs: normalizedSourceStartMs,
    sourceEndMs: normalizedSourceEndMs,
    speechStartMs,
    speechEndMs,
    boundaryPaddingBeforeMs: Math.max(0, speechStartMs - normalizedSourceStartMs),
    boundaryPaddingAfterMs: Math.max(0, normalizedSourceEndMs - speechEndMs),
  };

  if (normalizedClip.leadingSilenceMs !== undefined) {
    if (typeof normalizedClip.audioActivityStartMs === 'number' && Number.isFinite(normalizedClip.audioActivityStartMs)) {
      normalizedClip.leadingSilenceMs = Math.max(0, Math.round(normalizedClip.audioActivityStartMs) - normalizedSourceStartMs);
    } else {
      normalizedClip.leadingSilenceMs = Math.max(0, speechStartMs - normalizedSourceStartMs);
    }
  }
  if (normalizedClip.trailingSilenceMs !== undefined) {
    if (typeof normalizedClip.audioActivityEndMs === 'number' && Number.isFinite(normalizedClip.audioActivityEndMs)) {
      normalizedClip.trailingSilenceMs = Math.max(0, normalizedSourceEndMs - Math.round(normalizedClip.audioActivityEndMs));
    } else {
      normalizedClip.trailingSilenceMs = Math.max(0, normalizedSourceEndMs - speechEndMs);
    }
  }
  if (typeof normalizedClip.audioActivityStartMs === 'number') {
    normalizedClip.audioActivityStartMs = Math.max(
      normalizedSourceStartMs,
      Math.min(Math.round(normalizedClip.audioActivityStartMs), normalizedSourceEndMs),
    );
  }
  if (typeof normalizedClip.audioActivityEndMs === 'number') {
    normalizedClip.audioActivityEndMs = Math.max(
      normalizedSourceStartMs,
      Math.min(Math.round(normalizedClip.audioActivityEndMs), normalizedSourceEndMs),
    );
  }

  const trimmedSourceSegments = trimSmartSliceSourceSegmentsToRange(
    normalizedClip.sourceSegments,
    normalizedSourceStartMs,
    normalizedSourceEndMs,
  );
  if (trimmedSourceSegments !== undefined && trimmedSourceSegments.length > 1) {
    const renderedSourceSegmentsDurationMs = trimmedSourceSegments.reduce(
      (totalDurationMs, segment) => totalDurationMs + Math.max(0, segment.endMs - segment.startMs),
      0,
    );
    normalizedClip.sourceSegments = trimmedSourceSegments;
    normalizedClip.renderedDurationMs = renderedSourceSegmentsDurationMs;
    normalizedClip.removedSilenceMs = Math.max(
      0,
      normalizedSourceEndMs - normalizedSourceStartMs - renderedSourceSegmentsDurationMs,
    );
    normalizedClip.internalSilenceTrimCount = trimmedSourceSegments.length - 1;
  } else {
    delete normalizedClip.sourceSegments;
    delete normalizedClip.renderedDurationMs;
    delete normalizedClip.removedSilenceMs;
    delete normalizedClip.internalSilenceTrimCount;
  }

  return normalizedClip;
}

export function selectCoverageFirstReleasePlan(
  candidates: readonly NormalizedSlicePlanClip[],
  eligibleSegments: readonly AutoCutSpeechTranscriptionSegment[],
  policy: VideoSlicePlanningPolicy,
  enableRepeatFilter: boolean,
) {
  const weightedCandidates: CoverageWeightedSlicePlanClip[] = candidates.map((candidate) => ({
    ...candidate,
    __coverageSpeechMs: calculateClipEligibleSpeechCoverageMs(candidate, eligibleSegments),
  }));
  const orderedCandidates = sortSliceClipsByEndMs(weightedCandidates).filter((candidate) =>
    (candidate.__coverageSpeechMs ?? 0) >= MIN_SPEECH_COVERAGE_REPAIR_GAIN_MS
  );
  let bestPlan: CoverageWeightedSlicePlanClip[] = [];
  const plansByIndex: CoverageWeightedSlicePlanClip[][] = [[]];

  for (let candidateIndex = 0; candidateIndex < orderedCandidates.length; candidateIndex += 1) {
    const candidate = orderedCandidates[candidateIndex];
    if (!candidate) {
      plansByIndex.push(bestPlan);
      continue;
    }

    let bestCompatiblePlanBeforeCandidate: CoverageWeightedSlicePlanClip[] = [];
    for (let previousIndex = candidateIndex - 1; previousIndex >= -1; previousIndex -= 1) {
      const previousPlan = plansByIndex[previousIndex + 1] ?? [];
      if (isSliceCandidateCompatibleWithPlan(previousPlan, candidate, enableRepeatFilter)) {
        bestCompatiblePlanBeforeCandidate = previousPlan;
        break;
      }
    }

    const candidatePlan = sortSliceClipsByStartMs([...bestCompatiblePlanBeforeCandidate, candidate]);
    bestPlan = compareCoverageFirstClipPlans(candidatePlan, bestPlan, policy, eligibleSegments) > 0
      ? candidatePlan
      : bestPlan;
    plansByIndex.push(bestPlan);
  }

  return bestPlan.map(({ __coverageSpeechMs, ...clip }, index) => ({ ...clip, index }));
}

export function repairReleasePlanSpeechCoverage(
  releasePlan: readonly NormalizedSlicePlanClip[],
  candidates: readonly NormalizedSlicePlanClip[],
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
  policy: VideoSlicePlanningPolicy,
  _enableRepeatFilter: boolean,
) {
  const eligibleSegments = getEligibleSmartSliceTranscriptCoverageSegments(transcriptSegments);
  if (eligibleSegments.length === 0) {
    return sortSliceClipsByStartMs([...releasePlan]).map((clip, index) => ({ ...clip, index }));
  }

  const selectedClips = sortSliceClipsByStartMs([...releasePlan]);
  if (selectedClips.length === 0) {
    return [];
  }
  const repairCandidateMap = new Map<string, NormalizedSlicePlanClip>();
  for (const selectedClip of selectedClips) {
    repairCandidateMap.set(createSlicePlanClipCandidateKey(selectedClip), selectedClip);
  }
  for (const candidate of candidates) {
    if (
      isCoverageRepairReleaseClip(candidate, policy, eligibleSegments) ||
      isSparsePayoffCoverageRepairClip(candidate, selectedClips)
    ) {
      repairCandidateMap.set(createSlicePlanClipCandidateKey(candidate), candidate);
    }
  }
  const repairCandidates = [...repairCandidateMap.values()]
    .sort((firstCandidate, secondCandidate) => {
      const firstCoverageMs = calculateSpeechRangeDurationMs(getClipSpeechCoverageRanges(firstCandidate));
      const secondCoverageMs = calculateSpeechRangeDurationMs(getClipSpeechCoverageRanges(secondCandidate));
      if (firstCoverageMs !== secondCoverageMs) {
        return secondCoverageMs - firstCoverageMs;
      }

      return compareSliceCandidateSets([secondCandidate], [firstCandidate], policy);
    });
  const coverageFirstPlan = selectCoverageFirstReleasePlan(
    repairCandidates,
    eligibleSegments,
    policy,
    false,
  );
  const coverageSelectedPlan = compareCoverageFirstClipPlans(coverageFirstPlan, selectedClips, policy, eligibleSegments) > 0
    ? coverageFirstPlan
    : selectedClips;
  const coverageRepairedPlan = repairPlanWithFallbackTranscriptCoverageClips(
    coverageSelectedPlan,
    eligibleSegments,
    policy,
  );
  const coverageRepairedMissingSegmentCount = getUncoveredEligibleTranscriptSegments(
    coverageRepairedPlan,
    eligibleSegments,
  ).length;
  const coverageSelectedMissingSegmentCount = getUncoveredEligibleTranscriptSegments(
    coverageSelectedPlan,
    eligibleSegments,
  ).length;
  const finalPlan = coverageRepairedMissingSegmentCount < coverageSelectedMissingSegmentCount ||
    compareCoverageFirstClipPlans(coverageRepairedPlan, coverageSelectedPlan, policy, eligibleSegments) > 0
    ? coverageRepairedPlan
    : coverageSelectedPlan;

  return normalizeSmartSlicePlanRenderedTimelineForNativeRender(finalPlan, policy);
}

function summarizeTranscriptText(text: string) {
  const normalizedText = normalizePlanText(text, 150);
  return normalizedText
    ? `Speech-to-text window: ${normalizedText}`
    : 'Speech-to-text window selected from continuous transcript segments.';
}

function inferTranscriptStoryShape(text: string): NormalizedSlicePlanClip['storyShape'] {
  const normalizedText = text.toLowerCase();
  const hasExplicitOpening = hasExplicitContentSectionOpening(text);
  const hasChineseText = /[\u4e00-\u9fff]/u.test(text);
  const hasChineseHook = (hasChineseText && hasExplicitOpening) || includesAnyMarker(normalizedText, CHINESE_HOOK_MARKERS);
  const hasChineseContext = includesAnyMarker(normalizedText, CHINESE_CONTEXT_MARKERS);
  const hasChinesePayoff = includesChinesePayoffMarker(normalizedText);
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

  const hasHook = hasExplicitContentSectionOpening(text) ||
    /\b(why|how|what|when|secret|mistake|problem|pain|scroll|seconds?|watch|attention|important|key|result|tip)\b/.test(normalizedText);
  const hasContext = /\b(because|case|example|data|first|second|context|reason|means|shows|happened|launch|team)\b/.test(normalizedText);
  const hasPayoff = includesEnglishPayoffMarker(normalizedText);

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
  transcriptSegmentCount: number,
  transcriptSpeechDurationMs: number,
  transcriptTexts: readonly string[] = [text],
) {
  const isTopicSegment = risks.includes(CONTENT_TOPIC_SEGMENT_RISK);
  const hasConnectorRepair = risks.includes('connector-repaired');
  const hasTrailingExtension = risks.includes('trailing-connector-extended');
  const hasOpenSentenceExtension = risks.includes('open-sentence-extended');
  const hasNoiseBridgeRepair = risks.includes('transcript-noise-bridge-repaired');
  const hasSilenceCompaction = risks.includes('internal-silence-trimmed');
  const continuityPenalty =
    (hasConnectorRepair ? 0.05 : 0) +
    (hasTrailingExtension ? 0.03 : 0) +
    (hasOpenSentenceExtension ? 0.04 : 0) +
    (hasNoiseBridgeRepair ? 0.02 : 0) +
    (hasSilenceCompaction ? 0.04 : 0);
  const normalizedRisks = mergePlanRisks(risks);
  const storyShape = inferTranscriptStoryShape(text);
  const boundaryMetadata = createBoundaryQualityMetadata(text, risks);
  const sentenceBoundaryMetadata = createSentenceBoundaryIntegrityMetadata(text, risks);
  const contentArcMetadata = createContentArcMetadata(text);
  const topicCoherenceMetadata = createTopicCoherenceMetadataFromTexts(transcriptTexts);
  const mergedRisks = mergePlanRisks(
    normalizedRisks,
    isTopicSegment ? undefined : createStoryShapeRisks(storyShape),
    !isTopicSegment && contentArcMetadata.contentArcMissingStages.length > 0
      ? createContentArcRisks(contentArcMetadata.contentArcMissingStages)
      : undefined,
    topicCoherenceMetadata.topicCoherenceGrade === 'weak' || topicCoherenceMetadata.topicShiftCount > 0
      ? ['topic-drift']
      : undefined,
    !isTopicSegment && boundaryMetadata.hookStrength === 'weak' ? ['weak-hook'] : undefined,
    !isTopicSegment && boundaryMetadata.endingCompleteness === 'open' ? ['open-ending'] : undefined,
    sentenceBoundaryMetadata.sentenceBoundaryIntegrityGrade === 'broken'
      ? ['broken-sentence-boundary']
      : undefined,
  );
  const transcriptCoverageScore = clampSlicePlannerScore(
    speechEndMs > speechStartMs ? transcriptSpeechDurationMs / (speechEndMs - speechStartMs) : 0,
  );
  const speechContinuityGrade: NonNullable<NormalizedSlicePlanClip['speechContinuityGrade']> =
    transcriptSegmentCount <= 0 || transcriptCoverageScore < 0.5
      ? 'weak'
      : hasConnectorRepair ||
          hasTrailingExtension ||
          hasOpenSentenceExtension ||
          hasNoiseBridgeRepair ||
          hasSilenceCompaction ||
          transcriptCoverageScore < 0.85
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
    transcriptSegmentTexts: transcriptTexts.slice(0, 20),
    transcriptCoverageScore,
    transcriptSegmentCount,
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

function createSemanticStoryMergeCandidates(
  params: VideoSliceParams,
  policy: VideoSlicePlanningPolicy,
  segments: readonly TranscriptPlanningSegment[],
  minDurationMs: number,
  maxDurationMs: number,
  existingCandidateCount: number,
): TranscriptSliceCandidate[] {
  const candidates: TranscriptSliceCandidate[] = [];
  const seenRanges = new Set<string>();

  for (let startIndex = 0; startIndex < segments.length; startIndex += 1) {
    const startSegment = segments[startIndex];
    if (!startSegment) {
      continue;
    }

    for (
      let endIndex = startIndex + MIN_SEMANTIC_STORY_MERGE_SEGMENTS - 1;
      endIndex < Math.min(segments.length, startIndex + MAX_SEMANTIC_STORY_MERGE_SEGMENTS);
      endIndex += 1
    ) {
      const endSegment = segments[endIndex];
      if (!endSegment) {
        continue;
      }

      let contiguous = true;
      for (let index = startIndex; index < endIndex; index += 1) {
        const currentSegment = segments[index];
        const nextSegment = segments[index + 1];
        if (!currentSegment || !nextSegment || !canJoinTranscriptSegments(currentSegment, nextSegment, policy)) {
          contiguous = false;
          break;
        }
      }
      if (!contiguous) {
        break;
      }

      if (hasFreshSemanticStoryBoundaryInsideWindow(segments, startIndex, endIndex)) {
        continue;
      }

      const timing = createTranscriptBoundaryTiming(segments, startIndex, endIndex, policy, maxDurationMs);
      if (!timing || timing.durationMs < MIN_TRANSCRIPT_ALIGNED_SLICE_DURATION_MS) {
        continue;
      }

      const candidateSegments = segments.slice(startIndex, endIndex + 1);
      const transcriptTexts = candidateSegments.map((segment) => segment.text);
      const text = transcriptTexts.join(' ').trim();
      const contentArcMetadata = createContentArcMetadata(text);
      if (contentArcMetadata.contentArcGrade !== 'complete') {
        continue;
      }

      const topicCoherenceMetadata = createTopicCoherenceMetadataFromTexts(transcriptTexts);
      if (topicCoherenceMetadata.topicCoherenceGrade === 'weak') {
        continue;
      }

      const hasIncompleteOverlap = candidatesHaveIncompleteSemanticOverlap(
        segments,
        startIndex,
        endIndex,
        contentArcMetadata.contentArcStages,
      );
      if (!hasIncompleteOverlap) {
        continue;
      }

      const rangeKey = `${timing.speechStartMs}:${timing.speechEndMs}`;
      if (seenRanges.has(rangeKey)) {
        continue;
      }
      seenRanges.add(rangeKey);

      const transcriptSpeechDurationMs = candidateSegments.reduce(
        (durationSumMs, segment) => durationSumMs + Math.max(0, segment.endMs - segment.startMs),
        0,
      );
      const baseScore = scoreTranscriptCandidate(
        params,
        policy,
        text,
        timing.durationMs,
        minDurationMs,
        maxDurationMs,
        transcriptTexts,
      );
      const storyScore = clampSlicePlannerScore(
        baseScore +
          0.1 +
          contentArcMetadata.contentArcScore * 0.08 +
          topicCoherenceMetadata.topicCoherenceScore * 0.05,
      );
      const label = createTranscriptSliceLabel(segments, startIndex);
      const hasInternalRepeatedMeaning = hasTranscriptInternalRepeatedMeaning(transcriptTexts);
      const risks = [
        'semantic-story-merged',
        ...(candidateSegments.slice(1).some((segment) => startsWithWeakConnector(segment.text))
          ? ['connector-repaired']
          : []),
        ...(candidateSegments.some((segment) => (segment.noiseBridgeBeforeMs ?? 0) > 0)
          ? ['transcript-noise-bridge-repaired']
          : []),
        ...(hasTranscriptSegmentOverlapRepair(candidateSegments, policy) ? ['transcript-overlap-repaired'] : []),
        ...(hasInternalRepeatedMeaning ? ['transcript-internal-repeat'] : []),
      ];

      candidates.push({
        candidateId: `semantic-story-${startIndex + 1}-${endIndex + 1}`,
        index: existingCandidateCount + candidates.length,
        anchorSegmentIndex: startIndex,
        startMs: timing.startMs,
        endMs: timing.endMs,
        durationMs: timing.durationMs,
        text,
        label,
        score: storyScore,
        ...createTranscriptSliceMetadata(
          label,
          text,
          storyScore,
          timing.startMs,
          timing.endMs,
          timing.speechStartMs,
          timing.speechEndMs,
          timing.boundaryPaddingBeforeMs,
          timing.boundaryPaddingAfterMs,
          risks,
          candidateSegments.length,
          transcriptSpeechDurationMs,
          transcriptTexts,
        ),
        ...contentArcMetadata,
        ...topicCoherenceMetadata,
      });
    }
  }

  return candidates;
}

function hasExplicitContentSectionOpening(text: string) {
  const trimmedText = text.trim();
  const normalizedText = trimmedText.toLowerCase();
  const strippedNormalizedText = stripLeadingWeakConnector(trimmedText).toLowerCase();
  const strippedText = stripLeadingWeakConnector(trimmedText);

  return ENGLISH_CONTENT_SECTION_OPENING_PATTERN.test(strippedNormalizedText) ||
    ENGLISH_REVERSED_CONTENT_SECTION_OPENING_PATTERN.test(strippedNormalizedText) ||
    ENGLISH_ORDINAL_ONLY_CONTENT_SECTION_OPENING_PATTERN.test(strippedNormalizedText) ||
    ENGLISH_NUMBER_WORD_CONTENT_SECTION_OPENING_PATTERN.test(strippedNormalizedText) ||
    ENGLISH_NUMERIC_CONTENT_SECTION_OPENING_PATTERN.test(strippedNormalizedText) ||
    ENGLISH_LETTER_CONTENT_SECTION_OPENING_PATTERN.test(strippedNormalizedText) ||
    ENGLISH_GENERIC_ENUMERATED_CONTENT_HEADING_PATTERN.test(strippedNormalizedText) ||
    /^(?:\u7b2c[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\d]+(?:\u70b9|\u4e2a|\u6761|\u6b65|\u90e8\u5206|\u7ae0|\u8282|\u8bfe|\u79cd|\u7c7b|\u4ef6|(?=\u4e3a\u4ec0\u4e48|\u600e\u4e48|\u5982\u4f55|\u95ee\u9898|\u75db\u70b9|\u539f\u56e0|\u6848\u4f8b|\u65b9\u6cd5|\u89e3\u51b3|\u4fee\u590d|\u662f))|\u5176[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341](?=\u4e3a\u4ec0\u4e48|\u600e\u4e48|\u5982\u4f55|\u95ee\u9898|\u75db\u70b9|\u539f\u56e0|\u6848\u4f8b|\u65b9\u6cd5|\u89e3\u51b3|\u4fee\u590d|\u5f00\u5934|\u6fc0\u6d3b|\u8bbe\u7f6e|\u7528\u6237|\u9996\u5c4f|\u662f)|[ABC]\u65b9\u6848(?=\u4e3a\u4ec0\u4e48|\u600e\u4e48|\u5982\u4f55|\u95ee\u9898|\u75db\u70b9|\u539f\u56e0|\u6848\u4f8b|\u65b9\u6cd5|\u89e3\u51b3|\u4fee\u590d|\u5f00\u5934|\u6fc0\u6d3b|\u8bbe\u7f6e|\u7528\u6237|\u9996\u5c4f)|\u9996\u5148|\u5176\u6b21|\u518d\u6b21|\u53e6\u5916|\u63a5\u4e0b\u6765)[\s\uff1a:\uff0c,\u3001]?/u.test(strippedText) ||
    /^(?:第[一二三四五六七八九十百\d]+(?:点|个|条|步|部分|章|节|招|种|类|件|(?=为什么|怎么|如何|问题|痛点|原因|案例|方法|解决|修复|开头|激活|设置|用户|首屏|是))|[一二三四五六七八九十](?=为什么|怎么|如何|问题|痛点|原因|案例|方法|解决|修复|开头|激活|设置|用户|首屏|是)|其[一二三四五六七八九十](?=为什么|怎么|如何|问题|痛点|原因|案例|方法|解决|修复|开头|激活|设置|用户|首屏|是)|[ABC]方案(?=为什么|怎么|如何|问题|痛点|原因|案例|方法|解决|修复|开头|激活|设置|用户|首屏)|首先|其次|再次|另外|接下来)[,，:：\s]?/u.test(normalizedText);
}

function startsFreshStandaloneContentStoryOpening(text: string) {
  const openingText = stripLeadingWeakConnector(text);
  const contentArcStages = inferContentArcStages(openingText);
  const hasStrongHook = contentArcStages.includes('hook') && inferHookStrength(openingText) === 'strong';
  return hasStrongHook && (
    !hasExplicitContentSectionOpening(text) ||
      contentArcStages.includes('conflict') ||
      contentArcStages.includes('payoff')
  );
}

function isCompleteSemanticStoryText(texts: readonly string[]) {
  if (texts.length === 0) {
    return false;
  }

  const text = texts.join(' ').trim();
  if (!text) {
    return false;
  }

  const contentArcMetadata = createContentArcMetadata(text);
  const topicCoherenceMetadata = createTopicCoherenceMetadataFromTexts(texts);
  const endingCompleteness = inferEndingCompleteness(text);
  return contentArcMetadata.contentArcGrade === 'complete' &&
    inferTranscriptStoryShape(text) === 'complete' &&
    topicCoherenceMetadata.topicCoherenceGrade !== 'weak' &&
    (
      endingCompleteness === 'complete' ||
      (texts.length >= MIN_SEMANTIC_STORY_MERGE_SEGMENTS && endingCompleteness === 'soft')
    );
}

function hasFreshSemanticStoryBoundaryInsideWindow(
  segments: readonly TranscriptPlanningSegment[],
  startIndex: number,
  endIndex: number,
) {
  for (let splitIndex = startIndex + 1; splitIndex <= endIndex; splitIndex += 1) {
    const currentSegment = segments[splitIndex];
    if (!currentSegment) {
      continue;
    }

    if (
      hasExplicitContentSectionOpening(currentSegment.text) &&
      !hasExplicitContentSectionOpening(segments[startIndex]?.text ?? '')
    ) {
      return true;
    }

    if (!startsFreshStandaloneContentStoryOpening(currentSegment.text)) {
      continue;
    }

    const previousTexts = segments
      .slice(startIndex, splitIndex)
      .map((segment) => segment.text);
    if (isCompleteSemanticStoryText(previousTexts)) {
      return true;
    }
  }

  return false;
}

function createContentTopicSegmentCandidates(
  params: VideoSliceParams,
  policy: VideoSlicePlanningPolicy,
  segments: readonly TranscriptPlanningSegment[],
  minDurationMs: number,
  maxDurationMs: number,
  existingCandidateCount: number,
): TranscriptSliceCandidate[] {
  const candidates: TranscriptSliceCandidate[] = [];
  const seenRanges = new Set<string>();

  let startIndex = 0;
  while (startIndex < segments.length) {
    const startSegment = segments[startIndex];
    if (!startSegment) {
      startIndex += 1;
      continue;
    }
    if (isCompleteSemanticStoryText([startSegment.text])) {
      startIndex += 1;
      continue;
    }

    let endIndex = startIndex;
    const topicTexts = [startSegment.text];
    while (endIndex + 1 < segments.length && endIndex + 1 < startIndex + MAX_SEMANTIC_STORY_MERGE_SEGMENTS) {
      const currentSegment = segments[endIndex];
      const nextSegment = segments[endIndex + 1];
      if (!currentSegment || !nextSegment || !canJoinTranscriptSegments(currentSegment, nextSegment, policy)) {
        break;
      }

      if (
        shouldStartNewContentTopicBlock(topicTexts, nextSegment.text) &&
        canFormFollowingContentTopicBlock(segments, endIndex + 1, policy, maxDurationMs)
      ) {
        break;
      }

      const proposedTiming = createTranscriptBoundaryTiming(segments, startIndex, endIndex + 1, policy, maxDurationMs);
      if (!proposedTiming || proposedTiming.speechEndMs - proposedTiming.speechStartMs > maxDurationMs) {
        break;
      }

      endIndex += 1;
      topicTexts.push(nextSegment.text);
    }

    if (endIndex < startIndex + MIN_CONTENT_TOPIC_SEGMENT_COUNT - 1) {
      startIndex = Math.max(endIndex + 1, startIndex + 1);
      continue;
    }

    const timing = createTranscriptBoundaryTiming(segments, startIndex, endIndex, policy, maxDurationMs);
    if (!timing) {
      startIndex = Math.max(endIndex + 1, startIndex + 1);
      continue;
    }

    const rangeKey = `${timing.speechStartMs}:${timing.speechEndMs}`;
    if (seenRanges.has(rangeKey)) {
      startIndex = Math.max(endIndex + 1, startIndex + 1);
      continue;
    }
    seenRanges.add(rangeKey);

    const candidateSegments = segments.slice(startIndex, endIndex + 1);
    const transcriptTexts = candidateSegments.map((segment) => segment.text);
    const text = transcriptTexts.join(' ').trim();
    const topicCoherenceMetadata = createTopicCoherenceMetadataFromTexts(transcriptTexts);
    if (topicCoherenceMetadata.topicCoherenceGrade === 'weak') {
      startIndex = Math.max(endIndex + 1, startIndex + 1);
      continue;
    }

    const transcriptSpeechDurationMs = candidateSegments.reduce(
      (durationSumMs, segment) => durationSumMs + Math.max(0, segment.endMs - segment.startMs),
      0,
    );
    const baseScore = scoreTranscriptCandidate(
      params,
      policy,
      text,
      timing.durationMs,
      minDurationMs,
      maxDurationMs,
      transcriptTexts,
    );
    const hasInternalRepeatedMeaning = hasTranscriptInternalRepeatedMeaning(transcriptTexts);
    if (hasInternalRepeatedMeaning) {
      startIndex = Math.max(endIndex + 1, startIndex + 1);
      continue;
    }
    const topicScore = clampSlicePlannerScore(
      baseScore +
        0.16 +
        topicCoherenceMetadata.topicCoherenceScore * 0.08 +
        Math.min(0.1, candidateSegments.length * 0.025),
    );
    const label = createTranscriptSliceLabel(segments, startIndex);
    const risks = [
      CONTENT_TOPIC_SEGMENT_RISK,
      ...(candidateSegments.slice(1).some((segment) => startsWithWeakConnector(segment.text))
        ? ['connector-repaired']
        : []),
      ...(candidateSegments.some((segment) => (segment.noiseBridgeBeforeMs ?? 0) > 0)
        ? ['transcript-noise-bridge-repaired']
        : []),
      ...(hasTranscriptSegmentOverlapRepair(candidateSegments, policy) ? ['transcript-overlap-repaired'] : []),
      ...(hasInternalRepeatedMeaning ? ['transcript-internal-repeat'] : []),
    ];
    const metadata = createTranscriptSliceMetadata(
      label,
      text,
      topicScore,
      timing.startMs,
      timing.endMs,
      timing.speechStartMs,
      timing.speechEndMs,
      timing.boundaryPaddingBeforeMs,
      timing.boundaryPaddingAfterMs,
      risks,
      candidateSegments.length,
      transcriptSpeechDurationMs,
      transcriptTexts,
    );
    const contentArcMetadata = createContentArcMetadata(text);

    candidates.push({
      candidateId: `content-topic-${startIndex + 1}-${endIndex + 1}`,
      index: existingCandidateCount + candidates.length,
      anchorSegmentIndex: startIndex,
      startMs: timing.startMs,
      endMs: timing.endMs,
      durationMs: timing.durationMs,
      text,
      label,
      score: topicScore,
      ...metadata,
      ...contentArcMetadata,
      ...topicCoherenceMetadata,
    });

    startIndex = endIndex + 1;
  }

  return candidates;
}

function createSilenceCompactedTopicCandidates(
  params: VideoSliceParams,
  policy: VideoSlicePlanningPolicy,
  segments: readonly TranscriptPlanningSegment[],
  minDurationMs: number,
  maxDurationMs: number,
  existingCandidateCount: number,
): TranscriptSliceCandidate[] {
  const candidates: TranscriptSliceCandidate[] = [];
  const seenRanges = new Set<string>();

  for (let startIndex = 0; startIndex < segments.length; startIndex += 1) {
    const startSegment = segments[startIndex];
    if (!startSegment || isCompleteSemanticStoryText([startSegment.text])) {
      continue;
    }

    const topicTexts = [startSegment.text];
    for (
      let endIndex = startIndex + 1;
      endIndex < Math.min(segments.length, startIndex + MAX_SEMANTIC_STORY_MERGE_SEGMENTS);
      endIndex += 1
    ) {
      const previousSegment = segments[endIndex - 1];
      const currentSegment = segments[endIndex];
      if (
        !previousSegment ||
        !currentSegment ||
        !canBridgeTranscriptSegmentsWithSilenceCompaction(previousSegment, currentSegment, policy)
      ) {
        break;
      }

      if (
        shouldStartNewContentTopicBlock(topicTexts, currentSegment.text) &&
        canFormFollowingContentTopicBlock(segments, endIndex, policy, maxDurationMs)
      ) {
        break;
      }

      topicTexts.push(currentSegment.text);
      if (topicTexts.length < MIN_CONTENT_TOPIC_SEGMENT_COUNT) {
        continue;
      }

      const timing = createSilenceCompactedTranscriptBoundaryTiming(
        segments,
        startIndex,
        endIndex,
        policy,
        maxDurationMs,
      );
      if (!timing || timing.renderedDurationMs < minDurationMs) {
        continue;
      }

      const candidateSegments = segments.slice(startIndex, endIndex + 1);
      const transcriptTexts = candidateSegments.map((segment) => segment.text);
      const text = transcriptTexts.join(' ').trim();
      const topicCoherenceMetadata = createTopicCoherenceMetadataFromTexts(transcriptTexts);
      if (topicCoherenceMetadata.topicCoherenceGrade === 'weak') {
        continue;
      }

      const contentArcMetadata = createContentArcMetadata(text);
      if (contentArcMetadata.contentArcGrade !== 'complete' && !hasContentTopicReleaseStructure({
        ...contentArcMetadata,
        topicCoherenceGrade: topicCoherenceMetadata.topicCoherenceGrade,
        transcriptSegmentCount: candidateSegments.length,
        transcriptText: text,
        transcriptSegmentTexts: transcriptTexts,
        endingCompleteness: inferEndingCompleteness(text),
      })) {
        continue;
      }

      const hasInternalRepeatedMeaning = hasTranscriptInternalRepeatedMeaning(transcriptTexts);
      if (hasInternalRepeatedMeaning) {
        continue;
      }

      const rangeKey = `${timing.sourceSegments[0]?.startMs}:${timing.sourceSegments.at(-1)?.endMs}`;
      if (seenRanges.has(rangeKey)) {
        continue;
      }
      seenRanges.add(rangeKey);

      const transcriptSpeechDurationMs = candidateSegments.reduce(
        (durationSumMs, segment) => durationSumMs + Math.max(0, segment.endMs - segment.startMs),
        0,
      );
      const baseScore = scoreTranscriptCandidate(
        params,
        policy,
        text,
        timing.renderedDurationMs,
        minDurationMs,
        maxDurationMs,
        transcriptTexts,
      );
      const topicScore = clampSlicePlannerScore(
        baseScore +
          0.13 +
          topicCoherenceMetadata.topicCoherenceScore * 0.08 +
          Math.min(0.1, candidateSegments.length * 0.025),
      );
      const label = createTranscriptSliceLabel(segments, startIndex);
      const risks = [
        CONTENT_TOPIC_SEGMENT_RISK,
        'internal-silence-trimmed',
        ...(candidateSegments.slice(1).some((segment) => startsWithWeakConnector(segment.text))
          ? ['connector-repaired']
          : []),
        ...(candidateSegments.some((segment) => (segment.noiseBridgeBeforeMs ?? 0) > 0)
          ? ['transcript-noise-bridge-repaired']
          : []),
        ...(hasTranscriptSegmentOverlapRepair(candidateSegments, policy) ? ['transcript-overlap-repaired'] : []),
      ];
      const metadata = createTranscriptSliceMetadata(
        label,
        text,
        topicScore,
        timing.startMs,
        timing.endMs,
        timing.speechStartMs,
        timing.speechEndMs,
        timing.boundaryPaddingBeforeMs,
        timing.boundaryPaddingAfterMs,
        risks,
        candidateSegments.length,
        transcriptSpeechDurationMs,
        transcriptTexts,
      );

      candidates.push({
        candidateId: `silence-topic-${startIndex + 1}-${endIndex + 1}`,
        index: existingCandidateCount + candidates.length,
        anchorSegmentIndex: startIndex,
        startMs: timing.startMs,
        endMs: timing.endMs,
        durationMs: timing.durationMs,
        text,
        label,
        score: topicScore,
        ...metadata,
        ...contentArcMetadata,
        ...topicCoherenceMetadata,
        sourceSegments: timing.sourceSegments,
        renderedDurationMs: timing.renderedDurationMs,
        removedSilenceMs: timing.removedSilenceMs,
        internalSilenceTrimCount: timing.internalSilenceTrimCount,
      });
    }
  }

  return candidates;
}

function hasStructuredSemanticStoryContinuation(
  segments: readonly TranscriptPlanningSegment[],
  startIndex: number,
  endIndex: number,
) {
  const startSegment = segments[startIndex];
  if (!startSegment) {
    return false;
  }

  if (
    !hasExplicitContentSectionOpening(startSegment.text) &&
    !startsFreshStandaloneContentStoryOpening(startSegment.text)
  ) {
    return false;
  }

  for (let index = startIndex + 1; index <= endIndex; index += 1) {
    const segment = segments[index];
    if (!segment) {
      continue;
    }

    if (
      hasExplicitContentSectionOpening(segment.text) ||
      startsFreshStandaloneContentStoryOpening(segment.text)
    ) {
      continue;
    }

    const stages = inferContentArcStages(segment.text);
    if (
      startsWithWeakConnector(segment.text) ||
      stages.includes('setup') ||
      stages.includes('payoff') ||
      inferEndingCompleteness(segment.text) === 'complete'
    ) {
      return true;
    }
  }

  return false;
}

function candidatesHaveIncompleteSemanticOverlap(
  segments: readonly TranscriptPlanningSegment[],
  startIndex: number,
  endIndex: number,
  mergedStages: readonly SliceContentArcStage[],
) {
  const mergedStageSet = new Set(mergedStages);
  let singleSegmentCompleteCount = 0;
  let incompleteSegmentCount = 0;
  let fragmentSegmentCount = 0;

  for (let index = startIndex; index <= endIndex; index += 1) {
    const segment = segments[index];
    if (!segment) {
      continue;
    }
    fragmentSegmentCount += 1;
    const segmentArc = createContentArcMetadata(segment.text);
    if (segmentArc.contentArcGrade === 'complete') {
      singleSegmentCompleteCount += 1;
    } else if (segmentArc.contentArcGrade === 'partial' || segmentArc.contentArcGrade === 'thin') {
      incompleteSegmentCount += 1;
    }

    for (const stage of segmentArc.contentArcStages) {
      mergedStageSet.add(stage);
    }
  }

  const hasIncompleteSemanticOverlap =
    incompleteSegmentCount > 0 &&
    singleSegmentCompleteCount < fragmentSegmentCount;
  const hasStructuredContinuation = hasStructuredSemanticStoryContinuation(segments, startIndex, endIndex);

  return fragmentSegmentCount >= MIN_SEMANTIC_STORY_MERGE_SEGMENTS &&
    (hasIncompleteSemanticOverlap || hasStructuredContinuation) &&
    CONTENT_ARC_STAGES.every((stage) => mergedStageSet.has(stage));
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

  const requestedDurationMs = Math.max(0, durationMs);
  const requestCoverageScore = requestedDurationMs > 0 ? bestOverlapMs / requestedDurationMs : 0;
  return bestCandidate &&
    bestOverlapMs >= MIN_LLM_TRANSCRIPT_SNAP_OVERLAP_MS &&
    requestCoverageScore >= MIN_LLM_TRANSCRIPT_SNAP_REQUEST_COVERAGE
    ? bestCandidate
    : undefined;
}

function findCompleteSemanticStoryCandidateForClip(
  transcriptCandidates: readonly TranscriptSliceCandidate[],
  clip: Pick<NormalizedSlicePlanClip, 'startMs' | 'durationMs' | 'contentArcGrade' | 'topicCoherenceGrade' | 'transcriptSegmentCount'>,
) {
  const clipEndMs = clip.startMs + clip.durationMs;
  const coveringStoryCandidates = transcriptCandidates.filter((candidate) =>
    candidate.risks?.includes('semantic-story-merged') &&
    candidate.contentArcGrade === 'complete' &&
    candidate.topicCoherenceGrade !== 'weak' &&
    candidate.startMs <= clip.startMs &&
    candidate.endMs >= clipEndMs &&
    (candidate.transcriptSegmentCount ?? 0) > (clip.transcriptSegmentCount ?? 0)
  );
  if (coveringStoryCandidates.length === 0) {
    return undefined;
  }

  const clipIsIncomplete = clip.contentArcGrade !== 'complete' || clip.topicCoherenceGrade === 'weak';
  if (!clipIsIncomplete) {
    return undefined;
  }

  return coveringStoryCandidates
    .slice()
    .sort((firstCandidate, secondCandidate) => {
      const firstSegmentCount = firstCandidate.transcriptSegmentCount ?? 0;
      const secondSegmentCount = secondCandidate.transcriptSegmentCount ?? 0;
      if (firstSegmentCount !== secondSegmentCount) {
        return secondSegmentCount - firstSegmentCount;
      }

      if (firstCandidate.score !== secondCandidate.score) {
        return secondCandidate.score - firstCandidate.score;
      }

      return firstCandidate.startMs - secondCandidate.startMs;
    })[0];
}

function isCompleteSemanticStoryCandidate(candidate: Partial<NormalizedSlicePlanClip>) {
  return candidate.risks?.includes('semantic-story-merged') === true &&
    candidate.contentArcGrade === 'complete' &&
    candidate.topicCoherenceGrade !== 'weak';
}

function isIncompleteSemanticStoryFragment(clip: Partial<NormalizedSlicePlanClip>) {
  return clip.contentArcGrade !== 'complete' ||
    clip.topicCoherenceGrade === 'weak' ||
    clip.risks?.some((risk) =>
      risk === 'sparse-transcript-speech' ||
      risk === 'missing-payoff' ||
      risk === 'missing-hook' ||
      risk === 'missing-setup' ||
      risk === 'missing-content-hook' ||
      risk === 'missing-content-setup' ||
      risk === 'missing-content-conflict' ||
      risk === 'missing-content-payoff'
    ) === true;
}

function doesSemanticStoryCandidateCoverClip(
  storyCandidate: NormalizedSlicePlanClip,
  clip: Pick<NormalizedSlicePlanClip, 'startMs' | 'durationMs'>,
) {
  const storyEndMs = storyCandidate.startMs + storyCandidate.durationMs;
  const clipEndMs = clip.startMs + clip.durationMs;
  return storyCandidate.startMs <= clip.startMs + SEMANTIC_STORY_FRAGMENT_BOUNDARY_TOLERANCE_MS &&
    storyEndMs + SEMANTIC_STORY_FRAGMENT_BOUNDARY_TOLERANCE_MS >= clipEndMs;
}

function shouldReplacePlanFragmentsWithSemanticStory(
  selectedPlan: readonly NormalizedSlicePlanClip[],
  storyCandidate: NormalizedSlicePlanClip,
) {
  const coveredClips = selectedPlan.filter((clip) =>
    doesSemanticStoryCandidateCoverClip(storyCandidate, clip),
  );
  if (coveredClips.length < 2) {
    return false;
  }

  const coveredSegmentCount = coveredClips.reduce(
    (count, clip) => count + Math.max(0, clip.transcriptSegmentCount ?? 0),
    0,
  );
  const storySegmentCount = storyCandidate.transcriptSegmentCount ?? 0;
  const hasIncompleteFragment = coveredClips.some(isIncompleteSemanticStoryFragment);

  return hasIncompleteFragment &&
    storySegmentCount >= Math.max(coveredSegmentCount, MIN_SEMANTIC_STORY_MERGE_SEGMENTS);
}

function repairSelectedPlanSemanticStoryFragments(
  selectedPlan: readonly NormalizedSlicePlanClip[],
  candidates: readonly NormalizedSlicePlanClip[],
  policy: VideoSlicePlanningPolicy,
  enableRepeatFilter: boolean,
) {
  if (selectedPlan.length <= 1) {
    return [...selectedPlan];
  }

  const storyCandidates = candidates
    .filter(isCompleteSemanticStoryCandidate)
    .filter((storyCandidate) =>
      shouldReplacePlanFragmentsWithSemanticStory(selectedPlan, storyCandidate),
    )
    .sort((firstCandidate, secondCandidate) => {
      const firstCoveredCount = selectedPlan.filter((clip) =>
        doesSemanticStoryCandidateCoverClip(firstCandidate, clip),
      ).length;
      const secondCoveredCount = selectedPlan.filter((clip) =>
        doesSemanticStoryCandidateCoverClip(secondCandidate, clip),
      ).length;
      if (firstCoveredCount !== secondCoveredCount) {
        return secondCoveredCount - firstCoveredCount;
      }

      const firstSegmentCount = firstCandidate.transcriptSegmentCount ?? 0;
      const secondSegmentCount = secondCandidate.transcriptSegmentCount ?? 0;
      if (firstSegmentCount !== secondSegmentCount) {
        return secondSegmentCount - firstSegmentCount;
      }

      const firstScore = getClipSelectionScore(firstCandidate, policy);
      const secondScore = getClipSelectionScore(secondCandidate, policy);
      if (firstScore !== secondScore) {
        return secondScore - firstScore;
      }

      return firstCandidate.startMs - secondCandidate.startMs;
    });

  let repairedPlan = sortSliceClipsByStartMs([...selectedPlan]);
  for (const storyCandidate of storyCandidates) {
    if (
      repairedPlan.some((clip) =>
        clip !== storyCandidate &&
        doSliceCandidatesOverlap(clip, storyCandidate) &&
        !doesSemanticStoryCandidateCoverClip(storyCandidate, clip)
      )
    ) {
      continue;
    }

    if (!shouldReplacePlanFragmentsWithSemanticStory(repairedPlan, storyCandidate)) {
      continue;
    }

    const nextPlan = sortSliceClipsByStartMs([
      ...repairedPlan.filter((clip) => !doesSemanticStoryCandidateCoverClip(storyCandidate, clip)),
      storyCandidate,
    ]);
    if (isSliceCandidatePlanInternallyCompatible(nextPlan, enableRepeatFilter)) {
      repairedPlan = nextPlan;
    }
  }

  return repairedPlan;
}

function repairSelectedPlanContentTopicSegments(
  selectedPlan: readonly NormalizedSlicePlanClip[],
  candidates: readonly NormalizedSlicePlanClip[],
  policy: VideoSlicePlanningPolicy,
  enableRepeatFilter: boolean,
) {
  const topicCandidates = sortSliceClipsByStartMs(
    candidates.filter((candidate) => isContentTopicReleaseCandidate(candidate, policy)),
  );
  if (topicCandidates.length === 0) {
    return [...selectedPlan];
  }

  let repairedPlan = sortSliceClipsByStartMs([...selectedPlan]);
  for (const topicCandidate of topicCandidates) {
    const overlappingClips = repairedPlan.filter((clip) =>
      doSliceCandidatesOverlap(clip, topicCandidate) ||
        (enableRepeatFilter && areTranscriptSliceClipsRepeated(clip, topicCandidate))
    );
    if (
      overlappingClips.length === 0 &&
      isSliceCandidateCompatibleWithPlan(repairedPlan, topicCandidate, enableRepeatFilter)
    ) {
      repairedPlan = sortSliceClipsByStartMs([...repairedPlan, topicCandidate]);
      continue;
    }

    if (
      overlappingClips.length > 0 &&
      overlappingClips.every((clip) =>
        !isCompleteSemanticStoryCandidate(clip) &&
        !isContentTopicReleaseCandidate(clip, policy)
      )
    ) {
      const nextPlan = sortSliceClipsByStartMs([
        ...repairedPlan.filter((clip) => !overlappingClips.includes(clip)),
        topicCandidate,
      ]);
      if (isSliceCandidatePlanInternallyCompatible(nextPlan, enableRepeatFilter)) {
        repairedPlan = nextPlan;
      }
    }
  }

  return repairedPlan;
}

function repairIncompleteSemanticStorySelections(
  clips: readonly NormalizedSlicePlanClip[],
  transcriptCandidates: readonly TranscriptSliceCandidate[],
) {
  if (clips.length === 0 || transcriptCandidates.length === 0) {
    return [...clips];
  }

  const repairedClips = clips.map((clip) => {
    const completeStoryCandidate = findCompleteSemanticStoryCandidateForClip(transcriptCandidates, clip);
    return completeStoryCandidate ?? clip;
  });
  const dedupedByRange = new Map<string, NormalizedSlicePlanClip>();
  for (const clip of repairedClips) {
    const rangeKey = `${clip.startMs}:${clip.durationMs}`;
    const existingClip = dedupedByRange.get(rangeKey);
    if (
      !existingClip ||
      (
        clip.risks?.includes('semantic-story-merged') &&
        !existingClip.risks?.includes('semantic-story-merged')
      )
    ) {
      dedupedByRange.set(rangeKey, clip);
    }
  }

  return Array.from(dedupedByRange.values());
}

function selectNaturalStrongContentDerivedCandidatePlan(
  candidates: readonly NormalizedSlicePlanClip[],
  policy: VideoSlicePlanningPolicy,
  enableRepeatFilter: boolean,
) {
  const releaseCandidates = sortSliceClipsByStartMs(
    candidates.filter((candidate) => isContentDerivedReleaseClip(candidate, policy)),
  );
  if (releaseCandidates.length === 0) {
    return [];
  }

  const selectedCandidates: NormalizedSlicePlanClip[] = [];
  for (const candidate of releaseCandidates) {
    if (isSliceCandidateCompatibleWithPlan(selectedCandidates, candidate, enableRepeatFilter)) {
      selectedCandidates.push(candidate);
      continue;
    }

    const overlappingIndex = selectedCandidates.findIndex((selectedCandidate) =>
      doSliceCandidatesOverlap(selectedCandidate, candidate) ||
        (enableRepeatFilter && areTranscriptSliceClipsRepeated(selectedCandidate, candidate))
    );
    const overlappingCandidate = overlappingIndex >= 0 ? selectedCandidates[overlappingIndex] : undefined;
    if (
      overlappingCandidate &&
      compareSliceCandidateSets([candidate], [overlappingCandidate], policy) > 0
    ) {
      selectedCandidates[overlappingIndex] = candidate;
    }
  }

  return sortSliceClipsByStartMs(selectedCandidates);
}

function createLlmTimingRisks(
  existingRisks: readonly string[] | undefined,
  matchedCandidate: TranscriptSliceCandidate | undefined,
  snappedToTranscript: boolean,
) {
  return mergePlanRisks(
    existingRisks,
    matchedCandidate?.risks,
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
  transcriptTexts: readonly string[] = [text],
) {
  const normalizedText = text.toLowerCase();
  const targetDurationMs = Math.min(maxDurationMs, Math.max(minDurationMs, policy.idealDurationMs));
  const durationDistance = Math.abs(durationMs - targetDurationMs) / Math.max(targetDurationMs, 1);
  let score = 0.55 + Math.max(0, 0.2 - durationDistance * 0.2);

  if (params.highlightEngine === 'keyword' && containsAnyTextMarker(normalizedText, [
    'important',
    'key',
    'reason',
    'result',
    'tip',
    'case',
    'method',
    'benefit',
    'conversion',
  ])) {
    score += 0.18;
  }

  if (params.highlightEngine === 'emotion' && containsAnyTextMarker(normalizedText, [
    'wow',
    'amazing',
    'surprise',
    'pain',
    'love',
    'risk',
    'success',
    'failure',
  ])) {
    score += 0.18;
  }

  if (params.highlightEngine === 'motion' && containsAnyTextMarker(normalizedText, [
    'show',
    'demo',
    'watch',
    'move',
    'operation',
    'process',
  ])) {
    score += 0.14;
  }

  if (params.mode === 'commerce-live' && containsAnyTextMarker(normalizedText, [
    'price',
    'offer',
    'buy',
    'product',
    'discount',
    'stock',
    'order',
  ])) {
    score += 0.16;
  }

  if (params.mode === 'talking-head' && containsAnyTextMarker(normalizedText, [
    'lesson',
    'explain',
    'framework',
    'method',
    'summary',
    'reason',
    'case',
  ])) {
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

  if (hasTranscriptInternalRepeatedMeaning(transcriptTexts)) {
    score -= 0.18;
  }

  return Math.max(0, Math.min(1, score));
}

function containsAnyTextMarker(text: string, markers: readonly string[]) {
  return markers.some((marker) => text.includes(marker));
}

export function buildTranscriptSliceCandidates(
  params: VideoSliceParams,
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
  options: BuildTranscriptSliceCandidatesOptions = {},
): TranscriptSliceCandidate[] {
  const { minDurationMs, maxDurationMs } = getVideoSliceDurationBounds(params);
  const policy = getVideoSlicePlanningPolicy(params);
  const segments = normalizeTranscriptSegments(transcriptSegments);
  const candidatePoolLimit = getTranscriptSliceCandidatePoolLimit(policy);
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
      while (startIndex > 0) {
        const currentStartSegment = segments[startIndex];
        const previousStartSegment = segments[startIndex - 1];
        if (
          !currentStartSegment ||
          !previousStartSegment ||
          !startsWithWeakConnector(currentStartSegment.text) ||
          !canJoinTranscriptSegments(previousStartSegment, currentStartSegment, policy) ||
          anchorSegment.endMs - previousStartSegment.startMs > maxDurationMs
        ) {
          break;
        }

        startIndex -= 1;
      }
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
      maxDurationMs,
    );
    if (!timing || timing.durationMs < MIN_TRANSCRIPT_ALIGNED_SLICE_DURATION_MS) {
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
    const transcriptTexts = candidateSegments.map((segment) => segment.text);
    const hasInternalRepeatedMeaning = hasTranscriptInternalRepeatedMeaning(transcriptTexts);
    const score = scoreTranscriptCandidate(
      params,
      policy,
      text,
      durationMs,
      minDurationMs,
      maxDurationMs,
      transcriptTexts,
    );
    const joinsConnectorInsideWindow = candidateSegments
      .slice(1)
      .some((segment) => startsWithWeakConnector(segment.text));
    const risks = [
      ...(repairedConnectorStart || joinsConnectorInsideWindow ? ['connector-repaired'] : []),
      ...(extendedTrailingConnector ? ['trailing-connector-extended'] : []),
      ...(extendedOpenSentence ? ['open-sentence-extended'] : []),
      ...(hasTranscriptSegmentOverlapRepair(candidateSegments, policy) ? ['transcript-overlap-repaired'] : []),
      ...(candidateSegments.some((segment) => (segment.noiseBridgeBeforeMs ?? 0) > 0)
        ? ['transcript-noise-bridge-repaired']
        : []),
      ...(hasInternalRepeatedMeaning ? ['transcript-internal-repeat'] : []),
      ...(candidateSegments.length <= 1 || durationMs < minDurationMs ? ['sparse-transcript-speech'] : []),
      ...(durationMs < minDurationMs ? ['short-transcript-window'] : []),
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
        transcriptTexts,
      ),
    });
    if (candidates.length > candidatePoolLimit * 2) {
      candidates.splice(
        0,
        candidates.length,
        ...pruneTranscriptSliceCandidatePool(candidates, policy, candidatePoolLimit),
      );
    }
  }

  candidates.push(...createSemanticStoryMergeCandidates(
    params,
    policy,
    segments,
    minDurationMs,
    maxDurationMs,
    candidates.length,
  ));
  candidates.push(...createContentTopicSegmentCandidates(
    params,
    policy,
    segments,
    minDurationMs,
    maxDurationMs,
    candidates.length,
  ));
  candidates.push(...createSilenceCompactedTopicCandidates(
    params,
    policy,
    segments,
    minDurationMs,
    maxDurationMs,
    candidates.length,
  ));

  const enrichedCandidates = candidates.map((candidate) => ({
    ...candidate,
    ...createPlatformReadinessMetadata(candidate, policy),
  }));
  const repeatedFilteredCandidates = filterRepeatedTranscriptCandidates(
    enrichedCandidates,
    options.disableRepeatFilter ? false : params.enableRepeatFilter,
  );
  return selectContentDerivedCandidateOutputPool(repeatedFilteredCandidates, policy, candidatePoolLimit);
}

export function createDeterministicSlicePlan(params: VideoSliceParams): NormalizedSlicePlanClip[] {
  void params;
  return [];
}

export function createTranscriptAssistedSlicePlan(
  params: VideoSliceParams,
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
): NormalizedSlicePlanClip[] {
  const candidates = buildTranscriptSliceCandidates(params, transcriptSegments);
  const coverageCandidates = params.enableRepeatFilter
    ? buildTranscriptSliceCandidates(params, transcriptSegments, { disableRepeatFilter: true })
    : candidates;

  if (candidates.length === 0) {
    return transcriptSegments.length === 0 ? createDeterministicSlicePlan(params) : [];
  }

  const normalizedPlan = normalizeCandidateSlicePlan(candidates, params);
  const policy = getVideoSlicePlanningPolicy(params);
  const releasePlan = selectContentDerivedReleasePlan(normalizedPlan, policy);
  const coverageCandidatePlan = normalizeCandidateSlicePlanForCoverageRepair(coverageCandidates, params);
  return repairReleasePlanSpeechCoverage(
    releasePlan,
    coverageCandidatePlan,
    transcriptSegments,
    policy,
    params.enableRepeatFilter,
  );
}

function selectContentDerivedReleasePlan(
  clips: readonly NormalizedSlicePlanClip[],
  policy: VideoSlicePlanningPolicy,
): NormalizedSlicePlanClip[] {
  const contentDerivedReleaseClips = clips.filter((clip) => isContentDerivedReleaseClip(clip, policy));
  const releaseClips = contentDerivedReleaseClips.length > 0
    ? contentDerivedReleaseClips
    : clips.filter((clip) =>
        (
          isTranscriptBackedReviewReleaseClip(clip) ||
          (
            isSparseTranscriptReviewClip(clip) &&
            !isIncompletePayoffSparseTranscriptReviewClip(clip)
          )
        ) &&
        !isIsolatedPayoffFragmentCandidate(clip)
      );

  return releaseClips.map((clip, index) => ({ ...clip, index }));
}

function findMatchingContentDerivedReleaseClip(
  releaseClips: readonly NormalizedSlicePlanClip[],
  canonicalClip: NormalizedSlicePlanClip,
) {
  if (canonicalClip.candidateId) {
    const candidateIdMatch = releaseClips.find((clip) => clip.candidateId === canonicalClip.candidateId);
    if (candidateIdMatch) {
      return candidateIdMatch;
    }
  }

  const exactRangeMatch = releaseClips.find((clip) =>
    clip.startMs === canonicalClip.startMs &&
    clip.durationMs === canonicalClip.durationMs
  );
  if (exactRangeMatch) {
    return exactRangeMatch;
  }

  return releaseClips.find((clip) =>
    calculateClipOverlapRatio(clip, canonicalClip) >= 0.95 &&
    (
      !canonicalClip.transcriptText ||
      !clip.transcriptText ||
      normalizeTranscriptTextForRepeatDetection(clip.transcriptText) ===
        normalizeTranscriptTextForRepeatDetection(canonicalClip.transcriptText)
    )
  );
}

function applyLlmPresentationMetadataToCanonicalClip(
  canonicalClip: NormalizedSlicePlanClip,
  llmClip: NormalizedSlicePlanClip | undefined,
  index: number,
): NormalizedSlicePlanClip {
  const risks = mergePlanRisks(canonicalClip.risks, llmClip?.risks);

  return {
    ...canonicalClip,
    index,
    ...(llmClip?.label ? { label: llmClip.label } : {}),
    ...(llmClip?.title ? { title: llmClip.title } : {}),
    ...(llmClip?.summary ? { summary: llmClip.summary } : {}),
    ...(llmClip?.reason ? { reason: llmClip.reason } : {}),
    ...(risks ? { risks } : {}),
  };
}

function selectCanonicalContentDerivedReleasePlan(
  releasePlan: readonly NormalizedSlicePlanClip[],
  fallbackPlan: readonly NormalizedSlicePlanClip[],
  policy: VideoSlicePlanningPolicy,
): NormalizedSlicePlanClip[] {
  if (fallbackPlan.length === 0) {
    return releasePlan.map((clip, index) => ({ ...clip, index }));
  }

  const releaseMetadataClips = releasePlan.filter((clip) =>
    isContentDerivedReleaseClip(clip, policy) ||
      isTranscriptBackedReviewReleaseClip(clip) ||
      isSparseTranscriptReviewClip(clip)
  );
  const extraContentDerivedReleaseClips = releasePlan.filter((clip) =>
    isContentDerivedReleaseClip(clip, policy)
  );
  const canonicalReleaseClips = fallbackPlan.map((canonicalClip, index) =>
    applyLlmPresentationMetadataToCanonicalClip(
      canonicalClip,
      findMatchingContentDerivedReleaseClip(releaseMetadataClips, canonicalClip),
      index,
    )
  );
  const canonicalMatchesReleaseClip = (releaseClip: NormalizedSlicePlanClip) =>
    canonicalReleaseClips.some((canonicalClip) =>
      findMatchingContentDerivedReleaseClip([releaseClip], canonicalClip) !== undefined
    );
  const mergedReleaseClips = sortSliceClipsByStartMs([
    ...canonicalReleaseClips,
    ...extraContentDerivedReleaseClips.filter((releaseClip) =>
      !canonicalMatchesReleaseClip(releaseClip) &&
      isSliceCandidateCompatibleWithPlan(canonicalReleaseClips, releaseClip, true)
    ),
  ]);

  return mergedReleaseClips.map((clip, index) => ({ ...clip, index }));
}

function normalizeCandidateSlicePlanWithQualityStandards(
  candidates: NormalizedSlicePlanClip[],
  params: VideoSliceParams,
): NormalizedSlicePlanClip[] {
  const { minDurationMs, maxDurationMs } = getVideoSliceDurationBounds(params);
  const policy = getVideoSlicePlanningPolicy(params);
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

      const metadata = pickPlanMetadata(clip);
      const minimumDurationMs = isTranscriptAlignedSliceClip(clip)
        ? MIN_TRANSCRIPT_ALIGNED_SLICE_DURATION_MS
        : minDurationMs;
      const maxCandidateDurationMs = policy.sourceDurationMs !== undefined
        ? Math.min(maxDurationMs, policy.sourceDurationMs - startMs)
        : maxDurationMs;
      if (maxCandidateDurationMs < minimumDurationMs) {
        return null;
      }

      const requestedDurationMs = Math.max(minimumDurationMs, Math.min(Math.round(clip.durationMs), maxDurationMs));
      const requestedSourceBoundedDurationMs = Math.min(requestedDurationMs, maxCandidateDurationMs);
      if (requestedSourceBoundedDurationMs < minimumDurationMs) {
        return null;
      }

      const guardedTiming = createSilenceGuardedSliceTiming(
        startMs,
        requestedSourceBoundedDurationMs,
        metadata,
        policy,
        minimumDurationMs,
      );
      if (!guardedTiming) {
        return null;
      }

      const durationMs = guardedTiming.durationMs;
      const normalizedStartMs = guardedTiming.startMs;
      const timingRisks = [
        ...(requestedSourceBoundedDurationMs < requestedDurationMs ? ['source-duration-tail'] : []),
        ...guardedTiming.risks,
      ];
      const timingMetadata = createNormalizedSliceTimingMetadata(metadata, normalizedStartMs, durationMs);
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
        startMs: normalizedStartMs,
        durationMs,
      }, policy);

      return {
        ...metadataWithSentenceBoundary,
        ...publishabilityMetadata,
        ...platformReadinessMetadata,
        index,
        startMs: normalizedStartMs,
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

  const releaseGradeCandidates = rawCandidates.filter((candidate) =>
    candidate.publishabilityGrade !== 'reject' &&
    candidate.platformReadinessGrade !== 'reject'
  );
  const sparseTranscriptReviewCandidates = rawCandidates.filter((candidate) =>
    isSparseTranscriptReviewClip(candidate) &&
    !isIncompletePayoffSparseTranscriptReviewClip(candidate) &&
    candidate.publishabilityGrade !== 'reject' &&
    candidate.platformReadinessGrade !== 'reject'
  );
  const selectableCandidates = releaseGradeCandidates.length > 0
    ? releaseGradeCandidates
    : sparseTranscriptReviewCandidates;
  const naturalStrongContentPlan = selectNaturalStrongContentDerivedCandidatePlan(
    selectableCandidates,
    policy,
    params.enableRepeatFilter,
  );
  const selectedCandidates = naturalStrongContentPlan.length > 0
    ? naturalStrongContentPlan
    : selectOptimalSliceCandidateSet(selectableCandidates, policy, params.enableRepeatFilter);
  const semanticallyRepairedCandidates = repairSelectedPlanSemanticStoryFragments(
    selectedCandidates,
    selectableCandidates,
    policy,
    params.enableRepeatFilter,
  );
  const topicRepairedCandidates = repairSelectedPlanContentTopicSegments(
    semanticallyRepairedCandidates,
    selectableCandidates,
    policy,
    params.enableRepeatFilter,
  );
  const normalizedCandidates = sortSliceClipsByStartMs(topicRepairedCandidates);
  return normalizedCandidates.map((candidate, index) => ({
    ...candidate,
    index,
  }));
}

export function normalizeCandidateSlicePlanForCoverageRepair(
  candidates: NormalizedSlicePlanClip[],
  params: VideoSliceParams,
): NormalizedSlicePlanClip[] {
  const { minDurationMs, maxDurationMs } = getVideoSliceDurationBounds(params);
  const policy = getVideoSlicePlanningPolicy(params);
  const normalizedCandidates = candidates
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

      const metadata = pickPlanMetadata(clip);
      const minimumDurationMs = isTranscriptAlignedSliceClip(clip)
        ? MIN_TRANSCRIPT_ALIGNED_SLICE_DURATION_MS
        : minDurationMs;
      const maxCandidateDurationMs = policy.sourceDurationMs !== undefined
        ? Math.min(maxDurationMs, policy.sourceDurationMs - startMs)
        : maxDurationMs;
      if (maxCandidateDurationMs < minimumDurationMs) {
        return null;
      }

      const requestedDurationMs = Math.max(minimumDurationMs, Math.min(Math.round(clip.durationMs), maxDurationMs));
      const requestedSourceBoundedDurationMs = Math.min(requestedDurationMs, maxCandidateDurationMs);
      if (requestedSourceBoundedDurationMs < minimumDurationMs) {
        return null;
      }

      const guardedTiming = createSilenceGuardedSliceTiming(
        startMs,
        requestedSourceBoundedDurationMs,
        metadata,
        policy,
        minimumDurationMs,
      );
      if (!guardedTiming) {
        return null;
      }

      const durationMs = guardedTiming.durationMs;
      const normalizedStartMs = guardedTiming.startMs;
      const timingRisks = [
        ...(requestedSourceBoundedDurationMs < requestedDurationMs ? ['source-duration-tail'] : []),
        ...guardedTiming.risks,
      ];
      const timingMetadata = createNormalizedSliceTimingMetadata(metadata, normalizedStartMs, durationMs);
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
        startMs: normalizedStartMs,
        durationMs,
      }, policy);

      return {
        ...metadataWithSentenceBoundary,
        ...publishabilityMetadata,
        ...platformReadinessMetadata,
        index,
        startMs: normalizedStartMs,
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

  return sortSliceClipsByStartMs(normalizedCandidates).map((candidate, index) => ({
    ...candidate,
    index,
  }));
}

export function normalizeCandidateSlicePlan(
  candidates: NormalizedSlicePlanClip[],
  params: VideoSliceParams,
): NormalizedSlicePlanClip[] {
  return normalizeCandidateSlicePlanWithQualityStandards(candidates, params);
}

function shouldRejectLlmPlanWithoutTranscriptEvidence(
  policy: VideoSlicePlanningPolicy,
  transcriptCandidates: readonly TranscriptSliceCandidate[],
) {
  void policy;
  return transcriptCandidates.length === 0;
}

function filterLlmFallbackPlanToTranscriptEvidence(
  fallbackPlan: NormalizedSlicePlanClip[],
) {
  const evidenceBackedFallbackPlan = fallbackPlan.filter((clip) =>
    (clip.transcriptSegmentCount ?? 0) > 0 &&
    typeof clip.transcriptText === 'string' &&
    clip.transcriptText.trim().length > 0 &&
    typeof clip.transcriptCoverageScore === 'number' &&
    Number.isFinite(clip.transcriptCoverageScore) &&
    clip.transcriptCoverageScore >= MIN_TRANSCRIPT_RENDER_SPEECH_COVERAGE_SCORE &&
    (clip.speechContinuityGrade === 'strong' || clip.speechContinuityGrade === 'repaired') &&
    (
      clip.risks?.includes('transcript-coverage-repaired') ||
      (
        clip.publishabilityGrade !== 'reject' &&
        clip.platformReadinessGrade !== 'reject'
      )
    ) &&
    !clip.risks?.includes('no-transcript-boundary')
  );
  return evidenceBackedFallbackPlan.length === fallbackPlan.length
    ? fallbackPlan
    : evidenceBackedFallbackPlan;
}

export function parseLlmSlicePlan(
  content: string,
  params: VideoSliceParams,
  fallbackPlan: NormalizedSlicePlanClip[],
  transcriptCandidatesOrSegments: readonly TranscriptSliceCandidate[] | readonly AutoCutSpeechTranscriptionSegment[] = [],
): NormalizedSlicePlanClip[] {
  const policy = getVideoSlicePlanningPolicy(params);
  const transcriptCandidates = resolveTranscriptSliceCandidates(params, transcriptCandidatesOrSegments);
  if (shouldRejectLlmPlanWithoutTranscriptEvidence(policy, transcriptCandidates)) {
    return [];
  }
  const evidenceBackedFallbackPlan = filterLlmFallbackPlanToTranscriptEvidence(fallbackPlan)
    .map((clip, index) => ({ ...clip, index }));

  const jsonStart = content.indexOf('[');
  const jsonEnd = content.lastIndexOf(']');
  if (jsonStart < 0 || jsonEnd <= jsonStart) {
    return evidenceBackedFallbackPlan;
  }

  try {
    const parsed = JSON.parse(content.slice(jsonStart, jsonEnd + 1));
    if (!Array.isArray(parsed)) {
      return evidenceBackedFallbackPlan;
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
        if (!matchedCandidate && transcriptCandidates.length > 0) {
          return null;
        }
        const startMs = matchedCandidate?.startMs ?? (Number.isFinite(requestedStartMs) ? requestedStartMs : undefined);
        const durationMs = matchedCandidate?.durationMs ?? requestedDurationValue;
        const rawLabel =
          typeof clip?.title === 'string'
            ? clip.title
            : typeof clip?.label === 'string'
              ? clip.label
              : matchedCandidate?.label ?? '';

        const fallbackLabel = matchedCandidate?.label ?? createPlannerSliceLabel(index);
        const label = normalizeTranscriptSliceLabelText(rawLabel, fallbackLabel);

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
        const minimumDurationMs = matchedCandidate ? MIN_TRANSCRIPT_ALIGNED_SLICE_DURATION_MS : minDurationMs;
        const normalizedDurationMs = Math.max(minimumDurationMs, Math.min(Math.round(safeDurationMs), maxDurationMs));
        const title = normalizeTranscriptSliceLabelText(normalizePlanText(clip?.title, 48) ?? label, label);
        const summary = normalizePlanText(clip?.summary, 160);
        const reason = normalizePlanText(clip?.reason, 180);
        const qualityScore = matchedCandidate?.qualityScore ?? clampScore(clip?.qualityScore);
        const continuityScore = matchedCandidate?.continuityScore ?? clampScore(clip?.continuityScore);
        const storyShape = matchedCandidate?.storyShape ?? normalizeStoryShape(clip?.storyShape);
        const llmRisks = matchedCandidate ? undefined : normalizePlanRisks(clip?.risks);
        const risks = createLlmTimingRisks(llmRisks, matchedCandidate, snappedToTranscript);
        const transcriptText = matchedCandidate?.transcriptText ?? normalizePlanText(clip?.transcriptText, 4_000);
        const transcriptCoverageScore = matchedCandidate?.transcriptCoverageScore ?? clampScore(clip?.transcriptCoverageScore);
        const transcriptSegmentCount = matchedCandidate?.transcriptSegmentCount ?? normalizeTranscriptSegmentCount(clip?.transcriptSegmentCount);
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
        const publishabilityIssues = matchedCandidate?.publishabilityIssues ?? normalizePlanRisks(clip?.publishabilityIssues);
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
          ...(transcriptSegmentCount !== undefined ? { transcriptSegmentCount } : {}),
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
          ...(matchedCandidate?.candidateId ? { candidateId: matchedCandidate.candidateId } : {}),
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
          ...(transcriptSegmentCount !== undefined ? { transcriptSegmentCount } : {}),
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
    const semanticallyRepaired = repairIncompleteSemanticStorySelections(normalized, transcriptCandidates);

    if (semanticallyRepaired.length === 0) {
      return evidenceBackedFallbackPlan;
    }

    const normalizedPlan = normalizeCandidateSlicePlan(semanticallyRepaired, params);
    const releaseReadyPlan = selectContentDerivedReleasePlan(normalizedPlan, policy);
    const canonicalReleasePlan = selectCanonicalContentDerivedReleasePlan(
      releaseReadyPlan,
      evidenceBackedFallbackPlan,
      policy,
    );
    return canonicalReleasePlan.length > 0 ? canonicalReleasePlan : evidenceBackedFallbackPlan;
  } catch {
    return evidenceBackedFallbackPlan;
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
}/**
 * Repairs a slice clip timing for native render compatibility.
 * Normalizes start/end/duration consistency and ensures timing fields
 * satisfy the planning policy constraints.
 */
export function repairSmartSliceClipTimingForNativeRender(
  clip: NormalizedSlicePlanClip,
  policy: VideoSlicePlanningPolicy,
): NormalizedSlicePlanClip {
  const safeStartMs = Math.max(0, Math.round(clip.startMs));
  const safeDurationMs = Math.max(1, Math.round(clip.durationMs));
  const safeEndMs = Math.min(safeStartMs + safeDurationMs, policy.maxDurationMs);

  const sourceStartMs = clip.sourceStartMs !== undefined ? Math.round(clip.sourceStartMs) : safeStartMs;
  const sourceEndMs = clip.sourceEndMs !== undefined ? Math.round(clip.sourceEndMs) : safeEndMs;

  const speechStartMs = clip.speechStartMs !== undefined ? Math.round(clip.speechStartMs) : undefined;
  const speechEndMs = clip.speechEndMs !== undefined ? Math.round(clip.speechEndMs) : undefined;

  const renderedDurationMs = sourceEndMs - sourceStartMs;

  return {
    ...clip,
    startMs: safeStartMs,
    durationMs: Math.max(renderedDurationMs, safeDurationMs),
    sourceStartMs,
    sourceEndMs,
    renderedDurationMs: Math.max(1, renderedDurationMs),
    ...(speechStartMs !== undefined ? { speechStartMs: Math.max(sourceStartMs, speechStartMs) } : {}),
    ...(speechEndMs !== undefined ? { speechEndMs: Math.min(sourceEndMs, speechEndMs) } : {}),
  };
}
