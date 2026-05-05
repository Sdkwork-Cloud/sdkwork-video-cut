import { AUTOCUT_TASK_STATUS, type AppTask, type SubtitleTranslateParams } from '@sdkwork/autocut-types';
import { addTask, addMessage, addAsset, createAutoCutId, createAutoCutTimestamp, getAutoCutSampleVideoUrl, simulateTaskProgress, validateAutoCutProcessingSource } from '@sdkwork/autocut-services';

export async function processSubtitleTranslate(params: SubtitleTranslateParams) {
  validateAutoCutProcessingSource(params);

  const newTask: AppTask = {
    id: createAutoCutId('newTask'),
    name: params.file ? params.file.name : `原文件_翻译.mp4`,
    type: '视频字幕翻译',
    status: AUTOCUT_TASK_STATUS.pending,
    progress: 0,
    progressMessage: '解析媒体信息...',
    createdAt: createAutoCutTimestamp(),
    ...(params.fileId ? { sourceFileId: params.fileId } : {})
  };

  await addTask(newTask);
  const videoUrl = getAutoCutSampleVideoUrl();

  simulateTaskProgress(newTask.id, [
    { progress: 20, message: '提取音轨与多模态对齐...', durationMs: 1500 },
    { progress: 45, message: '语音识别与机器翻译...', durationMs: 2500 },
    { progress: 75, message: '生成双语时轴字幕...', durationMs: 1500 },
    { progress: 95, message: '视频硬字幕压制转码...', durationMs: 2000 }
  ], async () => {
    const generatedAssetId = createAutoCutId('asset-sub');

    await addAsset({
      id: generatedAssetId,
      name: `带字幕_${newTask.name}`,
      type: 'video',
      size: 35 * 1024 * 1024,
      url: videoUrl,
      sourceTaskId: newTask.id,
      sourceTaskType: newTask.type,
      createdAt: createAutoCutTimestamp(),
      updatedAt: createAutoCutTimestamp()
    });

    await addMessage({
      id: createAutoCutId('msg'),
      type: 'success',
      title: '字幕翻译完成',
      description: `双语字幕视频已生成好。`,
      createdAt: createAutoCutTimestamp(),
      read: false,
      actionUrl: '/tasks/' + newTask.id,
      actionLabel: '前往查看'
    });

    return {
      generatedAssetIds: [generatedAssetId],
      videoUrl
    };
  });

  return { success: true, taskId: newTask.id };
}
