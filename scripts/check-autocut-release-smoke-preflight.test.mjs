#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createAutoCutReleaseSmokePreflightReport,
  formatAutoCutReleaseSmokePreflightMessage,
} from './check-autocut-release-smoke-preflight.mjs';

function tempRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

function writeManifest(root, { bundledReady, sha256, byteSize }) {
  const manifestPath = path.join(root, 'packages', 'sdkwork-autocut-desktop', 'src-tauri', 'binaries', 'ffmpeg.toolchain.json');
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
              sha256,
              byteSize,
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

const honestRoot = tempRoot('autocut-release-honest');
writeManifest(honestRoot, {
  bundledReady: false,
  sha256: '0000000000000000000000000000000000000000000000000000000000000000',
  byteSize: 0,
});
const honestReport = createAutoCutReleaseSmokePreflightReport({
  rootDir: honestRoot,
  platform: 'windows-x86_64',
  requireBundled: false,
});

assert.equal(honestReport.manifestReady, true);
assert.equal(honestReport.bundledReady, false);
assert.equal(honestReport.ffmpegExecutionReady, false);
assert.equal(honestReport.sidecarPresent, false);
assert.equal(honestReport.releaseSmokeReady, true);

const bundledRoot = tempRoot('autocut-release-bundled');
const sidecarPath = path.join(
  bundledRoot,
  'packages',
  'sdkwork-autocut-desktop',
  'src-tauri',
  'binaries',
  'windows-x86_64',
  'ffmpeg.exe',
);
fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
fs.writeFileSync(sidecarPath, 'release smoke ffmpeg');
writeManifest(bundledRoot, {
  bundledReady: true,
  sha256: '04ad2602c9cac1bc3c52d7cae1e94f1bc51bb9d6ed3377a93350659b7d14dfab',
  byteSize: 20,
});
const bundledReport = createAutoCutReleaseSmokePreflightReport({
  rootDir: bundledRoot,
  platform: 'windows-x86_64',
  requireBundled: true,
  skipExecutableSmoke: true,
});

assert.equal(bundledReport.bundledReady, true);
assert.equal(bundledReport.sidecarPresent, true);
assert.equal(bundledReport.integrityReady, true);
assert.equal(bundledReport.releaseSmokeReady, true);
assert.equal(formatAutoCutReleaseSmokePreflightMessage(bundledReport), 'ok - autocut release smoke preflight platform=windows-x86_64 bundledReady=true integrityReady=true executableSmokeReady=skipped ffmpegExecutionReady=false');

assert.throws(
  () => createAutoCutReleaseSmokePreflightReport({
    rootDir: honestRoot,
    platform: 'windows-x86_64',
    requireBundled: true,
  }),
  /requires a bundled FFmpeg sidecar/u,
);

console.log('ok - autocut release smoke preflight contract');
