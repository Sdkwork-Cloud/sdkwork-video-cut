#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  createSmartSliceAudioActivitySourceSegments,
  createSmartSliceSpeechSourceSegments,
  getEligibleSmartSliceTranscriptCoverageSegments,
  normalizeSmartSliceTranscriptEvidenceText,
  refineSmartSlicePlanWithAudioActivityBoundaries,
  SMART_SLICE_RAW_AUDIO_ACTIVITY_ANALYSIS_FILTER,
} from '../packages/sdkwork-autocut-slicer/src/service/slicePlanner.ts';
import {
  createSmartCutEngineSlicePlan,
} from '../packages/sdkwork-autocut-slicer/src/service/smartCutEnginePlanner.ts';
import {
  normalizeAutoCutCliArgs,
  readAutoCutCliOptionValue,
} from './autocut-cli-args.mjs';
import {
  createAutoCutSmartSliceExecutionEvidenceValidationReport,
} from './check-autocut-smart-slice-execution-evidence.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const schemaVersion = '2026-05-11.autocut-wenan5-real-media-slice.v1';
const defaultTranscriptPath = path.join(repoRoot, 'artifacts/autocut-diagnostics/wenan5/speech-transcript.json');
const defaultOutputDir = path.join(repoRoot, 'artifacts/autocut-diagnostics/wenan5/slices-real-media-current');
const minExpectedClipCount = 3;
const maxDurationDeltaMs = 750;
const maxLongOutputSilenceMs = 800;
const maxSilenceBridgeGapMs = 120;
const ffmpegLongSilenceDetectFilter = 'silencedetect=noise=-35dB:d=0.8';
const audioActivityConfidence = 0.86;
const srtTimingToleranceMs = 80;
const minTrustedAudioCompactedRetainedRatio = 0.35;
const minTrustedAudioCompactedRetainedMs = 1_000;
const minTrustedAudioCompactedShortUtteranceMs = 650;
const minTrustedAudioCompactedAbsoluteRetainedRatio = 0.2;
const maxTrustedAudioCompactedAbsoluteRetainedMs = 3_000;
const defaultSmartSliceProfile = 'desktop-duration';
const smartSliceProfiles = {
  'desktop-duration': {
    mode: 'contract-mode',
    llmModel: 'deepseek-v4-flash',
    minDuration: 30,
    maxDuration: 70,
    idealDuration: 45,
    targetPlatform: 'douyin',
    targetAspectRatio: '9:16',
    videoObjectFit: 'contain',
    continuityLevel: 'standard',
    baseAlgorithm: 'nlp',
    highlightEngine: 'emotion',
    enableNoiseReduction: true,
    enableCoughFilter: true,
    enableRepeatFilter: true,
    enableSubtitles: true,
    subtitleMode: 'both',
  },
  'desktop-default': {
    mode: 'contract-mode',
    llmModel: 'deepseek-v4-flash',
    minDuration: 15,
    maxDuration: 90,
    idealDuration: 45,
    targetPlatform: 'douyin',
    targetAspectRatio: '9:16',
    videoObjectFit: 'cover',
    continuityLevel: 'standard',
    baseAlgorithm: 'nlp',
    highlightEngine: 'emotion',
    enableNoiseReduction: false,
    enableCoughFilter: true,
    enableRepeatFilter: false,
    enableSubtitles: false,
  },
};

export async function createAutoCutWenan5RealMediaSlicePlan({
  inputPath,
  transcriptPath = defaultTranscriptPath,
  outputDir = defaultOutputDir,
  ffmpegPath = process.env.SDKWORK_AUTOCUT_FFMPEG_EXECUTABLE ?? process.env.SDKWORK_AUTOCUT_FFMPEG ?? 'ffmpeg',
  ffprobePath = process.env.SDKWORK_AUTOCUT_FFPROBE_EXECUTABLE ?? process.env.SDKWORK_AUTOCUT_FFPROBE ?? 'ffprobe',
  profile = defaultSmartSliceProfile,
  generatedAt = new Date().toISOString(),
  runCommand = runAutoCutWenan5MediaCommand,
} = {}) {
  const rawInputPath = inputPath ?? process.env.SDKWORK_AUTOCUT_WENAN5_VIDEO;
  if (!rawInputPath?.trim()) {
    throw new Error('missing --input path for the real wenan5 source video');
  }

  const resolvedInputPath = path.resolve(rawInputPath);
  const resolvedTranscriptPath = path.resolve(transcriptPath);
  const resolvedOutputDir = path.resolve(outputDir);
  const sourceDurationMs = readMediaDurationMs(runCommand, ffprobePath, resolvedInputPath);
  const sourceHasAudioStream = probeMediaHasStream(runCommand, ffprobePath, resolvedInputPath, 'a:0');
  const transcriptSegments = readWhisperCppTranscriptSegments(resolvedTranscriptPath);
  const params = createWenan5PlannerParams(sourceDurationMs, profile);
  const enginePlan = await createSmartCutEngineSlicePlan({
    params,
    transcriptSegments,
    sourceAssetUuid: 'wenan5-real-media-smart-cut-engine',
    sourceDurationMs,
  });
  const plannedClips = enginePlan.clips;
  assertRenderableWenan5Plan(plannedClips, { requireTranscriptText: false });
  assertPlanCoversEveryEligibleTranscriptSegment(
    plannedClips,
    transcriptSegments,
    'planned wenan5 clips',
  );

  return {
    schemaVersion,
    generatedAt,
    inputPath: resolvedInputPath,
    transcriptPath: resolvedTranscriptPath,
    outputDir: resolvedOutputDir,
    ffmpegPath,
    ffprobePath,
    profile,
    runCommand,
    sourceDurationMs,
    sourceHasAudioStream,
    transcriptSegments,
    params,
    enginePlan,
    plannedClips,
  };
}

export async function runAutoCutWenan5RealMediaSliceCheck(options = {}) {
  const plan = await createAutoCutWenan5RealMediaSlicePlan(options);
  fs.mkdirSync(plan.outputDir, { recursive: true });

  const sourceVideoProbe = probeVideoStream(plan.runCommand, plan.ffprobePath, plan.inputPath);
  const audioAnalyses = plan.plannedClips.map((clip, index) =>
    analyzeClipAudioActivity(plan.runCommand, plan.ffmpegPath, plan.inputPath, clip, index)
  );
  const refinedClips = refineSmartSlicePlanWithAudioActivityBoundaries(
    plan.plannedClips,
    audioAnalyses,
    { noiseReductionApplied: false },
  );
  const compactedClips = refinedClips.map((clip, index) =>
    createCompactedClip(clip, audioAnalyses[index], plan.transcriptSegments)
  );

  assertRenderableWenan5Plan(compactedClips, {
    requireTranscriptCoverage: false,
    requireTranscriptText: false,
  });
  assertPlanCoversEveryEligibleTranscriptSegment(
    compactedClips,
    plan.transcriptSegments,
    'compacted wenan5 clips',
  );
  const renderedClips = compactedClips.map((clip, index) => renderAndVerifyClip(plan, clip, index));
  const report = createVerificationReport(plan, sourceVideoProbe, renderedClips);
  const planPath = path.join(plan.outputDir, 'plan.json');
  const verificationPath = path.join(plan.outputDir, 'verification.json');
  writeJson(planPath, {
    schemaVersion,
    generatedAt: plan.generatedAt,
    input: plan.inputPath,
    transcript: plan.transcriptPath,
    profile: plan.profile,
    sourceDurationMs: plan.sourceDurationMs,
    params: plan.params,
    plannedClipCount: plan.plannedClips.length,
    planningEngine: 'smart-cut-engine',
    presetId: plan.enginePlan.presetId,
    renderedClipCount: compactedClips.length,
    plannedClips: compactedClips.map((clip, index) =>
      createClipPlanSnapshot(clip, renderedClips[index])
    ),
  });
  writeJson(verificationPath, report);
  const evidencePackage = writeSmartSliceExecutionEvidencePackage(plan, compactedClips, renderedClips);
  const executionEvidenceReport = createAutoCutSmartSliceExecutionEvidenceValidationReport({
    taskDir: plan.outputDir,
    generatedAt: plan.generatedAt,
  });
  if (!report.ready) {
    throw new Error(`wenan5 real media Smart Slice check failed: ${report.blockers.join('; ')}`);
  }
  if (!executionEvidenceReport.ready) {
    throw new Error(
      `wenan5 Smart Slice execution evidence failed: ${executionEvidenceReport.blockers.map((blocker) => blocker.code).join('; ')}`,
    );
  }

  return {
    ready: true,
    outputDir: plan.outputDir,
    planPath,
    verificationPath,
    evidencePackage,
    executionEvidenceReport,
    report,
  };
}

export function formatAutoCutWenan5RealMediaSliceCheckMessage(result) {
  const clips = result.report.clips.map((clip) =>
    `#${clip.index + 1} ${clip.outputDurationMs}ms delta=${clip.durationDeltaMs}ms silence=${clip.longSilenceCount}`,
  ).join(' | ');
  return [
    'ok - wenan5 real media Smart Slice',
    `clips=${result.report.renderedClipCount}`,
    `output=${result.outputDir}`,
    clips,
  ].join(' ');
}

function createWenan5PlannerParams(sourceDurationMs, profile) {
  const profileParams = smartSliceProfiles[profile];
  if (!profileParams) {
    throw new Error(
      `unknown wenan5 Smart Slice profile: ${profile}. Supported profiles: ${Object.keys(smartSliceProfiles).join(', ')}`,
    );
  }

  return {
    ...profileParams,
    sourceDurationMs,
  };
}

function readWhisperCppTranscriptSegments(transcriptPath) {
  if (!fs.existsSync(transcriptPath) || !fs.statSync(transcriptPath).isFile()) {
    throw new Error(`missing real wenan5 transcript evidence: ${transcriptPath}`);
  }
  const transcript = JSON.parse(fs.readFileSync(transcriptPath, 'utf8'));
  const entries = Array.isArray(transcript.transcription) ? transcript.transcription : [];
  const segments = entries
    .map((entry) => {
      const startMs = Number(entry?.offsets?.from);
      const endMs = Number(entry?.offsets?.to);
      const text = typeof entry?.text === 'string' ? entry.text.trim() : '';
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs || !text) {
        return undefined;
      }
      return {
        startMs: Math.round(startMs),
        endMs: Math.round(endMs),
        text,
        speaker: 'Speaker 1',
      };
    })
    .filter(Boolean);
  if (segments.length === 0) {
    throw new Error(`real wenan5 transcript evidence contains no timestamped speech segments: ${transcriptPath}`);
  }
  return segments;
}

function createSliceTranscriptSegments(clip, transcriptSegments) {
  const sourceStartMs = Number.isFinite(clip.sourceStartMs) ? Math.round(clip.sourceStartMs) : Math.round(clip.startMs);
  const sourceEndMs = Number.isFinite(clip.sourceEndMs)
    ? Math.round(clip.sourceEndMs)
    : Math.round(clip.startMs + clip.durationMs);
  if (!Number.isFinite(sourceStartMs) || !Number.isFinite(sourceEndMs) || sourceEndMs <= sourceStartMs) {
    return [];
  }

  const speechStartMs = Number.isFinite(clip.speechStartMs)
    ? Math.max(sourceStartMs, Math.min(Math.round(clip.speechStartMs), sourceEndMs))
    : sourceStartMs;
  const speechEndMs = Number.isFinite(clip.speechEndMs)
    ? Math.max(speechStartMs, Math.min(Math.round(clip.speechEndMs), sourceEndMs))
    : sourceEndMs;
  if (speechEndMs <= speechStartMs) {
    return [];
  }

  return transcriptSegments
    .filter((segment) =>
      segment.endMs > speechStartMs &&
        segment.startMs < speechEndMs &&
        normalizeSmartSliceTranscriptEvidenceText(segment.text).length > 0
    )
    .map((segment) => ({
      startMs: Math.max(speechStartMs, Math.round(segment.startMs)),
      endMs: Math.min(speechEndMs, Math.round(segment.endMs)),
      text: normalizeSmartSliceTranscriptEvidenceText(segment.text),
      ...(segment.speaker?.trim() ? { speaker: segment.speaker.trim() } : {}),
    }))
    .filter((segment) => segment.endMs > segment.startMs && segment.text.length > 0)
    .sort((firstSegment, secondSegment) =>
      firstSegment.startMs - secondSegment.startMs ||
        firstSegment.endMs - secondSegment.endMs
    );
}

function createBoundaryTranscriptSegments(clip, transcriptSegments) {
  const sourceStartMs = Number.isFinite(clip.sourceStartMs) ? Math.round(clip.sourceStartMs) : Math.round(clip.startMs);
  const sourceEndMs = Number.isFinite(clip.sourceEndMs)
    ? Math.round(clip.sourceEndMs)
    : Math.round(clip.startMs + clip.durationMs);
  if (!Number.isFinite(sourceStartMs) || !Number.isFinite(sourceEndMs) || sourceEndMs <= sourceStartMs) {
    return [];
  }

  const speechStartMs = Number.isFinite(clip.speechStartMs) ? Math.round(clip.speechStartMs) : sourceStartMs;
  const speechEndMs = Number.isFinite(clip.speechEndMs) ? Math.round(clip.speechEndMs) : sourceEndMs;
  if (speechEndMs <= speechStartMs) {
    return [];
  }

  return transcriptSegments
    .filter((segment) => {
      const text = normalizeSmartSliceTranscriptEvidenceText(segment.text);
      if (!text || segment.endMs <= speechStartMs || segment.startMs >= speechEndMs) {
        return false;
      }
      const fullyInsideSource = segment.startMs >= sourceStartMs && segment.endMs <= sourceEndMs;
      const sourceCutsThroughSegment =
        (segment.startMs < sourceStartMs && segment.endMs > sourceStartMs) ||
        (segment.startMs < sourceEndMs && segment.endMs > sourceEndMs);
      return fullyInsideSource || sourceCutsThroughSegment;
    })
    .map((segment) => ({
      startMs: Math.max(0, Math.round(segment.startMs)),
      endMs: Math.max(0, Math.round(segment.endMs)),
      text: normalizeSmartSliceTranscriptEvidenceText(segment.text),
      ...(segment.speaker?.trim() ? { speaker: segment.speaker.trim() } : {}),
    }))
    .filter((segment) => segment.endMs > segment.startMs && segment.text.length > 0)
    .sort((firstSegment, secondSegment) =>
      firstSegment.startMs - secondSegment.startMs ||
        firstSegment.endMs - secondSegment.endMs
    );
}

function createSliceTranscriptText(transcriptSegments) {
  return transcriptSegments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function attachSliceTranscriptEvidence(clip, transcriptSegments) {
  const clipTranscriptSegments = createSliceTranscriptSegments(clip, transcriptSegments);
  if (clipTranscriptSegments.length === 0) {
    const {
      transcriptText: _transcriptText,
      transcriptSegments: _transcriptSegments,
      transcriptSegmentTexts: _transcriptSegmentTexts,
      transcriptSegmentCount: _transcriptSegmentCount,
      ...rest
    } = clip;
    return rest;
  }

  return {
    ...clip,
    transcriptText: createSliceTranscriptText(clipTranscriptSegments),
    transcriptSegments: clipTranscriptSegments,
    transcriptSegmentTexts: clipTranscriptSegments.map((segment) => segment.text),
    transcriptSegmentCount: clipTranscriptSegments.length,
  };
}

function assertRenderableWenan5Plan(
  clips,
  {
    requireTranscriptCoverage = true,
    requireTranscriptText = true,
    maxRenderableDurationMs = smartSliceProfiles[defaultSmartSliceProfile].maxDuration * 1_000,
  } = {},
) {
  if (clips.length < minExpectedClipCount) {
    throw new Error(`wenan5 Smart Slice must render at least ${minExpectedClipCount} clips, got ${clips.length}`);
  }
  clips.forEach((clip, index) => {
    const endMs = clip.startMs + clip.durationMs;
    if (!Number.isFinite(clip.startMs) || !Number.isFinite(clip.durationMs) || clip.durationMs <= 0) {
      throw new Error(`wenan5 clip ${index + 1} has invalid timing`);
    }
    if (index > 0) {
      const previousClip = clips[index - 1];
      const previousEndMs = previousClip.startMs + previousClip.durationMs;
      if (clip.startMs < previousEndMs) {
        throw new Error(`wenan5 clip ${index + 1} overlaps previous clip`);
      }
    }
    if (clip.durationMs < 1_000 || clip.durationMs > maxRenderableDurationMs) {
      throw new Error(`wenan5 clip ${index + 1} duration is outside renderable bounds: ${clip.durationMs}`);
    }
    if (
      requireTranscriptCoverage &&
      ((clip.transcriptSegmentCount ?? 0) <= 0 || (requireTranscriptText && !clip.transcriptText?.trim()))
    ) {
      throw new Error(`wenan5 clip ${index + 1} lacks transcript coverage evidence`);
    }
    if ((clip.speechEndMs ?? endMs) > 164_860) {
      throw new Error(`wenan5 clip ${index + 1} leaks into the NG tail`);
    }
  });
}

function assertPlanCoversEveryEligibleTranscriptSegment(clips, transcriptSegments, label) {
  const missingSegments = getEligibleSmartSliceTranscriptCoverageSegments(transcriptSegments)
    .filter((segment) => !doesPlanFullyCoverTranscriptSegment(clips, segment));
  if (missingSegments.length > 0) {
    const sample = missingSegments.slice(0, 6)
      .map((segment) => `${segment.startMs}-${segment.endMs}:${segment.text}`)
      .join('; ');
    throw new Error(`${label} must cover every eligible STT segment before rendering: missing=${missingSegments.length} ${sample}`);
  }
}

function doesPlanFullyCoverTranscriptSegment(clips, segment) {
  const segmentStartMs = Math.round(segment.startMs);
  const segmentEndMs = Math.round(segment.endMs);
  const ranges = clips
    .flatMap((clip) => getClipCoverageRanges(clip))
    .map((range) => ({
      startMs: Math.max(segmentStartMs, range.startMs),
      endMs: Math.min(segmentEndMs, range.endMs),
    }))
    .filter((range) => range.endMs > range.startMs)
    .sort((firstRange, secondRange) =>
      firstRange.startMs - secondRange.startMs ||
        firstRange.endMs - secondRange.endMs,
    );

  let coveredUntilMs = segmentStartMs;
  for (const range of ranges) {
    if (range.endMs <= coveredUntilMs) {
      continue;
    }
    if (range.startMs > coveredUntilMs + 80) {
      return clips.some((clip) => doesTrustedAudioCompactedClipCoverTranscriptSegment(clip, segment));
    }

    coveredUntilMs = Math.max(coveredUntilMs, range.endMs);
    if (coveredUntilMs >= segmentEndMs - 80) {
      return true;
    }
  }

  return coveredUntilMs >= segmentEndMs - 80 ||
    clips.some((clip) => doesTrustedAudioCompactedClipCoverTranscriptSegment(clip, segment));
}

function getClipCoverageRanges(clip) {
  if (Array.isArray(clip.sourceSegments) && clip.sourceSegments.length > 0) {
    return clip.sourceSegments
      .map((segment) => ({
        startMs: Math.max(0, Math.round(segment.startMs)),
        endMs: Math.max(0, Math.round(segment.endMs)),
      }))
      .filter((segment) => segment.endMs > segment.startMs);
  }

  const startMs = Number.isFinite(clip.sourceStartMs)
    ? Math.max(0, Math.round(clip.sourceStartMs))
    : Math.max(0, Math.round(clip.startMs));
  const endMs = Number.isFinite(clip.sourceEndMs)
    ? Math.max(0, Math.round(clip.sourceEndMs))
    : Math.max(0, Math.round(clip.startMs + clip.durationMs));

  return endMs > startMs ? [{ startMs, endMs }] : [];
}

function analyzeClipAudioActivity(runCommand, ffmpegPath, inputPath, clip, index) {
  const durationMs = Math.max(0, Math.round(clip.durationMs));
  const output = runCommand(ffmpegPath, [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-ss',
    secondsArgFromMillis(clip.startMs),
    '-i',
    inputPath,
    '-t',
    secondsArgFromMillis(durationMs),
    '-vn',
    '-map',
    '0:a:0',
    '-af',
    SMART_SLICE_RAW_AUDIO_ACTIVITY_ANALYSIS_FILTER,
    '-f',
    'null',
    '-',
  ]);
  if (output.status !== 0) {
    throw new Error(`wenan5 audio activity analysis failed for clip ${index + 1}: ${output.stderr || output.stdout}`);
  }

  const intervals = parseSilencedetectIntervals(output.stderr, durationMs);
  const leadingSilenceMs = intervals.find((interval) => interval.startMs <= 80)?.endMs;
  const trailingSilenceMs = intervals
    .slice()
    .reverse()
    .find((interval) => interval.endMs >= durationMs - 80)
    ?.startMs;
  const activityStartOffsetMs = Math.max(0, Math.min(durationMs, leadingSilenceMs ?? 0));
  const activityEndOffsetMs = Math.max(
    activityStartOffsetMs,
    Math.min(durationMs, trailingSilenceMs === undefined ? durationMs : trailingSilenceMs),
  );
  if (activityEndOffsetMs <= activityStartOffsetMs) {
    throw new Error(`wenan5 clip ${index + 1} has no high-confidence audio activity`);
  }
  const internalSilenceIntervals = intervals
    .filter((interval) =>
      interval.startMs > 80 &&
        interval.endMs < durationMs - 80 &&
        interval.endMs > interval.startMs
    )
    .map((interval) => ({
      startMs: clip.startMs + interval.startMs,
      endMs: clip.startMs + interval.endMs,
    }));

  return {
    index,
    startMs: clip.startMs,
    durationMs,
    sourceStartMs: clip.sourceStartMs ?? clip.startMs,
    sourceEndMs: clip.sourceEndMs ?? clip.startMs + durationMs,
    audioActivityStartMs: clip.startMs + activityStartOffsetMs,
    audioActivityEndMs: clip.startMs + activityEndOffsetMs,
    leadingSilenceMs: activityStartOffsetMs,
    trailingSilenceMs: Math.max(0, durationMs - activityEndOffsetMs),
    internalSilenceIntervals,
    confidence: audioActivityConfidence,
    analysisFilter: SMART_SLICE_RAW_AUDIO_ACTIVITY_ANALYSIS_FILTER,
  };
}

function createCompactedClip(clip, analysis, transcriptSegments) {
  const boundaryTranscriptSegments = createBoundaryTranscriptSegments(clip, transcriptSegments);
  const boundarySpeechStartMs = boundaryTranscriptSegments[0]?.startMs;
  const boundarySpeechEndMs = boundaryTranscriptSegments.at(-1)?.endMs;
  const boundaryClip = boundaryTranscriptSegments.length > 0
    ? {
        ...clip,
        startMs: Math.min(Math.round(clip.startMs), boundarySpeechStartMs),
        durationMs: Math.max(
          Math.round(clip.startMs + clip.durationMs),
          clip.sourceEndMs ?? clip.startMs + clip.durationMs,
          boundarySpeechEndMs,
        ) - Math.min(Math.round(clip.startMs), boundarySpeechStartMs),
        sourceStartMs: Math.min(clip.sourceStartMs ?? clip.startMs, boundarySpeechStartMs),
        sourceEndMs: Math.max(clip.sourceEndMs ?? clip.startMs + clip.durationMs, boundarySpeechEndMs),
        speechStartMs: Math.min(clip.speechStartMs ?? boundarySpeechStartMs, boundarySpeechStartMs),
        speechEndMs: Math.max(clip.speechEndMs ?? boundarySpeechEndMs, boundarySpeechEndMs),
      }
    : clip;
  const clipTranscriptSegments = boundaryTranscriptSegments.length > 0
    ? boundaryTranscriptSegments
    : createSliceTranscriptSegments(boundaryClip, transcriptSegments);
  const audioSourceSegments = createSmartSliceAudioActivitySourceSegments(boundaryClip, analysis);
  const transcriptSourceSegments = createSmartSliceSpeechSourceSegments(boundaryClip, clipTranscriptSegments);
  let sourceSegments = doesSourceSegmentsCoverTranscriptSegments(audioSourceSegments, clipTranscriptSegments, {
    ...boundaryClip,
    audioActivityStartMs: analysis?.audioActivityStartMs,
    audioActivityEndMs: analysis?.audioActivityEndMs,
    audioActivityConfidence: analysis?.confidence,
  })
    ? audioSourceSegments
    : transcriptSourceSegments;
  if (sourceSegments.length <= 1 && transcriptSourceSegments.length > 1) {
    sourceSegments = transcriptSourceSegments;
  }
  if (sourceSegments.length <= 1) {
    return attachSliceTranscriptEvidence(boundaryClip, transcriptSegments);
  }

  const sourceStartMs = sourceSegments[0].startMs;
  const sourceEndMs = sourceSegments.at(-1).endMs;
  const renderedDurationMs = sourceSegments.reduce(
    (durationMs, segment) => durationMs + Math.max(0, segment.endMs - segment.startMs),
    0,
  );
  const removedSilenceMs = Math.max(0, sourceEndMs - sourceStartMs - renderedDurationMs);
  if (renderedDurationMs <= 0 || removedSilenceMs <= 0) {
    return attachSliceTranscriptEvidence(clip, transcriptSegments);
  }

  const risks = new Set([...(clip.risks ?? []), 'internal-silence-trimmed']);
  const transcriptSpeechStartMs = Math.max(
    sourceStartMs,
    Math.min(clipTranscriptSegments[0]?.startMs ?? sourceStartMs, sourceEndMs),
  );
  const transcriptSpeechEndMs = Math.max(
    transcriptSpeechStartMs,
    Math.min(clipTranscriptSegments.at(-1)?.endMs ?? sourceEndMs, sourceEndMs),
  );
  const existingSpeechStartMs = Number.isFinite(clip.speechStartMs) ? Math.round(clip.speechStartMs) : undefined;
  const existingSpeechEndMs = Number.isFinite(clip.speechEndMs) ? Math.round(clip.speechEndMs) : undefined;
  const canKeepExistingSpeechRange =
    existingSpeechStartMs !== undefined &&
    existingSpeechEndMs !== undefined &&
    existingSpeechEndMs > existingSpeechStartMs &&
    existingSpeechStartMs >= sourceStartMs &&
    existingSpeechEndMs <= sourceEndMs &&
    transcriptSpeechStartMs <= existingSpeechStartMs + 250 &&
    transcriptSpeechEndMs >= existingSpeechEndMs - 250;
  const speechStartMs = canKeepExistingSpeechRange ? existingSpeechStartMs : transcriptSpeechStartMs;
  const speechEndMs = canKeepExistingSpeechRange ? existingSpeechEndMs : transcriptSpeechEndMs;
  return attachSliceTranscriptEvidence({
    ...boundaryClip,
    startMs: sourceStartMs,
    durationMs: sourceEndMs - sourceStartMs,
    sourceStartMs,
    sourceEndMs,
    speechStartMs,
    speechEndMs,
    boundaryPaddingBeforeMs: Math.max(0, speechStartMs - sourceStartMs),
    boundaryPaddingAfterMs: Math.max(0, sourceEndMs - speechEndMs),
    sourceSegments,
    renderedDurationMs,
    removedSilenceMs,
    internalSilenceTrimCount: sourceSegments.length - 1,
    risks: [...risks],
  }, transcriptSegments);
}

function doesSourceSegmentsCoverTranscriptSegments(sourceSegments, transcriptSegments, clip = {}) {
  return sourceSegments.length > 1 &&
    transcriptSegments.length > 0 &&
    transcriptSegments.every((transcriptSegment) =>
      isTimeRangeCoveredBySourceSegments(transcriptSegment.startMs, transcriptSegment.endMs, sourceSegments) ||
        doesTrustedAudioCompactedSourceSegmentsCoverTranscriptSegment(clip, sourceSegments, transcriptSegment)
    );
}

function doesTrustedAudioCompactedSourceSegmentsCoverTranscriptSegment(clip, sourceSegments, transcriptSegment) {
  if (
    !Array.isArray(sourceSegments) ||
    sourceSegments.length <= 1 ||
    !Number.isFinite(clip.audioActivityStartMs) ||
    !Number.isFinite(clip.audioActivityEndMs) ||
    clip.audioActivityEndMs <= clip.audioActivityStartMs ||
    !Number.isFinite(clip.audioActivityConfidence) ||
    clip.audioActivityConfidence < 0.8
  ) {
    return false;
  }

  const coverageStartMs = Math.max(Math.round(transcriptSegment.startMs), Math.round(clip.audioActivityStartMs));
  const coverageEndMs = Math.min(Math.round(transcriptSegment.endMs), Math.round(clip.audioActivityEndMs));
  if (coverageEndMs <= coverageStartMs) {
    return false;
  }

  const retainedCoverageMs = sourceSegments.reduce(
    (durationMs, sourceSegment) =>
      durationMs + Math.max(
        0,
        Math.min(coverageEndMs, Math.round(sourceSegment.endMs)) -
          Math.max(coverageStartMs, Math.round(sourceSegment.startMs)),
      ),
    0,
  );
  const retainedRatio = retainedCoverageMs / (coverageEndMs - coverageStartMs);
  if (retainedRatio >= minTrustedAudioCompactedRetainedRatio) {
    return retainedCoverageMs >= Math.min(
      minTrustedAudioCompactedShortUtteranceMs,
      coverageEndMs - coverageStartMs,
    );
  }

  const minimumAbsoluteRetainedMs = Math.min(
    maxTrustedAudioCompactedAbsoluteRetainedMs,
    Math.max(
      minTrustedAudioCompactedRetainedMs,
      Math.round((coverageEndMs - coverageStartMs) * minTrustedAudioCompactedAbsoluteRetainedRatio),
    ),
  );
  return retainedCoverageMs >= minimumAbsoluteRetainedMs;
}

function doesTrustedAudioCompactedClipCoverTranscriptSegment(clip, transcriptSegment) {
  return doesTrustedAudioCompactedSourceSegmentsCoverTranscriptSegment(
    clip,
    clip.sourceSegments,
    transcriptSegment,
  );
}

function isTimeRangeCoveredBySourceSegments(startMs, endMs, sourceSegments) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return false;
  }

  let coveredUntilMs = Math.round(startMs);
  for (const sourceSegment of sourceSegments) {
    if (sourceSegment.endMs <= coveredUntilMs) {
      continue;
    }
    if (sourceSegment.startMs > coveredUntilMs + 80) {
      return false;
    }
    coveredUntilMs = Math.max(coveredUntilMs, sourceSegment.endMs);
    if (coveredUntilMs >= endMs - 80) {
      return true;
    }
  }

  return coveredUntilMs >= endMs - 80;
}

function assertCompactedClipSpeechEvidence(clip, index) {
  const sourceStartMs = clip.sourceStartMs ?? clip.startMs;
  const sourceEndMs = clip.sourceEndMs ?? clip.startMs + clip.durationMs;
  if (
    !Number.isFinite(clip.speechStartMs) ||
    !Number.isFinite(clip.speechEndMs) ||
    clip.speechEndMs <= clip.speechStartMs ||
    clip.speechStartMs < sourceStartMs ||
    clip.speechEndMs > sourceEndMs
  ) {
    throw new Error(
      `wenan5 clip ${index + 1} speech range must stay inside retained source range: ` +
        `source=${sourceStartMs}-${sourceEndMs} speech=${clip.speechStartMs}-${clip.speechEndMs}`,
    );
  }

  const embeddedTranscriptSegments = (clip.transcriptSegments ?? []).filter((segment) =>
    segment.endMs > clip.speechStartMs &&
      segment.startMs < clip.speechEndMs &&
      String(segment.text ?? '').trim().length > 0
  );
  if (embeddedTranscriptSegments.length === 0) {
    throw new Error(`wenan5 clip ${index + 1} lacks speech-boundary STT evidence`);
  }
  if (clip.transcriptSegmentCount !== embeddedTranscriptSegments.length) {
    throw new Error(`wenan5 clip ${index + 1} transcriptSegmentCount must match speech-boundary STT evidence`);
  }
  if (!String(clip.transcriptText ?? '').trim()) {
    throw new Error(`wenan5 clip ${index + 1} lacks visible speech-boundary transcript text`);
  }
  if (
    embeddedTranscriptSegments.some((segment) =>
      segment.startMs < clip.speechStartMs ||
        segment.endMs > clip.speechEndMs
    )
  ) {
    throw new Error(`wenan5 clip ${index + 1} transcript evidence must stay inside speech boundaries`);
  }

  if (
    clip.sourceSegments?.length &&
    embeddedTranscriptSegments.some((transcriptSegment) =>
      !isTimeRangeCoveredBySourceSegments(transcriptSegment.startMs, transcriptSegment.endMs, clip.sourceSegments) &&
        !doesTrustedAudioCompactedSourceSegmentsCoverTranscriptSegment(
          clip,
          clip.sourceSegments,
          transcriptSegment,
        )
    )
  ) {
    throw new Error(`wenan5 clip ${index + 1} retained sourceSegments must cover every embedded STT segment`);
  }
}

function renderAndVerifyClip(plan, clip, index) {
  assertCompactedClipSpeechEvidence(clip, index);

  const outputPath = path.join(
    plan.outputDir,
    `slice-${String(index + 1).padStart(2, '0')}-${clip.sourceStartMs}-${clip.sourceEndMs}-compact.mp4`,
  );
  const hasCompactedSourceSegments = Array.isArray(clip.sourceSegments) && clip.sourceSegments.length > 1;
  const args = hasCompactedSourceSegments
    ? createCompactedRenderArgs(plan, clip, outputPath)
    : createContiguousRenderArgs(plan, clip, outputPath);
  const renderOutput = plan.runCommand(plan.ffmpegPath, args, { maxBuffer: 32 * 1024 * 1024 });
  if (renderOutput.status !== 0) {
    throw new Error(`wenan5 render failed for clip ${index + 1}: ${renderOutput.stderr || renderOutput.stdout}`);
  }

  const outputDurationMs = readMediaDurationMs(plan.runCommand, plan.ffprobePath, outputPath);
  const expectedDurationMs = hasCompactedSourceSegments ? clip.renderedDurationMs : clip.durationMs;
  const durationDeltaMs = Math.abs(outputDurationMs - expectedDurationMs);
  const outputSilences = detectLongOutputSilences(plan.runCommand, plan.ffmpegPath, outputPath, outputDurationMs);
  const videoProbe = probeVideoStream(plan.runCommand, plan.ffprobePath, outputPath);
  const subtitle = writeAndVerifyClipSubtitle(plan, clip, index, outputDurationMs);
  const blockers = [];
  if (durationDeltaMs > maxDurationDeltaMs) {
    blockers.push(`duration-delta-${durationDeltaMs}ms`);
  }
  if (outputSilences.some((silence) => silence.durationMs >= maxLongOutputSilenceMs)) {
    blockers.push('long-output-silence');
  }
  if (videoProbe.rotateTag || videoProbe.hasDisplayMatrix) {
    blockers.push('stale-rotation-metadata');
  }
  if (!(videoProbe.width > 0 && videoProbe.height > videoProbe.width)) {
    blockers.push(`not-upright-portrait-${videoProbe.width}x${videoProbe.height}`);
  }
  if (plan.params.enableSubtitles === true && !subtitle?.ready) {
    blockers.push('missing-editable-srt-sidecar');
  }

  return {
    index,
    candidateId: clip.candidateId,
    outputPath,
    sourceStartMs: clip.sourceStartMs ?? clip.startMs,
    sourceEndMs: clip.sourceEndMs ?? clip.startMs + clip.durationMs,
    speechStartMs: clip.speechStartMs,
    speechEndMs: clip.speechEndMs,
    sourceSegments: clip.sourceSegments,
    renderedDurationMs: expectedDurationMs,
    removedSilenceMs: clip.removedSilenceMs,
    internalSilenceTrimCount: clip.internalSilenceTrimCount,
    transcriptText: clip.transcriptText,
    transcriptSegments: clip.transcriptSegments,
    transcriptSegmentCount: clip.transcriptSegmentCount,
    risks: clip.risks ?? [],
    outputDurationMs,
    durationDeltaMs,
    outputSilences,
    longSilenceCount: outputSilences.filter((silence) => silence.durationMs >= maxLongOutputSilenceMs).length,
    ...(subtitle
      ? {
          subtitlePath: subtitle.path,
          subtitleCueCount: subtitle.cueCount,
          subtitleByteSize: subtitle.byteSize,
          subtitleFirstCueStartMs: subtitle.firstCueStartMs,
          subtitleLastCueEndMs: subtitle.lastCueEndMs,
        }
      : {}),
    videoProbe,
    blockers,
  };
}

function writeAndVerifyClipSubtitle(plan, clip, index, outputDurationMs) {
  if (plan.params.enableSubtitles !== true || plan.params.subtitleMode === 'none') {
    return undefined;
  }

  const subtitlePath = path.join(
    plan.outputDir,
    `slice-${String(index + 1).padStart(2, '0')}-${clip.sourceStartMs}-${clip.sourceEndMs}.srt`,
  );
  const cues = createRenderedSubtitleCues(clip, outputDurationMs);
  if (cues.length === 0) {
    return {
      ready: false,
      path: subtitlePath,
      cueCount: 0,
      byteSize: 0,
      firstCueStartMs: undefined,
      lastCueEndMs: undefined,
    };
  }

  const subtitleText = formatSrtCues(cues);
  fs.mkdirSync(path.dirname(subtitlePath), { recursive: true });
  fs.writeFileSync(`${subtitlePath}.tmp`, subtitleText);
  fs.renameSync(`${subtitlePath}.tmp`, subtitlePath);
  const byteSize = fs.statSync(subtitlePath).size;
  const firstCueStartMs = cues[0].startMs;
  const lastCueEndMs = cues.at(-1).endMs;
  return {
    ready:
      byteSize > 0 &&
      firstCueStartMs >= 0 &&
      lastCueEndMs > firstCueStartMs &&
      lastCueEndMs <= outputDurationMs + srtTimingToleranceMs,
    path: subtitlePath,
    cueCount: cues.length,
    byteSize,
    firstCueStartMs,
    lastCueEndMs,
  };
}

function createRenderedSubtitleCues(clip, outputDurationMs) {
  const sourceSegments = normalizeClipSourceSegments(clip);
  return (clip.transcriptSegments ?? [])
    .flatMap((segment) => mapTranscriptSegmentToRenderedSubtitleCues(segment, sourceSegments, outputDurationMs))
    .sort((firstCue, secondCue) =>
      firstCue.startMs - secondCue.startMs ||
        firstCue.endMs - secondCue.endMs
    )
    .filter((cue, index, cues) => {
      const previousCue = cues[index - 1];
      if (!previousCue || cue.endMs <= previousCue.endMs) {
        return cue.endMs > cue.startMs && cue.text.length > 0;
      }
      cue.startMs = Math.max(cue.startMs, previousCue.endMs);
      return cue.endMs > cue.startMs && cue.text.length > 0;
    });
}

function mapTranscriptSegmentToRenderedSubtitleCues(segment, sourceSegments, outputDurationMs) {
  const text = formatSrtCueText(segment);
  if (!text) {
    return [];
  }

  return sourceSegments
    .map((sourceSegment) => {
      const overlapStartMs = Math.max(Math.round(segment.startMs), sourceSegment.startMs);
      const overlapEndMs = Math.min(Math.round(segment.endMs), sourceSegment.endMs);
      if (overlapEndMs <= overlapStartMs) {
        return undefined;
      }
      const renderedStartMs = mapSourceTimeToRenderedTime(sourceSegments, overlapStartMs);
      const renderedEndMs = mapSourceTimeToRenderedTime(sourceSegments, overlapEndMs);
      if (renderedEndMs <= renderedStartMs) {
        return undefined;
      }
      return {
        startMs: Math.max(0, Math.min(renderedStartMs, outputDurationMs)),
        endMs: Math.max(0, Math.min(renderedEndMs, outputDurationMs)),
        text,
      };
    })
    .filter(Boolean);
}

function normalizeClipSourceSegments(clip) {
  const sourceSegments = Array.isArray(clip.sourceSegments) && clip.sourceSegments.length > 0
    ? clip.sourceSegments
    : [{
        startMs: clip.sourceStartMs ?? clip.startMs,
        endMs: clip.sourceEndMs ?? clip.startMs + clip.durationMs,
      }];
  return sourceSegments
    .map((segment) => ({
      startMs: Math.max(0, Math.round(segment.startMs)),
      endMs: Math.max(0, Math.round(segment.endMs)),
    }))
    .filter((segment) => segment.endMs > segment.startMs)
    .sort((firstSegment, secondSegment) =>
      firstSegment.startMs - secondSegment.startMs ||
        firstSegment.endMs - secondSegment.endMs
    );
}

function mapSourceTimeToRenderedTime(sourceSegments, sourceTimeMs) {
  let renderedTimeMs = 0;
  for (const sourceSegment of sourceSegments) {
    if (sourceTimeMs <= sourceSegment.startMs) {
      return renderedTimeMs;
    }
    if (sourceTimeMs <= sourceSegment.endMs) {
      return renderedTimeMs + sourceTimeMs - sourceSegment.startMs;
    }
    renderedTimeMs += sourceSegment.endMs - sourceSegment.startMs;
  }
  return renderedTimeMs;
}

function formatSrtCues(cues) {
  return `${cues
    .map((cue, index) =>
      [
        String(index + 1),
        `${formatSrtTimestamp(cue.startMs)} --> ${formatSrtTimestamp(cue.endMs)}`,
        cue.text,
      ].join('\n')
    )
    .join('\n\n')}\n`;
}

function formatSrtCueText(segment) {
  const text = normalizeSmartSliceTranscriptEvidenceText(segment.text);
  if (!text) {
    return '';
  }
  return `${segment.speaker?.trim() ? `${segment.speaker.trim()}: ` : ''}${text}`
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/\r?\n/gu, ' ')
    .trim();
}

function formatSrtTimestamp(milliseconds) {
  const normalized = Math.max(0, Math.round(milliseconds));
  const hours = Math.trunc(normalized / 3_600_000);
  const minutes = Math.trunc((normalized % 3_600_000) / 60_000);
  const seconds = Math.trunc((normalized % 60_000) / 1_000);
  const millis = normalized % 1_000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

function createCompactedRenderArgs(plan, clip, outputPath) {
  const filter = buildCompactedFilterComplex(clip.sourceSegments, plan.sourceHasAudioStream);
  const args = ['-hide_banner', '-nostdin', '-y'];
  for (const segment of clip.sourceSegments) {
    args.push(
      '-ss',
      secondsArgFromMillis(segment.startMs),
      '-t',
      secondsArgFromMillis(segment.endMs - segment.startMs),
      '-i',
      plan.inputPath,
    );
  }
  args.push('-filter_complex', filter.filterComplex, '-map', filter.videoLabel);
  if (filter.audioLabel) {
    args.push('-map', filter.audioLabel);
  }
  args.push(
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-metadata:s:v:0',
    'rotate=',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    outputPath,
  );
  return args;
}

function createContiguousRenderArgs(plan, clip, outputPath) {
  const args = [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-ss',
    secondsArgFromMillis(clip.startMs),
    '-i',
    plan.inputPath,
    '-t',
    secondsArgFromMillis(clip.durationMs),
    '-vf',
    'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-metadata:s:v:0',
    'rotate=',
  ];
  if (plan.sourceHasAudioStream) {
    args.push('-c:a', 'aac', '-b:a', '128k');
  } else {
    args.push('-an');
  }
  args.push('-movflags', '+faststart', outputPath);
  return args;
}

function buildCompactedFilterComplex(sourceSegments, sourceHasAudioStream) {
  const filters = [];
  let concatInputs = '';
  sourceSegments.forEach((_segment, index) => {
    filters.push(`[${index}:v:0]setpts=PTS-STARTPTS[v${index}]`);
    concatInputs += `[v${index}]`;
    if (sourceHasAudioStream) {
      filters.push(`[${index}:a:0]asetpts=PTS-STARTPTS[a${index}]`);
      concatInputs += `[a${index}]`;
    }
  });
  if (sourceHasAudioStream) {
    filters.push(`${concatInputs}concat=n=${sourceSegments.length}:v=1:a=1[vcat][acat]`);
  } else {
    filters.push(`${concatInputs}concat=n=${sourceSegments.length}:v=1:a=0[vcat]`);
  }
  filters.push('[vcat]sidedata=mode=delete:type=DISPLAYMATRIX[vout]');
  return {
    filterComplex: filters.join(';'),
    videoLabel: '[vout]',
    audioLabel: sourceHasAudioStream ? '[acat]' : undefined,
  };
}

function detectLongOutputSilences(runCommand, ffmpegPath, outputPath, durationMs) {
  const output = runCommand(ffmpegPath, [
    '-hide_banner',
    '-nostdin',
    '-nostats',
    '-i',
    outputPath,
    '-af',
    ffmpegLongSilenceDetectFilter,
    '-f',
    'null',
    '-',
  ]);
  if (output.status !== 0) {
    throw new Error(`wenan5 output silence verification failed for ${outputPath}: ${output.stderr || output.stdout}`);
  }
  return parseSilencedetectIntervals(output.stderr, durationMs)
    .filter((interval) => Number.isFinite(interval.endMs))
    .map((interval) => ({
      ...interval,
      durationMs: Math.max(0, interval.endMs - interval.startMs),
    }));
}

function createVerificationReport(plan, sourceVideoProbe, renderedClips) {
  const blockers = [];
  if (renderedClips.length < minExpectedClipCount) {
    blockers.push(`expected-at-least-${minExpectedClipCount}-clips`);
  }
  for (const clip of renderedClips) {
    blockers.push(...clip.blockers.map((blocker) => `clip-${clip.index + 1}:${blocker}`));
  }
  return {
    schemaVersion,
    generatedAt: plan.generatedAt,
    input: plan.inputPath,
    transcript: plan.transcriptPath,
    outputDir: plan.outputDir,
    profile: plan.profile,
    sourceDurationMs: plan.sourceDurationMs,
    params: plan.params,
    sourceVideoProbe,
    plannedClipCount: plan.plannedClips.length,
    planningEngine: 'smart-cut-engine',
    presetId: plan.enginePlan.presetId,
    renderedClipCount: renderedClips.length,
    thresholds: {
      minExpectedClipCount,
      maxDurationDeltaMs,
      maxLongOutputSilenceMs,
    },
    ready: blockers.length === 0,
    blockers,
    clips: renderedClips,
  };
}

function writeSmartSliceExecutionEvidencePackage(plan, compactedClips, renderedClips) {
  const evidenceDir = path.join(plan.outputDir, 'evidence');
  const reviewSegments = compactedClips.map((clip, index) => createReviewSegmentEvidence(clip, index));
  const selectedSegmentIds = reviewSegments.map((segment) => segment.id);
  const manualEdits = [];
  const evidenceFiles = {
    speechToTextPath: path.join(evidenceDir, 'speech-to-text.json'),
    semanticSegmentationPath: path.join(evidenceDir, 'semantic-segmentation.json'),
    reviewSessionPath: path.join(evidenceDir, 'review-session.json'),
    manualEditsPath: path.join(evidenceDir, 'manual-edits.json'),
    reviewEventsPath: path.join(evidenceDir, 'review-events.json'),
    renderSelectionPath: path.join(evidenceDir, 'render-selection.json'),
    renderArtifactManifestPath: path.join(evidenceDir, 'render-artifact-manifest.json'),
  };
  writeJson(evidenceFiles.speechToTextPath, {
    schema: 'smart-slice.speech-to-text.v1',
    taskId: 'wenan5-real-media-smart-slice',
    sourceAssetUuid: 'wenan5-real-media-smart-cut-engine',
    sourceDurationMs: plan.sourceDurationMs,
    providerId: 'fixture-whisper-json',
    language: 'auto',
    text: plan.transcriptSegments.map((segment) => segment.text).join(' '),
    segments: plan.transcriptSegments,
    nativeTranscriptPath: plan.transcriptPath,
    nativeTranscriptTaskUuid: 'wenan5-real-media-transcript',
    nativeTranscriptTaskOutputDir: path.dirname(plan.transcriptPath),
    createdAt: plan.generatedAt,
  });
  writeJson(evidenceFiles.semanticSegmentationPath, {
    schema: 'smart-slice.semantic-segmentation.v1',
    taskId: 'wenan5-real-media-smart-slice',
    sourceAssetUuid: 'wenan5-real-media-smart-cut-engine',
    sourceDurationMs: plan.sourceDurationMs,
    llmModel: plan.params.llmModel,
    mode: plan.params.mode,
    targetPlatform: plan.params.targetPlatform,
    segmentationDensity: plan.params.segmentationDensity ?? 'default',
    segmentationAgentId: plan.params.segmentationAgentId ?? 'semantic-story-agent',
    segmentationAgent: {
      id: plan.params.segmentationAgentId ?? 'semantic-story-agent',
      label: 'Semantic story agent',
      description: 'Real-media acceptance semantic segment planner.',
      systemPrompt: 'Return complete, contiguous, transcript-backed segments.',
    },
    presetId: plan.enginePlan.presetId,
    transcriptSegmentCount: plan.transcriptSegments.length,
    contentUnitCount: plan.enginePlan.llmReviewAudit?.input?.contentUnits?.length ?? compactedClips.length,
    candidateCount: plan.enginePlan.llmReviewAudit?.input?.candidates?.length ?? compactedClips.length,
    speakerProfileCount: plan.enginePlan.speakerEvidence?.profiles?.length ?? 1,
    speakerSegmentCount: plan.enginePlan.speakerEvidence?.segments?.length ?? plan.transcriptSegments.length,
    blockers: plan.enginePlan.blockers ?? [],
    transcriptEvidence: plan.enginePlan.transcriptEvidence ?? { segments: plan.transcriptSegments },
    speakerEvidence: plan.enginePlan.speakerEvidence ?? {
      profiles: [{ speakerId: 'Speaker 1', displayName: 'Speaker 1' }],
      segments: plan.transcriptSegments.map((segment, index) => ({
        id: `turn-${index + 1}`,
        speakerId: segment.speaker ?? 'Speaker 1',
        startMs: segment.startMs,
        endMs: segment.endMs,
      })),
    },
    ...(plan.enginePlan.llmReviewAudit ? { llmReviewAudit: plan.enginePlan.llmReviewAudit } : {}),
    clips: compactedClips.map((clip, index) => createSemanticClipEvidence(clip, index)),
    createdAt: plan.generatedAt,
  });
  writeJson(evidenceFiles.reviewSessionPath, {
    schema: 'smart-slice.review-session.v1',
    taskId: 'wenan5-real-media-smart-slice',
    reviewSessionId: 'wenan5-real-media-review',
    status: 'rendered',
    sourceAssetUuid: 'wenan5-real-media-smart-cut-engine',
    sourceDurationMs: plan.sourceDurationMs,
    segmentationAgentId: plan.params.segmentationAgentId ?? 'semantic-story-agent',
    segmentCount: reviewSegments.length,
    selectedSegmentCount: selectedSegmentIds.length,
    duplicateGroupCount: 0,
    manualEditCount: manualEdits.length,
    selectedSegmentIds,
    duplicateGroups: [],
    segments: reviewSegments,
    createdAt: plan.generatedAt,
  });
  writeJson(evidenceFiles.manualEditsPath, {
    schema: 'smart-slice.manual-edits.v1',
    taskId: 'wenan5-real-media-smart-slice',
    reviewSessionId: 'wenan5-real-media-review',
    editCount: manualEdits.length,
    selectedSegmentIds,
    manualEdits,
    segments: reviewSegments,
    createdAt: plan.generatedAt,
  });
  writeJson(evidenceFiles.reviewEventsPath, {
    schema: 'smart-slice.review-events.v1',
    taskId: 'wenan5-real-media-smart-slice',
    reviewSessionId: 'wenan5-real-media-review',
    reviewVersion: manualEdits.length,
    eventCount: 0,
    events: [],
    createdAt: plan.generatedAt,
  });
  writeJson(evidenceFiles.renderSelectionPath, {
    schema: 'smart-slice.render-selection.v1',
    taskId: 'wenan5-real-media-smart-slice',
    reviewSessionId: 'wenan5-real-media-review',
    selectedSegmentIds,
    selectedSegmentCount: selectedSegmentIds.length,
    submittedManualEditCount: 0,
    appliedManualEditCount: 0,
    manualEdits,
    selectedSegments: reviewSegments,
    createdAt: plan.generatedAt,
  });
  writeJson(evidenceFiles.renderArtifactManifestPath, {
    schema: 'smart-slice.render-artifact-manifest.v1',
    taskId: 'wenan5-real-media-smart-slice',
    nativeTaskId: 'wenan5-real-media-render',
    sourceAssetUuid: 'wenan5-real-media-smart-cut-engine',
    sourceDurationMs: plan.sourceDurationMs,
    taskOutputDir: plan.outputDir,
    sliceCount: renderedClips.length,
    subtitleMode: plan.params.subtitleMode ?? 'none',
    subtitleFormat: plan.params.enableSubtitles ? 'srt' : 'none',
    reviewSessionId: 'wenan5-real-media-review',
    selectedSegmentIds,
    slices: renderedClips.map((clip, index) => createManifestSliceEvidence(clip, index)),
    createdAt: plan.generatedAt,
  });
  return evidenceFiles;
}

function createSemanticClipEvidence(clip, index) {
  const endMs = Math.round(clip.sourceEndMs ?? clip.startMs + clip.durationMs);
  return {
    index,
    candidateId: clip.candidateId ?? `candidate-${index + 1}`,
    title: clip.title ?? clip.label ?? `Slice ${index + 1}`,
    label: clip.label ?? clip.title ?? `Slice ${index + 1}`,
    startMs: Math.round(clip.sourceStartMs ?? clip.startMs),
    endMs,
    durationMs: Math.round(clip.durationMs),
    sourceStartMs: Math.round(clip.sourceStartMs ?? clip.startMs),
    sourceEndMs: endMs,
    speechStartMs: Math.round(clip.speechStartMs ?? clip.sourceStartMs ?? clip.startMs),
    speechEndMs: Math.round(clip.speechEndMs ?? clip.sourceEndMs ?? endMs),
    contentUnitIds: clip.contentUnitIds ?? [`unit-${index + 1}`],
    speakerIds: clip.speakerIds?.length ? clip.speakerIds : ['Speaker 1'],
    speakerRoles: clip.speakerRoles?.length ? clip.speakerRoles : ['Speaker 1'],
    transcriptText: clip.transcriptText,
    transcriptSegmentCount: clip.transcriptSegmentCount ?? clip.transcriptSegments?.length ?? 0,
    transcriptCoverageScore: clip.transcriptCoverageScore ?? 1,
    speechContinuityGrade: clip.speechContinuityGrade ?? 'strong',
    risks: clip.risks ?? [],
  };
}

function createReviewSegmentEvidence(clip, index) {
  const semanticClip = createSemanticClipEvidence(clip, index);
  return {
    index,
    id: `segment-${String(index + 1).padStart(2, '0')}`,
    sourceClipIndex: index,
    status: 'selected',
    selected: true,
    title: semanticClip.title,
    startMs: semanticClip.sourceStartMs,
    endMs: semanticClip.sourceEndMs,
    durationMs: Math.max(1, semanticClip.sourceEndMs - semanticClip.sourceStartMs),
    speechStartMs: semanticClip.speechStartMs,
    speechEndMs: semanticClip.speechEndMs,
    contentUnitIds: semanticClip.contentUnitIds,
    speakerIds: semanticClip.speakerIds,
    speakerRoles: semanticClip.speakerRoles,
    transcriptSegmentCount: semanticClip.transcriptSegmentCount,
    transcriptText: semanticClip.transcriptText,
    risks: semanticClip.risks,
  };
}

function createManifestSliceEvidence(clip, index) {
  return {
    index,
    id: `slice-${String(index + 1).padStart(2, '0')}`,
    name: path.basename(clip.outputPath),
    title: `Slice ${index + 1}`,
    artifactUuid: `slice-${String(index + 1).padStart(2, '0')}`,
    artifactPath: clip.outputPath,
    url: pathToFileURL(clip.outputPath).href,
    ...(clip.subtitlePath
      ? {
          subtitleArtifactUuid: `slice-${String(index + 1).padStart(2, '0')}-subtitle`,
          subtitleArtifactPath: clip.subtitlePath,
          subtitleUrl: pathToFileURL(clip.subtitlePath).href,
          subtitleFormat: 'srt',
        }
      : {}),
    sourceStartMs: clip.sourceStartMs,
    sourceEndMs: clip.sourceEndMs,
    speechStartMs: clip.speechStartMs,
    speechEndMs: clip.speechEndMs,
    durationSeconds: Math.round((clip.outputDurationMs / 1_000) * 1000) / 1000,
    byteSize: fs.existsSync(clip.outputPath) ? fs.statSync(clip.outputPath).size : 0,
    nativeClip: {
      startMs: clip.sourceStartMs,
      durationMs: Math.max(1, clip.sourceEndMs - clip.sourceStartMs),
      label: `Slice ${index + 1}`,
    },
    reviewSegmentIds: [`segment-${String(index + 1).padStart(2, '0')}`],
    transcriptSegmentCount: clip.transcriptSegmentCount ?? clip.transcriptSegments?.length ?? 0,
    transcriptText: clip.transcriptText,
    ...(clip.sourceSegments?.length ? { sourceSegments: clip.sourceSegments } : {}),
    ...(clip.removedSilenceMs !== undefined ? { removedSilenceMs: clip.removedSilenceMs } : {}),
    ...(clip.risks?.length ? { risks: clip.risks } : {}),
  };
}

function createClipPlanSnapshot(clip, renderedClip) {
  return {
    index: renderedClip?.index ?? clip.index,
    candidateId: clip.candidateId,
    startMs: clip.startMs,
    durationMs: clip.durationMs,
    sourceStartMs: clip.sourceStartMs,
    sourceEndMs: clip.sourceEndMs,
    speechStartMs: clip.speechStartMs,
    speechEndMs: clip.speechEndMs,
    sourceSegments: clip.sourceSegments,
    renderedDurationMs: clip.renderedDurationMs,
    removedSilenceMs: clip.removedSilenceMs,
    internalSilenceTrimCount: clip.internalSilenceTrimCount,
    transcriptText: clip.transcriptText,
    transcriptSegments: clip.transcriptSegments,
    transcriptSegmentCount: clip.transcriptSegmentCount,
    contentArcGrade: clip.contentArcGrade,
    storyShape: clip.storyShape,
    publishabilityGrade: clip.publishabilityGrade,
    platformReadinessGrade: clip.platformReadinessGrade,
    risks: clip.risks,
    ...(renderedClip ? {
      outputPath: renderedClip.outputPath,
      outputDurationMs: renderedClip.outputDurationMs,
      durationDeltaMs: renderedClip.durationDeltaMs,
      outputSilenceCount: renderedClip.outputSilences.length,
    } : {}),
  };
}

export function parseSilencedetectIntervals(stderr, durationMs) {
  const intervals = [];
  let openStartMs;
  for (const line of String(stderr).split(/\r?\n/u)) {
    const startMatch = line.match(/silence_start:\s*([0-9.]+)/u);
    if (startMatch) {
      openStartMs = secondsTextToMs(startMatch[1]);
      continue;
    }
    const endMatch = line.match(/silence_end:\s*([0-9.]+)/u);
    if (endMatch && openStartMs !== undefined) {
      const endMs = secondsTextToMs(endMatch[1]);
      if (endMs > openStartMs) {
        intervals.push({ startMs: openStartMs, endMs });
      }
      openStartMs = undefined;
    }
  }
  if (openStartMs !== undefined && Number.isFinite(durationMs) && durationMs > openStartMs) {
    intervals.push({ startMs: openStartMs, endMs: durationMs });
  }
  return mergeAdjacentSilenceIntervals(intervals, maxSilenceBridgeGapMs);
}

function mergeAdjacentSilenceIntervals(intervals, maxBridgeGapMs) {
  const sortedIntervals = intervals
    .map((interval) => ({
      startMs: Math.max(0, Math.round(interval.startMs)),
      endMs: Math.max(0, Math.round(interval.endMs)),
    }))
    .filter((interval) => interval.endMs > interval.startMs)
    .sort((firstInterval, secondInterval) =>
      firstInterval.startMs - secondInterval.startMs ||
        firstInterval.endMs - secondInterval.endMs
    );
  const mergedIntervals = [];
  for (const interval of sortedIntervals) {
    const previousInterval = mergedIntervals.at(-1);
    if (
      previousInterval &&
      interval.startMs <= previousInterval.endMs + maxBridgeGapMs
    ) {
      previousInterval.endMs = Math.max(previousInterval.endMs, interval.endMs);
      continue;
    }
    mergedIntervals.push({ ...interval });
  }
  return mergedIntervals;
}

function readMediaDurationMs(runCommand, ffprobePath, mediaPath) {
  const output = runCommand(ffprobePath, [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    mediaPath,
  ]);
  if (output.status !== 0) {
    throw new Error(`ffprobe duration failed for ${mediaPath}: ${output.stderr || output.stdout}`);
  }
  const seconds = Number(String(output.stdout).trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`ffprobe duration was invalid for ${mediaPath}: ${output.stdout}`);
  }
  return Math.round(seconds * 1_000);
}

function probeMediaHasStream(runCommand, ffprobePath, mediaPath, streamSelector) {
  const output = runCommand(ffprobePath, [
    '-v',
    'error',
    '-select_streams',
    streamSelector,
    '-show_entries',
    'stream=index',
    '-of',
    'csv=p=0',
    mediaPath,
  ]);
  return output.status === 0 && String(output.stdout).trim().length > 0;
}

function probeVideoStream(runCommand, ffprobePath, mediaPath) {
  const output = runCommand(ffprobePath, [
    '-v',
    'error',
    '-show_streams',
    '-select_streams',
    'v:0',
    mediaPath,
  ]);
  if (output.status !== 0) {
    throw new Error(`ffprobe video stream failed for ${mediaPath}: ${output.stderr || output.stdout}`);
  }
  const text = String(output.stdout);
  return {
    width: Number(text.match(/^width=(\d+)$/mu)?.[1] ?? 0),
    height: Number(text.match(/^height=(\d+)$/mu)?.[1] ?? 0),
    rotateTag: text.match(/^TAG:rotate=(.+)$/mu)?.[1] ?? '',
    hasDisplayMatrix: text.includes('Display Matrix'),
  };
}

export function runAutoCutWenan5MediaCommand(command, args, { maxBuffer = 16 * 1024 * 1024 } = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
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

function secondsTextToMs(value) {
  return Math.round(Number(value) * 1_000);
}

function secondsArgFromMillis(milliseconds) {
  const normalized = Math.max(0, Math.round(milliseconds));
  const seconds = Math.trunc(normalized / 1_000);
  const millis = normalized % 1_000;
  return `${seconds}.${String(millis).padStart(3, '0')}`;
}

function writeJson(targetPath, value) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(`${targetPath}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(`${targetPath}.tmp`, targetPath);
}

function parseArgs(argv) {
  const args = normalizeAutoCutCliArgs(argv);
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--input') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut wenan5 real media Smart Slice check',
      });
      options.inputPath = option.value;
      index = option.nextIndex;
    } else if (arg === '--transcript') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut wenan5 real media Smart Slice check',
      });
      options.transcriptPath = option.value;
      index = option.nextIndex;
    } else if (arg === '--output') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut wenan5 real media Smart Slice check',
      });
      options.outputDir = option.value;
      index = option.nextIndex;
    } else if (arg === '--ffmpeg') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut wenan5 real media Smart Slice check',
      });
      options.ffmpegPath = option.value;
      index = option.nextIndex;
    } else if (arg === '--ffprobe') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut wenan5 real media Smart Slice check',
      });
      options.ffprobePath = option.value;
      index = option.nextIndex;
    } else if (arg === '--profile') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut wenan5 real media Smart Slice check',
      });
      options.profile = option.value;
      index = option.nextIndex;
    } else {
      throw new Error(`unknown AutoCut wenan5 real media Smart Slice check option: ${arg}`);
    }
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  try {
    const result = await runAutoCutWenan5RealMediaSliceCheck(parseArgs(process.argv.slice(2)));
    console.log(formatAutoCutWenan5RealMediaSliceCheckMessage(result));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
