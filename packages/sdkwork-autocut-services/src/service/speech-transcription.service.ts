import {
  AUTOCUT_LOCAL_SPEECH_TRANSCRIPTION_MODEL_PRESETS,
  AUTOCUT_DEFAULT_LOCAL_SPEECH_TRANSCRIPTION_MODEL_PRESET_ID,
  AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER_DEFINITIONS,
  AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_EXTENSIONS,
  AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_PHASE,
  AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_NEXT_ACTION,
  AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS,
  isAutoCutSpeechTranscriptionModelDownloadPhase,
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
} from '@sdkwork/autocut-types';
import { writeAutoCutClipboardText } from './browser.service';
import { downloadAutoCutUrl } from './download.service';
import {
  getAutoCutNativeHostClient,
  type AutoCutSpeechTranscriptionProbe,
  type AutoCutSpeechTranscriptionRequest,
  type AutoCutSpeechTranscriptionResult,
  type AutoCutSpeechTranscriptionSegment,
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
}

export interface AutoCutSpeechTranscriptionProviderRuntimeConfig extends AutoCutSpeechTranscriptionSettings {
  provider: AutoCutSpeechTranscriptionProviderDefinition;
  requestFormat: 'autocut-speech-transcription-provider';
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

const AUTOCUT_LOCAL_SPEECH_TRANSCRIPTION_DEFAULT_MODEL_ROOT = 'AutoCut application data';
const AUTOCUT_LOCAL_SPEECH_TRANSCRIPTION_DEFAULT_EXECUTABLE_ROOT = 'AutoCut application resources';
const AUTOCUT_LOCAL_SPEECH_TRANSCRIPTION_EXECUTABLE_RESOURCE_SUBDIRECTORY = 'binaries';
const AUTOCUT_LOCAL_SPEECH_TRANSCRIPTION_MODEL_SUBDIRECTORY = 'models/speech';
const AUTOCUT_LOCAL_SPEECH_TRANSCRIPTION_EXECUTABLE_BINARY = 'whisper-cli';

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
  const runtime = await resolveAutoCutSpeechTranscriptionProviderRuntimeConfig();
  const preset = presetOrId
    ? resolveAutoCutLocalSpeechTranscriptionModelPreset(presetOrId)
    : resolveAutoCutRecommendedLocalSpeechTranscriptionModelPreset(runtime.providerId);
  if (preset.providerId !== runtime.providerId) {
    throw new Error('AutoCut local speech-to-text model preset must match the selected provider.');
  }
  if (runtime.provider.kind !== 'local') {
    throw new Error('AutoCut local speech-to-text model setup requires a local speech-to-text provider.');
  }

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
      modelDownload.sha256.toLowerCase() !== preset.sha256
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

  const settings = await saveAutoCutSpeechTranscriptionSettings({
    ...runtime,
    providerId: preset.providerId,
    modelPath: modelDownload.modelPath,
  });

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
  });
}

export async function initializeAutoCutLocalSpeechTranscriptionSetup():
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

  const finalStatus = createAutoCutLocalSpeechTranscriptionSetupStatus({
    runtime: verifiedRuntime,
    preset: initialStatus.model.preset,
    localProviderIds: initialStatus.localProviderIds,
    capabilities: initialStatus.capabilities,
    defaults: initialStatus.defaults,
    readiness: AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.ready,
    nextAction: AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_NEXT_ACTION.none,
    executablePath: verifiedExecutablePath,
    executableSourceKind: probe.sourceKind,
    modelPath: verifiedModelPath,
    diagnostics: probe.diagnostics,
    executableReady: probe.executableReady ?? true,
    modelReady: probe.modelReady ?? true,
    testReady: true,
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
  const provider = resolveAutoCutSpeechTranscriptionProviderDefinition(settings.providerId);
  if (provider.kind === 'api') {
    const modelVendorRuntime = await resolveAutoCutLlmRuntimeConfig();
    const isMatchingRuntime = modelVendorRuntime.modelVendor === settings.modelVendor;
    return {
      ...settings,
      provider,
      ...(isMatchingRuntime ? { modelVendorRuntime } : {}),
      ...(isMatchingRuntime && modelVendorRuntime.sessionApiKey ? { sessionApiKey: modelVendorRuntime.sessionApiKey } : {}),
      apiKeyConfigured: Boolean(isMatchingRuntime && modelVendorRuntime.apiKeyConfigured),
      configured: Boolean(isMatchingRuntime && modelVendorRuntime.apiKeyConfigured),
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
): Promise<AutoCutSpeechTranscriptionResult & { providerId: AutoCutSpeechTranscriptionProviderRuntimeConfig['providerId'] }> {
  const runtime = await resolveAutoCutSpeechTranscriptionProviderRuntimeConfig();
  validateAutoCutSpeechTranscriptionRequest(request);
  if (runtime.provider.kind === 'local') {
    return transcribeAutoCutMediaWithLocalProvider(request, runtime);
  }
  if (runtime.provider.kind === 'api') {
    return transcribeAutoCutMediaWithApiProvider(request, runtime);
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
) {
  const nativeHostClient = getAutoCutNativeHostClient();
  const readyRuntime = await ensureAutoCutLocalSpeechTranscriptionExecutionReady(runtime);

  const result = await nativeHostClient.transcribeMedia({
    ...request,
    providerId: readyRuntime.providerId,
    language: request.language ?? readyRuntime.language,
    executablePath: readyRuntime.executablePath,
    modelPath: readyRuntime.modelPath,
  });

  return {
    ...normalizeAutoCutSpeechTranscriptionResult(result, request, readyRuntime),
    providerId: readyRuntime.providerId,
  };
}

async function transcribeAutoCutMediaWithApiProvider(
  request: AutoCutSpeechTranscriptionRequest,
  runtime: AutoCutSpeechTranscriptionProviderRuntimeConfig,
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
    },
    runtime,
  );

  return {
    ...normalizeAutoCutSpeechTranscriptionResult(result, request, runtime),
    providerId: runtime.providerId,
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
  const setup = await setupAutoCutLocalSpeechTranscriptionModelPreset();
  const initializedRuntime = await resolveAutoCutSpeechTranscriptionProviderRuntimeConfig();
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
    diagnostics: probe.diagnostics,
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
}): AutoCutLocalSpeechTranscriptionSetupStatus {
  const executablePath = params.executablePath.trim();
  const modelPath = params.modelPath.trim();
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
    diagnostics: probe.diagnostics,
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
    return 'The downloaded speech recognition model did not pass integrity verification. Retry automatic setup; the app will replace the invalid file with a verified copy.';
  }

  if (
    message.includes('incomplete') ||
    message.includes('empty file') ||
    message.includes('too small') ||
    message.includes('minimum') ||
    message.includes('content-length')
  ) {
    return 'The speech recognition model download did not finish. Retry automatic setup, or copy the model download link and select the completed local file in Speech-to-Text settings.';
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
  const defaultGuidance = status
    ? ` Default executable target: ${status.defaults.executablePath || status.defaults.executableDirectory}. Default model path: ${status.defaults.modelPath || status.defaults.modelDirectory}. Executable discovery: ${status.defaults.executableStrategy}.`
    : '';
  const downloadGuidance = nativeModelDownloadAvailable
    ? 'Use Initialize in Settings > Speech-to-Text to download the recommended offline Whisper model, then run provider validation again. Use and download the recommended offline Whisper model if the file was removed or failed checksum validation. The whisper-cli executable must come from the packaged sidecar or an existing verified local installation.'
    : 'Open the desktop app, download the recommended offline Whisper model, select the local model file, then run the provider test again.';
  return `${reason}${defaultGuidance} ${downloadGuidance}`;
}

function createAutoCutLocalSpeechTranscriptionInitializationFailureReason(
  probe: AutoCutSpeechTranscriptionProbe,
  status: AutoCutLocalSpeechTranscriptionSetupStatus,
) {
  if (probe.executableReady === false || status.executable.ready === false) {
    const diagnostic = probe.diagnostics[0]?.trim();
    return [
      'AutoCut local speech-to-text still needs a verified whisper-cli executable.',
      diagnostic || 'AutoCut automatically checked Settings, SDKWORK_AUTOCUT_WHISPER_EXECUTABLE, verified bundled sidecar, PATH, and common local installation directories.',
      createAutoCutUnsupportedLocalSpeechTranscriptionExecutablePresetReason(status.providerId),
    ].join(' ');
  }

  return probe.diagnostics[0] ?? 'AutoCut local speech-to-text setup did not pass provider validation.';
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
  const segments = normalizeAutoCutSpeechTranscriptionSegments(result.segments);
  if (segments.length === 0) {
    throw new Error('AutoCut speech transcription provider must return valid timestamped speech segments.');
  }

  const text = normalizeOptionalText(result.text) ??
    segments.map((segment) => segment.text).filter(Boolean).join(' ');

  return {
    artifactUuid: result.artifactUuid ?? '',
    taskUuid: result.taskUuid ?? '',
    sourceAssetUuid: result.sourceAssetUuid ?? request.assetUuid,
    transcriptPath: result.transcriptPath ?? '',
    taskOutputDir: result.taskOutputDir ?? request.outputRootDir ?? '',
    language: normalizeOptionalText(result.language) ?? request.language ?? runtime.language,
    segments,
    text,
    ffmpegExecutable: result.ffmpegExecutable ?? '',
    speechExecutable: result.speechExecutable ?? runtime.provider.engine,
  };
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

  return segments.map((segment, index) => {
    const segmentNumber = index + 1;
    if (typeof segment.text !== 'string' || !segment.text.trim()) {
      throw new Error(`AutoCut speech transcription provider requires segment ${segmentNumber} to contain recognized speech text.`);
    }

    const startMs = normalizeSegmentMilliseconds(segment.startMs, segmentNumber, 'startMs');
    const endMs = normalizeSegmentMilliseconds(segment.endMs, segmentNumber, 'endMs');
    if (endMs <= startMs) {
      throw new Error(`AutoCut speech transcription provider requires segment ${segmentNumber} endMs to be after startMs.`);
    }

    return {
      startMs,
      endMs,
      text: segment.text.trim().replace(/\s+/gu, ' '),
      ...(segment.speaker?.trim() ? { speaker: segment.speaker.trim() } : {}),
    };
  });
}

function normalizeSegmentMilliseconds(value: number, segmentNumber: number, fieldName: 'startMs' | 'endMs') {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      `AutoCut speech transcription provider requires segment ${segmentNumber} ${fieldName} to be a finite non-negative timestamp.`,
    );
  }

  return Math.round(value);
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
