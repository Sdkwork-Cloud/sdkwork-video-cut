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

function assertIncludes(collection, value, message) {
  assertRule(collection.includes(value), message);
}

function assertNumberBetween(actual, min, max, message) {
  assertRule(
    typeof actual === 'number' && actual >= min && actual <= max,
    `${message} (expected ${min} <= value <= ${max}, got ${JSON.stringify(actual)})`,
  );
}

function assertArrayIncludes(actual, expectedItem, message) {
  assertRule(
    Array.isArray(actual) && actual.includes(expectedItem),
    `${message} (expected array to include ${JSON.stringify(expectedItem)}, got ${JSON.stringify(actual)})`,
  );
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
    createElement: () => ({
      href: '',
      download: '',
      click: () => undefined,
    }),
  };

  globalThis.window = windowTarget;
  globalThis.document = document;
  globalThis.localStorage = windowTarget.localStorage;
  globalThis.CustomEvent = AutoCutCustomEvent;
  const navigator = {
    clipboard: {
      writeText: async () => undefined,
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
    const { processVideoSlice } = await loadModule(
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
                  thumbnailArtifactPath: 'D:/autocut/media/tasks/ops-task-slice-contract/outputs/slice-001.jpg',
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
    assertEqual(nativeTasks.length, 4, 'getTasks maps every returned native ops_task snapshot');
    const nativeSliceTask = nativeTasks.find((task) => task.id === 'ops-task-slice-contract');
    assertEqual(nativeSliceTask?.type, types.AUTOCUT_TASK_TYPES[0], 'native video slice tasks map to the AppTask slice type');
    assertEqual(nativeSliceTask?.status, types.AUTOCUT_TASK_STATUS.completed, 'native completed status maps to completed AppTask status');
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
      'asset://localhost/D%3A%2Fautocut%2Fmedia%2Ftasks%2Fops-task-slice-contract%2Foutputs%2Fslice-001.jpg',
      'native slice thumbnail artifactPath is converted to a safe desktop asset URL',
    );
    assertEqual(
      nativeSliceTask?.sliceResults?.[0]?.subtitleUrl,
      'asset://localhost/D%3A%2Fautocut%2Fmedia%2Ftasks%2Fops-task-slice-contract%2Foutputs%2Fslice-001.srt',
      'native slice subtitle artifactPath is converted to a safe desktop asset URL',
    );

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
          transcriptCoverageScore: 0.96,
          subtitleSegmentCount: 4,
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
      nativeSliceTaskWithSidecarMetadata?.sliceResults?.[0]?.transcriptCoverageScore,
      0.96,
      'native task projection merges local smart slice transcript coverage score sidecars',
    );
    assertEqual(
      nativeSliceTaskWithSidecarMetadata?.sliceResults?.[0]?.subtitleSegmentCount,
      4,
      'native task projection merges local smart slice subtitle segment count sidecars',
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
    assertEqual(nativeTranscriptTask?.type, types.AUTOCUT_TASK_TYPES[1], 'native speech transcription tasks map to the AppTask text extraction type');
    assertEqual(nativeTranscriptTask?.resultCount, 2, 'native speech transcription segmentCount maps to AppTask resultCount');
    assertEqual(nativeTranscriptTask?.extractedText?.[1]?.time, '00:00:01', 'native speech transcription segment startMs maps to display timestamps');
    assertEqual(nativeTranscriptTask?.extractedText?.[1]?.speaker, 'Speaker 2', 'native speech transcription segment speakers are preserved');
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
    services.resetAutoCutNativeHostClient();
    const commons = await loadModule(server, 'packages/sdkwork-autocut-commons/src/index.ts');

    assertEqual(services.createAutoCutStorageKey('tasks'), 'autocut_release_tasks', 'storage key factory namespaces release task data');
    assertEqual(services.createAutoCutStorageKey('assets'), 'autocut_release_assets', 'storage key factory namespaces release asset data');
    assertEqual(services.createAutoCutStorageKey('messages'), 'autocut_release_messages', 'storage key factory namespaces release message data');
    assertEqual(services.createAutoCutStorageKey('settings'), 'autocut_release_settings', 'storage key factory namespaces release settings data');
    services.configureAutoCutRuntimeEnvironment('dev');
    assertEqual(services.createAutoCutStorageKey('settings'), 'autocut_dev_settings', 'storage key factory isolates dev settings data');
    services.configureAutoCutRuntimeEnvironment('release');
    assertEqual(services.createAutoCutStorageKey('settings'), 'autocut_release_settings', 'storage key factory restores release settings data');

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
        localVideoFileSelectCommandReady: true,
        localDirectorySelectCommandReady: true,
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
      if (command === 'autocut_select_local_directory') {
        return 'D:/media/selected-output-root';
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
          text: '第一段重点内容 第二段转折内容',
          segments: [
            {
              startMs: 12000,
              endMs: 27000,
              text: '第一段重点内容',
              speaker: 'Speaker 1',
            },
            {
              startMs: 45000,
              endMs: 62000,
              text: '第二段转折内容',
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
    const selectedNativeVideo = await configuredNativeHostClient.selectLocalVideoFile();
    const selectedNativeDirectory = await configuredNativeHostClient.selectLocalDirectory();
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
    assertEqual(selectedNativeVideo?.sourcePath, 'D:/media/selected-source.mp4', 'configured native host client selects a trusted local video source');
    assertEqual(selectedNativeDirectory, 'D:/media/selected-output-root', 'configured native host client selects a trusted local directory');
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
      invokedCommands[5]?.command,
      'autocut_select_local_video_file',
      'native host client invokes the local video chooser command',
    );
    assertEqual(
      invokedCommands[6]?.command,
      'autocut_select_local_directory',
      'native host client invokes the local directory chooser command',
    );
    const audioExtractionCommand = invokedCommands.find((entry) => entry.command === 'autocut_extract_audio');
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
    assertEqual(trustedLocalFile.size, 321000, 'trusted file source bridge preserves native byte size on the File-compatible value');
    assertEqual(trustedFileSourceEvents[0]?.files?.[0]?.name, 'native-source.mp4', 'trusted file source bridge dispatches trusted local files');
    const nativeAudioSourceFile = new File(['video'], 'native-source.mp4', { type: 'video/mp4' });
    Object.defineProperty(nativeAudioSourceFile, 'path', {
      configurable: true,
      value: 'D:/media/native-source.mp4',
    });
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
    const nativeVideoGifSourceFile = new File(['video'], 'native-source.mp4', { type: 'video/mp4' });
    Object.defineProperty(nativeVideoGifSourceFile, 'path', {
      configurable: true,
      value: 'D:/media/native-source.mp4',
    });
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
      probeSpeechTranscription: async () => {
        throw new Error('speech transcription probe is not needed inside the native video slice workflow contract');
      },
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
          text: '开场重点讲解 结尾转化引导',
          segments: [
            {
              startMs: 22000,
              endMs: 41000,
              text: '开场重点讲解',
              speaker: 'Speaker 1',
            },
            {
              startMs: 72000,
              endMs: 93000,
              text: '结尾转化引导',
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
          'native-slice-artifact-1.mp4',
          configuredOutputDirectory,
        );
        const secondOutput = createNativeTaskOutputArtifact(
          'native-slice-task',
          'native-slice-artifact-2.mp4',
          configuredOutputDirectory,
        );
        const firstThumbnail = createNativeTaskOutputArtifact(
          'native-slice-task',
          'native-slice-thumb-1.jpg',
          configuredOutputDirectory,
        );
        const secondThumbnail = createNativeTaskOutputArtifact(
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
              subtitleArtifactUuid: 'native-slice-subtitle-1',
              subtitleArtifactPath: firstSubtitle.artifactPath,
              taskOutputDir: firstOutput.taskOutputDir,
              byteSize: 234567,
              thumbnailByteSize: 12345,
              subtitleByteSize: 1234,
              subtitleFormat: 'srt',
              format: 'mp4',
              startMs: request.clips[0].startMs,
              durationMs: request.clips[0].durationMs,
              label: request.clips[0].label,
            },
            {
              artifactUuid: 'native-slice-artifact-2',
              artifactPath: secondOutput.artifactPath,
              thumbnailArtifactUuid: 'native-slice-thumb-2',
              thumbnailArtifactPath: secondThumbnail.artifactPath,
              subtitleArtifactUuid: 'native-slice-subtitle-2',
              subtitleArtifactPath: secondSubtitle.artifactPath,
              taskOutputDir: secondOutput.taskOutputDir,
              byteSize: 345678,
              thumbnailByteSize: 23456,
              subtitleByteSize: 2345,
              subtitleFormat: 'srt',
              format: 'mp4',
              startMs: request.clips[1].startMs,
              durationMs: request.clips[1].durationMs,
              label: request.clips[1].label,
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
    await services.saveAutoCutSpeechTranscriptionSettings({
      ...(await services.getAutoCutSettings()).speechTranscription,
      executablePath: 'D:/tools/whisper-cli.exe',
      modelPath: 'D:/models/ggml-large-v3-turbo.bin',
      language: 'auto',
    });
    const nativeVideoSliceSourceFile = new File(['video'], 'native-source.mp4', { type: 'video/mp4' });
    Object.defineProperty(nativeVideoSliceSourceFile, 'path', {
      configurable: true,
      value: 'D:/media/native-source.mp4',
    });
    const nativeVideoSliceWorkflowResult = await withImmediateTimers(async () =>
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
        enableSubtitles: true,
      }),
    );
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
      'srt',
      'video slice native workflow requests SRT subtitle output when subtitles are enabled',
    );
    assertEqual(
      nativeVideoSliceWorkflowCommands[2]?.request?.subtitleMode,
      'both',
      'video slice native workflow defaults enabled subtitles to burned video subtitles plus SRT sidecar output',
    );
    assertEqual(
      nativeVideoSliceWorkflowCommands[2]?.request?.subtitleStyleId,
      undefined,
      'video slice native workflow omits subtitle style when no subtitle style was selected',
    );
    assertEqual(
      nativeVideoSliceWorkflowCommands[2]?.request?.subtitleSegments?.length,
      2,
      'video slice native workflow forwards local speech transcript segments for task-scoped subtitles',
    );
    assertEqual(
      nativeVideoSliceWorkflowCommands[2]?.request?.subtitleSegments?.[0]?.text,
      '开场重点讲解',
      'video slice native workflow forwards subtitle segment text without fake subtitle generation',
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
      '开场重点讲解',
      'video slice native workflow uses local speech transcript text as the semantic clip label',
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
      'asset://localhost/D%3A%2Fautocut-configured-output%2Ftasks%2Fnative-slice-task%2Foutputs%2Fnative-slice-artifact-1.mp4',
      'video slice native workflow converts first native artifact path to a safe asset URL',
    );
    assertEqual(
      nativeVideoSliceWorkflowTask?.sliceResults?.[0]?.thumbnailUrl,
      'asset://localhost/D%3A%2Fautocut-configured-output%2Ftasks%2Fnative-slice-task%2Foutputs%2Fnative-slice-thumb-1.jpg',
      'video slice native workflow converts first native thumbnail path to a safe asset URL',
    );
    assertEqual(
      nativeVideoSliceWorkflowTask?.sliceResults?.[0]?.subtitleUrl,
      'asset://localhost/D%3A%2Fautocut-configured-output%2Ftasks%2Fnative-slice-task%2Foutputs%2Fnative-slice-subtitle-1.srt',
      'video slice native workflow exposes the first native subtitle artifact as a safe asset URL',
    );
    assertEqual(
      nativeVideoSliceWorkflowTask?.sliceResults?.[0]?.subtitleFormat,
      'srt',
      'video slice native workflow records the first native subtitle artifact format',
    );
    assertEqual(
      nativeVideoSliceWorkflowTask?.sliceResults?.[1]?.url,
      'asset://localhost/D%3A%2Fautocut-configured-output%2Ftasks%2Fnative-slice-task%2Foutputs%2Fnative-slice-artifact-2.mp4',
      'video slice native workflow converts second native artifact path to a safe asset URL',
    );
    assertEqual(
      nativeVideoSliceWorkflowTask?.sliceResults?.[1]?.thumbnailUrl,
      'asset://localhost/D%3A%2Fautocut-configured-output%2Ftasks%2Fnative-slice-task%2Foutputs%2Fnative-slice-thumb-2.jpg',
      'video slice native workflow converts second native thumbnail path to a safe asset URL',
    );
    assertEqual(
      nativeVideoSliceWorkflowTask?.sliceResults?.[1]?.subtitleUrl,
      'asset://localhost/D%3A%2Fautocut-configured-output%2Ftasks%2Fnative-slice-task%2Foutputs%2Fnative-slice-subtitle-2.srt',
      'video slice native workflow exposes the second native subtitle artifact as a safe asset URL',
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
      nativeVideoSliceFirstAsset?.thumbnailUrl,
      nativeVideoSliceWorkflowTask?.sliceResults?.[0]?.thumbnailUrl,
      'video slice native workflow stores safe thumbnail URLs on generated assets',
    );
    services.resetAutoCutNativeHostClient();
    services.configureAutoCutApprovedAiSdkBridge(null);

    resetStorage();
    const failingNativeVideoSliceSourceFile = new File(['video'], 'failing-native-source.mp4', { type: 'video/mp4' });
    Object.defineProperty(failingNativeVideoSliceSourceFile, 'path', {
      configurable: true,
      value: 'D:/media/failing-native-source.mp4',
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
        localDirectorySelectCommandReady: true,
        audioExtractionCommandReady: false,
        audioExtractionFromAssetReady: false,
        videoGifCommandReady: false,
        videoSliceCommandReady: true,
        videoCompressCommandReady: false,
        videoConvertCommandReady: false,
        videoEnhanceCommandReady: false,
        speechTranscriptionCommandReady: false,
        speechTranscriptionToolchainReady: false,
        speechTranscriptionProbeCommandReady: false,
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
      transcribeMedia: async () => {
        throw new Error('speech transcription is not configured for failing native video slice workflow contract');
      },
      probeSpeechTranscription: async () => {
        throw new Error('speech transcription probe is not configured for failing native video slice workflow contract');
      },
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
            enableSubtitles: false,
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
      probeSpeechTranscription: async () => {
        throw new Error('speech transcription probe is not needed inside the invalid LLM video slice workflow contract');
      },
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
          text: 'Opening semantic segment Closing semantic segment',
          segments: [
            {
              startMs: 31000,
              endMs: 47000,
              text: 'Opening semantic segment',
              speaker: 'Speaker 1',
            },
            {
              startMs: 88000,
              endMs: 106000,
              text: 'Closing semantic segment',
              speaker: 'Speaker 1',
            },
          ],
          ffmpegExecutable: 'ffmpeg',
          speechExecutable: 'whisper-cli',
        };
      },
      sliceVideo: async (request) => {
        invalidLlmVideoSliceWorkflowCommands.push({ kind: 'slice', request });
        const output = createNativeTaskOutputArtifact(
          'invalid-llm-slice-task',
          'invalid-llm-slice-artifact-1.mp4',
          configuredOutputDirectory,
        );
        const thumbnail = createNativeTaskOutputArtifact(
          'invalid-llm-slice-task',
          'invalid-llm-slice-thumb-1.jpg',
          configuredOutputDirectory,
        );
        return {
          taskUuid: 'invalid-llm-slice-task',
          sourceAssetUuid: request.assetUuid,
          taskOutputDir: output.taskOutputDir,
          ffmpegExecutable: 'ffmpeg',
          slices: [
            {
              artifactUuid: 'invalid-llm-slice-artifact-1',
              artifactPath: output.artifactPath,
              thumbnailArtifactUuid: 'invalid-llm-slice-thumb-1',
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
    await services.saveAutoCutSpeechTranscriptionSettings({
      ...(await services.getAutoCutSettings()).speechTranscription,
      executablePath: 'D:/tools/whisper-cli.exe',
      modelPath: 'D:/models/ggml-large-v3-turbo.bin',
      language: 'auto',
    });
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
    const invalidLlmVideoSliceSourceFile = new File(['video'], 'invalid-llm-source.mp4', { type: 'video/mp4' });
    Object.defineProperty(invalidLlmVideoSliceSourceFile, 'path', {
      configurable: true,
      value: 'D:/media/invalid-llm-source.mp4',
    });
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
        enableSubtitles: true,
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
      'Opening semantic segment',
      'video slice workflow keeps transcript-assisted labels when the configured LLM returns an invalid plan',
    );
    services.resetAutoCutNativeHostClient();
    services.configureAutoCutApprovedAiSdkBridge(null);

    resetStorage();
    const invalidDurationSliceSourceFile = new File(['video'], 'invalid-duration-source.mp4', { type: 'video/mp4' });
    Object.defineProperty(invalidDurationSliceSourceFile, 'path', {
      configurable: true,
      value: 'D:/media/invalid-duration-source.mp4',
    });
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
        speechTranscriptionCommandReady: false,
        speechTranscriptionToolchainReady: false,
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
    const shortSourceSliceFile = new File(['video'], 'short-source.mp4', { type: 'video/mp4' });
    Object.defineProperty(shortSourceSliceFile, 'path', {
      configurable: true,
      value: 'D:/media/short-source.mp4',
    });
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
            enableSubtitles: false,
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
      sliceVideo: async (request) => {
        unknownDurationShortTranscriptCommands.push({ kind: 'slice', request });
        const output = createNativeTaskOutputArtifact(
          'unknown-duration-short-transcript-slice-task',
          'unknown-duration-short-transcript-slice.mp4',
          configuredOutputDirectory,
        );
        const thumbnail = createNativeTaskOutputArtifact(
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
    const unknownDurationShortTranscriptFile = new File(['video'], 'unknown-duration-short-transcript.mp4', {
      type: 'video/mp4',
    });
    Object.defineProperty(unknownDurationShortTranscriptFile, 'path', {
      configurable: true,
      value: 'D:/media/unknown-duration-short-transcript.mp4',
    });
    const unknownDurationShortTranscriptResult = await withImmediateTimers(async () =>
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
        enableSubtitles: true,
      }),
    );
    const unknownDurationShortTranscriptSliceCommand = unknownDurationShortTranscriptCommands.find((entry) => entry.kind === 'slice');
    assertEqual(
      unknownDurationShortTranscriptResult.success,
      true,
      'video slice workflow does not treat a short transcript as a short source when imported media duration is unknown',
    );
    assertEqual(
      unknownDurationShortTranscriptSliceCommand?.request?.clips?.[0]?.durationMs,
      15000,
      'video slice workflow can fall back to a minimum renderable clip when source duration is unknown but transcript is short',
    );

    resetStorage();
    const transcriptCandidateSliceCommands = [];
    const transcriptCandidateBridgeRequests = [];
    services.configureAutoCutNativeHostClient({
      getCapabilities: async () => ({
        mediaImportCommandReady: true,
        videoSliceCommandReady: true,
        speechTranscriptionCommandReady: true,
        speechTranscriptionToolchainReady: true,
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
          text: '先看这个案例的背景 然后它真正爆发的原因是用户痛点很集中 所以这里最适合切成一条完整短视频',
          segments: [
            {
              startMs: 0,
              endMs: 12000,
              text: '先看这个案例的背景',
              speaker: 'Speaker 1',
            },
            {
              startMs: 12000,
              endMs: 26000,
              text: '然后它真正爆发的原因是用户痛点很集中',
              speaker: 'Speaker 1',
            },
            {
              startMs: 26000,
              endMs: 41000,
              text: '所以这里最适合切成一条完整短视频',
              speaker: 'Speaker 1',
            },
          ],
          ffmpegExecutable: 'ffmpeg',
          speechExecutable: 'whisper-cli',
        };
      },
      sliceVideo: async (request) => {
        transcriptCandidateSliceCommands.push({ kind: 'slice', request });
        const output = createNativeTaskOutputArtifact(
          'transcript-candidate-slice-task',
          'transcript-candidate-slice-artifact-1.mp4',
          configuredOutputDirectory,
        );
        const thumbnail = createNativeTaskOutputArtifact(
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
    await services.saveAutoCutSpeechTranscriptionSettings({
      ...(await services.getAutoCutSettings()).speechTranscription,
      executablePath: 'D:/tools/whisper-cli.exe',
      modelPath: 'D:/models/ggml-large-v3-turbo.bin',
      language: 'auto',
    });
    await services.saveAutoCutLlmSettings({
      ...(await services.getAutoCutSettings()).llm,
      apiKey: 'sk-transcript-candidate-plan',
    });
    services.configureAutoCutApprovedAiSdkBridge({
      async createChatCompletion(request, runtime) {
        transcriptCandidateBridgeRequests.push({ request, runtime });
        return {
          id: 'transcript-candidate-plan',
          model: request.model,
          content: JSON.stringify([
            {
              candidateId: 'transcript-2',
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
    const transcriptCandidateSliceSourceFile = new File(['video'], 'transcript-candidate-source.mp4', { type: 'video/mp4' });
    Object.defineProperty(transcriptCandidateSliceSourceFile, 'path', {
      configurable: true,
      value: 'D:/media/transcript-candidate-source.mp4',
    });
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
    const transcriptCandidateSliceRequest = transcriptCandidateSliceCommands.find((entry) => entry.kind === 'slice')?.request;
    const transcriptCandidateTask = readScopedStoredArray(services, 'tasks')
      .find((task) => task.id === 'transcript-candidate-slice-task');
    assertRule(
      transcriptCandidatePrompt?.candidateWindows?.some((candidate) => candidate.id === 'transcript-2'),
      'video slice workflow sends transcript-derived candidate windows to the LLM planner',
    );
    assertEqual(
      transcriptCandidatePrompt?.candidateWindows?.find((candidate) => candidate.id === 'transcript-2')?.subtitleSegmentCount,
      3,
      'video slice workflow sends subtitle segment counts in transcript-derived candidate windows',
    );
    assertEqual(
      transcriptCandidatePrompt?.candidateWindows?.find((candidate) => candidate.id === 'transcript-2')?.transcriptCoverageScore,
      1,
      'video slice workflow sends transcript coverage scores in transcript-derived candidate windows',
    );
    assertEqual(
      transcriptCandidatePrompt?.candidateWindows?.find((candidate) => candidate.id === 'transcript-2')?.speechContinuityGrade,
      'repaired',
      'video slice workflow sends speech continuity grades in transcript-derived candidate windows',
    );
    assertEqual(
      typeof transcriptCandidatePrompt?.candidateWindows?.find((candidate) => candidate.id === 'transcript-2')?.storyShape,
      'string',
      'video slice workflow sends story-shape metadata in transcript-derived candidate windows',
    );
    assertNumberBetween(
      transcriptCandidatePrompt?.candidateWindows?.find((candidate) => candidate.id === 'transcript-2')?.boundaryQualityScore,
      0.65,
      1,
      'video slice workflow sends boundary quality scores in transcript-derived candidate windows',
    );
    assertRule(
      ['strong', 'contextual', 'weak'].includes(transcriptCandidatePrompt?.candidateWindows?.find((candidate) => candidate.id === 'transcript-2')?.hookStrength),
      'video slice workflow sends hook strength grades in transcript-derived candidate windows',
    );
    assertRule(
      ['complete', 'soft', 'open'].includes(transcriptCandidatePrompt?.candidateWindows?.find((candidate) => candidate.id === 'transcript-2')?.endingCompleteness),
      'video slice workflow sends ending completeness grades in transcript-derived candidate windows',
    );
    assertNumberBetween(
      transcriptCandidatePrompt?.candidateWindows?.find((candidate) => candidate.id === 'transcript-2')?.contentArcScore,
      0.65,
      1,
      'video slice workflow sends content-arc scores in transcript-derived candidate windows',
    );
    assertRule(
      ['complete', 'partial', 'thin'].includes(transcriptCandidatePrompt?.candidateWindows?.find((candidate) => candidate.id === 'transcript-2')?.contentArcGrade),
      'video slice workflow sends content-arc grades in transcript-derived candidate windows',
    );
    assertArrayIncludes(
      transcriptCandidatePrompt?.candidateWindows?.find((candidate) => candidate.id === 'transcript-2')?.contentArcStages,
      'payoff',
      'video slice workflow sends detected content-arc stages in transcript-derived candidate windows',
    );
    assertNumberBetween(
      transcriptCandidatePrompt?.candidateWindows?.find((candidate) => candidate.id === 'transcript-2')?.topicCoherenceScore,
      0.65,
      1,
      'video slice workflow sends topic coherence scores in transcript-derived candidate windows',
    );
    assertRule(
      ['strong', 'mixed', 'weak'].includes(transcriptCandidatePrompt?.candidateWindows?.find((candidate) => candidate.id === 'transcript-2')?.topicCoherenceGrade),
      'video slice workflow sends topic coherence grades in transcript-derived candidate windows',
    );
    assertRule(
      typeof transcriptCandidatePrompt?.candidateWindows?.find((candidate) => candidate.id === 'transcript-2')?.topicShiftCount === 'number',
      'video slice workflow sends topic shift counts in transcript-derived candidate windows',
    );
    assertRule(
      Array.isArray(transcriptCandidatePrompt?.candidateWindows?.find((candidate) => candidate.id === 'transcript-2')?.topicKeywords),
      'video slice workflow sends topic keywords in transcript-derived candidate windows',
    );
    assertNumberBetween(
      transcriptCandidatePrompt?.candidateWindows?.find((candidate) => candidate.id === 'transcript-2')?.platformReadinessScore,
      0.65,
      1,
      'video slice workflow sends platform readiness scores in transcript-derived candidate windows',
    );
    assertRule(
      ['ready', 'review', 'reject'].includes(transcriptCandidatePrompt?.candidateWindows?.find((candidate) => candidate.id === 'transcript-2')?.platformReadinessGrade),
      'video slice workflow sends platform readiness grades in transcript-derived candidate windows',
    );
    assertRule(
      Array.isArray(transcriptCandidatePrompt?.candidateWindows?.find((candidate) => candidate.id === 'transcript-2')?.platformReadinessIssues),
      'video slice workflow sends platform readiness issue tags in transcript-derived candidate windows',
    );
    assertNumberBetween(
      transcriptCandidatePrompt?.candidateWindows?.find((candidate) => candidate.id === 'transcript-2')?.sentenceBoundaryIntegrityScore,
      0,
      1,
      'video slice workflow sends sentence boundary integrity scores in transcript-derived candidate windows',
    );
    assertRule(
      ['clean', 'repaired', 'broken'].includes(transcriptCandidatePrompt?.candidateWindows?.find((candidate) => candidate.id === 'transcript-2')?.sentenceBoundaryIntegrityGrade),
      'video slice workflow sends sentence boundary integrity grades in transcript-derived candidate windows',
    );
    assertRule(
      Array.isArray(transcriptCandidatePrompt?.candidateWindows?.find((candidate) => candidate.id === 'transcript-2')?.sentenceBoundaryIssues),
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
      transcriptCandidatePrompt?.candidateWindows?.find((candidate) => candidate.id === 'transcript-2')?.text,
      'video slice workflow records repaired transcript text on slice results',
    );
    assertEqual(
      transcriptCandidateTask?.sliceResults?.[0]?.subtitleSegmentCount,
      3,
      'video slice workflow records repaired subtitle segment counts on slice results',
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
      probeSpeechTranscription: async () => {
        throw new Error('speech transcription probe is not needed inside native extractor text workflow contract');
      },
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
          text: '真实本地转写第一句 真实本地转写第二句',
          segments: [
            {
              startMs: 12000,
              endMs: 22000,
              text: '真实本地转写第一句',
              speaker: 'Speaker 1',
            },
            {
              startMs: 26000,
              endMs: 36000,
              text: '真实本地转写第二句',
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
    await services.saveAutoCutSpeechTranscriptionSettings({
      ...(await services.getAutoCutSettings()).speechTranscription,
      executablePath: 'D:/tools/whisper-cli.exe',
      modelPath: 'D:/models/ggml-large-v3-turbo.bin',
      language: 'auto',
    });
    const nativeExtractorTextSourceFile = new File(['video'], 'native-extractor-text.mp4', { type: 'video/mp4' });
    Object.defineProperty(nativeExtractorTextSourceFile, 'path', {
      configurable: true,
      value: 'D:/media/native-extractor-text.mp4',
    });
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
      '真实本地转写第一句',
      'extractor text native workflow stores the real local speech transcription text',
    );
    assertEqual(
      nativeExtractorTextAsset?.type,
      'doc',
      'extractor text native workflow stores the transcript as a document asset',
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
          slices: request.clips.slice(0, 1).map((clip, index) => {
            const output = createNativeTaskOutputArtifact(
              'native-slice-llm-task',
              `native-slice-llm-artifact-${index + 1}.mp4`,
              configuredOutputDirectory,
            );
            const thumbnail = createNativeTaskOutputArtifact(
              'native-slice-llm-task',
              `native-slice-llm-thumb-${index + 1}.jpg`,
              configuredOutputDirectory,
            );
            return {
              artifactUuid: `native-slice-llm-artifact-${index + 1}`,
              artifactPath: output.artifactPath,
              thumbnailArtifactUuid: `native-slice-llm-thumb-${index + 1}`,
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
    const nativeVideoSliceLlmPlanSourceFile = new File(['video'], 'native-source.mp4', { type: 'video/mp4' });
    Object.defineProperty(nativeVideoSliceLlmPlanSourceFile, 'path', {
      configurable: true,
      value: 'D:/media/native-source.mp4',
    });
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
        enableSubtitles: true,
      }),
    );
    const llmPlanSliceRequest = nativeVideoSliceLlmPlanCommands.find((entry) => entry.kind === 'slice')?.request;
    assertEqual(
      llmPlanSliceRequest?.clips?.length,
      2,
      'video slice LLM workflow without transcript candidates stops filler generation at the imported media duration',
    );
    assertEqual(
      llmPlanSliceRequest?.clips?.[0]?.startMs,
      0,
      'video slice LLM workflow sorts normalized clips by start time',
    );
    assertEqual(
      llmPlanSliceRequest?.clips?.[0]?.durationMs,
      15000,
      'video slice LLM workflow clamps too-short clips to the configured minimum duration',
    );
    assertEqual(
      llmPlanSliceRequest?.clips?.[1]?.durationMs,
      15000,
      'video slice LLM workflow fills safe deterministic gaps before late LLM clips',
    );
    assertEqual(
      llmPlanSliceRequest?.clips?.[1]?.startMs,
      15000,
      'video slice LLM workflow fills safe deterministic gaps before late LLM clips',
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
    const nativeVideoCompressSourceFile = new File(['video'], 'native-source.mp4', { type: 'video/mp4' });
    Object.defineProperty(nativeVideoCompressSourceFile, 'path', {
      configurable: true,
      value: 'D:/media/native-source.mp4',
    });
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
    const nativeVideoConvertSourceFile = new File(['video'], 'native-source.mp4', { type: 'video/mp4' });
    Object.defineProperty(nativeVideoConvertSourceFile, 'path', {
      configurable: true,
      value: 'D:/media/native-source.mp4',
    });
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
    const nativeVideoEnhanceSourceFile = new File(['video'], 'native-source.mp4', { type: 'video/mp4' });
    Object.defineProperty(nativeVideoEnhanceSourceFile, 'path', {
      configurable: true,
      value: 'D:/media/native-source.mp4',
    });
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
    services.configureAutoCutNativeHostClient(services.createAutoCutNativeHostClient(async (command, args) => {
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
    }));
    const settingsEvents = captureEvents(services, 'settingsUpdated');
    const defaultSettings = await services.getAutoCutSettings();
    assertEqual(defaultSettings.llm.modelVendor, 'deepseek', 'AutoCut LLM settings default to DeepSeek');
    assertEqual(defaultSettings.llm.baseUrl, 'https://api.deepseek.com', 'AutoCut LLM settings default to DeepSeek OpenAI-compatible base URL');
    assertEqual(defaultSettings.llm.model, 'deepseek-v4-flash', 'AutoCut LLM settings default to the DeepSeek chat model');
    assertEqual(defaultSettings.llm.maxTokens, 8192, 'AutoCut LLM settings default to the DeepSeek V4 Flash recommended output budget');
    assertEqual(defaultSettings.speechTranscription.executablePath, '', 'AutoCut local speech-to-text executable path defaults to empty');
    assertEqual(defaultSettings.speechTranscription.modelPath, '', 'AutoCut local speech-to-text model path defaults to empty');
    assertEqual(defaultSettings.speechTranscription.language, 'auto', 'AutoCut local speech-to-text language defaults to auto');
    assertEqual(defaultSettings.speechTranscription.configured, false, 'AutoCut local speech-to-text defaults to not configured');
    assertEqual(defaultSettings.workspace.outputDirectory, '', 'AutoCut workspace output directory defaults to empty so the desktop host uses its per-user app-data media root');
    assertEqual(await services.resolveAutoCutOutputRootDir(), undefined, 'resolveAutoCutOutputRootDir does not synthesize a hard-coded OS-specific path before the user configures one');
    const defaultSpeechRuntimeConfig = await services.resolveAutoCutSpeechTranscriptionRuntimeConfig();
    assertEqual(defaultSpeechRuntimeConfig.configured, false, 'resolveAutoCutSpeechTranscriptionRuntimeConfig fails closed before the user configures local speech-to-text');
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
      llmRuntimeConfig,
      speechTranscriptionSettings,
      speechTranscriptionRuntimeConfig,
      speechTranscriptionProbe,
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
        model: 'gpt-5.5',
        maxTokens: 999999,
      });
      const savedLlmOpenAiMiniMaxSettings = await services.saveAutoCutLlmSettings({
        ...savedLlmOpenAiMaxSettings.llm,
        modelVendor: 'openai',
        model: 'gpt-5.4-mini',
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
      const resolvedLlmRuntimeConfig = await services.resolveAutoCutLlmRuntimeConfig();
      const savedSpeechTranscriptionSettings = await services.saveAutoCutSpeechTranscriptionSettings({
        ...initialSettings.speechTranscription,
        executablePath: ' D:/tools/whisper-cli.exe ',
        modelPath: ' D:/models/ggml-large-v3-turbo.bin ',
        language: ' zh ',
      });
      const resolvedSpeechTranscriptionRuntimeConfig = await services.resolveAutoCutSpeechTranscriptionRuntimeConfig();
      const testedSpeechTranscriptionProbe = await services.testAutoCutSpeechTranscriptionToolchain();
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
        llmRuntimeConfig: resolvedLlmRuntimeConfig,
        speechTranscriptionSettings: savedSpeechTranscriptionSettings,
        speechTranscriptionRuntimeConfig: resolvedSpeechTranscriptionRuntimeConfig,
        speechTranscriptionProbe: testedSpeechTranscriptionProbe,
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
    assertEqual(notificationSettings.notifications.usageReports, false, 'saveAutoCutNotificationSettings persists notification edits');
    assertEqual(llmVendorSettings.llm.modelVendor, 'openai', 'saveAutoCutLlmSettings persists the selected ModelVendor');
    assertEqual(llmVendorSettings.llm.baseUrl, 'https://api.openai.com/v1', 'saveAutoCutLlmSettings switches base URL from the selected ModelVendor preset');
    assertEqual(llmVendorSettings.llm.model, 'gpt-5.5', 'saveAutoCutLlmSettings switches default model from the selected ModelVendor preset');
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
    assertEqual(llmOpenAiMaxSettings.llm.maxTokens, 128000, 'saveAutoCutLlmSettings clamps GPT-5.5 output tokens to its model-specific ceiling');
    assertEqual(llmOpenAiMiniMaxSettings.llm.maxTokens, 128000, 'saveAutoCutLlmSettings clamps GPT-5.4 Mini output tokens to its model-specific ceiling');
    assertEqual(llmGeminiMaxSettings.llm.maxTokens, 65536, 'saveAutoCutLlmSettings clamps Gemini 3.1 Pro Preview output tokens to its model-specific ceiling');
    assertEqual(llmGeminiFlashRuntimeSettings.llm.maxTokens, 65536, 'saveAutoCutLlmSettings clamps Gemini 3 Flash Preview output tokens to its model-specific ceiling');
    assertEqual(llmCustomModelSettings.llm.maskedApiKey, 'sk-co*************cret', 'saveAutoCutLlmSettings stores only a masked LLM API key in AppSettings');
    assertEqual(storedSettings.llm.apiKey, undefined, 'settings storage never persists the raw LLM API key');
    assertEqual(storedSettings.llm.sessionApiKey, undefined, 'settings storage never persists transient LLM session API keys');
    assertEqual(llmRuntimeConfig.modelVendor, 'gemini', 'resolveAutoCutLlmRuntimeConfig returns the selected ModelVendor');
    assertEqual(llmRuntimeConfig.baseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai', 'resolveAutoCutLlmRuntimeConfig returns the OpenAI-compatible base URL');
    assertEqual(llmRuntimeConfig.model, 'gemini-3-flash-preview', 'resolveAutoCutLlmRuntimeConfig returns the active model');
    assertEqual(llmRuntimeConfig.maxTokens, 65536, 'resolveAutoCutLlmRuntimeConfig returns the model-specific output budget');
    assertEqual(llmRuntimeConfig.apiKeyConfigured, true, 'resolveAutoCutLlmRuntimeConfig reports configured API key status without exposing the key');
    assertEqual('apiKey' in llmRuntimeConfig, false, 'resolveAutoCutLlmRuntimeConfig does not expose raw API keys to the renderer');
    assertEqual(speechTranscriptionSettings.speechTranscription.executablePath, 'D:/tools/whisper-cli.exe', 'saveAutoCutSpeechTranscriptionSettings trims and persists executablePath');
    assertEqual(speechTranscriptionSettings.speechTranscription.modelPath, 'D:/models/ggml-large-v3-turbo.bin', 'saveAutoCutSpeechTranscriptionSettings trims and persists modelPath');
    assertEqual(speechTranscriptionSettings.speechTranscription.language, 'zh', 'saveAutoCutSpeechTranscriptionSettings trims and persists language');
    assertEqual(speechTranscriptionSettings.speechTranscription.configured, true, 'saveAutoCutSpeechTranscriptionSettings marks the local speech-to-text toolchain as configured');
    assertEqual(storedSettings.speechTranscription.executablePath, 'D:/tools/whisper-cli.exe', 'settings storage persists local speech-to-text executablePath');
    assertEqual(storedSettings.speechTranscription.modelPath, 'D:/models/ggml-large-v3-turbo.bin', 'settings storage persists local speech-to-text modelPath');
    assertEqual(speechTranscriptionRuntimeConfig.configured, true, 'resolveAutoCutSpeechTranscriptionRuntimeConfig reports saved local speech-to-text settings');
    assertEqual(speechTranscriptionRuntimeConfig.executablePath, 'D:/tools/whisper-cli.exe', 'resolveAutoCutSpeechTranscriptionRuntimeConfig returns the saved speech executable path');
    assertEqual(speechTranscriptionRuntimeConfig.modelPath, 'D:/models/ggml-large-v3-turbo.bin', 'resolveAutoCutSpeechTranscriptionRuntimeConfig returns the saved speech model path');
    assertEqual(speechTranscriptionRuntimeConfig.language, 'zh', 'resolveAutoCutSpeechTranscriptionRuntimeConfig returns the saved default speech language');
    assertEqual(speechTranscriptionProbe.ready, true, 'testAutoCutSpeechTranscriptionToolchain reports native probe readiness');
    assertRule(
      settingsNativeSecretCommands.some((entry) => entry.command === 'autocut_probe_speech_transcription' && entry.args?.request?.sourceKind === 'settings'),
      'testAutoCutSpeechTranscriptionToolchain probes the persisted settings-backed local speech-to-text toolchain',
    );
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
        model: 'gpt-5.5',
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
      model: 'gpt-5.5',
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
    assertEqual(devRuntimeAfterRestart.model, 'gpt-5.5', 'dev runtime reloads the selected LLM model after restart');
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
