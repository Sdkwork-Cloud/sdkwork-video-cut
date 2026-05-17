import type { SmartCutArtifactKind } from './domain.ts';
import { SMART_CUT_STANDARD_VERSION } from './domain.ts';
import type { SmartCutNativeCommandId } from './pipeline.ts';
import type {
  SmartCutAudioPackagingProfile,
  SmartCutProductPresetId,
  SmartCutRendererId,
  SmartCutSubtitleProfile,
  SmartCutVisualPackagingProfile,
} from './presets.ts';
import { SMART_CUT_PRODUCT_PRESET_REGISTRY } from './presets.ts';
import type { SmartCutOutputProfile } from './domain.ts';
import type { SmartCutValidatorId } from './validators.ts';

export interface SmartCutRenderContractInput {
  presetId: SmartCutProductPresetId;
  planId: string;
  candidateIds: readonly string[];
}

export interface SmartCutRenderContract {
  id: string;
  schemaVersion: typeof SMART_CUT_STANDARD_VERSION;
  presetId: SmartCutProductPresetId;
  sourcePlanId: string;
  candidateIds: readonly string[];
  batchOutput: boolean;
  rendererIds: readonly SmartCutRendererId[];
  outputProfile: SmartCutOutputProfile;
  subtitle: SmartCutSubtitleProfile;
  audio: SmartCutAudioPackagingProfile;
  visual: SmartCutVisualPackagingProfile;
  requiredArtifactKinds: readonly SmartCutArtifactKind[];
  requiredValidatorIds: readonly SmartCutValidatorId[];
  nativeCommandIds: readonly SmartCutNativeCommandId[];
}

export interface SmartCutRenderContractValidationInput {
  renderContract: SmartCutRenderContract;
}

export type SmartCutRenderContractBlockerCode =
  | 'INVALID_RENDER_CONTRACT_SCHEMA_VERSION'
  | 'UNKNOWN_PRESET'
  | 'RENDER_CONTRACT_SOURCE_PLAN_MISSING'
  | 'RENDER_CONTRACT_WITHOUT_CANDIDATES'
  | 'RENDER_CONTRACT_WITH_BLANK_CANDIDATE_ID'
  | 'RENDER_CONTRACT_WITH_DUPLICATE_CANDIDATE_ID'
  | 'RENDER_CONTRACT_WITHOUT_RENDERER'
  | 'RENDER_CONTRACT_RENDERER_MISMATCH'
  | 'RENDER_CONTRACT_PRESET_RENDERER_CHAIN_MISMATCH'
  | 'RENDER_CONTRACT_BATCH_OUTPUT_MISMATCH'
  | 'RENDER_CONTRACT_OUTPUT_PROFILE_MISMATCH'
  | 'RENDER_CONTRACT_SUBTITLE_PROFILE_MISMATCH'
  | 'RENDER_CONTRACT_AUDIO_PROFILE_MISMATCH'
  | 'RENDER_CONTRACT_VISUAL_PROFILE_MISMATCH'
  | 'RENDER_CONTRACT_ARTIFACT_KIND_MISMATCH'
  | 'MISSING_RENDER_ARTIFACT_VALIDATOR'
  | 'MISSING_NATIVE_RENDER_COMMAND'
  | 'INVALID_OUTPUT_PROFILE';

export interface SmartCutRenderContractBlocker {
  code: SmartCutRenderContractBlockerCode;
  message: string;
  remediation: string;
}

export interface SmartCutRenderContractValidationReport {
  ready: boolean;
  blockers: readonly SmartCutRenderContractBlocker[];
  rendererCount: number;
  candidateCount: number;
}

const requiredRenderArtifactKinds = [
  'rendered-video',
  'subtitle',
  'cover',
  'quality-report',
] as const satisfies readonly SmartCutArtifactKind[];

const requiredRenderValidatorIds = [
  'render-artifact-integrity',
  'publishability-standard',
] as const satisfies readonly SmartCutValidatorId[];

const renderNativeCommandIds = [
  'smart_cut_render_plan',
  'smart_cut_probe_artifacts',
] as const satisfies readonly SmartCutNativeCommandId[];

export function createSmartCutRenderContract(input: SmartCutRenderContractInput): SmartCutRenderContract {
  const preset = SMART_CUT_PRODUCT_PRESET_REGISTRY.find((entry) => entry.id === input.presetId);
  if (preset === undefined) {
    throw new Error(`Unknown smart cut product preset: ${input.presetId}`);
  }

  return {
    id: `render-contract-${input.planId}`,
    schemaVersion: SMART_CUT_STANDARD_VERSION,
    presetId: preset.id,
    sourcePlanId: input.planId,
    candidateIds: [...input.candidateIds],
    batchOutput: preset.batchOutput,
    rendererIds: [...preset.renderers],
    outputProfile: { ...preset.outputProfile },
    subtitle: { ...preset.subtitleProfile },
    audio: { ...preset.audioPackaging },
    visual: { ...preset.visualPackaging },
    requiredArtifactKinds: preset.subtitleProfile.enabled ? requiredRenderArtifactKinds : ['rendered-video', 'quality-report'],
    requiredValidatorIds: requiredRenderValidatorIds,
    nativeCommandIds: renderNativeCommandIds,
  };
}

export function validateSmartCutRenderContract(
  input: SmartCutRenderContractValidationInput,
): SmartCutRenderContractValidationReport {
  const blockers: SmartCutRenderContractBlocker[] = [];
  const preset = SMART_CUT_PRODUCT_PRESET_REGISTRY.find((entry) => entry.id === input.renderContract.presetId);

  if (input.renderContract.schemaVersion !== SMART_CUT_STANDARD_VERSION) {
    blockers.push({
      code: 'INVALID_RENDER_CONTRACT_SCHEMA_VERSION',
      message: `Render contract schema version ${input.renderContract.schemaVersion} does not match ${SMART_CUT_STANDARD_VERSION}.`,
      remediation: 'Regenerate render contracts with the current smart cut standard version.',
    });
  }

  if (preset === undefined) {
    blockers.push({
      code: 'UNKNOWN_PRESET',
      message: `Unknown smart cut product preset: ${input.renderContract.presetId}`,
      remediation: 'Create render contracts from a registered smart cut product preset.',
    });
  }

  if (input.renderContract.sourcePlanId.trim().length === 0) {
    blockers.push({
      code: 'RENDER_CONTRACT_SOURCE_PLAN_MISSING',
      message: 'Render contract has no source plan id.',
      remediation: 'Attach the validated filtered plan id before creating a render contract.',
    });
  }

  if (input.renderContract.candidateIds.length === 0) {
    blockers.push({
      code: 'RENDER_CONTRACT_WITHOUT_CANDIDATES',
      message: 'Render contract has no candidate ids.',
      remediation: 'Render only validated filtered candidates.',
    });
  }

  validateCandidateIds(input.renderContract.candidateIds, blockers);

  if (input.renderContract.rendererIds.length === 0) {
    blockers.push({
      code: 'RENDER_CONTRACT_WITHOUT_RENDERER',
      message: 'Render contract has no renderer ids.',
      remediation: 'Select at least one registered renderer from the preset.',
    });
  }

  if (preset !== undefined) {
    validatePresetConsistency(input.renderContract, preset, blockers);
  }

  if (!isValidOutputProfile(input.renderContract.outputProfile)) {
    blockers.push({
      code: 'INVALID_OUTPUT_PROFILE',
      message: 'Render contract output profile is incomplete or invalid.',
      remediation: 'Use the preset output profile when creating render contracts.',
    });
  }

  if (!requiredRenderValidatorIds.every((validatorId) => input.renderContract.requiredValidatorIds.includes(validatorId))) {
    blockers.push({
      code: 'MISSING_RENDER_ARTIFACT_VALIDATOR',
      message: 'Render contract is missing required render validators.',
      remediation: 'Require render-artifact-integrity and publishability-standard validators.',
    });
  }

  if (!renderNativeCommandIds.every((commandId) => input.renderContract.nativeCommandIds.includes(commandId))) {
    blockers.push({
      code: 'MISSING_NATIVE_RENDER_COMMAND',
      message: 'Render contract is missing native render or artifact probe command ids.',
      remediation: 'Route rendering through native render and artifact probe commands.',
    });
  }

  return {
    ready: blockers.length === 0,
    blockers,
    rendererCount: input.renderContract.rendererIds.length,
    candidateCount: input.renderContract.candidateIds.length,
  };
}

function validateCandidateIds(
  candidateIds: readonly string[],
  blockers: SmartCutRenderContractBlocker[],
) {
  const seen = new Set<string>();
  const reported = new Set<string>();
  for (const candidateId of candidateIds) {
    if (candidateId.trim().length === 0) {
      blockers.push({
        code: 'RENDER_CONTRACT_WITH_BLANK_CANDIDATE_ID',
        message: 'Render contract contains a blank candidate id.',
        remediation: 'Render contracts must reference stable selected candidate ids only.',
      });
      continue;
    }

    if (seen.has(candidateId)) {
      if (!reported.has(candidateId)) {
        blockers.push({
          code: 'RENDER_CONTRACT_WITH_DUPLICATE_CANDIDATE_ID',
          message: `Render contract contains duplicate candidate id ${candidateId}.`,
          remediation: 'Render each selected candidate once and keep candidate ids unique inside the contract.',
        });
        reported.add(candidateId);
      }
      continue;
    }
    seen.add(candidateId);
  }
}

function validatePresetConsistency(
  renderContract: SmartCutRenderContract,
  preset: (typeof SMART_CUT_PRODUCT_PRESET_REGISTRY)[number],
  blockers: SmartCutRenderContractBlocker[],
) {
  const expectedArtifactKinds = preset.subtitleProfile.enabled ? requiredRenderArtifactKinds : ['rendered-video', 'quality-report'];
  const presetRendererIds = new Set<SmartCutRendererId>(preset.renderers);
  const rendererMismatch = renderContract.rendererIds.some((rendererId) => !presetRendererIds.has(rendererId));
  if (rendererMismatch) {
    blockers.push({
      code: 'RENDER_CONTRACT_RENDERER_MISMATCH',
      message: `Render contract renderers ${renderContract.rendererIds.join(',')} do not match preset ${preset.id}.`,
      remediation: 'Use only renderer ids declared by the selected product preset.',
    });
  }

  if (!orderedValuesEqual(renderContract.rendererIds, preset.renderers)) {
    blockers.push({
      code: 'RENDER_CONTRACT_PRESET_RENDERER_CHAIN_MISMATCH',
      message: `Render contract renderer chain ${renderContract.rendererIds.join('>')} does not match preset chain ${preset.renderers.join('>')}.`,
      remediation: 'Regenerate render contracts from the selected product preset renderer chain.',
    });
  }

  if (renderContract.batchOutput !== preset.batchOutput) {
    blockers.push({
      code: 'RENDER_CONTRACT_BATCH_OUTPUT_MISMATCH',
      message: `Render contract batchOutput ${renderContract.batchOutput} does not match preset ${preset.id}.`,
      remediation: 'Preserve the preset batch output contract when creating render contracts.',
    });
  }

  if (!objectsEqual(renderContract.outputProfile, preset.outputProfile)) {
    blockers.push({
      code: 'RENDER_CONTRACT_OUTPUT_PROFILE_MISMATCH',
      message: `Render contract output profile does not match preset ${preset.id}.`,
      remediation: 'Use the output profile declared by the selected product preset without mutation.',
    });
  }

  if (!objectsEqual(renderContract.subtitle, preset.subtitleProfile)) {
    blockers.push({
      code: 'RENDER_CONTRACT_SUBTITLE_PROFILE_MISMATCH',
      message: `Render contract subtitle profile does not match preset ${preset.id}.`,
      remediation: 'Use the subtitle profile declared by the selected product preset without mutation.',
    });
  }

  if (!objectsEqual(renderContract.audio, preset.audioPackaging)) {
    blockers.push({
      code: 'RENDER_CONTRACT_AUDIO_PROFILE_MISMATCH',
      message: `Render contract audio packaging profile does not match preset ${preset.id}.`,
      remediation: 'Use the audio packaging profile declared by the selected product preset without mutation.',
    });
  }

  if (!objectsEqual(renderContract.visual, preset.visualPackaging)) {
    blockers.push({
      code: 'RENDER_CONTRACT_VISUAL_PROFILE_MISMATCH',
      message: `Render contract visual packaging profile does not match preset ${preset.id}.`,
      remediation: 'Use the visual packaging profile declared by the selected product preset without mutation.',
    });
  }

  if (!orderedValuesEqual(renderContract.requiredArtifactKinds, expectedArtifactKinds)) {
    blockers.push({
      code: 'RENDER_CONTRACT_ARTIFACT_KIND_MISMATCH',
      message: `Render contract artifact kinds ${renderContract.requiredArtifactKinds.join(',')} do not match preset ${preset.id}.`,
      remediation: 'Require exactly the artifact kinds implied by the selected product preset subtitle and packaging profile.',
    });
  }
}

function isValidOutputProfile(outputProfile: SmartCutOutputProfile): boolean {
  return outputProfile.aspectRatio.length > 0 &&
    outputProfile.resolution.length > 0 &&
    outputProfile.format.length > 0 &&
    (
      outputProfile.frameRateFps === 'source' ||
      (Number.isFinite(outputProfile.frameRateFps) && outputProfile.frameRateFps > 0)
    );
}

function orderedValuesEqual<T extends string | number | boolean>(
  left: readonly T[],
  right: readonly T[],
): boolean {
  return left.join('\u0000') === right.join('\u0000');
}

function objectsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
