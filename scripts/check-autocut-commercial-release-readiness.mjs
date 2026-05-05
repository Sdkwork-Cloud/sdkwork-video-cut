#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const readinessSchemaVersion = '2026-05-05.autocut-commercial-release-readiness.v1';
const defaultEvidenceRelativePath = 'artifacts/release/autocut-release-evidence.json';

export function createAutoCutCommercialReleaseReadinessReport({
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

  const blockers = createCommercialReleaseBlockers(evidence);
  return {
    schemaVersion: readinessSchemaVersion,
    generatedAt,
    evidencePath: toPosixRelative(resolvedRootDir, resolvedEvidencePath),
    platform: evidence.platform,
    commercialReleaseReady: blockers.length === 0,
    blockers,
    readiness: {
      ffmpegBundledReady: Boolean(evidence.readiness?.ffmpegBundledReady),
      ffmpegExecutionReady: Boolean(evidence.readiness?.ffmpegExecutionReady),
      nativeReleaseSmokeReady: Boolean(evidence.readiness?.nativeReleaseSmokeReady),
      installerSignatureReady: Boolean(evidence.readiness?.installerSignatureReady),
      releaseSmokeReady: Boolean(evidence.readiness?.releaseSmokeReady),
    },
  };
}

export function formatAutoCutCommercialReleaseReadinessMessage(report) {
  if (report.commercialReleaseReady) {
    return 'ok - autocut commercial release readiness';
  }
  return `blocked - autocut commercial release readiness blockers=${report.blockers.length}`;
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
      readiness.nativeReleaseSmokeReady &&
      evidence.nativeReleaseSmoke?.ready === true &&
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

function toPosixRelative(rootDir, targetPath) {
  return path.relative(rootDir, targetPath).replaceAll(path.sep, '/');
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--evidence') {
      options.evidencePath = argv[index + 1];
      index += 1;
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
