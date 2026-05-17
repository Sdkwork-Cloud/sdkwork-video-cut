#!/usr/bin/env node

import process from 'node:process';

import {
  SMART_CUT_STANDARD_VERSION,
  applySmartCutSpeakerCorrections,
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

const baseSpeakerEvidence = {
  kind: 'speaker',
  schemaVersion: SMART_CUT_STANDARD_VERSION,
  profiles: [
    {
      id: 'speaker-a',
      displayName: 'Speaker A',
      role: 'unknown',
      confidence: 0.82,
      source: 'diarization',
    },
    {
      id: 'speaker-b',
      displayName: 'Speaker B',
      role: 'unknown',
      confidence: 0.79,
      source: 'diarization',
    },
    {
      id: 'speaker-duplicate',
      displayName: 'Speaker Duplicate',
      role: 'unknown',
      confidence: 0.74,
      source: 'diarization',
    },
  ],
  segments: [
    { id: 'speaker-segment-a', speakerId: 'speaker-a', startMs: 1_000, endMs: 10_000, confidence: 0.82 },
    { id: 'speaker-segment-b', speakerId: 'speaker-b', startMs: 10_000, endMs: 25_000, confidence: 0.79 },
    { id: 'speaker-segment-duplicate', speakerId: 'speaker-duplicate', startMs: 25_000, endMs: 32_000, confidence: 0.74 },
  ],
  turns: [
    {
      id: 'turn-question',
      speakerId: 'speaker-a',
      startMs: 1_000,
      endMs: 10_000,
      sentenceIds: ['sentence-question'],
      transcriptSegmentIds: ['segment-question'],
      text: 'What should families plan first?',
      isQuestion: true,
      isAnswerCandidate: false,
      isInterruption: false,
      isBackchannel: false,
      topicIds: ['topic-planning'],
      risks: [],
    },
    {
      id: 'turn-answer',
      speakerId: 'speaker-b',
      startMs: 10_000,
      endMs: 25_000,
      sentenceIds: ['sentence-answer'],
      transcriptSegmentIds: ['segment-answer'],
      text: 'They should align courses and activities before writing essays.',
      isQuestion: false,
      isAnswerCandidate: true,
      isInterruption: false,
      isBackchannel: false,
      topicIds: ['topic-planning'],
      risks: [],
    },
    {
      id: 'turn-duplicate-answer',
      speakerId: 'speaker-duplicate',
      startMs: 25_000,
      endMs: 32_000,
      sentenceIds: ['sentence-duplicate'],
      transcriptSegmentIds: ['segment-duplicate'],
      text: 'The same guest continues with a supporting example.',
      isQuestion: false,
      isAnswerCandidate: true,
      isInterruption: false,
      isBackchannel: false,
      topicIds: ['topic-planning'],
      risks: [],
    },
  ],
  overlappingSpeechGroups: [],
  roleAssignments: [],
  corrections: [],
};

const corrected = applySmartCutSpeakerCorrections({
  speakerEvidence: baseSpeakerEvidence,
  corrections: [
    {
      id: 'correction-rename-host',
      kind: 'rename',
      speakerIds: ['speaker-a'],
      replacementDisplayName: 'Host',
      reason: 'Manual review identified the interviewer.',
      createdAt: '2026-05-14T00:00:00.000Z',
    },
    {
      id: 'correction-role-host',
      kind: 'assign-role',
      speakerIds: ['speaker-a'],
      replacementRole: 'interviewer',
      reason: 'Question turn belongs to host.',
      createdAt: '2026-05-14T00:00:01.000Z',
    },
    {
      id: 'correction-role-guest',
      kind: 'assign-role',
      speakerIds: ['speaker-b'],
      replacementRole: 'guest',
      reason: 'Answer turn belongs to guest.',
      createdAt: '2026-05-14T00:00:02.000Z',
    },
    {
      id: 'correction-merge-guest',
      kind: 'merge',
      speakerIds: ['speaker-b', 'speaker-duplicate'],
      replacementSpeakerId: 'speaker-b',
      reason: 'Diarization split the same guest into two speakers.',
      createdAt: '2026-05-14T00:00:03.000Z',
    },
    {
      id: 'correction-reassign-range',
      kind: 'reassign-time-range',
      speakerIds: ['speaker-a'],
      replacementSpeakerId: 'speaker-b',
      range: { startMs: 24_000, endMs: 33_000 },
      reason: 'The last supporting example belongs to the guest.',
      createdAt: '2026-05-14T00:00:04.000Z',
    },
  ],
});

assertRule(corrected.kind === 'speaker', 'speaker correction keeps speaker evidence kind');
assertRule(corrected.schemaVersion === SMART_CUT_STANDARD_VERSION, 'speaker correction keeps schema version');
assertRule(corrected.corrections.length === 5, 'speaker correction appends all applied corrections');
assertRule(
  corrected.profiles.find((profile) => profile.id === 'speaker-a')?.displayName === 'Host',
  'rename correction updates display name',
);
assertRule(
  corrected.profiles.find((profile) => profile.id === 'speaker-a')?.role === 'interviewer',
  'assign-role correction updates interviewer role',
);
assertRule(
  corrected.profiles.find((profile) => profile.id === 'speaker-b')?.role === 'guest',
  'assign-role correction updates guest role',
);
assertRule(
  corrected.profiles.some((profile) => profile.id === 'speaker-duplicate') === false,
  'merge correction removes duplicate speaker profile',
);
assertRule(
  corrected.segments.every((segment) => segment.speakerId !== 'speaker-duplicate'),
  'merge correction rewrites duplicate speaker segments',
);
assertRule(
  corrected.turns.every((turn) => turn.speakerId !== 'speaker-duplicate'),
  'merge correction rewrites duplicate speaker turns',
);
assertRule(
  corrected.turns.find((turn) => turn.id === 'turn-duplicate-answer')?.speakerId === 'speaker-b',
  'reassign-time-range keeps the corrected guest turn on replacement speaker',
);
assertRule(
  corrected.roleAssignments.some((assignment) =>
    assignment.speakerId === 'speaker-a' &&
      assignment.role === 'interviewer' &&
      assignment.source === 'manual'
  ),
  'assign-role correction records manual interviewer role assignment',
);
assertRule(
  corrected.roleAssignments.some((assignment) =>
    assignment.speakerId === 'speaker-b' &&
      assignment.role === 'guest' &&
      assignment.source === 'manual'
  ),
  'assign-role correction records manual guest role assignment',
);

const unknownSpeakerResult = applySmartCutSpeakerCorrections({
  speakerEvidence: baseSpeakerEvidence,
  corrections: [
    {
      id: 'correction-unknown',
      kind: 'assign-role',
      speakerIds: ['speaker-missing'],
      replacementRole: 'guest',
      reason: 'Should be ignored because speaker does not exist.',
      createdAt: '2026-05-14T00:00:05.000Z',
    },
  ],
});

assertRule(
  unknownSpeakerResult.corrections.length === 0,
  'speaker correction ignores corrections that reference unknown speakers',
);

if (failures.length > 0) {
  console.error(`blocked - smart cut speaker correction failures=${failures.length}`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`ok - smart cut speaker correction checks=${pass.length}`);
