import { resolveAutoCutTrustedSourcePath } from '@sdkwork/autocut-commons';
import { AUTOCUT_TASK_STATUS, AUTOCUT_TASK_TYPE, type AppTask, type VideoEnhanceParams } from '@sdkwork/autocut-types';
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

function createVideoEnhanceTask(params: VideoEnhanceParams): AppTask {
  const createdAt = createAutoCutTimestamp();
  return {
    id: createAutoCutTaskId('enhance'),
    name: createAutoCutTaskName({ file: params.file, fallbackSourceName: 'source-video.mp4', createdAt }),
    type: AUTOCUT_TASK_TYPE.videoEnhance,
    status: AUTOCUT_TASK_STATUS.pending,
    progress: 0,
    progressMessage: 'Preparing video enhancement task...',
    createdAt,
    ...(params.fileId ? { sourceFileId: params.fileId } : {}),
  };
}

async function finishVideoEnhanceTask(newTask: AppTask, videoUrl: string, size: number) {
  const generatedAssetId = createAutoCutId('asset-enh');
  const timestamp = createAutoCutTimestamp();

  await addAsset({
    id: generatedAssetId,
    name: `enhanced-${newTask.name}`,
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
    title: 'Video enhancement completed',
    description: `Enhanced video generated from "${newTask.name}".`,
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

export async function processVideoEnhance(params: VideoEnhanceParams) {
  validateAutoCutProcessingSource(params);

  const newTask = createVideoEnhanceTask(params);
  await addTask(newTask);

  const nativeHostClient = getAutoCutNativeHostClient();
  const desktopSourcePath = resolveDesktopSourcePath(params.file);
  const capabilities = await nativeHostClient.getCapabilities();
  const canEnhanceWithNativeHost =
    Boolean(desktopSourcePath) &&
    capabilities.mediaImportCommandReady &&
    capabilities.videoEnhanceCommandReady;

  if (canEnhanceWithNativeHost && desktopSourcePath) {
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
      assertAutoCutMediaHasVideoStream(importedMedia, 'video enhancement');
      await updateTask(newTask.id, {
        status: AUTOCUT_TASK_STATUS.processing,
        progress: 60,
        progressMessage: 'Running enhancement and standard video encoding...',
      });
      const enhancedVideo = await nativeHostClient.enhanceVideo({
        assetUuid: importedMedia.assetUuid,
        targetResolution: params.targetResolution,
        enhanceMode: params.enhanceMode,
        frameRate: params.frameRate,
        ...(outputRootDir ? { outputRootDir } : {}),
      });
      assertAutoCutNativeArtifactInsideTaskOutputDir(enhancedVideo, 'video enhancement output');
      const videoUrl = nativeHostClient.createAssetUrl(enhancedVideo.artifactPath);
      const completedData = await finishVideoEnhanceTask(newTask, videoUrl, enhancedVideo.byteSize);

      await updateTask(newTask.id, {
        status: AUTOCUT_TASK_STATUS.completed,
        progress: 100,
        progressMessage: 'Video enhancement completed.',
        completedAt: createAutoCutTimestamp(),
        ...completedData,
      });
    } catch (error) {
      return await failAutoCutProcessingTask(newTask.id, String(error));
    }

    return { success: true, taskId: newTask.id };
  }

  return await failAutoCutUnsupportedNativeProcessingTask(newTask, 'video enhancement');
}
