#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  normalizeAutoCutCliArgs,
  readAutoCutCliOptionValue,
} from './autocut-cli-args.mjs';
import {
  normalizeAutoCutReleasePlatform,
} from './autocut-release-platforms.mjs';

const __filename = fileURLToPath(import.meta.url);
const readinessSchemaVersion = '2026-05-06.autocut-commercial-release-readiness.v2';
const defaultEvidenceRelativePath = 'artifacts/release/autocut-release-evidence.json';
const defaultEvidenceDirRelativePath = 'artifacts/release';
const defaultRequiredPlatforms = ['windows-x86_64', 'linux-x86_64', 'macos-x86_64', 'macos-aarch64'];
const expectedInstallerKindsByPlatform = {
  'windows-x86_64': ['msi', 'nsis'],
  'linux-x86_64': ['deb', 'appimage'],
  'macos-x86_64': ['dmg', 'app'],
  'macos-aarch64': ['dmg', 'app'],
};
const sha256Pattern = /^[a-f0-9]{64}$/u;

export function createAutoCutCommercialReleaseReadinessReport({
  rootDir = process.cwd(),
  evidencePath,
  evidenceDir,
  platforms = defaultRequiredPlatforms,
  generatedAt = new Date().toISOString(),
} = {}) {
  const resolvedRootDir = path.resolve(rootDir);
  if (!evidencePath) {
    return createAggregateCommercialReleaseReadinessReport({
      rootDir: resolvedRootDir,
      evidenceDir,
      platforms,
      generatedAt,
    });
  }

  const resolvedEvidencePath = path.resolve(
    evidencePath ?? path.join(resolvedRootDir, defaultEvidenceRelativePath),
  );
  const evidence = readReleaseEvidenceFile(resolvedEvidencePath);
  const blockers = createCommercialReleaseBlockers(evidence);
  return {
    schemaVersion: readinessSchemaVersion,
    mode: 'single',
    generatedAt,
    evidencePath: toPosixRelative(resolvedRootDir, resolvedEvidencePath),
    platform: evidence.platform,
    commercialReleaseReady: blockers.length === 0,
    blockers,
    readiness: {
      ffmpegBundledReady: Boolean(evidence.readiness?.ffmpegBundledReady),
      speechBundledReady: Boolean(evidence.readiness?.speechBundledReady),
      ffmpegExecutionReady: Boolean(evidence.readiness?.ffmpegExecutionReady),
      nativeReleaseSmokeReady: Boolean(evidence.readiness?.nativeReleaseSmokeReady),
      nativeVideoSliceSmokeReady: Boolean(evidence.readiness?.nativeVideoSliceSmokeReady),
      smartSliceQualityReady: Boolean(evidence.readiness?.smartSliceQualityReady),
      smartSliceMediaArtifactsReady: Boolean(evidence.readiness?.smartSliceMediaArtifactsReady),
      installerArtifactsReady: installerArtifactsReady(evidence.platform, evidence.installers),
      installerSignatureReady: Boolean(evidence.readiness?.installerSignatureReady),
      releaseSmokeReady: Boolean(evidence.readiness?.releaseSmokeReady),
    },
  };
}

export function formatAutoCutCommercialReleaseReadinessMessage(report) {
  if (report.mode === 'aggregate') {
    if (report.commercialReleaseReady) {
      return [
        'ok - autocut commercial release readiness',
        `platforms=${report.summary.readyPlatforms}`,
        `blockers=${report.summary.blockerCount}`,
      ].join(' ');
    }
    return [
      'blocked - autocut commercial release readiness',
      `platforms=${report.summary.readyPlatforms}/${report.summary.requiredPlatformCount}`,
      `blockers=${report.summary.blockerCount}`,
    ].join(' ');
  }
  if (report.commercialReleaseReady) {
    return `ok - autocut commercial release readiness platform=${report.platform}`;
  }
  return `blocked - autocut commercial release readiness platform=${report.platform} blockers=${report.blockers.length}`;
}

function createAggregateCommercialReleaseReadinessReport({
  rootDir,
  evidenceDir,
  platforms,
  generatedAt,
}) {
  const resolvedEvidenceDir = path.resolve(
    evidenceDir ?? path.join(rootDir, defaultEvidenceDirRelativePath),
  );
  const requiredPlatforms = normalizePlatforms(platforms).map((platform) =>
    createPlatformCommercialReleaseReadiness({
      rootDir,
      evidenceDir: resolvedEvidenceDir,
      platform,
    }),
  );
  const blockers = requiredPlatforms.flatMap((platform) => platform.blockers);
  const readyPlatforms = requiredPlatforms.filter((platform) => platform.ready).length;
  return {
    schemaVersion: readinessSchemaVersion,
    mode: 'aggregate',
    generatedAt,
    evidenceDir: toPosixRelative(rootDir, resolvedEvidenceDir),
    commercialReleaseReady: blockers.length === 0,
    summary: {
      requiredPlatformCount: requiredPlatforms.length,
      readyPlatforms,
      blockerCount: blockers.length,
    },
    requiredPlatforms,
    blockers,
  };
}

function createPlatformCommercialReleaseReadiness({ rootDir, evidenceDir, platform }) {
  const evidencePath = path.join(evidenceDir, `autocut-release-evidence-${platform}.json`);
  if (!fs.existsSync(evidencePath) || !fs.statSync(evidencePath).isFile()) {
    return {
      platform,
      evidencePath: toPosixRelative(rootDir, evidencePath),
      ready: false,
      readiness: {},
      blockers: [
        createPlatformBlocker(
          platform,
          'PLATFORM_RELEASE_EVIDENCE_MISSING',
          `Missing commercial release evidence for ${platform}.`,
        ),
      ],
    };
  }

  let evidence;
  try {
    evidence = readReleaseEvidenceFile(evidencePath);
  } catch (error) {
    return {
      platform,
      evidencePath: toPosixRelative(rootDir, evidencePath),
      ready: false,
      readiness: {},
      blockers: [
        createPlatformBlocker(
          platform,
          'PLATFORM_RELEASE_EVIDENCE_INVALID',
          error instanceof Error ? error.message : String(error),
        ),
      ],
    };
  }
  if (evidence.platform !== platform) {
    return {
      platform,
      evidencePath: toPosixRelative(rootDir, evidencePath),
      ready: false,
      readiness: {},
      blockers: [
        createPlatformBlocker(
          platform,
          'PLATFORM_RELEASE_EVIDENCE_MISMATCH',
          `Release evidence file for ${platform} declares ${evidence.platform}.`,
        ),
      ],
    };
  }

  const blockers = createCommercialReleaseBlockers(evidence).map((blocker) => ({
    platform,
    ...blocker,
  }));
  return {
    platform,
    evidencePath: toPosixRelative(rootDir, evidencePath),
    ready: blockers.length === 0,
    readiness: createCommercialReadinessSnapshot(evidence),
    blockers,
  };
}

function readReleaseEvidenceFile(evidencePath) {
  if (!fs.existsSync(evidencePath) || !fs.statSync(evidencePath).isFile()) {
    throw new Error(`missing AutoCut release evidence: ${evidencePath}`);
  }
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  if (evidence.schemaVersion !== '2026-05-05.autocut-release-evidence.v1') {
    throw new Error(`unsupported AutoCut release evidence schema: ${evidence.schemaVersion}`);
  }
  normalizeAutoCutReleasePlatform(evidence.platform);
  return evidence;
}

function createCommercialReadinessSnapshot(evidence) {
  const readiness = evidence.readiness ?? {};
  return {
    ffmpegBundledReady: Boolean(readiness.ffmpegBundledReady),
    speechBundledReady: Boolean(readiness.speechBundledReady),
    ffmpegExecutionReady: Boolean(readiness.ffmpegExecutionReady),
    nativeReleaseSmokeReady: Boolean(readiness.nativeReleaseSmokeReady),
    nativeVideoSliceSmokeReady: Boolean(readiness.nativeVideoSliceSmokeReady),
    smartSliceQualityReady: Boolean(readiness.smartSliceQualityReady),
    smartSliceMediaArtifactsReady: Boolean(readiness.smartSliceMediaArtifactsReady),
    installerArtifactsReady: installerArtifactsReady(evidence.platform, evidence.installers),
    installerSignatureReady: Boolean(readiness.installerSignatureReady),
    releaseSmokeReady: Boolean(readiness.releaseSmokeReady),
  };
}

function createCommercialReleaseBlockers(evidence) {
  const blockers = [];
  const readiness = evidence.readiness ?? {};
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

  const ffmpegExecutionPrerequisitesReady = Boolean(
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
      readiness.releaseSmokeReady
  );

  if (!readiness.ffmpegExecutionReady && !ffmpegExecutionPrerequisitesReady) {
    blockers.push({
      code: 'FFMPEG_EXECUTION_NOT_READY',
      message: 'Release evidence does not claim FFmpeg execution readiness.',
      remediation: 'Keep this blocked until sidecar, executable smoke, native smoke, durable recovery, and release evidence are complete.',
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
      remediation: 'Run release:native-smoke so media_runtime::tests::video_slice_from_asset_registers_each_slice_artifact_inside_task_output_dir emits autocut-video-slice-smoke=passed, then regenerate release:evidence.',
    });
  }

  if (!readiness.smartSliceQualityReady || evidence.smartSliceQuality?.ready !== true) {
    blockers.push({
      code: 'SMART_SLICE_QUALITY_NOT_READY',
      message: 'Smart slicing quality evidence is missing or below the commercial publishing threshold.',
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

  if (!installerArtifactsReady(evidence.platform, evidence.installers)) {
    blockers.push({
      code: 'INSTALLER_ARTIFACTS_NOT_READY',
      message: 'Commercial release installers are missing, empty, missing SHA-256 digests, or do not match the platform package policy.',
      remediation: 'Run pnpm tauri:build for the target platform and regenerate release:evidence after installers are produced.',
    });
  }

  if (!readiness.installerSignatureReady || evidence.installerSignature?.ready !== true) {
    blockers.push({
      code: 'INSTALLER_SIGNATURE_NOT_READY',
      message: 'MSI/NSIS installer signature evidence is missing or not ready.',
      remediation: 'Sign release installers with the approved code-signing certificate, then run release:installer-signature and release:evidence.',
    });
  }

  if (!readiness.releaseSmokeReady) {
    blockers.push({
      code: 'RELEASE_SMOKE_NOT_READY',
      message: 'Aggregate release smoke readiness is false.',
      remediation: 'Regenerate all release evidence after completing sidecar, native smoke, and installer signature gates.',
    });
  }

  return blockers;
}

function installerArtifactsReady(platform, installers) {
  const expectedKinds = expectedInstallerKindsByPlatform[platform];
  if (!Array.isArray(expectedKinds) || !Array.isArray(installers) || installers.length < expectedKinds.length) {
    return false;
  }
  const seenKinds = new Set();
  for (const installer of installers) {
    const kind = String(installer?.kind ?? '').toLowerCase();
    seenKinds.add(kind);
    if (
      typeof installer?.path !== 'string' ||
      !installer.path.trim() ||
      !Number.isFinite(installer?.byteSize) ||
      installer.byteSize <= 0 ||
      typeof installer?.sha256 !== 'string' ||
      !sha256Pattern.test(installer.sha256)
    ) {
      return false;
    }
  }
  return expectedKinds.every((kind) => seenKinds.has(kind));
}

function createPlatformBlocker(platform, code, message) {
  return {
    platform,
    code,
    message,
  };
}

function toPosixRelative(rootDir, targetPath) {
  return path.relative(rootDir, targetPath).replaceAll(path.sep, '/');
}

function normalizePlatforms(platforms) {
  const input = Array.isArray(platforms) ? platforms : String(platforms ?? '').split(',');
  const normalized = input.map((platform) => normalizeAutoCutReleasePlatform(platform));
  if (normalized.length === 0) {
    throw new Error('AutoCut commercial release readiness requires at least one platform.');
  }
  return [...new Set(normalized)];
}

function parseArgs(argv) {
  const options = {};
  const args = normalizeAutoCutCliArgs(argv);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--evidence') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut commercial release readiness',
      });
      options.evidencePath = option.value;
      index = option.nextIndex;
    } else if (arg === '--evidence-dir') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut commercial release readiness',
      });
      options.evidenceDir = option.value;
      index = option.nextIndex;
    } else if (arg === '--platforms') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut commercial release readiness',
      });
      options.platforms = option.value.split(',');
      index = option.nextIndex;
    } else {
      throw new Error(`Unknown AutoCut commercial release readiness argument: ${arg}`);
    }
  }
  return options;
}

function main() {
  const report = createAutoCutCommercialReleaseReadinessReport(parseArgs(process.argv.slice(2)));
  console.log(formatAutoCutCommercialReleaseReadinessMessage(report));
  if (!report.commercialReleaseReady) {
    for (const blocker of report.blockers) {
      console.error(`${blocker.platform ? `${blocker.platform}:` : ''}${blocker.code}: ${blocker.message}`);
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
