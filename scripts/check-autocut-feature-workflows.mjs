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
    pageMarkers: ['WebGLPlayer', "listenAutoCutEvent('taskUpdated'", "listenAutoCutEvent('taskAdded'", 'setActiveLeftTab("tasks")', 'navigate(`/tasks/${task.id}`)'],
    serviceMarkers: [
      'addTask',
      'simulateTaskProgress',
      'addAsset',
      'addMessage',
      'sliceResults',
      'getAutoCutNativeHostClient',
      'resolveAutoCutTrustedSourcePath',
      'createAutoCutOpenAiCompatibleChatCompletion',
      'resolveAutoCutOutputRootDir',
      'resolveAutoCutSpeechTranscriptionRuntimeConfig',
      'AutoCutSpeechTranscriptionSegment',
      'transcribeMedia',
      'speechRuntimeConfig.configured',
      'capabilities.speechTranscriptionToolchainReady || speechRuntimeConfig.configured',
      'executablePath: speechRuntimeConfig.executablePath',
      'modelPath: speechRuntimeConfig.modelPath',
      'sliceVideo',
      'createAssetUrl',
      'thumbnailArtifactPath',
      'createTranscriptAssistedSlicePlan',
      'normalizeCandidateSlicePlan',
      'fallbackDurationMs',
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
      'simulateTaskProgress',
      'addAsset',
      'addMessage',
      'extractedText',
      'getAutoCutNativeHostClient',
      'resolveAutoCutTrustedSourcePath',
      'resolveAutoCutOutputRootDir',
      'resolveAutoCutSpeechTranscriptionRuntimeConfig',
      'importMediaFile',
      'transcribeMedia',
      'capabilities.speechTranscriptionToolchainReady || speechRuntimeConfig.configured',
      'executablePath: speechRuntimeConfig.executablePath',
      'modelPath: speechRuntimeConfig.modelPath',
      'createNativeExtractedTextSegments',
    ],
  },
  {
    name: 'extractor-audio',
    page: 'packages/sdkwork-autocut-extractor-audio/src/pages/AudioExtractorPage.tsx',
    service: 'packages/sdkwork-autocut-extractor-audio/src/service/audioExtractorService.ts',
    processFn: 'processAudioExtraction',
    pageMarkers: ['downloadAutoCutUrl', "listenAutoCutEvent('taskUpdated'", 'setActiveTaskId'],
    serviceMarkers: ['addTask', 'simulateTaskProgress', 'addAsset', 'addMessage', 'audioUrl'],
  },
  {
    name: 'video-gif',
    page: 'packages/sdkwork-autocut-video-gif/src/pages/VideoGifPage.tsx',
    service: 'packages/sdkwork-autocut-video-gif/src/service/videoGifService.ts',
    processFn: 'processVideoGif',
    pageMarkers: ['downloadAutoCutUrl', "listenAutoCutEvent('taskUpdated'", 'setActiveTaskId'],
    serviceMarkers: [
      'addTask',
      'simulateTaskProgress',
      'addAsset',
      'addMessage',
      'gifUrl',
      'getAutoCutNativeHostClient',
      'resolveAutoCutTrustedSourcePath',
      'generateGif',
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
      'simulateTaskProgress',
      'addAsset',
      'addMessage',
      'videoUrl',
      'fileSizeStats',
      'getAutoCutNativeHostClient',
      'resolveAutoCutTrustedSourcePath',
      'compressVideo',
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
      'simulateTaskProgress',
      'addAsset',
      'addMessage',
      'videoUrl',
      'getAutoCutNativeHostClient',
      'resolveAutoCutTrustedSourcePath',
      'convertVideo',
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
      'simulateTaskProgress',
      'addAsset',
      'addMessage',
      'videoUrl',
      'getAutoCutNativeHostClient',
      'resolveAutoCutTrustedSourcePath',
      'enhanceVideo',
      'createAssetUrl',
    ],
  },
  {
    name: 'subtitle-translate',
    page: 'packages/sdkwork-autocut-subtitle-translate/src/pages/SubtitleTranslatePage.tsx',
    service: 'packages/sdkwork-autocut-subtitle-translate/src/service/subtitleTranslateService.ts',
    processFn: 'processSubtitleTranslate',
    pageMarkers: ['downloadAutoCutUrl', "listenAutoCutEvent('taskUpdated'", 'setActiveTaskId'],
    serviceMarkers: ['addTask', 'simulateTaskProgress', 'addAsset', 'addMessage', 'videoUrl'],
  },
  {
    name: 'voice-translate',
    page: 'packages/sdkwork-autocut-voice-translate/src/pages/VoiceTranslatePage.tsx',
    service: 'packages/sdkwork-autocut-voice-translate/src/service/voiceTranslateService.ts',
    processFn: 'processVoiceTranslate',
    pageMarkers: ['downloadAutoCutUrl', "listenAutoCutEvent('taskUpdated'", 'setActiveTaskId'],
    serviceMarkers: ['addTask', 'simulateTaskProgress', 'addAsset', 'addMessage', 'videoUrl'],
  },
];

for (const workflow of processingWorkflows) {
  const pageSource = read(workflow.page);
  const serviceSource = read(workflow.service);
  assertIncludes(serviceSource, `export async function ${workflow.processFn}`, `${workflow.name} exports its processing workflow function`);
  assertIncludes(pageSource, `${workflow.processFn}(`, `${workflow.name} page invokes its processing workflow function`);
  assertIncludes(serviceSource, 'AUTOCUT_TASK_STATUS.pending', `${workflow.name} service creates a pending task`);
  assertIncludes(serviceSource, 'return { success: true, taskId: newTask.id }', `${workflow.name} service returns a task id result contract`);
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

const slicerPage = read('packages/sdkwork-autocut-slicer/src/pages/SlicerPage.tsx');
assertIncludes(
  slicerPage,
  '<TaskFailureState variant="compact" errorMessage={task.errorMessage}',
  'Slicer renders a visible compact task failure state',
);
assertIncludes(slicerPage, 'useSearchParams', 'Slicer reads router search params for external video links');
assertIncludes(slicerPage, "searchParams.get('url')", 'Slicer reads the external source URL query parameter');
assertIncludes(slicerPage, 'useState(initialSourceUrl)', 'Slicer stores the external source URL from navigation state');
assertIncludes(slicerPage, 'sliceParams.url = sourceUrl', 'Slicer passes the external source URL into the slicing workflow');

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
assertMatches(
  taskDetailPage,
  /<Button className="mt-4" variant="outline" onClick=\{\(\) => downloadTaskExecutionResultFile\(task\)\}/u,
  'TaskDetailPage fallback result download button is wired to a real export workflow',
);

for (const workflow of processingWorkflows) {
  const serviceSource = read(workflow.service);
  assertIncludes(serviceSource, 'sourceTaskId: newTask.id', `${workflow.name} service stores sourceTaskId on generated assets`);
  assertIncludes(serviceSource, 'sourceTaskType: newTask.type', `${workflow.name} service stores sourceTaskType on generated assets`);
  assertIncludes(serviceSource, 'generatedAssetIds', `${workflow.name} service returns generatedAssetIds to the completed task`);
  assertIncludes(serviceSource, 'sourceFileId: params.fileId', `${workflow.name} service stores selected source file id on the task`);
}

const processingSourceServicePath = 'packages/sdkwork-autocut-services/src/service/processing-source.service.ts';
const settingsServicePath = 'packages/sdkwork-autocut-services/src/service/settings.service.ts';
const servicesIndex = read('packages/sdkwork-autocut-services/src/index.ts');
const storageService = read('packages/sdkwork-autocut-services/src/service/storage.service.ts');
const eventsService = read('packages/sdkwork-autocut-services/src/service/events.service.ts');
const settingsPage = read('packages/sdkwork-autocut-settings/src/pages/SettingsPage.tsx');
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
assertIncludes(storageService, 'settings:', 'storage.service.ts declares the settings storage key');
assertIncludes(eventsService, 'settingsUpdated:', 'events.service.ts emits settingsUpdated events');
assertIncludes(settingsPage, 'getAutoCutSettings', 'SettingsPage loads settings from the settings service');
assertIncludes(settingsPage, 'saveAutoCutAccountSettings', 'SettingsPage persists account edits through the settings service');
assertIncludes(settingsPage, 'saveAutoCutWorkspaceSettings', 'SettingsPage persists workspace edits through the settings service');
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
assertIncludes(settingsPage, 'saveAutoCutSpeechTranscriptionSettings', 'SettingsPage persists local speech-to-text edits through the settings service');
assertIncludes(settingsPage, 'testAutoCutSpeechTranscriptionToolchain', 'SettingsPage invokes the local speech-to-text toolchain test service');
assertIncludes(settingsPage, 'selectAutoCutSpeechTranscriptionFile', 'SettingsPage uses the trusted native speech tool file chooser');
assertIncludes(settingsPage, 'handleTestSpeechTranscriptionToolchain', 'SettingsPage owns a dedicated local speech-to-text test action');
assertIncludes(settingsPage, 'isTestingSpeechTranscription', 'SettingsPage disables duplicate local speech-to-text tests while pending');
assertIncludes(settingsPage, "{ id: 'speech'", 'SettingsPage exposes a dedicated local speech-to-text settings tab');
assertIncludes(settingsPage, 'settings.speechTranscription.executablePath', 'SettingsPage renders the configured local speech executable path');
assertIncludes(settingsPage, 'settings.speechTranscription.modelPath', 'SettingsPage renders the configured local speech model path');
assertIncludes(settingsPage, 'testAutoCutLlmConnection', 'SettingsPage invokes the LLM connection test service');
assertIncludes(settingsPage, 'handleTestLlmConnection', 'SettingsPage owns a dedicated LLM connection test action');
assertIncludes(settingsPage, 'isTestingLlmConnection', 'SettingsPage disables duplicate LLM connection tests while pending');
assertIncludes(settingsPage, '测试连接', 'SettingsPage exposes a click target for testing the LLM connection');
assertIncludes(settingsPage, 'AUTOCUT_MODEL_VENDOR_PRESETS', 'SettingsPage renders the canonical ModelVendor presets');
assertIncludes(settingsPage, 'getAutoCutModelPreset', 'SettingsPage resolves the active LLM model preset for dynamic limits');
assertIncludes(settingsPage, 'activeLlmModelPreset.maxOutputTokens', 'SettingsPage renders model-specific Max Tokens constraints');
assertRule(!settingsPage.includes('max={128000}'), 'SettingsPage does not hard-code a global Max Tokens ceiling');
assertIncludes(settingsPage, "{ id: 'llm'", 'SettingsPage exposes a dedicated LLM settings tab');
assertIncludes(settingsPage, 'settings.llm.maskedApiKey', 'SettingsPage renders masked LLM API keys instead of raw secrets');
const typesSource = read('packages/sdkwork-autocut-types/src/index.ts');
assertIncludes(typesSource, 'outputDirectory: string', 'AutoCut workspace settings include configurable outputDirectory');
assertIncludes(typesSource, 'AutoCutSpeechTranscriptionSettings', 'AutoCut types define local speech-to-text settings');
assertIncludes(typesSource, 'speechTranscription: AutoCutSpeechTranscriptionSettings', 'AppSettings includes local speech-to-text settings');
for (const latestOpenAiModel of ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano']) {
  assertIncludes(typesSource, `'${latestOpenAiModel}'`, `AutoCut model presets include latest OpenAI model ${latestOpenAiModel}`);
}
for (const latestGeminiModel of ['gemini-3.1-pro-preview', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview']) {
  assertIncludes(typesSource, `'${latestGeminiModel}'`, `AutoCut model presets include latest Gemini model ${latestGeminiModel}`);
}
assertIncludes(typesSource, "defaultModel: 'gpt-5.5'", 'OpenAI ModelVendor defaults to the latest flagship GPT model');
assertIncludes(typesSource, "defaultModel: 'gemini-3.1-pro-preview'", 'Gemini ModelVendor defaults to the latest 3.1 Pro model');
assertIncludes(typesSource, 'AUTOCUT_SLICE_LLM_MODEL_OPTIONS', 'AutoCut types export one centralized slicer LLM option list');
assertIncludes(slicerPage, 'AUTOCUT_SLICE_LLM_MODEL_OPTIONS', 'Slicer LLM selector consumes the centralized LLM option list');
assertIncludes(slicerPage, 'AUTOCUT_SLICE_LLM_MODEL_OPTIONS.map', 'Slicer LLM selector renders model options from centralized config');
assertIncludes(homePage, 'startSmartSliceInputRef', 'HomePage owns the smart slice hidden file chooser');
assertIncludes(homePage, 'handleStartSmartSlice', 'HomePage starts smart slicing through the video file chooser');
assertIncludes(homePage, 'handleSmartSliceFileSelected', 'HomePage forwards the selected video file to the slicer route');
assertIncludes(homePage, 'selectAutoCutTrustedLocalVideoFile', 'HomePage prefers the desktop trusted local video chooser for smart slicing');
assertIncludes(homePage, 'createAutoCutTrustedLocalFile', 'HomePage converts desktop-selected local videos into File-compatible trusted inputs');
assertIncludes(homePage, 'fallbackSmartSliceFileChooser', 'HomePage keeps a browser file chooser fallback outside the Tauri desktop host');
assertIncludes(homePage, 'stopPropagation()', 'HomePage hidden smart slice input stops click bubbling back to the banner');
assertMatches(
  homePage,
  /navigate\('\/slicer'[\s\S]*initialFile:\s*trustedFile/u,
  'HomePage forwards the trusted desktop video file to the slicer route',
);
assertIncludes(homePage, 'accept="video/*"', 'HomePage smart slice chooser accepts video files only');
assertIncludes(homePage, '开始智能切分', 'HomePage primary smart slice action uses the intelligent slicing product copy');
assertIncludes(slicerPage, 'useLocation', 'SlicerPage reads route state from the homepage smart slice chooser');
assertIncludes(slicerPage, 'initialFile', 'SlicerPage initializes the selected source file from route state');
assertIncludes(slicerPage, 'resolveAutoCutTrustedSourcePath(file)', 'SlicerPage detects trusted desktop-selected video source paths');
assertIncludes(slicerPage, 'getAutoCutNativeHostClient().createAssetUrl(trustedSourcePath)', 'SlicerPage previews desktop-selected videos through the Tauri asset protocol');
for (const hardCodedLlmModelOption of [
  '<option value="gpt-5.5">',
  '<option value="gpt-5.4-mini">',
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

const nativeHostClient = read('packages/sdkwork-autocut-services/src/service/native-host-client.service.ts');
assertIncludes(nativeHostClient, 'selectLocalVideoFile', 'native host client exposes the trusted desktop video chooser workflow');
assertIncludes(nativeHostClient, 'autocut_select_local_video_file', 'native host client invokes the trusted desktop video chooser command');
assertIncludes(nativeHostClient, 'selectLocalDirectory', 'native host client exposes the trusted desktop directory chooser workflow');
assertIncludes(nativeHostClient, 'autocut_select_local_directory', 'native host client invokes the trusted desktop directory chooser command');
assertIncludes(nativeHostClient, 'probeSpeechTranscription', 'native host client exposes local speech-to-text toolchain probing');
assertIncludes(nativeHostClient, 'autocut_probe_speech_transcription', 'native host client invokes the local speech-to-text probe command');
assertIncludes(nativeHostClient, 'selectSpeechTranscriptionFile', 'native host client exposes trusted local speech tool file selection');
assertIncludes(nativeHostClient, 'autocut_select_speech_transcription_file', 'native host client invokes the trusted local speech tool file chooser');
const nativeCommands = read('packages/sdkwork-autocut-desktop/src-tauri/src/commands.rs');
assertIncludes(nativeCommands, 'autocut_select_local_video_file', 'desktop commands expose the trusted local video chooser');
assertIncludes(nativeCommands, 'autocut_select_local_directory', 'desktop commands expose the trusted local directory chooser');
assertIncludes(nativeCommands, 'autocut_probe_speech_transcription', 'desktop commands expose the local speech-to-text probe');
assertIncludes(nativeCommands, 'autocut_select_speech_transcription_file', 'desktop commands expose the trusted local speech tool file chooser');
const nativeMain = read('packages/sdkwork-autocut-desktop/src-tauri/src/main.rs');
assertIncludes(nativeMain, 'commands::autocut_select_local_video_file', 'desktop main registers the trusted local video chooser command');
assertIncludes(nativeMain, 'commands::autocut_select_local_directory', 'desktop main registers the trusted local directory chooser command');
assertIncludes(nativeMain, 'commands::autocut_probe_speech_transcription', 'desktop main registers the local speech-to-text probe command');
assertIncludes(nativeMain, 'commands::autocut_select_speech_transcription_file', 'desktop main registers the trusted local speech tool file chooser command');
const nativeHostContract = read('packages/sdkwork-autocut-desktop/src-tauri/src/host_contract.rs');
assertIncludes(nativeHostContract, 'local_video_file_select_command_ready', 'native host capabilities declare trusted local video chooser readiness');
assertIncludes(nativeHostContract, '"autocut_select_local_video_file"', 'native host supported commands include trusted local video chooser');
assertIncludes(nativeHostContract, 'local_directory_select_command_ready', 'native host capabilities declare trusted local directory chooser readiness');
assertIncludes(nativeHostContract, '"autocut_select_local_directory"', 'native host supported commands include trusted local directory chooser');
assertIncludes(nativeHostContract, 'speech_transcription_probe_command_ready', 'native host capabilities declare local speech-to-text probe readiness');
assertIncludes(nativeHostContract, 'speech_transcription_file_select_command_ready', 'native host capabilities declare local speech tool file chooser readiness');
assertIncludes(nativeHostContract, '"autocut_probe_speech_transcription"', 'native host supported commands include local speech-to-text probe');
assertIncludes(nativeHostContract, '"autocut_select_speech_transcription_file"', 'native host supported commands include local speech tool file chooser');
const nativeMediaRuntime = read('packages/sdkwork-autocut-desktop/src-tauri/src/media_runtime.rs');
assertIncludes(nativeMediaRuntime, 'select_autocut_local_video_file', 'media runtime implements the trusted local video chooser');
assertIncludes(nativeMediaRuntime, 'rfd::FileDialog', 'media runtime uses a native system file dialog for local video selection');
assertIncludes(nativeMediaRuntime, 'describe_autocut_local_media_file_from_path', 'media runtime describes the selected video through the canonical local media descriptor');
assertIncludes(nativeMediaRuntime, 'select_autocut_local_directory', 'media runtime implements the trusted local directory chooser');
assertIncludes(nativeMediaRuntime, 'pick_folder', 'media runtime uses the native system folder dialog for local directory selection');
assertIncludes(nativeMediaRuntime, 'probe_autocut_speech_transcription', 'media runtime implements the local speech-to-text toolchain probe');
assertIncludes(nativeMediaRuntime, 'select_autocut_speech_transcription_file', 'media runtime implements trusted local speech tool file selection');
assertIncludes(nativeMediaRuntime, 'speech_toolchain_explicit_settings_override_env_fallback', 'media runtime tests that saved speech tool settings override environment fallback');
assertIncludes(nativeMediaRuntime, 'speech_transcription_probe_validates_model_path_without_fake_readiness', 'media runtime tests local speech-to-text probe validation');
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
