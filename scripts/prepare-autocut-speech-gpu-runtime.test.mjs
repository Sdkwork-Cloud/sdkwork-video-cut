#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  formatAutoCutSpeechGpuRuntimeMessage,
  prepareAutoCutSpeechGpuRuntime,
} from './prepare-autocut-speech-gpu-runtime.mjs';

function tempRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

function writeFile(filePath, content = 'fixture') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

function createReadyGpuToolCommand() {
  return (command, args = []) => {
    if (command === 'nvidia-smi') {
      return {
        status: 0,
        stdout: [
          'NVIDIA-SMI 591.74 Driver Version: 591.74 CUDA Version: 13.1',
          'NVIDIA GeForce RTX 4090',
        ].join('\n'),
        stderr: '',
      };
    }
    if (command === 'nvcc') {
      return {
        status: 0,
        stdout: 'Cuda compilation tools, release 12.6, V12.6.20',
        stderr: '',
      };
    }
    if (command === 'cmake') {
      return {
        status: 0,
        stdout: `cmake ${args.join(' ')}`,
        stderr: '',
      };
    }
    return {
      status: 1,
      stdout: '',
      stderr: `unexpected command ${command} ${args.join(' ')}`,
    };
  };
}

const noRuntimeRoot = tempRoot('autocut-speech-gpu-runtime-missing');
const noRuntimeReport = await prepareAutoCutSpeechGpuRuntime({
  rootDir: noRuntimeRoot,
  generatedAt: '2026-05-16T15:00:00.000Z',
  searchRoots: [],
  writeReport: false,
  runCommand: createReadyGpuToolCommand(),
});

assert.equal(noRuntimeReport.ready, false);
assert.equal(noRuntimeReport.environment.nvidia.ready, true);
assert.equal(noRuntimeReport.environment.cudaToolkit.ready, true);
assert.equal(noRuntimeReport.runtime.ready, false);
assert.equal(
  noRuntimeReport.blockers.some((blocker) => blocker.code === 'AUTOCUT_SPEECH_GPU_RUNTIME_MISSING'),
  true,
  'GPU speech preparation must fail honestly when no CUDA/Vulkan whisper runtime exists',
);
assert.equal(noRuntimeReport.benchmark.ready, false);
assert.match(noRuntimeReport.benchmark.skippedReason, /GPU runtime is not packaged/u);

const cpuRuntimeRoot = tempRoot('autocut-speech-gpu-runtime-cpu-only');
const cpuWhisperPath = writeFile(path.join(cpuRuntimeRoot, 'cpu', 'whisper-cli.exe'), 'cpu whisper executable');
writeFile(path.join(cpuRuntimeRoot, 'cpu', 'ggml-cpu.dll'), 'cpu backend');
const cpuRuntimeReport = await prepareAutoCutSpeechGpuRuntime({
  rootDir: cpuRuntimeRoot,
  generatedAt: '2026-05-16T15:01:00.000Z',
  runtimePath: cpuWhisperPath,
  accelerationBackend: 'cuda',
  acceptLicense: true,
  writeReport: false,
  runCommand: createReadyGpuToolCommand(),
  prepareSpeechSidecar() {
    throw new Error('CPU-only runtime must not be packaged as CUDA.');
  },
});

assert.equal(cpuRuntimeReport.ready, false);
assert.equal(cpuRuntimeReport.runtime.ready, false);
assert.equal(
  cpuRuntimeReport.blockers.some((blocker) => blocker.code === 'AUTOCUT_SPEECH_GPU_RUNTIME_UNVERIFIED'),
  true,
  'GPU speech preparation must reject a whisper-cli directory without GPU backend companions',
);

const cudaRuntimeRoot = tempRoot('autocut-speech-gpu-runtime-cuda');
const cudaWhisperPath = writeFile(path.join(cudaRuntimeRoot, 'cuda', 'whisper-cli.exe'), 'cuda whisper executable');
writeFile(path.join(cudaRuntimeRoot, 'cuda', 'ggml.dll'), 'ggml base');
writeFile(path.join(cudaRuntimeRoot, 'cuda', 'ggml-cuda.dll'), 'cuda backend');
writeFile(path.join(cudaRuntimeRoot, 'cuda', 'whisper.dll'), 'whisper runtime');
const benchmarkInputPath = writeFile(path.join(cudaRuntimeRoot, 'media', 'live.mp4'), 'video');
const benchmarkModelPath = writeFile(path.join(cudaRuntimeRoot, 'models', 'ggml-large-v3-turbo-q5_0.bin'), 'model');
const reportPath = path.join(cudaRuntimeRoot, 'report', 'gpu-runtime.json');
const packageCalls = [];
const benchmarkCalls = [];
const packagedSidecarPath = path.join(cudaRuntimeRoot, 'packaged', 'whisper-cli.exe');
const cudaRuntimeReport = await prepareAutoCutSpeechGpuRuntime({
  rootDir: cudaRuntimeRoot,
  generatedAt: '2026-05-16T15:02:00.000Z',
  runtimePath: cudaWhisperPath,
  benchmarkInputPath,
  modelPath: benchmarkModelPath,
  benchmarkOutputDir: path.join(cudaRuntimeRoot, 'benchmark'),
  reportPath,
  accelerationBackend: 'cuda',
  acceptLicense: true,
  sourceDirect: true,
  forceChunked: true,
  audioDurationMs: 600_000,
  chunkDurationMs: 360_000,
  parallelism: 2,
  chunkThreadCount: 3,
  runCommand: createReadyGpuToolCommand(),
  prepareSpeechSidecar(options) {
    packageCalls.push(options);
    return {
      platform: options.platform,
      sourcePath: options.sourcePath,
      destinationPath: packagedSidecarPath,
      accelerationBackend: options.accelerationBackend,
      companionFiles: [
        { relativePath: 'windows-x86_64/ggml-cuda.dll' },
      ],
    };
  },
  async runSttBaseline(options) {
    benchmarkCalls.push(options);
    return {
      ready: true,
      reportPath: path.join(options.outputDir, 'stt-baseline.json'),
      transcript: {
        segmentCount: 10,
      },
      execution: {
        transcriptMode: 'chunked-parallel',
      },
      audio: {
        durationMs: 600_000,
      },
    };
  },
});

assert.equal(cudaRuntimeReport.ready, true);
assert.equal(cudaRuntimeReport.runtime.ready, true);
assert.equal(cudaRuntimeReport.runtime.backend, 'cuda');
assert.equal(cudaRuntimeReport.package.ready, true);
assert.equal(cudaRuntimeReport.package.destinationPath, packagedSidecarPath);
assert.equal(cudaRuntimeReport.benchmark.ready, true);
assert.equal(cudaRuntimeReport.benchmark.segmentCount, 10);
assert.equal(packageCalls.length, 1);
assert.equal(packageCalls[0].sourcePath, cudaWhisperPath);
assert.equal(packageCalls[0].accelerationBackend, 'cuda');
assert.equal(packageCalls[0].acceptLicense, true);
assert.equal(benchmarkCalls.length, 1);
assert.equal(benchmarkCalls[0].executablePath, packagedSidecarPath);
assert.equal(benchmarkCalls[0].sourceDirect, true);
assert.equal(benchmarkCalls[0].forceChunked, true);
assert.equal(benchmarkCalls[0].chunkThreadCount, 3);
assert.equal(fs.existsSync(reportPath), true);
assert.equal(JSON.parse(fs.readFileSync(reportPath, 'utf8')).schema, 'smart-slice.speech-gpu-runtime.v1');
assert.match(
  formatAutoCutSpeechGpuRuntimeMessage(cudaRuntimeReport),
  /ok - autocut speech gpu runtime backend=cuda packaged=true benchmark=true/u,
);

console.log('ok - AutoCut speech GPU runtime preparation contract');
