#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  normalizeAutoCutCliArgs,
  readAutoCutCliOptionValue,
} from './autocut-cli-args.mjs';

const __filename = fileURLToPath(import.meta.url);
const readinessSchemaVersion = '2026-05-06.autocut-preview-release-readiness.v1';
const defaultEvidenceRelativePath = 'artifacts/release/autocut-release-evidence.json';

export function createAutoCutPreviewReleaseReadinessReport({
  rootDir = process.cwd(),
  evidencePath,
  generatedAt = new Date().toISOString(),
} = {}) {
  const resolvedRootDir = path.resolve(rootDir);
  const resolvedEvidencePath = path.resolve(
    evidencePath ?? path.join(resolvedRootDir, defaultEvidenceRelativePath),
  );
  if (!fs.existsSync(resolvedEvidencePath) || !fs.statSync(resolvedEvidencePath).isFile()) {
    throw new Error(`missing AutoCut release evidence: ${resolvedEvidencePath}`);
  }

  const evidence = JSON.parse(fs.readFileSync(resolvedEvidencePath, 'utf8'));
  if (evidence.schemaVersion !== '2026-05-05.autocut-release-evidence.v1') {
    throw new Error(`unsupported AutoCut release evidence schema: ${evidence.schemaVersion}`);
  }

  const readiness = createPreviewReadiness(evidence);
  const blockers = createPreviewReleaseBlockers(evidence, readiness);
  const warnings = createPreviewReleaseWarnings(evidence, readiness);

  return {
    schemaVersion: readinessSchemaVersion,
    generatedAt,
    evidencePath: toPosixRelative(resolvedRootDir, resolvedEvidencePath),
    platform: evidence.platform,
    previewReleaseReady: blockers.length === 0,
    blockers,
    warnings,
    readiness,
  };
}

export function formatAutoCutPreviewReleaseReadinessMessage(report) {
  if (report.previewReleaseReady) {
    return `ok - autocut preview release readiness warnings=${report.warnings.length}`;
  }
  return `blocked - autocut preview release readiness blockers=${report.blockers.length} warnings=${report.warnings.length}`;
}

function createPreviewReadiness(evidence) {
  const readiness = evidence.readiness ?? {};
  const preflight = evidence.preflight ?? {};
  const ffmpegExecutionPreviewReady = Boolean(
    preflight.ffmpegExecutionReady === true &&
      preflight.executableSmokeReady === true &&
      preflight.bundledReady === true &&
      preflight.sidecarPresent === true &&
      preflight.integrityReady === true &&
      preflight.speechSidecar?.bundledReady === true &&
      readiness.nativeReleaseSmokeReady &&
      readiness.nativeVideoSliceSmokeReady &&
      evidence.nativeReleaseSmoke?.ready === true &&
      evidence.nativeReleaseSmoke?.videoSliceReady === true &&
      readiness.smartSliceQualityReady &&
      evidence.smartSliceQuality?.ready === true &&
      readiness.smartSliceMediaArtifactsReady &&
      evidence.smartSliceMediaArtifacts?.ready === true &&
      readiness.releaseSmokeReady
  );

  return {
    ffmpegBundledReady: Boolean(readiness.ffmpegBundledReady),
    speechBundledReady: Boolean(readiness.speechBundledReady),
    ffmpegExecutionReady: Boolean(readiness.ffmpegExecutionReady),
    ffmpegExecutionPreviewReady,
    nativeReleaseSmokeReady: Boolean(readiness.nativeReleaseSmokeReady),
    nativeVideoSliceSmokeReady: Boolean(readiness.nativeVideoSliceSmokeReady),
    smartSliceQualityReady: Boolean(readiness.smartSliceQualityReady),
    smartSliceMediaArtifactsReady: Boolean(readiness.smartSliceMediaArtifactsReady),
    installerArtifactsReady: installerArtifactsReady(evidence.installers),
    installerSignatureReady: Boolean(readiness.installerSignatureReady),
    releaseSmokeReady: Boolean(readiness.releaseSmokeReady),
  };
}

function createPreviewReleaseBlockers(evidence, readiness) {
  const blockers = [];
  const preflight = evidence.preflight ?? {};

  if (!readiness.ffmpegBundledReady || !preflight.bundledReady || !preflight.sidecarPresent || !preflight.integrityReady) {
    blockers.push({
      code: 'FFMPEG_SIDECAR_NOT_BUNDLED',
      message: 'Approved FFmpeg sidecar is not bundled with verified integrity.',
      remediation: 'Run prepare:ffmpeg-sidecar with an approved binary, then release:smoke-preflight --require-bundled.',
    });
  }

  if (
    !readiness.speechBundledReady ||
    preflight.speechSidecar?.bundledReady !== true ||
    preflight.speechSidecar?.sidecarPresent !== true ||
    preflight.speechSidecar?.integrityReady !== true
  ) {
    blockers.push({
      code: 'SPEECH_SIDECAR_NOT_BUNDLED',
      message: 'Approved local Whisper speech-to-text sidecar is not bundled with verified integrity.',
      remediation: 'Run prepare:speech-sidecar with an approved whisper-cli binary for the target platform, then regenerate release:evidence.',
    });
  }

  if (preflight.executableSmokeReady !== true) {
    blockers.push({
      code: 'FFMPEG_EXECUTABLE_SMOKE_NOT_VERIFIED',
      message: 'Bundled FFmpeg executable smoke has not passed.',
      remediation: 'Run release:smoke-preflight without --skip-executable-smoke after bundling the approved sidecar.',
    });
  }

  if (!readiness.ffmpegExecutionPreviewReady) {
    blockers.push({
      code: 'FFMPEG_EXECUTION_NOT_READY',
      message: 'Preview release evidence does not prove bundled FFmpeg execution with native and smart slice evidence.',
      remediation: 'Regenerate smoke, native video slice, smart slice, and aggregate release evidence after bundling FFmpeg.',
    });
  }

  if (!readiness.nativeReleaseSmokeReady || evidence.nativeReleaseSmoke?.ready !== true) {
    blockers.push({
      code: 'NATIVE_RELEASE_SMOKE_NOT_READY',
      message: 'Native release smoke evidence is missing or not ready.',
      remediation: 'Run release:native-smoke and regenerate release:evidence.',
    });
  }

  if (!readiness.nativeVideoSliceSmokeReady || evidence.nativeReleaseSmoke?.videoSliceReady !== true) {
    blockers.push({
      code: 'NATIVE_VIDEO_SLICE_SMOKE_NOT_READY',
      message: 'Native video slice smoke evidence is missing or not ready.',
      remediation: 'Run release:native-smoke so the exact native video slicing smoke passes, then regenerate release:evidence.',
    });
  }

  if (!readiness.smartSliceQualityReady || evidence.smartSliceQuality?.ready !== true) {
    blockers.push({
      code: 'SMART_SLICE_QUALITY_NOT_READY',
      message: 'Smart slicing quality evidence is missing or below the publishing threshold.',
      remediation: 'Run release:smart-slice-quality with a completed transcript-assisted smart slicing task, then regenerate release:evidence.',
    });
  }

  if (!readiness.smartSliceMediaArtifactsReady || evidence.smartSliceMediaArtifacts?.ready !== true) {
    blockers.push({
      code: 'SMART_SLICE_MEDIA_ARTIFACTS_NOT_READY',
      message: 'Smart slicing media artifact evidence is missing or not ready.',
      remediation: 'Run release:smart-slice-media-artifacts with the completed smart slice task export and regenerate release:evidence.',
    });
  }

  if (!readiness.installerArtifactsReady) {
    blockers.push({
      code: 'INSTALLER_ARTIFACTS_NOT_READY',
      message: 'Preview release installers are missing, empty, or missing SHA-256 digests.',
      remediation: 'Run pnpm tauri:build and regenerate release:evidence after installers are produced.',
    });
  }

  if (!readiness.releaseSmokeReady) {
    blockers.push({
      code: 'RELEASE_SMOKE_NOT_READY',
      message: 'Aggregate release smoke readiness is false.',
      remediation: 'Regenerate all release evidence after completing sidecar, native smoke, and smart slice gates.',
    });
  }

  return blockers;
}

function createPreviewReleaseWarnings(evidence, readiness) {
  if (readiness.installerSignatureReady && evidence.installerSignature?.ready === true) {
    return [];
  }
  return [
    {
      code: 'UNSIGNED_INSTALLERS_ACCEPTED_FOR_PREVIEW',
      message: 'MSI/NSIS installers are unsigned and may trigger Windows SmartScreen or enterprise install policy warnings.',
      remediation: 'For a formal commercial public release, sign installers and use release:commercial-ready instead.',
    },
  ];
}

function installerArtifactsReady(installers) {
  if (!Array.isArray(installers) || installers.length < 2) {
    return false;
  }
  const kinds = new Set();
  for (const installer of installers) {
    kinds.add(installer?.kind);
    if (
      typeof installer?.path !== 'string' ||
      !installer.path.trim() ||
      !Number.isFinite(installer?.byteSize) ||
      installer.byteSize <= 0 ||
      typeof installer?.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(installer.sha256)
    ) {
      return false;
    }
  }
  return kinds.has('msi') && kinds.has('nsis');
}

function toPosixRelative(rootDir, targetPath) {
  return path.relative(rootDir, targetPath).replaceAll(path.sep, '/');
}

function parseArgs(argv) {
  const options = {};
  const args = normalizeAutoCutCliArgs(argv);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--evidence') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut preview release readiness',
      });
      options.evidencePath = option.value;
      index = option.nextIndex;
    } else {
      throw new Error(`Unknown AutoCut preview release readiness argument: ${arg}`);
    }
  }
  return options;
}

function main() {
  const report = createAutoCutPreviewReleaseReadinessReport(parseArgs(process.argv.slice(2)));
  console.log(formatAutoCutPreviewReleaseReadinessMessage(report));
  for (const warning of report.warnings) {
    console.error(`${warning.code}: ${warning.message}`);
  }
  if (!report.previewReleaseReady) {
    for (const blocker of report.blockers) {
      console.error(`${blocker.code}: ${blocker.message}`);
    }
    process.exit(1);
  }
}

if (path.resolve(process.argv[1] ?? '') === __filename) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
