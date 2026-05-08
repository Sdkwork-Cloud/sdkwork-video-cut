#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createAutoCutFfmpegSidecarPlan,
  formatAutoCutFfmpegSidecarMessage,
  prepareAutoCutFfmpegSidecar,
} from './prepare-autocut-ffmpeg-sidecar.mjs';

const platformSpecs = [
  ['windows-x86_64', 'windows-x86_64/ffmpeg.exe', 'ffmpeg.exe'],
  ['linux-x86_64', 'linux-x86_64/ffmpeg', 'ffmpeg'],
  ['macos-x86_64', 'macos-x86_64/ffmpeg', 'ffmpeg'],
  ['macos-aarch64', 'macos-aarch64/ffmpeg', 'ffmpeg'],
];

function tempRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

function placeholderIntegrity() {
  return {
    sha256: '0000000000000000000000000000000000000000000000000000000000000000',
    byteSize: 0,
  };
}

function writeManifest(root, bundledReady = false) {
  const manifestPath = path.join(root, 'binaries', 'ffmpeg.toolchain.json');
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        tool: 'ffmpeg',
        contractVersion: '2026-05-05.ffmpeg-toolchain.v1',
        bundledReady,
        requiredBinary: 'ffmpeg',
        license: {
          name: 'FFmpeg',
          spdxExpression: 'LGPL-2.1-or-later OR GPL-2.0-or-later',
          notice: 'Bundled FFmpeg sidecars must keep their upstream license notices.',
        },
        platforms: Object.fromEntries(
          platformSpecs.map(([platform, relativePath, binaryName]) => [
            platform,
            {
              relativePath,
              binaryName,
              integrity: placeholderIntegrity(),
            },
          ]),
        ),
      },
      null,
      2,
    ),
  );
  return manifestPath;
}

function writeSource(root, name, content) {
  const sourcePath = path.join(root, name);
  fs.writeFileSync(sourcePath, content);
  return sourcePath;
}

const sidecarRoot = tempRoot('autocut-sidecar');
const sourcePath = writeSource(sidecarRoot, 'ffmpeg.exe', 'test ffmpeg sidecar');
const manifestPath = writeManifest(sidecarRoot);

const platformAliasExpectations = [
  ['windows-x64', 'windows-x86_64', 'windows-x86_64/ffmpeg.exe'],
  ['win32-x64', 'windows-x86_64', 'windows-x86_64/ffmpeg.exe'],
  ['ubuntu-x64', 'linux-x86_64', 'linux-x86_64/ffmpeg'],
  ['linux-amd64', 'linux-x86_64', 'linux-x86_64/ffmpeg'],
  ['darwin-x64', 'macos-x86_64', 'macos-x86_64/ffmpeg'],
  ['macos-arm64', 'macos-aarch64', 'macos-aarch64/ffmpeg'],
  ['aarch64-apple-darwin', 'macos-aarch64', 'macos-aarch64/ffmpeg'],
];
for (const [alias, expectedPlatform, expectedRelativePath] of platformAliasExpectations) {
  const aliasPlan = createAutoCutFfmpegSidecarPlan({
    manifestPath,
    platform: alias,
    sourcePath,
    acceptLicense: true,
    dryRun: true,
  });
  assert.equal(aliasPlan.platform, expectedPlatform);
  assert.equal(aliasPlan.relativePath, expectedRelativePath);
}

assert.throws(
  () => createAutoCutFfmpegSidecarPlan({
    manifestPath,
    platform: 'macos',
    sourcePath,
    acceptLicense: true,
    dryRun: true,
  }),
  /macos is ambiguous; use macos-x86_64 or macos-aarch64/u,
);

for (const [platform, relativePath, binaryName] of platformSpecs) {
  const dryRunPlan = createAutoCutFfmpegSidecarPlan({
    manifestPath,
    platform,
    sourcePath,
    acceptLicense: true,
    dryRun: true,
  });

  assert.equal(dryRunPlan.platform, platform);
  assert.equal(dryRunPlan.relativePath, relativePath);
  assert.equal(dryRunPlan.binaryName, binaryName);
  assert.equal(dryRunPlan.byteSize, 19);
  assert.equal(dryRunPlan.bundledReady, true);
  assert.equal(dryRunPlan.platformBundledReady, true);
  assert.equal(dryRunPlan.manifestBundledReady, false);
  assert.equal(dryRunPlan.writes.length, 0);
  assert.match(dryRunPlan.sha256, /^[a-f0-9]{64}$/u);
}

assert.throws(
  () => createAutoCutFfmpegSidecarPlan({
    manifestPath,
    platform: 'windows-x86_64',
    sourcePath,
    acceptLicense: false,
  }),
  /confirm FFmpeg license obligations/u,
);

assert.throws(
  () => createAutoCutFfmpegSidecarPlan({
    manifestPath,
    platform: '../windows-x86_64',
    sourcePath,
    acceptLicense: true,
  }),
  /Unsupported AutoCut FFmpeg sidecar platform/u,
);

const preparedPlan = prepareAutoCutFfmpegSidecar({
  manifestPath,
  platform: 'windows-x86_64',
  sourcePath,
  acceptLicense: true,
});
const updatedManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const copiedSidecarPath = path.join(sidecarRoot, 'binaries', 'windows-x86_64', 'ffmpeg.exe');

assert.equal(updatedManifest.bundledReady, false);
assert.equal(preparedPlan.bundledReady, true);
assert.equal(preparedPlan.platformBundledReady, true);
assert.equal(preparedPlan.manifestBundledReady, false);
assert.equal(updatedManifest.platforms['windows-x86_64'].integrity.byteSize, 19);
assert.equal(updatedManifest.platforms['windows-x86_64'].integrity.sha256, preparedPlan.sha256);
assert.equal(updatedManifest.platforms['linux-x86_64'].integrity.byteSize, 0);
assert.equal(fs.readFileSync(copiedSidecarPath, 'utf8'), 'test ffmpeg sidecar');
assert.equal(preparedPlan.writes.includes(copiedSidecarPath), true);
assert.match(
  formatAutoCutFfmpegSidecarMessage(preparedPlan),
  /ok - autocut ffmpeg sidecar windows-x86_64 byteSize=19 sha256=/u,
);

const allPlatformsRoot = tempRoot('autocut-ffmpeg-sidecar-all-platforms');
const allPlatformsManifestPath = writeManifest(allPlatformsRoot);
for (const [platform, , binaryName] of platformSpecs) {
  prepareAutoCutFfmpegSidecar({
    manifestPath: allPlatformsManifestPath,
    platform,
    sourcePath: writeSource(allPlatformsRoot, `${platform}-${binaryName}`, `test ffmpeg sidecar ${platform}`),
    acceptLicense: true,
  });
}
const allPlatformsManifest = JSON.parse(fs.readFileSync(allPlatformsManifestPath, 'utf8'));
assert.equal(allPlatformsManifest.bundledReady, true);

console.log('ok - autocut ffmpeg sidecar preparation contract');
