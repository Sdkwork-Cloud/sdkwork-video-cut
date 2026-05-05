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

function tempRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
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
        platforms: {
          'windows-x86_64': {
            relativePath: 'windows-x86_64/ffmpeg.exe',
            binaryName: 'ffmpeg.exe',
            integrity: {
              sha256: '0000000000000000000000000000000000000000000000000000000000000000',
              byteSize: 0,
            },
          },
        },
      },
      null,
      2,
    ),
  );
  return manifestPath;
}

const sidecarRoot = tempRoot('autocut-sidecar');
const sourcePath = path.join(sidecarRoot, 'ffmpeg.exe');
fs.writeFileSync(sourcePath, 'test ffmpeg sidecar');
const manifestPath = writeManifest(sidecarRoot);

const dryRunPlan = createAutoCutFfmpegSidecarPlan({
  manifestPath,
  platform: 'windows-x86_64',
  sourcePath,
  acceptLicense: true,
  dryRun: true,
});

assert.equal(dryRunPlan.platform, 'windows-x86_64');
assert.equal(dryRunPlan.relativePath, 'windows-x86_64/ffmpeg.exe');
assert.equal(dryRunPlan.byteSize, 19);
assert.equal(dryRunPlan.bundledReady, true);
assert.equal(dryRunPlan.writes.length, 0);
assert.match(dryRunPlan.sha256, /^[a-f0-9]{64}$/u);

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

assert.equal(updatedManifest.bundledReady, true);
assert.equal(updatedManifest.platforms['windows-x86_64'].integrity.byteSize, 19);
assert.equal(updatedManifest.platforms['windows-x86_64'].integrity.sha256, preparedPlan.sha256);
assert.equal(fs.readFileSync(copiedSidecarPath, 'utf8'), 'test ffmpeg sidecar');
assert.equal(preparedPlan.writes.includes(copiedSidecarPath), true);
assert.match(
  formatAutoCutFfmpegSidecarMessage(preparedPlan),
  /ok - autocut ffmpeg sidecar windows-x86_64 byteSize=19 sha256=/u,
);

console.log('ok - autocut ffmpeg sidecar preparation contract');
