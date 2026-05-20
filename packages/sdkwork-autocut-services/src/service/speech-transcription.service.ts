import {
  AUTOCUT_LOCAL_SPEECH_TRANSCRIPTION_MODEL_PRESETS,
  AUTOCUT_DEFAULT_LOCAL_SPEECH_TRANSCRIPTION_MODEL_PRESET_ID,
  AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER_DEFINITIONS,
  AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_EXTENSIONS,
  AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_PHASE,
  AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_NEXT_ACTION,
  AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS,
  AUTOCUT_SPEECH_TRANSCRIPTION_WORKFLOW_PRESETS,
  AUTOCUT_MODEL_VENDOR_PRESETS,
  isLowInformationAutoCutTranscriptEvidenceText,
  isAutoCutSpeechTranscriptionModelDownloadPhase,
  createAutoCutSpeechTranscriptionProviderDefaultOptions,
  getAutoCutSpeechTranscriptionWorkflowPreset,
  getAutoCutSpeechTranscriptionProviderDefinition,
  type AutoCutSpeechTranscriptionProviderOptions,
  type AutoCutLocalSpeechTranscriptionExecutablePlatform,
  type AutoCutLlmRuntimeConfig,
  type AutoCutLocalSpeechTranscriptionSetupNextAction,
  type AutoCutLocalSpeechTranscriptionSetupReadiness,
  type AutoCutLocalSpeechTranscriptionSetupStatus,
  type AutoCutLocalSpeechTranscriptionModelSetupResult,
  type AutoCutLocalSpeechTranscriptionModelPreset,
  type AutoCutLocalSpeechTranscriptionSetupInitializationResult,
  type AutoCutSpeechTranscriptionModelDownloadProgressEvent,
  type AutoCutSpeechTranscriptionProviderDefinition,
  type AutoCutSpeechTranscriptionProviderId,
  type AutoCutSpeechTranscriptionSettings,
  type AutoCutSpeechTranscriptionWorkflowPreset,
  type AutoCutSmartSliceTranscript,
} from '@sdkwork/autocut-types';
import { writeAutoCutClipboardText } from './browser.service';
import { downloadAutoCutUrl } from './download.service';
import {
  getAutoCutNativeHostClient,
  type AutoCutSpeechTranscriptionProbe,
  type AutoCutSpeechTranscriptionRequest,
  type AutoCutSpeechTranscriptionResult,
  type AutoCutSpeechTranscriptionSegment,
  type AutoCutSpeechTranscriptQualityGuard,
} from './native-host-client.service';
import { dispatchAutoCutEvent } from './events.service';
import {
  getAutoCutSettings,
  markAutoCutSpeechTranscriptionProviderTested,
  resolveAutoCutOutputRootDir,
  resolveAutoCutLlmRuntimeConfig,
  resolveAutoCutSpeechTranscriptionRuntimeConfig,
  saveAutoCutSpeechTranscriptionSettings,
} from './settings.service';
import { reportAutoCutDiagnostic } from './diagnostics.service';
import { createAutoCutTimestamp } from './identity.service';

export interface AutoCutSpeechTranscriptionProviderBridge {
  transcribe(
    request: AutoCutSpeechTranscriptionRequest,
    runtime: AutoCutSpeechTranscriptionProviderRuntimeConfig,
  ): Promise<AutoCutSpeechTranscriptionProviderBridgeResult>;
  test?(runtime: AutoCutSpeechTranscriptionProviderRuntimeConfig): Promise<AutoCutSpeechTranscriptionProviderTestResult>;
}

export interface AutoCutSpeechTranscriptionProviderBridgeResult
  extends Partial<AutoCutSpeechTranscriptionResult> {
  segments: AutoCutSpeechTranscriptionSegment[];
  text?: string;
  providerId?: AutoCutSpeechTranscriptionProviderRuntimeConfig['providerId'];
  standardTranscript?: AutoCutSmartSliceTranscript;
}

export interface AutoCutSpeechTranscriptionProviderRuntimeConfig extends AutoCutSpeechTranscriptionSettings {
  provider: AutoCutSpeechTranscriptionProviderDefinition;
  requestFormat: 'autocut-speech-transcription-provider';
  providerOptions?: AutoCutSpeechTranscriptionProviderOptions;
  modelVendorRuntime?: AutoCutLlmRuntimeConfig;
  sessionApiKey?: string;
}

export interface AutoCutSpeechTranscriptionProviderTestResult extends Partial<AutoCutSpeechTranscriptionProbe> {
  ready: boolean;
  providerId: AutoCutSpeechTranscriptionProviderRuntimeConfig['providerId'];
  sourceKind: string;
  diagnostics: string[];
}

let configuredSpeechTranscriptionProviderBridge: AutoCutSpeechTranscriptionProviderBridge | null = null;
let lastAutoCutLocalSpeechTranscriptionSetupStatus: AutoCutLocalSpeechTranscriptionSetupStatus | null = null;
let inFlightAutoCutLocalSpeechTranscriptionSetupInitialization:
  Promise<AutoCutLocalSpeechTranscriptionSetupInitializationResult> | null = null;
const inFlightAutoCutLocalSpeechTranscriptionModelSetups = new Map<
  string,
  Promise<AutoCutLocalSpeechTranscriptionModelSetupResult>
>();

function clearAutoCutLocalSpeechTranscriptionSetupStatusCache() {
  lastAutoCutLocalSpeechTranscriptionSetupStatus = null;
}

async function yieldAutoCutSpeechTranscriptionUiFrame() {
  await new Promise<void>((resolve) => {
    const requestFrame =
      typeof globalThis.requestAnimationFrame === 'function'
        ? globalThis.requestAnimationFrame.bind(globalThis)
        : typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
          ? window.requestAnimationFrame.bind(window)
          : null;
    const defer =
      typeof globalThis.setTimeout === 'function'
        ? globalThis.setTimeout.bind(globalThis)
        : null;

    const finish = () => {
      if (defer) {
        defer(resolve, 0);
        return;
      }
      resolve();
    };

    if (requestFrame) {
      requestFrame(finish);
      return;
    }

    finish();
  });
}

const AUTOCUT_LOCAL_SPEECH_TRANSCRIPTION_DEFAULT_MODEL_ROOT = 'AutoCut application data';
const AUTOCUT_LOCAL_SPEECH_TRANSCRIPTION_DEFAULT_EXECUTABLE_ROOT = 'AutoCut application resources';
const AUTOCUT_LOCAL_SPEECH_TRANSCRIPTION_EXECUTABLE_RESOURCE_SUBDIRECTORY = 'binaries';
const AUTOCUT_LOCAL_SPEECH_TRANSCRIPTION_MODEL_SUBDIRECTORY = 'models/speech';
const AUTOCUT_LOCAL_SPEECH_TRANSCRIPTION_EXECUTABLE_BINARY = 'whisper-cli';
const AUTOCUT_SPEECH_TRANSCRIPTION_SEGMENT_OVERLAP_REPAIR_MS = 250;
const AUTOCUT_SPEECH_TRANSCRIPTION_SECONDS_UNIT_MAX_TIMELINE_MS = 600;
const AUTOCUT_SPEECH_TRANSCRIPTION_SECONDS_UNIT_MAX_SEGMENT_DURATION_MS = 120;
const AUTOCUT_SPEECH_TRANSCRIPTION_SECONDS_UNIT_MIN_SEGMENTS = 2;
const AUTOCUT_SPEECH_TRANSCRIPTION_SECONDS_UNIT_MIN_SCALED_SEGMENT_DURATION_MS = 1_000;
const AUTOCUT_SPEECH_TRANSCRIPTION_SECONDS_UNIT_MIN_EVIDENCE_UNITS = 5;
const AUTOCUT_SPEECH_TRANSCRIPTION_SECONDS_UNIT_MIN_TEXT_UNITS_PER_SECOND = 80;
const AUTOCUT_SPEECH_TRANSCRIPTION_SECONDS_UNIT_MIN_SEGMENT_TEXT_UNITS = 8;
const AUTOCUT_SPEECH_TRANSCRIPTION_SECONDS_UNIT_MIN_RICH_SEGMENTS = 2;
const AUTOCUT_SPEECH_TRANSCRIPTION_REPEAT_SEGMENT_JOIN_GAP_MS = 1_500;

function createAutoCutSpeechTranscriptionGpuProbeParams(
  probe: Pick<AutoCutSpeechTranscriptionProbe, 'gpuReady' | 'gpuBackend' | 'gpuDiagnostics'>,
) {
  return {
    ...(probe.gpuReady !== undefined ? { gpuReady: probe.gpuReady } : {}),
    ...(probe.gpuBackend ? { gpuBackend: probe.gpuBackend } : {}),
    ...(probe.gpuDiagnostics ? { gpuDiagnostics: probe.gpuDiagnostics } : {}),
  };
}

function normalizeAutoCutWhisperChunkInteger(value: unknown, fieldName: string) {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 8) {
    throw new Error(`AutoCut speech-to-text workflow preset localWhisper.${fieldName} must be an integer from 1 to 8.`);
  }
  return Number(value);
}

function normalizeAutoCutWhisperDecodeInteger(value: unknown, fieldName: string, min: number, max: number) {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
    throw new Error(
      `AutoCut speech-to-text workflow preset localWhisper.decode.${fieldName} must be an integer from ${min} to ${max}.`,
    );
  }
  return Number(value);
}

export function getAutoCutSpeechTranscriptionProviderDefinitions() {
  return AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER_DEFINITIONS;
}

export function getAutoCutLocalSpeechTranscriptionModelPresets(
  providerId?: AutoCutSpeechTranscriptionProviderId,
) {
  return AUTOCUT_LOCAL_SPEECH_TRANSCRIPTION_MODEL_PRESETS
    .filter((preset) => !providerId || preset.providerId === providerId)
    .map((preset) => resolveAutoCutLocalSpeechTranscriptionModelPreset(preset));
}

export function resolveAutoCutLocalSpeechTranscriptionModelPreset(
  presetOrId: AutoCutLocalSpeechTranscriptionModelPreset | string,
): AutoCutLocalSpeechTranscriptionModelPreset {
  const preset = typeof presetOrId === 'string'
    ? AUTOCUT_LOCAL_SPEECH_TRANSCRIPTION_MODEL_PRESETS.find((candidate) => candidate.id === presetOrId)
    : presetOrId;

  if (!preset) {
    throw new Error('AutoCut local speech-to-text model preset is not registered.');
  }

  validateAutoCutLocalSpeechTranscriptionModelPreset(preset);
  return { ...preset };
}

export function resolveAutoCutRecommendedLocalSpeechTranscriptionModelPreset(
  providerId?: AutoCutSpeechTranscriptionProviderId,
): AutoCutLocalSpeechTranscriptionModelPreset {
  const presets = getAutoCutLocalSpeechTranscriptionModelPresets(providerId);
  const defaultPreset = presets.find((preset) => preset.id === AUTOCUT_DEFAULT_LOCAL_SPEECH_TRANSCRIPTION_MODEL_PRESET_ID);
  const recommendedPreset = presets.find((preset) => preset.recommended);
  const preset = defaultPreset ?? recommendedPreset ?? presets[0];
  if (!preset) {
    throw new Error('AutoCut local speech-to-text provider has no registered model preset.');
  }

  return { ...preset };
}

export function getAutoCutSpeechTranscriptionWorkflowPresets() {
  return AUTOCUT_SPEECH_TRANSCRIPTION_WORKFLOW_PRESETS.map((preset) =>
    resolveAutoCutSpeechTranscriptionWorkflowPreset(preset.id)
  );
}

export function resolveAutoCutSpeechTranscriptionWorkflowPreset(
  presetId?: string,
): AutoCutSpeechTranscriptionWorkflowPreset {
  const preset = getAutoCutSpeechTranscriptionWorkflowPreset(presetId);
  if (!preset.available) {
    throw new Error(
      preset.unavailableReason ??
        `AutoCut speech-to-text workflow preset ${preset.id} is not available in this build.`,
    );
  }
  if (preset.localWhisper) {
    normalizeAutoCutWhisperChunkInteger(preset.localWhisper.chunkParallelism, 'chunkParallelism');
    normalizeAutoCutWhisperChunkInteger(preset.localWhisper.chunkThreadCount, 'chunkThreadCount');
    if (
      preset.localWhisper.chunkSourceStrategy !== 'audio-first' &&
      preset.localWhisper.chunkSourceStrategy !== 'source-direct'
    ) {
      throw new Error('AutoCut speech-to-text workflow preset localWhisper.chunkSourceStrategy must be audio-first or source-direct.');
    }
    if (preset.localWhisper.decode) {
      normalizeAutoCutWhisperDecodeInteger(preset.localWhisper.decode.audioContext, 'audioContext', 1, 1_500);
      normalizeAutoCutWhisperDecodeInteger(preset.localWhisper.decode.beamSize, 'beamSize', 1, 8);
      normalizeAutoCutWhisperDecodeInteger(preset.localWhisper.decode.bestOf, 'bestOf', 1, 8);
      if (
        preset.localWhisper.decode.noFallback !== undefined &&
        typeof preset.localWhisper.decode.noFallback !== 'boolean'
      ) {
        throw new Error('AutoCut speech-to-text workflow preset localWhisper.decode.noFallback must be a boolean.');
      }
    }
  }
  if (preset.modelPresetId) {
    const modelPreset = resolveAutoCutLocalSpeechTranscriptionModelPreset(preset.modelPresetId);
    if (modelPreset.providerId !== preset.providerId) {
      throw new Error(
        `AutoCut speech-to-text workflow preset ${preset.id} references a local model preset for a different provider.`,
      );
    }
  }
  return {
    ...preset,
    ...(preset.localWhisper
      ? {
          localWhisper: {
            ...preset.localWhisper,
            ...(preset.localWhisper.decode ? { decode: { ...preset.localWhisper.decode } } : {}),
          },
        }
      : {}),
  };
}

export function downloadAutoCutLocalSpeechTranscriptionModelPreset(
  presetOrId: AutoCutLocalSpeechTranscriptionModelPreset | string,
) {
  const preset = resolveAutoCutLocalSpeechTranscriptionModelPreset(presetOrId);
  downloadAutoCutUrl(preset.url, preset.fileName);
}

export function dispatchAutoCutSpeechTranscriptionModelDownloadProgress(
  progress: AutoCutSpeechTranscriptionModelDownloadProgressEvent,
) {
  dispatchAutoCutEvent('speechTranscriptionModelDownloadProgress', normalizeAutoCutSpeechTranscriptionModelDownloadProgress(progress));
}

export async function copyAutoCutLocalSpeechTranscriptionModelPresetUrl(
  presetOrId: AutoCutLocalSpeechTranscriptionModelPreset | string,
) {
  const preset = resolveAutoCutLocalSpeechTranscriptionModelPreset(presetOrId);
  await writeAutoCutClipboardText(getAutoCutLocalSpeechTranscriptionModelPresetDownloadUrls(preset).join('\n'));
}

export async function setupAutoCutLocalSpeechTranscriptionModelPreset(
  presetOrId?: AutoCutLocalSpeechTranscriptionModelPreset | string,
): Promise<AutoCutLocalSpeechTranscriptionModelSetupResult> {
  const preset = presetOrId
    ? resolveAutoCutLocalSpeechTranscriptionModelPreset(presetOrId)
    : resolveAutoCutRecommendedLocalSpeechTranscriptionModelPreset();
  const runtime = await resolveAutoCutSpeechTranscriptionProviderRuntimeConfigForProvider(preset.providerId);
  return setupAutoCutLocalSpeechTranscriptionModelPresetForRuntime(runtime, preset);
}

async function setupAutoCutLocalSpeechTranscriptionModelPresetForRuntime(
  runtime: AutoCutSpeechTranscriptionProviderRuntimeConfig,
  preset: AutoCutLocalSpeechTranscriptionModelPreset,
): Promise<AutoCutLocalSpeechTranscriptionModelSetupResult> {
  if (preset.providerId !== runtime.providerId) {
    throw new Error('AutoCut local speech-to-text model preset must match the selected provider.');
  }
  if (runtime.provider.kind !== 'local') {
    throw new Error('AutoCut local speech-to-text model setup requires a local speech-to-text provider.');
  }

  const setupKey = `${runtime.providerId}:${preset.id}`;
  const inFlightSetup = inFlightAutoCutLocalSpeechTranscriptionModelSetups.get(setupKey);
  if (inFlightSetup) {
    return await inFlightSetup;
  }

  const setup = runAutoCutLocalSpeechTranscriptionModelPresetSetup(runtime, preset);
  inFlightAutoCutLocalSpeechTranscriptionModelSetups.set(setupKey, setup);
  try {
    return await setup;
  } finally {
    if (inFlightAutoCutLocalSpeechTranscriptionModelSetups.get(setupKey) === setup) {
      inFlightAutoCutLocalSpeechTranscriptionModelSetups.delete(setupKey);
    }
  }
}

async function runAutoCutLocalSpeechTranscriptionModelPresetSetup(
  runtime: AutoCutSpeechTranscriptionProviderRuntimeConfig,
  preset: AutoCutLocalSpeechTranscriptionModelPreset,
): Promise<AutoCutLocalSpeechTranscriptionModelSetupResult> {
  const nativeHostClient = getAutoCutNativeHostClient();
  const capabilities = await nativeHostClient.getCapabilities();
  if (!capabilities.speechTranscriptionModelDownloadCommandReady) {
    dispatchAutoCutSpeechTranscriptionModelDownloadProgress({
      providerId: preset.providerId,
      presetId: preset.id,
      fileName: preset.fileName,
      phase: AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_PHASE.started,
      downloadedBytes: 0,
      totalBytes: preset.minimumByteSize,
      progress: 0,
      sourceUrl: preset.url,
    });
    downloadAutoCutLocalSpeechTranscriptionModelPreset(preset);
    const settings = await saveAutoCutSpeechTranscriptionSettings({
      ...runtime,
      providerId: preset.providerId,
      modelPath: '',
    });
    clearAutoCutLocalSpeechTranscriptionSetupStatusCache();
    dispatchAutoCutSpeechTranscriptionModelDownloadProgress({
      providerId: preset.providerId,
      presetId: preset.id,
      fileName: preset.fileName,
      phase: AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_PHASE.skipped,
      downloadedBytes: 0,
      totalBytes: preset.minimumByteSize,
      progress: 0,
      sourceUrl: preset.url,
    });
    return {
      preset,
      providerId: preset.providerId,
      modelPath: '',
      downloaded: false,
      nativeDownload: false,
      settings,
    };
  }

  const outputRootDir = await resolveAutoCutOutputRootDir();
  dispatchAutoCutSpeechTranscriptionModelDownloadProgress({
    providerId: preset.providerId,
    presetId: preset.id,
    fileName: preset.fileName,
    phase: AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_PHASE.started,
    downloadedBytes: 0,
    totalBytes: preset.minimumByteSize,
    progress: 0,
    sourceUrl: preset.url,
  });
  await yieldAutoCutSpeechTranscriptionUiFrame();
  const modelDownload = await nativeHostClient.downloadSpeechTranscriptionModel({
    providerId: preset.providerId,
    presetId: preset.id,
    fileName: preset.fileName,
    url: preset.url,
    ...(preset.mirrorUrls?.length ? { mirrorUrls: preset.mirrorUrls } : {}),
    sha256: preset.sha256,
    ...(outputRootDir ? { outputRootDir } : {}),
  }).catch((error) => {
    const userMessage = createAutoCutLocalSpeechTranscriptionDownloadFailureMessage(error);
    dispatchAutoCutSpeechTranscriptionModelDownloadProgress({
      providerId: preset.providerId,
      presetId: preset.id,
      fileName: preset.fileName,
      phase: AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_PHASE.failed,
      downloadedBytes: 0,
      totalBytes: preset.minimumByteSize,
      progress: 0,
      sourceUrl: preset.url,
      errorMessage: userMessage,
    });
    reportAutoCutDiagnostic(
      'error',
      'speech-transcription',
      'Local speech-to-text model download failed',
      error,
    );
    throw new Error(userMessage, { cause: error });
  });
  try {
    if (modelDownload.providerId !== preset.providerId || modelDownload.presetId !== preset.id) {
      throw new Error('AutoCut local speech-to-text model download result did not match the requested preset.');
    }
    if (
      modelDownload.fileName !== preset.fileName ||
      !isAutoCutLocalSpeechTranscriptionModelPresetDownloadUrl(preset, modelDownload.sourceUrl) ||
      normalizeAutoCutSha256Digest(modelDownload.sha256) !== normalizeAutoCutSha256Digest(preset.sha256)
    ) {
      throw new Error('AutoCut local speech-to-text model download result did not match the vetted model file.');
    }
    if (!modelDownload.modelPath.trim()) {
      throw new Error('AutoCut local speech-to-text model download did not return a local modelPath.');
    }
    validateAutoCutLocalSpeechTranscriptionModelDownloadResult(modelDownload.byteSize, preset);
  } catch (error) {
    const userMessage = createAutoCutLocalSpeechTranscriptionDownloadFailureMessage(error);
    dispatchAutoCutSpeechTranscriptionModelDownloadProgress({
      providerId: preset.providerId,
      presetId: preset.id,
      fileName: preset.fileName,
      phase: AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_PHASE.failed,
      downloadedBytes: modelDownload.byteSize || 0,
      totalBytes: preset.minimumByteSize,
      progress: 0,
      modelPath: modelDownload.modelPath,
      sourceUrl: preset.url,
      errorMessage: userMessage,
    });
    reportAutoCutDiagnostic(
      'error',
      'speech-transcription',
      'Local speech-to-text model validation failed',
      error,
    );
    throw new Error(userMessage, { cause: error });
  }
  dispatchAutoCutSpeechTranscriptionModelDownloadProgress({
    providerId: preset.providerId,
    presetId: preset.id,
    fileName: preset.fileName,
    phase: AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_PHASE.completed,
    downloadedBytes: modelDownload.byteSize,
    totalBytes: modelDownload.byteSize,
    progress: 100,
    modelPath: modelDownload.modelPath,
    sourceUrl: modelDownload.sourceUrl,
  });

  const latestRuntime = await resolveAutoCutSpeechTranscriptionProviderRuntimeConfig();
  const settings = await saveAutoCutSpeechTranscriptionSettings({
    ...latestRuntime,
    providerId: latestRuntime.providerId === preset.providerId ? latestRuntime.providerId : preset.providerId,
    modelPath: modelDownload.modelPath,
  });
  clearAutoCutLocalSpeechTranscriptionSetupStatusCache();

  return {
    preset,
    providerId: preset.providerId,
    modelPath: settings.speechTranscription.modelPath,
    downloaded: modelDownload.downloaded,
    nativeDownload: true,
    settings,
  };
}

export async function inspectAutoCutLocalSpeechTranscriptionSetup():
  Promise<AutoCutLocalSpeechTranscriptionSetupStatus> {
  const status = await inspectAutoCutLocalSpeechTranscriptionSetupStatus();
  lastAutoCutLocalSpeechTranscriptionSetupStatus = status;
  return status;
}

async function inspectAutoCutLocalSpeechTranscriptionSetupStatus():
  Promise<AutoCutLocalSpeechTranscriptionSetupStatus> {
  const runtime = await resolveAutoCutSpeechTranscriptionProviderRuntimeConfig();
  const localProviderIds = getAutoCutExecutableLocalSpeechTranscriptionProviderIds();
  const inspectedProviderId = runtime.provider.kind === 'local'
    ? runtime.providerId
    : localProviderIds[0];
  const preset = resolveAutoCutRecommendedLocalSpeechTranscriptionModelPreset(inspectedProviderId);
  const nativeHostClient = getAutoCutNativeHostClient();
  const capabilities = await nativeHostClient.getCapabilities();
  const executableDownloadReady = false;
  const capabilityStatus = createAutoCutLocalSpeechTranscriptionCapabilityStatus(capabilities);
  capabilityStatus.executableDownloadReady = executableDownloadReady;
  let defaultPaths = await createAutoCutLocalSpeechTranscriptionDefaultPaths(preset);
  const diagnostics: string[] = [];

  if (runtime.provider.kind !== 'local') {
    return {
      providerId: runtime.providerId,
      localProviderIds,
      readiness: AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.unsupported,
      nextAction: AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_NEXT_ACTION.none,
      executable: {
        ready: false,
        path: runtime.executablePath,
        sourceKind: 'unsupported-provider',
      },
      model: {
        ready: false,
        path: runtime.modelPath,
        preset,
      },
      test: {
        ready: false,
        ...(runtime.lastTestedAt ? { lastTestedAt: runtime.lastTestedAt } : {}),
      },
      gpu: {
        ready: false,
        diagnostics: [],
      },
      capabilities: capabilityStatus,
      defaults: defaultPaths,
      diagnostics: [`AutoCut speech-to-text provider ${runtime.providerId} is not a local provider.`],
    };
  }

  if (!capabilities.speechTranscriptionCommandReady || !capabilities.speechTranscriptionProbeCommandReady) {
    diagnostics.push(
      !capabilities.speechTranscriptionCommandReady
        ? 'AutoCut desktop host speech-to-text execution is not available.'
        : 'AutoCut desktop host speech-to-text validation is not available.',
    );
    return createAutoCutLocalSpeechTranscriptionSetupStatus({
      runtime,
      preset,
      localProviderIds,
      capabilities: capabilityStatus,
      defaults: defaultPaths,
      readiness: AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.failed,
      nextAction: AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_NEXT_ACTION.none,
      executablePath: runtime.executablePath,
      executableSourceKind: runtime.executablePath ? 'settings' : 'missing',
      modelPath: runtime.modelPath,
      diagnostics,
    });
  }

  const probe = await probeAutoCutLocalSpeechTranscriptionExecution(runtime);
  defaultPaths = createAutoCutLocalSpeechTranscriptionDefaultPathsFromProbe(defaultPaths, probe);
  diagnostics.push(...probe.diagnostics);
  diagnostics.push(...(probe.gpuDiagnostics ?? []));
  const executablePath = probe.executablePath?.trim() || runtime.executablePath;
  const modelPath = probe.modelPath?.trim() || runtime.modelPath;
  const executableReady = probe.executableReady ?? Boolean(executablePath);
  const modelReady = probe.modelReady ?? Boolean(modelPath);
  const testReady = probe.ready || runtime.lastProbeReady === true;
  const runtimeWithDiscoveredProbePaths = (probe.executableReady !== false && probe.executablePath?.trim()) ||
    (probe.modelReady !== false && probe.modelPath?.trim())
    ? await persistAutoCutLocalSpeechTranscriptionProbePaths(runtime, probe)
    : runtime;

  if (probe.ready) {
    const readyStatus = createAutoCutLocalSpeechTranscriptionSetupStatus({
      runtime: runtimeWithDiscoveredProbePaths,
      preset,
      localProviderIds,
      capabilities: capabilityStatus,
      defaults: defaultPaths,
      readiness: AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.ready,
      nextAction: AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_NEXT_ACTION.none,
      executablePath,
      executableSourceKind: probe.sourceKind,
      modelPath,
      diagnostics,
      executableReady,
      modelReady,
      testReady: true,
      ...createAutoCutSpeechTranscriptionGpuProbeParams(probe),
    });
    markAutoCutSpeechTranscriptionProviderTested(
      createAutoCutLocalSpeechTranscriptionProviderProbe(runtimeWithDiscoveredProbePaths, probe),
    );
    lastAutoCutLocalSpeechTranscriptionSetupStatus = readyStatus;
    return readyStatus;
  }

  if (runtime.configured && runtime.lastProbeReady === true && !probe.ready) {
    const runtimeWithProbePaths = await resolveAutoCutSpeechTranscriptionProviderRuntimeConfig();
    markAutoCutSpeechTranscriptionProviderTested(
      createAutoCutLocalSpeechTranscriptionProviderProbe(runtimeWithProbePaths, probe),
    );
  }

  if (!executableReady) {
    return createAutoCutLocalSpeechTranscriptionSetupStatus({
      runtime: runtimeWithDiscoveredProbePaths,
      preset,
      localProviderIds,
      capabilities: capabilityStatus,
      defaults: defaultPaths,
      readiness: AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.needsExecutable,
      nextAction: AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_NEXT_ACTION.selectExecutable,
      executablePath,
      executableSourceKind: probe.sourceKind || 'missing',
      modelPath,
      diagnostics,
      executableReady,
      modelReady,
      testReady,
      ...createAutoCutSpeechTranscriptionGpuProbeParams(probe),
    });
  }

  if (!modelReady) {
    return createAutoCutLocalSpeechTranscriptionSetupStatus({
      runtime: runtimeWithDiscoveredProbePaths,
      preset,
      localProviderIds,
      capabilities: capabilityStatus,
      defaults: defaultPaths,
      readiness: AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.needsModel,
      nextAction: capabilities.speechTranscriptionModelDownloadCommandReady
        ? AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_NEXT_ACTION.initialize
        : AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_NEXT_ACTION.downloadModel,
      executablePath,
      executableSourceKind: probe.sourceKind,
      modelPath,
      diagnostics,
      executableReady,
      modelReady,
      testReady,
      ...createAutoCutSpeechTranscriptionGpuProbeParams(probe),
    });
  }

  return createAutoCutLocalSpeechTranscriptionSetupStatus({
    runtime: runtimeWithDiscoveredProbePaths,
    preset,
    localProviderIds,
    capabilities: capabilityStatus,
    defaults: defaultPaths,
    readiness: testReady
      ? AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.ready
      : AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.needsTest,
    nextAction: testReady
      ? AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_NEXT_ACTION.none
      : AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_NEXT_ACTION.testProvider,
    executablePath,
    executableSourceKind: probe.sourceKind,
    modelPath,
    diagnostics,
    executableReady,
    modelReady,
    testReady,
    ...createAutoCutSpeechTranscriptionGpuProbeParams(probe),
  });
}

export async function initializeAutoCutLocalSpeechTranscriptionSetup():
  Promise<AutoCutLocalSpeechTranscriptionSetupInitializationResult> {
  if (inFlightAutoCutLocalSpeechTranscriptionSetupInitialization) {
    return await inFlightAutoCutLocalSpeechTranscriptionSetupInitialization;
  }

  const initialization = runAutoCutLocalSpeechTranscriptionSetupInitialization();
  inFlightAutoCutLocalSpeechTranscriptionSetupInitialization = initialization;
  try {
    return await initialization;
  } finally {
    if (inFlightAutoCutLocalSpeechTranscriptionSetupInitialization === initialization) {
      inFlightAutoCutLocalSpeechTranscriptionSetupInitialization = null;
    }
  }
}

async function runAutoCutLocalSpeechTranscriptionSetupInitialization():
  Promise<AutoCutLocalSpeechTranscriptionSetupInitializationResult> {
  const initialStatus = await resolveInitialAutoCutLocalSpeechTranscriptionSetupStatus();
  if (initialStatus.readiness === AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.ready) {
    return {
      status: initialStatus,
      settings: await getAutoCutSettings(),
    };
  }
  if (
    initialStatus.readiness === AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.unsupported ||
    initialStatus.readiness === AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.failed
  ) {
    throw new Error(initialStatus.diagnostics[0] ?? 'AutoCut local speech-to-text setup cannot be initialized in this runtime.');
  }
  if (!initialStatus.capabilities.modelDownloadReady && !initialStatus.model.ready) {
    downloadAutoCutLocalSpeechTranscriptionModelPreset(initialStatus.model.preset);
    throw new Error(createAutoCutLocalSpeechTranscriptionSetupGuidance(
      'AutoCut desktop host cannot auto-install the local speech-to-text model.',
      false,
      initialStatus,
    ));
  }
  let runtime = await persistAutoCutLocalSpeechTranscriptionProbePaths(
    await resolveAutoCutSpeechTranscriptionProviderRuntimeConfig(),
    {
      ready: false,
      executableReady: initialStatus.executable.ready,
      modelReady: initialStatus.model.ready,
      executablePath: initialStatus.executable.path,
      modelPath: initialStatus.model.path,
      sourceKind: initialStatus.executable.sourceKind,
      diagnostics: initialStatus.diagnostics,
    },
  );
  let modelSetup: AutoCutLocalSpeechTranscriptionModelSetupResult | undefined;

  if (!initialStatus.model.ready) {
    modelSetup = await setupAutoCutLocalSpeechTranscriptionModelPreset(initialStatus.model.preset.id);
    const refreshedRuntime = await resolveAutoCutSpeechTranscriptionProviderRuntimeConfig();
    runtime = refreshedRuntime;
  }

  const probe = await probeAutoCutLocalSpeechTranscriptionExecution(runtime);
  const runtimeWithProbePaths = await persistAutoCutLocalSpeechTranscriptionProbePaths(runtime, probe);
  if (!probe.ready) {
    markAutoCutSpeechTranscriptionProviderTested(
      createAutoCutLocalSpeechTranscriptionProviderProbe(runtimeWithProbePaths, probe),
    );
    const latestStatus = await inspectAutoCutLocalSpeechTranscriptionSetupStatus().catch(() => initialStatus);
    throw new Error(createAutoCutLocalSpeechTranscriptionSetupGuidance(
      createAutoCutLocalSpeechTranscriptionInitializationFailureReason(probe, latestStatus),
      initialStatus.capabilities.modelDownloadReady,
      latestStatus,
    ));
  }

  const verifiedExecutablePath = probe.executablePath?.trim() || runtimeWithProbePaths.executablePath;
  const verifiedModelPath = probe.modelPath?.trim() || runtimeWithProbePaths.modelPath;
  await saveAutoCutSpeechTranscriptionSettings({
    ...runtimeWithProbePaths,
    executablePath: verifiedExecutablePath,
    modelPath: verifiedModelPath,
  });
  const verifiedRuntime = await resolveAutoCutSpeechTranscriptionProviderRuntimeConfig();
  markAutoCutSpeechTranscriptionProviderTested(
    createAutoCutLocalSpeechTranscriptionProviderProbe(verifiedRuntime, probe),
  );

  const finalCapabilities = createAutoCutLocalSpeechTranscriptionCapabilityStatus(
    await getAutoCutNativeHostClient().getCapabilities(),
  );
  const finalDefaults = createAutoCutLocalSpeechTranscriptionDefaultPathsFromProbe(
    await createAutoCutLocalSpeechTranscriptionDefaultPaths(initialStatus.model.preset),
    probe,
  );
  const finalStatus = createAutoCutLocalSpeechTranscriptionSetupStatus({
    runtime: verifiedRuntime,
    preset: initialStatus.model.preset,
    localProviderIds: initialStatus.localProviderIds,
    capabilities: finalCapabilities,
    defaults: finalDefaults,
    readiness: AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.ready,
    nextAction: AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_NEXT_ACTION.none,
    executablePath: verifiedExecutablePath,
    executableSourceKind: probe.sourceKind,
    modelPath: verifiedModelPath,
    diagnostics: probe.diagnostics,
    executableReady: probe.executableReady ?? true,
    modelReady: probe.modelReady ?? true,
    testReady: true,
    ...createAutoCutSpeechTranscriptionGpuProbeParams(probe),
  });
  lastAutoCutLocalSpeechTranscriptionSetupStatus = finalStatus;

  return {
    status: finalStatus,
    settings: await getAutoCutSettings(),
    ...(modelSetup ? { modelSetup } : {}),
  };
}

async function resolveInitialAutoCutLocalSpeechTranscriptionSetupStatus() {
  const runtime = await resolveAutoCutSpeechTranscriptionProviderRuntimeConfig();
  if (
    lastAutoCutLocalSpeechTranscriptionSetupStatus &&
    await isAutoCutLocalSpeechTranscriptionSetupStatusCompatibleWithRuntimeAndHost(
      lastAutoCutLocalSpeechTranscriptionSetupStatus,
      runtime,
    )
  ) {
    return lastAutoCutLocalSpeechTranscriptionSetupStatus;
  }

  return inspectAutoCutLocalSpeechTranscriptionSetup();
}

export function configureAutoCutSpeechTranscriptionProviderBridge(
  bridge: AutoCutSpeechTranscriptionProviderBridge | null,
) {
  configuredSpeechTranscriptionProviderBridge = bridge;
}

export async function resolveAutoCutSpeechTranscriptionProviderRuntimeConfig():
  Promise<AutoCutSpeechTranscriptionProviderRuntimeConfig> {
  const settings = await resolveAutoCutSpeechTranscriptionRuntimeConfig();
  return resolveAutoCutSpeechTranscriptionProviderRuntimeConfigFromSettings(settings);
}

async function resolveAutoCutSpeechTranscriptionProviderRuntimeConfigForProvider(
  providerId: AutoCutSpeechTranscriptionProviderId,
): Promise<AutoCutSpeechTranscriptionProviderRuntimeConfig> {
  const settings = await resolveAutoCutSpeechTranscriptionRuntimeConfig();
  const provider = resolveAutoCutSpeechTranscriptionProviderDefinition(providerId);
  if (provider.kind === 'api') {
    const providerModelVendor = provider.modelVendor ?? settings.modelVendor ?? 'custom';
    const providerDefaultModel = 'defaultModel' in provider ? provider.defaultModel : undefined;
    const apiSettings: AutoCutSpeechTranscriptionSettings = {
      providerId: provider.id,
      executablePath: '',
      modelPath: '',
      language: settings.language,
      modelVendor: providerModelVendor,
      baseUrl: providerModelVendor === 'custom'
        ? settings.baseUrl ?? ''
        : AUTOCUT_MODEL_VENDOR_PRESETS[providerModelVendor].baseUrl,
      model: providerDefaultModel ?? settings.model ?? AUTOCUT_MODEL_VENDOR_PRESETS[providerModelVendor].defaultModel,
      ...(settings.providerId === provider.id && settings.providerOptions ? { providerOptions: settings.providerOptions } : {}),
      apiKeyConfigured: settings.providerId === provider.id && settings.apiKeyConfigured === true,
      configured: false,
    };
    return resolveAutoCutSpeechTranscriptionProviderRuntimeConfigFromSettings(
      sanitizeRuntimeSpeechTranscriptionSettings(apiSettings),
    );
  }

  return resolveAutoCutSpeechTranscriptionProviderRuntimeConfigFromSettings({
    ...settings,
    providerId: provider.id,
  });
}

function sanitizeRuntimeSpeechTranscriptionSettings(
  settings: Partial<AutoCutSpeechTranscriptionSettings> & Pick<AutoCutSpeechTranscriptionSettings, 'providerId' | 'language'>,
): AutoCutSpeechTranscriptionSettings {
  const provider = getAutoCutSpeechTranscriptionProviderDefinition(settings.providerId);
  return {
    providerId: provider.id,
    executablePath: provider.kind === 'local' ? settings.executablePath ?? '' : '',
    modelPath: provider.kind === 'local' ? settings.modelPath ?? '' : '',
    language: settings.language ?? 'auto',
    ...(provider.kind === 'api'
      ? {
          modelVendor: settings.modelVendor ?? provider.modelVendor ?? 'custom',
          baseUrl: settings.baseUrl ?? '',
          model: settings.model ?? provider.defaultModel,
          providerOptions: settings.providerOptions ?? createAutoCutSpeechTranscriptionProviderDefaultOptions(provider),
          apiKeyConfigured: settings.apiKeyConfigured === true,
        }
      : {}),
    configured: settings.configured === true,
    ...(settings.lastTestedAt ? { lastTestedAt: settings.lastTestedAt } : {}),
    ...(typeof settings.lastProbeReady === 'boolean' ? { lastProbeReady: settings.lastProbeReady } : {}),
    ...(settings.lastProbeDiagnostics ? { lastProbeDiagnostics: settings.lastProbeDiagnostics } : {}),
  };
}

async function resolveAutoCutSpeechTranscriptionProviderRuntimeConfigFromSettings(
  settings: AutoCutSpeechTranscriptionSettings,
): Promise<AutoCutSpeechTranscriptionProviderRuntimeConfig> {
  const provider = resolveAutoCutSpeechTranscriptionProviderDefinition(settings.providerId);
  if (provider.kind === 'api') {
    const modelVendorRuntime = await resolveAutoCutLlmRuntimeConfig();
    const isMatchingRuntime = modelVendorRuntime.modelVendor === settings.modelVendor;
    return {
      ...settings,
      provider,
      ...(isMatchingRuntime ? { modelVendorRuntime } : {}),
      ...(isMatchingRuntime && modelVendorRuntime.sessionApiKey ? { sessionApiKey: modelVendorRuntime.sessionApiKey } : {}),
      baseUrl: settings.baseUrl || modelVendorRuntime.baseUrl,
      apiKeyConfigured: Boolean(isMatchingRuntime && modelVendorRuntime.apiKeyConfigured),
      configured: Boolean(isMatchingRuntime && modelVendorRuntime.apiKeyConfigured),
      providerOptions: settings.providerOptions ?? createAutoCutSpeechTranscriptionProviderDefaultOptions(provider),
      requestFormat: 'autocut-speech-transcription-provider',
    };
  }

  return {
    ...settings,
    provider,
    requestFormat: 'autocut-speech-transcription-provider',
  };
}

export async function transcribeAutoCutMediaWithConfiguredProvider(
  request: AutoCutSpeechTranscriptionRequest,
): Promise<AutoCutSpeechTranscriptionResult & {
  providerId: AutoCutSpeechTranscriptionProviderRuntimeConfig['providerId'];
  sttPresetId?: string;
  executionProfile?: string;
  standardTranscript?: AutoCutSmartSliceTranscript;
}> {
  validateAutoCutSpeechTranscriptionRequest(request);
  const workflowPreset = request.sttPresetId
    ? resolveAutoCutSpeechTranscriptionWorkflowPreset(request.sttPresetId)
    : undefined;
  const runtime = workflowPreset
    ? await resolveAutoCutSpeechTranscriptionProviderRuntimeConfigForProvider(workflowPreset.providerId)
    : await resolveAutoCutSpeechTranscriptionProviderRuntimeConfig();
  if (runtime.provider.kind === 'local') {
    return transcribeAutoCutMediaWithLocalProvider(request, runtime, workflowPreset);
  }
  if (runtime.provider.kind === 'api') {
    return transcribeAutoCutMediaWithApiProvider(request, runtime, workflowPreset);
  }

  throw new Error(`AutoCut speech transcription provider ${runtime.providerId} is not supported.`);
}

export async function testAutoCutSpeechTranscriptionProvider():
  Promise<AutoCutSpeechTranscriptionProviderTestResult> {
  const runtime = await resolveAutoCutSpeechTranscriptionProviderRuntimeConfig();
  let probe: AutoCutSpeechTranscriptionProviderTestResult;
  if (runtime.provider.kind === 'local') {
    probe = await testAutoCutLocalSpeechTranscriptionProvider(runtime);
  } else if (runtime.provider.kind === 'api') {
    if (!runtime.configured) {
      throw new Error(
        createAutoCutApiSpeechTranscriptionSetupGuidance(runtime),
      );
    }
    if (!configuredSpeechTranscriptionProviderBridge?.test) {
      throw new Error(
        'AutoCut API speech transcription test requires a configured speech transcription provider bridge.',
      );
    }
    probe = await configuredSpeechTranscriptionProviderBridge.test(runtime);
  } else {
    throw new Error(`AutoCut speech transcription provider ${runtime.providerId} is not supported.`);
  }

  markAutoCutSpeechTranscriptionProviderTested(probe);
  if (!probe.ready) {
    throw new Error(probe.diagnostics[0] ?? 'AutoCut speech-to-text provider is not ready.');
  }

  return probe;
}

async function transcribeAutoCutMediaWithLocalProvider(
  request: AutoCutSpeechTranscriptionRequest,
  runtime: AutoCutSpeechTranscriptionProviderRuntimeConfig,
  workflowPreset?: AutoCutSpeechTranscriptionWorkflowPreset,
) {
  const nativeHostClient = getAutoCutNativeHostClient();
  const readyRuntime = await ensureAutoCutLocalSpeechTranscriptionExecutionReady(runtime);
  if (workflowPreset?.executionProfile === 'gpu') {
    const probe = await probeAutoCutLocalSpeechTranscriptionExecution(readyRuntime);
    if (!probe.gpuReady) {
      const diagnostic = probe.gpuDiagnostics?.[0] ??
        'AutoCut GPU local STT requires a GPU-enabled whisper.cpp runtime. The current local whisper-cli appears to be CPU-only.';
      throw new Error(
        `${diagnostic} Select a CUDA, Vulkan, Metal, Core ML, or OpenVINO enabled whisper-cli in Settings > Speech-to-Text, then run provider test again.`,
      );
    }
  }

  const result = await nativeHostClient.transcribeMedia({
    ...request,
    providerId: readyRuntime.providerId,
    language: request.language ?? readyRuntime.language,
    executablePath: readyRuntime.executablePath,
    modelPath: readyRuntime.modelPath,
    ...(workflowPreset
      ? {
          sttPresetId: workflowPreset.id,
          sttExecutionProfile: workflowPreset.executionProfile,
          ...(workflowPreset.localWhisper
            ? {
                whisperChunkParallelism: workflowPreset.localWhisper.chunkParallelism,
                whisperChunkThreadCount: workflowPreset.localWhisper.chunkThreadCount,
                whisperChunkSourceStrategy: workflowPreset.localWhisper.chunkSourceStrategy,
                ...(workflowPreset.localWhisper.decode?.audioContext !== undefined
                  ? { whisperAudioContext: workflowPreset.localWhisper.decode.audioContext }
                  : {}),
                ...(workflowPreset.localWhisper.decode?.beamSize !== undefined
                  ? { whisperBeamSize: workflowPreset.localWhisper.decode.beamSize }
                  : {}),
                ...(workflowPreset.localWhisper.decode?.bestOf !== undefined
                  ? { whisperBestOf: workflowPreset.localWhisper.decode.bestOf }
                  : {}),
                ...(workflowPreset.localWhisper.decode?.noFallback !== undefined
                  ? { whisperNoFallback: workflowPreset.localWhisper.decode.noFallback }
                  : {}),
              }
            : {}),
        }
      : {}),
  });

  return {
    ...normalizeAutoCutSpeechTranscriptionResult(result, request, readyRuntime),
    providerId: readyRuntime.providerId,
    ...(workflowPreset
      ? {
          sttPresetId: workflowPreset.id,
          executionProfile: workflowPreset.executionProfile,
        }
      : {}),
  };
}

async function transcribeAutoCutMediaWithApiProvider(
  request: AutoCutSpeechTranscriptionRequest,
  runtime: AutoCutSpeechTranscriptionProviderRuntimeConfig,
  workflowPreset?: AutoCutSpeechTranscriptionWorkflowPreset,
) {
  if (!runtime.configured) {
    throw new Error(createAutoCutApiSpeechTranscriptionSetupGuidance(runtime));
  }
  if (!configuredSpeechTranscriptionProviderBridge) {
    throw new Error(
      `AutoCut API speech transcription requires a configured speech transcription provider bridge for provider ${runtime.providerId}. Restart the desktop app or switch to the default local offline Whisper provider.`,
    );
  }

  const result = await configuredSpeechTranscriptionProviderBridge.transcribe(
    {
      ...request,
      providerId: runtime.providerId,
      language: request.language ?? runtime.language,
      ...(workflowPreset
        ? {
            sttPresetId: workflowPreset.id,
            sttExecutionProfile: workflowPreset.executionProfile,
          }
        : {}),
    },
    runtime,
  );

  return {
    ...normalizeAutoCutSpeechTranscriptionResult(result, request, runtime),
    providerId: runtime.providerId,
    ...(workflowPreset
      ? {
          sttPresetId: workflowPreset.id,
          executionProfile: workflowPreset.executionProfile,
        }
      : {}),
  };
}

async function ensureAutoCutLocalSpeechTranscriptionExecutionReady(
  runtime: AutoCutSpeechTranscriptionProviderRuntimeConfig,
): Promise<AutoCutSpeechTranscriptionProviderRuntimeConfig> {
  if (runtime.provider.kind !== 'local' || runtime.provider.engine !== 'whisper-cli') {
    throw new Error(
      `AutoCut local speech-to-text provider ${runtime.providerId} is not supported by the desktop runtime. Select Local Whisper CLI or configure a supported API speech-to-text provider.`,
    );
  }

  const nativeHostClient = getAutoCutNativeHostClient();
  const capabilities = await nativeHostClient.getCapabilities();
  if (!capabilities.speechTranscriptionCommandReady) {
    throw new Error(createAutoCutLocalSpeechTranscriptionSetupGuidance(
      'AutoCut desktop host speech-to-text execution is required before transcript-assisted workflows can run.',
      capabilities.speechTranscriptionModelDownloadCommandReady,
      undefined,
    ));
  }
  if (!capabilities.speechTranscriptionProbeCommandReady) {
    throw new Error(createAutoCutLocalSpeechTranscriptionSetupGuidance(
      'AutoCut desktop host speech-to-text validation is required before transcription so model availability and integrity can be checked.',
      capabilities.speechTranscriptionModelDownloadCommandReady,
      undefined,
    ));
  }

  if (runtime.executablePath && !runtime.modelPath && capabilities.speechTranscriptionModelDownloadCommandReady) {
    return initializeAutoCutLocalSpeechTranscriptionModelForExecution(runtime, capabilities.speechTranscriptionModelDownloadCommandReady);
  }

  const firstProbe = await probeAutoCutLocalSpeechTranscriptionExecution(runtime);
  const runtimeWithProbePaths = await persistAutoCutLocalSpeechTranscriptionProbePaths(runtime, firstProbe);
  if (firstProbe.ready) {
    markAutoCutSpeechTranscriptionProviderTested(createAutoCutLocalSpeechTranscriptionProviderProbe(runtimeWithProbePaths, firstProbe));
    return runtimeWithProbePaths;
  }

  if (!runtime.executablePath && !firstProbe.executablePath && !capabilities.speechTranscriptionToolchainReady) {
    const error = new Error(createAutoCutLocalSpeechTranscriptionSetupGuidance(
      firstProbe.diagnostics[0] ??
        'AutoCut local speech-to-text executablePath is not configured. AutoCut checked Settings, SDKWORK_AUTOCUT_WHISPER_EXECUTABLE, verified bundled sidecar, PATH, and common local installation directories, but did not find a usable whisper-cli executable.',
      capabilities.speechTranscriptionModelDownloadCommandReady,
      undefined,
    ));
    reportAutoCutDiagnostic(
      'error',
      'speech-transcription',
      'Local speech-to-text executable is missing',
      error,
    );
    throw error;
  }

  if (runtimeWithProbePaths.executablePath && !runtimeWithProbePaths.modelPath && capabilities.speechTranscriptionModelDownloadCommandReady) {
    return initializeAutoCutLocalSpeechTranscriptionModelForExecution(
      runtimeWithProbePaths,
      capabilities.speechTranscriptionModelDownloadCommandReady,
    );
  }

  if (runtime.configured && runtime.lastProbeReady !== true) {
    const error = new Error(createAutoCutLocalSpeechTranscriptionSetupGuidance(
      firstProbe.diagnostics[0] ??
        'AutoCut local speech-to-text settings must pass validation before transcription. Run the speech-to-text provider test after selecting executablePath and modelPath.',
      capabilities.speechTranscriptionModelDownloadCommandReady,
      undefined,
    ));
    reportAutoCutDiagnostic(
      'error',
      'speech-transcription',
      'Local speech-to-text provider test is required',
      error,
    );
    throw error;
  }

  markAutoCutSpeechTranscriptionProviderTested(createAutoCutLocalSpeechTranscriptionProviderProbe(runtimeWithProbePaths, firstProbe));
  throw new Error(createAutoCutLocalSpeechTranscriptionSetupGuidance(
    firstProbe.diagnostics[0] ?? 'AutoCut local speech-to-text model is missing or incomplete.',
    capabilities.speechTranscriptionModelDownloadCommandReady,
    undefined,
  ));
}

async function initializeAutoCutLocalSpeechTranscriptionModelForExecution(
  runtime: AutoCutSpeechTranscriptionProviderRuntimeConfig,
  nativeModelDownloadAvailable: boolean,
): Promise<AutoCutSpeechTranscriptionProviderRuntimeConfig> {
  reportAutoCutDiagnostic(
    'warning',
    'speech-transcription',
    'Local speech-to-text model initialization started',
    {
      providerId: runtime.providerId,
    },
  );
  const preset = resolveAutoCutRecommendedLocalSpeechTranscriptionModelPreset(runtime.providerId);
  const setup = await setupAutoCutLocalSpeechTranscriptionModelPresetForRuntime(runtime, preset);
  const initializedRuntime = await resolveAutoCutSpeechTranscriptionProviderRuntimeConfigForProvider(runtime.providerId);
  const initializedProbe = await probeAutoCutLocalSpeechTranscriptionExecution(initializedRuntime);
  const initializedRuntimeWithProbePaths = await persistAutoCutLocalSpeechTranscriptionProbePaths(
    initializedRuntime,
    initializedProbe,
  );
  markAutoCutSpeechTranscriptionProviderTested(
    createAutoCutLocalSpeechTranscriptionProviderProbe(initializedRuntimeWithProbePaths, initializedProbe),
  );
  if (!initializedProbe.ready) {
    throw new Error(createAutoCutLocalSpeechTranscriptionSetupGuidance(
      initializedProbe.diagnostics[0] ?? `AutoCut local speech-to-text model ${setup.preset.label} is missing or incomplete after initialization.`,
      nativeModelDownloadAvailable,
      undefined,
    ));
  }
  reportAutoCutDiagnostic(
    'warning',
    'speech-transcription',
    'Local speech-to-text model initialization completed',
    {
      providerId: initializedRuntimeWithProbePaths.providerId,
      modelPath: initializedRuntimeWithProbePaths.modelPath,
    },
  );
  return initializedRuntimeWithProbePaths;
}

async function probeAutoCutLocalSpeechTranscriptionExecution(
  runtime: AutoCutSpeechTranscriptionProviderRuntimeConfig,
) {
  const nativeHostClient = getAutoCutNativeHostClient();
  const outputRootDir = await resolveAutoCutOutputRootDir();
  return nativeHostClient.probeSpeechTranscription({
    providerId: runtime.providerId,
    sourceKind: 'execution-preflight',
    ...(outputRootDir ? { outputRootDir } : {}),
    ...(runtime.executablePath ? { executablePath: runtime.executablePath } : {}),
    ...(runtime.modelPath ? { modelPath: runtime.modelPath } : {}),
  });
}

function createAutoCutLocalSpeechTranscriptionProviderProbe(
  runtime: AutoCutSpeechTranscriptionProviderRuntimeConfig,
  probe: AutoCutSpeechTranscriptionProbe,
): AutoCutSpeechTranscriptionProviderTestResult {
  return {
    ...probe,
    ready: probe.ready,
    providerId: runtime.providerId,
    sourceKind: probe.sourceKind,
    diagnostics: [...probe.diagnostics, ...(probe.gpuDiagnostics ?? [])],
  };
}

function getAutoCutExecutableLocalSpeechTranscriptionProviderIds(): AutoCutSpeechTranscriptionProviderId[] {
  return AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER_DEFINITIONS
    .filter((provider) => provider.kind === 'local' && provider.engine === 'whisper-cli')
    .map((provider) => provider.id);
}

function createAutoCutLocalSpeechTranscriptionCapabilityStatus(capabilities: {
  speechTranscriptionCommandReady?: boolean;
  speechTranscriptionProbeCommandReady?: boolean;
  speechTranscriptionToolchainReady?: boolean;
  speechTranscriptionModelDownloadCommandReady?: boolean;
  speechTranscriptionExecutableDownloadCommandReady?: boolean;
}): AutoCutLocalSpeechTranscriptionSetupStatus['capabilities'] {
  return {
    commandReady: capabilities.speechTranscriptionCommandReady === true,
    probeReady: capabilities.speechTranscriptionProbeCommandReady === true,
    toolchainReady: capabilities.speechTranscriptionToolchainReady === true,
    modelDownloadReady: capabilities.speechTranscriptionModelDownloadCommandReady === true,
    executableDownloadReady: false,
  };
}

async function createAutoCutLocalSpeechTranscriptionDefaultPaths(
  preset: AutoCutLocalSpeechTranscriptionModelPreset,
): Promise<AutoCutLocalSpeechTranscriptionSetupStatus['defaults']> {
  const outputRootDir = await resolveAutoCutOutputRootDir();
  const normalizedOutputRoot = outputRootDir?.trim() ?? '';
  const modelDirectory = normalizedOutputRoot
    ? `${normalizedOutputRoot.replace(/[\\/]+$/u, '')}/${AUTOCUT_LOCAL_SPEECH_TRANSCRIPTION_MODEL_SUBDIRECTORY}`
    : `${AUTOCUT_LOCAL_SPEECH_TRANSCRIPTION_DEFAULT_MODEL_ROOT}/${AUTOCUT_LOCAL_SPEECH_TRANSCRIPTION_MODEL_SUBDIRECTORY}`;
  const defaultExecutablePlatform = resolveAutoCutCurrentSpeechTranscriptionExecutablePlatform();
  const defaultExecutableDirectory =
    `${AUTOCUT_LOCAL_SPEECH_TRANSCRIPTION_DEFAULT_EXECUTABLE_ROOT}/${AUTOCUT_LOCAL_SPEECH_TRANSCRIPTION_EXECUTABLE_RESOURCE_SUBDIRECTORY}/${defaultExecutablePlatform}`;
  const defaultExecutableBinary = defaultExecutablePlatform === 'windows-x86_64'
    ? `${AUTOCUT_LOCAL_SPEECH_TRANSCRIPTION_EXECUTABLE_BINARY}.exe`
    : AUTOCUT_LOCAL_SPEECH_TRANSCRIPTION_EXECUTABLE_BINARY;

  return {
    executableDirectory: defaultExecutableDirectory,
    executablePath: `${defaultExecutableDirectory}/${defaultExecutableBinary}`,
    modelDirectory,
    modelPath: `${modelDirectory}/${preset.fileName}`,
    executableStrategy: 'Settings executablePath > SDKWORK_AUTOCUT_WHISPER_EXECUTABLE > verified bundled sidecar > PATH/Homebrew/apt/common local whisper-cli',
  };
}

function createAutoCutLocalSpeechTranscriptionDefaultPathsFromProbe(
  current: AutoCutLocalSpeechTranscriptionSetupStatus['defaults'],
  probe: AutoCutSpeechTranscriptionProbe,
): AutoCutLocalSpeechTranscriptionSetupStatus['defaults'] {
  const defaultModelDirectory = probe.defaultModelDirectory?.trim();
  const defaultModelPath = probe.defaultModelPath?.trim();
  const defaultExecutableDirectory = probe.defaultExecutableDirectory?.trim();
  const defaultExecutablePath = probe.defaultExecutablePath?.trim();
  return {
    executableDirectory: defaultExecutableDirectory || current.executableDirectory,
    executablePath: defaultExecutablePath || current.executablePath,
    modelDirectory: defaultModelDirectory || current.modelDirectory,
    modelPath: defaultModelPath || current.modelPath,
    executableStrategy: probe.executableStrategy?.trim() || current.executableStrategy,
  };
}

function createAutoCutLocalSpeechTranscriptionSetupStatus(params: {
  runtime: AutoCutSpeechTranscriptionProviderRuntimeConfig;
  preset: AutoCutLocalSpeechTranscriptionModelPreset;
  localProviderIds: AutoCutSpeechTranscriptionProviderId[];
  capabilities: AutoCutLocalSpeechTranscriptionSetupStatus['capabilities'];
  defaults: AutoCutLocalSpeechTranscriptionSetupStatus['defaults'];
  readiness: AutoCutLocalSpeechTranscriptionSetupReadiness;
  nextAction: AutoCutLocalSpeechTranscriptionSetupNextAction;
  executablePath: string;
  executableSourceKind: string;
  modelPath: string;
  diagnostics: string[];
  executableReady?: boolean;
  modelReady?: boolean;
  testReady?: boolean;
  gpuReady?: boolean;
  gpuBackend?: string;
  gpuDiagnostics?: string[];
}): AutoCutLocalSpeechTranscriptionSetupStatus {
  const executablePath = params.executablePath.trim();
  const modelPath = params.modelPath.trim();
  const gpuDiagnostics = [
    ...(params.gpuDiagnostics ?? []),
    ...(params.runtime.lastProbeDiagnostics?.filter((diagnostic) =>
      diagnostic.toLowerCase().includes('gpu') ||
      diagnostic.toLowerCase().includes('cuda') ||
      diagnostic.toLowerCase().includes('vulkan') ||
      diagnostic.toLowerCase().includes('metal') ||
      diagnostic.toLowerCase().includes('openvino') ||
      diagnostic.toLowerCase().includes('core ml') ||
      diagnostic.toLowerCase().includes('coreml')
    ) ?? []),
  ].filter((diagnostic, index, diagnostics) => diagnostic && diagnostics.indexOf(diagnostic) === index);
  return {
    providerId: params.runtime.providerId,
    localProviderIds: params.localProviderIds,
    readiness: params.readiness,
    nextAction: params.nextAction,
    executable: {
      ready: params.executableReady ?? Boolean(executablePath),
      path: executablePath,
      sourceKind: params.executableSourceKind || (executablePath ? 'settings' : 'missing'),
    },
    model: {
      ready: params.modelReady ?? Boolean(modelPath),
      path: modelPath,
      preset: params.preset,
    },
    test: {
      ready: params.testReady ?? params.runtime.lastProbeReady === true,
      ...(params.runtime.lastTestedAt ? { lastTestedAt: params.runtime.lastTestedAt } : {}),
    },
    gpu: {
      ready: params.gpuReady === true,
      ...(params.gpuBackend ? { backend: params.gpuBackend } : {}),
      diagnostics: gpuDiagnostics,
    },
    capabilities: params.capabilities,
    defaults: params.defaults,
    diagnostics: params.diagnostics.filter(Boolean),
  };
}

function isAutoCutLocalSpeechTranscriptionSetupStatusCompatibleWithRuntime(
  status: AutoCutLocalSpeechTranscriptionSetupStatus,
  runtime: AutoCutSpeechTranscriptionProviderRuntimeConfig,
) {
  return runtime.provider.kind === 'local' &&
    status.providerId === runtime.providerId &&
    (!runtime.executablePath || status.executable.path === runtime.executablePath) &&
    status.model.path === runtime.modelPath;
}

async function isAutoCutLocalSpeechTranscriptionSetupStatusCompatibleWithRuntimeAndHost(
  status: AutoCutLocalSpeechTranscriptionSetupStatus,
  runtime: AutoCutSpeechTranscriptionProviderRuntimeConfig,
) {
  if (!isAutoCutLocalSpeechTranscriptionSetupStatusCompatibleWithRuntime(status, runtime)) {
    return false;
  }

  const nativeHostClient = getAutoCutNativeHostClient();
  const capabilities = await nativeHostClient.getCapabilities();
  const currentCapabilities = createAutoCutLocalSpeechTranscriptionCapabilityStatus(capabilities);
  currentCapabilities.executableDownloadReady = false;

  return areAutoCutLocalSpeechTranscriptionSetupCapabilitiesEqual(
    status.capabilities,
    currentCapabilities,
  );
}

function areAutoCutLocalSpeechTranscriptionSetupCapabilitiesEqual(
  left: AutoCutLocalSpeechTranscriptionSetupStatus['capabilities'],
  right: AutoCutLocalSpeechTranscriptionSetupStatus['capabilities'],
) {
  return left.commandReady === right.commandReady &&
    left.probeReady === right.probeReady &&
    left.toolchainReady === right.toolchainReady &&
    left.modelDownloadReady === right.modelDownloadReady &&
    left.executableDownloadReady === right.executableDownloadReady;
}

async function persistAutoCutLocalSpeechTranscriptionProbePaths(
  runtime: AutoCutSpeechTranscriptionProviderRuntimeConfig,
  probe: AutoCutSpeechTranscriptionProbe,
): Promise<AutoCutSpeechTranscriptionProviderRuntimeConfig> {
  const executablePath = probe.executableReady !== false
    ? probe.executablePath?.trim() || runtime.executablePath
    : runtime.executablePath;
  const modelPath = probe.modelReady !== false
    ? probe.modelPath?.trim() || runtime.modelPath
    : runtime.modelPath;
  if (executablePath === runtime.executablePath && modelPath === runtime.modelPath) {
    return runtime;
  }

  await saveAutoCutSpeechTranscriptionSettings({
    ...runtime,
    executablePath,
    modelPath,
  });
  clearAutoCutLocalSpeechTranscriptionSetupStatusCache();
  return resolveAutoCutSpeechTranscriptionProviderRuntimeConfig();
}

async function testAutoCutLocalSpeechTranscriptionProvider(
  runtime: AutoCutSpeechTranscriptionProviderRuntimeConfig,
): Promise<AutoCutSpeechTranscriptionProviderTestResult> {
  if (!runtime.configured) {
    throw new Error('AutoCut local speech-to-text requires both executablePath and modelPath.');
  }

  const nativeHostClient = getAutoCutNativeHostClient();
  const capabilities = await nativeHostClient.getCapabilities();
  if (!capabilities.speechTranscriptionProbeCommandReady) {
    throw new Error('AutoCut local speech-to-text test requires the Tauri desktop host.');
  }

  const probe = await nativeHostClient.probeSpeechTranscription({
    providerId: runtime.providerId,
    executablePath: runtime.executablePath,
    modelPath: runtime.modelPath,
    sourceKind: 'settings',
  });

  return {
    ...probe,
    ready: probe.ready,
    providerId: runtime.providerId,
    sourceKind: probe.sourceKind,
    diagnostics: [...probe.diagnostics, ...(probe.gpuDiagnostics ?? [])],
  };
}

function resolveAutoCutSpeechTranscriptionProviderDefinition(
  providerId: AutoCutSpeechTranscriptionSettings['providerId'],
) {
  return AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER_DEFINITIONS.find((provider) => provider.id === providerId) ??
    AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER_DEFINITIONS[0];
}

function validateAutoCutLocalSpeechTranscriptionModelPreset(
  preset: AutoCutLocalSpeechTranscriptionModelPreset,
) {
  const provider = resolveAutoCutSpeechTranscriptionProviderDefinition(preset.providerId);
  if (provider.kind !== 'local') {
    throw new Error('AutoCut local speech-to-text model preset must target a local speech-to-text provider.');
  }
  if (preset.engine !== provider.engine) {
    throw new Error('AutoCut local speech-to-text model preset must use an implemented local speech-to-text engine.');
  }
  if (!preset.fileName.trim() || /[\\/]/u.test(preset.fileName)) {
    throw new Error('AutoCut local speech-to-text model preset requires a safe model fileName.');
  }
  if (!Number.isFinite(preset.minimumByteSize) || preset.minimumByteSize <= 0) {
    throw new Error('AutoCut local speech-to-text model preset requires a positive minimumByteSize.');
  }
  if (!/^[a-f0-9]{64}$/u.test(preset.sha256)) {
    throw new Error('AutoCut local speech-to-text model preset requires a pinned SHA-256 model digest.');
  }
  if (!AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_EXTENSIONS.some((extension) => preset.fileName.toLowerCase().endsWith(extension))) {
    throw new Error(
      `AutoCut local speech-to-text model preset fileName must use a supported model file extension: ${AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_EXTENSIONS.join(', ')}.`,
    );
  }

  getAutoCutLocalSpeechTranscriptionModelPresetDownloadUrls(preset).forEach((downloadUrl) => {
    validateAutoCutLocalSpeechTranscriptionModelDownloadUrl(downloadUrl, preset.fileName);
  });
}

function getAutoCutLocalSpeechTranscriptionModelPresetDownloadUrls(
  preset: AutoCutLocalSpeechTranscriptionModelPreset,
) {
  return [preset.url, ...(preset.mirrorUrls ?? [])]
    .map((url) => url.trim())
    .filter((url, index, urls) => url && urls.indexOf(url) === index);
}

function isAutoCutLocalSpeechTranscriptionModelPresetDownloadUrl(
  preset: AutoCutLocalSpeechTranscriptionModelPreset,
  sourceUrl: string | undefined,
) {
  const normalizedSourceUrl = sourceUrl?.trim();
  return Boolean(
    normalizedSourceUrl &&
    getAutoCutLocalSpeechTranscriptionModelPresetDownloadUrls(preset).includes(normalizedSourceUrl),
  );
}

function validateAutoCutLocalSpeechTranscriptionModelDownloadUrl(
  downloadUrl: string,
  fileName: string,
) {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(downloadUrl);
  } catch {
    throw new Error('AutoCut local speech-to-text model preset must use a trusted Hugging Face source URL.');
  }
  if (
    parsedUrl.protocol !== 'https:' ||
    !['huggingface.co', 'hf-mirror.com'].includes(parsedUrl.hostname)
  ) {
    throw new Error('AutoCut local speech-to-text model preset must use a trusted Hugging Face source URL.');
  }
  const pathSegments = parsedUrl.pathname.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));
  const urlFileName = pathSegments.at(-1) ?? '';
  if (urlFileName !== fileName) {
    throw new Error('AutoCut local speech-to-text model preset URL file name must match fileName.');
  }
  if (
    pathSegments.length < 5 ||
    pathSegments[0] !== 'ggerganov' ||
    pathSegments[1] !== 'whisper.cpp' ||
    pathSegments[2] !== 'resolve' ||
    pathSegments[3] !== 'main'
  ) {
    throw new Error('AutoCut local speech-to-text model preset must use the trusted ggerganov/whisper.cpp Hugging Face model path.');
  }
}

function validateAutoCutLocalSpeechTranscriptionModelDownloadResult(
  byteSize: number,
  preset: AutoCutLocalSpeechTranscriptionModelPreset,
) {
  if (!Number.isFinite(byteSize) || byteSize < preset.minimumByteSize) {
    throw new Error(
      `The speech recognition model download is incomplete. ${preset.label} should be about ${preset.sizeLabel}. Retry automatic setup, or copy the model download link and select the completed local file in Speech-to-Text settings.`,
    );
  }
}

function normalizeAutoCutSha256Digest(value: string) {
  return value.trim().toLowerCase();
}

export function createAutoCutLocalSpeechTranscriptionDownloadFailureMessage(error: unknown) {
  const rawMessage = error instanceof Error ? error.message : String(error ?? '');
  const message = rawMessage.toLowerCase();
  if (!rawMessage.trim()) {
    return 'The speech recognition model could not be prepared. Check your network connection and retry, or copy the model download link and select the completed local file in Speech-to-Text settings.';
  }

  if (
    message.includes('checksum mismatch') ||
    message.includes('sha-256') ||
    message.includes('digest')
  ) {
    return 'The downloaded speech recognition model did not pass SHA-256 integrity verification. Retry automatic setup; interrupted downloads will resume from the saved partial file, and complete invalid files will be replaced with a verified copy.';
  }

  if (
    message.includes('incomplete') ||
    message.includes('empty file') ||
    message.includes('too small') ||
    message.includes('minimum') ||
    message.includes('content-length') ||
    message.includes('did not finish') ||
    message.includes('preserved partial')
  ) {
    return 'The speech recognition model download did not finish. Retry automatic setup to resume the saved partial download, or copy the model download link and select the completed local file in Speech-to-Text settings.';
  }

  if (
    message.includes('timed out') ||
    message.includes('timeout') ||
    message.includes('network') ||
    message.includes('dns') ||
    message.includes('connection') ||
    message.includes('http status') ||
    message.includes('failed for every trusted source')
  ) {
    return 'The speech recognition model could not be downloaded from the available sources. Check your network connection and retry; if your network blocks the download, copy the model link and import the file manually in Speech-to-Text settings.';
  }

  if (
    message.includes('create autocut speech model directory failed') ||
    message.includes('temp file') ||
    message.includes('write autocut speech transcription model') ||
    message.includes('install autocut speech transcription model') ||
    message.includes('permission') ||
    message.includes('access is denied')
  ) {
    return 'The app could not save the speech recognition model. Check that the output directory is writable, then retry automatic setup.';
  }

  if (
    message.includes('trusted') ||
    message.includes('url') ||
    message.includes('preset') ||
    message.includes('provider')
  ) {
    return 'The speech recognition model source is not valid for this version of the app. Update the app or contact support with the diagnostic log.';
  }

  return 'The speech recognition model could not be prepared. Retry automatic setup, or copy the model download link and select the completed local file in Speech-to-Text settings.';
}

function createAutoCutLocalSpeechTranscriptionSetupGuidance(
  reason: string,
  nativeModelDownloadAvailable: boolean,
  status?: AutoCutLocalSpeechTranscriptionSetupStatus,
) {
  const setupGuidance = nativeModelDownloadAvailable
    ? 'Run automatic setup again from Speech-to-Text settings. The app will reuse the verified model that is already saved, and only download the model again if the saved file is missing or fails integrity verification. You can also choose "Use and download the recommended offline Whisper model" from the model list.'
    : 'Open the desktop app, download the recommended offline model, select the completed local file, then run the availability check again.';
  const modelGuidance = status?.model.ready
    ? 'The offline speech model is already saved; the remaining step is the final availability check.'
    : 'The recommended offline speech model still needs to be saved before Smart Slice can use local recognition.';
  const technicalDetails = status
    ? ` Details: recognition app target ${status.defaults.executablePath || status.defaults.executableDirectory || 'not available'}; model target ${status.defaults.modelPath || status.defaults.modelDirectory || 'not available'}; discovery route ${status.defaults.executableStrategy}.`
    : '';
  return `${reason} ${modelGuidance} ${setupGuidance}${technicalDetails}`;
}

function createAutoCutLocalSpeechTranscriptionInitializationFailureReason(
  probe: AutoCutSpeechTranscriptionProbe,
  status: AutoCutLocalSpeechTranscriptionSetupStatus,
) {
  if (probe.executableReady === false || status.executable.ready === false) {
    const diagnostic = probe.diagnostics[0]?.trim();
    return [
      'Speech recognition needs the local recognition app before Smart Slice can continue.',
      'If the model step just reached 100%, the model is saved; this is the final availability check, not a model download failure.',
      'Select a verified whisper-cli executable in Speech-to-Text settings or use an app build that includes the packaged recognition app.',
      diagnostic ? `Details: ${diagnostic}` : 'Details: AutoCut checked Settings, SDKWORK_AUTOCUT_WHISPER_EXECUTABLE, packaged sidecar, PATH, and common local installation directories.',
      createAutoCutUnsupportedLocalSpeechTranscriptionExecutablePresetReason(status.providerId),
    ].join(' ');
  }

  const diagnostic = probe.diagnostics[0]?.trim();
  return diagnostic
    ? `Speech recognition saved the model, but the final availability check did not pass. Details: ${diagnostic}`
    : 'Speech recognition saved the model, but the final availability check did not pass. Run automatic setup again or open Speech-to-Text settings.';
}

function createAutoCutApiSpeechTranscriptionSetupGuidance(
  runtime: AutoCutSpeechTranscriptionProviderRuntimeConfig,
) {
  const expectedVendor = runtime.provider.modelVendor ?? runtime.modelVendor ?? 'custom';
  if (!runtime.modelVendorRuntime) {
    return `AutoCut speech transcription API key is required for provider ${runtime.providerId}, and the provider requires the matching ModelVendor ${expectedVendor}. Select ${expectedVendor} in Model settings, configure its API key, then test the speech-to-text provider again.`;
  }

  return `AutoCut speech transcription API key is required for provider ${runtime.providerId}. Configure the matching ModelVendor ${expectedVendor} API key before running speech-to-text.`;
}

function validateAutoCutSpeechTranscriptionRequest(request: AutoCutSpeechTranscriptionRequest) {
  if (!request.assetUuid.trim()) {
    throw new Error('AutoCut speech transcription requires assetUuid.');
  }
}

function normalizeAutoCutSpeechTranscriptionResult(
  result: AutoCutSpeechTranscriptionProviderBridgeResult,
  request: AutoCutSpeechTranscriptionRequest,
  runtime: AutoCutSpeechTranscriptionProviderRuntimeConfig,
): AutoCutSpeechTranscriptionResult {
  const normalizedSegments = normalizeAutoCutSpeechTranscriptionSegments(result.segments);
  const segments = request.dedupeRepeatedSpeech
    ? dedupeAutoCutRepeatedSpeechSegments(normalizedSegments)
    : normalizedSegments;
  if (segments.length === 0) {
    throw new Error('AutoCut speech transcription provider must return valid timestamped speech segments.');
  }

  const text = request.dedupeRepeatedSpeech
    ? segments.map((segment) => segment.text).filter(Boolean).join(' ')
    : normalizeOptionalText(result.text) ?? segments.map((segment) => segment.text).filter(Boolean).join(' ');

  return {
    artifactUuid: result.artifactUuid ?? '',
    taskUuid: result.taskUuid ?? '',
    sourceAssetUuid: result.sourceAssetUuid ?? request.assetUuid,
    transcriptPath: result.transcriptPath ?? '',
    taskOutputDir: result.taskOutputDir ?? request.outputRootDir ?? '',
    language: normalizeOptionalText(result.language) ?? request.language ?? runtime.language,
    segments,
    text,
    ...normalizeAutoCutSpeechTranscriptQualityGuard(result.qualityGuard),
    standardTranscript: normalizeAutoCutStandardSmartSliceTranscript({
      request,
      runtime,
      language: normalizeOptionalText(result.language) ?? request.language ?? runtime.language,
      text,
      segments,
      ...(result.standardTranscript ? { transcript: result.standardTranscript } : {}),
      ...(result.qualityGuard ? { qualityGuard: result.qualityGuard } : {}),
    }),
    ffmpegExecutable: result.ffmpegExecutable ?? '',
    speechExecutable: result.speechExecutable ?? runtime.provider.engine,
  };
}

function normalizeAutoCutStandardSmartSliceTranscript({
  transcript,
  request,
  runtime,
  language,
  text,
  segments,
  qualityGuard,
}: {
  transcript?: AutoCutSmartSliceTranscript;
  request: AutoCutSpeechTranscriptionRequest;
  runtime: AutoCutSpeechTranscriptionProviderRuntimeConfig;
  language: string;
  text: string;
  segments: readonly AutoCutSpeechTranscriptionSegment[];
  qualityGuard?: AutoCutSpeechTranscriptQualityGuard;
}): AutoCutSmartSliceTranscript {
  if (transcript?.schema === 'smart-slice.transcript.v1' && Array.isArray(transcript.segments)) {
    return {
      ...transcript,
      providerId: transcript.providerId || runtime.providerId,
      language: transcript.language || language,
      text: transcript.text || text,
      speakers: Array.isArray(transcript.speakers) ? transcript.speakers : [],
      segments: transcript.segments,
      createdAt: transcript.createdAt || createAutoCutTimestamp(),
    };
  }

  const speakerIdByLabel = new Map<string, string>();
  const speakers: AutoCutSmartSliceTranscript['speakers'] = [];
  const getSpeakerId = (speakerLabel: string | undefined) => {
    const label = speakerLabel?.trim() || 'Speaker 1';
    const existingId = speakerIdByLabel.get(label);
    if (existingId) {
      return existingId;
    }
    const id = `speaker-${speakerIdByLabel.size + 1}`;
    speakerIdByLabel.set(label, id);
    speakers.push({ id, label });
    return id;
  };

  const standardSegments = segments.map((segment, index) => ({
    id: `seg-${String(index + 1).padStart(4, '0')}`,
    startMs: segment.startMs,
    endMs: segment.endMs,
    speakerId: getSpeakerId(segment.speaker),
    text: segment.text,
    ...(segment.words?.length
      ? {
          words: segment.words.map((word) => ({
            startMs: word.startMs,
            endMs: word.endMs,
            text: word.text,
            ...(typeof word.probability === 'number'
              ? { confidence: word.probability }
              : typeof word.prob === 'number'
                ? { confidence: word.prob }
                : typeof word.p === 'number'
                  ? { confidence: word.p }
                  : {}),
          })),
        }
      : {}),
  }));

  return {
    schema: 'smart-slice.transcript.v1',
    providerId: runtime.providerId,
    language,
    ...(Number.isFinite((request as { sourceDurationMs?: unknown }).sourceDurationMs)
      ? { durationMs: Number((request as { sourceDurationMs?: unknown }).sourceDurationMs) }
      : {}),
    text,
    speakers,
    segments: standardSegments,
    ...(qualityGuard
      ? {
          qualityGuard: {
            status: qualityGuard.status,
            passed: qualityGuard.passed,
            risks: qualityGuard.risks.map((risk) => ({
              code: risk.code,
              severity: risk.severity,
              message: risk.message,
            })),
          },
        }
      : {}),
    createdAt: createAutoCutTimestamp(),
  };
}

function normalizeAutoCutSpeechTranscriptQualityGuard(
  qualityGuard: AutoCutSpeechTranscriptQualityGuard | undefined,
): { qualityGuard?: AutoCutSpeechTranscriptQualityGuard } {
  if (!qualityGuard || typeof qualityGuard !== 'object') {
    return {};
  }
  return {
    qualityGuard: {
      schema: typeof qualityGuard.schema === 'string' ? qualityGuard.schema : 'smart-slice.stt-quality-guard.v1',
      status: typeof qualityGuard.status === 'string' ? qualityGuard.status : 'not-run',
      passed: qualityGuard.passed === true,
      scope: typeof qualityGuard.scope === 'string' ? qualityGuard.scope : '',
      chunkId: typeof qualityGuard.chunkId === 'string' ? qualityGuard.chunkId : '',
      retryCount: normalizeNonNegativeNumber(qualityGuard.retryCount),
      riskCount: normalizeNonNegativeNumber(qualityGuard.riskCount),
      risks: Array.isArray(qualityGuard.risks)
        ? qualityGuard.risks
            .filter((risk) => risk && typeof risk === 'object' && typeof risk.code === 'string')
            .map((risk) => ({
              code: risk.code,
              severity: typeof risk.severity === 'string' ? risk.severity : 'blocker',
              message: typeof risk.message === 'string' ? risk.message : risk.code,
              ...(typeof risk.example === 'string' ? { example: risk.example } : {}),
              ...(Number.isFinite(risk.count) ? { count: Number(risk.count) } : {}),
              ...(Number.isFinite(risk.ratio) ? { ratio: Number(risk.ratio) } : {}),
            }))
        : [],
      metrics: {
        segmentCount: normalizeNonNegativeNumber(qualityGuard.metrics?.segmentCount),
        textLength: normalizeNonNegativeNumber(qualityGuard.metrics?.textLength),
        uniqueCharacterRatio: normalizeUnitNumber(qualityGuard.metrics?.uniqueCharacterRatio, 1),
        replacementCharacterCount: normalizeNonNegativeNumber(qualityGuard.metrics?.replacementCharacterCount),
        repeatedPhraseRunCount: normalizeNonNegativeNumber(qualityGuard.metrics?.repeatedPhraseRunCount),
        duplicateWindowRatio: normalizeUnitNumber(qualityGuard.metrics?.duplicateWindowRatio, 0),
        tinySegmentRatio: normalizeUnitNumber(qualityGuard.metrics?.tinySegmentRatio, 0),
      },
    },
  };
}

function normalizeNonNegativeNumber(value: unknown, fallback = 0) {
  const number = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value.trim())
      : Number.NaN;
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback;
}

function normalizeUnitNumber(value: unknown, fallback: number) {
  const number = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value.trim())
      : Number.NaN;
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : fallback;
}

function normalizeAutoCutSpeechTranscriptionSegments(
  segments: readonly AutoCutSpeechTranscriptionSegment[],
) {
  if (!Array.isArray(segments)) {
    throw new Error('AutoCut speech transcription provider returned an invalid segments payload.');
  }
  if (segments.length === 0) {
    throw new Error('AutoCut speech transcription provider must return valid timestamped speech segments.');
  }

  const normalizedSegments = segments.map((segment, index) => {
    const segmentNumber = index + 1;
    if (typeof segment.text !== 'string' || !segment.text.trim()) {
      throw new Error(`AutoCut speech transcription provider requires segment ${segmentNumber} to contain recognized speech text.`);
    }

    const segmentRecord = segment as AutoCutSpeechTranscriptionSegment & Record<string, unknown>;
    const startMs = normalizeSpeechTranscriptionSegmentBoundaryMilliseconds(
      segmentRecord,
      segmentNumber,
      'start',
    );
    const endMs = normalizeSpeechTranscriptionSegmentBoundaryMilliseconds(
      segmentRecord,
      segmentNumber,
      'end',
    );
    if (endMs <= startMs) {
      throw new Error(`AutoCut speech transcription provider requires segment ${segmentNumber} endMs to be after startMs.`);
    }

    return {
      startMs,
      endMs,
      text: segment.text.trim().replace(/\s+/gu, ' '),
      ...(segment.speaker?.trim() ? { speaker: segment.speaker.trim() } : {}),
      ...normalizeAutoCutSpeechTranscriptionWords(segmentRecord, segmentNumber, startMs, endMs),
    };
  });

  const unitNormalizedSegments = normalizeAutoCutSpeechTranscriptionSegmentTimeUnit(normalizedSegments);

  unitNormalizedSegments.sort((firstSegment, secondSegment) =>
    firstSegment.startMs - secondSegment.startMs ||
    firstSegment.endMs - secondSegment.endMs,
  );

  const repairedSegments: AutoCutSpeechTranscriptionSegment[] = [];
  for (const segment of unitNormalizedSegments) {
    let previousSegment = repairedSegments.at(-1);
    while (
      previousSegment &&
      segment.startMs < previousSegment.endMs &&
      isLowInformationAutoCutSpeechTranscriptionSegment(previousSegment) &&
      !isLowInformationAutoCutSpeechTranscriptionSegment(segment)
    ) {
      repairedSegments.pop();
      previousSegment = repairedSegments.at(-1);
    }

    if (!previousSegment || segment.startMs >= previousSegment.endMs) {
      repairedSegments.push(segment);
      continue;
    }

    const overlapMs = previousSegment.endMs - segment.startMs;
    if (
      overlapMs > AUTOCUT_SPEECH_TRANSCRIPTION_SEGMENT_OVERLAP_REPAIR_MS &&
      !isLowInformationAutoCutSpeechTranscriptionSegment(previousSegment) &&
      isLowInformationAutoCutSpeechTranscriptionSegment(segment)
    ) {
      continue;
    }

    if (overlapMs > AUTOCUT_SPEECH_TRANSCRIPTION_SEGMENT_OVERLAP_REPAIR_MS) {
      throw new Error(
        `AutoCut speech transcription provider returned overlapping speech segments that exceed the ${AUTOCUT_SPEECH_TRANSCRIPTION_SEGMENT_OVERLAP_REPAIR_MS}ms repair tolerance.`,
      );
    }

    const repairedSegment = {
      ...segment,
      startMs: previousSegment.endMs,
    };
    if (repairedSegment.endMs <= repairedSegment.startMs) {
      continue;
    }
    repairedSegments.push(repairedSegment);
  }

  if (repairedSegments.length === 0) {
    throw new Error('AutoCut speech transcription provider must return valid timestamped speech segments.');
  }

  return repairedSegments;
}

function dedupeAutoCutRepeatedSpeechSegments(
  segments: readonly AutoCutSpeechTranscriptionSegment[],
): AutoCutSpeechTranscriptionSegment[] {
  const dedupedSegments: AutoCutSpeechTranscriptionSegment[] = [];
  for (const segment of segments) {
    const cleanedText = dedupeAutoCutRepeatedSpeechText(segment.text);
    if (!cleanedText) {
      continue;
    }

    const previousSegment = dedupedSegments.at(-1);
    if (
      previousSegment &&
      segment.startMs - previousSegment.endMs <= AUTOCUT_SPEECH_TRANSCRIPTION_REPEAT_SEGMENT_JOIN_GAP_MS &&
      normalizeAutoCutRepeatedSpeechToken(previousSegment.text) === normalizeAutoCutRepeatedSpeechToken(cleanedText)
    ) {
      previousSegment.endMs = Math.max(previousSegment.endMs, segment.endMs);
      continue;
    }

    dedupedSegments.push({
      ...segment,
      text: cleanedText,
      ...normalizeAutoCutSpeechTranscriptionWordsForText(segment.words, segment.startMs, segment.endMs, cleanedText),
    });
  }

  return dedupedSegments;
}

function normalizeAutoCutSpeechTranscriptionWords(
  segmentRecord: Record<string, unknown>,
  segmentNumber: number,
  segmentStartMs: number,
  segmentEndMs: number,
): Pick<AutoCutSpeechTranscriptionSegment, 'words'> {
  const wordsValue = segmentRecord.words;
  if (!Array.isArray(wordsValue) || wordsValue.length === 0) {
    return {};
  }

  const words = wordsValue
    .map((word, index) => normalizeAutoCutSpeechTranscriptionWord(
      word,
      segmentNumber,
      index + 1,
      segmentStartMs,
      segmentEndMs,
    ))
    .filter((word): word is NonNullable<ReturnType<typeof normalizeAutoCutSpeechTranscriptionWord>> => Boolean(word));
  if (words.length === 0) {
    return {};
  }

  words.sort((firstWord, secondWord) =>
    firstWord.startMs - secondWord.startMs ||
    firstWord.endMs - secondWord.endMs,
  );

  const repairedWords: NonNullable<ReturnType<typeof normalizeAutoCutSpeechTranscriptionWord>>[] = [];
  for (const word of words) {
    const previousWord = repairedWords.at(-1);
    const startMs = previousWord ? Math.max(word.startMs, previousWord.endMs) : word.startMs;
    if (word.endMs <= startMs) {
      continue;
    }
    repairedWords.push({ ...word, startMs });
  }

  return repairedWords.length > 0 ? { words: repairedWords } : {};
}

function normalizeAutoCutSpeechTranscriptionWord(
  word: unknown,
  segmentNumber: number,
  wordNumber: number,
  segmentStartMs: number,
  segmentEndMs: number,
) {
  if (!word || typeof word !== 'object') {
    return undefined;
  }

  const wordRecord = word as Record<string, unknown>;
  const text = typeof wordRecord.text === 'string'
    ? wordRecord.text.trim().replace(/\s+/gu, ' ')
    : '';
  if (!text) {
    return undefined;
  }

  let startMs: number;
  let endMs: number;
  try {
    startMs = Math.max(
      segmentStartMs,
      normalizeSpeechTranscriptionSegmentBoundaryMilliseconds(
        wordRecord,
        segmentNumber,
        'start',
      ),
    );
    endMs = Math.min(
      segmentEndMs,
      normalizeSpeechTranscriptionSegmentBoundaryMilliseconds(
        wordRecord,
        segmentNumber,
        'end',
      ),
    );
  } catch {
    return undefined;
  }
  if (endMs <= startMs) {
    return undefined;
  }

  const probability = normalizeAutoCutSpeechTranscriptionWordProbability(wordRecord, segmentNumber, wordNumber);
  return {
    startMs,
    endMs,
    text,
    ...(probability === undefined ? {} : { probability }),
  };
}

function normalizeAutoCutSpeechTranscriptionWordProbability(
  wordRecord: Record<string, unknown>,
  segmentNumber: number,
  wordNumber: number,
) {
  const rawValue = wordRecord.probability ?? wordRecord.prob ?? wordRecord.p;
  if (rawValue === undefined) {
    return undefined;
  }
  const value = typeof rawValue === 'number'
    ? rawValue
    : typeof rawValue === 'string' && rawValue.trim()
      ? Number(rawValue.trim())
      : Number.NaN;
  if (!Number.isFinite(value)) {
    throw new Error(`AutoCut speech transcription provider returned invalid segment ${segmentNumber} word ${wordNumber} probability.`);
  }

  return Math.min(1, Math.max(0, value));
}

function normalizeAutoCutSpeechTranscriptionWordsForText(
  words: AutoCutSpeechTranscriptionSegment['words'],
  segmentStartMs: number,
  segmentEndMs: number,
  text: string,
): Pick<AutoCutSpeechTranscriptionSegment, 'words'> {
  if (!Array.isArray(words) || words.length === 0) {
    return {};
  }

  const boundedWords = words.filter((word) =>
    word.startMs >= segmentStartMs &&
    word.endMs <= segmentEndMs &&
    word.endMs > word.startMs
  );
  const normalizedTextToken = normalizeAutoCutRepeatedSpeechToken(text);
  const normalizedWordToken = normalizeAutoCutRepeatedSpeechToken(
    boundedWords.map((word) => word.text).join(' '),
  );
  if (!normalizedTextToken || normalizedTextToken !== normalizedWordToken) {
    return {};
  }

  return boundedWords.length > 0 ? { words: boundedWords } : {};
}

function dedupeAutoCutRepeatedSpeechText(text: string) {
  const chunks = splitAutoCutRepeatedSpeechTextChunks(text);
  if (chunks.length <= 1) {
    return text.trim().replace(/\s+/gu, ' ');
  }

  const dedupedChunks: string[] = [];
  let previousToken = '';
  for (const chunk of chunks) {
    const token = normalizeAutoCutRepeatedSpeechToken(chunk);
    if (!token) {
      continue;
    }
    if (token === previousToken) {
      continue;
    }

    dedupedChunks.push(chunk.trim().replace(/\s+/gu, ' '));
    previousToken = token;
  }

  return joinAutoCutRepeatedSpeechTextChunks(dedupedChunks);
}

function splitAutoCutRepeatedSpeechTextChunks(text: string) {
  const normalized = text.trim().replace(/\s+/gu, ' ');
  const chunks: string[] = [];
  const splitPattern = /(.+?[,，、。.!！？?;；:：])(?:\s*|$)/gu;
  let cursor = 0;

  for (const match of normalized.matchAll(splitPattern)) {
    const fullMatch = match[0];
    const startIndex = match.index ?? 0;
    if (startIndex > cursor) {
      const before = normalized.slice(cursor, startIndex).trim();
      if (before) {
        chunks.push(before);
      }
    }

    const chunk = fullMatch.trim();
    if (chunk) {
      chunks.push(chunk);
    }
    cursor = startIndex + fullMatch.length;
  }

  if (cursor < normalized.length) {
    const tail = normalized.slice(cursor).trim();
    if (tail) {
      chunks.push(tail);
    }
  }

  return chunks;
}

function normalizeAutoCutRepeatedSpeechToken(text: string) {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/["'`“”‘’()[\]{}<>《》]/gu, '')
    .replace(/[,\uFF0C\u3001\u3002.!?\uFF01\uFF1F;；:：\s]+/gu, '')
    .trim();
}

function joinAutoCutRepeatedSpeechTextChunks(chunks: readonly string[]) {
  let result = '';
  for (const chunk of chunks) {
    if (!result) {
      result = chunk;
      continue;
    }

    if (/^[,，、。.!！？?;；:：]/u.test(chunk)) {
      result += chunk;
      continue;
    }

    if (/[,.!?;:]$/u.test(result) && /^[a-z0-9]/iu.test(chunk)) {
      result += ` ${chunk}`;
      continue;
    }

    if (/[,.!?;:]$/u.test(result) && /^\p{Script=Han}/u.test(chunk)) {
      result += chunk;
      continue;
    }

    if (/[，、。！？；：]$/u.test(result)) {
      result += chunk;
      continue;
    }

    result += ` ${chunk}`;
  }

  return result.trim().replace(/\s+([,，、。.!！？?;；:：])/gu, '$1');
}

function normalizeAutoCutSpeechTranscriptionSegmentTimeUnit(
  segments: readonly AutoCutSpeechTranscriptionSegment[],
): AutoCutSpeechTranscriptionSegment[] {
  if (!shouldScaleAutoCutSpeechTranscriptionSegmentsSecondsToMilliseconds(segments)) {
    return segments.slice();
  }

  return segments.map((segment) => ({
    ...segment,
    startMs: Math.round(segment.startMs * 1_000),
    endMs: Math.round(segment.endMs * 1_000),
    ...(Array.isArray(segment.words) && segment.words.length > 0
      ? {
          words: segment.words.map((word) => ({
            ...word,
            startMs: Math.round(word.startMs * 1_000),
            endMs: Math.round(word.endMs * 1_000),
          })),
        }
      : {}),
  }));
}

function shouldScaleAutoCutSpeechTranscriptionSegmentsSecondsToMilliseconds(
  segments: readonly AutoCutSpeechTranscriptionSegment[],
) {
  if (segments.length < AUTOCUT_SPEECH_TRANSCRIPTION_SECONDS_UNIT_MIN_SEGMENTS) {
    return false;
  }

  const timestampedSegments = segments.filter((segment) =>
    typeof segment.startMs === 'number' &&
    typeof segment.endMs === 'number' &&
    Number.isFinite(segment.startMs) &&
    Number.isFinite(segment.endMs) &&
    segment.endMs > segment.startMs
  );
  if (timestampedSegments.length < AUTOCUT_SPEECH_TRANSCRIPTION_SECONDS_UNIT_MIN_SEGMENTS) {
    return false;
  }

  const transcriptStartMs = Math.min(...timestampedSegments.map((segment) => segment.startMs));
  const transcriptEndMs = Math.max(...timestampedSegments.map((segment) => segment.endMs));
  const longestSegmentDurationMs = Math.max(
    ...timestampedSegments.map((segment) => segment.endMs - segment.startMs),
  );
  if (
    transcriptStartMs < 0 ||
    transcriptEndMs <= 0 ||
    transcriptEndMs > AUTOCUT_SPEECH_TRANSCRIPTION_SECONDS_UNIT_MAX_TIMELINE_MS ||
    longestSegmentDurationMs > AUTOCUT_SPEECH_TRANSCRIPTION_SECONDS_UNIT_MAX_SEGMENT_DURATION_MS
  ) {
    return false;
  }

  const scaledLongestSegmentDurationMs = longestSegmentDurationMs * 1_000;
  if (
    transcriptEndMs - transcriptStartMs < AUTOCUT_SPEECH_TRANSCRIPTION_SECONDS_UNIT_MIN_EVIDENCE_UNITS ||
    scaledLongestSegmentDurationMs < AUTOCUT_SPEECH_TRANSCRIPTION_SECONDS_UNIT_MIN_SCALED_SEGMENT_DURATION_MS
  ) {
    return false;
  }

  const speechDurationUnits = timestampedSegments.reduce(
    (totalDurationUnits, segment) => totalDurationUnits + Math.max(0, segment.endMs - segment.startMs),
    0,
  );
  if (speechDurationUnits <= 0) {
    return false;
  }

  const transcriptEvidenceTextUnits = timestampedSegments.reduce(
    (totalTextUnits, segment) => totalTextUnits + normalizeSpeechTranscriptionEvidenceTextUnits(segment.text),
    0,
  );
  const richSegmentCount = timestampedSegments.filter(
    (segment) =>
      normalizeSpeechTranscriptionEvidenceTextUnits(segment.text) >=
        AUTOCUT_SPEECH_TRANSCRIPTION_SECONDS_UNIT_MIN_SEGMENT_TEXT_UNITS,
  ).length;
  if (
    richSegmentCount < AUTOCUT_SPEECH_TRANSCRIPTION_SECONDS_UNIT_MIN_RICH_SEGMENTS ||
    transcriptEvidenceTextUnits < AUTOCUT_SPEECH_TRANSCRIPTION_SECONDS_UNIT_MIN_EVIDENCE_UNITS
  ) {
    return false;
  }

  const textUnitsPerUnscaledSecond = transcriptEvidenceTextUnits * 1_000 / speechDurationUnits;
  return textUnitsPerUnscaledSecond >=
    AUTOCUT_SPEECH_TRANSCRIPTION_SECONDS_UNIT_MIN_TEXT_UNITS_PER_SECOND;
}

function normalizeSpeechTranscriptionEvidenceTextUnits(text: string) {
  return text.trim().replace(/\s+/gu, '').length;
}

function isLowInformationAutoCutSpeechTranscriptionSegment(segment: AutoCutSpeechTranscriptionSegment) {
  return isLowInformationAutoCutTranscriptEvidenceText(segment.text);
}

function normalizeSpeechTranscriptionSegmentBoundaryMilliseconds(
  segment: Record<string, unknown>,
  segmentNumber: number,
  boundary: 'start' | 'end',
) {
  const millisecondFieldName = boundary === 'start' ? 'startMs' : 'endMs';
  const snakeMillisecondFieldName = boundary === 'start' ? 'start_ms' : 'end_ms';
  const secondFieldName = boundary;
  const offsetFieldName = boundary === 'start' ? 'from' : 'to';
  const offsetIndex = boundary === 'start' ? 0 : 1;
  const directMillisecondValue = segment[millisecondFieldName] ?? segment[snakeMillisecondFieldName];
  if (directMillisecondValue !== undefined) {
    return normalizeSegmentMilliseconds(directMillisecondValue, segmentNumber, millisecondFieldName);
  }

  const offsets = segment.offsets;
  if (offsets && typeof offsets === 'object') {
    const offsetValue = Array.isArray(offsets)
      ? offsets[offsetIndex]
      : (offsets as Record<string, unknown>)[offsetFieldName];
    if (offsetValue !== undefined) {
      return normalizeSegmentMilliseconds(offsetValue, segmentNumber, `offsets.${offsetFieldName}`);
    }
  }

  const timestamps = segment.timestamps ?? segment.timestamp;
  if (timestamps && typeof timestamps === 'object') {
    const timestampValue = Array.isArray(timestamps)
      ? timestamps[offsetIndex]
      : (timestamps as Record<string, unknown>)[offsetFieldName];
    if (timestampValue !== undefined) {
      return normalizeSegmentSeconds(timestampValue, segmentNumber, `timestamp.${offsetFieldName}`);
    }
  }

  const directSecondValue = segment[secondFieldName];
  if (directSecondValue !== undefined) {
    return normalizeSegmentSeconds(directSecondValue, segmentNumber, secondFieldName);
  }

  throw new Error(
    `AutoCut speech transcription provider requires segment ${segmentNumber} ${millisecondFieldName} to be a finite non-negative timestamp.`,
  );
}

function normalizeSegmentMilliseconds(
  value: unknown,
  segmentNumber: number,
  fieldName: string,
) {
  const numericValue = parseAutoCutSpeechTranscriptionTimestampNumber(value, fieldName);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    throw new Error(
      `AutoCut speech transcription provider requires segment ${segmentNumber} ${fieldName} to be a finite non-negative timestamp.`,
    );
  }

  return Math.round(numericValue);
}

function normalizeSegmentSeconds(value: unknown, segmentNumber: number, fieldName: string) {
  const milliseconds = parseAutoCutSpeechTranscriptionTimestampToMilliseconds(value);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    throw new Error(
      `AutoCut speech transcription provider requires segment ${segmentNumber} ${fieldName} to be a finite non-negative timestamp.`,
    );
  }

  return Math.round(milliseconds);
}

function parseAutoCutSpeechTranscriptionTimestampNumber(value: unknown, fieldName: string) {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const numericValue = Number(value.trim());
    if (Number.isFinite(numericValue)) {
      return numericValue;
    }
  }

  throw new Error(`AutoCut speech transcription provider returned invalid ${fieldName} timestamp.`);
}

function parseAutoCutSpeechTranscriptionTimestampToMilliseconds(value: unknown) {
  if (typeof value === 'number') {
    return value * 1_000;
  }
  if (typeof value !== 'string') {
    return Number.NaN;
  }

  const normalized = value.trim().replace(',', '.');
  if (!normalized) {
    return Number.NaN;
  }
  if (!normalized.includes(':')) {
    const seconds = Number(normalized);
    return Number.isFinite(seconds) ? seconds * 1_000 : Number.NaN;
  }

  const parts = normalized.split(':');
  if (parts.length !== 3) {
    return Number.NaN;
  }
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  const seconds = Number(parts[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return Number.NaN;
  }

  return ((hours * 60 * 60) + (minutes * 60) + seconds) * 1_000;
}

function normalizeOptionalText(value: string | undefined) {
  const normalized = value?.trim();
  return normalized || undefined;
}

function normalizeAutoCutSpeechTranscriptionModelDownloadProgress(
  progress: AutoCutSpeechTranscriptionModelDownloadProgressEvent,
): AutoCutSpeechTranscriptionModelDownloadProgressEvent {
  if (!isAutoCutSpeechTranscriptionModelDownloadPhase(progress.phase)) {
    throw new Error(`AutoCut unsupported local speech-to-text model download phase: ${String(progress.phase)}`);
  }

  const preset = resolveAutoCutLocalSpeechTranscriptionModelPreset(progress.presetId);
  const sourceUrl = progress.sourceUrl?.trim();
  if (
    progress.providerId !== preset.providerId ||
    progress.fileName !== preset.fileName ||
    (sourceUrl && !isAutoCutLocalSpeechTranscriptionModelPresetDownloadUrl(preset, sourceUrl))
  ) {
    throw new Error('AutoCut local speech-to-text model download progress did not match the registered local speech-to-text model preset.');
  }

  const downloadedBytes = normalizeProgressByteCount(progress.downloadedBytes);
  const totalBytes = progress.totalBytes === undefined ? undefined : normalizeProgressByteCount(progress.totalBytes);
  const calculatedProgress = totalBytes && totalBytes > 0
    ? Math.round(Math.min(100, Math.max(0, (downloadedBytes / totalBytes) * 100)))
    : progress.progress;
  return {
    providerId: preset.providerId,
    presetId: preset.id,
    fileName: preset.fileName,
    phase: progress.phase,
    downloadedBytes,
    ...(totalBytes !== undefined ? { totalBytes } : {}),
    ...(typeof calculatedProgress === 'number' && Number.isFinite(calculatedProgress)
      ? { progress: Math.min(100, Math.max(0, Math.round(calculatedProgress))) }
      : {}),
    ...(progress.modelPath?.trim() ? { modelPath: progress.modelPath.trim() } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(progress.errorMessage?.trim() ? { errorMessage: progress.errorMessage.trim() } : {}),
  };
}

function normalizeProgressByteCount(value: number) {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function resolveAutoCutCurrentSpeechTranscriptionExecutablePlatform():
  AutoCutLocalSpeechTranscriptionExecutablePlatform | string {
  if (typeof navigator !== 'undefined') {
    const userAgent = navigator.userAgent?.toLowerCase() ?? '';
    const platform = navigator.platform?.toLowerCase() ?? '';
    const architecture = userAgent.includes('arm64') || userAgent.includes('aarch64') || platform.includes('arm')
      ? 'aarch64'
      : 'x86_64';
    if (platform.includes('win') || userAgent.includes('windows')) {
      return 'windows-x86_64';
    }
    if (platform.includes('mac') || userAgent.includes('mac os')) {
      return architecture === 'aarch64' ? 'macos-aarch64' : 'macos-x86_64';
    }
    if (platform.includes('linux') || userAgent.includes('linux') || userAgent.includes('ubuntu')) {
      return 'linux-x86_64';
    }
  }
  return 'windows-x86_64';
}

function createAutoCutUnsupportedLocalSpeechTranscriptionExecutablePresetReason(
  providerId: AutoCutSpeechTranscriptionProviderId,
) {
  const platform = resolveAutoCutCurrentSpeechTranscriptionExecutablePlatform();
  return `AutoCut local speech-to-text executable runtime download is disabled by product policy for provider ${providerId} on ${platform}. AutoCut will auto-discover Settings, SDKWORK_AUTOCUT_WHISPER_EXECUTABLE, verified bundled sidecar, PATH, Homebrew, apt/system paths, and common install directories. Package the approved whisper-cli sidecar for this platform or select a verified local whisper-cli executable in Settings > Speech-to-Text.`;
}
