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
  AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD,
} from '../packages/sdkwork-autocut-types/src/index.ts';

const __filename = fileURLToPath(import.meta.url);
const evidenceSchemaVersion = '2026-05-06.autocut-smart-slice-quality-evidence.v1';
const taskEvidenceSchemaVersion = '2026-05-06.autocut-smart-slice-task-evidence.v1';
const defaultOutputRelativePath = 'artifacts/release/autocut-smart-slice-quality-evidence.json';
const defaultTaskRelativePath = 'artifacts/smart-slice/smart-slice-task.json';

const QUALITY_THRESHOLDS = {
  minTotalSlices: 1,
  minReadyOrReviewRatio: 0.8,
  minAveragePublishabilityScore: 0.68,
  minAverageContinuityScore: 0.78,
  minAverageTranscriptCoverageScore: AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD.minTranscriptCoverageScore,
  minPlatformReadyOrReviewRatio: 0.8,
  maxLeadingSilenceMs: AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD.maxLeadingSilenceMs,
  maxTrailingSilenceMs: AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD.maxTrailingSilenceMs,
};

export function createAutoCutSmartSliceQualityEvidence({
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
  validateSmartSliceTaskEvidence(task);
  const sliceResults = Array.isArray(task.sliceResults) ? task.sliceResults : [];
  const slices = sliceResults.map((slice, index) => createSliceQualityEvidence(slice, index));
  const summary = createSmartSliceQualitySummary(slices);
  const blockers = createSmartSliceQualityBlockers(summary, slices);

  return {
    schemaVersion: evidenceSchemaVersion,
    generatedAt,
    taskPath: toPosixRelative(resolvedRootDir, resolvedTaskPath),
    task: {
      id: typeof task.id === 'string' ? task.id : '',
      type: typeof task.type === 'string' ? task.type : '',
      status: typeof task.status === 'string' ? task.status : '',
      resultCount: typeof task.resultCount === 'number' ? task.resultCount : sliceResults.length,
    },
    thresholds: QUALITY_THRESHOLDS,
    readiness: {
      smartSliceQualityReady: blockers.length === 0,
    },
    summary,
    blockers,
    slices,
  };
}

export function writeAutoCutSmartSliceQualityEvidence({
  rootDir = process.cwd(),
  outputPath,
  ...options
} = {}) {
  const resolvedRootDir = path.resolve(rootDir);
  const evidence = createAutoCutSmartSliceQualityEvidence({
    rootDir: resolvedRootDir,
    ...options,
  });
  const resolvedOutputPath = path.resolve(
    outputPath ?? path.join(resolvedRootDir, defaultOutputRelativePath),
  );
  fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  fs.writeFileSync(`${resolvedOutputPath}.tmp`, `${JSON.stringify(evidence, null, 2)}\n`);
  fs.renameSync(`${resolvedOutputPath}.tmp`, resolvedOutputPath);
  return {
    outputPath: resolvedOutputPath,
    evidence,
  };
}

export function formatAutoCutSmartSliceQualityEvidenceMessage(result) {
  return `ok - autocut smart slice quality evidence ${result.outputPath} slices=${result.evidence.summary.totalSlices} ready=${result.evidence.readiness.smartSliceQualityReady} blockers=${result.evidence.blockers.length}`;
}

function createSliceQualityEvidence(slice, index) {
  const publishabilityScore = normalizeScore(slice.publishabilityScore);
  const continuityScore = normalizeScore(slice.continuityScore);
  const transcriptCoverageScore = normalizeScore(slice.transcriptCoverageScore);
  const platformReadinessScore = normalizeScore(slice.platformReadinessScore);
  const sentenceBoundaryIntegrityScore = normalizeScore(slice.sentenceBoundaryIntegrityScore);
  const boundaryQualityScore = normalizeScore(slice.boundaryQualityScore);
  const transcriptSegmentCount = normalizeNonNegativeInteger(slice.transcriptSegmentCount);
  const transcriptSegments = normalizeTranscriptSegments(slice.transcriptSegments);
  const transcriptStructuredSegmentCount = transcriptSegments.length;
  const sourceStartMs = normalizeNonNegativeInteger(slice.sourceStartMs);
  const sourceEndMs = normalizeNonNegativeInteger(slice.sourceEndMs);
  const speechStartMs = normalizeNonNegativeInteger(slice.speechStartMs);
  const speechEndMs = normalizeNonNegativeInteger(slice.speechEndMs);
  const durationMs = typeof slice.duration === 'number' && Number.isFinite(slice.duration)
    ? Math.max(0, Math.round(slice.duration * 1_000))
    : sourceEndMs !== undefined && sourceStartMs !== undefined
      ? Math.max(0, sourceEndMs - sourceStartMs)
      : undefined;
  const publishabilityGrade = normalizeString(slice.publishabilityGrade);
  const platformReadinessGrade = normalizeString(slice.platformReadinessGrade);
  const speechContinuityGrade = normalizeString(slice.speechContinuityGrade);
  const sentenceBoundaryIntegrityGrade = normalizeString(slice.sentenceBoundaryIntegrityGrade);
  const transcriptText = normalizeString(slice.transcriptText);
  const publishabilityIssues = normalizeStringArray(slice.publishabilityIssues);
  const platformReadinessIssues = normalizeStringArray(slice.platformReadinessIssues);
  const sentenceBoundaryIssues = normalizeStringArray(slice.sentenceBoundaryIssues);
  const risks = normalizeStringArray(slice.risks);

  const publishabilityReady =
    publishabilityScore >= QUALITY_THRESHOLDS.minAveragePublishabilityScore &&
    (publishabilityGrade === 'excellent' || publishabilityGrade === 'good');
  const speechContinuityReady =
    continuityScore >= QUALITY_THRESHOLDS.minAverageContinuityScore &&
    (speechContinuityGrade === 'strong' || speechContinuityGrade === 'repaired');
  const transcriptSegmentCountMatches =
    transcriptSegmentCount !== undefined &&
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
    transcriptCoverageScore >= QUALITY_THRESHOLDS.minAverageTranscriptCoverageScore &&
    transcriptSegmentCount !== undefined &&
    transcriptSegmentCount > 0 &&
    transcriptStructuredSegmentCount > 0 &&
    transcriptSegmentCountMatches &&
    transcriptTextMatchesSegments &&
    transcriptSegmentsOrdered &&
    transcriptSpeechBoundaryMatches &&
    transcriptSegmentsSourceRangeReady &&
    Boolean(transcriptText);
  const sentenceBoundaryReady =
    sentenceBoundaryIntegrityGrade === 'clean' ||
    sentenceBoundaryIntegrityGrade === 'repaired';
  const platformReady =
    platformReadinessScore >= 0.68 &&
    (platformReadinessGrade === 'ready' || platformReadinessGrade === 'review');
  const sourceRangeReady =
    sourceStartMs !== undefined &&
    sourceEndMs !== undefined &&
    sourceEndMs > sourceStartMs &&
    speechStartMs !== undefined &&
    speechEndMs !== undefined &&
    speechEndMs >= speechStartMs &&
    speechStartMs >= sourceStartMs &&
    speechEndMs <= sourceEndMs;
  const boundaryPaddingBeforeMs = sourceRangeReady ? speechStartMs - sourceStartMs : undefined;
  const boundaryPaddingAfterMs = sourceRangeReady ? sourceEndMs - speechEndMs : undefined;
  const silenceBoundaryReady =
    sourceRangeReady &&
    boundaryPaddingBeforeMs <= QUALITY_THRESHOLDS.maxLeadingSilenceMs &&
    boundaryPaddingAfterMs <= QUALITY_THRESHOLDS.maxTrailingSilenceMs;

  return {
    index,
    id: normalizeString(slice.id) || `slice-${index + 1}`,
    name: normalizeString(slice.name),
    durationMs,
    scores: {
      publishabilityScore,
      continuityScore,
      transcriptCoverageScore,
      platformReadinessScore,
      sentenceBoundaryIntegrityScore,
      boundaryQualityScore,
    },
    grades: {
      publishabilityGrade,
      platformReadinessGrade,
      speechContinuityGrade,
      sentenceBoundaryIntegrityGrade,
      hookStrength: normalizeString(slice.hookStrength),
      endingCompleteness: normalizeString(slice.endingCompleteness),
    },
    sourceRange: {
      sourceStartMs,
      sourceEndMs,
      speechStartMs,
      speechEndMs,
      boundaryPaddingBeforeMs: boundaryPaddingBeforeMs ?? normalizeNonNegativeInteger(slice.boundaryPaddingBeforeMs) ?? 0,
      boundaryPaddingAfterMs: boundaryPaddingAfterMs ?? normalizeNonNegativeInteger(slice.boundaryPaddingAfterMs) ?? 0,
    },
    transcript: {
      transcriptSegmentCount,
      transcriptStructuredSegmentCount,
      transcriptSegmentCountMatches,
      transcriptTextMatchesSegments,
      transcriptSegmentsOrdered,
      transcriptSpeechBoundaryMatches,
      transcriptSegmentsSourceRangeReady,
      transcriptTextLength: transcriptText.length,
    },
    issues: {
      publishabilityIssues,
      platformReadinessIssues,
      sentenceBoundaryIssues,
      risks,
    },
    qualityGates: {
      publishabilityReady,
      speechContinuityReady,
      transcriptReady,
      sentenceBoundaryReady,
      platformReady,
      sourceRangeReady,
      silenceBoundaryReady,
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

  return Math.abs(segments[0].startMs - speechStartMs) <= 80 &&
    Math.abs(segments.at(-1).endMs - speechEndMs) <= 80;
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

function validateSmartSliceTaskEvidence(task) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) {
    throw new Error('AutoCut smart slice task evidence must be a JSON object.');
  }

  if (
    typeof task.evidenceKind === 'string' &&
    task.evidenceKind.trim() &&
    task.evidenceKind !== 'smart-slice-task'
  ) {
    throw new Error(`unsupported AutoCut smart slice task evidence kind: ${task.evidenceKind}`);
  }

  if (task.schemaVersion !== taskEvidenceSchemaVersion) {
    throw new Error(`unsupported AutoCut smart slice task evidence schema: ${task.schemaVersion}`);
  }

  if (task.status !== 'completed') {
    throw new Error('AutoCut smart slice task evidence must be exported from a completed task.');
  }
}

function createSmartSliceQualitySummary(slices) {
  const totalSlices = slices.length;
  const readySlices = slices.filter((slice) => slice.grades.platformReadinessGrade === 'ready').length;
  const reviewSlices = slices.filter((slice) => slice.grades.platformReadinessGrade === 'review').length;
  const rejectSlices = slices.filter((slice) =>
    slice.grades.platformReadinessGrade === 'reject' ||
    slice.grades.publishabilityGrade === 'reject',
  ).length;
  const readyOrReviewSlices = slices.filter((slice) =>
    slice.qualityGates.publishabilityReady &&
    slice.qualityGates.speechContinuityReady &&
    slice.qualityGates.transcriptReady &&
    slice.qualityGates.sentenceBoundaryReady &&
    slice.qualityGates.sourceRangeReady &&
    slice.qualityGates.silenceBoundaryReady &&
    (slice.grades.platformReadinessGrade === 'ready' || slice.grades.platformReadinessGrade === 'review'),
  ).length;
  const platformReadyOrReviewSlices = slices.filter((slice) => slice.qualityGates.platformReady).length;

  return {
    totalSlices,
    readySlices,
    reviewSlices,
    rejectSlices,
    readyOrReviewSlices,
    readyOrReviewRatio: ratio(readyOrReviewSlices, totalSlices),
    platformReadyOrReviewRatio: ratio(platformReadyOrReviewSlices, totalSlices),
    averagePublishabilityScore: averageScore(slices.map((slice) => slice.scores.publishabilityScore)),
    averageContinuityScore: averageScore(slices.map((slice) => slice.scores.continuityScore)),
    averageTranscriptCoverageScore: averageScore(slices.map((slice) => slice.scores.transcriptCoverageScore)),
    averagePlatformReadinessScore: averageScore(slices.map((slice) => slice.scores.platformReadinessScore)),
  };
}

function createSmartSliceQualityBlockers(summary, slices) {
  const blockers = [];
  if (summary.totalSlices < QUALITY_THRESHOLDS.minTotalSlices) {
    blockers.push({
      code: 'SMART_SLICE_NO_RENDERED_SLICES',
      message: 'No rendered smart slice results were provided for release quality evidence.',
      remediation: 'Run a transcript-assisted smart slicing workflow and export the completed task JSON.',
    });
  }

  if (summary.readyOrReviewRatio < QUALITY_THRESHOLDS.minReadyOrReviewRatio) {
    blockers.push({
      code: 'SMART_SLICE_READY_RATIO_TOO_LOW',
      message: 'Too few smart slices satisfy publishability, speech continuity, transcript, sentence, and source-range gates.',
      remediation: 'Review rejected slices, improve STT coverage, or adjust slice boundaries before release.',
      actual: summary.readyOrReviewRatio,
      expected: QUALITY_THRESHOLDS.minReadyOrReviewRatio,
    });
  }

  if (summary.averagePublishabilityScore < QUALITY_THRESHOLDS.minAveragePublishabilityScore) {
    blockers.push({
      code: 'SMART_SLICE_PUBLISHABILITY_TOO_LOW',
      message: 'Average smart slice publishability score is below the commercial release threshold.',
      remediation: 'Tune hook, payoff, content arc, and weak-boundary handling before release.',
      actual: summary.averagePublishabilityScore,
      expected: QUALITY_THRESHOLDS.minAveragePublishabilityScore,
    });
  }

  if (
    summary.averageContinuityScore < QUALITY_THRESHOLDS.minAverageContinuityScore ||
    summary.averageTranscriptCoverageScore < QUALITY_THRESHOLDS.minAverageTranscriptCoverageScore ||
    slices.some((slice) => !slice.qualityGates.speechContinuityReady || !slice.qualityGates.transcriptReady)
  ) {
    blockers.push({
      code: 'SMART_SLICE_TRANSCRIPT_CONTINUITY_TOO_LOW',
      message: 'Smart slice speech continuity or transcript coverage is below the commercial release threshold.',
      remediation: 'Regenerate STT, repair open sentence boundaries, and ensure each slice includes complete speech text.',
      actualContinuity: summary.averageContinuityScore,
      expectedContinuity: QUALITY_THRESHOLDS.minAverageContinuityScore,
      actualTranscriptCoverage: summary.averageTranscriptCoverageScore,
      expectedTranscriptCoverage: QUALITY_THRESHOLDS.minAverageTranscriptCoverageScore,
    });
  }

  if (summary.platformReadyOrReviewRatio < QUALITY_THRESHOLDS.minPlatformReadyOrReviewRatio) {
    blockers.push({
      code: 'SMART_SLICE_PLATFORM_READY_RATIO_TOO_LOW',
      message: 'Too few smart slices satisfy platform readiness for self-media publishing.',
      remediation: 'Tune target platform, aspect ratio, duration, hook strength, and ending completeness before release.',
      actual: summary.platformReadyOrReviewRatio,
      expected: QUALITY_THRESHOLDS.minPlatformReadyOrReviewRatio,
    });
  }

  const excessiveSilenceSlices = slices
    .filter((slice) => slice.qualityGates.sourceRangeReady && !slice.qualityGates.silenceBoundaryReady)
    .map((slice) => slice.index);
  if (excessiveSilenceSlices.length > 0) {
    blockers.push({
      code: 'SMART_SLICE_EXCESSIVE_SILENCE_BOUNDARY',
      message: 'Smart slice outputs include excessive leading or trailing silence around speech.',
      remediation: `Re-run smart slicing so each rendered slice keeps no more than ${QUALITY_THRESHOLDS.maxLeadingSilenceMs}ms leading and ${QUALITY_THRESHOLDS.maxTrailingSilenceMs}ms trailing speech boundary padding.`,
      actual: excessiveSilenceSlices,
      expected: {
        maxLeadingSilenceMs: QUALITY_THRESHOLDS.maxLeadingSilenceMs,
        maxTrailingSilenceMs: QUALITY_THRESHOLDS.maxTrailingSilenceMs,
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
  return roundScore(Math.max(0, Math.min(1, Number(numericValue))));
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

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
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

function averageScore(values) {
  const numericValues = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (numericValues.length === 0) {
    return 0;
  }
  return roundScore(numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length);
}

function ratio(count, total) {
  return total > 0 ? roundScore(count / total) : 0;
}

function roundScore(value) {
  return Math.round(value * 100) / 100;
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
        commandName: 'AutoCut smart slice quality evidence',
      });
      options.taskPath = option.value;
      index = option.nextIndex;
    } else if (arg === '--output') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut smart slice quality evidence',
      });
      options.outputPath = option.value;
      index = option.nextIndex;
    } else {
      throw new Error(`Unknown AutoCut smart slice quality evidence argument: ${arg}`);
    }
  }
  return options;
}

function main() {
  const result = writeAutoCutSmartSliceQualityEvidence(parseArgs(process.argv.slice(2)));
  console.log(formatAutoCutSmartSliceQualityEvidenceMessage(result));
  if (!result.evidence.readiness.smartSliceQualityReady) {
    for (const blocker of result.evidence.blockers) {
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
