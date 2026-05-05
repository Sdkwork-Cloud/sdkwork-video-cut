import { AUTOCUT_TASK_STATUS, type AppTask } from '@sdkwork/autocut-types';
import { updateTask } from './tasks.service';

export class AutoCutProcessingTaskError extends Error {
  readonly taskId: string;

  constructor(message: string, taskId: string) {
    super(message);
    this.name = 'AutoCutProcessingTaskError';
    this.taskId = taskId;
  }
}

export interface AutoCutProcessingSourceInput {
  file?: File | null;
  fileId?: string;
  url?: string;
  allowExternalUrl?: boolean;
}

export async function failAutoCutUnsupportedNativeProcessingTask(
  task: AppTask,
  operationLabel: string,
): Promise<never> {
  const errorMessage =
    `AutoCut ${operationLabel} requires a trusted local desktop media file and the native desktop processing command.`;
  return await failAutoCutProcessingTask(task.id, errorMessage);
}

export async function failAutoCutProcessingTask(taskId: string, errorMessage: string): Promise<never> {
  await updateTask(taskId, {
    status: AUTOCUT_TASK_STATUS.failed,
    progressMessage: 'Task failed.',
    errorMessage,
  });
  throw new AutoCutProcessingTaskError(errorMessage, taskId);
}

export function getAutoCutProcessingTaskErrorTaskId(error: unknown) {
  return error instanceof AutoCutProcessingTaskError ? error.taskId : undefined;
}

function hasText(value: string | undefined) {
  return Boolean(value?.trim());
}

export function validateAutoCutProcessingSource(input: AutoCutProcessingSourceInput) {
  if (input.file || hasText(input.fileId)) {
    return;
  }

  const sourceUrl = input.url?.trim();
  if (!sourceUrl) {
    throw new Error('AutoCut processing requires a source media file, asset, or URL.');
  }

  if (!input.allowExternalUrl) {
    throw new Error('AutoCut processing source media URL is not supported for this workflow.');
  }

  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new Error('AutoCut processing source media URL is invalid.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('AutoCut processing source media URL must use http or https.');
  }
}
