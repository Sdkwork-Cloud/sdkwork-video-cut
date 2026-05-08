import { resolveAutoCutTrustedSourcePath } from '@sdkwork/autocut-commons';
import {
  AUTOCUT_TASK_STATUS,
  AUTOCUT_TASK_TYPE,
  type AppTask,
  type AutoCutTranscriptSegment,
  type ExtractorTextParams,
} from '@sdkwork/autocut-types';
import {
  addAsset,
  addMessage,
  addTask,
  createAutoCutId,
  createAutoCutTaskName,
  createAutoCutTextObjectUrl,
  createAutoCutTimestamp,
  failAutoCutProcessingTask,
  failAutoCutUnsupportedNativeProcessingTask,
  getAutoCutNativeHostClient,
  reportAutoCutDiagnostic,
  resolveAutoCutOutputRootDir,
  transcribeAutoCutMediaWithConfiguredProvider,
  updateTask,
  validateAutoCutProcessingSource,
  type AutoCutSpeechTranscriptionResult,
} from '@sdkwork/autocut-services';

type ExtractedTextSegment = NonNullable<AppTask['extractedText']>[number];
type CompletedExtractorTextTaskData = Pick<
  AppTask,
  | 'resultCount'
  | 'generatedAssetIds'
  | 'extractedText'
  | 'transcriptText'
  | 'transcriptSegments'
  | 'transcriptSegmentCount'
  | 'transcriptProviderId'
  | 'transcriptSourceAssetId'
>;

function createExtractorTextTask(params: ExtractorTextParams): AppTask {
  const createdAt = createAutoCutTimestamp();
  return {
    id: createAutoCutId('newTask'),
    name: createAutoCutTaskName({ file: params.file, fallbackSourceName: 'source-transcript.txt', createdAt }),
    type: AUTOCUT_TASK_TYPE.textExtraction,
    status: AUTOCUT_TASK_STATUS.pending,
    progress: 0,
    progressMessage: 'Transcription task queued...',
    createdAt,
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
  segments: readonly AutoCutTranscriptSegment[],
  separateSpeakers: boolean,
  format: ExtractorTextParams['format'],
): ExtractedTextSegment[] {
  return segments
    .map((segment, index) => {
      const text = normalizeExtractedTranscriptText(segment.text, format);
      if (!text) {
        return null;
      }

      return {
        time: formatTranscriptTimestamp(segment.startMs),
        speaker: separateSpeakers ? segment.speaker?.trim() || `Speaker ${index + 1}` : 'Speaker 1',
        text,
      } satisfies ExtractedTextSegment;
    })
    .filter((segment): segment is ExtractedTextSegment => Boolean(segment));
}

function createNativeTaskTranscriptSegments(
  segments: ReadonlyArray<AutoCutSpeechTranscriptionResult['segments'][number]>,
  format: ExtractorTextParams['format'],
): AutoCutTranscriptSegment[] {
  return segments
    .map((segment) => {
      const text = normalizeExtractedTranscriptText(segment.text, format);
      if (!text) {
        return null;
      }

      return {
        startMs: segment.startMs,
        endMs: segment.endMs,
        text,
        ...(segment.speaker?.trim() ? { speaker: segment.speaker.trim() } : {}),
      } satisfies AutoCutTranscriptSegment;
    })
    .filter((segment): segment is AutoCutTranscriptSegment => Boolean(segment));
}

function createNativeTaskTranscriptText(transcriptSegments: readonly AutoCutTranscriptSegment[]) {
  return transcriptSegments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(' ');
}

function normalizeExtractedTranscriptText(text: string, format: ExtractorTextParams['format']) {
  const normalizedText = text.trim().replace(/\s+/gu, ' ');
  if (format !== 'filtered') {
    return normalizedText;
  }

  const filteredText = normalizedText
    .replace(/^(?:um|uh|er|ah|well|like|you know|i mean|so|okay)(?:[\s,，、.。!！?？]+|$)/iu, '')
    .replace(/(?:[\s,，、.。!！?？]+|^)(?:um|uh|er|ah|well|like|you know|i mean|okay)[.。!！?？]*$/iu, '')
    .replace(/^(?:嗯|啊|呃|额|那个|这个|就是|然后|所以|好)(?:[\s,，、.。!！?？]+|$)/u, '')
    .replace(/(?:[\s,，、.。!！?？]+|^)(?:嗯|啊|呃|额|那个|这个|就是|然后|所以|好)[.。!！?？]*$/u, '')
    .trim();

  const strippedText = filteredText.replace(/^[,，、\s]+|[,，、\s]+$/gu, '').trim();
  const trailingPunctuation = normalizedText.match(/[.。!！?？]$/u)?.[0];
  if (strippedText && trailingPunctuation && !/[.。!！?？]$/u.test(strippedText)) {
    return `${strippedText}${trailingPunctuation}`;
  }

  return strippedText;
}

async function finishExtractorTextTask(
  newTask: AppTask,
  extractedText: ExtractedTextSegment[],
  transcription: AutoCutSpeechTranscriptionResult & { providerId?: string },
  transcriptSegments: AutoCutTranscriptSegment[],
): Promise<CompletedExtractorTextTaskData> {
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
    transcriptText: createNativeTaskTranscriptText(transcriptSegments),
    transcriptSegments,
    transcriptSegmentCount: transcriptSegments.length,
    ...(transcription.providerId ? { transcriptProviderId: transcription.providerId } : {}),
    ...(transcription.sourceAssetUuid ? { transcriptSourceAssetId: transcription.sourceAssetUuid } : {}),
  };
}

export async function processExtractorText(params: ExtractorTextParams) {
  validateAutoCutProcessingSource(params);

  const newTask = createExtractorTextTask(params);
  await addTask(newTask);

  const nativeHostClient = getAutoCutNativeHostClient();
  const desktopSourcePath = resolveAutoCutTrustedSourcePath(params.file);
  const capabilities = await nativeHostClient.getCapabilities();
  const canTranscribeWithNativeHost =
    Boolean(desktopSourcePath) &&
    capabilities.mediaImportCommandReady &&
    capabilities.speechTranscriptionCommandReady;

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
      const transcription = await transcribeAutoCutMediaWithConfiguredProvider({
        assetUuid: importedMedia.assetUuid,
        language: params.language,
        ...(outputRootDir ? { outputRootDir } : {}),
      });
      const transcriptSegments = createNativeTaskTranscriptSegments(transcription.segments, params.format);
      const extractedText = createNativeExtractedTextSegments(
        transcriptSegments,
        params.separateSpeakers,
        params.format,
      );
      if (extractedText.length === 0) {
        throw new Error('AutoCut local speech-to-text returned no speech text.');
      }
      const completedData = await finishExtractorTextTask(newTask, extractedText, transcription, transcriptSegments);

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
