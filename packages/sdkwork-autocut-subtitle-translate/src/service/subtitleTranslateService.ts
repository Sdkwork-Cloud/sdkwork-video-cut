import {
  AUTOCUT_TASK_STATUS,
  type AppTask,
  type AutoCutTaskProcessResult,
  type SubtitleTranslateParams,
} from '@sdkwork/autocut-types';
import {
  addTask,
  createAutoCutId,
  createAutoCutTimestamp,
  failAutoCutUnsupportedNativeProcessingTask,
  validateAutoCutProcessingSource,
} from '@sdkwork/autocut-services';

export async function processSubtitleTranslate(params: SubtitleTranslateParams): Promise<AutoCutTaskProcessResult> {
  validateAutoCutProcessingSource(params);

  const newTask: AppTask = {
    id: createAutoCutId('newTask'),
    name: params.file ? params.file.name : 'subtitle-translation.mp4',
    type: '视频字幕翻译',
    status: AUTOCUT_TASK_STATUS.pending,
    progress: 0,
    progressMessage: 'Subtitle translation task queued...',
    createdAt: createAutoCutTimestamp(),
    ...(params.fileId ? { sourceFileId: params.fileId } : {}),
  };

  await addTask(newTask);
  return await failAutoCutUnsupportedNativeProcessingTask(newTask, 'subtitle translation');
}
