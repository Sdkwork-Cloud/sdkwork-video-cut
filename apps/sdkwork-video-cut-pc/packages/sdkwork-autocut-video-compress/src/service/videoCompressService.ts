import { resolveAutoCutTrustedSourcePath } from '@sdkwork/autocut-commons';
import { AUTOCUT_TASK_STATUS, AUTOCUT_TASK_TYPE, type AppTask, type VideoCompressParams } from '@sdkwork/autocut-types';
import {
  addAsset,
  addMessage,
  addTask,
  assertAutoCutMediaHasVideoStream,
  assertAutoCutNativeArtifactInsideTaskOutputDir,
  createAutoCutId,
  createAutoCutTaskId,
  createAutoCutTaskName,
  createAutoCutTimestamp,
  failAutoCutProcessingTask,
  failAutoCutUnsupportedNativeProcessingTask,
  getAutoCutNativeHostClient,
  resolveAutoCutOutputRootDir,
  updateTask,
  validateAutoCutProcessingSource,
} from '@sdkwork/autocut-services';

function resolveDesktopSourcePath(file: File | null | undefined) {
  return resolveAutoCutTrustedSourcePath(file);
}

function createVideoCompressTask(params: VideoCompressParams): AppTask {
  const createdAt = createAutoCutTimestamp();
  return {
    id: createAutoCutTaskId('compress'),
    name: createAutoCutTaskName({ file: params.file, fallbackSourceName: 'source-video.mp4', createdAt }),
    type: AUTOCUT_TASK_TYPE.videoCompress,
    status: AUTOCUT_TASK_STATUS.pending,
    progress: 0,
    progressMessage: 'Preparing video compression task...',
    createdAt,
    ...(params.fileId ? { sourceFileId: params.fileId } : {}),
  };
}

function calculateCompressionRatio(originalSize: number, newSize: number) {
  if (originalSize <= 0 || newSize >= originalSize) {
    return 0;
  }

  return Number(((originalSize - newSize) / originalSize).toFixed(2));
}

async function finishVideoCompressTask(
  newTask: AppTask,
  videoUrl: string,
  originalSize: number,
  newSize: number,
) {
  const generatedAssetId = createAutoCutId('asset-comp');
  const timestamp = createAutoCutTimestamp();

  await addAsset({
    id: generatedAssetId,
    name: `compressed-${newTask.name}`,
    type: 'video',
    size: newSize,
    url: videoUrl,
    sourceTaskId: newTask.id,
    sourceTaskType: newTask.type,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await addMessage({
    id: createAutoCutId('msg'),
    type: 'success',
    title: 'Video compression completed',
    description: `Compressed video generated from "${newTask.name}".`,
    createdAt: createAutoCutTimestamp(),
    read: false,
    actionUrl: '/tasks/' + newTask.id,
    actionLabel: 'View task',
  });

  return {
    generatedAssetIds: [generatedAssetId],
    videoUrl,
    fileSizeStats: {
      originalSize,
      newSize,
      compressionRatio: calculateCompressionRatio(originalSize, newSize),
    },
  };
}

export async function processVideoCompress(params: VideoCompressParams) {
  validateAutoCutProcessingSource(params);

  const newTask = createVideoCompressTask(params);
  await addTask(newTask);

  const nativeHostClient = getAutoCutNativeHostClient();
  const desktopSourcePath = resolveDesktopSourcePath(params.file);
  const capabilities = await nativeHostClient.getCapabilities();
  const canCompressWithNativeHost =
    Boolean(desktopSourcePath) &&
    capabilities.mediaImportCommandReady &&
    capabilities.videoCompressCommandReady;

  if (canCompressWithNativeHost && desktopSourcePath) {
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
      assertAutoCutMediaHasVideoStream(importedMedia, 'video compression');
      await updateTask(newTask.id, {
        status: AUTOCUT_TASK_STATUS.processing,
        progress: 60,
        progressMessage: 'Running video compression and writing the standard artifact...',
      });
      const compressedVideo = await nativeHostClient.compressVideo({
        assetUuid: importedMedia.assetUuid,
        compressionMode: params.compressionMode,
        ...(outputRootDir ? { outputRootDir } : {}),
      });
      assertAutoCutNativeArtifactInsideTaskOutputDir(compressedVideo, 'video compression output');
      const videoUrl = nativeHostClient.createAssetUrl(compressedVideo.artifactPath);
      const completedData = await finishVideoCompressTask(
        newTask,
        videoUrl,
        compressedVideo.originalByteSize || importedMedia.byteSize,
        compressedVideo.byteSize,
      );

      await updateTask(newTask.id, {
        status: AUTOCUT_TASK_STATUS.completed,
        progress: 100,
        progressMessage: 'Video compression completed.',
        completedAt: createAutoCutTimestamp(),
        ...completedData,
      });
    } catch (error) {
      return await failAutoCutProcessingTask(newTask.id, String(error));
    }

    return { success: true, taskId: newTask.id };
  }

  return await failAutoCutUnsupportedNativeProcessingTask(newTask, 'video compression');
}
