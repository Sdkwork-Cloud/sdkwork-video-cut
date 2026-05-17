#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  formatAutoCutLargeMediaBaselineMessage,
  runAutoCutLargeMediaBaseline,
} from './check-autocut-large-media-baseline.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'autocut-large-media-baseline-'));
const inputPath = path.join(root, 'large-live.mp4');
const outputDir = path.join(root, 'baseline-output');
const transcriptPath = path.join(outputDir, 'transcript', 'speech-transcript.json');
fs.writeFileSync(inputPath, Buffer.alloc(9_999));

const missingTranscriptReport = await runAutoCutLargeMediaBaseline({
  inputPath,
  outputDir,
  generatedAt: '2026-05-16T09:00:00.000Z',
  runCommand: createMockCommand(),
});

assert.equal(missingTranscriptReport.schema, 'smart-slice.large-media-baseline.v1');
assert.equal(missingTranscriptReport.ready, false);
assert.equal(missingTranscriptReport.input.path, path.resolve(inputPath));
assert.equal(missingTranscriptReport.input.byteSize, 9_999);
assert.equal(missingTranscriptReport.media.durationMs, 4_362_196);
assert.equal(missingTranscriptReport.media.video.width, 1080);
assert.equal(missingTranscriptReport.media.video.height, 1920);
assert.equal(missingTranscriptReport.media.audio.channels, 2);
assert.equal(missingTranscriptReport.transcript.status, 'missing');
assert.equal(missingTranscriptReport.benchmark.status, 'skipped');
assert.equal(
  missingTranscriptReport.blockers.some((blocker) => blocker.code === 'SMART_SLICE_LARGE_MEDIA_TRANSCRIPT_MISSING'),
  true,
  'large-media baseline must block instead of silently reusing the wenan5 transcript fixture',
);
assert.equal(fs.existsSync(path.join(outputDir, 'large-media-baseline.json')), true);
assert.match(
  formatAutoCutLargeMediaBaselineMessage(missingTranscriptReport),
  /blocked - autocut large media baseline .* transcript=missing benchmark=skipped/u,
);

writeWhisperTranscriptFixture(transcriptPath);
const benchmarkCalls = [];
const readyReport = await runAutoCutLargeMediaBaseline({
  inputPath,
  outputDir,
  transcriptPath,
  renderClipLimit: 1,
  generatedAt: '2026-05-16T09:05:00.000Z',
  runCommand: createMockCommand(),
  benchmarkRunner: async (options) => {
    benchmarkCalls.push(options);
    return {
      ready: true,
      reportPath: path.join(outputDir, 'performance-benchmark.json'),
      render: {
        renderedClipCount: 2,
        totalOutputBytes: 12_345,
      },
      timing: {
        totalElapsedMs: 8_000,
      },
      evidence: {
        ready: true,
      },
      blockers: [],
    };
  },
});

assert.equal(readyReport.ready, true);
assert.equal(readyReport.transcript.status, 'ready');
assert.equal(readyReport.transcript.segmentCount, 2);
assert.equal(readyReport.transcript.evidencePath, path.resolve(path.join(outputDir, 'evidence', 'speech-to-text.json')));
assert.equal(JSON.parse(fs.readFileSync(readyReport.transcript.evidencePath, 'utf8')).schema, 'smart-slice.speech-to-text.v1');
assert.equal(readyReport.benchmark.status, 'ready');
assert.equal(readyReport.benchmark.renderedClipCount, 2);
assert.equal(readyReport.benchmark.totalOutputBytes, 12_345);
assert.equal(benchmarkCalls.length, 1);
assert.equal(benchmarkCalls[0].inputPath, inputPath);
assert.equal(benchmarkCalls[0].transcriptPath, transcriptPath);
assert.equal(benchmarkCalls[0].outputDir, outputDir);
assert.equal(benchmarkCalls[0].renderClipLimit, 1);
assert.notEqual(
  path.resolve(benchmarkCalls[0].transcriptPath),
  path.resolve('artifacts/autocut-diagnostics/wenan5/speech-transcript.json'),
  'large-media benchmark must use the caller-provided transcript, not the wenan5 fixture',
);

const failedBenchmarkReport = await runAutoCutLargeMediaBaseline({
  inputPath,
  outputDir: path.join(root, 'failed-benchmark-output'),
  transcriptPath,
  generatedAt: '2026-05-16T09:10:00.000Z',
  runCommand: createMockCommand(),
  benchmarkRunner: async () => ({
    ready: false,
    reportPath: path.join(root, 'failed-benchmark-output', 'performance-benchmark.json'),
    render: { renderedClipCount: 0, totalOutputBytes: 0 },
    timing: { totalElapsedMs: 300 },
    evidence: { ready: false },
    blockers: [{ code: 'SMART_SLICE_PERFORMANCE_RUN_FAILED', message: 'render failed' }],
  }),
});

assert.equal(failedBenchmarkReport.ready, false);
assert.equal(
  failedBenchmarkReport.blockers.some((blocker) => blocker.code === 'SMART_SLICE_LARGE_MEDIA_BENCHMARK_BLOCKED'),
  true,
  'large-media baseline propagates blocked benchmark state into its top-level report',
);

console.log('ok - AutoCut large media baseline contract');

function createMockCommand() {
  return (command, args) => {
    const argText = args.join(' ');
    if (command === 'ffprobe' && argText.includes('-show_entries') && argText.includes('-of json')) {
      return {
        status: 0,
        stdout: JSON.stringify({
          streams: [
            { index: 0, codec_name: 'hevc', codec_type: 'video', width: 1080, height: 1920 },
            { index: 1, codec_name: 'aac', codec_type: 'audio', sample_rate: '48000', channels: 2 },
          ],
          format: {
            duration: '4362.196000',
            size: '2694920336',
            bit_rate: '4942318',
          },
        }),
        stderr: '',
      };
    }
    return { status: 1, stdout: '', stderr: `unexpected command ${command} ${argText}` };
  };
}

function writeWhisperTranscriptFixture(targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify({
    result: { language: 'zh' },
    transcription: [
      {
        offsets: { from: 1_000, to: 9_000 },
        text: 'Opening topic with complete context.',
      },
      {
        offsets: { from: 9_500, to: 18_000 },
        text: 'Second complete idea with conclusion.',
      },
      {
        offsets: { from: 18_100, to: 18_600 },
        text: 'um',
      },
    ],
  }, null, 2)}\n`);
}
