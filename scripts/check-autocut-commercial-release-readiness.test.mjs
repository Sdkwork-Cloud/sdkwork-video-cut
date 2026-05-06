#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createAutoCutCommercialReleaseReadinessReport,
  formatAutoCutCommercialReleaseReadinessMessage,
} from './check-autocut-commercial-release-readiness.mjs';

function tempRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

function writeEvidence(root, overrides = {}) {
  const releasePath = path.join(root, 'artifacts', 'release', 'autocut-release-evidence.json');
  fs.mkdirSync(path.dirname(releasePath), { recursive: true });
  const evidence = {
    schemaVersion: '2026-05-05.autocut-release-evidence.v1',
    generatedAt: '2026-05-05T00:00:00.000Z',
    platform: 'windows-x86_64',
    readiness: {
      ffmpegExecutionReady: false,
      ffmpegBundledReady: false,
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
    installers: [
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

const blockedRoot = tempRoot('autocut-commercial-release-blocked');
writeEvidence(blockedRoot);
const blockedReport = createAutoCutCommercialReleaseReadinessReport({ rootDir: blockedRoot });

assert.equal(blockedReport.schemaVersion, '2026-05-05.autocut-commercial-release-readiness.v1');
assert.equal(blockedReport.commercialReleaseReady, false);
assert.deepEqual(
  blockedReport.blockers.map((blocker) => blocker.code),
  [
    'FFMPEG_SIDECAR_NOT_BUNDLED',
    'FFMPEG_EXECUTABLE_SMOKE_NOT_VERIFIED',
    'FFMPEG_EXECUTION_NOT_READY',
    'INSTALLER_SIGNATURE_NOT_READY',
  ],
);
assert.equal(
  formatAutoCutCommercialReleaseReadinessMessage(blockedReport),
  'blocked - autocut commercial release readiness blockers=4',
);

const readyRoot = tempRoot('autocut-commercial-release-ready');
writeEvidence(readyRoot, {
  readiness: {
    ffmpegExecutionReady: true,
    ffmpegBundledReady: true,
    releaseSmokeReady: true,
    nativeReleaseSmokeReady: true,
    nativeVideoSliceSmokeReady: true,
    smartSliceMediaArtifactsReady: true,
    installerSignatureReady: true,
  },
  preflight: {
    sidecarPresent: true,
    integrityReady: true,
    bundledReady: true,
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
const readyReport = createAutoCutCommercialReleaseReadinessReport({ rootDir: readyRoot });

assert.equal(readyReport.commercialReleaseReady, true);
assert.equal(readyReport.blockers.length, 0);
assert.equal(
  formatAutoCutCommercialReleaseReadinessMessage(readyReport),
  'ok - autocut commercial release readiness',
);

const unsignedInstallerOnlyRoot = tempRoot('autocut-commercial-release-unsigned-installer-only');
writeEvidence(unsignedInstallerOnlyRoot, {
  readiness: {
    ffmpegExecutionReady: false,
    ffmpegBundledReady: true,
    releaseSmokeReady: true,
    nativeReleaseSmokeReady: true,
    nativeVideoSliceSmokeReady: true,
    installerSignatureReady: false,
  },
  preflight: {
    sidecarPresent: true,
    integrityReady: true,
    bundledReady: true,
    executableSmokeReady: true,
    releaseSmokeReady: true,
    ffmpegExecutionReady: true,
  },
  nativeReleaseSmoke: {
    ready: true,
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
  },
});
const unsignedInstallerOnlyReport = createAutoCutCommercialReleaseReadinessReport({
  rootDir: unsignedInstallerOnlyRoot,
});

assert.deepEqual(
  unsignedInstallerOnlyReport.blockers.map((blocker) => blocker.code),
  ['INSTALLER_SIGNATURE_NOT_READY'],
);

const blockedSmartSliceRoot = tempRoot('autocut-commercial-release-smart-slice-blocked');
writeEvidence(blockedSmartSliceRoot, {
  readiness: {
    ffmpegExecutionReady: true,
    ffmpegBundledReady: true,
    releaseSmokeReady: true,
    nativeReleaseSmokeReady: true,
    nativeVideoSliceSmokeReady: true,
    smartSliceQualityReady: false,
    installerSignatureReady: true,
  },
  preflight: {
    sidecarPresent: true,
    integrityReady: true,
    bundledReady: true,
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
  smartSliceQuality: {
    ready: false,
    evidence: {
      readiness: {
        smartSliceQualityReady: false,
      },
      blockers: [
        {
          code: 'SMART_SLICE_TRANSCRIPT_CONTINUITY_TOO_LOW',
        },
      ],
    },
  },
});
const blockedSmartSliceReport = createAutoCutCommercialReleaseReadinessReport({
  rootDir: blockedSmartSliceRoot,
});

assert.deepEqual(
  blockedSmartSliceReport.blockers.map((blocker) => blocker.code),
  ['SMART_SLICE_QUALITY_NOT_READY'],
);

const blockedSmartSliceMediaRoot = tempRoot('autocut-commercial-release-smart-slice-media-blocked');
writeEvidence(blockedSmartSliceMediaRoot, {
  readiness: {
    ffmpegExecutionReady: true,
    ffmpegBundledReady: true,
    releaseSmokeReady: true,
    nativeReleaseSmokeReady: true,
    nativeVideoSliceSmokeReady: true,
    smartSliceQualityReady: true,
    smartSliceMediaArtifactsReady: false,
    installerSignatureReady: true,
  },
  preflight: {
    sidecarPresent: true,
    integrityReady: true,
    bundledReady: true,
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
  smartSliceMediaArtifacts: {
    ready: false,
    evidence: {
      readiness: {
        smartSliceMediaArtifactsReady: false,
      },
      blockers: [
        {
          code: 'SMART_SLICE_MEDIA_ARTIFACT_MISSING',
        },
      ],
    },
  },
});
const blockedSmartSliceMediaReport = createAutoCutCommercialReleaseReadinessReport({
  rootDir: blockedSmartSliceMediaRoot,
});

assert.deepEqual(
  blockedSmartSliceMediaReport.blockers.map((blocker) => blocker.code),
  ['SMART_SLICE_MEDIA_ARTIFACTS_NOT_READY'],
);

const blockedNativeVideoSliceRoot = tempRoot('autocut-commercial-release-native-video-slice-blocked');
writeEvidence(blockedNativeVideoSliceRoot, {
  readiness: {
    ffmpegExecutionReady: true,
    ffmpegBundledReady: true,
    releaseSmokeReady: true,
    nativeReleaseSmokeReady: true,
    nativeVideoSliceSmokeReady: false,
    smartSliceQualityReady: true,
    smartSliceMediaArtifactsReady: true,
    installerSignatureReady: true,
  },
  preflight: {
    sidecarPresent: true,
    integrityReady: true,
    bundledReady: true,
    executableSmokeReady: true,
    releaseSmokeReady: true,
    ffmpegExecutionReady: true,
  },
  nativeReleaseSmoke: {
    ready: true,
    videoSliceReady: false,
  },
  installerSignature: {
    ready: true,
    evidence: {
      blockers: [],
    },
  },
});
const blockedNativeVideoSliceReport = createAutoCutCommercialReleaseReadinessReport({
  rootDir: blockedNativeVideoSliceRoot,
});

assert.deepEqual(
  blockedNativeVideoSliceReport.blockers.map((blocker) => blocker.code),
  ['NATIVE_VIDEO_SLICE_SMOKE_NOT_READY'],
);

console.log('ok - autocut commercial release readiness contract');
