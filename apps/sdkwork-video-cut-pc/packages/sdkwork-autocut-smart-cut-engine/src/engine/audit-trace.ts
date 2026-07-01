import { SMART_CUT_STANDARD_VERSION } from './domain.ts';
import type { SmartCutExecutionPackage, SmartCutExecutionPackageBlocker } from './execution-package.ts';
import type { SmartCutSpeechFirstProviderExecutionPackageResult } from './speech-first-orchestration.ts';

export type SmartCutProviderExecutionAuditTraceInput = Omit<
  SmartCutSpeechFirstProviderExecutionPackageResult,
  'auditTrace'
>;

export type SmartCutExecutionAuditStageId =
  | 'speech-to-text'
  | 'speaker-diarization'
  | 'llm-provider-review'
  | 'evidence-quality'
  | 'speaker-alignment'
  | 'content-unit-build'
  | 'content-unit-evidence-link'
  | 'llm-review'
  | 'semantic-boundary'
  | 'candidate-selection'
  | 'candidate-validation'
  | 'filter-plan'
  | 'filter-validation'
  | 'filter-effect-validation'
  | 'render-contract'
  | 'render-validation'
  | 'render-artifact-validation'
  | 'native-validation';

export type SmartCutExecutionAuditStageStatus = 'passed' | 'blocked' | 'not-run';

export interface SmartCutExecutionAuditStage {
  id: SmartCutExecutionAuditStageId;
  status: SmartCutExecutionAuditStageStatus;
  blockerCount: number;
  outputCount: number;
}

export interface SmartCutExecutionAuditSummary {
  contentUnitCount: number;
  publishableContentUnitCount: number;
  lowInformationContentUnitCount: number;
  selectedCandidateCount: number;
  rejectedCandidateCount: number;
  llmRankedCandidateCount: number;
  filteredCandidateCount: number;
  filterEffectCount: number;
  nativeRequestCount: number;
  nativeValidationCount: number;
  renderArtifactCount: number;
  blockerCount: number;
  providerStageBlockerCount: number;
  speakerAlignmentBlockerCount: number;
  llmReviewBlockerCount: number;
  contentUnitEvidenceLinkBlockerCount: number;
  candidateValidationBlockerCount: number;
  candidateContentUnitStructureBlockerCount: number;
  candidateSpeakerContextBlockerCount: number;
  filterPlanCreated: boolean;
  renderContractCreated: boolean;
  blockedBeforeFilterPlan: boolean;
}

export interface SmartCutExecutionAuditBlockerGroup {
  source: SmartCutExecutionPackageBlocker['source'];
  count: number;
  codes: readonly string[];
  remediations: readonly string[];
}

export interface SmartCutExecutionAuditTrace {
  schemaVersion: typeof SMART_CUT_STANDARD_VERSION;
  ready: boolean;
  runId: string;
  sourceMediaId: string;
  planId: string;
  stages: readonly SmartCutExecutionAuditStage[];
  summary: SmartCutExecutionAuditSummary;
  blockerGroups: readonly SmartCutExecutionAuditBlockerGroup[];
  nativeCommandIds: readonly string[];
  providerIds?: {
    speechToText: string;
    speakerDiarization: string;
    llmReviewer: string;
  };
}

export function createSmartCutExecutionAuditTrace(
  executionPackage: SmartCutExecutionPackage,
): SmartCutExecutionAuditTrace {
  return {
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    ready: executionPackage.ready,
    runId: executionPackage.runId,
    sourceMediaId: executionPackage.sourceMediaId,
    planId: executionPackage.planId,
    stages: createAuditStages(executionPackage),
    summary: createAuditSummary(executionPackage),
    blockerGroups: createAuditBlockerGroups(executionPackage.blockers),
    nativeCommandIds: executionPackage.nativeRequests.map((request) => request.commandId),
  };
}

export function createSmartCutProviderExecutionAuditTrace(
  result: SmartCutProviderExecutionAuditTraceInput,
): SmartCutExecutionAuditTrace {
  const executionTrace = result.executionPackage === undefined
    ? undefined
    : createSmartCutExecutionAuditTrace(result.executionPackage);
  const planId = result.executionPackage?.planId ?? result.plan?.id ?? 'provider-pre-execution';
  const blockerGroups = createAuditBlockerGroups(result.blockers);

  return {
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    ready: result.ready,
    runId: result.runId,
    sourceMediaId: result.sourceMediaId,
    planId,
    stages: createProviderAuditStages(result, executionTrace),
    summary: createProviderAuditSummary(result, executionTrace),
    blockerGroups,
    nativeCommandIds: executionTrace?.nativeCommandIds ?? [],
    providerIds: { ...result.providerIds },
  };
}

function createAuditStages(executionPackage: SmartCutExecutionPackage): readonly SmartCutExecutionAuditStage[] {
  return [
    {
      id: 'evidence-quality',
      status: optionalReportStageStatus(executionPackage, 'evidence-quality', executionPackage.evidenceQuality?.ready),
      blockerCount: optionalReportStageBlockerCount(executionPackage, 'evidence-quality', executionPackage.evidenceQuality?.blockers.length),
      outputCount: executionPackage.evidenceQuality?.metrics.transcriptSegmentCount ?? 0,
    },
    {
      id: 'speaker-alignment',
      status: optionalReportStageStatus(executionPackage, 'speaker-alignment', executionPackage.speakerAlignmentReport?.ready),
      blockerCount: optionalReportStageBlockerCount(executionPackage, 'speaker-alignment', executionPackage.speakerAlignmentReport?.blockers.length),
      outputCount: executionPackage.speakerAlignmentReport?.turnCount ?? 0,
    },
    {
      id: 'content-unit-build',
      status: optionalReportStageStatus(executionPackage, 'content-unit-build', executionPackage.contentUnitBuildReport?.ready),
      blockerCount: optionalReportStageBlockerCount(executionPackage, 'content-unit-build', executionPackage.contentUnitBuildReport?.blockers.length),
      outputCount: executionPackage.contentUnitBuildReport?.unitCount ?? 0,
    },
    {
      id: 'content-unit-evidence-link',
      status: optionalReportStageStatus(executionPackage, 'content-unit-evidence-link', executionPackage.contentUnitEvidenceLink?.ready),
      blockerCount: optionalReportStageBlockerCount(
        executionPackage,
        'content-unit-evidence-link',
        executionPackage.contentUnitEvidenceLink?.blockers.length,
      ),
      outputCount: executionPackage.contentUnitEvidenceLink?.metrics.unitCount ?? 0,
    },
    {
      id: 'llm-review',
      status: optionalReportStageStatus(executionPackage, 'llm-review', executionPackage.llmReviewReport?.ready),
      blockerCount: optionalReportStageBlockerCount(executionPackage, 'llm-review', executionPackage.llmReviewReport?.blockers.length),
      outputCount: executionPackage.llmReviewReport?.evidence?.referencedCandidateIds.length ?? 0,
    },
    {
      id: 'semantic-boundary',
      status: reportReadyStatus(executionPackage.semanticBoundaryProof.ready),
      blockerCount: executionPackage.semanticBoundaryProof.blockers.length,
      outputCount: executionPackage.semanticBoundaryProof.candidateReports.length,
    },
    {
      id: 'candidate-selection',
      status: reportReadyStatus(executionPackage.candidateSelection.ready),
      blockerCount: executionPackage.candidateSelection.blockers.length,
      outputCount: executionPackage.candidateSelection.metrics.selectedCount,
    },
    {
      id: 'candidate-validation',
      status: reportReadyStatus(executionPackage.candidateValidation.ready),
      blockerCount: executionPackage.candidateValidation.blockers.length,
      outputCount: executionPackage.candidateValidation.candidateCount,
    },
    {
      id: 'filter-plan',
      status: executionPackage.filterPlan === undefined ? 'not-run' : 'passed',
      blockerCount: 0,
      outputCount: executionPackage.filterPlan?.candidateIds.length ?? 0,
    },
    {
      id: 'filter-validation',
      status: optionalReportStageStatus(executionPackage, 'filter-validation', executionPackage.filterValidation?.ready),
      blockerCount: optionalReportStageBlockerCount(executionPackage, 'filter-validation', executionPackage.filterValidation?.blockers.length),
      outputCount: executionPackage.filterValidation?.filterCount ?? 0,
    },
    {
      id: 'filter-effect-validation',
      status: optionalReportStageStatus(executionPackage, 'filter-effect-validation', executionPackage.filterEffectValidation?.ready),
      blockerCount: optionalReportStageBlockerCount(
        executionPackage,
        'filter-effect-validation',
        executionPackage.filterEffectValidation?.blockers.length,
      ),
      outputCount: executionPackage.filterEffectValidation?.filteredCandidateCount ?? 0,
    },
    {
      id: 'render-contract',
      status: executionPackage.renderContract === undefined ? 'not-run' : 'passed',
      blockerCount: 0,
      outputCount: executionPackage.renderContract?.candidateIds.length ?? 0,
    },
    {
      id: 'render-validation',
      status: optionalReportStageStatus(executionPackage, 'render-validation', executionPackage.renderValidation?.ready),
      blockerCount: optionalReportStageBlockerCount(executionPackage, 'render-validation', executionPackage.renderValidation?.blockers.length),
      outputCount: executionPackage.renderValidation?.candidateCount ?? 0,
    },
    {
      id: 'render-artifact-validation',
      status: optionalReportStageStatus(executionPackage, 'render-artifact-validation', executionPackage.renderArtifactValidation?.ready),
      blockerCount: optionalReportStageBlockerCount(
        executionPackage,
        'render-artifact-validation',
        executionPackage.renderArtifactValidation?.blockers.length,
      ),
      outputCount: executionPackage.renderArtifactValidation?.artifactCount ?? 0,
    },
    {
      id: 'native-validation',
      status: executionPackage.nativeValidations.every((validation) => validation.ready) ? 'passed' : 'blocked',
      blockerCount: executionPackage.nativeValidations.reduce((sum, validation) => sum + validation.blockers.length, 0),
      outputCount: executionPackage.nativeValidations.length,
    },
  ];
}

function createAuditSummary(executionPackage: SmartCutExecutionPackage): SmartCutExecutionAuditSummary {
  const candidateValidationBlockerCodes = executionPackage.candidateValidation.blockers.map((blocker) => blocker.code);

  return {
    contentUnitCount: executionPackage.contentUnitBuildReport?.unitCount ?? executionPackage.candidateValidation.contentUnitCount,
    publishableContentUnitCount: executionPackage.contentUnitBuildReport?.publishableUnitCount ?? 0,
    lowInformationContentUnitCount: executionPackage.contentUnitBuildReport?.lowInformationUnitCount ?? 0,
    selectedCandidateCount: executionPackage.candidateSelection.metrics.selectedCount,
    rejectedCandidateCount: executionPackage.candidateSelection.metrics.rejectedCount,
    llmRankedCandidateCount: executionPackage.candidateSelection.metrics.llmRankedCandidateCount,
    filteredCandidateCount: executionPackage.filterEffectValidation?.filteredCandidateCount ?? 0,
    filterEffectCount: executionPackage.filterEffectValidation?.effectCount ?? 0,
    nativeRequestCount: executionPackage.nativeRequests.length,
    nativeValidationCount: executionPackage.nativeValidations.length,
    renderArtifactCount: executionPackage.renderArtifactValidation?.artifactCount ?? 0,
    blockerCount: executionPackage.blockers.length,
    providerStageBlockerCount: 0,
    speakerAlignmentBlockerCount: executionPackage.speakerAlignmentReport?.blockers.length ?? 0,
    llmReviewBlockerCount: executionPackage.llmReviewReport?.blockers.length ?? 0,
    contentUnitEvidenceLinkBlockerCount: executionPackage.contentUnitEvidenceLink?.blockers.length ?? 0,
    candidateValidationBlockerCount: executionPackage.candidateValidation.blockers.length,
    candidateContentUnitStructureBlockerCount: candidateValidationBlockerCodes.filter(isContentUnitStructureBlockerCode).length,
    candidateSpeakerContextBlockerCount: candidateValidationBlockerCodes.filter(isSpeakerContextBlockerCode).length,
    filterPlanCreated: executionPackage.filterPlan !== undefined,
    renderContractCreated: executionPackage.renderContract !== undefined,
    blockedBeforeFilterPlan: executionPackage.ready === false && executionPackage.filterPlan === undefined,
  };
}

function createProviderAuditStages(
  result: SmartCutProviderExecutionAuditTraceInput,
  executionTrace: SmartCutExecutionAuditTrace | undefined,
): readonly SmartCutExecutionAuditStage[] {
  return [
    {
      id: 'speech-to-text',
      status: result.stageStatuses.speechToText,
      blockerCount: countBlockersBySource(result.blockers, 'speech-to-text'),
      outputCount: countArrayItems(result.transcriptEvidence?.segments),
    },
    {
      id: 'speaker-diarization',
      status: result.stageStatuses.speakerDiarization,
      blockerCount: countBlockersBySource(result.blockers, 'speaker-diarization'),
      outputCount: countArrayItems(result.speakerEvidence?.segments),
    },
    {
      id: 'llm-provider-review',
      status: result.stageStatuses.llmProviderReview,
      blockerCount: countBlockersBySource(result.blockers, 'llm-review'),
      outputCount: countArrayItems(result.llmReviewReport?.evidence?.referencedCandidateIds),
    },
    ...(executionTrace?.stages ?? createProviderPreExecutionStages(result)),
  ];
}

function createProviderPreExecutionStages(
  result: SmartCutProviderExecutionAuditTraceInput,
): readonly SmartCutExecutionAuditStage[] {
  return [
    {
      id: 'evidence-quality',
      status: 'not-run',
      blockerCount: 0,
      outputCount: countArrayItems(result.transcriptEvidence?.segments),
    },
    {
      id: 'speaker-alignment',
      status: result.stageStatuses.speakerAlignment,
      blockerCount: countBlockersBySource(result.blockers, 'speaker-alignment'),
      outputCount: result.speakerAlignment?.report.turnCount ?? 0,
    },
    {
      id: 'content-unit-build',
      status: result.stageStatuses.contentUnitBuild,
      blockerCount: countBlockersBySource(result.blockers, 'content-unit-build'),
      outputCount: result.plan?.contentUnitBuildReport.unitCount ?? 0,
    },
    {
      id: 'content-unit-evidence-link',
      status: 'not-run',
      blockerCount: 0,
      outputCount: 0,
    },
    {
      id: 'llm-review',
      status: result.stageStatuses.llmReview,
      blockerCount: countBlockersBySource(result.blockers, 'llm-review'),
      outputCount: countArrayItems(result.llmReviewReport?.evidence?.referencedCandidateIds),
    },
    {
      id: 'semantic-boundary',
      status: 'not-run',
      blockerCount: 0,
      outputCount: 0,
    },
    {
      id: 'candidate-selection',
      status: 'not-run',
      blockerCount: 0,
      outputCount: 0,
    },
    {
      id: 'candidate-validation',
      status: 'not-run',
      blockerCount: 0,
      outputCount: result.plan?.candidates.length ?? 0,
    },
    {
      id: 'filter-plan',
      status: 'not-run',
      blockerCount: 0,
      outputCount: 0,
    },
    {
      id: 'filter-validation',
      status: 'not-run',
      blockerCount: 0,
      outputCount: 0,
    },
    {
      id: 'filter-effect-validation',
      status: 'not-run',
      blockerCount: 0,
      outputCount: 0,
    },
    {
      id: 'render-contract',
      status: 'not-run',
      blockerCount: 0,
      outputCount: 0,
    },
    {
      id: 'render-validation',
      status: 'not-run',
      blockerCount: 0,
      outputCount: 0,
    },
    {
      id: 'render-artifact-validation',
      status: 'not-run',
      blockerCount: 0,
      outputCount: 0,
    },
    {
      id: 'native-validation',
      status: 'not-run',
      blockerCount: 0,
      outputCount: 0,
    },
  ];
}

function createProviderAuditSummary(
  result: SmartCutProviderExecutionAuditTraceInput,
  executionTrace: SmartCutExecutionAuditTrace | undefined,
): SmartCutExecutionAuditSummary {
  const baseSummary = executionTrace?.summary ?? createEmptyProviderAuditSummary(result);
  return {
    ...baseSummary,
    blockerCount: result.blockers.length,
    providerStageBlockerCount: countProviderStageBlockers(result.blockers),
  };
}

function createEmptyProviderAuditSummary(
  result: SmartCutProviderExecutionAuditTraceInput,
): SmartCutExecutionAuditSummary {
  return {
    contentUnitCount: result.plan?.contentUnitBuildReport.unitCount ?? 0,
    publishableContentUnitCount: result.plan?.contentUnitBuildReport.publishableUnitCount ?? 0,
    lowInformationContentUnitCount: result.plan?.contentUnitBuildReport.lowInformationUnitCount ?? 0,
    selectedCandidateCount: 0,
    rejectedCandidateCount: 0,
    llmRankedCandidateCount: 0,
    filteredCandidateCount: 0,
    filterEffectCount: 0,
    nativeRequestCount: 0,
    nativeValidationCount: 0,
    renderArtifactCount: 0,
    blockerCount: result.blockers.length,
    providerStageBlockerCount: countProviderStageBlockers(result.blockers),
    speakerAlignmentBlockerCount: countBlockersBySource(result.blockers, 'speaker-alignment'),
    llmReviewBlockerCount: countBlockersBySource(result.blockers, 'llm-review'),
    contentUnitEvidenceLinkBlockerCount: countBlockersBySource(result.blockers, 'content-unit-evidence-link'),
    candidateValidationBlockerCount: countBlockersBySource(result.blockers, 'candidate-validation'),
    candidateContentUnitStructureBlockerCount: 0,
    candidateSpeakerContextBlockerCount: 0,
    filterPlanCreated: false,
    renderContractCreated: false,
    blockedBeforeFilterPlan: !result.ready,
  };
}

function countBlockersBySource(
  blockers: readonly SmartCutExecutionPackageBlocker[],
  source: SmartCutExecutionPackageBlocker['source'],
): number {
  return blockers.filter((blocker) => blocker.source === source).length;
}

function countArrayItems(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function countProviderStageBlockers(
  blockers: readonly SmartCutExecutionPackageBlocker[],
): number {
  return blockers.filter((blocker) =>
    blocker.source === 'speech-to-text' ||
      blocker.source === 'speaker-diarization' ||
      blocker.source === 'llm-review'
  ).length;
}

function optionalReportStageStatus(
  executionPackage: SmartCutExecutionPackage,
  source: SmartCutExecutionPackageBlocker['source'],
  ready: boolean | undefined,
): SmartCutExecutionAuditStageStatus {
  if (ready !== undefined) {
    return reportReadyStatus(ready);
  }

  return countBlockersBySource(executionPackage.blockers, source) > 0 ? 'blocked' : 'not-run';
}

function optionalReportStageBlockerCount(
  executionPackage: SmartCutExecutionPackage,
  source: SmartCutExecutionPackageBlocker['source'],
  reportBlockerCount: number | undefined,
): number {
  return reportBlockerCount ?? countBlockersBySource(executionPackage.blockers, source);
}

function isContentUnitStructureBlockerCode(code: string): boolean {
  return code === 'CONTENT_UNIT_INVALID_RANGE' ||
    code === 'CONTENT_UNIT_WITHOUT_TRANSCRIPT' ||
    code === 'CONTENT_UNIT_WITHOUT_SPEAKER' ||
    code === 'CONTENT_UNIT_CROSSES_SPEAKERS';
}

function isSpeakerContextBlockerCode(code: string): boolean {
  return code === 'CONTENT_UNIT_WITHOUT_SPEAKER_TURN' ||
    code === 'CONTENT_UNIT_WITHOUT_SPEAKER_ROLE' ||
    code === 'CONTENT_UNIT_LOW_SPEAKER_CONFIDENCE';
}

function createAuditBlockerGroups(
  blockers: readonly SmartCutExecutionPackageBlocker[],
): readonly SmartCutExecutionAuditBlockerGroup[] {
  const blockersBySource = new Map<SmartCutExecutionPackageBlocker['source'], SmartCutExecutionPackageBlocker[]>();
  for (const blocker of blockers) {
    const sourceBlockers = blockersBySource.get(blocker.source);
    if (sourceBlockers === undefined) {
      blockersBySource.set(blocker.source, [blocker]);
    } else {
      sourceBlockers.push(blocker);
    }
  }

  return [...blockersBySource.entries()].map(([source, sourceBlockers]) => ({
    source,
    count: sourceBlockers.length,
    codes: uniqueValues(sourceBlockers.map((blocker) => blocker.code)),
    remediations: uniqueValues(sourceBlockers.map((blocker) => blocker.remediation)),
  }));
}

function reportReadyStatus(ready: boolean): SmartCutExecutionAuditStageStatus {
  return ready ? 'passed' : 'blocked';
}

function uniqueValues(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
