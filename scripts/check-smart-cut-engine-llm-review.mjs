#!/usr/bin/env node

import process from 'node:process';

import * as smartCutEngine from '../packages/sdkwork-autocut-smart-cut-engine/src/index.ts';

const {
  normalizeSmartCutLlmCandidateReview,
  validateSmartCutLlmCandidateReviewReport,
} = smartCutEngine;

const failures = [];
const pass = [];

function assertRule(condition, message) {
  if (condition) {
    pass.push(message);
  } else {
    failures.push(message);
  }
}

const acceptedReview = normalizeSmartCutLlmCandidateReview({
  model: 'fixture-llm',
  availableCandidateIds: ['candidate-1', 'candidate-2'],
  availableUnitIds: ['unit-1', 'unit-2'],
  availableTimeSliceIds: ['time-slice-candidate-1', 'time-slice-candidate-2'],
  availableSpeakerIds: ['speaker-teacher'],
  availableSpeakerTurnIds: ['turn-speaker-teacher-1'],
  rawReview: {
    schemaVersion: 'smart-cut-llm-review/v1',
    reviewKind: 'candidate-id-semantic-segmentation-review',
    selectedCandidateIds: ['candidate-2'],
    rankedCandidateIds: ['candidate-2', 'candidate-1'],
    referencedUnitIds: ['unit-1', 'unit-2'],
    referencedTimeSliceIds: ['time-slice-candidate-2', 'time-slice-candidate-1'],
    referencedSpeakerIds: ['speaker-teacher'],
    referencedSpeakerTurnIds: ['turn-speaker-teacher-1'],
    segmentDecisions: [
      {
        candidateId: 'candidate-2',
        decision: 'select',
        reasonCode: 'strong-setup',
        referencedUnitIds: ['unit-1'],
        referencedTimeSliceIds: ['time-slice-candidate-2'],
        referencedSpeakerIds: ['speaker-teacher'],
        referencedSpeakerTurnIds: ['turn-speaker-teacher-1'],
      },
      {
        candidateId: 'candidate-1',
        decision: 'review',
        reasonCode: 'complete-planning-clip',
        referencedUnitIds: ['unit-1', 'unit-2'],
        referencedTimeSliceIds: ['time-slice-candidate-1'],
        referencedSpeakerIds: ['speaker-teacher'],
        referencedSpeakerTurnIds: ['turn-speaker-teacher-1'],
      },
    ],
    reviewNotes: ['candidate-2 has the clearest payoff'],
  },
});

assertRule(acceptedReview.ready === true, 'LLM review accepts stable candidate and unit ids');
assertRule(acceptedReview.evidence?.referencedCandidateIds.join(',') === 'candidate-2,candidate-1', 'LLM review preserves candidate id ranking');
assertRule(acceptedReview.evidence?.referencedUnitIds.join(',') === 'unit-1,unit-2', 'LLM review preserves referenced unit ids');
assertRule(acceptedReview.evidence?.referencedTimeSliceIds?.join(',') === 'time-slice-candidate-2,time-slice-candidate-1', 'LLM review preserves referenced time slice ids');
assertRule(acceptedReview.evidence?.referencedSpeakerIds?.join(',') === 'speaker-teacher', 'LLM review preserves referenced speaker ids');
assertRule(acceptedReview.evidence?.referencedSpeakerTurnIds?.join(',') === 'turn-speaker-teacher-1', 'LLM review preserves referenced speaker turn ids');
assertRule(acceptedReview.evidence?.segmentDecisions?.length === 2, 'LLM review preserves structured segment decisions');
assertRule(
  acceptedReview.evidence?.segmentDecisions?.[0]?.candidateId === 'candidate-2' &&
    acceptedReview.evidence?.segmentDecisions?.[0]?.referencedTimeSliceIds?.[0] === 'time-slice-candidate-2' &&
    acceptedReview.evidence?.segmentDecisions?.[0]?.referencedSpeakerTurnIds?.[0] === 'turn-speaker-teacher-1',
  'LLM review normalizes segment decisions with time slice and speaker turn evidence',
);
assertRule(acceptedReview.evidence?.rejectedRawTimeCuts === false, 'LLM review does not mark stable-id review as raw time cut');

assertRule(
  typeof validateSmartCutLlmCandidateReviewReport === 'function',
  'standard exposes standalone LLM review report validation gate',
);

const executableCandidates = [
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
  {
    id: 'candidate-2',
    slicerId: 'speech-semantic',
    startMs: 1_000,
    endMs: 24_000,
    unitIds: ['unit-1'],
    title: 'Setup clip',
    reason: 'Contains the complete setup.',
    confidence: 0.9,
    risks: [],
  },
];

const contentUnits = [
  {
    id: 'unit-1',
    startMs: 1_000,
    endMs: 24_000,
    unitKind: 'content-unit',
    text: 'A complete planning idea with setup.',
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

const contentUnitsWithForeignUnit = [
  ...contentUnits,
  {
    ...contentUnits[1],
    id: 'unit-foreign',
    startMs: 62_000,
    endMs: 80_000,
    transcriptSegmentIds: ['segment-foreign'],
  },
];

if (typeof validateSmartCutLlmCandidateReviewReport === 'function') {
  const acceptedValidation = validateSmartCutLlmCandidateReviewReport({
    report: acceptedReview,
    candidates: executableCandidates,
    contentUnits,
  });

  assertRule(acceptedValidation.ready === true, 'LLM review validator accepts complete stable-id coverage');
  assertRule(acceptedValidation.blockers.length === 0, 'LLM review validator has no blockers for complete coverage');
  assertRule(acceptedValidation.metrics.candidateCount === 2, 'LLM review validator reports executable candidate count');
  assertRule(acceptedValidation.metrics.requiredUnitCount === 2, 'LLM review validator reports required executable unit count');

  const missingValidation = validateSmartCutLlmCandidateReviewReport({
    candidates: executableCandidates,
    contentUnits,
  });

  assertRule(missingValidation.ready === false, 'LLM review validator fails closed when normalized report is missing');
  assertRule(
    missingValidation.blockers.some((blocker) => blocker.code === 'MISSING_LLM_REVIEW_REPORT'),
    'LLM review validator reports missing review report blocker',
  );

  const missingEvidenceValidation = validateSmartCutLlmCandidateReviewReport({
    report: {
      ready: true,
      blockers: [],
    },
    candidates: executableCandidates,
    contentUnits,
  });

  assertRule(missingEvidenceValidation.ready === false, 'LLM review validator fails closed when evidence is missing');
  assertRule(
    missingEvidenceValidation.blockers.some((blocker) => blocker.code === 'MISSING_LLM_REVIEW_EVIDENCE'),
    'LLM review validator reports missing evidence blocker',
  );

  const invalidEvidenceValidation = validateSmartCutLlmCandidateReviewReport({
    report: {
      ready: true,
    evidence: {
      kind: 'transcript',
      schemaVersion: 'wrong-version',
      model: ' ',
      referencedCandidateIds: ['candidate-1', 'candidate-1', 'candidate-cross-plan', ' '],
      referencedUnitIds: ['unit-1', 'unit-unknown', 'unit-foreign', 'unit-1', ' '],
      referencedTimeSliceIds: ['time-slice-candidate-1', 'time-slice-missing', 'time-slice-candidate-1', ' '],
      referencedSpeakerIds: ['speaker-teacher', 'speaker-missing', 'speaker-teacher', ' '],
      referencedSpeakerTurnIds: ['turn-speaker-teacher-1', 'turn-speaker-missing', 'turn-speaker-teacher-1', ' '],
      segmentDecisions: [
        {
          candidateId: 'candidate-1',
          decision: 'select',
          reasonCode: 'fixture',
          referencedUnitIds: ['unit-1'],
          referencedTimeSliceIds: ['time-slice-candidate-1'],
          referencedSpeakerIds: ['speaker-teacher'],
          referencedSpeakerTurnIds: ['turn-speaker-teacher-1'],
        },
        {
          candidateId: 'candidate-cross-plan',
          decision: 'select',
          reasonCode: 'fixture',
          referencedUnitIds: ['unit-unknown'],
          referencedTimeSliceIds: ['time-slice-missing'],
          referencedSpeakerIds: ['speaker-missing'],
          referencedSpeakerTurnIds: ['turn-speaker-missing'],
        },
      ],
      rejectedRawTimeCuts: true,
      reviewNotes: [],
    },
      blockers: [],
    },
    candidates: executableCandidates,
    contentUnits: contentUnitsWithForeignUnit,
  });

  assertRule(invalidEvidenceValidation.ready === false, 'LLM review validator rejects malformed or forged evidence');
  for (const expectedCode of [
    'LLM_REVIEW_EVIDENCE_KIND_INVALID',
    'LLM_REVIEW_SCHEMA_VERSION_INVALID',
    'LLM_REVIEW_MODEL_MISSING',
    'LLM_RAW_TIME_RANGE_REJECTED',
    'LLM_REVIEW_DUPLICATE_CANDIDATE_ID',
    'LLM_REVIEW_BLANK_CANDIDATE_ID',
    'LLM_REVIEW_REFERENCES_NON_EXECUTABLE_CANDIDATE',
    'LLM_REVIEW_DUPLICATE_UNIT_ID',
    'LLM_REVIEW_BLANK_UNIT_ID',
    'LLM_UNKNOWN_UNIT_ID',
    'LLM_REVIEW_REFERENCES_NON_EXECUTABLE_UNIT',
    'LLM_REVIEW_DUPLICATE_TIME_SLICE_ID',
    'LLM_REVIEW_BLANK_TIME_SLICE_ID',
    'LLM_UNKNOWN_TIME_SLICE_ID',
    'LLM_REVIEW_DUPLICATE_SPEAKER_ID',
    'LLM_REVIEW_BLANK_SPEAKER_ID',
    'LLM_UNKNOWN_SPEAKER_ID',
    'LLM_REVIEW_DUPLICATE_SPEAKER_TURN_ID',
    'LLM_REVIEW_BLANK_SPEAKER_TURN_ID',
    'LLM_UNKNOWN_SPEAKER_TURN_ID',
    'LLM_REVIEW_SEGMENT_DECISION_REFERENCES_UNKNOWN_CANDIDATE',
    'LLM_REVIEW_SELECTED_CANDIDATE_NOT_REFERENCED',
    'LLM_REVIEW_SELECTED_UNIT_NOT_REFERENCED',
  ]) {
    assertRule(
      invalidEvidenceValidation.blockers.some((blocker) => blocker.code === expectedCode),
      `LLM review validator reports ${expectedCode}`,
    );
  }
}

const rawTimeReview = normalizeSmartCutLlmCandidateReview({
  model: 'fixture-llm',
  availableCandidateIds: ['candidate-1'],
  availableUnitIds: ['unit-1'],
  rawReview: {
    rankedCandidateIds: ['candidate-1'],
    cuts: [
      {
        startMs: 5_000,
        endMs: 25_000,
      },
    ],
  },
});

assertRule(rawTimeReview.ready === false, 'LLM raw timestamp cut output is rejected');
assertRule(
  rawTimeReview.blockers.some((blocker) => blocker.code === 'LLM_RAW_TIME_RANGE_REJECTED'),
  'LLM raw timestamp output reports raw time range blocker',
);
assertRule(rawTimeReview.evidence?.rejectedRawTimeCuts === true, 'LLM raw time rejection is recorded in review evidence');

const unknownIdReview = normalizeSmartCutLlmCandidateReview({
  model: 'fixture-llm',
  availableCandidateIds: ['candidate-1'],
  availableUnitIds: ['unit-1'],
  availableTimeSliceIds: ['time-slice-candidate-1'],
  availableSpeakerIds: ['speaker-teacher'],
  availableSpeakerTurnIds: ['turn-speaker-teacher-1'],
  rawReview: {
    rankedCandidateIds: ['candidate-unknown'],
    referencedUnitIds: ['unit-unknown'],
    referencedTimeSliceIds: ['time-slice-unknown'],
    referencedSpeakerIds: ['speaker-unknown'],
    referencedSpeakerTurnIds: ['turn-speaker-unknown'],
  },
});

assertRule(unknownIdReview.ready === false, 'LLM review with unknown stable ids is rejected');
assertRule(
  unknownIdReview.blockers.some((blocker) => blocker.code === 'LLM_UNKNOWN_CANDIDATE_ID'),
  'LLM unknown candidate id reports blocker',
);
assertRule(
  unknownIdReview.blockers.some((blocker) => blocker.code === 'LLM_UNKNOWN_UNIT_ID'),
  'LLM unknown unit id reports blocker',
);
assertRule(
  unknownIdReview.blockers.some((blocker) => blocker.code === 'LLM_UNKNOWN_TIME_SLICE_ID'),
  'LLM unknown time slice id reports blocker',
);
assertRule(
  unknownIdReview.blockers.some((blocker) => blocker.code === 'LLM_UNKNOWN_SPEAKER_ID'),
  'LLM unknown speaker id reports blocker',
);
assertRule(
  unknownIdReview.blockers.some((blocker) => blocker.code === 'LLM_UNKNOWN_SPEAKER_TURN_ID'),
  'LLM unknown speaker turn id reports blocker',
);

const malformedDecisionReview = normalizeSmartCutLlmCandidateReview({
  model: 'fixture-llm',
  availableCandidateIds: ['candidate-1'],
  availableUnitIds: ['unit-1'],
  availableTimeSliceIds: ['time-slice-candidate-1'],
  availableSpeakerIds: ['speaker-teacher'],
  availableSpeakerTurnIds: ['turn-speaker-teacher-1'],
  rawReview: {
    rankedCandidateIds: ['candidate-1'],
    referencedUnitIds: ['unit-1'],
    segmentDecisions: [
      {
        decision: 'select',
        referencedUnitIds: ['unit-1'],
        referencedTimeSliceIds: ['time-slice-candidate-1'],
      },
      'not-an-object',
    ],
  },
});

assertRule(malformedDecisionReview.ready === false, 'LLM review fails closed when segment decisions are malformed');
assertRule(
  malformedDecisionReview.blockers.some((blocker) => blocker.code === 'LLM_REVIEW_SEGMENT_DECISION_INVALID'),
  'LLM malformed segment decisions report a dedicated blocker',
);

if (failures.length > 0) {
  console.error(`blocked - smart cut llm review failures=${failures.length}`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`ok - smart cut llm review checks=${pass.length}`);
