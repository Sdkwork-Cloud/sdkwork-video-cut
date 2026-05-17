import { resolveAutoCutTrustedSourcePath } from '@sdkwork/autocut-commons';
import {
  AUTOCUT_TASK_STATUS,
  AUTOCUT_TASK_TYPE,
  type AppTask,
  type AutoCutTaskProcessResult,
  type AutoCutTranscriptSegment,
  type SubtitleTranslateParams,
} from '@sdkwork/autocut-types';
import {
  addAsset,
  addMessage,
  addTask,
  assertAutoCutMediaHasAudioStream,
  assertAutoCutMediaHasVideoStream,
  assertAutoCutNativeArtifactInsideTaskOutputDir,
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
  type AutoCutMediaImportResult,
  type AutoCutOpenAiCompatibleMessage,
  type AutoCutSpeechTranscriptionResult,
  type AutoCutVideoSliceArtifactResult,
  type AutoCutVideoSliceClipRequest,
  type AutoCutNativeHostClient,
} from '@sdkwork/autocut-services';

type CompletedSubtitleTranslateTaskData = Pick<
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
  | 'videoUrl'
  | 'nativeTaskId'
>;

interface SubtitleTranslateRenderedVideoOutput {
  nativeTaskId: string;
  videoUrl: string;
  videoByteSize: number;
  subtitleUrl: string;
  subtitleByteSize: number;
}

function createSubtitleTranslateTask(params: SubtitleTranslateParams): AppTask {
  const createdAt = createAutoCutTimestamp();
  return {
    id: createAutoCutTaskId('subtitle'),
    name: createAutoCutTaskName({ file: params.file, fallbackSourceName: 'subtitle-translation-source.srt', createdAt }),
    type: AUTOCUT_TASK_TYPE.subtitleTranslate,
    status: AUTOCUT_TASK_STATUS.pending,
    progress: 0,
    progressMessage: 'Subtitle extraction task queued...',
    createdAt,
    ...(params.fileId ? { sourceFileId: params.fileId } : {}),
  };
}

function normalizeSubtitleTranscriptText(text: string) {
  return text.trim().replace(/\s+/gu, ' ');
}

function createSubtitleTranscriptSegments(
  segments: ReadonlyArray<AutoCutSpeechTranscriptionResult['segments'][number]>,
): AutoCutTranscriptSegment[] {
  return segments
    .map((segment) => {
      const text = normalizeSubtitleTranscriptText(segment.text);
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

function createSubtitleTranscriptText(transcriptSegments: readonly AutoCutTranscriptSegment[]) {
  return transcriptSegments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(' ');
}

export function createSubtitleTranslateOutputSegments(
  transcriptSegments: readonly AutoCutTranscriptSegment[],
  translationSegments: readonly AutoCutTranscriptSegment[],
  keepOriginal: boolean,
): AutoCutTranscriptSegment[] {
  return translationSegments.map((translationSegment, index) => {
    const sourceSegment = transcriptSegments[index] ?? translationSegment;
    const sourceText = normalizeSubtitleTranscriptText(sourceSegment.text);
    const translatedText = normalizeSubtitleTranscriptText(translationSegment.text);
    const text = keepOriginal && sourceText && sourceText !== translatedText
      ? `${sourceText}\n${translatedText}`
      : translatedText || sourceText;

    return {
      startMs: sourceSegment.startMs,
      endMs: sourceSegment.endMs,
      text,
      ...(sourceSegment.speaker?.trim() ? { speaker: sourceSegment.speaker.trim() } : {}),
    };
  }).filter((segment) => segment.text.trim());
}

function normalizeAutoCutTranslationLanguage(language: string) {
  return language.trim() || 'target';
}

function createSubtitleTranslationPromptPayload(
  transcriptSegments: readonly AutoCutTranscriptSegment[],
  sourceLang: string,
  targetLang: string,
) {
  return JSON.stringify({
    task: 'subtitle-translate',
    sourceLang: sourceLang.trim() || 'auto',
    targetLang: normalizeAutoCutTranslationLanguage(targetLang),
    output: 'json',
    schema: {
      segments: [
        {
          index: 1,
          text: 'translated subtitle text only',
        },
      ],
    },
    segments: transcriptSegments.map((segment, index) => ({
      index: index + 1,
      startMs: segment.startMs,
      endMs: segment.endMs,
      text: segment.text,
    })),
  });
}

function parseSubtitleTranslationSegments(
  content: string,
  transcriptSegments: readonly AutoCutTranscriptSegment[],
): AutoCutTranscriptSegment[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('AutoCut subtitle translation must return JSON with a segments array.');
  }

  const segments = (parsed as { segments?: unknown }).segments;
  if (!Array.isArray(segments) || segments.length !== transcriptSegments.length) {
    throw new Error('AutoCut subtitle translation must return one translated segment for each transcript segment.');
  }

  return segments.map((segment, index) => {
    const sourceSegment = transcriptSegments[index];
    if (!sourceSegment) {
      throw new Error(`AutoCut subtitle translation segment ${index + 1} does not match a source transcript segment.`);
    }
    const translatedText = normalizeSubtitleTranscriptText(String((segment as { text?: unknown }).text ?? ''));
    if (!translatedText) {
      throw new Error(`AutoCut subtitle translation segment ${index + 1} must contain translated text.`);
    }

    return {
      startMs: sourceSegment.startMs,
      endMs: sourceSegment.endMs,
      text: translatedText,
      ...(sourceSegment.speaker ? { speaker: sourceSegment.speaker } : {}),
    };
  });
}

async function translateSubtitleTranscriptSegments(
  transcriptSegments: readonly AutoCutTranscriptSegment[],
  params: Pick<SubtitleTranslateParams, 'sourceLang' | 'targetLang'>,
) {
  const messages: AutoCutOpenAiCompatibleMessage[] = [
    {
      role: 'system',
      content:
        'Translate subtitle segments. Return only compact JSON matching {"segments":[{"index":1,"text":"..."}]}. Preserve segment count and order. Do not add commentary.',
    },
    {
      role: 'user',
      content: createSubtitleTranslationPromptPayload(transcriptSegments, params.sourceLang, params.targetLang),
    },
  ];
  const result = await createAutoCutOpenAiCompatibleChatCompletion({
    messages,
    temperature: 0.1,
    maxTokens: Math.max(1024, transcriptSegments.length * 160),
  });

  return parseSubtitleTranslationSegments(result.content, transcriptSegments);
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

export function isSubtitleTranslateHardcodeVideoSource(
  importedMedia: Pick<AutoCutMediaImportResult, 'hasVideoStream'>,
  params: Pick<SubtitleTranslateParams, 'hardcode'>,
) {
  return params.hardcode === true && importedMedia.hasVideoStream === true;
}

function createSubtitleTranslateClipTranscriptText(segments: readonly AutoCutTranscriptSegment[]) {
  return segments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function createSubtitleTranslateVideoRenderClip(
  importedMedia: Pick<AutoCutMediaImportResult, 'durationMs' | 'name'>,
  outputSegments: readonly AutoCutTranscriptSegment[],
): AutoCutVideoSliceClipRequest {
  if (outputSegments.length === 0) {
    throw new Error('AutoCut subtitle video rendering requires translated subtitle segments.');
  }

  const segmentStartMs = Math.min(...outputSegments.map((segment) => segment.startMs));
  const segmentEndMs = Math.max(...outputSegments.map((segment) => segment.endMs));
  const durationMs = Math.max(1_000, Math.ceil(importedMedia.durationMs ?? segmentEndMs));

  return {
    startMs: 0,
    durationMs,
    label: importedMedia.name || 'translated-subtitle-video',
    outputFileName: 'translated-subtitle-video.mp4',
    sourceStartMs: 0,
    sourceEndMs: durationMs,
    speechStartMs: Math.max(0, segmentStartMs),
    speechEndMs: Math.min(durationMs, Math.max(segmentEndMs, segmentStartMs + 1)),
    transcriptText: createSubtitleTranslateClipTranscriptText(outputSegments),
    transcriptSegments: outputSegments.map((segment) => ({ ...segment })),
    transcriptSegmentCount: outputSegments.length,
    transcriptCoverageScore: 1,
    speechContinuityGrade: 'strong',
  };
}

function assertSubtitleTranslateNativeRenderResult(
  nativeSlice: AutoCutVideoSliceArtifactResult | undefined,
): asserts nativeSlice is AutoCutVideoSliceArtifactResult & {
  subtitleArtifactPath: string;
  subtitleByteSize: number;
} {
  if (!nativeSlice) {
    throw new Error('AutoCut subtitle hardcode did not return a rendered video artifact.');
  }
  assertAutoCutNativeArtifactInsideTaskOutputDir(nativeSlice, 'subtitle hardcode video output');
  if (!nativeSlice.subtitleArtifactPath) {
    throw new Error('AutoCut subtitle hardcode must return a task-scoped SRT sidecar artifact.');
  }
  if (typeof nativeSlice.subtitleByteSize !== 'number' || !Number.isFinite(nativeSlice.subtitleByteSize) || nativeSlice.subtitleByteSize <= 0) {
    throw new Error('AutoCut subtitle hardcode SRT sidecar must report a positive byte size.');
  }
  assertAutoCutNativeArtifactInsideTaskOutputDir(
    {
      artifactPath: nativeSlice.subtitleArtifactPath,
      taskOutputDir: nativeSlice.taskOutputDir,
    },
    'subtitle hardcode SRT output',
  );
}

async function renderSubtitleTranslateHardcodedVideo(
  nativeHostClient: AutoCutNativeHostClient,
  importedMedia: AutoCutMediaImportResult,
  outputSegments: readonly AutoCutTranscriptSegment[],
  outputRootDir: string | undefined,
): Promise<SubtitleTranslateRenderedVideoOutput> {
  const renderClip = createSubtitleTranslateVideoRenderClip(importedMedia, outputSegments);
  const renderedVideo = await nativeHostClient.sliceVideo({
    assetUuid: importedMedia.assetUuid,
    clips: [renderClip],
    outputFormat: 'mp4',
    subtitleFormat: 'srt',
    subtitleMode: 'both',
    subtitleStyleId: 'clean-default',
    subtitleSegments: outputSegments.map((segment) => ({ ...segment })),
    ...(outputRootDir ? { outputRootDir } : {}),
  });
  if (renderedVideo.sourceAssetUuid !== importedMedia.assetUuid) {
    throw new Error('AutoCut subtitle hardcode native render result does not match the imported source asset.');
  }
  if (renderedVideo.slices.length !== 1) {
    throw new Error('AutoCut subtitle hardcode native render must return exactly one video artifact.');
  }

  const nativeSlice = renderedVideo.slices[0];
  assertSubtitleTranslateNativeRenderResult(nativeSlice);
  return {
    nativeTaskId: renderedVideo.taskUuid,
    videoUrl: nativeHostClient.createAssetUrl(nativeSlice.artifactPath),
    videoByteSize: nativeSlice.byteSize,
    subtitleUrl: nativeHostClient.createAssetUrl(nativeSlice.subtitleArtifactPath),
    subtitleByteSize: nativeSlice.subtitleByteSize,
  };
}

async function finishSubtitleTranslateTask(
  newTask: AppTask,
  transcription: AutoCutSpeechTranscriptionResult & { providerId?: string },
  transcriptSegments: AutoCutTranscriptSegment[],
  translationSegments: AutoCutTranscriptSegment[],
  outputSegments: AutoCutTranscriptSegment[],
  renderedVideo?: SubtitleTranslateRenderedVideoOutput,
): Promise<CompletedSubtitleTranslateTaskData> {
  const subtitleText = createAutoCutSrtSubtitleText(outputSegments);
  const generatedAssetIds: string[] = [];
  const timestamp = createAutoCutTimestamp();
  const subtitleObject = renderedVideo?.subtitleUrl
    ? {
        size: renderedVideo.subtitleByteSize,
        url: renderedVideo.subtitleUrl,
      }
    : createAutoCutTextObjectUrl(subtitleText);

  if (renderedVideo) {
    const generatedVideoAssetId = createAutoCutId('asset-subtitle-video');
    generatedAssetIds.push(generatedVideoAssetId);
    await addAsset({
      id: generatedVideoAssetId,
      name: `${newTask.name}.mp4`,
      type: 'video',
      size: renderedVideo.videoByteSize,
      url: renderedVideo.videoUrl,
      sourceTaskId: newTask.id,
      sourceTaskType: newTask.type,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  const generatedSubtitleAssetId = createAutoCutId('asset-subtitle');
  generatedAssetIds.push(generatedSubtitleAssetId);

  await addAsset({
    id: generatedSubtitleAssetId,
    name: `${newTask.name}.srt`,
    type: 'doc',
    size: subtitleObject.size,
    url: subtitleObject.url,
    sourceTaskId: newTask.id,
    sourceTaskType: newTask.type,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await addMessage({
    id: createAutoCutId('msg'),
    type: 'success',
    title: 'Subtitle extraction completed',
    description: `Subtitle file generated: ${newTask.name}.`,
    createdAt: createAutoCutTimestamp(),
    read: false,
    actionUrl: '/tasks/' + newTask.id,
    actionLabel: 'View task',
  });

  return {
    resultCount: 1,
    generatedAssetIds,
    subtitleUrl: subtitleObject.url,
    subtitleFormat: 'srt',
    transcriptText: createSubtitleTranscriptText(transcriptSegments),
    transcriptSegments,
    transcriptSegmentCount: transcriptSegments.length,
    translationText: createSubtitleTranscriptText(translationSegments),
    translationSegments,
    ...(renderedVideo ? { videoUrl: renderedVideo.videoUrl, nativeTaskId: renderedVideo.nativeTaskId } : {}),
    ...(transcription.providerId ? { transcriptProviderId: transcription.providerId } : {}),
    ...(transcription.sourceAssetUuid ? { transcriptSourceAssetId: transcription.sourceAssetUuid } : {}),
  };
}

export async function processSubtitleTranslate(params: SubtitleTranslateParams): Promise<AutoCutTaskProcessResult> {
  validateAutoCutProcessingSource(params);

  const newTask = createSubtitleTranslateTask(params);
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
      progressMessage: 'Preparing subtitle extraction...',
    });

    try {
      const outputRootDir = await resolveAutoCutOutputRootDir();
      const importedMedia = await nativeHostClient.importMediaFile({
        sourcePath: desktopSourcePath,
        ...(outputRootDir ? { outputRootDir } : {}),
      });
      assertAutoCutMediaHasAudioStream(importedMedia, 'subtitle translation');
      if (params.hardcode === true) {
        assertAutoCutMediaHasVideoStream(importedMedia, 'subtitle hardcode');
      }

      await updateTask(newTask.id, {
        status: AUTOCUT_TASK_STATUS.processing,
        progress: 55,
        progressMessage: 'Running speech-to-text for subtitles...',
      });

      const transcription = await transcribeAutoCutMediaWithConfiguredProvider({
        assetUuid: importedMedia.assetUuid,
        language: params.sourceLang,
        workflowPurpose: 'subtitle-translate',
        ...(outputRootDir ? { outputRootDir } : {}),
      });
      const transcriptSegments = createSubtitleTranscriptSegments(transcription.segments);
      if (transcriptSegments.length === 0) {
        throw new Error('AutoCut subtitle extraction returned no valid timestamped speech segments.');
      }

      await updateTask(newTask.id, {
        status: AUTOCUT_TASK_STATUS.processing,
        progress: 75,
        progressMessage: 'Translating subtitle segments...',
      });

      const translationSegments = await translateSubtitleTranscriptSegments(transcriptSegments, params);
      const outputSegments = createSubtitleTranslateOutputSegments(
        transcriptSegments,
        translationSegments,
        params.keepOriginal,
      );
      if (outputSegments.length === 0) {
        throw new Error('AutoCut subtitle translation returned no publishable subtitle text.');
      }
      const shouldRenderHardcodedVideo = isSubtitleTranslateHardcodeVideoSource(importedMedia, params);
      if (shouldRenderHardcodedVideo && !capabilities.videoSliceCommandReady) {
        throw new Error('AutoCut subtitle hardcode requires the native video rendering command.');
      }

      let renderedVideo: SubtitleTranslateRenderedVideoOutput | undefined;
      if (shouldRenderHardcodedVideo) {
        await updateTask(newTask.id, {
          status: AUTOCUT_TASK_STATUS.processing,
          progress: 88,
          progressMessage: 'Rendering translated subtitles into the source video...',
        });
        renderedVideo = await renderSubtitleTranslateHardcodedVideo(
          nativeHostClient,
          importedMedia,
          outputSegments,
          outputRootDir,
        );
      }
      const completedData = await finishSubtitleTranslateTask(
        newTask,
        transcription,
        transcriptSegments,
        translationSegments,
        outputSegments,
        renderedVideo,
      );
      await updateTask(newTask.id, {
        status: AUTOCUT_TASK_STATUS.completed,
        progress: 100,
        progressMessage: renderedVideo ? 'Translated subtitle video and SRT generated.' : 'Subtitle SRT generated.',
        completedAt: createAutoCutTimestamp(),
        ...completedData,
      });
    } catch (error) {
      reportAutoCutDiagnostic('error', 'subtitle-translate.native-transcription', 'Native subtitle extraction failed', error);
      return await failAutoCutProcessingTask(newTask.id, String(error));
    }

    return { success: true, taskId: newTask.id };
  }

  return await failAutoCutUnsupportedNativeProcessingTask(newTask, 'subtitle translation');
}
