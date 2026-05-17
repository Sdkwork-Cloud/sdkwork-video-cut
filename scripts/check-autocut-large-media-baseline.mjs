#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  runAutoCutSmartSlicePerformanceBenchmark,
} from './check-autocut-smart-slice-performance-benchmark.mjs';
import {
  normalizeSmartSliceTranscriptEvidenceText,
} from '../packages/sdkwork-autocut-slicer/src/service/slicePlanner.ts';
import {
  normalizeAutoCutCliArgs,
  readAutoCutCliOptionValue,
} from './autocut-cli-args.mjs';

const __filename = fileURLToPath(import.meta.url);
const schema = 'smart-slice.large-media-baseline.v1';
const defaultOutputDir = 'artifacts/autocut-diagnostics/large-media-baseline';
const defaultReportFileName = 'large-media-baseline.json';
const defaultFfprobePath = process.env.SDKWORK_AUTOCUT_FFPROBE_EXECUTABLE ?? process.env.SDKWORK_AUTOCUT_FFPROBE ?? 'ffprobe';

export async function runAutoCutLargeMediaBaseline(options = {}) {
  const {
    generatedAt = new Date().toISOString(),
    runCommand = runAutoCutLargeMediaCommand,
    benchmarkRunner = runAutoCutSmartSlicePerformanceBenchmark,
  } = options;
  const inputPath = path.resolve(requiredText(options.inputPath, 'missing --input path for AutoCut large media baseline'));
  const outputDir = path.resolve(options.outputDir ?? defaultOutputDir);
  const reportPath = path.resolve(options.reportPath ?? path.join(outputDir, defaultReportFileName));
  fs.mkdirSync(outputDir, { recursive: true });

  const blockers = [];
  const media = probeLargeMedia(runCommand, options.ffprobePath ?? defaultFfprobePath, inputPath, blockers);
  const transcript = createTranscriptState({
    inputPath,
    outputDir,
    transcriptPath: options.transcriptPath,
    sourceDurationMs: media.durationMs,
    generatedAt,
    blockers,
  });
  const benchmark = await createBenchmarkState({
    inputPath,
    outputDir,
    transcriptPath: options.transcriptPath,
    transcriptReady: transcript.status === 'ready',
    benchmarkRunner,
    profile: options.profile,
    ffmpegPath: options.ffmpegPath,
    ffprobePath: options.ffprobePath,
    renderClipLimit: options.renderClipLimit,
    blockers,
  });
  const report = {
    schema,
    generatedAt,
    reportPath,
    input: {
      path: inputPath,
      byteSize: readFileByteSize(inputPath),
    },
    outputDir,
    media,
    transcript,
    benchmark,
    ready: blockers.length === 0,
    blockers,
  };
  writeJsonAtomic(reportPath, report);
  return report;
}

export function formatAutoCutLargeMediaBaselineMessage(report) {
  const prefix = report.ready ? 'ok' : 'blocked';
  return [
    `${prefix} - autocut large media baseline`,
    report.input.path,
    `duration=${report.media.durationMs}ms`,
    `transcript=${report.transcript.status}`,
    `benchmark=${report.benchmark.status}`,
    `report=${report.reportPath}`,
  ].join(' ');
}

function probeLargeMedia(runCommand, ffprobePath, inputPath, blockers) {
  const media = {
    durationMs: 0,
    byteSize: readFileByteSize(inputPath),
    bitRate: 0,
    video: {
      codec: '',
      width: 0,
      height: 0,
    },
    audio: {
      codec: '',
      sampleRate: 0,
      channels: 0,
    },
  };
  if (!fs.existsSync(inputPath) || !fs.statSync(inputPath).isFile()) {
    blockers.push({
      code: 'SMART_SLICE_LARGE_MEDIA_INPUT_MISSING',
      message: `Large media input file is missing: ${inputPath}`,
    });
    return media;
  }

  const output = runCommand(ffprobePath, [
    '-v',
    'error',
    '-show_entries',
    'format=duration,size,bit_rate',
    '-show_entries',
    'stream=index,codec_type,codec_name,width,height,channels,sample_rate',
    '-of',
    'json',
    inputPath,
  ]);
  if (output.status !== 0) {
    blockers.push({
      code: 'SMART_SLICE_LARGE_MEDIA_FFPROBE_FAILED',
      message: `Large media ffprobe failed: ${output.stderr || output.stdout}`,
    });
    return media;
  }

  try {
    const probe = JSON.parse(output.stdout);
    const video = normalizeArray(probe.streams).find((stream) => stream?.codec_type === 'video') ?? {};
    const audio = normalizeArray(probe.streams).find((stream) => stream?.codec_type === 'audio') ?? {};
    return {
      durationMs: Math.round(Number(probe.format?.duration ?? 0) * 1_000),
      byteSize: normalizeNonNegativeInteger(probe.format?.size) ?? media.byteSize,
      bitRate: normalizeNonNegativeInteger(probe.format?.bit_rate) ?? 0,
      video: {
        codec: normalizeString(video.codec_name),
        width: normalizeNonNegativeInteger(video.width) ?? 0,
        height: normalizeNonNegativeInteger(video.height) ?? 0,
      },
      audio: {
        codec: normalizeString(audio.codec_name),
        sampleRate: normalizeNonNegativeInteger(audio.sample_rate) ?? 0,
        channels: normalizeNonNegativeInteger(audio.channels) ?? 0,
      },
    };
  } catch (error) {
    blockers.push({
      code: 'SMART_SLICE_LARGE_MEDIA_FFPROBE_JSON_INVALID',
      message: `Large media ffprobe JSON is invalid: ${formatErrorMessage(error)}`,
    });
    return media;
  }
}

function createTranscriptState({
  inputPath,
  outputDir,
  transcriptPath,
  sourceDurationMs,
  generatedAt,
  blockers,
}) {
  const resolvedTranscriptPath = transcriptPath ? path.resolve(transcriptPath) : '';
  if (!resolvedTranscriptPath) {
    blockers.push({
      code: 'SMART_SLICE_LARGE_MEDIA_TRANSCRIPT_MISSING',
      message: 'Large media baseline requires a transcript generated from the same source video. Provide --transcript or run STT first.',
    });
    return {
      status: 'missing',
      path: '',
      evidencePath: '',
      segmentCount: 0,
      language: '',
    };
  }
  if (!fs.existsSync(resolvedTranscriptPath) || !fs.statSync(resolvedTranscriptPath).isFile()) {
    blockers.push({
      code: 'SMART_SLICE_LARGE_MEDIA_TRANSCRIPT_MISSING',
      message: `Large media transcript file is missing: ${resolvedTranscriptPath}`,
    });
    return {
      status: 'missing',
      path: resolvedTranscriptPath,
      evidencePath: '',
      segmentCount: 0,
      language: '',
    };
  }

  const parsed = readWhisperTranscriptSegments(resolvedTranscriptPath);
  const evidencePath = path.join(outputDir, 'evidence', 'speech-to-text.json');
  writeJsonAtomic(evidencePath, {
    schema: 'smart-slice.speech-to-text.v1',
    taskId: createLargeMediaTaskId(inputPath),
    sourceAssetUuid: createLargeMediaTaskId(inputPath),
    sourceDurationMs,
    providerId: 'local-whisper-cli',
    language: parsed.language || 'auto',
    text: parsed.segments.map((segment) => segment.text).join(' '),
    segments: parsed.segments,
    nativeTranscriptPath: resolvedTranscriptPath,
    nativeTranscriptTaskUuid: `${createLargeMediaTaskId(inputPath)}-transcript`,
    nativeTranscriptTaskOutputDir: path.dirname(resolvedTranscriptPath),
    createdAt: generatedAt,
  });

  return {
    status: 'ready',
    path: resolvedTranscriptPath,
    evidencePath,
    segmentCount: parsed.segments.length,
    language: parsed.language || 'auto',
  };
}

async function createBenchmarkState({
  inputPath,
  outputDir,
  transcriptPath,
  transcriptReady,
  benchmarkRunner,
  profile,
  ffmpegPath,
  ffprobePath,
  renderClipLimit,
  blockers,
}) {
  if (!transcriptReady) {
    return {
      status: 'skipped',
      reportPath: '',
      renderedClipCount: 0,
      totalOutputBytes: 0,
      totalElapsedMs: 0,
      evidenceReady: false,
    };
  }
  const benchmarkReport = await benchmarkRunner(removeUndefinedProperties({
    inputPath,
    outputDir,
    transcriptPath,
    profile,
    ffmpegPath,
    ffprobePath,
    renderClipLimit,
    reportPath: path.join(outputDir, 'performance-benchmark.json'),
  }));
  if (!benchmarkReport.ready) {
    blockers.push({
      code: 'SMART_SLICE_LARGE_MEDIA_BENCHMARK_BLOCKED',
      message: 'Large media Smart Slice benchmark is blocked.',
      details: normalizeArray(benchmarkReport.blockers),
    });
  }
  return {
    status: benchmarkReport.ready ? 'ready' : 'blocked',
    reportPath: normalizeString(benchmarkReport.reportPath),
    renderedClipCount: normalizeNonNegativeInteger(benchmarkReport.render?.renderedClipCount) ?? 0,
    totalOutputBytes: normalizeNonNegativeInteger(benchmarkReport.render?.totalOutputBytes) ?? 0,
    totalElapsedMs: normalizeNonNegativeInteger(benchmarkReport.timing?.totalElapsedMs) ?? 0,
    evidenceReady: benchmarkReport.evidence?.ready === true,
  };
}

function readWhisperTranscriptSegments(transcriptPath) {
  const transcript = JSON.parse(fs.readFileSync(transcriptPath, 'utf8'));
  const entries = Array.isArray(transcript.transcription)
    ? transcript.transcription
    : Array.isArray(transcript.segments)
      ? transcript.segments
      : [];
  const segments = entries
    .map((entry, index) => {
      const startMs = normalizeNonNegativeInteger(entry?.offsets?.from ?? entry?.startMs ?? secondsToMs(entry?.start));
      const endMs = normalizeNonNegativeInteger(entry?.offsets?.to ?? entry?.endMs ?? secondsToMs(entry?.end));
      const text = normalizeSmartSliceTranscriptEvidenceText(entry?.text);
      if (startMs === undefined || endMs === undefined || endMs <= startMs || !text) {
        return undefined;
      }
      return {
        id: `stt-${String(index + 1).padStart(5, '0')}`,
        startMs,
        endMs,
        text,
        speaker: normalizeString(entry?.speaker) || 'Speaker 1',
      };
    })
    .filter(Boolean)
    .sort((first, second) => first.startMs - second.startMs || first.endMs - second.endMs);
  if (segments.length === 0) {
    throw new Error(`Large media transcript contains no timestamped speech segments: ${transcriptPath}`);
  }
  return {
    language: normalizeString(transcript.result?.language ?? transcript.language),
    segments,
  };
}

function secondsToMs(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 1_000) : undefined;
}

function createLargeMediaTaskId(inputPath) {
  return `large-media-${path.basename(inputPath).replace(/[^a-z0-9]+/giu, '-').replace(/^-|-$/gu, '').toLowerCase() || 'source'}`;
}

function requiredText(value, message) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(message);
  }
  return value;
}

function readFileByteSize(filePath) {
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return 0;
  }
  return fs.statSync(filePath).size;
}

function writeJsonAtomic(targetPath, value) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(`${targetPath}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(`${targetPath}.tmp`, targetPath);
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNonNegativeInteger(value) {
  const numericValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : undefined;
  if (!Number.isFinite(numericValue)) {
    return undefined;
  }
  return Math.max(0, Math.round(Number(numericValue)));
}

function removeUndefinedProperties(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined && entryValue !== ''),
  );
}

function formatErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function runAutoCutLargeMediaCommand(command, args, { maxBuffer = 32 * 1024 * 1024 } = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    maxBuffer,
  });
  if (result.error) {
    return {
      status: 1,
      stdout: '',
      stderr: result.error.message,
    };
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function parseArgs(argv) {
  const args = normalizeAutoCutCliArgs(argv);
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--input') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut large media baseline',
      });
      options.inputPath = option.value;
      index = option.nextIndex;
    } else if (arg === '--output') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut large media baseline',
      });
      options.outputDir = option.value;
      index = option.nextIndex;
    } else if (arg === '--report') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut large media baseline',
      });
      options.reportPath = option.value;
      index = option.nextIndex;
    } else if (arg === '--transcript') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut large media baseline',
      });
      options.transcriptPath = option.value;
      index = option.nextIndex;
    } else if (arg === '--ffmpeg') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut large media baseline',
      });
      options.ffmpegPath = option.value;
      index = option.nextIndex;
    } else if (arg === '--ffprobe') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut large media baseline',
      });
      options.ffprobePath = option.value;
      index = option.nextIndex;
    } else if (arg === '--profile') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut large media baseline',
      });
      options.profile = option.value;
      index = option.nextIndex;
    } else if (arg === '--render-limit') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut large media baseline',
      });
      options.renderClipLimit = Number(option.value);
      index = option.nextIndex;
    } else {
      throw new Error(`unknown AutoCut large media baseline option: ${arg}`);
    }
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  try {
    const report = await runAutoCutLargeMediaBaseline(parseArgs(process.argv.slice(2)));
    console.log(formatAutoCutLargeMediaBaselineMessage(report));
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
