#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import {
  runAutoCutBaiduNetdiskRealMediaSliceAcceptanceCheck,
} from './check-autocut-baidunetdisk-real-media-slice.mjs';
import {
  runAutoCutGenericRealMediaSliceCheck,
} from './check-autocut-generic-real-media-slice.mjs';
import {
  runAutoCutWenan5RealMediaSliceCheck,
} from './check-autocut-wenan5-real-media-slice.mjs';
import {
  normalizeAutoCutCliArgs,
  readAutoCutCliOptionValue,
} from './autocut-cli-args.mjs';

const __filename = fileURLToPath(import.meta.url);
const schema = 'smart-slice.performance-benchmark.v1';
const defaultOutputDir = 'artifacts/autocut-diagnostics/wenan5/slices-baidunetdisk-performance-benchmark';
const defaultReportFileName = 'performance-benchmark.json';

export async function runAutoCutSmartSlicePerformanceBenchmark(options = {}) {
  const {
    runner = createDefaultSmartSlicePerformanceBenchmarkRunner(options),
    clock = createDefaultClock(),
    generatedAt = new Date().toISOString(),
  } = options;
  const outputDir = path.resolve(options.outputDir ?? defaultOutputDir);
  const runnerOptions = createRunnerOptions({
    ...options,
    outputDir,
  });
  const startedAt = clock.nowIso();
  const startedAtMs = clock.nowMs();
  let acceptanceResult;
  let runError;
  try {
    acceptanceResult = await runner(runnerOptions);
  } catch (error) {
    runError = error;
  }
  const finishedAtMs = clock.nowMs();
  const finishedAt = clock.nowIso();

  const report = createAutoCutSmartSlicePerformanceBenchmarkReport({
    acceptanceResult,
    runError,
    generatedAt,
    startedAt,
    finishedAt,
    totalElapsedMs: Math.max(0, Math.round(finishedAtMs - startedAtMs)),
    inputPath: options.inputPath ?? acceptanceResult?.report?.input,
    outputDir,
    profile: options.profile ?? acceptanceResult?.report?.profile,
    reportPath: options.reportPath,
    thresholds: createThresholdOptions(options),
  });
  writeJsonAtomic(report.reportPath, report);
  return report;
}

export function createAutoCutSmartSlicePerformanceBenchmarkReport({
  acceptanceResult,
  runError,
  generatedAt = new Date().toISOString(),
  startedAt,
  finishedAt,
  totalElapsedMs,
  inputPath,
  outputDir,
  profile,
  reportPath,
  thresholds = {},
} = {}) {
  const resolvedOutputDir = path.resolve(outputDir ?? acceptanceResult?.outputDir ?? defaultOutputDir);
  const resolvedReportPath = path.resolve(reportPath ?? path.join(resolvedOutputDir, defaultReportFileName));
  const resolvedInputPath = inputPath ? path.resolve(inputPath) : path.resolve(acceptanceResult?.report?.input ?? '');
  const sourceDurationMs = normalizeNonNegativeInteger(acceptanceResult?.report?.sourceDurationMs) ?? 0;
  const renderedClips = normalizeClipReports(acceptanceResult?.report?.clips);
  const clipOutputs = renderedClips.map((clip) => createClipOutputBenchmarkSnapshot(clip));
  const totalOutputBytes = clipOutputs.reduce((sum, clip) => sum + clip.outputByteSize, 0);
  const totalSubtitleBytes = clipOutputs.reduce((sum, clip) => sum + clip.subtitleByteSize, 0);
  const totalRenderedDurationMs = clipOutputs.reduce((sum, clip) => sum + clip.outputDurationMs, 0);
  const evidenceSummary = createExecutionEvidenceSummary(acceptanceResult?.executionEvidenceReport?.summary);
  const thresholdResults = createThresholdResults({
    acceptanceResult,
    totalElapsedMs,
    sourceDurationMs,
    clipOutputs,
    thresholds,
  });
  const blockers = createBenchmarkBlockers({
    acceptanceResult,
    runError,
    inputPath: resolvedInputPath,
    clipOutputs,
    thresholdResults,
  });

  return {
    schema,
    generatedAt,
    startedAt,
    finishedAt,
    reportPath: resolvedReportPath,
    input: {
      path: resolvedInputPath,
      byteSize: readFileByteSize(resolvedInputPath),
    },
    outputDir: resolvedOutputDir,
    profile: profile ?? '',
    sourceDurationMs,
    timing: {
      totalElapsedMs: normalizeNonNegativeInteger(totalElapsedMs) ?? 0,
      phases: [
        {
          name: 'real-media-smart-slice-acceptance',
          startedAt,
          finishedAt,
          elapsedMs: normalizeNonNegativeInteger(totalElapsedMs) ?? 0,
        },
      ],
      renderedMediaMsPerElapsedSecond: totalElapsedMs > 0
        ? roundMetric(totalRenderedDurationMs / (totalElapsedMs / 1_000))
        : 0,
    },
    render: {
      plannedClipCount: normalizeNonNegativeInteger(acceptanceResult?.report?.plannedClipCount) ?? renderedClips.length,
      renderedClipCount: normalizeNonNegativeInteger(acceptanceResult?.report?.renderedClipCount) ?? renderedClips.length,
      totalRenderedDurationMs,
      totalOutputBytes,
      totalSubtitleBytes,
      clipOutputs,
    },
    evidence: {
      ready: acceptanceResult?.executionEvidenceReport?.ready === true,
      summary: evidenceSummary,
      blockers: normalizeBlockers(acceptanceResult?.executionEvidenceReport?.blockers),
      paths: {
        speechToTextPath: normalizeString(acceptanceResult?.evidencePackage?.speechToTextPath),
        semanticSegmentationPath: normalizeString(acceptanceResult?.evidencePackage?.semanticSegmentationPath),
        renderArtifactManifestPath: normalizeString(acceptanceResult?.evidencePackage?.renderArtifactManifestPath),
      },
    },
    thresholds: {
      requireEvidenceReady: thresholds.requireEvidenceReady !== false,
      ...(Number.isFinite(thresholds.maxTotalElapsedMs) ? { maxTotalElapsedMs: Math.round(thresholds.maxTotalElapsedMs) } : {}),
      ...(Number.isFinite(thresholds.maxElapsedMsPerRenderedMinute)
        ? { maxElapsedMsPerRenderedMinute: Math.round(thresholds.maxElapsedMsPerRenderedMinute) }
        : {}),
      ...(Number.isFinite(thresholds.minRenderedClipCount)
        ? { minRenderedClipCount: Math.round(thresholds.minRenderedClipCount) }
        : {}),
    },
    thresholdResults,
    acceptance: {
      ready: acceptanceResult?.ready === true && acceptanceResult?.report?.ready === true,
      planPath: normalizeString(acceptanceResult?.planPath),
      verificationPath: normalizeString(acceptanceResult?.verificationPath),
      blockers: normalizeBlockers(acceptanceResult?.report?.blockers),
    },
    ready: blockers.length === 0,
    blockers,
  };
}

export function formatAutoCutSmartSlicePerformanceBenchmarkMessage(report) {
  const prefix = report.ready ? 'ok' : 'blocked';
  return [
    `${prefix} - autocut smart slice performance benchmark`,
    report.input.path,
    `clips=${report.render.renderedClipCount}`,
    `elapsed=${report.timing.totalElapsedMs}ms`,
    `outputBytes=${report.render.totalOutputBytes}`,
    `evidence=${report.evidence.ready ? 'ready' : 'blocked'}`,
    `report=${report.reportPath}`,
  ].join(' ');
}

export function createDefaultSmartSlicePerformanceBenchmarkRunner(options = {}) {
  const {
    genericRealMediaRunner = runAutoCutGenericRealMediaSliceCheck,
    wenan5Runner = runAutoCutWenan5RealMediaSliceCheck,
    baiduNetdiskRunner = runAutoCutBaiduNetdiskRealMediaSliceAcceptanceCheck,
  } = options;
  return async (runnerOptions) => {
    if (runnerOptions.transcriptPath?.trim()) {
      return genericRealMediaRunner(runnerOptions);
    }
    if ((runnerOptions.inputPath ?? options.inputPath)?.trim()) {
      return wenan5Runner(runnerOptions);
    }
    return baiduNetdiskRunner(runnerOptions);
  };
}

function createRunnerOptions(options) {
  return removeUndefinedProperties({
    rootDir: options.rootDir,
    inputPath: options.inputPath,
    outputDir: options.outputDir,
    transcriptPath: options.transcriptPath,
    ffmpegPath: options.ffmpegPath,
    ffprobePath: options.ffprobePath,
    profile: options.profile,
    renderClipLimit: options.renderClipLimit,
  });
}

function createThresholdOptions(options) {
  return {
    requireEvidenceReady: options.requireEvidenceReady,
    maxTotalElapsedMs: normalizeOptionalNumber(options.maxTotalElapsedMs),
    maxElapsedMsPerRenderedMinute: normalizeOptionalNumber(options.maxElapsedMsPerRenderedMinute),
    minRenderedClipCount: normalizeOptionalNumber(options.minRenderedClipCount),
  };
}

function createThresholdResults({
  acceptanceResult,
  totalElapsedMs,
  clipOutputs,
  thresholds,
}) {
  const elapsedMs = normalizeNonNegativeInteger(totalElapsedMs) ?? 0;
  const renderedClipCount = normalizeNonNegativeInteger(acceptanceResult?.report?.renderedClipCount) ?? clipOutputs.length;
  const totalRenderedDurationMs = clipOutputs.reduce((sum, clip) => sum + clip.outputDurationMs, 0);
  const results = [
    {
      code: 'SMART_SLICE_PERFORMANCE_ACCEPTANCE_READY',
      passed: !acceptanceResult ? false : acceptanceResult?.ready === true && acceptanceResult?.report?.ready === true,
      actual: !acceptanceResult ? false : acceptanceResult?.ready === true && acceptanceResult?.report?.ready === true,
      expected: true,
    },
    {
      code: 'SMART_SLICE_PERFORMANCE_EVIDENCE_READY',
      passed: thresholds.requireEvidenceReady === false || acceptanceResult?.executionEvidenceReport?.ready === true,
      actual: acceptanceResult?.executionEvidenceReport?.ready === true,
      expected: true,
    },
    {
      code: 'SMART_SLICE_PERFORMANCE_OUTPUT_ARTIFACTS_PRESENT',
      passed: clipOutputs.length > 0 && clipOutputs.every((clip) => clip.outputExists && clip.outputByteSize > 0),
      actual: clipOutputs.filter((clip) => clip.outputExists && clip.outputByteSize > 0).length,
      expected: renderedClipCount,
    },
  ];

  if (Number.isFinite(thresholds.minRenderedClipCount)) {
    results.push({
      code: 'SMART_SLICE_PERFORMANCE_RENDERED_CLIPS_MINIMUM',
      passed: renderedClipCount >= thresholds.minRenderedClipCount,
      actual: renderedClipCount,
      expected: Math.round(thresholds.minRenderedClipCount),
    });
  }

  if (Number.isFinite(thresholds.maxTotalElapsedMs)) {
    results.push({
      code: 'SMART_SLICE_PERFORMANCE_TOTAL_ELAPSED_LIMIT',
      passed: elapsedMs <= thresholds.maxTotalElapsedMs,
      actual: elapsedMs,
      expected: Math.round(thresholds.maxTotalElapsedMs),
    });
  }

  if (Number.isFinite(thresholds.maxElapsedMsPerRenderedMinute) && totalRenderedDurationMs > 0) {
    const renderedMinutes = Math.max(1 / 60, totalRenderedDurationMs / 60_000);
    const elapsedMsPerRenderedMinute = Math.round(elapsedMs / renderedMinutes);
    results.push({
      code: 'SMART_SLICE_PERFORMANCE_ELAPSED_PER_RENDERED_MINUTE_LIMIT',
      passed: elapsedMsPerRenderedMinute <= thresholds.maxElapsedMsPerRenderedMinute,
      actual: elapsedMsPerRenderedMinute,
      expected: Math.round(thresholds.maxElapsedMsPerRenderedMinute),
    });
  }

  return results;
}

function createBenchmarkBlockers({
  acceptanceResult,
  runError,
  inputPath,
  clipOutputs,
  thresholdResults,
}) {
  const blockers = [];
  if (runError) {
    blockers.push({
      code: 'SMART_SLICE_PERFORMANCE_RUN_FAILED',
      message: `Smart Slice benchmark runner failed: ${formatErrorMessage(runError)}`,
    });
  }
  if (!inputPath || !fs.existsSync(inputPath) || !fs.statSync(inputPath).isFile()) {
    blockers.push({
      code: 'SMART_SLICE_PERFORMANCE_INPUT_FILE_MISSING',
      message: `Smart Slice benchmark input file is missing: ${inputPath}`,
    });
  }
  if (acceptanceResult && (acceptanceResult.ready !== true || acceptanceResult.report?.ready !== true)) {
    blockers.push({
      code: 'SMART_SLICE_PERFORMANCE_ACCEPTANCE_NOT_READY',
      message: 'Smart Slice real-media acceptance result is not ready.',
      details: normalizeBlockers(acceptanceResult?.report?.blockers),
    });
  }
  if (acceptanceResult && acceptanceResult.executionEvidenceReport?.ready !== true) {
    blockers.push({
      code: 'SMART_SLICE_PERFORMANCE_EVIDENCE_NOT_READY',
      message: 'Smart Slice execution evidence package is not ready.',
      details: normalizeBlockers(acceptanceResult?.executionEvidenceReport?.blockers),
    });
  }
  for (const clip of clipOutputs) {
    if (!clip.outputExists || clip.outputByteSize <= 0) {
      blockers.push({
        code: 'SMART_SLICE_PERFORMANCE_OUTPUT_FILE_MISSING',
        message: `Smart Slice benchmark output file is missing or empty: ${clip.outputPath}`,
        clipIndex: clip.index,
      });
    }
    if (clip.longSilenceCount > 0) {
      blockers.push({
        code: 'SMART_SLICE_PERFORMANCE_LONG_SILENCE_FOUND',
        message: `Smart Slice benchmark output clip has long silence: ${clip.outputPath}`,
        clipIndex: clip.index,
        longSilenceCount: clip.longSilenceCount,
      });
    }
  }
  for (const threshold of thresholdResults) {
    if (threshold.passed) {
      continue;
    }
    blockers.push(createThresholdBlocker(threshold));
  }
  return blockers;
}

function createThresholdBlocker(threshold) {
  if (threshold.code === 'SMART_SLICE_PERFORMANCE_TOTAL_ELAPSED_LIMIT') {
    return {
      code: 'SMART_SLICE_PERFORMANCE_TOTAL_ELAPSED_EXCEEDED',
      message: `Smart Slice benchmark total elapsed time exceeded ${threshold.expected}ms: ${threshold.actual}ms`,
      actual: threshold.actual,
      expected: threshold.expected,
    };
  }
  if (threshold.code === 'SMART_SLICE_PERFORMANCE_RENDERED_CLIPS_MINIMUM') {
    return {
      code: 'SMART_SLICE_PERFORMANCE_RENDERED_CLIPS_BELOW_MINIMUM',
      message: `Smart Slice benchmark rendered fewer clips than required: ${threshold.actual}/${threshold.expected}`,
      actual: threshold.actual,
      expected: threshold.expected,
    };
  }
  return {
    code: threshold.code.replace(/_LIMIT$/u, '_FAILED'),
    message: `Smart Slice benchmark threshold failed: ${threshold.code}`,
    actual: threshold.actual,
    expected: threshold.expected,
  };
}

function normalizeClipReports(value) {
  return Array.isArray(value) ? value.filter((clip) => clip && typeof clip === 'object') : [];
}

function createClipOutputBenchmarkSnapshot(clip) {
  const outputPath = normalizeString(clip.outputPath);
  const subtitlePath = normalizeString(clip.subtitlePath);
  const outputByteSize = readFileByteSize(outputPath);
  const subtitleByteSize = subtitlePath
    ? readFileByteSize(subtitlePath) || (normalizeNonNegativeInteger(clip.subtitleByteSize) ?? 0)
    : 0;
  return {
    index: normalizeNonNegativeInteger(clip.index) ?? 0,
    outputPath,
    outputExists: outputPath ? fs.existsSync(outputPath) && fs.statSync(outputPath).isFile() : false,
    outputByteSize,
    outputDurationMs: normalizeNonNegativeInteger(clip.outputDurationMs) ?? 0,
    durationDeltaMs: normalizeNonNegativeInteger(clip.durationDeltaMs) ?? 0,
    longSilenceCount: normalizeNonNegativeInteger(clip.longSilenceCount) ?? 0,
    sourceStartMs: normalizeNonNegativeInteger(clip.sourceStartMs) ?? 0,
    sourceEndMs: normalizeNonNegativeInteger(clip.sourceEndMs) ?? 0,
    sourceSegmentCount: Array.isArray(clip.sourceSegments) ? clip.sourceSegments.length : 0,
    removedSilenceMs: normalizeNonNegativeInteger(clip.removedSilenceMs) ?? 0,
    internalSilenceTrimCount: normalizeNonNegativeInteger(clip.internalSilenceTrimCount) ?? 0,
    subtitlePath,
    subtitleByteSize,
    blockers: normalizeBlockers(clip.blockers),
  };
}

function createExecutionEvidenceSummary(summary) {
  return {
    speechSegmentCount: normalizeNonNegativeInteger(summary?.speechSegmentCount) ?? 0,
    semanticClipCount: normalizeNonNegativeInteger(summary?.semanticClipCount) ?? 0,
    reviewSegmentCount: normalizeNonNegativeInteger(summary?.reviewSegmentCount) ?? 0,
    renderedSliceCount: normalizeNonNegativeInteger(summary?.renderedSliceCount) ?? 0,
  };
}

function readFileByteSize(filePath) {
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return 0;
  }
  return fs.statSync(filePath).size;
}

function writeJsonAtomic(targetPath, value) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tempPath, targetPath);
}

function normalizeBlockers(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((blocker) => {
    if (typeof blocker === 'string') {
      return blocker;
    }
    if (blocker && typeof blocker === 'object') {
      return {
        ...blocker,
      };
    }
    return String(blocker);
  });
}

function formatErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOptionalNumber(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function normalizeNonNegativeInteger(value) {
  const number = normalizeOptionalNumber(value);
  if (!Number.isFinite(number)) {
    return undefined;
  }
  return Math.max(0, Math.round(number));
}

function roundMetric(value) {
  return Math.round(value * 100) / 100;
}

function removeUndefinedProperties(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  );
}

function createDefaultClock() {
  return {
    nowIso() {
      return new Date().toISOString();
    },
    nowMs() {
      return performance.now();
    },
  };
}

function parseArgs(argv) {
  const args = normalizeAutoCutCliArgs(argv);
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--root') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut Smart Slice performance benchmark',
      });
      options.rootDir = option.value;
      index = option.nextIndex;
    } else if (arg === '--input') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut Smart Slice performance benchmark',
      });
      options.inputPath = option.value;
      index = option.nextIndex;
    } else if (arg === '--output') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut Smart Slice performance benchmark',
      });
      options.outputDir = option.value;
      index = option.nextIndex;
    } else if (arg === '--report') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut Smart Slice performance benchmark',
      });
      options.reportPath = option.value;
      index = option.nextIndex;
    } else if (arg === '--transcript') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut Smart Slice performance benchmark',
      });
      options.transcriptPath = option.value;
      index = option.nextIndex;
    } else if (arg === '--ffmpeg') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut Smart Slice performance benchmark',
      });
      options.ffmpegPath = option.value;
      index = option.nextIndex;
    } else if (arg === '--ffprobe') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut Smart Slice performance benchmark',
      });
      options.ffprobePath = option.value;
      index = option.nextIndex;
    } else if (arg === '--profile') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut Smart Slice performance benchmark',
      });
      options.profile = option.value;
      index = option.nextIndex;
    } else if (arg === '--max-total-elapsed-ms') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut Smart Slice performance benchmark',
      });
      options.maxTotalElapsedMs = Number(option.value);
      index = option.nextIndex;
    } else if (arg === '--max-elapsed-ms-per-rendered-minute') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut Smart Slice performance benchmark',
      });
      options.maxElapsedMsPerRenderedMinute = Number(option.value);
      index = option.nextIndex;
    } else if (arg === '--min-rendered-clips') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut Smart Slice performance benchmark',
      });
      options.minRenderedClipCount = Number(option.value);
      index = option.nextIndex;
    } else if (arg === '--render-limit') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut Smart Slice performance benchmark',
      });
      options.renderClipLimit = Number(option.value);
      index = option.nextIndex;
    } else if (arg === '--no-evidence-required') {
      options.requireEvidenceReady = false;
    } else {
      throw new Error(`unknown AutoCut Smart Slice performance benchmark option: ${arg}`);
    }
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  try {
    const report = await runAutoCutSmartSlicePerformanceBenchmark(parseArgs(process.argv.slice(2)));
    console.log(formatAutoCutSmartSlicePerformanceBenchmarkMessage(report));
    if (!report.ready) {
      for (const blocker of report.blockers) {
        console.error(`${blocker.code}: ${blocker.message}`);
      }
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
