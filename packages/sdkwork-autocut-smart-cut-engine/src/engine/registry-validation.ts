import {
  SMART_CUT_DEFAULT_PRODUCT_PRESET_ID,
  SMART_CUT_DEFAULT_SLICER_ID,
  type SmartCutEvidenceKind,
} from './domain.ts';
import {
  SMART_CUT_FILTER_REGISTRY,
  type SmartCutFilterDefinition,
  type SmartCutFilterId,
} from './filters.ts';
import {
  SMART_CUT_PRODUCT_PRESET_REGISTRY,
  type SmartCutProductPresetDefinition,
  type SmartCutRendererId,
} from './presets.ts';
import {
  SMART_CUT_SLICER_REGISTRY,
  type SmartCutSlicerDefinition,
  type SmartCutSlicerId,
} from './slicers.ts';
import {
  SMART_CUT_VALIDATOR_REGISTRY,
  type SmartCutValidatorDefinition,
  type SmartCutValidatorId,
} from './validators.ts';

export type SmartCutRegistryValidationBlockerCode =
  | 'DUPLICATE_SLICER_ID'
  | 'DUPLICATE_FILTER_ID'
  | 'DUPLICATE_VALIDATOR_ID'
  | 'DUPLICATE_PRODUCT_PRESET_ID'
  | 'DEFAULT_SLICER_NOT_REGISTERED'
  | 'DEFAULT_PRODUCT_PRESET_NOT_REGISTERED'
  | 'PRESET_REFERENCES_UNKNOWN_SLICER'
  | 'PRESET_REFERENCES_UNKNOWN_FILTER'
  | 'PRESET_REFERENCES_UNKNOWN_VALIDATOR'
  | 'PRESET_REFERENCES_UNKNOWN_RENDERER'
  | 'SPEECH_SLICER_MISSING_TRANSCRIPT_EVIDENCE'
  | 'SPEECH_SLICER_MISSING_SPEAKER_EVIDENCE'
  | 'SPEECH_SLICER_ALLOWS_UNKNOWN_SPEAKER'
  | 'DIALOGUE_SLICER_MISSING_DIARIZATION'
  | 'DIALOGUE_SLICER_MISSING_ROLE_ASSIGNMENT'
  | 'DIALOGUE_SLICER_ALLOWS_UNKNOWN_SPEAKER'
  | 'LLM_SLICER_ALLOWS_RAW_TIME_RANGES'
  | 'DESTRUCTIVE_FILTER_WITHOUT_REVALIDATION'
  | 'SPEECH_PRESET_MISSING_SPEAKER_DIARIZATION'
  | 'SPEECH_PRESET_MISSING_SPEAKER_CONTINUITY_VALIDATOR'
  | 'SPEECH_PRESET_MISSING_SEMANTIC_COMPLETENESS_VALIDATOR'
  | 'VISUAL_PRESET_MISSING_EVIDENCE_COVERAGE_VALIDATOR';

export interface SmartCutRegistryValidationInput {
  slicers?: readonly SmartCutSlicerDefinition[];
  filters?: readonly SmartCutFilterDefinition[];
  validators?: readonly SmartCutValidatorDefinition[];
  productPresets?: readonly SmartCutProductPresetDefinition[];
  renderers?: readonly SmartCutRendererId[];
}

export interface SmartCutRegistryValidationBlocker {
  code: SmartCutRegistryValidationBlockerCode;
  message: string;
  remediation: string;
  subjectId?: string;
}

export interface SmartCutProductPresetRegistrySummary {
  id: string;
  slicerIds: readonly SmartCutSlicerId[];
  requiredEvidence: readonly SmartCutEvidenceKind[];
  requiresTranscript: boolean;
  requiresSpeaker: boolean;
  requiresAudio: boolean;
  requiresVisual: boolean;
  requiresSpeakerDiarization: boolean;
  hasSpeakerContinuityValidator: boolean;
  hasSemanticCompletenessValidator: boolean;
}

export interface SmartCutRegistryValidationMetrics {
  slicerCount: number;
  filterCount: number;
  validatorCount: number;
  productPresetCount: number;
  speechFirstPresetCount: number;
  multimodalPresetCount: number;
  destructiveFilterCount: number;
  failClosedValidatorCount: number;
  blockerCount: number;
}

export interface SmartCutRegistryValidationReport {
  ready: boolean;
  metrics: SmartCutRegistryValidationMetrics;
  blockers: readonly SmartCutRegistryValidationBlocker[];
  productPresetSummaries: readonly SmartCutProductPresetRegistrySummary[];
}

const knownRendererIds = [
  'publishable-short-video',
  'batch-short-video',
  'chapter-index',
  'highlight-reel',
  'asset-only',
] as const satisfies readonly SmartCutRendererId[];

export function validateSmartCutStrategyRegistry(
  input: SmartCutRegistryValidationInput = {},
): SmartCutRegistryValidationReport {
  const slicers = input.slicers ?? SMART_CUT_SLICER_REGISTRY;
  const filters = input.filters ?? SMART_CUT_FILTER_REGISTRY;
  const validators = input.validators ?? SMART_CUT_VALIDATOR_REGISTRY;
  const productPresets = input.productPresets ?? SMART_CUT_PRODUCT_PRESET_REGISTRY;
  const rendererIds = input.renderers ?? knownRendererIds;

  const blockers: SmartCutRegistryValidationBlocker[] = [];
  const slicersById = new Map(slicers.map((slicer) => [slicer.id, slicer]));
  const filtersById = new Map(filters.map((filter) => [filter.id, filter]));
  const validatorsById = new Map(validators.map((validator) => [validator.id, validator]));
  const knownRendererIdSet = new Set(rendererIds);

  validateRegistryStructure({
    slicers,
    filters,
    validators,
    productPresets,
    slicersById,
    productPresetsById: new Map(productPresets.map((preset) => [preset.id, preset])),
    blockers,
  });
  validateSlicers(slicers, blockers);
  validateFilters(filters, blockers);
  validateProductPresets({
    productPresets,
    slicersById,
    filtersById,
    validatorsById,
    knownRendererIdSet,
    blockers,
  });

  const productPresetSummaries = productPresets.map((preset) =>
    createProductPresetSummary(preset, slicersById)
  );

  return {
    ready: blockers.length === 0,
    metrics: {
      slicerCount: slicers.length,
      filterCount: filters.length,
      validatorCount: validators.length,
      productPresetCount: productPresets.length,
      speechFirstPresetCount: productPresetSummaries.filter((summary) => summary.requiresTranscript).length,
      multimodalPresetCount: productPresetSummaries.filter((summary) =>
        summary.requiredEvidence.length >= 2 &&
          (summary.requiresAudio || summary.requiresVisual) &&
          !summary.requiresTranscript
      ).length,
      destructiveFilterCount: filters.filter((filter) => filter.destructive).length,
      failClosedValidatorCount: validators.filter((validator) => validator.failClosed).length,
      blockerCount: blockers.length,
    },
    blockers,
    productPresetSummaries,
  };
}

function validateRegistryStructure({
  slicers,
  filters,
  validators,
  productPresets,
  slicersById,
  productPresetsById,
  blockers,
}: {
  slicers: readonly SmartCutSlicerDefinition[];
  filters: readonly SmartCutFilterDefinition[];
  validators: readonly SmartCutValidatorDefinition[];
  productPresets: readonly SmartCutProductPresetDefinition[];
  slicersById: ReadonlyMap<SmartCutSlicerId, SmartCutSlicerDefinition>;
  productPresetsById: ReadonlyMap<string, SmartCutProductPresetDefinition>;
  blockers: SmartCutRegistryValidationBlocker[];
}) {
  pushDuplicateIdBlockers(
    slicers.map((slicer) => slicer.id),
    'DUPLICATE_SLICER_ID',
    'Slicer registry contains duplicate id.',
    'Every slicer strategy id must be globally unique.',
    blockers,
  );
  pushDuplicateIdBlockers(
    filters.map((filter) => filter.id),
    'DUPLICATE_FILTER_ID',
    'Filter registry contains duplicate id.',
    'Every filter strategy id must be globally unique.',
    blockers,
  );
  pushDuplicateIdBlockers(
    validators.map((validator) => validator.id),
    'DUPLICATE_VALIDATOR_ID',
    'Validator registry contains duplicate id.',
    'Every validator strategy id must be globally unique.',
    blockers,
  );
  pushDuplicateIdBlockers(
    productPresets.map((preset) => preset.id),
    'DUPLICATE_PRODUCT_PRESET_ID',
    'Product preset registry contains duplicate id.',
    'Every product preset id must be globally unique.',
    blockers,
  );

  if (!slicersById.has(SMART_CUT_DEFAULT_SLICER_ID)) {
    blockers.push(createRegistryBlocker(
      'DEFAULT_SLICER_NOT_REGISTERED',
      `Default slicer ${SMART_CUT_DEFAULT_SLICER_ID} is not registered.`,
      'Register the default speech-first slicer in the slicer registry.',
      SMART_CUT_DEFAULT_SLICER_ID,
    ));
  }

  if (!productPresetsById.has(SMART_CUT_DEFAULT_PRODUCT_PRESET_ID)) {
    blockers.push(createRegistryBlocker(
      'DEFAULT_PRODUCT_PRESET_NOT_REGISTERED',
      `Default product preset ${SMART_CUT_DEFAULT_PRODUCT_PRESET_ID} is not registered.`,
      'Register the default teacher talking-head product preset.',
      SMART_CUT_DEFAULT_PRODUCT_PRESET_ID,
    ));
  }
}

function pushDuplicateIdBlockers(
  ids: readonly string[],
  code: SmartCutRegistryValidationBlockerCode,
  message: string,
  remediation: string,
  blockers: SmartCutRegistryValidationBlocker[],
) {
  const seen = new Set<string>();
  const reported = new Set<string>();
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      continue;
    }
    if (reported.has(id)) {
      continue;
    }
    blockers.push(createRegistryBlocker(code, `${message} Duplicate id: ${id}.`, remediation, id));
    reported.add(id);
  }
}

function validateSlicers(
  slicers: readonly SmartCutSlicerDefinition[],
  blockers: SmartCutRegistryValidationBlocker[],
) {
  for (const slicer of slicers) {
    if (slicer.family === 'speech' && !slicer.requiredEvidence.includes('transcript')) {
      blockers.push(createRegistryBlocker(
        'SPEECH_SLICER_MISSING_TRANSCRIPT_EVIDENCE',
        `Speech slicer ${slicer.id} does not require transcript evidence.`,
        'Speech-family slicers must require transcript evidence before planning semantic boundaries.',
        slicer.id,
      ));
    }

    if ((slicer.family === 'speech' || slicer.family === 'dialogue') && !slicer.requiredEvidence.includes('speaker')) {
      blockers.push(createRegistryBlocker(
        'SPEECH_SLICER_MISSING_SPEAKER_EVIDENCE',
        `Speech-aware slicer ${slicer.id} does not require speaker evidence.`,
        'Speech and dialogue slicers must require first-class speaker evidence.',
        slicer.id,
      ));
    }

    if (slicer.family === 'speech' && slicer.speakerPolicy.allowsUnknownSpeaker) {
      blockers.push(createRegistryBlocker(
        'SPEECH_SLICER_ALLOWS_UNKNOWN_SPEAKER',
        `Speech slicer ${slicer.id} allows unknown speakers.`,
        'Speech semantic slicing must preserve known speaker identity before content-unit planning.',
        slicer.id,
      ));
    }

    if (slicer.family === 'dialogue' && !slicer.speakerPolicy.requiresDiarization) {
      blockers.push(createRegistryBlocker(
        'DIALOGUE_SLICER_MISSING_DIARIZATION',
        `Dialogue slicer ${slicer.id} does not require diarization.`,
        'Dialogue slicers must require diarization to preserve speaker turns.',
        slicer.id,
      ));
    }

    if (slicer.family === 'dialogue' && !slicer.speakerPolicy.requiresRoleAssignment) {
      blockers.push(createRegistryBlocker(
        'DIALOGUE_SLICER_MISSING_ROLE_ASSIGNMENT',
        `Dialogue slicer ${slicer.id} does not require role assignment.`,
        'Dialogue slicers must require speaker role assignment for Q/A and host/guest continuity.',
        slicer.id,
      ));
    }

    if (slicer.family === 'dialogue' && slicer.speakerPolicy.allowsUnknownSpeaker) {
      blockers.push(createRegistryBlocker(
        'DIALOGUE_SLICER_ALLOWS_UNKNOWN_SPEAKER',
        `Dialogue slicer ${slicer.id} allows unknown speakers.`,
        'Dialogue slicing must reject unknown speakers before Q/A pairing.',
        slicer.id,
      ));
    }

    if (slicer.llmPolicy.mayCreateRawTimeRanges) {
      blockers.push(createRegistryBlocker(
        'LLM_SLICER_ALLOWS_RAW_TIME_RANGES',
        `Slicer ${slicer.id} allows LLM raw time ranges.`,
        'LLM-enabled slicers must use stable ids only and must not create raw time ranges.',
        slicer.id,
      ));
    }
  }
}

function validateFilters(
  filters: readonly SmartCutFilterDefinition[],
  blockers: SmartCutRegistryValidationBlocker[],
) {
  for (const filter of filters) {
    if (filter.destructive && !filter.requiresRevalidation) {
      blockers.push(createRegistryBlocker(
        'DESTRUCTIVE_FILTER_WITHOUT_REVALIDATION',
        `Destructive filter ${filter.id} does not require revalidation.`,
        'Every destructive filter must require post-filter validation before render.',
        filter.id,
      ));
    }
  }
}

function validateProductPresets({
  productPresets,
  slicersById,
  filtersById,
  validatorsById,
  knownRendererIdSet,
  blockers,
}: {
  productPresets: readonly SmartCutProductPresetDefinition[];
  slicersById: ReadonlyMap<SmartCutSlicerId, SmartCutSlicerDefinition>;
  filtersById: ReadonlyMap<SmartCutFilterId, SmartCutFilterDefinition>;
  validatorsById: ReadonlyMap<SmartCutValidatorId, SmartCutValidatorDefinition>;
  knownRendererIdSet: ReadonlySet<SmartCutRendererId>;
  blockers: SmartCutRegistryValidationBlocker[];
}) {
  for (const preset of productPresets) {
    for (const slicerId of preset.slicerChain) {
      if (!slicersById.has(slicerId)) {
        blockers.push(createRegistryBlocker(
          'PRESET_REFERENCES_UNKNOWN_SLICER',
          `Preset ${preset.id} references unknown slicer ${slicerId}.`,
          'Register every preset slicer id in the smart cut slicer registry.',
          preset.id,
        ));
      }
    }

    for (const filterId of preset.filters) {
      if (!filtersById.has(filterId)) {
        blockers.push(createRegistryBlocker(
          'PRESET_REFERENCES_UNKNOWN_FILTER',
          `Preset ${preset.id} references unknown filter ${filterId}.`,
          'Register every preset filter id in the smart cut filter registry.',
          preset.id,
        ));
      }
    }

    for (const validatorId of preset.validators) {
      if (!validatorsById.has(validatorId)) {
        blockers.push(createRegistryBlocker(
          'PRESET_REFERENCES_UNKNOWN_VALIDATOR',
          `Preset ${preset.id} references unknown validator ${validatorId}.`,
          'Register every preset validator id in the smart cut validator registry.',
          preset.id,
        ));
      }
    }

    for (const rendererId of preset.renderers) {
      if (!knownRendererIdSet.has(rendererId)) {
        blockers.push(createRegistryBlocker(
          'PRESET_REFERENCES_UNKNOWN_RENDERER',
          `Preset ${preset.id} references unknown renderer ${rendererId}.`,
          'Register every preset renderer id in the smart cut renderer contract set.',
          preset.id,
        ));
      }
    }

    const summary = createProductPresetSummary(preset, slicersById);
    if (summary.requiresTranscript && !preset.requiresSpeakerDiarization) {
      blockers.push(createRegistryBlocker(
        'SPEECH_PRESET_MISSING_SPEAKER_DIARIZATION',
        `Speech preset ${preset.id} does not require speaker diarization.`,
        'Speech-first presets must require speaker diarization so content units preserve speaker identity.',
        preset.id,
      ));
    }

    if (summary.requiresTranscript && !preset.validators.includes('speaker-continuity')) {
      blockers.push(createRegistryBlocker(
        'SPEECH_PRESET_MISSING_SPEAKER_CONTINUITY_VALIDATOR',
        `Speech preset ${preset.id} is missing speaker-continuity validation.`,
        'Speech-first presets must validate speaker continuity before filters and render.',
        preset.id,
      ));
    }

    if (summary.requiresTranscript && !preset.validators.includes('semantic-completeness')) {
      blockers.push(createRegistryBlocker(
        'SPEECH_PRESET_MISSING_SEMANTIC_COMPLETENESS_VALIDATOR',
        `Speech preset ${preset.id} is missing semantic-completeness validation.`,
        'Speech-first presets must validate semantic completeness before filters and render.',
        preset.id,
      ));
    }

    if (summary.requiresVisual && !preset.validators.includes('evidence-coverage')) {
      blockers.push(createRegistryBlocker(
        'VISUAL_PRESET_MISSING_EVIDENCE_COVERAGE_VALIDATOR',
        `Visual preset ${preset.id} is missing evidence-coverage validation.`,
        'Visual and multimodal presets must validate required native evidence coverage.',
        preset.id,
      ));
    }
  }
}

function createProductPresetSummary(
  preset: SmartCutProductPresetDefinition,
  slicersById: ReadonlyMap<SmartCutSlicerId, SmartCutSlicerDefinition>,
): SmartCutProductPresetRegistrySummary {
  const requiredEvidence = uniqueEvidenceKinds(preset.slicerChain.flatMap((slicerId) =>
    slicersById.get(slicerId)?.requiredEvidence ?? []
  ));

  return {
    id: preset.id,
    slicerIds: [...preset.slicerChain],
    requiredEvidence,
    requiresTranscript: requiredEvidence.includes('transcript'),
    requiresSpeaker: requiredEvidence.includes('speaker'),
    requiresAudio: requiredEvidence.includes('audio'),
    requiresVisual: requiredEvidence.includes('visual'),
    requiresSpeakerDiarization: preset.requiresSpeakerDiarization,
    hasSpeakerContinuityValidator: preset.validators.includes('speaker-continuity'),
    hasSemanticCompletenessValidator: preset.validators.includes('semantic-completeness'),
  };
}

function uniqueEvidenceKinds(values: readonly SmartCutEvidenceKind[]): readonly SmartCutEvidenceKind[] {
  return [...new Set(values)];
}

function createRegistryBlocker(
  code: SmartCutRegistryValidationBlockerCode,
  message: string,
  remediation: string,
  subjectId: string,
): SmartCutRegistryValidationBlocker {
  return {
    code,
    message,
    remediation,
    subjectId,
  };
}
