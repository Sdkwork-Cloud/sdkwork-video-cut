import type {
  SmartCutContentUnit,
  SmartCutSpeakerRole,
  SmartCutTranscriptSegment,
  SmartCutTranscriptEvidence,
} from './domain.ts';
import type { SmartCutProductPresetId } from './presets.ts';
import type { SmartCutOverlappingSpeechGroup, SmartCutSpeakerEvidence, SmartCutSpeakerSegment, SmartCutSpeakerTurn } from './speaker.ts';

export interface SmartCutContentUnitBuildInput {
  presetId: SmartCutProductPresetId;
  transcriptEvidence: SmartCutTranscriptEvidence;
  speakerEvidence: SmartCutSpeakerEvidence;
}

export type SmartCutContentUnitBuildBlockerCode =
  | 'NO_CONTENT_UNITS_BUILT'
  | 'MISSING_CONTENT_UNIT_BUILD_REPORT'
  | 'CONTENT_UNIT_BUILD_REPORT_MISMATCH'
  | 'CONTENT_UNIT_WITHOUT_TRANSCRIPT'
  | 'CONTENT_UNIT_WITHOUT_TRANSCRIPT_EVIDENCE'
  | 'CONTENT_UNIT_WITHOUT_VISUAL_EVIDENCE'
  | 'CONTENT_UNIT_WITHOUT_SPEAKER'
  | 'CONTENT_UNIT_WITHOUT_SPEAKER_EVIDENCE'
  | 'CONTENT_UNIT_WITHOUT_SPEAKER_TURN'
  | 'CONTENT_UNIT_WITHOUT_SPEAKER_ROLE'
  | 'CONTENT_UNIT_LOW_SPEAKER_CONFIDENCE'
  | 'CONTENT_UNIT_CROSSES_SPEAKERS'
  | 'CONTENT_UNIT_INVALID_RANGE'
  | 'CONTENT_UNIT_LOW_COMPLETENESS'
  | 'CONTENT_UNIT_LOW_CONTINUITY'
  | 'DANGLING_CONNECTOR_CONTENT_UNIT'
  | 'QUESTION_UNIT_WITHOUT_ANSWER_UNIT'
  | 'ANSWER_UNIT_WITHOUT_QUESTION_UNIT';

export interface SmartCutContentUnitBuildBlocker {
  code: SmartCutContentUnitBuildBlockerCode;
  message: string;
  unitId?: string;
  remediation: string;
}

export interface SmartCutContentUnitBuildReport {
  ready: boolean;
  presetId: SmartCutProductPresetId;
  units: readonly SmartCutContentUnit[];
  unitCount: number;
  publishableUnitCount: number;
  lowInformationUnitCount: number;
  questionUnitCount: number;
  answerUnitCount: number;
  distinctSpeakerCount: number;
  blockers: readonly SmartCutContentUnitBuildBlocker[];
}

export interface SmartCutContentUnitBuildResult {
  ready: boolean;
  units: readonly SmartCutContentUnit[];
  report: SmartCutContentUnitBuildReport;
}

const publishableUnitThreshold = 0.68;
const minimumCompletenessScore = 0.72;
const minimumContinuityScore = 0.7;
const maximumSameSpeakerSemanticMergeGapMs = 1_500;
const maximumConnectorBridgeGapMs = 3_000;
const maximumSpeechFirstSemanticBridgeGapMs = 22_000;
const maximumContentUnitDurationMs = 70_000;
const maximumSpeechFirstConnectorRepairDurationMs = 90_000;

export function buildSmartCutContentUnits(
  input: SmartCutContentUnitBuildInput,
): SmartCutContentUnitBuildResult {
  const units = normalizeBuiltContentUnits(input.presetId, buildStandardContentUnits(input));
  const report = createSmartCutContentUnitBuildReport(input.presetId, units);

  return {
    ready: report.ready,
    units,
    report,
  };
}

export function validateSmartCutContentUnitBuildReport(
  report: SmartCutContentUnitBuildReport,
): SmartCutContentUnitBuildReport {
  return createSmartCutContentUnitBuildReport(report.presetId, report.units);
}

function createSmartCutContentUnitBuildReport(
  presetId: SmartCutProductPresetId,
  units: readonly SmartCutContentUnit[],
): SmartCutContentUnitBuildReport {
  const blockers: SmartCutContentUnitBuildBlocker[] = [];
  const questionUnitCount = units.filter((unit) => isQuestionUnit(unit)).length;
  const answerUnitCount = units.filter((unit) => isAnswerUnit(unit)).length;

  if (units.length === 0) {
    blockers.push({
      code: 'NO_CONTENT_UNITS_BUILT',
      message: 'No content units were built from transcript and speaker evidence.',
      remediation: 'Run timestamped speech-to-text and speaker diarization before slicer planning.',
    });
  }

  for (const unit of units) {
    validateContentUnit(unit, blockers);
  }

  validateDialogueUnitCompleteness(presetId, questionUnitCount, answerUnitCount, blockers);

  const lowInformationUnitCount = units.filter((unit) => unit.publishabilityScore < publishableUnitThreshold).length;
  const publishableUnitCount = units.length - lowInformationUnitCount;

  return {
    ready: blockers.length === 0,
    presetId,
    units: units.map(cloneContentUnit),
    unitCount: units.length,
    publishableUnitCount,
    lowInformationUnitCount,
    questionUnitCount,
    answerUnitCount,
    distinctSpeakerCount: countDistinctSpeakers(units),
    blockers,
  };
}

function normalizeBuiltContentUnits(
  presetId: SmartCutProductPresetId,
  units: readonly SmartCutContentUnit[],
): readonly SmartCutContentUnit[] {
  return units.map((unit) => {
    if (isDialoguePreset(presetId) && (isQuestionUnit(unit) || isAnswerUnit(unit))) {
      return {
        ...unit,
        unitKind: 'qa-pair',
      };
    }

    return unit;
  });
}

function buildStandardContentUnits(input: SmartCutContentUnitBuildInput): readonly SmartCutContentUnit[] {
  const transcriptSegments = [...input.transcriptEvidence.segments]
    .filter(isValidTranscriptSegment)
    .sort(compareTimeRanges);
  const unitGroups: StandardContentUnitSegmentGroup[] = [];

  for (const segment of transcriptSegments) {
    const speakerId = resolveTranscriptSegmentSpeakerId(segment, input.speakerEvidence.segments);
    const lowInformation = isLowInformationText(segment.text);
    const question = isDialoguePreset(input.presetId) && isQuestionText(segment.text);
    const previousGroup = unitGroups.at(-1);
    if (shouldMergeIntoPreviousStandardContentUnit(input.presetId, previousGroup, segment, speakerId, lowInformation, question)) {
      previousGroup.segments.push(segment);
      previousGroup.endMs = segment.endMs;
      continue;
    }

    unitGroups.push({
      speakerId,
      startMs: segment.startMs,
      endMs: segment.endMs,
      lowInformation,
      question,
      segments: [segment],
    });
  }

  return unitGroups.map((group, index) => createContentUnitFromSegmentGroup(input, group, index));
}

function shouldMergeIntoPreviousStandardContentUnit(
  presetId: SmartCutProductPresetId,
  previousGroup: StandardContentUnitSegmentGroup | undefined,
  segment: SmartCutTranscriptSegment,
  speakerId: string,
  lowInformation: boolean,
  question: boolean,
): previousGroup is StandardContentUnitSegmentGroup {
  if (
    previousGroup === undefined ||
    previousGroup.speakerId !== speakerId ||
    previousGroup.lowInformation ||
    lowInformation ||
    previousGroup.question ||
    question
  ) {
    return false;
  }

  const proposedDurationMs = segment.endMs - previousGroup.startMs;
  if (
    proposedDurationMs > getMaximumContentUnitDurationMs(presetId) &&
    !shouldAllowSpeechFirstConnectorRepairMerge({
      presetId,
      previousText: previousGroup.segments.map((previousSegment) => previousSegment.text).join(' '),
      nextText: segment.text,
      proposedDurationMs,
    })
  ) {
    return false;
  }

  const gapMs = segment.startMs - previousGroup.endMs;
  if (gapMs < 0) {
    return true;
  }
  if (gapMs <= maximumSameSpeakerSemanticMergeGapMs) {
    return true;
  }

  const previousText = previousGroup.segments.map((previousSegment) => previousSegment.text).join(' ');
  if (gapMs <= maximumConnectorBridgeGapMs && (startsWithDanglingConnector(segment.text) || endsWithDanglingConnector(previousText))) {
    return true;
  }

  return shouldBridgeSpeechFirstSemanticChain({
    presetId,
    previousText,
    nextText: segment.text,
    previousStartMs: previousGroup.startMs,
    nextEndMs: segment.endMs,
    gapMs,
  });
}

function getMaximumContentUnitDurationMs(presetId: SmartCutProductPresetId): number {
  if (presetId === 'long-interview-matrix') {
    return 180_000;
  }
  return maximumContentUnitDurationMs;
}

function shouldAllowSpeechFirstConnectorRepairMerge({
  presetId,
  previousText,
  nextText,
  proposedDurationMs,
}: {
  presetId: SmartCutProductPresetId;
  previousText: string;
  nextText: string;
  proposedDurationMs: number;
}): boolean {
  if (presetId !== 'teacher-talking-head-single' || proposedDurationMs > maximumSpeechFirstConnectorRepairDurationMs) {
    return false;
  }

  return endsWithDanglingConnector(previousText) && normalizeText(nextText).length > 0;
}

function shouldBridgeSpeechFirstSemanticChain({
  presetId,
  previousText,
  nextText,
  previousStartMs,
  nextEndMs,
  gapMs,
}: {
  presetId: SmartCutProductPresetId;
  previousText: string;
  nextText: string;
  previousStartMs: number;
  nextEndMs: number;
  gapMs: number;
}): boolean {
  if (presetId !== 'teacher-talking-head-single') {
    return false;
  }
  if (gapMs <= maximumSameSpeakerSemanticMergeGapMs || gapMs > maximumSpeechFirstSemanticBridgeGapMs) {
    return false;
  }
  if (nextEndMs - previousStartMs > getMaximumContentUnitDurationMs(presetId)) {
    return false;
  }

  const previous = normalizeText(previousText);
  const next = normalizeText(nextText);
  if (!previous || !next || isLowInformationText(previous) || isLowInformationText(next)) {
    return false;
  }

  return hasSpeechFirstSetupMarker(previous) && hasSpeechFirstPayoffMarker(next);
}

interface StandardContentUnitSegmentGroup {
  speakerId: string;
  startMs: number;
  endMs: number;
  lowInformation: boolean;
  question: boolean;
  segments: SmartCutTranscriptSegment[];
}

function createContentUnitFromSegmentGroup(
  input: SmartCutContentUnitBuildInput,
  group: StandardContentUnitSegmentGroup,
  index: number,
): SmartCutContentUnit {
  const text = normalizeText(group.segments.map((segment) => segment.text).join(' '));
  const answer = !group.question && !group.lowInformation && text.length >= 16;
  const unitKind = isDialoguePreset(input.presetId) && (group.question || answer) ? 'qa-pair' : 'content-unit';
  const completenessScore = scoreContentUnitCompleteness(text, group.lowInformation);
  const continuityScore = scoreContentUnitContinuity(text, group.lowInformation);
  const publishabilityScore = scoreContentUnitPublishability(text, group.lowInformation);
  const speakerContext = resolveContentUnitSpeakerContext(group, input.speakerEvidence);

  return {
    id: `unit-${index + 1}`,
    startMs: group.startMs,
    endMs: group.endMs,
    unitKind,
    text,
    speakerIds: [group.speakerId],
    speakerTurnIds: speakerContext.speakerTurnIds,
    speakerRoles: speakerContext.speakerRoles,
    speakerConfidence: speakerContext.speakerConfidence,
    overlapGroupIds: speakerContext.overlapGroupIds,
    transcriptSegmentIds: group.segments.map((segment) => segment.id),
    evidenceIds: ['transcript', 'speaker'],
    topicIds: ['topic-unknown'],
    completenessScore,
    continuityScore,
    publishabilityScore,
  };
}

function validateContentUnit(
  unit: SmartCutContentUnit,
  blockers: SmartCutContentUnitBuildBlocker[],
) {
  if (!isValidRange(unit)) {
    blockers.push({
      code: 'CONTENT_UNIT_INVALID_RANGE',
      message: `Content unit ${unit.id} has invalid range ${unit.startMs}-${unit.endMs}.`,
      unitId: unit.id,
      remediation: 'Build content units from ordered timestamped transcript and speaker ranges only.',
    });
  }

  if (isVisualContentUnit(unit)) {
    validateVisualContentUnit(unit, blockers);
    return;
  }

  if (unit.transcriptSegmentIds.length === 0) {
    blockers.push({
      code: 'CONTENT_UNIT_WITHOUT_TRANSCRIPT',
      message: `Content unit ${unit.id} has no transcript segment ids.`,
      unitId: unit.id,
      remediation: 'Every content unit must preserve stable transcript segment ids.',
    });
  }

  if (!unit.evidenceIds.includes('transcript')) {
    blockers.push({
      code: 'CONTENT_UNIT_WITHOUT_TRANSCRIPT_EVIDENCE',
      message: `Content unit ${unit.id} does not declare transcript evidence.`,
      unitId: unit.id,
      remediation: 'Every speech content unit must explicitly declare transcript evidence before it can be audited or rendered.',
    });
  }

  if (unit.speakerIds.length === 0) {
    blockers.push({
      code: 'CONTENT_UNIT_WITHOUT_SPEAKER',
      message: `Content unit ${unit.id} has no speaker ids.`,
      unitId: unit.id,
      remediation: 'Every content unit must preserve speaker identity from diarization.',
    });
  }

  if (!unit.evidenceIds.includes('speaker')) {
    blockers.push({
      code: 'CONTENT_UNIT_WITHOUT_SPEAKER_EVIDENCE',
      message: `Content unit ${unit.id} does not declare speaker evidence.`,
      unitId: unit.id,
      remediation: 'Every speech content unit must explicitly declare speaker evidence before it can be audited or rendered.',
    });
  }

  if (unit.speakerIds.length > 1) {
    blockers.push({
      code: 'CONTENT_UNIT_CROSSES_SPEAKERS',
      message: `Content unit ${unit.id} crosses speakers ${unit.speakerIds.join(',')}.`,
      unitId: unit.id,
      remediation: 'Do not merge multiple speakers into one semantic content unit; preserve speaker turns.',
    });
  }

  if (!Array.isArray(unit.speakerTurnIds) || unit.speakerTurnIds.length === 0) {
    blockers.push({
      code: 'CONTENT_UNIT_WITHOUT_SPEAKER_TURN',
      message: `Content unit ${unit.id} has no speaker turn ids.`,
      unitId: unit.id,
      remediation: 'Build content units after speaker turn alignment so multi-speaker context is traceable.',
    });
  }

  if (!Array.isArray(unit.speakerRoles) || unit.speakerRoles.length === 0 || unit.speakerRoles.includes('unknown')) {
    blockers.push({
      code: 'CONTENT_UNIT_WITHOUT_SPEAKER_ROLE',
      message: `Content unit ${unit.id} has no resolved speaker role.`,
      unitId: unit.id,
      remediation: 'Assign speaker roles from metadata, rules, manual correction, or role inference before slicing dialogue content.',
    });
  }

  if (!Number.isFinite(unit.speakerConfidence) || unit.speakerConfidence < 0.5) {
    blockers.push({
      code: 'CONTENT_UNIT_LOW_SPEAKER_CONFIDENCE',
      message: `Content unit ${unit.id} speaker confidence ${unit.speakerConfidence} is below 0.5.`,
      unitId: unit.id,
      remediation: 'Repair diarization or speaker alignment before building publishable content units.',
    });
  }

  const lowInformation = isLowInformationUnit(unit);
  if (!lowInformation && unit.completenessScore < minimumCompletenessScore) {
    blockers.push({
      code: 'CONTENT_UNIT_LOW_COMPLETENESS',
      message: `Content unit ${unit.id} completeness ${unit.completenessScore} is below ${minimumCompletenessScore}.`,
      unitId: unit.id,
      remediation: 'Extend to complete semantic context or keep the unit out of publishable candidates.',
    });
  }

  if (!lowInformation && unit.continuityScore < minimumContinuityScore) {
    blockers.push({
      code: 'CONTENT_UNIT_LOW_CONTINUITY',
      message: `Content unit ${unit.id} continuity ${unit.continuityScore} is below ${minimumContinuityScore}.`,
      unitId: unit.id,
      remediation: 'Repair speaker turns or adjacent transcript alignment before slicing.',
    });
  }

  if (endsWithDanglingConnector(unit.text ?? '') || startsWithDanglingConnectorFragment(unit.text ?? '')) {
    blockers.push({
      code: 'DANGLING_CONNECTOR_CONTENT_UNIT',
      message: `Content unit ${unit.id} starts or ends with a dangling connector.`,
      unitId: unit.id,
      remediation: 'Merge adjacent transcript context or reject incomplete semantic units.',
    });
  }
}

function validateVisualContentUnit(
  unit: SmartCutContentUnit,
  blockers: SmartCutContentUnitBuildBlocker[],
) {
  if (!unit.evidenceIds.includes('visual')) {
    blockers.push({
      code: 'CONTENT_UNIT_WITHOUT_VISUAL_EVIDENCE',
      message: `Content unit ${unit.id} does not declare visual evidence.`,
      unitId: unit.id,
      remediation: 'Every visual scene or shot content unit must explicitly declare visual evidence before it can be audited or rendered.',
    });
  }

  if (unit.completenessScore < minimumCompletenessScore) {
    blockers.push({
      code: 'CONTENT_UNIT_LOW_COMPLETENESS',
      message: `Content unit ${unit.id} completeness ${unit.completenessScore} is below ${minimumCompletenessScore}.`,
      unitId: unit.id,
      remediation: 'Merge adjacent visual shots into a complete scene or discard incomplete visual evidence.',
    });
  }

  if (unit.continuityScore < minimumContinuityScore) {
    blockers.push({
      code: 'CONTENT_UNIT_LOW_CONTINUITY',
      message: `Content unit ${unit.id} continuity ${unit.continuityScore} is below ${minimumContinuityScore}.`,
      unitId: unit.id,
      remediation: 'Repair scene boundary evidence before creating visual scene candidates.',
    });
  }
}

function isVisualContentUnit(unit: SmartCutContentUnit): boolean {
  return unit.evidenceIds.includes('visual') &&
    (unit.unitKind === 'visual-scene' || unit.unitKind === 'shot');
}

function validateDialogueUnitCompleteness(
  presetId: SmartCutProductPresetId,
  questionUnitCount: number,
  answerUnitCount: number,
  blockers: SmartCutContentUnitBuildBlocker[],
) {
  if (!isDialoguePreset(presetId)) {
    return;
  }

  if (questionUnitCount > 0 && answerUnitCount === 0) {
    blockers.push({
      code: 'QUESTION_UNIT_WITHOUT_ANSWER_UNIT',
      message: `Dialogue preset ${presetId} has ${questionUnitCount} question units but no answer units.`,
      remediation: 'Build Q/A candidates only after both question and answer content units are available.',
    });
  }

  if (answerUnitCount > 0 && questionUnitCount === 0) {
    blockers.push({
      code: 'ANSWER_UNIT_WITHOUT_QUESTION_UNIT',
      message: `Dialogue preset ${presetId} has ${answerUnitCount} answer units but no question units.`,
      remediation: 'Preserve the preceding question context for dialogue slicing.',
    });
  }
}

function isDialoguePreset(presetId: SmartCutProductPresetId): boolean {
  return presetId === 'interview-one-question-one-answer' || presetId === 'long-interview-matrix';
}

function isQuestionUnit(unit: SmartCutContentUnit): boolean {
  const text = unit.text ?? '';
  return unit.unitKind === 'qa-pair' && /[?？]\s*$/u.test(text) ||
    /^(?:when|what|why|how|who|where|which|should|can|could|would|is|are|do|does)\b/iu.test(text);
}

function isAnswerUnit(unit: SmartCutContentUnit): boolean {
  const text = normalizeText(unit.text ?? '');
  return text.length >= 16 && !isQuestionUnit(unit) && unit.publishabilityScore >= publishableUnitThreshold;
}

interface ContentUnitSpeakerContext {
  speakerTurnIds: readonly string[];
  speakerRoles: readonly SmartCutSpeakerRole[];
  speakerConfidence: number;
  overlapGroupIds: readonly string[];
}

function resolveContentUnitSpeakerContext(
  group: StandardContentUnitSegmentGroup,
  speakerEvidence: SmartCutSpeakerEvidence,
): ContentUnitSpeakerContext {
  const transcriptSegmentIds = new Set(group.segments.map((segment) => segment.id));
  const speakerTurns = speakerEvidence.turns.filter((turn) =>
    turn.speakerId === group.speakerId &&
    turn.transcriptSegmentIds.some((segmentId) => transcriptSegmentIds.has(segmentId))
  );
  const speakerRoles = resolveSpeakerRoles(group.speakerId, speakerTurns, speakerEvidence);
  const speakerConfidence = resolveSpeakerConfidence(group, speakerEvidence);
  const overlapGroupIds = resolveOverlapGroupIds(group, speakerEvidence.overlappingSpeechGroups);

  return {
    speakerTurnIds: dedupeStrings(speakerTurns.map((turn) => turn.id)),
    speakerRoles,
    speakerConfidence,
    overlapGroupIds,
  };
}

function resolveSpeakerRoles(
  speakerId: string,
  speakerTurns: readonly SmartCutSpeakerTurn[],
  speakerEvidence: SmartCutSpeakerEvidence,
): readonly SmartCutSpeakerRole[] {
  const turnIds = new Set(speakerTurns.map((turn) => turn.id));
  const assignedRoles = speakerEvidence.roleAssignments
    .filter((assignment) =>
      assignment.speakerId === speakerId &&
      (
        assignment.evidenceTurnIds.length === 0 ||
        assignment.evidenceTurnIds.some((turnId) => turnIds.has(turnId))
      )
    )
    .map((assignment) => assignment.role);
  if (assignedRoles.length > 0) {
    return dedupeSpeakerRoles(assignedRoles);
  }

  const profileRole = speakerEvidence.profiles.find((profile) => profile.id === speakerId)?.role;
  return profileRole === undefined ? ['unknown'] : [profileRole];
}

function resolveSpeakerConfidence(
  group: StandardContentUnitSegmentGroup,
  speakerEvidence: SmartCutSpeakerEvidence,
): number {
  const matchingSegments = speakerEvidence.segments.filter((segment) =>
    segment.speakerId === group.speakerId && rangesOverlap(segment, group)
  );
  if (matchingSegments.length > 0) {
    const average = matchingSegments.reduce((sum, segment) => sum + segment.confidence, 0) / matchingSegments.length;
    return clampScore(average);
  }

  const profileConfidence = speakerEvidence.profiles.find((profile) => profile.id === group.speakerId)?.confidence;
  return profileConfidence === undefined ? 0 : clampScore(profileConfidence);
}

function resolveOverlapGroupIds(
  group: StandardContentUnitSegmentGroup,
  overlappingSpeechGroups: readonly SmartCutOverlappingSpeechGroup[],
): readonly string[] {
  return dedupeStrings(overlappingSpeechGroups
    .filter((overlapGroup) =>
      overlapGroup.speakerIds.includes(group.speakerId) &&
      rangesOverlap(overlapGroup, group)
    )
    .map((overlapGroup) => overlapGroup.id));
}

function startsWithDanglingConnector(text: string): boolean {
  return /^(?:(?:and|but|so|because|therefore|however|then|also|or)\b|\u6240\u4ee5|\u56e0\u6b64|\u4f46\u662f|\u7136\u540e|\u800c\u4e14|\u56e0\u4e3a|\u4e0d\u8fc7|\u53ef\u662f|\u5982\u679c|\u5f53)/iu.test(normalizeText(text));
}

function startsWithDanglingConnectorFragment(text: string): boolean {
  const normalized = normalizeText(text);
  if (!startsWithDanglingConnector(normalized)) {
    return false;
  }
  if (hasCompleteChineseConnectorLedClause(normalized)) {
    return false;
  }
  if (!/[.!?\u3002\uFF01\uFF1F]\s*$/u.test(normalized)) {
    return true;
  }
  return !hasConnectorLedCompleteClause(normalized);
}

function endsWithDanglingConnector(text: string): boolean {
  return /(?:\b(?:and|but|so|because|therefore|however|then|also|or|if|when|while|although|though)|\u6240\u4ee5|\u56e0\u6b64|\u4f46\u662f|\u7136\u540e|\u800c\u4e14|\u56e0\u4e3a|\u4e0d\u8fc7|\u53ef\u662f|\u5982\u679c|\u5f53|\u867d\u7136)\s*$/iu.test(normalizeText(text));
}

function hasConnectorLedCompleteClause(text: string): boolean {
  if (hasCompleteChineseConnectorLedClause(text)) {
    return true;
  }

  const withoutLeadingConnector = text
    .replace(/^(?:(?:and|but|so|because|therefore|however|then|also|or)\b|所以|因此|但是|然后|而且|因为|不过|可是|如果|当)\s*[,，]?\s*/iu, '')
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

function hasCompleteChineseConnectorLedClause(text: string): boolean {
  const withoutLeadingConnector = normalizeText(text)
    .replace(/^(?:\u6240\u4ee5|\u56e0\u6b64|\u4f46\u662f|\u7136\u540e|\u800c\u4e14|\u56e0\u4e3a|\u4e0d\u8fc7|\u53ef\u662f|\u5982\u679c|\u5f53)\s*(?:[,，、。；;：:]|\s)*/u, '')
    .trim();
  if (withoutLeadingConnector.length < 6) {
    return false;
  }
  if (/^(?:\u6240\u4ee5|\u56e0\u6b64|\u4f46\u662f|\u7136\u540e|\u800c\u4e14|\u56e0\u4e3a|\u4e0d\u8fc7|\u53ef\u662f|\u5982\u679c|\u5f53)/u.test(withoutLeadingConnector)) {
    return false;
  }
  if (withoutLeadingConnector.length >= 48) {
    return true;
  }
  return /(?:\u662f|\u6709|\u8981|\u9700\u8981|\u53ef\u4ee5|\u80fd|\u4f1a|\u786e\u5b9e|\u6ca1\u6709|\u4e0d\u662f|\u884c|\u591a|\u5927|\u5c0f|\u559c\u6b22|\u89c9\u5f97|\u4f4f|\u505a|\u770b|\u5f04|\u5408\u6cd5|\u89e3\u51b3|\u652f\u6301|\u5b8c\u6210|\u95ee\u9898|\u7ed3\u679c|\u7b54\u6848|\u539f\u56e0|\u56e0\u4e3a|\u6240\u4ee5)/u.test(withoutLeadingConnector);
}

function normalizeText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

function hasSpeechFirstSetupMarker(text: string): boolean {
  const normalized = normalizeText(text).toLowerCase();
  return /\b(?:if|when|as long as|provided|case|because|problem|pain|setup|condition|apply|application|experience|need|wants?|route|path)\b/iu.test(normalized) ||
    /(?:\u53ea\u8981|\u5982\u679c|\u5f53|\u6761\u4ef6|\u7533\u8bf7|\u7ecf\u9a8c|\u8def\u5f84|\u65b9\u6848|\u9700\u8981)/u.test(normalized);
}

function hasSpeechFirstPayoffMarker(text: string): boolean {
  const normalized = normalizeText(text).toLowerCase();
  return /\b(?:payoff|result|answer|solution|finally|legal|entry|enter|admission|family|complete|outcome|benefit|return|back)\b/iu.test(normalized) ||
    /(?:\u6700\u5feb|\u5408\u6cd5|\u5165\u5883|\u7ed3\u679c|\u7b54\u6848|\u89e3\u51b3|\u56de\u5230|\u5e26\u7740|\u5bb6\u4eba|\u957f\u671f|\u6536\u83b7|\u56de\u62a5)/u.test(normalized);
}

function isLowInformationUnit(unit: SmartCutContentUnit): boolean {
  return unit.publishabilityScore < publishableUnitThreshold && isLowInformationText(unit.text ?? '');
}

function isLowInformationText(text: string): boolean {
  const normalized = normalizeText(text).toLowerCase();
  if (normalized.length === 0) {
    return true;
  }

  return normalized.length <= 6 && /^(?:ok|okay|yes|yeah|uh|um|hm|hmm|er|ah|嗯|呃|啊|哦|唔|,|，|。|\.)+$/iu.test(normalized);
}

function isQuestionText(text: string): boolean {
  const normalized = normalizeText(text);
  return /[?？]\s*$/u.test(normalized) ||
    /^(?:when|what|why|how|who|where|which|should|can|could|would|is|are|do|does)\b/iu.test(normalized);
}

function scoreContentUnitCompleteness(text: string, lowInformation: boolean): number {
  if (lowInformation) {
    return 0.35;
  }

  let score = 0.78;
  if (/[.。!?！？]\s*$/u.test(text)) {
    score += 0.12;
  }
  if (text.length >= 24) {
    score += 0.06;
  }
  return clampScore(score);
}

function scoreContentUnitContinuity(text: string, lowInformation: boolean): number {
  if (lowInformation) {
    return 0.42;
  }

  let score = 0.78;
  if (!endsWithDanglingConnector(text) && !startsWithDanglingConnector(text)) {
    score += 0.12;
  }
  if (text.length >= 24) {
    score += 0.04;
  }
  return clampScore(score);
}

function scoreContentUnitPublishability(text: string, lowInformation: boolean): number {
  if (lowInformation) {
    return 0.24;
  }

  let score = 0.72;
  if (text.length >= 24) {
    score += 0.1;
  }
  if (/[.。!?！？]\s*$/u.test(text)) {
    score += 0.08;
  }
  return clampScore(score);
}

function resolveTranscriptSegmentSpeakerId(
  segment: SmartCutTranscriptSegment,
  speakerSegments: readonly SmartCutSpeakerSegment[],
): string {
  if (segment.speakerId?.trim()) {
    return segment.speakerId.trim();
  }

  let bestSpeakerId = 'speaker-unknown';
  let bestOverlapMs = 0;
  for (const speakerSegment of speakerSegments) {
    const overlapMs = Math.max(
      0,
      Math.min(segment.endMs, speakerSegment.endMs) - Math.max(segment.startMs, speakerSegment.startMs),
    );
    if (overlapMs > bestOverlapMs) {
      bestOverlapMs = overlapMs;
      bestSpeakerId = speakerSegment.speakerId;
    }
  }

  return bestSpeakerId;
}

function isValidTranscriptSegment(segment: SmartCutTranscriptSegment): boolean {
  return Number.isFinite(segment.startMs) &&
    Number.isFinite(segment.endMs) &&
    Number.isInteger(segment.startMs) &&
    Number.isInteger(segment.endMs) &&
    segment.endMs > segment.startMs &&
    normalizeText(segment.text).length > 0;
}

function compareTimeRanges(
  left: { startMs: number; endMs: number },
  right: { startMs: number; endMs: number },
): number {
  return left.startMs - right.startMs || left.endMs - right.endMs;
}

function rangesOverlap(
  left: { startMs: number; endMs: number },
  right: { startMs: number; endMs: number },
): boolean {
  return Math.min(left.endMs, right.endMs) > Math.max(left.startMs, right.startMs);
}

function isValidRange(unit: SmartCutContentUnit): boolean {
  return Number.isFinite(unit.startMs) &&
    Number.isFinite(unit.endMs) &&
    Number.isInteger(unit.startMs) &&
    Number.isInteger(unit.endMs) &&
    unit.endMs > unit.startMs;
}

function countDistinctSpeakers(units: readonly SmartCutContentUnit[]): number {
  return new Set(units.flatMap((unit) => unit.speakerIds)).size;
}

function cloneContentUnit(unit: SmartCutContentUnit): SmartCutContentUnit {
  return {
    ...unit,
    speakerIds: [...unit.speakerIds],
    speakerTurnIds: [...(unit.speakerTurnIds ?? [])],
    speakerRoles: [...(unit.speakerRoles ?? [])],
    speakerConfidence: Number.isFinite(unit.speakerConfidence) ? unit.speakerConfidence : 0,
    overlapGroupIds: [...(unit.overlapGroupIds ?? [])],
    transcriptSegmentIds: [...unit.transcriptSegmentIds],
    evidenceIds: [...unit.evidenceIds],
    topicIds: [...unit.topicIds],
  };
}

function clampScore(score: number): number {
  return Math.round(Math.max(0, Math.min(1, score)) * 100) / 100;
}

function dedupeStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function dedupeSpeakerRoles(values: readonly SmartCutSpeakerRole[]): readonly SmartCutSpeakerRole[] {
  return [...new Set(values)];
}
