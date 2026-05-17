#!/usr/bin/env node

import process from 'node:process';

import {
  SMART_CUT_STANDARD_VERSION,
  validateSmartCutEvidenceQuality,
  validateSmartCutVisualEvidenceQuality,
} from '../packages/sdkwork-autocut-smart-cut-engine/src/index.ts';

const failures = [];
const pass = [];

function assertRule(condition, message) {
  if (condition) {
    pass.push(message);
  } else {
    failures.push(message);
  }
}

function hasBlocker(report, code) {
  return report.blockers.some((blocker) => blocker.code === code);
}

const teacherSourceMedia = {
  id: 'media-teacher',
  uri: 'file:///teacher.mp4',
  mediaKind: 'talking-head',
  durationMs: 90_000,
  width: 1080,
  height: 1920,
  frameRateFps: 30,
};

const teacherTranscriptEvidence = {
  kind: 'transcript',
  schemaVersion: SMART_CUT_STANDARD_VERSION,
  provider: 'fixture-stt',
  language: 'en-US',
  segments: [
    {
      id: 'segment-1',
      startMs: 1_000,
      endMs: 18_000,
      text: 'The first complete idea explains why early planning matters.',
      confidence: 0.96,
      language: 'en-US',
      speakerId: 'speaker-teacher',
    },
    {
      id: 'segment-2',
      startMs: 18_200,
      endMs: 45_000,
      text: 'The payoff is that every activity and recommendation can support one coherent story.',
      confidence: 0.95,
      language: 'en-US',
      speakerId: 'speaker-teacher',
    },
  ],
};

const teacherSpeakerEvidence = {
  kind: 'speaker',
  schemaVersion: SMART_CUT_STANDARD_VERSION,
  profiles: [
    {
      id: 'speaker-teacher',
      displayName: 'Teacher Zhang',
      role: 'teacher',
      confidence: 0.98,
      source: 'diarization',
    },
  ],
  segments: [
    {
      id: 'speaker-segment-teacher',
      speakerId: 'speaker-teacher',
      startMs: 900,
      endMs: 45_200,
      confidence: 0.97,
    },
  ],
  turns: [
    {
      id: 'turn-1',
      speakerId: 'speaker-teacher',
      startMs: 1_000,
      endMs: 45_000,
      sentenceIds: ['sentence-1', 'sentence-2'],
      transcriptSegmentIds: ['segment-1', 'segment-2'],
      text: 'The first complete idea explains why early planning matters. The payoff is that every activity and recommendation can support one coherent story.',
      isQuestion: false,
      isAnswerCandidate: true,
      isInterruption: false,
      isBackchannel: false,
      topicIds: ['topic-planning'],
      risks: [],
    },
  ],
  overlappingSpeechGroups: [],
  roleAssignments: [
    {
      speakerId: 'speaker-teacher',
      role: 'teacher',
      confidence: 0.98,
      evidenceTurnIds: ['turn-1'],
      source: 'rule',
    },
  ],
  corrections: [],
};

const teacherReport = validateSmartCutEvidenceQuality({
  presetId: 'teacher-talking-head-single',
  sourceMedia: teacherSourceMedia,
  transcriptEvidence: teacherTranscriptEvidence,
  speakerEvidence: teacherSpeakerEvidence,
});

assertRule(teacherReport.ready === true, 'teacher evidence quality gate is ready');
assertRule(teacherReport.blockers.length === 0, 'teacher evidence quality gate has no blockers');
assertRule(teacherReport.transcriptReady === true, 'teacher transcript evidence is ready');
assertRule(teacherReport.speakerReady === true, 'teacher speaker evidence is ready');
assertRule(teacherReport.alignmentReady === true, 'teacher transcript-speaker alignment is ready');
assertRule(teacherReport.roleReady === true, 'teacher role evidence is ready');
assertRule(teacherReport.requiredSpeakerRoles.join(',') === 'teacher', 'teacher preset requires teacher speaker role');
assertRule(teacherReport.metrics.transcriptSegmentCount === 2, 'teacher metrics count transcript segments');
assertRule(teacherReport.metrics.speakerCoverageRatio === 1, 'teacher metrics require complete speaker coverage');
assertRule(teacherReport.metrics.averageTranscriptConfidence > 0.9, 'teacher metrics preserve STT confidence');

const shortSegmentReport = validateSmartCutEvidenceQuality({
  presetId: 'teacher-talking-head-single',
  sourceMedia: {
    ...teacherSourceMedia,
    id: 'media-short-segment',
  },
  transcriptEvidence: {
    kind: 'transcript',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    provider: 'fixture-stt',
    language: 'en-US',
    segments: [
      {
        id: 'short-covered-segment',
        startMs: 27_136,
        endMs: 27_276,
        text: 'Seal',
        confidence: 0.94,
        language: 'en-US',
        speakerId: 'speaker-teacher',
      },
    ],
  },
  speakerEvidence: {
    ...teacherSpeakerEvidence,
    segments: [
      {
        id: 'speaker-segment-short-covered',
        speakerId: 'speaker-teacher',
        startMs: 27_136,
        endMs: 27_276,
        confidence: 0.97,
      },
    ],
    turns: [
      {
        id: 'turn-short-covered',
        speakerId: 'speaker-teacher',
        startMs: 27_136,
        endMs: 27_276,
        sentenceIds: ['sentence-short-covered'],
        transcriptSegmentIds: ['short-covered-segment'],
        text: 'Seal',
        isQuestion: false,
        isAnswerCandidate: true,
        isInterruption: false,
        isBackchannel: false,
        topicIds: ['topic-short-fragment'],
        risks: [],
      },
    ],
    roleAssignments: [
      {
        speakerId: 'speaker-teacher',
        role: 'teacher',
        confidence: 0.98,
        evidenceTurnIds: ['turn-short-covered'],
        source: 'rule',
      },
    ],
  },
});

assertRule(shortSegmentReport.ready === true, 'evidence quality accepts fully covered short STT speech fragments');
assertRule(shortSegmentReport.metrics.alignedTranscriptSegmentCount === 1, 'evidence quality counts short fully covered speech as aligned');
assertRule(
  !hasBlocker(shortSegmentReport, 'TRANSCRIPT_SPEAKER_ALIGNMENT_INCOMPLETE') &&
    !hasBlocker(shortSegmentReport, 'SPEAKER_TURN_TRANSCRIPT_RANGE_MISMATCH'),
  'fully covered short STT speech fragments do not create false alignment or turn mismatch blockers',
);

const interviewTranscriptEvidence = {
  kind: 'transcript',
  schemaVersion: SMART_CUT_STANDARD_VERSION,
  provider: 'fixture-stt',
  language: 'en-US',
  segments: [
    {
      id: 'question',
      startMs: 2_000,
      endMs: 9_000,
      text: 'When should families start planning?',
      confidence: 0.96,
      language: 'en-US',
      speakerId: 'speaker-host',
    },
    {
      id: 'answer',
      startMs: 9_300,
      endMs: 72_000,
      text: 'They should start early enough to connect course choices, activities, recommendations, and essays into one credible story.',
      confidence: 0.97,
      language: 'en-US',
      speakerId: 'speaker-guest',
    },
  ],
};

const interviewSpeakerEvidence = {
  kind: 'speaker',
  schemaVersion: SMART_CUT_STANDARD_VERSION,
  profiles: [
    {
      id: 'speaker-host',
      displayName: 'Host',
      role: 'interviewer',
      confidence: 0.96,
      source: 'diarization',
    },
    {
      id: 'speaker-guest',
      displayName: 'Guest',
      role: 'guest',
      confidence: 0.97,
      source: 'diarization',
    },
  ],
  segments: [
    { id: 'speaker-segment-host', speakerId: 'speaker-host', startMs: 2_000, endMs: 9_000, confidence: 0.96 },
    { id: 'speaker-segment-guest', speakerId: 'speaker-guest', startMs: 9_300, endMs: 72_000, confidence: 0.97 },
  ],
  turns: [
    {
      id: 'turn-question',
      speakerId: 'speaker-host',
      startMs: 2_000,
      endMs: 9_000,
      sentenceIds: ['sentence-question'],
      transcriptSegmentIds: ['question'],
      text: 'When should families start planning?',
      isQuestion: true,
      isAnswerCandidate: false,
      isInterruption: false,
      isBackchannel: false,
      topicIds: ['topic-planning'],
      risks: [],
    },
    {
      id: 'turn-answer',
      speakerId: 'speaker-guest',
      startMs: 9_300,
      endMs: 72_000,
      sentenceIds: ['sentence-answer'],
      transcriptSegmentIds: ['answer'],
      text: 'They should start early enough to connect course choices, activities, recommendations, and essays into one credible story.',
      isQuestion: false,
      isAnswerCandidate: true,
      isInterruption: false,
      isBackchannel: false,
      topicIds: ['topic-planning'],
      risks: [],
    },
  ],
  overlappingSpeechGroups: [],
  roleAssignments: [
    {
      speakerId: 'speaker-host',
      role: 'interviewer',
      confidence: 0.96,
      evidenceTurnIds: ['turn-question'],
      source: 'rule',
    },
    {
      speakerId: 'speaker-guest',
      role: 'guest',
      confidence: 0.97,
      evidenceTurnIds: ['turn-answer'],
      source: 'rule',
    },
  ],
  corrections: [],
};

const interviewReport = validateSmartCutEvidenceQuality({
  presetId: 'interview-one-question-one-answer',
  sourceMedia: {
    id: 'media-interview',
    uri: 'file:///interview.mp4',
    mediaKind: 'interview',
    durationMs: 180_000,
  },
  transcriptEvidence: interviewTranscriptEvidence,
  speakerEvidence: interviewSpeakerEvidence,
});

assertRule(interviewReport.ready === true, 'interview evidence quality gate is ready');
assertRule(interviewReport.requiredSpeakerRoles.join(',') === 'interviewer,guest', 'interview preset requires interviewer and guest roles');
assertRule(interviewReport.metrics.distinctSpeakerCount === 2, 'interview metrics preserve multi-speaker count');
assertRule(interviewReport.metrics.alignedTranscriptSegmentCount === 2, 'interview metrics count aligned transcript segments');

const missingSpeakerReport = validateSmartCutEvidenceQuality({
  presetId: 'interview-one-question-one-answer',
  sourceMedia: {
    id: 'media-missing-speaker',
    uri: 'file:///interview.mp4',
    mediaKind: 'interview',
    durationMs: 180_000,
  },
  transcriptEvidence: interviewTranscriptEvidence,
  speakerEvidence: {
    ...interviewSpeakerEvidence,
    profiles: [],
    segments: [],
    turns: [],
    roleAssignments: [],
  },
});

assertRule(missingSpeakerReport.ready === false, 'missing speaker diarization fails evidence gate');
assertRule(hasBlocker(missingSpeakerReport, 'MISSING_SPEAKER_DIARIZATION'), 'missing speaker diarization reports blocker');

const unalignedReport = validateSmartCutEvidenceQuality({
  presetId: 'interview-one-question-one-answer',
  sourceMedia: {
    id: 'media-unaligned',
    uri: 'file:///interview.mp4',
    mediaKind: 'interview',
    durationMs: 180_000,
  },
  transcriptEvidence: {
    ...interviewTranscriptEvidence,
    segments: [
      {
        id: 'unaligned',
        startMs: 80_000,
        endMs: 90_000,
        text: 'This segment has no speaker overlap.',
        confidence: 0.95,
        language: 'en-US',
      },
    ],
  },
  speakerEvidence: interviewSpeakerEvidence,
});

assertRule(unalignedReport.ready === false, 'unaligned transcript fails evidence gate');
assertRule(hasBlocker(unalignedReport, 'TRANSCRIPT_SPEAKER_ALIGNMENT_INCOMPLETE'), 'unaligned transcript reports alignment blocker');

const missingRoleReport = validateSmartCutEvidenceQuality({
  presetId: 'interview-one-question-one-answer',
  sourceMedia: {
    id: 'media-missing-role',
    uri: 'file:///interview.mp4',
    mediaKind: 'interview',
    durationMs: 180_000,
  },
  transcriptEvidence: interviewTranscriptEvidence,
  speakerEvidence: {
    ...interviewSpeakerEvidence,
    profiles: interviewSpeakerEvidence.profiles.map((profile) => ({ ...profile, role: 'unknown' })),
    roleAssignments: [],
  },
});

assertRule(missingRoleReport.ready === false, 'missing interview roles fail evidence gate');
assertRule(hasBlocker(missingRoleReport, 'REQUIRED_SPEAKER_ROLE_MISSING'), 'missing interview roles report role blocker');

const outOfSourceReport = validateSmartCutEvidenceQuality({
  presetId: 'teacher-talking-head-single',
  sourceMedia: teacherSourceMedia,
  transcriptEvidence: {
    ...teacherTranscriptEvidence,
    segments: [
      {
        id: 'segment-out',
        startMs: 89_000,
        endMs: 95_000,
        text: 'This timestamp exceeds the media duration.',
        confidence: 0.94,
        language: 'en-US',
        speakerId: 'speaker-teacher',
      },
    ],
  },
  speakerEvidence: teacherSpeakerEvidence,
});

assertRule(outOfSourceReport.ready === false, 'out-of-source transcript fails evidence gate');
assertRule(hasBlocker(outOfSourceReport, 'TRANSCRIPT_SEGMENT_OUT_OF_SOURCE'), 'out-of-source transcript reports blocker');

const lowConfidenceReport = validateSmartCutEvidenceQuality({
  presetId: 'teacher-talking-head-single',
  sourceMedia: teacherSourceMedia,
  transcriptEvidence: {
    ...teacherTranscriptEvidence,
    segments: [
      {
        id: 'segment-low-confidence',
        startMs: 1_000,
        endMs: 12_000,
        text: 'This transcript is too uncertain for semantic slicing.',
        confidence: 0.31,
        language: 'en-US',
        speakerId: 'speaker-teacher',
      },
    ],
  },
  speakerEvidence: teacherSpeakerEvidence,
});

assertRule(lowConfidenceReport.ready === false, 'low STT confidence fails evidence gate');
assertRule(hasBlocker(lowConfidenceReport, 'LOW_TRANSCRIPT_CONFIDENCE'), 'low STT confidence reports blocker');

const malformedTranscriptShapeReport = validateSmartCutEvidenceQuality({
  presetId: 'teacher-talking-head-single',
  sourceMedia: teacherSourceMedia,
  transcriptEvidence: {
    ...teacherTranscriptEvidence,
    segments: [
      {
        id: ' ',
        startMs: 1_000,
        endMs: 12_000,
        text: ' ',
        confidence: 1.2,
        language: 'en-US',
        speakerId: 'speaker-teacher',
      },
      {
        id: 'transcript-dup',
        startMs: 12_300,
        endMs: 20_000,
        text: 'A valid transcript segment keeps traceability.',
        confidence: 0.95,
        language: 'en-US',
        speakerId: 'speaker-teacher',
      },
      {
        id: 'transcript-dup',
        startMs: 20_200,
        endMs: 31_000,
        text: 'A duplicate transcript id makes content-unit evidence ambiguous.',
        confidence: 0.94,
        language: 'en-US',
        speakerId: 'speaker-teacher',
      },
    ],
  },
  speakerEvidence: teacherSpeakerEvidence,
});

assertRule(malformedTranscriptShapeReport.ready === false, 'malformed transcript segment shape fails evidence gate');
assertRule(hasBlocker(malformedTranscriptShapeReport, 'TRANSCRIPT_SEGMENT_ID_MISSING'), 'missing transcript segment id reports blocker');
assertRule(hasBlocker(malformedTranscriptShapeReport, 'DUPLICATE_TRANSCRIPT_SEGMENT_ID'), 'duplicate transcript segment id reports blocker');
assertRule(hasBlocker(malformedTranscriptShapeReport, 'TRANSCRIPT_SEGMENT_TEXT_MISSING'), 'missing transcript segment text reports blocker');
assertRule(hasBlocker(malformedTranscriptShapeReport, 'TRANSCRIPT_SEGMENT_CONFIDENCE_INVALID'), 'invalid transcript segment confidence reports blocker');

let malformedEvidencePayloadReport;
let malformedEvidencePayloadException;
try {
  malformedEvidencePayloadReport = validateSmartCutEvidenceQuality({
    presetId: 'teacher-talking-head-single',
    sourceMedia: teacherSourceMedia,
    transcriptEvidence: undefined,
    speakerEvidence: undefined,
  });
} catch (error) {
  malformedEvidencePayloadException = error;
}

assertRule(malformedEvidencePayloadException === undefined, 'direct evidence quality gate does not throw on malformed evidence payloads');
assertRule(malformedEvidencePayloadReport?.ready === false, 'direct evidence quality gate fails closed on malformed evidence payloads');
assertRule(hasBlocker(malformedEvidencePayloadReport ?? { blockers: [] }, 'TRANSCRIPT_EVIDENCE_INVALID'), 'direct evidence quality reports malformed transcript evidence payload');
assertRule(hasBlocker(malformedEvidencePayloadReport ?? { blockers: [] }, 'SPEAKER_EVIDENCE_INVALID'), 'direct evidence quality reports malformed speaker evidence payload');

let malformedEvidenceContainerReport;
let malformedEvidenceContainerException;
try {
  malformedEvidenceContainerReport = validateSmartCutEvidenceQuality({
    presetId: 'teacher-talking-head-single',
    sourceMedia: teacherSourceMedia,
    transcriptEvidence: {
      ...teacherTranscriptEvidence,
      segments: undefined,
    },
    speakerEvidence: {
      ...teacherSpeakerEvidence,
      profiles: undefined,
      segments: undefined,
      turns: undefined,
      overlappingSpeechGroups: undefined,
      roleAssignments: undefined,
      corrections: undefined,
    },
  });
} catch (error) {
  malformedEvidenceContainerException = error;
}

assertRule(malformedEvidenceContainerException === undefined, 'direct evidence quality gate does not throw on malformed evidence containers');
assertRule(malformedEvidenceContainerReport?.ready === false, 'direct evidence quality gate fails closed on malformed evidence containers');
assertRule(hasBlocker(malformedEvidenceContainerReport ?? { blockers: [] }, 'TRANSCRIPT_SEGMENTS_INVALID'), 'direct evidence quality reports malformed transcript segments container');
assertRule(hasBlocker(malformedEvidenceContainerReport ?? { blockers: [] }, 'SPEAKER_PROFILES_INVALID'), 'direct evidence quality reports malformed speaker profiles container');
assertRule(hasBlocker(malformedEvidenceContainerReport ?? { blockers: [] }, 'SPEAKER_SEGMENTS_INVALID'), 'direct evidence quality reports malformed speaker segments container');
assertRule(hasBlocker(malformedEvidenceContainerReport ?? { blockers: [] }, 'SPEAKER_TURNS_INVALID'), 'direct evidence quality reports malformed speaker turns container');
assertRule(hasBlocker(malformedEvidenceContainerReport ?? { blockers: [] }, 'OVERLAP_GROUPS_INVALID'), 'direct evidence quality reports malformed overlap groups container');
assertRule(hasBlocker(malformedEvidenceContainerReport ?? { blockers: [] }, 'SPEAKER_ROLE_ASSIGNMENTS_INVALID'), 'direct evidence quality reports malformed role assignments container');
assertRule(hasBlocker(malformedEvidenceContainerReport ?? { blockers: [] }, 'SPEAKER_CORRECTIONS_INVALID'), 'direct evidence quality reports malformed speaker corrections container');

let partialMalformedSpeakerContainerReport;
let partialMalformedSpeakerContainerException;
try {
  partialMalformedSpeakerContainerReport = validateSmartCutEvidenceQuality({
    presetId: 'meeting-minutes-highlights',
    sourceMedia: teacherSourceMedia,
    transcriptEvidence: teacherTranscriptEvidence,
    speakerEvidence: {
      ...teacherSpeakerEvidence,
      profiles: [
        { id: 'speaker-teacher', displayName: 'Teacher', role: 'speaker', confidence: 0.98, source: 'diarization' },
        { id: 'speaker-guest', displayName: 'Guest', role: 'speaker', confidence: 0.95, source: 'diarization' },
      ],
      segments: [
        { id: 'speaker-segment-teacher-overlap', speakerId: 'speaker-teacher', startMs: 1_000, endMs: 25_000, confidence: 0.98 },
        { id: 'speaker-segment-guest-overlap', speakerId: 'speaker-guest', startMs: 5_000, endMs: 15_000, confidence: 0.95 },
      ],
      overlappingSpeechGroups: undefined,
      roleAssignments: [],
      corrections: [],
    },
  });
} catch (error) {
  partialMalformedSpeakerContainerException = error;
}

assertRule(partialMalformedSpeakerContainerException === undefined, 'direct evidence quality gate does not throw when overlap groups container is malformed but speaker segments are present');
assertRule(partialMalformedSpeakerContainerReport?.ready === false, 'direct evidence quality gate fails closed on partial malformed speaker evidence containers');
assertRule(hasBlocker(partialMalformedSpeakerContainerReport ?? { blockers: [] }, 'OVERLAP_GROUPS_INVALID'), 'direct evidence quality reports malformed overlap groups container before overlap validation');

let malformedEvidenceItemReport;
let malformedEvidenceItemException;
try {
  malformedEvidenceItemReport = validateSmartCutEvidenceQuality({
    presetId: 'teacher-talking-head-single',
    sourceMedia: teacherSourceMedia,
    transcriptEvidence: {
      ...teacherTranscriptEvidence,
      segments: [undefined],
    },
    speakerEvidence: {
      ...teacherSpeakerEvidence,
      profiles: [undefined],
      segments: [undefined],
      turns: [undefined],
      overlappingSpeechGroups: [undefined],
      roleAssignments: [undefined],
      corrections: [undefined],
    },
  });
} catch (error) {
  malformedEvidenceItemException = error;
}

assertRule(malformedEvidenceItemException === undefined, 'direct evidence quality gate does not throw on malformed evidence items');
assertRule(malformedEvidenceItemReport?.ready === false, 'direct evidence quality gate fails closed on malformed evidence items');
assertRule(hasBlocker(malformedEvidenceItemReport ?? { blockers: [] }, 'TRANSCRIPT_SEGMENT_INVALID'), 'direct evidence quality reports malformed transcript segment item');
assertRule(hasBlocker(malformedEvidenceItemReport ?? { blockers: [] }, 'SPEAKER_PROFILE_INVALID'), 'direct evidence quality reports malformed speaker profile item');
assertRule(hasBlocker(malformedEvidenceItemReport ?? { blockers: [] }, 'SPEAKER_SEGMENT_INVALID'), 'direct evidence quality reports malformed speaker segment item');
assertRule(hasBlocker(malformedEvidenceItemReport ?? { blockers: [] }, 'SPEAKER_TURN_INVALID'), 'direct evidence quality reports malformed speaker turn item');
assertRule(hasBlocker(malformedEvidenceItemReport ?? { blockers: [] }, 'OVERLAP_GROUP_INVALID'), 'direct evidence quality reports malformed overlap group item');
assertRule(hasBlocker(malformedEvidenceItemReport ?? { blockers: [] }, 'SPEAKER_ROLE_ASSIGNMENT_INVALID'), 'direct evidence quality reports malformed role assignment item');
assertRule(hasBlocker(malformedEvidenceItemReport ?? { blockers: [] }, 'SPEAKER_CORRECTION_INVALID'), 'direct evidence quality reports malformed speaker correction item');

const malformedSpeakerSegmentIdentityReport = validateSmartCutEvidenceQuality({
  presetId: 'meeting-minutes-highlights',
  sourceMedia: {
    id: 'media-malformed-speaker-segment-identity',
    uri: 'file:///meeting.mp4',
    mediaKind: 'meeting',
    durationMs: 120_000,
  },
  transcriptEvidence: {
    kind: 'transcript',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    provider: 'fixture-stt',
    language: 'en-US',
    segments: [
      {
        id: 'malformed-segment',
        startMs: 5_000,
        endMs: 20_000,
        text: 'Two people overlap and the segment identity evidence must be auditable.',
        confidence: 0.92,
        language: 'en-US',
        speakerId: 'speaker-a',
      },
    ],
  },
  speakerEvidence: {
    kind: 'speaker',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    profiles: [
      { id: 'speaker-a', displayName: 'Speaker A', role: 'speaker', confidence: 0.9, source: 'diarization' },
      { id: 'speaker-b', displayName: 'Speaker B', role: 'speaker', confidence: 0.9, source: 'diarization' },
    ],
    segments: [
      { id: ' ', speakerId: 'speaker-a', startMs: 5_000, endMs: 20_000, confidence: 0.9 },
      { id: 'speaker-segment-dup', speakerId: 'speaker-b', startMs: 8_000, endMs: 18_000, confidence: 0.88 },
      { id: 'speaker-segment-dup', speakerId: 'speaker-a', startMs: 21_000, endMs: 24_000, confidence: 0.88 },
    ],
    turns: [],
    overlappingSpeechGroups: [
      {
        id: 'overlap-broken',
        speakerIds: ['speaker-a', 'speaker-missing'],
        segmentIds: ['speaker-segment-dup', 'speaker-segment-missing'],
        startMs: 8_000,
        endMs: 18_000,
        severity: 'medium',
      },
    ],
    roleAssignments: [],
    corrections: [],
  },
});

assertRule(malformedSpeakerSegmentIdentityReport.ready === false, 'malformed speaker segment identities fail evidence quality gate');
assertRule(hasBlocker(malformedSpeakerSegmentIdentityReport, 'SPEAKER_SEGMENT_ID_MISSING'), 'missing speaker segment id reports blocker');
assertRule(hasBlocker(malformedSpeakerSegmentIdentityReport, 'DUPLICATE_SPEAKER_SEGMENT_ID'), 'duplicate speaker segment id reports blocker');
assertRule(hasBlocker(malformedSpeakerSegmentIdentityReport, 'OVERLAP_GROUP_UNKNOWN_SPEAKER_REFERENCE'), 'overlap group unknown speaker reports blocker');
assertRule(hasBlocker(malformedSpeakerSegmentIdentityReport, 'OVERLAP_GROUP_UNKNOWN_SEGMENT_REFERENCE'), 'overlap group unknown segment reports blocker');

const malformedOverlapGroupStructureReport = validateSmartCutEvidenceQuality({
  presetId: 'meeting-minutes-highlights',
  sourceMedia: {
    id: 'media-malformed-overlap-structure',
    uri: 'file:///meeting.mp4',
    mediaKind: 'meeting',
    durationMs: 90_000,
  },
  transcriptEvidence: {
    kind: 'transcript',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    provider: 'fixture-stt',
    language: 'en-US',
    segments: [
      {
        id: 'overlap-transcript-a',
        startMs: 10_000,
        endMs: 20_000,
        text: 'Speaker A presents the decision context.',
        confidence: 0.94,
        language: 'en-US',
        speakerId: 'speaker-a',
      },
      {
        id: 'overlap-transcript-b',
        startMs: 10_500,
        endMs: 19_500,
        text: 'Speaker B interrupts with a competing clarification.',
        confidence: 0.93,
        language: 'en-US',
        speakerId: 'speaker-b',
      },
    ],
  },
  speakerEvidence: {
    kind: 'speaker',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    profiles: [
      { id: 'speaker-a', displayName: 'Speaker A', role: 'speaker', confidence: 0.95, source: 'diarization' },
      { id: 'speaker-b', displayName: 'Speaker B', role: 'speaker', confidence: 0.94, source: 'diarization' },
      { id: 'speaker-c', displayName: 'Speaker C', role: 'speaker', confidence: 0.92, source: 'diarization' },
    ],
    segments: [
      { id: 'segment-a-main', speakerId: 'speaker-a', startMs: 10_000, endMs: 20_000, confidence: 0.95 },
      { id: 'segment-b-main', speakerId: 'speaker-b', startMs: 10_500, endMs: 19_500, confidence: 0.94 },
      { id: 'segment-c-late', speakerId: 'speaker-c', startMs: 40_000, endMs: 50_000, confidence: 0.92 },
      { id: 'segment-a-early', speakerId: 'speaker-a', startMs: 60_000, endMs: 64_000, confidence: 0.93 },
      { id: 'segment-b-late', speakerId: 'speaker-b', startMs: 66_000, endMs: 70_000, confidence: 0.93 },
    ],
    turns: [],
    overlappingSpeechGroups: [
      {
        id: 'overlap-dup',
        speakerIds: ['speaker-a', 'speaker-b'],
        segmentIds: ['segment-a-main', 'segment-b-main'],
        startMs: 10_500,
        endMs: 19_500,
        severity: 'high',
      },
      {
        id: 'overlap-dup',
        speakerIds: ['speaker-a', 'speaker-b'],
        segmentIds: ['segment-a-main', 'segment-b-main'],
        startMs: 10_500,
        endMs: 19_500,
        severity: 'high',
      },
      {
        id: 'overlap-out-of-source',
        speakerIds: ['speaker-a', 'speaker-b'],
        segmentIds: ['segment-a-main', 'segment-b-main'],
        startMs: 88_000,
        endMs: 91_000,
        severity: 'medium',
      },
      {
        id: 'overlap-duplicate-members',
        speakerIds: ['speaker-a', 'speaker-a'],
        segmentIds: ['segment-a-main', 'segment-a-main'],
        startMs: 10_500,
        endMs: 19_500,
        severity: 'medium',
      },
      {
        id: 'overlap-segment-outside-group',
        speakerIds: ['speaker-a', 'speaker-c'],
        segmentIds: ['segment-a-main', 'segment-c-late'],
        startMs: 10_000,
        endMs: 20_000,
        severity: 'medium',
      },
      {
        id: 'overlap-speaker-mismatch',
        speakerIds: ['speaker-a', 'speaker-b'],
        segmentIds: ['segment-a-main', 'segment-c-late'],
        startMs: 10_000,
        endMs: 20_000,
        severity: 'medium',
      },
      {
        id: 'overlap-no-real-overlap',
        speakerIds: ['speaker-a', 'speaker-b'],
        segmentIds: ['segment-a-early', 'segment-b-late'],
        startMs: 60_000,
        endMs: 70_000,
        severity: 'low',
      },
    ],
    roleAssignments: [],
    corrections: [],
  },
});

assertRule(malformedOverlapGroupStructureReport.ready === false, 'malformed overlap group structure fails evidence quality gate');
assertRule(hasBlocker(malformedOverlapGroupStructureReport, 'DUPLICATE_OVERLAP_GROUP_ID'), 'duplicate overlap group id reports blocker');
assertRule(hasBlocker(malformedOverlapGroupStructureReport, 'OVERLAP_GROUP_OUT_OF_SOURCE'), 'overlap group outside source reports blocker');
assertRule(hasBlocker(malformedOverlapGroupStructureReport, 'DUPLICATE_OVERLAP_GROUP_SPEAKER'), 'duplicate overlap group speaker reports blocker');
assertRule(hasBlocker(malformedOverlapGroupStructureReport, 'DUPLICATE_OVERLAP_GROUP_SEGMENT'), 'duplicate overlap group segment reports blocker');
assertRule(hasBlocker(malformedOverlapGroupStructureReport, 'OVERLAP_GROUP_SEGMENT_RANGE_MISMATCH'), 'overlap group segment range mismatch reports blocker');
assertRule(hasBlocker(malformedOverlapGroupStructureReport, 'OVERLAP_GROUP_SEGMENT_SPEAKER_MISMATCH'), 'overlap group segment speaker mismatch reports blocker');
assertRule(hasBlocker(malformedOverlapGroupStructureReport, 'OVERLAP_GROUP_SPEAKER_WITHOUT_SEGMENT'), 'overlap group speaker without segment reports blocker');
assertRule(hasBlocker(malformedOverlapGroupStructureReport, 'OVERLAP_GROUP_WITHOUT_REAL_OVERLAP'), 'overlap group without real segment overlap reports blocker');

const malformedSpeakerProfileAndSegmentReport = validateSmartCutEvidenceQuality({
  presetId: 'teacher-talking-head-single',
  sourceMedia: teacherSourceMedia,
  transcriptEvidence: teacherTranscriptEvidence,
  speakerEvidence: {
    ...teacherSpeakerEvidence,
    profiles: [
      {
        id: ' ',
        displayName: 'Malformed Profile',
        role: 'teacher',
        confidence: 1.4,
        source: 'diarization',
      },
    ],
    segments: [
      {
        id: 'speaker-segment-malformed-profile',
        speakerId: ' ',
        startMs: 900,
        endMs: 45_200,
        confidence: -0.2,
      },
    ],
    turns: [],
    roleAssignments: [],
  },
});

assertRule(malformedSpeakerProfileAndSegmentReport.ready === false, 'malformed speaker profile and segment shape fails evidence quality gate');
assertRule(hasBlocker(malformedSpeakerProfileAndSegmentReport, 'SPEAKER_PROFILE_ID_MISSING'), 'missing speaker profile id reports blocker');
assertRule(hasBlocker(malformedSpeakerProfileAndSegmentReport, 'SPEAKER_PROFILE_CONFIDENCE_INVALID'), 'invalid speaker profile confidence reports blocker');
assertRule(hasBlocker(malformedSpeakerProfileAndSegmentReport, 'SPEAKER_SEGMENT_SPEAKER_ID_MISSING'), 'missing speaker segment speaker id reports blocker');
assertRule(hasBlocker(malformedSpeakerProfileAndSegmentReport, 'SPEAKER_SEGMENT_CONFIDENCE_INVALID'), 'invalid speaker segment confidence reports blocker');

const duplicateSpeakerProfileReport = validateSmartCutEvidenceQuality({
  presetId: 'teacher-talking-head-single',
  sourceMedia: teacherSourceMedia,
  transcriptEvidence: teacherTranscriptEvidence,
  speakerEvidence: {
    ...teacherSpeakerEvidence,
    profiles: [
      {
        id: 'speaker-teacher',
        displayName: 'Teacher Zhang',
        role: 'teacher',
        confidence: 0.98,
        source: 'diarization',
      },
      {
        id: 'speaker-teacher',
        displayName: 'Teacher Zhang Duplicate',
        role: 'teacher',
        confidence: 0.97,
        source: 'diarization',
      },
    ],
  },
});

assertRule(duplicateSpeakerProfileReport.ready === false, 'duplicate speaker profile ids fail evidence quality gate');
assertRule(hasBlocker(duplicateSpeakerProfileReport, 'DUPLICATE_SPEAKER_PROFILE_ID'), 'duplicate speaker profile id reports blocker');

const malformedSpeakerProfileMetadataReport = validateSmartCutEvidenceQuality({
  presetId: 'teacher-talking-head-single',
  sourceMedia: teacherSourceMedia,
  transcriptEvidence: teacherTranscriptEvidence,
  speakerEvidence: {
    ...teacherSpeakerEvidence,
    profiles: [
      {
        id: 'speaker-teacher',
        displayName: ' ',
        role: 'lecturer',
        confidence: 0.98,
        source: 'external-provider',
      },
    ],
    roleAssignments: [],
  },
});

assertRule(malformedSpeakerProfileMetadataReport.ready === false, 'malformed speaker profile metadata fails evidence quality gate');
assertRule(hasBlocker(malformedSpeakerProfileMetadataReport, 'SPEAKER_PROFILE_DISPLAY_NAME_MISSING'), 'missing speaker profile display name reports blocker');
assertRule(hasBlocker(malformedSpeakerProfileMetadataReport, 'SPEAKER_PROFILE_ROLE_INVALID'), 'invalid speaker profile role reports blocker');
assertRule(hasBlocker(malformedSpeakerProfileMetadataReport, 'SPEAKER_PROFILE_SOURCE_INVALID'), 'invalid speaker profile source reports blocker');

const conflictingSpeakerRoleReport = validateSmartCutEvidenceQuality({
  presetId: 'teacher-talking-head-single',
  sourceMedia: teacherSourceMedia,
  transcriptEvidence: teacherTranscriptEvidence,
  speakerEvidence: {
    ...teacherSpeakerEvidence,
    roleAssignments: [
      {
        speakerId: 'speaker-teacher',
        role: 'guest',
        confidence: 0.98,
        evidenceTurnIds: ['turn-1'],
        source: 'manual',
      },
    ],
  },
});

assertRule(conflictingSpeakerRoleReport.ready === false, 'speaker role assignment conflicting with profile role fails evidence gate');
assertRule(hasBlocker(conflictingSpeakerRoleReport, 'SPEAKER_ROLE_ASSIGNMENT_CONFLICT'), 'speaker role assignment conflict reports blocker');

const malformedRoleAssignmentReport = validateSmartCutEvidenceQuality({
  presetId: 'teacher-talking-head-single',
  sourceMedia: teacherSourceMedia,
  transcriptEvidence: teacherTranscriptEvidence,
  speakerEvidence: {
    ...teacherSpeakerEvidence,
    roleAssignments: [
      {
        speakerId: 'speaker-missing',
        role: 'teacher',
        confidence: 1.2,
        evidenceTurnIds: ['turn-1', 'turn-missing'],
        source: 'manual',
      },
      {
        speakerId: 'speaker-teacher',
        role: 'guest',
        confidence: 0.92,
        evidenceTurnIds: [],
        source: 'llm-role-inference',
      },
      {
        speakerId: 'speaker-teacher',
        role: 'lecturer',
        confidence: 0.91,
        evidenceTurnIds: ['turn-1'],
        source: 'external-provider',
      },
    ],
  },
});

assertRule(malformedRoleAssignmentReport.ready === false, 'malformed speaker role assignments fail evidence gate');
assertRule(hasBlocker(malformedRoleAssignmentReport, 'SPEAKER_ROLE_ASSIGNMENT_UNKNOWN_SPEAKER'), 'speaker role assignment unknown speaker reports blocker');
assertRule(hasBlocker(malformedRoleAssignmentReport, 'SPEAKER_ROLE_ASSIGNMENT_CONFIDENCE_INVALID'), 'speaker role assignment invalid confidence reports blocker');
assertRule(hasBlocker(malformedRoleAssignmentReport, 'SPEAKER_ROLE_ASSIGNMENT_UNKNOWN_TURN'), 'speaker role assignment unknown turn reports blocker');
assertRule(hasBlocker(malformedRoleAssignmentReport, 'SPEAKER_ROLE_ASSIGNMENT_TURN_SPEAKER_MISMATCH'), 'speaker role assignment turn speaker mismatch reports blocker');
assertRule(hasBlocker(malformedRoleAssignmentReport, 'SPEAKER_ROLE_ASSIGNMENT_ROLE_INVALID'), 'speaker role assignment invalid role reports blocker');
assertRule(hasBlocker(malformedRoleAssignmentReport, 'SPEAKER_ROLE_ASSIGNMENT_SOURCE_INVALID'), 'speaker role assignment invalid source reports blocker');
assertRule(hasBlocker(malformedRoleAssignmentReport, 'SPEAKER_ROLE_ASSIGNMENT_CONFLICT'), 'speaker role assignment conflicting role still reports blocker');

const ambiguousRoleAssignmentReport = validateSmartCutEvidenceQuality({
  presetId: 'teacher-talking-head-single',
  sourceMedia: teacherSourceMedia,
  transcriptEvidence: teacherTranscriptEvidence,
  speakerEvidence: {
    ...teacherSpeakerEvidence,
    profiles: teacherSpeakerEvidence.profiles.map((profile) => ({ ...profile, role: 'unknown' })),
    roleAssignments: [
      {
        speakerId: 'speaker-teacher',
        role: 'teacher',
        confidence: 0.96,
        evidenceTurnIds: ['turn-1'],
        source: 'llm-role-inference',
      },
      {
        speakerId: 'speaker-teacher',
        role: 'guest',
        confidence: 0.93,
        evidenceTurnIds: [],
        source: 'metadata',
      },
    ],
  },
});

assertRule(ambiguousRoleAssignmentReport.ready === false, 'ambiguous overlapping role assignments fail evidence gate');
assertRule(
  hasBlocker(ambiguousRoleAssignmentReport, 'SPEAKER_ROLE_ASSIGNMENT_AMBIGUOUS'),
  'ambiguous overlapping role assignments report blocker',
);

const malformedSpeakerTurnReport = validateSmartCutEvidenceQuality({
  presetId: 'teacher-talking-head-single',
  sourceMedia: teacherSourceMedia,
  transcriptEvidence: teacherTranscriptEvidence,
  speakerEvidence: {
    ...teacherSpeakerEvidence,
    turns: [
      {
        id: ' ',
        speakerId: 'speaker-teacher',
        startMs: 1_000,
        endMs: 10_000,
        sentenceIds: ['sentence-blank-id'],
        transcriptSegmentIds: ['segment-1'],
        text: 'The first complete idea explains why early planning matters.',
        isQuestion: false,
        isAnswerCandidate: true,
        isInterruption: false,
        isBackchannel: false,
        topicIds: ['topic-planning'],
        risks: [],
      },
      {
        id: 'turn-dup',
        speakerId: 'speaker-missing',
        startMs: 12_000,
        endMs: 11_000,
        sentenceIds: ['sentence-invalid-range'],
        transcriptSegmentIds: ['segment-1', 'segment-missing'],
        text: 'This invalid turn should be blocked.',
        isQuestion: false,
        isAnswerCandidate: true,
        isInterruption: false,
        isBackchannel: false,
        topicIds: ['topic-planning'],
        risks: [],
      },
      {
        id: 'turn-dup',
        speakerId: 'speaker-teacher',
        startMs: 18_200,
        endMs: 45_000,
        sentenceIds: ['sentence-speaker-mismatch'],
        transcriptSegmentIds: ['segment-2'],
        text: 'The payoff is that every activity and recommendation can support one coherent story.',
        isQuestion: false,
        isAnswerCandidate: true,
        isInterruption: false,
        isBackchannel: false,
        topicIds: ['topic-planning'],
        risks: [],
      },
      {
        id: 'turn-out-of-source',
        speakerId: 'speaker-teacher',
        startMs: 89_000,
        endMs: 95_000,
        sentenceIds: ['sentence-out-of-source'],
        transcriptSegmentIds: ['segment-2'],
        text: 'This turn extends beyond the source media duration.',
        isQuestion: false,
        isAnswerCandidate: true,
        isInterruption: false,
        isBackchannel: false,
        topicIds: ['topic-planning'],
        risks: [],
      },
    ],
  },
});

assertRule(malformedSpeakerTurnReport.ready === false, 'malformed speaker turns fail evidence gate');
assertRule(hasBlocker(malformedSpeakerTurnReport, 'SPEAKER_TURN_ID_MISSING'), 'missing speaker turn id reports blocker');
assertRule(hasBlocker(malformedSpeakerTurnReport, 'DUPLICATE_SPEAKER_TURN_ID'), 'duplicate speaker turn id reports blocker');
assertRule(hasBlocker(malformedSpeakerTurnReport, 'INVALID_SPEAKER_TURN_RANGE'), 'invalid speaker turn range reports blocker');
assertRule(hasBlocker(malformedSpeakerTurnReport, 'SPEAKER_TURN_OUT_OF_SOURCE'), 'speaker turn outside source reports blocker');
assertRule(hasBlocker(malformedSpeakerTurnReport, 'SPEAKER_TURN_UNKNOWN_TRANSCRIPT_SEGMENT'), 'speaker turn unknown transcript segment reports blocker');
assertRule(hasBlocker(malformedSpeakerTurnReport, 'SPEAKER_TURN_UNKNOWN_SPEAKER'), 'speaker turn unknown speaker reports blocker');
assertRule(hasBlocker(malformedSpeakerTurnReport, 'SPEAKER_TURN_SPEAKER_MISMATCH'), 'speaker turn transcript speaker mismatch reports blocker');

const untraceableSpeakerTurnReport = validateSmartCutEvidenceQuality({
  presetId: 'teacher-talking-head-single',
  sourceMedia: teacherSourceMedia,
  transcriptEvidence: teacherTranscriptEvidence,
  speakerEvidence: {
    ...teacherSpeakerEvidence,
    turns: [
      {
        id: 'turn-no-transcript',
        speakerId: 'speaker-teacher',
        startMs: 1_000,
        endMs: 10_000,
        sentenceIds: [],
        transcriptSegmentIds: [],
        text: 'This turn has no transcript evidence.',
        isQuestion: false,
        isAnswerCandidate: true,
        isInterruption: false,
        isBackchannel: false,
        topicIds: ['topic-planning'],
        risks: [],
      },
      {
        id: 'turn-blank-text',
        speakerId: 'speaker-teacher',
        startMs: 1_000,
        endMs: 18_000,
        sentenceIds: ['sentence-blank-text'],
        transcriptSegmentIds: ['segment-1'],
        text: ' ',
        isQuestion: false,
        isAnswerCandidate: true,
        isInterruption: false,
        isBackchannel: false,
        topicIds: ['topic-planning'],
        risks: [],
      },
      {
        id: 'turn-time-mismatch',
        speakerId: 'speaker-teacher',
        startMs: 60_000,
        endMs: 70_000,
        sentenceIds: ['sentence-time-mismatch'],
        transcriptSegmentIds: ['segment-1'],
        text: 'The first complete idea explains why early planning matters.',
        isQuestion: false,
        isAnswerCandidate: true,
        isInterruption: false,
        isBackchannel: false,
        topicIds: ['topic-planning'],
        risks: [],
      },
    ],
    roleAssignments: [],
  },
});

assertRule(untraceableSpeakerTurnReport.ready === false, 'untraceable speaker turns fail evidence gate');
assertRule(hasBlocker(untraceableSpeakerTurnReport, 'SPEAKER_TURN_WITHOUT_TRANSCRIPT_SEGMENTS'), 'speaker turn without transcript segment ids reports blocker');
assertRule(hasBlocker(untraceableSpeakerTurnReport, 'SPEAKER_TURN_TEXT_MISSING'), 'speaker turn missing text reports blocker');
assertRule(hasBlocker(untraceableSpeakerTurnReport, 'SPEAKER_TURN_TRANSCRIPT_RANGE_MISMATCH'), 'speaker turn transcript range mismatch reports blocker');

const undeclaredOverlapReport = validateSmartCutEvidenceQuality({
  presetId: 'meeting-minutes-highlights',
  sourceMedia: {
    id: 'media-meeting',
    uri: 'file:///meeting.mp4',
    mediaKind: 'meeting',
    durationMs: 120_000,
  },
  transcriptEvidence: {
    kind: 'transcript',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    provider: 'fixture-stt',
    language: 'en-US',
    segments: [
      {
        id: 'meeting-segment',
        startMs: 5_000,
        endMs: 20_000,
        text: 'Two people speak over each other and the diarization must declare that overlap.',
        confidence: 0.92,
        language: 'en-US',
        speakerId: 'speaker-a',
      },
    ],
  },
  speakerEvidence: {
    kind: 'speaker',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    profiles: [
      { id: 'speaker-a', displayName: 'Speaker A', role: 'speaker', confidence: 0.9, source: 'diarization' },
      { id: 'speaker-b', displayName: 'Speaker B', role: 'speaker', confidence: 0.9, source: 'diarization' },
    ],
    segments: [
      { id: 'speaker-segment-meeting-a', speakerId: 'speaker-a', startMs: 5_000, endMs: 20_000, confidence: 0.9 },
      { id: 'speaker-segment-meeting-b', speakerId: 'speaker-b', startMs: 8_000, endMs: 18_000, confidence: 0.88 },
    ],
    turns: [],
    overlappingSpeechGroups: [],
    roleAssignments: [],
    corrections: [],
  },
});

assertRule(undeclaredOverlapReport.ready === false, 'undeclared overlapping speech fails evidence gate');
assertRule(hasBlocker(undeclaredOverlapReport, 'OVERLAPPING_SPEECH_NOT_DECLARED'), 'undeclared overlapping speech reports blocker');

const filmVisualSourceMedia = {
  id: 'media-film',
  uri: 'file:///film.mp4',
  mediaKind: 'film',
  durationMs: 120_000,
  width: 1920,
  height: 1080,
  frameRateFps: 24,
};

const validFilmVisualEvidence = {
  kind: 'visual',
  schemaVersion: SMART_CUT_STANDARD_VERSION,
  provider: 'fixture-visual',
  profile: 'shot-boundary-v1',
  shots: [
    { id: 'shot-1', startMs: 0, endMs: 30_000, confidence: 0.92, cameraMotion: 'static', boundarySource: 'ffmpeg-scene' },
    { id: 'shot-2', startMs: 30_000, endMs: 72_000, confidence: 0.89, cameraMotion: 'pan', boundarySource: 'ffmpeg-scene' },
    { id: 'shot-3', startMs: 72_000, endMs: 120_000, confidence: 0.94, cameraMotion: 'handheld', boundarySource: 'ffmpeg-scene' },
  ],
  sceneBoundaries: [
    { startMs: 0, endMs: 72_000 },
    { startMs: 72_000, endMs: 120_000 },
  ],
  frameQuality: [
    { atMs: 10_000, blurScore: 0.08, exposureScore: 0.91, stabilityScore: 0.88 },
    { atMs: 80_000, blurScore: 0.11, exposureScore: 0.87, stabilityScore: 0.83 },
  ],
};

const validVisualReport = validateSmartCutVisualEvidenceQuality({
  presetId: 'film-scene-index',
  sourceMedia: filmVisualSourceMedia,
  visualEvidence: validFilmVisualEvidence,
});

assertRule(validVisualReport.ready === true, 'valid film visual evidence quality gate is ready');
assertRule(validVisualReport.visualReady === true, 'valid film visual evidence is ready');
assertRule(validVisualReport.shotReady === true, 'valid film shot evidence is ready');
assertRule(validVisualReport.sceneReady === true, 'valid film scene evidence is ready');
assertRule(validVisualReport.frameQualityReady === true, 'valid film frame quality evidence is ready');
assertRule(validVisualReport.blockers.length === 0, 'valid film visual evidence has no blockers');
assertRule(validVisualReport.metrics.shotCount === 3, 'visual evidence metrics count shots');
assertRule(validVisualReport.metrics.sceneBoundaryCount === 2, 'visual evidence metrics count scene boundaries');
assertRule(validVisualReport.metrics.timelineCoverageRatio === 1, 'visual evidence metrics require complete shot coverage');
assertRule(validVisualReport.metrics.averageShotConfidence > 0.9, 'visual evidence metrics preserve shot confidence');

let malformedVisualPayloadReport;
let malformedVisualPayloadException;
try {
  malformedVisualPayloadReport = validateSmartCutVisualEvidenceQuality({
    presetId: 'film-scene-index',
    sourceMedia: filmVisualSourceMedia,
    visualEvidence: undefined,
  });
} catch (error) {
  malformedVisualPayloadException = error;
}

assertRule(malformedVisualPayloadException === undefined, 'visual evidence quality gate does not throw on malformed payloads');
assertRule(malformedVisualPayloadReport?.ready === false, 'visual evidence quality gate fails closed on malformed payloads');
assertRule(hasBlocker(malformedVisualPayloadReport ?? { blockers: [] }, 'VISUAL_EVIDENCE_INVALID'), 'visual evidence quality reports malformed visual evidence payload');

const malformedVisualContainerReport = validateSmartCutVisualEvidenceQuality({
  presetId: 'film-scene-index',
  sourceMedia: filmVisualSourceMedia,
  visualEvidence: {
    ...validFilmVisualEvidence,
    provider: ' ',
    profile: 'experimental-profile',
    shots: undefined,
    sceneBoundaries: undefined,
    frameQuality: undefined,
  },
});

assertRule(malformedVisualContainerReport.ready === false, 'malformed visual evidence containers fail quality gate');
assertRule(hasBlocker(malformedVisualContainerReport, 'VISUAL_EVIDENCE_PROVIDER_MISSING'), 'missing visual evidence provider reports blocker');
assertRule(hasBlocker(malformedVisualContainerReport, 'VISUAL_EVIDENCE_PROFILE_INVALID'), 'invalid visual evidence profile reports blocker');
assertRule(hasBlocker(malformedVisualContainerReport, 'VISUAL_SHOTS_INVALID'), 'malformed visual shots container reports blocker');
assertRule(hasBlocker(malformedVisualContainerReport, 'VISUAL_SCENE_BOUNDARIES_INVALID'), 'malformed visual scene boundaries container reports blocker');
assertRule(hasBlocker(malformedVisualContainerReport, 'VISUAL_FRAME_QUALITY_INVALID'), 'malformed visual frame quality container reports blocker');

const missingVisualShotsReport = validateSmartCutVisualEvidenceQuality({
  presetId: 'film-scene-index',
  sourceMedia: filmVisualSourceMedia,
  visualEvidence: {
    ...validFilmVisualEvidence,
    shots: [],
  },
});

assertRule(missingVisualShotsReport.ready === false, 'missing visual shots fail quality gate');
assertRule(hasBlocker(missingVisualShotsReport, 'MISSING_VISUAL_SHOT_EVIDENCE'), 'missing visual shots report blocker');

const malformedVisualShotsReport = validateSmartCutVisualEvidenceQuality({
  presetId: 'film-scene-index',
  sourceMedia: filmVisualSourceMedia,
  visualEvidence: {
    ...validFilmVisualEvidence,
    shots: [
      undefined,
      { id: ' ', startMs: 0, endMs: 10_000, confidence: 0.9 },
      { id: 'shot-dup', startMs: 10_000, endMs: 20_000, confidence: 0.91 },
      { id: 'shot-dup', startMs: 20_000, endMs: 30_000, confidence: 0.92 },
      { id: 'shot-invalid-range', startMs: 32_000, endMs: 31_000, confidence: 0.93 },
      { id: 'shot-out-of-source', startMs: 118_000, endMs: 130_000, confidence: 0.93 },
      { id: 'shot-low-confidence', startMs: 40_000, endMs: 50_000, confidence: 0.31 },
      { id: 'shot-invalid-confidence', startMs: 50_000, endMs: 60_000, confidence: 1.3 },
      { id: 'shot-overlap-a', startMs: 70_000, endMs: 90_000, confidence: 0.91 },
      { id: 'shot-overlap-b', startMs: 80_000, endMs: 100_000, confidence: 0.92 },
    ],
  },
});

assertRule(malformedVisualShotsReport.ready === false, 'malformed visual shots fail quality gate');
assertRule(hasBlocker(malformedVisualShotsReport, 'VISUAL_SHOT_INVALID'), 'malformed visual shot item reports blocker');
assertRule(hasBlocker(malformedVisualShotsReport, 'VISUAL_SHOT_ID_MISSING'), 'missing visual shot id reports blocker');
assertRule(hasBlocker(malformedVisualShotsReport, 'DUPLICATE_VISUAL_SHOT_ID'), 'duplicate visual shot id reports blocker');
assertRule(hasBlocker(malformedVisualShotsReport, 'INVALID_VISUAL_SHOT_RANGE'), 'invalid visual shot range reports blocker');
assertRule(hasBlocker(malformedVisualShotsReport, 'VISUAL_SHOT_OUT_OF_SOURCE'), 'out-of-source visual shot reports blocker');
assertRule(hasBlocker(malformedVisualShotsReport, 'LOW_VISUAL_SHOT_CONFIDENCE'), 'low visual shot confidence reports blocker');
assertRule(hasBlocker(malformedVisualShotsReport, 'VISUAL_SHOT_CONFIDENCE_INVALID'), 'invalid visual shot confidence reports blocker');
assertRule(hasBlocker(malformedVisualShotsReport, 'VISUAL_SHOTS_OVERLAP'), 'overlapping visual shots report blocker');

const malformedVisualSceneReport = validateSmartCutVisualEvidenceQuality({
  presetId: 'film-scene-index',
  sourceMedia: filmVisualSourceMedia,
  visualEvidence: {
    ...validFilmVisualEvidence,
    sceneBoundaries: [
      undefined,
      { startMs: 72_000, endMs: 72_000 },
      { startMs: 118_000, endMs: 130_000 },
      { startMs: 30_500, endMs: 71_500 },
    ],
  },
});

assertRule(malformedVisualSceneReport.ready === false, 'malformed visual scene boundaries fail quality gate');
assertRule(hasBlocker(malformedVisualSceneReport, 'VISUAL_SCENE_BOUNDARY_INVALID'), 'invalid visual scene boundary reports blocker');
assertRule(hasBlocker(malformedVisualSceneReport, 'VISUAL_SCENE_BOUNDARY_OUT_OF_SOURCE'), 'out-of-source visual scene boundary reports blocker');
assertRule(hasBlocker(malformedVisualSceneReport, 'VISUAL_SCENE_BOUNDARY_WITHOUT_SHOT_COVERAGE'), 'uncovered visual scene boundary reports blocker');

const malformedFrameQualityReport = validateSmartCutVisualEvidenceQuality({
  presetId: 'film-scene-index',
  sourceMedia: filmVisualSourceMedia,
  visualEvidence: {
    ...validFilmVisualEvidence,
    frameQuality: [
      undefined,
      { atMs: 125_000, blurScore: 0.1, exposureScore: 0.8, stabilityScore: 0.8 },
      { atMs: 20_000, blurScore: -0.1, exposureScore: 1.2, stabilityScore: Number.NaN },
    ],
  },
});

assertRule(malformedFrameQualityReport.ready === false, 'malformed frame quality samples fail quality gate');
assertRule(hasBlocker(malformedFrameQualityReport, 'VISUAL_FRAME_QUALITY_SAMPLE_INVALID'), 'malformed frame quality sample item reports blocker');
assertRule(hasBlocker(malformedFrameQualityReport, 'VISUAL_FRAME_QUALITY_SAMPLE_OUT_OF_SOURCE'), 'out-of-source frame quality sample reports blocker');
assertRule(hasBlocker(malformedFrameQualityReport, 'VISUAL_FRAME_QUALITY_SCORE_INVALID'), 'invalid frame quality score reports blocker');

if (failures.length > 0) {
  console.error(`blocked - smart cut evidence quality failures=${failures.length}`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`ok - smart cut evidence quality checks=${pass.length}`);
