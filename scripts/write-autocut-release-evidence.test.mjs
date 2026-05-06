#!/usr/bin/env node

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createAutoCutReleaseEvidence,
  formatAutoCutReleaseEvidenceMessage,
  writeAutoCutReleaseEvidence,
} from './write-autocut-release-evidence.mjs';

function tempRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

function writeFixture(root) {
  const manifestPath = path.join(root, 'packages', 'sdkwork-autocut-desktop', 'src-tauri', 'binaries', 'ffmpeg.toolchain.json');
  const bundleRoot = path.join(root, 'packages', 'sdkwork-autocut-desktop', 'src-tauri', 'target', 'release', 'bundle');
  const msiPath = path.join(bundleRoot, 'msi', 'SDKWork Video Cut_0.1.0_x64_en-US.msi');
  const nsisPath = path.join(bundleRoot, 'nsis', 'SDKWork Video Cut_0.1.0_x64-setup.exe');
  const nativeSmokePath = path.join(root, 'artifacts', 'release', 'autocut-native-release-smoke.json');
  const signatureEvidencePath = path.join(root, 'artifacts', 'release', 'autocut-installer-signature-evidence.json');
  const smartSliceQualityEvidencePath = path.join(root, 'artifacts', 'release', 'autocut-smart-slice-quality-evidence.json');
  const smartSliceMediaArtifactsEvidencePath = path.join(root, 'artifacts', 'release', 'autocut-smart-slice-media-artifacts-evidence.json');
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.mkdirSync(path.dirname(msiPath), { recursive: true });
  fs.mkdirSync(path.dirname(nsisPath), { recursive: true });
  fs.mkdirSync(path.dirname(nativeSmokePath), { recursive: true });
  fs.mkdirSync(path.dirname(signatureEvidencePath), { recursive: true });
  fs.mkdirSync(path.dirname(smartSliceQualityEvidencePath), { recursive: true });
  fs.mkdirSync(path.dirname(smartSliceMediaArtifactsEvidencePath), { recursive: true });
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      tool: 'ffmpeg',
      contractVersion: '2026-05-05.ffmpeg-toolchain.v1',
      bundledReady: false,
      requiredBinary: 'ffmpeg',
      platforms: {
        'windows-x86_64': {
          relativePath: 'windows-x86_64/ffmpeg.exe',
          binaryName: 'ffmpeg.exe',
          integrity: {
            sha256: '0000000000000000000000000000000000000000000000000000000000000000',
            byteSize: 0,
          },
        },
      },
    }, null, 2),
  );
  fs.writeFileSync(msiPath, 'msi fixture');
  fs.writeFileSync(nsisPath, 'nsis fixture');
  fs.writeFileSync(
    nativeSmokePath,
    JSON.stringify(
      {
        schemaVersion: '2026-05-05.autocut-native-release-smoke.v1',
        generatedAt: '2026-05-05T00:00:00.000Z',
        readiness: {
          nativeReleaseSmokeReady: true,
          videoSliceSmokeReady: true,
          ffmpegExecutionReady: false,
        },
        commandMatrix: [
          {
            command: 'autocut_ffmpeg_probe',
            evidenceReady: true,
          },
          {
            command: 'autocut_slice_video',
            evidenceReady: true,
          },
        ],
        videoSliceSmoke: {
          skipped: false,
          success: true,
          stdout: 'autocut-video-slice-smoke=passed',
        },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    signatureEvidencePath,
    JSON.stringify(
      {
        schemaVersion: '2026-05-05.autocut-installer-signature-evidence.v1',
        generatedAt: '2026-05-05T00:00:00.000Z',
        readiness: {
          installerSignatureReady: false,
        },
        blockers: [
          {
            code: 'INSTALLER_SIGNATURE_MISSING',
            installerKind: 'msi',
          },
        ],
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    smartSliceQualityEvidencePath,
    JSON.stringify(
      {
        schemaVersion: '2026-05-06.autocut-smart-slice-quality-evidence.v1',
        generatedAt: '2026-05-06T00:00:00.000Z',
        readiness: {
          smartSliceQualityReady: true,
        },
        summary: {
          totalSlices: 2,
          readyOrReviewRatio: 1,
          averagePublishabilityScore: 0.81,
          averageContinuityScore: 0.89,
          averageTranscriptCoverageScore: 0.93,
          platformReadyOrReviewRatio: 1,
        },
        blockers: [],
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    smartSliceMediaArtifactsEvidencePath,
    JSON.stringify(
      {
        schemaVersion: '2026-05-06.autocut-smart-slice-media-artifacts-evidence.v1',
        generatedAt: '2026-05-06T00:00:00.000Z',
        readiness: {
          smartSliceMediaArtifactsReady: true,
        },
        summary: {
          totalSlices: 2,
          readySlices: 2,
          totalArtifacts: 5,
          readyArtifacts: 5,
          totalByteSize: 24000000,
        },
        blockers: [],
      },
      null,
      2,
    ),
  );
  return {
    manifestPath,
    msiPath,
    nsisPath,
    nativeSmokePath,
    signatureEvidencePath,
    smartSliceQualityEvidencePath,
    smartSliceMediaArtifactsEvidencePath,
  };
}

function writeReleaseReadyFixture(root) {
  const fixture = writeFixture(root);
  const sidecarPath = path.join(
    root,
    'packages',
    'sdkwork-autocut-desktop',
    'src-tauri',
    'binaries',
    'windows-x86_64',
    'ffmpeg.exe',
  );
  fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
  fs.writeFileSync(sidecarPath, 'ffmpeg version release fixture');
  const sidecarBytes = fs.readFileSync(sidecarPath);
  fs.writeFileSync(
    fixture.manifestPath,
    JSON.stringify({
      tool: 'ffmpeg',
      contractVersion: '2026-05-05.ffmpeg-toolchain.v1',
      bundledReady: true,
      requiredBinary: 'ffmpeg',
      platforms: {
        'windows-x86_64': {
          relativePath: 'windows-x86_64/ffmpeg.exe',
          binaryName: 'ffmpeg.exe',
          integrity: {
            sha256: crypto.createHash('sha256').update(sidecarBytes).digest('hex'),
            byteSize: sidecarBytes.length,
          },
        },
      },
    }, null, 2),
  );
  fs.writeFileSync(
    fixture.signatureEvidencePath,
    JSON.stringify(
      {
        schemaVersion: '2026-05-05.autocut-installer-signature-evidence.v1',
        generatedAt: '2026-05-05T00:00:00.000Z',
        readiness: {
          installerSignatureReady: true,
        },
        blockers: [],
      },
      null,
      2,
    ),
  );
  return { ...fixture, sidecarPath };
}

const root = tempRoot('autocut-release-evidence');
const fixture = writeFixture(root);
const evidence = createAutoCutReleaseEvidence({
  rootDir: root,
  platform: 'windows-x86_64',
  generatedAt: '2026-05-05T00:00:00.000Z',
  skipExecutableSmoke: true,
});

assert.equal(evidence.schemaVersion, '2026-05-05.autocut-release-evidence.v1');
assert.equal(evidence.platform, 'windows-x86_64');
assert.equal(evidence.readiness.ffmpegExecutionReady, false);
assert.equal(evidence.preflight.bundledReady, false);
assert.equal(evidence.preflight.releaseSmokeReady, true);
assert.equal(evidence.preflight.ffmpegExecutionReady, false);
assert.equal(evidence.readiness.nativeReleaseSmokeReady, true);
assert.equal(evidence.readiness.nativeVideoSliceSmokeReady, true);
assert.equal(evidence.nativeReleaseSmoke.path, 'artifacts/release/autocut-native-release-smoke.json');
assert.equal(evidence.nativeReleaseSmoke.ready, true);
assert.equal(evidence.nativeReleaseSmoke.videoSliceReady, true);
assert.equal(evidence.nativeReleaseSmoke.evidence.schemaVersion, '2026-05-05.autocut-native-release-smoke.v1');
assert.equal(evidence.readiness.smartSliceQualityReady, true);
assert.equal(evidence.smartSliceQuality.path, 'artifacts/release/autocut-smart-slice-quality-evidence.json');
assert.equal(evidence.smartSliceQuality.ready, true);
assert.equal(evidence.smartSliceQuality.evidence.schemaVersion, '2026-05-06.autocut-smart-slice-quality-evidence.v1');
assert.equal(evidence.readiness.smartSliceMediaArtifactsReady, true);
assert.equal(evidence.smartSliceMediaArtifacts.path, 'artifacts/release/autocut-smart-slice-media-artifacts-evidence.json');
assert.equal(evidence.smartSliceMediaArtifacts.ready, true);
assert.equal(evidence.smartSliceMediaArtifacts.evidence.schemaVersion, '2026-05-06.autocut-smart-slice-media-artifacts-evidence.v1');
assert.equal(evidence.readiness.installerSignatureReady, false);
assert.equal(evidence.installerSignature.path, 'artifacts/release/autocut-installer-signature-evidence.json');
assert.equal(evidence.installerSignature.ready, false);
assert.equal(evidence.installerSignature.evidence.schemaVersion, '2026-05-05.autocut-installer-signature-evidence.v1');
assert.equal(evidence.ffmpegManifest.path.endsWith('ffmpeg.toolchain.json'), true);
assert.equal(evidence.installers.length, 2);
assert.equal(evidence.installers[0].kind, 'msi');
assert.equal(evidence.installers[0].byteSize, 11);
assert.match(evidence.installers[0].sha256, /^[a-f0-9]{64}$/u);
assert.equal(evidence.installers[1].kind, 'nsis');
assert.equal(evidence.installers[1].byteSize, 12);

const readyRoot = tempRoot('autocut-release-evidence-ready');
const readyFixture = writeReleaseReadyFixture(readyRoot);
const readyEvidence = createAutoCutReleaseEvidence({
  rootDir: readyRoot,
  platform: 'windows-x86_64',
  generatedAt: '2026-05-05T00:00:00.000Z',
  runPreflightCommand(command, args) {
    assert.equal(command, readyFixture.sidecarPath);
    assert.deepEqual(args, ['-version']);
    return 'ffmpeg version release fixture';
  },
});

assert.equal(readyEvidence.preflight.bundledReady, true);
assert.equal(readyEvidence.preflight.executableSmokeReady, true);
assert.equal(readyEvidence.preflight.ffmpegExecutionReady, true);
assert.equal(readyEvidence.readiness.ffmpegExecutionReady, true);
assert.equal(readyEvidence.readiness.releaseSmokeReady, true);
assert.equal(readyEvidence.readiness.nativeReleaseSmokeReady, true);
assert.equal(readyEvidence.readiness.nativeVideoSliceSmokeReady, true);
assert.equal(readyEvidence.readiness.installerSignatureReady, true);
assert.equal(readyEvidence.readiness.smartSliceQualityReady, true);
assert.equal(readyEvidence.readiness.smartSliceMediaArtifactsReady, true);

const outputPath = path.join(root, 'artifacts', 'release', 'autocut-release-evidence.json');
const written = writeAutoCutReleaseEvidence({
  rootDir: root,
  platform: 'windows-x86_64',
  generatedAt: '2026-05-05T00:00:00.000Z',
  outputPath,
  skipExecutableSmoke: true,
});
const persisted = JSON.parse(fs.readFileSync(outputPath, 'utf8'));

assert.deepEqual(persisted, written.evidence);
assert.equal(written.outputPath, outputPath);
assert.equal(formatAutoCutReleaseEvidenceMessage(written), `ok - autocut release evidence ${outputPath} installers=2 ffmpegExecutionReady=false`);

fs.rmSync(fixture.msiPath);
assert.throws(
  () => createAutoCutReleaseEvidence({
    rootDir: root,
    platform: 'windows-x86_64',
    skipExecutableSmoke: true,
  }),
  /missing AutoCut release installer/u,
);

const blockedSmartSliceRoot = tempRoot('autocut-release-evidence-blocked-smart-slice');
const blockedSmartSliceFixture = writeFixture(blockedSmartSliceRoot);
fs.writeFileSync(
  blockedSmartSliceFixture.smartSliceQualityEvidencePath,
  JSON.stringify(
    {
      schemaVersion: '2026-05-06.autocut-smart-slice-quality-evidence.v1',
      readiness: {
        smartSliceQualityReady: false,
      },
      blockers: [
        {
          code: 'SMART_SLICE_PUBLISHABILITY_TOO_LOW',
        },
      ],
    },
    null,
    2,
  ),
);
assert.equal(
  createAutoCutReleaseEvidence({
    rootDir: blockedSmartSliceRoot,
    platform: 'windows-x86_64',
    skipExecutableSmoke: true,
  }).readiness.smartSliceQualityReady,
  false,
);

const blockedSmartSliceMediaRoot = tempRoot('autocut-release-evidence-blocked-smart-slice-media');
const blockedSmartSliceMediaFixture = writeFixture(blockedSmartSliceMediaRoot);
fs.writeFileSync(
  blockedSmartSliceMediaFixture.smartSliceMediaArtifactsEvidencePath,
  JSON.stringify(
    {
      schemaVersion: '2026-05-06.autocut-smart-slice-media-artifacts-evidence.v1',
      readiness: {
        smartSliceMediaArtifactsReady: false,
      },
      blockers: [
        {
          code: 'SMART_SLICE_MEDIA_ARTIFACT_MISSING',
        },
      ],
    },
    null,
    2,
  ),
);
assert.equal(
  createAutoCutReleaseEvidence({
    rootDir: blockedSmartSliceMediaRoot,
    platform: 'windows-x86_64',
    skipExecutableSmoke: true,
  }).readiness.smartSliceMediaArtifactsReady,
  false,
);

const blockedNativeVideoSliceRoot = tempRoot('autocut-release-evidence-blocked-native-video-slice');
const blockedNativeVideoSliceFixture = writeFixture(blockedNativeVideoSliceRoot);
fs.writeFileSync(
  blockedNativeVideoSliceFixture.nativeSmokePath,
  JSON.stringify(
    {
      schemaVersion: '2026-05-05.autocut-native-release-smoke.v1',
      generatedAt: '2026-05-05T00:00:00.000Z',
      readiness: {
        nativeReleaseSmokeReady: true,
        videoSliceSmokeReady: false,
        ffmpegExecutionReady: false,
      },
      commandMatrix: [
        {
          command: 'autocut_ffmpeg_probe',
          evidenceReady: true,
        },
        {
          command: 'autocut_slice_video',
          evidenceReady: false,
        },
      ],
      videoSliceSmoke: {
        skipped: false,
        success: false,
        stdout: '',
      },
    },
    null,
    2,
  ),
);
const blockedNativeVideoSliceEvidence = createAutoCutReleaseEvidence({
  rootDir: blockedNativeVideoSliceRoot,
  platform: 'windows-x86_64',
  skipExecutableSmoke: true,
});
assert.equal(blockedNativeVideoSliceEvidence.readiness.nativeReleaseSmokeReady, false);
assert.equal(blockedNativeVideoSliceEvidence.readiness.nativeVideoSliceSmokeReady, false);
assert.equal(blockedNativeVideoSliceEvidence.nativeReleaseSmoke.ready, false);
assert.equal(blockedNativeVideoSliceEvidence.nativeReleaseSmoke.videoSliceReady, false);

console.log('ok - autocut release evidence writer contract');
