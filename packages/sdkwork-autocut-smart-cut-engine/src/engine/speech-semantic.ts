import {
  SMART_CUT_DEFAULT_PRODUCT_PRESET_ID,
  SMART_CUT_STANDARD_VERSION,
  type SmartCutCandidate,
  type SmartCutContentUnit,
  type SmartCutPlan,
  type SmartCutTranscriptEvidence,
} from './domain.ts';
import {
  buildSmartCutContentUnits,
  type SmartCutContentUnitBuildReport,
} from './content-units.ts';
import type { SmartCutProductPresetId } from './presets.ts';
import { alignSmartCutTranscriptSpeakers } from './speaker-alignment.ts';
import type { SmartCutSpeakerEvidence, SmartCutSpeakerTurn } from './speaker.ts';

export interface BuildSpeechSemanticContentUnitsInput {
  presetId?: SmartCutProductPresetId;
  transcriptEvidence: SmartCutTranscriptEvidence;
  speakerEvidence: SmartCutSpeakerEvidence;
}

export interface CreateSpeechSemanticSlicePlanInput extends BuildSpeechSemanticContentUnitsInput {
  sourceMediaId: string;
  sourceDurationMs: number;
  presetId: SmartCutProductPresetId;
  maximumCandidateDurationMs?: number;
  maximumCandidateGapMs?: number;
}

export interface SmartCutSpeechSemanticPlan extends SmartCutPlan {
  contentUnitBuildReport: SmartCutContentUnitBuildReport;
}

const minimumPublishabilityScore = 0.68;
const defaultMaximumCandidateGapMs = 1_500;
const maximumDefaultCandidateDurationMs = 90_000;

export function buildSpeechSemanticContentUnits(input: BuildSpeechSemanticContentUnitsInput): readonly SmartCutContentUnit[] {
  return buildSmartCutContentUnits({
    presetId: input.presetId ?? SMART_CUT_DEFAULT_PRODUCT_PRESET_ID,
    transcriptEvidence: input.transcriptEvidence,
    speakerEvidence: input.speakerEvidence,
  }).units;
}

export function buildSpeechSemanticSpeakerTurns(input: BuildSpeechSemanticContentUnitsInput): readonly SmartCutSpeakerTurn[] {
  if (input.speakerEvidence.turns.length > 0) {
    return [...input.speakerEvidence.turns].sort(compareTimeRanges);
  }

  return alignSmartCutTranscriptSpeakers({
    transcriptEvidence: input.transcriptEvidence,
    speakerEvidence: input.speakerEvidence,
  }).speakerEvidence.turns;
}

export function createSpeechSemanticSlicePlan(input: CreateSpeechSemanticSlicePlanInput): SmartCutSpeechSemanticPlan {
  const contentUnitBuild = buildSmartCutContentUnits({
    presetId: input.presetId,
    transcriptEvidence: input.transcriptEvidence,
    speakerEvidence: input.speakerEvidence,
  });
  const publishableUnits = contentUnitBuild.units
    .filter((unit) => unit.publishabilityScore >= minimumPublishabilityScore)
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  const candidates = contentUnitBuild.ready
    ? createSpeechSemanticCandidates({
      presetId: input.presetId,
      sourceDurationMs: input.sourceDurationMs,
      units: publishableUnits,
      ...(input.maximumCandidateDurationMs !== undefined
        ? { maximumCandidateDurationMs: input.maximumCandidateDurationMs }
        : {}),
      ...(input.maximumCandidateGapMs !== undefined
        ? { maximumCandidateGapMs: input.maximumCandidateGapMs }
        : {}),
    })
    : [];

  return {
    id: `speech-semantic-plan-${input.sourceMediaId}`,
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    sourceMediaId: input.sourceMediaId,
    presetId: input.presetId,
    candidates,
    contentUnitBuildReport: contentUnitBuild.report,
  };
}

interface CreateSpeechSemanticCandidatesInput {
  presetId: SmartCutProductPresetId;
  sourceDurationMs: number;
  units: readonly SmartCutContentUnit[];
  maximumCandidateDurationMs?: number;
  maximumCandidateGapMs?: number;
}

function createSpeechSemanticCandidates(input: CreateSpeechSemanticCandidatesInput): readonly SmartCutCandidate[] {
  if (input.units.length === 0) {
    return [];
  }

  if (input.presetId === 'interview-one-question-one-answer') {
    return createQuestionAnswerCandidates(input.units, input.sourceDurationMs, {
      minimumDurationMs: 0,
      maximumGapMs: input.maximumCandidateGapMs ?? defaultMaximumCandidateGapMs,
    });
  }

  if (input.presetId === 'long-interview-matrix') {
    return createQuestionAnswerCandidates(input.units, input.sourceDurationMs, {
      minimumDurationMs: 60_000,
      maximumGapMs: input.maximumCandidateGapMs ?? defaultMaximumCandidateGapMs,
    });
  }

  return createContiguousSpeechCandidates(
    input.units,
    input.sourceDurationMs,
    input.maximumCandidateDurationMs ?? maximumDefaultCandidateDurationMs,
    input.maximumCandidateGapMs ?? defaultMaximumCandidateGapMs,
  );
}

function createQuestionAnswerCandidates(
  units: readonly SmartCutContentUnit[],
  sourceDurationMs: number,
  options: {
    minimumDurationMs: number;
    maximumGapMs: number;
  },
): readonly SmartCutCandidate[] {
  const candidates: SmartCutCandidate[] = [];
  for (let index = 0; index < units.length;) {
    const unit = units[index];
    const nextUnit = units[index + 1];
    if (unit === undefined || nextUnit === undefined) {
      index += 1;
      continue;
    }
    const unitText = unit.text ?? '';
    const nextText = nextUnit.text ?? '';
    if (!isQuestionText(unitText) || isQuestionText(nextText)) {
      index += 1;
      continue;
    }
    const mergedUnits = collectQuestionAnswerCandidateUnits(units, index, options.minimumDurationMs, options.maximumGapMs);
    candidates.push(createCandidateFromUnits({
      index: candidates.length,
      units: mergedUnits,
      sourceDurationMs,
      reason: 'Complete question and answer semantic unit.',
      slicerId: 'dialogue-qa',
    }));
    index += Math.max(1, mergedUnits.length);
  }

  if (candidates.length > 0) {
    return candidates;
  }

  return createContiguousSpeechCandidates(units, sourceDurationMs, maximumDefaultCandidateDurationMs, options.maximumGapMs);
}

function createContiguousSpeechCandidates(
  units: readonly SmartCutContentUnit[],
  sourceDurationMs: number,
  maximumDurationMs: number,
  maximumGapMs: number,
): readonly SmartCutCandidate[] {
  const candidates: SmartCutCandidate[] = [];
  let currentUnits: SmartCutContentUnit[] = [];

  for (const unit of units) {
    const currentStartMs = currentUnits[0]?.startMs ?? unit.startMs;
    const currentEndMs = currentUnits.at(-1)?.endMs ?? unit.startMs;
    const gapMs = unit.startMs - currentEndMs;
    const wouldExceedDuration = unit.endMs - currentStartMs > maximumDurationMs;
    if (currentUnits.length > 0 && (gapMs > maximumGapMs || wouldExceedDuration)) {
      candidates.push(createCandidateFromUnits({
        index: candidates.length,
        units: currentUnits,
        sourceDurationMs,
        reason: 'Contiguous complete speech semantic unit.',
        slicerId: 'speech-semantic',
      }));
      currentUnits = [];
    }
    currentUnits.push(unit);
  }

  if (currentUnits.length > 0) {
    candidates.push(createCandidateFromUnits({
      index: candidates.length,
      units: currentUnits,
      sourceDurationMs,
      reason: 'Contiguous complete speech semantic unit.',
      slicerId: 'speech-semantic',
    }));
  }

  return candidates;
}

function createCandidateFromUnits({
  index,
  units,
  sourceDurationMs,
  reason,
  slicerId,
}: {
  index: number;
  units: readonly SmartCutContentUnit[];
  sourceDurationMs: number;
  reason: string;
  slicerId: 'speech-semantic' | 'dialogue-qa';
}): SmartCutCandidate {
  const firstUnit = units[0];
  const lastUnit = units.at(-1);
  if (firstUnit === undefined || lastUnit === undefined) {
    throw new Error('Cannot create speech semantic candidate without content units.');
  }
  const startMs = Math.max(0, firstUnit.startMs);
  const endMs = Math.min(sourceDurationMs, lastUnit.endMs);
  const averageScore = units.reduce((sum, unit) => sum + unit.publishabilityScore, 0) / units.length;
  const title = createCandidateTitle(units);

  return {
    id: `speech-semantic-candidate-${index + 1}`,
    slicerId,
    startMs,
    endMs,
    unitIds: units.map((unit) => unit.id),
    title,
    reason,
    confidence: roundScore(averageScore),
    risks: [],
  };
}

function collectQuestionAnswerCandidateUnits(
  units: readonly SmartCutContentUnit[],
  startIndex: number,
  minimumDurationMs: number,
  maximumGapMs: number,
): readonly SmartCutContentUnit[] {
  const collected: SmartCutContentUnit[] = [];
  for (let index = startIndex; index < units.length; index += 1) {
    const unit = units[index];
    if (unit === undefined) {
      continue;
    }
    const previousUnit = collected.at(-1);
    if (previousUnit !== undefined && unit.startMs - previousUnit.endMs > maximumGapMs) {
      break;
    }
    collected.push(unit);
    const firstUnit = collected[0];
    const durationMs = firstUnit === undefined ? 0 : unit.endMs - firstUnit.startMs;
    if (collected.length >= 2 && durationMs >= minimumDurationMs) {
      break;
    }
  }
  return collected;
}

function createCandidateTitle(units: readonly SmartCutContentUnit[]): string {
  const text = normalizeSpeechSemanticText(units.map((unit) => unit.text ?? '').join(' '));
  const trimmed = text.length > 56 ? text.slice(0, 56) : text;
  return trimmed || 'Speech semantic clip';
}

function compareTimeRanges(
  left: { startMs: number; endMs: number },
  right: { startMs: number; endMs: number },
): number {
  return left.startMs - right.startMs || left.endMs - right.endMs;
}

function normalizeSpeechSemanticText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

function isQuestionText(text: string): boolean {
  const normalized = normalizeSpeechSemanticText(text);
  return /[?\uFF1F]\s*$/u.test(normalized) ||
    /^(?:when|what|why|how|who|where|which|should|can|could|would|is|are|do|does)\b/iu.test(normalized);
}

function roundScore(score: number): number {
  return Math.round(score * 100) / 100;
}
