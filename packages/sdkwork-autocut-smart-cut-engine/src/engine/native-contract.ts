import {
  SMART_CUT_STANDARD_VERSION,
  SMART_CUT_VISUAL_EVIDENCE_PROFILES,
  type SmartCutTimeRange,
} from './domain.ts';
import type { SmartCutNativeCommandId } from './pipeline.ts';
import { SMART_CUT_PRODUCT_PRESET_REGISTRY } from './presets.ts';
import type { SmartCutProductPresetId } from './presets.ts';

export const SMART_CUT_NATIVE_CONTRACT_VERSION = '2026-05-14.smart-cut-native-contract.v1' as const;

export interface SmartCutNativeCommandDefinition {
  id: SmartCutNativeCommandId;
  owner: 'rust-native';
  displayName: string;
  requestSchemaVersion: typeof SMART_CUT_NATIVE_CONTRACT_VERSION;
  responseSchemaVersion: typeof SMART_CUT_NATIVE_CONTRACT_VERSION;
  failClosed: boolean;
  deterministic: boolean;
  requiresIntervals: boolean;
  requiresContentUnitIds: boolean;
}

export const SMART_CUT_NATIVE_COMMAND_REGISTRY = [
  {
    id: 'smart_cut_probe_media',
    owner: 'rust-native',
    displayName: 'Probe Media',
    requestSchemaVersion: SMART_CUT_NATIVE_CONTRACT_VERSION,
    responseSchemaVersion: SMART_CUT_NATIVE_CONTRACT_VERSION,
    failClosed: true,
    deterministic: true,
    requiresIntervals: false,
    requiresContentUnitIds: false,
  },
  {
    id: 'smart_cut_extract_audio_evidence',
    owner: 'rust-native',
    displayName: 'Extract Audio Evidence',
    requestSchemaVersion: SMART_CUT_NATIVE_CONTRACT_VERSION,
    responseSchemaVersion: SMART_CUT_NATIVE_CONTRACT_VERSION,
    failClosed: true,
    deterministic: true,
    requiresIntervals: false,
    requiresContentUnitIds: false,
  },
  {
    id: 'smart_cut_extract_visual_evidence',
    owner: 'rust-native',
    displayName: 'Extract Visual Evidence',
    requestSchemaVersion: SMART_CUT_NATIVE_CONTRACT_VERSION,
    responseSchemaVersion: SMART_CUT_NATIVE_CONTRACT_VERSION,
    failClosed: true,
    deterministic: true,
    requiresIntervals: false,
    requiresContentUnitIds: false,
  },
  {
    id: 'smart_cut_extract_music_evidence',
    owner: 'rust-native',
    displayName: 'Extract Music Evidence',
    requestSchemaVersion: SMART_CUT_NATIVE_CONTRACT_VERSION,
    responseSchemaVersion: SMART_CUT_NATIVE_CONTRACT_VERSION,
    failClosed: true,
    deterministic: true,
    requiresIntervals: false,
    requiresContentUnitIds: false,
  },
  {
    id: 'smart_cut_build_interval_index',
    owner: 'rust-native',
    displayName: 'Build Interval Index',
    requestSchemaVersion: SMART_CUT_NATIVE_CONTRACT_VERSION,
    responseSchemaVersion: SMART_CUT_NATIVE_CONTRACT_VERSION,
    failClosed: true,
    deterministic: true,
    requiresIntervals: false,
    requiresContentUnitIds: false,
  },
  {
    id: 'smart_cut_validate_candidates',
    owner: 'rust-native',
    displayName: 'Validate Candidates',
    requestSchemaVersion: SMART_CUT_NATIVE_CONTRACT_VERSION,
    responseSchemaVersion: SMART_CUT_NATIVE_CONTRACT_VERSION,
    failClosed: true,
    deterministic: true,
    requiresIntervals: true,
    requiresContentUnitIds: true,
  },
  {
    id: 'smart_cut_apply_filter_plan',
    owner: 'rust-native',
    displayName: 'Apply Filter Plan',
    requestSchemaVersion: SMART_CUT_NATIVE_CONTRACT_VERSION,
    responseSchemaVersion: SMART_CUT_NATIVE_CONTRACT_VERSION,
    failClosed: true,
    deterministic: true,
    requiresIntervals: true,
    requiresContentUnitIds: true,
  },
  {
    id: 'smart_cut_validate_filtered_plan',
    owner: 'rust-native',
    displayName: 'Validate Filtered Plan',
    requestSchemaVersion: SMART_CUT_NATIVE_CONTRACT_VERSION,
    responseSchemaVersion: SMART_CUT_NATIVE_CONTRACT_VERSION,
    failClosed: true,
    deterministic: true,
    requiresIntervals: true,
    requiresContentUnitIds: true,
  },
  {
    id: 'smart_cut_render_plan',
    owner: 'rust-native',
    displayName: 'Render Plan',
    requestSchemaVersion: SMART_CUT_NATIVE_CONTRACT_VERSION,
    responseSchemaVersion: SMART_CUT_NATIVE_CONTRACT_VERSION,
    failClosed: true,
    deterministic: true,
    requiresIntervals: true,
    requiresContentUnitIds: true,
  },
  {
    id: 'smart_cut_probe_artifacts',
    owner: 'rust-native',
    displayName: 'Probe Artifacts',
    requestSchemaVersion: SMART_CUT_NATIVE_CONTRACT_VERSION,
    responseSchemaVersion: SMART_CUT_NATIVE_CONTRACT_VERSION,
    failClosed: true,
    deterministic: true,
    requiresIntervals: false,
    requiresContentUnitIds: false,
  },
] as const satisfies readonly SmartCutNativeCommandDefinition[];

export interface SmartCutNativeInterval extends SmartCutTimeRange {
  id: string;
  unitIds: readonly string[];
}

export interface SmartCutNativeCommandRequestInput {
  commandId: SmartCutNativeCommandId;
  runId: string;
  presetId: SmartCutProductPresetId;
  sourceMediaId: string;
  sourceUri: string;
  intervals: readonly SmartCutNativeInterval[];
  payload: Record<string, unknown>;
}

export interface SmartCutNativeCommandRequest {
  schemaVersion: typeof SMART_CUT_NATIVE_CONTRACT_VERSION;
  smartCutStandardVersion: typeof SMART_CUT_STANDARD_VERSION;
  commandId: SmartCutNativeCommandId;
  runId: string;
  presetId: SmartCutProductPresetId;
  source: {
    mediaId: string;
    uri: string;
  };
  intervals: readonly SmartCutNativeInterval[];
  payload: Record<string, unknown>;
  failClosed: boolean;
}

export interface SmartCutNativeCommandRequestValidationInput {
  request: SmartCutNativeCommandRequest;
  sourceDurationMs: number;
}

export type SmartCutNativeCommandRequestBlockerCode =
  | 'INVALID_NATIVE_REQUEST_SCHEMA_VERSION'
  | 'INVALID_SMART_CUT_STANDARD_VERSION'
  | 'NATIVE_REQUEST_NOT_FAIL_CLOSED'
  | 'NATIVE_REQUEST_RUN_ID_MISSING'
  | 'UNKNOWN_NATIVE_PRESET'
  | 'NATIVE_SOURCE_MISSING'
  | 'UNKNOWN_NATIVE_COMMAND'
  | 'NATIVE_FILTER_PLAN_ID_MISSING'
  | 'NATIVE_RENDER_CONTRACT_ID_MISSING'
  | 'NATIVE_VISUAL_EVIDENCE_PROFILE_MISSING'
  | 'NATIVE_VISUAL_EVIDENCE_PROFILE_INVALID'
  | 'NATIVE_VISUAL_SCENE_THRESHOLD_INVALID'
  | 'NATIVE_VISUAL_MIN_SHOT_DURATION_INVALID'
  | 'NATIVE_COMMAND_REQUIRES_INTERVALS'
  | 'INVALID_NATIVE_SOURCE_DURATION'
  | 'DUPLICATE_NATIVE_INTERVAL_ID'
  | 'INVALID_NATIVE_INTERVAL'
  | 'NATIVE_INTERVAL_OUT_OF_SOURCE'
  | 'NATIVE_INTERVAL_WITHOUT_UNITS'
  | 'NATIVE_INTERVAL_WITH_BLANK_UNIT_ID';

export interface SmartCutNativeCommandRequestBlocker {
  code: SmartCutNativeCommandRequestBlockerCode;
  message: string;
  intervalId?: string;
  remediation: string;
}

export interface SmartCutNativeCommandRequestValidationReport {
  ready: boolean;
  blockers: readonly SmartCutNativeCommandRequestBlocker[];
  intervalCount: number;
}

export function createSmartCutNativeCommandRequest(
  input: SmartCutNativeCommandRequestInput,
): SmartCutNativeCommandRequest {
  return {
    schemaVersion: SMART_CUT_NATIVE_CONTRACT_VERSION,
    smartCutStandardVersion: SMART_CUT_STANDARD_VERSION,
    commandId: input.commandId,
    runId: input.runId,
    presetId: input.presetId,
    source: {
      mediaId: input.sourceMediaId,
      uri: input.sourceUri,
    },
    intervals: input.intervals.map((interval) => ({
      id: interval.id,
      startMs: interval.startMs,
      endMs: interval.endMs,
      unitIds: [...interval.unitIds],
    })),
    payload: { ...input.payload },
    failClosed: true,
  };
}

export function validateSmartCutNativeCommandRequest(
  input: SmartCutNativeCommandRequestValidationInput,
): SmartCutNativeCommandRequestValidationReport {
  const blockers: SmartCutNativeCommandRequestBlocker[] = [];
  const command = SMART_CUT_NATIVE_COMMAND_REGISTRY.find((entry) => entry.id === input.request.commandId);

  if (input.request.schemaVersion !== SMART_CUT_NATIVE_CONTRACT_VERSION) {
    blockers.push({
      code: 'INVALID_NATIVE_REQUEST_SCHEMA_VERSION',
      message: `Native request schema version ${input.request.schemaVersion} does not match ${SMART_CUT_NATIVE_CONTRACT_VERSION}.`,
      remediation: 'Regenerate native requests with the current native contract version.',
    });
  }

  if (input.request.smartCutStandardVersion !== SMART_CUT_STANDARD_VERSION) {
    blockers.push({
      code: 'INVALID_SMART_CUT_STANDARD_VERSION',
      message: `Native request smart cut standard version ${input.request.smartCutStandardVersion} does not match ${SMART_CUT_STANDARD_VERSION}.`,
      remediation: 'Regenerate native requests with the current smart cut engine standard version.',
    });
  }

  if (input.request.failClosed !== true) {
    blockers.push({
      code: 'NATIVE_REQUEST_NOT_FAIL_CLOSED',
      message: 'Native request is not marked fail-closed.',
      remediation: 'Every native command request must be fail-closed before crossing the Rust boundary.',
    });
  }

  if (input.request.runId.trim().length === 0) {
    blockers.push({
      code: 'NATIVE_REQUEST_RUN_ID_MISSING',
      message: 'Native request has no run id.',
      remediation: 'Attach the smart cut run id so native artifacts and blockers remain auditable.',
    });
  }

  if (!SMART_CUT_PRODUCT_PRESET_REGISTRY.some((preset) => preset.id === input.request.presetId)) {
    blockers.push({
      code: 'UNKNOWN_NATIVE_PRESET',
      message: `Native request references unknown product preset ${input.request.presetId}.`,
      remediation: 'Create native requests from registered smart cut product presets.',
    });
  }

  if (input.request.source.mediaId.trim().length === 0 || input.request.source.uri.trim().length === 0) {
    blockers.push({
      code: 'NATIVE_SOURCE_MISSING',
      message: 'Native request source media id or uri is missing.',
      remediation: 'Probe and attach trusted source media identity before native execution.',
    });
  }

  if (command === undefined) {
    blockers.push({
      code: 'UNKNOWN_NATIVE_COMMAND',
      message: `Unknown native command ${input.request.commandId}.`,
      remediation: 'Use command ids from SMART_CUT_NATIVE_COMMAND_REGISTRY.',
    });
  } else if (command.requiresIntervals && input.request.intervals.length === 0) {
    blockers.push({
      code: 'NATIVE_COMMAND_REQUIRES_INTERVALS',
      message: `Native command ${input.request.commandId} requires content-unit-backed intervals.`,
      remediation: 'Provide validated candidate/content-unit intervals for interval-bound native commands.',
    });
  }

  validateNativeCommandPayload(input.request, blockers);

  if (!Number.isFinite(input.sourceDurationMs) || input.sourceDurationMs <= 0) {
    blockers.push({
      code: 'INVALID_NATIVE_SOURCE_DURATION',
      message: `Source duration must be positive milliseconds, got ${input.sourceDurationMs}.`,
      remediation: 'Probe source media before sending interval-based native commands.',
    });
  }

  const seenIntervalIds = new Set<string>();
  for (const interval of input.request.intervals) {
    if (seenIntervalIds.has(interval.id)) {
      blockers.push({
        code: 'DUPLICATE_NATIVE_INTERVAL_ID',
        message: `Native interval id ${interval.id} is duplicated.`,
        intervalId: interval.id,
        remediation: 'Use stable unique ids for every interval sent to native execution.',
      });
    } else {
      seenIntervalIds.add(interval.id);
    }

    if (!isValidNativeInterval(interval)) {
      blockers.push({
        code: 'INVALID_NATIVE_INTERVAL',
        message: `Native interval ${interval.id} has invalid range ${interval.startMs}-${interval.endMs}.`,
        intervalId: interval.id,
        remediation: 'Use integer millisecond intervals with positive duration.',
      });
      continue;
    }

    if (interval.startMs < 0 || interval.endMs > input.sourceDurationMs) {
      blockers.push({
        code: 'NATIVE_INTERVAL_OUT_OF_SOURCE',
        message: `Native interval ${interval.id} is outside source duration ${input.sourceDurationMs}ms.`,
        intervalId: interval.id,
        remediation: 'Only pass intervals validated against probed source duration.',
      });
    }

    if (interval.unitIds.length === 0) {
      blockers.push({
        code: 'NATIVE_INTERVAL_WITHOUT_UNITS',
        message: `Native interval ${interval.id} has no content unit ids.`,
        intervalId: interval.id,
        remediation: 'Never send raw time-only intervals to native mutation or render commands.',
      });
    }

    if (interval.unitIds.some((unitId) => unitId.trim().length === 0)) {
      blockers.push({
        code: 'NATIVE_INTERVAL_WITH_BLANK_UNIT_ID',
        message: `Native interval ${interval.id} has a blank content unit id.`,
        intervalId: interval.id,
        remediation: 'Strip blank unit ids and preserve only stable content unit identifiers.',
      });
    }
  }

  return {
    ready: blockers.length === 0,
    blockers,
    intervalCount: input.request.intervals.length,
  };
}

function validateNativeCommandPayload(
  request: SmartCutNativeCommandRequest,
  blockers: SmartCutNativeCommandRequestBlocker[],
) {
  if (request.commandId === 'smart_cut_apply_filter_plan' || request.commandId === 'smart_cut_validate_filtered_plan') {
    if (!isNonEmptyPayloadString(request.payload.filterPlanId)) {
      blockers.push({
        code: 'NATIVE_FILTER_PLAN_ID_MISSING',
        message: `Native command ${request.commandId} requires a filterPlanId payload value.`,
        remediation: 'Attach the validated post-slice filter plan id before native filter execution or validation.',
      });
    }
  }

  if (request.commandId === 'smart_cut_render_plan' || request.commandId === 'smart_cut_probe_artifacts') {
    if (!isNonEmptyPayloadString(request.payload.renderContractId)) {
      blockers.push({
        code: 'NATIVE_RENDER_CONTRACT_ID_MISSING',
        message: `Native command ${request.commandId} requires a renderContractId payload value.`,
        remediation: 'Attach the validated render contract id before native rendering or artifact probing.',
      });
    }
  }

  if (request.commandId === 'smart_cut_extract_visual_evidence') {
    validateVisualEvidencePayload(request, blockers);
  }
}

function isNonEmptyPayloadString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateVisualEvidencePayload(
  request: SmartCutNativeCommandRequest,
  blockers: SmartCutNativeCommandRequestBlocker[],
) {
  const profile = request.payload.visualEvidenceProfile;
  if (!isNonEmptyPayloadString(profile)) {
    blockers.push({
      code: 'NATIVE_VISUAL_EVIDENCE_PROFILE_MISSING',
      message: 'Native visual evidence extraction requires a visualEvidenceProfile payload value.',
      remediation: 'Attach the registered visual evidence profile before crossing the Rust visual evidence boundary.',
    });
  } else if (!SMART_CUT_VISUAL_EVIDENCE_PROFILES.includes(profile as (typeof SMART_CUT_VISUAL_EVIDENCE_PROFILES)[number])) {
    blockers.push({
      code: 'NATIVE_VISUAL_EVIDENCE_PROFILE_INVALID',
      message: `Native visual evidence profile ${profile} is not supported.`,
      remediation: 'Use a registered visual evidence profile such as shot-boundary-v1 or scene-index-v1.',
    });
  }

  const sceneChangeThreshold = request.payload.sceneChangeThreshold;
  if (
    sceneChangeThreshold !== undefined &&
    (
      typeof sceneChangeThreshold !== 'number' ||
      !Number.isFinite(sceneChangeThreshold) ||
      sceneChangeThreshold <= 0 ||
      sceneChangeThreshold >= 1
    )
  ) {
    blockers.push({
      code: 'NATIVE_VISUAL_SCENE_THRESHOLD_INVALID',
      message: `Native visual sceneChangeThreshold ${String(sceneChangeThreshold)} is invalid.`,
      remediation: 'Use a scene change threshold strictly between 0 and 1.',
    });
  }

  const minShotDurationMs = request.payload.minShotDurationMs;
  if (
    minShotDurationMs !== undefined &&
    (
      typeof minShotDurationMs !== 'number' ||
      !Number.isFinite(minShotDurationMs) ||
      !Number.isInteger(minShotDurationMs) ||
      minShotDurationMs <= 0
    )
  ) {
    blockers.push({
      code: 'NATIVE_VISUAL_MIN_SHOT_DURATION_INVALID',
      message: `Native visual minShotDurationMs ${String(minShotDurationMs)} is invalid.`,
      remediation: 'Use a positive integer millisecond minimum shot duration for native shot detection.',
    });
  }
}

function isValidNativeInterval(interval: SmartCutNativeInterval): boolean {
  return Number.isFinite(interval.startMs) &&
    Number.isFinite(interval.endMs) &&
    Number.isInteger(interval.startMs) &&
    Number.isInteger(interval.endMs) &&
    interval.endMs > interval.startMs;
}
