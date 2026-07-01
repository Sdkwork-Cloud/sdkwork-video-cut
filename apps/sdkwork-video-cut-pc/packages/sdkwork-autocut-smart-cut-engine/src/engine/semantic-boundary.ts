import type {
  SmartCutCandidate,
  SmartCutContentUnit,
  SmartCutTimeRange,
} from './domain.ts';
import type { SmartCutProductPresetId } from './presets.ts';
import type { SmartCutSpeakerEvidence } from './speaker.ts';

export interface SmartCutSemanticBoundaryProofInput {
  presetId: SmartCutProductPresetId;
  contentUnits: readonly SmartCutContentUnit[];
  candidates: readonly SmartCutCandidate[];
  speakerEvidence?: SmartCutSpeakerEvidence;
}

export type SmartCutSemanticBoundaryBlockerCode =
  | 'NO_CANDIDATES'
  | 'CANDIDATE_WITHOUT_CONTENT_UNITS'
  | 'CANDIDATE_REFERENCES_UNKNOWN_UNIT'
  | 'CANDIDATE_RANGE_NOT_UNIT_BOUNDARY'
  | 'CANDIDATE_UNIT_ORDER_MISMATCH'
  | 'NON_CONTIGUOUS_CONTENT_UNITS'
  | 'LOW_CONTENT_UNIT_COMPLETENESS'
  | 'DANGLING_CONNECTOR_BOUNDARY'
  | 'QUESTION_WITHOUT_ANSWER'
  | 'ANSWER_WITHOUT_QUESTION'
  | 'DIALOGUE_ROLE_SEQUENCE_INVALID'
  | 'CUTS_OVERLAPPING_SPEECH';

export interface SmartCutSemanticBoundaryBlocker {
  code: SmartCutSemanticBoundaryBlockerCode;
  message: string;
  candidateId?: string;
  unitId?: string;
  remediation: string;
}

export interface SmartCutSemanticBoundaryCandidateReport {
  candidateId: string;
  complete: boolean;
  unitCount: number;
  unitSpanMs: number;
  hasQuestion: boolean;
  hasAnswer: boolean;
  blockerCodes: readonly SmartCutSemanticBoundaryBlockerCode[];
}

export interface SmartCutSemanticBoundaryProofReport {
  ready: boolean;
  candidateReports: readonly SmartCutSemanticBoundaryCandidateReport[];
  blockers: readonly SmartCutSemanticBoundaryBlocker[];
}

const maximumUnitGapMs = 1_500;
const minimumCompletenessScore = 0.72;

export function validateSmartCutSemanticBoundaryProof(
  input: SmartCutSemanticBoundaryProofInput,
): SmartCutSemanticBoundaryProofReport {
  const blockers: SmartCutSemanticBoundaryBlocker[] = [];
  const candidateReports: SmartCutSemanticBoundaryCandidateReport[] = [];
  const unitById = new Map(input.contentUnits.map((unit) => [unit.id, unit]));

  if (input.candidates.length === 0) {
    blockers.push({
      code: 'NO_CANDIDATES',
      message: 'Semantic boundary proof has no candidates.',
      remediation: 'Run slicer strategies and validate content-unit-backed candidates.',
    });
  }

  for (const candidate of input.candidates) {
    const candidateBlockers: SmartCutSemanticBoundaryBlocker[] = [];
    const units = collectCandidateUnits(candidate, unitById, candidateBlockers);

    if (candidate.unitIds.length === 0) {
      candidateBlockers.push({
        code: 'CANDIDATE_WITHOUT_CONTENT_UNITS',
        message: `Candidate ${candidate.id} has no content unit ids.`,
        candidateId: candidate.id,
        remediation: 'Reject raw time-only candidates and rebuild using stable content unit ids.',
      });
    }

    if (units.length > 0) {
      validateCandidateUnitIdOrder(candidate, units, candidateBlockers);
      validateCandidateSnapsToUnitBoundaries(candidate, units, candidateBlockers);
      if (isVisualBoundaryCandidate(input.presetId, units)) {
        validateVisualCandidateUnitCompleteness(candidate, units, candidateBlockers);
      } else {
        validateCandidateUnitContiguity(candidate, units, candidateBlockers);
        validateCandidateUnitCompleteness(candidate, units, candidateBlockers);
        validateDanglingConnector(candidate, units, candidateBlockers);
        validateDialogueCompleteness(input.presetId, candidate, units, candidateBlockers);
        validateOverlappingSpeechBoundary(candidate, input.speakerEvidence, candidateBlockers);
        validateCandidateOverlapGroupCompleteness(candidate, units, input.contentUnits, candidateBlockers);
      }
    }

    blockers.push(...candidateBlockers);
    candidateReports.push(createCandidateReport(candidate, units, candidateBlockers));
  }

  return {
    ready: blockers.length === 0,
    candidateReports,
    blockers,
  };
}

function isVisualBoundaryCandidate(
  presetId: SmartCutProductPresetId,
  units: readonly SmartCutContentUnit[],
): boolean {
  return presetId === 'film-scene-index' &&
    units.length > 0 &&
    units.every((unit) =>
      unit.evidenceIds.includes('visual') &&
        (unit.unitKind === 'visual-scene' || unit.unitKind === 'shot')
    );
}

function validateVisualCandidateUnitCompleteness(
  candidate: SmartCutCandidate,
  units: readonly SmartCutContentUnit[],
  blockers: SmartCutSemanticBoundaryBlocker[],
) {
  for (const unit of units) {
    if (unit.completenessScore < minimumCompletenessScore) {
      blockers.push({
        code: 'LOW_CONTENT_UNIT_COMPLETENESS',
        message: `Candidate ${candidate.id} includes incomplete visual content unit ${unit.id}.`,
        candidateId: candidate.id,
        unitId: unit.id,
        remediation: 'Merge adjacent visual shots into a complete scene or discard incomplete visual units.',
      });
    }
  }
}

function collectCandidateUnits(
  candidate: SmartCutCandidate,
  unitById: ReadonlyMap<string, SmartCutContentUnit>,
  blockers: SmartCutSemanticBoundaryBlocker[],
): SmartCutContentUnit[] {
  const units: SmartCutContentUnit[] = [];
  for (const unitId of candidate.unitIds) {
    const unit = unitById.get(unitId);
    if (unit === undefined) {
      blockers.push({
        code: 'CANDIDATE_REFERENCES_UNKNOWN_UNIT',
        message: `Candidate ${candidate.id} references unknown content unit ${unitId}.`,
        candidateId: candidate.id,
        unitId,
        remediation: 'Rebuild candidates after content unit generation and keep stable unit ids.',
      });
      continue;
    }
    units.push(unit);
  }

  return units.sort(compareTimeRanges);
}

function validateCandidateUnitIdOrder(
  candidate: SmartCutCandidate,
  sortedUnits: readonly SmartCutContentUnit[],
  blockers: SmartCutSemanticBoundaryBlocker[],
) {
  const sortedUnitIds = sortedUnits.map((unit) => unit.id).join(',');
  const candidateUnitIds = candidate.unitIds.join(',');
  if (candidateUnitIds !== sortedUnitIds) {
    blockers.push({
      code: 'CANDIDATE_UNIT_ORDER_MISMATCH',
      message: `Candidate ${candidate.id} unit id order does not match content unit time order.`,
      candidateId: candidate.id,
      remediation: 'Keep candidate unitIds in chronological speaker-turn order so Q/A and meeting context remains deterministic.',
    });
  }
}

function validateCandidateSnapsToUnitBoundaries(
  candidate: SmartCutCandidate,
  units: readonly SmartCutContentUnit[],
  blockers: SmartCutSemanticBoundaryBlocker[],
) {
  const firstUnit = units[0];
  const lastUnit = units.at(-1);
  if (firstUnit === undefined || lastUnit === undefined) {
    return;
  }

  if (candidate.startMs !== firstUnit.startMs || candidate.endMs !== lastUnit.endMs) {
    blockers.push({
      code: 'CANDIDATE_RANGE_NOT_UNIT_BOUNDARY',
      message: `Candidate ${candidate.id} range ${candidate.startMs}-${candidate.endMs} is not snapped to content unit boundaries ${firstUnit.startMs}-${lastUnit.endMs}.`,
      candidateId: candidate.id,
      remediation: 'Snap candidate ranges to the first and last referenced content unit boundaries.',
    });
  }
}

function validateCandidateUnitContiguity(
  candidate: SmartCutCandidate,
  units: readonly SmartCutContentUnit[],
  blockers: SmartCutSemanticBoundaryBlocker[],
) {
  for (let index = 1; index < units.length; index += 1) {
    const previous = units[index - 1];
    const current = units[index];
    if (previous === undefined || current === undefined) {
      continue;
    }

    if (current.startMs - previous.endMs > maximumUnitGapMs) {
      blockers.push({
        code: 'NON_CONTIGUOUS_CONTENT_UNITS',
        message: `Candidate ${candidate.id} has unsupported gap ${current.startMs - previous.endMs}ms between ${previous.id} and ${current.id}.`,
        candidateId: candidate.id,
        unitId: current.id,
        remediation: 'Only merge adjacent semantic units or explicitly model missing context before slicing.',
      });
    }
  }
}

function validateCandidateUnitCompleteness(
  candidate: SmartCutCandidate,
  units: readonly SmartCutContentUnit[],
  blockers: SmartCutSemanticBoundaryBlocker[],
) {
  for (const unit of units) {
    if (unit.completenessScore < minimumCompletenessScore) {
      blockers.push({
        code: 'LOW_CONTENT_UNIT_COMPLETENESS',
        message: `Candidate ${candidate.id} includes incomplete content unit ${unit.id}.`,
        candidateId: candidate.id,
        unitId: unit.id,
        remediation: 'Extend to adjacent context or discard incomplete content units.',
      });
    }
  }
}

function validateDanglingConnector(
  candidate: SmartCutCandidate,
  units: readonly SmartCutContentUnit[],
  blockers: SmartCutSemanticBoundaryBlocker[],
) {
  const firstUnit = units[0];
  const lastUnit = units.at(-1);
  if (firstUnit === undefined || lastUnit === undefined) {
    return;
  }

  if (startsWithDanglingConnectorFragment(firstUnit.text ?? '') || endsWithDanglingConnector(lastUnit.text ?? '')) {
    blockers.push({
      code: 'DANGLING_CONNECTOR_BOUNDARY',
      message: `Candidate ${candidate.id} starts or ends with a dangling connector.`,
      candidateId: candidate.id,
      unitId: lastUnit.id,
      remediation: 'Extend the candidate to include the missing clause or choose a complete semantic boundary.',
    });
  }
}

function validateDialogueCompleteness(
  presetId: SmartCutProductPresetId,
  candidate: SmartCutCandidate,
  units: readonly SmartCutContentUnit[],
  blockers: SmartCutSemanticBoundaryBlocker[],
) {
  if (presetId !== 'interview-one-question-one-answer' && presetId !== 'long-interview-matrix') {
    return;
  }

  const hasQuestion = units.some(isQuestionUnit);
  const hasAnswer = units.some((unit) => !isQuestionUnit(unit) && isAnswerUnit(unit));
  if (hasQuestion && !hasAnswer) {
    blockers.push({
      code: 'QUESTION_WITHOUT_ANSWER',
      message: `Dialogue candidate ${candidate.id} includes a question without an answer.`,
      candidateId: candidate.id,
      remediation: 'Include the adjacent complete answer unit or discard the Q/A candidate.',
    });
  }
  if (!hasQuestion && hasAnswer) {
    blockers.push({
      code: 'ANSWER_WITHOUT_QUESTION',
      message: `Dialogue candidate ${candidate.id} includes an answer without its question context.`,
      candidateId: candidate.id,
      remediation: 'Include the preceding question unit for dialogue continuity.',
    });
  }

  validateDialogueRoleSequence(candidate, units, blockers);
}

function validateDialogueRoleSequence(
  candidate: SmartCutCandidate,
  units: readonly SmartCutContentUnit[],
  blockers: SmartCutSemanticBoundaryBlocker[],
) {
  const questionUnit = units.find(isQuestionUnit);
  const answerUnit = units.find((unit) => !isQuestionUnit(unit) && isAnswerUnit(unit));
  if (questionUnit === undefined || answerUnit === undefined) {
    return;
  }

  const questionRoles = questionUnit.speakerRoles ?? [];
  const answerRoles = answerUnit.speakerRoles ?? [];
  const questionSpeakerIds = questionUnit.speakerIds ?? [];
  const answerSpeakerIds = answerUnit.speakerIds ?? [];
  const questionFromInterviewer = questionRoles.some((role) =>
    role === 'interviewer' || role === 'host' || role === 'moderator'
  );
  const answerFromGuest = answerRoles.some((role) =>
    role === 'guest' || role === 'teacher' || role === 'speaker' || role === 'narrator'
  );
  const rolesAreDifferent = !questionSpeakerIds.some((speakerId) => answerSpeakerIds.includes(speakerId));
  if (!questionFromInterviewer || !answerFromGuest || !rolesAreDifferent || questionUnit.startMs > answerUnit.startMs) {
    blockers.push({
      code: 'DIALOGUE_ROLE_SEQUENCE_INVALID',
      message: `Dialogue candidate ${candidate.id} does not preserve interviewer-to-answer speaker role order.`,
      candidateId: candidate.id,
      remediation: 'Build Q/A candidates from interviewer/host question units followed by guest/teacher answer units.',
    });
  }
}

function validateOverlappingSpeechBoundary(
  candidate: SmartCutCandidate,
  speakerEvidence: SmartCutSpeakerEvidence | undefined,
  blockers: SmartCutSemanticBoundaryBlocker[],
) {
  if (speakerEvidence === undefined) {
    return;
  }

  for (const group of speakerEvidence.overlappingSpeechGroups) {
    if (isPointInsideOrAtRangeBoundary(candidate.startMs, group) || isPointInsideOrAtRangeBoundary(candidate.endMs, group)) {
      blockers.push({
        code: 'CUTS_OVERLAPPING_SPEECH',
        message: `Candidate ${candidate.id} cuts inside overlapping speech group ${group.id}.`,
        candidateId: candidate.id,
        remediation: 'Move the boundary outside overlapping speech or include the complete overlap context.',
      });
    }
  }
}

function validateCandidateOverlapGroupCompleteness(
  candidate: SmartCutCandidate,
  units: readonly SmartCutContentUnit[],
  allUnits: readonly SmartCutContentUnit[],
  blockers: SmartCutSemanticBoundaryBlocker[],
) {
  const candidateUnitIds = new Set(units.map((unit) => unit.id));
  const overlapGroupIds = new Set(units.flatMap((unit) => unit.overlapGroupIds ?? []));
  for (const overlapGroupId of overlapGroupIds) {
    const relatedUnits = allUnits.filter((unit) => (unit.overlapGroupIds ?? []).includes(overlapGroupId));
    if (relatedUnits.length <= 1) {
      continue;
    }
    const includesCompleteGroup = relatedUnits.every((unit) => candidateUnitIds.has(unit.id));
    if (!includesCompleteGroup) {
      blockers.push({
        code: 'CUTS_OVERLAPPING_SPEECH',
        message: `Candidate ${candidate.id} includes only part of overlapping speech group ${overlapGroupId}.`,
        candidateId: candidate.id,
        remediation: 'Include every content unit in the overlap group or move the candidate boundary outside the overlap.',
      });
    }
  }
}

function createCandidateReport(
  candidate: SmartCutCandidate,
  units: readonly SmartCutContentUnit[],
  blockers: readonly SmartCutSemanticBoundaryBlocker[],
): SmartCutSemanticBoundaryCandidateReport {
  const firstUnit = units[0];
  const lastUnit = units.at(-1);
  const blockerCodes = blockers.map((blocker) => blocker.code);
  return {
    candidateId: candidate.id,
    complete: blockerCodes.length === 0,
    unitCount: units.length,
    unitSpanMs: firstUnit !== undefined && lastUnit !== undefined ? lastUnit.endMs - firstUnit.startMs : 0,
    hasQuestion: units.some(isQuestionUnit),
    hasAnswer: units.some((unit) => !isQuestionUnit(unit) && isAnswerUnit(unit)),
    blockerCodes,
  };
}

function isQuestionUnit(unit: SmartCutContentUnit): boolean {
  return /[?？]\s*$/u.test(unit.text ?? '') ||
    /^(?:when|what|why|how|who|where|which|should|can|could|would|is|are|do|does)\b/iu.test(unit.text ?? '');
}

function isAnswerUnit(unit: SmartCutContentUnit): boolean {
  const text = normalizeText(unit.text ?? '');
  return text.length >= 16 && !isQuestionUnit(unit);
}

function startsWithDanglingConnector(text: string): boolean {
  return /^(?:and|but|so|because|therefore|however|then|also|or)\b/iu.test(normalizeText(text));
}

function startsWithDanglingConnectorFragment(text: string): boolean {
  const normalized = normalizeText(text);
  if (!startsWithDanglingConnector(normalized)) {
    return false;
  }
  if (!/[.!?\u3002\uFF01\uFF1F]\s*$/u.test(normalized)) {
    return true;
  }
  return !hasConnectorLedCompleteClause(normalized);
}

function endsWithDanglingConnector(text: string): boolean {
  return /\b(?:and|but|so|because|therefore|however|then|also|or|if|when|while|although|though)\s*$/iu.test(normalizeText(text));
}

function hasConnectorLedCompleteClause(text: string): boolean {
  const withoutLeadingConnector = text
    .replace(/^(?:and|but|so|because|therefore|however|then|also|or)\b\s*[,，]?\s*/iu, '')
    .trim();
  if (withoutLeadingConnector.length === 0) {
    return false;
  }
  if (/^(?:and|but|so|because|therefore|however|then|also|or)\b/iu.test(withoutLeadingConnector)) {
    return false;
  }
  if (withoutLeadingConnector.length >= 48 && /\s/u.test(withoutLeadingConnector)) {
    return true;
  }
  if (/^(?:keep|show|explain|name|give|make|use|remove|add|choose|start|stop|turn|build|create|check|compare|split|merge|trim|filter)\b/iu.test(withoutLeadingConnector)) {
    return true;
  }
  return /\b(?:is|are|was|were|be|being|been|can|could|should|would|will|must|need|needs|keeps?|shows?|explains?|gives?|makes?|works?|supports?|completes?|starts?|stops?|removes?|answers?|connects?|interrupts?|closes?|lands?|states?|drops?|changes?|shown|caught|saved|preserves?|clamps?)\b/iu.test(withoutLeadingConnector);
}

function normalizeText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

function isPointInsideOrAtRangeBoundary(pointMs: number, range: SmartCutTimeRange): boolean {
  return pointMs >= range.startMs && pointMs <= range.endMs;
}

function compareTimeRanges(left: SmartCutTimeRange, right: SmartCutTimeRange): number {
  return left.startMs - right.startMs || left.endMs - right.endMs;
}
