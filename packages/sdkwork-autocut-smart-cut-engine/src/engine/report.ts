import { SMART_CUT_DEFAULT_PRODUCT_PRESET_ID, SMART_CUT_DEFAULT_SLICER_ID, SMART_CUT_EVIDENCE_KINDS, SMART_CUT_STANDARD_VERSION } from './domain.ts';
import { SMART_CUT_FILTER_REGISTRY } from './filters.ts';
import { SMART_CUT_NATIVE_COMMAND_REGISTRY } from './native-contract.ts';
import { SMART_CUT_PRODUCT_PRESET_REGISTRY } from './presets.ts';
import { validateSmartCutStrategyRegistry } from './registry-validation.ts';
import { SMART_CUT_SLICER_REGISTRY } from './slicers.ts';
import { SMART_CUT_VALIDATOR_REGISTRY } from './validators.ts';

export interface SmartCutEngineStandardReport {
  ready: boolean;
  standardVersion: typeof SMART_CUT_STANDARD_VERSION;
  defaultSlicerId: typeof SMART_CUT_DEFAULT_SLICER_ID;
  defaultProductPresetId: typeof SMART_CUT_DEFAULT_PRODUCT_PRESET_ID;
  evidenceKinds: readonly string[];
  slicerCount: number;
  filterCount: number;
  validatorCount: number;
  productPresetCount: number;
  nativeCommandCount: number;
  multiSpeakerPresets: readonly string[];
  destructiveFilterIds: readonly string[];
  failClosedValidatorIds: readonly string[];
  requiredNativeCommandIds: readonly string[];
}

export function createSmartCutEngineStandardReport(): SmartCutEngineStandardReport {
  const destructiveFilterIds = SMART_CUT_FILTER_REGISTRY
    .filter((filter) => filter.destructive)
    .map((filter) => filter.id);
  const failClosedValidatorIds = SMART_CUT_VALIDATOR_REGISTRY
    .filter((validator) => validator.failClosed)
    .map((validator) => validator.id);
  const multiSpeakerPresets = SMART_CUT_PRODUCT_PRESET_REGISTRY
    .filter((preset) => preset.requiresSpeakerDiarization)
    .map((preset) => preset.id);

  return {
    ready: validateSmartCutEngineStandard(),
    standardVersion: SMART_CUT_STANDARD_VERSION,
    defaultSlicerId: SMART_CUT_DEFAULT_SLICER_ID,
    defaultProductPresetId: SMART_CUT_DEFAULT_PRODUCT_PRESET_ID,
    evidenceKinds: SMART_CUT_EVIDENCE_KINDS,
    slicerCount: SMART_CUT_SLICER_REGISTRY.length,
    filterCount: SMART_CUT_FILTER_REGISTRY.length,
    validatorCount: SMART_CUT_VALIDATOR_REGISTRY.length,
    productPresetCount: SMART_CUT_PRODUCT_PRESET_REGISTRY.length,
    nativeCommandCount: SMART_CUT_NATIVE_COMMAND_REGISTRY.length,
    multiSpeakerPresets,
    destructiveFilterIds,
    failClosedValidatorIds,
    requiredNativeCommandIds: SMART_CUT_NATIVE_COMMAND_REGISTRY.map((command) => command.id),
  };
}

function validateSmartCutEngineStandard(): boolean {
  const defaultSlicerExists = SMART_CUT_SLICER_REGISTRY.some((slicer) => slicer.id === SMART_CUT_DEFAULT_SLICER_ID);
  const defaultPresetExists = SMART_CUT_PRODUCT_PRESET_REGISTRY.some((preset) => preset.id === SMART_CUT_DEFAULT_PRODUCT_PRESET_ID);
  const nativeCommandsAreRustOwned = SMART_CUT_NATIVE_COMMAND_REGISTRY.every((command) =>
    command.owner === 'rust-native' &&
      command.failClosed === true &&
      command.requestSchemaVersion === command.responseSchemaVersion
  );
  const registryValidation = validateSmartCutStrategyRegistry();

  return defaultSlicerExists &&
    defaultPresetExists &&
    registryValidation.ready &&
    nativeCommandsAreRustOwned;
}
