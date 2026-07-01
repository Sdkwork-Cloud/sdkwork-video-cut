import { formatAutoCutLocalSecondTimestamp, type AutoCutTimestampInput } from './datetime.service';
import { createAutoCutTimestamp } from './identity.service';

const AUTOCUT_TASK_NAME_TIMESTAMP_PATTERN = / \d{8}-\d{6}$/u;

export interface AutoCutTaskNameInput {
  sourceName?: string | null;
  file?: Pick<File, 'name'> | null | undefined;
  url?: string | null | undefined;
  createdAt?: AutoCutTimestampInput;
  fallbackSourceName?: string;
}

export function createAutoCutTaskName(input: AutoCutTaskNameInput) {
  const sourceName = resolveAutoCutTaskSourceName(input);
  if (AUTOCUT_TASK_NAME_TIMESTAMP_PATTERN.test(sourceName)) {
    return sourceName;
  }

  return `${sourceName} ${formatAutoCutTaskNameTimestamp(input.createdAt)}`;
}

export function resolveAutoCutTaskSourceName(input: Pick<AutoCutTaskNameInput, 'sourceName' | 'file' | 'url' | 'fallbackSourceName'>) {
  return normalizeTaskSourceName(input.sourceName)
    ?? normalizeTaskSourceName(input.file?.name)
    ?? resolveTaskSourceNameFromUrl(input.url)
    ?? normalizeTaskSourceName(input.fallbackSourceName)
    ?? 'untitled-source';
}

export function formatAutoCutTaskNameTimestamp(createdAt: AutoCutTaskNameInput['createdAt'] = undefined) {
  return formatAutoCutLocalSecondTimestamp(createdAt ?? createAutoCutTimestamp());
}

function resolveTaskSourceNameFromUrl(url: string | null | undefined) {
  const sourceUrl = url?.trim();
  if (!sourceUrl) {
    return undefined;
  }

  try {
    const parsed = new URL(sourceUrl);
    const fileName = parsed.pathname.split('/').filter(Boolean).at(-1);
    return normalizeTaskSourceName(fileName ? safeDecodeTaskSourceName(fileName) : parsed.hostname);
  } catch {
    return normalizeTaskSourceName(sourceUrl);
  }
}

function safeDecodeTaskSourceName(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeTaskSourceName(value: string | null | undefined) {
  const normalized = value?.trim().replace(/\s+/gu, ' ');
  return normalized || undefined;
}
