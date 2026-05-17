#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  normalizeAutoCutCliArgs,
  readAutoCutCliOptionValue,
} from './autocut-cli-args.mjs';

const __filename = fileURLToPath(import.meta.url);
const schema = 'smart-slice.large-media-stt-baseline.v1';
const defaultOutputDir = 'artifacts/autocut-diagnostics/large-media-stt';
const defaultReportFileName = 'stt-baseline.json';
const defaultChunkDurationMs = 10 * 60 * 1_000;
const defaultChunkOverlapMs = 2_000;
const wholeAudioTranscriptionLimitMs = 20 * 60 * 1_000;
const transcriptQualityGuardSchema = 'smart-slice.stt-quality-guard.v1';
const minimumUsefulPcmWavBytes = 4_096;
const speechSourceKindExtractedAudio = 'extracted-audio';
const speechSourceKindSourceMediaDirect = 'source-media-direct';
const defaultFfmpegPath = process.env.SDKWORK_AUTOCUT_FFMPEG_EXECUTABLE ?? process.env.SDKWORK_AUTOCUT_FFMPEG ?? 'ffmpeg';
const defaultWhisperPath =
  process.env.SDKWORK_AUTOCUT_WHISPER_EXECUTABLE ??
  path.resolve('packages/sdkwork-autocut-desktop/src-tauri/binaries/windows-x86_64/whisper-cli.exe');
const defaultModelPath =
  process.env.SDKWORK_AUTOCUT_WHISPER_MODEL ??
  path.join(process.env.APPDATA ?? '', 'com.sdkwork.video-cut', 'media', 'models', 'speech', 'ggml-large-v3-turbo-q5_0.bin');

export async function runAutoCutLargeMediaSttBaseline(options = {}) {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const runCommand = options.runCommand ?? runAutoCutLargeMediaSttCommand;
  const runCommandAsync = options.runCommandAsync ?? runAutoCutLargeMediaSttCommandAsync;
  const inputPath = path.resolve(requiredText(options.inputPath, 'missing --input path for AutoCut large media STT baseline'));
  const outputDir = path.resolve(options.outputDir ?? defaultOutputDir);
  const reportPath = path.resolve(options.reportPath ?? path.join(outputDir, defaultReportFileName));
  const audioPath = path.resolve(options.audioPath ?? path.join(outputDir, 'speech.wav'));
  const transcriptStem = path.resolve(options.transcriptStem ?? path.join(outputDir, 'speech-transcript'));
  const transcriptPath = `${transcriptStem}.json`;
  const chunksDir = path.resolve(options.chunksDir ?? path.join(outputDir, 'chunks'));
  const chunkManifestPath = path.resolve(options.chunkManifestPath ?? path.join(outputDir, 'chunk-manifest.json'));
  const sourceIdentityPath = path.resolve(options.sourceIdentityPath ?? path.join(outputDir, 'source-identity.json'));
  const executablePath = path.resolve(options.executablePath ?? defaultWhisperPath);
  const modelPath = path.resolve(options.modelPath ?? defaultModelPath);
  const language = options.language ?? 'zh';
  const ffmpegPath = options.ffmpegPath ?? defaultFfmpegPath;
  const ffprobePath = options.ffprobePath ?? 'ffprobe';
  const chunkDurationMs = normalizePositiveInteger(options.chunkDurationMs) ?? defaultChunkDurationMs;
  const chunkOverlapMs = Math.min(
    normalizeNonNegativeInteger(options.chunkOverlapMs) ?? defaultChunkOverlapMs,
    Math.max(0, chunkDurationMs - 1_000),
  );
  const parallelism = normalizePositiveInteger(options.parallelism) ?? Math.min(4, Math.max(1, Math.floor(osThreadCount() / 2)));
  const defaultThreadCount = Math.min(8, Math.max(2, osThreadCount()));
  const chunkThreadCount = normalizePositiveInteger(options.chunkThreadCount)
    ?? Math.max(1, Math.min(defaultThreadCount, Math.floor(defaultThreadCount / Math.max(1, parallelism))));
  const decodeOptions = createWhisperDecodeOptions(options);
  const sourceDirectRequested = options.sourceDirect === true;
  let speechSourcePath = sourceDirectRequested ? inputPath : audioPath;
  let speechSourceKind = sourceDirectRequested ? speechSourceKindSourceMediaDirect : speechSourceKindExtractedAudio;
  let fullAudioExtracted = false;
  let resolvedAudioDurationMs = 0;
  const blockers = [];
  const inputIdentity = createSourceIdentity(inputPath);

  fs.mkdirSync(outputDir, { recursive: true });
  validateInputFile(inputPath, 'SMART_SLICE_LARGE_MEDIA_STT_INPUT_MISSING', 'Large media STT input file is missing', blockers);
  validateInputFile(executablePath, 'SMART_SLICE_LARGE_MEDIA_STT_EXECUTABLE_MISSING', 'Whisper executable is missing', blockers);
  validateInputFile(modelPath, 'SMART_SLICE_LARGE_MEDIA_STT_MODEL_MISSING', 'Whisper model is missing', blockers);

  const resumeState = createLargeMediaSttResumeState({
    inputIdentity,
    sourceIdentityPath,
    audioPath,
    transcriptPath,
  });
  const execution = {
    audioAction: 'pending',
    transcriptAction: 'pending',
    transcriptMode: 'pending',
    sourceIdentityPath,
    sourceIdentityMatched: resumeState.sourceIdentityMatched,
  };
  let wholeTranscriptQualityGuard = createEmptyTranscriptQualityGuard();
  let chunkState = createEmptyChunkReportState({
    chunksDir,
    manifestPath: chunkManifestPath,
    chunkDurationMs,
    chunkOverlapMs,
    parallelism,
    chunkThreadCount,
  });

  if (blockers.length === 0 && resumeState.transcriptReusable) {
    execution.audioAction = 'skipped-transcript-ready';
    execution.transcriptAction = 'reused';
    execution.transcriptMode = 'reused';
  }
  if (blockers.length === 0 && !resumeState.transcriptReusable && !sourceDirectRequested && resumeState.audioReusable) {
    execution.audioAction = 'reused';
    fullAudioExtracted = true;
  }
  if (blockers.length === 0 && !resumeState.transcriptReusable && sourceDirectRequested) {
    execution.audioAction = speechSourceKindSourceMediaDirect;
    resolvedAudioDurationMs = normalizePositiveInteger(options.audioDurationMs) ?? probeMediaDurationMs({
      runCommand,
      ffprobePath,
      mediaPath: inputPath,
    });
    if (resolvedAudioDurationMs <= 0) {
      blockers.push({
        code: 'SMART_SLICE_LARGE_MEDIA_DURATION_PROBE_FAILED',
        message: `Large media duration probe failed for source media: ${inputPath}`,
      });
    }
  }
  if (blockers.length === 0 && !resumeState.transcriptReusable && !sourceDirectRequested && !resumeState.audioReusable) {
    extractSpeechAudio({
      runCommand,
      ffmpegPath,
      inputPath,
      audioPath,
      blockers,
    });
    execution.audioAction = blockers.some((blocker) => blocker.code === 'SMART_SLICE_LARGE_MEDIA_AUDIO_EXTRACT_FAILED')
      ? 'failed'
      : 'generated';
    fullAudioExtracted = execution.audioAction === 'generated';
  }
  if (blockers.length === 0 && !resumeState.transcriptReusable && !sourceDirectRequested && isNonEmptyFile(audioPath)) {
    writeSourceIdentity(sourceIdentityPath, inputIdentity);
  }
  if (blockers.length === 0 && !resumeState.transcriptReusable) {
    if (!sourceDirectRequested) {
      resolvedAudioDurationMs = normalizePositiveInteger(options.audioDurationMs) ?? probeMediaDurationMs({
        runCommand,
        ffprobePath,
        mediaPath: audioPath,
      });
    }
    if (sourceDirectRequested || resolvedAudioDurationMs > wholeAudioTranscriptionLimitMs || options.forceChunked === true) {
      execution.transcriptMode = 'chunked-parallel';
      chunkState = await transcribeSpeechAudioChunks({
        runCommand,
        runCommandAsync,
        ffmpegPath,
        executablePath,
        modelPath,
        audioPath: speechSourcePath,
        speechSourceKind,
        fullAudioExtracted,
        chunksDir,
        chunkManifestPath,
        transcriptPath,
        language,
        chunkDurationMs,
        chunkOverlapMs,
        parallelism,
        chunkThreadCount,
        decodeOptions,
        audioDurationMs: resolvedAudioDurationMs,
        blockers,
      });
    } else {
      execution.transcriptMode = 'whole-audio';
      wholeTranscriptQualityGuard = transcribeSpeechAudio({
        runCommand,
        executablePath,
        modelPath,
        audioPath,
        transcriptStem,
        language,
        threadCount: options.threadCount ?? String(defaultThreadCount),
        decodeOptions,
        blockers,
      });
    }
    execution.transcriptAction = blockers.some((blocker) => blocker.code === 'SMART_SLICE_LARGE_MEDIA_WHISPER_FAILED')
      ? 'failed'
      : 'generated';
  }

  const transcriptState = createTranscriptState(transcriptPath, blockers, decodeOptions);
  const evidencePath = path.join(outputDir, 'evidence', 'speech-to-text.json');
  if (transcriptState.status === 'ready') {
    writeSourceIdentity(sourceIdentityPath, inputIdentity);
    writeJsonAtomic(evidencePath, {
      schema: 'smart-slice.speech-to-text.v1',
      taskId: createLargeMediaTaskId(inputPath),
      sourceAssetUuid: createLargeMediaTaskId(inputPath),
      sourceDurationMs: transcriptState.endMs,
      providerId: 'local-whisper-cli',
      language: transcriptState.language,
      text: transcriptState.segments.map((segment) => segment.text).join(' '),
      segments: transcriptState.segments,
      nativeTranscriptPath: transcriptPath,
      nativeTranscriptTaskUuid: `${createLargeMediaTaskId(inputPath)}-transcript`,
      nativeTranscriptTaskOutputDir: outputDir,
      qualityGuard: transcriptState.qualityGuard,
      createdAt: generatedAt,
    });
  }

  const report = {
    schema,
    generatedAt,
    reportPath,
    input: {
      path: inputPath,
      byteSize: readFileByteSize(inputPath),
    },
    audio: {
      path: speechSourcePath,
      extractedAudioPath: fullAudioExtracted ? audioPath : '',
      sourceKind: speechSourceKind,
      fullAudioExtracted,
      byteSize: readFileByteSize(speechSourcePath),
      durationMs: resolvedAudioDurationMs,
      durationLimitApplied: normalizePositiveInteger(options.audioDurationMs) !== undefined,
    },
    toolchain: {
      ffmpegPath: path.resolve(ffmpegPath),
      executablePath,
      modelPath,
      language,
    },
    whisperDecode: decodeOptions,
    sourceIdentity: {
      path: sourceIdentityPath,
      input: inputIdentity,
      matchedExisting: resumeState.sourceIdentityMatched,
    },
    execution,
    chunks: chunkState,
    wholeTranscriptQualityGuard,
    transcript: {
      path: transcriptPath,
      status: transcriptState.status,
      segmentCount: transcriptState.segmentCount,
      language: transcriptState.language,
      endMs: transcriptState.endMs,
      qualityGuard: transcriptState.qualityGuard,
    },
    evidence: {
      path: transcriptState.status === 'ready' ? path.resolve(evidencePath) : '',
      ready: transcriptState.status === 'ready' && fs.existsSync(evidencePath),
    },
    ready: blockers.length === 0 && transcriptState.status === 'ready',
    blockers,
  };
  writeJsonAtomic(reportPath, report);
  return report;
}

export function formatAutoCutLargeMediaSttBaselineMessage(report) {
  const prefix = report.ready ? 'ok' : 'blocked';
  return [
    `${prefix} - autocut large media stt baseline`,
    report.input.path,
    `segments=${report.transcript.segmentCount}`,
    `audioBytes=${report.audio.byteSize}`,
    `report=${report.reportPath}`,
  ].join(' ');
}

function extractSpeechAudio({
  runCommand,
  ffmpegPath,
  inputPath,
  audioPath,
  blockers,
}) {
  fs.mkdirSync(path.dirname(audioPath), { recursive: true });
  const output = runCommand(ffmpegPath, [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-i',
    inputPath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-c:a',
    'pcm_s16le',
    audioPath,
  ], { maxBuffer: 32 * 1024 * 1024 });
  if (output.status !== 0 || !fs.existsSync(audioPath) || fs.statSync(audioPath).size <= 0) {
    blockers.push({
      code: 'SMART_SLICE_LARGE_MEDIA_AUDIO_EXTRACT_FAILED',
      message: `Large media audio extraction failed: ${output.stderr || output.stdout}`,
    });
  }
}

function transcribeSpeechAudio({
  runCommand,
  executablePath,
  modelPath,
  audioPath,
  transcriptStem,
  language,
  threadCount,
  decodeOptions,
  blockers,
}) {
  const output = runCommand(executablePath, [
    '-m',
    modelPath,
    '-t',
    threadCount,
    '-f',
    audioPath,
    '-oj',
    '-ojf',
    '-of',
    transcriptStem,
    '-ml',
    '34',
    '-sow',
    ...createWhisperDecodeArgs(decodeOptions),
    '-l',
    language,
  ], { maxBuffer: 64 * 1024 * 1024 });
  const transcriptPath = `${transcriptStem}.json`;
  if (output.status !== 0 || !fs.existsSync(transcriptPath)) {
    blockers.push({
      code: 'SMART_SLICE_LARGE_MEDIA_WHISPER_FAILED',
      message: `Large media Whisper transcription failed: ${output.stderr || output.stdout}`,
    });
    return createEmptyTranscriptQualityGuard();
  }
  const qualityGuard = evaluateTranscriptFileQuality({
    transcriptPath,
    scope: 'whole-audio',
    chunkId: '',
    decodeOptions,
  });
  if (!qualityGuard.passed) {
    blockers.push({
      code: 'SMART_SLICE_STT_QUALITY_GUARD_FAILED',
      message: formatTranscriptQualityGuardFailure(qualityGuard, transcriptPath),
    });
  }
  return qualityGuard;
}

async function transcribeSpeechAudioChunks({
  runCommand,
  runCommandAsync,
  ffmpegPath,
  executablePath,
  modelPath,
  audioPath,
  speechSourceKind,
  fullAudioExtracted,
  chunksDir,
  chunkManifestPath,
  transcriptPath,
  language,
  chunkDurationMs,
  chunkOverlapMs,
  parallelism,
  chunkThreadCount,
  decodeOptions,
  audioDurationMs,
  blockers,
}) {
  fs.mkdirSync(chunksDir, { recursive: true });
  const chunks = createAudioChunkSpecs({
    chunksDir,
    audioDurationMs,
    chunkDurationMs,
    chunkOverlapMs,
  });

  for (const chunk of chunks) {
    if (isNonEmptyFile(chunk.audioPath)) {
      continue;
    }
    extractSpeechAudioChunk({
      runCommand,
      ffmpegPath,
      audioPath,
      speechSourceKind,
      chunk,
      blockers,
    });
    if (blockers.length > 0) {
      break;
    }
  }
  if (blockers.length === 0) {
    await transcribeAudioChunks({
      runCommandAsync,
      executablePath,
      modelPath,
      chunks,
      language,
      threadCount: String(chunkThreadCount),
      parallelism,
      decodeOptions,
      blockers,
    });
  }
  const qualityGuard = blockers.length === 0
    ? await guardTranscribedAudioChunks({
        runCommandAsync,
        executablePath,
        modelPath,
        chunks,
        language,
        threadCount: String(chunkThreadCount),
        parallelism,
        decodeOptions,
        blockers,
      })
    : createEmptyTranscriptQualityGuard();
  if (blockers.length === 0) {
    mergeChunkTranscripts({
      chunks,
      transcriptPath,
      language,
      blockers,
    });
  }

  const readyCount = chunks.filter((chunk) => isNonEmptyFile(chunk.transcriptPath)).length;
  const manifest = {
    schema: 'smart-slice.large-media-stt-chunks.v1',
    audioPath,
    speechSourcePath: path.resolve(audioPath),
    speechSourceKind,
    fullAudioExtracted,
    audioDurationMs,
    chunksDir,
    chunkDurationMs,
    chunkOverlapMs,
    parallelism,
    chunkThreadCount,
    whisperAudioContext: decodeOptions.audioContext,
    whisperBeamSize: decodeOptions.beamSize,
    whisperBestOf: decodeOptions.bestOf,
    whisperNoFallback: decodeOptions.noFallback,
    qualityGuard,
    chunkCount: chunks.length,
    readyCount,
    chunks: chunks.map((chunk) => ({
      id: chunk.id,
      index: chunk.index,
      startMs: chunk.startMs,
      endMs: chunk.endMs,
      audioPath: chunk.audioPath,
      transcriptPath: chunk.transcriptPath,
      ready: isNonEmptyFile(chunk.transcriptPath),
      transcriptAction: chunk.transcriptAction ?? (isNonEmptyFile(chunk.transcriptPath) ? 'ready' : 'missing'),
      qualityGuard: chunk.qualityGuard ?? createEmptyTranscriptQualityGuard(),
    })),
  };
  writeJsonAtomic(chunkManifestPath, manifest);
  return {
    manifestPath: chunkManifestPath,
    chunksDir,
    count: chunks.length,
    readyCount,
    chunkDurationMs,
    chunkOverlapMs,
    parallelism,
    chunkThreadCount,
    whisperAudioContext: decodeOptions.audioContext,
    whisperBeamSize: decodeOptions.beamSize,
    whisperBestOf: decodeOptions.bestOf,
    whisperNoFallback: decodeOptions.noFallback,
    qualityGuard,
  };
}

function extractSpeechAudioChunk({
  runCommand,
  ffmpegPath,
  audioPath,
  speechSourceKind,
  chunk,
  blockers,
}) {
  fs.mkdirSync(path.dirname(chunk.audioPath), { recursive: true });
  const output = runCommand(ffmpegPath, [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-ss',
    formatSeconds(chunk.startMs),
    '-t',
    formatSeconds(chunk.endMs - chunk.startMs),
    '-i',
    audioPath,
    ...(speechSourceKind === speechSourceKindSourceMediaDirect ? ['-vn'] : []),
    '-ac',
    '1',
    '-ar',
    '16000',
    '-c:a',
    'pcm_s16le',
    chunk.audioPath,
  ], { maxBuffer: 16 * 1024 * 1024 });
  if (output.status !== 0 || !isNonEmptyFile(chunk.audioPath)) {
    blockers.push({
      code: 'SMART_SLICE_LARGE_MEDIA_AUDIO_CHUNK_EXTRACT_FAILED',
      message: `Large media speech audio chunk extraction failed for ${chunk.id}: ${output.stderr || output.stdout}`,
    });
    return;
  }
  if (!isUsefulSpeechAudioChunk(chunk.audioPath)) {
    chunk.transcriptAction = 'empty-audio-skipped';
    writeEmptyWhisperTranscript(chunk.transcriptPath);
  }
}

async function transcribeAudioChunks({
  runCommandAsync,
  executablePath,
  modelPath,
  chunks,
  language,
  threadCount,
  parallelism,
  decodeOptions,
  blockers,
}) {
  const pendingChunks = chunks.filter((chunk) => !isNonEmptyFile(chunk.transcriptPath));
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < pendingChunks.length && blockers.length === 0) {
      const chunk = pendingChunks[nextIndex];
      nextIndex += 1;
      const output = await runCommandAsync(executablePath, [
        '-m',
        modelPath,
        '-t',
        threadCount,
        '-f',
        chunk.audioPath,
        '-oj',
        '-ojf',
        '-of',
        chunk.transcriptStem,
        '-ml',
        '34',
        '-sow',
        ...createWhisperDecodeArgs(decodeOptions),
        '-l',
        language,
      ], { maxBuffer: 64 * 1024 * 1024 });
      if (output.status !== 0 || !isNonEmptyFile(chunk.transcriptPath)) {
        blockers.push({
          code: 'SMART_SLICE_LARGE_MEDIA_WHISPER_FAILED',
          message: `Large media Whisper chunk transcription failed for ${chunk.id}: ${output.stderr || output.stdout}`,
        });
        return;
      }
      chunk.transcriptAction = 'generated';
    }
  }
  await Promise.all(Array.from({ length: Math.min(parallelism, pendingChunks.length) }, () => worker()));
}

async function guardTranscribedAudioChunks({
  runCommandAsync,
  executablePath,
  modelPath,
  chunks,
  language,
  threadCount,
  parallelism,
  decodeOptions,
  blockers,
}) {
  const guard = createEmptyTranscriptQualityGuard();
  const riskyChunks = [];
  for (const chunk of chunks) {
    const chunkGuard = evaluateTranscriptFileQuality({
      transcriptPath: chunk.transcriptPath,
      scope: 'chunk',
      chunkId: chunk.id,
      decodeOptions,
    });
    chunk.qualityGuard = chunkGuard;
    mergeTranscriptQualityGuard(guard, chunkGuard);
    if (!chunkGuard.passed) {
      riskyChunks.push(chunk);
    }
  }
  if (riskyChunks.length === 0) {
    guard.status = 'passed';
    return guard;
  }
  if (!shouldRetryTranscriptQualityGuardWithStableDecode(decodeOptions)) {
    guard.status = 'failed';
    blockers.push({
      code: 'SMART_SLICE_STT_QUALITY_GUARD_FAILED',
      message: formatTranscriptQualityGuardFailure(guard, riskyChunks[0]?.transcriptPath ?? ''),
    });
    return guard;
  }

  const retryDecodeOptions = createStableQualityGuardRetryDecodeOptions(decodeOptions);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < riskyChunks.length && blockers.length === 0) {
      const chunk = riskyChunks[nextIndex];
      nextIndex += 1;
      const retryStem = `${chunk.transcriptStem}.stable-retry`;
      const output = await runCommandAsync(executablePath, [
        '-m',
        modelPath,
        '-t',
        threadCount,
        '-f',
        chunk.audioPath,
        '-oj',
        '-ojf',
        '-of',
        retryStem,
        '-ml',
        '34',
        '-sow',
        ...createWhisperDecodeArgs(retryDecodeOptions),
        '-l',
        language,
      ], { maxBuffer: 64 * 1024 * 1024 });
      const retryTranscriptPath = `${retryStem}.json`;
      if (output.status !== 0 || !isNonEmptyFile(retryTranscriptPath)) {
        blockers.push({
          code: 'SMART_SLICE_LARGE_MEDIA_WHISPER_FAILED',
          message: `Large media Whisper stable retry failed for ${chunk.id}: ${output.stderr || output.stdout}`,
        });
        return;
      }
      const retryGuard = evaluateTranscriptFileQuality({
        transcriptPath: retryTranscriptPath,
        scope: 'chunk-retry',
        chunkId: chunk.id,
        decodeOptions: retryDecodeOptions,
      });
      retryGuard.retryOf = chunk.transcriptPath;
      retryGuard.retryDecode = retryDecodeOptions;
      chunk.qualityGuard = retryGuard;
      if (!retryGuard.passed) {
        blockers.push({
          code: 'SMART_SLICE_STT_QUALITY_GUARD_FAILED',
          message: formatTranscriptQualityGuardFailure(retryGuard, retryTranscriptPath),
        });
        return;
      }
      fs.copyFileSync(retryTranscriptPath, chunk.transcriptPath);
      guard.retryCount += 1;
    }
  }
  await Promise.all(Array.from({ length: Math.min(parallelism, riskyChunks.length) }, () => worker()));
  const finalGuard = createEmptyTranscriptQualityGuard();
  for (const chunk of chunks) {
    const chunkGuard = chunk.qualityGuard ?? evaluateTranscriptFileQuality({
      transcriptPath: chunk.transcriptPath,
      scope: 'chunk',
      chunkId: chunk.id,
      decodeOptions,
    });
    mergeTranscriptQualityGuard(finalGuard, chunkGuard);
  }
  finalGuard.retryCount = guard.retryCount;
  finalGuard.status = blockers.some((blocker) => blocker.code === 'SMART_SLICE_STT_QUALITY_GUARD_FAILED')
    ? 'failed'
    : finalGuard.retryCount > 0
      ? 'passed-after-retry'
      : finalGuard.status;
  return finalGuard;
}

function mergeChunkTranscripts({
  chunks,
  transcriptPath,
  language,
  blockers,
}) {
  const entries = [];
  for (const chunk of chunks) {
    if (!isNonEmptyFile(chunk.transcriptPath)) {
      blockers.push({
        code: 'SMART_SLICE_LARGE_MEDIA_TRANSCRIPT_CHUNK_MISSING',
        message: `Large media transcript chunk is missing: ${chunk.transcriptPath}`,
      });
      continue;
    }
    let transcript;
    try {
      transcript = JSON.parse(fs.readFileSync(chunk.transcriptPath, 'utf8'));
    } catch (error) {
      blockers.push({
        code: 'SMART_SLICE_LARGE_MEDIA_TRANSCRIPT_JSON_INVALID',
        message: `Large media transcript chunk JSON is invalid: ${formatErrorMessage(error)}`,
      });
      continue;
    }
    for (const entry of normalizeArray(transcript.transcription)) {
      const startMs = normalizeNonNegativeInteger(entry?.offsets?.from ?? secondsToMs(entry?.start));
      const endMs = normalizeNonNegativeInteger(entry?.offsets?.to ?? secondsToMs(entry?.end));
      const text = normalizeString(entry?.text);
      if (startMs === undefined || endMs === undefined || endMs <= startMs || !text) {
        continue;
      }
      const absoluteStartMs = chunk.startMs + startMs;
      const absoluteEndMs = Math.min(chunk.endMs, chunk.startMs + endMs);
      if (absoluteEndMs <= absoluteStartMs) {
        continue;
      }
      entries.push({
        offsets: {
          from: absoluteStartMs,
          to: absoluteEndMs,
        },
        text,
        ...(normalizeString(entry?.speaker) ? { speaker: normalizeString(entry.speaker) } : {}),
      });
    }
  }
  const mergedEntries = dedupeMergedTranscriptEntries(entries);
  if (mergedEntries.length === 0) {
    blockers.push({
      code: 'SMART_SLICE_LARGE_MEDIA_TRANSCRIPT_EMPTY',
      message: 'Large media chunked Whisper transcript has no timestamped speech segments.',
    });
    return;
  }
  writeJsonAtomic(transcriptPath, {
    result: { language },
    transcription: mergedEntries,
  });
}

function dedupeMergedTranscriptEntries(entries) {
  const sorted = entries
    .slice()
    .sort((first, second) => first.offsets.from - second.offsets.from || first.offsets.to - second.offsets.to);
  const deduped = [];
  for (const entry of sorted) {
    const previous = deduped.at(-1);
    if (
      previous &&
      previous.text === entry.text &&
      Math.abs(previous.offsets.from - entry.offsets.from) <= defaultChunkOverlapMs + 500 &&
      Math.abs(previous.offsets.to - entry.offsets.to) <= defaultChunkOverlapMs + 500
    ) {
      previous.offsets.to = Math.max(previous.offsets.to, entry.offsets.to);
      continue;
    }
    deduped.push({
      ...entry,
      offsets: { ...entry.offsets },
    });
  }
  return repairMergedTranscriptTimeline(deduped);
}

function repairMergedTranscriptTimeline(entries) {
  const repaired = [];
  for (const entry of entries) {
    const previous = repaired.at(-1);
    const startMs = Math.max(
      normalizeNonNegativeInteger(entry?.offsets?.from) ?? 0,
      previous ? previous.offsets.to : 0,
    );
    const endMs = normalizeNonNegativeInteger(entry?.offsets?.to) ?? 0;
    const text = normalizeString(entry?.text);
    if (endMs <= startMs || !text) {
      continue;
    }
    repaired.push({
      ...entry,
      offsets: {
        from: startMs,
        to: endMs,
      },
      text,
    });
  }
  return repaired;
}

function createAudioChunkSpecs({
  chunksDir,
  audioDurationMs,
  chunkDurationMs,
  chunkOverlapMs,
}) {
  const chunks = [];
  let startMs = 0;
  let index = 1;
  while (startMs < audioDurationMs) {
    const endMs = Math.min(audioDurationMs, startMs + chunkDurationMs);
    const id = `chunk-${String(index).padStart(4, '0')}`;
    const transcriptStem = path.join(chunksDir, id);
    chunks.push({
      id,
      index,
      startMs,
      endMs,
      audioPath: `${transcriptStem}.wav`,
      transcriptStem,
      transcriptPath: `${transcriptStem}.json`,
    });
    if (endMs >= audioDurationMs) {
      break;
    }
    startMs = Math.max(endMs - chunkOverlapMs, startMs + 1_000);
    index += 1;
  }
  return chunks;
}

function createEmptyChunkReportState({
  chunksDir,
  manifestPath,
  chunkDurationMs,
  chunkOverlapMs,
  parallelism,
  chunkThreadCount,
}) {
  return {
    manifestPath,
    chunksDir,
    count: 0,
    readyCount: 0,
    chunkDurationMs,
    chunkOverlapMs,
    parallelism,
    chunkThreadCount,
  };
}

function probeMediaDurationMs({
  runCommand,
  ffprobePath,
  mediaPath,
}) {
  const output = runCommand(ffprobePath, [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'json',
    mediaPath,
  ], { maxBuffer: 1024 * 1024 });
  if (output.status !== 0) {
    return 0;
  }
  try {
    const parsed = JSON.parse(output.stdout);
    return normalizePositiveInteger(secondsToMs(parsed?.format?.duration)) ?? 0;
  } catch {
    return 0;
  }
}

function formatSeconds(valueMs) {
  return (Math.max(0, valueMs) / 1_000).toFixed(3);
}

function createLargeMediaSttResumeState({
  inputIdentity,
  sourceIdentityPath,
  audioPath,
  transcriptPath,
}) {
  const sourceIdentityMatched = doesSourceIdentityMatch(sourceIdentityPath, inputIdentity);
  const transcriptReusable = sourceIdentityMatched && isNonEmptyFile(transcriptPath);
  const audioReusable = sourceIdentityMatched && isNonEmptyFile(audioPath);
  return {
    sourceIdentityMatched,
    transcriptReusable,
    audioReusable,
  };
}

function doesSourceIdentityMatch(sourceIdentityPath, inputIdentity) {
  if (!inputIdentity || !fs.existsSync(sourceIdentityPath) || !fs.statSync(sourceIdentityPath).isFile()) {
    return false;
  }
  try {
    const identity = JSON.parse(fs.readFileSync(sourceIdentityPath, 'utf8'));
    const input = identity?.input ?? {};
    return (
      path.resolve(normalizeString(input.path)) === inputIdentity.path &&
      normalizeNonNegativeInteger(input.byteSize) === inputIdentity.byteSize &&
      normalizeNonNegativeInteger(input.modifiedTimeMs) === inputIdentity.modifiedTimeMs
    );
  } catch {
    return false;
  }
}

function createSourceIdentity(inputPath) {
  if (!fs.existsSync(inputPath) || !fs.statSync(inputPath).isFile()) {
    return {
      path: path.resolve(inputPath),
      byteSize: 0,
      modifiedTimeMs: 0,
    };
  }
  const stats = fs.statSync(inputPath);
  return {
    path: path.resolve(inputPath),
    byteSize: stats.size,
    modifiedTimeMs: Math.round(stats.mtimeMs),
  };
}

function writeSourceIdentity(sourceIdentityPath, inputIdentity) {
  writeJsonAtomic(sourceIdentityPath, {
    schema: 'smart-slice.large-media-source-identity.v1',
    input: inputIdentity,
  });
}

function createTranscriptState(transcriptPath, blockers, decodeOptions = {}) {
  if (!fs.existsSync(transcriptPath) || !fs.statSync(transcriptPath).isFile()) {
    return {
      status: 'missing',
      segmentCount: 0,
      language: '',
      endMs: 0,
      segments: [],
      qualityGuard: createEmptyTranscriptQualityGuard(),
    };
  }
  try {
    const transcript = JSON.parse(fs.readFileSync(transcriptPath, 'utf8'));
    const segments = normalizeArray(transcript.transcription)
      .map((entry, index) => {
        const startMs = normalizeNonNegativeInteger(entry?.offsets?.from ?? secondsToMs(entry?.start));
        const endMs = normalizeNonNegativeInteger(entry?.offsets?.to ?? secondsToMs(entry?.end));
        const text = normalizeString(entry?.text);
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
      blockers.push({
        code: 'SMART_SLICE_LARGE_MEDIA_TRANSCRIPT_EMPTY',
        message: `Large media Whisper transcript has no timestamped speech segments: ${transcriptPath}`,
      });
      return {
        status: 'empty',
        segmentCount: 0,
        language: normalizeString(transcript.result?.language ?? transcript.language),
        endMs: 0,
        segments: [],
        qualityGuard: createEmptyTranscriptQualityGuard(),
      };
    }
    const qualityGuard = evaluateTranscriptSegmentsQuality({
      segments,
      scope: 'merged-transcript',
      chunkId: '',
      decodeOptions,
    });
    if (!qualityGuard.passed && !blockers.some((blocker) => blocker.code === 'SMART_SLICE_STT_QUALITY_GUARD_FAILED')) {
      blockers.push({
        code: 'SMART_SLICE_STT_QUALITY_GUARD_FAILED',
        message: formatTranscriptQualityGuardFailure(qualityGuard, transcriptPath),
      });
    }
    return {
      status: 'ready',
      segmentCount: segments.length,
      language: normalizeString(transcript.result?.language ?? transcript.language) || 'auto',
      endMs: Math.max(...segments.map((segment) => segment.endMs)),
      segments,
      qualityGuard,
    };
  } catch (error) {
    blockers.push({
      code: 'SMART_SLICE_LARGE_MEDIA_TRANSCRIPT_JSON_INVALID',
      message: `Large media Whisper transcript JSON is invalid: ${formatErrorMessage(error)}`,
    });
    return {
      status: 'invalid',
      segmentCount: 0,
      language: '',
      endMs: 0,
      segments: [],
      qualityGuard: createEmptyTranscriptQualityGuard(),
    };
  }
}

function createEmptyTranscriptQualityGuard() {
  return {
    schema: transcriptQualityGuardSchema,
    status: 'not-run',
    passed: true,
    retryCount: 0,
    riskCount: 0,
    risks: [],
    metrics: {
      segmentCount: 0,
      textLength: 0,
      uniqueCharacterRatio: 1,
      replacementCharacterCount: 0,
      repeatedPhraseRunCount: 0,
      duplicateWindowRatio: 0,
      tinySegmentRatio: 0,
    },
  };
}

function evaluateTranscriptFileQuality({
  transcriptPath,
  scope,
  chunkId,
  decodeOptions,
}) {
  if (!isNonEmptyFile(transcriptPath)) {
    return createFailedTranscriptQualityGuard({
      scope,
      chunkId,
      decodeOptions,
      risks: [{
        code: 'missing-transcript',
        severity: 'blocker',
        message: `Transcript file is missing or empty: ${transcriptPath}`,
      }],
    });
  }
  try {
    const transcript = JSON.parse(fs.readFileSync(transcriptPath, 'utf8'));
    const segments = normalizeArray(transcript.transcription)
      .map((entry, index) => {
        const startMs = normalizeNonNegativeInteger(entry?.offsets?.from ?? secondsToMs(entry?.start));
        const endMs = normalizeNonNegativeInteger(entry?.offsets?.to ?? secondsToMs(entry?.end));
        const text = normalizeString(entry?.text);
        if (startMs === undefined || endMs === undefined || endMs <= startMs || !text) {
          return undefined;
        }
        return {
          id: `${chunkId || 'transcript'}-${String(index + 1).padStart(4, '0')}`,
          startMs,
          endMs,
          text,
          speaker: normalizeString(entry?.speaker) || 'Speaker 1',
        };
      })
      .filter(Boolean);
    return evaluateTranscriptSegmentsQuality({
      segments,
      scope,
      chunkId,
      decodeOptions,
    });
  } catch (error) {
    return createFailedTranscriptQualityGuard({
      scope,
      chunkId,
      decodeOptions,
      risks: [{
        code: 'invalid-json',
        severity: 'blocker',
        message: `Transcript JSON is invalid: ${formatErrorMessage(error)}`,
      }],
    });
  }
}

function evaluateTranscriptSegmentsQuality({
  segments,
  scope,
  chunkId,
  decodeOptions,
}) {
  const guard = createEmptyTranscriptQualityGuard();
  guard.status = 'passed';
  guard.scope = scope;
  guard.chunkId = chunkId || '';
  guard.decode = {
    audioContext: decodeOptions?.audioContext,
    beamSize: decodeOptions?.beamSize,
    bestOf: decodeOptions?.bestOf,
    noFallback: decodeOptions?.noFallback === true,
  };

  const normalizedSegments = normalizeArray(segments).filter((segment) => normalizeString(segment?.text));
  const text = normalizedSegments.map((segment) => normalizeString(segment.text)).join(' ');
  const compactText = text.replace(/\s+/gu, '');
  const uniqueCharacters = new Set(Array.from(compactText));
  const replacementCharacterCount = Array.from(text).filter((character) => character === '\uFFFD').length;
  const repeatedPhraseRuns = detectRepeatedPhraseRuns(compactText);
  const duplicateWindowRatio = calculateDuplicateWindowRatio(compactText);
  const tinySegmentCount = normalizedSegments.filter((segment) =>
    normalizePositiveInteger(segment.endMs - segment.startMs) !== undefined &&
    segment.endMs - segment.startMs <= 700 &&
    Array.from(normalizeString(segment.text)).length <= 4
  ).length;
  guard.metrics = {
    segmentCount: normalizedSegments.length,
    textLength: Array.from(compactText).length,
    uniqueCharacterRatio: compactText.length > 0 ? uniqueCharacters.size / Array.from(compactText).length : 1,
    replacementCharacterCount,
    repeatedPhraseRunCount: repeatedPhraseRuns.length,
    duplicateWindowRatio,
    tinySegmentRatio: normalizedSegments.length > 0 ? tinySegmentCount / normalizedSegments.length : 0,
  };

  if (normalizedSegments.length === 0 && (scope === 'chunk' || scope === 'chunk-retry')) {
    guard.status = 'passed-empty';
    guard.passed = true;
    return guard;
  }
  if (normalizedSegments.length === 0) {
    guard.risks.push({
      code: 'empty-transcript',
      severity: 'blocker',
      message: 'Transcript contains no usable timestamped speech segments.',
    });
  }
  if (replacementCharacterCount > 0) {
    guard.risks.push({
      code: 'replacement-character',
      severity: 'blocker',
      message: 'Transcript contains Unicode replacement characters, usually from corrupt Whisper JSON text.',
      count: replacementCharacterCount,
    });
  }
  if (repeatedPhraseRuns.length > 0) {
    guard.risks.push({
      code: 'repeated-phrase-loop',
      severity: 'blocker',
      message: 'Transcript contains adjacent repeated phrase loops that are typical of hallucinated fast decode.',
      examples: repeatedPhraseRuns.slice(0, 3),
    });
  }
  if (guard.metrics.textLength >= 24 && guard.metrics.uniqueCharacterRatio < 0.16) {
    guard.risks.push({
      code: 'low-unique-character-ratio',
      severity: 'blocker',
      message: 'Transcript has extremely low character variety for its length.',
      ratio: Number(guard.metrics.uniqueCharacterRatio.toFixed(4)),
    });
  }
  if (guard.metrics.textLength >= 48 && duplicateWindowRatio >= 0.42) {
    guard.risks.push({
      code: 'duplicate-window-ratio',
      severity: 'blocker',
      message: 'Transcript has too many repeated text windows.',
      ratio: Number(duplicateWindowRatio.toFixed(4)),
    });
  }
  if (normalizedSegments.length >= 8 && guard.metrics.tinySegmentRatio > 0.7) {
    guard.risks.push({
      code: 'tiny-segment-spam',
      severity: 'blocker',
      message: 'Transcript has too many tiny low-information segments.',
      ratio: Number(guard.metrics.tinySegmentRatio.toFixed(4)),
    });
  }
  guard.riskCount = guard.risks.length;
  guard.passed = guard.riskCount === 0;
  guard.status = guard.passed ? 'passed' : 'failed';
  return guard;
}

function createFailedTranscriptQualityGuard({
  scope,
  chunkId,
  decodeOptions,
  risks,
}) {
  const guard = createEmptyTranscriptQualityGuard();
  guard.status = 'failed';
  guard.passed = false;
  guard.scope = scope;
  guard.chunkId = chunkId || '';
  guard.decode = {
    audioContext: decodeOptions?.audioContext,
    beamSize: decodeOptions?.beamSize,
    bestOf: decodeOptions?.bestOf,
    noFallback: decodeOptions?.noFallback === true,
  };
  guard.risks = risks;
  guard.riskCount = risks.length;
  return guard;
}

function mergeTranscriptQualityGuard(target, source) {
  target.risks.push(...normalizeArray(source?.risks).map((risk) => ({
    ...risk,
    chunkId: source?.chunkId || risk.chunkId || '',
  })));
  target.riskCount = target.risks.length;
  target.passed = target.riskCount === 0;
  target.status = target.passed ? 'passed' : 'failed';
  target.metrics.segmentCount += normalizeNonNegativeInteger(source?.metrics?.segmentCount) ?? 0;
  target.metrics.textLength += normalizeNonNegativeInteger(source?.metrics?.textLength) ?? 0;
  target.metrics.replacementCharacterCount += normalizeNonNegativeInteger(source?.metrics?.replacementCharacterCount) ?? 0;
  target.metrics.repeatedPhraseRunCount += normalizeNonNegativeInteger(source?.metrics?.repeatedPhraseRunCount) ?? 0;
  target.metrics.duplicateWindowRatio = Math.max(
    target.metrics.duplicateWindowRatio,
    Number(source?.metrics?.duplicateWindowRatio) || 0,
  );
  target.metrics.tinySegmentRatio = Math.max(
    target.metrics.tinySegmentRatio,
    Number(source?.metrics?.tinySegmentRatio) || 0,
  );
  target.metrics.uniqueCharacterRatio = Math.min(
    target.metrics.uniqueCharacterRatio,
    Number(source?.metrics?.uniqueCharacterRatio) || 1,
  );
}

function shouldRetryTranscriptQualityGuardWithStableDecode(decodeOptions = {}) {
  return decodeOptions.audioContext !== undefined;
}

function createStableQualityGuardRetryDecodeOptions(decodeOptions = {}) {
  return {
    beamSize: decodeOptions.beamSize ?? 1,
    bestOf: decodeOptions.bestOf ?? 1,
    noFallback: decodeOptions.noFallback === true,
  };
}

function formatTranscriptQualityGuardFailure(guard, transcriptPath) {
  const codes = normalizeArray(guard?.risks).map((risk) => risk.code).join(',');
  return [
    `STT quality guard failed${transcriptPath ? ` for ${transcriptPath}` : ''}.`,
    `scope=${guard?.scope ?? ''}`,
    `chunk=${guard?.chunkId ?? ''}`,
    `risks=${codes || 'unknown'}`,
  ].filter(Boolean).join(' ');
}

function detectRepeatedPhraseRuns(text) {
  const characters = Array.from(normalizeString(text));
  const runs = [];
  if (characters.length < 12) {
    return runs;
  }
  for (let phraseLength = 2; phraseLength <= Math.min(18, Math.floor(characters.length / 3)); phraseLength += 1) {
    let index = 0;
    while (index + phraseLength * 3 <= characters.length) {
      const phrase = characters.slice(index, index + phraseLength).join('');
      if (!phrase || isLowSignalPhrase(phrase)) {
        index += 1;
        continue;
      }
      let count = 1;
      while (
        index + phraseLength * (count + 1) <= characters.length &&
        characters.slice(index + phraseLength * count, index + phraseLength * (count + 1)).join('') === phrase
      ) {
        count += 1;
      }
      if (count >= 3) {
        runs.push({
          phrase,
          count,
          startChar: index,
        });
        index += phraseLength * count;
      } else {
        index += 1;
      }
    }
  }
  return dedupeRepeatedPhraseRuns(runs);
}

function dedupeRepeatedPhraseRuns(runs) {
  const deduped = [];
  for (const run of runs.sort((first, second) =>
    first.startChar - second.startChar || second.phrase.length - first.phrase.length
  )) {
    const overlapsExisting = deduped.some((existing) =>
      run.startChar >= existing.startChar &&
      run.startChar < existing.startChar + existing.phrase.length * existing.count
    );
    if (!overlapsExisting) {
      deduped.push(run);
    }
  }
  return deduped;
}

function calculateDuplicateWindowRatio(text) {
  const characters = Array.from(normalizeString(text));
  if (characters.length < 48) {
    return 0;
  }
  const windowSize = 8;
  const windows = new Map();
  let total = 0;
  for (let index = 0; index + windowSize <= characters.length; index += 1) {
    const window = characters.slice(index, index + windowSize).join('');
    if (isLowSignalPhrase(window)) {
      continue;
    }
    windows.set(window, (windows.get(window) ?? 0) + 1);
    total += 1;
  }
  if (total === 0) {
    return 0;
  }
  const duplicateCount = Array.from(windows.values()).reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  return duplicateCount / total;
}

function isLowSignalPhrase(value) {
  const text = normalizeString(value);
  if (!text) {
    return true;
  }
  return /^[\p{P}\p{S}\s]+$/u.test(text);
}

function validateInputFile(filePath, code, message, blockers) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    blockers.push({
      code,
      message: `${message}: ${filePath}`,
    });
  }
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
  if (!isNonEmptyFile(filePath)) {
    return 0;
  }
  return fs.statSync(filePath).size;
}

function isNonEmptyFile(filePath) {
  return Boolean(filePath) && fs.existsSync(filePath) && fs.statSync(filePath).isFile() && fs.statSync(filePath).size > 0;
}

function isUsefulSpeechAudioChunk(filePath) {
  if (!isNonEmptyFile(filePath)) {
    return false;
  }
  return fs.statSync(filePath).size >= minimumUsefulPcmWavBytes;
}

function writeEmptyWhisperTranscript(transcriptPath) {
  writeJsonAtomic(transcriptPath, {
    result: {
      language: 'auto',
      source: 'autocut-empty-audio-chunk',
    },
    transcription: [],
  });
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

function normalizePositiveInteger(value) {
  const normalized = normalizeNonNegativeInteger(value);
  return normalized !== undefined && normalized > 0 ? normalized : undefined;
}

function normalizeBoundedPositiveInteger(value, minValue, maxValue) {
  const normalized = normalizePositiveInteger(value);
  if (normalized === undefined) {
    return undefined;
  }
  return normalized >= minValue && normalized <= maxValue ? normalized : undefined;
}

function createWhisperDecodeOptions(options = {}) {
  return {
    audioContext: normalizeBoundedPositiveInteger(options.whisperAudioContext ?? options.audioContext, 1, 1_500),
    beamSize: normalizeBoundedPositiveInteger(options.whisperBeamSize ?? options.beamSize, 1, 8),
    bestOf: normalizeBoundedPositiveInteger(options.whisperBestOf ?? options.bestOf, 1, 8),
    noFallback: options.whisperNoFallback === true || options.noFallback === true,
  };
}

function createWhisperDecodeArgs(decodeOptions = {}) {
  const args = [];
  if (decodeOptions.audioContext !== undefined) {
    args.push('-ac', String(decodeOptions.audioContext));
  }
  if (decodeOptions.beamSize !== undefined) {
    args.push('-bs', String(decodeOptions.beamSize));
  }
  if (decodeOptions.bestOf !== undefined) {
    args.push('-bo', String(decodeOptions.bestOf));
  }
  if (decodeOptions.noFallback === true) {
    args.push('-nf');
  }
  return args;
}

function secondsToMs(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 1_000) : undefined;
}

function osThreadCount() {
  return Number(process.env.SDKWORK_AUTOCUT_WHISPER_THREADS) || 8;
}

function formatErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function runAutoCutLargeMediaSttCommand(command, args, { maxBuffer = 64 * 1024 * 1024 } = {}) {
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

export function runAutoCutLargeMediaSttCommandAsync(command, args, { maxBuffer = 64 * 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    child.stdout?.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes <= maxBuffer) {
        stdoutChunks.push(chunk);
      }
    });
    child.stderr?.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= maxBuffer) {
        stderrChunks.push(chunk);
      }
    });
    child.on('error', (error) => {
      resolve({
        status: 1,
        stdout: '',
        stderr: error.message,
      });
    });
    child.on('close', (status) => {
      resolve({
        status: status ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      });
    });
  });
}

function parseArgs(argv) {
  const args = normalizeAutoCutCliArgs(argv);
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--input') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut large media STT baseline',
      });
      options.inputPath = option.value;
      index = option.nextIndex;
    } else if (arg === '--output') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut large media STT baseline',
      });
      options.outputDir = option.value;
      index = option.nextIndex;
    } else if (arg === '--ffmpeg') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut large media STT baseline',
      });
      options.ffmpegPath = option.value;
      index = option.nextIndex;
    } else if (arg === '--whisper') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut large media STT baseline',
      });
      options.executablePath = option.value;
      index = option.nextIndex;
    } else if (arg === '--model') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut large media STT baseline',
      });
      options.modelPath = option.value;
      index = option.nextIndex;
    } else if (arg === '--language') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut large media STT baseline',
      });
      options.language = option.value;
      index = option.nextIndex;
    } else if (arg === '--chunk-duration-ms') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut large media STT baseline',
      });
      options.chunkDurationMs = Number(option.value);
      index = option.nextIndex;
    } else if (arg === '--chunk-overlap-ms') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut large media STT baseline',
      });
      options.chunkOverlapMs = Number(option.value);
      index = option.nextIndex;
    } else if (arg === '--parallelism') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut large media STT baseline',
      });
      options.parallelism = Number(option.value);
      index = option.nextIndex;
    } else if (arg === '--chunk-thread-count') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut large media STT baseline',
      });
      options.chunkThreadCount = Number(option.value);
      index = option.nextIndex;
    } else if (arg === '--whisper-audio-context' || arg === '--audio-context') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut large media STT baseline',
      });
      options.whisperAudioContext = Number(option.value);
      index = option.nextIndex;
    } else if (arg === '--whisper-beam-size' || arg === '--beam-size') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut large media STT baseline',
      });
      options.whisperBeamSize = Number(option.value);
      index = option.nextIndex;
    } else if (arg === '--whisper-best-of' || arg === '--best-of') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut large media STT baseline',
      });
      options.whisperBestOf = Number(option.value);
      index = option.nextIndex;
    } else if (arg === '--whisper-no-fallback' || arg === '--no-fallback') {
      options.whisperNoFallback = true;
    } else if (arg === '--audio-duration-ms') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut large media STT baseline',
      });
      options.audioDurationMs = Number(option.value);
      index = option.nextIndex;
    } else if (arg === '--force-chunked') {
      options.forceChunked = true;
    } else if (arg === '--source-direct') {
      options.sourceDirect = true;
    } else {
      throw new Error(`unknown AutoCut large media STT baseline option: ${arg}`);
    }
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  try {
    const report = await runAutoCutLargeMediaSttBaseline(parseArgs(process.argv.slice(2)));
    console.log(formatAutoCutLargeMediaSttBaselineMessage(report));
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
