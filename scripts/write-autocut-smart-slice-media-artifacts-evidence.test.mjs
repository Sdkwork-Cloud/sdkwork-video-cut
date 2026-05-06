#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createAutoCutSmartSliceMediaArtifactsEvidence,
  formatAutoCutSmartSliceMediaArtifactsEvidenceMessage,
  writeAutoCutSmartSliceMediaArtifactsEvidence,
} from './write-autocut-smart-slice-media-artifacts-evidence.mjs';

function tempRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFixtureFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function createTaskEvidence(root) {
  const videoPath = path.join(root, 'artifacts', 'smart-slice-media', 'slice-01.mp4');
  const thumbnailPath = path.join(root, 'artifacts', 'smart-slice-media', 'slice-01.jpg');
  const subtitlePath = path.join(root, 'artifacts', 'smart-slice-media', 'slice-01.srt');
  writeFixtureFile(videoPath, 'video fixture bytes');
  writeFixtureFile(thumbnailPath, 'thumbnail fixture bytes');
  writeFixtureFile(subtitlePath, '1\n00:00:00,000 --> 00:00:02,000\nStart with the result.\n');

  return {
    schemaVersion: '2026-05-06.autocut-smart-slice-task-evidence.v1',
    evidenceKind: 'smart-slice-task',
    exportedAt: '2026-05-06T00:00:00.000Z',
    id: 'task-smart-slice-media-ready',
    type: 'smart-slice',
    name: 'smart-slice-media-ready',
    status: 'completed',
    progress: 100,
    resultCount: 1,
    sliceResults: [
      {
        id: 'slice-ready-1',
        name: 'slice-01.mp4',
        url: `asset://localhost/${encodeURIComponent(videoPath)}`,
        thumbnailUrl: `asset://localhost/${encodeURIComponent(thumbnailPath)}`,
        subtitleUrl: `asset://localhost/${encodeURIComponent(subtitlePath)}`,
        subtitleFormat: 'srt',
        size: fs.statSync(videoPath).size,
        resolution: '1080P',
        duration: 18,
        sourceStartMs: 0,
        sourceEndMs: 18000,
        speechStartMs: 100,
        speechEndMs: 17600,
        transcriptText: 'Start with the result and finish with a clear takeaway.',
        subtitleSegmentCount: 2,
        continuityScore: 0.9,
        transcriptCoverageScore: 0.94,
        publishabilityScore: 0.84,
        publishabilityGrade: 'good',
        platformReadinessScore: 0.82,
        platformReadinessGrade: 'ready',
        sentenceBoundaryIntegrityGrade: 'clean',
        speechContinuityGrade: 'strong',
      },
    ],
  };
}

const root = tempRoot('autocut-smart-slice-media-artifacts-ready');
const taskPath = path.join(root, 'artifacts', 'smart-slice', 'smart-slice-task.json');
writeJson(taskPath, createTaskEvidence(root));

const evidence = createAutoCutSmartSliceMediaArtifactsEvidence({
  rootDir: root,
  taskPath,
  generatedAt: '2026-05-06T00:00:00.000Z',
});

assert.equal(evidence.schemaVersion, '2026-05-06.autocut-smart-slice-media-artifacts-evidence.v1');
assert.equal(evidence.readiness.smartSliceMediaArtifactsReady, true);
assert.equal(evidence.blockers.length, 0);
assert.equal(evidence.summary.totalSlices, 1);
assert.equal(evidence.summary.readySlices, 1);
assert.equal(evidence.summary.totalArtifacts, 3);
assert.equal(evidence.summary.readyArtifacts, 3);
assert.equal(evidence.slices[0].artifacts.video.ready, true);
assert.equal(evidence.slices[0].artifacts.thumbnail.ready, true);
assert.equal(evidence.slices[0].artifacts.subtitle.ready, true);
assert.match(evidence.slices[0].artifacts.video.sha256, /^[a-f0-9]{64}$/u);
assert.equal(evidence.slices[0].artifacts.video.byteSize, 'video fixture bytes'.length);

const outputPath = path.join(root, 'artifacts', 'release', 'autocut-smart-slice-media-artifacts-evidence.json');
const written = writeAutoCutSmartSliceMediaArtifactsEvidence({
  rootDir: root,
  taskPath,
  outputPath,
  generatedAt: '2026-05-06T00:00:00.000Z',
});

assert.equal(written.outputPath, outputPath);
assert.deepEqual(JSON.parse(fs.readFileSync(outputPath, 'utf8')), written.evidence);
assert.equal(
  formatAutoCutSmartSliceMediaArtifactsEvidenceMessage(written),
  `ok - autocut smart slice media artifacts evidence ${outputPath} slices=1 artifacts=3 ready=true blockers=0`,
);

const missingRoot = tempRoot('autocut-smart-slice-media-artifacts-missing');
const missingTask = createTaskEvidence(missingRoot);
const missingVideoUrl = missingTask.sliceResults[0].url;
const missingVideoPath = decodeURIComponent(new URL(missingVideoUrl).pathname.slice(1));
fs.rmSync(missingVideoPath);
writeJson(path.join(missingRoot, 'artifacts', 'smart-slice', 'smart-slice-task.json'), missingTask);

const missingEvidence = createAutoCutSmartSliceMediaArtifactsEvidence({
  rootDir: missingRoot,
  generatedAt: '2026-05-06T00:00:00.000Z',
});

assert.equal(missingEvidence.readiness.smartSliceMediaArtifactsReady, false);
assert.deepEqual(
  missingEvidence.blockers.map((blocker) => blocker.code),
  ['SMART_SLICE_MEDIA_ARTIFACT_MISSING'],
);

const escapingRoot = tempRoot('autocut-smart-slice-media-artifacts-escaping');
const escapingTask = createTaskEvidence(escapingRoot);
escapingTask.sliceResults[0].url = `asset://localhost/${encodeURIComponent(path.join(os.tmpdir(), 'outside-autocut-slice.mp4'))}`;
writeJson(path.join(escapingRoot, 'artifacts', 'smart-slice', 'smart-slice-task.json'), escapingTask);

const escapingEvidence = createAutoCutSmartSliceMediaArtifactsEvidence({
  rootDir: escapingRoot,
  generatedAt: '2026-05-06T00:00:00.000Z',
});

assert.equal(escapingEvidence.readiness.smartSliceMediaArtifactsReady, false);
assert.deepEqual(
  escapingEvidence.blockers.map((blocker) => blocker.code),
  ['SMART_SLICE_MEDIA_ARTIFACT_PATH_ESCAPE'],
);

console.log('ok - autocut smart slice media artifacts evidence contract');
