import type {
  SmartCutCandidate,
  SmartCutContentUnit,
  SmartCutTimeRange,
} from './domain.ts';
import type { SmartCutFilterId } from './filters.ts';
import type { SmartCutPostSliceFilterPlan } from './filter-plan.ts';
import {
  SMART_CUT_PRODUCT_PRESET_REGISTRY,
  type SmartCutProductPresetDefinition,
  type SmartCutProductPresetId,
} from './presets.ts';

export type SmartCutFilterEffectKind =
  | 'range-trim'
  | 'range-remove'
  | 'repeat-deduplicate'
  | 'media-transform'
  | 'packaging-transform';

export interface SmartCutFilterEffect extends SmartCutTimeRangeEffect {
  id: string;
  filterId: SmartCutFilterId;
  candidateId: string;
  stepIndex: number;
  kind: SmartCutFilterEffectKind;
  destructive: boolean;
  retainedUnitIds: readonly string[];
  removedUnitIds: readonly string[];
  affectedSpeakerIds: readonly string[];
  reason: string;
}

export interface SmartCutTimeRangeEffect {
  sourceRanges: readonly SmartCutTimeRange[];
  outputRanges: readonly SmartCutTimeRange[];
}

export interface SmartCutRemovedSourceRange extends SmartCutTimeRange {
  filterId: SmartCutFilterId;
  reason: string;
}

export interface SmartCutFilteredCandidate {
  id: string;
  sourceCandidateId: string;
  retainedSourceRanges: readonly SmartCutTimeRange[];
  removedSourceRanges: readonly SmartCutRemovedSourceRange[];
  durationMs: number;
  unitIds: readonly string[];
  speakerIds: readonly string[];
  transcriptSegmentIds: readonly string[];
  appliedEffectIds: readonly string[];
}

export interface SmartCutFilterEffectValidationInput {
  presetId: SmartCutProductPresetId;
  filterPlan: SmartCutPostSliceFilterPlan;
  sourceCandidates: readonly SmartCutCandidate[];
  contentUnits: readonly SmartCutContentUnit[];
  filteredCandidates: readonly SmartCutFilteredCandidate[];
  effects: readonly SmartCutFilterEffect[];
}

export type SmartCutFilterEffectBlockerCode =
  | 'UNKNOWN_PRESET'
  | 'FILTER_PLAN_PRESET_MISMATCH'
  | 'FILTER_PLAN_SOURCE_CANDIDATE_MISMATCH'
  | 'NO_FILTERED_CANDIDATES'
  | 'FILTER_EFFECT_ID_MISSING'
  | 'DUPLICATE_FILTER_EFFECT_ID'
  | 'FILTERED_CANDIDATE_ID_MISSING'
  | 'DUPLICATE_FILTERED_CANDIDATE_ID'
  | 'DUPLICATE_FILTERED_OUTPUT_FOR_SOURCE_CANDIDATE'
  | 'MISSING_FILTERED_OUTPUT_FOR_SOURCE_CANDIDATE'
  | 'UNKNOWN_SOURCE_CANDIDATE'
  | 'FILTERED_CANDIDATE_NOT_IN_FILTER_PLAN'
  | 'FILTERED_CANDIDATE_INVALID_DURATION'
  | 'FILTERED_DURATION_BELOW_PRESET_MINIMUM'
  | 'FILTERED_DURATION_ABOVE_PRESET_MAXIMUM'
  | 'FILTERED_CANDIDATE_WITHOUT_RETAINED_RANGES'
  | 'FILTERED_RANGE_OUTSIDE_SOURCE_CANDIDATE'
  | 'FILTERED_RANGE_DOES_NOT_COVER_UNIT'
  | 'FILTERED_REMOVED_RANGE_INVALID'
  | 'FILTERED_REMOVED_RANGE_OUTSIDE_SOURCE_CANDIDATE'
  | 'FILTERED_REMOVED_RANGE_FILTER_NOT_IN_PLAN'
  | 'FILTERED_REMOVED_RANGE_REASON_MISSING'
  | 'FILTERED_REMOVED_RANGE_OVERLAPS_UNIT'
  | 'FILTERED_CANDIDATE_MISSING_REQUIRED_UNIT'
  | 'FILTERED_CANDIDATE_UNKNOWN_UNIT'
  | 'FILTERED_CANDIDATE_UNIT_OUTSIDE_SOURCE'
  | 'FILTERED_CANDIDATE_MISSING_SPEAKER'
  | 'FILTERED_CANDIDATE_SPEAKER_OUTSIDE_SOURCE'
  | 'FILTERED_CANDIDATE_MISSING_TRANSCRIPT_SEGMENT'
  | 'FILTERED_CANDIDATE_TRANSCRIPT_SEGMENT_OUTSIDE_SOURCE'
  | 'FILTERED_CANDIDATE_UNKNOWN_EFFECT'
  | 'FILTERED_CANDIDATE_DUPLICATE_APPLIED_EFFECT'
  | 'FILTERED_CANDIDATE_EFFECT_SOURCE_MISMATCH'
  | 'FILTER_EFFECT_WITHOUT_PLAN_STEP'
  | 'FILTER_EFFECT_UNKNOWN_CANDIDATE'
  | 'FILTER_EFFECT_DESTRUCTIVE_MISMATCH'
  | 'FILTER_EFFECT_REASON_MISSING'
  | 'FILTER_EFFECT_MISSING_RETAINED_UNIT'
  | 'FILTER_EFFECT_UNIT_OUTSIDE_SOURCE'
  | 'FILTER_EFFECT_SPEAKER_OUTSIDE_SOURCE'
  | 'FILTER_EFFECT_REMOVES_SEMANTIC_UNIT'
  | 'FILTER_EFFECT_INVALID_RANGE'
  | 'FILTER_EFFECT_RANGE_OUTSIDE_CANDIDATE';

export interface SmartCutFilterEffectBlocker {
  code: SmartCutFilterEffectBlockerCode;
  message: string;
  candidateId?: string;
  filteredCandidateId?: string;
  effectId?: string;
  unitId?: string;
  speakerId?: string;
  remediation: string;
}

export interface SmartCutFilterEffectCandidateReport {
  filteredCandidateId: string;
  sourceCandidateId: string;
  preservedUnitIds: readonly string[];
  missingUnitIds: readonly string[];
  preservedSpeakerIds: readonly string[];
  missingSpeakerIds: readonly string[];
  durationMs: number;
  blockerCodes: readonly SmartCutFilterEffectBlockerCode[];
}

export interface SmartCutFilterEffectValidationReport {
  ready: boolean;
  blockers: readonly SmartCutFilterEffectBlocker[];
  candidateReports: readonly SmartCutFilterEffectCandidateReport[];
  filteredCandidateCount: number;
  effectCount: number;
}

export function validateSmartCutFilterEffects(
  input: SmartCutFilterEffectValidationInput,
): SmartCutFilterEffectValidationReport {
  const blockers: SmartCutFilterEffectBlocker[] = [];
  const candidateReports: SmartCutFilterEffectCandidateReport[] = [];
  const preset = SMART_CUT_PRODUCT_PRESET_REGISTRY.find((entry) => entry.id === input.presetId);
  const sourceCandidateById = new Map(input.sourceCandidates.map((candidate) => [candidate.id, candidate]));
  const contentUnitById = new Map(input.contentUnits.map((unit) => [unit.id, unit]));
  const effectById = new Map(input.effects.map((effect) => [effect.id, effect]));

  if (preset === undefined) {
    blockers.push({
      code: 'UNKNOWN_PRESET',
      message: `Unknown smart cut product preset: ${input.presetId}.`,
      remediation: 'Validate filter effects against a registered smart cut product preset.',
    });
  } else if (input.filterPlan.presetId !== input.presetId) {
    blockers.push({
      code: 'FILTER_PLAN_PRESET_MISMATCH',
      message: `Filter plan preset ${input.filterPlan.presetId} does not match validation preset ${input.presetId}.`,
      remediation: 'Use the filter plan generated for the same product preset as the filtered output.',
    });
  }

  if (input.filteredCandidates.length === 0) {
    blockers.push({
      code: 'NO_FILTERED_CANDIDATES',
      message: 'Filter effect validation received no filtered candidates.',
      remediation: 'Validate the native filtered output before render packaging.',
    });
  }

  validateFilterEffectIdentities(input.effects, blockers);
  validateFilteredCandidateIdentities(input.filteredCandidates, input.filterPlan, blockers);

  for (const candidate of input.sourceCandidates) {
    if (!input.filterPlan.candidateIds.includes(candidate.id)) {
      blockers.push({
        code: 'FILTER_PLAN_SOURCE_CANDIDATE_MISMATCH',
        message: `Source candidate ${candidate.id} is not listed in filter plan ${input.filterPlan.id}.`,
        candidateId: candidate.id,
        remediation: 'Create filter plans from selected candidates and validate only those candidates.',
      });
    }
  }

  for (const effect of input.effects) {
    validateFilterEffect(effect, input.filterPlan, sourceCandidateById, contentUnitById, blockers);
  }

  for (const filteredCandidate of input.filteredCandidates) {
    const candidateBlockers: SmartCutFilterEffectBlocker[] = [];
    const sourceCandidate = sourceCandidateById.get(filteredCandidate.sourceCandidateId);

    if (sourceCandidate === undefined) {
      candidateBlockers.push({
        code: 'UNKNOWN_SOURCE_CANDIDATE',
        message: `Filtered candidate ${filteredCandidate.id} references unknown source candidate ${filteredCandidate.sourceCandidateId}.`,
        filteredCandidateId: filteredCandidate.id,
        candidateId: filteredCandidate.sourceCandidateId,
        remediation: 'Only validate filtered outputs produced from selected source candidates.',
      });
    } else {
      validateFilteredCandidate(
        filteredCandidate,
        sourceCandidate,
        contentUnitById,
        effectById,
        input.filterPlan,
        preset,
        candidateBlockers,
      );
    }

    blockers.push(...candidateBlockers);
    candidateReports.push(createFilterEffectCandidateReport(filteredCandidate, sourceCandidate, contentUnitById, candidateBlockers));
  }

  return {
    ready: blockers.length === 0,
    blockers,
    candidateReports,
    filteredCandidateCount: input.filteredCandidates.length,
    effectCount: input.effects.length,
  };
}

function validateFilterEffectIdentities(
  effects: readonly SmartCutFilterEffect[],
  blockers: SmartCutFilterEffectBlocker[],
) {
  const seen = new Set<string>();
  const reportedDuplicates = new Set<string>();

  for (const effect of effects) {
    if (effect.id.trim().length === 0) {
      blockers.push({
        code: 'FILTER_EFFECT_ID_MISSING',
        message: 'Filter effect report contains an effect without a stable id.',
        candidateId: effect.candidateId,
        remediation: 'Native filter output must assign a stable non-empty id to every effect.',
      });
      continue;
    }

    if (seen.has(effect.id)) {
      if (!reportedDuplicates.has(effect.id)) {
        blockers.push({
          code: 'DUPLICATE_FILTER_EFFECT_ID',
          message: `Filter effect report contains duplicate effect id ${effect.id}.`,
          candidateId: effect.candidateId,
          effectId: effect.id,
          remediation: 'Native filter output must keep effect ids globally unique within one validation report.',
        });
        reportedDuplicates.add(effect.id);
      }
      continue;
    }

    seen.add(effect.id);
  }
}

function validateFilteredCandidateIdentities(
  filteredCandidates: readonly SmartCutFilteredCandidate[],
  filterPlan: SmartCutPostSliceFilterPlan,
  blockers: SmartCutFilterEffectBlocker[],
) {
  const seenFilteredCandidateIds = new Set<string>();
  const reportedDuplicateFilteredCandidateIds = new Set<string>();
  const seenSourceCandidateIds = new Set<string>();
  const reportedDuplicateSourceCandidateIds = new Set<string>();

  for (const filteredCandidate of filteredCandidates) {
    if (filteredCandidate.id.trim().length === 0) {
      blockers.push({
        code: 'FILTERED_CANDIDATE_ID_MISSING',
        message: 'Filtered candidate report contains an output without a stable id.',
        candidateId: filteredCandidate.sourceCandidateId,
        remediation: 'Native filter output must assign a stable non-empty id to every filtered candidate.',
      });
    } else if (seenFilteredCandidateIds.has(filteredCandidate.id)) {
      if (!reportedDuplicateFilteredCandidateIds.has(filteredCandidate.id)) {
        blockers.push({
          code: 'DUPLICATE_FILTERED_CANDIDATE_ID',
          message: `Filtered candidate report contains duplicate filtered candidate id ${filteredCandidate.id}.`,
          candidateId: filteredCandidate.sourceCandidateId,
          filteredCandidateId: filteredCandidate.id,
          remediation: 'Native filter output must keep filtered candidate ids globally unique within one validation report.',
        });
        reportedDuplicateFilteredCandidateIds.add(filteredCandidate.id);
      }
    } else {
      seenFilteredCandidateIds.add(filteredCandidate.id);
    }

    if (filteredCandidate.sourceCandidateId.trim().length === 0) {
      continue;
    }

    if (seenSourceCandidateIds.has(filteredCandidate.sourceCandidateId)) {
      if (!reportedDuplicateSourceCandidateIds.has(filteredCandidate.sourceCandidateId)) {
        blockers.push({
          code: 'DUPLICATE_FILTERED_OUTPUT_FOR_SOURCE_CANDIDATE',
          message: `Source candidate ${filteredCandidate.sourceCandidateId} produced multiple filtered outputs.`,
          candidateId: filteredCandidate.sourceCandidateId,
          filteredCandidateId: filteredCandidate.id,
          remediation: 'Post-slice filtering must produce exactly one filtered output per approved source candidate.',
        });
        reportedDuplicateSourceCandidateIds.add(filteredCandidate.sourceCandidateId);
      }
      continue;
    }

    seenSourceCandidateIds.add(filteredCandidate.sourceCandidateId);
  }

  for (const candidateId of filterPlan.candidateIds) {
    if (candidateId.trim().length === 0) {
      continue;
    }

    if (!seenSourceCandidateIds.has(candidateId)) {
      blockers.push({
        code: 'MISSING_FILTERED_OUTPUT_FOR_SOURCE_CANDIDATE',
        message: `Source candidate ${candidateId} has no filtered output in native filter report.`,
        candidateId,
        remediation: 'Post-slice filtering must return exactly one filtered output for every candidate in the approved filter plan.',
      });
    }
  }
}

function validateFilterEffect(
  effect: SmartCutFilterEffect,
  filterPlan: SmartCutPostSliceFilterPlan,
  sourceCandidateById: ReadonlyMap<string, SmartCutCandidate>,
  contentUnitById: ReadonlyMap<string, SmartCutContentUnit>,
  blockers: SmartCutFilterEffectBlocker[],
) {
  const planStep = filterPlan.steps.find((step) =>
    step.index === effect.stepIndex &&
    step.filterId === effect.filterId
  );
  if (planStep === undefined) {
    blockers.push({
      code: 'FILTER_EFFECT_WITHOUT_PLAN_STEP',
      message: `Filter effect ${effect.id} references ${effect.filterId} at step ${effect.stepIndex}, which is not in filter plan ${filterPlan.id}.`,
      candidateId: effect.candidateId,
      effectId: effect.id,
      remediation: 'Native filter output must report only filter steps from the post-slice filter plan.',
    });
  } else if (planStep.destructive !== effect.destructive) {
    blockers.push({
      code: 'FILTER_EFFECT_DESTRUCTIVE_MISMATCH',
      message: `Filter effect ${effect.id} destructive=${effect.destructive} does not match plan step destructive=${planStep.destructive}.`,
      candidateId: effect.candidateId,
      effectId: effect.id,
      remediation: 'Native filter output must preserve destructive metadata from the filter registry.',
    });
  }

  if (effect.reason.trim().length === 0) {
    blockers.push({
      code: 'FILTER_EFFECT_REASON_MISSING',
      message: `Filter effect ${effect.id} has no audit reason.`,
      candidateId: effect.candidateId,
      effectId: effect.id,
      remediation: 'Native filter output must explain every media mutation for audit and replay.',
    });
  }

  const sourceCandidate = sourceCandidateById.get(effect.candidateId);
  if (sourceCandidate === undefined) {
    blockers.push({
      code: 'FILTER_EFFECT_UNKNOWN_CANDIDATE',
      message: `Filter effect ${effect.id} references unknown candidate ${effect.candidateId}.`,
      candidateId: effect.candidateId,
      effectId: effect.id,
      remediation: 'Native filter effects must reference selected source candidate ids.',
    });
    return;
  }

  validateEffectSourceMembership(effect, sourceCandidate, contentUnitById, blockers);

  for (const unitId of sourceCandidate.unitIds) {
    if (!effect.retainedUnitIds.includes(unitId)) {
      blockers.push({
        code: 'FILTER_EFFECT_MISSING_RETAINED_UNIT',
        message: `Filter effect ${effect.id} does not retain semantic unit ${unitId}.`,
        candidateId: effect.candidateId,
        effectId: effect.id,
        unitId,
        remediation: 'Post-slice filters must explicitly retain every approved semantic unit.',
      });
    }
  }

  if (effect.removedUnitIds.length > 0) {
    for (const removedUnitId of effect.removedUnitIds) {
      blockers.push({
        code: 'FILTER_EFFECT_REMOVES_SEMANTIC_UNIT',
        message: `Filter effect ${effect.id} removes semantic unit ${removedUnitId}.`,
        candidateId: effect.candidateId,
        effectId: effect.id,
        unitId: removedUnitId,
        remediation: 'Semantic units must be excluded before candidate approval, not deleted by post-slice media filters.',
      });
    }
  }

  validateEffectRanges(effect, sourceCandidate, blockers);
}

function validateEffectSourceMembership(
  effect: SmartCutFilterEffect,
  sourceCandidate: SmartCutCandidate,
  contentUnitById: ReadonlyMap<string, SmartCutContentUnit>,
  blockers: SmartCutFilterEffectBlocker[],
) {
  const allowedUnitIds = new Set(sourceCandidate.unitIds);
  const allowedSpeakerIds = new Set(collectRequiredSpeakerIds(sourceCandidate, contentUnitById));

  for (const unitId of [...effect.retainedUnitIds, ...effect.removedUnitIds]) {
    if (!allowedUnitIds.has(unitId)) {
      blockers.push({
        code: 'FILTER_EFFECT_UNIT_OUTSIDE_SOURCE',
        message: `Filter effect ${effect.id} references unit ${unitId}, which is outside source candidate ${sourceCandidate.id}.`,
        candidateId: effect.candidateId,
        effectId: effect.id,
        unitId,
        remediation: 'Filter effects may retain or remove only semantic unit ids from the approved source candidate.',
      });
    }
  }

  for (const speakerId of effect.affectedSpeakerIds) {
    if (!allowedSpeakerIds.has(speakerId)) {
      blockers.push({
        code: 'FILTER_EFFECT_SPEAKER_OUTSIDE_SOURCE',
        message: `Filter effect ${effect.id} references speaker ${speakerId}, which is outside source candidate ${sourceCandidate.id}.`,
        candidateId: effect.candidateId,
        effectId: effect.id,
        speakerId,
        remediation: 'Filter effects may affect only speakers required by the approved source candidate units.',
      });
    }
  }
}

function validateEffectRanges(
  effect: SmartCutFilterEffect,
  sourceCandidate: SmartCutCandidate,
  blockers: SmartCutFilterEffectBlocker[],
) {
  for (const range of [...effect.sourceRanges, ...effect.outputRanges]) {
    if (!isValidPositiveRange(range)) {
      blockers.push({
        code: 'FILTER_EFFECT_INVALID_RANGE',
        message: `Filter effect ${effect.id} has invalid range ${range.startMs}-${range.endMs}.`,
        candidateId: effect.candidateId,
        effectId: effect.id,
        remediation: 'Report integer millisecond ranges with positive duration for every filter effect.',
      });
      continue;
    }

    if (!rangeInside(range, sourceCandidate)) {
      blockers.push({
        code: 'FILTER_EFFECT_RANGE_OUTSIDE_CANDIDATE',
        message: `Filter effect ${effect.id} range ${range.startMs}-${range.endMs} is outside source candidate ${sourceCandidate.id}.`,
        candidateId: effect.candidateId,
        effectId: effect.id,
        remediation: 'Filter effects may mutate only inside validated source candidate ranges.',
      });
    }
  }
}

function validateFilteredCandidate(
  filteredCandidate: SmartCutFilteredCandidate,
  sourceCandidate: SmartCutCandidate,
  contentUnitById: ReadonlyMap<string, SmartCutContentUnit>,
  effectById: ReadonlyMap<string, SmartCutFilterEffect>,
  filterPlan: SmartCutPostSliceFilterPlan,
  preset: SmartCutProductPresetDefinition | undefined,
  blockers: SmartCutFilterEffectBlocker[],
) {
  if (!filterPlan.candidateIds.includes(sourceCandidate.id)) {
    blockers.push({
      code: 'FILTERED_CANDIDATE_NOT_IN_FILTER_PLAN',
      message: `Filtered candidate ${filteredCandidate.id} source candidate ${sourceCandidate.id} is not in filter plan ${filterPlan.id}.`,
      candidateId: sourceCandidate.id,
      filteredCandidateId: filteredCandidate.id,
      remediation: 'Only accept native filtered outputs for candidates listed in the filter plan.',
    });
  }

  validateFilteredDuration(filteredCandidate, sourceCandidate, preset, blockers);
  validateFilteredRanges(filteredCandidate, sourceCandidate, contentUnitById, filterPlan, blockers);
  validateFilteredUnits(filteredCandidate, sourceCandidate, contentUnitById, blockers);
  validateFilteredSpeakers(filteredCandidate, sourceCandidate, contentUnitById, blockers);
  validateFilteredTranscriptSegments(filteredCandidate, sourceCandidate, contentUnitById, blockers);
  validateAppliedEffects(filteredCandidate, effectById, filterPlan, blockers);
}

function validateFilteredDuration(
  filteredCandidate: SmartCutFilteredCandidate,
  sourceCandidate: SmartCutCandidate,
  preset: SmartCutProductPresetDefinition | undefined,
  blockers: SmartCutFilterEffectBlocker[],
) {
  if (!Number.isInteger(filteredCandidate.durationMs) || filteredCandidate.durationMs <= 0) {
    blockers.push({
      code: 'FILTERED_CANDIDATE_INVALID_DURATION',
      message: `Filtered candidate ${filteredCandidate.id} has invalid duration ${filteredCandidate.durationMs}.`,
      candidateId: sourceCandidate.id,
      filteredCandidateId: filteredCandidate.id,
      remediation: 'Native filter output must report a positive integer millisecond duration.',
    });
    return;
  }

  const minDurationMs = preset?.outputProfile.minDurationMs;
  if (minDurationMs !== undefined && filteredCandidate.durationMs < minDurationMs) {
    blockers.push({
      code: 'FILTERED_DURATION_BELOW_PRESET_MINIMUM',
      message: `Filtered candidate ${filteredCandidate.id} duration ${filteredCandidate.durationMs}ms is below preset minimum ${minDurationMs}ms.`,
      candidateId: sourceCandidate.id,
      filteredCandidateId: filteredCandidate.id,
      remediation: 'Do not over-trim selected content; merge complete units before filtering or reject the output.',
    });
  }

  const maxDurationMs = preset?.outputProfile.maxDurationMs;
  if (maxDurationMs !== undefined && filteredCandidate.durationMs > maxDurationMs) {
    blockers.push({
      code: 'FILTERED_DURATION_ABOVE_PRESET_MAXIMUM',
      message: `Filtered candidate ${filteredCandidate.id} duration ${filteredCandidate.durationMs}ms exceeds preset maximum ${maxDurationMs}ms.`,
      candidateId: sourceCandidate.id,
      filteredCandidateId: filteredCandidate.id,
      remediation: 'Render only filtered outputs that still satisfy the product duration contract.',
    });
  }
}

function validateFilteredRanges(
  filteredCandidate: SmartCutFilteredCandidate,
  sourceCandidate: SmartCutCandidate,
  contentUnitById: ReadonlyMap<string, SmartCutContentUnit>,
  filterPlan: SmartCutPostSliceFilterPlan,
  blockers: SmartCutFilterEffectBlocker[],
) {
  if (filteredCandidate.retainedSourceRanges.length === 0) {
    blockers.push({
      code: 'FILTERED_CANDIDATE_WITHOUT_RETAINED_RANGES',
      message: `Filtered candidate ${filteredCandidate.id} has no retained source ranges.`,
      candidateId: sourceCandidate.id,
      filteredCandidateId: filteredCandidate.id,
      remediation: 'Native filtered output must report the source ranges retained after post-slice filtering.',
    });
  }

  for (const range of filteredCandidate.retainedSourceRanges) {
    if (!isValidPositiveRange(range) || !rangeInside(range, sourceCandidate)) {
      blockers.push({
        code: 'FILTERED_RANGE_OUTSIDE_SOURCE_CANDIDATE',
        message: `Filtered candidate ${filteredCandidate.id} retained range ${range.startMs}-${range.endMs} is outside source candidate ${sourceCandidate.id}.`,
        candidateId: sourceCandidate.id,
        filteredCandidateId: filteredCandidate.id,
        remediation: 'Retained ranges must stay inside the already approved semantic candidate.',
      });
    }
  }

  for (const range of filteredCandidate.removedSourceRanges) {
    if (!isValidPositiveRange(range)) {
      blockers.push({
        code: 'FILTERED_REMOVED_RANGE_INVALID',
        message: `Filtered candidate ${filteredCandidate.id} removed range ${range.startMs}-${range.endMs} is invalid.`,
        candidateId: sourceCandidate.id,
        filteredCandidateId: filteredCandidate.id,
        remediation: 'Removed source ranges must be positive integer millisecond intervals.',
      });
      continue;
    }

    if (!rangeInside(range, sourceCandidate)) {
      blockers.push({
        code: 'FILTERED_REMOVED_RANGE_OUTSIDE_SOURCE_CANDIDATE',
        message: `Filtered candidate ${filteredCandidate.id} removed range ${range.startMs}-${range.endMs} is outside source candidate ${sourceCandidate.id}.`,
        candidateId: sourceCandidate.id,
        filteredCandidateId: filteredCandidate.id,
        remediation: 'Post-slice filters may remove media only inside the approved source candidate interval.',
      });
    }

    if (!filterPlan.steps.some((step) => step.filterId === range.filterId)) {
      blockers.push({
        code: 'FILTERED_REMOVED_RANGE_FILTER_NOT_IN_PLAN',
        message: `Filtered candidate ${filteredCandidate.id} removed range references filter ${range.filterId}, which is not in filter plan ${filterPlan.id}.`,
        candidateId: sourceCandidate.id,
        filteredCandidateId: filteredCandidate.id,
        remediation: 'Removed source ranges must be attributed only to filters from the approved filter plan.',
      });
    }

    if (range.reason.trim().length === 0) {
      blockers.push({
        code: 'FILTERED_REMOVED_RANGE_REASON_MISSING',
        message: `Filtered candidate ${filteredCandidate.id} removed range ${range.startMs}-${range.endMs} has no reason.`,
        candidateId: sourceCandidate.id,
        filteredCandidateId: filteredCandidate.id,
        remediation: 'Every removed range must carry an audit reason from the native filter engine.',
      });
    }

    for (const unitId of sourceCandidate.unitIds) {
      const unit = contentUnitById.get(unitId);
      if (unit === undefined) {
        continue;
      }

      if (rangesOverlap(range, unit)) {
        blockers.push({
          code: 'FILTERED_REMOVED_RANGE_OVERLAPS_UNIT',
          message: `Filtered candidate ${filteredCandidate.id} removed range ${range.startMs}-${range.endMs} overlaps approved unit ${unitId}.`,
          candidateId: sourceCandidate.id,
          filteredCandidateId: filteredCandidate.id,
          unitId,
          remediation: 'Post-slice filters may remove only non-semantic gaps; content-unit ranges must remain intact.',
        });
      }
    }
  }

  for (const unitId of sourceCandidate.unitIds) {
    const unit = contentUnitById.get(unitId);
    if (unit === undefined || !filteredCandidate.unitIds.includes(unitId)) {
      continue;
    }
    if (!filteredCandidate.retainedSourceRanges.some((range) => rangeCovers(range, unit))) {
      blockers.push({
        code: 'FILTERED_RANGE_DOES_NOT_COVER_UNIT',
        message: `Filtered candidate ${filteredCandidate.id} does not retain the full range for unit ${unitId}.`,
        candidateId: sourceCandidate.id,
        filteredCandidateId: filteredCandidate.id,
        unitId,
        remediation: 'Post-filter output must preserve complete content-unit time ranges or fail revalidation.',
      });
    }
  }
}

function validateFilteredUnits(
  filteredCandidate: SmartCutFilteredCandidate,
  sourceCandidate: SmartCutCandidate,
  contentUnitById: ReadonlyMap<string, SmartCutContentUnit>,
  blockers: SmartCutFilterEffectBlocker[],
) {
  for (const unitId of filteredCandidate.unitIds) {
    if (!contentUnitById.has(unitId)) {
      blockers.push({
        code: 'FILTERED_CANDIDATE_UNKNOWN_UNIT',
        message: `Filtered candidate ${filteredCandidate.id} references unknown unit ${unitId}.`,
        candidateId: sourceCandidate.id,
        filteredCandidateId: filteredCandidate.id,
        unitId,
        remediation: 'Native filtered output must preserve stable content unit ids from the source plan.',
      });
      continue;
    }

    if (!sourceCandidate.unitIds.includes(unitId)) {
      blockers.push({
        code: 'FILTERED_CANDIDATE_UNIT_OUTSIDE_SOURCE',
        message: `Filtered candidate ${filteredCandidate.id} references unit ${unitId}, which is outside source candidate ${sourceCandidate.id}.`,
        candidateId: sourceCandidate.id,
        filteredCandidateId: filteredCandidate.id,
        unitId,
        remediation: 'Post-filter output must not mix semantic units from another candidate into the approved source candidate.',
      });
    }
  }

  for (const unitId of sourceCandidate.unitIds) {
    if (!filteredCandidate.unitIds.includes(unitId)) {
      blockers.push({
        code: 'FILTERED_CANDIDATE_MISSING_REQUIRED_UNIT',
        message: `Filtered candidate ${filteredCandidate.id} is missing required semantic unit ${unitId}.`,
        candidateId: sourceCandidate.id,
        filteredCandidateId: filteredCandidate.id,
        unitId,
        remediation: 'Post-slice filters may trim media noise but must not delete approved semantic units.',
      });
    }
  }
}

function validateFilteredSpeakers(
  filteredCandidate: SmartCutFilteredCandidate,
  sourceCandidate: SmartCutCandidate,
  contentUnitById: ReadonlyMap<string, SmartCutContentUnit>,
  blockers: SmartCutFilterEffectBlocker[],
) {
  const requiredSpeakerIds = collectRequiredSpeakerIds(sourceCandidate, contentUnitById);
  const allowedSpeakerIds = new Set(requiredSpeakerIds);

  for (const speakerId of filteredCandidate.speakerIds) {
    if (!allowedSpeakerIds.has(speakerId)) {
      blockers.push({
        code: 'FILTERED_CANDIDATE_SPEAKER_OUTSIDE_SOURCE',
        message: `Filtered candidate ${filteredCandidate.id} references speaker ${speakerId}, which is outside source candidate ${sourceCandidate.id}.`,
        candidateId: sourceCandidate.id,
        filteredCandidateId: filteredCandidate.id,
        speakerId,
        remediation: 'Post-filter output must not add speakers that are not required by the approved source candidate units.',
      });
    }
  }

  for (const speakerId of requiredSpeakerIds) {
    if (!filteredCandidate.speakerIds.includes(speakerId)) {
      blockers.push({
        code: 'FILTERED_CANDIDATE_MISSING_SPEAKER',
        message: `Filtered candidate ${filteredCandidate.id} is missing required speaker ${speakerId}.`,
        candidateId: sourceCandidate.id,
        filteredCandidateId: filteredCandidate.id,
        speakerId,
        remediation: 'Post-filter validation must preserve every speaker required by the approved content units.',
      });
    }
  }
}

function validateFilteredTranscriptSegments(
  filteredCandidate: SmartCutFilteredCandidate,
  sourceCandidate: SmartCutCandidate,
  contentUnitById: ReadonlyMap<string, SmartCutContentUnit>,
  blockers: SmartCutFilterEffectBlocker[],
) {
  const requiredTranscriptSegmentIds = collectRequiredTranscriptSegmentIds(sourceCandidate, contentUnitById);
  const allowedTranscriptSegmentIds = new Set(requiredTranscriptSegmentIds);

  for (const transcriptSegmentId of filteredCandidate.transcriptSegmentIds) {
    if (!allowedTranscriptSegmentIds.has(transcriptSegmentId)) {
      blockers.push({
        code: 'FILTERED_CANDIDATE_TRANSCRIPT_SEGMENT_OUTSIDE_SOURCE',
        message: `Filtered candidate ${filteredCandidate.id} references transcript segment ${transcriptSegmentId}, which is outside source candidate ${sourceCandidate.id}.`,
        candidateId: sourceCandidate.id,
        filteredCandidateId: filteredCandidate.id,
        remediation: 'Post-filter output must not add transcript segments that are not required by the approved source candidate units.',
      });
    }
  }

  for (const transcriptSegmentId of requiredTranscriptSegmentIds) {
    if (!filteredCandidate.transcriptSegmentIds.includes(transcriptSegmentId)) {
      blockers.push({
        code: 'FILTERED_CANDIDATE_MISSING_TRANSCRIPT_SEGMENT',
        message: `Filtered candidate ${filteredCandidate.id} is missing transcript segment ${transcriptSegmentId}.`,
        candidateId: sourceCandidate.id,
        filteredCandidateId: filteredCandidate.id,
        remediation: 'Post-filter output must keep transcript alignment for every approved semantic unit.',
      });
    }
  }
}

function validateAppliedEffects(
  filteredCandidate: SmartCutFilteredCandidate,
  effectById: ReadonlyMap<string, SmartCutFilterEffect>,
  filterPlan: SmartCutPostSliceFilterPlan,
  blockers: SmartCutFilterEffectBlocker[],
) {
  const seenAppliedEffectIds = new Set<string>();
  const reportedDuplicateAppliedEffectIds = new Set<string>();

  for (const effectId of filteredCandidate.appliedEffectIds) {
    if (seenAppliedEffectIds.has(effectId)) {
      if (!reportedDuplicateAppliedEffectIds.has(effectId)) {
        blockers.push({
          code: 'FILTERED_CANDIDATE_DUPLICATE_APPLIED_EFFECT',
          message: `Filtered candidate ${filteredCandidate.id} repeats applied effect id ${effectId}.`,
          candidateId: filteredCandidate.sourceCandidateId,
          filteredCandidateId: filteredCandidate.id,
          effectId,
          remediation: 'Applied effect ids must be unique for each filtered candidate.',
        });
        reportedDuplicateAppliedEffectIds.add(effectId);
      }
      continue;
    }

    seenAppliedEffectIds.add(effectId);

    const effect = effectById.get(effectId);
    if (effect === undefined) {
      blockers.push({
        code: 'FILTERED_CANDIDATE_UNKNOWN_EFFECT',
        message: `Filtered candidate ${filteredCandidate.id} references unknown applied effect ${effectId}.`,
        candidateId: filteredCandidate.sourceCandidateId,
        filteredCandidateId: filteredCandidate.id,
        effectId,
        remediation: 'Every applied effect id must be present in the filter effect report.',
      });
      continue;
    }

    if (effect.candidateId !== filteredCandidate.sourceCandidateId) {
      blockers.push({
        code: 'FILTERED_CANDIDATE_EFFECT_SOURCE_MISMATCH',
        message: `Filtered candidate ${filteredCandidate.id} references effect ${effect.id} from source candidate ${effect.candidateId}.`,
        candidateId: filteredCandidate.sourceCandidateId,
        filteredCandidateId: filteredCandidate.id,
        effectId: effect.id,
        remediation: 'Filtered candidates may apply only effects generated for the same source candidate.',
      });
    }

    const inPlan = filterPlan.steps.some((step) => step.index === effect.stepIndex && step.filterId === effect.filterId);
    if (!inPlan) {
      blockers.push({
        code: 'FILTER_EFFECT_WITHOUT_PLAN_STEP',
        message: `Applied effect ${effect.id} for filtered candidate ${filteredCandidate.id} is not in filter plan ${filterPlan.id}.`,
        candidateId: filteredCandidate.sourceCandidateId,
        filteredCandidateId: filteredCandidate.id,
        effectId: effect.id,
        remediation: 'Discard native filter results that include effects outside the approved filter plan.',
      });
    }
  }
}

function createFilterEffectCandidateReport(
  filteredCandidate: SmartCutFilteredCandidate,
  sourceCandidate: SmartCutCandidate | undefined,
  contentUnitById: ReadonlyMap<string, SmartCutContentUnit>,
  blockers: readonly SmartCutFilterEffectBlocker[],
): SmartCutFilterEffectCandidateReport {
  const requiredUnitIds = sourceCandidate?.unitIds ?? [];
  const preservedUnitIds = requiredUnitIds.filter((unitId) => filteredCandidate.unitIds.includes(unitId));
  const missingUnitIds = requiredUnitIds.filter((unitId) => !filteredCandidate.unitIds.includes(unitId));
  const requiredSpeakerIds = sourceCandidate === undefined ? [] : collectRequiredSpeakerIds(sourceCandidate, contentUnitById);
  const preservedSpeakerIds = requiredSpeakerIds.filter((speakerId) => filteredCandidate.speakerIds.includes(speakerId));
  const missingSpeakerIds = requiredSpeakerIds.filter((speakerId) => !filteredCandidate.speakerIds.includes(speakerId));

  return {
    filteredCandidateId: filteredCandidate.id,
    sourceCandidateId: filteredCandidate.sourceCandidateId,
    preservedUnitIds,
    missingUnitIds,
    preservedSpeakerIds,
    missingSpeakerIds,
    durationMs: filteredCandidate.durationMs,
    blockerCodes: blockers.map((blocker) => blocker.code),
  };
}

function collectRequiredSpeakerIds(
  sourceCandidate: SmartCutCandidate,
  contentUnitById: ReadonlyMap<string, SmartCutContentUnit>,
): readonly string[] {
  return uniqueValues(sourceCandidate.unitIds.flatMap((unitId) => contentUnitById.get(unitId)?.speakerIds ?? []));
}

function collectRequiredTranscriptSegmentIds(
  sourceCandidate: SmartCutCandidate,
  contentUnitById: ReadonlyMap<string, SmartCutContentUnit>,
): readonly string[] {
  return uniqueValues(sourceCandidate.unitIds.flatMap((unitId) => contentUnitById.get(unitId)?.transcriptSegmentIds ?? []));
}

function uniqueValues(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function isValidPositiveRange(range: SmartCutTimeRange): boolean {
  return Number.isFinite(range.startMs) &&
    Number.isFinite(range.endMs) &&
    Number.isInteger(range.startMs) &&
    Number.isInteger(range.endMs) &&
    range.endMs > range.startMs;
}

function rangeInside(inner: SmartCutTimeRange, outer: SmartCutTimeRange): boolean {
  return inner.startMs >= outer.startMs && inner.endMs <= outer.endMs;
}

function rangeCovers(range: SmartCutTimeRange, unit: SmartCutContentUnit): boolean {
  return range.startMs <= unit.startMs && range.endMs >= unit.endMs;
}

function rangesOverlap(left: SmartCutTimeRange, right: SmartCutTimeRange): boolean {
  return left.startMs < right.endMs && right.startMs < left.endMs;
}
