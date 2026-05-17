#!/usr/bin/env node

import process from 'node:process';

import {
  SMART_CUT_STANDARD_VERSION,
  buildSpeechSemanticContentUnits,
  buildSpeechSemanticSpeakerTurns,
  createSmartCutSpeechFirstExecutionPackageFromProviders,
  createSmartCutSpeechFirstExecutionPackage,
  createSpeechSemanticSlicePlan,
  validateSmartCutCandidatePlan,
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
  language: 'zh-CN',
  segments: [
    {
      id: 'segment-1',
      startMs: 1_000,
      endMs: 12_000,
      text: '为什么很多学生申请失败？核心原因是规划太晚。',
      confidence: 0.96,
      language: 'zh-CN',
      speakerId: 'speaker-teacher',
    },
    {
      id: 'segment-2',
      startMs: 12_300,
      endMs: 31_000,
      text: '如果从九年级开始准备，活动、成绩和文书就能形成连续的故事。',
      confidence: 0.95,
      language: 'zh-CN',
      speakerId: 'speaker-teacher',
    },
    {
      id: 'segment-filler',
      startMs: 31_200,
      endMs: 34_000,
      text: '嗯嗯，啊。',
      confidence: 0.9,
      language: 'zh-CN',
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
      displayName: '张老师',
      role: 'teacher',
      confidence: 0.98,
      source: 'diarization',
    },
  ],
  segments: [
    {
      speakerId: 'speaker-teacher',
      startMs: 900,
      endMs: 34_100,
      confidence: 0.97,
    },
  ],
  turns: [
    {
      id: 'turn-1',
      speakerId: 'speaker-teacher',
      startMs: 1_000,
      endMs: 31_000,
      sentenceIds: ['sentence-1', 'sentence-2'],
      transcriptSegmentIds: ['segment-1', 'segment-2'],
      text: '为什么很多学生申请失败？核心原因是规划太晚。如果从九年级开始准备，活动、成绩和文书就能形成连续的故事。',
      isQuestion: false,
      isAnswerCandidate: true,
      isInterruption: false,
      isBackchannel: false,
      topicIds: ['topic-application-planning'],
      risks: [],
    },
    {
      id: 'turn-filler',
      speakerId: 'speaker-teacher',
      startMs: 31_200,
      endMs: 34_000,
      sentenceIds: ['sentence-filler'],
      transcriptSegmentIds: ['segment-filler'],
      text: '嗯嗯，啊。',
      isQuestion: false,
      isAnswerCandidate: false,
      isInterruption: false,
      isBackchannel: true,
      topicIds: ['topic-application-planning'],
      risks: ['low-information'],
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

const teacherUnits = buildSpeechSemanticContentUnits({
  transcriptEvidence,
  speakerEvidence,
});

assertRule(teacherUnits.length === 2, 'teacher fixture builds one content unit and one low-information unit');
assertRule(teacherUnits[0]?.id === 'unit-1', 'content unit id is stable from the standard content unit builder');
assertRule(teacherUnits[0]?.speakerIds.includes('speaker-teacher') === true, 'content unit preserves speaker id');
assertRule(
  teacherUnits[0]?.transcriptSegmentIds.join(',') === 'segment-1,segment-2',
  'content unit preserves transcript segment ids',
);
assertRule(
  (teacherUnits[0]?.completenessScore ?? 0) >= 0.9 &&
    (teacherUnits[0]?.continuityScore ?? 0) >= 0.9 &&
    (teacherUnits[0]?.publishabilityScore ?? 0) >= 0.85,
  'teacher semantic content unit has strong scores',
);
assertRule(
  (teacherUnits[1]?.publishabilityScore ?? 1) < 0.68,
  'low-information filler unit is scored below publishable threshold',
);

const teacherPlan = createSpeechSemanticSlicePlan({
  sourceMediaId: 'media-teacher',
  sourceDurationMs: 90_000,
  presetId: 'teacher-talking-head-single',
  transcriptEvidence,
  speakerEvidence,
});

assertRule(teacherPlan.presetId === 'teacher-talking-head-single', 'speech semantic plan keeps product preset id');
assertRule(teacherPlan.candidates.length === 1, 'speech semantic plan filters filler and creates one publishable candidate');
assertRule(teacherPlan.candidates[0]?.slicerId === 'speech-semantic', 'candidate is produced by speech semantic slicer');
assertRule(
  teacherPlan.candidates[0]?.unitIds.join(',') === 'unit-1',
  'candidate references content unit ids instead of raw time-only boundaries',
);
assertRule(
  teacherPlan.candidates[0]?.startMs === 1_000 && teacherPlan.candidates[0]?.endMs === 31_000,
  'candidate is snapped to semantic unit boundary',
);

const teacherValidation = validateSmartCutCandidatePlan({
  presetId: 'teacher-talking-head-single',
  sourceDurationMs: 90_000,
  contentUnits: teacherUnits,
  candidates: teacherPlan.candidates,
});

assertRule(teacherValidation.ready === true, 'teacher semantic plan passes candidate validation');
assertRule(teacherValidation.blockers.length === 0, 'teacher semantic plan has no validation blockers');

const durationBoundSegments = Array.from({ length: 8 }, (_, index) => ({
  id: `duration-bound-segment-${index + 1}`,
  startMs: index * 12_000,
  endMs: index * 12_000 + 11_500,
  text: `Complete teaching point ${index + 1} states the problem, explains the cause, and gives a clear result for the viewer.`,
  confidence: 0.95,
  language: 'en-US',
  speakerId: 'speaker-teacher',
}));
const durationBoundTranscriptEvidence = {
  kind: 'transcript',
  schemaVersion: SMART_CUT_STANDARD_VERSION,
  provider: 'fixture-stt',
  language: 'en-US',
  segments: durationBoundSegments,
};
const durationBoundSpeakerEvidence = {
  ...speakerEvidence,
  segments: [
    { speakerId: 'speaker-teacher', startMs: 0, endMs: 96_000, confidence: 0.97 },
  ],
  turns: [
    {
      id: 'duration-bound-turn',
      speakerId: 'speaker-teacher',
      startMs: 0,
      endMs: 95_500,
      sentenceIds: durationBoundSegments.map((segment) => `sentence-${segment.id}`),
      transcriptSegmentIds: durationBoundSegments.map((segment) => segment.id),
      text: durationBoundSegments.map((segment) => segment.text).join(' '),
      isQuestion: false,
      isAnswerCandidate: true,
      isInterruption: false,
      isBackchannel: false,
      topicIds: ['topic-duration-bound'],
      risks: [],
    },
  ],
};
const durationBoundPlan = createSpeechSemanticSlicePlan({
  sourceMediaId: 'media-duration-bound',
  sourceDurationMs: 120_000,
  presetId: 'teacher-talking-head-single',
  transcriptEvidence: durationBoundTranscriptEvidence,
  speakerEvidence: durationBoundSpeakerEvidence,
  maximumCandidateDurationMs: 60_000,
});

assertRule(
  durationBoundPlan.candidates.length > 1,
  'speech semantic plan splits long same-speaker speech into multiple duration-bound candidates',
);
assertRule(
  durationBoundPlan.candidates.every((candidate) => candidate.endMs - candidate.startMs <= 60_000),
  'speech semantic duration-bound candidates stay inside requested maximum duration',
);

const gapSensitiveSegments = [
  {
    id: 'gap-sensitive-segment-1',
    startMs: 0,
    endMs: 12_000,
    text: 'First complete teaching idea explains the business problem and gives a concrete operating example.',
    confidence: 0.95,
    language: 'en-US',
    speakerId: 'speaker-teacher',
  },
  {
    id: 'gap-sensitive-segment-2',
    startMs: 16_200,
    endMs: 29_000,
    text: 'Second complete teaching idea continues the same topic and explains the recommended workflow.',
    confidence: 0.95,
    language: 'en-US',
    speakerId: 'speaker-teacher',
  },
  {
    id: 'gap-sensitive-segment-3',
    startMs: 33_200,
    endMs: 46_000,
    text: 'Third complete teaching idea finishes the same workflow with the expected commercial outcome.',
    confidence: 0.95,
    language: 'en-US',
    speakerId: 'speaker-teacher',
  },
];
const gapSensitiveTranscriptEvidence = {
  kind: 'transcript',
  schemaVersion: SMART_CUT_STANDARD_VERSION,
  provider: 'fixture-stt',
  language: 'en-US',
  segments: gapSensitiveSegments,
};
const gapSensitiveSpeakerEvidence = {
  ...speakerEvidence,
  language: 'en-US',
  profiles: [
    {
      id: 'speaker-teacher',
      displayName: 'Teacher',
      role: 'teacher',
      confidence: 0.98,
      source: 'diarization',
    },
  ],
  segments: [
    { speakerId: 'speaker-teacher', startMs: 0, endMs: 46_000, confidence: 0.97 },
  ],
  turns: gapSensitiveSegments.map((segment, index) => ({
    id: `gap-sensitive-turn-${index + 1}`,
    speakerId: 'speaker-teacher',
    startMs: segment.startMs,
    endMs: segment.endMs,
    sentenceIds: [`sentence-${segment.id}`],
    transcriptSegmentIds: [segment.id],
    text: segment.text,
    isQuestion: false,
    isAnswerCandidate: true,
    isInterruption: false,
    isBackchannel: false,
    topicIds: ['topic-gap-sensitive-continuity'],
    risks: [],
  })),
  roleAssignments: [
    {
      speakerId: 'speaker-teacher',
      role: 'teacher',
      confidence: 0.98,
      evidenceTurnIds: ['gap-sensitive-turn-1', 'gap-sensitive-turn-2', 'gap-sensitive-turn-3'],
      source: 'rule',
    },
  ],
  overlappingSpeechGroups: [],
  corrections: [],
};
const defaultGapSensitivePlan = createSpeechSemanticSlicePlan({
  sourceMediaId: 'media-gap-sensitive-default',
  sourceDurationMs: 60_000,
  presetId: 'course-knowledge-clips',
  transcriptEvidence: gapSensitiveTranscriptEvidence,
  speakerEvidence: gapSensitiveSpeakerEvidence,
  maximumCandidateDurationMs: 60_000,
});
const maximizedGapSensitivePlan = createSpeechSemanticSlicePlan({
  sourceMediaId: 'media-gap-sensitive-maximized',
  sourceDurationMs: 60_000,
  presetId: 'course-knowledge-clips',
  transcriptEvidence: gapSensitiveTranscriptEvidence,
  speakerEvidence: gapSensitiveSpeakerEvidence,
  maximumCandidateDurationMs: 60_000,
  maximumCandidateGapMs: 8_000,
});

assertRule(
  defaultGapSensitivePlan.candidates.length === 3,
  'default speech semantic candidate gap keeps separately paused content units split',
);
assertRule(
  maximizedGapSensitivePlan.candidates.length === 1,
  'maximized speech semantic candidate gap merges continuous complete content units into one stronger segment',
);
assertRule(
  maximizedGapSensitivePlan.candidates[0]?.unitIds.join(',') === 'unit-1,unit-2,unit-3',
  'maximized speech semantic candidate preserves every merged content unit id for LLM review',
);
assertRule(
  (maximizedGapSensitivePlan.candidates[0]?.endMs ?? 0) - (maximizedGapSensitivePlan.candidates[0]?.startMs ?? 0) <= 60_000,
  'maximized speech semantic candidate still respects requested maximum duration',
);

const interviewTranscriptEvidence = {
  kind: 'transcript',
  schemaVersion: SMART_CUT_STANDARD_VERSION,
  provider: 'fixture-stt',
  language: 'zh-CN',
  segments: [
    {
      id: 'segment-question',
      startMs: 2_000,
      endMs: 10_000,
      text: '家长最应该什么时候开始规划？',
      confidence: 0.95,
      speakerId: 'speaker-host',
    },
    {
      id: 'segment-answer',
      startMs: 10_300,
      endMs: 72_000,
      text: '我建议至少提前三年，因为选课、活动和推荐信都需要连续积累，最后才能讲出可信的申请故事。',
      confidence: 0.96,
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
      displayName: '主持人',
      role: 'interviewer',
      confidence: 0.95,
      source: 'diarization',
    },
    {
      id: 'speaker-guest',
      displayName: '张老师',
      role: 'guest',
      confidence: 0.96,
      source: 'diarization',
    },
  ],
  segments: [
    {
      speakerId: 'speaker-host',
      startMs: 2_000,
      endMs: 10_000,
      confidence: 0.95,
    },
    {
      speakerId: 'speaker-guest',
      startMs: 10_300,
      endMs: 72_000,
      confidence: 0.96,
    },
  ],
  turns: [
    {
      id: 'turn-question',
      speakerId: 'speaker-host',
      startMs: 2_000,
      endMs: 10_000,
      sentenceIds: ['sentence-question'],
      transcriptSegmentIds: ['segment-question'],
      text: '家长最应该什么时候开始规划？',
      isQuestion: true,
      isAnswerCandidate: false,
      isInterruption: false,
      isBackchannel: false,
      topicIds: ['topic-application-planning'],
      risks: [],
    },
    {
      id: 'turn-answer',
      speakerId: 'speaker-guest',
      startMs: 10_300,
      endMs: 72_000,
      sentenceIds: ['sentence-answer'],
      transcriptSegmentIds: ['segment-answer'],
      text: '我建议至少提前三年，因为选课、活动和推荐信都需要连续积累，最后才能讲出可信的申请故事。',
      isQuestion: false,
      isAnswerCandidate: true,
      isInterruption: false,
      isBackchannel: false,
      topicIds: ['topic-application-planning'],
      risks: [],
    },
  ],
  overlappingSpeechGroups: [],
  roleAssignments: [
    {
      speakerId: 'speaker-host',
      role: 'interviewer',
      confidence: 0.95,
      evidenceTurnIds: ['turn-question'],
      source: 'rule',
    },
    {
      speakerId: 'speaker-guest',
      role: 'guest',
      confidence: 0.96,
      evidenceTurnIds: ['turn-answer'],
      source: 'rule',
    },
  ],
  corrections: [],
};

const interviewPlan = createSpeechSemanticSlicePlan({
  sourceMediaId: 'media-interview',
  sourceDurationMs: 180_000,
  presetId: 'interview-one-question-one-answer',
  transcriptEvidence: interviewTranscriptEvidence,
  speakerEvidence: interviewSpeakerEvidence,
});

assertRule(interviewPlan.candidates.length === 1, 'interview plan creates one complete Q/A candidate');
assertRule(interviewPlan.candidates[0]?.slicerId === 'dialogue-qa', 'interview Q/A candidate is attributed to dialogue QA strategy');
assertRule(
  interviewPlan.candidates[0]?.unitIds.join(',') === 'unit-1,unit-2',
  'interview candidate preserves question and answer units together',
);
assertRule(
  interviewPlan.candidates[0]?.startMs === 2_000 && interviewPlan.candidates[0]?.endMs === 72_000,
  'interview candidate covers full Q/A semantic range',
);

const interviewUnits = buildSpeechSemanticContentUnits({
  transcriptEvidence: interviewTranscriptEvidence,
  speakerEvidence: interviewSpeakerEvidence,
});
const interviewValidation = validateSmartCutCandidatePlan({
  presetId: 'interview-one-question-one-answer',
  sourceDurationMs: 180_000,
  contentUnits: interviewUnits,
  candidates: interviewPlan.candidates,
});

assertRule(interviewValidation.ready === true, 'interview Q/A plan passes validation');

const generatedTurns = buildSpeechSemanticSpeakerTurns({
  transcriptEvidence: interviewTranscriptEvidence,
  speakerEvidence: {
    ...interviewSpeakerEvidence,
    turns: [],
  },
});

assertRule(generatedTurns.length === 2, 'speaker turns can be generated from transcript and diarization segments');
assertRule(generatedTurns[0]?.speakerId === 'speaker-host', 'generated question turn keeps host speaker id');
assertRule(generatedTurns[0]?.isQuestion === true, 'generated host turn detects question');
assertRule(generatedTurns[1]?.speakerId === 'speaker-guest', 'generated answer turn keeps guest speaker id');
assertRule(generatedTurns[1]?.isAnswerCandidate === true, 'generated guest turn detects answer candidate');

const missingTurnPlan = createSpeechSemanticSlicePlan({
  sourceMediaId: 'media-interview-missing-turns',
  sourceDurationMs: 180_000,
  presetId: 'interview-one-question-one-answer',
  transcriptEvidence: interviewTranscriptEvidence,
  speakerEvidence: {
    ...interviewSpeakerEvidence,
    turns: [],
  },
});

assertRule(missingTurnPlan.candidates.length === 0, 'planner fails closed when upstream speaker turns are missing');
assertRule(
  missingTurnPlan.contentUnitBuildReport.ready === false &&
    missingTurnPlan.contentUnitBuildReport.blockers.some((blocker) => blocker.code === 'CONTENT_UNIT_WITHOUT_SPEAKER_TURN'),
  'planner exposes content unit build blocker for missing speaker turns',
);

const noTurnFillerPlan = createSpeechSemanticSlicePlan({
  sourceMediaId: 'media-no-turn-filler',
  sourceDurationMs: 90_000,
  presetId: 'teacher-talking-head-single',
  transcriptEvidence: {
    kind: 'transcript',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    provider: 'fixture-stt',
    language: 'en-US',
    segments: [
      {
        id: 'no-turn-content-1',
        startMs: 1_000,
        endMs: 20_000,
        text: 'Planning starts with a clear goal.',
        confidence: 0.96,
        language: 'en-US',
        speakerId: 'speaker-teacher',
      },
      {
        id: 'no-turn-content-2',
        startMs: 20_200,
        endMs: 44_000,
        text: 'Every activity and recommendation should support the same story.',
        confidence: 0.96,
        language: 'en-US',
        speakerId: 'speaker-teacher',
      },
      {
        id: 'no-turn-filler',
        startMs: 44_200,
        endMs: 46_000,
        text: 'um',
        confidence: 0.88,
        language: 'en-US',
        speakerId: 'speaker-teacher',
      },
    ],
  },
  speakerEvidence: {
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
      { id: 'speaker-segment-no-turn-teacher', speakerId: 'speaker-teacher', startMs: 900, endMs: 46_100, confidence: 0.98 },
    ],
    turns: [
      {
        id: 'no-turn-main',
        speakerId: 'speaker-teacher',
        startMs: 1_000,
        endMs: 44_000,
        sentenceIds: ['no-turn-sentence-1', 'no-turn-sentence-2'],
        transcriptSegmentIds: ['no-turn-content-1', 'no-turn-content-2'],
        text: 'Planning starts with a clear goal. Every activity and recommendation should support the same story.',
        isQuestion: false,
        isAnswerCandidate: true,
        isInterruption: false,
        isBackchannel: false,
        topicIds: ['topic-planning'],
        risks: [],
      },
      {
        id: 'no-turn-filler-turn',
        speakerId: 'speaker-teacher',
        startMs: 44_200,
        endMs: 46_000,
        sentenceIds: ['no-turn-sentence-filler'],
        transcriptSegmentIds: ['no-turn-filler'],
        text: 'um',
        isQuestion: false,
        isAnswerCandidate: false,
        isInterruption: false,
        isBackchannel: true,
        topicIds: ['topic-planning'],
        risks: ['low-information'],
      },
    ],
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
  },
});

assertRule(noTurnFillerPlan.contentUnitBuildReport?.ready === true, 'speech semantic plan exposes ready standard content unit build report');
assertRule(noTurnFillerPlan.contentUnitBuildReport?.unitCount === 2, 'speech semantic plan uses standard content unit builder');
assertRule(
  noTurnFillerPlan.contentUnitBuildReport?.publishableUnitCount === 1 &&
    noTurnFillerPlan.contentUnitBuildReport?.lowInformationUnitCount === 1,
  'speech semantic build report separates publishable units from low-information audit units',
);
assertRule(
  noTurnFillerPlan.candidates[0]?.unitIds.join(',') === 'unit-1',
  'speech semantic plan does not merge low-information filler into publishable candidate',
);
assertRule(
  noTurnFillerPlan.candidates[0]?.endMs === 44_000,
  'speech semantic candidate boundary ends at the complete semantic unit before filler',
);

const longInterviewPlanFixture = {
  transcriptEvidence: {
    kind: 'transcript',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    provider: 'fixture-stt',
    language: 'en-US',
    segments: [
      {
        id: 'long-question',
        startMs: 5_000,
        endMs: 12_000,
        text: 'Why should families start planning early?',
        confidence: 0.95,
        speakerId: 'speaker-host',
      },
      {
        id: 'long-answer-1',
        startMs: 12_200,
        endMs: 48_000,
        text: 'Early planning keeps courses, activities, and goals consistent instead of assembling materials at the last minute.',
        confidence: 0.96,
        speakerId: 'speaker-guest',
      },
      {
        id: 'long-answer-2',
        startMs: 48_200,
        endMs: 78_000,
        text: 'It also gives recommendation letters and essays real evidence, because teachers can see long-term commitment.',
        confidence: 0.96,
        speakerId: 'speaker-guest',
      },
    ],
  },
  speakerEvidence: {
    kind: 'speaker',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    profiles: [
      {
        id: 'speaker-host',
        displayName: 'Host',
        role: 'interviewer',
        confidence: 0.95,
        source: 'diarization',
      },
      {
        id: 'speaker-guest',
        displayName: 'Teacher Zhang',
        role: 'guest',
        confidence: 0.96,
        source: 'diarization',
      },
    ],
    segments: [
      { id: 'speaker-segment-long-host', speakerId: 'speaker-host', startMs: 5_000, endMs: 12_000, confidence: 0.95 },
      { id: 'speaker-segment-long-guest', speakerId: 'speaker-guest', startMs: 12_200, endMs: 78_000, confidence: 0.96 },
    ],
    turns: [
      {
        id: 'long-turn-question',
        speakerId: 'speaker-host',
        startMs: 5_000,
        endMs: 12_000,
        sentenceIds: ['long-sentence-question'],
        transcriptSegmentIds: ['long-question'],
        text: 'Why should families start planning early?',
        isQuestion: true,
        isAnswerCandidate: false,
        isInterruption: false,
        isBackchannel: false,
        topicIds: ['topic-planning'],
        risks: [],
      },
      {
        id: 'long-turn-answer-1',
        speakerId: 'speaker-guest',
        startMs: 12_200,
        endMs: 48_000,
        sentenceIds: ['long-sentence-answer-1'],
        transcriptSegmentIds: ['long-answer-1'],
        text: 'Early planning keeps courses, activities, and goals consistent instead of assembling materials at the last minute.',
        isQuestion: false,
        isAnswerCandidate: true,
        isInterruption: false,
        isBackchannel: false,
        topicIds: ['topic-planning'],
        risks: [],
      },
      {
        id: 'long-turn-answer-2',
        speakerId: 'speaker-guest',
        startMs: 48_200,
        endMs: 78_000,
        sentenceIds: ['long-sentence-answer-2'],
        transcriptSegmentIds: ['long-answer-2'],
        text: 'It also gives recommendation letters and essays real evidence, because teachers can see long-term commitment.',
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
  },
};

const longInterviewPlan = createSpeechSemanticSlicePlan({
  sourceMediaId: 'media-long-interview',
  sourceDurationMs: 420_000,
  presetId: 'long-interview-matrix',
  transcriptEvidence: longInterviewPlanFixture.transcriptEvidence,
  speakerEvidence: longInterviewPlanFixture.speakerEvidence,
});

assertRule(longInterviewPlan.candidates.length === 1, 'long interview plan creates one matrix candidate');
assertRule(longInterviewPlan.candidates[0]?.slicerId === 'dialogue-qa', 'long interview matrix candidate is attributed to dialogue QA strategy');
assertRule(
  longInterviewPlan.candidates[0]?.unitIds.join(',') === 'unit-1,unit-2',
  'long interview candidate keeps a complete question and merged answer content unit to satisfy duration',
);
assertRule(
  (longInterviewPlan.candidates[0]?.endMs ?? 0) - (longInterviewPlan.candidates[0]?.startMs ?? 0) >= 60_000,
  'long interview candidate satisfies 60s minimum without raw time padding',
);
const longInterviewValidation = validateSmartCutCandidatePlan({
  presetId: 'long-interview-matrix',
  sourceDurationMs: 420_000,
  contentUnits: buildSpeechSemanticContentUnits({
    transcriptEvidence: longInterviewPlanFixture.transcriptEvidence,
    speakerEvidence: longInterviewPlanFixture.speakerEvidence,
  }),
  candidates: longInterviewPlan.candidates,
});
assertRule(longInterviewValidation.ready === true, 'long interview matrix plan passes preset validation');

assertRule(
  typeof createSmartCutSpeechFirstExecutionPackage === 'function',
  'speech semantic standard exposes default speech-first execution package orchestration',
);
assertRule(
  typeof createSmartCutSpeechFirstExecutionPackageFromProviders === 'function',
  'speech semantic standard exposes provider-driven speech-first execution orchestration',
);

if (typeof createSmartCutSpeechFirstExecutionPackage === 'function') {
  const speechFirstSourceMedia = {
    id: 'media-speech-first-orchestration',
    uri: 'file:///speech-first.mp4',
    mediaKind: 'talking-head',
    durationMs: 90_000,
    width: 1080,
    height: 1920,
    frameRateFps: 30,
  };
  const speechFirstTranscriptEvidence = {
    kind: 'transcript',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    provider: 'fixture-stt',
    language: 'en-US',
    segments: [
      {
        id: 'orchestration-segment-1',
        startMs: 1_000,
        endMs: 20_000,
        text: 'Planning starts with a clear goal.',
        confidence: 0.96,
        language: 'en-US',
        speakerId: 'speaker-teacher',
      },
      {
        id: 'orchestration-segment-2',
        startMs: 20_200,
        endMs: 44_000,
        text: 'Every activity and recommendation should support the same story.',
        confidence: 0.96,
        language: 'en-US',
        speakerId: 'speaker-teacher',
      },
    ],
  };
  const speechFirstSpeakerEvidence = {
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
      { id: 'speaker-segment-orchestration-teacher', speakerId: 'speaker-teacher', startMs: 900, endMs: 44_100, confidence: 0.98 },
    ],
    turns: [],
    overlappingSpeechGroups: [],
    roleAssignments: [],
    corrections: [],
  };

  const orchestratedSpeechFirstPackage = createSmartCutSpeechFirstExecutionPackage({
    runId: 'run-speech-first-orchestration',
    sourceMedia: speechFirstSourceMedia,
    presetId: 'teacher-talking-head-single',
    transcriptEvidence: speechFirstTranscriptEvidence,
    speakerEvidence: speechFirstSpeakerEvidence,
    llmReviewModel: 'fixture-llm',
    rawLlmReview: {
      rankedCandidateIds: ['speech-semantic-candidate-1'],
      referencedUnitIds: ['unit-1'],
      reviewNotes: ['speech-semantic-candidate-1 preserves the complete setup and payoff.'],
    },
  });

  assertRule(orchestratedSpeechFirstPackage.ready === true, 'speech-first orchestration returns a ready package');
  assertRule(orchestratedSpeechFirstPackage.speakerAlignment.report.ready === true, 'speech-first orchestration runs transcript-speaker alignment');
  assertRule(
    orchestratedSpeechFirstPackage.speakerAlignment.speakerEvidence.turns.map((turn) => turn.id).join(',') === 'turn-speaker-teacher-1',
    'speech-first orchestration creates deterministic aligned speaker turns before content units',
  );
  assertRule(orchestratedSpeechFirstPackage.plan.contentUnitBuildReport.ready === true, 'speech-first orchestration builds standard content units');
  assertRule(
    orchestratedSpeechFirstPackage.plan.candidates[0]?.unitIds.join(',') === 'unit-1',
    'speech-first orchestration creates content-unit-backed candidates',
  );
  assertRule(orchestratedSpeechFirstPackage.llmReviewReport.ready === true, 'speech-first orchestration normalizes LLM review evidence');
  assertRule(orchestratedSpeechFirstPackage.executionPackage.ready === true, 'speech-first orchestration creates ready execution package');
  assertRule(orchestratedSpeechFirstPackage.auditTrace.ready === true, 'speech-first orchestration creates ready audit trace');
  assertRule(
    orchestratedSpeechFirstPackage.auditTrace.summary.llmRankedCandidateCount === 1,
    'speech-first orchestration audit trace records LLM ranked candidate count',
  );
  assertRule(
    orchestratedSpeechFirstPackage.executionPackage.nativeRequests.length === 5,
    'speech-first orchestration creates the full native validation/filter/render request sequence',
  );

  const rawTimestampSpeechFirstPackage = createSmartCutSpeechFirstExecutionPackage({
    runId: 'run-speech-first-raw-timestamp-llm',
    sourceMedia: speechFirstSourceMedia,
    presetId: 'teacher-talking-head-single',
    transcriptEvidence: speechFirstTranscriptEvidence,
    speakerEvidence: speechFirstSpeakerEvidence,
    llmReviewModel: 'fixture-llm',
    rawLlmReview: {
      rankedCandidateIds: ['speech-semantic-candidate-1'],
      referencedUnitIds: ['unit-1'],
      cuts: [{ startMs: 1_000, endMs: 44_000 }],
    },
  });

  assertRule(rawTimestampSpeechFirstPackage.ready === false, 'speech-first orchestration fails closed on raw timestamp LLM output');
  assertRule(
    rawTimestampSpeechFirstPackage.blockers.filter((blocker) => blocker.source === 'llm-review' && blocker.code === 'LLM_RAW_TIME_RANGE_REJECTED').length === 1,
    'speech-first orchestration de-duplicates top-level raw timestamp blockers',
  );
  assertRule(
    rawTimestampSpeechFirstPackage.blockers.some((blocker) => blocker.source === 'llm-review' && blocker.code === 'LLM_RAW_TIME_RANGE_REJECTED'),
    'speech-first orchestration exposes raw timestamp LLM blocker',
  );
  assertRule(rawTimestampSpeechFirstPackage.auditTrace.ready === false, 'speech-first raw timestamp package creates blocked audit trace');
  assertRule(
    rawTimestampSpeechFirstPackage.executionPackage.filterPlan === undefined &&
      rawTimestampSpeechFirstPackage.executionPackage.renderContract === undefined,
    'speech-first raw timestamp package stops before filters and render',
  );
  assertRule(
    rawTimestampSpeechFirstPackage.executionPackage.nativeRequests.length === 1,
    'speech-first raw timestamp package only creates candidate validation native request',
  );

  const failedAlignmentSpeechFirstPackage = createSmartCutSpeechFirstExecutionPackage({
    runId: 'run-speech-first-failed-alignment',
    sourceMedia: speechFirstSourceMedia,
    presetId: 'teacher-talking-head-single',
    transcriptEvidence: speechFirstTranscriptEvidence,
    speakerEvidence: {
      ...speechFirstSpeakerEvidence,
      segments: [],
    },
    llmReviewModel: 'fixture-llm',
    rawLlmReview: {
      rankedCandidateIds: ['speech-semantic-candidate-1'],
      referencedUnitIds: ['unit-1'],
    },
  });

  assertRule(failedAlignmentSpeechFirstPackage.ready === false, 'speech-first orchestration fails closed on speaker alignment failure');
  assertRule(
    failedAlignmentSpeechFirstPackage.blockers.filter((blocker) => blocker.source === 'speaker-alignment' && blocker.code === 'NO_SPEAKER_SEGMENTS').length === 1,
    'speech-first orchestration de-duplicates top-level speaker alignment blockers',
  );
  assertRule(
    failedAlignmentSpeechFirstPackage.stageStatuses.speakerAlignment === 'blocked',
    'speech-first orchestration marks speaker alignment stage blocked',
  );
  assertRule(
    failedAlignmentSpeechFirstPackage.blockers.some((blocker) => blocker.source === 'speaker-alignment' && blocker.code === 'NO_SPEAKER_SEGMENTS'),
    'speech-first orchestration exposes speaker alignment blocker',
  );
  assertRule(
    failedAlignmentSpeechFirstPackage.executionPackage.filterPlan === undefined &&
      failedAlignmentSpeechFirstPackage.executionPackage.renderContract === undefined,
    'speech-first failed alignment package stops before filters and render',
  );

  if (typeof createSmartCutSpeechFirstExecutionPackageFromProviders === 'function') {
    const providerContext = {
      runId: 'run-provider-speech-first',
      presetId: 'teacher-talking-head-single',
      sourceMedia: speechFirstSourceMedia,
      log: {
        info() {},
        warn() {},
        error() {},
      },
    };
    const sttProvider = {
      id: 'fixture-stt-provider',
      async transcribe(input) {
        assertRule(input.context.sourceMedia.id === speechFirstSourceMedia.id, 'provider orchestration passes runtime context into STT provider');
        assertRule(input.language === 'auto', 'provider orchestration defaults STT language to auto');
        return speechFirstTranscriptEvidence;
      },
    };
    const diarizationProvider = {
      id: 'fixture-diarization-provider',
      async diarize(input) {
        assertRule(
          input.transcriptEvidence?.segments[0]?.id === 'orchestration-segment-1',
          'provider orchestration passes transcript evidence into speaker diarization provider',
        );
        return speechFirstSpeakerEvidence;
      },
    };
    const llmReviewer = {
      id: 'fixture-llm-reviewer',
      model: 'fixture-llm',
      async review(input) {
        assertRule(input.contentUnits.length === 1, 'provider orchestration passes built content units into LLM reviewer');
        assertRule(input.candidates.length === 1, 'provider orchestration passes candidate ids into LLM reviewer');
        return {
          rankedCandidateIds: ['speech-semantic-candidate-1'],
          referencedUnitIds: ['unit-1'],
          reviewNotes: ['speech-semantic-candidate-1 preserves the complete setup and payoff.'],
        };
      },
    };

    const providerSpeechFirstPackage = await createSmartCutSpeechFirstExecutionPackageFromProviders({
      context: providerContext,
      speechToTextProvider: sttProvider,
      speakerDiarizationProvider: diarizationProvider,
      llmReviewer,
    });

    assertRule(providerSpeechFirstPackage.ready === true, 'provider-driven speech-first orchestration returns a ready package');
    assertRule(providerSpeechFirstPackage.providerIds.speechToText === 'fixture-stt-provider', 'provider-driven package records STT provider id');
    assertRule(providerSpeechFirstPackage.providerIds.speakerDiarization === 'fixture-diarization-provider', 'provider-driven package records speaker diarization provider id');
    assertRule(providerSpeechFirstPackage.providerIds.llmReviewer === 'fixture-llm-reviewer', 'provider-driven package records LLM reviewer id');
    assertRule(providerSpeechFirstPackage.stageStatuses.speechToText === 'passed', 'provider-driven package marks STT stage passed');
    assertRule(providerSpeechFirstPackage.stageStatuses.speakerDiarization === 'passed', 'provider-driven package marks speaker diarization stage passed');
    assertRule(providerSpeechFirstPackage.stageStatuses.llmProviderReview === 'passed', 'provider-driven package marks LLM provider stage passed');
    assertRule(providerSpeechFirstPackage.stageStatuses.executionPackage === 'passed', 'provider-driven package marks execution package stage passed');
    assertRule(providerSpeechFirstPackage.executionPackage.ready === true, 'provider-driven package delegates to standard execution package');
    assertRule(providerSpeechFirstPackage.auditTrace.ready === true, 'provider-driven package creates provider-aware audit trace');
    assertRule(providerSpeechFirstPackage.auditTrace.providerIds?.speechToText === 'fixture-stt-provider', 'provider-driven audit trace records STT provider id');
    assertRule(providerSpeechFirstPackage.executionPackage.nativeRequests.length === 5, 'provider-driven package reaches full native request sequence when all stages pass');

    const emptyTranscriptPackage = await createSmartCutSpeechFirstExecutionPackageFromProviders({
      context: {
        ...providerContext,
        runId: 'run-provider-empty-transcript',
      },
      speechToTextProvider: {
        id: 'empty-stt-provider',
        async transcribe() {
          return {
            ...speechFirstTranscriptEvidence,
            segments: [],
          };
        },
      },
      speakerDiarizationProvider: {
        id: 'should-not-run-diarization',
        async diarize() {
          throw new Error('diarization must not run when STT evidence is empty');
        },
      },
      llmReviewer,
    });

    assertRule(emptyTranscriptPackage.ready === false, 'provider-driven orchestration fails closed on empty STT evidence');
    assertRule(emptyTranscriptPackage.auditTrace.ready === false, 'provider-driven empty STT package creates blocked audit trace');
    assertRule(emptyTranscriptPackage.auditTrace.stages.some((stage) => stage.id === 'speech-to-text' && stage.status === 'blocked'), 'provider-driven empty STT audit trace marks STT blocked');
    assertRule(emptyTranscriptPackage.stageStatuses.speechToText === 'blocked', 'provider-driven orchestration marks STT stage blocked on empty transcript');
    assertRule(emptyTranscriptPackage.stageStatuses.speakerDiarization === 'blocked', 'provider-driven orchestration does not run diarization after blocked STT');
    assertRule(emptyTranscriptPackage.stageStatuses.llmProviderReview === 'blocked', 'provider-driven orchestration does not run LLM review after blocked STT');
    assertRule(
      emptyTranscriptPackage.blockers.some((blocker) => blocker.source === 'speech-to-text' && blocker.code === 'MISSING_TRANSCRIPT_EVIDENCE'),
      'provider-driven orchestration exposes empty STT blocker',
    );
    assertRule(emptyTranscriptPackage.executionPackage === undefined, 'provider-driven empty STT package does not fabricate an execution package');

    const invalidTranscriptPackage = await createSmartCutSpeechFirstExecutionPackageFromProviders({
      context: {
        ...providerContext,
        runId: 'run-provider-invalid-transcript',
      },
      speechToTextProvider: {
        id: 'invalid-stt-provider',
        async transcribe() {
          return {
            ...speechFirstTranscriptEvidence,
            segments: [
              {
                id: 'invalid-transcript-segment',
                startMs: 10_000,
                endMs: 10_000,
                text: 'Invalid transcript segment.',
                confidence: 0.96,
                language: 'en-US',
                speakerId: 'speaker-teacher',
              },
            ],
          };
        },
      },
      speakerDiarizationProvider: {
        id: 'should-not-run-after-invalid-transcript',
        async diarize() {
          throw new Error('diarization must not run when STT evidence has invalid segment ranges');
        },
      },
      llmReviewer,
    });

    assertRule(invalidTranscriptPackage.ready === false, 'provider-driven orchestration fails closed on invalid STT segment ranges');
    assertRule(invalidTranscriptPackage.auditTrace.summary.providerStageBlockerCount === 1, 'provider-driven invalid STT audit trace records provider blocker count');
    assertRule(invalidTranscriptPackage.stageStatuses.speechToText === 'blocked', 'provider-driven orchestration marks STT stage blocked on invalid transcript');
    assertRule(invalidTranscriptPackage.stageStatuses.speakerDiarization === 'blocked', 'provider-driven orchestration does not run diarization after invalid STT evidence');
    assertRule(
      invalidTranscriptPackage.blockers.some((blocker) => blocker.source === 'speech-to-text' && blocker.code === 'INVALID_TRANSCRIPT_SEGMENT_RANGE'),
      'provider-driven orchestration exposes invalid STT segment range blocker',
    );
    assertRule(invalidTranscriptPackage.executionPackage === undefined, 'provider-driven invalid STT package does not fabricate an execution package');

    const timelineQualityTranscriptPackage = await createSmartCutSpeechFirstExecutionPackageFromProviders({
      context: {
        ...providerContext,
        runId: 'run-provider-timeline-quality-transcript',
      },
      speechToTextProvider: {
        id: 'timeline-quality-stt-provider',
        async transcribe() {
          return {
            ...speechFirstTranscriptEvidence,
            segments: [
              {
                id: 'timeline-low-confidence',
                startMs: 10_000,
                endMs: 20_000,
                text: 'This transcript segment is too uncertain for semantic slicing.',
                confidence: 0.3,
                language: 'en-US',
                speakerId: 'speaker-teacher',
              },
              {
                id: 'timeline-overlap',
                startMs: 15_000,
                endMs: 25_000,
                text: 'This transcript segment overlaps the previous STT segment.',
                confidence: 0.95,
                language: 'en-US',
                speakerId: 'speaker-teacher',
              },
              {
                id: 'timeline-out-of-source',
                startMs: 88_000,
                endMs: 91_000,
                text: 'This transcript segment extends beyond the source media duration.',
                confidence: 0.96,
                language: 'en-US',
                speakerId: 'speaker-teacher',
              },
            ],
          };
        },
      },
      speakerDiarizationProvider: {
        id: 'should-not-run-after-timeline-quality-transcript',
        async diarize() {
          throw new Error('diarization must not run when STT timeline quality is invalid');
        },
      },
      llmReviewer,
    });

    assertRule(timelineQualityTranscriptPackage.ready === false, 'provider-driven orchestration fails closed on invalid STT timeline quality');
    assertRule(timelineQualityTranscriptPackage.stageStatuses.speechToText === 'blocked', 'provider-driven orchestration marks STT blocked on timeline quality failures');
    assertRule(timelineQualityTranscriptPackage.stageStatuses.speakerDiarization === 'blocked', 'provider-driven orchestration does not run diarization after STT timeline quality failures');
    assertRule(
      timelineQualityTranscriptPackage.blockers.some((blocker) => blocker.source === 'speech-to-text' && blocker.code === 'TRANSCRIPT_SEGMENT_OUT_OF_SOURCE'),
      'provider-driven orchestration exposes out-of-source STT segment blocker',
    );
    assertRule(
      timelineQualityTranscriptPackage.blockers.some((blocker) => blocker.source === 'speech-to-text' && blocker.code === 'TRANSCRIPT_SEGMENTS_OVERLAP'),
      'provider-driven orchestration exposes overlapping STT segments blocker',
    );
    assertRule(
      timelineQualityTranscriptPackage.blockers.some((blocker) => blocker.source === 'speech-to-text' && blocker.code === 'LOW_TRANSCRIPT_CONFIDENCE'),
      'provider-driven orchestration exposes low STT confidence blocker',
    );
    assertRule(timelineQualityTranscriptPackage.executionPackage === undefined, 'provider-driven STT timeline quality failure does not fabricate an execution package');

    let malformedTranscriptEvidencePackage;
    let malformedTranscriptEvidenceException;
    try {
      malformedTranscriptEvidencePackage = await createSmartCutSpeechFirstExecutionPackageFromProviders({
        context: {
          ...providerContext,
          runId: 'run-provider-malformed-transcript-evidence',
        },
        speechToTextProvider: {
          id: 'malformed-transcript-evidence-provider',
          async transcribe() {
            return undefined;
          },
        },
        speakerDiarizationProvider: {
          id: 'should-not-run-after-malformed-transcript-evidence',
          async diarize() {
            throw new Error('diarization must not run when STT evidence is not an object');
          },
        },
        llmReviewer,
      });
    } catch (error) {
      malformedTranscriptEvidenceException = error;
    }

    assertRule(malformedTranscriptEvidenceException === undefined, 'provider-driven orchestration does not throw on malformed STT evidence payloads');
    assertRule(malformedTranscriptEvidencePackage?.ready === false, 'provider-driven orchestration fails closed on malformed STT evidence payloads');
    assertRule(malformedTranscriptEvidencePackage?.stageStatuses.speechToText === 'blocked', 'provider-driven orchestration marks malformed STT evidence stage blocked');
    assertRule(
      malformedTranscriptEvidencePackage?.blockers.some((blocker) => blocker.source === 'speech-to-text' && blocker.code === 'TRANSCRIPT_EVIDENCE_INVALID') === true,
      'provider-driven orchestration exposes malformed transcript evidence payload blocker',
    );
    assertRule(malformedTranscriptEvidencePackage?.executionPackage === undefined, 'provider-driven malformed STT evidence payload does not fabricate an execution package');

    let malformedTranscriptContainerPackage;
    let malformedTranscriptContainerException;
    try {
      malformedTranscriptContainerPackage = await createSmartCutSpeechFirstExecutionPackageFromProviders({
        context: {
          ...providerContext,
          runId: 'run-provider-malformed-transcript-container',
        },
        speechToTextProvider: {
          id: 'malformed-transcript-container-stt-provider',
          async transcribe() {
            return {
              ...speechFirstTranscriptEvidence,
              provider: undefined,
              language: undefined,
              segments: undefined,
            };
          },
        },
        speakerDiarizationProvider: {
          id: 'should-not-run-after-malformed-transcript-container',
          async diarize() {
            throw new Error('diarization must not run when STT evidence container fields are malformed');
          },
        },
        llmReviewer,
      });
    } catch (error) {
      malformedTranscriptContainerException = error;
    }

    assertRule(malformedTranscriptContainerException === undefined, 'provider-driven orchestration does not throw on malformed STT evidence containers');
    assertRule(malformedTranscriptContainerPackage?.ready === false, 'provider-driven orchestration fails closed on malformed STT evidence containers');
    assertRule(
      malformedTranscriptContainerPackage?.blockers.some((blocker) => blocker.source === 'speech-to-text' && blocker.code === 'TRANSCRIPT_PROVIDER_MISSING') === true,
      'provider-driven orchestration exposes malformed transcript provider blocker',
    );
    assertRule(
      malformedTranscriptContainerPackage?.blockers.some((blocker) => blocker.source === 'speech-to-text' && blocker.code === 'TRANSCRIPT_LANGUAGE_MISSING') === true,
      'provider-driven orchestration exposes malformed transcript language blocker',
    );
    assertRule(
      malformedTranscriptContainerPackage?.blockers.some((blocker) => blocker.source === 'speech-to-text' && blocker.code === 'TRANSCRIPT_SEGMENTS_INVALID') === true,
      'provider-driven orchestration exposes malformed transcript segments container blocker',
    );
    assertRule(malformedTranscriptContainerPackage?.executionPackage === undefined, 'provider-driven malformed STT container does not fabricate an execution package');

    let malformedTranscriptSegmentItemPackage;
    let malformedTranscriptSegmentItemException;
    try {
      malformedTranscriptSegmentItemPackage = await createSmartCutSpeechFirstExecutionPackageFromProviders({
        context: {
          ...providerContext,
          runId: 'run-provider-malformed-transcript-segment-items',
        },
        speechToTextProvider: {
          id: 'malformed-transcript-segment-items-provider',
          async transcribe() {
            return {
              ...speechFirstTranscriptEvidence,
              segments: [undefined],
            };
          },
        },
        speakerDiarizationProvider: {
          id: 'should-not-run-after-malformed-transcript-segment-items',
          async diarize() {
            throw new Error('diarization must not run when STT segment items are malformed');
          },
        },
        llmReviewer,
      });
    } catch (error) {
      malformedTranscriptSegmentItemException = error;
    }

    assertRule(malformedTranscriptSegmentItemException === undefined, 'provider-driven orchestration does not throw on malformed STT segment items');
    assertRule(malformedTranscriptSegmentItemPackage?.ready === false, 'provider-driven orchestration fails closed on malformed STT segment items');
    assertRule(
      malformedTranscriptSegmentItemPackage?.blockers.some((blocker) => blocker.source === 'speech-to-text' && blocker.code === 'TRANSCRIPT_SEGMENT_INVALID') === true,
      'provider-driven orchestration exposes malformed transcript segment item blocker',
    );
    assertRule(malformedTranscriptSegmentItemPackage?.executionPackage === undefined, 'provider-driven malformed STT segment items do not fabricate an execution package');

    let malformedTranscriptSegmentFieldPackage;
    let malformedTranscriptSegmentFieldException;
    try {
      malformedTranscriptSegmentFieldPackage = await createSmartCutSpeechFirstExecutionPackageFromProviders({
        context: {
          ...providerContext,
          runId: 'run-provider-malformed-transcript-segment-fields',
        },
        speechToTextProvider: {
          id: 'malformed-transcript-segment-fields-provider',
          async transcribe() {
            return {
              ...speechFirstTranscriptEvidence,
              segments: [
                {
                  id: undefined,
                  startMs: 1_000,
                  endMs: 3_000,
                  text: undefined,
                  confidence: 0.96,
                  language: 'en-US',
                  speakerId: 'speaker-teacher',
                },
              ],
            };
          },
        },
        speakerDiarizationProvider: {
          id: 'should-not-run-after-malformed-transcript-segment-fields',
          async diarize() {
            throw new Error('diarization must not run when STT segment fields are malformed');
          },
        },
        llmReviewer,
      });
    } catch (error) {
      malformedTranscriptSegmentFieldException = error;
    }

    assertRule(malformedTranscriptSegmentFieldException === undefined, 'provider-driven orchestration does not throw on malformed STT segment fields');
    assertRule(malformedTranscriptSegmentFieldPackage?.ready === false, 'provider-driven orchestration fails closed on malformed STT segment fields');
    assertRule(
      malformedTranscriptSegmentFieldPackage?.blockers.some((blocker) => blocker.source === 'speech-to-text' && blocker.code === 'TRANSCRIPT_SEGMENT_ID_MISSING') === true,
      'provider-driven orchestration exposes malformed transcript segment id blocker',
    );
    assertRule(
      malformedTranscriptSegmentFieldPackage?.blockers.some((blocker) => blocker.source === 'speech-to-text' && blocker.code === 'TRANSCRIPT_SEGMENT_TEXT_MISSING') === true,
      'provider-driven orchestration exposes malformed transcript segment text blocker',
    );
    assertRule(malformedTranscriptSegmentFieldPackage?.executionPackage === undefined, 'provider-driven malformed STT segment fields do not fabricate an execution package');

    const malformedTranscriptPackage = await createSmartCutSpeechFirstExecutionPackageFromProviders({
      context: {
        ...providerContext,
        runId: 'run-provider-malformed-transcript',
      },
      speechToTextProvider: {
        id: 'malformed-stt-provider',
        async transcribe() {
          return {
            ...speechFirstTranscriptEvidence,
            kind: 'not-transcript',
            schemaVersion: 'old-schema',
            provider: ' ',
            language: ' ',
            segments: [
              {
                id: ' ',
                startMs: 1_000,
                endMs: 3_000,
                text: ' ',
                confidence: 1.2,
                language: 'en-US',
                speakerId: 'speaker-teacher',
              },
              {
                id: 'provider-transcript-dup',
                startMs: 3_200,
                endMs: 5_000,
                text: 'This transcript segment has a stable id.',
                confidence: 0.96,
                language: 'en-US',
                speakerId: 'speaker-teacher',
              },
              {
                id: 'provider-transcript-dup',
                startMs: 5_200,
                endMs: 7_000,
                text: 'This duplicate id makes provider transcript evidence ambiguous.',
                confidence: 0.95,
                language: 'en-US',
                speakerId: 'speaker-teacher',
              },
            ],
          };
        },
      },
      speakerDiarizationProvider: {
        id: 'should-not-run-after-malformed-transcript',
        async diarize() {
          throw new Error('diarization must not run when STT evidence schema is malformed');
        },
      },
      llmReviewer,
    });

    assertRule(malformedTranscriptPackage.ready === false, 'provider-driven orchestration fails closed on malformed STT evidence schema');
    assertRule(
      malformedTranscriptPackage.blockers.some((blocker) => blocker.source === 'speech-to-text' && blocker.code === 'TRANSCRIPT_EVIDENCE_KIND_INVALID'),
      'provider-driven orchestration exposes transcript evidence kind blocker',
    );
    assertRule(
      malformedTranscriptPackage.blockers.some((blocker) => blocker.source === 'speech-to-text' && blocker.code === 'TRANSCRIPT_SCHEMA_VERSION_INVALID'),
      'provider-driven orchestration exposes transcript schema version blocker',
    );
    assertRule(
      malformedTranscriptPackage.blockers.some((blocker) => blocker.source === 'speech-to-text' && blocker.code === 'TRANSCRIPT_PROVIDER_MISSING'),
      'provider-driven orchestration exposes transcript provider id blocker',
    );
    assertRule(
      malformedTranscriptPackage.blockers.some((blocker) => blocker.source === 'speech-to-text' && blocker.code === 'TRANSCRIPT_LANGUAGE_MISSING'),
      'provider-driven orchestration exposes transcript language blocker',
    );
    assertRule(
      malformedTranscriptPackage.blockers.some((blocker) => blocker.source === 'speech-to-text' && blocker.code === 'TRANSCRIPT_SEGMENT_ID_MISSING'),
      'provider-driven orchestration exposes transcript segment id blocker',
    );
    assertRule(
      malformedTranscriptPackage.blockers.some((blocker) => blocker.source === 'speech-to-text' && blocker.code === 'TRANSCRIPT_SEGMENT_TEXT_MISSING'),
      'provider-driven orchestration exposes transcript segment text blocker',
    );
    assertRule(
      malformedTranscriptPackage.blockers.some((blocker) => blocker.source === 'speech-to-text' && blocker.code === 'DUPLICATE_TRANSCRIPT_SEGMENT_ID'),
      'provider-driven orchestration exposes duplicate transcript segment id blocker',
    );
    assertRule(
      malformedTranscriptPackage.blockers.some((blocker) => blocker.source === 'speech-to-text' && blocker.code === 'TRANSCRIPT_SEGMENT_CONFIDENCE_INVALID'),
      'provider-driven orchestration exposes transcript segment confidence blocker',
    );
    assertRule(
      !malformedTranscriptPackage.blockers.some((blocker) => blocker.source === 'speech-to-text' && blocker.code === 'INVALID_TRANSCRIPT_SEGMENT_RANGE'),
      'provider-driven orchestration does not misclassify blank text as an invalid timestamp range',
    );
    assertRule(malformedTranscriptPackage.executionPackage === undefined, 'provider-driven malformed STT package does not fabricate an execution package');

    const emptyDiarizationPackage = await createSmartCutSpeechFirstExecutionPackageFromProviders({
      context: {
        ...providerContext,
        runId: 'run-provider-empty-diarization',
      },
      speechToTextProvider: sttProvider,
      speakerDiarizationProvider: {
        id: 'empty-diarization-provider',
        async diarize() {
          return {
            ...speechFirstSpeakerEvidence,
            profiles: [],
            segments: [],
          };
        },
      },
      llmReviewer,
    });

    assertRule(emptyDiarizationPackage.ready === false, 'provider-driven orchestration fails closed on empty speaker diarization evidence');
    assertRule(emptyDiarizationPackage.auditTrace.stages.some((stage) => stage.id === 'speaker-diarization' && stage.status === 'blocked'), 'provider-driven empty diarization audit trace marks diarization blocked');
    assertRule(emptyDiarizationPackage.stageStatuses.speechToText === 'passed', 'provider-driven empty diarization still records STT passed');
    assertRule(emptyDiarizationPackage.stageStatuses.speakerDiarization === 'blocked', 'provider-driven orchestration marks speaker diarization blocked');
    assertRule(emptyDiarizationPackage.stageStatuses.llmProviderReview === 'blocked', 'provider-driven orchestration does not run LLM review after blocked diarization');
    assertRule(emptyDiarizationPackage.stageStatuses.llmReview === 'blocked', 'provider-driven orchestration marks LLM review blocked after diarization failure');
    assertRule(
      emptyDiarizationPackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'MISSING_SPEAKER_DIARIZATION'),
      'provider-driven orchestration exposes empty diarization blocker',
    );
    assertRule(emptyDiarizationPackage.llmReviewReport === undefined, 'provider-driven empty diarization does not fabricate LLM review evidence');
    assertRule(emptyDiarizationPackage.executionPackage === undefined, 'provider-driven empty diarization does not fabricate an execution package');
    assertRule(
      emptyDiarizationPackage.executionPackage?.filterPlan === undefined &&
        emptyDiarizationPackage.executionPackage?.renderContract === undefined,
      'provider-driven empty diarization stops before filters and render',
    );

    let malformedSpeakerEvidencePackage;
    let malformedSpeakerEvidenceException;
    try {
      malformedSpeakerEvidencePackage = await createSmartCutSpeechFirstExecutionPackageFromProviders({
        context: {
          ...providerContext,
          runId: 'run-provider-malformed-speaker-evidence',
        },
        speechToTextProvider: sttProvider,
        speakerDiarizationProvider: {
          id: 'malformed-speaker-evidence-provider',
          async diarize() {
            return undefined;
          },
        },
        llmReviewer: {
          id: 'should-not-run-after-malformed-speaker-evidence',
          model: 'fixture-llm',
          async review() {
            throw new Error('LLM review must not run when speaker evidence is not an object');
          },
        },
      });
    } catch (error) {
      malformedSpeakerEvidenceException = error;
    }

    assertRule(malformedSpeakerEvidenceException === undefined, 'provider-driven orchestration does not throw on malformed speaker evidence payloads');
    assertRule(malformedSpeakerEvidencePackage?.ready === false, 'provider-driven orchestration fails closed on malformed speaker evidence payloads');
    assertRule(malformedSpeakerEvidencePackage?.stageStatuses.speechToText === 'passed', 'provider-driven malformed speaker evidence keeps STT stage passed');
    assertRule(malformedSpeakerEvidencePackage?.stageStatuses.speakerDiarization === 'blocked', 'provider-driven orchestration marks malformed speaker evidence stage blocked');
    assertRule(
      malformedSpeakerEvidencePackage?.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'SPEAKER_EVIDENCE_INVALID') === true,
      'provider-driven orchestration exposes malformed speaker evidence payload blocker',
    );
    assertRule(malformedSpeakerEvidencePackage?.speakerAlignment === undefined, 'provider-driven malformed speaker evidence does not run speaker alignment');
    assertRule(malformedSpeakerEvidencePackage?.executionPackage === undefined, 'provider-driven malformed speaker evidence does not fabricate an execution package');

    let malformedSpeakerContainerPackage;
    let malformedSpeakerContainerException;
    try {
      malformedSpeakerContainerPackage = await createSmartCutSpeechFirstExecutionPackageFromProviders({
        context: {
          ...providerContext,
          runId: 'run-provider-malformed-speaker-container',
        },
        speechToTextProvider: sttProvider,
        speakerDiarizationProvider: {
          id: 'malformed-speaker-container-provider',
          async diarize() {
            return {
              ...speechFirstSpeakerEvidence,
              profiles: undefined,
              segments: undefined,
              turns: undefined,
              overlappingSpeechGroups: undefined,
              roleAssignments: undefined,
              corrections: undefined,
            };
          },
        },
        llmReviewer: {
          id: 'should-not-run-after-malformed-speaker-container',
          model: 'fixture-llm',
          async review() {
            throw new Error('LLM review must not run when speaker evidence containers are malformed');
          },
        },
      });
    } catch (error) {
      malformedSpeakerContainerException = error;
    }

    assertRule(malformedSpeakerContainerException === undefined, 'provider-driven orchestration does not throw on malformed speaker evidence containers');
    assertRule(malformedSpeakerContainerPackage?.ready === false, 'provider-driven orchestration fails closed on malformed speaker evidence containers');
    assertRule(
      malformedSpeakerContainerPackage?.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'SPEAKER_PROFILES_INVALID') === true,
      'provider-driven orchestration exposes malformed speaker profiles container blocker',
    );
    assertRule(
      malformedSpeakerContainerPackage?.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'SPEAKER_SEGMENTS_INVALID') === true,
      'provider-driven orchestration exposes malformed speaker segments container blocker',
    );
    assertRule(
      malformedSpeakerContainerPackage?.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'SPEAKER_TURNS_INVALID') === true,
      'provider-driven orchestration exposes malformed speaker turns container blocker',
    );
    assertRule(
      malformedSpeakerContainerPackage?.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'OVERLAP_GROUPS_INVALID') === true,
      'provider-driven orchestration exposes malformed overlap groups container blocker',
    );
    assertRule(
      malformedSpeakerContainerPackage?.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'SPEAKER_ROLE_ASSIGNMENTS_INVALID') === true,
      'provider-driven orchestration exposes malformed role assignments container blocker',
    );
    assertRule(
      malformedSpeakerContainerPackage?.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'SPEAKER_CORRECTIONS_INVALID') === true,
      'provider-driven orchestration exposes malformed speaker corrections container blocker',
    );
    assertRule(malformedSpeakerContainerPackage?.speakerAlignment === undefined, 'provider-driven malformed speaker containers do not run speaker alignment');
    assertRule(malformedSpeakerContainerPackage?.executionPackage === undefined, 'provider-driven malformed speaker containers do not fabricate an execution package');

    const invalidDiarizationPackage = await createSmartCutSpeechFirstExecutionPackageFromProviders({
      context: {
        ...providerContext,
        runId: 'run-provider-invalid-diarization',
      },
      speechToTextProvider: sttProvider,
      speakerDiarizationProvider: {
        id: 'invalid-diarization-provider',
        async diarize() {
          return {
            ...speechFirstSpeakerEvidence,
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
              { id: 'speaker-segment-invalid-unknown', speakerId: 'speaker-unknown', startMs: 900, endMs: 44_100, confidence: 0.98 },
              { id: 'speaker-segment-invalid-range', speakerId: 'speaker-teacher', startMs: 45_000, endMs: 45_000, confidence: 0.98 },
            ],
          };
        },
      },
      llmReviewer: {
        id: 'should-not-run-after-invalid-diarization',
        model: 'fixture-llm',
        async review() {
          throw new Error('LLM review must not run when diarization evidence is invalid');
        },
      },
    });

    assertRule(invalidDiarizationPackage.ready === false, 'provider-driven orchestration fails closed on invalid diarization evidence');
    assertRule(invalidDiarizationPackage.auditTrace.blockerGroups.some((group) => group.source === 'speaker-diarization'), 'provider-driven invalid diarization audit trace groups diarization blockers');
    assertRule(invalidDiarizationPackage.stageStatuses.speechToText === 'passed', 'provider-driven invalid diarization keeps STT stage passed');
    assertRule(invalidDiarizationPackage.stageStatuses.speakerDiarization === 'blocked', 'provider-driven orchestration marks invalid diarization blocked');
    assertRule(
      invalidDiarizationPackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'UNKNOWN_SPEAKER_REFERENCE'),
      'provider-driven orchestration exposes unknown speaker reference blocker',
    );
    assertRule(
      invalidDiarizationPackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'INVALID_SPEAKER_SEGMENT_RANGE'),
      'provider-driven orchestration exposes invalid speaker segment range blocker',
    );
    assertRule(invalidDiarizationPackage.speakerAlignment === undefined, 'provider-driven invalid diarization does not run speaker alignment');
    assertRule(invalidDiarizationPackage.executionPackage === undefined, 'provider-driven invalid diarization does not fabricate an execution package');

    const malformedOverlapGroupPackage = await createSmartCutSpeechFirstExecutionPackageFromProviders({
      context: {
        ...providerContext,
        runId: 'run-provider-malformed-overlap-groups',
      },
      speechToTextProvider: sttProvider,
      speakerDiarizationProvider: {
        id: 'malformed-overlap-diarization-provider',
        async diarize() {
          return {
            ...speechFirstSpeakerEvidence,
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
              { id: ' ', speakerId: 'speaker-teacher', startMs: 900, endMs: 10_000, confidence: 0.98 },
              { id: 'segment-speaker-dup', speakerId: 'speaker-teacher', startMs: 10_000, endMs: 20_000, confidence: 0.98 },
              { id: 'segment-speaker-dup', speakerId: 'speaker-teacher', startMs: 20_000, endMs: 44_100, confidence: 0.98 },
            ],
            overlappingSpeechGroups: [
              {
                id: 'overlap-invalid',
                speakerIds: ['speaker-teacher', 'speaker-unknown'],
                segmentIds: ['segment-speaker-dup', 'segment-missing'],
                startMs: 9_000,
                endMs: 12_000,
                severity: 'medium',
              },
            ],
          };
        },
      },
      llmReviewer: {
        id: 'should-not-run-after-malformed-overlap-groups',
        model: 'fixture-llm',
        async review() {
          throw new Error('LLM review must not run when diarization segment ids or overlap groups are malformed');
        },
      },
    });

    assertRule(malformedOverlapGroupPackage.ready === false, 'provider-driven orchestration fails closed on malformed diarization segment ids and overlap groups');
    assertRule(
      malformedOverlapGroupPackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'SPEAKER_SEGMENT_ID_MISSING'),
      'provider-driven orchestration exposes missing speaker segment id blocker',
    );
    assertRule(
      malformedOverlapGroupPackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'DUPLICATE_SPEAKER_SEGMENT_ID'),
      'provider-driven orchestration exposes duplicate speaker segment id blocker',
    );
    assertRule(
      malformedOverlapGroupPackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'OVERLAP_GROUP_UNKNOWN_SPEAKER_REFERENCE'),
      'provider-driven orchestration exposes overlap group unknown speaker blocker',
    );
    assertRule(
      malformedOverlapGroupPackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'OVERLAP_GROUP_UNKNOWN_SEGMENT_REFERENCE'),
      'provider-driven orchestration exposes overlap group unknown segment blocker',
    );
    assertRule(malformedOverlapGroupPackage.speakerAlignment === undefined, 'provider-driven malformed overlap groups do not run speaker alignment');
    assertRule(malformedOverlapGroupPackage.executionPackage === undefined, 'provider-driven malformed overlap groups do not fabricate an execution package');

    const malformedOverlapGroupStructurePackage = await createSmartCutSpeechFirstExecutionPackageFromProviders({
      context: {
        ...providerContext,
        runId: 'run-provider-malformed-overlap-group-structure',
      },
      speechToTextProvider: sttProvider,
      speakerDiarizationProvider: {
        id: 'malformed-overlap-structure-diarization-provider',
        async diarize() {
          return {
            ...speechFirstSpeakerEvidence,
            profiles: [
              {
                id: 'speaker-teacher',
                displayName: 'Teacher Zhang',
                role: 'teacher',
                confidence: 0.98,
                source: 'diarization',
              },
              {
                id: 'speaker-guest',
                displayName: 'Guest',
                role: 'guest',
                confidence: 0.95,
                source: 'diarization',
              },
              {
                id: 'speaker-observer',
                displayName: 'Observer',
                role: 'speaker',
                confidence: 0.94,
                source: 'diarization',
              },
            ],
            segments: [
              { id: 'speaker-segment-teacher-main', speakerId: 'speaker-teacher', startMs: 1_000, endMs: 20_000, confidence: 0.98 },
              { id: 'speaker-segment-guest-main', speakerId: 'speaker-guest', startMs: 2_000, endMs: 18_000, confidence: 0.95 },
              { id: 'speaker-segment-observer-late', speakerId: 'speaker-observer', startMs: 40_000, endMs: 45_000, confidence: 0.94 },
              { id: 'speaker-segment-teacher-early', speakerId: 'speaker-teacher', startMs: 50_000, endMs: 52_000, confidence: 0.94 },
              { id: 'speaker-segment-guest-late', speakerId: 'speaker-guest', startMs: 56_000, endMs: 58_000, confidence: 0.94 },
            ],
            overlappingSpeechGroups: [
              {
                id: 'provider-overlap-dup',
                speakerIds: ['speaker-teacher', 'speaker-guest'],
                segmentIds: ['speaker-segment-teacher-main', 'speaker-segment-guest-main'],
                startMs: 2_000,
                endMs: 18_000,
                severity: 'high',
              },
              {
                id: 'provider-overlap-dup',
                speakerIds: ['speaker-teacher', 'speaker-guest'],
                segmentIds: ['speaker-segment-teacher-main', 'speaker-segment-guest-main'],
                startMs: 2_000,
                endMs: 18_000,
                severity: 'high',
              },
              {
                id: 'provider-overlap-out-of-source',
                speakerIds: ['speaker-teacher', 'speaker-guest'],
                segmentIds: ['speaker-segment-teacher-main', 'speaker-segment-guest-main'],
                startMs: 88_000,
                endMs: 91_000,
                severity: 'medium',
              },
              {
                id: 'provider-overlap-duplicate-members',
                speakerIds: ['speaker-teacher', 'speaker-teacher'],
                segmentIds: ['speaker-segment-teacher-main', 'speaker-segment-teacher-main'],
                startMs: 2_000,
                endMs: 18_000,
                severity: 'medium',
              },
              {
                id: 'provider-overlap-segment-outside-group',
                speakerIds: ['speaker-teacher', 'speaker-observer'],
                segmentIds: ['speaker-segment-teacher-main', 'speaker-segment-observer-late'],
                startMs: 1_000,
                endMs: 20_000,
                severity: 'medium',
              },
              {
                id: 'provider-overlap-speaker-mismatch',
                speakerIds: ['speaker-teacher', 'speaker-guest'],
                segmentIds: ['speaker-segment-teacher-main', 'speaker-segment-observer-late'],
                startMs: 1_000,
                endMs: 20_000,
                severity: 'medium',
              },
              {
                id: 'provider-overlap-no-real-overlap',
                speakerIds: ['speaker-teacher', 'speaker-guest'],
                segmentIds: ['speaker-segment-teacher-early', 'speaker-segment-guest-late'],
                startMs: 50_000,
                endMs: 58_000,
                severity: 'low',
              },
            ],
          };
        },
      },
      llmReviewer: {
        id: 'should-not-run-after-malformed-overlap-structure',
        model: 'fixture-llm',
        async review() {
          throw new Error('LLM review must not run when overlap group structure is internally inconsistent');
        },
      },
    });

    assertRule(malformedOverlapGroupStructurePackage.ready === false, 'provider-driven orchestration fails closed on malformed overlap group structure');
    assertRule(
      malformedOverlapGroupStructurePackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'DUPLICATE_OVERLAP_GROUP_ID'),
      'provider-driven orchestration exposes duplicate overlap group id blocker',
    );
    assertRule(
      malformedOverlapGroupStructurePackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'OVERLAP_GROUP_OUT_OF_SOURCE'),
      'provider-driven orchestration exposes out-of-source overlap group blocker',
    );
    assertRule(
      malformedOverlapGroupStructurePackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'DUPLICATE_OVERLAP_GROUP_SPEAKER'),
      'provider-driven orchestration exposes duplicate overlap group speaker blocker',
    );
    assertRule(
      malformedOverlapGroupStructurePackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'DUPLICATE_OVERLAP_GROUP_SEGMENT'),
      'provider-driven orchestration exposes duplicate overlap group segment blocker',
    );
    assertRule(
      malformedOverlapGroupStructurePackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'OVERLAP_GROUP_SEGMENT_RANGE_MISMATCH'),
      'provider-driven orchestration exposes overlap group segment range mismatch blocker',
    );
    assertRule(
      malformedOverlapGroupStructurePackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'OVERLAP_GROUP_SEGMENT_SPEAKER_MISMATCH'),
      'provider-driven orchestration exposes overlap group segment speaker mismatch blocker',
    );
    assertRule(
      malformedOverlapGroupStructurePackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'OVERLAP_GROUP_SPEAKER_WITHOUT_SEGMENT'),
      'provider-driven orchestration exposes overlap group speaker without segment blocker',
    );
    assertRule(
      malformedOverlapGroupStructurePackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'OVERLAP_GROUP_WITHOUT_REAL_OVERLAP'),
      'provider-driven orchestration exposes overlap group without real overlap blocker',
    );
    assertRule(malformedOverlapGroupStructurePackage.speakerAlignment === undefined, 'provider-driven malformed overlap structure does not run speaker alignment');
    assertRule(malformedOverlapGroupStructurePackage.executionPackage === undefined, 'provider-driven malformed overlap structure does not fabricate an execution package');

    const conflictingRoleDiarizationPackage = await createSmartCutSpeechFirstExecutionPackageFromProviders({
      context: {
        ...providerContext,
        runId: 'run-provider-conflicting-role-diarization',
      },
      speechToTextProvider: sttProvider,
      speakerDiarizationProvider: {
        id: 'conflicting-role-diarization-provider',
        async diarize() {
          return {
            ...speechFirstSpeakerEvidence,
            roleAssignments: [
              {
                speakerId: 'speaker-teacher',
                role: 'guest',
                confidence: 0.98,
                evidenceTurnIds: [],
                source: 'manual',
              },
            ],
          };
        },
      },
      llmReviewer: {
        id: 'should-not-run-after-conflicting-role-diarization',
        model: 'fixture-llm',
        async review() {
          throw new Error('LLM review must not run when speaker role assignments conflict with profiles');
        },
      },
    });

    assertRule(conflictingRoleDiarizationPackage.ready === false, 'provider-driven orchestration fails closed on conflicting speaker role assignment');
    assertRule(
      conflictingRoleDiarizationPackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'SPEAKER_ROLE_ASSIGNMENT_CONFLICT'),
      'provider-driven orchestration exposes conflicting speaker role assignment blocker',
    );
    assertRule(conflictingRoleDiarizationPackage.speakerAlignment === undefined, 'provider-driven conflicting roles do not run speaker alignment');
    assertRule(conflictingRoleDiarizationPackage.executionPackage === undefined, 'provider-driven conflicting roles do not fabricate an execution package');

    const malformedRoleAssignmentDiarizationPackage = await createSmartCutSpeechFirstExecutionPackageFromProviders({
      context: {
        ...providerContext,
        runId: 'run-provider-malformed-role-assignment-diarization',
      },
      speechToTextProvider: sttProvider,
      speakerDiarizationProvider: {
        id: 'malformed-role-assignment-diarization-provider',
        async diarize() {
          return {
            ...speechFirstSpeakerEvidence,
            turns: [
              {
                id: 'turn-other-speaker',
                speakerId: 'speaker-other',
                startMs: 1_000,
                endMs: 20_000,
                sentenceIds: ['sentence-other'],
                transcriptSegmentIds: ['orchestration-segment-1'],
                text: 'Planning starts with a clear goal.',
                isQuestion: false,
                isAnswerCandidate: true,
                isInterruption: false,
                isBackchannel: false,
                topicIds: ['topic-planning'],
                risks: [],
              },
            ],
            roleAssignments: [
              {
                speakerId: 'speaker-missing',
                role: 'teacher',
                confidence: 1.2,
                evidenceTurnIds: ['turn-other-speaker', 'turn-missing'],
                source: 'manual',
              },
              {
                speakerId: 'speaker-teacher',
                role: 'guest',
                confidence: 0.9,
                evidenceTurnIds: [],
                source: 'llm-role-inference',
              },
              {
                speakerId: 'speaker-teacher',
                role: 'lecturer',
                confidence: 0.91,
                evidenceTurnIds: ['turn-other-speaker'],
                source: 'external-provider',
              },
            ],
          };
        },
      },
      llmReviewer: {
        id: 'should-not-run-after-malformed-role-assignment-diarization',
        model: 'fixture-llm',
        async review() {
          throw new Error('LLM review must not run when speaker role assignments are malformed');
        },
      },
    });

    assertRule(malformedRoleAssignmentDiarizationPackage.ready === false, 'provider-driven orchestration fails closed on malformed speaker role assignments');
    assertRule(
      malformedRoleAssignmentDiarizationPackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'SPEAKER_ROLE_ASSIGNMENT_UNKNOWN_SPEAKER'),
      'provider-driven orchestration exposes role assignment unknown speaker blocker',
    );
    assertRule(
      malformedRoleAssignmentDiarizationPackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'SPEAKER_ROLE_ASSIGNMENT_CONFIDENCE_INVALID'),
      'provider-driven orchestration exposes role assignment confidence blocker',
    );
    assertRule(
      malformedRoleAssignmentDiarizationPackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'SPEAKER_ROLE_ASSIGNMENT_ROLE_INVALID'),
      'provider-driven orchestration exposes role assignment role blocker',
    );
    assertRule(
      malformedRoleAssignmentDiarizationPackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'SPEAKER_ROLE_ASSIGNMENT_SOURCE_INVALID'),
      'provider-driven orchestration exposes role assignment source blocker',
    );
    assertRule(
      malformedRoleAssignmentDiarizationPackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'SPEAKER_ROLE_ASSIGNMENT_UNKNOWN_TURN'),
      'provider-driven orchestration exposes role assignment unknown turn blocker',
    );
    assertRule(
      malformedRoleAssignmentDiarizationPackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'SPEAKER_ROLE_ASSIGNMENT_TURN_SPEAKER_MISMATCH'),
      'provider-driven orchestration exposes role assignment turn-speaker mismatch blocker',
    );
    assertRule(
      malformedRoleAssignmentDiarizationPackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'SPEAKER_ROLE_ASSIGNMENT_CONFLICT'),
      'provider-driven orchestration still exposes role assignment profile conflict blocker',
    );
    assertRule(malformedRoleAssignmentDiarizationPackage.speakerAlignment === undefined, 'provider-driven malformed role assignments do not run speaker alignment');
    assertRule(malformedRoleAssignmentDiarizationPackage.executionPackage === undefined, 'provider-driven malformed role assignments do not fabricate an execution package');

    const ambiguousRoleAssignmentDiarizationPackage = await createSmartCutSpeechFirstExecutionPackageFromProviders({
      context: {
        ...providerContext,
        runId: 'run-provider-ambiguous-role-assignment-diarization',
      },
      speechToTextProvider: sttProvider,
      speakerDiarizationProvider: {
        id: 'ambiguous-role-assignment-diarization-provider',
        async diarize() {
          return {
            ...speechFirstSpeakerEvidence,
            profiles: speechFirstSpeakerEvidence.profiles.map((profile) => ({ ...profile, role: 'unknown' })),
            roleAssignments: [
              {
                speakerId: 'speaker-teacher',
                role: 'teacher',
                confidence: 0.96,
                evidenceTurnIds: [],
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
          };
        },
      },
      llmReviewer: {
        id: 'should-not-run-after-ambiguous-role-assignment-diarization',
        model: 'fixture-llm',
        async review() {
          throw new Error('LLM review must not run when speaker role assignments are ambiguous');
        },
      },
    });

    assertRule(ambiguousRoleAssignmentDiarizationPackage.ready === false, 'provider-driven orchestration fails closed on ambiguous role assignments');
    assertRule(
      ambiguousRoleAssignmentDiarizationPackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'SPEAKER_ROLE_ASSIGNMENT_AMBIGUOUS'),
      'provider-driven orchestration exposes ambiguous role assignment blocker',
    );
    assertRule(ambiguousRoleAssignmentDiarizationPackage.speakerAlignment === undefined, 'provider-driven ambiguous role assignments do not run speaker alignment');
    assertRule(ambiguousRoleAssignmentDiarizationPackage.executionPackage === undefined, 'provider-driven ambiguous role assignments do not fabricate an execution package');

    const malformedSpeakerTurnDiarizationPackage = await createSmartCutSpeechFirstExecutionPackageFromProviders({
      context: {
        ...providerContext,
        runId: 'run-provider-malformed-speaker-turn-diarization',
      },
      speechToTextProvider: sttProvider,
      speakerDiarizationProvider: {
        id: 'malformed-speaker-turn-diarization-provider',
        async diarize() {
          return {
            ...speechFirstSpeakerEvidence,
            turns: [
              {
                id: ' ',
                speakerId: 'speaker-teacher',
                startMs: 1_000,
                endMs: 20_000,
                sentenceIds: ['sentence-blank-turn'],
                transcriptSegmentIds: ['orchestration-segment-1'],
                text: 'Planning starts with a clear goal.',
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
                startMs: 20_200,
                endMs: 20_100,
                sentenceIds: ['sentence-invalid-turn'],
                transcriptSegmentIds: ['orchestration-segment-1', 'orchestration-segment-missing'],
                text: 'This malformed turn should block provider orchestration.',
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
                startMs: 20_200,
                endMs: 44_000,
                sentenceIds: ['sentence-dup-turn'],
                transcriptSegmentIds: ['orchestration-segment-2'],
                text: 'Every activity and recommendation should support the same story.',
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
                transcriptSegmentIds: ['orchestration-segment-2'],
                text: 'This turn exceeds the source duration and should block orchestration.',
                isQuestion: false,
                isAnswerCandidate: true,
                isInterruption: false,
                isBackchannel: false,
                topicIds: ['topic-planning'],
                risks: [],
              },
            ],
          };
        },
      },
      llmReviewer: {
        id: 'should-not-run-after-malformed-speaker-turn-diarization',
        model: 'fixture-llm',
        async review() {
          throw new Error('LLM review must not run when speaker turns are malformed');
        },
      },
    });

    assertRule(malformedSpeakerTurnDiarizationPackage.ready === false, 'provider-driven orchestration fails closed on malformed speaker turns');
    assertRule(
      malformedSpeakerTurnDiarizationPackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'SPEAKER_TURN_ID_MISSING'),
      'provider-driven orchestration exposes missing speaker turn id blocker',
    );
    assertRule(
      malformedSpeakerTurnDiarizationPackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'DUPLICATE_SPEAKER_TURN_ID'),
      'provider-driven orchestration exposes duplicate speaker turn id blocker',
    );
    assertRule(
      malformedSpeakerTurnDiarizationPackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'INVALID_SPEAKER_TURN_RANGE'),
      'provider-driven orchestration exposes invalid speaker turn range blocker',
    );
    assertRule(
      malformedSpeakerTurnDiarizationPackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'SPEAKER_TURN_OUT_OF_SOURCE'),
      'provider-driven orchestration exposes out-of-source speaker turn blocker',
    );
    assertRule(
      malformedSpeakerTurnDiarizationPackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'SPEAKER_TURN_UNKNOWN_TRANSCRIPT_SEGMENT'),
      'provider-driven orchestration exposes speaker turn unknown transcript blocker',
    );
    assertRule(
      malformedSpeakerTurnDiarizationPackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'SPEAKER_TURN_UNKNOWN_SPEAKER'),
      'provider-driven orchestration exposes speaker turn unknown speaker blocker',
    );
    assertRule(
      malformedSpeakerTurnDiarizationPackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'SPEAKER_TURN_SPEAKER_MISMATCH'),
      'provider-driven orchestration exposes speaker turn speaker mismatch blocker',
    );
    assertRule(malformedSpeakerTurnDiarizationPackage.speakerAlignment === undefined, 'provider-driven malformed speaker turns do not run speaker alignment');
    assertRule(malformedSpeakerTurnDiarizationPackage.executionPackage === undefined, 'provider-driven malformed speaker turns do not fabricate an execution package');

    const untraceableSpeakerTurnDiarizationPackage = await createSmartCutSpeechFirstExecutionPackageFromProviders({
      context: {
        ...providerContext,
        runId: 'run-provider-untraceable-speaker-turn-diarization',
      },
      speechToTextProvider: sttProvider,
      speakerDiarizationProvider: {
        id: 'untraceable-speaker-turn-diarization-provider',
        async diarize() {
          return {
            ...speechFirstSpeakerEvidence,
            turns: [
              {
                id: 'turn-no-transcript',
                speakerId: 'speaker-teacher',
                startMs: 1_000,
                endMs: 10_000,
                sentenceIds: [],
                transcriptSegmentIds: [],
                text: 'This provider turn has no transcript evidence.',
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
                endMs: 20_000,
                sentenceIds: ['sentence-blank-text'],
                transcriptSegmentIds: ['orchestration-segment-1'],
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
                startMs: 70_000,
                endMs: 80_000,
                sentenceIds: ['sentence-time-mismatch'],
                transcriptSegmentIds: ['orchestration-segment-1'],
                text: 'Planning starts with a clear goal.',
                isQuestion: false,
                isAnswerCandidate: true,
                isInterruption: false,
                isBackchannel: false,
                topicIds: ['topic-planning'],
                risks: [],
              },
            ],
          };
        },
      },
      llmReviewer: {
        id: 'should-not-run-after-untraceable-speaker-turn-diarization',
        model: 'fixture-llm',
        async review() {
          throw new Error('LLM review must not run when speaker turns are untraceable to transcript timing');
        },
      },
    });

    assertRule(untraceableSpeakerTurnDiarizationPackage.ready === false, 'provider-driven orchestration fails closed on untraceable speaker turns');
    assertRule(
      untraceableSpeakerTurnDiarizationPackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'SPEAKER_TURN_WITHOUT_TRANSCRIPT_SEGMENTS'),
      'provider-driven orchestration exposes speaker turn without transcript ids blocker',
    );
    assertRule(
      untraceableSpeakerTurnDiarizationPackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'SPEAKER_TURN_TEXT_MISSING'),
      'provider-driven orchestration exposes speaker turn missing text blocker',
    );
    assertRule(
      untraceableSpeakerTurnDiarizationPackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'SPEAKER_TURN_TRANSCRIPT_RANGE_MISMATCH'),
      'provider-driven orchestration exposes speaker turn transcript range mismatch blocker',
    );
    assertRule(untraceableSpeakerTurnDiarizationPackage.speakerAlignment === undefined, 'provider-driven untraceable speaker turns do not run speaker alignment');
    assertRule(untraceableSpeakerTurnDiarizationPackage.executionPackage === undefined, 'provider-driven untraceable speaker turns do not fabricate an execution package');

    const malformedDiarizationPackage = await createSmartCutSpeechFirstExecutionPackageFromProviders({
      context: {
        ...providerContext,
        runId: 'run-provider-malformed-diarization',
      },
      speechToTextProvider: sttProvider,
      speakerDiarizationProvider: {
        id: 'malformed-diarization-provider',
        async diarize() {
          return {
            ...speechFirstSpeakerEvidence,
            kind: 'not-speaker',
            schemaVersion: 'old-schema',
            profiles: [
              {
                id: ' ',
                displayName: ' ',
                role: 'lecturer',
                confidence: 1.4,
                source: 'external-provider',
              },
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
            segments: [
              { id: 'speaker-segment-malformed', speakerId: ' ', startMs: 900, endMs: 44_100, confidence: -0.1 },
            ],
          };
        },
      },
      llmReviewer: {
        id: 'should-not-run-after-malformed-diarization',
        model: 'fixture-llm',
        async review() {
          throw new Error('LLM review must not run when diarization evidence schema is malformed');
        },
      },
    });

    assertRule(malformedDiarizationPackage.ready === false, 'provider-driven orchestration fails closed on malformed diarization evidence schema');
    assertRule(
      malformedDiarizationPackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'SPEAKER_EVIDENCE_KIND_INVALID'),
      'provider-driven orchestration exposes speaker evidence kind blocker',
    );
    assertRule(
      malformedDiarizationPackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'SPEAKER_SCHEMA_VERSION_INVALID'),
      'provider-driven orchestration exposes speaker schema version blocker',
    );
    assertRule(
      malformedDiarizationPackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'SPEAKER_PROFILE_ID_MISSING'),
      'provider-driven orchestration exposes speaker profile id blocker',
    );
    assertRule(
      malformedDiarizationPackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'SPEAKER_PROFILE_DISPLAY_NAME_MISSING'),
      'provider-driven orchestration exposes speaker profile display name blocker',
    );
    assertRule(
      malformedDiarizationPackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'DUPLICATE_SPEAKER_PROFILE_ID'),
      'provider-driven orchestration exposes duplicate speaker profile id blocker',
    );
    assertRule(
      malformedDiarizationPackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'SPEAKER_PROFILE_CONFIDENCE_INVALID'),
      'provider-driven orchestration exposes speaker profile confidence blocker',
    );
    assertRule(
      malformedDiarizationPackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'SPEAKER_PROFILE_ROLE_INVALID'),
      'provider-driven orchestration exposes speaker profile role blocker',
    );
    assertRule(
      malformedDiarizationPackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'SPEAKER_PROFILE_SOURCE_INVALID'),
      'provider-driven orchestration exposes speaker profile source blocker',
    );
    assertRule(
      malformedDiarizationPackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'SPEAKER_SEGMENT_SPEAKER_ID_MISSING'),
      'provider-driven orchestration exposes speaker segment id blocker',
    );
    assertRule(
      malformedDiarizationPackage.blockers.some((blocker) => blocker.source === 'speaker-diarization' && blocker.code === 'SPEAKER_SEGMENT_CONFIDENCE_INVALID'),
      'provider-driven orchestration exposes speaker segment confidence blocker',
    );
    assertRule(malformedDiarizationPackage.speakerAlignment === undefined, 'provider-driven malformed diarization does not run speaker alignment');
    assertRule(malformedDiarizationPackage.executionPackage === undefined, 'provider-driven malformed diarization does not fabricate an execution package');

    const throwingSttPackage = await createSmartCutSpeechFirstExecutionPackageFromProviders({
      context: {
        ...providerContext,
        runId: 'run-provider-throwing-stt',
      },
      speechToTextProvider: {
        id: 'throwing-stt-provider',
        async transcribe() {
          throw new Error('fixture STT provider unavailable');
        },
      },
      speakerDiarizationProvider: {
        id: 'should-not-run-after-throwing-stt',
        async diarize() {
          throw new Error('diarization must not run when STT provider throws');
        },
      },
      llmReviewer,
    });

    assertRule(throwingSttPackage.ready === false, 'provider-driven orchestration converts STT provider exceptions into blocked results');
    assertRule(throwingSttPackage.auditTrace.blockerGroups.some((group) => group.source === 'speech-to-text' && group.codes.includes('SPEECH_TO_TEXT_PROVIDER_FAILED')), 'provider-driven throwing STT audit trace groups provider failure');
    assertRule(throwingSttPackage.stageStatuses.speechToText === 'blocked', 'provider-driven orchestration marks throwing STT stage blocked');
    assertRule(
      throwingSttPackage.blockers.some((blocker) => blocker.source === 'speech-to-text' && blocker.code === 'SPEECH_TO_TEXT_PROVIDER_FAILED'),
      'provider-driven orchestration exposes STT provider failure blocker',
    );
    assertRule(throwingSttPackage.executionPackage === undefined, 'provider-driven throwing STT package does not fabricate an execution package');

    const alignmentFailurePackage = await createSmartCutSpeechFirstExecutionPackageFromProviders({
      context: {
        ...providerContext,
        runId: 'run-provider-alignment-failure',
      },
      speechToTextProvider: sttProvider,
      speakerDiarizationProvider: {
        id: 'misaligned-diarization-provider',
        async diarize() {
          return {
            ...speechFirstSpeakerEvidence,
            segments: [
              { id: 'speaker-segment-misaligned-teacher', speakerId: 'speaker-teacher', startMs: 60_000, endMs: 70_000, confidence: 0.98 },
            ],
          };
        },
      },
      llmReviewer: {
        id: 'should-not-run-after-alignment-failure',
        model: 'fixture-llm',
        async review() {
          throw new Error('LLM review must not run when speaker alignment is blocked');
        },
      },
    });

    assertRule(alignmentFailurePackage.ready === false, 'provider-driven orchestration fails closed on transcript-speaker alignment failure');
    assertRule(alignmentFailurePackage.auditTrace.stages.some((stage) => stage.id === 'speaker-alignment' && stage.status === 'blocked'), 'provider-driven alignment failure audit trace marks alignment blocked');
    assertRule(alignmentFailurePackage.stageStatuses.speechToText === 'passed', 'provider-driven alignment failure keeps STT stage passed');
    assertRule(alignmentFailurePackage.stageStatuses.speakerDiarization === 'passed', 'provider-driven alignment failure keeps diarization stage passed');
    assertRule(alignmentFailurePackage.stageStatuses.speakerAlignment === 'blocked', 'provider-driven orchestration marks speaker alignment blocked');
    assertRule(alignmentFailurePackage.stageStatuses.llmProviderReview === 'blocked', 'provider-driven orchestration does not run LLM review after alignment failure');
    assertRule(alignmentFailurePackage.stageStatuses.llmReview === 'blocked', 'provider-driven orchestration marks LLM review blocked after alignment failure');
    assertRule(
      alignmentFailurePackage.blockers.some((blocker) => blocker.source === 'speaker-alignment' && blocker.code === 'TRANSCRIPT_SEGMENT_WITHOUT_SPEAKER_OVERLAP'),
      'provider-driven orchestration exposes alignment failure blocker',
    );
    assertRule(alignmentFailurePackage.llmReviewReport === undefined, 'provider-driven alignment failure does not fabricate LLM review evidence');
    assertRule(alignmentFailurePackage.executionPackage === undefined, 'provider-driven alignment failure does not fabricate an execution package');
    assertRule(
      alignmentFailurePackage.executionPackage?.filterPlan === undefined &&
        alignmentFailurePackage.executionPackage?.renderContract === undefined,
      'provider-driven alignment failure stops before filters and render',
    );

    const contentUnitFailurePackage = await createSmartCutSpeechFirstExecutionPackageFromProviders({
      context: {
        ...providerContext,
        runId: 'run-provider-content-unit-failure',
      },
      speechToTextProvider: {
        id: 'connector-stt-provider',
        async transcribe() {
          return {
            ...speechFirstTranscriptEvidence,
            segments: [
              {
                id: 'connector-segment',
                startMs: 1_000,
                endMs: 5_000,
                text: 'because',
                confidence: 0.96,
                language: 'en-US',
                speakerId: 'speaker-teacher',
              },
            ],
          };
        },
      },
      speakerDiarizationProvider: {
        id: 'connector-diarization-provider',
        async diarize() {
          return {
            ...speechFirstSpeakerEvidence,
            segments: [
              { id: 'speaker-segment-connector-teacher', speakerId: 'speaker-teacher', startMs: 900, endMs: 5_100, confidence: 0.98 },
            ],
          };
        },
      },
      llmReviewer: {
        id: 'should-not-run-after-content-unit-failure',
        model: 'fixture-llm',
        async review() {
          throw new Error('LLM review must not run when content unit build is blocked');
        },
      },
    });

    assertRule(contentUnitFailurePackage.ready === false, 'provider-driven orchestration fails closed on content unit build failure');
    assertRule(contentUnitFailurePackage.auditTrace.stages.some((stage) => stage.id === 'content-unit-build' && stage.status === 'blocked'), 'provider-driven content unit failure audit trace marks content unit build blocked');
    assertRule(contentUnitFailurePackage.stageStatuses.contentUnitBuild === 'blocked', 'provider-driven orchestration marks content unit build blocked');
    assertRule(contentUnitFailurePackage.stageStatuses.llmProviderReview === 'blocked', 'provider-driven orchestration does not run LLM review after content unit failure');
    assertRule(contentUnitFailurePackage.stageStatuses.llmReview === 'blocked', 'provider-driven orchestration marks LLM review blocked after content unit failure');
    assertRule(
      contentUnitFailurePackage.blockers.some((blocker) => blocker.source === 'content-unit-build' && blocker.code === 'DANGLING_CONNECTOR_CONTENT_UNIT'),
      'provider-driven orchestration exposes semantic content unit build blocker',
    );
    assertRule(contentUnitFailurePackage.llmReviewReport === undefined, 'provider-driven content unit failure does not fabricate LLM review evidence');
    assertRule(contentUnitFailurePackage.executionPackage === undefined, 'provider-driven content unit failure does not fabricate an execution package');
    assertRule(
      contentUnitFailurePackage.executionPackage?.filterPlan === undefined &&
        contentUnitFailurePackage.executionPackage?.renderContract === undefined,
      'provider-driven content unit failure stops before filters and render',
    );

    const throwingLlmPackage = await createSmartCutSpeechFirstExecutionPackageFromProviders({
      context: {
        ...providerContext,
        runId: 'run-provider-throwing-llm',
      },
      speechToTextProvider: sttProvider,
      speakerDiarizationProvider: diarizationProvider,
      llmReviewer: {
        id: 'throwing-llm-reviewer',
        model: 'fixture-llm',
        async review() {
          throw new Error('fixture LLM reviewer unavailable');
        },
      },
    });

    assertRule(throwingLlmPackage.ready === false, 'provider-driven orchestration converts LLM reviewer exceptions into blocked results');
    assertRule(throwingLlmPackage.auditTrace.stages.some((stage) => stage.id === 'llm-provider-review' && stage.status === 'blocked'), 'provider-driven throwing LLM audit trace marks provider review blocked');
    assertRule(throwingLlmPackage.stageStatuses.llmProviderReview === 'blocked', 'provider-driven orchestration marks throwing LLM stage blocked');
    assertRule(throwingLlmPackage.stageStatuses.llmReview === 'blocked', 'provider-driven orchestration marks LLM review blocked when reviewer throws');
    assertRule(
      throwingLlmPackage.blockers.some((blocker) => blocker.source === 'llm-review' && blocker.code === 'LLM_REVIEW_PROVIDER_FAILED'),
      'provider-driven orchestration exposes LLM reviewer failure blocker',
    );
    assertRule(throwingLlmPackage.llmReviewReport === undefined, 'provider-driven throwing LLM does not fabricate LLM review evidence');
    assertRule(throwingLlmPackage.executionPackage === undefined, 'provider-driven throwing LLM does not fabricate an execution package');
    assertRule(
      throwingLlmPackage.executionPackage?.filterPlan === undefined &&
        throwingLlmPackage.executionPackage?.renderContract === undefined,
      'provider-driven throwing LLM output stops before filters and render',
    );

    const rawTimestampProviderPackage = await createSmartCutSpeechFirstExecutionPackageFromProviders({
      context: {
        ...providerContext,
        runId: 'run-provider-raw-timestamp-llm',
      },
      speechToTextProvider: sttProvider,
      speakerDiarizationProvider: diarizationProvider,
      llmReviewer: {
        id: 'raw-timestamp-llm-reviewer',
        model: 'fixture-llm',
        async review() {
          return {
            rankedCandidateIds: ['speech-semantic-candidate-1'],
            referencedUnitIds: ['unit-1'],
            cuts: [{ startMs: 1_000, endMs: 44_000 }],
          };
        },
      },
    });

    assertRule(rawTimestampProviderPackage.ready === false, 'provider-driven orchestration fails closed when LLM provider returns raw timestamps');
    assertRule(rawTimestampProviderPackage.auditTrace.blockerGroups.some((group) => group.source === 'llm-review' && group.codes.includes('LLM_RAW_TIME_RANGE_REJECTED')), 'provider-driven raw timestamp audit trace groups LLM blocker');
    assertRule(rawTimestampProviderPackage.stageStatuses.llmProviderReview === 'blocked', 'provider-driven orchestration marks LLM provider stage blocked on raw timestamps');
    assertRule(
      rawTimestampProviderPackage.blockers.some((blocker) => blocker.source === 'llm-review' && blocker.code === 'LLM_RAW_TIME_RANGE_REJECTED'),
      'provider-driven orchestration exposes normalized raw timestamp LLM blocker',
    );
    assertRule(
      rawTimestampProviderPackage.executionPackage?.filterPlan === undefined &&
        rawTimestampProviderPackage.executionPackage?.renderContract === undefined,
      'provider-driven raw timestamp LLM output stops before filters and render',
    );
  }
}

if (failures.length > 0) {
  console.error(`blocked - smart cut speech semantic failures=${failures.length}`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`ok - smart cut speech semantic checks=${pass.length}`);
