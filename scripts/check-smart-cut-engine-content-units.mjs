#!/usr/bin/env node

import process from 'node:process';

import {
  SMART_CUT_STANDARD_VERSION,
  buildSmartCutContentUnits,
  validateSmartCutContentUnitBuildReport,
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

const teacherTranscriptEvidence = {
  kind: 'transcript',
  schemaVersion: SMART_CUT_STANDARD_VERSION,
  provider: 'fixture-stt',
  language: 'en-US',
  segments: [
    {
      id: 'teacher-segment-1',
      startMs: 1_000,
      endMs: 18_000,
      text: 'Planning starts with a clear goal.',
      confidence: 0.96,
      speakerId: 'speaker-teacher',
    },
    {
      id: 'teacher-segment-2',
      startMs: 18_200,
      endMs: 42_000,
      text: 'Then every activity and recommendation can support the same story.',
      confidence: 0.96,
      speakerId: 'speaker-teacher',
    },
    {
      id: 'teacher-filler',
      startMs: 42_200,
      endMs: 44_000,
      text: 'um',
      confidence: 0.85,
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
    { id: 'speaker-segment-teacher', speakerId: 'speaker-teacher', startMs: 900, endMs: 44_100, confidence: 0.98 },
  ],
  turns: [
    {
      id: 'teacher-turn-1',
      speakerId: 'speaker-teacher',
      startMs: 1_000,
      endMs: 42_000,
      sentenceIds: ['teacher-sentence-1', 'teacher-sentence-2'],
      transcriptSegmentIds: ['teacher-segment-1', 'teacher-segment-2'],
      text: 'Planning starts with a clear goal. Then every activity and recommendation can support the same story.',
      isQuestion: false,
      isAnswerCandidate: true,
      isInterruption: false,
      isBackchannel: false,
      topicIds: ['topic-planning'],
      risks: [],
    },
    {
      id: 'teacher-turn-filler',
      speakerId: 'speaker-teacher',
      startMs: 42_200,
      endMs: 44_000,
      sentenceIds: ['teacher-sentence-filler'],
      transcriptSegmentIds: ['teacher-filler'],
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
};

const teacherBuild = buildSmartCutContentUnits({
  presetId: 'teacher-talking-head-single',
  transcriptEvidence: teacherTranscriptEvidence,
  speakerEvidence: teacherSpeakerEvidence,
});

assertRule(teacherBuild.ready === true, 'teacher content unit build is ready');
assertRule(teacherBuild.units.length === 2, 'teacher build keeps publishable unit and low-information audit unit');
assertRule(teacherBuild.report.unitCount === 2, 'content unit report counts units');
assertRule(teacherBuild.report.publishableUnitCount === 1, 'content unit report counts publishable units');
assertRule(teacherBuild.report.lowInformationUnitCount === 1, 'content unit report counts low-information units');
assertRule(teacherBuild.report.blockers.length === 0, 'teacher content unit report has no blockers');
assertRule(teacherBuild.units[0]?.speakerIds.join(',') === 'speaker-teacher', 'content unit preserves teacher speaker id');
assertRule(teacherBuild.units[0]?.speakerTurnIds?.join(',') === 'teacher-turn-1', 'content unit preserves speaker turn id');
assertRule(teacherBuild.units[0]?.speakerRoles?.join(',') === 'teacher', 'content unit preserves speaker role');
assertRule(
  (teacherBuild.units[0]?.speakerConfidence ?? 0) >= 0.95,
  'content unit preserves speaker confidence from diarization evidence',
);
assertRule(
  teacherBuild.units[0]?.transcriptSegmentIds.join(',') === 'teacher-segment-1,teacher-segment-2',
  'content unit preserves transcript segment ids in order',
);
assertRule(
  teacherBuild.units[0]?.evidenceIds.includes('transcript') === true &&
    teacherBuild.units[0]?.evidenceIds.includes('speaker') === true,
  'content unit is explicitly backed by transcript and speaker evidence',
);

const connectorBridgeTranscriptEvidence = {
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
      speakerId: 'speaker-teacher',
    },
    {
      id: 'connector-bridge-payoff',
      startMs: 32_400,
      endMs: 41_000,
      text: 'So lead with the result and the retention payoff works.',
      confidence: 0.96,
      speakerId: 'speaker-teacher',
    },
  ],
};

const connectorBridgeSpeakerEvidence = {
  ...teacherSpeakerEvidence,
  segments: [
    { id: 'speaker-segment-connector-bridge', speakerId: 'speaker-teacher', startMs: 21_900, endMs: 41_100, confidence: 0.98 },
  ],
  turns: [
    {
      id: 'connector-bridge-turn',
      speakerId: 'speaker-teacher',
      startMs: 22_000,
      endMs: 41_000,
      sentenceIds: ['connector-bridge-setup-sentence', 'connector-bridge-payoff-sentence'],
      transcriptSegmentIds: ['connector-bridge-setup', 'connector-bridge-payoff'],
      text: 'Why viewers scroll is simple. Because the opening hides the problem, people do not know why they should care. So lead with the result and the retention payoff works.',
      isQuestion: false,
      isAnswerCandidate: true,
      isInterruption: false,
      isBackchannel: false,
      topicIds: ['topic-retention'],
      risks: [],
    },
  ],
};

const connectorBridgeBuild = buildSmartCutContentUnits({
  presetId: 'teacher-talking-head-single',
  transcriptEvidence: connectorBridgeTranscriptEvidence,
  speakerEvidence: connectorBridgeSpeakerEvidence,
});

assertRule(
  connectorBridgeBuild.ready === true,
  'content unit builder bridges short same-speaker pauses when the next segment is a semantic connector',
);
assertRule(
  connectorBridgeBuild.units.length === 1,
  'connector-led payoff stays inside the preceding complete semantic content unit',
);
assertRule(
  connectorBridgeBuild.units[0]?.transcriptSegmentIds.join(',') === 'connector-bridge-setup,connector-bridge-payoff',
  'connector bridge content unit preserves both transcript segment ids',
);
assertRule(
  !connectorBridgeBuild.report.blockers.some((blocker) => blocker.code === 'DANGLING_CONNECTOR_CONTENT_UNIT'),
  'connector bridge content unit does not report a dangling connector blocker',
);

const completeConnectorStartBuild = buildSmartCutContentUnits({
  presetId: 'teacher-talking-head-single',
  transcriptEvidence: {
    kind: 'transcript',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    provider: 'fixture-stt',
    language: 'en-US',
    segments: [
      {
        id: 'complete-connector-start',
        startMs: 1_000,
        endMs: 18_000,
        text: 'So speaker two interrupts quickly, but the answer completes the refund fix and gives the viewer the final result.',
        confidence: 0.95,
        speakerId: 'speaker-teacher',
      },
    ],
  },
  speakerEvidence: {
    ...teacherSpeakerEvidence,
    segments: [
      { id: 'speaker-segment-complete-connector-start', speakerId: 'speaker-teacher', startMs: 900, endMs: 18_100, confidence: 0.98 },
    ],
    turns: [
      {
        id: 'complete-connector-start-turn',
        speakerId: 'speaker-teacher',
        startMs: 1_000,
        endMs: 18_000,
        sentenceIds: ['complete-connector-start-sentence'],
        transcriptSegmentIds: ['complete-connector-start'],
        text: 'So speaker two interrupts quickly, but the answer completes the refund fix and gives the viewer the final result.',
        isQuestion: false,
        isAnswerCandidate: true,
        isInterruption: false,
        isBackchannel: false,
        topicIds: ['topic-refund'],
        risks: [],
      },
    ],
  },
});

assertRule(
  completeConnectorStartBuild.ready === true,
  'complete sentence that starts with a connector is not treated as dangling content',
);
assertRule(
  !completeConnectorStartBuild.report.blockers.some((blocker) => blocker.code === 'DANGLING_CONNECTOR_CONTENT_UNIT'),
  'complete connector-led sentence does not report dangling connector blocker',
);

const chineseCompleteConnectorStartBuild = buildSmartCutContentUnits({
  presetId: 'teacher-talking-head-single',
  transcriptEvidence: {
    kind: 'transcript',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    provider: 'fixture-stt',
    language: 'zh-CN',
    segments: [
      {
        id: 'chinese-complete-connector-start',
        startMs: 68_820,
        endMs: 138_560,
        text: '但是我最喜欢住的就是这种房子 因为我觉得接地气 我不喜欢住公寓 所以我住房子 我们自己在家做饭 这种比较舒服 跟在中国的感觉一样',
        confidence: 0.95,
        speakerId: 'speaker-teacher',
      },
    ],
  },
  speakerEvidence: {
    ...teacherSpeakerEvidence,
    segments: [
      { id: 'speaker-segment-chinese-complete-connector-start', speakerId: 'speaker-teacher', startMs: 68_820, endMs: 138_560, confidence: 0.98 },
    ],
    turns: [
      {
        id: 'chinese-complete-connector-start-turn',
        speakerId: 'speaker-teacher',
        startMs: 68_820,
        endMs: 138_560,
        sentenceIds: ['chinese-complete-connector-start-sentence'],
        transcriptSegmentIds: ['chinese-complete-connector-start'],
        text: '但是我最喜欢住的就是这种房子 因为我觉得接地气 我不喜欢住公寓 所以我住房子 我们自己在家做饭 这种比较舒服 跟在中国的感觉一样',
        isQuestion: false,
        isAnswerCandidate: true,
        isInterruption: false,
        isBackchannel: false,
        topicIds: ['topic-life-comparison'],
        risks: [],
      },
    ],
  },
});

assertRule(
  chineseCompleteConnectorStartBuild.ready === true,
  'complete Chinese connector-led spoken unit without punctuation is accepted as complete content',
);
assertRule(
  !chineseCompleteConnectorStartBuild.report.blockers.some((blocker) => blocker.code === 'DANGLING_CONNECTOR_CONTENT_UNIT'),
  'complete Chinese connector-led spoken unit does not report dangling connector blocker',
);

const chineseShortConnectorStartBuild = buildSmartCutContentUnits({
  presetId: 'teacher-talking-head-single',
  transcriptEvidence: {
    kind: 'transcript',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    provider: 'fixture-stt',
    language: 'zh-CN',
    segments: [
      {
        id: 'chinese-short-connector-start',
        startMs: 613_020,
        endMs: 615_900,
        text: '但是呢 现在呢 路确实多了',
        confidence: 0.95,
        speakerId: 'speaker-teacher',
      },
    ],
  },
  speakerEvidence: {
    ...teacherSpeakerEvidence,
    segments: [
      { id: 'speaker-segment-chinese-short-connector-start', speakerId: 'speaker-teacher', startMs: 613_020, endMs: 615_900, confidence: 0.98 },
    ],
    turns: [
      {
        id: 'chinese-short-connector-start-turn',
        speakerId: 'speaker-teacher',
        startMs: 613_020,
        endMs: 615_900,
        sentenceIds: ['chinese-short-connector-start-sentence'],
        transcriptSegmentIds: ['chinese-short-connector-start'],
        text: '但是呢 现在呢 路确实多了',
        isQuestion: false,
        isAnswerCandidate: true,
        isInterruption: false,
        isBackchannel: false,
        topicIds: ['topic-short-spoken-complete'],
        risks: [],
      },
    ],
  },
});

assertRule(
  chineseShortConnectorStartBuild.ready === true,
  'short complete Chinese connector-led spoken unit is accepted as complete content',
);
assertRule(
  !chineseShortConnectorStartBuild.report.blockers.some((blocker) => blocker.code === 'DANGLING_CONNECTOR_CONTENT_UNIT'),
  'short complete Chinese connector-led spoken unit does not report dangling connector blocker',
);

const chineseTrailingConnectorBridgeBuild = buildSmartCutContentUnits({
  presetId: 'teacher-talking-head-single',
  transcriptEvidence: {
    kind: 'transcript',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    provider: 'fixture-stt',
    language: 'zh-CN',
    segments: [
      {
        id: 'chinese-trailing-connector-setup',
        startMs: 2_600_000,
        endMs: 2_669_000,
        text: '旅游签证在美国做了任何事情会产生两个影响 第一个不能考驾照 第二个不能租房子 当然一般没人管你 但是',
        confidence: 0.95,
        speakerId: 'speaker-teacher',
      },
      {
        id: 'chinese-trailing-connector-payoff',
        startMs: 2_670_200,
        endMs: 2_690_000,
        text: '如果后面申请其他身份 签证官会重新看这段记录 所以最好从一开始就按合规路线处理',
        confidence: 0.95,
        speakerId: 'speaker-teacher',
      },
    ],
  },
  speakerEvidence: {
    ...teacherSpeakerEvidence,
    segments: [
      { id: 'speaker-segment-chinese-trailing-connector', speakerId: 'speaker-teacher', startMs: 2_600_000, endMs: 2_690_000, confidence: 0.98 },
    ],
    turns: [
      {
        id: 'chinese-trailing-connector-turn',
        speakerId: 'speaker-teacher',
        startMs: 2_600_000,
        endMs: 2_690_000,
        sentenceIds: ['chinese-trailing-connector-setup-sentence', 'chinese-trailing-connector-payoff-sentence'],
        transcriptSegmentIds: ['chinese-trailing-connector-setup', 'chinese-trailing-connector-payoff'],
        text: '旅游签证在美国做了任何事情会产生两个影响 第一个不能考驾照 第二个不能租房子 当然一般没人管你 但是 如果后面申请其他身份 签证官会重新看这段记录 所以最好从一开始就按合规路线处理',
        isQuestion: false,
        isAnswerCandidate: true,
        isInterruption: false,
        isBackchannel: false,
        topicIds: ['topic-visa-compliance'],
        risks: [],
      },
    ],
  },
});

assertRule(
  chineseTrailingConnectorBridgeBuild.ready === true,
  'Chinese content unit ending with a connector is bridged into the following semantic unit',
);
assertRule(
  chineseTrailingConnectorBridgeBuild.units.length === 1,
  'trailing connector bridge keeps setup and payoff in one complete content unit',
);
assertRule(
  !chineseTrailingConnectorBridgeBuild.report.blockers.some((blocker) => blocker.code === 'DANGLING_CONNECTOR_CONTENT_UNIT'),
  'trailing connector bridge does not report dangling connector blocker',
);

const longSameSpeakerSegments = Array.from({ length: 8 }, (_, index) => ({
  id: `long-same-speaker-segment-${index + 1}`,
  startMs: index * 12_000,
  endMs: index * 12_000 + 11_500,
  text: `Complete teaching point ${index + 1} states the problem, explains the cause, and gives a clear result for the viewer.`,
  confidence: 0.95,
  speakerId: 'speaker-teacher',
}));
const longSameSpeakerBuild = buildSmartCutContentUnits({
  presetId: 'teacher-talking-head-single',
  transcriptEvidence: {
    kind: 'transcript',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    provider: 'fixture-stt',
    language: 'en-US',
    segments: longSameSpeakerSegments,
  },
  speakerEvidence: {
    ...teacherSpeakerEvidence,
    segments: [
      { id: 'speaker-segment-long-same-speaker', speakerId: 'speaker-teacher', startMs: 0, endMs: 96_000, confidence: 0.98 },
    ],
    turns: [
      {
        id: 'long-same-speaker-turn',
        speakerId: 'speaker-teacher',
        startMs: 0,
        endMs: 95_500,
        sentenceIds: longSameSpeakerSegments.map((segment) => `sentence-${segment.id}`),
        transcriptSegmentIds: longSameSpeakerSegments.map((segment) => segment.id),
        text: longSameSpeakerSegments.map((segment) => segment.text).join(' '),
        isQuestion: false,
        isAnswerCandidate: true,
        isInterruption: false,
        isBackchannel: false,
        topicIds: ['topic-long-teaching'],
        risks: [],
      },
    ],
  },
});

assertRule(
  longSameSpeakerBuild.ready === true,
  'long same-speaker talking-head content unit build is ready',
);
assertRule(
  longSameSpeakerBuild.units.length > 1,
  'long same-speaker talking-head content is split into multiple complete content units',
);
assertRule(
  longSameSpeakerBuild.units.every((unit) => unit.endMs - unit.startMs <= 60_000),
  'long same-speaker content units stay within a publishable semantic window',
);

const teacherValidation = validateSmartCutContentUnitBuildReport(teacherBuild.report);
assertRule(teacherValidation.ready === true, 'valid content unit build report passes validation');
assertRule(teacherValidation.blockers.length === 0, 'valid content unit build report has no validation blockers');

const missingTurnBuild = buildSmartCutContentUnits({
  presetId: 'teacher-talking-head-single',
  transcriptEvidence: teacherTranscriptEvidence,
  speakerEvidence: {
    ...teacherSpeakerEvidence,
    turns: [],
  },
});

assertRule(missingTurnBuild.ready === false, 'content unit build fails closed when speaker turns are missing');
assertRule(
  missingTurnBuild.report.blockers.some((blocker) => blocker.code === 'CONTENT_UNIT_WITHOUT_SPEAKER_TURN'),
  'missing speaker turn is reported when content units cannot trace turn evidence',
);

const dialogueTranscriptEvidence = {
  kind: 'transcript',
  schemaVersion: SMART_CUT_STANDARD_VERSION,
  provider: 'fixture-stt',
  language: 'en-US',
  segments: [
    {
      id: 'question-segment',
      startMs: 2_000,
      endMs: 10_000,
      text: 'When should families start planning?',
      confidence: 0.96,
      speakerId: 'speaker-host',
    },
    {
      id: 'answer-segment',
      startMs: 10_200,
      endMs: 48_000,
      text: 'They should start early because strong evidence needs time to accumulate.',
      confidence: 0.96,
      speakerId: 'speaker-guest',
    },
  ],
};

const dialogueSpeakerEvidence = {
  kind: 'speaker',
  schemaVersion: SMART_CUT_STANDARD_VERSION,
  profiles: [
    { id: 'speaker-host', displayName: 'Host', role: 'interviewer', confidence: 0.95, source: 'diarization' },
    { id: 'speaker-guest', displayName: 'Guest', role: 'guest', confidence: 0.96, source: 'diarization' },
  ],
  segments: [
    { id: 'speaker-segment-dialogue-host', speakerId: 'speaker-host', startMs: 2_000, endMs: 10_000, confidence: 0.95 },
    { id: 'speaker-segment-dialogue-guest', speakerId: 'speaker-guest', startMs: 10_200, endMs: 48_000, confidence: 0.96 },
  ],
  turns: [
    {
      id: 'dialogue-turn-question',
      speakerId: 'speaker-host',
      startMs: 2_000,
      endMs: 10_000,
      sentenceIds: ['dialogue-sentence-question'],
      transcriptSegmentIds: ['question-segment'],
      text: 'When should families start planning?',
      isQuestion: true,
      isAnswerCandidate: false,
      isInterruption: false,
      isBackchannel: false,
      topicIds: ['topic-planning'],
      risks: [],
    },
    {
      id: 'dialogue-turn-answer',
      speakerId: 'speaker-guest',
      startMs: 10_200,
      endMs: 48_000,
      sentenceIds: ['dialogue-sentence-answer'],
      transcriptSegmentIds: ['answer-segment'],
      text: 'They should start early because strong evidence needs time to accumulate.',
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
    { speakerId: 'speaker-host', role: 'interviewer', confidence: 0.95, evidenceTurnIds: [], source: 'rule' },
    { speakerId: 'speaker-guest', role: 'guest', confidence: 0.96, evidenceTurnIds: [], source: 'rule' },
  ],
  corrections: [],
};

const dialogueBuild = buildSmartCutContentUnits({
  presetId: 'interview-one-question-one-answer',
  transcriptEvidence: dialogueTranscriptEvidence,
  speakerEvidence: dialogueSpeakerEvidence,
});

assertRule(dialogueBuild.ready === true, 'dialogue content unit build is ready');
assertRule(dialogueBuild.units.length === 2, 'dialogue build creates separate speaker-aware units');
assertRule(dialogueBuild.units[0]?.unitKind === 'qa-pair', 'question unit is marked as QA boundary unit');
assertRule(dialogueBuild.units[1]?.unitKind === 'qa-pair', 'answer unit is marked as QA boundary unit');
assertRule(dialogueBuild.units[0]?.speakerTurnIds?.join(',') === 'dialogue-turn-question', 'dialogue question unit preserves turn id');
assertRule(dialogueBuild.units[1]?.speakerTurnIds?.join(',') === 'dialogue-turn-answer', 'dialogue answer unit preserves turn id');
assertRule(dialogueBuild.units[0]?.speakerRoles?.join(',') === 'interviewer', 'dialogue question unit preserves interviewer role');
assertRule(dialogueBuild.units[1]?.speakerRoles?.join(',') === 'guest', 'dialogue answer unit preserves guest role');
assertRule(dialogueBuild.report.questionUnitCount === 1, 'dialogue build report counts question units');
assertRule(dialogueBuild.report.answerUnitCount === 1, 'dialogue build report counts answer units');
assertRule(dialogueBuild.report.distinctSpeakerCount === 2, 'dialogue build report tracks distinct speakers');

const overlapTranscriptEvidence = {
  kind: 'transcript',
  schemaVersion: SMART_CUT_STANDARD_VERSION,
  provider: 'fixture-stt',
  language: 'en-US',
  segments: [
    {
      id: 'overlap-question',
      startMs: 2_000,
      endMs: 10_000,
      text: 'When should the team decide?',
      confidence: 0.96,
      speakerId: 'speaker-host',
    },
    {
      id: 'overlap-answer',
      startMs: 9_600,
      endMs: 28_000,
      text: 'They should decide after the risk owner confirms the deadline.',
      confidence: 0.96,
      speakerId: 'speaker-guest',
    },
  ],
};

const overlapSpeakerEvidence = {
  kind: 'speaker',
  schemaVersion: SMART_CUT_STANDARD_VERSION,
  profiles: dialogueSpeakerEvidence.profiles,
  segments: [
    { id: 'speaker-segment-overlap-host', speakerId: 'speaker-host', startMs: 2_000, endMs: 10_000, confidence: 0.95, overlapGroupId: 'overlap-1' },
    { id: 'speaker-segment-overlap-guest', speakerId: 'speaker-guest', startMs: 9_600, endMs: 28_000, confidence: 0.96, overlapGroupId: 'overlap-1' },
  ],
  turns: [
    {
      id: 'overlap-turn-question',
      speakerId: 'speaker-host',
      startMs: 2_000,
      endMs: 10_000,
      sentenceIds: ['overlap-sentence-question'],
      transcriptSegmentIds: ['overlap-question'],
      text: 'When should the team decide?',
      isQuestion: true,
      isAnswerCandidate: false,
      isInterruption: false,
      isBackchannel: false,
      topicIds: ['topic-meeting'],
      risks: ['overlap'],
    },
    {
      id: 'overlap-turn-answer',
      speakerId: 'speaker-guest',
      startMs: 9_600,
      endMs: 28_000,
      sentenceIds: ['overlap-sentence-answer'],
      transcriptSegmentIds: ['overlap-answer'],
      text: 'They should decide after the risk owner confirms the deadline.',
      isQuestion: false,
      isAnswerCandidate: true,
      isInterruption: true,
      isBackchannel: false,
      topicIds: ['topic-meeting'],
      risks: ['overlap'],
    },
  ],
  overlappingSpeechGroups: [
    {
      id: 'overlap-1',
      startMs: 9_600,
      endMs: 10_000,
      speakerIds: ['speaker-host', 'speaker-guest'],
      segmentIds: ['speaker-segment-overlap-host', 'speaker-segment-overlap-guest'],
      severity: 'medium',
    },
  ],
  roleAssignments: dialogueSpeakerEvidence.roleAssignments,
  corrections: [],
};

const overlapBuild = buildSmartCutContentUnits({
  presetId: 'interview-one-question-one-answer',
  transcriptEvidence: overlapTranscriptEvidence,
  speakerEvidence: overlapSpeakerEvidence,
});

assertRule(overlapBuild.ready === true, 'overlap dialogue content unit build is ready');
assertRule(
  overlapBuild.units[0]?.overlapGroupIds?.join(',') === 'overlap-1' &&
    overlapBuild.units[1]?.overlapGroupIds?.join(',') === 'overlap-1',
  'content units preserve overlapping speech group ids',
);
assertRule(
  overlapBuild.units[1]?.speakerTurnIds?.join(',') === 'overlap-turn-answer' &&
    overlapBuild.units[1]?.speakerRoles?.join(',') === 'guest',
  'overlap answer unit preserves turn id and speaker role',
);

const danglingConnectorBuild = buildSmartCutContentUnits({
  presetId: 'teacher-talking-head-single',
  transcriptEvidence: {
    kind: 'transcript',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    provider: 'fixture-stt',
    language: 'en-US',
    segments: [
      {
        id: 'dangling-segment',
        startMs: 1_000,
        endMs: 18_000,
        text: 'The strategy works because',
        confidence: 0.95,
        speakerId: 'speaker-teacher',
      },
    ],
  },
  speakerEvidence: teacherSpeakerEvidence,
});

assertRule(danglingConnectorBuild.ready === false, 'dangling connector content unit build fails closed');
assertRule(
  danglingConnectorBuild.report.blockers.some((blocker) => blocker.code === 'DANGLING_CONNECTOR_CONTENT_UNIT'),
  'dangling connector unit is reported as a blocker',
);

const shortCompleteConnectorLedBuild = buildSmartCutContentUnits({
  presetId: 'teacher-talking-head-single',
  transcriptEvidence: {
    kind: 'transcript',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    provider: 'fixture-stt',
    language: 'en-US',
    segments: [
      {
        id: 'short-complete-connector-led',
        startMs: 55_000,
        endMs: 60_700,
        text: 'Then keep only the complete spoken payoff.',
        confidence: 0.95,
        speakerId: 'speaker-teacher',
      },
    ],
  },
  speakerEvidence: {
    ...teacherSpeakerEvidence,
    segments: [
      { id: 'speaker-segment-short-complete-connector-led', speakerId: 'speaker-teacher', startMs: 55_000, endMs: 60_700, confidence: 0.98 },
    ],
    turns: [
      {
        id: 'short-complete-connector-led-turn',
        speakerId: 'speaker-teacher',
        role: 'teacher',
        startMs: 55_000,
        endMs: 60_700,
        confidence: 0.98,
        sentenceIds: ['short-complete-connector-led-sentence'],
        transcriptSegmentIds: ['short-complete-connector-led'],
      },
    ],
  },
});

assertRule(
  shortCompleteConnectorLedBuild.ready === true,
  'short complete connector-led sentence is accepted as a complete speech content unit',
);
assertRule(
  !shortCompleteConnectorLedBuild.report.blockers.some((blocker) => blocker.code === 'DANGLING_CONNECTOR_CONTENT_UNIT'),
  'short complete connector-led sentence does not report dangling connector blocker',
);

const brokenDialogueBuild = buildSmartCutContentUnits({
  presetId: 'interview-one-question-one-answer',
  transcriptEvidence: {
    kind: 'transcript',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    provider: 'fixture-stt',
    language: 'en-US',
    segments: [
      {
        id: 'orphan-question',
        startMs: 2_000,
        endMs: 10_000,
        text: 'When should families start planning?',
        confidence: 0.96,
        speakerId: 'speaker-host',
      },
    ],
  },
  speakerEvidence: {
    ...dialogueSpeakerEvidence,
    segments: [
      { id: 'speaker-segment-orphan-host', speakerId: 'speaker-host', startMs: 2_000, endMs: 10_000, confidence: 0.95 },
    ],
  },
});

assertRule(brokenDialogueBuild.ready === false, 'dialogue content unit build fails when question has no answer');
assertRule(
  brokenDialogueBuild.report.blockers.some((blocker) => blocker.code === 'QUESTION_UNIT_WITHOUT_ANSWER_UNIT'),
  'orphan question is reported as a content unit blocker',
);

const crossSpeakerMergedReport = validateSmartCutContentUnitBuildReport({
  ...dialogueBuild.report,
  units: [
    {
      id: 'unit-cross-speaker',
      startMs: 2_000,
      endMs: 48_000,
      unitKind: 'content-unit',
      text: 'When should families start planning? They should start early.',
      speakerIds: ['speaker-host', 'speaker-guest'],
      speakerTurnIds: ['dialogue-turn-question', 'dialogue-turn-answer'],
      speakerRoles: ['interviewer', 'guest'],
      speakerConfidence: 0.95,
      overlapGroupIds: [],
      transcriptSegmentIds: ['question-segment', 'answer-segment'],
      evidenceIds: ['transcript', 'speaker'],
      topicIds: ['topic-unknown'],
      completenessScore: 0.9,
      continuityScore: 0.9,
      publishabilityScore: 0.9,
    },
  ],
});

assertRule(crossSpeakerMergedReport.ready === false, 'content unit report rejects cross-speaker merged unit');
assertRule(
  crossSpeakerMergedReport.blockers.some((blocker) => blocker.code === 'CONTENT_UNIT_CROSSES_SPEAKERS'),
  'cross-speaker unit is reported as a blocker',
);

const missingSpeakerContextReport = validateSmartCutContentUnitBuildReport({
  ...dialogueBuild.report,
  units: [
    {
      id: 'unit-missing-speaker-context',
      startMs: 2_000,
      endMs: 10_000,
      unitKind: 'qa-pair',
      text: 'When should families start planning?',
      speakerIds: ['speaker-host'],
      speakerTurnIds: [],
      speakerRoles: [],
      speakerConfidence: 0,
      overlapGroupIds: [],
      transcriptSegmentIds: ['question-segment'],
      evidenceIds: ['transcript', 'speaker'],
      topicIds: ['topic-unknown'],
      completenessScore: 0.9,
      continuityScore: 0.9,
      publishabilityScore: 0.9,
    },
  ],
});

assertRule(missingSpeakerContextReport.ready === false, 'content unit report rejects missing speaker context');
assertRule(
  missingSpeakerContextReport.blockers.some((blocker) => blocker.code === 'CONTENT_UNIT_WITHOUT_SPEAKER_TURN'),
  'missing speaker turn is reported as a content unit blocker',
);
assertRule(
  missingSpeakerContextReport.blockers.some((blocker) => blocker.code === 'CONTENT_UNIT_WITHOUT_SPEAKER_ROLE'),
  'missing speaker role is reported as a content unit blocker',
);
assertRule(
  missingSpeakerContextReport.blockers.some((blocker) => blocker.code === 'CONTENT_UNIT_LOW_SPEAKER_CONFIDENCE'),
  'low speaker confidence is reported as a content unit blocker',
);

const missingEvidenceKindReport = validateSmartCutContentUnitBuildReport({
  ...teacherBuild.report,
  units: [
    {
      ...teacherBuild.units[0],
      evidenceIds: ['transcript'],
    },
  ],
});

assertRule(missingEvidenceKindReport.ready === false, 'content unit report rejects missing speaker evidence id');
assertRule(
  missingEvidenceKindReport.blockers.some((blocker) => blocker.code === 'CONTENT_UNIT_WITHOUT_SPEAKER_EVIDENCE'),
  'missing speaker evidence id is reported as a content unit blocker',
);

if (failures.length > 0) {
  console.error(`blocked - smart cut content unit failures=${failures.length}`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`ok - smart cut content unit checks=${pass.length}`);
