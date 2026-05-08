#!/usr/bin/env node

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createAutoCutHostPlatformKey,
  createAutoCutReleaseSmokePreflightReport,
  formatAutoCutReleaseSmokePreflightMessage,
} from './check-autocut-release-smoke-preflight.mjs';

const platformSpecs = [
  ['windows-x86_64', 'windows-x86_64/ffmpeg.exe', 'ffmpeg.exe', 'windows-x86_64/whisper-cli.exe', 'whisper-cli.exe'],
  ['linux-x86_64', 'linux-x86_64/ffmpeg', 'ffmpeg', 'linux-x86_64/whisper-cli', 'whisper-cli'],
  ['macos-x86_64', 'macos-x86_64/ffmpeg', 'ffmpeg', 'macos-x86_64/whisper-cli', 'whisper-cli'],
  ['macos-aarch64', 'macos-aarch64/ffmpeg', 'ffmpeg', 'macos-aarch64/whisper-cli', 'whisper-cli'],
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

function writeManifest(root, { bundledReady, platformIntegrity = {} }) {
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
        platforms: Object.fromEntries(
          platformSpecs.map(([platform, relativePath, binaryName]) => [
            platform,
            {
              relativePath,
              binaryName,
              integrity: platformIntegrity[platform] ?? placeholderIntegrity(),
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

function writeSpeechManifest(root, { bundledReady, platformIntegrity = {} }) {
  const manifestPath = path.join(root, 'packages', 'sdkwork-autocut-desktop', 'src-tauri', 'binaries', 'speech-transcription.toolchain.json');
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        tool: 'whisper-cli',
        contractVersion: '2026-05-08.speech-toolchain.v1',
        bundledReady,
        requiredBinary: 'whisper-cli',
        license: {
          name: 'whisper.cpp',
          spdxExpression: 'MIT',
          notice: 'Bundled whisper.cpp sidecars must keep their upstream license notices.',
        },
        platforms: Object.fromEntries(
          platformSpecs.map(([platform, , , relativePath, binaryName]) => [
            platform,
            {
              relativePath,
              binaryName,
              integrity: platformIntegrity[platform] ?? placeholderIntegrity(),
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

function sidecarIntegrity(content) {
  return {
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
    byteSize: Buffer.byteLength(content),
  };
}

function writeSidecar(root, relativePath, content) {
  const sidecarPath = path.join(
    root,
    'packages',
    'sdkwork-autocut-desktop',
    'src-tauri',
    'binaries',
    ...relativePath.split('/'),
  );
  fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
  fs.writeFileSync(sidecarPath, content);
  return sidecarPath;
}

assert.equal(
  createAutoCutHostPlatformKey({ platform: 'win32', arch: 'x64' }),
  'windows-x86_64',
);
assert.equal(
  createAutoCutHostPlatformKey({ platform: 'linux', arch: 'x64' }),
  'linux-x86_64',
);
assert.equal(
  createAutoCutHostPlatformKey({ platform: 'darwin', arch: 'x64' }),
  'macos-x86_64',
);
assert.equal(
  createAutoCutHostPlatformKey({ platform: 'darwin', arch: 'arm64' }),
  'macos-aarch64',
);

const aliasRoot = tempRoot('autocut-release-platform-aliases');
const aliasFfmpegContent = 'release smoke ffmpeg alias';
const aliasSpeechContent = 'release smoke whisper alias';
writeSidecar(aliasRoot, 'macos-aarch64/ffmpeg', aliasFfmpegContent);
writeSidecar(aliasRoot, 'macos-aarch64/whisper-cli', aliasSpeechContent);
writeManifest(aliasRoot, {
  bundledReady: false,
  platformIntegrity: {
    'macos-aarch64': sidecarIntegrity(aliasFfmpegContent),
  },
});
writeSpeechManifest(aliasRoot, {
  bundledReady: false,
  platformIntegrity: {
    'macos-aarch64': sidecarIntegrity(aliasSpeechContent),
  },
});
const aliasReport = createAutoCutReleaseSmokePreflightReport({
  rootDir: aliasRoot,
  platform: 'darwin-arm64',
  requireBundled: true,
  skipExecutableSmoke: true,
});
assert.equal(aliasReport.platform, 'macos-aarch64');
assert.equal(aliasReport.bundledReady, true);
assert.equal(aliasReport.speechSidecar.bundledReady, true);

const honestRoot = tempRoot('autocut-release-honest');
writeManifest(honestRoot, {
  bundledReady: false,
});
writeSpeechManifest(honestRoot, {
  bundledReady: false,
});
const honestReport = createAutoCutReleaseSmokePreflightReport({
  rootDir: honestRoot,
  platform: 'windows-x86_64',
  requireBundled: false,
});

assert.equal(honestReport.manifestReady, true);
assert.equal(honestReport.bundledReady, false);
assert.equal(honestReport.platformBundledReady, false);
assert.equal(honestReport.manifestBundledReady, false);
assert.equal(honestReport.ffmpegExecutionReady, false);
assert.equal(honestReport.sidecarPresent, false);
assert.equal(honestReport.speechSidecar.bundledReady, false);
assert.equal(honestReport.releaseSmokeReady, true);

for (const [platform, ffmpegRelativePath, , speechRelativePath] of platformSpecs) {
  const bundledRoot = tempRoot(`autocut-release-bundled-${platform}`);
  const bundledFfmpegContent = `release smoke ffmpeg ${platform}`;
  const bundledSpeechContent = `release smoke whisper ${platform}`;
  writeSidecar(bundledRoot, ffmpegRelativePath, bundledFfmpegContent);
  writeSidecar(bundledRoot, speechRelativePath, bundledSpeechContent);
  writeManifest(bundledRoot, {
    bundledReady: false,
    platformIntegrity: {
      [platform]: sidecarIntegrity(bundledFfmpegContent),
    },
  });
  writeSpeechManifest(bundledRoot, {
    bundledReady: false,
    platformIntegrity: {
      [platform]: sidecarIntegrity(bundledSpeechContent),
    },
  });
  const bundledReport = createAutoCutReleaseSmokePreflightReport({
    rootDir: bundledRoot,
    platform,
    requireBundled: true,
    skipExecutableSmoke: true,
  });

  assert.equal(bundledReport.platform, platform);
  assert.equal(bundledReport.bundledReady, true);
  assert.equal(bundledReport.platformBundledReady, true);
  assert.equal(bundledReport.manifestBundledReady, false);
  assert.equal(bundledReport.sidecarPresent, true);
  assert.equal(bundledReport.integrityReady, true);
  assert.equal(bundledReport.speechSidecar.platform, platform);
  assert.equal(bundledReport.speechSidecar.bundledReady, true);
  assert.equal(bundledReport.speechSidecar.platformBundledReady, true);
  assert.equal(bundledReport.speechSidecar.manifestBundledReady, false);
  assert.equal(bundledReport.releaseSmokeReady, true);
}

const bundledRoot = tempRoot('autocut-release-bundled');
const sidecarPath = writeSidecar(
  bundledRoot,
  'windows-x86_64/ffmpeg.exe',
  'release smoke ffmpeg',
);
const speechSidecarPath = writeSidecar(
  bundledRoot,
  'windows-x86_64/whisper-cli.exe',
  'release smoke whisper',
);
const bundledFfmpegContent = fs.readFileSync(sidecarPath);
const bundledSpeechContent = fs.readFileSync(speechSidecarPath);
writeManifest(bundledRoot, {
  bundledReady: true,
  platformIntegrity: Object.fromEntries(platformSpecs.map(([platform]) => [
    platform,
    platform === 'windows-x86_64' ? sidecarIntegrity(bundledFfmpegContent) : sidecarIntegrity(`unused ffmpeg ${platform}`),
  ])),
});
writeSpeechManifest(bundledRoot, {
  bundledReady: true,
  platformIntegrity: Object.fromEntries(platformSpecs.map(([platform]) => [
    platform,
    platform === 'windows-x86_64' ? sidecarIntegrity(bundledSpeechContent) : sidecarIntegrity(`unused whisper ${platform}`),
  ])),
});
const bundledReport = createAutoCutReleaseSmokePreflightReport({
  rootDir: bundledRoot,
  platform: 'windows-x86_64',
  requireBundled: true,
  skipExecutableSmoke: true,
});

assert.equal(bundledReport.bundledReady, true);
assert.equal(bundledReport.platformBundledReady, true);
assert.equal(bundledReport.manifestBundledReady, true);
assert.equal(bundledReport.sidecarPresent, true);
assert.equal(bundledReport.integrityReady, true);
assert.equal(bundledReport.speechSidecar.bundledReady, true);
assert.equal(bundledReport.releaseSmokeReady, true);
assert.equal(formatAutoCutReleaseSmokePreflightMessage(bundledReport), 'ok - autocut release smoke preflight platform=windows-x86_64 bundledReady=true platformBundledReady=true integrityReady=true speechBundledReady=true executableSmokeReady=skipped ffmpegExecutionReady=false');

assert.throws(
  () => createAutoCutReleaseSmokePreflightReport({
    rootDir: honestRoot,
    platform: 'windows-x86_64',
    requireBundled: true,
  }),
  /requires bundled FFmpeg and speech-to-text sidecars/u,
);

const missingSpeechRoot = tempRoot('autocut-release-missing-speech');
const missingSpeechFfmpegContent = 'release smoke ffmpeg';
writeSidecar(missingSpeechRoot, 'windows-x86_64/ffmpeg.exe', missingSpeechFfmpegContent);
writeManifest(missingSpeechRoot, {
  bundledReady: false,
  platformIntegrity: {
    'windows-x86_64': sidecarIntegrity(missingSpeechFfmpegContent),
  },
});
writeSpeechManifest(missingSpeechRoot, {
  bundledReady: false,
});
assert.throws(
  () => createAutoCutReleaseSmokePreflightReport({
    rootDir: missingSpeechRoot,
    platform: 'windows-x86_64',
    requireBundled: true,
    skipExecutableSmoke: true,
  }),
  /requires bundled FFmpeg and speech-to-text sidecars/u,
);

console.log('ok - autocut release smoke preflight contract');
