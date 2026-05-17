#!/usr/bin/env node

import process from 'node:process';

import {
  SMART_CUT_DEFAULT_PRODUCT_PRESET_ID,
  createSmartCutExecutionBlueprint,
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

const blueprint = createSmartCutExecutionBlueprint({
  presetId: SMART_CUT_DEFAULT_PRODUCT_PRESET_ID,
});

assertRule(blueprint.presetId === 'teacher-talking-head-single', 'blueprint resolves teacher preset');
assertRule(blueprint.defaultSlicerId === 'speech-semantic', 'blueprint exposes speech semantic default slicer');
assertRule(blueprint.requiresSpeakerDiarization === true, 'blueprint requires speaker diarization for the speech-first standard');
assertRule(
  blueprint.pipelineSteps.map((step) => step.id).join('>') === [
    'prepare-source',
    'extract-native-evidence',
    'speech-to-text',
    'speaker-diarization',
    'align-transcript-speakers',
    'build-content-units',
    'run-slicer-chain',
    'llm-review-rank',
    'validate-candidates',
    'apply-post-slice-filters',
    'revalidate-filtered-plan',
    'render-package',
    'validate-render-artifacts',
  ].join('>'),
  'blueprint pipeline order protects semantic slicing before filters',
);
assertRule(
  blueprint.pipelineSteps.find((step) => step.id === 'apply-post-slice-filters')?.runsAfter.includes('validate-candidates') === true,
  'post-slice filters run only after candidate validation',
);
assertRule(
  blueprint.pipelineSteps.find((step) => step.id === 'llm-review-rank')?.constraints.includes('stable-unit-ids-only') === true,
  'LLM review step is constrained to stable unit ids',
);
assertRule(
  blueprint.nativeCommandPlan.includes('smart_cut_validate_candidates') &&
    blueprint.nativeCommandPlan.includes('smart_cut_validate_filtered_plan') &&
    blueprint.nativeCommandPlan.includes('smart_cut_render_plan'),
  'blueprint includes native validation and render commands',
);

const validPlanReport = validateSmartCutCandidatePlan({
  presetId: 'teacher-talking-head-single',
  sourceDurationMs: 180_000,
  contentUnits: [
    {
      id: 'unit-1',
      startMs: 1_000,
      endMs: 20_000,
      unitKind: 'content-unit',
      text: 'First complete idea.',
      speakerIds: ['speaker-1'],
      speakerTurnIds: ['turn-1'],
      speakerRoles: ['teacher'],
      speakerConfidence: 0.96,
      overlapGroupIds: [],
      transcriptSegmentIds: ['segment-1'],
      evidenceIds: ['transcript-1', 'speaker-1'],
      topicIds: ['topic-1'],
      completenessScore: 0.94,
      continuityScore: 0.92,
      publishabilityScore: 0.9,
    },
    {
      id: 'unit-2',
      startMs: 20_000,
      endMs: 55_000,
      unitKind: 'content-unit',
      text: 'Second complete idea with payoff.',
      speakerIds: ['speaker-1'],
      speakerTurnIds: ['turn-2'],
      speakerRoles: ['teacher'],
      speakerConfidence: 0.96,
      overlapGroupIds: [],
      transcriptSegmentIds: ['segment-2'],
      evidenceIds: ['transcript-1', 'speaker-1'],
      topicIds: ['topic-1'],
      completenessScore: 0.93,
      continuityScore: 0.91,
      publishabilityScore: 0.9,
    },
  ],
  candidates: [
    {
      id: 'candidate-1',
      slicerId: 'speech-semantic',
      startMs: 1_000,
      endMs: 55_000,
      unitIds: ['unit-1', 'unit-2'],
      title: 'A complete semantic short clip',
      reason: 'Contains setup and payoff.',
      confidence: 0.91,
      risks: [],
    },
  ],
});

assertRule(validPlanReport.ready === true, 'valid candidate plan passes');
assertRule(validPlanReport.blockers.length === 0, 'valid candidate plan has no blockers');

const missingSpeakerContextReport = validateSmartCutCandidatePlan({
  presetId: 'teacher-talking-head-single',
  sourceDurationMs: 180_000,
  contentUnits: [
    {
      id: 'unit-missing-speaker-context',
      startMs: 1_000,
      endMs: 40_000,
      unitKind: 'content-unit',
      text: 'This unit was hand-written and did not preserve diarization context.',
      speakerIds: ['speaker-1'],
      speakerTurnIds: [],
      speakerRoles: [],
      speakerConfidence: 0,
      overlapGroupIds: [],
      transcriptSegmentIds: ['segment-1'],
      evidenceIds: ['transcript-1', 'speaker-1'],
      topicIds: ['topic-1'],
      completenessScore: 0.94,
      continuityScore: 0.92,
      publishabilityScore: 0.9,
    },
  ],
  candidates: [
    {
      id: 'candidate-missing-speaker-context',
      slicerId: 'speech-semantic',
      startMs: 1_000,
      endMs: 40_000,
      unitIds: ['unit-missing-speaker-context'],
      title: 'Missing speaker context',
      reason: 'Candidate references a unit that lacks required speaker turn and role context.',
      confidence: 0.91,
      risks: [],
    },
  ],
});

assertRule(missingSpeakerContextReport.ready === false, 'candidate with missing speaker context fails');
assertRule(
  missingSpeakerContextReport.blockers.some((blocker) => blocker.code === 'CONTENT_UNIT_WITHOUT_SPEAKER_TURN'),
  'candidate with missing speaker context reports missing speaker turn',
);
assertRule(
  missingSpeakerContextReport.blockers.some((blocker) => blocker.code === 'CONTENT_UNIT_WITHOUT_SPEAKER_ROLE'),
  'candidate with missing speaker context reports missing speaker role',
);
assertRule(
  missingSpeakerContextReport.blockers.some((blocker) => blocker.code === 'CONTENT_UNIT_LOW_SPEAKER_CONFIDENCE'),
  'candidate with missing speaker context reports low speaker confidence',
);

const missingSpeakerIdentityReport = validateSmartCutCandidatePlan({
  presetId: 'teacher-talking-head-single',
  sourceDurationMs: 180_000,
  contentUnits: [
    {
      id: 'unit-missing-speaker',
      startMs: 1_000,
      endMs: 40_000,
      unitKind: 'content-unit',
      text: 'This unit keeps role metadata but lost the actual speaker identity.',
      speakerIds: [],
      speakerTurnIds: ['turn-1'],
      speakerRoles: ['teacher'],
      speakerConfidence: 0.96,
      overlapGroupIds: [],
      transcriptSegmentIds: ['segment-1'],
      evidenceIds: ['transcript-1', 'speaker-1'],
      topicIds: ['topic-1'],
      completenessScore: 0.94,
      continuityScore: 0.92,
      publishabilityScore: 0.9,
    },
  ],
  candidates: [
    {
      id: 'candidate-missing-speaker',
      slicerId: 'speech-semantic',
      startMs: 1_000,
      endMs: 40_000,
      unitIds: ['unit-missing-speaker'],
      title: 'Missing speaker identity',
      reason: 'Candidate references a unit that cannot be traced back to a diarized speaker.',
      confidence: 0.91,
      risks: [],
    },
  ],
});

assertRule(missingSpeakerIdentityReport.ready === false, 'candidate with missing speaker identity fails');
assertRule(
  missingSpeakerIdentityReport.blockers.some((blocker) => blocker.code === 'CONTENT_UNIT_WITHOUT_SPEAKER'),
  'candidate with missing speaker identity reports missing speaker blocker',
);

const missingTranscriptTraceReport = validateSmartCutCandidatePlan({
  presetId: 'teacher-talking-head-single',
  sourceDurationMs: 180_000,
  contentUnits: [
    {
      id: 'unit-missing-transcript-trace',
      startMs: 1_000,
      endMs: 40_000,
      unitKind: 'content-unit',
      text: 'This unit cannot be traced back to timestamped transcript evidence.',
      speakerIds: ['speaker-1'],
      speakerTurnIds: ['turn-1'],
      speakerRoles: ['teacher'],
      speakerConfidence: 0.96,
      overlapGroupIds: [],
      transcriptSegmentIds: [],
      evidenceIds: ['transcript-1', 'speaker-1'],
      topicIds: ['topic-1'],
      completenessScore: 0.94,
      continuityScore: 0.92,
      publishabilityScore: 0.9,
    },
  ],
  candidates: [
    {
      id: 'candidate-missing-transcript-trace',
      slicerId: 'speech-semantic',
      startMs: 1_000,
      endMs: 40_000,
      unitIds: ['unit-missing-transcript-trace'],
      title: 'Missing transcript trace',
      reason: 'Candidate references a unit that cannot be audited against STT timestamps.',
      confidence: 0.91,
      risks: [],
    },
  ],
});

assertRule(missingTranscriptTraceReport.ready === false, 'candidate with missing transcript trace fails');
assertRule(
  missingTranscriptTraceReport.blockers.some((blocker) => blocker.code === 'CONTENT_UNIT_WITHOUT_TRANSCRIPT'),
  'candidate with missing transcript trace reports missing transcript blocker',
);

const crossSpeakerUnitReport = validateSmartCutCandidatePlan({
  presetId: 'interview-one-question-one-answer',
  sourceDurationMs: 180_000,
  contentUnits: [
    {
      id: 'unit-cross-speaker',
      startMs: 1_000,
      endMs: 70_000,
      unitKind: 'qa-pair',
      text: 'Why plan early? Because each activity needs to support the same application story.',
      speakerIds: ['speaker-host', 'speaker-guest'],
      speakerTurnIds: ['turn-q', 'turn-a'],
      speakerRoles: ['interviewer', 'guest'],
      speakerConfidence: 0.95,
      overlapGroupIds: [],
      transcriptSegmentIds: ['segment-q', 'segment-a'],
      evidenceIds: ['transcript-1', 'speaker-1'],
      topicIds: ['topic-1'],
      completenessScore: 0.95,
      continuityScore: 0.94,
      publishabilityScore: 0.91,
    },
  ],
  candidates: [
    {
      id: 'candidate-cross-speaker',
      slicerId: 'dialogue-qa',
      startMs: 1_000,
      endMs: 70_000,
      unitIds: ['unit-cross-speaker'],
      title: 'Cross speaker unit',
      reason: 'Candidate references a single unit that merged two speakers.',
      confidence: 0.91,
      risks: [],
    },
  ],
});

assertRule(crossSpeakerUnitReport.ready === false, 'candidate with cross-speaker content unit fails');
assertRule(
  crossSpeakerUnitReport.blockers.some((blocker) => blocker.code === 'CONTENT_UNIT_CROSSES_SPEAKERS'),
  'candidate with cross-speaker content unit reports cross-speaker blocker',
);

const invalidUnitRangeReport = validateSmartCutCandidatePlan({
  presetId: 'teacher-talking-head-single',
  sourceDurationMs: 180_000,
  contentUnits: [
    {
      id: 'unit-invalid-range',
      startMs: 40_000,
      endMs: 20_000,
      unitKind: 'content-unit',
      text: 'This unit has an impossible time range.',
      speakerIds: ['speaker-1'],
      speakerTurnIds: ['turn-1'],
      speakerRoles: ['teacher'],
      speakerConfidence: 0.96,
      overlapGroupIds: [],
      transcriptSegmentIds: ['segment-1'],
      evidenceIds: ['transcript-1', 'speaker-1'],
      topicIds: ['topic-1'],
      completenessScore: 0.94,
      continuityScore: 0.92,
      publishabilityScore: 0.9,
    },
  ],
  candidates: [
    {
      id: 'candidate-invalid-unit-range',
      slicerId: 'speech-semantic',
      startMs: 1_000,
      endMs: 50_000,
      unitIds: ['unit-invalid-range'],
      title: 'Invalid unit range',
      reason: 'Candidate references a content unit whose range is not valid.',
      confidence: 0.91,
      risks: [],
    },
  ],
});

assertRule(invalidUnitRangeReport.ready === false, 'candidate with invalid content unit range fails');
assertRule(
  invalidUnitRangeReport.blockers.some((blocker) => blocker.code === 'CONTENT_UNIT_INVALID_RANGE'),
  'candidate with invalid content unit range reports invalid range blocker',
);

const rawTimeReport = validateSmartCutCandidatePlan({
  presetId: 'teacher-talking-head-single',
  sourceDurationMs: 180_000,
  contentUnits: [],
  candidates: [
    {
      id: 'candidate-raw',
      slicerId: 'speech-semantic',
      startMs: 5_000,
      endMs: 35_000,
      unitIds: [],
      title: 'Raw time cut',
      reason: 'LLM invented time range.',
      confidence: 0.9,
      risks: [],
    },
  ],
});

assertRule(rawTimeReport.ready === false, 'raw time-only candidate fails');
assertRule(
  rawTimeReport.blockers.some((blocker) => blocker.code === 'CANDIDATE_WITHOUT_CONTENT_UNITS'),
  'raw time-only candidate reports missing content units',
);

const incompleteUnitReport = validateSmartCutCandidatePlan({
  presetId: 'teacher-talking-head-single',
  sourceDurationMs: 180_000,
  contentUnits: [
    {
      id: 'unit-low',
      startMs: 1_000,
      endMs: 12_000,
      unitKind: 'content-unit',
      text: 'Incomplete thought',
      speakerIds: ['speaker-1'],
      speakerTurnIds: ['turn-1'],
      speakerRoles: ['teacher'],
      speakerConfidence: 0.96,
      overlapGroupIds: [],
      transcriptSegmentIds: ['segment-1'],
      evidenceIds: ['transcript-1'],
      topicIds: ['topic-1'],
      completenessScore: 0.42,
      continuityScore: 0.9,
      publishabilityScore: 0.8,
    },
  ],
  candidates: [
    {
      id: 'candidate-low',
      slicerId: 'speech-semantic',
      startMs: 1_000,
      endMs: 12_000,
      unitIds: ['unit-low'],
      title: 'Incomplete semantic clip',
      reason: 'Missing payoff.',
      confidence: 0.75,
      risks: [],
    },
  ],
});

assertRule(incompleteUnitReport.ready === false, 'candidate with incomplete content unit fails');
assertRule(
  incompleteUnitReport.blockers.some((blocker) => blocker.code === 'LOW_SEMANTIC_COMPLETENESS'),
  'candidate with incomplete content unit reports low semantic completeness',
);

const durationReport = validateSmartCutCandidatePlan({
  presetId: 'long-interview-matrix',
  sourceDurationMs: 600_000,
  contentUnits: [
    {
      id: 'qa-short',
      startMs: 10_000,
      endMs: 45_000,
      unitKind: 'qa-pair',
      text: 'Question and answer but too short for long interview matrix.',
      speakerIds: ['speaker-host', 'speaker-guest'],
      speakerTurnIds: ['turn-q', 'turn-a'],
      speakerRoles: ['interviewer', 'guest'],
      speakerConfidence: 0.95,
      overlapGroupIds: [],
      transcriptSegmentIds: ['segment-q', 'segment-a'],
      evidenceIds: ['transcript-1', 'speaker-1'],
      topicIds: ['topic-1'],
      completenessScore: 0.95,
      continuityScore: 0.94,
      publishabilityScore: 0.91,
    },
  ],
  candidates: [
    {
      id: 'candidate-short',
      slicerId: 'dialogue-qa',
      startMs: 10_000,
      endMs: 45_000,
      unitIds: ['qa-short'],
      title: 'Short Q/A',
      reason: 'Too short for type 3.',
      confidence: 0.9,
      risks: [],
    },
  ],
});

assertRule(durationReport.ready === false, 'long interview candidate below 60s fails');
assertRule(
  durationReport.blockers.some((blocker) => blocker.code === 'DURATION_BELOW_PRESET_MINIMUM'),
  'long interview candidate reports preset minimum duration blocker',
);

if (failures.length > 0) {
  console.error(`blocked - smart cut engine pipeline failures=${failures.length}`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`ok - smart cut engine pipeline checks=${pass.length}`);
