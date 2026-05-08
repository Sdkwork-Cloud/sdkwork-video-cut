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

function writeTargetInstallers(root, targetTriple, entries) {
  const bundleRoot = path.join(
    root,
    'packages',
    'sdkwork-autocut-desktop',
    'src-tauri',
    'target',
    targetTriple,
    'release',
    'bundle',
  );
  const written = {};
  for (const [relativePath, content] of entries) {
    const absolutePath = path.join(bundleRoot, ...relativePath.split('/'));
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content);
    written[relativePath] = absolutePath;
  }
  return written;
}

const root = tempRoot('autocut-installer-signature');
writeInstallers(root);

const unsignedEvidence = createAutoCutInstallerSignatureEvidence({
  rootDir: root,
  generatedAt: '2026-05-05T00:00:00.000Z',
  runCommand(command, args) {
    assert.equal(command, 'powershell');
    assert.deepEqual(args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-Command']);
    assert.equal(args[3]?.includes('SDKWork Video Cut'), true);
    assert.equal(args[3]?.includes('Get-AuthenticodeSignature'), true);
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

const linuxRoot = tempRoot('autocut-installer-signature-linux');
writeTargetInstallers(linuxRoot, 'x86_64-unknown-linux-gnu', [
  ['deb/sdkwork-video-cut_0.1.0_amd64.deb', 'linux deb fixture'],
  ['appimage/sdkwork-video-cut_0.1.0_amd64.AppImage', 'linux appimage fixture'],
]);
const linuxEvidence = createAutoCutInstallerSignatureEvidence({
  rootDir: linuxRoot,
  platform: 'linux-x86_64',
  generatedAt: '2026-05-06T00:00:00.000Z',
  runCommand() {
    throw new Error('Linux preview signature evidence must not invoke Windows Authenticode checks.');
  },
});

assert.equal(linuxEvidence.verification.platform, 'linux-x86_64');
assert.equal(linuxEvidence.verification.method, 'unsigned-linux-preview-artifact-digest');
assert.deepEqual(
  linuxEvidence.installers.map((installer) => installer.kind),
  ['deb', 'appimage'],
);
assert.equal(
  linuxEvidence.installers.every((installer) => installer.exists && installer.signatureStatus === 'unsigned-preview'),
  true,
);
assert.equal(linuxEvidence.readiness.installerSignatureReady, false);
assert.deepEqual(
  linuxEvidence.blockers.map((blocker) => blocker.code),
  ['LINUX_INSTALLER_SIGNATURE_NOT_CONFIGURED', 'LINUX_INSTALLER_SIGNATURE_NOT_CONFIGURED'],
);

const macRoot = tempRoot('autocut-installer-signature-macos');
writeTargetInstallers(macRoot, 'aarch64-apple-darwin', [
  ['dmg/SDKWork Video Cut_0.1.0_aarch64.dmg', 'macos dmg fixture'],
  ['macos/SDKWork Video Cut.app.tar.gz', 'macos app tar fixture'],
]);
const macEvidence = createAutoCutInstallerSignatureEvidence({
  rootDir: macRoot,
  platform: 'macos-aarch64',
  generatedAt: '2026-05-06T00:00:00.000Z',
  runCommand() {
    throw new Error('Unsigned macOS preview evidence must not run local codesign checks.');
  },
});

assert.equal(macEvidence.verification.platform, 'macos-aarch64');
assert.equal(macEvidence.verification.method, 'unsigned-macos-preview-codesign-notarytool-required');
assert.deepEqual(
  macEvidence.installers.map((installer) => installer.kind),
  ['dmg', 'app'],
);
assert.equal(
  macEvidence.installers.every((installer) => installer.exists && installer.notarizationStatus === 'not-notarized'),
  true,
);
assert.equal(macEvidence.readiness.installerSignatureReady, false);
assert.deepEqual(
  macEvidence.blockers.map((blocker) => blocker.code),
  ['MACOS_INSTALLER_NOT_SIGNED_OR_NOTARIZED', 'MACOS_INSTALLER_NOT_SIGNED_OR_NOTARIZED'],
);

const notSignedStatusEvidence = createAutoCutInstallerSignatureEvidence({
  rootDir: root,
  generatedAt: '2026-05-05T00:00:00.000Z',
  runCommand() {
    return {
      status: 0,
      stdout: 'Status=NotSigned\r\nSigner=',
      stderr: '',
    };
  },
});

assert.equal(notSignedStatusEvidence.readiness.installerSignatureReady, false);
assert.equal(
  notSignedStatusEvidence.installers.every((installer) => installer.signatureStatus === 'NotSigned'),
  true,
);

const signedEvidence = createAutoCutInstallerSignatureEvidence({
  rootDir: root,
  generatedAt: '2026-05-05T00:00:00.000Z',
  runCommand(command, args) {
    assert.equal(command, 'powershell');
    assert.equal(args[3]?.includes('SDKWork Video Cut'), true);
    assert.equal(args[3]?.includes('Get-AuthenticodeSignature'), true);
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
