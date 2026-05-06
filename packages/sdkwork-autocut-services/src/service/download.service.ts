import type { AppTask } from '@sdkwork/autocut-types';
import { createAutoCutTimestamp } from './identity.service';

export type ExtractedTextSegment = NonNullable<AppTask['extractedText']>[number];

const SMART_SLICE_TASK_EVIDENCE_SCHEMA_VERSION = '2026-05-06.autocut-smart-slice-task-evidence.v1';

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
  anchor.click();
  document.body.removeChild(anchor);
}

export function formatExtractedText(extractedText: readonly ExtractedTextSegment[] | undefined) {
  return extractedText?.map((item) => `[${item.time}] ${item.speaker}: ${item.text}`).join('\n') ?? '';
}

export function downloadExtractedTextFile(extractedText: readonly ExtractedTextSegment[] | undefined, filename: string) {
  const { url } = createAutoCutTextObjectUrl(formatExtractedText(extractedText));
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
