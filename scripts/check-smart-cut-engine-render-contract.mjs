#!/usr/bin/env node

import process from 'node:process';

import {
  createSmartCutRenderContract,
  validateSmartCutRenderContract,
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

const teacherContract = createSmartCutRenderContract({
  presetId: 'teacher-talking-head-single',
  planId: 'filtered-plan-teacher',
  candidateIds: ['candidate-1'],
});

assertRule(teacherContract.presetId === 'teacher-talking-head-single', 'render contract keeps preset id');
assertRule(teacherContract.sourcePlanId === 'filtered-plan-teacher', 'render contract records filtered source plan id');
assertRule(teacherContract.candidateIds.join(',') === 'candidate-1', 'render contract records candidate ids');
assertRule(teacherContract.rendererIds.join(',') === 'publishable-short-video', 'teacher contract uses single publishable renderer');
assertRule(teacherContract.outputProfile.aspectRatio === '9:16', 'teacher contract preserves vertical aspect ratio');
assertRule(teacherContract.outputProfile.resolution === '1080x1920', 'teacher contract preserves 1080x1920 resolution');
assertRule(teacherContract.outputProfile.frameRateFps === 30, 'teacher contract preserves 30fps output');
assertRule(teacherContract.outputProfile.format === 'mp4', 'teacher contract preserves mp4 output');
assertRule(teacherContract.outputProfile.maxDurationMs === 90_000, 'teacher contract preserves <=90s output maximum');
assertRule(teacherContract.subtitle.enabled === true, 'teacher contract enables subtitles');
assertRule(teacherContract.subtitle.language === 'zh-CN', 'teacher contract uses simplified Chinese subtitle profile');
assertRule(teacherContract.subtitle.granularity === 'sentence', 'teacher contract uses sentence-level subtitles');
assertRule(teacherContract.subtitle.fontFamily === 'Jisong', 'teacher contract uses Jisong subtitle font');
assertRule(teacherContract.subtitle.shadow === true, 'teacher contract enables subtitle shadow');
assertRule(teacherContract.subtitle.keywordHighlight === true, 'teacher contract enables keyword highlighting');
assertRule(teacherContract.subtitle.syncRequired === true, 'teacher contract requires subtitle sync');
assertRule(teacherContract.audio.speechEnhancement === true, 'teacher contract enables speech enhancement');
assertRule(teacherContract.audio.removeReverb === true, 'teacher contract removes reverb');
assertRule(teacherContract.audio.bgmVolumePercent === 20, 'teacher contract sets BGM volume to 20 percent');
assertRule(teacherContract.audio.promptSfx === true, 'teacher contract enables prompt sound effects');
assertRule(teacherContract.visual.stabilize === true, 'teacher contract enables video stabilization');
assertRule(teacherContract.visual.smartReframe === true, 'teacher contract enables smart reframe');
assertRule(teacherContract.visual.framing === 'upper-body-two-thirds', 'teacher contract preserves upper-body two-thirds framing');
assertRule(teacherContract.visual.coverPolicy === 'question-plus-core', 'teacher contract generates question plus core cover');
assertRule(
  teacherContract.requiredArtifactKinds.join(',') === 'rendered-video,subtitle,cover,quality-report',
  'teacher contract requires video, subtitle, cover, and quality report artifacts',
);
assertRule(
  teacherContract.requiredValidatorIds.includes('render-artifact-integrity') &&
    teacherContract.requiredValidatorIds.includes('publishability-standard'),
  'render contract requires render artifact and publishability validation',
);
assertRule(
  teacherContract.nativeCommandIds.includes('smart_cut_render_plan') &&
    teacherContract.nativeCommandIds.includes('smart_cut_probe_artifacts'),
  'render contract includes native render and artifact probe commands',
);

const teacherValidation = validateSmartCutRenderContract({
  renderContract: teacherContract,
});

assertRule(teacherValidation.ready === true, 'teacher render contract passes validation');
assertRule(teacherValidation.blockers.length === 0, 'teacher render contract has no blockers');

const invalidSchemaValidation = validateSmartCutRenderContract({
  renderContract: {
    ...teacherContract,
    schemaVersion: 'old-standard',
  },
});
assertRule(
  invalidSchemaValidation.blockers.some((blocker) => blocker.code === 'INVALID_RENDER_CONTRACT_SCHEMA_VERSION'),
  'render contract rejects invalid schema version',
);

const missingPlanValidation = validateSmartCutRenderContract({
  renderContract: {
    ...teacherContract,
    sourcePlanId: ' ',
  },
});
assertRule(
  missingPlanValidation.blockers.some((blocker) => blocker.code === 'RENDER_CONTRACT_SOURCE_PLAN_MISSING'),
  'render contract rejects missing source plan id',
);

const blankCandidateValidation = validateSmartCutRenderContract({
  renderContract: {
    ...teacherContract,
    candidateIds: ['candidate-1', ' '],
  },
});
assertRule(
  blankCandidateValidation.blockers.some((blocker) => blocker.code === 'RENDER_CONTRACT_WITH_BLANK_CANDIDATE_ID'),
  'render contract rejects blank candidate ids',
);

const duplicateCandidateValidation = validateSmartCutRenderContract({
  renderContract: {
    ...teacherContract,
    candidateIds: ['candidate-1', 'candidate-1'],
  },
});
assertRule(
  duplicateCandidateValidation.blockers.some((blocker) => blocker.code === 'RENDER_CONTRACT_WITH_DUPLICATE_CANDIDATE_ID'),
  'render contract rejects duplicate candidate ids',
);

const presetRendererMismatchValidation = validateSmartCutRenderContract({
  renderContract: {
    ...teacherContract,
    rendererIds: ['batch-short-video'],
  },
});
assertRule(
  presetRendererMismatchValidation.blockers.some((blocker) => blocker.code === 'RENDER_CONTRACT_RENDERER_MISMATCH'),
  'render contract rejects renderer ids outside the selected preset contract',
);

const missingPresetRendererValidation = validateSmartCutRenderContract({
  renderContract: {
    ...teacherContract,
    rendererIds: [],
  },
});
assertRule(
  missingPresetRendererValidation.blockers.some((blocker) => blocker.code === 'RENDER_CONTRACT_PRESET_RENDERER_CHAIN_MISMATCH'),
  'render contract rejects missing preset renderer chain',
);

const outputProfileMismatchValidation = validateSmartCutRenderContract({
  renderContract: {
    ...teacherContract,
    outputProfile: {
      ...teacherContract.outputProfile,
      resolution: '1920x1080',
    },
  },
});
assertRule(
  outputProfileMismatchValidation.blockers.some((blocker) => blocker.code === 'RENDER_CONTRACT_OUTPUT_PROFILE_MISMATCH'),
  'render contract rejects output profile mismatch with preset',
);

const subtitleProfileMismatchValidation = validateSmartCutRenderContract({
  renderContract: {
    ...teacherContract,
    subtitle: {
      ...teacherContract.subtitle,
      fontFamily: 'Arial',
    },
  },
});
assertRule(
  subtitleProfileMismatchValidation.blockers.some((blocker) => blocker.code === 'RENDER_CONTRACT_SUBTITLE_PROFILE_MISMATCH'),
  'render contract rejects subtitle profile mismatch with preset',
);

const audioProfileMismatchValidation = validateSmartCutRenderContract({
  renderContract: {
    ...teacherContract,
    audio: {
      ...teacherContract.audio,
      bgmVolumePercent: 0,
    },
  },
});
assertRule(
  audioProfileMismatchValidation.blockers.some((blocker) => blocker.code === 'RENDER_CONTRACT_AUDIO_PROFILE_MISMATCH'),
  'render contract rejects audio packaging mismatch with preset',
);

const visualProfileMismatchValidation = validateSmartCutRenderContract({
  renderContract: {
    ...teacherContract,
    visual: {
      ...teacherContract.visual,
      framing: 'speaker-focus',
    },
  },
});
assertRule(
  visualProfileMismatchValidation.blockers.some((blocker) => blocker.code === 'RENDER_CONTRACT_VISUAL_PROFILE_MISMATCH'),
  'render contract rejects visual packaging mismatch with preset',
);

const artifactKindMismatchValidation = validateSmartCutRenderContract({
  renderContract: {
    ...teacherContract,
    requiredArtifactKinds: ['rendered-video', 'quality-report'],
  },
});
assertRule(
  artifactKindMismatchValidation.blockers.some((blocker) => blocker.code === 'RENDER_CONTRACT_ARTIFACT_KIND_MISMATCH'),
  'render contract rejects required artifact kind mismatch with preset',
);

const batchMismatchValidation = validateSmartCutRenderContract({
  renderContract: {
    ...teacherContract,
    batchOutput: true,
  },
});
assertRule(
  batchMismatchValidation.blockers.some((blocker) => blocker.code === 'RENDER_CONTRACT_BATCH_OUTPUT_MISMATCH'),
  'render contract rejects batch output mismatch with preset',
);

const interviewContract = createSmartCutRenderContract({
  presetId: 'interview-one-question-one-answer',
  planId: 'filtered-plan-interview',
  candidateIds: ['candidate-1', 'candidate-2'],
});

assertRule(interviewContract.batchOutput === true, 'interview render contract preserves batch output');
assertRule(interviewContract.rendererIds.join(',') === 'batch-short-video', 'interview contract uses batch short video renderer');
assertRule(interviewContract.visual.framing === 'speaker-focus', 'interview contract uses speaker-focus framing');

const emptyCandidateContract = createSmartCutRenderContract({
  presetId: 'teacher-talking-head-single',
  planId: 'filtered-plan-empty',
  candidateIds: [],
});
const emptyValidation = validateSmartCutRenderContract({
  renderContract: emptyCandidateContract,
});

assertRule(emptyValidation.ready === false, 'render contract without candidates fails');
assertRule(
  emptyValidation.blockers.some((blocker) => blocker.code === 'RENDER_CONTRACT_WITHOUT_CANDIDATES'),
  'render contract without candidates reports blocker',
);

if (failures.length > 0) {
  console.error(`blocked - smart cut render contract failures=${failures.length}`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`ok - smart cut render contract checks=${pass.length}`);
