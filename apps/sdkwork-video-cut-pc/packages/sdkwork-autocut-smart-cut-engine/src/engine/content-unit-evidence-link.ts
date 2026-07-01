import type {
  SmartCutContentUnit,
  SmartCutSpeakerRole,
  SmartCutTranscriptEvidence,
  SmartCutTranscriptSegment,
} from './domain.ts';
import type {
  SmartCutSpeakerEvidence,
  SmartCutSpeakerProfile,
  SmartCutSpeakerRoleAssignment,
  SmartCutSpeakerSegment,
  SmartCutSpeakerTurn,
} from './speaker.ts';

export interface SmartCutContentUnitEvidenceLinkInput {
  contentUnits: readonly SmartCutContentUnit[];
  transcriptEvidence: SmartCutTranscriptEvidence;
  speakerEvidence: SmartCutSpeakerEvidence;
}

export type SmartCutContentUnitEvidenceLinkBlockerCode =
  | 'CONTENT_UNIT_TRANSCRIPT_EVIDENCE_NOT_DECLARED'
  | 'CONTENT_UNIT_TRANSCRIPT_SEGMENT_NOT_FOUND'
  | 'CONTENT_UNIT_TRANSCRIPT_RANGE_MISMATCH'
  | 'CONTENT_UNIT_TRANSCRIPT_TEXT_MISMATCH'
  | 'CONTENT_UNIT_TRANSCRIPT_SPEAKER_MISMATCH'
  | 'CONTENT_UNIT_SPEAKER_EVIDENCE_NOT_DECLARED'
  | 'CONTENT_UNIT_SPEAKER_NOT_FOUND'
  | 'CONTENT_UNIT_SPEAKER_SEGMENT_NOT_FOUND'
  | 'CONTENT_UNIT_SPEAKER_TURN_NOT_FOUND'
  | 'CONTENT_UNIT_SPEAKER_TURN_SEGMENT_MISMATCH'
  | 'CONTENT_UNIT_SPEAKER_ROLE_NOT_SUPPORTED'
  | 'CONTENT_UNIT_OVERLAP_GROUP_NOT_FOUND';

export interface SmartCutContentUnitEvidenceLinkBlocker {
  code: SmartCutContentUnitEvidenceLinkBlockerCode;
  message: string;
  unitId: string;
  evidenceId?: string;
  remediation: string;
}

export interface SmartCutContentUnitEvidenceLinkMetrics {
  unitCount: number;
  linkedTranscriptSegmentCount: number;
  linkedSpeakerCount: number;
  linkedSpeakerTurnCount: number;
  linkedOverlapGroupCount: number;
}

export interface SmartCutContentUnitEvidenceLinkReport {
  ready: boolean;
  metrics: SmartCutContentUnitEvidenceLinkMetrics;
  blockers: readonly SmartCutContentUnitEvidenceLinkBlocker[];
}

const minimumSpeakerOverlapMs = 200;
const minimumShortSegmentCoverageRatio = 0.8;

export function validateSmartCutContentUnitEvidenceLink(
  input: SmartCutContentUnitEvidenceLinkInput,
): SmartCutContentUnitEvidenceLinkReport {
  const transcriptSegmentById = new Map(input.transcriptEvidence.segments.map((segment) => [segment.id, segment]));
  const speakerProfileById = new Map(input.speakerEvidence.profiles.map((profile) => [profile.id, profile]));
  const speakerTurnsById = new Map(input.speakerEvidence.turns.map((turn) => [turn.id, turn]));
  const roleAssignmentsBySpeakerId = groupRoleAssignmentsBySpeakerId(input.speakerEvidence.roleAssignments);
  const blockers: SmartCutContentUnitEvidenceLinkBlocker[] = [];

  for (const unit of input.contentUnits) {
    validateDeclaredEvidenceKinds(unit, blockers);
    validateTranscriptLinks(unit, transcriptSegmentById, blockers);
    validateSpeakerLinks(unit, input.speakerEvidence.segments, speakerProfileById, blockers);
    validateSpeakerTurnLinks(unit, speakerTurnsById, blockers);
    validateSpeakerRoleLinks(unit, speakerProfileById, roleAssignmentsBySpeakerId, blockers);
    validateOverlapGroupLinks(unit, input.speakerEvidence.overlappingSpeechGroups, blockers);
  }

  return {
    ready: blockers.length === 0,
    metrics: createContentUnitEvidenceLinkMetrics(input.contentUnits),
    blockers,
  };
}

function validateDeclaredEvidenceKinds(
  unit: SmartCutContentUnit,
  blockers: SmartCutContentUnitEvidenceLinkBlocker[],
) {
  if (!unit.evidenceIds.includes('transcript')) {
    blockers.push({
      code: 'CONTENT_UNIT_TRANSCRIPT_EVIDENCE_NOT_DECLARED',
      message: `Content unit ${unit.id} does not declare transcript evidence.`,
      unitId: unit.id,
      remediation: 'Preserve transcript in content unit evidenceIds so audit traces can prove the unit came from STT evidence.',
    });
  }

  if (!unit.evidenceIds.includes('speaker')) {
    blockers.push({
      code: 'CONTENT_UNIT_SPEAKER_EVIDENCE_NOT_DECLARED',
      message: `Content unit ${unit.id} does not declare speaker evidence.`,
      unitId: unit.id,
      remediation: 'Preserve speaker in content unit evidenceIds so audit traces can prove the unit came from diarization evidence.',
    });
  }
}

function validateTranscriptLinks(
  unit: SmartCutContentUnit,
  transcriptSegmentById: ReadonlyMap<string, SmartCutTranscriptSegment>,
  blockers: SmartCutContentUnitEvidenceLinkBlocker[],
) {
  const linkedSegments: SmartCutTranscriptSegment[] = [];
  for (const segmentId of unit.transcriptSegmentIds) {
    const segment = transcriptSegmentById.get(segmentId);
    if (segment === undefined) {
      blockers.push({
        code: 'CONTENT_UNIT_TRANSCRIPT_SEGMENT_NOT_FOUND',
        message: `Content unit ${unit.id} references missing transcript segment ${segmentId}.`,
        unitId: unit.id,
        evidenceId: segmentId,
        remediation: 'Build content units from the same timestamped transcript evidence passed to the execution package.',
      });
      continue;
    }
    linkedSegments.push(segment);

    if (segment.speakerId !== undefined && unit.speakerIds.length > 0 && !unit.speakerIds.includes(segment.speakerId)) {
      blockers.push({
        code: 'CONTENT_UNIT_TRANSCRIPT_SPEAKER_MISMATCH',
        message: `Content unit ${unit.id} transcript segment ${segmentId} belongs to speaker ${segment.speakerId}, not ${unit.speakerIds.join(',')}.`,
        unitId: unit.id,
        evidenceId: segmentId,
        remediation: 'Rebuild speaker-aligned content units so transcript segment speaker ids match the unit speaker ids.',
      });
    }
  }

  if (linkedSegments.length === 0) {
    return;
  }

  const transcriptStartMs = Math.min(...linkedSegments.map((segment) => segment.startMs));
  const transcriptEndMs = Math.max(...linkedSegments.map((segment) => segment.endMs));
  if (unit.startMs !== transcriptStartMs || unit.endMs !== transcriptEndMs) {
    blockers.push({
      code: 'CONTENT_UNIT_TRANSCRIPT_RANGE_MISMATCH',
      message: `Content unit ${unit.id} range ${unit.startMs}-${unit.endMs} does not match transcript evidence range ${transcriptStartMs}-${transcriptEndMs}.`,
      unitId: unit.id,
      remediation: 'Snap content unit time ranges to the exact span of their referenced transcript segments.',
    });
  }

  const unitText = normalizeText(unit.text ?? '');
  const transcriptText = normalizeText(linkedSegments.map((segment) => segment.text).join(' '));
  if (unitText.length > 0 && transcriptText.length > 0 && unitText !== transcriptText) {
    blockers.push({
      code: 'CONTENT_UNIT_TRANSCRIPT_TEXT_MISMATCH',
      message: `Content unit ${unit.id} text does not match its referenced transcript segments.`,
      unitId: unit.id,
      remediation: 'Do not mutate content unit text after building it from transcript evidence.',
    });
  }
}

function validateSpeakerLinks(
  unit: SmartCutContentUnit,
  speakerSegments: readonly SmartCutSpeakerSegment[],
  speakerProfileById: ReadonlyMap<string, SmartCutSpeakerProfile>,
  blockers: SmartCutContentUnitEvidenceLinkBlocker[],
) {
  for (const speakerId of unit.speakerIds) {
    if (!speakerProfileById.has(speakerId)) {
      blockers.push({
        code: 'CONTENT_UNIT_SPEAKER_NOT_FOUND',
        message: `Content unit ${unit.id} references missing speaker profile ${speakerId}.`,
        unitId: unit.id,
        evidenceId: speakerId,
        remediation: 'Use speaker ids produced by the same diarization evidence passed to the execution package.',
      });
    }

    const covered = speakerSegments.some((segment) =>
      segment.speakerId === speakerId && hasReliableSpeakerSegmentOverlap(unit, segment)
    );
    if (!covered) {
      blockers.push({
        code: 'CONTENT_UNIT_SPEAKER_SEGMENT_NOT_FOUND',
        message: `Content unit ${unit.id} has no diarization segment overlap for speaker ${speakerId}.`,
        unitId: unit.id,
        evidenceId: speakerId,
        remediation: 'Repair speaker diarization ranges or rebuild content units from aligned speaker evidence.',
      });
    }
  }
}

function validateSpeakerTurnLinks(
  unit: SmartCutContentUnit,
  speakerTurnsById: ReadonlyMap<string, SmartCutSpeakerTurn>,
  blockers: SmartCutContentUnitEvidenceLinkBlocker[],
) {
  const unitTranscriptIds = new Set(unit.transcriptSegmentIds);
  const coveredTranscriptIds = new Set<string>();
  let resolvedTurnCount = 0;
  for (const turnId of unit.speakerTurnIds) {
    const turn = speakerTurnsById.get(turnId);
    if (turn === undefined) {
      blockers.push({
        code: 'CONTENT_UNIT_SPEAKER_TURN_NOT_FOUND',
        message: `Content unit ${unit.id} references missing speaker turn ${turnId}.`,
        unitId: unit.id,
        evidenceId: turnId,
        remediation: 'Run transcript-speaker alignment and use only real speaker turn ids in content units.',
      });
      continue;
    }

    resolvedTurnCount += 1;
    const speakerMatchesUnit = unit.speakerIds.includes(turn.speakerId);
    if (!unit.speakerIds.includes(turn.speakerId)) {
      blockers.push({
        code: 'CONTENT_UNIT_SPEAKER_TURN_SEGMENT_MISMATCH',
        message: `Content unit ${unit.id} turn ${turnId} belongs to speaker ${turn.speakerId}, not ${unit.speakerIds.join(',')}.`,
        unitId: unit.id,
        evidenceId: turnId,
        remediation: 'Rebuild content units so every speaker turn belongs to the unit speaker.',
      });
    }

    const overlapsReferencedTranscript = turn.transcriptSegmentIds.some((segmentId) =>
      unitTranscriptIds.has(segmentId)
    );
    if (!overlapsReferencedTranscript) {
      blockers.push({
        code: 'CONTENT_UNIT_SPEAKER_TURN_SEGMENT_MISMATCH',
        message: `Content unit ${unit.id} turn ${turnId} does not overlap the unit transcript segment ids.`,
        unitId: unit.id,
        evidenceId: turnId,
        remediation: 'Align speaker turns to the exact transcript segments used by each content unit.',
      });
      continue;
    }

    if (!speakerMatchesUnit) {
      continue;
    }

    for (const segmentId of turn.transcriptSegmentIds) {
      if (unitTranscriptIds.has(segmentId)) {
        coveredTranscriptIds.add(segmentId);
      }
    }
  }

  if (resolvedTurnCount > 0) {
    const uncoveredTranscriptSegmentIds = unit.transcriptSegmentIds.filter((segmentId) =>
      !coveredTranscriptIds.has(segmentId)
    );
    if (uncoveredTranscriptSegmentIds.length > 0) {
      blockers.push({
        code: 'CONTENT_UNIT_SPEAKER_TURN_SEGMENT_MISMATCH',
        message: `Content unit ${unit.id} speaker turns do not cover transcript segment ids ${uncoveredTranscriptSegmentIds.join(',')}.`,
        unitId: unit.id,
        evidenceId: uncoveredTranscriptSegmentIds.join(','),
        remediation: 'Align speaker turns so their combined same-speaker transcript segment ids cover each content unit.',
      });
    }
  }
}

function validateSpeakerRoleLinks(
  unit: SmartCutContentUnit,
  speakerProfileById: ReadonlyMap<string, SmartCutSpeakerProfile>,
  roleAssignmentsBySpeakerId: ReadonlyMap<string, readonly SmartCutSpeakerRoleAssignment[]>,
  blockers: SmartCutContentUnitEvidenceLinkBlocker[],
) {
  const unitSpeakerTurnIds = new Set(unit.speakerTurnIds);
  for (const speakerId of unit.speakerIds) {
    const supportedRoles = new Set<SmartCutSpeakerRole>();
    const profileRole = speakerProfileById.get(speakerId)?.role;
    if (profileRole !== undefined) {
      supportedRoles.add(profileRole);
    }
    for (const assignment of roleAssignmentsBySpeakerId.get(speakerId) ?? []) {
      const supportsUnitTurn = assignment.evidenceTurnIds.length === 0 ||
        assignment.evidenceTurnIds.some((turnId) => unitSpeakerTurnIds.has(turnId));
      if (!supportsUnitTurn) {
        continue;
      }
      supportedRoles.add(assignment.role);
    }

    for (const role of unit.speakerRoles) {
      if (role === 'unknown' || !supportedRoles.has(role)) {
        blockers.push({
          code: 'CONTENT_UNIT_SPEAKER_ROLE_NOT_SUPPORTED',
          message: `Content unit ${unit.id} role ${role} is not supported by speaker evidence for ${speakerId}.`,
          unitId: unit.id,
          evidenceId: speakerId,
          remediation: 'Resolve speaker roles in speaker evidence before building content units.',
        });
      }
    }
  }
}

function validateOverlapGroupLinks(
  unit: SmartCutContentUnit,
  overlappingSpeechGroups: SmartCutContentUnitEvidenceLinkInput['speakerEvidence']['overlappingSpeechGroups'],
  blockers: SmartCutContentUnitEvidenceLinkBlocker[],
) {
  for (const overlapGroupId of unit.overlapGroupIds) {
    const group = overlappingSpeechGroups.find((candidate) => candidate.id === overlapGroupId);
    if (group === undefined || getOverlapMs(unit, group) <= 0) {
      blockers.push({
        code: 'CONTENT_UNIT_OVERLAP_GROUP_NOT_FOUND',
        message: `Content unit ${unit.id} references missing or non-overlapping speech group ${overlapGroupId}.`,
        unitId: unit.id,
        evidenceId: overlapGroupId,
        remediation: 'Use overlap group ids from the same speaker evidence and preserve their time overlap.',
      });
    }
  }
}

function createContentUnitEvidenceLinkMetrics(
  contentUnits: readonly SmartCutContentUnit[],
): SmartCutContentUnitEvidenceLinkMetrics {
  return {
    unitCount: contentUnits.length,
    linkedTranscriptSegmentCount: countDistinct(contentUnits.flatMap((unit) => unit.transcriptSegmentIds)),
    linkedSpeakerCount: countDistinct(contentUnits.flatMap((unit) => unit.speakerIds)),
    linkedSpeakerTurnCount: countDistinct(contentUnits.flatMap((unit) => unit.speakerTurnIds)),
    linkedOverlapGroupCount: countDistinct(contentUnits.flatMap((unit) => unit.overlapGroupIds)),
  };
}

function groupRoleAssignmentsBySpeakerId(
  assignments: readonly SmartCutSpeakerRoleAssignment[],
): ReadonlyMap<string, readonly SmartCutSpeakerRoleAssignment[]> {
  const grouped = new Map<string, SmartCutSpeakerRoleAssignment[]>();
  for (const assignment of assignments) {
    const existing = grouped.get(assignment.speakerId);
    if (existing === undefined) {
      grouped.set(assignment.speakerId, [assignment]);
    } else {
      existing.push(assignment);
    }
  }
  return grouped;
}

function getOverlapMs(
  left: { startMs: number; endMs: number },
  right: { startMs: number; endMs: number },
): number {
  return Math.max(0, Math.min(left.endMs, right.endMs) - Math.max(left.startMs, right.startMs));
}

function hasReliableSpeakerSegmentOverlap(
  unit: { startMs: number; endMs: number },
  speakerSegment: { startMs: number; endMs: number },
): boolean {
  const overlapMs = getOverlapMs(unit, speakerSegment);
  if (overlapMs >= minimumSpeakerOverlapMs) {
    return true;
  }

  const shorterDurationMs = Math.min(unit.endMs - unit.startMs, speakerSegment.endMs - speakerSegment.startMs);
  if (shorterDurationMs <= 0 || shorterDurationMs >= minimumSpeakerOverlapMs) {
    return false;
  }

  return overlapMs >= Math.ceil(shorterDurationMs * minimumShortSegmentCoverageRatio);
}

function normalizeText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

function countDistinct(values: readonly string[]): number {
  return new Set(values).size;
}
