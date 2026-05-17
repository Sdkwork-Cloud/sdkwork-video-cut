import type {
  SmartCutOverlappingSpeechGroup,
  SmartCutSpeakerCorrection,
  SmartCutSpeakerEvidence,
  SmartCutSpeakerProfile,
  SmartCutSpeakerRoleAssignment,
  SmartCutSpeakerSegment,
  SmartCutSpeakerTurn,
} from './speaker.ts';

export interface ApplySmartCutSpeakerCorrectionsInput {
  speakerEvidence: SmartCutSpeakerEvidence;
  corrections: readonly SmartCutSpeakerCorrection[];
}

export function applySmartCutSpeakerCorrections(
  input: ApplySmartCutSpeakerCorrectionsInput,
): SmartCutSpeakerEvidence {
  let evidence = cloneSpeakerEvidence(input.speakerEvidence);
  const appliedCorrections: SmartCutSpeakerCorrection[] = [];

  for (const correction of input.corrections) {
    if (!correctionReferencesKnownSpeaker(evidence, correction)) {
      continue;
    }

    evidence = applySingleSpeakerCorrection(evidence, correction);
    appliedCorrections.push(correction);
  }

  return {
    ...evidence,
    corrections: [...evidence.corrections, ...appliedCorrections],
  };
}

function applySingleSpeakerCorrection(
  evidence: SmartCutSpeakerEvidence,
  correction: SmartCutSpeakerCorrection,
): SmartCutSpeakerEvidence {
  switch (correction.kind) {
    case 'rename':
      return applyRenameCorrection(evidence, correction);
    case 'assign-role':
      return applyAssignRoleCorrection(evidence, correction);
    case 'merge':
      return applyMergeCorrection(evidence, correction);
    case 'reassign-time-range':
      return applyReassignTimeRangeCorrection(evidence, correction);
    case 'split':
      return evidence;
  }
}

function applyRenameCorrection(
  evidence: SmartCutSpeakerEvidence,
  correction: SmartCutSpeakerCorrection,
): SmartCutSpeakerEvidence {
  const replacementDisplayName = correction.replacementDisplayName;
  if (!replacementDisplayName) {
    return evidence;
  }

  const targetSpeakerIds = new Set(correction.speakerIds);
  return {
    ...evidence,
    profiles: evidence.profiles.map((profile) =>
      targetSpeakerIds.has(profile.id)
        ? { ...profile, displayName: replacementDisplayName, source: 'manual' }
        : profile
    ),
  };
}

function applyAssignRoleCorrection(
  evidence: SmartCutSpeakerEvidence,
  correction: SmartCutSpeakerCorrection,
): SmartCutSpeakerEvidence {
  if (correction.replacementRole === undefined) {
    return evidence;
  }

  const replacementRole = correction.replacementRole;
  const targetSpeakerIds = new Set(correction.speakerIds);
  const updatedProfiles: readonly SmartCutSpeakerProfile[] = evidence.profiles.map((profile) =>
    targetSpeakerIds.has(profile.id)
      ? { ...profile, role: replacementRole, source: 'manual' }
      : profile
  );
  const newAssignments: readonly SmartCutSpeakerRoleAssignment[] = correction.speakerIds.map((speakerId) => ({
    speakerId,
    role: replacementRole,
    confidence: 1,
    evidenceTurnIds: evidence.turns
      .filter((turn) => turn.speakerId === speakerId)
      .map((turn) => turn.id),
    source: 'manual',
  } satisfies SmartCutSpeakerRoleAssignment));

  return {
    ...evidence,
    profiles: updatedProfiles,
    roleAssignments: mergeRoleAssignments(evidence.roleAssignments, newAssignments),
  };
}

function applyMergeCorrection(
  evidence: SmartCutSpeakerEvidence,
  correction: SmartCutSpeakerCorrection,
): SmartCutSpeakerEvidence {
  const replacementSpeakerId = correction.replacementSpeakerId ?? correction.speakerIds[0];
  if (replacementSpeakerId === undefined) {
    return evidence;
  }

  const mergeSpeakerIds = new Set(correction.speakerIds);
  const replacementProfile = evidence.profiles.find((profile) => profile.id === replacementSpeakerId);
  if (replacementProfile === undefined) {
    return evidence;
  }

  return {
    ...evidence,
    profiles: evidence.profiles
      .filter((profile) => !mergeSpeakerIds.has(profile.id) || profile.id === replacementSpeakerId)
      .map((profile) => profile.id === replacementSpeakerId ? { ...profile, source: 'manual' } : profile),
    segments: evidence.segments.map((segment) =>
      mergeSpeakerIds.has(segment.speakerId)
        ? { ...segment, speakerId: replacementSpeakerId }
        : segment
    ),
    turns: evidence.turns.map((turn) =>
      mergeSpeakerIds.has(turn.speakerId)
        ? { ...turn, speakerId: replacementSpeakerId }
        : turn
    ),
    overlappingSpeechGroups: evidence.overlappingSpeechGroups.map((group) => ({
      ...group,
      speakerIds: dedupeStrings(group.speakerIds.map((speakerId) =>
        mergeSpeakerIds.has(speakerId) ? replacementSpeakerId : speakerId
      )),
    })),
    roleAssignments: evidence.roleAssignments
      .filter((assignment) => !mergeSpeakerIds.has(assignment.speakerId) || assignment.speakerId === replacementSpeakerId)
      .map((assignment) => assignment.speakerId === replacementSpeakerId ? { ...assignment, source: 'manual' } : assignment),
  };
}

function applyReassignTimeRangeCorrection(
  evidence: SmartCutSpeakerEvidence,
  correction: SmartCutSpeakerCorrection,
): SmartCutSpeakerEvidence {
  if (correction.replacementSpeakerId === undefined || correction.range === undefined) {
    return evidence;
  }

  const correctionRange = correction.range;
  const targetSpeakerIds = new Set(correction.speakerIds);
  const replacementSpeakerId = correction.replacementSpeakerId;

  return {
    ...evidence,
    segments: evidence.segments.map((segment) =>
      targetSpeakerIds.has(segment.speakerId) && rangesOverlap(segment, correctionRange)
        ? { ...segment, speakerId: replacementSpeakerId }
        : segment
    ),
    turns: evidence.turns.map((turn) =>
      targetSpeakerIds.has(turn.speakerId) && rangesOverlap(turn, correctionRange)
        ? { ...turn, speakerId: replacementSpeakerId }
        : turn
    ),
  };
}

function correctionReferencesKnownSpeaker(
  evidence: SmartCutSpeakerEvidence,
  correction: SmartCutSpeakerCorrection,
): boolean {
  const knownSpeakerIds = new Set(evidence.profiles.map((profile) => profile.id));
  const primarySpeakersKnown = correction.speakerIds.every((speakerId) => knownSpeakerIds.has(speakerId));
  const replacementKnown = correction.replacementSpeakerId === undefined || knownSpeakerIds.has(correction.replacementSpeakerId);
  return primarySpeakersKnown && replacementKnown;
}

function cloneSpeakerEvidence(evidence: SmartCutSpeakerEvidence): SmartCutSpeakerEvidence {
  return {
    ...evidence,
    profiles: evidence.profiles.map(cloneSpeakerProfile),
    segments: evidence.segments.map(cloneSpeakerSegment),
    turns: evidence.turns.map(cloneSpeakerTurn),
    overlappingSpeechGroups: evidence.overlappingSpeechGroups.map(cloneOverlappingSpeechGroup),
    roleAssignments: evidence.roleAssignments.map(cloneRoleAssignment),
    corrections: [...evidence.corrections],
  };
}

function cloneSpeakerProfile(profile: SmartCutSpeakerProfile): SmartCutSpeakerProfile {
  return { ...profile };
}

function cloneSpeakerSegment(segment: SmartCutSpeakerSegment): SmartCutSpeakerSegment {
  return { ...segment };
}

function cloneSpeakerTurn(turn: SmartCutSpeakerTurn): SmartCutSpeakerTurn {
  return {
    ...turn,
    sentenceIds: [...turn.sentenceIds],
    transcriptSegmentIds: [...turn.transcriptSegmentIds],
    topicIds: [...turn.topicIds],
    risks: [...turn.risks],
  };
}

function cloneOverlappingSpeechGroup(group: SmartCutOverlappingSpeechGroup): SmartCutOverlappingSpeechGroup {
  return {
    ...group,
    speakerIds: [...group.speakerIds],
    segmentIds: [...group.segmentIds],
  };
}

function cloneRoleAssignment(assignment: SmartCutSpeakerRoleAssignment): SmartCutSpeakerRoleAssignment {
  return {
    ...assignment,
    evidenceTurnIds: [...assignment.evidenceTurnIds],
  };
}

function mergeRoleAssignments(
  existingAssignments: readonly SmartCutSpeakerRoleAssignment[],
  newAssignments: readonly SmartCutSpeakerRoleAssignment[],
): readonly SmartCutSpeakerRoleAssignment[] {
  const bySpeakerAndRole = new Map<string, SmartCutSpeakerRoleAssignment>();
  for (const assignment of existingAssignments) {
    bySpeakerAndRole.set(`${assignment.speakerId}:${assignment.role}`, assignment);
  }
  for (const assignment of newAssignments) {
    bySpeakerAndRole.set(`${assignment.speakerId}:${assignment.role}`, assignment);
  }
  return [...bySpeakerAndRole.values()];
}

function rangesOverlap(
  left: { startMs: number; endMs: number },
  right: { startMs: number; endMs: number },
): boolean {
  return Math.min(left.endMs, right.endMs) > Math.max(left.startMs, right.startMs);
}

function dedupeStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
