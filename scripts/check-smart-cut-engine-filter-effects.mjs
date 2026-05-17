#!/usr/bin/env node

import process from 'node:process';

import {
  SMART_CUT_STANDARD_VERSION,
  createSmartCutPostSliceFilterPlan,
  validateSmartCutFilterEffects,
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

const completedPipelineStepIds = [
  'prepare-source',
  'extract-native-evidence',
  'speech-to-text',
  'speaker-diarization',
  'align-transcript-speakers',
  'build-content-units',
  'run-slicer-chain',
  'llm-review-rank',
  'validate-candidates',
];

const teacherFilterPlan = createSmartCutPostSliceFilterPlan({
  presetId: 'teacher-talking-head-single',
  planId: 'speech-plan-teacher',
  candidateIds: ['candidate-teacher'],
  completedPipelineStepIds,
});

const teacherUnits = [
  {
    id: 'unit-opening',
    startMs: 1_000,
    endMs: 18_000,
    unitKind: 'content-unit',
    text: 'A complete opening idea that introduces the lesson.',
    speakerIds: ['speaker-teacher'],
    transcriptSegmentIds: ['segment-opening'],
    evidenceIds: ['transcript', 'speaker'],
    topicIds: ['topic-lesson'],
    completenessScore: 0.94,
    continuityScore: 0.93,
    publishabilityScore: 0.91,
  },
  {
    id: 'unit-payoff',
    startMs: 18_000,
    endMs: 58_000,
    unitKind: 'content-unit',
    text: 'A complete payoff that can be published without missing context.',
    speakerIds: ['speaker-teacher'],
    transcriptSegmentIds: ['segment-payoff'],
    evidenceIds: ['transcript', 'speaker'],
    topicIds: ['topic-lesson'],
    completenessScore: 0.95,
    continuityScore: 0.94,
    publishabilityScore: 0.92,
  },
];

const teacherCandidate = {
  id: 'candidate-teacher',
  slicerId: 'speech-semantic',
  startMs: 1_000,
  endMs: 58_000,
  unitIds: ['unit-opening', 'unit-payoff'],
  title: 'Complete teacher lesson',
  reason: 'Contains a complete setup and payoff.',
  confidence: 0.93,
  risks: [],
};

function createValidTeacherFilteredCandidate(overrides = {}) {
  return {
    id: 'filtered-teacher',
    sourceCandidateId: 'candidate-teacher',
    retainedSourceRanges: [
      { startMs: 1_000, endMs: 58_000 },
    ],
    removedSourceRanges: [],
    durationMs: 57_000,
    unitIds: ['unit-opening', 'unit-payoff'],
    speakerIds: ['speaker-teacher'],
    transcriptSegmentIds: ['segment-opening', 'segment-payoff'],
    appliedEffectIds: ['effect-denoise', 'effect-silence-trim'],
    ...overrides,
  };
}

function createValidTeacherDenoiseEffect(overrides = {}) {
  return {
    id: 'effect-denoise',
    filterId: 'speech-denoise',
    candidateId: 'candidate-teacher',
    stepIndex: 0,
    kind: 'media-transform',
    destructive: true,
    retainedUnitIds: ['unit-opening', 'unit-payoff'],
    removedUnitIds: [],
    affectedSpeakerIds: ['speaker-teacher'],
    sourceRanges: [{ startMs: 1_000, endMs: 58_000 }],
    outputRanges: [{ startMs: 1_000, endMs: 58_000 }],
    reason: 'Native denoise does not alter semantic ranges.',
    ...overrides,
  };
}

function createValidTeacherSilenceTrimEffect(overrides = {}) {
  return {
    id: 'effect-silence-trim',
    filterId: 'silence-trim',
    candidateId: 'candidate-teacher',
    stepIndex: 2,
    kind: 'range-trim',
    destructive: true,
    retainedUnitIds: ['unit-opening', 'unit-payoff'],
    removedUnitIds: [],
    affectedSpeakerIds: ['speaker-teacher'],
    sourceRanges: [{ startMs: 1_000, endMs: 58_000 }],
    outputRanges: [{ startMs: 1_000, endMs: 58_000 }],
    reason: 'Trimmed silence without removing transcript-backed speech.',
    ...overrides,
  };
}

function validateTeacherFilterEffects(overrides = {}) {
  return validateSmartCutFilterEffects({
    presetId: 'teacher-talking-head-single',
    filterPlan: teacherFilterPlan,
    sourceCandidates: [teacherCandidate],
    contentUnits: teacherUnits,
    filteredCandidates: [createValidTeacherFilteredCandidate()],
    effects: [
      createValidTeacherDenoiseEffect(),
      createValidTeacherSilenceTrimEffect(),
    ],
    ...overrides,
  });
}

const validTeacherFilterEffects = validateSmartCutFilterEffects({
  presetId: 'teacher-talking-head-single',
  filterPlan: teacherFilterPlan,
  sourceCandidates: [teacherCandidate],
  contentUnits: teacherUnits,
  filteredCandidates: [
    {
      id: 'filtered-teacher',
      sourceCandidateId: 'candidate-teacher',
      retainedSourceRanges: [
        { startMs: 1_000, endMs: 58_000 },
      ],
      removedSourceRanges: [],
      durationMs: 57_000,
      unitIds: ['unit-opening', 'unit-payoff'],
      speakerIds: ['speaker-teacher'],
      transcriptSegmentIds: ['segment-opening', 'segment-payoff'],
      appliedEffectIds: ['effect-denoise', 'effect-silence-trim'],
    },
  ],
  effects: [
    {
      id: 'effect-denoise',
      filterId: 'speech-denoise',
      candidateId: 'candidate-teacher',
      stepIndex: 0,
      kind: 'media-transform',
      destructive: true,
      retainedUnitIds: ['unit-opening', 'unit-payoff'],
      removedUnitIds: [],
      affectedSpeakerIds: ['speaker-teacher'],
      sourceRanges: [{ startMs: 1_000, endMs: 58_000 }],
      outputRanges: [{ startMs: 1_000, endMs: 58_000 }],
      reason: 'Native denoise does not alter semantic ranges.',
    },
    {
      id: 'effect-silence-trim',
      filterId: 'silence-trim',
      candidateId: 'candidate-teacher',
      stepIndex: 2,
      kind: 'range-trim',
      destructive: true,
      retainedUnitIds: ['unit-opening', 'unit-payoff'],
      removedUnitIds: [],
      affectedSpeakerIds: ['speaker-teacher'],
      sourceRanges: [{ startMs: 1_000, endMs: 58_000 }],
      outputRanges: [{ startMs: 1_000, endMs: 58_000 }],
      reason: 'Trimmed silence without removing transcript-backed speech.',
    },
  ],
});

assertRule(validTeacherFilterEffects.ready === true, 'valid post-filter effects pass validation');
assertRule(validTeacherFilterEffects.blockers.length === 0, 'valid post-filter effects have no blockers');
assertRule(validTeacherFilterEffects.filteredCandidateCount === 1, 'filter effect report counts filtered candidates');
assertRule(validTeacherFilterEffects.effectCount === 2, 'filter effect report counts effects');
assertRule(
  validTeacherFilterEffects.candidateReports[0]?.preservedUnitIds.join(',') === 'unit-opening,unit-payoff',
  'filter effect report records preserved semantic unit ids',
);

const duplicateEffectIdReport = validateTeacherFilterEffects({
  effects: [
    createValidTeacherDenoiseEffect(),
    createValidTeacherSilenceTrimEffect({ id: 'effect-denoise' }),
  ],
});

assertRule(duplicateEffectIdReport.ready === false, 'filter effects fail when native reports duplicate effect ids');
assertRule(
  duplicateEffectIdReport.blockers.some((blocker) => blocker.code === 'DUPLICATE_FILTER_EFFECT_ID'),
  'duplicate effect ids are reported as blockers',
);

const blankEffectIdReport = validateTeacherFilterEffects({
  effects: [
    createValidTeacherDenoiseEffect({ id: ' ' }),
    createValidTeacherSilenceTrimEffect(),
  ],
});

assertRule(blankEffectIdReport.ready === false, 'filter effects fail when native reports a blank effect id');
assertRule(
  blankEffectIdReport.blockers.some((blocker) => blocker.code === 'FILTER_EFFECT_ID_MISSING'),
  'blank effect ids are reported as blockers',
);

const duplicateFilteredCandidateIdReport = validateTeacherFilterEffects({
  filteredCandidates: [
    createValidTeacherFilteredCandidate(),
    createValidTeacherFilteredCandidate({ sourceCandidateId: 'candidate-teacher-copy' }),
  ],
  sourceCandidates: [
    teacherCandidate,
    {
      ...teacherCandidate,
      id: 'candidate-teacher-copy',
      title: 'Complete teacher lesson copy',
    },
  ],
  filterPlan: {
    ...teacherFilterPlan,
    candidateIds: ['candidate-teacher', 'candidate-teacher-copy'],
  },
});

assertRule(duplicateFilteredCandidateIdReport.ready === false, 'filter effects fail when filtered candidate ids are duplicated');
assertRule(
  duplicateFilteredCandidateIdReport.blockers.some((blocker) => blocker.code === 'DUPLICATE_FILTERED_CANDIDATE_ID'),
  'duplicate filtered candidate ids are reported as blockers',
);

const duplicateSourceOutputReport = validateTeacherFilterEffects({
  filteredCandidates: [
    createValidTeacherFilteredCandidate(),
    createValidTeacherFilteredCandidate({ id: 'filtered-teacher-second' }),
  ],
});

assertRule(duplicateSourceOutputReport.ready === false, 'filter effects fail when one source candidate produces multiple filtered outputs');
assertRule(
  duplicateSourceOutputReport.blockers.some((blocker) => blocker.code === 'DUPLICATE_FILTERED_OUTPUT_FOR_SOURCE_CANDIDATE'),
  'duplicate filtered outputs for one source candidate are reported as blockers',
);

const missingFilteredOutputPlan = createSmartCutPostSliceFilterPlan({
  presetId: 'teacher-talking-head-single',
  planId: 'speech-plan-teacher-missing-filtered-output',
  candidateIds: ['candidate-teacher', 'candidate-teacher-copy'],
  completedPipelineStepIds,
});

const missingFilteredOutputReport = validateTeacherFilterEffects({
  filterPlan: missingFilteredOutputPlan,
  sourceCandidates: [
    teacherCandidate,
    {
      ...teacherCandidate,
      id: 'candidate-teacher-copy',
      title: 'Complete teacher lesson copy',
    },
  ],
});

assertRule(missingFilteredOutputReport.ready === false, 'filter effects fail when a selected source candidate has no filtered output');
assertRule(
  missingFilteredOutputReport.blockers.some((blocker) => blocker.code === 'MISSING_FILTERED_OUTPUT_FOR_SOURCE_CANDIDATE'),
  'missing filtered outputs for selected source candidates are reported as blockers',
);

const invalidRemovedRangeReport = validateTeacherFilterEffects({
  filteredCandidates: [
    createValidTeacherFilteredCandidate({
      removedSourceRanges: [
        {
          startMs: 20_000,
          endMs: 20_000,
          reason: 'zero-length removal should fail',
          filterId: 'silence-trim',
        },
        {
          startMs: 58_000,
          endMs: 59_000,
          reason: 'outside source candidate should fail',
          filterId: 'silence-trim',
        },
        {
          startMs: 2_000,
          endMs: 3_000,
          reason: 'filter outside plan should fail',
          filterId: 'visual-blur-reject',
        },
        {
          startMs: 3_000,
          endMs: 4_000,
          reason: ' ',
          filterId: 'silence-trim',
        },
      ],
    }),
  ],
});

assertRule(invalidRemovedRangeReport.ready === false, 'filter effects fail when removed source ranges are not contract-valid');
assertRule(
  invalidRemovedRangeReport.blockers.some((blocker) => blocker.code === 'FILTERED_REMOVED_RANGE_INVALID'),
  'invalid removed ranges are reported as blockers',
);
assertRule(
  invalidRemovedRangeReport.blockers.some((blocker) => blocker.code === 'FILTERED_REMOVED_RANGE_OUTSIDE_SOURCE_CANDIDATE'),
  'removed ranges outside the source candidate are reported as blockers',
);
assertRule(
  invalidRemovedRangeReport.blockers.some((blocker) => blocker.code === 'FILTERED_REMOVED_RANGE_FILTER_NOT_IN_PLAN'),
  'removed ranges from filters outside the plan are reported as blockers',
);
assertRule(
  invalidRemovedRangeReport.blockers.some((blocker) => blocker.code === 'FILTERED_REMOVED_RANGE_REASON_MISSING'),
  'removed ranges without reasons are reported as blockers',
);

const removedRangeOverlapsUnitReport = validateTeacherFilterEffects({
  filteredCandidates: [
    createValidTeacherFilteredCandidate({
      removedSourceRanges: [
        {
          startMs: 10_000,
          endMs: 12_000,
          reason: 'native filter tried to remove audio from inside an approved sentence',
          filterId: 'silence-trim',
        },
      ],
    }),
  ],
});

assertRule(removedRangeOverlapsUnitReport.ready === false, 'filter effects fail when removed source ranges overlap approved semantic units');
assertRule(
  removedRangeOverlapsUnitReport.blockers.some((blocker) => blocker.code === 'FILTERED_REMOVED_RANGE_OVERLAPS_UNIT'),
  'removed ranges overlapping approved content units are reported as blockers',
);

const missingRetainedRangesReport = validateTeacherFilterEffects({
  filteredCandidates: [
    createValidTeacherFilteredCandidate({
      retainedSourceRanges: [],
    }),
  ],
});

assertRule(missingRetainedRangesReport.ready === false, 'filter effects fail when filtered output has no retained source ranges');
assertRule(
  missingRetainedRangesReport.blockers.some((blocker) => blocker.code === 'FILTERED_CANDIDATE_WITHOUT_RETAINED_RANGES'),
  'filtered outputs without retained source ranges are reported as blockers',
);

const duplicateAppliedEffectReport = validateTeacherFilterEffects({
  filteredCandidates: [
    createValidTeacherFilteredCandidate({
      appliedEffectIds: ['effect-denoise', 'effect-denoise'],
    }),
  ],
});

assertRule(duplicateAppliedEffectReport.ready === false, 'filter effects fail when a filtered candidate repeats applied effect ids');
assertRule(
  duplicateAppliedEffectReport.blockers.some((blocker) => blocker.code === 'FILTERED_CANDIDATE_DUPLICATE_APPLIED_EFFECT'),
  'duplicate applied effect ids are reported as blockers',
);

const mismatchedAppliedEffectReport = validateTeacherFilterEffects({
  filteredCandidates: [
    createValidTeacherFilteredCandidate({
      appliedEffectIds: ['effect-wrong-source'],
    }),
  ],
  effects: [
    createValidTeacherDenoiseEffect({
      id: 'effect-wrong-source',
      candidateId: 'candidate-other',
    }),
  ],
  sourceCandidates: [
    teacherCandidate,
    {
      ...teacherCandidate,
      id: 'candidate-other',
      title: 'Other candidate',
    },
  ],
  filterPlan: {
    ...teacherFilterPlan,
    candidateIds: ['candidate-teacher', 'candidate-other'],
  },
});

assertRule(mismatchedAppliedEffectReport.ready === false, 'filter effects fail when an applied effect belongs to another source candidate');
assertRule(
  mismatchedAppliedEffectReport.blockers.some((blocker) => blocker.code === 'FILTERED_CANDIDATE_EFFECT_SOURCE_MISMATCH'),
  'applied effects from another source candidate are reported as blockers',
);

const missingEffectRetainedUnitReport = validateTeacherFilterEffects({
  effects: [
    createValidTeacherDenoiseEffect({
      retainedUnitIds: ['unit-opening'],
    }),
    createValidTeacherSilenceTrimEffect(),
  ],
});

assertRule(missingEffectRetainedUnitReport.ready === false, 'filter effects fail when an effect does not retain every approved semantic unit');
assertRule(
  missingEffectRetainedUnitReport.blockers.some((blocker) => blocker.code === 'FILTER_EFFECT_MISSING_RETAINED_UNIT'),
  'effects that omit retained semantic unit ids are reported as blockers',
);

const contaminatedFilterOutputReport = validateTeacherFilterEffects({
  contentUnits: [
    ...teacherUnits,
    {
      id: 'unit-external',
      startMs: 2_000,
      endMs: 4_000,
      unitKind: 'content-unit',
      text: 'External candidate content that must not contaminate this output.',
      speakerIds: ['speaker-external'],
      transcriptSegmentIds: ['segment-external'],
      evidenceIds: ['transcript', 'speaker'],
      topicIds: ['topic-external'],
      completenessScore: 0.9,
      continuityScore: 0.9,
      publishabilityScore: 0.88,
    },
  ],
  filteredCandidates: [
    createValidTeacherFilteredCandidate({
      unitIds: ['unit-opening', 'unit-payoff', 'unit-external'],
      speakerIds: ['speaker-teacher', 'speaker-external'],
      transcriptSegmentIds: ['segment-opening', 'segment-payoff', 'segment-external'],
    }),
  ],
  effects: [
    createValidTeacherDenoiseEffect({
      retainedUnitIds: ['unit-opening', 'unit-payoff', 'unit-external'],
      removedUnitIds: ['unit-external'],
      affectedSpeakerIds: ['speaker-teacher', 'speaker-external'],
    }),
    createValidTeacherSilenceTrimEffect(),
  ],
});

assertRule(contaminatedFilterOutputReport.ready === false, 'filter effects fail when native output mixes external semantic evidence into a filtered candidate');
assertRule(
  contaminatedFilterOutputReport.blockers.some((blocker) => blocker.code === 'FILTERED_CANDIDATE_UNIT_OUTSIDE_SOURCE'),
  'filtered candidate units outside the source candidate are reported as blockers',
);
assertRule(
  contaminatedFilterOutputReport.blockers.some((blocker) => blocker.code === 'FILTERED_CANDIDATE_SPEAKER_OUTSIDE_SOURCE'),
  'filtered candidate speakers outside the source candidate are reported as blockers',
);
assertRule(
  contaminatedFilterOutputReport.blockers.some((blocker) => blocker.code === 'FILTERED_CANDIDATE_TRANSCRIPT_SEGMENT_OUTSIDE_SOURCE'),
  'filtered candidate transcript segments outside the source candidate are reported as blockers',
);
assertRule(
  contaminatedFilterOutputReport.blockers.some((blocker) => blocker.code === 'FILTER_EFFECT_UNIT_OUTSIDE_SOURCE'),
  'filter effect units outside the source candidate are reported as blockers',
);
assertRule(
  contaminatedFilterOutputReport.blockers.some((blocker) => blocker.code === 'FILTER_EFFECT_SPEAKER_OUTSIDE_SOURCE'),
  'filter effect speakers outside the source candidate are reported as blockers',
);

const missingUnitReport = validateSmartCutFilterEffects({
  presetId: 'teacher-talking-head-single',
  filterPlan: teacherFilterPlan,
  sourceCandidates: [teacherCandidate],
  contentUnits: teacherUnits,
  filteredCandidates: [
    {
      id: 'filtered-missing-unit',
      sourceCandidateId: 'candidate-teacher',
      retainedSourceRanges: [{ startMs: 18_000, endMs: 58_000 }],
      removedSourceRanges: [
        {
          startMs: 1_000,
          endMs: 18_000,
          reason: 'removed complete semantic unit by mistake',
          filterId: 'abnormal-segment-remove',
        },
      ],
      durationMs: 40_000,
      unitIds: ['unit-payoff'],
      speakerIds: ['speaker-teacher'],
      transcriptSegmentIds: ['segment-payoff'],
      appliedEffectIds: ['effect-remove-opening'],
    },
  ],
  effects: [
    {
      id: 'effect-remove-opening',
      filterId: 'abnormal-segment-remove',
      candidateId: 'candidate-teacher',
      stepIndex: 3,
      kind: 'range-remove',
      destructive: true,
      retainedUnitIds: ['unit-payoff'],
      removedUnitIds: ['unit-opening'],
      affectedSpeakerIds: ['speaker-teacher'],
      sourceRanges: [{ startMs: 1_000, endMs: 18_000 }],
      outputRanges: [],
      reason: 'Fixture should fail because semantic unit was removed.',
    },
  ],
});

assertRule(missingUnitReport.ready === false, 'filter effects fail when a required semantic unit is removed');
assertRule(
  missingUnitReport.blockers.some((blocker) => blocker.code === 'FILTERED_CANDIDATE_MISSING_REQUIRED_UNIT'),
  'missing semantic unit is reported as a blocker',
);
assertRule(
  missingUnitReport.blockers.some((blocker) => blocker.code === 'FILTER_EFFECT_REMOVES_SEMANTIC_UNIT'),
  'effect that removes a semantic unit is reported as a blocker',
);

const missingSpeakerReport = validateSmartCutFilterEffects({
  presetId: 'teacher-talking-head-single',
  filterPlan: teacherFilterPlan,
  sourceCandidates: [teacherCandidate],
  contentUnits: teacherUnits,
  filteredCandidates: [
    {
      id: 'filtered-missing-speaker',
      sourceCandidateId: 'candidate-teacher',
      retainedSourceRanges: [{ startMs: 1_000, endMs: 58_000 }],
      removedSourceRanges: [],
      durationMs: 57_000,
      unitIds: ['unit-opening', 'unit-payoff'],
      speakerIds: [],
      transcriptSegmentIds: ['segment-opening', 'segment-payoff'],
      appliedEffectIds: ['effect-denoise'],
    },
  ],
  effects: [
    {
      id: 'effect-denoise',
      filterId: 'speech-denoise',
      candidateId: 'candidate-teacher',
      stepIndex: 0,
      kind: 'media-transform',
      destructive: true,
      retainedUnitIds: ['unit-opening', 'unit-payoff'],
      removedUnitIds: [],
      affectedSpeakerIds: ['speaker-teacher'],
      sourceRanges: [{ startMs: 1_000, endMs: 58_000 }],
      outputRanges: [{ startMs: 1_000, endMs: 58_000 }],
      reason: 'Fixture should fail because speaker coverage was dropped.',
    },
  ],
});

assertRule(missingSpeakerReport.ready === false, 'filter effects fail when speaker coverage is lost');
assertRule(
  missingSpeakerReport.blockers.some((blocker) => blocker.code === 'FILTERED_CANDIDATE_MISSING_SPEAKER'),
  'lost speaker coverage is reported as a blocker',
);

const unknownEffectReport = validateSmartCutFilterEffects({
  presetId: 'teacher-talking-head-single',
  filterPlan: teacherFilterPlan,
  sourceCandidates: [teacherCandidate],
  contentUnits: teacherUnits,
  filteredCandidates: [
    {
      id: 'filtered-unknown-effect',
      sourceCandidateId: 'candidate-teacher',
      retainedSourceRanges: [{ startMs: 1_000, endMs: 58_000 }],
      removedSourceRanges: [],
      durationMs: 57_000,
      unitIds: ['unit-opening', 'unit-payoff'],
      speakerIds: ['speaker-teacher'],
      transcriptSegmentIds: ['segment-opening', 'segment-payoff'],
      appliedEffectIds: ['effect-unknown'],
    },
  ],
  effects: [
    {
      id: 'effect-unknown',
      filterId: 'filler-word-soft-trim',
      candidateId: 'candidate-teacher',
      stepIndex: 99,
      kind: 'range-trim',
      destructive: true,
      retainedUnitIds: ['unit-opening', 'unit-payoff'],
      removedUnitIds: [],
      affectedSpeakerIds: ['speaker-teacher'],
      sourceRanges: [{ startMs: 1_000, endMs: 58_000 }],
      outputRanges: [{ startMs: 1_000, endMs: 58_000 }],
      reason: 'Fixture should fail because the effect is not in this filter plan.',
    },
  ],
});

assertRule(unknownEffectReport.ready === false, 'filter effects fail when native reports a filter outside the plan');
assertRule(
  unknownEffectReport.blockers.some((blocker) => blocker.code === 'FILTER_EFFECT_WITHOUT_PLAN_STEP'),
  'filter effect outside plan is reported as a blocker',
);

const longInterviewFilterPlan = createSmartCutPostSliceFilterPlan({
  presetId: 'long-interview-matrix',
  planId: 'speech-plan-long-interview',
  candidateIds: ['candidate-long-interview'],
  completedPipelineStepIds,
});

const longInterviewUnits = [
  {
    id: 'unit-question',
    startMs: 10_000,
    endMs: 25_000,
    unitKind: 'qa-pair',
    text: 'What changed after the product launch?',
    speakerIds: ['speaker-interviewer'],
    transcriptSegmentIds: ['segment-question'],
    evidenceIds: ['transcript', 'speaker'],
    topicIds: ['topic-launch'],
    completenessScore: 0.93,
    continuityScore: 0.92,
    publishabilityScore: 0.9,
  },
  {
    id: 'unit-answer',
    startMs: 25_000,
    endMs: 75_000,
    unitKind: 'qa-pair',
    text: 'The launch forced us to tighten operations and clarify the customer promise.',
    speakerIds: ['speaker-guest'],
    transcriptSegmentIds: ['segment-answer'],
    evidenceIds: ['transcript', 'speaker'],
    topicIds: ['topic-launch'],
    completenessScore: 0.94,
    continuityScore: 0.93,
    publishabilityScore: 0.92,
  },
];

const longInterviewDurationReport = validateSmartCutFilterEffects({
  presetId: 'long-interview-matrix',
  filterPlan: longInterviewFilterPlan,
  sourceCandidates: [
    {
      id: 'candidate-long-interview',
      slicerId: 'dialogue-qa',
      startMs: 10_000,
      endMs: 75_000,
      unitIds: ['unit-question', 'unit-answer'],
      title: 'Launch Q/A',
      reason: 'Complete question and answer.',
      confidence: 0.91,
      risks: [],
    },
  ],
  contentUnits: longInterviewUnits,
  filteredCandidates: [
    {
      id: 'filtered-too-short',
      sourceCandidateId: 'candidate-long-interview',
      retainedSourceRanges: [{ startMs: 20_000, endMs: 75_000 }],
      removedSourceRanges: [
        {
          startMs: 10_000,
          endMs: 20_000,
          reason: 'over-trimmed pre-roll',
          filterId: 'silence-trim',
        },
      ],
      durationMs: 55_000,
      unitIds: ['unit-question', 'unit-answer'],
      speakerIds: ['speaker-interviewer', 'speaker-guest'],
      transcriptSegmentIds: ['segment-question', 'segment-answer'],
      appliedEffectIds: ['effect-over-trim'],
    },
  ],
  effects: [
    {
      id: 'effect-over-trim',
      filterId: 'silence-trim',
      candidateId: 'candidate-long-interview',
      stepIndex: 3,
      kind: 'range-trim',
      destructive: true,
      retainedUnitIds: ['unit-question', 'unit-answer'],
      removedUnitIds: [],
      affectedSpeakerIds: ['speaker-interviewer', 'speaker-guest'],
      sourceRanges: [{ startMs: 10_000, endMs: 20_000 }],
      outputRanges: [{ startMs: 20_000, endMs: 75_000 }],
      reason: 'Fixture should fail because output duration is below 60s.',
    },
  ],
});

assertRule(longInterviewDurationReport.ready === false, 'filter effects fail when output drops below preset duration');
assertRule(
  longInterviewDurationReport.blockers.some((blocker) => blocker.code === 'FILTERED_DURATION_BELOW_PRESET_MINIMUM'),
  'post-filter duration minimum violation is reported as a blocker',
);

if (failures.length > 0) {
  console.error(`blocked - smart cut filter effect failures=${failures.length}`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`ok - smart cut filter effect checks=${pass.length}`);
