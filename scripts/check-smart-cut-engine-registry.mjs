#!/usr/bin/env node

import process from 'node:process';

import {
  SMART_CUT_FILTER_REGISTRY,
  SMART_CUT_PRODUCT_PRESET_REGISTRY,
  SMART_CUT_SLICER_REGISTRY,
  SMART_CUT_VALIDATOR_REGISTRY,
  validateSmartCutStrategyRegistry,
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

assertRule(
  typeof validateSmartCutStrategyRegistry === 'function',
  'standard exposes strategy registry validation gate',
);

if (typeof validateSmartCutStrategyRegistry === 'function') {
  const report = validateSmartCutStrategyRegistry();

  assertRule(report.ready === true, 'default strategy registry validates as ready');
  assertRule(report.blockers.length === 0, 'default strategy registry has no blockers');
  assertRule(report.metrics.slicerCount === SMART_CUT_SLICER_REGISTRY.length, 'registry report counts all slicers');
  assertRule(report.metrics.productPresetCount === SMART_CUT_PRODUCT_PRESET_REGISTRY.length, 'registry report counts all product presets');
  assertRule(report.metrics.speechFirstPresetCount >= 6, 'registry report counts speech-first presets');
  assertRule(report.metrics.multimodalPresetCount >= 4, 'registry report counts multimodal presets');
  assertRule(report.metrics.destructiveFilterCount >= 7, 'registry report counts destructive filters');
  assertRule(report.metrics.failClosedValidatorCount >= 6, 'registry reports at least 6 fail-closed validators (core structural validators are blocking)');

  const speechPresetIds = ['teacher-talking-head-single', 'interview-one-question-one-answer', 'long-interview-matrix'];
  for (const presetId of speechPresetIds) {
    const summary = report.productPresetSummaries.find((entry) => entry.id === presetId);
    assertRule(summary?.requiresTranscript === true, `registry marks ${presetId} as requiring transcript`);
    assertRule(summary?.requiresSpeaker === true, `registry marks ${presetId} as requiring speaker evidence`);
    assertRule(summary?.requiresSpeakerDiarization === true, `registry marks ${presetId} as requiring speaker diarization`);
    assertRule(summary?.hasSpeakerContinuityValidator === true, `registry marks ${presetId} as having speaker continuity validator`);
  }

  const musicSummary = report.productPresetSummaries.find((entry) => entry.id === 'music-beat-clips');
  assertRule(musicSummary?.requiresTranscript === false, 'music beat preset is not classified as speech-first');
  assertRule(musicSummary?.requiresSpeaker === false, 'music beat preset does not require speaker evidence');
  assertRule(musicSummary?.requiresAudio === true, 'music beat preset requires audio evidence');
  assertRule(musicSummary?.requiresVisual === true, 'music beat preset requires visual evidence');

  const filmSummary = report.productPresetSummaries.find((entry) => entry.id === 'film-scene-index');
  assertRule(filmSummary?.requiresVisual === true, 'film scene preset requires visual evidence');
  assertRule(filmSummary?.requiresSpeakerDiarization === false, 'film scene preset does not force speaker diarization');

  const brokenUnknownSlicerReport = validateSmartCutStrategyRegistry({
    productPresets: [
      {
        ...SMART_CUT_PRODUCT_PRESET_REGISTRY[0],
        slicerChain: ['missing-slicer'],
      },
    ],
  });
  assertRule(brokenUnknownSlicerReport.ready === false, 'registry validation blocks unknown preset slicer references');
  assertRule(
    brokenUnknownSlicerReport.blockers.some((blocker) => blocker.code === 'PRESET_REFERENCES_UNKNOWN_SLICER'),
    'registry validation reports unknown slicer blocker',
  );

  const duplicateSlicerReport = validateSmartCutStrategyRegistry({
    slicers: [SMART_CUT_SLICER_REGISTRY[0], SMART_CUT_SLICER_REGISTRY[0]],
  });
  assertRule(
    duplicateSlicerReport.blockers.some((blocker) => blocker.code === 'DUPLICATE_SLICER_ID'),
    'registry validation reports duplicate slicer id blocker',
  );

  const duplicateFilterReport = validateSmartCutStrategyRegistry({
    filters: [SMART_CUT_FILTER_REGISTRY[0], SMART_CUT_FILTER_REGISTRY[0]],
  });
  assertRule(
    duplicateFilterReport.blockers.some((blocker) => blocker.code === 'DUPLICATE_FILTER_ID'),
    'registry validation reports duplicate filter id blocker',
  );

  const duplicateValidatorReport = validateSmartCutStrategyRegistry({
    validators: [SMART_CUT_VALIDATOR_REGISTRY[0], SMART_CUT_VALIDATOR_REGISTRY[0]],
  });
  assertRule(
    duplicateValidatorReport.blockers.some((blocker) => blocker.code === 'DUPLICATE_VALIDATOR_ID'),
    'registry validation reports duplicate validator id blocker',
  );

  const brokenUnknownFilterReport = validateSmartCutStrategyRegistry({
    productPresets: [
      {
        ...SMART_CUT_PRODUCT_PRESET_REGISTRY[0],
        filters: ['missing-filter'],
      },
    ],
  });
  assertRule(
    brokenUnknownFilterReport.blockers.some((blocker) => blocker.code === 'PRESET_REFERENCES_UNKNOWN_FILTER'),
    'registry validation reports unknown filter blocker',
  );

  const brokenUnknownValidatorReport = validateSmartCutStrategyRegistry({
    productPresets: [
      {
        ...SMART_CUT_PRODUCT_PRESET_REGISTRY[0],
        validators: ['missing-validator'],
      },
    ],
  });
  assertRule(
    brokenUnknownValidatorReport.blockers.some((blocker) => blocker.code === 'PRESET_REFERENCES_UNKNOWN_VALIDATOR'),
    'registry validation reports unknown validator blocker',
  );

  const brokenUnknownRendererReport = validateSmartCutStrategyRegistry({
    productPresets: [
      {
        ...SMART_CUT_PRODUCT_PRESET_REGISTRY[0],
        renderers: ['missing-renderer'],
      },
    ],
  });
  assertRule(
    brokenUnknownRendererReport.blockers.some((blocker) => blocker.code === 'PRESET_REFERENCES_UNKNOWN_RENDERER'),
    'registry validation reports unknown renderer blocker',
  );

  const brokenSpeechSlicerReport = validateSmartCutStrategyRegistry({
    slicers: [
      {
        ...SMART_CUT_SLICER_REGISTRY.find((slicer) => slicer.id === 'speech-semantic'),
        requiredEvidence: ['transcript'],
      },
    ],
  });
  assertRule(
    brokenSpeechSlicerReport.blockers.some((blocker) => blocker.code === 'SPEECH_SLICER_MISSING_SPEAKER_EVIDENCE'),
    'registry validation reports speech slicer missing speaker evidence blocker',
  );

  const brokenDialogueSlicerReport = validateSmartCutStrategyRegistry({
    slicers: [
      {
        ...SMART_CUT_SLICER_REGISTRY.find((slicer) => slicer.id === 'dialogue-qa'),
        speakerPolicy: {
          requiresDiarization: true,
          requiresRoleAssignment: false,
          allowsUnknownSpeaker: false,
          handlesOverlappingSpeech: true,
        },
      },
    ],
  });
  assertRule(
    brokenDialogueSlicerReport.blockers.some((blocker) => blocker.code === 'DIALOGUE_SLICER_MISSING_ROLE_ASSIGNMENT'),
    'registry validation reports dialogue slicer missing role assignment blocker',
  );

  const brokenSpeechPresetReport = validateSmartCutStrategyRegistry({
    productPresets: [
      {
        ...SMART_CUT_PRODUCT_PRESET_REGISTRY[0],
        requiresSpeakerDiarization: false,
      },
    ],
  });
  assertRule(
    brokenSpeechPresetReport.blockers.some((blocker) => blocker.code === 'SPEECH_PRESET_MISSING_SPEAKER_DIARIZATION'),
    'registry validation reports speech preset missing speaker diarization blocker',
  );

  const brokenVisualPresetReport = validateSmartCutStrategyRegistry({
    productPresets: [
      {
        ...SMART_CUT_PRODUCT_PRESET_REGISTRY.find((preset) => preset.id === 'film-scene-index'),
        slicerChain: ['film-scene'],
        validators: ['boundary-integrity'],
      },
    ],
  });
  assertRule(
    brokenVisualPresetReport.blockers.some((blocker) => blocker.code === 'VISUAL_PRESET_MISSING_EVIDENCE_COVERAGE_VALIDATOR'),
    'registry validation reports visual preset missing evidence coverage validator blocker',
  );

  const duplicatePresetReport = validateSmartCutStrategyRegistry({
    productPresets: [SMART_CUT_PRODUCT_PRESET_REGISTRY[0], SMART_CUT_PRODUCT_PRESET_REGISTRY[0]],
  });
  assertRule(
    duplicatePresetReport.blockers.some((blocker) => blocker.code === 'DUPLICATE_PRODUCT_PRESET_ID'),
    'registry validation reports duplicate product preset id blocker',
  );

  const missingDefaultSlicerReport = validateSmartCutStrategyRegistry({
    slicers: SMART_CUT_SLICER_REGISTRY.filter((slicer) => slicer.id !== 'speech-semantic'),
  });
  assertRule(
    missingDefaultSlicerReport.blockers.some((blocker) => blocker.code === 'DEFAULT_SLICER_NOT_REGISTERED'),
    'registry validation reports missing default slicer blocker',
  );

  const missingDefaultPresetReport = validateSmartCutStrategyRegistry({
    productPresets: SMART_CUT_PRODUCT_PRESET_REGISTRY.filter((preset) => preset.id !== 'teacher-talking-head-single'),
  });
  assertRule(
    missingDefaultPresetReport.blockers.some((blocker) => blocker.code === 'DEFAULT_PRODUCT_PRESET_NOT_REGISTERED'),
    'registry validation reports missing default product preset blocker',
  );
}

if (failures.length > 0) {
  console.error(`blocked - smart cut registry failures=${failures.length}`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`ok - smart cut registry checks=${pass.length}`);
