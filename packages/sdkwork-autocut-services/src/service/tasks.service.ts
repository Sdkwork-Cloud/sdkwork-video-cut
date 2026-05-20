import {
  AUTOCUT_TASK_STATUS,
  AUTOCUT_TASK_TYPE,
  AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD,
  type AppTask,
  type AutoCutNativeTaskProgressEvent,
  type AutoCutTaskExecutionCheckpoint,
  type AutoCutTaskExecutionLog,
  type AutoCutTaskExecutionLogSeverity,
  type AutoCutTaskExecutionStep,
  type AutoCutTaskExecutionStepStatus,
  type AutoCutTranscriptSegment,
  type TaskSliceResult,
  type TaskStatus,
  type TaskType,
} from '@sdkwork/autocut-types';
import { getAutoCutTimestampMs, sortAutoCutRecordsByCreatedAtDesc } from './datetime.service';
import { dispatchAutoCutEvent } from './events.service';
import { createAutoCutId, createAutoCutTimestamp } from './identity.service';
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
  audioCleanupProfile: RECOVERED_SMART_SLICE_AUDIO_CLEANUP_PROFILE,
  minAudioActivityConfidence: MIN_RECOVERED_SMART_SLICE_AUDIO_ACTIVITY_CONFIDENCE,
  requiredAudioActivityAnalysisFilter: RECOVERED_SMART_SLICE_REQUIRED_AUDIO_ACTIVITY_ANALYSIS_FILTER,
  rawAudioActivityAnalysisFilter: RECOVERED_SMART_SLICE_RAW_AUDIO_ACTIVITY_ANALYSIS_FILTER,
  acceptedBoundaryDecisionSources: RECOVERED_SMART_SLICE_ACCEPTED_BOUNDARY_DECISION_SOURCES,
  acceptedTailTreatments: RECOVERED_SMART_SLICE_ACCEPTED_TAIL_TREATMENTS,
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

const NATIVE_TASK_EVENT_TYPE_STARTED = 1;
const NATIVE_TASK_EVENT_TYPE_COMPLETED = 2;
const NATIVE_TASK_EVENT_TYPE_FAILED = 3;
const NATIVE_TASK_EVENT_TYPE_CANCEL_REQUESTED = 4;
const NATIVE_TASK_EVENT_TYPE_CANCELED = 5;
const NATIVE_TASK_EVENT_TYPE_INTERRUPTED = 6;
const NATIVE_TASK_EVENT_TYPE_RETRY_REQUESTED = 7;
const NATIVE_TASK_EVENT_TYPE_PROGRESS = 8;
const NATIVE_TASK_PROGRESS_LOG_MILESTONE_PERCENT = 5;
const NATIVE_TASK_PROGRESS_PROJECTION_STATE_LIMIT = 1_000;
const NATIVE_TASK_PROGRESS_EVENT_UUID_STATE_LIMIT = 5_000;
const MAX_RECOVERED_SMART_SLICE_SOURCE_SEGMENTS = 80;
const RECOVERED_SMART_SLICE_SOURCE_SEGMENT_BOUNDARY_TOLERANCE_MS = 80;
const MIN_RECOVERED_SMART_SLICE_TRUSTED_AUDIO_SOURCE_SEGMENT_RETAINED_RATIO = 0.35;

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
  currentStepId?: string;
  executionSteps?: AutoCutTaskExecutionStep[];
  executionLogs?: AutoCutTaskExecutionLog[];
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
  sourceSegments?: TaskSliceResult['sourceSegments'];
  renderedDurationMs?: number;
  removedSilenceMs?: number;
  internalSilenceTrimCount?: number;
  sourceStartMs?: number;
  sourceEndMs?: number;
  speechStartMs?: number;
  speechEndMs?: number;
  boundaryPaddingBeforeMs?: number;
  boundaryPaddingAfterMs?: number;
  audioCleanupProfile?: string;
  noiseReductionApplied?: boolean;
  boundaryDecisionSource?: TaskSliceResult['boundaryDecisionSource'];
  audioActivityStartMs?: number;
  audioActivityEndMs?: number;
  audioActivityConfidence?: number;
  audioActivityAnalysisFilter?: string;
  leadingSilenceMs?: number;
  trailingSilenceMs?: number;
  leadingSilenceTrimMs?: number;
  trailingSilenceTrimMs?: number;
  tailTreatment?: TaskSliceResult['tailTreatment'];
  transcriptText?: string;
  transcriptSegments?: AutoCutTranscriptSegment[];
  transcriptSegmentCount?: number;
  transcriptCoverageScore?: number;
  speechContinuityGrade?: TaskSliceResult['speechContinuityGrade'];
  risks?: string[];
}

type AutoCutSliceAudioCleanupEvidence = Pick<
  TaskSliceResult,
  | 'audioCleanupProfile'
  | 'noiseReductionApplied'
  | 'boundaryDecisionSource'
  | 'audioActivityStartMs'
  | 'audioActivityEndMs'
  | 'audioActivityConfidence'
  | 'audioActivityAnalysisFilter'
  | 'leadingSilenceMs'
  | 'trailingSilenceMs'
  | 'leadingSilenceTrimMs'
  | 'trailingSilenceTrimMs'
  | 'sourceSegments'
  | 'renderedDurationMs'
  | 'removedSilenceMs'
  | 'internalSilenceTrimCount'
  | 'tailTreatment'
>;

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

export interface AutoCutTaskSliceTranscriptUpdate {
  transcriptText?: string;
  transcriptSegments?: readonly AutoCutTranscriptSegment[];
}

export interface AutoCutTaskResumeResult {
  success: boolean;
  taskId: string;
  stepId: string;
  nativeTaskId?: string;
  message?: string;
}

export type AutoCutTaskResumeHandler = (
  task: AppTask,
  stepId: string,
) => Promise<AutoCutTaskResumeResult>;

export interface AutoCutTaskCancelResult {
  success: boolean;
  taskId: string;
  nativeTaskId?: string;
  message?: string;
}

export type AutoCutTaskCancelHandler = (
  task: AppTask,
) => Promise<AutoCutTaskCancelResult | void> | AutoCutTaskCancelResult | void;

interface TaskLookupResult {
  localTasks: AppTask[];
  tasksById: Map<string, AppTask>;
  nativeTaskIds: Set<string>;
  skippedTaskIds: string[];
}

interface NativeTaskProgressProjectionState {
  progressBucket: number;
  progress: number;
}

const taskResumeHandlers = new Map<TaskType, AutoCutTaskResumeHandler>();
const taskCancelHandlers = new Map<TaskType, AutoCutTaskCancelHandler>();
const taskCancellationRequests = new Set<string>();
const nativeTaskProgressProjectionStateByKey = new Map<string, NativeTaskProgressProjectionState>();
const nativeTaskProgressEventUuidSeenBeforeStorage = new Map<string, true>();

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

export async function projectNativeTaskProgressEventToTask(
  progress: AutoCutNativeTaskProgressEvent,
): Promise<AppTask | undefined> {
  const workflowTaskId = readString(progress.workflowTaskId ?? progress.payload?.workflowTaskId);
  const nativeTaskId = resolveNativeProgressTaskUuid(progress);
  const targetTaskId = workflowTaskId ?? nativeTaskId;
  if (!targetTaskId) {
    return undefined;
  }
  if (hasSeenNativeTaskProgressEventUuidBeforeStorage(progress)) {
    return undefined;
  }
  if (!shouldProjectNativeTaskProgressEventBeforeStorage(progress, targetTaskId, nativeTaskId)) {
    return undefined;
  }

  const localTasks = readLocalTasks();
  const taskIndex = localTasks.findIndex((task) =>
    task.id === targetTaskId ||
    (nativeTaskId ? task.nativeTaskId === nativeTaskId : false)
  );
  if (taskIndex < 0) {
    return undefined;
  }

  const task = localTasks[taskIndex];
  if (!task) {
    return undefined;
  }

  const log = mapNativeTaskProgressEventToExecutionLog(progress, task.id, nativeTaskId);
  if (isDuplicateNativeTaskProgressEvent(task.executionLogs, log)) {
    return task;
  }
  if (!shouldPersistNativeTaskProgressEvent(task, log)) {
    return task;
  }

  const executionLogs = appendNativeTaskExecutionLog(task.executionLogs, log);
  const executionSteps = updateNativeTaskProgressExecutionSteps(task.executionSteps, log, task.status);
  const currentStep = [...executionSteps].reverse().find((step) =>
    step.status === 'running' || step.status === 'cancelRequested'
  ) ?? [...executionSteps].reverse().find((step) => step.status !== 'completed');
  const progressValue = typeof progress.progress === 'number' ? clampProgress(progress.progress) : undefined;
  const nextProgress = progressValue === undefined ? task.progress : Math.max(task.progress, progressValue);
  const progressMessage = progress.message?.trim()
    || (progress.operation && progress.phase ? `${progress.operation}: ${progress.phase}` : undefined)
    || progress.phase
    || task.progressMessage;
  const updatedTask: AppTask = {
    ...task,
    ...(nativeTaskId ? { nativeTaskId } : {}),
    ...(currentStep ? { currentStepId: currentStep.id } : task.currentStepId ? { currentStepId: task.currentStepId } : {}),
    ...(executionSteps.length ? { executionSteps } : {}),
    ...(executionLogs.length ? { executionLogs } : {}),
    progress: nextProgress,
    ...(progressMessage ? { progressMessage } : {}),
  };

  writeAutoCutStorage(
    'tasks',
    localTasks.map((candidate, index) => (index === taskIndex ? updatedTask : candidate)),
  );
  dispatchAutoCutEvent('taskUpdated', updatedTask);
  recordNativeTaskProgressEventUuidBeforeStorage(progress);
  recordNativeTaskProgressProjectionState(progress, targetTaskId, nativeTaskId);
  return updatedTask;
}

export async function updateTaskSliceTranscript(
  taskId: string,
  sliceId: string,
  update: readonly AutoCutTranscriptSegment[] | AutoCutTaskSliceTranscriptUpdate,
): Promise<AppTask> {
  const localTasks = readLocalTasks();
  const visibleTasks = await getTasks();
  const visibleTask = visibleTasks.find((task) => task.id === taskId);
  if (!visibleTask) {
    throw new Error('AutoCut task transcript edit failed because the task was not found.');
  }
  if (visibleTask.type !== AUTOCUT_TASK_TYPE.videoSlice || !visibleTask.sliceResults?.length) {
    throw new Error('AutoCut task transcript edit requires a completed video slice task.');
  }

  const sliceIndex = visibleTask.sliceResults.findIndex((slice) => slice.id === sliceId);
  if (sliceIndex < 0) {
    throw new Error('AutoCut task transcript edit failed because the slice was not found.');
  }

  const transcriptUpdate = isTaskSliceTranscriptSegmentUpdate(update)
    ? { transcriptSegments: update }
    : update;
  const currentSlice = visibleTask.sliceResults[sliceIndex];
  if (!currentSlice) {
    throw new Error('AutoCut task transcript edit failed because the slice was not found.');
  }
  const updatedSlice = createUpdatedTaskSliceTranscript(currentSlice, transcriptUpdate);
  const updatedTask: AppTask = {
    ...visibleTask,
    sliceResults: visibleTask.sliceResults.map((slice, index) => (index === sliceIndex ? updatedSlice : slice)),
  };
  const replacedLocalTask = localTasks.some((task) => task.id === taskId);
  const nextLocalTasks = replacedLocalTask
    ? localTasks.map((task) => (task.id === taskId ? updatedTask : task))
    : [updatedTask, ...localTasks];

  writeAutoCutStorage('tasks', nextLocalTasks);
  dispatchAutoCutEvent('taskUpdated', updatedTask);
  return updatedTask;
}

export function registerAutoCutTaskResumeHandler(
  taskType: TaskType,
  handler: AutoCutTaskResumeHandler,
) {
  taskResumeHandlers.set(taskType, handler);
  return () => {
    if (taskResumeHandlers.get(taskType) === handler) {
      taskResumeHandlers.delete(taskType);
    }
  };
}

export function registerAutoCutTaskCancelHandler(
  taskType: TaskType,
  handler: AutoCutTaskCancelHandler,
) {
  taskCancelHandlers.set(taskType, handler);
  return () => {
    if (taskCancelHandlers.get(taskType) === handler) {
      taskCancelHandlers.delete(taskType);
    }
  };
}

export function isAutoCutTaskCancellationRequested(taskId: string) {
  return taskCancellationRequests.has(taskId.trim());
}

export function clearAutoCutTaskCancellationRequest(taskId: string) {
  taskCancellationRequests.delete(taskId.trim());
}

export async function resumeTaskFromStep(
  taskId: string,
  stepId: string,
): Promise<AutoCutTaskResumeResult> {
  const normalizedTaskId = taskId.trim();
  const normalizedStepId = stepId.trim();
  if (!normalizedTaskId || !normalizedStepId) {
    throw new Error('AutoCut task resume requires a task id and step id.');
  }

  const task = readLocalTasks().find((candidate) => candidate.id === normalizedTaskId);
  if (!task) {
    throw new Error('AutoCut task resume failed because the task was not found.');
  }
  if (!isAutoCutTaskResumableStatus(task.status)) {
    throw new Error('AutoCut task resume requires a failed, canceled, or interrupted task.');
  }

  const step = task.executionSteps?.find((candidate) => candidate.id === normalizedStepId);
  const checkpoint = task.executionCheckpoint;
  if (!step?.canResumeFromHere && !checkpoint?.resumeFromStepIds.includes(normalizedStepId)) {
    throw new Error(`AutoCut task resume failed because step ${normalizedStepId} is not resumable.`);
  }
  if (!checkpoint) {
    throw new Error('AutoCut task resume failed because the task has no execution checkpoint.');
  }

  const handler = taskResumeHandlers.get(task.type);
  if (!handler) {
    throw new Error(`AutoCut task resume failed because no resume handler is registered for task type ${task.type}.`);
  }

  const timestamp = createAutoCutTimestamp();
  const resumeLog = createTaskResumeExecutionLog(task, normalizedStepId, 'task-resume-started', 'info', {
    timestamp,
    message: createTaskResumeStartedMessage(checkpoint, normalizedStepId),
    checkpoint,
  });
  const preparedTask: AppTask = {
    ...task,
    status: AUTOCUT_TASK_STATUS.processing,
    progressMessage: `Resuming ${checkpoint.workflowId} from ${normalizedStepId}...`,
    currentStepId: normalizedStepId,
    executionLogs: [...(task.executionLogs ?? []), resumeLog].slice(-500),
    ...(task.executionSteps
      ? { executionSteps: markTaskResumeStepRunning(task.executionSteps, normalizedStepId, timestamp) }
      : {}),
  };
  clearAutoCutTaskCancellationRequest(normalizedTaskId);
  replaceLocalTask(normalizedTaskId, preparedTask);

  try {
    return await handler(preparedTask, normalizedStepId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedTask = readLocalTasks().find((candidate) => candidate.id === normalizedTaskId) ?? preparedTask;
    const failedLog = createTaskResumeExecutionLog(failedTask, normalizedStepId, 'task-resume-failed', 'error', {
      timestamp: createAutoCutTimestamp(),
      message,
      ...(failedTask.executionCheckpoint ? { checkpoint: failedTask.executionCheckpoint } : {}),
    });
    replaceLocalTask(normalizedTaskId, {
      ...failedTask,
      status: AUTOCUT_TASK_STATUS.failed,
      progressMessage: 'Task resume failed.',
      errorMessage: message,
      executionLogs: [...(failedTask.executionLogs ?? []), failedLog].slice(-500),
    });
    throw error;
  }
}

export async function deleteTask(taskId: string): Promise<void> {
  const tasks = readLocalTasks();
  const deletedTask = tasks.find((task) => task.id === taskId);
  writeAutoCutStorage(
    'tasks',
    tasks.filter((task) => task.id !== taskId),
  );
  writeAutoCutStorage(
    'dismissedNativeTasks',
    addDismissedNativeTaskIds([taskId, ...(deletedTask?.nativeTaskId ? [deletedTask.nativeTaskId] : [])]),
  );
  dispatchAutoCutEvent('taskDeleted', { id: taskId });
}

export async function deleteTasks(taskIds: string[]): Promise<AutoCutTaskBulkDeleteResult> {
  const requestedTaskIds = taskIds.filter((taskId) => typeof taskId === 'string' && taskId.trim());
  const uniqueTaskIds = [...new Set(requestedTaskIds)];
  const { localTasks, tasksById, skippedTaskIds } = await findTasksByIds(uniqueTaskIds);
  const deletedTaskIds = uniqueTaskIds.filter((taskId) => tasksById.has(taskId));

  if (deletedTaskIds.length > 0) {
    const deletedTaskIdSet = new Set(deletedTaskIds);
    const dismissedTaskIds = deletedTaskIds.flatMap((taskId) => {
      const task = tasksById.get(taskId);
      return [taskId, ...(task?.nativeTaskId ? [task.nativeTaskId] : [])];
    });
    writeAutoCutStorage(
      'tasks',
      localTasks.filter((task) => !deletedTaskIdSet.has(task.id)),
    );
    writeAutoCutStorage('dismissedNativeTasks', addDismissedNativeTaskIds(dismissedTaskIds));
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
  const { localTasks, tasksById, nativeTaskIds, skippedTaskIds: missingTaskIds } = await findTasksByIds(uniqueTaskIds);
  const nativeHostClient = getAutoCutNativeHostClient();
  const capabilities = await nativeHostClient.getCapabilities();
  const canceledTaskIds: string[] = [];
  const skippedTaskIds = [...missingTaskIds];
  const localTaskIdSet = new Set(localTasks.map((task) => task.id));

  for (const taskId of uniqueTaskIds) {
    const task = tasksById.get(taskId);
    if (!task) {
      continue;
    }
    if (!isAutoCutTaskCancelableStatus(task.status)) {
      skippedTaskIds.push(taskId);
      continue;
    }

    const workflowCancelResult = localTaskIdSet.has(taskId)
      ? await requestAutoCutWorkflowTaskCancellation(task)
      : { accepted: false, message: 'No local workflow task is registered for cancellation.' };
    const nativeTaskId = nativeTaskIds.has(taskId) ? resolveNativeTaskOperationId(task) : undefined;
    let nativeCancelResult: Awaited<ReturnType<typeof nativeHostClient.cancelNativeTask>> | undefined;
    if (nativeTaskId) {
      if (!capabilities.nativeTaskCancelCommandReady) {
        if (!workflowCancelResult.accepted) {
          skippedTaskIds.push(taskId);
          continue;
        }
      } else {
        try {
          nativeCancelResult = await nativeHostClient.cancelNativeTask({ taskUuid: nativeTaskId });
          if (!nativeCancelResult.canceled && !workflowCancelResult.accepted) {
            skippedTaskIds.push(taskId);
            continue;
          }
        } catch {
          if (!workflowCancelResult.accepted) {
            skippedTaskIds.push(taskId);
            continue;
          }
        }
      }
    }

    if (!workflowCancelResult.accepted && !nativeCancelResult?.canceled) {
      skippedTaskIds.push(taskId);
      continue;
    }

    canceledTaskIds.push(taskId);
    const baseTask = readLocalTasks().find((candidate) => candidate.id === task.id) ?? task;
    const resolvedCancelNativeTaskId = nativeCancelResult?.taskUuid || workflowCancelResult.nativeTaskId || nativeTaskId;
    const updatedTask = markAutoCutTaskCancelRequested(baseTask, {
      timestamp: createAutoCutTimestamp(),
      message: nativeCancelResult?.message || workflowCancelResult.message || 'Cancel requested',
      ...(resolvedCancelNativeTaskId ? { nativeTaskId: resolvedCancelNativeTaskId } : {}),
    });
    if (!localTaskIdSet.has(taskId) || !replaceLocalTask(taskId, updatedTask)) {
      dispatchAutoCutEvent('taskUpdated', updatedTask);
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
  const { localTasks, tasksById, nativeTaskIds, skippedTaskIds: missingTaskIds } = await findTasksByIds(uniqueTaskIds);
  const nativeHostClient = getAutoCutNativeHostClient();
  const capabilities = await nativeHostClient.getCapabilities();
  const retriedTaskIds: string[] = [];
  const retryTaskIds: string[] = [];
  const skippedTaskIds = [...missingTaskIds];
  const localTaskIdSet = new Set(localTasks.map((task) => task.id));

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
      const nativeTaskId = resolveNativeTaskOperationId(task);
      if (!nativeTaskId) {
        skippedTaskIds.push(taskId);
        continue;
      }

      try {
        const result = await nativeHostClient.retryNativeTask({ taskUuid: nativeTaskId });
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
        const updatedTask: AppTask = {
          ...retryTask,
          id: localTaskIdSet.has(taskId) ? task.id : result.retryTaskUuid,
          nativeTaskId: result.retryTaskUuid,
          status: AUTOCUT_TASK_STATUS.processing,
          progress: 0,
          progressMessage: result.message || 'Retry queued',
        };
        if (!localTaskIdSet.has(taskId) || !replaceLocalTask(taskId, updatedTask)) {
          dispatchAutoCutEvent('taskUpdated', updatedTask);
        }
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

function isAutoCutTaskCancelableStatus(status: TaskStatus) {
  return status === AUTOCUT_TASK_STATUS.pending || status === AUTOCUT_TASK_STATUS.processing;
}

function isAutoCutTaskResumableStatus(status: TaskStatus) {
  return status === AUTOCUT_TASK_STATUS.failed ||
    status === AUTOCUT_TASK_STATUS.canceled ||
    status === AUTOCUT_TASK_STATUS.interrupted;
}

async function requestAutoCutWorkflowTaskCancellation(task: AppTask) {
  const handler = taskCancelHandlers.get(task.type);
  if (!handler) {
    return { accepted: false, message: 'No workflow cancel handler is registered.' };
  }

  taskCancellationRequests.add(task.id);
  try {
    const result = await handler(task);
    return {
      accepted: result?.success !== false,
      message: result?.message ?? 'Cancel requested',
      nativeTaskId: result?.nativeTaskId,
    };
  } catch (error) {
    taskCancellationRequests.delete(task.id);
    return {
      accepted: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function markAutoCutTaskCancelRequested(
  task: AppTask,
  params: {
    timestamp: string;
    message: string;
    nativeTaskId?: string;
  },
): AppTask {
  return {
    ...task,
    ...(params.nativeTaskId ? { nativeTaskId: params.nativeTaskId } : {}),
    status: AUTOCUT_TASK_STATUS.processing,
    progressMessage: params.message,
    executionLogs: [
      ...(task.executionLogs ?? []),
      createTaskCancelExecutionLog(task, params.timestamp, params.message),
    ].slice(-500),
    ...(task.executionSteps
      ? { executionSteps: markTaskCancelRequestedStep(task.executionSteps, params.timestamp, params.message) }
      : {}),
  };
}

function createTaskCancelExecutionLog(
  task: AppTask,
  timestamp: string,
  message: string,
): AutoCutTaskExecutionLog {
  return {
    id: createAutoCutId('task-log'),
    taskId: task.id,
    ...(task.currentStepId ? { stepId: task.currentStepId } : {}),
    eventType: 'task-cancel-requested',
    severity: 'warning',
    message,
    progress: task.progress,
    ...(task.currentStepId ? { phase: task.currentStepId } : {}),
    source: 'task-cancel-service',
    timestamp,
    details: {
      taskType: task.type,
      nativeTaskId: task.nativeTaskId,
      currentStepId: task.currentStepId,
      workflowId: task.executionCheckpoint?.workflowId,
      checkpointVersion: task.executionCheckpoint?.version,
      completedStepIds: task.executionCheckpoint?.completedStepIds ?? [],
      resumeFromStepIds: task.executionCheckpoint?.resumeFromStepIds ?? [],
    },
  };
}

function markTaskCancelRequestedStep(
  steps: readonly AutoCutTaskExecutionStep[],
  timestamp: string,
  message: string,
) {
  const runningStep = [...steps].reverse().find((step) =>
    step.status === 'running' || step.status === 'cancelRequested'
  );
  if (!runningStep) {
    return [...steps];
  }

  return steps.map((step): AutoCutTaskExecutionStep => {
    if (step.id !== runningStep.id) {
      return step;
    }

    const {
      completedAt,
      durationMs,
      ...stepWithoutCompletion
    } = step;
    void completedAt;
    void durationMs;

    return {
      ...stepWithoutCompletion,
      status: 'cancelRequested',
      canResumeFromHere: false,
      message,
      startedAt: step.startedAt ?? timestamp,
    };
  });
}

function createTaskResumeExecutionLog(
  task: AppTask,
  stepId: string,
  eventType: string,
  severity: AutoCutTaskExecutionLogSeverity,
  params: {
    timestamp: string;
    message: string;
    checkpoint?: AutoCutTaskExecutionCheckpoint;
  },
): AutoCutTaskExecutionLog {
  return {
    id: createAutoCutId('task-log'),
    taskId: task.id,
    stepId,
    eventType,
    severity,
    message: params.message,
    progress: task.progress,
    phase: stepId,
    source: 'task-resume-service',
    timestamp: params.timestamp,
    details: {
      stepId,
      taskType: task.type,
      workflowId: params.checkpoint?.workflowId,
      checkpointVersion: params.checkpoint?.version,
      completedStepIds: params.checkpoint?.completedStepIds ?? [],
      resumeFromStepIds: params.checkpoint?.resumeFromStepIds ?? [],
    },
  };
}

function createTaskResumeStartedMessage(
  checkpoint: AutoCutTaskExecutionCheckpoint,
  stepId: string,
) {
  const workflowLabel = checkpoint.workflowId === 'smart-slice' ? 'Smart Slice' : checkpoint.workflowId;
  return `Resuming ${workflowLabel} from step ${stepId}.`;
}

function markTaskResumeStepRunning(
  steps: readonly AutoCutTaskExecutionStep[],
  stepId: string,
  timestamp: string,
) {
  return steps.map((step): AutoCutTaskExecutionStep => {
    if (step.id !== stepId) {
      return step;
    }

    const {
      completedAt,
      durationMs,
      errorMessage,
      ...rest
    } = step;
    void completedAt;
    void durationMs;
    void errorMessage;

    return {
      ...rest,
      status: 'running',
      startedAt: timestamp,
      attempts: step.attempts + 1,
      canResumeFromHere: false,
      message: `Resuming from checkpoint ${step.checkpointKey ?? step.id}.`,
    };
  });
}

function replaceLocalTask(taskId: string, updatedTask: AppTask) {
  const localTasks = readLocalTasks();
  let replaced = false;
  writeAutoCutStorage(
    'tasks',
    localTasks.map((task) => {
      if (task.id === taskId) {
        replaced = true;
        return updatedTask;
      }
      return task;
    }),
  );

  if (replaced) {
    dispatchAutoCutEvent('taskUpdated', updatedTask);
  }
  return replaced;
}

function resolveNativeTaskOperationId(task: AppTask) {
  return task.nativeTaskId?.trim() || task.id;
}

async function findTasksByIds(taskIds: readonly string[]): Promise<TaskLookupResult> {
  const localTasks = readLocalTasks();
  const tasksById = new Map(localTasks.map((task) => [task.id, task]));
  const nativeTaskIds = new Set<string>();
  const requestedTaskIdSet = new Set(taskIds);
  localTasks.forEach((task) => {
    if (requestedTaskIdSet.has(task.id) && task.nativeTaskId) {
      nativeTaskIds.add(task.id);
    }
  });
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
  const execution = createNativeTaskExecutionProjection(snapshot);
  return {
    id: snapshot.uuid,
    nativeTaskId: snapshot.uuid,
    type: TASK_TYPE_BY_NATIVE_TYPE[snapshot.taskType] ?? AUTOCUT_TASK_TYPE.videoSlice,
    name: resolveNativeTaskName(snapshot, parseJsonRecord(snapshot.inputJson), parseJsonRecord(snapshot.outputJson)),
    status: mapNativeStatus(snapshot.status),
    progress: clampProgress(snapshot.progress),
    createdAt: snapshot.createdAt,
    ...(snapshot.errorMessage ? { errorMessage: snapshot.errorMessage } : {}),
    ...(snapshot.sourceAssetUuid ? { sourceFileId: snapshot.sourceAssetUuid } : {}),
    ...(progressMessage ? { progressMessage } : {}),
    ...(execution.currentStepId ? { currentStepId: execution.currentStepId } : {}),
    ...(execution.executionSteps.length ? { executionSteps: execution.executionSteps } : {}),
    ...(execution.executionLogs.length ? { executionLogs: execution.executionLogs } : {}),
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
  const localTaskByNativeTaskId = new Map<string, AppTask>();

  localTasks.forEach((task) => {
    tasksById.set(task.id, task);
    if (task.nativeTaskId) {
      localTaskByNativeTaskId.set(task.nativeTaskId, task);
    }
  });

  nativeTasks.forEach((nativeTask) => {
    const localTask = localTaskByNativeTaskId.get(nativeTask.id);
    if (localTask) {
      tasksById.set(localTask.id, mergeNativeTaskProjectionIntoLocalTask(localTask, nativeTask));
      return;
    }
    tasksById.set(nativeTask.id, nativeTask);
  });
  return [...tasksById.values()];
}

function mergeNativeTaskProjectionIntoLocalTask(localTask: AppTask, nativeTask: AppTask): AppTask {
  if (isAutoCutTaskResumableStatus(localTask.status)) {
    return localTask;
  }

  return {
    ...nativeTask,
    ...localTask,
    id: localTask.id,
    nativeTaskId: localTask.nativeTaskId ?? nativeTask.id,
    ...(
      localTask.sourceFileId ?? nativeTask.sourceFileId
        ? { sourceFileId: localTask.sourceFileId ?? nativeTask.sourceFileId }
        : {}
    ),
    ...(
      localTask.generatedAssetIds ?? nativeTask.generatedAssetIds
        ? { generatedAssetIds: localTask.generatedAssetIds ?? nativeTask.generatedAssetIds }
        : {}
    ),
    ...(
      localTask.sliceResults ?? nativeTask.sliceResults
        ? { sliceResults: localTask.sliceResults ?? nativeTask.sliceResults }
        : {}
    ),
  };
}

function isNativeSpeechTranscriptionImplementationTask(snapshot: AutoCutNativeTaskSnapshot) {
  return snapshot.taskType === OPS_TASK_TYPE_SPEECH_TRANSCRIPTION;
}

function readDismissedNativeTaskIds() {
  return readAutoCutStorage<string[]>('dismissedNativeTasks', EMPTY_DISMISSED_NATIVE_TASK_IDS).filter(
    (taskId) => typeof taskId === 'string' && taskId.trim(),
  );
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
    ...(projection.currentStepId ? { currentStepId: projection.currentStepId } : {}),
    ...(projection.executionSteps?.length ? { executionSteps: projection.executionSteps } : {}),
    ...(projection.executionLogs?.length ? { executionLogs: projection.executionLogs } : {}),
    ...(projection.resultCount !== undefined ? { resultCount: projection.resultCount } : {}),
    ...(projection.generatedAssetIds ? { generatedAssetIds: projection.generatedAssetIds } : {}),
    ...(projection.sliceResults ? { sliceResults: projection.sliceResults } : {}),
    ...(projection.sourceFileId ? { sourceFileId: projection.sourceFileId } : {}),
    nativeTaskId: snapshot.uuid,
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
  const execution = createNativeTaskExecutionProjection(snapshot);
  const baseProjection: NativeTaskProjection = {
    ...(snapshot.sourceAssetUuid ? { sourceFileId: snapshot.sourceAssetUuid } : {}),
    ...(snapshot.status === OPS_STATUS_COMPLETED ||
      snapshot.status === OPS_STATUS_FAILED ||
      snapshot.status === OPS_STATUS_CANCELED ||
      snapshot.status === OPS_STATUS_INTERRUPTED
      ? { completedAt: snapshot.updatedAt }
      : {}),
    ...(execution.currentStepId ? { currentStepId: execution.currentStepId } : {}),
    ...(execution.executionSteps.length ? { executionSteps: execution.executionSteps } : {}),
    ...(execution.executionLogs.length ? { executionLogs: execution.executionLogs } : {}),
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

export function createNativeTaskExecutionProjection(snapshot: AutoCutNativeTaskSnapshot): {
  currentStepId?: string;
  executionSteps: AutoCutTaskExecutionStep[];
  executionLogs: AutoCutTaskExecutionLog[];
} {
  const executionLogs = snapshot.events.map((event, index) =>
    mapNativeTaskEventToExecutionLog(snapshot, event, index)
  );
  const stepById = new Map<string, AutoCutTaskExecutionStep>();

  for (const log of executionLogs) {
    const stepId = log.stepId ?? resolveNativeTaskEventStepId(log.phase, log.eventType);
    if (!stepId) {
      continue;
    }
    const existingStep = stepById.get(stepId);
    const nextStatus = resolveExecutionStepStatus(log.eventType, snapshot.status);
    const nextProgress = typeof log.progress === 'number'
      ? clampProgress(log.progress)
      : existingStep?.progress ?? 0;
    const nextStep: AutoCutTaskExecutionStep = {
      id: stepId,
      label: resolveExecutionStepLabel(stepId, log),
      status: nextStatus ?? existingStep?.status ?? 'running',
      progress: nextProgress,
      startedAt: existingStep?.startedAt ?? log.timestamp,
      ...(existingStep?.completedAt ? { completedAt: existingStep.completedAt } : {}),
      attempts: existingStep?.attempts ?? 1,
      canResumeFromHere: canResumeFromExecutionStep(stepId, nextStatus ?? existingStep?.status),
      ...(log.message ? { message: log.message } : existingStep?.message ? { message: existingStep.message } : {}),
      ...(log.severity === 'error' ? { errorMessage: log.message } : existingStep?.errorMessage ? { errorMessage: existingStep.errorMessage } : {}),
    };

    if (nextStep.status === 'completed' || nextStep.status === 'failed' || nextStep.status === 'canceled' || nextStep.status === 'interrupted') {
      nextStep.completedAt = log.timestamp;
    }
    if (nextStep.startedAt && nextStep.completedAt) {
      const durationMs = createTimestampDurationMs(nextStep.startedAt, nextStep.completedAt);
      if (durationMs !== undefined) {
        nextStep.durationMs = durationMs;
      }
    }
    stepById.set(stepId, nextStep);
  }

  const executionSteps = [...stepById.values()];
  const currentStep = [...executionSteps].reverse().find((step) =>
    step.status === 'running' || step.status === 'cancelRequested'
  ) ?? [...executionSteps].reverse().find((step) => step.status !== 'completed');

  return {
    ...(currentStep ? { currentStepId: currentStep.id } : {}),
    executionSteps,
    executionLogs,
  };
}

function resolveNativeProgressTaskUuid(progress: AutoCutNativeTaskProgressEvent) {
  return readString(progress.nativeTaskId) ??
    readString(progress.taskUuid) ??
    readString(progress.payload?.nativeTaskId) ??
    readString(progress.payload?.taskUuid);
}

function mapNativeTaskProgressEventToExecutionLog(
  progress: AutoCutNativeTaskProgressEvent,
  workflowTaskId: string,
  nativeTaskId: string | undefined,
): AutoCutTaskExecutionLog {
  const payload: JsonRecord = {
    ...(progress.payload ?? {}),
    ...(progress.workflowTaskId ? { workflowTaskId: progress.workflowTaskId } : {}),
    ...(nativeTaskId ? { nativeTaskId } : {}),
    taskUuid: progress.taskUuid,
    ...(progress.operation ? { operation: progress.operation } : {}),
  };
  const phase = readString(progress.phase ?? payload.phase);
  const stepId = readString(progress.stepId ?? payload.stepId) ?? resolveNativeTaskEventStepId(phase, progress.eventType);
  const progressValue = typeof progress.progress === 'number'
    ? clampProgress(progress.progress)
    : readNumber(payload.progress);
  const message = progress.message?.trim() ||
    readString(payload.message) ||
    readString(payload.label) ||
    phase ||
    nativeTaskEventTypeLabel(progress.eventType);
  const source = readString(progress.source ?? payload.source);

  return {
    id: progress.eventUuid?.trim() || createAutoCutId('native-task-log'),
    taskId: workflowTaskId,
    ...(stepId ? { stepId } : {}),
    eventType: String(progress.eventType),
    severity: normalizeExecutionLogSeverity(progress.severity, Number(progress.eventType)),
    message,
    ...(progressValue !== undefined ? { progress: clampProgress(progressValue) } : {}),
    ...(phase ? { phase } : {}),
    ...(source ? { source } : {}),
    timestamp: progress.timestamp?.trim() || createAutoCutTimestamp(),
    details: payload,
  };
}

function appendNativeTaskExecutionLog(
  existingLogs: readonly AutoCutTaskExecutionLog[] | undefined,
  log: AutoCutTaskExecutionLog,
) {
  const logs = existingLogs ?? [];
  const existingLogIndex = logs.findIndex((existingLog) => existingLog.id === log.id);
  if (existingLogIndex >= 0) {
    return logs.map((existingLog, index) => (index === existingLogIndex ? log : existingLog));
  }

  return [...logs, log].slice(-500);
}

function isDuplicateNativeTaskProgressEvent(
  existingLogs: readonly AutoCutTaskExecutionLog[] | undefined,
  log: AutoCutTaskExecutionLog,
) {
  if (!log.id || !existingLogs?.length) {
    return false;
  }

  return existingLogs.some((existingLog) => existingLog.id === log.id);
}

function shouldPersistNativeTaskProgressEvent(
  task: AppTask,
  log: AutoCutTaskExecutionLog,
) {
  const eventType = Number(log.eventType);
  if (eventType !== NATIVE_TASK_EVENT_TYPE_PROGRESS) {
    return true;
  }
  if (log.severity === 'error' || log.severity === 'warning') {
    return true;
  }
  const progress = typeof log.progress === 'number' ? clampProgress(log.progress) : undefined;
  if (progress === undefined) {
    return true;
  }
  if (progress <= 1 || progress >= 99 || progress % NATIVE_TASK_PROGRESS_LOG_MILESTONE_PERCENT === 0) {
    return true;
  }

  const previousSameStepPhaseLog = [...(task.executionLogs ?? [])]
    .reverse()
    .find((existingLog) =>
      (log.stepId ? existingLog.stepId === log.stepId : true) &&
      (log.phase ? existingLog.phase === log.phase : true) &&
      existingLog.eventType === log.eventType &&
      typeof existingLog.progress === 'number'
    );
  const previousProgress = previousSameStepPhaseLog?.progress;
  if (previousProgress === undefined) {
    return false;
  }

  return Math.floor(progress / NATIVE_TASK_PROGRESS_LOG_MILESTONE_PERCENT) >
    Math.floor(clampProgress(previousProgress) / NATIVE_TASK_PROGRESS_LOG_MILESTONE_PERCENT);
}

function shouldProjectNativeTaskProgressEventBeforeStorage(
  progress: AutoCutNativeTaskProgressEvent,
  targetTaskId: string,
  nativeTaskId: string | undefined,
) {
  const eventType = Number(progress.eventType);
  if (eventType !== NATIVE_TASK_EVENT_TYPE_PROGRESS) {
    forgetNativeTaskProgressProjectionState(progress, targetTaskId, nativeTaskId);
    return true;
  }
  const severity = normalizeExecutionLogSeverity(readString(progress.severity), eventType);
  if (severity === 'error' || severity === 'warning') {
    return true;
  }
  const progressValue = readNativeTaskProgressEventProgress(progress);
  if (progressValue === undefined) {
    return true;
  }
  if (progressValue <= 1 || progressValue >= 99 || progressValue % NATIVE_TASK_PROGRESS_LOG_MILESTONE_PERCENT === 0) {
    return true;
  }

  const projectionKey = createNativeTaskProgressProjectionStateKey(progress, targetTaskId, nativeTaskId);
  const previousState = nativeTaskProgressProjectionStateByKey.get(projectionKey);
  if (!previousState) {
    return false;
  }

  return getNativeTaskProgressMilestoneBucket(progressValue) > previousState.progressBucket;
}

function hasSeenNativeTaskProgressEventUuidBeforeStorage(progress: AutoCutNativeTaskProgressEvent) {
  const eventUuid = progress.eventUuid?.trim();
  return eventUuid ? nativeTaskProgressEventUuidSeenBeforeStorage.has(eventUuid) : false;
}

function recordNativeTaskProgressEventUuidBeforeStorage(progress: AutoCutNativeTaskProgressEvent) {
  const eventUuid = progress.eventUuid?.trim();
  if (!eventUuid) {
    return;
  }

  nativeTaskProgressEventUuidSeenBeforeStorage.set(eventUuid, true);
  trimNativeTaskProgressEventUuidState();
}

function recordNativeTaskProgressProjectionState(
  progress: AutoCutNativeTaskProgressEvent,
  targetTaskId: string,
  nativeTaskId: string | undefined,
) {
  const progressValue = readNativeTaskProgressEventProgress(progress);
  if (progressValue === undefined) {
    return;
  }

  nativeTaskProgressProjectionStateByKey.set(
    createNativeTaskProgressProjectionStateKey(progress, targetTaskId, nativeTaskId),
    {
      progress: progressValue,
      progressBucket: getNativeTaskProgressMilestoneBucket(progressValue),
    },
  );
  trimNativeTaskProgressProjectionState();
}

function forgetNativeTaskProgressProjectionState(
  progress: AutoCutNativeTaskProgressEvent,
  targetTaskId: string,
  nativeTaskId: string | undefined,
) {
  nativeTaskProgressProjectionStateByKey.delete(
    createNativeTaskProgressProjectionStateKey(progress, targetTaskId, nativeTaskId),
  );
}

function readNativeTaskProgressEventProgress(progress: AutoCutNativeTaskProgressEvent) {
  const progressValue = typeof progress.progress === 'number'
    ? progress.progress
    : readNumber(progress.payload?.progress);
  return progressValue === undefined ? undefined : clampProgress(progressValue);
}

function getNativeTaskProgressMilestoneBucket(progress: number) {
  return Math.floor(clampProgress(progress) / NATIVE_TASK_PROGRESS_LOG_MILESTONE_PERCENT);
}

function createNativeTaskProgressProjectionStateKey(
  progress: AutoCutNativeTaskProgressEvent,
  targetTaskId: string,
  nativeTaskId: string | undefined,
) {
  const phase = readString(progress.phase ?? progress.payload?.phase) ?? 'progress';
  const stepId = readString(progress.stepId ?? progress.payload?.stepId) ?? resolveNativeTaskEventStepId(phase, progress.eventType) ?? 'unknown-step';
  return [
    targetTaskId,
    nativeTaskId ?? '',
    String(progress.eventType),
    stepId,
    phase,
  ].join('|');
}

function trimNativeTaskProgressProjectionState() {
  while (nativeTaskProgressProjectionStateByKey.size > NATIVE_TASK_PROGRESS_PROJECTION_STATE_LIMIT) {
    const oldestKey = nativeTaskProgressProjectionStateByKey.keys().next().value;
    if (!oldestKey) {
      return;
    }
    nativeTaskProgressProjectionStateByKey.delete(oldestKey);
  }
}

function trimNativeTaskProgressEventUuidState() {
  while (nativeTaskProgressEventUuidSeenBeforeStorage.size > NATIVE_TASK_PROGRESS_EVENT_UUID_STATE_LIMIT) {
    const oldestKey = nativeTaskProgressEventUuidSeenBeforeStorage.keys().next().value;
    if (!oldestKey) {
      return;
    }
    nativeTaskProgressEventUuidSeenBeforeStorage.delete(oldestKey);
  }
}

function updateNativeTaskProgressExecutionSteps(
  existingSteps: readonly AutoCutTaskExecutionStep[] | undefined,
  log: AutoCutTaskExecutionLog,
  taskStatus: TaskStatus,
) {
  const stepId = log.stepId ?? resolveNativeTaskEventStepId(log.phase, log.eventType);
  if (!stepId) {
    return [...(existingSteps ?? [])];
  }

  const numericTaskStatus = mapTaskStatusToNativeStatus(taskStatus);
  const steps = existingSteps ?? [];
  const stepIndex = steps.findIndex((step) => step.id === stepId);
  const existingStep = stepIndex >= 0 ? steps[stepIndex] : undefined;
  const nextStatus = resolveExecutionStepStatus(log.eventType, numericTaskStatus) ?? existingStep?.status ?? 'running';
  const nextProgress = typeof log.progress === 'number'
    ? clampProgress(log.progress)
    : existingStep?.progress ?? 0;
  const nextStep: AutoCutTaskExecutionStep = {
    id: stepId,
    label: existingStep?.label ?? resolveExecutionStepLabel(stepId, log),
    status: nextStatus,
    progress: nextProgress,
    startedAt: existingStep?.startedAt ?? log.timestamp,
    ...(existingStep?.completedAt ? { completedAt: existingStep.completedAt } : {}),
    attempts: existingStep?.attempts ?? 1,
    canResumeFromHere: canResumeFromExecutionStep(stepId, nextStatus),
    ...(existingStep?.checkpointKey ? { checkpointKey: existingStep.checkpointKey } : {}),
    ...(existingStep?.inputArtifactRefs ? { inputArtifactRefs: existingStep.inputArtifactRefs } : {}),
    ...(existingStep?.outputArtifactRefs ? { outputArtifactRefs: existingStep.outputArtifactRefs } : {}),
    ...(log.message ? { message: log.message } : existingStep?.message ? { message: existingStep.message } : {}),
    ...(log.severity === 'error' ? { errorMessage: log.message } : existingStep?.errorMessage ? { errorMessage: existingStep.errorMessage } : {}),
    ...(existingStep?.diagnostics ? { diagnostics: existingStep.diagnostics } : {}),
  };

  if (nextStep.status === 'completed' || nextStep.status === 'failed' || nextStep.status === 'canceled' || nextStep.status === 'interrupted') {
    nextStep.completedAt = log.timestamp;
  }
  if (nextStep.startedAt && nextStep.completedAt) {
    const durationMs = createTimestampDurationMs(nextStep.startedAt, nextStep.completedAt);
    if (durationMs !== undefined) {
      nextStep.durationMs = durationMs;
    }
  }

  if (stepIndex < 0) {
    return [...steps, nextStep];
  }

  return steps.map((step, index) => (index === stepIndex ? nextStep : step));
}

function mapNativeTaskEventToExecutionLog(
  snapshot: AutoCutNativeTaskSnapshot,
  event: AutoCutNativeTaskSnapshot['events'][number],
  index: number,
): AutoCutTaskExecutionLog {
  const payload = event.payload ?? {};
  const phase = readString(payload.phase);
  const stepId = readString(payload.stepId) ?? resolveNativeTaskEventStepId(phase, String(event.eventType));
  const progress = readNumber(payload.progress);
  const severity = normalizeExecutionLogSeverity(readString(payload.severity), event.eventType);
  const source = readString(payload.source);
  const message = readString(payload.message) ??
    readString(payload.label) ??
    phase ??
    nativeTaskEventTypeLabel(event.eventType);

  return {
    id: event.uuid || `${snapshot.uuid}-event-${index + 1}`,
    taskId: snapshot.uuid,
    ...(stepId ? { stepId } : {}),
    eventType: String(event.eventType),
    severity,
    message,
    ...(progress !== undefined ? { progress: clampProgress(progress) } : {}),
    ...(phase ? { phase } : {}),
    ...(source ? { source } : {}),
    timestamp: event.createdAt,
    details: payload,
  };
}

function resolveNativeTaskEventStepId(phase: string | undefined, eventType: string | number) {
  const normalizedPhase = phase?.trim();
  if (!normalizedPhase) {
    return nativeTaskEventTypeLabel(eventType);
  }
  if (normalizedPhase.includes('speech-audio')) {
    return 'extract-audio';
  }
  if (normalizedPhase.includes('whisper') || normalizedPhase.includes('transcript') || normalizedPhase.includes('speech-transcription')) {
    return 'speech-to-text';
  }
  if (normalizedPhase.includes('ffmpeg-progress') || normalizedPhase.includes('render') || normalizedPhase.includes('slice')) {
    return 'native-render';
  }
  return normalizedPhase;
}

function resolveExecutionStepLabel(stepId: string, log: AutoCutTaskExecutionLog) {
  const knownLabels: Record<string, string> = {
    'prepare-source': 'Prepare source media',
    'extract-audio': 'Extract speech audio',
    'speech-to-text': 'Run speech-to-text',
    'plan-clips': 'Plan clips',
    'analyze-audio-boundaries': 'Analyze audio boundaries',
    'analyze-duplicates': 'Analyze duplicate content',
    'native-render': 'Render clips',
    'verify-artifacts': 'Verify artifacts',
    'persist-results': 'Persist results',
  };
  return knownLabels[stepId] ?? log.phase ?? stepId;
}

function resolveExecutionStepStatus(
  eventType: string,
  taskStatus: number,
): AutoCutTaskExecutionStepStatus | undefined {
  const numericEventType = Number(eventType);
  if (numericEventType === NATIVE_TASK_EVENT_TYPE_COMPLETED) {
    return 'completed';
  }
  if (numericEventType === NATIVE_TASK_EVENT_TYPE_FAILED) {
    return 'failed';
  }
  if (numericEventType === NATIVE_TASK_EVENT_TYPE_CANCEL_REQUESTED) {
    return 'cancelRequested';
  }
  if (numericEventType === NATIVE_TASK_EVENT_TYPE_CANCELED) {
    return 'canceled';
  }
  if (numericEventType === NATIVE_TASK_EVENT_TYPE_INTERRUPTED) {
    return 'interrupted';
  }
  if (numericEventType === NATIVE_TASK_EVENT_TYPE_STARTED || numericEventType === NATIVE_TASK_EVENT_TYPE_PROGRESS) {
    return taskStatus === OPS_STATUS_COMPLETED ? 'completed' : 'running';
  }
  return undefined;
}

function normalizeExecutionLogSeverity(
  severity: string | undefined,
  eventType: number,
): AutoCutTaskExecutionLogSeverity {
  if (severity === 'debug' || severity === 'info' || severity === 'warning' || severity === 'error') {
    return severity;
  }
  if (eventType === NATIVE_TASK_EVENT_TYPE_FAILED) {
    return 'error';
  }
  if (eventType === NATIVE_TASK_EVENT_TYPE_INTERRUPTED || eventType === NATIVE_TASK_EVENT_TYPE_CANCELED) {
    return 'warning';
  }
  return 'info';
}

function nativeTaskEventTypeLabel(eventType: string | number) {
  switch (Number(eventType)) {
    case NATIVE_TASK_EVENT_TYPE_STARTED:
      return 'started';
    case NATIVE_TASK_EVENT_TYPE_COMPLETED:
      return 'completed';
    case NATIVE_TASK_EVENT_TYPE_FAILED:
      return 'failed';
    case NATIVE_TASK_EVENT_TYPE_CANCEL_REQUESTED:
      return 'cancel-requested';
    case NATIVE_TASK_EVENT_TYPE_CANCELED:
      return 'canceled';
    case NATIVE_TASK_EVENT_TYPE_INTERRUPTED:
      return 'interrupted';
    case NATIVE_TASK_EVENT_TYPE_RETRY_REQUESTED:
      return 'retry-requested';
    case NATIVE_TASK_EVENT_TYPE_PROGRESS:
      return 'progress';
    default:
      return 'event';
  }
}

function canResumeFromExecutionStep(stepId: string, status: AutoCutTaskExecutionStepStatus | undefined) {
  if (status !== 'completed' && status !== 'failed' && status !== 'interrupted' && status !== 'canceled') {
    return false;
  }
  return stepId === 'extract-audio' ||
    stepId === 'speech-to-text' ||
    stepId === 'plan-clips' ||
    stepId === 'analyze-audio-boundaries' ||
    stepId === 'analyze-duplicates' ||
    stepId === 'native-render';
}

function createTimestampDurationMs(startedAt: string, completedAt: string) {
  const started = getAutoCutTimestampMs(startedAt);
  const completed = getAutoCutTimestampMs(completedAt);
  return completed >= started
    ? completed - started
    : undefined;
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

  if (status === OPS_STATUS_FAILED) {
    return AUTOCUT_TASK_STATUS.failed;
  }

  if (status === OPS_STATUS_CANCELED) {
    return AUTOCUT_TASK_STATUS.canceled;
  }

  if (status === OPS_STATUS_INTERRUPTED) {
    return AUTOCUT_TASK_STATUS.interrupted;
  }

  if (status === OPS_STATUS_PROCESSING || status === OPS_STATUS_CANCEL_REQUESTED) {
    return AUTOCUT_TASK_STATUS.processing;
  }

  return AUTOCUT_TASK_STATUS.pending;
}

function mapTaskStatusToNativeStatus(status: TaskStatus) {
  if (status === AUTOCUT_TASK_STATUS.completed) {
    return OPS_STATUS_COMPLETED;
  }
  if (status === AUTOCUT_TASK_STATUS.failed) {
    return OPS_STATUS_FAILED;
  }
  if (status === AUTOCUT_TASK_STATUS.canceled) {
    return OPS_STATUS_CANCELED;
  }
  if (status === AUTOCUT_TASK_STATUS.interrupted) {
    return OPS_STATUS_INTERRUPTED;
  }
  if (status === AUTOCUT_TASK_STATUS.processing) {
    return OPS_STATUS_PROCESSING;
  }
  return 0;
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
  const audioCleanupEvidence = readAutoCutSliceAudioCleanupEvidence(slice);
  const renderedDurationMs = readNumber(slice.renderedDurationMs) ?? durationMs;
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
    duration: Math.max(1, Math.round(renderedDurationMs / 1_000)),
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
    ...(renderedDurationMs !== undefined ? { renderedDurationMs } : {}),
    ...audioCleanupEvidence,
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

function createUpdatedTaskSliceTranscript(
  slice: TaskSliceResult,
  update: AutoCutTaskSliceTranscriptUpdate,
): TaskSliceResult {
  const transcriptSegments = update.transcriptSegments !== undefined
    ? update.transcriptSegments.map(normalizeEditableTranscriptSegment)
    : update.transcriptText !== undefined
      ? undefined
      : slice.transcriptSegments?.map(normalizeEditableTranscriptSegment);
  const transcriptText = transcriptSegments?.length
    ? createRecoveredNativeVideoSliceTranscriptText(transcriptSegments)
    : normalizeRecoveredNativeVideoSliceTranscriptText(update.transcriptText ?? slice.transcriptText);

  if (!transcriptText) {
    throw new Error('AutoCut task transcript edit requires non-empty transcript text.');
  }

  const {
    transcriptText: _previousTranscriptText,
    transcriptSegments: _previousTranscriptSegments,
    transcriptSegmentCount: _previousTranscriptSegmentCount,
    transcriptCorrection: _previousTranscriptCorrection,
    ...sliceWithoutTranscript
  } = slice;
  void _previousTranscriptText;
  void _previousTranscriptSegments;
  void _previousTranscriptSegmentCount;
  void _previousTranscriptCorrection;
  const originalTranscriptText = slice.transcriptCorrection?.originalTranscriptText ||
    normalizeRecoveredNativeVideoSliceTranscriptText(slice.transcriptText);
  const correctionCount = transcriptSegments?.length
    ? countChangedTranscriptSegments(slice.transcriptSegments, transcriptSegments)
    : normalizeRecoveredNativeVideoSliceTranscriptText(slice.transcriptText) === transcriptText
      ? 0
      : 1;

  return {
    ...sliceWithoutTranscript,
    transcriptText,
    ...(transcriptSegments?.length
      ? {
          transcriptSegments,
          transcriptSegmentCount: transcriptSegments.length,
        }
      : {}),
    transcriptCorrection: {
      source: 'task-detail',
      correctedAt: createAutoCutTimestamp(),
      originalTranscriptText,
      correctionCount: Math.max(1, correctionCount),
    },
  };
}

function countChangedTranscriptSegments(
  previousSegments: readonly AutoCutTranscriptSegment[] | undefined,
  nextSegments: readonly AutoCutTranscriptSegment[],
) {
  const maxLength = Math.max(previousSegments?.length ?? 0, nextSegments.length);
  let changedCount = 0;
  for (let index = 0; index < maxLength; index += 1) {
    const previousSegment = previousSegments?.[index];
    const nextSegment = nextSegments[index];
    if (!previousSegment || !nextSegment) {
      changedCount += 1;
      continue;
    }

    if (
      normalizeRecoveredNativeVideoSliceTranscriptText(previousSegment.text) !==
        normalizeRecoveredNativeVideoSliceTranscriptText(nextSegment.text) ||
      normalizeRecoveredNativeVideoSliceTranscriptText(previousSegment.speaker) !==
        normalizeRecoveredNativeVideoSliceTranscriptText(nextSegment.speaker)
    ) {
      changedCount += 1;
    }
  }

  return changedCount;
}

function isTaskSliceTranscriptSegmentUpdate(
  update: readonly AutoCutTranscriptSegment[] | AutoCutTaskSliceTranscriptUpdate,
): update is readonly AutoCutTranscriptSegment[] {
  return Array.isArray(update);
}

function normalizeEditableTranscriptSegment(segment: AutoCutTranscriptSegment): AutoCutTranscriptSegment {
  const text = normalizeRecoveredNativeVideoSliceTranscriptText(segment.text);
  if (!text) {
    throw new Error('AutoCut task transcript edit requires every transcript segment to keep non-empty text.');
  }

  const speaker = normalizeRecoveredNativeVideoSliceTranscriptText(segment.speaker);
  return {
    startMs: Math.round(segment.startMs),
    endMs: Math.round(segment.endMs),
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

function readAutoCutSliceBoundaryDecisionSource(value: unknown): TaskSliceResult['boundaryDecisionSource'] | undefined {
  const source = readString(value);
  if (source === 'transcript' || source === 'audio' || source === 'combined') {
    return source;
  }

  return undefined;
}

function readAutoCutSliceTailTreatment(value: unknown): TaskSliceResult['tailTreatment'] | undefined {
  const treatment = readString(value);
  if (treatment === 'none' || treatment === 'semantic-extend' || treatment === 'fade-out') {
    return treatment;
  }

  return undefined;
}

function readAutoCutSliceRisks(value: unknown): string[] | undefined {
  const seen = new Set<string>();
  const risks = readArray(value)
    .map((risk) => readString(risk)?.trim().replace(/\s+/gu, ' ').slice(0, 48))
    .filter((risk): risk is string => Boolean(risk))
    .filter((risk) => {
      if (seen.has(risk)) {
        return false;
      }
      seen.add(risk);
      return true;
    })
    .slice(0, 12);

  return risks.length ? risks : undefined;
}

function readAutoCutSliceSourceSegments(value: unknown): TaskSliceResult['sourceSegments'] | undefined {
  const sourceSegments = readArray(value)
    .map((segment) => {
      const record = readRecord(segment);
      if (!record) {
        return null;
      }

      const startMs = readNumber(record.startMs);
      const endMs = readNumber(record.endMs);
      if (
        startMs === undefined ||
        endMs === undefined ||
        !Number.isFinite(startMs) ||
        !Number.isFinite(endMs) ||
        endMs <= startMs
      ) {
        return null;
      }

      return {
        startMs: Math.round(startMs),
        endMs: Math.round(endMs),
      };
    })
    .filter((segment): segment is NonNullable<TaskSliceResult['sourceSegments']>[number] => Boolean(segment))
    .sort((firstSegment, secondSegment) =>
      firstSegment.startMs - secondSegment.startMs ||
        firstSegment.endMs - secondSegment.endMs,
    );

  return sourceSegments.length > 1 ? sourceSegments : undefined;
}

function readAutoCutSliceAudioCleanupEvidence(value: JsonRecord): Partial<AutoCutSliceAudioCleanupEvidence> {
  const audioCleanupProfile = readString(value.audioCleanupProfile)?.trim();
  const noiseReductionApplied = readBoolean(value.noiseReductionApplied);
  const boundaryDecisionSource = readAutoCutSliceBoundaryDecisionSource(value.boundaryDecisionSource);
  const audioActivityStartMs = readNumber(value.audioActivityStartMs);
  const audioActivityEndMs = readNumber(value.audioActivityEndMs);
  const audioActivityConfidence = readNumber(value.audioActivityConfidence);
  const audioActivityAnalysisFilter = readString(value.audioActivityAnalysisFilter)?.trim();
  const leadingSilenceMs = readNumber(value.leadingSilenceMs);
  const trailingSilenceMs = readNumber(value.trailingSilenceMs);
  const leadingSilenceTrimMs = readNumber(value.leadingSilenceTrimMs);
  const trailingSilenceTrimMs = readNumber(value.trailingSilenceTrimMs);
  const sourceSegments = readAutoCutSliceSourceSegments(value.sourceSegments);
  const renderedDurationMs = readNumber(value.renderedDurationMs);
  const removedSilenceMs = readNumber(value.removedSilenceMs);
  const internalSilenceTrimCount = readNumber(value.internalSilenceTrimCount);
  const tailTreatment = readAutoCutSliceTailTreatment(value.tailTreatment);

  return {
    ...(audioCleanupProfile ? { audioCleanupProfile } : {}),
    ...(noiseReductionApplied !== undefined ? { noiseReductionApplied } : {}),
    ...(boundaryDecisionSource ? { boundaryDecisionSource } : {}),
    ...(audioActivityStartMs !== undefined ? { audioActivityStartMs } : {}),
    ...(audioActivityEndMs !== undefined ? { audioActivityEndMs } : {}),
    ...(audioActivityConfidence !== undefined ? { audioActivityConfidence } : {}),
    ...(audioActivityAnalysisFilter ? { audioActivityAnalysisFilter } : {}),
    ...(leadingSilenceMs !== undefined ? { leadingSilenceMs } : {}),
    ...(trailingSilenceMs !== undefined ? { trailingSilenceMs } : {}),
    ...(leadingSilenceTrimMs !== undefined ? { leadingSilenceTrimMs } : {}),
    ...(trailingSilenceTrimMs !== undefined ? { trailingSilenceTrimMs } : {}),
    ...(sourceSegments ? { sourceSegments } : {}),
    ...(renderedDurationMs !== undefined ? { renderedDurationMs } : {}),
    ...(removedSilenceMs !== undefined ? { removedSilenceMs } : {}),
    ...(internalSilenceTrimCount !== undefined ? { internalSilenceTrimCount } : {}),
    ...(tailTreatment ? { tailTreatment } : {}),
  };
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
  const sourceSegments = readAutoCutSliceSourceSegments(clip.sourceSegments);
  const renderedDurationMs = readNumber(clip.renderedDurationMs);
  const removedSilenceMs = readNumber(clip.removedSilenceMs);
  const internalSilenceTrimCount = readNumber(clip.internalSilenceTrimCount);
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
  const risks = readAutoCutSliceRisks(clip.risks);
  const boundaryPaddingBeforeMs = readNumber(clip.boundaryPaddingBeforeMs);
  const boundaryPaddingAfterMs = readNumber(clip.boundaryPaddingAfterMs);
  const audioCleanupEvidence = readAutoCutSliceAudioCleanupEvidence(clip);

  return {
    ...(startMs !== undefined ? { startMs } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(sourceSegments ? { sourceSegments } : {}),
    ...(renderedDurationMs !== undefined ? { renderedDurationMs } : {}),
    ...(removedSilenceMs !== undefined ? { removedSilenceMs } : {}),
    ...(internalSilenceTrimCount !== undefined ? { internalSilenceTrimCount } : {}),
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
    ...(risks ? { risks } : {}),
    ...audioCleanupEvidence,
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
    return normalizeRecoveredNativeVideoSliceResultSourceSegments(nativeSlice);
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
  const sourceSegments = nativeSlice.sourceSegments?.length ? nativeSlice.sourceSegments : recoveryEvidence.sourceSegments;
  const renderedDurationMs = nativeSlice.renderedDurationMs ?? recoveryEvidence.renderedDurationMs;
  const removedSilenceMs = nativeSlice.removedSilenceMs ?? recoveryEvidence.removedSilenceMs;
  const internalSilenceTrimCount = nativeSlice.internalSilenceTrimCount ?? recoveryEvidence.internalSilenceTrimCount;

  return normalizeRecoveredNativeVideoSliceResultSourceSegments({
    ...nativeSlice,
    ...(sourceStartMs !== undefined ? { sourceStartMs } : {}),
    ...(sourceEndMs !== undefined ? { sourceEndMs } : {}),
    ...(speechStartMs !== undefined ? { speechStartMs } : {}),
    ...(speechEndMs !== undefined ? { speechEndMs } : {}),
    ...(boundaryPaddingBeforeMs !== undefined ? { boundaryPaddingBeforeMs } : {}),
    ...(boundaryPaddingAfterMs !== undefined ? { boundaryPaddingAfterMs } : {}),
    ...(sourceSegments?.length ? { sourceSegments } : {}),
    ...(renderedDurationMs !== undefined ? { renderedDurationMs } : {}),
    ...(removedSilenceMs !== undefined ? { removedSilenceMs } : {}),
    ...(internalSilenceTrimCount !== undefined ? { internalSilenceTrimCount } : {}),
    ...mergeAutoCutSliceAudioCleanupEvidence(nativeSlice, recoveryEvidence),
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
    ...(nativeSlice.risks?.length
      ? { risks: nativeSlice.risks }
      : recoveryEvidence.risks?.length
        ? { risks: recoveryEvidence.risks }
        : {}),
  });
}

function mergeAutoCutSliceAudioCleanupEvidence(
  nativeSlice: TaskSliceResult,
  recoveryEvidence: NativeVideoSliceRecoveryEvidence,
): Partial<AutoCutSliceAudioCleanupEvidence> {
  return {
    ...(nativeSlice.audioCleanupProfile
      ? { audioCleanupProfile: nativeSlice.audioCleanupProfile }
      : recoveryEvidence.audioCleanupProfile
        ? { audioCleanupProfile: recoveryEvidence.audioCleanupProfile }
        : {}),
    ...(nativeSlice.noiseReductionApplied !== undefined
      ? { noiseReductionApplied: nativeSlice.noiseReductionApplied }
      : recoveryEvidence.noiseReductionApplied !== undefined
        ? { noiseReductionApplied: recoveryEvidence.noiseReductionApplied }
        : {}),
    ...(nativeSlice.boundaryDecisionSource
      ? { boundaryDecisionSource: nativeSlice.boundaryDecisionSource }
      : recoveryEvidence.boundaryDecisionSource
        ? { boundaryDecisionSource: recoveryEvidence.boundaryDecisionSource }
        : {}),
    ...(nativeSlice.audioActivityStartMs !== undefined
      ? { audioActivityStartMs: nativeSlice.audioActivityStartMs }
      : recoveryEvidence.audioActivityStartMs !== undefined
        ? { audioActivityStartMs: recoveryEvidence.audioActivityStartMs }
        : {}),
    ...(nativeSlice.audioActivityEndMs !== undefined
      ? { audioActivityEndMs: nativeSlice.audioActivityEndMs }
      : recoveryEvidence.audioActivityEndMs !== undefined
        ? { audioActivityEndMs: recoveryEvidence.audioActivityEndMs }
        : {}),
    ...(nativeSlice.audioActivityConfidence !== undefined
      ? { audioActivityConfidence: nativeSlice.audioActivityConfidence }
      : recoveryEvidence.audioActivityConfidence !== undefined
        ? { audioActivityConfidence: recoveryEvidence.audioActivityConfidence }
        : {}),
    ...(nativeSlice.audioActivityAnalysisFilter
      ? { audioActivityAnalysisFilter: nativeSlice.audioActivityAnalysisFilter }
      : recoveryEvidence.audioActivityAnalysisFilter
        ? { audioActivityAnalysisFilter: recoveryEvidence.audioActivityAnalysisFilter }
        : {}),
    ...(nativeSlice.leadingSilenceMs !== undefined
      ? { leadingSilenceMs: nativeSlice.leadingSilenceMs }
      : recoveryEvidence.leadingSilenceMs !== undefined
        ? { leadingSilenceMs: recoveryEvidence.leadingSilenceMs }
        : {}),
    ...(nativeSlice.trailingSilenceMs !== undefined
      ? { trailingSilenceMs: nativeSlice.trailingSilenceMs }
      : recoveryEvidence.trailingSilenceMs !== undefined
        ? { trailingSilenceMs: recoveryEvidence.trailingSilenceMs }
        : {}),
    ...(nativeSlice.leadingSilenceTrimMs !== undefined
      ? { leadingSilenceTrimMs: nativeSlice.leadingSilenceTrimMs }
      : recoveryEvidence.leadingSilenceTrimMs !== undefined
        ? { leadingSilenceTrimMs: recoveryEvidence.leadingSilenceTrimMs }
        : {}),
    ...(nativeSlice.trailingSilenceTrimMs !== undefined
      ? { trailingSilenceTrimMs: nativeSlice.trailingSilenceTrimMs }
      : recoveryEvidence.trailingSilenceTrimMs !== undefined
        ? { trailingSilenceTrimMs: recoveryEvidence.trailingSilenceTrimMs }
        : {}),
    ...(nativeSlice.tailTreatment
      ? { tailTreatment: nativeSlice.tailTreatment }
      : recoveryEvidence.tailTreatment
        ? { tailTreatment: recoveryEvidence.tailTreatment }
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
    return normalizeRecoveredNativeVideoSliceTaskSourceSegments(nativeTask);
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
      ...(localSlice.audioCleanupProfile ? { audioCleanupProfile: localSlice.audioCleanupProfile } : {}),
      ...(localSlice.noiseReductionApplied !== undefined
        ? { noiseReductionApplied: localSlice.noiseReductionApplied }
        : {}),
      ...(localSlice.boundaryDecisionSource ? { boundaryDecisionSource: localSlice.boundaryDecisionSource } : {}),
      ...(localSlice.audioActivityStartMs !== undefined
        ? { audioActivityStartMs: localSlice.audioActivityStartMs }
        : {}),
      ...(localSlice.audioActivityEndMs !== undefined
        ? { audioActivityEndMs: localSlice.audioActivityEndMs }
        : {}),
      ...(localSlice.audioActivityConfidence !== undefined
        ? { audioActivityConfidence: localSlice.audioActivityConfidence }
        : {}),
      ...(localSlice.audioActivityAnalysisFilter
        ? { audioActivityAnalysisFilter: localSlice.audioActivityAnalysisFilter }
        : {}),
      ...(localSlice.leadingSilenceMs !== undefined ? { leadingSilenceMs: localSlice.leadingSilenceMs } : {}),
      ...(localSlice.trailingSilenceMs !== undefined ? { trailingSilenceMs: localSlice.trailingSilenceMs } : {}),
      ...(localSlice.leadingSilenceTrimMs !== undefined
        ? { leadingSilenceTrimMs: localSlice.leadingSilenceTrimMs }
        : {}),
      ...(localSlice.trailingSilenceTrimMs !== undefined
        ? { trailingSilenceTrimMs: localSlice.trailingSilenceTrimMs }
        : {}),
      ...(localSlice.sourceSegments?.length ? { sourceSegments: localSlice.sourceSegments } : {}),
      ...(localSlice.renderedDurationMs !== undefined ? { renderedDurationMs: localSlice.renderedDurationMs } : {}),
      ...(localSlice.removedSilenceMs !== undefined ? { removedSilenceMs: localSlice.removedSilenceMs } : {}),
      ...(localSlice.internalSilenceTrimCount !== undefined
        ? { internalSilenceTrimCount: localSlice.internalSilenceTrimCount }
        : {}),
      ...(localSlice.tailTreatment ? { tailTreatment: localSlice.tailTreatment } : {}),
      ...(localSlice.transcriptText ? { transcriptText: localSlice.transcriptText } : {}),
      ...(localSlice.transcriptSegments?.length ? { transcriptSegments: localSlice.transcriptSegments } : {}),
      ...(localSlice.transcriptSegmentCount !== undefined
        ? { transcriptSegmentCount: localSlice.transcriptSegmentCount }
        : {}),
      ...(localSlice.transcriptCoverageScore !== undefined
        ? { transcriptCoverageScore: localSlice.transcriptCoverageScore }
        : {}),
      ...(localSlice.speechContinuityGrade ? { speechContinuityGrade: localSlice.speechContinuityGrade } : {}),
      ...(localSlice.transcriptCorrection ? { transcriptCorrection: localSlice.transcriptCorrection } : {}),
      ...(localSlice.artifactPath ? { artifactPath: localSlice.artifactPath } : {}),
      ...(localSlice.taskOutputDir ? { taskOutputDir: localSlice.taskOutputDir } : {}),
    };
  });

  return {
    ...nativeTask,
    sliceResults,
  };
}

function normalizeRecoveredNativeVideoSliceTaskSourceSegments(task: AppTask): AppTask {
  if (task.type !== AUTOCUT_TASK_TYPE.videoSlice || !task.sliceResults?.length) {
    return task;
  }

  return {
    ...task,
    sliceResults: task.sliceResults.map((sliceResult) =>
      normalizeRecoveredNativeVideoSliceResultSourceSegments(sliceResult)
    ),
  };
}

function normalizeRecoveredNativeVideoSliceResultSourceSegments(
  sliceResult: TaskSliceResult,
): TaskSliceResult {
  const sourceStartMs = readRecoveredNativeVideoSliceEvidenceMilliseconds(sliceResult.sourceStartMs);
  const sourceEndMs = readRecoveredNativeVideoSliceEvidenceMilliseconds(sliceResult.sourceEndMs);
  const sourceSegments = normalizeRecoveredNativeVideoSliceRenderableSourceSegments(
    sliceResult.sourceSegments,
    sourceStartMs,
    sourceEndMs,
    sliceResult,
    sliceResult.transcriptSegments,
  );

  if (!sourceSegments?.length || sourceStartMs === undefined || sourceEndMs === undefined) {
    const {
      sourceSegments: _staleSourceSegments,
      removedSilenceMs: _staleRemovedSilenceMs,
      internalSilenceTrimCount: _staleInternalSilenceTrimCount,
      ...continuousSliceResult
    } = sliceResult;
    return continuousSliceResult;
  }

  const renderedDurationMs = sourceSegments.reduce(
    (durationMs, segment) => durationMs + Math.max(0, segment.endMs - segment.startMs),
    0,
  );
  return {
    ...sliceResult,
    sourceSegments,
    renderedDurationMs,
    removedSilenceMs: Math.max(0, sourceEndMs - sourceStartMs - renderedDurationMs),
    internalSilenceTrimCount: sourceSegments.length - 1,
  };
}

function normalizeRecoveredNativeVideoSliceRenderableSourceSegments(
  sourceSegments: TaskSliceResult['sourceSegments'] | undefined,
  sourceStartMs: number | undefined,
  sourceEndMs: number | undefined,
  sliceResult?: TaskSliceResult,
  transcriptSegments: readonly AutoCutTranscriptSegment[] = [],
): TaskSliceResult['sourceSegments'] | undefined {
  if (
    !Array.isArray(sourceSegments) ||
    sourceSegments.length === 0 ||
    sourceStartMs === undefined ||
    sourceEndMs === undefined ||
    sourceEndMs <= sourceStartMs
  ) {
    return undefined;
  }

  const trimmedSourceSegments = sourceSegments
    .map((segment) => {
      const segmentStartMs = readRecoveredNativeVideoSliceEvidenceMilliseconds(segment.startMs);
      const segmentEndMs = readRecoveredNativeVideoSliceEvidenceMilliseconds(segment.endMs);
      if (segmentStartMs === undefined || segmentEndMs === undefined || segmentEndMs <= segmentStartMs) {
        return null;
      }
      return {
        startMs: Math.max(sourceStartMs, segmentStartMs),
        endMs: Math.min(sourceEndMs, segmentEndMs),
      };
    })
    .filter((segment): segment is NonNullable<TaskSliceResult['sourceSegments']>[number] =>
      Boolean(segment && segment.endMs > segment.startMs)
    )
    .sort((firstSegment, secondSegment) =>
      firstSegment.startMs - secondSegment.startMs ||
        firstSegment.endMs - secondSegment.endMs,
    );

  if (
    trimmedSourceSegments.length <= 1 ||
    trimmedSourceSegments.length > MAX_RECOVERED_SMART_SLICE_SOURCE_SEGMENTS ||
    trimmedSourceSegments[0]?.startMs !== sourceStartMs ||
    trimmedSourceSegments.at(-1)?.endMs !== sourceEndMs
  ) {
    return undefined;
  }

  let previousEndMs: number | undefined;
  for (const segment of trimmedSourceSegments) {
    if (
      segment.startMs < sourceStartMs ||
      segment.endMs > sourceEndMs ||
      segment.endMs <= segment.startMs ||
      (previousEndMs !== undefined && segment.startMs < previousEndMs)
    ) {
      return undefined;
    }
    previousEndMs = segment.endMs;
  }

  if (
    transcriptSegments.length > 0 &&
    sliceResult &&
    !doRecoveredNativeVideoSliceSourceSegmentsCoverTranscriptEvidence(
      sliceResult,
      trimmedSourceSegments,
      transcriptSegments,
    )
  ) {
    return undefined;
  }

  return trimmedSourceSegments;
}

function readRecoveredNativeVideoSliceEvidenceMilliseconds(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : undefined;
}

function doRecoveredNativeVideoSliceSourceSegmentsCoverTranscriptEvidence(
  sliceResult: TaskSliceResult,
  sourceSegments: readonly { startMs: number; endMs: number }[],
  transcriptSegments: readonly AutoCutTranscriptSegment[],
) {
  if (sourceSegments.length <= 1) {
    return false;
  }

  return transcriptSegments.every((segment) => {
    const text = normalizeRecoveredNativeVideoSliceTranscriptText(segment.text);
    if (!text) {
      return true;
    }

    const coverageRange = createRecoveredNativeVideoSliceTrustedAudioBoundedTranscriptCoverageRange(
      sliceResult,
      segment,
    );
    return isRecoveredNativeVideoSliceTimeRangeCoveredBySourceSegments(
      coverageRange.startMs,
      coverageRange.endMs,
      sourceSegments,
    ) ||
      doRecoveredNativeVideoSliceTrustedAudioCompactedSourceSegmentsCoverTranscriptRange(
        sliceResult,
        sourceSegments,
        segment,
      );
  });
}

function createRecoveredNativeVideoSliceTrustedAudioBoundedTranscriptCoverageRange(
  sliceResult: TaskSliceResult,
  transcriptSegment: Pick<AutoCutTranscriptSegment, 'startMs' | 'endMs'>,
) {
  const segmentStartMs = Math.round(transcriptSegment.startMs);
  const segmentEndMs = Math.round(transcriptSegment.endMs);
  if (!hasTrustedRecoveredNativeVideoSliceAudioActivityEvidence(sliceResult)) {
    return { startMs: segmentStartMs, endMs: segmentEndMs };
  }

  const audioActivityStartMs = Math.round(sliceResult.audioActivityStartMs as number);
  const audioActivityEndMs = Math.round(sliceResult.audioActivityEndMs as number);
  const audioOverlapStartMs = Math.max(segmentStartMs, audioActivityStartMs);
  const audioOverlapEndMs = Math.min(segmentEndMs, audioActivityEndMs);
  const audioOverlapMs = Math.max(0, audioOverlapEndMs - audioOverlapStartMs);
  const segmentDurationMs = segmentEndMs - segmentStartMs;
  const safeAudioTrim =
    segmentDurationMs > 0 &&
    audioOverlapMs > 0 &&
    audioOverlapMs / segmentDurationMs >= MIN_RECOVERED_SMART_SLICE_TRUSTED_AUDIO_SOURCE_SEGMENT_RETAINED_RATIO;

  return safeAudioTrim
    ? { startMs: audioOverlapStartMs, endMs: audioOverlapEndMs }
    : { startMs: segmentStartMs, endMs: segmentEndMs };
}

function isRecoveredNativeVideoSliceTimeRangeCoveredBySourceSegments(
  startMs: number,
  endMs: number,
  sourceSegments: readonly { startMs: number; endMs: number }[],
) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return false;
  }

  const normalizedStartMs = Math.round(startMs);
  const normalizedEndMs = Math.round(endMs);
  const coverageRanges = sourceSegments
    .filter((sourceSegment) =>
      Number.isFinite(sourceSegment.startMs) &&
        Number.isFinite(sourceSegment.endMs) &&
        sourceSegment.endMs > sourceSegment.startMs
    )
    .map((sourceSegment) => ({
      startMs: Math.max(normalizedStartMs, Math.round(sourceSegment.startMs)),
      endMs: Math.min(normalizedEndMs, Math.round(sourceSegment.endMs)),
    }))
    .filter((sourceSegment) => sourceSegment.endMs > sourceSegment.startMs)
    .sort((firstSegment, secondSegment) =>
      firstSegment.startMs - secondSegment.startMs ||
        firstSegment.endMs - secondSegment.endMs,
    );

  let coveredUntilMs = normalizedStartMs;
  for (const range of coverageRanges) {
    if (range.endMs <= coveredUntilMs) {
      continue;
    }
    if (range.startMs > coveredUntilMs + RECOVERED_SMART_SLICE_SOURCE_SEGMENT_BOUNDARY_TOLERANCE_MS) {
      return false;
    }
    coveredUntilMs = Math.max(coveredUntilMs, range.endMs);
    if (coveredUntilMs >= normalizedEndMs - RECOVERED_SMART_SLICE_SOURCE_SEGMENT_BOUNDARY_TOLERANCE_MS) {
      return true;
    }
  }

  return coveredUntilMs >= normalizedEndMs - RECOVERED_SMART_SLICE_SOURCE_SEGMENT_BOUNDARY_TOLERANCE_MS;
}

function doRecoveredNativeVideoSliceTrustedAudioCompactedSourceSegmentsCoverTranscriptRange(
  sliceResult: TaskSliceResult,
  sourceSegments: readonly { startMs: number; endMs: number }[],
  transcriptSegment: Pick<AutoCutTranscriptSegment, 'startMs' | 'endMs'>,
) {
  if (sourceSegments.length <= 1 || !hasTrustedRecoveredNativeVideoSliceAudioActivityEvidence(sliceResult)) {
    return false;
  }

  const coverageRange = createRecoveredNativeVideoSliceTrustedAudioBoundedTranscriptCoverageRange(
    sliceResult,
    transcriptSegment,
  );
  if (
    !Number.isFinite(coverageRange.startMs) ||
    !Number.isFinite(coverageRange.endMs) ||
    coverageRange.endMs <= coverageRange.startMs
  ) {
    return false;
  }

  const retainedCoverageMs = sourceSegments.reduce(
    (durationMs, sourceSegment) =>
      durationMs + Math.max(
        0,
        Math.min(coverageRange.endMs, Math.round(sourceSegment.endMs)) -
          Math.max(coverageRange.startMs, Math.round(sourceSegment.startMs)),
      ),
    0,
  );
  const coverageDurationMs = coverageRange.endMs - coverageRange.startMs;
  if (
    retainedCoverageMs / coverageDurationMs <
      MIN_RECOVERED_SMART_SLICE_TRUSTED_AUDIO_SOURCE_SEGMENT_RETAINED_RATIO
  ) {
    return false;
  }

  const firstCoveringSegment = sourceSegments.find((sourceSegment) =>
    sourceSegment.endMs > coverageRange.startMs
  );
  const lastCoveringSegment = sourceSegments
    .slice()
    .reverse()
    .find((sourceSegment) => sourceSegment.startMs < coverageRange.endMs);

  return firstCoveringSegment !== undefined &&
    lastCoveringSegment !== undefined &&
    firstCoveringSegment.startMs <=
      coverageRange.startMs + RECOVERED_SMART_SLICE_SOURCE_SEGMENT_BOUNDARY_TOLERANCE_MS &&
    lastCoveringSegment.endMs >=
      coverageRange.endMs - RECOVERED_SMART_SLICE_SOURCE_SEGMENT_BOUNDARY_TOLERANCE_MS;
}

function hasTrustedRecoveredNativeVideoSliceAudioActivityEvidence(
  sliceResult: Pick<
    TaskSliceResult,
    | 'audioActivityStartMs'
    | 'audioActivityEndMs'
    | 'audioActivityConfidence'
    | 'audioActivityAnalysisFilter'
    | 'noiseReductionApplied'
  >,
) {
  const expectedAnalysisFilter = typeof sliceResult.noiseReductionApplied === 'boolean'
    ? sliceResult.noiseReductionApplied
      ? RECOVERED_SMART_SLICE_REQUIRED_AUDIO_ACTIVITY_ANALYSIS_FILTER
      : RECOVERED_SMART_SLICE_RAW_AUDIO_ACTIVITY_ANALYSIS_FILTER
    : undefined;
  const audioActivityAnalysisFilter = typeof sliceResult.audioActivityAnalysisFilter === 'string'
    ? sliceResult.audioActivityAnalysisFilter.trim()
    : '';
  const hasTrustedAnalysisFilter = expectedAnalysisFilter !== undefined
    ? audioActivityAnalysisFilter === expectedAnalysisFilter
    : audioActivityAnalysisFilter === RECOVERED_SMART_SLICE_REQUIRED_AUDIO_ACTIVITY_ANALYSIS_FILTER ||
      audioActivityAnalysisFilter === RECOVERED_SMART_SLICE_RAW_AUDIO_ACTIVITY_ANALYSIS_FILTER;

  return typeof sliceResult.audioActivityStartMs === 'number' &&
    typeof sliceResult.audioActivityEndMs === 'number' &&
    typeof sliceResult.audioActivityConfidence === 'number' &&
    Number.isFinite(sliceResult.audioActivityStartMs) &&
    Number.isFinite(sliceResult.audioActivityEndMs) &&
    Number.isFinite(sliceResult.audioActivityConfidence) &&
    sliceResult.audioActivityEndMs > sliceResult.audioActivityStartMs &&
    sliceResult.audioActivityConfidence >= MIN_RECOVERED_SMART_SLICE_AUDIO_ACTIVITY_CONFIDENCE &&
    hasTrustedAnalysisFilter;
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

  const sameTaskIdentity =
    localTask.id === snapshot.uuid ||
    localTask.id === nativeTask.id ||
    localTask.nativeTaskId === snapshot.uuid ||
    localTask.nativeTaskId === nativeTask.id;
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

  const normalizedTask = normalizeRecoveredNativeVideoSliceTaskSourceSegments(task);
  try {
    assertRecoveredNativeVideoSliceRecoveryEvidence(normalizedTask.sliceResults);
    return normalizedTask;
  } catch (error) {
    return createInvalidRecoveredNativeVideoSliceTask(normalizedTask, error, snapshot);
  }
}

function assertRecoveredNativeVideoSliceRecoveryEvidence(
  sliceResults: readonly TaskSliceResult[] | undefined,
) {
  if (!sliceResults?.length) {
    throw new Error('AutoCut recovered native video slicing output is missing generated slice results.');
  }

  sliceResults.forEach((sliceResult, index) => {
    const sliceNumber = index + 1;
    const hasTranscriptEvidence = Boolean(sliceResult.transcriptText?.trim() || sliceResult.transcriptSegments?.length);
    const hasCompleteAudioCleanupEvidence =
      typeof sliceResult.audioCleanupProfile === 'string' &&
      sliceResult.audioCleanupProfile.trim() === 'smart-slice-speech-denoise-v1' &&
      typeof sliceResult.noiseReductionApplied === 'boolean' &&
      typeof sliceResult.boundaryDecisionSource === 'string' &&
      (sliceResult.boundaryDecisionSource === 'transcript' ||
        sliceResult.boundaryDecisionSource === 'audio' ||
        sliceResult.boundaryDecisionSource === 'combined') &&
      typeof sliceResult.audioActivityStartMs === 'number' &&
      Number.isFinite(sliceResult.audioActivityStartMs) &&
      typeof sliceResult.audioActivityEndMs === 'number' &&
      Number.isFinite(sliceResult.audioActivityEndMs) &&
      typeof sliceResult.audioActivityConfidence === 'number' &&
      Number.isFinite(sliceResult.audioActivityConfidence) &&
      typeof sliceResult.audioActivityAnalysisFilter === 'string' &&
      sliceResult.audioActivityEndMs > sliceResult.audioActivityStartMs &&
      typeof sliceResult.leadingSilenceMs === 'number' &&
      Number.isFinite(sliceResult.leadingSilenceMs) &&
      typeof sliceResult.trailingSilenceMs === 'number' &&
      Number.isFinite(sliceResult.trailingSilenceMs);
    if (hasTranscriptEvidence && hasCompleteAudioCleanupEvidence) {
      assertRecoveredNativeVideoSliceProfessionalTranscriptEvidence([sliceResult]);
      return;
    }

    assertRecoveredNativeVideoSliceBasicTimelineEvidence(sliceResult, sliceNumber);
  });
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

    assertRecoveredNativeVideoSliceAudioCleanupEvidence(sliceResult, sliceNumber);

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
      firstTranscriptSegmentStartMs > speechStartMs + RECOVERED_SMART_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS ||
      lastTranscriptSegmentEndMs < speechEndMs - RECOVERED_SMART_SLICE_TRANSCRIPT_BOUNDARY_TOLERANCE_MS
    ) {
      throw new Error(
        `AutoCut recovered native video slicing slice artifact ${sliceNumber} speech range is not covered by transcript segment boundaries.`,
      );
    }
  });
}

function assertRecoveredNativeVideoSliceBasicTimelineEvidence(
  sliceResult: TaskSliceResult,
  sliceNumber: number,
) {
  if (!sliceResult.artifactPath?.trim() || !sliceResult.taskOutputDir?.trim()) {
    throw new Error(
      `AutoCut recovered native video slicing slice artifact ${sliceNumber} is missing native artifact evidence.`,
    );
  }
  if (!sliceResult.thumbnailUrl?.trim() || !sliceResult.url?.trim()) {
    throw new Error(
      `AutoCut recovered native video slicing slice artifact ${sliceNumber} is missing generated media URLs.`,
    );
  }
  if (typeof sliceResult.size !== 'number' || !Number.isFinite(sliceResult.size) || sliceResult.size <= 0) {
    throw new Error(
      `AutoCut recovered native video slicing slice artifact ${sliceNumber} has invalid byte size evidence.`,
    );
  }
  if (typeof sliceResult.duration !== 'number' || !Number.isFinite(sliceResult.duration) || sliceResult.duration <= 0) {
    throw new Error(
      `AutoCut recovered native video slicing slice artifact ${sliceNumber} has invalid duration evidence.`,
    );
  }

  const sourceStartMs = assertRecoveredNativeVideoSliceMilliseconds(sliceResult.sourceStartMs, sliceNumber, 'sourceStartMs');
  const sourceEndMs = assertRecoveredNativeVideoSliceMilliseconds(sliceResult.sourceEndMs, sliceNumber, 'sourceEndMs');
  const speechStartMs = sliceResult.speechStartMs !== undefined
    ? assertRecoveredNativeVideoSliceMilliseconds(sliceResult.speechStartMs, sliceNumber, 'speechStartMs')
    : sourceStartMs;
  const speechEndMs = sliceResult.speechEndMs !== undefined
    ? assertRecoveredNativeVideoSliceMilliseconds(sliceResult.speechEndMs, sliceNumber, 'speechEndMs')
    : sourceEndMs;

  if (sourceEndMs <= sourceStartMs) {
    throw new Error(
      `AutoCut recovered native video slicing slice artifact ${sliceNumber} sourceEndMs is not after sourceStartMs.`,
    );
  }
  if (speechEndMs < speechStartMs || speechStartMs < sourceStartMs || speechEndMs > sourceEndMs) {
    throw new Error(
      `AutoCut recovered native video slicing slice artifact ${sliceNumber} basic speech range is outside its rendered source range.`,
    );
  }

  assertRecoveredNativeVideoSliceSourceSegmentsEvidence(
    sliceResult,
    sliceNumber,
    sourceStartMs,
    sourceEndMs,
  );
}

function assertRecoveredNativeVideoSliceSourceSegmentsEvidence(
  sliceResult: TaskSliceResult,
  sliceNumber: number,
  sourceStartMs: number,
  sourceEndMs: number,
) {
  if (!sliceResult.sourceSegments?.length) {
    return;
  }

  if (sliceResult.sourceSegments.length <= 1) {
    throw new Error(
      `AutoCut recovered native video slicing slice artifact ${sliceNumber} sourceSegments must contain at least two retained islands.`,
    );
  }
  if (
    sliceResult.sourceSegments[0]?.startMs !== sourceStartMs ||
    sliceResult.sourceSegments.at(-1)?.endMs !== sourceEndMs
  ) {
    throw new Error(
      `AutoCut recovered native video slicing slice artifact ${sliceNumber} sourceSegments must span the final source range.`,
    );
  }

  let previousEndMs: number | undefined;
  const renderedDurationMs = sliceResult.sourceSegments.reduce((durationMs, segment, segmentIndex) => {
    const segmentStartMs = assertRecoveredNativeVideoSliceMilliseconds(
      segment.startMs,
      sliceNumber,
      `sourceSegments[${segmentIndex}].startMs`,
    );
    const segmentEndMs = assertRecoveredNativeVideoSliceMilliseconds(
      segment.endMs,
      sliceNumber,
      `sourceSegments[${segmentIndex}].endMs`,
    );
    if (
      segmentEndMs <= segmentStartMs ||
      segmentStartMs < sourceStartMs ||
      segmentEndMs > sourceEndMs ||
      (previousEndMs !== undefined && segmentStartMs < previousEndMs)
    ) {
      throw new Error(
        `AutoCut recovered native video slicing slice artifact ${sliceNumber} sourceSegments are not ordered inside the source range.`,
      );
    }

    previousEndMs = segmentEndMs;
    return durationMs + segmentEndMs - segmentStartMs;
  }, 0);
  const removedSilenceMs = sourceEndMs - sourceStartMs - renderedDurationMs;
  if (
    sliceResult.renderedDurationMs !== renderedDurationMs ||
    sliceResult.removedSilenceMs !== removedSilenceMs ||
    sliceResult.internalSilenceTrimCount !== sliceResult.sourceSegments.length - 1
  ) {
    throw new Error(
      `AutoCut recovered native video slicing slice artifact ${sliceNumber} silence compaction evidence does not match retained sourceSegments.`,
    );
  }
}

function assertRecoveredNativeVideoSliceMilliseconds(value: unknown, sliceNumber: number, fieldName: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(
      `AutoCut recovered native video slicing slice artifact ${sliceNumber} ${fieldName} is not a non-negative millisecond value.`,
    );
  }

  return Math.round(value);
}

function assertRecoveredNativeVideoSliceAudioCleanupEvidence(
  sliceResult: TaskSliceResult,
  sliceNumber: number,
) {
  if (sliceResult.audioCleanupProfile !== RECOVERED_SMART_SLICE_AUDIO_CLEANUP_PROFILE) {
    throw new Error(
      `AutoCut recovered native video slicing slice artifact ${sliceNumber} is missing smart-slice audio cleanup evidence.`,
    );
  }

  if (typeof sliceResult.noiseReductionApplied !== 'boolean') {
    throw new Error(
      `AutoCut recovered native video slicing slice artifact ${sliceNumber} is missing smart-slice noise reduction decision evidence.`,
    );
  }

  if (
    !RECOVERED_SMART_SLICE_ACCEPTED_BOUNDARY_DECISION_SOURCES.includes(
      sliceResult.boundaryDecisionSource as typeof RECOVERED_SMART_SLICE_ACCEPTED_BOUNDARY_DECISION_SOURCES[number],
    )
  ) {
    throw new Error(
      `AutoCut recovered native video slicing slice artifact ${sliceNumber} is missing smart-slice boundary decision evidence.`,
    );
  }

  if (
    typeof sliceResult.audioActivityStartMs !== 'number' ||
    !Number.isFinite(sliceResult.audioActivityStartMs) ||
    typeof sliceResult.audioActivityEndMs !== 'number' ||
    !Number.isFinite(sliceResult.audioActivityEndMs) ||
    sliceResult.audioActivityEndMs <= sliceResult.audioActivityStartMs ||
    sliceResult.audioActivityStartMs < (sliceResult.sourceStartMs ?? 0) ||
    sliceResult.audioActivityEndMs > (sliceResult.sourceEndMs ?? Number.MAX_SAFE_INTEGER) ||
    typeof sliceResult.audioActivityConfidence !== 'number' ||
    !Number.isFinite(sliceResult.audioActivityConfidence) ||
    sliceResult.audioActivityConfidence < MIN_RECOVERED_SMART_SLICE_AUDIO_ACTIVITY_CONFIDENCE ||
    sliceResult.audioActivityAnalysisFilter !== (sliceResult.noiseReductionApplied
      ? RECOVERED_SMART_SLICE_REQUIRED_AUDIO_ACTIVITY_ANALYSIS_FILTER
      : RECOVERED_SMART_SLICE_RAW_AUDIO_ACTIVITY_ANALYSIS_FILTER)
  ) {
    throw new Error(
      `AutoCut recovered native video slicing slice artifact ${sliceNumber} requires audioActivityStartMs/audioActivityEndMs inside the source range, audioActivityConfidence to be at least ${MIN_RECOVERED_SMART_SLICE_AUDIO_ACTIVITY_CONFIDENCE}, and audioActivityAnalysisFilter to match the recorded noise reduction decision.`,
    );
  }

  assertRecoveredNativeVideoSliceMilliseconds(sliceResult.leadingSilenceMs, sliceNumber, 'leadingSilenceMs');
  assertRecoveredNativeVideoSliceMilliseconds(sliceResult.trailingSilenceMs, sliceNumber, 'trailingSilenceMs');
  assertRecoveredNativeVideoSliceMilliseconds(sliceResult.leadingSilenceTrimMs, sliceNumber, 'leadingSilenceTrimMs');
  assertRecoveredNativeVideoSliceMilliseconds(sliceResult.trailingSilenceTrimMs, sliceNumber, 'trailingSilenceTrimMs');

  if (
    !RECOVERED_SMART_SLICE_ACCEPTED_TAIL_TREATMENTS.includes(
      sliceResult.tailTreatment as typeof RECOVERED_SMART_SLICE_ACCEPTED_TAIL_TREATMENTS[number],
    )
  ) {
    throw new Error(
      `AutoCut recovered native video slicing slice artifact ${sliceNumber} is missing smart-slice tail treatment evidence.`,
    );
  }
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

  if (message.includes('smart-slice audio cleanup evidence')) {
    return [
      'Recovered smart-slice artifacts are missing smart-slice audio cleanup evidence.',
      'Re-run Smart Slice so noise-reduction decision, boundary trimming, and tail treatment evidence are regenerated.',
    ].join(' ');
  }

  if (message.includes('leadingSilenceMs') || message.includes('trailingSilenceMs')) {
    return [
      'Recovered smart-slice artifacts are missing smart-slice audio cleanup evidence.',
      'Re-run Smart Slice so noise-reduction decision, raw silence detection, boundary trimming, and tail treatment evidence are regenerated.',
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
      `slicesWithAudioCleanupEvidence=${countRecordsWithAudioCleanupEvidence(sliceResults)}`,
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
    `audioCleanupProfile=${readString(slice.audioCleanupProfile) ?? 'unknown'}`,
    `noiseReductionApplied=${readBoolean(slice.noiseReductionApplied) ?? 'unknown'}`,
    `boundaryDecisionSource=${readString(slice.boundaryDecisionSource) ?? 'unknown'}`,
    `leadingSilenceTrimMs=${readNumber(slice.leadingSilenceTrimMs) ?? 'unknown'}`,
    `trailingSilenceTrimMs=${readNumber(slice.trailingSilenceTrimMs) ?? 'unknown'}`,
    `tailTreatment=${readString(slice.tailTreatment) ?? 'unknown'}`,
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

function countRecordsWithAudioCleanupEvidence(values: readonly unknown[]) {
  return values.filter((value) => {
    const record = readRecord(value);
    return Boolean(
      record &&
        readString(record.audioCleanupProfile) &&
        readBoolean(record.noiseReductionApplied) !== undefined &&
        readAutoCutSliceBoundaryDecisionSource(record.boundaryDecisionSource) &&
        readNumber(record.leadingSilenceTrimMs) !== undefined &&
        readNumber(record.trailingSilenceTrimMs) !== undefined &&
        readAutoCutSliceTailTreatment(record.tailTreatment),
    );
  }).length;
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

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
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
