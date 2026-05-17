#!/usr/bin/env node

import process from 'node:process';

import {
  SMART_CUT_STANDARD_VERSION,
  alignSmartCutTranscriptSpeakers,
  createSmartCutExecutionPackage,
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
      text: 'A complete planning idea with setup.',
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
      text: 'A complete planning idea with setup. A complete payoff that can stand alone as a publishable clip.',
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

const renderArtifactLlmReviewReport = normalizeSmartCutLlmCandidateReview({
  model: 'fixture-llm',
  availableCandidateIds: ['candidate-render-artifact'],
  availableUnitIds: ['unit-1', 'unit-2'],
  rawReview: {
    rankedCandidateIds: ['candidate-render-artifact'],
    referencedUnitIds: ['unit-1', 'unit-2'],
    reviewNotes: ['candidate-render-artifact preserves the complete setup and payoff before render validation.'],
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

const rankedSelectionLlmReviewReport = normalizeSmartCutLlmCandidateReview({
  model: 'fixture-llm',
  availableCandidateIds: ['candidate-ranked-second', 'candidate-ranked-first'],
  availableUnitIds: ['unit-1', 'unit-2'],
  rawReview: {
    rankedCandidateIds: ['candidate-ranked-first', 'candidate-ranked-second'],
    referencedUnitIds: ['unit-1', 'unit-2'],
    reviewNotes: ['candidate-ranked-first has a stronger standalone payoff.'],
  },
});

const validPackage = createSmartCutExecutionPackage({
  runId: 'run-valid',
  sourceMedia: {
    id: 'media-1',
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
    id: 'speech-plan-1',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    sourceMediaId: 'media-1',
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

assertRule(validPackage.ready === true, 'valid execution package is ready');
assertRule(validPackage.blockers.length === 0, 'valid execution package has no blockers');
assertRule(validPackage.evidenceQuality?.ready === true, 'execution package includes ready evidence quality gate');
assertRule(validPackage.speakerAlignmentReport?.ready === true, 'execution package includes ready speaker alignment gate');
assertRule(validPackage.contentUnitBuildReport?.ready === true, 'execution package includes ready content unit build gate');
assertRule(validPackage.llmReviewReport?.ready === true, 'execution package includes ready LLM review gate');
assertRule(validPackage.semanticBoundaryProof.ready === true, 'execution package includes ready semantic boundary proof');
assertRule(validPackage.candidateSelection.ready === true, 'execution package includes ready candidate selection');
assertRule(validPackage.candidateValidation.ready === true, 'execution package includes ready candidate validation');
assertRule(validPackage.filterPlan !== undefined, 'execution package includes filter plan');
assertRule(validPackage.filterValidation?.ready === true, 'execution package includes ready filter validation');
assertRule(validPackage.renderContract !== undefined, 'execution package includes render contract');
assertRule(validPackage.renderValidation?.ready === true, 'execution package includes ready render validation');
assertRule(
  validPackage.nativeRequests.map((request) => request.commandId).join('>') === [
    'smart_cut_validate_candidates',
    'smart_cut_apply_filter_plan',
    'smart_cut_validate_filtered_plan',
    'smart_cut_render_plan',
    'smart_cut_probe_artifacts',
  ].join('>'),
  'execution package produces native requests in deterministic order',
);
assertRule(validPackage.nativeRequests.every((request) => request.intervals.length === 1), 'execution package sends only selected candidates to native requests');
assertRule(
  validPackage.nativeRequests.every((request) => request.intervals[0]?.unitIds.join(',') === 'unit-1,unit-2'),
  'execution package native requests preserve content unit ids',
);
assertRule(
  validPackage.nativeValidations.every((report) => report.ready === true),
  'execution package validates every native request',
);
assertRule(
  validPackage.renderContract?.outputProfile.aspectRatio === '9:16' &&
    validPackage.renderContract?.subtitle.fontFamily === 'Jisong' &&
    validPackage.renderContract?.audio.bgmVolumePercent === 20,
  'execution package carries original teacher output contract into render contract',
);

const validCompletionPackage = createSmartCutExecutionPackage({
  runId: 'run-valid-completion',
  sourceMedia: {
    id: 'media-valid-completion',
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
    id: 'speech-plan-valid-completion',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    sourceMediaId: 'media-valid-completion',
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
  filterExecutionResult: {
    filteredCandidates: [
      {
        id: 'filtered-candidate-1',
        sourceCandidateId: 'candidate-1',
        retainedSourceRanges: [{ startMs: 1_000, endMs: 61_000 }],
        removedSourceRanges: [],
        durationMs: 60_000,
        unitIds: ['unit-1', 'unit-2'],
        speakerIds: ['speaker-teacher'],
        transcriptSegmentIds: ['segment-1', 'segment-2'],
        appliedEffectIds: ['effect-denoise-candidate-1'],
      },
    ],
    effects: [
      {
        id: 'effect-denoise-candidate-1',
        filterId: 'speech-denoise',
        candidateId: 'candidate-1',
        stepIndex: 0,
        kind: 'media-transform',
        destructive: true,
        retainedUnitIds: ['unit-1', 'unit-2'],
        removedUnitIds: [],
        affectedSpeakerIds: ['speaker-teacher'],
        sourceRanges: [{ startMs: 1_000, endMs: 61_000 }],
        outputRanges: [{ startMs: 1_000, endMs: 61_000 }],
        reason: 'Denoised speech without changing semantic boundaries.',
      },
    ],
  },
  renderExecutionResult: {
    artifacts: [
      {
        id: 'video-candidate-1',
        candidateId: 'candidate-1',
        kind: 'rendered-video',
        path: 'D:/autocut/output/candidate-1.mp4',
        byteSize: 18_000_000,
        checksum: 'sha256-video-candidate-1',
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
      {
        id: 'subtitle-candidate-1',
        candidateId: 'candidate-1',
        kind: 'subtitle',
        path: 'D:/autocut/output/candidate-1.srt',
        byteSize: 8_000,
        checksum: 'sha256-subtitle-candidate-1',
        probe: {
          durationMs: 60_000,
          format: 'srt',
          cueCount: 10,
        },
      },
      {
        id: 'cover-candidate-1',
        candidateId: 'candidate-1',
        kind: 'cover',
        path: 'D:/autocut/output/candidate-1-cover.jpg',
        byteSize: 240_000,
        checksum: 'sha256-cover-candidate-1',
        probe: {
          width: 1080,
          height: 1920,
          format: 'jpg',
        },
      },
      {
        id: 'quality-candidate-1',
        candidateId: 'candidate-1',
        kind: 'quality-report',
        path: 'D:/autocut/output/candidate-1-quality.json',
        byteSize: 12_000,
        checksum: 'sha256-quality-candidate-1',
        probe: {
          schemaVersion: SMART_CUT_STANDARD_VERSION,
          ready: true,
          metricCount: 9,
        },
      },
    ],
  },
});

assertRule(validCompletionPackage.ready === true, 'valid completed execution package with filter and render results is ready');
assertRule(validCompletionPackage.filterEffectValidation?.ready === true, 'valid completed execution package validates filter effects before render artifacts');
assertRule(validCompletionPackage.renderArtifactValidation?.ready === true, 'valid completed execution package validates render artifacts after filter effects');

const renderWithoutFilterResultPackage = createSmartCutExecutionPackage({
  runId: 'run-render-without-filter-result',
  sourceMedia: {
    id: 'media-render-without-filter-result',
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
    id: 'speech-plan-render-without-filter-result',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    sourceMediaId: 'media-render-without-filter-result',
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
  renderExecutionResult: validCompletionPackage.renderArtifactValidation === undefined
    ? undefined
    : {
      artifacts: validCompletionPackage.renderArtifactValidation.artifacts,
    },
});

assertRule(renderWithoutFilterResultPackage.ready === false, 'render artifacts without validated filter results fail closed');
assertRule(
  renderWithoutFilterResultPackage.blockers.some((blocker) =>
    blocker.source === 'filter-effect-validation' &&
    blocker.code === 'MISSING_FILTER_EXECUTION_RESULT_BEFORE_RENDER'
  ),
  'render artifacts without filter results surface filter-before-render blocker',
);
assertRule(renderWithoutFilterResultPackage.renderContract === undefined, 'render without filter result package does not create render contract');
assertRule(renderWithoutFilterResultPackage.renderArtifactValidation === undefined, 'render without filter result package does not validate render artifacts');

const rankedSelectionPackage = createSmartCutExecutionPackage({
  runId: 'run-ranked-selection',
  sourceMedia: {
    id: 'media-ranked-selection',
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
  llmReviewReport: rankedSelectionLlmReviewReport,
  plan: {
    id: 'speech-plan-ranked-selection',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    sourceMediaId: 'media-ranked-selection',
    presetId: 'teacher-talking-head-single',
    candidates: [
      {
        id: 'candidate-ranked-second',
        slicerId: 'speech-semantic',
        startMs: 1_000,
        endMs: 24_000,
        unitIds: ['unit-1'],
        title: 'Setup ranked second',
        reason: 'Contains the complete setup.',
        confidence: 0.97,
        risks: [],
      },
      {
        id: 'candidate-ranked-first',
        slicerId: 'speech-semantic',
        startMs: 24_000,
        endMs: 61_000,
        unitIds: ['unit-2'],
        title: 'Payoff ranked first',
        reason: 'Contains the complete payoff.',
        confidence: 0.9,
        risks: [],
      },
    ],
  },
});

assertRule(rankedSelectionPackage.ready === true, 'LLM ranked execution package remains ready');
assertRule(
  rankedSelectionPackage.candidateSelection.selectedCandidates.map((candidate) => candidate.id).join(',') === 'candidate-ranked-first,candidate-ranked-second',
  'execution package candidate selection honors validated LLM ranking without silently collapsing non-batch presets',
);
assertRule(
  rankedSelectionPackage.candidateSelection.metrics.requestedTargetCount === undefined,
  'execution package candidate selection records no target count unless the product layer requested one explicitly',
);
assertRule(
  rankedSelectionPackage.candidateSelection.metrics.llmRankedCandidateCount === 2,
  'execution package candidate selection records LLM ranked candidate count',
);

const explicitBatchSelectionPackage = createSmartCutExecutionPackage({
  runId: 'run-explicit-batch-selection',
  sourceMedia: {
    id: 'media-explicit-batch-selection',
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
  llmReviewReport: rankedSelectionLlmReviewReport,
  targetCandidateCount: 2,
  plan: {
    id: 'speech-plan-explicit-batch-selection',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    sourceMediaId: 'media-explicit-batch-selection',
    presetId: 'teacher-talking-head-single',
    candidates: [
      {
        id: 'candidate-ranked-second',
        slicerId: 'speech-semantic',
        startMs: 1_000,
        endMs: 24_000,
        unitIds: ['unit-1'],
        title: 'Setup ranked second',
        reason: 'Contains the complete setup.',
        confidence: 0.97,
        risks: [],
      },
      {
        id: 'candidate-ranked-first',
        slicerId: 'speech-semantic',
        startMs: 24_000,
        endMs: 61_000,
        unitIds: ['unit-2'],
        title: 'Payoff ranked first',
        reason: 'Contains the complete payoff.',
        confidence: 0.9,
        risks: [],
      },
    ],
  },
});

assertRule(
  explicitBatchSelectionPackage.candidateSelection.selectedCandidates.map((candidate) => candidate.id).join(',') === 'candidate-ranked-first,candidate-ranked-second',
  'execution package candidate selection allows explicit multi-clip target count when a workflow requests batch output',
);

const missingEvidencePackage = createSmartCutExecutionPackage({
  runId: 'run-missing-evidence',
  sourceMedia: {
    id: 'media-missing-evidence',
    uri: 'file:///teacher.mp4',
    mediaKind: 'talking-head',
    durationMs: 120_000,
  },
  contentUnits,
  contentUnitBuildReport,
  plan: {
    id: 'speech-plan-missing-evidence',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    sourceMediaId: 'media-missing-evidence',
    presetId: 'teacher-talking-head-single',
    candidates: [
      {
        id: 'candidate-missing-evidence',
        slicerId: 'speech-semantic',
        startMs: 1_000,
        endMs: 61_000,
        unitIds: ['unit-1', 'unit-2'],
        title: 'Missing evidence',
        reason: 'Execution package must not proceed without transcript and speaker evidence.',
        confidence: 0.92,
        risks: [],
      },
    ],
  },
});

assertRule(missingEvidencePackage.ready === false, 'missing evidence execution package fails closed');
assertRule(missingEvidencePackage.evidenceQuality?.ready === false, 'missing evidence execution package exposes failed evidence quality gate');
assertRule(
  missingEvidencePackage.blockers.some((blocker) =>
    blocker.source === 'evidence-quality' &&
    blocker.code === 'MISSING_TRANSCRIPT_EVIDENCE'
  ),
  'missing evidence execution package surfaces missing transcript blocker',
);
assertRule(
  missingEvidencePackage.blockers.some((blocker) =>
    blocker.source === 'evidence-quality' &&
    blocker.code === 'MISSING_SPEAKER_DIARIZATION'
  ),
  'missing evidence execution package surfaces missing speaker blocker',
);
assertRule(missingEvidencePackage.filterPlan === undefined, 'missing evidence package does not create filter plan');
assertRule(missingEvidencePackage.renderContract === undefined, 'missing evidence package does not create render contract');

const missingSpeakerAlignmentReportPackage = createSmartCutExecutionPackage({
  runId: 'run-missing-speaker-alignment-report',
  sourceMedia: {
    id: 'media-missing-speaker-alignment-report',
    uri: 'file:///teacher.mp4',
    mediaKind: 'talking-head',
    durationMs: 120_000,
  },
  transcriptEvidence,
  speakerEvidence,
  contentUnits,
  contentUnitBuildReport,
  plan: {
    id: 'speech-plan-missing-speaker-alignment-report',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    sourceMediaId: 'media-missing-speaker-alignment-report',
    presetId: 'teacher-talking-head-single',
    candidates: [
      {
        id: 'candidate-missing-speaker-alignment-report',
        slicerId: 'speech-semantic',
        startMs: 1_000,
        endMs: 61_000,
        unitIds: ['unit-1', 'unit-2'],
        title: 'Missing speaker alignment report',
        reason: 'Execution package must not proceed without the standard transcript-speaker alignment report.',
        confidence: 0.92,
        risks: [],
      },
    ],
  },
});

assertRule(missingSpeakerAlignmentReportPackage.ready === false, 'missing speaker alignment report execution package fails closed');
assertRule(
  missingSpeakerAlignmentReportPackage.speakerAlignmentReport !== undefined &&
    missingSpeakerAlignmentReportPackage.speakerAlignmentReport.ready === false,
  'missing speaker alignment report execution package exposes failed alignment gate',
);
assertRule(
  missingSpeakerAlignmentReportPackage.blockers.some((blocker) =>
    blocker.source === 'speaker-alignment' &&
    blocker.code === 'MISSING_SPEAKER_ALIGNMENT_REPORT'
  ),
  'missing speaker alignment report execution package surfaces missing alignment report blocker',
);
assertRule(missingSpeakerAlignmentReportPackage.filterPlan === undefined, 'missing speaker alignment report package does not create filter plan');
assertRule(missingSpeakerAlignmentReportPackage.renderContract === undefined, 'missing speaker alignment report package does not create render contract');

const mismatchedSpeakerAlignmentReportPackage = createSmartCutExecutionPackage({
  runId: 'run-mismatched-speaker-alignment-report',
  sourceMedia: {
    id: 'media-mismatched-speaker-alignment-report',
    uri: 'file:///teacher.mp4',
    mediaKind: 'talking-head',
    durationMs: 120_000,
  },
  transcriptEvidence,
  speakerEvidence,
  speakerAlignmentReport: {
    ...speakerAlignmentReport,
    turnIds: ['turn-forged'],
  },
  contentUnits,
  contentUnitBuildReport,
  plan: {
    id: 'speech-plan-mismatched-speaker-alignment-report',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    sourceMediaId: 'media-mismatched-speaker-alignment-report',
    presetId: 'teacher-talking-head-single',
    candidates: [
      {
        id: 'candidate-mismatched-speaker-alignment-report',
        slicerId: 'speech-semantic',
        startMs: 1_000,
        endMs: 61_000,
        unitIds: ['unit-1', 'unit-2'],
        title: 'Mismatched speaker alignment report',
        reason: 'Execution package must reject speaker turns that do not match the alignment report.',
        confidence: 0.92,
        risks: [],
      },
    ],
  },
});

assertRule(mismatchedSpeakerAlignmentReportPackage.ready === false, 'mismatched speaker alignment report execution package fails closed');
assertRule(
  mismatchedSpeakerAlignmentReportPackage.blockers.some((blocker) =>
    blocker.source === 'speaker-alignment' &&
    blocker.code === 'SPEAKER_ALIGNMENT_REPORT_MISMATCH'
  ),
  'mismatched speaker alignment report execution package surfaces alignment report mismatch blocker',
);
assertRule(mismatchedSpeakerAlignmentReportPackage.filterPlan === undefined, 'mismatched speaker alignment report package does not create filter plan');
assertRule(mismatchedSpeakerAlignmentReportPackage.renderContract === undefined, 'mismatched speaker alignment report package does not create render contract');

const transcriptCoverageMismatchSpeakerAlignmentReportPackage = createSmartCutExecutionPackage({
  runId: 'run-transcript-coverage-mismatch-speaker-alignment-report',
  sourceMedia: {
    id: 'media-transcript-coverage-mismatch-speaker-alignment-report',
    uri: 'file:///teacher.mp4',
    mediaKind: 'talking-head',
    durationMs: 120_000,
  },
  transcriptEvidence,
  speakerEvidence,
  speakerAlignmentReport: {
    ...speakerAlignmentReport,
    transcriptSegmentCount: 1,
    alignedTranscriptSegmentCount: 1,
  },
  contentUnits,
  contentUnitBuildReport,
  plan: {
    id: 'speech-plan-transcript-coverage-mismatch-speaker-alignment-report',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    sourceMediaId: 'media-transcript-coverage-mismatch-speaker-alignment-report',
    presetId: 'teacher-talking-head-single',
    candidates: [
      {
        id: 'candidate-transcript-coverage-mismatch-speaker-alignment-report',
        slicerId: 'speech-semantic',
        startMs: 1_000,
        endMs: 61_000,
        unitIds: ['unit-1', 'unit-2'],
        title: 'Transcript coverage mismatch speaker alignment report',
        reason: 'Execution package must reject alignment reports that do not account for every transcript segment.',
        confidence: 0.92,
        risks: [],
      },
    ],
  },
});

assertRule(
  transcriptCoverageMismatchSpeakerAlignmentReportPackage.ready === false,
  'transcript coverage mismatch speaker alignment report execution package fails closed',
);
assertRule(
  transcriptCoverageMismatchSpeakerAlignmentReportPackage.blockers.some((blocker) =>
    blocker.source === 'speaker-alignment' &&
    blocker.code === 'SPEAKER_ALIGNMENT_TRANSCRIPT_COVERAGE_MISMATCH'
  ),
  'transcript coverage mismatch speaker alignment report surfaces transcript coverage mismatch blocker',
);
assertRule(
  transcriptCoverageMismatchSpeakerAlignmentReportPackage.filterPlan === undefined,
  'transcript coverage mismatch speaker alignment report package does not create filter plan',
);
assertRule(
  transcriptCoverageMismatchSpeakerAlignmentReportPackage.renderContract === undefined,
  'transcript coverage mismatch speaker alignment report package does not create render contract',
);

const missingLlmReviewReportPackage = createSmartCutExecutionPackage({
  runId: 'run-missing-llm-review-report',
  sourceMedia: {
    id: 'media-missing-llm-review-report',
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
    id: 'speech-plan-missing-llm-review-report',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    sourceMediaId: 'media-missing-llm-review-report',
    presetId: 'teacher-talking-head-single',
    candidates: [
      {
        id: 'candidate-1',
        slicerId: 'speech-semantic',
        startMs: 1_000,
        endMs: 61_000,
        unitIds: ['unit-1', 'unit-2'],
        title: 'Missing LLM review report',
        reason: 'Execution package must not proceed without normalized LLM review evidence.',
        confidence: 0.92,
        risks: [],
      },
    ],
  },
});

assertRule(missingLlmReviewReportPackage.ready === false, 'missing LLM review report execution package fails closed');
assertRule(
  missingLlmReviewReportPackage.llmReviewReport?.ready === false,
  'missing LLM review report execution package exposes failed LLM review gate',
);
assertRule(
  missingLlmReviewReportPackage.blockers.some((blocker) =>
    blocker.source === 'llm-review' &&
    blocker.code === 'MISSING_LLM_REVIEW_REPORT'
  ),
  'missing LLM review report execution package surfaces missing LLM review report blocker',
);
assertRule(missingLlmReviewReportPackage.filterPlan === undefined, 'missing LLM review report package does not create filter plan');
assertRule(missingLlmReviewReportPackage.renderContract === undefined, 'missing LLM review report package does not create render contract');

const blockedLlmReviewReport = normalizeSmartCutLlmCandidateReview({
  model: 'fixture-llm',
  availableCandidateIds: ['candidate-1'],
  availableUnitIds: ['unit-1', 'unit-2'],
  rawReview: {
    rankedCandidateIds: ['candidate-1'],
    cuts: [{ startMs: 1_000, endMs: 61_000 }],
  },
});

const blockedLlmReviewReportPackage = createSmartCutExecutionPackage({
  runId: 'run-blocked-llm-review-report',
  sourceMedia: {
    id: 'media-blocked-llm-review-report',
    uri: 'file:///teacher.mp4',
    mediaKind: 'talking-head',
    durationMs: 120_000,
  },
  transcriptEvidence,
  speakerEvidence,
  speakerAlignmentReport,
  contentUnits,
  contentUnitBuildReport,
  llmReviewReport: blockedLlmReviewReport,
  plan: {
    id: 'speech-plan-blocked-llm-review-report',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    sourceMediaId: 'media-blocked-llm-review-report',
    presetId: 'teacher-talking-head-single',
    candidates: [
      {
        id: 'candidate-1',
        slicerId: 'speech-semantic',
        startMs: 1_000,
        endMs: 61_000,
        unitIds: ['unit-1', 'unit-2'],
        title: 'Blocked LLM review report',
        reason: 'Execution package must reject LLM raw timestamp output even when candidates are otherwise valid.',
        confidence: 0.92,
        risks: [],
      },
    ],
  },
});

assertRule(blockedLlmReviewReportPackage.ready === false, 'blocked LLM review report execution package fails closed');
assertRule(
  blockedLlmReviewReportPackage.blockers.some((blocker) =>
    blocker.source === 'llm-review' &&
    blocker.code === 'LLM_RAW_TIME_RANGE_REJECTED'
  ),
  'blocked LLM review report execution package surfaces normalized LLM raw time blocker',
);
assertRule(blockedLlmReviewReportPackage.filterPlan === undefined, 'blocked LLM review report package does not create filter plan');
assertRule(blockedLlmReviewReportPackage.renderContract === undefined, 'blocked LLM review report package does not create render contract');

const uncoveredSelectedCandidateLlmReviewReport = normalizeSmartCutLlmCandidateReview({
  model: 'fixture-llm',
  availableCandidateIds: ['candidate-1', 'candidate-2'],
  availableUnitIds: ['unit-1', 'unit-2'],
  rawReview: {
    rankedCandidateIds: ['candidate-2'],
    referencedUnitIds: ['unit-1', 'unit-2'],
    reviewNotes: ['The review omitted the actual selected candidate.'],
  },
});

const uncoveredSelectedCandidateLlmReviewReportPackage = createSmartCutExecutionPackage({
  runId: 'run-uncovered-selected-candidate-llm-review-report',
  sourceMedia: {
    id: 'media-uncovered-selected-candidate-llm-review-report',
    uri: 'file:///teacher.mp4',
    mediaKind: 'talking-head',
    durationMs: 120_000,
  },
  transcriptEvidence,
  speakerEvidence,
  speakerAlignmentReport,
  contentUnits,
  contentUnitBuildReport,
  llmReviewReport: uncoveredSelectedCandidateLlmReviewReport,
  plan: {
    id: 'speech-plan-uncovered-selected-candidate-llm-review-report',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    sourceMediaId: 'media-uncovered-selected-candidate-llm-review-report',
    presetId: 'teacher-talking-head-single',
    candidates: [
      {
        id: 'candidate-1',
        slicerId: 'speech-semantic',
        startMs: 1_000,
        endMs: 61_000,
        unitIds: ['unit-1', 'unit-2'],
        title: 'Uncovered selected candidate',
        reason: 'Execution package must reject an LLM review that does not cover the selected candidate id.',
        confidence: 0.92,
        risks: [],
      },
    ],
  },
});

assertRule(
  uncoveredSelectedCandidateLlmReviewReportPackage.ready === false,
  'uncovered selected candidate LLM review report execution package fails closed',
);
assertRule(
  uncoveredSelectedCandidateLlmReviewReportPackage.blockers.some((blocker) =>
    blocker.source === 'llm-review' &&
    blocker.code === 'LLM_REVIEW_SELECTED_CANDIDATE_NOT_REFERENCED'
  ),
  'uncovered selected candidate LLM review report surfaces selected candidate coverage blocker',
);
assertRule(
  uncoveredSelectedCandidateLlmReviewReportPackage.filterPlan === undefined,
  'uncovered selected candidate LLM review report package does not create filter plan',
);
assertRule(
  uncoveredSelectedCandidateLlmReviewReportPackage.renderContract === undefined,
  'uncovered selected candidate LLM review report package does not create render contract',
);

const extraCandidateLlmReviewReport = normalizeSmartCutLlmCandidateReview({
  model: 'fixture-llm',
  availableCandidateIds: ['candidate-1', 'candidate-cross-plan'],
  availableUnitIds: ['unit-1', 'unit-2'],
  rawReview: {
    rankedCandidateIds: ['candidate-1', 'candidate-cross-plan'],
    referencedUnitIds: ['unit-1', 'unit-2'],
    reviewNotes: ['This review was polluted by another plan candidate id.'],
  },
});

const extraCandidateLlmReviewReportPackage = createSmartCutExecutionPackage({
  runId: 'run-extra-candidate-llm-review-report',
  sourceMedia: {
    id: 'media-extra-candidate-llm-review-report',
    uri: 'file:///teacher.mp4',
    mediaKind: 'talking-head',
    durationMs: 120_000,
  },
  transcriptEvidence,
  speakerEvidence,
  speakerAlignmentReport,
  contentUnits,
  contentUnitBuildReport,
  llmReviewReport: extraCandidateLlmReviewReport,
  plan: {
    id: 'speech-plan-extra-candidate-llm-review-report',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    sourceMediaId: 'media-extra-candidate-llm-review-report',
    presetId: 'teacher-talking-head-single',
    candidates: [
      {
        id: 'candidate-1',
        slicerId: 'speech-semantic',
        startMs: 1_000,
        endMs: 61_000,
        unitIds: ['unit-1', 'unit-2'],
        title: 'Extra candidate review pollution',
        reason: 'Execution package must reject review reports that include candidates outside the current plan.',
        confidence: 0.92,
        risks: [],
      },
    ],
  },
});

assertRule(extraCandidateLlmReviewReportPackage.ready === false, 'extra candidate LLM review report execution package fails closed');
assertRule(
  extraCandidateLlmReviewReportPackage.blockers.some((blocker) =>
    blocker.source === 'llm-review' &&
    blocker.code === 'LLM_REVIEW_REFERENCES_NON_EXECUTABLE_CANDIDATE'
  ),
  'extra candidate LLM review report surfaces non-executable candidate blocker',
);
assertRule(extraCandidateLlmReviewReportPackage.filterPlan === undefined, 'extra candidate LLM review report package does not create filter plan');
assertRule(extraCandidateLlmReviewReportPackage.renderContract === undefined, 'extra candidate LLM review report package does not create render contract');

const missingContentUnitBuildReportPackage = createSmartCutExecutionPackage({
  runId: 'run-missing-content-unit-build-report',
  sourceMedia: {
    id: 'media-missing-content-unit-build-report',
    uri: 'file:///teacher.mp4',
    mediaKind: 'talking-head',
    durationMs: 120_000,
  },
  transcriptEvidence,
  speakerEvidence,
  speakerAlignmentReport,
  contentUnits,
  plan: {
    id: 'speech-plan-missing-content-unit-build-report',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    sourceMediaId: 'media-missing-content-unit-build-report',
    presetId: 'teacher-talking-head-single',
    candidates: [
      {
        id: 'candidate-missing-content-unit-build-report',
        slicerId: 'speech-semantic',
        startMs: 1_000,
        endMs: 61_000,
        unitIds: ['unit-1', 'unit-2'],
        title: 'Missing content unit build report',
        reason: 'Execution package must not accept hand-written content units without the standard build report.',
        confidence: 0.92,
        risks: [],
      },
    ],
  },
});

assertRule(missingContentUnitBuildReportPackage.ready === false, 'missing content unit build report execution package fails closed');
assertRule(
  missingContentUnitBuildReportPackage.contentUnitBuildReport?.ready === false,
  'missing content unit build report execution package exposes failed build report',
);
assertRule(
  missingContentUnitBuildReportPackage.blockers.some((blocker) =>
    blocker.source === 'content-unit-build' &&
    blocker.code === 'MISSING_CONTENT_UNIT_BUILD_REPORT'
  ),
  'missing content unit build report execution package surfaces missing build report blocker',
);
assertRule(missingContentUnitBuildReportPackage.filterPlan === undefined, 'missing content unit build report package does not create filter plan');
assertRule(missingContentUnitBuildReportPackage.renderContract === undefined, 'missing content unit build report package does not create render contract');

const mismatchedContentUnitBuildReportPackage = createSmartCutExecutionPackage({
  runId: 'run-mismatched-content-unit-build-report',
  sourceMedia: {
    id: 'media-mismatched-content-unit-build-report',
    uri: 'file:///teacher.mp4',
    mediaKind: 'talking-head',
    durationMs: 120_000,
  },
  transcriptEvidence,
  speakerEvidence,
  speakerAlignmentReport,
  contentUnits: [
    {
      ...contentUnits[0],
      text: 'A tampered hand-written content unit that no longer matches the build report.',
    },
    contentUnits[1],
  ],
  contentUnitBuildReport,
  plan: {
    id: 'speech-plan-mismatched-content-unit-build-report',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    sourceMediaId: 'media-mismatched-content-unit-build-report',
    presetId: 'teacher-talking-head-single',
    candidates: [
      {
        id: 'candidate-mismatched-content-unit-build-report',
        slicerId: 'speech-semantic',
        startMs: 1_000,
        endMs: 61_000,
        unitIds: ['unit-1', 'unit-2'],
        title: 'Mismatched content unit build report',
        reason: 'Execution package must reject content units that differ from the build report units.',
        confidence: 0.92,
        risks: [],
      },
    ],
  },
});

assertRule(mismatchedContentUnitBuildReportPackage.ready === false, 'mismatched content unit build report execution package fails closed');
assertRule(
  mismatchedContentUnitBuildReportPackage.blockers.some((blocker) =>
    blocker.source === 'content-unit-build' &&
    blocker.code === 'CONTENT_UNIT_BUILD_REPORT_MISMATCH'
  ),
  'mismatched content unit build report execution package surfaces mismatch blocker',
);
assertRule(mismatchedContentUnitBuildReportPackage.filterPlan === undefined, 'mismatched content unit build report package does not create filter plan');
assertRule(mismatchedContentUnitBuildReportPackage.renderContract === undefined, 'mismatched content unit build report package does not create render contract');

const forgedEvidenceLinkedUnits = [
  {
    id: 'unit-forged-evidence-link',
    startMs: 1_000,
    endMs: 24_000,
    unitKind: 'content-unit',
    text: 'A forged content unit that looks structurally valid but points at missing evidence.',
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

const forgedEvidenceLinkReport = validateSmartCutContentUnitBuildReport({
  ...contentUnitBuildReport,
  units: forgedEvidenceLinkedUnits,
  unitCount: forgedEvidenceLinkedUnits.length,
});

const forgedEvidenceLinkPackage = createSmartCutExecutionPackage({
  runId: 'run-forged-evidence-link',
  sourceMedia: {
    id: 'media-forged-evidence-link',
    uri: 'file:///teacher.mp4',
    mediaKind: 'talking-head',
    durationMs: 120_000,
  },
  transcriptEvidence,
  speakerEvidence,
  speakerAlignmentReport,
  contentUnits: forgedEvidenceLinkedUnits,
  contentUnitBuildReport: forgedEvidenceLinkReport,
  plan: {
    id: 'speech-plan-forged-evidence-link',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    sourceMediaId: 'media-forged-evidence-link',
    presetId: 'teacher-talking-head-single',
    candidates: [
      {
        id: 'candidate-forged-evidence-link',
        slicerId: 'speech-semantic',
        startMs: 1_000,
        endMs: 24_000,
        unitIds: ['unit-forged-evidence-link'],
        title: 'Forged evidence link',
        reason: 'Execution package must reject content units not traceable to the supplied transcript and speaker evidence.',
        confidence: 0.92,
        risks: [],
      },
    ],
  },
});

assertRule(forgedEvidenceLinkPackage.ready === false, 'forged evidence link execution package fails closed');
assertRule(
  forgedEvidenceLinkPackage.contentUnitEvidenceLink?.ready === false,
  'forged evidence link execution package exposes failed content unit evidence link gate',
);
assertRule(
  forgedEvidenceLinkPackage.blockers.some((blocker) =>
    blocker.source === 'content-unit-evidence-link' &&
    blocker.code === 'CONTENT_UNIT_TRANSCRIPT_SEGMENT_NOT_FOUND'
  ),
  'forged evidence link execution package surfaces missing transcript segment blocker',
);
assertRule(
  forgedEvidenceLinkPackage.blockers.some((blocker) =>
    blocker.source === 'content-unit-evidence-link' &&
    blocker.code === 'CONTENT_UNIT_SPEAKER_NOT_FOUND'
  ),
  'forged evidence link execution package surfaces missing speaker profile blocker',
);
assertRule(
  forgedEvidenceLinkPackage.blockers.some((blocker) =>
    blocker.source === 'content-unit-evidence-link' &&
    blocker.code === 'CONTENT_UNIT_SPEAKER_TURN_NOT_FOUND'
  ),
  'forged evidence link execution package surfaces missing speaker turn blocker',
);
assertRule(forgedEvidenceLinkPackage.filterPlan === undefined, 'forged evidence link package does not create filter plan');
assertRule(forgedEvidenceLinkPackage.renderContract === undefined, 'forged evidence link package does not create render contract');

const invalidContentUnitBuildReport = validateSmartCutContentUnitBuildReport({
  ...contentUnitBuildReport,
  units: [
    {
      id: 'unit-dangling-build',
      startMs: 1_000,
      endMs: 20_000,
      unitKind: 'content-unit',
      text: 'The planning method works because',
      speakerIds: ['speaker-teacher'],
      speakerTurnIds: ['turn-dangling-build'],
      speakerRoles: ['teacher'],
      speakerConfidence: 0.98,
      overlapGroupIds: [],
      transcriptSegmentIds: ['segment-dangling-build'],
      evidenceIds: ['transcript', 'speaker'],
      topicIds: ['topic-planning'],
      completenessScore: 0.92,
      continuityScore: 0.9,
      publishabilityScore: 0.9,
    },
  ],
});

const invalidContentUnitBuildPackage = createSmartCutExecutionPackage({
  runId: 'run-invalid-content-unit-build',
  sourceMedia: {
    id: 'media-content-unit-build',
    uri: 'file:///teacher.mp4',
    mediaKind: 'talking-head',
    durationMs: 120_000,
  },
  contentUnits: invalidContentUnitBuildReport.units,
  contentUnitBuildReport: invalidContentUnitBuildReport,
  plan: {
    id: 'speech-plan-invalid-content-unit-build',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    sourceMediaId: 'media-content-unit-build',
    presetId: 'teacher-talking-head-single',
    candidates: [
      {
        id: 'candidate-dangling-build',
        slicerId: 'speech-semantic',
        startMs: 1_000,
        endMs: 20_000,
        unitIds: ['unit-dangling-build'],
        title: 'Dangling content unit',
        reason: 'Candidate must not proceed because content unit build failed.',
        confidence: 0.91,
        risks: [],
      },
    ],
  },
});

assertRule(invalidContentUnitBuildPackage.ready === false, 'invalid content unit build execution package fails closed');
assertRule(
  invalidContentUnitBuildPackage.contentUnitBuildReport?.ready === false,
  'invalid content unit build execution package exposes failed build report',
);
assertRule(
  invalidContentUnitBuildPackage.blockers.some((blocker) =>
    blocker.source === 'content-unit-build' &&
    blocker.code === 'DANGLING_CONNECTOR_CONTENT_UNIT'
  ),
  'invalid content unit build execution package surfaces content unit build blocker',
);
assertRule(invalidContentUnitBuildPackage.filterPlan === undefined, 'invalid content unit build package does not create filter plan');
assertRule(invalidContentUnitBuildPackage.renderContract === undefined, 'invalid content unit build package does not create render contract');

const missingSpeakerContextPackage = createSmartCutExecutionPackage({
  runId: 'run-missing-speaker-context',
  sourceMedia: {
    id: 'media-missing-speaker-context',
    uri: 'file:///teacher.mp4',
    mediaKind: 'talking-head',
    durationMs: 120_000,
  },
  contentUnits: [
    {
      id: 'unit-missing-speaker-context',
      startMs: 1_000,
      endMs: 61_000,
      unitKind: 'content-unit',
      text: 'This hand-written content unit bypassed the content unit build report.',
      speakerIds: ['speaker-teacher'],
      speakerTurnIds: [],
      speakerRoles: [],
      speakerConfidence: 0,
      overlapGroupIds: [],
      transcriptSegmentIds: ['segment-missing-speaker-context'],
      evidenceIds: ['transcript', 'speaker'],
      topicIds: ['topic-planning'],
      completenessScore: 0.94,
      continuityScore: 0.93,
      publishabilityScore: 0.91,
    },
  ],
  plan: {
    id: 'speech-plan-missing-speaker-context',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    sourceMediaId: 'media-missing-speaker-context',
    presetId: 'teacher-talking-head-single',
    candidates: [
      {
        id: 'candidate-missing-speaker-context',
        slicerId: 'speech-semantic',
        startMs: 1_000,
        endMs: 61_000,
        unitIds: ['unit-missing-speaker-context'],
        title: 'Missing speaker context',
        reason: 'Execution package must reject hand-written units without speaker turn and role evidence.',
        confidence: 0.92,
        risks: [],
      },
    ],
  },
});

assertRule(missingSpeakerContextPackage.ready === false, 'missing speaker context execution package fails closed');
assertRule(
  missingSpeakerContextPackage.blockers.some((blocker) =>
    blocker.source === 'candidate-validation' &&
    blocker.code === 'CONTENT_UNIT_WITHOUT_SPEAKER_TURN'
  ),
  'missing speaker context execution package surfaces missing speaker turn blocker',
);
assertRule(
  missingSpeakerContextPackage.blockers.some((blocker) =>
    blocker.source === 'candidate-validation' &&
    blocker.code === 'CONTENT_UNIT_WITHOUT_SPEAKER_ROLE'
  ),
  'missing speaker context execution package surfaces missing speaker role blocker',
);
assertRule(
  missingSpeakerContextPackage.blockers.some((blocker) =>
    blocker.source === 'candidate-validation' &&
    blocker.code === 'CONTENT_UNIT_LOW_SPEAKER_CONFIDENCE'
  ),
  'missing speaker context execution package surfaces low speaker confidence blocker',
);
assertRule(missingSpeakerContextPackage.filterPlan === undefined, 'missing speaker context package does not create filter plan');
assertRule(missingSpeakerContextPackage.renderContract === undefined, 'missing speaker context package does not create render contract');

const missingSpeakerIdentityPackage = createSmartCutExecutionPackage({
  runId: 'run-missing-speaker-identity',
  sourceMedia: {
    id: 'media-missing-speaker-identity',
    uri: 'file:///teacher.mp4',
    mediaKind: 'talking-head',
    durationMs: 120_000,
  },
  contentUnits: [
    {
      id: 'unit-missing-speaker-identity',
      startMs: 1_000,
      endMs: 61_000,
      unitKind: 'content-unit',
      text: 'This hand-written content unit lost its diarized speaker identity.',
      speakerIds: [],
      speakerTurnIds: ['turn-missing-speaker-identity'],
      speakerRoles: ['teacher'],
      speakerConfidence: 0.96,
      overlapGroupIds: [],
      transcriptSegmentIds: ['segment-missing-speaker-identity'],
      evidenceIds: ['transcript', 'speaker'],
      topicIds: ['topic-planning'],
      completenessScore: 0.94,
      continuityScore: 0.93,
      publishabilityScore: 0.91,
    },
  ],
  plan: {
    id: 'speech-plan-missing-speaker-identity',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    sourceMediaId: 'media-missing-speaker-identity',
    presetId: 'teacher-talking-head-single',
    candidates: [
      {
        id: 'candidate-missing-speaker-identity',
        slicerId: 'speech-semantic',
        startMs: 1_000,
        endMs: 61_000,
        unitIds: ['unit-missing-speaker-identity'],
        title: 'Missing speaker identity',
        reason: 'Execution package must reject units that cannot be traced to a diarized speaker.',
        confidence: 0.92,
        risks: [],
      },
    ],
  },
});

assertRule(missingSpeakerIdentityPackage.ready === false, 'missing speaker identity execution package fails closed');
assertRule(
  missingSpeakerIdentityPackage.blockers.some((blocker) =>
    blocker.source === 'candidate-validation' &&
    blocker.code === 'CONTENT_UNIT_WITHOUT_SPEAKER'
  ),
  'missing speaker identity execution package surfaces missing speaker blocker',
);
assertRule(missingSpeakerIdentityPackage.filterPlan === undefined, 'missing speaker identity package does not create filter plan');
assertRule(missingSpeakerIdentityPackage.renderContract === undefined, 'missing speaker identity package does not create render contract');

const invalidContentUnitStructurePackage = createSmartCutExecutionPackage({
  runId: 'run-invalid-content-unit-structure',
  sourceMedia: {
    id: 'media-invalid-content-unit-structure',
    uri: 'file:///teacher.mp4',
    mediaKind: 'talking-head',
    durationMs: 120_000,
  },
  contentUnits: [
    {
      id: 'unit-missing-transcript-trace',
      startMs: 1_000,
      endMs: 61_000,
      unitKind: 'content-unit',
      text: 'This hand-written content unit has no transcript segment trace.',
      speakerIds: ['speaker-teacher'],
      speakerTurnIds: ['turn-missing-transcript-trace'],
      speakerRoles: ['teacher'],
      speakerConfidence: 0.96,
      overlapGroupIds: [],
      transcriptSegmentIds: [],
      evidenceIds: ['transcript', 'speaker'],
      topicIds: ['topic-planning'],
      completenessScore: 0.94,
      continuityScore: 0.93,
      publishabilityScore: 0.91,
    },
  ],
  plan: {
    id: 'speech-plan-invalid-content-unit-structure',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    sourceMediaId: 'media-invalid-content-unit-structure',
    presetId: 'teacher-talking-head-single',
    candidates: [
      {
        id: 'candidate-missing-transcript-trace',
        slicerId: 'speech-semantic',
        startMs: 1_000,
        endMs: 61_000,
        unitIds: ['unit-missing-transcript-trace'],
        title: 'Missing transcript trace',
        reason: 'Execution package must reject content units that cannot be traced to transcript evidence.',
        confidence: 0.92,
        risks: [],
      },
    ],
  },
});

assertRule(invalidContentUnitStructurePackage.ready === false, 'invalid content unit structure execution package fails closed');
assertRule(
  invalidContentUnitStructurePackage.blockers.some((blocker) =>
    blocker.source === 'candidate-validation' &&
    blocker.code === 'CONTENT_UNIT_WITHOUT_TRANSCRIPT'
  ),
  'invalid content unit structure execution package surfaces missing transcript blocker',
);
assertRule(invalidContentUnitStructurePackage.filterPlan === undefined, 'invalid content unit structure package does not create filter plan');
assertRule(invalidContentUnitStructurePackage.renderContract === undefined, 'invalid content unit structure package does not create render contract');

const invalidRenderArtifactPackage = createSmartCutExecutionPackage({
  runId: 'run-invalid-render-artifact',
  sourceMedia: {
    id: 'media-render-artifact',
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
    id: 'speech-plan-invalid-render-artifact',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    sourceMediaId: 'media-render-artifact',
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

assertRule(invalidRenderArtifactPackage.ready === false, 'invalid render artifact execution package fails closed');
assertRule(invalidRenderArtifactPackage.renderContract !== undefined, 'invalid render artifact execution package still exposes render contract');
assertRule(
  invalidRenderArtifactPackage.renderArtifactValidation?.ready === false,
  'invalid render artifact execution package includes failed render artifact validation',
);
assertRule(
  invalidRenderArtifactPackage.blockers.some((blocker) =>
    blocker.source === 'render-artifact-validation' &&
    blocker.code === 'MISSING_REQUIRED_ARTIFACT_KIND'
  ),
  'invalid render artifact execution package surfaces missing artifact blocker',
);

const invalidPackage = createSmartCutExecutionPackage({
  runId: 'run-invalid',
  sourceMedia: {
    id: 'media-2',
    uri: 'file:///teacher.mp4',
    mediaKind: 'talking-head',
    durationMs: 120_000,
  },
  transcriptEvidence,
  speakerEvidence,
  speakerAlignmentReport,
  contentUnits,
  plan: {
    id: 'speech-plan-raw',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    sourceMediaId: 'media-2',
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

assertRule(invalidPackage.ready === false, 'invalid execution package fails closed');
assertRule(
  invalidPackage.blockers.some((blocker) => blocker.code === 'CANDIDATE_WITHOUT_CONTENT_UNITS'),
  'invalid execution package surfaces candidate validation blocker',
);
assertRule(invalidPackage.filterPlan === undefined, 'invalid execution package does not create filter plan');
assertRule(invalidPackage.renderContract === undefined, 'invalid execution package does not create render contract');
assertRule(invalidPackage.nativeRequests.length === 1, 'invalid execution package creates only candidate validation native request');
assertRule(
  invalidPackage.nativeValidations.some((report) =>
    report.blockers.some((blocker) => blocker.code === 'NATIVE_INTERVAL_WITHOUT_UNITS')
  ),
  'invalid execution package surfaces native raw-time interval blocker',
);

const invalidSemanticBoundaryPackage = createSmartCutExecutionPackage({
  runId: 'run-invalid-semantic-boundary',
  sourceMedia: {
    id: 'media-semantic-boundary',
    uri: 'file:///teacher.mp4',
    mediaKind: 'talking-head',
    durationMs: 120_000,
  },
  transcriptEvidence,
  speakerEvidence,
  speakerAlignmentReport,
  contentUnits: [
    {
      id: 'unit-dangling',
      startMs: 1_000,
      endMs: 20_000,
      unitKind: 'content-unit',
      text: 'The recommendation matters because',
      speakerIds: ['speaker-teacher'],
      speakerTurnIds: ['turn-dangling'],
      speakerRoles: ['teacher'],
      speakerConfidence: 0.98,
      overlapGroupIds: [],
      transcriptSegmentIds: ['segment-dangling'],
      evidenceIds: ['transcript', 'speaker'],
      topicIds: ['topic-planning'],
      completenessScore: 0.9,
      continuityScore: 0.9,
      publishabilityScore: 0.88,
    },
  ],
  contentUnitBuildReport: validateSmartCutContentUnitBuildReport({
    ready: true,
    presetId: 'teacher-talking-head-single',
    units: [
      {
        id: 'unit-dangling',
        startMs: 1_000,
        endMs: 20_000,
        unitKind: 'content-unit',
        text: 'The recommendation matters because',
        speakerIds: ['speaker-teacher'],
        speakerTurnIds: ['turn-dangling'],
        speakerRoles: ['teacher'],
        speakerConfidence: 0.98,
        overlapGroupIds: [],
        transcriptSegmentIds: ['segment-dangling'],
        evidenceIds: ['transcript', 'speaker'],
        topicIds: ['topic-planning'],
        completenessScore: 0.9,
        continuityScore: 0.9,
        publishabilityScore: 0.88,
      },
    ],
    unitCount: 1,
    publishableUnitCount: 1,
    lowInformationUnitCount: 0,
    questionUnitCount: 0,
    answerUnitCount: 0,
    distinctSpeakerCount: 1,
    blockers: [],
  }),
  plan: {
    id: 'speech-plan-invalid-semantic-boundary',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    sourceMediaId: 'media-semantic-boundary',
    presetId: 'teacher-talking-head-single',
    candidates: [
      {
        id: 'candidate-dangling',
        slicerId: 'speech-semantic',
        startMs: 1_000,
        endMs: 20_000,
        unitIds: ['unit-dangling'],
        title: 'Dangling idea',
        reason: 'Candidate would pass score validation, but semantic boundary is incomplete.',
        confidence: 0.9,
        risks: [],
      },
    ],
  },
});

assertRule(invalidSemanticBoundaryPackage.ready === false, 'invalid semantic boundary execution package fails closed');
assertRule(
  invalidSemanticBoundaryPackage.blockers.some((blocker) => blocker.code === 'DANGLING_CONNECTOR_BOUNDARY'),
  'invalid semantic boundary execution package surfaces semantic boundary blocker',
);
assertRule(invalidSemanticBoundaryPackage.filterPlan === undefined, 'invalid semantic boundary execution package does not create filter plan');
assertRule(invalidSemanticBoundaryPackage.renderContract === undefined, 'invalid semantic boundary execution package does not create render contract');

const invalidSelectionPackage = createSmartCutExecutionPackage({
  runId: 'run-invalid-selection',
  sourceMedia: {
    id: 'media-selection',
    uri: 'file:///teacher.mp4',
    mediaKind: 'talking-head',
    durationMs: 120_000,
  },
  transcriptEvidence,
  speakerEvidence,
  speakerAlignmentReport,
  contentUnits: [
    {
      id: 'unit-low',
      startMs: 1_000,
      endMs: 20_000,
      unitKind: 'content-unit',
      text: 'Low-value complete but not publishable idea.',
      speakerIds: ['speaker-teacher'],
      speakerTurnIds: ['turn-low'],
      speakerRoles: ['teacher'],
      speakerConfidence: 0.98,
      overlapGroupIds: [],
      transcriptSegmentIds: ['segment-low'],
      evidenceIds: ['transcript', 'speaker'],
      topicIds: ['topic-planning'],
      completenessScore: 0.9,
      continuityScore: 0.9,
      publishabilityScore: 0.45,
    },
  ],
  contentUnitBuildReport: validateSmartCutContentUnitBuildReport({
    ready: true,
    presetId: 'teacher-talking-head-single',
    units: [
      {
        id: 'unit-low',
        startMs: 1_000,
        endMs: 20_000,
        unitKind: 'content-unit',
        text: 'Low-value complete but not publishable idea.',
        speakerIds: ['speaker-teacher'],
        speakerTurnIds: ['turn-low'],
        speakerRoles: ['teacher'],
        speakerConfidence: 0.98,
        overlapGroupIds: [],
        transcriptSegmentIds: ['segment-low'],
        evidenceIds: ['transcript', 'speaker'],
        topicIds: ['topic-planning'],
        completenessScore: 0.9,
        continuityScore: 0.9,
        publishabilityScore: 0.45,
      },
    ],
    unitCount: 1,
    publishableUnitCount: 0,
    lowInformationUnitCount: 1,
    questionUnitCount: 0,
    answerUnitCount: 0,
    distinctSpeakerCount: 1,
    blockers: [],
  }),
  plan: {
    id: 'speech-plan-invalid-selection',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    sourceMediaId: 'media-selection',
    presetId: 'teacher-talking-head-single',
    candidates: [
      {
        id: 'candidate-low',
        slicerId: 'speech-semantic',
        startMs: 1_000,
        endMs: 20_000,
        unitIds: ['unit-low'],
        title: 'Low quality',
        reason: 'Semantic boundary is complete but quality is not publishable.',
        confidence: 0.95,
        risks: [],
      },
    ],
  },
});

assertRule(invalidSelectionPackage.ready === false, 'invalid candidate selection execution package fails closed');
assertRule(
  invalidSelectionPackage.blockers.some((blocker) => blocker.code === 'NO_SELECTED_CANDIDATES'),
  'invalid candidate selection execution package surfaces no selected candidates blocker',
);
assertRule(invalidSelectionPackage.filterPlan === undefined, 'invalid candidate selection execution package does not create filter plan');
assertRule(invalidSelectionPackage.renderContract === undefined, 'invalid candidate selection execution package does not create render contract');

const invalidFilterEffectPackage = createSmartCutExecutionPackage({
  runId: 'run-invalid-filter-effect',
  sourceMedia: {
    id: 'media-filter-effect',
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
    id: 'speech-plan-invalid-filter-effect',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    sourceMediaId: 'media-filter-effect',
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

assertRule(invalidFilterEffectPackage.ready === false, 'invalid filter effect execution package fails closed');
assertRule(invalidFilterEffectPackage.filterPlan !== undefined, 'invalid filter effect execution package still exposes filter plan');
assertRule(
  invalidFilterEffectPackage.filterEffectValidation?.ready === false,
  'invalid filter effect execution package includes failed filter effect validation',
);
assertRule(
  invalidFilterEffectPackage.blockers.some((blocker) =>
    blocker.source === 'filter-effect-validation' &&
    blocker.code === 'FILTERED_CANDIDATE_MISSING_REQUIRED_UNIT'
  ),
  'invalid filter effect execution package surfaces post-filter semantic unit blocker',
);
assertRule(invalidFilterEffectPackage.renderContract === undefined, 'invalid filter effect execution package does not create render contract');
assertRule(
  !invalidFilterEffectPackage.nativeRequests.some((request) =>
    request.commandId === 'smart_cut_render_plan' || request.commandId === 'smart_cut_probe_artifacts'
  ),
  'invalid filter effect execution package does not create render native requests',
);

const invalidEvidencePackage = createSmartCutExecutionPackage({
  runId: 'run-invalid-evidence',
  sourceMedia: {
    id: 'media-3',
    uri: 'file:///teacher.mp4',
    mediaKind: 'talking-head',
    durationMs: 120_000,
  },
  transcriptEvidence: {
    kind: 'transcript',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    provider: 'fixture-stt',
    language: 'en-US',
    segments: [
      {
        id: 'segment-missing-speaker',
        startMs: 1_000,
        endMs: 20_000,
        text: 'This transcript has no aligned speaker evidence.',
        confidence: 0.94,
        language: 'en-US',
      },
    ],
  },
  speakerEvidence: {
    kind: 'speaker',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    profiles: [],
    segments: [],
    turns: [],
    overlappingSpeechGroups: [],
    roleAssignments: [],
    corrections: [],
  },
  contentUnits,
  plan: {
    id: 'speech-plan-invalid-evidence',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    sourceMediaId: 'media-3',
    presetId: 'teacher-talking-head-single',
    candidates: [
      {
        id: 'candidate-1',
        slicerId: 'speech-semantic',
        startMs: 1_000,
        endMs: 61_000,
        unitIds: ['unit-1', 'unit-2'],
        title: 'Complete planning clip',
        reason: 'Candidate would pass, but evidence quality must fail first.',
        confidence: 0.92,
        risks: [],
      },
    ],
  },
});

assertRule(invalidEvidencePackage.ready === false, 'invalid evidence execution package fails closed');
assertRule(
  invalidEvidencePackage.blockers.some((blocker) => blocker.code === 'MISSING_SPEAKER_DIARIZATION'),
  'invalid evidence execution package surfaces evidence quality blocker',
);
assertRule(invalidEvidencePackage.filterPlan === undefined, 'invalid evidence execution package does not create filter plan');
assertRule(invalidEvidencePackage.renderContract === undefined, 'invalid evidence execution package does not create render contract');

if (failures.length > 0) {
  console.error(`blocked - smart cut execution package failures=${failures.length}`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`ok - smart cut execution package checks=${pass.length}`);
