#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createAutoCutSmartSliceReleaseFixtureReportFromArgs,
  createAutoCutSmartSliceReleaseFixtureReport,
  formatAutoCutSmartSliceReleaseFixtureMessage,
  writeAutoCutSmartSliceReleaseFixtureReport,
} from './check-autocut-smart-slice-release-fixture.mjs';

function tempRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

const root = tempRoot('autocut-smart-slice-release-fixture');
const report = createAutoCutSmartSliceReleaseFixtureReport({
  rootDir: root,
  generatedAt: '2026-05-06T00:00:00.000Z',
});

assert.equal(report.schemaVersion, '2026-05-06.autocut-smart-slice-release-fixture.v1');
assert.equal(report.ready, true);
assert.equal(report.blockers.length, 0);
assert.equal(report.taskValidation.ready, true);
assert.equal(report.smartSliceQuality.ready, true);
assert.equal(report.releaseEvidence.ready, true);
assert.equal(report.commercialReadiness.ready, true);
const releaseEvidence = JSON.parse(
  fs.readFileSync(path.join(root, report.paths.releaseEvidence), 'utf8'),
);
assert.equal(releaseEvidence.readiness.nativeVideoSliceSmokeReady, true);
assert.equal(releaseEvidence.nativeReleaseSmoke.videoSliceReady, true);
assert.equal(report.summary.totalSlices, 2);
assert.equal(report.summary.smartSliceQualityReady, true);
assert.equal(report.summary.commercialReleaseReady, true);
assert.equal(
  report.paths.taskEvidence,
  'artifacts/smart-slice/smart-slice-task.json',
);
assert.equal(
  report.paths.qualityEvidence,
  'artifacts/release/autocut-smart-slice-quality-evidence.json',
);
assert.equal(
  report.paths.mediaArtifactsEvidence,
  'artifacts/release/autocut-smart-slice-media-artifacts-evidence.json',
);
assert.equal(
  report.paths.releaseEvidence,
  'artifacts/release/autocut-release-evidence.json',
);
assert.equal(
  fs.existsSync(path.join(root, report.paths.taskEvidence)),
  true,
);
assert.equal(
  fs.existsSync(path.join(root, report.paths.qualityEvidence)),
  true,
);
assert.equal(
  fs.existsSync(path.join(root, report.paths.mediaArtifactsEvidence)),
  true,
);
assert.equal(
  fs.existsSync(path.join(root, report.paths.releaseEvidence)),
  true,
);
assert.equal(
  formatAutoCutSmartSliceReleaseFixtureMessage(report),
  `ok - autocut smart slice release fixture ${root} slices=2 commercialReleaseReady=true blockers=0`,
);

const blockedRoot = tempRoot('autocut-smart-slice-release-fixture-blocked');
const blockedReport = createAutoCutSmartSliceReleaseFixtureReport({
  rootDir: blockedRoot,
  generatedAt: '2026-05-06T00:00:00.000Z',
  fixtureProfile: 'blocked-transcript',
});

assert.equal(blockedReport.ready, false);
assert.equal(blockedReport.taskValidation.ready, false);
assert.equal(blockedReport.smartSliceQuality.ready, false);
assert.equal(blockedReport.releaseEvidence.ready, false);
assert.equal(blockedReport.commercialReadiness.ready, false);
assert.deepEqual(
  blockedReport.blockers.map((blocker) => blocker.code),
  [
    'SMART_SLICE_TASK_TRANSCRIPT_MISSING',
    'SMART_SLICE_TASK_CONTINUITY_INCOMPLETE',
    'SMART_SLICE_QUALITY_NOT_READY',
    'SMART_SLICE_MEDIA_ARTIFACTS_NOT_READY',
    'SMART_SLICE_RELEASE_EVIDENCE_NOT_READY',
    'SMART_SLICE_COMMERCIAL_READINESS_NOT_READY',
  ],
);

const pnpmSeparatorRoot = tempRoot('autocut-smart-slice-release-fixture-pnpm-separator');
const pnpmSeparatorReport = createAutoCutSmartSliceReleaseFixtureReportFromArgs([
  '--',
  '--root',
  pnpmSeparatorRoot,
  '--profile',
  'ready',
], '2026-05-06T00:00:00.000Z');

assert.equal(pnpmSeparatorReport.ready, true);
assert.equal(pnpmSeparatorReport.rootDir, pnpmSeparatorRoot);

const writeRoot = tempRoot('autocut-smart-slice-release-fixture-write');
const writeResult = writeAutoCutSmartSliceReleaseFixtureReport({
  rootDir: writeRoot,
  generatedAt: '2026-05-06T00:00:00.000Z',
});

assert.equal(
  writeResult.outputPath,
  path.join(writeRoot, 'artifacts/release/autocut-smart-slice-release-fixture.json'),
);
assert.equal(writeResult.report.ready, true);
assert.equal(
  writeResult.report.paths.fixtureReport,
  'artifacts/release/autocut-smart-slice-release-fixture.json',
);
assert.equal(fs.existsSync(writeResult.outputPath), true);
assert.deepEqual(
  JSON.parse(fs.readFileSync(writeResult.outputPath, 'utf8')),
  writeResult.report,
);

const customOutputRoot = tempRoot('autocut-smart-slice-release-fixture-custom-output');
const customOutputPath = path.join(customOutputRoot, 'reports', 'fixture-report.json');
const customOutputReport = createAutoCutSmartSliceReleaseFixtureReportFromArgs([
  '--root',
  customOutputRoot,
  '--output',
  customOutputPath,
], '2026-05-06T00:00:00.000Z');

assert.equal(
  customOutputReport.paths.fixtureReport,
  path.relative(customOutputRoot, customOutputPath).replaceAll(path.sep, '/'),
);

console.log('ok - autocut smart slice release fixture contract');
