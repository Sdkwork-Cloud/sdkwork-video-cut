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
  type AutoCutVideoSliceRenderProfile,
  type AutoCutVideoSliceClipRequest,
  type AutoCutVideoSliceRequest,
  type AutoCutVideoSliceArtifactResult,
} from '@sdkwork/autocut-services';
import {
  buildTranscriptSliceCandidates,
  createDeterministicSlicePlan,
  createTranscriptAssistedSlicePlan,
  getVideoSlicePlanningPolicy,
  normalizeSliceDurationMs,
  parseLlmSlicePlan,
  validateVideoSliceParams,
  type VideoSlicePlanningPolicy,
  type NormalizedSlicePlanClip,
} from './slicePlanner';

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

async function createIntelligentSlicePlan(
  params: VideoSliceParams,
  transcriptSegments: readonly AutoCutSpeechTranscriptionSegment[] = [],
) {
  const trustedSourceDurationMs = resolveTrustedVideoSliceSourceDurationMs(params);
  if (trustedSourceDurationMs !== undefined && trustedSourceDurationMs < 5_000) {
    throw new Error('AutoCut source video is too short to produce a valid video slice.');
  }

  const planningParams = {
    ...params,
    ...(trustedSourceDurationMs !== undefined ? { sourceDurationMs: trustedSourceDurationMs } : {}),
  };
  const planningPolicy = getVideoSlicePlanningPolicy(planningParams);
  const transcriptCandidates = buildTranscriptSliceCandidates(planningParams, transcriptSegments);
  const fallbackPlan =
    transcriptCandidates.length > 0
      ? createTranscriptAssistedSlicePlan(planningParams, transcriptSegments)
      : createDeterministicSlicePlan(planningParams);

  try {
    const transcriptTimeline = transcriptSegments.slice(0, 80).map((segment) => ({
      startMs: segment.startMs,
      endMs: segment.endMs,
      speaker: segment.speaker,
      text: segment.text,
    }));
    const result = await createAutoCutOpenAiCompatibleChatCompletion({
      model: params.llmModel,
      messages: [
        {
          role: 'system',
          content:
            'You are AutoCut video highlight planner. Select continuous short-video windows only. Return only a compact JSON array with candidateId or startMs, durationMs/endMs, title, qualityScore, continuityScore, and risks.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            mode: params.mode,
            baseAlgorithm: params.baseAlgorithm,
            highlightEngine: params.highlightEngine,
            planningPolicy,
            publishingTarget: {
              platform: planningPolicy.targetPlatform,
              aspectRatio: planningPolicy.targetAspectRatio,
              objectFit: planningPolicy.videoObjectFit,
            },
            minDurationMs: normalizeSliceDurationMs(params.minDuration),
            maxDurationMs: normalizeSliceDurationMs(params.maxDuration),
            idealDurationMs: planningPolicy.idealDurationMs,
            requestedClipCount: planningPolicy.targetSliceCount,
            sliceCountMode: planningPolicy.sliceCountMode,
            continuityLevel: planningPolicy.continuityLevel,
            continuityJoinGapMs: planningPolicy.continuityJoinGapMs,
            customKeywords: planningPolicy.customKeywords,
            filters: {
              noiseReduction: params.enableNoiseReduction,
              coughFilter: params.enableCoughFilter,
              repeatFilter: params.enableRepeatFilter,
              subtitles: params.enableSubtitles,
            },
            phaseOneRules: [
              'Each output clip must be one continuous source interval.',
              'Prefer candidateWindows because they have deterministic continuity repair.',
              'If transcript candidateWindows are present, choose candidateId instead of inventing raw midpoint timings.',
              'Do not start clips at weak connector words unless the previous context is included.',
              'Do not end clips at trailing connector words; include the next transcript segment when speech is incomplete.',
              'Return fewer high-quality choices before inventing weak fixed-interval clips.',
              'For fixed or coverage-first mode, fill up to requestedClipCount with continuous non-overlapping intervals.',
              'For quality-first mode, return only strong publishable windows even if fewer than requestedClipCount.',
            ],
            transcriptAssisted: transcriptCandidates.length > 0,
            candidateWindows: transcriptCandidates.map((candidate) => ({
              id: candidate.candidateId,
              startMs: candidate.startMs,
              endMs: candidate.endMs,
              durationMs: candidate.durationMs,
              label: candidate.label,
              score: candidate.score,
              qualityScore: candidate.qualityScore,
              continuityScore: candidate.continuityScore,
              storyShape: candidate.storyShape,
              publishabilityScore: candidate.publishabilityScore,
              publishabilityGrade: candidate.publishabilityGrade,
              publishabilityIssues: candidate.publishabilityIssues,
              boundaryQualityScore: candidate.boundaryQualityScore,
              hookStrength: candidate.hookStrength,
              endingCompleteness: candidate.endingCompleteness,
              contentArcScore: candidate.contentArcScore,
              contentArcGrade: candidate.contentArcGrade,
              contentArcStages: candidate.contentArcStages,
              contentArcMissingStages: candidate.contentArcMissingStages,
              topicCoherenceScore: candidate.topicCoherenceScore,
              topicCoherenceGrade: candidate.topicCoherenceGrade,
              topicShiftCount: candidate.topicShiftCount,
              topicKeywords: candidate.topicKeywords,
              platformReadinessScore: candidate.platformReadinessScore,
              platformReadinessGrade: candidate.platformReadinessGrade,
              platformReadinessIssues: candidate.platformReadinessIssues,
              sentenceBoundaryIntegrityScore: candidate.sentenceBoundaryIntegrityScore,
              sentenceBoundaryIntegrityGrade: candidate.sentenceBoundaryIntegrityGrade,
              sentenceBoundaryIssues: candidate.sentenceBoundaryIssues,
              risks: candidate.risks,
              summary: candidate.summary,
              transcriptCoverageScore: candidate.transcriptCoverageScore,
              subtitleSegmentCount: candidate.subtitleSegmentCount,
              speechContinuityGrade: candidate.speechContinuityGrade,
              speechStartMs: candidate.speechStartMs,
              speechEndMs: candidate.speechEndMs,
              boundaryPaddingBeforeMs: candidate.boundaryPaddingBeforeMs,
              boundaryPaddingAfterMs: candidate.boundaryPaddingAfterMs,
              anchorSegmentIndex: candidate.anchorSegmentIndex,
              text: candidate.text,
            })),
            transcriptTimeline,
          }),
        },
      ],
    });

    return parseLlmSlicePlan(result.content, planningParams, fallbackPlan, transcriptCandidates);
  } catch {
    return fallbackPlan;
  }
}

function resolveTrustedVideoSliceSourceDurationMs(params: VideoSliceParams) {
  if (typeof params.sourceDurationMs === 'number' && Number.isFinite(params.sourceDurationMs) && params.sourceDurationMs > 0) {
    return Math.round(params.sourceDurationMs);
  }

  return undefined;
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
  plannedClip?: NormalizedSlicePlanClip,
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
    ...(plannedClip?.title ? { title: plannedClip.title } : {}),
    ...(plannedClip?.summary ? { summary: plannedClip.summary } : {}),
    ...(plannedClip?.reason ? { reason: plannedClip.reason } : {}),
    ...(plannedClip?.qualityScore !== undefined ? { qualityScore: plannedClip.qualityScore } : {}),
    ...(plannedClip?.continuityScore !== undefined ? { continuityScore: plannedClip.continuityScore } : {}),
    ...(plannedClip?.storyShape ? { storyShape: plannedClip.storyShape } : {}),
    ...(plannedClip?.publishabilityScore !== undefined ? { publishabilityScore: plannedClip.publishabilityScore } : {}),
    ...(plannedClip?.publishabilityGrade ? { publishabilityGrade: plannedClip.publishabilityGrade } : {}),
    ...(plannedClip?.publishabilityIssues ? { publishabilityIssues: plannedClip.publishabilityIssues } : {}),
    ...(plannedClip?.boundaryQualityScore !== undefined ? { boundaryQualityScore: plannedClip.boundaryQualityScore } : {}),
    ...(plannedClip?.hookStrength ? { hookStrength: plannedClip.hookStrength } : {}),
    ...(plannedClip?.endingCompleteness ? { endingCompleteness: plannedClip.endingCompleteness } : {}),
    ...(plannedClip?.contentArcScore !== undefined ? { contentArcScore: plannedClip.contentArcScore } : {}),
    ...(plannedClip?.contentArcGrade ? { contentArcGrade: plannedClip.contentArcGrade } : {}),
    ...(plannedClip?.contentArcStages ? { contentArcStages: plannedClip.contentArcStages } : {}),
    ...(plannedClip?.contentArcMissingStages ? { contentArcMissingStages: plannedClip.contentArcMissingStages } : {}),
    ...(plannedClip?.topicCoherenceScore !== undefined ? { topicCoherenceScore: plannedClip.topicCoherenceScore } : {}),
    ...(plannedClip?.topicCoherenceGrade ? { topicCoherenceGrade: plannedClip.topicCoherenceGrade } : {}),
    ...(plannedClip?.topicShiftCount !== undefined ? { topicShiftCount: plannedClip.topicShiftCount } : {}),
    ...(plannedClip?.topicKeywords ? { topicKeywords: plannedClip.topicKeywords } : {}),
    ...(plannedClip?.platformReadinessScore !== undefined ? { platformReadinessScore: plannedClip.platformReadinessScore } : {}),
    ...(plannedClip?.platformReadinessGrade ? { platformReadinessGrade: plannedClip.platformReadinessGrade } : {}),
    ...(plannedClip?.platformReadinessIssues ? { platformReadinessIssues: plannedClip.platformReadinessIssues } : {}),
    ...(plannedClip?.sentenceBoundaryIntegrityScore !== undefined
      ? { sentenceBoundaryIntegrityScore: plannedClip.sentenceBoundaryIntegrityScore }
      : {}),
    ...(plannedClip?.sentenceBoundaryIntegrityGrade
      ? { sentenceBoundaryIntegrityGrade: plannedClip.sentenceBoundaryIntegrityGrade }
      : {}),
    ...(plannedClip?.sentenceBoundaryIssues ? { sentenceBoundaryIssues: plannedClip.sentenceBoundaryIssues } : {}),
    ...(plannedClip?.risks ? { risks: plannedClip.risks } : {}),
    sourceStartMs: plannedClip?.sourceStartMs ?? nativeSlice.startMs,
    sourceEndMs: plannedClip?.sourceEndMs ?? nativeSlice.startMs + nativeSlice.durationMs,
    speechStartMs: plannedClip?.speechStartMs ?? plannedClip?.sourceStartMs ?? nativeSlice.startMs,
    speechEndMs:
      plannedClip?.speechEndMs ??
      plannedClip?.sourceEndMs ??
      nativeSlice.startMs + nativeSlice.durationMs,
    boundaryPaddingBeforeMs: plannedClip?.boundaryPaddingBeforeMs ?? 0,
    boundaryPaddingAfterMs: plannedClip?.boundaryPaddingAfterMs ?? 0,
    ...(plannedClip?.transcriptText ? { transcriptText: plannedClip.transcriptText } : {}),
    ...(plannedClip?.transcriptCoverageScore !== undefined
      ? { transcriptCoverageScore: plannedClip.transcriptCoverageScore }
      : {}),
    ...(plannedClip?.subtitleSegmentCount !== undefined ? { subtitleSegmentCount: plannedClip.subtitleSegmentCount } : {}),
    ...(plannedClip?.speechContinuityGrade ? { speechContinuityGrade: plannedClip.speechContinuityGrade } : {}),
  };
}

function toNativeSliceClipRequest(clip: NormalizedSlicePlanClip): AutoCutVideoSliceClipRequest {
  return {
    startMs: clip.startMs,
    durationMs: clip.durationMs,
    label: clip.label,
  };
}

function createVideoSliceRenderProfile(
  planningPolicy: VideoSlicePlanningPolicy,
): AutoCutVideoSliceRenderProfile | undefined {
  if (planningPolicy.targetAspectRatio === 'auto') {
    return undefined;
  }

  return {
    targetAspectRatio: planningPolicy.targetAspectRatio,
    objectFit: planningPolicy.videoObjectFit,
  };
}

type VideoSliceSubtitleRequestProjection = Partial<Pick<
  AutoCutVideoSliceRequest,
  'subtitleFormat' | 'subtitleMode' | 'subtitleStyleId' | 'subtitleSegments'
>>;

function createVideoSliceSubtitleRequest(
  params: VideoSliceParams,
  transcriptSegments: AutoCutSpeechTranscriptionSegment[],
): VideoSliceSubtitleRequestProjection {
  if (!params.enableSubtitles || transcriptSegments.length === 0) {
    return { subtitleMode: 'none' };
  }

  return {
    subtitleFormat: 'srt',
    subtitleMode: params.subtitleMode ?? 'both',
    ...(params.subtitleStyleId ? { subtitleStyleId: params.subtitleStyleId } : {}),
    subtitleSegments: transcriptSegments,
  };
}

export async function processVideoSlice(params: VideoSliceParams) {
  validateAutoCutProcessingSource({ ...params, allowExternalUrl: true });
  validateVideoSliceParams(params);

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
      const planningPolicy = getVideoSlicePlanningPolicy(params);
      const renderProfile = createVideoSliceRenderProfile(planningPolicy);
      const planningParams = {
        ...params,
        ...(importedMedia.durationMs !== undefined ? { sourceDurationMs: importedMedia.durationMs } : {}),
      };
      const plannedClips = await createIntelligentSlicePlan(planningParams, transcriptSegments);
      if (plannedClips.length === 0) {
        throw new Error('AutoCut source video is too short to produce a valid video slice.');
      }
      const nativeClips = plannedClips.map(toNativeSliceClipRequest);
      await updateTask(newTask.id, {
        status: AUTOCUT_TASK_STATUS.processing,
        progress: 70,
        progressMessage: '正在渲染视频片段...',
      });
      const nativeResult = await nativeHostClient.sliceVideo({
        assetUuid: importedMedia.assetUuid,
        clips: nativeClips,
        outputFormat: 'mp4',
        ...(outputRootDir ? { outputRootDir } : {}),
        ...(renderProfile ? { renderProfile } : {}),
        ...createVideoSliceSubtitleRequest(params, transcriptSegments),
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
          plannedClips[index],
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
