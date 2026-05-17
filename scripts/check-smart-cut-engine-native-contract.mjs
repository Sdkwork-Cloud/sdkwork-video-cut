#!/usr/bin/env node

import process from 'node:process';

import {
  SMART_CUT_NATIVE_COMMAND_REGISTRY,
  createSmartCutNativeCommandRequest,
  validateSmartCutNativeCommandRequest,
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

const requiredNativeCommands = [
  'smart_cut_probe_media',
  'smart_cut_extract_audio_evidence',
  'smart_cut_extract_visual_evidence',
  'smart_cut_extract_music_evidence',
  'smart_cut_build_interval_index',
  'smart_cut_validate_candidates',
  'smart_cut_apply_filter_plan',
  'smart_cut_validate_filtered_plan',
  'smart_cut_render_plan',
  'smart_cut_probe_artifacts',
];

for (const commandId of requiredNativeCommands) {
  const definition = SMART_CUT_NATIVE_COMMAND_REGISTRY.find((command) => command.id === commandId);
  assertRule(definition !== undefined, `native registry includes ${commandId}`);
  assertRule(definition?.owner === 'rust-native', `${commandId} is owned by rust native`);
  assertRule(definition?.requestSchemaVersion === '2026-05-14.smart-cut-native-contract.v1', `${commandId} exposes native request schema version`);
  assertRule(definition?.responseSchemaVersion === '2026-05-14.smart-cut-native-contract.v1', `${commandId} exposes native response schema version`);
  assertRule(definition?.failClosed === true, `${commandId} is fail-closed`);
  assertRule(definition?.deterministic === true, `${commandId} is deterministic`);
}

const intervalRequiredCommandIds = [
  'smart_cut_validate_candidates',
  'smart_cut_apply_filter_plan',
  'smart_cut_validate_filtered_plan',
  'smart_cut_render_plan',
];
for (const commandId of intervalRequiredCommandIds) {
  const definition = SMART_CUT_NATIVE_COMMAND_REGISTRY.find((command) => command.id === commandId);
  assertRule(definition?.requiresIntervals === true, `${commandId} requires content-unit intervals`);
  assertRule(definition?.requiresContentUnitIds === true, `${commandId} requires content unit ids on intervals`);
}

for (const commandId of requiredNativeCommands.filter((commandId) => !intervalRequiredCommandIds.includes(commandId))) {
  const definition = SMART_CUT_NATIVE_COMMAND_REGISTRY.find((command) => command.id === commandId);
  assertRule(definition?.requiresIntervals === false, `${commandId} does not require content-unit intervals`);
}

const renderRequest = createSmartCutNativeCommandRequest({
  commandId: 'smart_cut_render_plan',
  runId: 'run-1',
  presetId: 'teacher-talking-head-single',
  sourceMediaId: 'media-1',
  sourceUri: 'file:///video.mp4',
  intervals: [
    {
      id: 'candidate-1',
      startMs: 1_000,
      endMs: 61_000,
      unitIds: ['unit-1', 'unit-2'],
    },
  ],
  payload: {
    renderContractId: 'render-contract-1',
  },
});

assertRule(renderRequest.schemaVersion === '2026-05-14.smart-cut-native-contract.v1', 'native request uses stable schema version');
assertRule(renderRequest.commandId === 'smart_cut_render_plan', 'native request records command id');
assertRule(renderRequest.runId === 'run-1', 'native request records run id');
assertRule(renderRequest.presetId === 'teacher-talking-head-single', 'native request records preset id');
assertRule(renderRequest.source.uri === 'file:///video.mp4', 'native request records source uri');
assertRule(renderRequest.intervals[0]?.unitIds.join(',') === 'unit-1,unit-2', 'native request intervals preserve content unit ids');
assertRule(renderRequest.failClosed === true, 'native request is fail-closed by default');

const validRequestReport = validateSmartCutNativeCommandRequest({
  request: renderRequest,
  sourceDurationMs: 120_000,
});

assertRule(validRequestReport.ready === true, 'valid native request passes validation');
assertRule(validRequestReport.blockers.length === 0, 'valid native request has no blockers');

const invalidSchemaReport = validateSmartCutNativeCommandRequest({
  request: {
    ...renderRequest,
    schemaVersion: 'old-native-schema',
  },
  sourceDurationMs: 120_000,
});
assertRule(
  invalidSchemaReport.blockers.some((blocker) => blocker.code === 'INVALID_NATIVE_REQUEST_SCHEMA_VERSION'),
  'native request rejects invalid native schema version',
);

const invalidStandardVersionReport = validateSmartCutNativeCommandRequest({
  request: {
    ...renderRequest,
    smartCutStandardVersion: 'old-smart-cut-standard',
  },
  sourceDurationMs: 120_000,
});
assertRule(
  invalidStandardVersionReport.blockers.some((blocker) => blocker.code === 'INVALID_SMART_CUT_STANDARD_VERSION'),
  'native request rejects invalid smart cut standard version',
);

const notFailClosedReport = validateSmartCutNativeCommandRequest({
  request: {
    ...renderRequest,
    failClosed: false,
  },
  sourceDurationMs: 120_000,
});
assertRule(
  notFailClosedReport.blockers.some((blocker) => blocker.code === 'NATIVE_REQUEST_NOT_FAIL_CLOSED'),
  'native request rejects fail-open requests',
);

const missingIdentityReport = validateSmartCutNativeCommandRequest({
  request: {
    ...renderRequest,
    runId: ' ',
    source: {
      mediaId: '',
      uri: ' ',
    },
  },
  sourceDurationMs: 120_000,
});
assertRule(
  missingIdentityReport.blockers.some((blocker) => blocker.code === 'NATIVE_REQUEST_RUN_ID_MISSING'),
  'native request rejects missing run id',
);
assertRule(
  missingIdentityReport.blockers.some((blocker) => blocker.code === 'NATIVE_SOURCE_MISSING'),
  'native request rejects missing source identity',
);

const unknownPresetReport = validateSmartCutNativeCommandRequest({
  request: {
    ...renderRequest,
    presetId: 'missing-preset',
  },
  sourceDurationMs: 120_000,
});
assertRule(
  unknownPresetReport.blockers.some((blocker) => blocker.code === 'UNKNOWN_NATIVE_PRESET'),
  'native request rejects unknown product preset',
);

const intervalRequiredReport = validateSmartCutNativeCommandRequest({
  request: {
    ...renderRequest,
    commandId: 'smart_cut_render_plan',
    intervals: [],
  },
  sourceDurationMs: 120_000,
});
assertRule(
  intervalRequiredReport.blockers.some((blocker) => blocker.code === 'NATIVE_COMMAND_REQUIRES_INTERVALS'),
  'native request rejects missing intervals for interval-bound commands',
);

const duplicateIntervalReport = validateSmartCutNativeCommandRequest({
  request: {
    ...renderRequest,
    intervals: [
      renderRequest.intervals[0],
      {
        ...renderRequest.intervals[0],
        startMs: 62_000,
        endMs: 80_000,
      },
    ],
  },
  sourceDurationMs: 120_000,
});
assertRule(
  duplicateIntervalReport.blockers.some((blocker) => blocker.code === 'DUPLICATE_NATIVE_INTERVAL_ID'),
  'native request rejects duplicate interval ids',
);

const blankUnitIdReport = validateSmartCutNativeCommandRequest({
  request: {
    ...renderRequest,
    intervals: [
      {
        ...renderRequest.intervals[0],
        unitIds: ['unit-1', ' '],
      },
    ],
  },
  sourceDurationMs: 120_000,
});
assertRule(
  blankUnitIdReport.blockers.some((blocker) => blocker.code === 'NATIVE_INTERVAL_WITH_BLANK_UNIT_ID'),
  'native request rejects blank content unit ids',
);

const rawTimeRequest = createSmartCutNativeCommandRequest({
  commandId: 'smart_cut_apply_filter_plan',
  runId: 'run-2',
  presetId: 'teacher-talking-head-single',
  sourceMediaId: 'media-2',
  sourceUri: 'file:///video.mp4',
  intervals: [
    {
      id: 'candidate-raw',
      startMs: 1_000,
      endMs: 10_000,
      unitIds: [],
    },
  ],
  payload: {},
});
const rawTimeReport = validateSmartCutNativeCommandRequest({
  request: rawTimeRequest,
  sourceDurationMs: 120_000,
});

assertRule(rawTimeReport.ready === false, 'native request rejects raw time-only intervals');
assertRule(
  rawTimeReport.blockers.some((blocker) => blocker.code === 'NATIVE_INTERVAL_WITHOUT_UNITS'),
  'native request reports missing content unit ids',
);

const missingFilterPlanPayloadReport = validateSmartCutNativeCommandRequest({
  request: {
    ...rawTimeRequest,
    intervals: [
      {
        id: 'candidate-1',
        startMs: 1_000,
        endMs: 10_000,
        unitIds: ['unit-1'],
      },
    ],
    payload: {},
  },
  sourceDurationMs: 120_000,
});
assertRule(
  missingFilterPlanPayloadReport.blockers.some((blocker) => blocker.code === 'NATIVE_FILTER_PLAN_ID_MISSING'),
  'native filter commands reject missing filter plan id payload',
);

const missingRenderContractPayloadReport = validateSmartCutNativeCommandRequest({
  request: {
    ...renderRequest,
    payload: {},
  },
  sourceDurationMs: 120_000,
});
assertRule(
  missingRenderContractPayloadReport.blockers.some((blocker) => blocker.code === 'NATIVE_RENDER_CONTRACT_ID_MISSING'),
  'native render commands reject missing render contract id payload',
);

const validVisualEvidenceRequest = createSmartCutNativeCommandRequest({
  commandId: 'smart_cut_extract_visual_evidence',
  runId: 'run-visual',
  presetId: 'film-scene-index',
  sourceMediaId: 'media-film',
  sourceUri: 'file:///film.mp4',
  intervals: [],
  payload: {
    visualEvidenceProfile: 'shot-boundary-v1',
    sceneChangeThreshold: 0.35,
    minShotDurationMs: 500,
    includeFrameQuality: true,
  },
});
const validVisualEvidenceReport = validateSmartCutNativeCommandRequest({
  request: validVisualEvidenceRequest,
  sourceDurationMs: 120_000,
});

assertRule(validVisualEvidenceReport.ready === true, 'native visual evidence extraction request passes validation with explicit profile');
assertRule(validVisualEvidenceReport.blockers.length === 0, 'native visual evidence extraction request has no blockers');

const missingVisualEvidenceProfileReport = validateSmartCutNativeCommandRequest({
  request: {
    ...validVisualEvidenceRequest,
    payload: {
      sceneChangeThreshold: 0.35,
      minShotDurationMs: 500,
      includeFrameQuality: true,
    },
  },
  sourceDurationMs: 120_000,
});
assertRule(
  missingVisualEvidenceProfileReport.blockers.some((blocker) => blocker.code === 'NATIVE_VISUAL_EVIDENCE_PROFILE_MISSING'),
  'native visual evidence extraction rejects missing visual evidence profile',
);

const invalidVisualEvidenceProfileReport = validateSmartCutNativeCommandRequest({
  request: {
    ...validVisualEvidenceRequest,
    payload: {
      ...validVisualEvidenceRequest.payload,
      visualEvidenceProfile: 'experimental-profile',
    },
  },
  sourceDurationMs: 120_000,
});
assertRule(
  invalidVisualEvidenceProfileReport.blockers.some((blocker) => blocker.code === 'NATIVE_VISUAL_EVIDENCE_PROFILE_INVALID'),
  'native visual evidence extraction rejects unsupported visual evidence profile',
);

const invalidVisualEvidenceThresholdReport = validateSmartCutNativeCommandRequest({
  request: {
    ...validVisualEvidenceRequest,
    payload: {
      ...validVisualEvidenceRequest.payload,
      sceneChangeThreshold: 1.2,
    },
  },
  sourceDurationMs: 120_000,
});
assertRule(
  invalidVisualEvidenceThresholdReport.blockers.some((blocker) => blocker.code === 'NATIVE_VISUAL_SCENE_THRESHOLD_INVALID'),
  'native visual evidence extraction rejects invalid scene threshold',
);

const invalidVisualMinShotDurationReport = validateSmartCutNativeCommandRequest({
  request: {
    ...validVisualEvidenceRequest,
    payload: {
      ...validVisualEvidenceRequest.payload,
      minShotDurationMs: 0,
    },
  },
  sourceDurationMs: 120_000,
});
assertRule(
  invalidVisualMinShotDurationReport.blockers.some((blocker) => blocker.code === 'NATIVE_VISUAL_MIN_SHOT_DURATION_INVALID'),
  'native visual evidence extraction rejects invalid minimum shot duration',
);

const outOfSourceRequest = createSmartCutNativeCommandRequest({
  commandId: 'smart_cut_validate_candidates',
  runId: 'run-3',
  presetId: 'teacher-talking-head-single',
  sourceMediaId: 'media-3',
  sourceUri: 'file:///video.mp4',
  intervals: [
    {
      id: 'candidate-out',
      startMs: 20_000,
      endMs: 130_000,
      unitIds: ['unit-1'],
    },
  ],
  payload: {},
});
const outOfSourceReport = validateSmartCutNativeCommandRequest({
  request: outOfSourceRequest,
  sourceDurationMs: 120_000,
});

assertRule(outOfSourceReport.ready === false, 'native request rejects out-of-source intervals');
assertRule(
  outOfSourceReport.blockers.some((blocker) => blocker.code === 'NATIVE_INTERVAL_OUT_OF_SOURCE'),
  'native request reports out-of-source interval blocker',
);

if (failures.length > 0) {
  console.error(`blocked - smart cut native contract failures=${failures.length}`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`ok - smart cut native contract checks=${pass.length}`);
