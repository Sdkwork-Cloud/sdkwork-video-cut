#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  formatAutoCutLargeMediaSttBaselineMessage,
  runAutoCutLargeMediaSttBaseline,
} from './write-autocut-large-media-stt-baseline.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'autocut-large-media-stt-'));
const inputPath = path.join(root, 'large-live.mp4');
const outputDir = path.join(root, 'stt-output');
const executablePath = path.join(root, 'whisper-cli.exe');
const modelPath = path.join(root, 'ggml-large-v3-turbo-q5_0.bin');
fs.writeFileSync(inputPath, Buffer.alloc(1_024));
fs.writeFileSync(executablePath, Buffer.alloc(100));
fs.writeFileSync(modelPath, Buffer.alloc(1_024));

const commandCalls = [];
const report = await runAutoCutLargeMediaSttBaseline({
  inputPath,
  outputDir,
  executablePath,
  modelPath,
  language: 'zh',
  generatedAt: '2026-05-16T09:30:00.000Z',
  runCommand(command, args) {
    commandCalls.push({ command, args });
    if (command === 'ffmpeg') {
      const outputPath = args.at(-1);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, Buffer.alloc(20_000));
      return { status: 0, stdout: '', stderr: '' };
    }
    if (command === executablePath) {
      const stem = args[args.indexOf('-of') + 1];
      fs.writeFileSync(`${stem}.json`, `${JSON.stringify({
        result: { language: 'zh' },
        transcription: [
          { offsets: { from: 1_000, to: 8_000 }, text: 'First complete live topic.' },
          { offsets: { from: 8_500, to: 18_000 }, text: 'Second complete live topic.' },
        ],
      }, null, 2)}\n`);
      return { status: 0, stdout: '', stderr: '' };
    }
    return { status: 1, stdout: '', stderr: `unexpected command ${command} ${args.join(' ')}` };
  },
});

assert.equal(report.schema, 'smart-slice.large-media-stt-baseline.v1');
assert.equal(report.ready, true);
assert.equal(report.input.path, path.resolve(inputPath));
assert.equal(report.audio.path, path.resolve(path.join(outputDir, 'speech.wav')));
assert.equal(report.audio.byteSize, 20_000);
assert.equal(report.transcript.path, path.resolve(path.join(outputDir, 'speech-transcript.json')));
assert.equal(report.transcript.segmentCount, 2);
assert.equal(report.evidence.path, path.resolve(path.join(outputDir, 'evidence', 'speech-to-text.json')));
assert.equal(JSON.parse(fs.readFileSync(report.evidence.path, 'utf8')).schema, 'smart-slice.speech-to-text.v1');
assert.equal(commandCalls[0].command, 'ffmpeg');
assert.deepEqual(
  commandCalls[0].args.slice(0, 10),
  ['-hide_banner', '-nostdin', '-y', '-i', inputPath, '-vn', '-ac', '1', '-ar', '16000'],
);
const firstWhisperCall = commandCalls.find((call) => call.command === executablePath);
assert.equal(Boolean(firstWhisperCall), true);
assert.equal(firstWhisperCall.args.includes('-oj'), true);
assert.equal(firstWhisperCall.args.includes('-ojf'), true);
assert.equal(firstWhisperCall.args.includes('-ml'), true);
assert.match(
  formatAutoCutLargeMediaSttBaselineMessage(report),
  /ok - autocut large media stt baseline .* segments=2/u,
);

const reusedTranscriptCalls = [];
const reusedTranscriptReport = await runAutoCutLargeMediaSttBaseline({
  inputPath,
  outputDir,
  executablePath,
  modelPath,
  generatedAt: '2026-05-16T09:32:00.000Z',
  runCommand(command, args) {
    reusedTranscriptCalls.push({ command, args });
    return { status: 1, stdout: '', stderr: `unexpected rerun ${command} ${args.join(' ')}` };
  },
});

assert.equal(reusedTranscriptReport.ready, true);
assert.equal(reusedTranscriptReport.transcript.segmentCount, 2);
assert.equal(reusedTranscriptReport.execution.transcriptAction, 'reused');
assert.equal(reusedTranscriptReport.execution.audioAction, 'skipped-transcript-ready');
assert.equal(reusedTranscriptCalls.length, 0, 'reuses an already generated same-source transcript without rerunning FFmpeg or Whisper');

const audioReuseOutputDir = path.join(root, 'stt-audio-reuse-output');
const audioReusePath = path.join(audioReuseOutputDir, 'speech.wav');
fs.mkdirSync(audioReuseOutputDir, { recursive: true });
fs.writeFileSync(audioReusePath, Buffer.alloc(12_000));
writeSourceIdentityFixture(path.join(audioReuseOutputDir, 'source-identity.json'), inputPath);
const audioReuseReport = await runAutoCutLargeMediaSttBaseline({
  inputPath,
  outputDir: audioReuseOutputDir,
  executablePath,
  modelPath,
  generatedAt: '2026-05-16T09:33:00.000Z',
  runCommand(command, args) {
    if (command === 'ffmpeg') {
      return { status: 1, stdout: '', stderr: 'audio should have been reused' };
    }
    if (command === executablePath) {
      const stem = args[args.indexOf('-of') + 1];
      fs.writeFileSync(`${stem}.json`, `${JSON.stringify({
        result: { language: 'zh' },
        transcription: [
          { offsets: { from: 2_000, to: 12_000 }, text: 'Recovered transcript from reused audio.' },
        ],
      }, null, 2)}\n`);
      return { status: 0, stdout: '', stderr: '' };
    }
    return { status: 1, stdout: '', stderr: `unexpected command ${command} ${args.join(' ')}` };
  },
});

assert.equal(audioReuseReport.ready, true);
assert.equal(audioReuseReport.audio.byteSize, 12_000);
assert.equal(audioReuseReport.execution.audioAction, 'reused');
assert.equal(audioReuseReport.execution.transcriptAction, 'generated');
assert.equal(audioReuseReport.transcript.segmentCount, 1);

const interruptedOutputDir = path.join(root, 'stt-interrupted-output');
const interruptedReport = await runAutoCutLargeMediaSttBaseline({
  inputPath,
  outputDir: interruptedOutputDir,
  executablePath,
  modelPath,
  generatedAt: '2026-05-16T09:33:30.000Z',
  runCommand(command, args) {
    if (command === 'ffmpeg') {
      const outputPath = args.at(-1);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, Buffer.alloc(24_000));
      return { status: 0, stdout: '', stderr: '' };
    }
    if (command === executablePath) {
      return { status: 1, stdout: '', stderr: 'interrupted whisper process' };
    }
    return { status: 1, stdout: '', stderr: `unexpected interrupted command ${command} ${args.join(' ')}` };
  },
});

assert.equal(interruptedReport.ready, false);
assert.equal(interruptedReport.execution.audioAction, 'generated');
assert.equal(interruptedReport.execution.transcriptAction, 'failed');
assert.equal(fs.existsSync(path.join(interruptedOutputDir, 'source-identity.json')), true);

const interruptedResumeCalls = [];
const interruptedResumeReport = await runAutoCutLargeMediaSttBaseline({
  inputPath,
  outputDir: interruptedOutputDir,
  executablePath,
  modelPath,
  generatedAt: '2026-05-16T09:33:40.000Z',
  runCommand(command, args) {
    interruptedResumeCalls.push({ command, args });
    if (command === 'ffmpeg') {
      return { status: 1, stdout: '', stderr: 'audio should have been reused after interruption' };
    }
    if (command === executablePath) {
      const stem = args[args.indexOf('-of') + 1];
      fs.writeFileSync(`${stem}.json`, `${JSON.stringify({
        result: { language: 'zh' },
        transcription: [
          { offsets: { from: 1_000, to: 11_000 }, text: 'Resumed transcript after interrupted STT.' },
        ],
      }, null, 2)}\n`);
      return { status: 0, stdout: '', stderr: '' };
    }
    return { status: 1, stdout: '', stderr: `unexpected resume command ${command} ${args.join(' ')}` };
  },
});

assert.equal(interruptedResumeReport.ready, true);
assert.equal(interruptedResumeReport.execution.audioAction, 'reused');
assert.equal(interruptedResumeReport.execution.transcriptAction, 'generated');
assert.equal(
  interruptedResumeCalls.some((call) => call.command === 'ffmpeg'),
  false,
  'interrupted large-media STT resumes from extracted same-source audio without rerunning FFmpeg',
);

const chunkedOutputDir = path.join(root, 'stt-chunked-output');
const chunkedCommandCalls = [];
const asyncWhisperCalls = [];
let activeWhisperCalls = 0;
let maxActiveWhisperCalls = 0;
const chunkedReport = await runAutoCutLargeMediaSttBaseline({
  inputPath,
  outputDir: chunkedOutputDir,
  executablePath,
  modelPath,
  language: 'zh',
  audioDurationMs: 1_260_000,
  chunkDurationMs: 600_000,
  chunkOverlapMs: 2_000,
  parallelism: 2,
  chunkThreadCount: 2,
  whisperAudioContext: 768,
  whisperBeamSize: 1,
  whisperBestOf: 1,
  whisperNoFallback: true,
  generatedAt: '2026-05-16T09:34:00.000Z',
  runCommand(command, args) {
    chunkedCommandCalls.push({ command, args });
    if (command === 'ffmpeg' && args.includes(inputPath)) {
      const outputPath = args.at(-1);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, Buffer.alloc(40_000));
      return { status: 0, stdout: '', stderr: '' };
    }
    if (command === 'ffmpeg' && args.includes(path.join(chunkedOutputDir, 'speech.wav'))) {
      const outputPath = args.at(-1);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, Buffer.alloc(10_000));
      return { status: 0, stdout: '', stderr: '' };
    }
    return { status: 1, stdout: '', stderr: `unexpected chunk command ${command} ${args.join(' ')}` };
  },
  async runCommandAsync(command, args) {
    asyncWhisperCalls.push({ command, args });
    activeWhisperCalls += 1;
    maxActiveWhisperCalls = Math.max(maxActiveWhisperCalls, activeWhisperCalls);
    await new Promise((resolve) => setTimeout(resolve, 10));
    activeWhisperCalls -= 1;
    if (command !== executablePath) {
      return { status: 1, stdout: '', stderr: `unexpected async command ${command}` };
    }
    const stem = args[args.indexOf('-of') + 1];
    const chunkName = path.basename(stem);
    const transcription = chunkName.includes('0002')
      ? [{ offsets: { from: 3_000, to: 9_000 }, text: 'Second chunk topic.' }]
      : chunkName.includes('0003')
        ? [{ offsets: { from: 3_000, to: 5_000 }, text: 'Final chunk conclusion.' }]
        : [{ offsets: { from: 1_000, to: 5_000 }, text: 'Opening chunk topic.' }];
    fs.writeFileSync(`${stem}.json`, `${JSON.stringify({
      result: { language: 'zh' },
      transcription,
    }, null, 2)}\n`);
    return { status: 0, stdout: '', stderr: '' };
  },
});

assert.equal(chunkedReport.ready, true);
assert.equal(chunkedReport.execution.transcriptMode, 'chunked-parallel');
assert.equal(chunkedReport.execution.transcriptAction, 'generated');
assert.equal(chunkedReport.chunks.count, 3);
assert.equal(chunkedReport.chunks.readyCount, 3);
assert.equal(chunkedReport.chunks.parallelism, 2);
assert.equal(chunkedReport.chunks.chunkThreadCount, 2);
assert.equal(chunkedReport.audio.durationMs, 1_260_000);
assert.equal(chunkedReport.audio.durationLimitApplied, true);
assert.equal(fs.existsSync(chunkedReport.chunks.manifestPath), true);
assert.equal(asyncWhisperCalls.length, 3);
assert.equal(maxActiveWhisperCalls, 2, 'large-media STT baseline transcribes audio chunks concurrently');
assert.equal(
  asyncWhisperCalls.every((call) => call.args.includes('-ac') && call.args[call.args.indexOf('-ac') + 1] === '768'),
  true,
  'large-media STT baseline applies measured local Whisper audio context to every chunk',
);
assert.equal(
  asyncWhisperCalls.every((call) => call.args.includes('-bs') && call.args[call.args.indexOf('-bs') + 1] === '1'),
  true,
  'large-media STT baseline applies measured local Whisper beam size to every chunk',
);
assert.equal(
  asyncWhisperCalls.every((call) => call.args.includes('-bo') && call.args[call.args.indexOf('-bo') + 1] === '1'),
  true,
  'large-media STT baseline applies measured local Whisper best-of count to every chunk',
);
assert.equal(
  asyncWhisperCalls.every((call) => call.args.includes('-nf')),
  true,
  'large-media STT baseline applies measured local Whisper no-fallback mode to every chunk',
);
const chunkedManifest = JSON.parse(fs.readFileSync(chunkedReport.chunks.manifestPath, 'utf8'));
assert.equal(chunkedManifest.whisperAudioContext, 768);
assert.equal(chunkedManifest.whisperBeamSize, 1);
assert.equal(chunkedManifest.whisperBestOf, 1);
assert.equal(chunkedManifest.whisperNoFallback, true);
assert.equal(chunkedReport.transcript.segmentCount, 3);
assert.deepEqual(
  JSON.parse(fs.readFileSync(chunkedReport.transcript.path, 'utf8')).transcription.map((segment) => segment.offsets.from),
  [1_000, 601_000, 1_199_000],
);

const sourceDirectOutputDir = path.join(root, 'stt-source-direct-output');
const sourceDirectCommandCalls = [];
const sourceDirectAsyncCalls = [];
const sourceDirectReport = await runAutoCutLargeMediaSttBaseline({
  inputPath,
  outputDir: sourceDirectOutputDir,
  executablePath,
  modelPath,
  language: 'zh',
  audioDurationMs: 620_000,
  chunkDurationMs: 600_000,
  chunkOverlapMs: 2_000,
  parallelism: 2,
  chunkThreadCount: 2,
  whisperAudioContext: 512,
  whisperBeamSize: 1,
  whisperBestOf: 1,
  whisperNoFallback: true,
  sourceDirect: true,
  generatedAt: '2026-05-16T09:34:20.000Z',
  runCommand(command, args) {
    sourceDirectCommandCalls.push({ command, args });
    if (command === 'ffmpeg' && args.includes(inputPath)) {
      const outputPath = args.at(-1);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, Buffer.alloc(10_000));
      return { status: 0, stdout: '', stderr: '' };
    }
    return { status: 1, stdout: '', stderr: `unexpected source-direct command ${command} ${args.join(' ')}` };
  },
  async runCommandAsync(command, args) {
    sourceDirectAsyncCalls.push({ command, args });
    if (command !== executablePath) {
      return { status: 1, stdout: '', stderr: `unexpected source-direct async command ${command}` };
    }
    const stem = args[args.indexOf('-of') + 1];
    const chunkName = path.basename(stem);
    const transcription = chunkName.includes('0002')
      ? [{ offsets: { from: 2_500, to: 8_000 }, text: 'Source direct closing topic.' }]
      : [{ offsets: { from: 1_000, to: 5_000 }, text: 'Source direct opening topic.' }];
    fs.writeFileSync(`${stem}.json`, `${JSON.stringify({
      result: { language: 'zh' },
      transcription,
    }, null, 2)}\n`);
    return { status: 0, stdout: '', stderr: '' };
  },
});

assert.equal(sourceDirectReport.ready, true);
assert.equal(sourceDirectReport.execution.audioAction, 'source-media-direct');
assert.equal(sourceDirectReport.execution.transcriptMode, 'chunked-parallel');
assert.equal(sourceDirectReport.audio.path, path.resolve(inputPath));
assert.equal(sourceDirectReport.audio.sourceKind, 'source-media-direct');
assert.equal(sourceDirectReport.audio.fullAudioExtracted, false);
assert.equal(fs.existsSync(path.join(sourceDirectOutputDir, 'speech.wav')), false);
assert.equal(
  sourceDirectCommandCalls.some((call) => call.command === 'ffmpeg' && call.args.at(-1) === path.join(sourceDirectOutputDir, 'speech.wav')),
  false,
  'source-direct large-media STT does not extract a full speech.wav before chunking',
);
assert.equal(
  sourceDirectCommandCalls.every((call) => call.command !== 'ffmpeg' || call.args.includes(inputPath)),
  true,
  'source-direct chunk extraction reads from the original media file',
);
assert.equal(
  sourceDirectCommandCalls.every((call) => call.command !== 'ffmpeg' || call.args.includes('-vn')),
  true,
  'source-direct chunk extraction disables video decode',
);
const sourceDirectManifest = JSON.parse(fs.readFileSync(sourceDirectReport.chunks.manifestPath, 'utf8'));
assert.equal(sourceDirectManifest.speechSourcePath, path.resolve(inputPath));
assert.equal(sourceDirectManifest.speechSourceKind, 'source-media-direct');
assert.equal(sourceDirectManifest.fullAudioExtracted, false);
assert.equal(sourceDirectAsyncCalls.length, 2);
assert.equal(
  sourceDirectAsyncCalls.every((call) => call.args.includes('-ac') && call.args[call.args.indexOf('-ac') + 1] === '512'),
  true,
  'source-direct large-media STT applies fast-preview local Whisper audio context to every chunk',
);
assert.equal(
  sourceDirectAsyncCalls.every((call) => call.args.includes('-nf')),
  true,
  'source-direct large-media STT applies no-fallback decode mode to every chunk',
);
assert.deepEqual(
  JSON.parse(fs.readFileSync(sourceDirectReport.transcript.path, 'utf8')).transcription.map((segment) => segment.offsets.from),
  [1_000, 600_500],
);

const qualityGuardOutputDir = path.join(root, 'stt-quality-guard-output');
const qualityGuardAsyncCalls = [];
const qualityGuardReport = await runAutoCutLargeMediaSttBaseline({
  inputPath,
  outputDir: qualityGuardOutputDir,
  executablePath,
  modelPath,
  language: 'zh',
  audioDurationMs: 90_000,
  chunkDurationMs: 60_000,
  chunkOverlapMs: 2_000,
  parallelism: 1,
  chunkThreadCount: 2,
  whisperAudioContext: 512,
  whisperBeamSize: 1,
  whisperBestOf: 1,
  whisperNoFallback: true,
  forceChunked: true,
  generatedAt: '2026-05-16T09:34:25.000Z',
  runCommand(command, args) {
    if (command === 'ffmpeg' && args.includes(inputPath)) {
      const outputPath = args.at(-1);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, Buffer.alloc(40_000));
      return { status: 0, stdout: '', stderr: '' };
    }
    if (command === 'ffmpeg' && args.includes(path.join(qualityGuardOutputDir, 'speech.wav'))) {
      const outputPath = args.at(-1);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, Buffer.alloc(10_000));
      return { status: 0, stdout: '', stderr: '' };
    }
    return { status: 1, stdout: '', stderr: `unexpected quality guard command ${command} ${args.join(' ')}` };
  },
  async runCommandAsync(command, args) {
    qualityGuardAsyncCalls.push({ command, args });
    if (command !== executablePath) {
      return { status: 1, stdout: '', stderr: `unexpected quality guard async command ${command}` };
    }
    const stem = args[args.indexOf('-of') + 1];
    const chunkName = path.basename(stem);
    const usesAudioContext = args.includes('-ac');
    const transcription = usesAudioContext
      ? [{
          offsets: { from: 1_000, to: 12_000 },
          text: '更加不会去更加不会去更加不会去更加不会去更加不会去更加不会去',
        }]
      : chunkName.includes('0002')
        ? [{ offsets: { from: 2_000, to: 8_000 }, text: 'Stable retry keeps the closing topic coherent.' }]
        : [{ offsets: { from: 1_000, to: 8_000 }, text: 'Stable retry keeps the opening topic coherent.' }];
    fs.writeFileSync(`${stem}.json`, `${JSON.stringify({
      result: { language: 'zh' },
      transcription,
    }, null, 2)}\n`);
    return { status: 0, stdout: '', stderr: '' };
  },
});
const qualityGuardManifest = JSON.parse(fs.readFileSync(qualityGuardReport.chunks.manifestPath, 'utf8'));
const qualityGuardTranscript = JSON.parse(fs.readFileSync(qualityGuardReport.transcript.path, 'utf8'));
assert.equal(qualityGuardReport.ready, true);
assert.equal(qualityGuardReport.chunks.qualityGuard.status, 'passed-after-retry');
assert.equal(qualityGuardReport.chunks.qualityGuard.retryCount, 2);
assert.equal(qualityGuardReport.transcript.qualityGuard.status, 'passed');
assert.equal(qualityGuardManifest.qualityGuard.retryCount, 2);
assert.equal(
  qualityGuardAsyncCalls.filter((call) => call.args.includes('-ac')).length,
  2,
  'accelerated decode is attempted first when explicitly configured',
);
assert.equal(
  qualityGuardAsyncCalls.filter((call) => !call.args.includes('-ac')).length,
  2,
  'quality guard retries hallucinated chunks with stable no-audio-context decode',
);
assert.deepEqual(
  qualityGuardTranscript.transcription.map((segment) => segment.text),
  [
    'Stable retry keeps the opening topic coherent.',
    'Stable retry keeps the closing topic coherent.',
  ],
);

const emptyChunkOutputDir = path.join(root, 'stt-empty-chunk-output');
const emptyChunkAsyncCalls = [];
const emptyChunkReport = await runAutoCutLargeMediaSttBaseline({
  inputPath,
  outputDir: emptyChunkOutputDir,
  executablePath,
  modelPath,
  language: 'zh',
  audioDurationMs: 90_000,
  chunkDurationMs: 60_000,
  chunkOverlapMs: 2_000,
  parallelism: 2,
  chunkThreadCount: 2,
  sourceDirect: true,
  forceChunked: true,
  generatedAt: '2026-05-16T09:34:28.000Z',
  runCommand(command, args) {
    if (command === 'ffmpeg' && args.includes(inputPath)) {
      const outputPath = args.at(-1);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      const isTailChunk = outputPath.endsWith('chunk-0002.wav');
      fs.writeFileSync(outputPath, Buffer.alloc(isTailChunk ? 98 : 10_000));
      return { status: 0, stdout: '', stderr: '' };
    }
    return { status: 1, stdout: '', stderr: `unexpected empty chunk command ${command} ${args.join(' ')}` };
  },
  async runCommandAsync(command, args) {
    emptyChunkAsyncCalls.push({ command, args });
    if (command !== executablePath) {
      return { status: 1, stdout: '', stderr: `unexpected empty chunk async command ${command}` };
    }
    const stem = args[args.indexOf('-of') + 1];
    fs.writeFileSync(`${stem}.json`, `${JSON.stringify({
      result: { language: 'zh' },
      transcription: [
        { offsets: { from: 1_000, to: 8_000 }, text: 'Only the first source-direct chunk has speech.' },
      ],
    }, null, 2)}\n`);
    return { status: 0, stdout: '', stderr: '' };
  },
});
const emptyChunkManifest = JSON.parse(fs.readFileSync(emptyChunkReport.chunks.manifestPath, 'utf8'));
assert.equal(emptyChunkReport.ready, true);
assert.equal(emptyChunkReport.transcript.segmentCount, 1);
assert.equal(emptyChunkAsyncCalls.length, 1, 'empty source-direct audio chunks are not sent to Whisper');
assert.equal(emptyChunkManifest.chunks[1]?.transcriptAction, 'empty-audio-skipped');
assert.deepEqual(
  JSON.parse(fs.readFileSync(emptyChunkReport.transcript.path, 'utf8')).transcription.map((segment) => segment.text),
  ['Only the first source-direct chunk has speech.'],
);

const overlapRepairOutputDir = path.join(root, 'stt-overlap-repair-output');
const overlapRepairChunksDir = path.join(overlapRepairOutputDir, 'chunks');
fs.mkdirSync(overlapRepairChunksDir, { recursive: true });
fs.writeFileSync(path.join(overlapRepairChunksDir, 'chunk-0001.json'), `${JSON.stringify({
  transcription: [
    { offsets: { from: 57_240, to: 60_000 }, text: 'The first chunk has a closing phrase.' },
  ],
}, null, 2)}\n`);
fs.writeFileSync(path.join(overlapRepairChunksDir, 'chunk-0002.json'), `${JSON.stringify({
  transcription: [
    { offsets: { from: 1_500, to: 3_860 }, text: 'A partially repeated overlap must not move backward.' },
    { offsets: { from: 3_860, to: 6_460 }, text: 'Then the next chunk continues normally.' },
  ],
}, null, 2)}\n`);
fs.writeFileSync(path.join(overlapRepairChunksDir, 'chunk-0003.json'), `${JSON.stringify({
  transcription: [],
}, null, 2)}\n`);
const overlapRepairReport = await runAutoCutLargeMediaSttBaseline({
  inputPath,
  outputDir: overlapRepairOutputDir,
  executablePath,
  modelPath,
  audioDurationMs: 120_000,
  chunkDurationMs: 60_000,
  chunkOverlapMs: 2_000,
  forceChunked: true,
  chunksDir: overlapRepairChunksDir,
  generatedAt: '2026-05-16T09:34:30.000Z',
  runCommand(command, args) {
    if (command === 'ffmpeg' && args.includes(inputPath)) {
      const outputPath = args.at(-1);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, Buffer.alloc(40_000));
      return { status: 0, stdout: '', stderr: '' };
    }
    if (command === 'ffmpeg' && args.includes(path.join(overlapRepairOutputDir, 'speech.wav'))) {
      const outputPath = args.at(-1);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, Buffer.alloc(10_000));
      return { status: 0, stdout: '', stderr: '' };
    }
    return { status: 1, stdout: '', stderr: `unexpected overlap repair command ${command} ${args.join(' ')}` };
  },
  async runCommandAsync() {
    throw new Error('finished chunk transcripts should be reused without invoking Whisper');
  },
});
const overlapRepairTranscript = JSON.parse(fs.readFileSync(overlapRepairReport.transcript.path, 'utf8'));
assert.equal(overlapRepairReport.ready, true);
assert.deepEqual(
  overlapRepairTranscript.transcription.map((segment) => [segment.offsets.from, segment.offsets.to]),
  [
    [57_240, 60_000],
    [60_000, 61_860],
    [61_860, 64_460],
  ],
);
assert.equal(
  overlapRepairTranscript.transcription.every((segment, index, segments) =>
    index === 0 || segment.offsets.from >= segments[index - 1].offsets.to
  ),
  true,
  'large-media STT baseline repairs partial chunk overlaps into a non-overlapping timeline',
);

const failedReport = await runAutoCutLargeMediaSttBaseline({
  inputPath,
  outputDir: path.join(root, 'stt-failed-output'),
  executablePath,
  modelPath,
  generatedAt: '2026-05-16T09:35:00.000Z',
  runCommand(command) {
    if (command === 'ffmpeg') {
      return { status: 1, stdout: '', stderr: 'audio decode failed' };
    }
    return { status: 0, stdout: '', stderr: '' };
  },
});

assert.equal(failedReport.ready, false);
assert.equal(
  failedReport.blockers.some((blocker) => blocker.code === 'SMART_SLICE_LARGE_MEDIA_AUDIO_EXTRACT_FAILED'),
  true,
  'large media STT baseline writes a blocked report when audio extraction fails',
);
assert.equal(fs.existsSync(path.join(root, 'stt-failed-output', 'stt-baseline.json')), true);

console.log('ok - AutoCut large media STT baseline contract');

function writeSourceIdentityFixture(targetPath, sourcePath) {
  const stats = fs.statSync(sourcePath);
  fs.writeFileSync(targetPath, `${JSON.stringify({
    schema: 'smart-slice.large-media-source-identity.v1',
    input: {
      path: path.resolve(sourcePath),
      byteSize: stats.size,
      modifiedTimeMs: Math.round(stats.mtimeMs),
    },
  }, null, 2)}\n`);
}
