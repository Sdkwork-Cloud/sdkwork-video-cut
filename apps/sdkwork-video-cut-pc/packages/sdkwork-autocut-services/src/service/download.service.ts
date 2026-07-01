import { AUTOCUT_TASK_STATUS, AUTOCUT_TASK_TYPE, type AppTask } from '@sdkwork/autocut-types';
import { formatAutoCutLocalSecondTimestamp } from './datetime.service';
import { createAutoCutTimestamp } from './identity.service';

export type ExtractedTextSegment = NonNullable<AppTask['extractedText']>[number];
export type ExtractedTextDownloadSource = AppTask | readonly ExtractedTextSegment[] | undefined;

const SMART_SLICE_TASK_EVIDENCE_SCHEMA_VERSION = '2026-05-06.autocut-smart-slice-task-evidence.v1';
const TASK_PACKAGE_SCHEMA_VERSION = '2026-05-10.autocut-task-package.v1';
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_STORE_METHOD = 0;
const ZIP_VERSION_NEEDED = 20;
const ZIP_CRC_YIELD_BYTES = 4 * 1024 * 1024;

type TaskSliceResult = NonNullable<AppTask['sliceResults']>[number];

export type AutoCutTaskPackageFileKind =
  | 'task-metadata'
  | 'smart-slice-evidence'
  | 'task-transcript'
  | 'task-subtitle'
  | 'slice-video'
  | 'slice-thumbnail'
  | 'slice-subtitle'
  | 'slice-transcript'
  | 'audio-output'
  | 'video-output'
  | 'gif-output';

export interface AutoCutTaskPackageIncludedFile {
  path: string;
  kind: AutoCutTaskPackageFileKind;
  size: number;
  taskId?: string;
  taskName?: string;
  sourceUrl?: string;
}

export interface AutoCutTaskPackageSkippedFile {
  path: string;
  kind: AutoCutTaskPackageFileKind;
  taskId: string;
  taskName: string;
  url?: string;
  reason: string;
}

export interface AutoCutTaskPackageManifestTask {
  id: string;
  type: AppTask['type'];
  name: string;
  status: AppTask['status'];
  createdAt: string;
  completedAt?: string;
  resultCount?: number;
  includedFileCount: number;
  skippedFileCount: number;
}

export interface AutoCutTaskPackageManifest {
  schemaVersion: typeof TASK_PACKAGE_SCHEMA_VERSION;
  exportedAt: string;
  taskCount: number;
  includedFileCount: number;
  skippedFileCount: number;
  tasks: AutoCutTaskPackageManifestTask[];
  includedFiles: AutoCutTaskPackageIncludedFile[];
  skippedFiles: AutoCutTaskPackageSkippedFile[];
}

export type AutoCutTaskPackageFetch = (url: string) => Promise<Response>;

export interface AutoCutTaskPackageArchiveOptions {
  filename?: string;
  exportedAt?: string;
  fetchFile?: AutoCutTaskPackageFetch;
}

export interface AutoCutTaskPackageArchiveResult {
  filename: string;
  blob: Blob;
  manifest: AutoCutTaskPackageManifest;
  taskCount: number;
  includedFileCount: number;
  skippedFileCount: number;
}

interface AutoCutTaskPackagePayloadFile {
  path: string;
  bytes: Uint8Array;
}

interface AutoCutTaskPackageFileMetadata {
  kind: AutoCutTaskPackageFileKind;
  task: AppTask;
  sourceUrl?: string;
}

export function createAutoCutObjectUrl(source: Blob | MediaSource) {
  return URL.createObjectURL(source);
}

export function revokeAutoCutObjectUrl(url: string) {
  URL.revokeObjectURL(url);
}

export function createAutoCutTextObjectUrl(text: string) {
  const blob = new Blob([text], { type: 'text/plain' });
  return {
    size: blob.size,
    url: createAutoCutObjectUrl(blob),
  };
}

export function createAutoCutJsonObjectUrl(json: string) {
  const blob = new Blob([json], { type: 'application/json' });
  return {
    size: blob.size,
    url: createAutoCutObjectUrl(blob),
  };
}

export function downloadAutoCutUrl(url: string | undefined, filename: string) {
  if (!url) {
    return;
  }

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    document.body.removeChild(anchor);
  }
}

function formatTranscriptTimestamp(milliseconds: number) {
  const safeMilliseconds = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(safeMilliseconds / 3_600_000);
  const minutes = Math.floor((safeMilliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((safeMilliseconds % 60_000) / 1_000);
  const millis = safeMilliseconds % 1_000;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function isAppTaskExtractedTextSource(source: ExtractedTextDownloadSource): source is AppTask {
  return Boolean(source && !Array.isArray(source) && typeof source === 'object' && 'id' in source);
}

export function formatExtractedText(source: ExtractedTextDownloadSource) {
  if (isAppTaskExtractedTextSource(source) && source.transcriptSegments?.length) {
    return source.transcriptSegments
      .map((segment) => {
        const speaker = segment.speaker?.trim() || 'Speaker';
        return `[${formatTranscriptTimestamp(segment.startMs)} - ${formatTranscriptTimestamp(segment.endMs)}] ${speaker}: ${segment.text}`;
      })
      .join('\n');
  }

  const extractedText = isAppTaskExtractedTextSource(source) ? source.extractedText : source;
  return extractedText?.map((item) => `[${item.time}] ${item.speaker}: ${item.text}`).join('\n') ?? '';
}

export function downloadExtractedTextFile(source: ExtractedTextDownloadSource, filename: string) {
  const { url } = createAutoCutTextObjectUrl(formatExtractedText(source));
  try {
    downloadAutoCutUrl(url, filename);
  } finally {
    revokeAutoCutObjectUrl(url);
  }
}

export function createSmartSliceTaskEvidenceJson(task: AppTask, exportedAt = createAutoCutTimestamp()) {
  const evidence = {
    schemaVersion: SMART_SLICE_TASK_EVIDENCE_SCHEMA_VERSION,
    evidenceKind: 'smart-slice-task',
    exportedAt,
    id: task.id,
    type: task.type,
    name: task.name,
    status: task.status,
    progress: task.progress,
    createdAt: task.createdAt,
    ...(task.completedAt ? { completedAt: task.completedAt } : {}),
    ...(task.sourceFileId ? { sourceFileId: task.sourceFileId } : {}),
    generatedAssetIds: task.generatedAssetIds ?? [],
    resultCount: task.resultCount ?? task.sliceResults?.length ?? 0,
    sliceResults: task.sliceResults ?? [],
  };

  return `${JSON.stringify(evidence, null, 2)}\n`;
}

export function downloadSmartSliceTaskEvidenceFile(task: AppTask, filename: string) {
  const { url } = createAutoCutJsonObjectUrl(createSmartSliceTaskEvidenceJson(task));
  try {
    downloadAutoCutUrl(url, filename);
  } finally {
    revokeAutoCutObjectUrl(url);
  }
}

export function hasAutoCutTaskPackageDownloadables(task: AppTask | undefined) {
  if (!task || task.status !== AUTOCUT_TASK_STATUS.completed) {
    return false;
  }

  return Boolean(
    task.audioUrl ||
      task.videoUrl ||
      task.gifUrl ||
      task.subtitleUrl ||
      task.extractedText?.length ||
      task.translationText?.trim() ||
      task.translationSegments?.length ||
      task.transcriptText?.trim() ||
      task.transcriptSegments?.length ||
      task.sliceResults?.some((slice) =>
        Boolean(
          slice.url ||
            slice.thumbnailUrl ||
            slice.subtitleUrl ||
            slice.transcriptText?.trim() ||
            slice.transcriptSegments?.length,
        )
      ),
  );
}

export async function createAutoCutTaskPackageArchive(
  tasks: readonly AppTask[],
  options: AutoCutTaskPackageArchiveOptions = {},
): Promise<AutoCutTaskPackageArchiveResult> {
  const exportedAt = options.exportedAt ?? createAutoCutTimestamp();
  const filename = normalizeZipFilename(
    options.filename ?? `autocut-tasks-${formatAutoCutLocalSecondTimestamp(exportedAt)}.zip`,
  );
  const fetchFile = options.fetchFile ?? fetchAutoCutTaskPackageFile;
  const packageableTasks = tasks.filter(hasAutoCutTaskPackageDownloadables);

  if (packageableTasks.length === 0) {
    throw new Error('No completed task outputs are available for package download.');
  }

  const pathRegistry = new Set<string>();
  const payloadFiles: AutoCutTaskPackagePayloadFile[] = [];
  const includedFiles: AutoCutTaskPackageIncludedFile[] = [];
  const skippedFiles: AutoCutTaskPackageSkippedFile[] = [];

  const addPayloadFile = (
    requestedPath: string,
    bytes: Uint8Array,
    metadata: AutoCutTaskPackageFileMetadata,
  ) => {
    const archivePath = reserveAutoCutArchivePath(requestedPath, pathRegistry);
    payloadFiles.push({ path: archivePath, bytes });
    includedFiles.push({
      path: archivePath,
      kind: metadata.kind,
      size: bytes.byteLength,
      taskId: metadata.task.id,
      taskName: metadata.task.name,
      ...(metadata.sourceUrl ? { sourceUrl: metadata.sourceUrl } : {}),
    });
    return archivePath;
  };

  const addTextFile = (requestedPath: string, text: string, metadata: AutoCutTaskPackageFileMetadata) => {
    addPayloadFile(requestedPath, encodeAutoCutText(text), metadata);
  };

  for (const task of packageableTasks) {
    const taskDirectory = `tasks/${sanitizeArchivePathSegment(task.id)}`;
    addTextFile(
      `${taskDirectory}/task.json`,
      `${JSON.stringify(task, null, 2)}\n`,
      { kind: 'task-metadata', task },
    );

    if (task.type === AUTOCUT_TASK_TYPE.videoSlice) {
      addTextFile(
        `${taskDirectory}/smart-slice-task.json`,
        createSmartSliceTaskEvidenceJson(task, exportedAt),
        { kind: 'smart-slice-evidence', task },
      );
    }

    const taskTranscript = createTaskPackageTranscriptText(task);
    if (taskTranscript) {
      addTextFile(
        `${taskDirectory}/transcript.txt`,
        taskTranscript,
        { kind: 'task-transcript', task },
      );
    }

    if (task.audioUrl) {
      await addFetchedTaskPackageFile({
        url: task.audioUrl,
        requestedPath: `${taskDirectory}/${sanitizeArchiveFileName(`${task.name}-audio.mp3`)}`,
        kind: 'audio-output',
        task,
        fetchFile,
        addPayloadFile,
        skippedFiles,
      });
    }

    if (task.subtitleUrl) {
      await addFetchedTaskPackageFile({
        url: task.subtitleUrl,
        requestedPath: `${taskDirectory}/${sanitizeArchiveFileName(`${task.name}-subtitle.${task.subtitleFormat || 'srt'}`)}`,
        kind: 'task-subtitle',
        task,
        fetchFile,
        addPayloadFile,
        skippedFiles,
      });
    }

    if (task.videoUrl) {
      await addFetchedTaskPackageFile({
        url: task.videoUrl,
        requestedPath: `${taskDirectory}/${sanitizeArchiveFileName(`${task.name}-output.mp4`)}`,
        kind: 'video-output',
        task,
        fetchFile,
        addPayloadFile,
        skippedFiles,
      });
    }

    if (task.gifUrl) {
      await addFetchedTaskPackageFile({
        url: task.gifUrl,
        requestedPath: `${taskDirectory}/${sanitizeArchiveFileName(`${task.name}.gif`)}`,
        kind: 'gif-output',
        task,
        fetchFile,
        addPayloadFile,
        skippedFiles,
      });
    }

    for (const slice of task.sliceResults ?? []) {
      await addTaskSlicePackageFiles({
        task,
        slice,
        taskDirectory,
        fetchFile,
        addPayloadFile,
        addTextFile,
        skippedFiles,
      });
    }
  }

  const taskManifestEntries = packageableTasks.map((task) => {
    const includedFileCount = includedFiles.filter((file) => file.taskId === task.id).length;
    const skippedFileCount = skippedFiles.filter((file) => file.taskId === task.id).length;
    return {
      id: task.id,
      type: task.type,
      name: task.name,
      status: task.status,
      createdAt: task.createdAt,
      ...(task.completedAt ? { completedAt: task.completedAt } : {}),
      ...(task.resultCount !== undefined ? { resultCount: task.resultCount } : {}),
      includedFileCount,
      skippedFileCount,
    };
  });

  const manifest: AutoCutTaskPackageManifest = {
    schemaVersion: TASK_PACKAGE_SCHEMA_VERSION,
    exportedAt,
    taskCount: packageableTasks.length,
    includedFileCount: includedFiles.length,
    skippedFileCount: skippedFiles.length,
    tasks: taskManifestEntries,
    includedFiles,
    skippedFiles,
  };

  payloadFiles.unshift({
    path: 'manifest.json',
    bytes: encodeAutoCutText(`${JSON.stringify(manifest, null, 2)}\n`),
  });

  const blob = new Blob([await createStoredZipArchive(payloadFiles)], { type: 'application/zip' });
  return {
    filename,
    blob,
    manifest,
    taskCount: manifest.taskCount,
    includedFileCount: manifest.includedFileCount,
    skippedFileCount: manifest.skippedFileCount,
  };
}

export async function downloadAutoCutTaskPackage(
  tasks: readonly AppTask[],
  options: AutoCutTaskPackageArchiveOptions = {},
) {
  const archive = await createAutoCutTaskPackageArchive(tasks, options);
  const url = createAutoCutObjectUrl(archive.blob);
  try {
    downloadAutoCutUrl(url, archive.filename);
  } finally {
    revokeAutoCutObjectUrl(url);
  }
  return archive;
}

async function addTaskSlicePackageFiles({
  task,
  slice,
  taskDirectory,
  fetchFile,
  addPayloadFile,
  addTextFile,
  skippedFiles,
}: {
  task: AppTask;
  slice: TaskSliceResult;
  taskDirectory: string;
  fetchFile: AutoCutTaskPackageFetch;
  addPayloadFile: (
    requestedPath: string,
    bytes: Uint8Array,
    metadata: AutoCutTaskPackageFileMetadata,
  ) => string;
  addTextFile: (requestedPath: string, text: string, metadata: AutoCutTaskPackageFileMetadata) => void;
  skippedFiles: AutoCutTaskPackageSkippedFile[];
}) {
  const baseName = sanitizeArchiveFileName(removeKnownArchiveExtension(slice.name || slice.id));
  const outputName = sanitizeArchiveFileName(slice.name || `${slice.id}.mp4`);
  const extensionlessBaseName = removeKnownArchiveExtension(baseName);

  if (slice.url) {
    await addFetchedTaskPackageFile({
      url: slice.url,
      requestedPath: `${taskDirectory}/${outputName}`,
      kind: 'slice-video',
      task,
      fetchFile,
      addPayloadFile,
      skippedFiles,
    });
  }

  if (slice.thumbnailUrl) {
    await addFetchedTaskPackageFile({
      url: slice.thumbnailUrl,
      requestedPath: `${taskDirectory}/cover/${extensionlessBaseName}-thumbnail${inferArchiveExtensionFromUrl(slice.thumbnailUrl, '.jpg')}`,
      kind: 'slice-thumbnail',
      task,
      fetchFile,
      addPayloadFile,
      skippedFiles,
    });
  }

  if (slice.subtitleUrl) {
    await addFetchedTaskPackageFile({
      url: slice.subtitleUrl,
      requestedPath: `${taskDirectory}/${extensionlessBaseName}-subtitle.${slice.subtitleFormat || 'srt'}`,
      kind: 'slice-subtitle',
      task,
      fetchFile,
      addPayloadFile,
      skippedFiles,
    });
  }

  const transcriptText = createSlicePackageTranscriptText(slice);
  if (transcriptText) {
    addTextFile(
      `${taskDirectory}/transcripts/${extensionlessBaseName}-transcript.txt`,
      transcriptText,
      { kind: 'slice-transcript', task },
    );
  }
}

async function addFetchedTaskPackageFile({
  url,
  requestedPath,
  kind,
  task,
  fetchFile,
  addPayloadFile,
  skippedFiles,
}: {
  url: string;
  requestedPath: string;
  kind: AutoCutTaskPackageFileKind;
  task: AppTask;
  fetchFile: AutoCutTaskPackageFetch;
  addPayloadFile: (
    requestedPath: string,
    bytes: Uint8Array,
    metadata: AutoCutTaskPackageFileMetadata,
  ) => string;
  skippedFiles: AutoCutTaskPackageSkippedFile[];
}) {
  try {
    const response = await fetchFile(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    addPayloadFile(requestedPath, bytes, { kind, task, sourceUrl: url });
  } catch (error) {
    skippedFiles.push({
      path: requestedPath,
      kind,
      taskId: task.id,
      taskName: task.name,
      url,
      reason: error instanceof Error ? error.message : 'Artifact fetch failed.',
    });
  }
}

async function fetchAutoCutTaskPackageFile(url: string) {
  return fetch(url);
}

function createTaskPackageTranscriptText(task: AppTask) {
  if (task.translationSegments?.length) {
    const translation = task.translationSegments
      .map((segment) => {
        const speaker = segment.speaker?.trim() || 'Speaker';
        return `[${formatTranscriptTimestamp(segment.startMs)} - ${formatTranscriptTimestamp(segment.endMs)}] ${speaker}: ${segment.text}`;
      })
      .join('\n')
      .trim();
    if (translation) {
      return `${translation}\n`;
    }
  }

  if (task.translationText?.trim()) {
    return `${task.translationText.trim()}\n`;
  }

  const transcript = formatExtractedText(task).trim();
  return transcript ? `${transcript}\n` : '';
}

function createSlicePackageTranscriptText(slice: TaskSliceResult) {
  const lines = [
    `Slice: ${slice.title || slice.name}`,
    '',
    ...(slice.transcriptSegments?.length
      ? slice.transcriptSegments.map((segment) => {
          const speaker = segment.speaker?.trim() || 'Speaker';
          return `[${formatTranscriptTimestamp(segment.startMs)} - ${formatTranscriptTimestamp(segment.endMs)}] ${speaker}: ${segment.text}`;
        })
      : slice.transcriptText?.trim()
        ? [slice.transcriptText.trim()]
        : []),
  ];
  const text = lines.join('\n').trim();
  return text ? `${text}\n` : '';
}

function normalizeZipFilename(filename: string) {
  const safeFilename = sanitizeArchiveFileName(filename);
  return safeFilename.toLowerCase().endsWith('.zip') ? safeFilename : `${safeFilename}.zip`;
}

function sanitizeArchiveFileName(value: string) {
  const normalized = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/gu, '-')
    .replace(/\s+/gu, ' ')
    .replace(/[. ]+$/gu, '')
    .slice(0, 120);
  return normalized || 'artifact';
}

function sanitizeArchivePathSegment(value: string) {
  return sanitizeArchiveFileName(value).replaceAll('.', '-');
}

function reserveAutoCutArchivePath(requestedPath: string, registry: Set<string>) {
  const safePath = requestedPath
    .split('/')
    .filter(Boolean)
    .map(sanitizeArchiveFileName)
    .join('/');
  const extensionIndex = safePath.lastIndexOf('.');
  const slashIndex = safePath.lastIndexOf('/');
  const hasExtension = extensionIndex > slashIndex;
  const basePath = hasExtension ? safePath.slice(0, extensionIndex) : safePath;
  const extension = hasExtension ? safePath.slice(extensionIndex) : '';
  let candidate = safePath;
  let duplicateIndex = 2;

  while (registry.has(candidate)) {
    candidate = `${basePath}-${duplicateIndex}${extension}`;
    duplicateIndex += 1;
  }

  registry.add(candidate);
  return candidate;
}

function removeKnownArchiveExtension(value: string) {
  return value.replace(/\.(mp4|mov|m4v|webm|mkv|mp3|wav|m4a|aac|gif|jpg|jpeg|png|webp|srt|vtt|txt|json)$/iu, '');
}

function inferArchiveExtensionFromUrl(url: string, fallbackExtension: string) {
  try {
    const parsedUrl = new URL(url, window.location.href);
    const pathname = parsedUrl.pathname;
    const extensionMatch = pathname.match(/\.([a-z0-9]{1,8})$/iu);
    const extension = extensionMatch?.[1];
    return extension ? `.${extension.toLowerCase()}` : fallbackExtension;
  } catch {
    const extensionMatch = url.match(/\.([a-z0-9]{1,8})(?:[?#].*)?$/iu);
    const extension = extensionMatch?.[1];
    return extension ? `.${extension.toLowerCase()}` : fallbackExtension;
  }
}

function encodeAutoCutText(text: string) {
  return new TextEncoder().encode(text);
}

async function createStoredZipArchive(files: readonly AutoCutTaskPackagePayloadFile[]) {
  const chunks: Uint8Array[] = [];
  const centralDirectoryChunks: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const filenameBytes = encodeAutoCutText(file.path);
    const crc32 = await calculateCrc32(file.bytes);
    const localHeader = createZipLocalFileHeader(filenameBytes, file.bytes.byteLength, crc32);
    chunks.push(localHeader, file.bytes);
    centralDirectoryChunks.push(createZipCentralDirectoryHeader(
      filenameBytes,
      file.bytes.byteLength,
      crc32,
      offset,
    ));
    offset += localHeader.byteLength + file.bytes.byteLength;
  }

  const centralDirectoryOffset = offset;
  const centralDirectorySize = centralDirectoryChunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  chunks.push(...centralDirectoryChunks);
  chunks.push(createZipEndOfCentralDirectory(files.length, centralDirectorySize, centralDirectoryOffset));

  const totalSize = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const archive = new Uint8Array(totalSize);
  let writeOffset = 0;
  for (const chunk of chunks) {
    archive.set(chunk, writeOffset);
    writeOffset += chunk.byteLength;
  }
  return archive;
}

function createZipLocalFileHeader(filenameBytes: Uint8Array, fileSize: number, crc32: number) {
  const header = new Uint8Array(30 + filenameBytes.byteLength);
  writeZipUint32(header, 0, 0x04034b50);
  writeZipUint16(header, 4, ZIP_VERSION_NEEDED);
  writeZipUint16(header, 6, ZIP_UTF8_FLAG);
  writeZipUint16(header, 8, ZIP_STORE_METHOD);
  writeZipUint16(header, 10, 0);
  writeZipUint16(header, 12, 0);
  writeZipUint32(header, 14, crc32);
  writeZipUint32(header, 18, fileSize);
  writeZipUint32(header, 22, fileSize);
  writeZipUint16(header, 26, filenameBytes.byteLength);
  writeZipUint16(header, 28, 0);
  header.set(filenameBytes, 30);
  return header;
}

function createZipCentralDirectoryHeader(
  filenameBytes: Uint8Array,
  fileSize: number,
  crc32: number,
  localHeaderOffset: number,
) {
  const header = new Uint8Array(46 + filenameBytes.byteLength);
  writeZipUint32(header, 0, 0x02014b50);
  writeZipUint16(header, 4, ZIP_VERSION_NEEDED);
  writeZipUint16(header, 6, ZIP_VERSION_NEEDED);
  writeZipUint16(header, 8, ZIP_UTF8_FLAG);
  writeZipUint16(header, 10, ZIP_STORE_METHOD);
  writeZipUint16(header, 12, 0);
  writeZipUint16(header, 14, 0);
  writeZipUint32(header, 16, crc32);
  writeZipUint32(header, 20, fileSize);
  writeZipUint32(header, 24, fileSize);
  writeZipUint16(header, 28, filenameBytes.byteLength);
  writeZipUint16(header, 30, 0);
  writeZipUint16(header, 32, 0);
  writeZipUint16(header, 34, 0);
  writeZipUint16(header, 36, 0);
  writeZipUint32(header, 38, 0);
  writeZipUint32(header, 42, localHeaderOffset);
  header.set(filenameBytes, 46);
  return header;
}

function createZipEndOfCentralDirectory(fileCount: number, centralDirectorySize: number, centralDirectoryOffset: number) {
  const header = new Uint8Array(22);
  writeZipUint32(header, 0, 0x06054b50);
  writeZipUint16(header, 4, 0);
  writeZipUint16(header, 6, 0);
  writeZipUint16(header, 8, fileCount);
  writeZipUint16(header, 10, fileCount);
  writeZipUint32(header, 12, centralDirectorySize);
  writeZipUint32(header, 16, centralDirectoryOffset);
  writeZipUint16(header, 20, 0);
  return header;
}

function writeZipUint16(target: Uint8Array, offset: number, value: number) {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
}

function writeZipUint32(target: Uint8Array, offset: number, value: number) {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
}

let crc32Table: Uint32Array | undefined;

function getCrc32Table() {
  if (crc32Table) {
    return crc32Table;
  }

  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  crc32Table = table;
  return table;
}

async function calculateCrc32(bytes: Uint8Array) {
  const table = getCrc32Table();
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index] ?? 0;
    crc = (table[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
    if (index > 0 && index % ZIP_CRC_YIELD_BYTES === 0) {
      await Promise.resolve();
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
