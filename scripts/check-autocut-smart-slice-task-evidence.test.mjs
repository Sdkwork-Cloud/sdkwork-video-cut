#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createAutoCutSmartSliceTaskEvidenceValidationReport,
  formatAutoCutSmartSliceTaskEvidenceValidationMessage,
} from './check-autocut-smart-slice-task-evidence.mjs';

function tempRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

function writeTaskEvidence(root, task) {
  const taskPath = path.join(root, 'artifacts', 'smart-slice', 'smart-slice-task.json');
  fs.mkdirSync(path.dirname(taskPath), { recursive: true });
  fs.writeFileSync(taskPath, `${JSON.stringify(task, null, 2)}\n`);
  return taskPath;
}

function createTranscriptSegments(sourceStartMs = 0) {
  return [
    {
      startMs: sourceStartMs + 320,
      endMs: sourceStartMs + 10_800,
      text: 'Start with the result.',
    },
    {
      startMs: sourceStartMs + 10_800,
      endMs: sourceStartMs + 21_400,
      text: 'Then explain why the audience should care.',
    },
    {
      startMs: sourceStartMs + 21_400,
      endMs: sourceStartMs + 33_200,
      text: 'Keep the proof and takeaway in the same clip.',
    },
    {
      startMs: sourceStartMs + 33_200,
      endMs: sourceStartMs + 41_600,
      text: 'Finish on a complete sentence.',
    },
  ];
}

function createReadyTaskEvidence() {
  return {
    schemaVersion: '2026-05-06.autocut-smart-slice-task-evidence.v1',
    evidenceKind: 'smart-slice-task',
    exportedAt: '2026-05-06T00:00:00.000Z',
    id: 'task-smart-slice-ready',
    type: 'smart-slice',
    name: 'launch-review',
    status: 'completed',
    progress: 100,
    createdAt: '2026-05-06T00:00:00.000Z',
    completedAt: '2026-05-06T00:03:00.000Z',
    generatedAssetIds: ['asset-slice-1'],
    resultCount: 1,
    sliceResults: [
      {
        id: 'slice-ready-1',
        name: 'launch-review-01.mp4',
        url: 'asset://slice-ready-1.mp4',
        thumbnailUrl: 'asset://slice-ready-1.jpg',
        size: 12000000,
        resolution: '1080P',
        duration: 42,
        sourceStartMs: 120,
        sourceEndMs: 41850,
        speechStartMs: 320,
        speechEndMs: 41600,
        audioCleanupProfile: 'smart-slice-speech-denoise-v1',
        noiseReductionApplied: true,
        boundaryDecisionSource: 'combined',
        audioActivityStartMs: 320,
        audioActivityEndMs: 41600,
        audioActivityConfidence: 0.94,
        audioActivityAnalysisFilter: 'highpass=f=80,lowpass=f=12000,afftdn=nr=10:nf=-25,silencedetect=noise=-35dB:d=0.08',
        leadingSilenceMs: 200,
        trailingSilenceMs: 250,
        leadingSilenceTrimMs: 0,
        trailingSilenceTrimMs: 0,
        tailTreatment: 'none',
        transcriptText: createTranscriptSegments().map((segment) => segment.text).join(' '),
        transcriptSegments: createTranscriptSegments(),
        transcriptSegmentCount: 4,
        continuityScore: 0.9,
        transcriptCoverageScore: 0.94,
        publishabilityScore: 0.86,
        publishabilityGrade: 'good',
        platformReadinessScore: 0.82,
        platformReadinessGrade: 'ready',
        sentenceBoundaryIntegrityScore: 0.9,
        sentenceBoundaryIntegrityGrade: 'clean',
        speechContinuityGrade: 'strong',
      },
    ],
  };
}

const readyRoot = tempRoot('autocut-smart-slice-task-evidence-ready');
const readyTaskPath = writeTaskEvidence(readyRoot, createReadyTaskEvidence());
const readyReport = createAutoCutSmartSliceTaskEvidenceValidationReport({
  rootDir: readyRoot,
  taskPath: readyTaskPath,
});

assert.equal(readyReport.schemaVersion, '2026-05-06.autocut-smart-slice-task-evidence-validation.v1');
assert.equal(readyReport.ready, true);
assert.equal(readyReport.blockers.length, 0);
assert.equal(readyReport.summary.totalSlices, 1);
assert.equal(readyReport.summary.transcriptReadySlices, 1);
assert.equal(readyReport.summary.audioCleanupReadySlices, 1);
assert.equal(readyReport.summary.continuityReadySlices, 1);
assert.equal(readyReport.summary.reviewWarningSlices, 0);
assert.equal(readyReport.summary.reviewWarningCount, 0);
assert.deepEqual(readyReport.reviewWarnings, []);
assert.equal(readyReport.slices[0].transcriptSegmentCount, 4);
assert.equal(readyReport.slices[0].transcriptStructuredSegmentCount, 4);
assert.equal(readyReport.slices[0].audioCleanup.audioCleanupProfile, 'smart-slice-speech-denoise-v1');
assert.equal(readyReport.slices[0].gates.audioCleanupReady, true);
assert.equal(
  formatAutoCutSmartSliceTaskEvidenceValidationMessage(readyReport),
  `ok - autocut smart slice task evidence ${readyTaskPath} slices=1 blockers=0`,
);

const correctedTranscriptRoot = tempRoot('autocut-smart-slice-task-evidence-corrected-transcript');
const correctedTranscriptTask = createReadyTaskEvidence();
correctedTranscriptTask.sliceResults[0] = {
  ...correctedTranscriptTask.sliceResults[0],
  transcriptCorrection: {
    source: 'task-detail',
    correctedAt: '2026-05-06T00:02:30.000Z',
    originalTranscriptText: 'Start with the result. Then explain why the audience should care.',
    correctionCount: 2,
  },
};
const correctedTranscriptTaskPath = writeTaskEvidence(correctedTranscriptRoot, correctedTranscriptTask);
const correctedTranscriptReport = createAutoCutSmartSliceTaskEvidenceValidationReport({
  rootDir: correctedTranscriptRoot,
  taskPath: correctedTranscriptTaskPath,
});

assert.equal(correctedTranscriptReport.ready, true);
assert.equal(correctedTranscriptReport.blockers.length, 0);
assert.equal(correctedTranscriptReport.slices[0].transcriptCorrection.source, 'task-detail');
assert.equal(correctedTranscriptReport.slices[0].gates.transcriptCorrectionAuditReady, true);

const reviewRiskRoot = tempRoot('autocut-smart-slice-task-evidence-review-risks');
const reviewRiskTask = createReadyTaskEvidence();
reviewRiskTask.sliceResults[0] = {
  ...reviewRiskTask.sliceResults[0],
  risks: [
    'audio-boundary-refined',
    'excess-leading-silence-trimmed',
    'llm-timing-without-transcript',
    'timing-metadata-repaired',
    'transcript-overlap-repaired',
    'audio-transcript-boundary-conflict',
    'trailing-connector-extended',
  ],
  publishabilityIssues: ['low-transcript-coverage'],
  platformReadinessIssues: ['platform-hook-not-strong'],
  sentenceBoundaryIssues: ['sentence-leading-connector-unrepaired', 'sentence-clean-ending'],
};
const reviewRiskTaskPath = writeTaskEvidence(reviewRiskRoot, reviewRiskTask);
const reviewRiskReport = createAutoCutSmartSliceTaskEvidenceValidationReport({
  rootDir: reviewRiskRoot,
  taskPath: reviewRiskTaskPath,
});

assert.equal(reviewRiskReport.ready, true);
assert.equal(reviewRiskReport.blockers.length, 0);
assert.equal(reviewRiskReport.summary.reviewWarningSlices, 1);
assert.equal(reviewRiskReport.summary.reviewWarningCount, 10);
assert.deepEqual(
  reviewRiskReport.reviewWarnings.map((warning) => warning.code),
  [
    'audio-boundary-refined',
    'excess-leading-silence-trimmed',
    'llm-timing-without-transcript',
    'timing-metadata-repaired',
    'transcript-overlap-repaired',
    'audio-transcript-boundary-conflict',
    'trailing-connector-extended',
    'low-transcript-coverage',
    'platform-hook-not-strong',
    'sentence-leading-connector-unrepaired',
  ],
);
assert.equal(reviewRiskReport.reviewWarnings[0].severity, 'review');
assert.deepEqual(reviewRiskReport.reviewWarnings[0].sliceIndexes, [0]);
assert.equal(reviewRiskReport.reviewWarnings[0].title, 'Audio boundary refined');
assert.match(reviewRiskReport.reviewWarnings[0].message, /Denoised audio/i);
assert.match(reviewRiskReport.reviewWarnings[0].remediation, /Review/i);

const invalidTranscriptCorrectionRoot = tempRoot('autocut-smart-slice-task-evidence-invalid-transcript-correction');
const invalidTranscriptCorrectionTask = createReadyTaskEvidence();
invalidTranscriptCorrectionTask.sliceResults[0] = {
  ...invalidTranscriptCorrectionTask.sliceResults[0],
  transcriptCorrection: {
    source: 'unknown-ui',
    correctedAt: 'not-a-date',
    originalTranscriptText: '',
    correctionCount: 0,
  },
};
const invalidTranscriptCorrectionTaskPath = writeTaskEvidence(
  invalidTranscriptCorrectionRoot,
  invalidTranscriptCorrectionTask,
);
const invalidTranscriptCorrectionReport = createAutoCutSmartSliceTaskEvidenceValidationReport({
  rootDir: invalidTranscriptCorrectionRoot,
  taskPath: invalidTranscriptCorrectionTaskPath,
});

assert.equal(invalidTranscriptCorrectionReport.ready, false);
assert.equal(invalidTranscriptCorrectionReport.slices[0].gates.transcriptCorrectionAuditReady, false);
assert.deepEqual(
  invalidTranscriptCorrectionReport.blockers.map((blocker) => blocker.code),
  ['SMART_SLICE_TASK_TRANSCRIPT_CORRECTION_AUDIT_INVALID'],
);

const audioRefinedRoot = tempRoot('autocut-smart-slice-task-evidence-audio-refined-covered');
const audioRefinedTask = createReadyTaskEvidence();
audioRefinedTask.sliceResults[0] = {
  ...audioRefinedTask.sliceResults[0],
  sourceStartMs: 230,
  sourceEndMs: 41750,
  speechStartMs: 430,
  speechEndMs: 41500,
};
const audioRefinedTaskPath = writeTaskEvidence(audioRefinedRoot, audioRefinedTask);
const audioRefinedReport = createAutoCutSmartSliceTaskEvidenceValidationReport({
  rootDir: audioRefinedRoot,
  taskPath: audioRefinedTaskPath,
});

assert.equal(audioRefinedReport.ready, true);
assert.equal(audioRefinedReport.blockers.length, 0);
assert.equal(audioRefinedReport.slices[0].gates.transcriptReady, true);
assert.equal(audioRefinedReport.slices[0].gates.transcriptSpeechBoundaryMatches, true);

const pendingRoot = tempRoot('autocut-smart-slice-task-evidence-pending');
const pendingTask = createReadyTaskEvidence();
pendingTask.status = 'processing';
const pendingTaskPath = writeTaskEvidence(pendingRoot, pendingTask);
const pendingReport = createAutoCutSmartSliceTaskEvidenceValidationReport({
  rootDir: pendingRoot,
  taskPath: pendingTaskPath,
});

assert.equal(pendingReport.ready, false);
assert.deepEqual(
  pendingReport.blockers.map((blocker) => blocker.code),
  ['SMART_SLICE_TASK_NOT_COMPLETED'],
);

const incompleteRoot = tempRoot('autocut-smart-slice-task-evidence-incomplete');
const incompleteTask = createReadyTaskEvidence();
incompleteTask.sliceResults[0] = {
  ...incompleteTask.sliceResults[0],
  speechEndMs: 50000,
  transcriptText: '',
  transcriptSegmentCount: 0,
  continuityScore: 0.4,
  transcriptCoverageScore: 0.2,
  speechContinuityGrade: 'weak',
};
const incompleteTaskPath = writeTaskEvidence(incompleteRoot, incompleteTask);
const incompleteReport = createAutoCutSmartSliceTaskEvidenceValidationReport({
  rootDir: incompleteRoot,
  taskPath: incompleteTaskPath,
});

assert.equal(incompleteReport.ready, false);
assert.deepEqual(
  incompleteReport.blockers.map((blocker) => blocker.code),
  [
    'SMART_SLICE_TASK_TRANSCRIPT_MISSING',
    'SMART_SLICE_TASK_CONTINUITY_INCOMPLETE',
    'SMART_SLICE_TASK_SOURCE_RANGE_INVALID',
    'SMART_SLICE_TASK_AUDIO_CLEANUP_INCOMPLETE',
  ],
);

const missingStructuredTranscriptRoot = tempRoot('autocut-smart-slice-task-evidence-missing-structured-transcript');
const missingStructuredTranscriptTask = createReadyTaskEvidence();
missingStructuredTranscriptTask.sliceResults[0] = {
  ...missingStructuredTranscriptTask.sliceResults[0],
  transcriptSegments: [],
};
const missingStructuredTranscriptTaskPath = writeTaskEvidence(
  missingStructuredTranscriptRoot,
  missingStructuredTranscriptTask,
);
const missingStructuredTranscriptReport = createAutoCutSmartSliceTaskEvidenceValidationReport({
  rootDir: missingStructuredTranscriptRoot,
  taskPath: missingStructuredTranscriptTaskPath,
});

assert.equal(missingStructuredTranscriptReport.ready, false);
assert.equal(missingStructuredTranscriptReport.slices[0].transcriptStructuredSegmentCount, 0);
assert.deepEqual(
  missingStructuredTranscriptReport.blockers.map((blocker) => blocker.code),
  ['SMART_SLICE_TASK_TRANSCRIPT_MISSING'],
);

const staleTranscriptTextRoot = tempRoot('autocut-smart-slice-task-evidence-stale-transcript-text');
const staleTranscriptTextTask = createReadyTaskEvidence();
staleTranscriptTextTask.sliceResults[0] = {
  ...staleTranscriptTextTask.sliceResults[0],
  transcriptText: 'This stale summary does not match the speech recognition segments.',
};
const staleTranscriptTextTaskPath = writeTaskEvidence(staleTranscriptTextRoot, staleTranscriptTextTask);
const staleTranscriptTextReport = createAutoCutSmartSliceTaskEvidenceValidationReport({
  rootDir: staleTranscriptTextRoot,
  taskPath: staleTranscriptTextTaskPath,
});

assert.equal(staleTranscriptTextReport.ready, false);
assert.equal(staleTranscriptTextReport.slices[0].gates.transcriptTextMatchesSegments, false);
assert.deepEqual(
  staleTranscriptTextReport.blockers.map((blocker) => blocker.code),
  ['SMART_SLICE_TASK_TRANSCRIPT_MISSING'],
);

const overlappingTranscriptSegmentsRoot = tempRoot('autocut-smart-slice-task-evidence-overlapping-transcript');
const overlappingTranscriptSegmentsTask = createReadyTaskEvidence();
overlappingTranscriptSegmentsTask.sliceResults[0] = {
  ...overlappingTranscriptSegmentsTask.sliceResults[0],
  transcriptSegments: [
    { startMs: 320, endMs: 12_000, text: 'Start with the result.' },
    { startMs: 11_900, endMs: 21_400, text: 'Then explain why the audience should care.' },
    ...createTranscriptSegments().slice(2),
  ],
};
const overlappingTranscriptSegmentsTaskPath = writeTaskEvidence(
  overlappingTranscriptSegmentsRoot,
  overlappingTranscriptSegmentsTask,
);
const overlappingTranscriptSegmentsReport = createAutoCutSmartSliceTaskEvidenceValidationReport({
  rootDir: overlappingTranscriptSegmentsRoot,
  taskPath: overlappingTranscriptSegmentsTaskPath,
});

assert.equal(overlappingTranscriptSegmentsReport.ready, false);
assert.equal(overlappingTranscriptSegmentsReport.slices[0].gates.transcriptSegmentsOrdered, false);
assert.deepEqual(
  overlappingTranscriptSegmentsReport.blockers.map((blocker) => blocker.code),
  ['SMART_SLICE_TASK_TRANSCRIPT_MISSING'],
);

const speechBoundaryMismatchRoot = tempRoot('autocut-smart-slice-task-evidence-speech-boundary-mismatch');
const speechBoundaryMismatchTask = createReadyTaskEvidence();
speechBoundaryMismatchTask.sliceResults[0] = {
  ...speechBoundaryMismatchTask.sliceResults[0],
  speechStartMs: 150,
};
const speechBoundaryMismatchTaskPath = writeTaskEvidence(speechBoundaryMismatchRoot, speechBoundaryMismatchTask);
const speechBoundaryMismatchReport = createAutoCutSmartSliceTaskEvidenceValidationReport({
  rootDir: speechBoundaryMismatchRoot,
  taskPath: speechBoundaryMismatchTaskPath,
});

assert.equal(speechBoundaryMismatchReport.ready, false);
assert.equal(speechBoundaryMismatchReport.slices[0].gates.transcriptSpeechBoundaryMatches, false);
assert.deepEqual(
  speechBoundaryMismatchReport.blockers.map((blocker) => blocker.code),
  ['SMART_SLICE_TASK_TRANSCRIPT_MISSING'],
);

const missingArtifactRoot = tempRoot('autocut-smart-slice-task-evidence-missing-artifact');
const missingArtifactTask = createReadyTaskEvidence();
missingArtifactTask.sliceResults[0] = {
  ...missingArtifactTask.sliceResults[0],
  url: '',
  thumbnailUrl: '',
  size: 0,
  resolution: '',
};
const missingArtifactTaskPath = writeTaskEvidence(missingArtifactRoot, missingArtifactTask);
const missingArtifactReport = createAutoCutSmartSliceTaskEvidenceValidationReport({
  rootDir: missingArtifactRoot,
  taskPath: missingArtifactTaskPath,
});

assert.equal(missingArtifactReport.ready, false);
assert.deepEqual(
  missingArtifactReport.blockers.map((blocker) => blocker.code),
  ['SMART_SLICE_TASK_RENDER_ARTIFACT_MISSING'],
);

const durationMismatchRoot = tempRoot('autocut-smart-slice-task-evidence-duration-mismatch');
const durationMismatchTask = createReadyTaskEvidence();
durationMismatchTask.sliceResults[0] = {
  ...durationMismatchTask.sliceResults[0],
  duration: 9,
};
const durationMismatchTaskPath = writeTaskEvidence(durationMismatchRoot, durationMismatchTask);
const durationMismatchReport = createAutoCutSmartSliceTaskEvidenceValidationReport({
  rootDir: durationMismatchRoot,
  taskPath: durationMismatchTaskPath,
});

assert.equal(durationMismatchReport.ready, false);
assert.deepEqual(
  durationMismatchReport.blockers.map((blocker) => blocker.code),
  ['SMART_SLICE_TASK_RENDER_DURATION_MISMATCH'],
);

const missingAudioCleanupRoot = tempRoot('autocut-smart-slice-task-evidence-missing-audio-cleanup');
const missingAudioCleanupTask = createReadyTaskEvidence();
missingAudioCleanupTask.sliceResults[0] = {
  ...missingAudioCleanupTask.sliceResults[0],
  audioCleanupProfile: undefined,
  noiseReductionApplied: false,
  boundaryDecisionSource: undefined,
  audioActivityStartMs: undefined,
  audioActivityEndMs: undefined,
  audioActivityConfidence: 0.2,
  audioActivityAnalysisFilter: undefined,
  leadingSilenceTrimMs: undefined,
  trailingSilenceTrimMs: undefined,
  tailTreatment: undefined,
};
const missingAudioCleanupTaskPath = writeTaskEvidence(missingAudioCleanupRoot, missingAudioCleanupTask);
const missingAudioCleanupReport = createAutoCutSmartSliceTaskEvidenceValidationReport({
  rootDir: missingAudioCleanupRoot,
  taskPath: missingAudioCleanupTaskPath,
});

assert.equal(missingAudioCleanupReport.ready, false);
assert.equal(missingAudioCleanupReport.slices[0].gates.audioCleanupReady, false);
assert.deepEqual(
  missingAudioCleanupReport.blockers.map((blocker) => blocker.code),
  ['SMART_SLICE_TASK_AUDIO_CLEANUP_INCOMPLETE'],
);

const weakAudioActivityRoot = tempRoot('autocut-smart-slice-task-evidence-weak-audio-activity');
const weakAudioActivityTask = createReadyTaskEvidence();
weakAudioActivityTask.sliceResults[0] = {
  ...weakAudioActivityTask.sliceResults[0],
  audioActivityConfidence: 0.55,
  audioActivityAnalysisFilter: 'silencedetect=noise=-35dB:d=0.08',
};
const weakAudioActivityTaskPath = writeTaskEvidence(weakAudioActivityRoot, weakAudioActivityTask);
const weakAudioActivityReport = createAutoCutSmartSliceTaskEvidenceValidationReport({
  rootDir: weakAudioActivityRoot,
  taskPath: weakAudioActivityTaskPath,
});

assert.equal(weakAudioActivityReport.ready, false);
assert.equal(weakAudioActivityReport.slices[0].gates.audioCleanupReady, false);
assert.deepEqual(
  weakAudioActivityReport.blockers.map((blocker) => blocker.code),
  ['SMART_SLICE_TASK_AUDIO_CLEANUP_INCOMPLETE'],
);

const missingAudioActivityRangeRoot = tempRoot('autocut-smart-slice-task-evidence-missing-audio-activity-range');
const missingAudioActivityRangeTask = createReadyTaskEvidence();
missingAudioActivityRangeTask.sliceResults[0] = {
  ...missingAudioActivityRangeTask.sliceResults[0],
  audioActivityStartMs: undefined,
  audioActivityEndMs: undefined,
};
const missingAudioActivityRangeTaskPath = writeTaskEvidence(missingAudioActivityRangeRoot, missingAudioActivityRangeTask);
const missingAudioActivityRangeReport = createAutoCutSmartSliceTaskEvidenceValidationReport({
  rootDir: missingAudioActivityRangeRoot,
  taskPath: missingAudioActivityRangeTaskPath,
});

assert.equal(missingAudioActivityRangeReport.ready, false);
assert.equal(missingAudioActivityRangeReport.slices[0].gates.audioActivityRangeReady, false);
assert.deepEqual(
  missingAudioActivityRangeReport.blockers.map((blocker) => blocker.code),
  ['SMART_SLICE_TASK_AUDIO_CLEANUP_INCOMPLETE'],
);

const missingRawSilenceEvidenceRoot = tempRoot('autocut-smart-slice-task-evidence-missing-raw-silence');
const missingRawSilenceEvidenceTask = createReadyTaskEvidence();
missingRawSilenceEvidenceTask.sliceResults[0] = {
  ...missingRawSilenceEvidenceTask.sliceResults[0],
  leadingSilenceMs: undefined,
  trailingSilenceMs: undefined,
};
const missingRawSilenceEvidenceTaskPath = writeTaskEvidence(missingRawSilenceEvidenceRoot, missingRawSilenceEvidenceTask);
const missingRawSilenceEvidenceReport = createAutoCutSmartSliceTaskEvidenceValidationReport({
  rootDir: missingRawSilenceEvidenceRoot,
  taskPath: missingRawSilenceEvidenceTaskPath,
});

assert.equal(missingRawSilenceEvidenceReport.ready, false);
assert.equal(missingRawSilenceEvidenceReport.slices[0].gates.audioCleanupReady, false);
assert.deepEqual(
  missingRawSilenceEvidenceReport.blockers.map((blocker) => blocker.code),
  ['SMART_SLICE_TASK_AUDIO_CLEANUP_INCOMPLETE'],
);

const excessiveSilenceRoot = tempRoot('autocut-smart-slice-task-evidence-excessive-silence');
const excessiveSilenceTask = createReadyTaskEvidence();
excessiveSilenceTask.sliceResults[0] = {
  ...excessiveSilenceTask.sliceResults[0],
  sourceStartMs: 0,
  sourceEndMs: 42_000,
  speechStartMs: 2_400,
  speechEndMs: 39_000,
};
const excessiveSilenceTaskPath = writeTaskEvidence(excessiveSilenceRoot, excessiveSilenceTask);
const excessiveSilenceReport = createAutoCutSmartSliceTaskEvidenceValidationReport({
  rootDir: excessiveSilenceRoot,
  taskPath: excessiveSilenceTaskPath,
});

assert.equal(excessiveSilenceReport.ready, false);
assert.equal(excessiveSilenceReport.slices[0].gates.silenceBoundaryReady, false);
assert.deepEqual(
  excessiveSilenceReport.blockers.map((blocker) => blocker.code),
  ['SMART_SLICE_TASK_EXCESSIVE_SILENCE_BOUNDARY'],
);

const unsupportedRoot = tempRoot('autocut-smart-slice-task-evidence-unsupported');
const unsupportedTask = createReadyTaskEvidence();
unsupportedTask.evidenceKind = 'other-task';
const unsupportedTaskPath = writeTaskEvidence(unsupportedRoot, unsupportedTask);
const unsupportedReport = createAutoCutSmartSliceTaskEvidenceValidationReport({
  rootDir: unsupportedRoot,
  taskPath: unsupportedTaskPath,
});

assert.equal(unsupportedReport.ready, false);
assert.deepEqual(
  unsupportedReport.blockers.map((blocker) => blocker.code),
  ['SMART_SLICE_TASK_EVIDENCE_KIND_UNSUPPORTED'],
);

console.log('ok - autocut smart slice task evidence validation contract');
