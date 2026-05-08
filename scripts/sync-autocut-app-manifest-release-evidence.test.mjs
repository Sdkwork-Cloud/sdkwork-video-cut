#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  syncAutoCutAppManifestReleaseEvidence,
  formatAutoCutAppManifestReleaseEvidenceSyncMessage,
} from './sync-autocut-app-manifest-release-evidence.mjs';
import {
  createAutoCutAppManifestReleaseReadinessReport,
} from './check-autocut-app-manifest-release-readiness.mjs';

const packageSpecs = [
  ['desktop-windows-msi', 'DESKTOP_WINDOWS', 'MSI', 'x64', 'windows-x86_64', 'msi', 'Valid', 'not-applicable'],
  ['desktop-windows-nsis', 'DESKTOP_WINDOWS', 'EXE', 'x64', 'windows-x86_64', 'nsis', 'Valid', 'not-applicable'],
  ['desktop-linux-deb', 'DESKTOP_LINUX', 'DEB', 'x64', 'linux-x86_64', 'deb', 'verified', 'not-applicable'],
  ['desktop-linux-appimage', 'DESKTOP_LINUX', 'APPIMAGE', 'x64', 'linux-x86_64', 'appimage', 'verified', 'not-applicable'],
  ['desktop-macos-x64-dmg', 'DESKTOP_MACOS', 'DMG', 'x64', 'macos-x86_64', 'dmg', 'valid', 'notarized'],
  ['desktop-macos-aarch64-dmg', 'DESKTOP_MACOS', 'DMG', 'aarch64', 'macos-aarch64', 'dmg', 'valid', 'notarized'],
];

function tempRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeManifest(root) {
  writeJson(path.join(root, 'sdkwork.app.config.json'), {
    schemaVersion: 3,
    kind: 'sdkwork.app',
    app: {
      key: 'sdkwork-video-cut',
      versionSource: 'package.json',
    },
    publish: {
      status: 'INACTIVE',
      defaultPackageId: 'desktop-windows-msi',
    },
    artifacts: {
      installConfig: {
        defaultPackageId: 'desktop-windows-msi',
        packages: packageSpecs.map(([id, platform, packageFormat, architecture]) => ({
          id,
          name: `SDKWork Video Cut ${id}`,
          sourceType: 'BINARY_URL',
          packageFormat,
          platform,
          url: `https://github.com/Sdkwork-Cloud/sdkwork-video-cut/releases/download/v0.1.1/${id}`,
          enabled: false,
          architecture,
          metadata: {
            releaseAsset: true,
            commercialActivationRequired:
              'Enable only after release asset digest, platform trust evidence, and SBOM evidence are recorded.',
          },
        })),
      },
    },
    release: {
      currentVersion: '0.1.1',
      latest: {
        STABLE: '0.1.1',
      },
      notes: [
        {
          version: '0.1.1',
          current: true,
          metadata: {
            previewRelease: true,
            commercialActivationRequired: ['SBOM evidence recorded'],
          },
        },
      ],
    },
    security: {
      checksumRequired: true,
      signatureRequired: true,
      sbomRequired: true,
    },
  });
}

function writeReleaseEvidenceSet(root, overrides = {}) {
  const specsByPlatform = new Map();
  for (const spec of packageSpecs) {
    const platform = spec[4];
    if (!specsByPlatform.has(platform)) {
      specsByPlatform.set(platform, []);
    }
    specsByPlatform.get(platform).push(spec);
  }

  for (const [platform, specs] of specsByPlatform.entries()) {
    const releaseEvidencePath = path.join(root, 'artifacts', 'release', `autocut-release-evidence-${platform}.json`);
    const platformHasSignatureBlocker = overrides.signatureReady === false &&
      specs.some(([packageId]) => packageId === overrides.signaturePackageId);
    const installers = specs.map(([packageId, , , , , kind], index) => ({
      kind,
      path: `release/${packageId}`,
      byteSize: 1024 + index,
      sha256: shaFor(packageId),
    }));
    const signatureInstallers = specs.map(([packageId, , , , , kind, signatureStatus, notarizationStatus], index) => ({
      kind,
      path: `release/${packageId}`,
      exists: true,
      byteSize: 1024 + index,
      sha256: shaFor(packageId),
      signatureReady: platformHasSignatureBlocker && packageId === overrides.signaturePackageId ? false : true,
      signatureStatus: overrides.signatureReady === false && packageId === overrides.signaturePackageId ? 'NotSigned' : signatureStatus,
      notarizationStatus,
      signer: 'CN=SDKWork',
      diagnostics: [],
    }));
    writeJson(releaseEvidencePath, {
      schemaVersion: '2026-05-05.autocut-release-evidence.v1',
      generatedAt: '2026-05-08T00:00:00.000Z',
      platform,
      readiness: {
        ffmpegExecutionReady: true,
        ffmpegBundledReady: true,
        releaseSmokeReady: true,
        nativeReleaseSmokeReady: true,
        nativeVideoSliceSmokeReady: true,
        smartSliceQualityReady: true,
        smartSliceMediaArtifactsReady: true,
        installerSignatureReady: platformHasSignatureBlocker ? false : true,
      },
      installerSignature: {
        path: `artifacts/release/autocut-installer-signature-evidence-${platform}.json`,
        ready: platformHasSignatureBlocker ? false : true,
        evidence: {
          schemaVersion: '2026-05-05.autocut-installer-signature-evidence.v1',
          platform,
          readiness: {
            installerSignatureReady: platformHasSignatureBlocker ? false : true,
          },
          installers: signatureInstallers,
          blockers: platformHasSignatureBlocker
            ? [{ code: 'INSTALLER_SIGNATURE_MISSING', installerKind: overrides.signatureKind ?? 'msi' }]
            : [],
        },
      },
      installers,
    });
  }
}

function writeSbomEvidence(root, overrides = {}) {
  writeJson(path.join(root, 'artifacts', 'release', 'autocut-sbom-evidence.json'), {
    schemaVersion: '2026-05-08.autocut-sbom-evidence.v1',
    generatedAt: '2026-05-08T00:00:00.000Z',
    readiness: {
      sbomReady: true,
    },
    packages: packageSpecs
      .filter(([packageId]) => packageId !== overrides.missingPackageId)
      .map(([packageId]) => ({
        packageId,
        format: packageId.includes('linux') ? 'SPDX' : 'CycloneDX',
        url: `https://github.com/Sdkwork-Cloud/sdkwork-video-cut/releases/download/v0.1.1/${packageId}.sbom.json`,
        sha256: sbomShaFor(packageId),
      })),
  });
}

function shaFor(value) {
  return Buffer.from(value.padEnd(32, '_')).toString('hex').slice(0, 64).padEnd(64, 'a');
}

function sbomShaFor(value) {
  return Buffer.from(`sbom-${value}`.padEnd(32, '_')).toString('hex').slice(0, 64).padEnd(64, 'b');
}

const dryRunRoot = tempRoot('autocut-manifest-sync-dry-run');
writeManifest(dryRunRoot);
writeReleaseEvidenceSet(dryRunRoot);
writeSbomEvidence(dryRunRoot);
const beforeDryRunManifest = fs.readFileSync(path.join(dryRunRoot, 'sdkwork.app.config.json'), 'utf8');
const dryRunResult = syncAutoCutAppManifestReleaseEvidence({
  rootDir: dryRunRoot,
  activateCommercial: true,
  dryRun: true,
});

assert.equal(dryRunResult.schemaVersion, '2026-05-08.autocut-app-manifest-release-evidence-sync.v1');
assert.equal(dryRunResult.commercialActivationReady, true);
assert.equal(dryRunResult.manifestWritten, false);
assert.equal(fs.readFileSync(path.join(dryRunRoot, 'sdkwork.app.config.json'), 'utf8'), beforeDryRunManifest);
assert.equal(
  formatAutoCutAppManifestReleaseEvidenceSyncMessage(dryRunResult),
  'ok - autocut app manifest release evidence sync packages=6 activateCommercial=true dryRun=true written=false blockers=0',
);

const missingEvidenceRoot = tempRoot('autocut-manifest-sync-missing-evidence');
writeManifest(missingEvidenceRoot);
const missingEvidenceResult = syncAutoCutAppManifestReleaseEvidence({
  rootDir: missingEvidenceRoot,
  dryRun: true,
});

assert.equal(missingEvidenceResult.commercialActivationReady, false);
assert.equal(missingEvidenceResult.manifestWritten, false);
assert.ok(missingEvidenceResult.blockers.some((blocker) => blocker.code === 'PLATFORM_RELEASE_EVIDENCE_MISSING'));
assert.ok(missingEvidenceResult.blockers.some((blocker) => blocker.code === 'SBOM_EVIDENCE_MISSING'));
assert.equal(
  missingEvidenceResult.blockers.filter((blocker) => blocker.code === 'PLATFORM_RELEASE_EVIDENCE_MISSING').length,
  4,
);
assert.equal(
  formatAutoCutAppManifestReleaseEvidenceSyncMessage(missingEvidenceResult),
  `blocked - autocut app manifest release evidence sync packages=6 activateCommercial=false dryRun=true written=false blockers=${missingEvidenceResult.blockers.length}`,
);

const activeRoot = tempRoot('autocut-manifest-sync-active');
writeManifest(activeRoot);
writeReleaseEvidenceSet(activeRoot);
writeSbomEvidence(activeRoot);
const activeResult = syncAutoCutAppManifestReleaseEvidence({
  rootDir: activeRoot,
  activateCommercial: true,
});
const activeManifest = readJson(path.join(activeRoot, 'sdkwork.app.config.json'));

assert.equal(activeResult.commercialActivationReady, true);
assert.equal(activeResult.manifestWritten, true);
assert.equal(activeManifest.publish.status, 'ACTIVE');
assert.equal(activeManifest.release.notes[0].metadata.previewRelease, false);
assert.equal(Object.hasOwn(activeManifest.release.notes[0].metadata, 'commercialActivationRequired'), false);
for (const appPackage of activeManifest.artifacts.installConfig.packages) {
  assert.equal(appPackage.enabled, true);
  assert.equal(appPackage.checksumAlgorithm, 'SHA-256');
  assert.match(appPackage.checksum, /^[a-f0-9]{64}$/u);
  assert.equal(typeof appPackage.sizeBytes, 'number');
  assert.equal(Object.hasOwn(appPackage.metadata, 'commercialActivationRequired'), false);
  assert.equal(appPackage.metadata.trustEvidence.status, 'verified');
  assert.equal(appPackage.metadata.trustEvidence.signed, true);
  assert.match(appPackage.metadata.sbom.sha256, /^[a-f0-9]{64}$/u);
}
assert.equal(
  createAutoCutAppManifestReleaseReadinessReport({ rootDir: activeRoot }).manifestReleaseReady,
  true,
);

const missingSbomRoot = tempRoot('autocut-manifest-sync-missing-sbom');
writeManifest(missingSbomRoot);
writeReleaseEvidenceSet(missingSbomRoot);
writeSbomEvidence(missingSbomRoot, { missingPackageId: 'desktop-linux-deb' });
const missingSbomResult = syncAutoCutAppManifestReleaseEvidence({
  rootDir: missingSbomRoot,
  activateCommercial: true,
});

assert.equal(missingSbomResult.commercialActivationReady, false);
assert.equal(missingSbomResult.manifestWritten, false);
assert.deepEqual(
  missingSbomResult.blockers.map((blocker) => `${blocker.packageId}:${blocker.code}`),
  ['desktop-linux-deb:PACKAGE_SBOM_EVIDENCE_MISSING'],
);
assert.equal(readJson(path.join(missingSbomRoot, 'sdkwork.app.config.json')).publish.status, 'INACTIVE');

const blockedSbomEvidenceRoot = tempRoot('autocut-manifest-sync-blocked-sbom-evidence');
writeManifest(blockedSbomEvidenceRoot);
writeReleaseEvidenceSet(blockedSbomEvidenceRoot);
writeJson(path.join(blockedSbomEvidenceRoot, 'artifacts', 'release', 'autocut-sbom-evidence.json'), {
  schemaVersion: '2026-05-08.autocut-sbom-evidence.v1',
  generatedAt: '2026-05-08T00:00:00.000Z',
  readiness: {
    sbomReady: false,
  },
  packages: packageSpecs.map(([packageId]) => ({
    packageId,
    format: 'CycloneDX',
    url: `https://github.com/Sdkwork-Cloud/sdkwork-video-cut/releases/download/v0.1.1/${packageId}.sbom.json`,
    sha256: sbomShaFor(packageId),
  })),
  blockers: [
    {
      code: 'PACKAGE_SBOM_UNKNOWN_PACKAGE_ID',
      packageId: 'desktop-web',
      message: 'Unknown SBOM package id must remain visible to manifest sync.',
    },
  ],
});
const blockedSbomEvidenceResult = syncAutoCutAppManifestReleaseEvidence({
  rootDir: blockedSbomEvidenceRoot,
  activateCommercial: true,
});

assert.equal(blockedSbomEvidenceResult.commercialActivationReady, false);
assert.equal(blockedSbomEvidenceResult.manifestWritten, false);
assert.ok(
  blockedSbomEvidenceResult.blockers.some(
    (blocker) =>
      blocker.code === 'SBOM_EVIDENCE_NOT_READY' &&
      blocker.sourceCode === 'PACKAGE_SBOM_UNKNOWN_PACKAGE_ID' &&
      blocker.packageId === 'desktop-web',
  ),
);
assert.equal(readJson(path.join(blockedSbomEvidenceRoot, 'sdkwork.app.config.json')).publish.status, 'INACTIVE');

const missingSignatureRoot = tempRoot('autocut-manifest-sync-missing-signature');
writeManifest(missingSignatureRoot);
writeReleaseEvidenceSet(missingSignatureRoot, {
  signatureReady: false,
  signaturePackageId: 'desktop-windows-msi',
});
writeSbomEvidence(missingSignatureRoot);
const missingSignatureResult = syncAutoCutAppManifestReleaseEvidence({
  rootDir: missingSignatureRoot,
  activateCommercial: true,
});

assert.equal(missingSignatureResult.commercialActivationReady, false);
assert.equal(missingSignatureResult.manifestWritten, false);
assert.deepEqual(
  missingSignatureResult.blockers.map((blocker) => blocker.code),
  ['PLATFORM_INSTALLER_SIGNATURE_EVIDENCE_NOT_READY', 'PACKAGE_TRUST_EVIDENCE_NOT_READY'],
);

console.log('ok - autocut app manifest release evidence sync contract');
