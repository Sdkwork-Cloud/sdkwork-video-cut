import {
  AUTOCUT_TASK_STATUS,
  AUTOCUT_TASK_TYPE,
  AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD,
  type AppTask,
  type AutoCutTranscriptSegment,
  type TaskSliceResult,
  type TaskStatus,
  type TaskType,
} from '@sdkwork/autocut-types';
import { sortAutoCutRecordsByCreatedAtDesc } from './datetime.service';
import { dispatchAutoCutEvent } from './events.service';
import {
  assertAutoCutNativeArtifactInsideTaskOutputDir,
  assertAutoCutNativeVideoCoverInsideTaskCoverDir,
} from './native-artifact-contract.service';
import { getAutoCutNativeHostClient, type AutoCutNativeTaskSnapshot } from './native-host-client.service';
import { readAutoCutStorage, writeAutoCutStorage } from './storage.service';
import { createAutoCutTaskName } from './task-naming.service';
import { randomDelay } from './timing';

const EMPTY_TASKS: AppTask[] = [];
const EMPTY_DISMISSED_NATIVE_TASK_IDS: string[] = [];
const NATIVE_TASK_LIST_LIMIT = 100;
const {
  maxLeadingSilenceMs: MAX_RECOVERED_SMART_SLICE_LEADING_SILENCE_MS,
  maxTrailingSilenceMs: MAX_RECOVERED_SMART_SLICE_TRAILING_SILENCE_MS,
  minTranscriptCoverageScore: MIN_RECOVERED_SMART_SLICE_TRANSCRIPT_COVERAGE_SCORE,
  acceptedSpeechContinuityGrades: RECOVERED_SMART_SLICE_ACCEPTED_SPEECH_CONTINUITY_GRADES,
} = AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD;
const RECOVERED_SMART_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS = 80;

const OPS_TASK_TYPE_AUDIO_EXTRACTION = 1;
const OPS_TASK_TYPE_VIDEO_GIF = 2;
const OPS_TASK_TYPE_VIDEO_COMPRESS = 3;
const OPS_TASK_TYPE_VIDEO_CONVERT = 4;
const OPS_TASK_TYPE_VIDEO_ENHANCE = 5;
const OPS_TASK_TYPE_VIDEO_SLICE = 6;
const OPS_TASK_TYPE_SPEECH_TRANSCRIPTION = 7;

const OPS_STATUS_PROCESSING = 1;
const OPS_STATUS_COMPLETED = 2;
const OPS_STATUS_FAILED = 3;
const OPS_STATUS_CANCEL_REQUESTED = 4;
const OPS_STATUS_CANCELED = 5;
const OPS_STATUS_INTERRUPTED = 6;

const TASK_TYPE_BY_NATIVE_TYPE: Record<number, TaskType> = {
  [OPS_TASK_TYPE_VIDEO_SLICE]: AUTOCUT_TASK_TYPE.videoSlice,
  [OPS_TASK_TYPE_SPEECH_TRANSCRIPTION]: AUTOCUT_TASK_TYPE.textExtraction,
  [OPS_TASK_TYPE_AUDIO_EXTRACTION]: AUTOCUT_TASK_TYPE.audioExtraction,
  [OPS_TASK_TYPE_VIDEO_GIF]: AUTOCUT_TASK_TYPE.videoGif,
  [OPS_TASK_TYPE_VIDEO_COMPRESS]: AUTOCUT_TASK_TYPE.videoCompress,
  [OPS_TASK_TYPE_VIDEO_CONVERT]: AUTOCUT_TASK_TYPE.videoConvert,
  [OPS_TASK_TYPE_VIDEO_ENHANCE]: AUTOCUT_TASK_TYPE.videoEnhance,
};

const TASK_NAME_BY_NATIVE_TYPE: Record<number, string> = {
  [OPS_TASK_TYPE_VIDEO_SLICE]: 'video-slice.mp4',
  [OPS_TASK_TYPE_SPEECH_TRANSCRIPTION]: 'transcript.json',
  [OPS_TASK_TYPE_AUDIO_EXTRACTION]: 'audio-extraction',
  [OPS_TASK_TYPE_VIDEO_GIF]: 'video-gif.gif',
  [OPS_TASK_TYPE_VIDEO_COMPRESS]: 'video-compress.mp4',
  [OPS_TASK_TYPE_VIDEO_CONVERT]: 'video-convert',
  [OPS_TASK_TYPE_VIDEO_ENHANCE]: 'video-enhance.mp4',
};

type JsonRecord = Record<string, unknown>;

interface NativeTaskProjection {
  status?: TaskStatus;
  errorMessage?: string;
  failureDiagnostics?: string;
  progressMessage?: string;
  completedAt?: string;
  resultCount?: number;
  generatedAssetIds?: string[];
  sliceResults?: TaskSliceResult[];
  sourceFileId?: string;
  extractedText?: NonNullable<AppTask['extractedText']>;
  transcriptText?: string;
  transcriptSegments?: AutoCutTranscriptSegment[];
  transcriptSegmentCount?: number;
  transcriptProviderId?: AppTask['transcriptProviderId'];
  transcriptSourceAssetId?: string;
  audioUrl?: string;
  videoUrl?: string;
  gifUrl?: string;
  fileSizeStats?: NonNullable<AppTask['fileSizeStats']>;
}

interface NativeVideoSliceRecoveryEvidence {
  startMs?: number;
  durationMs?: number;
  sourceStartMs?: number;
  sourceEndMs?: number;
  speechStartMs?: number;
  speechEndMs?: number;
  boundaryPaddingBeforeMs?: number;
  boundaryPaddingAfterMs?: number;
  transcriptText?: string;
  transcriptSegments?: AutoCutTranscriptSegment[];
  transcriptSegmentCount?: number;
  transcriptCoverageScore?: number;
  speechContinuityGrade?: TaskSliceResult['speechContinuityGrade'];
}

interface NativeSpeechTranscriptRecoveryEvidence {
  sourceAssetUuid: string;
  transcriptSegments: AutoCutTranscriptSegment[];
}

export interface AutoCutTaskBulkOperationResult {
  requested: number;
  succeeded: number;
  skipped: number;
  taskIds: string[];
  skippedTaskIds: string[];
}

export interface AutoCutTaskBulkDeleteResult extends AutoCutTaskBulkOperationResult {
  deleted: number;
  deletedTaskIds: string[];
}

export interface AutoCutTaskBulkCancelResult extends AutoCutTaskBulkOperationResult {
  canceled: number;
  canceledTaskIds: string[];
}

export interface AutoCutTaskBulkRetryResult extends AutoCutTaskBulkOperationResult {
  retried: number;
  retriedTaskIds: string[];
  retryTaskIds: string[];
}

interface TaskLookupResult {
  localTasks: AppTask[];
  tasksById: Map<string, AppTask>;
  nativeTaskIds: Set<string>;
  skippedTaskIds: string[];
}

export async function getTasks(): Promise<AppTask[]> {
  await randomDelay(20, 50);
  const nativeTasks = await readNativeTasks();
  if (nativeTasks) {
    return nativeTasks;
  }

  return sortAutoCutRecordsByCreatedAtDesc(readLocalTasks());
}

export async function addTask(task: AppTask): Promise<void> {
  await randomDelay();
  const tasks = readLocalTasks();
  writeAutoCutStorage('tasks', [task, ...tasks]);
  dispatchAutoCutEvent('taskAdded', task);
}

export async function updateTask(taskId: string, updates: Partial<AppTask>): Promise<void> {
  const tasks = readLocalTasks();
  let updatedTask: AppTask | null = null;
  writeAutoCutStorage(
    'tasks',
    tasks.map((task) => {
      if (task.id === taskId) {
        updatedTask = { ...task, ...updates };
        return updatedTask;
      }
      return task;
    }),
  );

  if (updatedTask) {
    dispatchAutoCutEvent('taskUpdated', updatedTask);
  }
}

export async function deleteTask(taskId: string): Promise<void> {
  const tasks = readLocalTasks();
  writeAutoCutStorage(
    'tasks',
    tasks.filter((task) => task.id !== taskId),
  );
  writeAutoCutStorage('dismissedNativeTasks', addDismissedNativeTaskId(taskId));
  dispatchAutoCutEvent('taskDeleted', { id: taskId });
}

export async function deleteTasks(taskIds: string[]): Promise<AutoCutTaskBulkDeleteResult> {
  const requestedTaskIds = taskIds.filter((taskId) => typeof taskId === 'string' && taskId.trim());
  const uniqueTaskIds = [...new Set(requestedTaskIds)];
  const { localTasks, tasksById, skippedTaskIds } = await findTasksByIds(uniqueTaskIds);
  const deletedTaskIds = uniqueTaskIds.filter((taskId) => tasksById.has(taskId));

  if (deletedTaskIds.length > 0) {
    const deletedTaskIdSet = new Set(deletedTaskIds);
    writeAutoCutStorage(
      'tasks',
      localTasks.filter((task) => !deletedTaskIdSet.has(task.id)),
    );
    writeAutoCutStorage('dismissedNativeTasks', addDismissedNativeTaskIds(deletedTaskIds));
    deletedTaskIds.forEach((taskId) => dispatchAutoCutEvent('taskDeleted', { id: taskId }));
  }

  return {
    requested: requestedTaskIds.length,
    succeeded: deletedTaskIds.length,
    skipped: skippedTaskIds.length,
    taskIds: deletedTaskIds,
    skippedTaskIds,
    deleted: deletedTaskIds.length,
    deletedTaskIds,
  };
}

export async function cancelTasks(taskIds: string[]): Promise<AutoCutTaskBulkCancelResult> {
  const requestedTaskIds = taskIds.filter((taskId) => typeof taskId === 'string' && taskId.trim());
  const uniqueTaskIds = [...new Set(requestedTaskIds)];
  const { tasksById, nativeTaskIds, skippedTaskIds: missingTaskIds } = await findTasksByIds(uniqueTaskIds);
  const nativeHostClient = getAutoCutNativeHostClient();
  const capabilities = await nativeHostClient.getCapabilities();
  const canceledTaskIds: string[] = [];
  const skippedTaskIds = [...missingTaskIds];

  if (!capabilities.nativeTaskCancelCommandReady) {
    skippedTaskIds.push(...uniqueTaskIds.filter((taskId) => tasksById.has(taskId)));
  } else {
    for (const taskId of uniqueTaskIds) {
      const task = tasksById.get(taskId);
      if (!task) {
        continue;
      }
      if (!nativeTaskIds.has(taskId) || task.status !== AUTOCUT_TASK_STATUS.processing) {
        skippedTaskIds.push(taskId);
        continue;
      }

      try {
        const result = await nativeHostClient.cancelNativeTask({ taskUuid: taskId });
        if (!result.canceled) {
          skippedTaskIds.push(taskId);
          continue;
        }
        canceledTaskIds.push(taskId);
        dispatchAutoCutEvent('taskUpdated', {
          ...task,
          status: AUTOCUT_TASK_STATUS.processing,
          progressMessage: result.message || 'Cancel requested',
        });
      } catch {
        skippedTaskIds.push(taskId);
      }
    }
  }

  return {
    requested: requestedTaskIds.length,
    succeeded: canceledTaskIds.length,
    skipped: skippedTaskIds.length,
    taskIds: canceledTaskIds,
    skippedTaskIds,
    canceled: canceledTaskIds.length,
    canceledTaskIds,
  };
}

export async function retryTasks(taskIds: string[]): Promise<AutoCutTaskBulkRetryResult> {
  const requestedTaskIds = taskIds.filter((taskId) => typeof taskId === 'string' && taskId.trim());
  const uniqueTaskIds = [...new Set(requestedTaskIds)];
  const { tasksById, nativeTaskIds, skippedTaskIds: missingTaskIds } = await findTasksByIds(uniqueTaskIds);
  const nativeHostClient = getAutoCutNativeHostClient();
  const capabilities = await nativeHostClient.getCapabilities();
  const retriedTaskIds: string[] = [];
  const retryTaskIds: string[] = [];
  const skippedTaskIds = [...missingTaskIds];

  if (!capabilities.nativeTaskRetryCommandReady) {
    skippedTaskIds.push(...uniqueTaskIds.filter((taskId) => tasksById.has(taskId)));
  } else {
    for (const taskId of uniqueTaskIds) {
      const task = tasksById.get(taskId);
      if (!task) {
        continue;
      }
      if (!nativeTaskIds.has(taskId) || task.status !== AUTOCUT_TASK_STATUS.failed) {
        skippedTaskIds.push(taskId);
        continue;
      }

      try {
        const result = await nativeHostClient.retryNativeTask({ taskUuid: taskId });
        if (!result.retried || !result.retryTaskUuid) {
          skippedTaskIds.push(taskId);
          continue;
        }
        retriedTaskIds.push(taskId);
        retryTaskIds.push(result.retryTaskUuid);
        const { errorMessage, failureDiagnostics, completedAt, ...retryTask } = task;
        void errorMessage;
        void failureDiagnostics;
        void completedAt;
        dispatchAutoCutEvent('taskUpdated', {
          ...retryTask,
          id: result.retryTaskUuid,
          status: AUTOCUT_TASK_STATUS.processing,
          progress: 0,
          progressMessage: result.message || 'Retry queued',
        });
      } catch {
        skippedTaskIds.push(taskId);
      }
    }
  }

  return {
    requested: requestedTaskIds.length,
    succeeded: retriedTaskIds.length,
    skipped: skippedTaskIds.length,
    taskIds: retriedTaskIds,
    skippedTaskIds,
    retried: retriedTaskIds.length,
    retriedTaskIds,
    retryTaskIds,
  };
}

function readLocalTasks() {
  return readAutoCutStorage<AppTask[]>('tasks', EMPTY_TASKS);
}

async function findTasksByIds(taskIds: readonly string[]): Promise<TaskLookupResult> {
  const localTasks = readLocalTasks();
  const tasksById = new Map(localTasks.map((task) => [task.id, task]));
  const nativeTaskIds = new Set<string>();
  const missingLocalTaskIds = taskIds.filter((taskId) => !tasksById.has(taskId));

  if (missingLocalTaskIds.length > 0) {
    const nativeSnapshots = await readNativeTaskSnapshotsByIds(missingLocalTaskIds);
    const dismissedNativeTaskIds = new Set(readDismissedNativeTaskIds());
    nativeSnapshots.forEach((snapshot) => {
      if (!dismissedNativeTaskIds.has(snapshot.uuid)) {
        nativeTaskIds.add(snapshot.uuid);
        tasksById.set(snapshot.uuid, mapNativeTaskSnapshotToBulkOperationTask(snapshot));
      }
    });
  }

  return {
    localTasks,
    tasksById,
    nativeTaskIds,
    skippedTaskIds: taskIds.filter((taskId) => !tasksById.has(taskId)),
  };
}

async function readNativeTaskSnapshotsByIds(taskIds: readonly string[]) {
  const nativeHostClient = getAutoCutNativeHostClient();

  try {
    const capabilities = await nativeHostClient.getCapabilities();
    if (!capabilities.nativeTaskQueryCommandReady) {
      return [];
    }

    const snapshots = await Promise.all(
      taskIds.map(async (taskId) => nativeHostClient.listNativeTasks({ taskUuid: taskId, limit: 1 })),
    );
    return snapshots
      .flat()
      .filter((snapshot) => taskIds.includes(snapshot.uuid) && !isNativeSpeechTranscriptionImplementationTask(snapshot));
  } catch {
    return [];
  }
}

function mapNativeTaskSnapshotToBulkOperationTask(snapshot: AutoCutNativeTaskSnapshot): AppTask {
  const progressMessage = resolveNativeTaskProgressMessage(snapshot);
  return {
    id: snapshot.uuid,
    type: TASK_TYPE_BY_NATIVE_TYPE[snapshot.taskType] ?? AUTOCUT_TASK_TYPE.videoSlice,
    name: resolveNativeTaskName(snapshot, parseJsonRecord(snapshot.inputJson), parseJsonRecord(snapshot.outputJson)),
    status: mapNativeStatus(snapshot.status),
    progress: clampProgress(snapshot.progress),
    createdAt: snapshot.createdAt,
    ...(snapshot.errorMessage ? { errorMessage: snapshot.errorMessage } : {}),
    ...(snapshot.sourceAssetUuid ? { sourceFileId: snapshot.sourceAssetUuid } : {}),
    ...(progressMessage ? { progressMessage } : {}),
  };
}

async function readNativeTasks(): Promise<AppTask[] | null> {
  const nativeHostClient = getAutoCutNativeHostClient();

  try {
    const capabilities = await nativeHostClient.getCapabilities();
    if (!capabilities.nativeTaskQueryCommandReady) {
      return null;
    }

    const localTasks = readLocalTasks();
    const dismissedNativeTaskIds = new Set(readDismissedNativeTaskIds());
    const snapshots = await nativeHostClient.listNativeTasks({ limit: NATIVE_TASK_LIST_LIMIT });
    const activeSnapshots = snapshots.filter((snapshot) =>
      !dismissedNativeTaskIds.has(snapshot.uuid) &&
      !isNativeSpeechTranscriptionImplementationTask(snapshot)
    );
    const speechTranscriptEvidenceBySourceAsset = createNativeSpeechTranscriptRecoveryEvidenceBySourceAsset(snapshots);
    const nativeTasks = activeSnapshots.map((snapshot) => {
        const nativeTask = mapNativeTaskSnapshotToAppTask(
          snapshot,
          nativeHostClient.createAssetUrl,
          speechTranscriptEvidenceBySourceAsset,
        );
        const mergedTask = mergeNativeTaskWithLocalSliceMetadata(
          nativeTask,
          findLocalSliceMetadataForNativeTask(nativeTask, snapshot, localTasks),
        );
        return enforceRecoveredNativeVideoSliceProfessionalTranscriptEvidence(mergedTask, snapshot);
      });
    return sortAutoCutRecordsByCreatedAtDesc(mergeLocalAndNativeTasks(localTasks, nativeTasks));
  } catch {
    return null;
  }
}

function mergeLocalAndNativeTasks(
  localTasks: readonly AppTask[],
  nativeTasks: readonly AppTask[],
) {
  const tasksById = new Map<string, AppTask>();
  localTasks.forEach((task) => tasksById.set(task.id, task));
  nativeTasks.forEach((task) => tasksById.set(task.id, task));
  return [...tasksById.values()];
}

function isNativeSpeechTranscriptionImplementationTask(snapshot: AutoCutNativeTaskSnapshot) {
  return snapshot.taskType === OPS_TASK_TYPE_SPEECH_TRANSCRIPTION;
}

function readDismissedNativeTaskIds() {
  return readAutoCutStorage<string[]>('dismissedNativeTasks', EMPTY_DISMISSED_NATIVE_TASK_IDS).filter(
    (taskId) => typeof taskId === 'string' && taskId.trim(),
  );
}

function addDismissedNativeTaskId(taskId: string) {
  return [...new Set([taskId, ...readDismissedNativeTaskIds()])].slice(0, 500);
}

function addDismissedNativeTaskIds(taskIds: string[]) {
  return [...new Set([...taskIds, ...readDismissedNativeTaskIds()])].slice(0, 500);
}

function mapNativeTaskSnapshotToAppTask(
  snapshot: AutoCutNativeTaskSnapshot,
  createAssetUrl: (artifactPath: string) => string,
  speechTranscriptEvidenceBySourceAsset: ReadonlyMap<string, NativeSpeechTranscriptRecoveryEvidence> = new Map(),
): AppTask {
  const input = parseJsonRecord(snapshot.inputJson);
  const output = parseJsonRecord(snapshot.outputJson);
  const taskType = TASK_TYPE_BY_NATIVE_TYPE[snapshot.taskType] ?? AUTOCUT_TASK_TYPE.videoSlice;
  const projection = createNativeTaskProjection(
    snapshot,
    input,
    output,
    createAssetUrl,
    speechTranscriptEvidenceBySourceAsset,
  );
  const status = projection.status ?? mapNativeStatus(snapshot.status);
  const name = resolveNativeTaskName(snapshot, input, output);
  const progressMessage = projection.progressMessage ?? resolveNativeTaskProgressMessage(snapshot);
  const errorMessage = projection.errorMessage ?? snapshot.errorMessage;
  const failureDiagnostics = projection.failureDiagnostics;

  return {
    id: snapshot.uuid,
    type: taskType,
    name,
    status,
    progress: clampProgress(snapshot.progress),
    ...(progressMessage ? { progressMessage } : {}),
    createdAt: snapshot.createdAt,
    ...(projection.completedAt ? { completedAt: projection.completedAt } : {}),
    ...(errorMessage ? { errorMessage } : {}),
    ...(failureDiagnostics ? { failureDiagnostics } : {}),
    ...(projection.resultCount !== undefined ? { resultCount: projection.resultCount } : {}),
    ...(projection.generatedAssetIds ? { generatedAssetIds: projection.generatedAssetIds } : {}),
    ...(projection.sliceResults ? { sliceResults: projection.sliceResults } : {}),
    ...(projection.sourceFileId ? { sourceFileId: projection.sourceFileId } : {}),
    ...(projection.extractedText ? { extractedText: projection.extractedText } : {}),
    ...(projection.transcriptText ? { transcriptText: projection.transcriptText } : {}),
    ...(projection.transcriptSegments?.length ? { transcriptSegments: projection.transcriptSegments } : {}),
    ...(projection.transcriptSegmentCount !== undefined ? { transcriptSegmentCount: projection.transcriptSegmentCount } : {}),
    ...(projection.transcriptProviderId ? { transcriptProviderId: projection.transcriptProviderId } : {}),
    ...(projection.transcriptSourceAssetId ? { transcriptSourceAssetId: projection.transcriptSourceAssetId } : {}),
    ...(projection.audioUrl ? { audioUrl: projection.audioUrl } : {}),
    ...(projection.videoUrl ? { videoUrl: projection.videoUrl } : {}),
    ...(projection.gifUrl ? { gifUrl: projection.gifUrl } : {}),
    ...(projection.fileSizeStats ? { fileSizeStats: projection.fileSizeStats } : {}),
  };
}

function createNativeTaskProjection(
  snapshot: AutoCutNativeTaskSnapshot,
  input: JsonRecord,
  output: JsonRecord,
  createAssetUrl: (artifactPath: string) => string,
  speechTranscriptEvidenceBySourceAsset: ReadonlyMap<string, NativeSpeechTranscriptRecoveryEvidence> = new Map(),
): NativeTaskProjection {
  const baseProjection: NativeTaskProjection = {
    ...(snapshot.sourceAssetUuid ? { sourceFileId: snapshot.sourceAssetUuid } : {}),
    ...(snapshot.status === OPS_STATUS_COMPLETED ? { completedAt: snapshot.updatedAt } : {}),
  };

  if (snapshot.taskType === OPS_TASK_TYPE_VIDEO_SLICE) {
    return createNativeVideoSliceProjection(
      snapshot,
      input,
      output,
      baseProjection,
      createAssetUrl,
      speechTranscriptEvidenceBySourceAsset,
    );
  }

  if (snapshot.taskType === OPS_TASK_TYPE_SPEECH_TRANSCRIPTION) {
    return createNativeSpeechTranscriptionProjection(snapshot, input, output, baseProjection);
  }

  const artifactUuid = readString(output.artifactUuid);
  const artifactPath = readString(output.artifactPath);
  const transcriptPath = readString(output.transcriptPath);
  if (artifactPath) {
    assertNativeOutputArtifactPathInsideTaskOutputDir(output, artifactPath);
  }
  if (transcriptPath) {
    assertNativeOutputArtifactPathInsideTaskOutputDir(output, transcriptPath);
  }
  const assetUrl = artifactPath ? optionalCreateNativeAssetUrl(artifactPath, createAssetUrl) : undefined;
  const transcriptUrl = transcriptPath ? optionalCreateNativeAssetUrl(transcriptPath, createAssetUrl) : undefined;
  const generatedAssetIds = artifactUuid ? [artifactUuid] : undefined;

  if (snapshot.taskType === OPS_TASK_TYPE_AUDIO_EXTRACTION) {
    return {
      ...baseProjection,
      ...(generatedAssetIds ? { generatedAssetIds } : {}),
      ...(assetUrl ? { audioUrl: assetUrl } : {}),
      ...(generatedAssetIds ? { resultCount: generatedAssetIds.length } : {}),
    };
  }

  if (snapshot.taskType === OPS_TASK_TYPE_VIDEO_GIF) {
    return {
      ...baseProjection,
      ...(generatedAssetIds ? { generatedAssetIds } : {}),
      ...(assetUrl ? { gifUrl: assetUrl } : {}),
      ...(generatedAssetIds ? { resultCount: generatedAssetIds.length } : {}),
    };
  }

  if (snapshot.taskType === OPS_TASK_TYPE_VIDEO_COMPRESS) {
    const newSize = readNumber(output.byteSize);
    const originalSize = readNumber(output.originalByteSize) ?? readNativeCompletedEventNumber(snapshot, 'originalByteSize');
    return {
      ...baseProjection,
      ...(generatedAssetIds ? { generatedAssetIds } : {}),
      ...(assetUrl ? { videoUrl: assetUrl } : {}),
      ...(generatedAssetIds ? { resultCount: generatedAssetIds.length } : {}),
      ...(newSize !== undefined && originalSize !== undefined
        ? { fileSizeStats: createFileSizeStats(originalSize, newSize) }
        : {}),
    };
  }

  if (snapshot.taskType === OPS_TASK_TYPE_VIDEO_CONVERT || snapshot.taskType === OPS_TASK_TYPE_VIDEO_ENHANCE) {
    return {
      ...baseProjection,
      ...(generatedAssetIds ? { generatedAssetIds } : {}),
      ...(assetUrl ? { videoUrl: assetUrl } : {}),
      ...(generatedAssetIds ? { resultCount: generatedAssetIds.length } : {}),
    };
  }

  if (snapshot.taskType === OPS_TASK_TYPE_SPEECH_TRANSCRIPTION && transcriptUrl) {
    return {
      ...baseProjection,
      ...(generatedAssetIds ? { generatedAssetIds } : {}),
      videoUrl: transcriptUrl,
      ...(generatedAssetIds ? { resultCount: generatedAssetIds.length } : {}),
    };
  }

  return baseProjection;
}

function createNativeVideoSliceProjection(
  snapshot: AutoCutNativeTaskSnapshot,
  input: JsonRecord,
  output: JsonRecord,
  baseProjection: NativeTaskProjection,
  createAssetUrl: (artifactPath: string) => string,
  speechTranscriptEvidenceBySourceAsset: ReadonlyMap<string, NativeSpeechTranscriptRecoveryEvidence>,
): NativeTaskProjection {
  if (snapshot.status !== OPS_STATUS_COMPLETED) {
    return baseProjection;
  }

  const rawSlices = readArray(output.sliceResults);
  const sliceResults: TaskSliceResult[] = [];
  const inputClipRecoveryEvidence = readNativeVideoSliceInputClipRecoveryEvidence(input);
  const siblingSpeechTranscriptEvidence = snapshot.sourceAssetUuid
    ? speechTranscriptEvidenceBySourceAsset.get(snapshot.sourceAssetUuid)
    : undefined;

  try {
    const declaredSliceCount = assertPositiveNativeSliceCount(output.sliceCount);
    if (rawSlices.length !== declaredSliceCount) {
      throw new Error(
        `AutoCut native video slicing returned ${rawSlices.length} slice artifacts for ${declaredSliceCount} declared slices.`,
      );
    }

    rawSlices.forEach((slice, index) => {
      const nativeSlice = assertAndMapNativeSliceResult(slice, index, createAssetUrl);
      const inputRecoveryEvidence = findNativeVideoSliceInputClipRecoveryEvidence(
        nativeSlice,
        inputClipRecoveryEvidence,
        index,
        rawSlices.length,
      );
      const nativeSliceWithInputEvidence = mergeNativeSliceWithRecoveryEvidence(nativeSlice, inputRecoveryEvidence);
      const siblingSpeechEvidence = createNativeVideoSliceRecoveryEvidenceFromSpeechTranscript(
        nativeSliceWithInputEvidence,
        siblingSpeechTranscriptEvidence,
      );
      sliceResults.push(mergeNativeSliceWithRecoveryEvidence(nativeSliceWithInputEvidence, siblingSpeechEvidence));
    });
    return {
      ...baseProjection,
      resultCount: declaredSliceCount,
      generatedAssetIds: sliceResults.map((slice) => slice.id),
      sliceResults,
    };
  } catch (error) {
    return createInvalidNativeVideoSliceProjection(error, baseProjection, snapshot);
  }
}

function createInvalidNativeVideoSliceProjection(
  error: unknown,
  baseProjection: NativeTaskProjection,
  snapshot?: AutoCutNativeTaskSnapshot,
): NativeTaskProjection {
  const message = error instanceof Error ? error.message : 'AutoCut native video slicing output is invalid.';
  return {
    ...(baseProjection.sourceFileId ? { sourceFileId: baseProjection.sourceFileId } : {}),
    status: AUTOCUT_TASK_STATUS.failed,
    errorMessage: message,
    failureDiagnostics: createRecoveredNativeVideoSliceDebugDiagnostics(error, {
      id: snapshot?.uuid ?? 'native-video-slice-recovery',
      type: AUTOCUT_TASK_TYPE.videoSlice,
      name: TASK_NAME_BY_NATIVE_TYPE[OPS_TASK_TYPE_VIDEO_SLICE] ?? 'video-slice.mp4',
      status: AUTOCUT_TASK_STATUS.failed,
      progress: snapshot?.progress ?? 0,
      createdAt: snapshot?.createdAt ?? '',
      ...(baseProjection.sourceFileId ? { sourceFileId: baseProjection.sourceFileId } : {}),
    }, snapshot),
    progressMessage: 'Task failed',
  };
}

function createNativeSpeechTranscriptionProjection(
  snapshot: AutoCutNativeTaskSnapshot,
  input: JsonRecord,
  output: JsonRecord,
  baseProjection: NativeTaskProjection,
): NativeTaskProjection {
  const rawSegments = readArray(output.segments);
  const transcriptSegments = rawSegments
    .map(mapNativeSpeechTranscriptSegment)
    .filter((segment): segment is AutoCutTranscriptSegment => Boolean(segment));
  const extractedText = transcriptSegments.map((segment) => mapNativeSpeechTranscriptSegmentToExtractedText(segment));
  const artifactUuid = readString(output.artifactUuid);
  const transcriptText = readString(output.text)?.trim() || createRecoveredNativeVideoSliceTranscriptText(transcriptSegments);
  const transcriptSegmentCount = readNumber(output.segmentCount) ?? transcriptSegments.length;
  const transcriptProviderId = readString(output.providerId) ?? readString(input.providerId);
  const transcriptSourceAssetId = readString(output.sourceAssetUuid) ?? readString(output.assetUuid) ?? snapshot.sourceAssetUuid;

  try {
    if (snapshot.status === OPS_STATUS_COMPLETED) {
      assertNativeSpeechTranscriptionProjectionEvidence({
        transcriptText,
        transcriptSegments,
        transcriptSegmentCount,
      });
    }

    return {
      ...baseProjection,
      resultCount: transcriptSegmentCount || extractedText.length,
      ...(artifactUuid ? { generatedAssetIds: [artifactUuid] } : {}),
      extractedText,
      ...(transcriptText ? { transcriptText } : {}),
      ...(transcriptSegments.length ? { transcriptSegments } : {}),
      ...(transcriptSegmentCount !== undefined ? { transcriptSegmentCount } : {}),
      ...(transcriptProviderId ? { transcriptProviderId } : {}),
      ...(transcriptSourceAssetId ? { transcriptSourceAssetId } : {}),
    };
  } catch (error) {
    return createInvalidNativeSpeechTranscriptionProjection(error, baseProjection);
  }
}

function assertNativeSpeechTranscriptionProjectionEvidence(evidence: {
  transcriptText: string;
  transcriptSegments: readonly AutoCutTranscriptSegment[];
  transcriptSegmentCount: number;
}) {
  if (!evidence.transcriptText.trim() || evidence.transcriptSegments.length === 0) {
    throw new Error('AutoCut recovered native speech transcription task is missing speech-to-text transcript evidence.');
  }

  if (evidence.transcriptSegmentCount !== evidence.transcriptSegments.length) {
    throw new Error('AutoCut recovered native speech transcription task transcriptSegmentCount does not match transcriptSegments.');
  }

  if (
    normalizeRecoveredNativeVideoSliceTranscriptText(evidence.transcriptText) !==
    createRecoveredNativeVideoSliceTranscriptText(evidence.transcriptSegments)
  ) {
    throw new Error('AutoCut recovered native speech transcription task transcriptText does not match transcriptSegments.');
  }
}

function createInvalidNativeSpeechTranscriptionProjection(
  error: unknown,
  baseProjection: NativeTaskProjection,
): NativeTaskProjection {
  const message = error instanceof Error ? error.message : 'AutoCut native speech transcription output is invalid.';
  return {
    ...(baseProjection.sourceFileId ? { sourceFileId: baseProjection.sourceFileId } : {}),
    status: AUTOCUT_TASK_STATUS.failed,
    errorMessage: message,
    progressMessage: 'Task failed',
  };
}

function assertPositiveNativeSliceCount(value: unknown) {
  const sliceCount = readNumber(value);
  if (sliceCount === undefined || !Number.isInteger(sliceCount) || sliceCount <= 0) {
    throw new Error('AutoCut native video slicing has invalid sliceCount.');
  }
  return sliceCount;
}

function mapNativeStatus(status: number): TaskStatus {
  if (status === OPS_STATUS_COMPLETED) {
    return AUTOCUT_TASK_STATUS.completed;
  }

  if (status === OPS_STATUS_FAILED || status === OPS_STATUS_CANCELED || status === OPS_STATUS_INTERRUPTED) {
    return AUTOCUT_TASK_STATUS.failed;
  }

  if (status === OPS_STATUS_PROCESSING || status === OPS_STATUS_CANCEL_REQUESTED) {
    return AUTOCUT_TASK_STATUS.processing;
  }

  return AUTOCUT_TASK_STATUS.pending;
}

function resolveNativeTaskName(snapshot: AutoCutNativeTaskSnapshot, input: JsonRecord, output: JsonRecord) {
  const namedValues = [
    readString(input.name),
    readString(input.sourceName),
    readString(input.fileName),
    readString(output.name),
  ];
  const namedValue = namedValues.find(Boolean);
  if (namedValue) {
    return createAutoCutTaskName({
      sourceName: namedValue,
      createdAt: snapshot.createdAt,
    });
  }

  const artifactPath = readString(output.artifactPath)
    ?? readString(output.transcriptPath)
    ?? readArray(output.sliceResults)
      .map((slice) => readRecord(slice))
      .map((slice) => readString(slice?.artifactPath))
      .find(Boolean);
  const artifactFileName = artifactPath ? readPathFileName(artifactPath) : undefined;
  if (artifactFileName) {
    return createAutoCutTaskName({
      sourceName: artifactFileName,
      createdAt: snapshot.createdAt,
    });
  }

  return createAutoCutTaskName({
    sourceName: `${TASK_NAME_BY_NATIVE_TYPE[snapshot.taskType] ?? 'native-task'}-${snapshot.uuid.slice(0, 8)}`,
    createdAt: snapshot.createdAt,
  });
}

function resolveNativeTaskProgressMessage(snapshot: AutoCutNativeTaskSnapshot) {
  const latestProgressEvent = [...snapshot.events]
    .reverse()
    .map((event) => event.payload)
    .map(readRecord)
    .find((payload) => payload && readNumber(payload.progress) !== undefined);

  if (latestProgressEvent) {
    const phase = readString(latestProgressEvent.phase);
    const operation = readString(latestProgressEvent.operation);
    if (phase && operation) {
      return `${operation}: ${phase}`;
    }
    return phase ?? operation;
  }

  if (snapshot.status === OPS_STATUS_COMPLETED) {
    return 'Task completed';
  }
  if (snapshot.status === OPS_STATUS_FAILED) {
    return 'Task failed';
  }
  if (snapshot.status === OPS_STATUS_CANCELED) {
    return 'Task canceled';
  }
  if (snapshot.status === OPS_STATUS_INTERRUPTED) {
    return 'Task interrupted';
  }
  if (snapshot.status === OPS_STATUS_CANCEL_REQUESTED) {
    return 'Cancel requested';
  }
  return 'Task processing';
}

function assertAndMapNativeSliceResult(
  value: unknown,
  index: number,
  createAssetUrl: (artifactPath: string) => string,
): TaskSliceResult {
  const sliceNumber = index + 1;
  const slice = readRecord(value);
  if (!slice) {
    throw new Error(`AutoCut native video slicing slice artifact ${sliceNumber} is invalid.`);
  }

  const artifactUuid = assertRequiredNativeSliceText(slice.artifactUuid, sliceNumber, 'artifactUuid');
  const artifactPath = assertRequiredNativeSliceText(slice.artifactPath, sliceNumber, 'artifactPath');
  assertRequiredNativeSliceText(slice.thumbnailArtifactUuid, sliceNumber, 'thumbnailArtifactUuid');
  const thumbnailPath = assertRequiredNativeSliceText(slice.thumbnailArtifactPath, sliceNumber, 'thumbnailArtifactPath');
  const taskOutputDir = assertRequiredNativeSliceText(slice.taskOutputDir, sliceNumber, 'taskOutputDir');
  assertNativeSlicePathInsideTaskOutputDir(artifactPath, taskOutputDir, sliceNumber, 'artifactPath');
  assertNativeSliceThumbnailPathInsideCoverDir(thumbnailPath, taskOutputDir, sliceNumber);
  const byteSize = assertPositiveNativeSliceNumber(slice.byteSize, sliceNumber, 'byteSize');
  assertPositiveNativeSliceNumber(slice.thumbnailByteSize, sliceNumber, 'thumbnailByteSize');
  const startMs = assertNonNegativeNativeSliceNumber(slice.startMs, sliceNumber, 'startMs');
  const durationMs = assertPositiveNativeSliceNumber(slice.durationMs, sliceNumber, 'durationMs');
  const sourceStartMs = readNumber(slice.sourceStartMs) ?? startMs;
  const sourceEndMs = readNumber(slice.sourceEndMs) ?? startMs + durationMs;
  const speechStartMs = readNumber(slice.speechStartMs);
  const speechEndMs = readNumber(slice.speechEndMs);
  const transcriptSegments = readArray(slice.transcriptSegments)
    .map((segment, segmentIndex) => assertAndMapNativeTranscriptSegment(segment, sliceNumber, segmentIndex + 1));
  const inferredSpeechStartMs = transcriptSegments[0]?.startMs;
  const inferredSpeechEndMs = transcriptSegments.at(-1)?.endMs;
  const recoveredSpeechStartMs = speechStartMs ?? inferredSpeechStartMs;
  const recoveredSpeechEndMs = speechEndMs ?? inferredSpeechEndMs;
  const boundaryPaddingBeforeMs = readNumber(slice.boundaryPaddingBeforeMs) ??
    (recoveredSpeechStartMs !== undefined ? recoveredSpeechStartMs - sourceStartMs : undefined);
  const boundaryPaddingAfterMs = readNumber(slice.boundaryPaddingAfterMs) ??
    (recoveredSpeechEndMs !== undefined ? sourceEndMs - recoveredSpeechEndMs : undefined);
  const transcriptText = readString(slice.transcriptText)?.trim() ??
    createRecoveredNativeVideoSliceTranscriptText(transcriptSegments);
  const transcriptSegmentCount = readNumber(slice.transcriptSegmentCount) ??
    (transcriptSegments.length ? transcriptSegments.length : undefined);
  const transcriptCoverageScore = readNumber(slice.transcriptCoverageScore);
  const speechContinuityGrade = readSpeechContinuityGrade(slice.speechContinuityGrade);
  const subtitlePath = readString(slice.subtitleArtifactPath);
  if (subtitlePath) {
    assertNativeSlicePathInsideTaskOutputDir(subtitlePath, taskOutputDir, sliceNumber, 'subtitleArtifactPath');
  }
  const label = readString(slice.label) ?? `Slice ${index + 1}`;
  const format = readString(slice.format) ?? 'mp4';
  const subtitleFormat = readString(slice.subtitleFormat);

  return {
    id: artifactUuid,
    name: `${label}.${format}`,
    duration: Math.max(1, Math.round(durationMs / 1_000)),
    size: byteSize,
    resolution: '1080P',
    thumbnailUrl: assertNativeAssetUrl(thumbnailPath, createAssetUrl, sliceNumber, 'thumbnailArtifactPath'),
    url: assertNativeAssetUrl(artifactPath, createAssetUrl, sliceNumber, 'artifactPath'),
    artifactPath,
    taskOutputDir,
    ...(subtitlePath
      ? { subtitleUrl: assertNativeAssetUrl(subtitlePath, createAssetUrl, sliceNumber, 'subtitleArtifactPath') }
      : {}),
    ...(subtitleFormat ? { subtitleFormat } : {}),
    sourceStartMs,
    sourceEndMs,
    ...(recoveredSpeechStartMs !== undefined ? { speechStartMs: recoveredSpeechStartMs } : {}),
    ...(recoveredSpeechEndMs !== undefined ? { speechEndMs: recoveredSpeechEndMs } : {}),
    ...(boundaryPaddingBeforeMs !== undefined ? { boundaryPaddingBeforeMs } : {}),
    ...(boundaryPaddingAfterMs !== undefined ? { boundaryPaddingAfterMs } : {}),
    ...(transcriptText ? { transcriptText } : {}),
    ...(transcriptSegments.length ? { transcriptSegments } : {}),
    ...(transcriptSegmentCount !== undefined ? { transcriptSegmentCount } : {}),
    ...(transcriptCoverageScore !== undefined ? { transcriptCoverageScore } : {}),
    ...(speechContinuityGrade ? { speechContinuityGrade } : {}),
  };
}

function assertAndMapNativeTranscriptSegment(
  value: unknown,
  sliceNumber: number,
  segmentNumber: number,
): AutoCutTranscriptSegment {
  const segment = readRecord(value);
  if (!segment) {
    throw new Error(
      `AutoCut native video slicing slice artifact ${sliceNumber} transcript segment ${segmentNumber} is invalid.`,
    );
  }

  const startMs = readNumber(segment.startMs);
  const endMs = readNumber(segment.endMs);
  const text = readString(segment.text)?.trim().replace(/\s+/gu, ' ');
  if (startMs === undefined || endMs === undefined || !text) {
    throw new Error(
      `AutoCut native video slicing slice artifact ${sliceNumber} transcript segment ${segmentNumber} is incomplete.`,
    );
  }
  const speaker = readString(segment.speaker)?.trim();

  return {
    startMs: Math.round(startMs),
    endMs: Math.round(endMs),
    text,
    ...(speaker ? { speaker } : {}),
  };
}

function createRecoveredNativeVideoSliceTranscriptText(transcriptSegments: readonly AutoCutTranscriptSegment[]) {
  return transcriptSegments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function normalizeRecoveredNativeVideoSliceTranscriptText(value: string | undefined) {
  return value?.trim().replace(/\s+/gu, ' ') ?? '';
}

function readSpeechContinuityGrade(value: unknown): TaskSliceResult['speechContinuityGrade'] | undefined {
  const grade = readString(value);
  if (grade === 'strong' || grade === 'repaired' || grade === 'weak') {
    return grade;
  }

  return undefined;
}

function assertRequiredNativeSliceText(value: unknown, sliceNumber: number, fieldName: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`AutoCut native video slicing slice artifact ${sliceNumber} is missing ${fieldName}.`);
  }
  return value;
}

function assertPositiveNativeSliceNumber(value: unknown, sliceNumber: number, fieldName: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`AutoCut native video slicing slice artifact ${sliceNumber} has invalid ${fieldName}.`);
  }
  return value;
}

function assertNonNegativeNativeSliceNumber(value: unknown, sliceNumber: number, fieldName: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`AutoCut native video slicing slice artifact ${sliceNumber} has invalid ${fieldName}.`);
  }
  return value;
}

function assertNativeSlicePathInsideTaskOutputDir(
  artifactPath: string,
  taskOutputDir: string,
  sliceNumber: number,
  fieldName: string,
) {
  try {
    assertAutoCutNativeArtifactInsideTaskOutputDir({ artifactPath, taskOutputDir }, `slice artifact ${sliceNumber}`);
  } catch {
    throw new Error(
      `AutoCut native video slicing slice artifact ${sliceNumber} ${fieldName} is outside its task output directory.`,
    );
  }
}

function assertNativeSliceThumbnailPathInsideCoverDir(
  artifactPath: string,
  taskOutputDir: string,
  sliceNumber: number,
) {
  try {
    assertAutoCutNativeVideoCoverInsideTaskCoverDir({ artifactPath, taskOutputDir }, `slice artifact ${sliceNumber}`);
  } catch (error) {
    if (error instanceof Error && error.message.includes('task output directory')) {
      throw new Error(
        `AutoCut native video slicing slice artifact ${sliceNumber} thumbnailArtifactPath is outside its task output directory.`,
      );
    }
    throw new Error(
      `AutoCut native video slicing slice artifact ${sliceNumber} thumbnailArtifactPath is outside its task cover directory.`,
    );
  }
}

function assertNativeOutputArtifactPathInsideTaskOutputDir(output: JsonRecord, artifactPath: string) {
  const taskOutputDir = readString(output.taskOutputDir);
  assertAutoCutNativeArtifactInsideTaskOutputDir(
    {
      artifactPath,
      taskOutputDir: taskOutputDir ?? '',
    },
    'task output',
  );
}

function createNativeSpeechTranscriptRecoveryEvidenceBySourceAsset(
  snapshots: readonly AutoCutNativeTaskSnapshot[],
) {
  const evidenceBySourceAsset = new Map<string, NativeSpeechTranscriptRecoveryEvidence>();
  for (const snapshot of snapshots) {
    if (
      snapshot.taskType !== OPS_TASK_TYPE_SPEECH_TRANSCRIPTION ||
      snapshot.status !== OPS_STATUS_COMPLETED ||
      !snapshot.sourceAssetUuid
    ) {
      continue;
    }

    const output = parseJsonRecord(snapshot.outputJson);
    const transcriptSegments = readArray(output.segments)
      .map(mapNativeVideoSliceInputTranscriptSegment)
      .filter((segment): segment is AutoCutTranscriptSegment => Boolean(segment));
    if (transcriptSegments.length === 0) {
      continue;
    }

    evidenceBySourceAsset.set(snapshot.sourceAssetUuid, {
      sourceAssetUuid: snapshot.sourceAssetUuid,
      transcriptSegments: sortRecoveredNativeTranscriptSegments(transcriptSegments),
    });
  }

  return evidenceBySourceAsset;
}

function createNativeVideoSliceRecoveryEvidenceFromSpeechTranscript(
  nativeSlice: TaskSliceResult,
  speechTranscriptEvidence: NativeSpeechTranscriptRecoveryEvidence | undefined,
): NativeVideoSliceRecoveryEvidence | undefined {
  if (!speechTranscriptEvidence?.transcriptSegments.length) {
    return undefined;
  }

  const sourceStartMs = nativeSlice.sourceStartMs ?? 0;
  const fallbackSourceEndMs = sourceStartMs + nativeSlice.duration * 1_000;
  const sourceEndMs = nativeSlice.sourceEndMs ?? fallbackSourceEndMs;
  if (!Number.isFinite(sourceStartMs) || !Number.isFinite(sourceEndMs) || sourceEndMs <= sourceStartMs) {
    return undefined;
  }

  const transcriptSegments = speechTranscriptEvidence.transcriptSegments
    .filter((segment) =>
      segment.endMs > sourceStartMs &&
      segment.startMs < sourceEndMs &&
      segment.text.trim().length > 0
    )
    .map((segment) => ({
      startMs: Math.max(sourceStartMs, Math.round(segment.startMs)),
      endMs: Math.min(sourceEndMs, Math.round(segment.endMs)),
      text: segment.text.trim().replace(/\s+/gu, ' '),
      ...(segment.speaker?.trim() ? { speaker: segment.speaker.trim() } : {}),
    }))
    .filter((segment) => segment.endMs > segment.startMs && segment.text.length > 0);
  const sortedTranscriptSegments = sortRecoveredNativeTranscriptSegments(transcriptSegments);
  if (sortedTranscriptSegments.length === 0) {
    return undefined;
  }

  const speechStartMs = sortedTranscriptSegments[0]?.startMs;
  const speechEndMs = sortedTranscriptSegments.at(-1)?.endMs;
  if (speechStartMs === undefined || speechEndMs === undefined || speechEndMs <= speechStartMs) {
    return undefined;
  }

  return {
    sourceStartMs,
    sourceEndMs,
    speechStartMs,
    speechEndMs,
    boundaryPaddingBeforeMs: speechStartMs - sourceStartMs,
    boundaryPaddingAfterMs: sourceEndMs - speechEndMs,
    transcriptText: createRecoveredNativeVideoSliceTranscriptText(sortedTranscriptSegments),
    transcriptSegments: sortedTranscriptSegments,
    transcriptSegmentCount: sortedTranscriptSegments.length,
    transcriptCoverageScore: calculateRecoveredNativeTranscriptCoverageScore(
      sortedTranscriptSegments,
      speechStartMs,
      speechEndMs,
    ),
    speechContinuityGrade: calculateRecoveredNativeSpeechContinuityGrade(sortedTranscriptSegments),
  };
}

function sortRecoveredNativeTranscriptSegments(
  transcriptSegments: readonly AutoCutTranscriptSegment[],
): AutoCutTranscriptSegment[] {
  return [...transcriptSegments].sort((firstSegment, secondSegment) =>
    firstSegment.startMs - secondSegment.startMs ||
    firstSegment.endMs - secondSegment.endMs,
  );
}

function calculateRecoveredNativeTranscriptCoverageScore(
  transcriptSegments: readonly AutoCutTranscriptSegment[],
  speechStartMs: number,
  speechEndMs: number,
) {
  const speechDurationMs = Math.max(1, speechEndMs - speechStartMs);
  const transcriptDurationMs = transcriptSegments.reduce(
    (totalDurationMs, segment) => totalDurationMs + Math.max(0, segment.endMs - segment.startMs),
    0,
  );
  return Math.min(1, transcriptDurationMs / speechDurationMs);
}

function calculateRecoveredNativeSpeechContinuityGrade(
  transcriptSegments: readonly AutoCutTranscriptSegment[],
): TaskSliceResult['speechContinuityGrade'] {
  let maxGapMs = 0;
  for (let index = 1; index < transcriptSegments.length; index += 1) {
    const currentSegment = transcriptSegments[index];
    const previousSegment = transcriptSegments[index - 1];
    if (!currentSegment || !previousSegment) {
      continue;
    }

    maxGapMs = Math.max(0, currentSegment.startMs - previousSegment.endMs, maxGapMs);
  }

  return maxGapMs <= 1_500 ? 'strong' : 'repaired';
}

function readNativeVideoSliceInputClipRecoveryEvidence(input: JsonRecord): NativeVideoSliceRecoveryEvidence[] {
  const clips = readArray(input.clips);
  const requestedClips = readArray(input.requestedClips);
  const evidenceSource = clips.length ? clips : requestedClips;
  return evidenceSource
    .map(mapNativeVideoSliceInputClipRecoveryEvidence)
    .filter((evidence): evidence is NativeVideoSliceRecoveryEvidence => Boolean(evidence));
}

function mapNativeVideoSliceInputClipRecoveryEvidence(value: unknown): NativeVideoSliceRecoveryEvidence | null {
  const clip = readRecord(value);
  if (!clip) {
    return null;
  }

  const startMs = readNumber(clip.startMs);
  const durationMs = readNumber(clip.durationMs);
  const sourceStartMs = readNumber(clip.sourceStartMs) ?? startMs;
  const sourceEndMs = readNumber(clip.sourceEndMs) ??
    (startMs !== undefined && durationMs !== undefined ? startMs + durationMs : undefined);
  const speechStartMs = readNumber(clip.speechStartMs);
  const speechEndMs = readNumber(clip.speechEndMs);
  const transcriptSegments = readArray(clip.transcriptSegments)
    .map(mapNativeVideoSliceInputTranscriptSegment)
    .filter((segment): segment is AutoCutTranscriptSegment => Boolean(segment));
  const transcriptText = readString(clip.transcriptText)?.trim() ??
    createRecoveredNativeVideoSliceTranscriptText(transcriptSegments);
  const transcriptSegmentCount = readNumber(clip.transcriptSegmentCount) ??
    (transcriptSegments.length ? transcriptSegments.length : undefined);
  const transcriptCoverageScore = readNumber(clip.transcriptCoverageScore);
  const speechContinuityGrade = readSpeechContinuityGrade(clip.speechContinuityGrade);
  const boundaryPaddingBeforeMs = readNumber(clip.boundaryPaddingBeforeMs);
  const boundaryPaddingAfterMs = readNumber(clip.boundaryPaddingAfterMs);

  return {
    ...(startMs !== undefined ? { startMs } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(sourceStartMs !== undefined ? { sourceStartMs } : {}),
    ...(sourceEndMs !== undefined ? { sourceEndMs } : {}),
    ...(speechStartMs !== undefined ? { speechStartMs } : {}),
    ...(speechEndMs !== undefined ? { speechEndMs } : {}),
    ...(boundaryPaddingBeforeMs !== undefined ? { boundaryPaddingBeforeMs } : {}),
    ...(boundaryPaddingAfterMs !== undefined ? { boundaryPaddingAfterMs } : {}),
    ...(transcriptText ? { transcriptText } : {}),
    ...(transcriptSegments.length ? { transcriptSegments } : {}),
    ...(transcriptSegmentCount !== undefined ? { transcriptSegmentCount } : {}),
    ...(transcriptCoverageScore !== undefined ? { transcriptCoverageScore } : {}),
    ...(speechContinuityGrade ? { speechContinuityGrade } : {}),
  };
}

function mapNativeVideoSliceInputTranscriptSegment(value: unknown): AutoCutTranscriptSegment | null {
  const segment = readRecord(value);
  if (!segment) {
    return null;
  }

  const startMs = readNumber(segment.startMs);
  const endMs = readNumber(segment.endMs);
  const text = readString(segment.text)?.trim().replace(/\s+/gu, ' ');
  if (startMs === undefined || endMs === undefined || endMs <= startMs || !text) {
    return null;
  }

  const speaker = readString(segment.speaker)?.trim();
  return {
    startMs: Math.round(startMs),
    endMs: Math.round(endMs),
    text,
    ...(speaker ? { speaker } : {}),
  };
}

function findNativeVideoSliceInputClipRecoveryEvidence(
  nativeSlice: TaskSliceResult,
  evidence: readonly NativeVideoSliceRecoveryEvidence[],
  index: number,
  nativeSliceCount: number,
) {
  const matchingEvidence = evidence.find((candidate) => isSameSliceRecoverySourceWindow(nativeSlice, candidate));
  if (matchingEvidence) {
    return matchingEvidence;
  }

  return evidence.length === nativeSliceCount ? evidence[index] : undefined;
}

function mergeNativeSliceWithRecoveryEvidence(
  nativeSlice: TaskSliceResult,
  recoveryEvidence: NativeVideoSliceRecoveryEvidence | undefined,
): TaskSliceResult {
  if (!recoveryEvidence) {
    return nativeSlice;
  }

  const transcriptSegments = nativeSlice.transcriptSegments?.length
    ? nativeSlice.transcriptSegments
    : recoveryEvidence.transcriptSegments;
  const transcriptText = nativeSlice.transcriptText?.trim() ||
    recoveryEvidence.transcriptText?.trim() ||
    (transcriptSegments?.length ? createRecoveredNativeVideoSliceTranscriptText(transcriptSegments) : undefined);
  const sourceStartMs = nativeSlice.sourceStartMs ?? recoveryEvidence.sourceStartMs ?? recoveryEvidence.startMs;
  const sourceEndMs = nativeSlice.sourceEndMs ?? recoveryEvidence.sourceEndMs ??
    (recoveryEvidence.startMs !== undefined && recoveryEvidence.durationMs !== undefined
      ? recoveryEvidence.startMs + recoveryEvidence.durationMs
      : undefined);
  const speechStartMs = nativeSlice.speechStartMs ?? recoveryEvidence.speechStartMs ?? transcriptSegments?.[0]?.startMs;
  const speechEndMs = nativeSlice.speechEndMs ?? recoveryEvidence.speechEndMs ?? transcriptSegments?.at(-1)?.endMs;
  const boundaryPaddingBeforeMs = nativeSlice.boundaryPaddingBeforeMs ?? recoveryEvidence.boundaryPaddingBeforeMs ??
    (sourceStartMs !== undefined && speechStartMs !== undefined ? speechStartMs - sourceStartMs : undefined);
  const boundaryPaddingAfterMs = nativeSlice.boundaryPaddingAfterMs ?? recoveryEvidence.boundaryPaddingAfterMs ??
    (sourceEndMs !== undefined && speechEndMs !== undefined ? sourceEndMs - speechEndMs : undefined);
  const transcriptSegmentCount = nativeSlice.transcriptSegmentCount ?? recoveryEvidence.transcriptSegmentCount ??
    (transcriptSegments?.length ? transcriptSegments.length : undefined);

  return {
    ...nativeSlice,
    ...(sourceStartMs !== undefined ? { sourceStartMs } : {}),
    ...(sourceEndMs !== undefined ? { sourceEndMs } : {}),
    ...(speechStartMs !== undefined ? { speechStartMs } : {}),
    ...(speechEndMs !== undefined ? { speechEndMs } : {}),
    ...(boundaryPaddingBeforeMs !== undefined ? { boundaryPaddingBeforeMs } : {}),
    ...(boundaryPaddingAfterMs !== undefined ? { boundaryPaddingAfterMs } : {}),
    ...(transcriptText ? { transcriptText } : {}),
    ...(transcriptSegments?.length ? { transcriptSegments } : {}),
    ...(transcriptSegmentCount !== undefined ? { transcriptSegmentCount } : {}),
    ...(nativeSlice.transcriptCoverageScore !== undefined
      ? { transcriptCoverageScore: nativeSlice.transcriptCoverageScore }
      : recoveryEvidence.transcriptCoverageScore !== undefined
        ? { transcriptCoverageScore: recoveryEvidence.transcriptCoverageScore }
        : {}),
    ...(nativeSlice.speechContinuityGrade
      ? { speechContinuityGrade: nativeSlice.speechContinuityGrade }
      : recoveryEvidence.speechContinuityGrade
        ? { speechContinuityGrade: recoveryEvidence.speechContinuityGrade }
        : {}),
  };
}

function isSameSliceRecoverySourceWindow(
  nativeSlice: TaskSliceResult,
  recoveryEvidence: NativeVideoSliceRecoveryEvidence,
) {
  const recoveryStartMs = recoveryEvidence.sourceStartMs ?? recoveryEvidence.startMs;
  const recoveryEndMs = recoveryEvidence.sourceEndMs ??
    (recoveryEvidence.startMs !== undefined && recoveryEvidence.durationMs !== undefined
      ? recoveryEvidence.startMs + recoveryEvidence.durationMs
      : undefined);

  return (
    nativeSlice.sourceStartMs !== undefined &&
    nativeSlice.sourceEndMs !== undefined &&
    recoveryStartMs !== undefined &&
    recoveryEndMs !== undefined &&
    Math.abs(nativeSlice.sourceStartMs - recoveryStartMs) <= 250 &&
    Math.abs(nativeSlice.sourceEndMs - recoveryEndMs) <= 250
  );
}

function mergeNativeTaskWithLocalSliceMetadata(nativeTask: AppTask, localTask: AppTask | undefined): AppTask {
  if (!nativeTask.sliceResults?.length || !localTask?.sliceResults?.length) {
    return nativeTask;
  }

  const localSliceById = new Map(localTask.sliceResults.map((slice) => [slice.id, slice]));
  const sliceResults = nativeTask.sliceResults.map((nativeSlice) => {
    const localSlice =
      localSliceById.get(nativeSlice.id) ??
      localTask.sliceResults?.find((candidate) => isSameSliceSourceWindow(nativeSlice, candidate));
    if (!localSlice) {
      return nativeSlice;
    }

    return {
      ...nativeSlice,
      ...(localSlice.title ? { title: localSlice.title } : {}),
      ...(localSlice.summary ? { summary: localSlice.summary } : {}),
      ...(localSlice.reason ? { reason: localSlice.reason } : {}),
      ...(localSlice.qualityScore !== undefined ? { qualityScore: localSlice.qualityScore } : {}),
      ...(localSlice.continuityScore !== undefined ? { continuityScore: localSlice.continuityScore } : {}),
      ...(localSlice.storyShape ? { storyShape: localSlice.storyShape } : {}),
      ...(localSlice.publishabilityScore !== undefined ? { publishabilityScore: localSlice.publishabilityScore } : {}),
      ...(localSlice.publishabilityGrade ? { publishabilityGrade: localSlice.publishabilityGrade } : {}),
      ...(localSlice.publishabilityIssues ? { publishabilityIssues: localSlice.publishabilityIssues } : {}),
      ...(localSlice.boundaryQualityScore !== undefined ? { boundaryQualityScore: localSlice.boundaryQualityScore } : {}),
      ...(localSlice.hookStrength ? { hookStrength: localSlice.hookStrength } : {}),
      ...(localSlice.endingCompleteness ? { endingCompleteness: localSlice.endingCompleteness } : {}),
      ...(localSlice.contentArcScore !== undefined ? { contentArcScore: localSlice.contentArcScore } : {}),
      ...(localSlice.contentArcGrade ? { contentArcGrade: localSlice.contentArcGrade } : {}),
      ...(localSlice.contentArcStages ? { contentArcStages: localSlice.contentArcStages } : {}),
      ...(localSlice.contentArcMissingStages ? { contentArcMissingStages: localSlice.contentArcMissingStages } : {}),
      ...(localSlice.topicCoherenceScore !== undefined ? { topicCoherenceScore: localSlice.topicCoherenceScore } : {}),
      ...(localSlice.topicCoherenceGrade ? { topicCoherenceGrade: localSlice.topicCoherenceGrade } : {}),
      ...(localSlice.topicShiftCount !== undefined ? { topicShiftCount: localSlice.topicShiftCount } : {}),
      ...(localSlice.topicKeywords ? { topicKeywords: localSlice.topicKeywords } : {}),
      ...(localSlice.platformReadinessScore !== undefined
        ? { platformReadinessScore: localSlice.platformReadinessScore }
        : {}),
      ...(localSlice.platformReadinessGrade ? { platformReadinessGrade: localSlice.platformReadinessGrade } : {}),
      ...(localSlice.platformReadinessIssues ? { platformReadinessIssues: localSlice.platformReadinessIssues } : {}),
      ...(localSlice.sentenceBoundaryIntegrityScore !== undefined
        ? { sentenceBoundaryIntegrityScore: localSlice.sentenceBoundaryIntegrityScore }
        : {}),
      ...(localSlice.sentenceBoundaryIntegrityGrade
        ? { sentenceBoundaryIntegrityGrade: localSlice.sentenceBoundaryIntegrityGrade }
        : {}),
      ...(localSlice.sentenceBoundaryIssues ? { sentenceBoundaryIssues: localSlice.sentenceBoundaryIssues } : {}),
      ...(localSlice.risks ? { risks: localSlice.risks } : {}),
      ...(localSlice.sourceStartMs !== undefined ? { sourceStartMs: localSlice.sourceStartMs } : {}),
      ...(localSlice.sourceEndMs !== undefined ? { sourceEndMs: localSlice.sourceEndMs } : {}),
      ...(localSlice.speechStartMs !== undefined ? { speechStartMs: localSlice.speechStartMs } : {}),
      ...(localSlice.speechEndMs !== undefined ? { speechEndMs: localSlice.speechEndMs } : {}),
      ...(localSlice.boundaryPaddingBeforeMs !== undefined
        ? { boundaryPaddingBeforeMs: localSlice.boundaryPaddingBeforeMs }
        : {}),
      ...(localSlice.boundaryPaddingAfterMs !== undefined
        ? { boundaryPaddingAfterMs: localSlice.boundaryPaddingAfterMs }
        : {}),
      ...(localSlice.transcriptText ? { transcriptText: localSlice.transcriptText } : {}),
      ...(localSlice.transcriptSegments?.length ? { transcriptSegments: localSlice.transcriptSegments } : {}),
      ...(localSlice.transcriptSegmentCount !== undefined
        ? { transcriptSegmentCount: localSlice.transcriptSegmentCount }
        : {}),
      ...(localSlice.transcriptCoverageScore !== undefined
        ? { transcriptCoverageScore: localSlice.transcriptCoverageScore }
        : {}),
      ...(localSlice.speechContinuityGrade ? { speechContinuityGrade: localSlice.speechContinuityGrade } : {}),
      ...(localSlice.artifactPath ? { artifactPath: localSlice.artifactPath } : {}),
      ...(localSlice.taskOutputDir ? { taskOutputDir: localSlice.taskOutputDir } : {}),
    };
  });

  return {
    ...nativeTask,
    sliceResults,
  };
}

function findLocalSliceMetadataForNativeTask(
  nativeTask: AppTask,
  snapshot: AutoCutNativeTaskSnapshot,
  localTasks: readonly AppTask[],
): AppTask | undefined {
  let bestMatch: AppTask | undefined;
  let bestScore = 0;

  localTasks.forEach((localTask) => {
    const score = scoreLocalSliceMetadataMatch(nativeTask, snapshot, localTask);
    if (score > bestScore) {
      bestMatch = localTask;
      bestScore = score;
    }
  });

  return bestMatch;
}

function scoreLocalSliceMetadataMatch(
  nativeTask: AppTask,
  snapshot: AutoCutNativeTaskSnapshot,
  localTask: AppTask,
) {
  if (
    nativeTask.type !== AUTOCUT_TASK_TYPE.videoSlice ||
    localTask.type !== AUTOCUT_TASK_TYPE.videoSlice ||
    localTask.status !== AUTOCUT_TASK_STATUS.completed ||
    !nativeTask.sliceResults?.length ||
    !localTask.sliceResults?.length
  ) {
    return 0;
  }

  const sameTaskIdentity = localTask.id === snapshot.uuid || localTask.id === nativeTask.id;
  const sourceAssetId = snapshot.sourceAssetUuid ?? nativeTask.sourceFileId;
  const sameSourceAsset = Boolean(sourceAssetId && localTask.sourceFileId === sourceAssetId);
  const artifactMatchCount = countLocalSliceArtifactMatches(nativeTask, localTask);
  const sourceWindowMatchCount = countLocalSliceSourceWindowMatches(nativeTask, localTask);

  if (!sameTaskIdentity && artifactMatchCount === 0 && !(sameSourceAsset && sourceWindowMatchCount > 0)) {
    return 0;
  }

  return (
    (sameTaskIdentity ? 1_000 : 0) +
    (sameSourceAsset ? 250 : 0) +
    artifactMatchCount * 200 +
    sourceWindowMatchCount * 100
  );
}

function countLocalSliceArtifactMatches(nativeTask: AppTask, localTask: AppTask) {
  const localArtifactIds = new Set([
    ...(localTask.generatedAssetIds ?? []),
    ...(localTask.sliceResults ?? []).map((slice) => slice.id),
  ]);

  return [
    ...(nativeTask.generatedAssetIds ?? []),
    ...(nativeTask.sliceResults ?? []).map((slice) => slice.id),
  ].filter((artifactId) => localArtifactIds.has(artifactId)).length;
}

function countLocalSliceSourceWindowMatches(nativeTask: AppTask, localTask: AppTask) {
  return (nativeTask.sliceResults ?? []).filter((nativeSlice) =>
    localTask.sliceResults?.some((localSlice) => isSameSliceSourceWindow(nativeSlice, localSlice)),
  ).length;
}

function enforceRecoveredNativeVideoSliceProfessionalTranscriptEvidence(
  task: AppTask,
  snapshot?: AutoCutNativeTaskSnapshot,
): AppTask {
  if (task.type !== AUTOCUT_TASK_TYPE.videoSlice || task.status !== AUTOCUT_TASK_STATUS.completed) {
    return task;
  }

  try {
    assertRecoveredNativeVideoSliceProfessionalTranscriptEvidence(task.sliceResults);
    return task;
  } catch (error) {
    return createInvalidRecoveredNativeVideoSliceTask(task, error, snapshot);
  }
}

function assertRecoveredNativeVideoSliceProfessionalTranscriptEvidence(
  sliceResults: readonly TaskSliceResult[] | undefined,
) {
  if (!sliceResults?.length) {
    throw new Error('AutoCut recovered native video slicing output is missing generated slice results.');
  }

  sliceResults.forEach((sliceResult, index) => {
    const sliceNumber = index + 1;
    if (!sliceResult.transcriptText?.trim() || !sliceResult.transcriptSegments?.length) {
      throw new Error(
        `AutoCut recovered native video slicing slice artifact ${sliceNumber} is missing speech-to-text transcript evidence.`,
      );
    }

    if (
      typeof sliceResult.transcriptSegmentCount !== 'number' ||
      sliceResult.transcriptSegmentCount !== sliceResult.transcriptSegments.length
    ) {
      throw new Error(
        `AutoCut recovered native video slicing slice artifact ${sliceNumber} transcriptSegmentCount does not match transcriptSegments.`,
      );
    }

    if (
      normalizeRecoveredNativeVideoSliceTranscriptText(sliceResult.transcriptText) !==
      createRecoveredNativeVideoSliceTranscriptText(sliceResult.transcriptSegments)
    ) {
      throw new Error(
        `AutoCut recovered native video slicing slice artifact ${sliceNumber} transcriptText does not match transcriptSegments.`,
      );
    }

    const sourceStartMs = assertRecoveredNativeVideoSliceMilliseconds(sliceResult.sourceStartMs, sliceNumber, 'sourceStartMs');
    const sourceEndMs = assertRecoveredNativeVideoSliceMilliseconds(sliceResult.sourceEndMs, sliceNumber, 'sourceEndMs');
    const speechStartMs = assertRecoveredNativeVideoSliceMilliseconds(sliceResult.speechStartMs, sliceNumber, 'speechStartMs');
    const speechEndMs = assertRecoveredNativeVideoSliceMilliseconds(sliceResult.speechEndMs, sliceNumber, 'speechEndMs');

    if (sourceEndMs <= sourceStartMs) {
      throw new Error(
        `AutoCut recovered native video slicing slice artifact ${sliceNumber} sourceEndMs is not after sourceStartMs.`,
      );
    }
    if (speechEndMs <= speechStartMs || speechStartMs < sourceStartMs || speechEndMs > sourceEndMs) {
      throw new Error(
        `AutoCut recovered native video slicing slice artifact ${sliceNumber} speech range is outside its rendered source range.`,
      );
    }

    const boundaryPaddingBeforeMs = speechStartMs - sourceStartMs;
    const boundaryPaddingAfterMs = sourceEndMs - speechEndMs;
    if (
      boundaryPaddingBeforeMs > MAX_RECOVERED_SMART_SLICE_LEADING_SILENCE_MS ||
      boundaryPaddingAfterMs > MAX_RECOVERED_SMART_SLICE_TRAILING_SILENCE_MS
    ) {
      throw new Error(
        `AutoCut recovered native video slicing slice artifact ${sliceNumber} exceeds the ${MAX_RECOVERED_SMART_SLICE_LEADING_SILENCE_MS}ms leading or ${MAX_RECOVERED_SMART_SLICE_TRAILING_SILENCE_MS}ms trailing speech silence standard.`,
      );
    }

    if (
      typeof sliceResult.transcriptCoverageScore !== 'number' ||
      !Number.isFinite(sliceResult.transcriptCoverageScore) ||
      sliceResult.transcriptCoverageScore < MIN_RECOVERED_SMART_SLICE_TRANSCRIPT_COVERAGE_SCORE
    ) {
      throw new Error(
        `AutoCut recovered native video slicing slice artifact ${sliceNumber} transcriptCoverageScore to be at least ${MIN_RECOVERED_SMART_SLICE_TRANSCRIPT_COVERAGE_SCORE}.`,
      );
    }

    if (
      !RECOVERED_SMART_SLICE_ACCEPTED_SPEECH_CONTINUITY_GRADES.includes(
        sliceResult.speechContinuityGrade as typeof RECOVERED_SMART_SLICE_ACCEPTED_SPEECH_CONTINUITY_GRADES[number],
      )
    ) {
      throw new Error(
        `AutoCut recovered native video slicing slice artifact ${sliceNumber} speechContinuityGrade to be strong or repaired.`,
      );
    }

    let previousTranscriptSegmentEndMs: number | undefined;
    sliceResult.transcriptSegments.forEach((segment, segmentIndex) => {
      const segmentNumber = segmentIndex + 1;
      const segmentStartMs = assertRecoveredNativeVideoSliceMilliseconds(
        segment.startMs,
        sliceNumber,
        `transcriptSegments[${segmentIndex}].startMs`,
      );
      const segmentEndMs = assertRecoveredNativeVideoSliceMilliseconds(
        segment.endMs,
        sliceNumber,
        `transcriptSegments[${segmentIndex}].endMs`,
      );
      if (!segment.text.trim()) {
        throw new Error(
          `AutoCut recovered native video slicing slice artifact ${sliceNumber} transcript segment ${segmentNumber} has no text.`,
        );
      }
      if (segmentEndMs <= segmentStartMs || segmentStartMs < sourceStartMs || segmentEndMs > sourceEndMs) {
        throw new Error(
          `AutoCut recovered native video slicing slice artifact ${sliceNumber} transcript segment ${segmentNumber} is outside its rendered source range.`,
        );
      }
      if (previousTranscriptSegmentEndMs !== undefined && segmentStartMs < previousTranscriptSegmentEndMs) {
        throw new Error(
          `AutoCut recovered native video slicing slice artifact ${sliceNumber} transcript segments are not ordered and non-overlapping.`,
        );
      }
      previousTranscriptSegmentEndMs = segmentEndMs;
    });

    const firstTranscriptSegmentStartMs = sliceResult.transcriptSegments[0]?.startMs;
    const lastTranscriptSegmentEndMs = sliceResult.transcriptSegments.at(-1)?.endMs;
    if (
      firstTranscriptSegmentStartMs === undefined ||
      lastTranscriptSegmentEndMs === undefined ||
      Math.abs(firstTranscriptSegmentStartMs - speechStartMs) >
        RECOVERED_SMART_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS ||
      Math.abs(lastTranscriptSegmentEndMs - speechEndMs) >
        RECOVERED_SMART_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS
    ) {
      throw new Error(
        `AutoCut recovered native video slicing slice artifact ${sliceNumber} speech range does not match transcript segment boundaries.`,
      );
    }
  });
}

function assertRecoveredNativeVideoSliceMilliseconds(value: unknown, sliceNumber: number, fieldName: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(
      `AutoCut recovered native video slicing slice artifact ${sliceNumber} ${fieldName} is not a non-negative millisecond value.`,
    );
  }

  return Math.round(value);
}

function createInvalidRecoveredNativeVideoSliceTask(
  task: AppTask,
  error: unknown,
  snapshot?: AutoCutNativeTaskSnapshot,
): AppTask {
  const message = createRecoveredNativeVideoSliceUserFacingErrorMessage(error);
  const failureDiagnostics = createRecoveredNativeVideoSliceDebugDiagnostics(error, task, snapshot);
  return {
    id: task.id,
    type: task.type,
    name: task.name,
    status: AUTOCUT_TASK_STATUS.failed,
    progress: task.progress,
    progressMessage: 'Task failed',
    createdAt: task.createdAt,
    ...(task.sourceFileId ? { sourceFileId: task.sourceFileId } : {}),
    errorMessage: message,
    ...(failureDiagnostics ? { failureDiagnostics } : {}),
  };
}

function createRecoveredNativeVideoSliceUserFacingErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : 'AutoCut recovered native video slicing output is invalid.';
  if (message.includes('missing speech-to-text transcript evidence')) {
    return [
      'Recovered smart-slice artifacts are missing speech-to-text transcript evidence.',
      'Re-run Smart Slice after local speech-to-text setup so every generated clip has a verified transcript.',
    ].join(' ');
  }

  return message;
}

function createRecoveredNativeVideoSliceDebugDiagnostics(
  error: unknown,
  task: AppTask,
  snapshot: AutoCutNativeTaskSnapshot | undefined,
) {
  const lines = [
    'AutoCut recovered native smart-slice diagnostic trace',
    `Visible error: ${createRecoveredNativeVideoSliceUserFacingErrorMessage(error)}`,
    `Original error: ${error instanceof Error ? error.message : String(error)}`,
    'Stack:',
    error instanceof Error && error.stack ? error.stack : 'No JavaScript stack was available.',
    `App task: id=${task.id} status=${task.status} type=${task.type} sourceFileId=${task.sourceFileId ?? 'none'} slices=${task.sliceResults?.length ?? 0}`,
  ];

  if (snapshot) {
    const input = parseJsonRecord(snapshot.inputJson);
    const output = parseJsonRecord(snapshot.outputJson);
    lines.push(
      `Native task snapshot: uuid=${snapshot.uuid} taskType=${snapshot.taskType} status=${snapshot.status} sourceAssetUuid=${snapshot.sourceAssetUuid ?? 'none'} progress=${snapshot.progress}`,
      createRecoveredNativeInputClipEvidenceSummary(input),
      createRecoveredNativeOutputSliceEvidenceSummary(output),
      createRecoveredNativeSnapshotDiagnosticsSummary(snapshot),
    );
  } else {
    lines.push('Native task snapshot: unavailable');
  }

  return lines.filter((line) => line.trim()).join('\n');
}

function createRecoveredNativeInputClipEvidenceSummary(input: JsonRecord) {
  const clips = readArray(input.clips);
  const requestedClips = readArray(input.requestedClips);
  return [
    'Input clip evidence:',
    `clips=${clips.length}`,
    `requestedClips=${requestedClips.length}`,
    `clipsWithTranscriptSegments=${countRecordsWithTranscriptSegments(clips)}`,
    `requestedClipsWithTranscriptSegments=${countRecordsWithTranscriptSegments(requestedClips)}`,
    `clipsWithTranscriptText=${countRecordsWithTranscriptText(clips)}`,
    `requestedClipsWithTranscriptText=${countRecordsWithTranscriptText(requestedClips)}`,
  ].join(' ');
}

function createRecoveredNativeOutputSliceEvidenceSummary(output: JsonRecord) {
  const sliceResults = readArray(output.sliceResults);
  const sliceSummaries = sliceResults
    .map((slice, index) => createRecoveredNativeSliceEvidenceSummary(slice, index))
    .filter(Boolean);
  return [
    [
      'Output slice evidence:',
      `sliceResults=${sliceResults.length}`,
      `slicesWithTranscriptSegments=${countRecordsWithTranscriptSegments(sliceResults)}`,
      `slicesWithTranscriptText=${countRecordsWithTranscriptText(sliceResults)}`,
      `declaredSliceCount=${readNumber(output.sliceCount) ?? 'unknown'}`,
    ].join(' '),
    ...sliceSummaries,
  ].join('\n');
}

function createRecoveredNativeSliceEvidenceSummary(value: unknown, index: number) {
  const slice = readRecord(value);
  if (!slice) {
    return `Output slice ${index + 1}: invalid non-object slice payload`;
  }

  const transcriptSegments = readArray(slice.transcriptSegments);
  const transcriptText = readString(slice.transcriptText);
  return [
    `Output slice ${index + 1}:`,
    `artifactUuid=${readString(slice.artifactUuid) ?? 'none'}`,
    `startMs=${readNumber(slice.startMs) ?? 'unknown'}`,
    `durationMs=${readNumber(slice.durationMs) ?? 'unknown'}`,
    `sourceStartMs=${readNumber(slice.sourceStartMs) ?? 'unknown'}`,
    `sourceEndMs=${readNumber(slice.sourceEndMs) ?? 'unknown'}`,
    `speechStartMs=${readNumber(slice.speechStartMs) ?? 'unknown'}`,
    `speechEndMs=${readNumber(slice.speechEndMs) ?? 'unknown'}`,
    `transcriptSegments=${transcriptSegments.length}`,
    `transcriptText=${transcriptText ? 'present' : 'missing'}`,
    `transcriptSegmentCount=${readNumber(slice.transcriptSegmentCount) ?? 'unknown'}`,
    `transcriptCoverageScore=${readNumber(slice.transcriptCoverageScore) ?? 'unknown'}`,
    `speechContinuityGrade=${readString(slice.speechContinuityGrade) ?? 'unknown'}`,
  ].join(' ');
}

function createRecoveredNativeSnapshotDiagnosticsSummary(snapshot: AutoCutNativeTaskSnapshot) {
  const failedStages = snapshot.stages
    .filter((stage) => stage.status === OPS_STATUS_FAILED)
    .map((stage) => `stage=${stage.uuid} type=${stage.stageType} diagnostics=${truncateRecoveredNativeDiagnosticText(stage.diagnosticsJson)}`);
  const leases = snapshot.workerLeases
    .map((lease) => `lease=${lease.uuid} status=${lease.leaseStatus} diagnostics=${truncateRecoveredNativeDiagnosticText(lease.diagnosticsJson)}`);
  return [
    `Native diagnostics: failedStages=${failedStages.length} workerLeases=${snapshot.workerLeases.length} events=${snapshot.events.length}`,
    ...failedStages,
    ...leases,
  ].join('\n');
}

function countRecordsWithTranscriptSegments(values: readonly unknown[]) {
  return values.filter((value) => readArray(readRecord(value)?.transcriptSegments).length > 0).length;
}

function countRecordsWithTranscriptText(values: readonly unknown[]) {
  return values.filter((value) => Boolean(readString(readRecord(value)?.transcriptText))).length;
}

function truncateRecoveredNativeDiagnosticText(value: string, maxLength = 500) {
  const normalized = value.trim().replace(/\s+/gu, ' ');
  if (normalized.length <= maxLength) {
    return normalized || 'empty';
  }

  return `${normalized.slice(0, maxLength)}...`;
}

function isSameSliceSourceWindow(nativeSlice: TaskSliceResult, localSlice: TaskSliceResult) {
  const nativeStartMs = nativeSlice.sourceStartMs;
  const nativeEndMs = nativeSlice.sourceEndMs;
  const localStartMs = localSlice.sourceStartMs;
  const localEndMs = localSlice.sourceEndMs;
  if (
    nativeStartMs === undefined ||
    nativeEndMs === undefined ||
    localStartMs === undefined ||
    localEndMs === undefined
  ) {
    return false;
  }

  return Math.abs(nativeStartMs - localStartMs) <= 250 && Math.abs(nativeEndMs - localEndMs) <= 250;
}

function mapNativeSpeechTranscriptSegmentToExtractedText(
  segment: AutoCutTranscriptSegment,
): NonNullable<AppTask['extractedText']>[number] {
  return {
    time: formatNativeSegmentTimestamp(segment.startMs),
    speaker: segment.speaker?.trim() || 'Speaker 1',
    text: segment.text,
  };
}

function mapNativeSpeechTranscriptSegment(value: unknown): AutoCutTranscriptSegment | null {
  const segment = readRecord(value);
  if (!segment) {
    return null;
  }

  const startMs = readNumber(segment.startMs);
  const endMs = readNumber(segment.endMs);
  const text = readString(segment.text)?.trim().replace(/\s+/gu, ' ');
  if (
    startMs === undefined ||
    endMs === undefined ||
    endMs <= startMs ||
    !text
  ) {
    return null;
  }

  const speaker = readString(segment.speaker)?.trim();
  return {
    startMs: Math.round(startMs),
    endMs: Math.round(endMs),
    text,
    ...(speaker ? { speaker } : {}),
  };
}

function createFileSizeStats(originalSize: number, newSize: number) {
  return {
    originalSize,
    newSize,
    compressionRatio:
      originalSize > 0 && newSize < originalSize
        ? Number(((originalSize - newSize) / originalSize).toFixed(2))
        : 0,
  };
}

function readNativeCompletedEventNumber(snapshot: AutoCutNativeTaskSnapshot, field: string) {
  return [...snapshot.events]
    .reverse()
    .map((event) => readRecord(event.payload))
    .map((payload) => payload ? readNumber(payload[field]) : undefined)
    .find((value) => value !== undefined);
}

function parseJsonRecord(source: string): JsonRecord {
  try {
    const parsed: unknown = JSON.parse(source);
    return readRecord(parsed) ?? {};
  } catch {
    return {};
  }
}

function readRecord(value: unknown): JsonRecord | null {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return null;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function assertNativeAssetUrl(
  artifactPath: string,
  createAssetUrl: (artifactPath: string) => string,
  sliceNumber: number,
  fieldName: string,
) {
  const assetUrl = optionalCreateNativeAssetUrl(artifactPath, createAssetUrl);
  if (!assetUrl) {
    throw new Error(
      `AutoCut native video slicing slice artifact ${sliceNumber} ${fieldName} asset URL conversion failed.`,
    );
  }
  return assetUrl;
}

function optionalCreateNativeAssetUrl(artifactPath: string, createAssetUrl: (artifactPath: string) => string) {
  try {
    const assetUrl = createAssetUrl(artifactPath);
    return typeof assetUrl === 'string' && assetUrl.trim() ? assetUrl : undefined;
  } catch {
    return undefined;
  }
}

function readPathFileName(filePath: string) {
  return filePath.split(/[\\/]/u).filter(Boolean).at(-1);
}

function clampProgress(progress: number) {
  if (!Number.isFinite(progress)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(progress)));
}

function formatNativeSegmentTimestamp(milliseconds: number) {
  const safeMilliseconds = Math.max(0, Math.round(milliseconds));
  const totalSeconds = Math.floor(safeMilliseconds / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((part) => part.toString().padStart(2, '0'))
    .join(':');
}
