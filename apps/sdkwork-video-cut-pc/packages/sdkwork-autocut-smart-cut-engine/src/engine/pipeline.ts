import type {
  SmartCutCandidate,
  SmartCutContentUnit,
  SmartCutEvidenceKind,
  SmartCutOutputProfile,
  SmartCutTimeRange,
} from './domain.ts';
import { SMART_CUT_DEFAULT_SLICER_ID } from './domain.ts';
import { SMART_CUT_FILTER_REGISTRY } from './filters.ts';
import { SMART_CUT_PRODUCT_PRESET_REGISTRY, type SmartCutProductPresetId } from './presets.ts';
import type { SmartCutSlicerId } from './slicers.ts';
import { SMART_CUT_SLICER_REGISTRY } from './slicers.ts';
import type { SmartCutValidatorId } from './validators.ts';

export type SmartCutPipelineStepId =
  | 'prepare-source'
  | 'extract-native-evidence'
  | 'speech-to-text'
  | 'speaker-diarization'
  | 'align-transcript-speakers'
  | 'build-content-units'
  | 'run-slicer-chain'
  | 'llm-review-rank'
  | 'validate-candidates'
  | 'apply-post-slice-filters'
  | 'revalidate-filtered-plan'
  | 'render-package'
  | 'validate-render-artifacts';

export type SmartCutPipelineOwner = 'typescript' | 'rust-native' | 'provider' | 'llm';

export interface SmartCutPipelineStep {
  id: SmartCutPipelineStepId;
  owner: SmartCutPipelineOwner;
  displayName: string;
  produces: readonly string[];
  requiredEvidence: readonly SmartCutEvidenceKind[];
  runsAfter: readonly SmartCutPipelineStepId[];
  constraints: readonly string[];
}

export type SmartCutNativeCommandId =
  | 'smart_cut_probe_media'
  | 'smart_cut_extract_audio_evidence'
  | 'smart_cut_extract_visual_evidence'
  | 'smart_cut_extract_music_evidence'
  | 'smart_cut_build_interval_index'
  | 'smart_cut_validate_candidates'
  | 'smart_cut_apply_filter_plan'
  | 'smart_cut_validate_filtered_plan'
  | 'smart_cut_render_plan'
  | 'smart_cut_probe_artifacts';

export interface SmartCutExecutionBlueprintInput {
  presetId: SmartCutProductPresetId;
}

export interface SmartCutExecutionBlueprint {
  presetId: SmartCutProductPresetId;
  defaultSlicerId: typeof SMART_CUT_DEFAULT_SLICER_ID;
  slicerChain: readonly SmartCutSlicerId[];
  validators: readonly SmartCutValidatorId[];
  requiresSpeakerDiarization: boolean;
  pipelineSteps: readonly SmartCutPipelineStep[];
  nativeCommandPlan: readonly SmartCutNativeCommandId[];
}

export interface SmartCutCandidatePlanValidationInput {
  presetId: SmartCutProductPresetId;
  sourceDurationMs: number;
  contentUnits: readonly SmartCutContentUnit[];
  candidates: readonly SmartCutCandidate[];
}

export type SmartCutCandidatePlanBlockerCode =
  | 'UNKNOWN_PRESET'
  | 'INVALID_SOURCE_DURATION'
  | 'NO_CANDIDATES'
  | 'CANDIDATE_OUT_OF_SOURCE_RANGE'
  | 'CANDIDATE_INVALID_RANGE'
  | 'CANDIDATE_WITHOUT_CONTENT_UNITS'
  | 'CANDIDATE_REFERENCES_UNKNOWN_UNIT'
  | 'CANDIDATE_RANGE_DOES_NOT_COVER_UNITS'
  | 'CONTENT_UNIT_INVALID_RANGE'
  | 'CONTENT_UNIT_WITHOUT_TRANSCRIPT'
  | 'CONTENT_UNIT_WITHOUT_VISUAL_EVIDENCE'
  | 'CONTENT_UNIT_WITHOUT_SPEAKER'
  | 'CONTENT_UNIT_WITHOUT_SPEAKER_TURN'
  | 'CONTENT_UNIT_WITHOUT_SPEAKER_ROLE'
  | 'CONTENT_UNIT_LOW_SPEAKER_CONFIDENCE'
  | 'CONTENT_UNIT_CROSSES_SPEAKERS'
  | 'LOW_SEMANTIC_COMPLETENESS'
  | 'LOW_SPEAKER_CONTINUITY'
  | 'LOW_PUBLISHABILITY'
  | 'DURATION_BELOW_PRESET_MINIMUM'
  | 'DURATION_ABOVE_PRESET_MAXIMUM'
  | 'SLICER_NOT_IN_PRESET_CHAIN';

export interface SmartCutCandidatePlanBlocker {
  code: SmartCutCandidatePlanBlockerCode;
  message: string;
  candidateId?: string;
  unitId?: string;
  remediation: string;
}

export interface SmartCutCandidatePlanValidationReport {
  ready: boolean;
  blockers: readonly SmartCutCandidatePlanBlocker[];
  candidateCount: number;
  contentUnitCount: number;
}

const semanticCompletenessThreshold = 0.72;
const speakerContinuityThreshold = 0.7;
const publishabilityThreshold = 0.68;

export function createSmartCutExecutionBlueprint(input: SmartCutExecutionBlueprintInput): SmartCutExecutionBlueprint {
  const preset = findProductPreset(input.presetId);
  if (preset === undefined) {
    throw new Error(`Unknown smart cut product preset: ${input.presetId}`);
  }

  return {
    presetId: preset.id,
    defaultSlicerId: SMART_CUT_DEFAULT_SLICER_ID,
    slicerChain: preset.slicerChain,
    validators: preset.validators,
    requiresSpeakerDiarization: preset.requiresSpeakerDiarization,
    pipelineSteps: createPipelineSteps(preset.requiresSpeakerDiarization),
    nativeCommandPlan: [
      'smart_cut_probe_media',
      'smart_cut_extract_audio_evidence',
      'smart_cut_extract_visual_evidence',
      'smart_cut_extract_music_evidence',
      'smart_cut_build_interval_index',
      'smart_cut_validate_candidates',
      'smart_cut_apply_filter_plan',
      'smart_cut_validate_filtered_plan',
      'smart_cut_render_plan',
      'smart_cut_probe_artifacts',
    ],
  };
}

export function validateSmartCutCandidatePlan(input: SmartCutCandidatePlanValidationInput): SmartCutCandidatePlanValidationReport {
  const blockers: SmartCutCandidatePlanBlocker[] = [];
  const preset = findProductPreset(input.presetId);
  if (preset === undefined) {
    blockers.push({
      code: 'UNKNOWN_PRESET',
      message: `Unknown smart cut product preset: ${input.presetId}`,
      remediation: 'Use a registered product preset id from SMART_CUT_PRODUCT_PRESET_REGISTRY.',
    });
    return createCandidateValidationReport(input, blockers);
  }

  if (!Number.isFinite(input.sourceDurationMs) || input.sourceDurationMs <= 0) {
    blockers.push({
      code: 'INVALID_SOURCE_DURATION',
      message: `Source duration must be positive milliseconds, got ${input.sourceDurationMs}.`,
      remediation: 'Probe source media with the native engine before planning candidates.',
    });
  }

  if (input.candidates.length === 0) {
    blockers.push({
      code: 'NO_CANDIDATES',
      message: 'Candidate plan has no slices.',
      remediation: 'Run at least one slicer strategy and produce content-unit-backed candidates.',
    });
  }

  const unitById = new Map(input.contentUnits.map((unit) => [unit.id, unit]));
  for (const candidate of input.candidates) {
    validateCandidateRange(candidate, input.sourceDurationMs, blockers);
    validateCandidateSlicer(candidate, preset.slicerChain, blockers);
    validateCandidateDuration(
      candidate,
      getOptionalDurationMs(preset.outputProfile, 'minDurationMs'),
      getOptionalDurationMs(preset.outputProfile, 'maxDurationMs'),
      blockers,
    );
    validateCandidateUnits(candidate, unitById, blockers);
  }

  return createCandidateValidationReport(input, blockers);
}

function createPipelineSteps(requiresSpeakerDiarization: boolean): readonly SmartCutPipelineStep[] {
  return [
    {
      id: 'prepare-source',
      owner: 'typescript',
      displayName: 'Prepare Source',
      produces: ['source-media'],
      requiredEvidence: [],
      runsAfter: [],
      constraints: ['trusted-local-or-native-asset'],
    },
    {
      id: 'extract-native-evidence',
      owner: 'rust-native',
      displayName: 'Extract Native Evidence',
      produces: ['media-evidence', 'audio-evidence', 'visual-evidence', 'interval-index'],
      requiredEvidence: ['media'],
      runsAfter: ['prepare-source'],
      constraints: ['integer-ms-ranges', 'source-backed'],
    },
    {
      id: 'speech-to-text',
      owner: 'provider',
      displayName: 'Speech To Text',
      produces: ['transcript-evidence'],
      requiredEvidence: ['media', 'audio'],
      runsAfter: ['extract-native-evidence'],
      constraints: ['timestamped-segments-required'],
    },
    {
      id: 'speaker-diarization',
      owner: 'provider',
      displayName: 'Speaker Diarization',
      produces: ['speaker-evidence'],
      requiredEvidence: ['audio'],
      runsAfter: ['speech-to-text'],
      constraints: requiresSpeakerDiarization ? ['required'] : ['optional-but-schema-supported'],
    },
    {
      id: 'align-transcript-speakers',
      owner: 'typescript',
      displayName: 'Align Transcript Speakers',
      produces: ['speaker-turns'],
      requiredEvidence: ['transcript', 'speaker'],
      runsAfter: ['speaker-diarization'],
      constraints: ['turns-must-reference-transcript-segment-ids'],
    },
    {
      id: 'build-content-units',
      owner: 'typescript',
      displayName: 'Build Content Units',
      produces: ['content-units'],
      requiredEvidence: ['transcript', 'speaker'],
      runsAfter: ['align-transcript-speakers'],
      constraints: ['complete-semantic-units', 'stable-unit-ids'],
    },
    {
      id: 'run-slicer-chain',
      owner: 'typescript',
      displayName: 'Run Slicer Chain',
      produces: ['candidate-plan'],
      requiredEvidence: ['transcript', 'speaker'],
      runsAfter: ['build-content-units'],
      constraints: ['candidates-reference-content-unit-ids'],
    },
    {
      id: 'llm-review-rank',
      owner: 'llm',
      displayName: 'LLM Review And Rank',
      produces: ['llm-review-evidence'],
      requiredEvidence: ['transcript', 'speaker'],
      runsAfter: ['run-slicer-chain'],
      constraints: ['stable-unit-ids-only', 'no-raw-timecode-generation'],
    },
    {
      id: 'validate-candidates',
      owner: 'rust-native',
      displayName: 'Validate Candidates',
      produces: ['candidate-validation-report'],
      requiredEvidence: ['media', 'transcript', 'speaker'],
      runsAfter: ['llm-review-rank'],
      constraints: ['fail-closed', 'semantic-before-filter'],
    },
    {
      id: 'apply-post-slice-filters',
      owner: 'rust-native',
      displayName: 'Apply Post-Slice Filters',
      produces: ['filtered-plan'],
      requiredEvidence: ['audio', 'visual', 'transcript'],
      runsAfter: ['validate-candidates'],
      constraints: ['destructive-filters-marked-for-revalidation'],
    },
    {
      id: 'revalidate-filtered-plan',
      owner: 'rust-native',
      displayName: 'Revalidate Filtered Plan',
      produces: ['post-filter-validation-report'],
      requiredEvidence: ['media', 'transcript', 'speaker', 'audio'],
      runsAfter: ['apply-post-slice-filters'],
      constraints: ['required-after-destructive-filters'],
    },
    {
      id: 'render-package',
      owner: 'rust-native',
      displayName: 'Render Package',
      produces: ['rendered-video', 'subtitles', 'cover', 'quality-report'],
      requiredEvidence: ['media', 'audio', 'visual', 'transcript'],
      runsAfter: ['revalidate-filtered-plan'],
      constraints: ['validated-render-plan-only'],
    },
    {
      id: 'validate-render-artifacts',
      owner: 'rust-native',
      displayName: 'Validate Render Artifacts',
      produces: ['artifact-validation-report'],
      requiredEvidence: ['media'],
      runsAfter: ['render-package'],
      constraints: ['byte-size-check', 'probe-check', 'checksum-check'],
    },
  ];
}

function validateCandidateRange(candidate: SmartCutCandidate, sourceDurationMs: number, blockers: SmartCutCandidatePlanBlocker[]) {
  if (!isValidRange(candidate)) {
    blockers.push({
      code: 'CANDIDATE_INVALID_RANGE',
      message: `Candidate ${candidate.id} has invalid time range ${candidate.startMs}-${candidate.endMs}.`,
      candidateId: candidate.id,
      remediation: 'Rebuild the candidate from ordered content units with positive duration.',
    });
    return;
  }

  if (candidate.startMs < 0 || candidate.endMs > sourceDurationMs) {
    blockers.push({
      code: 'CANDIDATE_OUT_OF_SOURCE_RANGE',
      message: `Candidate ${candidate.id} is outside source duration ${sourceDurationMs}ms.`,
      candidateId: candidate.id,
      remediation: 'Clamp or discard candidates outside the probed source duration.',
    });
  }
}

function validateCandidateSlicer(
  candidate: SmartCutCandidate,
  slicerChain: readonly SmartCutSlicerId[],
  blockers: SmartCutCandidatePlanBlocker[],
) {
  if (!slicerChain.includes(candidate.slicerId as SmartCutSlicerId)) {
    blockers.push({
      code: 'SLICER_NOT_IN_PRESET_CHAIN',
      message: `Candidate ${candidate.id} was produced by slicer ${candidate.slicerId}, which is not in the preset chain.`,
      candidateId: candidate.id,
      remediation: 'Use candidates produced by the selected preset slicer chain only.',
    });
  }
}

function validateCandidateDuration(
  candidate: SmartCutCandidate,
  minDurationMs: number | undefined,
  maxDurationMs: number | undefined,
  blockers: SmartCutCandidatePlanBlocker[],
) {
  const durationMs = candidate.endMs - candidate.startMs;
  if (minDurationMs !== undefined && durationMs < minDurationMs) {
    blockers.push({
      code: 'DURATION_BELOW_PRESET_MINIMUM',
      message: `Candidate ${candidate.id} duration ${durationMs}ms is below preset minimum ${minDurationMs}ms.`,
      candidateId: candidate.id,
      remediation: 'Merge adjacent complete content units or discard the candidate for this preset.',
    });
  }
  if (maxDurationMs !== undefined && durationMs > maxDurationMs) {
    blockers.push({
      code: 'DURATION_ABOVE_PRESET_MAXIMUM',
      message: `Candidate ${candidate.id} duration ${durationMs}ms exceeds preset maximum ${maxDurationMs}ms.`,
      candidateId: candidate.id,
      remediation: 'Split by complete content units or use a preset with a longer duration contract.',
    });
  }
}

function validateCandidateUnits(
  candidate: SmartCutCandidate,
  unitById: ReadonlyMap<string, SmartCutContentUnit>,
  blockers: SmartCutCandidatePlanBlocker[],
) {
  if (candidate.unitIds.length === 0) {
    blockers.push({
      code: 'CANDIDATE_WITHOUT_CONTENT_UNITS',
      message: `Candidate ${candidate.id} has no content unit ids.`,
      candidateId: candidate.id,
      remediation: 'Reject raw time-only candidates and rebuild using stable content unit ids.',
    });
    return;
  }

  for (const unitId of candidate.unitIds) {
    const unit = unitById.get(unitId);
    if (unit === undefined) {
      blockers.push({
        code: 'CANDIDATE_REFERENCES_UNKNOWN_UNIT',
        message: `Candidate ${candidate.id} references unknown content unit ${unitId}.`,
        candidateId: candidate.id,
        unitId,
        remediation: 'Rebuild candidates after content unit generation and keep ids stable.',
      });
      continue;
    }

    validateUnitStructure(candidate, unit, blockers);
    validateCandidateCoversUnit(candidate, unit, blockers);
    if (isVisualCandidateUnit(unit)) {
      validateVisualUnitContext(candidate, unit, blockers);
    } else {
      validateUnitSpeakerContext(candidate, unit, blockers);
    }
    validateUnitScores(candidate, unit, blockers);
  }
}

function validateCandidateCoversUnit(
  candidate: SmartCutCandidate,
  unit: SmartCutContentUnit,
  blockers: SmartCutCandidatePlanBlocker[],
) {
  if (candidate.startMs > unit.startMs || candidate.endMs < unit.endMs) {
    blockers.push({
      code: 'CANDIDATE_RANGE_DOES_NOT_COVER_UNITS',
      message: `Candidate ${candidate.id} does not fully cover content unit ${unit.id}.`,
      candidateId: candidate.id,
      unitId: unit.id,
      remediation: 'Snap candidate ranges to the full span of their referenced content units.',
    });
  }
}

function validateUnitStructure(
  candidate: SmartCutCandidate,
  unit: SmartCutContentUnit,
  blockers: SmartCutCandidatePlanBlocker[],
) {
  if (!isValidRange(unit)) {
    blockers.push({
      code: 'CONTENT_UNIT_INVALID_RANGE',
      message: `Content unit ${unit.id} has invalid range ${unit.startMs}-${unit.endMs}.`,
      candidateId: candidate.id,
      unitId: unit.id,
      remediation: 'Rebuild content units from ordered timestamped transcript and speaker ranges.',
    });
  }

  if (isVisualCandidateUnit(unit)) {
    return;
  }

  if (!Array.isArray(unit.transcriptSegmentIds) || unit.transcriptSegmentIds.length === 0) {
    blockers.push({
      code: 'CONTENT_UNIT_WITHOUT_TRANSCRIPT',
      message: `Content unit ${unit.id} has no transcript segment ids.`,
      candidateId: candidate.id,
      unitId: unit.id,
      remediation: 'Preserve stable transcript segment ids so every candidate can be audited against STT timestamps.',
    });
  }
}

function validateVisualUnitContext(
  candidate: SmartCutCandidate,
  unit: SmartCutContentUnit,
  blockers: SmartCutCandidatePlanBlocker[],
) {
  if (!unit.evidenceIds.includes('visual')) {
    blockers.push({
      code: 'CONTENT_UNIT_WITHOUT_VISUAL_EVIDENCE',
      message: `Content unit ${unit.id} has no visual evidence declaration.`,
      candidateId: candidate.id,
      unitId: unit.id,
      remediation: 'Build visual scene candidates from source-backed visual evidence ids, not raw timestamps.',
    });
  }
}

function isVisualCandidateUnit(unit: SmartCutContentUnit): boolean {
  return unit.evidenceIds.includes('visual') &&
    (unit.unitKind === 'visual-scene' || unit.unitKind === 'shot');
}

function validateUnitSpeakerContext(
  candidate: SmartCutCandidate,
  unit: SmartCutContentUnit,
  blockers: SmartCutCandidatePlanBlocker[],
) {
  if (!Array.isArray(unit.speakerIds) || unit.speakerIds.length === 0) {
    blockers.push({
      code: 'CONTENT_UNIT_WITHOUT_SPEAKER',
      message: `Content unit ${unit.id} has no speaker ids.`,
      candidateId: candidate.id,
      unitId: unit.id,
      remediation: 'Rebuild candidates from diarized content units that preserve speaker identity.',
    });
  }

  if (Array.isArray(unit.speakerIds) && unit.speakerIds.length > 1) {
    blockers.push({
      code: 'CONTENT_UNIT_CROSSES_SPEAKERS',
      message: `Content unit ${unit.id} crosses speakers ${unit.speakerIds.join(',')}.`,
      candidateId: candidate.id,
      unitId: unit.id,
      remediation: 'Represent each speaker turn as its own content unit; multi-speaker candidates should compose ordered units instead of merging speakers into one unit.',
    });
  }

  if (!Array.isArray(unit.speakerTurnIds) || unit.speakerTurnIds.length === 0) {
    blockers.push({
      code: 'CONTENT_UNIT_WITHOUT_SPEAKER_TURN',
      message: `Content unit ${unit.id} has no speaker turn ids.`,
      candidateId: candidate.id,
      unitId: unit.id,
      remediation: 'Rebuild candidates from content units produced after speaker turn alignment.',
    });
  }

  if (!Array.isArray(unit.speakerRoles) || unit.speakerRoles.length === 0 || unit.speakerRoles.includes('unknown')) {
    blockers.push({
      code: 'CONTENT_UNIT_WITHOUT_SPEAKER_ROLE',
      message: `Content unit ${unit.id} has no resolved speaker role.`,
      candidateId: candidate.id,
      unitId: unit.id,
      remediation: 'Resolve speaker roles before candidate validation so dialogue and multi-speaker cuts are auditable.',
    });
  }

  if (!Number.isFinite(unit.speakerConfidence) || unit.speakerConfidence < 0.5) {
    blockers.push({
      code: 'CONTENT_UNIT_LOW_SPEAKER_CONFIDENCE',
      message: `Content unit ${unit.id} speaker confidence ${unit.speakerConfidence} is below 0.5.`,
      candidateId: candidate.id,
      unitId: unit.id,
      remediation: 'Repair diarization or speaker alignment before producing publishable candidates.',
    });
  }
}

function validateUnitScores(
  candidate: SmartCutCandidate,
  unit: SmartCutContentUnit,
  blockers: SmartCutCandidatePlanBlocker[],
) {
  if (unit.completenessScore < semanticCompletenessThreshold) {
    blockers.push({
      code: 'LOW_SEMANTIC_COMPLETENESS',
      message: `Content unit ${unit.id} semantic completeness ${unit.completenessScore} is below ${semanticCompletenessThreshold}.`,
      candidateId: candidate.id,
      unitId: unit.id,
      remediation: 'Extend to adjacent units or discard incomplete content.',
    });
  }

  if (unit.continuityScore < speakerContinuityThreshold) {
    blockers.push({
      code: 'LOW_SPEAKER_CONTINUITY',
      message: `Content unit ${unit.id} speaker/content continuity ${unit.continuityScore} is below ${speakerContinuityThreshold}.`,
      candidateId: candidate.id,
      unitId: unit.id,
      remediation: 'Repair speaker turns, include missing Q/A context, or rerun diarization.',
    });
  }

  if (unit.publishabilityScore < publishabilityThreshold) {
    blockers.push({
      code: 'LOW_PUBLISHABILITY',
      message: `Content unit ${unit.id} publishability ${unit.publishabilityScore} is below ${publishabilityThreshold}.`,
      candidateId: candidate.id,
      unitId: unit.id,
      remediation: 'Remove low-value content or choose stronger complete content units.',
    });
  }
}

function createCandidateValidationReport(
  input: SmartCutCandidatePlanValidationInput,
  blockers: readonly SmartCutCandidatePlanBlocker[],
): SmartCutCandidatePlanValidationReport {
  return {
    ready: blockers.length === 0,
    blockers,
    candidateCount: input.candidates.length,
    contentUnitCount: input.contentUnits.length,
  };
}

function isValidRange(range: SmartCutTimeRange): boolean {
  return Number.isFinite(range.startMs) &&
    Number.isFinite(range.endMs) &&
    Number.isInteger(range.startMs) &&
    Number.isInteger(range.endMs) &&
    range.endMs > range.startMs;
}

function getOptionalDurationMs(
  outputProfile: SmartCutOutputProfile,
  key: 'minDurationMs' | 'maxDurationMs',
): number | undefined {
  return outputProfile[key];
}

function findProductPreset(presetId: SmartCutProductPresetId) {
  return SMART_CUT_PRODUCT_PRESET_REGISTRY.find((preset) => preset.id === presetId);
}

export function getSmartCutSlicerRequiredEvidence(slicerId: SmartCutSlicerId): readonly SmartCutEvidenceKind[] {
  const slicer = SMART_CUT_SLICER_REGISTRY.find((entry) => entry.id === slicerId);
  return slicer?.requiredEvidence ?? [];
}

export function getSmartCutDestructiveFilterIds(): readonly string[] {
  return SMART_CUT_FILTER_REGISTRY
    .filter((filter) => filter.destructive)
    .map((filter) => filter.id);
}
