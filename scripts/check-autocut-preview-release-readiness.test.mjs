#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createAutoCutPreviewReleaseReadinessReport,
  formatAutoCutPreviewReleaseReadinessMessage,
} from './check-autocut-preview-release-readiness.mjs';

function tempRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

function writeEvidence(root, overrides = {}) {
  const releasePath = path.join(root, 'artifacts', 'release', 'autocut-release-evidence.json');
  fs.mkdirSync(path.dirname(releasePath), { recursive: true });
  const evidence = {
    schemaVersion: '2026-05-05.autocut-release-evidence.v1',
    generatedAt: '2026-05-06T00:00:00.000Z',
    platform: 'windows-x86_64',
    readiness: {
      ffmpegExecutionReady: false,
      ffmpegBundledReady: false,
      speechBundledReady: false,
      releaseSmokeReady: true,
      nativeReleaseSmokeReady: true,
      nativeVideoSliceSmokeReady: true,
      smartSliceQualityReady: true,
      smartSliceMediaArtifactsReady: true,
      installerSignatureReady: false,
      ...overrides.readiness,
    },
    preflight: {
      sidecarPresent: false,
      integrityReady: false,
      bundledReady: false,
      speechSidecar: {
        sidecarPresent: false,
        integrityReady: false,
        bundledReady: false,
      },
      executableSmokeReady: 'skipped',
      releaseSmokeReady: true,
      ffmpegExecutionReady: false,
      ...overrides.preflight,
    },
    nativeReleaseSmoke: {
      ready: true,
      videoSliceReady: true,
      ...overrides.nativeReleaseSmoke,
    },
    smartSliceQuality: {
      ready: true,
      evidence: {
        readiness: {
          smartSliceQualityReady: true,
        },
        blockers: [],
      },
      ...overrides.smartSliceQuality,
    },
    smartSliceMediaArtifacts: {
      ready: true,
      evidence: {
        readiness: {
          smartSliceMediaArtifactsReady: true,
        },
        blockers: [],
      },
      ...overrides.smartSliceMediaArtifacts,
    },
    installerSignature: {
      ready: false,
      evidence: {
        blockers: [
          {
            code: 'INSTALLER_SIGNATURE_MISSING',
            message: 'signature missing',
          },
        ],
      },
      ...overrides.installerSignature,
    },
    installers: overrides.installers ?? [
      {
        kind: 'msi',
        path: 'packages/sdkwork-autocut-desktop/src-tauri/target/release/bundle/msi/SDKWork Video Cut_0.1.0_x64_en-US.msi',
        byteSize: 10,
        sha256: '0'.repeat(64),
      },
      {
        kind: 'nsis',
        path: 'packages/sdkwork-autocut-desktop/src-tauri/target/release/bundle/nsis/SDKWork Video Cut_0.1.0_x64-setup.exe',
        byteSize: 10,
        sha256: '1'.repeat(64),
      },
    ],
  };
  fs.writeFileSync(releasePath, JSON.stringify(evidence, null, 2));
  return releasePath;
}

const blockedRoot = tempRoot('autocut-preview-release-blocked');
writeEvidence(blockedRoot);
const blockedReport = createAutoCutPreviewReleaseReadinessReport({ rootDir: blockedRoot });

assert.equal(blockedReport.schemaVersion, '2026-05-06.autocut-preview-release-readiness.v1');
assert.equal(blockedReport.previewReleaseReady, false);
assert.deepEqual(
  blockedReport.blockers.map((blocker) => blocker.code),
  [
    'FFMPEG_SIDECAR_NOT_BUNDLED',
    'SPEECH_SIDECAR_NOT_BUNDLED',
    'FFMPEG_EXECUTABLE_SMOKE_NOT_VERIFIED',
    'FFMPEG_EXECUTION_NOT_READY',
  ],
);
assert.equal(
  formatAutoCutPreviewReleaseReadinessMessage(blockedReport),
  'blocked - autocut preview release readiness blockers=4 warnings=1',
);

const readyUnsignedRoot = tempRoot('autocut-preview-release-ready-unsigned');
writeEvidence(readyUnsignedRoot, {
  readiness: {
    ffmpegExecutionReady: false,
    ffmpegBundledReady: true,
    speechBundledReady: true,
    releaseSmokeReady: true,
    nativeReleaseSmokeReady: true,
    nativeVideoSliceSmokeReady: true,
    smartSliceQualityReady: true,
    smartSliceMediaArtifactsReady: true,
    installerSignatureReady: false,
  },
  preflight: {
    sidecarPresent: true,
    integrityReady: true,
    bundledReady: true,
    speechSidecar: {
      sidecarPresent: true,
      integrityReady: true,
      bundledReady: true,
    },
    executableSmokeReady: true,
    releaseSmokeReady: true,
    ffmpegExecutionReady: true,
  },
});
const readyUnsignedReport = createAutoCutPreviewReleaseReadinessReport({ rootDir: readyUnsignedRoot });

assert.equal(readyUnsignedReport.previewReleaseReady, true);
assert.deepEqual(readyUnsignedReport.blockers, []);
assert.deepEqual(
  readyUnsignedReport.warnings.map((warning) => warning.code),
  ['UNSIGNED_INSTALLERS_ACCEPTED_FOR_PREVIEW'],
);
assert.equal(readyUnsignedReport.readiness.installerSignatureReady, false);
assert.equal(readyUnsignedReport.readiness.ffmpegExecutionPreviewReady, true);
assert.equal(
  formatAutoCutPreviewReleaseReadinessMessage(readyUnsignedReport),
  'ok - autocut preview release readiness warnings=1',
);

const readySignedRoot = tempRoot('autocut-preview-release-ready-signed');
writeEvidence(readySignedRoot, {
  readiness: {
    ffmpegExecutionReady: true,
    ffmpegBundledReady: true,
    speechBundledReady: true,
    releaseSmokeReady: true,
    nativeReleaseSmokeReady: true,
    nativeVideoSliceSmokeReady: true,
    smartSliceQualityReady: true,
    smartSliceMediaArtifactsReady: true,
    installerSignatureReady: true,
  },
  preflight: {
    sidecarPresent: true,
    integrityReady: true,
    bundledReady: true,
    speechSidecar: {
      sidecarPresent: true,
      integrityReady: true,
      bundledReady: true,
    },
    executableSmokeReady: true,
    releaseSmokeReady: true,
    ffmpegExecutionReady: true,
  },
  installerSignature: {
    ready: true,
    evidence: {
      blockers: [],
    },
  },
});
const readySignedReport = createAutoCutPreviewReleaseReadinessReport({ rootDir: readySignedRoot });

assert.equal(readySignedReport.previewReleaseReady, true);
assert.deepEqual(readySignedReport.warnings, []);
assert.equal(readySignedReport.readiness.installerSignatureReady, true);

const missingInstallerRoot = tempRoot('autocut-preview-release-missing-installer');
writeEvidence(missingInstallerRoot, {
  readiness: {
    ffmpegBundledReady: true,
    speechBundledReady: true,
    releaseSmokeReady: true,
    nativeReleaseSmokeReady: true,
    nativeVideoSliceSmokeReady: true,
    smartSliceQualityReady: true,
    smartSliceMediaArtifactsReady: true,
  },
  preflight: {
    sidecarPresent: true,
    integrityReady: true,
    bundledReady: true,
    speechSidecar: {
      sidecarPresent: true,
      integrityReady: true,
      bundledReady: true,
    },
    executableSmokeReady: true,
    releaseSmokeReady: true,
    ffmpegExecutionReady: true,
  },
  installers: [
    {
      kind: 'msi',
      path: 'packages/sdkwork-autocut-desktop/src-tauri/target/release/bundle/msi/SDKWork Video Cut_0.1.0_x64_en-US.msi',
      byteSize: 0,
      sha256: '',
    },
  ],
});
const missingInstallerReport = createAutoCutPreviewReleaseReadinessReport({ rootDir: missingInstallerRoot });

assert.deepEqual(
  missingInstallerReport.blockers.map((blocker) => blocker.code),
  ['INSTALLER_ARTIFACTS_NOT_READY'],
);

console.log('ok - autocut preview release readiness contract');
