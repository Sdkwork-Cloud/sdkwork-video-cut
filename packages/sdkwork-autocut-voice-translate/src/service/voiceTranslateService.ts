import {
  AUTOCUT_TASK_TYPE,
  AUTOCUT_TASK_STATUS,
  type AppTask,
  type AutoCutTaskProcessResult,
  type VoiceTranslateParams,
} from '@sdkwork/autocut-types';
import {
  addTask,
  createAutoCutId,
  createAutoCutTaskName,
  createAutoCutTimestamp,
  failAutoCutUnsupportedNativeProcessingTask,
  validateAutoCutProcessingSource,
} from '@sdkwork/autocut-services';

export async function processVoiceTranslate(params: VoiceTranslateParams): Promise<AutoCutTaskProcessResult> {
  validateAutoCutProcessingSource(params);
  const createdAt = createAutoCutTimestamp();

  const newTask: AppTask = {
    id: createAutoCutId('newTask'),
    name: createAutoCutTaskName({ file: params.file, fallbackSourceName: 'voice-translation-source.mp4', createdAt }),
    type: AUTOCUT_TASK_TYPE.voiceTranslate,
    status: AUTOCUT_TASK_STATUS.pending,
    progress: 0,
    progressMessage: 'Voice translation task queued...',
    createdAt,
    ...(params.fileId ? { sourceFileId: params.fileId } : {}),
  };

  await addTask(newTask);
  return await failAutoCutUnsupportedNativeProcessingTask(newTask, 'voice translation');
}
