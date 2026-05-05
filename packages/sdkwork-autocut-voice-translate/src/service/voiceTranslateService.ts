import {
  AUTOCUT_TASK_STATUS,
  type AppTask,
  type AutoCutTaskProcessResult,
  type VoiceTranslateParams,
} from '@sdkwork/autocut-types';
import {
  addTask,
  createAutoCutId,
  createAutoCutTimestamp,
  failAutoCutUnsupportedNativeProcessingTask,
  validateAutoCutProcessingSource,
} from '@sdkwork/autocut-services';

export async function processVoiceTranslate(params: VoiceTranslateParams): Promise<AutoCutTaskProcessResult> {
  validateAutoCutProcessingSource(params);

  const newTask: AppTask = {
    id: createAutoCutId('newTask'),
    name: params.file ? params.file.name : 'voice-translation.mp4',
    type: '视频人声翻译',
    status: AUTOCUT_TASK_STATUS.pending,
    progress: 0,
    progressMessage: 'Voice translation task queued...',
    createdAt: createAutoCutTimestamp(),
    ...(params.fileId ? { sourceFileId: params.fileId } : {}),
  };

  await addTask(newTask);
  return await failAutoCutUnsupportedNativeProcessingTask(newTask, 'voice translation');
}
