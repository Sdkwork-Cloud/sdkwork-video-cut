#!/usr/bin/env node

import process from 'node:process';

import {
  SMART_CUT_STANDARD_VERSION,
  alignSmartCutTranscriptSpeakers,
  createSmartCutExecutionAuditTrace,
  createSmartCutExecutionPackage,
  createSmartCutProviderExecutionAuditTrace,
  normalizeSmartCutLlmCandidateReview,
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

function getStage(trace, stageId) {
  return trace.stages.find((stage) => stage.id === stageId);
}

const contentUnits = [
  {
    id: 'unit-1',
    startMs: 1_000,
    endMs: 24_000,
    unitKind: 'content-unit',
    text: 'A complete setup for a planning lesson.',
    speakerIds: ['speaker-teacher'],
    speakerTurnIds: ['turn-speaker-teacher-1'],
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
    speakerTurnIds: ['turn-speaker-teacher-1'],
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

const contentUnitBuildReport = validateSmartCutContentUnitBuildReport({
  ready: true,
  presetId: 'teacher-talking-head-single',
  units: contentUnits,
  unitCount: contentUnits.length,
  publishableUnitCount: contentUnits.length,
  lowInformationUnitCount: 0,
  questionUnitCount: 0,
  answerUnitCount: 0,
  distinctSpeakerCount: 1,
  blockers: [],
});

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
      text: 'A complete setup for a planning lesson.',
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
      id: 'turn-speaker-teacher-1',
      speakerId: 'speaker-teacher',
      startMs: 1_000,
      endMs: 61_000,
      sentenceIds: ['sentence-segment-1', 'sentence-segment-2'],
      transcriptSegmentIds: ['segment-1', 'segment-2'],
      text: 'A complete setup for a planning lesson. A complete payoff that can stand alone as a publishable clip.',
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
      evidenceTurnIds: ['turn-speaker-teacher-1'],
      source: 'rule',
    },
  ],
  corrections: [],
};

const speakerAlignmentReport = alignSmartCutTranscriptSpeakers({
  transcriptEvidence,
  speakerEvidence: {
    ...speakerEvidence,
    turns: [],
    roleAssignments: speakerEvidence.roleAssignments.map((assignment) => ({
      ...assignment,
      evidenceTurnIds: [],
    })),
  },
}).report;

const llmReviewReport = normalizeSmartCutLlmCandidateReview({
  model: 'fixture-llm',
  availableCandidateIds: ['candidate-1'],
  availableUnitIds: ['unit-1', 'unit-2'],
  rawReview: {
    rankedCandidateIds: ['candidate-1'],
    referencedUnitIds: ['unit-1', 'unit-2'],
    reviewNotes: ['candidate-1 preserves the complete setup and payoff.'],
  },
});

const filterEffectLlmReviewReport = normalizeSmartCutLlmCandidateReview({
  model: 'fixture-llm',
  availableCandidateIds: ['candidate-filter-effect'],
  availableUnitIds: ['unit-1', 'unit-2'],
  rawReview: {
    rankedCandidateIds: ['candidate-filter-effect'],
    referencedUnitIds: ['unit-1', 'unit-2'],
    reviewNotes: ['candidate-filter-effect is valid before destructive filter validation.'],
  },
});

const renderArtifactLlmReviewReport = normalizeSmartCutLlmCandidateReview({
  model: 'fixture-llm',
  availableCandidateIds: ['candidate-render-artifact'],
  availableUnitIds: ['unit-1', 'unit-2'],
  rawReview: {
    rankedCandidateIds: ['candidate-render-artifact'],
    referencedUnitIds: ['unit-1', 'unit-2'],
    reviewNotes: ['candidate-render-artifact preserves the complete setup before render artifact validation.'],
  },
});

const validPackage = createSmartCutExecutionPackage({
  runId: 'run-trace-valid',
  sourceMedia: {
    id: 'media-trace-valid',
    uri: 'file:///teacher.mp4',
    mediaKind: 'talking-head',
    durationMs: 120_000,
    width: 1080,
    height: 1920,
    frameRateFps: 30,
  },
  transcriptEvidence,
  speakerEvidence,
  speakerAlignmentReport,
  contentUnits,
  contentUnitBuildReport,
  llmReviewReport,
  plan: {
    id: 'speech-plan-trace-valid',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    sourceMediaId: 'media-trace-valid',
    presetId: 'teacher-talking-head-single',
    candidates: [
      {
        id: 'candidate-1',
        slicerId: 'speech-semantic',
        startMs: 1_000,
        endMs: 61_000,
        unitIds: ['unit-1', 'unit-2'],
        title: 'Complete planning clip',
        reason: 'Contains a complete setup and payoff.',
        confidence: 0.92,
        risks: [],
      },
    ],
  },
});

const validTrace = createSmartCutExecutionAuditTrace(validPackage);
assertRule(validTrace.schemaVersion === SMART_CUT_STANDARD_VERSION, 'audit trace uses smart cut standard version');
assertRule(validTrace.runId === 'run-trace-valid', 'audit trace preserves run id');
assertRule(validTrace.ready === true, 'ready execution package creates ready audit trace');
assertRule(validTrace.summary.selectedCandidateCount === 1, 'audit trace records selected candidate count');
assertRule(validTrace.summary.rejectedCandidateCount === 0, 'audit trace records rejected candidate count');
assertRule(validTrace.summary.llmRankedCandidateCount === 1, 'audit trace records LLM ranked candidate count');
assertRule(validTrace.summary.nativeRequestCount === 5, 'audit trace records native request count');
assertRule(validTrace.summary.contentUnitCount === 2, 'audit trace records content unit build unit count');
assertRule(validTrace.summary.publishableContentUnitCount === 2, 'audit trace records publishable content unit count');
assertRule(validTrace.summary.blockerCount === 0, 'audit trace records blocker count');
assertRule(validTrace.summary.speakerAlignmentBlockerCount === 0, 'audit trace records zero speaker alignment blockers for ready package');
assertRule(validTrace.summary.llmReviewBlockerCount === 0, 'audit trace records zero LLM review blockers for ready package');
assertRule(validTrace.summary.candidateValidationBlockerCount === 0, 'audit trace records zero candidate validation blockers for ready package');
assertRule(validTrace.summary.candidateContentUnitStructureBlockerCount === 0, 'audit trace records zero content unit structure blockers for ready package');
assertRule(validTrace.summary.candidateSpeakerContextBlockerCount === 0, 'audit trace records zero speaker context blockers for ready package');
assertRule(validTrace.summary.blockedBeforeFilterPlan === false, 'audit trace records ready package was not blocked before filter planning');
assertRule(getStage(validTrace, 'speaker-alignment')?.status === 'passed', 'audit trace marks speaker alignment stage passed');
assertRule(getStage(validTrace, 'content-unit-build')?.status === 'passed', 'audit trace marks content unit build stage passed');
assertRule(getStage(validTrace, 'llm-review')?.status === 'passed', 'audit trace marks LLM review stage passed');
assertRule(getStage(validTrace, 'semantic-boundary')?.status === 'passed', 'audit trace marks semantic boundary stage passed');
assertRule(getStage(validTrace, 'filter-effect-validation')?.status === 'not-run', 'audit trace marks absent filter effects as not-run');
assertRule(getStage(validTrace, 'render-validation')?.status === 'passed', 'audit trace marks render validation passed');
assertRule(
  validTrace.nativeCommandIds.join('>') === [
    'smart_cut_validate_candidates',
    'smart_cut_apply_filter_plan',
    'smart_cut_validate_filtered_plan',
    'smart_cut_render_plan',
    'smart_cut_probe_artifacts',
  ].join('>'),
  'audit trace records deterministic native command order',
);
assertRule(validTrace.blockerGroups.length === 0, 'ready audit trace has no blocker groups');

const invalidContentUnitBuildReport = validateSmartCutContentUnitBuildReport({
  ...contentUnitBuildReport,
  units: [
    {
      id: 'unit-trace-dangling-build',
      startMs: 1_000,
      endMs: 20_000,
      unitKind: 'content-unit',
      text: 'The planning method works because',
      speakerIds: ['speaker-teacher'],
      speakerTurnIds: ['turn-trace-dangling-build'],
      speakerRoles: ['teacher'],
      speakerConfidence: 0.98,
      overlapGroupIds: [],
      transcriptSegmentIds: ['segment-trace-dangling-build'],
      evidenceIds: ['transcript', 'speaker'],
      topicIds: ['topic-planning'],
      completenessScore: 0.92,
      continuityScore: 0.9,
      publishabilityScore: 0.9,
    },
  ],
});

const invalidContentUnitBuildPackage = createSmartCutExecutionPackage({
  runId: 'run-trace-invalid-content-unit-build',
  sourceMedia: {
    id: 'media-trace-content-unit-build',
    uri: 'file:///teacher.mp4',
    mediaKind: 'talking-head',
    durationMs: 120_000,
  },
  contentUnits: invalidContentUnitBuildReport.units,
  contentUnitBuildReport: invalidContentUnitBuildReport,
  plan: {
    id: 'speech-plan-trace-invalid-content-unit-build',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    sourceMediaId: 'media-trace-content-unit-build',
    presetId: 'teacher-talking-head-single',
    candidates: [
      {
        id: 'candidate-trace-dangling-build',
        slicerId: 'speech-semantic',
        startMs: 1_000,
        endMs: 20_000,
        unitIds: ['unit-trace-dangling-build'],
        title: 'Dangling content unit',
        reason: 'Build report should block this before filters.',
        confidence: 0.91,
        risks: [],
      },
    ],
  },
});

const invalidContentUnitBuildTrace = createSmartCutExecutionAuditTrace(invalidContentUnitBuildPackage);
assertRule(invalidContentUnitBuildTrace.ready === false, 'invalid content unit build package creates blocked audit trace');
assertRule(
  getStage(invalidContentUnitBuildTrace, 'content-unit-build')?.status === 'blocked',
  'audit trace marks content unit build stage blocked',
);
assertRule(
  getStage(invalidContentUnitBuildTrace, 'filter-plan')?.status === 'not-run',
  'audit trace shows content unit build blocker prevents filter planning',
);
assertRule(
  invalidContentUnitBuildTrace.blockerGroups.some((group) =>
    group.source === 'content-unit-build' &&
    group.codes.includes('DANGLING_CONNECTOR_CONTENT_UNIT')
  ),
  'audit trace groups content unit build blockers by source',
);

const missingContentUnitBuildReportPackage = createSmartCutExecutionPackage({
  runId: 'run-trace-missing-content-unit-build-report',
  sourceMedia: {
    id: 'media-trace-missing-content-unit-build-report',
    uri: 'file:///teacher.mp4',
    mediaKind: 'talking-head',
    durationMs: 120_000,
  },
  transcriptEvidence,
  speakerEvidence,
  speakerAlignmentReport,
  contentUnits,
  plan: {
    id: 'speech-plan-trace-missing-content-unit-build-report',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    sourceMediaId: 'media-trace-missing-content-unit-build-report',
    presetId: 'teacher-talking-head-single',
    candidates: [
      {
        id: 'candidate-trace-missing-content-unit-build-report',
        slicerId: 'speech-semantic',
        startMs: 1_000,
        endMs: 61_000,
        unitIds: ['unit-1', 'unit-2'],
        title: 'Missing content unit build report',
        reason: 'Trace must expose the missing build report gate.',
        confidence: 0.92,
        risks: [],
      },
    ],
  },
});

const missingContentUnitBuildReportTrace = createSmartCutExecutionAuditTrace(missingContentUnitBuildReportPackage);
assertRule(missingContentUnitBuildReportTrace.ready === false, 'missing content unit build report creates blocked audit trace');
assertRule(
  getStage(missingContentUnitBuildReportTrace, 'content-unit-build')?.status === 'blocked',
  'audit trace marks missing content unit build report stage blocked',
);
assertRule(
  missingContentUnitBuildReportTrace.blockerGroups.some((group) =>
    group.source === 'content-unit-build' &&
    group.codes.includes('MISSING_CONTENT_UNIT_BUILD_REPORT')
  ),
  'audit trace groups missing content unit build report blocker by source',
);
assertRule(
  getStage(missingContentUnitBuildReportTrace, 'filter-plan')?.status === 'not-run',
  'audit trace shows missing build report prevents filter planning',
);

const missingSpeakerAlignmentReportPackage = createSmartCutExecutionPackage({
  runId: 'run-trace-missing-speaker-alignment-report',
  sourceMedia: {
    id: 'media-trace-missing-speaker-alignment-report',
    uri: 'file:///teacher.mp4',
    mediaKind: 'talking-head',
    durationMs: 120_000,
  },
  transcriptEvidence,
  speakerEvidence,
  contentUnits,
  contentUnitBuildReport,
  plan: {
    id: 'speech-plan-trace-missing-speaker-alignment-report',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    sourceMediaId: 'media-trace-missing-speaker-alignment-report',
    presetId: 'teacher-talking-head-single',
    candidates: [
      {
        id: 'candidate-trace-missing-speaker-alignment-report',
        slicerId: 'speech-semantic',
        startMs: 1_000,
        endMs: 61_000,
        unitIds: ['unit-1', 'unit-2'],
        title: 'Missing speaker alignment report',
        reason: 'Trace must expose the missing speaker alignment gate.',
        confidence: 0.92,
        risks: [],
      },
    ],
  },
});

const missingSpeakerAlignmentReportTrace = createSmartCutExecutionAuditTrace(missingSpeakerAlignmentReportPackage);
assertRule(missingSpeakerAlignmentReportTrace.ready === false, 'missing speaker alignment report creates blocked audit trace');
assertRule(
  getStage(missingSpeakerAlignmentReportTrace, 'speaker-alignment')?.status === 'blocked',
  'audit trace marks missing speaker alignment report stage blocked',
);
assertRule(
  missingSpeakerAlignmentReportTrace.summary.speakerAlignmentBlockerCount === 1,
  'audit trace summary records speaker alignment blocker count',
);
assertRule(
  missingSpeakerAlignmentReportTrace.blockerGroups.some((group) =>
    group.source === 'speaker-alignment' &&
    group.codes.includes('MISSING_SPEAKER_ALIGNMENT_REPORT')
  ),
  'audit trace groups missing speaker alignment report blocker by source',
);
assertRule(
  getStage(missingSpeakerAlignmentReportTrace, 'filter-plan')?.status === 'not-run',
  'audit trace shows missing speaker alignment prevents filter planning',
);

const missingLlmReviewReportPackage = createSmartCutExecutionPackage({
  runId: 'run-trace-missing-llm-review-report',
  sourceMedia: {
    id: 'media-trace-missing-llm-review-report',
    uri: 'file:///teacher.mp4',
    mediaKind: 'talking-head',
    durationMs: 120_000,
  },
  transcriptEvidence,
  speakerEvidence,
  speakerAlignmentReport,
  contentUnits,
  contentUnitBuildReport,
  plan: {
    id: 'speech-plan-trace-missing-llm-review-report',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    sourceMediaId: 'media-trace-missing-llm-review-report',
    presetId: 'teacher-talking-head-single',
    candidates: [
      {
        id: 'candidate-1',
        slicerId: 'speech-semantic',
        startMs: 1_000,
        endMs: 61_000,
        unitIds: ['unit-1', 'unit-2'],
        title: 'Missing LLM review report',
        reason: 'Trace must expose the missing LLM review gate.',
        confidence: 0.92,
        risks: [],
      },
    ],
  },
});

const missingLlmReviewReportTrace = createSmartCutExecutionAuditTrace(missingLlmReviewReportPackage);
assertRule(missingLlmReviewReportTrace.ready === false, 'missing LLM review report creates blocked audit trace');
assertRule(
  getStage(missingLlmReviewReportTrace, 'llm-review')?.status === 'blocked',
  'audit trace marks missing LLM review report stage blocked',
);
assertRule(
  missingLlmReviewReportTrace.summary.llmReviewBlockerCount === 1,
  'audit trace summary records LLM review blocker count',
);
assertRule(
  missingLlmReviewReportTrace.blockerGroups.some((group) =>
    group.source === 'llm-review' &&
    group.codes.includes('MISSING_LLM_REVIEW_REPORT')
  ),
  'audit trace groups missing LLM review report blocker by source',
);
assertRule(
  getStage(missingLlmReviewReportTrace, 'filter-plan')?.status === 'not-run',
  'audit trace shows missing LLM review prevents filter planning',
);

const forgedEvidenceLinkedUnits = [
  {
    id: 'unit-trace-forged-evidence-link',
    startMs: 1_000,
    endMs: 24_000,
    unitKind: 'content-unit',
    text: 'A forged content unit that cannot be traced to the supplied transcript and speaker evidence.',
    speakerIds: ['speaker-forged'],
    speakerTurnIds: ['turn-forged'],
    speakerRoles: ['teacher'],
    speakerConfidence: 0.98,
    overlapGroupIds: [],
    transcriptSegmentIds: ['segment-forged'],
    evidenceIds: ['transcript', 'speaker'],
    topicIds: ['topic-planning'],
    completenessScore: 0.94,
    continuityScore: 0.93,
    publishabilityScore: 0.91,
  },
];

const forgedEvidenceLinkPackage = createSmartCutExecutionPackage({
  runId: 'run-trace-forged-evidence-link',
  sourceMedia: {
    id: 'media-trace-forged-evidence-link',
    uri: 'file:///teacher.mp4',
    mediaKind: 'talking-head',
    durationMs: 120_000,
  },
  transcriptEvidence,
  speakerEvidence,
  speakerAlignmentReport,
  contentUnits: forgedEvidenceLinkedUnits,
  contentUnitBuildReport: validateSmartCutContentUnitBuildReport({
    ...contentUnitBuildReport,
    units: forgedEvidenceLinkedUnits,
    unitCount: forgedEvidenceLinkedUnits.length,
  }),
  plan: {
    id: 'speech-plan-trace-forged-evidence-link',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    sourceMediaId: 'media-trace-forged-evidence-link',
    presetId: 'teacher-talking-head-single',
    candidates: [
      {
        id: 'candidate-trace-forged-evidence-link',
        slicerId: 'speech-semantic',
        startMs: 1_000,
        endMs: 24_000,
        unitIds: ['unit-trace-forged-evidence-link'],
        title: 'Forged evidence link',
        reason: 'Audit trace must expose content unit evidence link failures before filters.',
        confidence: 0.92,
        risks: [],
      },
    ],
  },
});

const forgedEvidenceLinkTrace = createSmartCutExecutionAuditTrace(forgedEvidenceLinkPackage);
assertRule(forgedEvidenceLinkTrace.ready === false, 'forged evidence link package creates blocked audit trace');
assertRule(
  getStage(forgedEvidenceLinkTrace, 'content-unit-evidence-link')?.status === 'blocked',
  'audit trace marks content unit evidence link stage blocked',
);
assertRule(
  forgedEvidenceLinkTrace.summary.contentUnitEvidenceLinkBlockerCount >= 3,
  'audit trace summary records content unit evidence link blocker count',
);
assertRule(
  getStage(forgedEvidenceLinkTrace, 'filter-plan')?.status === 'not-run',
  'audit trace shows forged evidence link prevents filter planning',
);
assertRule(
  forgedEvidenceLinkTrace.blockerGroups.some((group) =>
    group.source === 'content-unit-evidence-link' &&
    group.codes.includes('CONTENT_UNIT_TRANSCRIPT_SEGMENT_NOT_FOUND') &&
    group.codes.includes('CONTENT_UNIT_SPEAKER_NOT_FOUND') &&
    group.codes.includes('CONTENT_UNIT_SPEAKER_TURN_NOT_FOUND')
  ),
  'audit trace groups content unit evidence link blockers by source',
);

const invalidSpeakerContextPackage = createSmartCutExecutionPackage({
  runId: 'run-trace-invalid-speaker-context',
  sourceMedia: {
    id: 'media-trace-invalid-speaker-context',
    uri: 'file:///teacher.mp4',
    mediaKind: 'talking-head',
    durationMs: 120_000,
  },
  contentUnits: [
    {
      id: 'unit-trace-missing-speaker-context',
      startMs: 1_000,
      endMs: 61_000,
      unitKind: 'content-unit',
      text: 'This hand-written content unit lost speaker turn and role evidence.',
      speakerIds: ['speaker-teacher'],
      speakerTurnIds: [],
      speakerRoles: [],
      speakerConfidence: 0,
      overlapGroupIds: [],
      transcriptSegmentIds: ['segment-trace-missing-speaker-context'],
      evidenceIds: ['transcript', 'speaker'],
      topicIds: ['topic-planning'],
      completenessScore: 0.94,
      continuityScore: 0.93,
      publishabilityScore: 0.91,
    },
  ],
  plan: {
    id: 'speech-plan-trace-invalid-speaker-context',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    sourceMediaId: 'media-trace-invalid-speaker-context',
    presetId: 'teacher-talking-head-single',
    candidates: [
      {
        id: 'candidate-trace-invalid-speaker-context',
        slicerId: 'speech-semantic',
        startMs: 1_000,
        endMs: 61_000,
        unitIds: ['unit-trace-missing-speaker-context'],
        title: 'Missing speaker context',
        reason: 'Audit trace must expose why candidate validation blocked this before filters.',
        confidence: 0.92,
        risks: [],
      },
    ],
  },
});

const invalidSpeakerContextTrace = createSmartCutExecutionAuditTrace(invalidSpeakerContextPackage);
assertRule(invalidSpeakerContextTrace.ready === false, 'invalid speaker context package creates blocked audit trace');
assertRule(
  getStage(invalidSpeakerContextTrace, 'candidate-validation')?.status === 'blocked',
  'audit trace marks candidate validation blocked for missing speaker context',
);
assertRule(
  invalidSpeakerContextTrace.summary.candidateValidationBlockerCount === 3,
  'audit trace summary records candidate validation blocker count',
);
assertRule(
  invalidSpeakerContextTrace.summary.candidateSpeakerContextBlockerCount === 3,
  'audit trace summary records speaker context blocker count',
);
assertRule(
  invalidSpeakerContextTrace.summary.candidateContentUnitStructureBlockerCount === 0,
  'audit trace summary does not classify speaker context blockers as structure blockers',
);
assertRule(
  invalidSpeakerContextTrace.summary.blockedBeforeFilterPlan === true,
  'audit trace summary records candidate validation blocked before filter planning',
);
assertRule(
  invalidSpeakerContextTrace.blockerGroups.some((group) =>
    group.source === 'candidate-validation' &&
    group.codes.includes('CONTENT_UNIT_WITHOUT_SPEAKER_TURN') &&
    group.codes.includes('CONTENT_UNIT_WITHOUT_SPEAKER_ROLE') &&
    group.codes.includes('CONTENT_UNIT_LOW_SPEAKER_CONFIDENCE')
  ),
  'audit trace groups speaker context candidate blockers by source',
);

const invalidFilterEffectPackage = createSmartCutExecutionPackage({
  runId: 'run-trace-invalid-filter-effect',
  sourceMedia: {
    id: 'media-trace-invalid-filter-effect',
    uri: 'file:///teacher.mp4',
    mediaKind: 'talking-head',
    durationMs: 120_000,
  },
  transcriptEvidence,
  speakerEvidence,
  speakerAlignmentReport,
  contentUnits,
  contentUnitBuildReport,
  llmReviewReport: filterEffectLlmReviewReport,
  plan: {
    id: 'speech-plan-trace-invalid-filter-effect',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    sourceMediaId: 'media-trace-invalid-filter-effect',
    presetId: 'teacher-talking-head-single',
    candidates: [
      {
        id: 'candidate-filter-effect',
        slicerId: 'speech-semantic',
        startMs: 1_000,
        endMs: 61_000,
        unitIds: ['unit-1', 'unit-2'],
        title: 'Complete planning clip before filter',
        reason: 'Candidate is semantically complete before filtering.',
        confidence: 0.92,
        risks: [],
      },
    ],
  },
  filterExecutionResult: {
    filteredCandidates: [
      {
        id: 'filtered-candidate-filter-effect',
        sourceCandidateId: 'candidate-filter-effect',
        retainedSourceRanges: [{ startMs: 24_000, endMs: 61_000 }],
        removedSourceRanges: [
          {
            startMs: 1_000,
            endMs: 24_000,
            reason: 'native filter over-removed the first approved unit',
            filterId: 'abnormal-segment-remove',
          },
        ],
        durationMs: 37_000,
        unitIds: ['unit-2'],
        speakerIds: ['speaker-teacher'],
        transcriptSegmentIds: ['segment-2'],
        appliedEffectIds: ['effect-remove-unit-1'],
      },
    ],
    effects: [
      {
        id: 'effect-remove-unit-1',
        filterId: 'abnormal-segment-remove',
        candidateId: 'candidate-filter-effect',
        stepIndex: 3,
        kind: 'range-remove',
        destructive: true,
        retainedUnitIds: ['unit-2'],
        removedUnitIds: ['unit-1'],
        affectedSpeakerIds: ['speaker-teacher'],
        sourceRanges: [{ startMs: 1_000, endMs: 24_000 }],
        outputRanges: [],
        reason: 'Fixture should fail because approved semantic content was removed after slicing.',
      },
    ],
  },
});

const invalidFilterEffectTrace = createSmartCutExecutionAuditTrace(invalidFilterEffectPackage);
assertRule(invalidFilterEffectTrace.ready === false, 'invalid filter effect execution package creates blocked audit trace');
assertRule(
  getStage(invalidFilterEffectTrace, 'filter-effect-validation')?.status === 'blocked',
  'audit trace marks filter effect validation blocked',
);
assertRule(getStage(invalidFilterEffectTrace, 'render-validation')?.status === 'not-run', 'audit trace marks render not run after filter failure');
assertRule(
  invalidFilterEffectTrace.blockerGroups.some((group) =>
    group.source === 'filter-effect-validation' &&
    group.count >= 1 &&
    group.codes.includes('FILTERED_CANDIDATE_MISSING_REQUIRED_UNIT')
  ),
  'audit trace groups post-filter semantic blockers by source',
);
assertRule(
  invalidFilterEffectTrace.nativeCommandIds.join('>') === [
    'smart_cut_validate_candidates',
    'smart_cut_apply_filter_plan',
    'smart_cut_validate_filtered_plan',
  ].join('>'),
  'audit trace records that render native commands were not produced after filter failure',
);
assertRule(
  invalidFilterEffectTrace.summary.renderContractCreated === false,
  'audit trace summary records that render contract was not created',
);

const renderWithoutFilterEffectPackage = createSmartCutExecutionPackage({
  runId: 'run-trace-render-without-filter-effect',
  sourceMedia: {
    id: 'media-trace-render-without-filter-effect',
    uri: 'file:///teacher.mp4',
    mediaKind: 'talking-head',
    durationMs: 120_000,
  },
  transcriptEvidence,
  speakerEvidence,
  speakerAlignmentReport,
  contentUnits,
  contentUnitBuildReport,
  llmReviewReport: renderArtifactLlmReviewReport,
  plan: {
    id: 'speech-plan-trace-render-without-filter-effect',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    sourceMediaId: 'media-trace-render-without-filter-effect',
    presetId: 'teacher-talking-head-single',
    candidates: [
      {
        id: 'candidate-render-artifact',
        slicerId: 'speech-semantic',
        startMs: 1_000,
        endMs: 61_000,
        unitIds: ['unit-1', 'unit-2'],
        title: 'Complete planning clip with premature render artifacts',
        reason: 'Render artifacts must not bypass post-filter effect validation.',
        confidence: 0.92,
        risks: [],
      },
    ],
  },
  renderExecutionResult: {
    artifacts: [
      {
        id: 'video-candidate-render-artifact',
        candidateId: 'candidate-render-artifact',
        kind: 'rendered-video',
        path: 'D:/autocut/output/candidate-render-artifact.mp4',
        byteSize: 18_000_000,
        checksum: 'sha256-video-candidate-render-artifact',
        probe: {
          durationMs: 60_000,
          width: 1080,
          height: 1920,
          frameRateFps: 30,
          format: 'mp4',
          hasAudio: true,
          hasVideo: true,
        },
      },
    ],
  },
});

const renderWithoutFilterEffectTrace = createSmartCutExecutionAuditTrace(renderWithoutFilterEffectPackage);
assertRule(
  renderWithoutFilterEffectTrace.ready === false,
  'render artifacts without filter execution result create blocked audit trace',
);
assertRule(
  getStage(renderWithoutFilterEffectTrace, 'filter-effect-validation')?.status === 'blocked',
  'audit trace marks missing filter effects before render as filter effect blocked',
);
assertRule(
  getStage(renderWithoutFilterEffectTrace, 'filter-effect-validation')?.blockerCount === 1,
  'audit trace counts missing filter effect blocker on filter effect stage',
);
assertRule(
  getStage(renderWithoutFilterEffectTrace, 'render-contract')?.status === 'not-run' &&
    getStage(renderWithoutFilterEffectTrace, 'render-validation')?.status === 'not-run' &&
    getStage(renderWithoutFilterEffectTrace, 'render-artifact-validation')?.status === 'not-run',
  'audit trace shows premature render artifacts do not reach render stages',
);
assertRule(
  renderWithoutFilterEffectTrace.blockerGroups.some((group) =>
    group.source === 'filter-effect-validation' &&
    group.codes.includes('MISSING_FILTER_EXECUTION_RESULT_BEFORE_RENDER')
  ),
  'audit trace groups missing filter execution result before render by source',
);
assertRule(
  renderWithoutFilterEffectTrace.nativeCommandIds.join('>') === [
    'smart_cut_validate_candidates',
    'smart_cut_apply_filter_plan',
    'smart_cut_validate_filtered_plan',
  ].join('>'),
  'audit trace records render native commands were not produced before validated filter effects',
);
assertRule(
  renderWithoutFilterEffectTrace.summary.renderContractCreated === false,
  'audit trace summary records render contract is not created before validated filter effects',
);

const invalidRenderArtifactPackage = createSmartCutExecutionPackage({
  runId: 'run-trace-invalid-render-artifact',
  sourceMedia: {
    id: 'media-trace-invalid-render-artifact',
    uri: 'file:///teacher.mp4',
    mediaKind: 'talking-head',
    durationMs: 120_000,
  },
  transcriptEvidence,
  speakerEvidence,
  speakerAlignmentReport,
  contentUnits,
  contentUnitBuildReport,
  llmReviewReport: renderArtifactLlmReviewReport,
  plan: {
    id: 'speech-plan-trace-invalid-render-artifact',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    sourceMediaId: 'media-trace-invalid-render-artifact',
    presetId: 'teacher-talking-head-single',
    candidates: [
      {
        id: 'candidate-render-artifact',
        slicerId: 'speech-semantic',
        startMs: 1_000,
        endMs: 61_000,
        unitIds: ['unit-1', 'unit-2'],
        title: 'Complete planning clip',
        reason: 'Contains a complete setup and payoff.',
        confidence: 0.92,
        risks: [],
      },
    ],
  },
  filterExecutionResult: {
    filteredCandidates: [
      {
        id: 'filtered-candidate-render-artifact',
        sourceCandidateId: 'candidate-render-artifact',
        retainedSourceRanges: [{ startMs: 1_000, endMs: 61_000 }],
        removedSourceRanges: [],
        durationMs: 60_000,
        unitIds: ['unit-1', 'unit-2'],
        speakerIds: ['speaker-teacher'],
        transcriptSegmentIds: ['segment-1', 'segment-2'],
        appliedEffectIds: ['effect-denoise-render-artifact'],
      },
    ],
    effects: [
      {
        id: 'effect-denoise-render-artifact',
        filterId: 'speech-denoise',
        candidateId: 'candidate-render-artifact',
        stepIndex: 0,
        kind: 'media-transform',
        destructive: true,
        retainedUnitIds: ['unit-1', 'unit-2'],
        removedUnitIds: [],
        affectedSpeakerIds: ['speaker-teacher'],
        sourceRanges: [{ startMs: 1_000, endMs: 61_000 }],
        outputRanges: [{ startMs: 1_000, endMs: 61_000 }],
        reason: 'Denoised speech before render artifact validation.',
      },
    ],
  },
  renderExecutionResult: {
    artifacts: [
      {
        id: 'video-candidate-render-artifact',
        candidateId: 'candidate-render-artifact',
        kind: 'rendered-video',
        path: 'D:/autocut/output/candidate-render-artifact.mp4',
        byteSize: 18_000_000,
        checksum: 'sha256-video-candidate-render-artifact',
        probe: {
          durationMs: 61_000,
          width: 1080,
          height: 1920,
          frameRateFps: 30,
          format: 'mp4',
          hasAudio: true,
          hasVideo: true,
        },
      },
      {
        id: 'quality-candidate-render-artifact',
        candidateId: 'candidate-render-artifact',
        kind: 'quality-report',
        path: 'D:/autocut/output/candidate-render-artifact-quality.json',
        byteSize: 12_000,
        checksum: 'sha256-quality-candidate-render-artifact',
        probe: {
          schemaVersion: SMART_CUT_STANDARD_VERSION,
          ready: true,
          metricCount: 9,
        },
      },
    ],
  },
});

const invalidRenderArtifactTrace = createSmartCutExecutionAuditTrace(invalidRenderArtifactPackage);
assertRule(invalidRenderArtifactTrace.ready === false, 'invalid render artifact execution package creates blocked audit trace');
assertRule(
  getStage(invalidRenderArtifactTrace, 'render-artifact-validation')?.status === 'blocked',
  'audit trace marks render artifact validation blocked',
);
assertRule(
  invalidRenderArtifactTrace.blockerGroups.some((group) =>
    group.source === 'render-artifact-validation' &&
    group.codes.includes('MISSING_REQUIRED_ARTIFACT_KIND')
  ),
  'audit trace groups render artifact blockers by source',
);
assertRule(
  invalidRenderArtifactTrace.summary.renderArtifactCount === 2,
  'audit trace summary records probed render artifact count',
);

const invalidRawTimePackage = createSmartCutExecutionPackage({
  runId: 'run-trace-invalid-raw-time',
  sourceMedia: {
    id: 'media-trace-invalid-raw-time',
    uri: 'file:///teacher.mp4',
    mediaKind: 'talking-head',
    durationMs: 120_000,
  },
  transcriptEvidence,
  speakerEvidence,
  speakerAlignmentReport,
  contentUnits,
  plan: {
    id: 'speech-plan-trace-invalid-raw-time',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    sourceMediaId: 'media-trace-invalid-raw-time',
    presetId: 'teacher-talking-head-single',
    candidates: [
      {
        id: 'candidate-raw',
        slicerId: 'speech-semantic',
        startMs: 1_000,
        endMs: 61_000,
        unitIds: [],
        title: 'Raw time only',
        reason: 'No content units.',
        confidence: 0.9,
        risks: [],
      },
    ],
  },
});

const invalidRawTimeTrace = createSmartCutExecutionAuditTrace(invalidRawTimePackage);
assertRule(invalidRawTimeTrace.ready === false, 'raw time candidate creates blocked audit trace');
assertRule(
  getStage(invalidRawTimeTrace, 'candidate-validation')?.status === 'blocked' &&
    getStage(invalidRawTimeTrace, 'filter-plan')?.status === 'not-run',
  'audit trace shows candidate validation blocked before filter planning',
);
assertRule(
  invalidRawTimeTrace.blockerGroups.some((group) =>
    group.source === 'candidate-validation' &&
    group.codes.includes('CANDIDATE_WITHOUT_CONTENT_UNITS')
  ),
  'audit trace groups raw-time candidate blocker',
);

assertRule(
  typeof createSmartCutProviderExecutionAuditTrace === 'function',
  'audit trace standard exposes provider-driven execution audit trace generator',
);

if (typeof createSmartCutProviderExecutionAuditTrace === 'function') {
  const providerBlockedTrace = createSmartCutProviderExecutionAuditTrace({
    ready: false,
    runId: 'run-provider-trace-stt-blocked',
    sourceMediaId: 'media-provider-trace',
    providerIds: {
      speechToText: 'fixture-stt-provider',
      speakerDiarization: 'fixture-diarization-provider',
      llmReviewer: 'fixture-llm-reviewer',
    },
    stageStatuses: {
      speechToText: 'blocked',
      speakerDiarization: 'blocked',
      speakerAlignment: 'blocked',
      contentUnitBuild: 'blocked',
      llmProviderReview: 'blocked',
      llmReview: 'blocked',
      executionPackage: 'blocked',
    },
    blockers: [
      {
        source: 'speech-to-text',
        code: 'INVALID_TRANSCRIPT_SEGMENT_RANGE',
        message: 'STT provider returned an invalid timestamped segment.',
        remediation: 'Retry STT before diarization or slicing.',
      },
    ],
  });

  assertRule(providerBlockedTrace.ready === false, 'provider audit trace records blocked provider result');
  assertRule(providerBlockedTrace.runId === 'run-provider-trace-stt-blocked', 'provider audit trace preserves run id');
  assertRule(providerBlockedTrace.sourceMediaId === 'media-provider-trace', 'provider audit trace preserves source media id');
  assertRule(providerBlockedTrace.planId === 'provider-pre-execution', 'provider audit trace uses pre-execution plan id before planning exists');
  assertRule(getStage(providerBlockedTrace, 'speech-to-text')?.status === 'blocked', 'provider audit trace marks STT stage blocked');
  assertRule(getStage(providerBlockedTrace, 'speaker-diarization')?.status === 'blocked', 'provider audit trace marks diarization stage blocked');
  assertRule(getStage(providerBlockedTrace, 'speaker-alignment')?.status === 'blocked', 'provider audit trace marks alignment stage blocked');
  assertRule(getStage(providerBlockedTrace, 'llm-provider-review')?.status === 'blocked', 'provider audit trace marks LLM provider stage blocked');
  assertRule(getStage(providerBlockedTrace, 'filter-plan')?.status === 'not-run', 'provider audit trace marks filter plan not-run before execution package');
  assertRule(providerBlockedTrace.summary.providerStageBlockerCount === 1, 'provider audit trace summary records provider stage blocker count');
  assertRule(providerBlockedTrace.summary.nativeRequestCount === 0, 'provider audit trace records zero native requests before execution package');
  assertRule(providerBlockedTrace.providerIds?.speechToText === 'fixture-stt-provider', 'provider audit trace records STT provider id');
  assertRule(providerBlockedTrace.blockerGroups.some((group) =>
    group.source === 'speech-to-text' &&
    group.codes.includes('INVALID_TRANSCRIPT_SEGMENT_RANGE')
  ), 'provider audit trace groups STT provider blockers by source');

  const providerReadyTrace = createSmartCutProviderExecutionAuditTrace({
    ready: true,
    runId: 'run-provider-trace-ready',
    sourceMediaId: 'media-trace-valid',
    providerIds: {
      speechToText: 'fixture-stt-provider',
      speakerDiarization: 'fixture-diarization-provider',
      llmReviewer: 'fixture-llm-reviewer',
    },
    stageStatuses: {
      speechToText: 'passed',
      speakerDiarization: 'passed',
      speakerAlignment: 'passed',
      contentUnitBuild: 'passed',
      llmProviderReview: 'passed',
      llmReview: 'passed',
      executionPackage: 'passed',
    },
    blockers: [],
    transcriptEvidence,
    speakerEvidence,
    speakerAlignment: {
      ready: true,
      speakerEvidence,
      report: speakerAlignmentReport,
    },
    plan: validPackage.planId === 'speech-plan-trace-valid'
      ? {
        id: 'speech-plan-trace-valid',
        schemaVersion: SMART_CUT_STANDARD_VERSION,
        sourceMediaId: 'media-trace-valid',
        presetId: 'teacher-talking-head-single',
        candidates: [
          {
            id: 'candidate-1',
            slicerId: 'speech-semantic',
            startMs: 1_000,
            endMs: 61_000,
            unitIds: ['unit-1', 'unit-2'],
            title: 'Complete planning clip',
            reason: 'Contains a complete setup and payoff.',
            confidence: 0.92,
            risks: [],
          },
        ],
        contentUnitBuildReport,
      }
      : undefined,
    executionPackage: validPackage,
  });

  assertRule(providerReadyTrace.ready === true, 'provider audit trace records ready provider result');
  assertRule(providerReadyTrace.planId === 'speech-plan-trace-valid', 'provider audit trace uses execution plan id when available');
  assertRule(getStage(providerReadyTrace, 'speech-to-text')?.status === 'passed', 'provider audit trace marks STT stage passed');
  assertRule(getStage(providerReadyTrace, 'speaker-diarization')?.status === 'passed', 'provider audit trace marks diarization stage passed');
  assertRule(getStage(providerReadyTrace, 'llm-provider-review')?.status === 'passed', 'provider audit trace marks LLM provider stage passed');
  assertRule(providerReadyTrace.summary.providerStageBlockerCount === 0, 'provider ready audit trace records zero provider stage blockers');
  assertRule(providerReadyTrace.summary.nativeRequestCount === 5, 'provider ready audit trace inherits execution native request count');
  assertRule(providerReadyTrace.summary.contentUnitCount === 2, 'provider ready audit trace inherits execution content unit count');
}

if (failures.length > 0) {
  console.error(`blocked - smart cut audit trace failures=${failures.length}`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`ok - smart cut audit trace checks=${pass.length}`);
