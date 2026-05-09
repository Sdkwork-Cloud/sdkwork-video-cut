import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import ts from 'typescript';

const rootDir = process.cwd();
const packageJson = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const failures = [];
const pass = [];
const nativeSetTimeout = globalThis.setTimeout;
const nativeClearTimeout = globalThis.clearTimeout;
const revokedObjectUrls = [];
const browserDownloadRequests = [];
const clipboardWrites = [];
const moduleLoaderOutDir = path.join(rootDir, 'artifacts', 'service-behavior-modules');

function assertRule(condition, message) {
  if (condition) {
    pass.push(message);
  } else {
    failures.push(message);
  }
}

function assertEqual(actual, expected, message) {
  assertRule(Object.is(actual, expected), `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}

function assertDeepEqual(actual, expected, message) {
  assertRule(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
  );
}

function assertIncludes(collection, value, message) {
  assertRule(collection.includes(value), message);
}

function assertNumberBetween(actual, min, max, message) {
  assertRule(
    typeof actual === 'number' && actual >= min && actual <= max,
    `${message} (expected ${min} <= value <= ${max}, got ${JSON.stringify(actual)})`,
  );
}

function assertSegmentsOrderedAndNonOverlapping(segments, message) {
  const invalidIndex = Array.isArray(segments)
    ? segments.findIndex((segment, index) =>
        index > 0 &&
        typeof segment?.startMs === 'number' &&
        typeof segments[index - 1]?.endMs === 'number' &&
        segment.startMs < segments[index - 1].endMs
      )
    : -1;
  assertRule(
    Array.isArray(segments) && invalidIndex === -1,
    `${message} (segments must be ordered and non-overlapping, got ${JSON.stringify(segments)})`,
  );
}

function assertArrayIncludes(actual, expectedItem, message) {
  assertRule(
    Array.isArray(actual) && actual.includes(expectedItem),
    `${message} (expected array to include ${JSON.stringify(expectedItem)}, got ${JSON.stringify(actual)})`,
  );
}

function captureConsoleDiagnostics(action) {
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalInfo = console.info;
  const calls = [];
  console.error = (...args) => {
    calls.push({ level: 'error', args });
  };
  console.warn = (...args) => {
    calls.push({ level: 'warning', args });
  };
  console.info = (...args) => {
    calls.push({ level: 'info', args });
  };

  try {
    action();
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
    console.info = originalInfo;
  }

  return calls;
}

async function captureConsoleDiagnosticsAsync(action) {
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalInfo = console.info;
  const calls = [];
  console.error = (...args) => {
    calls.push({ level: 'error', args });
  };
  console.warn = (...args) => {
    calls.push({ level: 'warning', args });
  };
  console.info = (...args) => {
    calls.push({ level: 'info', args });
  };

  try {
    await action();
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
    console.info = originalInfo;
  }

  return calls;
}

function resolveWorkflowSourceName(params) {
  if (params.file?.name) {
    return params.file.name;
  }

  if (typeof params.url === 'string' && params.url.trim()) {
    try {
      const parsed = new URL(params.url.trim());
      const fileName = parsed.pathname.split('/').filter(Boolean).at(-1);
      return fileName || parsed.hostname || params.url.trim();
    } catch {
      return params.url.trim();
    }
  }

  return undefined;
}

function assertTaskNameUsesSourceAndSecondTimestamp(task, sourceName, message) {
  const taskName = String(task?.name ?? '');
  assertRule(
    taskName.startsWith(`${sourceName} `),
    `${message} starts with the original source file name (expected prefix ${JSON.stringify(`${sourceName} `)}, got ${JSON.stringify(taskName)})`,
  );
  assertRule(
    / \d{8}-\d{6}$/u.test(taskName),
    `${message} appends a second-precision YYYYMMDD-HHmmss timestamp (got ${JSON.stringify(taskName)})`,
  );
}

function createTrustedLocalMediaFile(commons, sourcePath, name = 'native-source.mp4', overrides = {}) {
  return commons.createAutoCutTrustedLocalFile({
    sourcePath,
    name,
    byteSize: overrides.byteSize ?? 321000,
    mimeType: overrides.mimeType ?? 'video/mp4',
    mediaType: overrides.mediaType ?? 'video',
  });
}

async function assertRejects(action, expectedMessagePart, message) {
  let rejectedError = null;

  try {
    await action();
  } catch (error) {
    rejectedError = error;
  }

  const rejectedMessage = rejectedError instanceof Error ? rejectedError.message : '';
  assertRule(rejectedError instanceof Error, `${message} rejects`);
  assertRule(
    rejectedMessage.includes(expectedMessagePart),
    `${message} explains ${expectedMessagePart}`,
  );
}

async function saveVerifiedLocalSpeechTranscriptionSettings(
  services,
  overrides = {},
) {
  const settings = await services.getAutoCutSettings();
  await services.saveAutoCutSpeechTranscriptionSettings({
    ...settings.speechTranscription,
    executablePath: 'D:/tools/whisper-cli.exe',
    modelPath: 'D:/models/ggml-large-v3-turbo.bin',
    language: 'auto',
    ...overrides,
  });
  return services.markAutoCutSpeechTranscriptionProviderTested({
    ready: true,
    diagnostics: [],
  });
}

class MemoryLocalStorage {
  #items = new Map();

  get length() {
    return this.#items.size;
  }

  getItem(key) {
    return this.#items.has(key) ? this.#items.get(key) : null;
  }

  setItem(key, value) {
    this.#items.set(key, String(value));
  }

  removeItem(key) {
    this.#items.delete(key);
  }

  clear() {
    this.#items.clear();
  }

  key(index) {
    return [...this.#items.keys()][index] ?? null;
  }
}

class AutoCutCustomEvent extends Event {
  constructor(type, eventInit = {}) {
    super(type, eventInit);
    this.detail = eventInit.detail;
  }
}

function installBrowserRuntime() {
  const windowTarget = new EventTarget();
  windowTarget.confirm = () => true;
  windowTarget.open = () => null;
  windowTarget.localStorage = new MemoryLocalStorage();

  const body = {
    appendChild: () => undefined,
    removeChild: () => undefined,
  };
  const document = {
    body,
    createElement: () => {
      const anchor = {
        href: '',
        download: '',
        click: () => {
          browserDownloadRequests.push({
            href: anchor.href,
            download: anchor.download,
          });
        },
      };
      return anchor;
    },
  };

  globalThis.window = windowTarget;
  globalThis.document = document;
  globalThis.localStorage = windowTarget.localStorage;
  globalThis.CustomEvent = AutoCutCustomEvent;
  const navigator = {
    clipboard: {
      writeText: async (text) => {
        clipboardWrites.push(text);
      },
    },
  };
  windowTarget.navigator = navigator;
  Object.defineProperty(globalThis, 'navigator', {
    value: navigator,
    configurable: true,
  });

  URL.createObjectURL = () => `blob:autocut-contract-${Math.random().toString(16).slice(2)}`;
  URL.revokeObjectURL = (url) => {
    revokedObjectUrls.push(url);
  };
}

async function flushMicrotasks(iterations = 30) {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}

async function withImmediateTimers(action) {
  globalThis.setTimeout = (handler, _timeout, ...args) => {
    if (typeof handler === 'function') {
      handler(...args);
    }
    return 0;
  };
  globalThis.clearTimeout = () => undefined;

  try {
    const result = await action();
    await flushMicrotasks();
    return result;
  } finally {
    globalThis.setTimeout = nativeSetTimeout;
    globalThis.clearTimeout = nativeClearTimeout;
  }
}

function resetStorage() {
  localStorage.clear();
}

function readStoredArray(storageKey) {
  return JSON.parse(localStorage.getItem(storageKey) ?? '[]');
}

function readScopedStoredArray(services, key) {
  return readStoredArray(services.createAutoCutStorageKey(key));
}

function readScopedStoredObject(services, key) {
  return JSON.parse(localStorage.getItem(services.createAutoCutStorageKey(key)) ?? '{}');
}

function assertNativeTaskOutputArtifact(
  result,
  expectedTaskUuid,
  expectedFileName,
  message,
  outputRootDir = 'D:/autocut/media',
) {
  const expectedTaskOutputDir = `${outputRootDir}/tasks/${expectedTaskUuid}/outputs`;
  assertEqual(result?.taskOutputDir, expectedTaskOutputDir, `${message} exposes the native task output directory`);
  assertEqual(
    result?.artifactPath,
    `${expectedTaskOutputDir}/${expectedFileName}`,
    `${message} stores the artifact inside its task output directory`,
  );
}

function createNativeTaskOutputArtifact(taskUuid, fileName, outputRootDir = 'D:/autocut/media') {
  const taskOutputDir = `${outputRootDir}/tasks/${taskUuid}/outputs`;
  return {
    taskOutputDir,
    artifactPath: `${taskOutputDir}/${fileName}`,
  };
}

function createNativeTaskCoverArtifact(taskUuid, fileName, outputRootDir = 'D:/autocut/media') {
  const output = createNativeTaskOutputArtifact(taskUuid, `cover/${fileName}`, outputRootDir);
  return output;
}

function createNativeVideoSliceTranscriptResult(request, taskUuid, outputRootDir, segments) {
  const output = createNativeTaskOutputArtifact(taskUuid, 'transcript.json', outputRootDir);
  return {
    artifactUuid: `${taskUuid}-artifact`,
    taskUuid,
    sourceAssetUuid: request.assetUuid,
    transcriptPath: output.artifactPath,
    taskOutputDir: output.taskOutputDir,
    language: request.language ?? 'auto',
    text: segments.map((segment) => segment.text).join(' '),
    segments,
    ffmpegExecutable: 'ffmpeg',
    speechExecutable: request.executablePath,
  };
}

function createStandardNativeVideoSliceTranscriptResult(
  request,
  taskUuid,
  outputRootDir = 'D:/autocut/media',
) {
  return createNativeVideoSliceTranscriptResult(request, taskUuid, outputRootDir, [
    {
      startMs: 0,
      endMs: 19_000,
      text: 'Why native validation matters is simple. Because bad artifacts can break review, the problem must be caught before assets are saved. So verify every result and the workflow stays safe.',
      speaker: 'Speaker 1',
    },
    {
      startMs: 40_000,
      endMs: 59_000,
      text: 'What makes artifact checks reliable is clear. The case shows missing thumbnails before publishing, so the solution is to reject the task and keep storage clean.',
      speaker: 'Speaker 1',
    },
  ]);
}

function captureEvents(services, eventName) {
  const details = [];
  const stop = services.listenAutoCutEvent(eventName, (detail) => details.push(detail));
  return { details, stop };
}

function toPosixPath(value) {
  return value.replaceAll(path.sep, '/');
}

function outputModulePath(sourcePath) {
  return path.join(moduleLoaderOutDir, path.relative(rootDir, sourcePath)).replace(/\.(tsx?|jsx?)$/u, '.mjs');
}

function resolveLocalModulePath(fromSourcePath, specifier) {
  const basePath = specifier.startsWith('@sdkwork/autocut-')
    ? path.join(
        rootDir,
        'packages',
        `sdkwork-autocut-${specifier.slice('@sdkwork/autocut-'.length)}`,
        'src',
        'index.ts',
      )
    : path.resolve(path.dirname(fromSourcePath), specifier);

  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    path.join(basePath, 'index.ts'),
    path.join(basePath, 'index.tsx'),
  ];

  for (const candidate of candidates) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      // Continue scanning extension candidates.
    }
  }

  return undefined;
}

function findPackageRoot(sourcePath) {
  const relativePath = path.relative(rootDir, sourcePath).split(path.sep);
  if (relativePath[0] === 'packages' && relativePath[1]) {
    return path.join(rootDir, 'packages', relativePath[1]);
  }

  return rootDir;
}

function isNodeBuiltinSpecifier(specifier) {
  const normalizedSpecifier = specifier.startsWith('node:') ? specifier.slice(5) : specifier;
  return builtinModules.includes(normalizedSpecifier);
}

function resolveExternalModuleSpecifier(sourcePath, specifier) {
  if (isNodeBuiltinSpecifier(specifier)) {
    return undefined;
  }

  try {
    return pathToFileURL(createRequire(path.join(findPackageRoot(sourcePath), 'package.json')).resolve(specifier)).href;
  } catch {
    return undefined;
  }
}

function rewriteLocalModuleSpecifiers(sourcePath, jsSource) {
  return jsSource.replace(
    /((?:from\s*|import\s*\()\s*['"])([^'"]+)(['"])/gu,
    (match, prefix, specifier, suffix) => {
      const localModulePath = specifier.startsWith('.') || specifier.startsWith('@sdkwork/autocut-')
        ? resolveLocalModulePath(sourcePath, specifier)
        : undefined;
      if (!localModulePath) {
        const externalModuleSpecifier = !specifier.startsWith('.') && !specifier.startsWith('@sdkwork/autocut-')
          ? resolveExternalModuleSpecifier(sourcePath, specifier)
          : undefined;
        return externalModuleSpecifier
          ? `${prefix}${externalModuleSpecifier}${suffix}`
          : match;
      }

      const fromOutputPath = outputModulePath(sourcePath);
      const toOutputPath = outputModulePath(localModulePath);
      let relativeSpecifier = toPosixPath(path.relative(path.dirname(fromOutputPath), toOutputPath));
      if (!relativeSpecifier.startsWith('.')) {
        relativeSpecifier = `./${relativeSpecifier}`;
      }

      return `${prefix}${relativeSpecifier}${suffix}`;
    },
  );
}

function collectLocalModuleGraph(entryPath, seen = new Set()) {
  if (seen.has(entryPath)) {
    return seen;
  }

  seen.add(entryPath);
  const source = readFileSync(entryPath, 'utf8');
  const importPattern = /(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/gu;
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1];
    if (!specifier || (!specifier.startsWith('.') && !specifier.startsWith('@sdkwork/autocut-'))) {
      continue;
    }

    const resolvedPath = resolveLocalModulePath(entryPath, specifier);
    if (resolvedPath) {
      collectLocalModuleGraph(resolvedPath, seen);
    }
  }

  return seen;
}

function transpileLocalModule(sourcePath) {
  const tsSource = readFileSync(sourcePath, 'utf8');
  const transpiled = ts.transpileModule(tsSource, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      useDefineForClassFields: false,
      experimentalDecorators: true,
      isolatedModules: true,
      moduleDetection: ts.ModuleDetectionKind.Force,
    },
    fileName: sourcePath,
  });
  const rewrittenSource = rewriteLocalModuleSpecifiers(sourcePath, transpiled.outputText);
  const outPath = outputModulePath(sourcePath);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, rewrittenSource);
}

async function loadModule(_server, relativePath) {
  const entryPath = path.join(rootDir, relativePath);
  const moduleGraph = collectLocalModuleGraph(entryPath);
  rmSync(moduleLoaderOutDir, { recursive: true, force: true });
  mkdirSync(moduleLoaderOutDir, { recursive: true });

  for (const sourcePath of moduleGraph) {
    transpileLocalModule(sourcePath);
  }

  return import(pathToFileURL(outputModulePath(entryPath)).href);
}

async function assertProcessingWorkflow({ services, types, workflow }) {
  resetStorage();
  const processingTaskUpdates = captureEvents(services, 'taskUpdated');
  const processingAssets = captureEvents(services, 'assetAdded');
  const processingMessages = captureEvents(services, 'messageAdded');
  const processingResult = await withImmediateTimers(async () => workflow.process(workflow.params));
  processingTaskUpdates.stop();
  processingAssets.stop();
  processingMessages.stop();
  const taskStorage = readScopedStoredArray(services, 'tasks');
  const processedTask = taskStorage.find((storedTask) => storedTask.id === processingResult.taskId);
  assertEqual(processingResult.success, true, `${workflow.name} workflow reports success`);
  assertRule(Boolean(processingResult.taskId), `${workflow.name} workflow returns a task id`);
  assertEqual(processedTask?.status, types.AUTOCUT_TASK_STATUS.completed, `${workflow.name} workflow completes the persisted task`);
  assertEqual(processedTask?.progress, 100, `${workflow.name} workflow persists 100 percent progress`);
  for (const field of workflow.taskFields) {
    assertRule(Boolean(processedTask?.[field]), `${workflow.name} workflow stores ${field} on the task`);
  }
  if (workflow.params.fileId) {
    assertEqual(
      processedTask?.sourceFileId,
      workflow.params.fileId,
      `${workflow.name} workflow stores the selected source asset id on the task`,
    );
  }
  if (workflow.expectedTaskNamePart) {
    assertRule(
      processedTask?.name.includes(workflow.expectedTaskNamePart),
      `${workflow.name} workflow reflects the submitted source in the task name`,
    );
  }
  const expectedSourceName = workflow.expectedTaskNamePart ?? resolveWorkflowSourceName(workflow.params);
  if (expectedSourceName) {
    assertTaskNameUsesSourceAndSecondTimestamp(
      processedTask,
      expectedSourceName,
      `${workflow.name} workflow task name`,
    );
  }
  assertRule(
    processingTaskUpdates.details.some((updatedTask) => updatedTask.id === processingResult.taskId),
    `${workflow.name} workflow dispatches task updates`,
  );
  assertRule(processingAssets.details.length >= workflow.minAssets, `${workflow.name} workflow creates generated assets`);
  const generatedAssetIds = Array.isArray(processedTask?.generatedAssetIds) ? processedTask.generatedAssetIds : [];
  const generatedAssetIdSet = new Set(generatedAssetIds);
  const createdAssetIds = processingAssets.details.map((asset) => asset.id);
  const createdAssetIdSet = new Set(createdAssetIds);
  assertRule(
    Array.isArray(processedTask?.generatedAssetIds),
    `${workflow.name} workflow stores generatedAssetIds on the completed task`,
  );
  assertEqual(
    generatedAssetIds.length,
    processingAssets.details.length,
    `${workflow.name} workflow task generatedAssetIds matches generated asset count`,
  );
  for (const createdAssetId of createdAssetIds) {
    assertRule(
      generatedAssetIdSet.has(createdAssetId),
      `${workflow.name} workflow task generatedAssetIds includes generated asset ${createdAssetId}`,
    );
  }
  for (const assetId of generatedAssetIds) {
    assertRule(
      createdAssetIdSet.has(assetId),
      `${workflow.name} workflow generatedAssetIds only references assets created by the workflow`,
    );
  }
  const storedAssets = readScopedStoredArray(services, 'assets');
  for (const asset of processingAssets.details) {
    assertEqual(asset.sourceTaskId, processingResult.taskId, `${workflow.name} workflow event asset ${asset.id} records sourceTaskId`);
    assertEqual(asset.sourceTaskType, processedTask?.type, `${workflow.name} workflow event asset ${asset.id} records sourceTaskType`);
    const storedAsset = storedAssets.find((candidate) => candidate.id === asset.id);
    assertEqual(storedAsset?.sourceTaskId, processingResult.taskId, `${workflow.name} workflow persisted asset ${asset.id} records sourceTaskId`);
    assertEqual(storedAsset?.sourceTaskType, processedTask?.type, `${workflow.name} workflow persisted asset ${asset.id} records sourceTaskType`);
  }
  assertRule(processingMessages.details.length >= 1, `${workflow.name} workflow creates a completion message`);
}

async function assertRejectedProcessingWorkflow({ services, workflow }) {
  resetStorage();
  const taskAddedEvents = captureEvents(services, 'taskAdded');
  const taskUpdatedEvents = captureEvents(services, 'taskUpdated');
  const assetAddedEvents = captureEvents(services, 'assetAdded');
  const messageAddedEvents = captureEvents(services, 'messageAdded');
  let rejectedError = null;

  try {
    await withImmediateTimers(async () => workflow.process(workflow.params));
  } catch (error) {
    rejectedError = error;
  } finally {
    taskAddedEvents.stop();
    taskUpdatedEvents.stop();
    assetAddedEvents.stop();
    messageAddedEvents.stop();
  }

  const rejectedMessage = rejectedError instanceof Error ? rejectedError.message : '';
  assertRule(rejectedError instanceof Error, `${workflow.name} rejects invalid processing source`);
  assertRule(
    rejectedMessage.toLowerCase().includes(workflow.expectedMessagePart ?? 'source media'),
    `${workflow.name} rejection explains ${workflow.expectedMessagePart ?? 'source media'}`,
  );
  const storedTasks = readScopedStoredArray(services, 'tasks');
  if (workflow.expectFailedTask) {
    assertEqual(storedTasks.length, 1, `${workflow.name} rejection persists one failed task for user-visible diagnostics`);
    assertEqual(storedTasks[0]?.status, 'failed', `${workflow.name} rejection persists failed task status`);
    assertRule(
      String(storedTasks[0]?.errorMessage ?? '').toLowerCase().includes(workflow.expectedMessagePart ?? 'source media'),
      `${workflow.name} rejection stores the actionable failure reason on the task`,
    );
    const expectedSourceName = workflow.expectedTaskNamePart ?? resolveWorkflowSourceName(workflow.params);
    if (expectedSourceName) {
      assertTaskNameUsesSourceAndSecondTimestamp(
        storedTasks[0],
        expectedSourceName,
        `${workflow.name} failed task name`,
      );
    }
    assertEqual(taskAddedEvents.details.length, 1, `${workflow.name} rejection dispatches taskAdded for the failed task`);
    assertRule(taskUpdatedEvents.details.length >= 1, `${workflow.name} rejection dispatches taskUpdated for failed task state`);
  } else {
    assertEqual(storedTasks.length, 0, `${workflow.name} rejection does not persist tasks`);
    assertEqual(taskAddedEvents.details.length, 0, `${workflow.name} rejection does not dispatch taskAdded`);
    assertEqual(taskUpdatedEvents.details.length, 0, `${workflow.name} rejection does not dispatch taskUpdated`);
  }
  assertEqual(readScopedStoredArray(services, 'assets').length, 0, `${workflow.name} rejection does not persist generated assets`);
  assertEqual(readScopedStoredArray(services, 'messages').length, 0, `${workflow.name} rejection does not persist messages`);
  assertEqual(assetAddedEvents.details.length, 0, `${workflow.name} rejection does not dispatch assetAdded`);
  assertEqual(messageAddedEvents.details.length, 0, `${workflow.name} rejection does not dispatch messageAdded`);
}

async function run() {
  assertRule(
    packageJson.scripts?.test?.includes('node scripts/check-autocut-service-behavior.mjs'),
    'root test runs the AutoCut service behavior contract',
  );

  installBrowserRuntime();

  const server = null;

  try {
    const services = await loadModule(server, 'packages/sdkwork-autocut-services/src/index.ts');
    const types = await loadModule(server, 'packages/sdkwork-autocut-types/src/index.ts');
    const {
      processVideoSlice,
      assertSmartSliceResultsMeetProfessionalStandard,
      assertSmartSlicePlanReadyForNativeRender,
    } = await loadModule(
      server,
      'packages/sdkwork-autocut-slicer/src/service/slicerService.ts',
    );
    const { processExtractorText } = await loadModule(
      server,
      'packages/sdkwork-autocut-extractor-text/src/service/extractorTextService.ts',
    );
    const { processAudioExtraction } = await loadModule(
      server,
      'packages/sdkwork-autocut-extractor-audio/src/service/audioExtractorService.ts',
    );
    const { processVideoGif } = await loadModule(
      server,
      'packages/sdkwork-autocut-video-gif/src/service/videoGifService.ts',
    );
    const { processVideoCompress } = await loadModule(
      server,
      'packages/sdkwork-autocut-video-compress/src/service/videoCompressService.ts',
    );
    const { processVideoConvert } = await loadModule(
      server,
      'packages/sdkwork-autocut-video-convert/src/service/videoConvertService.ts',
    );
    const { processVideoEnhance } = await loadModule(
      server,
      'packages/sdkwork-autocut-video-enhance/src/service/videoEnhanceService.ts',
    );
    const { processSubtitleTranslate } = await loadModule(
      server,
      'packages/sdkwork-autocut-subtitle-translate/src/service/subtitleTranslateService.ts',
    );
    const { processVoiceTranslate } = await loadModule(
      server,
      'packages/sdkwork-autocut-voice-translate/src/service/voiceTranslateService.ts',
    );

    resetStorage();
    services.resetAutoCutNativeHostClient();
    const emptyBrowserTasks = await withImmediateTimers(() => services.getTasks());
    assertEqual(emptyBrowserTasks.length, 0, 'getTasks does not seed browser fallback storage with mock tasks');
    assertDeepEqual(
      types.AUTOCUT_TASK_TYPE,
      {
        videoSlice: 'video-slice',
        textExtraction: 'text-extraction',
        audioExtraction: 'audio-extraction',
        videoGif: 'video-gif',
        videoCompress: 'video-compress',
        videoConvert: 'video-convert',
        videoEnhance: 'video-enhance',
        subtitleTranslate: 'subtitle-translate',
        voiceTranslate: 'voice-translate',
      },
      'TaskType is a stable code enum instead of localized display text',
    );
    assertRule(
      types.AUTOCUT_TASK_TYPES.every((taskType) => /^[a-z][a-z0-9-]*$/u.test(taskType)),
      'AUTOCUT_TASK_TYPES contains only stable ASCII task type codes',
    );
    assertRule(
      typeof services.getAutoCutTaskTypeLabel === 'function',
      'services exports the i18n task type label resolver',
    );
    assertRule(
      typeof services.getAutoCutI18n === 'function',
      'services exports the standard i18next instance accessor',
    );
    assertRule(
      typeof services.initializeAutoCutI18n === 'function',
      'services exports the standard i18next initializer',
    );
    services.clearAutoCutDiagnostics();
    const consoleDiagnosticCalls = captureConsoleDiagnostics(() => {
      services.reportAutoCutDiagnostic(
        'error',
        'slicer.submit',
        'Smart Slice failed before native dispatch',
        new Error('AutoCut minimum slice duration must be less than or equal to the maximum slice duration.'),
      );
    });
    assertEqual(
      consoleDiagnosticCalls.length,
      1,
      'reportAutoCutDiagnostic writes user-visible diagnostics to the browser console',
    );
    assertEqual(
      consoleDiagnosticCalls[0]?.level,
      'error',
      'reportAutoCutDiagnostic uses console.error for error-level diagnostics',
    );
    assertRule(
      String(consoleDiagnosticCalls[0]?.args?.[0] ?? '').includes('[AutoCut:slicer.submit] Smart Slice failed before native dispatch'),
      'reportAutoCutDiagnostic console prefix includes the AutoCut source and diagnostic message',
    );
    assertEqual(
      consoleDiagnosticCalls[0]?.args?.[1]?.errorMessage,
      'AutoCut minimum slice duration must be less than or equal to the maximum slice duration.',
      'reportAutoCutDiagnostic console payload includes the underlying error message',
    );
    assertRule(
      consoleDiagnosticCalls[0]?.args?.some((arg) => arg instanceof Error),
      'reportAutoCutDiagnostic console output preserves the original Error object for stack inspection',
    );
    const storedConsoleDiagnostics = services.getAutoCutDiagnostics();
    assertEqual(
      storedConsoleDiagnostics[0]?.errorMessage,
      'AutoCut minimum slice duration must be less than or equal to the maximum slice duration.',
      'reportAutoCutDiagnostic still stores diagnostics after writing to console',
    );
    assertRule(
      typeof assertSmartSliceResultsMeetProfessionalStandard === 'function',
      'slicer service exports the smart slice professional completion gate',
    );
    assertRule(
      typeof assertSmartSlicePlanReadyForNativeRender === 'function',
      'slicer service exports the smart slice native-render readiness gate',
    );
    const slicerServiceSource = readFileSync(
      path.join(rootDir, 'packages/sdkwork-autocut-slicer/src/service/slicerService.ts'),
      'utf8',
    );
    assertIncludes(
      slicerServiceSource,
      'assertSmartSlicePlanReadyForNativeRender(resolvedPlannedClips, transcriptSegments',
      'processVideoSlice validates planned smart slices before dispatching native video rendering',
    );
    if (typeof assertSmartSliceResultsMeetProfessionalStandard === 'function') {
      const professionalSliceResult = {
        id: 'professional-slice-1',
        name: 'professional-slice-1.mp4',
        duration: 17,
        size: 123456,
        resolution: '1080P',
        thumbnailUrl: 'asset://localhost/professional-slice-1.jpg',
        url: 'asset://localhost/professional-slice-1.mp4',
        sourceStartMs: 3800,
        sourceEndMs: 20250,
        speechStartMs: 4000,
        speechEndMs: 20000,
        boundaryPaddingBeforeMs: 200,
        boundaryPaddingAfterMs: 250,
        transcriptText: 'The hook starts immediately. The payoff ends cleanly.',
        transcriptSegments: [
          { startMs: 4000, endMs: 12000, text: 'The hook starts immediately.' },
          { startMs: 12000, endMs: 20000, text: 'The payoff ends cleanly.' },
        ],
        transcriptSegmentCount: 2,
        transcriptCoverageScore: 0.96,
        speechContinuityGrade: 'strong',
      };
      let acceptedProfessionalSlice = true;
      try {
        assertSmartSliceResultsMeetProfessionalStandard([professionalSliceResult]);
      } catch {
        acceptedProfessionalSlice = false;
      }
      assertRule(
        acceptedProfessionalSlice,
        'smart slice professional completion gate accepts slices with structured STT and bounded speech padding',
      );
      await assertRejects(
        () => assertSmartSliceResultsMeetProfessionalStandard([
          {
            ...professionalSliceResult,
            sourceStartMs: 0,
            speechStartMs: 1200,
            boundaryPaddingBeforeMs: 1200,
          },
        ]),
        'no more than 200ms leading and 250ms trailing silence',
        'smart slice professional completion gate rejects excessive leading silence',
      );
      await assertRejects(
        () => assertSmartSliceResultsMeetProfessionalStandard([
          {
            ...professionalSliceResult,
            transcriptSegmentCount: 3,
          },
        ]),
        'transcriptSegmentCount to match structured transcriptSegments',
        'smart slice professional completion gate rejects transcript segment count mismatches',
      );
      await assertRejects(
        () => assertSmartSliceResultsMeetProfessionalStandard([
          {
            ...professionalSliceResult,
            transcriptText: [
              'This starts outside the rendered source range.',
              'The hook starts immediately.',
              'The payoff ends cleanly.',
            ].join(' '),
            transcriptSegments: [
              { startMs: 3600, endMs: 4100, text: 'This starts outside the rendered source range.' },
              ...professionalSliceResult.transcriptSegments,
            ],
            transcriptSegmentCount: 3,
          },
        ]),
        'inside its rendered source range',
        'smart slice professional completion gate rejects transcript segments outside the source range',
      );
      await assertRejects(
        () => assertSmartSliceResultsMeetProfessionalStandard([
          {
            ...professionalSliceResult,
            transcriptText: 'A stale AI summary is not valid speech-to-text evidence.',
          },
        ]),
        'transcriptText to match structured transcriptSegments',
        'smart slice professional completion gate rejects transcript text that does not match structured STT segments',
      );
      await assertRejects(
        () => assertSmartSliceResultsMeetProfessionalStandard([
          {
            ...professionalSliceResult,
            sourceStartMs: 3850,
            speechStartMs: 3910,
          },
        ]),
        'speech range to match structured transcript segment boundaries',
        'smart slice professional completion gate rejects speechStartMs that does not match the first structured STT segment',
      );
      await assertRejects(
        () => assertSmartSliceResultsMeetProfessionalStandard([
          {
            ...professionalSliceResult,
            sourceEndMs: 20150,
            speechEndMs: 20090,
          },
        ]),
        'speech range to match structured transcript segment boundaries',
        'smart slice professional completion gate rejects speechEndMs that does not match the final structured STT segment',
      );
      await assertRejects(
        () => assertSmartSliceResultsMeetProfessionalStandard([
          {
            ...professionalSliceResult,
            transcriptText: 'The payoff ends cleanly. The hook starts immediately.',
            transcriptSegments: [
              { startMs: 12000, endMs: 20000, text: 'The payoff ends cleanly.' },
              { startMs: 4000, endMs: 12000, text: 'The hook starts immediately.' },
            ],
          },
        ]),
        'transcript segments to be ordered and non-overlapping',
        'smart slice professional completion gate rejects out-of-order structured STT segments',
      );
      await assertRejects(
        () => assertSmartSliceResultsMeetProfessionalStandard([
          {
            ...professionalSliceResult,
            transcriptCoverageScore: 0.79,
          },
        ]),
        'transcriptCoverageScore to be at least 0.8',
        'smart slice professional completion gate rejects low transcript coverage before task completion',
      );
      await assertRejects(
        () => assertSmartSliceResultsMeetProfessionalStandard([
          {
            ...professionalSliceResult,
            speechContinuityGrade: 'weak',
          },
        ]),
        'speechContinuityGrade to be strong or repaired',
        'smart slice professional completion gate rejects weak speech continuity before task completion',
      );
      await assertRejects(
        () => assertSmartSliceResultsMeetProfessionalStandard([
          {
            ...professionalSliceResult,
            speechContinuityGrade: undefined,
          },
        ]),
        'speechContinuityGrade to be strong or repaired',
        'smart slice professional completion gate rejects missing speech continuity grade before task completion',
      );
    }
    if (typeof assertSmartSlicePlanReadyForNativeRender === 'function') {
      const professionalTranscriptSegments = [
        { startMs: 4000, endMs: 12000, text: 'The hook starts immediately.' },
        { startMs: 12000, endMs: 20000, text: 'The payoff ends cleanly.' },
        { startMs: 20450, endMs: 29800, text: 'The second clip starts after the first rendered window.' },
      ];
      const professionalPlanClip = {
        index: 0,
        startMs: 3800,
        durationMs: 16450,
        label: 'Professional clip',
        sourceStartMs: 3800,
        sourceEndMs: 20250,
        speechStartMs: 4000,
        speechEndMs: 20000,
        boundaryPaddingBeforeMs: 200,
        boundaryPaddingAfterMs: 250,
        transcriptText: 'The hook starts immediately. The payoff ends cleanly.',
        transcriptSegmentCount: 2,
        transcriptCoverageScore: 0.96,
        speechContinuityGrade: 'strong',
      };
      const professionalSecondPlanClip = {
        index: 1,
        startMs: 20250,
        durationMs: 9800,
        label: 'Professional second clip',
        sourceStartMs: 20250,
        sourceEndMs: 30050,
        speechStartMs: 20450,
        speechEndMs: 29800,
        boundaryPaddingBeforeMs: 200,
        boundaryPaddingAfterMs: 250,
        transcriptText: 'The second clip starts after the first rendered window.',
        transcriptSegmentCount: 1,
        transcriptCoverageScore: 1,
        speechContinuityGrade: 'strong',
      };
      let acceptedProfessionalPlan = true;
      try {
        assertSmartSlicePlanReadyForNativeRender(
          [professionalPlanClip, professionalSecondPlanClip],
          professionalTranscriptSegments,
          60000,
        );
      } catch {
        acceptedProfessionalPlan = false;
      }
      assertRule(
        acceptedProfessionalPlan,
        'smart slice native-render readiness gate accepts chronological transcript-backed planned clips',
      );
      await assertRejects(
        () => assertSmartSlicePlanReadyForNativeRender(
          [
            professionalPlanClip,
            {
              ...professionalSecondPlanClip,
              startMs: 20000,
              sourceStartMs: 20000,
            },
          ],
          professionalTranscriptSegments,
          60000,
        ),
        'planned clip 2 to start after the previous rendered clip ends',
        'smart slice native-render readiness gate rejects overlapping planned render windows',
      );
      await assertRejects(
        () => assertSmartSlicePlanReadyForNativeRender(
          [
            professionalSecondPlanClip,
            professionalPlanClip,
          ],
          professionalTranscriptSegments,
          60000,
        ),
        'planned clip 2 to start after the previous rendered clip ends',
        'smart slice native-render readiness gate rejects out-of-order planned render windows',
      );
      await assertRejects(
        () => assertSmartSlicePlanReadyForNativeRender(
          [
            {
              ...professionalPlanClip,
              startMs: 55000,
              durationMs: 10000,
              sourceStartMs: 55000,
              sourceEndMs: 65000,
              speechStartMs: 55200,
              speechEndMs: 64750,
            },
          ],
          professionalTranscriptSegments,
          60000,
        ),
        'stay inside the imported media duration',
        'smart slice native-render readiness gate rejects planned clips outside imported media duration',
      );
      await assertRejects(
        () => assertSmartSlicePlanReadyForNativeRender(
          [
            {
              ...professionalPlanClip,
              transcriptSegmentCount: 3,
            },
          ],
          professionalTranscriptSegments,
          60000,
        ),
        'transcriptSegmentCount to match structured speech-to-text coverage',
        'smart slice native-render readiness gate rejects transcript count mismatches before native rendering',
      );
      await assertRejects(
        () => assertSmartSlicePlanReadyForNativeRender(
          [professionalPlanClip],
          [],
          60000,
        ),
        'structured speech-to-text transcript segments',
        'smart slice native-render readiness gate rejects planned clips without real STT coverage before native rendering',
      );
    }
    if (typeof services.getAutoCutI18n === 'function') {
      const i18n = services.getAutoCutI18n();
      assertRule(
        typeof i18n?.t === 'function' && typeof i18n?.changeLanguage === 'function',
        'getAutoCutI18n returns an i18next-compatible runtime instance',
      );
    }
    if (typeof services.getAutoCutTaskTypeLabel === 'function') {
      assertEqual(
        services.getAutoCutTaskTypeLabel(types.AUTOCUT_TASK_TYPE.textExtraction, 'zh-CN'),
        '文案提取',
        'getAutoCutTaskTypeLabel resolves the zh-CN task type display label from i18n resources',
      );
      assertEqual(
        services.getAutoCutTaskTypeLabel(types.AUTOCUT_TASK_TYPE.textExtraction, 'en-US'),
        'Text extraction',
        'getAutoCutTaskTypeLabel resolves the en-US task type display label from i18n resources',
      );
    }
    if (typeof services.getTools === 'function') {
      const localizedTools = await services.getTools();
      const textExtractionTool = localizedTools.find((tool) => tool.id === 'extractor-text');
      assertEqual(
        textExtractionTool?.nameKey,
        'tool.extractorText.name',
        'getTools returns stable i18n name keys for tool display labels',
      );
      assertEqual(
        textExtractionTool?.descriptionKey,
        'tool.extractorText.description',
        'getTools returns stable i18n description keys for tool display labels',
      );
      assertEqual(
        textExtractionTool?.name,
        '文案提取',
        'getTools resolves localized tool display names through i18next resources',
      );
      assertRule(
        localizedTools.every((tool) => /^[a-z][a-z0-9-]*$/u.test(tool.id)),
        'getTools keeps tool ids as stable ASCII codes instead of localized display text',
      );
    }
    assertRule(typeof services.createAutoCutTaskName === 'function', 'services exports the standard AutoCut task naming helper');
    if (typeof services.createAutoCutTaskName === 'function') {
      const deterministicTaskTimestamp = new Date(2026, 4, 7, 8, 9, 10);
      assertEqual(
        services.createAutoCutTaskName({
          sourceName: 'meeting.final.mp4',
          createdAt: deterministicTaskTimestamp,
        }),
        'meeting.final.mp4 20260507-080910',
        'createAutoCutTaskName keeps the original file name and appends a local second-precision timestamp',
      );
      assertEqual(
        services.createAutoCutTaskName({
          url: 'https://media.example.com/uploads/source%20clip.mp4?download=1',
          createdAt: deterministicTaskTimestamp,
        }),
        'source clip.mp4 20260507-080910',
        'createAutoCutTaskName derives the original file name from URL paths',
      );
      assertEqual(
        services.createAutoCutTaskName({
          sourceName: 'meeting.final.mp4 20260507-080910',
          createdAt: deterministicTaskTimestamp,
        }),
        'meeting.final.mp4 20260507-080910',
        'createAutoCutTaskName does not append a duplicate timestamp to already-standard task names',
      );
    }
    assertEqual(
      services.getAutoCutTimestampMs('2026-05-09 04:12:00'),
      services.getAutoCutTimestampMs('2026-05-09T04:12:00.000Z'),
      'datetime service treats native SQLite UTC timestamps without timezone suffix as UTC instants',
    );
    assertEqual(
      services.formatAutoCutDateTime('2026-05-09 04:12:00'),
      services.formatAutoCutDateTime('2026-05-09T04:12:00.000Z'),
      'datetime service renders native SQLite UTC timestamps consistently with ISO UTC timestamps',
    );
    assertRule(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(services.formatAutoCutDateTime('2026-05-09T04:12:00.000Z')),
      'formatAutoCutDateTime returns stable local YYYY-MM-DD HH:mm:ss text for task lists',
    );
    assertRule(
      /^\d{2}:\d{2}:\d{2}$/u.test(services.formatAutoCutTimeOfDay('2026-05-09T04:12:00.000Z')),
      'formatAutoCutTimeOfDay returns stable local HH:mm:ss text for compact task previews',
    );

    resetStorage();
    const nativeTaskListCommands = [];
    services.configureAutoCutNativeHostClient(services.createAutoCutNativeHostClient(async (command, args) => {
      nativeTaskListCommands.push({ command, args });
      if (command === 'autocut_host_capabilities') {
        return {
          contractVersion: 'task-list-contract',
          hostKind: 'native-host',
          databaseContractReady: true,
          sqliteMigrationReady: true,
          databaseHealthCommandReady: true,
          ffmpegProbeCommandReady: true,
          mediaImportCommandReady: true,
          mediaFileDescribeCommandReady: true,
          localVideoFileSelectCommandReady: true,
          localDirectorySelectCommandReady: true,
          audioExtractionCommandReady: true,
          audioExtractionFromAssetReady: true,
          videoGifCommandReady: true,
          videoSliceCommandReady: true,
          videoCompressCommandReady: true,
          videoConvertCommandReady: true,
          videoEnhanceCommandReady: true,
          speechTranscriptionCommandReady: true,
          speechTranscriptionToolchainReady: true,
          speechTranscriptionProbeCommandReady: true,
          speechTranscriptionFileSelectCommandReady: true,
          llmHttpCommandReady: true,
          llmSecretStoreReady: true,
          nativeTaskQueryCommandReady: true,
          nativeTaskCancelCommandReady: true,
          nativeTaskRecoveryCommandReady: true,
          nativeTaskRetryCommandReady: true,
          nativeTaskProgressEventsReady: true,
          nativeWorkerLeaseReady: true,
          ffmpegToolchainManifestReady: true,
          ffmpegToolchainResolverReady: true,
          ffmpegBundledReady: false,
          ffmpegExecutionReady: false,
          supportedCommands: ['autocut_list_native_tasks'],
        };
      }
      if (command === 'autocut_list_native_tasks') {
        return [
          {
            uuid: 'ops-task-slice-contract',
            taskType: 6,
            status: 2,
            progress: 100,
            sourceAssetUuid: 'asset-slice-contract',
            inputJson: JSON.stringify({
              operation: 'videoSlice',
              assetUuid: 'asset-slice-contract',
              sourceName: 'native-source.mp4',
              outputFormat: 'mp4',
            }),
            outputJson: JSON.stringify({
              name: 'slice-001.mp4',
              assetUuid: 'asset-slice-contract',
              taskOutputDir: 'D:/autocut/media/tasks/ops-task-slice-contract/outputs',
              sliceCount: 1,
              sliceResults: [
                {
                  artifactUuid: 'slice-artifact-contract',
                  artifactPath: 'D:/autocut/media/tasks/ops-task-slice-contract/outputs/slice-001.mp4',
                  thumbnailArtifactUuid: 'slice-thumb-contract',
                  thumbnailArtifactPath: 'D:/autocut/media/tasks/ops-task-slice-contract/outputs/cover/slice-001.jpg',
                  subtitleArtifactUuid: 'slice-subtitle-contract',
                  subtitleArtifactPath: 'D:/autocut/media/tasks/ops-task-slice-contract/outputs/slice-001.srt',
                  taskOutputDir: 'D:/autocut/media/tasks/ops-task-slice-contract/outputs',
                  byteSize: 1234567,
                  thumbnailByteSize: 12345,
                  subtitleByteSize: 234,
                  subtitleFormat: 'srt',
                  format: 'mp4',
                  startMs: 1000,
                  durationMs: 15000,
                  label: 'Opening',
                  sourceStartMs: 1000,
                  sourceEndMs: 16000,
                  speechStartMs: 1200,
                  speechEndMs: 15750,
                  boundaryPaddingBeforeMs: 200,
                  boundaryPaddingAfterMs: 250,
                  transcriptText: 'Native transcript text survives recovered task projection.',
                  transcriptSegments: [
                    {
                      startMs: 1200,
                      endMs: 15750,
                      text: 'Native transcript text survives recovered task projection.',
                      speaker: 'Speaker 1',
                    },
                  ],
                  transcriptSegmentCount: 1,
                  transcriptCoverageScore: 0.96,
                  speechContinuityGrade: 'strong',
                },
              ],
            }),
            createdAt: '2026-05-05T00:00:00.000Z',
            updatedAt: '2026-05-05T00:05:00.000Z',
            stages: [],
            events: [
              {
                uuid: 'ops-event-slice-progress-contract',
                eventType: 8,
                payload: {
                  operation: 'videoSlice',
                  phase: 'ffmpeg-progress-streamed',
                  source: 'ffmpeg-progress',
                  progress: 88,
                },
                payloadJson: '{"operation":"videoSlice","phase":"ffmpeg-progress-streamed","source":"ffmpeg-progress","progress":88}',
                createdAt: '2026-05-05T00:04:00.000Z',
                updatedAt: '2026-05-05T00:04:00.000Z',
              },
            ],
            workerLeases: [],
          },
          {
            uuid: 'ops-task-transcript-contract',
            taskType: 7,
            status: 2,
            progress: 100,
            sourceAssetUuid: 'asset-transcript-contract',
            inputJson: JSON.stringify({
              operation: 'speechTranscription',
              assetUuid: 'asset-transcript-contract',
              language: 'zh',
            }),
            outputJson: JSON.stringify({
              assetUuid: 'asset-transcript-contract',
              artifactUuid: 'transcript-artifact-contract',
              transcriptPath: 'D:/autocut/media/tasks/ops-task-transcript-contract/outputs/transcript.json',
              taskOutputDir: 'D:/autocut/media/tasks/ops-task-transcript-contract/outputs',
              language: 'zh',
              segmentCount: 2,
              segments: [
                { startMs: 0, endMs: 1400, text: 'hello', speaker: 'Speaker 1' },
                { startMs: 1500, endMs: 3200, text: 'world', speaker: 'Speaker 2' },
              ],
              text: 'hello world',
              byteSize: 4567,
            }),
            createdAt: '2026-05-05T00:01:00.000Z',
            updatedAt: '2026-05-05T00:06:00.000Z',
            stages: [],
            events: [],
            workerLeases: [],
          },
          {
            uuid: 'ops-task-transcript-corrupt-contract',
            taskType: 7,
            status: 2,
            progress: 100,
            sourceAssetUuid: 'asset-transcript-corrupt-contract',
            inputJson: JSON.stringify({
              operation: 'speechTranscription',
              assetUuid: 'asset-transcript-corrupt-contract',
              language: 'en',
            }),
            outputJson: JSON.stringify({
              assetUuid: 'asset-transcript-corrupt-contract',
              artifactUuid: 'transcript-artifact-corrupt-contract',
              transcriptPath: 'D:/autocut/media/tasks/ops-task-transcript-corrupt-contract/outputs/transcript.json',
              taskOutputDir: 'D:/autocut/media/tasks/ops-task-transcript-corrupt-contract/outputs',
              language: 'en',
              segmentCount: 2,
              segments: [
                { startMs: 0, endMs: 1400, text: 'valid segment', speaker: 'Speaker 1' },
                { startMs: 1500, endMs: 1400, text: 'invalid timing', speaker: 'Speaker 2' },
              ],
              text: 'valid segment invalid timing',
              byteSize: 4567,
            }),
            createdAt: '2026-05-05T00:01:30.000Z',
            updatedAt: '2026-05-05T00:06:30.000Z',
            stages: [],
            events: [],
            workerLeases: [],
          },
          {
            uuid: 'ops-task-compress-contract',
            taskType: 3,
            status: 2,
            progress: 100,
            sourceAssetUuid: 'asset-compress-contract',
            inputJson: JSON.stringify({
              operation: 'videoCompress',
              assetUuid: 'asset-compress-contract',
              compressionMode: 'balanced',
            }),
            outputJson: JSON.stringify({
              assetUuid: 'asset-compress-contract',
              artifactUuid: 'compress-artifact-contract',
              artifactPath: 'D:/autocut/media/tasks/ops-task-compress-contract/outputs/compressed.mp4',
              taskOutputDir: 'D:/autocut/media/tasks/ops-task-compress-contract/outputs',
              format: 'mp4',
              byteSize: 2500,
              originalByteSize: 10000,
            }),
            createdAt: '2026-05-05T00:02:00.000Z',
            updatedAt: '2026-05-05T00:07:00.000Z',
            stages: [],
            events: [
              {
                uuid: 'ops-event-compress-completed-contract',
                eventType: 2,
                payload: {
                  operation: 'videoCompress',
                  artifactUuid: 'compress-artifact-contract',
                  artifactPath: 'D:/autocut/media/tasks/ops-task-compress-contract/outputs/compressed.mp4',
                  taskOutputDir: 'D:/autocut/media/tasks/ops-task-compress-contract/outputs',
                  byteSize: 2500,
                  originalByteSize: 10000,
                  progress: 100,
                  phase: 'completed',
                  source: 'native-host',
                },
                payloadJson: '{}',
                createdAt: '2026-05-05T00:07:00.000Z',
                updatedAt: '2026-05-05T00:07:00.000Z',
              },
            ],
            workerLeases: [],
          },
          {
            uuid: 'ops-task-failed-contract',
            taskType: 1,
            status: 3,
            progress: 42,
            sourceAssetUuid: 'asset-failed-contract',
            inputJson: JSON.stringify({
              operation: 'audioExtraction',
              assetUuid: 'asset-failed-contract',
              outputFormat: 'wav',
            }),
            outputJson: '{}',
            errorCode: 'FFMPEG_AUDIO_EXTRACTION_FAILED',
            errorMessage: 'ffmpeg exited with status 1',
            createdAt: '2026-05-05T00:03:00.000Z',
            updatedAt: '2026-05-05T00:08:00.000Z',
            stages: [],
            events: [],
            workerLeases: [],
          },
          {
            uuid: 'ops-task-corrupt-slice-contract',
            taskType: 6,
            status: 2,
            progress: 100,
            sourceAssetUuid: 'asset-corrupt-slice-contract',
            inputJson: JSON.stringify({
              operation: 'videoSlice',
              assetUuid: 'asset-corrupt-slice-contract',
              outputFormat: 'mp4',
            }),
            outputJson: JSON.stringify({
              assetUuid: 'asset-corrupt-slice-contract',
              taskOutputDir: 'D:/autocut/media/tasks/ops-task-corrupt-slice-contract/outputs',
              sliceCount: 2,
              sliceResults: [
                {
                  artifactUuid: 'corrupt-slice-artifact-contract',
                  artifactPath: 'D:/autocut/media/tasks/ops-task-corrupt-slice-contract/outputs/slice-001.mp4',
                  taskOutputDir: 'D:/autocut/media/tasks/ops-task-corrupt-slice-contract/outputs',
                  byteSize: 0,
                  startMs: 0,
                  durationMs: 15000,
                  label: 'Corrupt opening',
                },
              ],
            }),
            createdAt: '2026-05-05T00:04:00.000Z',
            updatedAt: '2026-05-05T00:09:00.000Z',
            stages: [],
            events: [],
            workerLeases: [],
          },
          {
            uuid: 'ops-task-empty-completed-slice-contract',
            taskType: 6,
            status: 2,
            progress: 100,
            sourceAssetUuid: 'asset-empty-completed-slice-contract',
            inputJson: JSON.stringify({
              operation: 'videoSlice',
              assetUuid: 'asset-empty-completed-slice-contract',
              outputFormat: 'mp4',
            }),
            outputJson: JSON.stringify({
              assetUuid: 'asset-empty-completed-slice-contract',
              taskOutputDir: 'D:/autocut/media/tasks/ops-task-empty-completed-slice-contract/outputs',
              sliceCount: 0,
              sliceResults: [],
            }),
            createdAt: '2026-05-05T00:04:30.000Z',
            updatedAt: '2026-05-05T00:09:30.000Z',
            stages: [],
            events: [],
            workerLeases: [],
          },
          {
            uuid: 'ops-task-processing-slice-contract',
            taskType: 6,
            status: 1,
            progress: 48,
            sourceAssetUuid: 'asset-processing-slice-contract',
            inputJson: JSON.stringify({
              operation: 'videoSlice',
              assetUuid: 'asset-processing-slice-contract',
              outputFormat: 'mp4',
            }),
            outputJson: '{}',
            createdAt: '2026-05-05T00:04:45.000Z',
            updatedAt: '2026-05-05T00:09:45.000Z',
            stages: [],
            events: [
              {
                uuid: 'ops-event-processing-slice-progress-contract',
                eventType: 8,
                payload: {
                  operation: 'videoSlice',
                  phase: 'rendering',
                  source: 'ffmpeg-progress',
                  progress: 48,
                },
                payloadJson: '{"operation":"videoSlice","phase":"rendering","source":"ffmpeg-progress","progress":48}',
                createdAt: '2026-05-05T00:09:40.000Z',
                updatedAt: '2026-05-05T00:09:40.000Z',
              },
            ],
            workerLeases: [],
          },
        ];
      }

      throw new Error(`Unexpected task list native host command: ${command}`);
    }, {
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    }));
    const nativeTasks = await withImmediateTimers(() => services.getTasks());
    assertIncludes(
      nativeTaskListCommands.map((entry) => entry.command),
      'autocut_list_native_tasks',
      'getTasks queries persisted native ops_task snapshots when the native task bridge is ready',
    );
    assertEqual(
      nativeTaskListCommands.find((entry) => entry.command === 'autocut_list_native_tasks')?.args?.request?.limit,
      100,
      'getTasks bounds the native task list query to the native database contract limit',
    );
    assertEqual(nativeTasks.length, 6, 'getTasks maps visible native ops_task snapshots and hides implementation-only speech transcription tasks');
    const nativeSliceTask = nativeTasks.find((task) => task.id === 'ops-task-slice-contract');
    assertEqual(nativeSliceTask?.type, types.AUTOCUT_TASK_TYPES[0], 'native video slice tasks map to the AppTask slice type');
    assertEqual(nativeSliceTask?.status, types.AUTOCUT_TASK_STATUS.completed, 'native completed status maps to completed AppTask status');
    assertTaskNameUsesSourceAndSecondTimestamp(
      nativeSliceTask,
      'native-source.mp4',
      'native video slice task list projection name',
    );
    assertEqual(nativeSliceTask?.completedAt, '2026-05-05T00:05:00.000Z', 'native completed tasks expose updatedAt as completedAt');
    assertEqual(nativeSliceTask?.resultCount, 1, 'native slice output_json sliceCount maps to AppTask resultCount');
    assertEqual(nativeSliceTask?.generatedAssetIds?.[0], 'slice-artifact-contract', 'native slice output maps generated asset ids from artifact UUIDs');
    assertEqual(
      nativeSliceTask?.sliceResults?.[0]?.url,
      'asset://localhost/D%3A%2Fautocut%2Fmedia%2Ftasks%2Fops-task-slice-contract%2Foutputs%2Fslice-001.mp4',
      'native slice output artifactPath is converted to a safe desktop asset URL',
    );
    assertEqual(
      nativeSliceTask?.sliceResults?.[0]?.thumbnailUrl,
      'asset://localhost/D%3A%2Fautocut%2Fmedia%2Ftasks%2Fops-task-slice-contract%2Foutputs%2Fcover%2Fslice-001.jpg',
      'native slice thumbnail artifactPath is converted to a safe desktop asset URL',
    );
    assertEqual(
      nativeSliceTask?.sliceResults?.[0]?.subtitleUrl,
      'asset://localhost/D%3A%2Fautocut%2Fmedia%2Ftasks%2Fops-task-slice-contract%2Foutputs%2Fslice-001.srt',
      'native slice subtitle artifactPath is converted to a safe desktop asset URL',
    );
    assertEqual(
      nativeSliceTask?.sliceResults?.[0]?.transcriptText,
      'Native transcript text survives recovered task projection.',
      'native completed slice task exposes recovered speech-to-text transcript text',
    );
    assertEqual(
      nativeSliceTask?.sliceResults?.[0]?.transcriptSegments?.[0]?.text,
      'Native transcript text survives recovered task projection.',
      'native completed slice task exposes recovered structured speech-to-text transcript segments',
    );

    resetStorage();
    services.configureAutoCutNativeHostClient(services.createAutoCutNativeHostClient(async (command) => {
      if (command === 'autocut_host_capabilities') {
        return {
          contractVersion: 'task-list-input-clip-transcript-recovery-contract',
          hostKind: 'native-host',
          databaseContractReady: true,
          sqliteMigrationReady: true,
          databaseHealthCommandReady: true,
          ffmpegProbeCommandReady: true,
          mediaImportCommandReady: true,
          mediaFileDescribeCommandReady: true,
          localVideoFileSelectCommandReady: true,
          localDirectorySelectCommandReady: true,
          localMediaPreviewDirectoryScopeCommandReady: true,
          audioExtractionCommandReady: true,
          audioExtractionFromAssetReady: true,
          videoGifCommandReady: true,
          videoSliceCommandReady: true,
          videoCompressCommandReady: true,
          videoConvertCommandReady: true,
          videoEnhanceCommandReady: true,
          speechTranscriptionCommandReady: true,
          speechTranscriptionToolchainReady: true,
          speechTranscriptionProbeCommandReady: true,
          speechTranscriptionFileSelectCommandReady: true,
          llmHttpCommandReady: true,
          llmSecretStoreReady: true,
          nativeTaskQueryCommandReady: true,
          nativeTaskCancelCommandReady: true,
          nativeTaskRecoveryCommandReady: true,
          nativeTaskRetryCommandReady: true,
          nativeTaskProgressEventsReady: true,
          nativeWorkerLeaseReady: true,
          ffmpegToolchainManifestReady: true,
          ffmpegToolchainResolverReady: true,
          ffmpegBundledReady: false,
          ffmpegExecutionReady: false,
          supportedCommands: ['autocut_list_native_tasks'],
        };
      }
      if (command === 'autocut_list_native_tasks') {
        const recoveredInputClip = {
          startMs: 1000,
          durationMs: 15000,
          label: 'Opening',
          sourceStartMs: 1000,
          sourceEndMs: 16000,
          speechStartMs: 1200,
          speechEndMs: 15750,
          boundaryPaddingBeforeMs: 200,
          boundaryPaddingAfterMs: 250,
          transcriptText: 'Input clip transcript evidence restores recovered native output.',
          transcriptSegments: [
            {
              startMs: 1200,
              endMs: 15750,
              text: 'Input clip transcript evidence restores recovered native output.',
              speaker: 'Speaker 1',
            },
          ],
          transcriptSegmentCount: 1,
          transcriptCoverageScore: 0.96,
          speechContinuityGrade: 'strong',
        };
        const lowCoverageInputClip = {
          ...recoveredInputClip,
          label: 'Low coverage opening',
          transcriptText: 'Low transcript coverage should not recover as a completed slice.',
          transcriptSegments: [
            {
              startMs: 1200,
              endMs: 15750,
              text: 'Low transcript coverage should not recover as a completed slice.',
              speaker: 'Speaker 1',
            },
          ],
          transcriptCoverageScore: 0.79,
          speechContinuityGrade: 'strong',
        };
        const weakContinuityInputClip = {
          ...recoveredInputClip,
          label: 'Weak continuity opening',
          transcriptText: 'Weak speech continuity should not recover as a completed slice.',
          transcriptSegments: [
            {
              startMs: 1200,
              endMs: 15750,
              text: 'Weak speech continuity should not recover as a completed slice.',
              speaker: 'Speaker 1',
            },
          ],
          transcriptCoverageScore: 0.96,
          speechContinuityGrade: 'weak',
        };
        const timingOnlyInputClip = {
          startMs: 1000,
          durationMs: 15000,
          label: 'Timing only opening',
          sourceStartMs: 1000,
          sourceEndMs: 16000,
        };
        return [
          {
            uuid: 'ops-task-slice-input-clip-transcript-recovery',
            taskType: 6,
            status: 2,
            progress: 100,
            sourceAssetUuid: 'asset-slice-input-clip-transcript-recovery',
            inputJson: JSON.stringify({
              operation: 'videoSlice',
              assetUuid: 'asset-slice-input-clip-transcript-recovery',
              sourceName: 'input-clip-recovery.mp4',
              outputFormat: 'mp4',
              clips: [recoveredInputClip],
              requestedClips: [recoveredInputClip],
            }),
            outputJson: JSON.stringify({
              assetUuid: 'asset-slice-input-clip-transcript-recovery',
              taskOutputDir: 'D:/autocut/media/tasks/ops-task-slice-input-clip-transcript-recovery/outputs',
              sliceCount: 1,
              sliceResults: [
                {
                  artifactUuid: 'slice-artifact-input-clip-transcript-recovery',
                  artifactPath: 'D:/autocut/media/tasks/ops-task-slice-input-clip-transcript-recovery/outputs/slice-001.mp4',
                  thumbnailArtifactUuid: 'slice-thumb-input-clip-transcript-recovery',
                  thumbnailArtifactPath: 'D:/autocut/media/tasks/ops-task-slice-input-clip-transcript-recovery/outputs/cover/slice-001.jpg',
                  taskOutputDir: 'D:/autocut/media/tasks/ops-task-slice-input-clip-transcript-recovery/outputs',
                  byteSize: 1234567,
                  thumbnailByteSize: 12345,
                  format: 'mp4',
                  startMs: 1000,
                  durationMs: 15000,
                  label: 'Opening',
                },
              ],
            }),
            createdAt: '2026-05-05T00:00:00.000Z',
            updatedAt: '2026-05-05T00:05:00.000Z',
            stages: [],
            events: [],
            workerLeases: [],
          },
          {
            uuid: 'ops-task-speech-transcript-backfill-recovery',
            taskType: 7,
            status: 2,
            progress: 100,
            sourceAssetUuid: 'asset-slice-speech-task-recovery',
            inputJson: JSON.stringify({
              operation: 'speechTranscription',
              assetUuid: 'asset-slice-speech-task-recovery',
              language: 'auto',
            }),
            outputJson: JSON.stringify({
              assetUuid: 'asset-slice-speech-task-recovery',
              artifactUuid: 'transcript-artifact-speech-task-recovery',
              transcriptPath: 'D:/autocut/media/tasks/ops-task-speech-transcript-backfill-recovery/outputs/transcript.json',
              taskOutputDir: 'D:/autocut/media/tasks/ops-task-speech-transcript-backfill-recovery/outputs',
              language: 'auto',
              segmentCount: 1,
              text: 'Sibling speech transcription evidence restores recovered native slices.',
              segments: [
                {
                  startMs: 1200,
                  endMs: 15750,
                  text: 'Sibling speech transcription evidence restores recovered native slices.',
                  speaker: 'Speaker 1',
                },
              ],
              byteSize: 4567,
            }),
            createdAt: '2026-05-05T00:00:30.000Z',
            updatedAt: '2026-05-05T00:04:30.000Z',
            stages: [],
            events: [],
            workerLeases: [],
          },
          {
            uuid: 'ops-task-speech-transcript-fallback-after-timing-clip',
            taskType: 7,
            status: 2,
            progress: 100,
            sourceAssetUuid: 'asset-slice-timing-clip-speech-fallback',
            inputJson: JSON.stringify({
              operation: 'speechTranscription',
              assetUuid: 'asset-slice-timing-clip-speech-fallback',
              language: 'auto',
            }),
            outputJson: JSON.stringify({
              assetUuid: 'asset-slice-timing-clip-speech-fallback',
              artifactUuid: 'transcript-artifact-timing-clip-speech-fallback',
              transcriptPath: 'D:/autocut/media/tasks/ops-task-speech-transcript-fallback-after-timing-clip/outputs/transcript.json',
              taskOutputDir: 'D:/autocut/media/tasks/ops-task-speech-transcript-fallback-after-timing-clip/outputs',
              language: 'auto',
              segmentCount: 1,
              text: 'Sibling speech transcript must recover when input clips only preserve timing.',
              segments: [
                {
                  startMs: 1200,
                  endMs: 15750,
                  text: 'Sibling speech transcript must recover when input clips only preserve timing.',
                  speaker: 'Speaker 1',
                },
              ],
              byteSize: 4567,
            }),
            createdAt: '2026-05-05T00:00:45.000Z',
            updatedAt: '2026-05-05T00:04:45.000Z',
            stages: [],
            events: [],
            workerLeases: [],
          },
          {
            uuid: 'ops-task-slice-speech-task-recovery',
            taskType: 6,
            status: 2,
            progress: 100,
            sourceAssetUuid: 'asset-slice-speech-task-recovery',
            inputJson: JSON.stringify({
              operation: 'videoSlice',
              assetUuid: 'asset-slice-speech-task-recovery',
              sourceName: 'speech-task-recovery.mp4',
              outputFormat: 'mp4',
            }),
            outputJson: JSON.stringify({
              assetUuid: 'asset-slice-speech-task-recovery',
              taskOutputDir: 'D:/autocut/media/tasks/ops-task-slice-speech-task-recovery/outputs',
              sliceCount: 1,
              sliceResults: [
                {
                  artifactUuid: 'slice-artifact-speech-task-recovery',
                  artifactPath: 'D:/autocut/media/tasks/ops-task-slice-speech-task-recovery/outputs/slice-001.mp4',
                  thumbnailArtifactUuid: 'slice-thumb-speech-task-recovery',
                  thumbnailArtifactPath: 'D:/autocut/media/tasks/ops-task-slice-speech-task-recovery/outputs/cover/slice-001.jpg',
                  taskOutputDir: 'D:/autocut/media/tasks/ops-task-slice-speech-task-recovery/outputs',
                  byteSize: 1234567,
                  thumbnailByteSize: 12345,
                  format: 'mp4',
                  startMs: 1000,
                  durationMs: 15000,
                  label: 'Sibling STT recovery opening',
                  sourceStartMs: 1000,
                  sourceEndMs: 16000,
                },
              ],
            }),
            createdAt: '2026-05-05T00:01:00.000Z',
            updatedAt: '2026-05-05T00:05:00.000Z',
            stages: [],
            events: [],
            workerLeases: [],
          },
          {
            uuid: 'ops-task-slice-timing-clip-speech-fallback',
            taskType: 6,
            status: 2,
            progress: 100,
            sourceAssetUuid: 'asset-slice-timing-clip-speech-fallback',
            inputJson: JSON.stringify({
              operation: 'videoSlice',
              assetUuid: 'asset-slice-timing-clip-speech-fallback',
              sourceName: 'timing-clip-speech-fallback.mp4',
              outputFormat: 'mp4',
              clips: [timingOnlyInputClip],
            }),
            outputJson: JSON.stringify({
              assetUuid: 'asset-slice-timing-clip-speech-fallback',
              taskOutputDir: 'D:/autocut/media/tasks/ops-task-slice-timing-clip-speech-fallback/outputs',
              sliceCount: 1,
              sliceResults: [
                {
                  artifactUuid: 'slice-artifact-timing-clip-speech-fallback',
                  artifactPath: 'D:/autocut/media/tasks/ops-task-slice-timing-clip-speech-fallback/outputs/slice-001.mp4',
                  thumbnailArtifactUuid: 'slice-thumb-timing-clip-speech-fallback',
                  thumbnailArtifactPath: 'D:/autocut/media/tasks/ops-task-slice-timing-clip-speech-fallback/outputs/cover/slice-001.jpg',
                  taskOutputDir: 'D:/autocut/media/tasks/ops-task-slice-timing-clip-speech-fallback/outputs',
                  byteSize: 1234567,
                  thumbnailByteSize: 12345,
                  format: 'mp4',
                  startMs: 1000,
                  durationMs: 15000,
                  label: 'Timing clip STT fallback opening',
                  sourceStartMs: 1000,
                  sourceEndMs: 16000,
                },
              ],
            }),
            createdAt: '2026-05-05T00:01:15.000Z',
            updatedAt: '2026-05-05T00:05:15.000Z',
            stages: [],
            events: [],
            workerLeases: [],
          },
          {
            uuid: 'ops-task-slice-input-clip-low-coverage-recovery',
            taskType: 6,
            status: 2,
            progress: 100,
            sourceAssetUuid: 'asset-slice-input-clip-low-coverage-recovery',
            inputJson: JSON.stringify({
              operation: 'videoSlice',
              assetUuid: 'asset-slice-input-clip-low-coverage-recovery',
              sourceName: 'input-clip-low-coverage-recovery.mp4',
              outputFormat: 'mp4',
              clips: [lowCoverageInputClip],
              requestedClips: [lowCoverageInputClip],
            }),
            outputJson: JSON.stringify({
              assetUuid: 'asset-slice-input-clip-low-coverage-recovery',
              taskOutputDir: 'D:/autocut/media/tasks/ops-task-slice-input-clip-low-coverage-recovery/outputs',
              sliceCount: 1,
              sliceResults: [
                {
                  artifactUuid: 'slice-artifact-input-clip-low-coverage-recovery',
                  artifactPath: 'D:/autocut/media/tasks/ops-task-slice-input-clip-low-coverage-recovery/outputs/slice-001.mp4',
                  thumbnailArtifactUuid: 'slice-thumb-input-clip-low-coverage-recovery',
                  thumbnailArtifactPath: 'D:/autocut/media/tasks/ops-task-slice-input-clip-low-coverage-recovery/outputs/cover/slice-001.jpg',
                  taskOutputDir: 'D:/autocut/media/tasks/ops-task-slice-input-clip-low-coverage-recovery/outputs',
                  byteSize: 1234567,
                  thumbnailByteSize: 12345,
                  format: 'mp4',
                  startMs: 1000,
                  durationMs: 15000,
                  label: 'Low coverage opening',
                },
              ],
            }),
            createdAt: '2026-05-05T00:00:00.000Z',
            updatedAt: '2026-05-05T00:05:00.000Z',
            stages: [],
            events: [],
            workerLeases: [],
          },
          {
            uuid: 'ops-task-slice-input-clip-weak-continuity-recovery',
            taskType: 6,
            status: 2,
            progress: 100,
            sourceAssetUuid: 'asset-slice-input-clip-weak-continuity-recovery',
            inputJson: JSON.stringify({
              operation: 'videoSlice',
              assetUuid: 'asset-slice-input-clip-weak-continuity-recovery',
              sourceName: 'input-clip-weak-continuity-recovery.mp4',
              outputFormat: 'mp4',
              clips: [weakContinuityInputClip],
              requestedClips: [weakContinuityInputClip],
            }),
            outputJson: JSON.stringify({
              assetUuid: 'asset-slice-input-clip-weak-continuity-recovery',
              taskOutputDir: 'D:/autocut/media/tasks/ops-task-slice-input-clip-weak-continuity-recovery/outputs',
              sliceCount: 1,
              sliceResults: [
                {
                  artifactUuid: 'slice-artifact-input-clip-weak-continuity-recovery',
                  artifactPath: 'D:/autocut/media/tasks/ops-task-slice-input-clip-weak-continuity-recovery/outputs/slice-001.mp4',
                  thumbnailArtifactUuid: 'slice-thumb-input-clip-weak-continuity-recovery',
                  thumbnailArtifactPath: 'D:/autocut/media/tasks/ops-task-slice-input-clip-weak-continuity-recovery/outputs/cover/slice-001.jpg',
                  taskOutputDir: 'D:/autocut/media/tasks/ops-task-slice-input-clip-weak-continuity-recovery/outputs',
                  byteSize: 1234567,
                  thumbnailByteSize: 12345,
                  format: 'mp4',
                  startMs: 1000,
                  durationMs: 15000,
                  label: 'Weak continuity opening',
                },
              ],
            }),
            createdAt: '2026-05-05T00:00:00.000Z',
            updatedAt: '2026-05-05T00:05:00.000Z',
            stages: [],
            events: [],
            workerLeases: [],
          },
        ];
      }

      throw new Error(`Unexpected input clip transcript recovery native host command: ${command}`);
    }, {
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    }));
    const nativeTasksRecoveredFromInputClipEvidence = await withImmediateTimers(() => services.getTasks());
    const nativeSliceTaskRecoveredFromInputClipEvidence = nativeTasksRecoveredFromInputClipEvidence.find(
      (task) => task.id === 'ops-task-slice-input-clip-transcript-recovery',
    );
    assertEqual(
      nativeSliceTaskRecoveredFromInputClipEvidence?.status,
      types.AUTOCUT_TASK_STATUS.completed,
      'native completed slice task recovers speech-to-text transcript evidence from persisted input clip requests',
    );
    assertEqual(
      nativeSliceTaskRecoveredFromInputClipEvidence?.sliceResults?.[0]?.transcriptText,
      'Input clip transcript evidence restores recovered native output.',
      'native completed slice task exposes input clip transcript text when output_json omits it',
    );
    assertEqual(
      nativeSliceTaskRecoveredFromInputClipEvidence?.sliceResults?.[0]?.transcriptSegments?.[0]?.text,
      'Input clip transcript evidence restores recovered native output.',
      'native completed slice task exposes input clip structured transcript segments when output_json omits them',
    );
    assertEqual(
      nativeSliceTaskRecoveredFromInputClipEvidence?.generatedAssetIds?.[0],
      'slice-artifact-input-clip-transcript-recovery',
      'native completed slice task keeps generated asset ids after input clip transcript evidence recovery',
    );
    const nativeSliceTaskRecoveredFromSiblingSpeechTask = nativeTasksRecoveredFromInputClipEvidence.find(
      (task) => task.id === 'ops-task-slice-speech-task-recovery',
    );
    assertEqual(
      nativeSliceTaskRecoveredFromSiblingSpeechTask?.status,
      types.AUTOCUT_TASK_STATUS.completed,
      'native completed slice task recovers speech-to-text transcript evidence from a completed sibling STT task for the same source asset',
    );
    assertEqual(
      nativeSliceTaskRecoveredFromSiblingSpeechTask?.sliceResults?.[0]?.transcriptText,
      'Sibling speech transcription evidence restores recovered native slices.',
      'native completed slice task backfills transcript text from the same-asset STT task when output_json and input_json omit slice evidence',
    );
    assertEqual(
      nativeSliceTaskRecoveredFromSiblingSpeechTask?.sliceResults?.[0]?.transcriptSegments?.[0]?.text,
      'Sibling speech transcription evidence restores recovered native slices.',
      'native completed slice task backfills structured transcript segments from the same-asset STT task',
    );
    const nativeSliceTaskRecoveredFromSiblingSpeechTaskAfterTimingOnlyInputClip = nativeTasksRecoveredFromInputClipEvidence.find(
      (task) => task.id === 'ops-task-slice-timing-clip-speech-fallback',
    );
    assertEqual(
      nativeSliceTaskRecoveredFromSiblingSpeechTaskAfterTimingOnlyInputClip?.status,
      types.AUTOCUT_TASK_STATUS.completed,
      'native completed slice task keeps searching for speech-to-text evidence when persisted input clips only contain timing metadata',
    );
    assertEqual(
      nativeSliceTaskRecoveredFromSiblingSpeechTaskAfterTimingOnlyInputClip?.sliceResults?.[0]?.transcriptText,
      'Sibling speech transcript must recover when input clips only preserve timing.',
      'native completed slice task uses sibling STT transcript text after timing-only input clip recovery evidence',
    );
    assertEqual(
      nativeSliceTaskRecoveredFromSiblingSpeechTaskAfterTimingOnlyInputClip?.sliceResults?.[0]?.transcriptSegments?.[0]?.text,
      'Sibling speech transcript must recover when input clips only preserve timing.',
      'native completed slice task uses sibling structured STT segments after timing-only input clip recovery evidence',
    );
    const nativeSliceTaskRejectedForLowCoverage = nativeTasksRecoveredFromInputClipEvidence.find(
      (task) => task.id === 'ops-task-slice-input-clip-low-coverage-recovery',
    );
    assertEqual(
      nativeSliceTaskRejectedForLowCoverage?.status,
      types.AUTOCUT_TASK_STATUS.failed,
      'native completed slice task fails closed when recovered transcript coverage is below the professional threshold',
    );
    assertIncludes(
      nativeSliceTaskRejectedForLowCoverage?.errorMessage ?? '',
      'transcriptCoverageScore to be at least 0.8',
      'native completed slice task explains recovered low transcript coverage',
    );
    assertEqual(
      nativeSliceTaskRejectedForLowCoverage?.sliceResults,
      undefined,
      'native completed slice task does not expose generated slices with low recovered transcript coverage',
    );
    const nativeSliceTaskRejectedForWeakContinuity = nativeTasksRecoveredFromInputClipEvidence.find(
      (task) => task.id === 'ops-task-slice-input-clip-weak-continuity-recovery',
    );
    assertEqual(
      nativeSliceTaskRejectedForWeakContinuity?.status,
      types.AUTOCUT_TASK_STATUS.failed,
      'native completed slice task fails closed when recovered speech continuity is weak',
    );
    assertIncludes(
      nativeSliceTaskRejectedForWeakContinuity?.errorMessage ?? '',
      'speechContinuityGrade to be strong or repaired',
      'native completed slice task explains recovered weak speech continuity',
    );
    assertEqual(
      nativeSliceTaskRejectedForWeakContinuity?.sliceResults,
      undefined,
      'native completed slice task does not expose generated slices with weak recovered speech continuity',
    );

    resetStorage();
    await services.addTask({
      id: 'local-click-slice-task-before-native-uuid',
      type: types.AUTOCUT_TASK_TYPES[0],
      name: 'click recovered local smart slice transcript sidecar',
      status: types.AUTOCUT_TASK_STATUS.completed,
      progress: 100,
      createdAt: '2026-05-05T00:00:00.000Z',
      sourceFileId: 'asset-click-slice-local-transcript-recovery',
      generatedAssetIds: ['slice-artifact-click-local-transcript-recovery'],
      sliceResults: [
        {
          id: 'slice-artifact-click-local-transcript-recovery',
          name: 'Click recovered opening.mp4',
          duration: 15,
          size: 1234567,
          resolution: '1080P',
          thumbnailUrl: '',
          url: '',
          title: 'Click recovered opening',
          summary: 'The click-created local task keeps the speech transcript sidecar for native recovery.',
          sourceStartMs: 1000,
          sourceEndMs: 16000,
          speechStartMs: 1200,
          speechEndMs: 15750,
          boundaryPaddingBeforeMs: 200,
          boundaryPaddingAfterMs: 250,
          transcriptText: 'Click slicing local transcript evidence restores recovered native output.',
          transcriptSegments: [
            {
              startMs: 1200,
              endMs: 15750,
              text: 'Click slicing local transcript evidence restores recovered native output.',
              speaker: 'Speaker 1',
            },
          ],
          transcriptSegmentCount: 1,
          transcriptCoverageScore: 0.96,
          speechContinuityGrade: 'strong',
        },
      ],
    });
    services.configureAutoCutNativeHostClient(services.createAutoCutNativeHostClient(async (command) => {
      if (command === 'autocut_host_capabilities') {
        return {
          contractVersion: 'task-list-click-local-transcript-recovery-contract',
          hostKind: 'native-host',
          databaseContractReady: true,
          sqliteMigrationReady: true,
          databaseHealthCommandReady: true,
          ffmpegProbeCommandReady: true,
          mediaImportCommandReady: true,
          mediaFileDescribeCommandReady: true,
          localVideoFileSelectCommandReady: true,
          localDirectorySelectCommandReady: true,
          localMediaPreviewDirectoryScopeCommandReady: true,
          audioExtractionCommandReady: true,
          audioExtractionFromAssetReady: true,
          videoGifCommandReady: true,
          videoSliceCommandReady: true,
          videoCompressCommandReady: true,
          videoConvertCommandReady: true,
          videoEnhanceCommandReady: true,
          speechTranscriptionCommandReady: true,
          speechTranscriptionToolchainReady: true,
          speechTranscriptionProbeCommandReady: true,
          speechTranscriptionFileSelectCommandReady: true,
          llmHttpCommandReady: true,
          llmSecretStoreReady: true,
          nativeTaskQueryCommandReady: true,
          nativeTaskCancelCommandReady: true,
          nativeTaskRecoveryCommandReady: true,
          nativeTaskRetryCommandReady: true,
          nativeTaskProgressEventsReady: true,
          nativeWorkerLeaseReady: true,
          ffmpegToolchainManifestReady: true,
          ffmpegToolchainResolverReady: true,
          ffmpegBundledReady: false,
          ffmpegExecutionReady: false,
          supportedCommands: ['autocut_list_native_tasks'],
        };
      }
      if (command === 'autocut_list_native_tasks') {
        return [
          {
            uuid: 'ops-task-click-slice-native-recovery',
            taskType: 6,
            status: 2,
            progress: 100,
            sourceAssetUuid: 'asset-click-slice-local-transcript-recovery',
            inputJson: JSON.stringify({
              operation: 'videoSlice',
              assetUuid: 'asset-click-slice-local-transcript-recovery',
              sourceName: 'click-local-transcript-recovery.mp4',
              outputFormat: 'mp4',
            }),
            outputJson: JSON.stringify({
              assetUuid: 'asset-click-slice-local-transcript-recovery',
              taskOutputDir: 'D:/autocut/media/tasks/ops-task-click-slice-native-recovery/outputs',
              sliceCount: 1,
              sliceResults: [
                {
                  artifactUuid: 'slice-artifact-click-local-transcript-recovery',
                  artifactPath: 'D:/autocut/media/tasks/ops-task-click-slice-native-recovery/outputs/slice-001.mp4',
                  thumbnailArtifactUuid: 'slice-thumb-click-local-transcript-recovery',
                  thumbnailArtifactPath: 'D:/autocut/media/tasks/ops-task-click-slice-native-recovery/outputs/cover/slice-001.jpg',
                  taskOutputDir: 'D:/autocut/media/tasks/ops-task-click-slice-native-recovery/outputs',
                  byteSize: 1234567,
                  thumbnailByteSize: 12345,
                  format: 'mp4',
                  startMs: 1000,
                  durationMs: 15000,
                  label: 'Click recovered opening',
                  sourceStartMs: 1000,
                  sourceEndMs: 16000,
                },
              ],
            }),
            createdAt: '2026-05-05T00:00:00.000Z',
            updatedAt: '2026-05-05T00:05:00.000Z',
            stages: [],
            events: [],
            workerLeases: [],
          },
        ];
      }

      throw new Error(`Unexpected click local transcript recovery native host command: ${command}`);
    }, {
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    }));
    const nativeTasksRecoveredFromClickLocalEvidence = await withImmediateTimers(() => services.getTasks());
    const nativeSliceTaskRecoveredFromClickLocalEvidence = nativeTasksRecoveredFromClickLocalEvidence.find(
      (task) => task.id === 'ops-task-click-slice-native-recovery',
    );
    assertEqual(
      nativeSliceTaskRecoveredFromClickLocalEvidence?.status,
      types.AUTOCUT_TASK_STATUS.completed,
      'native completed slice task recovers speech-to-text evidence from a local click-created task whose id differs from the native uuid',
    );
    assertEqual(
      nativeSliceTaskRecoveredFromClickLocalEvidence?.sliceResults?.[0]?.transcriptText,
      'Click slicing local transcript evidence restores recovered native output.',
      'native completed slice task exposes local click-created transcript text after native uuid recovery',
    );
    assertEqual(
      nativeSliceTaskRecoveredFromClickLocalEvidence?.sliceResults?.[0]?.transcriptSegments?.[0]?.text,
      'Click slicing local transcript evidence restores recovered native output.',
      'native completed slice task exposes local click-created structured transcript segments after native uuid recovery',
    );
    assertEqual(
      nativeSliceTaskRecoveredFromClickLocalEvidence?.generatedAssetIds?.[0],
      'slice-artifact-click-local-transcript-recovery',
      'native completed slice task keeps generated asset ids after local click-created transcript recovery',
    );

    resetStorage();
    await services.deleteTask('ops-task-hidden-speech-transcript-recovery');
    services.configureAutoCutNativeHostClient(services.createAutoCutNativeHostClient(async (command) => {
      if (command === 'autocut_host_capabilities') {
        return {
          contractVersion: 'task-list-hidden-stt-transcript-recovery-contract',
          hostKind: 'native-host',
          databaseContractReady: true,
          sqliteMigrationReady: true,
          databaseHealthCommandReady: true,
          ffmpegProbeCommandReady: true,
          mediaImportCommandReady: true,
          mediaFileDescribeCommandReady: true,
          localVideoFileSelectCommandReady: true,
          localDirectorySelectCommandReady: true,
          localMediaPreviewDirectoryScopeCommandReady: true,
          audioExtractionCommandReady: true,
          audioExtractionFromAssetReady: true,
          videoGifCommandReady: true,
          videoSliceCommandReady: true,
          videoCompressCommandReady: true,
          videoConvertCommandReady: true,
          videoEnhanceCommandReady: true,
          speechTranscriptionCommandReady: true,
          speechTranscriptionToolchainReady: true,
          speechTranscriptionProbeCommandReady: true,
          speechTranscriptionFileSelectCommandReady: true,
          llmHttpCommandReady: true,
          llmSecretStoreReady: true,
          nativeTaskQueryCommandReady: true,
          nativeTaskCancelCommandReady: true,
          nativeTaskRecoveryCommandReady: true,
          nativeTaskRetryCommandReady: true,
          nativeTaskProgressEventsReady: true,
          nativeWorkerLeaseReady: true,
          ffmpegToolchainManifestReady: true,
          ffmpegToolchainResolverReady: true,
          ffmpegBundledReady: false,
          ffmpegExecutionReady: false,
          supportedCommands: ['autocut_list_native_tasks'],
        };
      }
      if (command === 'autocut_list_native_tasks') {
        return [
          {
            uuid: 'ops-task-hidden-speech-transcript-recovery',
            taskType: 7,
            status: 2,
            progress: 100,
            sourceAssetUuid: 'asset-hidden-speech-transcript-recovery',
            inputJson: JSON.stringify({
              operation: 'speechTranscription',
              assetUuid: 'asset-hidden-speech-transcript-recovery',
              language: 'auto',
            }),
            outputJson: JSON.stringify({
              assetUuid: 'asset-hidden-speech-transcript-recovery',
              artifactUuid: 'transcript-artifact-hidden-speech-recovery',
              transcriptPath: 'D:/autocut/media/tasks/ops-task-hidden-speech-transcript-recovery/outputs/transcript.json',
              taskOutputDir: 'D:/autocut/media/tasks/ops-task-hidden-speech-transcript-recovery/outputs',
              language: 'auto',
              segmentCount: 1,
              text: 'Hidden speech transcription evidence still restores recovered smart slices.',
              segments: [
                {
                  startMs: 1200,
                  endMs: 15750,
                  text: 'Hidden speech transcription evidence still restores recovered smart slices.',
                  speaker: 'Speaker 1',
                },
              ],
              byteSize: 4567,
            }),
            createdAt: '2026-05-05T00:00:30.000Z',
            updatedAt: '2026-05-05T00:04:30.000Z',
            stages: [],
            events: [],
            workerLeases: [],
          },
          {
            uuid: 'ops-task-slice-hidden-stt-recovery',
            taskType: 6,
            status: 2,
            progress: 100,
            sourceAssetUuid: 'asset-hidden-speech-transcript-recovery',
            inputJson: JSON.stringify({
              operation: 'videoSlice',
              assetUuid: 'asset-hidden-speech-transcript-recovery',
              sourceName: 'hidden-stt-recovery.mp4',
              outputFormat: 'mp4',
            }),
            outputJson: JSON.stringify({
              assetUuid: 'asset-hidden-speech-transcript-recovery',
              taskOutputDir: 'D:/autocut/media/tasks/ops-task-slice-hidden-stt-recovery/outputs',
              sliceCount: 1,
              sliceResults: [
                {
                  artifactUuid: 'slice-artifact-hidden-stt-recovery',
                  artifactPath: 'D:/autocut/media/tasks/ops-task-slice-hidden-stt-recovery/outputs/slice-001.mp4',
                  thumbnailArtifactUuid: 'slice-thumb-hidden-stt-recovery',
                  thumbnailArtifactPath: 'D:/autocut/media/tasks/ops-task-slice-hidden-stt-recovery/outputs/cover/slice-001.jpg',
                  taskOutputDir: 'D:/autocut/media/tasks/ops-task-slice-hidden-stt-recovery/outputs',
                  byteSize: 1234567,
                  thumbnailByteSize: 12345,
                  format: 'mp4',
                  startMs: 1000,
                  durationMs: 15000,
                  label: 'Hidden STT recovery opening',
                  sourceStartMs: 1000,
                  sourceEndMs: 16000,
                },
              ],
            }),
            createdAt: '2026-05-05T00:01:00.000Z',
            updatedAt: '2026-05-05T00:05:00.000Z',
            stages: [],
            events: [],
            workerLeases: [],
          },
        ];
      }

      throw new Error(`Unexpected hidden STT transcript recovery native host command: ${command}`);
    }, {
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    }));
    const nativeTasksRecoveredFromHiddenSpeechEvidence = await withImmediateTimers(() => services.getTasks());
    const hiddenSpeechTranscriptTask = nativeTasksRecoveredFromHiddenSpeechEvidence.find(
      (task) => task.id === 'ops-task-hidden-speech-transcript-recovery',
    );
    const nativeSliceTaskRecoveredFromHiddenSpeechEvidence = nativeTasksRecoveredFromHiddenSpeechEvidence.find(
      (task) => task.id === 'ops-task-slice-hidden-stt-recovery',
    );
    assertEqual(
      hiddenSpeechTranscriptTask,
      undefined,
      'deleteTask keeps a dismissed native speech transcription task hidden from the visible task list',
    );
    assertEqual(
      nativeSliceTaskRecoveredFromHiddenSpeechEvidence?.status,
      types.AUTOCUT_TASK_STATUS.completed,
      'native completed slice task still recovers speech-to-text evidence from a dismissed same-asset STT task',
    );
    assertEqual(
      nativeSliceTaskRecoveredFromHiddenSpeechEvidence?.sliceResults?.[0]?.transcriptText,
      'Hidden speech transcription evidence still restores recovered smart slices.',
      'native completed slice task backfills transcript text from hidden same-asset STT evidence',
    );
    assertEqual(
      nativeSliceTaskRecoveredFromHiddenSpeechEvidence?.sliceResults?.[0]?.transcriptSegments?.[0]?.text,
      'Hidden speech transcription evidence still restores recovered smart slices.',
      'native completed slice task backfills structured transcript segments from hidden same-asset STT evidence',
    );

    resetStorage();
    services.configureAutoCutNativeHostClient(services.createAutoCutNativeHostClient(async (command) => {
      if (command === 'autocut_host_capabilities') {
        return {
          contractVersion: 'task-list-missing-transcript-evidence-contract',
          hostKind: 'native-host',
          databaseContractReady: true,
          sqliteMigrationReady: true,
          databaseHealthCommandReady: true,
          ffmpegProbeCommandReady: true,
          mediaImportCommandReady: true,
          mediaFileDescribeCommandReady: true,
          localVideoFileSelectCommandReady: true,
          localDirectorySelectCommandReady: true,
          localMediaPreviewDirectoryScopeCommandReady: true,
          audioExtractionCommandReady: true,
          audioExtractionFromAssetReady: true,
          videoGifCommandReady: true,
          videoSliceCommandReady: true,
          videoCompressCommandReady: true,
          videoConvertCommandReady: true,
          videoEnhanceCommandReady: true,
          speechTranscriptionCommandReady: true,
          speechTranscriptionToolchainReady: true,
          speechTranscriptionProbeCommandReady: true,
          speechTranscriptionFileSelectCommandReady: true,
          llmHttpCommandReady: true,
          llmSecretStoreReady: true,
          nativeTaskQueryCommandReady: true,
          nativeTaskCancelCommandReady: true,
          nativeTaskRecoveryCommandReady: true,
          nativeTaskRetryCommandReady: true,
          nativeTaskProgressEventsReady: true,
          nativeWorkerLeaseReady: true,
          ffmpegToolchainManifestReady: true,
          ffmpegToolchainResolverReady: true,
          ffmpegBundledReady: false,
          ffmpegExecutionReady: false,
          supportedCommands: ['autocut_list_native_tasks'],
        };
      }
      if (command === 'autocut_list_native_tasks') {
        return [
          {
            uuid: 'ops-task-slice-missing-transcript-evidence',
            taskType: 6,
            status: 2,
            progress: 100,
            sourceAssetUuid: 'asset-slice-missing-transcript-evidence',
            inputJson: JSON.stringify({
              operation: 'videoSlice',
              assetUuid: 'asset-slice-missing-transcript-evidence',
              outputFormat: 'mp4',
            }),
            outputJson: JSON.stringify({
              assetUuid: 'asset-slice-missing-transcript-evidence',
              taskOutputDir: 'D:/autocut/media/tasks/ops-task-slice-missing-transcript-evidence/outputs',
              sliceCount: 1,
              sliceResults: [
                {
                  artifactUuid: 'slice-artifact-missing-transcript-evidence',
                  artifactPath: 'D:/autocut/media/tasks/ops-task-slice-missing-transcript-evidence/outputs/slice-001.mp4',
                  thumbnailArtifactUuid: 'slice-thumb-missing-transcript-evidence',
                  thumbnailArtifactPath: 'D:/autocut/media/tasks/ops-task-slice-missing-transcript-evidence/outputs/cover/slice-001.jpg',
                  taskOutputDir: 'D:/autocut/media/tasks/ops-task-slice-missing-transcript-evidence/outputs',
                  byteSize: 1234567,
                  thumbnailByteSize: 12345,
                  format: 'mp4',
                  startMs: 1000,
                  durationMs: 15000,
                  label: 'Opening without transcript evidence',
                },
              ],
            }),
            createdAt: '2026-05-05T00:00:00.000Z',
            updatedAt: '2026-05-05T00:05:00.000Z',
            stages: [],
            events: [],
            workerLeases: [],
          },
        ];
      }

      throw new Error(`Unexpected missing transcript evidence native host command: ${command}`);
    }, {
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    }));
    const nativeTasksMissingTranscriptEvidence = await withImmediateTimers(() => services.getTasks());
    const missingTranscriptEvidenceTask = nativeTasksMissingTranscriptEvidence.find(
      (task) => task.id === 'ops-task-slice-missing-transcript-evidence',
    );
    assertEqual(
      missingTranscriptEvidenceTask?.status,
      types.AUTOCUT_TASK_STATUS.failed,
      'native completed slice task fails closed when recovered speech-to-text transcript evidence is missing',
    );
    assertIncludes(
      missingTranscriptEvidenceTask?.errorMessage ?? '',
      'missing speech-to-text transcript evidence',
      'native completed slice task explains missing recovered speech-to-text transcript evidence',
    );
    assertRule(
      !(missingTranscriptEvidenceTask?.errorMessage ?? '').includes('AutoCut recovered native video slicing'),
      'native completed legacy slice task does not expose internal recovered smart-slice assertion text to users',
    );
    assertIncludes(
      missingTranscriptEvidenceTask?.errorMessage ?? '',
      'Re-run Smart Slice after local speech-to-text setup',
      'native completed legacy slice task gives an actionable local STT regeneration path instead of a raw assertion',
    );
    assertIncludes(
      missingTranscriptEvidenceTask?.failureDiagnostics ?? '',
      'AutoCut recovered native video slicing slice artifact 1 is missing speech-to-text transcript evidence.',
      'native completed slice task exposes the original recovered transcript evidence assertion for debugging',
    );
    assertIncludes(
      missingTranscriptEvidenceTask?.failureDiagnostics ?? '',
      'Stack:',
      'native completed slice task exposes the recovered transcript evidence validation stack trace for debugging',
    );
    assertIncludes(
      missingTranscriptEvidenceTask?.failureDiagnostics ?? '',
      'at assertRecoveredNativeVideoSliceProfessionalTranscriptEvidence',
      'native completed slice task stack names the professional transcript evidence validator',
    );
    assertIncludes(
      missingTranscriptEvidenceTask?.failureDiagnostics ?? '',
      'Native task snapshot: uuid=ops-task-slice-missing-transcript-evidence taskType=6 status=2 sourceAssetUuid=asset-slice-missing-transcript-evidence',
      'native completed slice task diagnostics identify the exact native snapshot that failed recovery',
    );
    assertIncludes(
      missingTranscriptEvidenceTask?.failureDiagnostics ?? '',
      'Input clip evidence: clips=0 requestedClips=0 clipsWithTranscriptSegments=0 requestedClipsWithTranscriptSegments=0',
      'native completed slice task diagnostics summarize missing request-side transcript evidence',
    );
    assertIncludes(
      missingTranscriptEvidenceTask?.failureDiagnostics ?? '',
      'Output slice evidence: sliceResults=1 slicesWithTranscriptSegments=0 slicesWithTranscriptText=0',
      'native completed slice task diagnostics summarize missing output-side transcript evidence',
    );
    assertEqual(
      missingTranscriptEvidenceTask?.sliceResults,
      undefined,
      'native completed slice task does not expose generated slices without recovered transcript evidence',
    );
    assertEqual(
      missingTranscriptEvidenceTask?.generatedAssetIds,
      undefined,
      'native completed slice task does not expose generated asset ids without recovered transcript evidence',
    );
    await services.deleteTask('ops-task-slice-missing-transcript-evidence');
    const nativeTasksAfterDeletingMissingTranscriptEvidence = await withImmediateTimers(() => services.getTasks());
    assertRule(
      nativeTasksAfterDeletingMissingTranscriptEvidence.every(
        (task) => task.id !== 'ops-task-slice-missing-transcript-evidence',
      ),
      'deleteTask tombstones recovered native tasks so invalid legacy smart-slice failures do not reappear after deletion',
    );

    resetStorage();
    services.configureAutoCutNativeHostClient(services.createAutoCutNativeHostClient(async (command) => {
      if (command === 'autocut_host_capabilities') {
        return {
          contractVersion: 'task-list-asset-url-failure-contract',
          hostKind: 'native-host',
          databaseContractReady: true,
          sqliteMigrationReady: true,
          databaseHealthCommandReady: true,
          ffmpegProbeCommandReady: true,
          mediaImportCommandReady: true,
          mediaFileDescribeCommandReady: true,
          localVideoFileSelectCommandReady: true,
          localDirectorySelectCommandReady: true,
          localMediaPreviewDirectoryScopeCommandReady: true,
          audioExtractionCommandReady: true,
          audioExtractionFromAssetReady: true,
          videoGifCommandReady: true,
          videoSliceCommandReady: true,
          videoCompressCommandReady: true,
          videoConvertCommandReady: true,
          videoEnhanceCommandReady: true,
          speechTranscriptionCommandReady: true,
          speechTranscriptionToolchainReady: true,
          speechTranscriptionProbeCommandReady: true,
          speechTranscriptionFileSelectCommandReady: true,
          llmHttpCommandReady: true,
          llmSecretStoreReady: true,
          nativeTaskQueryCommandReady: true,
          nativeTaskCancelCommandReady: true,
          nativeTaskRecoveryCommandReady: true,
          nativeTaskRetryCommandReady: true,
          nativeTaskProgressEventsReady: true,
          nativeWorkerLeaseReady: true,
          ffmpegToolchainManifestReady: true,
          ffmpegToolchainResolverReady: true,
          ffmpegBundledReady: false,
          ffmpegExecutionReady: false,
          supportedCommands: ['autocut_list_native_tasks'],
        };
      }
      if (command === 'autocut_list_native_tasks') {
        return [
          {
            uuid: 'ops-task-slice-asset-url-failure',
            taskType: 6,
            status: 2,
            progress: 100,
            sourceAssetUuid: 'asset-slice-asset-url-failure',
            inputJson: JSON.stringify({
              operation: 'videoSlice',
              assetUuid: 'asset-slice-asset-url-failure',
              outputFormat: 'mp4',
            }),
            outputJson: JSON.stringify({
              assetUuid: 'asset-slice-asset-url-failure',
              taskOutputDir: 'D:/autocut/media/tasks/ops-task-slice-asset-url-failure/outputs',
              sliceCount: 1,
              sliceResults: [
                {
                  artifactUuid: 'slice-artifact-asset-url-failure',
                  artifactPath: 'D:/autocut/media/tasks/ops-task-slice-asset-url-failure/outputs/slice-001.mp4',
                  thumbnailArtifactUuid: 'slice-thumb-asset-url-failure',
                  thumbnailArtifactPath: 'D:/autocut/media/tasks/ops-task-slice-asset-url-failure/outputs/cover/slice-001.jpg',
                  taskOutputDir: 'D:/autocut/media/tasks/ops-task-slice-asset-url-failure/outputs',
                  byteSize: 1234567,
                  thumbnailByteSize: 12345,
                  format: 'mp4',
                  startMs: 1000,
                  durationMs: 15000,
                  label: 'Opening',
                },
              ],
            }),
            createdAt: '2026-05-05T00:00:00.000Z',
            updatedAt: '2026-05-05T00:05:00.000Z',
            stages: [],
            events: [],
            workerLeases: [],
          },
          {
            uuid: 'ops-task-compress-asset-url-failure',
            taskType: 3,
            status: 2,
            progress: 100,
            sourceAssetUuid: 'asset-compress-asset-url-failure',
            inputJson: JSON.stringify({
              operation: 'videoCompress',
              assetUuid: 'asset-compress-asset-url-failure',
              compressionMode: 'balanced',
            }),
            outputJson: JSON.stringify({
              assetUuid: 'asset-compress-asset-url-failure',
              artifactUuid: 'compress-artifact-asset-url-failure',
              artifactPath: 'D:/autocut/media/tasks/ops-task-compress-asset-url-failure/outputs/compressed.mp4',
              taskOutputDir: 'D:/autocut/media/tasks/ops-task-compress-asset-url-failure/outputs',
              format: 'mp4',
              byteSize: 2500,
              originalByteSize: 10000,
            }),
            createdAt: '2026-05-05T00:01:00.000Z',
            updatedAt: '2026-05-05T00:06:00.000Z',
            stages: [],
            events: [],
            workerLeases: [],
          },
        ];
      }

      throw new Error(`Unexpected task list asset URL failure command: ${command}`);
    }, {
      createAssetUrl: (artifactPath) => {
        throw new Error(`asset scope denied for ${artifactPath}`);
      },
    }));
    const nativeTasksWithAssetUrlFailure = await withImmediateTimers(() => services.getTasks());
    const failedAssetUrlSliceTask = nativeTasksWithAssetUrlFailure.find(
      (task) => task.id === 'ops-task-slice-asset-url-failure',
    );
    const failedAssetUrlCompressTask = nativeTasksWithAssetUrlFailure.find(
      (task) => task.id === 'ops-task-compress-asset-url-failure',
    );
    assertEqual(
      failedAssetUrlSliceTask?.status,
      types.AUTOCUT_TASK_STATUS.failed,
      'native completed slice task fails closed when asset URL conversion fails',
    );
    assertIncludes(
      failedAssetUrlSliceTask?.errorMessage ?? '',
      'asset URL conversion failed',
      'native completed slice task explains asset URL conversion failures instead of exposing local paths',
    );
    assertEqual(
      failedAssetUrlSliceTask?.sliceResults,
      undefined,
      'native completed slice task does not expose slice results when asset URL conversion fails',
    );
    assertEqual(
      failedAssetUrlCompressTask?.videoUrl,
      undefined,
      'native completed non-slice task does not expose raw artifactPath when asset URL conversion fails',
    );

    resetStorage();
    services.configureAutoCutNativeHostClient(services.createAutoCutNativeHostClient(async (command) => {
      if (command === 'autocut_host_capabilities') {
        return {
          contractVersion: 'task-list-path-containment-contract',
          hostKind: 'native-host',
          databaseContractReady: true,
          sqliteMigrationReady: true,
          databaseHealthCommandReady: true,
          ffmpegProbeCommandReady: true,
          mediaImportCommandReady: true,
          mediaFileDescribeCommandReady: true,
          localVideoFileSelectCommandReady: true,
          localDirectorySelectCommandReady: true,
          localMediaPreviewDirectoryScopeCommandReady: true,
          audioExtractionCommandReady: true,
          audioExtractionFromAssetReady: true,
          videoGifCommandReady: true,
          videoSliceCommandReady: true,
          videoCompressCommandReady: true,
          videoConvertCommandReady: true,
          videoEnhanceCommandReady: true,
          speechTranscriptionCommandReady: true,
          speechTranscriptionToolchainReady: true,
          speechTranscriptionProbeCommandReady: true,
          speechTranscriptionFileSelectCommandReady: true,
          llmHttpCommandReady: true,
          llmSecretStoreReady: true,
          nativeTaskQueryCommandReady: true,
          nativeTaskCancelCommandReady: true,
          nativeTaskRecoveryCommandReady: true,
          nativeTaskRetryCommandReady: true,
          nativeTaskProgressEventsReady: true,
          nativeWorkerLeaseReady: true,
          ffmpegToolchainManifestReady: true,
          ffmpegToolchainResolverReady: true,
          ffmpegBundledReady: false,
          ffmpegExecutionReady: false,
          supportedCommands: ['autocut_list_native_tasks'],
        };
      }
      if (command === 'autocut_list_native_tasks') {
        return [
          {
            uuid: 'ops-task-slice-outside-output-dir',
            taskType: 6,
            status: 2,
            progress: 100,
            sourceAssetUuid: 'asset-slice-outside-output-dir',
            inputJson: JSON.stringify({
              operation: 'videoSlice',
              assetUuid: 'asset-slice-outside-output-dir',
              outputFormat: 'mp4',
            }),
            outputJson: JSON.stringify({
              assetUuid: 'asset-slice-outside-output-dir',
              taskOutputDir: 'D:/autocut/media/tasks/ops-task-slice-outside-output-dir/outputs',
              sliceCount: 1,
              sliceResults: [
                {
                  artifactUuid: 'slice-artifact-outside-output-dir',
                  artifactPath: 'D:/autocut/media/tasks/ops-task-slice-outside-output-dir/outputs/slice-001.mp4',
                  thumbnailArtifactUuid: 'slice-thumb-outside-output-dir',
                  thumbnailArtifactPath: 'D:/autocut/media/tasks/ops-task-slice-outside-output-dir/slice-001.jpg',
                  taskOutputDir: 'D:/autocut/media/tasks/ops-task-slice-outside-output-dir/outputs',
                  byteSize: 1234567,
                  thumbnailByteSize: 12345,
                  format: 'mp4',
                  startMs: 1000,
                  durationMs: 15000,
                  label: 'Opening',
                },
              ],
            }),
            createdAt: '2026-05-05T00:00:00.000Z',
            updatedAt: '2026-05-05T00:05:00.000Z',
            stages: [],
            events: [],
            workerLeases: [],
          },
        ];
      }

      throw new Error(`Unexpected task list path containment command: ${command}`);
    }, {
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    }));
    const nativeTasksWithOutsideOutputPath = await withImmediateTimers(() => services.getTasks());
    const outsideOutputSliceTask = nativeTasksWithOutsideOutputPath.find(
      (task) => task.id === 'ops-task-slice-outside-output-dir',
    );
    assertEqual(
      outsideOutputSliceTask?.status,
      types.AUTOCUT_TASK_STATUS.failed,
      'native completed slice task fails closed when an artifact escapes its task output directory',
    );
    assertIncludes(
      outsideOutputSliceTask?.errorMessage ?? '',
      'is outside its task output directory',
      'native completed slice task explains task output directory containment failures',
    );
    assertEqual(
      outsideOutputSliceTask?.sliceResults,
      undefined,
      'native completed slice task does not expose escaped artifact URLs',
    );

    resetStorage();
    services.configureAutoCutNativeHostClient(services.createAutoCutNativeHostClient(async (command) => {
      if (command === 'autocut_host_capabilities') {
        return {
          contractVersion: 'task-list-cover-directory-contract',
          hostKind: 'native-host',
          databaseContractReady: true,
          sqliteMigrationReady: true,
          databaseHealthCommandReady: true,
          ffmpegProbeCommandReady: true,
          mediaImportCommandReady: true,
          mediaFileDescribeCommandReady: true,
          localVideoFileSelectCommandReady: true,
          localDirectorySelectCommandReady: true,
          localMediaPreviewDirectoryScopeCommandReady: true,
          audioExtractionCommandReady: true,
          audioExtractionFromAssetReady: true,
          videoGifCommandReady: true,
          videoSliceCommandReady: true,
          videoCompressCommandReady: true,
          videoConvertCommandReady: true,
          videoEnhanceCommandReady: true,
          speechTranscriptionCommandReady: true,
          speechTranscriptionToolchainReady: true,
          speechTranscriptionProbeCommandReady: true,
          speechTranscriptionFileSelectCommandReady: true,
          llmHttpCommandReady: true,
          llmSecretStoreReady: true,
          nativeTaskQueryCommandReady: true,
          nativeTaskCancelCommandReady: true,
          nativeTaskRecoveryCommandReady: true,
          nativeTaskRetryCommandReady: true,
          nativeTaskProgressEventsReady: true,
          nativeWorkerLeaseReady: true,
          ffmpegToolchainManifestReady: true,
          ffmpegToolchainResolverReady: true,
          ffmpegBundledReady: false,
          ffmpegExecutionReady: false,
          supportedCommands: ['autocut_list_native_tasks'],
        };
      }
      if (command === 'autocut_list_native_tasks') {
        return [
          {
            uuid: 'ops-task-slice-thumbnail-outside-cover-dir',
            taskType: 6,
            status: 2,
            progress: 100,
            sourceAssetUuid: 'asset-slice-thumbnail-outside-cover-dir',
            inputJson: JSON.stringify({
              operation: 'videoSlice',
              assetUuid: 'asset-slice-thumbnail-outside-cover-dir',
              outputFormat: 'mp4',
            }),
            outputJson: JSON.stringify({
              assetUuid: 'asset-slice-thumbnail-outside-cover-dir',
              taskOutputDir: 'D:/autocut/media/tasks/ops-task-slice-thumbnail-outside-cover-dir/outputs',
              sliceCount: 1,
              sliceResults: [
                {
                  artifactUuid: 'slice-artifact-thumbnail-outside-cover-dir',
                  artifactPath: 'D:/autocut/media/tasks/ops-task-slice-thumbnail-outside-cover-dir/outputs/slice-001.mp4',
                  thumbnailArtifactUuid: 'slice-thumb-thumbnail-outside-cover-dir',
                  thumbnailArtifactPath: 'D:/autocut/media/tasks/ops-task-slice-thumbnail-outside-cover-dir/outputs/slice-001.jpg',
                  taskOutputDir: 'D:/autocut/media/tasks/ops-task-slice-thumbnail-outside-cover-dir/outputs',
                  byteSize: 1234567,
                  thumbnailByteSize: 12345,
                  format: 'mp4',
                  startMs: 1000,
                  durationMs: 15000,
                  label: 'Cover directory enforcement opening',
                  sourceStartMs: 1000,
                  sourceEndMs: 16000,
                  speechStartMs: 1200,
                  speechEndMs: 15750,
                  boundaryPaddingBeforeMs: 200,
                  boundaryPaddingAfterMs: 250,
                  transcriptText: 'Cover thumbnails must live under the dedicated cover directory.',
                  transcriptSegments: [
                    {
                      startMs: 1200,
                      endMs: 15750,
                      text: 'Cover thumbnails must live under the dedicated cover directory.',
                      speaker: 'Speaker 1',
                    },
                  ],
                  transcriptSegmentCount: 1,
                  transcriptCoverageScore: 0.96,
                  speechContinuityGrade: 'strong',
                },
              ],
            }),
            createdAt: '2026-05-05T00:00:00.000Z',
            updatedAt: '2026-05-05T00:05:00.000Z',
            stages: [],
            events: [],
            workerLeases: [],
          },
        ];
      }

      throw new Error(`Unexpected task list cover directory command: ${command}`);
    }, {
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    }));
    const nativeTasksWithThumbnailOutsideCoverPath = await withImmediateTimers(() => services.getTasks());
    const thumbnailOutsideCoverSliceTask = nativeTasksWithThumbnailOutsideCoverPath.find(
      (task) => task.id === 'ops-task-slice-thumbnail-outside-cover-dir',
    );
    assertEqual(
      thumbnailOutsideCoverSliceTask?.status,
      types.AUTOCUT_TASK_STATUS.failed,
      'native completed slice task fails closed when a thumbnail stays in the task output root instead of cover',
    );
    assertIncludes(
      thumbnailOutsideCoverSliceTask?.errorMessage ?? '',
      'is outside its task cover directory',
      'native completed slice task explains dedicated cover directory containment failures',
    );
    assertEqual(
      thumbnailOutsideCoverSliceTask?.sliceResults,
      undefined,
      'native completed slice task does not expose thumbnails that bypass the cover directory',
    );

    resetStorage();
    services.configureAutoCutNativeHostClient(services.createAutoCutNativeHostClient(async (command) => {
      if (command === 'autocut_host_capabilities') {
        return {
          contractVersion: 'task-list-non-slice-path-containment-contract',
          hostKind: 'native-host',
          databaseContractReady: true,
          sqliteMigrationReady: true,
          databaseHealthCommandReady: true,
          ffmpegProbeCommandReady: true,
          mediaImportCommandReady: true,
          mediaFileDescribeCommandReady: true,
          localVideoFileSelectCommandReady: true,
          localDirectorySelectCommandReady: true,
          localMediaPreviewDirectoryScopeCommandReady: true,
          audioExtractionCommandReady: true,
          audioExtractionFromAssetReady: true,
          videoGifCommandReady: true,
          videoSliceCommandReady: true,
          videoCompressCommandReady: true,
          videoConvertCommandReady: true,
          videoEnhanceCommandReady: true,
          speechTranscriptionCommandReady: true,
          speechTranscriptionToolchainReady: true,
          speechTranscriptionProbeCommandReady: true,
          speechTranscriptionFileSelectCommandReady: true,
          llmHttpCommandReady: true,
          llmSecretStoreReady: true,
          nativeTaskQueryCommandReady: true,
          nativeTaskCancelCommandReady: true,
          nativeTaskRecoveryCommandReady: true,
          nativeTaskRetryCommandReady: true,
          nativeTaskProgressEventsReady: true,
          nativeWorkerLeaseReady: true,
          ffmpegToolchainManifestReady: true,
          ffmpegToolchainResolverReady: true,
          ffmpegBundledReady: false,
          ffmpegExecutionReady: false,
          supportedCommands: ['autocut_list_native_tasks'],
        };
      }
      if (command === 'autocut_list_native_tasks') {
        return [
          {
            uuid: 'ops-task-compress-outside-output-dir',
            taskType: 3,
            status: 2,
            progress: 100,
            sourceAssetUuid: 'asset-compress-outside-output-dir',
            inputJson: JSON.stringify({
              operation: 'videoCompress',
              assetUuid: 'asset-compress-outside-output-dir',
              compressionMode: 'balanced',
            }),
            outputJson: JSON.stringify({
              assetUuid: 'asset-compress-outside-output-dir',
              artifactUuid: 'compress-artifact-outside-output-dir',
              artifactPath: 'D:/autocut/media/tasks/ops-task-compress-outside-output-dir/compressed.mp4',
              taskOutputDir: 'D:/autocut/media/tasks/ops-task-compress-outside-output-dir/outputs',
              format: 'mp4',
              byteSize: 2500,
              originalByteSize: 10000,
            }),
            createdAt: '2026-05-05T00:00:00.000Z',
            updatedAt: '2026-05-05T00:05:00.000Z',
            stages: [],
            events: [],
            workerLeases: [],
          },
        ];
      }

      throw new Error(`Unexpected task list non-slice path containment command: ${command}`);
    }, {
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    }));
    const nativeTasksWithOutsideNonSliceOutputPath = await withImmediateTimers(() => services.getTasks());
    const outsideOutputCompressTask = nativeTasksWithOutsideNonSliceOutputPath.find(
      (task) => task.id === 'ops-task-compress-outside-output-dir',
    );
    assertEqual(
      outsideOutputCompressTask?.videoUrl,
      undefined,
      'native completed non-slice task does not expose artifact URLs that escape the task output directory',
    );
    assertEqual(
      outsideOutputCompressTask?.generatedAssetIds,
      undefined,
      'native completed non-slice task does not expose generated assets for escaped artifact paths',
    );

    resetStorage();
    services.configureAutoCutNativeHostClient(services.createAutoCutNativeHostClient(async (command) => {
      if (command === 'autocut_host_capabilities') {
        return {
          contractVersion: 'task-list-dot-segment-path-containment-contract',
          hostKind: 'native-host',
          databaseContractReady: true,
          sqliteMigrationReady: true,
          databaseHealthCommandReady: true,
          ffmpegProbeCommandReady: true,
          mediaImportCommandReady: true,
          mediaFileDescribeCommandReady: true,
          localVideoFileSelectCommandReady: true,
          localDirectorySelectCommandReady: true,
          localMediaPreviewDirectoryScopeCommandReady: true,
          audioExtractionCommandReady: true,
          audioExtractionFromAssetReady: true,
          videoGifCommandReady: true,
          videoSliceCommandReady: true,
          videoCompressCommandReady: true,
          videoConvertCommandReady: true,
          videoEnhanceCommandReady: true,
          speechTranscriptionCommandReady: true,
          speechTranscriptionToolchainReady: true,
          speechTranscriptionProbeCommandReady: true,
          speechTranscriptionFileSelectCommandReady: true,
          llmHttpCommandReady: true,
          llmSecretStoreReady: true,
          nativeTaskQueryCommandReady: true,
          nativeTaskCancelCommandReady: true,
          nativeTaskRecoveryCommandReady: true,
          nativeTaskRetryCommandReady: true,
          nativeTaskProgressEventsReady: true,
          nativeWorkerLeaseReady: true,
          ffmpegToolchainManifestReady: true,
          ffmpegToolchainResolverReady: true,
          ffmpegBundledReady: false,
          ffmpegExecutionReady: false,
          supportedCommands: ['autocut_list_native_tasks'],
        };
      }
      if (command === 'autocut_list_native_tasks') {
        return [
          {
            uuid: 'ops-task-compress-dot-segment-escape',
            taskType: 3,
            status: 2,
            progress: 100,
            sourceAssetUuid: 'asset-compress-dot-segment-escape',
            inputJson: JSON.stringify({
              operation: 'videoCompress',
              assetUuid: 'asset-compress-dot-segment-escape',
              compressionMode: 'balanced',
            }),
            outputJson: JSON.stringify({
              assetUuid: 'asset-compress-dot-segment-escape',
              artifactUuid: 'compress-artifact-dot-segment-escape',
              artifactPath: 'D:/autocut/media/tasks/ops-task-compress-dot-segment-escape/outputs/../compressed.mp4',
              taskOutputDir: 'D:/autocut/media/tasks/ops-task-compress-dot-segment-escape/outputs',
              format: 'mp4',
              byteSize: 2500,
              originalByteSize: 10000,
            }),
            createdAt: '2026-05-05T00:00:00.000Z',
            updatedAt: '2026-05-05T00:05:00.000Z',
            stages: [],
            events: [],
            workerLeases: [],
          },
        ];
      }

      throw new Error(`Unexpected task list dot-segment containment command: ${command}`);
    }, {
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    }));
    const nativeTasksWithDotSegmentEscapedOutputPath = await withImmediateTimers(() => services.getTasks());
    const dotSegmentEscapedOutputTask = nativeTasksWithDotSegmentEscapedOutputPath.find(
      (task) => task.id === 'ops-task-compress-dot-segment-escape',
    );
    assertEqual(
      dotSegmentEscapedOutputTask?.videoUrl,
      undefined,
      'native completed non-slice task does not expose artifact URLs that escape via dot segments',
    );
    assertEqual(
      dotSegmentEscapedOutputTask?.generatedAssetIds,
      undefined,
      'native completed non-slice task does not expose generated assets for dot-segment escaped artifact paths',
    );
    services.configureAutoCutNativeHostClient(services.createAutoCutNativeHostClient(async (command, args) => {
      nativeTaskListCommands.push({ command, args });
      if (command === 'autocut_host_capabilities') {
        return {
          contractVersion: 'task-list-contract',
          hostKind: 'native-host',
          databaseContractReady: true,
          sqliteMigrationReady: true,
          databaseHealthCommandReady: true,
          ffmpegProbeCommandReady: true,
          mediaImportCommandReady: true,
          mediaFileDescribeCommandReady: true,
          localVideoFileSelectCommandReady: true,
          localDirectorySelectCommandReady: true,
          audioExtractionCommandReady: true,
          audioExtractionFromAssetReady: true,
          videoGifCommandReady: true,
          videoSliceCommandReady: true,
          videoCompressCommandReady: true,
          videoConvertCommandReady: true,
          videoEnhanceCommandReady: true,
          speechTranscriptionCommandReady: true,
          speechTranscriptionToolchainReady: true,
          speechTranscriptionProbeCommandReady: true,
          speechTranscriptionFileSelectCommandReady: true,
          llmHttpCommandReady: true,
          llmSecretStoreReady: true,
          nativeTaskQueryCommandReady: true,
          nativeTaskCancelCommandReady: true,
          nativeTaskRecoveryCommandReady: true,
          nativeTaskRetryCommandReady: true,
          nativeTaskProgressEventsReady: true,
          nativeWorkerLeaseReady: true,
          ffmpegToolchainManifestReady: true,
          ffmpegToolchainResolverReady: true,
          ffmpegBundledReady: false,
          ffmpegExecutionReady: false,
          supportedCommands: ['autocut_list_native_tasks'],
        };
      }
      if (command === 'autocut_list_native_tasks') {
        return [
          {
            uuid: 'ops-task-slice-contract',
            taskType: 6,
            status: 2,
            progress: 100,
            sourceAssetUuid: 'asset-slice-contract',
            inputJson: JSON.stringify({
              operation: 'videoSlice',
              assetUuid: 'asset-slice-contract',
              outputFormat: 'mp4',
            }),
            outputJson: JSON.stringify({
              assetUuid: 'asset-slice-contract',
              taskOutputDir: 'D:/autocut/media/tasks/ops-task-slice-contract/outputs',
              sliceCount: 1,
              sliceResults: [
                {
                  artifactUuid: 'slice-artifact-contract',
                  artifactPath: 'D:/autocut/media/tasks/ops-task-slice-contract/outputs/slice-001.mp4',
                  thumbnailArtifactUuid: 'slice-thumb-contract',
                  thumbnailArtifactPath: 'D:/autocut/media/tasks/ops-task-slice-contract/outputs/cover/slice-001.jpg',
                  subtitleArtifactUuid: 'slice-subtitle-contract',
                  subtitleArtifactPath: 'D:/autocut/media/tasks/ops-task-slice-contract/outputs/slice-001.srt',
                  taskOutputDir: 'D:/autocut/media/tasks/ops-task-slice-contract/outputs',
                  byteSize: 1234567,
                  thumbnailByteSize: 12345,
                  subtitleByteSize: 234,
                  subtitleFormat: 'srt',
                  format: 'mp4',
                  startMs: 1000,
                  durationMs: 15000,
                  label: 'Opening',
                },
              ],
            }),
            createdAt: '2026-05-05T00:00:00.000Z',
            updatedAt: '2026-05-05T00:05:00.000Z',
            stages: [],
            events: [
              {
                uuid: 'ops-event-slice-progress-contract',
                eventType: 8,
                payload: {
                  operation: 'videoSlice',
                  phase: 'ffmpeg-progress-streamed',
                  source: 'ffmpeg-progress',
                  progress: 88,
                },
                payloadJson: '{"operation":"videoSlice","phase":"ffmpeg-progress-streamed","source":"ffmpeg-progress","progress":88}',
                createdAt: '2026-05-05T00:04:00.000Z',
                updatedAt: '2026-05-05T00:04:00.000Z',
              },
            ],
            workerLeases: [],
          },
          {
            uuid: 'ops-task-transcript-contract',
            taskType: 7,
            status: 2,
            progress: 100,
            sourceAssetUuid: 'asset-transcript-contract',
            inputJson: JSON.stringify({
              operation: 'speechTranscription',
              assetUuid: 'asset-transcript-contract',
              language: 'zh',
            }),
            outputJson: JSON.stringify({
              assetUuid: 'asset-transcript-contract',
              artifactUuid: 'transcript-artifact-contract',
              transcriptPath: 'D:/autocut/media/tasks/ops-task-transcript-contract/outputs/transcript.json',
              taskOutputDir: 'D:/autocut/media/tasks/ops-task-transcript-contract/outputs',
              language: 'zh',
              segmentCount: 2,
              segments: [
                { startMs: 0, endMs: 1400, text: 'hello', speaker: 'Speaker 1' },
                { startMs: 1500, endMs: 3200, text: 'world', speaker: 'Speaker 2' },
              ],
              text: 'hello world',
              byteSize: 4567,
            }),
            createdAt: '2026-05-05T00:01:00.000Z',
            updatedAt: '2026-05-05T00:06:00.000Z',
            stages: [],
            events: [],
            workerLeases: [],
          },
          {
            uuid: 'ops-task-compress-contract',
            taskType: 3,
            status: 2,
            progress: 100,
            sourceAssetUuid: 'asset-compress-contract',
            inputJson: JSON.stringify({
              operation: 'videoCompress',
              assetUuid: 'asset-compress-contract',
              compressionMode: 'balanced',
            }),
            outputJson: JSON.stringify({
              assetUuid: 'asset-compress-contract',
              artifactUuid: 'compress-artifact-contract',
              artifactPath: 'D:/autocut/media/tasks/ops-task-compress-contract/outputs/compressed.mp4',
              taskOutputDir: 'D:/autocut/media/tasks/ops-task-compress-contract/outputs',
              format: 'mp4',
              byteSize: 2500,
              originalByteSize: 10000,
            }),
            createdAt: '2026-05-05T00:02:00.000Z',
            updatedAt: '2026-05-05T00:07:00.000Z',
            stages: [],
            events: [
              {
                uuid: 'ops-event-compress-completed-contract',
                eventType: 2,
                payload: {
                  operation: 'videoCompress',
                  artifactUuid: 'compress-artifact-contract',
                  artifactPath: 'D:/autocut/media/tasks/ops-task-compress-contract/outputs/compressed.mp4',
                  taskOutputDir: 'D:/autocut/media/tasks/ops-task-compress-contract/outputs',
                  byteSize: 2500,
                  originalByteSize: 10000,
                  progress: 100,
                  phase: 'completed',
                  source: 'native-host',
                },
                payloadJson: '{}',
                createdAt: '2026-05-05T00:07:00.000Z',
                updatedAt: '2026-05-05T00:07:00.000Z',
              },
            ],
            workerLeases: [],
          },
          {
            uuid: 'ops-task-failed-contract',
            taskType: 1,
            status: 3,
            progress: 42,
            sourceAssetUuid: 'asset-failed-contract',
            inputJson: JSON.stringify({
              operation: 'audioExtraction',
              assetUuid: 'asset-failed-contract',
              outputFormat: 'wav',
            }),
            outputJson: '{}',
            errorCode: 'FFMPEG_AUDIO_EXTRACTION_FAILED',
            errorMessage: 'ffmpeg exited with status 1',
            createdAt: '2026-05-05T00:03:00.000Z',
            updatedAt: '2026-05-05T00:08:00.000Z',
            stages: [],
            events: [],
            workerLeases: [],
          },
          {
            uuid: 'ops-task-corrupt-slice-contract',
            taskType: 6,
            status: 2,
            progress: 100,
            sourceAssetUuid: 'asset-corrupt-slice-contract',
            inputJson: JSON.stringify({
              operation: 'videoSlice',
              assetUuid: 'asset-corrupt-slice-contract',
              outputFormat: 'mp4',
            }),
            outputJson: JSON.stringify({
              assetUuid: 'asset-corrupt-slice-contract',
              taskOutputDir: 'D:/autocut/media/tasks/ops-task-corrupt-slice-contract/outputs',
              sliceCount: 2,
              sliceResults: [
                {
                  artifactUuid: 'corrupt-slice-artifact-contract',
                  artifactPath: 'D:/autocut/media/tasks/ops-task-corrupt-slice-contract/outputs/slice-001.mp4',
                  taskOutputDir: 'D:/autocut/media/tasks/ops-task-corrupt-slice-contract/outputs',
                  byteSize: 0,
                  startMs: 0,
                  durationMs: 15000,
                  label: 'Corrupt opening',
                },
              ],
            }),
            createdAt: '2026-05-05T00:04:00.000Z',
            updatedAt: '2026-05-05T00:09:00.000Z',
            stages: [],
            events: [],
            workerLeases: [],
          },
          {
            uuid: 'ops-task-empty-completed-slice-contract',
            taskType: 6,
            status: 2,
            progress: 100,
            sourceAssetUuid: 'asset-empty-completed-slice-contract',
            inputJson: JSON.stringify({
              operation: 'videoSlice',
              assetUuid: 'asset-empty-completed-slice-contract',
              outputFormat: 'mp4',
            }),
            outputJson: JSON.stringify({
              assetUuid: 'asset-empty-completed-slice-contract',
              taskOutputDir: 'D:/autocut/media/tasks/ops-task-empty-completed-slice-contract/outputs',
              sliceCount: 0,
              sliceResults: [],
            }),
            createdAt: '2026-05-05T00:04:30.000Z',
            updatedAt: '2026-05-05T00:09:30.000Z',
            stages: [],
            events: [],
            workerLeases: [],
          },
          {
            uuid: 'ops-task-processing-slice-contract',
            taskType: 6,
            status: 1,
            progress: 48,
            sourceAssetUuid: 'asset-processing-slice-contract',
            inputJson: JSON.stringify({
              operation: 'videoSlice',
              assetUuid: 'asset-processing-slice-contract',
              outputFormat: 'mp4',
            }),
            outputJson: '{}',
            createdAt: '2026-05-05T00:04:45.000Z',
            updatedAt: '2026-05-05T00:09:45.000Z',
            stages: [],
            events: [
              {
                uuid: 'ops-event-processing-slice-progress-contract',
                eventType: 8,
                payload: {
                  operation: 'videoSlice',
                  phase: 'rendering',
                  source: 'ffmpeg-progress',
                  progress: 48,
                },
                payloadJson: '{"operation":"videoSlice","phase":"rendering","source":"ffmpeg-progress","progress":48}',
                createdAt: '2026-05-05T00:09:40.000Z',
                updatedAt: '2026-05-05T00:09:40.000Z',
              },
            ],
            workerLeases: [],
          },
        ];
      }

      throw new Error(`Unexpected task list native host command: ${command}`);
    }, {
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    }));

    resetStorage();
    await services.addTask({
      id: 'ops-task-slice-contract',
      type: types.AUTOCUT_TASK_TYPES[0],
      name: 'local smart slice metadata sidecar',
      status: types.AUTOCUT_TASK_STATUS.completed,
      progress: 100,
      createdAt: '2026-05-05T00:00:00.000Z',
      sliceResults: [
        {
          id: 'slice-artifact-contract',
          name: 'Opening.mp4',
          duration: 15,
          size: 1234567,
          resolution: '1080P',
          thumbnailUrl: '',
          url: '',
          title: 'Opening hook',
          summary: 'Local sidecar summary survives native task projection.',
          reason: 'The deterministic candidate has a complete hook and payoff.',
          qualityScore: 0.91,
          continuityScore: 0.87,
          storyShape: 'complete',
          publishabilityScore: 0.9,
          publishabilityGrade: 'excellent',
          publishabilityIssues: ['needs-cover-title'],
          boundaryQualityScore: 0.88,
          hookStrength: 'strong',
          endingCompleteness: 'complete',
          contentArcScore: 0.94,
          contentArcGrade: 'complete',
          contentArcStages: ['hook', 'setup', 'conflict', 'payoff'],
          contentArcMissingStages: [],
          topicCoherenceScore: 0.91,
          topicCoherenceGrade: 'strong',
          topicShiftCount: 0,
          topicKeywords: ['opening', 'pain', 'payoff'],
          platformReadinessScore: 0.89,
          platformReadinessGrade: 'ready',
          platformReadinessIssues: ['platform-ready'],
          sentenceBoundaryIntegrityScore: 0.93,
          sentenceBoundaryIntegrityGrade: 'clean',
          sentenceBoundaryIssues: ['sentence-clean'],
          risks: ['needs-cover-title'],
          sourceStartMs: 1000,
          sourceEndMs: 16000,
          speechStartMs: 1200,
          speechEndMs: 15750,
          boundaryPaddingBeforeMs: 200,
          boundaryPaddingAfterMs: 250,
          transcriptText: 'Opening transcript text survives projection.',
          transcriptSegments: [
            {
              startMs: 1200,
              endMs: 15750,
              text: 'Opening transcript text survives projection.',
              speaker: 'Speaker 1',
            },
          ],
          transcriptSegmentCount: 1,
          transcriptCoverageScore: 0.96,
          speechContinuityGrade: 'strong',
        },
      ],
    });
    const nativeTasksWithSidecarMetadata = await withImmediateTimers(() => services.getTasks());
    const nativeSliceTaskWithSidecarMetadata = nativeTasksWithSidecarMetadata.find((task) => task.id === 'ops-task-slice-contract');
    assertEqual(
      nativeSliceTaskWithSidecarMetadata?.sliceResults?.[0]?.summary,
      'Local sidecar summary survives native task projection.',
      'native task projection merges local smart slice summary metadata sidecars',
    );
    assertEqual(
      nativeSliceTaskWithSidecarMetadata?.sliceResults?.[0]?.qualityScore,
      0.91,
      'native task projection merges local smart slice quality score metadata sidecars',
    );
    assertEqual(
      nativeSliceTaskWithSidecarMetadata?.sliceResults?.[0]?.storyShape,
      'complete',
      'native task projection merges local smart slice story-shape metadata sidecars',
    );
    assertEqual(
      nativeSliceTaskWithSidecarMetadata?.sliceResults?.[0]?.publishabilityScore,
      0.9,
      'native task projection merges local smart slice publishability score sidecars',
    );
    assertEqual(
      nativeSliceTaskWithSidecarMetadata?.sliceResults?.[0]?.publishabilityGrade,
      'excellent',
      'native task projection merges local smart slice publishability grade sidecars',
    );
    assertEqual(
      nativeSliceTaskWithSidecarMetadata?.sliceResults?.[0]?.publishabilityIssues?.[0],
      'needs-cover-title',
      'native task projection merges local smart slice publishability issue sidecars',
    );
    assertEqual(
      nativeSliceTaskWithSidecarMetadata?.sliceResults?.[0]?.boundaryQualityScore,
      0.88,
      'native task projection merges local smart slice boundary quality score sidecars',
    );
    assertEqual(
      nativeSliceTaskWithSidecarMetadata?.sliceResults?.[0]?.hookStrength,
      'strong',
      'native task projection merges local smart slice hook strength sidecars',
    );
    assertEqual(
      nativeSliceTaskWithSidecarMetadata?.sliceResults?.[0]?.endingCompleteness,
      'complete',
      'native task projection merges local smart slice ending completeness sidecars',
    );
    assertEqual(
      nativeSliceTaskWithSidecarMetadata?.sliceResults?.[0]?.contentArcScore,
      0.94,
      'native task projection merges local smart slice content-arc score sidecars',
    );
    assertEqual(
      nativeSliceTaskWithSidecarMetadata?.sliceResults?.[0]?.contentArcGrade,
      'complete',
      'native task projection merges local smart slice content-arc grade sidecars',
    );
    assertEqual(
      nativeSliceTaskWithSidecarMetadata?.sliceResults?.[0]?.contentArcStages?.[2],
      'conflict',
      'native task projection merges local smart slice content-arc stage sidecars',
    );
    assertEqual(
      nativeSliceTaskWithSidecarMetadata?.sliceResults?.[0]?.contentArcMissingStages?.length,
      0,
      'native task projection merges local smart slice missing content-arc stage sidecars',
    );
    assertEqual(
      nativeSliceTaskWithSidecarMetadata?.sliceResults?.[0]?.topicCoherenceScore,
      0.91,
      'native task projection merges local smart slice topic coherence score sidecars',
    );
    assertEqual(
      nativeSliceTaskWithSidecarMetadata?.sliceResults?.[0]?.topicCoherenceGrade,
      'strong',
      'native task projection merges local smart slice topic coherence grade sidecars',
    );
    assertEqual(
      nativeSliceTaskWithSidecarMetadata?.sliceResults?.[0]?.topicShiftCount,
      0,
      'native task projection merges local smart slice topic shift count sidecars',
    );
    assertEqual(
      nativeSliceTaskWithSidecarMetadata?.sliceResults?.[0]?.topicKeywords?.[0],
      'opening',
      'native task projection merges local smart slice topic keyword sidecars',
    );
    assertEqual(
      nativeSliceTaskWithSidecarMetadata?.sliceResults?.[0]?.platformReadinessScore,
      0.89,
      'native task projection merges local smart slice platform readiness score sidecars',
    );
    assertEqual(
      nativeSliceTaskWithSidecarMetadata?.sliceResults?.[0]?.platformReadinessGrade,
      'ready',
      'native task projection merges local smart slice platform readiness grade sidecars',
    );
    assertEqual(
      nativeSliceTaskWithSidecarMetadata?.sliceResults?.[0]?.platformReadinessIssues?.[0],
      'platform-ready',
      'native task projection merges local smart slice platform readiness issue sidecars',
    );
    assertEqual(
      nativeSliceTaskWithSidecarMetadata?.sliceResults?.[0]?.sentenceBoundaryIntegrityScore,
      0.93,
      'native task projection merges local smart slice sentence boundary integrity score sidecars',
    );
    assertEqual(
      nativeSliceTaskWithSidecarMetadata?.sliceResults?.[0]?.sentenceBoundaryIntegrityGrade,
      'clean',
      'native task projection merges local smart slice sentence boundary integrity grade sidecars',
    );
    assertEqual(
      nativeSliceTaskWithSidecarMetadata?.sliceResults?.[0]?.sentenceBoundaryIssues?.[0],
      'sentence-clean',
      'native task projection merges local smart slice sentence boundary issue sidecars',
    );
    assertEqual(
      nativeSliceTaskWithSidecarMetadata?.sliceResults?.[0]?.sourceEndMs,
      16000,
      'native task projection merges local smart slice repaired source range metadata sidecars',
    );
    assertEqual(
      nativeSliceTaskWithSidecarMetadata?.sliceResults?.[0]?.speechStartMs,
      1200,
      'native task projection merges local smart slice unpadded speech start metadata sidecars',
    );
    assertEqual(
      nativeSliceTaskWithSidecarMetadata?.sliceResults?.[0]?.speechEndMs,
      15750,
      'native task projection merges local smart slice unpadded speech end metadata sidecars',
    );
    assertEqual(
      nativeSliceTaskWithSidecarMetadata?.sliceResults?.[0]?.boundaryPaddingBeforeMs,
      200,
      'native task projection merges local smart slice leading boundary padding sidecars',
    );
    assertEqual(
      nativeSliceTaskWithSidecarMetadata?.sliceResults?.[0]?.boundaryPaddingAfterMs,
      250,
      'native task projection merges local smart slice trailing boundary padding sidecars',
    );
    assertEqual(
      nativeSliceTaskWithSidecarMetadata?.sliceResults?.[0]?.transcriptText,
      'Opening transcript text survives projection.',
      'native task projection merges local smart slice transcript text sidecars',
    );
    assertEqual(
      nativeSliceTaskWithSidecarMetadata?.sliceResults?.[0]?.transcriptSegments?.[0]?.text,
      'Opening transcript text survives projection.',
      'native task projection merges local smart slice structured transcript segments',
    );
    assertEqual(
      nativeSliceTaskWithSidecarMetadata?.sliceResults?.[0]?.transcriptSegmentCount,
      1,
      'native task projection merges local smart slice structured transcript segment counts',
    );
    assertEqual(
      nativeSliceTaskWithSidecarMetadata?.sliceResults?.[0]?.transcriptCoverageScore,
      0.96,
      'native task projection merges local smart slice transcript coverage score sidecars',
    );
    assertEqual(
      nativeSliceTaskWithSidecarMetadata?.sliceResults?.[0]?.speechContinuityGrade,
      'strong',
      'native task projection merges local smart slice speech continuity grade sidecars',
    );

    resetStorage();
    await services.addTask({
      id: 'ops-task-slice-contract',
      type: types.AUTOCUT_TASK_TYPES[0],
      name: 'stale local smart slice metadata sidecar',
      status: types.AUTOCUT_TASK_STATUS.completed,
      progress: 100,
      createdAt: '2026-05-05T00:00:00.000Z',
      sliceResults: [
        {
          id: 'stale-local-artifact-contract',
          name: 'Wrong clip.mp4',
          duration: 15,
          size: 1234567,
          resolution: '1080P',
          thumbnailUrl: '',
          url: '',
          summary: 'This stale summary must not be attached to a different native artifact.',
          qualityScore: 0.99,
          publishabilityScore: 0.99,
          publishabilityGrade: 'excellent',
          sourceStartMs: 80000,
          sourceEndMs: 95000,
          speechStartMs: 80200,
          speechEndMs: 94750,
        },
      ],
    });
    const nativeTasksWithMismatchedSidecarMetadata = await withImmediateTimers(() => services.getTasks());
    const nativeSliceTaskWithMismatchedSidecarMetadata = nativeTasksWithMismatchedSidecarMetadata.find((task) => task.id === 'ops-task-slice-contract');
    assertEqual(
      nativeSliceTaskWithMismatchedSidecarMetadata?.sliceResults?.[0]?.summary,
      undefined,
      'native task projection does not merge stale smart slice metadata by index when artifact ids and source windows differ',
    );
    assertEqual(
      nativeSliceTaskWithMismatchedSidecarMetadata?.sliceResults?.[0]?.qualityScore,
      undefined,
      'native task projection does not attach stale quality scores to a different native slice',
    );
    resetStorage();
    const nativeTranscriptTask = nativeTasks.find((task) => task.id === 'ops-task-transcript-contract');
    assertEqual(nativeTranscriptTask, undefined, 'getTasks hides native speech transcription implementation tasks from the user-facing task list');
    const corruptNativeTranscriptTask = nativeTasks.find((task) => task.id === 'ops-task-transcript-corrupt-contract');
    assertEqual(
      corruptNativeTranscriptTask,
      undefined,
      'getTasks hides corrupt native speech transcription implementation tasks instead of surfacing them as text extraction tasks',
    );
    const nativeCompressTask = nativeTasks.find((task) => task.id === 'ops-task-compress-contract');
    assertEqual(nativeCompressTask?.type, types.AUTOCUT_TASK_TYPES[4], 'native video compress tasks map to the AppTask compression type');
    assertEqual(nativeCompressTask?.videoUrl, 'asset://localhost/D%3A%2Fautocut%2Fmedia%2Ftasks%2Fops-task-compress-contract%2Foutputs%2Fcompressed.mp4', 'native compression artifactPath maps to videoUrl');
    assertEqual(nativeCompressTask?.fileSizeStats?.originalSize, 10000, 'native compression originalByteSize maps to fileSizeStats');
    assertEqual(nativeCompressTask?.fileSizeStats?.newSize, 2500, 'native compression byteSize maps to fileSizeStats');
    assertEqual(nativeCompressTask?.fileSizeStats?.compressionRatio, 0.75, 'native compression ratio is derived from real output sizes');
    const nativeFailedTask = nativeTasks.find((task) => task.id === 'ops-task-failed-contract');
    assertEqual(nativeFailedTask?.type, types.AUTOCUT_TASK_TYPES[2], 'native audio extraction tasks map to the AppTask audio extraction type');
    assertEqual(nativeFailedTask?.status, types.AUTOCUT_TASK_STATUS.failed, 'native failed status maps to failed AppTask status');
    assertEqual(nativeFailedTask?.errorMessage, 'ffmpeg exited with status 1', 'native task errorMessage is preserved');
    const corruptNativeSliceTask = nativeTasks.find((task) => task.id === 'ops-task-corrupt-slice-contract');
    assertEqual(
      corruptNativeSliceTask?.status,
      types.AUTOCUT_TASK_STATUS.failed,
      'native completed slice tasks with corrupt output are recovered as failed AppTasks',
    );
    assertIncludes(
      corruptNativeSliceTask?.errorMessage ?? '',
      'returned 1 slice artifacts for 2 declared slices',
      'native completed slice task recovery explains corrupt slice count mismatches',
    );
    assertEqual(
      corruptNativeSliceTask?.resultCount,
      undefined,
      'native corrupt slice task recovery does not expose a result count',
    );
    assertEqual(
      corruptNativeSliceTask?.generatedAssetIds,
      undefined,
      'native corrupt slice task recovery does not expose partial generated asset ids',
    );
    assertEqual(
      corruptNativeSliceTask?.sliceResults,
      undefined,
      'native corrupt slice task recovery does not expose partial slice results',
    );
    assertEqual(
      corruptNativeSliceTask?.completedAt,
      undefined,
      'native corrupt slice task recovery does not expose a completed timestamp',
    );
    assertEqual(
      corruptNativeSliceTask?.sourceFileId,
      'asset-corrupt-slice-contract',
      'native corrupt slice task recovery preserves the source asset id for diagnostics',
    );
    const emptyCompletedNativeSliceTask = nativeTasks.find((task) => task.id === 'ops-task-empty-completed-slice-contract');
    assertEqual(
      emptyCompletedNativeSliceTask?.status,
      types.AUTOCUT_TASK_STATUS.failed,
      'native completed slice tasks with zero declared outputs are recovered as failed AppTasks',
    );
    assertIncludes(
      emptyCompletedNativeSliceTask?.errorMessage ?? '',
      'has invalid sliceCount',
      'native completed slice task recovery explains invalid empty slice counts',
    );
    assertEqual(
      emptyCompletedNativeSliceTask?.resultCount,
      undefined,
      'native empty completed slice task recovery does not expose a zero result count',
    );
    assertEqual(
      emptyCompletedNativeSliceTask?.sliceResults,
      undefined,
      'native empty completed slice task recovery does not expose empty slice results',
    );
    const processingNativeSliceTask = nativeTasks.find((task) => task.id === 'ops-task-processing-slice-contract');
    assertEqual(
      processingNativeSliceTask?.status,
      types.AUTOCUT_TASK_STATUS.processing,
      'native processing slice tasks stay processing during recovery',
    );
    assertEqual(
      processingNativeSliceTask?.resultCount,
      undefined,
      'native processing slice tasks do not expose result counts before completion',
    );
    assertEqual(
      processingNativeSliceTask?.generatedAssetIds,
      undefined,
      'native processing slice tasks do not expose generated asset ids before completion',
    );
    assertEqual(
      processingNativeSliceTask?.sliceResults,
      undefined,
      'native processing slice tasks do not expose slice results before completion',
    );
    services.resetAutoCutNativeHostClient();
    const commons = await loadModule(server, 'packages/sdkwork-autocut-commons/src/index.ts');

    assertEqual(services.createAutoCutStorageKey('tasks'), 'autocut_release_tasks', 'storage key factory namespaces release task data');
    assertEqual(services.createAutoCutStorageKey('assets'), 'autocut_release_assets', 'storage key factory namespaces release asset data');
    assertEqual(services.createAutoCutStorageKey('messages'), 'autocut_release_messages', 'storage key factory namespaces release message data');
    assertEqual(services.createAutoCutStorageKey('settings'), 'autocut_release_settings', 'storage key factory namespaces release settings data');
    assertEqual(
      services.createAutoCutStorageKey('workflowPreferences'),
      'autocut_release_workflow_preferences',
      'storage key factory namespaces release workflow parameter preferences',
    );
    services.configureAutoCutRuntimeEnvironment('dev');
    assertEqual(services.createAutoCutStorageKey('settings'), 'autocut_dev_settings', 'storage key factory isolates dev settings data');
    assertEqual(
      services.createAutoCutStorageKey('workflowPreferences'),
      'autocut_dev_workflow_preferences',
      'storage key factory isolates dev workflow parameter preferences',
    );
    services.configureAutoCutRuntimeEnvironment('release');
    assertEqual(services.createAutoCutStorageKey('settings'), 'autocut_release_settings', 'storage key factory restores release settings data');

    assertRule(
      typeof services.getAutoCutWorkflowPreferences === 'function',
      'services exports workflow parameter preference loading',
    );
    assertRule(
      typeof services.saveAutoCutVideoSlicePreferences === 'function',
      'services exports video slice parameter preference persistence',
    );
    assertRule(
      typeof services.saveAutoCutTextExtractionPreferences === 'function',
      'services exports text extraction parameter preference persistence',
    );
    if (
      typeof services.getAutoCutWorkflowPreferences === 'function' &&
      typeof services.saveAutoCutVideoSlicePreferences === 'function' &&
      typeof services.saveAutoCutTextExtractionPreferences === 'function'
    ) {
      const defaultWorkflowPreferences = await withImmediateTimers(() => services.getAutoCutWorkflowPreferences());
      assertEqual(
        defaultWorkflowPreferences.videoSlice.targetPlatform,
        'douyin',
        'workflow parameter preferences provide a canonical video slice target platform default',
      );
      assertEqual(
        defaultWorkflowPreferences.videoSlice.enableSubtitles,
        false,
        'workflow parameter preferences default video slicing to transcript-assisted planning without subtitle rendering',
      );
      assertEqual(
        defaultWorkflowPreferences.videoSlice.subtitleMode,
        'both',
        'workflow parameter preferences retain a canonical subtitle publishing mode for when subtitle rendering is enabled',
      );
      assertEqual(
        defaultWorkflowPreferences.textExtraction.language,
        'auto',
        'workflow parameter preferences provide a canonical text extraction language default',
      );

      const savedVideoSlicePreferences = await withImmediateTimers(() =>
        services.saveAutoCutVideoSlicePreferences({
          mode: 'contract-mode',
          targetPlatform: 'bilibili',
          targetAspectRatio: '16:9',
          videoObjectFit: 'contain',
          sliceCountMode: 'fixed',
          targetSliceCount: 99,
          idealDuration: 2,
          continuityLevel: 'strict',
          customKeywordsInput: ' hook, payoff ',
          minDuration: 2,
          maxDuration: 9999,
          llmModel: 'gpt-5.4',
          baseAlgorithm: 'pause',
          highlightEngine: 'motion',
          enableNoiseReduction: false,
          enableCoughFilter: false,
          enableRepeatFilter: true,
          enableSubtitles: true,
          subtitleMode: 'srt',
          subtitleStyleId: 'minimal',
        }),
      );
      const savedTextExtractionPreferences = await withImmediateTimers(() =>
        services.saveAutoCutTextExtractionPreferences({
          language: 'ja_JP',
          separateSpeakers: false,
          filterWords: false,
        }),
      );
      const reloadedWorkflowPreferences = await withImmediateTimers(() => services.getAutoCutWorkflowPreferences());
      const storedWorkflowPreferences = readScopedStoredObject(services, 'workflowPreferences');
      assertEqual(
        savedVideoSlicePreferences.videoSlice.targetSliceCount,
        20,
        'video slice parameter preferences clamp targetSliceCount before persistence',
      );
      assertEqual(
        savedVideoSlicePreferences.videoSlice.minDuration,
        5,
        'video slice parameter preferences clamp minimum duration before persistence',
      );
      assertEqual(
        savedVideoSlicePreferences.videoSlice.maxDuration,
        600,
        'video slice parameter preferences clamp maximum duration before persistence',
      );
      assertEqual(
        savedVideoSlicePreferences.videoSlice.customKeywordsInput,
        'hook, payoff',
        'video slice parameter preferences normalize keyword input before persistence',
      );
      assertEqual(
        savedTextExtractionPreferences.textExtraction.language,
        'ja-JP',
        'text extraction parameter preferences normalize BCP-47 language tags before persistence',
      );
      assertEqual(
        reloadedWorkflowPreferences.videoSlice.subtitleMode,
        'srt',
        'workflow parameter preferences reload the selected subtitle publishing mode without promotion',
      );
      assertEqual(
        savedVideoSlicePreferences.videoSlice.subtitleMode,
        'srt',
        'video slice parameter preferences preserve SRT-only subtitle publishing mode',
      );
      const disabledVideoSlicePreferences = await withImmediateTimers(() =>
        services.saveAutoCutVideoSlicePreferences({
          enableSubtitles: false,
          subtitleMode: 'none',
        }),
      );
      assertEqual(
        disabledVideoSlicePreferences.videoSlice.enableSubtitles,
        false,
        'video slice parameter preferences allow subtitle rendering to remain disabled while smart slicing still uses speech-to-text',
      );
      assertEqual(
        disabledVideoSlicePreferences.videoSlice.subtitleMode,
        'none',
        'video slice parameter preferences preserve disabled subtitle mode',
      );
      assertEqual(
        reloadedWorkflowPreferences.textExtraction.separateSpeakers,
        false,
        'workflow parameter preferences reload the last text extraction speaker setting',
      );
      assertEqual(
        storedWorkflowPreferences.videoSlice.llmModel,
        'gpt-5.4',
        'workflow parameter preferences persist video slice model selection in scoped storage',
      );
      assertRule(
        Boolean(storedWorkflowPreferences.updatedAt),
        'workflow parameter preferences persist an updatedAt timestamp',
      );
    }

    services.resetAutoCutNativeHostClient();
    const unsupportedNativeHostClient = services.getAutoCutNativeHostClient();
    const unsupportedCapabilities = await unsupportedNativeHostClient.getCapabilities();
    const unsupportedDatabaseHealth = await unsupportedNativeHostClient.getDatabaseHealth();
    const unsupportedFfmpegProbe = await unsupportedNativeHostClient.probeFfmpeg();
    assertEqual(unsupportedCapabilities.hostKind, 'browser', 'native host fallback reports browser host kind');
    assertEqual(
      unsupportedCapabilities.mediaImportCommandReady,
      false,
      'native host fallback does not claim media import readiness',
    );
    assertEqual(
      unsupportedCapabilities.llmSecretStoreReady,
      false,
      'native host fallback does not claim LLM secret store readiness',
    );
    assertEqual(
      unsupportedCapabilities.mediaFileDescribeCommandReady,
      false,
      'native host fallback does not claim local file describe readiness',
    );
    assertEqual(
      unsupportedCapabilities.localMediaFileSelectCommandReady,
      false,
      'native host fallback does not claim local media chooser readiness',
    );
    assertEqual(
      unsupportedCapabilities.localVideoFileSelectCommandReady,
      false,
      'native host fallback does not claim local video chooser readiness',
    );
    assertEqual(
      unsupportedCapabilities.localDirectorySelectCommandReady,
      false,
      'native host fallback does not claim local directory chooser readiness',
    );
    assertEqual(
      unsupportedCapabilities.localMediaPreviewDirectoryScopeCommandReady,
      false,
      'native host fallback does not claim local media preview directory authorization readiness',
    );
    assertEqual(
      unsupportedCapabilities.audioExtractionFromAssetReady,
      false,
      'native host fallback does not claim assetUuid extraction readiness',
    );
    assertEqual(
      unsupportedCapabilities.videoGifCommandReady,
      false,
      'native host fallback does not claim video GIF command readiness',
    );
    assertEqual(
      unsupportedCapabilities.videoCompressCommandReady,
      false,
      'native host fallback does not claim video compression command readiness',
    );
    assertEqual(
      unsupportedCapabilities.videoConvertCommandReady,
      false,
      'native host fallback does not claim video conversion command readiness',
    );
    assertEqual(
      unsupportedCapabilities.videoEnhanceCommandReady,
      false,
      'native host fallback does not claim video enhancement command readiness',
    );
    assertEqual(
      unsupportedCapabilities.videoSliceCommandReady,
      false,
      'native host fallback does not claim video slice command readiness',
    );
    assertEqual(
      unsupportedCapabilities.speechTranscriptionCommandReady,
      false,
      'native host fallback does not claim speech transcription command readiness',
    );
    assertEqual(
      unsupportedCapabilities.speechTranscriptionToolchainReady,
      false,
      'native host fallback does not claim speech transcription toolchain readiness',
    );
    assertEqual(
      unsupportedCapabilities.speechTranscriptionProbeCommandReady,
      false,
      'native host fallback does not claim speech transcription probe readiness',
    );
    assertEqual(
      unsupportedCapabilities.speechTranscriptionFileSelectCommandReady,
      false,
      'native host fallback does not claim speech transcription file chooser readiness',
    );
    assertEqual(
      unsupportedCapabilities.nativeTaskQueryCommandReady,
      false,
      'native host fallback does not claim native task query readiness',
    );
    assertEqual(
      unsupportedCapabilities.nativeTaskCancelCommandReady,
      false,
      'native host fallback does not claim native task cancel readiness',
    );
    assertEqual(
      unsupportedCapabilities.nativeTaskRecoveryCommandReady,
      false,
      'native host fallback does not claim native task recovery readiness',
    );
    assertEqual(
      unsupportedCapabilities.nativeTaskRetryCommandReady,
      false,
      'native host fallback does not claim native task retry readiness',
    );
    assertEqual(
      unsupportedCapabilities.nativeTaskProgressEventsReady,
      false,
      'native host fallback does not claim native task progress event readiness',
    );
    assertEqual(
      unsupportedCapabilities.nativeWorkerLeaseReady,
      false,
      'native host fallback does not claim native worker lease readiness',
    );
    assertEqual(unsupportedDatabaseHealth.ready, false, 'native host fallback database health is not ready');
    assertEqual(unsupportedFfmpegProbe.available, false, 'native host fallback FFmpeg probe is unavailable');
    assertEqual(
      unsupportedFfmpegProbe.manifestReady,
      false,
      'native host fallback FFmpeg probe does not claim manifest readiness',
    );
    assertEqual(
      unsupportedFfmpegProbe.bundledReady,
      false,
      'native host fallback FFmpeg probe does not claim bundled readiness',
    );
    await assertRejects(
      () => unsupportedNativeHostClient.importMediaFile({ sourcePath: 'D:/media/source.mp4' }),
      'Tauri desktop host',
      'native host fallback media import',
    );
    await assertRejects(
      () => unsupportedNativeHostClient.describeLocalMediaFile({ sourcePath: 'D:/media/source.mp4' }),
      'Tauri desktop host',
      'native host fallback local file describe',
    );
    await assertRejects(
      () => unsupportedNativeHostClient.selectLocalDirectory(),
      'Tauri desktop host',
      'native host fallback local directory selection',
    );
    await assertRejects(
      () => unsupportedNativeHostClient.allowLocalMediaPreviewDirectory({ directoryPath: 'D:/media' }),
      'Tauri desktop host',
      'native host fallback local media preview directory authorization',
    );
    await assertRejects(
      () => unsupportedNativeHostClient.listNativeTasks({ limit: 10 }),
      'Tauri desktop host',
      'native host fallback task query',
    );
    await assertRejects(
      () => unsupportedNativeHostClient.cancelNativeTask({ taskUuid: 'ops-task-contract' }),
      'Tauri desktop host',
      'native host fallback task cancellation',
    );
    await assertRejects(
      () => unsupportedNativeHostClient.recoverNativeTasks({ limit: 10 }),
      'Tauri desktop host',
      'native host fallback task recovery',
    );
    await assertRejects(
      () => unsupportedNativeHostClient.retryNativeTask({ taskUuid: 'ops-task-contract' }),
      'Tauri desktop host',
      'native host fallback task retry',
    );
    await assertRejects(
      () => unsupportedNativeHostClient.extractAudio({ assetUuid: 'media-asset-1', outputFormat: 'wav' }),
      'assetUuid',
      'native host fallback assetUuid audio extraction',
    );
    await assertRejects(
      () =>
        unsupportedNativeHostClient.generateGif({
          assetUuid: 'media-asset-1',
          fps: '15',
          resolution: '480p',
          dither: true,
        }),
      'assetUuid',
      'native host fallback assetUuid video GIF generation',
    );
    await assertRejects(
      () =>
        unsupportedNativeHostClient.compressVideo({
          assetUuid: 'media-asset-1',
          compressionMode: 'balanced',
        }),
      'assetUuid',
      'native host fallback assetUuid video compression',
    );
    await assertRejects(
      () =>
        unsupportedNativeHostClient.convertVideo({
          assetUuid: 'media-asset-1',
          targetFormat: 'mp4',
          videoCodec: 'h264',
          audioCodec: 'aac',
          resolution: 'original',
        }),
      'assetUuid',
      'native host fallback assetUuid video conversion',
    );
    await assertRejects(
      () =>
        unsupportedNativeHostClient.enhanceVideo({
          assetUuid: 'media-asset-1',
          targetResolution: '1080p',
          enhanceMode: 'real',
          frameRate: 'original',
        }),
      'assetUuid',
      'native host fallback assetUuid video enhancement',
    );
    await assertRejects(
      () =>
        unsupportedNativeHostClient.sliceVideo({
          assetUuid: 'media-asset-1',
          clips: [{ startMs: 0, durationMs: 15000, label: 'Highlight 1' }],
          outputFormat: 'mp4',
        }),
      'assetUuid',
      'native host fallback assetUuid video slicing',
    );
    const invalidNativeVideoSliceInvocations = [];
    const invalidNativeVideoSliceClient = services.createAutoCutNativeHostClient(async (command, args) => {
      invalidNativeVideoSliceInvocations.push({ command, args });
      return {
        taskUuid: 'unexpected-native-video-slice-task',
        sourceAssetUuid: args?.request?.assetUuid ?? '',
        taskOutputDir: 'D:/autocut/media/tasks/unexpected-native-video-slice-task/outputs',
        slices: [],
        ffmpegExecutable: 'ffmpeg',
      };
    });
    await assertRejects(
      () =>
        invalidNativeVideoSliceClient.sliceVideo({
          assetUuid: 'media-asset-1',
          clips: [{ startMs: 0, durationMs: 45000, label: 'Fixed interval without STT' }],
          outputFormat: 'mp4',
        }),
      'speech-to-text transcript evidence',
      'native host client rejects video slice clips without STT evidence before invoking Tauri',
    );
    assertEqual(
      invalidNativeVideoSliceInvocations.length,
      0,
      'native host client does not invoke Tauri video slicing when clips lack STT evidence',
    );
    await assertRejects(
      () =>
        unsupportedNativeHostClient.transcribeMedia({
          assetUuid: 'media-asset-1',
          language: 'zh',
        }),
      'speech transcription',
      'native host fallback speech transcription',
    );
    await assertRejects(
      () =>
        unsupportedNativeHostClient.probeSpeechTranscription({
          executablePath: 'D:/tools/whisper-cli.exe',
          modelPath: 'D:/models/ggml.bin',
        }),
      'Tauri desktop host',
      'native host fallback speech transcription probe',
    );
    await assertRejects(
      () => unsupportedNativeHostClient.selectSpeechTranscriptionFile({ kind: 'model' }),
      'Tauri desktop host',
      'native host fallback speech transcription file selection',
    );
    await assertRejects(
      () =>
        unsupportedNativeHostClient.saveLlmSecret({
          secretName: 'default',
          secretValue: 'sk-browser-secret',
        }),
      'secret store',
      'native host fallback LLM secret save',
    );

    const invokedCommands = [];
    let nativeLlmSecretValue;
    const nativeHostClient = services.createAutoCutNativeHostClient(async (command, args) => {
      invokedCommands.push({ command, args });
      if (command === 'autocut_host_capabilities') {
        return {
          contractVersion: 'contract-test',
          hostKind: 'native-host',
          databaseContractReady: true,
          sqliteMigrationReady: true,
          databaseHealthCommandReady: true,
          ffmpegProbeCommandReady: true,
          mediaImportCommandReady: true,
          mediaFileDescribeCommandReady: true,
          localMediaFileSelectCommandReady: true,
          localVideoFileSelectCommandReady: true,
          localDirectorySelectCommandReady: true,
          localMediaPreviewDirectoryScopeCommandReady: true,
          localDirectorySelectCommandReady: true,
          audioExtractionCommandReady: true,
          audioExtractionFromAssetReady: true,
          videoGifCommandReady: true,
          videoCompressCommandReady: true,
          videoConvertCommandReady: true,
          videoEnhanceCommandReady: true,
          speechTranscriptionCommandReady: true,
          speechTranscriptionToolchainReady: true,
          speechTranscriptionProbeCommandReady: true,
          speechTranscriptionFileSelectCommandReady: true,
          llmHttpCommandReady: true,
          llmSecretStoreReady: true,
          nativeTaskQueryCommandReady: true,
          nativeTaskCancelCommandReady: true,
          nativeTaskRecoveryCommandReady: true,
          nativeTaskRetryCommandReady: true,
          nativeTaskProgressEventsReady: true,
          nativeWorkerLeaseReady: true,
          ffmpegBundledReady: false,
          ffmpegExecutionReady: false,
          supportedCommands: [
            'autocut_import_media_file',
            'autocut_select_local_directory',
            'autocut_allow_local_media_preview_directory',
            'autocut_extract_audio',
            'autocut_generate_gif',
            'autocut_compress_video',
            'autocut_convert_video',
            'autocut_enhance_video',
            'autocut_transcribe_media',
            'autocut_probe_speech_transcription',
            'autocut_select_speech_transcription_file',
            'autocut_list_native_tasks',
            'autocut_cancel_native_task',
            'autocut_recover_native_tasks',
            'autocut_retry_native_task',
            'autocut_llm_http_request',
            'autocut_save_llm_secret',
            'autocut_get_llm_secret',
            'autocut_delete_llm_secret',
          ],
        };
      }
      if (command === 'autocut_database_health') {
        return {
          ready: true,
          databasePath: 'memory',
          appliedMigrations: ['baseline'],
          verifiedTables: ['media_asset'],
          missingTables: [],
          diagnostics: [],
        };
      }
      if (command === 'autocut_ffmpeg_probe') {
        return {
          available: true,
          executable: 'ffmpeg',
          sourceKind: 'system-path',
          manifestReady: true,
          bundledReady: false,
          versionLine: 'ffmpeg contract',
          diagnostics: [],
        };
      }
      if (command === 'autocut_import_media_file') {
        return {
          assetUuid: 'media-asset-contract',
          sandboxPath: 'D:/autocut/media/inputs/media-asset-contract.mp4',
          byteSize: 123,
          name: 'source.mp4',
          mediaType: 'video',
          mimeType: 'video/mp4',
          durationMs: 100000,
        };
      }
      if (command === 'autocut_describe_local_media_file') {
        return {
          sourcePath: args.request.sourcePath,
          byteSize: 123,
          name: 'source.mp4',
          mediaType: 'video',
          mimeType: 'video/mp4',
          durationMs: 100000,
        };
      }
      if (command === 'autocut_select_local_video_file') {
        return {
          sourcePath: 'D:/media/selected-source.mp4',
          byteSize: 789,
          name: 'selected-source.mp4',
          mediaType: 'video',
          mimeType: 'video/mp4',
          durationMs: 78000,
        };
      }
      if (command === 'autocut_select_local_media_file') {
        return {
          sourcePath: 'D:/media/selected-audio.wav',
          byteSize: 456,
          name: 'selected-audio.wav',
          mediaType: 'audio',
          mimeType: 'audio/wav',
        };
      }
      if (command === 'autocut_select_local_directory') {
        return 'D:/media/selected-output-root';
      }
      if (command === 'autocut_allow_local_media_preview_directory') {
        return {
          directoryPath: args.request.directoryPath,
          allowed: true,
        };
      }
      if (command === 'autocut_probe_speech_transcription') {
        return {
          ready: true,
          executablePath: args.request.executablePath,
          modelPath: args.request.modelPath,
          sourceKind: 'settings',
          diagnostics: [],
          versionLine: 'whisper.cpp contract',
        };
      }
      if (command === 'autocut_select_speech_transcription_file') {
        return args.request.kind === 'executable'
          ? 'D:/tools/whisper-cli.exe'
          : 'D:/models/ggml-large-v3-turbo.bin';
      }
      if (command === 'autocut_list_native_tasks') {
        return [
          {
            uuid: 'ops-task-contract',
            taskType: 1,
            status: 2,
            progress: 100,
            sourceAssetUuid: 'media-asset-contract',
            inputJson: '{}',
            outputJson: '{}',
            createdAt: '2026-05-05T00:00:00.000Z',
            updatedAt: '2026-05-05T00:00:00.000Z',
            stages: [],
            events: [
              {
                uuid: 'ops-task-event-progress-contract',
                eventType: 8,
                payload: {
                  operation: 'audioExtraction',
                  phase: 'ffmpeg-progress-streamed',
                  source: 'ffmpeg-progress',
                  progress: 42,
                },
                payloadJson:
                  '{"operation":"audioExtraction","phase":"ffmpeg-progress-streamed","source":"ffmpeg-progress","progress":42}',
                createdAt: '2026-05-05T00:00:00.000Z',
                updatedAt: '2026-05-05T00:00:00.000Z',
              },
            ],
            workerLeases: [
              {
                uuid: 'ops-worker-lease-contract',
                workerId: 'autocut-native-media-worker',
                leaseStatus: 2,
                leaseToken: 'ops-worker-lease-token-contract',
                acquiredAt: '2026-05-05T00:00:00.000Z',
                heartbeatAt: '2026-05-05T00:00:01.000Z',
                expiresAt: '2026-05-05T00:02:01.000Z',
                releasedAt: '2026-05-05T00:00:02.000Z',
                diagnosticsJson: '{"releaseReason":"completed","source":"native-host"}',
                createdAt: '2026-05-05T00:00:00.000Z',
                updatedAt: '2026-05-05T00:00:02.000Z',
              },
            ],
          },
        ];
      }
      if (command === 'autocut_cancel_native_task') {
        return {
          taskUuid: args.request.taskUuid,
          status: 4,
          canceled: true,
          message: 'cancel requested',
        };
      }
      if (command === 'autocut_recover_native_tasks') {
        return {
          recovered: 2,
          interrupted: 1,
          canceled: 1,
          expiredLeases: 2,
          deferred: 1,
          inspected: args.request.limit,
          taskUuids: ['ops-task-interrupted', 'ops-task-canceled'],
        };
      }
      if (command === 'autocut_retry_native_task') {
        return {
          taskUuid: args.request.taskUuid,
          retryTaskUuid: 'ops-task-retry-contract',
          status: 1,
          retried: true,
          message: 'retry started',
        };
      }
      if (command === 'autocut_extract_audio') {
        const output = createNativeTaskOutputArtifact('ops-task-contract', 'audio.wav');
        return {
          artifactUuid: 'media-artifact-contract',
          taskUuid: 'ops-task-contract',
          sourceAssetUuid: args.request.assetUuid,
          artifactPath: output.artifactPath,
          taskOutputDir: output.taskOutputDir,
          byteSize: 456,
          format: args.request.outputFormat,
          ffmpegExecutable: 'ffmpeg',
        };
      }
      if (command === 'autocut_generate_gif') {
        const output = createNativeTaskOutputArtifact('ops-task-gif-contract', 'source.gif');
        return {
          artifactUuid: 'media-artifact-gif-contract',
          taskUuid: 'ops-task-gif-contract',
          sourceAssetUuid: args.request.assetUuid,
          artifactPath: output.artifactPath,
          taskOutputDir: output.taskOutputDir,
          byteSize: 567,
          format: 'gif',
          ffmpegExecutable: 'ffmpeg',
        };
      }
      if (command === 'autocut_compress_video') {
        const output = createNativeTaskOutputArtifact('ops-task-compress-contract', 'source-compressed.mp4');
        return {
          artifactUuid: 'media-artifact-compress-contract',
          taskUuid: 'ops-task-compress-contract',
          sourceAssetUuid: args.request.assetUuid,
          artifactPath: output.artifactPath,
          taskOutputDir: output.taskOutputDir,
          byteSize: 234,
          originalByteSize: 123,
          format: 'mp4',
          ffmpegExecutable: 'ffmpeg',
        };
      }
      if (command === 'autocut_convert_video') {
        const output = createNativeTaskOutputArtifact('ops-task-convert-contract', 'source-converted.mp4');
        return {
          artifactUuid: 'media-artifact-convert-contract',
          taskUuid: 'ops-task-convert-contract',
          sourceAssetUuid: args.request.assetUuid,
          artifactPath: output.artifactPath,
          taskOutputDir: output.taskOutputDir,
          byteSize: 345,
          format: args.request.targetFormat,
          ffmpegExecutable: 'ffmpeg',
        };
      }
      if (command === 'autocut_enhance_video') {
        const output = createNativeTaskOutputArtifact('ops-task-enhance-contract', 'source-enhanced.mp4');
        return {
          artifactUuid: 'media-artifact-enhance-contract',
          taskUuid: 'ops-task-enhance-contract',
          sourceAssetUuid: args.request.assetUuid,
          artifactPath: output.artifactPath,
          taskOutputDir: output.taskOutputDir,
          byteSize: 456,
          format: 'mp4',
          ffmpegExecutable: 'ffmpeg',
        };
      }
      if (command === 'autocut_transcribe_media') {
        const output = createNativeTaskOutputArtifact('ops-task-transcript-contract', 'transcript.json');
        return {
          artifactUuid: 'media-artifact-transcript-contract',
          taskUuid: 'ops-task-transcript-contract',
          sourceAssetUuid: args.request.assetUuid,
          transcriptPath: output.artifactPath,
          taskOutputDir: output.taskOutputDir,
          language: args.request.language,
          text: 'First key transcript segment. Second turning transcript segment.',
          segments: [
            {
              startMs: 12000,
              endMs: 27000,
              text: 'First key transcript segment.',
              speaker: 'Speaker 1',
            },
            {
              startMs: 45000,
              endMs: 62000,
              text: 'Second turning transcript segment.',
              speaker: 'Speaker 1',
            },
          ],
          ffmpegExecutable: 'ffmpeg',
          speechExecutable: 'whisper-cli',
        };
      }
      if (command === 'autocut_llm_http_request') {
        return {
          status: 200,
          statusText: 'OK',
          headers: {
            'content-type': 'application/json',
          },
          bodyText: '{"id":"native-llm-http","choices":[{"message":{"content":"pong"}}]}',
        };
      }
      if (command === 'autocut_save_llm_secret') {
        nativeLlmSecretValue = args.request.secretValue;
        return {
          secretName: args.request.secretName,
          saved: true,
        };
      }
      if (command === 'autocut_get_llm_secret') {
        return {
          secretName: args.request.secretName,
          configured: Boolean(nativeLlmSecretValue),
          ...(nativeLlmSecretValue ? { secretValue: nativeLlmSecretValue } : {}),
        };
      }
      if (command === 'autocut_delete_llm_secret') {
        const deleted = Boolean(nativeLlmSecretValue);
        nativeLlmSecretValue = undefined;
        return {
          secretName: args.request.secretName,
          deleted,
        };
      }
      const output = createNativeTaskOutputArtifact('ops-task-smoke', 'smoke.wav');
      return {
        artifactUuid: 'media-artifact-smoke',
        taskUuid: 'ops-task-smoke',
        sourceAssetUuid: '',
        artifactPath: output.artifactPath,
        taskOutputDir: output.taskOutputDir,
        byteSize: 789,
        format: 'wav',
        ffmpegExecutable: 'ffmpeg',
      };
    });
    services.configureAutoCutNativeHostClient(nativeHostClient);
    const configuredNativeHostClient = services.getAutoCutNativeHostClient();
    const configuredCapabilities = await configuredNativeHostClient.getCapabilities();
    const configuredDatabaseHealth = await configuredNativeHostClient.getDatabaseHealth();
    const configuredFfmpegProbe = await configuredNativeHostClient.probeFfmpeg();
    const importedNativeMedia = await configuredNativeHostClient.importMediaFile({
      sourcePath: 'D:/media/source.mp4',
    });
    const describedNativeMedia = await configuredNativeHostClient.describeLocalMediaFile({
      sourcePath: 'D:/media/source.mp4',
    });
    const selectedNativeMedia = await configuredNativeHostClient.selectLocalMediaFile({
      mediaTypes: ['audio', 'video'],
    });
    const selectedNativeVideo = await configuredNativeHostClient.selectLocalVideoFile();
    const selectedNativeDirectory = await configuredNativeHostClient.selectLocalDirectory();
    const previewDirectoryAuthorization = await configuredNativeHostClient.allowLocalMediaPreviewDirectory({
      directoryPath: 'D:/media',
    });
    const selectedSpeechExecutable = await configuredNativeHostClient.selectSpeechTranscriptionFile({ kind: 'executable' });
    const probedSpeechTranscription = await configuredNativeHostClient.probeSpeechTranscription({
      executablePath: 'D:/tools/whisper-cli.exe',
      modelPath: 'D:/models/ggml-large-v3-turbo.bin',
    });
    const extractedNativeAudio = await configuredNativeHostClient.extractAudio({
      assetUuid: importedNativeMedia.assetUuid,
      outputFormat: 'wav',
    });
    const generatedNativeGif = await configuredNativeHostClient.generateGif({
      assetUuid: importedNativeMedia.assetUuid,
      fps: '15',
      resolution: '480p',
      dither: true,
    });
    const compressedNativeVideo = await configuredNativeHostClient.compressVideo({
      assetUuid: importedNativeMedia.assetUuid,
      compressionMode: 'balanced',
    });
    const convertedNativeVideo = await configuredNativeHostClient.convertVideo({
      assetUuid: importedNativeMedia.assetUuid,
      targetFormat: 'mp4',
      videoCodec: 'h264',
      audioCodec: 'aac',
      resolution: 'original',
    });
    const enhancedNativeVideo = await configuredNativeHostClient.enhanceVideo({
      assetUuid: importedNativeMedia.assetUuid,
      targetResolution: '1080p',
      enhanceMode: 'real',
      frameRate: 'original',
    });
    const transcribedNativeMedia = await configuredNativeHostClient.transcribeMedia({
      assetUuid: importedNativeMedia.assetUuid,
      language: 'zh',
    });
    const nativeTaskSnapshots = await configuredNativeHostClient.listNativeTasks({
      taskUuid: 'ops-task-contract',
      limit: 5,
    });
    const canceledNativeTask = await configuredNativeHostClient.cancelNativeTask({
      taskUuid: 'ops-task-contract',
    });
    const recoveredNativeTasks = await configuredNativeHostClient.recoverNativeTasks({
      limit: 10,
    });
    const retriedNativeTask = await configuredNativeHostClient.retryNativeTask({
      taskUuid: 'ops-task-contract',
    });
    const llmHttpResponse = await configuredNativeHostClient.sendLlmHttpRequest({
      url: 'https://api.deepseek.com/chat/completions',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      bodyText: '{"model":"deepseek-v4-flash"}',
    });
    const savedNativeLlmSecret = await configuredNativeHostClient.saveLlmSecret({
      secretName: 'default',
      secretValue: 'sk-native-stored-secret',
    });
    const loadedNativeLlmSecret = await configuredNativeHostClient.getLlmSecret({
      secretName: 'default',
    });
    const deletedNativeLlmSecret = await configuredNativeHostClient.deleteLlmSecret({
      secretName: 'default',
    });
    const audioSmoke = await configuredNativeHostClient.runAudioSmoke();
    assertEqual(configuredCapabilities.hostKind, 'native-host', 'configured native host client returns host capabilities');
    assertEqual(
      configuredCapabilities.nativeWorkerLeaseReady,
      true,
      'configured native host client reports native worker lease readiness',
    );
    assertEqual(configuredDatabaseHealth.ready, true, 'configured native host client returns database health');
    assertEqual(configuredFfmpegProbe.available, true, 'configured native host client returns FFmpeg probe');
    assertEqual(importedNativeMedia.assetUuid, 'media-asset-contract', 'configured native host client imports media through assetUuid');
    assertEqual(describedNativeMedia.sourcePath, 'D:/media/source.mp4', 'configured native host client describes a trusted local file source');
    assertEqual(selectedNativeMedia?.sourcePath, 'D:/media/selected-audio.wav', 'configured native host client selects a trusted local audio or video source');
    const selectedTrustedMedia = await services.selectAutoCutTrustedLocalMediaFile(['audio', 'video']);
    assertEqual(selectedTrustedMedia?.mediaType, 'audio', 'trusted local media chooser helper returns selected native audio descriptions');
    assertEqual(selectedNativeVideo?.sourcePath, 'D:/media/selected-source.mp4', 'configured native host client selects a trusted local video source');
    assertEqual(selectedNativeDirectory, 'D:/media/selected-output-root', 'configured native host client selects a trusted local directory');
    assertEqual(previewDirectoryAuthorization.allowed, true, 'configured native host client authorizes a trusted local media preview directory');
    assertEqual(previewDirectoryAuthorization.directoryPath, 'D:/media', 'configured native host client passes preview directory path through the Tauri request');
    assertEqual(selectedSpeechExecutable, 'D:/tools/whisper-cli.exe', 'configured native host client selects a trusted local speech executable');
    assertEqual(probedSpeechTranscription.ready, true, 'configured native host client probes local speech-to-text toolchain readiness');
    assertEqual(extractedNativeAudio.sourceAssetUuid, importedNativeMedia.assetUuid, 'configured native host client extracts audio by assetUuid');
    assertNativeTaskOutputArtifact(
      extractedNativeAudio,
      'ops-task-contract',
      'audio.wav',
      'configured native host client audio extraction result',
    );
    assertEqual(generatedNativeGif.sourceAssetUuid, importedNativeMedia.assetUuid, 'configured native host client generates video GIF by assetUuid');
    assertNativeTaskOutputArtifact(
      generatedNativeGif,
      'ops-task-gif-contract',
      'source.gif',
      'configured native host client video GIF result',
    );
    assertEqual(compressedNativeVideo.sourceAssetUuid, importedNativeMedia.assetUuid, 'configured native host client compresses video by assetUuid');
    assertNativeTaskOutputArtifact(
      compressedNativeVideo,
      'ops-task-compress-contract',
      'source-compressed.mp4',
      'configured native host client video compression result',
    );
    assertEqual(convertedNativeVideo.sourceAssetUuid, importedNativeMedia.assetUuid, 'configured native host client converts video by assetUuid');
    assertNativeTaskOutputArtifact(
      convertedNativeVideo,
      'ops-task-convert-contract',
      'source-converted.mp4',
      'configured native host client video conversion result',
    );
    assertEqual(enhancedNativeVideo.sourceAssetUuid, importedNativeMedia.assetUuid, 'configured native host client enhances video by assetUuid');
    assertNativeTaskOutputArtifact(
      enhancedNativeVideo,
      'ops-task-enhance-contract',
      'source-enhanced.mp4',
      'configured native host client video enhancement result',
    );
    assertEqual(transcribedNativeMedia.sourceAssetUuid, importedNativeMedia.assetUuid, 'configured native host client transcribes media by assetUuid');
    assertEqual(transcribedNativeMedia.segments[0]?.startMs, 12000, 'configured native host client returns speech transcription segment timing');
    assertEqual(transcribedNativeMedia.speechExecutable, 'whisper-cli', 'configured native host client returns the local speech executable used');
    assertEqual(nativeTaskSnapshots[0]?.uuid, 'ops-task-contract', 'configured native host client lists native task snapshots');
    assertEqual(
      nativeTaskSnapshots[0]?.events[0]?.payload?.operation,
      'audioExtraction',
      'configured native host client exposes structured native task event payload operation',
    );
    assertEqual(
      nativeTaskSnapshots[0]?.events[0]?.payload?.phase,
      'ffmpeg-progress-streamed',
      'configured native host client exposes structured native task event payload phase',
    );
    assertEqual(
      nativeTaskSnapshots[0]?.events[0]?.payload?.source,
      'ffmpeg-progress',
      'configured native host client exposes structured native task event payload source',
    );
    assertEqual(
      nativeTaskSnapshots[0]?.events[0]?.payload?.progress,
      42,
      'configured native host client exposes structured native task event payload progress',
    );
    assertEqual(
      nativeTaskSnapshots[0]?.events[0]?.payloadJson.includes('"progress":42'),
      true,
      'configured native host client keeps raw native task event payloadJson for audits',
    );
    assertEqual(
      nativeTaskSnapshots[0]?.workerLeases[0]?.workerId,
      'autocut-native-media-worker',
      'configured native host client exposes native worker lease workerId',
    );
    assertEqual(
      nativeTaskSnapshots[0]?.workerLeases[0]?.leaseStatus,
      2,
      'configured native host client exposes native worker lease status',
    );
    assertEqual(canceledNativeTask.taskUuid, 'ops-task-contract', 'configured native host client cancels native task by taskUuid');
    assertEqual(canceledNativeTask.canceled, true, 'configured native host client returns cancel acknowledgement');
    assertEqual(recoveredNativeTasks.recovered, 2, 'configured native host client recovers interrupted native tasks');
    assertEqual(recoveredNativeTasks.interrupted, 1, 'configured native host client reports interrupted task count');
    assertEqual(recoveredNativeTasks.canceled, 1, 'configured native host client reports recovered canceled task count');
    assertEqual(recoveredNativeTasks.expiredLeases, 2, 'configured native host client reports expired worker lease count');
    assertEqual(recoveredNativeTasks.deferred, 1, 'configured native host client reports deferred active lease task count');
    assertEqual(retriedNativeTask.taskUuid, 'ops-task-contract', 'configured native host client retries native task by taskUuid');
    assertEqual(retriedNativeTask.retryTaskUuid, 'ops-task-retry-contract', 'configured native host client returns the retry task uuid');
    assertEqual(retriedNativeTask.retried, true, 'configured native host client returns retry acknowledgement');
    assertEqual(llmHttpResponse.status, 200, 'configured native host client sends LLM HTTP requests through the native host');
    assertEqual(llmHttpResponse.bodyText.includes('native-llm-http'), true, 'configured native host client returns native LLM HTTP response body text');
    assertEqual(savedNativeLlmSecret.saved, true, 'configured native host client saves LLM secrets through the native secret store');
    assertEqual(loadedNativeLlmSecret.configured, true, 'configured native host client loads LLM secret configured state from the native secret store');
    assertEqual(loadedNativeLlmSecret.secretValue, 'sk-native-stored-secret', 'configured native host client returns LLM secret values only through explicit secret reads');
    assertEqual(deletedNativeLlmSecret.deleted, true, 'configured native host client deletes LLM secrets through the native secret store');
    assertEqual(audioSmoke.format, 'wav', 'configured native host client runs audio smoke');
    assertNativeTaskOutputArtifact(audioSmoke, 'ops-task-smoke', 'smoke.wav', 'configured native host client audio smoke result');
    assertEqual(importedNativeMedia.durationMs, 100000, 'native host client exposes imported media duration for source-bounded slicing');
    assertEqual(describedNativeMedia.durationMs, 100000, 'native host client exposes local media description duration for preflight planning');
    assertEqual(selectedNativeVideo?.durationMs, 78000, 'native host client exposes selected local video duration for UI planning defaults');
    assertEqual(invokedCommands[0]?.command, 'autocut_host_capabilities', 'native host client invokes capabilities command first');
    assertEqual(
      invokedCommands[3]?.command,
      'autocut_import_media_file',
      'native host client invokes the media import command',
    );
    assertEqual(
      invokedCommands[3]?.args?.request?.sourcePath,
      'D:/media/source.mp4',
      'native host client passes sourcePath under the Tauri request argument',
    );
    assertEqual(
      invokedCommands[4]?.command,
      'autocut_describe_local_media_file',
      'native host client invokes the local file describe command',
    );
    assertEqual(
      invokedCommands[4]?.args?.request?.sourcePath,
      'D:/media/source.mp4',
      'native host client passes sourcePath to the local file describe command',
    );
    assertEqual(
      invokedCommands.some((entry) => entry.command === 'autocut_select_local_video_file'),
      true,
      'native host client invokes the local video chooser command',
    );
    assertEqual(
      invokedCommands.some((entry) => entry.command === 'autocut_select_local_directory'),
      true,
      'native host client invokes the local directory chooser command',
    );
    assertEqual(
      invokedCommands.some((entry) => entry.command === 'autocut_allow_local_media_preview_directory'),
      true,
      'native host client invokes the local media preview directory authorization command',
    );
    const localMediaPreviewDirectoryCommand = invokedCommands.find(
      (entry) => entry.command === 'autocut_allow_local_media_preview_directory',
    );
    assertEqual(
      localMediaPreviewDirectoryCommand?.command,
      'autocut_allow_local_media_preview_directory',
      'native host client invokes the local media preview directory authorization command',
    );
    assertEqual(
      localMediaPreviewDirectoryCommand?.args?.request?.directoryPath,
      'D:/media',
      'native host client passes directoryPath under the Tauri preview authorization request argument',
    );
    const audioExtractionCommand = invokedCommands.find((entry) => entry.command === 'autocut_extract_audio');
    const localMediaSelectCommand = invokedCommands.find((entry) => entry.command === 'autocut_select_local_media_file');
    const videoGifCommand = invokedCommands.find((entry) => entry.command === 'autocut_generate_gif');
    const videoCompressCommand = invokedCommands.find((entry) => entry.command === 'autocut_compress_video');
    const videoConvertCommand = invokedCommands.find((entry) => entry.command === 'autocut_convert_video');
    const videoEnhanceCommand = invokedCommands.find((entry) => entry.command === 'autocut_enhance_video');
    const speechTranscriptionCommand = invokedCommands.find((entry) => entry.command === 'autocut_transcribe_media');
    const speechTranscriptionProbeCommand = invokedCommands.find((entry) => entry.command === 'autocut_probe_speech_transcription');
    const speechTranscriptionFileSelectCommand = invokedCommands.find((entry) => entry.command === 'autocut_select_speech_transcription_file');
    const nativeTaskQueryCommand = invokedCommands.find((entry) => entry.command === 'autocut_list_native_tasks');
    const nativeTaskCancelCommand = invokedCommands.find((entry) => entry.command === 'autocut_cancel_native_task');
    const nativeTaskRecoveryCommand = invokedCommands.find((entry) => entry.command === 'autocut_recover_native_tasks');
    const nativeTaskRetryCommand = invokedCommands.find((entry) => entry.command === 'autocut_retry_native_task');
    const llmHttpCommand = invokedCommands.find((entry) => entry.command === 'autocut_llm_http_request');
    const llmSecretSaveCommand = invokedCommands.find((entry) => entry.command === 'autocut_save_llm_secret');
    const llmSecretGetCommand = invokedCommands.find((entry) => entry.command === 'autocut_get_llm_secret');
    const llmSecretDeleteCommand = invokedCommands.find((entry) => entry.command === 'autocut_delete_llm_secret');
    assertEqual(
      localMediaSelectCommand?.command,
      'autocut_select_local_media_file',
      'native host client invokes the trusted local audio/video chooser command',
    );
    assertDeepEqual(
      localMediaSelectCommand?.args?.request?.mediaTypes,
      ['audio', 'video'],
      'native host client passes mediaTypes under the trusted local media chooser request',
    );
    assertEqual(
      audioExtractionCommand?.command,
      'autocut_extract_audio',
      'native host client invokes the assetUuid audio extraction command',
    );
    assertEqual(
      audioExtractionCommand?.args?.request?.assetUuid,
      importedNativeMedia.assetUuid,
      'native host client passes assetUuid under the Tauri request argument',
    );
    assertEqual(
      videoGifCommand?.command,
      'autocut_generate_gif',
      'native host client invokes the assetUuid video GIF command',
    );
    assertEqual(
      videoGifCommand?.args?.request?.assetUuid,
      importedNativeMedia.assetUuid,
      'native host client passes assetUuid under the Tauri video GIF request argument',
    );
    assertEqual(
      videoCompressCommand?.command,
      'autocut_compress_video',
      'native host client invokes the assetUuid video compression command',
    );
    assertEqual(
      videoCompressCommand?.args?.request?.assetUuid,
      importedNativeMedia.assetUuid,
      'native host client passes assetUuid under the Tauri video compression request argument',
    );
    assertEqual(
      videoCompressCommand?.args?.request?.compressionMode,
      'balanced',
      'native host client passes compressionMode under the Tauri video compression request argument',
    );
    assertEqual(
      videoConvertCommand?.command,
      'autocut_convert_video',
      'native host client invokes the assetUuid video conversion command',
    );
    assertEqual(
      videoConvertCommand?.args?.request?.assetUuid,
      importedNativeMedia.assetUuid,
      'native host client passes assetUuid under the Tauri video conversion request argument',
    );
    assertEqual(
      videoConvertCommand?.args?.request?.targetFormat,
      'mp4',
      'native host client passes targetFormat under the Tauri video conversion request argument',
    );
    assertEqual(
      videoEnhanceCommand?.command,
      'autocut_enhance_video',
      'native host client invokes the assetUuid video enhancement command',
    );
    assertEqual(
      videoEnhanceCommand?.args?.request?.assetUuid,
      importedNativeMedia.assetUuid,
      'native host client passes assetUuid under the Tauri video enhancement request argument',
    );
    assertEqual(
      videoEnhanceCommand?.args?.request?.targetResolution,
      '1080p',
      'native host client passes targetResolution under the Tauri video enhancement request argument',
    );
    assertEqual(
      speechTranscriptionCommand?.command,
      'autocut_transcribe_media',
      'native host client invokes the assetUuid speech transcription command',
    );
    assertEqual(
      speechTranscriptionCommand?.args?.request?.assetUuid,
      importedNativeMedia.assetUuid,
      'native host client passes assetUuid under the Tauri speech transcription request argument',
    );
    assertEqual(
      speechTranscriptionCommand?.args?.request?.language,
      'zh',
      'native host client passes language under the Tauri speech transcription request argument',
    );
    assertEqual(
      speechTranscriptionProbeCommand?.args?.request?.executablePath,
      'D:/tools/whisper-cli.exe',
      'native host client passes executablePath under the Tauri speech transcription probe request argument',
    );
    assertEqual(
      speechTranscriptionProbeCommand?.args?.request?.modelPath,
      'D:/models/ggml-large-v3-turbo.bin',
      'native host client passes modelPath under the Tauri speech transcription probe request argument',
    );
    assertEqual(
      speechTranscriptionFileSelectCommand?.args?.request?.kind,
      'executable',
      'native host client passes file kind under the Tauri speech transcription file chooser request argument',
    );
    assertEqual(
      nativeTaskQueryCommand?.command,
      'autocut_list_native_tasks',
      'native host client invokes the native task query command',
    );
    assertEqual(
      nativeTaskQueryCommand?.args?.request?.taskUuid,
      'ops-task-contract',
      'native host client passes taskUuid under the Tauri native task query request argument',
    );
    assertEqual(
      nativeTaskCancelCommand?.command,
      'autocut_cancel_native_task',
      'native host client invokes the native task cancel command',
    );
    assertEqual(
      nativeTaskCancelCommand?.args?.request?.taskUuid,
      'ops-task-contract',
      'native host client passes taskUuid under the Tauri native task cancel request argument',
    );
    assertEqual(
      nativeTaskRecoveryCommand?.command,
      'autocut_recover_native_tasks',
      'native host client invokes the native task recovery command',
    );
    assertEqual(
      nativeTaskRecoveryCommand?.args?.request?.limit,
      10,
      'native host client passes limit under the Tauri native task recovery request argument',
    );
    assertEqual(
      nativeTaskRetryCommand?.command,
      'autocut_retry_native_task',
      'native host client invokes the native task retry command',
    );
    assertEqual(
      nativeTaskRetryCommand?.args?.request?.taskUuid,
      'ops-task-contract',
      'native host client passes taskUuid under the Tauri native task retry request argument',
    );
    assertEqual(
      llmHttpCommand?.command,
      'autocut_llm_http_request',
      'native host client invokes the LLM HTTP request command',
    );
    assertEqual(
      llmHttpCommand?.args?.request?.url,
      'https://api.deepseek.com/chat/completions',
      'native host client passes the LLM HTTP request URL',
    );
    assertEqual(
      llmHttpCommand?.args?.request?.bodyText,
      '{"model":"deepseek-v4-flash"}',
      'native host client passes the LLM HTTP request body text',
    );
    assertEqual(
      llmSecretSaveCommand?.command,
      'autocut_save_llm_secret',
      'native host client invokes the LLM secret save command',
    );
    assertEqual(
      llmSecretGetCommand?.command,
      'autocut_get_llm_secret',
      'native host client invokes the LLM secret get command',
    );
    assertEqual(
      llmSecretDeleteCommand?.command,
      'autocut_delete_llm_secret',
      'native host client invokes the LLM secret delete command',
    );

    resetStorage();
    const nativeAudioWorkflowCommands = [];
    const configuredOutputDirectory = 'D:/autocut-configured-output';
    await services.saveAutoCutWorkspaceSettings({
      ...(await services.getAutoCutSettings()).workspace,
      outputDirectory: configuredOutputDirectory,
    });
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        contractVersion: 'contract-test',
        hostKind: 'native-host',
        databaseContractReady: true,
        sqliteMigrationReady: true,
          databaseHealthCommandReady: true,
          ffmpegProbeCommandReady: true,
          mediaImportCommandReady: true,
          mediaFileDescribeCommandReady: true,
          localVideoFileSelectCommandReady: true,
          audioExtractionCommandReady: true,
        audioExtractionFromAssetReady: true,
        videoGifCommandReady: false,
        videoCompressCommandReady: false,
        videoConvertCommandReady: false,
        videoEnhanceCommandReady: false,
        nativeTaskQueryCommandReady: true,
        nativeTaskCancelCommandReady: false,
        nativeTaskRecoveryCommandReady: false,
        nativeTaskRetryCommandReady: false,
        nativeTaskProgressEventsReady: false,
        ffmpegToolchainManifestReady: true,
        ffmpegToolchainResolverReady: true,
        ffmpegBundledReady: false,
        ffmpegExecutionReady: false,
        supportedCommands: ['autocut_import_media_file', 'autocut_extract_audio'],
      }),
      getDatabaseHealth: async () => ({
        ready: true,
        databasePath: 'memory',
        appliedMigrations: ['baseline'],
        verifiedTables: ['media_asset'],
        missingTables: [],
        diagnostics: [],
      }),
      probeFfmpeg: async () => ({
        available: true,
        executable: 'ffmpeg',
        sourceKind: 'system-path',
        manifestReady: true,
        bundledReady: false,
        versionLine: 'ffmpeg contract',
        diagnostics: [],
      }),
      importMediaFile: async (request) => {
        nativeAudioWorkflowCommands.push({ kind: 'import', request });
        return {
          assetUuid: 'native-audio-asset',
          sandboxPath: `${configuredOutputDirectory}/inputs/native-audio-asset.mp4`,
          byteSize: 321000,
          name: 'native-source.mp4',
          mediaType: 'video',
          mimeType: 'video/mp4',
        };
      },
      describeLocalMediaFile: async (request) => ({
        sourcePath: request.sourcePath,
        byteSize: 321000,
        name: 'native-source.mp4',
        mediaType: 'video',
        mimeType: 'video/mp4',
      }),
      extractAudio: async (request) => {
        nativeAudioWorkflowCommands.push({ kind: 'extract', request });
        const output = createNativeTaskOutputArtifact(
          'native-audio-task',
          'native-audio-artifact.wav',
          configuredOutputDirectory,
        );
        return {
          artifactUuid: 'native-audio-artifact',
          taskUuid: 'native-audio-task',
          sourceAssetUuid: request.assetUuid,
          artifactPath: output.artifactPath,
          taskOutputDir: output.taskOutputDir,
          byteSize: 654321,
          format: request.outputFormat,
          ffmpegExecutable: 'ffmpeg',
        };
      },
      generateGif: async () => {
        throw new Error('video GIF command is not configured for the native audio workflow contract');
      },
      compressVideo: async () => {
        throw new Error('video compression command is not configured for the native audio workflow contract');
      },
      convertVideo: async () => {
        throw new Error('video conversion command is not configured for the native audio workflow contract');
      },
      enhanceVideo: async () => {
        throw new Error('video enhancement command is not configured for the native audio workflow contract');
      },
      runAudioSmoke: async () => ({
        artifactUuid: 'native-audio-smoke',
        taskUuid: 'native-audio-smoke-task',
        sourceAssetUuid: '',
        artifactPath: createNativeTaskOutputArtifact('native-audio-smoke-task', 'native-audio-smoke.wav').artifactPath,
        taskOutputDir: createNativeTaskOutputArtifact('native-audio-smoke-task', 'native-audio-smoke.wav').taskOutputDir,
        byteSize: 1,
        format: 'wav',
        ffmpegExecutable: 'ffmpeg',
      }),
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    });
    const trustedFileSourceEvents = [];
    const stopTrustedFileSourceDrop = commons.listenAutoCutTrustedFileSourceDrop((detail) => {
      trustedFileSourceEvents.push(detail);
    });
    const trustedLocalFile = commons.createAutoCutTrustedLocalFile({
      sourcePath: 'D:/media/native-source.mp4',
      name: 'native-source.mp4',
      byteSize: 321000,
      mimeType: 'video/mp4',
      mediaType: 'video',
    });
    commons.dispatchAutoCutTrustedFileSourceDrop({
      files: [trustedLocalFile],
    });
    stopTrustedFileSourceDrop();
    assertEqual(
      commons.resolveAutoCutTrustedSourcePath(trustedLocalFile),
      'D:/media/native-source.mp4',
      'trusted file source bridge creates a File-compatible trusted local file',
    );
    const forgedSourcePathFile = new File(['video'], 'forged-source-path.mp4', { type: 'video/mp4' });
    Object.defineProperty(forgedSourcePathFile, 'sourcePath', {
      configurable: true,
      enumerable: true,
      value: 'D:/media/forged-source-path.mp4',
    });
    assertEqual(
      commons.resolveAutoCutTrustedSourcePath(forgedSourcePathFile),
      null,
      'trusted file source bridge rejects browser-forged sourcePath properties',
    );
    const forgedPathFile = new File(['video'], 'forged-path.mp4', { type: 'video/mp4' });
    Object.defineProperty(forgedPathFile, 'path', {
      configurable: true,
      enumerable: true,
      value: 'D:/media/forged-path.mp4',
    });
    assertEqual(
      commons.resolveAutoCutTrustedSourcePath(forgedPathFile),
      null,
      'trusted file source bridge rejects browser-forged path properties',
    );
    assertEqual(
      commons.resolveAutoCutTrustedSourcePath(structuredClone(trustedLocalFile)),
      null,
      'browser route state cloning does not preserve custom trusted File sourcePath metadata',
    );
    assertEqual(
      commons.resolveAutoCutTrustedSourcePath(commons.createAutoCutTrustedLocalFile(structuredClone({
        sourcePath: 'D:/media/native-source.mp4',
        name: 'native-source.mp4',
        byteSize: 321000,
        mimeType: 'video/mp4',
        mediaType: 'video',
      }))),
      'D:/media/native-source.mp4',
      'trusted desktop source descriptors survive router state cloning and can rebuild File-compatible trusted inputs',
    );
    assertEqual(trustedLocalFile.size, 321000, 'trusted file source bridge preserves native byte size on the File-compatible value');
    assertEqual(trustedFileSourceEvents[0]?.files?.[0]?.name, 'native-source.mp4', 'trusted file source bridge dispatches trusted local files');
    const nativeAudioSourceFile = createTrustedLocalMediaFile(commons, 'D:/media/native-source.mp4');
    const nativeAudioWorkflowResult = await withImmediateTimers(async () =>
      processAudioExtraction({
        fileId: 'asset-source-native-audio',
        file: nativeAudioSourceFile,
        format: 'wav',
        quality: '320',
        channel: 'stereo',
      }),
    );
    const nativeAudioWorkflowTasks = readScopedStoredArray(services, 'tasks');
    const nativeAudioWorkflowTask = nativeAudioWorkflowTasks.find(
      (task) => task.id === nativeAudioWorkflowResult.taskId,
    );
    const nativeAudioWorkflowAssets = readScopedStoredArray(services, 'assets');
    assertEqual(nativeAudioWorkflowResult.success, true, 'extractor audio native workflow reports success');
    assertEqual(
      nativeAudioWorkflowCommands[0]?.kind,
      'import',
      'extractor audio native workflow imports local media before extraction',
    );
    assertEqual(
      nativeAudioWorkflowCommands[0]?.request?.sourcePath,
      'D:/media/native-source.mp4',
      'extractor audio native workflow passes the trusted desktop source path to media import',
    );
    assertEqual(
      nativeAudioWorkflowCommands[0]?.request?.outputRootDir,
      configuredOutputDirectory,
      'extractor audio native workflow passes the configured output directory to media import',
    );
    assertEqual(
      nativeAudioWorkflowCommands[1]?.kind,
      'extract',
      'extractor audio native workflow extracts audio after import',
    );
    assertEqual(
      nativeAudioWorkflowCommands[1]?.request?.assetUuid,
      'native-audio-asset',
      'extractor audio native workflow extracts audio by imported assetUuid',
    );
    assertEqual(
      nativeAudioWorkflowCommands[1]?.request?.outputRootDir,
      configuredOutputDirectory,
      'extractor audio native workflow passes the configured output directory to audio extraction',
    );
    assertEqual(
      nativeAudioWorkflowTask?.status,
      types.AUTOCUT_TASK_STATUS.completed,
      'extractor audio native workflow completes the persisted task',
    );
    assertEqual(
      nativeAudioWorkflowTask?.audioUrl,
      'asset://localhost/D%3A%2Fautocut-configured-output%2Ftasks%2Fnative-audio-task%2Foutputs%2Fnative-audio-artifact.wav',
      'extractor audio native workflow converts native artifact paths to safe asset URLs',
    );
    assertEqual(
      nativeAudioWorkflowAssets[0]?.size,
      654321,
      'extractor audio native workflow stores the native artifact byte size on the generated asset',
    );
    assertEqual(
      nativeAudioWorkflowAssets[0]?.url,
      nativeAudioWorkflowTask?.audioUrl,
      'extractor audio native workflow stores the safe asset URL on the generated asset',
    );
    services.resetAutoCutNativeHostClient();

    resetStorage();
    const nativeVideoGifWorkflowCommands = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        contractVersion: 'contract-test',
        hostKind: 'native-host',
        databaseContractReady: true,
        sqliteMigrationReady: true,
        databaseHealthCommandReady: true,
        ffmpegProbeCommandReady: true,
        mediaImportCommandReady: true,
        mediaFileDescribeCommandReady: true,
          localVideoFileSelectCommandReady: true,
        audioExtractionCommandReady: false,
        audioExtractionFromAssetReady: false,
        videoGifCommandReady: true,
        videoCompressCommandReady: false,
        videoConvertCommandReady: false,
        videoEnhanceCommandReady: false,
        nativeTaskQueryCommandReady: true,
        nativeTaskCancelCommandReady: false,
        nativeTaskRecoveryCommandReady: false,
        nativeTaskRetryCommandReady: false,
        nativeTaskProgressEventsReady: false,
        ffmpegToolchainManifestReady: true,
        ffmpegToolchainResolverReady: true,
        ffmpegBundledReady: false,
        ffmpegExecutionReady: false,
        supportedCommands: ['autocut_import_media_file', 'autocut_generate_gif'],
      }),
      getDatabaseHealth: async () => ({
        ready: true,
        databasePath: 'memory',
        appliedMigrations: ['baseline'],
        verifiedTables: ['media_asset'],
        missingTables: [],
        diagnostics: [],
      }),
      probeFfmpeg: async () => ({
        available: true,
        executable: 'ffmpeg',
        sourceKind: 'system-path',
        manifestReady: true,
        bundledReady: false,
        versionLine: 'ffmpeg contract',
        diagnostics: [],
      }),
      importMediaFile: async (request) => {
        nativeVideoGifWorkflowCommands.push({ kind: 'import', request });
        return {
          assetUuid: 'native-gif-asset',
          sandboxPath: 'D:/autocut/media/inputs/native-gif-asset.mp4',
          byteSize: 321000,
          name: 'native-source.mp4',
          mediaType: 'video',
          mimeType: 'video/mp4',
        };
      },
      describeLocalMediaFile: async (request) => ({
        sourcePath: request.sourcePath,
        byteSize: 321000,
        name: 'native-source.mp4',
        mediaType: 'video',
        mimeType: 'video/mp4',
      }),
      extractAudio: async () => {
        throw new Error('audio extraction is not configured for the native video GIF workflow contract');
      },
      generateGif: async (request) => {
        nativeVideoGifWorkflowCommands.push({ kind: 'gif', request });
        const output = createNativeTaskOutputArtifact('native-gif-task', 'native-gif-artifact.gif');
        return {
          artifactUuid: 'native-gif-artifact',
          taskUuid: 'native-gif-task',
          sourceAssetUuid: request.assetUuid,
          artifactPath: output.artifactPath,
          taskOutputDir: output.taskOutputDir,
          byteSize: 765432,
          format: 'gif',
          ffmpegExecutable: 'ffmpeg',
        };
      },
      compressVideo: async () => {
        throw new Error('video compression command is not configured for the native video GIF workflow contract');
      },
      convertVideo: async () => {
        throw new Error('video conversion command is not configured for the native video GIF workflow contract');
      },
      enhanceVideo: async () => {
        throw new Error('video enhancement command is not configured for the native video GIF workflow contract');
      },
      runAudioSmoke: async () => ({
        artifactUuid: 'native-audio-smoke',
        taskUuid: 'native-audio-smoke-task',
        sourceAssetUuid: '',
        artifactPath: createNativeTaskOutputArtifact('native-audio-smoke-task', 'native-audio-smoke.wav').artifactPath,
        taskOutputDir: createNativeTaskOutputArtifact('native-audio-smoke-task', 'native-audio-smoke.wav').taskOutputDir,
        byteSize: 1,
        format: 'wav',
        ffmpegExecutable: 'ffmpeg',
      }),
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    });
    const nativeVideoGifSourceFile = createTrustedLocalMediaFile(commons, 'D:/media/native-source.mp4');
    const nativeVideoGifWorkflowResult = await withImmediateTimers(async () =>
      processVideoGif({
        fileId: 'asset-source-native-video-gif',
        file: nativeVideoGifSourceFile,
        fps: '15',
        resolution: '480p',
        dither: true,
      }),
    );
    const nativeVideoGifWorkflowTasks = readScopedStoredArray(services, 'tasks');
    const nativeVideoGifWorkflowTask = nativeVideoGifWorkflowTasks.find(
      (task) => task.id === nativeVideoGifWorkflowResult.taskId,
    );
    const nativeVideoGifWorkflowAssets = readScopedStoredArray(services, 'assets');
    assertEqual(nativeVideoGifWorkflowResult.success, true, 'video GIF native workflow reports success');
    assertEqual(
      nativeVideoGifWorkflowCommands[0]?.kind,
      'import',
      'video GIF native workflow imports local media before generation',
    );
    assertEqual(
      nativeVideoGifWorkflowCommands[0]?.request?.sourcePath,
      'D:/media/native-source.mp4',
      'video GIF native workflow passes the trusted desktop source path to media import',
    );
    assertEqual(
      nativeVideoGifWorkflowCommands[1]?.kind,
      'gif',
      'video GIF native workflow generates GIF after import',
    );
    assertEqual(
      nativeVideoGifWorkflowCommands[1]?.request?.assetUuid,
      'native-gif-asset',
      'video GIF native workflow generates GIF by imported assetUuid',
    );
    assertEqual(
      nativeVideoGifWorkflowCommands[1]?.request?.fps,
      '15',
      'video GIF native workflow forwards the selected FPS',
    );
    assertEqual(
      nativeVideoGifWorkflowCommands[1]?.request?.resolution,
      '480p',
      'video GIF native workflow forwards the selected resolution',
    );
    assertEqual(
      nativeVideoGifWorkflowTask?.status,
      types.AUTOCUT_TASK_STATUS.completed,
      'video GIF native workflow completes the persisted task',
    );
    assertEqual(
      nativeVideoGifWorkflowTask?.gifUrl,
      'asset://localhost/D%3A%2Fautocut%2Fmedia%2Ftasks%2Fnative-gif-task%2Foutputs%2Fnative-gif-artifact.gif',
      'video GIF native workflow converts native artifact paths to safe asset URLs',
    );
    assertEqual(
      nativeVideoGifWorkflowAssets[0]?.type,
      'image',
      'video GIF native workflow stores the generated GIF as an image asset',
    );
    assertEqual(
      nativeVideoGifWorkflowAssets[0]?.size,
      765432,
      'video GIF native workflow stores the native artifact byte size on the generated asset',
    );
    assertEqual(
      nativeVideoGifWorkflowAssets[0]?.url,
      nativeVideoGifWorkflowTask?.gifUrl,
      'video GIF native workflow stores the safe asset URL on the generated asset',
    );
    services.resetAutoCutNativeHostClient();

    resetStorage();
    const nativeVideoSliceWorkflowCommands = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        contractVersion: 'contract-test',
        hostKind: 'native-host',
        databaseContractReady: true,
        sqliteMigrationReady: true,
        databaseHealthCommandReady: true,
        ffmpegProbeCommandReady: true,
        mediaImportCommandReady: true,
        mediaFileDescribeCommandReady: true,
          localVideoFileSelectCommandReady: true,
        audioExtractionCommandReady: false,
        audioExtractionFromAssetReady: false,
        videoGifCommandReady: false,
        videoSliceCommandReady: true,
        videoCompressCommandReady: false,
        videoConvertCommandReady: false,
        videoEnhanceCommandReady: false,
        speechTranscriptionCommandReady: true,
        speechTranscriptionToolchainReady: true,
        speechTranscriptionProbeCommandReady: true,
        speechTranscriptionFileSelectCommandReady: true,
        llmHttpCommandReady: false,
        llmSecretStoreReady: false,
        nativeTaskQueryCommandReady: true,
        nativeTaskCancelCommandReady: false,
        nativeTaskRecoveryCommandReady: false,
        nativeTaskRetryCommandReady: false,
        nativeTaskProgressEventsReady: false,
        nativeWorkerLeaseReady: true,
        ffmpegToolchainManifestReady: true,
        ffmpegToolchainResolverReady: true,
        ffmpegBundledReady: false,
        ffmpegExecutionReady: false,
        supportedCommands: ['autocut_import_media_file', 'autocut_transcribe_media', 'autocut_slice_video'],
      }),
      getDatabaseHealth: async () => ({
        ready: true,
        databasePath: 'memory',
        appliedMigrations: ['baseline'],
        verifiedTables: ['media_asset'],
        missingTables: [],
        diagnostics: [],
      }),
      probeFfmpeg: async () => ({
        available: true,
        executable: 'ffmpeg',
        sourceKind: 'system-path',
        manifestReady: true,
        bundledReady: false,
        versionLine: 'ffmpeg contract',
        diagnostics: [],
      }),
      importMediaFile: async (request) => {
        nativeVideoSliceWorkflowCommands.push({ kind: 'import', request });
        return {
          assetUuid: 'native-slice-asset',
          sandboxPath: 'D:/autocut-configured-output/inputs/native-slice-asset.mp4',
          byteSize: 654000,
          name: 'native-source.mp4',
          mediaType: 'video',
          mimeType: 'video/mp4',
          durationMs: 100000,
        };
      },
      describeLocalMediaFile: async (request) => ({
        sourcePath: request.sourcePath,
        byteSize: 654000,
        name: 'native-source.mp4',
        mediaType: 'video',
        mimeType: 'video/mp4',
      }),
      extractAudio: async () => {
        throw new Error('audio extraction is not configured for the native video slice workflow contract');
      },
      generateGif: async () => {
        throw new Error('video GIF command is not configured for the native video slice workflow contract');
      },
      probeSpeechTranscription: async (request) => ({
        ready: true,
        executablePath: request.executablePath,
        modelPath: request.modelPath,
        sourceKind: request.sourceKind ?? 'execution-preflight',
        diagnostics: [],
        versionLine: 'native video slice workflow contract',
      }),
      selectSpeechTranscriptionFile: async () => null,
      transcribeMedia: async (request) => {
        nativeVideoSliceWorkflowCommands.push({ kind: 'transcribe', request });
        const output = createNativeTaskOutputArtifact(
          'native-slice-transcript-task',
          'native-slice-transcript.json',
          configuredOutputDirectory,
        );
        return {
          artifactUuid: 'native-slice-transcript-artifact',
          taskUuid: 'native-slice-transcript-task',
          sourceAssetUuid: request.assetUuid,
          transcriptPath: output.artifactPath,
          taskOutputDir: output.taskOutputDir,
          language: request.language ?? 'auto',
          text:
            'Why viewers scroll is simple. Because the opening hides the problem, people do not know why they should care. So lead with the result and the retention payoff works. What fixes weak conversion is clear. The case shows pricing pain before users choose annual plans. So show the solution and the final answer improves signups.',
          segments: [
            {
              startMs: 22000,
              endMs: 41000,
              text:
                'Why viewers scroll is simple. Because the opening hides the problem, people do not know why they should care. So lead with the result and the retention payoff works.',
              speaker: 'Speaker 1',
            },
            {
              startMs: 72000,
              endMs: 93000,
              text:
                'What fixes weak conversion is clear. The case shows pricing pain before users choose annual plans. So show the solution and the final answer improves signups.',
              speaker: 'Speaker 1',
            },
          ],
          ffmpegExecutable: 'ffmpeg',
          speechExecutable: 'whisper-cli',
        };
      },
      sliceVideo: async (request) => {
        nativeVideoSliceWorkflowCommands.push({ kind: 'slice', request });
        const firstOutput = createNativeTaskOutputArtifact(
          'native-slice-task',
          request.clips[0]?.outputFileName ?? 'native-slice-artifact-1.mp4',
          configuredOutputDirectory,
        );
        const secondOutput = createNativeTaskOutputArtifact(
          'native-slice-task',
          request.clips[1]?.outputFileName ?? 'native-slice-artifact-2.mp4',
          configuredOutputDirectory,
        );
        const firstThumbnail = createNativeTaskCoverArtifact(
          'native-slice-task',
          'native-slice-thumb-1.jpg',
          configuredOutputDirectory,
        );
        const secondThumbnail = createNativeTaskCoverArtifact(
          'native-slice-task',
          'native-slice-thumb-2.jpg',
          configuredOutputDirectory,
        );
        const firstSubtitle = createNativeTaskOutputArtifact(
          'native-slice-task',
          'native-slice-subtitle-1.srt',
          configuredOutputDirectory,
        );
        const secondSubtitle = createNativeTaskOutputArtifact(
          'native-slice-task',
          'native-slice-subtitle-2.srt',
          configuredOutputDirectory,
        );
        const subtitlesRequested = Array.isArray(request.subtitleSegments) && request.subtitleSegments.length > 0;
        return {
          taskUuid: 'native-slice-task',
          sourceAssetUuid: request.assetUuid,
          taskOutputDir: firstOutput.taskOutputDir,
          ffmpegExecutable: 'ffmpeg',
          slices: [
            {
              artifactUuid: 'native-slice-artifact-1',
              artifactPath: firstOutput.artifactPath,
              thumbnailArtifactUuid: 'native-slice-thumb-1',
              thumbnailArtifactPath: firstThumbnail.artifactPath,
              taskOutputDir: firstOutput.taskOutputDir,
              byteSize: 234567,
              thumbnailByteSize: 12345,
              ...(subtitlesRequested
                ? {
                    subtitleArtifactUuid: 'native-slice-subtitle-1',
                    subtitleArtifactPath: firstSubtitle.artifactPath,
                    subtitleByteSize: 1234,
                    subtitleFormat: 'srt',
                  }
                : {}),
              format: 'mp4',
              startMs: request.clips[0].startMs,
              durationMs: request.clips[0].durationMs,
              label: request.clips[0].label,
              sourceStartMs: request.clips[0].sourceStartMs,
              sourceEndMs: request.clips[0].sourceEndMs,
              speechStartMs: request.clips[0].speechStartMs,
              speechEndMs: request.clips[0].speechEndMs,
              boundaryPaddingBeforeMs: request.clips[0].boundaryPaddingBeforeMs,
              boundaryPaddingAfterMs: request.clips[0].boundaryPaddingAfterMs,
              transcriptText: request.clips[0].transcriptText,
              transcriptSegments: request.clips[0].transcriptSegments,
              transcriptSegmentCount: request.clips[0].transcriptSegmentCount,
              transcriptCoverageScore: request.clips[0].transcriptCoverageScore,
              speechContinuityGrade: request.clips[0].speechContinuityGrade,
            },
            {
              artifactUuid: 'native-slice-artifact-2',
              artifactPath: secondOutput.artifactPath,
              thumbnailArtifactUuid: 'native-slice-thumb-2',
              thumbnailArtifactPath: secondThumbnail.artifactPath,
              taskOutputDir: secondOutput.taskOutputDir,
              byteSize: 345678,
              thumbnailByteSize: 23456,
              ...(subtitlesRequested
                ? {
                    subtitleArtifactUuid: 'native-slice-subtitle-2',
                    subtitleArtifactPath: secondSubtitle.artifactPath,
                    subtitleByteSize: 2345,
                    subtitleFormat: 'srt',
                  }
                : {}),
              format: 'mp4',
              startMs: request.clips[1].startMs,
              durationMs: request.clips[1].durationMs,
              label: request.clips[1].label,
              sourceStartMs: request.clips[1].sourceStartMs,
              sourceEndMs: request.clips[1].sourceEndMs,
              speechStartMs: request.clips[1].speechStartMs,
              speechEndMs: request.clips[1].speechEndMs,
              boundaryPaddingBeforeMs: request.clips[1].boundaryPaddingBeforeMs,
              boundaryPaddingAfterMs: request.clips[1].boundaryPaddingAfterMs,
              transcriptText: request.clips[1].transcriptText,
              transcriptSegments: request.clips[1].transcriptSegments,
              transcriptSegmentCount: request.clips[1].transcriptSegmentCount,
              transcriptCoverageScore: request.clips[1].transcriptCoverageScore,
              speechContinuityGrade: request.clips[1].speechContinuityGrade,
            },
          ],
        };
      },
      compressVideo: async () => {
        throw new Error('video compression command is not configured for the native video slice workflow contract');
      },
      convertVideo: async () => {
        throw new Error('video conversion command is not configured for the native video slice workflow contract');
      },
      enhanceVideo: async () => {
        throw new Error('video enhancement command is not configured for the native video slice workflow contract');
      },
      sendLlmHttpRequest: async () => {
        throw new Error('LLM HTTP is not configured for the native video slice workflow contract');
      },
      saveLlmSecret: async (request) => ({
        secretName: request.secretName,
        saved: false,
      }),
      getLlmSecret: async (request) => ({
        secretName: request.secretName,
        configured: false,
      }),
      deleteLlmSecret: async (request) => ({
        secretName: request.secretName,
        deleted: false,
      }),
      listNativeTasks: async () => [],
      cancelNativeTask: async (request) => ({
        taskUuid: request.taskUuid,
        status: 0,
        canceled: false,
        message: 'not configured',
      }),
      recoverNativeTasks: async () => ({
        inspected: 0,
        recovered: 0,
        interrupted: 0,
        canceled: 0,
        expiredLeases: 0,
        deferred: 0,
        taskUuids: [],
      }),
      retryNativeTask: async (request) => ({
        taskUuid: request.taskUuid,
        retryTaskUuid: '',
        status: 0,
        retried: false,
        message: 'not configured',
      }),
      runAudioSmoke: async () => ({
        artifactUuid: 'native-audio-smoke',
        taskUuid: 'native-audio-smoke-task',
        sourceAssetUuid: '',
        artifactPath: createNativeTaskOutputArtifact('native-audio-smoke-task', 'native-audio-smoke.wav').artifactPath,
        taskOutputDir: createNativeTaskOutputArtifact('native-audio-smoke-task', 'native-audio-smoke.wav').taskOutputDir,
        byteSize: 1,
        format: 'wav',
        ffmpegExecutable: 'ffmpeg',
      }),
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    });
    await services.saveAutoCutWorkspaceSettings({
      ...(await services.getAutoCutSettings()).workspace,
      outputDirectory: configuredOutputDirectory,
    });
    await saveVerifiedLocalSpeechTranscriptionSettings(services);
    const nativeVideoSliceSourceFile = createTrustedLocalMediaFile(commons, 'D:/media/native-source.mp4');
    const nativeVideoSliceWorkflowTaskUpdates = captureEvents(services, 'taskUpdated');
    let nativeVideoSliceWorkflowResult;
    const nativeVideoSliceWorkflowDiagnostics = await captureConsoleDiagnosticsAsync(async () => {
      nativeVideoSliceWorkflowResult = await withImmediateTimers(async () =>
        processVideoSlice({
          fileId: 'asset-source-native-video-slice',
          file: nativeVideoSliceSourceFile,
          mode: 'contract-mode',
          llmModel: 'gemini-3-flash-preview',
          minDuration: 15,
          maxDuration: 60,
          baseAlgorithm: 'scene',
              highlightEngine: 'emotion',
              enableNoiseReduction: true,
              enableCoughFilter: true,
              enableRepeatFilter: true,
              enableSubtitles: false,
            }),
          );
    });
    nativeVideoSliceWorkflowTaskUpdates.stop();
    const nativeVideoSliceWorkflowTasks = readScopedStoredArray(services, 'tasks');
    const nativeVideoSliceWorkflowTask = nativeVideoSliceWorkflowTasks.find(
      (task) => task.id === nativeVideoSliceWorkflowResult.taskId,
    );
    const nativeVideoSliceWorkflowAssets = readScopedStoredArray(services, 'assets');
    const nativeVideoSliceGeneratedAssets = nativeVideoSliceWorkflowAssets.filter(
      (asset) => asset.sourceTaskId === nativeVideoSliceWorkflowResult.taskId,
    );
    const nativeVideoSliceFirstAsset = nativeVideoSliceGeneratedAssets.find(
      (asset) => asset.id === nativeVideoSliceWorkflowTask?.sliceResults?.[0]?.id,
    );
    assertEqual(nativeVideoSliceWorkflowResult.success, true, 'video slice native workflow reports success');
    assertEqual(
      nativeVideoSliceWorkflowResult.taskId,
      'native-slice-task',
      'video slice native workflow returns the durable native ops_task UUID instead of a temporary browser task id',
    );
    const nativeVideoSliceWorkflowProgressValues = nativeVideoSliceWorkflowTaskUpdates.details
      .map((task) => task?.progress)
      .filter((progress) => typeof progress === 'number');
    const nativeVideoSliceWorkflowProgressRegressionIndex = nativeVideoSliceWorkflowProgressValues.findIndex(
      (progress, index) => index > 0 && progress < nativeVideoSliceWorkflowProgressValues[index - 1],
    );
    assertRule(
      nativeVideoSliceWorkflowProgressRegressionIndex === -1,
      `video slice native workflow reports monotonic Smart Slice progress updates (${JSON.stringify(nativeVideoSliceWorkflowProgressValues)})`,
    );
    assertRule(
      !nativeVideoSliceWorkflowProgressValues.includes(35),
      'video slice native workflow never reports the obsolete sticky 35 percent speech-to-text progress',
    );
    assertEqual(
      nativeVideoSliceWorkflowProgressValues.at(-1),
      100,
      'video slice native workflow emits a final 100 percent completed task update',
    );
    assertRule(
      nativeVideoSliceWorkflowDiagnostics.some((call) =>
        call.level === 'info' &&
        String(call.args?.[0] ?? '').includes('Smart Slice execution plan')
      ),
      'video slice native workflow logs the full Smart Slice execution plan to the console',
    );
    for (const stepId of [
      'prepare-source',
      'speech-to-text',
      'plan-clips',
      'native-render',
      'verify-artifacts',
      'persist-results',
    ]) {
      assertRule(
        nativeVideoSliceWorkflowDiagnostics.some((call) =>
          call.level === 'info' &&
          String(call.args?.[0] ?? '').includes(`Smart Slice ${stepId} started`)
        ),
        `video slice native workflow logs Smart Slice ${stepId} start to the console`,
      );
      assertRule(
        nativeVideoSliceWorkflowDiagnostics.some((call) =>
          call.level === 'info' &&
          String(call.args?.[0] ?? '').includes(`Smart Slice ${stepId} completed`)
        ),
        `video slice native workflow logs Smart Slice ${stepId} completion to the console`,
      );
    }
    assertEqual(
      nativeVideoSliceWorkflowCommands[0]?.kind,
      'import',
      'video slice native workflow imports local media before slicing',
    );
    assertEqual(
      nativeVideoSliceWorkflowCommands[0]?.request?.sourcePath,
      'D:/media/native-source.mp4',
      'video slice native workflow passes the trusted desktop source path to media import',
    );
    assertEqual(
      nativeVideoSliceWorkflowCommands[0]?.request?.outputRootDir,
      configuredOutputDirectory,
      'video slice native workflow passes the configured output directory to media import',
    );
    assertEqual(
      nativeVideoSliceWorkflowCommands[1]?.kind,
      'transcribe',
      'video slice native workflow transcribes local media before slicing when local speech toolchain is ready',
    );
    assertEqual(
      nativeVideoSliceWorkflowCommands[1]?.request?.assetUuid,
      'native-slice-asset',
      'video slice native workflow transcribes by imported assetUuid',
    );
    assertEqual(
      nativeVideoSliceWorkflowCommands[1]?.request?.outputRootDir,
      configuredOutputDirectory,
      'video slice native workflow passes the configured output directory to speech transcription',
    );
    assertEqual(
      nativeVideoSliceWorkflowCommands[1]?.request?.executablePath,
      'D:/tools/whisper-cli.exe',
      'video slice native workflow passes the configured local speech executable to transcription',
    );
    assertEqual(
      nativeVideoSliceWorkflowCommands[1]?.request?.modelPath,
      'D:/models/ggml-large-v3-turbo.bin',
      'video slice native workflow passes the configured local speech model to transcription',
    );
    assertEqual(
      nativeVideoSliceWorkflowCommands[2]?.kind,
      'slice',
      'video slice native workflow slices video after import',
    );
    assertEqual(
      nativeVideoSliceWorkflowCommands[2]?.request?.assetUuid,
      'native-slice-asset',
      'video slice native workflow slices by imported assetUuid',
    );
    assertEqual(
      nativeVideoSliceWorkflowCommands[2]?.request?.outputRootDir,
      configuredOutputDirectory,
      'video slice native workflow passes the configured output directory to video slicing',
    );
    assertEqual(
      nativeVideoSliceWorkflowCommands[2]?.request?.outputFormat,
      'mp4',
      'video slice native workflow requests MP4 slice output',
    );
    assertRule(
      nativeVideoSliceWorkflowCommands[2]?.request?.clips?.every((clip) =>
        clip.startMs + clip.durationMs <= 100000,
      ),
      'video slice native workflow keeps planned clips inside imported media duration before native rendering',
    );
    assertEqual(
      nativeVideoSliceWorkflowCommands[2]?.request?.subtitleFormat,
      undefined,
      'video slice native workflow omits subtitle output by default while still using speech-to-text for planning',
    );
    assertEqual(
      nativeVideoSliceWorkflowCommands[2]?.request?.subtitleMode,
      undefined,
      'video slice native workflow does not burn or write subtitles unless the user enables subtitles',
    );
    assertEqual(
      nativeVideoSliceWorkflowCommands[2]?.request?.subtitleStyleId,
      undefined,
      'video slice native workflow omits subtitle style when no subtitle style was selected',
    );
    assertEqual(
      nativeVideoSliceWorkflowCommands[2]?.request?.subtitleSegments,
      undefined,
      'video slice native workflow keeps transcript segments out of native subtitle rendering when subtitles are disabled',
    );
    assertEqual(
      nativeVideoSliceWorkflowCommands[2]?.request?.clips?.[0]?.transcriptText,
      'Why viewers scroll is simple. Because the opening hides the problem, people do not know why they should care. So lead with the result and the retention payoff works.',
      'video slice native workflow embeds slice transcript text in each native clip request independent of subtitle rendering',
    );
    assertEqual(
      nativeVideoSliceWorkflowCommands[2]?.request?.clips?.[0]?.transcriptSegments?.[0]?.text,
      'Why viewers scroll is simple. Because the opening hides the problem, people do not know why they should care. So lead with the result and the retention payoff works.',
      'video slice native workflow embeds structured slice transcript segments in each native clip request',
    );
    assertEqual(
      nativeVideoSliceWorkflowCommands[2]?.request?.clips?.[0]?.transcriptSegmentCount,
      1,
      'video slice native workflow embeds transcript segment counts in each native clip request',
    );
    assertEqual(
      nativeVideoSliceWorkflowCommands[2]?.request?.noiseReduction,
      true,
      'video slice native workflow forwards the user-selected audio noise reduction setting to native rendering',
    );
    assertEqual(
      nativeVideoSliceWorkflowCommands[2]?.request?.clips?.[0]?.speechStartMs,
      22000,
      'video slice native workflow embeds unpadded speech start in each native clip request',
    );
    assertEqual(
      nativeVideoSliceWorkflowCommands[2]?.request?.clips?.[0]?.boundaryPaddingBeforeMs,
      200,
      'video slice native workflow embeds professional leading silence padding in each native clip request',
    );
    assertEqual(
      nativeVideoSliceWorkflowTask?.sliceResults?.[0]?.transcriptText,
      'Why viewers scroll is simple. Because the opening hides the problem, people do not know why they should care. So lead with the result and the retention payoff works.',
      'video slice native workflow still exposes speech-to-text transcript text on each generated slice when subtitles are disabled',
    );
    assertEqual(
      nativeVideoSliceWorkflowTask?.sliceResults?.[0]?.transcriptSegments?.[0]?.text,
      'Why viewers scroll is simple. Because the opening hides the problem, people do not know why they should care. So lead with the result and the retention payoff works.',
      'video slice native workflow records slice-level structured transcript segments when subtitles are disabled',
    );

    resetStorage();
    await services.saveAutoCutWorkspaceSettings({
      ...(await services.getAutoCutSettings()).workspace,
      outputDirectory: configuredOutputDirectory,
    });
    await saveVerifiedLocalSpeechTranscriptionSettings(services);
    const noiseCleanupSliceCommands = [];
    const noiseCleanupBridgeRequests = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        mediaImportCommandReady: true,
        videoSliceCommandReady: true,
        speechTranscriptionCommandReady: true,
        speechTranscriptionToolchainReady: true,
        speechTranscriptionProbeCommandReady: true,
        nativeTaskQueryCommandReady: true,
      }),
      importMediaFile: async (request) => {
        noiseCleanupSliceCommands.push({ kind: 'import', request });
        return {
          assetUuid: 'noise-cleanup-slice-asset',
          sandboxPath: 'D:/autocut-configured-output/inputs/noise-cleanup-source.mp4',
          byteSize: 654000,
          name: 'noise-cleanup-source.mp4',
          mediaType: 'video',
          mimeType: 'video/mp4',
          durationMs: 40_000,
        };
      },
      probeSpeechTranscription: async (request) => ({
        ready: true,
        executablePath: request.executablePath,
        modelPath: request.modelPath,
        sourceKind: request.sourceKind ?? 'execution-preflight',
        diagnostics: [],
        versionLine: 'noise cleanup smart slice contract',
      }),
      transcribeMedia: async (request) => {
        noiseCleanupSliceCommands.push({ kind: 'transcribe', request });
        return createNativeVideoSliceTranscriptResult(
          request,
          'noise-cleanup-transcript-task',
          configuredOutputDirectory,
          [
            {
              startMs: 0,
              endMs: 8_000,
              text: 'um, Watch the setup because activation pain matters.',
              speaker: 'Speaker 1',
            },
            {
              startMs: 8_100,
              endMs: 8_900,
              text: '[coughing]',
              speaker: 'Speaker 1',
            },
            {
              startMs: 9_000,
              endMs: 9_800,
              text: '[Music]',
              speaker: 'Speaker 1',
            },
            {
              startMs: 10_000,
              endMs: 25_000,
              text: 'So the complete payoff is the activation fix viewers can apply.',
              speaker: 'Speaker 1',
            },
          ],
        );
      },
      sliceVideo: async (request) => {
        noiseCleanupSliceCommands.push({ kind: 'slice', request });
        const output = createNativeTaskOutputArtifact(
          'noise-cleanup-slice-task',
          request.clips[0]?.outputFileName ?? 'noise-cleanup-slice.mp4',
          configuredOutputDirectory,
        );
        const thumbnail = createNativeTaskCoverArtifact(
          'noise-cleanup-slice-task',
          'noise-cleanup-thumb.jpg',
          configuredOutputDirectory,
        );
        const subtitle = createNativeTaskOutputArtifact(
          'noise-cleanup-slice-task',
          'noise-cleanup-subtitle.srt',
          configuredOutputDirectory,
        );
        const clip = request.clips[0];
        return {
          taskUuid: 'noise-cleanup-slice-task',
          sourceAssetUuid: request.assetUuid,
          taskOutputDir: output.taskOutputDir,
          ffmpegExecutable: 'ffmpeg',
          slices: [
            {
              artifactUuid: 'noise-cleanup-slice-artifact',
              artifactPath: output.artifactPath,
              thumbnailArtifactUuid: 'noise-cleanup-thumb',
              thumbnailArtifactPath: thumbnail.artifactPath,
              taskOutputDir: output.taskOutputDir,
              byteSize: 234567,
              thumbnailByteSize: 12345,
              ...(request.subtitleFormat === 'srt'
                ? {
                    subtitleArtifactUuid: 'noise-cleanup-subtitle',
                    subtitleArtifactPath: subtitle.artifactPath,
                    subtitleByteSize: 1234,
                    subtitleFormat: 'srt',
                  }
                : {}),
              format: 'mp4',
              startMs: clip.startMs,
              durationMs: clip.durationMs,
              label: clip.label,
              sourceStartMs: clip.sourceStartMs,
              sourceEndMs: clip.sourceEndMs,
              speechStartMs: clip.speechStartMs,
              speechEndMs: clip.speechEndMs,
              boundaryPaddingBeforeMs: clip.boundaryPaddingBeforeMs,
              boundaryPaddingAfterMs: clip.boundaryPaddingAfterMs,
              transcriptText: clip.transcriptText,
              transcriptSegments: clip.transcriptSegments,
              transcriptSegmentCount: clip.transcriptSegmentCount,
              transcriptCoverageScore: clip.transcriptCoverageScore,
              speechContinuityGrade: clip.speechContinuityGrade,
            },
          ],
        };
      },
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    });
    await services.saveAutoCutLlmSettings({
      ...(await services.getAutoCutSettings()).llm,
      modelVendor: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: 'gemini-3-flash-preview',
      apiKey: 'sk-noise-cleanup-plan',
    });
    services.configureAutoCutApprovedAiSdkBridge({
      async createChatCompletion(request, runtime) {
        noiseCleanupBridgeRequests.push({ request, runtime });
        const prompt = JSON.parse(request.messages?.[1]?.content ?? '{}');
        const selectedCandidate = prompt.candidateWindows?.[0];
        return {
          id: 'noise-cleanup-plan',
          model: request.model,
          content: JSON.stringify([
            {
              candidateId: selectedCandidate?.id,
              title: 'Clean activation payoff',
              qualityScore: 0.9,
              continuityScore: 0.9,
            },
          ]),
          runtime,
        };
      },
    });
    const noiseCleanupSourceFile = createTrustedLocalMediaFile(
      commons,
      'D:/media/noise-cleanup-source.mp4',
      'noise-cleanup-source.mp4',
    );
    const noiseCleanupResult = await withImmediateTimers(async () =>
      processVideoSlice({
        fileId: 'asset-source-noise-cleanup-slice',
        file: noiseCleanupSourceFile,
        mode: 'contract-mode',
        llmModel: 'gemini-3-flash-preview',
        targetPlatform: 'generic',
        sliceCountMode: 'qualityFirst',
        targetSliceCount: 1,
        continuityLevel: 'standard',
        minDuration: 15,
        maxDuration: 45,
        baseAlgorithm: 'scene',
        highlightEngine: 'keyword',
        customKeywords: ['activation', 'payoff'],
        enableNoiseReduction: true,
        enableCoughFilter: false,
        enableRepeatFilter: true,
        enableSubtitles: true,
        subtitleMode: 'srt',
      }),
    );
    services.resetAutoCutNativeHostClient();
    const noiseCleanupPrompt = JSON.parse(
      noiseCleanupBridgeRequests[0]?.request?.messages?.[1]?.content ?? '{}',
    );
    const noiseCleanupSliceRequest = noiseCleanupSliceCommands.find((entry) => entry.kind === 'slice')?.request;
    const noiseCleanupClip = noiseCleanupSliceRequest?.clips?.[0];
    const noiseCleanupTask = readScopedStoredArray(services, 'tasks').find((task) => task.id === noiseCleanupResult.taskId);
    assertEqual(
      noiseCleanupResult.success,
      true,
      'noise cleanup Smart Slice regression reports success',
    );
    assertRule(
      noiseCleanupPrompt?.transcriptTimeline?.every((segment) =>
        segment.text &&
          !/\b(?:coughing|music)\b|^\s*um\b/iu.test(segment.text)
      ),
      'noise cleanup Smart Slice regression sends only cleaned transcript timeline text to the LLM planner',
    );
    assertRule(
      !/\b(?:coughing|music)\b|^\s*um\b/iu.test(noiseCleanupClip?.transcriptText ?? ''),
      'noise cleanup Smart Slice regression removes noise and edge filler from native clip transcript text',
    );
    assertRule(
      noiseCleanupClip?.transcriptSegments?.length === 2 &&
        noiseCleanupClip.transcriptSegments.every((segment) =>
          !/\b(?:coughing|music)\b|^\s*um\b/iu.test(segment.text)
        ),
      'noise cleanup Smart Slice regression removes noise and edge filler from structured native clip transcript segments',
    );
    assertEqual(
      noiseCleanupClip?.audioMuteRanges,
      undefined,
      'noise cleanup Smart Slice regression respects the disabled cough and noise removal toggle for native audio muting',
    );
    assertRule(
      noiseCleanupSliceRequest?.subtitleSegments?.length === 2 &&
        noiseCleanupSliceRequest.subtitleSegments.every((segment) =>
          !/\b(?:coughing|music)\b|^\s*um\b/iu.test(segment.text)
        ),
      'noise cleanup Smart Slice regression removes noise and edge filler from native subtitle rendering input',
    );
    assertRule(
      noiseCleanupTask?.sliceResults?.every((sliceResult) =>
        !/\b(?:coughing|music)\b|^\s*um\b/iu.test(sliceResult.transcriptText ?? '')
      ),
      'noise cleanup Smart Slice regression exposes clean transcript evidence in completed task results',
    );
    services.configureAutoCutApprovedAiSdkBridge(null);

    resetStorage();
    await services.saveAutoCutWorkspaceSettings({
      ...(await services.getAutoCutSettings()).workspace,
      outputDirectory: configuredOutputDirectory,
    });
    await saveVerifiedLocalSpeechTranscriptionSettings(services);
    const existingAssetVideoSliceCommands = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        mediaImportCommandReady: true,
        videoSliceCommandReady: true,
        speechTranscriptionCommandReady: true,
        speechTranscriptionToolchainReady: true,
        speechTranscriptionProbeCommandReady: true,
        nativeTaskQueryCommandReady: true,
      }),
      importMediaFile: async (request) => {
        existingAssetVideoSliceCommands.push({ kind: 'import', request });
        throw new Error('existing native asset smart slice must not import media again');
      },
      probeSpeechTranscription: async (request) => ({
        ready: true,
        executablePath: request.executablePath,
        modelPath: request.modelPath,
        sourceKind: request.sourceKind ?? 'execution-preflight',
        diagnostics: [],
        versionLine: 'existing asset smart slice contract',
      }),
      transcribeMedia: async (request) => {
        existingAssetVideoSliceCommands.push({ kind: 'transcribe', request });
        return createNativeVideoSliceTranscriptResult(
          request,
          'existing-asset-transcript-task',
          configuredOutputDirectory,
          [
            {
              startMs: 22_000,
              endMs: 41_000,
              text:
                'Why viewers scroll is simple. Because the opening hides the problem, people do not know why they should care. So lead with the result and the retention payoff works.',
              speaker: 'Speaker 1',
            },
            {
              startMs: 72_000,
              endMs: 93_000,
              text:
                'What fixes weak conversion is clear. The case shows pricing pain before users choose annual plans. So show the solution and the final answer improves signups.',
              speaker: 'Speaker 1',
            },
          ],
        );
      },
      sliceVideo: async (request) => {
        existingAssetVideoSliceCommands.push({ kind: 'slice', request });
        return {
          taskUuid: 'existing-asset-slice-task',
          sourceAssetUuid: request.assetUuid,
          taskOutputDir: createNativeTaskOutputArtifact(
            'existing-asset-slice-task',
            request.clips[0]?.outputFileName ?? 'existing-asset-slice-1.mp4',
            configuredOutputDirectory,
          ).taskOutputDir,
          ffmpegExecutable: 'ffmpeg',
          slices: request.clips.map((clip, index) => {
            const output = createNativeTaskOutputArtifact(
              'existing-asset-slice-task',
              clip.outputFileName ?? `existing-asset-slice-${index + 1}.mp4`,
              configuredOutputDirectory,
            );
            const thumbnail = createNativeTaskCoverArtifact(
              'existing-asset-slice-task',
              `existing-asset-slice-thumb-${index + 1}.jpg`,
              configuredOutputDirectory,
            );
            return {
              artifactUuid: `existing-asset-slice-artifact-${index + 1}`,
              artifactPath: output.artifactPath,
              thumbnailArtifactUuid: `existing-asset-slice-thumb-${index + 1}`,
              thumbnailArtifactPath: thumbnail.artifactPath,
              taskOutputDir: output.taskOutputDir,
              byteSize: 456789 + index,
              thumbnailByteSize: 34567 + index,
              format: 'mp4',
              startMs: clip.startMs,
              durationMs: clip.durationMs,
              label: clip.label,
              sourceStartMs: clip.sourceStartMs,
              sourceEndMs: clip.sourceEndMs,
              speechStartMs: clip.speechStartMs,
              speechEndMs: clip.speechEndMs,
              boundaryPaddingBeforeMs: clip.boundaryPaddingBeforeMs,
              boundaryPaddingAfterMs: clip.boundaryPaddingAfterMs,
              transcriptText: clip.transcriptText,
              transcriptSegments: clip.transcriptSegments,
              transcriptSegmentCount: clip.transcriptSegmentCount,
              transcriptCoverageScore: clip.transcriptCoverageScore,
              speechContinuityGrade: clip.speechContinuityGrade,
            };
          }),
        };
      },
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    });
    const existingAssetVideoSliceResult = await withImmediateTimers(async () =>
      processVideoSlice({
        fileId: 'media-asset-existing-smart-slice-source',
        sourceDurationMs: 100_000,
        mode: 'contract-mode',
        llmModel: 'gemini-3-flash-preview',
        minDuration: 15,
        maxDuration: 60,
        baseAlgorithm: 'scene',
        highlightEngine: 'emotion',
        enableNoiseReduction: true,
        enableCoughFilter: true,
        enableRepeatFilter: true,
        enableSubtitles: false,
      }),
    );
    const existingAssetVideoSliceTask = readScopedStoredArray(services, 'tasks').find(
      (task) => task.id === existingAssetVideoSliceResult.taskId,
    );
    assertEqual(
      existingAssetVideoSliceResult.success,
      true,
      'existing native asset smart slice rerun reports success after rebuilding transcript evidence',
    );
    assertEqual(
      existingAssetVideoSliceCommands.some((entry) => entry.kind === 'import'),
      false,
      'existing native asset smart slice rerun does not import an already registered native asset',
    );
    assertEqual(
      existingAssetVideoSliceCommands[0]?.kind,
      'transcribe',
      'existing native asset smart slice rerun transcribes before planning and rendering',
    );
    assertEqual(
      existingAssetVideoSliceCommands[0]?.request?.assetUuid,
      'media-asset-existing-smart-slice-source',
      'existing native asset smart slice rerun transcribes the selected native asset UUID',
    );
    assertEqual(
      existingAssetVideoSliceCommands[1]?.kind,
      'slice',
      'existing native asset smart slice rerun renders only after verified transcript planning',
    );
    assertEqual(
      existingAssetVideoSliceCommands[1]?.request?.assetUuid,
      'media-asset-existing-smart-slice-source',
      'existing native asset smart slice rerun slices the selected native asset UUID',
    );
    assertRule(
      existingAssetVideoSliceCommands[1]?.request?.clips?.every((clip) =>
        clip.transcriptText?.trim() &&
          clip.transcriptSegments?.length &&
          clip.transcriptSegmentCount === clip.transcriptSegments.length
      ),
      'existing native asset smart slice rerun sends verified transcript evidence on every native clip request',
    );
    assertEqual(
      existingAssetVideoSliceTask?.sourceFileId,
      'media-asset-existing-smart-slice-source',
      'existing native asset smart slice rerun stores the selected asset UUID as task sourceFileId',
    );
    assertRule(
      existingAssetVideoSliceTask?.sliceResults?.every((sliceResult) =>
        sliceResult.transcriptText?.trim() && sliceResult.transcriptSegments?.length
      ),
      'existing native asset smart slice rerun exposes verified transcript evidence on every generated slice',
    );

    resetStorage();
    await services.saveAutoCutWorkspaceSettings({
      ...(await services.getAutoCutSettings()).workspace,
      outputDirectory: configuredOutputDirectory,
    });
    await saveVerifiedLocalSpeechTranscriptionSettings(services);
    const overlappingTranscriptSliceCommands = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        mediaImportCommandReady: true,
        videoSliceCommandReady: true,
        speechTranscriptionCommandReady: true,
        speechTranscriptionToolchainReady: true,
        speechTranscriptionProbeCommandReady: true,
        nativeTaskQueryCommandReady: true,
      }),
      importMediaFile: async (request) => {
        overlappingTranscriptSliceCommands.push({ kind: 'import', request });
        return {
          assetUuid: 'overlap-repair-slice-asset',
          sandboxPath: 'D:/autocut-configured-output/inputs/overlap-repair-slice-asset.mp4',
          byteSize: 654000,
          name: 'overlap-repair-source.mp4',
          mediaType: 'video',
          mimeType: 'video/mp4',
          durationMs: 60000,
        };
      },
      transcribeMedia: async (request) => {
        overlappingTranscriptSliceCommands.push({ kind: 'transcribe', request });
        return createNativeVideoSliceTranscriptResult(
          request,
          'overlap-repair-transcript-task',
          configuredOutputDirectory,
          [
            {
              startMs: 10000,
              endMs: 25000,
              text: 'Why overlap repair matters is simple. Because speech-to-text segments can overlap, the transcript must stay ordered.',
              speaker: 'Speaker 1',
            },
            {
              startMs: 24960,
              endMs: 41000,
              text: 'So trim the second segment boundary and the smart slice remains publishable.',
              speaker: 'Speaker 1',
            },
          ],
        );
      },
      probeSpeechTranscription: async (request) => ({
        ready: true,
        executablePath: request.executablePath,
        modelPath: request.modelPath,
        sourceKind: request.sourceKind ?? 'execution-preflight',
        diagnostics: [],
        versionLine: 'overlap repair speech preflight contract',
      }),
      sliceVideo: async (request) => {
        overlappingTranscriptSliceCommands.push({ kind: 'slice', request });
        const output = createNativeTaskOutputArtifact(
          'overlap-repair-slice-task',
          request.clips[0]?.outputFileName ?? 'overlap-repair-slice-1.mp4',
          configuredOutputDirectory,
        );
        const thumbnail = createNativeTaskCoverArtifact(
          'overlap-repair-slice-task',
          'overlap-repair-slice-1.jpg',
          configuredOutputDirectory,
        );
        return {
          taskUuid: 'overlap-repair-slice-task',
          sourceAssetUuid: request.assetUuid,
          taskOutputDir: output.taskOutputDir,
          ffmpegExecutable: 'ffmpeg',
          slices: [
            {
              artifactUuid: 'overlap-repair-slice-artifact-1',
              artifactPath: output.artifactPath,
              thumbnailArtifactUuid: 'overlap-repair-slice-thumb-1',
              thumbnailArtifactPath: thumbnail.artifactPath,
              taskOutputDir: output.taskOutputDir,
              byteSize: 234567,
              thumbnailByteSize: 12345,
              format: 'mp4',
              startMs: request.clips[0].startMs,
              durationMs: request.clips[0].durationMs,
              label: request.clips[0].label,
              sourceStartMs: request.clips[0].sourceStartMs,
              sourceEndMs: request.clips[0].sourceEndMs,
              speechStartMs: request.clips[0].speechStartMs,
              speechEndMs: request.clips[0].speechEndMs,
              boundaryPaddingBeforeMs: request.clips[0].boundaryPaddingBeforeMs,
              boundaryPaddingAfterMs: request.clips[0].boundaryPaddingAfterMs,
              transcriptText: request.clips[0].transcriptText,
              transcriptSegments: request.clips[0].transcriptSegments,
              transcriptSegmentCount: request.clips[0].transcriptSegmentCount,
              transcriptCoverageScore: request.clips[0].transcriptCoverageScore,
              speechContinuityGrade: request.clips[0].speechContinuityGrade,
            },
          ],
        };
      },
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    });
    const overlappingTranscriptSourceFile = createTrustedLocalMediaFile(
      commons,
      'D:/media/overlap-repair-source.mp4',
      'overlap-repair-source.mp4',
    );
    const overlappingTranscriptResult = await withImmediateTimers(async () =>
      processVideoSlice({
        fileId: 'asset-source-overlap-repair-slice',
        file: overlappingTranscriptSourceFile,
        mode: 'contract-mode',
        llmModel: 'gemini-3-flash-preview',
        minDuration: 15,
        maxDuration: 60,
        baseAlgorithm: 'scene',
        highlightEngine: 'keyword',
        enableNoiseReduction: true,
        enableCoughFilter: true,
        enableRepeatFilter: true,
        enableSubtitles: false,
        sliceCountMode: 'qualityFirst',
        targetSliceCount: 1,
      }),
    );
    const overlappingTranscriptTask = readScopedStoredArray(services, 'tasks').find(
      (task) => task.id === overlappingTranscriptResult.taskId,
    );
    assertEqual(
      overlappingTranscriptResult.success,
      true,
      'video slice workflow repairs lightly overlapping speech-to-text segments instead of failing after native rendering',
    );
    assertEqual(
      overlappingTranscriptSliceCommands.find((entry) => entry.kind === 'slice')?.request?.clips?.[0]?.transcriptSegments?.[1]?.startMs,
      25000,
      'video slice workflow trims overlapped STT segment starts before sending native clip transcript evidence',
    );
    assertEqual(
      overlappingTranscriptTask?.sliceResults?.[0]?.transcriptSegments?.[1]?.startMs,
      25000,
      'video slice workflow stores non-overlapping slice transcript segments after STT overlap repair',
    );
    assertEqual(
      overlappingTranscriptTask?.sliceResults?.[0]?.transcriptText,
      'Why overlap repair matters is simple. Because speech-to-text segments can overlap, the transcript must stay ordered. So trim the second segment boundary and the smart slice remains publishable.',
      'video slice workflow preserves complete transcript text after STT overlap repair',
    );

    resetStorage();
    const explicitDisabledSubtitleSliceCommands = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        mediaImportCommandReady: true,
        videoSliceCommandReady: true,
        speechTranscriptionCommandReady: true,
        speechTranscriptionToolchainReady: true,
        speechTranscriptionProbeCommandReady: true,
      }),
      importMediaFile: async (request) => {
        explicitDisabledSubtitleSliceCommands.push({ kind: 'import', request });
        return {
          assetUuid: 'explicit-disabled-subtitle-slice-asset',
          sandboxPath: 'D:/autocut-configured-output/inputs/explicit-disabled-subtitle-source.mp4',
          byteSize: 654000,
          name: 'explicit-disabled-subtitle-source.mp4',
          mediaType: 'video',
          mimeType: 'video/mp4',
          durationMs: 42000,
        };
      },
      transcribeMedia: async (request) => {
        explicitDisabledSubtitleSliceCommands.push({ kind: 'transcribe', request });
        return {
          artifactUuid: 'explicit-disabled-subtitle-transcript-artifact',
          taskUuid: 'explicit-disabled-subtitle-transcript-task',
          sourceAssetUuid: request.assetUuid,
          transcriptPath: 'D:/autocut-configured-output/tasks/explicit-disabled-subtitle-transcript-task/outputs/transcript.json',
          taskOutputDir: 'D:/autocut-configured-output/tasks/explicit-disabled-subtitle-transcript-task/outputs',
          language: request.language ?? 'auto',
          text:
            'Why subtitle overlays matter is simple. Because viewers watch without sound, the problem is easy to miss. So show the result in speech text and the solution works.',
          segments: [
            {
              startMs: 5_000,
              endMs: 24_000,
              text:
                'Why subtitle overlays matter is simple. Because viewers watch without sound, the problem is easy to miss. So show the result in speech text and the solution works.',
              speaker: 'Speaker 1',
            },
          ],
          ffmpegExecutable: 'ffmpeg',
          speechExecutable: request.executablePath,
        };
      },
      probeSpeechTranscription: async (request) => ({
        ready: true,
        executablePath: request.executablePath,
        modelPath: request.modelPath,
        sourceKind: request.sourceKind ?? 'execution-preflight',
        diagnostics: [],
        versionLine: 'explicit disabled subtitle speech preflight contract',
      }),
      sliceVideo: async (request) => {
        explicitDisabledSubtitleSliceCommands.push({ kind: 'slice', request });
        const output = createNativeTaskOutputArtifact(
          'explicit-disabled-subtitle-slice-task',
          request.clips[0]?.outputFileName ?? '01-why-subtitle-overlays-matter-is-simple-because.mp4',
          configuredOutputDirectory,
        );
        const thumbnail = createNativeTaskCoverArtifact(
          'explicit-disabled-subtitle-slice-task',
          'explicit-disabled-subtitle-thumb-1.jpg',
          configuredOutputDirectory,
        );
        const subtitle = createNativeTaskOutputArtifact(
          'explicit-disabled-subtitle-slice-task',
          'explicit-disabled-subtitle-1.srt',
          configuredOutputDirectory,
        );
        return {
          taskUuid: 'explicit-disabled-subtitle-slice-task',
          sourceAssetUuid: request.assetUuid,
          taskOutputDir: output.taskOutputDir,
          ffmpegExecutable: 'ffmpeg',
          slices: request.clips.slice(0, 1).map((clip) => ({
            artifactUuid: 'explicit-disabled-subtitle-slice-artifact',
            artifactPath: output.artifactPath,
            thumbnailArtifactUuid: 'explicit-disabled-subtitle-thumb-artifact',
            thumbnailArtifactPath: thumbnail.artifactPath,
            subtitleArtifactUuid: 'explicit-disabled-subtitle-sidecar-artifact',
            subtitleArtifactPath: subtitle.artifactPath,
            subtitleByteSize: 345,
            subtitleFormat: 'srt',
            taskOutputDir: output.taskOutputDir,
            byteSize: 234567,
            thumbnailByteSize: 12345,
            format: 'mp4',
            startMs: clip.startMs,
            durationMs: clip.durationMs,
            label: clip.label,
          })),
        };
      },
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    });
    const explicitDisabledSubtitleSourceFile = createTrustedLocalMediaFile(
      commons,
      'D:/media/explicit-disabled-subtitle-source.mp4',
      'explicit-disabled-subtitle-source.mp4',
    );
    await assertRejects(
      () => withImmediateTimers(async () =>
        processVideoSlice({
          fileId: 'asset-source-explicit-disabled-subtitle-slice',
          file: explicitDisabledSubtitleSourceFile,
          mode: 'contract-mode',
          llmModel: 'deepseek-v4-flash',
          minDuration: 15,
          maxDuration: 60,
          baseAlgorithm: 'scene',
          highlightEngine: 'emotion',
          enableNoiseReduction: true,
          enableCoughFilter: true,
          enableRepeatFilter: true,
          enableSubtitles: false,
          subtitleMode: 'none',
        }),
      ),
      'subtitle artifact was returned even though subtitle rendering was not requested',
      'video slice workflow rejects native subtitle artifacts when subtitles are explicitly disabled',
    );
    const explicitDisabledSubtitleSliceRequest =
      explicitDisabledSubtitleSliceCommands.find((entry) => entry.kind === 'slice')?.request;
    const explicitDisabledSubtitleFailureTask = readScopedStoredArray(services, 'tasks')[0];
    assertEqual(
      explicitDisabledSubtitleSliceCommands[1]?.kind,
      'transcribe',
      'video slice workflow transcribes even when a stale caller submits enableSubtitles false',
    );
    assertEqual(
      explicitDisabledSubtitleSliceRequest?.subtitleMode,
      undefined,
      'video slice workflow honors disabled subtitle requests instead of promoting them to burned overlays',
    );
    assertEqual(
      explicitDisabledSubtitleSliceRequest?.subtitleSegments,
      undefined,
      'video slice workflow does not send transcript segments to native rendering when subtitles are disabled',
    );
    assertEqual(
      explicitDisabledSubtitleFailureTask?.status,
      types.AUTOCUT_TASK_STATUS.failed,
      'video slice workflow marks the task failed when native returns unrequested subtitle artifacts',
    );
    assertEqual(
      readScopedStoredArray(services, 'assets').length,
      0,
      'video slice workflow does not persist video assets after unrequested native subtitle artifacts',
    );
    services.resetAutoCutNativeHostClient();

    resetStorage();
    const contradictorySubtitleSliceCommands = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        mediaImportCommandReady: true,
        videoSliceCommandReady: true,
        speechTranscriptionCommandReady: true,
        speechTranscriptionToolchainReady: true,
        speechTranscriptionProbeCommandReady: true,
      }),
      importMediaFile: async (request) => {
        contradictorySubtitleSliceCommands.push({ kind: 'import', request });
        return {
          assetUuid: 'contradictory-subtitle-slice-asset',
          sandboxPath: 'D:/autocut-configured-output/inputs/contradictory-subtitle-source.mp4',
          byteSize: 654000,
          name: 'contradictory-subtitle-source.mp4',
          mediaType: 'video',
          mimeType: 'video/mp4',
          durationMs: 42000,
        };
      },
      transcribeMedia: async (request) => {
        contradictorySubtitleSliceCommands.push({ kind: 'transcribe', request });
        return {
          artifactUuid: 'contradictory-subtitle-transcript-artifact',
          taskUuid: 'contradictory-subtitle-transcript-task',
          sourceAssetUuid: request.assetUuid,
          transcriptPath: 'D:/autocut-configured-output/tasks/contradictory-subtitle-transcript-task/outputs/transcript.json',
          taskOutputDir: 'D:/autocut-configured-output/tasks/contradictory-subtitle-transcript-task/outputs',
          language: request.language ?? 'auto',
          text:
            'Why subtitle controls must be explicit is simple. Because hidden none modes silently skip output, the request must fail before rendering.',
          segments: [
            {
              startMs: 5_000,
              endMs: 24_000,
              text:
                'Why subtitle controls must be explicit is simple. Because hidden none modes silently skip output, the request must fail before rendering.',
              speaker: 'Speaker 1',
            },
          ],
          ffmpegExecutable: 'ffmpeg',
          speechExecutable: request.executablePath,
        };
      },
      probeSpeechTranscription: async (request) => ({
        ready: true,
        executablePath: request.executablePath,
        modelPath: request.modelPath,
        sourceKind: request.sourceKind ?? 'execution-preflight',
        diagnostics: [],
        versionLine: 'contradictory subtitle speech preflight contract',
      }),
      sliceVideo: async (request) => {
        contradictorySubtitleSliceCommands.push({ kind: 'slice', request });
        throw new Error('sliceVideo must not run for contradictory subtitle enablement parameters');
      },
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    });
    const contradictorySubtitleSourceFile = createTrustedLocalMediaFile(
      commons,
      'D:/media/contradictory-subtitle-source.mp4',
      'contradictory-subtitle-source.mp4',
    );
    await assertRejects(
      () => withImmediateTimers(async () =>
        processVideoSlice({
          fileId: 'asset-source-contradictory-subtitle-slice',
          file: contradictorySubtitleSourceFile,
          mode: 'contract-mode',
          llmModel: 'deepseek-v4-flash',
          minDuration: 15,
          maxDuration: 60,
          baseAlgorithm: 'scene',
          highlightEngine: 'emotion',
          enableNoiseReduction: true,
          enableCoughFilter: true,
          enableRepeatFilter: true,
          enableSubtitles: true,
          subtitleMode: 'none',
        }),
      ),
      'Subtitle rendering was enabled but subtitleMode is none',
      'video slice workflow fails closed when subtitle enablement parameters contradict each other',
    );
    const contradictorySubtitleFailureTask = readScopedStoredArray(services, 'tasks')[0];
    assertRule(
      !contradictorySubtitleSliceCommands.some((entry) => entry.kind === 'slice'),
      'video slice workflow does not render when subtitle enablement parameters contradict each other',
    );
    assertEqual(
      contradictorySubtitleFailureTask?.status,
      types.AUTOCUT_TASK_STATUS.failed,
      'video slice workflow persists a failed task for contradictory subtitle enablement parameters',
    );
    assertEqual(
      readScopedStoredArray(services, 'assets').length,
      0,
      'video slice workflow does not persist assets for contradictory subtitle enablement parameters',
    );
    services.resetAutoCutNativeHostClient();

    resetStorage();
    const enabledSubtitleSliceCommands = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        mediaImportCommandReady: true,
        videoSliceCommandReady: true,
        speechTranscriptionCommandReady: true,
        speechTranscriptionToolchainReady: true,
        speechTranscriptionProbeCommandReady: true,
      }),
      importMediaFile: async (request) => {
        enabledSubtitleSliceCommands.push({ kind: 'import', request });
        return {
          assetUuid: 'enabled-subtitle-slice-asset',
          sandboxPath: 'D:/autocut-configured-output/inputs/enabled-subtitle-source.mp4',
          byteSize: 654000,
          name: 'enabled-subtitle-source.mp4',
          mediaType: 'video',
          mimeType: 'video/mp4',
          durationMs: 42000,
        };
      },
      transcribeMedia: async (request) => {
        enabledSubtitleSliceCommands.push({ kind: 'transcribe', request });
        return {
          artifactUuid: 'enabled-subtitle-transcript-artifact',
          taskUuid: 'enabled-subtitle-transcript-task',
          sourceAssetUuid: request.assetUuid,
          transcriptPath: 'D:/autocut-configured-output/tasks/enabled-subtitle-transcript-task/outputs/transcript.json',
          taskOutputDir: 'D:/autocut-configured-output/tasks/enabled-subtitle-transcript-task/outputs',
          language: request.language ?? 'auto',
          text:
            'Why subtitle overlays matter is simple. Because viewers watch without sound, the problem is easy to miss. So show the result in speech text and the solution works.',
          segments: [
            {
              startMs: 5_000,
              endMs: 24_000,
              text:
                'Why subtitle overlays matter is simple. Because viewers watch without sound, the problem is easy to miss. So show the result in speech text and the solution works.',
              speaker: 'Speaker 1',
            },
          ],
          ffmpegExecutable: 'ffmpeg',
          speechExecutable: request.executablePath,
        };
      },
      probeSpeechTranscription: async (request) => ({
        ready: true,
        executablePath: request.executablePath,
        modelPath: request.modelPath,
        sourceKind: request.sourceKind ?? 'execution-preflight',
        diagnostics: [],
        versionLine: 'enabled subtitle speech preflight contract',
      }),
      sliceVideo: async (request) => {
        enabledSubtitleSliceCommands.push({ kind: 'slice', request });
        const output = createNativeTaskOutputArtifact(
          'enabled-subtitle-slice-task',
          request.clips[0]?.outputFileName ?? '01-why-subtitle-overlays-matter-is-simple-because.mp4',
          configuredOutputDirectory,
        );
        const thumbnail = createNativeTaskCoverArtifact(
          'enabled-subtitle-slice-task',
          'enabled-subtitle-thumb-1.jpg',
          configuredOutputDirectory,
        );
        const subtitle = createNativeTaskOutputArtifact(
          'enabled-subtitle-slice-task',
          'enabled-subtitle-1.srt',
          configuredOutputDirectory,
        );
        return {
          taskUuid: 'enabled-subtitle-slice-task',
          sourceAssetUuid: request.assetUuid,
          taskOutputDir: output.taskOutputDir,
          ffmpegExecutable: 'ffmpeg',
          slices: request.clips.slice(0, 1).map((clip) => ({
            artifactUuid: 'enabled-subtitle-slice-artifact',
            artifactPath: output.artifactPath,
            thumbnailArtifactUuid: 'enabled-subtitle-thumb-artifact',
            thumbnailArtifactPath: thumbnail.artifactPath,
            subtitleArtifactUuid: 'enabled-subtitle-sidecar-artifact',
            subtitleArtifactPath: subtitle.artifactPath,
            subtitleByteSize: 345,
            subtitleFormat: 'srt',
            taskOutputDir: output.taskOutputDir,
            byteSize: 234567,
            thumbnailByteSize: 12345,
            format: 'mp4',
            startMs: clip.startMs,
            durationMs: clip.durationMs,
            label: clip.label,
          })),
        };
      },
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    });
    const enabledSubtitleSourceFile = createTrustedLocalMediaFile(
      commons,
      'D:/media/enabled-subtitle-source.mp4',
      'enabled-subtitle-source.mp4',
    );
    const enabledSubtitleResult = await withImmediateTimers(async () =>
      processVideoSlice({
        fileId: 'asset-source-enabled-subtitle-slice',
        file: enabledSubtitleSourceFile,
        mode: 'contract-mode',
        llmModel: 'deepseek-v4-flash',
        minDuration: 15,
        maxDuration: 60,
        baseAlgorithm: 'scene',
        highlightEngine: 'emotion',
        enableNoiseReduction: true,
        enableCoughFilter: true,
        enableRepeatFilter: true,
        enableSubtitles: true,
        subtitleMode: 'srt',
      }),
    );
    const enabledSubtitleSliceRequest =
      enabledSubtitleSliceCommands.find((entry) => entry.kind === 'slice')?.request;
    const enabledSubtitleTask = readScopedStoredArray(services, 'tasks').find(
      (task) => task.id === enabledSubtitleResult.taskId,
    );
    assertEqual(
      enabledSubtitleSliceRequest?.subtitleFormat,
      'srt',
      'video slice workflow requests SRT subtitles only when subtitles are enabled',
    );
    assertEqual(
      enabledSubtitleSliceRequest?.subtitleMode,
      'srt',
      'video slice workflow preserves the enabled subtitle mode for native rendering',
    );
    assertEqual(
      enabledSubtitleSliceRequest?.subtitleSegments?.[0]?.text,
      'Why subtitle overlays matter is simple. Because viewers watch without sound, the problem is easy to miss. So show the result in speech text and the solution works.',
      'video slice workflow forwards real speech-to-text segments when subtitle generation is enabled',
    );
    assertEqual(
      enabledSubtitleTask?.sliceResults?.[0]?.subtitleUrl,
      'asset://localhost/D%3A%2Fautocut-configured-output%2Ftasks%2Fenabled-subtitle-slice-task%2Foutputs%2Fenabled-subtitle-1.srt',
      'video slice workflow exposes subtitle sidecar URLs when subtitle generation is enabled',
    );
    assertEqual(
      enabledSubtitleTask?.sliceResults?.[0]?.transcriptText,
      'Why subtitle overlays matter is simple. Because viewers watch without sound, the problem is easy to miss. So show the result in speech text and the solution works.',
      'video slice workflow exposes speech-to-text transcript text alongside enabled subtitle artifacts',
    );
    assertEqual(
      enabledSubtitleTask?.sliceResults?.[0]?.transcriptSegments?.[0]?.text,
      'Why subtitle overlays matter is simple. Because viewers watch without sound, the problem is easy to miss. So show the result in speech text and the solution works.',
      'video slice workflow exposes structured speech-to-text transcript segments alongside enabled subtitle artifacts',
    );
    services.resetAutoCutNativeHostClient();

    const longWhisperSourceDurationMs = 480_000;
    const longWhisperSegments = [
      {
        startMs: 120,
        endMs: 12_400,
        text:
          'Why the opening must start immediately is simple. The first sentence states the result before any silence and gives viewers the clear payoff.',
        speaker: 'Speaker 1',
      },
      {
        startMs: 12_420,
        endMs: 24_800,
        text:
          'Speaker two answers with context, explains the problem, and connects the setup so the first publishable clip stays complete.',
        speaker: 'Speaker 2',
      },
      {
        startMs: 210_000,
        endMs: 222_000,
        text:
          'Why the pricing pain matters is simple. Because retention drops before the team changes the workflow, the solution must be shown clearly.',
        speaker: 'Speaker 1',
      },
      {
        startMs: 221_900,
        endMs: 235_000,
        text:
          'So speaker two interrupts quickly, but the answer completes the refund fix and gives the viewer the final result.',
        speaker: 'Speaker 2',
      },
      {
        startMs: 300_000,
        endMs: 314_000,
        text:
          'Why the operations example matters is simple. Because the launch had a concrete conflict, the practical result becomes easy to trust.',
        speaker: 'Speaker 3',
      },
      {
        startMs: 314_050,
        endMs: 329_000,
        text:
          'So speaker one closes that discussion with the final answer and a publishable takeaway for the edit.',
        speaker: 'Speaker 1',
      },
      {
        startMs: 460_000,
        endMs: 472_000,
        text:
          'Why the final lesson matters is simple. Because long videos often trail off, the closing clip must keep the problem clear.',
        speaker: 'Speaker 2',
      },
      {
        startMs: 472_020,
        endMs: 479_750,
        text: 'So the last sentence lands before the video ends, gives the result, and keeps the boundary tight.',
        speaker: 'Speaker 1',
      },
    ];

    async function runLongWhisperVideoSliceRegression({ taskPrefix, enableSubtitles, subtitleMode }) {
      resetStorage();
      await services.saveAutoCutWorkspaceSettings({
        ...(await services.getAutoCutSettings()).workspace,
        outputDirectory: configuredOutputDirectory,
      });
      await saveVerifiedLocalSpeechTranscriptionSettings(services);

      const commands = [];
      const sliceTaskUuid = `${taskPrefix}-slice-task`;
      services.configureAutoCutNativeHostClient({
        getCapabilities: async () => ({
          mediaImportCommandReady: true,
          videoSliceCommandReady: true,
          speechTranscriptionCommandReady: true,
          speechTranscriptionToolchainReady: true,
          speechTranscriptionProbeCommandReady: true,
          nativeTaskQueryCommandReady: true,
        }),
        importMediaFile: async (request) => {
          commands.push({ kind: 'import', request });
          return {
            assetUuid: `${taskPrefix}-asset`,
            sandboxPath: `${configuredOutputDirectory}/inputs/${taskPrefix}-asset.mp4`,
            byteSize: 4_800_000,
            name: `${taskPrefix}-source.mp4`,
            mediaType: 'video',
            mimeType: 'video/mp4',
            durationMs: longWhisperSourceDurationMs,
          };
        },
        transcribeMedia: async (request) => {
          commands.push({ kind: 'transcribe', request });
          return createNativeVideoSliceTranscriptResult(
            request,
            `${taskPrefix}-transcript-task`,
            configuredOutputDirectory,
            longWhisperSegments,
          );
        },
        probeSpeechTranscription: async (request) => {
          commands.push({ kind: 'speech-preflight', request });
          return {
            ready: true,
            executablePath: request.executablePath,
            modelPath: request.modelPath,
            sourceKind: request.sourceKind ?? 'execution-preflight',
            diagnostics: [],
            versionLine: 'long local Whisper regression preflight contract',
          };
        },
        sliceVideo: async (request) => {
          commands.push({ kind: 'slice', request });
          const subtitlesRequested =
            request.subtitleFormat === 'srt' &&
            request.subtitleMode !== 'burned' &&
            Array.isArray(request.subtitleSegments) &&
            request.subtitleSegments.length > 0;
          const slices = request.clips.map((clip, index) => {
            const sliceNumber = index + 1;
            const output = createNativeTaskOutputArtifact(
              sliceTaskUuid,
              clip.outputFileName ?? `${taskPrefix}-slice-${sliceNumber}.mp4`,
              configuredOutputDirectory,
            );
            const thumbnail = createNativeTaskCoverArtifact(
              sliceTaskUuid,
              `${taskPrefix}-slice-thumb-${sliceNumber}.jpg`,
              configuredOutputDirectory,
            );
            const subtitle = createNativeTaskOutputArtifact(
              sliceTaskUuid,
              `${taskPrefix}-slice-subtitle-${sliceNumber}.srt`,
              configuredOutputDirectory,
            );

            return {
              artifactUuid: `${taskPrefix}-slice-artifact-${sliceNumber}`,
              artifactPath: output.artifactPath,
              thumbnailArtifactUuid: `${taskPrefix}-slice-thumb-artifact-${sliceNumber}`,
              thumbnailArtifactPath: thumbnail.artifactPath,
              ...(subtitlesRequested
                ? {
                    subtitleArtifactUuid: `${taskPrefix}-slice-subtitle-artifact-${sliceNumber}`,
                    subtitleArtifactPath: subtitle.artifactPath,
                    subtitleByteSize: 1_024 + index,
                    subtitleFormat: 'srt',
                  }
                : {}),
              taskOutputDir: output.taskOutputDir,
              byteSize: 240_000 + index,
              thumbnailByteSize: 12_000 + index,
              format: 'mp4',
              startMs: clip.startMs,
              durationMs: clip.durationMs,
              label: clip.label,
              sourceStartMs: clip.sourceStartMs,
              sourceEndMs: clip.sourceEndMs,
              speechStartMs: clip.speechStartMs,
              speechEndMs: clip.speechEndMs,
              boundaryPaddingBeforeMs: clip.boundaryPaddingBeforeMs,
              boundaryPaddingAfterMs: clip.boundaryPaddingAfterMs,
              transcriptText: clip.transcriptText,
              transcriptSegments: clip.transcriptSegments,
              transcriptSegmentCount: clip.transcriptSegmentCount,
              transcriptCoverageScore: clip.transcriptCoverageScore,
              speechContinuityGrade: clip.speechContinuityGrade,
            };
          });

          return {
            taskUuid: sliceTaskUuid,
            sourceAssetUuid: request.assetUuid,
            taskOutputDir: `${configuredOutputDirectory}/tasks/${sliceTaskUuid}/outputs`,
            ffmpegExecutable: 'ffmpeg',
            slices,
          };
        },
        createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
      });

      const sourceFile = createTrustedLocalMediaFile(
        commons,
        `D:/media/${taskPrefix}-long-whisper-source.mp4`,
        `${taskPrefix}-long-whisper-source.mp4`,
        {
          byteSize: 4_800_000,
          mimeType: 'video/mp4',
          mediaType: 'video',
        },
      );
      const result = await withImmediateTimers(async () =>
        processVideoSlice({
          fileId: `asset-source-${taskPrefix}-long-whisper-slice`,
          file: sourceFile,
          mode: 'contract-mode',
          llmModel: 'gemini-3-flash-preview',
          targetPlatform: 'generic',
          sliceCountMode: 'coverageFirst',
          targetSliceCount: 4,
          idealDuration: 25,
          continuityLevel: 'standard',
          minDuration: 10,
          maxDuration: 60,
          baseAlgorithm: 'scene',
          highlightEngine: 'emotion',
          enableNoiseReduction: true,
          enableCoughFilter: true,
          enableRepeatFilter: true,
          enableSubtitles,
          subtitleMode,
        }),
      );
      const task = readScopedStoredArray(services, 'tasks').find((storedTask) => storedTask.id === result.taskId);
      const assets = readScopedStoredArray(services, 'assets');
      services.resetAutoCutNativeHostClient();
      return { commands, result, task, assets };
    }

    const disabledLongWhisperRegression = await runLongWhisperVideoSliceRegression({
      taskPrefix: 'long-whisper-disabled',
      enableSubtitles: false,
      subtitleMode: 'none',
    });
    const disabledLongWhisperTranscribeRequest =
      disabledLongWhisperRegression.commands.find((entry) => entry.kind === 'transcribe')?.request;
    const disabledLongWhisperSliceRequest =
      disabledLongWhisperRegression.commands.find((entry) => entry.kind === 'slice')?.request;
    const disabledLongWhisperOpeningClip = disabledLongWhisperSliceRequest?.clips?.find((clip) =>
      clip.transcriptText?.includes('opening must start immediately')
    );
    const disabledLongWhisperInterruptionClip = disabledLongWhisperSliceRequest?.clips?.find((clip) =>
      clip.transcriptText?.includes('interrupts quickly')
    );
    const disabledLongWhisperClosingClip = disabledLongWhisperSliceRequest?.clips?.find((clip) =>
      clip.transcriptText?.includes('last sentence lands')
    );
    const disabledLongWhisperSpeakers = new Set(
      disabledLongWhisperSliceRequest?.clips
        ?.flatMap((clip) => clip.transcriptSegments ?? [])
        .map((segment) => segment.speaker)
        .filter(Boolean) ?? [],
    );
    assertEqual(
      disabledLongWhisperRegression.result.success,
      true,
      'long local Whisper regression reports success when subtitles are disabled',
    );
    assertEqual(
      disabledLongWhisperTranscribeRequest?.executablePath,
      'D:/tools/whisper-cli.exe',
      'long local Whisper regression uses the configured offline Whisper executable',
    );
    assertEqual(
      disabledLongWhisperTranscribeRequest?.modelPath,
      'D:/models/ggml-large-v3-turbo.bin',
      'long local Whisper regression uses the configured offline large-v3-turbo model',
    );
    assertEqual(
      disabledLongWhisperSliceRequest?.subtitleFormat,
      undefined,
      'long local Whisper regression omits subtitle format when subtitles are disabled',
    );
    assertEqual(
      disabledLongWhisperSliceRequest?.subtitleMode,
      undefined,
      'long local Whisper regression omits subtitle mode when subtitles are disabled',
    );
    assertEqual(
      disabledLongWhisperSliceRequest?.subtitleSegments,
      undefined,
      'long local Whisper regression does not send subtitle segments when subtitles are disabled',
    );
    assertRule(
      disabledLongWhisperSpeakers.has('Speaker 1') &&
        disabledLongWhisperSpeakers.has('Speaker 2') &&
        disabledLongWhisperSpeakers.has('Speaker 3'),
      'long local Whisper regression preserves multi-speaker transcript evidence in native clip requests',
    );
    assertEqual(
      disabledLongWhisperOpeningClip?.sourceStartMs,
      0,
      'long local Whisper regression clamps the opening clip to the beginning instead of adding leading silence',
    );
    assertEqual(
      disabledLongWhisperOpeningClip?.speechStartMs,
      120,
      'long local Whisper regression keeps the true opening speech boundary',
    );
    assertNumberBetween(
      disabledLongWhisperOpeningClip?.boundaryPaddingBeforeMs,
      0,
      200,
      'long local Whisper regression keeps opening leading padding inside the professional standard',
    );
    assertEqual(
      disabledLongWhisperClosingClip?.sourceEndMs,
      longWhisperSourceDurationMs,
      'long local Whisper regression clamps the closing clip to the video end without exceeding duration',
    );
    assertEqual(
      disabledLongWhisperClosingClip?.speechEndMs,
      479_750,
      'long local Whisper regression keeps the true closing speech boundary',
    );
    assertNumberBetween(
      disabledLongWhisperClosingClip?.boundaryPaddingAfterMs,
      0,
      250,
      'long local Whisper regression keeps closing trailing padding inside the professional standard',
    );
    assertSegmentsOrderedAndNonOverlapping(
      disabledLongWhisperInterruptionClip?.transcriptSegments,
      'long local Whisper regression repairs fast-interruption overlap in clip transcript evidence',
    );
    assertEqual(
      disabledLongWhisperInterruptionClip?.transcriptSegments?.find((segment) =>
        segment.text.includes('interrupts quickly')
      )?.startMs,
      222_000,
      'long local Whisper regression trims a lightly overlapping interruption segment to the previous speech end',
    );
    assertRule(
      disabledLongWhisperRegression.task?.sliceResults?.every((sliceResult) =>
        sliceResult.transcriptText?.trim() &&
        sliceResult.transcriptSegments?.length &&
        sliceResult.subtitleUrl === undefined
      ),
      'long local Whisper regression exposes transcript evidence on every slice while subtitles stay disabled',
    );

    const enabledLongWhisperRegression = await runLongWhisperVideoSliceRegression({
      taskPrefix: 'long-whisper-enabled',
      enableSubtitles: true,
      subtitleMode: 'srt',
    });
    const enabledLongWhisperSliceRequest =
      enabledLongWhisperRegression.commands.find((entry) => entry.kind === 'slice')?.request;
    const enabledLongWhisperSubtitleSpeakers = new Set(
      enabledLongWhisperSliceRequest?.subtitleSegments
        ?.map((segment) => segment.speaker)
        .filter(Boolean) ?? [],
    );
    assertEqual(
      enabledLongWhisperRegression.result.success,
      true,
      'long local Whisper regression reports success when SRT subtitles are enabled',
    );
    assertEqual(
      enabledLongWhisperSliceRequest?.subtitleFormat,
      'srt',
      'long local Whisper regression requests SRT subtitle output only after explicit enablement',
    );
    assertEqual(
      enabledLongWhisperSliceRequest?.subtitleMode,
      'srt',
      'long local Whisper regression preserves explicit SRT subtitle mode',
    );
    assertEqual(
      enabledLongWhisperSliceRequest?.subtitleSegments?.length,
      longWhisperSegments.length,
      'long local Whisper regression forwards the complete long-video Whisper transcript to subtitle rendering',
    );
    assertRule(
      enabledLongWhisperSubtitleSpeakers.has('Speaker 1') &&
        enabledLongWhisperSubtitleSpeakers.has('Speaker 2') &&
        enabledLongWhisperSubtitleSpeakers.has('Speaker 3'),
      'long local Whisper regression preserves speaker labels in subtitle segments',
    );
    assertSegmentsOrderedAndNonOverlapping(
      enabledLongWhisperSliceRequest?.subtitleSegments,
      'long local Whisper regression repairs fast-interruption overlap before native subtitle rendering',
    );
    assertEqual(
      enabledLongWhisperSliceRequest?.subtitleSegments?.find((segment) =>
        segment.text.includes('interrupts quickly')
      )?.startMs,
      222_000,
      'long local Whisper regression sends native subtitle rendering a repaired interruption boundary',
    );
    assertRule(
      enabledLongWhisperRegression.task?.sliceResults?.every((sliceResult) =>
        sliceResult.subtitleUrl?.endsWith('.srt') &&
        sliceResult.transcriptText?.trim() &&
        sliceResult.transcriptSegments?.length
      ),
      'long local Whisper regression exposes subtitle sidecars and transcript evidence on every enabled slice',
    );
    assertRule(
      enabledLongWhisperRegression.assets.length === enabledLongWhisperRegression.task?.sliceResults?.length,
      'long local Whisper regression stores one generated video asset per long-video slice',
    );

    assertRule(
      nativeVideoSliceWorkflowCommands[2]?.request?.clips?.length > 0 &&
        nativeVideoSliceWorkflowCommands[2]?.request?.clips?.length <= 5,
      'video slice native workflow creates a quality-first bounded intelligent slice plan',
    );
    assertEqual(
      nativeVideoSliceWorkflowCommands[2]?.request?.clips?.[0]?.startMs,
      21800,
      'video slice native workflow adds leading boundary padding before the first intelligent clip render timing',
    );
    assertEqual(
      nativeVideoSliceWorkflowCommands[2]?.request?.clips?.[0]?.label,
      'Why viewers scroll is simple. Because the openin',
      'video slice native workflow uses local speech transcript text as the semantic clip label',
    );
    assertEqual(
      nativeVideoSliceWorkflowCommands[2]?.request?.clips?.[0]?.outputFileName,
      '01-why-viewers-scroll-is-simple-because-the-openin.mp4',
      'video slice native workflow sends a deterministic title-based output file name for the first smart slice',
    );
    assertEqual(
      nativeVideoSliceWorkflowCommands[2]?.request?.clips?.[1]?.outputFileName,
      '02-what-fixes-weak-conversion-is-clear-the-case-sh.mp4',
      'video slice native workflow sends a deterministic title-based output file name for the second smart slice',
    );
    assertEqual(
      nativeVideoSliceWorkflowTask?.status,
      types.AUTOCUT_TASK_STATUS.completed,
      'video slice native workflow completes the persisted task',
    );
    assertEqual(
      nativeVideoSliceWorkflowTask?.resultCount,
      2,
      'video slice native workflow records the generated slice count from native artifacts',
    );
    assertEqual(
      nativeVideoSliceWorkflowTask?.sliceResults?.[0]?.url,
      'asset://localhost/D%3A%2Fautocut-configured-output%2Ftasks%2Fnative-slice-task%2Foutputs%2F01-why-viewers-scroll-is-simple-because-the-openin.mp4',
      'video slice native workflow converts first native artifact path to a safe asset URL',
    );
    assertEqual(
      nativeVideoSliceWorkflowTask?.sliceResults?.[0]?.artifactPath,
      'D:/autocut-configured-output/tasks/native-slice-task/outputs/01-why-viewers-scroll-is-simple-because-the-openin.mp4',
      'video slice native workflow persists the first native artifact path for open-containing-folder actions',
    );
    assertEqual(
      nativeVideoSliceWorkflowTask?.sliceResults?.[0]?.taskOutputDir,
      'D:/autocut-configured-output/tasks/native-slice-task/outputs',
      'video slice native workflow persists the native task output directory for artifact containment audits',
    );
    assertEqual(
      nativeVideoSliceWorkflowTask?.sliceResults?.[0]?.name,
      '01-why-viewers-scroll-is-simple-because-the-openin.mp4',
      'video slice native workflow names the first task slice result from clear speech content',
    );
    assertEqual(
      nativeVideoSliceWorkflowTask?.sliceResults?.[0]?.thumbnailUrl,
      'asset://localhost/D%3A%2Fautocut-configured-output%2Ftasks%2Fnative-slice-task%2Foutputs%2Fcover%2Fnative-slice-thumb-1.jpg',
      'video slice native workflow converts first native cover thumbnail path to a safe asset URL',
    );
    assertEqual(
      nativeVideoSliceWorkflowTask?.sliceResults?.[0]?.subtitleUrl,
      undefined,
      'video slice native workflow does not expose subtitle sidecar URLs when subtitles are disabled',
    );
    assertEqual(
      nativeVideoSliceWorkflowTask?.sliceResults?.[0]?.subtitleFormat,
      undefined,
      'video slice native workflow does not record subtitle format when subtitles are disabled',
    );
    assertEqual(
      nativeVideoSliceWorkflowTask?.sliceResults?.[1]?.url,
      'asset://localhost/D%3A%2Fautocut-configured-output%2Ftasks%2Fnative-slice-task%2Foutputs%2F02-what-fixes-weak-conversion-is-clear-the-case-sh.mp4',
      'video slice native workflow converts second native artifact path to a safe asset URL',
    );
    assertEqual(
      nativeVideoSliceWorkflowTask?.sliceResults?.[1]?.artifactPath,
      'D:/autocut-configured-output/tasks/native-slice-task/outputs/02-what-fixes-weak-conversion-is-clear-the-case-sh.mp4',
      'video slice native workflow persists the second native artifact path for open-containing-folder actions',
    );
    assertEqual(
      nativeVideoSliceWorkflowTask?.sliceResults?.[1]?.name,
      '02-what-fixes-weak-conversion-is-clear-the-case-sh.mp4',
      'video slice native workflow names the second task slice result from clear speech content',
    );
    assertEqual(
      nativeVideoSliceWorkflowTask?.sliceResults?.[1]?.thumbnailUrl,
      'asset://localhost/D%3A%2Fautocut-configured-output%2Ftasks%2Fnative-slice-task%2Foutputs%2Fcover%2Fnative-slice-thumb-2.jpg',
      'video slice native workflow converts second native cover thumbnail path to a safe asset URL',
    );
    assertEqual(
      nativeVideoSliceWorkflowTask?.sliceResults?.[1]?.subtitleUrl,
      undefined,
      'video slice native workflow does not expose second subtitle sidecar URL when subtitles are disabled',
    );
    assertEqual(
      nativeVideoSliceGeneratedAssets.length,
      2,
      'video slice native workflow stores one generated asset per native slice artifact',
    );
    assertEqual(
      nativeVideoSliceFirstAsset?.type,
      'video',
      'video slice native workflow stores generated slices as video assets',
    );
    assertEqual(
      nativeVideoSliceFirstAsset?.size,
      234567,
      'video slice native workflow stores the first native slice byte size on the generated asset',
    );
    assertEqual(
      nativeVideoSliceFirstAsset?.url,
      nativeVideoSliceWorkflowTask?.sliceResults?.[0]?.url,
      'video slice native workflow stores safe asset URLs on generated assets',
    );
    assertEqual(
      nativeVideoSliceFirstAsset?.artifactPath,
      nativeVideoSliceWorkflowTask?.sliceResults?.[0]?.artifactPath,
      'video slice native workflow stores native artifact paths on generated assets for task file folder opening',
    );
    assertEqual(
      nativeVideoSliceFirstAsset?.thumbnailUrl,
      nativeVideoSliceWorkflowTask?.sliceResults?.[0]?.thumbnailUrl,
      'video slice native workflow stores safe thumbnail URLs on generated assets',
    );
    services.resetAutoCutNativeHostClient();
    services.configureAutoCutApprovedAiSdkBridge(null);

    resetStorage();
    const failingNativeVideoSliceSourceFile = createTrustedLocalMediaFile(
      commons,
      'D:/media/failing-native-source.mp4',
      'failing-native-source.mp4',
    );
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        contractVersion: 'contract-test',
        hostKind: 'native-host',
        databaseContractReady: true,
        sqliteMigrationReady: true,
        databaseHealthCommandReady: true,
        ffmpegProbeCommandReady: true,
        mediaImportCommandReady: true,
        mediaFileDescribeCommandReady: true,
        localVideoFileSelectCommandReady: true,
        localDirectorySelectCommandReady: true,
        audioExtractionCommandReady: false,
        audioExtractionFromAssetReady: false,
        videoGifCommandReady: false,
        videoSliceCommandReady: true,
        videoCompressCommandReady: false,
        videoConvertCommandReady: false,
        videoEnhanceCommandReady: false,
        speechTranscriptionCommandReady: true,
        speechTranscriptionToolchainReady: true,
        speechTranscriptionProbeCommandReady: true,
        speechTranscriptionFileSelectCommandReady: false,
        llmHttpCommandReady: false,
        llmSecretStoreReady: false,
        nativeTaskQueryCommandReady: true,
        nativeTaskCancelCommandReady: false,
        nativeTaskRecoveryCommandReady: false,
        nativeTaskRetryCommandReady: false,
        nativeTaskProgressEventsReady: false,
        nativeWorkerLeaseReady: true,
        ffmpegToolchainManifestReady: true,
        ffmpegToolchainResolverReady: true,
        ffmpegBundledReady: false,
        ffmpegExecutionReady: false,
        supportedCommands: ['autocut_import_media_file', 'autocut_slice_video'],
      }),
      getDatabaseHealth: async () => ({
        ready: true,
        databasePath: 'memory',
        appliedMigrations: ['baseline'],
        verifiedTables: ['media_asset'],
        missingTables: [],
        diagnostics: [],
      }),
      probeFfmpeg: async () => ({
        available: true,
        executable: 'ffmpeg',
        sourceKind: 'system-path',
        manifestReady: true,
        bundledReady: false,
        versionLine: 'ffmpeg contract',
        diagnostics: [],
      }),
      importMediaFile: async () => ({
        assetUuid: 'failing-native-slice-asset',
        sandboxPath: `${configuredOutputDirectory}/inputs/failing-native-slice-asset.mp4`,
        byteSize: 765000,
        name: 'failing-native-source.mp4',
        mediaType: 'video',
        mimeType: 'video/mp4',
      }),
      describeLocalMediaFile: async (request) => ({
        sourcePath: request.sourcePath,
        byteSize: 765000,
        name: 'failing-native-source.mp4',
        mediaType: 'video',
        mimeType: 'video/mp4',
      }),
      selectLocalVideoFile: async () => null,
      selectLocalDirectory: async () => null,
      extractAudio: async () => {
        throw new Error('audio extraction is not configured for failing native video slice workflow contract');
      },
      generateGif: async () => {
        throw new Error('video GIF is not configured for failing native video slice workflow contract');
      },
      sliceVideo: async () => {
        throw new Error('ffmpeg slice failed with status 1');
      },
      transcribeMedia: async (request) =>
        createStandardNativeVideoSliceTranscriptResult(
          request,
          'failing-native-slice-transcript-task',
          configuredOutputDirectory,
        ),
      probeSpeechTranscription: async (request) => ({
        ready: true,
        executablePath: request.executablePath,
        modelPath: request.modelPath,
        sourceKind: request.sourceKind ?? 'execution-preflight',
        diagnostics: [],
        versionLine: 'failing native video slice speech preflight contract',
      }),
      selectSpeechTranscriptionFile: async () => null,
      compressVideo: async () => {
        throw new Error('video compression is not configured for failing native video slice workflow contract');
      },
      convertVideo: async () => {
        throw new Error('video conversion is not configured for failing native video slice workflow contract');
      },
      enhanceVideo: async () => {
        throw new Error('video enhancement is not configured for failing native video slice workflow contract');
      },
      sendLlmHttpRequest: async () => {
        throw new Error('LLM HTTP is not configured for failing native video slice workflow contract');
      },
      saveLlmSecret: async (request) => ({
        secretName: request.secretName,
        saved: false,
      }),
      getLlmSecret: async (request) => ({
        secretName: request.secretName,
        configured: false,
      }),
      deleteLlmSecret: async (request) => ({
        secretName: request.secretName,
        deleted: false,
      }),
      listNativeTasks: async () => [],
      cancelNativeTask: async (request) => ({
        taskUuid: request.taskUuid,
        status: 0,
        canceled: false,
        message: 'not configured',
      }),
      recoverNativeTasks: async () => ({
        inspected: 0,
        recovered: 0,
        interrupted: 0,
        canceled: 0,
        expiredLeases: 0,
        deferred: 0,
        taskUuids: [],
      }),
      retryNativeTask: async (request) => ({
        taskUuid: request.taskUuid,
        retryTaskUuid: '',
        status: 0,
        retried: false,
        message: 'not configured',
      }),
      runAudioSmoke: async () => ({
        artifactUuid: 'native-audio-smoke',
        taskUuid: 'native-audio-smoke-task',
        sourceAssetUuid: '',
        artifactPath: createNativeTaskOutputArtifact('native-audio-smoke-task', 'native-audio-smoke.wav').artifactPath,
        taskOutputDir: createNativeTaskOutputArtifact('native-audio-smoke-task', 'native-audio-smoke.wav').taskOutputDir,
        byteSize: 1,
        format: 'wav',
        ffmpegExecutable: 'ffmpeg',
      }),
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    });
    await assertRejects(
      () =>
        withImmediateTimers(async () =>
          processVideoSlice({
            fileId: 'asset-source-failing-native-video-slice',
            file: failingNativeVideoSliceSourceFile,
            mode: 'contract-mode',
            llmModel: 'deepseek-chat',
            minDuration: 15,
            maxDuration: 60,
            baseAlgorithm: 'scene',
            highlightEngine: 'emotion',
            enableNoiseReduction: true,
            enableCoughFilter: true,
            enableRepeatFilter: true,
          }),
        ),
      'ffmpeg slice failed with status 1',
      'video slice native command failure',
    );
    const failingNativeVideoSliceTasks = readScopedStoredArray(services, 'tasks');
    assertEqual(failingNativeVideoSliceTasks.length, 1, 'video slice native command failure persists one task');
    assertEqual(failingNativeVideoSliceTasks[0]?.status, types.AUTOCUT_TASK_STATUS.failed, 'video slice native command failure marks the task failed');
    assertIncludes(
      String(failingNativeVideoSliceTasks[0]?.errorMessage ?? ''),
      'ffmpeg slice failed with status 1',
      'video slice native command failure stores the native error message',
    );
    assertEqual(readScopedStoredArray(services, 'assets').length, 0, 'video slice native command failure does not persist generated assets');
    assertEqual(readScopedStoredArray(services, 'messages').length, 0, 'video slice native command failure does not persist success messages');

    resetStorage();
    const partialNativeVideoSliceCommands = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        contractVersion: 'contract-test',
        hostKind: 'native-host',
        mediaImportCommandReady: true,
        videoSliceCommandReady: true,
        speechTranscriptionCommandReady: true,
        speechTranscriptionToolchainReady: true,
        speechTranscriptionProbeCommandReady: true,
      }),
      importMediaFile: async (request) => {
        partialNativeVideoSliceCommands.push({ kind: 'import', request });
        return {
          assetUuid: 'partial-native-slice-asset',
          sandboxPath: `${configuredOutputDirectory}/inputs/partial-native-slice-asset.mp4`,
          byteSize: 765000,
          name: 'partial-native-source.mp4',
          mediaType: 'video',
          mimeType: 'video/mp4',
          durationMs: 90000,
        };
      },
      transcribeMedia: async (request) => {
        partialNativeVideoSliceCommands.push({ kind: 'transcribe', request });
        return createNativeVideoSliceTranscriptResult(
          request,
          'partial-native-slice-transcript-task',
          configuredOutputDirectory,
          [
            {
              startMs: 0,
              endMs: 19_000,
              text: 'Why native validation matters is simple. Because partial render output can break review, the problem must be caught before assets are saved. So verify every result and the workflow stays safe.',
              speaker: 'Speaker 1',
            },
            {
              startMs: 40_000,
              endMs: 59_000,
              text: 'What makes count checks reliable is clear. The case shows missing slice files before publishing, so the solution is to reject the task and keep storage clean.',
              speaker: 'Speaker 1',
            },
          ],
        );
      },
      probeSpeechTranscription: async (request) => ({
        ready: true,
        executablePath: request.executablePath,
        modelPath: request.modelPath,
        sourceKind: request.sourceKind ?? 'execution-preflight',
        diagnostics: [],
        versionLine: 'partial native video slice speech preflight contract',
      }),
      sliceVideo: async (request) => {
        partialNativeVideoSliceCommands.push({ kind: 'slice', request });
        const output = createNativeTaskOutputArtifact(
          'partial-native-slice-task',
          'partial-native-slice-artifact-1.mp4',
          configuredOutputDirectory,
        );
        const thumbnail = createNativeTaskCoverArtifact(
          'partial-native-slice-task',
          'partial-native-slice-thumb-1.jpg',
          configuredOutputDirectory,
        );
        return {
          taskUuid: 'partial-native-slice-task',
          sourceAssetUuid: request.assetUuid,
          taskOutputDir: output.taskOutputDir,
          ffmpegExecutable: 'ffmpeg',
          slices: request.clips.slice(0, 1).map((clip, index) => ({
            artifactUuid: `partial-native-slice-artifact-${index + 1}`,
            artifactPath: output.artifactPath,
            thumbnailArtifactUuid: `partial-native-slice-thumb-${index + 1}`,
            thumbnailArtifactPath: thumbnail.artifactPath,
            taskOutputDir: output.taskOutputDir,
            byteSize: 234567,
            thumbnailByteSize: 12345,
            format: 'mp4',
            startMs: clip.startMs,
            durationMs: clip.durationMs,
            label: clip.label,
          })),
        };
      },
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    });
    const partialNativeVideoSliceSourceFile = createTrustedLocalMediaFile(
      commons,
      'D:/media/partial-native-source.mp4',
      'partial-native-source.mp4',
    );
    await assertRejects(
      () =>
        withImmediateTimers(async () =>
          processVideoSlice({
            fileId: 'asset-source-partial-native-video-slice',
            file: partialNativeVideoSliceSourceFile,
            mode: 'contract-mode',
            llmModel: 'deepseek-chat',
            targetSliceCount: 2,
            sliceCountMode: 'fixed',
            minDuration: 15,
            maxDuration: 20,
            baseAlgorithm: 'scene',
            highlightEngine: 'emotion',
            enableNoiseReduction: true,
            enableCoughFilter: true,
            enableRepeatFilter: true,
          }),
        ),
      'returned 1 slice artifacts for 2 planned clips',
      'video slice native partial result mismatch',
    );
    const partialNativeVideoSliceTasks = readScopedStoredArray(services, 'tasks');
    assertEqual(
      partialNativeVideoSliceCommands.find((entry) => entry.kind === 'slice')?.request?.clips?.length,
      2,
      'video slice native partial result test requests two planned clips',
    );
    assertEqual(partialNativeVideoSliceTasks.length, 1, 'video slice native partial result mismatch persists one task');
    assertEqual(
      partialNativeVideoSliceTasks[0]?.status,
      types.AUTOCUT_TASK_STATUS.failed,
      'video slice native partial result mismatch marks the task failed',
    );
    assertIncludes(
      String(partialNativeVideoSliceTasks[0]?.errorMessage ?? ''),
      'returned 1 slice artifacts for 2 planned clips',
      'video slice native partial result mismatch stores the count mismatch reason',
    );
    assertEqual(readScopedStoredArray(services, 'assets').length, 0, 'video slice native partial result mismatch does not persist generated assets');
    assertEqual(readScopedStoredArray(services, 'messages').length, 0, 'video slice native partial result mismatch does not persist success messages');

    resetStorage();
    const escapedNativeVideoSliceArtifactCommands = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        contractVersion: 'contract-test',
        hostKind: 'native-host',
        mediaImportCommandReady: true,
        videoSliceCommandReady: true,
        speechTranscriptionCommandReady: true,
        speechTranscriptionToolchainReady: true,
        speechTranscriptionProbeCommandReady: true,
      }),
      importMediaFile: async (request) => {
        escapedNativeVideoSliceArtifactCommands.push({ kind: 'import', request });
        return {
          assetUuid: 'escaped-native-slice-artifact-asset',
          sandboxPath: `${configuredOutputDirectory}/inputs/escaped-native-slice-artifact-asset.mp4`,
          byteSize: 765000,
          name: 'escaped-native-artifact-source.mp4',
          mediaType: 'video',
          mimeType: 'video/mp4',
          durationMs: 90000,
        };
      },
      transcribeMedia: async (request) => {
        escapedNativeVideoSliceArtifactCommands.push({ kind: 'transcribe', request });
        return createNativeVideoSliceTranscriptResult(
          request,
          'escaped-native-slice-artifact-transcript-task',
          configuredOutputDirectory,
          [
            {
              startMs: 0,
              endMs: 19_000,
              text: 'Why artifact containment matters is simple. Because escaped paths can write outside review storage, the problem must be caught before assets are saved. So verify every result and the workflow stays safe.',
              speaker: 'Speaker 1',
            },
            {
              startMs: 40_000,
              endMs: 59_000,
              text: 'What makes path checks reliable is clear. The case shows unsafe thumbnails before publishing, so the solution is to reject the task and keep storage clean.',
              speaker: 'Speaker 1',
            },
          ],
        );
      },
      probeSpeechTranscription: async (request) => ({
        ready: true,
        executablePath: request.executablePath,
        modelPath: request.modelPath,
        sourceKind: request.sourceKind ?? 'execution-preflight',
        diagnostics: [],
        versionLine: 'escaped native video slice speech preflight contract',
      }),
      sliceVideo: async (request) => {
        escapedNativeVideoSliceArtifactCommands.push({ kind: 'slice', request });
        return {
          taskUuid: 'escaped-native-slice-artifact-task',
          sourceAssetUuid: request.assetUuid,
          taskOutputDir: `${configuredOutputDirectory}/tasks/escaped-native-slice-artifact-task/outputs`,
          ffmpegExecutable: 'ffmpeg',
          slices: request.clips.map((clip, index) => {
            const output = createNativeTaskOutputArtifact(
              'escaped-native-slice-artifact-task',
              `escaped-native-slice-artifact-${index + 1}.mp4`,
              configuredOutputDirectory,
            );
            return {
              artifactUuid: `escaped-native-slice-artifact-${index + 1}`,
              artifactPath: output.artifactPath,
              thumbnailArtifactUuid: `escaped-native-slice-thumb-${index + 1}`,
              thumbnailArtifactPath: `${configuredOutputDirectory}/tasks/escaped-native-slice-artifact-task/thumb-${index + 1}.jpg`,
              taskOutputDir: output.taskOutputDir,
              byteSize: 234567,
              thumbnailByteSize: 12345,
              format: 'mp4',
              startMs: clip.startMs,
              durationMs: clip.durationMs,
              label: clip.label,
            };
          }),
        };
      },
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    });
    const escapedNativeVideoSliceArtifactSourceFile = createTrustedLocalMediaFile(
      commons,
      'D:/media/escaped-native-artifact-source.mp4',
      'escaped-native-artifact-source.mp4',
    );
    await assertRejects(
      () =>
        withImmediateTimers(async () =>
          processVideoSlice({
            fileId: 'asset-source-escaped-native-video-slice-artifact',
            file: escapedNativeVideoSliceArtifactSourceFile,
            mode: 'contract-mode',
            llmModel: 'deepseek-chat',
            targetSliceCount: 2,
            sliceCountMode: 'fixed',
            minDuration: 15,
            maxDuration: 20,
            baseAlgorithm: 'scene',
            highlightEngine: 'emotion',
            enableNoiseReduction: true,
            enableCoughFilter: true,
            enableRepeatFilter: true,
          }),
        ),
      'slice artifact 1 thumbnailArtifactPath is outside its task output directory',
      'video slice native escaped artifact containment',
    );
    const escapedNativeVideoSliceArtifactTasks = readScopedStoredArray(services, 'tasks');
    assertEqual(
      escapedNativeVideoSliceArtifactCommands.find((entry) => entry.kind === 'slice')?.request?.clips?.length,
      2,
      'video slice native escaped artifact test requests two planned clips',
    );
    assertEqual(
      escapedNativeVideoSliceArtifactTasks[0]?.status,
      types.AUTOCUT_TASK_STATUS.failed,
      'video slice native escaped artifact containment marks the task failed',
    );
    assertIncludes(
      String(escapedNativeVideoSliceArtifactTasks[0]?.errorMessage ?? ''),
      'thumbnailArtifactPath is outside its task output directory',
      'video slice native escaped artifact containment stores the failing artifact field',
    );
    assertEqual(readScopedStoredArray(services, 'assets').length, 0, 'video slice native escaped artifact containment does not persist generated assets');
    assertEqual(readScopedStoredArray(services, 'messages').length, 0, 'video slice native escaped artifact containment does not persist success messages');

    resetStorage();
    const invalidNativeVideoSliceArtifactCommands = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        contractVersion: 'contract-test',
        hostKind: 'native-host',
        mediaImportCommandReady: true,
        videoSliceCommandReady: true,
        speechTranscriptionCommandReady: true,
        speechTranscriptionToolchainReady: true,
        speechTranscriptionProbeCommandReady: true,
      }),
      importMediaFile: async (request) => {
        invalidNativeVideoSliceArtifactCommands.push({ kind: 'import', request });
        return {
          assetUuid: 'invalid-native-slice-artifact-asset',
          sandboxPath: `${configuredOutputDirectory}/inputs/invalid-native-slice-artifact-asset.mp4`,
          byteSize: 765000,
          name: 'invalid-native-artifact-source.mp4',
          mediaType: 'video',
          mimeType: 'video/mp4',
          durationMs: 90000,
        };
      },
      transcribeMedia: async (request) => {
        invalidNativeVideoSliceArtifactCommands.push({ kind: 'transcribe', request });
        return createStandardNativeVideoSliceTranscriptResult(
          request,
          'invalid-native-slice-artifact-transcript-task',
          configuredOutputDirectory,
        );
      },
      probeSpeechTranscription: async (request) => ({
        ready: true,
        executablePath: request.executablePath,
        modelPath: request.modelPath,
        sourceKind: request.sourceKind ?? 'execution-preflight',
        diagnostics: [],
        versionLine: 'invalid native video slice artifact speech preflight contract',
      }),
      sliceVideo: async (request) => {
        invalidNativeVideoSliceArtifactCommands.push({ kind: 'slice', request });
        return {
          taskUuid: 'invalid-native-slice-artifact-task',
          sourceAssetUuid: request.assetUuid,
          taskOutputDir: `${configuredOutputDirectory}/tasks/invalid-native-slice-artifact-task/outputs`,
          ffmpegExecutable: 'ffmpeg',
          slices: request.clips.map((clip, index) => {
            const output = createNativeTaskOutputArtifact(
              'invalid-native-slice-artifact-task',
              `invalid-native-slice-artifact-${index + 1}.mp4`,
              configuredOutputDirectory,
            );
            const thumbnail = createNativeTaskCoverArtifact(
              'invalid-native-slice-artifact-task',
              `invalid-native-slice-thumb-${index + 1}.jpg`,
              configuredOutputDirectory,
            );
            return {
              artifactUuid: `invalid-native-slice-artifact-${index + 1}`,
              artifactPath: output.artifactPath,
              thumbnailArtifactUuid: `invalid-native-slice-thumb-${index + 1}`,
              thumbnailArtifactPath: index === 0 ? thumbnail.artifactPath : '',
              taskOutputDir: output.taskOutputDir,
              byteSize: index === 0 ? 234567 : 0,
              thumbnailByteSize: 12345,
              format: 'mp4',
              startMs: clip.startMs,
              durationMs: clip.durationMs,
              label: clip.label,
            };
          }),
        };
      },
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    });
    const invalidNativeVideoSliceArtifactSourceFile = createTrustedLocalMediaFile(
      commons,
      'D:/media/invalid-native-artifact-source.mp4',
      'invalid-native-artifact-source.mp4',
    );
    await assertRejects(
      () =>
        withImmediateTimers(async () =>
          processVideoSlice({
            fileId: 'asset-source-invalid-native-video-slice-artifact',
            file: invalidNativeVideoSliceArtifactSourceFile,
            mode: 'contract-mode',
            llmModel: 'deepseek-chat',
            targetSliceCount: 2,
            sliceCountMode: 'fixed',
            minDuration: 15,
            maxDuration: 20,
            baseAlgorithm: 'scene',
            highlightEngine: 'emotion',
            enableNoiseReduction: true,
            enableCoughFilter: true,
            enableRepeatFilter: true,
            enableSubtitles: false,
          }),
        ),
      'slice artifact 2 is missing thumbnailArtifactPath',
      'video slice native invalid artifact metadata',
    );
    const invalidNativeVideoSliceArtifactTasks = readScopedStoredArray(services, 'tasks');
    assertEqual(
      invalidNativeVideoSliceArtifactCommands.find((entry) => entry.kind === 'slice')?.request?.clips?.length,
      2,
      'video slice native invalid artifact test requests two planned clips',
    );
    assertEqual(
      invalidNativeVideoSliceArtifactTasks[0]?.status,
      types.AUTOCUT_TASK_STATUS.failed,
      'video slice native invalid artifact metadata marks the task failed',
    );
    assertIncludes(
      String(invalidNativeVideoSliceArtifactTasks[0]?.errorMessage ?? ''),
      'slice artifact 2 is missing thumbnailArtifactPath',
      'video slice native invalid artifact metadata stores the failing artifact field',
    );
    assertEqual(readScopedStoredArray(services, 'assets').length, 0, 'video slice native invalid artifact metadata does not persist generated assets');
    assertEqual(readScopedStoredArray(services, 'messages').length, 0, 'video slice native invalid artifact metadata does not persist success messages');

    resetStorage();
    const mismatchedTimingNativeVideoSliceCommands = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        contractVersion: 'contract-test',
        hostKind: 'native-host',
        mediaImportCommandReady: true,
        videoSliceCommandReady: true,
        speechTranscriptionCommandReady: true,
        speechTranscriptionToolchainReady: true,
        speechTranscriptionProbeCommandReady: true,
      }),
      importMediaFile: async (request) => {
        mismatchedTimingNativeVideoSliceCommands.push({ kind: 'import', request });
        return {
          assetUuid: 'mismatched-timing-native-slice-asset',
          sandboxPath: `${configuredOutputDirectory}/inputs/mismatched-timing-native-slice-asset.mp4`,
          byteSize: 765000,
          name: 'mismatched-timing-native-source.mp4',
          mediaType: 'video',
          mimeType: 'video/mp4',
          durationMs: 90000,
        };
      },
      transcribeMedia: async (request) => {
        mismatchedTimingNativeVideoSliceCommands.push({ kind: 'transcribe', request });
        return createStandardNativeVideoSliceTranscriptResult(
          request,
          'mismatched-timing-native-slice-transcript-task',
          configuredOutputDirectory,
        );
      },
      probeSpeechTranscription: async (request) => ({
        ready: true,
        executablePath: request.executablePath,
        modelPath: request.modelPath,
        sourceKind: request.sourceKind ?? 'execution-preflight',
        diagnostics: [],
        versionLine: 'mismatched timing native video slice speech preflight contract',
      }),
      sliceVideo: async (request) => {
        mismatchedTimingNativeVideoSliceCommands.push({ kind: 'slice', request });
        return {
          taskUuid: 'mismatched-timing-native-slice-task',
          sourceAssetUuid: request.assetUuid,
          taskOutputDir: `${configuredOutputDirectory}/tasks/mismatched-timing-native-slice-task/outputs`,
          ffmpegExecutable: 'ffmpeg',
          slices: request.clips.map((clip, index) => {
            const output = createNativeTaskOutputArtifact(
              'mismatched-timing-native-slice-task',
              `mismatched-timing-native-slice-artifact-${index + 1}.mp4`,
              configuredOutputDirectory,
            );
            const thumbnail = createNativeTaskCoverArtifact(
              'mismatched-timing-native-slice-task',
              `mismatched-timing-native-slice-thumb-${index + 1}.jpg`,
              configuredOutputDirectory,
            );
            return {
              artifactUuid: `mismatched-timing-native-slice-artifact-${index + 1}`,
              artifactPath: output.artifactPath,
              thumbnailArtifactUuid: `mismatched-timing-native-slice-thumb-${index + 1}`,
              thumbnailArtifactPath: thumbnail.artifactPath,
              taskOutputDir: output.taskOutputDir,
              byteSize: 234567 + index,
              thumbnailByteSize: 12345 + index,
              format: 'mp4',
              startMs: index === 1 ? clip.startMs + 1000 : clip.startMs,
              durationMs: clip.durationMs,
              label: clip.label,
            };
          }),
        };
      },
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    });
    const mismatchedTimingNativeVideoSliceSourceFile = createTrustedLocalMediaFile(
      commons,
      'D:/media/mismatched-timing-native-source.mp4',
      'mismatched-timing-native-source.mp4',
    );
    await assertRejects(
      () =>
        withImmediateTimers(async () =>
          processVideoSlice({
            fileId: 'asset-source-mismatched-timing-native-video-slice',
            file: mismatchedTimingNativeVideoSliceSourceFile,
            mode: 'contract-mode',
            llmModel: 'deepseek-chat',
            targetSliceCount: 2,
            sliceCountMode: 'fixed',
            minDuration: 15,
            maxDuration: 20,
            baseAlgorithm: 'scene',
            highlightEngine: 'emotion',
            enableNoiseReduction: true,
            enableCoughFilter: true,
            enableRepeatFilter: true,
          }),
        ),
      'slice artifact 2 timing does not match planned clip 2',
      'video slice native timing mismatch',
    );
    const mismatchedTimingNativeVideoSliceTasks = readScopedStoredArray(services, 'tasks');
    assertEqual(
      mismatchedTimingNativeVideoSliceCommands.find((entry) => entry.kind === 'slice')?.request?.clips?.length,
      2,
      'video slice native timing mismatch test requests two planned clips',
    );
    assertEqual(
      mismatchedTimingNativeVideoSliceTasks[0]?.status,
      types.AUTOCUT_TASK_STATUS.failed,
      'video slice native timing mismatch marks the task failed',
    );
    assertIncludes(
      String(mismatchedTimingNativeVideoSliceTasks[0]?.errorMessage ?? ''),
      'slice artifact 2 timing does not match planned clip 2',
      'video slice native timing mismatch stores the timing mismatch reason',
    );
    assertEqual(readScopedStoredArray(services, 'assets').length, 0, 'video slice native timing mismatch does not persist generated assets');
    assertEqual(readScopedStoredArray(services, 'messages').length, 0, 'video slice native timing mismatch does not persist success messages');
    services.resetAutoCutNativeHostClient();
    services.configureAutoCutApprovedAiSdkBridge(null);

    resetStorage();
    const invalidLlmVideoSliceWorkflowCommands = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        contractVersion: 'contract-test',
        hostKind: 'native-host',
        databaseContractReady: true,
        sqliteMigrationReady: true,
        databaseHealthCommandReady: true,
        ffmpegProbeCommandReady: true,
        mediaImportCommandReady: true,
        mediaFileDescribeCommandReady: true,
        localVideoFileSelectCommandReady: true,
        localDirectorySelectCommandReady: true,
        audioExtractionCommandReady: false,
        audioExtractionFromAssetReady: false,
        videoGifCommandReady: false,
        videoSliceCommandReady: true,
        videoCompressCommandReady: false,
        videoConvertCommandReady: false,
        videoEnhanceCommandReady: false,
        speechTranscriptionCommandReady: true,
        speechTranscriptionToolchainReady: false,
        speechTranscriptionProbeCommandReady: true,
        speechTranscriptionFileSelectCommandReady: true,
        llmHttpCommandReady: false,
        llmSecretStoreReady: false,
        nativeTaskQueryCommandReady: true,
        nativeTaskCancelCommandReady: false,
        nativeTaskRecoveryCommandReady: false,
        nativeTaskRetryCommandReady: false,
        nativeTaskProgressEventsReady: false,
        nativeWorkerLeaseReady: true,
        ffmpegToolchainManifestReady: true,
        ffmpegToolchainResolverReady: true,
        ffmpegBundledReady: false,
        ffmpegExecutionReady: false,
        supportedCommands: ['autocut_import_media_file', 'autocut_transcribe_media', 'autocut_slice_video'],
      }),
      getDatabaseHealth: async () => ({
        ready: true,
        databasePath: 'memory',
        appliedMigrations: ['baseline'],
        verifiedTables: ['media_asset'],
        missingTables: [],
        diagnostics: [],
      }),
      probeFfmpeg: async () => ({
        available: true,
        executable: 'ffmpeg',
        sourceKind: 'system-path',
        manifestReady: true,
        bundledReady: false,
        versionLine: 'ffmpeg contract',
        diagnostics: [],
      }),
      importMediaFile: async (request) => {
        invalidLlmVideoSliceWorkflowCommands.push({ kind: 'import', request });
        return {
          assetUuid: 'invalid-llm-slice-asset',
          sandboxPath: `${configuredOutputDirectory}/inputs/invalid-llm-slice-asset.mp4`,
          byteSize: 654000,
          name: 'invalid-llm-source.mp4',
          mediaType: 'video',
          mimeType: 'video/mp4',
        };
      },
      describeLocalMediaFile: async (request) => ({
        sourcePath: request.sourcePath,
        byteSize: 654000,
        name: 'invalid-llm-source.mp4',
        mediaType: 'video',
        mimeType: 'video/mp4',
      }),
      extractAudio: async () => {
        throw new Error('audio extraction is not configured for the invalid LLM video slice workflow contract');
      },
      generateGif: async () => {
        throw new Error('video GIF is not configured for the invalid LLM video slice workflow contract');
      },
      probeSpeechTranscription: async (request) => ({
        ready: true,
        executablePath: request.executablePath,
        modelPath: request.modelPath,
        sourceKind: request.sourceKind ?? 'execution-preflight',
        diagnostics: [],
        versionLine: 'invalid LLM video slice workflow contract',
      }),
      selectSpeechTranscriptionFile: async () => null,
      transcribeMedia: async (request) => {
        invalidLlmVideoSliceWorkflowCommands.push({ kind: 'transcribe', request });
        const output = createNativeTaskOutputArtifact(
          'invalid-llm-transcript-task',
          'invalid-llm-transcript.json',
          configuredOutputDirectory,
        );
        return {
          artifactUuid: 'invalid-llm-transcript-artifact',
          taskUuid: 'invalid-llm-transcript-task',
          sourceAssetUuid: request.assetUuid,
          transcriptPath: output.artifactPath,
          taskOutputDir: output.taskOutputDir,
          language: request.language ?? 'auto',
          text:
            'Why invalid plans still need transcript fallback. Because the LLM can fail, viewers still need a complete problem and result. So the local speech plan keeps the solution and the payoff works. What makes fallback safe is clear. The case shows planning risk before rendering, so the answer is to use verified speech windows.',
          segments: [
            {
              startMs: 31000,
              endMs: 46000,
              text:
                'Why invalid plans still need transcript fallback. Because the LLM can fail, viewers still need a complete problem and result. So the local speech plan keeps the solution and the payoff works.',
              speaker: 'Speaker 1',
            },
            {
              startMs: 60000,
              endMs: 76000,
              text:
                'What makes fallback safe is clear. The case shows planning risk before rendering, so the answer is to use verified speech windows.',
              speaker: 'Speaker 1',
            },
          ],
          ffmpegExecutable: 'ffmpeg',
          speechExecutable: 'whisper-cli',
        };
      },
      sliceVideo: async (request) => {
        invalidLlmVideoSliceWorkflowCommands.push({ kind: 'slice', request });
        const taskOutputDir = createNativeTaskOutputArtifact(
          'invalid-llm-slice-task',
          'invalid-llm-slice-artifact-1.mp4',
          configuredOutputDirectory,
        ).taskOutputDir;
        return {
          taskUuid: 'invalid-llm-slice-task',
          sourceAssetUuid: request.assetUuid,
          taskOutputDir,
          ffmpegExecutable: 'ffmpeg',
          slices: request.clips.map((clip, index) => {
            const output = createNativeTaskOutputArtifact(
              'invalid-llm-slice-task',
              `invalid-llm-slice-artifact-${index + 1}.mp4`,
              configuredOutputDirectory,
            );
            const thumbnail = createNativeTaskCoverArtifact(
              'invalid-llm-slice-task',
              `invalid-llm-slice-thumb-${index + 1}.jpg`,
              configuredOutputDirectory,
            );
            return {
              artifactUuid: `invalid-llm-slice-artifact-${index + 1}`,
              artifactPath: output.artifactPath,
              thumbnailArtifactUuid: `invalid-llm-slice-thumb-${index + 1}`,
              thumbnailArtifactPath: thumbnail.artifactPath,
              taskOutputDir: output.taskOutputDir,
              byteSize: 234567,
              thumbnailByteSize: 12345,
              format: 'mp4',
              startMs: clip.startMs,
              durationMs: clip.durationMs,
              label: clip.label,
            };
          }),
        };
      },
      compressVideo: async () => {
        throw new Error('video compression is not configured for the invalid LLM video slice workflow contract');
      },
      convertVideo: async () => {
        throw new Error('video conversion is not configured for the invalid LLM video slice workflow contract');
      },
      enhanceVideo: async () => {
        throw new Error('video enhancement is not configured for the invalid LLM video slice workflow contract');
      },
      sendLlmHttpRequest: async () => {
        throw new Error('native LLM HTTP is not used because the test installs an approved AI SDK bridge');
      },
      saveLlmSecret: async (request) => ({
        secretName: request.secretName,
        saved: false,
      }),
      getLlmSecret: async (request) => ({
        secretName: request.secretName,
        configured: false,
      }),
      deleteLlmSecret: async (request) => ({
        secretName: request.secretName,
        deleted: false,
      }),
      listNativeTasks: async () => [],
      cancelNativeTask: async (request) => ({
        taskUuid: request.taskUuid,
        status: 0,
        canceled: false,
        message: 'not configured',
      }),
      recoverNativeTasks: async () => ({
        inspected: 0,
        recovered: 0,
        interrupted: 0,
        canceled: 0,
        expiredLeases: 0,
        deferred: 0,
        taskUuids: [],
      }),
      retryNativeTask: async (request) => ({
        taskUuid: request.taskUuid,
        retryTaskUuid: '',
        status: 0,
        retried: false,
        message: 'not configured',
      }),
      runAudioSmoke: async () => ({
        artifactUuid: 'native-audio-smoke',
        taskUuid: 'native-audio-smoke-task',
        sourceAssetUuid: '',
        artifactPath: createNativeTaskOutputArtifact('native-audio-smoke-task', 'native-audio-smoke.wav').artifactPath,
        taskOutputDir: createNativeTaskOutputArtifact('native-audio-smoke-task', 'native-audio-smoke.wav').taskOutputDir,
        byteSize: 1,
        format: 'wav',
        ffmpegExecutable: 'ffmpeg',
      }),
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    });
    const invalidLlmBridgeRequests = [];
    services.configureAutoCutApprovedAiSdkBridge({
      createChatCompletion: async (request, runtime) => {
        invalidLlmBridgeRequests.push({ request, runtime });
        return {
        id: 'invalid-llm-plan',
        model: request.model,
        content: 'not-json',
        runtime,
        };
      },
    });
    await services.saveAutoCutWorkspaceSettings({
      ...(await services.getAutoCutSettings()).workspace,
      outputDirectory: configuredOutputDirectory,
    });
    await saveVerifiedLocalSpeechTranscriptionSettings(services);
    await services.saveAutoCutLlmSettings({
      ...(await services.getAutoCutSettings()).llm,
      modelVendor: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: 'gemini-3-flash-preview',
      apiKey: 'sk-invalid-llm-plan',
      temperature: 0.7,
      maxTokens: 4096,
    });
    await services.saveAutoCutLlmSettings({
      ...(await services.getAutoCutSettings()).llm,
      model: 'gemini-3-flash-preview',
      temperature: 0.7,
      maxTokens: 4096,
    });
    await services.saveAutoCutLlmSettings({
      ...(await services.getAutoCutSettings()).llm,
      maxTokens: 4096,
    });
    const invalidLlmVideoSliceSourceFile = createTrustedLocalMediaFile(
      commons,
      'D:/media/invalid-llm-source.mp4',
      'invalid-llm-source.mp4',
    );
    await withImmediateTimers(async () =>
      processVideoSlice({
        fileId: 'asset-source-invalid-llm-video-slice',
        file: invalidLlmVideoSliceSourceFile,
        mode: 'contract-mode',
        llmModel: 'gemini-3-flash-preview',
        minDuration: 15,
        maxDuration: 60,
        baseAlgorithm: 'scene',
        highlightEngine: 'emotion',
        enableNoiseReduction: true,
        enableCoughFilter: true,
        enableRepeatFilter: true,
        enableSubtitles: false,
      }),
    );
    assertEqual(
      invalidLlmBridgeRequests[0]?.request?.model,
      'gemini-3-flash-preview',
      'video slice workflow passes the page-selected LLM model to the approved AI SDK bridge',
    );
    assertEqual(
      invalidLlmBridgeRequests[0]?.request?.temperature,
      0.7,
      'video slice workflow uses the Settings Center temperature for LLM planning',
    );
    assertEqual(
      invalidLlmBridgeRequests[0]?.request?.maxTokens,
      4096,
      'video slice workflow uses the Settings Center maxTokens for LLM planning',
    );
    const invalidLlmSliceCommand = invalidLlmVideoSliceWorkflowCommands.find((entry) => entry.kind === 'slice');
    assertEqual(
      invalidLlmSliceCommand?.request?.clips?.[0]?.startMs,
      30800,
      'video slice workflow keeps transcript-assisted render padding when the configured LLM returns an invalid plan',
    );
    assertEqual(
      invalidLlmSliceCommand?.request?.clips?.[0]?.label,
      'Why invalid plans still need transcript fallback',
      'video slice workflow keeps transcript-assisted labels when the configured LLM returns an invalid plan',
    );
    services.resetAutoCutNativeHostClient();
    services.configureAutoCutApprovedAiSdkBridge(null);

    resetStorage();
    const invalidDurationSliceSourceFile = createTrustedLocalMediaFile(
      commons,
      'D:/media/invalid-duration-source.mp4',
      'invalid-duration-source.mp4',
    );
    await assertRejects(
      () =>
        withImmediateTimers(async () =>
          processVideoSlice({
            fileId: 'asset-source-invalid-duration-video-slice',
            file: invalidDurationSliceSourceFile,
            mode: 'contract-mode',
            llmModel: 'deepseek-chat',
            minDuration: 90,
            maxDuration: 15,
            baseAlgorithm: 'scene',
            highlightEngine: 'emotion',
            enableNoiseReduction: true,
            enableCoughFilter: true,
            enableRepeatFilter: true,
            enableSubtitles: false,
          }),
        ),
      'minimum slice duration',
      'video slice workflow rejects inverted duration range before native work',
    );
    assertEqual(
      readScopedStoredArray(services, 'tasks').length,
      0,
      'video slice workflow does not persist a task for invalid duration range',
    );

    resetStorage();
    const shortSourceSliceCommands = [];
    const shortSourceBridgeRequests = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        mediaImportCommandReady: true,
        videoSliceCommandReady: true,
        speechTranscriptionCommandReady: true,
        speechTranscriptionToolchainReady: true,
        speechTranscriptionProbeCommandReady: true,
      }),
      importMediaFile: async (request) => {
        shortSourceSliceCommands.push({ kind: 'import', request });
        return {
          assetUuid: 'short-source-slice-asset',
          sandboxPath: 'D:/autocut-configured-output/inputs/short-source-slice-asset.mp4',
          byteSize: 123000,
          name: 'short-source.mp4',
          mediaType: 'video',
          mimeType: 'video/mp4',
          durationMs: 4000,
        };
      },
      transcribeMedia: async (request) => {
        shortSourceSliceCommands.push({ kind: 'transcribe', request });
        return createNativeVideoSliceTranscriptResult(
          request,
          'short-source-slice-transcript-task',
          configuredOutputDirectory,
          [
            {
              startMs: 0,
              endMs: 3500,
              text: 'Short source speech.',
              speaker: 'Speaker 1',
            },
          ],
        );
      },
      probeSpeechTranscription: async (request) => ({
        ready: true,
        executablePath: request.executablePath,
        modelPath: request.modelPath,
        sourceKind: request.sourceKind ?? 'execution-preflight',
        diagnostics: [],
        versionLine: 'sparse transcript speech preflight contract',
      }),
      sliceVideo: async (request) => {
        shortSourceSliceCommands.push({ kind: 'slice', request });
        return {
          taskUuid: 'short-source-slice-task',
          sourceAssetUuid: request.assetUuid,
          taskOutputDir: 'D:/autocut-configured-output/tasks/short-source-slice-task/outputs',
          ffmpegExecutable: 'ffmpeg',
          slices: [],
        };
      },
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    });
    await services.saveAutoCutLlmSettings({
      ...(await services.getAutoCutSettings()).llm,
      apiKey: 'sk-short-source-plan',
    });
    services.configureAutoCutApprovedAiSdkBridge({
      async createChatCompletion(request, runtime) {
        shortSourceBridgeRequests.push({ request, runtime });
        return {
          id: 'short-source-plan',
          model: request.model,
          content: JSON.stringify([{ startMs: 0, durationMs: 15000, label: 'Impossible short clip' }]),
          runtime,
        };
      },
    });
    const shortSourceSliceFile = createTrustedLocalMediaFile(
      commons,
      'D:/media/short-source.mp4',
      'short-source.mp4',
    );
    await assertRejects(
      () =>
        withImmediateTimers(async () =>
          processVideoSlice({
            fileId: 'asset-source-short-video-slice',
            file: shortSourceSliceFile,
            mode: 'contract-mode',
            llmModel: 'deepseek-chat',
            minDuration: 15,
            maxDuration: 60,
            baseAlgorithm: 'scene',
            highlightEngine: 'emotion',
            enableNoiseReduction: true,
            enableCoughFilter: true,
            enableRepeatFilter: true,
          }),
        ),
      'source video is too short',
      'video slice workflow rejects source media that is shorter than the minimum renderable slice',
    );
    assertEqual(
      shortSourceSliceCommands.some((entry) => entry.kind === 'slice'),
      false,
      'video slice workflow does not call native slicing when source media cannot produce any valid clip',
    );
    assertEqual(
      shortSourceBridgeRequests.length,
      0,
      'video slice workflow does not call the LLM planner when the source media is too short for any valid clip',
    );
    const shortSourceSliceTask = readScopedStoredArray(services, 'tasks')[0];
    assertEqual(
      shortSourceSliceTask?.status,
      types.AUTOCUT_TASK_STATUS.failed,
      'video slice workflow persists a failed task for source media that is too short to slice',
    );
    assertRule(
      String(shortSourceSliceTask?.errorMessage ?? '').includes('source video is too short'),
      'video slice workflow explains the short-source failure on the persisted task',
    );
    services.configureAutoCutApprovedAiSdkBridge(null);

    resetStorage();
    const unknownDurationShortTranscriptCommands = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        mediaImportCommandReady: true,
        videoSliceCommandReady: true,
        speechTranscriptionCommandReady: true,
        speechTranscriptionToolchainReady: true,
        speechTranscriptionProbeCommandReady: true,
      }),
      importMediaFile: async (request) => {
        unknownDurationShortTranscriptCommands.push({ kind: 'import', request });
        return {
          assetUuid: 'unknown-duration-short-transcript-asset',
          sandboxPath: 'D:/autocut-configured-output/inputs/unknown-duration-short-transcript.mp4',
          byteSize: 456000,
          name: 'unknown-duration-short-transcript.mp4',
          mediaType: 'video',
          mimeType: 'video/mp4',
        };
      },
      transcribeMedia: async (request) => {
        unknownDurationShortTranscriptCommands.push({ kind: 'transcribe', request });
        return {
          artifactUuid: 'unknown-duration-short-transcript-artifact',
          taskUuid: 'unknown-duration-short-transcript-task',
          sourceAssetUuid: request.assetUuid,
          transcriptPath: 'D:/autocut-configured-output/tasks/unknown-duration-short-transcript-task/outputs/transcript.json',
          taskOutputDir: 'D:/autocut-configured-output/tasks/unknown-duration-short-transcript-task/outputs',
          language: 'auto',
          text: 'Short speech only',
          segments: [
            {
              startMs: 0,
              endMs: 4000,
              text: 'Short speech only',
              speaker: 'Speaker 1',
            },
          ],
          ffmpegExecutable: 'ffmpeg',
          speechExecutable: 'whisper-cli',
        };
      },
      probeSpeechTranscription: async (request) => ({
        ready: true,
        executablePath: request.executablePath,
        modelPath: request.modelPath,
        sourceKind: request.sourceKind ?? 'execution-preflight',
        diagnostics: [],
        versionLine: 'unknown duration short transcript speech preflight contract',
      }),
      sliceVideo: async (request) => {
        unknownDurationShortTranscriptCommands.push({ kind: 'slice', request });
        const output = createNativeTaskOutputArtifact(
          'unknown-duration-short-transcript-slice-task',
          'unknown-duration-short-transcript-slice.mp4',
          configuredOutputDirectory,
        );
        const thumbnail = createNativeTaskCoverArtifact(
          'unknown-duration-short-transcript-slice-task',
          'unknown-duration-short-transcript-thumb.jpg',
          configuredOutputDirectory,
        );
        return {
          taskUuid: 'unknown-duration-short-transcript-slice-task',
          sourceAssetUuid: request.assetUuid,
          taskOutputDir: output.taskOutputDir,
          ffmpegExecutable: 'ffmpeg',
          slices: [
            {
              artifactUuid: 'unknown-duration-short-transcript-slice-artifact',
              artifactPath: output.artifactPath,
              thumbnailArtifactUuid: 'unknown-duration-short-transcript-thumb-artifact',
              thumbnailArtifactPath: thumbnail.artifactPath,
              taskOutputDir: output.taskOutputDir,
              byteSize: 123456,
              thumbnailByteSize: 1234,
              format: 'mp4',
              startMs: request.clips[0].startMs,
              durationMs: request.clips[0].durationMs,
              label: request.clips[0].label,
            },
          ],
        };
      },
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    });
    const unknownDurationShortTranscriptFile = createTrustedLocalMediaFile(
      commons,
      'D:/media/unknown-duration-short-transcript.mp4',
      'unknown-duration-short-transcript.mp4',
    );
    await withImmediateTimers(async () =>
      processVideoSlice({
        fileId: 'asset-source-unknown-duration-short-transcript',
        file: unknownDurationShortTranscriptFile,
        mode: 'contract-mode',
        llmModel: 'gemini-3-flash-preview',
        minDuration: 15,
        maxDuration: 60,
        baseAlgorithm: 'scene',
        highlightEngine: 'emotion',
        enableNoiseReduction: true,
        enableCoughFilter: true,
        enableRepeatFilter: true,
        enableSubtitles: false,
      }),
    );
    const unknownDurationShortTranscriptSliceCommand = unknownDurationShortTranscriptCommands.find((entry) => entry.kind === 'slice');
    const unknownDurationShortTranscriptTask = readScopedStoredArray(services, 'tasks')
      .find((task) => task.id === 'unknown-duration-short-transcript-slice-task');
    assertRule(
      Boolean(unknownDurationShortTranscriptSliceCommand),
      'video slice workflow renders a short speech-aligned clip when imported media duration is unknown but STT has verified speech evidence',
    );
    assertRule(
      unknownDurationShortTranscriptSliceCommand?.request?.clips?.every((clip) => clip.durationMs >= 1000 && clip.durationMs < 5000),
      'video slice workflow keeps unknown-duration short transcript clips above the speech-aligned minimum without padding them to the requested duration',
    );
    assertRule(
      unknownDurationShortTranscriptSliceCommand?.request?.clips?.every((clip) => clip.transcriptText === 'Short speech only'),
      'video slice workflow sends native slicing transcript text for unknown-duration short transcript clips',
    );
    assertRule(
      unknownDurationShortTranscriptSliceCommand?.request?.clips?.every((clip) => clip.transcriptSegmentCount === 1),
      'video slice workflow sends native slicing structured transcript counts for unknown-duration short transcript clips',
    );
    assertEqual(
      unknownDurationShortTranscriptTask?.status,
      types.AUTOCUT_TASK_STATUS.completed,
      'video slice workflow completes unknown-duration short transcript smart slicing with verified STT evidence',
    );
    assertRule(
      unknownDurationShortTranscriptTask?.sliceResults?.every((slice) => slice.transcriptText === 'Short speech only' && slice.transcriptCoverageScore >= 0.8),
      'video slice workflow records transcript evidence on unknown-duration short transcript slice results',
    );

    resetStorage();
    const isolatedMicroSpeechCommands = [];
    const isolatedMicroSpeechBridgeRequests = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        mediaImportCommandReady: true,
        videoSliceCommandReady: true,
        speechTranscriptionCommandReady: true,
        speechTranscriptionToolchainReady: true,
        speechTranscriptionProbeCommandReady: true,
      }),
      importMediaFile: async (request) => {
        isolatedMicroSpeechCommands.push({ kind: 'import', request });
        return {
          assetUuid: 'isolated-micro-speech-asset',
          sandboxPath: 'D:/autocut-configured-output/inputs/isolated-micro-speech.mp4',
          byteSize: 789000,
          name: 'isolated-micro-speech.mp4',
          mediaType: 'video',
          mimeType: 'video/mp4',
          durationMs: 90000,
        };
      },
      transcribeMedia: async (request) => {
        isolatedMicroSpeechCommands.push({ kind: 'transcribe', request });
        const output = createNativeTaskOutputArtifact(
          'isolated-micro-speech-transcript-task',
          'isolated-micro-speech-transcript.json',
          configuredOutputDirectory,
        );
        return {
          artifactUuid: 'isolated-micro-speech-transcript-artifact',
          taskUuid: 'isolated-micro-speech-transcript-task',
          sourceAssetUuid: request.assetUuid,
          transcriptPath: output.artifactPath,
          taskOutputDir: output.taskOutputDir,
          language: request.language ?? 'auto',
          text: 'Tiny isolated speech. Another tiny isolated speech.',
          segments: [
            {
              startMs: 10000,
              endMs: 12000,
              text: 'Tiny isolated speech.',
              speaker: 'Speaker 1',
            },
            {
              startMs: 40000,
              endMs: 42000,
              text: 'Another tiny isolated speech.',
              speaker: 'Speaker 1',
            },
          ],
          ffmpegExecutable: 'ffmpeg',
          speechExecutable: 'whisper-cli',
        };
      },
      probeSpeechTranscription: async (request) => ({
        ready: true,
        executablePath: request.executablePath,
        modelPath: request.modelPath,
        sourceKind: request.sourceKind ?? 'execution-preflight',
        diagnostics: [],
        versionLine: 'transcript candidate speech preflight contract',
      }),
      sliceVideo: async (request) => {
        isolatedMicroSpeechCommands.push({ kind: 'slice', request });
        const output = createNativeTaskOutputArtifact(
          'isolated-micro-speech-slice-task',
          'isolated-micro-speech-slice-artifact-1.mp4',
          configuredOutputDirectory,
        );
        const thumbnail = createNativeTaskCoverArtifact(
          'isolated-micro-speech-slice-task',
          'isolated-micro-speech-slice-thumb-1.jpg',
          configuredOutputDirectory,
        );
        return {
          taskUuid: 'isolated-micro-speech-slice-task',
          sourceAssetUuid: request.assetUuid,
          taskOutputDir: output.taskOutputDir,
          ffmpegExecutable: 'ffmpeg',
          slices: request.clips.map((clip, index) => ({
            artifactUuid: `isolated-micro-speech-slice-artifact-${index + 1}`,
            artifactPath: index === 0
              ? output.artifactPath
              : createNativeTaskOutputArtifact(
                  'isolated-micro-speech-slice-task',
                  `isolated-micro-speech-slice-artifact-${index + 1}.mp4`,
                  configuredOutputDirectory,
                ).artifactPath,
            thumbnailArtifactUuid: `isolated-micro-speech-slice-thumb-${index + 1}`,
            thumbnailArtifactPath: index === 0
              ? thumbnail.artifactPath
              : createNativeTaskCoverArtifact(
                  'isolated-micro-speech-slice-task',
                  `isolated-micro-speech-slice-thumb-${index + 1}.jpg`,
                  configuredOutputDirectory,
                ).artifactPath,
            taskOutputDir: output.taskOutputDir,
            byteSize: 223344,
            thumbnailByteSize: 1234,
            format: 'mp4',
            startMs: clip.startMs,
            durationMs: clip.durationMs,
            label: clip.label,
          })),
        };
      },
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    });
    await services.saveAutoCutLlmSettings({
      ...(await services.getAutoCutSettings()).llm,
      apiKey: 'sk-isolated-micro-speech-plan',
    });
    services.configureAutoCutApprovedAiSdkBridge({
      async createChatCompletion(request, runtime) {
        isolatedMicroSpeechBridgeRequests.push({ request, runtime });
        return {
          id: 'isolated-micro-speech-plan',
          model: request.model,
          content: JSON.stringify([{ startMs: 0, durationMs: 15000, label: 'Bad silent filler' }]),
          runtime,
        };
      },
    });
    const isolatedMicroSpeechFile = createTrustedLocalMediaFile(
      commons,
      'D:/media/isolated-micro-speech.mp4',
      'isolated-micro-speech.mp4',
    );
    await withImmediateTimers(async () =>
      processVideoSlice({
        fileId: 'asset-source-isolated-micro-speech',
        file: isolatedMicroSpeechFile,
        mode: 'contract-mode',
        llmModel: 'deepseek-v4-flash',
        targetPlatform: 'douyin',
        targetAspectRatio: '9:16',
        videoObjectFit: 'cover',
        sliceCountMode: 'qualityFirst',
        targetSliceCount: 3,
        minDuration: 15,
        maxDuration: 60,
        baseAlgorithm: 'scene',
        highlightEngine: 'keyword',
        enableNoiseReduction: true,
        enableCoughFilter: true,
        enableRepeatFilter: true,
      }),
    );
    assertEqual(
      isolatedMicroSpeechBridgeRequests.length,
      1,
      'video slice workflow exposes sparse transcript fallback candidates to the LLM planner instead of asking it to invent silent timings',
    );
    const isolatedMicroSpeechPrompt = JSON.parse(
      isolatedMicroSpeechBridgeRequests[0]?.request?.messages?.[1]?.content ?? '{}',
    );
    const isolatedMicroSpeechSliceRequest = isolatedMicroSpeechCommands.find((entry) => entry.kind === 'slice')?.request;
    const isolatedMicroSpeechTask = readScopedStoredArray(services, 'tasks')
      .find((task) => task.id === 'isolated-micro-speech-slice-task');
    assertRule(
      isolatedMicroSpeechPrompt?.candidateWindows?.every((candidate) => candidate.risks?.includes('sparse-transcript-speech')),
      'video slice workflow labels sparse transcript fallback candidates for LLM review',
    );
    assertRule(
      isolatedMicroSpeechSliceRequest?.clips?.length >= 1,
      'video slice workflow calls native slicing for isolated micro speech when STT evidence is verified',
    );
    assertRule(
      isolatedMicroSpeechSliceRequest?.clips?.every((clip) => clip.durationMs >= 1000 && clip.durationMs < 3000),
      'video slice workflow renders isolated micro speech as short speech-aligned windows instead of silent padded clips',
    );
    assertRule(
      isolatedMicroSpeechSliceRequest?.clips?.every((clip) => clip.transcriptText?.trim() && clip.transcriptCoverageScore >= 0.8),
      'video slice workflow sends transcript evidence with isolated micro speech native clip requests',
    );
    assertEqual(
      isolatedMicroSpeechTask?.status,
      types.AUTOCUT_TASK_STATUS.completed,
      'video slice workflow completes isolated micro speech smart slicing when short STT-backed clips are valid',
    );
    assertRule(
      isolatedMicroSpeechTask?.sliceResults?.every((slice) => slice.risks?.includes('sparse-transcript-speech')),
      'video slice workflow records sparse transcript review risk on isolated micro speech slice results',
    );
    services.configureAutoCutApprovedAiSdkBridge(null);

    resetStorage();
    const sparseTranscriptSliceCommands = [];
    const sparseTranscriptBridgeRequests = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        mediaImportCommandReady: true,
        videoSliceCommandReady: true,
        speechTranscriptionCommandReady: true,
        speechTranscriptionToolchainReady: true,
        speechTranscriptionProbeCommandReady: true,
      }),
      importMediaFile: async (request) => {
        sparseTranscriptSliceCommands.push({ kind: 'import', request });
        return {
          assetUuid: 'sparse-transcript-slice-asset',
          sandboxPath: 'D:/autocut-configured-output/inputs/sparse-transcript-source.mp4',
          byteSize: 654000,
          name: 'sparse-transcript-source.mp4',
          mediaType: 'video',
          mimeType: 'video/mp4',
          durationMs: 90000,
        };
      },
      transcribeMedia: async (request) => {
        sparseTranscriptSliceCommands.push({ kind: 'transcribe', request });
        const output = createNativeTaskOutputArtifact(
          'sparse-transcript-task',
          'sparse-transcript.json',
          configuredOutputDirectory,
        );
        return {
          artifactUuid: 'sparse-transcript-artifact',
          taskUuid: 'sparse-transcript-task',
          sourceAssetUuid: request.assetUuid,
          transcriptPath: output.artifactPath,
          taskOutputDir: output.taskOutputDir,
          language: request.language ?? 'auto',
          text: 'How to remove silent intros from short video clips. How to remove silent intros from short video clips. Then keep only the complete spoken payoff.',
          segments: [
            {
              startMs: 10000,
              endMs: 15600,
              text: 'How to remove silent intros from short video clips.',
              speaker: 'Speaker 1',
            },
            {
              startMs: 31000,
              endMs: 36600,
              text: 'How to remove silent intros from short video clips.',
              speaker: 'Speaker 1',
            },
            {
              startMs: 55000,
              endMs: 60700,
              text: 'Then keep only the complete spoken payoff.',
              speaker: 'Speaker 1',
            },
          ],
          ffmpegExecutable: 'ffmpeg',
          speechExecutable: 'whisper-cli',
        };
      },
      probeSpeechTranscription: async (request) => ({
        ready: true,
        executablePath: request.executablePath,
        modelPath: request.modelPath,
        sourceKind: request.sourceKind ?? 'execution-preflight',
        diagnostics: [],
        versionLine: 'sparse transcript speech preflight contract',
      }),
      sliceVideo: async (request) => {
        sparseTranscriptSliceCommands.push({ kind: 'slice', request });
        const output = createNativeTaskOutputArtifact(
          'sparse-transcript-slice-task',
          'sparse-transcript-slice-artifact-1.mp4',
          configuredOutputDirectory,
        );
        const thumbnail = createNativeTaskCoverArtifact(
          'sparse-transcript-slice-task',
          'sparse-transcript-slice-thumb-1.jpg',
          configuredOutputDirectory,
        );
        return {
          taskUuid: 'sparse-transcript-slice-task',
          sourceAssetUuid: request.assetUuid,
          taskOutputDir: output.taskOutputDir,
          ffmpegExecutable: 'ffmpeg',
          slices: request.clips.map((clip, index) => ({
            artifactUuid: `sparse-transcript-slice-artifact-${index + 1}`,
            artifactPath: index === 0
              ? output.artifactPath
              : createNativeTaskOutputArtifact(
                  'sparse-transcript-slice-task',
                  `sparse-transcript-slice-artifact-${index + 1}.mp4`,
                  configuredOutputDirectory,
                ).artifactPath,
            thumbnailArtifactUuid: `sparse-transcript-slice-thumb-${index + 1}`,
            thumbnailArtifactPath: index === 0
              ? thumbnail.artifactPath
              : createNativeTaskCoverArtifact(
                  'sparse-transcript-slice-task',
                  `sparse-transcript-slice-thumb-${index + 1}.jpg`,
                  configuredOutputDirectory,
                ).artifactPath,
            taskOutputDir: output.taskOutputDir,
            byteSize: 234567,
            thumbnailByteSize: 12345,
            format: 'mp4',
            startMs: clip.startMs,
            durationMs: clip.durationMs,
            label: clip.label,
          })),
        };
      },
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    });
    await services.saveAutoCutWorkspaceSettings({
      ...(await services.getAutoCutSettings()).workspace,
      outputDirectory: configuredOutputDirectory,
    });
    await saveVerifiedLocalSpeechTranscriptionSettings(services);
    await services.saveAutoCutLlmSettings({
      ...(await services.getAutoCutSettings()).llm,
      apiKey: 'sk-sparse-transcript-plan',
    });
    services.configureAutoCutApprovedAiSdkBridge({
      async createChatCompletion(request, runtime) {
        sparseTranscriptBridgeRequests.push({ request, runtime });
        const prompt = JSON.parse(request.messages?.[1]?.content ?? '{}');
        const selectedCandidate =
          prompt.candidateWindows?.find((candidate) => candidate.risks?.includes('transcript-repeat-filtered')) ??
          prompt.candidateWindows?.[0];
        return {
          id: 'sparse-transcript-plan',
          model: request.model,
          content: JSON.stringify([
            {
              candidateId: selectedCandidate?.id,
              title: 'Trimmed speech candidate',
              qualityScore: 0.9,
              continuityScore: 0.9,
            },
          ]),
          runtime,
        };
      },
    });
    const sparseTranscriptSliceSourceFile = createTrustedLocalMediaFile(
      commons,
      'D:/media/sparse-transcript-source.mp4',
      'sparse-transcript-source.mp4',
    );
    await withImmediateTimers(async () =>
      processVideoSlice({
        fileId: 'asset-source-sparse-transcript-video-slice',
        file: sparseTranscriptSliceSourceFile,
        mode: 'contract-mode',
        llmModel: 'deepseek-v4-flash',
        targetPlatform: 'douyin',
        targetAspectRatio: '9:16',
        videoObjectFit: 'cover',
        sliceCountMode: 'qualityFirst',
        targetSliceCount: 3,
        minDuration: 15,
        maxDuration: 60,
        baseAlgorithm: 'scene',
        highlightEngine: 'keyword',
        enableNoiseReduction: true,
        enableCoughFilter: true,
        enableRepeatFilter: true,
        enableSubtitles: false,
      }),
    );
    const sparseTranscriptPrompt = JSON.parse(
      sparseTranscriptBridgeRequests[0]?.request?.messages?.[1]?.content ?? '{}',
    );
    const sparseTranscriptSliceRequest = sparseTranscriptSliceCommands.find((entry) => entry.kind === 'slice')?.request;
    const sparseTranscriptTask = readScopedStoredArray(services, 'tasks')
      .find((task) => task.id === 'sparse-transcript-slice-task');
    assertEqual(
      sparseTranscriptPrompt?.candidateWindows?.length,
      2,
      'video slice workflow removes repeated speech-to-text candidate windows before asking the LLM planner',
    );
    assertRule(
      sparseTranscriptPrompt?.candidateWindows?.some((candidate) => candidate.risks?.includes('transcript-repeat-filtered')),
      'video slice workflow tells the LLM when repeated speech-to-text content was filtered',
    );
    assertRule(
      sparseTranscriptSliceRequest?.clips?.every((clip) => clip.durationMs < 7000),
      'video slice workflow sends native slicing short speech-aligned windows instead of padding sparse speech to the requested minimum duration',
    );
    assertRule(
      sparseTranscriptSliceRequest?.clips?.every((clip) => clip.startMs >= 9800),
      'video slice workflow trims leading silence before native rendering sparse transcript windows',
    );
    assertRule(
      sparseTranscriptTask?.sliceResults?.every((slice) => (slice.boundaryPaddingAfterMs ?? 0) <= 500),
      'video slice workflow records short trailing speech boundary padding for sparse transcript slices',
    );
    assertRule(
      sparseTranscriptTask?.sliceResults?.some((slice) => slice.risks?.includes('transcript-repeat-filtered')),
      'video slice workflow records repeated transcript filtering on task slice results',
    );
    services.configureAutoCutApprovedAiSdkBridge(null);

    resetStorage();
    const transcriptCandidateSliceCommands = [];
    const transcriptCandidateBridgeRequests = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        mediaImportCommandReady: true,
        videoSliceCommandReady: true,
        speechTranscriptionCommandReady: true,
        speechTranscriptionToolchainReady: true,
        speechTranscriptionProbeCommandReady: true,
      }),
      importMediaFile: async (request) => {
        transcriptCandidateSliceCommands.push({ kind: 'import', request });
        return {
          assetUuid: 'transcript-candidate-slice-asset',
          sandboxPath: 'D:/autocut-configured-output/inputs/transcript-candidate-slice-asset.mp4',
          byteSize: 654000,
          name: 'transcript-candidate-source.mp4',
          mediaType: 'video',
          mimeType: 'video/mp4',
          durationMs: 62000,
        };
      },
      transcribeMedia: async (request) => {
        transcriptCandidateSliceCommands.push({ kind: 'transcribe', request });
        const output = createNativeTaskOutputArtifact(
          'transcript-candidate-task',
          'transcript-candidate-transcript.json',
          configuredOutputDirectory,
        );
        return {
          artifactUuid: 'transcript-candidate-transcript-artifact',
          taskUuid: 'transcript-candidate-task',
          sourceAssetUuid: request.assetUuid,
          transcriptPath: output.artifactPath,
          taskOutputDir: output.taskOutputDir,
          language: request.language ?? 'auto',
          text: 'Watch this case background. Then the real spike comes from concentrated user pain. So this is the complete short-video payoff.',
          segments: [
            {
              startMs: 0,
              endMs: 12000,
              text: 'Watch this case background.',
              speaker: 'Speaker 1',
            },
            {
              startMs: 12000,
              endMs: 26000,
              text: 'Then the real spike comes from concentrated user pain.',
              speaker: 'Speaker 1',
            },
            {
              startMs: 26000,
              endMs: 41000,
              text: 'So this is the complete short-video payoff.',
              speaker: 'Speaker 1',
            },
          ],
          ffmpegExecutable: 'ffmpeg',
          speechExecutable: 'whisper-cli',
        };
      },
      probeSpeechTranscription: async (request) => ({
        ready: true,
        executablePath: request.executablePath,
        modelPath: request.modelPath,
        sourceKind: request.sourceKind ?? 'execution-preflight',
        diagnostics: [],
        versionLine: 'transcript candidate speech preflight contract',
      }),
      sliceVideo: async (request) => {
        transcriptCandidateSliceCommands.push({ kind: 'slice', request });
        const output = createNativeTaskOutputArtifact(
          'transcript-candidate-slice-task',
          'transcript-candidate-slice-artifact-1.mp4',
          configuredOutputDirectory,
        );
        const thumbnail = createNativeTaskCoverArtifact(
          'transcript-candidate-slice-task',
          'transcript-candidate-slice-thumb-1.jpg',
          configuredOutputDirectory,
        );
        return {
          taskUuid: 'transcript-candidate-slice-task',
          sourceAssetUuid: request.assetUuid,
          taskOutputDir: output.taskOutputDir,
          ffmpegExecutable: 'ffmpeg',
          slices: [
            {
              artifactUuid: 'transcript-candidate-slice-artifact-1',
              artifactPath: output.artifactPath,
              thumbnailArtifactUuid: 'transcript-candidate-slice-thumb-1',
              thumbnailArtifactPath: thumbnail.artifactPath,
              taskOutputDir: output.taskOutputDir,
              byteSize: 234567,
              thumbnailByteSize: 12345,
              format: 'mp4',
              startMs: request.clips[0].startMs,
              durationMs: request.clips[0].durationMs,
              label: request.clips[0].label,
            },
          ],
        };
      },
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    });
    await services.saveAutoCutWorkspaceSettings({
      ...(await services.getAutoCutSettings()).workspace,
      outputDirectory: configuredOutputDirectory,
    });
    await saveVerifiedLocalSpeechTranscriptionSettings(services);
    await services.saveAutoCutLlmSettings({
      ...(await services.getAutoCutSettings()).llm,
      apiKey: 'sk-transcript-candidate-plan',
    });
    services.configureAutoCutApprovedAiSdkBridge({
      async createChatCompletion(request, runtime) {
        transcriptCandidateBridgeRequests.push({ request, runtime });
        const prompt = JSON.parse(request.messages?.[1]?.content ?? '{}');
        const selectedCandidate =
          prompt.candidateWindows?.find((candidate) => candidate.transcriptSegmentCount === 3) ??
          prompt.candidateWindows?.find((candidate) => candidate.speechEndMs === 41000) ??
          prompt.candidateWindows?.[0];
        return {
          id: 'transcript-candidate-plan',
          model: request.model,
          content: JSON.stringify([
            {
              candidateId: selectedCandidate?.id,
              startMs: 12000,
              durationMs: 15000,
              title: '爆发原因',
              summary: 'Explains the spike cause and audience pain point.',
              reason: 'Complete setup and payoff for a coherent short video.',
              qualityScore: 0.92,
              continuityScore: 0.88,
              risks: ['needs-cover-title'],
            },
          ]),
          runtime,
        };
      },
    });
    const transcriptCandidateSliceSourceFile = createTrustedLocalMediaFile(
      commons,
      'D:/media/transcript-candidate-source.mp4',
      'transcript-candidate-source.mp4',
    );
    await withImmediateTimers(async () =>
      processVideoSlice({
        fileId: 'asset-source-transcript-candidate-video-slice',
        file: transcriptCandidateSliceSourceFile,
        mode: 'contract-mode',
        llmModel: 'deepseek-v4-flash',
        targetPlatform: 'douyin',
        targetAspectRatio: '9:16',
        videoObjectFit: 'cover',
        sliceCountMode: 'qualityFirst',
        targetSliceCount: 3,
        idealDuration: 45,
        continuityLevel: 'standard',
        customKeywords: ['retention'],
        minDuration: 15,
        maxDuration: 60,
        baseAlgorithm: 'scene',
        highlightEngine: 'keyword',
        enableNoiseReduction: true,
        enableCoughFilter: true,
        enableRepeatFilter: true,
        enableSubtitles: false,
      }),
    );
    const transcriptCandidatePrompt = JSON.parse(
      transcriptCandidateBridgeRequests[0]?.request?.messages?.[1]?.content ?? '{}',
    );
    const transcriptCandidateWindow =
      transcriptCandidatePrompt?.candidateWindows?.find((candidate) => candidate.transcriptSegmentCount === 3) ??
      transcriptCandidatePrompt?.candidateWindows?.find((candidate) => candidate.speechEndMs === 41000) ??
      transcriptCandidatePrompt?.candidateWindows?.[0];
    const transcriptCandidateSliceRequest = transcriptCandidateSliceCommands.find((entry) => entry.kind === 'slice')?.request;
    const transcriptCandidateTask = readScopedStoredArray(services, 'tasks')
      .find((task) => task.id === 'transcript-candidate-slice-task');
    assertRule(
      Boolean(transcriptCandidateWindow),
      'video slice workflow sends transcript-derived candidate windows to the LLM planner',
    );
    assertEqual(
      transcriptCandidateWindow?.transcriptSegmentCount,
      3,
      'video slice workflow sends transcript segment counts in transcript-derived candidate windows',
    );
    assertEqual(
      transcriptCandidateWindow?.transcriptCoverageScore,
      1,
      'video slice workflow sends transcript coverage scores in transcript-derived candidate windows',
    );
    assertEqual(
      transcriptCandidateWindow?.speechContinuityGrade,
      'repaired',
      'video slice workflow sends speech continuity grades in transcript-derived candidate windows',
    );
    assertEqual(
      typeof transcriptCandidateWindow?.storyShape,
      'string',
      'video slice workflow sends story-shape metadata in transcript-derived candidate windows',
    );
    assertNumberBetween(
      transcriptCandidateWindow?.boundaryQualityScore,
      0.65,
      1,
      'video slice workflow sends boundary quality scores in transcript-derived candidate windows',
    );
    assertRule(
      ['strong', 'contextual', 'weak'].includes(transcriptCandidateWindow?.hookStrength),
      'video slice workflow sends hook strength grades in transcript-derived candidate windows',
    );
    assertRule(
      ['complete', 'soft', 'open'].includes(transcriptCandidateWindow?.endingCompleteness),
      'video slice workflow sends ending completeness grades in transcript-derived candidate windows',
    );
    assertNumberBetween(
      transcriptCandidateWindow?.contentArcScore,
      0.65,
      1,
      'video slice workflow sends content-arc scores in transcript-derived candidate windows',
    );
    assertRule(
      ['complete', 'partial', 'thin'].includes(transcriptCandidateWindow?.contentArcGrade),
      'video slice workflow sends content-arc grades in transcript-derived candidate windows',
    );
    assertArrayIncludes(
      transcriptCandidateWindow?.contentArcStages,
      'payoff',
      'video slice workflow sends detected content-arc stages in transcript-derived candidate windows',
    );
    assertNumberBetween(
      transcriptCandidateWindow?.topicCoherenceScore,
      0.65,
      1,
      'video slice workflow sends topic coherence scores in transcript-derived candidate windows',
    );
    assertRule(
      ['strong', 'mixed', 'weak'].includes(transcriptCandidateWindow?.topicCoherenceGrade),
      'video slice workflow sends topic coherence grades in transcript-derived candidate windows',
    );
    assertRule(
      typeof transcriptCandidateWindow?.topicShiftCount === 'number',
      'video slice workflow sends topic shift counts in transcript-derived candidate windows',
    );
    assertRule(
      Array.isArray(transcriptCandidateWindow?.topicKeywords),
      'video slice workflow sends topic keywords in transcript-derived candidate windows',
    );
    assertNumberBetween(
      transcriptCandidateWindow?.platformReadinessScore,
      0.65,
      1,
      'video slice workflow sends platform readiness scores in transcript-derived candidate windows',
    );
    assertRule(
      ['ready', 'review', 'reject'].includes(transcriptCandidateWindow?.platformReadinessGrade),
      'video slice workflow sends platform readiness grades in transcript-derived candidate windows',
    );
    assertRule(
      Array.isArray(transcriptCandidateWindow?.platformReadinessIssues),
      'video slice workflow sends platform readiness issue tags in transcript-derived candidate windows',
    );
    assertNumberBetween(
      transcriptCandidateWindow?.sentenceBoundaryIntegrityScore,
      0,
      1,
      'video slice workflow sends sentence boundary integrity scores in transcript-derived candidate windows',
    );
    assertRule(
      ['clean', 'repaired', 'broken'].includes(transcriptCandidateWindow?.sentenceBoundaryIntegrityGrade),
      'video slice workflow sends sentence boundary integrity grades in transcript-derived candidate windows',
    );
    assertRule(
      Array.isArray(transcriptCandidateWindow?.sentenceBoundaryIssues),
      'video slice workflow sends sentence boundary issue tags in transcript-derived candidate windows',
    );
    assertEqual(
      transcriptCandidatePrompt?.requestedClipCount,
      3,
      'video slice workflow sends the strategy target slice count to the LLM planner',
    );
    assertEqual(
      transcriptCandidatePrompt?.planningPolicy?.sourceDurationMs,
      62000,
      'video slice workflow sends imported media duration to the LLM planner policy',
    );
    assertEqual(
      transcriptCandidatePrompt?.publishingTarget?.aspectRatio,
      '9:16',
      'video slice workflow sends target publishing aspect ratio to the LLM planner',
    );
    assertEqual(
      transcriptCandidatePrompt?.customKeywords?.[0],
      'retention',
      'video slice workflow sends custom keywords to the LLM planner',
    );
    assertEqual(
      transcriptCandidateSliceRequest?.renderProfile?.targetAspectRatio,
      '9:16',
      'video slice workflow sends target aspect ratio to native slice rendering',
    );
    assertEqual(
      transcriptCandidateSliceRequest?.renderProfile?.objectFit,
      'cover',
      'video slice workflow sends target object-fit to native slice rendering',
    );
    assertEqual(
      transcriptCandidateSliceRequest?.clips?.[0]?.qualityScore,
      undefined,
      'video slice workflow keeps AI planning metadata out of native slice clip requests',
    );
    assertEqual(
      transcriptCandidateSliceRequest?.clips?.[0]?.startMs,
      0,
      'video slice workflow expands connector-led transcript candidates backward for context continuity and clamps leading padding at source start',
    );
    assertEqual(
      transcriptCandidateSliceRequest?.clips?.[0]?.durationMs,
      41250,
      'video slice workflow keeps the repaired connector-led candidate through the complete payoff segment with trailing boundary padding',
    );
    assertEqual(
      transcriptCandidateSliceRequest?.clips?.[0]?.outputFileName,
      '01-爆发原因.mp4',
      'video slice workflow preserves non-English LLM smart-slice titles in native output filenames',
    );
    assertRule(
      transcriptCandidateSliceRequest?.clips?.every((clip, index, clips) =>
        index === 0 || clip.startMs >= clips[index - 1].startMs + clips[index - 1].durationMs,
      ),
      'video slice workflow keeps repaired transcript candidate clips non-overlapping',
    );
    assertEqual(
      transcriptCandidateTask?.sliceResults?.[0]?.qualityScore,
      0.92,
      'video slice workflow preserves AI quality score on task slice results',
    );
    assertEqual(
      transcriptCandidateTask?.sliceResults?.[0]?.name,
      '01-爆发原因.mp4',
      'video slice workflow names persisted slice results from non-English LLM smart-slice titles',
    );
    assertEqual(
      transcriptCandidateTask?.sliceResults?.[0]?.continuityScore,
      0.88,
      'video slice workflow preserves AI continuity score on task slice results',
    );
    assertEqual(
      typeof transcriptCandidateTask?.sliceResults?.[0]?.storyShape,
      'string',
      'video slice workflow preserves planner story-shape metadata on task slice results',
    );
    assertEqual(
      transcriptCandidateTask?.sliceResults?.[0]?.summary,
      'Explains the spike cause and audience pain point.',
      'video slice workflow preserves AI summary on task slice results',
    );
    assertEqual(
      transcriptCandidateTask?.sliceResults?.[0]?.reason,
      'Complete setup and payoff for a coherent short video.',
      'video slice workflow preserves AI selection reason on task slice results',
    );
    assertEqual(
      transcriptCandidateTask?.sliceResults?.[0]?.risks?.[0],
      'needs-cover-title',
      'video slice workflow preserves AI publishing risks on task slice results',
    );
    assertEqual(
      transcriptCandidateTask?.sliceResults?.[0]?.sourceStartMs,
      0,
      'video slice workflow records repaired source start metadata on slice results',
    );
    assertEqual(
      transcriptCandidateTask?.sliceResults?.[0]?.sourceEndMs,
      41250,
      'video slice workflow records padded source end metadata on slice results',
    );
    assertEqual(
      transcriptCandidateTask?.sliceResults?.[0]?.speechStartMs,
      0,
      'video slice workflow records repaired speech start metadata on slice results',
    );
    assertEqual(
      transcriptCandidateTask?.sliceResults?.[0]?.speechEndMs,
      41000,
      'video slice workflow records repaired speech end metadata on slice results',
    );
    assertEqual(
      transcriptCandidateTask?.sliceResults?.[0]?.boundaryPaddingAfterMs,
      250,
      'video slice workflow records speech boundary padding metadata on slice results',
    );
    assertEqual(
      transcriptCandidateTask?.sliceResults?.[0]?.transcriptText,
      transcriptCandidateWindow?.text,
      'video slice workflow records repaired transcript text on slice results',
    );
    assertEqual(
      transcriptCandidateTask?.sliceResults?.[0]?.transcriptSegmentCount,
      3,
      'video slice workflow records structured speech-to-text segment counts on slice results',
    );
    assertEqual(
      transcriptCandidateTask?.sliceResults?.[0]?.transcriptSegments?.[2]?.text,
      'So this is the complete short-video payoff.',
      'video slice workflow records structured speech-to-text transcript segments on slice results',
    );
    assertEqual(
      transcriptCandidateTask?.sliceResults?.[0]?.transcriptCoverageScore,
      1,
      'video slice workflow records repaired transcript coverage scores on slice results',
    );
    assertEqual(
      transcriptCandidateTask?.sliceResults?.[0]?.speechContinuityGrade,
      'repaired',
      'video slice workflow records repaired speech continuity grades on slice results',
    );
    assertNumberBetween(
      transcriptCandidateTask?.sliceResults?.[0]?.publishabilityScore,
      0.7,
      1,
      'video slice workflow records composite publishability scores on slice results',
    );
    assertRule(
      ['excellent', 'good'].includes(transcriptCandidateTask?.sliceResults?.[0]?.publishabilityGrade),
      `video slice workflow records publishability grades on slice results (got ${JSON.stringify(transcriptCandidateTask?.sliceResults?.[0]?.publishabilityGrade)})`,
    );
    assertRule(
      Array.isArray(transcriptCandidateTask?.sliceResults?.[0]?.publishabilityIssues),
      'video slice workflow records normalized publishability issue tags on slice results',
    );
    assertNumberBetween(
      transcriptCandidateTask?.sliceResults?.[0]?.boundaryQualityScore,
      0.65,
      1,
      'video slice workflow records boundary quality scores on slice results',
    );
    assertRule(
      ['strong', 'contextual', 'weak'].includes(transcriptCandidateTask?.sliceResults?.[0]?.hookStrength),
      'video slice workflow records hook strength grades on slice results',
    );
    assertRule(
      ['complete', 'soft', 'open'].includes(transcriptCandidateTask?.sliceResults?.[0]?.endingCompleteness),
      'video slice workflow records ending completeness grades on slice results',
    );
    assertNumberBetween(
      transcriptCandidateTask?.sliceResults?.[0]?.contentArcScore,
      0.65,
      1,
      'video slice workflow records content-arc scores on slice results',
    );
    assertRule(
      ['complete', 'partial', 'thin'].includes(transcriptCandidateTask?.sliceResults?.[0]?.contentArcGrade),
      'video slice workflow records content-arc grades on slice results',
    );
    assertArrayIncludes(
      transcriptCandidateTask?.sliceResults?.[0]?.contentArcStages,
      'payoff',
      'video slice workflow records detected content-arc stages on slice results',
    );
    assertNumberBetween(
      transcriptCandidateTask?.sliceResults?.[0]?.topicCoherenceScore,
      0.65,
      1,
      'video slice workflow records topic coherence scores on slice results',
    );
    assertRule(
      ['strong', 'mixed', 'weak'].includes(transcriptCandidateTask?.sliceResults?.[0]?.topicCoherenceGrade),
      'video slice workflow records topic coherence grades on slice results',
    );
    assertRule(
      typeof transcriptCandidateTask?.sliceResults?.[0]?.topicShiftCount === 'number',
      'video slice workflow records topic shift counts on slice results',
    );
    assertRule(
      Array.isArray(transcriptCandidateTask?.sliceResults?.[0]?.topicKeywords),
      'video slice workflow records topic keywords on slice results',
    );
    assertNumberBetween(
      transcriptCandidateTask?.sliceResults?.[0]?.platformReadinessScore,
      0.65,
      1,
      'video slice workflow records platform readiness scores on slice results',
    );
    assertRule(
      ['ready', 'review', 'reject'].includes(transcriptCandidateTask?.sliceResults?.[0]?.platformReadinessGrade),
      'video slice workflow records platform readiness grades on slice results',
    );
    assertRule(
      Array.isArray(transcriptCandidateTask?.sliceResults?.[0]?.platformReadinessIssues),
      'video slice workflow records platform readiness issue tags on slice results',
    );
    assertNumberBetween(
      transcriptCandidateTask?.sliceResults?.[0]?.sentenceBoundaryIntegrityScore,
      0,
      1,
      'video slice workflow records sentence boundary integrity scores on slice results',
    );
    assertRule(
      ['clean', 'repaired', 'broken'].includes(transcriptCandidateTask?.sliceResults?.[0]?.sentenceBoundaryIntegrityGrade),
      `video slice workflow records sentence boundary integrity grades on slice results (got ${JSON.stringify(transcriptCandidateTask?.sliceResults?.[0]?.sentenceBoundaryIntegrityGrade)})`,
    );
    assertRule(
      Array.isArray(transcriptCandidateTask?.sliceResults?.[0]?.sentenceBoundaryIssues),
      'video slice workflow records sentence boundary issue tags on slice results',
    );
    services.resetAutoCutNativeHostClient();
    services.configureAutoCutApprovedAiSdkBridge(null);

    resetStorage();
    const longTranscriptPromptCommands = [];
    const longTranscriptPromptBridgeRequests = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        mediaImportCommandReady: true,
        videoSliceCommandReady: true,
        speechTranscriptionCommandReady: true,
        speechTranscriptionToolchainReady: true,
        speechTranscriptionProbeCommandReady: true,
      }),
      importMediaFile: async (request) => {
        longTranscriptPromptCommands.push({ kind: 'import', request });
        return {
          assetUuid: 'long-transcript-prompt-asset',
          sandboxPath: 'D:/autocut-configured-output/inputs/long-transcript-source.mp4',
          byteSize: 654000,
          name: 'long-transcript-source.mp4',
          mediaType: 'video',
          mimeType: 'video/mp4',
          durationMs: 2_100_000,
        };
      },
      transcribeMedia: async (request) => {
        longTranscriptPromptCommands.push({ kind: 'transcribe', request });
        const output = createNativeTaskOutputArtifact(
          'long-transcript-prompt-task',
          'long-transcript-prompt.json',
          configuredOutputDirectory,
        );
        return {
          artifactUuid: 'long-transcript-prompt-artifact',
          taskUuid: 'long-transcript-prompt-task',
          sourceAssetUuid: request.assetUuid,
          transcriptPath: output.artifactPath,
          taskOutputDir: output.taskOutputDir,
          language: request.language ?? 'auto',
          text: 'long transcript prompt fixture',
          segments: Array.from({ length: 260 }, (_, index) => {
            const startMs = index * 8_000;
            const keyWindowTextByIndex = {
              12: 'Watch the onboarding funnel setup, signup pain, pricing conflict, and complete activation payoff.',
              130: 'Watch the refund workflow setup, support queue pain, escalation conflict, and complete retention payoff.',
              238: 'Watch the creator analytics setup, audience dropoff pain, packaging conflict, and complete publishing payoff.',
            };
            return {
              startMs,
              endMs: startMs + 6_000,
              text: keyWindowTextByIndex[index] ?? `Routine long transcript context ${index}.`,
              speaker: 'Speaker 1',
            };
          }),
          ffmpegExecutable: 'ffmpeg',
          speechExecutable: 'whisper-cli',
        };
      },
      probeSpeechTranscription: async (request) => ({
        ready: true,
        executablePath: request.executablePath,
        modelPath: request.modelPath,
        sourceKind: request.sourceKind ?? 'execution-preflight',
        diagnostics: [],
        versionLine: 'long transcript prompt speech preflight contract',
      }),
      sliceVideo: async (request) => {
        longTranscriptPromptCommands.push({ kind: 'slice', request });
        const output = createNativeTaskOutputArtifact(
          'long-transcript-prompt-slice-task',
          request.clips[0]?.outputFileName ?? 'long-transcript-prompt-slice.mp4',
          configuredOutputDirectory,
        );
        const thumbnail = createNativeTaskCoverArtifact(
          'long-transcript-prompt-slice-task',
          'long-transcript-prompt-thumb.jpg',
          configuredOutputDirectory,
        );
        return {
          taskUuid: 'long-transcript-prompt-slice-task',
          sourceAssetUuid: request.assetUuid,
          taskOutputDir: output.taskOutputDir,
          ffmpegExecutable: 'ffmpeg',
          slices: [
            {
              artifactUuid: 'long-transcript-prompt-slice-artifact',
              artifactPath: output.artifactPath,
              thumbnailArtifactUuid: 'long-transcript-prompt-thumb',
              thumbnailArtifactPath: thumbnail.artifactPath,
              taskOutputDir: output.taskOutputDir,
              byteSize: 234567,
              thumbnailByteSize: 12345,
              format: 'mp4',
              startMs: request.clips[0].startMs,
              durationMs: request.clips[0].durationMs,
              label: request.clips[0].label,
            },
          ],
        };
      },
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    });
    await services.saveAutoCutWorkspaceSettings({
      ...(await services.getAutoCutSettings()).workspace,
      outputDirectory: configuredOutputDirectory,
    });
    await saveVerifiedLocalSpeechTranscriptionSettings(services);
    await services.saveAutoCutLlmSettings({
      ...(await services.getAutoCutSettings()).llm,
      apiKey: 'sk-long-transcript-prompt',
    });
    services.configureAutoCutApprovedAiSdkBridge({
      async createChatCompletion(request, runtime) {
        longTranscriptPromptBridgeRequests.push({ request, runtime });
        const prompt = JSON.parse(request.messages?.[1]?.content ?? '{}');
        const selectedCandidate =
          prompt.candidateWindows?.find((candidate) => (candidate.speechStartMs ?? candidate.startMs) > 1_800_000) ??
          prompt.candidateWindows?.[0];
        return {
          id: 'long-transcript-prompt-plan',
          model: request.model,
          content: JSON.stringify([
            {
              candidateId: selectedCandidate?.id,
              title: 'Late creator analytics payoff',
              qualityScore: 0.9,
              continuityScore: 0.9,
            },
          ]),
          runtime,
        };
      },
    });
    await withImmediateTimers(async () =>
      processVideoSlice({
        fileId: 'asset-source-long-transcript-prompt-video-slice',
        file: createTrustedLocalMediaFile(
          commons,
          'D:/media/long-transcript-source.mp4',
          'long-transcript-source.mp4',
        ),
        mode: 'contract-mode',
        llmModel: 'deepseek-v4-flash',
        targetPlatform: 'douyin',
        targetAspectRatio: '9:16',
        videoObjectFit: 'cover',
        sliceCountMode: 'qualityFirst',
        targetSliceCount: 5,
        minDuration: 5,
        maxDuration: 15,
        baseAlgorithm: 'scene',
        highlightEngine: 'keyword',
        enableNoiseReduction: true,
        enableCoughFilter: true,
            enableRepeatFilter: true,
          }),
    );
    const longTranscriptPrompt = JSON.parse(
      longTranscriptPromptBridgeRequests[0]?.request?.messages?.[1]?.content ?? '{}',
    );
    assertRule(
      longTranscriptPrompt?.candidateWindows?.some((candidate) => (candidate.speechStartMs ?? candidate.startMs) > 1_800_000),
      'video slice workflow sends late high-value transcript candidate windows to the LLM planner',
    );
    assertRule(
      longTranscriptPrompt?.transcriptTimeline?.some((segment) => String(segment.text).includes('creator analytics')),
      'video slice workflow includes candidate-adjacent late transcript context instead of only the first transcript segments',
    );
    assertRule(
      (longTranscriptPrompt?.transcriptTimeline?.length ?? 0) <= 80,
      'video slice workflow keeps the transcript timeline prompt bounded after candidate-centered sampling',
    );
    services.resetAutoCutNativeHostClient();
    services.configureAutoCutApprovedAiSdkBridge(null);

    resetStorage();
    const nativeExtractorTextWorkflowCommands = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        contractVersion: 'contract-test',
        hostKind: 'native-host',
        databaseContractReady: true,
        sqliteMigrationReady: true,
        databaseHealthCommandReady: true,
        ffmpegProbeCommandReady: true,
        mediaImportCommandReady: true,
        mediaFileDescribeCommandReady: true,
        localVideoFileSelectCommandReady: true,
        localDirectorySelectCommandReady: true,
        audioExtractionCommandReady: true,
        audioExtractionFromAssetReady: true,
        videoGifCommandReady: false,
        videoSliceCommandReady: false,
        videoCompressCommandReady: false,
        videoConvertCommandReady: false,
        videoEnhanceCommandReady: false,
        speechTranscriptionCommandReady: true,
        speechTranscriptionToolchainReady: true,
        speechTranscriptionProbeCommandReady: true,
        speechTranscriptionFileSelectCommandReady: true,
        llmHttpCommandReady: false,
        llmSecretStoreReady: false,
        nativeTaskQueryCommandReady: true,
        nativeTaskCancelCommandReady: false,
        nativeTaskRecoveryCommandReady: false,
        nativeTaskRetryCommandReady: false,
        nativeTaskProgressEventsReady: false,
        nativeWorkerLeaseReady: true,
        ffmpegToolchainManifestReady: true,
        ffmpegToolchainResolverReady: true,
        ffmpegBundledReady: false,
        ffmpegExecutionReady: false,
        supportedCommands: ['autocut_import_media_file', 'autocut_transcribe_media'],
      }),
      getDatabaseHealth: async () => ({
        ready: true,
        databasePath: 'memory',
        appliedMigrations: ['baseline'],
        verifiedTables: ['media_asset'],
        missingTables: [],
        diagnostics: [],
      }),
      probeFfmpeg: async () => ({
        available: true,
        executable: 'ffmpeg',
        sourceKind: 'system-path',
        manifestReady: true,
        bundledReady: false,
        versionLine: 'ffmpeg contract',
        diagnostics: [],
      }),
      importMediaFile: async (request) => {
        nativeExtractorTextWorkflowCommands.push({ kind: 'import', request });
        return {
          assetUuid: 'native-extractor-text-asset',
          sandboxPath: 'D:/autocut-configured-output/inputs/native-extractor-text-asset.mp4',
          byteSize: 765000,
          name: 'native-extractor-text.mp4',
          mediaType: 'video',
          mimeType: 'video/mp4',
        };
      },
      describeLocalMediaFile: async (request) => ({
        sourcePath: request.sourcePath,
        byteSize: 765000,
        name: 'native-extractor-text.mp4',
        mediaType: 'video',
        mimeType: 'video/mp4',
      }),
      selectLocalVideoFile: async () => null,
      selectLocalDirectory: async () => null,
      extractAudio: async () => {
        throw new Error('audio extraction is not configured for native extractor text workflow contract');
      },
      generateGif: async () => {
        throw new Error('video GIF is not configured for native extractor text workflow contract');
      },
      probeSpeechTranscription: async (request) => ({
        ready: true,
        executablePath: request.executablePath,
        modelPath: request.modelPath,
        sourceKind: request.sourceKind ?? 'execution-preflight',
        diagnostics: [],
        versionLine: 'native extractor text workflow contract',
      }),
      selectSpeechTranscriptionFile: async () => null,
      transcribeMedia: async (request) => {
        nativeExtractorTextWorkflowCommands.push({ kind: 'transcribe', request });
        const output = createNativeTaskOutputArtifact(
          'native-extractor-text-task',
          'native-extractor-text-transcript.json',
          configuredOutputDirectory,
        );
        return {
          artifactUuid: 'native-extractor-text-transcript-artifact',
          taskUuid: 'native-extractor-text-task',
          sourceAssetUuid: request.assetUuid,
          transcriptPath: output.artifactPath,
          taskOutputDir: output.taskOutputDir,
          language: request.language,
          text: 'First real local transcript sentence. Second real local transcript sentence.',
          segments: [
            {
              startMs: 12000,
              endMs: 22000,
              text: 'First real local transcript sentence.',
              speaker: 'Speaker 1',
            },
            {
              startMs: 26000,
              endMs: 36000,
              text: 'Second real local transcript sentence.',
              speaker: 'Speaker 2',
            },
          ],
          ffmpegExecutable: 'ffmpeg',
          speechExecutable: 'whisper-cli',
        };
      },
      sliceVideo: async () => {
        throw new Error('video slicing is not configured for native extractor text workflow contract');
      },
      compressVideo: async () => {
        throw new Error('video compression is not configured for native extractor text workflow contract');
      },
      convertVideo: async () => {
        throw new Error('video conversion is not configured for native extractor text workflow contract');
      },
      enhanceVideo: async () => {
        throw new Error('video enhancement is not configured for native extractor text workflow contract');
      },
      sendLlmHttpRequest: async () => {
        throw new Error('LLM HTTP is not configured for native extractor text workflow contract');
      },
      saveLlmSecret: async (request) => ({
        secretName: request.secretName,
        saved: false,
      }),
      getLlmSecret: async (request) => ({
        secretName: request.secretName,
        configured: false,
      }),
      deleteLlmSecret: async (request) => ({
        secretName: request.secretName,
        deleted: false,
      }),
      listNativeTasks: async () => [],
      cancelNativeTask: async (request) => ({
        taskUuid: request.taskUuid,
        status: 0,
        canceled: false,
        message: 'not configured',
      }),
      recoverNativeTasks: async () => ({
        inspected: 0,
        recovered: 0,
        interrupted: 0,
        canceled: 0,
        expiredLeases: 0,
        deferred: 0,
        taskUuids: [],
      }),
      retryNativeTask: async (request) => ({
        taskUuid: request.taskUuid,
        retryTaskUuid: '',
        status: 0,
        retried: false,
        message: 'not configured',
      }),
      runAudioSmoke: async () => ({
        artifactUuid: 'native-audio-smoke',
        taskUuid: 'native-audio-smoke-task',
        sourceAssetUuid: '',
        artifactPath: createNativeTaskOutputArtifact('native-audio-smoke-task', 'native-audio-smoke.wav').artifactPath,
        taskOutputDir: createNativeTaskOutputArtifact('native-audio-smoke-task', 'native-audio-smoke.wav').taskOutputDir,
        byteSize: 1,
        format: 'wav',
        ffmpegExecutable: 'ffmpeg',
      }),
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    });
    await services.saveAutoCutWorkspaceSettings({
      ...(await services.getAutoCutSettings()).workspace,
      outputDirectory: configuredOutputDirectory,
    });
    await saveVerifiedLocalSpeechTranscriptionSettings(services);
    const nativeExtractorTextSourceFile = createTrustedLocalMediaFile(
      commons,
      'D:/media/native-extractor-text.mp4',
      'native-extractor-text.mp4',
    );
    const nativeExtractorTextWorkflowResult = await withImmediateTimers(async () =>
      processExtractorText({
        fileId: 'asset-source-native-extractor-text',
        file: nativeExtractorTextSourceFile,
        language: 'zh',
        format: 'raw',
        separateSpeakers: true,
      }),
    );
    const nativeExtractorTextTasks = readScopedStoredArray(services, 'tasks');
    const nativeExtractorTextTask = nativeExtractorTextTasks.find(
      (task) => task.id === nativeExtractorTextWorkflowResult.taskId,
    );
    const nativeExtractorTextAssets = readScopedStoredArray(services, 'assets');
    const nativeExtractorTextAsset = nativeExtractorTextAssets.find(
      (asset) => asset.sourceTaskId === nativeExtractorTextWorkflowResult.taskId,
    );
    assertEqual(nativeExtractorTextWorkflowResult.success, true, 'extractor text native workflow reports success');
    assertEqual(nativeExtractorTextWorkflowCommands[0]?.kind, 'import', 'extractor text native workflow imports local media before transcription');
    assertEqual(
      nativeExtractorTextWorkflowCommands[0]?.request?.outputRootDir,
      configuredOutputDirectory,
      'extractor text native workflow passes the configured output directory to media import',
    );
    assertEqual(nativeExtractorTextWorkflowCommands[1]?.kind, 'transcribe', 'extractor text native workflow calls local speech transcription after import');
    assertEqual(
      nativeExtractorTextWorkflowCommands[1]?.request?.assetUuid,
      'native-extractor-text-asset',
      'extractor text native workflow transcribes by imported assetUuid',
    );
    assertEqual(
      nativeExtractorTextWorkflowCommands[1]?.request?.language,
      'zh',
      'extractor text native workflow forwards the selected transcription language',
    );
    assertEqual(
      nativeExtractorTextWorkflowCommands[1]?.request?.executablePath,
      'D:/tools/whisper-cli.exe',
      'extractor text native workflow passes the configured local speech executable to transcription',
    );
    assertEqual(
      nativeExtractorTextWorkflowCommands[1]?.request?.modelPath,
      'D:/models/ggml-large-v3-turbo.bin',
      'extractor text native workflow passes the configured local speech model to transcription',
    );
    assertEqual(
      nativeExtractorTextWorkflowCommands[1]?.request?.outputRootDir,
      configuredOutputDirectory,
      'extractor text native workflow passes the configured output directory to local speech transcription',
    );
    assertEqual(
      nativeExtractorTextTask?.status,
      types.AUTOCUT_TASK_STATUS.completed,
      'extractor text native workflow completes the persisted task',
    );
    assertEqual(
      nativeExtractorTextTask?.extractedText?.[0]?.time,
      '00:00:12',
      'extractor text native workflow converts speech segment timing to extracted text timestamps',
    );
    assertEqual(
      nativeExtractorTextTask?.extractedText?.[0]?.text,
      'First real local transcript sentence.',
      'extractor text native workflow stores the real local speech transcription text',
    );
    assertEqual(
      nativeExtractorTextTask?.transcriptText,
      'First real local transcript sentence. Second real local transcript sentence.',
      'extractor text native workflow stores the complete speech-to-text transcript text on the task',
    );
    assertEqual(
      nativeExtractorTextTask?.transcriptSegments?.length,
      2,
      'extractor text native workflow stores reusable structured speech-to-text transcript segments on the task',
    );
    assertEqual(
      nativeExtractorTextTask?.transcriptSegments?.[1]?.speaker,
      'Speaker 2',
      'extractor text native workflow preserves speaker labels on structured transcript segments',
    );
    assertEqual(
      nativeExtractorTextTask?.transcriptSegmentCount,
      2,
      'extractor text native workflow records the structured transcript segment count',
    );
    assertEqual(
      nativeExtractorTextTask?.transcriptProviderId,
      'local-whisper-cli',
      'extractor text native workflow records the selected speech-to-text provider on the completed task',
    );
    assertEqual(
      nativeExtractorTextTask?.transcriptSourceAssetId,
      'native-extractor-text-asset',
      'extractor text native workflow links transcript evidence to the imported source asset',
    );
    assertEqual(
      nativeExtractorTextAsset?.type,
      'doc',
      'extractor text native workflow stores the transcript as a document asset',
    );
    services.resetAutoCutNativeHostClient();

    resetStorage();
    const extractorTextAudioVideoCommands = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        mediaImportCommandReady: true,
        speechTranscriptionCommandReady: true,
        speechTranscriptionToolchainReady: true,
        speechTranscriptionProbeCommandReady: true,
      }),
      importMediaFile: async (request) => {
        extractorTextAudioVideoCommands.push({ kind: 'import', request });
        const isAudio = request.sourcePath.endsWith('.mp3');
        return {
          assetUuid: isAudio ? 'extractor-text-audio-asset' : 'extractor-text-video-asset',
          sandboxPath: isAudio
            ? 'D:/autocut-configured-output/inputs/extractor-text-audio-asset.mp3'
            : 'D:/autocut-configured-output/inputs/extractor-text-video-asset.mp4',
          byteSize: isAudio ? 123000 : 456000,
          name: isAudio ? 'extractor-text-audio.mp3' : 'extractor-text-video.mp4',
          mediaType: isAudio ? 'audio' : 'video',
          mimeType: isAudio ? 'audio/mpeg' : 'video/mp4',
        };
      },
      transcribeMedia: async (request) => {
        extractorTextAudioVideoCommands.push({ kind: 'transcribe', request });
        const output = createNativeTaskOutputArtifact(
          request.assetUuid === 'extractor-text-audio-asset'
            ? 'extractor-text-audio-task'
            : 'extractor-text-video-task',
          'transcript.json',
          configuredOutputDirectory,
        );
        return {
          artifactUuid: `${request.assetUuid}-transcript`,
          taskUuid: request.assetUuid === 'extractor-text-audio-asset'
            ? 'extractor-text-audio-task'
            : 'extractor-text-video-task',
          sourceAssetUuid: request.assetUuid,
          transcriptPath: output.artifactPath,
          taskOutputDir: output.taskOutputDir,
          language: request.language,
          text: request.assetUuid === 'extractor-text-audio-asset'
            ? 'uh Bonjour audio transcript.'
            : 'um Video transcript, you know.',
          segments: [
            {
              startMs: 0,
              endMs: 2400,
              text: request.assetUuid === 'extractor-text-audio-asset'
                ? 'uh Bonjour audio transcript.'
                : 'um Video transcript, you know.',
              speaker: 'Speaker 1',
            },
            ...(request.assetUuid === 'extractor-text-video-asset'
              ? [
                  {
                    startMs: 2500,
                    endMs: 3000,
                    text: 'um',
                    speaker: 'Speaker 1',
                  },
                ]
              : []),
          ],
          ffmpegExecutable: 'ffmpeg',
          speechExecutable: request.executablePath,
        };
      },
      probeSpeechTranscription: async (request) => ({
        ready: true,
        executablePath: request.executablePath,
        modelPath: request.modelPath,
        sourceKind: request.sourceKind ?? 'execution-preflight',
        diagnostics: [],
        versionLine: 'extractor text audio video speech preflight contract',
      }),
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    });
    await services.saveAutoCutWorkspaceSettings({
      ...(await services.getAutoCutSettings()).workspace,
      outputDirectory: configuredOutputDirectory,
    });
    await saveVerifiedLocalSpeechTranscriptionSettings(services, {
      modelPath: 'D:/models/ggml-large-v3-turbo.gguf',
    });
    const extractorTextAudioSourceFile = createTrustedLocalMediaFile(
      commons,
      'D:/media/extractor-text-audio.mp3',
      'extractor-text-audio.mp3',
      { mimeType: 'audio/mpeg', mediaType: 'audio' },
    );
    const extractorTextVideoSourceFile = createTrustedLocalMediaFile(
      commons,
      'D:/media/extractor-text-video.mp4',
      'extractor-text-video.mp4',
      { mimeType: 'video/mp4', mediaType: 'video' },
    );
    const extractorTextAudioResult = await withImmediateTimers(async () =>
      processExtractorText({
        fileId: 'asset-source-extractor-text-audio',
        file: extractorTextAudioSourceFile,
        language: 'fr',
        format: 'raw',
        separateSpeakers: false,
      }),
    );
    const extractorTextVideoResult = await withImmediateTimers(async () =>
      processExtractorText({
        fileId: 'asset-source-extractor-text-video',
        file: extractorTextVideoSourceFile,
        language: 'ja-JP',
        format: 'filtered',
        separateSpeakers: true,
      }),
    );
    const audioTranscribeCommand = extractorTextAudioVideoCommands.find(
      (entry) => entry.kind === 'transcribe' && entry.request.assetUuid === 'extractor-text-audio-asset',
    );
    const videoTranscribeCommand = extractorTextAudioVideoCommands.find(
      (entry) => entry.kind === 'transcribe' && entry.request.assetUuid === 'extractor-text-video-asset',
    );
    const extractorTextAudioTask = readScopedStoredArray(services, 'tasks')
      .find((task) => task.id === extractorTextAudioResult.taskId);
    const extractorTextVideoTask = readScopedStoredArray(services, 'tasks')
      .find((task) => task.id === extractorTextVideoResult.taskId);
    assertEqual(extractorTextAudioResult.success, true, 'extractor text accepts trusted local audio sources');
    assertEqual(extractorTextVideoResult.success, true, 'extractor text accepts trusted local video sources');
    assertEqual(audioTranscribeCommand?.request?.language, 'fr', 'extractor text forwards non-default audio transcription languages');
    assertEqual(videoTranscribeCommand?.request?.language, 'ja-JP', 'extractor text forwards BCP-47 style video transcription languages');
    assertEqual(audioTranscribeCommand?.request?.modelPath, 'D:/models/ggml-large-v3-turbo.gguf', 'extractor text audio workflow uses the configured local model path');
    assertEqual(videoTranscribeCommand?.request?.executablePath, 'D:/tools/whisper-cli.exe', 'extractor text video workflow uses the configured local executable path');
    assertEqual(extractorTextAudioTask?.extractedText?.[0]?.speaker, 'Speaker 1', 'extractor text audio workflow can disable speaker separation without losing text');
    assertEqual(extractorTextAudioTask?.extractedText?.[0]?.text, 'uh Bonjour audio transcript.', 'extractor text raw mode preserves native speech-to-text filler words');
    assertEqual(extractorTextVideoTask?.extractedText?.[0]?.text, 'Video transcript.', 'extractor text filtered mode removes redundant filler words from native speech-to-text');
    assertEqual(extractorTextVideoTask?.extractedText?.length, 1, 'extractor text filtered mode removes pure filler speech segments');
    assertEqual(extractorTextAudioTask?.transcriptText, 'uh Bonjour audio transcript.', 'extractor text audio workflow stores complete raw transcript text');
    assertEqual(extractorTextAudioTask?.transcriptSegments?.[0]?.text, 'uh Bonjour audio transcript.', 'extractor text audio workflow stores structured raw transcript segments');
    assertEqual(extractorTextVideoTask?.transcriptText, 'Video transcript.', 'extractor text video filtered workflow stores the filtered visible transcript text');
    assertEqual(extractorTextVideoTask?.transcriptSegments?.length, 1, 'extractor text video filtered workflow drops pure filler structured transcript segments');
    assertEqual(extractorTextVideoTask?.transcriptSegments?.[0]?.startMs, 0, 'extractor text video workflow keeps structured transcript segment timing');
    services.resetAutoCutNativeHostClient();

    resetStorage();
    const nativeExtractorTextEmptyTranscriptCommands = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        mediaImportCommandReady: true,
        speechTranscriptionCommandReady: true,
        speechTranscriptionToolchainReady: true,
        speechTranscriptionProbeCommandReady: true,
      }),
      importMediaFile: async (request) => {
        nativeExtractorTextEmptyTranscriptCommands.push({ kind: 'import', request });
        return {
          assetUuid: 'empty-transcript-asset',
          sandboxPath: 'D:/autocut-configured-output/inputs/empty-transcript-source.mp4',
          byteSize: 654000,
          name: 'empty-transcript-source.mp4',
          mediaType: 'video',
          mimeType: 'video/mp4',
          durationMs: 32000,
        };
      },
      transcribeMedia: async (request) => {
        nativeExtractorTextEmptyTranscriptCommands.push({ kind: 'transcribe', request });
        const output = createNativeTaskOutputArtifact(
          'empty-transcript-task',
          'empty-transcript.json',
          configuredOutputDirectory,
        );
        return {
          artifactUuid: 'empty-transcript-artifact',
          taskUuid: 'empty-transcript-task',
          sourceAssetUuid: request.assetUuid,
          transcriptPath: output.artifactPath,
          taskOutputDir: output.taskOutputDir,
          language: request.language ?? 'auto',
          text: '',
          segments: [],
          ffmpegExecutable: 'ffmpeg',
          speechExecutable: 'whisper-cli',
        };
      },
      probeSpeechTranscription: async (request) => ({
        ready: true,
        executablePath: request.executablePath,
        modelPath: request.modelPath,
        sourceKind: request.sourceKind ?? 'execution-preflight',
        diagnostics: [],
        versionLine: 'empty transcript speech preflight contract',
      }),
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    });
    await services.saveAutoCutWorkspaceSettings({
      ...(await services.getAutoCutSettings()).workspace,
      outputDirectory: configuredOutputDirectory,
    });
    await saveVerifiedLocalSpeechTranscriptionSettings(services, {
      modelPath: 'D:/models/ggml-large-v3-turbo.gguf',
    });
    const emptyTranscriptSourceFile = createTrustedLocalMediaFile(
      commons,
      'D:/media/empty-transcript-source.mp4',
      'empty-transcript-source.mp4',
    );
    await assertRejects(
      () =>
        withImmediateTimers(async () =>
          processExtractorText({
            fileId: 'asset-source-empty-transcript',
            file: emptyTranscriptSourceFile,
            language: 'zh',
            format: 'filtered',
            separateSpeakers: true,
          }),
        ),
      'valid timestamped speech segments',
      'extractor text workflow fails closed when the STT provider returns no transcript segments',
    );
    const emptyTranscriptTask = readScopedStoredArray(services, 'tasks')[0];
    assertEqual(
      emptyTranscriptTask?.status,
      types.AUTOCUT_TASK_STATUS.failed,
      'extractor text empty transcript workflow marks the task failed',
    );
    assertEqual(
      readScopedStoredArray(services, 'assets').length,
      0,
      'extractor text empty transcript workflow does not persist an empty transcript asset',
    );
    services.resetAutoCutNativeHostClient();

    resetStorage();
    const nativeSliceSubtitleFailureCommands = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        mediaImportCommandReady: true,
        videoSliceCommandReady: true,
        speechTranscriptionCommandReady: true,
        speechTranscriptionToolchainReady: true,
        speechTranscriptionProbeCommandReady: true,
      }),
      importMediaFile: async (request) => {
        nativeSliceSubtitleFailureCommands.push({ kind: 'import', request });
        return {
          assetUuid: 'subtitle-required-slice-asset',
          sandboxPath: 'D:/autocut-configured-output/inputs/subtitle-required-source.mp4',
          byteSize: 654000,
          name: 'subtitle-required-source.mp4',
          mediaType: 'video',
          mimeType: 'video/mp4',
          durationMs: 42000,
        };
      },
      transcribeMedia: async (request) => {
        nativeSliceSubtitleFailureCommands.push({ kind: 'transcribe', request });
        throw new Error('whisper stderr: model file missing');
      },
      probeSpeechTranscription: async (request) => ({
        ready: true,
        executablePath: request.executablePath,
        modelPath: request.modelPath,
        sourceKind: request.sourceKind ?? 'execution-preflight',
        diagnostics: [],
        versionLine: 'subtitle required speech preflight contract',
      }),
      sliceVideo: async (request) => {
        nativeSliceSubtitleFailureCommands.push({ kind: 'slice', request });
        throw new Error('sliceVideo must not run after required subtitle transcription fails');
      },
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    });
    await services.saveAutoCutWorkspaceSettings({
      ...(await services.getAutoCutSettings()).workspace,
      outputDirectory: configuredOutputDirectory,
    });
    await saveVerifiedLocalSpeechTranscriptionSettings(services, {
      modelPath: 'D:/models/ggml-large-v3-turbo.gguf',
      language: 'zh',
    });
    const subtitleRequiredSliceSourceFile = createTrustedLocalMediaFile(
      commons,
      'D:/media/subtitle-required-source.mp4',
      'subtitle-required-source.mp4',
    );
    await assertRejects(
      () =>
        withImmediateTimers(async () =>
          processVideoSlice({
            fileId: 'asset-source-subtitle-required-slice',
            file: subtitleRequiredSliceSourceFile,
            mode: 'contract-mode',
            llmModel: 'deepseek-v4-flash',
            minDuration: 15,
            maxDuration: 60,
            baseAlgorithm: 'scene',
            highlightEngine: 'emotion',
            enableNoiseReduction: true,
            enableCoughFilter: true,
            enableRepeatFilter: true,
            enableSubtitles: true,
            subtitleMode: 'both',
          }),
        ),
      'Smart slicing requires successful speech-to-text transcription before planning clips',
      'video slice workflow fails closed when required speech-to-text fails',
    );
    const subtitleFailureTask = readScopedStoredArray(services, 'tasks')[0];
    assertEqual(
      subtitleFailureTask?.status,
      types.AUTOCUT_TASK_STATUS.failed,
      'video slice subtitle transcription failure marks the task failed',
    );
    assertRule(
      !nativeSliceSubtitleFailureCommands.some((entry) => entry.kind === 'slice'),
      'video slice workflow does not render a no-subtitle video after required subtitle transcription fails',
    );
    assertEqual(
      readScopedStoredArray(services, 'assets').length,
      0,
      'video slice subtitle transcription failure does not persist generated slice assets',
    );
    services.resetAutoCutNativeHostClient();

    resetStorage();
    const nativeSliceSubtitleUnavailableCommands = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        mediaImportCommandReady: true,
        videoSliceCommandReady: true,
        speechTranscriptionCommandReady: false,
        speechTranscriptionToolchainReady: true,
      }),
      importMediaFile: async (request) => {
        nativeSliceSubtitleUnavailableCommands.push({ kind: 'import', request });
        return {
          assetUuid: 'subtitle-unavailable-slice-asset',
          sandboxPath: 'D:/autocut-configured-output/inputs/subtitle-unavailable-source.mp4',
          byteSize: 654000,
          name: 'subtitle-unavailable-source.mp4',
          mediaType: 'video',
          mimeType: 'video/mp4',
          durationMs: 42000,
        };
      },
      sliceVideo: async (request) => {
        nativeSliceSubtitleUnavailableCommands.push({ kind: 'slice', request });
        throw new Error('sliceVideo must not run when subtitle speech-to-text is unavailable');
      },
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    });
    const subtitleUnavailableSliceSourceFile = createTrustedLocalMediaFile(
      commons,
      'D:/media/subtitle-unavailable-source.mp4',
      'subtitle-unavailable-source.mp4',
    );
    await assertRejects(
      () =>
        withImmediateTimers(async () =>
          processVideoSlice({
            fileId: 'asset-source-subtitle-unavailable-slice',
            file: subtitleUnavailableSliceSourceFile,
            mode: 'contract-mode',
            llmModel: 'deepseek-v4-flash',
            minDuration: 15,
            maxDuration: 60,
            baseAlgorithm: 'scene',
            highlightEngine: 'emotion',
            enableNoiseReduction: true,
            enableCoughFilter: true,
            enableRepeatFilter: true,
            enableSubtitles: true,
            subtitleMode: 'both',
          }),
        ),
      'Smart slicing requires successful speech-to-text transcription before planning clips',
      'video slice workflow fails closed when required local speech-to-text is unavailable',
    );
    assertRule(
      !nativeSliceSubtitleUnavailableCommands.some((entry) => entry.kind === 'slice'),
      'video slice workflow does not render a no-subtitle video when required speech-to-text is unavailable',
    );
    services.resetAutoCutNativeHostClient();

    resetStorage();
    const nativeVideoSliceLlmPlanCommands = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        contractVersion: 'contract-test',
        hostKind: 'native-host',
        databaseContractReady: true,
        sqliteMigrationReady: true,
        databaseHealthCommandReady: true,
        ffmpegProbeCommandReady: true,
        mediaImportCommandReady: true,
        mediaFileDescribeCommandReady: true,
          localVideoFileSelectCommandReady: true,
        audioExtractionCommandReady: false,
        audioExtractionFromAssetReady: false,
        videoGifCommandReady: false,
        videoSliceCommandReady: true,
        videoCompressCommandReady: false,
        videoConvertCommandReady: false,
        videoEnhanceCommandReady: false,
        speechTranscriptionCommandReady: true,
        speechTranscriptionToolchainReady: true,
        speechTranscriptionProbeCommandReady: true,
        llmHttpCommandReady: false,
        llmSecretStoreReady: false,
        nativeTaskQueryCommandReady: true,
        nativeTaskCancelCommandReady: false,
        nativeTaskRecoveryCommandReady: false,
        nativeTaskRetryCommandReady: false,
        nativeTaskProgressEventsReady: false,
        nativeWorkerLeaseReady: true,
        ffmpegToolchainManifestReady: true,
        ffmpegToolchainResolverReady: true,
        ffmpegBundledReady: false,
        ffmpegExecutionReady: false,
        supportedCommands: ['autocut_import_media_file', 'autocut_slice_video'],
      }),
      getDatabaseHealth: async () => ({
        ready: true,
        databasePath: 'memory',
        appliedMigrations: ['baseline'],
        verifiedTables: ['media_asset'],
        missingTables: [],
        diagnostics: [],
      }),
      probeFfmpeg: async () => ({
        available: true,
        executable: 'ffmpeg',
        sourceKind: 'path',
        manifestReady: false,
        bundledReady: false,
        versionLine: 'ffmpeg contract',
        diagnostics: [],
      }),
      importMediaFile: async (request) => {
        nativeVideoSliceLlmPlanCommands.push({ kind: 'import', request });
        return {
          assetUuid: 'native-slice-llm-asset',
          sandboxPath: 'D:/autocut-configured-output/inputs/native-slice-llm-asset.mp4',
          byteSize: 654000,
          name: 'native-source.mp4',
          mediaType: 'video',
          mimeType: 'video/mp4',
          durationMs: 32000,
        };
      },
      describeLocalMediaFile: async (request) => ({
        sourcePath: request.sourcePath,
        byteSize: 654000,
        name: 'native-source.mp4',
        mediaType: 'video',
        mimeType: 'video/mp4',
      }),
      extractAudio: async () => {
        throw new Error('audio extraction is not configured for the LLM slice plan contract');
      },
      generateGif: async () => {
        throw new Error('video GIF is not configured for the LLM slice plan contract');
      },
      transcribeMedia: async (request) => {
        nativeVideoSliceLlmPlanCommands.push({ kind: 'transcribe', request });
        return {
          artifactUuid: 'native-slice-llm-transcript-artifact',
          taskUuid: 'native-slice-llm-transcript-task',
          sourceAssetUuid: request.assetUuid,
          transcriptPath: 'D:/autocut-configured-output/tasks/native-slice-llm-transcript-task/outputs/transcript.json',
          taskOutputDir: 'D:/autocut-configured-output/tasks/native-slice-llm-transcript-task/outputs',
          language: request.language ?? 'auto',
          text:
            'Why LLM plans still need speech checks is simple. Because a model can choose bad timing, the problem appears before rendering. So use the verified transcript result and the final answer works.',
          segments: [
            {
              startMs: 0,
              endMs: 20_200,
              text:
                'Why LLM plans still need speech checks is simple. Because a model can choose bad timing, the problem appears before rendering. So use the verified transcript result and the final answer works.',
              speaker: 'Speaker 1',
            },
          ],
          ffmpegExecutable: 'ffmpeg',
          speechExecutable: request.executablePath,
        };
      },
      probeSpeechTranscription: async (request) => {
        nativeVideoSliceLlmPlanCommands.push({ kind: 'speech-preflight', request });
        return {
          ready: true,
          executablePath: request.executablePath,
          modelPath: request.modelPath,
          sourceKind: request.sourceKind ?? 'execution-preflight',
          diagnostics: [],
          versionLine: 'LLM slice plan speech preflight contract',
        };
      },
      sliceVideo: async (request) => {
        nativeVideoSliceLlmPlanCommands.push({ kind: 'slice', request });
        return {
          taskUuid: 'native-slice-llm-task',
          sourceAssetUuid: request.assetUuid,
          taskOutputDir: createNativeTaskOutputArtifact(
            'native-slice-llm-task',
            'native-slice-llm-artifact-1.mp4',
            configuredOutputDirectory,
          ).taskOutputDir,
          ffmpegExecutable: 'ffmpeg',
          slices: request.clips.map((clip, index) => {
            const output = createNativeTaskOutputArtifact(
              'native-slice-llm-task',
              `native-slice-llm-artifact-${index + 1}.mp4`,
              configuredOutputDirectory,
            );
            const thumbnail = createNativeTaskCoverArtifact(
              'native-slice-llm-task',
              `native-slice-llm-thumb-${index + 1}.jpg`,
              configuredOutputDirectory,
            );
            const subtitle = createNativeTaskOutputArtifact(
              'native-slice-llm-task',
              `native-slice-llm-subtitle-${index + 1}.srt`,
              configuredOutputDirectory,
            );
            const subtitleRequested = request.subtitleFormat === 'srt' && request.subtitleMode !== 'burned';
            return {
              artifactUuid: `native-slice-llm-artifact-${index + 1}`,
              artifactPath: output.artifactPath,
              thumbnailArtifactUuid: `native-slice-llm-thumb-${index + 1}`,
              thumbnailArtifactPath: thumbnail.artifactPath,
              ...(subtitleRequested
                ? {
                    subtitleArtifactUuid: `native-slice-llm-subtitle-${index + 1}`,
                    subtitleArtifactPath: subtitle.artifactPath,
                    subtitleByteSize: 234 + index,
                    subtitleFormat: 'srt',
                  }
                : {}),
              taskOutputDir: output.taskOutputDir,
              byteSize: 234567,
              thumbnailByteSize: 12345,
              format: 'mp4',
              startMs: clip.startMs,
              durationMs: clip.durationMs,
              label: clip.label,
            };
          }),
        };
      },
      compressVideo: async () => {
        throw new Error('video compression is not configured for the LLM slice plan contract');
      },
      convertVideo: async () => {
        throw new Error('video conversion is not configured for the LLM slice plan contract');
      },
      enhanceVideo: async () => {
        throw new Error('video enhancement is not configured for the LLM slice plan contract');
      },
      sendLlmHttpRequest: async () => {
        throw new Error('LLM HTTP is not configured for the LLM slice plan contract');
      },
      saveLlmSecret: async (request) => ({
        secretName: request.secretName,
        saved: false,
      }),
      getLlmSecret: async (request) => ({
        secretName: request.secretName,
        configured: false,
      }),
      deleteLlmSecret: async (request) => ({
        secretName: request.secretName,
        deleted: false,
      }),
      listNativeTasks: async () => [],
      cancelNativeTask: async (request) => ({
        taskUuid: request.taskUuid,
        status: 0,
        canceled: false,
        message: 'not configured',
      }),
      recoverNativeTasks: async () => ({
        inspected: 0,
        recovered: 0,
        interrupted: 0,
        canceled: 0,
        expiredLeases: 0,
        deferred: 0,
        taskUuids: [],
      }),
      retryNativeTask: async (request) => ({
        taskUuid: request.taskUuid,
        retryTaskUuid: '',
        status: 0,
        retried: false,
        message: 'not configured',
      }),
      runAudioSmoke: async () => ({
        artifactUuid: 'native-audio-smoke',
        taskUuid: 'native-audio-smoke-task',
        sourceAssetUuid: '',
        artifactPath: createNativeTaskOutputArtifact('native-audio-smoke-task', 'native-audio-smoke.wav').artifactPath,
        taskOutputDir: createNativeTaskOutputArtifact('native-audio-smoke-task', 'native-audio-smoke.wav').taskOutputDir,
        byteSize: 1,
        format: 'wav',
        ffmpegExecutable: 'ffmpeg',
      }),
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    });
    await services.saveAutoCutLlmSettings({
      ...(await services.getAutoCutSettings()).llm,
      apiKey: 'sk-llm-plan-secret',
    });
    services.configureAutoCutApprovedAiSdkBridge({
      async createChatCompletion(request, runtime) {
        return {
          id: 'llm-plan-contract',
          model: request.model,
          content: JSON.stringify([
            { startMs: 40000, durationMs: 999999, label: 'Late' },
            { startMs: 0, durationMs: 1000, label: 'Short' },
          ]),
          runtime,
        };
      },
    });
    const nativeVideoSliceLlmPlanSourceFile = createTrustedLocalMediaFile(commons, 'D:/media/native-source.mp4');
    await withImmediateTimers(async () =>
      processVideoSlice({
        fileId: 'asset-source-native-video-slice-llm-plan',
        file: nativeVideoSliceLlmPlanSourceFile,
        mode: 'contract-mode',
        llmModel: 'deepseek-v4-flash',
        minDuration: 15,
        maxDuration: 60,
        baseAlgorithm: 'scene',
        highlightEngine: 'emotion',
        enableNoiseReduction: true,
        enableCoughFilter: true,
        enableRepeatFilter: true,
      }),
    );
    const llmPlanSliceRequest = nativeVideoSliceLlmPlanCommands.find((entry) => entry.kind === 'slice')?.request;
    assertEqual(
      nativeVideoSliceLlmPlanCommands.find((entry) => entry.kind === 'transcribe')?.kind,
      'transcribe',
      'video slice LLM workflow transcribes before planning and slicing because smart slicing requires speech-to-text',
    );
    assertEqual(
      llmPlanSliceRequest?.subtitleMode,
      undefined,
      'video slice LLM workflow does not request subtitle rendering unless subtitles are enabled',
    );
    assertEqual(
      llmPlanSliceRequest?.subtitleSegments,
      undefined,
      'video slice LLM workflow keeps transcript segments out of native subtitle rendering when subtitles are disabled',
    );
    assertEqual(
      llmPlanSliceRequest?.clips?.length,
      1,
      'video slice LLM workflow prefers speech-aligned transcript candidates instead of adding silent filler clips',
    );
    assertEqual(
      llmPlanSliceRequest?.clips?.[0]?.startMs,
      0,
      'video slice LLM workflow sorts normalized clips by start time',
    );
    assertNumberBetween(
      llmPlanSliceRequest?.clips?.[0]?.durationMs,
      20000,
      21000,
      'video slice LLM workflow keeps speech-aligned clips tight instead of padding them to the configured minimum duration',
    );
    assertRule(
      llmPlanSliceRequest?.clips?.every((clip) => clip.durationMs < 22000),
      'video slice LLM workflow avoids minimum-duration silent padding when transcript speech produces a valid tight candidate',
    );
    assertRule(
      !llmPlanSliceRequest?.clips?.some((clip) => clip.startMs >= 32000),
      'video slice LLM workflow drops model clips that start after imported media duration',
    );
    assertRule(
      llmPlanSliceRequest?.clips?.every((clip) => clip.startMs + clip.durationMs <= 32000),
      'video slice LLM workflow clamps all normalized clips inside imported media duration',
    );
    assertRule(
      llmPlanSliceRequest?.clips?.every((clip, index, clips) =>
        index === 0 || clip.startMs >= clips[index - 1].startMs + clips[index - 1].durationMs,
      ),
      'video slice LLM workflow returns non-overlapping normalized clips',
    );
    services.configureAutoCutApprovedAiSdkBridge(null);
    services.resetAutoCutNativeHostClient();

    resetStorage();
    const nativeVideoCompressWorkflowCommands = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        contractVersion: 'contract-test',
        hostKind: 'native-host',
        databaseContractReady: true,
        sqliteMigrationReady: true,
        databaseHealthCommandReady: true,
        ffmpegProbeCommandReady: true,
        mediaImportCommandReady: true,
        mediaFileDescribeCommandReady: true,
          localVideoFileSelectCommandReady: true,
        audioExtractionCommandReady: false,
        audioExtractionFromAssetReady: false,
        videoGifCommandReady: false,
        videoCompressCommandReady: true,
        videoConvertCommandReady: false,
        videoEnhanceCommandReady: false,
        nativeTaskQueryCommandReady: true,
        nativeTaskCancelCommandReady: false,
        nativeTaskRecoveryCommandReady: false,
        nativeTaskRetryCommandReady: false,
        nativeTaskProgressEventsReady: false,
        ffmpegToolchainManifestReady: true,
        ffmpegToolchainResolverReady: true,
        ffmpegBundledReady: false,
        ffmpegExecutionReady: false,
        supportedCommands: ['autocut_import_media_file', 'autocut_compress_video'],
      }),
      getDatabaseHealth: async () => ({
        ready: true,
        databasePath: 'memory',
        appliedMigrations: ['baseline'],
        verifiedTables: ['media_asset'],
        missingTables: [],
        diagnostics: [],
      }),
      probeFfmpeg: async () => ({
        available: true,
        executable: 'ffmpeg',
        sourceKind: 'system-path',
        manifestReady: true,
        bundledReady: false,
        versionLine: 'ffmpeg contract',
        diagnostics: [],
      }),
      importMediaFile: async (request) => {
        nativeVideoCompressWorkflowCommands.push({ kind: 'import', request });
        return {
          assetUuid: 'native-compress-asset',
          sandboxPath: 'D:/autocut/media/inputs/native-compress-asset.mp4',
          byteSize: 987654,
          name: 'native-source.mp4',
          mediaType: 'video',
          mimeType: 'video/mp4',
        };
      },
      describeLocalMediaFile: async (request) => ({
        sourcePath: request.sourcePath,
        byteSize: 987654,
        name: 'native-source.mp4',
        mediaType: 'video',
        mimeType: 'video/mp4',
      }),
      extractAudio: async () => {
        throw new Error('audio extraction is not configured for the native video compression workflow contract');
      },
      generateGif: async () => {
        throw new Error('video GIF command is not configured for the native video compression workflow contract');
      },
      compressVideo: async (request) => {
        nativeVideoCompressWorkflowCommands.push({ kind: 'compress', request });
        const output = createNativeTaskOutputArtifact('native-compress-task', 'native-compress-artifact.mp4');
        return {
          artifactUuid: 'native-compress-artifact',
          taskUuid: 'native-compress-task',
          sourceAssetUuid: request.assetUuid,
          artifactPath: output.artifactPath,
          taskOutputDir: output.taskOutputDir,
          byteSize: 345678,
          originalByteSize: 987654,
          format: 'mp4',
          ffmpegExecutable: 'ffmpeg',
        };
      },
      convertVideo: async () => {
        throw new Error('video conversion command is not configured for the native video compression workflow contract');
      },
      enhanceVideo: async () => {
        throw new Error('video enhancement command is not configured for the native video compression workflow contract');
      },
      runAudioSmoke: async () => ({
        artifactUuid: 'native-audio-smoke',
        taskUuid: 'native-audio-smoke-task',
        sourceAssetUuid: '',
        artifactPath: createNativeTaskOutputArtifact('native-audio-smoke-task', 'native-audio-smoke.wav').artifactPath,
        taskOutputDir: createNativeTaskOutputArtifact('native-audio-smoke-task', 'native-audio-smoke.wav').taskOutputDir,
        byteSize: 1,
        format: 'wav',
        ffmpegExecutable: 'ffmpeg',
      }),
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    });
    const nativeVideoCompressSourceFile = createTrustedLocalMediaFile(commons, 'D:/media/native-source.mp4');
    const nativeVideoCompressWorkflowResult = await withImmediateTimers(async () =>
      processVideoCompress({
        fileId: 'asset-source-native-video-compress',
        file: nativeVideoCompressSourceFile,
        compressionMode: 'balanced',
      }),
    );
    const nativeVideoCompressWorkflowTasks = readScopedStoredArray(services, 'tasks');
    const nativeVideoCompressWorkflowTask = nativeVideoCompressWorkflowTasks.find(
      (task) => task.id === nativeVideoCompressWorkflowResult.taskId,
    );
    const nativeVideoCompressWorkflowAssets = readScopedStoredArray(services, 'assets');
    assertEqual(nativeVideoCompressWorkflowResult.success, true, 'video compress native workflow reports success');
    assertEqual(
      nativeVideoCompressWorkflowCommands[0]?.kind,
      'import',
      'video compress native workflow imports local media before compression',
    );
    assertEqual(
      nativeVideoCompressWorkflowCommands[0]?.request?.sourcePath,
      'D:/media/native-source.mp4',
      'video compress native workflow passes the trusted desktop source path to media import',
    );
    assertEqual(
      nativeVideoCompressWorkflowCommands[1]?.kind,
      'compress',
      'video compress native workflow compresses after import',
    );
    assertEqual(
      nativeVideoCompressWorkflowCommands[1]?.request?.assetUuid,
      'native-compress-asset',
      'video compress native workflow compresses by imported assetUuid',
    );
    assertEqual(
      nativeVideoCompressWorkflowCommands[1]?.request?.compressionMode,
      'balanced',
      'video compress native workflow forwards the selected compression mode',
    );
    assertEqual(
      nativeVideoCompressWorkflowTask?.status,
      types.AUTOCUT_TASK_STATUS.completed,
      'video compress native workflow completes the persisted task',
    );
    assertEqual(
      nativeVideoCompressWorkflowTask?.videoUrl,
      'asset://localhost/D%3A%2Fautocut%2Fmedia%2Ftasks%2Fnative-compress-task%2Foutputs%2Fnative-compress-artifact.mp4',
      'video compress native workflow converts native artifact paths to safe asset URLs',
    );
    assertEqual(
      nativeVideoCompressWorkflowTask?.fileSizeStats?.originalSize,
      987654,
      'video compress native workflow stores native original byte size on the task',
    );
    assertEqual(
      nativeVideoCompressWorkflowTask?.fileSizeStats?.newSize,
      345678,
      'video compress native workflow stores native compressed byte size on the task',
    );
    assertEqual(
      nativeVideoCompressWorkflowTask?.fileSizeStats?.compressionRatio,
      0.65,
      'video compress native workflow stores normalized compression ratio on the task',
    );
    assertEqual(
      nativeVideoCompressWorkflowAssets[0]?.type,
      'video',
      'video compress native workflow stores the compressed output as a video asset',
    );
    assertEqual(
      nativeVideoCompressWorkflowAssets[0]?.size,
      345678,
      'video compress native workflow stores the native artifact byte size on the generated asset',
    );
    assertEqual(
      nativeVideoCompressWorkflowAssets[0]?.url,
      nativeVideoCompressWorkflowTask?.videoUrl,
      'video compress native workflow stores the safe asset URL on the generated asset',
    );
    services.resetAutoCutNativeHostClient();

    resetStorage();
    const escapedNativeVideoCompressWorkflowCommands = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        contractVersion: 'contract-test',
        hostKind: 'native-host',
        databaseContractReady: true,
        sqliteMigrationReady: true,
        databaseHealthCommandReady: true,
        ffmpegProbeCommandReady: true,
        mediaImportCommandReady: true,
        mediaFileDescribeCommandReady: true,
        localVideoFileSelectCommandReady: true,
        audioExtractionCommandReady: false,
        audioExtractionFromAssetReady: false,
        videoGifCommandReady: false,
        videoCompressCommandReady: true,
        videoConvertCommandReady: false,
        videoEnhanceCommandReady: false,
        nativeTaskQueryCommandReady: true,
        nativeTaskCancelCommandReady: false,
        nativeTaskRecoveryCommandReady: false,
        nativeTaskRetryCommandReady: false,
        nativeTaskProgressEventsReady: false,
        ffmpegToolchainManifestReady: true,
        ffmpegToolchainResolverReady: true,
        ffmpegBundledReady: false,
        ffmpegExecutionReady: false,
        supportedCommands: ['autocut_import_media_file', 'autocut_compress_video'],
      }),
      getDatabaseHealth: async () => ({
        ready: true,
        databasePath: 'memory',
        appliedMigrations: ['baseline'],
        verifiedTables: ['media_asset'],
        missingTables: [],
        diagnostics: [],
      }),
      probeFfmpeg: async () => ({
        available: true,
        executable: 'ffmpeg',
        sourceKind: 'system-path',
        manifestReady: true,
        bundledReady: false,
        versionLine: 'ffmpeg contract',
        diagnostics: [],
      }),
      importMediaFile: async (request) => {
        escapedNativeVideoCompressWorkflowCommands.push({ kind: 'import', request });
        return {
          assetUuid: 'escaped-native-compress-asset',
          sandboxPath: 'D:/autocut/media/inputs/escaped-native-compress-asset.mp4',
          byteSize: 987654,
          name: 'escaped-native-source.mp4',
          mediaType: 'video',
          mimeType: 'video/mp4',
        };
      },
      describeLocalMediaFile: async (request) => ({
        sourcePath: request.sourcePath,
        byteSize: 987654,
        name: 'escaped-native-source.mp4',
        mediaType: 'video',
        mimeType: 'video/mp4',
      }),
      extractAudio: async () => {
        throw new Error('audio extraction is not configured for escaped native video compression contract');
      },
      generateGif: async () => {
        throw new Error('video GIF command is not configured for escaped native video compression contract');
      },
      compressVideo: async (request) => {
        escapedNativeVideoCompressWorkflowCommands.push({ kind: 'compress', request });
        return {
          artifactUuid: 'escaped-native-compress-artifact',
          taskUuid: 'escaped-native-compress-task',
          sourceAssetUuid: request.assetUuid,
          artifactPath: 'D:/autocut/media/tasks/escaped-native-compress-task/compressed.mp4',
          taskOutputDir: 'D:/autocut/media/tasks/escaped-native-compress-task/outputs',
          byteSize: 345678,
          originalByteSize: 987654,
          format: 'mp4',
          ffmpegExecutable: 'ffmpeg',
        };
      },
      convertVideo: async () => {
        throw new Error('video conversion command is not configured for escaped native video compression contract');
      },
      enhanceVideo: async () => {
        throw new Error('video enhancement command is not configured for escaped native video compression contract');
      },
      runAudioSmoke: async () => ({
        artifactUuid: 'native-audio-smoke',
        taskUuid: 'native-audio-smoke-task',
        sourceAssetUuid: '',
        artifactPath: createNativeTaskOutputArtifact('native-audio-smoke-task', 'native-audio-smoke.wav').artifactPath,
        taskOutputDir: createNativeTaskOutputArtifact('native-audio-smoke-task', 'native-audio-smoke.wav').taskOutputDir,
        byteSize: 1,
        format: 'wav',
        ffmpegExecutable: 'ffmpeg',
      }),
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    });
    const escapedNativeVideoCompressSourceFile = createTrustedLocalMediaFile(
      commons,
      'D:/media/escaped-native-source.mp4',
      'escaped-native-source.mp4',
    );
    await assertRejects(
      () =>
        withImmediateTimers(async () =>
          processVideoCompress({
            fileId: 'asset-source-escaped-native-video-compress',
            file: escapedNativeVideoCompressSourceFile,
            compressionMode: 'balanced',
          }),
        ),
      'artifactPath is outside its task output directory',
      'video compress native escaped artifact containment',
    );
    const escapedNativeVideoCompressWorkflowTasks = readScopedStoredArray(services, 'tasks');
    assertEqual(
      escapedNativeVideoCompressWorkflowCommands[1]?.kind,
      'compress',
      'video compress native escaped artifact containment reaches the native compression boundary',
    );
    assertEqual(
      escapedNativeVideoCompressWorkflowTasks[0]?.status,
      types.AUTOCUT_TASK_STATUS.failed,
      'video compress native escaped artifact containment marks the task failed',
    );
    assertIncludes(
      String(escapedNativeVideoCompressWorkflowTasks[0]?.errorMessage ?? ''),
      'artifactPath is outside its task output directory',
      'video compress native escaped artifact containment stores the path containment reason',
    );
    assertEqual(readScopedStoredArray(services, 'assets').length, 0, 'video compress native escaped artifact containment does not persist generated assets');
    assertEqual(readScopedStoredArray(services, 'messages').length, 0, 'video compress native escaped artifact containment does not persist success messages');
    services.resetAutoCutNativeHostClient();

    resetStorage();
    const dotSegmentEscapedNativeVideoCompressWorkflowCommands = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        contractVersion: 'contract-test',
        hostKind: 'native-host',
        databaseContractReady: true,
        sqliteMigrationReady: true,
        databaseHealthCommandReady: true,
        ffmpegProbeCommandReady: true,
        mediaImportCommandReady: true,
        mediaFileDescribeCommandReady: true,
        localVideoFileSelectCommandReady: true,
        audioExtractionCommandReady: false,
        audioExtractionFromAssetReady: false,
        videoGifCommandReady: false,
        videoCompressCommandReady: true,
        videoConvertCommandReady: false,
        videoEnhanceCommandReady: false,
        nativeTaskQueryCommandReady: true,
        nativeTaskCancelCommandReady: false,
        nativeTaskRecoveryCommandReady: false,
        nativeTaskRetryCommandReady: false,
        nativeTaskProgressEventsReady: false,
        ffmpegToolchainManifestReady: true,
        ffmpegToolchainResolverReady: true,
        ffmpegBundledReady: false,
        ffmpegExecutionReady: false,
        supportedCommands: ['autocut_import_media_file', 'autocut_compress_video'],
      }),
      importMediaFile: async (request) => {
        dotSegmentEscapedNativeVideoCompressWorkflowCommands.push({ kind: 'import', request });
        return {
          assetUuid: 'dot-segment-escaped-native-compress-asset',
          sandboxPath: 'D:/autocut/media/inputs/dot-segment-escaped-native-compress-asset.mp4',
          byteSize: 987654,
          name: 'dot-segment-escaped-native-source.mp4',
          mediaType: 'video',
          mimeType: 'video/mp4',
        };
      },
      describeLocalMediaFile: async (request) => ({
        sourcePath: request.sourcePath,
        byteSize: 987654,
        name: 'dot-segment-escaped-native-source.mp4',
        mediaType: 'video',
        mimeType: 'video/mp4',
      }),
      extractAudio: async () => {
        throw new Error('audio extraction is not configured for dot-segment escaped native video compression contract');
      },
      generateGif: async () => {
        throw new Error('video GIF command is not configured for dot-segment escaped native video compression contract');
      },
      compressVideo: async (request) => {
        dotSegmentEscapedNativeVideoCompressWorkflowCommands.push({ kind: 'compress', request });
        return {
          artifactUuid: 'dot-segment-escaped-native-compress-artifact',
          taskUuid: 'dot-segment-escaped-native-compress-task',
          sourceAssetUuid: request.assetUuid,
          artifactPath: 'D:/autocut/media/tasks/dot-segment-escaped-native-compress-task/outputs/../compressed.mp4',
          taskOutputDir: 'D:/autocut/media/tasks/dot-segment-escaped-native-compress-task/outputs',
          byteSize: 345678,
          originalByteSize: 987654,
          format: 'mp4',
          ffmpegExecutable: 'ffmpeg',
        };
      },
      convertVideo: async () => {
        throw new Error('video conversion command is not configured for dot-segment escaped native video compression contract');
      },
      enhanceVideo: async () => {
        throw new Error('video enhancement command is not configured for dot-segment escaped native video compression contract');
      },
      runAudioSmoke: async () => ({
        artifactUuid: 'native-audio-smoke',
        taskUuid: 'native-audio-smoke-task',
        sourceAssetUuid: '',
        artifactPath: createNativeTaskOutputArtifact('native-audio-smoke-task', 'native-audio-smoke.wav').artifactPath,
        taskOutputDir: createNativeTaskOutputArtifact('native-audio-smoke-task', 'native-audio-smoke.wav').taskOutputDir,
        byteSize: 1,
        format: 'wav',
        ffmpegExecutable: 'ffmpeg',
      }),
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    });
    const dotSegmentEscapedNativeVideoCompressSourceFile = createTrustedLocalMediaFile(
      commons,
      'D:/media/dot-segment-escaped-native-source.mp4',
      'dot-segment-escaped-native-source.mp4',
    );
    await assertRejects(
      () =>
        withImmediateTimers(async () =>
          processVideoCompress({
            fileId: 'asset-source-dot-segment-escaped-native-video-compress',
            file: dotSegmentEscapedNativeVideoCompressSourceFile,
            compressionMode: 'balanced',
          }),
        ),
      'artifactPath is outside its task output directory',
      'video compress native dot-segment escaped artifact containment',
    );
    const dotSegmentEscapedNativeVideoCompressWorkflowTasks = readScopedStoredArray(services, 'tasks');
    assertEqual(
      dotSegmentEscapedNativeVideoCompressWorkflowCommands[1]?.kind,
      'compress',
      'video compress native dot-segment escaped artifact containment reaches the native compression boundary',
    );
    assertEqual(
      dotSegmentEscapedNativeVideoCompressWorkflowTasks[0]?.status,
      types.AUTOCUT_TASK_STATUS.failed,
      'video compress native dot-segment escaped artifact containment marks the task failed',
    );
    assertIncludes(
      String(dotSegmentEscapedNativeVideoCompressWorkflowTasks[0]?.errorMessage ?? ''),
      'artifactPath is outside its task output directory',
      'video compress native dot-segment escaped artifact containment stores the path containment reason',
    );
    assertEqual(readScopedStoredArray(services, 'assets').length, 0, 'video compress native dot-segment escaped artifact containment does not persist generated assets');
    assertEqual(readScopedStoredArray(services, 'messages').length, 0, 'video compress native dot-segment escaped artifact containment does not persist success messages');
    services.resetAutoCutNativeHostClient();

    resetStorage();
    const nativeVideoConvertWorkflowCommands = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        contractVersion: 'contract-test',
        hostKind: 'native-host',
        databaseContractReady: true,
        sqliteMigrationReady: true,
        databaseHealthCommandReady: true,
        ffmpegProbeCommandReady: true,
        mediaImportCommandReady: true,
        mediaFileDescribeCommandReady: true,
          localVideoFileSelectCommandReady: true,
        audioExtractionCommandReady: false,
        audioExtractionFromAssetReady: false,
        videoGifCommandReady: false,
        videoCompressCommandReady: false,
        videoConvertCommandReady: true,
        videoEnhanceCommandReady: false,
        nativeTaskQueryCommandReady: true,
        nativeTaskCancelCommandReady: false,
        nativeTaskRecoveryCommandReady: false,
        nativeTaskRetryCommandReady: false,
        nativeTaskProgressEventsReady: false,
        ffmpegToolchainManifestReady: true,
        ffmpegToolchainResolverReady: true,
        ffmpegBundledReady: false,
        ffmpegExecutionReady: false,
        supportedCommands: ['autocut_import_media_file', 'autocut_convert_video'],
      }),
      getDatabaseHealth: async () => ({
        ready: true,
        databasePath: 'memory',
        appliedMigrations: ['baseline'],
        verifiedTables: ['media_asset'],
        missingTables: [],
        diagnostics: [],
      }),
      probeFfmpeg: async () => ({
        available: true,
        executable: 'ffmpeg',
        sourceKind: 'system-path',
        manifestReady: true,
        bundledReady: false,
        versionLine: 'ffmpeg contract',
        diagnostics: [],
      }),
      importMediaFile: async (request) => {
        nativeVideoConvertWorkflowCommands.push({ kind: 'import', request });
        return {
          assetUuid: 'native-convert-asset',
          sandboxPath: 'D:/autocut/media/inputs/native-convert-asset.mp4',
          byteSize: 987654,
          name: 'native-source.mp4',
          mediaType: 'video',
          mimeType: 'video/mp4',
        };
      },
      describeLocalMediaFile: async (request) => ({
        sourcePath: request.sourcePath,
        byteSize: 987654,
        name: 'native-source.mp4',
        mediaType: 'video',
        mimeType: 'video/mp4',
      }),
      extractAudio: async () => {
        throw new Error('audio extraction is not configured for the native video conversion workflow contract');
      },
      generateGif: async () => {
        throw new Error('video GIF command is not configured for the native video conversion workflow contract');
      },
      compressVideo: async () => {
        throw new Error('video compression command is not configured for the native video conversion workflow contract');
      },
      convertVideo: async (request) => {
        nativeVideoConvertWorkflowCommands.push({ kind: 'convert', request });
        const output = createNativeTaskOutputArtifact('native-convert-task', 'native-convert-artifact.webm');
        return {
          artifactUuid: 'native-convert-artifact',
          taskUuid: 'native-convert-task',
          sourceAssetUuid: request.assetUuid,
          artifactPath: output.artifactPath,
          taskOutputDir: output.taskOutputDir,
          byteSize: 456789,
          format: 'webm',
          ffmpegExecutable: 'ffmpeg',
        };
      },
      enhanceVideo: async () => {
        throw new Error('video enhancement command is not configured for the native video conversion workflow contract');
      },
      runAudioSmoke: async () => ({
        artifactUuid: 'native-audio-smoke',
        taskUuid: 'native-audio-smoke-task',
        sourceAssetUuid: '',
        artifactPath: createNativeTaskOutputArtifact('native-audio-smoke-task', 'native-audio-smoke.wav').artifactPath,
        taskOutputDir: createNativeTaskOutputArtifact('native-audio-smoke-task', 'native-audio-smoke.wav').taskOutputDir,
        byteSize: 1,
        format: 'wav',
        ffmpegExecutable: 'ffmpeg',
      }),
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    });
    const nativeVideoConvertSourceFile = createTrustedLocalMediaFile(commons, 'D:/media/native-source.mp4');
    const nativeVideoConvertWorkflowResult = await withImmediateTimers(async () =>
      processVideoConvert({
        fileId: 'asset-source-native-video-convert',
        file: nativeVideoConvertSourceFile,
        targetFormat: 'webm',
        videoCodec: 'vp9',
        audioCodec: 'opus',
        resolution: '720p',
      }),
    );
    const nativeVideoConvertWorkflowTasks = readScopedStoredArray(services, 'tasks');
    const nativeVideoConvertWorkflowTask = nativeVideoConvertWorkflowTasks.find(
      (task) => task.id === nativeVideoConvertWorkflowResult.taskId,
    );
    const nativeVideoConvertWorkflowAssets = readScopedStoredArray(services, 'assets');
    assertEqual(nativeVideoConvertWorkflowResult.success, true, 'video convert native workflow reports success');
    assertEqual(
      nativeVideoConvertWorkflowCommands[0]?.kind,
      'import',
      'video convert native workflow imports local media before conversion',
    );
    assertEqual(
      nativeVideoConvertWorkflowCommands[0]?.request?.sourcePath,
      'D:/media/native-source.mp4',
      'video convert native workflow passes the trusted desktop source path to media import',
    );
    assertEqual(
      nativeVideoConvertWorkflowCommands[1]?.kind,
      'convert',
      'video convert native workflow converts after import',
    );
    assertEqual(
      nativeVideoConvertWorkflowCommands[1]?.request?.assetUuid,
      'native-convert-asset',
      'video convert native workflow converts by imported assetUuid',
    );
    assertEqual(
      nativeVideoConvertWorkflowCommands[1]?.request?.targetFormat,
      'webm',
      'video convert native workflow forwards the selected target format',
    );
    assertEqual(
      nativeVideoConvertWorkflowCommands[1]?.request?.videoCodec,
      'vp9',
      'video convert native workflow forwards the selected video codec',
    );
    assertEqual(
      nativeVideoConvertWorkflowCommands[1]?.request?.audioCodec,
      'opus',
      'video convert native workflow forwards the selected audio codec',
    );
    assertEqual(
      nativeVideoConvertWorkflowCommands[1]?.request?.resolution,
      '720p',
      'video convert native workflow forwards the selected resolution',
    );
    assertEqual(
      nativeVideoConvertWorkflowTask?.status,
      types.AUTOCUT_TASK_STATUS.completed,
      'video convert native workflow completes the persisted task',
    );
    assertEqual(
      nativeVideoConvertWorkflowTask?.videoUrl,
      'asset://localhost/D%3A%2Fautocut%2Fmedia%2Ftasks%2Fnative-convert-task%2Foutputs%2Fnative-convert-artifact.webm',
      'video convert native workflow converts native artifact paths to safe asset URLs',
    );
    assertEqual(
      nativeVideoConvertWorkflowAssets[0]?.type,
      'video',
      'video convert native workflow stores the converted output as a video asset',
    );
    assertEqual(
      nativeVideoConvertWorkflowAssets[0]?.size,
      456789,
      'video convert native workflow stores the native artifact byte size on the generated asset',
    );
    assertEqual(
      nativeVideoConvertWorkflowAssets[0]?.url,
      nativeVideoConvertWorkflowTask?.videoUrl,
      'video convert native workflow stores the safe asset URL on the generated asset',
    );
    services.resetAutoCutNativeHostClient();

    resetStorage();
    const nativeVideoEnhanceWorkflowCommands = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        contractVersion: 'contract-test',
        hostKind: 'native-host',
        databaseContractReady: true,
        sqliteMigrationReady: true,
        databaseHealthCommandReady: true,
        ffmpegProbeCommandReady: true,
        mediaImportCommandReady: true,
        mediaFileDescribeCommandReady: true,
          localVideoFileSelectCommandReady: true,
        audioExtractionCommandReady: false,
        audioExtractionFromAssetReady: false,
        videoGifCommandReady: false,
        videoCompressCommandReady: false,
        videoConvertCommandReady: false,
        videoEnhanceCommandReady: true,
        nativeTaskQueryCommandReady: true,
        nativeTaskCancelCommandReady: false,
        nativeTaskRecoveryCommandReady: false,
        nativeTaskRetryCommandReady: false,
        nativeTaskProgressEventsReady: false,
        ffmpegToolchainManifestReady: true,
        ffmpegToolchainResolverReady: true,
        ffmpegBundledReady: false,
        ffmpegExecutionReady: false,
        supportedCommands: ['autocut_import_media_file', 'autocut_enhance_video'],
      }),
      getDatabaseHealth: async () => ({
        ready: true,
        databasePath: 'memory',
        appliedMigrations: ['baseline'],
        verifiedTables: ['media_asset'],
        missingTables: [],
        diagnostics: [],
      }),
      probeFfmpeg: async () => ({
        available: true,
        executable: 'ffmpeg',
        sourceKind: 'system-path',
        manifestReady: true,
        bundledReady: false,
        versionLine: 'ffmpeg contract',
        diagnostics: [],
      }),
      importMediaFile: async (request) => {
        nativeVideoEnhanceWorkflowCommands.push({ kind: 'import', request });
        return {
          assetUuid: 'native-enhance-asset',
          sandboxPath: 'D:/autocut/media/inputs/native-enhance-asset.mp4',
          byteSize: 987654,
          name: 'native-source.mp4',
          mediaType: 'video',
          mimeType: 'video/mp4',
        };
      },
      describeLocalMediaFile: async (request) => ({
        sourcePath: request.sourcePath,
        byteSize: 987654,
        name: 'native-source.mp4',
        mediaType: 'video',
        mimeType: 'video/mp4',
      }),
      extractAudio: async () => {
        throw new Error('audio extraction is not configured for the native video enhancement workflow contract');
      },
      generateGif: async () => {
        throw new Error('video GIF command is not configured for the native video enhancement workflow contract');
      },
      compressVideo: async () => {
        throw new Error('video compression command is not configured for the native video enhancement workflow contract');
      },
      convertVideo: async () => {
        throw new Error('video conversion command is not configured for the native video enhancement workflow contract');
      },
      enhanceVideo: async (request) => {
        nativeVideoEnhanceWorkflowCommands.push({ kind: 'enhance', request });
        const output = createNativeTaskOutputArtifact('native-enhance-task', 'native-enhance-artifact.mp4');
        return {
          artifactUuid: 'native-enhance-artifact',
          taskUuid: 'native-enhance-task',
          sourceAssetUuid: request.assetUuid,
          artifactPath: output.artifactPath,
          taskOutputDir: output.taskOutputDir,
          byteSize: 567890,
          format: 'mp4',
          ffmpegExecutable: 'ffmpeg',
        };
      },
      runAudioSmoke: async () => ({
        artifactUuid: 'native-audio-smoke',
        taskUuid: 'native-audio-smoke-task',
        sourceAssetUuid: '',
        artifactPath: createNativeTaskOutputArtifact('native-audio-smoke-task', 'native-audio-smoke.wav').artifactPath,
        taskOutputDir: createNativeTaskOutputArtifact('native-audio-smoke-task', 'native-audio-smoke.wav').taskOutputDir,
        byteSize: 1,
        format: 'wav',
        ffmpegExecutable: 'ffmpeg',
      }),
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    });
    const nativeVideoEnhanceSourceFile = createTrustedLocalMediaFile(commons, 'D:/media/native-source.mp4');
    const nativeVideoEnhanceWorkflowResult = await withImmediateTimers(async () =>
      processVideoEnhance({
        fileId: 'asset-source-native-video-enhance',
        file: nativeVideoEnhanceSourceFile,
        targetResolution: '1080p',
        enhanceMode: 'real',
        frameRate: '60',
      }),
    );
    const nativeVideoEnhanceWorkflowTasks = readScopedStoredArray(services, 'tasks');
    const nativeVideoEnhanceWorkflowTask = nativeVideoEnhanceWorkflowTasks.find(
      (task) => task.id === nativeVideoEnhanceWorkflowResult.taskId,
    );
    const nativeVideoEnhanceWorkflowAssets = readScopedStoredArray(services, 'assets');
    assertEqual(nativeVideoEnhanceWorkflowResult.success, true, 'video enhance native workflow reports success');
    assertEqual(
      nativeVideoEnhanceWorkflowCommands[0]?.kind,
      'import',
      'video enhance native workflow imports local media before enhancement',
    );
    assertEqual(
      nativeVideoEnhanceWorkflowCommands[0]?.request?.sourcePath,
      'D:/media/native-source.mp4',
      'video enhance native workflow passes the trusted desktop source path to media import',
    );
    assertEqual(
      nativeVideoEnhanceWorkflowCommands[1]?.kind,
      'enhance',
      'video enhance native workflow enhances after import',
    );
    assertEqual(
      nativeVideoEnhanceWorkflowCommands[1]?.request?.assetUuid,
      'native-enhance-asset',
      'video enhance native workflow enhances by imported assetUuid',
    );
    assertEqual(
      nativeVideoEnhanceWorkflowCommands[1]?.request?.targetResolution,
      '1080p',
      'video enhance native workflow forwards the selected target resolution',
    );
    assertEqual(
      nativeVideoEnhanceWorkflowCommands[1]?.request?.enhanceMode,
      'real',
      'video enhance native workflow forwards the selected enhance mode',
    );
    assertEqual(
      nativeVideoEnhanceWorkflowCommands[1]?.request?.frameRate,
      '60',
      'video enhance native workflow forwards the selected frame rate',
    );
    assertEqual(
      nativeVideoEnhanceWorkflowTask?.status,
      types.AUTOCUT_TASK_STATUS.completed,
      'video enhance native workflow completes the persisted task',
    );
    assertEqual(
      nativeVideoEnhanceWorkflowTask?.videoUrl,
      'asset://localhost/D%3A%2Fautocut%2Fmedia%2Ftasks%2Fnative-enhance-task%2Foutputs%2Fnative-enhance-artifact.mp4',
      'video enhance native workflow converts native artifact paths to safe asset URLs',
    );
    assertEqual(
      nativeVideoEnhanceWorkflowAssets[0]?.type,
      'video',
      'video enhance native workflow stores the enhanced output as a video asset',
    );
    assertEqual(
      nativeVideoEnhanceWorkflowAssets[0]?.size,
      567890,
      'video enhance native workflow stores the native artifact byte size on the generated asset',
    );
    assertEqual(
      nativeVideoEnhanceWorkflowAssets[0]?.url,
      nativeVideoEnhanceWorkflowTask?.videoUrl,
      'video enhance native workflow stores the safe asset URL on the generated asset',
    );
    services.resetAutoCutNativeHostClient();

    resetStorage();
    const taskEvents = captureEvents(services, 'taskAdded');
    const taskUpdateEvents = captureEvents(services, 'taskUpdated');
    const taskDeleteEvents = captureEvents(services, 'taskDeleted');
    const task = {
      id: 'contract-task',
      type: '瑙嗛鍘嬬缉',
      name: 'contract.mp4',
      status: types.AUTOCUT_TASK_STATUS.pending,
      progress: 0,
      createdAt: '2026-05-05T00:00:00.000Z',
    };
    await withImmediateTimers(async () => {
      await services.addTask(task);
      await services.updateTask(task.id, {
        status: types.AUTOCUT_TASK_STATUS.completed,
        progress: 100,
        videoUrl: 'blob:contract-video',
      });
      await services.deleteTask(task.id);
    });
    taskEvents.stop();
    taskUpdateEvents.stop();
    taskDeleteEvents.stop();
    const storedTasks = readScopedStoredArray(services, 'tasks');
    assertEqual(taskEvents.details[0]?.id, task.id, 'addTask dispatches taskAdded with the created task');
    assertEqual(taskUpdateEvents.details[0]?.progress, 100, 'updateTask dispatches taskUpdated with merged progress');
    assertEqual(taskDeleteEvents.details[0]?.id, task.id, 'deleteTask dispatches taskDeleted with the deleted task id');
    assertRule(storedTasks.every((storedTask) => storedTask.id !== task.id), 'deleteTask removes the task from persisted storage');

    resetStorage();
    const bulkTaskDeleteEvents = captureEvents(services, 'taskDeleted');
    const bulkTasks = [
      {
        id: 'bulk-task-a',
        type: types.AUTOCUT_TASK_TYPE.videoSlice,
        name: 'bulk-a.mp4',
        status: types.AUTOCUT_TASK_STATUS.completed,
        progress: 100,
        createdAt: '2026-05-05T00:00:00.000Z',
      },
      {
        id: 'bulk-task-b',
        type: types.AUTOCUT_TASK_TYPE.audioExtraction,
        name: 'bulk-b.wav',
        status: types.AUTOCUT_TASK_STATUS.failed,
        progress: 0,
        createdAt: '2026-05-05T00:01:00.000Z',
      },
      {
        id: 'bulk-task-c',
        type: types.AUTOCUT_TASK_TYPE.videoCompress,
        name: 'bulk-c.mp4',
        status: types.AUTOCUT_TASK_STATUS.processing,
        progress: 50,
        createdAt: '2026-05-05T00:02:00.000Z',
      },
    ];
    await withImmediateTimers(async () => {
      await Promise.all(bulkTasks.map((bulkTask) => services.addTask(bulkTask)));
    });
    const bulkDeleteResult = await services.deleteTasks(['bulk-task-a', 'missing-task', 'bulk-task-b', 'bulk-task-a']);
    bulkTaskDeleteEvents.stop();
    const storedTasksAfterBulkDelete = readScopedStoredArray(services, 'tasks');
    assertDeepEqual(
      bulkDeleteResult,
      {
        requested: 4,
        succeeded: 2,
        skipped: 1,
        taskIds: ['bulk-task-a', 'bulk-task-b'],
        skippedTaskIds: ['missing-task'],
        deleted: 2,
        deletedTaskIds: ['bulk-task-a', 'bulk-task-b'],
      },
      'deleteTasks returns a canonical bulk operation result with deleted and skipped task ids',
    );
    assertDeepEqual(
      bulkTaskDeleteEvents.details.map((detail) => detail.id),
      ['bulk-task-a', 'bulk-task-b'],
      'deleteTasks dispatches one taskDeleted event for each deleted task in request order',
    );
    assertRule(
      storedTasksAfterBulkDelete.some((storedTask) => storedTask.id === 'bulk-task-c') &&
        storedTasksAfterBulkDelete.every((storedTask) => storedTask.id !== 'bulk-task-a' && storedTask.id !== 'bulk-task-b'),
      'deleteTasks removes selected existing tasks without deleting unselected tasks',
    );

    resetStorage();
    const bulkNativeTaskCommands = [];
    const bulkNativeTaskDeleteEvents = captureEvents(services, 'taskDeleted');
    const bulkNativeTaskUpdateEvents = captureEvents(services, 'taskUpdated');
    services.configureAutoCutNativeHostClient(services.createAutoCutNativeHostClient(async (command, args) => {
      bulkNativeTaskCommands.push({ command, args });
      if (command === 'autocut_host_capabilities') {
        return {
          contractVersion: 'bulk-task-operations-test',
          hostKind: 'native-host',
          databaseContractReady: true,
          sqliteMigrationReady: true,
          databaseHealthCommandReady: true,
          ffmpegProbeCommandReady: true,
          mediaImportCommandReady: true,
          mediaFileDescribeCommandReady: true,
          localMediaFileSelectCommandReady: true,
          localVideoFileSelectCommandReady: true,
          localDirectorySelectCommandReady: true,
          localMediaPreviewDirectoryScopeCommandReady: true,
          openArtifactInFolderCommandReady: true,
          audioExtractionCommandReady: true,
          audioExtractionFromAssetReady: true,
          videoGifCommandReady: true,
          videoSliceCommandReady: true,
          videoCompressCommandReady: true,
          videoConvertCommandReady: true,
          videoEnhanceCommandReady: true,
          speechTranscriptionCommandReady: true,
          speechTranscriptionToolchainReady: true,
          speechTranscriptionProbeCommandReady: true,
          speechTranscriptionFileSelectCommandReady: true,
          speechTranscriptionModelDownloadCommandReady: true,
          speechTranscriptionExecutableDownloadCommandReady: false,
          llmHttpCommandReady: true,
          llmSecretStoreReady: true,
          nativeTaskQueryCommandReady: true,
          nativeTaskCancelCommandReady: true,
          nativeTaskRecoveryCommandReady: true,
          nativeTaskRetryCommandReady: true,
          nativeTaskProgressEventsReady: true,
          nativeWorkerLeaseReady: true,
          ffmpegToolchainManifestReady: true,
          ffmpegToolchainResolverReady: true,
          ffmpegBundledReady: true,
          ffmpegExecutionReady: true,
          supportedCommands: [
            'autocut_host_capabilities',
            'autocut_list_native_tasks',
            'autocut_cancel_native_task',
            'autocut_retry_native_task',
          ],
        };
      }
      if (command === 'autocut_list_native_tasks') {
        const snapshots = [
          {
            uuid: 'native-bulk-delete',
            taskType: 3,
            status: 2,
            progress: 100,
            sourceAssetUuid: 'asset-native-bulk-delete',
            inputJson: '{"name":"native-delete.mp4"}',
            outputJson: '{"artifactUuid":"artifact-native-bulk-delete","artifactPath":"D:/autocut/media/tasks/native-bulk-delete/outputs/native-delete.mp4","byteSize":1234}',
            createdAt: '2026-05-05T01:00:00.000Z',
            updatedAt: '2026-05-05T01:01:00.000Z',
            stages: [],
            events: [],
            workerLeases: [],
          },
          {
            uuid: 'native-bulk-cancel',
            taskType: 3,
            status: 1,
            progress: 45,
            sourceAssetUuid: 'asset-native-bulk-cancel',
            inputJson: '{"name":"native-cancel.mp4"}',
            outputJson: '{}',
            createdAt: '2026-05-05T01:02:00.000Z',
            updatedAt: '2026-05-05T01:03:00.000Z',
            stages: [],
            events: [],
            workerLeases: [],
          },
          {
            uuid: 'native-bulk-retry',
            taskType: 3,
            status: 3,
            progress: 15,
            sourceAssetUuid: 'asset-native-bulk-retry',
            inputJson: '{"name":"native-retry.mp4"}',
            outputJson: '{}',
            errorMessage: 'previous failure',
            createdAt: '2026-05-05T01:04:00.000Z',
            updatedAt: '2026-05-05T01:05:00.000Z',
            stages: [],
            events: [],
            workerLeases: [],
          },
        ];
        if (args?.request?.taskUuid) {
          return snapshots.filter((snapshot) => snapshot.uuid === args.request.taskUuid);
        }
        return snapshots;
      }
      if (command === 'autocut_cancel_native_task') {
        return {
          taskUuid: args.request.taskUuid,
          status: 4,
          canceled: true,
          message: 'cancel requested',
        };
      }
      if (command === 'autocut_retry_native_task') {
        return {
          taskUuid: args.request.taskUuid,
          retryTaskUuid: `${args.request.taskUuid}-retry`,
          status: 1,
          retried: true,
          message: 'retry queued',
        };
      }
      throw new Error(`Unexpected bulk native task command: ${command}`);
    }, {
      createAssetUrl: (artifactPath) => `asset://localhost/${encodeURIComponent(artifactPath)}`,
    }));

    const nativeBulkDeleteResult = await services.deleteTasks(['native-bulk-delete', 'missing-native-task']);
    const nativeBulkCancelResult = await services.cancelTasks(['native-bulk-cancel', 'native-bulk-delete', 'native-bulk-cancel']);
    const nativeBulkRetryResult = await services.retryTasks(['native-bulk-retry', 'native-bulk-cancel', 'native-bulk-retry']);
    bulkNativeTaskDeleteEvents.stop();
    bulkNativeTaskUpdateEvents.stop();
    const dismissedNativeTaskIds = readScopedStoredArray(services, 'dismissedNativeTasks');
    assertDeepEqual(
      nativeBulkDeleteResult,
      {
        requested: 2,
        succeeded: 1,
        skipped: 1,
        taskIds: ['native-bulk-delete'],
        skippedTaskIds: ['missing-native-task'],
        deleted: 1,
        deletedTaskIds: ['native-bulk-delete'],
      },
      'deleteTasks tombstones recovered native tasks and reports missing native ids as skipped',
    );
    assertIncludes(
      dismissedNativeTaskIds,
      'native-bulk-delete',
      'deleteTasks records recovered native task ids in the dismissed native task tombstone list',
    );
    assertDeepEqual(
      nativeBulkCancelResult,
      {
        requested: 3,
        succeeded: 1,
        skipped: 1,
        taskIds: ['native-bulk-cancel'],
        skippedTaskIds: ['native-bulk-delete'],
        canceled: 1,
        canceledTaskIds: ['native-bulk-cancel'],
      },
      'cancelTasks only cancels active selected native tasks and deduplicates repeated ids',
    );
    assertDeepEqual(
      nativeBulkRetryResult,
      {
        requested: 3,
        succeeded: 1,
        skipped: 1,
        taskIds: ['native-bulk-retry'],
        skippedTaskIds: ['native-bulk-cancel'],
        retried: 1,
        retriedTaskIds: ['native-bulk-retry'],
        retryTaskIds: ['native-bulk-retry-retry'],
      },
      'retryTasks only retries failed selected native tasks and returns queued retry task ids',
    );
    assertDeepEqual(
      bulkNativeTaskCommands
        .filter((entry) => entry.command === 'autocut_cancel_native_task')
        .map((entry) => entry.args.request.taskUuid),
      ['native-bulk-cancel'],
      'cancelTasks forwards one native cancel command for each eligible task in request order',
    );
    assertDeepEqual(
      bulkNativeTaskCommands
        .filter((entry) => entry.command === 'autocut_retry_native_task')
        .map((entry) => entry.args.request.taskUuid),
      ['native-bulk-retry'],
      'retryTasks forwards one native retry command for each eligible failed task in request order',
    );
    assertDeepEqual(
      bulkNativeTaskDeleteEvents.details.map((detail) => detail.id),
      ['native-bulk-delete'],
      'deleteTasks dispatches taskDeleted for recovered native task tombstones',
    );
    assertRule(
      bulkNativeTaskUpdateEvents.details.some((detail) => detail.id === 'native-bulk-cancel') &&
        bulkNativeTaskUpdateEvents.details.some((detail) => detail.id === 'native-bulk-retry-retry'),
      'cancelTasks and retryTasks dispatch taskUpdated events for successful native operations',
    );
    services.resetAutoCutNativeHostClient();

    resetStorage();
    const emptyAssets = await services.getAssets();
    const emptyStorageInfo = await services.getStorageInfo();
    assertEqual(emptyAssets.length, 0, 'getAssets does not seed asset center data from mock/default assets');
    assertEqual(emptyStorageInfo.used, 0, 'getStorageInfo reports zero used bytes for a clean workspace');

    resetStorage();
    const assetAddedEvents = captureEvents(services, 'assetAdded');
    const assetDeletedEvents = captureEvents(services, 'assetDeleted');
    const storageBeforeAssetMutation = await services.getStorageInfo();
    const { importedAsset, folder } = await withImmediateTimers(async () => {
      const createdAsset = await services.importAssetFile(new File(['video'], 'clip.mp4', { type: 'video/mp4' }));
      const createdFolder = await services.createAssetFolder('Contract Folder');
      await services.deleteAsset(createdAsset.id);
      return {
        importedAsset: createdAsset,
        folder: createdFolder,
      };
    });
    const storageAfterAssetMutation = await services.getStorageInfo();
    assetAddedEvents.stop();
    assetDeletedEvents.stop();
    const storedAssets = readScopedStoredArray(services, 'assets');
    const expectedInitialAssetUsage = (await services.getAssets()).reduce((total, asset) => total + asset.size, 0);
    const expectedStoredAssetUsage = storedAssets.reduce((total, asset) => total + asset.size, 0);
    assertEqual(storageBeforeAssetMutation.used, expectedInitialAssetUsage, 'getStorageInfo derives initial used bytes from persisted assets');
    assertEqual(storageAfterAssetMutation.used, expectedStoredAssetUsage, 'getStorageInfo reflects asset import, folder creation, and deletion');
    assertEqual(importedAsset.type, 'video', 'importAssetFile infers video assets from the File MIME type');
    assertRule(importedAsset.url?.startsWith('blob:autocut-contract-'), 'importAssetFile creates a preview object URL');
    assertEqual(folder.type, 'folder', 'createAssetFolder persists a folder asset type');
    assertIncludes(
      assetAddedEvents.details.map((asset) => asset.id),
      importedAsset.id,
      'importAssetFile dispatches assetAdded',
    );
    assertIncludes(
      assetAddedEvents.details.map((asset) => asset.id),
      folder.id,
      'createAssetFolder dispatches assetAdded',
    );
    assertEqual(assetDeletedEvents.details[0]?.id, importedAsset.id, 'deleteAsset dispatches assetDeleted');
    assertIncludes(revokedObjectUrls, importedAsset.url, 'deleteAsset revokes imported asset object URLs');
    assertRule(
      storedAssets.some((asset) => asset.id === folder.id) && storedAssets.every((asset) => asset.id !== importedAsset.id),
      'asset mutations are persisted after import, folder creation, and delete',
    );

    resetStorage();
    const emptyMessages = await services.getMessages();
    assertEqual(emptyMessages.length, 0, 'getMessages does not seed message center data from mock/default messages');

    resetStorage();
    const messageAddedEvents = captureEvents(services, 'messageAdded');
    const messagesUpdatedEvents = captureEvents(services, 'messagesUpdated');
    const message = {
      id: 'contract-message',
      type: 'info',
      title: 'Contract Message',
      description: 'Service behavior contract',
      createdAt: '2026-05-05T00:00:00.000Z',
      read: false,
    };
    await withImmediateTimers(async () => {
      await services.addMessage(message);
      await services.updateMessageRead(message.id, true);
      await services.markAllMessagesRead();
      await services.clearReadMessages();
    });
    messageAddedEvents.stop();
    messagesUpdatedEvents.stop();
    const storedMessages = readScopedStoredArray(services, 'messages');
    assertEqual(messageAddedEvents.details[0]?.id, message.id, 'addMessage dispatches messageAdded');
    assertRule(messagesUpdatedEvents.details.length >= 3, 'message read workflows dispatch messagesUpdated');
    assertRule(storedMessages.every((storedMessage) => storedMessage.id !== message.id), 'clearReadMessages removes read messages from storage');

    resetStorage();
    let settingsNativeLlmSecretValue;
    const settingsNativeSecretCommands = [];
    const createSettingsNativeHostClient = () => services.createAutoCutNativeHostClient(async (command, args) => {
      settingsNativeSecretCommands.push({ command, args });
      if (command === 'autocut_host_capabilities') {
        return {
          contractVersion: 'settings-secret-contract-test',
          hostKind: 'native-host',
          databaseContractReady: true,
          sqliteMigrationReady: true,
          databaseHealthCommandReady: true,
          ffmpegProbeCommandReady: true,
          mediaImportCommandReady: true,
          mediaFileDescribeCommandReady: true,
          localVideoFileSelectCommandReady: true,
          localDirectorySelectCommandReady: true,
          audioExtractionCommandReady: true,
          audioExtractionFromAssetReady: true,
          videoGifCommandReady: true,
          videoCompressCommandReady: true,
          videoConvertCommandReady: true,
          videoEnhanceCommandReady: true,
          speechTranscriptionCommandReady: true,
          speechTranscriptionToolchainReady: true,
          speechTranscriptionProbeCommandReady: true,
          speechTranscriptionFileSelectCommandReady: true,
          llmHttpCommandReady: true,
          llmSecretStoreReady: true,
          nativeTaskQueryCommandReady: true,
          nativeTaskCancelCommandReady: true,
          nativeTaskRecoveryCommandReady: true,
          nativeTaskRetryCommandReady: true,
          nativeTaskProgressEventsReady: true,
          nativeWorkerLeaseReady: true,
          ffmpegToolchainManifestReady: true,
          ffmpegToolchainResolverReady: true,
          ffmpegBundledReady: false,
          ffmpegExecutionReady: false,
          supportedCommands: [
            'autocut_save_llm_secret',
            'autocut_get_llm_secret',
            'autocut_delete_llm_secret',
            'autocut_probe_speech_transcription',
          ],
        };
      }
      if (command === 'autocut_save_llm_secret') {
        settingsNativeLlmSecretValue = args.request.secretValue;
        return {
          secretName: args.request.secretName,
          saved: true,
        };
      }
      if (command === 'autocut_get_llm_secret') {
        return {
          secretName: args.request.secretName,
          configured: Boolean(settingsNativeLlmSecretValue),
          ...(settingsNativeLlmSecretValue ? { secretValue: settingsNativeLlmSecretValue } : {}),
        };
      }
      if (command === 'autocut_delete_llm_secret') {
        const deleted = Boolean(settingsNativeLlmSecretValue);
        settingsNativeLlmSecretValue = undefined;
        return {
          secretName: args.request.secretName,
          deleted,
        };
      }
      if (command === 'autocut_probe_speech_transcription') {
        return {
          ready: Boolean(args.request.executablePath && args.request.modelPath),
          executablePath: args.request.executablePath,
          modelPath: args.request.modelPath,
          sourceKind: 'settings',
          diagnostics: [],
          versionLine: 'whisper.cpp contract',
        };
      }

      throw new Error(`Unexpected settings native host command: ${command}`);
    });
    services.configureAutoCutNativeHostClient(createSettingsNativeHostClient());
    const settingsEvents = captureEvents(services, 'settingsUpdated');
    const defaultSettings = await services.getAutoCutSettings();
    assertEqual(defaultSettings.llm.modelVendor, 'deepseek', 'AutoCut LLM settings default to DeepSeek');
    assertEqual(defaultSettings.llm.baseUrl, 'https://api.deepseek.com', 'AutoCut LLM settings default to DeepSeek OpenAI-compatible base URL');
    assertEqual(defaultSettings.llm.model, 'deepseek-v4-flash', 'AutoCut LLM settings default to the DeepSeek chat model');
    assertEqual(defaultSettings.llm.maxTokens, 8192, 'AutoCut LLM settings default to the DeepSeek V4 Flash recommended output budget');
    assertEqual(defaultSettings.workspace.language, 'zh-CN', 'AutoCut workspace language defaults to the canonical zh-CN application locale');
    assertEqual(services.normalizeAutoCutLocale('zh'), 'zh-CN', 'AutoCut i18n normalizes legacy zh locale aliases to zh-CN');
    assertEqual(services.normalizeAutoCutLocale('en'), 'en-US', 'AutoCut i18n normalizes legacy en locale aliases to en-US');
    assertEqual(defaultSettings.speechTranscription.executablePath, '', 'AutoCut local speech-to-text executable path defaults to empty');
    assertEqual(defaultSettings.speechTranscription.modelPath, '', 'AutoCut local speech-to-text model path defaults to empty');
    assertEqual(defaultSettings.speechTranscription.language, 'auto', 'AutoCut local speech-to-text language defaults to auto');
    assertEqual(defaultSettings.speechTranscription.configured, false, 'AutoCut local speech-to-text defaults to not configured');
    assertEqual(
      defaultSettings.speechTranscription.providerId,
      'local-whisper-cli',
      'AutoCut speech-to-text provider defaults to the stable local Whisper CLI provider id',
    );
    assertRule(
      Array.isArray(types.AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER_DEFINITIONS),
      'AutoCut speech-to-text provider definitions are exposed as a canonical registry',
    );
    assertRule(
      types.AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER_DEFINITIONS?.some((provider) => provider.id === 'local-whisper-cli' && provider.kind === 'local'),
      'AutoCut speech-to-text provider registry includes local Whisper CLI as a local plugin provider',
    );
    const localSpeechProviderIds = types.AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER_DEFINITIONS
      ?.filter((provider) => provider.kind === 'local')
      .map((provider) => provider.id) ?? [];
    assertDeepEqual(
      localSpeechProviderIds,
      ['local-whisper-cli'],
      'AutoCut exposes only local speech-to-text providers that the native runtime can execute end-to-end',
    );
    assertRule(
      types.AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER_DEFINITIONS?.some((provider) => provider.id === 'openai-transcription' && provider.kind === 'api'),
      'AutoCut speech-to-text provider registry includes OpenAI transcription as an API plugin provider',
    );
    assertRule(
      Array.isArray(types.AUTOCUT_LOCAL_SPEECH_TRANSCRIPTION_MODEL_PRESETS),
      'AutoCut exposes a canonical local speech-to-text model acquisition preset registry',
    );
    assertRule(
      !('AUTOCUT_LOCAL_SPEECH_TRANSCRIPTION_EXECUTABLE_PRESETS' in types) &&
        !('AUTOCUT_DEFAULT_LOCAL_SPEECH_TRANSCRIPTION_EXECUTABLE_PRESET_ID' in types),
      'AutoCut does not expose a runtime whisper-cli executable download preset registry because whisper-cli is packaged as an installer sidecar',
    );
    assertRule(
      Array.isArray(types.AUTOCUT_LOCAL_SPEECH_TRANSCRIPTION_EXECUTABLE_PLATFORMS) &&
        ['windows-x86_64', 'linux-x86_64', 'macos-x86_64', 'macos-aarch64'].every((platform) =>
          types.AUTOCUT_LOCAL_SPEECH_TRANSCRIPTION_EXECUTABLE_PLATFORMS.includes(platform),
        ),
      'AutoCut keeps the canonical packaged whisper-cli sidecar platform keys for Windows, Ubuntu/Linux, and both macOS architectures',
    );
    const whisperCppLargeTurboPreset = types.AUTOCUT_LOCAL_SPEECH_TRANSCRIPTION_MODEL_PRESETS?.find(
      (preset) => preset.id === 'whisper-cpp-large-v3-turbo-q5',
    );
    assertEqual(
      types.AUTOCUT_DEFAULT_LOCAL_SPEECH_TRANSCRIPTION_MODEL_PRESET_ID,
      'whisper-cpp-large-v3-turbo-q5',
      'AutoCut speech-to-text defaults to the recommended offline Whisper large-v3-turbo Q5 model preset',
    );
    assertEqual(
      whisperCppLargeTurboPreset?.providerId,
      'local-whisper-cli',
      'local speech model preset registry targets the default local Whisper CLI provider',
    );
    assertEqual(
      whisperCppLargeTurboPreset?.recommended,
      true,
      'local speech model preset registry marks one balanced local Whisper model as recommended',
    );
    assertRule(
      whisperCppLargeTurboPreset?.url?.startsWith('https://huggingface.co/'),
      'local speech model preset registry uses official HTTPS model acquisition URLs',
    );
    assertRule(
      whisperCppLargeTurboPreset?.mirrorUrls?.some((url) => url.startsWith('https://hf-mirror.com/')),
      'local speech model preset registry includes a vetted Hugging Face mirror URL for resilient model downloads',
    );
    assertRule(
      /^[a-f0-9]{64}$/u.test(whisperCppLargeTurboPreset?.sha256 ?? ''),
      'local speech model preset registry pins a SHA-256 model digest before native download is allowed',
    );
    assertEqual(
      whisperCppLargeTurboPreset?.fileName.endsWith('.bin') || whisperCppLargeTurboPreset?.fileName.endsWith('.gguf'),
      true,
      'local speech model preset registry only advertises model files compatible with the accepted local extensions',
    );
    assertEqual(
      whisperCppLargeTurboPreset?.sizeLabel,
      '547 MiB',
      'local speech model preset registry shows the official whisper.cpp disk size for the default large-v3-turbo Q5 model',
    );
    const localProviderPresetCounts = Object.fromEntries(localSpeechProviderIds.map((providerId) => [
      providerId,
      types.AUTOCUT_LOCAL_SPEECH_TRANSCRIPTION_MODEL_PRESETS?.filter((preset) => preset.providerId === providerId).length ?? 0,
    ]));
    assertRule(
      Object.values(localProviderPresetCounts).every((count) => count > 0),
      `local speech model preset registry covers every executable local provider (got ${JSON.stringify(localProviderPresetCounts)})`,
    );
    const localSpeechModelPresets = services.getAutoCutLocalSpeechTranscriptionModelPresets('local-whisper-cli');
    assertDeepEqual(
      localSpeechModelPresets.map((preset) => preset.id),
      types.AUTOCUT_LOCAL_SPEECH_TRANSCRIPTION_MODEL_PRESETS
        ?.filter((preset) => preset.providerId === 'local-whisper-cli')
        .map((preset) => preset.id),
      'speech-transcription.service.ts exposes validated local STT model presets through the service boundary',
    );
    assertEqual(
      localSpeechModelPresets[0]?.recommended,
      true,
      'getAutoCutLocalSpeechTranscriptionModelPresets keeps the recommended local STT model first for guided setup',
    );
    assertEqual(
      localSpeechModelPresets.every((preset) => preset.providerId === 'local-whisper-cli'),
      true,
      'getAutoCutLocalSpeechTranscriptionModelPresets only returns presets for the requested local provider',
    );
    const resolvedLocalSpeechModelPreset = services.resolveAutoCutLocalSpeechTranscriptionModelPreset('whisper-cpp-large-v3-turbo-q5');
    assertEqual(
      resolvedLocalSpeechModelPreset.fileName,
      'ggml-large-v3-turbo-q5_0.bin',
      'resolveAutoCutLocalSpeechTranscriptionModelPreset returns the vetted download file name',
    );
    assertEqual(
      resolvedLocalSpeechModelPreset.url.endsWith('/ggml-large-v3-turbo-q5_0.bin'),
      true,
      'resolveAutoCutLocalSpeechTranscriptionModelPreset keeps the vetted URL aligned with fileName',
    );
    const resolvedLocalSpeechModelMirrorUrl = resolvedLocalSpeechModelPreset.mirrorUrls?.[0];
    assertRule(
      resolvedLocalSpeechModelMirrorUrl?.endsWith('/ggml-large-v3-turbo-q5_0.bin'),
      'resolveAutoCutLocalSpeechTranscriptionModelPreset keeps vetted mirror URLs aligned with fileName',
    );
    assertEqual(
      services.resolveAutoCutRecommendedLocalSpeechTranscriptionModelPreset('local-whisper-cli')?.id,
      'whisper-cpp-large-v3-turbo-q5',
      'resolveAutoCutRecommendedLocalSpeechTranscriptionModelPreset returns the guided offline Whisper default for local STT',
    );
    browserDownloadRequests.length = 0;
    services.downloadAutoCutLocalSpeechTranscriptionModelPreset('whisper-cpp-large-v3-turbo-q5');
    assertDeepEqual(
      browserDownloadRequests.at(-1),
      {
        href: resolvedLocalSpeechModelPreset.url,
        download: resolvedLocalSpeechModelPreset.fileName,
      },
      'downloadAutoCutLocalSpeechTranscriptionModelPreset downloads only the vetted preset URL with the vetted fileName',
    );
    clipboardWrites.length = 0;
    await services.copyAutoCutLocalSpeechTranscriptionModelPresetUrl('whisper-cpp-large-v3-turbo-q5');
    assertEqual(
      clipboardWrites.at(-1),
      [resolvedLocalSpeechModelPreset.url, ...(resolvedLocalSpeechModelPreset.mirrorUrls ?? [])].join('\n'),
      'copyAutoCutLocalSpeechTranscriptionModelPresetUrl copies only vetted model acquisition URLs and never writes modelPath',
    );
    const invalidLocalSpeechModelProgressEvents = captureEvents(services, 'speechTranscriptionModelDownloadProgress');
    await assertRejects(
      () => services.dispatchAutoCutSpeechTranscriptionModelDownloadProgress({
        providerId: 'local-whisper-cli',
        presetId: 'whisper-cpp-large-v3-turbo-q5',
        fileName: 'ggml-large-v3-turbo-q5_0.bin',
        phase: 'corrupted-native-phase',
        downloadedBytes: 1,
      }),
      'unsupported local speech-to-text model download phase',
      'dispatchAutoCutSpeechTranscriptionModelDownloadProgress rejects unsupported native download phases before publishing events',
    );
    await assertRejects(
      () => services.dispatchAutoCutSpeechTranscriptionModelDownloadProgress({
        providerId: 'local-whisper-cli',
        presetId: 'unregistered-local-speech-model',
        fileName: 'ggml-large-v3-turbo-q5_0.bin',
        phase: 'started',
        downloadedBytes: 0,
        sourceUrl: resolvedLocalSpeechModelPreset.url,
      }),
      'local speech-to-text model preset is not registered',
      'dispatchAutoCutSpeechTranscriptionModelDownloadProgress rejects unregistered native model preset ids before publishing events',
    );
    await assertRejects(
      () => services.dispatchAutoCutSpeechTranscriptionModelDownloadProgress({
        providerId: 'openai-transcription',
        presetId: 'whisper-cpp-large-v3-turbo-q5',
        fileName: 'ggml-large-v3-turbo-q5_0.bin',
        phase: 'downloading',
        downloadedBytes: 1024,
        totalBytes: 4096,
        sourceUrl: resolvedLocalSpeechModelPreset.url,
      }),
      'model download progress did not match the registered local speech-to-text model preset',
      'dispatchAutoCutSpeechTranscriptionModelDownloadProgress rejects native provider ids that do not match the registered local preset before publishing events',
    );
    await assertRejects(
      () => services.dispatchAutoCutSpeechTranscriptionModelDownloadProgress({
        providerId: 'local-whisper-cli',
        presetId: 'whisper-cpp-large-v3-turbo-q5',
        fileName: 'ggml-medium.bin',
        phase: 'completed',
        downloadedBytes: 573571072,
        totalBytes: 573571072,
        modelPath: 'D:/autocut/media/models/speech/ggml-medium.bin',
        sourceUrl: resolvedLocalSpeechModelPreset.url,
      }),
      'model download progress did not match the registered local speech-to-text model preset',
      'dispatchAutoCutSpeechTranscriptionModelDownloadProgress rejects native file names that do not match the registered local preset before publishing events',
    );
    await assertRejects(
      () => services.dispatchAutoCutSpeechTranscriptionModelDownloadProgress({
        providerId: 'local-whisper-cli',
        presetId: 'whisper-cpp-large-v3-turbo-q5',
        fileName: 'ggml-large-v3-turbo-q5_0.bin',
        phase: 'started',
        downloadedBytes: 0,
        sourceUrl: 'https://example.com/ggml-large-v3-turbo-q5_0.bin',
      }),
      'model download progress did not match the registered local speech-to-text model preset',
      'dispatchAutoCutSpeechTranscriptionModelDownloadProgress rejects native source URLs that do not match the registered local preset before publishing events',
    );
    services.dispatchAutoCutSpeechTranscriptionModelDownloadProgress({
      providerId: 'local-whisper-cli',
      presetId: 'whisper-cpp-large-v3-turbo-q5',
      fileName: 'ggml-large-v3-turbo-q5_0.bin',
      phase: 'downloading',
      downloadedBytes: 1024,
      totalBytes: 4096,
      sourceUrl: resolvedLocalSpeechModelMirrorUrl,
    });
    assertEqual(
      invalidLocalSpeechModelProgressEvents.details.at(-1)?.sourceUrl,
      resolvedLocalSpeechModelMirrorUrl,
      'dispatchAutoCutSpeechTranscriptionModelDownloadProgress accepts vetted mirror source URLs and preserves the actual download source',
    );
    invalidLocalSpeechModelProgressEvents.stop();
    assertEqual(
      invalidLocalSpeechModelProgressEvents.details.length,
      1,
      'dispatchAutoCutSpeechTranscriptionModelDownloadProgress publishes only valid primary or vetted mirror download progress events',
    );
    await services.saveAutoCutWorkspaceSettings({
      ...defaultSettings.workspace,
      outputDirectory: 'D:/autocut/media',
    });
    await services.saveAutoCutSpeechTranscriptionSettings({
      ...defaultSettings.speechTranscription,
      executablePath: 'D:/tools/whisper-cli.exe',
      modelPath: 'D:/models/old-local-whisper.bin',
      lastTestedAt: '2026-05-08T00:00:00.000Z',
      lastProbeReady: true,
      lastProbeDiagnostics: ['stale probe must be cleared after model auto setup'],
    });
    const nativeSpeechModelDownloadRequests = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        speechTranscriptionModelDownloadCommandReady: true,
      }),
      downloadSpeechTranscriptionModel: async (request) => {
        nativeSpeechModelDownloadRequests.push(request);
        return {
          providerId: request.providerId,
          presetId: request.presetId,
          fileName: request.fileName,
          modelPath: 'D:/autocut/media/models/speech/ggml-large-v3-turbo-q5_0.bin',
          byteSize: 573571072,
          downloaded: true,
          sourceUrl: request.url,
          sha256: request.sha256,
        };
      },
    });
    browserDownloadRequests.length = 0;
    const configuredLocalSpeechModel = await services.setupAutoCutLocalSpeechTranscriptionModelPreset();
    assertDeepEqual(
      nativeSpeechModelDownloadRequests[0],
      {
        providerId: 'local-whisper-cli',
        presetId: 'whisper-cpp-large-v3-turbo-q5',
        fileName: 'ggml-large-v3-turbo-q5_0.bin',
        url: resolvedLocalSpeechModelPreset.url,
        mirrorUrls: resolvedLocalSpeechModelPreset.mirrorUrls,
        sha256: resolvedLocalSpeechModelPreset.sha256,
        outputRootDir: 'D:/autocut/media',
      },
      'setupAutoCutLocalSpeechTranscriptionModelPreset asks native host to download only the vetted recommended local STT preset and mirror sources into the configured output root',
    );
    assertEqual(
      browserDownloadRequests.length,
      0,
      'setupAutoCutLocalSpeechTranscriptionModelPreset does not use browser download when native model download is available',
    );
    assertEqual(
      configuredLocalSpeechModel.preset.id,
      'whisper-cpp-large-v3-turbo-q5',
      'setupAutoCutLocalSpeechTranscriptionModelPreset returns the configured local STT model preset',
    );
    assertEqual(
      configuredLocalSpeechModel.modelPath,
      'D:/autocut/media/models/speech/ggml-large-v3-turbo-q5_0.bin',
      'setupAutoCutLocalSpeechTranscriptionModelPreset returns the native installed model path',
    );
    assertEqual(
      configuredLocalSpeechModel.settings.speechTranscription.modelPath,
      'D:/autocut/media/models/speech/ggml-large-v3-turbo-q5_0.bin',
      'setupAutoCutLocalSpeechTranscriptionModelPreset persists the native installed model path for local STT',
    );
    assertEqual(
      configuredLocalSpeechModel.settings.speechTranscription.executablePath,
      'D:/tools/whisper-cli.exe',
      'setupAutoCutLocalSpeechTranscriptionModelPreset preserves the selected local STT executable path while replacing only the model',
    );
    assertEqual(
      configuredLocalSpeechModel.settings.speechTranscription.lastProbeReady,
      undefined,
      'setupAutoCutLocalSpeechTranscriptionModelPreset clears stale local STT probe readiness after changing modelPath',
    );
    assertEqual(
      configuredLocalSpeechModel.settings.speechTranscription.lastProbeDiagnostics,
      undefined,
      'setupAutoCutLocalSpeechTranscriptionModelPreset clears stale local STT probe diagnostics after changing modelPath',
    );
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        speechTranscriptionModelDownloadCommandReady: true,
      }),
      downloadSpeechTranscriptionModel: async (request) => ({
        providerId: request.providerId,
        presetId: request.presetId,
        fileName: request.fileName,
        modelPath: 'D:/autocut/media/models/speech/ggml-large-v3-turbo-q5_0.bin',
        byteSize: 1024,
        downloaded: true,
        sourceUrl: request.url,
        sha256: request.sha256,
      }),
    });
    await assertRejects(
      () => services.setupAutoCutLocalSpeechTranscriptionModelPreset('whisper-cpp-large-v3-turbo-q5'),
      'speech recognition model download did not finish',
      'setupAutoCutLocalSpeechTranscriptionModelPreset rejects incomplete native model downloads before saving modelPath',
    );
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        speechTranscriptionModelDownloadCommandReady: false,
      }),
    });
    await services.saveAutoCutSpeechTranscriptionSettings({
      ...configuredLocalSpeechModel.settings.speechTranscription,
      modelPath: '',
    });
    browserDownloadRequests.length = 0;
    const fallbackLocalSpeechModel = await services.setupAutoCutLocalSpeechTranscriptionModelPreset('whisper-cpp-large-v3-turbo-q5');
    assertDeepEqual(
      browserDownloadRequests.at(-1),
      {
        href: resolvedLocalSpeechModelPreset.url,
        download: resolvedLocalSpeechModelPreset.fileName,
      },
      'setupAutoCutLocalSpeechTranscriptionModelPreset falls back to the vetted browser download when native model download is unavailable',
    );
    assertEqual(
      fallbackLocalSpeechModel.settings.speechTranscription.modelPath,
      '',
      'setupAutoCutLocalSpeechTranscriptionModelPreset fallback never writes a remote URL or unverified browser download location into modelPath',
    );
    await services.saveAutoCutSpeechTranscriptionSettings({
      ...fallbackLocalSpeechModel.settings.speechTranscription,
      executablePath: '',
      modelPath: '',
      language: 'auto',
    });
    const localSpeechSetupCommands = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        speechTranscriptionCommandReady: true,
        speechTranscriptionToolchainReady: false,
        speechTranscriptionProbeCommandReady: true,
        speechTranscriptionModelDownloadCommandReady: true,
      }),
      probeSpeechTranscription: async (request) => {
        localSpeechSetupCommands.push({ kind: 'probe', request });
        const executablePath = request.executablePath ?? 'D:/Program Files/SDKWork Video Cut/resources/binaries/windows-x86_64/whisper-cli.exe';
        return {
          ready: Boolean(executablePath && request.modelPath),
          executableReady: Boolean(executablePath),
          modelReady: Boolean(request.modelPath),
          executablePath,
          modelPath: request.modelPath ?? '',
          sourceKind: request.executablePath ? 'execution-preflight' : 'bundled-sidecar',
          diagnostics: request.modelPath ? [] : ['AutoCut local speech transcription modelPath is not configured.'],
          defaultExecutableDirectory: 'D:/Program Files/SDKWork Video Cut/resources/binaries/windows-x86_64',
          defaultExecutablePath: 'D:/Program Files/SDKWork Video Cut/resources/binaries/windows-x86_64/whisper-cli.exe',
          defaultModelDirectory: 'D:/autocut/media/models/speech',
          defaultModelPath: 'D:/autocut/media/models/speech/ggml-large-v3-turbo-q5_0.bin',
          executableStrategy: 'Settings executablePath > SDKWORK_AUTOCUT_WHISPER_EXECUTABLE > verified bundled sidecar > PATH/common local whisper-cli',
          ...(request.modelPath ? { versionLine: 'setup status bundled whisper sidecar' } : {}),
        };
      },
      downloadSpeechTranscriptionModel: async (request) => {
        localSpeechSetupCommands.push({ kind: 'download-model', request });
        return {
          providerId: request.providerId,
          presetId: request.presetId,
          fileName: request.fileName,
          modelPath: 'D:/autocut/media/models/speech/ggml-large-v3-turbo-q5_0.bin',
          byteSize: 573571072,
          downloaded: true,
          sourceUrl: request.url,
          sha256: request.sha256,
        };
      },
    });
    const inspectedLocalSpeechSetup = await services.inspectAutoCutLocalSpeechTranscriptionSetup();
    assertEqual(
      inspectedLocalSpeechSetup.providerId,
      'local-whisper-cli',
      'inspectAutoCutLocalSpeechTranscriptionSetup reports the selected local STT provider',
    );
    assertDeepEqual(
      inspectedLocalSpeechSetup.localProviderIds,
      ['local-whisper-cli'],
      'inspectAutoCutLocalSpeechTranscriptionSetup checks every executable local STT provider registered in the canonical provider registry',
    );
    assertEqual(
      inspectedLocalSpeechSetup.executable.ready,
      true,
      'inspectAutoCutLocalSpeechTranscriptionSetup accepts a native-discovered packaged Whisper executable',
    );
    assertEqual(
      inspectedLocalSpeechSetup.executable.sourceKind,
      'bundled-sidecar',
      'inspectAutoCutLocalSpeechTranscriptionSetup exposes the local STT executable source for product UI',
    );
    assertEqual(
      inspectedLocalSpeechSetup.model.ready,
      false,
      'inspectAutoCutLocalSpeechTranscriptionSetup reports missing local STT model readiness separately from executable readiness',
    );
    assertEqual(
      inspectedLocalSpeechSetup.readiness,
      'needs-model',
      'inspectAutoCutLocalSpeechTranscriptionSetup recommends model initialization when the local executable exists but modelPath is missing',
    );
    assertEqual(
      inspectedLocalSpeechSetup.nextAction,
      'initialize',
      'inspectAutoCutLocalSpeechTranscriptionSetup exposes a primary initialize action for product UI',
    );
    assertEqual(
      inspectedLocalSpeechSetup.defaults.modelPath,
      'D:/autocut/media/models/speech/ggml-large-v3-turbo-q5_0.bin',
      'inspectAutoCutLocalSpeechTranscriptionSetup surfaces the native-resolved default STT model path for product UI',
    );
    assertEqual(
      inspectedLocalSpeechSetup.defaults.executablePath,
      'D:/Program Files/SDKWork Video Cut/resources/binaries/windows-x86_64/whisper-cli.exe',
      'inspectAutoCutLocalSpeechTranscriptionSetup surfaces the native-resolved default STT executable install target for product UI',
    );
    assertRule(
      inspectedLocalSpeechSetup.defaults.executableStrategy.includes('PATH/common local whisper-cli'),
      'inspectAutoCutLocalSpeechTranscriptionSetup explains automatic local whisper-cli discovery through PATH and common install directories',
    );
    const localSpeechSetupProgressEvents = captureEvents(services, 'speechTranscriptionModelDownloadProgress');
    const initializedLocalSpeechSetup = await services.initializeAutoCutLocalSpeechTranscriptionSetup();
    localSpeechSetupProgressEvents.stop();
    assertEqual(
      localSpeechSetupCommands[0]?.kind,
      'probe',
      'initializeAutoCutLocalSpeechTranscriptionSetup probes local STT executable discovery before model download',
    );
    assertEqual(
      localSpeechSetupCommands[1]?.kind,
      'download-model',
      'initializeAutoCutLocalSpeechTranscriptionSetup downloads the recommended local STT model after executable discovery succeeds',
    );
    assertEqual(
      localSpeechSetupCommands[2]?.kind,
      'probe',
      'initializeAutoCutLocalSpeechTranscriptionSetup probes the final executable plus model before reporting ready',
    );
    assertRule(
      localSpeechSetupProgressEvents.details.some((event) => event.phase === 'started'),
      'initializeAutoCutLocalSpeechTranscriptionSetup dispatches a visible local STT model download started progress event',
    );
    assertRule(
      localSpeechSetupProgressEvents.details.some((event) => event.phase === 'completed' && event.progress === 100),
      'initializeAutoCutLocalSpeechTranscriptionSetup dispatches a visible local STT model download completion progress event',
    );
    assertEqual(
      initializedLocalSpeechSetup.status.readiness,
      'ready',
      'initializeAutoCutLocalSpeechTranscriptionSetup returns ready status after local executable, model, and probe all verify',
    );
    assertEqual(
      initializedLocalSpeechSetup.settings.speechTranscription.executablePath,
      'D:/Program Files/SDKWork Video Cut/resources/binaries/windows-x86_64/whisper-cli.exe',
      'initializeAutoCutLocalSpeechTranscriptionSetup persists native-discovered packaged Whisper executablePath',
    );
    assertEqual(
      initializedLocalSpeechSetup.settings.speechTranscription.modelPath,
      'D:/autocut/media/models/speech/ggml-large-v3-turbo-q5_0.bin',
      'initializeAutoCutLocalSpeechTranscriptionSetup persists the native-installed recommended modelPath',
    );
    assertEqual(
      initializedLocalSpeechSetup.settings.speechTranscription.lastProbeReady,
      true,
      'initializeAutoCutLocalSpeechTranscriptionSetup marks the local STT provider tested only after a fresh successful probe',
    );
    await services.saveAutoCutSpeechTranscriptionSettings({
      ...initializedLocalSpeechSetup.settings.speechTranscription,
      modelPath: '',
    });
    const staleReadyCacheCommandCount = localSpeechSetupCommands.length;
    const repairedAfterClearedModelPath = await services.initializeAutoCutLocalSpeechTranscriptionSetup();
    assertEqual(
      localSpeechSetupCommands[staleReadyCacheCommandCount]?.kind,
      'probe',
      'initializeAutoCutLocalSpeechTranscriptionSetup does not reuse stale ready setup cache after modelPath is cleared',
    );
    assertEqual(
      localSpeechSetupCommands[staleReadyCacheCommandCount + 1]?.kind,
      'download-model',
      'initializeAutoCutLocalSpeechTranscriptionSetup reinitializes the recommended local STT model after modelPath is cleared',
    );
    assertEqual(
      repairedAfterClearedModelPath.settings.speechTranscription.modelPath,
      'D:/autocut/media/models/speech/ggml-large-v3-turbo-q5_0.bin',
      'initializeAutoCutLocalSpeechTranscriptionSetup restores modelPath instead of reporting stale ready status',
    );
    await services.saveAutoCutSpeechTranscriptionSettings({
      ...repairedAfterClearedModelPath.settings.speechTranscription,
      executablePath: '',
      modelPath: '',
      language: 'auto',
    });
    const blockedExecutableSetupCommands = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        speechTranscriptionCommandReady: true,
        speechTranscriptionToolchainReady: false,
        speechTranscriptionProbeCommandReady: true,
        speechTranscriptionModelDownloadCommandReady: true,
        speechTranscriptionExecutableDownloadCommandReady: true,
      }),
      probeSpeechTranscription: async (request) => {
        blockedExecutableSetupCommands.push({ kind: 'probe', request });
        const installedExecutablePath = request.executablePath ?? '';
        const installedModelPath = request.modelPath ?? '';
        return {
          ready: Boolean(installedExecutablePath && installedModelPath),
          executableReady: Boolean(installedExecutablePath),
          modelReady: Boolean(installedModelPath),
          executablePath: installedExecutablePath,
          modelPath: installedModelPath,
          sourceKind: installedExecutablePath ? 'bundled-sidecar' : 'missing',
          diagnostics: installedExecutablePath
            ? (installedModelPath ? [] : ['AutoCut local speech transcription modelPath is not configured.'])
            : ['AutoCut local speech transcription executablePath is not configured; AutoCut checked Settings, SDKWORK_AUTOCUT_WHISPER_EXECUTABLE, verified bundled sidecar, PATH, and common local installation directories.'],
          defaultExecutableDirectory: 'D:/Program Files/SDKWork Video Cut/resources/binaries/windows-x86_64',
          defaultExecutablePath: 'D:/Program Files/SDKWork Video Cut/resources/binaries/windows-x86_64/whisper-cli.exe',
          defaultModelDirectory: 'D:/autocut/media/models/speech',
          defaultModelPath: 'D:/autocut/media/models/speech/ggml-large-v3-turbo-q5_0.bin',
          executableStrategy: 'Settings executablePath > SDKWORK_AUTOCUT_WHISPER_EXECUTABLE > verified bundled sidecar > PATH/Homebrew/apt/common local whisper-cli',
          ...(installedExecutablePath && installedModelPath ? { versionLine: 'whisper.cpp v1.8.4' } : {}),
        };
      },
      downloadSpeechTranscriptionExecutable: async (request) => {
        blockedExecutableSetupCommands.push({ kind: 'download-executable', request });
        throw new Error('AutoCut must not download whisper-cli at runtime.');
      },
      downloadSpeechTranscriptionModel: async (request) => {
        blockedExecutableSetupCommands.push({ kind: 'download-model', request });
        return {
          providerId: request.providerId,
          presetId: request.presetId,
          fileName: request.fileName,
          modelPath: 'D:/autocut/media/models/speech/ggml-large-v3-turbo-q5_0.bin',
          byteSize: 573571072,
          downloaded: true,
          sourceUrl: request.url,
          sha256: request.sha256,
        };
      },
    });
    const blockedExecutableModelEvents = captureEvents(services, 'speechTranscriptionModelDownloadProgress');
    await assertRejects(
      () => services.initializeAutoCutLocalSpeechTranscriptionSetup(),
      'runtime download is disabled',
      'initializeAutoCutLocalSpeechTranscriptionSetup refuses to download whisper-cli even when a legacy native host advertises executable download support',
    );
    blockedExecutableModelEvents.stop();
    assertDeepEqual(
      blockedExecutableSetupCommands.map((command) => command.kind),
      ['probe', 'download-model', 'probe', 'probe'],
      'initializeAutoCutLocalSpeechTranscriptionSetup downloads only the verified model and never downloads whisper-cli at runtime',
    );
    assertRule(
      !('speechTranscriptionExecutableDownloadProgress' in services.AUTOCUT_EVENTS),
      'initializeAutoCutLocalSpeechTranscriptionSetup has no executable download progress event because whisper-cli must be packaged as a sidecar',
    );
    assertRule(
      blockedExecutableModelEvents.details.some((event) => event.phase === 'completed' && event.progress === 100),
      'initializeAutoCutLocalSpeechTranscriptionSetup keeps model download progress visible while executable packaging is still blocking readiness',
    );
    assertEqual(
      blockedExecutableSetupCommands.some((command) => command.kind === 'download-executable'),
      false,
      'initializeAutoCutLocalSpeechTranscriptionSetup never calls the native executable download command',
    );
    await services.saveAutoCutSpeechTranscriptionSettings({
      ...(await services.getAutoCutSettings()).speechTranscription,
      executablePath: '',
      modelPath: '',
      language: 'auto',
    });
    const staleMissingExecutableSetupCommands = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        speechTranscriptionCommandReady: true,
        speechTranscriptionToolchainReady: false,
        speechTranscriptionProbeCommandReady: true,
        speechTranscriptionModelDownloadCommandReady: true,
        speechTranscriptionExecutableDownloadCommandReady: false,
      }),
      probeSpeechTranscription: async (request) => {
        staleMissingExecutableSetupCommands.push({ kind: 'stale-probe', request });
        return {
          ready: false,
          executableReady: false,
          modelReady: Boolean(request.modelPath),
          executablePath: '',
          modelPath: request.modelPath ?? '',
          sourceKind: 'missing',
          diagnostics: ['AutoCut local speech transcription executablePath is not configured; AutoCut checked Settings, SDKWORK_AUTOCUT_WHISPER_EXECUTABLE, verified bundled sidecar, PATH, and common local installation directories.'],
          defaultExecutableDirectory: 'D:/Program Files/SDKWork Video Cut/resources/binaries/windows-x86_64',
          defaultExecutablePath: 'D:/Program Files/SDKWork Video Cut/resources/binaries/windows-x86_64/whisper-cli.exe',
          defaultModelDirectory: 'D:/autocut/media/models/speech',
          defaultModelPath: 'D:/autocut/media/models/speech/ggml-large-v3-turbo-q5_0.bin',
          executableStrategy: 'Settings executablePath > SDKWORK_AUTOCUT_WHISPER_EXECUTABLE > verified bundled sidecar > PATH/Homebrew/apt/common local whisper-cli',
        };
      },
    });
    const staleMissingExecutableStatus = await services.inspectAutoCutLocalSpeechTranscriptionSetup();
    assertEqual(
      staleMissingExecutableStatus.capabilities.executableDownloadReady,
      false,
      'inspectAutoCutLocalSpeechTranscriptionSetup reports executable runtime download as disabled even when whisper-cli is missing',
    );
    const discoveredSidecarSetupCommands = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        speechTranscriptionCommandReady: true,
        speechTranscriptionToolchainReady: true,
        speechTranscriptionProbeCommandReady: true,
        speechTranscriptionModelDownloadCommandReady: true,
        speechTranscriptionExecutableDownloadCommandReady: false,
      }),
      probeSpeechTranscription: async (request) => {
        discoveredSidecarSetupCommands.push({ kind: 'probe', request });
        const installedExecutablePath = request.executablePath || 'D:/Program Files/SDKWork Video Cut/resources/binaries/windows-x86_64/whisper-cli.exe';
        const installedModelPath = request.modelPath ?? '';
        return {
          ready: Boolean(installedExecutablePath && installedModelPath),
          executableReady: Boolean(installedExecutablePath),
          modelReady: Boolean(installedModelPath),
          executablePath: installedExecutablePath,
          modelPath: installedModelPath,
          sourceKind: 'bundled-sidecar',
          diagnostics: installedExecutablePath
            ? (installedModelPath ? [] : ['AutoCut local speech transcription modelPath is not configured.'])
            : ['AutoCut local speech transcription executablePath is not configured; AutoCut checked Settings, SDKWORK_AUTOCUT_WHISPER_EXECUTABLE, verified bundled sidecar, PATH, and common local installation directories.'],
          defaultExecutableDirectory: 'D:/Program Files/SDKWork Video Cut/resources/binaries/windows-x86_64',
          defaultExecutablePath: 'D:/Program Files/SDKWork Video Cut/resources/binaries/windows-x86_64/whisper-cli.exe',
          defaultModelDirectory: 'D:/autocut/media/models/speech',
          defaultModelPath: 'D:/autocut/media/models/speech/ggml-large-v3-turbo-q5_0.bin',
          executableStrategy: 'Settings executablePath > SDKWORK_AUTOCUT_WHISPER_EXECUTABLE > verified bundled sidecar > PATH/Homebrew/apt/common local whisper-cli',
          ...(installedExecutablePath && installedModelPath ? { versionLine: 'whisper.cpp v1.8.4' } : {}),
        };
      },
      downloadSpeechTranscriptionModel: async (request) => {
        discoveredSidecarSetupCommands.push({ kind: 'download-model', request });
        return {
          providerId: request.providerId,
          presetId: request.presetId,
          fileName: request.fileName,
          modelPath: 'D:/autocut/media/models/speech/ggml-large-v3-turbo-q5_0.bin',
          byteSize: 573571072,
          downloaded: true,
          sourceUrl: request.url,
          sha256: request.sha256,
        };
      },
    });
    const recoveredAfterStaleExecutableSetupStatus = await services.initializeAutoCutLocalSpeechTranscriptionSetup();
    assertDeepEqual(
      discoveredSidecarSetupCommands.map((command) => command.kind),
      ['probe', 'download-model', 'probe'],
      'initializeAutoCutLocalSpeechTranscriptionSetup re-inspects native capabilities instead of reusing a stale missing-executable setup cache before resolving the packaged whisper-cli sidecar',
    );
    assertEqual(
      recoveredAfterStaleExecutableSetupStatus.settings.speechTranscription.executablePath,
      'D:/Program Files/SDKWork Video Cut/resources/binaries/windows-x86_64/whisper-cli.exe',
      'initializeAutoCutLocalSpeechTranscriptionSetup persists the verified bundled sidecar executablePath after stale-cache recovery',
    );
    assertEqual(
      recoveredAfterStaleExecutableSetupStatus.status.readiness,
      'ready',
      'initializeAutoCutLocalSpeechTranscriptionSetup reports ready after recovering from a stale missing-executable setup cache with the packaged sidecar',
    );
    await services.saveAutoCutSpeechTranscriptionSettings({
      ...recoveredAfterStaleExecutableSetupStatus.settings.speechTranscription,
      executablePath: '',
      modelPath: '',
      language: 'auto',
    });
    const missingExecutableSetupCommands = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        speechTranscriptionCommandReady: true,
        speechTranscriptionToolchainReady: false,
        speechTranscriptionProbeCommandReady: true,
        speechTranscriptionModelDownloadCommandReady: true,
        speechTranscriptionExecutableDownloadCommandReady: false,
      }),
      probeSpeechTranscription: async (request) => {
        missingExecutableSetupCommands.push({ kind: 'probe', request });
        return {
          ready: false,
          executableReady: false,
          modelReady: Boolean(request.modelPath),
          executablePath: '',
          modelPath: request.modelPath ?? '',
          sourceKind: 'missing',
          diagnostics: ['AutoCut local speech transcription executablePath is not configured; AutoCut checked Settings, SDKWORK_AUTOCUT_WHISPER_EXECUTABLE, verified bundled sidecar, PATH, and common local installation directories.'],
          defaultExecutableDirectory: 'D:/Program Files/SDKWork Video Cut/resources/binaries/windows-x86_64',
          defaultExecutablePath: 'D:/Program Files/SDKWork Video Cut/resources/binaries/windows-x86_64/whisper-cli.exe',
          defaultModelDirectory: 'D:/autocut/media/models/speech',
          defaultModelPath: 'D:/autocut/media/models/speech/ggml-large-v3-turbo-q5_0.bin',
          executableStrategy: 'Settings executablePath > SDKWORK_AUTOCUT_WHISPER_EXECUTABLE > verified bundled sidecar > PATH/Homebrew/apt/common local whisper-cli',
        };
      },
      downloadSpeechTranscriptionModel: async (request) => {
        missingExecutableSetupCommands.push({ kind: 'download-model', request });
        return {
          providerId: request.providerId,
          presetId: request.presetId,
          fileName: request.fileName,
          modelPath: 'D:/autocut/media/models/speech/ggml-large-v3-turbo-q5_0.bin',
          byteSize: 573571072,
          downloaded: true,
          sourceUrl: request.url,
          sha256: request.sha256,
        };
      },
    });
    const missingExecutableSetupEvents = captureEvents(services, 'speechTranscriptionModelDownloadProgress');
    await assertRejects(
      () => services.initializeAutoCutLocalSpeechTranscriptionSetup(),
      'final availability check, not a model download failure',
      'initializeAutoCutLocalSpeechTranscriptionSetup auto-installs the default local STT model before blocking on a missing executable',
    );
    missingExecutableSetupEvents.stop();
    assertEqual(
      missingExecutableSetupCommands[0]?.kind,
      'probe',
      'initializeAutoCutLocalSpeechTranscriptionSetup probes default local STT paths before repairing a missing model',
    );
    assertEqual(
      missingExecutableSetupCommands[1]?.kind,
      'download-model',
      'initializeAutoCutLocalSpeechTranscriptionSetup downloads the recommended local STT model even when the executable must still be installed',
    );
    assertEqual(
      missingExecutableSetupCommands[2]?.kind,
      'probe',
      'initializeAutoCutLocalSpeechTranscriptionSetup re-probes after default model installation before reporting the missing executable',
    );
    assertRule(
      missingExecutableSetupEvents.details.some((event) => event.phase === 'started') &&
        missingExecutableSetupEvents.details.some((event) => event.phase === 'completed' && event.progress === 100),
      'initializeAutoCutLocalSpeechTranscriptionSetup keeps the model download visible when the executable is still missing',
    );
    assertRule(
      !missingExecutableSetupEvents.details.some((event) => event.phase === 'failed'),
      'initializeAutoCutLocalSpeechTranscriptionSetup does not report the model download as failed after the download completed and only executable readiness is blocked',
    );
    const settingsAfterMissingExecutableSetup = await services.getAutoCutSettings();
    assertEqual(
      settingsAfterMissingExecutableSetup.speechTranscription.modelPath,
      'D:/autocut/media/models/speech/ggml-large-v3-turbo-q5_0.bin',
      'initializeAutoCutLocalSpeechTranscriptionSetup persists the verified default model path even when executable initialization is still blocked',
    );
    assertEqual(
      settingsAfterMissingExecutableSetup.speechTranscription.executablePath,
      '',
      'initializeAutoCutLocalSpeechTranscriptionSetup never persists a fake executablePath for a missing whisper-cli target',
    );
    const inspectedMissingExecutableSetup = await services.inspectAutoCutLocalSpeechTranscriptionSetup();
    assertEqual(
      inspectedMissingExecutableSetup.defaults.executablePath,
      'D:/Program Files/SDKWork Video Cut/resources/binaries/windows-x86_64/whisper-cli.exe',
      'inspectAutoCutLocalSpeechTranscriptionSetup keeps showing the default bundled executable target after model auto-installation',
    );
    assertEqual(
      inspectedMissingExecutableSetup.model.ready,
      true,
      'inspectAutoCutLocalSpeechTranscriptionSetup reports the default local STT model as ready after auto-installation',
    );
    assertEqual(
      inspectedMissingExecutableSetup.executable.ready,
      false,
      'inspectAutoCutLocalSpeechTranscriptionSetup continues to fail closed until whisper-cli itself is verified',
    );
    await services.saveAutoCutSpeechTranscriptionSettings({
      ...settingsAfterMissingExecutableSetup.speechTranscription,
      executablePath: '',
      modelPath: '',
      language: 'auto',
    });
    await services.saveAutoCutWorkspaceSettings({
      ...defaultSettings.workspace,
      outputDirectory: '',
    });
    services.configureAutoCutNativeHostClient(createSettingsNativeHostClient());
    await assertRejects(
      () => services.resolveAutoCutLocalSpeechTranscriptionModelPreset({
        ...resolvedLocalSpeechModelPreset,
        providerId: 'openai-transcription',
      }),
      'target a local speech-to-text provider',
      'resolveAutoCutLocalSpeechTranscriptionModelPreset rejects presets for API providers',
    );
    await assertRejects(
      () => services.resolveAutoCutLocalSpeechTranscriptionModelPreset({
        ...resolvedLocalSpeechModelPreset,
        engine: 'faster-whisper',
      }),
      'implemented local speech-to-text engine',
      'resolveAutoCutLocalSpeechTranscriptionModelPreset rejects presets for unimplemented local engines',
    );
    await assertRejects(
      () => services.resolveAutoCutLocalSpeechTranscriptionModelPreset({
        ...resolvedLocalSpeechModelPreset,
        url: 'http://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin',
      }),
      'trusted Hugging Face source',
      'resolveAutoCutLocalSpeechTranscriptionModelPreset rejects non-HTTPS model URLs',
    );
    await assertRejects(
      () => services.resolveAutoCutLocalSpeechTranscriptionModelPreset({
        ...resolvedLocalSpeechModelPreset,
        url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/other-model.bin',
      }),
      'match fileName',
      'resolveAutoCutLocalSpeechTranscriptionModelPreset rejects mismatched URL file names',
    );
    await assertRejects(
      () => services.resolveAutoCutLocalSpeechTranscriptionModelPreset({
        ...resolvedLocalSpeechModelPreset,
        mirrorUrls: ['https://example.com/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin'],
      }),
      'trusted Hugging Face source',
      'resolveAutoCutLocalSpeechTranscriptionModelPreset rejects untrusted mirror model URLs',
    );
    await assertRejects(
      () => services.resolveAutoCutLocalSpeechTranscriptionModelPreset({
        ...resolvedLocalSpeechModelPreset,
        mirrorUrls: ['https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/other-model.bin'],
      }),
      'match fileName',
      'resolveAutoCutLocalSpeechTranscriptionModelPreset rejects mirror URLs whose file names do not match fileName',
    );
    await assertRejects(
      () => services.resolveAutoCutLocalSpeechTranscriptionModelPreset({
        ...resolvedLocalSpeechModelPreset,
        fileName: 'ggml-large-v3-turbo-q5_0.txt',
        url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.txt',
      }),
      'supported model file extension',
      'resolveAutoCutLocalSpeechTranscriptionModelPreset rejects unsupported model file extensions',
    );
    await assertRejects(
      () => services.resolveAutoCutLocalSpeechTranscriptionModelPreset({
        ...resolvedLocalSpeechModelPreset,
        sha256: 'not-a-real-digest',
      }),
      'pinned SHA-256 model digest',
      'resolveAutoCutLocalSpeechTranscriptionModelPreset rejects model presets without a pinned SHA-256 digest',
    );
    assertEqual(defaultSettings.workspace.outputDirectory, '', 'AutoCut workspace output directory defaults to empty so the desktop host uses its per-user app-data media root');
    assertEqual(await services.resolveAutoCutOutputRootDir(), undefined, 'resolveAutoCutOutputRootDir does not synthesize a hard-coded OS-specific path before the user configures one');
    const defaultSpeechRuntimeConfig = await services.resolveAutoCutSpeechTranscriptionRuntimeConfig();
    assertEqual(defaultSpeechRuntimeConfig.configured, false, 'resolveAutoCutSpeechTranscriptionRuntimeConfig fails closed before the user configures local speech-to-text');
    assertEqual(
      defaultSpeechRuntimeConfig.providerId,
      'local-whisper-cli',
      'resolveAutoCutSpeechTranscriptionRuntimeConfig resolves the default stable STT provider id',
    );
    await services.clearAutoCutLlmApiKey();
    settingsNativeLlmSecretValue = 'sk-env-default-secret';
    const envDefaultLlmSettings = await withImmediateTimers(() => services.initializeAutoCutDefaultLlmSettingsFromEnvironment());
    services.clearTransientAutoCutLlmApiKeyForTest();
    const envDefaultLlmRuntimeConfig = await withImmediateTimers(() => services.resolveAutoCutLlmRuntimeConfig());
    const envDefaultStoredSettings = readScopedStoredObject(services, 'settings');
    assertEqual(envDefaultLlmSettings?.llm.modelVendor, 'deepseek', 'environment default LLM initialization keeps DeepSeek as the default vendor');
    assertEqual(envDefaultLlmSettings?.llm.apiKeyConfigured, true, 'environment default LLM initialization marks the API key as configured');
    assertEqual(envDefaultLlmSettings?.llm.maskedApiKey, 'sk-en*************cret', 'environment default LLM initialization stores only a masked DeepSeek API key');
    assertEqual(envDefaultLlmRuntimeConfig.sessionApiKey, 'sk-env-default-secret', 'environment default LLM initialization makes the native secret available to runtime config');
    assertEqual(envDefaultStoredSettings.llm.apiKey, undefined, 'environment default LLM initialization never persists the raw API key in settings storage');
    assertRule(
      settingsNativeSecretCommands.some((entry) => entry.command === 'autocut_get_llm_secret' && entry.args?.request?.secretName === 'release-default'),
      'environment default LLM initialization reads the runtime-scoped native default secret',
    );
    settingsNativeLlmSecretValue = undefined;
    const legacyZhWorkspaceSettings = await withImmediateTimers(() => services.saveAutoCutWorkspaceSettings({
      ...defaultSettings.workspace,
      language: 'zh',
    }));
    const legacyEnWorkspaceSettings = await withImmediateTimers(() => services.saveAutoCutWorkspaceSettings({
      ...legacyZhWorkspaceSettings.workspace,
      language: 'en',
    }));
    assertEqual(legacyZhWorkspaceSettings.workspace.language, 'zh-CN', 'saveAutoCutWorkspaceSettings normalizes legacy zh to the canonical zh-CN locale');
    assertEqual(legacyEnWorkspaceSettings.workspace.language, 'en-US', 'saveAutoCutWorkspaceSettings normalizes legacy en to the canonical en-US locale');
    assertEqual(
      services.getAutoCutI18nText('settings.page.title'),
      'Settings Center',
      'saveAutoCutWorkspaceSettings switches the active i18next language when the application locale changes',
    );
    const {
      accountSettings,
      workspaceSettings,
      notificationSettings,
      llmVendorSettings,
      llmCustomModelSettings,
      llmNativeSecretSettings,
      llmNativeSecretRuntimeConfig,
      llmDeepSeekMaxSettings,
      llmDeepSeekAliasMaxSettings,
      llmOpenAiMaxSettings,
      llmGeminiMaxSettings,
      llmOpenAiMiniMaxSettings,
      llmGeminiFlashRuntimeSettings,
      llmAnthropicVendorSettings,
      llmXaiVendorSettings,
      llmQwenVendorSettings,
      llmMoonshotVendorSettings,
      llmBaiduVendorSettings,
      llmZhipuVendorSettings,
      llmMinimaxVendorSettings,
      llmHunyuanVendorSettings,
      llmDoubaoVendorSettings,
      llmAnthropicMaxSettings,
      llmXaiMaxSettings,
      llmQwenMaxSettings,
      llmMoonshotMaxSettings,
      llmBaiduMaxSettings,
      llmZhipuMaxSettings,
      llmMinimaxMaxSettings,
      llmHunyuanMaxSettings,
      llmDoubaoMaxSettings,
      llmRuntimeConfig,
      speechTranscriptionSettings,
      speechTranscriptionRuntimeConfig,
      speechTranscriptionProbe,
      speechTranscriptionSettingsAfterProbe,
      changedSpeechTranscriptionSettingsAfterProbe,
      apiKeySettings,
      revokedSettings,
      cacheClearedSettings,
      invoiceSettings,
      avatarSettings,
      subscriptionManagementSettings,
      passwordSettings,
      twoFactorSettings,
      sessionsRevokedSettings,
      subscriptionSettings,
      deletedAccountSettings,
    } = await withImmediateTimers(async () => {
      const initialSettings = await services.getAutoCutSettings();
      const savedAccountSettings = await services.saveAutoCutAccountSettings({
        ...initialSettings.account,
        displayName: 'Contract User',
      });
      const savedWorkspaceSettings = await services.saveAutoCutWorkspaceSettings({
        ...savedAccountSettings.workspace,
        hardwareAcceleration: false,
      });
      const savedNotificationSettings = await services.saveAutoCutNotificationSettings({
        ...savedWorkspaceSettings.notifications,
        usageReports: false,
      });
      const savedLlmVendorSettings = await services.saveAutoCutLlmSettings({
        ...savedNotificationSettings.llm,
        modelVendor: 'openai',
      });
      const savedLlmCustomModelSettings = await services.saveAutoCutLlmSettings({
        ...savedLlmVendorSettings.llm,
        apiKey: 'sk-contract-secret',
        model: 'gpt-4.1-mini',
      });
      const savedLlmNativeSecretSettings = await services.saveAutoCutLlmSettings({
        ...savedLlmCustomModelSettings.llm,
        apiKey: 'sk-native-stored-secret',
      });
      services.clearTransientAutoCutLlmApiKeyForTest();
      const resolvedNativeSecretRuntimeConfig = await services.resolveAutoCutLlmRuntimeConfig();
      const savedLlmDeepSeekMaxSettings = await services.saveAutoCutLlmSettings({
        ...savedLlmCustomModelSettings.llm,
        modelVendor: 'deepseek',
        model: 'deepseek-v4-flash',
        maxTokens: 999999,
      });
      const savedLlmDeepSeekAliasMaxSettings = await services.saveAutoCutLlmSettings({
        ...savedLlmDeepSeekMaxSettings.llm,
        modelVendor: 'deepseek',
        model: 'deepseek-chat',
        maxTokens: 999999,
      });
      const savedLlmOpenAiMaxSettings = await services.saveAutoCutLlmSettings({
        ...savedLlmDeepSeekAliasMaxSettings.llm,
        modelVendor: 'openai',
        model: 'gpt-5.2',
        maxTokens: 999999,
      });
      const savedLlmOpenAiMiniMaxSettings = await services.saveAutoCutLlmSettings({
        ...savedLlmOpenAiMaxSettings.llm,
        modelVendor: 'openai',
        model: 'gpt-5.2-chat-latest',
        maxTokens: 999999,
      });
      const savedLlmGeminiMaxSettings = await services.saveAutoCutLlmSettings({
        ...savedLlmOpenAiMiniMaxSettings.llm,
        modelVendor: 'gemini',
        model: 'gemini-3.1-pro-preview',
        maxTokens: 999999,
      });
      const savedLlmGeminiFlashRuntimeSettings = await services.saveAutoCutLlmSettings({
        ...savedLlmGeminiMaxSettings.llm,
        modelVendor: 'gemini',
        model: 'gemini-3-flash-preview',
        maxTokens: 999999,
      });
      const savedLlmAnthropicVendorSettings = await services.saveAutoCutLlmSettings({
        ...savedLlmGeminiFlashRuntimeSettings.llm,
        modelVendor: 'anthropic',
      });
      const savedLlmXaiVendorSettings = await services.saveAutoCutLlmSettings({
        ...savedLlmAnthropicVendorSettings.llm,
        modelVendor: 'xai',
      });
      const savedLlmQwenVendorSettings = await services.saveAutoCutLlmSettings({
        ...savedLlmXaiVendorSettings.llm,
        modelVendor: 'qwen',
      });
      const savedLlmMoonshotVendorSettings = await services.saveAutoCutLlmSettings({
        ...savedLlmQwenVendorSettings.llm,
        modelVendor: 'moonshot',
      });
      const savedLlmBaiduVendorSettings = await services.saveAutoCutLlmSettings({
        ...savedLlmMoonshotVendorSettings.llm,
        modelVendor: 'baidu',
      });
      const savedLlmZhipuVendorSettings = await services.saveAutoCutLlmSettings({
        ...savedLlmBaiduVendorSettings.llm,
        modelVendor: 'zhipu',
      });
      const savedLlmMinimaxVendorSettings = await services.saveAutoCutLlmSettings({
        ...savedLlmZhipuVendorSettings.llm,
        modelVendor: 'minimax',
      });
      const savedLlmHunyuanVendorSettings = await services.saveAutoCutLlmSettings({
        ...savedLlmMinimaxVendorSettings.llm,
        modelVendor: 'hunyuan',
      });
      const savedLlmDoubaoVendorSettings = await services.saveAutoCutLlmSettings({
        ...savedLlmHunyuanVendorSettings.llm,
        modelVendor: 'doubao',
      });
      const savedLlmAnthropicMaxSettings = await services.saveAutoCutLlmSettings({
        ...savedLlmDoubaoVendorSettings.llm,
        modelVendor: 'anthropic',
        model: 'claude-sonnet-4-5-20250929',
        maxTokens: 999999,
      });
      const savedLlmXaiMaxSettings = await services.saveAutoCutLlmSettings({
        ...savedLlmAnthropicMaxSettings.llm,
        modelVendor: 'xai',
        model: 'grok-4.1',
        maxTokens: 999999,
      });
      const savedLlmQwenMaxSettings = await services.saveAutoCutLlmSettings({
        ...savedLlmXaiMaxSettings.llm,
        modelVendor: 'qwen',
        model: 'qwen3.6-plus',
        maxTokens: 999999,
      });
      const savedLlmMoonshotMaxSettings = await services.saveAutoCutLlmSettings({
        ...savedLlmQwenMaxSettings.llm,
        modelVendor: 'moonshot',
        model: 'kimi-k2-0905-preview',
        maxTokens: 999999,
      });
      const savedLlmBaiduMaxSettings = await services.saveAutoCutLlmSettings({
        ...savedLlmMoonshotMaxSettings.llm,
        modelVendor: 'baidu',
        model: 'ernie-5.0-preview',
        maxTokens: 999999,
      });
      const savedLlmZhipuMaxSettings = await services.saveAutoCutLlmSettings({
        ...savedLlmBaiduMaxSettings.llm,
        modelVendor: 'zhipu',
        model: 'glm-4.6',
        maxTokens: 999999,
      });
      const savedLlmMinimaxMaxSettings = await services.saveAutoCutLlmSettings({
        ...savedLlmZhipuMaxSettings.llm,
        modelVendor: 'minimax',
        model: 'MiniMax-M2.7',
        maxTokens: 999999,
      });
      const savedLlmHunyuanMaxSettings = await services.saveAutoCutLlmSettings({
        ...savedLlmMinimaxMaxSettings.llm,
        modelVendor: 'hunyuan',
        model: 'hunyuan-turbos-latest',
        maxTokens: 999999,
      });
      const savedLlmDoubaoMaxSettings = await services.saveAutoCutLlmSettings({
        ...savedLlmHunyuanMaxSettings.llm,
        modelVendor: 'doubao',
        model: 'doubao-seed-2-0-pro-250828',
        maxTokens: 999999,
      });
      const resolvedLlmRuntimeConfig = await services.resolveAutoCutLlmRuntimeConfig();
      const savedSpeechTranscriptionSettings = await services.saveAutoCutSpeechTranscriptionSettings({
        ...initialSettings.speechTranscription,
        providerId: 'local-whisper-cli',
        executablePath: ' D:/tools/whisper-cli.exe ',
        modelPath: ' D:/models/ggml-large-v3-turbo.bin ',
        language: ' zh ',
      });
      const resolvedSpeechTranscriptionRuntimeConfig = await services.resolveAutoCutSpeechTranscriptionRuntimeConfig();
      const testedSpeechTranscriptionProbe = await services.testAutoCutSpeechTranscriptionProvider();
      const speechTranscriptionSettingsAfterProbe = await services.getAutoCutSettings();
      const changedSpeechTranscriptionSettingsAfterProbe = await services.saveAutoCutSpeechTranscriptionSettings({
        ...speechTranscriptionSettingsAfterProbe.speechTranscription,
        modelPath: 'D:/models/ggml-large-v3-turbo.gguf',
      });
      const createdApiKeySettings = await services.createAutoCutApiKey('Contract Key');
      const revokedApiKeySettings = await services.revokeAutoCutApiKey(createdApiKeySettings.apiKeys[0].id);
      const clearedCacheSettings = await services.clearAutoCutStorageCache();
      const loadedInvoiceSettings = await services.loadMoreAutoCutInvoices();
      const avatarRequestedSettings = await services.requestAutoCutAvatarChange();
      const subscriptionManagementSettings = await services.openAutoCutSubscriptionManagement();
      const passwordRequestedSettings = await services.requestAutoCutPasswordChange();
      const enabledTwoFactorSettings = await services.setAutoCutTwoFactorEnabled(true);
      const revokedSessionsSettings = await services.revokeAutoCutSessions();
      const canceledSubscriptionSettings = await services.cancelAutoCutSubscription();
      const deletedSettings = await services.deleteAutoCutAccount();
      return {
        accountSettings: savedAccountSettings,
        workspaceSettings: savedWorkspaceSettings,
        notificationSettings: savedNotificationSettings,
        llmVendorSettings: savedLlmVendorSettings,
        llmCustomModelSettings: savedLlmCustomModelSettings,
        llmNativeSecretSettings: savedLlmNativeSecretSettings,
        llmNativeSecretRuntimeConfig: resolvedNativeSecretRuntimeConfig,
        llmDeepSeekMaxSettings: savedLlmDeepSeekMaxSettings,
        llmDeepSeekAliasMaxSettings: savedLlmDeepSeekAliasMaxSettings,
        llmOpenAiMaxSettings: savedLlmOpenAiMaxSettings,
        llmOpenAiMiniMaxSettings: savedLlmOpenAiMiniMaxSettings,
        llmGeminiMaxSettings: savedLlmGeminiMaxSettings,
        llmGeminiFlashRuntimeSettings: savedLlmGeminiFlashRuntimeSettings,
        llmAnthropicVendorSettings: savedLlmAnthropicVendorSettings,
        llmXaiVendorSettings: savedLlmXaiVendorSettings,
        llmQwenVendorSettings: savedLlmQwenVendorSettings,
        llmMoonshotVendorSettings: savedLlmMoonshotVendorSettings,
        llmBaiduVendorSettings: savedLlmBaiduVendorSettings,
        llmZhipuVendorSettings: savedLlmZhipuVendorSettings,
        llmMinimaxVendorSettings: savedLlmMinimaxVendorSettings,
        llmHunyuanVendorSettings: savedLlmHunyuanVendorSettings,
        llmDoubaoVendorSettings: savedLlmDoubaoVendorSettings,
        llmAnthropicMaxSettings: savedLlmAnthropicMaxSettings,
        llmXaiMaxSettings: savedLlmXaiMaxSettings,
        llmQwenMaxSettings: savedLlmQwenMaxSettings,
        llmMoonshotMaxSettings: savedLlmMoonshotMaxSettings,
        llmBaiduMaxSettings: savedLlmBaiduMaxSettings,
        llmZhipuMaxSettings: savedLlmZhipuMaxSettings,
        llmMinimaxMaxSettings: savedLlmMinimaxMaxSettings,
        llmHunyuanMaxSettings: savedLlmHunyuanMaxSettings,
        llmDoubaoMaxSettings: savedLlmDoubaoMaxSettings,
        llmRuntimeConfig: resolvedLlmRuntimeConfig,
        speechTranscriptionSettings: savedSpeechTranscriptionSettings,
        speechTranscriptionRuntimeConfig: resolvedSpeechTranscriptionRuntimeConfig,
        speechTranscriptionProbe: testedSpeechTranscriptionProbe,
        speechTranscriptionSettingsAfterProbe,
        changedSpeechTranscriptionSettingsAfterProbe,
        apiKeySettings: createdApiKeySettings,
        revokedSettings: revokedApiKeySettings,
        cacheClearedSettings: clearedCacheSettings,
        invoiceSettings: loadedInvoiceSettings,
        avatarSettings: avatarRequestedSettings,
        subscriptionManagementSettings,
        passwordSettings: passwordRequestedSettings,
        twoFactorSettings: enabledTwoFactorSettings,
        sessionsRevokedSettings: revokedSessionsSettings,
        subscriptionSettings: canceledSubscriptionSettings,
        deletedAccountSettings: deletedSettings,
      };
    });
    settingsEvents.stop();
    const storedSettings = readScopedStoredObject(services, 'settings');
    assertEqual(accountSettings.account.displayName, 'Contract User', 'saveAutoCutAccountSettings persists account edits');
    assertEqual(workspaceSettings.workspace.hardwareAcceleration, false, 'saveAutoCutWorkspaceSettings persists workspace edits');
    assertEqual(workspaceSettings.workspace.language, 'en-US', 'saveAutoCutWorkspaceSettings preserves canonical application locale values');
    assertEqual(notificationSettings.notifications.usageReports, false, 'saveAutoCutNotificationSettings persists notification edits');
    assertEqual(llmVendorSettings.llm.modelVendor, 'openai', 'saveAutoCutLlmSettings persists the selected ModelVendor');
    assertEqual(llmVendorSettings.llm.baseUrl, 'https://api.openai.com/v1', 'saveAutoCutLlmSettings switches base URL from the selected ModelVendor preset');
    assertEqual(llmVendorSettings.llm.model, 'gpt-5.2', 'saveAutoCutLlmSettings switches default model from the selected ModelVendor preset');
    assertEqual(llmVendorSettings.llm.maxTokens, 8192, 'saveAutoCutLlmSettings switches to the selected vendor default output budget');
    assertEqual(llmCustomModelSettings.llm.model, 'gpt-4.1-mini', 'saveAutoCutLlmSettings preserves an explicit model override');
    assertEqual(llmCustomModelSettings.llm.maxTokens, 4096, 'saveAutoCutLlmSettings keeps a valid output budget when the model override supports it');
    assertEqual(llmNativeSecretSettings.llm.maskedApiKey, 'sk-na*************cret', 'saveAutoCutLlmSettings stores native-secret-backed masked LLM API keys in AppSettings');
    assertEqual(llmNativeSecretRuntimeConfig.sessionApiKey, 'sk-native-stored-secret', 'resolveAutoCutLlmRuntimeConfig restores the LLM API key from native secret storage after session memory is cleared');
    assertRule(
      settingsNativeSecretCommands.some((entry) => entry.command === 'autocut_save_llm_secret' && entry.args?.request?.secretValue === 'sk-native-stored-secret'),
      'saveAutoCutLlmSettings writes raw LLM API keys to the native secret store instead of browser storage',
    );
    assertRule(
      settingsNativeSecretCommands.some((entry) => entry.command === 'autocut_get_llm_secret'),
      'resolveAutoCutLlmRuntimeConfig reads LLM API keys from the native secret store when session memory is empty',
    );
    assertEqual(llmDeepSeekMaxSettings.llm.maxTokens, 393216, 'saveAutoCutLlmSettings allows DeepSeek V4 384K maximum output tokens');
    assertEqual(llmDeepSeekAliasMaxSettings.llm.maxTokens, 393216, 'saveAutoCutLlmSettings treats DeepSeek legacy chat alias as the V4 Flash capability class');
    assertEqual(llmOpenAiMaxSettings.llm.maxTokens, 128000, 'saveAutoCutLlmSettings clamps GPT-5.2 output tokens to its model-specific ceiling');
    assertEqual(llmOpenAiMiniMaxSettings.llm.maxTokens, 128000, 'saveAutoCutLlmSettings clamps GPT-5.2 Chat Latest output tokens to its model-specific ceiling');
    assertEqual(llmGeminiMaxSettings.llm.maxTokens, 65536, 'saveAutoCutLlmSettings clamps Gemini 3.1 Pro Preview output tokens to its model-specific ceiling');
    assertEqual(llmGeminiFlashRuntimeSettings.llm.maxTokens, 65536, 'saveAutoCutLlmSettings clamps Gemini 3 Flash Preview output tokens to its model-specific ceiling');
    assertDeepEqual(
      [
        [llmAnthropicVendorSettings.llm.modelVendor, llmAnthropicVendorSettings.llm.baseUrl, llmAnthropicVendorSettings.llm.model],
        [llmXaiVendorSettings.llm.modelVendor, llmXaiVendorSettings.llm.baseUrl, llmXaiVendorSettings.llm.model],
        [llmQwenVendorSettings.llm.modelVendor, llmQwenVendorSettings.llm.baseUrl, llmQwenVendorSettings.llm.model],
        [llmMoonshotVendorSettings.llm.modelVendor, llmMoonshotVendorSettings.llm.baseUrl, llmMoonshotVendorSettings.llm.model],
        [llmBaiduVendorSettings.llm.modelVendor, llmBaiduVendorSettings.llm.baseUrl, llmBaiduVendorSettings.llm.model],
        [llmZhipuVendorSettings.llm.modelVendor, llmZhipuVendorSettings.llm.baseUrl, llmZhipuVendorSettings.llm.model],
        [llmMinimaxVendorSettings.llm.modelVendor, llmMinimaxVendorSettings.llm.baseUrl, llmMinimaxVendorSettings.llm.model],
        [llmHunyuanVendorSettings.llm.modelVendor, llmHunyuanVendorSettings.llm.baseUrl, llmHunyuanVendorSettings.llm.model],
        [llmDoubaoVendorSettings.llm.modelVendor, llmDoubaoVendorSettings.llm.baseUrl, llmDoubaoVendorSettings.llm.model],
      ],
      [
        ['anthropic', 'https://api.anthropic.com/v1', 'claude-sonnet-4-5-20250929'],
        ['xai', 'https://api.x.ai/v1', 'grok-4.1'],
        ['qwen', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen3.6-plus'],
        ['moonshot', 'https://api.moonshot.cn/v1', 'kimi-k2-0905-preview'],
        ['baidu', 'https://qianfan.baidubce.com/v2', 'ernie-5.0-preview'],
        ['zhipu', 'https://open.bigmodel.cn/api/paas/v4', 'glm-4.6'],
        ['minimax', 'https://api.minimax.io/v1', 'MiniMax-M2.7'],
        ['hunyuan', 'https://api.hunyuan.cloud.tencent.com/v1', 'hunyuan-t1-latest'],
        ['doubao', 'https://ark.cn-beijing.volces.com/api/v3', 'doubao-seed-2-0-pro-250828'],
      ],
      'saveAutoCutLlmSettings switches mainstream China/US ModelVendors to canonical base URLs and default models',
    );
    assertEqual(llmAnthropicMaxSettings.llm.maxTokens, 64000, 'saveAutoCutLlmSettings clamps Claude Sonnet output tokens to its model-specific ceiling');
    assertEqual(llmXaiMaxSettings.llm.maxTokens, 32768, 'saveAutoCutLlmSettings clamps Grok output tokens to its model-specific ceiling');
    assertEqual(llmQwenMaxSettings.llm.maxTokens, 65536, 'saveAutoCutLlmSettings clamps Qwen3 Max output tokens to its model-specific ceiling');
    assertEqual(llmMoonshotMaxSettings.llm.maxTokens, 65536, 'saveAutoCutLlmSettings clamps Kimi output tokens to its model-specific ceiling');
    assertEqual(llmBaiduMaxSettings.llm.maxTokens, 65536, 'saveAutoCutLlmSettings clamps ERNIE output tokens to its model-specific ceiling');
    assertEqual(llmZhipuMaxSettings.llm.maxTokens, 128000, 'saveAutoCutLlmSettings clamps GLM output tokens to its model-specific ceiling');
    assertEqual(llmMinimaxMaxSettings.llm.maxTokens, 65536, 'saveAutoCutLlmSettings clamps MiniMax output tokens to its model-specific ceiling');
    assertEqual(llmHunyuanMaxSettings.llm.maxTokens, 65536, 'saveAutoCutLlmSettings clamps Hunyuan output tokens to its model-specific ceiling');
    assertEqual(llmDoubaoMaxSettings.llm.maxTokens, 65536, 'saveAutoCutLlmSettings clamps Doubao output tokens to its model-specific ceiling');
    assertEqual(llmCustomModelSettings.llm.maskedApiKey, 'sk-co*************cret', 'saveAutoCutLlmSettings stores only a masked LLM API key in AppSettings');
    assertEqual(storedSettings.llm.apiKey, undefined, 'settings storage never persists the raw LLM API key');
    assertEqual(storedSettings.llm.sessionApiKey, undefined, 'settings storage never persists transient LLM session API keys');
    assertEqual(llmRuntimeConfig.modelVendor, 'doubao', 'resolveAutoCutLlmRuntimeConfig returns the selected ModelVendor');
    assertEqual(llmRuntimeConfig.baseUrl, 'https://ark.cn-beijing.volces.com/api/v3', 'resolveAutoCutLlmRuntimeConfig returns the OpenAI-compatible base URL');
    assertEqual(llmRuntimeConfig.model, 'doubao-seed-2-0-pro-250828', 'resolveAutoCutLlmRuntimeConfig returns the active model');
    assertEqual(llmRuntimeConfig.maxTokens, 65536, 'resolveAutoCutLlmRuntimeConfig returns the model-specific output budget');
    assertEqual(llmRuntimeConfig.apiKeyConfigured, true, 'resolveAutoCutLlmRuntimeConfig reports configured API key status without exposing the key');
    assertEqual('apiKey' in llmRuntimeConfig, false, 'resolveAutoCutLlmRuntimeConfig does not expose raw API keys to the renderer');
    assertEqual(speechTranscriptionSettings.speechTranscription.executablePath, 'D:/tools/whisper-cli.exe', 'saveAutoCutSpeechTranscriptionSettings trims and persists executablePath');
    assertEqual(speechTranscriptionSettings.speechTranscription.modelPath, 'D:/models/ggml-large-v3-turbo.bin', 'saveAutoCutSpeechTranscriptionSettings trims and persists modelPath');
    assertEqual(speechTranscriptionSettings.speechTranscription.language, 'zh', 'saveAutoCutSpeechTranscriptionSettings trims and persists language');
    assertEqual(speechTranscriptionSettings.speechTranscription.providerId, 'local-whisper-cli', 'saveAutoCutSpeechTranscriptionSettings persists the selected stable STT provider id');
    assertEqual(speechTranscriptionSettings.speechTranscription.configured, true, 'saveAutoCutSpeechTranscriptionSettings marks the local speech-to-text toolchain as configured');
    const invalidProviderSettings = await services.saveAutoCutSpeechTranscriptionSettings({
      ...speechTranscriptionSettings.speechTranscription,
      providerId: '文案提取',
    });
    assertEqual(
      invalidProviderSettings.speechTranscription.providerId,
      'local-whisper-cli',
      'saveAutoCutSpeechTranscriptionSettings normalizes invalid or localized provider ids back to the default stable enum id',
    );
    await assertRejects(
      () => services.saveAutoCutSpeechTranscriptionSettings({
        ...speechTranscriptionSettings.speechTranscription,
        executablePath: 'tools/whisper-cli.exe',
      }),
      'absolute local executable file path',
      'saveAutoCutSpeechTranscriptionSettings rejects relative local speech-to-text executable paths',
    );
    await assertRejects(
      () => services.saveAutoCutSpeechTranscriptionSettings({
        ...speechTranscriptionSettings.speechTranscription,
        executablePath: 'https://tools.example.com/whisper-cli.exe',
      }),
      'absolute local executable file path',
      'saveAutoCutSpeechTranscriptionSettings rejects remote speech-to-text executable URLs',
    );
    await assertRejects(
      () => services.saveAutoCutSpeechTranscriptionSettings({
        ...speechTranscriptionSettings.speechTranscription,
        executablePath: 'D:/tools/',
      }),
      'absolute local executable file path',
      'saveAutoCutSpeechTranscriptionSettings rejects directory-like local speech-to-text executable paths',
    );
    await assertRejects(
      () => services.saveAutoCutSpeechTranscriptionSettings({
        ...speechTranscriptionSettings.speechTranscription,
        modelPath: 'models/ggml-large-v3-turbo.bin',
      }),
      'absolute local model file path',
      'saveAutoCutSpeechTranscriptionSettings rejects relative local speech-to-text model paths',
    );
    await assertRejects(
      () => services.saveAutoCutSpeechTranscriptionSettings({
        ...speechTranscriptionSettings.speechTranscription,
        modelPath: 'https://models.example.com/ggml-large-v3-turbo.bin',
      }),
      'absolute local model file path',
      'saveAutoCutSpeechTranscriptionSettings rejects remote speech-to-text model URLs',
    );
    await assertRejects(
      () => services.saveAutoCutSpeechTranscriptionSettings({
        ...speechTranscriptionSettings.speechTranscription,
        modelPath: 'D:/models/ggml-large-v3-turbo.txt',
      }),
      'supported model file extension',
      'saveAutoCutSpeechTranscriptionSettings rejects unsupported local speech-to-text model extensions',
    );
    assertEqual(storedSettings.speechTranscription.executablePath, 'D:/tools/whisper-cli.exe', 'settings storage persists local speech-to-text executablePath');
    assertEqual(speechTranscriptionSettings.speechTranscription.modelPath, 'D:/models/ggml-large-v3-turbo.bin', 'settings save result persists local speech-to-text modelPath');
    assertEqual(storedSettings.speechTranscription.modelPath, 'D:/models/ggml-large-v3-turbo.gguf', 'settings storage persists the latest local speech-to-text modelPath after user edits');
    assertEqual(storedSettings.speechTranscription.providerId, 'local-whisper-cli', 'settings storage persists the selected stable speech-to-text provider id');
    assertEqual(speechTranscriptionRuntimeConfig.configured, true, 'resolveAutoCutSpeechTranscriptionRuntimeConfig reports saved local speech-to-text settings');
    assertEqual(speechTranscriptionRuntimeConfig.providerId, 'local-whisper-cli', 'resolveAutoCutSpeechTranscriptionRuntimeConfig returns the saved STT provider id');
    assertEqual(speechTranscriptionRuntimeConfig.executablePath, 'D:/tools/whisper-cli.exe', 'resolveAutoCutSpeechTranscriptionRuntimeConfig returns the saved speech executable path');
    assertEqual(speechTranscriptionRuntimeConfig.modelPath, 'D:/models/ggml-large-v3-turbo.bin', 'resolveAutoCutSpeechTranscriptionRuntimeConfig returns the saved speech model path');
    assertEqual(speechTranscriptionRuntimeConfig.language, 'zh', 'resolveAutoCutSpeechTranscriptionRuntimeConfig returns the saved default speech language');
    assertEqual(speechTranscriptionProbe.ready, true, 'testAutoCutSpeechTranscriptionProvider reports native probe readiness');
    assertEqual(speechTranscriptionSettingsAfterProbe.speechTranscription.lastProbeReady, true, 'testAutoCutSpeechTranscriptionProvider stores the latest probe readiness on settings');
    assertEqual(
      changedSpeechTranscriptionSettingsAfterProbe.speechTranscription.lastProbeReady,
      undefined,
      'saveAutoCutSpeechTranscriptionSettings clears stale probe readiness when local speech-to-text modelPath changes',
    );
    assertEqual(
      changedSpeechTranscriptionSettingsAfterProbe.speechTranscription.lastProbeDiagnostics,
      undefined,
      'saveAutoCutSpeechTranscriptionSettings clears stale probe diagnostics when local speech-to-text modelPath changes',
    );
    assertRule(
      settingsNativeSecretCommands.some((entry) => entry.command === 'autocut_probe_speech_transcription' && entry.args?.request?.sourceKind === 'settings'),
      'testAutoCutSpeechTranscriptionProvider probes the persisted settings-backed local speech-to-text provider',
    );
    assertRule(
      settingsNativeSecretCommands.some((entry) => entry.command === 'autocut_probe_speech_transcription' && entry.args?.request?.providerId === 'local-whisper-cli'),
      'testAutoCutSpeechTranscriptionProvider passes the selected providerId to the native probe',
    );
    await services.saveAutoCutSpeechTranscriptionSettings({
      ...speechTranscriptionSettings.speechTranscription,
      modelPath: 'D:/models/ggml-large-v3-turbo.gguf',
    });
    const unverifiedLocalProviderTranscriptionRequests = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        mediaImportCommandReady: true,
        speechTranscriptionCommandReady: true,
        speechTranscriptionToolchainReady: false,
        speechTranscriptionProbeCommandReady: true,
        speechTranscriptionModelDownloadCommandReady: true,
      }),
      downloadSpeechTranscriptionModel: async (request) => {
        unverifiedLocalProviderTranscriptionRequests.push({ kind: 'download-model', request });
        return {
          providerId: request.providerId,
          presetId: request.presetId,
          fileName: request.fileName,
          modelPath: request.modelPath ?? 'D:/autocut/media/models/speech/ggml-large-v3-turbo-q5_0.bin',
          byteSize: 573571072,
          downloaded: true,
          sourceUrl: request.url,
          sha256: request.sha256,
        };
      },
      probeSpeechTranscription: async (request) => {
        unverifiedLocalProviderTranscriptionRequests.push({ kind: 'probe', request });
        return {
          ready: Boolean(request.executablePath && request.modelPath),
          executablePath: request.executablePath,
          modelPath: request.modelPath,
          sourceKind: request.sourceKind ?? 'execution-preflight',
          diagnostics: [],
          versionLine: 'auto repaired unverified local STT',
        };
      },
      transcribeMedia: async (request) => {
        unverifiedLocalProviderTranscriptionRequests.push({ kind: 'transcribe', request });
        return createStandardNativeVideoSliceTranscriptResult(request, 'unverified-local-transcript-task');
      },
    });
    const autoRepairedUnverifiedLocalProviderTranscription = await services.transcribeAutoCutMediaWithConfiguredProvider({
      assetUuid: 'provider-local-unverified-asset',
      language: 'en',
      outputRootDir: 'D:/autocut/media',
    });
    assertEqual(
      autoRepairedUnverifiedLocalProviderTranscription.segments.length,
      2,
      'transcribeAutoCutMediaWithConfiguredProvider auto-initializes and verifies repairable untested local STT settings',
    );
    assertEqual(
      unverifiedLocalProviderTranscriptionRequests.some((entry) => entry.kind === 'transcribe'),
      true,
      'transcribeAutoCutMediaWithConfiguredProvider dispatches native transcription after repairable local STT settings pass automatic setup',
    );
    await services.saveAutoCutSpeechTranscriptionSettings({
      ...speechTranscriptionSettings.speechTranscription,
      executablePath: 'D:/tools/whisper-cli.exe',
      modelPath: '',
      language: 'auto',
    });
    const autoInitializedLocalProviderCommands = [];
    const autoInitializedSpeechDiagnostics = await captureConsoleDiagnosticsAsync(async () => {
      services.configureAutoCutNativeHostClient({
        getCapabilities: async () => ({
          mediaImportCommandReady: true,
          speechTranscriptionCommandReady: true,
          speechTranscriptionToolchainReady: false,
          speechTranscriptionProbeCommandReady: true,
          speechTranscriptionModelDownloadCommandReady: true,
        }),
        downloadSpeechTranscriptionModel: async (request) => {
          autoInitializedLocalProviderCommands.push({ kind: 'download-model', request });
          return {
            providerId: request.providerId,
            presetId: request.presetId,
            fileName: request.fileName,
            modelPath: 'D:/autocut/media/models/speech/ggml-large-v3-turbo-q5_0.bin',
            byteSize: 573571072,
            downloaded: true,
            sourceUrl: request.url,
            sha256: request.sha256,
          };
        },
        probeSpeechTranscription: async (request) => {
          autoInitializedLocalProviderCommands.push({ kind: 'probe', request });
          return {
            ready: Boolean(request.executablePath && request.modelPath),
            executablePath: request.executablePath,
            modelPath: request.modelPath,
            sourceKind: request.sourceKind ?? 'execution-preflight',
            diagnostics: [],
            versionLine: 'auto initialized local STT',
          };
        },
        transcribeMedia: async (request) => {
          autoInitializedLocalProviderCommands.push({ kind: 'transcribe', request });
          return createStandardNativeVideoSliceTranscriptResult(request, 'auto-initialized-local-transcript-task');
        },
      });
      const autoInitializedLocalProviderTranscription = await services.transcribeAutoCutMediaWithConfiguredProvider({
        assetUuid: 'provider-local-auto-initialized-model-asset',
        language: 'en',
        outputRootDir: 'D:/autocut/media',
      });
      assertEqual(
        autoInitializedLocalProviderTranscription.segments.length,
        2,
        'transcribeAutoCutMediaWithConfiguredProvider returns transcript segments after automatic local STT model initialization',
      );
    });
    assertEqual(
      autoInitializedLocalProviderCommands[0]?.kind,
      'download-model',
      'transcribeAutoCutMediaWithConfiguredProvider initializes the recommended local STT model before probing when only modelPath is missing',
    );
    assertEqual(
      autoInitializedLocalProviderCommands[1]?.kind,
      'probe',
      'transcribeAutoCutMediaWithConfiguredProvider probes local STT again after automatic model initialization',
    );
    assertEqual(
      autoInitializedLocalProviderCommands[1]?.request?.modelPath,
      'D:/autocut/media/models/speech/ggml-large-v3-turbo-q5_0.bin',
      'transcribeAutoCutMediaWithConfiguredProvider probes the native-installed local STT model path',
    );
    assertEqual(
      autoInitializedLocalProviderCommands[2]?.kind,
      'transcribe',
      'transcribeAutoCutMediaWithConfiguredProvider dispatches native transcription only after local STT initialization succeeds',
    );
    assertEqual(
      autoInitializedLocalProviderCommands[2]?.request?.modelPath,
      'D:/autocut/media/models/speech/ggml-large-v3-turbo-q5_0.bin',
      'transcribeAutoCutMediaWithConfiguredProvider sends the initialized local STT model path to native transcription',
    );
    assertRule(
      autoInitializedSpeechDiagnostics.some((call) =>
        call.level === 'warning' &&
        String(call.args?.[0] ?? '').includes('[AutoCut:speech-transcription] Local speech-to-text model initialization started')
      ),
      'transcribeAutoCutMediaWithConfiguredProvider logs automatic local STT model initialization to the browser console',
    );
    const speechSettingsAfterAutoInitialization = await services.getAutoCutSettings();
    assertEqual(
      speechSettingsAfterAutoInitialization.speechTranscription.modelPath,
      'D:/autocut/media/models/speech/ggml-large-v3-turbo-q5_0.bin',
      'transcribeAutoCutMediaWithConfiguredProvider persists the auto-initialized local STT model path',
    );
    assertEqual(
      speechSettingsAfterAutoInitialization.speechTranscription.lastProbeReady,
      true,
      'transcribeAutoCutMediaWithConfiguredProvider stores the successful execution preflight after automatic local STT initialization',
    );
    await services.saveAutoCutSpeechTranscriptionSettings({
      ...speechSettingsAfterAutoInitialization.speechTranscription,
      executablePath: '',
      modelPath: '',
      language: 'auto',
    });
    const bundledSidecarLocalProviderCommands = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        mediaImportCommandReady: true,
        speechTranscriptionCommandReady: true,
        speechTranscriptionToolchainReady: false,
        speechTranscriptionProbeCommandReady: true,
        speechTranscriptionModelDownloadCommandReady: true,
      }),
      downloadSpeechTranscriptionModel: async (request) => {
        bundledSidecarLocalProviderCommands.push({ kind: 'download-model', request });
        return {
          providerId: request.providerId,
          presetId: request.presetId,
          fileName: request.fileName,
          modelPath: 'D:/autocut/media/models/speech/ggml-large-v3-turbo-q5_0.bin',
          byteSize: 573571072,
          downloaded: true,
          sourceUrl: request.url,
          sha256: request.sha256,
        };
      },
      probeSpeechTranscription: async (request) => {
        bundledSidecarLocalProviderCommands.push({ kind: 'probe', request });
        const executablePath = request.executablePath ?? 'D:/Program Files/SDKWork Video Cut/resources/binaries/windows-x86_64/whisper-cli.exe';
        return {
          ready: Boolean(executablePath && request.modelPath),
          executablePath,
          modelPath: request.modelPath ?? '',
          sourceKind: request.executablePath ? 'execution-preflight' : 'bundled-sidecar',
          diagnostics: request.modelPath ? [] : ['AutoCut local speech transcription modelPath is not configured.'],
          versionLine: request.modelPath ? 'bundled whisper sidecar' : undefined,
        };
      },
      transcribeMedia: async (request) => {
        bundledSidecarLocalProviderCommands.push({ kind: 'transcribe', request });
        return createStandardNativeVideoSliceTranscriptResult(request, 'bundled-sidecar-local-transcript-task');
      },
    });
    const bundledSidecarLocalProviderTranscription = await services.transcribeAutoCutMediaWithConfiguredProvider({
      assetUuid: 'provider-local-bundled-sidecar-auto-model-asset',
      language: 'en',
      outputRootDir: 'D:/autocut/media',
    });
    assertEqual(
      bundledSidecarLocalProviderCommands[0]?.kind,
      'probe',
      'transcribeAutoCutMediaWithConfiguredProvider probes packaged local STT sidecar discovery before model initialization',
    );
    assertEqual(
      bundledSidecarLocalProviderCommands[0]?.request?.executablePath,
      undefined,
      'transcribeAutoCutMediaWithConfiguredProvider lets native host resolve the packaged Whisper sidecar when executablePath is not manually configured',
    );
    assertEqual(
      bundledSidecarLocalProviderCommands[1]?.kind,
      'download-model',
      'transcribeAutoCutMediaWithConfiguredProvider downloads the recommended local STT model after packaged sidecar discovery',
    );
    assertEqual(
      bundledSidecarLocalProviderCommands[2]?.kind,
      'probe',
      'transcribeAutoCutMediaWithConfiguredProvider probes packaged sidecar plus downloaded model before dispatch',
    );
    assertEqual(
      bundledSidecarLocalProviderCommands[2]?.request?.executablePath,
      'D:/Program Files/SDKWork Video Cut/resources/binaries/windows-x86_64/whisper-cli.exe',
      'transcribeAutoCutMediaWithConfiguredProvider persists the packaged Whisper sidecar executablePath before execution preflight',
    );
    assertEqual(
      bundledSidecarLocalProviderCommands[3]?.kind,
      'transcribe',
      'transcribeAutoCutMediaWithConfiguredProvider dispatches transcription after packaged sidecar and model initialization both verify',
    );
    assertEqual(
      bundledSidecarLocalProviderTranscription.segments.length,
      2,
      'transcribeAutoCutMediaWithConfiguredProvider returns transcript segments after packaged sidecar local STT initialization',
    );
    const speechSettingsAfterBundledSidecarInitialization = await services.getAutoCutSettings();
    assertEqual(
      speechSettingsAfterBundledSidecarInitialization.speechTranscription.executablePath,
      'D:/Program Files/SDKWork Video Cut/resources/binaries/windows-x86_64/whisper-cli.exe',
      'transcribeAutoCutMediaWithConfiguredProvider persists the packaged Whisper sidecar executablePath from native probe evidence',
    );
    assertEqual(
      speechSettingsAfterBundledSidecarInitialization.speechTranscription.modelPath,
      'D:/autocut/media/models/speech/ggml-large-v3-turbo-q5_0.bin',
      'transcribeAutoCutMediaWithConfiguredProvider persists the recommended model path after packaged sidecar initialization',
    );
    assertEqual(
      speechSettingsAfterBundledSidecarInitialization.speechTranscription.lastProbeReady,
      true,
      'transcribeAutoCutMediaWithConfiguredProvider stores successful readiness after packaged sidecar initialization',
    );
    await services.saveAutoCutSpeechTranscriptionSettings({
      ...speechSettingsAfterBundledSidecarInitialization.speechTranscription,
      executablePath: '',
      modelPath: '',
      language: 'auto',
    });
    const missingExecutableLocalProviderCommands = [];
    const missingExecutableSpeechDiagnostics = await captureConsoleDiagnosticsAsync(async () => {
      services.configureAutoCutNativeHostClient({
        getCapabilities: async () => ({
          mediaImportCommandReady: true,
          speechTranscriptionCommandReady: true,
          speechTranscriptionToolchainReady: false,
          speechTranscriptionProbeCommandReady: true,
          speechTranscriptionModelDownloadCommandReady: true,
        }),
        downloadSpeechTranscriptionModel: async (request) => {
          missingExecutableLocalProviderCommands.push({ kind: 'download-model', request });
          return {
            providerId: request.providerId,
            presetId: request.presetId,
            fileName: request.fileName,
            modelPath: 'D:/autocut/media/models/speech/ggml-large-v3-turbo-q5_0.bin',
            byteSize: 573571072,
            downloaded: true,
            sourceUrl: request.url,
            sha256: request.sha256,
          };
        },
        probeSpeechTranscription: async (request) => {
          missingExecutableLocalProviderCommands.push({ kind: 'probe', request });
          return {
            ready: false,
            executablePath: '',
            modelPath: request.modelPath ?? '',
            sourceKind: request.sourceKind ?? 'execution-preflight',
            diagnostics: ['AutoCut local speech transcription executablePath is not configured; select or bundle whisper-cli before running Smart Slice.'],
          };
        },
        transcribeMedia: async (request) => {
          missingExecutableLocalProviderCommands.push({ kind: 'transcribe', request });
          return createStandardNativeVideoSliceTranscriptResult(request, 'missing-executable-local-transcript-task');
        },
      });
      await assertRejects(
        () => services.transcribeAutoCutMediaWithConfiguredProvider({
          assetUuid: 'provider-local-missing-executable-asset',
          language: 'en',
          outputRootDir: 'D:/autocut/media',
        }),
        'executablePath',
        'transcribeAutoCutMediaWithConfiguredProvider blocks local STT initialization when the Whisper executable is not configured or bundled',
      );
    });
    assertEqual(
      missingExecutableLocalProviderCommands[0]?.kind,
      'probe',
      'transcribeAutoCutMediaWithConfiguredProvider probes local STT setup before deciding whether executable initialization is possible',
    );
    assertRule(
      !missingExecutableLocalProviderCommands.some((entry) => entry.kind === 'download-model' || entry.kind === 'transcribe'),
      'transcribeAutoCutMediaWithConfiguredProvider does not download models or dispatch transcription before a local STT executable is configured',
    );
    assertRule(
      missingExecutableSpeechDiagnostics.some((call) =>
        call.level === 'error' &&
        String(call.args?.[0] ?? '').includes('[AutoCut:speech-transcription] Local speech-to-text executable is missing')
      ),
      'transcribeAutoCutMediaWithConfiguredProvider logs missing local STT executable diagnostics to the browser console',
    );
    await saveVerifiedLocalSpeechTranscriptionSettings(services, {
      language: speechTranscriptionSettingsAfterProbe.speechTranscription.language,
    });
    const incompleteLocalProviderTranscriptionRequests = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        mediaImportCommandReady: true,
        speechTranscriptionCommandReady: true,
        speechTranscriptionToolchainReady: true,
        speechTranscriptionProbeCommandReady: true,
        speechTranscriptionModelDownloadCommandReady: true,
      }),
      probeSpeechTranscription: async (request) => ({
        ready: false,
        executablePath: request.executablePath,
        modelPath: request.modelPath,
        sourceKind: request.sourceKind ?? 'execution-preflight',
        diagnostics: [
          'AutoCut local speech-to-text model is missing or incomplete; download the recommended offline Whisper model again.',
        ],
      }),
      transcribeMedia: async (request) => {
        incompleteLocalProviderTranscriptionRequests.push(request);
        return createStandardNativeVideoSliceTranscriptResult(request, 'incomplete-local-model-task');
      },
    });
    await assertRejects(
      () => services.transcribeAutoCutMediaWithConfiguredProvider({
        assetUuid: 'provider-local-incomplete-model-asset',
        language: 'en',
        outputRootDir: 'D:/autocut/media',
      }),
      'Use and download the recommended offline Whisper model',
      'transcribeAutoCutMediaWithConfiguredProvider blocks execution when the fresh local STT model probe reports an incomplete model',
    );
    assertEqual(
      incompleteLocalProviderTranscriptionRequests.length,
      0,
      'transcribeAutoCutMediaWithConfiguredProvider does not dispatch native transcription when the local STT model is incomplete',
    );
    const speechSettingsAfterIncompletePreflight = await services.getAutoCutSettings();
    assertEqual(
      speechSettingsAfterIncompletePreflight.speechTranscription.lastProbeReady,
      false,
      'transcribeAutoCutMediaWithConfiguredProvider stores failed execution preflight readiness on settings',
    );
    await saveVerifiedLocalSpeechTranscriptionSettings(services, {
      language: speechTranscriptionSettingsAfterProbe.speechTranscription.language,
    });
    const missingProbeCommandTranscriptionRequests = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        mediaImportCommandReady: true,
        speechTranscriptionCommandReady: true,
        speechTranscriptionToolchainReady: true,
        speechTranscriptionProbeCommandReady: false,
        speechTranscriptionModelDownloadCommandReady: true,
      }),
      transcribeMedia: async (request) => {
        missingProbeCommandTranscriptionRequests.push(request);
        return createStandardNativeVideoSliceTranscriptResult(request, 'missing-probe-command-task');
      },
    });
    await assertRejects(
      () => services.transcribeAutoCutMediaWithConfiguredProvider({
        assetUuid: 'provider-local-missing-probe-command-asset',
        language: 'en',
        outputRootDir: 'D:/autocut/media',
      }),
      'desktop host speech-to-text validation',
      'transcribeAutoCutMediaWithConfiguredProvider blocks local STT execution when the desktop host cannot validate model integrity',
    );
    assertEqual(
      missingProbeCommandTranscriptionRequests.length,
      0,
      'transcribeAutoCutMediaWithConfiguredProvider does not dispatch native transcription without execution-time local STT validation',
    );
    await saveVerifiedLocalSpeechTranscriptionSettings(services, {
      language: speechTranscriptionSettingsAfterProbe.speechTranscription.language,
    });
    const localProviderTranscriptionRequests = [];
    const localProviderExecutionProbeRequests = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        mediaImportCommandReady: true,
        speechTranscriptionCommandReady: true,
        speechTranscriptionToolchainReady: true,
        speechTranscriptionProbeCommandReady: true,
      }),
      transcribeMedia: async (request) => {
        localProviderTranscriptionRequests.push(request);
        return createStandardNativeVideoSliceTranscriptResult(request, 'provider-local-transcript-task');
      },
      probeSpeechTranscription: async (request) => ({
        ...(localProviderExecutionProbeRequests.push(request), {
          ready: Boolean(request.executablePath && request.modelPath),
          executablePath: request.executablePath,
          modelPath: request.modelPath,
          sourceKind: request.sourceKind ?? 'settings',
          diagnostics: [],
          versionLine: 'provider contract',
        }),
      }),
    });
    const localProviderTranscription = await services.transcribeAutoCutMediaWithConfiguredProvider({
      assetUuid: 'provider-local-asset',
      language: 'en',
      outputRootDir: 'D:/autocut/media',
    });
    assertEqual(
      localProviderExecutionProbeRequests[0]?.sourceKind,
      'execution-preflight',
      'transcribeAutoCutMediaWithConfiguredProvider performs a fresh execution preflight probe before local STT dispatch',
    );
    assertEqual(localProviderTranscription.segments.length, 2, 'transcribeAutoCutMediaWithConfiguredProvider returns normalized local provider segments');
    assertEqual(
      localProviderTranscriptionRequests[0]?.providerId,
      'local-whisper-cli',
      'transcribeAutoCutMediaWithConfiguredProvider sends the selected local providerId to native transcription',
    );
    assertEqual(
      localProviderTranscriptionRequests[0]?.executablePath,
      'D:/tools/whisper-cli.exe',
      'transcribeAutoCutMediaWithConfiguredProvider sends the configured executablePath only from the local provider adapter',
    );
    const apiProviderBridgeCalls = [];
    services.configureAutoCutSpeechTranscriptionProviderBridge({
      async transcribe(request, runtime) {
        apiProviderBridgeCalls.push({ request, runtime });
        return {
          artifactUuid: 'api-provider-transcript-artifact',
          taskUuid: 'api-provider-transcript-task',
          sourceAssetUuid: request.assetUuid,
          transcriptPath: '',
          taskOutputDir: request.outputRootDir ?? '',
          language: request.language ?? runtime.language,
          text: 'API provider transcript.',
          segments: [
            {
              startMs: 1000,
              endMs: 4200,
              text: 'API provider transcript.',
              speaker: 'Speaker 1',
            },
          ],
          providerId: runtime.providerId,
        };
      },
      async test(runtime) {
        return {
          ready: true,
          providerId: runtime.providerId,
          sourceKind: 'api-bridge',
          diagnostics: [],
        };
      },
    });
    await services.saveAutoCutSpeechTranscriptionSettings({
      ...speechTranscriptionSettings.speechTranscription,
      providerId: 'openai-transcription',
      modelVendor: 'openai',
      model: 'gpt-4o-transcribe',
      executablePath: '',
      modelPath: '',
      language: 'auto',
    });
    const apiProviderRuntimeConfig = await services.resolveAutoCutSpeechTranscriptionRuntimeConfig();
    assertEqual(apiProviderRuntimeConfig.providerId, 'openai-transcription', 'resolveAutoCutSpeechTranscriptionRuntimeConfig returns the selected API STT provider id');
    assertEqual(apiProviderRuntimeConfig.modelVendor, 'openai', 'resolveAutoCutSpeechTranscriptionRuntimeConfig returns the selected API STT ModelVendor');
    assertEqual(apiProviderRuntimeConfig.configured, false, 'resolveAutoCutSpeechTranscriptionRuntimeConfig fails closed for API providers until the matching API key is configured');
    await assertRejects(
      () => services.transcribeAutoCutMediaWithConfiguredProvider({
        assetUuid: 'api-provider-asset-unconfigured',
        language: 'en',
      }),
      'API key is required',
      'transcribeAutoCutMediaWithConfiguredProvider fails closed before dispatching an unconfigured API provider',
    );
    assertEqual(apiProviderBridgeCalls.length, 0, 'unconfigured API STT provider does not dispatch to the API bridge');
    await services.saveAutoCutLlmSettings({
      ...(await services.getAutoCutSettings()).llm,
      modelVendor: 'openai',
      model: 'gpt-5.2',
      apiKey: 'sk-stt-openai-provider',
    });
    services.configureAutoCutSpeechTranscriptionProviderBridge(null);
    await assertRejects(
      () => services.transcribeAutoCutMediaWithConfiguredProvider({
        assetUuid: 'api-provider-missing-bridge-asset',
        language: 'en',
      }),
      'configured speech transcription provider bridge',
      'transcribeAutoCutMediaWithConfiguredProvider blocks configured API STT providers when the provider bridge is unavailable',
    );
    assertEqual(apiProviderBridgeCalls.length, 0, 'API STT provider does not dispatch when its bridge is unavailable');
    services.configureAutoCutSpeechTranscriptionProviderBridge({
      async transcribe(request, runtime) {
        apiProviderBridgeCalls.push({ request, runtime });
        return {
          artifactUuid: 'api-provider-transcript-artifact',
          taskUuid: 'api-provider-transcript-task',
          sourceAssetUuid: request.assetUuid,
          transcriptPath: '',
          taskOutputDir: request.outputRootDir ?? '',
          language: request.language ?? runtime.language,
          text: 'API provider transcript.',
          segments: [
            {
              startMs: 1000,
              endMs: 4200,
              text: 'API provider transcript.',
              speaker: 'Speaker 1',
            },
          ],
          providerId: runtime.providerId,
        };
      },
    });
    await services.saveAutoCutLlmSettings({
      ...(await services.getAutoCutSettings()).llm,
      modelVendor: 'gemini',
      model: 'gemini-3-flash-preview',
      apiKey: 'sk-stt-gemini-provider',
    });
    await assertRejects(
      () => services.transcribeAutoCutMediaWithConfiguredProvider({
        assetUuid: 'api-provider-mismatched-vendor-asset',
        language: 'en',
      }),
      'matching ModelVendor openai',
      'transcribeAutoCutMediaWithConfiguredProvider blocks API STT providers when the configured ModelVendor does not match the selected provider',
    );
    assertEqual(apiProviderBridgeCalls.length, 0, 'API STT provider does not dispatch when its ModelVendor runtime is mismatched');
    await services.saveAutoCutLlmSettings({
      ...(await services.getAutoCutSettings()).llm,
      modelVendor: 'openai',
      model: 'gpt-5.2',
      apiKey: 'sk-stt-openai-provider',
    });
    const configuredApiProviderTranscription = await services.transcribeAutoCutMediaWithConfiguredProvider({
      assetUuid: 'api-provider-asset',
      language: 'en',
      outputRootDir: 'D:/autocut/media',
    });
    assertEqual(configuredApiProviderTranscription.providerId, 'openai-transcription', 'API STT provider transcription result records the selected provider id');
    assertEqual(configuredApiProviderTranscription.segments[0]?.text, 'API provider transcript.', 'API STT provider bridge returns normalized transcript segments');
    assertEqual(apiProviderBridgeCalls.length, 1, 'configured API STT provider dispatches exactly once through the standard provider bridge');
    assertEqual(apiProviderBridgeCalls[0]?.runtime.providerId, 'openai-transcription', 'API STT provider bridge receives the selected provider runtime');
    assertEqual(apiProviderBridgeCalls[0]?.runtime.sessionApiKey, 'sk-stt-openai-provider', 'API STT provider bridge receives the API key only inside runtime bridge context');
    services.configureAutoCutSpeechTranscriptionProviderBridge({
      async transcribe() {
        return {
          artifactUuid: 'api-provider-empty-segments-artifact',
          taskUuid: 'api-provider-empty-segments-task',
          segments: [],
        };
      },
    });
    await assertRejects(
      () => services.transcribeAutoCutMediaWithConfiguredProvider({
        assetUuid: 'api-provider-empty-segments-asset',
        language: 'en',
      }),
      'valid timestamped speech segments',
      'transcribeAutoCutMediaWithConfiguredProvider rejects API provider results with no structured speech segments',
    );
    services.configureAutoCutSpeechTranscriptionProviderBridge({
      async transcribe() {
        return {
          artifactUuid: 'api-provider-blank-segment-artifact',
          taskUuid: 'api-provider-blank-segment-task',
          segments: [
            {
              startMs: 1000,
              endMs: 2200,
              text: '   ',
              speaker: 'Speaker 1',
            },
          ],
        };
      },
    });
    await assertRejects(
      () => services.transcribeAutoCutMediaWithConfiguredProvider({
        assetUuid: 'api-provider-blank-segment-asset',
        language: 'en',
      }),
      'segment 1 to contain recognized speech text',
      'transcribeAutoCutMediaWithConfiguredProvider rejects API provider segments with blank transcript text',
    );
    services.configureAutoCutSpeechTranscriptionProviderBridge({
      async transcribe() {
        return {
          artifactUuid: 'api-provider-zero-duration-segment-artifact',
          taskUuid: 'api-provider-zero-duration-segment-task',
          segments: [
            {
              startMs: 2400,
              endMs: 2400,
              text: 'Zero duration speech.',
              speaker: 'Speaker 1',
            },
          ],
        };
      },
    });
    await assertRejects(
      () => services.transcribeAutoCutMediaWithConfiguredProvider({
        assetUuid: 'api-provider-zero-duration-segment-asset',
        language: 'en',
      }),
      'segment 1 endMs to be after startMs',
      'transcribeAutoCutMediaWithConfiguredProvider rejects API provider segments with zero speech duration',
    );
    services.configureAutoCutSpeechTranscriptionProviderBridge({
      async transcribe() {
        return {
          artifactUuid: 'api-provider-nonfinite-timestamp-artifact',
          taskUuid: 'api-provider-nonfinite-timestamp-task',
          segments: [
            {
              startMs: Number.NaN,
              endMs: 3200,
              text: 'Invalid timestamp speech.',
              speaker: 'Speaker 1',
            },
          ],
        };
      },
    });
    await assertRejects(
      () => services.transcribeAutoCutMediaWithConfiguredProvider({
        assetUuid: 'api-provider-nonfinite-timestamp-asset',
        language: 'en',
      }),
      'segment 1 startMs to be a finite non-negative timestamp',
      'transcribeAutoCutMediaWithConfiguredProvider rejects API provider segments with non-finite speech timestamps',
    );
    services.configureAutoCutSpeechTranscriptionProviderBridge({
      async transcribe() {
        return {
          artifactUuid: 'api-provider-negative-timestamp-artifact',
          taskUuid: 'api-provider-negative-timestamp-task',
          segments: [
            {
              startMs: -1200,
              endMs: 3200,
              text: 'Negative timestamp speech.',
              speaker: 'Speaker 1',
            },
          ],
        };
      },
    });
    await assertRejects(
      () => services.transcribeAutoCutMediaWithConfiguredProvider({
        assetUuid: 'api-provider-negative-timestamp-asset',
        language: 'en',
      }),
      'segment 1 startMs to be a finite non-negative timestamp',
      'transcribeAutoCutMediaWithConfiguredProvider rejects API provider segments with negative speech timestamps',
    );
    services.configureAutoCutSpeechTranscriptionProviderBridge(null);
    await services.saveAutoCutLlmSettings({
      ...(await services.getAutoCutSettings()).llm,
      modelVendor: 'gemini',
    });
    await services.saveAutoCutLlmSettings({
      ...(await services.getAutoCutSettings()).llm,
      model: 'gemini-3-flash-preview',
      apiKey: 'sk-native-stored-secret',
    });
    const llmBridgeCalls = [];
    services.configureAutoCutApprovedAiSdkBridge({
      async createChatCompletion(request, runtime) {
        llmBridgeCalls.push({ request, runtime });
        return {
          id: 'llm-test-contract',
          model: request.model,
          content: 'pong',
          runtime,
        };
      },
    });
    const llmConnectionTestResult = await services.testAutoCutLlmConnection();
    services.configureAutoCutApprovedAiSdkBridge(null);
    assertEqual(llmConnectionTestResult.success, true, 'testAutoCutLlmConnection reports success when the approved AI SDK bridge responds');
    assertEqual(llmConnectionTestResult.modelVendor, 'gemini', 'testAutoCutLlmConnection reports the active ModelVendor');
    assertEqual(llmConnectionTestResult.model, 'gemini-3-flash-preview', 'testAutoCutLlmConnection reports the active model');
    assertEqual(llmConnectionTestResult.content, 'pong', 'testAutoCutLlmConnection returns the bridge response content');
    assertEqual(llmBridgeCalls.length, 1, 'testAutoCutLlmConnection performs exactly one bridge chat completion call');
    assertEqual(llmBridgeCalls[0]?.request.model, 'gemini-3-flash-preview', 'testAutoCutLlmConnection sends the active runtime model to the bridge');
    assertEqual(llmBridgeCalls[0]?.request.maxTokens, 16, 'testAutoCutLlmConnection uses a small output budget for the test request');
    assertEqual(llmBridgeCalls[0]?.runtime.baseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai', 'testAutoCutLlmConnection passes normalized runtime config to the bridge');
    assertEqual(llmBridgeCalls[0]?.runtime.sessionApiKey, 'sk-native-stored-secret', 'testAutoCutLlmConnection passes the restored native-secret API key only inside runtime bridge context');
    const vercelAiSdkBridgeInputs = [];
    services.configureAutoCutVercelAiSdkBridge(async (input) => {
      vercelAiSdkBridgeInputs.push(input);
      return {
        id: 'vercel-ai-sdk-test',
        model: input.request.model,
        content: 'pong',
        runtime: input.runtime,
      };
    });
    const vercelBridgeConnectionTestResult = await services.testAutoCutLlmConnection();
    services.configureAutoCutApprovedAiSdkBridge(null);
    assertEqual(vercelBridgeConnectionTestResult.success, true, 'configureAutoCutVercelAiSdkBridge wires a working Vercel AI SDK connection test');
    assertEqual(vercelBridgeConnectionTestResult.content, 'pong', 'configureAutoCutVercelAiSdkBridge normalizes Vercel AI SDK text content');
    assertEqual(vercelAiSdkBridgeInputs[0]?.provider.baseURL, 'https://generativelanguage.googleapis.com/v1beta/openai', 'Vercel AI SDK bridge receives the active OpenAI-compatible base URL');
    assertEqual(vercelAiSdkBridgeInputs[0]?.provider.apiKey, 'sk-native-stored-secret', 'Vercel AI SDK bridge receives the restored native-secret API key without persisting it');
    assertEqual(vercelAiSdkBridgeInputs[0]?.provider.name, 'gemini', 'Vercel AI SDK bridge names the provider from the active ModelVendor');
    assertEqual(vercelAiSdkBridgeInputs[0]?.request.model, 'gemini-3-flash-preview', 'Vercel AI SDK bridge uses the active model');
    assertEqual(vercelAiSdkBridgeInputs[0]?.request.maxTokens, 16, 'Vercel AI SDK bridge receives the normalized maxTokens budget');
    assertEqual(vercelAiSdkBridgeInputs[0]?.request.temperature, 0, 'Vercel AI SDK bridge receives the normalized temperature');
    assertEqual(vercelAiSdkBridgeInputs[0]?.request.messages[0]?.content, 'Reply with exactly: pong', 'Vercel AI SDK bridge receives the connection-test prompt');
    assertRule(typeof vercelAiSdkBridgeInputs[0]?.provider.fetch === 'function', 'Vercel AI SDK bridge configures desktop-native fetch for OpenAI-compatible calls');
    const llmSecretDeletedSettings = await services.clearAutoCutLlmApiKey();
    assertEqual(llmSecretDeletedSettings.llm.apiKeyConfigured, false, 'clearAutoCutLlmApiKey clears configured LLM API key state');
    assertEqual(llmSecretDeletedSettings.llm.maskedApiKey, undefined, 'clearAutoCutLlmApiKey clears masked LLM API key display state');
    assertRule(
      settingsNativeSecretCommands.some((entry) => entry.command === 'autocut_delete_llm_secret'),
      'clearAutoCutLlmApiKey deletes LLM API keys from the native secret store',
    );
    resetStorage();
    await assertRejects(
      () => services.testAutoCutLlmConnection(),
      'API key',
      'testAutoCutLlmConnection fails closed when the LLM API key is not configured',
    );
    await services.saveAutoCutLlmSettings(llmGeminiFlashRuntimeSettings.llm);
    await assertRejects(
      () => services.createAutoCutOpenAiCompatibleChatCompletion({
        messages: [{ role: 'user', content: 'Generate a short AutoCut title.' }],
      }),
      'approved AI SDK bridge',
      'createAutoCutOpenAiCompatibleChatCompletion blocks raw HTTP fallback',
    );
    await assertRejects(
      () => services.createAutoCutOpenAiCompatibleChatCompletion({
        model: 'gpt-5.2',
        messages: [{ role: 'user', content: 'Generate a short AutoCut title.' }],
      }),
      'configured ModelVendor',
      'createAutoCutOpenAiCompatibleChatCompletion rejects a cross-provider model override',
    );
    assertEqual(apiKeySettings.apiKeys[0]?.name, 'Contract Key', 'createAutoCutApiKey prepends the new API key');
    assertRule(Boolean(revokedSettings.apiKeys[0]?.revokedAt), 'revokeAutoCutApiKey marks the key as revoked');
    assertEqual(cacheClearedSettings.storage.cacheGb, 0, 'clearAutoCutStorageCache resets cache size');
    assertRule(invoiceSettings.billing.invoicesLoaded > cacheClearedSettings.billing.invoicesLoaded, 'loadMoreAutoCutInvoices increments invoice count');
    assertRule(Boolean(avatarSettings.account.avatarChangeRequestedAt), 'requestAutoCutAvatarChange records an avatar request timestamp');
    assertRule(Boolean(subscriptionManagementSettings.billing.subscriptionManagementOpenedAt), 'openAutoCutSubscriptionManagement records a management open timestamp');
    assertRule(Boolean(passwordSettings.security.passwordChangeRequestedAt), 'requestAutoCutPasswordChange records a password change request timestamp');
    assertEqual(twoFactorSettings.security.twoFactorEnabled, true, 'setAutoCutTwoFactorEnabled persists 2FA status');
    assertRule(Boolean(sessionsRevokedSettings.security.sessionsRevokedAt), 'revokeAutoCutSessions stores a revocation timestamp');
    assertEqual(subscriptionSettings.billing.subscriptionActive, false, 'cancelAutoCutSubscription deactivates the subscription');
    assertRule(Boolean(deletedAccountSettings.security.accountDeletedAt), 'deleteAutoCutAccount stores the deletion timestamp');
    assertEqual(storedSettings.security.accountDeletedAt, deletedAccountSettings.security.accountDeletedAt, 'settings workflow writes the final state to storage');
    assertRule(settingsEvents.details.length >= 17, 'settings workflows dispatch settingsUpdated events');

    resetStorage();
    const isolatedRuntimeLlmSecretValues = new Map();
    const isolatedRuntimeSecretCommands = [];
    services.configureAutoCutRuntimeEnvironment('dev');
    services.configureAutoCutNativeHostClient(services.createAutoCutNativeHostClient(async (command, args) => {
      isolatedRuntimeSecretCommands.push({ command, args });
      if (command === 'autocut_host_capabilities') {
        return {
          contractVersion: 'settings-runtime-isolation-test',
          hostKind: 'native-host',
          databaseContractReady: true,
          sqliteMigrationReady: true,
          databaseHealthCommandReady: true,
          ffmpegProbeCommandReady: true,
          mediaImportCommandReady: true,
          mediaFileDescribeCommandReady: true,
          localVideoFileSelectCommandReady: true,
          audioExtractionCommandReady: true,
          audioExtractionFromAssetReady: true,
          videoGifCommandReady: true,
          videoCompressCommandReady: true,
          videoConvertCommandReady: true,
          videoEnhanceCommandReady: true,
          llmHttpCommandReady: true,
          llmSecretStoreReady: true,
          nativeTaskQueryCommandReady: true,
          nativeTaskCancelCommandReady: true,
          nativeTaskRecoveryCommandReady: true,
          nativeTaskRetryCommandReady: true,
          nativeTaskProgressEventsReady: true,
          nativeWorkerLeaseReady: true,
          ffmpegToolchainManifestReady: true,
          ffmpegToolchainResolverReady: true,
          ffmpegBundledReady: false,
          ffmpegExecutionReady: false,
          supportedCommands: [
            'autocut_save_llm_secret',
            'autocut_get_llm_secret',
            'autocut_delete_llm_secret',
          ],
        };
      }
      if (command === 'autocut_save_llm_secret') {
        isolatedRuntimeLlmSecretValues.set(args.request.secretName, args.request.secretValue);
        return {
          secretName: args.request.secretName,
          saved: true,
        };
      }
      if (command === 'autocut_get_llm_secret') {
        const secretValue = isolatedRuntimeLlmSecretValues.get(args.request.secretName);
        return {
          secretName: args.request.secretName,
          configured: Boolean(secretValue),
          ...(secretValue ? { secretValue } : {}),
        };
      }
      if (command === 'autocut_delete_llm_secret') {
        const deleted = isolatedRuntimeLlmSecretValues.delete(args.request.secretName);
        return {
          secretName: args.request.secretName,
          deleted,
        };
      }

      throw new Error(`Unexpected isolated runtime native host command: ${command}`);
    }));

    const devLlmSettings = await withImmediateTimers(async () => services.saveAutoCutLlmSettings({
      ...defaultSettings.llm,
      modelVendor: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.2',
      apiKey: 'sk-dev-secret',
      maxTokens: 9000,
    }));
    const configuredDevOutputDirectory = 'D:/autocut-dev-output-root';
    const devWorkspaceSettings = await withImmediateTimers(async () => services.saveAutoCutWorkspaceSettings({
      ...(await services.getAutoCutSettings()).workspace,
      outputDirectory: configuredDevOutputDirectory,
    }));
    const devSpeechTranscriptionSettings = await withImmediateTimers(async () => services.saveAutoCutSpeechTranscriptionSettings({
      ...(await services.getAutoCutSettings()).speechTranscription,
      executablePath: 'D:/dev-tools/whisper-cli.exe',
      modelPath: 'D:/dev-models/ggml-large-v3-turbo.bin',
      language: 'zh',
    }));
    services.clearTransientAutoCutLlmApiKeyForTest();
    const devRuntimeAfterRestart = await withImmediateTimers(() => services.resolveAutoCutLlmRuntimeConfig());
    const devOutputDirectoryAfterRestart = await withImmediateTimers(() => services.resolveAutoCutOutputRootDir());
    const devSpeechTranscriptionAfterRestart = await withImmediateTimers(() => services.resolveAutoCutSpeechTranscriptionRuntimeConfig());
    services.configureAutoCutRuntimeEnvironment('release');
    const releaseSettingsAfterSwitch = await withImmediateTimers(() => services.getAutoCutSettings());
    const releaseRuntimeAfterSwitch = await withImmediateTimers(() => services.resolveAutoCutLlmRuntimeConfig());
    const releaseOutputDirectoryAfterSwitch = await withImmediateTimers(() => services.resolveAutoCutOutputRootDir());
    const releaseSpeechTranscriptionAfterSwitch = await withImmediateTimers(() => services.resolveAutoCutSpeechTranscriptionRuntimeConfig());

    assertEqual(devLlmSettings.llm.modelVendor, 'openai', 'dev runtime stores its selected LLM ModelVendor');
    assertEqual(devWorkspaceSettings.workspace.outputDirectory, configuredDevOutputDirectory, 'dev runtime stores its selected output directory');
    assertEqual(devSpeechTranscriptionSettings.speechTranscription.modelPath, 'D:/dev-models/ggml-large-v3-turbo.bin', 'dev runtime stores its selected local speech-to-text model path');
    assertEqual(devRuntimeAfterRestart.modelVendor, 'openai', 'dev runtime reloads the selected LLM ModelVendor after restart');
    assertEqual(devRuntimeAfterRestart.model, 'gpt-5.2', 'dev runtime reloads the selected LLM model after restart');
    assertEqual(devRuntimeAfterRestart.baseUrl, 'https://api.openai.com/v1', 'dev runtime reloads the selected LLM base URL after restart');
    assertEqual(devRuntimeAfterRestart.maxTokens, 9000, 'dev runtime reloads the selected LLM maxTokens after restart');
    assertEqual(devRuntimeAfterRestart.sessionApiKey, 'sk-dev-secret', 'dev runtime restores its API key from the dev native secret after restart');
    assertEqual(devOutputDirectoryAfterRestart, configuredDevOutputDirectory, 'dev runtime reloads the selected output directory after restart');
    assertEqual(devSpeechTranscriptionAfterRestart.executablePath, 'D:/dev-tools/whisper-cli.exe', 'dev runtime reloads the selected local speech-to-text executable after restart');
    assertEqual(devSpeechTranscriptionAfterRestart.modelPath, 'D:/dev-models/ggml-large-v3-turbo.bin', 'dev runtime reloads the selected local speech-to-text model after restart');
    assertEqual(releaseSettingsAfterSwitch.llm.modelVendor, 'deepseek', 'release runtime does not read dev LLM settings');
    assertEqual(releaseSettingsAfterSwitch.workspace.outputDirectory, '', 'release runtime does not read dev output directory and keeps the native app-data fallback unconfigured');
    assertEqual(releaseSettingsAfterSwitch.speechTranscription.configured, false, 'release runtime does not read dev local speech-to-text settings');
    assertEqual(releaseRuntimeAfterSwitch.sessionApiKey, undefined, 'release runtime does not reuse the dev transient or native LLM API key');
    assertEqual(releaseOutputDirectoryAfterSwitch, undefined, 'release runtime leaves outputRootDir unset so the desktop host resolves a per-user app-data media root');
    assertEqual(releaseSpeechTranscriptionAfterSwitch.configured, false, 'release runtime keeps local speech-to-text unconfigured after switching from dev');
    assertRule(Boolean(localStorage.getItem('autocut_dev_settings')), 'dev LLM settings persist under the dev storage namespace');
    assertEqual(localStorage.getItem('autocut_release_settings'), null, 'dev LLM settings do not write the release storage namespace');
    assertRule(
      isolatedRuntimeSecretCommands.some((entry) => entry.command === 'autocut_save_llm_secret' && entry.args?.request?.secretName === 'dev-default'),
      'dev LLM API key saves to the dev native secret namespace',
    );
    assertRule(
      isolatedRuntimeSecretCommands.some((entry) => entry.command === 'autocut_get_llm_secret' && entry.args?.request?.secretName === 'dev-default'),
      'dev LLM API key reloads from the dev native secret namespace',
    );
    assertRule(
      isolatedRuntimeSecretCommands.some((entry) => entry.command === 'autocut_get_llm_secret' && entry.args?.request?.secretName === 'release-default'),
      'release LLM runtime uses a separate native secret namespace after environment switch',
    );

    const workflowVideoFile = (name) => new File(['video'], name, { type: 'video/mp4' });
    const rejectedProcessingWorkflows = [
      {
        name: 'slicer with unsupported browser fallback',
        process: processVideoSlice,
        params: {
          fileId: 'asset-source-slicer-browser-file',
          file: workflowVideoFile('browser-source.mp4'),
          mode: 'contract-mode',
          llmModel: 'gpt-4o',
          minDuration: 15,
          maxDuration: 60,
          baseAlgorithm: 'scene',
          highlightEngine: 'emotion',
          enableNoiseReduction: true,
          enableCoughFilter: true,
          enableRepeatFilter: true,
          enableSubtitles: true,
        },
        expectFailedTask: true,
        expectedMessagePart: 'trusted local desktop media file',
      },
      {
        name: 'slicer with external URL instead of desktop local source',
        process: processVideoSlice,
        params: {
          fileId: 'asset-source-slicer-url',
          url: 'https://video.example.com/source.mp4',
          mode: 'contract-mode',
          llmModel: 'gpt-4o',
          minDuration: 15,
          maxDuration: 60,
          baseAlgorithm: 'scene',
          highlightEngine: 'emotion',
          enableNoiseReduction: true,
          enableCoughFilter: true,
          enableRepeatFilter: true,
          enableSubtitles: true,
        },
        expectFailedTask: true,
        expectedMessagePart: 'trusted local desktop media file',
      },
      {
        name: 'extractor text with unsupported browser fallback',
        process: processExtractorText,
        params: {
          fileId: 'asset-source-extractor-text',
          file: workflowVideoFile('extractor-text.mp4'),
          language: 'zh',
          format: 'raw',
          separateSpeakers: true,
        },
        expectFailedTask: true,
        expectedMessagePart: 'trusted local desktop media file',
      },
      {
        name: 'extractor audio with unsupported browser fallback',
        process: processAudioExtraction,
        params: {
          fileId: 'asset-source-extractor-audio',
          file: workflowVideoFile('extractor-audio.mp4'),
          format: 'mp3',
          quality: '320',
          channel: 'stereo',
        },
        expectFailedTask: true,
        expectedMessagePart: 'trusted local desktop media file',
      },
      {
        name: 'video gif with unsupported browser fallback',
        process: processVideoGif,
        params: {
          fileId: 'asset-source-video-gif',
          file: workflowVideoFile('video-gif.mp4'),
          fps: '12',
          resolution: '720p',
          dither: true,
        },
        expectFailedTask: true,
        expectedMessagePart: 'trusted local desktop media file',
      },
      {
        name: 'video compress with unsupported browser fallback',
        process: processVideoCompress,
        params: {
          fileId: 'asset-source-video-compress',
          file: workflowVideoFile('video-compress.mp4'),
          compressionMode: 'balanced',
        },
        expectFailedTask: true,
        expectedMessagePart: 'trusted local desktop media file',
      },
      {
        name: 'video convert with unsupported browser fallback',
        process: processVideoConvert,
        params: {
          fileId: 'asset-source-video-convert',
          file: workflowVideoFile('video-convert.mp4'),
          targetFormat: 'mp4',
          videoCodec: 'h264',
          audioCodec: 'aac',
          resolution: '1080p',
        },
        expectFailedTask: true,
        expectedMessagePart: 'trusted local desktop media file',
      },
      {
        name: 'video enhance with unsupported browser fallback',
        process: processVideoEnhance,
        params: {
          fileId: 'asset-source-video-enhance',
          file: workflowVideoFile('video-enhance.mp4'),
          targetResolution: '4k',
          enhanceMode: 'balanced',
          frameRate: '60',
        },
        expectFailedTask: true,
        expectedMessagePart: 'trusted local desktop media file',
      },
      {
        name: 'subtitle translate with unsupported browser fallback',
        process: processSubtitleTranslate,
        params: {
          fileId: 'asset-source-subtitle-translate',
          file: workflowVideoFile('subtitle-translate.mp4'),
          sourceLang: 'zh',
          targetLang: 'en',
          keepOriginal: true,
          hardcode: true,
        },
        expectFailedTask: true,
        expectedMessagePart: 'trusted local desktop media file',
      },
      {
        name: 'voice translate with unsupported browser fallback',
        process: processVoiceTranslate,
        params: {
          fileId: 'asset-source-voice-translate',
          file: workflowVideoFile('voice-translate.mp4'),
          sourceLang: 'zh',
          targetLang: 'en',
          voiceCloneSync: true,
          bgmHandling: 'keep',
        },
        expectFailedTask: true,
        expectedMessagePart: 'trusted local desktop media file',
      },
      {
        name: 'slicer without media source',
        process: processVideoSlice,
        params: {
          mode: 'contract-mode',
          llmModel: 'gpt-4o',
          minDuration: 15,
          maxDuration: 60,
          baseAlgorithm: 'scene',
          highlightEngine: 'emotion',
          enableNoiseReduction: true,
          enableCoughFilter: true,
          enableRepeatFilter: true,
          enableSubtitles: true,
        },
      },
      {
        name: 'slicer with blank external source URL',
        process: processVideoSlice,
        params: {
          url: '   ',
          mode: 'contract-mode',
          llmModel: 'gpt-4o',
          minDuration: 15,
          maxDuration: 60,
          baseAlgorithm: 'scene',
          highlightEngine: 'emotion',
          enableNoiseReduction: true,
          enableCoughFilter: true,
          enableRepeatFilter: true,
          enableSubtitles: true,
        },
      },
      {
        name: 'slicer with unsafe external source URL',
        process: processVideoSlice,
        params: {
          url: 'javascript:alert(1)',
          mode: 'contract-mode',
          llmModel: 'gpt-4o',
          minDuration: 15,
          maxDuration: 60,
          baseAlgorithm: 'scene',
          highlightEngine: 'emotion',
          enableNoiseReduction: true,
          enableCoughFilter: true,
          enableRepeatFilter: true,
          enableSubtitles: true,
        },
      },
      {
        name: 'slicer with local file URL',
        process: processVideoSlice,
        params: {
          url: 'file:///tmp/source.mp4',
          mode: 'contract-mode',
          llmModel: 'gpt-4o',
          minDuration: 15,
          maxDuration: 60,
          baseAlgorithm: 'scene',
          highlightEngine: 'emotion',
          enableNoiseReduction: true,
          enableCoughFilter: true,
          enableRepeatFilter: true,
          enableSubtitles: true,
        },
      },
      {
        name: 'extractor text without media source',
        process: processExtractorText,
        params: {
          language: 'zh',
          format: 'raw',
          separateSpeakers: true,
        },
      },
      {
        name: 'extractor audio without media source',
        process: processAudioExtraction,
        params: {
          format: 'mp3',
          quality: '320',
          channel: 'stereo',
        },
      },
      {
        name: 'video gif without media source',
        process: processVideoGif,
        params: {
          fps: '12',
          resolution: '720p',
          dither: true,
        },
      },
      {
        name: 'video compress without media source',
        process: processVideoCompress,
        params: {
          compressionMode: 'balanced',
        },
      },
      {
        name: 'video convert without media source',
        process: processVideoConvert,
        params: {
          targetFormat: 'mp4',
          videoCodec: 'h264',
          audioCodec: 'aac',
          resolution: '1080p',
        },
      },
      {
        name: 'video enhance without media source',
        process: processVideoEnhance,
        params: {
          targetResolution: '4k',
          enhanceMode: 'balanced',
          frameRate: '60',
        },
      },
      {
        name: 'subtitle translate without media source',
        process: processSubtitleTranslate,
        params: {
          sourceLang: 'zh',
          targetLang: 'en',
          keepOriginal: true,
          hardcode: true,
        },
      },
      {
        name: 'voice translate without media source',
        process: processVoiceTranslate,
        params: {
          sourceLang: 'zh',
          targetLang: 'en',
          voiceCloneSync: true,
          bgmHandling: 'keep',
        },
      },
    ];

    for (const workflow of rejectedProcessingWorkflows) {
      await assertRejectedProcessingWorkflow({ services, workflow });
    }
  } finally {
    rmSync(moduleLoaderOutDir, { recursive: true, force: true });
  }
}

await run();

if (failures.length > 0) {
  console.error('AutoCut service behavior check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  console.error(`\n${pass.length} checks passed, ${failures.length} checks failed.`);
  process.exit(1);
}

console.log(`AutoCut service behavior check passed (${pass.length} checks).`);
