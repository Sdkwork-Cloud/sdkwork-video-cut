#!/usr/bin/env node

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function tempRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

process.env.SDKWORK_AUTOCUT_RELEASE_FFMPEG_LINUX_X86_64_SHA256 = sha256(Buffer.from('ffmpeg version test fixture'));

const {
  prepareAutoCutReleaseSidecars,
} = await import('./prepare-autocut-release-sidecars.mjs');

function writeManifestFixture(root) {
  const binariesRoot = path.join(root, 'packages', 'sdkwork-autocut-desktop', 'src-tauri', 'binaries');
  writeJson(path.join(binariesRoot, 'ffmpeg.toolchain.json'), {
    tool: 'ffmpeg',
    contractVersion: '2026-05-05.ffmpeg-toolchain.v1',
    bundledReady: false,
    requiredBinary: 'ffmpeg',
    license: {
      name: 'FFmpeg',
      spdxExpression: 'LGPL-2.1-or-later OR GPL-2.0-or-later',
      notice: 'Bundled FFmpeg sidecars must keep their upstream license notices.',
    },
    platforms: {
      'linux-x86_64': {
        relativePath: 'linux-x86_64/ffmpeg',
        binaryName: 'ffmpeg',
        integrity: {
          sha256: '0000000000000000000000000000000000000000000000000000000000000000',
          byteSize: 0,
        },
      },
    },
  });
  writeJson(path.join(binariesRoot, 'speech-transcription.toolchain.json'), {
    tool: 'whisper-cli',
    contractVersion: '2026-05-08.speech-toolchain.v1',
    bundledReady: false,
    requiredBinary: 'whisper-cli',
    license: {
      name: 'whisper.cpp',
      spdxExpression: 'MIT',
      notice: 'Bundled whisper.cpp sidecars must keep their upstream license notices.',
    },
    platforms: {
      'linux-x86_64': {
        relativePath: 'linux-x86_64/whisper-cli',
        binaryName: 'whisper-cli',
        integrity: {
          sha256: '0000000000000000000000000000000000000000000000000000000000000000',
          byteSize: 0,
        },
      },
    },
  });
  return binariesRoot;
}

const root = tempRoot('autocut-release-sidecars');
const cacheDir = path.join(root, 'cache');
const binariesRoot = writeManifestFixture(root);
const ffmpegBytes = Buffer.from('ffmpeg version test fixture');
const whisperBytes = Buffer.from('whisper cli test fixture');
const commandCalls = [];

const result = prepareAutoCutReleaseSidecars({
  rootDir: root,
  cacheDir,
  platform: 'linux-x86_64',
  acceptLicense: true,
  runCommand(command, args, options) {
    commandCalls.push({ command, args, cwd: options?.cwd });
    if (command === 'node') {
      const outputPath = args.at(-1);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, ffmpegBytes);
      return {
        status: 0,
        stdout: '',
        stderr: '',
      };
    }
    if (command === 'git') {
      const cloneDestination = args.at(-1);
      fs.mkdirSync(cloneDestination, { recursive: true });
      fs.mkdirSync(path.join(cloneDestination, '.git'), { recursive: true });
      return {
        status: 0,
        stdout: '',
        stderr: '',
      };
    }
    if (command === 'cmake' && args[0] === '--build') {
      const buildDir = args[1];
      const executablePath = path.join(buildDir, 'bin', 'whisper-cli');
      fs.mkdirSync(path.dirname(executablePath), { recursive: true });
      fs.writeFileSync(executablePath, whisperBytes);
      return {
        status: 0,
        stdout: '',
        stderr: '',
      };
    }
    if (command === 'cmake') {
      return {
        status: 0,
        stdout: '',
        stderr: '',
      };
    }
    return {
      status: 1,
      stdout: '',
      stderr: `unexpected command ${command}`,
    };
  },
});

assert.equal(result.platform, 'linux-x86_64');
assert.equal(result.ffmpeg.plan.sha256, sha256(ffmpegBytes));
assert.equal(result.speech.plan.sha256, sha256(whisperBytes));
assert.equal(commandCalls.some((call) => call.command === 'git' && call.args.includes('--branch') && call.args.includes('v1.8.4')), true);
assert.equal(commandCalls.some((call) => call.command === 'cmake' && call.args.includes('--target') && call.args.includes('whisper-cli')), true);
assert.equal(fs.readFileSync(path.join(binariesRoot, 'linux-x86_64', 'ffmpeg')).equals(ffmpegBytes), true);
assert.equal(fs.readFileSync(path.join(binariesRoot, 'linux-x86_64', 'whisper-cli')).equals(whisperBytes), true);
if (process.platform !== 'win32') {
  assert.equal((fs.statSync(path.join(binariesRoot, 'linux-x86_64', 'ffmpeg')).mode & 0o111) !== 0, true);
  assert.equal((fs.statSync(path.join(binariesRoot, 'linux-x86_64', 'whisper-cli')).mode & 0o111) !== 0, true);
}

const ffmpegManifest = JSON.parse(fs.readFileSync(path.join(binariesRoot, 'ffmpeg.toolchain.json'), 'utf8'));
const speechManifest = JSON.parse(fs.readFileSync(path.join(binariesRoot, 'speech-transcription.toolchain.json'), 'utf8'));
assert.equal(ffmpegManifest.platforms['linux-x86_64'].integrity.sha256, sha256(ffmpegBytes));
assert.equal(speechManifest.platforms['linux-x86_64'].integrity.sha256, sha256(whisperBytes));

assert.throws(
  () =>
    prepareAutoCutReleaseSidecars({
      rootDir: root,
      cacheDir,
      platform: 'linux-x86_64',
    }),
  /requires --accept-license/u,
);

console.log('ok - autocut release sidecar preparation contract');
