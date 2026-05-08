#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createAutoCutAppManifestReleaseReadinessReport,
  formatAutoCutAppManifestReleaseReadinessMessage,
} from './check-autocut-app-manifest-release-readiness.mjs';

function tempRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

function writeManifest(root, overrides = {}) {
  const manifestPath = path.join(root, 'sdkwork.app.config.json');
  const manifest = mergeManifest(
    {
      schemaVersion: 3,
      kind: 'sdkwork.app',
      app: {
        key: 'sdkwork-video-cut',
        versionSource: 'package.json',
      },
      publish: {
        status: 'INACTIVE',
      },
      artifacts: {
        installConfig: {
          defaultPackageId: 'desktop-windows-msi',
          packages: [
            packageFixture('desktop-windows-msi', {
              platform: 'DESKTOP_WINDOWS',
              packageFormat: 'MSI',
              architecture: 'x64',
              metadata: {
                releaseAsset: true,
                commercialActivationRequired:
                  'Enable only after GitHub Release asset digest, Authenticode signature evidence, and SBOM evidence are recorded.',
              },
            }),
            packageFixture('desktop-linux-appimage', {
              platform: 'DESKTOP_LINUX',
              packageFormat: 'APPIMAGE',
              architecture: 'x64',
              metadata: {
                releaseAsset: true,
                commercialActivationRequired:
                  'Enable only after GitHub Release asset digest, Linux package trust evidence, and SBOM evidence are recorded.',
              },
            }),
          ],
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
              commercialActivationRequired: [
                'GitHub Release assets uploaded for every package',
                'SHA-256 checksum recorded for every enabled package',
                'SBOM evidence recorded',
              ],
            },
          },
        ],
      },
      security: {
        checksumRequired: true,
        signatureRequired: true,
        sbomRequired: true,
      },
    },
    overrides,
  );
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifestPath;
}

function packageFixture(id, overrides = {}) {
  return {
    id,
    name: `SDKWork Video Cut ${id}`,
    sourceType: 'BINARY_URL',
    packageFormat: 'MSI',
    platform: 'DESKTOP_WINDOWS',
    url: `https://github.com/Sdkwork-Cloud/sdkwork-video-cut/releases/download/v0.1.1/${id}`,
    enabled: false,
    architecture: 'x64',
    ...overrides,
    metadata: {
      ...(overrides.metadata ?? {}),
    },
  };
}

function commercialPackageFixture(id, overrides = {}) {
  return packageFixture(id, {
    enabled: true,
    checksumAlgorithm: 'SHA-256',
    checksum: 'a'.repeat(64),
    sizeBytes: 1024,
    metadata: {
      releaseAsset: true,
      trustEvidence: {
        status: 'verified',
        platform: 'DESKTOP_WINDOWS',
        signed: true,
        signatureStatus: 'Valid',
        evidencePath: 'artifacts/release/autocut-installer-signature-evidence-windows-x86_64.json',
      },
      sbom: {
        format: 'CycloneDX',
        url: 'https://github.com/Sdkwork-Cloud/sdkwork-video-cut/releases/download/v0.1.1/sbom.cdx.json',
        sha256: 'b'.repeat(64),
      },
    },
    ...overrides,
    metadata: {
      releaseAsset: true,
      trustEvidence: {
        status: 'verified',
        platform: 'DESKTOP_WINDOWS',
        signed: true,
        signatureStatus: 'Valid',
        evidencePath: 'artifacts/release/autocut-installer-signature-evidence-windows-x86_64.json',
      },
      sbom: {
        format: 'CycloneDX',
        url: 'https://github.com/Sdkwork-Cloud/sdkwork-video-cut/releases/download/v0.1.1/sbom.cdx.json',
        sha256: 'b'.repeat(64),
      },
      ...(overrides.metadata ?? {}),
    },
  });
}

function mergeManifest(base, overrides) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    return base;
  }
  const output = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      base[key] &&
      typeof base[key] === 'object' &&
      !Array.isArray(base[key])
    ) {
      output[key] = mergeManifest(base[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

const previewRoot = tempRoot('autocut-app-manifest-preview');
writeManifest(previewRoot);
const previewReport = createAutoCutAppManifestReleaseReadinessReport({ rootDir: previewRoot });

assert.equal(previewReport.schemaVersion, '2026-05-08.autocut-app-manifest-release-readiness.v1');
assert.equal(previewReport.manifestReleaseReady, true);
assert.equal(previewReport.mode, 'inactive-preview');
assert.equal(previewReport.summary.enabledPackages, 0);
assert.equal(previewReport.summary.disabledPackages, 2);
assert.deepEqual(previewReport.blockers, []);
assert.equal(
  formatAutoCutAppManifestReleaseReadinessMessage(previewReport),
  'ok - autocut app manifest release readiness mode=inactive-preview packages=0/2 blockers=0 warnings=0',
);

const previewMissingActivationRoot = tempRoot('autocut-app-manifest-preview-missing-activation');
writeManifest(previewMissingActivationRoot, {
  artifacts: {
    installConfig: {
      packages: [
        packageFixture('desktop-windows-msi', {
          metadata: {
            releaseAsset: true,
          },
        }),
      ],
    },
  },
});
const previewMissingActivationReport = createAutoCutAppManifestReleaseReadinessReport({
  rootDir: previewMissingActivationRoot,
});

assert.equal(previewMissingActivationReport.manifestReleaseReady, false);
assert.deepEqual(
  previewMissingActivationReport.blockers.map((blocker) => blocker.code),
  ['DISABLED_PACKAGE_COMMERCIAL_ACTIVATION_MISSING'],
);

const activeDisabledRoot = tempRoot('autocut-app-manifest-active-disabled');
writeManifest(activeDisabledRoot, {
  publish: {
    status: 'ACTIVE',
  },
});
const activeDisabledReport = createAutoCutAppManifestReleaseReadinessReport({ rootDir: activeDisabledRoot });

assert.equal(activeDisabledReport.manifestReleaseReady, false);
assert.deepEqual(
  activeDisabledReport.blockers.map((blocker) => blocker.code),
  ['ACTIVE_MANIFEST_HAS_NO_ENABLED_PACKAGES'],
);

const activeMissingChecksumRoot = tempRoot('autocut-app-manifest-active-missing-checksum');
writeManifest(activeMissingChecksumRoot, {
  publish: {
    status: 'ACTIVE',
  },
  artifacts: {
    installConfig: {
      packages: [
        commercialPackageFixture('desktop-windows-msi', {
          checksum: '',
          checksumAlgorithm: '',
        }),
      ],
    },
  },
});
const activeMissingChecksumReport = createAutoCutAppManifestReleaseReadinessReport({
  rootDir: activeMissingChecksumRoot,
});

assert.equal(activeMissingChecksumReport.manifestReleaseReady, false);
assert.deepEqual(
  activeMissingChecksumReport.blockers.map((blocker) => blocker.code),
  ['ENABLED_PACKAGE_CHECKSUM_INVALID'],
);

const activePlaceholderEvidenceRoot = tempRoot('autocut-app-manifest-active-placeholder');
writeManifest(activePlaceholderEvidenceRoot, {
  publish: {
    status: 'ACTIVE',
  },
  artifacts: {
    installConfig: {
      packages: [
        commercialPackageFixture('desktop-windows-msi', {
          checksum: '0'.repeat(64),
          metadata: {
            generatedPlaceholder: true,
            trustEvidence: {
              status: 'pending',
            },
            sbom: {
              format: 'CycloneDX',
              url: 'https://github.com/Sdkwork-Cloud/sdkwork-video-cut/releases/download/v0.1.1/sbom.cdx.json',
              sha256: '0'.repeat(64),
            },
          },
        }),
      ],
    },
  },
});
const activePlaceholderEvidenceReport = createAutoCutAppManifestReleaseReadinessReport({
  rootDir: activePlaceholderEvidenceRoot,
});

assert.equal(activePlaceholderEvidenceReport.manifestReleaseReady, false);
assert.deepEqual(
  activePlaceholderEvidenceReport.blockers.map((blocker) => blocker.code),
  [
    'ENABLED_PACKAGE_PLACEHOLDER_METADATA',
    'ENABLED_PACKAGE_CHECKSUM_PLACEHOLDER',
    'ENABLED_PACKAGE_TRUST_EVIDENCE_INVALID',
    'ENABLED_PACKAGE_SBOM_INVALID',
  ],
);

const activeReadyRoot = tempRoot('autocut-app-manifest-active-ready');
writeManifest(activeReadyRoot, {
  publish: {
    status: 'ACTIVE',
  },
  artifacts: {
    installConfig: {
      packages: [
        commercialPackageFixture('desktop-windows-msi'),
        commercialPackageFixture('desktop-linux-appimage', {
          platform: 'DESKTOP_LINUX',
          packageFormat: 'APPIMAGE',
          metadata: {
            trustEvidence: {
              status: 'verified',
              platform: 'DESKTOP_LINUX',
              signed: true,
              signatureStatus: 'verified',
              evidencePath: 'artifacts/release/autocut-installer-signature-evidence-linux-x86_64.json',
            },
            sbom: {
              format: 'SPDX',
              url: 'https://github.com/Sdkwork-Cloud/sdkwork-video-cut/releases/download/v0.1.1/sbom.spdx.json',
              sha256: 'c'.repeat(64),
            },
          },
        }),
      ],
    },
  },
  release: {
    notes: [
      {
        version: '0.1.1',
        current: true,
        metadata: {
          previewRelease: false,
        },
      },
    ],
  },
});
const activeReadyReport = createAutoCutAppManifestReleaseReadinessReport({ rootDir: activeReadyRoot });

assert.equal(activeReadyReport.manifestReleaseReady, true);
assert.equal(activeReadyReport.mode, 'active-commercial');
assert.equal(activeReadyReport.summary.enabledPackages, 2);
assert.equal(activeReadyReport.summary.disabledPackages, 0);
assert.deepEqual(activeReadyReport.blockers, []);
assert.equal(
  formatAutoCutAppManifestReleaseReadinessMessage(activeReadyReport),
  'ok - autocut app manifest release readiness mode=active-commercial packages=2/2 blockers=0 warnings=0',
);

console.log('ok - autocut app manifest release readiness contract');
