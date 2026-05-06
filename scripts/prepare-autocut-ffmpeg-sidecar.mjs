#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  normalizeAutoCutCliArgs,
  readAutoCutCliOptionValue,
} from './autocut-cli-args.mjs';

const __filename = fileURLToPath(import.meta.url);
const allowedPlatforms = new Set([
  'windows-x86_64',
  'linux-x86_64',
  'macos-x86_64',
  'macos-aarch64',
]);
const defaultManifestPath = path.join(
  process.cwd(),
  'packages',
  'sdkwork-autocut-desktop',
  'src-tauri',
  'binaries',
  'ffmpeg.toolchain.json',
);

export function createAutoCutFfmpegSidecarPlan({
  manifestPath = defaultManifestPath,
  platform,
  sourcePath,
  acceptLicense = false,
  dryRun = false,
} = {}) {
  const normalizedPlatform = normalizePlatform(platform);
  if (!acceptLicense) {
    throw new Error(
      'AutoCut FFmpeg sidecar preparation requires --accept-license to confirm FFmpeg license obligations.',
    );
  }

  const resolvedManifestPath = path.resolve(manifestPath);
  const resolvedSourcePath = path.resolve(requiredString(sourcePath, '--source'));
  const manifest = readManifest(resolvedManifestPath);
  validateManifest(manifest);

  const platformEntry = manifest.platforms?.[normalizedPlatform];
  if (!platformEntry) {
    throw new Error(`FFmpeg toolchain manifest has no platform entry for ${normalizedPlatform}.`);
  }
  validateRelativePath(platformEntry.relativePath);
  const sidecarRoot = path.dirname(resolvedManifestPath);
  const destinationPath = path.resolve(sidecarRoot, platformEntry.relativePath);
  assertInsideDirectory(destinationPath, sidecarRoot);

  const sourceStat = fs.statSync(resolvedSourcePath);
  if (!sourceStat.isFile()) {
    throw new Error(`AutoCut FFmpeg sidecar source is not a file: ${resolvedSourcePath}`);
  }
  const bytes = fs.readFileSync(resolvedSourcePath);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const byteSize = bytes.length;
  const nextManifest = structuredClone(manifest);
  nextManifest.bundledReady = true;
  nextManifest.platforms[normalizedPlatform].integrity = {
    sha256,
    byteSize,
  };

  return {
    manifestPath: resolvedManifestPath,
    platform: normalizedPlatform,
    sourcePath: resolvedSourcePath,
    destinationPath,
    relativePath: platformEntry.relativePath,
    binaryName: platformEntry.binaryName,
    sha256,
    byteSize,
    bundledReady: true,
    dryRun,
    manifest: nextManifest,
    writes: dryRun ? [] : [destinationPath, resolvedManifestPath],
  };
}

export function prepareAutoCutFfmpegSidecar(options = {}) {
  const plan = createAutoCutFfmpegSidecarPlan(options);
  if (!plan.dryRun) {
    fs.mkdirSync(path.dirname(plan.destinationPath), { recursive: true });
    fs.copyFileSync(plan.sourcePath, plan.destinationPath);
    fs.writeFileSync(`${plan.manifestPath}.tmp`, `${JSON.stringify(plan.manifest, null, 2)}\n`);
    fs.renameSync(`${plan.manifestPath}.tmp`, plan.manifestPath);
  }
  return plan;
}

export function formatAutoCutFfmpegSidecarMessage(plan) {
  const mode = plan.dryRun ? ' dryRun=true' : '';
  return `ok - autocut ffmpeg sidecar ${plan.platform} byteSize=${plan.byteSize} sha256=${plan.sha256}${mode}`;
}

function readManifest(manifestPath) {
  const source = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(source);
  if (manifest.tool !== 'ffmpeg') {
    throw new Error('FFmpeg toolchain manifest must declare tool "ffmpeg".');
  }
  return manifest;
}

function validateManifest(manifest) {
  if (typeof manifest.contractVersion !== 'string' || manifest.contractVersion.trim() === '') {
    throw new Error('FFmpeg toolchain manifest contractVersion must be non-empty.');
  }
  if (
    typeof manifest.license?.name !== 'string' ||
    typeof manifest.license?.spdxExpression !== 'string' ||
    typeof manifest.license?.notice !== 'string' ||
    manifest.license.name.trim() === '' ||
    manifest.license.spdxExpression.trim() === '' ||
    manifest.license.notice.trim() === ''
  ) {
    throw new Error('FFmpeg toolchain manifest license metadata must be complete.');
  }
}

function normalizePlatform(platform) {
  const value = requiredString(platform, '--platform');
  if (!allowedPlatforms.has(value)) {
    throw new Error(`Unsupported AutoCut FFmpeg sidecar platform: ${value}`);
  }
  return value;
}

function validateRelativePath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.trim() === '') {
    throw new Error('FFmpeg sidecar relativePath must be non-empty.');
  }
  if (
    path.isAbsolute(relativePath) ||
    relativePath.includes('..') ||
    relativePath.split(/[\\/]/u).some((segment) => segment.trim() === '')
  ) {
    throw new Error(`FFmpeg sidecar relativePath must be safe: ${relativePath}`);
  }
}

function assertInsideDirectory(candidatePath, rootPath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`AutoCut FFmpeg sidecar destination escapes binaries directory: ${candidatePath}`);
  }
}

function requiredString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`AutoCut FFmpeg sidecar preparation requires ${name}.`);
  }
  return value.trim();
}

function parseArgs(argv) {
  const options = {};
  const args = normalizeAutoCutCliArgs(argv);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--accept-license') {
      options.acceptLicense = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--platform') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut FFmpeg sidecar preparation',
      });
      options.platform = option.value;
      index = option.nextIndex;
    } else if (arg === '--source') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut FFmpeg sidecar preparation',
      });
      options.sourcePath = option.value;
      index = option.nextIndex;
    } else if (arg === '--manifest') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut FFmpeg sidecar preparation',
      });
      options.manifestPath = option.value;
      index = option.nextIndex;
    } else {
      throw new Error(`Unknown AutoCut FFmpeg sidecar preparation argument: ${arg}`);
    }
  }
  return options;
}

function main() {
  const plan = prepareAutoCutFfmpegSidecar(parseArgs(process.argv.slice(2)));
  console.log(formatAutoCutFfmpegSidecarMessage(plan));
}

if (path.resolve(process.argv[1] ?? '') === __filename) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
