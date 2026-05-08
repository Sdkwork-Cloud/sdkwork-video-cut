#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createAutoCutReleaseEvidenceStatusReport,
  formatAutoCutReleaseEvidenceStatusMessage,
} from './check-autocut-release-evidence-status.mjs';

const requiredPlatforms = ['windows-x86_64', 'linux-x86_64', 'macos-x86_64', 'macos-aarch64'];

function tempRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function writeManifest(root) {
  writeJson(path.join(root, 'sdkwork.app.config.json'), {
    schemaVersion: 3,
    kind: 'sdkwork.app',
    publish: {
      status: 'INACTIVE',
    },
    security: {
      checksumRequired: true,
      signatureRequired: true,
      sbomRequired: true,
    },
    release: {
      notes: [
        {
          version: '0.1.1',
          current: true,
          metadata: {
            previewRelease: true,
          },
        },
      ],
    },
    artifacts: {
      installConfig: {
        packages: [
          disabledPackage('desktop-windows-msi', 'DESKTOP_WINDOWS', 'MSI'),
          disabledPackage('desktop-windows-nsis', 'DESKTOP_WINDOWS', 'NSIS'),
          disabledPackage('desktop-linux-deb', 'DESKTOP_LINUX', 'DEB'),
          disabledPackage('desktop-linux-appimage', 'DESKTOP_LINUX', 'APPIMAGE'),
          disabledPackage('desktop-macos-x64-dmg', 'DESKTOP_MACOS', 'DMG'),
          disabledPackage('desktop-macos-aarch64-dmg', 'DESKTOP_MACOS', 'DMG'),
        ],
      },
    },
  });
}

function disabledPackage(id, platform, packageFormat) {
  return {
    id,
    platform,
    packageFormat,
    enabled: false,
    metadata: {
      releaseAsset: true,
      commercialActivationRequired: 'real signed release evidence required before activation',
    },
  };
}

function readyReleaseEvidence(platform) {
  return {
    schemaVersion: '2026-05-05.autocut-release-evidence.v1',
    generatedAt: '2026-05-08T00:00:00.000Z',
    platform,
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
        platform,
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
      videoSliceReady: true,
    },
    smartSliceQuality: {
      ready: true,
      evidence: {
        blockers: [],
      },
    },
    smartSliceMediaArtifacts: {
      ready: true,
      evidence: {
        blockers: [],
      },
    },
    installerSignature: {
      path: `artifacts/release/autocut-installer-signature-evidence-${platform}.json`,
      ready: true,
      evidence: {
        blockers: [],
        installers: installersForPlatform(platform).map((installer) => ({
          kind: installer.kind,
          signatureReady: true,
          signatureStatus: platform.startsWith('macos-') ? 'valid' : 'verified',
          notarizationStatus: platform.startsWith('macos-') ? 'notarized' : '',
          signer: 'SDKWork Release Test',
          diagnostics: [],
        })),
      },
    },
    installers: installersForPlatform(platform),
  };
}

function installersForPlatform(platform) {
  const sha256 = {
    'windows-x86_64': ['a'.repeat(64), 'b'.repeat(64)],
    'linux-x86_64': ['c'.repeat(64), 'd'.repeat(64)],
    'macos-x86_64': ['e'.repeat(64), '1'.repeat(64)],
    'macos-aarch64': ['2'.repeat(64), '3'.repeat(64)],
  }[platform];
  if (platform === 'windows-x86_64') {
    return [
      { kind: 'msi', path: 'release/SDKWork.Video.Cut_0.1.1_x64_en-US.msi', byteSize: 10, sha256: sha256[0] },
      { kind: 'nsis', path: 'release/SDKWork.Video.Cut_0.1.1_x64-setup.exe', byteSize: 11, sha256: sha256[1] },
    ];
  }
  if (platform === 'linux-x86_64') {
    return [
      { kind: 'deb', path: 'release/SDKWork.Video.Cut_0.1.1_amd64.deb', byteSize: 12, sha256: sha256[0] },
      { kind: 'appimage', path: 'release/SDKWork.Video.Cut_0.1.1_amd64.AppImage', byteSize: 13, sha256: sha256[1] },
    ];
  }
  return [
    { kind: 'dmg', path: `release/SDKWork.Video.Cut_0.1.1_${platform}.dmg`, byteSize: 14, sha256: sha256[0] },
    { kind: 'app', path: `release/SDKWork.Video.Cut_0.1.1_${platform}.app.tar.gz`, byteSize: 15, sha256: sha256[1] },
  ];
}

function writeSbomEvidence(root, overrides = {}) {
  const packages = [
    ['desktop-windows-msi', 'CycloneDX', 'desktop-windows-msi.cdx.json', '4'.repeat(64)],
    ['desktop-windows-nsis', 'CycloneDX', 'desktop-windows-nsis.cdx.json', '5'.repeat(64)],
    ['desktop-linux-deb', 'CycloneDX', 'desktop-linux-deb.cdx.json', '6'.repeat(64)],
    ['desktop-linux-appimage', 'CycloneDX', 'desktop-linux-appimage.cdx.json', '7'.repeat(64)],
    ['desktop-macos-x64-dmg', 'CycloneDX', 'desktop-macos-x64-dmg.cdx.json', '8'.repeat(64)],
    ['desktop-macos-aarch64-dmg', 'CycloneDX', 'desktop-macos-aarch64-dmg.cdx.json', '9'.repeat(64)],
  ].map(([packageId, format, fileName, sha256]) => ({
    packageId,
    format,
    path: `artifacts/release/sbom/${fileName}`,
    url: `https://github.com/Sdkwork-Cloud/sdkwork-video-cut/releases/download/v0.1.1/${fileName}`,
    byteSize: 100,
    sha256,
  }));
  writeJson(path.join(root, 'artifacts', 'release', 'autocut-sbom-evidence.json'), {
    schemaVersion: '2026-05-08.autocut-sbom-evidence.v1',
    generatedAt: '2026-05-08T00:00:00.000Z',
    releaseTag: 'v0.1.1',
    readiness: {
      sbomReady: true,
      ...overrides.readiness,
    },
    summary: {
      packageCount: 6,
      readyPackageCount: packages.length,
      blockerCount: 0,
      ...overrides.summary,
    },
    packages: overrides.packages ?? packages,
    blockers: overrides.blockers ?? [],
  });
}

function readyEnvironmentReport() {
  return {
    schemaVersion: '2026-05-08.autocut-release-environment.v1',
    releaseTag: 'v0.1.1',
    repository: 'Sdkwork-Cloud/sdkwork-video-cut',
    ready: true,
    checks: {},
    blockers: [],
  };
}

const readyRoot = tempRoot('autocut-release-evidence-status-ready');
writeManifest(readyRoot);
for (const platform of requiredPlatforms) {
  writeJson(
    path.join(readyRoot, 'artifacts', 'release', `autocut-release-evidence-${platform}.json`),
    readyReleaseEvidence(platform),
  );
}
writeSbomEvidence(readyRoot);

const readyReport = createAutoCutReleaseEvidenceStatusReport({
  rootDir: readyRoot,
  releaseTag: 'v0.1.1',
  releaseEnvironmentReport: readyEnvironmentReport(),
  generatedAt: '2026-05-08T00:00:00.000Z',
});

assert.equal(readyReport.schemaVersion, '2026-05-08.autocut-release-evidence-status.v1');
assert.equal(readyReport.releaseTag, 'v0.1.1');
assert.equal(readyReport.releaseEvidenceStatusReady, true);
assert.equal(readyReport.summary.readyDomainCount, 7);
assert.equal(readyReport.summary.domainCount, 7);
assert.equal(readyReport.summary.blockerCount, 0);
assert.deepEqual(
  readyReport.domains.map((domain) => `${domain.id}:${domain.ready}`),
  [
    'release-environment:true',
    'platform-release-evidence:true',
    'sbom-evidence:true',
    'app-manifest-sync:true',
    'app-manifest-readiness:true',
    'multiplatform-preview-readiness:true',
    'commercial-release-readiness:true',
  ],
);
assert.equal(
  formatAutoCutReleaseEvidenceStatusMessage(readyReport),
  'ok - autocut release evidence status domains=7/7 blockers=0 releaseTag=v0.1.1',
);

const blockedRoot = tempRoot('autocut-release-evidence-status-blocked');
writeManifest(blockedRoot);
writeJson(
  path.join(blockedRoot, 'artifacts', 'release', 'autocut-release-evidence-windows-x86_64.json'),
  readyReleaseEvidence('windows-x86_64'),
);
writeSbomEvidence(blockedRoot, {
  readiness: {
    sbomReady: false,
  },
  summary: {
    readyPackageCount: 5,
    blockerCount: 1,
  },
  blockers: [
    {
      packageId: 'desktop-linux-deb',
      code: 'PACKAGE_SBOM_MISSING',
      message: 'Missing SBOM file for desktop-linux-deb.',
    },
  ],
});

const blockedReport = createAutoCutReleaseEvidenceStatusReport({
  rootDir: blockedRoot,
  releaseTag: 'v0.1.1',
  releaseEnvironmentReport: {
    ...readyEnvironmentReport(),
    ready: false,
    blockers: [
      {
        code: 'GIT_METADATA_NOT_WRITABLE',
        check: 'gitMetadataWritable',
        diagnostic: 'access denied',
        remediation: 'run release from writable git metadata',
      },
    ],
  },
  generatedAt: '2026-05-08T00:00:00.000Z',
});

assert.equal(blockedReport.releaseEvidenceStatusReady, false);
assert.equal(blockedReport.summary.readyDomainCount, 1);
assert.equal(blockedReport.summary.domainCount, 7);
assert.ok(blockedReport.summary.blockerCount >= 6);
assert.deepEqual(
  blockedReport.domains.map((domain) => `${domain.id}:${domain.ready}`),
  [
    'release-environment:false',
    'platform-release-evidence:false',
    'sbom-evidence:false',
    'app-manifest-sync:false',
    'app-manifest-readiness:true',
    'multiplatform-preview-readiness:false',
    'commercial-release-readiness:false',
  ],
);
assert.ok(
  blockedReport.blockers.some(
    (blocker) =>
      blocker.domain === 'release-environment' &&
      blocker.code === 'GIT_METADATA_NOT_WRITABLE' &&
      blocker.message === 'access denied',
  ),
);
assert.ok(
  blockedReport.blockers.some(
    (blocker) =>
      blocker.domain === 'sbom-evidence' &&
      blocker.packageId === 'desktop-linux-deb' &&
      blocker.code === 'PACKAGE_SBOM_MISSING',
  ),
);
assert.ok(
  blockedReport.blockers.some(
    (blocker) =>
      blocker.domain === 'platform-release-evidence' &&
      blocker.platform === 'linux-x86_64' &&
      blocker.code === 'PLATFORM_RELEASE_EVIDENCE_MISSING',
  ),
);
assert.ok(
  blockedReport.nextActions.some(
    (action) =>
      action.domain === 'release-environment' &&
      action.command.includes('pnpm release:environment -- --release-tag v0.1.1 --json'),
  ),
);
assert.ok(
  blockedReport.nextActions.some(
    (action) =>
      action.domain === 'app-manifest-sync' &&
      action.command === 'pnpm release:sync-app-manifest -- --dry-run --allow-blocked',
  ),
);
assert.equal(
  formatAutoCutReleaseEvidenceStatusMessage(blockedReport),
  `blocked - autocut release evidence status domains=1/7 blockers=${blockedReport.summary.blockerCount} releaseTag=v0.1.1`,
);

console.log('ok - autocut release evidence status contract');
