#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  normalizeAutoCutCliArgs,
  readAutoCutCliOptionValue,
} from './autocut-cli-args.mjs';

const __filename = fileURLToPath(import.meta.url);
const validationSchemaVersion = '2026-05-06.autocut-smart-slice-task-evidence-validation.v1';
const taskEvidenceSchemaVersion = '2026-05-06.autocut-smart-slice-task-evidence.v1';
const defaultTaskRelativePath = 'artifacts/smart-slice/smart-slice-task.json';
const minimumContinuityScore = 0.78;
const minimumTranscriptCoverageScore = 0.8;

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
    summary,
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
  const subtitleSegmentCount = normalizeNonNegativeInteger(slice?.subtitleSegmentCount) ?? 0;
  const durationMs = normalizeDurationMs(slice?.duration);
  const size = normalizeNonNegativeInteger(slice?.size) ?? 0;
  const continuityScore = normalizeScore(slice?.continuityScore);
  const transcriptCoverageScore = normalizeScore(slice?.transcriptCoverageScore);
  const publishabilityScore = normalizeScore(slice?.publishabilityScore);
  const platformReadinessScore = normalizeScore(slice?.platformReadinessScore);
  const url = normalizeString(slice?.url);
  const thumbnailUrl = normalizeString(slice?.thumbnailUrl);
  const resolution = normalizeString(slice?.resolution);
  const speechContinuityGrade = normalizeString(slice?.speechContinuityGrade);
  const publishabilityGrade = normalizeString(slice?.publishabilityGrade);
  const platformReadinessGrade = normalizeString(slice?.platformReadinessGrade);
  const sentenceBoundaryIntegrityGrade = normalizeString(slice?.sentenceBoundaryIntegrityGrade);
  const sourceRangeDurationMs = sourceEndMs !== undefined && sourceStartMs !== undefined
    ? sourceEndMs - sourceStartMs
    : undefined;
  const transcriptReady =
    transcriptText.length > 0 &&
    subtitleSegmentCount > 0 &&
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
    subtitleSegmentCount,
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
    gates: {
      transcriptReady,
      continuityReady,
      sourceRangeReady,
      renderArtifactReady,
      renderDurationReady,
      publishabilityReady,
      platformReady,
      sentenceBoundaryReady,
    },
  };
}

function createValidationSummary(slices) {
  return {
    totalSlices: slices.length,
    transcriptReadySlices: slices.filter((slice) => slice.gates.transcriptReady).length,
    continuityReadySlices: slices.filter((slice) => slice.gates.continuityReady).length,
    sourceRangeReadySlices: slices.filter((slice) => slice.gates.sourceRangeReady).length,
    renderArtifactReadySlices: slices.filter((slice) => slice.gates.renderArtifactReady).length,
    renderDurationReadySlices: slices.filter((slice) => slice.gates.renderDurationReady).length,
    publishabilityReadySlices: slices.filter((slice) => slice.gates.publishabilityReady).length,
    platformReadySlices: slices.filter((slice) => slice.gates.platformReady).length,
    sentenceBoundaryReadySlices: slices.filter((slice) => slice.gates.sentenceBoundaryReady).length,
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
      message: 'One or more smart slices are missing complete transcript text or subtitle segments.',
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

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
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
