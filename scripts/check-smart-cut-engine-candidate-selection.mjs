#!/usr/bin/env node

import process from 'node:process';

import {
  normalizeSmartCutLlmCandidateReview,
  selectSmartCutCandidates,
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

function createUnit(id, startMs, endMs, text, scores = {}) {
  return {
    id,
    startMs,
    endMs,
    unitKind: 'content-unit',
    text,
    speakerIds: ['speaker-1'],
    transcriptSegmentIds: [`segment-${id}`],
    evidenceIds: ['transcript', 'speaker'],
    topicIds: ['topic-1'],
    completenessScore: scores.completenessScore ?? 0.94,
    continuityScore: scores.continuityScore ?? 0.93,
    publishabilityScore: scores.publishabilityScore ?? 0.91,
  };
}

function createCandidate(id, startMs, endMs, unitIds, confidence = 0.9, slicerId = 'speech-semantic') {
  return {
    id,
    slicerId,
    startMs,
    endMs,
    unitIds,
    title: id,
    reason: 'fixture candidate',
    confidence,
    risks: [],
  };
}

const contentUnits = [
  createUnit('unit-a', 1_000, 21_000, 'Complete idea A.'),
  createUnit('unit-b', 22_000, 48_000, 'Complete idea B.'),
  createUnit('unit-c', 50_000, 82_000, 'Complete idea C.'),
  createUnit('unit-low', 84_000, 100_000, 'Weak idea.', { publishabilityScore: 0.45 }),
];

const selection = selectSmartCutCandidates({
  presetId: 'teacher-talking-head-single',
  contentUnits,
  candidates: [
    createCandidate('wide-overlap', 1_000, 82_000, ['unit-a', 'unit-b', 'unit-c'], 0.81),
    createCandidate('clip-a', 1_000, 21_000, ['unit-a'], 0.94),
    createCandidate('clip-b', 22_000, 48_000, ['unit-b'], 0.93),
    createCandidate('clip-c', 50_000, 82_000, ['unit-c'], 0.92),
    createCandidate('clip-low-quality', 84_000, 100_000, ['unit-low'], 0.95),
  ],
});

assertRule(selection.ready === true, 'candidate selection with strong non-overlapping clips is ready');
assertRule(selection.selectedCandidates.map((candidate) => candidate.id).join(',') === 'clip-a,clip-b,clip-c', 'candidate selection keeps multiple complete clips instead of one broad overlap');
assertRule(selection.rejectedCandidates.some((rejected) => rejected.candidateId === 'wide-overlap' && rejected.reason === 'overlaps-selected-candidate'), 'candidate selection rejects broad overlapping candidate');
assertRule(selection.rejectedCandidates.some((rejected) => rejected.candidateId === 'clip-low-quality' && rejected.reason === 'low-unit-quality'), 'candidate selection rejects low publishability unit');
assertRule(selection.metrics.selectedCount === 3, 'candidate selection reports natural selected count');
assertRule(selection.metrics.requestedTargetCount === undefined, 'candidate selection does not require target count');

const targetCountSelection = selectSmartCutCandidates({
  presetId: 'teacher-talking-head-single',
  targetCount: 1,
  contentUnits,
  candidates: [
    createCandidate('clip-a', 1_000, 21_000, ['unit-a'], 0.94),
    createCandidate('clip-b', 22_000, 48_000, ['unit-b'], 0.93),
    createCandidate('clip-c', 50_000, 82_000, ['unit-c'], 0.92),
  ],
});

assertRule(targetCountSelection.selectedCandidates.length === 3, 'candidate selection ignores target count when all candidates are complete and non-overlapping');
assertRule(targetCountSelection.metrics.requestedTargetCount === 1, 'candidate selection records requested target count for audit only');

const llmRankingSelection = selectSmartCutCandidates({
  presetId: 'teacher-talking-head-single',
  contentUnits,
  llmReviewReport: normalizeSmartCutLlmCandidateReview({
    model: 'fixture-llm',
    availableCandidateIds: ['ranked-lower-score', 'unranked-higher-score', 'clip-low-quality'],
    availableUnitIds: ['unit-a', 'unit-b', 'unit-low'],
    rawReview: {
      rankedCandidateIds: ['ranked-lower-score', 'unranked-higher-score', 'clip-low-quality'],
      referencedUnitIds: ['unit-a', 'unit-b', 'unit-low'],
      reviewNotes: ['ranked-lower-score has the clearer semantic payoff.'],
    },
  }),
  candidates: [
    createCandidate('unranked-higher-score', 1_000, 21_000, ['unit-a'], 0.97),
    createCandidate('ranked-lower-score', 22_000, 48_000, ['unit-b'], 0.9),
    createCandidate('clip-low-quality', 84_000, 100_000, ['unit-low'], 0.99),
  ],
});

assertRule(
  llmRankingSelection.selectedCandidates.map((candidate) => candidate.id).join(',') === 'ranked-lower-score,unranked-higher-score',
  'candidate selection uses validated LLM ranking as selection priority for deterministic candidates',
);
assertRule(
  llmRankingSelection.rejectedCandidates.some((rejected) => rejected.candidateId === 'clip-low-quality' && rejected.reason === 'low-unit-quality'),
  'candidate selection never lets LLM ranking rescue low-quality candidates',
);
assertRule(llmRankingSelection.metrics.llmRankedCandidateCount === 3, 'candidate selection records LLM ranked candidate count');

const longInterviewUnits = [
  {
    ...createUnit('qa-short', 10_000, 45_000, 'Short Q/A.'),
    unitKind: 'qa-pair',
    speakerIds: ['speaker-host', 'speaker-guest'],
  },
  {
    ...createUnit('qa-long', 50_000, 116_000, 'Complete long Q/A.'),
    unitKind: 'qa-pair',
    speakerIds: ['speaker-host', 'speaker-guest'],
  },
];
const longInterviewSelection = selectSmartCutCandidates({
  presetId: 'long-interview-matrix',
  contentUnits: longInterviewUnits,
  candidates: [
    createCandidate('too-short', 10_000, 45_000, ['qa-short'], 0.96, 'dialogue-qa'),
    createCandidate('valid-long', 50_000, 116_000, ['qa-long'], 0.93, 'dialogue-qa'),
  ],
});

assertRule(longInterviewSelection.selectedCandidates.map((candidate) => candidate.id).join(',') === 'valid-long', 'long interview selection enforces 60s minimum duration');
assertRule(longInterviewSelection.rejectedCandidates.some((rejected) => rejected.candidateId === 'too-short' && rejected.reason === 'duration-below-preset-minimum'), 'long interview selection reports duration blocker');

const emptySelection = selectSmartCutCandidates({
  presetId: 'teacher-talking-head-single',
  contentUnits,
  candidates: [
    createCandidate('clip-low-quality', 84_000, 100_000, ['unit-low'], 0.95),
  ],
});

assertRule(emptySelection.ready === false, 'candidate selection fails closed when no candidate survives');
assertRule(emptySelection.blockers.some((blocker) => blocker.code === 'NO_SELECTED_CANDIDATES'), 'empty selection reports no selected candidates blocker');

if (failures.length > 0) {
  console.error(`blocked - smart cut candidate selection failures=${failures.length}`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`ok - smart cut candidate selection checks=${pass.length}`);
