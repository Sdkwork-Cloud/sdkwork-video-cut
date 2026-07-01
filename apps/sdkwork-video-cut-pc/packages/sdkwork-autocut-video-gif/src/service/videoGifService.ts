import { resolveAutoCutTrustedSourcePath } from '@sdkwork/autocut-commons';
import { AUTOCUT_TASK_STATUS, AUTOCUT_TASK_TYPE, type AppTask, type VideoGifParams } from '@sdkwork/autocut-types';
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

function createVideoGifTask(params: VideoGifParams): AppTask {
  const createdAt = createAutoCutTimestamp();
  return {
    id: createAutoCutTaskId('gif'),
    name: createAutoCutTaskName({ file: params.file, fallbackSourceName: 'source-video.mp4', createdAt }),
    type: AUTOCUT_TASK_TYPE.videoGif,
    status: AUTOCUT_TASK_STATUS.pending,
    progress: 0,
    progressMessage: 'Preparing video GIF task...',
    createdAt,
    ...(params.fileId ? { sourceFileId: params.fileId } : {}),
  };
}

async function finishVideoGifTask(newTask: AppTask, gifUrl: string, size: number) {
  const generatedAssetId = createAutoCutId('asset-gif');
  const timestamp = createAutoCutTimestamp();

  await addAsset({
    id: generatedAssetId,
    name: newTask.name,
    type: 'image',
    size,
    url: gifUrl,
    sourceTaskId: newTask.id,
    sourceTaskType: newTask.type,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await addMessage({
    id: createAutoCutId('msg'),
    type: 'success',
    title: 'Video GIF completed',
    description: `GIF generated from "${newTask.name}".`,
    createdAt: createAutoCutTimestamp(),
    read: false,
    actionUrl: '/tasks/' + newTask.id,
    actionLabel: 'View task',
  });

  return {
    generatedAssetIds: [generatedAssetId],
    gifUrl,
  };
}

export async function processVideoGif(params: VideoGifParams) {
  validateAutoCutProcessingSource(params);

  const newTask = createVideoGifTask(params);
  await addTask(newTask);

  const nativeHostClient = getAutoCutNativeHostClient();
  const desktopSourcePath = resolveDesktopSourcePath(params.file);
  const capabilities = await nativeHostClient.getCapabilities();
  const canGenerateWithNativeHost =
    Boolean(desktopSourcePath) &&
    capabilities.mediaImportCommandReady &&
    capabilities.videoGifCommandReady;

  if (canGenerateWithNativeHost && desktopSourcePath) {
    await updateTask(newTask.id, {
      status: AUTOCUT_TASK_STATUS.processing,
      progress: 20,
      progressMessage: 'Importing local media into the desktop media sandbox...',
    });

    try {
      const outputRootDir = await resolveAutoCutOutputRootDir();
      const importedMedia = await nativeHostClient.importMediaFile({
        sourcePath: desktopSourcePath,
        ...(outputRootDir ? { outputRootDir } : {}),
      });
      assertAutoCutMediaHasVideoStream(importedMedia, 'video GIF generation');
      await updateTask(newTask.id, {
        status: AUTOCUT_TASK_STATUS.processing,
        progress: 60,
        progressMessage: 'Generating GIF from the source video...',
      });
      const generatedGif = await nativeHostClient.generateGif({
        assetUuid: importedMedia.assetUuid,
        fps: params.fps,
        resolution: params.resolution,
        dither: params.dither,
        ...(outputRootDir ? { outputRootDir } : {}),
      });
      assertAutoCutNativeArtifactInsideTaskOutputDir(generatedGif, 'video GIF output');
      const gifUrl = nativeHostClient.createAssetUrl(generatedGif.artifactPath);
      const completedData = await finishVideoGifTask(newTask, gifUrl, generatedGif.byteSize);

      await updateTask(newTask.id, {
        status: AUTOCUT_TASK_STATUS.completed,
        progress: 100,
        progressMessage: 'Video GIF completed.',
        completedAt: createAutoCutTimestamp(),
        ...completedData,
      });
    } catch (error) {
      return await failAutoCutProcessingTask(newTask.id, String(error));
    }

    return { success: true, taskId: newTask.id };
  }

  return await failAutoCutUnsupportedNativeProcessingTask(newTask, 'video GIF generation');
}
