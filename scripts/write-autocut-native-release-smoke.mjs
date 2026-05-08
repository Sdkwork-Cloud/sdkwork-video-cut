#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  normalizeAutoCutCliArgs,
  readAutoCutCliOptionValue,
} from './autocut-cli-args.mjs';

const __filename = fileURLToPath(import.meta.url);
const evidenceSchemaVersion = '2026-05-05.autocut-native-release-smoke.v1';
const desktopTauriRelativePath = 'packages/sdkwork-autocut-desktop/src-tauri';
const cargoManifestRelativePath = `${desktopTauriRelativePath}/Cargo.toml`;
const ffmpegToolchainManifestRelativePath = `${desktopTauriRelativePath}/binaries/ffmpeg.toolchain.json`;
const defaultOutputRelativePath = 'artifacts/release/autocut-native-release-smoke.json';
const rustToolchain = '1.90.0';
const nativeSmokeCargoTargetDirPrefix = 'sdkwork-autocut-native-smoke-target-';

export function createAutoCutNativeReleaseSmokeEvidence({
  rootDir = process.cwd(),
  generatedAt = new Date().toISOString(),
  outputPath,
  skipRustSmoke = false,
  hostPlatform = process.platform,
  hostArch = process.arch,
  runRealLlmSecretSmoke = isAutoCutTruthyFlag(process.env.SDKWORK_AUTOCUT_RUN_REAL_LLM_SECRET_SMOKE),
  runCommand = runAutoCutNativeReleaseSmokeCommand,
} = {}) {
  const resolvedRootDir = path.resolve(rootDir);
  const cargoManifestPath = path.join(resolvedRootDir, cargoManifestRelativePath);
  if (!fs.existsSync(cargoManifestPath) || !fs.statSync(cargoManifestPath).isFile()) {
    throw new Error(`missing AutoCut native host Cargo manifest: ${cargoManifestPath}`);
  }

  const cargoManifestSource = fs.readFileSync(cargoManifestPath, 'utf8');
  const packageName = parseCargoPackageName(cargoManifestSource);
  const ffmpegExecutablePath = resolveAutoCutNativeSmokeFfmpegExecutablePath({
    rootDir: resolvedRootDir,
    hostPlatform,
    hostArch,
  });
  const cargoTargetDir = createAutoCutNativeSmokeCargoTargetDir(
    resolvedRootDir,
    generatedAt,
  );
  const rustSmoke = createRustSmokeEvidence({
    rootDir: resolvedRootDir,
    cargoManifestPath,
    cargoTargetDir,
    ffmpegExecutablePath,
    skipRustSmoke,
    runCommand,
  });
  const videoSliceSmoke = createVideoSliceSmokeEvidence({
    rootDir: resolvedRootDir,
    cargoManifestPath,
    cargoTargetDir,
    ffmpegExecutablePath,
    skipRustSmoke,
    runCommand,
  });
  const llmSecretStoreSmoke = createRealLlmSecretStoreSmokeEvidence({
    rootDir: resolvedRootDir,
    cargoManifestPath,
    cargoTargetDir,
    hostPlatform,
    ffmpegExecutablePath,
    runRealLlmSecretSmoke,
    runCommand,
  });
  const commandMatrix = createNativeCommandMatrix({
    rustSmokeReady: !rustSmoke.skipped && rustSmoke.success,
    videoSliceSmokeReady: !videoSliceSmoke.skipped && videoSliceSmoke.success,
    llmSecretStoreSmokeReady: isLlmSecretStoreSmokeReady(llmSecretStoreSmoke),
  });
  const nativeReleaseSmokeReady =
    commandMatrix.every((command) => command.evidenceReady);

  return {
    schemaVersion: evidenceSchemaVersion,
    generatedAt,
    outputPath: outputPath ? toPosixRelative(resolvedRootDir, outputPath) : undefined,
    nativeHost: {
      packageName,
      manifestPath: toPosixRelative(resolvedRootDir, cargoManifestPath),
      desktopTauriPath: desktopTauriRelativePath,
      toolchain: rustToolchain,
      ffmpegExecutablePath: ffmpegExecutablePath
        ? toPosixRelative(resolvedRootDir, ffmpegExecutablePath)
        : undefined,
      cargoTargetDirs: {
        rustSmoke: cargoTargetDir,
        videoSliceSmoke: cargoTargetDir,
        llmSecretStoreSmoke: cargoTargetDir,
      },
    },
    readiness: {
      nativeReleaseSmokeReady,
      videoSliceSmokeReady: !videoSliceSmoke.skipped && videoSliceSmoke.success,
      realLlmSecretStoreSmokeReady: isLlmSecretStoreSmokeReady(llmSecretStoreSmoke),
      ffmpegExecutionReady: false,
    },
    commandMatrix,
    rustSmoke,
    videoSliceSmoke,
    llmSecretStoreSmoke,
  };
}

export function writeAutoCutNativeReleaseSmokeEvidence({
  rootDir = process.cwd(),
  outputPath,
  ...options
} = {}) {
  const resolvedRootDir = path.resolve(rootDir);
  const resolvedOutputPath = path.resolve(
    outputPath ?? path.join(resolvedRootDir, defaultOutputRelativePath),
  );
  const evidence = createAutoCutNativeReleaseSmokeEvidence({
    rootDir: resolvedRootDir,
    outputPath: resolvedOutputPath,
    ...options,
  });
  fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  fs.writeFileSync(`${resolvedOutputPath}.tmp`, `${JSON.stringify(evidence, null, 2)}\n`);
  fs.renameSync(`${resolvedOutputPath}.tmp`, resolvedOutputPath);
  return {
    outputPath: resolvedOutputPath,
    evidence,
  };
}

export function formatAutoCutNativeReleaseSmokeEvidenceMessage(result) {
  return [
    `ok - autocut native release smoke evidence ${result.outputPath}`,
    `nativeReleaseSmokeReady=${result.evidence.readiness.nativeReleaseSmokeReady}`,
    `ffmpegExecutionReady=${result.evidence.readiness.ffmpegExecutionReady}`,
  ].join(' ');
}

export function runAutoCutNativeReleaseSmokeCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      ...(options.env ?? {}),
    },
    shell: false,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`run AutoCut native release smoke command failed: ${result.error.message}`);
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function createRealLlmSecretStoreSmokeEvidence({
  rootDir,
  cargoManifestPath,
  cargoTargetDir,
  hostPlatform,
  ffmpegExecutablePath,
  runRealLlmSecretSmoke,
  runCommand,
}) {
  const testName = 'llm_secret_runtime::tests::real_windows_keyring_store_saves_reads_and_deletes_llm_secret';
  const command = 'cargo';
  const args = [
    `+${rustToolchain}`,
    'test',
    '--manifest-path',
    toPosixRelative(rootDir, cargoManifestPath),
    testName,
    '--',
    '--ignored',
    '--exact',
    '--test-threads=1',
    '--nocapture',
  ];
  const commandLine = [command, ...args].join(' ');
  if (hostPlatform !== 'win32') {
    return {
      requested: false,
      skipped: true,
      success: true,
      platformApplicable: false,
      status: null,
      command: commandLine,
      stdout: '',
      stderr: '',
      reason: 'The real LLM secret store release smoke is only required on Windows because this build stores desktop LLM secrets in Windows Credential Manager.',
    };
  }

  if (!runRealLlmSecretSmoke) {
    return {
      requested: false,
      skipped: true,
      success: false,
      platformApplicable: true,
      status: null,
      command: commandLine,
      stdout: '',
      stderr: '',
      reason: 'Set SDKWORK_AUTOCUT_RUN_REAL_LLM_SECRET_SMOKE=true or pass --run-real-llm-secret-smoke to exercise the real Windows credential store.',
    };
  }

  const result = runAutoCutNativeReleaseSmokeCargoCommand({
    command,
    args,
    rootDir,
    cargoTargetDir,
    env: {
      ...(ffmpegExecutablePath ? { SDKWORK_AUTOCUT_FFMPEG: ffmpegExecutablePath } : {}),
      SDKWORK_AUTOCUT_RUN_REAL_LLM_SECRET_SMOKE: 'true',
    },
    runCommand,
  });
  const status = Number.isInteger(result.status) ? result.status : 1;
  const stdout = String(result.stdout ?? '');
  const stderr = String(result.stderr ?? '');
  if (status !== 0) {
    const detail = stderr.trim() || stdout.trim() || `exit ${status}`;
    throw new Error(`AutoCut real LLM secret store smoke failed: ${detail}`);
  }

  if (!stdout.includes('autocut-real-llm-secret-store-smoke=passed')) {
    throw new Error('AutoCut real LLM secret store smoke did not emit the required success marker.');
  }

  return {
    requested: true,
    skipped: false,
    success: true,
    platformApplicable: true,
    status,
    command: commandLine,
    stdout: trimReleaseSmokeOutput(stdout),
    stderr: trimReleaseSmokeOutput(stderr),
  };
}

function isLlmSecretStoreSmokeReady(smoke) {
  if (smoke?.platformApplicable === false) {
    return smoke.success === true;
  }
  return smoke?.skipped === false && smoke.success === true;
}

function createRustSmokeEvidence({
  rootDir,
  cargoManifestPath,
  cargoTargetDir,
  ffmpegExecutablePath,
  skipRustSmoke,
  runCommand,
}) {
  const command = 'cargo';
  const args = [
    `+${rustToolchain}`,
    'test',
    '--manifest-path',
    toPosixRelative(rootDir, cargoManifestPath),
    '--',
    '--nocapture',
  ];
  const commandLine = [command, ...args].join(' ');
  if (skipRustSmoke) {
    return {
      skipped: true,
      success: false,
      status: null,
      command: commandLine,
      stdout: '',
      stderr: '',
    };
  }

  const result = runAutoCutNativeReleaseSmokeCargoCommand({
    command,
    args,
    rootDir,
    cargoTargetDir,
    env: ffmpegExecutablePath ? { SDKWORK_AUTOCUT_FFMPEG: ffmpegExecutablePath } : {},
    runCommand,
  });
  const status = Number.isInteger(result.status) ? result.status : 1;
  const stdout = String(result.stdout ?? '');
  const stderr = String(result.stderr ?? '');
  if (status !== 0) {
    const detail = stderr.trim() || stdout.trim() || `exit ${status}`;
    throw new Error(`AutoCut native release smoke failed: ${detail}`);
  }

  return {
    skipped: false,
    success: true,
    status,
    attempts: result.attempts,
    retryDiagnostics: result.retryDiagnostics,
    command: commandLine,
    stdout: trimReleaseSmokeOutput(stdout),
    stderr: trimReleaseSmokeOutput(stderr),
  };
}

function createVideoSliceSmokeEvidence({
  rootDir,
  cargoManifestPath,
  cargoTargetDir,
  ffmpegExecutablePath,
  skipRustSmoke,
  runCommand,
}) {
  const testName = 'media_runtime::tests::video_slice_from_asset_registers_each_slice_artifact_inside_task_output_dir';
  const command = 'cargo';
  const args = [
    `+${rustToolchain}`,
    'test',
    '--manifest-path',
    toPosixRelative(rootDir, cargoManifestPath),
    testName,
    '--',
    '--exact',
    '--test-threads=1',
    '--nocapture',
  ];
  const commandLine = [command, ...args].join(' ');
  if (skipRustSmoke) {
    return {
      skipped: true,
      success: false,
      status: null,
      command: commandLine,
      stdout: '',
      stderr: '',
    };
  }

  const result = runAutoCutNativeReleaseSmokeCargoCommand({
    command,
    args,
    rootDir,
    cargoTargetDir,
    env: ffmpegExecutablePath ? { SDKWORK_AUTOCUT_FFMPEG: ffmpegExecutablePath } : {},
    runCommand,
  });
  const status = Number.isInteger(result.status) ? result.status : 1;
  const stdout = String(result.stdout ?? '');
  const stderr = String(result.stderr ?? '');
  if (status !== 0) {
    const detail = stderr.trim() || stdout.trim() || `exit ${status}`;
    throw new Error(`AutoCut native video slice smoke failed: ${detail}`);
  }

  if (!stdout.includes('autocut-video-slice-smoke=passed')) {
    throw new Error('AutoCut native video slice smoke did not emit the required success marker.');
  }

  return {
    skipped: false,
    success: true,
    status,
    attempts: result.attempts,
    retryDiagnostics: result.retryDiagnostics,
    command: commandLine,
    stdout: trimReleaseSmokeOutput(stdout),
    stderr: trimReleaseSmokeOutput(stderr),
  };
}

function runAutoCutNativeReleaseSmokeCargoCommand({
  command,
  args,
  rootDir,
  cargoTargetDir,
  env,
  runCommand,
}) {
  const maxAttempts = 2;
  const retryDiagnostics = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = runCommand(command, args, {
      cwd: rootDir,
      env: {
        CARGO_TARGET_DIR: cargoTargetDir,
        ...(env ?? {}),
      },
    });
    const status = Number.isInteger(result.status) ? result.status : 1;
    const stdout = String(result.stdout ?? '');
    const stderr = String(result.stderr ?? '');
    if (status === 0 || attempt === maxAttempts || !isRustCompilerCrash({ stdout, stderr })) {
      return {
        ...result,
        attempts: attempt,
        retryDiagnostics,
      };
    }
    retryDiagnostics.push(trimReleaseSmokeOutput(stderr.trim() || stdout.trim() || `exit ${status}`));
  }
  throw new Error('unreachable AutoCut native release smoke retry state');
}

function isRustCompilerCrash({ stdout, stderr }) {
  const output = `${stderr}\n${stdout}`;
  return (
    /the compiler unexpectedly panicked/u.test(output) ||
    /STATUS_ACCESS_VIOLATION/u.test(output) ||
    /exit code: 0xc0000005/u.test(output)
  );
}

function createAutoCutNativeSmokeCargoTargetDir(rootDir, generatedAt) {
  const sanitizedTimestamp = generatedAt.replace(/[^0-9A-Za-z]+/gu, '');
  const suffix = sanitizedTimestamp || String(Date.now());
  const targetDir = path.join(os.tmpdir(), `${nativeSmokeCargoTargetDirPrefix}${suffix}`);
  const resolvedTargetDir = path.resolve(targetDir);
  const resolvedRootDir = path.resolve(rootDir);
  if (resolvedTargetDir.startsWith(`${resolvedRootDir}${path.sep}`)) {
    throw new Error('AutoCut native smoke Cargo target directory must stay outside the workspace.');
  }
  fs.mkdirSync(resolvedTargetDir, { recursive: true });
  return resolvedTargetDir;
}

function resolveAutoCutNativeSmokeFfmpegExecutablePath({ rootDir, hostPlatform, hostArch }) {
  const manifestPath = path.join(rootDir, ffmpegToolchainManifestRelativePath);
  if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) {
    return undefined;
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const platformKey = createAutoCutNativeSmokePlatformKey(hostPlatform, hostArch);
  const relativePath = manifest.platforms?.[platformKey]?.relativePath;
  if (typeof relativePath !== 'string' || relativePath.trim() === '') {
    return undefined;
  }

  const executablePath = path.resolve(path.dirname(manifestPath), relativePath);
  if (!fs.existsSync(executablePath) || !fs.statSync(executablePath).isFile()) {
    return undefined;
  }

  return executablePath;
}

function createAutoCutNativeSmokePlatformKey(hostPlatform, hostArch) {
  const osKey = {
    darwin: 'macos',
    linux: 'linux',
    win32: 'windows',
  }[hostPlatform] ?? hostPlatform;
  const archKey = {
    arm64: 'aarch64',
    x64: 'x86_64',
  }[hostArch] ?? hostArch;
  return `${osKey}-${archKey}`;
}

function createNativeCommandMatrix({ rustSmokeReady, videoSliceSmokeReady, llmSecretStoreSmokeReady }) {
  return [
    {
      command: 'autocut_host_capabilities',
      purpose: 'native host contract and supported command inventory',
      evidenceSource: 'host_contract::tests::capabilities_report_ffmpeg_toolchain_contract_without_claiming_execution',
      evidenceReady: rustSmokeReady,
    },
    {
      command: 'autocut_ffmpeg_probe',
      purpose: 'FFmpeg resolver and probe boundary without claiming execution readiness',
      evidenceSource: 'media_runtime::probe_autocut_ffmpeg plus release smoke preflight manifest checks',
      evidenceReady: rustSmokeReady,
    },
    {
      command: 'autocut_audio_smoke',
      purpose: 'deterministic FFmpeg sine-source audio extraction smoke',
      evidenceSource: 'media_runtime::tests::audio_smoke_generates_non_empty_artifact_with_ffmpeg',
      evidenceReady: rustSmokeReady,
    },
    {
      command: 'autocut_slice_video',
      purpose: 'real FFmpeg video slicing, task-scoped slice artifacts, thumbnails, task output JSON, and database stage completion',
      evidenceSource: 'media_runtime::tests::video_slice_from_asset_registers_each_slice_artifact_inside_task_output_dir',
      evidenceReady: videoSliceSmokeReady,
    },
    {
      command: 'autocut_recover_native_tasks',
      purpose: 'durable task recovery, expired worker lease, and deferred active lease behavior',
      evidenceSource: 'media_runtime::tests::native_task_recovery_*',
      evidenceReady: rustSmokeReady,
    },
    {
      command: 'autocut_save_llm_secret',
      purpose: 'native Windows credential manager write path for desktop LLM API keys',
      evidenceSource: 'llm_secret_runtime::tests::real_windows_keyring_store_saves_reads_and_deletes_llm_secret',
      evidenceReady: llmSecretStoreSmokeReady,
    },
    {
      command: 'autocut_get_llm_secret',
      purpose: 'native Windows credential manager read path for desktop LLM API key restoration',
      evidenceSource: 'llm_secret_runtime::tests::real_windows_keyring_store_saves_reads_and_deletes_llm_secret',
      evidenceReady: llmSecretStoreSmokeReady,
    },
    {
      command: 'autocut_delete_llm_secret',
      purpose: 'native Windows credential manager delete path for desktop LLM API key clearing',
      evidenceSource: 'llm_secret_runtime::tests::real_windows_keyring_store_saves_reads_and_deletes_llm_secret',
      evidenceReady: llmSecretStoreSmokeReady,
    },
  ];
}

function isAutoCutTruthyFlag(value) {
  return /^(?:1|true|yes)$/iu.test(String(value ?? '').trim());
}

function parseCargoPackageName(source) {
  const packageNameMatch = source.match(/^\s*name\s*=\s*"([^"]+)"/mu);
  if (!packageNameMatch) {
    throw new Error('AutoCut native host Cargo manifest must declare package.name.');
  }
  return packageNameMatch[1];
}

function trimReleaseSmokeOutput(output) {
  const maxLength = 20000;
  if (output.length <= maxLength) {
    return output;
  }
  return `${output.slice(0, maxLength)}\n[autocut-release-smoke-output-truncated]`;
}

function toPosixRelative(rootDir, targetPath) {
  return path.relative(rootDir, targetPath).replaceAll(path.sep, '/');
}

function parseArgs(argv) {
  const options = {};
  const args = normalizeAutoCutCliArgs(argv);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--output') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut native release smoke',
      });
      options.outputPath = option.value;
      index = option.nextIndex;
    } else if (arg === '--skip-rust-smoke') {
      options.skipRustSmoke = true;
    } else if (arg === '--run-real-llm-secret-smoke') {
      options.runRealLlmSecretSmoke = true;
    } else {
      throw new Error(`Unknown AutoCut native release smoke argument: ${arg}`);
    }
  }
  return options;
}

function main() {
  const result = writeAutoCutNativeReleaseSmokeEvidence(parseArgs(process.argv.slice(2)));
  console.log(formatAutoCutNativeReleaseSmokeEvidenceMessage(result));
}

if (path.resolve(process.argv[1] ?? '') === __filename) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
