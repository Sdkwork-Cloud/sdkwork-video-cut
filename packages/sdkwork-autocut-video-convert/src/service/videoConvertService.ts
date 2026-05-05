import { AUTOCUT_TASK_STATUS, type AppTask, type VideoConvertParams } from '@sdkwork/autocut-types';
import {
  addAsset,
  addMessage,
  addTask,
  createAutoCutId,
  createAutoCutTimestamp,
  getAutoCutNativeHostClient,
  getAutoCutSampleVideoUrl,
  resolveAutoCutOutputRootDir,
  simulateTaskProgress,
  updateTask,
  validateAutoCutProcessingSource,
} from '@sdkwork/autocut-services';
import { resolveAutoCutTrustedSourcePath } from '@sdkwork/autocut-commons';

function normalizeTargetFormat(targetFormat: string) {
  return targetFormat.trim().toLowerCase();
}

function resolveDesktopSourcePath(file: File | null | undefined) {
  return resolveAutoCutTrustedSourcePath(file);
}

function createVideoConvertTask(params: VideoConvertParams): AppTask {
  const targetExt = normalizeTargetFormat(params.targetFormat);
  const nameParts = (params.file?.name || 'original_convert.mp4').split('.');
  nameParts.pop();
  const baseName = nameParts.join('.') || 'converted-video';

  return {
    id: createAutoCutId('newTask'),
    name: `${baseName}.${targetExt}`,
    type: '视频格式转换',
    status: AUTOCUT_TASK_STATUS.pending,
    progress: 0,
    progressMessage: '解析封装格式...',
    createdAt: createAutoCutTimestamp(),
    ...(params.fileId ? { sourceFileId: params.fileId } : {}),
  };
}

async function finishVideoConvertTask(newTask: AppTask, videoUrl: string, size: number) {
  const generatedAssetId = createAutoCutId('asset-conv');
  const timestamp = createAutoCutTimestamp();

  await addAsset({
    id: generatedAssetId,
    name: `已转换_${newTask.name}`,
    type: 'video',
    size,
    url: videoUrl,
    sourceTaskId: newTask.id,
    sourceTaskType: newTask.type,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await addMessage({
    id: createAutoCutId('msg'),
    type: 'success',
    title: '格式转换完成',
    description: `文件格式已成功转换为 ${newTask.name.split('.').at(-1) || 'video'}。`,
    createdAt: createAutoCutTimestamp(),
    read: false,
    actionUrl: '/tasks/' + newTask.id,
    actionLabel: '前往查看',
  });

  return {
    generatedAssetIds: [generatedAssetId],
    videoUrl,
  };
}

export async function processVideoConvert(params: VideoConvertParams) {
  validateAutoCutProcessingSource(params);

  const newTask = createVideoConvertTask(params);
  await addTask(newTask);

  const nativeHostClient = getAutoCutNativeHostClient();
  const desktopSourcePath = resolveDesktopSourcePath(params.file);
  const capabilities = await nativeHostClient.getCapabilities();
  const canConvertWithNativeHost =
    Boolean(desktopSourcePath) &&
    capabilities.mediaImportCommandReady &&
    capabilities.videoConvertCommandReady;

  if (canConvertWithNativeHost && desktopSourcePath) {
    await updateTask(newTask.id, {
      status: AUTOCUT_TASK_STATUS.processing,
      progress: 20,
      progressMessage: '导入本地视频到桌面媒体沙箱...',
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
        progressMessage: '执行视频封装与编码转换...',
      });
      const convertedVideo = await nativeHostClient.convertVideo({
        assetUuid: importedMedia.assetUuid,
        targetFormat: normalizeTargetFormat(params.targetFormat),
        videoCodec: params.videoCodec,
        audioCodec: params.audioCodec,
        resolution: params.resolution,
        ...(outputRootDir ? { outputRootDir } : {}),
      });
      const videoUrl = nativeHostClient.createAssetUrl(convertedVideo.artifactPath);
      const completedData = await finishVideoConvertTask(newTask, videoUrl, convertedVideo.byteSize);

      await updateTask(newTask.id, {
        status: AUTOCUT_TASK_STATUS.completed,
        progress: 100,
        progressMessage: '视频格式转换完成',
        completedAt: createAutoCutTimestamp(),
        ...completedData,
      });
    } catch (error) {
      await updateTask(newTask.id, {
        status: AUTOCUT_TASK_STATUS.failed,
        progressMessage: '视频格式转换失败',
        errorMessage: String(error),
      });
    }

    return { success: true, taskId: newTask.id };
  }

  const videoUrl = getAutoCutSampleVideoUrl();

  simulateTaskProgress(
    newTask.id,
    [
      { progress: 20, message: '重新复用视频流...', durationMs: 1500 },
      { progress: 60, message: `重新编码音频轨道至 ${params.audioCodec}...`, durationMs: 2500 },
      { progress: 95, message: '快速封包写入...', durationMs: 1500 },
    ],
    async () => finishVideoConvertTask(newTask, videoUrl, 20 * 1024 * 1024),
  );

  return { success: true, taskId: newTask.id };
}
