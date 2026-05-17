#!/usr/bin/env node

import process from 'node:process';

import {
  SMART_CUT_STANDARD_VERSION,
  validateSmartCutSemanticBoundaryProof,
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

const teacherUnits = [
  {
    id: 'unit-setup',
    startMs: 1_000,
    endMs: 18_000,
    unitKind: 'content-unit',
    text: 'Families often lose time because planning starts too late.',
    speakerIds: ['speaker-teacher'],
    transcriptSegmentIds: ['segment-setup'],
    evidenceIds: ['transcript', 'speaker'],
    topicIds: ['topic-planning'],
    completenessScore: 0.94,
    continuityScore: 0.94,
    publishabilityScore: 0.9,
  },
  {
    id: 'unit-payoff',
    startMs: 18_000,
    endMs: 46_000,
    unitKind: 'content-unit',
    text: 'The practical answer is to build course choices, activities, and essays around one coherent story.',
    speakerIds: ['speaker-teacher'],
    transcriptSegmentIds: ['segment-payoff'],
    evidenceIds: ['transcript', 'speaker'],
    topicIds: ['topic-planning'],
    completenessScore: 0.95,
    continuityScore: 0.94,
    publishabilityScore: 0.92,
  },
];

const teacherCandidate = {
  id: 'candidate-teacher',
  slicerId: 'speech-semantic',
  startMs: 1_000,
  endMs: 46_000,
  unitIds: ['unit-setup', 'unit-payoff'],
  title: 'Planning answer',
  reason: 'Complete setup and answer.',
  confidence: 0.92,
  risks: [],
};

const teacherReport = validateSmartCutSemanticBoundaryProof({
  presetId: 'teacher-talking-head-single',
  contentUnits: teacherUnits,
  candidates: [teacherCandidate],
});

assertRule(teacherReport.ready === true, 'complete teacher semantic boundary proof passes');
assertRule(teacherReport.blockers.length === 0, 'complete teacher semantic boundary proof has no blockers');
assertRule(teacherReport.candidateReports[0]?.complete === true, 'teacher candidate is marked complete');
assertRule(teacherReport.candidateReports[0]?.unitSpanMs === 45_000, 'teacher candidate reports unit span');

const dialogueUnits = [
  {
    id: 'unit-question',
    startMs: 5_000,
    endMs: 12_000,
    unitKind: 'speaker-turn',
    text: 'When should families start planning?',
    speakerIds: ['speaker-host'],
    speakerTurnIds: ['turn-question'],
    speakerRoles: ['interviewer'],
    speakerConfidence: 0.95,
    overlapGroupIds: [],
    transcriptSegmentIds: ['segment-question'],
    evidenceIds: ['transcript', 'speaker'],
    topicIds: ['topic-planning'],
    completenessScore: 0.93,
    continuityScore: 0.92,
    publishabilityScore: 0.89,
  },
  {
    id: 'unit-answer',
    startMs: 12_200,
    endMs: 72_000,
    unitKind: 'speaker-turn',
    text: 'They should start early enough to connect courses, activities, recommendations, and essays into one credible story.',
    speakerIds: ['speaker-guest'],
    speakerTurnIds: ['turn-answer'],
    speakerRoles: ['guest'],
    speakerConfidence: 0.96,
    overlapGroupIds: [],
    transcriptSegmentIds: ['segment-answer'],
    evidenceIds: ['transcript', 'speaker'],
    topicIds: ['topic-planning'],
    completenessScore: 0.95,
    continuityScore: 0.93,
    publishabilityScore: 0.91,
  },
];

const dialogueReport = validateSmartCutSemanticBoundaryProof({
  presetId: 'interview-one-question-one-answer',
  contentUnits: dialogueUnits,
  candidates: [
    {
      id: 'candidate-dialogue',
      slicerId: 'dialogue-qa',
      startMs: 5_000,
      endMs: 72_000,
      unitIds: ['unit-question', 'unit-answer'],
      title: 'Planning Q/A',
      reason: 'Complete question and answer.',
      confidence: 0.93,
      risks: [],
    },
  ],
});

assertRule(dialogueReport.ready === true, 'complete dialogue Q/A semantic boundary proof passes');
assertRule(dialogueReport.candidateReports[0]?.hasQuestion === true, 'dialogue proof detects question unit');
assertRule(dialogueReport.candidateReports[0]?.hasAnswer === true, 'dialogue proof detects answer unit');

const reversedRoleDialogueReport = validateSmartCutSemanticBoundaryProof({
  presetId: 'interview-one-question-one-answer',
  contentUnits: [
    {
      ...dialogueUnits[0],
      id: 'unit-guest-question',
      speakerIds: ['speaker-guest'],
      speakerTurnIds: ['turn-guest-question'],
      speakerRoles: ['guest'],
    },
    {
      ...dialogueUnits[1],
      id: 'unit-interviewer-answer',
      speakerIds: ['speaker-host'],
      speakerTurnIds: ['turn-interviewer-answer'],
      speakerRoles: ['interviewer'],
    },
  ],
  candidates: [
    {
      id: 'candidate-reversed-role-dialogue',
      slicerId: 'dialogue-qa',
      startMs: 5_000,
      endMs: 72_000,
      unitIds: ['unit-guest-question', 'unit-interviewer-answer'],
      title: 'Reversed role Q/A',
      reason: 'Question and answer text exist but speaker roles are reversed.',
      confidence: 0.9,
      risks: [],
    },
  ],
});

assertRule(reversedRoleDialogueReport.ready === false, 'dialogue candidate with reversed speaker roles fails');
assertRule(hasBlocker(reversedRoleDialogueReport, 'DIALOGUE_ROLE_SEQUENCE_INVALID'), 'reversed speaker roles report dialogue role blocker');

const reversedUnitOrderReport = validateSmartCutSemanticBoundaryProof({
  presetId: 'interview-one-question-one-answer',
  contentUnits: dialogueUnits,
  candidates: [
    {
      id: 'candidate-reversed-unit-order',
      slicerId: 'dialogue-qa',
      startMs: 5_000,
      endMs: 72_000,
      unitIds: ['unit-answer', 'unit-question'],
      title: 'Reversed unit order',
      reason: 'Unit ids are not ordered by semantic turn order.',
      confidence: 0.9,
      risks: [],
    },
  ],
});

assertRule(reversedUnitOrderReport.ready === false, 'dialogue candidate with reversed unit id order fails');
assertRule(hasBlocker(reversedUnitOrderReport, 'CANDIDATE_UNIT_ORDER_MISMATCH'), 'reversed unit id order reports order blocker');

const questionOnlyReport = validateSmartCutSemanticBoundaryProof({
  presetId: 'interview-one-question-one-answer',
  contentUnits: dialogueUnits,
  candidates: [
    {
      id: 'candidate-question-only',
      slicerId: 'dialogue-qa',
      startMs: 5_000,
      endMs: 12_000,
      unitIds: ['unit-question'],
      title: 'Question only',
      reason: 'Missing answer.',
      confidence: 0.9,
      risks: [],
    },
  ],
});

assertRule(questionOnlyReport.ready === false, 'question-only dialogue candidate fails semantic boundary proof');
assertRule(hasBlocker(questionOnlyReport, 'QUESTION_WITHOUT_ANSWER'), 'question-only dialogue reports missing answer blocker');

const danglingConnectorReport = validateSmartCutSemanticBoundaryProof({
  presetId: 'teacher-talking-head-single',
  contentUnits: [
    {
      id: 'unit-dangling',
      startMs: 1_000,
      endMs: 18_000,
      unitKind: 'content-unit',
      text: 'The recommendation matters because',
      speakerIds: ['speaker-teacher'],
      transcriptSegmentIds: ['segment-dangling'],
      evidenceIds: ['transcript', 'speaker'],
      topicIds: ['topic-planning'],
      completenessScore: 0.9,
      continuityScore: 0.9,
      publishabilityScore: 0.88,
    },
  ],
  candidates: [
    {
      id: 'candidate-dangling',
      slicerId: 'speech-semantic',
      startMs: 1_000,
      endMs: 18_000,
      unitIds: ['unit-dangling'],
      title: 'Dangling idea',
      reason: 'Ends with a connector.',
      confidence: 0.88,
      risks: [],
    },
  ],
});

assertRule(danglingConnectorReport.ready === false, 'dangling connector candidate fails semantic boundary proof');
assertRule(hasBlocker(danglingConnectorReport, 'DANGLING_CONNECTOR_BOUNDARY'), 'dangling connector reports semantic boundary blocker');

const completeConnectorBoundaryReport = validateSmartCutSemanticBoundaryProof({
  presetId: 'teacher-talking-head-single',
  contentUnits: [
    {
      id: 'unit-complete-connector-start',
      startMs: 1_000,
      endMs: 18_000,
      unitKind: 'content-unit',
      text: 'So speaker two interrupts quickly, but the answer completes the refund fix and gives the viewer the final result.',
      speakerIds: ['speaker-teacher'],
      transcriptSegmentIds: ['segment-complete-connector-start'],
      evidenceIds: ['transcript', 'speaker'],
      topicIds: ['topic-refund'],
      completenessScore: 0.92,
      continuityScore: 0.9,
      publishabilityScore: 0.88,
    },
  ],
  candidates: [
    {
      id: 'candidate-complete-connector-start',
      slicerId: 'speech-semantic',
      startMs: 1_000,
      endMs: 18_000,
      unitIds: ['unit-complete-connector-start'],
      title: 'Complete connector-led sentence',
      reason: 'Complete sentence starts with a connector but carries its own subject and payoff.',
      confidence: 0.88,
      risks: [],
    },
  ],
});

assertRule(
  completeConnectorBoundaryReport.ready === true,
  'complete connector-led sentence passes semantic boundary proof',
);
assertRule(
  !hasBlocker(completeConnectorBoundaryReport, 'DANGLING_CONNECTOR_BOUNDARY'),
  'complete connector-led sentence does not report dangling boundary blocker',
);

const shortCompleteConnectorBoundaryReport = validateSmartCutSemanticBoundaryProof({
  presetId: 'teacher-talking-head-single',
  contentUnits: [
    {
      id: 'unit-short-complete-connector-start',
      startMs: 55_000,
      endMs: 60_700,
      unitKind: 'content-unit',
      text: 'Then keep only the complete spoken payoff.',
      speakerIds: ['speaker-teacher'],
      transcriptSegmentIds: ['segment-short-complete-connector-start'],
      evidenceIds: ['transcript', 'speaker'],
      topicIds: ['topic-payoff'],
      completenessScore: 0.9,
      continuityScore: 0.86,
      publishabilityScore: 0.84,
    },
  ],
  candidates: [
    {
      id: 'candidate-short-complete-connector-start',
      slicerId: 'speech-semantic',
      startMs: 55_000,
      endMs: 60_700,
      unitIds: ['unit-short-complete-connector-start'],
      title: 'Complete payoff',
      reason: 'Short complete sentence starts with a connector but has a complete verb phrase and punctuation.',
      confidence: 0.84,
      risks: [],
    },
  ],
});

assertRule(
  shortCompleteConnectorBoundaryReport.ready === true,
  'short complete connector-led sentence passes semantic boundary proof',
);
assertRule(
  !hasBlocker(shortCompleteConnectorBoundaryReport, 'DANGLING_CONNECTOR_BOUNDARY'),
  'short complete connector-led sentence does not report dangling boundary blocker',
);

const rangeMismatchReport = validateSmartCutSemanticBoundaryProof({
  presetId: 'teacher-talking-head-single',
  contentUnits: teacherUnits,
  candidates: [
    {
      ...teacherCandidate,
      id: 'candidate-range-mismatch',
      startMs: 2_000,
    },
  ],
});

assertRule(rangeMismatchReport.ready === false, 'candidate not snapped to content-unit boundary fails');
assertRule(hasBlocker(rangeMismatchReport, 'CANDIDATE_RANGE_NOT_UNIT_BOUNDARY'), 'range mismatch reports unit boundary blocker');

const gapReport = validateSmartCutSemanticBoundaryProof({
  presetId: 'teacher-talking-head-single',
  contentUnits: [
    teacherUnits[0],
    {
      ...teacherUnits[1],
      id: 'unit-gap',
      startMs: 25_000,
      endMs: 46_000,
    },
  ],
  candidates: [
    {
      ...teacherCandidate,
      id: 'candidate-gap',
      unitIds: ['unit-setup', 'unit-gap'],
    },
  ],
});

assertRule(gapReport.ready === false, 'candidate with unsupported gap fails semantic boundary proof');
assertRule(hasBlocker(gapReport, 'NON_CONTIGUOUS_CONTENT_UNITS'), 'unsupported gap reports contiguity blocker');

const overlapBoundaryReport = validateSmartCutSemanticBoundaryProof({
  presetId: 'meeting-minutes-highlights',
  contentUnits: [
    {
      id: 'unit-meeting',
      startMs: 5_000,
      endMs: 20_000,
      unitKind: 'speaker-turn',
      text: 'The decision and objection are discussed together.',
      speakerIds: ['speaker-a', 'speaker-b'],
      transcriptSegmentIds: ['segment-meeting'],
      evidenceIds: ['transcript', 'speaker'],
      topicIds: ['topic-decision'],
      completenessScore: 0.92,
      continuityScore: 0.91,
      publishabilityScore: 0.86,
    },
  ],
  candidates: [
    {
      id: 'candidate-overlap-cut',
      slicerId: 'meeting-agenda',
      startMs: 8_000,
      endMs: 20_000,
      unitIds: ['unit-meeting'],
      title: 'Cut inside overlap',
      reason: 'Starts inside overlapping speech.',
      confidence: 0.86,
      risks: [],
    },
  ],
  speakerEvidence: {
    kind: 'speaker',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    profiles: [
      { id: 'speaker-a', displayName: 'Speaker A', role: 'speaker', confidence: 0.9, source: 'diarization' },
      { id: 'speaker-b', displayName: 'Speaker B', role: 'speaker', confidence: 0.9, source: 'diarization' },
    ],
    segments: [
      { id: 'speaker-segment-overlap-a', speakerId: 'speaker-a', startMs: 5_000, endMs: 20_000, confidence: 0.9 },
      { id: 'speaker-segment-overlap-b', speakerId: 'speaker-b', startMs: 8_000, endMs: 18_000, confidence: 0.88, overlapGroupId: 'overlap-1' },
    ],
    turns: [],
    overlappingSpeechGroups: [
      {
        id: 'overlap-1',
        startMs: 8_000,
        endMs: 18_000,
        speakerIds: ['speaker-a', 'speaker-b'],
        segmentIds: ['speaker-segment-overlap-a', 'speaker-segment-overlap-b'],
        severity: 'medium',
      },
    ],
    roleAssignments: [],
    corrections: [],
  },
});

assertRule(overlapBoundaryReport.ready === false, 'candidate boundary inside overlapping speech fails');
assertRule(hasBlocker(overlapBoundaryReport, 'CUTS_OVERLAPPING_SPEECH'), 'overlap boundary reports blocker');

const partialOverlapGroupReport = validateSmartCutSemanticBoundaryProof({
  presetId: 'meeting-minutes-highlights',
  contentUnits: [
    {
      id: 'unit-overlap-host',
      startMs: 5_000,
      endMs: 12_000,
      unitKind: 'speaker-turn',
      text: 'The deadline is blocked by the risk review.',
      speakerIds: ['speaker-host'],
      speakerTurnIds: ['turn-overlap-host'],
      speakerRoles: ['moderator'],
      speakerConfidence: 0.94,
      overlapGroupIds: ['overlap-decision'],
      transcriptSegmentIds: ['segment-overlap-host'],
      evidenceIds: ['transcript', 'speaker'],
      topicIds: ['topic-decision'],
      completenessScore: 0.92,
      continuityScore: 0.91,
      publishabilityScore: 0.86,
    },
    {
      id: 'unit-overlap-guest',
      startMs: 5_400,
      endMs: 13_000,
      unitKind: 'speaker-turn',
      text: 'We can decide after the owner confirms the deadline.',
      speakerIds: ['speaker-guest'],
      speakerTurnIds: ['turn-overlap-guest'],
      speakerRoles: ['speaker'],
      speakerConfidence: 0.93,
      overlapGroupIds: ['overlap-decision'],
      transcriptSegmentIds: ['segment-overlap-guest'],
      evidenceIds: ['transcript', 'speaker'],
      topicIds: ['topic-decision'],
      completenessScore: 0.93,
      continuityScore: 0.91,
      publishabilityScore: 0.87,
    },
  ],
  candidates: [
    {
      id: 'candidate-partial-overlap',
      slicerId: 'meeting-agenda',
      startMs: 5_000,
      endMs: 12_000,
      unitIds: ['unit-overlap-host'],
      title: 'Partial overlap',
      reason: 'Includes only one side of the overlap group.',
      confidence: 0.86,
      risks: [],
    },
  ],
});

assertRule(partialOverlapGroupReport.ready === false, 'candidate with partial overlap group fails');
assertRule(hasBlocker(partialOverlapGroupReport, 'CUTS_OVERLAPPING_SPEECH'), 'partial overlap group reports overlap blocker');

if (failures.length > 0) {
  console.error(`blocked - smart cut semantic boundary failures=${failures.length}`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`ok - smart cut semantic boundary checks=${pass.length}`);
