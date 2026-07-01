import type {
  SmartCutSourceMedia,
  SmartCutTranscriptEvidence,
} from './domain.ts';
import { SMART_CUT_STANDARD_VERSION } from './domain.ts';
import {
  createSmartCutExecutionAuditTrace,
  createSmartCutProviderExecutionAuditTrace,
  type SmartCutExecutionAuditTrace,
} from './audit-trace.ts';
import {
  createSmartCutExecutionPackage,
  type SmartCutExecutionPackage,
  type SmartCutExecutionPackageBlocker,
} from './execution-package.ts';
import {
  normalizeSmartCutLlmCandidateReview,
  type SmartCutLlmCandidateReviewReport,
} from './llm-review.ts';
import type { SmartCutProductPresetId } from './presets.ts';
import {
  alignSmartCutTranscriptSpeakers,
  type SmartCutTranscriptSpeakerAlignmentResult,
} from './speaker-alignment.ts';
import { validateSmartCutSpeakerEvidenceStructure } from './speaker-evidence-structure.ts';
import type { SmartCutSpeakerEvidence } from './speaker.ts';
import {
  createSpeechSemanticSlicePlan,
  type SmartCutSpeechSemanticPlan,
} from './speech-semantic.ts';
import type {
  SmartCutLlmCandidateReviewer,
  SmartCutSpeakerDiarizationProvider,
  SmartCutSpeechToTextProvider,
  SmartCutStrategyRuntimeContext,
} from './strategy.ts';

export interface CreateSmartCutSpeechFirstExecutionPackageInput {
  runId: string;
  sourceMedia: SmartCutSourceMedia;
  presetId: SmartCutProductPresetId;
  transcriptEvidence: SmartCutTranscriptEvidence;
  speakerEvidence: SmartCutSpeakerEvidence;
  llmReviewModel: string;
  rawLlmReview: unknown;
  maximumCandidateDurationMs?: number;
  maximumCandidateGapMs?: number;
  targetCandidateCount?: number;
}

export interface CreateSmartCutSpeechFirstExecutionPackageFromProvidersInput {
  context: SmartCutStrategyRuntimeContext;
  speechToTextProvider: SmartCutSpeechToTextProvider;
  speakerDiarizationProvider: SmartCutSpeakerDiarizationProvider;
  llmReviewer: SmartCutLlmCandidateReviewer;
  language?: 'auto' | string;
}

export interface SmartCutSpeechFirstExecutionPackageResult {
  ready: boolean;
  stageStatuses: SmartCutSpeechFirstExecutionStageStatuses;
  blockers: readonly SmartCutExecutionPackageBlocker[];
  speakerAlignment: SmartCutTranscriptSpeakerAlignmentResult;
  plan: SmartCutSpeechSemanticPlan;
  llmReviewReport: SmartCutLlmCandidateReviewReport;
  executionPackage: SmartCutExecutionPackage;
  auditTrace: SmartCutExecutionAuditTrace;
}

export interface SmartCutSpeechFirstProviderExecutionPackageResult {
  ready: boolean;
  runId: string;
  sourceMediaId: string;
  providerIds: SmartCutSpeechFirstProviderIds;
  stageStatuses: SmartCutSpeechFirstProviderExecutionStageStatuses;
  blockers: readonly SmartCutExecutionPackageBlocker[];
  transcriptEvidence?: SmartCutTranscriptEvidence;
  speakerEvidence?: SmartCutSpeakerEvidence;
  speakerAlignment?: SmartCutTranscriptSpeakerAlignmentResult;
  plan?: SmartCutSpeechSemanticPlan;
  llmReviewReport?: SmartCutLlmCandidateReviewReport;
  executionPackage?: SmartCutExecutionPackage;
  auditTrace: SmartCutExecutionAuditTrace;
}

export interface SmartCutSpeechFirstProviderIds {
  speechToText: string;
  speakerDiarization: string;
  llmReviewer: string;
}

export interface SmartCutSpeechFirstExecutionStageStatuses {
  speakerAlignment: 'passed' | 'blocked';
  contentUnitBuild: 'passed' | 'blocked';
  llmReview: 'passed' | 'blocked';
  executionPackage: 'passed' | 'blocked';
}

export interface SmartCutSpeechFirstProviderExecutionStageStatuses extends SmartCutSpeechFirstExecutionStageStatuses {
  speechToText: 'passed' | 'blocked';
  speakerDiarization: 'passed' | 'blocked';
  llmProviderReview: 'passed' | 'blocked';
}

export function createSmartCutSpeechFirstExecutionPackage(
  input: CreateSmartCutSpeechFirstExecutionPackageInput,
): SmartCutSpeechFirstExecutionPackageResult {
  const speakerAlignment = alignSmartCutTranscriptSpeakers({
    transcriptEvidence: input.transcriptEvidence,
    speakerEvidence: input.speakerEvidence,
  });
  const plan = createSpeechSemanticSlicePlan({
    sourceMediaId: input.sourceMedia.id,
    sourceDurationMs: input.sourceMedia.durationMs,
    presetId: input.presetId,
    transcriptEvidence: input.transcriptEvidence,
    speakerEvidence: speakerAlignment.speakerEvidence,
    ...(input.maximumCandidateDurationMs !== undefined
      ? { maximumCandidateDurationMs: input.maximumCandidateDurationMs }
      : {}),
    ...(input.maximumCandidateGapMs !== undefined
      ? { maximumCandidateGapMs: input.maximumCandidateGapMs }
      : {}),
  });
  const contentUnits = plan.contentUnitBuildReport.units;
  const llmReviewReport = normalizeSmartCutLlmCandidateReview({
    model: input.llmReviewModel,
    availableCandidateIds: plan.candidates.map((candidate) => candidate.id),
    availableUnitIds: contentUnits.map((unit) => unit.id),
    availableTimeSliceIds: plan.candidates.map((candidate) => `time-slice-${candidate.id}`),
    availableSpeakerIds: [...new Set(contentUnits.flatMap((unit) => unit.speakerIds))],
    availableSpeakerTurnIds: [...new Set(contentUnits.flatMap((unit) => unit.speakerTurnIds))],
    rawReview: input.rawLlmReview,
  });
  const executionPackage = createSmartCutExecutionPackage({
    runId: input.runId,
    sourceMedia: input.sourceMedia,
    transcriptEvidence: input.transcriptEvidence,
    speakerEvidence: speakerAlignment.speakerEvidence,
    speakerAlignmentReport: speakerAlignment.report,
    contentUnits,
    contentUnitBuildReport: plan.contentUnitBuildReport,
    llmReviewReport,
    plan,
    ...(input.targetCandidateCount !== undefined ? { targetCandidateCount: input.targetCandidateCount } : {}),
  });
  const auditTrace = createSmartCutExecutionAuditTrace(executionPackage);
  const stageStatuses = createSpeechFirstStageStatuses({
    speakerAlignment,
    plan,
    llmReviewReport,
    executionPackage,
  });

  return {
    ready: executionPackage.ready,
    stageStatuses,
    blockers: createSpeechFirstBlockers({
      speakerAlignment,
      plan,
      llmReviewReport,
      executionPackage,
    }),
    speakerAlignment,
    plan,
    llmReviewReport,
    executionPackage,
    auditTrace,
  };
}

export async function createSmartCutSpeechFirstExecutionPackageFromProviders(
  input: CreateSmartCutSpeechFirstExecutionPackageFromProvidersInput,
): Promise<SmartCutSpeechFirstProviderExecutionPackageResult> {
  const providerIds = {
    speechToText: input.speechToTextProvider.id,
    speakerDiarization: input.speakerDiarizationProvider.id,
    llmReviewer: input.llmReviewer.id,
  };
  let transcriptEvidence: SmartCutTranscriptEvidence;
  try {
    transcriptEvidence = await input.speechToTextProvider.transcribe({
      context: input.context,
      language: input.language ?? 'auto',
    });
  } catch (error) {
    return createProviderBlockedResult({
      runId: input.context.runId,
      sourceMediaId: input.context.sourceMedia.id,
      providerIds,
      blockers: [
        createProviderBlocker({
          code: 'SPEECH_TO_TEXT_PROVIDER_FAILED',
          message: `Speech-to-text provider ${input.speechToTextProvider.id} failed before returning transcript evidence.`,
          remediation: 'Fix the STT provider, retry transcription, and do not continue to diarization, LLM review, filters, or render without transcript evidence.',
          source: 'speech-to-text',
          error,
        }),
      ],
      stageStatuses: createProviderBlockedStageStatuses('speech-to-text'),
    });
  }
  const transcriptBlockers = validateProviderTranscriptEvidence(
    transcriptEvidence,
    input.context.sourceMedia.durationMs,
  );
  if (transcriptBlockers.length > 0) {
    return createProviderBlockedResult({
      runId: input.context.runId,
      sourceMediaId: input.context.sourceMedia.id,
      providerIds,
      blockers: transcriptBlockers,
      transcriptEvidence,
      stageStatuses: createProviderBlockedStageStatuses('speech-to-text'),
    });
  }

  let speakerEvidence: SmartCutSpeakerEvidence;
  try {
    speakerEvidence = await input.speakerDiarizationProvider.diarize({
      context: input.context,
      transcriptEvidence,
    });
  } catch (error) {
    return createProviderBlockedResult({
      runId: input.context.runId,
      sourceMediaId: input.context.sourceMedia.id,
      providerIds,
      blockers: [
        createProviderBlocker({
          code: 'SPEAKER_DIARIZATION_PROVIDER_FAILED',
          message: `Speaker diarization provider ${input.speakerDiarizationProvider.id} failed before returning speaker evidence.`,
          remediation: 'Fix the diarization provider, retry speaker evidence extraction, and do not continue to alignment, LLM review, filters, or render without speaker evidence.',
          source: 'speaker-diarization',
          error,
        }),
      ],
      transcriptEvidence,
      stageStatuses: createProviderBlockedStageStatuses('speaker-diarization'),
    });
  }
  const speakerBlockers = validateProviderSpeakerEvidence(
    speakerEvidence,
    transcriptEvidence,
    input.context.sourceMedia.durationMs,
  );
  if (speakerBlockers.length > 0) {
    return withProviderAuditTrace({
      ready: false,
      runId: input.context.runId,
      sourceMediaId: input.context.sourceMedia.id,
      providerIds,
      stageStatuses: createProviderBlockedStageStatuses('speaker-diarization'),
      blockers: uniqueSpeechFirstBlockers(speakerBlockers),
      transcriptEvidence,
      speakerEvidence,
    });
  }

  const speakerAlignment = alignSmartCutTranscriptSpeakers({
    transcriptEvidence,
    speakerEvidence,
  });
  const plan = createSpeechSemanticSlicePlan({
    sourceMediaId: input.context.sourceMedia.id,
    sourceDurationMs: input.context.sourceMedia.durationMs,
    presetId: input.context.presetId,
    transcriptEvidence,
    speakerEvidence: speakerAlignment.speakerEvidence,
    ...(input.context.maximumCandidateDurationMs !== undefined
      ? { maximumCandidateDurationMs: input.context.maximumCandidateDurationMs }
      : {}),
    ...(input.context.maximumCandidateGapMs !== undefined
      ? { maximumCandidateGapMs: input.context.maximumCandidateGapMs }
      : {}),
  });
  if (!speakerAlignment.report.ready || !plan.contentUnitBuildReport.ready) {
    return withProviderAuditTrace({
      ready: false,
      runId: input.context.runId,
      sourceMediaId: input.context.sourceMedia.id,
      providerIds,
      stageStatuses: {
        speechToText: 'passed',
        speakerDiarization: 'passed',
        speakerAlignment: speakerAlignment.report.ready ? 'passed' : 'blocked',
        contentUnitBuild: plan.contentUnitBuildReport.ready ? 'passed' : 'blocked',
        llmProviderReview: 'blocked',
        llmReview: 'blocked',
        executionPackage: 'blocked',
      },
      blockers: createPreLlmProviderBlockers({
        speakerAlignment,
        plan,
      }),
      transcriptEvidence,
      speakerEvidence: speakerAlignment.speakerEvidence,
      speakerAlignment,
      plan,
    });
  }

  let llmProviderReviewBlocked = false;
  let rawLlmReview: unknown = {
    rankedCandidateIds: [],
    referencedUnitIds: [],
    reviewNotes: [],
  };
  let providerBlockers: SmartCutExecutionPackageBlocker[] = [];
  try {
    rawLlmReview = await input.llmReviewer.review({
      context: input.context,
      contentUnits: plan.contentUnitBuildReport.units,
      candidates: plan.candidates,
    });
  } catch (error) {
    llmProviderReviewBlocked = true;
    providerBlockers = [
      createProviderBlocker({
        code: 'LLM_REVIEW_PROVIDER_FAILED',
        message: `LLM reviewer ${input.llmReviewer.id} failed before returning candidate review JSON.`,
        remediation: 'Fix the LLM reviewer and retry constrained review with stable candidate and content-unit ids; do not run filters or render without normalized LLM review evidence.',
        source: 'llm-review',
        error,
      }),
    ];
  }
  if (llmProviderReviewBlocked) {
    return withProviderAuditTrace({
      ready: false,
      runId: input.context.runId,
      sourceMediaId: input.context.sourceMedia.id,
      providerIds,
      stageStatuses: {
        speechToText: 'passed',
        speakerDiarization: 'passed',
        speakerAlignment: 'passed',
        contentUnitBuild: 'passed',
        llmProviderReview: 'blocked',
        llmReview: 'blocked',
        executionPackage: 'blocked',
      },
      blockers: uniqueSpeechFirstBlockers(providerBlockers),
      transcriptEvidence,
      speakerEvidence: speakerAlignment.speakerEvidence,
      speakerAlignment,
      plan,
    });
  }

  const downstreamResult = createSmartCutSpeechFirstExecutionPackage({
    runId: input.context.runId,
    sourceMedia: input.context.sourceMedia,
    presetId: input.context.presetId,
    transcriptEvidence,
    speakerEvidence,
    llmReviewModel: input.llmReviewer.model,
    rawLlmReview,
  });

  return withProviderAuditTrace({
    ready: downstreamResult.ready,
    runId: input.context.runId,
    sourceMediaId: input.context.sourceMedia.id,
    providerIds,
    stageStatuses: {
      speechToText: 'passed',
      speakerDiarization: 'passed',
      speakerAlignment: downstreamResult.stageStatuses.speakerAlignment,
      contentUnitBuild: downstreamResult.stageStatuses.contentUnitBuild,
      llmProviderReview: downstreamResult.llmReviewReport.ready ? 'passed' : 'blocked',
      llmReview: downstreamResult.stageStatuses.llmReview,
      executionPackage: downstreamResult.stageStatuses.executionPackage,
    },
    blockers: downstreamResult.blockers,
    transcriptEvidence,
    speakerEvidence: downstreamResult.speakerAlignment.speakerEvidence,
    speakerAlignment: downstreamResult.speakerAlignment,
    plan: downstreamResult.plan,
    llmReviewReport: downstreamResult.llmReviewReport,
    executionPackage: downstreamResult.executionPackage,
    auditTrace: downstreamResult.auditTrace,
  });
}

function createSpeechFirstStageStatuses({
  speakerAlignment,
  plan,
  llmReviewReport,
  executionPackage,
}: {
  speakerAlignment: SmartCutTranscriptSpeakerAlignmentResult;
  plan: SmartCutSpeechSemanticPlan;
  llmReviewReport: SmartCutLlmCandidateReviewReport;
  executionPackage: SmartCutExecutionPackage;
}): SmartCutSpeechFirstExecutionStageStatuses {
  return {
    speakerAlignment: speakerAlignment.report.ready ? 'passed' : 'blocked',
    contentUnitBuild: plan.contentUnitBuildReport.ready ? 'passed' : 'blocked',
    llmReview: llmReviewReport.ready ? 'passed' : 'blocked',
    executionPackage: executionPackage.ready ? 'passed' : 'blocked',
  };
}

function createProviderBlockedResult({
  runId,
  sourceMediaId,
  providerIds,
  blockers,
  transcriptEvidence,
  stageStatuses,
}: {
  runId: string;
  sourceMediaId: string;
  providerIds: SmartCutSpeechFirstProviderIds;
  blockers: readonly SmartCutExecutionPackageBlocker[];
  transcriptEvidence?: SmartCutTranscriptEvidence;
  stageStatuses: SmartCutSpeechFirstProviderExecutionStageStatuses;
}): SmartCutSpeechFirstProviderExecutionPackageResult {
  return withProviderAuditTrace({
    ready: false,
    runId,
    sourceMediaId,
    providerIds,
    stageStatuses,
    blockers: uniqueSpeechFirstBlockers(blockers),
    ...(transcriptEvidence !== undefined ? { transcriptEvidence } : {}),
  });
}

function withProviderAuditTrace(
  result: Omit<SmartCutSpeechFirstProviderExecutionPackageResult, 'auditTrace'> & {
    auditTrace?: SmartCutExecutionAuditTrace;
  },
): SmartCutSpeechFirstProviderExecutionPackageResult {
  const { auditTrace: _auditTrace, ...traceInput } = result;
  return {
    ...traceInput,
    auditTrace: createSmartCutProviderExecutionAuditTrace(traceInput),
  };
}

function createProviderBlockedStageStatuses(
  blockedStage: 'speech-to-text' | 'speaker-diarization',
): SmartCutSpeechFirstProviderExecutionStageStatuses {
  return {
    speechToText: blockedStage === 'speech-to-text' ? 'blocked' : 'passed',
    speakerDiarization: 'blocked',
    speakerAlignment: 'blocked',
    contentUnitBuild: 'blocked',
    llmProviderReview: 'blocked',
    llmReview: 'blocked',
    executionPackage: 'blocked',
  };
}

function createSpeechFirstBlockers({
  speakerAlignment,
  plan,
  llmReviewReport,
  executionPackage,
}: {
  speakerAlignment: SmartCutTranscriptSpeakerAlignmentResult;
  plan: SmartCutSpeechSemanticPlan;
  llmReviewReport: SmartCutLlmCandidateReviewReport;
  executionPackage: SmartCutExecutionPackage;
}): readonly SmartCutExecutionPackageBlocker[] {
  return uniqueSpeechFirstBlockers([
    ...speakerAlignment.report.blockers.map((blocker) => ({
      code: blocker.code,
      message: blocker.message,
      remediation: blocker.remediation,
      source: 'speaker-alignment' as const,
    })),
    ...plan.contentUnitBuildReport.blockers.map((blocker) => ({
      code: blocker.code,
      message: blocker.message,
      remediation: blocker.remediation,
      source: 'content-unit-build' as const,
    })),
    ...llmReviewReport.blockers.map((blocker) => ({
      code: blocker.code,
      message: blocker.message,
      remediation: blocker.remediation,
      source: 'llm-review' as const,
    })),
    ...executionPackage.blockers,
  ]);
}

function createPreLlmProviderBlockers({
  speakerAlignment,
  plan,
}: {
  speakerAlignment: SmartCutTranscriptSpeakerAlignmentResult;
  plan: SmartCutSpeechSemanticPlan;
}): readonly SmartCutExecutionPackageBlocker[] {
  return uniqueSpeechFirstBlockers([
    ...speakerAlignment.report.blockers.map((blocker) => ({
      code: blocker.code,
      message: blocker.message,
      remediation: blocker.remediation,
      source: 'speaker-alignment' as const,
    })),
    ...plan.contentUnitBuildReport.blockers.map((blocker) => ({
      code: blocker.code,
      message: blocker.message,
      remediation: blocker.remediation,
      source: 'content-unit-build' as const,
    })),
  ]);
}

function createProviderBlocker({
  code,
  message,
  remediation,
  source,
  error,
}: {
  code: string;
  message: string;
  remediation: string;
  source: SmartCutExecutionPackageBlocker['source'];
  error: unknown;
}): SmartCutExecutionPackageBlocker {
  return {
    code,
    message: `${message}${error instanceof Error && error.message.trim() ? ` ${error.message}` : ''}`,
    remediation,
    source,
  };
}

const minimumProviderTranscriptConfidence = 0.6;

function validateProviderTranscriptEvidence(
  transcriptEvidence: unknown,
  sourceDurationMs: number,
): readonly SmartCutExecutionPackageBlocker[] {
  const blockers: SmartCutExecutionPackageBlocker[] = [];
  if (!isProviderRecord(transcriptEvidence)) {
    blockers.push({
      code: 'TRANSCRIPT_EVIDENCE_INVALID',
      message: 'Speech-to-text provider must return transcript evidence as an object payload.',
      remediation: 'Return the canonical transcript evidence object before diarization, semantic slicing, filters, or render.',
      source: 'speech-to-text',
    });
    return blockers;
  }

  const evidence = transcriptEvidence as unknown as SmartCutTranscriptEvidence;
  if (evidence.kind !== 'transcript') {
    blockers.push({
      code: 'TRANSCRIPT_EVIDENCE_KIND_INVALID',
      message: 'Speech-to-text provider must return transcript evidence with kind transcript.',
      remediation: 'Return the canonical transcript evidence schema before diarization.',
      source: 'speech-to-text',
    });
  }

  if (evidence.schemaVersion !== SMART_CUT_STANDARD_VERSION) {
    blockers.push({
      code: 'TRANSCRIPT_SCHEMA_VERSION_INVALID',
      message: `Speech-to-text provider returned schema version ${evidence.schemaVersion}; expected ${SMART_CUT_STANDARD_VERSION}.`,
      remediation: 'Regenerate transcript evidence with the current smart cut standard schema version.',
      source: 'speech-to-text',
    });
  }

  if (!isProviderNonEmptyString(evidence.provider)) {
    blockers.push({
      code: 'TRANSCRIPT_PROVIDER_MISSING',
      message: 'Speech-to-text provider evidence must record the provider id.',
      remediation: 'Persist the STT provider id in transcript evidence for auditability.',
      source: 'speech-to-text',
    });
  }

  if (!isProviderNonEmptyString(evidence.language)) {
    blockers.push({
      code: 'TRANSCRIPT_LANGUAGE_MISSING',
      message: 'Speech-to-text provider evidence must record the transcript language.',
      remediation: 'Persist transcript language or auto-detected language before diarization.',
      source: 'speech-to-text',
    });
  }

  const transcriptSegments = Array.isArray(evidence.segments) ? evidence.segments : undefined;
  if (transcriptSegments === undefined) {
    blockers.push({
      code: 'TRANSCRIPT_SEGMENTS_INVALID',
      message: 'Speech-to-text provider evidence must contain a transcript segments array.',
      remediation: 'Return transcript evidence with a segments array before diarization, semantic slicing, filters, or render.',
      source: 'speech-to-text',
    });
    return blockers;
  }

  if (transcriptSegments.length === 0) {
    blockers.push({
      code: 'MISSING_TRANSCRIPT_EVIDENCE',
      message: 'Speech-to-text provider returned no timestamped transcript segments.',
      remediation: 'Run speech-to-text with timestamp output before diarization, semantic slicing, filters, or render.',
      source: 'speech-to-text',
    });
    return blockers;
  }

  for (const segment of transcriptSegments as readonly unknown[]) {
    if (!isProviderRecord(segment)) {
      blockers.push({
        code: 'TRANSCRIPT_SEGMENT_INVALID',
        message: 'Speech-to-text provider returned a non-object transcript segment item.',
        remediation: 'Return one timestamped object for each transcript segment before diarization and semantic slicing.',
        source: 'speech-to-text',
      });
    }
  }
  if (blockers.some((blocker) => blocker.code === 'TRANSCRIPT_SEGMENT_INVALID')) {
    return blockers;
  }

  const transcriptSegmentIds = new Set<string>();
  const duplicateTranscriptSegmentIds = new Set<string>();
  const sortedSegments = [...transcriptSegments].sort((left, right) =>
    left.startMs - right.startMs || left.endMs - right.endMs
  );
  for (const segment of sortedSegments) {
    const segmentId = normalizeProviderString(segment.id);
    const segmentText = normalizeProviderString(segment.text);
    if (!segmentId) {
      blockers.push({
        code: 'TRANSCRIPT_SEGMENT_ID_MISSING',
        message: 'Speech-to-text provider returned a transcript segment without a stable id.',
        remediation: 'Assign stable transcript segment ids before diarization and content-unit building.',
        source: 'speech-to-text',
      });
    } else if (transcriptSegmentIds.has(segmentId)) {
      duplicateTranscriptSegmentIds.add(segmentId);
    } else {
      transcriptSegmentIds.add(segmentId);
    }
    if (!segmentText) {
      blockers.push({
        code: 'TRANSCRIPT_SEGMENT_TEXT_MISSING',
        message: `Speech-to-text provider returned transcript segment ${segment.id || '<blank>'} without text.`,
        remediation: 'Return non-empty segment text before diarization and content-unit building.',
        source: 'speech-to-text',
      });
    }
    if (!isProviderValidOptionalConfidence(segment.confidence)) {
      blockers.push({
        code: 'TRANSCRIPT_SEGMENT_CONFIDENCE_INVALID',
        message: `Speech-to-text provider returned transcript segment ${segment.id || '<blank>'} with invalid confidence ${segment.confidence}.`,
        remediation: 'Return transcript segment confidence in the inclusive 0-1 range when confidence is provided.',
        source: 'speech-to-text',
      });
    } else if ((segment.confidence ?? 1) < minimumProviderTranscriptConfidence) {
      blockers.push({
        code: 'LOW_TRANSCRIPT_CONFIDENCE',
        message: `Speech-to-text provider returned transcript segment ${segment.id || '<blank>'} confidence ${segment.confidence} below ${minimumProviderTranscriptConfidence}.`,
        remediation: 'Rerun speech-to-text with a stronger model or request transcript review before diarization and semantic slicing.',
        source: 'speech-to-text',
      });
    }
    if (!isProviderValidTimeRange(segment)) {
      blockers.push({
        code: 'INVALID_TRANSCRIPT_SEGMENT_RANGE',
        message: `Speech-to-text provider returned invalid transcript segment ${segment.id} range ${segment.startMs}-${segment.endMs}.`,
        remediation: 'Return ordered integer millisecond transcript segments with positive duration before diarization.',
        source: 'speech-to-text',
      });
      continue;
    }
    if (segment.startMs < 0 || segment.endMs > sourceDurationMs) {
      blockers.push({
        code: 'TRANSCRIPT_SEGMENT_OUT_OF_SOURCE',
        message: `Speech-to-text provider returned transcript segment ${segment.id || '<blank>'} outside source duration ${sourceDurationMs}ms.`,
        remediation: 'Repair bounded STT tail drift or reject out-of-source transcript evidence before diarization.',
        source: 'speech-to-text',
      });
    }
  }

  for (const duplicateSegmentId of duplicateTranscriptSegmentIds) {
    blockers.push({
      code: 'DUPLICATE_TRANSCRIPT_SEGMENT_ID',
      message: `Speech-to-text provider returned duplicate transcript segment id ${duplicateSegmentId}.`,
      remediation: 'Return stable unique transcript segment ids before diarization and content-unit building.',
      source: 'speech-to-text',
    });
  }

  for (let index = 1; index < sortedSegments.length; index += 1) {
    const previous = sortedSegments[index - 1];
    const current = sortedSegments[index];
    if (
      previous !== undefined &&
      current !== undefined &&
      isProviderValidTimeRange(previous) &&
      isProviderValidTimeRange(current) &&
      current.startMs < previous.endMs
    ) {
      blockers.push({
        code: 'TRANSCRIPT_SEGMENTS_OVERLAP',
        message: `Speech-to-text provider returned transcript segment ${current.id || '<blank>'} overlapping previous segment ${previous.id || '<blank>'}.`,
        remediation: 'Normalize STT timeline to ordered non-overlapping transcript segments before diarization.',
        source: 'speech-to-text',
      });
    }
  }

  return blockers;
}

function validateProviderSpeakerEvidence(
  speakerEvidence: unknown,
  transcriptEvidence: SmartCutTranscriptEvidence,
  sourceDurationMs: number,
): readonly SmartCutExecutionPackageBlocker[] {
  const blockers: SmartCutExecutionPackageBlocker[] = [];
  if (!isProviderRecord(speakerEvidence)) {
    blockers.push({
      code: 'SPEAKER_EVIDENCE_INVALID',
      message: 'Speaker diarization provider must return speaker evidence as an object payload.',
      remediation: 'Return the canonical speaker evidence object before transcript-speaker alignment, semantic slicing, filters, or render.',
      source: 'speaker-diarization',
    });
    return blockers;
  }

  const evidence = speakerEvidence as unknown as SmartCutSpeakerEvidence;
  if (evidence.kind !== 'speaker') {
    blockers.push({
      code: 'SPEAKER_EVIDENCE_KIND_INVALID',
      message: 'Speaker diarization provider must return speaker evidence with kind speaker.',
      remediation: 'Return the canonical speaker evidence schema before transcript-speaker alignment.',
      source: 'speaker-diarization',
    });
  }

  if (evidence.schemaVersion !== SMART_CUT_STANDARD_VERSION) {
    blockers.push({
      code: 'SPEAKER_SCHEMA_VERSION_INVALID',
      message: `Speaker diarization provider returned schema version ${evidence.schemaVersion}; expected ${SMART_CUT_STANDARD_VERSION}.`,
      remediation: 'Regenerate speaker evidence with the current smart cut standard schema version.',
      source: 'speaker-diarization',
    });
  }

  blockers.push(...validateProviderSpeakerEvidenceContainers(evidence));
  if (blockers.some((blocker) =>
    blocker.code === 'SPEAKER_PROFILES_INVALID' ||
      blocker.code === 'SPEAKER_SEGMENTS_INVALID' ||
      blocker.code === 'SPEAKER_TURNS_INVALID' ||
      blocker.code === 'OVERLAP_GROUPS_INVALID' ||
      blocker.code === 'SPEAKER_ROLE_ASSIGNMENTS_INVALID' ||
      blocker.code === 'SPEAKER_CORRECTIONS_INVALID'
  )) {
    return blockers;
  }

  blockers.push(...validateSmartCutSpeakerEvidenceStructure({
    speakerEvidence: evidence,
    transcriptEvidence,
    sourceDurationMs,
  }).blockers.map((blocker) => ({
    code: blocker.code,
    message: blocker.message,
    remediation: blocker.remediation,
    source: 'speaker-diarization' as const,
  })));

  return blockers;
}

function validateProviderSpeakerEvidenceContainers(
  speakerEvidence: SmartCutSpeakerEvidence,
): readonly SmartCutExecutionPackageBlocker[] {
  const blockers: SmartCutExecutionPackageBlocker[] = [];
  if (!Array.isArray(speakerEvidence.profiles)) {
    blockers.push({
      code: 'SPEAKER_PROFILES_INVALID',
      message: 'Speaker diarization provider evidence must contain a speaker profiles array.',
      remediation: 'Return canonical speaker evidence with profiles before transcript-speaker alignment.',
      source: 'speaker-diarization',
    });
  }
  if (!Array.isArray(speakerEvidence.segments)) {
    blockers.push({
      code: 'SPEAKER_SEGMENTS_INVALID',
      message: 'Speaker diarization provider evidence must contain a speaker segments array.',
      remediation: 'Return canonical speaker evidence with timestamped speaker segments before alignment.',
      source: 'speaker-diarization',
    });
  }
  if (!Array.isArray(speakerEvidence.turns)) {
    blockers.push({
      code: 'SPEAKER_TURNS_INVALID',
      message: 'Speaker diarization provider evidence must contain a speaker turns array.',
      remediation: 'Return canonical speaker evidence with turns array, even when alignment will generate turns later.',
      source: 'speaker-diarization',
    });
  }
  if (!Array.isArray(speakerEvidence.overlappingSpeechGroups)) {
    blockers.push({
      code: 'OVERLAP_GROUPS_INVALID',
      message: 'Speaker diarization provider evidence must contain an overlapping speech groups array.',
      remediation: 'Return canonical speaker evidence with overlappingSpeechGroups array before overlap validation.',
      source: 'speaker-diarization',
    });
  }
  if (!Array.isArray(speakerEvidence.roleAssignments)) {
    blockers.push({
      code: 'SPEAKER_ROLE_ASSIGNMENTS_INVALID',
      message: 'Speaker diarization provider evidence must contain a role assignments array.',
      remediation: 'Return canonical speaker evidence with roleAssignments array before dialogue-aware slicing.',
      source: 'speaker-diarization',
    });
  }
  if (!Array.isArray(speakerEvidence.corrections)) {
    blockers.push({
      code: 'SPEAKER_CORRECTIONS_INVALID',
      message: 'Speaker diarization provider evidence must contain a speaker corrections array.',
      remediation: 'Return canonical speaker evidence with corrections array, even when no corrections are present.',
      source: 'speaker-diarization',
    });
  }
  return blockers;
}

function isProviderValidTimeRange(range: {
  startMs: number;
  endMs: number;
}): boolean {
  return Number.isFinite(range.startMs) &&
    Number.isFinite(range.endMs) &&
    Number.isInteger(range.startMs) &&
    Number.isInteger(range.endMs) &&
    range.endMs > range.startMs;
}

function isProviderValidOptionalConfidence(confidence: number | undefined): boolean {
  return confidence === undefined || (
    Number.isFinite(confidence) &&
    confidence >= 0 &&
    confidence <= 1
  );
}

function isProviderNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeProviderString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isProviderRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function uniqueSpeechFirstBlockers(
  blockers: readonly SmartCutExecutionPackageBlocker[],
): readonly SmartCutExecutionPackageBlocker[] {
  const seenKeys = new Set<string>();
  const uniqueBlockers: SmartCutExecutionPackageBlocker[] = [];
  for (const blocker of blockers) {
    const key = `${blocker.source}\u0000${blocker.code}`;
    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    uniqueBlockers.push(blocker);
  }
  return uniqueBlockers;
}
