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
  createAutoCutReleaseInstallerSpecs,
  normalizeAutoCutReleasePlatform,
} from './autocut-release-platforms.mjs';
import { createAutoCutReleaseSmokePreflightReport } from './check-autocut-release-smoke-preflight.mjs';

const __filename = fileURLToPath(import.meta.url);
const evidenceSchemaVersion = '2026-05-05.autocut-release-evidence.v1';
const desktopPackageRelativePath = 'packages/sdkwork-autocut-desktop';
const manifestRelativePath = `${desktopPackageRelativePath}/src-tauri/binaries/ffmpeg.toolchain.json`;
const defaultOutputRelativePath = 'artifacts/release/autocut-release-evidence.json';
const nativeReleaseSmokeRelativePath = 'artifacts/release/autocut-native-release-smoke.json';
const installerSignatureEvidenceRelativePath = 'artifacts/release/autocut-installer-signature-evidence.json';
const smartSliceQualityEvidenceRelativePath = 'artifacts/release/autocut-smart-slice-quality-evidence.json';
const smartSliceMediaArtifactsEvidenceRelativePath = 'artifacts/release/autocut-smart-slice-media-artifacts-evidence.json';

export function createAutoCutReleaseEvidence({
  rootDir = process.cwd(),
  platform = 'windows-x86_64',
  generatedAt = new Date().toISOString(),
  skipExecutableSmoke = false,
  runPreflightCommand,
} = {}) {
  const resolvedRootDir = path.resolve(rootDir);
  const normalizedPlatform = normalizeAutoCutReleasePlatform(platform);
  const manifestPath = path.join(resolvedRootDir, manifestRelativePath);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const preflight = createAutoCutReleaseSmokePreflightReport({
    rootDir: resolvedRootDir,
    platform: normalizedPlatform,
    requireBundled: false,
    skipExecutableSmoke,
    ...(runPreflightCommand ? { runCommand: runPreflightCommand } : {}),
  });
  const nativeReleaseSmoke = readNativeReleaseSmokeEvidence(resolvedRootDir);
  const smartSliceQuality = readSmartSliceQualityEvidence(resolvedRootDir);
  const smartSliceMediaArtifacts = readSmartSliceMediaArtifactsEvidence(resolvedRootDir);
  const installerSignature = readInstallerSignatureEvidence(resolvedRootDir);
  const installers = readReleaseInstallers(resolvedRootDir, normalizedPlatform);
  const ffmpegExecutionReady = Boolean(
    preflight.ffmpegExecutionReady &&
      preflight.bundledReady &&
      preflight.speechSidecar?.bundledReady &&
      preflight.executableSmokeReady === true &&
      nativeReleaseSmoke.ready &&
      smartSliceQuality.ready &&
      smartSliceMediaArtifacts.ready &&
      installerSignature.ready &&
      preflight.releaseSmokeReady
  );

  return {
    schemaVersion: evidenceSchemaVersion,
    generatedAt,
    platform: normalizedPlatform,
    product: {
      name: 'SDKWork Video Cut',
      packageName: '@sdkwork/video-cut',
      desktopPackageName: '@sdkwork/autocut-desktop',
    },
    readiness: {
      ffmpegExecutionReady,
      ffmpegBundledReady: preflight.bundledReady,
      speechBundledReady: preflight.speechSidecar.bundledReady,
      releaseSmokeReady: preflight.releaseSmokeReady,
      nativeReleaseSmokeReady: nativeReleaseSmoke.ready,
      nativeVideoSliceSmokeReady: nativeReleaseSmoke.videoSliceReady,
      smartSliceQualityReady: smartSliceQuality.ready,
      smartSliceMediaArtifactsReady: smartSliceMediaArtifacts.ready,
      installerSignatureReady: installerSignature.ready,
    },
    preflight: {
      manifestReady: preflight.manifestReady,
      sidecarPresent: preflight.sidecarPresent,
      integrityReady: preflight.integrityReady,
      bundledReady: preflight.bundledReady,
      executableSmokeReady: preflight.executableSmokeReady,
      releaseSmokeReady: preflight.releaseSmokeReady,
      ffmpegExecutionReady: preflight.ffmpegExecutionReady,
      speechSidecar: {
        platform: preflight.speechSidecar.platform,
        sidecarPresent: preflight.speechSidecar.sidecarPresent,
        integrityReady: preflight.speechSidecar.integrityReady,
        bundledReady: preflight.speechSidecar.bundledReady,
        platformBundledReady: preflight.speechSidecar.platformBundledReady,
        manifestBundledReady: preflight.speechSidecar.manifestBundledReady,
      },
    },
    ffmpegManifest: {
      path: toPosixRelative(resolvedRootDir, manifestPath),
      contractVersion: manifest.contractVersion,
      bundledReady: Boolean(manifest.bundledReady),
      requiredBinary: manifest.requiredBinary,
      platform: {
        key: normalizedPlatform,
        relativePath: manifest.platforms?.[normalizedPlatform]?.relativePath ?? '',
        binaryName: manifest.platforms?.[normalizedPlatform]?.binaryName ?? '',
        sha256: manifest.platforms?.[normalizedPlatform]?.integrity?.sha256 ?? '',
        byteSize: manifest.platforms?.[normalizedPlatform]?.integrity?.byteSize ?? 0,
      },
    },
    nativeReleaseSmoke,
    smartSliceQuality,
    smartSliceMediaArtifacts,
    installerSignature,
    installers,
  };
}

export function writeAutoCutReleaseEvidence({
  rootDir = process.cwd(),
  outputPath,
  ...options
} = {}) {
  const resolvedRootDir = path.resolve(rootDir);
  const evidence = createAutoCutReleaseEvidence({
    rootDir: resolvedRootDir,
    ...options,
  });
  const resolvedOutputPath = path.resolve(
    outputPath ?? path.join(resolvedRootDir, defaultOutputRelativePath),
  );
  fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  fs.writeFileSync(`${resolvedOutputPath}.tmp`, `${JSON.stringify(evidence, null, 2)}\n`);
  fs.renameSync(`${resolvedOutputPath}.tmp`, resolvedOutputPath);
  return {
    outputPath: resolvedOutputPath,
    evidence,
  };
}

export function formatAutoCutReleaseEvidenceMessage(result) {
  return `ok - autocut release evidence ${result.outputPath} installers=${result.evidence.installers.length} ffmpegExecutionReady=${result.evidence.readiness.ffmpegExecutionReady}`;
}

function readReleaseInstallers(rootDir, platform) {
  const installerSpecs = createAutoCutReleaseInstallerSpecs({ rootDir, platform });
  return installerSpecs.map((spec) => {
    if (!fs.existsSync(spec.absolutePath) || !fs.statSync(spec.absolutePath).isFile()) {
      throw new Error(`missing AutoCut release installer: ${spec.absolutePath}`);
    }
    const bytes = fs.readFileSync(spec.absolutePath);
    return {
      kind: spec.kind,
      path: toPosixRelative(rootDir, spec.absolutePath),
      byteSize: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    };
  });
}

function readNativeReleaseSmokeEvidence(rootDir) {
  const evidencePath = path.join(rootDir, nativeReleaseSmokeRelativePath);
  if (!fs.existsSync(evidencePath) || !fs.statSync(evidencePath).isFile()) {
    throw new Error(`missing AutoCut native release smoke evidence: ${evidencePath}`);
  }
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  if (evidence.schemaVersion !== '2026-05-05.autocut-native-release-smoke.v1') {
    throw new Error(`unsupported AutoCut native release smoke evidence schema: ${evidence.schemaVersion}`);
  }
  if (evidence.readiness?.ffmpegExecutionReady === true) {
    throw new Error('AutoCut native release smoke evidence must not claim ffmpegExecutionReady.');
  }
  const videoSliceMatrixEntry = Array.isArray(evidence.commandMatrix)
    ? evidence.commandMatrix.find((command) => command?.command === 'autocut_slice_video')
    : undefined;
  const videoSliceReady = Boolean(
    evidence.readiness?.videoSliceSmokeReady &&
      evidence.videoSliceSmoke?.skipped === false &&
      evidence.videoSliceSmoke?.success === true &&
      typeof evidence.videoSliceSmoke?.stdout === 'string' &&
      evidence.videoSliceSmoke.stdout.includes('autocut-video-slice-smoke=passed') &&
      videoSliceMatrixEntry?.evidenceReady === true,
  );
  return {
    path: toPosixRelative(rootDir, evidencePath),
    ready: Boolean(evidence.readiness?.nativeReleaseSmokeReady) && videoSliceReady,
    videoSliceReady,
    evidence,
  };
}

function readInstallerSignatureEvidence(rootDir) {
  const evidencePath = path.join(rootDir, installerSignatureEvidenceRelativePath);
  if (!fs.existsSync(evidencePath) || !fs.statSync(evidencePath).isFile()) {
    throw new Error(`missing AutoCut installer signature evidence: ${evidencePath}`);
  }
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  if (evidence.schemaVersion !== '2026-05-05.autocut-installer-signature-evidence.v1') {
    throw new Error(`unsupported AutoCut installer signature evidence schema: ${evidence.schemaVersion}`);
  }
  return {
    path: toPosixRelative(rootDir, evidencePath),
    ready: Boolean(evidence.readiness?.installerSignatureReady),
    evidence,
  };
}

function readSmartSliceQualityEvidence(rootDir) {
  const evidencePath = path.join(rootDir, smartSliceQualityEvidenceRelativePath);
  if (!fs.existsSync(evidencePath) || !fs.statSync(evidencePath).isFile()) {
    throw new Error(`missing AutoCut smart slice quality evidence: ${evidencePath}`);
  }
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  if (evidence.schemaVersion !== '2026-05-06.autocut-smart-slice-quality-evidence.v1') {
    throw new Error(`unsupported AutoCut smart slice quality evidence schema: ${evidence.schemaVersion}`);
  }
  return {
    path: toPosixRelative(rootDir, evidencePath),
    ready: Boolean(evidence.readiness?.smartSliceQualityReady),
    evidence,
  };
}

function readSmartSliceMediaArtifactsEvidence(rootDir) {
  const evidencePath = path.join(rootDir, smartSliceMediaArtifactsEvidenceRelativePath);
  if (!fs.existsSync(evidencePath) || !fs.statSync(evidencePath).isFile()) {
    throw new Error(`missing AutoCut smart slice media artifacts evidence: ${evidencePath}`);
  }
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  if (evidence.schemaVersion !== '2026-05-06.autocut-smart-slice-media-artifacts-evidence.v1') {
    throw new Error(`unsupported AutoCut smart slice media artifacts evidence schema: ${evidence.schemaVersion}`);
  }
  return {
    path: toPosixRelative(rootDir, evidencePath),
    ready: Boolean(evidence.readiness?.smartSliceMediaArtifactsReady),
    evidence,
  };
}

function toPosixRelative(rootDir, targetPath) {
  return path.relative(rootDir, targetPath).replaceAll(path.sep, '/');
}

function parseArgs(argv) {
  const options = {};
  const args = normalizeAutoCutCliArgs(argv);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--platform') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut release evidence',
      });
      options.platform = option.value;
      index = option.nextIndex;
    } else if (arg === '--output') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut release evidence',
      });
      options.outputPath = option.value;
      index = option.nextIndex;
    } else if (arg === '--skip-executable-smoke') {
      options.skipExecutableSmoke = true;
    } else {
      throw new Error(`Unknown AutoCut release evidence argument: ${arg}`);
    }
  }
  return options;
}

function main() {
  const result = writeAutoCutReleaseEvidence(parseArgs(process.argv.slice(2)));
  console.log(formatAutoCutReleaseEvidenceMessage(result));
}

if (path.resolve(process.argv[1] ?? '') === __filename) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
