import type {
  SmartCutCandidate,
  SmartCutContentUnit,
  SmartCutPlan,
  SmartCutSourceMedia,
  SmartCutTranscriptEvidence,
  SmartCutVisualEvidence,
} from './domain.ts';
import type {
  SmartCutLlmCandidateReviewReport,
} from './llm-review.ts';
import { validateSmartCutLlmCandidateReviewReport } from './llm-review.ts';
import {
  selectSmartCutCandidates,
  type SmartCutCandidateSelectionReport,
} from './candidate-selection.ts';
import {
  type SmartCutContentUnitEvidenceLinkReport,
  validateSmartCutContentUnitEvidenceLink,
} from './content-unit-evidence-link.ts';
import type { SmartCutContentUnitBuildReport } from './content-units.ts';
import { validateSmartCutContentUnitBuildReport } from './content-units.ts';
import {
  type SmartCutEvidenceQualityValidationReport,
  type SmartCutVisualEvidenceQualityValidationReport,
  validateSmartCutEvidenceQuality,
  validateSmartCutVisualEvidenceQuality,
} from './evidence-quality.ts';
import {
  type SmartCutFilteredCandidate,
  type SmartCutFilterEffect,
  type SmartCutFilterEffectValidationReport,
  validateSmartCutFilterEffects,
} from './filter-effects.ts';
import {
  createSmartCutPostSliceFilterPlan,
  type SmartCutPostSliceFilterPlan,
  type SmartCutPostSliceFilterPlanValidationReport,
  validateSmartCutPostSliceFilterPlan,
} from './filter-plan.ts';
import {
  createSmartCutNativeCommandRequest,
  type SmartCutNativeCommandRequest,
  type SmartCutNativeCommandRequestValidationReport,
  validateSmartCutNativeCommandRequest,
} from './native-contract.ts';
import type { SmartCutNativeCommandId, SmartCutPipelineStepId } from './pipeline.ts';
import {
  type SmartCutCandidatePlanValidationReport,
  validateSmartCutCandidatePlan,
} from './pipeline.ts';
import { SMART_CUT_PRODUCT_PRESET_REGISTRY, type SmartCutProductPresetId } from './presets.ts';
import {
  type SmartCutRenderArtifact,
  type SmartCutRenderArtifactValidationReport,
  validateSmartCutRenderArtifacts,
} from './render-artifacts.ts';
import {
  createSmartCutRenderContract,
  type SmartCutRenderContract,
  type SmartCutRenderContractValidationReport,
  validateSmartCutRenderContract,
} from './render-contract.ts';
import {
  type SmartCutSemanticBoundaryProofReport,
  validateSmartCutSemanticBoundaryProof,
} from './semantic-boundary.ts';
import type {
  SmartCutTranscriptSpeakerAlignmentBlocker,
  SmartCutTranscriptSpeakerAlignmentReport,
} from './speaker-alignment.ts';
import type { SmartCutSpeakerEvidence } from './speaker.ts';

export interface SmartCutExecutionPackageInput {
  runId: string;
  sourceMedia: SmartCutSourceMedia;
  transcriptEvidence?: SmartCutTranscriptEvidence;
  speakerEvidence?: SmartCutSpeakerEvidence;
  visualEvidence?: SmartCutVisualEvidence;
  speakerAlignmentReport?: SmartCutTranscriptSpeakerAlignmentReport;
  contentUnits: readonly SmartCutContentUnit[];
  contentUnitBuildReport?: SmartCutContentUnitBuildReport;
  llmReviewReport?: SmartCutLlmCandidateReviewReport;
  plan: SmartCutPlan;
  targetCandidateCount?: number;
  filterExecutionResult?: SmartCutFilterExecutionResult;
  renderExecutionResult?: SmartCutRenderExecutionResult;
}

export interface SmartCutFilterExecutionResult {
  filteredCandidates: readonly SmartCutFilteredCandidate[];
  effects: readonly SmartCutFilterEffect[];
}

export interface SmartCutRenderExecutionResult {
  artifacts: readonly SmartCutRenderArtifact[];
}

export interface SmartCutExecutionPackage {
  ready: boolean;
  runId: string;
  sourceMediaId: string;
  planId: string;
  evidenceQuality?: SmartCutEvidenceQualityValidationReport;
  visualEvidenceQuality?: SmartCutVisualEvidenceQualityValidationReport;
  speakerAlignmentReport?: SmartCutTranscriptSpeakerAlignmentReport;
  contentUnitBuildReport?: SmartCutContentUnitBuildReport;
  contentUnitEvidenceLink?: SmartCutContentUnitEvidenceLinkReport;
  llmReviewReport?: SmartCutLlmCandidateReviewReport;
  semanticBoundaryProof: SmartCutSemanticBoundaryProofReport;
  candidateSelection: SmartCutCandidateSelectionReport;
  candidateValidation: SmartCutCandidatePlanValidationReport;
  filterPlan?: SmartCutPostSliceFilterPlan;
  filterValidation?: SmartCutPostSliceFilterPlanValidationReport;
  filterEffectValidation?: SmartCutFilterEffectValidationReport;
  renderContract?: SmartCutRenderContract;
  renderValidation?: SmartCutRenderContractValidationReport;
  renderArtifactValidation?: SmartCutRenderArtifactValidationReport;
  nativeRequests: readonly SmartCutNativeCommandRequest[];
  nativeValidations: readonly SmartCutNativeCommandRequestValidationReport[];
  blockers: readonly SmartCutExecutionPackageBlocker[];
}

export interface SmartCutExecutionPackageBlocker {
  code: string;
  message: string;
  remediation: string;
  source:
    | 'speech-to-text'
    | 'speaker-diarization'
    | 'evidence-quality'
    | 'speaker-alignment'
    | 'content-unit-build'
    | 'content-unit-evidence-link'
    | 'llm-review'
    | 'semantic-boundary'
    | 'candidate-selection'
    | 'candidate-validation'
    | 'filter-validation'
    | 'filter-effect-validation'
    | 'render-validation'
    | 'render-artifact-validation'
    | 'native-validation';
}

const candidateValidatedStepIds = [
  'prepare-source',
  'extract-native-evidence',
  'speech-to-text',
  'speaker-diarization',
  'align-transcript-speakers',
  'build-content-units',
  'run-slicer-chain',
  'llm-review-rank',
  'validate-candidates',
] as const satisfies readonly SmartCutPipelineStepId[];

const readyNativeExecutionCommandIds = [
  'smart_cut_validate_candidates',
  'smart_cut_apply_filter_plan',
  'smart_cut_validate_filtered_plan',
  'smart_cut_render_plan',
  'smart_cut_probe_artifacts',
] as const satisfies readonly SmartCutNativeCommandId[];

export function createSmartCutExecutionPackage(input: SmartCutExecutionPackageInput): SmartCutExecutionPackage {
  const presetId = resolveExecutionPackagePresetId(input.plan.presetId);
  const evidenceQuality = createExecutionPackageEvidenceQualityReport(input, presetId);
  const visualEvidenceQuality = createExecutionPackageVisualEvidenceQualityReport(input, presetId);
  const speakerAlignmentReport = createExecutionPackageSpeakerAlignmentReport(input);
  const contentUnitBuildReport = createExecutionPackageContentUnitBuildReport(input, presetId);
  const contentUnitEvidenceLink = createExecutionPackageContentUnitEvidenceLinkReport(input);
  const llmReviewReport = createExecutionPackageLlmReviewReport(input);
  const candidateValidation = validateSmartCutCandidatePlan({
    presetId,
    sourceDurationMs: input.sourceMedia.durationMs,
    contentUnits: input.contentUnits,
    candidates: input.plan.candidates,
  });
  const semanticBoundaryProof = validateSmartCutSemanticBoundaryProof({
    presetId,
    contentUnits: input.contentUnits,
    candidates: input.plan.candidates,
    ...(input.speakerEvidence !== undefined ? { speakerEvidence: input.speakerEvidence } : {}),
  });
  const candidateSelection = selectSmartCutCandidates({
    presetId,
    contentUnits: input.contentUnits,
    candidates: input.plan.candidates,
    llmReviewReport,
    ...(input.targetCandidateCount !== undefined ? { targetCount: input.targetCandidateCount } : {}),
  });
  const selectedCandidates = candidateSelection.selectedCandidates;
  const candidateIntervals = selectedCandidates.map(createNativeIntervalFromCandidate);
  const nativeRequests: SmartCutNativeCommandRequest[] = [
    createExecutionPackageNativeRequest({
      input,
      presetId,
      commandId: 'smart_cut_validate_candidates',
      intervals: candidateIntervals,
      payload: {
        planId: input.plan.id,
      },
    }),
  ];
  const nativeValidations: SmartCutNativeCommandRequestValidationReport[] = [
    validateSmartCutNativeCommandRequest({
      request: nativeRequests[0] ?? failMissingNativeRequest(),
      sourceDurationMs: input.sourceMedia.durationMs,
    }),
  ];
  const firstNativeValidation = nativeValidations[0] ?? {
    ready: false,
    blockers: [],
    intervalCount: 0,
  };
  const blockers: SmartCutExecutionPackageBlocker[] = [
    ...(evidenceQuality?.blockers ?? []).map((blocker) => ({
      code: blocker.code,
      message: blocker.message,
      remediation: blocker.remediation,
      source: 'evidence-quality' as const,
    })),
    ...(visualEvidenceQuality?.blockers ?? []).map((blocker) => ({
      code: blocker.code,
      message: blocker.message,
      remediation: blocker.remediation,
      source: 'evidence-quality' as const,
    })),
    ...(speakerAlignmentReport?.blockers ?? []).map((blocker) => ({
      code: blocker.code,
      message: blocker.message,
      remediation: blocker.remediation,
      source: 'speaker-alignment' as const,
    })),
    ...contentUnitBuildReport.blockers.map((blocker) => ({
      code: blocker.code,
      message: blocker.message,
      remediation: blocker.remediation,
      source: 'content-unit-build' as const,
    })),
    ...(contentUnitEvidenceLink?.blockers ?? []).map((blocker) => ({
      code: blocker.code,
      message: blocker.message,
      remediation: blocker.remediation,
      source: 'content-unit-evidence-link' as const,
    })),
    ...llmReviewReport.blockers.map((blocker) => ({
      code: blocker.code,
      message: blocker.message,
      remediation: blocker.remediation,
      source: 'llm-review' as const,
    })),
    ...semanticBoundaryProof.blockers.map((blocker) => ({
      code: blocker.code,
      message: blocker.message,
      remediation: blocker.remediation,
      source: 'semantic-boundary' as const,
    })),
    ...candidateSelection.blockers.map((blocker) => ({
      code: blocker.code,
      message: blocker.message,
      remediation: blocker.remediation,
      source: 'candidate-selection' as const,
    })),
    ...candidateValidation.blockers.map((blocker) => ({
      code: blocker.code,
      message: blocker.message,
      remediation: blocker.remediation,
      source: 'candidate-validation' as const,
    })),
    ...firstNativeValidation.blockers.map((blocker) => ({
      code: blocker.code,
      message: blocker.message,
      remediation: blocker.remediation,
      source: 'native-validation' as const,
    })),
  ];

  if (
    evidenceQuality?.ready === false ||
    visualEvidenceQuality?.ready === false ||
    speakerAlignmentReport?.ready === false ||
    !contentUnitBuildReport.ready ||
    contentUnitEvidenceLink?.ready === false ||
    !llmReviewReport.ready ||
    !semanticBoundaryProof.ready ||
    !candidateSelection.ready ||
    !candidateValidation.ready
  ) {
    return {
      ready: false,
      runId: input.runId,
      sourceMediaId: input.sourceMedia.id,
      planId: input.plan.id,
      ...(evidenceQuality !== undefined ? { evidenceQuality } : {}),
      ...(visualEvidenceQuality !== undefined ? { visualEvidenceQuality } : {}),
      ...(speakerAlignmentReport !== undefined ? { speakerAlignmentReport } : {}),
      contentUnitBuildReport,
      ...(contentUnitEvidenceLink !== undefined ? { contentUnitEvidenceLink } : {}),
      llmReviewReport,
      semanticBoundaryProof,
      candidateSelection,
      candidateValidation,
      nativeRequests,
      nativeValidations,
      blockers,
    };
  }

  const filterPlan = createSmartCutPostSliceFilterPlan({
    presetId,
    planId: input.plan.id,
    candidateIds: selectedCandidates.map((candidate) => candidate.id),
    completedPipelineStepIds: candidateValidatedStepIds,
  });
  const filterValidation = validateSmartCutPostSliceFilterPlan({
    filterPlan,
    completedPipelineStepIds: candidateValidatedStepIds,
  });
  blockers.push(...filterValidation.blockers.map((blocker) => ({
    code: blocker.code,
    message: blocker.message,
    remediation: blocker.remediation,
    source: 'filter-validation' as const,
  })));

  const filterNativeRequest = createExecutionPackageNativeRequest({
    input,
    presetId,
    commandId: 'smart_cut_apply_filter_plan',
    intervals: candidateIntervals,
    payload: createNativePayloadForExecutionCommand('smart_cut_apply_filter_plan', filterPlan.id, undefined),
  });
  nativeRequests.push(filterNativeRequest);
  const filterNativeValidation = validateSmartCutNativeCommandRequest({
    request: filterNativeRequest,
    sourceDurationMs: input.sourceMedia.durationMs,
  });
  nativeValidations.push(filterNativeValidation);
  blockers.push(...filterNativeValidation.blockers.map((blocker) => ({
    code: blocker.code,
    message: blocker.message,
    remediation: blocker.remediation,
    source: 'native-validation' as const,
  })));

  const filteredPlanNativeRequest = createExecutionPackageNativeRequest({
    input,
    presetId,
    commandId: 'smart_cut_validate_filtered_plan',
    intervals: candidateIntervals,
    payload: createNativePayloadForExecutionCommand('smart_cut_validate_filtered_plan', filterPlan.id, undefined),
  });
  nativeRequests.push(filteredPlanNativeRequest);
  const filteredPlanNativeValidation = validateSmartCutNativeCommandRequest({
    request: filteredPlanNativeRequest,
    sourceDurationMs: input.sourceMedia.durationMs,
  });
  nativeValidations.push(filteredPlanNativeValidation);
  blockers.push(...filteredPlanNativeValidation.blockers.map((blocker) => ({
    code: blocker.code,
    message: blocker.message,
    remediation: blocker.remediation,
    source: 'native-validation' as const,
  })));

  const filterEffectValidation = input.filterExecutionResult !== undefined
    ? validateSmartCutFilterEffects({
      presetId,
      filterPlan,
      sourceCandidates: selectedCandidates,
      contentUnits: input.contentUnits,
      filteredCandidates: input.filterExecutionResult.filteredCandidates,
      effects: input.filterExecutionResult.effects,
    })
    : undefined;
  if (filterEffectValidation !== undefined) {
    blockers.push(...filterEffectValidation.blockers.map((blocker) => ({
      code: blocker.code,
      message: blocker.message,
      remediation: blocker.remediation,
      source: 'filter-effect-validation' as const,
    })));
  }

  const renderResultWithoutValidatedFilterEffects = input.renderExecutionResult !== undefined && filterEffectValidation === undefined;
  if (renderResultWithoutValidatedFilterEffects) {
    blockers.push({
      code: 'MISSING_FILTER_EXECUTION_RESULT_BEFORE_RENDER',
      message: 'Execution package received render artifacts before validated post-filter effects.',
      remediation: 'Validate native post-slice filter effects before accepting render artifacts.',
      source: 'filter-effect-validation',
    });
  }

  if (
    filterValidation.ready === false ||
    filterNativeValidation.ready === false ||
    filteredPlanNativeValidation.ready === false ||
    filterEffectValidation?.ready === false ||
    renderResultWithoutValidatedFilterEffects
  ) {
    return {
      ready: false,
      runId: input.runId,
      sourceMediaId: input.sourceMedia.id,
      planId: input.plan.id,
      ...(evidenceQuality !== undefined ? { evidenceQuality } : {}),
      ...(visualEvidenceQuality !== undefined ? { visualEvidenceQuality } : {}),
      ...(speakerAlignmentReport !== undefined ? { speakerAlignmentReport } : {}),
      contentUnitBuildReport,
      ...(contentUnitEvidenceLink !== undefined ? { contentUnitEvidenceLink } : {}),
      llmReviewReport,
      semanticBoundaryProof,
      candidateSelection,
      candidateValidation,
      filterPlan,
      filterValidation,
      ...(filterEffectValidation !== undefined ? { filterEffectValidation } : {}),
      nativeRequests,
      nativeValidations,
      blockers,
    };
  }

  const renderContract = createSmartCutRenderContract({
    presetId,
    planId: filterPlan.id,
    candidateIds: selectedCandidates.map((candidate) => candidate.id),
  });
  const renderValidation = validateSmartCutRenderContract({ renderContract });
  blockers.push(...renderValidation.blockers.map((blocker) => ({
    code: blocker.code,
    message: blocker.message,
    remediation: blocker.remediation,
    source: 'render-validation' as const,
  })));

  const renderArtifactValidation = input.renderExecutionResult !== undefined
    ? validateSmartCutRenderArtifacts({
      renderContract,
      artifacts: input.renderExecutionResult.artifacts,
    })
    : undefined;
  if (renderArtifactValidation !== undefined) {
    blockers.push(...renderArtifactValidation.blockers.map((blocker) => ({
      code: blocker.code,
      message: blocker.message,
      remediation: blocker.remediation,
      source: 'render-artifact-validation' as const,
    })));
  }

  for (const commandId of readyNativeExecutionCommandIds.slice(3)) {
    const request = createExecutionPackageNativeRequest({
      input,
      presetId,
      commandId,
      intervals: candidateIntervals,
      payload: createNativePayloadForExecutionCommand(commandId, filterPlan.id, renderContract.id),
    });
    nativeRequests.push(request);
    const validation = validateSmartCutNativeCommandRequest({
      request,
      sourceDurationMs: input.sourceMedia.durationMs,
    });
    nativeValidations.push(validation);
    blockers.push(...validation.blockers.map((blocker) => ({
      code: blocker.code,
      message: blocker.message,
      remediation: blocker.remediation,
      source: 'native-validation' as const,
    })));
  }

  return {
    ready: blockers.length === 0,
    runId: input.runId,
    sourceMediaId: input.sourceMedia.id,
    planId: input.plan.id,
    ...(evidenceQuality !== undefined ? { evidenceQuality } : {}),
    ...(visualEvidenceQuality !== undefined ? { visualEvidenceQuality } : {}),
    ...(speakerAlignmentReport !== undefined ? { speakerAlignmentReport } : {}),
    contentUnitBuildReport,
    ...(contentUnitEvidenceLink !== undefined ? { contentUnitEvidenceLink } : {}),
    llmReviewReport,
    semanticBoundaryProof,
    candidateSelection,
    candidateValidation,
    filterPlan,
    filterValidation,
    ...(filterEffectValidation !== undefined ? { filterEffectValidation } : {}),
    renderContract,
    renderValidation,
    ...(renderArtifactValidation !== undefined ? { renderArtifactValidation } : {}),
    nativeRequests,
    nativeValidations,
    blockers,
  };
}

function createExecutionPackageContentUnitEvidenceLinkReport(
  input: SmartCutExecutionPackageInput,
): SmartCutContentUnitEvidenceLinkReport | undefined {
  if (input.transcriptEvidence === undefined || input.speakerEvidence === undefined) {
    return undefined;
  }

  return validateSmartCutContentUnitEvidenceLink({
    contentUnits: input.contentUnits,
    transcriptEvidence: input.transcriptEvidence,
    speakerEvidence: input.speakerEvidence,
  });
}

function createExecutionPackageLlmReviewReport(
  input: SmartCutExecutionPackageInput,
): SmartCutLlmCandidateReviewReport {
  const validation = validateSmartCutLlmCandidateReviewReport({
    ...(input.llmReviewReport !== undefined ? { report: input.llmReviewReport } : {}),
    candidates: input.plan.candidates,
    contentUnits: input.contentUnits,
  });
  return {
    ...(input.llmReviewReport ?? {}),
    ...(validation.evidence !== undefined ? { evidence: validation.evidence } : {}),
    ready: validation.ready,
    blockers: validation.blockers,
  };
}

function createExecutionPackageSpeakerAlignmentReport(
  input: SmartCutExecutionPackageInput,
): SmartCutTranscriptSpeakerAlignmentReport | undefined {
  if (isVisualOnlyExecutionPackage(input)) {
    return undefined;
  }

  if (input.speakerAlignmentReport === undefined) {
    return {
      ready: false,
      transcriptSegmentCount: input.transcriptEvidence?.segments.length ?? 0,
      alignedTranscriptSegmentCount: 0,
      unalignedTranscriptSegmentCount: input.transcriptEvidence?.segments.length ?? 0,
      turnCount: input.speakerEvidence?.turns.length ?? 0,
      turnIds: input.speakerEvidence?.turns.map((turn) => turn.id) ?? [],
      distinctSpeakerCount: input.speakerEvidence === undefined
        ? 0
        : new Set(input.speakerEvidence.turns.map((turn) => turn.speakerId)).size,
      blockers: [
        {
          code: 'MISSING_SPEAKER_ALIGNMENT_REPORT',
          message: 'Execution package requires the standard transcript-speaker alignment report.',
          remediation: 'Run transcript-speaker alignment and pass the resulting report plus aligned speaker evidence into the execution package.',
        },
      ],
    };
  }

  const blockers: SmartCutTranscriptSpeakerAlignmentBlocker[] = [
    ...input.speakerAlignmentReport.blockers,
  ];

  if (input.speakerAlignmentReport.ready === false) {
    blockers.push({
      code: 'SPEAKER_ALIGNMENT_REPORT_BLOCKED',
      message: 'Execution package received a blocked transcript-speaker alignment report.',
      remediation: 'Repair transcript timestamps, diarization coverage, and speaker identity before building content units.',
    });
  }

  if (input.speakerEvidence !== undefined && !executionPackageSpeakerAlignmentReportMatchesEvidence(input.speakerAlignmentReport, input.speakerEvidence)) {
    blockers.push({
      code: 'SPEAKER_ALIGNMENT_REPORT_MISMATCH',
      message: 'Execution package speaker turns do not match the standard transcript-speaker alignment report.',
      remediation: 'Use the exact aligned speaker evidence emitted by transcript-speaker alignment without mutating turn ids or counts.',
    });
  }

  if (!executionPackageSpeakerAlignmentReportMatchesTranscriptCoverage(input.speakerAlignmentReport, input)) {
    blockers.push({
      code: 'SPEAKER_ALIGNMENT_TRANSCRIPT_COVERAGE_MISMATCH',
      message: 'Execution package speaker alignment report does not account for the supplied transcript evidence.',
      remediation: 'Rerun transcript-speaker alignment with the exact transcript evidence and aligned speaker turns used for content units.',
    });
  }

  return {
    ...input.speakerAlignmentReport,
    ready: input.speakerAlignmentReport.ready && blockers.length === 0,
    blockers,
  };
}

function createExecutionPackageContentUnitBuildReport(
  input: SmartCutExecutionPackageInput,
  presetId: SmartCutProductPresetId,
): SmartCutContentUnitBuildReport {
  if (input.contentUnitBuildReport === undefined) {
    return {
      ready: false,
      presetId,
      units: input.contentUnits.map(cloneExecutionPackageContentUnit),
      unitCount: input.contentUnits.length,
      publishableUnitCount: 0,
      lowInformationUnitCount: 0,
      questionUnitCount: 0,
      answerUnitCount: 0,
      distinctSpeakerCount: countDistinctExecutionPackageSpeakers(input.contentUnits),
      blockers: [
        {
          code: 'MISSING_CONTENT_UNIT_BUILD_REPORT',
          message: 'Execution package requires a standard content unit build report.',
          remediation: 'Build content units with the standard content unit builder and pass its build report into the execution package.',
        },
      ],
    };
  }

  const validatedReport = validateSmartCutContentUnitBuildReport(input.contentUnitBuildReport);
  if (serializeExecutionPackageContentUnits(validatedReport.units) !== serializeExecutionPackageContentUnits(input.contentUnits)) {
    return {
      ...validatedReport,
      ready: false,
      blockers: [
        ...validatedReport.blockers,
        {
          code: 'CONTENT_UNIT_BUILD_REPORT_MISMATCH',
          message: 'Execution package content units do not match the standard content unit build report units.',
          remediation: 'Use the exact content units emitted by the standard content unit build report without mutation.',
        },
      ],
    };
  }

  return validatedReport;
}

function executionPackageSpeakerAlignmentReportMatchesEvidence(
  report: SmartCutTranscriptSpeakerAlignmentReport,
  speakerEvidence: SmartCutSpeakerEvidence,
): boolean {
  const evidenceTurnIds = speakerEvidence.turns.map((turn) => turn.id);
  return report.turnCount === speakerEvidence.turns.length &&
    report.turnIds.join('\u0000') === evidenceTurnIds.join('\u0000') &&
    report.distinctSpeakerCount === new Set(speakerEvidence.turns.map((turn) => turn.speakerId)).size;
}

function executionPackageSpeakerAlignmentReportMatchesTranscriptCoverage(
  report: SmartCutTranscriptSpeakerAlignmentReport,
  input: SmartCutExecutionPackageInput,
): boolean {
  if (input.transcriptEvidence === undefined || input.speakerEvidence === undefined) {
    return true;
  }

  const transcriptSegmentIds = new Set(input.transcriptEvidence.segments.map((segment) => segment.id));
  const alignedTranscriptSegmentIds = new Set<string>();
  for (const turn of input.speakerEvidence.turns) {
    for (const segmentId of turn.transcriptSegmentIds) {
      if (transcriptSegmentIds.has(segmentId)) {
        alignedTranscriptSegmentIds.add(segmentId);
      }
    }
  }

  const alignedTranscriptSegmentCount = alignedTranscriptSegmentIds.size;
  return report.transcriptSegmentCount === input.transcriptEvidence.segments.length &&
    report.alignedTranscriptSegmentCount === alignedTranscriptSegmentCount &&
    report.unalignedTranscriptSegmentCount === report.transcriptSegmentCount - report.alignedTranscriptSegmentCount;
}

function createExecutionPackageEvidenceQualityReport(
  input: SmartCutExecutionPackageInput,
  presetId: SmartCutProductPresetId,
): SmartCutEvidenceQualityValidationReport | undefined {
  if (isVisualOnlyExecutionPackage(input)) {
    return undefined;
  }

  if (input.transcriptEvidence !== undefined && input.speakerEvidence !== undefined) {
    return validateSmartCutEvidenceQuality({
      presetId,
      sourceMedia: input.sourceMedia,
      transcriptEvidence: input.transcriptEvidence,
      speakerEvidence: input.speakerEvidence,
    });
  }

  const blockers: SmartCutEvidenceQualityValidationReport['blockers'] = [
    ...(input.transcriptEvidence === undefined
      ? [{
        code: 'MISSING_TRANSCRIPT_EVIDENCE' as const,
        message: 'Execution package requires timestamped transcript evidence before slicing.',
        remediation: 'Run speech-to-text and provide transcript evidence before building an execution package.',
      }]
      : []),
    ...(input.speakerEvidence === undefined
      ? [{
        code: 'MISSING_SPEAKER_DIARIZATION' as const,
        message: 'Execution package requires speaker diarization evidence before slicing.',
        remediation: 'Run speaker diarization and provide speaker evidence before building an execution package.',
      }]
      : []),
  ];

  return {
    ready: false,
    transcriptReady: input.transcriptEvidence !== undefined,
    speakerReady: input.speakerEvidence !== undefined,
    alignmentReady: false,
    roleReady: false,
    requiredSpeakerRoles: [],
    metrics: {
      transcriptSegmentCount: input.transcriptEvidence?.segments.length ?? 0,
      speakerSegmentCount: input.speakerEvidence?.segments.length ?? 0,
      distinctSpeakerCount: input.speakerEvidence?.profiles.length ?? 0,
      alignedTranscriptSegmentCount: 0,
      averageTranscriptConfidence: 0,
      speakerCoverageRatio: 0,
    },
    blockers,
  };
}

function createExecutionPackageVisualEvidenceQualityReport(
  input: SmartCutExecutionPackageInput,
  presetId: SmartCutProductPresetId,
): SmartCutVisualEvidenceQualityValidationReport | undefined {
  if (presetId !== 'film-scene-index' && input.visualEvidence === undefined) {
    return undefined;
  }

  return validateSmartCutVisualEvidenceQuality({
    presetId,
    sourceMedia: input.sourceMedia,
    visualEvidence: input.visualEvidence as SmartCutVisualEvidence,
  });
}

function isVisualOnlyExecutionPackage(input: SmartCutExecutionPackageInput): boolean {
  return input.plan.presetId === 'film-scene-index' &&
    input.visualEvidence !== undefined &&
    input.transcriptEvidence === undefined &&
    input.speakerEvidence === undefined;
}

function serializeExecutionPackageContentUnits(units: readonly SmartCutContentUnit[]): string {
  return JSON.stringify(units.map((unit) => ({
    id: unit.id,
    startMs: unit.startMs,
    endMs: unit.endMs,
    unitKind: unit.unitKind,
    text: unit.text ?? '',
    speakerIds: [...unit.speakerIds],
    speakerTurnIds: [...unit.speakerTurnIds],
    speakerRoles: [...unit.speakerRoles],
    speakerConfidence: unit.speakerConfidence,
    overlapGroupIds: [...unit.overlapGroupIds],
    transcriptSegmentIds: [...unit.transcriptSegmentIds],
    evidenceIds: [...unit.evidenceIds],
    topicIds: [...unit.topicIds],
    completenessScore: unit.completenessScore,
    continuityScore: unit.continuityScore,
    publishabilityScore: unit.publishabilityScore,
  })));
}

function cloneExecutionPackageContentUnit(unit: SmartCutContentUnit): SmartCutContentUnit {
  return {
    ...unit,
    speakerIds: [...unit.speakerIds],
    speakerTurnIds: [...unit.speakerTurnIds],
    speakerRoles: [...unit.speakerRoles],
    overlapGroupIds: [...unit.overlapGroupIds],
    transcriptSegmentIds: [...unit.transcriptSegmentIds],
    evidenceIds: [...unit.evidenceIds],
    topicIds: [...unit.topicIds],
  };
}

function countDistinctExecutionPackageSpeakers(units: readonly SmartCutContentUnit[]): number {
  return new Set(units.flatMap((unit) => unit.speakerIds)).size;
}

function createExecutionPackageNativeRequest({
  input,
  presetId,
  commandId,
  intervals,
  payload,
}: {
  input: SmartCutExecutionPackageInput;
  presetId: SmartCutProductPresetId;
  commandId: SmartCutNativeCommandId;
  intervals: readonly ReturnType<typeof createNativeIntervalFromCandidate>[];
  payload: Record<string, unknown>;
}): SmartCutNativeCommandRequest {
  return createSmartCutNativeCommandRequest({
    commandId,
    runId: input.runId,
    presetId,
    sourceMediaId: input.sourceMedia.id,
    sourceUri: input.sourceMedia.uri,
    intervals,
    payload,
  });
}

function resolveExecutionPackagePresetId(presetId: string): SmartCutProductPresetId {
  const preset = SMART_CUT_PRODUCT_PRESET_REGISTRY.find((entry) => entry.id === presetId);
  if (preset === undefined) {
    throw new Error(`Unknown smart cut product preset: ${presetId}`);
  }

  return preset.id;
}

function failMissingNativeRequest(): SmartCutNativeCommandRequest {
  throw new Error('Smart cut execution package failed to create the candidate validation native request.');
}

function createNativeIntervalFromCandidate(candidate: SmartCutCandidate) {
  return {
    id: candidate.id,
    startMs: candidate.startMs,
    endMs: candidate.endMs,
    unitIds: [...candidate.unitIds],
  };
}

function createNativePayloadForExecutionCommand(
  commandId: SmartCutNativeCommandId,
  filterPlanId: string,
  renderContractId: string | undefined,
): Record<string, unknown> {
  if (commandId === 'smart_cut_apply_filter_plan' || commandId === 'smart_cut_validate_filtered_plan') {
    return {
      filterPlanId,
    };
  }

  if (commandId === 'smart_cut_render_plan' || commandId === 'smart_cut_probe_artifacts') {
    return {
      renderContractId,
    };
  }

  return {};
}
