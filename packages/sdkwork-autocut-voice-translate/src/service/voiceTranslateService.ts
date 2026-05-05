import { AUTOCUT_TASK_STATUS, type AppTask, type VoiceTranslateParams } from '@sdkwork/autocut-types';
import { addTask, addMessage, addAsset, createAutoCutId, createAutoCutTimestamp, getAutoCutSampleVideoUrl, simulateTaskProgress, validateAutoCutProcessingSource } from '@sdkwork/autocut-services';

export async function processVoiceTranslate(params: VoiceTranslateParams) {
  validateAutoCutProcessingSource(params);

  const newTask: AppTask = {
    id: createAutoCutId('newTask'),
    name: params.file ? params.file.name : `原文件_人声翻唱.mp4`,
    type: '视频人声翻译',
    status: AUTOCUT_TASK_STATUS.pending,
    progress: 0,
    progressMessage: '抽取音频特征...',
    createdAt: createAutoCutTimestamp(),
    ...(params.fileId ? { sourceFileId: params.fileId } : {})
  };

  await addTask(newTask);
  const videoUrl = getAutoCutSampleVideoUrl();

  simulateTaskProgress(newTask.id, [
    { progress: 15, message: '人声与背景音轨分离...', durationMs: 2500 },
    { progress: 35, message: '提取目标语言文本...', durationMs: 2000 },
    { progress: 55, message: '声纹克隆与原音色提取...', durationMs: 3000 },
    { progress: 75, message: '生成同音色配音与背景回填...', durationMs: 2500 },
    { progress: 95, message: '视音频时间轴对齐及封装...', durationMs: 2000 }
  ], async () => {
    const generatedAssetId = createAutoCutId('asset-voice');

    await addAsset({
      id: generatedAssetId,
      name: `人声翻译_${newTask.name}`,
      type: 'video',
      size: 15 * 1024 * 1024,
      url: videoUrl,
      sourceTaskId: newTask.id,
      sourceTaskType: newTask.type,
      createdAt: createAutoCutTimestamp(),
      updatedAt: createAutoCutTimestamp()
    });

    await addMessage({
      id: createAutoCutId('msg'),
      type: 'success',
      title: '人声翻译克隆完成',
      description: `保留原声风格的多版本配音视频已合成。`,
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
