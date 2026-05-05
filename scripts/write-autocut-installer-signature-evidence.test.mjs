#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createAutoCutInstallerSignatureEvidence,
  formatAutoCutInstallerSignatureEvidenceMessage,
  writeAutoCutInstallerSignatureEvidence,
} from './write-autocut-installer-signature-evidence.mjs';

function tempRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

function writeInstallers(root) {
  const bundleRoot = path.join(root, 'packages', 'sdkwork-autocut-desktop', 'src-tauri', 'target', 'release', 'bundle');
  const msiPath = path.join(bundleRoot, 'msi', 'SDKWork Video Cut_0.1.0_x64_en-US.msi');
  const nsisPath = path.join(bundleRoot, 'nsis', 'SDKWork Video Cut_0.1.0_x64-setup.exe');
  fs.mkdirSync(path.dirname(msiPath), { recursive: true });
  fs.mkdirSync(path.dirname(nsisPath), { recursive: true });
  fs.writeFileSync(msiPath, 'unsigned msi fixture');
  fs.writeFileSync(nsisPath, 'unsigned nsis fixture');
  return { msiPath, nsisPath };
}

const root = tempRoot('autocut-installer-signature');
writeInstallers(root);

const unsignedEvidence = createAutoCutInstallerSignatureEvidence({
  rootDir: root,
  generatedAt: '2026-05-05T00:00:00.000Z',
  runCommand(command, args) {
    assert.equal(command, 'powershell');
    assert.deepEqual(args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-Command']);
    assert.equal(args.at(-2), '-LiteralPath');
    assert.equal(args.at(-1)?.includes('SDKWork Video Cut'), true);
    assert.equal(fs.existsSync(args.at(-1)), true);
    return {
      status: 1,
      stdout: '',
      stderr: `${command} ${args.join(' ')} is not digitally signed`,
    };
  },
});

assert.equal(unsignedEvidence.schemaVersion, '2026-05-05.autocut-installer-signature-evidence.v1');
assert.equal(unsignedEvidence.generatedAt, '2026-05-05T00:00:00.000Z');
assert.equal(unsignedEvidence.readiness.installerSignatureReady, false);
assert.equal(unsignedEvidence.installers.length, 2);
assert.deepEqual(
  unsignedEvidence.installers.map((installer) => installer.kind),
  ['msi', 'nsis'],
);
assert.equal(
  unsignedEvidence.installers.every((installer) => installer.exists && !installer.signatureReady),
  true,
);
assert.equal(
  unsignedEvidence.blockers.some((blocker) => blocker.code === 'INSTALLER_SIGNATURE_MISSING'),
  true,
);

const signedEvidence = createAutoCutInstallerSignatureEvidence({
  rootDir: root,
  generatedAt: '2026-05-05T00:00:00.000Z',
  runCommand(command, args) {
    assert.equal(command, 'powershell');
    assert.equal(args.at(-2), '-LiteralPath');
    assert.equal(args.at(-1)?.includes('SDKWork Video Cut'), true);
    assert.equal(fs.existsSync(args.at(-1)), true);
    return {
      status: 0,
      stdout: 'SignerCertificate: CN=SDKWork Release\nStatus: Valid',
      stderr: '',
    };
  },
});

assert.equal(signedEvidence.readiness.installerSignatureReady, true);
assert.equal(signedEvidence.blockers.length, 0);
assert.equal(
  signedEvidence.installers.every((installer) => installer.signatureReady),
  true,
);

const outputPath = path.join(root, 'artifacts', 'release', 'autocut-installer-signature-evidence.json');
const written = writeAutoCutInstallerSignatureEvidence({
  rootDir: root,
  generatedAt: '2026-05-05T00:00:00.000Z',
  outputPath,
  runCommand() {
    return {
      status: 1,
      stdout: '',
      stderr: 'unsigned',
    };
  },
});
const persisted = JSON.parse(fs.readFileSync(outputPath, 'utf8'));

assert.deepEqual(persisted, written.evidence);
assert.equal(
  formatAutoCutInstallerSignatureEvidenceMessage(written),
  `ok - autocut installer signature evidence ${outputPath} installerSignatureReady=false blockers=2`,
);

console.log('ok - autocut installer signature evidence contract');
