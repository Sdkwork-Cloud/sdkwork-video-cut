#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createAutoCutInstallerSigningPlan,
  formatAutoCutInstallerSigningMessage,
  signAutoCutReleaseInstallers,
} from './sign-autocut-release-installers.mjs';

function tempRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

function writeInstallers(root) {
  const bundleRoot = path.join(root, 'packages', 'sdkwork-autocut-desktop', 'src-tauri', 'target', 'release', 'bundle');
  const msiPath = path.join(bundleRoot, 'msi', 'SDKWork Video Cut_0.1.0_x64_en-US.msi');
  const nsisPath = path.join(bundleRoot, 'nsis', 'SDKWork Video Cut_0.1.0_x64-setup.exe');
  fs.mkdirSync(path.dirname(msiPath), { recursive: true });
  fs.mkdirSync(path.dirname(nsisPath), { recursive: true });
  fs.writeFileSync(msiPath, 'msi installer bytes');
  fs.writeFileSync(nsisPath, 'nsis installer bytes');
  return { msiPath, nsisPath };
}

const root = tempRoot('autocut-installer-signing');
const { msiPath, nsisPath } = writeInstallers(root);
const pfxPath = path.join(root, 'certs', 'release.pfx');
fs.mkdirSync(path.dirname(pfxPath), { recursive: true });
fs.writeFileSync(pfxPath, 'pfx bytes');

assert.throws(
  () => createAutoCutInstallerSigningPlan({ rootDir: root }),
  /requires a signing certificate source/u,
);

assert.throws(
  () =>
    createAutoCutInstallerSigningPlan({
      rootDir: root,
      certificatePath: path.join(root, 'missing.pfx'),
      certificatePassword: 'secret',
    }),
  /signing certificate file is missing/u,
);

const pfxPlan = createAutoCutInstallerSigningPlan({
  rootDir: root,
  certificatePath: pfxPath,
  certificatePassword: 'secret',
  timestampUrl: 'http://timestamp.digicert.com',
  signToolPath: 'signtool.exe',
});

assert.equal(pfxPlan.installers.length, 2);
assert.deepEqual(
  pfxPlan.installers.map((installer) => installer.path),
  [msiPath, nsisPath],
);
assert.equal(pfxPlan.mode, 'pfx');
assert.equal(pfxPlan.certificatePath, pfxPath);
assert.equal(pfxPlan.timestampUrl, 'http://timestamp.digicert.com');
assert.equal(pfxPlan.commands[0].command, 'signtool.exe');
assert.deepEqual(
  pfxPlan.commands[0].args.slice(0, 7),
  ['sign', '/fd', 'SHA256', '/tr', 'http://timestamp.digicert.com', '/td', 'SHA256'],
);
assert.equal(pfxPlan.commands[0].args.includes('/f'), true);
assert.equal(pfxPlan.commands[0].args.includes('/p'), true);
assert.equal(pfxPlan.commands[0].args.at(-1), msiPath);

const storePlan = createAutoCutInstallerSigningPlan({
  rootDir: root,
  certificateThumbprint: 'ABCDEF0123456789',
  timestampUrl: 'http://timestamp.digicert.com',
});

assert.equal(storePlan.mode, 'store-thumbprint');
assert.equal(storePlan.commands[0].args.includes('/sha1'), true);
assert.equal(storePlan.commands[0].args.includes('ABCDEF0123456789'), true);
assert.equal(storePlan.commands[1].args.at(-1), nsisPath);

const executed = [];
const signed = signAutoCutReleaseInstallers({
  rootDir: root,
  certificatePath: pfxPath,
  certificatePassword: 'secret',
  timestampUrl: 'http://timestamp.digicert.com',
  signToolPath: 'signtool.exe',
  runCommand(command, args) {
    executed.push({ command, args });
    return {
      status: 0,
      stdout: 'Successfully signed',
      stderr: '',
    };
  },
});

assert.equal(executed.length, 2);
assert.equal(signed.ready, true);
assert.equal(signed.results.length, 2);
assert.equal(signed.results.every((result) => result.status === 0), true);
assert.equal(
  formatAutoCutInstallerSigningMessage(signed),
  `ok - autocut installer signing installers=2 mode=pfx`,
);

assert.throws(
  () =>
    signAutoCutReleaseInstallers({
      rootDir: root,
      certificatePath: pfxPath,
      certificatePassword: 'secret',
      runCommand() {
        return {
          status: 1,
          stdout: '',
          stderr: 'sign failed',
        };
      },
    }),
  /AutoCut installer signing failed/u,
);

console.log('ok - autocut installer signing contract');
