#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  normalizeAutoCutCliArgs,
  readAutoCutCliOptionValue,
} from './autocut-cli-args.mjs';

const __filename = fileURLToPath(import.meta.url);
const defaultManifestRelativePath =
  'packages/sdkwork-autocut-desktop/src-tauri/binaries/ffmpeg.toolchain.json';
const allowedPlatforms = new Set([
  'windows-x86_64',
  'linux-x86_64',
  'macos-x86_64',
  'macos-aarch64',
]);

export function createAutoCutReleaseSmokePreflightReport({
  rootDir = process.cwd(),
  platform = hostPlatformKey(),
  requireBundled = false,
  skipExecutableSmoke = false,
  runCommand = runAutoCutReleaseSmokeCommand,
} = {}) {
  const normalizedPlatform = normalizePlatform(platform);
  const resolvedRootDir = path.resolve(rootDir);
  const manifestPath = path.join(resolvedRootDir, defaultManifestRelativePath);
  const manifest = readManifest(manifestPath);
  const platformEntry = manifest.platforms?.[normalizedPlatform];
  if (!platformEntry) {
    throw new Error(`FFmpeg toolchain manifest has no platform entry for ${normalizedPlatform}.`);
  }

  const sidecarPath = path.resolve(path.dirname(manifestPath), platformEntry.relativePath);
  assertInsideDirectory(sidecarPath, path.dirname(manifestPath));
  const sidecarPresent = fs.existsSync(sidecarPath) && fs.statSync(sidecarPath).isFile();
  const integrityReady = sidecarPresent && verifyIntegrity(sidecarPath, platformEntry);

  if (requireBundled && (!manifest.bundledReady || !sidecarPresent || !integrityReady)) {
    throw new Error(
      `AutoCut release smoke preflight requires a bundled FFmpeg sidecar for ${normalizedPlatform}.`,
    );
  }

  let executableSmokeReady = 'skipped';
  if (!skipExecutableSmoke && sidecarPresent && integrityReady) {
    const versionOutput = runCommand(sidecarPath, ['-version']);
    executableSmokeReady = versionOutput.includes('ffmpeg version');
    if (!executableSmokeReady) {
      throw new Error(`Bundled FFmpeg sidecar did not report an ffmpeg version: ${versionOutput}`);
    }
  }

  return {
    platform: normalizedPlatform,
    manifestPath,
    manifestReady: true,
    sidecarPath,
    sidecarPresent,
    integrityReady,
    bundledReady: Boolean(manifest.bundledReady && sidecarPresent && integrityReady),
    executableSmokeReady,
    ffmpegExecutionReady: Boolean(
      manifest.bundledReady &&
        sidecarPresent &&
        integrityReady &&
        executableSmokeReady === true
    ),
    releaseSmokeReady: !requireBundled || Boolean(manifest.bundledReady && sidecarPresent && integrityReady),
  };
}

export function formatAutoCutReleaseSmokePreflightMessage(report) {
  return [
    `ok - autocut release smoke preflight platform=${report.platform}`,
    `bundledReady=${report.bundledReady}`,
    `integrityReady=${report.integrityReady}`,
    `executableSmokeReady=${report.executableSmokeReady}`,
    `ffmpegExecutionReady=${report.ffmpegExecutionReady}`,
  ].join(' ');
}

export function runAutoCutReleaseSmokeCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  if (result.error) {
    throw new Error(`run AutoCut release smoke command failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
    throw new Error(`run AutoCut release smoke command failed: ${detail}`);
  }
  return `${result.stdout}\n${result.stderr}`.trim();
}

function readManifest(manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.tool !== 'ffmpeg') {
    throw new Error('FFmpeg toolchain manifest must declare tool "ffmpeg".');
  }
  if (manifest.bundledReady && manifest.ffmpegExecutionReady === true) {
    throw new Error('FFmpeg sidecar readiness must not imply ffmpegExecutionReady.');
  }
  return manifest;
}

function verifyIntegrity(sidecarPath, platformEntry) {
  const bytes = fs.readFileSync(sidecarPath);
  const actualByteSize = bytes.length;
  const actualSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  return (
    actualByteSize === platformEntry.integrity?.byteSize &&
    actualSha256 === String(platformEntry.integrity?.sha256 ?? '').toLowerCase()
  );
}

function hostPlatformKey() {
  const osKey = process.platform === 'darwin' ? 'macos' : process.platform;
  const archKey = process.arch === 'x64' ? 'x86_64' : process.arch;
  return `${osKey}-${archKey}`;
}

function normalizePlatform(platform) {
  if (typeof platform !== 'string' || platform.trim() === '') {
    throw new Error('AutoCut release smoke preflight requires --platform.');
  }
  const normalized = platform.trim();
  if (!allowedPlatforms.has(normalized)) {
    throw new Error(`Unsupported AutoCut release smoke platform: ${normalized}`);
  }
  return normalized;
}

function assertInsideDirectory(candidatePath, rootPath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`AutoCut FFmpeg sidecar path escapes binaries directory: ${candidatePath}`);
  }
}

function parseArgs(argv) {
  const options = {};
  const args = normalizeAutoCutCliArgs(argv);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--platform') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut release smoke preflight',
      });
      options.platform = option.value;
      index = option.nextIndex;
    } else if (arg === '--require-bundled') {
      options.requireBundled = true;
    } else if (arg === '--skip-executable-smoke') {
      options.skipExecutableSmoke = true;
    } else {
      throw new Error(`Unknown AutoCut release smoke preflight argument: ${arg}`);
    }
  }
  return options;
}

function main() {
  const report = createAutoCutReleaseSmokePreflightReport(parseArgs(process.argv.slice(2)));
  console.log(formatAutoCutReleaseSmokePreflightMessage(report));
}

if (path.resolve(process.argv[1] ?? '') === __filename) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
