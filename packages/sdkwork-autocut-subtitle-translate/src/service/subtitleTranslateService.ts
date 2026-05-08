import {
  AUTOCUT_TASK_TYPE,
  AUTOCUT_TASK_STATUS,
  type AppTask,
  type AutoCutTaskProcessResult,
  type SubtitleTranslateParams,
} from '@sdkwork/autocut-types';
import {
  addTask,
  createAutoCutId,
  createAutoCutTaskName,
  createAutoCutTimestamp,
  failAutoCutUnsupportedNativeProcessingTask,
  validateAutoCutProcessingSource,
} from '@sdkwork/autocut-services';

export async function processSubtitleTranslate(params: SubtitleTranslateParams): Promise<AutoCutTaskProcessResult> {
  validateAutoCutProcessingSource(params);
  const createdAt = createAutoCutTimestamp();

  const newTask: AppTask = {
    id: createAutoCutId('newTask'),
    name: createAutoCutTaskName({ file: params.file, fallbackSourceName: 'subtitle-translation-source.mp4', createdAt }),
    type: AUTOCUT_TASK_TYPE.subtitleTranslate,
    status: AUTOCUT_TASK_STATUS.pending,
    progress: 0,
    progressMessage: 'Subtitle translation task queued...',
    createdAt,
    ...(params.fileId ? { sourceFileId: params.fileId } : {}),
  };

  await addTask(newTask);
  return await failAutoCutUnsupportedNativeProcessingTask(newTask, 'subtitle translation');
}
