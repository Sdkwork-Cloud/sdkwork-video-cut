#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  assertAutoCutSpeechSidecarReadiness,
  createAutoCutHostPlatformKey,
  createAutoCutSpeechSidecarPlan,
  createAutoCutSpeechSidecarReadinessReport,
  formatAutoCutSpeechSidecarMessage,
  formatAutoCutSpeechSidecarReadinessMessage,
  prepareAutoCutSpeechSidecar,
} from './prepare-autocut-speech-sidecar.mjs';

const platformSpecs = [
  ['windows-x86_64', 'windows-x86_64/whisper-cli.exe', 'whisper-cli.exe'],
  ['linux-x86_64', 'linux-x86_64/whisper-cli', 'whisper-cli'],
  ['macos-x86_64', 'macos-x86_64/whisper-cli', 'whisper-cli'],
  ['macos-aarch64', 'macos-aarch64/whisper-cli', 'whisper-cli'],
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
  const manifestPath = path.join(root, 'binaries', 'speech-transcription.toolchain.json');
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

const platformAliasRoot = tempRoot('autocut-speech-sidecar-platform-aliases');
const platformAliasManifestPath = writeManifest(platformAliasRoot);
const platformAliasSourcePath = writeSource(platformAliasRoot, 'whisper-cli', 'test whisper sidecar aliases');
const platformAliasExpectations = [
  ['windows-x64', 'windows-x86_64', 'windows-x86_64/whisper-cli.exe'],
  ['win32-x64', 'windows-x86_64', 'windows-x86_64/whisper-cli.exe'],
  ['ubuntu-x64', 'linux-x86_64', 'linux-x86_64/whisper-cli'],
  ['linux-amd64', 'linux-x86_64', 'linux-x86_64/whisper-cli'],
  ['darwin-x64', 'macos-x86_64', 'macos-x86_64/whisper-cli'],
  ['macos-arm64', 'macos-aarch64', 'macos-aarch64/whisper-cli'],
  ['aarch64-apple-darwin', 'macos-aarch64', 'macos-aarch64/whisper-cli'],
];
for (const [alias, expectedPlatform, expectedRelativePath] of platformAliasExpectations) {
  const aliasPlan = createAutoCutSpeechSidecarPlan({
    manifestPath: platformAliasManifestPath,
    platform: alias,
    sourcePath: platformAliasSourcePath,
    acceptLicense: true,
    dryRun: true,
  });
  assert.equal(aliasPlan.platform, expectedPlatform);
  assert.equal(aliasPlan.relativePath, expectedRelativePath);
}

assert.throws(
  () => createAutoCutSpeechSidecarPlan({
    manifestPath: platformAliasManifestPath,
    platform: 'macos',
    sourcePath: platformAliasSourcePath,
    acceptLicense: true,
    dryRun: true,
  }),
  /macos is ambiguous; use macos-x86_64 or macos-aarch64/u,
);

const sidecarRoot = tempRoot('autocut-speech-sidecar');
const sourcePath = writeSource(sidecarRoot, 'whisper-cli.exe', 'test whisper sidecar');
const manifestPath = writeManifest(sidecarRoot);

for (const [platform, relativePath, binaryName] of platformSpecs) {
  const dryRunPlan = createAutoCutSpeechSidecarPlan({
    manifestPath,
    platform,
    sourcePath,
    acceptLicense: true,
    dryRun: true,
  });

  assert.equal(dryRunPlan.platform, platform);
  assert.equal(dryRunPlan.relativePath, relativePath);
  assert.equal(dryRunPlan.binaryName, binaryName);
  assert.equal(dryRunPlan.byteSize, 20);
  assert.equal(dryRunPlan.bundledReady, true);
  assert.equal(dryRunPlan.platformBundledReady, true);
  assert.equal(dryRunPlan.manifestBundledReady, false);
  assert.equal(dryRunPlan.writes.length, 0);
  assert.match(dryRunPlan.sha256, /^[a-f0-9]{64}$/u);
}

assert.throws(
  () => createAutoCutSpeechSidecarPlan({
    manifestPath,
    platform: 'windows-x86_64',
    sourcePath,
    acceptLicense: false,
  }),
  /confirm whisper\.cpp license obligations/u,
);

assert.throws(
  () => createAutoCutSpeechSidecarPlan({
    manifestPath,
    platform: '../windows-x86_64',
    sourcePath,
    acceptLicense: true,
  }),
  /Unsupported AutoCut speech sidecar platform/u,
);

const preparedPlan = prepareAutoCutSpeechSidecar({
  manifestPath,
  platform: 'windows-x86_64',
  sourcePath,
  acceptLicense: true,
});
const updatedManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const copiedSidecarPath = path.join(sidecarRoot, 'binaries', 'windows-x86_64', 'whisper-cli.exe');

assert.equal(updatedManifest.bundledReady, false);
assert.equal(preparedPlan.bundledReady, true);
assert.equal(preparedPlan.platformBundledReady, true);
assert.equal(preparedPlan.manifestBundledReady, false);
assert.equal(updatedManifest.platforms['windows-x86_64'].integrity.byteSize, 20);
assert.equal(updatedManifest.platforms['windows-x86_64'].integrity.sha256, preparedPlan.sha256);
assert.equal(updatedManifest.platforms['linux-x86_64'].integrity.byteSize, 0);
assert.equal(fs.readFileSync(copiedSidecarPath, 'utf8'), 'test whisper sidecar');
assert.equal(preparedPlan.writes.includes(copiedSidecarPath), true);
assert.match(
  formatAutoCutSpeechSidecarMessage(preparedPlan),
  /ok - autocut speech sidecar windows-x86_64 byteSize=20 sha256=/u,
);

const windowsRuntimeRoot = tempRoot('autocut-speech-sidecar-windows-runtime');
const windowsRuntimeManifestPath = writeManifest(windowsRuntimeRoot);
const windowsRuntimeSourceDir = path.join(windowsRuntimeRoot, 'source');
fs.mkdirSync(windowsRuntimeSourceDir, { recursive: true });
const windowsRuntimeSourcePath = writeSource(windowsRuntimeSourceDir, 'whisper-cli.exe', 'windows runtime cli');
writeSource(windowsRuntimeSourceDir, 'ggml.dll', 'windows runtime ggml');
writeSource(windowsRuntimeSourceDir, 'whisper.dll', 'windows runtime whisper');
writeSource(windowsRuntimeSourceDir, 'readme.txt', 'not a runtime companion');
const windowsRuntimePlan = prepareAutoCutSpeechSidecar({
  manifestPath: windowsRuntimeManifestPath,
  platform: 'windows-x86_64',
  sourcePath: windowsRuntimeSourcePath,
  acceptLicense: true,
});
const windowsRuntimeManifest = JSON.parse(fs.readFileSync(windowsRuntimeManifestPath, 'utf8'));
assert.deepEqual(
  windowsRuntimeManifest.platforms['windows-x86_64'].companionFiles.map((file) => file.relativePath),
  ['windows-x86_64/ggml.dll', 'windows-x86_64/whisper.dll'],
  'Windows whisper-cli preparation records required sibling runtime DLLs as verified companion files',
);
assert.equal(
  fs.readFileSync(path.join(windowsRuntimeRoot, 'binaries', 'windows-x86_64', 'ggml.dll'), 'utf8'),
  'windows runtime ggml',
);
assert.equal(
  fs.readFileSync(path.join(windowsRuntimeRoot, 'binaries', 'windows-x86_64', 'whisper.dll'), 'utf8'),
  'windows runtime whisper',
);
assert.equal(
  windowsRuntimePlan.companionFiles.length,
  2,
  'speech sidecar plan exposes companion file writes for release review',
);
assert.equal(
  windowsRuntimePlan.writes.includes(path.join(windowsRuntimeRoot, 'binaries', 'windows-x86_64', 'ggml.dll')),
  true,
);

const readyReport = assertAutoCutSpeechSidecarReadiness({
  manifestPath,
  platform: 'windows-x86_64',
});
assert.equal(readyReport.bundledReady, true);
assert.equal(readyReport.platformBundledReady, true);
assert.equal(readyReport.manifestBundledReady, false);
assert.equal(readyReport.allPlatformsBundledReady, false);
assert.equal(readyReport.sidecarPresent, true);
assert.equal(readyReport.placeholderIntegrity, false);
assert.equal(readyReport.integrityReady, true);
assert.equal(
  formatAutoCutSpeechSidecarReadinessMessage(readyReport),
  'ok - autocut speech sidecar readiness platform=windows-x86_64 bundledReady=true platformBundledReady=true manifestBundledReady=false sidecarPresent=true integrityReady=true',
);

const allPlatformsRoot = tempRoot('autocut-speech-sidecar-all-platforms');
const allPlatformsManifestPath = writeManifest(allPlatformsRoot);
for (const [platform, , binaryName] of platformSpecs) {
  prepareAutoCutSpeechSidecar({
    manifestPath: allPlatformsManifestPath,
    platform,
    sourcePath: writeSource(allPlatformsRoot, `${platform}-${binaryName}`, `test whisper sidecar ${platform}`),
    acceptLicense: true,
  });
}
const allPlatformsManifest = JSON.parse(fs.readFileSync(allPlatformsManifestPath, 'utf8'));
assert.equal(allPlatformsManifest.bundledReady, true);
const allPlatformsReport = assertAutoCutSpeechSidecarReadiness({
  manifestPath: allPlatformsManifestPath,
  platform: 'macos-aarch64',
});
assert.equal(allPlatformsReport.bundledReady, true);
assert.equal(allPlatformsReport.platformBundledReady, true);
assert.equal(allPlatformsReport.manifestBundledReady, true);
assert.equal(allPlatformsReport.allPlatformsBundledReady, true);

const missingSidecarRoot = tempRoot('autocut-speech-sidecar-missing');
const missingSidecarManifestPath = writeManifest(missingSidecarRoot, true);
const missingSidecarReport = createAutoCutSpeechSidecarReadinessReport({
  manifestPath: missingSidecarManifestPath,
  platform: 'windows-x86_64',
});
assert.equal(missingSidecarReport.manifestBundledReady, true);
assert.equal(missingSidecarReport.bundledReady, false);
assert.equal(missingSidecarReport.platformBundledReady, false);
assert.equal(missingSidecarReport.sidecarPresent, false);
assert.equal(missingSidecarReport.placeholderIntegrity, true);
assert.throws(
  () => assertAutoCutSpeechSidecarReadiness({
    manifestPath: missingSidecarManifestPath,
    platform: 'windows-x86_64',
  }),
  /bundledReady=true but windows-x86_64\/whisper-cli\.exe is missing/u,
);

const honestMissingRoot = tempRoot('autocut-speech-sidecar-honest-missing');
const honestMissingManifestPath = writeManifest(honestMissingRoot, false);
const honestMissingReport = assertAutoCutSpeechSidecarReadiness({
  manifestPath: honestMissingManifestPath,
  platform: 'windows-x86_64',
});
assert.equal(honestMissingReport.manifestBundledReady, false);
assert.equal(honestMissingReport.bundledReady, false);
assert.equal(honestMissingReport.platformBundledReady, false);
assert.equal(honestMissingReport.sidecarPresent, false);
assert.equal(honestMissingReport.blockers.length, 0);
assert.throws(
  () => assertAutoCutSpeechSidecarReadiness({
    manifestPath: honestMissingManifestPath,
    platform: 'windows-x86_64',
    requireBundled: true,
  }),
  /requires a bundled, integrity-verified whisper-cli sidecar/u,
);

const originalCwd = process.cwd();
try {
  process.chdir(path.join(originalCwd, 'packages', 'sdkwork-autocut-desktop'));
  const packageCwdPlan = createAutoCutSpeechSidecarPlan({
    platform: 'windows-x86_64',
    sourcePath,
    acceptLicense: true,
    dryRun: true,
  });
  assert.equal(
    packageCwdPlan.manifestPath,
    path.join(originalCwd, 'packages', 'sdkwork-autocut-desktop', 'src-tauri', 'binaries', 'speech-transcription.toolchain.json'),
    'speech sidecar preparation resolves the default manifest from the repository root even when run from the desktop package directory',
  );
} finally {
  process.chdir(originalCwd);
}

console.log('ok - autocut speech sidecar preparation contract');
