#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { createAutoCutReleaseSmokePreflightReport } from './check-autocut-release-smoke-preflight.mjs';

const __filename = fileURLToPath(import.meta.url);
const evidenceSchemaVersion = '2026-05-05.autocut-release-evidence.v1';
const desktopPackageRelativePath = 'packages/sdkwork-autocut-desktop';
const manifestRelativePath = `${desktopPackageRelativePath}/src-tauri/binaries/ffmpeg.toolchain.json`;
const bundleRelativeRoot = `${desktopPackageRelativePath}/src-tauri/target/release/bundle`;
const defaultOutputRelativePath = 'artifacts/release/autocut-release-evidence.json';
const nativeReleaseSmokeRelativePath = 'artifacts/release/autocut-native-release-smoke.json';
const installerSignatureEvidenceRelativePath = 'artifacts/release/autocut-installer-signature-evidence.json';

export function createAutoCutReleaseEvidence({
  rootDir = process.cwd(),
  platform = 'windows-x86_64',
  generatedAt = new Date().toISOString(),
  skipExecutableSmoke = false,
  runPreflightCommand,
} = {}) {
  const resolvedRootDir = path.resolve(rootDir);
  const manifestPath = path.join(resolvedRootDir, manifestRelativePath);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const preflight = createAutoCutReleaseSmokePreflightReport({
    rootDir: resolvedRootDir,
    platform,
    requireBundled: false,
    skipExecutableSmoke,
    ...(runPreflightCommand ? { runCommand: runPreflightCommand } : {}),
  });
  const nativeReleaseSmoke = readNativeReleaseSmokeEvidence(resolvedRootDir);
  const installerSignature = readInstallerSignatureEvidence(resolvedRootDir);
  const installers = readReleaseInstallers(resolvedRootDir);
  const ffmpegExecutionReady = Boolean(
    preflight.ffmpegExecutionReady &&
      preflight.bundledReady &&
      preflight.executableSmokeReady === true &&
      nativeReleaseSmoke.ready &&
      installerSignature.ready &&
      preflight.releaseSmokeReady
  );

  return {
    schemaVersion: evidenceSchemaVersion,
    generatedAt,
    platform,
    product: {
      name: 'SDKWork Video Cut',
      packageName: '@sdkwork/video-cut',
      desktopPackageName: '@sdkwork/autocut-desktop',
    },
    readiness: {
      ffmpegExecutionReady,
      ffmpegBundledReady: preflight.bundledReady,
      releaseSmokeReady: preflight.releaseSmokeReady,
      nativeReleaseSmokeReady: nativeReleaseSmoke.ready,
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
    },
    ffmpegManifest: {
      path: toPosixRelative(resolvedRootDir, manifestPath),
      contractVersion: manifest.contractVersion,
      bundledReady: Boolean(manifest.bundledReady),
      requiredBinary: manifest.requiredBinary,
      platform: {
        key: platform,
        relativePath: manifest.platforms?.[platform]?.relativePath ?? '',
        binaryName: manifest.platforms?.[platform]?.binaryName ?? '',
        sha256: manifest.platforms?.[platform]?.integrity?.sha256 ?? '',
        byteSize: manifest.platforms?.[platform]?.integrity?.byteSize ?? 0,
      },
    },
    nativeReleaseSmoke,
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

function readReleaseInstallers(rootDir) {
  const bundleRoot = path.join(rootDir, bundleRelativeRoot);
  const installerSpecs = [
    {
      kind: 'msi',
      path: path.join(bundleRoot, 'msi', 'SDKWork Video Cut_0.1.0_x64_en-US.msi'),
    },
    {
      kind: 'nsis',
      path: path.join(bundleRoot, 'nsis', 'SDKWork Video Cut_0.1.0_x64-setup.exe'),
    },
  ];
  return installerSpecs.map((spec) => {
    if (!fs.existsSync(spec.path) || !fs.statSync(spec.path).isFile()) {
      throw new Error(`missing AutoCut release installer: ${spec.path}`);
    }
    const bytes = fs.readFileSync(spec.path);
    return {
      kind: spec.kind,
      path: toPosixRelative(rootDir, spec.path),
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
  return {
    path: toPosixRelative(rootDir, evidencePath),
    ready: Boolean(evidence.readiness?.nativeReleaseSmokeReady),
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

function toPosixRelative(rootDir, targetPath) {
  return path.relative(rootDir, targetPath).replaceAll(path.sep, '/');
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--platform') {
      options.platform = argv[index + 1];
      index += 1;
    } else if (arg === '--output') {
      options.outputPath = argv[index + 1];
      index += 1;
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
