#!/usr/bin/env node

import process from 'node:process';

import {
  SMART_CUT_DEFAULT_PRODUCT_PRESET_ID,
  SMART_CUT_DEFAULT_SLICER_ID,
  SMART_CUT_EVIDENCE_KINDS,
  SMART_CUT_FILTER_REGISTRY,
  SMART_CUT_NATIVE_COMMAND_REGISTRY,
  SMART_CUT_PRODUCT_PRESET_REGISTRY,
  SMART_CUT_SLICER_REGISTRY,
  SMART_CUT_STANDARD_VERSION,
  SMART_CUT_VALIDATOR_REGISTRY,
  buildSmartCutContentUnits,
  createSmartCutEngineStandardReport,
  createSmartCutExecutionAuditTrace,
  createSmartCutPostSliceFilterPlan,
  createSmartCutProviderExecutionAuditTrace,
  createSmartCutSpeechFirstExecutionPackageFromProviders,
  createSmartCutSpeechFirstExecutionPackage,
  createSpeechSemanticSlicePlan,
  selectSmartCutCandidates,
  validateSmartCutEvidenceQuality,
  validateSmartCutSpeakerEvidenceStructure,
  validateSmartCutFilterEffects,
  validateSmartCutStrategyRegistry,
  validateSmartCutLlmCandidateReviewReport,
  validateSmartCutRenderArtifacts,
  validateSmartCutSemanticBoundaryProof,
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

function assertIncludes(values, expectedValue, message) {
  assertRule(
    Array.isArray(values) && values.includes(expectedValue),
    `${message} (expected ${JSON.stringify(expectedValue)})`,
  );
}

function assertRegistryIncludes(registry, expectedId, message) {
  assertRule(
    registry.some((entry) => entry.id === expectedId),
    `${message} (expected id ${JSON.stringify(expectedId)})`,
  );
}

function getRegistryEntry(registry, expectedId) {
  return registry.find((entry) => entry.id === expectedId);
}

const requiredSlicerIds = [
  'speech-semantic',
  'dialogue-qa',
  'topic-chapter',
  'meeting-agenda',
  'podcast-topic',
  'knowledge-point',
  'visual-scene',
  'motion-action',
  'audio-waveform',
  'music-beat',
  'multimodal-highlight',
  'template-rule',
  'event-detection',
  'screen-ocr',
  'commerce-live',
  'documentary-chapter',
  'film-scene',
  'sports-event',
  'gaming-highlight',
  'vlog-story',
  'course-chapter',
  'news-segment',
  'compliance',
];

assertRule(
  SMART_CUT_STANDARD_VERSION === '2026-05-14.smart-cut-engine.v1',
  'standard exposes the current smart cut engine version',
);
assertRule(
  SMART_CUT_DEFAULT_SLICER_ID === 'speech-semantic',
  'default slicer is speech semantic for the current speech-first requirement',
);
assertRule(
  SMART_CUT_DEFAULT_PRODUCT_PRESET_ID === 'teacher-talking-head-single',
  'default product preset matches the original teacher talking-head requirement',
);

for (const slicerId of requiredSlicerIds) {
  assertRegistryIncludes(SMART_CUT_SLICER_REGISTRY, slicerId, `slicer registry includes ${slicerId}`);
}

assertIncludes(SMART_CUT_EVIDENCE_KINDS, 'transcript', 'evidence model includes transcript evidence');
assertIncludes(SMART_CUT_EVIDENCE_KINDS, 'speaker', 'evidence model includes first-class speaker evidence');
assertIncludes(SMART_CUT_EVIDENCE_KINDS, 'audio', 'evidence model includes audio evidence');
assertIncludes(SMART_CUT_EVIDENCE_KINDS, 'visual', 'evidence model includes visual evidence');
assertIncludes(SMART_CUT_EVIDENCE_KINDS, 'ocr', 'evidence model includes OCR evidence for screen/content slicing');
assertIncludes(SMART_CUT_EVIDENCE_KINDS, 'music', 'evidence model includes music evidence for beat slicing');
assertIncludes(SMART_CUT_EVIDENCE_KINDS, 'llm-review', 'evidence model includes constrained LLM review evidence');

const speechSemantic = getRegistryEntry(SMART_CUT_SLICER_REGISTRY, 'speech-semantic');
assertRule(
  speechSemantic?.requiredEvidence.includes('transcript') === true &&
    speechSemantic?.requiredEvidence.includes('speaker') === true,
  'speech semantic slicer requires transcript and speaker evidence before planning',
);
assertRule(
  speechSemantic?.boundaryPolicy.primaryUnit === 'content-unit' &&
    speechSemantic?.boundaryPolicy.allowsRawTimeCut === false,
  'speech semantic slicer cuts by content units and forbids raw time-only cuts',
);
assertRule(
  speechSemantic?.llmPolicy.role === 'reviewer-ranker' &&
    speechSemantic?.llmPolicy.mustReferenceStableIds === true,
  'speech semantic slicer constrains LLM to reviewer/ranker output referencing stable ids',
);

const dialogueQa = getRegistryEntry(SMART_CUT_SLICER_REGISTRY, 'dialogue-qa');
assertRule(
  dialogueQa?.speakerPolicy.requiresDiarization === true &&
    dialogueQa?.speakerPolicy.requiresRoleAssignment === true,
  'dialogue QA slicer requires diarization and role assignment',
);

const filmScene = getRegistryEntry(SMART_CUT_SLICER_REGISTRY, 'film-scene');
assertRule(
  filmScene?.requiredEvidence.includes('visual') === true &&
    filmScene?.requiredEvidence.includes('audio') === true,
  'film scene slicer is multimodal and not speech-only',
);

const teacherPreset = getRegistryEntry(SMART_CUT_PRODUCT_PRESET_REGISTRY, 'teacher-talking-head-single');
assertRule(
  teacherPreset?.requirementSource === 'ORG_REQUIREMENTS.type-1' &&
    teacherPreset?.outputProfile.aspectRatio === '9:16' &&
    teacherPreset?.outputProfile.resolution === '1080x1920' &&
    teacherPreset?.outputProfile.frameRateFps === 30 &&
    teacherPreset?.outputProfile.maxDurationMs === 90_000,
  'teacher preset preserves original type-1 output contract',
);
assertRule(
  teacherPreset?.slicerChain[0] === 'speech-semantic' &&
    teacherPreset?.validators.includes('semantic-completeness') &&
    teacherPreset?.filters.includes('speech-denoise') &&
    teacherPreset?.filters.includes('silence-trim') &&
    teacherPreset?.filters.includes('repeat-deduplicate') &&
    teacherPreset?.renderers.includes('publishable-short-video'),
  'teacher preset composes semantic slicing, post-slice filters, validators, and renderer',
);

const interviewPreset = getRegistryEntry(SMART_CUT_PRODUCT_PRESET_REGISTRY, 'interview-one-question-one-answer');
assertRule(
  interviewPreset?.requirementSource === 'ORG_REQUIREMENTS.type-2' &&
    interviewPreset?.slicerChain.includes('dialogue-qa') &&
    interviewPreset?.requiresSpeakerDiarization === true,
  'interview preset maps original type-2 requirement to dialogue QA with speaker diarization',
);

const longInterviewPreset = getRegistryEntry(SMART_CUT_PRODUCT_PRESET_REGISTRY, 'long-interview-matrix');
assertRule(
  longInterviewPreset?.requirementSource === 'ORG_REQUIREMENTS.type-3' &&
    longInterviewPreset?.outputProfile.minDurationMs === 60_000 &&
    longInterviewPreset?.outputProfile.maxDurationMs === 180_000 &&
    longInterviewPreset?.slicerChain.includes('dialogue-qa'),
  'long interview preset maps original type-3 requirement to 60-180s Q/A matrix slicing',
);

const destructiveFilters = SMART_CUT_FILTER_REGISTRY.filter((filter) => filter.destructive === true);
assertRule(destructiveFilters.length >= 3, 'filter registry includes multiple destructive post-slice filters');
assertRule(
  destructiveFilters.every((filter) => filter.requiresRevalidation === true),
  'every destructive filter requires post-filter revalidation',
);
assertRegistryIncludes(SMART_CUT_FILTER_REGISTRY, 'speech-denoise', 'filter registry includes speech denoise');
assertRegistryIncludes(SMART_CUT_FILTER_REGISTRY, 'silence-trim', 'filter registry includes silence trim');
assertRegistryIncludes(SMART_CUT_FILTER_REGISTRY, 'repeat-deduplicate', 'filter registry includes repeat deduplication');
assertRegistryIncludes(SMART_CUT_FILTER_REGISTRY, 'abnormal-segment-remove', 'filter registry includes abnormal segment removal');

assertRegistryIncludes(SMART_CUT_VALIDATOR_REGISTRY, 'semantic-completeness', 'validator registry includes semantic completeness');
assertRegistryIncludes(SMART_CUT_VALIDATOR_REGISTRY, 'speaker-continuity', 'validator registry includes speaker continuity');
assertRegistryIncludes(SMART_CUT_VALIDATOR_REGISTRY, 'boundary-integrity', 'validator registry includes boundary integrity');
assertRegistryIncludes(SMART_CUT_VALIDATOR_REGISTRY, 'publishability-standard', 'validator registry includes publishability standard');

assertRegistryIncludes(SMART_CUT_NATIVE_COMMAND_REGISTRY, 'smart_cut_apply_filter_plan', 'native registry includes filter plan command');
assertRegistryIncludes(SMART_CUT_NATIVE_COMMAND_REGISTRY, 'smart_cut_render_plan', 'native registry includes render plan command');
assertRule(
  SMART_CUT_NATIVE_COMMAND_REGISTRY.every((command) =>
    command.owner === 'rust-native' &&
      command.failClosed === true &&
      command.requestSchemaVersion === command.responseSchemaVersion
  ),
  'native command registry is Rust-owned, fail-closed, and schema-versioned',
);

const report = createSmartCutEngineStandardReport();
assertRule(report.ready === true, 'standard self-report is ready');
assertRule(report.slicerCount >= requiredSlicerIds.length, 'standard self-report counts all slicers');
assertRule(report.defaultSlicerId === SMART_CUT_DEFAULT_SLICER_ID, 'standard self-report exposes default slicer');
assertRule(report.multiSpeakerPresets.includes('interview-one-question-one-answer'), 'standard self-report tracks multi-speaker interview preset');
assertRule(report.multiSpeakerPresets.includes('long-interview-matrix'), 'standard self-report tracks long-interview preset as multi-speaker');
assertRule(report.nativeCommandCount >= 10, 'standard self-report counts native command contracts');
assertRule(report.requiredNativeCommandIds.includes('smart_cut_apply_filter_plan'), 'standard self-report exposes native filter command');
assertRule(report.requiredNativeCommandIds.includes('smart_cut_render_plan'), 'standard self-report exposes native render command');

const evidenceQualityFunctionAvailable = typeof validateSmartCutEvidenceQuality === 'function';
assertRule(evidenceQualityFunctionAvailable, 'standard exposes evidence quality validation gate');
const speakerEvidenceStructureFunctionAvailable = typeof validateSmartCutSpeakerEvidenceStructure === 'function';
assertRule(speakerEvidenceStructureFunctionAvailable, 'standard exposes shared speaker evidence structure validation gate');
const semanticBoundaryFunctionAvailable = typeof validateSmartCutSemanticBoundaryProof === 'function';
assertRule(semanticBoundaryFunctionAvailable, 'standard exposes semantic boundary proof gate');
const candidateSelectionFunctionAvailable = typeof selectSmartCutCandidates === 'function';
assertRule(candidateSelectionFunctionAvailable, 'standard exposes deterministic candidate selection gate');
const llmReviewValidationFunctionAvailable = typeof validateSmartCutLlmCandidateReviewReport === 'function';
assertRule(llmReviewValidationFunctionAvailable, 'standard exposes standalone LLM review validation gate');
const filterEffectsFunctionAvailable = typeof validateSmartCutFilterEffects === 'function';
assertRule(filterEffectsFunctionAvailable, 'standard exposes post-filter effect validation gate');
if (filterEffectsFunctionAvailable) {
  const completedFilterPlanSteps = [
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
  const postFilterPlan = createSmartCutPostSliceFilterPlan({
    presetId: 'teacher-talking-head-single',
    planId: 'standard-filter-effects',
    candidateIds: ['candidate-standard-filter'],
    completedPipelineStepIds: completedFilterPlanSteps,
  });
  const postFilterEffectReport = validateSmartCutFilterEffects({
    presetId: 'teacher-talking-head-single',
    filterPlan: postFilterPlan,
    sourceCandidates: [
      {
        id: 'candidate-standard-filter',
        slicerId: 'speech-semantic',
        startMs: 1_000,
        endMs: 30_000,
        unitIds: ['unit-standard-filter'],
        title: 'Standard filter candidate',
        reason: 'Complete unit for post-filter validation.',
        confidence: 0.92,
        risks: [],
      },
    ],
    contentUnits: [
      {
        id: 'unit-standard-filter',
        startMs: 1_000,
        endMs: 30_000,
        unitKind: 'content-unit',
        text: 'A complete speech unit that must survive post-slice filtering.',
        speakerIds: ['speaker-standard'],
        speakerTurnIds: ['turn-standard'],
        speakerRoles: ['speaker'],
        speakerConfidence: 0.95,
        overlapGroupIds: [],
        transcriptSegmentIds: ['segment-standard'],
        evidenceIds: ['transcript', 'speaker'],
        topicIds: ['topic-standard'],
        completenessScore: 0.94,
        continuityScore: 0.93,
        publishabilityScore: 0.91,
      },
    ],
    filteredCandidates: [
      {
        id: 'filtered-standard',
        sourceCandidateId: 'candidate-standard-filter',
        retainedSourceRanges: [{ startMs: 1_000, endMs: 30_000 }],
        removedSourceRanges: [],
        durationMs: 29_000,
        unitIds: ['unit-standard-filter'],
        speakerIds: ['speaker-standard'],
        transcriptSegmentIds: ['segment-standard'],
        appliedEffectIds: ['effect-standard', 'effect-standard'],
      },
    ],
    effects: [
      {
        id: 'effect-standard',
        filterId: 'speech-denoise',
        candidateId: 'candidate-standard-filter',
        stepIndex: 0,
        kind: 'media-transform',
        destructive: true,
        retainedUnitIds: ['unit-standard-filter'],
        removedUnitIds: [],
        affectedSpeakerIds: ['speaker-standard'],
        sourceRanges: [{ startMs: 1_000, endMs: 30_000 }],
        outputRanges: [{ startMs: 1_000, endMs: 30_000 }],
        reason: 'valid effect',
      },
      {
        id: 'effect-standard',
        filterId: 'silence-trim',
        candidateId: 'candidate-standard-filter',
        stepIndex: 2,
        kind: 'range-trim',
        destructive: true,
        retainedUnitIds: ['unit-standard-filter'],
        removedUnitIds: [],
        affectedSpeakerIds: ['speaker-standard'],
        sourceRanges: [{ startMs: 1_000, endMs: 30_000 }],
        outputRanges: [{ startMs: 1_000, endMs: 30_000 }],
        reason: 'duplicate id fixture',
      },
    ],
  });
  assertRule(
    postFilterEffectReport.blockers.some((blocker) => blocker.code === 'DUPLICATE_FILTER_EFFECT_ID') &&
      postFilterEffectReport.blockers.some((blocker) => blocker.code === 'FILTERED_CANDIDATE_DUPLICATE_APPLIED_EFFECT'),
    'post-filter effect validation rejects duplicate native effect identities and duplicate applied effects',
  );
}
const executionAuditTraceFunctionAvailable = typeof createSmartCutExecutionAuditTrace === 'function';
assertRule(executionAuditTraceFunctionAvailable, 'standard exposes execution audit trace generator');
const providerExecutionAuditTraceFunctionAvailable = typeof createSmartCutProviderExecutionAuditTrace === 'function';
assertRule(providerExecutionAuditTraceFunctionAvailable, 'standard exposes provider execution audit trace generator');
const renderArtifactsFunctionAvailable = typeof validateSmartCutRenderArtifacts === 'function';
assertRule(renderArtifactsFunctionAvailable, 'standard exposes render artifact validation gate');
const contentUnitBuilderFunctionAvailable = typeof buildSmartCutContentUnits === 'function';
assertRule(contentUnitBuilderFunctionAvailable, 'standard exposes content unit build gate');
const speechFirstOrchestrationFunctionAvailable = typeof createSmartCutSpeechFirstExecutionPackage === 'function';
assertRule(speechFirstOrchestrationFunctionAvailable, 'standard exposes default speech-first orchestration gate');
const providerSpeechFirstOrchestrationFunctionAvailable = typeof createSmartCutSpeechFirstExecutionPackageFromProviders === 'function';
assertRule(providerSpeechFirstOrchestrationFunctionAvailable, 'standard exposes provider-driven speech-first orchestration gate');
const strategyRegistryValidationFunctionAvailable = typeof validateSmartCutStrategyRegistry === 'function';
assertRule(strategyRegistryValidationFunctionAvailable, 'standard exposes strategy registry validation gate');
if (strategyRegistryValidationFunctionAvailable) {
  assertRule(validateSmartCutStrategyRegistry().ready === true, 'strategy registry validation gate reports default registry ready');
}

const defaultSpeechSemanticPlan = createSpeechSemanticSlicePlan({
  sourceMediaId: 'media-standard-default-speech',
  sourceDurationMs: 90_000,
  presetId: 'teacher-talking-head-single',
  transcriptEvidence: {
    kind: 'transcript',
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    provider: 'fixture-stt',
    language: 'en-US',
    segments: [
      {
        id: 'standard-segment-1',
        startMs: 1_000,
        endMs: 20_000,
        text: 'Planning starts with a clear goal.',
        confidence: 0.96,
        language: 'en-US',
        speakerId: 'speaker-teacher',
      },
      {
        id: 'standard-segment-2',
        startMs: 20_200,
        endMs: 44_000,
        text: 'Every activity and recommendation should support the same story.',
        confidence: 0.96,
        language: 'en-US',
        speakerId: 'speaker-teacher',
      },
      {
        id: 'standard-filler',
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
      { id: 'speaker-segment-standard-teacher', speakerId: 'speaker-teacher', startMs: 900, endMs: 46_100, confidence: 0.98 },
    ],
    turns: [
      {
        id: 'standard-turn-main',
        speakerId: 'speaker-teacher',
        startMs: 1_000,
        endMs: 44_000,
        sentenceIds: ['standard-sentence-1', 'standard-sentence-2'],
        transcriptSegmentIds: ['standard-segment-1', 'standard-segment-2'],
        text: 'Planning starts with a clear goal. Every activity and recommendation should support the same story.',
        isQuestion: false,
        isAnswerCandidate: true,
        isInterruption: false,
        isBackchannel: false,
        topicIds: ['topic-planning'],
        risks: [],
      },
      {
        id: 'standard-turn-filler',
        speakerId: 'speaker-teacher',
        startMs: 44_200,
        endMs: 46_000,
        sentenceIds: ['standard-sentence-filler'],
        transcriptSegmentIds: ['standard-filler'],
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
        evidenceTurnIds: ['standard-turn-main', 'standard-turn-filler'],
        source: 'rule',
      },
    ],
    corrections: [],
  },
});

assertRule(
  defaultSpeechSemanticPlan.contentUnitBuildReport.ready === true &&
    defaultSpeechSemanticPlan.contentUnitBuildReport.publishableUnitCount === 1 &&
    defaultSpeechSemanticPlan.contentUnitBuildReport.lowInformationUnitCount === 1,
  'default speech semantic plan exposes standard content unit build report',
);
assertRule(
  defaultSpeechSemanticPlan.contentUnitBuildReport.units[0]?.speakerTurnIds.length === 1 &&
    defaultSpeechSemanticPlan.contentUnitBuildReport.units[0]?.speakerRoles.includes('teacher') &&
    (defaultSpeechSemanticPlan.contentUnitBuildReport.units[0]?.speakerConfidence ?? 0) >= 0.95,
  'default speech semantic content units preserve speaker turn, role, and confidence context',
);
assertRule(
  defaultSpeechSemanticPlan.candidates[0]?.unitIds.join(',') === 'unit-1' &&
    defaultSpeechSemanticPlan.candidates[0]?.endMs === 44_000,
  'default speech semantic plan excludes low-information filler from publishable candidate',
);

if (failures.length > 0) {
  console.error(`blocked - smart cut engine standard failures=${failures.length}`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`ok - smart cut engine standard checks=${pass.length}`);
