import { resolveAutoCutTrustedSourcePath } from '@sdkwork/autocut-commons';
import { AUTOCUT_TASK_STATUS, type AppTask, type ExtractorTextParams } from '@sdkwork/autocut-types';
import {
  addAsset,
  addMessage,
  addTask,
  createAutoCutId,
  createAutoCutTextObjectUrl,
  createAutoCutTimestamp,
  failAutoCutProcessingTask,
  failAutoCutUnsupportedNativeProcessingTask,
  getAutoCutNativeHostClient,
  reportAutoCutDiagnostic,
  resolveAutoCutOutputRootDir,
  resolveAutoCutSpeechTranscriptionRuntimeConfig,
  updateTask,
  validateAutoCutProcessingSource,
  type AutoCutSpeechTranscriptionSegment,
} from '@sdkwork/autocut-services';

type ExtractedTextSegment = NonNullable<AppTask['extractedText']>[number];

function createExtractorTextTask(params: ExtractorTextParams): AppTask {
  return {
    id: createAutoCutId('newTask'),
    name: params.file ? params.file.name : 'source-transcript.txt',
    type: '文案提取',
    status: AUTOCUT_TASK_STATUS.pending,
    progress: 0,
    progressMessage: 'Transcription task queued...',
    createdAt: createAutoCutTimestamp(),
    ...(params.fileId ? { sourceFileId: params.fileId } : {}),
  };
}

function formatTranscriptTimestamp(milliseconds: number) {
  const safeMilliseconds = Math.max(0, Math.round(milliseconds));
  const totalSeconds = Math.floor(safeMilliseconds / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((part) => part.toString().padStart(2, '0'))
    .join(':');
}

function createNativeExtractedTextSegments(
  segments: readonly AutoCutSpeechTranscriptionSegment[],
  separateSpeakers: boolean,
): ExtractedTextSegment[] {
  return segments
    .filter((segment) => segment.text.trim())
    .map((segment, index) => ({
      time: formatTranscriptTimestamp(segment.startMs),
      speaker: separateSpeakers ? segment.speaker?.trim() || `Speaker ${index + 1}` : 'Speaker 1',
      text: segment.text.trim(),
    }));
}

async function finishExtractorTextTask(newTask: AppTask, extractedText: ExtractedTextSegment[]) {
  const textContent = extractedText.map((item) => `[${item.time}] ${item.speaker}: ${item.text}`).join('\n');
  const { size, url } = createAutoCutTextObjectUrl(textContent);
  const generatedAssetId = createAutoCutId('asset-text');
  const timestamp = createAutoCutTimestamp();

  await addAsset({
    id: generatedAssetId,
    name: `transcript_${newTask.name}.txt`,
    type: 'doc',
    size,
    url,
    sourceTaskId: newTask.id,
    sourceTaskType: newTask.type,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await addMessage({
    id: createAutoCutId('msg'),
    type: 'success',
    title: '鏂囨鎻愬彇瀹屾垚',
    description: `Transcript extracted: ${newTask.name}.`,
    createdAt: createAutoCutTimestamp(),
    read: false,
    actionUrl: '/tasks/' + newTask.id,
    actionLabel: '鍓嶅線鏌ョ湅',
  });

  return {
    resultCount: 1,
    generatedAssetIds: [generatedAssetId],
    extractedText,
  };
}

export async function processExtractorText(params: ExtractorTextParams) {
  validateAutoCutProcessingSource(params);

  const newTask = createExtractorTextTask(params);
  await addTask(newTask);

  const nativeHostClient = getAutoCutNativeHostClient();
  const desktopSourcePath = resolveAutoCutTrustedSourcePath(params.file);
  const capabilities = await nativeHostClient.getCapabilities();
  const speechRuntimeConfig = await resolveAutoCutSpeechTranscriptionRuntimeConfig();
  const canTranscribeWithNativeHost =
    Boolean(desktopSourcePath) &&
    capabilities.mediaImportCommandReady &&
    capabilities.speechTranscriptionCommandReady &&
    (capabilities.speechTranscriptionToolchainReady || speechRuntimeConfig.configured);

  if (canTranscribeWithNativeHost && desktopSourcePath) {
    await updateTask(newTask.id, {
      status: AUTOCUT_TASK_STATUS.processing,
      progress: 15,
      progressMessage: 'Preparing local speech transcription...',
    });

    try {
      const outputRootDir = await resolveAutoCutOutputRootDir();
      const importedMedia = await nativeHostClient.importMediaFile({
        sourcePath: desktopSourcePath,
        ...(outputRootDir ? { outputRootDir } : {}),
      });
      await updateTask(newTask.id, {
        status: AUTOCUT_TASK_STATUS.processing,
        progress: 45,
        progressMessage: 'Running local speech-to-text...',
      });
      const transcription = await nativeHostClient.transcribeMedia({
        assetUuid: importedMedia.assetUuid,
        language: params.language,
        executablePath: speechRuntimeConfig.executablePath,
        modelPath: speechRuntimeConfig.modelPath,
        ...(outputRootDir ? { outputRootDir } : {}),
      });
      const extractedText = createNativeExtractedTextSegments(
        transcription.segments,
        params.separateSpeakers,
      );
      const completedData = await finishExtractorTextTask(newTask, extractedText);

      await updateTask(newTask.id, {
        status: AUTOCUT_TASK_STATUS.completed,
        progress: 100,
        progressMessage: 'Transcription completed.',
        completedAt: createAutoCutTimestamp(),
        ...completedData,
      });
    } catch (error) {
      reportAutoCutDiagnostic('error', 'extractor-text.native-transcription', 'Native speech transcription failed', error);
      return await failAutoCutProcessingTask(newTask.id, String(error));
    }

    return { success: true, taskId: newTask.id };
  }

  return await failAutoCutUnsupportedNativeProcessingTask(newTask, 'speech transcription');
}
