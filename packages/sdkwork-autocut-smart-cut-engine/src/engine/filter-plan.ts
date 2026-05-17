import { SMART_CUT_STANDARD_VERSION } from './domain.ts';
import type { SmartCutFilterDefinition, SmartCutFilterId } from './filters.ts';
import { SMART_CUT_FILTER_REGISTRY } from './filters.ts';
import type { SmartCutNativeCommandId, SmartCutPipelineStepId } from './pipeline.ts';
import type { SmartCutProductPresetId } from './presets.ts';
import { SMART_CUT_PRODUCT_PRESET_REGISTRY } from './presets.ts';
import type { SmartCutValidatorId } from './validators.ts';

export interface SmartCutPostSliceFilterPlanInput {
  presetId: SmartCutProductPresetId;
  planId: string;
  candidateIds: readonly string[];
  completedPipelineStepIds: readonly SmartCutPipelineStepId[];
}

export interface SmartCutPostSliceFilterPlanStep {
  index: number;
  filterId: SmartCutFilterId;
  stage: SmartCutFilterDefinition['stage'];
  requiredEvidence: SmartCutFilterDefinition['requiredEvidence'];
  destructive: boolean;
  requiresRevalidation: boolean;
  nativeAcceleration: SmartCutFilterDefinition['nativeAcceleration'];
}

export interface SmartCutPostSliceFilterPlan {
  id: string;
  schemaVersion: typeof SMART_CUT_STANDARD_VERSION;
  presetId: SmartCutProductPresetId;
  sourcePlanId: string;
  candidateIds: readonly string[];
  completedPipelineStepIds: readonly SmartCutPipelineStepId[];
  steps: readonly SmartCutPostSliceFilterPlanStep[];
  requiresPostFilterRevalidation: boolean;
  requiredValidatorIds: readonly SmartCutValidatorId[];
  nativeCommandIds: readonly SmartCutNativeCommandId[];
}

export interface SmartCutPostSliceFilterPlanValidationInput {
  filterPlan: SmartCutPostSliceFilterPlan;
  completedPipelineStepIds: readonly SmartCutPipelineStepId[];
}

export type SmartCutPostSliceFilterPlanBlockerCode =
  | 'INVALID_FILTER_PLAN_SCHEMA_VERSION'
  | 'UNKNOWN_PRESET'
  | 'FILTER_PLAN_SOURCE_PLAN_MISSING'
  | 'FILTER_PLAN_WITHOUT_CANDIDATES'
  | 'FILTER_PLAN_WITH_BLANK_CANDIDATE_ID'
  | 'FILTER_PLAN_WITH_DUPLICATE_CANDIDATE_ID'
  | 'FILTER_PLAN_COMPLETED_STEPS_MISMATCH'
  | 'FILTERS_BEFORE_CANDIDATE_VALIDATION'
  | 'UNKNOWN_FILTER'
  | 'FILTER_STEP_INDEX_INVALID'
  | 'FILTER_STEP_REGISTRY_MISMATCH'
  | 'FILTER_PLAN_PRESET_FILTER_CHAIN_MISMATCH'
  | 'FILTER_PLAN_REVALIDATION_FLAG_MISMATCH'
  | 'DESTRUCTIVE_FILTER_WITHOUT_REVALIDATION'
  | 'MISSING_POST_FILTER_VALIDATOR'
  | 'MISSING_NATIVE_FILTER_COMMAND';

export interface SmartCutPostSliceFilterPlanBlocker {
  code: SmartCutPostSliceFilterPlanBlockerCode;
  message: string;
  filterId?: SmartCutFilterId;
  remediation: string;
}

export interface SmartCutPostSliceFilterPlanValidationReport {
  ready: boolean;
  blockers: readonly SmartCutPostSliceFilterPlanBlocker[];
  filterCount: number;
  candidateCount: number;
}

const requiredPostFilterValidatorIds = [
  'semantic-completeness',
  'speaker-continuity',
  'boundary-integrity',
  'post-filter-integrity',
] as const satisfies readonly SmartCutValidatorId[];

const filterNativeCommandIds = [
  'smart_cut_apply_filter_plan',
  'smart_cut_validate_filtered_plan',
] as const satisfies readonly SmartCutNativeCommandId[];

export function createSmartCutPostSliceFilterPlan(
  input: SmartCutPostSliceFilterPlanInput,
): SmartCutPostSliceFilterPlan {
  const preset = SMART_CUT_PRODUCT_PRESET_REGISTRY.find((entry) => entry.id === input.presetId);
  if (preset === undefined) {
    throw new Error(`Unknown smart cut product preset: ${input.presetId}`);
  }

  const filterById = new Map(SMART_CUT_FILTER_REGISTRY.map((filter) => [filter.id, filter]));
  const steps = preset.filters.map((filterId, index) => {
    const filter = filterById.get(filterId);
    if (filter === undefined) {
      throw new Error(`Unknown smart cut filter in preset ${input.presetId}: ${filterId}`);
    }

    return createPostSliceFilterStep(filter, index);
  });
  const requiresPostFilterRevalidation = steps.some((step) => step.destructive || step.requiresRevalidation);

  return {
    id: `post-slice-filter-plan-${input.planId}`,
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    presetId: input.presetId,
    sourcePlanId: input.planId,
    candidateIds: [...input.candidateIds],
    completedPipelineStepIds: [...input.completedPipelineStepIds],
    steps,
    requiresPostFilterRevalidation,
    requiredValidatorIds: requiresPostFilterRevalidation ? requiredPostFilterValidatorIds : ['boundary-integrity'],
    nativeCommandIds: filterNativeCommandIds,
  };
}

export function validateSmartCutPostSliceFilterPlan(
  input: SmartCutPostSliceFilterPlanValidationInput,
): SmartCutPostSliceFilterPlanValidationReport {
  const blockers: SmartCutPostSliceFilterPlanBlocker[] = [];
  const preset = SMART_CUT_PRODUCT_PRESET_REGISTRY.find((entry) => entry.id === input.filterPlan.presetId);
  if (input.filterPlan.schemaVersion !== SMART_CUT_STANDARD_VERSION) {
    blockers.push({
      code: 'INVALID_FILTER_PLAN_SCHEMA_VERSION',
      message: `Filter plan schema version ${input.filterPlan.schemaVersion} does not match ${SMART_CUT_STANDARD_VERSION}.`,
      remediation: 'Regenerate filter plans with the current smart cut standard version.',
    });
  }

  if (preset === undefined) {
    blockers.push({
      code: 'UNKNOWN_PRESET',
      message: `Unknown smart cut product preset: ${input.filterPlan.presetId}`,
      remediation: 'Create filter plans from a registered smart cut product preset.',
    });
  }

  if (input.filterPlan.sourcePlanId.trim().length === 0) {
    blockers.push({
      code: 'FILTER_PLAN_SOURCE_PLAN_MISSING',
      message: 'Filter plan has no source candidate plan id.',
      remediation: 'Attach the approved candidate plan id before creating post-slice filters.',
    });
  }

  if (input.filterPlan.candidateIds.length === 0) {
    blockers.push({
      code: 'FILTER_PLAN_WITHOUT_CANDIDATES',
      message: 'Filter plan has no candidate ids.',
      remediation: 'Run slicers and candidate validation before creating a filter plan.',
    });
  }

  validateFilterPlanCandidateIds(input.filterPlan.candidateIds, blockers);
  validateCompletedStepSnapshot(input.filterPlan.completedPipelineStepIds, input.completedPipelineStepIds, blockers);

  if (!input.completedPipelineStepIds.includes('validate-candidates')) {
    blockers.push({
      code: 'FILTERS_BEFORE_CANDIDATE_VALIDATION',
      message: 'Post-slice filters cannot run before candidate validation.',
      remediation: 'Run validate-candidates and only filter content-unit-backed approved candidates.',
    });
  }

  const knownFilterIds = new Set(SMART_CUT_FILTER_REGISTRY.map((filter) => filter.id));
  const filtersById = new Map(SMART_CUT_FILTER_REGISTRY.map((filter) => [filter.id, filter]));
  validateFilterStepIndexes(input.filterPlan.steps, blockers);
  for (const step of input.filterPlan.steps) {
    const filter = filtersById.get(step.filterId);
    if (!knownFilterIds.has(step.filterId) || filter === undefined) {
      blockers.push({
        code: 'UNKNOWN_FILTER',
        message: `Filter step references unknown filter ${step.filterId}.`,
        filterId: step.filterId,
        remediation: 'Use filter ids registered in SMART_CUT_FILTER_REGISTRY.',
      });
      continue;
    }

    if (!filterStepMatchesRegistry(step, filter)) {
      blockers.push({
        code: 'FILTER_STEP_REGISTRY_MISMATCH',
        message: `Filter step ${step.filterId} metadata does not match the filter registry.`,
        filterId: step.filterId,
        remediation: 'Regenerate filter plan steps from SMART_CUT_FILTER_REGISTRY instead of hand-writing filter metadata.',
      });
    }

    if (step.destructive && !step.requiresRevalidation) {
      blockers.push({
        code: 'DESTRUCTIVE_FILTER_WITHOUT_REVALIDATION',
        message: `Destructive filter ${step.filterId} does not require revalidation.`,
        filterId: step.filterId,
        remediation: 'Mark destructive filters as requiring post-filter integrity validation.',
      });
    }
  }

  if (preset !== undefined) {
    validatePresetFilterChain(input.filterPlan.steps, preset.filters, blockers);
  }
  validateRevalidationFlag(input.filterPlan, blockers);

  if (
    input.filterPlan.requiresPostFilterRevalidation &&
    !requiredPostFilterValidatorIds.every((validatorId) => input.filterPlan.requiredValidatorIds.includes(validatorId))
  ) {
    blockers.push({
      code: 'MISSING_POST_FILTER_VALIDATOR',
      message: 'Filter plan is missing required post-filter validators.',
      remediation: 'Require semantic, speaker, boundary, and post-filter integrity validators.',
    });
  }

  if (!filterNativeCommandIds.every((commandId) => input.filterPlan.nativeCommandIds.includes(commandId))) {
    blockers.push({
      code: 'MISSING_NATIVE_FILTER_COMMAND',
      message: 'Filter plan is missing native apply or validation command ids.',
      remediation: 'Route post-slice media mutation through native apply and validate commands.',
    });
  }

  return {
    ready: blockers.length === 0,
    blockers,
    filterCount: input.filterPlan.steps.length,
    candidateCount: input.filterPlan.candidateIds.length,
  };
}

function validateFilterPlanCandidateIds(
  candidateIds: readonly string[],
  blockers: SmartCutPostSliceFilterPlanBlocker[],
) {
  const seen = new Set<string>();
  const reported = new Set<string>();
  for (const candidateId of candidateIds) {
    if (candidateId.trim().length === 0) {
      blockers.push({
        code: 'FILTER_PLAN_WITH_BLANK_CANDIDATE_ID',
        message: 'Filter plan contains a blank candidate id.',
        remediation: 'Post-slice filters must target stable selected candidate ids only.',
      });
      continue;
    }

    if (seen.has(candidateId)) {
      if (!reported.has(candidateId)) {
        blockers.push({
          code: 'FILTER_PLAN_WITH_DUPLICATE_CANDIDATE_ID',
          message: `Filter plan contains duplicate candidate id ${candidateId}.`,
          remediation: 'Filter each selected candidate once and keep candidate ids unique inside the filter plan.',
        });
        reported.add(candidateId);
      }
      continue;
    }

    seen.add(candidateId);
  }
}

function validateCompletedStepSnapshot(
  planSteps: readonly SmartCutPipelineStepId[],
  runtimeSteps: readonly SmartCutPipelineStepId[],
  blockers: SmartCutPostSliceFilterPlanBlocker[],
) {
  if (planSteps.join('\u0000') !== runtimeSteps.join('\u0000')) {
    blockers.push({
      code: 'FILTER_PLAN_COMPLETED_STEPS_MISMATCH',
      message: 'Filter plan completed pipeline steps do not match the runtime completed pipeline steps.',
      remediation: 'Create the filter plan from the same execution state that is about to run native filters.',
    });
  }
}

function validateFilterStepIndexes(
  steps: readonly SmartCutPostSliceFilterPlanStep[],
  blockers: SmartCutPostSliceFilterPlanBlocker[],
) {
  for (const [expectedIndex, step] of steps.entries()) {
    if (step.index !== expectedIndex) {
      blockers.push({
        code: 'FILTER_STEP_INDEX_INVALID',
        message: `Filter step ${step.filterId} has index ${step.index}, expected ${expectedIndex}.`,
        filterId: step.filterId,
        remediation: 'Keep filter steps in deterministic zero-based preset order.',
      });
    }
  }
}

function filterStepMatchesRegistry(
  step: SmartCutPostSliceFilterPlanStep,
  filter: SmartCutFilterDefinition,
): boolean {
  return step.stage === filter.stage &&
    step.destructive === filter.destructive &&
    step.requiresRevalidation === filter.requiresRevalidation &&
    step.nativeAcceleration === filter.nativeAcceleration &&
    step.requiredEvidence.join('\u0000') === filter.requiredEvidence.join('\u0000');
}

function validatePresetFilterChain(
  steps: readonly SmartCutPostSliceFilterPlanStep[],
  presetFilterIds: readonly SmartCutFilterId[],
  blockers: SmartCutPostSliceFilterPlanBlocker[],
) {
  const stepFilterIds = steps.map((step) => step.filterId);
  if (stepFilterIds.join('\u0000') !== presetFilterIds.join('\u0000')) {
    blockers.push({
      code: 'FILTER_PLAN_PRESET_FILTER_CHAIN_MISMATCH',
      message: `Filter plan chain ${stepFilterIds.join('>')} does not match preset chain ${presetFilterIds.join('>')}.`,
      remediation: 'Regenerate post-slice filters from the selected product preset filter chain.',
    });
  }
}

function validateRevalidationFlag(
  filterPlan: SmartCutPostSliceFilterPlan,
  blockers: SmartCutPostSliceFilterPlanBlocker[],
) {
  const expected = filterPlan.steps.some((step) => step.destructive || step.requiresRevalidation);
  if (filterPlan.requiresPostFilterRevalidation !== expected) {
    blockers.push({
      code: 'FILTER_PLAN_REVALIDATION_FLAG_MISMATCH',
      message: `Filter plan revalidation flag ${filterPlan.requiresPostFilterRevalidation} does not match filter steps.`,
      remediation: 'Derive requiresPostFilterRevalidation from destructive or revalidation-required filter steps.',
    });
  }
}

function createPostSliceFilterStep(
  filter: SmartCutFilterDefinition,
  index: number,
): SmartCutPostSliceFilterPlanStep {
  return {
    index,
    filterId: filter.id,
    stage: filter.stage,
    requiredEvidence: [...filter.requiredEvidence],
    destructive: filter.destructive,
    requiresRevalidation: filter.requiresRevalidation,
    nativeAcceleration: filter.nativeAcceleration,
  };
}
