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
import {
  normalizeAutoCutReleasePlatform,
} from './autocut-release-platforms.mjs';
import {
  prepareAutoCutFfmpegSidecar,
} from './prepare-autocut-ffmpeg-sidecar.mjs';
import {
  prepareAutoCutSpeechSidecar,
} from './prepare-autocut-speech-sidecar.mjs';

const __filename = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(__filename), '..');
const defaultCacheDir = path.join(process.env.RUNNER_TEMP || process.env.TEMP || process.env.TMP || path.join(repositoryRoot, '.tmp'), 'autocut-release-sidecars');
const ffmpegStaticReleaseTag = 'b6.1.1';
const whisperCppReleaseTag = 'v1.8.4';

const sidecarSourcesByPlatform = {
  'windows-x86_64': {
    ffmpeg: {
      url: `https://github.com/eugeneware/ffmpeg-static/releases/download/${ffmpegStaticReleaseTag}/ffmpeg-win32-x64`,
      sha256: process.env.SDKWORK_AUTOCUT_RELEASE_FFMPEG_WINDOWS_X86_64_SHA256 || '04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00',
      archiveKind: 'raw',
      executableRelativePath: 'ffmpeg.exe',
    },
    speech: {
      url: `https://github.com/ggml-org/whisper.cpp/releases/download/${whisperCppReleaseTag}/whisper-bin-x64.zip`,
      sha256: process.env.SDKWORK_AUTOCUT_RELEASE_WHISPER_WINDOWS_X86_64_SHA256 || '74f973345cb52ef5ba3ec9e7e7af8e48cc8c71722d1528603b80588a11f82e3e',
      archiveKind: 'zip',
      executableRelativePath: 'Release/whisper-cli.exe',
    },
  },
  'linux-x86_64': {
    ffmpeg: {
      url: `https://github.com/eugeneware/ffmpeg-static/releases/download/${ffmpegStaticReleaseTag}/ffmpeg-linux-x64`,
      sha256: process.env.SDKWORK_AUTOCUT_RELEASE_FFMPEG_LINUX_X86_64_SHA256 || 'e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99',
      archiveKind: 'raw',
      executableRelativePath: 'ffmpeg',
    },
    speech: {
      buildFromSource: true,
      repository: 'https://github.com/ggml-org/whisper.cpp.git',
      tag: whisperCppReleaseTag,
      executableRelativePath: 'build/bin/whisper-cli',
      cmakeArgs: ['-DBUILD_SHARED_LIBS=OFF'],
    },
  },
  'macos-x86_64': {
    ffmpeg: {
      url: `https://github.com/eugeneware/ffmpeg-static/releases/download/${ffmpegStaticReleaseTag}/ffmpeg-darwin-x64`,
      sha256: process.env.SDKWORK_AUTOCUT_RELEASE_FFMPEG_MACOS_X86_64_SHA256 || 'ebdddc936f61e14049a2d4b549a412b8a40deeff6540e58a9f2a2da9e6b18894',
      archiveKind: 'raw',
      executableRelativePath: 'ffmpeg',
    },
    speech: {
      buildFromSource: true,
      repository: 'https://github.com/ggml-org/whisper.cpp.git',
      tag: whisperCppReleaseTag,
      executableRelativePath: 'build/bin/whisper-cli',
      cmakeArgs: ['-DBUILD_SHARED_LIBS=OFF', '-DWHISPER_COREML=OFF'],
    },
  },
  'macos-aarch64': {
    ffmpeg: {
      url: `https://github.com/eugeneware/ffmpeg-static/releases/download/${ffmpegStaticReleaseTag}/ffmpeg-darwin-arm64`,
      sha256: process.env.SDKWORK_AUTOCUT_RELEASE_FFMPEG_MACOS_AARCH64_SHA256 || 'a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584',
      archiveKind: 'raw',
      executableRelativePath: 'ffmpeg',
    },
    speech: {
      buildFromSource: true,
      repository: 'https://github.com/ggml-org/whisper.cpp.git',
      tag: whisperCppReleaseTag,
      executableRelativePath: 'build/bin/whisper-cli',
      cmakeArgs: ['-DBUILD_SHARED_LIBS=OFF', '-DWHISPER_COREML=OFF'],
    },
  },
};

export function prepareAutoCutReleaseSidecars({
  platform,
  rootDir = repositoryRoot,
  cacheDir = defaultCacheDir,
  acceptLicense = false,
  runCommand = runAutoCutReleaseSidecarCommand,
} = {}) {
  const normalizedPlatform = normalizeAutoCutReleasePlatform(requiredString(platform, '--platform'));
  if (!acceptLicense) {
    throw new Error('AutoCut release sidecar preparation requires --accept-license to confirm FFmpeg and whisper.cpp license obligations.');
  }

  const sourceSpec = sidecarSourcesByPlatform[normalizedPlatform];
  if (!sourceSpec) {
    throw new Error(`No AutoCut release sidecar source is registered for ${normalizedPlatform}.`);
  }

  const resolvedRootDir = path.resolve(rootDir);
  const platformCacheDir = path.resolve(cacheDir, normalizedPlatform);
  fs.mkdirSync(platformCacheDir, { recursive: true });

  const ffmpegSource = materializeReleaseSidecarSource({
    cacheDir: platformCacheDir,
    name: 'ffmpeg',
    platform: normalizedPlatform,
    spec: sourceSpec.ffmpeg,
    runCommand,
  });
  const speechSource = materializeReleaseSidecarSource({
    cacheDir: platformCacheDir,
    name: 'whisper-cli',
    platform: normalizedPlatform,
    spec: sourceSpec.speech,
    runCommand,
  });

  const ffmpegPlan = prepareAutoCutFfmpegSidecar({
    manifestPath: path.join(
      resolvedRootDir,
      'packages',
      'sdkwork-autocut-desktop',
      'src-tauri',
      'binaries',
      'ffmpeg.toolchain.json',
    ),
    platform: normalizedPlatform,
    sourcePath: ffmpegSource.executablePath,
    acceptLicense: true,
  });
  const speechPlan = prepareAutoCutSpeechSidecar({
    manifestPath: path.join(
      resolvedRootDir,
      'packages',
      'sdkwork-autocut-desktop',
      'src-tauri',
      'binaries',
      'speech-transcription.toolchain.json',
    ),
    platform: normalizedPlatform,
    sourcePath: speechSource.executablePath,
    acceptLicense: true,
  });

  ensureExecutableBitIfNeeded(ffmpegPlan.destinationPath, normalizedPlatform);
  ensureExecutableBitIfNeeded(speechPlan.destinationPath, normalizedPlatform);
  for (const companionFile of speechPlan.companionFiles ?? []) {
    ensureExecutableBitIfNeeded(companionFile.destinationPath, normalizedPlatform);
  }

  return {
    platform: normalizedPlatform,
    ffmpeg: {
      source: ffmpegSource,
      plan: ffmpegPlan,
    },
    speech: {
      source: speechSource,
      plan: speechPlan,
    },
  };
}

export function formatAutoCutReleaseSidecarsMessage(result) {
  return [
    `ok - autocut release sidecars platform=${result.platform}`,
    `ffmpegSha256=${result.ffmpeg.plan.sha256}`,
    `speechSha256=${result.speech.plan.sha256}`,
  ].join(' ');
}

function materializeReleaseSidecarSource({
  cacheDir,
  name,
  platform,
  spec,
  runCommand,
}) {
  if (spec.buildFromSource) {
    return buildWhisperSidecarFromSource({
      cacheDir,
      platform,
      spec,
      runCommand,
    });
  }

  const downloadPath = path.join(cacheDir, path.basename(new URL(spec.url).pathname));
  downloadFile({
    url: spec.url,
    outputPath: downloadPath,
    expectedSha256: spec.sha256,
    runCommand,
  });

  if (spec.archiveKind === 'raw') {
    const executablePath = path.join(cacheDir, spec.executableRelativePath);
    fs.copyFileSync(downloadPath, executablePath);
    ensureExecutableBitIfNeeded(executablePath, platform);
    return {
      sourceKind: 'download',
      url: spec.url,
      archivePath: downloadPath,
      executablePath,
    };
  }

  if (spec.archiveKind === 'zip') {
    const extractDir = path.join(cacheDir, `${name}-extract`);
    fs.rmSync(extractDir, { recursive: true, force: true });
    fs.mkdirSync(extractDir, { recursive: true });
    extractZip(downloadPath, extractDir, runCommand);
    const executablePath = path.join(extractDir, ...spec.executableRelativePath.split('/'));
    if (!fs.existsSync(executablePath) || !fs.statSync(executablePath).isFile()) {
      throw new Error(`AutoCut ${name} archive did not contain ${spec.executableRelativePath}.`);
    }
    ensureExecutableBitIfNeeded(executablePath, platform);
    return {
      sourceKind: 'download',
      url: spec.url,
      archivePath: downloadPath,
      executablePath,
    };
  }

  throw new Error(`Unsupported AutoCut ${name} sidecar archive kind: ${spec.archiveKind}.`);
}

function buildWhisperSidecarFromSource({ cacheDir, platform, spec, runCommand }) {
  const sourceDir = path.join(cacheDir, 'whisper.cpp');
  if (!fs.existsSync(path.join(sourceDir, '.git'))) {
    runRequiredCommand(runCommand, 'git', [
      'clone',
      '--depth',
      '1',
      '--branch',
      spec.tag,
      spec.repository,
      sourceDir,
    ], { cwd: cacheDir });
  } else {
    runRequiredCommand(runCommand, 'git', ['fetch', '--depth', '1', 'origin', spec.tag], { cwd: sourceDir });
    runRequiredCommand(runCommand, 'git', ['checkout', 'FETCH_HEAD'], { cwd: sourceDir });
  }

  const buildDir = path.join(sourceDir, 'build');
  fs.mkdirSync(buildDir, { recursive: true });
  const cmakeConfigureArgs = [
    '-S',
    sourceDir,
    '-B',
    buildDir,
    '-DCMAKE_BUILD_TYPE=Release',
    '-DWHISPER_BUILD_TESTS=OFF',
    '-DWHISPER_BUILD_EXAMPLES=ON',
    '-DWHISPER_BUILD_SERVER=OFF',
    ...(spec.cmakeArgs ?? []),
  ];
  runRequiredCommand(runCommand, 'cmake', cmakeConfigureArgs, { cwd: sourceDir });
  runRequiredCommand(runCommand, 'cmake', ['--build', buildDir, '--config', 'Release', '--target', 'whisper-cli', '--parallel'], { cwd: sourceDir });

  const executablePath = path.join(sourceDir, ...spec.executableRelativePath.split('/'));
  if (!fs.existsSync(executablePath) || !fs.statSync(executablePath).isFile()) {
    throw new Error(`AutoCut ${platform} whisper.cpp build did not produce ${spec.executableRelativePath}.`);
  }
  ensureExecutableBitIfNeeded(executablePath, platform);
  return {
    sourceKind: 'source-build',
    repository: spec.repository,
    tag: spec.tag,
    executablePath,
  };
}

function downloadFile({ url, outputPath, expectedSha256, runCommand }) {
  const tempPath = `${outputPath}.tmp`;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const result = runCommand('node', [
    '--input-type=module',
    '-e',
    [
      "import fs from 'node:fs';",
      'const [url, outputPath] = process.argv.slice(1);',
      'const response = await fetch(url);',
      'if (!response.ok) { throw new Error(`download failed ${response.status} ${response.statusText}`); }',
      'const bytes = Buffer.from(await response.arrayBuffer());',
      'fs.writeFileSync(outputPath, bytes);',
    ].join(' '),
    url,
    tempPath,
  ], { cwd: repositoryRoot });
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
    throw new Error(`AutoCut sidecar download failed for ${url}: ${detail}`);
  }
  const sha256 = sha256File(tempPath);
  if (sha256 !== expectedSha256) {
    fs.rmSync(tempPath, { force: true });
    throw new Error(`AutoCut sidecar download checksum mismatch for ${url}: expected ${expectedSha256}, got ${sha256}.`);
  }
  fs.renameSync(tempPath, outputPath);
}

function extractZip(archivePath, destinationDir, runCommand) {
  if (process.platform === 'win32') {
    runRequiredCommand(runCommand, 'powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath ${toPowerShellSingleQuotedString(archivePath)} -DestinationPath ${toPowerShellSingleQuotedString(destinationDir)} -Force`,
    ], { cwd: repositoryRoot });
    return;
  }
  runRequiredCommand(runCommand, 'unzip', ['-q', archivePath, '-d', destinationDir], { cwd: repositoryRoot });
}

function runAutoCutReleaseSidecarCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? (result.error ? result.error.message : ''),
  };
}

function runRequiredCommand(runCommand, command, args, options = {}) {
  const result = runCommand(command, args, options);
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
    throw new Error(`AutoCut sidecar command failed: ${command} ${args.join(' ')}\n${detail}`);
  }
  return result;
}

function ensureExecutableBitIfNeeded(filePath, platform) {
  if (!platform.startsWith('windows-')) {
    const currentMode = fs.statSync(filePath).mode;
    fs.chmodSync(filePath, currentMode | 0o755);
  }
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function toPowerShellSingleQuotedString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function requiredString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`AutoCut release sidecar preparation requires ${name}.`);
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
    } else if (arg === '--platform') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut release sidecar preparation',
      });
      options.platform = option.value;
      index = option.nextIndex;
    } else if (arg === '--cache-dir') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut release sidecar preparation',
      });
      options.cacheDir = option.value;
      index = option.nextIndex;
    } else {
      throw new Error(`Unknown AutoCut release sidecar preparation argument: ${arg}`);
    }
  }
  return options;
}

function main() {
  const result = prepareAutoCutReleaseSidecars(parseArgs(process.argv.slice(2)));
  console.log(formatAutoCutReleaseSidecarsMessage(result));
}

if (path.resolve(process.argv[1] ?? '') === __filename) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
