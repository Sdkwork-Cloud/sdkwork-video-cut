import { AUTOCUT_TASK_STATUS, type AppTask, type VideoEnhanceParams } from '@sdkwork/autocut-types';
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

function resolveDesktopSourcePath(file: File | null | undefined) {
  return resolveAutoCutTrustedSourcePath(file);
}

function createVideoEnhanceTask(params: VideoEnhanceParams): AppTask {
  return {
    id: createAutoCutId('newTask'),
    name: params.file ? params.file.name : 'original_enhanced.mp4',
    type: '视频高清化',
    status: AUTOCUT_TASK_STATUS.pending,
    progress: 0,
    progressMessage: '准备视频增强参数...',
    createdAt: createAutoCutTimestamp(),
    ...(params.fileId ? { sourceFileId: params.fileId } : {}),
  };
}

async function finishVideoEnhanceTask(newTask: AppTask, videoUrl: string, size: number) {
  const generatedAssetId = createAutoCutId('asset-enh');
  const timestamp = createAutoCutTimestamp();

  await addAsset({
    id: generatedAssetId,
    name: `高清版_${newTask.name}`,
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
    title: '视频高清化完成',
    description: `视频画质已经完成增强处理。`,
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
        progressMessage: '执行视频清晰度增强与标准编码...',
      });
      const enhancedVideo = await nativeHostClient.enhanceVideo({
        assetUuid: importedMedia.assetUuid,
        targetResolution: params.targetResolution,
        enhanceMode: params.enhanceMode,
        frameRate: params.frameRate,
        ...(outputRootDir ? { outputRootDir } : {}),
      });
      const videoUrl = nativeHostClient.createAssetUrl(enhancedVideo.artifactPath);
      const completedData = await finishVideoEnhanceTask(newTask, videoUrl, enhancedVideo.byteSize);

      await updateTask(newTask.id, {
        status: AUTOCUT_TASK_STATUS.completed,
        progress: 100,
        progressMessage: '视频高清化完成',
        completedAt: createAutoCutTimestamp(),
        ...completedData,
      });
    } catch (error) {
      await updateTask(newTask.id, {
        status: AUTOCUT_TASK_STATUS.failed,
        progressMessage: '视频高清化失败',
        errorMessage: String(error),
      });
    }

    return { success: true, taskId: newTask.id };
  }

  const videoUrl = getAutoCutSampleVideoUrl();

  simulateTaskProgress(
    newTask.id,
    [
      { progress: 10, message: '分析视频噪点与伪影...', durationMs: 2000 },
      { progress: 30, message: '执行清晰度增强与去模糊...', durationMs: 4000 },
      { progress: 60, message: '进行帧率标准化处理...', durationMs: 3000 },
      { progress: 85, message: '后期画面色彩映射优化...', durationMs: 2000 },
      { progress: 95, message: '高码率视频编码输出...', durationMs: 2000 },
    ],
    async () => finishVideoEnhanceTask(newTask, videoUrl, 45 * 1024 * 1024),
  );

  return { success: true, taskId: newTask.id };
}
