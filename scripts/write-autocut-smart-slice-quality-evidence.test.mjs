#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createAutoCutSmartSliceQualityEvidence,
  formatAutoCutSmartSliceQualityEvidenceMessage,
  writeAutoCutSmartSliceQualityEvidence,
} from './write-autocut-smart-slice-quality-evidence.mjs';

function tempRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

function writeTaskFixture(root, task, relativePath = 'artifacts/smart-slice/smart-slice-task.json') {
  const taskPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(taskPath), { recursive: true });
  fs.writeFileSync(taskPath, `${JSON.stringify(task, null, 2)}\n`);
  return taskPath;
}

function createTranscriptSegments(sourceStartMs, lines) {
  return lines.map((text, index) => ({
    startMs: sourceStartMs + index * 10_000 + 200,
    endMs: sourceStartMs + (index + 1) * 10_000,
    text,
  }));
}

function createReadyTask() {
  return {
    schemaVersion: '2026-05-06.autocut-smart-slice-task-evidence.v1',
    evidenceKind: 'smart-slice-task',
    id: 'task-smart-slice-ready',
    type: '视频切片',
    status: 'completed',
    resultCount: 2,
    sliceResults: [
      {
        id: 'slice-ready-1',
        name: 'ready-1.mp4',
        duration: 42,
        url: 'asset://ready-1.mp4',
        qualityScore: 0.91,
        continuityScore: 0.9,
        publishabilityScore: 0.88,
        publishabilityGrade: 'excellent',
        platformReadinessScore: 0.84,
        platformReadinessGrade: 'ready',
        sentenceBoundaryIntegrityScore: 0.92,
        sentenceBoundaryIntegrityGrade: 'clean',
        boundaryQualityScore: 0.86,
        hookStrength: 'strong',
        endingCompleteness: 'complete',
        transcriptCoverageScore: 0.96,
        transcriptSegmentCount: 4,
        speechContinuityGrade: 'strong',
        sourceStartMs: 0,
        sourceEndMs: 40250,
        speechStartMs: 200,
        speechEndMs: 40000,
        transcriptText: [
          'Why retention drops.',
          'Because the opening hides the pain.',
          'So show the result first.',
          'End on the clear payoff.',
        ].join(' '),
        transcriptSegments: createTranscriptSegments(0, [
          'Why retention drops.',
          'Because the opening hides the pain.',
          'So show the result first.',
          'End on the clear payoff.',
        ]),
      },
      {
        id: 'slice-ready-2',
        name: 'ready-2.mp4',
        duration: 36,
        url: 'asset://ready-2.mp4',
        qualityScore: 0.84,
        continuityScore: 0.88,
        publishabilityScore: 0.74,
        publishabilityGrade: 'good',
        platformReadinessScore: 0.76,
        platformReadinessGrade: 'review',
        sentenceBoundaryIntegrityScore: 0.84,
        sentenceBoundaryIntegrityGrade: 'repaired',
        boundaryQualityScore: 0.78,
        hookStrength: 'contextual',
        endingCompleteness: 'soft',
        transcriptCoverageScore: 0.9,
        transcriptSegmentCount: 3,
        speechContinuityGrade: 'repaired',
        sourceStartMs: 44000,
        sourceEndMs: 74250,
        speechStartMs: 44200,
        speechEndMs: 74000,
        transcriptText: [
          'The second short keeps the setup.',
          'It protects the transition.',
          'The ending stays together.',
        ].join(' '),
        transcriptSegments: createTranscriptSegments(44000, [
          'The second short keeps the setup.',
          'It protects the transition.',
          'The ending stays together.',
        ]),
        sentenceBoundaryIssues: ['sentence-open-ending-repaired'],
      },
    ],
  };
}

const readyRoot = tempRoot('autocut-smart-slice-quality-ready');
const readyTaskPath = writeTaskFixture(readyRoot, createReadyTask());
const readyEvidence = createAutoCutSmartSliceQualityEvidence({
  rootDir: readyRoot,
  taskPath: readyTaskPath,
  generatedAt: '2026-05-06T00:00:00.000Z',
});

assert.equal(readyEvidence.schemaVersion, '2026-05-06.autocut-smart-slice-quality-evidence.v1');
assert.equal(readyEvidence.readiness.smartSliceQualityReady, true);
assert.equal(readyEvidence.summary.totalSlices, 2);
assert.equal(readyEvidence.summary.readySlices, 1);
assert.equal(readyEvidence.summary.reviewSlices, 1);
assert.equal(readyEvidence.summary.rejectSlices, 0);
assert.equal(readyEvidence.summary.averagePublishabilityScore, 0.81);
assert.equal(readyEvidence.summary.averageContinuityScore, 0.89);
assert.equal(readyEvidence.summary.averageTranscriptCoverageScore, 0.93);
assert.equal(readyEvidence.slices[0].qualityGates.publishabilityReady, true);
assert.equal(readyEvidence.slices[0].qualityGates.speechContinuityReady, true);
assert.equal(readyEvidence.slices[0].qualityGates.transcriptReady, true);
assert.equal(readyEvidence.slices[0].qualityGates.platformReady, true);
assert.equal(readyEvidence.slices[0].transcript.transcriptStructuredSegmentCount, 4);
assert.equal(readyEvidence.blockers.length, 0);
assert.equal(
  formatAutoCutSmartSliceQualityEvidenceMessage({ outputPath: readyTaskPath, evidence: readyEvidence }),
  `ok - autocut smart slice quality evidence ${readyTaskPath} slices=2 ready=true blockers=0`,
);

const blockedRoot = tempRoot('autocut-smart-slice-quality-blocked');
const blockedTask = createReadyTask();
blockedTask.sliceResults = [
  {
    id: 'slice-bad-1',
    name: 'bad-1.mp4',
    duration: 10,
    url: 'asset://bad-1.mp4',
    qualityScore: 0.5,
    continuityScore: 0.4,
    publishabilityScore: 0.18,
    publishabilityGrade: 'reject',
    platformReadinessScore: 0.3,
    platformReadinessGrade: 'reject',
    sentenceBoundaryIntegrityScore: 0.2,
    sentenceBoundaryIntegrityGrade: 'broken',
    transcriptCoverageScore: 0.2,
    transcriptSegmentCount: 0,
    speechContinuityGrade: 'weak',
    sourceStartMs: 1000,
    sourceEndMs: 11000,
    speechStartMs: 1000,
    speechEndMs: 11000,
    transcriptText: '',
    publishabilityIssues: ['weak-speech-continuity'],
    platformReadinessIssues: ['platform-duration-too-short'],
    sentenceBoundaryIssues: ['sentence-open-ending-unrepaired'],
  },
];
const blockedTaskPath = writeTaskFixture(blockedRoot, blockedTask);
const blockedEvidence = createAutoCutSmartSliceQualityEvidence({
  rootDir: blockedRoot,
  taskPath: blockedTaskPath,
  generatedAt: '2026-05-06T00:00:00.000Z',
});

assert.equal(blockedEvidence.readiness.smartSliceQualityReady, false);
assert.deepEqual(
  blockedEvidence.blockers.map((blocker) => blocker.code),
  [
    'SMART_SLICE_READY_RATIO_TOO_LOW',
    'SMART_SLICE_PUBLISHABILITY_TOO_LOW',
    'SMART_SLICE_TRANSCRIPT_CONTINUITY_TOO_LOW',
    'SMART_SLICE_PLATFORM_READY_RATIO_TOO_LOW',
  ],
);
assert.equal(blockedEvidence.slices[0].qualityGates.publishabilityReady, false);
assert.equal(blockedEvidence.slices[0].qualityGates.speechContinuityReady, false);
assert.equal(blockedEvidence.slices[0].qualityGates.transcriptReady, false);
assert.equal(blockedEvidence.slices[0].qualityGates.platformReady, false);

const missingStructuredTranscriptRoot = tempRoot('autocut-smart-slice-quality-missing-structured-transcript');
const missingStructuredTranscriptTask = createReadyTask();
missingStructuredTranscriptTask.sliceResults[0] = {
  ...missingStructuredTranscriptTask.sliceResults[0],
  transcriptSegments: [],
};
const missingStructuredTranscriptTaskPath = writeTaskFixture(
  missingStructuredTranscriptRoot,
  missingStructuredTranscriptTask,
);
const missingStructuredTranscriptEvidence = createAutoCutSmartSliceQualityEvidence({
  rootDir: missingStructuredTranscriptRoot,
  taskPath: missingStructuredTranscriptTaskPath,
  generatedAt: '2026-05-06T00:00:00.000Z',
});

assert.equal(missingStructuredTranscriptEvidence.readiness.smartSliceQualityReady, false);
assert.equal(missingStructuredTranscriptEvidence.slices[0].qualityGates.transcriptReady, false);
assert.equal(missingStructuredTranscriptEvidence.slices[0].transcript.transcriptStructuredSegmentCount, 0);
assert.deepEqual(
  missingStructuredTranscriptEvidence.blockers.map((blocker) => blocker.code),
  [
    'SMART_SLICE_READY_RATIO_TOO_LOW',
    'SMART_SLICE_TRANSCRIPT_CONTINUITY_TOO_LOW',
  ],
);

const staleTranscriptTextRoot = tempRoot('autocut-smart-slice-quality-stale-transcript-text');
const staleTranscriptTextTask = createReadyTask();
staleTranscriptTextTask.sliceResults[0] = {
  ...staleTranscriptTextTask.sliceResults[0],
  transcriptText: 'This stale summary does not match the structured speech transcript.',
};
const staleTranscriptTextTaskPath = writeTaskFixture(staleTranscriptTextRoot, staleTranscriptTextTask);
const staleTranscriptTextEvidence = createAutoCutSmartSliceQualityEvidence({
  rootDir: staleTranscriptTextRoot,
  taskPath: staleTranscriptTextTaskPath,
  generatedAt: '2026-05-06T00:00:00.000Z',
});

assert.equal(staleTranscriptTextEvidence.readiness.smartSliceQualityReady, false);
assert.equal(staleTranscriptTextEvidence.slices[0].qualityGates.transcriptReady, false);
assert.equal(staleTranscriptTextEvidence.slices[0].transcript.transcriptTextMatchesSegments, false);
assert.deepEqual(
  staleTranscriptTextEvidence.blockers.map((blocker) => blocker.code),
  [
    'SMART_SLICE_READY_RATIO_TOO_LOW',
    'SMART_SLICE_TRANSCRIPT_CONTINUITY_TOO_LOW',
  ],
);

const overlappingTranscriptSegmentsRoot = tempRoot('autocut-smart-slice-quality-overlapping-transcript');
const overlappingTranscriptSegmentsTask = createReadyTask();
overlappingTranscriptSegmentsTask.sliceResults[0] = {
  ...overlappingTranscriptSegmentsTask.sliceResults[0],
  transcriptSegments: [
    { startMs: 200, endMs: 10_000, text: 'Why retention drops.' },
    { startMs: 9_900, endMs: 20_000, text: 'Because the opening hides the pain.' },
    ...createTranscriptSegments(0, [
      'So show the result first.',
      'End on the clear payoff.',
    ]).map((segment) => ({
      ...segment,
      startMs: segment.startMs + 20_000,
      endMs: segment.endMs + 20_000,
    })),
  ],
};
const overlappingTranscriptSegmentsTaskPath = writeTaskFixture(
  overlappingTranscriptSegmentsRoot,
  overlappingTranscriptSegmentsTask,
);
const overlappingTranscriptSegmentsEvidence = createAutoCutSmartSliceQualityEvidence({
  rootDir: overlappingTranscriptSegmentsRoot,
  taskPath: overlappingTranscriptSegmentsTaskPath,
  generatedAt: '2026-05-06T00:00:00.000Z',
});

assert.equal(overlappingTranscriptSegmentsEvidence.readiness.smartSliceQualityReady, false);
assert.equal(overlappingTranscriptSegmentsEvidence.slices[0].qualityGates.transcriptReady, false);
assert.equal(overlappingTranscriptSegmentsEvidence.slices[0].transcript.transcriptSegmentsOrdered, false);
assert.deepEqual(
  overlappingTranscriptSegmentsEvidence.blockers.map((blocker) => blocker.code),
  [
    'SMART_SLICE_READY_RATIO_TOO_LOW',
    'SMART_SLICE_TRANSCRIPT_CONTINUITY_TOO_LOW',
  ],
);

const speechBoundaryMismatchRoot = tempRoot('autocut-smart-slice-quality-speech-boundary-mismatch');
const speechBoundaryMismatchTask = createReadyTask();
speechBoundaryMismatchTask.sliceResults[0] = {
  ...speechBoundaryMismatchTask.sliceResults[0],
  speechEndMs: 41600,
};
const speechBoundaryMismatchTaskPath = writeTaskFixture(speechBoundaryMismatchRoot, speechBoundaryMismatchTask);
const speechBoundaryMismatchEvidence = createAutoCutSmartSliceQualityEvidence({
  rootDir: speechBoundaryMismatchRoot,
  taskPath: speechBoundaryMismatchTaskPath,
  generatedAt: '2026-05-06T00:00:00.000Z',
});

assert.equal(speechBoundaryMismatchEvidence.readiness.smartSliceQualityReady, false);
assert.equal(speechBoundaryMismatchEvidence.slices[0].qualityGates.transcriptReady, false);
assert.equal(speechBoundaryMismatchEvidence.slices[0].transcript.transcriptSpeechBoundaryMatches, false);
assert.deepEqual(
  speechBoundaryMismatchEvidence.blockers.map((blocker) => blocker.code),
  [
    'SMART_SLICE_READY_RATIO_TOO_LOW',
    'SMART_SLICE_TRANSCRIPT_CONTINUITY_TOO_LOW',
  ],
);

const excessiveSilenceRoot = tempRoot('autocut-smart-slice-quality-excessive-silence');
const excessiveSilenceTask = createReadyTask();
excessiveSilenceTask.sliceResults[0] = {
  ...excessiveSilenceTask.sliceResults[0],
  sourceStartMs: 0,
  sourceEndMs: 42_000,
  speechStartMs: 2_500,
  speechEndMs: 39_000,
};
const excessiveSilenceTaskPath = writeTaskFixture(excessiveSilenceRoot, excessiveSilenceTask);
const excessiveSilenceEvidence = createAutoCutSmartSliceQualityEvidence({
  rootDir: excessiveSilenceRoot,
  taskPath: excessiveSilenceTaskPath,
  generatedAt: '2026-05-06T00:00:00.000Z',
});

assert.equal(excessiveSilenceEvidence.readiness.smartSliceQualityReady, false);
assert.equal(excessiveSilenceEvidence.slices[0].qualityGates.silenceBoundaryReady, false);
assert.deepEqual(
  excessiveSilenceEvidence.blockers.map((blocker) => blocker.code),
  [
    'SMART_SLICE_READY_RATIO_TOO_LOW',
    'SMART_SLICE_TRANSCRIPT_CONTINUITY_TOO_LOW',
    'SMART_SLICE_EXCESSIVE_SILENCE_BOUNDARY',
  ],
);

const pendingRoot = tempRoot('autocut-smart-slice-quality-pending');
const pendingTask = createReadyTask();
pendingTask.status = 'processing';
const pendingTaskPath = writeTaskFixture(pendingRoot, pendingTask);
assert.throws(
  () =>
    createAutoCutSmartSliceQualityEvidence({
      rootDir: pendingRoot,
      taskPath: pendingTaskPath,
      generatedAt: '2026-05-06T00:00:00.000Z',
    }),
  /AutoCut smart slice task evidence must be exported from a completed task/u,
);

const unsupportedKindRoot = tempRoot('autocut-smart-slice-quality-unsupported-kind');
const unsupportedKindTask = createReadyTask();
unsupportedKindTask.evidenceKind = 'speech-transcription-task';
const unsupportedKindTaskPath = writeTaskFixture(unsupportedKindRoot, unsupportedKindTask);
assert.throws(
  () =>
    createAutoCutSmartSliceQualityEvidence({
      rootDir: unsupportedKindRoot,
      taskPath: unsupportedKindTaskPath,
      generatedAt: '2026-05-06T00:00:00.000Z',
    }),
  /unsupported AutoCut smart slice task evidence kind/u,
);

const unsupportedSchemaRoot = tempRoot('autocut-smart-slice-quality-unsupported-schema');
const unsupportedSchemaTask = createReadyTask();
unsupportedSchemaTask.schemaVersion = '2026-05-05.legacy-smart-slice-task.v1';
const unsupportedSchemaTaskPath = writeTaskFixture(unsupportedSchemaRoot, unsupportedSchemaTask);
assert.throws(
  () =>
    createAutoCutSmartSliceQualityEvidence({
      rootDir: unsupportedSchemaRoot,
      taskPath: unsupportedSchemaTaskPath,
      generatedAt: '2026-05-06T00:00:00.000Z',
    }),
  /unsupported AutoCut smart slice task evidence schema/u,
);

const outputPath = path.join(readyRoot, 'artifacts', 'release', 'autocut-smart-slice-quality-evidence.json');
const written = writeAutoCutSmartSliceQualityEvidence({
  rootDir: readyRoot,
  taskPath: readyTaskPath,
  outputPath,
  generatedAt: '2026-05-06T00:00:00.000Z',
});
const persisted = JSON.parse(fs.readFileSync(outputPath, 'utf8'));

assert.deepEqual(persisted, written.evidence);
assert.equal(written.outputPath, outputPath);

console.log('ok - autocut smart slice quality evidence writer contract');
