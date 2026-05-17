import { resolveAutoCutTrustedSourcePath } from '@sdkwork/autocut-commons';
import {
  AUTOCUT_TASK_STATUS,
  AUTOCUT_TASK_TYPE,
  type AppTask,
  type AutoCutTaskProcessResult,
  type AutoCutTranscriptSegment,
  type VoiceTranslateParams,
} from '@sdkwork/autocut-types';
import {
  addAsset,
  addMessage,
  addTask,
  assertAutoCutMediaHasAudioStream,
  createAutoCutOpenAiCompatibleChatCompletion,
  createAutoCutId,
  createAutoCutTaskId,
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
  type AutoCutOpenAiCompatibleMessage,
  type AutoCutSpeechTranscriptionResult,
} from '@sdkwork/autocut-services';

type CompletedVoiceTranslateTaskData = Pick<
  AppTask,
  | 'resultCount'
  | 'generatedAssetIds'
  | 'subtitleUrl'
  | 'subtitleFormat'
  | 'transcriptText'
  | 'transcriptSegments'
  | 'transcriptSegmentCount'
  | 'translationText'
  | 'translationSegments'
  | 'transcriptProviderId'
  | 'transcriptSourceAssetId'
>;

function createVoiceTranslateTask(params: VoiceTranslateParams): AppTask {
  const createdAt = createAutoCutTimestamp();
  return {
    id: createAutoCutTaskId('voice'),
    name: createAutoCutTaskName({ file: params.file, fallbackSourceName: 'voice-translation-source.srt', createdAt }),
    type: AUTOCUT_TASK_TYPE.voiceTranslate,
    status: AUTOCUT_TASK_STATUS.pending,
    progress: 0,
    progressMessage: 'Voice translation transcript task queued...',
    createdAt,
    ...(params.fileId ? { sourceFileId: params.fileId } : {}),
  };
}

function normalizeVoiceTranscriptText(text: string) {
  return text.trim().replace(/\s+/gu, ' ');
}

function createVoiceTranscriptSegments(
  segments: ReadonlyArray<AutoCutSpeechTranscriptionResult['segments'][number]>,
): AutoCutTranscriptSegment[] {
  return segments
    .map((segment) => {
      const text = normalizeVoiceTranscriptText(segment.text);
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

function createVoiceTranscriptText(transcriptSegments: readonly AutoCutTranscriptSegment[]) {
  return transcriptSegments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(' ');
}

function normalizeAutoCutTranslationLanguage(language: string) {
  return language.trim() || 'target';
}

function createVoiceTranslationPromptPayload(
  transcriptSegments: readonly AutoCutTranscriptSegment[],
  sourceLang: string,
  targetLang: string,
) {
  return JSON.stringify({
    task: 'voice-translate',
    sourceLang: sourceLang.trim() || 'auto',
    targetLang: normalizeAutoCutTranslationLanguage(targetLang),
    output: 'json',
    schema: {
      segments: [
        {
          index: 1,
          text: 'translated voice subtitle text only',
        },
      ],
    },
    segments: transcriptSegments.map((segment, index) => ({
      index: index + 1,
      startMs: segment.startMs,
      endMs: segment.endMs,
      speaker: segment.speaker,
      text: segment.text,
    })),
  });
}

function parseVoiceTranslationSegments(
  content: string,
  transcriptSegments: readonly AutoCutTranscriptSegment[],
): AutoCutTranscriptSegment[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('AutoCut voice translation must return JSON with a segments array.');
  }

  const segments = (parsed as { segments?: unknown }).segments;
  if (!Array.isArray(segments) || segments.length !== transcriptSegments.length) {
    throw new Error('AutoCut voice translation must return one translated segment for each transcript segment.');
  }

  return segments.map((segment, index) => {
    const sourceSegment = transcriptSegments[index];
    if (!sourceSegment) {
      throw new Error(`AutoCut voice translation segment ${index + 1} does not match a source transcript segment.`);
    }
    const translatedText = normalizeVoiceTranscriptText(String((segment as { text?: unknown }).text ?? ''));
    if (!translatedText) {
      throw new Error(`AutoCut voice translation segment ${index + 1} must contain translated text.`);
    }

    return {
      startMs: sourceSegment.startMs,
      endMs: sourceSegment.endMs,
      text: translatedText,
      ...(sourceSegment.speaker ? { speaker: sourceSegment.speaker } : {}),
    };
  });
}

async function translateVoiceTranscriptSegments(
  transcriptSegments: readonly AutoCutTranscriptSegment[],
  params: Pick<VoiceTranslateParams, 'sourceLang' | 'targetLang'>,
) {
  const messages: AutoCutOpenAiCompatibleMessage[] = [
    {
      role: 'system',
      content:
        'Translate voice transcript segments for subtitle output. Return only compact JSON matching {"segments":[{"index":1,"text":"..."}]}. Preserve segment count and order. Do not add commentary.',
    },
    {
      role: 'user',
      content: createVoiceTranslationPromptPayload(transcriptSegments, params.sourceLang, params.targetLang),
    },
  ];
  const result = await createAutoCutOpenAiCompatibleChatCompletion({
    messages,
    temperature: 0.1,
    maxTokens: Math.max(1024, transcriptSegments.length * 160),
  });

  return parseVoiceTranslationSegments(result.content, transcriptSegments);
}

function formatSrtTimestamp(milliseconds: number) {
  const safeMilliseconds = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(safeMilliseconds / 3_600_000);
  const minutes = Math.floor((safeMilliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((safeMilliseconds % 60_000) / 1_000);
  const millis = safeMilliseconds % 1_000;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

export function createAutoCutSrtSubtitleText(transcriptSegments: readonly AutoCutTranscriptSegment[]) {
  return `${transcriptSegments
    .map((segment, index) => [
      String(index + 1),
      `${formatSrtTimestamp(segment.startMs)} --> ${formatSrtTimestamp(segment.endMs)}`,
      segment.text.trim(),
    ].join('\n'))
    .join('\n\n')}\n`;
}

async function finishVoiceTranslateTask(
  newTask: AppTask,
  transcription: AutoCutSpeechTranscriptionResult & { providerId?: string },
  transcriptSegments: AutoCutTranscriptSegment[],
  translationSegments: AutoCutTranscriptSegment[],
): Promise<CompletedVoiceTranslateTaskData> {
  const subtitleText = createAutoCutSrtSubtitleText(translationSegments);
  const { size, url } = createAutoCutTextObjectUrl(subtitleText);
  const generatedAssetId = createAutoCutId('asset-voice-subtitle');
  const timestamp = createAutoCutTimestamp();

  await addAsset({
    id: generatedAssetId,
    name: `${newTask.name}.srt`,
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
    title: 'Voice transcript generated',
    description: `Voice translation transcript generated: ${newTask.name}.`,
    createdAt: createAutoCutTimestamp(),
    read: false,
    actionUrl: '/tasks/' + newTask.id,
    actionLabel: 'View task',
  });

  return {
    resultCount: 1,
    generatedAssetIds: [generatedAssetId],
    subtitleUrl: url,
    subtitleFormat: 'srt',
    transcriptText: createVoiceTranscriptText(transcriptSegments),
    transcriptSegments,
    transcriptSegmentCount: transcriptSegments.length,
    translationText: createVoiceTranscriptText(translationSegments),
    translationSegments,
    ...(transcription.providerId ? { transcriptProviderId: transcription.providerId } : {}),
    ...(transcription.sourceAssetUuid ? { transcriptSourceAssetId: transcription.sourceAssetUuid } : {}),
  };
}

export async function processVoiceTranslate(params: VoiceTranslateParams): Promise<AutoCutTaskProcessResult> {
  validateAutoCutProcessingSource(params);

  const newTask = createVoiceTranslateTask(params);
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
      progressMessage: 'Preparing voice translation transcript...',
    });

    try {
      const outputRootDir = await resolveAutoCutOutputRootDir();
      const importedMedia = await nativeHostClient.importMediaFile({
        sourcePath: desktopSourcePath,
        ...(outputRootDir ? { outputRootDir } : {}),
      });
      assertAutoCutMediaHasAudioStream(importedMedia, 'voice translation');

      await updateTask(newTask.id, {
        status: AUTOCUT_TASK_STATUS.processing,
        progress: 55,
        progressMessage: 'Running speech-to-text for voice translation...',
      });

      const transcription = await transcribeAutoCutMediaWithConfiguredProvider({
        assetUuid: importedMedia.assetUuid,
        language: params.sourceLang,
        workflowPurpose: 'voice-translate',
        ...(outputRootDir ? { outputRootDir } : {}),
      });
      const transcriptSegments = createVoiceTranscriptSegments(transcription.segments);
      if (transcriptSegments.length === 0) {
        throw new Error('AutoCut voice translation returned no valid timestamped speech segments.');
      }

      await updateTask(newTask.id, {
        status: AUTOCUT_TASK_STATUS.processing,
        progress: 75,
        progressMessage: 'Translating voice transcript segments...',
      });

      const translationSegments = await translateVoiceTranscriptSegments(transcriptSegments, params);
      const completedData = await finishVoiceTranslateTask(
        newTask,
        transcription,
        transcriptSegments,
        translationSegments,
      );
      await updateTask(newTask.id, {
        status: AUTOCUT_TASK_STATUS.completed,
        progress: 100,
        progressMessage: 'Voice translation transcript and SRT generated.',
        completedAt: createAutoCutTimestamp(),
        ...completedData,
      });
    } catch (error) {
      reportAutoCutDiagnostic('error', 'voice-translate.native-transcription', 'Native voice translation transcript failed', error);
      return await failAutoCutProcessingTask(newTask.id, String(error));
    }

    return { success: true, taskId: newTask.id };
  }

  return await failAutoCutUnsupportedNativeProcessingTask(newTask, 'voice translation');
}
