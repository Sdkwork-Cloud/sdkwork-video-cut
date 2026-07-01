import {
  type SmartCutCandidate,
  type SmartCutContentUnit,
  SMART_CUT_STANDARD_VERSION,
  type SmartCutLlmReviewEvidence,
  type SmartCutLlmReviewSegmentDecision,
} from './domain.ts';
import type { SmartCutStrategyBlocker } from './strategy.ts';

export interface NormalizeSmartCutLlmCandidateReviewInput {
  model: string;
  availableCandidateIds: readonly string[];
  availableUnitIds: readonly string[];
  availableTimeSliceIds?: readonly string[];
  availableSpeakerIds?: readonly string[];
  availableSpeakerTurnIds?: readonly string[];
  rawReview: unknown;
}

export type SmartCutLlmReviewBlockerCode =
  | 'MISSING_LLM_REVIEW_REPORT'
  | 'MISSING_LLM_REVIEW_EVIDENCE'
  | 'LLM_REVIEW_REPORT_BLOCKED'
  | 'LLM_REVIEW_SELECTED_CANDIDATE_NOT_REFERENCED'
  | 'LLM_REVIEW_SELECTED_UNIT_NOT_REFERENCED'
  | 'LLM_REVIEW_EVIDENCE_KIND_INVALID'
  | 'LLM_REVIEW_SCHEMA_VERSION_INVALID'
  | 'LLM_REVIEW_MODEL_MISSING'
  | 'LLM_REVIEW_NOT_OBJECT'
  | 'LLM_RAW_TIME_RANGE_REJECTED'
  | 'LLM_REVIEW_BLANK_CANDIDATE_ID'
  | 'LLM_REVIEW_DUPLICATE_CANDIDATE_ID'
  | 'LLM_REVIEW_REFERENCES_NON_EXECUTABLE_CANDIDATE'
  | 'LLM_UNKNOWN_CANDIDATE_ID'
  | 'LLM_REVIEW_BLANK_UNIT_ID'
  | 'LLM_REVIEW_DUPLICATE_UNIT_ID'
  | 'LLM_REVIEW_REFERENCES_NON_EXECUTABLE_UNIT'
  | 'LLM_UNKNOWN_UNIT_ID'
  | 'LLM_REVIEW_BLANK_TIME_SLICE_ID'
  | 'LLM_REVIEW_DUPLICATE_TIME_SLICE_ID'
  | 'LLM_UNKNOWN_TIME_SLICE_ID'
  | 'LLM_REVIEW_BLANK_SPEAKER_ID'
  | 'LLM_REVIEW_DUPLICATE_SPEAKER_ID'
  | 'LLM_UNKNOWN_SPEAKER_ID'
  | 'LLM_REVIEW_BLANK_SPEAKER_TURN_ID'
  | 'LLM_REVIEW_DUPLICATE_SPEAKER_TURN_ID'
  | 'LLM_UNKNOWN_SPEAKER_TURN_ID'
  | 'LLM_REVIEW_SEGMENT_DECISION_INVALID'
  | 'LLM_REVIEW_SEGMENT_DECISION_REFERENCES_UNKNOWN_CANDIDATE';

export interface SmartCutLlmCandidateReviewReport {
  ready: boolean;
  evidence?: SmartCutLlmReviewEvidence;
  blockers: readonly SmartCutStrategyBlocker[];
}

export interface SmartCutLlmCandidateReviewValidationInput {
  report?: SmartCutLlmCandidateReviewReport;
  candidates: readonly SmartCutCandidate[];
  contentUnits: readonly SmartCutContentUnit[];
}

export interface SmartCutLlmCandidateReviewValidationMetrics {
  candidateCount: number;
  referencedCandidateCount: number;
  requiredUnitCount: number;
  referencedUnitCount: number;
  blockerCount: number;
}

export interface SmartCutLlmCandidateReviewValidationReport {
  ready: boolean;
  evidence?: SmartCutLlmReviewEvidence;
  blockers: readonly SmartCutStrategyBlocker[];
  metrics: SmartCutLlmCandidateReviewValidationMetrics;
}

export function normalizeSmartCutLlmCandidateReview(
  input: NormalizeSmartCutLlmCandidateReviewInput,
): SmartCutLlmCandidateReviewReport {
  const blockers: SmartCutStrategyBlocker[] = [];
  if (!isRecord(input.rawReview)) {
    blockers.push(createLlmReviewBlocker(
      'LLM_REVIEW_NOT_OBJECT',
      'LLM review output must be a JSON object.',
      'Ask the model to return the constrained JSON review schema.',
    ));
    return createLlmReviewReport(input, [], [], [], [], [], [], true, [], blockers);
  }

  const segmentDecisionReadResult = readSegmentDecisions(input.rawReview.segmentDecisions);
  const segmentDecisions = segmentDecisionReadResult.decisions;
  if (segmentDecisionReadResult.invalidCount > 0) {
    blockers.push(createLlmReviewBlocker(
      'LLM_REVIEW_SEGMENT_DECISION_INVALID',
      `LLM review returned ${segmentDecisionReadResult.invalidCount} malformed segment decision entries.`,
      'Require each segmentDecision to be an object with a non-blank candidateId and stable evidence id arrays.',
    ));
  }
  const rankedCandidateIds = normalizeRankedCandidateIds(input.rawReview, segmentDecisions);
  const referencedUnitIds = uniqueStrings([
    ...readStringArray(input.rawReview.referencedUnitIds),
    ...segmentDecisions.flatMap((decision) => decision.referencedUnitIds),
  ]);
  const referencedTimeSliceIds = uniqueStrings([
    ...readStringArray(input.rawReview.referencedTimeSliceIds),
    ...segmentDecisions.flatMap((decision) => decision.referencedTimeSliceIds),
  ]);
  const referencedSpeakerIds = uniqueStrings([
    ...readStringArray(input.rawReview.referencedSpeakerIds),
    ...segmentDecisions.flatMap((decision) => decision.referencedSpeakerIds),
  ]);
  const referencedSpeakerTurnIds = uniqueStrings([
    ...readStringArray(input.rawReview.referencedSpeakerTurnIds),
    ...segmentDecisions.flatMap((decision) => decision.referencedSpeakerTurnIds),
  ]);
  const reviewNotes = readStringArray(input.rawReview.reviewNotes);
  const rejectedRawTimeCuts = containsRawTimeRange(input.rawReview);
  if (rejectedRawTimeCuts) {
    blockers.push(createLlmReviewBlocker(
      'LLM_RAW_TIME_RANGE_REJECTED',
      'LLM review returned raw start/end timestamps.',
      'Reject raw timestamp cuts and require rankedCandidateIds or unit ids only.',
    ));
  }

  const availableCandidateIds = new Set(input.availableCandidateIds);
  for (const candidateId of rankedCandidateIds) {
    if (!availableCandidateIds.has(candidateId)) {
      blockers.push(createLlmReviewBlocker(
        'LLM_UNKNOWN_CANDIDATE_ID',
        `LLM review referenced unknown candidate id ${candidateId}.`,
        'Retry review with the current candidate id list.',
      ));
    }
  }

  const availableUnitIds = new Set(input.availableUnitIds);
  for (const unitId of referencedUnitIds) {
    if (!availableUnitIds.has(unitId)) {
      blockers.push(createLlmReviewBlocker(
        'LLM_UNKNOWN_UNIT_ID',
        `LLM review referenced unknown content unit id ${unitId}.`,
        'Retry review with the current content unit id list.',
      ));
    }
  }

  validateKnownIds({
    values: referencedTimeSliceIds,
    availableValues: input.availableTimeSliceIds ?? [],
    unknownCode: 'LLM_UNKNOWN_TIME_SLICE_ID',
    label: 'time slice',
    blockers,
  });
  validateKnownIds({
    values: referencedSpeakerIds,
    availableValues: input.availableSpeakerIds ?? [],
    unknownCode: 'LLM_UNKNOWN_SPEAKER_ID',
    label: 'speaker',
    blockers,
  });
  validateKnownIds({
    values: referencedSpeakerTurnIds,
    availableValues: input.availableSpeakerTurnIds ?? [],
    unknownCode: 'LLM_UNKNOWN_SPEAKER_TURN_ID',
    label: 'speaker turn',
    blockers,
  });

  for (const decision of segmentDecisions) {
    if (!availableCandidateIds.has(decision.candidateId)) {
      blockers.push(createLlmReviewBlocker(
        'LLM_REVIEW_SEGMENT_DECISION_REFERENCES_UNKNOWN_CANDIDATE',
        `LLM review segment decision referenced unknown candidate id ${decision.candidateId}.`,
        'Retry review with segmentDecisions that reference only the current candidate id list.',
      ));
    }
    validateKnownIds({
      values: decision.referencedUnitIds,
      availableValues: input.availableUnitIds,
      unknownCode: 'LLM_UNKNOWN_UNIT_ID',
      label: 'content unit',
      blockers,
    });
    validateKnownIds({
      values: decision.referencedTimeSliceIds,
      availableValues: input.availableTimeSliceIds ?? [],
      unknownCode: 'LLM_UNKNOWN_TIME_SLICE_ID',
      label: 'time slice',
      blockers,
    });
    validateKnownIds({
      values: decision.referencedSpeakerIds,
      availableValues: input.availableSpeakerIds ?? [],
      unknownCode: 'LLM_UNKNOWN_SPEAKER_ID',
      label: 'speaker',
      blockers,
    });
    validateKnownIds({
      values: decision.referencedSpeakerTurnIds,
      availableValues: input.availableSpeakerTurnIds ?? [],
      unknownCode: 'LLM_UNKNOWN_SPEAKER_TURN_ID',
      label: 'speaker turn',
      blockers,
    });
  }

  return createLlmReviewReport(
    input,
    rankedCandidateIds,
    referencedUnitIds,
    referencedTimeSliceIds,
    referencedSpeakerIds,
    referencedSpeakerTurnIds,
    segmentDecisions,
    rejectedRawTimeCuts,
    reviewNotes,
    blockers,
  );
}

export function validateSmartCutLlmCandidateReviewReport(
  input: SmartCutLlmCandidateReviewValidationInput,
): SmartCutLlmCandidateReviewValidationReport {
  const requiredCandidateIds = input.candidates.map((candidate) => candidate.id);
  const requiredUnitIds = uniqueStrings(input.candidates.flatMap((candidate) => candidate.unitIds));
  const blockers: SmartCutStrategyBlocker[] = [];

  if (input.report === undefined) {
    blockers.push(createLlmReviewBlocker(
      'MISSING_LLM_REVIEW_REPORT',
      'Execution package requires a normalized LLM candidate review report.',
      'Run the standard LLM reviewer/ranker and pass its normalized report before filters or render.',
    ));
    return createLlmReviewValidationReport(undefined, blockers, requiredCandidateIds, requiredUnitIds);
  }

  blockers.push(...input.report.blockers);

  if (!input.report.ready) {
    blockers.push(createLlmReviewBlocker(
      'LLM_REVIEW_REPORT_BLOCKED',
      'Execution package received a blocked LLM candidate review report.',
      'Reject raw timestamp output, repair unknown stable ids, and rerun the constrained LLM reviewer.',
    ));
  }

  if (input.report.evidence === undefined) {
    blockers.push(createLlmReviewBlocker(
      'MISSING_LLM_REVIEW_EVIDENCE',
      'LLM candidate review report has no normalized evidence.',
      'Normalize model output into llm-review evidence before validating candidates.',
    ));
    return createLlmReviewValidationReport(input.report.evidence, blockers, requiredCandidateIds, requiredUnitIds);
  }

  validateLlmReviewEvidenceShape(input.report.evidence, blockers);
  validateReferencedCandidateIds(input.report.evidence, input.candidates, requiredCandidateIds, blockers);
  validateReferencedUnitIds(input.report.evidence, input.contentUnits, requiredUnitIds, blockers);
  validateReferencedTimeSliceIds(input.report.evidence, input.candidates, blockers);
  validateReferencedSpeakerIds(input.report.evidence, input.contentUnits, blockers);
  validateReferencedSpeakerTurnIds(input.report.evidence, input.contentUnits, blockers);
  validateSegmentDecisions(input.report.evidence, input.candidates, input.contentUnits, blockers);

  return createLlmReviewValidationReport(input.report.evidence, blockers, requiredCandidateIds, requiredUnitIds);
}

function createLlmReviewReport(
  input: NormalizeSmartCutLlmCandidateReviewInput,
  rankedCandidateIds: readonly string[],
  referencedUnitIds: readonly string[],
  referencedTimeSliceIds: readonly string[],
  referencedSpeakerIds: readonly string[],
  referencedSpeakerTurnIds: readonly string[],
  segmentDecisions: readonly SmartCutLlmReviewSegmentDecision[],
  rejectedRawTimeCuts: boolean,
  reviewNotes: readonly string[],
  blockers: readonly SmartCutStrategyBlocker[],
): SmartCutLlmCandidateReviewReport {
  return {
    ready: blockers.length === 0,
    evidence: {
      kind: 'llm-review',
      schemaVersion: SMART_CUT_STANDARD_VERSION,
      model: input.model,
      referencedCandidateIds: [...rankedCandidateIds],
      referencedUnitIds: [...referencedUnitIds],
      referencedTimeSliceIds: [...referencedTimeSliceIds],
      referencedSpeakerIds: [...referencedSpeakerIds],
      referencedSpeakerTurnIds: [...referencedSpeakerTurnIds],
      segmentDecisions: segmentDecisions.map((decision) => ({ ...decision })),
      rejectedRawTimeCuts,
      reviewNotes: [...reviewNotes],
    },
    blockers,
  };
}

function createLlmReviewBlocker(
  code: SmartCutLlmReviewBlockerCode,
  message: string,
  remediation: string,
): SmartCutStrategyBlocker {
  return {
    code,
    message,
    remediation,
  };
}

function createLlmReviewValidationReport(
  evidence: SmartCutLlmReviewEvidence | undefined,
  blockers: readonly SmartCutStrategyBlocker[],
  requiredCandidateIds: readonly string[],
  requiredUnitIds: readonly string[],
): SmartCutLlmCandidateReviewValidationReport {
  return {
    ready: blockers.length === 0,
    ...(evidence !== undefined ? { evidence } : {}),
    blockers,
    metrics: {
      candidateCount: requiredCandidateIds.length,
      referencedCandidateCount: evidence?.referencedCandidateIds.length ?? 0,
      requiredUnitCount: requiredUnitIds.length,
      referencedUnitCount: evidence?.referencedUnitIds.length ?? 0,
      blockerCount: blockers.length,
    },
  };
}

function validateLlmReviewEvidenceShape(
  evidence: SmartCutLlmReviewEvidence,
  blockers: SmartCutStrategyBlocker[],
) {
  if (evidence.kind !== 'llm-review') {
    blockers.push(createLlmReviewBlocker(
      'LLM_REVIEW_EVIDENCE_KIND_INVALID',
      'LLM candidate review evidence must use kind llm-review.',
      'Reject forged or mixed evidence and normalize the LLM review output again.',
    ));
  }

  if (evidence.schemaVersion !== SMART_CUT_STANDARD_VERSION) {
    blockers.push(createLlmReviewBlocker(
      'LLM_REVIEW_SCHEMA_VERSION_INVALID',
      `LLM candidate review evidence schema version ${evidence.schemaVersion} does not match ${SMART_CUT_STANDARD_VERSION}.`,
      'Regenerate the review evidence with the current smart cut standard version.',
    ));
  }

  if (!evidence.model.trim()) {
    blockers.push(createLlmReviewBlocker(
      'LLM_REVIEW_MODEL_MISSING',
      'LLM candidate review evidence must record the reviewing model id.',
      'Persist the reviewer model id in normalized review evidence for auditability.',
    ));
  }

  if (evidence.rejectedRawTimeCuts) {
    blockers.push(createLlmReviewBlocker(
      'LLM_RAW_TIME_RANGE_REJECTED',
      'LLM review returned or preserved raw start/end timestamps.',
      'Reject raw timestamp cuts and require rankedCandidateIds or unit ids only.',
    ));
  }
}

function validateReferencedCandidateIds(
  evidence: SmartCutLlmReviewEvidence,
  candidates: readonly SmartCutCandidate[],
  requiredCandidateIds: readonly string[],
  blockers: SmartCutStrategyBlocker[],
) {
  const availableCandidateIds = new Set(candidates.map((candidate) => candidate.id));
  const referencedCandidateIds = new Set<string>();

  for (const candidateId of evidence.referencedCandidateIds) {
    const normalizedCandidateId = candidateId.trim();
    if (!normalizedCandidateId) {
      blockers.push(createLlmReviewBlocker(
        'LLM_REVIEW_BLANK_CANDIDATE_ID',
        'LLM review referenced a blank candidate id.',
        'Normalize and reject blank ids before accepting LLM review evidence.',
      ));
      continue;
    }

    if (referencedCandidateIds.has(normalizedCandidateId)) {
      blockers.push(createLlmReviewBlocker(
        'LLM_REVIEW_DUPLICATE_CANDIDATE_ID',
        `LLM review referenced candidate ${normalizedCandidateId} more than once.`,
        'Require each ranked candidate id to appear once so ranking is deterministic.',
      ));
    }
    referencedCandidateIds.add(normalizedCandidateId);

    if (!availableCandidateIds.has(normalizedCandidateId)) {
      blockers.push(createLlmReviewBlocker(
        'LLM_REVIEW_REFERENCES_NON_EXECUTABLE_CANDIDATE',
        `LLM review referenced candidate ${normalizedCandidateId}, which is not executable in the current plan.`,
        'Rerun LLM review with only the current execution plan candidate id list.',
      ));
    }
  }

  for (const candidateId of requiredCandidateIds) {
    if (!referencedCandidateIds.has(candidateId)) {
      blockers.push(createLlmReviewBlocker(
        'LLM_REVIEW_SELECTED_CANDIDATE_NOT_REFERENCED',
        `LLM review did not reference candidate ${candidateId}.`,
        'Rerun LLM review with the final candidate id list and require rankedCandidateIds to cover every executable candidate.',
      ));
    }
  }
}

function validateReferencedUnitIds(
  evidence: SmartCutLlmReviewEvidence,
  contentUnits: readonly SmartCutContentUnit[],
  requiredUnitIds: readonly string[],
  blockers: SmartCutStrategyBlocker[],
) {
  const availableUnitIds = new Set(contentUnits.map((unit) => unit.id));
  const referencedUnitIds = new Set<string>();

  for (const unitId of evidence.referencedUnitIds) {
    const normalizedUnitId = unitId.trim();
    if (!normalizedUnitId) {
      blockers.push(createLlmReviewBlocker(
        'LLM_REVIEW_BLANK_UNIT_ID',
        'LLM review referenced a blank content unit id.',
        'Normalize and reject blank ids before accepting LLM review evidence.',
      ));
      continue;
    }

    if (referencedUnitIds.has(normalizedUnitId)) {
      blockers.push(createLlmReviewBlocker(
        'LLM_REVIEW_DUPLICATE_UNIT_ID',
        `LLM review referenced content unit ${normalizedUnitId} more than once.`,
        'Require each referenced unit id to appear once so review coverage is deterministic.',
      ));
    }
    referencedUnitIds.add(normalizedUnitId);

    if (!availableUnitIds.has(normalizedUnitId)) {
      blockers.push(createLlmReviewBlocker(
        'LLM_UNKNOWN_UNIT_ID',
        `LLM review referenced unknown content unit id ${normalizedUnitId}.`,
        'Retry review with the current content unit id list.',
      ));
      continue;
    }

    if (!requiredUnitIds.includes(normalizedUnitId)) {
      blockers.push(createLlmReviewBlocker(
        'LLM_REVIEW_REFERENCES_NON_EXECUTABLE_UNIT',
        `LLM review referenced content unit ${normalizedUnitId}, which is not used by executable candidates.`,
        'Rerun LLM review with only the content unit ids required by executable candidates.',
      ));
    }
  }

  for (const unitId of requiredUnitIds) {
    if (!referencedUnitIds.has(unitId)) {
      blockers.push(createLlmReviewBlocker(
        'LLM_REVIEW_SELECTED_UNIT_NOT_REFERENCED',
        `LLM review did not reference content unit ${unitId}.`,
        'Rerun LLM review with the final content unit id list and require referencedUnitIds to cover executable candidates.',
      ));
    }
  }
}

function validateReferencedTimeSliceIds(
  evidence: SmartCutLlmReviewEvidence,
  candidates: readonly SmartCutCandidate[],
  blockers: SmartCutStrategyBlocker[],
) {
  const availableTimeSliceIds = new Set(candidates.map((candidate) => createTimeSliceId(candidate.id)));
  validateReviewEvidenceIdList({
    values: evidence.referencedTimeSliceIds,
    availableValues: availableTimeSliceIds,
    blankCode: 'LLM_REVIEW_BLANK_TIME_SLICE_ID',
    duplicateCode: 'LLM_REVIEW_DUPLICATE_TIME_SLICE_ID',
    unknownCode: 'LLM_UNKNOWN_TIME_SLICE_ID',
    label: 'time slice',
    blockers,
  });
}

function validateReferencedSpeakerIds(
  evidence: SmartCutLlmReviewEvidence,
  contentUnits: readonly SmartCutContentUnit[],
  blockers: SmartCutStrategyBlocker[],
) {
  const availableSpeakerIds = new Set(contentUnits.flatMap((unit) => unit.speakerIds));
  validateReviewEvidenceIdList({
    values: evidence.referencedSpeakerIds,
    availableValues: availableSpeakerIds,
    blankCode: 'LLM_REVIEW_BLANK_SPEAKER_ID',
    duplicateCode: 'LLM_REVIEW_DUPLICATE_SPEAKER_ID',
    unknownCode: 'LLM_UNKNOWN_SPEAKER_ID',
    label: 'speaker',
    blockers,
  });
}

function validateReferencedSpeakerTurnIds(
  evidence: SmartCutLlmReviewEvidence,
  contentUnits: readonly SmartCutContentUnit[],
  blockers: SmartCutStrategyBlocker[],
) {
  const availableSpeakerTurnIds = new Set(contentUnits.flatMap((unit) => unit.speakerTurnIds));
  validateReviewEvidenceIdList({
    values: evidence.referencedSpeakerTurnIds,
    availableValues: availableSpeakerTurnIds,
    blankCode: 'LLM_REVIEW_BLANK_SPEAKER_TURN_ID',
    duplicateCode: 'LLM_REVIEW_DUPLICATE_SPEAKER_TURN_ID',
    unknownCode: 'LLM_UNKNOWN_SPEAKER_TURN_ID',
    label: 'speaker turn',
    blockers,
  });
}

function validateSegmentDecisions(
  evidence: SmartCutLlmReviewEvidence,
  candidates: readonly SmartCutCandidate[],
  contentUnits: readonly SmartCutContentUnit[],
  blockers: SmartCutStrategyBlocker[],
) {
  const availableCandidateIds = new Set(candidates.map((candidate) => candidate.id));
  const availableUnitIds = new Set(contentUnits.map((unit) => unit.id));
  const availableTimeSliceIds = new Set(candidates.map((candidate) => createTimeSliceId(candidate.id)));
  const availableSpeakerIds = new Set(contentUnits.flatMap((unit) => unit.speakerIds));
  const availableSpeakerTurnIds = new Set(contentUnits.flatMap((unit) => unit.speakerTurnIds));

  for (const decision of evidence.segmentDecisions) {
    if (!availableCandidateIds.has(decision.candidateId)) {
      blockers.push(createLlmReviewBlocker(
        'LLM_REVIEW_SEGMENT_DECISION_REFERENCES_UNKNOWN_CANDIDATE',
        `LLM review segment decision referenced candidate ${decision.candidateId}, which is not executable in the current plan.`,
        'Rerun LLM review with segmentDecisions that reference only executable candidate ids.',
      ));
    }
    validateKnownIds({
      values: decision.referencedUnitIds,
      availableValues: availableUnitIds,
      unknownCode: 'LLM_UNKNOWN_UNIT_ID',
      label: 'content unit',
      blockers,
    });
    validateKnownIds({
      values: decision.referencedTimeSliceIds,
      availableValues: availableTimeSliceIds,
      unknownCode: 'LLM_UNKNOWN_TIME_SLICE_ID',
      label: 'time slice',
      blockers,
    });
    validateKnownIds({
      values: decision.referencedSpeakerIds,
      availableValues: availableSpeakerIds,
      unknownCode: 'LLM_UNKNOWN_SPEAKER_ID',
      label: 'speaker',
      blockers,
    });
    validateKnownIds({
      values: decision.referencedSpeakerTurnIds,
      availableValues: availableSpeakerTurnIds,
      unknownCode: 'LLM_UNKNOWN_SPEAKER_TURN_ID',
      label: 'speaker turn',
      blockers,
    });
  }
}

function containsRawTimeRange(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsRawTimeRange(item));
  }
  if (!isRecord(value)) {
    return false;
  }
  if (
    (typeof value.startMs === 'number' || typeof value.start === 'number') &&
    (typeof value.endMs === 'number' || typeof value.end === 'number')
  ) {
    return true;
  }
  return Object.values(value).some((entry) => containsRawTimeRange(entry));
}

function normalizeRankedCandidateIds(
  rawReview: Record<string, unknown>,
  segmentDecisions: readonly SmartCutLlmReviewSegmentDecision[],
): readonly string[] {
  return uniqueStrings([
    ...readStringArray(rawReview.rankedCandidateIds),
    ...readStringArray(rawReview.selectedCandidateIds),
    ...segmentDecisions.map((decision) => decision.candidateId),
  ]);
}

function readSegmentDecisions(value: unknown): {
  decisions: readonly SmartCutLlmReviewSegmentDecision[];
  invalidCount: number;
} {
  if (!Array.isArray(value)) {
    return {
      decisions: [],
      invalidCount: value === undefined ? 0 : 1,
    };
  }
  const decisions: SmartCutLlmReviewSegmentDecision[] = [];
  let invalidCount = 0;
  for (const entry of value) {
    if (!isRecord(entry)) {
      invalidCount += 1;
      continue;
    }
    const candidateId = readString(entry.candidateId);
    if (!candidateId) {
      invalidCount += 1;
      continue;
    }
    decisions.push({
      candidateId,
      decision: normalizeDecision(entry.decision),
      reasonCode: readString(entry.reasonCode) || 'unspecified',
      referencedUnitIds: readStringArray(entry.referencedUnitIds),
      referencedTimeSliceIds: readStringArray(entry.referencedTimeSliceIds),
      referencedSpeakerIds: readStringArray(entry.referencedSpeakerIds),
      referencedSpeakerTurnIds: readStringArray(entry.referencedSpeakerTurnIds),
    });
  }
  return {
    decisions,
    invalidCount,
  };
}

function normalizeDecision(value: unknown): SmartCutLlmReviewSegmentDecision['decision'] {
  if (value === 'select' || value === 'reject' || value === 'review') {
    return value;
  }
  return 'review';
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function validateKnownIds({
  values,
  availableValues,
  unknownCode,
  label,
  blockers,
}: {
  values: readonly string[];
  availableValues: readonly string[] | ReadonlySet<string>;
  unknownCode: SmartCutLlmReviewBlockerCode;
  label: string;
  blockers: SmartCutStrategyBlocker[];
}) {
  if (values.length === 0) {
    return;
  }
  const availableValueSet = availableValues instanceof Set ? availableValues : new Set(availableValues);
  for (const value of values) {
    if (!availableValueSet.has(value)) {
      blockers.push(createLlmReviewBlocker(
        unknownCode,
        `LLM review referenced unknown ${label} id ${value}.`,
        `Retry review with the current ${label} id list.`,
      ));
    }
  }
}

function validateReviewEvidenceIdList({
  values,
  availableValues,
  blankCode,
  duplicateCode,
  unknownCode,
  label,
  blockers,
}: {
  values: readonly string[];
  availableValues: ReadonlySet<string>;
  blankCode: SmartCutLlmReviewBlockerCode;
  duplicateCode: SmartCutLlmReviewBlockerCode;
  unknownCode: SmartCutLlmReviewBlockerCode;
  label: string;
  blockers: SmartCutStrategyBlocker[];
}) {
  const seen = new Set<string>();
  for (const value of values) {
    const normalizedValue = value.trim();
    if (!normalizedValue) {
      blockers.push(createLlmReviewBlocker(
        blankCode,
        `LLM review referenced a blank ${label} id.`,
        `Normalize and reject blank ${label} ids before accepting LLM review evidence.`,
      ));
      continue;
    }
    if (seen.has(normalizedValue)) {
      blockers.push(createLlmReviewBlocker(
        duplicateCode,
        `LLM review referenced ${label} ${normalizedValue} more than once.`,
        `Require each referenced ${label} id to appear once so review coverage is deterministic.`,
      ));
    }
    seen.add(normalizedValue);
    if (!availableValues.has(normalizedValue)) {
      blockers.push(createLlmReviewBlocker(
        unknownCode,
        `LLM review referenced unknown ${label} id ${normalizedValue}.`,
        `Retry review with the current ${label} id list.`,
      ));
    }
  }
}

function createTimeSliceId(candidateId: string): string {
  return `time-slice-${candidateId}`;
}

function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
