import { resolveAutoCutTrustedSourcePath } from '@sdkwork/autocut-commons';
import { AUTOCUT_TASK_STATUS, AUTOCUT_TASK_TYPE, type AppTask, type VideoConvertParams } from '@sdkwork/autocut-types';
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

function normalizeTargetFormat(targetFormat: string) {
  return targetFormat.trim().toLowerCase();
}

function resolveDesktopSourcePath(file: File | null | undefined) {
  return resolveAutoCutTrustedSourcePath(file);
}

function createVideoConvertTask(params: VideoConvertParams): AppTask {
  const createdAt = createAutoCutTimestamp();
  return {
    id: createAutoCutId('newTask'),
    name: createAutoCutTaskName({ file: params.file, fallbackSourceName: 'source-video.mp4', createdAt }),
    type: AUTOCUT_TASK_TYPE.videoConvert,
    status: AUTOCUT_TASK_STATUS.pending,
    progress: 0,
    progressMessage: 'Preparing video conversion task...',
    createdAt,
    ...(params.fileId ? { sourceFileId: params.fileId } : {}),
  };
}

async function finishVideoConvertTask(newTask: AppTask, videoUrl: string, size: number, targetFormat: string) {
  const generatedAssetId = createAutoCutId('asset-conv');
  const timestamp = createAutoCutTimestamp();

  await addAsset({
    id: generatedAssetId,
    name: `converted-${newTask.name}.${targetFormat}`,
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
    title: 'Video conversion completed',
    description: `Converted "${newTask.name}" to ${targetFormat}.`,
    createdAt: createAutoCutTimestamp(),
    read: false,
    actionUrl: '/tasks/' + newTask.id,
    actionLabel: 'View task',
  });

  return {
    generatedAssetIds: [generatedAssetId],
    videoUrl,
  };
}

export async function processVideoConvert(params: VideoConvertParams) {
  validateAutoCutProcessingSource(params);

  const targetFormat = normalizeTargetFormat(params.targetFormat);
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
      progressMessage: 'Importing local video into the desktop media sandbox...',
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
        progressMessage: 'Running video container and codec conversion...',
      });
      const convertedVideo = await nativeHostClient.convertVideo({
        assetUuid: importedMedia.assetUuid,
        targetFormat,
        videoCodec: params.videoCodec,
        audioCodec: params.audioCodec,
        resolution: params.resolution,
        ...(outputRootDir ? { outputRootDir } : {}),
      });
      assertAutoCutNativeArtifactInsideTaskOutputDir(convertedVideo, 'video conversion output');
      const videoUrl = nativeHostClient.createAssetUrl(convertedVideo.artifactPath);
      const completedData = await finishVideoConvertTask(newTask, videoUrl, convertedVideo.byteSize, targetFormat);

      await updateTask(newTask.id, {
        status: AUTOCUT_TASK_STATUS.completed,
        progress: 100,
        progressMessage: 'Video conversion completed.',
        completedAt: createAutoCutTimestamp(),
        ...completedData,
      });
    } catch (error) {
      return await failAutoCutProcessingTask(newTask.id, String(error));
    }

    return { success: true, taskId: newTask.id };
  }

  return await failAutoCutUnsupportedNativeProcessingTask(newTask, 'video conversion');
}
