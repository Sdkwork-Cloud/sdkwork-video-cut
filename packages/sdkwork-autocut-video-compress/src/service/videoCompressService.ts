import { AUTOCUT_TASK_STATUS, type AppTask, type VideoCompressParams } from '@sdkwork/autocut-types';
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

const SIMULATED_ORIGINAL_SIZE = 55 * 1024 * 1024;
const SIMULATED_COMPRESSED_SIZE = 12 * 1024 * 1024;

function resolveDesktopSourcePath(file: File | null | undefined) {
  return resolveAutoCutTrustedSourcePath(file);
}

function createVideoCompressTask(params: VideoCompressParams): AppTask {
  return {
    id: createAutoCutId('newTask'),
    name: params.file ? params.file.name : 'original_compressed.mp4',
    type: '视频压缩',
    status: AUTOCUT_TASK_STATUS.pending,
    progress: 0,
    progressMessage: '准备分析视频编码参数...',
    createdAt: createAutoCutTimestamp(),
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
    name: `压缩后_${newTask.name}`,
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
    title: '视频压缩完成',
    description: `视频体积已减小，并保持了可交付画质。`,
    createdAt: createAutoCutTimestamp(),
    read: false,
    actionUrl: '/tasks/' + newTask.id,
    actionLabel: '前往查看',
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
        progressMessage: '执行视频压缩编码并写入标准产物...',
      });
      const compressedVideo = await nativeHostClient.compressVideo({
        assetUuid: importedMedia.assetUuid,
        compressionMode: params.compressionMode,
        ...(outputRootDir ? { outputRootDir } : {}),
      });
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
        progressMessage: '视频压缩完成',
        completedAt: createAutoCutTimestamp(),
        ...completedData,
      });
    } catch (error) {
      await updateTask(newTask.id, {
        status: AUTOCUT_TASK_STATUS.failed,
        progressMessage: '视频压缩失败',
        errorMessage: String(error),
      });
    }

    return { success: true, taskId: newTask.id };
  }

  const videoUrl = getAutoCutSampleVideoUrl();

  simulateTaskProgress(
    newTask.id,
    [
      { progress: 10, message: '分析视频复杂度与码率...', durationMs: 1500 },
      { progress: 35, message: '执行二次编码通行 (Pass 1)...', durationMs: 2000 },
      { progress: 65, message: '执行量化压缩优化 (Pass 2)...', durationMs: 3000 },
      { progress: 90, message: '封装容器并写入元数据...', durationMs: 1500 },
    ],
    async () =>
      finishVideoCompressTask(
        newTask,
        videoUrl,
        SIMULATED_ORIGINAL_SIZE,
        SIMULATED_COMPRESSED_SIZE,
      ),
  );

  return { success: true, taskId: newTask.id };
}
