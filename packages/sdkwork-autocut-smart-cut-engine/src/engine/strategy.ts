import type {
  SmartCutAudioEvidence,
  SmartCutCandidate,
  SmartCutContentUnit,
  SmartCutLlmReviewEvidence,
  SmartCutOutputProfile,
  SmartCutPlan,
  SmartCutSourceMedia,
  SmartCutTranscriptEvidence,
  SmartCutVisualEvidence,
} from './domain.ts';
import type { SmartCutFilterId } from './filters.ts';
import type { SmartCutNativeCommandId } from './pipeline.ts';
import type { SmartCutProductPresetId, SmartCutRendererId } from './presets.ts';
import type { SmartCutSlicerId } from './slicers.ts';
import type {
  SmartCutSpeakerCorrection,
  SmartCutSpeakerEvidence,
} from './speaker.ts';
import type { SmartCutValidatorId } from './validators.ts';

export const SMART_CUT_STRATEGY_CONTRACT_VERSION = '2026-05-14.smart-cut-strategy-contract.v1' as const;

export const typeSmartCutStrategyContractNames = [
  'SmartCutSlicerStrategy',
  'SmartCutFilterStrategy',
  'SmartCutValidatorStrategy',
  'SmartCutRendererStrategy',
  'SmartCutSpeechToTextProvider',
  'SmartCutSpeakerDiarizationProvider',
  'SmartCutLlmCandidateReviewer',
  'SmartCutNativeEngineAdapter',
  'SmartCutStrategyRuntimeContext',
  'SmartCutManualCorrectionStore',
  'SmartCutPostSliceFilterPlan',
  'SmartCutRenderContract',
  'SmartCutNativeCommandRequest',
  'SmartCutExecutionPackage',
  'SmartCutEvidenceQualityValidationReport',
  'SmartCutSemanticBoundaryProofReport',
  'SmartCutCandidateSelectionReport',
  'SmartCutLlmCandidateReviewReport',
  'SmartCutLlmCandidateReviewValidationReport',
  'SmartCutFilterEffectValidationReport',
  'SmartCutExecutionAuditTrace',
  'SmartCutProviderExecutionAuditTrace',
  'SmartCutRenderArtifactValidationReport',
  'SmartCutContentUnitBuildReport',
  'SmartCutSpeechSemanticPlan',
  'SmartCutSpeechFirstExecutionPackageResult',
  'SmartCutSpeechFirstProviderExecutionPackageResult',
  'SmartCutSpeechFirstProviderExecutionStageStatuses',
  'SmartCutSpeechFirstProviderIds',
  'SmartCutRegistryValidationReport',
  'SmartCutRegistryValidationBlocker',
  'SmartCutProductPresetRegistrySummary',
  'SmartCutRegistryValidationMetrics',
] as const;

export type SmartCutStrategyContractName = typeof typeSmartCutStrategyContractNames[number];

export interface SmartCutStrategyRuntimeContext {
  runId: string;
  presetId: SmartCutProductPresetId;
  sourceMedia: SmartCutSourceMedia;
  maximumCandidateDurationMs?: number;
  maximumCandidateGapMs?: number;
  cancellationSignal?: AbortSignal;
  log: SmartCutStrategyLogger;
}

export interface SmartCutStrategyLogger {
  info(message: string, details?: Record<string, unknown>): void;
  warn(message: string, details?: Record<string, unknown>): void;
  error(message: string, details?: Record<string, unknown>): void;
}

export interface SmartCutSlicerInput {
  context: SmartCutStrategyRuntimeContext;
  contentUnits: readonly SmartCutContentUnit[];
  transcriptEvidence?: SmartCutTranscriptEvidence;
  speakerEvidence?: SmartCutSpeakerEvidence;
  audioEvidence?: SmartCutAudioEvidence;
  visualEvidence?: SmartCutVisualEvidence;
  llmReviewEvidence?: SmartCutLlmReviewEvidence;
}

export interface SmartCutSlicerOutput {
  slicerId: SmartCutSlicerId;
  candidates: readonly SmartCutCandidate[];
  diagnostics: readonly SmartCutStrategyDiagnostic[];
}

export interface SmartCutSlicerStrategy {
  readonly id: SmartCutSlicerId;
  plan(input: SmartCutSlicerInput): Promise<SmartCutSlicerOutput>;
}

export interface SmartCutFilterInput {
  context: SmartCutStrategyRuntimeContext;
  plan: SmartCutPlan;
  filterId: SmartCutFilterId;
}

export interface SmartCutFilterOutput {
  filterId: SmartCutFilterId;
  plan: SmartCutPlan;
  destructive: boolean;
  requiresRevalidation: boolean;
  diagnostics: readonly SmartCutStrategyDiagnostic[];
}

export interface SmartCutFilterStrategy {
  readonly id: SmartCutFilterId;
  apply(input: SmartCutFilterInput): Promise<SmartCutFilterOutput>;
}

export interface SmartCutValidatorInput {
  context: SmartCutStrategyRuntimeContext;
  plan: SmartCutPlan;
  validatorId: SmartCutValidatorId;
}

export interface SmartCutValidationOutput {
  validatorId: SmartCutValidatorId;
  ready: boolean;
  blockers: readonly SmartCutStrategyBlocker[];
  diagnostics: readonly SmartCutStrategyDiagnostic[];
}

export interface SmartCutValidatorStrategy {
  readonly id: SmartCutValidatorId;
  validate(input: SmartCutValidatorInput): Promise<SmartCutValidationOutput>;
}

export interface SmartCutRendererInput {
  context: SmartCutStrategyRuntimeContext;
  plan: SmartCutPlan;
  rendererId: SmartCutRendererId;
  outputProfile: SmartCutOutputProfile;
}

export interface SmartCutRendererOutput {
  rendererId: SmartCutRendererId;
  artifacts: readonly SmartCutRenderedArtifact[];
  diagnostics: readonly SmartCutStrategyDiagnostic[];
}

export interface SmartCutRendererStrategy {
  readonly id: SmartCutRendererId;
  render(input: SmartCutRendererInput): Promise<SmartCutRendererOutput>;
}

export interface SmartCutSpeechToTextProviderInput {
  context: SmartCutStrategyRuntimeContext;
  language: 'auto' | string;
}

export interface SmartCutSpeechToTextProvider {
  readonly id: string;
  transcribe(input: SmartCutSpeechToTextProviderInput): Promise<SmartCutTranscriptEvidence>;
}

export interface SmartCutSpeakerDiarizationProviderInput {
  context: SmartCutStrategyRuntimeContext;
  transcriptEvidence?: SmartCutTranscriptEvidence;
}

export interface SmartCutSpeakerDiarizationProvider {
  readonly id: string;
  diarize(input: SmartCutSpeakerDiarizationProviderInput): Promise<SmartCutSpeakerEvidence>;
}

export interface SmartCutLlmCandidateReviewerInput {
  context: SmartCutStrategyRuntimeContext;
  contentUnits: readonly SmartCutContentUnit[];
  candidates: readonly SmartCutCandidate[];
}

export interface SmartCutLlmCandidateReviewer {
  readonly id: string;
  readonly model: string;
  review(input: SmartCutLlmCandidateReviewerInput): Promise<unknown>;
}

export interface SmartCutNativeEngineAdapter {
  readonly id: string;
  execute<TRequest, TResponse>(
    commandId: SmartCutNativeCommandId,
    request: TRequest,
  ): Promise<TResponse>;
}

export interface SmartCutManualCorrectionStore {
  listSpeakerCorrections(runId: string): Promise<readonly SmartCutSpeakerCorrection[]>;
  saveSpeakerCorrection(runId: string, correction: SmartCutSpeakerCorrection): Promise<void>;
}

export interface SmartCutStrategyDiagnostic {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  details?: Record<string, unknown>;
}

export interface SmartCutStrategyBlocker {
  code: string;
  message: string;
  remediation: string;
  details?: Record<string, unknown>;
}

export interface SmartCutRenderedArtifact {
  id: string;
  kind: 'video' | 'subtitle' | 'cover' | 'quality-report' | 'thumbnail';
  path: string;
  byteSize: number;
  checksum?: string;
}
