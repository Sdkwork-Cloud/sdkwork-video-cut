#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createAutoCutCommercialReleaseReadinessReport,
  formatAutoCutCommercialReleaseReadinessMessage,
} from './check-autocut-commercial-release-readiness.mjs';

const requiredPlatforms = ['windows-x86_64', 'linux-x86_64', 'macos-x86_64', 'macos-aarch64'];

function tempRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

function writeEvidence(root, overrides = {}, {
  platform = 'windows-x86_64',
  fileName = 'autocut-release-evidence.json',
} = {}) {
  const releasePath = path.join(root, 'artifacts', 'release', fileName);
  fs.mkdirSync(path.dirname(releasePath), { recursive: true });
  const evidence = {
    schemaVersion: overrides.schemaVersion ?? '2026-05-05.autocut-release-evidence.v1',
    generatedAt: '2026-05-05T00:00:00.000Z',
    platform,
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
    installers: overrides.installers ?? installersForPlatform(platform),
  };
  fs.writeFileSync(releasePath, JSON.stringify(evidence, null, 2));
  return releasePath;
}

function writePlatformEvidence(root, platform, overrides = {}, options = {}) {
  return writeEvidence(root, overrides, {
    platform: options.platform ?? platform,
    fileName: options.fileName ?? `autocut-release-evidence-${platform}.json`,
  });
}

function installersForPlatform(platform) {
  const sha256 = {
    'windows-x86_64': ['0'.repeat(64), '1'.repeat(64)],
    'linux-x86_64': ['2'.repeat(64), '3'.repeat(64)],
    'macos-x86_64': ['4'.repeat(64), '5'.repeat(64)],
    'macos-aarch64': ['6'.repeat(64), '7'.repeat(64)],
  }[platform];
  if (platform === 'windows-x86_64') {
    return [
      {
        kind: 'msi',
        path: 'packages/sdkwork-autocut-desktop/src-tauri/target/release/bundle/msi/SDKWork Video Cut_0.1.0_x64_en-US.msi',
        byteSize: 10,
        sha256: sha256[0],
      },
      {
        kind: 'nsis',
        path: 'packages/sdkwork-autocut-desktop/src-tauri/target/release/bundle/nsis/SDKWork Video Cut_0.1.0_x64-setup.exe',
        byteSize: 10,
        sha256: sha256[1],
      },
    ];
  }
  if (platform === 'linux-x86_64') {
    return [
      { kind: 'deb', path: 'release/SDKWork.Video.Cut_0.1.0_amd64.deb', byteSize: 12, sha256: sha256[0] },
      { kind: 'appimage', path: 'release/SDKWork.Video.Cut_0.1.0_amd64.AppImage', byteSize: 13, sha256: sha256[1] },
    ];
  }
  return [
    { kind: 'dmg', path: `release/SDKWork.Video.Cut_0.1.0_${platform}.dmg`, byteSize: 14, sha256: sha256[0] },
    { kind: 'app', path: `release/SDKWork.Video.Cut_0.1.0_${platform}.app.tar.gz`, byteSize: 15, sha256: sha256[1] },
  ];
}

function signedReadyEvidence(overrides = {}) {
  return {
    ...overrides,
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
      ...overrides.readiness,
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
      ready: true,
      evidence: {
        blockers: [],
      },
      ...overrides.installerSignature,
    },
  };
}

const blockedRoot = tempRoot('autocut-commercial-release-blocked');
const blockedEvidencePath = writeEvidence(blockedRoot);
const blockedReport = createAutoCutCommercialReleaseReadinessReport({
  rootDir: blockedRoot,
  evidencePath: blockedEvidencePath,
});

assert.equal(blockedReport.schemaVersion, '2026-05-06.autocut-commercial-release-readiness.v2');
assert.equal(blockedReport.mode, 'single');
assert.equal(blockedReport.commercialReleaseReady, false);
assert.deepEqual(
  blockedReport.blockers.map((blocker) => blocker.code),
  [
    'FFMPEG_SIDECAR_NOT_BUNDLED',
    'SPEECH_SIDECAR_NOT_BUNDLED',
    'FFMPEG_EXECUTABLE_SMOKE_NOT_VERIFIED',
    'FFMPEG_EXECUTION_NOT_READY',
    'INSTALLER_SIGNATURE_NOT_READY',
  ],
);
assert.equal(
  formatAutoCutCommercialReleaseReadinessMessage(blockedReport),
  'blocked - autocut commercial release readiness platform=windows-x86_64 blockers=5',
);

const readyRoot = tempRoot('autocut-commercial-release-ready');
const readyEvidencePath = writeEvidence(readyRoot, signedReadyEvidence());
const readyReport = createAutoCutCommercialReleaseReadinessReport({
  rootDir: readyRoot,
  evidencePath: readyEvidencePath,
});

assert.equal(readyReport.commercialReleaseReady, true);
assert.equal(readyReport.blockers.length, 0);
assert.equal(
  formatAutoCutCommercialReleaseReadinessMessage(readyReport),
  'ok - autocut commercial release readiness platform=windows-x86_64',
);

const unsignedInstallerOnlyRoot = tempRoot('autocut-commercial-release-unsigned-installer-only');
const unsignedInstallerOnlyEvidencePath = writeEvidence(unsignedInstallerOnlyRoot, {
  readiness: {
    ffmpegExecutionReady: false,
    ffmpegBundledReady: true,
    speechBundledReady: true,
    releaseSmokeReady: true,
    nativeReleaseSmokeReady: true,
    nativeVideoSliceSmokeReady: true,
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
  evidencePath: unsignedInstallerOnlyEvidencePath,
});

assert.deepEqual(
  unsignedInstallerOnlyReport.blockers.map((blocker) => blocker.code),
  ['INSTALLER_SIGNATURE_NOT_READY'],
);

const blockedSmartSliceRoot = tempRoot('autocut-commercial-release-smart-slice-blocked');
const blockedSmartSliceEvidencePath = writeEvidence(blockedSmartSliceRoot, {
  readiness: {
    ffmpegExecutionReady: true,
    ffmpegBundledReady: true,
    speechBundledReady: true,
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
  evidencePath: blockedSmartSliceEvidencePath,
});

assert.deepEqual(
  blockedSmartSliceReport.blockers.map((blocker) => blocker.code),
  ['SMART_SLICE_QUALITY_NOT_READY'],
);

const blockedSmartSliceMediaRoot = tempRoot('autocut-commercial-release-smart-slice-media-blocked');
const blockedSmartSliceMediaEvidencePath = writeEvidence(blockedSmartSliceMediaRoot, {
  readiness: {
    ffmpegExecutionReady: true,
    ffmpegBundledReady: true,
    speechBundledReady: true,
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
  evidencePath: blockedSmartSliceMediaEvidencePath,
});

assert.deepEqual(
  blockedSmartSliceMediaReport.blockers.map((blocker) => blocker.code),
  ['SMART_SLICE_MEDIA_ARTIFACTS_NOT_READY'],
);

const blockedNativeVideoSliceRoot = tempRoot('autocut-commercial-release-native-video-slice-blocked');
const blockedNativeVideoSliceEvidencePath = writeEvidence(blockedNativeVideoSliceRoot, {
  readiness: {
    ffmpegExecutionReady: true,
    ffmpegBundledReady: true,
    speechBundledReady: true,
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
    speechSidecar: {
      sidecarPresent: true,
      integrityReady: true,
      bundledReady: true,
    },
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
  evidencePath: blockedNativeVideoSliceEvidencePath,
});

assert.deepEqual(
  blockedNativeVideoSliceReport.blockers.map((blocker) => blocker.code),
  ['NATIVE_VIDEO_SLICE_SMOKE_NOT_READY'],
);

const blockedInstallerArtifactsRoot = tempRoot('autocut-commercial-release-installer-artifacts-blocked');
const blockedInstallerArtifactsEvidencePath = writeEvidence(
  blockedInstallerArtifactsRoot,
  signedReadyEvidence({
    installers: [
      {
        kind: 'msi',
        path: 'release/SDKWork.Video.Cut_0.1.1_x64_en-US.msi',
        byteSize: 0,
        sha256: 'not-a-real-sha256',
      },
    ],
  }),
);
const blockedInstallerArtifactsReport = createAutoCutCommercialReleaseReadinessReport({
  rootDir: blockedInstallerArtifactsRoot,
  evidencePath: blockedInstallerArtifactsEvidencePath,
});

assert.deepEqual(
  blockedInstallerArtifactsReport.blockers.map((blocker) => blocker.code),
  ['INSTALLER_ARTIFACTS_NOT_READY'],
);

const blockedSpeechRoot = tempRoot('autocut-commercial-release-speech-blocked');
const blockedSpeechEvidencePath = writeEvidence(blockedSpeechRoot, signedReadyEvidence({
  readiness: {
    speechBundledReady: false,
  },
  preflight: {
    speechSidecar: {
      sidecarPresent: false,
      integrityReady: false,
      bundledReady: false,
    },
  },
}));
const blockedSpeechReport = createAutoCutCommercialReleaseReadinessReport({
  rootDir: blockedSpeechRoot,
  evidencePath: blockedSpeechEvidencePath,
});

assert.deepEqual(
  blockedSpeechReport.blockers.map((blocker) => blocker.code),
  ['SPEECH_SIDECAR_NOT_BUNDLED'],
);

const aggregateReadyRoot = tempRoot('autocut-commercial-release-aggregate-ready');
for (const platform of requiredPlatforms) {
  writePlatformEvidence(aggregateReadyRoot, platform, signedReadyEvidence());
}
const aggregateReadyReport = createAutoCutCommercialReleaseReadinessReport({
  rootDir: aggregateReadyRoot,
});

assert.equal(aggregateReadyReport.mode, 'aggregate');
assert.equal(aggregateReadyReport.commercialReleaseReady, true);
assert.deepEqual(
  aggregateReadyReport.requiredPlatforms.map((platform) => platform.platform),
  requiredPlatforms,
);
assert.equal(aggregateReadyReport.summary.readyPlatforms, 4);
assert.equal(aggregateReadyReport.summary.blockerCount, 0);
assert.equal(
  formatAutoCutCommercialReleaseReadinessMessage(aggregateReadyReport),
  'ok - autocut commercial release readiness platforms=4 blockers=0',
);

const aggregateMissingRoot = tempRoot('autocut-commercial-release-aggregate-missing');
writePlatformEvidence(aggregateMissingRoot, 'windows-x86_64', signedReadyEvidence());
const aggregateMissingReport = createAutoCutCommercialReleaseReadinessReport({
  rootDir: aggregateMissingRoot,
});

assert.equal(aggregateMissingReport.commercialReleaseReady, false);
assert.deepEqual(
  aggregateMissingReport.blockers.map((blocker) => `${blocker.platform}:${blocker.code}`),
  [
    'linux-x86_64:PLATFORM_RELEASE_EVIDENCE_MISSING',
    'macos-x86_64:PLATFORM_RELEASE_EVIDENCE_MISSING',
    'macos-aarch64:PLATFORM_RELEASE_EVIDENCE_MISSING',
  ],
);
assert.equal(
  formatAutoCutCommercialReleaseReadinessMessage(aggregateMissingReport),
  'blocked - autocut commercial release readiness platforms=1/4 blockers=3',
);

const aggregatePlatformBlockedRoot = tempRoot('autocut-commercial-release-aggregate-platform-blocked');
for (const platform of requiredPlatforms) {
  writePlatformEvidence(
    aggregatePlatformBlockedRoot,
    platform,
    signedReadyEvidence(
      platform === 'macos-aarch64'
        ? {
            readiness: {
              ffmpegExecutionReady: false,
              installerSignatureReady: false,
            },
            installerSignature: {
              ready: false,
              evidence: {
                blockers: [
                  {
                    code: 'MACOS_NOTARIZATION_MISSING',
                    message: 'notarization missing',
                  },
                ],
              },
            },
          }
        : {},
    ),
  );
}
const aggregatePlatformBlockedReport = createAutoCutCommercialReleaseReadinessReport({
  rootDir: aggregatePlatformBlockedRoot,
});

assert.equal(aggregatePlatformBlockedReport.commercialReleaseReady, false);
assert.deepEqual(
  aggregatePlatformBlockedReport.blockers.map((blocker) => `${blocker.platform}:${blocker.code}`),
  ['macos-aarch64:INSTALLER_SIGNATURE_NOT_READY'],
);

const aggregateMalformedRoot = tempRoot('autocut-commercial-release-aggregate-malformed');
for (const platform of requiredPlatforms) {
  writePlatformEvidence(aggregateMalformedRoot, platform, signedReadyEvidence());
}
writePlatformEvidence(aggregateMalformedRoot, 'linux-x86_64', {
  schemaVersion: '2026-01-01.bad-schema',
});
writePlatformEvidence(aggregateMalformedRoot, 'macos-x86_64', signedReadyEvidence(), {
  platform: 'windows-x86_64',
  fileName: 'autocut-release-evidence-macos-x86_64.json',
});
const aggregateMalformedReport = createAutoCutCommercialReleaseReadinessReport({
  rootDir: aggregateMalformedRoot,
});

assert.equal(aggregateMalformedReport.commercialReleaseReady, false);
assert.deepEqual(
  aggregateMalformedReport.blockers.map((blocker) => `${blocker.platform}:${blocker.code}`),
  [
    'linux-x86_64:PLATFORM_RELEASE_EVIDENCE_INVALID',
    'macos-x86_64:PLATFORM_RELEASE_EVIDENCE_MISMATCH',
  ],
);
assert.match(
  aggregateMalformedReport.blockers.find((blocker) => blocker.platform === 'linux-x86_64')?.message ?? '',
  /unsupported AutoCut release evidence schema/u,
);

console.log('ok - autocut commercial release readiness contract');
