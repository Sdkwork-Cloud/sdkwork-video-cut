#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createAutoCutMultiplatformReleaseReadinessReport,
  formatAutoCutMultiplatformReleaseReadinessMessage,
} from './check-autocut-multiplatform-release-readiness.mjs';

const requiredPlatforms = ['windows-x86_64', 'linux-x86_64', 'macos-x86_64', 'macos-aarch64'];

function tempRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

function writePlatformEvidence(root, platform, overrides = {}) {
  const evidencePath = path.join(root, 'artifacts', 'release', `autocut-release-evidence-${platform}.json`);
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  const evidence = {
    schemaVersion: '2026-05-05.autocut-release-evidence.v1',
    generatedAt: '2026-05-06T00:00:00.000Z',
    platform,
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
      ...overrides.smartSliceQuality,
    },
    smartSliceMediaArtifacts: {
      ready: true,
      ...overrides.smartSliceMediaArtifacts,
    },
    installerSignature: {
      ready: false,
      ...overrides.installerSignature,
    },
    installers: overrides.installers ?? installersForPlatform(platform),
  };
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  return evidencePath;
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
      { kind: 'msi', path: 'release/SDKWork.Video.Cut_0.1.0_x64_en-US.msi', byteSize: 10, sha256: sha256[0] },
      { kind: 'nsis', path: 'release/SDKWork.Video.Cut_0.1.0_x64-setup.exe', byteSize: 11, sha256: sha256[1] },
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

const root = tempRoot('autocut-multiplatform-release-ready');
for (const platform of requiredPlatforms) {
  writePlatformEvidence(root, platform);
}

const readyReport = createAutoCutMultiplatformReleaseReadinessReport({ rootDir: root });

assert.equal(readyReport.schemaVersion, '2026-05-06.autocut-multiplatform-release-readiness.v1');
assert.equal(readyReport.multiplatformReleaseReady, true);
assert.deepEqual(
  readyReport.requiredPlatforms.map((platform) => platform.platform),
  requiredPlatforms,
);
assert.equal(readyReport.summary.readyPlatforms, 4);
assert.equal(readyReport.summary.totalInstallers, 8);
assert.deepEqual(readyReport.blockers, []);
assert.deepEqual(
  readyReport.warnings.map((warning) => warning.code),
  [
    'UNSIGNED_INSTALLERS_ACCEPTED_FOR_PREVIEW',
    'UNSIGNED_INSTALLERS_ACCEPTED_FOR_PREVIEW',
    'UNSIGNED_MACOS_INSTALLERS_ACCEPTED_FOR_PREVIEW',
    'UNSIGNED_MACOS_INSTALLERS_ACCEPTED_FOR_PREVIEW',
  ],
);
assert.equal(
  formatAutoCutMultiplatformReleaseReadinessMessage(readyReport),
  'ok - autocut multiplatform release readiness platforms=4 installers=8 warnings=4',
);

const aliasReport = createAutoCutMultiplatformReleaseReadinessReport({
  rootDir: root,
  platforms: ['windows-x64', 'ubuntu-x64', 'darwin-arm64'],
});
assert.deepEqual(
  aliasReport.requiredPlatforms.map((platform) => platform.platform),
  ['windows-x86_64', 'linux-x86_64', 'macos-aarch64'],
);
assert.equal(aliasReport.multiplatformReleaseReady, true);

const missingRoot = tempRoot('autocut-multiplatform-release-missing');
writePlatformEvidence(missingRoot, 'windows-x86_64');
const missingReport = createAutoCutMultiplatformReleaseReadinessReport({ rootDir: missingRoot });

assert.equal(missingReport.multiplatformReleaseReady, false);
assert.deepEqual(
  missingReport.blockers.map((blocker) => blocker.code),
  [
    'PLATFORM_RELEASE_EVIDENCE_MISSING',
    'PLATFORM_RELEASE_EVIDENCE_MISSING',
    'PLATFORM_RELEASE_EVIDENCE_MISSING',
  ],
);

const blockedRoot = tempRoot('autocut-multiplatform-release-blocked');
for (const platform of requiredPlatforms) {
  writePlatformEvidence(
    blockedRoot,
    platform,
    platform === 'linux-x86_64'
      ? {
          readiness: { smartSliceQualityReady: false },
          smartSliceQuality: { ready: false },
        }
      : {},
  );
}
const blockedReport = createAutoCutMultiplatformReleaseReadinessReport({ rootDir: blockedRoot });

assert.equal(blockedReport.multiplatformReleaseReady, false);
assert.deepEqual(
  blockedReport.blockers.map((blocker) => `${blocker.platform}:${blocker.code}`),
  ['linux-x86_64:SMART_SLICE_QUALITY_NOT_READY'],
);

const blockedSpeechRoot = tempRoot('autocut-multiplatform-release-speech-blocked');
for (const platform of requiredPlatforms) {
  writePlatformEvidence(
    blockedSpeechRoot,
    platform,
    platform === 'macos-aarch64'
      ? {
          readiness: { speechBundledReady: false },
          preflight: {
            speechSidecar: {
              sidecarPresent: false,
              integrityReady: false,
              bundledReady: false,
            },
          },
        }
      : {},
  );
}
const blockedSpeechReport = createAutoCutMultiplatformReleaseReadinessReport({ rootDir: blockedSpeechRoot });

assert.equal(blockedSpeechReport.multiplatformReleaseReady, false);
assert.deepEqual(
  blockedSpeechReport.blockers.map((blocker) => `${blocker.platform}:${blocker.code}`),
  ['macos-aarch64:SPEECH_SIDECAR_NOT_BUNDLED'],
);

console.log('ok - autocut multiplatform release readiness contract');
