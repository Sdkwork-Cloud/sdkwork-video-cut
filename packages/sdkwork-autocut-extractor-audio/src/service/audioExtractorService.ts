import { AUTOCUT_TASK_STATUS, AUTOCUT_TASK_TYPE, type AppTask, type AudioExtractionParams } from '@sdkwork/autocut-types';
import {
  addAsset,
  addMessage,
  addTask,
  assertAutoCutNativeArtifactInsideTaskOutputDir,
  createAutoCutId,
  createAutoCutTaskName,
  createAutoCutTimestamp,
  failAutoCutProcessingTask,
  failAutoCutUnsupportedNativeProcessingTask,
  getAutoCutNativeHostClient,
  resolveAutoCutOutputRootDir,
  updateTask,
  validateAutoCutProcessingSource,
} from '@sdkwork/autocut-services';
import { resolveAutoCutTrustedSourcePath } from '@sdkwork/autocut-commons';

function resolveDesktopSourcePath(file: File | null | undefined) {
  return resolveAutoCutTrustedSourcePath(file);
}

function createAudioExtractionTask(params: AudioExtractionParams): AppTask {
  const createdAt = createAutoCutTimestamp();
  return {
    id: createAutoCutId('newTask'),
    name: createAutoCutTaskName({ file: params.file, fallbackSourceName: `source-audio.${params.format}`, createdAt }),
    type: AUTOCUT_TASK_TYPE.audioExtraction,
    status: AUTOCUT_TASK_STATUS.pending,
    progress: 0,
    progressMessage: '任务排队准备中...',
    createdAt,
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
      assertAutoCutNativeArtifactInsideTaskOutputDir(extractedAudio, 'audio extraction output');
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
      return await failAutoCutProcessingTask(newTask.id, String(error));
    }

    return { success: true, taskId: newTask.id };
  }

  return await failAutoCutUnsupportedNativeProcessingTask(newTask, 'audio extraction');
}
