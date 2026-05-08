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
const readinessSchemaVersion = '2026-05-06.autocut-multiplatform-release-readiness.v1';
const defaultEvidenceDirRelativePath = 'artifacts/release';
const defaultRequiredPlatforms = ['windows-x86_64', 'linux-x86_64', 'macos-x86_64', 'macos-aarch64'];
const defaultArtifactKindsByPlatform = {
  'windows-x86_64': ['msi', 'nsis'],
  'linux-x86_64': ['deb', 'appimage'],
  'macos-x86_64': ['dmg', 'app'],
  'macos-aarch64': ['dmg', 'app'],
};

export function createAutoCutMultiplatformReleaseReadinessReport({
  rootDir = process.cwd(),
  evidenceDir,
  platforms = defaultRequiredPlatforms,
  generatedAt = new Date().toISOString(),
} = {}) {
  const resolvedRootDir = path.resolve(rootDir);
  const resolvedEvidenceDir = path.resolve(
    evidenceDir ?? path.join(resolvedRootDir, defaultEvidenceDirRelativePath),
  );
  const requiredPlatforms = normalizePlatforms(platforms).map((platform) =>
    createPlatformReadiness({
      rootDir: resolvedRootDir,
      evidenceDir: resolvedEvidenceDir,
      platform,
    }),
  );
  const blockers = requiredPlatforms.flatMap((platform) => platform.blockers);
  const warnings = requiredPlatforms.flatMap((platform) => platform.warnings);
  const readyPlatforms = requiredPlatforms.filter((platform) => platform.ready).length;
  const totalInstallers = requiredPlatforms.reduce((sum, platform) => sum + platform.installers.length, 0);

  return {
    schemaVersion: readinessSchemaVersion,
    generatedAt,
    evidenceDir: toPosixRelative(resolvedRootDir, resolvedEvidenceDir),
    multiplatformReleaseReady: blockers.length === 0,
    summary: {
      requiredPlatformCount: requiredPlatforms.length,
      readyPlatforms,
      totalInstallers,
      warningCount: warnings.length,
      blockerCount: blockers.length,
    },
    requiredPlatforms,
    blockers,
    warnings,
  };
}

export function formatAutoCutMultiplatformReleaseReadinessMessage(report) {
  if (report.multiplatformReleaseReady) {
    return [
      'ok - autocut multiplatform release readiness',
      `platforms=${report.summary.readyPlatforms}`,
      `installers=${report.summary.totalInstallers}`,
      `warnings=${report.summary.warningCount}`,
    ].join(' ');
  }
  return [
    'blocked - autocut multiplatform release readiness',
    `platforms=${report.summary.readyPlatforms}/${report.summary.requiredPlatformCount}`,
    `blockers=${report.summary.blockerCount}`,
    `warnings=${report.summary.warningCount}`,
  ].join(' ');
}

function createPlatformReadiness({ rootDir, evidenceDir, platform }) {
  const evidencePath = path.join(evidenceDir, `autocut-release-evidence-${platform}.json`);
  if (!fs.existsSync(evidencePath) || !fs.statSync(evidencePath).isFile()) {
    return {
      platform,
      evidencePath: toPosixRelative(rootDir, evidencePath),
      ready: false,
      installers: [],
      readiness: {},
      blockers: [
        createBlocker(platform, 'PLATFORM_RELEASE_EVIDENCE_MISSING', `Missing release evidence for ${platform}.`),
      ],
      warnings: [],
    };
  }

  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  if (evidence.schemaVersion !== '2026-05-05.autocut-release-evidence.v1') {
    return {
      platform,
      evidencePath: toPosixRelative(rootDir, evidencePath),
      ready: false,
      installers: [],
      readiness: {},
      blockers: [
        createBlocker(platform, 'PLATFORM_RELEASE_EVIDENCE_SCHEMA_UNSUPPORTED', `Unsupported release evidence schema for ${platform}: ${evidence.schemaVersion}.`),
      ],
      warnings: [],
    };
  }
  if (evidence.platform !== platform) {
    return {
      platform,
      evidencePath: toPosixRelative(rootDir, evidencePath),
      ready: false,
      installers: [],
      readiness: {},
      blockers: [
        createBlocker(platform, 'PLATFORM_RELEASE_EVIDENCE_MISMATCH', `Release evidence file for ${platform} declares ${evidence.platform}.`),
      ],
      warnings: [],
    };
  }

  const readiness = createPlatformReadinessSnapshot(evidence);
  const blockers = createPlatformBlockers(platform, evidence, readiness);
  const warnings = createPlatformWarnings(platform, evidence, readiness);
  return {
    platform,
    evidencePath: toPosixRelative(rootDir, evidencePath),
    ready: blockers.length === 0,
    installers: normalizeInstallers(evidence.installers),
    readiness,
    blockers,
    warnings,
  };
}

function createPlatformReadinessSnapshot(evidence) {
  const readiness = evidence.readiness ?? {};
  const preflight = evidence.preflight ?? {};
  return {
    ffmpegBundledReady: Boolean(readiness.ffmpegBundledReady),
    speechBundledReady: Boolean(readiness.speechBundledReady),
    ffmpegExecutionPreviewReady: Boolean(
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
    ),
    nativeReleaseSmokeReady: Boolean(readiness.nativeReleaseSmokeReady),
    nativeVideoSliceSmokeReady: Boolean(readiness.nativeVideoSliceSmokeReady),
    smartSliceQualityReady: Boolean(readiness.smartSliceQualityReady),
    smartSliceMediaArtifactsReady: Boolean(readiness.smartSliceMediaArtifactsReady),
    installerArtifactsReady: installerArtifactsReady(evidence.platform, evidence.installers),
    installerSignatureReady: Boolean(readiness.installerSignatureReady),
    releaseSmokeReady: Boolean(readiness.releaseSmokeReady),
  };
}

function createPlatformBlockers(platform, evidence, readiness) {
  const blockers = [];
  const preflight = evidence.preflight ?? {};
  if (!readiness.ffmpegBundledReady || !preflight.bundledReady || !preflight.sidecarPresent || !preflight.integrityReady) {
    blockers.push(createBlocker(platform, 'FFMPEG_SIDECAR_NOT_BUNDLED', 'Approved FFmpeg sidecar is not bundled with verified integrity.'));
  }
  if (
    !readiness.speechBundledReady ||
    preflight.speechSidecar?.bundledReady !== true ||
    preflight.speechSidecar?.sidecarPresent !== true ||
    preflight.speechSidecar?.integrityReady !== true
  ) {
    blockers.push(createBlocker(platform, 'SPEECH_SIDECAR_NOT_BUNDLED', 'Approved local Whisper speech-to-text sidecar is not bundled with verified integrity.'));
  }
  if (preflight.executableSmokeReady !== true) {
    blockers.push(createBlocker(platform, 'FFMPEG_EXECUTABLE_SMOKE_NOT_VERIFIED', 'Bundled FFmpeg executable smoke has not passed.'));
  }
  if (!readiness.nativeReleaseSmokeReady || evidence.nativeReleaseSmoke?.ready !== true) {
    blockers.push(createBlocker(platform, 'NATIVE_RELEASE_SMOKE_NOT_READY', 'Native release smoke evidence is missing or not ready.'));
  }
  if (!readiness.nativeVideoSliceSmokeReady || evidence.nativeReleaseSmoke?.videoSliceReady !== true) {
    blockers.push(createBlocker(platform, 'NATIVE_VIDEO_SLICE_SMOKE_NOT_READY', 'Native video slice smoke evidence is missing or not ready.'));
  }
  if (!readiness.smartSliceQualityReady || evidence.smartSliceQuality?.ready !== true) {
    blockers.push(createBlocker(platform, 'SMART_SLICE_QUALITY_NOT_READY', 'Smart slicing quality evidence is missing or below the publishing threshold.'));
  }
  if (!readiness.smartSliceMediaArtifactsReady || evidence.smartSliceMediaArtifacts?.ready !== true) {
    blockers.push(createBlocker(platform, 'SMART_SLICE_MEDIA_ARTIFACTS_NOT_READY', 'Smart slicing media artifact evidence is missing or not ready.'));
  }
  if (!readiness.installerArtifactsReady) {
    blockers.push(createBlocker(platform, 'INSTALLER_ARTIFACTS_NOT_READY', 'Release installers are missing, empty, missing digests, or do not match the platform package policy.'));
  }
  if (!readiness.releaseSmokeReady) {
    blockers.push(createBlocker(platform, 'RELEASE_SMOKE_NOT_READY', 'Aggregate release smoke readiness is false.'));
  }
  if (!readiness.ffmpegExecutionPreviewReady && blockers.length === 0) {
    blockers.push(createBlocker(platform, 'FFMPEG_EXECUTION_NOT_READY', 'Release evidence does not prove bundled FFmpeg execution with native and smart slice evidence.'));
  }
  return blockers;
}

function createPlatformWarnings(platform, evidence, readiness) {
  if (readiness.installerSignatureReady && evidence.installerSignature?.ready === true) {
    return [];
  }
  return [
    {
      platform,
      code: platform.startsWith('macos-')
        ? 'UNSIGNED_MACOS_INSTALLERS_ACCEPTED_FOR_PREVIEW'
        : 'UNSIGNED_INSTALLERS_ACCEPTED_FOR_PREVIEW',
      message: platform.startsWith('macos-')
        ? 'macOS installers are unsigned or not notarized and may be blocked by Gatekeeper outside preview testing.'
        : 'Installers are unsigned and may trigger operating-system trust warnings outside preview testing.',
      remediation: 'For a formal commercial public release, complete platform signing/notarization and use release:commercial-ready.',
    },
  ];
}

function installerArtifactsReady(platform, installers) {
  const expectedKinds = defaultArtifactKindsByPlatform[platform];
  if (!Array.isArray(expectedKinds) || !Array.isArray(installers) || installers.length < expectedKinds.length) {
    return false;
  }
  const seenKinds = new Set();
  for (const installer of installers) {
    seenKinds.add(String(installer?.kind ?? '').toLowerCase());
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
  return expectedKinds.every((kind) => seenKinds.has(kind));
}

function normalizeInstallers(installers) {
  return Array.isArray(installers)
    ? installers.map((installer) => ({
        kind: String(installer?.kind ?? ''),
        path: String(installer?.path ?? ''),
        byteSize: Number(installer?.byteSize ?? 0),
        sha256: String(installer?.sha256 ?? ''),
      }))
    : [];
}

function createBlocker(platform, code, message) {
  return {
    platform,
    code,
    message,
  };
}

function normalizePlatforms(platforms) {
  const input = Array.isArray(platforms) ? platforms : String(platforms ?? '').split(',');
  const normalized = input
    .map((platform) => String(platform).trim())
    .filter(Boolean)
    .map((platform) => normalizeAutoCutReleasePlatform(platform));
  if (normalized.length === 0) {
    throw new Error('AutoCut multiplatform release readiness requires at least one platform.');
  }
  return [...new Set(normalized)];
}

function toPosixRelative(rootDir, targetPath) {
  return path.relative(rootDir, targetPath).replaceAll(path.sep, '/');
}

function parseArgs(argv) {
  const options = {};
  const args = normalizeAutoCutCliArgs(argv);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--evidence-dir') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut multiplatform release readiness',
      });
      options.evidenceDir = option.value;
      index = option.nextIndex;
    } else if (arg === '--platforms') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut multiplatform release readiness',
      });
      options.platforms = option.value.split(',');
      index = option.nextIndex;
    } else {
      throw new Error(`Unknown AutoCut multiplatform release readiness argument: ${arg}`);
    }
  }
  return options;
}

function main() {
  const report = createAutoCutMultiplatformReleaseReadinessReport(parseArgs(process.argv.slice(2)));
  console.log(formatAutoCutMultiplatformReleaseReadinessMessage(report));
  for (const warning of report.warnings) {
    console.error(`${warning.platform}:${warning.code}: ${warning.message}`);
  }
  if (!report.multiplatformReleaseReady) {
    for (const blocker of report.blockers) {
      console.error(`${blocker.platform}:${blocker.code}: ${blocker.message}`);
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
