#!/usr/bin/env node

import process from 'node:process';

import {
  SMART_CUT_STANDARD_VERSION,
  validateSmartCutContentUnitEvidenceLink,
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

const contentUnits = [
  {
    id: 'unit-1',
    startMs: 1_000,
    endMs: 24_000,
    unitKind: 'content-unit',
    text: 'A complete planning idea with setup.',
    speakerIds: ['speaker-teacher'],
    speakerTurnIds: ['turn-1'],
    speakerRoles: ['teacher'],
    speakerConfidence: 0.98,
    overlapGroupIds: [],
    transcriptSegmentIds: ['segment-1'],
    evidenceIds: ['transcript', 'speaker'],
    topicIds: ['topic-planning'],
    completenessScore: 0.94,
    continuityScore: 0.93,
    publishabilityScore: 0.91,
  },
  {
    id: 'unit-2',
    startMs: 24_000,
    endMs: 61_000,
    unitKind: 'content-unit',
    text: 'A complete payoff that can stand alone as a publishable clip.',
    speakerIds: ['speaker-teacher'],
    speakerTurnIds: ['turn-2'],
    speakerRoles: ['teacher'],
    speakerConfidence: 0.98,
    overlapGroupIds: [],
    transcriptSegmentIds: ['segment-2'],
    evidenceIds: ['transcript', 'speaker'],
    topicIds: ['topic-planning'],
    completenessScore: 0.95,
    continuityScore: 0.93,
    publishabilityScore: 0.92,
  },
];

const transcriptEvidence = {
  kind: 'transcript',
  schemaVersion: SMART_CUT_STANDARD_VERSION,
  provider: 'fixture-stt',
  language: 'en-US',
  segments: [
    {
      id: 'segment-1',
      startMs: 1_000,
      endMs: 24_000,
      text: 'A complete planning idea with setup.',
      confidence: 0.95,
      language: 'en-US',
      speakerId: 'speaker-teacher',
    },
    {
      id: 'segment-2',
      startMs: 24_000,
      endMs: 61_000,
      text: 'A complete payoff that can stand alone as a publishable clip.',
      confidence: 0.96,
      language: 'en-US',
      speakerId: 'speaker-teacher',
    },
  ],
};

const speakerEvidence = {
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
    { id: 'speaker-segment-teacher', speakerId: 'speaker-teacher', startMs: 1_000, endMs: 61_000, confidence: 0.98 },
  ],
  turns: [
    {
      id: 'turn-1',
      speakerId: 'speaker-teacher',
      startMs: 1_000,
      endMs: 24_000,
      sentenceIds: ['sentence-1'],
      transcriptSegmentIds: ['segment-1'],
      text: 'A complete planning idea with setup.',
      isQuestion: false,
      isAnswerCandidate: true,
      isInterruption: false,
      isBackchannel: false,
      topicIds: ['topic-planning'],
      risks: [],
    },
    {
      id: 'turn-2',
      speakerId: 'speaker-teacher',
      startMs: 24_000,
      endMs: 61_000,
      sentenceIds: ['sentence-2'],
      transcriptSegmentIds: ['segment-2'],
      text: 'A complete payoff that can stand alone as a publishable clip.',
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
      evidenceTurnIds: ['turn-1', 'turn-2'],
      source: 'rule',
    },
  ],
  corrections: [],
};

const validReport = validateSmartCutContentUnitEvidenceLink({
  contentUnits,
  transcriptEvidence,
  speakerEvidence,
});

assertRule(validReport.ready === true, 'valid content unit evidence links pass');
assertRule(validReport.blockers.length === 0, 'valid content unit evidence links have no blockers');
assertRule(validReport.metrics.unitCount === 2, 'evidence link report counts content units');
assertRule(validReport.metrics.linkedTranscriptSegmentCount === 2, 'evidence link report counts linked transcript segments');
assertRule(validReport.metrics.linkedSpeakerCount === 1, 'evidence link report counts linked speakers');
assertRule(validReport.metrics.linkedSpeakerTurnCount === 2, 'evidence link report counts linked speaker turns');

const shortSegmentEvidenceLinkReport = validateSmartCutContentUnitEvidenceLink({
  contentUnits: [
    {
      id: 'unit-short-covered',
      startMs: 27_136,
      endMs: 27_276,
      unitKind: 'content-unit',
      text: 'Seal',
      speakerIds: ['speaker-teacher'],
      speakerTurnIds: ['turn-short-covered'],
      speakerRoles: ['teacher'],
      speakerConfidence: 0.97,
      overlapGroupIds: [],
      transcriptSegmentIds: ['short-covered-segment'],
      evidenceIds: ['transcript', 'speaker'],
      topicIds: ['topic-short-fragment'],
      completenessScore: 0.88,
      continuityScore: 0.9,
      publishabilityScore: 0.72,
    },
  ],
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
    ...speakerEvidence,
    segments: [
      { id: 'speaker-segment-short-covered', speakerId: 'speaker-teacher', startMs: 27_136, endMs: 27_276, confidence: 0.97 },
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

assertRule(shortSegmentEvidenceLinkReport.ready === true, 'content unit evidence link accepts fully covered short STT speech fragments');
assertRule(
  !shortSegmentEvidenceLinkReport.blockers.some((blocker) => blocker.code === 'CONTENT_UNIT_SPEAKER_SEGMENT_NOT_FOUND'),
  'short fully covered content unit keeps speaker segment evidence linkage',
);

const multiTurnSemanticUnitReport = validateSmartCutContentUnitEvidenceLink({
  contentUnits: [
    {
      ...contentUnits[0],
      id: 'unit-same-speaker-semantic-bridge',
      startMs: 1_000,
      endMs: 61_000,
      text: `${transcriptEvidence.segments[0].text} ${transcriptEvidence.segments[1].text}`,
      speakerTurnIds: ['turn-1', 'turn-2'],
      transcriptSegmentIds: ['segment-1', 'segment-2'],
    },
  ],
  transcriptEvidence,
  speakerEvidence,
});

assertRule(
  multiTurnSemanticUnitReport.ready === true,
  'same-speaker semantic unit can be linked by the union of multiple speaker turns',
);
assertRule(
  multiTurnSemanticUnitReport.blockers.length === 0,
  'same-speaker semantic unit has no speaker turn evidence-link blockers',
);

const missingTranscriptReport = validateSmartCutContentUnitEvidenceLink({
  contentUnits: [
    {
      ...contentUnits[0],
      transcriptSegmentIds: ['segment-missing'],
    },
  ],
  transcriptEvidence,
  speakerEvidence,
});

assertRule(missingTranscriptReport.ready === false, 'missing transcript segment link fails');
assertRule(
  missingTranscriptReport.blockers.some((blocker) => blocker.code === 'CONTENT_UNIT_TRANSCRIPT_SEGMENT_NOT_FOUND'),
  'missing transcript segment link reports blocker',
);

const missingEvidenceKindReport = validateSmartCutContentUnitEvidenceLink({
  contentUnits: [
    {
      ...contentUnits[0],
      evidenceIds: ['speaker'],
    },
  ],
  transcriptEvidence,
  speakerEvidence,
});

assertRule(missingEvidenceKindReport.ready === false, 'missing transcript evidence id link fails');
assertRule(
  missingEvidenceKindReport.blockers.some((blocker) => blocker.code === 'CONTENT_UNIT_TRANSCRIPT_EVIDENCE_NOT_DECLARED'),
  'missing transcript evidence id reports blocker',
);

const mismatchedTranscriptReport = validateSmartCutContentUnitEvidenceLink({
  contentUnits: [
    {
      ...contentUnits[0],
      text: 'Mutated transcript text.',
    },
  ],
  transcriptEvidence,
  speakerEvidence,
});

assertRule(mismatchedTranscriptReport.ready === false, 'mutated content unit transcript text fails');
assertRule(
  mismatchedTranscriptReport.blockers.some((blocker) => blocker.code === 'CONTENT_UNIT_TRANSCRIPT_TEXT_MISMATCH'),
  'mutated transcript text reports blocker',
);

const missingSpeakerReport = validateSmartCutContentUnitEvidenceLink({
  contentUnits: [
    {
      ...contentUnits[0],
      speakerIds: ['speaker-missing'],
    },
  ],
  transcriptEvidence,
  speakerEvidence,
});

assertRule(missingSpeakerReport.ready === false, 'missing speaker evidence link fails');
assertRule(
  missingSpeakerReport.blockers.some((blocker) => blocker.code === 'CONTENT_UNIT_SPEAKER_NOT_FOUND'),
  'missing speaker profile reports blocker',
);
assertRule(
  missingSpeakerReport.blockers.some((blocker) => blocker.code === 'CONTENT_UNIT_SPEAKER_SEGMENT_NOT_FOUND'),
  'missing speaker segment overlap reports blocker',
);

const missingTurnReport = validateSmartCutContentUnitEvidenceLink({
  contentUnits: [
    {
      ...contentUnits[0],
      speakerTurnIds: ['turn-missing'],
    },
  ],
  transcriptEvidence,
  speakerEvidence,
});

assertRule(missingTurnReport.ready === false, 'missing speaker turn evidence link fails');
assertRule(
  missingTurnReport.blockers.some((blocker) => blocker.code === 'CONTENT_UNIT_SPEAKER_TURN_NOT_FOUND'),
  'missing speaker turn reports blocker',
);

const mismatchedTurnReport = validateSmartCutContentUnitEvidenceLink({
  contentUnits,
  transcriptEvidence,
  speakerEvidence: {
    ...speakerEvidence,
    turns: [
      {
        ...speakerEvidence.turns[0],
        transcriptSegmentIds: ['segment-2'],
      },
      speakerEvidence.turns[1],
    ],
  },
});

assertRule(mismatchedTurnReport.ready === false, 'speaker turn transcript mismatch fails');
assertRule(
  mismatchedTurnReport.blockers.some((blocker) => blocker.code === 'CONTENT_UNIT_SPEAKER_TURN_SEGMENT_MISMATCH'),
  'speaker turn transcript mismatch reports blocker',
);

const unsupportedRoleReport = validateSmartCutContentUnitEvidenceLink({
  contentUnits: [
    {
      ...contentUnits[0],
      speakerRoles: ['guest'],
    },
  ],
  transcriptEvidence,
  speakerEvidence,
});

assertRule(unsupportedRoleReport.ready === false, 'unsupported speaker role link fails');
assertRule(
  unsupportedRoleReport.blockers.some((blocker) => blocker.code === 'CONTENT_UNIT_SPEAKER_ROLE_NOT_SUPPORTED'),
  'unsupported speaker role reports blocker',
);

const roleAssignmentWrongTurnReport = validateSmartCutContentUnitEvidenceLink({
  contentUnits: [
    {
      ...contentUnits[0],
      speakerRoles: ['guest'],
    },
  ],
  transcriptEvidence,
  speakerEvidence: {
    ...speakerEvidence,
    roleAssignments: [
      {
        speakerId: 'speaker-teacher',
        role: 'guest',
        confidence: 0.98,
        evidenceTurnIds: ['turn-2'],
        source: 'manual',
      },
    ],
  },
});

assertRule(roleAssignmentWrongTurnReport.ready === false, 'speaker role assignment for another turn does not support this content unit');
assertRule(
  roleAssignmentWrongTurnReport.blockers.some((blocker) => blocker.code === 'CONTENT_UNIT_SPEAKER_ROLE_NOT_SUPPORTED'),
  'speaker role assignment must be scoped to the unit speaker turns',
);

const roleAssignmentMatchingTurnReport = validateSmartCutContentUnitEvidenceLink({
  contentUnits: [
    {
      ...contentUnits[0],
      speakerRoles: ['guest'],
    },
  ],
  transcriptEvidence,
  speakerEvidence: {
    ...speakerEvidence,
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

assertRule(roleAssignmentMatchingTurnReport.ready === true, 'speaker role assignment supports matching content unit turn ids');
assertRule(roleAssignmentMatchingTurnReport.blockers.length === 0, 'matching turn role assignment has no evidence-link blockers');

const overlapReport = validateSmartCutContentUnitEvidenceLink({
  contentUnits: [
    {
      ...contentUnits[0],
      overlapGroupIds: ['overlap-missing'],
    },
  ],
  transcriptEvidence,
  speakerEvidence,
});

assertRule(overlapReport.ready === false, 'missing overlap group link fails');
assertRule(
  overlapReport.blockers.some((blocker) => blocker.code === 'CONTENT_UNIT_OVERLAP_GROUP_NOT_FOUND'),
  'missing overlap group reports blocker',
);

if (failures.length > 0) {
  console.error(`blocked - smart cut content unit evidence link failures=${failures.length}`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`ok - smart cut content unit evidence link checks=${pass.length}`);
