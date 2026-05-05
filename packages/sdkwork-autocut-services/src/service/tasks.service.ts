import { AUTOCUT_TASK_STATUS, AUTOCUT_TASK_TYPES, type AppTask, type TaskSliceResult, type TaskStatus, type TaskType } from '@sdkwork/autocut-types';
import { sortAutoCutRecordsByCreatedAtDesc } from './datetime.service';
import { dispatchAutoCutEvent } from './events.service';
import { getAutoCutNativeHostClient, type AutoCutNativeTaskSnapshot } from './native-host-client.service';
import { readAutoCutStorage, writeAutoCutStorage } from './storage.service';
import { randomDelay } from './timing';

const EMPTY_TASKS: AppTask[] = [];
const NATIVE_TASK_LIST_LIMIT = 100;

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
  [OPS_TASK_TYPE_VIDEO_SLICE]: AUTOCUT_TASK_TYPES[0],
  [OPS_TASK_TYPE_SPEECH_TRANSCRIPTION]: AUTOCUT_TASK_TYPES[1],
  [OPS_TASK_TYPE_AUDIO_EXTRACTION]: AUTOCUT_TASK_TYPES[2],
  [OPS_TASK_TYPE_VIDEO_GIF]: AUTOCUT_TASK_TYPES[3],
  [OPS_TASK_TYPE_VIDEO_COMPRESS]: AUTOCUT_TASK_TYPES[4],
  [OPS_TASK_TYPE_VIDEO_CONVERT]: AUTOCUT_TASK_TYPES[5],
  [OPS_TASK_TYPE_VIDEO_ENHANCE]: AUTOCUT_TASK_TYPES[6],
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
  progressMessage?: string;
  completedAt?: string;
  resultCount?: number;
  generatedAssetIds?: string[];
  sliceResults?: TaskSliceResult[];
  sourceFileId?: string;
  extractedText?: NonNullable<AppTask['extractedText']>;
  audioUrl?: string;
  videoUrl?: string;
  gifUrl?: string;
  fileSizeStats?: NonNullable<AppTask['fileSizeStats']>;
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
  dispatchAutoCutEvent('taskDeleted', { id: taskId });
}

function readLocalTasks() {
  return readAutoCutStorage<AppTask[]>('tasks', EMPTY_TASKS);
}

async function readNativeTasks(): Promise<AppTask[] | null> {
  const nativeHostClient = getAutoCutNativeHostClient();

  try {
    const capabilities = await nativeHostClient.getCapabilities();
    if (!capabilities.nativeTaskQueryCommandReady) {
      return null;
    }

    const snapshots = await nativeHostClient.listNativeTasks({ limit: NATIVE_TASK_LIST_LIMIT });
    return sortAutoCutRecordsByCreatedAtDesc(
      snapshots.map((snapshot) => mapNativeTaskSnapshotToAppTask(snapshot, nativeHostClient.createAssetUrl)),
    );
  } catch {
    return null;
  }
}

function mapNativeTaskSnapshotToAppTask(
  snapshot: AutoCutNativeTaskSnapshot,
  createAssetUrl: (artifactPath: string) => string,
): AppTask {
  const input = parseJsonRecord(snapshot.inputJson);
  const output = parseJsonRecord(snapshot.outputJson);
  const taskType = TASK_TYPE_BY_NATIVE_TYPE[snapshot.taskType] ?? AUTOCUT_TASK_TYPES[0];
  const status = mapNativeStatus(snapshot.status);
  const projection = createNativeTaskProjection(snapshot, output, createAssetUrl);
  const name = resolveNativeTaskName(snapshot, input, output);
  const progressMessage = projection.progressMessage ?? resolveNativeTaskProgressMessage(snapshot);

  return {
    id: snapshot.uuid,
    type: taskType,
    name,
    status,
    progress: clampProgress(snapshot.progress),
    ...(progressMessage ? { progressMessage } : {}),
    createdAt: snapshot.createdAt,
    ...(projection.completedAt ? { completedAt: projection.completedAt } : {}),
    ...(snapshot.errorMessage ? { errorMessage: snapshot.errorMessage } : {}),
    ...(projection.resultCount !== undefined ? { resultCount: projection.resultCount } : {}),
    ...(projection.generatedAssetIds ? { generatedAssetIds: projection.generatedAssetIds } : {}),
    ...(projection.sliceResults ? { sliceResults: projection.sliceResults } : {}),
    ...(projection.sourceFileId ? { sourceFileId: projection.sourceFileId } : {}),
    ...(projection.extractedText ? { extractedText: projection.extractedText } : {}),
    ...(projection.audioUrl ? { audioUrl: projection.audioUrl } : {}),
    ...(projection.videoUrl ? { videoUrl: projection.videoUrl } : {}),
    ...(projection.gifUrl ? { gifUrl: projection.gifUrl } : {}),
    ...(projection.fileSizeStats ? { fileSizeStats: projection.fileSizeStats } : {}),
  };
}

function createNativeTaskProjection(
  snapshot: AutoCutNativeTaskSnapshot,
  output: JsonRecord,
  createAssetUrl: (artifactPath: string) => string,
): NativeTaskProjection {
  const baseProjection: NativeTaskProjection = {
    ...(snapshot.sourceAssetUuid ? { sourceFileId: snapshot.sourceAssetUuid } : {}),
    ...(snapshot.status === OPS_STATUS_COMPLETED ? { completedAt: snapshot.updatedAt } : {}),
  };

  if (snapshot.taskType === OPS_TASK_TYPE_VIDEO_SLICE) {
    const sliceResults = readArray(output.sliceResults)
      .map((slice, index) => mapNativeSliceResult(slice, index, createAssetUrl))
      .filter((slice): slice is TaskSliceResult => Boolean(slice));
    return {
      ...baseProjection,
      resultCount: readNumber(output.sliceCount) ?? sliceResults.length,
      generatedAssetIds: sliceResults.map((slice) => slice.id),
      sliceResults,
    };
  }

  if (snapshot.taskType === OPS_TASK_TYPE_SPEECH_TRANSCRIPTION) {
    const extractedText = readArray(output.segments)
      .map((segment) => mapNativeSpeechSegment(segment))
      .filter((segment): segment is NonNullable<AppTask['extractedText']>[number] => Boolean(segment));
    const artifactUuid = readString(output.artifactUuid);
    return {
      ...baseProjection,
      resultCount: readNumber(output.segmentCount) ?? extractedText.length,
      ...(artifactUuid ? { generatedAssetIds: [artifactUuid] } : {}),
      extractedText,
    };
  }

  const artifactUuid = readString(output.artifactUuid);
  const artifactPath = readString(output.artifactPath);
  const transcriptPath = readString(output.transcriptPath);
  const assetUrl = artifactPath ? safeCreateNativeAssetUrl(artifactPath, createAssetUrl) : undefined;
  const transcriptUrl = transcriptPath ? safeCreateNativeAssetUrl(transcriptPath, createAssetUrl) : undefined;
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
    readString(output.name),
    readString(input.name),
    readString(input.sourceName),
    readString(input.fileName),
  ];
  const namedValue = namedValues.find(Boolean);
  if (namedValue) {
    return namedValue;
  }

  const artifactPath = readString(output.artifactPath)
    ?? readString(output.transcriptPath)
    ?? readArray(output.sliceResults)
      .map((slice) => readRecord(slice))
      .map((slice) => readString(slice?.artifactPath))
      .find(Boolean);
  const artifactFileName = artifactPath ? readPathFileName(artifactPath) : undefined;
  if (artifactFileName) {
    return artifactFileName;
  }

  return `${TASK_NAME_BY_NATIVE_TYPE[snapshot.taskType] ?? 'native-task'}-${snapshot.uuid.slice(0, 8)}`;
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

function mapNativeSliceResult(
  value: unknown,
  index: number,
  createAssetUrl: (artifactPath: string) => string,
): TaskSliceResult | null {
  const slice = readRecord(value);
  if (!slice) {
    return null;
  }

  const artifactUuid = readString(slice.artifactUuid);
  const artifactPath = readString(slice.artifactPath);
  if (!artifactUuid || !artifactPath) {
    return null;
  }

  const thumbnailPath = readString(slice.thumbnailArtifactPath);
  const subtitlePath = readString(slice.subtitleArtifactPath);
  const label = readString(slice.label) ?? `Slice ${index + 1}`;
  const durationMs = readNumber(slice.durationMs) ?? 0;
  const byteSize = readNumber(slice.byteSize) ?? 0;
  const format = readString(slice.format) ?? 'mp4';
  const subtitleFormat = readString(slice.subtitleFormat);

  return {
    id: artifactUuid,
    name: `${label}.${format}`,
    duration: Math.max(1, Math.round(durationMs / 1_000)),
    size: byteSize,
    resolution: '1080P',
    thumbnailUrl: thumbnailPath ? safeCreateNativeAssetUrl(thumbnailPath, createAssetUrl) : '',
    url: safeCreateNativeAssetUrl(artifactPath, createAssetUrl),
    ...(subtitlePath ? { subtitleUrl: safeCreateNativeAssetUrl(subtitlePath, createAssetUrl) } : {}),
    ...(subtitleFormat ? { subtitleFormat } : {}),
  };
}

function mapNativeSpeechSegment(value: unknown): NonNullable<AppTask['extractedText']>[number] | null {
  const segment = readRecord(value);
  if (!segment) {
    return null;
  }

  const text = readString(segment.text)?.trim();
  if (!text) {
    return null;
  }

  return {
    time: formatNativeSegmentTimestamp(readNumber(segment.startMs) ?? 0),
    speaker: readString(segment.speaker)?.trim() || 'Speaker 1',
    text,
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

function safeCreateNativeAssetUrl(artifactPath: string, createAssetUrl: (artifactPath: string) => string) {
  try {
    return createAssetUrl(artifactPath);
  } catch {
    return artifactPath;
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
