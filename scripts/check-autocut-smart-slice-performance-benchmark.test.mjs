#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createDefaultSmartSlicePerformanceBenchmarkRunner,
  formatAutoCutSmartSlicePerformanceBenchmarkMessage,
  runAutoCutSmartSlicePerformanceBenchmark,
} from './check-autocut-smart-slice-performance-benchmark.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'autocut-smart-slice-benchmark-'));
const inputPath = path.join(root, 'source.mp4');
const outputDir = path.join(root, 'task-output');
const reportPath = path.join(outputDir, 'performance-benchmark.json');
const sliceOnePath = path.join(outputDir, 'slice-01.mp4');
const sliceTwoPath = path.join(outputDir, 'slice-02.mp4');
const subtitleOnePath = path.join(outputDir, 'slice-01.srt');
const subtitleTwoPath = path.join(outputDir, 'slice-02.srt');

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(inputPath, Buffer.alloc(1_048_699));
fs.writeFileSync(sliceOnePath, Buffer.alloc(5_000));
fs.writeFileSync(sliceTwoPath, Buffer.alloc(7_000));
fs.writeFileSync(subtitleOnePath, Buffer.alloc(300));
fs.writeFileSync(subtitleTwoPath, Buffer.alloc(420));

const runnerCalls = [];
const result = await runAutoCutSmartSlicePerformanceBenchmark({
  inputPath,
  outputDir,
  profile: 'desktop-duration',
  reportPath,
  generatedAt: '2026-05-16T08:30:00.000Z',
  clock: createSequenceClock({
    isoTimes: ['2026-05-16T08:30:01.000Z', '2026-05-16T08:30:01.999Z'],
    monotonicTimesMs: [1_000, 1_999],
  }),
  runner: async (options) => {
    runnerCalls.push(options);
    return createSuccessfulAcceptanceResult({
      inputPath,
      outputDir,
      sliceOnePath,
      sliceTwoPath,
      subtitleOnePath,
      subtitleTwoPath,
    });
  },
});

assert.equal(runnerCalls.length, 1);
assert.equal(runnerCalls[0].inputPath, inputPath);
assert.equal(runnerCalls[0].outputDir, outputDir);
assert.equal(runnerCalls[0].profile, 'desktop-duration');
assert.equal(result.schema, 'smart-slice.performance-benchmark.v1');
assert.equal(result.generatedAt, '2026-05-16T08:30:00.000Z');
assert.equal(result.startedAt, '2026-05-16T08:30:01.000Z');
assert.equal(result.finishedAt, '2026-05-16T08:30:01.999Z');
assert.equal(result.timing.totalElapsedMs, 999);
assert.equal(result.input.path, path.resolve(inputPath));
assert.equal(result.input.byteSize, 1_048_699);
assert.equal(result.sourceDurationMs, 120_000);
assert.equal(result.profile, 'desktop-duration');
assert.equal(result.render.renderedClipCount, 2);
assert.equal(result.render.plannedClipCount, 2);
assert.equal(result.render.totalOutputBytes, 12_000);
assert.equal(result.render.totalSubtitleBytes, 720);
assert.deepEqual(
  result.render.clipOutputs.map((clip) => ({
    index: clip.index,
    outputByteSize: clip.outputByteSize,
    subtitleByteSize: clip.subtitleByteSize,
    durationDeltaMs: clip.durationDeltaMs,
    longSilenceCount: clip.longSilenceCount,
    sourceSegmentCount: clip.sourceSegmentCount,
  })),
  [
    {
      index: 0,
      outputByteSize: 5_000,
      subtitleByteSize: 300,
      durationDeltaMs: 25,
      longSilenceCount: 0,
      sourceSegmentCount: 2,
    },
    {
      index: 1,
      outputByteSize: 7_000,
      subtitleByteSize: 420,
      durationDeltaMs: 30,
      longSilenceCount: 0,
      sourceSegmentCount: 1,
    },
  ],
);
assert.equal(result.evidence.ready, true);
assert.deepEqual(result.evidence.summary, {
  speechSegmentCount: 12,
  semanticClipCount: 2,
  reviewSegmentCount: 2,
  renderedSliceCount: 2,
});
assert.equal(result.thresholds.requireEvidenceReady, true);
assert.equal(result.thresholdResults.every((threshold) => threshold.passed), true);
assert.equal(result.ready, true);
assert.deepEqual(result.blockers, []);
assert.deepEqual(JSON.parse(fs.readFileSync(reportPath, 'utf8')), result);
assert.match(
  formatAutoCutSmartSlicePerformanceBenchmarkMessage(result),
  /ok - autocut smart slice performance benchmark .* clips=2 elapsed=999ms outputBytes=12000/u,
);

const blockedReport = await runAutoCutSmartSlicePerformanceBenchmark({
  inputPath,
  outputDir,
  profile: 'desktop-duration',
  reportPath: path.join(outputDir, 'performance-benchmark-blocked.json'),
  generatedAt: '2026-05-16T08:35:00.000Z',
  maxTotalElapsedMs: 900,
  clock: createSequenceClock({
    isoTimes: ['2026-05-16T08:35:01.000Z', '2026-05-16T08:35:02.000Z'],
    monotonicTimesMs: [2_000, 3_000],
  }),
  runner: async () => createSuccessfulAcceptanceResult({
    inputPath,
    outputDir,
    sliceOnePath,
    sliceTwoPath,
    subtitleOnePath,
    subtitleTwoPath,
  }),
});

assert.equal(blockedReport.ready, false);
assert.equal(
  blockedReport.blockers.some((blocker) => blocker.code === 'SMART_SLICE_PERFORMANCE_TOTAL_ELAPSED_EXCEEDED'),
  true,
  'benchmark report fails closed when configured performance thresholds are exceeded',
);

const renderedMinuteThresholdReport = await runAutoCutSmartSlicePerformanceBenchmark({
  inputPath,
  outputDir,
  profile: 'desktop-duration',
  reportPath: path.join(outputDir, 'performance-benchmark-rendered-minute.json'),
  generatedAt: '2026-05-16T08:40:00.000Z',
  maxElapsedMsPerRenderedMinute: 930,
  clock: createSequenceClock({
    isoTimes: ['2026-05-16T08:40:01.000Z', '2026-05-16T08:40:02.000Z'],
    monotonicTimesMs: [4_000, 5_000],
  }),
  runner: async () => createSuccessfulAcceptanceResult({
    inputPath,
    outputDir,
    sliceOnePath,
    sliceTwoPath,
    subtitleOnePath,
    subtitleTwoPath,
  }),
});

const renderedMinuteThreshold = renderedMinuteThresholdReport.thresholdResults.find((threshold) =>
  threshold.code === 'SMART_SLICE_PERFORMANCE_ELAPSED_PER_RENDERED_MINUTE_LIMIT'
);
assert.deepEqual(
  renderedMinuteThreshold,
  {
    code: 'SMART_SLICE_PERFORMANCE_ELAPSED_PER_RENDERED_MINUTE_LIMIT',
    passed: true,
    actual: 922,
    expected: 930,
  },
  'rendered-minute performance threshold must use generated clip duration, not full source duration',
);
assert.equal(renderedMinuteThresholdReport.ready, true);

const failedReportPath = path.join(outputDir, 'performance-benchmark-failed.json');
const failedReport = await runAutoCutSmartSlicePerformanceBenchmark({
  inputPath,
  outputDir,
  profile: 'desktop-duration',
  reportPath: failedReportPath,
  generatedAt: '2026-05-16T08:45:00.000Z',
  clock: createSequenceClock({
    isoTimes: ['2026-05-16T08:45:01.000Z', '2026-05-16T08:45:01.250Z'],
    monotonicTimesMs: [6_000, 6_250],
  }),
  runner: async () => {
    throw new Error('ffmpeg render failed');
  },
});

assert.equal(failedReport.ready, false);
assert.equal(failedReport.timing.totalElapsedMs, 250);
assert.equal(failedReport.input.byteSize, 1_048_699);
assert.equal(failedReport.render.renderedClipCount, 0);
assert.equal(
  failedReport.blockers.some((blocker) =>
    blocker.code === 'SMART_SLICE_PERFORMANCE_RUN_FAILED' &&
      blocker.message.includes('ffmpeg render failed')
  ),
  true,
  'benchmark writes a blocked report when the real-media runner fails before producing acceptance evidence',
);
assert.deepEqual(JSON.parse(fs.readFileSync(failedReportPath, 'utf8')), failedReport);

const defaultRunnerCalls = [];
const genericDefaultRunner = createDefaultSmartSlicePerformanceBenchmarkRunner({
  genericRealMediaRunner: async (options) => {
    defaultRunnerCalls.push({ kind: 'generic-real-media', options });
    return createSuccessfulAcceptanceResult({
      inputPath,
      outputDir,
      sliceOnePath,
      sliceTwoPath,
      subtitleOnePath,
      subtitleTwoPath,
    });
  },
  wenan5Runner: async (options) => {
    defaultRunnerCalls.push({ kind: 'wenan5', options });
    return createSuccessfulAcceptanceResult({
      inputPath,
      outputDir,
      sliceOnePath,
      sliceTwoPath,
      subtitleOnePath,
      subtitleTwoPath,
    });
  },
  baiduNetdiskRunner: async (options) => {
    defaultRunnerCalls.push({ kind: 'baidunetdisk', options });
    return createSuccessfulAcceptanceResult({
      inputPath,
      outputDir,
      sliceOnePath,
      sliceTwoPath,
      subtitleOnePath,
      subtitleTwoPath,
    });
  },
});
await genericDefaultRunner({
  inputPath,
  outputDir,
  transcriptPath: path.join(outputDir, 'same-source-transcript.json'),
  profile: 'desktop-duration',
});
assert.equal(defaultRunnerCalls.at(-1)?.kind, 'generic-real-media');
assert.equal(
  defaultRunnerCalls.at(-1)?.options.transcriptPath,
  path.join(outputDir, 'same-source-transcript.json'),
  'default benchmark runner must send caller-provided transcripts to the generic real-media runner, not the wenan5 fixture path',
);

await genericDefaultRunner({ inputPath, outputDir, profile: 'desktop-duration' });
assert.equal(
  defaultRunnerCalls.at(-1)?.kind,
  'wenan5',
  'explicit input without same-source transcript remains reserved for the wenan5 real-media acceptance path',
);

await genericDefaultRunner({ outputDir, profile: 'desktop-duration' });
assert.equal(
  defaultRunnerCalls.at(-1)?.kind,
  'baidunetdisk',
  'benchmark runner without an explicit input keeps the BaiduNetdisk fixture acceptance path',
);

console.log('ok - Smart Slice performance benchmark contract');

function createSuccessfulAcceptanceResult({
  inputPath,
  outputDir,
  sliceOnePath,
  sliceTwoPath,
  subtitleOnePath,
  subtitleTwoPath,
}) {
  return {
    ready: true,
    outputDir,
    planPath: path.join(outputDir, 'plan.json'),
    verificationPath: path.join(outputDir, 'verification.json'),
    evidencePackage: {
      speechToTextPath: path.join(outputDir, 'evidence', 'speech-to-text.json'),
      semanticSegmentationPath: path.join(outputDir, 'evidence', 'semantic-segmentation.json'),
      renderArtifactManifestPath: path.join(outputDir, 'evidence', 'render-artifact-manifest.json'),
    },
    executionEvidenceReport: {
      ready: true,
      summary: {
        speechSegmentCount: 12,
        semanticClipCount: 2,
        reviewSegmentCount: 2,
        renderedSliceCount: 2,
      },
      blockers: [],
    },
    report: {
      ready: true,
      input: inputPath,
      transcript: path.join(outputDir, 'speech-transcript.json'),
      outputDir,
      profile: 'desktop-duration',
      sourceDurationMs: 120_000,
      plannedClipCount: 2,
      renderedClipCount: 2,
      blockers: [],
      clips: [
        {
          index: 0,
          outputPath: sliceOnePath,
          outputDurationMs: 30_025,
          durationDeltaMs: 25,
          longSilenceCount: 0,
          sourceStartMs: 1_000,
          sourceEndMs: 31_000,
          sourceSegments: [
            { startMs: 1_000, endMs: 15_000 },
            { startMs: 16_000, endMs: 31_000 },
          ],
          removedSilenceMs: 1_000,
          internalSilenceTrimCount: 1,
          subtitlePath: subtitleOnePath,
          subtitleByteSize: 300,
          blockers: [],
        },
        {
          index: 1,
          outputPath: sliceTwoPath,
          outputDurationMs: 35_030,
          durationDeltaMs: 30,
          longSilenceCount: 0,
          sourceStartMs: 40_000,
          sourceEndMs: 75_000,
          sourceSegments: [{ startMs: 40_000, endMs: 75_000 }],
          subtitlePath: subtitleTwoPath,
          subtitleByteSize: 420,
          blockers: [],
        },
      ],
    },
  };
}

function createSequenceClock({ isoTimes, monotonicTimesMs }) {
  let isoIndex = 0;
  let monotonicIndex = 0;
  return {
    nowIso() {
      const value = isoTimes[isoIndex];
      isoIndex += 1;
      return value;
    },
    nowMs() {
      const value = monotonicTimesMs[monotonicIndex];
      monotonicIndex += 1;
      return value;
    },
  };
}
