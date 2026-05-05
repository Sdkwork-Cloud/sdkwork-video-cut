import { AUTOCUT_TASK_STATUS, type AppTask, type VideoGifParams } from '@sdkwork/autocut-types';
import {
  addAsset,
  addMessage,
  addTask,
  createAutoCutId,
  createAutoCutTimestamp,
  getAutoCutNativeHostClient,
  getAutoCutSampleGifUrl,
  resolveAutoCutOutputRootDir,
  simulateTaskProgress,
  updateTask,
  validateAutoCutProcessingSource,
} from '@sdkwork/autocut-services';
import { resolveAutoCutTrustedSourcePath } from '@sdkwork/autocut-commons';

function resolveDesktopSourcePath(file: File | null | undefined) {
  return resolveAutoCutTrustedSourcePath(file);
}

function createVideoGifTask(params: VideoGifParams): AppTask {
  const nameParts = (params.file?.name || '鍘熸枃浠禵杞姩鍥?mp4').split('.');
  nameParts.pop();
  const outName = `${nameParts.join('.')}.gif`;

  return {
    id: createAutoCutId('newTask'),
    name: outName,
    type: '视频转gif',
    status: AUTOCUT_TASK_STATUS.pending,
    progress: 0,
    progressMessage: '鍔犺浇鎶藉彇閫夊尯鑼冨洿...',
    createdAt: createAutoCutTimestamp(),
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
    title: '杞?GIF 鍔ㄥ浘瀹屾垚',
    description: `楂樺搧璐?GIF 鍔ㄥ浘宸茶嚜鍔ㄤ繚瀛樸€俙`,
    createdAt: createAutoCutTimestamp(),
    read: false,
    actionUrl: '/tasks/' + newTask.id,
    actionLabel: '鍓嶅線鏌ョ湅',
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
      progressMessage: '鍒嗘瀽鏈湴濯掍綋骞跺啓鍏ユ闈㈡矙绠?..',
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
        progressMessage: '浠庡凡瀵煎叆璧勪骇鐢熸垚 GIF 鍔ㄥ浘...',
      });
      const generatedGif = await nativeHostClient.generateGif({
        assetUuid: importedMedia.assetUuid,
        fps: params.fps,
        resolution: params.resolution,
        dither: params.dither,
        ...(outputRootDir ? { outputRootDir } : {}),
      });
      const gifUrl = nativeHostClient.createAssetUrl(generatedGif.artifactPath);
      const completedData = await finishVideoGifTask(newTask, gifUrl, generatedGif.byteSize);

      await updateTask(newTask.id, {
        status: AUTOCUT_TASK_STATUS.completed,
        progress: 100,
        progressMessage: '浠诲姟瀹屾垚',
        completedAt: createAutoCutTimestamp(),
        ...completedData,
      });
    } catch (error) {
      await updateTask(newTask.id, {
        status: AUTOCUT_TASK_STATUS.failed,
        progressMessage: '浠诲姟澶辫触',
        errorMessage: String(error),
      });
    }

    return { success: true, taskId: newTask.id };
  }

  simulateTaskProgress(
    newTask.id,
    [
      { progress: 20, message: '鎻愬彇瑙嗛搴忓垪甯?..', durationMs: 1500 },
      { progress: 50, message: '璁＄畻鍏ㄥ眬璋冭壊鏉?..', durationMs: 2000 },
      { progress: 85, message: '搴旂敤鎶栧姩绠楁硶涓庤壊褰╅噺鍖?..', durationMs: 2500 },
    ],
    async () => finishVideoGifTask(newTask, getAutoCutSampleGifUrl(), 2 * 1024 * 1024),
  );

  return { success: true, taskId: newTask.id };
}
