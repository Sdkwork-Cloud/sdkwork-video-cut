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
import {
  createAutoCutHostPlatformKey,
  normalizeAutoCutReleasePlatform,
} from './autocut-release-platforms.mjs';

export { createAutoCutHostPlatformKey };

const __filename = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(__filename), '..');
const defaultManifestRelativePath = path.join(
  'packages',
  'sdkwork-autocut-desktop',
  'src-tauri',
  'binaries',
  'speech-transcription.toolchain.json',
);
const defaultManifestPath = path.join(repositoryRoot, defaultManifestRelativePath);

export function createAutoCutSpeechSidecarPlan({
  manifestPath = defaultManifestPath,
  platform,
  sourcePath,
  acceptLicense = false,
  dryRun = false,
} = {}) {
  const normalizedPlatform = normalizePlatform(platform);
  if (!acceptLicense) {
    throw new Error(
      'AutoCut speech sidecar preparation requires --accept-license to confirm whisper.cpp license obligations.',
    );
  }

  const resolvedManifestPath = path.resolve(manifestPath);
  const resolvedSourcePath = path.resolve(requiredString(sourcePath, '--source'));
  const manifest = readManifest(resolvedManifestPath);
  validateManifest(manifest);

  const platformEntry = manifest.platforms?.[normalizedPlatform];
  if (!platformEntry) {
    throw new Error(`speech toolchain manifest has no platform entry for ${normalizedPlatform}.`);
  }
  validateRelativePath(platformEntry.relativePath);
  const sidecarRoot = path.dirname(resolvedManifestPath);
  const destinationPath = path.resolve(sidecarRoot, platformEntry.relativePath);
  assertInsideDirectory(destinationPath, sidecarRoot);
  const destinationDirectory = path.dirname(destinationPath);
  const platformRelativeDirectory = path.posix.dirname(toManifestRelativePath(platformEntry.relativePath));

  const sourceStat = fs.statSync(resolvedSourcePath);
  if (!sourceStat.isFile()) {
    throw new Error(`AutoCut speech sidecar source is not a file: ${resolvedSourcePath}`);
  }
  const bytes = fs.readFileSync(resolvedSourcePath);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const byteSize = bytes.length;
  const companionFiles = discoverAutoCutSpeechSidecarCompanionFiles({
    platform: normalizedPlatform,
    sourcePath: resolvedSourcePath,
    destinationDirectory,
    platformRelativeDirectory,
    sidecarRoot,
  });
  const nextManifest = structuredClone(manifest);
  nextManifest.platforms[normalizedPlatform].integrity = {
    sha256,
    byteSize,
  };
  nextManifest.platforms[normalizedPlatform].companionFiles = companionFiles.map((file) => ({
    relativePath: file.relativePath,
    integrity: file.integrity,
  }));
  nextManifest.bundledReady = allPlatformsIntegrityReady(nextManifest);

  return {
    manifestPath: resolvedManifestPath,
    platform: normalizedPlatform,
    sourcePath: resolvedSourcePath,
    destinationPath,
    relativePath: platformEntry.relativePath,
    binaryName: platformEntry.binaryName,
    sha256,
    byteSize,
    companionFiles,
    bundledReady: true,
    platformBundledReady: true,
    manifestBundledReady: Boolean(nextManifest.bundledReady),
    allPlatformsBundledReady: Boolean(nextManifest.bundledReady),
    dryRun,
    manifest: nextManifest,
    writes: dryRun
      ? []
      : [
          destinationPath,
          ...companionFiles.map((file) => file.destinationPath),
          resolvedManifestPath,
        ],
  };
}

export function prepareAutoCutSpeechSidecar(options = {}) {
  const plan = createAutoCutSpeechSidecarPlan(options);
  if (!plan.dryRun) {
    fs.mkdirSync(path.dirname(plan.destinationPath), { recursive: true });
    fs.copyFileSync(plan.sourcePath, plan.destinationPath);
    for (const companionFile of plan.companionFiles) {
      fs.mkdirSync(path.dirname(companionFile.destinationPath), { recursive: true });
      fs.copyFileSync(companionFile.sourcePath, companionFile.destinationPath);
    }
    fs.writeFileSync(`${plan.manifestPath}.tmp`, `${JSON.stringify(plan.manifest, null, 2)}\n`);
    fs.renameSync(`${plan.manifestPath}.tmp`, plan.manifestPath);
  }
  return plan;
}

export function createAutoCutSpeechSidecarReadinessReport({
  rootDir = repositoryRoot,
  manifestPath = defaultManifestRelativePath,
  platform,
  requireBundled = false,
} = {}) {
  const normalizedPlatform = normalizePlatform(platform ?? createAutoCutHostPlatformKey());
  const resolvedRootDir = path.resolve(rootDir);
  const resolvedManifestPath = path.isAbsolute(manifestPath)
    ? path.resolve(manifestPath)
    : path.resolve(resolvedRootDir, manifestPath);
  const manifest = readManifest(resolvedManifestPath);
  validateManifest(manifest);
  const platformEntry = manifest.platforms?.[normalizedPlatform];
  if (!platformEntry) {
    throw new Error(`speech toolchain manifest has no platform entry for ${normalizedPlatform}.`);
  }
  validateRelativePath(platformEntry.relativePath);

  const sidecarRoot = path.dirname(resolvedManifestPath);
  const sidecarPath = path.resolve(sidecarRoot, platformEntry.relativePath);
  assertInsideDirectory(sidecarPath, sidecarRoot);
  const sidecarPresent = fs.existsSync(sidecarPath) && fs.statSync(sidecarPath).isFile();
  const integrity = normalizeIntegrity(platformEntry.integrity);
  const placeholderIntegrity = isPlaceholderIntegrity(integrity);
  const integrityReady = sidecarPresent && !placeholderIntegrity && verifySidecarIntegrity(sidecarPath, integrity);
  const companionFiles = normalizeCompanionFileReports(platformEntry.companionFiles, sidecarRoot);
  const companionFilesReady = companionFiles.every((file) => file.present && file.integrityReady);
  const platformBundledReady = Boolean(sidecarPresent && integrityReady && companionFilesReady);
  const allPlatformsBundledReady = allPlatformsIntegrityReady(manifest);
  const blockers = [];

  if (manifest.bundledReady && !sidecarPresent) {
    blockers.push(`bundledReady=true but ${platformEntry.relativePath} is missing.`);
  }
  if (manifest.bundledReady && placeholderIntegrity) {
    blockers.push('bundledReady=true but speech sidecar integrity is still the placeholder zero hash/size.');
  }
  if (manifest.bundledReady && sidecarPresent && !integrityReady) {
    blockers.push(`bundledReady=true but ${platformEntry.relativePath} does not match manifest integrity.`);
  }
  for (const companionFile of companionFiles) {
    if (manifest.bundledReady && !companionFile.present) {
      blockers.push(`bundledReady=true but speech sidecar companion ${companionFile.relativePath} is missing.`);
    }
    if (manifest.bundledReady && companionFile.placeholderIntegrity) {
      blockers.push(`bundledReady=true but speech sidecar companion ${companionFile.relativePath} integrity is still the placeholder zero hash/size.`);
    }
    if (manifest.bundledReady && companionFile.present && !companionFile.integrityReady) {
      blockers.push(`bundledReady=true but speech sidecar companion ${companionFile.relativePath} does not match manifest integrity.`);
    }
  }
  if (requireBundled && !platformBundledReady) {
    blockers.push(
      `tauri build requires a bundled, integrity-verified whisper-cli sidecar for ${normalizedPlatform}; run pnpm prepare:speech-sidecar -- --platform ${normalizedPlatform} --source <path-to-whisper-cli> --accept-license before packaging.`,
    );
  }

  return {
    platform: normalizedPlatform,
    manifestPath: resolvedManifestPath,
    sidecarPath,
    bundledReady: platformBundledReady,
    platformBundledReady,
    manifestBundledReady: Boolean(manifest.bundledReady),
    allPlatformsBundledReady,
    sidecarPresent,
    placeholderIntegrity,
    integrityReady,
    companionFiles,
    companionFilesReady,
    requireBundled: Boolean(requireBundled),
    blockers,
  };
}

export function assertAutoCutSpeechSidecarReadiness(options = {}) {
  const report = createAutoCutSpeechSidecarReadinessReport(options);
  if (report.blockers.length > 0) {
    throw new Error(`AutoCut speech sidecar readiness failed: ${report.blockers.join(' ')}`);
  }
  return report;
}

export function formatAutoCutSpeechSidecarMessage(plan) {
  const mode = plan.dryRun ? ' dryRun=true' : '';
  return `ok - autocut speech sidecar ${plan.platform} byteSize=${plan.byteSize} sha256=${plan.sha256}${mode}`;
}

export function formatAutoCutSpeechSidecarReadinessMessage(report) {
  return [
    `ok - autocut speech sidecar readiness platform=${report.platform}`,
    `bundledReady=${report.bundledReady}`,
    `platformBundledReady=${report.platformBundledReady}`,
    `manifestBundledReady=${report.manifestBundledReady}`,
    `sidecarPresent=${report.sidecarPresent}`,
    `integrityReady=${report.integrityReady}`,
  ].join(' ');
}

function readManifest(manifestPath) {
  const source = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(source);
  if (manifest.tool !== 'whisper-cli') {
    throw new Error('speech toolchain manifest must declare tool "whisper-cli".');
  }
  return manifest;
}

function validateManifest(manifest) {
  if (typeof manifest.contractVersion !== 'string' || manifest.contractVersion.trim() === '') {
    throw new Error('speech toolchain manifest contractVersion must be non-empty.');
  }
  if (
    typeof manifest.license?.name !== 'string' ||
    typeof manifest.license?.spdxExpression !== 'string' ||
    typeof manifest.license?.notice !== 'string' ||
    manifest.license.name.trim() === '' ||
    manifest.license.spdxExpression.trim() === '' ||
    manifest.license.notice.trim() === ''
  ) {
    throw new Error('speech toolchain manifest license metadata must be complete.');
  }
  for (const [platformKey, platformEntry] of Object.entries(manifest.platforms ?? {})) {
    for (const companionFile of platformEntry?.companionFiles ?? []) {
      validateRelativePath(companionFile.relativePath);
      const integrity = normalizeIntegrity(companionFile.integrity);
      if (integrity.sha256.length !== 64 || !/^[a-f0-9]+$/u.test(integrity.sha256)) {
        throw new Error(`speech sidecar companion ${platformKey}/${companionFile.relativePath} sha256 must be a 64 character hex digest.`);
      }
    }
  }
}

function normalizeIntegrity(integrity) {
  return {
    sha256: String(integrity?.sha256 ?? '').toLowerCase(),
    byteSize: Number(integrity?.byteSize ?? 0),
  };
}

function isPlaceholderIntegrity(integrity) {
  return integrity.byteSize <= 0 ||
    integrity.sha256 === '0000000000000000000000000000000000000000000000000000000000000000';
}

function allPlatformsIntegrityReady(manifest) {
  const platforms = Object.values(manifest.platforms ?? {});
  return platforms.length > 0 && platforms.every((platform) => {
    const integrity = normalizeIntegrity(platform?.integrity);
    const companionFiles = platform?.companionFiles ?? [];
    return !isPlaceholderIntegrity(integrity) &&
      companionFiles.every((file) => !isPlaceholderIntegrity(normalizeIntegrity(file?.integrity)));
  });
}

function verifySidecarIntegrity(sidecarPath, integrity) {
  const bytes = fs.readFileSync(sidecarPath);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  return bytes.length === integrity.byteSize && sha256 === integrity.sha256;
}

function discoverAutoCutSpeechSidecarCompanionFiles({
  platform,
  sourcePath,
  destinationDirectory,
  platformRelativeDirectory,
  sidecarRoot,
}) {
  const sourceDirectory = path.dirname(sourcePath);
  return fs.readdirSync(sourceDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .filter((entry) => isAutoCutSpeechSidecarCompanionFile(platform, entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      validateCompanionFileName(entry.name);
      const companionSourcePath = path.join(sourceDirectory, entry.name);
      const companionDestinationPath = path.join(destinationDirectory, entry.name);
      assertInsideDirectory(companionDestinationPath, sidecarRoot);
      const companionBytes = fs.readFileSync(companionSourcePath);
      return {
        sourcePath: companionSourcePath,
        destinationPath: companionDestinationPath,
        relativePath: toManifestRelativePath(platformRelativeDirectory, entry.name),
        integrity: {
          sha256: crypto.createHash('sha256').update(companionBytes).digest('hex'),
          byteSize: companionBytes.length,
        },
      };
    });
}

function isAutoCutSpeechSidecarCompanionFile(platform, fileName) {
  const lowerName = fileName.toLowerCase();
  if (platform === 'windows-x86_64') {
    return lowerName.endsWith('.dll');
  }
  if (platform === 'linux-x86_64') {
    return lowerName.includes('.so');
  }
  if (platform === 'macos-x86_64' || platform === 'macos-aarch64') {
    return lowerName.endsWith('.dylib');
  }
  return false;
}

function normalizeCompanionFileReports(companionFiles, sidecarRoot) {
  return (companionFiles ?? []).map((file) => {
    validateRelativePath(file.relativePath);
    const filePath = path.resolve(sidecarRoot, file.relativePath);
    assertInsideDirectory(filePath, sidecarRoot);
    const integrity = normalizeIntegrity(file.integrity);
    const placeholderIntegrity = isPlaceholderIntegrity(integrity);
    const present = fs.existsSync(filePath) && fs.statSync(filePath).isFile();
    const integrityReady = present && !placeholderIntegrity && verifySidecarIntegrity(filePath, integrity);
    return {
      relativePath: file.relativePath,
      path: filePath,
      present,
      placeholderIntegrity,
      integrityReady,
      integrity,
    };
  });
}

function toManifestRelativePath(...segments) {
  return segments
    .join('/')
    .split(/[\\/]/u)
    .filter((segment) => segment.length > 0 && segment !== '.')
    .join('/');
}

function normalizePlatform(platform) {
  const value = requiredString(platform, '--platform');
  try {
    return normalizeAutoCutReleasePlatform(value);
  } catch (error) {
    if (error instanceof Error && error.message.includes('is ambiguous; use macos-x86_64 or macos-aarch64')) {
      throw error;
    }
    throw new Error(`Unsupported AutoCut speech sidecar platform: ${value}`);
  }
}

function validateRelativePath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.trim() === '') {
    throw new Error('speech sidecar relativePath must be non-empty.');
  }
  if (
    path.isAbsolute(relativePath) ||
    relativePath.includes('..') ||
    relativePath.split(/[\\/]/u).some((segment) => segment.trim() === '')
  ) {
    throw new Error(`speech sidecar relativePath must be safe: ${relativePath}`);
  }
}

function validateCompanionFileName(fileName) {
  if (
    typeof fileName !== 'string' ||
    fileName.trim() === '' ||
    fileName.includes('/') ||
    fileName.includes('\\') ||
    fileName.includes('..')
  ) {
    throw new Error(`speech sidecar companion file name must be safe: ${fileName}`);
  }
}

function assertInsideDirectory(candidatePath, rootPath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`AutoCut speech sidecar destination escapes binaries directory: ${candidatePath}`);
  }
}

function requiredString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`AutoCut speech sidecar preparation requires ${name}.`);
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
    } else if (arg === '--check') {
      options.check = true;
    } else if (arg === '--require-bundled') {
      options.requireBundled = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--platform') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut speech sidecar preparation',
      });
      options.platform = option.value;
      index = option.nextIndex;
    } else if (arg === '--source') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut speech sidecar preparation',
      });
      options.sourcePath = option.value;
      index = option.nextIndex;
    } else if (arg === '--manifest') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut speech sidecar preparation',
      });
      options.manifestPath = option.value;
      index = option.nextIndex;
    } else {
      throw new Error(`Unknown AutoCut speech sidecar preparation argument: ${arg}`);
    }
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.check) {
    const report = assertAutoCutSpeechSidecarReadiness(options);
    console.log(formatAutoCutSpeechSidecarReadinessMessage(report));
    return;
  }

  const plan = prepareAutoCutSpeechSidecar(options);
  console.log(formatAutoCutSpeechSidecarMessage(plan));
}

if (path.resolve(process.argv[1] ?? '') === __filename) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
