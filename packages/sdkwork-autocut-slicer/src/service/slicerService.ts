import { resolveAutoCutTrustedSourcePath } from '@sdkwork/autocut-commons';
import {
  AUTOCUT_TASK_STATUS,
  type AppTask,
  type TaskSliceResult,
  type VideoSliceParams,
} from '@sdkwork/autocut-types';
import {
  addAsset,
  addMessage,
  addTask,
  createAutoCutId,
  createAutoCutOpenAiCompatibleChatCompletion,
  createAutoCutTimestamp,
  getAutoCutNativeHostClient,
  reportAutoCutDiagnostic,
  resolveAutoCutOutputRootDir,
  resolveAutoCutSpeechTranscriptionRuntimeConfig,
  failAutoCutProcessingTask,
  failAutoCutUnsupportedNativeProcessingTask,
  updateTask,
  validateAutoCutProcessingSource,
  type AutoCutSpeechTranscriptionSegment,
  type AutoCutVideoSliceArtifactResult,
  type AutoCutVideoSliceClipRequest,
} from '@sdkwork/autocut-services';

const DEFAULT_SLICE_COUNT = 5;
const MIN_SLICE_DURATION_MS = 5_000;
const MAX_SLICE_DURATION_MS = 10 * 60 * 1_000;

interface NormalizedSlicePlanClip extends AutoCutVideoSliceClipRequest {
  index: number;
}

function sortSliceClipsByStartMs(clips: NormalizedSlicePlanClip[]) {
  const sorted: NormalizedSlicePlanClip[] = [];
  for (const clip of clips) {
    const insertIndex = sorted.findIndex((existingClip) => clip.startMs < existingClip.startMs);
    if (insertIndex < 0) {
      sorted.push(clip);
    } else {
      sorted.splice(insertIndex, 0, clip);
    }
  }

  return sorted;
}

function getVideoSliceSourceName(params: VideoSliceParams) {
  if (params.file) {
    return params.file.name;
  }

  if (params.url) {
    try {
      return new URL(params.url).hostname || params.url;
    } catch {
      return params.url;
    }
  }

  return `视频切片_${params.mode}.mp4`;
}

function createVideoSliceTask(params: VideoSliceParams): AppTask {
  return {
    id: createAutoCutId('newTask'),
    name: getVideoSliceSourceName(params),
    type: '视频切片',
    status: AUTOCUT_TASK_STATUS.pending,
    progress: 0,
    progressMessage: '任务排队中...',
    createdAt: createAutoCutTimestamp(),
    ...(params.fileId ? { sourceFileId: params.fileId } : {}),
  };
}

function normalizeSliceDurationMs(durationSeconds: number) {
  const durationMs = Math.round(durationSeconds * 1_000);
  if (!Number.isFinite(durationMs)) {
    return 15_000;
  }

  return Math.max(MIN_SLICE_DURATION_MS, Math.min(durationMs, MAX_SLICE_DURATION_MS));
}

function createDeterministicSlicePlan(params: VideoSliceParams): NormalizedSlicePlanClip[] {
  const minDurationMs = normalizeSliceDurationMs(params.minDuration);
  const maxDurationMs = normalizeSliceDurationMs(params.maxDuration);
  const durationMs = Math.min(minDurationMs, maxDurationMs);
  const spacingMs = Math.max(durationMs, 10_000);

  return Array.from({ length: DEFAULT_SLICE_COUNT }).map((_, index) => ({
    index,
    startMs: index * spacingMs,
    durationMs,
    label: `高光片段 ${index + 1}`,
  }));
}

function createTranscriptAssistedSlicePlan(
  params: VideoSliceParams,
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[],
): NormalizedSlicePlanClip[] {
  const minDurationMs = normalizeSliceDurationMs(params.minDuration);
  const maxDurationMs = normalizeSliceDurationMs(params.maxDuration);
  const fallbackDurationMs = Math.min(minDurationMs, maxDurationMs);
  const orderedSegments = sortSliceClipsByStartMs(
    transcriptSegments
      .filter((segment) => segment.text.trim())
      .filter((segment) => Number.isFinite(segment.startMs) && segment.startMs >= 0)
      .map((segment, index) => ({
        index,
        startMs: Math.round(segment.startMs),
        durationMs: Math.max(
          minDurationMs,
          Math.min(Math.round(segment.endMs - segment.startMs), maxDurationMs),
        ),
        label: segment.text.trim().slice(0, 48) || `Transcript highlight ${index + 1}`,
      })),
  );

  if (orderedSegments.length === 0) {
    return createDeterministicSlicePlan(params);
  }

  const clips: NormalizedSlicePlanClip[] = [];
  const appendClip = (startMs: number, durationMs: number, label: string) => {
    if (clips.length >= DEFAULT_SLICE_COUNT) {
      return;
    }
    const nextAvailableStartMs = clips.reduce(
      (maxEnd, clip) => Math.max(maxEnd, clip.startMs + clip.durationMs),
      0,
    );
    clips.push({
      index: clips.length,
      startMs: Math.max(startMs, clips.length === 0 ? 0 : nextAvailableStartMs),
      durationMs: Math.max(minDurationMs, Math.min(durationMs, maxDurationMs)),
      label: label.trim() || `Transcript highlight ${clips.length + 1}`,
    });
  };

  for (const segment of orderedSegments) {
    appendClip(segment.startMs, segment.durationMs, segment.label);
  }

  while (clips.length < DEFAULT_SLICE_COUNT) {
    const startMs = clips.reduce((maxEnd, clip) => Math.max(maxEnd, clip.startMs + clip.durationMs), 0);
    appendClip(startMs, fallbackDurationMs, `楂樺厜鐗囨 ${clips.length + 1}`);
  }

  return clips;
}

function normalizeCandidateSlicePlan(
  candidates: NormalizedSlicePlanClip[],
  params: VideoSliceParams,
): NormalizedSlicePlanClip[] {
  const minDurationMs = normalizeSliceDurationMs(params.minDuration);
  const maxDurationMs = normalizeSliceDurationMs(params.maxDuration);
  const fallbackDurationMs = Math.min(minDurationMs, maxDurationMs);
  const normalizedCandidates = sortSliceClipsByStartMs(candidates
    .filter((clip) => Number.isFinite(clip.startMs) && clip.startMs >= 0 && Number.isFinite(clip.durationMs))
    .map((clip, index) => ({
      index,
      startMs: Math.round(clip.startMs),
      durationMs: Math.max(minDurationMs, Math.min(Math.round(clip.durationMs), maxDurationMs)),
      label: clip.label?.trim() || `楂樺厜鐗囨 ${index + 1}`,
    })));

  const clips: NormalizedSlicePlanClip[] = [];

  const appendClip = (startMs: number, durationMs: number, label: string) => {
    if (clips.length >= DEFAULT_SLICE_COUNT) {
      return;
    }

    clips.push({
      index: clips.length,
      startMs,
      durationMs,
      label,
    });
  };

  for (const candidate of normalizedCandidates) {
    if (clips.length >= DEFAULT_SLICE_COUNT) {
      break;
    }

    let nextAvailableStartMs = clips.reduce(
      (maxEnd, clip) => Math.max(maxEnd, clip.startMs + clip.durationMs),
      0,
    );

    while (clips.length < DEFAULT_SLICE_COUNT && nextAvailableStartMs + fallbackDurationMs <= candidate.startMs) {
      appendClip(nextAvailableStartMs, fallbackDurationMs, `楂樺厜鐗囨 ${clips.length + 1}`);
      nextAvailableStartMs += fallbackDurationMs;
    }

    if (clips.length >= DEFAULT_SLICE_COUNT) {
      break;
    }

    nextAvailableStartMs = clips.reduce(
      (maxEnd, clip) => Math.max(maxEnd, clip.startMs + clip.durationMs),
      0,
    );
    if (candidate.startMs >= nextAvailableStartMs) {
      appendClip(candidate.startMs, candidate.durationMs, candidate.label);
    }
  }

  while (clips.length < DEFAULT_SLICE_COUNT) {
    const startMs = clips.reduce((maxEnd, clip) => Math.max(maxEnd, clip.startMs + clip.durationMs), 0);
    appendClip(startMs, fallbackDurationMs, `楂樺厜鐗囨 ${clips.length + 1}`);
  }

  return clips;
}

function parseLlmSlicePlan(
  content: string,
  params: VideoSliceParams,
  fallbackPlan: NormalizedSlicePlanClip[],
): NormalizedSlicePlanClip[] {
  const jsonStart = content.indexOf('[');
  const jsonEnd = content.lastIndexOf(']');
  if (jsonStart < 0 || jsonEnd <= jsonStart) {
    return fallbackPlan;
  }

  try {
    const parsed = JSON.parse(content.slice(jsonStart, jsonEnd + 1));
    if (!Array.isArray(parsed)) {
      return fallbackPlan;
    }

    const minDurationMs = normalizeSliceDurationMs(params.minDuration);
    const maxDurationMs = normalizeSliceDurationMs(params.maxDuration);
    const normalized = parsed
      .slice(0, DEFAULT_SLICE_COUNT)
      .map((clip, index) => {
        const startMs = Number(clip?.startMs);
        const durationMs = Number(clip?.durationMs);
        const label = typeof clip?.label === 'string' ? clip.label.trim() : '';
        if (!Number.isFinite(startMs) || startMs < 0 || !Number.isFinite(durationMs)) {
          return null;
        }

        return {
          index,
          startMs: Math.round(startMs),
          durationMs: Math.max(minDurationMs, Math.min(Math.round(durationMs), maxDurationMs)),
          label: label || `高光片段 ${index + 1}`,
        };
      })
      .filter((clip): clip is NormalizedSlicePlanClip => Boolean(clip));

    return normalized.length > 0 ? normalizeCandidateSlicePlan(normalized, params) : fallbackPlan;
  } catch {
    return fallbackPlan;
  }
}

async function createIntelligentSlicePlan(
  params: VideoSliceParams,
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[] = [],
) {
  const fallbackPlan =
    transcriptSegments.length > 0
      ? createTranscriptAssistedSlicePlan(params, transcriptSegments)
      : createDeterministicSlicePlan(params);

  try {
    const transcriptTimeline = transcriptSegments.slice(0, 80).map((segment) => ({
      startMs: segment.startMs,
      endMs: segment.endMs,
      speaker: segment.speaker,
      text: segment.text,
    }));
    const result = await createAutoCutOpenAiCompatibleChatCompletion({
      messages: [
        {
          role: 'system',
          content:
            'You are AutoCut video highlight planner. Return only a compact JSON array of clips with startMs, durationMs, and label.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            mode: params.mode,
            baseAlgorithm: params.baseAlgorithm,
            highlightEngine: params.highlightEngine,
            minDurationMs: normalizeSliceDurationMs(params.minDuration),
            maxDurationMs: normalizeSliceDurationMs(params.maxDuration),
            requestedClipCount: DEFAULT_SLICE_COUNT,
            filters: {
              noiseReduction: params.enableNoiseReduction,
              coughFilter: params.enableCoughFilter,
              repeatFilter: params.enableRepeatFilter,
              subtitles: params.enableSubtitles,
            },
            transcriptAssisted: transcriptTimeline.length > 0,
            transcriptTimeline,
          }),
        },
      ],
    });

    return parseLlmSlicePlan(result.content, params, fallbackPlan);
  } catch {
    return fallbackPlan;
  }
}

async function finishVideoSliceTask(newTask: AppTask, sliceResults: TaskSliceResult[]) {
  const timestamp = createAutoCutTimestamp();

  for (const sliceResult of sliceResults) {
    await addAsset({
      id: sliceResult.id,
      name: sliceResult.name,
      type: 'video',
      size: sliceResult.size,
      url: sliceResult.url,
      thumbnailUrl: sliceResult.thumbnailUrl,
      sourceTaskId: newTask.id,
      sourceTaskType: newTask.type,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  await addMessage({
    id: createAutoCutId('msg'),
    type: 'success',
    title: '视频切片完成',
    description: `任务 "${newTask.name}" 已生成 ${sliceResults.length} 个视频片段。`,
    createdAt: createAutoCutTimestamp(),
    read: false,
    actionUrl: '/tasks/' + newTask.id,
    actionLabel: '查看任务',
  });

  return {
    resultCount: sliceResults.length,
    generatedAssetIds: sliceResults.map((sliceResult) => sliceResult.id),
    sliceResults,
  };
}

function createNativeSliceResult(
  newTask: AppTask,
  nativeSlice: AutoCutVideoSliceArtifactResult,
  index: number,
  url: string,
  thumbnailUrl: string,
  subtitleUrl?: string,
): TaskSliceResult {
  return {
    id: nativeSlice.artifactUuid,
    name: `${newTask.name}_${nativeSlice.label || `高光片段 ${index + 1}`}.mp4`,
    duration: Math.max(1, Math.round(nativeSlice.durationMs / 1_000)),
    size: nativeSlice.byteSize,
    resolution: '1080P',
    thumbnailUrl,
    url,
    ...(subtitleUrl ? { subtitleUrl } : {}),
    ...(nativeSlice.subtitleFormat ? { subtitleFormat: nativeSlice.subtitleFormat } : {}),
  };
}

export async function processVideoSlice(params: VideoSliceParams) {
  validateAutoCutProcessingSource({ ...params, allowExternalUrl: true });

  const newTask = createVideoSliceTask(params);
  await addTask(newTask);

  const nativeHostClient = getAutoCutNativeHostClient();
  const desktopSourcePath = resolveAutoCutTrustedSourcePath(params.file);
  const capabilities = await nativeHostClient.getCapabilities();
  const canSliceWithNativeHost =
    Boolean(desktopSourcePath) &&
    capabilities.mediaImportCommandReady &&
    capabilities.videoSliceCommandReady;

  if (canSliceWithNativeHost && desktopSourcePath) {
    await updateTask(newTask.id, {
      status: AUTOCUT_TASK_STATUS.processing,
      progress: 15,
      progressMessage: '正在准备本地视频切片...',
    });

    let durableTaskId = newTask.id;

    try {
      const outputRootDir = await resolveAutoCutOutputRootDir();
      const importedMedia = await nativeHostClient.importMediaFile({
        sourcePath: desktopSourcePath,
        ...(outputRootDir ? { outputRootDir } : {}),
      });
      const speechRuntimeConfig = await resolveAutoCutSpeechTranscriptionRuntimeConfig();
      await updateTask(newTask.id, {
        status: AUTOCUT_TASK_STATUS.processing,
        progress: 45,
        progressMessage: '正在规划高光片段...',
      });
      let transcriptSegments: AutoCutSpeechTranscriptionSegment[] = [];
      if (
        capabilities.speechTranscriptionCommandReady &&
        (capabilities.speechTranscriptionToolchainReady || speechRuntimeConfig.configured)
      ) {
        await updateTask(newTask.id, {
          status: AUTOCUT_TASK_STATUS.processing,
          progress: 35,
          progressMessage: 'Preparing transcript-assisted intelligent slicing...',
        });
        try {
          const transcription = await nativeHostClient.transcribeMedia({
            assetUuid: importedMedia.assetUuid,
            language: speechRuntimeConfig.configured ? speechRuntimeConfig.language : 'auto',
            executablePath: speechRuntimeConfig.executablePath,
            modelPath: speechRuntimeConfig.modelPath,
            ...(outputRootDir ? { outputRootDir } : {}),
          });
          transcriptSegments = transcription.segments;
        } catch (transcriptionError) {
          reportAutoCutDiagnostic(
            'warning',
            'slicer.native-transcription',
            'Local speech transcription failed; slicing will continue without transcript assistance.',
            transcriptionError,
          );
        }
      }
      const clips = await createIntelligentSlicePlan(params, transcriptSegments);
      await updateTask(newTask.id, {
        status: AUTOCUT_TASK_STATUS.processing,
        progress: 70,
        progressMessage: '正在渲染视频片段...',
      });
      const nativeResult = await nativeHostClient.sliceVideo({
        assetUuid: importedMedia.assetUuid,
        clips,
        outputFormat: 'mp4',
        ...(outputRootDir ? { outputRootDir } : {}),
        ...(params.enableSubtitles && transcriptSegments.length > 0
          ? {
              subtitleFormat: 'srt',
              ...(params.subtitleStyleId ? { subtitleStyleId: params.subtitleStyleId } : {}),
              subtitleSegments: transcriptSegments,
            }
          : {}),
      });
      const completedTask: AppTask = {
        ...newTask,
        id: nativeResult.taskUuid,
        sourceFileId: importedMedia.assetUuid,
      };
      durableTaskId = completedTask.id;
      const sliceResults = nativeResult.slices.map((nativeSlice, index) =>
        createNativeSliceResult(
          completedTask,
          nativeSlice,
          index,
          nativeHostClient.createAssetUrl(nativeSlice.artifactPath),
          nativeHostClient.createAssetUrl(nativeSlice.thumbnailArtifactPath),
          nativeSlice.subtitleArtifactPath
            ? nativeHostClient.createAssetUrl(nativeSlice.subtitleArtifactPath)
            : undefined,
        ),
      );
      const completedData = await finishVideoSliceTask(completedTask, sliceResults);

      await updateTask(newTask.id, {
        status: AUTOCUT_TASK_STATUS.completed,
        progress: 100,
        progressMessage: '视频切片完成。',
        completedAt: createAutoCutTimestamp(),
        id: completedTask.id,
        sourceFileId: importedMedia.assetUuid,
        ...completedData,
      });
    } catch (error) {
      return await failAutoCutProcessingTask(newTask.id, String(error));
    }

    return { success: true, taskId: durableTaskId };
  }

  return await failAutoCutUnsupportedNativeProcessingTask(newTask, 'automatic slicing');
}
