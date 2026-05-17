#!/usr/bin/env node

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
  createAutoCutHostPlatformKey,
  prepareAutoCutSpeechSidecar,
} from './prepare-autocut-speech-sidecar.mjs';
import {
  runAutoCutLargeMediaSttBaseline,
} from './write-autocut-large-media-stt-baseline.mjs';

const __filename = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(__filename), '..');
const schema = 'smart-slice.speech-gpu-runtime.v1';
const defaultReportPath = path.join(
  repositoryRoot,
  'artifacts',
  'autocut-diagnostics',
  'speech-gpu-runtime',
  'speech-gpu-runtime.json',
);
const defaultBenchmarkOutputDir = path.join(
  repositoryRoot,
  'artifacts',
  'autocut-diagnostics',
  'speech-gpu-runtime',
  'stt-benchmark',
);
const gpuBackends = new Set([
  'cuda',
  'vulkan',
  'metal',
  'coreml',
  'openvino',
  'kompute',
]);
const backendCompanionFragments = {
  cuda: ['ggml-cuda', 'cublas', 'cudart'],
  vulkan: ['ggml-vulkan', 'vulkan'],
  metal: ['ggml-metal', 'metal'],
  coreml: ['coreml', 'core-ml'],
  openvino: ['openvino'],
  kompute: ['ggml-kompute', 'kompute'],
};
const runtimeFileNames = process.platform === 'win32'
  ? ['whisper-cli.exe', 'whisper.exe', 'main.exe']
  : ['whisper-cli', 'whisper', 'main'];
const skippedSearchDirectories = new Set([
  '.git',
  '.next',
  '.turbo',
  '.vite',
  'node_modules',
  'target',
]);

export async function prepareAutoCutSpeechGpuRuntime(options = {}) {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const rootDir = path.resolve(options.rootDir ?? repositoryRoot);
  const reportPath = path.resolve(options.reportPath ?? defaultReportPath);
  const platform = options.platform ?? createAutoCutHostPlatformKey();
  const requestedBackend = normalizeOptionalGpuBackend(options.accelerationBackend);
  const runCommand = options.runCommand ?? runAutoCutSpeechGpuRuntimeCommand;
  const prepareSpeechSidecar = options.prepareSpeechSidecar ?? prepareAutoCutSpeechSidecar;
  const runSttBaseline = options.runSttBaseline ?? runAutoCutLargeMediaSttBaseline;
  const blockers = [];

  const environment = {
    nvidia: probeCommand({
      name: 'nvidia',
      command: 'nvidia-smi',
      args: [],
      runCommand,
      readyPattern: /NVIDIA|CUDA/iu,
    }),
    cudaToolkit: probeCommand({
      name: 'cudaToolkit',
      command: 'nvcc',
      args: ['--version'],
      runCommand,
      readyPattern: /cuda compilation tools|release\s+\d/iu,
    }),
    cmake: probeCommand({
      name: 'cmake',
      command: 'cmake',
      args: ['--version'],
      runCommand,
      readyPattern: /cmake version/iu,
      required: false,
    }),
  };

  let sourceRuntimePath = normalizeOptionalPath(options.runtimePath);
  let build = createSkippedStep('not requested');
  if (!sourceRuntimePath && normalizeOptionalPath(options.sourceDir)) {
    build = buildWhisperCppRuntime({
      sourceDir: normalizeOptionalPath(options.sourceDir),
      buildDir: normalizeOptionalPath(options.buildDir) ??
        path.join(rootDir, 'artifacts', 'autocut-diagnostics', 'speech-gpu-runtime', 'whisper-cpp-build'),
      backend: requestedBackend ?? 'cuda',
      runCommand,
    });
    if (build.ready) {
      sourceRuntimePath = build.runtimePath;
    } else {
      blockers.push({
        code: 'AUTOCUT_SPEECH_GPU_RUNTIME_BUILD_FAILED',
        message: build.diagnostic,
      });
    }
  }

  const discovery = sourceRuntimePath
    ? createDirectRuntimeDiscovery(sourceRuntimePath)
    : discoverGpuWhisperRuntime({
      rootDir,
      searchRoots: options.searchRoots,
      backend: requestedBackend,
    });
  const runtime = inspectGpuWhisperRuntime({
    runtimePath: sourceRuntimePath ?? discovery.runtimePath,
    requestedBackend,
  });

  if (!runtime.ready && blockers.length === 0) {
    blockers.push({
      code: discovery.runtimePath
        ? 'AUTOCUT_SPEECH_GPU_RUNTIME_UNVERIFIED'
        : 'AUTOCUT_SPEECH_GPU_RUNTIME_MISSING',
      message: runtime.diagnostic,
    });
  }

  let packaged = createSkippedStep('GPU runtime is not verified');
  if (runtime.ready) {
    if (options.acceptLicense !== true) {
      blockers.push({
        code: 'AUTOCUT_SPEECH_GPU_RUNTIME_LICENSE_NOT_ACCEPTED',
        message: 'GPU whisper.cpp sidecar packaging requires --accept-license to confirm upstream license obligations.',
      });
      packaged = createSkippedStep('license acceptance is required before packaging');
    } else {
      try {
        const plan = prepareSpeechSidecar({
          platform,
          sourcePath: runtime.path,
          accelerationBackend: runtime.backend,
          acceptLicense: true,
          ...(normalizeOptionalPath(options.manifestPath) ? { manifestPath: normalizeOptionalPath(options.manifestPath) } : {}),
        });
        packaged = {
          ready: true,
          platform: plan.platform,
          sourcePath: plan.sourcePath,
          destinationPath: plan.destinationPath,
          accelerationBackend: plan.accelerationBackend,
          companionCount: Array.isArray(plan.companionFiles) ? plan.companionFiles.length : 0,
        };
      } catch (error) {
        packaged = {
          ready: false,
          diagnostic: formatErrorMessage(error),
        };
        blockers.push({
          code: 'AUTOCUT_SPEECH_GPU_RUNTIME_PACKAGE_FAILED',
          message: packaged.diagnostic,
        });
      }
    }
  }

  const benchmark = await runOptionalGpuBenchmark({
    packaged,
    benchmarkInputPath: normalizeOptionalPath(options.benchmarkInputPath),
    modelPath: normalizeOptionalPath(options.modelPath),
    benchmarkOutputDir: path.resolve(options.benchmarkOutputDir ?? defaultBenchmarkOutputDir),
    language: options.language ?? 'zh',
    sourceDirect: options.sourceDirect === true,
    forceChunked: options.forceChunked === true,
    audioDurationMs: normalizePositiveInteger(options.audioDurationMs),
    chunkDurationMs: normalizePositiveInteger(options.chunkDurationMs),
    chunkOverlapMs: normalizeNonNegativeInteger(options.chunkOverlapMs),
    parallelism: normalizePositiveInteger(options.parallelism),
    chunkThreadCount: normalizePositiveInteger(options.chunkThreadCount),
    runSttBaseline,
  });

  const report = {
    schema,
    generatedAt,
    rootDir,
    platform,
    requestedBackend: requestedBackend ?? '',
    environment,
    discovery,
    build,
    runtime,
    package: packaged,
    benchmark,
    ready: blockers.length === 0 && runtime.ready && packaged.ready && (benchmark.ready || !benchmark.requested),
    blockers,
  };

  if (options.writeReport !== false) {
    writeJsonAtomic(reportPath, report);
    report.reportPath = reportPath;
  }
  return report;
}

export function formatAutoCutSpeechGpuRuntimeMessage(report) {
  if (report.ready) {
    return [
      `ok - autocut speech gpu runtime backend=${report.runtime.backend}`,
      `packaged=${Boolean(report.package.ready)}`,
      `benchmark=${Boolean(report.benchmark.ready)}`,
      `report=${report.reportPath ?? ''}`.trim(),
    ].filter(Boolean).join(' ');
  }
  return [
    'blocked - autocut speech gpu runtime',
    `backend=${report.runtime.backend || report.requestedBackend || 'unknown'}`,
    `blockers=${report.blockers.length}`,
    `codes=${report.blockers.map((blocker) => blocker.code).join(',')}`,
    `report=${report.reportPath ?? ''}`.trim(),
  ].filter(Boolean).join(' ');
}

function probeCommand({
  name,
  command,
  args,
  runCommand,
  readyPattern,
  required = true,
}) {
  const result = runCommand(command, args);
  const output = normalizeCommandOutput(`${result?.stdout ?? ''}\n${result?.stderr ?? ''}`);
  const ready = result?.status === 0 && (!readyPattern || readyPattern.test(output));
  return {
    name,
    command,
    ready,
    required,
    status: result?.status ?? null,
    diagnostic: ready ? output || `${command} is available.` : output || result?.error || `${command} is not available.`,
  };
}

function buildWhisperCppRuntime({
  sourceDir,
  buildDir,
  backend,
  runCommand,
}) {
  const resolvedSourceDir = path.resolve(sourceDir);
  const resolvedBuildDir = path.resolve(buildDir);
  if (!fs.existsSync(path.join(resolvedSourceDir, 'CMakeLists.txt'))) {
    return {
      ready: false,
      sourceDir: resolvedSourceDir,
      buildDir: resolvedBuildDir,
      backend,
      diagnostic: `whisper.cpp source directory is missing CMakeLists.txt: ${resolvedSourceDir}`,
    };
  }

  fs.mkdirSync(resolvedBuildDir, { recursive: true });
  const configureArgs = [
    '-S',
    resolvedSourceDir,
    '-B',
    resolvedBuildDir,
    '-DCMAKE_BUILD_TYPE=Release',
    '-DWHISPER_BUILD_TESTS=OFF',
    '-DWHISPER_BUILD_EXAMPLES=ON',
    '-DBUILD_SHARED_LIBS=ON',
    ...createBackendCmakeFlags(backend),
  ];
  const configure = runCommand('cmake', configureArgs, { cwd: resolvedSourceDir });
  if (configure.status !== 0) {
    return {
      ready: false,
      sourceDir: resolvedSourceDir,
      buildDir: resolvedBuildDir,
      backend,
      diagnostic: `cmake configure failed: ${commandDiagnostic(configure)}`,
      configureArgs,
    };
  }

  const buildArgs = ['--build', resolvedBuildDir, '--config', 'Release', '--target', 'whisper-cli', '--parallel'];
  const build = runCommand('cmake', buildArgs, { cwd: resolvedSourceDir });
  if (build.status !== 0) {
    return {
      ready: false,
      sourceDir: resolvedSourceDir,
      buildDir: resolvedBuildDir,
      backend,
      diagnostic: `cmake build failed: ${commandDiagnostic(build)}`,
      configureArgs,
      buildArgs,
    };
  }

  const runtimePath = findFirstRuntimeExecutable(resolvedBuildDir);
  if (!runtimePath) {
    return {
      ready: false,
      sourceDir: resolvedSourceDir,
      buildDir: resolvedBuildDir,
      backend,
      diagnostic: `cmake build completed but whisper-cli was not found under ${resolvedBuildDir}`,
      configureArgs,
      buildArgs,
    };
  }

  return {
    ready: true,
    sourceDir: resolvedSourceDir,
    buildDir: resolvedBuildDir,
    backend,
    runtimePath,
    configureArgs,
    buildArgs,
    diagnostic: 'whisper.cpp GPU runtime built successfully.',
  };
}

function createBackendCmakeFlags(backend) {
  if (backend === 'cuda') {
    return ['-DGGML_CUDA=ON'];
  }
  if (backend === 'vulkan') {
    return ['-DGGML_VULKAN=ON'];
  }
  if (backend === 'openvino') {
    return ['-DGGML_OPENVINO=ON'];
  }
  if (backend === 'kompute') {
    return ['-DGGML_KOMPUTE=ON'];
  }
  return [];
}

function createDirectRuntimeDiscovery(runtimePath) {
  return {
    mode: 'direct',
    searchRoots: [],
    runtimePath: path.resolve(runtimePath),
    inspectedCandidateCount: 1,
    rejectedCandidates: [],
  };
}

function discoverGpuWhisperRuntime({
  rootDir,
  searchRoots,
  backend,
}) {
  const roots = normalizeSearchRoots({ rootDir, searchRoots });
  const rejectedCandidates = [];
  let inspectedCandidateCount = 0;
  for (const searchRoot of roots) {
    for (const candidatePath of findRuntimeExecutableCandidates(searchRoot)) {
      inspectedCandidateCount += 1;
      const inspected = inspectGpuWhisperRuntime({
        runtimePath: candidatePath,
        requestedBackend: backend,
      });
      if (inspected.ready) {
        return {
          mode: 'search',
          searchRoots: roots,
          runtimePath: inspected.path,
          inspectedCandidateCount,
          rejectedCandidates,
        };
      }
      rejectedCandidates.push({
        path: candidatePath,
        diagnostic: inspected.diagnostic,
      });
    }
  }
  return {
    mode: 'search',
    searchRoots: roots,
    runtimePath: '',
    inspectedCandidateCount,
    rejectedCandidates: rejectedCandidates.slice(0, 20),
  };
}

function normalizeSearchRoots({ rootDir, searchRoots }) {
  const values = Array.isArray(searchRoots) && searchRoots.length > 0
    ? searchRoots
    : [
      rootDir,
      process.env.SDKWORK_AUTOCUT_GPU_WHISPER_ROOT,
      process.env.SDKWORK_AUTOCUT_WHISPER_ROOT,
      process.platform === 'win32' ? 'D:\\tools' : '/opt',
      process.platform === 'win32' ? 'C:\\tools' : '/usr/local',
      process.platform === 'win32' ? 'D:\\tmp' : '/tmp',
    ];
  return [...new Set(values
    .map((value) => normalizeOptionalPath(value))
    .filter((value) => value && fs.existsSync(value) && fs.statSync(value).isDirectory())
    .map((value) => path.resolve(value)))];
}

function findRuntimeExecutableCandidates(searchRoot) {
  const candidates = [];
  const queue = [{ directory: path.resolve(searchRoot), depth: 0 }];
  let visited = 0;
  while (queue.length > 0 && visited < 12_000 && candidates.length < 100) {
    const { directory, depth } = queue.shift();
    visited += 1;
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isFile() && runtimeFileNames.includes(entry.name.toLowerCase())) {
        candidates.push(entryPath);
      } else if (entry.isDirectory() && depth < 8 && !skippedSearchDirectories.has(entry.name)) {
        queue.push({ directory: entryPath, depth: depth + 1 });
      }
    }
  }
  return candidates;
}

function inspectGpuWhisperRuntime({
  runtimePath,
  requestedBackend,
}) {
  const resolvedRuntimePath = normalizeOptionalPath(runtimePath);
  if (!resolvedRuntimePath) {
    return {
      ready: false,
      path: '',
      backend: requestedBackend ?? '',
      companionFiles: [],
      diagnostic: 'No GPU-enabled whisper-cli runtime was found. Provide --runtime or --source-dir for a CUDA/Vulkan whisper.cpp build.',
    };
  }
  if (!fs.existsSync(resolvedRuntimePath) || !fs.statSync(resolvedRuntimePath).isFile()) {
    return {
      ready: false,
      path: resolvedRuntimePath,
      backend: requestedBackend ?? '',
      companionFiles: [],
      diagnostic: `whisper-cli runtime is missing or not a file: ${resolvedRuntimePath}`,
    };
  }

  const directory = path.dirname(resolvedRuntimePath);
  const companionFiles = listRuntimeCompanionFiles(directory);
  const inferredBackend = inferGpuBackend(companionFiles);
  const backend = requestedBackend ?? inferredBackend;
  if (!backend || !gpuBackends.has(backend)) {
    return {
      ready: false,
      path: resolvedRuntimePath,
      backend: backend ?? '',
      companionFiles,
      diagnostic: `whisper-cli appears CPU-only because ${directory} has no CUDA, Vulkan, Metal, Core ML, Kompute, or OpenVINO runtime companion files.`,
    };
  }
  if (!runtimeCompanionsSupportBackend(companionFiles, backend)) {
    return {
      ready: false,
      path: resolvedRuntimePath,
      backend,
      companionFiles,
      diagnostic: `whisper-cli runtime does not include companion files for requested GPU backend ${backend}: ${directory}`,
    };
  }

  return {
    ready: true,
    path: resolvedRuntimePath,
    directory,
    backend,
    companionFiles,
    diagnostic: `GPU-enabled whisper-cli runtime detected with ${backend} companions.`,
  };
}

function listRuntimeCompanionFiles(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => /\.(dll|so(?:\.\d+)*|dylib)$/iu.test(name))
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

function inferGpuBackend(companionFiles) {
  for (const backend of ['cuda', 'vulkan', 'metal', 'coreml', 'openvino', 'kompute']) {
    if (runtimeCompanionsSupportBackend(companionFiles, backend)) {
      return backend;
    }
  }
  return '';
}

function runtimeCompanionsSupportBackend(companionFiles, backend) {
  const fragments = backendCompanionFragments[backend] ?? [];
  const names = companionFiles.map((name) => name.toLowerCase());
  return fragments.some((fragment) => names.some((name) => name.includes(fragment)));
}

function findFirstRuntimeExecutable(rootDir) {
  for (const candidatePath of findRuntimeExecutableCandidates(rootDir)) {
    return candidatePath;
  }
  return '';
}

async function runOptionalGpuBenchmark({
  packaged,
  benchmarkInputPath,
  modelPath,
  benchmarkOutputDir,
  language,
  sourceDirect,
  forceChunked,
  audioDurationMs,
  chunkDurationMs,
  chunkOverlapMs,
  parallelism,
  chunkThreadCount,
  runSttBaseline,
}) {
  const requested = Boolean(benchmarkInputPath || modelPath);
  if (!packaged.ready) {
    return {
      requested,
      ready: false,
      skippedReason: 'GPU runtime is not packaged.',
    };
  }
  if (!requested) {
    return {
      requested: false,
      ready: false,
      skippedReason: 'benchmark input and model were not provided.',
    };
  }
  if (!benchmarkInputPath || !fs.existsSync(benchmarkInputPath) || !fs.statSync(benchmarkInputPath).isFile()) {
    return {
      requested: true,
      ready: false,
      skippedReason: `benchmark input is missing: ${benchmarkInputPath ?? ''}`,
    };
  }
  if (!modelPath || !fs.existsSync(modelPath) || !fs.statSync(modelPath).isFile()) {
    return {
      requested: true,
      ready: false,
      skippedReason: `benchmark model is missing: ${modelPath ?? ''}`,
    };
  }

  const report = await runSttBaseline({
    inputPath: benchmarkInputPath,
    outputDir: benchmarkOutputDir,
    executablePath: packaged.destinationPath,
    modelPath,
    language,
    sourceDirect,
    forceChunked,
    ...(audioDurationMs !== undefined ? { audioDurationMs } : {}),
    ...(chunkDurationMs !== undefined ? { chunkDurationMs } : {}),
    ...(chunkOverlapMs !== undefined ? { chunkOverlapMs } : {}),
    ...(parallelism !== undefined ? { parallelism } : {}),
    ...(chunkThreadCount !== undefined ? { chunkThreadCount } : {}),
  });
  return {
    requested: true,
    ready: Boolean(report.ready),
    reportPath: report.reportPath,
    segmentCount: report.transcript?.segmentCount ?? 0,
    transcriptMode: report.execution?.transcriptMode ?? '',
    durationMs: report.audio?.durationMs ?? 0,
    skippedReason: report.ready ? '' : 'GPU STT benchmark completed with blockers.',
  };
}

function createSkippedStep(reason) {
  return {
    ready: false,
    skippedReason: reason,
  };
}

function normalizeOptionalGpuBackend(value) {
  const normalized = normalizeOptionalString(value).toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (!gpuBackends.has(normalized)) {
    throw new Error(`AutoCut speech GPU runtime backend must be one of ${Array.from(gpuBackends).join(', ')}.`);
  }
  return normalized;
}

function normalizeOptionalPath(value) {
  const normalized = normalizeOptionalString(value);
  return normalized ? path.resolve(normalized) : '';
}

function normalizeOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNonNegativeInteger(value) {
  const number = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : undefined;
  if (!Number.isFinite(number)) {
    return undefined;
  }
  return Math.max(0, Math.round(number));
}

function normalizePositiveInteger(value) {
  const normalized = normalizeNonNegativeInteger(value);
  return normalized !== undefined && normalized > 0 ? normalized : undefined;
}

function writeJsonAtomic(targetPath, value) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(`${targetPath}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(`${targetPath}.tmp`, targetPath);
}

function commandDiagnostic(result) {
  return normalizeCommandOutput(result?.stderr || result?.stdout || result?.error || `exit ${result?.status ?? 'unknown'}`);
}

function normalizeCommandOutput(value) {
  return String(value ?? '').trim().replace(/\s+/gu, ' ');
}

function formatErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function runAutoCutSpeechGpuRuntimeCommand(command, args = [], { cwd = process.cwd() } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) {
    return {
      status: 1,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      error: result.error.message,
    };
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function parseArgs(argv) {
  const options = {};
  const args = normalizeAutoCutCliArgs(argv);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--accept-license') {
      options.acceptLicense = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--source-direct') {
      options.sourceDirect = true;
    } else if (arg === '--force-chunked') {
      options.forceChunked = true;
    } else if (arg === '--runtime') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut speech GPU runtime preparation',
      });
      options.runtimePath = option.value;
      index = option.nextIndex;
    } else if (arg === '--source-dir') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut speech GPU runtime preparation',
      });
      options.sourceDir = option.value;
      index = option.nextIndex;
    } else if (arg === '--build-dir') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut speech GPU runtime preparation',
      });
      options.buildDir = option.value;
      index = option.nextIndex;
    } else if (arg === '--backend' || arg === '--acceleration-backend') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut speech GPU runtime preparation',
      });
      options.accelerationBackend = option.value;
      index = option.nextIndex;
    } else if (arg === '--platform') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut speech GPU runtime preparation',
      });
      options.platform = option.value;
      index = option.nextIndex;
    } else if (arg === '--manifest') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut speech GPU runtime preparation',
      });
      options.manifestPath = option.value;
      index = option.nextIndex;
    } else if (arg === '--report') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut speech GPU runtime preparation',
      });
      options.reportPath = option.value;
      index = option.nextIndex;
    } else if (arg === '--search-root') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut speech GPU runtime preparation',
      });
      options.searchRoots = [...(options.searchRoots ?? []), option.value];
      index = option.nextIndex;
    } else if (arg === '--benchmark-input') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut speech GPU runtime preparation',
      });
      options.benchmarkInputPath = option.value;
      index = option.nextIndex;
    } else if (arg === '--benchmark-output') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut speech GPU runtime preparation',
      });
      options.benchmarkOutputDir = option.value;
      index = option.nextIndex;
    } else if (arg === '--model') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut speech GPU runtime preparation',
      });
      options.modelPath = option.value;
      index = option.nextIndex;
    } else if (arg === '--language') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut speech GPU runtime preparation',
      });
      options.language = option.value;
      index = option.nextIndex;
    } else if (arg === '--audio-duration-ms') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut speech GPU runtime preparation',
      });
      options.audioDurationMs = Number(option.value);
      index = option.nextIndex;
    } else if (arg === '--chunk-duration-ms') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut speech GPU runtime preparation',
      });
      options.chunkDurationMs = Number(option.value);
      index = option.nextIndex;
    } else if (arg === '--chunk-overlap-ms') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut speech GPU runtime preparation',
      });
      options.chunkOverlapMs = Number(option.value);
      index = option.nextIndex;
    } else if (arg === '--parallelism') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut speech GPU runtime preparation',
      });
      options.parallelism = Number(option.value);
      index = option.nextIndex;
    } else if (arg === '--chunk-thread-count') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut speech GPU runtime preparation',
      });
      options.chunkThreadCount = Number(option.value);
      index = option.nextIndex;
    } else {
      throw new Error(`Unknown AutoCut speech GPU runtime preparation argument: ${arg}`);
    }
  }
  return options;
}

if (path.resolve(process.argv[1] ?? '') === __filename) {
  try {
    const { json, ...options } = parseArgs(process.argv.slice(2));
    const report = await prepareAutoCutSpeechGpuRuntime(options);
    if (json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatAutoCutSpeechGpuRuntimeMessage(report));
      for (const blocker of report.blockers) {
        console.error(`${blocker.code}: ${blocker.message}`);
      }
    }
    if (!report.ready) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(formatErrorMessage(error));
    process.exitCode = 1;
  }
}
