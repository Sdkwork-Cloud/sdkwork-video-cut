#!/usr/bin/env node

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createAutoCutSbomEvidence,
  formatAutoCutSbomEvidenceMessage,
  writeAutoCutSbomEvidence,
} from './write-autocut-sbom-evidence.mjs';

const packageIds = [
  'desktop-windows-msi',
  'desktop-windows-nsis',
  'desktop-linux-deb',
  'desktop-linux-appimage',
  'desktop-macos-x64-dmg',
  'desktop-macos-aarch64-dmg',
];

function tempRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function writeCompleteSboms(root) {
  const sbomDir = path.join(root, 'artifacts', 'release', 'sbom');
  for (const packageId of packageIds) {
    if (packageId.includes('linux')) {
      writeJson(path.join(sbomDir, `${packageId}.spdx.json`), {
        spdxVersion: 'SPDX-2.3',
        SPDXID: `SPDXRef-${packageId}`,
        name: `SDKWork Video Cut ${packageId}`,
        packages: [
          {
            SPDXID: 'SPDXRef-Package',
            name: packageId,
          },
        ],
      });
    } else {
      writeJson(path.join(sbomDir, `${packageId}.cdx.json`), {
        bomFormat: 'CycloneDX',
        specVersion: '1.6',
        serialNumber: `urn:uuid:${packageId}`,
        version: 1,
        metadata: {
          component: {
            type: 'application',
            name: packageId,
            version: '9.8.7',
          },
        },
        components: [],
      });
    }
  }
  return sbomDir;
}

const completeRoot = tempRoot('autocut-sbom-evidence-complete');
const completeSbomDir = writeCompleteSboms(completeRoot);
const completeEvidence = createAutoCutSbomEvidence({
  rootDir: completeRoot,
  releaseTag: 'v9.8.7',
  generatedAt: '2026-05-08T00:00:00.000Z',
});

assert.equal(completeEvidence.schemaVersion, '2026-05-08.autocut-sbom-evidence.v1');
assert.equal(completeEvidence.generatedAt, '2026-05-08T00:00:00.000Z');
assert.equal(completeEvidence.releaseTag, 'v9.8.7');
assert.equal(completeEvidence.readiness.sbomReady, true);
assert.deepEqual(completeEvidence.summary, {
  packageCount: 6,
  readyPackageCount: 6,
  blockerCount: 0,
});
assert.deepEqual(
  completeEvidence.packages.map((entry) => entry.packageId),
  packageIds,
);
for (const entry of completeEvidence.packages) {
  const expectedPath = entry.packageId.includes('linux')
    ? path.join(completeSbomDir, `${entry.packageId}.spdx.json`)
    : path.join(completeSbomDir, `${entry.packageId}.cdx.json`);
  assert.equal(entry.path, path.relative(completeRoot, expectedPath).replaceAll(path.sep, '/'));
  assert.equal(entry.byteSize, fs.statSync(expectedPath).size);
  assert.equal(entry.sha256, sha256File(expectedPath));
  assert.match(entry.sha256, /^[a-f0-9]{64}$/u);
  assert.equal(
    entry.url,
    `https://github.com/Sdkwork-Cloud/sdkwork-video-cut/releases/download/v9.8.7/${path.basename(expectedPath)}`,
  );
  assert.ok(['CycloneDX', 'SPDX'].includes(entry.format));
}

const outputPath = path.join(completeRoot, 'artifacts', 'release', 'autocut-sbom-evidence.json');
const written = writeAutoCutSbomEvidence({
  rootDir: completeRoot,
  releaseTag: 'v9.8.7',
  generatedAt: '2026-05-08T00:00:00.000Z',
  outputPath,
});
assert.deepEqual(readJson(outputPath), written.evidence);
assert.equal(written.outputPath, outputPath);
assert.equal(
  formatAutoCutSbomEvidenceMessage(written),
  `ok - autocut SBOM evidence ${outputPath} packages=6 blockers=0`,
);

const blockedRoot = tempRoot('autocut-sbom-evidence-blocked');
const blockedSbomDir = path.join(blockedRoot, 'artifacts', 'release', 'sbom');
writeJson(path.join(blockedSbomDir, 'desktop-windows-msi.cdx.json'), {
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  components: [],
});
writeText(path.join(blockedSbomDir, 'desktop-windows-nsis.cdx.json'), '');
writeJson(path.join(blockedSbomDir, 'desktop-linux-deb.spdx.json'), {
  name: 'not an SPDX document',
});
writeText(path.join(blockedSbomDir, 'desktop-linux-appimage.sbom.json'), '{ invalid json');
writeJson(path.join(blockedSbomDir, 'desktop-web.cdx.json'), {
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  components: [],
});

const blockedEvidence = createAutoCutSbomEvidence({
  rootDir: blockedRoot,
  releaseTag: 'v9.8.7',
  generatedAt: '2026-05-08T00:00:00.000Z',
});

assert.equal(blockedEvidence.readiness.sbomReady, false);
assert.equal(blockedEvidence.summary.readyPackageCount, 1);
assert.deepEqual(
  blockedEvidence.blockers.map((blocker) => blocker.code).sort(),
  [
    'PACKAGE_SBOM_FILE_EMPTY',
    'PACKAGE_SBOM_FORMAT_UNSUPPORTED',
    'PACKAGE_SBOM_JSON_INVALID',
    'PACKAGE_SBOM_MISSING',
    'PACKAGE_SBOM_MISSING',
    'PACKAGE_SBOM_UNKNOWN_PACKAGE_ID',
  ],
);
assert.ok(
  blockedEvidence.blockers.some(
    (blocker) =>
      blocker.code === 'PACKAGE_SBOM_UNKNOWN_PACKAGE_ID' &&
      blocker.path === 'artifacts/release/sbom/desktop-web.cdx.json',
  ),
);

const duplicateRoot = tempRoot('autocut-sbom-evidence-duplicate');
const duplicateSbomDir = path.join(duplicateRoot, 'artifacts', 'release', 'sbom');
writeJson(path.join(duplicateSbomDir, 'desktop-windows-msi.cdx.json'), {
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  components: [],
});
writeJson(path.join(duplicateSbomDir, 'desktop-windows-msi.spdx.json'), {
  spdxVersion: 'SPDX-2.3',
  SPDXID: 'SPDXRef-Duplicate',
  packages: [],
});
for (const packageId of packageIds.slice(1)) {
  writeJson(path.join(duplicateSbomDir, `${packageId}.cdx.json`), {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    components: [],
  });
}

const duplicateEvidence = createAutoCutSbomEvidence({
  rootDir: duplicateRoot,
  releaseTag: 'v9.8.7',
});
assert.equal(duplicateEvidence.readiness.sbomReady, false);
assert.ok(
  duplicateEvidence.blockers.some(
    (blocker) =>
      blocker.code === 'PACKAGE_SBOM_MULTIPLE_CANDIDATES' &&
      blocker.packageId === 'desktop-windows-msi',
  ),
);
assert.equal(
  formatAutoCutSbomEvidenceMessage({ outputPath: outputPath, evidence: duplicateEvidence }),
  `blocked - autocut SBOM evidence ${outputPath} packages=5 blockers=1`,
);

console.log('ok - autocut SBOM evidence writer contract');
