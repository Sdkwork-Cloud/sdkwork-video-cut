import { AUTOCUT_TASK_STATUS, type AppTask, type AudioExtractionParams } from '@sdkwork/autocut-types';
import {
  addAsset,
  addMessage,
  addTask,
  createAutoCutId,
  createAutoCutTimestamp,
  getAutoCutNativeHostClient,
  getAutoCutSampleAudioUrl,
  resolveAutoCutOutputRootDir,
  simulateTaskProgress,
  updateTask,
  validateAutoCutProcessingSource,
} from '@sdkwork/autocut-services';
import { resolveAutoCutTrustedSourcePath } from '@sdkwork/autocut-commons';

function resolveDesktopSourcePath(file: File | null | undefined) {
  return resolveAutoCutTrustedSourcePath(file);
}

function createAudioExtractionTask(params: AudioExtractionParams): AppTask {
  return {
    id: createAutoCutId('newTask'),
    name: params.file ? params.file.name : `原文件_提取音频.${params.format}`,
    type: '视频提音',
    status: AUTOCUT_TASK_STATUS.pending,
    progress: 0,
    progressMessage: '任务排队准备中...',
    createdAt: createAutoCutTimestamp(),
    ...(params.fileId ? { sourceFileId: params.fileId } : {}),
  };
}

async function finishAudioExtractionTask(newTask: AppTask, audioUrl: string, size: number) {
  const generatedAssetId = createAutoCutId('asset-audio');
  const timestamp = createAutoCutTimestamp();

  await addAsset({
    id: generatedAssetId,
    name: newTask.name,
    type: 'audio',
    size,
    url: audioUrl,
    sourceTaskId: newTask.id,
    sourceTaskType: newTask.type,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await addMessage({
    id: createAutoCutId('msg'),
    type: 'success',
    title: '音频提取完成',
    description: `文件 "${newTask.name}" 提音已被成功转出。`,
    createdAt: createAutoCutTimestamp(),
    read: false,
    actionUrl: '/tasks/' + newTask.id,
    actionLabel: '前往查看',
  });

  return {
    generatedAssetIds: [generatedAssetId],
    audioUrl,
  };
}

export async function processAudioExtraction(params: AudioExtractionParams) {
  validateAutoCutProcessingSource(params);

  const newTask = createAudioExtractionTask(params);
  await addTask(newTask);

  const nativeHostClient = getAutoCutNativeHostClient();
  const desktopSourcePath = resolveDesktopSourcePath(params.file);
  const capabilities = await nativeHostClient.getCapabilities();
  const canExtractWithNativeHost =
    Boolean(desktopSourcePath) &&
    capabilities.mediaImportCommandReady &&
    capabilities.audioExtractionFromAssetReady;

  if (canExtractWithNativeHost && desktopSourcePath) {
    await updateTask(newTask.id, {
      status: AUTOCUT_TASK_STATUS.processing,
      progress: 20,
      progressMessage: '分析本地媒体并写入桌面沙箱...',
    });

    try {
      const outputRootDir = await resolveAutoCutOutputRootDir();
      const importedMedia = await nativeHostClient.importMediaFile({
        sourcePath: desktopSourcePath,
        ...(outputRootDir ? { outputRootDir } : {}),
      });
      await updateTask(newTask.id, {
        status: AUTOCUT_TASK_STATUS.processing,
        progress: 60,
        progressMessage: '从已导入资产提取音频轨道...',
      });
      const extractedAudio = await nativeHostClient.extractAudio({
        assetUuid: importedMedia.assetUuid,
        outputFormat: params.format,
        ...(outputRootDir ? { outputRootDir } : {}),
      });
      const audioUrl = nativeHostClient.createAssetUrl(extractedAudio.artifactPath);
      const completedData = await finishAudioExtractionTask(newTask, audioUrl, extractedAudio.byteSize);

      await updateTask(newTask.id, {
        status: AUTOCUT_TASK_STATUS.completed,
        progress: 100,
        progressMessage: '任务完成',
        completedAt: createAutoCutTimestamp(),
        ...completedData,
      });
    } catch (error) {
      await updateTask(newTask.id, {
        status: AUTOCUT_TASK_STATUS.failed,
        progressMessage: '任务失败',
        errorMessage: String(error),
      });
    }

    return { success: true, taskId: newTask.id };
  }

  simulateTaskProgress(
    newTask.id,
    [
      { progress: 20, message: '分析视频容器与音轨...', durationMs: 1500 },
      { progress: 60, message: '分离无损音频流...', durationMs: 1500 },
      { progress: 85, message: `转码到目标格式 ${params.format} (${params.quality}k)...`, durationMs: 2000 },
    ],
    async () => finishAudioExtractionTask(newTask, getAutoCutSampleAudioUrl(), 5 * 1024 * 1024),
  );

  return { success: true, taskId: newTask.id };
}
