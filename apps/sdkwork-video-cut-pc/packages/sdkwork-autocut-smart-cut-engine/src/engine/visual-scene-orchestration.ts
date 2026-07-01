import {
  type SmartCutCandidate,
  type SmartCutContentUnit,
  type SmartCutPlan,
  type SmartCutSourceMedia,
  SMART_CUT_STANDARD_VERSION,
  type SmartCutTimeRange,
  type SmartCutVisualEvidence,
  type SmartCutVisualShot,
} from './domain.ts';
import {
  createSmartCutExecutionAuditTrace,
  type SmartCutExecutionAuditTrace,
} from './audit-trace.ts';
import {
  createSmartCutExecutionPackage,
  type SmartCutExecutionPackage,
  type SmartCutExecutionPackageBlocker,
} from './execution-package.ts';
import {
  validateSmartCutContentUnitBuildReport,
  type SmartCutContentUnitBuildReport,
} from './content-units.ts';
import {
  normalizeSmartCutLlmCandidateReview,
  type SmartCutLlmCandidateReviewReport,
} from './llm-review.ts';
import type { SmartCutProductPresetId } from './presets.ts';
import {
  validateSmartCutVisualEvidenceQuality,
  type SmartCutVisualEvidenceQualityValidationReport,
} from './evidence-quality.ts';

export interface CreateSmartCutVisualSceneExecutionPackageInput {
  runId: string;
  sourceMedia: SmartCutSourceMedia;
  presetId: SmartCutProductPresetId;
  visualEvidence: SmartCutVisualEvidence;
  targetCandidateCount?: number;
}

export interface SmartCutVisualSceneExecutionStageStatuses {
  visualEvidence: 'passed' | 'blocked';
  contentUnitBuild: 'passed' | 'blocked';
  llmReview: 'passed' | 'blocked';
  executionPackage: 'passed' | 'blocked';
}

export interface SmartCutVisualSceneExecutionPackageResult {
  ready: boolean;
  stageStatuses: SmartCutVisualSceneExecutionStageStatuses;
  blockers: readonly SmartCutExecutionPackageBlocker[];
  visualEvidenceQuality: SmartCutVisualEvidenceQualityValidationReport;
  contentUnitBuildReport: SmartCutContentUnitBuildReport;
  plan: SmartCutPlan;
  llmReviewReport: SmartCutLlmCandidateReviewReport;
  executionPackage: SmartCutExecutionPackage;
  auditTrace: SmartCutExecutionAuditTrace;
}

export function createSmartCutVisualSceneExecutionPackage(
  input: CreateSmartCutVisualSceneExecutionPackageInput,
): SmartCutVisualSceneExecutionPackageResult {
  const visualEvidenceQuality = validateSmartCutVisualEvidenceQuality({
    presetId: input.presetId,
    sourceMedia: input.sourceMedia,
    visualEvidence: input.visualEvidence,
  });
  const contentUnits = createVisualSceneContentUnits(input.visualEvidence);
  const contentUnitBuildReport = validateSmartCutContentUnitBuildReport({
    ready: true,
    presetId: input.presetId,
    units: contentUnits,
    unitCount: contentUnits.length,
    publishableUnitCount: contentUnits.length,
    lowInformationUnitCount: 0,
    questionUnitCount: 0,
    answerUnitCount: 0,
    distinctSpeakerCount: 0,
    blockers: [],
  });
  const candidates = createVisualSceneCandidates(contentUnits, input.visualEvidence);
  const plan: SmartCutPlan = {
    id: `${input.runId}-visual-scene-plan`,
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    sourceMediaId: input.sourceMedia.id,
    presetId: input.presetId,
    candidates,
  };
  const llmReviewReport = normalizeSmartCutLlmCandidateReview({
    model: 'deterministic-visual-scene-ranker',
    availableCandidateIds: candidates.map((candidate) => candidate.id),
    availableUnitIds: contentUnits.map((unit) => unit.id),
    availableTimeSliceIds: candidates.map((candidate) => `time-slice-${candidate.id}`),
    availableSpeakerIds: [...new Set(contentUnits.flatMap((unit) => unit.speakerIds))],
    availableSpeakerTurnIds: [...new Set(contentUnits.flatMap((unit) => unit.speakerTurnIds))],
    rawReview: {
      rankedCandidateIds: candidates.map((candidate) => candidate.id),
      referencedUnitIds: contentUnits.map((unit) => unit.id),
      reviewNotes: [
        'Deterministic visual scene review ranked only source-backed visual candidate ids.',
      ],
    },
  });
  const executionPackage = createSmartCutExecutionPackage({
    runId: input.runId,
    sourceMedia: input.sourceMedia,
    visualEvidence: input.visualEvidence,
    contentUnits,
    contentUnitBuildReport,
    llmReviewReport,
    plan,
    ...(input.targetCandidateCount !== undefined ? { targetCandidateCount: input.targetCandidateCount } : {}),
  });
  const auditTrace = createSmartCutExecutionAuditTrace(executionPackage);
  const blockers = createVisualSceneExecutionBlockers({
    visualEvidenceQuality,
    executionPackage,
  });

  return {
    ready: visualEvidenceQuality.ready && executionPackage.ready && blockers.length === 0,
    stageStatuses: {
      visualEvidence: visualEvidenceQuality.ready ? 'passed' : 'blocked',
      contentUnitBuild: contentUnitBuildReport.ready ? 'passed' : 'blocked',
      llmReview: llmReviewReport.ready ? 'passed' : 'blocked',
      executionPackage: executionPackage.ready ? 'passed' : 'blocked',
    },
    blockers,
    visualEvidenceQuality,
    contentUnitBuildReport,
    plan,
    llmReviewReport,
    executionPackage,
    auditTrace,
  };
}

function createVisualSceneExecutionBlockers({
  visualEvidenceQuality,
  executionPackage,
}: {
  visualEvidenceQuality: SmartCutVisualEvidenceQualityValidationReport;
  executionPackage: SmartCutExecutionPackage;
}): readonly SmartCutExecutionPackageBlocker[] {
  const visualBlockers = visualEvidenceQuality.blockers.map((blocker) => ({
    code: blocker.code,
    message: blocker.message,
    remediation: blocker.remediation,
    source: 'evidence-quality' as const,
  }));
  return dedupeExecutionBlockers([...visualBlockers, ...executionPackage.blockers]);
}

function createVisualSceneContentUnits(
  visualEvidence: SmartCutVisualEvidence,
): readonly SmartCutContentUnit[] {
  const ranges = resolveVisualSceneRanges(visualEvidence);
  const shots = Array.isArray(visualEvidence.shots) ? visualEvidence.shots : [];

  return ranges.map((range, index) => {
    const coveringShots = collectShotsCoveringRange(range, shots);
    const shotIds = coveringShots.map((shot) => shot.id);
    const averageConfidence = averageScore(coveringShots.map((shot) => shot.confidence), 0.72);

    return {
      id: `visual-scene-${index + 1}`,
      startMs: Math.round(range.startMs),
      endMs: Math.round(range.endMs),
      unitKind: 'visual-scene',
      text: `Visual scene ${index + 1} backed by ${shotIds.length > 0 ? shotIds.join(', ') : 'scene-boundary evidence'}.`,
      speakerIds: [],
      speakerTurnIds: [],
      speakerRoles: [],
      speakerConfidence: 1,
      overlapGroupIds: [],
      transcriptSegmentIds: [],
      evidenceIds: ['visual', ...shotIds],
      topicIds: [`visual-scene-${index + 1}`],
      completenessScore: roundScore(Math.max(0.72, averageConfidence)),
      continuityScore: roundScore(Math.max(0.72, averageConfidence)),
      publishabilityScore: roundScore(Math.max(0.7, averageConfidence - 0.02)),
    };
  });
}

function createVisualSceneCandidates(
  contentUnits: readonly SmartCutContentUnit[],
  visualEvidence: SmartCutVisualEvidence,
): readonly SmartCutCandidate[] {
  return contentUnits.map((unit, index) => {
    const shotIds = unit.evidenceIds.filter((evidenceId) => evidenceId !== 'visual');
    return {
      id: `visual-candidate-${index + 1}`,
      slicerId: visualEvidence.profile === 'shot-boundary-v1' ? 'visual-scene' : 'visual-scene',
      unitIds: [unit.id],
      startMs: unit.startMs,
      endMs: unit.endMs,
      title: `Scene ${index + 1}`,
      reason: shotIds.length > 0
        ? `Source-backed visual scene from ${visualEvidence.provider ?? 'visual evidence'} shots ${shotIds.join(', ')}.`
        : `Source-backed visual scene from ${visualEvidence.provider ?? 'visual evidence'}.`,
      confidence: roundScore(unit.publishabilityScore),
      risks: ['visual-scene-evidence'],
    };
  });
}

function resolveVisualSceneRanges(
  visualEvidence: SmartCutVisualEvidence,
): readonly SmartCutTimeRange[] {
  const sceneBoundaries = Array.isArray(visualEvidence.sceneBoundaries)
    ? visualEvidence.sceneBoundaries
    : [];
  const shots = Array.isArray(visualEvidence.shots)
    ? visualEvidence.shots
    : [];
  const sourceRanges = visualEvidence.profile === 'scene-index-v1' && sceneBoundaries.length > 0
    ? sceneBoundaries
    : shots;
  return sourceRanges
    .map((range) => ({
      startMs: Math.round(range.startMs),
      endMs: Math.round(range.endMs),
    }))
    .filter((range) => Number.isFinite(range.startMs) && Number.isFinite(range.endMs))
    .sort(compareTimeRanges);
}

function collectShotsCoveringRange(
  range: SmartCutTimeRange,
  shots: readonly SmartCutVisualShot[],
): readonly SmartCutVisualShot[] {
  return shots
    .filter((shot) => rangesOverlap(range, shot))
    .sort(compareTimeRanges);
}

function dedupeExecutionBlockers(
  blockers: readonly SmartCutExecutionPackageBlocker[],
): readonly SmartCutExecutionPackageBlocker[] {
  const seen = new Set<string>();
  const deduped: SmartCutExecutionPackageBlocker[] = [];
  for (const blocker of blockers) {
    const key = `${blocker.source}:${blocker.code}:${blocker.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(blocker);
  }
  return deduped;
}

function rangesOverlap(left: SmartCutTimeRange, right: SmartCutTimeRange): boolean {
  return Math.min(left.endMs, right.endMs) > Math.max(left.startMs, right.startMs);
}

function compareTimeRanges(left: SmartCutTimeRange, right: SmartCutTimeRange): number {
  return left.startMs - right.startMs || left.endMs - right.endMs;
}

function averageScore(scores: readonly number[], fallback: number): number {
  const validScores = scores.filter((score) => Number.isFinite(score));
  if (validScores.length === 0) {
    return fallback;
  }
  return validScores.reduce((sum, score) => sum + score, 0) / validScores.length;
}

function roundScore(score: number): number {
  return Math.round(score * 1000) / 1000;
}
