#!/usr/bin/env node

import process from 'node:process';

import {
  SMART_CUT_STANDARD_VERSION,
  alignSmartCutTranscriptSpeakers,
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

const transcriptEvidence = {
  kind: 'transcript',
  schemaVersion: SMART_CUT_STANDARD_VERSION,
  provider: 'fixture-stt',
  language: 'en-US',
  segments: [
    {
      id: 'segment-1',
      startMs: 1_000,
      endMs: 18_000,
      text: 'Planning starts with a clear goal.',
      confidence: 0.96,
      language: 'en-US',
    },
    {
      id: 'segment-2',
      startMs: 18_300,
      endMs: 42_000,
      text: 'Then every activity and recommendation can support the same story.',
      confidence: 0.95,
      language: 'en-US',
    },
    {
      id: 'segment-filler',
      startMs: 42_300,
      endMs: 44_000,
      text: 'um',
      confidence: 0.88,
      language: 'en-US',
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
    { id: 'speaker-segment-teacher', speakerId: 'speaker-teacher', startMs: 900, endMs: 44_100, confidence: 0.97 },
  ],
  turns: [],
  overlappingSpeechGroups: [],
  roleAssignments: [
    {
      speakerId: 'speaker-teacher',
      role: 'teacher',
      confidence: 0.98,
      evidenceTurnIds: [],
      source: 'rule',
    },
  ],
  corrections: [],
};

const aligned = alignSmartCutTranscriptSpeakers({
  transcriptEvidence,
  speakerEvidence,
});

assertRule(aligned.ready === true, 'speaker alignment is ready for complete diarization coverage');
assertRule(aligned.report.ready === true, 'speaker alignment report is ready');
assertRule(aligned.report.turnCount === 2, 'speaker alignment merges adjacent real speech and keeps filler as separate turn');
assertRule(
  Array.isArray(aligned.report.turnIds) &&
    aligned.report.turnIds.join(',') === 'turn-speaker-teacher-1,turn-speaker-teacher-2',
  'speaker alignment report records deterministic aligned turn ids',
);
assertRule(aligned.report.alignedTranscriptSegmentCount === 3, 'speaker alignment counts aligned transcript segments');
assertRule(aligned.report.unalignedTranscriptSegmentCount === 0, 'speaker alignment has no unaligned transcript segments');
assertRule(aligned.speakerEvidence.turns[0]?.id === 'turn-speaker-teacher-1', 'speaker alignment creates stable deterministic turn ids');
assertRule(aligned.speakerEvidence.turns[0]?.speakerId === 'speaker-teacher', 'speaker alignment assigns speaker id from diarization overlap');
assertRule(
  aligned.speakerEvidence.turns[0]?.transcriptSegmentIds.join(',') === 'segment-1,segment-2',
  'speaker alignment preserves merged transcript segment ids',
);
assertRule(aligned.speakerEvidence.turns[0]?.isAnswerCandidate === true, 'speaker alignment marks real speech as answer candidate');
assertRule(aligned.speakerEvidence.turns[1]?.isBackchannel === true, 'speaker alignment marks filler as backchannel turn');
assertRule(
  aligned.speakerEvidence.roleAssignments[0]?.evidenceTurnIds.join(',') === 'turn-speaker-teacher-1,turn-speaker-teacher-2',
  'speaker alignment rewrites empty role assignment evidence ids to aligned turns',
);

const connectorBridgeAlignment = alignSmartCutTranscriptSpeakers({
  transcriptEvidence: {
    kind: 'transcript',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    provider: 'fixture-stt',
    language: 'en-US',
    segments: [
      {
        id: 'connector-bridge-setup',
        startMs: 22_000,
        endMs: 30_000,
        text: 'Why viewers scroll is simple. Because the opening hides the problem, people do not know why they should care.',
        confidence: 0.96,
        language: 'en-US',
      },
      {
        id: 'connector-bridge-payoff',
        startMs: 32_400,
        endMs: 41_000,
        text: 'So lead with the result and the retention payoff works.',
        confidence: 0.95,
        language: 'en-US',
      },
    ],
  },
  speakerEvidence: {
    ...speakerEvidence,
    segments: [
      { id: 'speaker-segment-connector-bridge', speakerId: 'speaker-teacher', startMs: 21_900, endMs: 41_100, confidence: 0.97 },
    ],
  },
});

assertRule(
  connectorBridgeAlignment.ready === true,
  'speaker alignment is ready for same-speaker connector bridge coverage',
);
assertRule(
  connectorBridgeAlignment.speakerEvidence.turns.length === 1,
  'speaker alignment bridges short same-speaker pauses when the next segment is a semantic connector',
);
assertRule(
  connectorBridgeAlignment.speakerEvidence.turns[0]?.transcriptSegmentIds.join(',') === 'connector-bridge-setup,connector-bridge-payoff',
  'speaker alignment connector bridge turn covers all transcript segment ids used by the semantic unit',
);

const transcriptWithDeclaredSpeaker = {
  ...transcriptEvidence,
  segments: [
    {
      id: 'declared-speaker-segment',
      startMs: 5_000,
      endMs: 12_000,
      text: 'The declared speaker id should be preserved.',
      confidence: 0.96,
      language: 'en-US',
      speakerId: 'speaker-teacher',
    },
  ],
};

const declaredSpeakerAlignment = alignSmartCutTranscriptSpeakers({
  transcriptEvidence: transcriptWithDeclaredSpeaker,
  speakerEvidence,
});

assertRule(declaredSpeakerAlignment.ready === true, 'declared transcript speaker id alignment is ready');
assertRule(
  declaredSpeakerAlignment.speakerEvidence.turns[0]?.speakerId === 'speaker-teacher',
  'speaker alignment honors transcript speaker id when it has reliable diarization overlap',
);

const shortSegmentAlignment = alignSmartCutTranscriptSpeakers({
  transcriptEvidence: {
    kind: 'transcript',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    provider: 'fixture-stt',
    language: 'en-US',
    segments: [
      {
        id: 'short-covered-segment',
        startMs: 271_360,
        endMs: 271_500,
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
      { id: 'speaker-segment-short-covered', speakerId: 'speaker-teacher', startMs: 271_360, endMs: 271_500, confidence: 0.97 },
    ],
  },
});

assertRule(
  shortSegmentAlignment.ready === true,
  'speaker alignment accepts fully covered short STT speech fragments',
);
assertRule(
  shortSegmentAlignment.report.alignedTranscriptSegmentCount === 1 &&
    shortSegmentAlignment.report.unalignedTranscriptSegmentCount === 0,
  'short fully covered STT speech fragment is counted as aligned',
);
assertRule(
  shortSegmentAlignment.speakerEvidence.turns[0]?.transcriptSegmentIds.join(',') === 'short-covered-segment',
  'short fully covered STT speech fragment remains traceable to its speaker turn',
);

const unaligned = alignSmartCutTranscriptSpeakers({
  transcriptEvidence,
  speakerEvidence: {
    ...speakerEvidence,
    segments: [],
  },
});

assertRule(unaligned.ready === false, 'speaker alignment fails closed when diarization coverage is missing');
assertRule(unaligned.report.ready === false, 'speaker alignment report fails closed when diarization coverage is missing');
assertRule(
  unaligned.report.blockers.some((blocker) => blocker.code === 'TRANSCRIPT_SEGMENT_WITHOUT_SPEAKER_OVERLAP'),
  'speaker alignment reports missing speaker overlap blocker',
);
assertRule(unaligned.speakerEvidence.turns.length === 0, 'speaker alignment does not generate turns without reliable diarization overlap');

const multiSpeakerTranscript = {
  kind: 'transcript',
  schemaVersion: SMART_CUT_STANDARD_VERSION,
  provider: 'fixture-stt',
  language: 'en-US',
  segments: [
    {
      id: 'question',
      startMs: 2_000,
      endMs: 10_000,
      text: 'When should families start planning?',
      confidence: 0.95,
    },
    {
      id: 'answer',
      startMs: 10_300,
      endMs: 42_000,
      text: 'They should start early because the evidence needs time to accumulate.',
      confidence: 0.96,
    },
  ],
};

const multiSpeakerEvidence = {
  kind: 'speaker',
  schemaVersion: SMART_CUT_STANDARD_VERSION,
  profiles: [
    { id: 'speaker-host', displayName: 'Host', role: 'interviewer', confidence: 0.95, source: 'diarization' },
    { id: 'speaker-guest', displayName: 'Guest', role: 'guest', confidence: 0.96, source: 'diarization' },
  ],
  segments: [
    { id: 'speaker-segment-host', speakerId: 'speaker-host', startMs: 2_000, endMs: 10_000, confidence: 0.95 },
    { id: 'speaker-segment-guest', speakerId: 'speaker-guest', startMs: 10_300, endMs: 42_000, confidence: 0.96 },
  ],
  turns: [],
  overlappingSpeechGroups: [],
  roleAssignments: [
    { speakerId: 'speaker-host', role: 'interviewer', confidence: 0.95, evidenceTurnIds: [], source: 'rule' },
    { speakerId: 'speaker-guest', role: 'guest', confidence: 0.96, evidenceTurnIds: [], source: 'rule' },
  ],
  corrections: [],
};

const multiSpeakerAlignment = alignSmartCutTranscriptSpeakers({
  transcriptEvidence: multiSpeakerTranscript,
  speakerEvidence: multiSpeakerEvidence,
});

assertRule(multiSpeakerAlignment.ready === true, 'multi-speaker alignment is ready');
assertRule(multiSpeakerAlignment.speakerEvidence.turns.length === 2, 'multi-speaker alignment keeps distinct speaker turns');
assertRule(multiSpeakerAlignment.speakerEvidence.turns[0]?.isQuestion === true, 'multi-speaker alignment detects question turn');
assertRule(multiSpeakerAlignment.speakerEvidence.turns[1]?.isAnswerCandidate === true, 'multi-speaker alignment detects answer turn');
assertRule(
  multiSpeakerAlignment.speakerEvidence.roleAssignments[0]?.evidenceTurnIds.join(',') === 'turn-speaker-host-1',
  'multi-speaker alignment assigns host role evidence to host turn',
);
assertRule(
  multiSpeakerAlignment.speakerEvidence.roleAssignments[1]?.evidenceTurnIds.join(',') === 'turn-speaker-guest-1',
  'multi-speaker alignment assigns guest role evidence to guest turn',
);

if (failures.length > 0) {
  console.error(`blocked - smart cut speaker alignment failures=${failures.length}`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`ok - smart cut speaker alignment checks=${pass.length}`);
