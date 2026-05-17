import type {
  SmartCutTimeRange,
  SmartCutTranscriptEvidence,
} from './domain.ts';
import type { SmartCutSpeakerEvidence } from './speaker.ts';

export interface SmartCutSpeakerEvidenceStructureValidationInput {
  speakerEvidence: SmartCutSpeakerEvidence;
  transcriptEvidence: SmartCutTranscriptEvidence;
  sourceDurationMs: number;
}

export type SmartCutSpeakerEvidenceStructureBlockerCode =
  | 'MISSING_SPEAKER_DIARIZATION'
  | 'SPEAKER_PROFILES_INVALID'
  | 'SPEAKER_SEGMENTS_INVALID'
  | 'SPEAKER_TURNS_INVALID'
  | 'OVERLAP_GROUPS_INVALID'
  | 'SPEAKER_ROLE_ASSIGNMENTS_INVALID'
  | 'SPEAKER_CORRECTIONS_INVALID'
  | 'SPEAKER_PROFILE_INVALID'
  | 'SPEAKER_SEGMENT_INVALID'
  | 'SPEAKER_TURN_INVALID'
  | 'OVERLAP_GROUP_INVALID'
  | 'SPEAKER_ROLE_ASSIGNMENT_INVALID'
  | 'SPEAKER_CORRECTION_INVALID'
  | 'SPEAKER_PROFILE_ID_MISSING'
  | 'DUPLICATE_SPEAKER_PROFILE_ID'
  | 'SPEAKER_PROFILE_DISPLAY_NAME_MISSING'
  | 'SPEAKER_PROFILE_CONFIDENCE_INVALID'
  | 'SPEAKER_PROFILE_ROLE_INVALID'
  | 'SPEAKER_PROFILE_SOURCE_INVALID'
  | 'SPEAKER_SEGMENT_ID_MISSING'
  | 'DUPLICATE_SPEAKER_SEGMENT_ID'
  | 'SPEAKER_SEGMENT_SPEAKER_ID_MISSING'
  | 'SPEAKER_SEGMENT_CONFIDENCE_INVALID'
  | 'INVALID_SPEAKER_SEGMENT_RANGE'
  | 'SPEAKER_SEGMENT_OUT_OF_SOURCE'
  | 'UNKNOWN_SPEAKER_REFERENCE'
  | 'SPEAKER_TURN_ID_MISSING'
  | 'DUPLICATE_SPEAKER_TURN_ID'
  | 'INVALID_SPEAKER_TURN_RANGE'
  | 'SPEAKER_TURN_OUT_OF_SOURCE'
  | 'SPEAKER_TURN_WITHOUT_TRANSCRIPT_SEGMENTS'
  | 'SPEAKER_TURN_TEXT_MISSING'
  | 'SPEAKER_TURN_UNKNOWN_TRANSCRIPT_SEGMENT'
  | 'SPEAKER_TURN_TRANSCRIPT_RANGE_MISMATCH'
  | 'SPEAKER_TURN_UNKNOWN_SPEAKER'
  | 'SPEAKER_TURN_SPEAKER_MISMATCH'
  | 'OVERLAP_GROUP_ID_MISSING'
  | 'DUPLICATE_OVERLAP_GROUP_ID'
  | 'INVALID_OVERLAP_GROUP_RANGE'
  | 'OVERLAP_GROUP_OUT_OF_SOURCE'
  | 'OVERLAP_GROUP_WITHOUT_MULTIPLE_SPEAKERS'
  | 'DUPLICATE_OVERLAP_GROUP_SPEAKER'
  | 'OVERLAP_GROUP_UNKNOWN_SPEAKER_REFERENCE'
  | 'OVERLAP_GROUP_WITHOUT_SEGMENTS'
  | 'DUPLICATE_OVERLAP_GROUP_SEGMENT'
  | 'OVERLAP_GROUP_UNKNOWN_SEGMENT_REFERENCE'
  | 'OVERLAP_GROUP_SEGMENT_RANGE_MISMATCH'
  | 'OVERLAP_GROUP_SEGMENT_SPEAKER_MISMATCH'
  | 'OVERLAP_GROUP_SPEAKER_WITHOUT_SEGMENT'
  | 'OVERLAP_GROUP_WITHOUT_REAL_OVERLAP'
  | 'SPEAKER_ROLE_ASSIGNMENT_UNKNOWN_SPEAKER'
  | 'SPEAKER_ROLE_ASSIGNMENT_CONFIDENCE_INVALID'
  | 'SPEAKER_ROLE_ASSIGNMENT_ROLE_INVALID'
  | 'SPEAKER_ROLE_ASSIGNMENT_SOURCE_INVALID'
  | 'SPEAKER_ROLE_ASSIGNMENT_UNKNOWN_TURN'
  | 'SPEAKER_ROLE_ASSIGNMENT_TURN_SPEAKER_MISMATCH'
  | 'SPEAKER_ROLE_ASSIGNMENT_AMBIGUOUS'
  | 'SPEAKER_ROLE_ASSIGNMENT_CONFLICT';

export interface SmartCutSpeakerEvidenceStructureBlocker {
  code: SmartCutSpeakerEvidenceStructureBlockerCode;
  message: string;
  segmentId?: string;
  speakerId?: string;
  remediation: string;
}

export interface SmartCutSpeakerEvidenceStructureValidationReport {
  ready: boolean;
  blockers: readonly SmartCutSpeakerEvidenceStructureBlocker[];
}

const minimumSpeakerOverlapMs = 200;
const minimumShortSegmentCoverageRatio = 0.8;
const validSpeakerRoles = new Set(['teacher', 'host', 'interviewer', 'guest', 'speaker', 'moderator', 'narrator', 'unknown']);
const validSpeakerProfileSources = new Set(['diarization', 'voiceprint', 'manual', 'metadata', 'llm-role-inference']);
const validSpeakerRoleAssignmentSources = new Set(['manual', 'metadata', 'llm-role-inference', 'rule']);

export function validateSmartCutSpeakerEvidenceStructure(
  input: SmartCutSpeakerEvidenceStructureValidationInput,
): SmartCutSpeakerEvidenceStructureValidationReport {
  const blockers: SmartCutSpeakerEvidenceStructureBlocker[] = [];

  blockers.push(...validateSpeakerEvidenceContainers(input.speakerEvidence));
  if (blockers.length === 0) {
    blockers.push(...validateSpeakerEvidenceItems(input.speakerEvidence));
  }
  if (blockers.length > 0) {
    return {
      ready: false,
      blockers,
    };
  }

  if (input.speakerEvidence.profiles.length === 0 || input.speakerEvidence.segments.length === 0) {
    blockers.push({
      code: 'MISSING_SPEAKER_DIARIZATION',
      message: 'Speaker evidence has no diarized speaker profiles or segments.',
      remediation: 'Run speaker diarization and preserve speaker profiles plus timestamped speaker segments before semantic slicing.',
    });
    return {
      ready: false,
      blockers,
    };
  }

  const profileIds = validateSpeakerProfiles(input, blockers);
  const speakerSegmentIds = validateSpeakerSegments(input, profileIds, blockers);
  validateSpeakerTurns(input, profileIds, blockers);
  validateOverlapGroups(input, profileIds, speakerSegmentIds, blockers);
  validateSpeakerRoleAssignments(input, profileIds, blockers);

  return {
    ready: blockers.length === 0,
    blockers,
  };
}

function validateSpeakerEvidenceContainers(
  speakerEvidence: SmartCutSpeakerEvidence,
): readonly SmartCutSpeakerEvidenceStructureBlocker[] {
  const blockers: SmartCutSpeakerEvidenceStructureBlocker[] = [];
  if (!Array.isArray(speakerEvidence.profiles)) {
    blockers.push({
      code: 'SPEAKER_PROFILES_INVALID',
      message: 'Speaker evidence profiles must be an array.',
      remediation: 'Return canonical speaker evidence with a profiles array before speaker validation.',
    });
  }
  if (!Array.isArray(speakerEvidence.segments)) {
    blockers.push({
      code: 'SPEAKER_SEGMENTS_INVALID',
      message: 'Speaker evidence segments must be an array.',
      remediation: 'Return canonical speaker evidence with a timestamped segments array before speaker validation.',
    });
  }
  if (!Array.isArray(speakerEvidence.turns)) {
    blockers.push({
      code: 'SPEAKER_TURNS_INVALID',
      message: 'Speaker evidence turns must be an array.',
      remediation: 'Return canonical speaker evidence with a turns array before speaker validation.',
    });
  }
  if (!Array.isArray(speakerEvidence.overlappingSpeechGroups)) {
    blockers.push({
      code: 'OVERLAP_GROUPS_INVALID',
      message: 'Speaker evidence overlappingSpeechGroups must be an array.',
      remediation: 'Return canonical speaker evidence with an overlappingSpeechGroups array before overlap validation.',
    });
  }
  if (!Array.isArray(speakerEvidence.roleAssignments)) {
    blockers.push({
      code: 'SPEAKER_ROLE_ASSIGNMENTS_INVALID',
      message: 'Speaker evidence roleAssignments must be an array.',
      remediation: 'Return canonical speaker evidence with a roleAssignments array before role validation.',
    });
  }
  if (!Array.isArray(speakerEvidence.corrections)) {
    blockers.push({
      code: 'SPEAKER_CORRECTIONS_INVALID',
      message: 'Speaker evidence corrections must be an array.',
      remediation: 'Return canonical speaker evidence with a corrections array, even when no corrections are present.',
    });
  }
  return blockers;
}

function validateSpeakerEvidenceItems(
  speakerEvidence: SmartCutSpeakerEvidence,
): readonly SmartCutSpeakerEvidenceStructureBlocker[] {
  const blockers: SmartCutSpeakerEvidenceStructureBlocker[] = [];
  for (const profile of speakerEvidence.profiles as readonly unknown[]) {
    if (!isRecord(profile)) {
      blockers.push({
        code: 'SPEAKER_PROFILE_INVALID',
        message: 'Speaker evidence profiles contains a non-object profile item.',
        remediation: 'Return one object for each speaker profile before speaker validation.',
      });
    }
  }
  for (const segment of speakerEvidence.segments as readonly unknown[]) {
    if (!isRecord(segment)) {
      blockers.push({
        code: 'SPEAKER_SEGMENT_INVALID',
        message: 'Speaker evidence segments contains a non-object segment item.',
        remediation: 'Return one timestamped object for each speaker segment before speaker validation.',
      });
    }
  }
  for (const turn of speakerEvidence.turns as readonly unknown[]) {
    if (!isRecord(turn)) {
      blockers.push({
        code: 'SPEAKER_TURN_INVALID',
        message: 'Speaker evidence turns contains a non-object turn item.',
        remediation: 'Return one object for each speaker turn before content-unit construction.',
      });
    }
  }
  for (const group of speakerEvidence.overlappingSpeechGroups as readonly unknown[]) {
    if (!isRecord(group)) {
      blockers.push({
        code: 'OVERLAP_GROUP_INVALID',
        message: 'Speaker evidence overlappingSpeechGroups contains a non-object overlap group item.',
        remediation: 'Return one object for each overlapping speech group before overlap validation.',
      });
    }
  }
  for (const assignment of speakerEvidence.roleAssignments as readonly unknown[]) {
    if (!isRecord(assignment)) {
      blockers.push({
        code: 'SPEAKER_ROLE_ASSIGNMENT_INVALID',
        message: 'Speaker evidence roleAssignments contains a non-object role assignment item.',
        remediation: 'Return one object for each speaker role assignment before role validation.',
      });
    }
  }
  for (const correction of speakerEvidence.corrections as readonly unknown[]) {
    if (!isRecord(correction)) {
      blockers.push({
        code: 'SPEAKER_CORRECTION_INVALID',
        message: 'Speaker evidence corrections contains a non-object correction item.',
        remediation: 'Return one object for each speaker correction before correction replay or audit.',
      });
    }
  }
  return blockers;
}

function validateSpeakerProfiles(
  input: SmartCutSpeakerEvidenceStructureValidationInput,
  blockers: SmartCutSpeakerEvidenceStructureBlocker[],
): Set<string> {
  const profileIds = new Set<string>();
  const duplicateProfileIds = new Set<string>();
  for (const profile of input.speakerEvidence.profiles) {
    const profileId = normalizeId(profile.id);
    if (!profileId) {
      blockers.push({
        code: 'SPEAKER_PROFILE_ID_MISSING',
        message: 'Speaker evidence has a speaker profile without a stable profile id.',
        speakerId: profile.id,
        remediation: 'Assign stable speaker profile ids before semantic slicing.',
      });
    } else if (profileIds.has(profileId)) {
      duplicateProfileIds.add(profileId);
    } else {
      profileIds.add(profileId);
    }

    if (!normalizeText(profile.displayName)) {
      blockers.push({
        code: 'SPEAKER_PROFILE_DISPLAY_NAME_MISSING',
        message: `Speaker profile ${profileId || '<blank>'} has no display name.`,
        speakerId: profile.id,
        remediation: 'Assign every speaker profile a stable display name such as Speaker 1 before review, correction, or semantic slicing.',
      });
    }

    if (!isValidConfidence(profile.confidence)) {
      blockers.push({
        code: 'SPEAKER_PROFILE_CONFIDENCE_INVALID',
        message: `Speaker profile ${profileId || '<blank>'} confidence ${profile.confidence} is invalid.`,
        speakerId: profile.id,
        remediation: 'Return speaker profile confidence in the inclusive 0-1 range.',
      });
    }

    if (!isValidSpeakerRole(profile.role)) {
      blockers.push({
        code: 'SPEAKER_PROFILE_ROLE_INVALID',
        message: `Speaker profile ${profileId || '<blank>'} role ${String(profile.role)} is not a registered speaker role.`,
        speakerId: profile.id,
        remediation: 'Use one of the canonical smart-cut speaker roles before dialogue-aware slicing.',
      });
    }

    if (!isValidSpeakerProfileSource(profile.source)) {
      blockers.push({
        code: 'SPEAKER_PROFILE_SOURCE_INVALID',
        message: `Speaker profile ${profileId || '<blank>'} source ${String(profile.source)} is not supported.`,
        speakerId: profile.id,
        remediation: 'Use a canonical speaker profile source so speaker identity provenance is auditable.',
      });
    }
  }

  for (const duplicateProfileId of duplicateProfileIds) {
    blockers.push({
      code: 'DUPLICATE_SPEAKER_PROFILE_ID',
      message: `Speaker evidence has duplicate speaker profile id ${duplicateProfileId}.`,
      speakerId: duplicateProfileId,
      remediation: 'Use one stable unique speaker profile id for each diarized speaker before alignment, role assignment, or semantic slicing.',
    });
  }

  return profileIds;
}

function validateSpeakerSegments(
  input: SmartCutSpeakerEvidenceStructureValidationInput,
  profileIds: ReadonlySet<string>,
  blockers: SmartCutSpeakerEvidenceStructureBlocker[],
): Set<string> {
  const segmentIds = new Set<string>();
  const duplicateSegmentIds = new Set<string>();

  for (const segment of input.speakerEvidence.segments) {
    const segmentId = normalizeId(segment.id);
    if (!segmentId) {
      blockers.push({
        code: 'SPEAKER_SEGMENT_ID_MISSING',
        message: 'Speaker evidence has a diarization segment without a stable segment id.',
        speakerId: segment.speakerId,
        remediation: 'Preserve stable speaker segment ids so overlapping speech and content-unit evidence can be audited.',
      });
    } else if (segmentIds.has(segmentId)) {
      duplicateSegmentIds.add(segmentId);
    } else {
      segmentIds.add(segmentId);
    }

    const speakerId = normalizeId(segment.speakerId);
    if (!speakerId) {
      blockers.push({
        code: 'SPEAKER_SEGMENT_SPEAKER_ID_MISSING',
        message: `Speaker segment ${segmentId || '<blank>'} has no speaker id.`,
        speakerId: segment.speakerId,
        remediation: 'Assign every speaker segment to a stable speaker profile id.',
      });
    } else if (!profileIds.has(speakerId)) {
      blockers.push({
        code: 'UNKNOWN_SPEAKER_REFERENCE',
        message: `Speaker segment ${segmentId || '<blank>'} references unknown speaker ${speakerId}.`,
        speakerId,
        remediation: 'Create one speaker profile for every diarized speaker id before transcript-speaker alignment.',
      });
    }

    if (!isValidConfidence(segment.confidence)) {
      blockers.push({
        code: 'SPEAKER_SEGMENT_CONFIDENCE_INVALID',
        message: `Speaker segment ${segmentId || '<blank>'} confidence ${segment.confidence} is invalid.`,
        speakerId: segment.speakerId,
        remediation: 'Return speaker segment confidence in the inclusive 0-1 range.',
      });
    }

    if (!isValidRange(segment)) {
      blockers.push({
        code: 'INVALID_SPEAKER_SEGMENT_RANGE',
        message: `Speaker segment ${segmentId || '<blank>'} has invalid range ${segment.startMs}-${segment.endMs}.`,
        speakerId: segment.speakerId,
        remediation: 'Use integer millisecond speaker ranges with positive duration.',
      });
      continue;
    }

    if (segment.startMs < 0 || segment.endMs > input.sourceDurationMs) {
      blockers.push({
        code: 'SPEAKER_SEGMENT_OUT_OF_SOURCE',
        message: `Speaker segment ${segmentId || '<blank>'} is outside source duration ${input.sourceDurationMs}ms.`,
        speakerId: segment.speakerId,
        remediation: 'Repair or discard diarization ranges outside the probed source duration.',
      });
    }
  }

  for (const duplicateSegmentId of duplicateSegmentIds) {
    blockers.push({
      code: 'DUPLICATE_SPEAKER_SEGMENT_ID',
      message: `Speaker evidence has duplicate diarization segment id ${duplicateSegmentId}.`,
      remediation: 'Use one stable unique id for each speaker segment before alignment or overlap validation.',
    });
  }

  return segmentIds;
}

function validateSpeakerTurns(
  input: SmartCutSpeakerEvidenceStructureValidationInput,
  profileIds: ReadonlySet<string>,
  blockers: SmartCutSpeakerEvidenceStructureBlocker[],
) {
  const transcriptSegmentById = new Map(input.transcriptEvidence.segments.map((segment) => [normalizeId(segment.id), segment]));
  const turnIds = new Set<string>();
  const duplicateTurnIds = new Set<string>();

  for (const turn of input.speakerEvidence.turns) {
    const turnId = normalizeId(turn.id);
    if (!turnId) {
      blockers.push({
        code: 'SPEAKER_TURN_ID_MISSING',
        message: 'Speaker evidence has a speaker turn without a stable turn id.',
        speakerId: turn.speakerId,
        remediation: 'Preserve stable speaker turn ids from transcript-speaker alignment before semantic slicing.',
      });
    } else if (turnIds.has(turnId)) {
      duplicateTurnIds.add(turnId);
    } else {
      turnIds.add(turnId);
    }

    const speakerId = normalizeId(turn.speakerId);
    if (!profileIds.has(speakerId)) {
      blockers.push({
        code: 'SPEAKER_TURN_UNKNOWN_SPEAKER',
        message: `Speaker turn ${turnId || '<blank>'} references unknown speaker ${speakerId || '<blank>'}.`,
        speakerId,
        remediation: 'Attach every speaker turn to a declared speaker profile before content-unit construction.',
      });
    }

    if (!isValidRange(turn)) {
      blockers.push({
        code: 'INVALID_SPEAKER_TURN_RANGE',
        message: `Speaker turn ${turnId || '<blank>'} has invalid range ${turn.startMs}-${turn.endMs}.`,
        speakerId: turn.speakerId,
        remediation: 'Use integer millisecond speaker turn ranges with positive duration.',
      });
    }

    if (turn.startMs < 0 || turn.endMs > input.sourceDurationMs) {
      blockers.push({
        code: 'SPEAKER_TURN_OUT_OF_SOURCE',
        message: `Speaker turn ${turnId || '<blank>'} is outside source duration ${input.sourceDurationMs}ms.`,
        speakerId: turn.speakerId,
        remediation: 'Repair speaker turn ranges so every turn is bounded by the probed source duration.',
      });
    }

    if (turn.transcriptSegmentIds.length === 0) {
      blockers.push({
        code: 'SPEAKER_TURN_WITHOUT_TRANSCRIPT_SEGMENTS',
        message: `Speaker turn ${turnId || '<blank>'} has no transcript segment ids.`,
        speakerId: turn.speakerId,
        remediation: 'Attach every speaker turn to one or more transcript segments from the same transcript evidence payload.',
      });
    }

    if (!normalizeText(turn.text)) {
      blockers.push({
        code: 'SPEAKER_TURN_TEXT_MISSING',
        message: `Speaker turn ${turnId || '<blank>'} has no normalized text.`,
        speakerId: turn.speakerId,
        remediation: 'Preserve normalized turn text from the referenced transcript segments before semantic slicing.',
      });
    }

    for (const rawSegmentId of turn.transcriptSegmentIds) {
      const segmentId = normalizeId(rawSegmentId);
      const transcriptSegment = transcriptSegmentById.get(segmentId);
      if (transcriptSegment === undefined) {
        blockers.push({
          code: 'SPEAKER_TURN_UNKNOWN_TRANSCRIPT_SEGMENT',
          message: `Speaker turn ${turnId || '<blank>'} references unknown transcript segment ${segmentId || '<blank>'}.`,
          speakerId: turn.speakerId,
          remediation: 'Reference only transcript segment ids from the same transcript evidence payload.',
        });
        continue;
      }

      if (!hasReliableSpeakerTurnTranscriptOverlap(turn, transcriptSegment)) {
        blockers.push({
          code: 'SPEAKER_TURN_TRANSCRIPT_RANGE_MISMATCH',
          message: `Speaker turn ${turnId || '<blank>'} does not overlap referenced transcript segment ${segmentId}.`,
          speakerId: turn.speakerId,
          segmentId,
          remediation: 'Align speaker turn ranges so they cover the transcript segments they reference.',
        });
      }

      const transcriptSpeakerId = normalizeId(transcriptSegment.speakerId);
      if (transcriptSpeakerId && transcriptSpeakerId !== speakerId) {
        blockers.push({
          code: 'SPEAKER_TURN_SPEAKER_MISMATCH',
          message: `Speaker turn ${turnId || '<blank>'} for ${speakerId || '<blank>'} references transcript segment ${segmentId} owned by ${transcriptSpeakerId}.`,
          speakerId: turn.speakerId,
          segmentId,
          remediation: 'Align speaker turns only to transcript segments owned by the same speaker.',
        });
      }
    }
  }

  for (const duplicateTurnId of duplicateTurnIds) {
    blockers.push({
      code: 'DUPLICATE_SPEAKER_TURN_ID',
      message: `Speaker evidence has duplicate speaker turn id ${duplicateTurnId}.`,
      remediation: 'Use one stable unique id for each speaker turn before content-unit construction.',
    });
  }
}

function validateOverlapGroups(
  input: SmartCutSpeakerEvidenceStructureValidationInput,
  profileIds: ReadonlySet<string>,
  speakerSegmentIds: ReadonlySet<string>,
  blockers: SmartCutSpeakerEvidenceStructureBlocker[],
) {
  const speakerSegmentById = new Map(
    input.speakerEvidence.segments
      .map((segment) => [normalizeId(segment.id), segment] as const)
      .filter(([segmentId]) => Boolean(segmentId)),
  );
  const groupIds = new Set<string>();
  const duplicateGroupIds = new Set<string>();

  for (const group of input.speakerEvidence.overlappingSpeechGroups) {
    const groupId = normalizeId(group.id);
    if (!groupId) {
      blockers.push({
        code: 'OVERLAP_GROUP_ID_MISSING',
        message: 'Speaker evidence has an overlapping speech group without a stable id.',
        remediation: 'Assign stable overlap group ids so multi-speaker interruptions can be audited.',
      });
    } else if (groupIds.has(groupId)) {
      duplicateGroupIds.add(groupId);
    } else {
      groupIds.add(groupId);
    }

    const hasValidRange = isValidRange(group);
    if (!hasValidRange) {
      blockers.push({
        code: 'INVALID_OVERLAP_GROUP_RANGE',
        message: `Overlap group ${groupId || '<blank>'} has invalid range ${group.startMs}-${group.endMs}.`,
        remediation: 'Use integer millisecond overlap group ranges with positive duration.',
      });
    } else if (group.startMs < 0 || group.endMs > input.sourceDurationMs) {
      blockers.push({
        code: 'OVERLAP_GROUP_OUT_OF_SOURCE',
        message: `Overlap group ${groupId || '<blank>'} is outside source duration ${input.sourceDurationMs}ms.`,
        remediation: 'Repair or discard overlapping speech ranges outside the probed source duration.',
      });
    }

    const groupSpeakerIds = group.speakerIds.map(normalizeId);
    const uniqueGroupSpeakerIds = new Set(groupSpeakerIds.filter(Boolean));
    if (uniqueGroupSpeakerIds.size < 2) {
      blockers.push({
        code: 'OVERLAP_GROUP_WITHOUT_MULTIPLE_SPEAKERS',
        message: `Overlap group ${groupId || '<blank>'} does not reference at least two speakers.`,
        remediation: 'Declare overlap groups only for real multi-speaker overlap.',
      });
    }

    for (const speakerId of findDuplicates(groupSpeakerIds)) {
      blockers.push({
        code: 'DUPLICATE_OVERLAP_GROUP_SPEAKER',
        message: `Overlap group ${groupId || '<blank>'} references speaker ${speakerId} more than once.`,
        speakerId,
        remediation: 'Reference each overlapping speaker only once per overlap group.',
      });
    }

    for (const speakerId of groupSpeakerIds) {
      if (!profileIds.has(speakerId)) {
        blockers.push({
          code: 'OVERLAP_GROUP_UNKNOWN_SPEAKER_REFERENCE',
          message: `Overlap group ${groupId || '<blank>'} references unknown speaker ${speakerId || '<blank>'}.`,
          speakerId,
          remediation: 'Use only speaker ids declared in speaker profiles for overlap groups.',
        });
      }
    }

    const groupSegmentIds = group.segmentIds.map(normalizeId);
    const uniqueGroupSegmentIds = new Set(groupSegmentIds.filter(Boolean));
    if (uniqueGroupSegmentIds.size < 2) {
      blockers.push({
        code: 'OVERLAP_GROUP_WITHOUT_SEGMENTS',
        message: `Overlap group ${groupId || '<blank>'} does not reference the overlapping speaker segments.`,
        remediation: 'Reference the stable speaker segment ids that participate in the overlap.',
      });
    }

    for (const segmentId of findDuplicates(groupSegmentIds)) {
      blockers.push({
        code: 'DUPLICATE_OVERLAP_GROUP_SEGMENT',
        message: `Overlap group ${groupId || '<blank>'} references speaker segment ${segmentId} more than once.`,
        segmentId,
        remediation: 'Reference each overlapping speaker segment only once per overlap group.',
      });
    }

    const validParticipants: SmartCutSpeakerEvidence['segments'][number][] = [];
    const participatingSpeakers = new Set<string>();
    for (const segmentId of groupSegmentIds) {
      if (!speakerSegmentIds.has(segmentId)) {
        blockers.push({
          code: 'OVERLAP_GROUP_UNKNOWN_SEGMENT_REFERENCE',
          message: `Overlap group ${groupId || '<blank>'} references unknown speaker segment ${segmentId || '<blank>'}.`,
          segmentId,
          remediation: 'Use only speaker segment ids from the same speaker evidence payload.',
        });
        continue;
      }

      const segment = speakerSegmentById.get(segmentId);
      if (segment === undefined) {
        continue;
      }

      const segmentSpeakerId = normalizeId(segment.speakerId);
      if (!uniqueGroupSpeakerIds.has(segmentSpeakerId)) {
        blockers.push({
          code: 'OVERLAP_GROUP_SEGMENT_SPEAKER_MISMATCH',
          message: `Overlap group ${groupId || '<blank>'} references segment ${segmentId} owned by speaker ${segmentSpeakerId || '<blank>'} outside the group speakers.`,
          segmentId,
          speakerId: segmentSpeakerId,
          remediation: 'Reference only speaker segments whose speaker id is listed in the same overlap group.',
        });
      }

      if (!hasValidRange || getOverlapMs(group, segment) < minimumSpeakerOverlapMs) {
        blockers.push({
          code: 'OVERLAP_GROUP_SEGMENT_RANGE_MISMATCH',
          message: `Overlap group ${groupId || '<blank>'} does not cover referenced speaker segment ${segmentId}.`,
          segmentId,
          speakerId: segment.speakerId,
          remediation: 'Attach only speaker segments that overlap the overlap group range by the minimum reliable overlap threshold.',
        });
        continue;
      }

      if (uniqueGroupSpeakerIds.has(segmentSpeakerId)) {
        validParticipants.push(segment);
        participatingSpeakers.add(segmentSpeakerId);
      }
    }

    for (const speakerId of uniqueGroupSpeakerIds) {
      if (!participatingSpeakers.has(speakerId)) {
        blockers.push({
          code: 'OVERLAP_GROUP_SPEAKER_WITHOUT_SEGMENT',
          message: `Overlap group ${groupId || '<blank>'} lists speaker ${speakerId} without a matching overlapping speaker segment.`,
          speakerId,
          remediation: 'For every overlap group speaker, reference at least one speaker segment from that speaker covering the overlap range.',
        });
      }
    }

    if (hasValidRange && !hasRealMultiSpeakerOverlapInsideGroup(group, validParticipants)) {
      blockers.push({
        code: 'OVERLAP_GROUP_WITHOUT_REAL_OVERLAP',
        message: `Overlap group ${groupId || '<blank>'} does not contain two referenced speaker segments that actually overlap in time.`,
        remediation: 'Declare overlap groups only when at least two different speakers have speaker segments overlapping inside the group range.',
      });
    }
  }

  for (const duplicateGroupId of duplicateGroupIds) {
    blockers.push({
      code: 'DUPLICATE_OVERLAP_GROUP_ID',
      message: `Speaker evidence has duplicate overlap group id ${duplicateGroupId}.`,
      remediation: 'Use one stable unique id for each overlapping speech group before semantic slicing.',
    });
  }
}

function hasRealMultiSpeakerOverlapInsideGroup(
  group: SmartCutTimeRange,
  participants: readonly SmartCutSpeakerEvidence['segments'][number][],
): boolean {
  for (let leftIndex = 0; leftIndex < participants.length; leftIndex += 1) {
    const left = participants[leftIndex];
    if (left === undefined) {
      continue;
    }

    for (let rightIndex = leftIndex + 1; rightIndex < participants.length; rightIndex += 1) {
      const right = participants[rightIndex];
      if (right === undefined || normalizeId(right.speakerId) === normalizeId(left.speakerId)) {
        continue;
      }

      if (getSharedOverlapMs([group, left, right]) >= minimumSpeakerOverlapMs) {
        return true;
      }
    }
  }

  return false;
}

function validateSpeakerRoleAssignments(
  input: SmartCutSpeakerEvidenceStructureValidationInput,
  profileIds: ReadonlySet<string>,
  blockers: SmartCutSpeakerEvidenceStructureBlocker[],
) {
  const profileRoleBySpeakerId = new Map(input.speakerEvidence.profiles.map((profile) => [normalizeId(profile.id), profile.role]));
  const speakerTurnById = new Map(input.speakerEvidence.turns.map((turn) => [normalizeId(turn.id), turn]));
  const assignmentsBySpeakerId = new Map<string, typeof input.speakerEvidence.roleAssignments>();

  for (const assignment of input.speakerEvidence.roleAssignments) {
    const speakerId = normalizeId(assignment.speakerId);
    assignmentsBySpeakerId.set(speakerId, [
      ...(assignmentsBySpeakerId.get(speakerId) ?? []),
      assignment,
    ]);
    const profileRole = profileRoleBySpeakerId.get(speakerId);

    if (!profileIds.has(speakerId)) {
      blockers.push({
        code: 'SPEAKER_ROLE_ASSIGNMENT_UNKNOWN_SPEAKER',
        message: `Speaker role assignment references unknown speaker ${speakerId || '<blank>'}.`,
        speakerId,
        remediation: 'Attach every role assignment to a declared speaker profile before semantic slicing.',
      });
    }

    if (!isValidConfidence(assignment.confidence)) {
      blockers.push({
        code: 'SPEAKER_ROLE_ASSIGNMENT_CONFIDENCE_INVALID',
        message: `Speaker role assignment confidence ${assignment.confidence} is invalid for ${assignment.speakerId}.`,
        speakerId: assignment.speakerId,
        remediation: 'Return role assignment confidence in the inclusive 0-1 range.',
      });
    }

    const roleIsValid = isValidSpeakerRole(assignment.role);
    const sourceIsValid = isValidSpeakerRoleAssignmentSource(assignment.source);
    if (!roleIsValid) {
      blockers.push({
        code: 'SPEAKER_ROLE_ASSIGNMENT_ROLE_INVALID',
        message: `Speaker role assignment for ${assignment.speakerId} has invalid role ${String(assignment.role)}.`,
        speakerId: assignment.speakerId,
        remediation: 'Use one of the canonical smart-cut speaker roles for role assignments.',
      });
    }

    if (!sourceIsValid) {
      blockers.push({
        code: 'SPEAKER_ROLE_ASSIGNMENT_SOURCE_INVALID',
        message: `Speaker role assignment for ${assignment.speakerId} has invalid source ${String(assignment.source)}.`,
        speakerId: assignment.speakerId,
        remediation: 'Use a canonical role assignment source so role evidence provenance is auditable.',
      });
    }

    for (const evidenceTurnId of assignment.evidenceTurnIds) {
      const turn = speakerTurnById.get(normalizeId(evidenceTurnId));
      if (turn === undefined) {
        blockers.push({
          code: 'SPEAKER_ROLE_ASSIGNMENT_UNKNOWN_TURN',
          message: `Speaker role assignment for ${assignment.speakerId} references unknown turn ${evidenceTurnId}.`,
          speakerId: assignment.speakerId,
          remediation: 'Reference only speaker turn ids from the same speaker evidence payload.',
        });
        continue;
      }

      if (normalizeId(turn.speakerId) !== speakerId) {
        blockers.push({
          code: 'SPEAKER_ROLE_ASSIGNMENT_TURN_SPEAKER_MISMATCH',
          message: `Speaker role assignment for ${assignment.speakerId} references turn ${turn.id} owned by ${turn.speakerId}.`,
          speakerId: assignment.speakerId,
          remediation: 'Scope role assignment evidence turns to the same speaker as the assignment.',
        });
      }
    }

    if (!roleIsValid || !isValidSpeakerRole(profileRole) || profileRole === undefined || profileRole === 'unknown' || assignment.role === profileRole) {
      continue;
    }

    blockers.push({
      code: 'SPEAKER_ROLE_ASSIGNMENT_CONFLICT',
      message: `Speaker role assignment ${assignment.role} conflicts with profile role ${profileRole} for ${assignment.speakerId}.`,
      speakerId: assignment.speakerId,
      remediation: 'Resolve speaker profile roles and role assignments to one canonical role before semantic slicing.',
    });
  }

  for (const [speakerId, assignments] of assignmentsBySpeakerId) {
    for (let leftIndex = 0; leftIndex < assignments.length; leftIndex += 1) {
      const left = assignments[leftIndex];
      if (left === undefined) {
        continue;
      }

      for (let rightIndex = leftIndex + 1; rightIndex < assignments.length; rightIndex += 1) {
        const right = assignments[rightIndex];
        if (right === undefined || right.role === left.role || !roleAssignmentScopesOverlap(left.evidenceTurnIds, right.evidenceTurnIds)) {
          continue;
        }

        blockers.push({
          code: 'SPEAKER_ROLE_ASSIGNMENT_AMBIGUOUS',
          message: `Speaker ${speakerId || '<blank>'} has overlapping role assignments ${left.role} and ${right.role}.`,
          speakerId,
          remediation: 'Resolve overlapping role assignments to one canonical speaker role before semantic slicing.',
        });
      }
    }
  }
}

function isValidRange(range: SmartCutTimeRange): boolean {
  return Number.isFinite(range.startMs) &&
    Number.isFinite(range.endMs) &&
    Number.isInteger(range.startMs) &&
    Number.isInteger(range.endMs) &&
    range.endMs > range.startMs;
}

function isValidConfidence(confidence: number): boolean {
  return Number.isFinite(confidence) && confidence >= 0 && confidence <= 1;
}

function isValidSpeakerRole(value: unknown): boolean {
  return typeof value === 'string' && validSpeakerRoles.has(value);
}

function isValidSpeakerProfileSource(value: unknown): boolean {
  return typeof value === 'string' && validSpeakerProfileSources.has(value);
}

function isValidSpeakerRoleAssignmentSource(value: unknown): boolean {
  return typeof value === 'string' && validSpeakerRoleAssignmentSources.has(value);
}

function roleAssignmentScopesOverlap(
  leftTurnIds: readonly string[],
  rightTurnIds: readonly string[],
): boolean {
  if (leftTurnIds.length === 0 || rightTurnIds.length === 0) {
    return true;
  }

  const rightTurnIdSet = new Set(rightTurnIds.map(normalizeId));
  return leftTurnIds.some((turnId) => rightTurnIdSet.has(normalizeId(turnId)));
}

function getOverlapMs(left: SmartCutTimeRange, right: SmartCutTimeRange): number {
  return Math.max(0, Math.min(left.endMs, right.endMs) - Math.max(left.startMs, right.startMs));
}

function hasReliableSpeakerTurnTranscriptOverlap(
  turn: SmartCutTimeRange,
  transcriptSegment: SmartCutTimeRange,
): boolean {
  const overlapMs = getOverlapMs(turn, transcriptSegment);
  if (overlapMs >= minimumSpeakerOverlapMs) {
    return true;
  }

  const shorterDurationMs = Math.min(turn.endMs - turn.startMs, transcriptSegment.endMs - transcriptSegment.startMs);
  if (shorterDurationMs <= 0 || shorterDurationMs >= minimumSpeakerOverlapMs) {
    return false;
  }

  return overlapMs >= Math.ceil(shorterDurationMs * minimumShortSegmentCoverageRatio);
}

function getSharedOverlapMs(ranges: readonly SmartCutTimeRange[]): number {
  const startMs = Math.max(...ranges.map((range) => range.startMs));
  const endMs = Math.min(...ranges.map((range) => range.endMs));
  return Math.max(0, endMs - startMs);
}

function findDuplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (!value) {
      continue;
    }

    if (seen.has(value)) {
      duplicates.add(value);
    } else {
      seen.add(value);
    }
  }
  return [...duplicates];
}

function normalizeId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
