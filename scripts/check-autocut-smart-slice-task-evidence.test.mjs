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
        sourceStartMs: 0,
        sourceEndMs: 42000,
        speechStartMs: 320,
        speechEndMs: 41600,
        transcriptText: 'Start with the result, then explain why the audience should care.',
        subtitleSegmentCount: 4,
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
assert.equal(readyReport.summary.continuityReadySlices, 1);
assert.equal(
  formatAutoCutSmartSliceTaskEvidenceValidationMessage(readyReport),
  `ok - autocut smart slice task evidence ${readyTaskPath} slices=1 blockers=0`,
);

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
  subtitleSegmentCount: 0,
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
  ],
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
