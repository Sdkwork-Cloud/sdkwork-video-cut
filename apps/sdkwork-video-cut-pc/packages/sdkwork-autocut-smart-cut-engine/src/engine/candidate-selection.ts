import type {
  SmartCutCandidate,
  SmartCutContentUnit,
  SmartCutOutputProfile,
  SmartCutTimeRange,
} from './domain.ts';
import type { SmartCutLlmCandidateReviewReport } from './llm-review.ts';
import { SMART_CUT_PRODUCT_PRESET_REGISTRY, type SmartCutProductPresetId } from './presets.ts';

export interface SmartCutCandidateSelectionInput {
  presetId: SmartCutProductPresetId;
  contentUnits: readonly SmartCutContentUnit[];
  candidates: readonly SmartCutCandidate[];
  llmReviewReport?: SmartCutLlmCandidateReviewReport;
  targetCount?: number;
}

export type SmartCutCandidateRejectionReason =
  | 'unknown-preset'
  | 'unknown-content-unit'
  | 'low-unit-quality'
  | 'duration-below-preset-minimum'
  | 'duration-above-preset-maximum'
  | 'overlaps-selected-candidate';

export interface SmartCutRejectedCandidate {
  candidateId: string;
  reason: SmartCutCandidateRejectionReason;
  message: string;
  competingCandidateId?: string;
}

export type SmartCutCandidateSelectionBlockerCode =
  | 'UNKNOWN_PRESET'
  | 'NO_CANDIDATES'
  | 'NO_SELECTED_CANDIDATES';

export interface SmartCutCandidateSelectionBlocker {
  code: SmartCutCandidateSelectionBlockerCode;
  message: string;
  remediation: string;
}

export interface SmartCutCandidateSelectionMetrics {
  inputCount: number;
  selectedCount: number;
  rejectedCount: number;
  llmRankedCandidateCount: number;
  requestedTargetCount?: number;
}

export interface SmartCutCandidateSelectionReport {
  ready: boolean;
  selectedCandidates: readonly SmartCutCandidate[];
  rejectedCandidates: readonly SmartCutRejectedCandidate[];
  blockers: readonly SmartCutCandidateSelectionBlocker[];
  metrics: SmartCutCandidateSelectionMetrics;
}

const minimumUnitQualityScore = 0.68;

export function selectSmartCutCandidates(
  input: SmartCutCandidateSelectionInput,
): SmartCutCandidateSelectionReport {
  const blockers: SmartCutCandidateSelectionBlocker[] = [];
  const rejectedCandidates: SmartCutRejectedCandidate[] = [];
  const preset = SMART_CUT_PRODUCT_PRESET_REGISTRY.find((entry) => entry.id === input.presetId);
  if (preset === undefined) {
    blockers.push({
      code: 'UNKNOWN_PRESET',
      message: `Unknown smart cut product preset: ${input.presetId}.`,
      remediation: 'Select candidates against a registered smart cut product preset.',
    });
    return {
      ready: false,
      selectedCandidates: [],
      rejectedCandidates,
      blockers,
      metrics: createEmptyCandidateSelectionMetrics(input.candidates.length),
    };
  }

  if (input.candidates.length === 0) {
    blockers.push({
      code: 'NO_CANDIDATES',
      message: 'Candidate selection has no input candidates.',
      remediation: 'Run slicer strategies before candidate selection.',
    });
  }

  const unitById = new Map(input.contentUnits.map((unit) => [unit.id, unit]));
  const llmRanking = createLlmRankingMap(input.llmReviewReport);
  const selectableCandidates = input.candidates
    .map((candidate) => createScoredCandidate(candidate, unitById, llmRanking, preset?.outputProfile, rejectedCandidates))
    .filter((entry) => entry !== undefined)
    .sort(compareScoredCandidates);
  const targetCount = normalizeTargetCount(input.targetCount);
  const selectedCandidates: SmartCutCandidate[] = [];

  for (const entry of selectableCandidates) {
    const overlappingCandidate = selectedCandidates.find((candidate) => rangesOverlap(candidate, entry.candidate));
    if (overlappingCandidate !== undefined) {
      rejectedCandidates.push({
        candidateId: entry.candidate.id,
        reason: 'overlaps-selected-candidate',
        message: `Candidate ${entry.candidate.id} overlaps selected candidate ${overlappingCandidate.id}.`,
        competingCandidateId: overlappingCandidate.id,
      });
      continue;
    }

    selectedCandidates.push(entry.candidate);
  }

  if (selectedCandidates.length === 0) {
    blockers.push({
      code: 'NO_SELECTED_CANDIDATES',
      message: 'No candidates survived deterministic candidate selection.',
      remediation: 'Improve transcript/speaker evidence, semantic boundaries, or slicer strategy output.',
    });
  }

  const metrics: SmartCutCandidateSelectionMetrics = {
    inputCount: input.candidates.length,
    selectedCount: selectedCandidates.length,
    rejectedCount: rejectedCandidates.length,
    llmRankedCandidateCount: llmRanking.size,
    ...(targetCount !== undefined ? { requestedTargetCount: targetCount } : {}),
  };

  return {
    ready: blockers.length === 0,
    selectedCandidates,
    rejectedCandidates,
    blockers,
    metrics,
  };
}

function normalizeTargetCount(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(1, Math.floor(value));
}

function createEmptyCandidateSelectionMetrics(inputCount: number): SmartCutCandidateSelectionMetrics {
  return {
    inputCount,
    selectedCount: 0,
    rejectedCount: 0,
    llmRankedCandidateCount: 0,
  };
}

interface ScoredCandidate {
  candidate: SmartCutCandidate;
  score: number;
  llmRank: number;
  unitCount: number;
  durationMs: number;
}

function createScoredCandidate(
  candidate: SmartCutCandidate,
  unitById: ReadonlyMap<string, SmartCutContentUnit>,
  llmRanking: ReadonlyMap<string, number>,
  outputProfile: SmartCutOutputProfile | undefined,
  rejectedCandidates: SmartCutRejectedCandidate[],
): ScoredCandidate | undefined {
  const units: SmartCutContentUnit[] = [];
  for (const unitId of candidate.unitIds) {
    const unit = unitById.get(unitId);
    if (unit === undefined) {
      rejectedCandidates.push({
        candidateId: candidate.id,
        reason: 'unknown-content-unit',
        message: `Candidate ${candidate.id} references unknown content unit ${unitId}.`,
      });
      return undefined;
    }
    units.push(unit);
  }

  if (units.some((unit) => unit.publishabilityScore < minimumUnitQualityScore)) {
    rejectedCandidates.push({
      candidateId: candidate.id,
      reason: 'low-unit-quality',
      message: `Candidate ${candidate.id} contains a content unit below publishability threshold ${minimumUnitQualityScore}.`,
    });
    return undefined;
  }

  const durationMs = candidate.endMs - candidate.startMs;
  if (outputProfile?.minDurationMs !== undefined && durationMs < outputProfile.minDurationMs) {
    rejectedCandidates.push({
      candidateId: candidate.id,
      reason: 'duration-below-preset-minimum',
      message: `Candidate ${candidate.id} duration ${durationMs}ms is below preset minimum ${outputProfile.minDurationMs}ms.`,
    });
    return undefined;
  }

  if (outputProfile?.maxDurationMs !== undefined && durationMs > outputProfile.maxDurationMs) {
    rejectedCandidates.push({
      candidateId: candidate.id,
      reason: 'duration-above-preset-maximum',
      message: `Candidate ${candidate.id} duration ${durationMs}ms exceeds preset maximum ${outputProfile.maxDurationMs}ms.`,
    });
    return undefined;
  }

  const averageUnitScore = units.reduce((sum, unit) =>
    sum + unit.completenessScore + unit.continuityScore + unit.publishabilityScore, 0) / Math.max(1, units.length * 3);
  const granularityPenalty = Math.max(0, units.length - 1) * 0.04;
  const score = roundScore(candidate.confidence * 0.45 + averageUnitScore * 0.55 - granularityPenalty);

  return {
    candidate,
    score,
    llmRank: llmRanking.get(candidate.id) ?? Number.POSITIVE_INFINITY,
    unitCount: units.length,
    durationMs,
  };
}

function compareScoredCandidates(left: ScoredCandidate, right: ScoredCandidate): number {
  return left.llmRank - right.llmRank ||
    right.score - left.score ||
    left.unitCount - right.unitCount ||
    left.durationMs - right.durationMs ||
    left.candidate.startMs - right.candidate.startMs ||
    left.candidate.id.localeCompare(right.candidate.id);
}

function createLlmRankingMap(
  llmReviewReport: SmartCutLlmCandidateReviewReport | undefined,
): ReadonlyMap<string, number> {
  if (llmReviewReport?.ready !== true || llmReviewReport.evidence === undefined) {
    return new Map();
  }

  const ranking = new Map<string, number>();
  for (const [index, candidateId] of llmReviewReport.evidence.referencedCandidateIds.entries()) {
    const normalizedCandidateId = candidateId.trim();
    if (normalizedCandidateId && !ranking.has(normalizedCandidateId)) {
      ranking.set(normalizedCandidateId, index);
    }
  }
  return ranking;
}

function rangesOverlap(left: SmartCutTimeRange, right: SmartCutTimeRange): boolean {
  return Math.min(left.endMs, right.endMs) > Math.max(left.startMs, right.startMs);
}

function roundScore(score: number): number {
  return Math.round(score * 1000) / 1000;
}
