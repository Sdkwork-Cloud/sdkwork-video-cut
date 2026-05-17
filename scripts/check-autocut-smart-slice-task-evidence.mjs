#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  normalizeAutoCutCliArgs,
  readAutoCutCliOptionValue,
} from './autocut-cli-args.mjs';
import {
  AUTOCUT_SMART_SLICE_REVIEW_RISK_CATALOG,
  AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD,
} from '../packages/sdkwork-autocut-types/src/index.ts';

const __filename = fileURLToPath(import.meta.url);
const validationSchemaVersion = '2026-05-06.autocut-smart-slice-task-evidence-validation.v1';
const taskEvidenceSchemaVersion = '2026-05-06.autocut-smart-slice-task-evidence.v1';
const defaultTaskRelativePath = 'artifacts/smart-slice/smart-slice-task.json';
const minimumContinuityScore = 0.78;
const minimumTranscriptCoverageScore = AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD.minTranscriptCoverageScore;
const minimumAudioActivityConfidence = AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD.minAudioActivityConfidence;
const maximumLeadingSilenceMs = AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD.maxLeadingSilenceMs;
const maximumTrailingSilenceMs = AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD.maxTrailingSilenceMs;
const requiredAudioCleanupProfile = AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD.audioCleanupProfile;
const requiredAudioActivityAnalysisFilter = AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD.requiredAudioActivityAnalysisFilter;
const rawAudioActivityAnalysisFilter = 'silencedetect=noise=-35dB:d=0.08';
const acceptedBoundaryDecisionSources = new Set(
  AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD.acceptedBoundaryDecisionSources,
);
const acceptedTailTreatments = new Set(
  AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD.acceptedTailTreatments,
);

export function createAutoCutSmartSliceTaskEvidenceValidationReport({
  rootDir = process.cwd(),
  taskPath,
  generatedAt = new Date().toISOString(),
} = {}) {
  const resolvedRootDir = path.resolve(rootDir);
  const resolvedTaskPath = path.resolve(
    taskPath ?? path.join(resolvedRootDir, defaultTaskRelativePath),
  );
  if (!fs.existsSync(resolvedTaskPath) || !fs.statSync(resolvedTaskPath).isFile()) {
    throw new Error(`missing AutoCut smart slice task evidence: ${resolvedTaskPath}`);
  }

  const task = JSON.parse(fs.readFileSync(resolvedTaskPath, 'utf8'));
  const taskBlockers = createTaskShapeBlockers(task);
  const sliceResults = !taskBlockers.some((blocker) => blocker.code === 'SMART_SLICE_TASK_EVIDENCE_NOT_OBJECT') &&
    Array.isArray(task.sliceResults)
    ? task.sliceResults
    : [];
  const slices = sliceResults.map((slice, index) => createSliceValidationSnapshot(slice, index));
  const summary = createValidationSummary(slices);
  const reviewWarnings = createSmartSliceReviewWarnings(slices);
  const blockers = [
    ...taskBlockers,
    ...createSliceSetBlockers(task, summary, slices),
  ];

  return {
    schemaVersion: validationSchemaVersion,
    generatedAt,
    taskPath: resolvedTaskPath,
    taskPathRelative: toPosixRelative(resolvedRootDir, resolvedTaskPath),
    ready: blockers.length === 0,
    summary: {
      ...summary,
      reviewWarningSlices: new Set(reviewWarnings.flatMap((warning) => warning.sliceIndexes)).size,
      reviewWarningCount: reviewWarnings.reduce((count, warning) => count + warning.sliceIndexes.length, 0),
    },
    reviewWarnings,
    blockers,
    slices,
  };
}

export function formatAutoCutSmartSliceTaskEvidenceValidationMessage(report) {
  if (report.ready) {
    return `ok - autocut smart slice task evidence ${report.taskPath} slices=${report.summary.totalSlices} blockers=0`;
  }
  return `blocked - autocut smart slice task evidence ${report.taskPath} slices=${report.summary.totalSlices} blockers=${report.blockers.length}`;
}

function createTaskShapeBlockers(task) {
  const blockers = [];
  if (!task || typeof task !== 'object' || Array.isArray(task)) {
    return [
      {
        code: 'SMART_SLICE_TASK_EVIDENCE_NOT_OBJECT',
        message: 'Smart slice task evidence must be a JSON object.',
        remediation: 'Export Quality JSON from a completed smart slicing task detail page.',
      },
    ];
  }

  if (task.schemaVersion !== taskEvidenceSchemaVersion) {
    blockers.push({
      code: 'SMART_SLICE_TASK_SCHEMA_UNSUPPORTED',
      message: `Unsupported smart slice task evidence schema: ${normalizeString(task.schemaVersion)}`,
      remediation: 'Re-export the smart slice task evidence with the current AutoCut desktop build.',
      actual: normalizeString(task.schemaVersion),
      expected: taskEvidenceSchemaVersion,
    });
  }

  if (task.evidenceKind !== 'smart-slice-task') {
    blockers.push({
      code: 'SMART_SLICE_TASK_EVIDENCE_KIND_UNSUPPORTED',
      message: `Unsupported smart slice task evidence kind: ${normalizeString(task.evidenceKind)}`,
      remediation: 'Use the smart slicing task Quality JSON export, not another task or report JSON.',
      actual: normalizeString(task.evidenceKind),
      expected: 'smart-slice-task',
    });
  }

  if (task.status !== 'completed') {
    blockers.push({
      code: 'SMART_SLICE_TASK_NOT_COMPLETED',
      message: 'Smart slice task evidence must come from a completed task.',
      remediation: 'Wait for the smart slicing task to complete, then export Quality JSON again.',
      actual: normalizeString(task.status),
      expected: 'completed',
    });
  }

  if (!Array.isArray(task.sliceResults)) {
    blockers.push({
      code: 'SMART_SLICE_TASK_RESULTS_MISSING',
      message: 'Smart slice task evidence must include sliceResults.',
      remediation: 'Export Quality JSON from a completed smart slicing task with rendered slice results.',
    });
  }

  return blockers;
}

function createSliceValidationSnapshot(slice, index) {
  const sourceStartMs = normalizeNonNegativeInteger(slice?.sourceStartMs);
  const sourceEndMs = normalizeNonNegativeInteger(slice?.sourceEndMs);
  const speechStartMs = normalizeNonNegativeInteger(slice?.speechStartMs);
  const speechEndMs = normalizeNonNegativeInteger(slice?.speechEndMs);
  const transcriptText = normalizeString(slice?.transcriptText);
  const transcriptSegmentCount = normalizeNonNegativeInteger(slice?.transcriptSegmentCount) ?? 0;
  const transcriptSegments = normalizeTranscriptSegments(slice?.transcriptSegments);
  const transcriptStructuredSegmentCount = transcriptSegments.length;
  const durationMs = normalizeDurationMs(slice?.duration);
  const size = normalizeNonNegativeInteger(slice?.size) ?? 0;
  const continuityScore = normalizeScore(slice?.continuityScore);
  const transcriptCoverageScore = normalizeScore(slice?.transcriptCoverageScore);
  const publishabilityScore = normalizeScore(slice?.publishabilityScore);
  const platformReadinessScore = normalizeScore(slice?.platformReadinessScore);
  const audioCleanupProfile = normalizeString(slice?.audioCleanupProfile);
  const noiseReductionApplied = normalizeBoolean(slice?.noiseReductionApplied);
  const boundaryDecisionSource = normalizeString(slice?.boundaryDecisionSource);
  const audioActivityStartMs = normalizeNonNegativeInteger(slice?.audioActivityStartMs);
  const audioActivityEndMs = normalizeNonNegativeInteger(slice?.audioActivityEndMs);
  const audioActivityConfidence = normalizeScore(slice?.audioActivityConfidence);
  const audioActivityAnalysisFilter = normalizeString(slice?.audioActivityAnalysisFilter);
  const leadingSilenceMs = normalizeNonNegativeInteger(slice?.leadingSilenceMs);
  const trailingSilenceMs = normalizeNonNegativeInteger(slice?.trailingSilenceMs);
  const leadingSilenceTrimMs = normalizeNonNegativeInteger(slice?.leadingSilenceTrimMs);
  const trailingSilenceTrimMs = normalizeNonNegativeInteger(slice?.trailingSilenceTrimMs);
  const tailTreatment = normalizeString(slice?.tailTreatment);
  const url = normalizeString(slice?.url);
  const thumbnailUrl = normalizeString(slice?.thumbnailUrl);
  const resolution = normalizeString(slice?.resolution);
  const speechContinuityGrade = normalizeString(slice?.speechContinuityGrade);
  const publishabilityGrade = normalizeString(slice?.publishabilityGrade);
  const platformReadinessGrade = normalizeString(slice?.platformReadinessGrade);
  const sentenceBoundaryIntegrityGrade = normalizeString(slice?.sentenceBoundaryIntegrityGrade);
  const risks = normalizeStringArray(slice?.risks);
  const publishabilityIssues = normalizeStringArray(slice?.publishabilityIssues);
  const platformReadinessIssues = normalizeStringArray(slice?.platformReadinessIssues);
  const sentenceBoundaryIssues = normalizeStringArray(slice?.sentenceBoundaryIssues);
  const sourceRangeDurationMs = sourceEndMs !== undefined && sourceStartMs !== undefined
    ? sourceEndMs - sourceStartMs
    : undefined;
  const transcriptSegmentCountMatches =
    transcriptSegmentCount > 0 &&
    transcriptSegmentCount === transcriptStructuredSegmentCount;
  const transcriptTextFromSegments = createTranscriptTextFromSegments(transcriptSegments);
  const transcriptTextMatchesSegments =
    transcriptText.length > 0 &&
    transcriptText === transcriptTextFromSegments;
  const transcriptSegmentsOrdered = areTranscriptSegmentsOrdered(transcriptSegments);
  const transcriptSpeechBoundaryMatches = doTranscriptSegmentsMatchSpeechBoundary(
    transcriptSegments,
    speechStartMs,
    speechEndMs,
  );
  const transcriptSegmentsSourceRangeReady =
    sourceStartMs !== undefined &&
    sourceEndMs !== undefined &&
    sourceEndMs > sourceStartMs &&
    transcriptStructuredSegmentCount > 0 &&
    transcriptSegments.every((segment) =>
      segment.startMs >= sourceStartMs &&
      segment.endMs <= sourceEndMs &&
      segment.endMs > segment.startMs
    );
  const transcriptReady =
    transcriptText.length > 0 &&
    transcriptSegmentCount > 0 &&
    transcriptStructuredSegmentCount > 0 &&
    transcriptSegmentCountMatches &&
    transcriptTextMatchesSegments &&
    transcriptSegmentsOrdered &&
    transcriptSpeechBoundaryMatches &&
    transcriptSegmentsSourceRangeReady &&
    transcriptCoverageScore >= minimumTranscriptCoverageScore;
  const continuityReady =
    continuityScore >= minimumContinuityScore &&
    (speechContinuityGrade === 'strong' || speechContinuityGrade === 'repaired');
  const sourceRangeReady =
    sourceStartMs !== undefined &&
    sourceEndMs !== undefined &&
    speechStartMs !== undefined &&
    speechEndMs !== undefined &&
    sourceEndMs > sourceStartMs &&
    speechEndMs >= speechStartMs &&
    speechStartMs >= sourceStartMs &&
    speechEndMs <= sourceEndMs;
  const boundaryPaddingBeforeMs = sourceRangeReady ? speechStartMs - sourceStartMs : undefined;
  const boundaryPaddingAfterMs = sourceRangeReady ? sourceEndMs - speechEndMs : undefined;
  const silenceBoundaryReady =
    sourceRangeReady &&
    boundaryPaddingBeforeMs <= maximumLeadingSilenceMs &&
    boundaryPaddingAfterMs <= maximumTrailingSilenceMs;
  const renderArtifactReady =
    url.length > 0 &&
    thumbnailUrl.length > 0 &&
    size > 0 &&
    resolution.length > 0;
  const renderDurationReady =
    durationMs !== undefined &&
    sourceRangeDurationMs !== undefined &&
    sourceRangeDurationMs > 0 &&
    Math.abs(durationMs - sourceRangeDurationMs) <= Math.max(1_000, sourceRangeDurationMs * 0.05);
  const publishabilityReady =
    publishabilityScore >= 0.68 &&
    (publishabilityGrade === 'excellent' || publishabilityGrade === 'good');
  const platformReady =
    platformReadinessScore >= 0.68 &&
    (platformReadinessGrade === 'ready' || platformReadinessGrade === 'review');
  const sentenceBoundaryReady =
    sentenceBoundaryIntegrityGrade === 'clean' || sentenceBoundaryIntegrityGrade === 'repaired';
  const transcriptCorrection = normalizeTranscriptCorrectionAudit(slice?.transcriptCorrection);
  const transcriptCorrectionAuditReady =
    transcriptCorrection === undefined ||
    (
      transcriptCorrection.source === 'task-detail' &&
      transcriptCorrection.correctedAt.length > 0 &&
      transcriptCorrection.originalTranscriptText.length > 0 &&
      transcriptCorrection.correctionCount > 0
    );
  const audioActivityRangeReady =
    sourceRangeReady &&
    audioActivityStartMs !== undefined &&
    audioActivityEndMs !== undefined &&
    audioActivityEndMs > audioActivityStartMs &&
    audioActivityStartMs >= sourceStartMs &&
    audioActivityEndMs <= sourceEndMs;
  const audioCleanupReady =
    audioCleanupProfile === requiredAudioCleanupProfile &&
    noiseReductionApplied !== undefined &&
    acceptedBoundaryDecisionSources.has(boundaryDecisionSource) &&
    audioActivityRangeReady &&
    audioActivityConfidence >= minimumAudioActivityConfidence &&
    audioActivityAnalysisFilter === (noiseReductionApplied
      ? requiredAudioActivityAnalysisFilter
      : rawAudioActivityAnalysisFilter) &&
    leadingSilenceMs !== undefined &&
    trailingSilenceMs !== undefined &&
    leadingSilenceTrimMs !== undefined &&
    trailingSilenceTrimMs !== undefined &&
    acceptedTailTreatments.has(tailTreatment);

  return {
    index,
    id: normalizeString(slice?.id) || `slice-${index + 1}`,
    name: normalizeString(slice?.name),
    sourceStartMs,
    sourceEndMs,
    speechStartMs,
    speechEndMs,
    durationMs,
    size,
    url,
    thumbnailUrl,
    resolution,
    transcriptTextLength: transcriptText.length,
    transcriptSegmentCount,
    transcriptStructuredSegmentCount,
    scores: {
      continuityScore,
      transcriptCoverageScore,
      publishabilityScore,
      platformReadinessScore,
    },
    grades: {
      speechContinuityGrade,
      publishabilityGrade,
      platformReadinessGrade,
      sentenceBoundaryIntegrityGrade,
    },
    issues: {
      publishabilityIssues,
      platformReadinessIssues,
      sentenceBoundaryIssues,
      risks,
    },
    audioCleanup: {
      audioCleanupProfile,
      noiseReductionApplied,
      boundaryDecisionSource,
      audioActivityStartMs,
      audioActivityEndMs,
      audioActivityConfidence,
      audioActivityAnalysisFilter,
      leadingSilenceMs,
      trailingSilenceMs,
      leadingSilenceTrimMs,
      trailingSilenceTrimMs,
      tailTreatment,
    },
    ...(transcriptCorrection ? { transcriptCorrection } : {}),
    gates: {
      transcriptReady,
      transcriptSegmentCountMatches,
      transcriptTextMatchesSegments,
      transcriptSegmentsOrdered,
      transcriptSpeechBoundaryMatches,
      transcriptSegmentsSourceRangeReady,
      continuityReady,
      sourceRangeReady,
      silenceBoundaryReady,
      renderArtifactReady,
      renderDurationReady,
      publishabilityReady,
      platformReady,
      sentenceBoundaryReady,
      transcriptCorrectionAuditReady,
      audioActivityRangeReady,
      audioCleanupReady,
    },
  };
}

function doTranscriptSegmentsMatchSpeechBoundary(segments, speechStartMs, speechEndMs) {
  if (
    segments.length === 0 ||
    speechStartMs === undefined ||
    speechEndMs === undefined
  ) {
    return false;
  }

  return segments[0].startMs <= speechStartMs + 80 &&
    segments.at(-1).endMs >= speechEndMs - 80;
}

function createTranscriptTextFromSegments(segments) {
  return segments
    .map((segment) => segment.text)
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function areTranscriptSegmentsOrdered(segments) {
  let previousEndMs;
  for (const segment of segments) {
    if (previousEndMs !== undefined && segment.startMs < previousEndMs) {
      return false;
    }
    previousEndMs = segment.endMs;
  }

  return true;
}

function createValidationSummary(slices) {
  return {
    totalSlices: slices.length,
    transcriptReadySlices: slices.filter((slice) => slice.gates.transcriptReady).length,
    continuityReadySlices: slices.filter((slice) => slice.gates.continuityReady).length,
    sourceRangeReadySlices: slices.filter((slice) => slice.gates.sourceRangeReady).length,
    renderArtifactReadySlices: slices.filter((slice) => slice.gates.renderArtifactReady).length,
    renderDurationReadySlices: slices.filter((slice) => slice.gates.renderDurationReady).length,
    audioCleanupReadySlices: slices.filter((slice) => slice.gates.audioCleanupReady).length,
    publishabilityReadySlices: slices.filter((slice) => slice.gates.publishabilityReady).length,
    platformReadySlices: slices.filter((slice) => slice.gates.platformReady).length,
    sentenceBoundaryReadySlices: slices.filter((slice) => slice.gates.sentenceBoundaryReady).length,
  };
}

function createSmartSliceReviewWarnings(slices) {
  const warningsByCode = new Map();
  for (const slice of slices) {
    for (const risk of createSmartSliceReviewIssueCodes(slice.issues)) {
      const warning = warningsByCode.get(risk) ?? createSmartSliceReviewWarning(risk);
      warning.sliceIndexes.push(slice.index);
      warningsByCode.set(risk, warning);
    }
  }

  return [...warningsByCode.values()].map((warning) => ({
    ...warning,
    sliceIndexes: [...new Set(warning.sliceIndexes)].sort((first, second) => first - second),
  }));
}

function createSmartSliceReviewIssueCodes(issues) {
  const reviewCodes = [
    ...(issues.risks ?? []),
    ...(issues.publishabilityIssues ?? []),
    ...(issues.platformReadinessIssues ?? []),
    ...(issues.sentenceBoundaryIssues ?? []).filter((issue) =>
      !issue.startsWith('sentence-clean-') &&
      !issue.endsWith('-repaired')
    ),
  ];
  return [...new Set(reviewCodes)].filter(Boolean);
}

function createSmartSliceReviewWarning(risk) {
  const definition = AUTOCUT_SMART_SLICE_REVIEW_RISK_CATALOG[risk];
  if (definition) {
    return {
      code: definition.code,
      severity: definition.severity,
      title: definition.title,
      message: definition.message,
      remediation: definition.remediation,
      sliceIndexes: [],
    };
  }

  return {
    code: risk,
    severity: 'review',
    title: createFallbackRiskTitle(risk),
    message: `Smart slicing reported review risk "${risk}" for this slice.`,
    remediation: 'Review the slice manually before publishing and re-run smart slicing if the risk indicates a boundary or transcript issue.',
    sliceIndexes: [],
  };
}

function createSliceSetBlockers(task, summary, slices) {
  const blockers = [];
  if (!task || typeof task !== 'object' || Array.isArray(task)) {
    return blockers;
  }
  if (!Array.isArray(task.sliceResults)) {
    return blockers;
  }

  if (summary.totalSlices < 1) {
    blockers.push({
      code: 'SMART_SLICE_TASK_NO_SLICES',
      message: 'Smart slice task evidence does not contain rendered slice results.',
      remediation: 'Run the smart slicing workflow to completion before exporting release evidence.',
    });
  }

  if (typeof task.resultCount === 'number' && task.resultCount !== summary.totalSlices) {
    blockers.push({
      code: 'SMART_SLICE_TASK_RESULT_COUNT_MISMATCH',
      message: 'Smart slice task resultCount does not match sliceResults length.',
      remediation: 'Re-export the task evidence from the task detail page to avoid stale JSON.',
      actual: task.resultCount,
      expected: summary.totalSlices,
    });
  }

  const transcriptMissingIndexes = slices
    .filter((slice) => !slice.gates.transcriptReady)
    .map((slice) => slice.index);
  if (transcriptMissingIndexes.length > 0) {
    blockers.push({
      code: 'SMART_SLICE_TASK_TRANSCRIPT_MISSING',
      message: 'One or more smart slices are missing complete transcript text or transcript segments.',
      remediation: 'Regenerate local STT and export Quality JSON only after every slice carries transcript coverage.',
      sliceIndexes: transcriptMissingIndexes,
    });
  }

  const continuityIncompleteIndexes = slices
    .filter((slice) => !slice.gates.continuityReady)
    .map((slice) => slice.index);
  if (continuityIncompleteIndexes.length > 0) {
    blockers.push({
      code: 'SMART_SLICE_TASK_CONTINUITY_INCOMPLETE',
      message: 'One or more smart slices do not satisfy speech continuity metadata requirements.',
      remediation: 'Repair sentence boundaries and regenerate smart slicing so each clip starts and ends on complete speech.',
      sliceIndexes: continuityIncompleteIndexes,
    });
  }

  const sourceRangeInvalidIndexes = slices
    .filter((slice) => !slice.gates.sourceRangeReady)
    .map((slice) => slice.index);
  if (sourceRangeInvalidIndexes.length > 0) {
    blockers.push({
      code: 'SMART_SLICE_TASK_SOURCE_RANGE_INVALID',
      message: 'One or more smart slices have invalid padded source range or speech range metadata.',
      remediation: 'Re-run planning so sourceStart/sourceEnd wrap the speechStart/speechEnd range for each slice.',
      sliceIndexes: sourceRangeInvalidIndexes,
    });
  }

  const renderArtifactMissingIndexes = slices
    .filter((slice) => !slice.gates.renderArtifactReady)
    .map((slice) => slice.index);
  if (renderArtifactMissingIndexes.length > 0) {
    blockers.push({
      code: 'SMART_SLICE_TASK_RENDER_ARTIFACT_MISSING',
      message: 'One or more smart slices are missing rendered video artifact metadata.',
      remediation: 'Re-run native slicing and export Quality JSON only after every slice has url, thumbnailUrl, size, and resolution.',
      sliceIndexes: renderArtifactMissingIndexes,
    });
  }

  const excessiveSilenceBoundaryIndexes = slices
    .filter((slice) => slice.gates.sourceRangeReady && !slice.gates.silenceBoundaryReady)
    .map((slice) => slice.index);
  if (excessiveSilenceBoundaryIndexes.length > 0) {
    blockers.push({
      code: 'SMART_SLICE_TASK_EXCESSIVE_SILENCE_BOUNDARY',
      message: 'One or more smart slices include excessive leading or trailing silence around speech.',
      remediation: `Re-run smart slicing so each rendered slice keeps no more than ${maximumLeadingSilenceMs}ms leading and ${maximumTrailingSilenceMs}ms trailing speech boundary padding.`,
      sliceIndexes: excessiveSilenceBoundaryIndexes,
      expected: {
        maximumLeadingSilenceMs,
        maximumTrailingSilenceMs,
      },
    });
  }

  const renderDurationMismatchIndexes = slices
    .filter((slice) => !slice.gates.renderDurationReady)
    .map((slice) => slice.index);
  if (renderDurationMismatchIndexes.length > 0) {
    blockers.push({
      code: 'SMART_SLICE_TASK_RENDER_DURATION_MISMATCH',
      message: 'One or more smart slices have a rendered duration that does not match sourceStartMs/sourceEndMs metadata.',
      remediation: 'Re-export task evidence from the completed native slicing result so duration and source range describe the same rendered clip.',
      sliceIndexes: renderDurationMismatchIndexes,
    });
  }

  const audioCleanupIncompleteIndexes = slices
    .filter((slice) => !slice.gates.audioCleanupReady)
    .map((slice) => slice.index);
  if (audioCleanupIncompleteIndexes.length > 0) {
    blockers.push({
      code: 'SMART_SLICE_TASK_AUDIO_CLEANUP_INCOMPLETE',
      message: 'One or more smart slices are missing complete denoise, audio boundary, or tail cleanup evidence.',
      remediation: `Re-run smart slicing with the ${requiredAudioCleanupProfile} cleanup profile so each rendered slice records noise-reduction decision, boundary source, trim, and tail treatment evidence.`,
      sliceIndexes: audioCleanupIncompleteIndexes,
      expected: {
        audioCleanupProfile: requiredAudioCleanupProfile,
        noiseReductionApplied: 'boolean decision evidence required',
        minAudioActivityConfidence: minimumAudioActivityConfidence,
        audioActivityAnalysisFilter: {
          denoised: requiredAudioActivityAnalysisFilter,
          raw: rawAudioActivityAnalysisFilter,
        },
        audioActivityRange: 'audioActivityStartMs/audioActivityEndMs must be inside sourceStartMs/sourceEndMs',
        boundaryDecisionSources: [...acceptedBoundaryDecisionSources],
        tailTreatments: [...acceptedTailTreatments],
      },
    });
  }

  const transcriptCorrectionInvalidIndexes = slices
    .filter((slice) => !slice.gates.transcriptCorrectionAuditReady)
    .map((slice) => slice.index);
  if (transcriptCorrectionInvalidIndexes.length > 0) {
    blockers.push({
      code: 'SMART_SLICE_TASK_TRANSCRIPT_CORRECTION_AUDIT_INVALID',
      message: 'One or more smart slices contain invalid manual transcript correction audit metadata.',
      remediation: 'Re-save transcript corrections from the task detail page so source, correctedAt, originalTranscriptText, and correctionCount are recorded.',
      sliceIndexes: transcriptCorrectionInvalidIndexes,
      expected: {
        source: 'task-detail',
        correctedAt: 'valid ISO timestamp string',
        originalTranscriptText: 'non-empty string',
        correctionCount: 'positive integer',
      },
    });
  }

  return blockers;
}

function normalizeScore(value) {
  const numericValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : 0;
  if (!Number.isFinite(numericValue)) {
    return 0;
  }
  return Math.max(0, Math.min(1, Number(numericValue)));
}

function normalizeNonNegativeInteger(value) {
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

function normalizeBoolean(value) {
  return typeof value === 'boolean' ? value : undefined;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeString(item))
    .filter(Boolean)
    .slice(0, 24);
}

function normalizeDurationMs(value) {
  const numericValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : undefined;
  if (!Number.isFinite(numericValue)) {
    return undefined;
  }
  return Math.max(0, Math.round(Number(numericValue) * 1_000));
}

function normalizeTranscriptSegments(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((segment) => {
      const startMs = normalizeNonNegativeInteger(segment?.startMs);
      const endMs = normalizeNonNegativeInteger(segment?.endMs);
      const text = normalizeString(segment?.text).replace(/\s+/gu, ' ');
      if (startMs === undefined || endMs === undefined || endMs <= startMs || !text) {
        return undefined;
      }
      return { startMs, endMs, text };
    })
    .filter(Boolean)
    .slice(0, 1_000);
}

function normalizeTranscriptCorrectionAudit(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const source = normalizeString(value.source);
  const correctedAt = normalizeString(value.correctedAt);
  const originalTranscriptText = normalizeString(value.originalTranscriptText).replace(/\s+/gu, ' ');
  const correctionCount = normalizeNonNegativeInteger(value.correctionCount) ?? 0;

  return {
    source,
    correctedAt: correctedAt && !Number.isNaN(Date.parse(correctedAt)) ? correctedAt : '',
    originalTranscriptText,
    correctionCount,
  };
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function createFallbackRiskTitle(risk) {
  return risk
    .split('-')
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ') || 'Review risk';
}

function toPosixRelative(rootDir, targetPath) {
  return path.relative(rootDir, targetPath).replaceAll(path.sep, '/');
}

function parseArgs(argv) {
  const options = {};
  const args = normalizeAutoCutCliArgs(argv);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--task') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut smart slice task evidence',
      });
      options.taskPath = option.value;
      index = option.nextIndex;
    } else {
      throw new Error(`Unknown AutoCut smart slice task evidence argument: ${arg}`);
    }
  }
  return options;
}

function main() {
  const report = createAutoCutSmartSliceTaskEvidenceValidationReport(parseArgs(process.argv.slice(2)));
  console.log(formatAutoCutSmartSliceTaskEvidenceValidationMessage(report));
  if (!report.ready) {
    for (const blocker of report.blockers) {
      console.error(`${blocker.code}: ${blocker.message}`);
    }
    process.exit(1);
  }
}

if (path.resolve(process.argv[1] ?? '') === __filename) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
