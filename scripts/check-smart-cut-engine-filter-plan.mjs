#!/usr/bin/env node

import process from 'node:process';

import {
  createSmartCutPostSliceFilterPlan,
  validateSmartCutPostSliceFilterPlan,
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

const teacherFilterPlan = createSmartCutPostSliceFilterPlan({
  presetId: 'teacher-talking-head-single',
  planId: 'speech-plan-teacher',
  candidateIds: ['candidate-1'],
  completedPipelineStepIds: [
    'prepare-source',
    'extract-native-evidence',
    'speech-to-text',
    'speaker-diarization',
    'align-transcript-speakers',
    'build-content-units',
    'run-slicer-chain',
    'llm-review-rank',
    'validate-candidates',
  ],
});

assertRule(teacherFilterPlan.presetId === 'teacher-talking-head-single', 'filter plan keeps preset id');
assertRule(teacherFilterPlan.sourcePlanId === 'speech-plan-teacher', 'filter plan records source candidate plan id');
assertRule(teacherFilterPlan.candidateIds.join(',') === 'candidate-1', 'filter plan records candidate ids');
assertRule(
  teacherFilterPlan.steps.map((step) => step.filterId).join('>') === [
    'speech-denoise',
    'dereverb',
    'silence-trim',
    'abnormal-segment-remove',
    'repeat-deduplicate',
    'stabilize-video',
    'smart-reframe',
    'subtitle-sync',
    'keyword-highlight',
    'bgm-ducking',
    'prompt-sfx',
    'cover-generate',
  ].join('>'),
  'teacher filter plan follows preset filter order',
);
assertRule(
  teacherFilterPlan.steps.find((step) => step.filterId === 'silence-trim')?.stage === 'post-slice',
  'silence trim stays in post-slice stage after candidate validation',
);
assertRule(
  teacherFilterPlan.steps.find((step) => step.filterId === 'speech-denoise')?.nativeAcceleration === 'required',
  'speech denoise is marked native-required in execution plan',
);
assertRule(
  teacherFilterPlan.requiresPostFilterRevalidation === true,
  'filter plan requires post-filter revalidation when destructive filters are present',
);
assertRule(
  teacherFilterPlan.requiredValidatorIds.includes('post-filter-integrity') &&
    teacherFilterPlan.requiredValidatorIds.includes('semantic-completeness') &&
    teacherFilterPlan.requiredValidatorIds.includes('speaker-continuity') &&
    teacherFilterPlan.requiredValidatorIds.includes('boundary-integrity'),
  'filter plan revalidates semantic, speaker, boundary, and post-filter integrity',
);
assertRule(
  teacherFilterPlan.nativeCommandIds.includes('smart_cut_apply_filter_plan') &&
    teacherFilterPlan.nativeCommandIds.includes('smart_cut_validate_filtered_plan'),
  'filter plan includes native apply and filtered validation commands',
);
assertRule(
  teacherFilterPlan.steps
    .filter((step) => step.destructive)
    .every((step) => step.requiresRevalidation),
  'every destructive filter step requires revalidation',
);

const validReport = validateSmartCutPostSliceFilterPlan({
  filterPlan: teacherFilterPlan,
  completedPipelineStepIds: [
    'prepare-source',
    'extract-native-evidence',
    'speech-to-text',
    'speaker-diarization',
    'align-transcript-speakers',
    'build-content-units',
    'run-slicer-chain',
    'llm-review-rank',
    'validate-candidates',
  ],
});

assertRule(validReport.ready === true, 'valid filter plan passes validation');
assertRule(validReport.blockers.length === 0, 'valid filter plan has no blockers');

const invalidSchemaReport = validateSmartCutPostSliceFilterPlan({
  filterPlan: {
    ...teacherFilterPlan,
    schemaVersion: 'old-standard',
  },
  completedPipelineStepIds: teacherFilterPlan.completedPipelineStepIds,
});
assertRule(
  invalidSchemaReport.blockers.some((blocker) => blocker.code === 'INVALID_FILTER_PLAN_SCHEMA_VERSION'),
  'filter plan rejects invalid schema version',
);

const missingSourcePlanReport = validateSmartCutPostSliceFilterPlan({
  filterPlan: {
    ...teacherFilterPlan,
    sourcePlanId: ' ',
  },
  completedPipelineStepIds: teacherFilterPlan.completedPipelineStepIds,
});
assertRule(
  missingSourcePlanReport.blockers.some((blocker) => blocker.code === 'FILTER_PLAN_SOURCE_PLAN_MISSING'),
  'filter plan rejects missing source plan id',
);

const blankCandidateReport = validateSmartCutPostSliceFilterPlan({
  filterPlan: {
    ...teacherFilterPlan,
    candidateIds: ['candidate-1', ' '],
  },
  completedPipelineStepIds: teacherFilterPlan.completedPipelineStepIds,
});
assertRule(
  blankCandidateReport.blockers.some((blocker) => blocker.code === 'FILTER_PLAN_WITH_BLANK_CANDIDATE_ID'),
  'filter plan rejects blank candidate ids',
);

const duplicateCandidateReport = validateSmartCutPostSliceFilterPlan({
  filterPlan: {
    ...teacherFilterPlan,
    candidateIds: ['candidate-1', 'candidate-1'],
  },
  completedPipelineStepIds: teacherFilterPlan.completedPipelineStepIds,
});
assertRule(
  duplicateCandidateReport.blockers.some((blocker) => blocker.code === 'FILTER_PLAN_WITH_DUPLICATE_CANDIDATE_ID'),
  'filter plan rejects duplicate candidate ids',
);

const mismatchedCompletedStepsReport = validateSmartCutPostSliceFilterPlan({
  filterPlan: {
    ...teacherFilterPlan,
    completedPipelineStepIds: ['validate-candidates'],
  },
  completedPipelineStepIds: teacherFilterPlan.completedPipelineStepIds,
});
assertRule(
  mismatchedCompletedStepsReport.blockers.some((blocker) => blocker.code === 'FILTER_PLAN_COMPLETED_STEPS_MISMATCH'),
  'filter plan rejects mismatched completed pipeline steps',
);

const stageMismatchReport = validateSmartCutPostSliceFilterPlan({
  filterPlan: {
    ...teacherFilterPlan,
    steps: teacherFilterPlan.steps.map((step) =>
      step.filterId === 'silence-trim'
        ? {
            ...step,
            stage: 'pre-evidence',
          }
        : step
    ),
  },
  completedPipelineStepIds: teacherFilterPlan.completedPipelineStepIds,
});
assertRule(
  stageMismatchReport.blockers.some((blocker) => blocker.code === 'FILTER_STEP_REGISTRY_MISMATCH'),
  'filter plan rejects filter step metadata that does not match registry',
);

const indexMismatchReport = validateSmartCutPostSliceFilterPlan({
  filterPlan: {
    ...teacherFilterPlan,
    steps: teacherFilterPlan.steps.map((step, index) =>
      index === 1
        ? {
            ...step,
            index: 0,
          }
        : step
    ),
  },
  completedPipelineStepIds: teacherFilterPlan.completedPipelineStepIds,
});
assertRule(
  indexMismatchReport.blockers.some((blocker) => blocker.code === 'FILTER_STEP_INDEX_INVALID'),
  'filter plan rejects non-sequential filter step indexes',
);

const missingPresetFilterReport = validateSmartCutPostSliceFilterPlan({
  filterPlan: {
    ...teacherFilterPlan,
    steps: teacherFilterPlan.steps.filter((step) => step.filterId !== 'speech-denoise'),
  },
  completedPipelineStepIds: teacherFilterPlan.completedPipelineStepIds,
});
assertRule(
  missingPresetFilterReport.blockers.some((blocker) => blocker.code === 'FILTER_PLAN_PRESET_FILTER_CHAIN_MISMATCH'),
  'filter plan rejects missing preset filters',
);

const missingRevalidationFlagReport = validateSmartCutPostSliceFilterPlan({
  filterPlan: {
    ...teacherFilterPlan,
    requiresPostFilterRevalidation: false,
  },
  completedPipelineStepIds: teacherFilterPlan.completedPipelineStepIds,
});
assertRule(
  missingRevalidationFlagReport.blockers.some((blocker) => blocker.code === 'FILTER_PLAN_REVALIDATION_FLAG_MISMATCH'),
  'filter plan rejects mismatched revalidation flag',
);

const earlyFilterPlan = createSmartCutPostSliceFilterPlan({
  presetId: 'teacher-talking-head-single',
  planId: 'speech-plan-early',
  candidateIds: ['candidate-1'],
  completedPipelineStepIds: [
    'prepare-source',
    'extract-native-evidence',
    'speech-to-text',
  ],
});
const earlyReport = validateSmartCutPostSliceFilterPlan({
  filterPlan: earlyFilterPlan,
  completedPipelineStepIds: [
    'prepare-source',
    'extract-native-evidence',
    'speech-to-text',
  ],
});

assertRule(earlyReport.ready === false, 'filter plan cannot run before candidate validation');
assertRule(
  earlyReport.blockers.some((blocker) => blocker.code === 'FILTERS_BEFORE_CANDIDATE_VALIDATION'),
  'early filter validation reports candidate validation blocker',
);

const emptyCandidateFilterPlan = createSmartCutPostSliceFilterPlan({
  presetId: 'teacher-talking-head-single',
  planId: 'speech-plan-empty',
  candidateIds: [],
  completedPipelineStepIds: ['validate-candidates'],
});
const emptyReport = validateSmartCutPostSliceFilterPlan({
  filterPlan: emptyCandidateFilterPlan,
  completedPipelineStepIds: ['validate-candidates'],
});

assertRule(emptyReport.ready === false, 'filter plan without candidates fails');
assertRule(
  emptyReport.blockers.some((blocker) => blocker.code === 'FILTER_PLAN_WITHOUT_CANDIDATES'),
  'filter plan without candidates reports blocker',
);

if (failures.length > 0) {
  console.error(`blocked - smart cut filter plan failures=${failures.length}`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`ok - smart cut filter plan checks=${pass.length}`);
