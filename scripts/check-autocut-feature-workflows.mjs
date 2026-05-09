import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const rootDir = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(rootDir, relativePath));
}

const failures = [];
const pass = [];

function assertRule(condition, message) {
  if (condition) {
    pass.push(message);
  } else {
    failures.push(message);
  }
}

function assertIncludes(source, marker, message) {
  assertRule(source.includes(marker), message);
}

function normalizeLineEndings(source) {
  return source.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

function assertMatches(source, pattern, message) {
  assertRule(pattern.test(source), message);
}

function assertOpeningTagsHaveHandler(source, tagName, relativePath) {
  const openingTagPattern = new RegExp(`<${tagName}\\b[^>]*>`, 'gu');
  for (const match of source.matchAll(openingTagPattern)) {
    const tag = match[0];
    assertRule(
      /\bonClick\s*=/u.test(tag),
      `${relativePath} interactive <${tagName}> tag has an onClick handler: ${tag.replace(/\s+/gu, ' ').slice(0, 140)}`,
    );
  }
}

const processingWorkflows = [
  {
    name: 'slicer',
    page: 'packages/sdkwork-autocut-slicer/src/pages/SlicerPage.tsx',
    service: 'packages/sdkwork-autocut-slicer/src/service/slicerService.ts',
    processFn: 'processVideoSlice',
    pageMarkers: ['NativeSmartSliceVideoPreview', "listenAutoCutEvent('taskUpdated'", "listenAutoCutEvent('taskAdded'", 'setActiveLeftTab("tasks")', 'navigate(`/tasks/${task.id}`)', 'formatAutoCutTimeOfDay(task.createdAt)'],
    serviceMarkers: [
      'addTask',
      'failAutoCutUnsupportedNativeProcessingTask',
      'addAsset',
      'addMessage',
      'sliceResults',
      'getAutoCutNativeHostClient',
      'resolveAutoCutTrustedSourcePath',
      'createAutoCutOpenAiCompatibleChatCompletion',
      'resolveAutoCutOutputRootDir',
      'transcribeAutoCutMediaWithConfiguredProvider',
      'AutoCutSpeechTranscriptionSegment',
      'sliceVideo',
      'renderProfile',
      'createAssetUrl',
      'thumbnailArtifactPath',
      'createTranscriptAssistedSlicePlan',
      'buildTranscriptSliceCandidates',
      'parseLlmSlicePlan',
      'toNativeSliceClipRequest',
      'plannedClips[index]',
    ],
    planningKernel: 'packages/sdkwork-autocut-slicer/src/service/slicePlanner.ts',
    planningMarkers: [
      'createTranscriptAssistedSlicePlan',
      'getVideoSlicePlanningPolicy',
      'sliceCountMode',
      'targetSliceCount',
      'idealDurationMs',
      'continuityJoinGapMs',
      'continuityOverlapToleranceMs',
      'customKeywords',
      'sourceDurationMs',
      'normalizeCandidateSlicePlan',
      'normalizeCandidateSlicePlanWithQualityStandards',
      'calculateClipOverlapRatio',
      'inferTranscriptStoryShape',
      'source-duration-tail',
      'missing-payoff',
      'fallbackDurationMs',
      'qualityScore',
      'continuityScore',
      'storyShape',
      'sourceStartMs',
      'sourceEndMs',
      'createDeterministicSliceMetadata',
      'createTranscriptSliceMetadata',
      'endsWithWeakConnector',
      'endsWithTerminalPunctuation',
      'canTreatAsOpenSentence',
      'trailing-connector-extended',
      'open-sentence-extended',
      'transcript-overlap-repaired',
      'llm-timing-snapped-to-transcript',
      'findBestOverlappingTranscriptCandidate',
      'selectOptimalSliceCandidateSet',
      'calculateSliceCandidateSetScore',
      'compareSliceCandidateSets',
      'filterRepeatedTranscriptCandidates',
      'areTranscriptSliceClipsRepeated',
      'normalizeTranscriptTextForRepeatDetection',
      'normalizeTranscriptSegmentTextForPlanning',
      'isLowInformationTranscriptFillerSegment',
      'calculateTranscriptTokenOverlapScore',
      'extractTranscriptRepeatTokens',
      'transcript-repeat-filtered',
      'NON_PUBLISHABILITY_PENALTY_RISKS',
      'short-video',
    ],
  },
  {
    name: 'extractor-text',
    page: 'packages/sdkwork-autocut-extractor-text/src/pages/ExtractorTextPage.tsx',
    service: 'packages/sdkwork-autocut-extractor-text/src/service/extractorTextService.ts',
    processFn: 'processExtractorText',
    pageMarkers: ['downloadExtractedTextFile', 'writeAutoCutClipboardText', "listenAutoCutEvent('taskUpdated'", 'setActiveTaskId'],
    serviceMarkers: [
      'addTask',
      'failAutoCutUnsupportedNativeProcessingTask',
      'addAsset',
      'addMessage',
      'extractedText',
      'getAutoCutNativeHostClient',
      'resolveAutoCutTrustedSourcePath',
      'resolveAutoCutOutputRootDir',
      'transcribeAutoCutMediaWithConfiguredProvider',
      'importMediaFile',
      'createNativeExtractedTextSegments',
      'normalizeExtractedTranscriptText',
      "params.format",
    ],
  },
  {
    name: 'extractor-audio',
    page: 'packages/sdkwork-autocut-extractor-audio/src/pages/AudioExtractorPage.tsx',
    service: 'packages/sdkwork-autocut-extractor-audio/src/service/audioExtractorService.ts',
    processFn: 'processAudioExtraction',
    pageMarkers: ['downloadAutoCutUrl', "listenAutoCutEvent('taskUpdated'", 'setActiveTaskId'],
    serviceMarkers: [
      'addTask',
      'failAutoCutUnsupportedNativeProcessingTask',
      'addAsset',
      'addMessage',
      'audioUrl',
      'getAutoCutNativeHostClient',
      'resolveAutoCutTrustedSourcePath',
      'resolveAutoCutOutputRootDir',
      'importMediaFile',
      'extractAudio',
      'assertAutoCutNativeArtifactInsideTaskOutputDir',
      'createAssetUrl',
    ],
  },
  {
    name: 'video-gif',
    page: 'packages/sdkwork-autocut-video-gif/src/pages/VideoGifPage.tsx',
    service: 'packages/sdkwork-autocut-video-gif/src/service/videoGifService.ts',
    processFn: 'processVideoGif',
    pageMarkers: ['downloadAutoCutUrl', "listenAutoCutEvent('taskUpdated'", 'setActiveTaskId'],
    serviceMarkers: [
      'addTask',
      'failAutoCutUnsupportedNativeProcessingTask',
      'addAsset',
      'addMessage',
      'gifUrl',
      'getAutoCutNativeHostClient',
      'resolveAutoCutTrustedSourcePath',
      'generateGif',
      'assertAutoCutNativeArtifactInsideTaskOutputDir',
      'createAssetUrl',
    ],
  },
  {
    name: 'video-compress',
    page: 'packages/sdkwork-autocut-video-compress/src/pages/VideoCompressPage.tsx',
    service: 'packages/sdkwork-autocut-video-compress/src/service/videoCompressService.ts',
    processFn: 'processVideoCompress',
    pageMarkers: ['downloadAutoCutUrl', 'openAutoCutPreviewUrl', "listenAutoCutEvent('taskUpdated'", 'setActiveTaskId'],
    serviceMarkers: [
      'addTask',
      'failAutoCutUnsupportedNativeProcessingTask',
      'addAsset',
      'addMessage',
      'videoUrl',
      'fileSizeStats',
      'getAutoCutNativeHostClient',
      'resolveAutoCutTrustedSourcePath',
      'compressVideo',
      'assertAutoCutNativeArtifactInsideTaskOutputDir',
      'createAssetUrl',
    ],
  },
  {
    name: 'video-convert',
    page: 'packages/sdkwork-autocut-video-convert/src/pages/VideoConvertPage.tsx',
    service: 'packages/sdkwork-autocut-video-convert/src/service/videoConvertService.ts',
    processFn: 'processVideoConvert',
    pageMarkers: ['downloadAutoCutUrl', "listenAutoCutEvent('taskUpdated'", 'setActiveTaskId'],
    serviceMarkers: [
      'addTask',
      'failAutoCutUnsupportedNativeProcessingTask',
      'addAsset',
      'addMessage',
      'videoUrl',
      'getAutoCutNativeHostClient',
      'resolveAutoCutTrustedSourcePath',
      'convertVideo',
      'assertAutoCutNativeArtifactInsideTaskOutputDir',
      'createAssetUrl',
    ],
  },
  {
    name: 'video-enhance',
    page: 'packages/sdkwork-autocut-video-enhance/src/pages/VideoEnhancePage.tsx',
    service: 'packages/sdkwork-autocut-video-enhance/src/service/videoEnhanceService.ts',
    processFn: 'processVideoEnhance',
    pageMarkers: ['downloadAutoCutUrl', "listenAutoCutEvent('taskUpdated'", 'setActiveTaskId'],
    serviceMarkers: [
      'addTask',
      'failAutoCutUnsupportedNativeProcessingTask',
      'addAsset',
      'addMessage',
      'videoUrl',
      'getAutoCutNativeHostClient',
      'resolveAutoCutTrustedSourcePath',
      'enhanceVideo',
      'assertAutoCutNativeArtifactInsideTaskOutputDir',
      'createAssetUrl',
    ],
  },
  {
    name: 'subtitle-translate',
    page: 'packages/sdkwork-autocut-subtitle-translate/src/pages/SubtitleTranslatePage.tsx',
    service: 'packages/sdkwork-autocut-subtitle-translate/src/service/subtitleTranslateService.ts',
    processFn: 'processSubtitleTranslate',
    pageMarkers: ['downloadAutoCutUrl', "listenAutoCutEvent('taskUpdated'", 'setActiveTaskId'],
    producesGeneratedAssets: false,
    returnsSuccess: false,
    serviceMarkers: ['addTask', 'failAutoCutUnsupportedNativeProcessingTask', 'sourceFileId: params.fileId'],
  },
  {
    name: 'voice-translate',
    page: 'packages/sdkwork-autocut-voice-translate/src/pages/VoiceTranslatePage.tsx',
    service: 'packages/sdkwork-autocut-voice-translate/src/service/voiceTranslateService.ts',
    processFn: 'processVoiceTranslate',
    pageMarkers: ['downloadAutoCutUrl', "listenAutoCutEvent('taskUpdated'", 'setActiveTaskId'],
    producesGeneratedAssets: false,
    returnsSuccess: false,
    serviceMarkers: ['addTask', 'failAutoCutUnsupportedNativeProcessingTask', 'sourceFileId: params.fileId'],
  },
];

for (const workflow of processingWorkflows) {
  const pageSource = read(workflow.page);
  const serviceSource = read(workflow.service);
  assertIncludes(serviceSource, `export async function ${workflow.processFn}`, `${workflow.name} exports its processing workflow function`);
  assertIncludes(pageSource, `${workflow.processFn}(`, `${workflow.name} page invokes its processing workflow function`);
  assertIncludes(serviceSource, 'AUTOCUT_TASK_STATUS.pending', `${workflow.name} service creates a pending task`);
  if (workflow.returnsSuccess !== false) {
    assertRule(
      serviceSource.includes('return { success: true, taskId: newTask.id }') ||
        serviceSource.includes('return { success: true, taskId: durableTaskId }'),
      `${workflow.name} service returns a task id result contract`,
    );
    assertIncludes(
      serviceSource,
      'failAutoCutProcessingTask(',
      `${workflow.name} service rejects native command failures instead of returning success`,
    );
    if (workflow.name === 'slicer') {
      assertIncludes(
        serviceSource,
        'createVideoSliceFailureDiagnostics(error)',
        'slicer service persists full smart-slice failure diagnostics with stack traces',
      );
    }
  }
  assertIncludes(
    serviceSource,
    'validateAutoCutProcessingSource',
    `${workflow.name} service validates source media before creating a task`,
  );
  if (workflow.name === 'slicer') {
    assertIncludes(
      serviceSource,
      'allowExternalUrl: true',
      'slicer service explicitly allows http and https external source URLs',
    );
  }
  for (const marker of workflow.pageMarkers) {
    assertIncludes(pageSource, marker, `${workflow.name} page contains workflow marker ${marker}`);
  }
  for (const marker of workflow.serviceMarkers) {
    assertIncludes(serviceSource, marker, `${workflow.name} service contains workflow marker ${marker}`);
  }
  if (workflow.planningKernel) {
    const planningSource = read(workflow.planningKernel);
    for (const marker of workflow.planningMarkers) {
      assertIncludes(planningSource, marker, `${workflow.name} planning kernel contains workflow marker ${marker}`);
    }
  }
  assertIncludes(pageSource, 'TaskFailureState', `${workflow.name} page renders a standard failed task state`);
  assertRule(
    !/className="[^"]*\bhidden\b[^"]*"[\s\S]{0,160}<TaskFailureState/u.test(pageSource),
    `${workflow.name} page does not hide TaskFailureState to satisfy workflow contracts`,
  );
  assertIncludes(pageSource, 'AUTOCUT_TASK_STATUS.failed', `${workflow.name} page handles failed task status`);
  assertRule(
    pageSource.includes('activeTask.errorMessage') || pageSource.includes('task.errorMessage'),
    `${workflow.name} page displays the task error message`,
  );
  assertIncludes(
    pageSource,
    'getAutoCutProcessingTaskErrorTaskId',
    `${workflow.name} page can surface persisted failed tasks created by fail-closed processing`,
  );
  if (workflow.name !== 'slicer') {
    assertIncludes(
      pageSource,
      'const isProcessing = Boolean(activeTaskId) && (!activeTask || isAutoCutTaskActiveStatus(activeTask.status));',
      `${workflow.name} page treats submitted-but-not-loaded tasks as processing`,
    );
    assertIncludes(
      pageSource,
      'activeTaskId && (',
      `${workflow.name} page renders the task workflow area immediately after task submission`,
    );
    assertRule(
      !pageSource.includes('isProcessing && activeTask &&'),
      `${workflow.name} page does not suppress the processing view before task details load`,
    );
    assertIncludes(
      pageSource,
      'activeTask?.progress || 0',
      `${workflow.name} page can render progress safely before task details load`,
    );
  }
}

const taskFailureState = read('packages/sdkwork-autocut-commons/src/components/TaskFailureState.tsx');
assertIncludes(taskFailureState, "variant?: 'full' | 'compact'", 'TaskFailureState exposes full and compact variants');
assertIncludes(taskFailureState, "variant = 'full'", 'TaskFailureState defaults to the full failure view');
assertIncludes(taskFailureState, "variant === 'compact'", 'TaskFailureState renders a compact task-list failure view');
assertIncludes(
  taskFailureState,
  'onCopyErrorMessage: (message: string) => Promise<void> | void',
  'TaskFailureState requires callers to provide the standard failed-task clipboard writer',
);
assertIncludes(
  taskFailureState,
  'onCopyErrorMessage(displayErrorMessage)',
  'TaskFailureState copies the exact visible failed-task error message',
);
assertIncludes(
  taskFailureState,
  'failureDiagnostics',
  'TaskFailureState accepts detailed failed-task diagnostics for engineering troubleshooting',
);
assertIncludes(
  taskFailureState,
  'createTaskFailureClipboardMessage',
  'TaskFailureState builds a single clipboard payload containing the visible error and diagnostics',
);
assertIncludes(
  taskFailureState,
  'onCopyErrorMessage(createTaskFailureClipboardMessage(displayErrorMessage, failureDiagnostics))',
  'TaskFailureState copies the full failed-task diagnostic payload instead of only the visible summary when diagnostics exist',
);
assertIncludes(
  taskFailureState,
  'event.stopPropagation()',
  'TaskFailureState copy action does not trigger parent task-card navigation',
);
assertIncludes(taskFailureState, '复制失败信息', 'TaskFailureState renders a clear failed-task copy action');

const taskFailureStateConsumerPaths = [
  'packages/sdkwork-autocut-extractor-audio/src/pages/AudioExtractorPage.tsx',
  'packages/sdkwork-autocut-extractor-text/src/pages/ExtractorTextPage.tsx',
  'packages/sdkwork-autocut-slicer/src/pages/SlicerPage.tsx',
  'packages/sdkwork-autocut-subtitle-translate/src/pages/SubtitleTranslatePage.tsx',
  'packages/sdkwork-autocut-tasks/src/pages/TaskDetailPage.tsx',
  'packages/sdkwork-autocut-video-compress/src/pages/VideoCompressPage.tsx',
  'packages/sdkwork-autocut-video-convert/src/pages/VideoConvertPage.tsx',
  'packages/sdkwork-autocut-video-enhance/src/pages/VideoEnhancePage.tsx',
  'packages/sdkwork-autocut-video-gif/src/pages/VideoGifPage.tsx',
  'packages/sdkwork-autocut-voice-translate/src/pages/VoiceTranslatePage.tsx',
];
for (const relativePath of taskFailureStateConsumerPaths) {
  const source = read(relativePath);
  assertIncludes(source, 'writeAutoCutClipboardText', `${relativePath} imports the standard clipboard helper for failed tasks`);
  assertMatches(
    source,
    /<TaskFailureState\b[\s\S]*?onCopyErrorMessage=\{writeAutoCutClipboardText\}/u,
    `${relativePath} wires failed-task copy actions to the standard clipboard helper`,
  );
}

const slicerPage = read('packages/sdkwork-autocut-slicer/src/pages/SlicerPage.tsx');
assertIncludes(
  slicerPage,
  '<TaskFailureState',
  'Slicer renders a visible compact task failure state',
);
assertMatches(
  slicerPage,
  /<TaskFailureState\b[\s\S]*?variant="compact"[\s\S]*?errorMessage=\{task\.errorMessage\}/u,
  'Slicer passes failed task messages into the compact task failure state',
);
assertIncludes(slicerPage, 'useSearchParams', 'Slicer reads router search params for external video links');
assertIncludes(slicerPage, "searchParams.get('url')", 'Slicer reads the external source URL query parameter');
assertIncludes(slicerPage, 'useState(initialSourceUrl)', 'Slicer stores the external source URL from navigation state');
assertIncludes(slicerPage, 'sliceParams.url = sourceUrl', 'Slicer passes the external source URL into the slicing workflow');
assertIncludes(slicerPage, "const [targetPlatform, setTargetPlatform]", 'Slicer stores a target publishing platform for smart slicing');
assertIncludes(slicerPage, "const [sliceCountMode, setSliceCountMode]", 'Slicer stores a smart slice count strategy mode');
assertIncludes(slicerPage, "const [targetSliceCount, setTargetSliceCount]", 'Slicer stores the requested smart slice count');
assertIncludes(slicerPage, "const [idealDuration, setIdealDuration]", 'Slicer stores the ideal smart slice duration');
assertIncludes(slicerPage, "const [continuityLevel, setContinuityLevel]", 'Slicer stores the transcript continuity level');
assertIncludes(slicerPage, "const [customKeywordsInput, setCustomKeywordsInput]", 'Slicer stores custom smart slice keywords');
assertIncludes(slicerPage, "if (targetPlatform === 'bilibili')", 'Slicer applies Bilibili horizontal publishing defaults');
assertIncludes(slicerPage, "if (targetPlatform === 'xiaohongshu')", 'Slicer applies Xiaohongshu vertical publishing defaults');
assertIncludes(slicerPage, "if (targetPlatform !== 'generic')", 'Slicer applies vertical short-video defaults for short-video platforms');
assertIncludes(slicerPage, 'targetPlatform,', 'Slicer passes targetPlatform into VideoSliceParams');
assertIncludes(slicerPage, 'targetAspectRatio: aspectRatio', 'Slicer passes the target aspect ratio into VideoSliceParams');
assertIncludes(slicerPage, 'videoObjectFit,', 'Slicer passes target object-fit into VideoSliceParams');
assertIncludes(slicerPage, 'sliceCountMode,', 'Slicer passes sliceCountMode into VideoSliceParams');
assertIncludes(slicerPage, 'targetSliceCount,', 'Slicer passes targetSliceCount into VideoSliceParams');
assertIncludes(slicerPage, 'idealDuration,', 'Slicer passes idealDuration into VideoSliceParams');
assertIncludes(slicerPage, 'continuityLevel,', 'Slicer passes continuityLevel into VideoSliceParams');
assertIncludes(slicerPage, 'customKeywords: customKeywordsInput', 'Slicer passes custom keywords into VideoSliceParams');
assertIncludes(slicerPage, 'subtitleMode', 'Slicer exposes a standardized subtitle publishing mode');
assertIncludes(slicerPage, 'setSubtitleMode', 'Slicer lets the operator choose the subtitle publishing mode');
assertIncludes(
  slicerPage,
  'const [enableSubtitles, setEnableSubtitles] = useState(false)',
  'Slicer defaults subtitle rendering to disabled while smart slicing still requires speech-to-text',
);
assertIncludes(
  slicerPage,
  'enableSubtitles,',
  'Slicer passes the explicit subtitle rendering toggle into VideoSliceParams',
);
assertIncludes(
  slicerPage,
  "subtitleMode: enableSubtitles ? effectiveSubtitleMode : 'none'",
  'Slicer persists disabled subtitles as the canonical none mode without weakening STT planning',
);
assertIncludes(
  slicerPage,
  "setSubtitleMode((currentMode) => currentMode === 'none' ? 'both' : currentMode)",
  'Slicer repairs the latent subtitle mode when the operator re-enables subtitle rendering after a disabled run',
);
assertIncludes(
  slicerPage,
  "{ value: 'srt', label: 'SRT' }",
  'Slicer exposes SRT-only subtitle publishing when subtitle rendering is enabled',
);
assertIncludes(slicerPage, 'getAutoCutWorkflowPreferences', 'Slicer loads persisted workflow parameter preferences');
assertIncludes(slicerPage, 'saveAutoCutVideoSlicePreferences', 'Slicer persists the last-used video slice parameters before processing');
assertIncludes(slicerPage, 'createSmartSliceSubmissionDiagnostics(sliceParams)', 'Slicer creates sanitized Smart Slice submission diagnostics for console troubleshooting');
assertIncludes(slicerPage, 'reportAutoCutDiagnostic(\'warning\', \'slicer.submit\', \'Smart Slice submit params\'', 'Slicer logs Smart Slice submit parameters to the browser console');
assertIncludes(slicerPage, 'createSmartSliceFailureToastMessage(e)', 'Slicer surfaces the real Smart Slice failure reason instead of a generic parameter error');
assertIncludes(slicerPage, 'toast(createSmartSliceFailureToastMessage(e), \'error\')', 'Slicer failure toast includes the actionable underlying Smart Slice error');
assertIncludes(
  slicerPage,
  'inspectAutoCutLocalSpeechTranscriptionSetup',
  'Slicer checks local STT setup readiness before creating a smart-slice task',
);
assertIncludes(
  slicerPage,
  'initializeAutoCutLocalSpeechTranscriptionSetup',
  'Slicer starts local STT initialization from the slice button instead of creating an immediate failed task',
);
assertIncludes(
  slicerPage,
  "listenAutoCutEvent('speechTranscriptionModelDownloadProgress'",
  'Slicer listens for local STT model download progress while preflight initialization runs',
);
assertRule(
  !slicerPage.includes("listenAutoCutEvent('speechTranscriptionExecutableDownloadProgress'"),
  'Slicer does not listen for executable download progress because whisper-cli is packaged as a sidecar',
);
assertIncludes(
  slicerPage,
  'speechSetupDialogOpen',
  'Slicer renders a blocking local STT setup dialog before smart slicing when STT is not ready',
);
assertIncludes(
  slicerPage,
  'ensureSmartSliceLocalSpeechTranscriptionReady',
  'Slicer gates Smart Slice execution on verified local STT setup readiness',
);
assertMatches(
  slicerPage,
  /const speechReady = await ensureSmartSliceLocalSpeechTranscriptionReady\(\);\s+if \(!speechReady\) \{\s+return;\s+\}/u,
  'Slicer does not call processVideoSlice when local STT setup initialization cannot reach ready state',
);
assertIncludes(
  slicerPage,
  "navigate('/settings?tab=speech')",
  'Slicer local STT setup dialog provides a direct Speech-to-Text settings action when manual configuration is required',
);
assertIncludes(
  slicerPage,
  'speechModelDownloadProgress?.progress',
  'Slicer local STT setup dialog renders visible model download percentage progress',
);
assertIncludes(
  slicerPage,
  'Whisper CLI sidecar',
  'Slicer local STT setup dialog renders visible packaged whisper-cli sidecar status',
);
assertIncludes(
  slicerPage,
  'formatSmartSliceSpeechSetupBytes',
  'Slicer local STT setup dialog renders visible local STT model download byte counts',
);
assertIncludes(
  slicerPage,
  "reportAutoCutDiagnostic('warning', 'slicer.speech-setup', 'Smart Slice local STT initialization preflight'",
  'Slicer logs local STT initialization preflight details to the browser console before starting downloads',
);
assertIncludes(
  slicerPage,
  'waitForSmartSliceUiYield',
  'Slicer yields to the browser renderer before Smart Slice STT initialization and processing work begins',
);
assertIncludes(
  slicerPage,
  'NativeSmartSliceVideoPreview',
  'Slicer uses a lightweight native video preview for Smart Slice instead of defaulting to a WebGL rendering surface',
);
assertIncludes(
  slicerPage,
  'React.lazy(() => import("../components/WebGLPlayer"))',
  'Slicer lazy-loads the WebGL text overlay editor only when the operator enables overlay editing',
);
assertIncludes(
  slicerPage,
  'setWebGlTextEffectDragPayload',
  'Slicer prepares lazy WebGL drag state without statically importing the Pixi editor into the default route',
);
assertIncludes(
  slicerPage,
  'const shouldUseWebGlOverlayEditor = enableOverlayEditor && videoSrc',
  'Slicer keeps WebGL disabled during the normal transcript-assisted Smart Slice workflow',
);
assertRule(
  !slicerPage.includes('import { WebGLPlayer, WebGLPlayerRef, WebGLPlayerDragState } from "../components/WebGLPlayer"'),
  'Slicer does not statically import the Pixi/WebGL player into the default Smart Slice route',
);
assertIncludes(
  slicerPage,
  'window.requestAnimationFrame',
  'Slicer uses a browser animation frame yield so the setup dialog and progress state paint before heavy Smart Slice work',
);
assertIncludes(
  slicerPage,
  'speechSetupStatus?.defaults.modelPath',
  'Slicer local STT setup dialog shows the automatically resolved default model path',
);
assertIncludes(
  slicerPage,
  'PATH, Homebrew, apt/system paths, and common local install directories',
  'Slicer local STT setup dialog explains every automatic local whisper-cli discovery strategy before asking for manual configuration',
);
assertIncludes(
  slicerPage,
  'Package the approved whisper-cli sidecar',
  'Slicer local STT setup dialog explains the packaged sidecar requirement instead of promising runtime executable auto-install',
);
assertIncludes(
  slicerPage,
  'mt-2 break-all text-[10px] text-gray-500',
  'Slicer local STT setup dialog wraps long default model paths instead of truncating the visible download destination',
);
const speechSettingsPage = read('packages/sdkwork-autocut-settings/src/pages/SettingsPage.tsx');
assertIncludes(
  speechSettingsPage,
  'speechSetupStatus?.executable.ready === true',
  'Settings speech checklist trusts the native STT executable probe instead of treating any typed path as ready',
);
assertIncludes(
  speechSettingsPage,
  'speechSetupStatus?.model.ready === true',
  'Settings speech checklist trusts the native STT model probe instead of treating any typed path as ready',
);
assertIncludes(
  speechSettingsPage,
  'speechSetupStatus?.defaults.modelPath',
  'Settings speech page shows the automatically resolved default STT model path',
);

const slicerService = read('packages/sdkwork-autocut-slicer/src/service/slicerService.ts');
const slicerPlanningKernel = read('packages/sdkwork-autocut-slicer/src/service/slicePlanner.ts');
const tasksService = read('packages/sdkwork-autocut-services/src/service/tasks.service.ts');
assertIncludes(slicerService, 'getVideoSlicePlanningPolicy', 'Slicer service consumes the canonical smart slice planning policy');
assertIncludes(slicerService, 'reportAutoCutDiagnostic', 'Slicer service emits Smart Slice execution diagnostics to the browser console');
assertIncludes(slicerService, 'createVideoSliceStageDiagnosticPayload', 'Slicer service wraps Smart Slice stage diagnostics without leaking transcript text');
assertIncludes(slicerService, "'slicer.service'", 'Slicer service labels Smart Slice execution diagnostics with a stable console source');
assertIncludes(slicerService, 'planningPolicy', 'Slicer service includes planning policy in the LLM prompt payload');
assertIncludes(slicerService, 'requestedClipCount: planningPolicy.targetSliceCount', 'Slicer service prompts the LLM with the policy target slice count');
assertIncludes(slicerService, 'sliceCountMode: planningPolicy.sliceCountMode', 'Slicer service prompts the LLM with the slice count mode');
assertIncludes(slicerService, 'idealDurationMs: planningPolicy.idealDurationMs', 'Slicer service prompts the LLM with the ideal duration');
assertIncludes(slicerService, 'continuityJoinGapMs: planningPolicy.continuityJoinGapMs', 'Slicer service prompts the LLM with the continuity join gap');
assertIncludes(slicerService, 'continuityOverlapToleranceMs: planningPolicy.continuityOverlapToleranceMs', 'Slicer service prompts the LLM with the STT overlap tolerance used by deterministic transcript repair');
assertIncludes(slicerService, 'customKeywords: planningPolicy.customKeywords', 'Slicer service prompts the LLM with custom keywords');
assertIncludes(slicerService, 'continuityScore: candidate.continuityScore', 'Slicer service sends transcript continuity scores to the LLM planner');
assertIncludes(slicerService, 'boundaryQualityScore: candidate.boundaryQualityScore', 'Slicer service sends transcript boundary quality scores to the LLM planner');
assertIncludes(slicerService, 'hookStrength: candidate.hookStrength', 'Slicer service sends transcript hook strength grades to the LLM planner');
assertIncludes(slicerService, 'endingCompleteness: candidate.endingCompleteness', 'Slicer service sends transcript ending completeness grades to the LLM planner');
assertIncludes(slicerService, 'contentArcScore: candidate.contentArcScore', 'Slicer service sends transcript content-arc scores to the LLM planner');
assertIncludes(slicerService, 'contentArcGrade: candidate.contentArcGrade', 'Slicer service sends transcript content-arc grades to the LLM planner');
assertIncludes(slicerService, 'contentArcStages: candidate.contentArcStages', 'Slicer service sends transcript detected content-arc stages to the LLM planner');
assertIncludes(slicerService, 'contentArcMissingStages: candidate.contentArcMissingStages', 'Slicer service sends transcript missing content-arc stages to the LLM planner');
assertIncludes(slicerService, 'topicCoherenceScore: candidate.topicCoherenceScore', 'Slicer service sends transcript topic coherence scores to the LLM planner');
assertIncludes(slicerService, 'topicCoherenceGrade: candidate.topicCoherenceGrade', 'Slicer service sends transcript topic coherence grades to the LLM planner');
assertIncludes(slicerService, 'topicShiftCount: candidate.topicShiftCount', 'Slicer service sends transcript topic shift counts to the LLM planner');
assertIncludes(slicerService, 'topicKeywords: candidate.topicKeywords', 'Slicer service sends transcript topic keywords to the LLM planner');
assertIncludes(slicerService, 'platformReadinessScore: candidate.platformReadinessScore', 'Slicer service sends platform readiness scores to the LLM planner');
assertIncludes(slicerService, 'platformReadinessGrade: candidate.platformReadinessGrade', 'Slicer service sends platform readiness grades to the LLM planner');
assertIncludes(slicerService, 'platformReadinessIssues: candidate.platformReadinessIssues', 'Slicer service sends platform readiness issues to the LLM planner');
assertIncludes(slicerService, 'sentenceBoundaryIntegrityScore: candidate.sentenceBoundaryIntegrityScore', 'Slicer service sends sentence boundary integrity scores to the LLM planner');
assertIncludes(slicerService, 'sentenceBoundaryIntegrityGrade: candidate.sentenceBoundaryIntegrityGrade', 'Slicer service sends sentence boundary integrity grades to the LLM planner');
assertIncludes(slicerService, 'sentenceBoundaryIssues: candidate.sentenceBoundaryIssues', 'Slicer service sends sentence boundary issue tags to the LLM planner');
assertIncludes(slicerService, 'risks: candidate.risks', 'Slicer service sends transcript continuity repair risks to the LLM planner');
assertIncludes(slicerService, 'summary: candidate.summary', 'Slicer service sends transcript candidate summaries to the LLM planner');
assertIncludes(slicerService, 'resolveTrustedVideoSliceSourceDurationMs', 'Slicer service uses only trusted imported media duration for source-bounded planning');
assertRule(
  !slicerService.includes('resolveTranscriptPlanningDurationMs'),
  'Slicer service does not treat transcript end time as authoritative source media duration',
);
assertIncludes(slicerService, 'sourceDurationMs: sourceMedia.durationMs', 'Slicer service passes trusted source media duration into smart slice planning');
assertIncludes(
  slicerService,
  "workflowPurpose: 'smart-slice-transcript-evidence'",
  'Slicer service marks its speech-to-text task as internal Smart Slice transcript evidence instead of a user text-extraction task',
);
assertIncludes(
  slicerService,
  'SMART_SLICE_EXECUTION_STEPS',
  'Slicer service uses a canonical Smart Slice execution step plan instead of scattered progress literals',
);
assertIncludes(
  slicerService,
  'reportSmartSliceExecutionPlan',
  'Slicer service logs the full Smart Slice execution plan to the console before long-running work starts',
);
assertIncludes(
  slicerService,
  'runSmartSliceExecutionStep',
  'Slicer service wraps each Smart Slice stage with progress updates and console diagnostics',
);
assertRule(
  !slicerService.includes('progress: 35'),
  'Slicer service no longer regresses Smart Slice task progress to 35 percent during speech-to-text',
);
assertIncludes(
  slicerService,
  "'verify-artifacts'",
  'Slicer service validates native slice and subtitle artifacts in a dedicated Smart Slice verification stage before persisting results',
);
assertRule(
  slicerService.indexOf('assertNativeSliceArtifactsMatchPlan') < slicerService.indexOf('finishVideoSliceTask(completedTask, sliceResults)'),
  'Slicer service validates native slice and subtitle artifacts before persisting smart slice results',
);
assertIncludes(
  slicerService,
  'assertNativeSliceTimingMatchesPlan',
  'Slicer service rejects native slice artifacts whose timing differs from the intelligent plan',
);
assertIncludes(
  slicerService,
  'assertNativeSlicePathInsideTaskOutputDir',
  'Slicer service rejects native slice artifacts outside their task output directory',
);
assertIncludes(
  slicerService,
  'assertNativeSliceThumbnailPathInsideCoverDir',
  'Slicer service requires native smart-slice thumbnails to live in the dedicated task cover directory',
);
assertIncludes(
  slicerService,
  'assertNativeSliceTaskOutputDirMatchesResult',
  'Slicer service rejects native slice artifacts whose taskOutputDir differs from the native result output directory',
);
assertIncludes(
  slicerService,
  'nativeSlice.startMs !== plannedClip.startMs || nativeSlice.durationMs !== plannedClip.durationMs',
  'Slicer service compares native slice start and duration against each planned clip',
);
assertIncludes(
  slicerService,
  'thumbnailArtifactPath',
  'Slicer service requires thumbnail artifact paths before building smart slice preview results',
);
assertIncludes(
  slicerService,
  'assertPositiveNativeSliceNumber(nativeSlice.byteSize',
  'Slicer service rejects native smart slice artifacts with invalid byte sizes',
);
assertIncludes(
  tasksService,
  'createNativeVideoSliceProjection',
  'Tasks service uses a dedicated native smart-slice projection contract',
);
assertIncludes(
  tasksService,
  'assertAndMapNativeSliceResult',
  'Tasks service validates native smart-slice artifacts during task recovery',
);
assertIncludes(
  tasksService,
  'createInvalidNativeVideoSliceProjection',
  'Tasks service fails closed when completed native smart-slice task output is invalid',
);
assertIncludes(
  tasksService,
  'enforceRecoveredNativeVideoSliceProfessionalTranscriptEvidence',
  'Tasks service revalidates recovered native smart-slice transcript evidence after sidecar metadata merging',
);
assertIncludes(
  tasksService,
  'missing speech-to-text transcript evidence',
  'Tasks service fails closed when recovered native smart-slice artifacts have no speech-to-text evidence',
);
assertIncludes(
  tasksService,
  'AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD',
  'Tasks service uses the canonical smart-slice professional standard contract',
);
assertIncludes(
  tasksService,
  'maxTrailingSilenceMs: MAX_RECOVERED_SMART_SLICE_TRAILING_SILENCE_MS',
  'Tasks service enforces the recovered native smart-slice trailing silence limit',
);
assertIncludes(
  tasksService,
  'minTranscriptCoverageScore: MIN_RECOVERED_SMART_SLICE_TRANSCRIPT_COVERAGE_SCORE',
  'Tasks service enforces the recovered native smart-slice transcript coverage threshold',
);
assertIncludes(
  tasksService,
  'speechContinuityGrade to be strong or repaired',
  'Tasks service rejects recovered native smart-slice artifacts with weak speech continuity',
);
assertIncludes(
  tasksService,
  'transcript segment ${segmentNumber} is outside its rendered source range',
  'Tasks service rejects recovered native smart-slice transcript segments outside rendered source ranges',
);
assertIncludes(
  tasksService,
  'snapshot.status !== OPS_STATUS_COMPLETED',
  'Tasks service projects native smart-slice result fields only after native completion',
);
assertIncludes(
  tasksService,
  'assertPositiveNativeSliceCount',
  'Tasks service requires a positive native smart-slice count before projecting recovered results',
);
assertIncludes(
  tasksService,
  'sourceFileId: baseProjection.sourceFileId',
  'Tasks service keeps source asset diagnostics when native smart-slice recovery fails closed',
);
assertIncludes(
  tasksService,
  'declared slices',
  'Tasks service explains recovered native smart-slice count mismatches',
);
assertIncludes(
  tasksService,
  'thumbnailArtifactPath',
  'Tasks service requires recovered native smart-slice thumbnail artifact paths',
);
assertIncludes(
  tasksService,
  'assertPositiveNativeSliceNumber(slice.byteSize',
  'Tasks service rejects recovered native smart-slice artifacts with invalid byte sizes',
);
assertIncludes(
  tasksService,
  'assertNativeSlicePathInsideTaskOutputDir',
  'Tasks service rejects recovered native smart-slice artifacts outside their task output directory',
);
assertIncludes(
  tasksService,
  'assertNativeSliceThumbnailPathInsideCoverDir',
  'Tasks service rejects recovered native smart-slice thumbnails outside the dedicated task cover directory',
);
assertRule(
  !tasksService.includes('.filter((slice): slice is TaskSliceResult => Boolean(slice))'),
  'Tasks service does not silently filter corrupt native smart-slice artifacts during recovery',
);
assertIncludes(slicerService, 'storyShape: plannedClip.storyShape', 'Slicer service preserves hook-context-payoff story-shape metadata on slice results');
assertIncludes(slicerService, 'Do not end clips at trailing connector words', 'Slicer service tells the LLM not to end clips on incomplete speech connectors');
assertIncludes(slicerService, 'If transcript candidateWindows are present, choose candidateId', 'Slicer service tells the LLM to select repaired speech-to-text windows instead of raw midpoint timings');
assertIncludes(slicerPlanningKernel, 'createNormalizedSliceTimingMetadata', 'Slicer planner centralizes source and speech timing metadata repair');
assertIncludes(slicerPlanningKernel, 'timing-metadata-repaired', 'Slicer planner records repaired dirty timing metadata for quality review');
assertIncludes(slicerPlanningKernel, 'filterRepeatedTranscriptCandidates', 'Slicer planner removes repeated speech-to-text candidate windows before LLM planning');
assertIncludes(slicerPlanningKernel, 'areTranscriptSliceClipsRepeated', 'Slicer planner owns transcript text repeat detection for smart slicing');
assertIncludes(slicerPlanningKernel, 'normalizeTranscriptTextForRepeatDetection', 'Slicer planner normalizes transcript text before duplicate detection');
assertIncludes(slicerPlanningKernel, 'normalizeTranscriptSegmentTextForPlanning', 'Slicer planner normalizes speech-to-text filler-heavy segment text before smart slice planning');
assertIncludes(slicerPlanningKernel, 'isLowInformationTranscriptFillerSegment', 'Slicer planner drops pure filler speech-to-text segments before building candidate windows');
assertIncludes(slicerPlanningKernel, 'TRANSCRIPT_PLANNING_FILLER_PREFIX_PATTERN', 'Slicer planner owns explicit filler-prefix cleanup rules for transcript candidate titles');
assertIncludes(slicerPlanningKernel, 'TRANSCRIPT_PLANNING_FILLER_TOKEN_PATTERN', 'Slicer planner owns explicit low-information filler token detection for transcript candidate filtering');
assertIncludes(slicerPlanningKernel, 'normalizeTranscriptSliceLabelText', 'Slicer planner sanitizes transcript-derived clip titles before file naming');
assertIncludes(slicerPlanningKernel, '/[\\p{L}\\p{N}]/u.test(normalizedText)', 'Slicer planner rejects punctuation-only transcript-derived clip titles');
assertIncludes(slicerPlanningKernel, 'const fallbackLabel = createPlannerSliceLabel(index)', 'Slicer planner gives LLM-derived clips stable fallback labels when model titles are unusable');
assertIncludes(slicerPlanningKernel, 'const title = normalizeTranscriptSliceLabelText(normalizePlanText(clip?.title, 48) ?? label, label)', 'Slicer planner sanitizes LLM-derived clip titles before output file naming');
assertIncludes(slicerPlanningKernel, 'calculateTranscriptTokenOverlapScore', 'Slicer planner detects high-overlap repeated transcript windows beyond exact substrings');
assertIncludes(slicerPlanningKernel, 'firstTokens.length < 2', 'Slicer planner still evaluates short one-sentence transcript windows for repeat filtering');
assertIncludes(slicerPlanningKernel, 'containmentScore >= 0.9', 'Slicer planner requires high-containment evidence before removing short transcript near-duplicates');
assertIncludes(slicerPlanningKernel, "replace(/(?:ing|ed|es|s)$/u, '')", 'Slicer planner normalizes simple English inflections before transcript repeat filtering');
assertIncludes(slicerPlanningKernel, 'extractTranscriptRepeatTokens', 'Slicer planner tokenizes transcript text for robust repeat filtering');
assertIncludes(slicerPlanningKernel, 'selectOptimalSliceCandidateSet', 'Slicer planner globally optimizes candidate combinations instead of relying on greedy single-clip ranking');
assertIncludes(slicerPlanningKernel, 'calculateSliceCandidateSetScore', 'Slicer planner scores whole candidate sets for dynamic STT slice planning');
assertIncludes(slicerPlanningKernel, 'compareSliceCandidateSets', 'Slicer planner compares full non-overlapping candidate sets before selecting final smart slices');
assertIncludes(slicerPlanningKernel, 'transcript-repeat-filtered', 'Slicer planner preserves repeat-filter audit metadata on candidate windows and results');
assertIncludes(slicerPlanningKernel, 'transcript-overlap-repaired', 'Slicer planner preserves tiny STT overlap repair audit metadata on candidate windows and results');
assertIncludes(slicerPlanningKernel, 'NON_PUBLISHABILITY_PENALTY_RISKS', 'Slicer planner keeps repaired/audit-only transcript risks visible without over-penalizing publishability');
assertIncludes(slicerPlanningKernel, "'short-video'", 'Slicer planner groups English short-video STT keywords for topic coherence scoring');
assertIncludes(slicerService, 'const renderProfile = createVideoSliceRenderProfile(planningPolicy)', 'Slicer service creates the smart publishing render profile from planning policy');
assertIncludes(slicerService, 'renderProfile }', 'Slicer service passes the smart publishing render profile into native slicing');
assertIncludes(slicerService, 'createVideoSliceSubtitleRequest', 'Slicer service centralizes subtitle-mode projection into native slicing');
assertIncludes(slicerService, 'shouldGenerateVideoSliceSubtitles', 'Slicer service separates required STT planning from optional subtitle rendering');
assertIncludes(slicerService, 'params.enableSubtitles === true', 'Slicer service only requests native subtitle rendering after explicit user opt-in');
assertIncludes(slicerService, "subtitleMode === 'srt'", 'Slicer service preserves SRT-only subtitle publishing when enabled');
assertIncludes(
  slicerService,
  "if (params.enableSubtitles === true && params.subtitleMode === 'none')",
  'Slicer service fails closed when the UI or caller sends contradictory subtitle enablement parameters',
);
assertIncludes(slicerService, 'assertNativeSliceSubtitleArtifactMatchesRequest', 'Slicer service validates native subtitle artifacts against the explicit subtitle request');
assertIncludes(
  slicerService,
  'subtitle artifact was returned even though subtitle rendering was not requested',
  'Slicer service rejects unrequested native subtitle sidecars when subtitles are disabled',
);
assertIncludes(
  slicerService,
  'is missing the requested SRT subtitle artifact',
  'Slicer service fails closed if enabled SRT subtitle rendering does not return sidecar artifacts',
);
assertIncludes(
  slicerService,
  'Smart slicing requires successful speech-to-text transcription before planning clips',
  'Slicer service fails closed when required STT is unavailable before planning',
);
assertIncludes(slicerService, 'createCandidateCenteredTranscriptTimeline', 'Slicer service samples transcript timeline context around candidate windows for long videos');
assertRule(
  !slicerService.includes('transcriptSegments.slice(0, 80)'),
  'Slicer service does not prompt the LLM with only the first transcript segments for long videos',
);
assertIncludes(slicerService, 'outputFileName: createPlannedSliceOutputFileName(clip)', 'Slicer service sends semantic title-based file names into native smart slicing');
assertIncludes(slicerService, "clip?.title ?? clip?.label", 'Slicer service prefers AI or transcript-derived titles when naming generated slice files');
assertIncludes(slicerService, 'createAutoCutSafeFileNameStem', 'Slicer service sanitizes generated slice file names before native rendering');

const homePage = read('packages/sdkwork-autocut-home/src/pages/HomePage.tsx');
assertIncludes(homePage, 'sourceUrlInput', 'HomePage stores the external source URL input value');
assertIncludes(homePage, 'handleSubmitSourceUrl', 'HomePage routes external source URL submissions through one handler');
assertIncludes(homePage, 'encodeURIComponent(sourceUrlInput.trim())', 'HomePage preserves the submitted external source URL in navigation');
assertIncludes(homePage, 'value={sourceUrlInput}', 'HomePage controls the external source URL input value');

const assetsPage = read('packages/sdkwork-autocut-assets/src/pages/AssetsPage.tsx');
assertIncludes(assetsPage, 'searchQuery', 'AssetsPage stores an asset search query');
assertMatches(assetsPage, /setSearchQuery\s*\(/u, 'AssetsPage updates the asset search query from the search input');
assertMatches(assetsPage, /filteredAssets\s*=\s*assets\.filter[\s\S]*searchQuery/u, 'AssetsPage filters visible assets by the search query');
assertIncludes(assetsPage, 'createAssetFolder', 'AssetsPage creates folders through the assets service');
assertIncludes(assetsPage, 'handleCreateFolder', 'AssetsPage has a folder creation workflow handler');
assertIncludes(assetsPage, 'handleOpenAsset', 'AssetsPage has an asset preview/open workflow handler');
assertIncludes(assetsPage, 'handleDownloadAsset', 'AssetsPage has an asset download workflow handler');
assertIncludes(assetsPage, 'refreshAssetsWorkspace', 'AssetsPage refreshes assets and storage through one workspace workflow');
assertIncludes(assetsPage, 'getStorageInfo().then(setStorageInfo)', 'AssetsPage refreshes storage information from the assets service');
assertIncludes(assetsPage, 'Download', 'AssetsPage imports a download icon for asset download actions');
assertIncludes(assetsPage, '<Download size={16}', 'AssetsPage uses a download icon for asset download actions');
assertRule(!assetsPage.includes('<MoreVertical size={16}'), 'AssetsPage does not use a menu icon for direct download actions');

const tasksPage = read('packages/sdkwork-autocut-tasks/src/pages/TasksPage.tsx');
assertIncludes(tasksPage, 'handleOpenTaskDetail', 'TasksPage wires the row detail button to an explicit open-detail workflow handler');
assertMatches(tasksPage, /handleOpenTaskDetail\([^)]*task\.id/u, 'TasksPage detail handler receives the selected task id');
assertIncludes(tasksPage, 'ArrowRight', 'TasksPage imports a direct navigation icon for detail actions');
assertIncludes(tasksPage, '<ArrowRight size={16}', 'TasksPage uses a direct navigation icon for detail actions');
assertRule(!tasksPage.includes('handleOpenTaskActions'), 'TasksPage does not name direct detail navigation as a generic actions menu');
assertRule(!tasksPage.includes('<MoreHorizontal size={16}'), 'TasksPage does not use a menu icon for direct detail navigation');
assertIncludes(tasksPage, 'selectedTaskIds', 'TasksPage stores canonical multi-select state for batch task operations');
assertIncludes(tasksPage, 'selectedTasks', 'TasksPage derives selected task records before rendering bulk actions');
assertIncludes(tasksPage, 'handleToggleTaskSelection', 'TasksPage owns a dedicated task row selection handler');
assertIncludes(tasksPage, 'handleToggleVisibleTaskSelection', 'TasksPage can select or clear every task in the current filtered view');
assertIncludes(tasksPage, 'handleBulkDeleteTasks', 'TasksPage owns a dedicated bulk delete workflow handler');
assertIncludes(tasksPage, 'handleBulkCancelTasks', 'TasksPage owns a dedicated status-aware bulk cancel workflow handler');
assertIncludes(tasksPage, 'handleBulkRetryTasks', 'TasksPage owns a dedicated status-aware bulk retry workflow handler');
assertIncludes(tasksPage, 'deleteTasks', 'TasksPage delegates bulk task deletion to the task service instead of looping UI-side deletes');
assertIncludes(tasksPage, 'cancelTasks', 'TasksPage delegates bulk task cancellation to the task service instead of mutating UI-side state');
assertIncludes(tasksPage, 'retryTasks', 'TasksPage delegates bulk task retry to the task service instead of mutating UI-side state');
assertIncludes(tasksPage, 'activeSelectedTaskIds', 'TasksPage derives active selected task ids for status-aware cancellation');
assertIncludes(tasksPage, 'failedSelectedTaskIds', 'TasksPage derives failed selected task ids for status-aware retry');
assertIncludes(tasksPage, 'aria-label="Select task"', 'TasksPage exposes accessible per-row task selection checkboxes');
assertIncludes(tasksPage, 'aria-label="Select visible tasks"', 'TasksPage exposes an accessible current-view select-all checkbox');
assertIncludes(tasksPage, 'aria-label="Cancel active selected tasks"', 'TasksPage renders an accessible compact bulk cancel command for active selected tasks');
assertIncludes(tasksPage, 'aria-label="Retry failed selected tasks"', 'TasksPage renders an accessible compact bulk retry command for failed selected tasks');
assertIncludes(tasksPage, 'aria-label="Delete selected tasks"', 'TasksPage renders an accessible compact bulk delete command');
assertIncludes(tasksPage, 'aria-label="Clear task selection"', 'TasksPage renders an accessible compact clear-selection command');
assertIncludes(tasksPage, 'aria-label="Selected task bulk actions"', 'TasksPage renders selected-task bulk actions inside the compact toolbar');
assertRule(
  tasksPage.indexOf('aria-label="Selected task bulk actions"') !== -1 &&
    tasksPage.indexOf('aria-label="Select visible tasks"') !== -1 &&
    tasksPage.indexOf('aria-label="Selected task bulk actions"') > tasksPage.indexOf('aria-label="Select visible tasks"') &&
    tasksPage.indexOf('aria-label="Selected task bulk actions"') < tasksPage.indexOf('Type</span>'),
  'TasksPage renders selected-task bulk actions in the same toolbar row instead of adding a second header row',
);
assertRule(!tasksPage.includes('justify-between gap-3 rounded-md border border-blue-500/20'), 'TasksPage does not add a second header row when tasks are selected');
assertRule(!tasksPage.includes('rounded-md border border-blue-500/20 bg-blue-500/5 px-3 py-2'), 'TasksPage does not render a full-width selected-task banner');
assertIncludes(tasksPage, 'formatAutoCutDateTime', 'TasksPage imports the canonical local datetime formatter for task timestamps');
assertIncludes(tasksPage, 'formatAutoCutDateTime(task.createdAt)', 'TasksPage renders task row creation time through the canonical local datetime formatter');
assertRule(!tasksPage.includes('<Clock size={12} /> {task.createdAt}'), 'TasksPage does not render raw UTC/native task timestamps in the task row');
assertIncludes(tasksPage, 'Task queue', 'TasksPage uses a compact workbench title instead of a large page hero');
assertIncludes(tasksPage, 'min-h-0 p-4 md:p-5', 'TasksPage keeps the task center page chrome compact');
assertIncludes(tasksPage, 'border-b border-[#222] px-3 py-2', 'TasksPage renders a compact toolbar header');
assertIncludes(tasksPage, 'aria-label="Task status filter"', 'TasksPage exposes the compact status filter as a toolbar control');
assertRule(
  tasksPage.indexOf('aria-label="Task status filter"') !== -1 &&
    tasksPage.indexOf('Task queue') !== -1 &&
    tasksPage.indexOf('aria-label="Task status filter"') < tasksPage.indexOf('Task queue'),
  'TasksPage keeps the status tabs as the leftmost toolbar control before the queue title',
);
assertIncludes(tasksPage, 'ml-auto', 'TasksPage pushes secondary toolbar actions away from the left-aligned status tabs');
assertRule(!tasksPage.includes('Track every processing task from one canonical queue.'), 'TasksPage does not spend vertical space on descriptive hero copy');
assertRule(!tasksPage.includes('text-2xl font-bold'), 'TasksPage does not use hero-sized typography in the task workbench header');
assertRule(!tasksPage.includes('space-y-8'), 'TasksPage avoids large vertical gaps above the task list');
assertRule(!tasksPage.includes('pb-6'), 'TasksPage avoids oversized header bottom padding');
assertIncludes(slicerPage, 'formatAutoCutTimeOfDay(task.createdAt)', 'SlicerPage task side list renders task creation time through the canonical local time-of-day formatter');
assertRule(!slicerPage.includes("task.createdAt.split(' ')[1]"), 'SlicerPage task side list does not split raw task timestamps');

const taskDetailPage = read('packages/sdkwork-autocut-tasks/src/pages/TaskDetailPage.tsx');
const autocutTypes = read('packages/sdkwork-autocut-types/src/index.ts');
assertIncludes(autocutTypes, 'sourceTaskId?: string', 'AppAsset records the source task id for generated assets');
assertIncludes(autocutTypes, 'sourceTaskType?: TaskType', 'AppAsset records the source task type for generated assets');
assertIncludes(autocutTypes, 'generatedAssetIds?: string[]', 'AppTask records generated asset ids for task result traceability');
assertIncludes(taskDetailPage, 'REPROCESS_ROUTES: Record<TaskType, string>', 'TaskDetailPage keeps a typed reprocess route map');
assertIncludes(taskDetailPage, "navigate('/assets')", 'TaskDetailPage result fallback opens the generated assets area');
assertIncludes(taskDetailPage, 'downloadTaskExecutionResultFile', 'TaskDetailPage can export fallback task execution results');
assertIncludes(taskDetailPage, 'TaskFailureState', 'TaskDetailPage renders the standard failed task state');
assertIncludes(taskDetailPage, 'task.status === AUTOCUT_TASK_STATUS.failed', 'TaskDetailPage branches failed tasks before pending or processing views');
assertIncludes(taskDetailPage, 'errorMessage={task.errorMessage}', 'TaskDetailPage passes task error messages into the failed task state');
assertIncludes(taskDetailPage, 'createTaskReprocessState', 'TaskDetailPage prepares route state for reprocessing failed tasks');
assertIncludes(taskDetailPage, 'initialFileId: task.sourceFileId', 'TaskDetailPage reprocesses failed smart slices from the original native source asset');
assertIncludes(taskDetailPage, 'onRetry={() => handleReprocessTask(task)}', 'TaskDetailPage failed task retry opens the owning workflow instead of hiding diagnostics');
assertIncludes(taskDetailPage, 'downloadSmartSliceTaskEvidenceFile', 'TaskDetailPage exports completed smart slice task evidence for release quality gates');
assertIncludes(taskDetailPage, 'handleDownloadSmartSliceTaskEvidence', 'TaskDetailPage owns a dedicated smart slice quality evidence export workflow');
assertIncludes(taskDetailPage, '_smart-slice-task.json', 'TaskDetailPage downloads smart slice task evidence with the release gate filename suffix');
assertIncludes(taskDetailPage, 'openAutoCutNativeArtifactInFolder', 'TaskDetailPage opens generated task artifacts through the trusted native host command');
assertIncludes(taskDetailPage, 'handleOpenSliceArtifactInFolder', 'TaskDetailPage owns a dedicated generated slice containing-folder workflow');
assertIncludes(taskDetailPage, 'slice.artifactPath', 'TaskDetailPage uses persisted native slice artifact paths instead of reverse-parsing asset URLs');
assertIncludes(taskDetailPage, '<FolderOpen size={14}', 'TaskDetailPage uses a direct folder icon button for each generated slice artifact');
assertIncludes(taskDetailPage, 'handleSlicePreviewSelect', 'TaskDetailPage routes slice preview clicks through a dedicated selection handler');
assertIncludes(taskDetailPage, 'onClick={() => handleSlicePreviewSelect(slice.id)}', 'TaskDetailPage lets each generated slice select its own preview video');
assertIncludes(taskDetailPage, 'const selectedSlice = sliceResults.find((slice) => slice.id === activePreviewUrl) ?? sliceResults[0] ?? null', 'TaskDetailPage resolves the selected slice result before rendering the player');
assertIncludes(taskDetailPage, 'videoKey={selectedSlice.id}', 'TaskDetailPage remounts the video player when a different slice is selected');
assertIncludes(taskDetailPage, 'src={selectedSlice.url}', 'TaskDetailPage plays the selected slice artifact URL instead of a shared placeholder');
assertIncludes(taskDetailPage, 'function TaskVideoPreview', 'TaskDetailPage uses one standardized video preview component for task videos');
assertIncludes(taskDetailPage, 'task-detail-video-preview-shell', 'TaskDetailPage wraps videos in a stable adaptive preview shell');
assertIncludes(taskDetailPage, 'task-detail-video-preview-media', 'TaskDetailPage marks the actual media element for preview quality checks');
assertIncludes(taskDetailPage, 'object-contain', 'TaskDetailPage video previews preserve the complete video frame without cropping');
assertRule(!taskDetailPage.includes('object-cover'), 'TaskDetailPage never crops task videos or slice thumbnails in preview surfaces');
assertIncludes(taskDetailPage, 'task-detail-slice-thumbnail-media', 'TaskDetailPage slice thumbnails use the same complete-frame preview rule');
assertIncludes(taskDetailPage, 'playsInline', 'TaskDetailPage video previews play inline inside the stable preview shell');
assertIncludes(taskDetailPage, 'loading="lazy"', 'TaskDetailPage lazily loads smart slice thumbnails for large slice sets');
assertIncludes(taskDetailPage, 'decoding="async"', 'TaskDetailPage decodes smart slice thumbnails asynchronously to reduce preview list jank');
assertIncludes(taskDetailPage, 'max-h-[62vh]', 'TaskDetailPage video preview shell is bounded by viewport height to prevent layout jumps');
assertIncludes(taskDetailPage, 'max-h-[34%]', 'TaskDetailPage keeps smart slice review metadata scrollable instead of squeezing the preview video');
assertIncludes(taskDetailPage, 'formatSliceScore(selectedSlice.qualityScore)', 'TaskDetailPage displays AI quality score for the selected smart slice');
assertIncludes(taskDetailPage, 'formatSliceScore(selectedSlice.continuityScore)', 'TaskDetailPage displays AI continuity score for the selected smart slice');
assertIncludes(taskDetailPage, 'formatSliceStoryShape(selectedSlice.storyShape)', 'TaskDetailPage displays AI story-shape completeness for the selected smart slice');
assertIncludes(taskDetailPage, 'formatPublishabilityGrade(selectedSlice.publishabilityGrade)', 'TaskDetailPage displays AI publishability grades for selected smart slices');
assertIncludes(taskDetailPage, 'formatSliceBoundaryGrade(selectedSlice.hookStrength)', 'TaskDetailPage displays smart slice hook strength grades');
assertIncludes(taskDetailPage, 'formatSliceBoundaryGrade(selectedSlice.endingCompleteness)', 'TaskDetailPage displays smart slice ending completeness grades');
assertIncludes(taskDetailPage, 'formatSliceScore(selectedSlice.contentArcScore)', 'TaskDetailPage displays smart slice content-arc scores');
assertIncludes(taskDetailPage, 'formatSliceContentArcGrade(selectedSlice.contentArcGrade)', 'TaskDetailPage displays smart slice content-arc grades');
assertIncludes(taskDetailPage, 'selectedSlice.contentArcMissingStages.map', 'TaskDetailPage displays missing smart slice content-arc stages');
assertIncludes(taskDetailPage, 'formatSliceScore(selectedSlice.topicCoherenceScore)', 'TaskDetailPage displays smart slice topic coherence scores');
assertIncludes(taskDetailPage, 'formatSliceTopicCoherenceGrade(selectedSlice.topicCoherenceGrade)', 'TaskDetailPage displays smart slice topic coherence grades');
assertIncludes(taskDetailPage, 'selectedSlice.topicKeywords.map', 'TaskDetailPage displays smart slice topic keywords');
assertIncludes(taskDetailPage, 'formatPlatformReadinessGrade(selectedSlice.platformReadinessGrade)', 'TaskDetailPage displays platform readiness grades');
assertIncludes(taskDetailPage, 'selectedSlice.platformReadinessIssues.map', 'TaskDetailPage displays platform readiness issue tags');
assertIncludes(taskDetailPage, 'formatSentenceBoundaryIntegrityGrade(selectedSlice.sentenceBoundaryIntegrityGrade)', 'TaskDetailPage displays sentence boundary integrity grades');
assertIncludes(taskDetailPage, 'selectedSlice.sentenceBoundaryIssues.map', 'TaskDetailPage displays sentence boundary issue tags');
assertIncludes(taskDetailPage, 'selectedSlice.publishabilityIssues.map', 'TaskDetailPage displays normalized AI publishability issue tags');
assertIncludes(taskDetailPage, 'selectedSlice.summary', 'TaskDetailPage displays AI smart slice summaries');
assertIncludes(taskDetailPage, 'selectedSlice.reason', 'TaskDetailPage displays AI smart slice selection reasons');
assertIncludes(taskDetailPage, 'selectedSlice.risks.map', 'TaskDetailPage displays AI publishing risk tags');
assertIncludes(taskDetailPage, 'formatSliceSourceRange(selectedSlice.sourceStartMs, selectedSlice.sourceEndMs)', 'TaskDetailPage displays repaired source ranges for smart slices');
assertIncludes(autocutTypes, 'artifactPath?: string', 'TaskSliceResult records the trusted native video artifact path for open-containing-folder workflows');
assertIncludes(autocutTypes, 'taskOutputDir?: string', 'TaskSliceResult records the trusted native task output directory for artifact containment audits');
assertIncludes(autocutTypes, 'qualityScore?: number', 'TaskSliceResult records AI smart slice quality scores');
assertIncludes(autocutTypes, 'continuityScore?: number', 'TaskSliceResult records AI smart slice continuity scores');
assertIncludes(autocutTypes, 'storyShape?:', 'TaskSliceResult records AI smart slice story-shape completeness');
assertIncludes(autocutTypes, 'publishabilityScore?: number', 'TaskSliceResult records composite AI smart slice publishability scores');
assertIncludes(autocutTypes, "publishabilityGrade?: 'excellent' | 'good' | 'review' | 'reject'", 'TaskSliceResult records AI smart slice publishability grades');
assertIncludes(autocutTypes, 'publishabilityIssues?: string[]', 'TaskSliceResult records normalized AI smart slice publishability issue tags');
assertIncludes(autocutTypes, 'boundaryQualityScore?: number', 'TaskSliceResult records AI smart slice boundary quality scores');
assertIncludes(autocutTypes, "hookStrength?: 'strong' | 'contextual' | 'weak'", 'TaskSliceResult records AI smart slice hook strength grades');
assertIncludes(autocutTypes, "endingCompleteness?: 'complete' | 'soft' | 'open'", 'TaskSliceResult records AI smart slice ending completeness grades');
assertIncludes(autocutTypes, 'contentArcScore?: number', 'TaskSliceResult records AI smart slice content-arc scores');
assertIncludes(autocutTypes, "contentArcGrade?: 'complete' | 'partial' | 'thin'", 'TaskSliceResult records AI smart slice content-arc grades');
assertIncludes(autocutTypes, "contentArcStages?: Array<'hook' | 'setup' | 'conflict' | 'payoff'>", 'TaskSliceResult records detected smart slice content-arc stages');
assertIncludes(autocutTypes, "contentArcMissingStages?: Array<'hook' | 'setup' | 'conflict' | 'payoff'>", 'TaskSliceResult records missing smart slice content-arc stages');
assertIncludes(autocutTypes, 'topicCoherenceScore?: number', 'TaskSliceResult records AI smart slice topic coherence scores');
assertIncludes(autocutTypes, "topicCoherenceGrade?: 'strong' | 'mixed' | 'weak'", 'TaskSliceResult records AI smart slice topic coherence grades');
assertIncludes(autocutTypes, 'topicShiftCount?: number', 'TaskSliceResult records AI smart slice topic shift counts');
assertIncludes(autocutTypes, 'topicKeywords?: string[]', 'TaskSliceResult records AI smart slice topic keywords');
assertIncludes(autocutTypes, 'platformReadinessScore?: number', 'TaskSliceResult records platform-specific readiness scores');
assertIncludes(autocutTypes, "platformReadinessGrade?: 'ready' | 'review' | 'reject'", 'TaskSliceResult records platform-specific readiness grades');
assertIncludes(autocutTypes, 'platformReadinessIssues?: string[]', 'TaskSliceResult records platform-specific readiness issue tags');
assertIncludes(autocutTypes, 'sentenceBoundaryIntegrityScore?: number', 'TaskSliceResult records sentence boundary integrity scores');
assertIncludes(autocutTypes, "sentenceBoundaryIntegrityGrade?: 'clean' | 'repaired' | 'broken'", 'TaskSliceResult records sentence boundary integrity grades');
assertIncludes(autocutTypes, 'sentenceBoundaryIssues?: string[]', 'TaskSliceResult records sentence boundary issue tags');
assertIncludes(autocutTypes, 'sourceStartMs?: number', 'TaskSliceResult records repaired source start metadata');
assertIncludes(autocutTypes, 'sourceEndMs?: number', 'TaskSliceResult records repaired source end metadata');
assertIncludes(autocutTypes, 'speechStartMs?: number', 'TaskSliceResult records unpadded speech start metadata');
assertIncludes(autocutTypes, 'speechEndMs?: number', 'TaskSliceResult records unpadded speech end metadata');
assertIncludes(autocutTypes, 'boundaryPaddingBeforeMs?: number', 'TaskSliceResult records leading speech boundary padding');
assertIncludes(autocutTypes, 'boundaryPaddingAfterMs?: number', 'TaskSliceResult records trailing speech boundary padding');
assertIncludes(autocutTypes, 'export interface AutoCutTranscriptSegment', 'AutoCut types define a reusable transcript segment contract');
assertIncludes(autocutTypes, 'transcriptSegments?: AutoCutTranscriptSegment[]', 'TaskSliceResult records structured speech-to-text transcript segments');
assertIncludes(autocutTypes, 'transcriptSegmentCount?: number', 'TaskSliceResult records structured speech-to-text transcript segment counts separately from subtitle artifacts');
assertIncludes(autocutTypes, 'AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD', 'AutoCut types define the canonical smart-slice professional standard');
assertIncludes(autocutTypes, 'maxLeadingSilenceMs: 200', 'AutoCut smart-slice professional standard caps leading silence at 200ms');
assertIncludes(autocutTypes, 'maxTrailingSilenceMs: 250', 'AutoCut smart-slice professional standard caps trailing silence at 250ms');
assertIncludes(autocutTypes, 'minTranscriptCoverageScore: 0.8', 'AutoCut smart-slice professional standard requires 80% transcript coverage');
assertIncludes(slicerService, 'createVideoSliceTranscriptSegments', 'Slicer service derives slice-level transcript segments from the STT timeline');
assertIncludes(slicerService, 'AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD', 'Slicer service uses the canonical smart-slice professional standard contract');
assertIncludes(slicerPlanningKernel, 'AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD', 'Slicer planner uses the canonical smart-slice professional standard contract');
assertIncludes(slicerPlanningKernel, 'maxLeadingSilenceMs: TRANSCRIPT_BOUNDARY_PADDING_BEFORE_MS', 'Slicer planner uses canonical leading speech padding for transcript windows');
assertIncludes(slicerPlanningKernel, 'minTranscriptCoverageScore: MIN_TRANSCRIPT_RENDER_SPEECH_COVERAGE_SCORE', 'Slicer planner uses canonical transcript coverage for render guards');
assertIncludes(slicerService, 'segment.endMs > sourceStartMs', 'Slicer service clips the full STT timeline down to each slice source window');
assertIncludes(slicerService, 'transcriptSegmentCount: sliceTranscriptSegments.length', 'Slicer service persists speech-to-text segment counts independent of subtitle rendering');
assertIncludes(slicerService, 'plannedClips.map((clip) => toNativeSliceClipRequest(clip, transcriptSegments))', 'Slicer service embeds slice-level STT evidence into every native clip request');
assertIncludes(slicerService, 'clipTranscriptText ? { transcriptText: clipTranscriptText }', 'Slicer service sends real transcript text, not AI summaries, in native clip requests');
assertIncludes(slicerService, 'clipTranscriptSegments.length ? { transcriptSegments: clipTranscriptSegments }', 'Slicer service sends structured transcript segments in native clip requests');
assertIncludes(slicerService, 'clip.boundaryPaddingBeforeMs !== undefined', 'Slicer service sends speech boundary padding evidence in native clip requests');
assertIncludes(slicerService, 'assertVideoSliceResultsHaveTranscripts', 'Slicer service fails closed if any completed smart slice lacks visible speech-to-text text');
assertIncludes(slicerService, 'createVideoSliceTranscriptText(sliceTranscriptSegments)', 'Slicer service rebuilds visible slice transcript text from structured segment evidence');
assertIncludes(slicerService, '!sliceResult.transcriptSegments?.length ||', 'Slicer service requires structured transcript segments instead of accepting transcriptText-only smart slices');
assertIncludes(slicerService, 'normalizeVideoSliceTranscriptEvidenceText', 'Slicer service normalizes transcript evidence before comparing rendered text');
assertIncludes(slicerService, 'transcriptText to match structured transcriptSegments', 'Slicer service rejects stale transcriptText that does not match structured STT segments');
assertIncludes(slicerService, 'speech range to match structured transcript segment boundaries', 'Slicer service rejects speech boundary metadata that is not proven by structured STT segments');
assertIncludes(slicerService, 'transcript segments to be ordered and non-overlapping', 'Slicer service rejects out-of-order or overlapping structured STT segments');
const checkSmartSliceTaskEvidence = read('scripts/check-autocut-smart-slice-task-evidence.mjs');
const writeSmartSliceQualityEvidence = read('scripts/write-autocut-smart-slice-quality-evidence.mjs');
assertIncludes(checkSmartSliceTaskEvidence, 'transcriptStructuredSegmentCount', 'smart slice task evidence validation requires structured transcript segments for every generated slice');
assertIncludes(checkSmartSliceTaskEvidence, 'transcriptTextMatchesSegments', 'smart slice task evidence validation rejects stale transcript text that is not backed by structured STT segments');
assertIncludes(checkSmartSliceTaskEvidence, 'transcriptSegmentsOrdered', 'smart slice task evidence validation rejects out-of-order or overlapping transcript segments');
assertIncludes(checkSmartSliceTaskEvidence, 'transcriptSpeechBoundaryMatches', 'smart slice task evidence validation rejects speech ranges that are not backed by transcript segment boundaries');
assertIncludes(checkSmartSliceTaskEvidence, 'AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD', 'smart slice task evidence validation uses the canonical professional standard contract');
assertIncludes(checkSmartSliceTaskEvidence, 'maximumLeadingSilenceMs = AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD.maxLeadingSilenceMs', 'smart slice task evidence blocks rendered slices with excessive leading silence');
assertIncludes(checkSmartSliceTaskEvidence, 'maximumTrailingSilenceMs = AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD.maxTrailingSilenceMs', 'smart slice task evidence blocks rendered slices with excessive trailing silence');
assertIncludes(checkSmartSliceTaskEvidence, 'SMART_SLICE_TASK_EXCESSIVE_SILENCE_BOUNDARY', 'smart slice task evidence has a dedicated excessive silence blocker');
assertIncludes(writeSmartSliceQualityEvidence, 'AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD', 'smart slice quality evidence uses the canonical professional standard contract');
assertIncludes(writeSmartSliceQualityEvidence, 'transcriptSegmentsSourceRangeReady', 'smart slice quality evidence verifies structured transcript segments stay inside each rendered source range');
assertIncludes(writeSmartSliceQualityEvidence, 'transcriptTextMatchesSegments', 'smart slice quality evidence verifies visible transcript text is backed by structured STT segments');
assertIncludes(writeSmartSliceQualityEvidence, 'transcriptSegmentsOrdered', 'smart slice quality evidence verifies structured STT segments are ordered and non-overlapping');
assertIncludes(writeSmartSliceQualityEvidence, 'transcriptSpeechBoundaryMatches', 'smart slice quality evidence verifies speech ranges are backed by transcript segment boundaries');
assertIncludes(writeSmartSliceQualityEvidence, 'maxLeadingSilenceMs: AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD.maxLeadingSilenceMs', 'smart slice quality evidence uses the professional leading silence threshold');
assertIncludes(writeSmartSliceQualityEvidence, 'maxTrailingSilenceMs: AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD.maxTrailingSilenceMs', 'smart slice quality evidence uses the professional trailing silence threshold');
assertIncludes(writeSmartSliceQualityEvidence, 'SMART_SLICE_EXCESSIVE_SILENCE_BOUNDARY', 'smart slice quality evidence blocks excessive rendered silence before release');
assertRule(!autocutTypes.includes('subtitleSegmentCount?: number'), 'TaskSliceResult does not use subtitle terminology for required speech-to-text transcript metadata');
assertRule(!slicerPlanningKernel.includes('subtitleSegmentCount'), 'Slicer planner uses transcript terminology for speech-to-text segment counts');
assertRule(!slicerPlanningKernel.includes('subtitleSegmentScore'), 'Slicer planner does not use subtitle terminology for transcript segment scoring');
assertIncludes(taskDetailPage, 'downloadSliceTranscriptFile', 'TaskDetailPage can export the selected slice speech transcript');
assertIncludes(taskDetailPage, 'selectedSlice.transcriptSegments.map', 'TaskDetailPage displays structured speech transcript segments for selected smart slices');
assertIncludes(taskDetailPage, 'formatSliceRelativeTranscriptTimestamp', 'TaskDetailPage displays slice-relative transcript timestamps for generated video review');
assertIncludes(taskDetailPage, 'formatSliceSourceTranscriptTimestamp', 'TaskDetailPage preserves source timeline timestamps in exported speech transcripts');
assertIncludes(taskDetailPage, 'segment.startMs - (selectedSlice.sourceStartMs ?? 0)', 'TaskDetailPage aligns transcript rows to the selected slice playback timeline');
assertIncludes(taskDetailPage, 'Speech transcript TXT', 'TaskDetailPage labels the slice transcript export separately from optional subtitle downloads');
assertIncludes(taskDetailPage, 'formatSliceSourceRange(selectedSlice.speechStartMs, selectedSlice.speechEndMs)', 'TaskDetailPage displays unpadded speech ranges for smart slices');
assertMatches(
  taskDetailPage,
  /<Button className="mt-4" variant="outline" onClick=\{\(\) => downloadTaskExecutionResultFile\(task, getTaskTypeLabel\(task\.type\)\)\}/u,
  'TaskDetailPage fallback result download button is wired to a real export workflow',
);
const downloadService = read('packages/sdkwork-autocut-services/src/service/download.service.ts');
assertIncludes(downloadService, 'createSmartSliceTaskEvidenceJson', 'download.service creates standardized smart slice task evidence JSON');
assertIncludes(downloadService, 'downloadSmartSliceTaskEvidenceFile', 'download.service exposes a smart slice task evidence download workflow');
assertIncludes(downloadService, '2026-05-06.autocut-smart-slice-task-evidence.v1', 'smart slice task evidence JSON has a versioned schema marker');
assertIncludes(downloadService, 'sliceResults: task.sliceResults ?? []', 'smart slice task evidence preserves the exact completed slice results');
assertIncludes(downloadService, "application/json", 'smart slice task evidence is exported as JSON instead of plain text');
const releaseChangelog = read('docs/release/CHANGELOG.md');
assertIncludes(releaseChangelog, 'pnpm release:smart-slice-sample', 'release notes document the smart slice sample evidence command');
assertIncludes(releaseChangelog, 'pnpm release:smart-slice-quality -- --task artifacts/smart-slice/smart-slice-task.json', 'release notes document the smart slice quality evidence command');
assertIncludes(releaseChangelog, 'pnpm release:smart-slice-media-artifacts -- --task artifacts/smart-slice/smart-slice-task.json', 'release notes document the smart slice media artifacts evidence command');
assertIncludes(releaseChangelog, 'pnpm release:smart-slice-task -- --task artifacts/smart-slice/smart-slice-task.json', 'release notes document the smart slice task evidence validation command');
assertIncludes(releaseChangelog, 'pnpm release:smart-slice-fixture', 'release notes document the smart slice release fixture smoke command');
assertIncludes(releaseChangelog, 'pnpm release:sign-installers', 'release notes document the installer signing execution command');
assertIncludes(releaseChangelog, 'pnpm release:preview-ready', 'release notes document the unsigned preview release readiness gate');
assertIncludes(releaseChangelog, 'unsigned preview', 'release notes document the unsigned preview release boundary');
assertIncludes(releaseChangelog, 'smart-slice-task.json', 'release notes document the smart slice task JSON evidence input');
assertIncludes(releaseChangelog, 'autocut-smart-slice-quality-evidence.json', 'release notes document the generated smart slice quality evidence file');
assertIncludes(releaseChangelog, 'autocut-smart-slice-media-artifacts-evidence.json', 'release notes document the generated smart slice media artifacts evidence file');
assertIncludes(releaseChangelog, 'autocut-smart-slice-sample-evidence.json', 'release notes document the generated smart slice sample evidence file');
assertIncludes(releaseChangelog, 'autocut-smart-slice-release-fixture.json', 'release notes document the generated smart slice release fixture report file');
assertIncludes(releaseChangelog, 'pnpm release:multiplatform-ready', 'release notes document the multiplatform preview release readiness gate');
assertIncludes(releaseChangelog, 'autocut-release-evidence-linux-x86_64.json', 'release notes document the Linux release evidence file');
assertIncludes(releaseChangelog, 'autocut-release-evidence-macos-x86_64.json', 'release notes document the Intel macOS release evidence file');
assertIncludes(releaseChangelog, 'autocut-release-evidence-macos-aarch64.json', 'release notes document the Apple Silicon macOS release evidence file');
assertIncludes(releaseChangelog, 'ubuntu-22.04', 'release notes document the Ubuntu/Linux native release runner');
assertIncludes(releaseChangelog, 'repository-root `pnpm', 'release notes document the repository-root Tauri release workflow');
assertIncludes(releaseChangelog, 'Phase 1', 'release notes document the Phase 1 preview release scope');
assertIncludes(releaseChangelog, 'Phase 2', 'release notes document the Phase 2 commercial release standard');

for (const workflow of processingWorkflows) {
  const serviceSource = read(workflow.service);
  if (workflow.producesGeneratedAssets !== false) {
    assertIncludes(serviceSource, 'sourceTaskId: newTask.id', `${workflow.name} service stores sourceTaskId on generated assets`);
    assertIncludes(serviceSource, 'sourceTaskType: newTask.type', `${workflow.name} service stores sourceTaskType on generated assets`);
    assertIncludes(serviceSource, 'generatedAssetIds', `${workflow.name} service returns generatedAssetIds to the completed task`);
  }
  assertIncludes(serviceSource, 'sourceFileId: params.fileId', `${workflow.name} service stores selected source file id on the task`);
}

const processingSourceServicePath = 'packages/sdkwork-autocut-services/src/service/processing-source.service.ts';
const settingsServicePath = 'packages/sdkwork-autocut-services/src/service/settings.service.ts';
const settingsRegistryPath = 'packages/sdkwork-autocut-settings/src/service/settings.registry.ts';
const servicesIndex = read('packages/sdkwork-autocut-services/src/index.ts');
const storageService = read('packages/sdkwork-autocut-services/src/service/storage.service.ts');
const eventsService = read('packages/sdkwork-autocut-services/src/service/events.service.ts');
const settingsPage = read('packages/sdkwork-autocut-settings/src/pages/SettingsPage.tsx');
const settingsRegistry = exists(settingsRegistryPath) ? read(settingsRegistryPath) : '';
const i18nResources = read('packages/sdkwork-autocut-services/src/service/i18n-resources.service.ts');
const settingsZhMessagesStart = i18nResources.indexOf('const AUTOCUT_SETTINGS_ZH_CN_MESSAGES');
const settingsEnMessagesStart = i18nResources.indexOf('const AUTOCUT_SETTINGS_EN_US_MESSAGES');
const settingsZhMessages = settingsZhMessagesStart >= 0 && settingsEnMessagesStart > settingsZhMessagesStart
  ? i18nResources.slice(settingsZhMessagesStart, settingsEnMessagesStart)
  : '';
const settingsEnMessages = settingsEnMessagesStart >= 0
  ? i18nResources.slice(settingsEnMessagesStart)
  : '';
const normalizedSettingsZhMessages = normalizeLineEndings(settingsZhMessages);
const normalizedSettingsEnMessages = normalizeLineEndings(settingsEnMessages);
assertRule(exists(processingSourceServicePath), '@sdkwork/autocut-services owns processing-source.service.ts');
if (exists(processingSourceServicePath)) {
  const processingSourceService = read(processingSourceServicePath);
  assertIncludes(
    processingSourceService,
    'export function validateAutoCutProcessingSource',
    'processing-source.service.ts exports validateAutoCutProcessingSource',
  );
  assertIncludes(
    processingSourceService,
    'AutoCutProcessingTaskError',
    'processing-source.service.ts exposes a typed failed-task error',
  );
  assertIncludes(
    processingSourceService,
    'failAutoCutProcessingTask',
    'processing-source.service.ts exposes a standard failed-task transition helper',
  );
  assertIncludes(
    processingSourceService,
    'getAutoCutProcessingTaskErrorTaskId',
    'processing-source.service.ts exposes a helper for reading failed task ids',
  );
  assertIncludes(
    processingSourceService,
    'allowExternalUrl?: boolean',
    'processing-source.service.ts supports explicit external URL allowance',
  );
  assertIncludes(
    processingSourceService,
    "parsed.protocol !== 'http:' && parsed.protocol !== 'https:'",
    'processing-source.service.ts rejects non-http and non-https external URLs',
  );
}
assertIncludes(servicesIndex, "export * from './service/processing-source.service'", 'services index exports processing-source.service.ts');
assertRule(exists(settingsServicePath), '@sdkwork/autocut-services owns a settings.service.ts workflow service');
if (exists(settingsServicePath)) {
  const settingsService = read(settingsServicePath);
  for (const exportName of [
    'getAutoCutSettings',
    'saveAutoCutAccountSettings',
    'saveAutoCutWorkspaceSettings',
    'saveAutoCutNotificationSettings',
    'saveAutoCutLlmSettings',
    'initializeAutoCutDefaultLlmSettingsFromEnvironment',
    'saveAutoCutSpeechTranscriptionSettings',
    'resolveAutoCutLlmRuntimeConfig',
    'resolveAutoCutSpeechTranscriptionRuntimeConfig',
    'testAutoCutSpeechTranscriptionToolchain',
    'createAutoCutApiKey',
    'revokeAutoCutApiKey',
    'clearAutoCutStorageCache',
    'requestAutoCutAvatarChange',
    'openAutoCutSubscriptionManagement',
    'requestAutoCutPasswordChange',
    'setAutoCutTwoFactorEnabled',
    'cancelAutoCutSubscription',
    'deleteAutoCutAccount',
  ]) {
    assertIncludes(settingsService, `export async function ${exportName}`, `settings.service.ts exports ${exportName}`);
  }
}
assertIncludes(servicesIndex, "export * from './service/settings.service'", 'services index exports settings.service.ts');
assertRule(exists('packages/sdkwork-autocut-services/src/service/llm.service.ts'), '@sdkwork/autocut-services owns an llm.service.ts integration boundary');
if (exists('packages/sdkwork-autocut-services/src/service/llm.service.ts')) {
  const llmService = read('packages/sdkwork-autocut-services/src/service/llm.service.ts');
  assertIncludes(
    llmService,
    'export async function createAutoCutOpenAiCompatibleChatCompletion',
    'llm.service.ts exposes a single OpenAI-compatible chat completion boundary',
  );
  assertIncludes(
    llmService,
    'export async function testAutoCutLlmConnection',
    'llm.service.ts exposes an approved-bridge LLM connection test boundary',
  );
  assertIncludes(
    llmService,
    'resolveAutoCutLlmRuntimeConfig',
    'llm.service.ts consumes normalized LLM runtime config',
  );
  assertRule(!/fetch\(/u.test(llmService), 'llm.service.ts does not bypass the AI SDK boundary with raw fetch');
  assertRule(!/Authorization/u.test(llmService), 'llm.service.ts does not assemble Authorization headers manually');
}
assertIncludes(servicesIndex, "export * from './service/llm.service'", 'services index exports llm.service.ts');
assertRule(
  exists('packages/sdkwork-autocut-services/src/service/speech-transcription.service.ts'),
  '@sdkwork/autocut-services owns a speech-transcription.service.ts provider boundary',
);
if (exists('packages/sdkwork-autocut-services/src/service/speech-transcription.service.ts')) {
  const speechTranscriptionService = read('packages/sdkwork-autocut-services/src/service/speech-transcription.service.ts');
  assertRule(
    !/export\s+interface\s+AutoCutLocalSpeechTranscriptionSetupStatus/u.test(speechTranscriptionService),
    'speech-transcription.service.ts consumes the public local STT setup status contract from @sdkwork/autocut-types',
  );
  assertRule(
    !/export\s+interface\s+AutoCutLocalSpeechTranscriptionModelSetupResult/u.test(speechTranscriptionService) &&
      !/export\s+interface\s+AutoCutLocalSpeechTranscriptionSetupInitializationResult/u.test(speechTranscriptionService),
    'speech-transcription.service.ts consumes public local STT setup result contracts from @sdkwork/autocut-types',
  );
  assertIncludes(
    speechTranscriptionService,
    'export function getAutoCutSpeechTranscriptionProviderDefinitions',
    'speech-transcription.service.ts exposes canonical STT provider definitions',
  );
  assertIncludes(
    speechTranscriptionService,
    'export function resolveAutoCutRecommendedLocalSpeechTranscriptionModelPreset',
    'speech-transcription.service.ts exposes a recommended offline local STT model preset resolver',
  );
  assertIncludes(
    speechTranscriptionService,
    'export async function setupAutoCutLocalSpeechTranscriptionModelPreset',
    'speech-transcription.service.ts exposes guided one-click local STT model setup',
  );
  assertIncludes(
    speechTranscriptionService,
    'export async function inspectAutoCutLocalSpeechTranscriptionSetup',
    'speech-transcription.service.ts exposes a product-facing local STT setup inspection status',
  );
  assertIncludes(
    speechTranscriptionService,
    'export async function initializeAutoCutLocalSpeechTranscriptionSetup',
    'speech-transcription.service.ts exposes one product-facing local STT initialization action',
  );
  assertIncludes(
    speechTranscriptionService,
    'dispatchAutoCutSpeechTranscriptionModelDownloadProgress',
    'speech-transcription.service.ts publishes visible local STT model download progress through AutoCut events',
  );
  assertIncludes(
    speechTranscriptionService,
    'isAutoCutSpeechTranscriptionModelDownloadPhase',
    'speech-transcription.service.ts validates untrusted native local STT model download phases before publishing events',
  );
  assertIncludes(
    speechTranscriptionService,
    'unsupported local speech-to-text model download phase',
    'speech-transcription.service.ts rejects unsupported native local STT model download phases with an actionable error',
  );
  assertIncludes(
    speechTranscriptionService,
    'resolveAutoCutLocalSpeechTranscriptionModelPreset(progress.presetId)',
    'speech-transcription.service.ts resolves untrusted native local STT model download progress against the canonical preset registry',
  );
  assertIncludes(
    speechTranscriptionService,
    'progress.providerId !== preset.providerId',
    'speech-transcription.service.ts rejects native local STT model download progress whose provider does not match the registered preset',
  );
  assertIncludes(
    speechTranscriptionService,
    'progress.fileName !== preset.fileName',
    'speech-transcription.service.ts rejects native local STT model download progress whose fileName does not match the registered preset',
  );
  assertIncludes(
    speechTranscriptionService,
    'isAutoCutLocalSpeechTranscriptionModelPresetDownloadUrl(preset, sourceUrl)',
    'speech-transcription.service.ts rejects native local STT model download progress whose sourceUrl is not a registered primary or vetted mirror URL',
  );
  assertIncludes(
    speechTranscriptionService,
    'model download progress did not match the registered local speech-to-text model preset',
    'speech-transcription.service.ts explains native local STT model download preset mismatches with an actionable error',
  );
  assertIncludes(
    speechTranscriptionService,
    'localProviderIds',
    'speech-transcription.service.ts reports every supported local STT provider considered by setup inspection',
  );
  assertIncludes(
    speechTranscriptionService,
    'readiness: AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.needsModel',
    'speech-transcription.service.ts distinguishes missing local STT models from missing executables',
  );
  assertIncludes(
    speechTranscriptionService,
    'initializeAutoCutLocalSpeechTranscriptionModelForExecution',
    'speech-transcription.service.ts automatically initializes the local STT model before transcript-assisted execution when only modelPath is missing',
  );
  assertIncludes(
    speechTranscriptionService,
    'Local speech-to-text executable is missing',
    'speech-transcription.service.ts reports missing local STT executable diagnostics to the browser console instead of surfacing a generic Smart Slice parameter error',
  );
  assertIncludes(
    speechTranscriptionService,
    'export function configureAutoCutSpeechTranscriptionProviderBridge',
    'speech-transcription.service.ts exposes a standard API transcription bridge configurator',
  );
  assertIncludes(
    speechTranscriptionService,
    'export async function transcribeAutoCutMediaWithConfiguredProvider',
    'speech-transcription.service.ts exposes one configured-provider transcription entrypoint',
  );
  assertIncludes(
    speechTranscriptionService,
    'export async function testAutoCutSpeechTranscriptionProvider',
    'speech-transcription.service.ts exposes one configured-provider test entrypoint',
  );
  assertIncludes(
    speechTranscriptionService,
    'provider.kind === \'local\'',
    'speech-transcription.service.ts dispatches local STT providers through the local adapter',
  );
  assertIncludes(
    speechTranscriptionService,
    'provider.kind === \'api\'',
    'speech-transcription.service.ts dispatches API STT providers through the API bridge adapter',
  );
  assertIncludes(
    speechTranscriptionService,
    'nativeHostClient.transcribeMedia',
    'speech-transcription.service.ts is the only workflow-facing service allowed to call native local transcription',
  );
  assertIncludes(
    speechTranscriptionService,
    'providerId: runtime.providerId',
    'speech-transcription.service.ts sends the selected providerId to native local transcription',
  );
  assertIncludes(
    speechTranscriptionService,
    'ensureAutoCutLocalSpeechTranscriptionExecutionReady',
    'speech-transcription.service.ts centralizes execution-time local STT model and provider readiness checks',
  );
  assertIncludes(
    speechTranscriptionService,
    'sourceKind: \'execution-preflight\'',
    'speech-transcription.service.ts performs a fresh native execution preflight probe before local STT dispatch',
  );
  assertIncludes(
    speechTranscriptionService,
    'runtime.configured && runtime.lastProbeReady !== true',
    'speech-transcription.service.ts requires settings-backed local STT paths to pass provider validation before transcription',
  );
  assertIncludes(
    speechTranscriptionService,
    'validateAutoCutLocalSpeechTranscriptionModelDownloadResult',
    'speech-transcription.service.ts rejects incomplete local STT model downloads before saving modelPath',
  );
  assertIncludes(
    speechTranscriptionService,
    'requires the matching ModelVendor',
    'speech-transcription.service.ts guides API STT users to select a supported matching provider vendor before dispatch',
  );
  assertIncludes(
    speechTranscriptionService,
    'Run the speech-to-text provider test',
    'speech-transcription.service.ts gives operators an actionable local STT validation remediation',
  );
  assertIncludes(
    speechTranscriptionService,
    'normalizeAutoCutSpeechTranscriptionSegments',
    'speech-transcription.service.ts centralizes STT provider segment normalization',
  );
  assertIncludes(
    speechTranscriptionService,
    'valid timestamped speech segments',
    'speech-transcription.service.ts rejects provider results without structured timestamped speech segments',
  );
  assertIncludes(
    speechTranscriptionService,
    'to contain recognized speech text',
    'speech-transcription.service.ts rejects provider segments without recognized speech text',
  );
  assertIncludes(
    speechTranscriptionService,
    'endMs to be after startMs',
    'speech-transcription.service.ts rejects provider segments without positive speech duration',
  );
  assertIncludes(
    speechTranscriptionService,
    'finite non-negative timestamp',
    'speech-transcription.service.ts rejects provider segments with invalid speech timestamps',
  );
  assertRule(!/fetch\(/u.test(speechTranscriptionService), 'speech-transcription.service.ts does not bypass the provider bridge with raw fetch');
  assertRule(!/Authorization/u.test(speechTranscriptionService), 'speech-transcription.service.ts does not assemble provider Authorization headers manually');
}
assertIncludes(servicesIndex, "export * from './service/speech-transcription.service'", 'services index exports speech-transcription.service.ts');
assertRule(
  !exists('packages/sdkwork-autocut-services/src/service/ai-sdk-bridge.service.ts'),
  '@sdkwork/autocut-services does not keep the deprecated generated @sdkwork/ai-sdk bridge service',
);
assertRule(
  exists('packages/sdkwork-autocut-services/src/service/vercel-ai-sdk-bridge.service.ts'),
  '@sdkwork/autocut-services owns a Vercel AI SDK bridge service',
);
if (exists('packages/sdkwork-autocut-services/src/service/vercel-ai-sdk-bridge.service.ts')) {
  const aiSdkBridgeService = read('packages/sdkwork-autocut-services/src/service/vercel-ai-sdk-bridge.service.ts');
  assertIncludes(
    aiSdkBridgeService,
    "from 'ai'",
    'vercel-ai-sdk-bridge.service.ts imports the open-source Vercel AI SDK core package',
  );
  assertIncludes(
    aiSdkBridgeService,
    "from '@ai-sdk/openai-compatible'",
    'vercel-ai-sdk-bridge.service.ts imports the OpenAI-compatible Vercel AI SDK provider',
  );
  assertIncludes(
    aiSdkBridgeService,
    'export function configureAutoCutVercelAiSdkBridge',
    'vercel-ai-sdk-bridge.service.ts exposes a desktop startup bridge configurator',
  );
  assertIncludes(
    aiSdkBridgeService,
    'configureAutoCutApprovedAiSdkBridge',
    'vercel-ai-sdk-bridge.service.ts registers through the approved LLM bridge boundary',
  );
  assertIncludes(
    aiSdkBridgeService,
    'createOpenAICompatible',
    'vercel-ai-sdk-bridge.service.ts creates a provider from the runtime OpenAI-compatible endpoint',
  );
  assertIncludes(
    aiSdkBridgeService,
    'fetchAutoCutLlmViaNativeHost',
    'vercel-ai-sdk-bridge.service.ts routes OpenAI-compatible provider transport through the Tauri native host',
  );
  assertIncludes(
    aiSdkBridgeService,
    'generateText',
    'vercel-ai-sdk-bridge.service.ts creates chat completions through the Vercel AI SDK',
  );
  assertRule(!/fetch\(/u.test(aiSdkBridgeService), 'vercel-ai-sdk-bridge.service.ts does not bypass the Vercel AI SDK with raw fetch');
  assertRule(!/Authorization/u.test(aiSdkBridgeService), 'vercel-ai-sdk-bridge.service.ts does not assemble Authorization headers manually');
  assertRule(!aiSdkBridgeService.includes('@sdkwork/ai-sdk'), 'vercel-ai-sdk-bridge.service.ts does not import @sdkwork/ai-sdk');
}
assertIncludes(servicesIndex, "export * from './service/vercel-ai-sdk-bridge.service'", 'services index exports vercel-ai-sdk-bridge.service.ts');
const desktopMain = read('packages/sdkwork-autocut-desktop/src/main.tsx');
assertIncludes(desktopMain, 'configureAutoCutVercelAiSdkBridge', 'desktop startup configures the Vercel AI SDK bridge');
assertIncludes(desktopMain, 'initializeAutoCutDefaultLlmSettingsFromEnvironment', 'desktop startup initializes default LLM settings from native environment secrets');
assertIncludes(desktopMain, '.catch(() => undefined)', 'desktop startup ignores missing optional environment LLM defaults without blocking the app');
assertIncludes(storageService, 'settings:', 'storage.service.ts declares the settings storage key');
assertIncludes(eventsService, 'settingsUpdated:', 'events.service.ts emits settingsUpdated events');
assertIncludes(settingsPage, 'getAutoCutSettings', 'SettingsPage loads settings from the settings service');
assertIncludes(settingsPage, 'saveAutoCutAccountSettings', 'SettingsPage persists account edits through the settings service');
assertIncludes(settingsPage, 'saveAutoCutWorkspaceSettings', 'SettingsPage persists workspace edits through the settings service');
assertRule(exists(settingsRegistryPath), '@sdkwork/autocut-settings owns a standard Settings Center registry');
assertIncludes(settingsRegistry, 'AUTOCUT_SETTINGS_TABS', 'Settings Center registry defines canonical tab metadata');
assertIncludes(settingsRegistry, 'AUTOCUT_SETTINGS_LOCALE_OPTIONS', 'Settings Center registry defines canonical locale selector options');
assertIncludes(settingsRegistry, 'labelKey', 'Settings Center registry stores display labels as i18n keys');
assertIncludes(settingsRegistry, 'descriptionKey', 'Settings Center registry stores descriptions as i18n keys');
assertIncludes(settingsPage, "from '../service/settings.registry'", 'SettingsPage consumes the standard Settings Center registry');
assertIncludes(settingsPage, 'AUTOCUT_SETTINGS_TABS.map', 'SettingsPage renders tabs from canonical tab metadata');
assertIncludes(settingsPage, 'AUTOCUT_SETTINGS_LOCALE_OPTIONS.map', 'SettingsPage renders application locale options from canonical metadata');
assertIncludes(settingsPage, 'useTranslation', 'SettingsPage uses the open-source i18next React integration for visible text');
assertIncludes(settingsPage, "t('settings.page.title')", 'SettingsPage localizes the Settings Center title through i18n resources');
assertIncludes(settingsPage, "t('settings.toast.accountSaved')", 'SettingsPage localizes toast messages through i18n resources');
assertIncludes(settingsPage, "t('settings.status.ready')", 'SettingsPage localizes configuration status badges through i18n resources');
assertIncludes(settingsPage, 'handleWorkspaceLanguageChange', 'SettingsPage owns a dedicated application locale switching action');
assertIncludes(settingsPage, 'settings.workspace.language', 'SettingsPage renders the persisted canonical application locale');
assertRule(!settingsPage.includes('const tabs = ['), 'SettingsPage does not define tab labels inline');
assertRule(!settingsPage.includes('Speech-to-text provider settings saved'), 'SettingsPage does not hard-code speech-to-text save messages');
assertRule(!settingsPage.includes('Absolute local executable file path'), 'SettingsPage does not hard-code local speech executable guidance');
assertRule(!settingsPage.includes('Absolute local model file path'), 'SettingsPage does not hard-code local speech model guidance');
assertIncludes(settingsPage, 'settings.workspace.outputDirectory', 'SettingsPage renders the configured native output directory');
assertIncludes(settingsPage, 'handleChangeOutputDirectory', 'SettingsPage owns a default output directory update action');
assertIncludes(settingsPage, 'selectAutoCutTrustedLocalDirectory', 'SettingsPage uses the desktop trusted local directory chooser for workspace directories');
assertIncludes(settingsPage, 'handleChangeDirectory', 'SettingsPage owns a default storage directory chooser action');
assertMatches(
  settingsPage,
  /selectAutoCutTrustedLocalDirectory\(\)[\s\S]*defaultStoragePath:\s*selectedDirectory/u,
  'SettingsPage saves the selected native directory as defaultStoragePath',
);
assertMatches(
  settingsPage,
  /selectAutoCutTrustedLocalDirectory\(\)[\s\S]*outputDirectory:\s*selectedDirectory/u,
  'SettingsPage saves the selected native directory as outputDirectory',
);
assertRule(!settingsPage.includes('\\\\Exports'), 'SettingsPage does not synthesize a Windows-only default storage path');
assertIncludes(settingsPage, 'saveAutoCutNotificationSettings', 'SettingsPage persists notification edits through the settings service');
assertIncludes(settingsPage, 'saveAutoCutLlmSettings', 'SettingsPage persists LLM edits through the settings service');
assertIncludes(settingsPage, 'saveAutoCutSpeechTranscriptionSettings', 'SettingsPage persists speech-to-text provider edits through the settings service');
assertIncludes(settingsPage, 'testAutoCutSpeechTranscriptionProvider', 'SettingsPage invokes the selected speech-to-text provider test service');
assertIncludes(settingsPage, 'selectAutoCutSpeechTranscriptionFile', 'SettingsPage uses the trusted native speech tool file chooser');
assertIncludes(settingsPage, 'handleSpeechTranscriptionProviderChange', 'SettingsPage owns a provider switching action for speech-to-text');
assertIncludes(settingsPage, 'handleTestSpeechTranscriptionProvider', 'SettingsPage owns a dedicated selected speech-to-text provider test action');
assertIncludes(settingsPage, 'isTestingSpeechTranscription', 'SettingsPage disables duplicate local speech-to-text tests while pending');
assertMatches(settingsRegistry, /id:\s*'speech'/u, 'Settings Center registry exposes a dedicated speech-to-text provider settings tab');
assertIncludes(settingsPage, 'AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER_DEFINITIONS', 'SettingsPage renders the canonical speech-to-text provider registry');
assertIncludes(settingsPage, 'settings.speechTranscription.providerId', 'SettingsPage renders and persists the selected speech-to-text provider id');
assertIncludes(settingsPage, 'activeSpeechTranscriptionProvider.kind === \'local\'', 'SettingsPage shows local executable/model fields only for local STT providers');
assertIncludes(settingsPage, 'activeSpeechTranscriptionProvider.kind === \'api\'', 'SettingsPage shows API provider guidance only for API STT providers');
assertIncludes(settingsPage, 't(activeSpeechTranscriptionProvider.nameKey', 'SettingsPage localizes the selected speech-to-text provider display name');
assertIncludes(settingsPage, 'settings.speechTranscription.executablePath', 'SettingsPage renders the configured local speech executable path for local providers');
assertIncludes(settingsPage, 'settings.speechTranscription.modelPath', 'SettingsPage renders the configured local speech model path for local providers');
assertIncludes(settingsPage, 'AUTOCUT_SPEECH_TRANSCRIPTION_LANGUAGE_OPTIONS', 'SettingsPage renders the canonical local speech language options');
assertIncludes(settingsPage, 'AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_EXTENSIONS', 'SettingsPage documents supported local speech model file extensions');
assertIncludes(settingsPage, 'getAutoCutLocalSpeechTranscriptionModelPresets', 'SettingsPage renders local STT model acquisition presets through the service validation boundary');
assertIncludes(settingsPage, 'setupAutoCutLocalSpeechTranscriptionModelPreset', 'SettingsPage offers guided one-click local STT model setup through the service boundary');
assertIncludes(settingsPage, 'inspectAutoCutLocalSpeechTranscriptionSetup', 'SettingsPage loads local STT setup inspection status through the service boundary');
assertIncludes(settingsPage, 'initializeAutoCutLocalSpeechTranscriptionSetup', 'SettingsPage runs local STT initialization through the service boundary');
assertIncludes(settingsPage, "listenAutoCutEvent('speechTranscriptionModelDownloadProgress'", 'SettingsPage listens for visible local STT model download progress events');
assertRule(!settingsPage.includes("listenAutoCutEvent('speechTranscriptionExecutableDownloadProgress'"), 'SettingsPage does not listen for executable download progress because whisper-cli is packaged as a sidecar');
assertIncludes(settingsPage, 'speechSetupStatus', 'SettingsPage renders a productized local STT setup status object');
assertIncludes(settingsPage, 'speechModelDownloadProgress', 'SettingsPage stores visible local STT model download progress state');
assertIncludes(settingsPage, 'Whisper CLI sidecar', 'SettingsPage stores and renders visible local STT sidecar verification state');
assertIncludes(settingsPage, 'downloadedBytes', 'SettingsPage displays local STT model download byte progress');
assertIncludes(settingsPage, 'totalBytes', 'SettingsPage displays local STT model download total byte progress when available');
assertIncludes(settingsPage, 'handleInitializeSpeechTranscriptionSetup', 'SettingsPage owns a single local STT initialize action that detects executable, downloads model, and verifies probe');
assertIncludes(settingsPage, 'handleSetupSpeechTranscriptionModelPreset', 'SettingsPage owns a one-click local STT model setup action');
assertIncludes(settingsPage, 'isConfiguringSpeechModel', 'SettingsPage disables duplicate local STT model setup while pending');
assertIncludes(settingsPage, "t('settings.action.initializeSpeech')", 'SettingsPage makes local STT initialization a localized primary action');
assertIncludes(settingsPage, "t('settings.action.useAndDownloadModel')", 'SettingsPage makes guided local STT model setup the primary model catalog action');
assertIncludes(settingsPage, 'downloadAutoCutLocalSpeechTranscriptionModelPreset', 'SettingsPage downloads local STT model presets through the service validation boundary');
assertIncludes(settingsPage, 'copyAutoCutLocalSpeechTranscriptionModelPresetUrl', 'SettingsPage copies local STT model preset URLs through the service validation boundary');
assertIncludes(settingsPage, 'handleCopySpeechTranscriptionModelPresetUrl', 'SettingsPage can copy vetted local STT model download URLs without treating them as modelPath values');
assertRule(!settingsPage.includes('downloadAutoCutUrl(modelPreset.url'), 'SettingsPage does not directly download raw local STT model preset URLs');
assertRule(!settingsPage.includes('writeAutoCutClipboardText(modelPreset.url'), 'SettingsPage does not directly copy raw local STT model preset URLs');
assertIncludes(settingsPage, 'settings.speech.modelCatalog', 'SettingsPage localizes the local STT model download catalog section');
assertIncludes(settingsPage, 'speechSetupChecklist', 'SettingsPage builds an explicit local STT setup checklist');
assertMatches(
  settingsPage,
  /activeSpeechTranscriptionProvider\.kind === 'local' && \([\s\S]*speechSetupChecklist\.map/u,
  'SettingsPage renders the local STT setup checklist only for local providers',
);
assertIncludes(settingsPage, 'executableReady', 'SettingsPage shows whether the local STT executable path is configured');
assertIncludes(settingsPage, 'modelReady', 'SettingsPage shows whether the local STT model path is configured');
assertIncludes(settingsPage, 'testReady', 'SettingsPage shows whether the selected STT provider has passed a probe test');
assertMatches(
  settingsPage,
  /import\s+type\s+\{[\s\S]*AutoCutLocalSpeechTranscriptionSetupStatus[\s\S]*\}\s+from\s+['"]@sdkwork\/autocut-types['"]/u,
  'SettingsPage imports public local STT setup status types from @sdkwork/autocut-types',
);
assertMatches(
  settingsPage,
  /import\s+type\s+\{[\s\S]*AutoCutSpeechTranscriptionModelDownloadProgressEvent[\s\S]*\}\s+from\s+['"]@sdkwork\/autocut-types['"]/u,
  'SettingsPage imports public local STT model download progress types from @sdkwork/autocut-types',
);
assertIncludes(
  settingsPage,
  'readiness === AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.downloading',
  'SettingsPage treats active model download as a distinct local STT setup state',
);
assertIncludes(
  settingsPage,
  'isAutoCutSpeechTranscriptionModelDownloadTerminalPhase',
  'SettingsPage consumes the canonical local STT model download terminal-phase helper',
);
assertRule(
  !settingsPage.includes('terminalSpeechModelDownloadPhases'),
  'SettingsPage does not maintain a local copy of local STT model download terminal phases',
);
assertIncludes(settingsPage, "t('settings.speech.setupStatus.downloading')", 'SettingsPage localizes the active local STT model download state');
assertIncludes(settingsPage, 'speechRuntimeReady', 'SettingsPage separates local STT runtime readiness from path-only configuration');
assertIncludes(
  settingsPage,
  "activeSpeechTranscriptionProvider.kind === 'local' ? testReady : settings.speechTranscription.configured",
  'SettingsPage only marks local STT ready after the selected provider passes validation',
);
assertIncludes(settingsPage, 'lastProbeDiagnostics', 'SettingsPage renders speech-to-text probe diagnostics for failed local setup');
assertIncludes(settingsPage, 'resetSpeechTranscriptionProbeState', 'SettingsPage clears stale speech-to-text probe results whenever provider configuration changes');
assertIncludes(i18nResources, 'setupChecklist', 'i18n resources include the local speech-to-text setup checklist label');
assertIncludes(i18nResources, 'initializeSpeech', 'i18n resources include the one-click local speech-to-text initialize action label');
assertIncludes(i18nResources, 'setupStatus', 'i18n resources include local speech-to-text setup status labels');
assertIncludes(i18nResources, 'downloadProgress', 'i18n resources include local speech-to-text model download progress labels');
assertIncludes(i18nResources, 'diagnostics', 'i18n resources include the local speech-to-text diagnostics label');
assertIncludes(settingsPage, "t('settings.speech.local.executableHelp')", 'SettingsPage explains the local speech executable path contract through i18n');
assertIncludes(settingsPage, "t('settings.speech.local.modelHelp'", 'SettingsPage explains the local speech model path contract through i18n');
assertIncludes(settingsPage, 'testAutoCutLlmConnection', 'SettingsPage invokes the LLM connection test service');
assertIncludes(settingsPage, 'handleTestLlmConnection', 'SettingsPage owns a dedicated LLM connection test action');
assertIncludes(settingsPage, 'isTestingLlmConnection', 'SettingsPage disables duplicate LLM connection tests while pending');
assertIncludes(settingsPage, "t('settings.action.testConnection')", 'SettingsPage exposes a localized click target for testing the LLM connection');
assertIncludes(settingsPage, 'AUTOCUT_MODEL_VENDOR_PRESETS', 'SettingsPage renders the canonical ModelVendor presets');
assertIncludes(settingsPage, 't(preset.labelKey)', 'SettingsPage localizes ModelVendor labels from the canonical registry');
assertIncludes(settingsPage, 't(preset.descriptionKey)', 'SettingsPage localizes ModelVendor guidance from the canonical registry');
assertIncludes(settingsPage, "t(`settings.llm.region.${activeLlmVendorPreset.region}`)", 'SettingsPage localizes the active ModelVendor region metadata');
assertIncludes(settingsPage, "t('settings.llm.runtime.openAiCompatible')", 'SettingsPage displays the standardized OpenAI-compatible runtime contract through i18n');
assertIncludes(settingsPage, 'getAutoCutModelPreset', 'SettingsPage resolves the active LLM model preset for dynamic limits');
assertIncludes(settingsPage, 'activeLlmModelPreset.maxOutputTokens', 'SettingsPage renders model-specific Max Tokens constraints');
assertRule(!settingsPage.includes('max={128000}'), 'SettingsPage does not hard-code a global Max Tokens ceiling');
assertMatches(settingsRegistry, /id:\s*'llm'/u, 'Settings Center registry exposes a dedicated LLM settings tab');
assertIncludes(settingsPage, 'settings.llm.maskedApiKey', 'SettingsPage renders masked LLM API keys instead of raw secrets');
const typesSource = read('packages/sdkwork-autocut-types/src/index.ts');
assertIncludes(typesSource, 'outputDirectory: string', 'AutoCut workspace settings include configurable outputDirectory');
assertIncludes(typesSource, 'AUTOCUT_APP_LOCALES', 'AutoCut types centralize supported application locales');
assertIncludes(typesSource, 'AutoCutAppLocale', 'AutoCut types define canonical application locale values');
assertIncludes(typesSource, 'language: AutoCutAppLocale', 'AutoCut workspace settings store a canonical application locale enum value');
assertIncludes(typesSource, 'AutoCutSpeechTranscriptionSettings', 'AutoCut types define speech-to-text provider settings');
assertIncludes(typesSource, 'speechTranscription: AutoCutSpeechTranscriptionSettings', 'AppSettings includes local speech-to-text settings');
assertIncludes(typesSource, 'AUTOCUT_LOCAL_SPEECH_TRANSCRIPTION_MODEL_PRESETS', 'Types package exposes canonical local STT model acquisition presets');
assertIncludes(typesSource, 'AutoCutLocalSpeechTranscriptionModelPreset', 'Types package defines a typed local STT model acquisition preset contract');
assertIncludes(typesSource, 'AutoCutLocalSpeechTranscriptionSetupStatus', 'Types package owns the public local STT setup status contract');
assertIncludes(typesSource, 'AutoCutLocalSpeechTranscriptionModelSetupResult', 'Types package owns the public local STT model setup result contract');
assertIncludes(typesSource, 'AutoCutLocalSpeechTranscriptionSetupInitializationResult', 'Types package owns the public local STT setup initialization result contract');
assertIncludes(typesSource, 'isAutoCutSpeechTranscriptionModelDownloadPhase', 'Types package owns the canonical local STT model download phase type guard');
assertIncludes(typesSource, 'isAutoCutSpeechTranscriptionModelDownloadTerminalPhase', 'Types package owns the canonical local STT model download terminal-phase helper');
assertIncludes(typesSource, 'capabilities: {', 'Public local STT setup status exposes native capability readiness to product UI');
assertIncludes(typesSource, 'AutoCutWorkflowPreferences', 'AutoCut types define standard workflow parameter preferences');
assertIncludes(typesSource, 'AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER', 'AutoCut types centralize stable speech transcription provider constants');
assertIncludes(typesSource, 'AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER_DEFINITIONS', 'AutoCut types centralize speech transcription provider registry definitions');
assertIncludes(typesSource, 'AutoCutSpeechTranscriptionProviderId', 'AutoCut types define the stable speech transcription provider id enum type');
assertIncludes(typesSource, 'providerId: AutoCutSpeechTranscriptionProviderId', 'AutoCut speech settings store the selected provider as an English enum id');
assertIncludes(typesSource, "'local-whisper-cli'", 'AutoCut STT provider registry includes local Whisper CLI');
assertRule(!typesSource.includes("localFasterWhisper: 'local-faster-whisper'"), 'AutoCut STT provider constants do not expose local faster-whisper before native execution exists');
assertRule(!typesSource.includes("localWhisperCpp: 'local-whisper-cpp'"), 'AutoCut STT provider constants do not expose local whisper.cpp before native execution exists');
assertRule(!typesSource.includes("| 'faster-whisper'"), 'AutoCut local STT engine type only includes engines with implemented native execution');
assertRule(!typesSource.includes("| 'whisper-cpp'"), 'AutoCut local STT engine type does not expose a separate whisper.cpp runtime until implemented end-to-end');
assertRule(!typesSource.includes("id: AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER.localFasterWhisper"), 'AutoCut STT provider registry does not expose local faster-whisper until native command execution is implemented');
assertRule(!typesSource.includes("id: AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER.localWhisperCpp"), 'AutoCut STT provider registry does not expose local whisper.cpp as a separate provider until native command execution is implemented');
assertIncludes(typesSource, "'openai-transcription'", 'AutoCut STT provider registry includes OpenAI transcription API');
assertIncludes(typesSource, "'qwen-transcription'", 'AutoCut STT provider registry includes Qwen transcription API');
assertIncludes(typesSource, "'gemini-transcription'", 'AutoCut STT provider registry includes Gemini transcription API');
assertIncludes(typesSource, "'custom-openai-compatible-transcription'", 'AutoCut STT provider registry includes a custom OpenAI-compatible transcription API');
assertRule(!i18nResources.includes('localFasterWhisper'), 'AutoCut i18n resources do not keep unreachable local faster-whisper provider copy');
assertRule(!i18nResources.includes('localWhisperCpp'), 'AutoCut i18n resources do not keep unreachable local whisper.cpp provider copy');
assertRule(
  !/[\u00c0-\u00ff]\u0080?|�/u.test(i18nResources),
  'AutoCut i18n resources do not contain mojibake or replacement characters',
);
assertIncludes(normalizedSettingsZhMessages, "setupChecklist: '本地配置清单'", 'zh-CN i18n resources localize the local STT setup checklist in Chinese');
assertIncludes(normalizedSettingsZhMessages, "setupStatus: {\n      label: '本地运行时'", 'zh-CN i18n resources localize local STT setup status in Chinese');
assertIncludes(normalizedSettingsZhMessages, "modelCatalog: '本地模型下载'", 'zh-CN i18n resources localize the local STT model catalog in Chinese');
assertRule(!normalizedSettingsZhMessages.includes("setupChecklist: 'Local setup checklist'"), 'zh-CN settings resources do not fall back to English local STT setup copy');
assertIncludes(normalizedSettingsEnMessages, "setupChecklist: 'Local setup checklist'", 'en-US i18n resources localize the local STT setup checklist in English');
assertIncludes(typesSource, 'AUTOCUT_SPEECH_TRANSCRIPTION_LANGUAGE_OPTIONS', 'AutoCut types centralize supported speech transcription language options');
assertIncludes(typesSource, 'AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_EXTENSIONS', 'AutoCut types centralize supported local speech model file extensions');
const workflowPreferencesService = read('packages/sdkwork-autocut-services/src/service/workflow-preferences.service.ts');
assertIncludes(workflowPreferencesService, 'getAutoCutWorkflowPreferences', 'workflow-preferences.service.ts loads persisted workflow parameter preferences');
assertIncludes(workflowPreferencesService, 'saveAutoCutVideoSlicePreferences', 'workflow-preferences.service.ts persists video slice parameters');
assertIncludes(workflowPreferencesService, 'saveAutoCutTextExtractionPreferences', 'workflow-preferences.service.ts persists text extraction parameters');
assertIncludes(servicesIndex, "export * from './service/workflow-preferences.service'", 'services index exports workflow-preferences.service.ts');
const extractorTextPage = read('packages/sdkwork-autocut-extractor-text/src/pages/ExtractorTextPage.tsx');
assertIncludes(extractorTextPage, 'accept="audio/*,video/*"', 'ExtractorTextPage accepts both local audio and video sources');
assertIncludes(
  extractorTextPage,
  "selectAutoCutTrustedLocalMediaFile(['audio', 'video'])",
  'ExtractorTextPage opens the trusted desktop chooser with both audio and video enabled',
);
assertIncludes(
  extractorTextPage,
  '音视频',
  'ExtractorTextPage describes text extraction as an audio/video workflow, not audio-only',
);
assertRule(
  !extractorTextPage.includes('识别音频内容'),
  'ExtractorTextPage processing copy must not describe text extraction as audio-only',
);
assertIncludes(extractorTextPage, 'AUTOCUT_SPEECH_TRANSCRIPTION_LANGUAGE_OPTIONS', 'ExtractorTextPage renders the canonical speech language selector options');
assertIncludes(extractorTextPage, 'getAutoCutWorkflowPreferences', 'ExtractorTextPage loads persisted text extraction preferences');
assertIncludes(extractorTextPage, 'saveAutoCutTextExtractionPreferences', 'ExtractorTextPage persists the last-used text extraction parameters before processing');
for (const requiredModelVendor of [
  'deepseek',
  'openai',
  'anthropic',
  'gemini',
  'xai',
  'qwen',
  'moonshot',
  'baidu',
  'zhipu',
  'minimax',
  'hunyuan',
  'doubao',
  'custom',
]) {
  assertIncludes(typesSource, `'${requiredModelVendor}'`, `AutoCut ModelVendor includes stable vendor id ${requiredModelVendor}`);
  assertIncludes(typesSource, `${requiredModelVendor}: {`, `AutoCut model vendor registry includes ${requiredModelVendor}`);
}
for (const requiredVendorMetadata of [
  'region: \'china\'',
  'region: \'us\'',
  'labelKey: \'settings.llm.vendor.openai.label\'',
  'descriptionKey: \'settings.llm.vendor.qwen.description\'',
  'descriptionKey: \'settings.llm.vendor.custom.description\'',
]) {
  assertIncludes(typesSource, requiredVendorMetadata, `AutoCut model vendor registry stores display metadata ${requiredVendorMetadata}`);
}
for (const latestOpenAiModel of ['gpt-5.2', 'gpt-5.2-chat-latest', 'gpt-5.2-pro', 'gpt-5.1', 'gpt-5.1-codex']) {
  assertIncludes(typesSource, `'${latestOpenAiModel}'`, `AutoCut model presets include latest OpenAI model ${latestOpenAiModel}`);
}
for (const latestAnthropicModel of ['claude-opus-4-5-20251101', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001']) {
  assertIncludes(typesSource, `'${latestAnthropicModel}'`, `AutoCut model presets include latest Anthropic model ${latestAnthropicModel}`);
}
for (const latestGeminiModel of ['gemini-3.1-pro-preview', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview', 'gemini-2.5-pro']) {
  assertIncludes(typesSource, `'${latestGeminiModel}'`, `AutoCut model presets include latest Gemini model ${latestGeminiModel}`);
}
for (const latestXaiModel of ['grok-4.1', 'grok-4.1-fast', 'grok-4.1-mini', 'grok-4-fast-reasoning']) {
  assertIncludes(typesSource, `'${latestXaiModel}'`, `AutoCut model presets include latest xAI model ${latestXaiModel}`);
}
for (const latestChinaModel of [
  'qwen3.6-plus',
  'qwen3.6-flash',
  'kimi-k2-0905-preview',
  'kimi-latest',
  'ernie-5.0-preview',
  'ernie-4.5-turbo-128k',
  'glm-4.6',
  'glm-4.5',
  'MiniMax-M2.7',
  'MiniMax-M2.7-highspeed',
  'hunyuan-t1-latest',
  'hunyuan-turbos-latest',
  'doubao-seed-2-0-pro-250828',
  'doubao-seed-2-0-flash-250828',
]) {
  assertIncludes(typesSource, `'${latestChinaModel}'`, `AutoCut model presets include mainstream China model ${latestChinaModel}`);
}
assertIncludes(typesSource, "defaultModel: 'gpt-5.2'", 'OpenAI ModelVendor defaults to the current flagship GPT model id');
assertIncludes(typesSource, "defaultModel: 'gemini-3.1-pro-preview'", 'Gemini ModelVendor defaults to the active Gemini Pro Preview model id');
assertIncludes(typesSource, "defaultModel: 'claude-sonnet-4-5-20250929'", 'Anthropic ModelVendor defaults to the current balanced Claude Sonnet model id');
assertIncludes(typesSource, "defaultModel: 'grok-4.1'", 'xAI ModelVendor defaults to the current Grok flagship model id');
assertIncludes(typesSource, "defaultModel: 'qwen3.6-plus'", 'Qwen ModelVendor defaults to the latest Qwen Plus family model id');
assertIncludes(typesSource, "defaultModel: 'kimi-k2-0905-preview'", 'Moonshot ModelVendor defaults to the latest Kimi K2 API model id');
assertIncludes(typesSource, "defaultModel: 'ernie-5.0-preview'", 'Baidu ModelVendor defaults to the latest ERNIE API model id');
assertIncludes(typesSource, "defaultModel: 'glm-4.6'", 'Zhipu ModelVendor defaults to the current GLM flagship model id');
assertIncludes(typesSource, "defaultModel: 'MiniMax-M2.7'", 'MiniMax ModelVendor defaults to the latest MiniMax flagship model id');
assertIncludes(typesSource, "defaultModel: 'hunyuan-t1-latest'", 'Hunyuan ModelVendor defaults to the current reasoning-capable Hunyuan model id');
assertIncludes(typesSource, "defaultModel: 'doubao-seed-2-0-pro-250828'", 'Doubao ModelVendor defaults to the latest Doubao Seed 2.0 Pro model id');
assertRule(!typesSource.includes("'gpt-5.5'"), 'AutoCut model presets do not include non-official OpenAI model id gpt-5.5');
assertRule(!typesSource.includes("'claude-opus-4-7'"), 'AutoCut model presets do not include non-official Anthropic model id claude-opus-4-7');
assertRule(!typesSource.includes("'gemini-3-pro-preview'"), 'AutoCut model presets do not include the retired Gemini 3 Pro Preview model id');
assertRule(!typesSource.includes("'grok-4.3'"), 'AutoCut model presets do not include non-official xAI model id grok-4.3');
assertIncludes(typesSource, 'AUTOCUT_SLICE_LLM_MODEL_OPTIONS', 'AutoCut types export one centralized slicer LLM option list');
assertIncludes(slicerPage, 'AUTOCUT_SLICE_LLM_MODEL_OPTIONS', 'Slicer LLM selector consumes the centralized LLM option list');
assertIncludes(slicerPage, 'activeLlmRuntimeModelVendor', 'Slicer tracks the active Settings Center LLM ModelVendor');
assertIncludes(slicerPage, 'activeLlmModelOptions', 'Slicer filters LLM model options to the active Settings Center ModelVendor');
assertIncludes(slicerPage, 'model.vendor === activeLlmRuntimeModelVendor', 'Slicer prevents cross-provider model selection from mismatching baseUrl and API key');
assertIncludes(slicerPage, 'visibleLlmModelOptions.map', 'Slicer LLM selector renders only active-provider model options from centralized config');
const slicerLlmService = read('packages/sdkwork-autocut-services/src/service/llm.service.ts');
assertIncludes(slicerLlmService, 'getAutoCutModelVendorForModel', 'llm.service resolves model ownership before allowing model overrides');
assertIncludes(slicerLlmService, 'requestedModelVendor !== runtime.modelVendor', 'llm.service rejects model overrides from a different configured provider');
assertIncludes(homePage, 'startSmartSliceInputRef', 'HomePage owns the smart slice hidden file chooser');
assertIncludes(homePage, 'handleStartSmartSlice', 'HomePage starts smart slicing through the video file chooser');
assertIncludes(homePage, 'handleSmartSliceFileSelected', 'HomePage forwards the selected video file to the slicer route');
assertIncludes(homePage, 'selectAutoCutTrustedLocalVideoFile', 'HomePage prefers the desktop trusted local video chooser for smart slicing');
assertIncludes(homePage, 'initialTrustedFileSource: selectedVideo', 'HomePage forwards the desktop trusted video descriptor through route state');
assertRule(!homePage.includes('initialFile: trustedFile'), 'HomePage does not put a trusted File instance into router state where structured cloning drops sourcePath');
assertIncludes(homePage, 'fallbackSmartSliceFileChooser', 'HomePage keeps a browser file chooser fallback outside the Tauri desktop host');
assertIncludes(homePage, 'stopPropagation()', 'HomePage hidden smart slice input stops click bubbling back to the banner');
assertIncludes(homePage, 'accept="video/*"', 'HomePage smart slice chooser accepts video files only');
assertIncludes(homePage, '开始智能切分', 'HomePage primary smart slice action uses the intelligent slicing product copy');
assertIncludes(slicerPage, 'useLocation', 'SlicerPage reads route state from the homepage smart slice chooser');
assertIncludes(slicerPage, 'initialFile', 'SlicerPage initializes the selected source file from route state');
assertIncludes(slicerPage, 'initialFileId', 'SlicerPage initializes an already imported native source asset from route state');
assertIncludes(slicerPage, 'const [fileId, setFileId] = useState<string>(initialFileId)', 'SlicerPage preserves selected native source asset IDs for smart-slice reruns');
assertIncludes(slicerPage, '...(fileId && !file ? { fileId } : {})', 'SlicerPage submits fileId-only smart-slice reruns without requiring a browser File');
assertIncludes(slicerPage, 'initialTrustedFileSource', 'SlicerPage reads the serializable trusted desktop source descriptor from route state');
assertIncludes(slicerPage, 'createAutoCutTrustedLocalFile(initialTrustedFileSource)', 'SlicerPage rebuilds a File-compatible trusted source after router state cloning');
assertIncludes(slicerPage, 'resolveAutoCutTrustedSourcePath(file)', 'SlicerPage detects trusted desktop-selected video source paths');
assertIncludes(slicerPage, 'getAutoCutNativeHostClient().createAssetUrl(trustedSourcePath)', 'SlicerPage previews desktop-selected videos through the Tauri asset protocol');
assertIncludes(slicerPage, 'selectAutoCutTrustedLocalVideoFile', 'SlicerPage prefers the desktop trusted local video chooser when replacing the source video');
assertIncludes(slicerPage, 'createAutoCutTrustedLocalFile', 'SlicerPage converts replacement desktop videos into File-compatible trusted inputs');
assertMatches(
  slicerPage,
  /handleReplaceVideo[\s\S]*selectAutoCutTrustedLocalVideoFile[\s\S]*createAutoCutTrustedLocalFile[\s\S]*setFile\(trustedFile\)/u,
  'SlicerPage replacement video flow preserves trusted source paths so native slicing runs real FFmpeg logic',
);
assertIncludes(slicerPage, 'normalizeSlicerNumberInput', 'SlicerPage normalizes numeric smart-slicing controls before writing React state');
assertRule(
  !slicerPage.includes('setTargetSliceCount(Number(e.target.value))') &&
    !slicerPage.includes('setIdealDuration(Number(e.target.value))') &&
    !slicerPage.includes('setMinDuration(Number(e.target.value))') &&
    !slicerPage.includes('setMaxDuration(Number(e.target.value))'),
  'SlicerPage does not persist raw Number(input.value) results that can turn empty numeric controls into NaN',
);
assertMatches(
  slicerPage,
  /setMinDuration\(\(currentValue\)[\s\S]*normalizeSlicerNumberInput[\s\S]*maxDuration/u,
  'SlicerPage clamps minimum slice duration against the current maximum duration',
);
assertMatches(
  slicerPage,
  /setMaxDuration\(\(currentValue\)[\s\S]*normalizeSlicerNumberInput[\s\S]*minDuration/u,
  'SlicerPage clamps maximum slice duration against the current minimum duration',
);
for (const hardCodedLlmModelOption of [
  '<option value="gpt-5.2">',
  '<option value="gpt-5.2-chat-latest">',
  '<option value="gemini-3.1-pro-preview">',
  '<option value="gemini-3-flash-preview">',
  '<option value="deepseek-v4-flash">',
]) {
  assertRule(
    !slicerPage.includes(hardCodedLlmModelOption),
    `Slicer LLM selector does not hard-code model option ${hardCodedLlmModelOption}`,
  );
}
assertIncludes(settingsPage, 'createAutoCutApiKey', 'SettingsPage creates API keys through the settings service');
assertIncludes(settingsPage, 'revokeAutoCutApiKey', 'SettingsPage revokes API keys through the settings service');
assertIncludes(settingsPage, 'clearAutoCutStorageCache', 'SettingsPage clears cache through the settings service');
assertIncludes(settingsPage, 'requestAutoCutAvatarChange', 'SettingsPage records avatar change requests through the settings service');
assertIncludes(settingsPage, 'openAutoCutSubscriptionManagement', 'SettingsPage records subscription management opens through the settings service');
assertIncludes(settingsPage, 'requestAutoCutPasswordChange', 'SettingsPage records password change requests through the settings service');
assertIncludes(settingsPage, '{settings.account.displayName}', 'SettingsPage account summary reflects persisted display name');
assertIncludes(settingsPage, '{settings.account.email}', 'SettingsPage account summary reflects persisted email');
assertIncludes(settingsPage, '{settings.billing.planName}', 'SettingsPage billing summary reflects persisted plan name');
assertIncludes(settingsPage, '{settings.billing.monthlyPrice}', 'SettingsPage billing summary reflects persisted monthly price');
assertIncludes(settingsPage, '{settings.billing.nextBillingDate}', 'SettingsPage billing summary reflects persisted next billing date');
assertIncludes(settingsPage, 'getAutoCutAccountInitials(settings.account.displayName)', 'SettingsPage account avatar reflects persisted display name');
assertIncludes(settingsPage, 'Array.from({ length: settings.billing.invoicesLoaded })', 'SettingsPage renders invoice rows from persisted invoice count');
assertRule(!settingsPage.includes('User_001'), 'SettingsPage does not hard-code the default account display name');
assertRule(!settingsPage.includes('user_001@example.com'), 'SettingsPage does not hard-code the default account email');
assertRule(!settingsPage.includes('2023-12-20'), 'SettingsPage does not hard-code the billing date');
assertIncludes(settingsPage, '{settings.storage.cachedItems}', 'SettingsPage storage summary reflects persisted cache item count');
assertRule(!settingsPage.includes('defaultValue'), 'SettingsPage uses controlled text inputs instead of defaultValue');
assertRule(!settingsPage.includes('defaultChecked'), 'SettingsPage uses controlled checkboxes instead of defaultChecked');
assertRule(!settingsPage.includes('{settings.llm.apiKey}'), 'SettingsPage never renders the raw LLM API key');
assertOpeningTagsHaveHandler(settingsPage, 'Button', 'packages/sdkwork-autocut-settings/src/pages/SettingsPage.tsx');
assertOpeningTagsHaveHandler(settingsPage, 'button', 'packages/sdkwork-autocut-settings/src/pages/SettingsPage.tsx');

const toolsPage = read('packages/sdkwork-autocut-tools/src/pages/ToolsPage.tsx');
assertIncludes(toolsPage, 'getTools().then(setToolsList)', 'ToolsPage loads the canonical tool registry');
assertIncludes(toolsPage, 'setSearchQuery', 'ToolsPage searches tools locally');
assertIncludes(toolsPage, 'navigate(tool.route)', 'ToolsPage opens tool routes from the registry');

const architectureCheck = read('scripts/check-autocut-architecture.mjs');
assertIncludes(architectureCheck, 'registeredToolRoutes', 'architecture check extracts tool registry routes');
assertIncludes(architectureCheck, 'desktopRoutePaths', 'architecture check extracts desktop route table paths');
assertIncludes(architectureCheck, 'tool registry route', 'architecture check verifies every tool registry route is mounted by the desktop app');

const fileUpload = read('packages/sdkwork-autocut-commons/src/components/FileUpload.tsx');
assertIncludes(fileUpload, 'getValidatedFile', 'FileUpload validates selected and dropped files through one standard workflow');
assertIncludes(fileUpload, 'onValidationError', 'FileUpload exposes a typed validation error callback');
assertMatches(fileUpload, /\.size > maxSizeMB \* 1024 \* 1024/u, 'FileUpload enforces maxSizeMB before accepting files');
assertMatches(fileUpload, /acceptFileTypes\.some[\s\S]*\.type\.startsWith/u, 'FileUpload validates MIME wildcard accept rules');
assertMatches(fileUpload, /handleFileChange[\s\S]*getValidatedFile/u, 'FileUpload validates browse-selected files');
assertMatches(fileUpload, /handleDrop[\s\S]*getValidatedFile/u, 'FileUpload validates drag-and-dropped files');
assertIncludes(fileUpload, 'listenAutoCutTrustedFileSourceDrop', 'FileUpload listens to trusted desktop file source drops');
assertIncludes(fileUpload, 'createAutoCutTrustedLocalFile', 'FileUpload converts trusted desktop file descriptions into File-compatible values');
assertIncludes(fileUpload, 'resolveAutoCutTrustedSourcePath', 'FileUpload can validate selected files while preserving trusted source paths');
assertIncludes(fileUpload, 'trustedFileSourceSelector', 'FileUpload accepts a native trusted file selector so desktop processing does not receive browser-only File objects');
assertMatches(fileUpload, /handleBrowseClick[\s\S]*trustedFileSourceSelector[\s\S]*createAutoCutTrustedLocalFile[\s\S]*getValidatedFile/u, 'FileUpload click selection converts native trusted file descriptions before validation');
assertIncludes(fileUpload, 'onClick={handleBrowseClick}', 'FileUpload routes click-to-select through the trusted native selector before browser fallback');

const nativeHostClient = read('packages/sdkwork-autocut-services/src/service/native-host-client.service.ts');
assertIncludes(nativeHostClient, 'localMediaFileSelectCommandReady', 'native host client declares the trusted desktop audio/video chooser capability');
assertIncludes(nativeHostClient, 'selectLocalMediaFile', 'native host client exposes the trusted desktop audio/video chooser workflow');
assertIncludes(nativeHostClient, 'autocut_select_local_media_file', 'native host client invokes the trusted desktop audio/video chooser command');
assertIncludes(nativeHostClient, 'selectAutoCutTrustedLocalMediaFile', 'services expose a standard trusted local media chooser for FileUpload pages');
assertIncludes(nativeHostClient, 'selectLocalVideoFile', 'native host client exposes the trusted desktop video chooser workflow');
assertIncludes(nativeHostClient, 'autocut_select_local_video_file', 'native host client invokes the trusted desktop video chooser command');
assertIncludes(nativeHostClient, 'selectLocalDirectory', 'native host client exposes the trusted desktop directory chooser workflow');
assertIncludes(nativeHostClient, 'autocut_select_local_directory', 'native host client invokes the trusted desktop directory chooser command');
assertIncludes(nativeHostClient, 'allowLocalMediaPreviewDirectory', 'native host client exposes trusted local preview directory authorization');
assertIncludes(nativeHostClient, 'autocut_allow_local_media_preview_directory', 'native host client invokes trusted local preview directory authorization');
assertIncludes(nativeHostClient, 'AutoCutNativeArtifactInFolderRequest', 'native host client exposes a typed open-containing-folder request');
assertIncludes(nativeHostClient, 'openArtifactInFolder', 'native host client exposes trusted generated artifact folder opening');
assertIncludes(nativeHostClient, 'autocut_open_artifact_in_folder', 'native host client invokes trusted generated artifact folder opening');
assertIncludes(nativeHostClient, 'openAutoCutNativeArtifactInFolder', 'native host client exposes the guarded generated artifact folder helper');
assertIncludes(nativeHostClient, 'probeSpeechTranscription', 'native host client exposes local speech-to-text toolchain probing');
assertIncludes(nativeHostClient, 'autocut_probe_speech_transcription', 'native host client invokes the local speech-to-text probe command');
assertIncludes(nativeHostClient, 'selectSpeechTranscriptionFile', 'native host client exposes trusted local speech tool file selection');
assertIncludes(nativeHostClient, 'autocut_select_speech_transcription_file', 'native host client invokes the trusted local speech tool file chooser');
assertIncludes(nativeHostClient, 'AutoCutSpeechTranscriptionModelDownloadProgressEvent', 'native host client exposes typed local speech model download progress events');
assertIncludes(nativeHostClient, 'speechTranscriptionModelDownloadCommandReady', 'native host client declares local speech model download readiness');
assertIncludes(nativeHostClient, 'downloadSpeechTranscriptionModel', 'native host client exposes trusted local speech model preset download');
assertIncludes(nativeHostClient, 'autocut_download_speech_transcription_model', 'native host client invokes the trusted local speech model download command');
const desktopNativeHost = read('packages/sdkwork-autocut-desktop/src/native-host.ts');
assertMatches(
  desktopNativeHost,
  /import\s+type\s+\{[\s\S]*AutoCutSpeechTranscriptionModelDownloadProgressEvent[\s\S]*\}\s+from\s+['"]@sdkwork\/autocut-types['"]/u,
  'desktop native host imports public local STT model download progress event types from @sdkwork/autocut-types',
);
assertRule(
  !/import\s+type\s+\{[\s\S]*AutoCutSpeechTranscriptionModelDownloadProgressEvent[\s\S]*\}\s+from\s+['"]@sdkwork\/autocut-services['"]/u.test(desktopNativeHost),
  'desktop native host does not import local STT model download progress event types from the services package',
);
assertIncludes(desktopNativeHost, 'reportAutoCutDiagnostic', 'desktop native host reports trusted drag-drop bridge diagnostics');
assertIncludes(desktopNativeHost, 'describeTrustedDesktopDropFile', 'desktop native host describes dropped files through a per-file resilient helper');
assertIncludes(desktopNativeHost, 'allowLocalMediaPreviewDirectory', 'desktop native host grants asset-protocol access to trusted dropped file parent directories');
assertIncludes(desktopNativeHost, 'nativeHostClient.allowLocalMediaPreviewDirectory', 'desktop trusted drag-drop bridge grants preview scope before dispatching dropped files');
assertRule(
  !desktopNativeHost.includes('Promise.all('),
  'desktop trusted drag-drop bridge does not fail the whole drop when one path cannot be described',
);
assertMatches(
  desktopNativeHost,
  /descriptions\.filter[\s\S]*Boolean[\s\S]*dispatchAutoCutTrustedFileSourceDrop/u,
  'desktop trusted drag-drop bridge dispatches only successfully described local media files',
);
const nativeTauriConfig = JSON.parse(read('packages/sdkwork-autocut-desktop/src-tauri/tauri.conf.json'));
const nativeTauriDefaultCapability = JSON.parse(read('packages/sdkwork-autocut-desktop/src-tauri/capabilities/default.json'));
assertRule(
  nativeTauriDefaultCapability.permissions?.includes('core:event:default'),
  'desktop Tauri capability grants event listen/unlisten permissions for trusted drag-drop registration',
);
assertRule(
  nativeTauriDefaultCapability.permissions?.includes('core:event:allow-listen'),
  'desktop Tauri capability explicitly grants event.listen for trusted drag-drop registration',
);
assertRule(
  nativeTauriDefaultCapability.permissions?.includes('core:event:allow-unlisten'),
  'desktop Tauri capability explicitly grants event.unlisten for trusted drag-drop cleanup',
);
assertRule(
  nativeTauriDefaultCapability.permissions?.includes('core:default'),
  'desktop Tauri capability grants the core invoke permissions required by the native host client',
);
assertRule(
  nativeTauriConfig.app?.security?.assetProtocol?.enable === true,
  'desktop Tauri config enables asset protocol previews for trusted desktop media paths',
);
const nativeCommands = read('packages/sdkwork-autocut-desktop/src-tauri/src/commands.rs');
assertIncludes(nativeCommands, 'autocut_select_local_media_file', 'desktop commands expose the trusted local audio/video chooser');
assertIncludes(nativeCommands, 'autocut_select_local_video_file', 'desktop commands expose the trusted local video chooser');
assertIncludes(nativeCommands, 'autocut_select_local_directory', 'desktop commands expose the trusted local directory chooser');
assertIncludes(nativeCommands, 'autocut_allow_local_media_preview_directory', 'desktop commands expose the asset-protocol preview directory authorization command');
assertIncludes(nativeCommands, 'autocut_open_artifact_in_folder', 'desktop commands expose the trusted open-containing-folder command');
assertIncludes(nativeCommands, 'autocut_probe_speech_transcription', 'desktop commands expose the local speech-to-text probe');
assertIncludes(nativeCommands, 'autocut_select_speech_transcription_file', 'desktop commands expose the trusted local speech tool file chooser');
assertIncludes(nativeCommands, 'autocut_download_speech_transcription_model', 'desktop commands expose the trusted local speech model download command');
const nativeMain = read('packages/sdkwork-autocut-desktop/src-tauri/src/main.rs');
assertIncludes(nativeMain, 'commands::autocut_select_local_media_file', 'desktop main registers the trusted local audio/video chooser command');
assertIncludes(nativeMain, 'commands::autocut_select_local_video_file', 'desktop main registers the trusted local video chooser command');
assertIncludes(nativeMain, 'commands::autocut_select_local_directory', 'desktop main registers the trusted local directory chooser command');
assertIncludes(nativeMain, 'commands::autocut_allow_local_media_preview_directory', 'desktop main registers the asset-protocol preview directory authorization command');
assertIncludes(nativeMain, 'commands::autocut_open_artifact_in_folder', 'desktop main registers the trusted open-containing-folder command');
assertIncludes(nativeMain, 'commands::autocut_probe_speech_transcription', 'desktop main registers the local speech-to-text probe command');
assertIncludes(nativeMain, 'commands::autocut_select_speech_transcription_file', 'desktop main registers the trusted local speech tool file chooser command');
assertIncludes(nativeMain, 'commands::autocut_download_speech_transcription_model', 'desktop main registers the trusted local speech model download command');
const nativeHostContract = read('packages/sdkwork-autocut-desktop/src-tauri/src/host_contract.rs');
assertIncludes(nativeHostContract, 'local_media_file_select_command_ready', 'native host capabilities declare trusted local audio/video chooser readiness');
assertIncludes(nativeHostContract, '"autocut_select_local_media_file"', 'native host supported commands include trusted local audio/video chooser');
assertIncludes(nativeHostContract, 'local_video_file_select_command_ready', 'native host capabilities declare trusted local video chooser readiness');
assertIncludes(nativeHostContract, '"autocut_select_local_video_file"', 'native host supported commands include trusted local video chooser');
assertIncludes(nativeHostContract, 'local_directory_select_command_ready', 'native host capabilities declare trusted local directory chooser readiness');
assertIncludes(nativeHostContract, '"autocut_select_local_directory"', 'native host supported commands include trusted local directory chooser');
assertIncludes(nativeHostContract, 'local_media_preview_directory_scope_command_ready', 'native host capabilities declare local media preview directory authorization readiness');
assertIncludes(nativeHostContract, '"autocut_allow_local_media_preview_directory"', 'native host supported commands include local media preview directory authorization');
assertIncludes(nativeHostContract, 'open_artifact_in_folder_command_ready', 'native host capabilities declare generated artifact folder opening readiness');
assertIncludes(nativeHostContract, '"autocut_open_artifact_in_folder"', 'native host supported commands include generated artifact folder opening');
assertIncludes(nativeHostContract, 'speech_transcription_probe_command_ready', 'native host capabilities declare local speech-to-text probe readiness');
assertIncludes(nativeHostContract, 'speech_transcription_file_select_command_ready', 'native host capabilities declare local speech tool file chooser readiness');
assertIncludes(nativeHostContract, 'speech_transcription_model_download_command_ready', 'native host capabilities declare local speech model download readiness');
assertIncludes(nativeHostContract, '"autocut_probe_speech_transcription"', 'native host supported commands include local speech-to-text probe');
assertIncludes(nativeHostContract, '"autocut_select_speech_transcription_file"', 'native host supported commands include local speech tool file chooser');
assertIncludes(nativeHostContract, '"autocut_download_speech_transcription_model"', 'native host supported commands include local speech model download');
assertRule(
  nativeTauriConfig.bundle?.resources?.['binaries/speech-transcription.toolchain.json'] === 'binaries/speech-transcription.toolchain.json',
  'desktop Tauri config packages the local speech-to-text toolchain manifest for release builds',
);
const nativeMediaRuntime = read('packages/sdkwork-autocut-desktop/src-tauri/src/media_runtime.rs');
assertIncludes(nativeMediaRuntime, 'select_autocut_local_media_file', 'media runtime implements the trusted local audio/video chooser');
assertIncludes(nativeMediaRuntime, 'SUPPORTED_AUDIO_FILE_DIALOG_EXTENSIONS', 'media runtime exposes audio extensions for the trusted audio/video chooser');
assertIncludes(nativeMediaRuntime, 'normalize_autocut_media_file_select_types', 'media runtime validates requested trusted media chooser types');
assertIncludes(nativeMediaRuntime, 'select_autocut_local_video_file', 'media runtime implements the trusted local video chooser');
assertIncludes(nativeMediaRuntime, 'rfd::FileDialog', 'media runtime uses a native system file dialog for local video selection');
assertIncludes(nativeMediaRuntime, 'describe_autocut_local_media_file_from_path', 'media runtime describes the selected video through the canonical local media descriptor');
assertIncludes(nativeMediaRuntime, 'select_autocut_local_directory', 'media runtime implements the trusted local directory chooser');
assertIncludes(nativeMediaRuntime, 'pick_folder', 'media runtime uses the native system folder dialog for local directory selection');
assertIncludes(nativeMediaRuntime, 'allow_autocut_local_media_preview_directory', 'media runtime implements trusted asset-protocol preview directory authorization');
assertIncludes(nativeMediaRuntime, 'open_autocut_artifact_in_folder', 'media runtime implements trusted generated artifact folder opening');
assertIncludes(nativeMediaRuntime, 'ensure_existing_autocut_artifact_file_path', 'media runtime validates artifact paths before opening the system file manager');
assertIncludes(nativeMediaRuntime, 'spawn_autocut_artifact_folder_reveal_command', 'media runtime isolates OS-specific file-manager spawning behind a testable helper');
assertIncludes(nativeMediaRuntime, 'allow_autocut_asset_protocol_directory_scope', 'media runtime centralizes asset-protocol directory scope grants');
assertIncludes(nativeMediaRuntime, 'tauri::scope::Scopes', 'media runtime grants preview paths through Tauri runtime scopes instead of broad static config');
assertMatches(nativeMediaRuntime, /scopes\s*\.allow_directory\(directory_path,\s*true\)/u, 'media runtime grants recursive asset-protocol access only to trusted selected directories');
assertIncludes(nativeMediaRuntime, 'allow_autocut_asset_protocol_file_parent_scope', 'media runtime grants preview access to trusted selected source file parent directories');
assertIncludes(nativeMediaRuntime, 'Path::new(&description.source_path)', 'media runtime grants source preview scope from the canonical described media path');
assertIncludes(nativeMediaRuntime, 'allow_autocut_asset_protocol_directory_scope(app, &media_root)?', 'media runtime grants preview access to resolved configured output roots');
assertIncludes(nativeMediaRuntime, 'probe_autocut_speech_transcription', 'media runtime implements the local speech-to-text toolchain probe');
assertIncludes(nativeMediaRuntime, 'AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_PROGRESS_EVENT', 'media runtime defines a native local STT model download progress event name');
assertRule(!nativeMediaRuntime.includes('AUTOCUT_SPEECH_TRANSCRIPTION_EXECUTABLE_DOWNLOAD_PROGRESS_EVENT'), 'media runtime does not expose a native local STT executable download progress event because whisper-cli is packaged as a sidecar');
assertIncludes(nativeMediaRuntime, 'emit_autocut_speech_transcription_model_download_progress', 'media runtime emits local STT model download progress while streaming bytes');
assertRule(!nativeMediaRuntime.includes('emit_autocut_speech_transcription_executable_download_progress'), 'media runtime never emits executable download progress because runtime whisper-cli download is disabled');
assertIncludes(nativeMediaRuntime, 'download_autocut_speech_transcription_model_file_with_progress', 'media runtime writes local STT model downloads through a progress-aware streaming loop');
assertRule(!nativeMediaRuntime.includes('download_autocut_speech_transcription_executable_archive_with_progress'), 'media runtime never downloads local STT executable archives at runtime');
assertRule(!nativeMediaRuntime.includes('download_autocut_speech_transcription_executable'), 'media runtime never exposes a local STT executable download function at runtime');
assertIncludes(nativeMediaRuntime, 'verify_file_sha256_for_label', 'media runtime verifies pinned local STT model SHA-256 before installation');
assertIncludes(nativeMediaRuntime, 'speech-transcription.toolchain.json', 'media runtime resolves bundled local speech-to-text sidecars from the package resource manifest');
assertIncludes(nativeMediaRuntime, 'resolve_autocut_default_bundled_speech_executable_path', 'media runtime computes the default whisper-cli sidecar path from the package manifest');
assertIncludes(nativeMediaRuntime, 'resolve_autocut_bundled_speech_executable_from_candidate_manifests', 'media runtime discovers packaged whisper-cli sidecars from candidate manifests');
assertIncludes(nativeMediaRuntime, 'validate_autocut_speech_toolchain_manifest', 'media runtime validates the packaged speech sidecar manifest before trusting executable paths');
assertIncludes(nativeMediaRuntime, 'verify_autocut_ffmpeg_sidecar_integrity', 'media runtime verifies packaged speech sidecar integrity using the manifest SHA-256 and byte size contract');
assertIncludes(nativeMediaRuntime, 'speech_bundled_sidecar_does_not_accept_unverified_existing_target', 'media runtime tests that unverified sidecar placeholders cannot satisfy local STT readiness');
assertIncludes(nativeMediaRuntime, 'speech_toolchain_manifest_rejects_placeholder_integrity_when_bundled_ready', 'media runtime tests that bundled-ready speech manifests cannot use placeholder integrity');
assertRule(!nativeMediaRuntime.includes('extract_autocut_speech_transcription_executable_from_zip'), 'media runtime does not extract runtime whisper-cli zip archives');
assertRule(!nativeMediaRuntime.includes('install_autocut_speech_transcription_runtime_directory'), 'media runtime does not stage runtime whisper-cli install directories');
assertRule(!nativeMediaRuntime.includes('write_autocut_speech_executable_install_receipt'), 'media runtime does not persist runtime executable install receipts');
assertRule(!nativeMediaRuntime.includes('verify_autocut_speech_executable_install_receipt'), 'media runtime does not reuse runtime executable install receipts');
assertIncludes(nativeMediaRuntime, 'speech_model_download_progress_calculates_percent_for_known_total', 'media runtime tests local STT model download percent calculation');
assertIncludes(nativeMediaRuntime, 'speech_model_download_progress_keeps_unknown_total_visible', 'media runtime tests local STT model download progress for unknown total sizes');
assertIncludes(nativeMediaRuntime, 'resolve_autocut_speech_toolchain_from_candidate_manifests', 'media runtime can resolve local speech-to-text from settings, environment, bundled sidecar manifests, PATH, and common local install directories');
assertIncludes(nativeMediaRuntime, 'resolve_autocut_speech_executable_from_system_candidates', 'media runtime discovers local whisper-cli from PATH and common local install directories when settings are empty');
assertIncludes(nativeMediaRuntime, 'speech_toolchain_resolver_discovers_whisper_cli_from_system_path_when_not_configured', 'media runtime tests automatic local whisper-cli discovery from PATH before reporting missing executablePath');
assertIncludes(nativeMediaRuntime, 'speech_toolchain_resolver_uses_existing_default_model_path_when_model_is_not_configured', 'media runtime tests automatic default local STT model path detection');
assertIncludes(nativeMediaRuntime, 'select_autocut_speech_transcription_file', 'media runtime implements trusted local speech tool file selection');
assertIncludes(nativeMediaRuntime, 'speech_toolchain_explicit_settings_override_env_fallback', 'media runtime tests that saved speech tool settings override environment fallback');
assertIncludes(nativeMediaRuntime, 'speech_toolchain_resolver_uses_bundled_whisper_sidecar_when_executable_is_not_configured', 'media runtime tests that packaged whisper-cli sidecars can initialize local speech-to-text executable discovery');
assertIncludes(nativeMediaRuntime, 'speech_transcription_probe_validates_model_path_without_fake_readiness', 'media runtime tests local speech-to-text probe validation');
assertIncludes(nativeMediaRuntime, 'MIN_SPEECH_TRANSCRIPTION_MODEL_BYTES', 'media runtime enforces a minimum viable local speech model byte size');
assertIncludes(nativeMediaRuntime, 'speech_toolchain_rejects_partial_download_model_files', 'media runtime tests that partial .download speech model files are rejected');
assertIncludes(nativeMediaRuntime, 'speech_toolchain_rejects_too_small_model_files', 'media runtime tests that incomplete local speech model files are rejected');
assertIncludes(nativeMediaRuntime, 'pub duration_ms: Option<i64>', 'media runtime exposes source media duration for smart slice planning');
assertIncludes(nativeMediaRuntime, '"durationMs": duration_ms', 'media runtime stores imported media duration in asset metadata for audits');
assertIncludes(nativeMediaRuntime, 'read_ffmpeg_media_duration_millis(toolchain, &sandbox_path).ok()', 'media runtime probes imported video duration without blocking import on probe failure');
assertIncludes(nativeMediaRuntime, 'video_slice_render_dimensions', 'media runtime defines canonical smart slice render dimensions');
assertIncludes(nativeMediaRuntime, '"9:16" => Some((1080, 1920))', 'media runtime maps 9:16 smart slices to 1080x1920 output');
assertIncludes(nativeMediaRuntime, 'force_original_aspect_ratio=increase', 'media runtime uses cover scaling for smart slice renderProfile cover mode');
assertIncludes(nativeMediaRuntime, 'crop={target_width}:{target_height}', 'media runtime crops cover smart slice renders to the target frame');
assertIncludes(nativeMediaRuntime, 'AUTOCUT_MEDIA_TASK_COVER_DIR', 'media runtime defines a dedicated cover directory for generated task video thumbnails');
assertIncludes(nativeMediaRuntime, 'autocut_task_cover_dir', 'media runtime creates and validates the dedicated task cover directory before writing thumbnails');
assertIncludes(nativeMediaRuntime, 'force_original_aspect_ratio=decrease', 'media runtime uses contain scaling for smart slice renderProfile contain mode');
assertIncludes(nativeMediaRuntime, 'pad={target_width}:{target_height}', 'media runtime pads contain smart slice renders to the target frame');
assertIncludes(nativeMediaRuntime, 'setsar=1', 'media runtime normalizes sample aspect ratio after smart slice rendering');
assertIncludes(nativeMediaRuntime, 'run_ffmpeg_video_slice_with_encoder_fallback', 'media runtime runs smart slice rendering through a native FFmpeg encoder fallback chain instead of a single fixed encoder');
assertIncludes(nativeMediaRuntime, 'autocut_video_slice_encoder_candidates', 'media runtime defines platform-aware native smart slice hardware encoder candidates');
assertIncludes(nativeMediaRuntime, 'h264_nvenc', 'media runtime can use NVIDIA NVENC for native smart slice rendering on Windows/Linux when FFmpeg supports it');
assertIncludes(nativeMediaRuntime, 'h264_qsv', 'media runtime can use Intel Quick Sync for native smart slice rendering on Windows/Linux when FFmpeg supports it');
assertIncludes(nativeMediaRuntime, 'h264_amf', 'media runtime can use AMD AMF for native smart slice rendering on Windows when FFmpeg supports it');
assertIncludes(nativeMediaRuntime, 'h264_videotoolbox', 'media runtime can use Apple VideoToolbox for native smart slice rendering on macOS');
assertIncludes(nativeMediaRuntime, 'h264_vaapi', 'media runtime can use VAAPI for native smart slice rendering on Linux when a render device exists');
assertIncludes(nativeMediaRuntime, 'autocut_video_slice_cpu_encoder_candidate', 'media runtime always keeps libx264 CPU rendering as the last smart slice fallback');
assertIncludes(nativeMediaRuntime, 'format_video_slice_encoder_attempt_diagnostics', 'media runtime reports every failed native smart slice encoder attempt in diagnostics');
assertIncludes(nativeMediaRuntime, 'remove_partial_video_slice_output', 'media runtime removes partial smart slice files before retrying the next encoder');
assertIncludes(nativeMediaRuntime, 'video_slice_encoder_candidates_prioritize_platform_hardware_and_end_with_cpu_fallback', 'media runtime tests the native smart slice hardware-first CPU-fallback encoder policy');
assertRule(!nativeMediaRuntime.includes('"subtitleSegmentCount"'), 'media runtime does not persist subtitleSegmentCount as required smart-slice STT evidence');
assertRule(!nativeMediaRuntime.includes('"subtitleArtifactCount": subtitle_segments.len()'), 'media runtime does not report requested subtitle segment count as generated subtitle artifact count');
assertIncludes(nativeMediaRuntime, '.filter(|slice| slice.subtitle_artifact_uuid.is_some())', 'media runtime counts generated subtitle artifacts from completed slice outputs');
const nativeCargoToml = read('packages/sdkwork-autocut-desktop/src-tauri/Cargo.toml');
assertIncludes(nativeCargoToml, 'rfd = { version = "0.16.0"', 'desktop Tauri crate declares rfd for the contracted trusted local file chooser');

const messagesPage = read('packages/sdkwork-autocut-messages/src/pages/MessagesPage.tsx');
for (const marker of ['getMessages', 'updateMessageRead', 'markAllMessagesRead', 'clearReadMessages', 'handleActionClick']) {
  assertIncludes(messagesPage, marker, `MessagesPage contains message workflow marker ${marker}`);
}

if (failures.length > 0) {
  console.error('AutoCut feature workflow check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  console.error(`\n${pass.length} checks passed, ${failures.length} checks failed.`);
  process.exit(1);
}

console.log(`AutoCut feature workflow check passed (${pass.length} checks).`);
