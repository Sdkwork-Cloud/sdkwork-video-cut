#!/usr/bin/env node

import process from 'node:process';

import {
  SMART_CUT_STRATEGY_CONTRACT_VERSION,
  typeSmartCutStrategyContractNames,
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
    values.includes(expectedValue),
    `${message} (expected ${JSON.stringify(expectedValue)})`,
  );
}

assertRule(
  SMART_CUT_STRATEGY_CONTRACT_VERSION === '2026-05-14.smart-cut-strategy-contract.v1',
  'strategy contract exposes current version',
);

const requiredContracts = [
  'SmartCutSlicerStrategy',
  'SmartCutFilterStrategy',
  'SmartCutValidatorStrategy',
  'SmartCutRendererStrategy',
  'SmartCutSpeechToTextProvider',
  'SmartCutSpeakerDiarizationProvider',
  'SmartCutLlmCandidateReviewer',
  'SmartCutNativeEngineAdapter',
  'SmartCutStrategyRuntimeContext',
  'SmartCutManualCorrectionStore',
  'SmartCutPostSliceFilterPlan',
  'SmartCutRenderContract',
  'SmartCutNativeCommandRequest',
  'SmartCutExecutionPackage',
  'SmartCutEvidenceQualityValidationReport',
  'SmartCutSemanticBoundaryProofReport',
  'SmartCutCandidateSelectionReport',
  'SmartCutLlmCandidateReviewReport',
  'SmartCutLlmCandidateReviewValidationReport',
  'SmartCutFilterEffectValidationReport',
  'SmartCutExecutionAuditTrace',
  'SmartCutProviderExecutionAuditTrace',
  'SmartCutRenderArtifactValidationReport',
  'SmartCutContentUnitBuildReport',
  'SmartCutSpeechSemanticPlan',
  'SmartCutSpeechFirstExecutionPackageResult',
  'SmartCutSpeechFirstProviderExecutionPackageResult',
  'SmartCutSpeechFirstProviderExecutionStageStatuses',
  'SmartCutSpeechFirstProviderIds',
  'SmartCutRegistryValidationReport',
  'SmartCutRegistryValidationBlocker',
  'SmartCutProductPresetRegistrySummary',
  'SmartCutRegistryValidationMetrics',
];

for (const contractName of requiredContracts) {
  assertIncludes(typeSmartCutStrategyContractNames, contractName, `strategy contract list includes ${contractName}`);
}

if (failures.length > 0) {
  console.error(`blocked - smart cut engine interface failures=${failures.length}`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`ok - smart cut engine interface checks=${pass.length}`);
