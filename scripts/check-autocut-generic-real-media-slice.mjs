#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  createSmartSliceSpeechSourceSegments,
  createTranscriptAssistedSlicePlan,
  normalizeSmartSliceTranscriptEvidenceText,
} from '../packages/sdkwork-autocut-slicer/src/service/slicePlanner.ts';
import {
  createSmartCutEngineSlicePlan,
} from '../packages/sdkwork-autocut-slicer/src/service/smartCutEnginePlanner.ts';
import {
  getAutoCutSmartSliceSegmentationAgentDefinition,
} from '../packages/sdkwork-autocut-types/src/index.ts';
import {
  createAutoCutSmartSliceExecutionEvidenceValidationReport,
} from './check-autocut-smart-slice-execution-evidence.mjs';
import {
  normalizeAutoCutCliArgs,
  readAutoCutCliOptionValue,
} from './autocut-cli-args.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const schemaVersion = '2026-05-16.autocut-generic-real-media-slice.v1';
const defaultOutputDir = path.join(repoRoot, 'artifacts/autocut-diagnostics/generic-real-media-slice');
const defaultSmartSliceProfile = 'desktop-duration';
const defaultRenderClipLimit = 3;
const maxDurationDeltaMs = 1_250;
const maxLongOutputSilenceMs = 1_000;
const ffmpegLongSilenceDetectFilter = 'silencedetect=noise=-35dB:d=0.8';
const srtTimingToleranceMs = 120;
const genericSmartSliceProfiles = {
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
    segmentationDensity: 'default',
    segmentationAgentId: 'semantic-story-agent',
    baseAlgorithm: 'nlp',
    highlightEngine: 'emotion',
    enableNoiseReduction: true,
    enableCoughFilter: true,
    enableRepeatFilter: true,
    enableSubtitles: true,
    subtitleMode: 'both',
  },
  'desktop-continuity-max': {
    mode: 'contract-mode',
    llmModel: 'deepseek-v4-flash',
    minDuration: 45,
    maxDuration: 120,
    idealDuration: 75,
    targetPlatform: 'douyin',
    targetAspectRatio: '9:16',
    videoObjectFit: 'contain',
    continuityLevel: 'strict',
    segmentationDensity: 'maximize-continuity',
    segmentationAgentId: 'semantic-story-agent',
    baseAlgorithm: 'nlp',
    highlightEngine: 'emotion',
    enableNoiseReduction: true,
    enableCoughFilter: true,
    enableRepeatFilter: true,
    enableSubtitles: true,
    subtitleMode: 'both',
  },
};

export async function runAutoCutGenericRealMediaSliceCheck(options = {}) {
  const plan = await createAutoCutGenericRealMediaSlicePlan(options);
  fs.mkdirSync(plan.outputDir, { recursive: true });

  const sourceVideoProbe = probeVideoStream(plan.runCommand, plan.ffprobePath, plan.inputPath);
  const renderedPlanClips = plan.plannedClips.slice(0, plan.renderClipLimit);
  if (renderedPlanClips.length === 0) {
    throw new Error('generic real media Smart Slice produced no renderable clips from the same-source transcript');
  }
  const renderedClips = renderedPlanClips.map((clip, index) => renderAndVerifyClip(plan, clip, index));
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
    planningEngine: plan.planningEngine,
    presetId: plan.enginePlan?.presetId ?? 'transcript-assisted',
    renderLimit: plan.renderClipLimit,
    plannedClipCount: plan.plannedClips.length,
    renderedClipCount: renderedClips.length,
    plannerBlockers: plan.plannerBlockers,
    plannedClips: plan.plannedClips.map((clip, index) => createClipPlanSnapshot(clip, renderedClips[index])),
  });
  writeJson(verificationPath, report);
  const evidencePackage = writeSmartSliceExecutionEvidencePackage(plan, renderedClips);
  const executionEvidenceReport = createAutoCutSmartSliceExecutionEvidenceValidationReport({
    taskDir: plan.outputDir,
    generatedAt: plan.generatedAt,
  });
  if (!report.ready) {
    throw new Error(`generic real media Smart Slice check failed: ${report.blockers.join('; ')}`);
  }
  if (!executionEvidenceReport.ready) {
    throw new Error(
      `generic real media Smart Slice execution evidence failed: ${executionEvidenceReport.blockers.map((blocker) => blocker.code).join('; ')}`,
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

export async function createAutoCutGenericRealMediaSlicePlan({
  inputPath,
  transcriptPath,
  outputDir = defaultOutputDir,
  ffmpegPath = process.env.SDKWORK_AUTOCUT_FFMPEG_EXECUTABLE ?? process.env.SDKWORK_AUTOCUT_FFMPEG ?? 'ffmpeg',
  ffprobePath = process.env.SDKWORK_AUTOCUT_FFPROBE_EXECUTABLE ?? process.env.SDKWORK_AUTOCUT_FFPROBE ?? 'ffprobe',
  profile = defaultSmartSliceProfile,
  generatedAt = new Date().toISOString(),
  renderClipLimit = defaultRenderClipLimit,
  runCommand = runAutoCutGenericMediaCommand,
} = {}) {
  if (!inputPath?.trim()) {
    throw new Error('missing --input path for generic real media Smart Slice');
  }
  if (!transcriptPath?.trim()) {
    throw new Error('missing --transcript path for generic real media Smart Slice');
  }

  const resolvedInputPath = path.resolve(inputPath);
  const resolvedTranscriptPath = path.resolve(transcriptPath);
  const resolvedOutputDir = path.resolve(outputDir);
  const sourceDurationMs = readMediaDurationMs(runCommand, ffprobePath, resolvedInputPath);
  const sourceHasAudioStream = probeMediaHasStream(runCommand, ffprobePath, resolvedInputPath, 'a:0');
  const transcriptSegments = readWhisperCppTranscriptSegments(resolvedTranscriptPath);
  const params = createGenericPlannerParams(sourceDurationMs, profile);
  const sourceAssetUuid = createGenericSourceAssetUuid(resolvedInputPath);
  const renderLimit = Math.max(1, Math.round(Number(renderClipLimit) || defaultRenderClipLimit));
  const plannerResult = await createGenericSmartSlicePlan({
    params,
    transcriptSegments,
    sourceAssetUuid,
    sourceDurationMs,
  });
  const plannedClips = plannerResult.clips
    .map((clip, index) => attachSliceTranscriptEvidence(clip, transcriptSegments, index))
    .filter((clip) => clip.transcriptSegmentCount > 0 && clip.transcriptText);
  if (plannedClips.length === 0) {
    throw new Error('generic real media Smart Slice could not build transcript-backed renderable clips');
  }

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
    sourceAssetUuid,
    transcriptSegments,
    params,
    renderClipLimit: Math.min(renderLimit, plannedClips.length),
    planningEngine: plannerResult.planningEngine,
    plannerBlockers: plannerResult.plannerBlockers,
    enginePlan: plannerResult.enginePlan,
    plannedClips,
  };
}

export function formatAutoCutGenericRealMediaSliceCheckMessage(result) {
  const prefix = result.ready ? 'ok' : 'blocked';
  return [
    `${prefix} - generic real media Smart Slice`,
    `clips=${result.report.renderedClipCount}`,
    `planned=${result.report.plannedClipCount}`,
    `engine=${result.report.planningEngine}`,
    `output=${result.outputDir}`,
  ].join(' ');
}

async function createGenericSmartSlicePlan({
  params,
  transcriptSegments,
  sourceAssetUuid,
  sourceDurationMs,
}) {
  try {
    const enginePlan = await createSmartCutEngineSlicePlan({
      params,
      transcriptSegments,
      sourceAssetUuid,
      sourceDurationMs,
    });
    return {
      planningEngine: 'smart-cut-engine',
      plannerBlockers: normalizeBlockers(enginePlan.blockers),
      enginePlan,
      clips: enginePlan.clips,
    };
  } catch (error) {
    const transcriptAssistedClips = createTranscriptAssistedSlicePlan(params, transcriptSegments);
    const fallbackClips = transcriptAssistedClips.length > 0
      ? transcriptAssistedClips
      : createLargeMediaTranscriptContinuityPlan({
        params,
        transcriptSegments,
      });
    if (fallbackClips.length === 0) {
      throw error;
    }
    return {
      planningEngine: 'transcript-assisted-fallback',
      plannerBlockers: normalizeBlockers(error?.blockers).length > 0
        ? normalizeBlockers(error.blockers)
        : [{ code: 'SMART_CUT_ENGINE_FALLBACK', message: formatErrorMessage(error) }],
      enginePlan: undefined,
      clips: fallbackClips,
    };
  }
}

export function createLargeMediaTranscriptContinuityPlan({
  params,
  transcriptSegments,
}) {
  const maxDurationMs = secondsParamToMs(params?.maxDuration, 70);
  const minDurationMs = secondsParamToMs(params?.minDuration, 30);
  const sourceDurationMs = normalizeNonNegativeInteger(params?.sourceDurationMs);
  const normalizedSegments = transcriptSegments
    .map((segment) => ({
      startMs: normalizeNonNegativeInteger(segment?.startMs),
      endMs: normalizeNonNegativeInteger(segment?.endMs),
      text: normalizeSmartSliceTranscriptEvidenceText(segment?.text),
      speaker: normalizeString(segment?.speaker) || 'Speaker 1',
    }))
    .filter((segment) =>
      segment.startMs !== undefined &&
        segment.endMs !== undefined &&
        segment.endMs > segment.startMs &&
        segment.text
    )
    .sort((first, second) => first.startMs - second.startMs || first.endMs - second.endMs);
  const clips = [];
  let current = [];
  for (const segment of normalizedSegments) {
    if (current.length === 0) {
      current.push(segment);
      continue;
    }
    const firstSegment = current[0];
    const previousSegment = current.at(-1);
    const nextDurationMs = segment.endMs - firstSegment.startMs;
    const gapMs = segment.startMs - previousSegment.endMs;
    const shouldStartNewClip =
      nextDurationMs > maxDurationMs ||
        (currentDurationMs(current) >= minDurationMs && gapMs > resolveLargeMediaContinuityGapMs(current, segment));
    if (shouldStartNewClip) {
      pushLargeMediaContinuityClip(clips, current, {
        sourceDurationMs,
        maxDurationMs,
      });
      current = [segment];
      continue;
    }
    current.push(segment);
  }
  pushLargeMediaContinuityClip(clips, current, {
    sourceDurationMs,
    maxDurationMs,
  });
  return clips.map((clip, index) => ({ ...clip, index }));
}

function pushLargeMediaContinuityClip(clips, segments, { sourceDurationMs, maxDurationMs }) {
  const eligibleSegments = segments.filter((segment) => segment.text);
  if (eligibleSegments.length === 0) {
    return;
  }
  const first = eligibleSegments[0];
  const last = eligibleSegments.at(-1);
  const speechStartMs = first.startMs;
  const speechEndMs = last.endMs;
  if (speechEndMs <= speechStartMs) {
    return;
  }
  const sourceStartMs = Math.max(0, speechStartMs - 350);
  const sourceEndMs = Math.min(
    sourceDurationMs ?? speechEndMs + 350,
    speechEndMs + 350,
  );
  if (sourceEndMs <= sourceStartMs || sourceEndMs - sourceStartMs > maxDurationMs + 700) {
    return;
  }
  const transcriptText = eligibleSegments.map((segment) => segment.text).join(' ').replace(/\s+/gu, ' ').trim();
  if (!transcriptText) {
    return;
  }
  const speakerIds = [...new Set(eligibleSegments.map((segment) => normalizeSpeakerEvidenceId(segment.speaker)))];
  const sourceSegments = createSmartSliceSpeechSourceSegments({
    startMs: sourceStartMs,
    durationMs: sourceEndMs - sourceStartMs,
    sourceStartMs,
    sourceEndMs,
  }, eligibleSegments);
  clips.push({
    candidateId: `large-media-continuity-${clips.length + 1}`,
    planningEngine: 'large-media-transcript-continuity',
    startMs: sourceStartMs,
    durationMs: sourceEndMs - sourceStartMs,
    sourceStartMs,
    sourceEndMs,
    speechStartMs,
    speechEndMs,
    boundaryPaddingBeforeMs: speechStartMs - sourceStartMs,
    boundaryPaddingAfterMs: sourceEndMs - speechEndMs,
    title: createContinuityClipTitle(transcriptText, clips.length + 1),
    label: createContinuityClipTitle(transcriptText, clips.length + 1),
    summary: 'Large media transcript continuity fallback selected one contiguous semantic speech chunk.',
    reason: 'Same-source transcript continuity fallback after strict Smart Cut Engine evidence blocking.',
    qualityScore: 0.72,
    continuityScore: 0.78,
    storyShape: 'complete',
    publishabilityScore: 0.72,
    publishabilityGrade: 'good',
    publishabilityIssues: [],
    boundaryQualityScore: 0.78,
    hookStrength: 'contextual',
    endingCompleteness: 'complete',
    contentArcScore: 0.72,
    contentArcGrade: 'complete',
    contentArcStages: ['setup', 'payoff'],
    contentArcMissingStages: [],
    topicCoherenceScore: 0.74,
    topicCoherenceGrade: 'mixed',
    topicShiftCount: 0,
    topicKeywords: [],
    platformReadinessScore: 0.72,
    platformReadinessGrade: 'good',
    platformReadinessIssues: [],
    sentenceBoundaryIntegrityScore: 0.72,
    sentenceBoundaryIntegrityGrade: 'repaired',
    sentenceBoundaryIssues: [],
    risks: ['large-media-transcript-continuity-fallback'],
    transcriptText,
    transcriptSegments: eligibleSegments,
    transcriptSegmentTexts: eligibleSegments.map((segment) => segment.text),
    transcriptSegmentCount: eligibleSegments.length,
    transcriptCoverageScore: Math.min(1, (speechEndMs - speechStartMs) / Math.max(1, sourceEndMs - sourceStartMs)),
    speechContinuityGrade: 'strong',
    contentUnitIds: eligibleSegments.map((_segment, index) => `unit-${clips.length + 1}-${index + 1}`),
    speakerIds,
    speakerRoles: speakerIds.map(() => 'speaker'),
    ...(sourceSegments.length > 1
      ? {
        sourceSegments,
        renderedDurationMs: sourceSegments.reduce((durationMs, segment) => durationMs + Math.max(0, segment.endMs - segment.startMs), 0),
        removedSilenceMs: Math.max(0, sourceEndMs - sourceStartMs - sourceSegments.reduce((durationMs, segment) => durationMs + Math.max(0, segment.endMs - segment.startMs), 0)),
        internalSilenceTrimCount: sourceSegments.length - 1,
      }
      : {}),
  });
}

function currentDurationMs(segments) {
  const first = segments[0];
  const last = segments.at(-1);
  return first && last ? Math.max(0, last.endMs - first.startMs) : 0;
}

function resolveLargeMediaContinuityGapMs(currentSegments, nextSegment) {
  const previousText = currentSegments.at(-1)?.text ?? '';
  if (startsWithContinuityConnector(nextSegment.text) || endsWithContinuityConnector(previousText)) {
    return 3_000;
  }
  return 1_500;
}

function startsWithContinuityConnector(text) {
  const normalized = normalizeSmartSliceTranscriptEvidenceText(text);
  return /^(?:然后|所以|因此|但是|不过|而且|因为|如果|当|同时|接着|另外)/u.test(normalized) ||
    /^(?:then|so|therefore|but|because|and|also|however)\b/iu.test(normalized);
}

function endsWithContinuityConnector(text) {
  return /(?:然后|所以|因此|但是|不过|而且|因为|如果|当|同时|接着|另外|then|so|therefore|but|because|and|also|however)\s*$/iu.test(normalizeSmartSliceTranscriptEvidenceText(text));
}

function createContinuityClipTitle(text, index) {
  const normalized = normalizeSmartSliceTranscriptEvidenceText(text).slice(0, 36);
  return normalized || `Continuity slice ${index}`;
}

function normalizeSpeakerEvidenceId(speaker) {
  const normalized = normalizeString(speaker).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/giu, '-').replace(/^-+|-+$/gu, '');
  return `speaker-${normalized || 'speaker-1'}`;
}

function createGenericPlannerParams(sourceDurationMs, profile) {
  const profileParams = genericSmartSliceProfiles[profile];
  if (!profileParams) {
    throw new Error(
      `unknown generic Smart Slice profile: ${profile}. Supported profiles: ${Object.keys(genericSmartSliceProfiles).join(', ')}`,
    );
  }
  return {
    ...profileParams,
    sourceDurationMs,
  };
}

function readWhisperCppTranscriptSegments(transcriptPath) {
  if (!fs.existsSync(transcriptPath) || !fs.statSync(transcriptPath).isFile()) {
    throw new Error(`missing generic real media transcript evidence: ${transcriptPath}`);
  }
  const transcript = JSON.parse(fs.readFileSync(transcriptPath, 'utf8'));
  const entries = Array.isArray(transcript.transcription)
    ? transcript.transcription
    : Array.isArray(transcript.segments)
      ? transcript.segments
      : [];
  const segments = entries
    .map((entry) => {
      const startMs = normalizeNonNegativeInteger(entry?.offsets?.from ?? entry?.startMs ?? secondsToMs(entry?.start));
      const endMs = normalizeNonNegativeInteger(entry?.offsets?.to ?? entry?.endMs ?? secondsToMs(entry?.end));
      const text = normalizeSmartSliceTranscriptEvidenceText(entry?.text);
      if (startMs === undefined || endMs === undefined || endMs <= startMs || !text) {
        return undefined;
      }
      return {
        startMs,
        endMs,
        text,
        speaker: normalizeString(entry?.speaker) || 'Speaker 1',
      };
    })
    .filter(Boolean)
    .sort((first, second) => first.startMs - second.startMs || first.endMs - second.endMs);
  if (segments.length === 0) {
    throw new Error(`generic real media transcript evidence contains no timestamped speech segments: ${transcriptPath}`);
  }
  return segments;
}

function attachSliceTranscriptEvidence(clip, transcriptSegments, index) {
  const sourceStartMs = Math.max(0, Math.round(clip.sourceStartMs ?? clip.startMs));
  const sourceEndMs = Math.max(sourceStartMs + 1, Math.round(clip.sourceEndMs ?? clip.startMs + clip.durationMs));
  const speechStartMs = Math.max(sourceStartMs, Math.min(sourceEndMs, Math.round(clip.speechStartMs ?? sourceStartMs)));
  const speechEndMs = Math.max(speechStartMs + 1, Math.min(sourceEndMs, Math.round(clip.speechEndMs ?? sourceEndMs)));
  const clipTranscriptSegments = transcriptSegments
    .filter((segment) =>
      segment.endMs > speechStartMs &&
        segment.startMs < speechEndMs &&
        normalizeSmartSliceTranscriptEvidenceText(segment.text).length > 0
    )
    .map((segment) => ({
      startMs: Math.max(speechStartMs, Math.round(segment.startMs)),
      endMs: Math.min(speechEndMs, Math.round(segment.endMs)),
      text: normalizeSmartSliceTranscriptEvidenceText(segment.text),
      speaker: normalizeString(segment.speaker) || 'Speaker 1',
    }))
    .filter((segment) => segment.endMs > segment.startMs && segment.text)
    .sort((first, second) => first.startMs - second.startMs || first.endMs - second.endMs);
  const transcriptText = clipTranscriptSegments.map((segment) => segment.text).join(' ').replace(/\s+/gu, ' ').trim();
  const sourceSegments = Array.isArray(clip.sourceSegments) && clip.sourceSegments.length > 1
    ? clip.sourceSegments
    : createSmartSliceSpeechSourceSegments({
      startMs: sourceStartMs,
      durationMs: sourceEndMs - sourceStartMs,
      sourceStartMs,
      sourceEndMs,
    }, clipTranscriptSegments);
  const renderedDurationMs = sourceSegments.length > 1
    ? sourceSegments.reduce((durationMs, segment) => durationMs + Math.max(0, segment.endMs - segment.startMs), 0)
    : sourceEndMs - sourceStartMs;

  return {
    ...clip,
    index,
    startMs: sourceStartMs,
    durationMs: sourceEndMs - sourceStartMs,
    sourceStartMs,
    sourceEndMs,
    speechStartMs,
    speechEndMs,
    transcriptText,
    transcriptSegments: clipTranscriptSegments,
    transcriptSegmentTexts: clipTranscriptSegments.map((segment) => segment.text),
    transcriptSegmentCount: clipTranscriptSegments.length,
    transcriptCoverageScore: clipTranscriptSegments.length > 0
      ? Math.min(1, (speechEndMs - speechStartMs) / Math.max(1, sourceEndMs - sourceStartMs))
      : 0,
    speakerIds: normalizeStringArray(clip.speakerIds).length > 0 ? normalizeStringArray(clip.speakerIds) : ['speaker-speaker-1'],
    speakerRoles: normalizeStringArray(clip.speakerRoles).length > 0 ? normalizeStringArray(clip.speakerRoles) : ['speaker'],
    ...(sourceSegments.length > 1
      ? {
        sourceSegments,
        renderedDurationMs,
        removedSilenceMs: Math.max(0, sourceEndMs - sourceStartMs - renderedDurationMs),
        internalSilenceTrimCount: sourceSegments.length - 1,
      }
      : {}),
  };
}

function renderAndVerifyClip(plan, clip, index) {
  assertClipSpeechEvidence(clip, index);
  const outputPath = path.join(
    plan.outputDir,
    `slice-${String(index + 1).padStart(2, '0')}-${clip.sourceStartMs}-${clip.sourceEndMs}.mp4`,
  );
  const hasCompactedSourceSegments = Array.isArray(clip.sourceSegments) && clip.sourceSegments.length > 1;
  const args = hasCompactedSourceSegments
    ? createCompactedRenderArgs(plan, clip, outputPath)
    : createContiguousRenderArgs(plan, clip, outputPath);
  const renderOutput = plan.runCommand(plan.ffmpegPath, args, { maxBuffer: 64 * 1024 * 1024 });
  if (renderOutput.status !== 0) {
    throw new Error(`generic real media render failed for clip ${index + 1}: ${renderOutput.stderr || renderOutput.stdout}`);
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
  if (!(videoProbe.width > 0 && videoProbe.height > 0)) {
    blockers.push(`invalid-video-dimensions-${videoProbe.width}x${videoProbe.height}`);
  }
  if (plan.params.enableSubtitles === true && !subtitle?.ready) {
    blockers.push('missing-editable-srt-sidecar');
  }

  return {
    index,
    candidateId: clip.candidateId,
    outputPath,
    sourceStartMs: clip.sourceStartMs,
    sourceEndMs: clip.sourceEndMs,
    speechStartMs: clip.speechStartMs,
    speechEndMs: clip.speechEndMs,
    sourceSegments: clip.sourceSegments,
    renderedDurationMs: expectedDurationMs,
    removedSilenceMs: clip.removedSilenceMs,
    internalSilenceTrimCount: clip.internalSilenceTrimCount,
    transcriptText: clip.transcriptText,
    transcriptSegments: clip.transcriptSegments,
    transcriptSegmentCount: clip.transcriptSegmentCount,
    speakerIds: normalizeStringArray(clip.speakerIds).length > 0 ? normalizeStringArray(clip.speakerIds) : ['speaker-speaker-1'],
    speakerRoles: normalizeStringArray(clip.speakerRoles).length > 0 ? normalizeStringArray(clip.speakerRoles) : ['speaker'],
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

function assertClipSpeechEvidence(clip, index) {
  if (
    !Number.isFinite(clip.speechStartMs) ||
    !Number.isFinite(clip.speechEndMs) ||
    clip.speechEndMs <= clip.speechStartMs ||
    !String(clip.transcriptText ?? '').trim() ||
    !Array.isArray(clip.transcriptSegments) ||
    clip.transcriptSegments.length === 0
  ) {
    throw new Error(`generic real media clip ${index + 1} lacks speech-boundary transcript evidence`);
  }
}

function createVerificationReport(plan, sourceVideoProbe, renderedClips) {
  const blockers = [];
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
    planningEngine: plan.planningEngine,
    presetId: plan.enginePlan?.presetId ?? 'transcript-assisted',
    renderLimit: plan.renderClipLimit,
    plannedClipCount: plan.plannedClips.length,
    renderedClipCount: renderedClips.length,
    thresholds: {
      maxDurationDeltaMs,
      maxLongOutputSilenceMs,
    },
    plannerBlockers: plan.plannerBlockers,
    ready: blockers.length === 0,
    blockers,
    clips: renderedClips,
  };
}

function writeSmartSliceExecutionEvidencePackage(plan, renderedClips) {
  const evidenceDir = path.join(plan.outputDir, 'evidence');
  const allReviewSegments = plan.plannedClips.map((clip, index) => createReviewSegmentEvidence(clip, index));
  const renderedReviewSegments = allReviewSegments.slice(0, renderedClips.length);
  const selectedSegmentIds = renderedReviewSegments.map((segment) => segment.id);
  const manualEdits = [];
  const segmentationAgent = getAutoCutSmartSliceSegmentationAgentDefinition(plan.params.segmentationAgentId);
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
    taskId: createGenericTaskId(plan.inputPath),
    sourceAssetUuid: plan.sourceAssetUuid,
    sourceDurationMs: plan.sourceDurationMs,
    providerId: 'same-source-whisper-json',
    language: 'auto',
    text: plan.transcriptSegments.map((segment) => segment.text).join(' '),
    segments: plan.transcriptSegments.map((segment, index) => ({
      id: `stt-${String(index + 1).padStart(5, '0')}`,
      startMs: segment.startMs,
      endMs: segment.endMs,
      text: segment.text,
      speaker: normalizeString(segment.speaker) || 'Speaker 1',
    })),
    nativeTranscriptPath: plan.transcriptPath,
    nativeTranscriptTaskUuid: `${createGenericTaskId(plan.inputPath)}-transcript`,
    nativeTranscriptTaskOutputDir: path.dirname(plan.transcriptPath),
    createdAt: plan.generatedAt,
  });
  writeJson(evidenceFiles.semanticSegmentationPath, {
    schema: 'smart-slice.semantic-segmentation.v1',
    taskId: createGenericTaskId(plan.inputPath),
    sourceAssetUuid: plan.sourceAssetUuid,
    sourceDurationMs: plan.sourceDurationMs,
    llmModel: plan.params.llmModel,
    mode: plan.params.mode,
    targetPlatform: plan.params.targetPlatform,
    segmentationDensity: plan.params.segmentationDensity ?? 'default',
    segmentationAgentId: segmentationAgent.id,
    segmentationAgent: {
      id: segmentationAgent.id,
      label: segmentationAgent.label,
      description: segmentationAgent.description,
      systemPrompt: segmentationAgent.systemPrompt,
    },
    planningEngine: plan.planningEngine,
    presetId: plan.enginePlan?.presetId ?? 'transcript-assisted',
    transcriptSegmentCount: plan.transcriptSegments.length,
    contentUnitCount: plan.enginePlan?.llmReviewAudit?.input?.contentUnits?.length ?? plan.plannedClips.length,
    candidateCount: plan.enginePlan?.llmReviewAudit?.input?.candidates?.length ?? plan.plannedClips.length,
    speakerProfileCount: 1,
    speakerSegmentCount: plan.transcriptSegments.length,
    blockers: plan.plannerBlockers,
    transcriptEvidence: plan.enginePlan?.transcriptEvidence ?? { segments: plan.transcriptSegments },
    speakerEvidence: plan.enginePlan?.speakerEvidence ?? createSingleSpeakerEvidence(plan.transcriptSegments),
    ...(plan.enginePlan?.llmReviewAudit ? { llmReviewAudit: plan.enginePlan.llmReviewAudit } : {}),
    clips: plan.plannedClips.map((clip, index) => createSemanticClipEvidence(clip, index)),
    createdAt: plan.generatedAt,
  });
  writeJson(evidenceFiles.reviewSessionPath, {
    schema: 'smart-slice.review-session.v1',
    taskId: createGenericTaskId(plan.inputPath),
    reviewSessionId: `${createGenericTaskId(plan.inputPath)}-review`,
    status: 'rendered',
    sourceAssetUuid: plan.sourceAssetUuid,
    sourceDurationMs: plan.sourceDurationMs,
    segmentationAgentId: segmentationAgent.id,
    segmentCount: allReviewSegments.length,
    selectedSegmentCount: selectedSegmentIds.length,
    duplicateGroupCount: 0,
    manualEditCount: manualEdits.length,
    selectedSegmentIds,
    duplicateGroups: [],
    segments: allReviewSegments,
    createdAt: plan.generatedAt,
  });
  writeJson(evidenceFiles.manualEditsPath, {
    schema: 'smart-slice.manual-edits.v1',
    taskId: createGenericTaskId(plan.inputPath),
    reviewSessionId: `${createGenericTaskId(plan.inputPath)}-review`,
    editCount: manualEdits.length,
    selectedSegmentIds,
    manualEdits,
    segments: allReviewSegments,
    createdAt: plan.generatedAt,
  });
  writeJson(evidenceFiles.reviewEventsPath, {
    schema: 'smart-slice.review-events.v1',
    taskId: createGenericTaskId(plan.inputPath),
    reviewSessionId: `${createGenericTaskId(plan.inputPath)}-review`,
    reviewVersion: manualEdits.length,
    eventCount: 0,
    events: [],
    createdAt: plan.generatedAt,
  });
  writeJson(evidenceFiles.renderSelectionPath, {
    schema: 'smart-slice.render-selection.v1',
    taskId: createGenericTaskId(plan.inputPath),
    reviewSessionId: `${createGenericTaskId(plan.inputPath)}-review`,
    selectedSegmentIds,
    selectedSegmentCount: selectedSegmentIds.length,
    submittedManualEditCount: 0,
    appliedManualEditCount: 0,
    manualEdits,
    selectedSegments: renderedReviewSegments,
    createdAt: plan.generatedAt,
  });
  writeJson(evidenceFiles.renderArtifactManifestPath, {
    schema: 'smart-slice.render-artifact-manifest.v1',
    taskId: createGenericTaskId(plan.inputPath),
    nativeTaskId: `${createGenericTaskId(plan.inputPath)}-render`,
    sourceAssetUuid: plan.sourceAssetUuid,
    sourceDurationMs: plan.sourceDurationMs,
    taskOutputDir: plan.outputDir,
    sliceCount: renderedClips.length,
    subtitleMode: plan.params.subtitleMode ?? 'none',
    subtitleFormat: plan.params.enableSubtitles ? 'srt' : 'none',
    reviewSessionId: `${createGenericTaskId(plan.inputPath)}-review`,
    selectedSegmentIds,
    slices: renderedClips.map((clip, index) => createManifestSliceEvidence(clip, index)),
    createdAt: plan.generatedAt,
  });
  return evidenceFiles;
}

function createSingleSpeakerEvidence(transcriptSegments) {
  return {
    profiles: [{ speakerId: 'speaker-speaker-1', displayName: 'Speaker 1' }],
    segments: transcriptSegments.map((segment, index) => ({
      id: `turn-${index + 1}`,
      speakerId: 'speaker-speaker-1',
      startMs: segment.startMs,
      endMs: segment.endMs,
    })),
  };
}

function createSemanticClipEvidence(clip, index) {
  return {
    index,
    candidateId: clip.candidateId ?? `candidate-${index + 1}`,
    title: clip.title ?? clip.label ?? `Slice ${index + 1}`,
    label: clip.label ?? clip.title ?? `Slice ${index + 1}`,
    startMs: clip.sourceStartMs,
    endMs: clip.sourceEndMs,
    durationMs: Math.max(1, clip.sourceEndMs - clip.sourceStartMs),
    sourceStartMs: clip.sourceStartMs,
    sourceEndMs: clip.sourceEndMs,
    speechStartMs: clip.speechStartMs,
    speechEndMs: clip.speechEndMs,
    contentUnitIds: clip.contentUnitIds ?? [`unit-${index + 1}`],
    speakerIds: normalizeStringArray(clip.speakerIds).length > 0 ? normalizeStringArray(clip.speakerIds) : ['speaker-speaker-1'],
    speakerRoles: normalizeStringArray(clip.speakerRoles).length > 0 ? normalizeStringArray(clip.speakerRoles) : ['speaker'],
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
    id: `segment-${String(index + 1).padStart(4, '0')}`,
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
    id: `slice-${String(index + 1).padStart(4, '0')}`,
    name: path.basename(clip.outputPath),
    title: `Slice ${index + 1}`,
    artifactUuid: `slice-${String(index + 1).padStart(4, '0')}`,
    artifactPath: clip.outputPath,
    url: pathToFileURL(clip.outputPath).href,
    ...(clip.subtitlePath
      ? {
        subtitleArtifactUuid: `slice-${String(index + 1).padStart(4, '0')}-subtitle`,
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
    reviewSegmentIds: [`segment-${String(index + 1).padStart(4, '0')}`],
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
    .sort((first, second) => first.startMs - second.startMs || first.endMs - second.endMs);
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
    throw new Error(`generic real media output silence verification failed for ${outputPath}: ${output.stderr || output.stdout}`);
  }
  return parseSilencedetectIntervals(output.stderr, durationMs)
    .filter((interval) => Number.isFinite(interval.endMs))
    .map((interval) => ({
      ...interval,
      durationMs: Math.max(0, interval.endMs - interval.startMs),
    }));
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
  return intervals;
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

function writeJson(targetPath, value) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(`${targetPath}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(`${targetPath}.tmp`, targetPath);
}

function createGenericTaskId(inputPath) {
  return `generic-media-${path.basename(inputPath).replace(/[^a-z0-9]+/giu, '-').replace(/^-|-$/gu, '').toLowerCase() || 'source'}`;
}

function createGenericSourceAssetUuid(inputPath) {
  return `${createGenericTaskId(inputPath)}-asset`;
}

function normalizeBlockers(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((blocker) => {
    if (typeof blocker === 'string') {
      return { code: 'BLOCKER', message: blocker };
    }
    if (blocker && typeof blocker === 'object') {
      return { ...blocker };
    }
    return { code: 'BLOCKER', message: String(blocker) };
  });
}

function normalizeStringArray(value) {
  return Array.isArray(value) ? value.map((item) => normalizeString(item)).filter(Boolean) : [];
}

function normalizeString(value) {
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

function secondsParamToMs(value, fallbackSeconds) {
  const number = Number(value);
  const seconds = Number.isFinite(number) && number > 0 ? number : fallbackSeconds;
  return Math.max(1, Math.round(seconds * 1_000));
}

function secondsToMs(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 1_000) : undefined;
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

function formatErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function runAutoCutGenericMediaCommand(command, args, { maxBuffer = 64 * 1024 * 1024 } = {}) {
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

function parseArgs(argv) {
  const args = normalizeAutoCutCliArgs(argv);
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--input') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut generic real media Smart Slice check',
      });
      options.inputPath = option.value;
      index = option.nextIndex;
    } else if (arg === '--transcript') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut generic real media Smart Slice check',
      });
      options.transcriptPath = option.value;
      index = option.nextIndex;
    } else if (arg === '--output') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut generic real media Smart Slice check',
      });
      options.outputDir = option.value;
      index = option.nextIndex;
    } else if (arg === '--ffmpeg') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut generic real media Smart Slice check',
      });
      options.ffmpegPath = option.value;
      index = option.nextIndex;
    } else if (arg === '--ffprobe') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut generic real media Smart Slice check',
      });
      options.ffprobePath = option.value;
      index = option.nextIndex;
    } else if (arg === '--profile') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut generic real media Smart Slice check',
      });
      options.profile = option.value;
      index = option.nextIndex;
    } else if (arg === '--render-limit') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut generic real media Smart Slice check',
      });
      options.renderClipLimit = Number(option.value);
      index = option.nextIndex;
    } else {
      throw new Error(`unknown AutoCut generic real media Smart Slice option: ${arg}`);
    }
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  try {
    const result = await runAutoCutGenericRealMediaSliceCheck(parseArgs(process.argv.slice(2)));
    console.log(formatAutoCutGenericRealMediaSliceCheckMessage(result));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
