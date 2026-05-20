import { useCallback, useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, PlayCircle, Download, FolderOpen, FileText, Music, Copy, ArrowRight, Activity, Zap, X, CircleStop, Terminal, AlertTriangle, RefreshCw, Scissors } from 'lucide-react';
import { cancelTasks, createAutoCutTaskTypeI18nKey, createAutoCutTextObjectUrl, downloadAutoCutUrl, downloadExtractedTextFile, formatAutoCutDateTime, formatExtractedText, getTasks, listenAutoCutEvent, openAutoCutNativeArtifactInFolder, openAutoCutPreviewUrl, reportAutoCutDiagnostic, resumeTaskFromStep, revokeAutoCutObjectUrl, writeAutoCutClipboardText } from '@sdkwork/autocut-services';
import { Button, TaskFailureState, normalizeAutoCutTaskDetailDisplayText } from '@sdkwork/autocut-commons';
import { AUTOCUT_TASK_STATUS, AUTOCUT_TASK_TYPE, isAutoCutTaskActiveStatus, type AppTask, type TaskType } from '@sdkwork/autocut-types';
import {
  createTaskDetailEngineFlowSummary,
  inferSmartSliceTaskDetailEngine,
  type TaskDetailEngineFlowStepStatus,
  type TaskDetailEngineFlowSummary,
} from './taskDetailEngineSteps';

type SliceResult = NonNullable<AppTask['sliceResults']>[number];
type TaskExecutionStep = NonNullable<AppTask['executionSteps']>[number];
type TaskExecutionLog = NonNullable<AppTask['executionLogs']>[number];
type TaskDetailOutputTab = 'clips' | 'review' | 'transcript' | 'files';

function formatBytes(bytes: number, decimals = 2) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) {
    return undefined;
  }
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

const REPROCESS_ROUTES: Record<TaskType, string> = {
  [AUTOCUT_TASK_TYPE.videoSlice]: '/slicer',
  [AUTOCUT_TASK_TYPE.textExtraction]: '/extractor-text',
  [AUTOCUT_TASK_TYPE.audioExtraction]: '/extractor-audio',
  [AUTOCUT_TASK_TYPE.videoGif]: '/video-gif',
  [AUTOCUT_TASK_TYPE.videoCompress]: '/video-compress',
  [AUTOCUT_TASK_TYPE.videoConvert]: '/video-convert',
  [AUTOCUT_TASK_TYPE.videoEnhance]: '/video-enhance',
  [AUTOCUT_TASK_TYPE.videoDedup]: '/video-dedup',
  [AUTOCUT_TASK_TYPE.subtitleTranslate]: '/subtitle-translate',
  [AUTOCUT_TASK_TYPE.voiceTranslate]: '/voice-translate',
};

function getReprocessRoute(type: TaskType) {
  return REPROCESS_ROUTES[type];
}

function isTaskResumeStatus(task: AppTask | null) {
  return task?.status === AUTOCUT_TASK_STATUS.failed ||
    task?.status === AUTOCUT_TASK_STATUS.canceled ||
    task?.status === AUTOCUT_TASK_STATUS.interrupted;
}

function getTaskStatusBadgeClass(status: AppTask['status']) {
  if (status === AUTOCUT_TASK_STATUS.completed) {
    return 'bg-green-500/10 text-green-500';
  }
  if (status === AUTOCUT_TASK_STATUS.processing || status === AUTOCUT_TASK_STATUS.pending) {
    return 'bg-blue-500/10 text-blue-500';
  }
  if (status === AUTOCUT_TASK_STATUS.reviewing) {
    return 'bg-cyan-500/10 text-cyan-300';
  }
  if (status === AUTOCUT_TASK_STATUS.canceled) {
    return 'bg-amber-500/10 text-amber-500';
  }
  if (status === AUTOCUT_TASK_STATUS.interrupted) {
    return 'bg-purple-500/10 text-purple-400';
  }
  return 'bg-red-500/10 text-red-500';
}

function getTaskStatusLabelKey(status: AppTask['status']) {
  switch (status) {
    case AUTOCUT_TASK_STATUS.pending:
      return 'taskDetail.status.pending';
    case AUTOCUT_TASK_STATUS.processing:
      return 'taskDetail.status.processing';
    case AUTOCUT_TASK_STATUS.reviewing:
      return 'taskDetail.status.reviewing';
    case AUTOCUT_TASK_STATUS.completed:
      return 'taskDetail.status.completed';
    case AUTOCUT_TASK_STATUS.canceled:
      return 'taskDetail.status.canceled';
    case AUTOCUT_TASK_STATUS.interrupted:
      return 'taskDetail.status.interrupted';
    case AUTOCUT_TASK_STATUS.failed:
    default:
      return 'taskDetail.status.failed';
  }
}

function handleDownload(url: string | undefined, filename: string) {
  downloadAutoCutUrl(url, filename);
}

function createTaskReprocessState(task: AppTask) {
  if (task.type === AUTOCUT_TASK_TYPE.videoSlice && task.sourceFileId) {
    return { initialFileId: task.sourceFileId };
  }

  return undefined;
}

function formatSliceTranscriptTimestamp(milliseconds: number | undefined) {
  const safeMilliseconds = typeof milliseconds === 'number' && Number.isFinite(milliseconds)
    ? Math.max(0, Math.round(milliseconds))
    : 0;
  const hours = Math.floor(safeMilliseconds / 3_600_000);
  const minutes = Math.floor((safeMilliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((safeMilliseconds % 60_000) / 1_000);
  const millis = safeMilliseconds % 1_000;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function formatTaskExecutionDuration(durationMs: number | undefined) {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs)) {
    return undefined;
  }
  if (durationMs < 1_000) {
    return `${Math.max(0, Math.round(durationMs))}ms`;
  }
  if (durationMs < 60_000) {
    return `${Math.round(durationMs / 100) / 10}s`;
  }
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1_000);
  return `${minutes}m ${seconds}s`;
}

function getTaskExecutionStepStatusClass(status: TaskExecutionStep['status']) {
  switch (status) {
    case 'completed':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
    case 'running':
      return 'border-blue-500/30 bg-blue-500/10 text-blue-200';
    case 'failed':
      return 'border-rose-500/30 bg-rose-500/10 text-rose-200';
    case 'cancelRequested':
    case 'canceled':
    case 'interrupted':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
    default:
      return 'border-[#333] bg-[#111] text-gray-300';
  }
}

function getTaskExecutionLogSeverityClass(severity: TaskExecutionLog['severity']) {
  switch (severity) {
    case 'error':
      return 'text-rose-300';
    case 'warning':
      return 'text-amber-300';
    case 'debug':
      return 'text-gray-500';
    default:
      return 'text-cyan-300';
  }
}

function hasTaskExecutionDiagnostics(task: AppTask) {
  return (
    (task.executionSteps?.length ?? 0) > 0 ||
    (task.executionLogs?.length ?? 0) > 0 ||
    isAutoCutTaskActiveStatus(task.status) ||
    Boolean(task.nativeTaskId)
  );
}

function getTaskExecutionStepStatusLabelKey(status: TaskExecutionStep['status']) {
  return `taskDetail.executionDiagnostics.stepStatus.${status}` as const;
}

function getTaskExecutionStepProgress(step: TaskExecutionStep) {
  switch (step.status) {
    case 'completed':
      return 100;
    case 'pending':
    case 'skipped':
      return 0;
    case 'failed':
    case 'canceled':
    case 'interrupted':
    case 'cancelRequested':
    case 'running':
    default:
      return Math.min(100, Math.max(0, Math.round(step.progress || 0)));
  }
}

function getTaskExecutionLogSeverityLabelKey(severity: TaskExecutionLog['severity']) {
  return `taskDetail.executionDiagnostics.logSeverity.${severity}` as const;
}

function readTaskExecutionLogDetailNumber(log: TaskExecutionLog, key: string) {
  const value = log.details?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readTaskExecutionLogDetailString(log: TaskExecutionLog, key: string) {
  const value = log.details?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function formatTaskExecutionLogProviderProgress(log: TaskExecutionLog) {
  const providerProgress = readTaskExecutionLogDetailNumber(log, 'providerProgress') ??
    readTaskExecutionLogDetailNumber(log, 'nativeProgress');
  if (providerProgress === undefined) {
    return undefined;
  }

  const provider = readTaskExecutionLogDetailString(log, 'providerId') ??
    readTaskExecutionLogDetailString(log, 'nativeSource') ??
    log.source ??
    'provider';
  return `${provider} ${Math.min(100, Math.max(0, Math.round(providerProgress)))}%`;
}

function normalizeTaskDetailDisplayText(value: string | undefined | null) {
  return normalizeAutoCutTaskDetailDisplayText(value);
}

const TASK_EXECUTION_DISPLAY_TEXT_I18N_KEYS: Record<string, string> = {
  'Voice translation transcript task queued...': 'taskDetail.executionDiagnostics.message.voiceTranslateQueued',
  'Preparing voice translation transcript...': 'taskDetail.executionDiagnostics.message.voiceTranslatePreparing',
  'Running speech-to-text for voice translation...': 'taskDetail.executionDiagnostics.message.voiceTranslateSpeechToText',
  'Translating voice transcript segments...': 'taskDetail.executionDiagnostics.message.voiceTranslateTranslating',
  'Voice translation transcript and SRT generated.': 'taskDetail.executionDiagnostics.message.voiceTranslateCompleted',
  'Preparing video compression task...': 'taskDetail.executionDiagnostics.message.videoCompressionPreparing',
  'Running video compression and writing the standard artifact...': 'taskDetail.executionDiagnostics.message.videoCompressionRunning',
  'Video compression completed.': 'taskDetail.executionDiagnostics.message.videoCompressionCompleted',
  'Preparing video enhancement task...': 'taskDetail.executionDiagnostics.message.videoEnhancePreparing',
  'Running enhancement and standard video encoding...': 'taskDetail.executionDiagnostics.message.videoEnhanceRunning',
  'Video enhancement completed.': 'taskDetail.executionDiagnostics.message.videoEnhanceCompleted',
  'Preparing video GIF task...': 'taskDetail.executionDiagnostics.message.videoGifPreparing',
  'Generating GIF from the source video...': 'taskDetail.executionDiagnostics.message.videoGifGenerating',
  'Video GIF completed.': 'taskDetail.executionDiagnostics.message.videoGifCompleted',
  'Preparing video conversion task...': 'taskDetail.executionDiagnostics.message.videoConvertPreparing',
  'Running video container and codec conversion...': 'taskDetail.executionDiagnostics.message.videoConvertRunning',
  'Video conversion completed.': 'taskDetail.executionDiagnostics.message.videoConvertCompleted',
  'Importing local video into the desktop media sandbox...': 'taskDetail.executionDiagnostics.message.importLocalVideo',
  'Importing local media into the desktop media sandbox...': 'taskDetail.executionDiagnostics.message.importLocalMedia',
  'Subtitle extraction task queued...': 'taskDetail.executionDiagnostics.message.subtitleExtractionQueued',
  'Preparing subtitle extraction...': 'taskDetail.executionDiagnostics.message.subtitleExtractionPreparing',
  'Running speech-to-text for subtitles...': 'taskDetail.executionDiagnostics.message.subtitleSpeechToText',
  'Translating subtitle segments...': 'taskDetail.executionDiagnostics.message.subtitleTranslating',
  'Rendering translated subtitles into the source video...': 'taskDetail.executionDiagnostics.message.subtitleRendering',
  'Translated subtitle video and SRT generated.': 'taskDetail.executionDiagnostics.message.subtitleVideoCompleted',
  'Subtitle SRT generated.': 'taskDetail.executionDiagnostics.message.subtitleSrtCompleted',
  'Transcription task queued...': 'taskDetail.executionDiagnostics.message.transcriptionQueued',
  'Preparing local speech transcription...': 'taskDetail.executionDiagnostics.message.transcriptionPreparing',
  'Running local speech-to-text...': 'taskDetail.executionDiagnostics.message.transcriptionRunning',
  'Transcription completed.': 'taskDetail.executionDiagnostics.message.transcriptionCompleted',
  'Preparing native Smart Slice source...': 'taskDetail.executionDiagnostics.message.smartSlicePrepareSource',
  'Running local speech-to-text for Smart Slice...': 'taskDetail.executionDiagnostics.message.smartSliceSpeechToText',
  'Planning transcript-assisted highlight clips...': 'taskDetail.executionDiagnostics.message.smartSlicePlanClips',
  'Analyzing speech boundaries...': 'taskDetail.executionDiagnostics.message.smartSliceAnalyzeAudioBoundaries',
  'Checking Smart Slice duplicate risk...': 'taskDetail.executionDiagnostics.message.smartSliceAnalyzeDuplicates',
  'Waiting for segment review approval...': 'taskDetail.executionDiagnostics.message.smartSliceHumanReview',
  'Rendering video slices with native FFmpeg...': 'taskDetail.executionDiagnostics.message.smartSliceNativeRender',
  'Verifying generated slice artifacts...': 'taskDetail.executionDiagnostics.message.smartSliceVerifyArtifacts',
  'Saving generated slice results...': 'taskDetail.executionDiagnostics.message.smartSlicePersistResults',
  'Video slicing completed.': 'taskDetail.executionDiagnostics.message.videoSlicingCompleted',
  'Speech recognition model is ready. Verifying local speech-to-text before transcription.': 'taskDetail.executionDiagnostics.message.speechModelReady',
  'Speech recognition model setup failed. Check the local speech-to-text settings and retry.': 'taskDetail.executionDiagnostics.message.speechModelSetupFailed',
  'Speech recognition model needs a manual download. Copy the model link or select the completed local model file.': 'taskDetail.executionDiagnostics.message.speechModelManualDownload',
  'Preparing speech recognition model download. Smart Slice will continue after local speech-to-text is ready.': 'taskDetail.executionDiagnostics.message.speechModelPreparing',
  'Segment Review Workbench draft saved. Continue reviewing or render selected segments.': 'taskDetail.executionDiagnostics.message.reviewDraftSaved',
  'Rendering selected reviewed Smart Slice segments...': 'taskDetail.executionDiagnostics.message.renderingReviewedSegments',
  'Segment Review Workbench is ready. Review, select, split, merge, or remove duplicate content before rendering.': 'taskDetail.executionDiagnostics.message.reviewWorkbenchReady',
  'Task resume failed.': 'taskDetail.executionDiagnostics.message.taskResumeFailed',
  'Task failed': 'taskDetail.executionDiagnostics.message.taskFailed',
  'Task failed.': 'taskDetail.executionDiagnostics.message.taskFailed',
  'Task canceled.': 'taskDetail.executionDiagnostics.message.taskCanceled',
  'Cancel requested': 'taskDetail.executionDiagnostics.message.cancelRequested',
  'Retry queued': 'taskDetail.executionDiagnostics.message.retryQueued',
  'No local workflow task is registered for cancellation.': 'taskDetail.executionDiagnostics.message.noLocalWorkflowTaskForCancellation',
  'No workflow cancel handler is registered.': 'taskDetail.executionDiagnostics.message.noWorkflowCancelHandler',
  '\u4efb\u52a1\u6392\u961f\u4e2d...': 'taskDetail.executionDiagnostics.message.taskQueued',
  '\u4efb\u52a1\u6392\u961f\u51c6\u5907\u4e2d...': 'taskDetail.executionDiagnostics.message.taskQueuedPreparing',
  '\u5206\u6790\u672c\u5730\u5a92\u4f53\u5e76\u5199\u5165\u684c\u9762\u6c99\u7bb1...': 'taskDetail.executionDiagnostics.message.analyzeLocalMedia',
  '\u4ece\u5df2\u5bfc\u5165\u8d44\u4ea7\u63d0\u53d6\u97f3\u9891\u8f68\u9053...': 'taskDetail.executionDiagnostics.message.extractAudioTrack',
  '\u4efb\u52a1\u5b8c\u6210': 'taskDetail.executionDiagnostics.message.taskCompleted',
  'Prepare native source media': 'taskDetail.executionDiagnostics.stepLabel.prepareNativeSource',
  'Transcribe source speech': 'taskDetail.executionDiagnostics.stepLabel.transcribeSourceSpeech',
  'Plan publishable clips': 'taskDetail.executionDiagnostics.stepLabel.planPublishableClips',
  'Analyze speech boundaries': 'taskDetail.executionDiagnostics.stepLabel.analyzeSpeechBoundaries',
  'Analyze duplicate content': 'taskDetail.executionDiagnostics.stepLabel.analyzeDuplicateContent',
  'Human review approval': 'taskDetail.executionDiagnostics.stepLabel.humanReviewApproval',
  'Render clips with native FFmpeg': 'taskDetail.executionDiagnostics.stepLabel.renderClipsWithNativeFfmpeg',
  'Verify generated artifacts': 'taskDetail.executionDiagnostics.stepLabel.verifyGeneratedArtifacts',
  'Persist task results': 'taskDetail.executionDiagnostics.stepLabel.persistTaskResults',
  'Prepare source media': 'taskDetail.executionDiagnostics.stepLabel.prepareSourceMedia',
  'Extract speech audio': 'taskDetail.executionDiagnostics.stepLabel.extractSpeechAudio',
  'Run speech-to-text': 'taskDetail.executionDiagnostics.stepLabel.runSpeechToText',
  'Plan clips': 'taskDetail.executionDiagnostics.stepLabel.planClips',
  'Analyze audio boundaries': 'taskDetail.executionDiagnostics.stepLabel.analyzeAudioBoundaries',
  'Render clips': 'taskDetail.executionDiagnostics.stepLabel.renderClips',
  'Verify artifacts': 'taskDetail.executionDiagnostics.stepLabel.verifyArtifacts',
  'Persist results': 'taskDetail.executionDiagnostics.stepLabel.persistResults',
  'prepare-source': 'taskDetail.executionDiagnostics.stepLabel.prepareSourceMedia',
  'extract-audio': 'taskDetail.executionDiagnostics.stepLabel.extractSpeechAudio',
  'speech-to-text': 'taskDetail.executionDiagnostics.stepLabel.runSpeechToText',
  'plan-clips': 'taskDetail.executionDiagnostics.stepLabel.planClips',
  'analyze-audio-boundaries': 'taskDetail.executionDiagnostics.stepLabel.analyzeAudioBoundaries',
  'analyze-duplicates': 'taskDetail.executionDiagnostics.stepLabel.analyzeDuplicateContent',
  'human-review': 'taskDetail.executionDiagnostics.stepLabel.humanReviewApproval',
  'native-render': 'taskDetail.executionDiagnostics.stepLabel.renderClips',
  'verify-artifacts': 'taskDetail.executionDiagnostics.stepLabel.verifyArtifacts',
  'persist-results': 'taskDetail.executionDiagnostics.stepLabel.persistResults',
  started: 'taskDetail.executionDiagnostics.event.started',
  completed: 'taskDetail.executionDiagnostics.event.completed',
  failed: 'taskDetail.executionDiagnostics.event.failed',
  'cancel-requested': 'taskDetail.executionDiagnostics.event.cancelRequested',
  canceled: 'taskDetail.executionDiagnostics.event.canceled',
  interrupted: 'taskDetail.executionDiagnostics.event.interrupted',
  'retry-requested': 'taskDetail.executionDiagnostics.event.retryRequested',
  progress: 'taskDetail.executionDiagnostics.event.progress',
  event: 'taskDetail.executionDiagnostics.event.event',
  'smart-slice-service': 'taskDetail.executionDiagnostics.source.smartSliceService',
  'task-cancel-service': 'taskDetail.executionDiagnostics.source.taskCancelService',
  'task-resume-service': 'taskDetail.executionDiagnostics.source.taskResumeService',
};

function translateTaskExecutionDisplayText(
  value: string | undefined | null,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  const normalizedText = normalizeTaskDetailDisplayText(value);
  if (!normalizedText) {
    return normalizedText;
  }

  const directKey = TASK_EXECUTION_DISPLAY_TEXT_I18N_KEYS[normalizedText];
  if (directKey) {
    return t(directKey);
  }

  const elapsedMatch = normalizedText.match(/^(.+) Elapsed (\d+)s\.$/);
  if (elapsedMatch) {
    return t('taskDetail.executionDiagnostics.message.elapsed', {
      message: translateTaskExecutionDisplayText(elapsedMatch[1], t),
      seconds: elapsedMatch[2],
    });
  }

  const modelDownloadingMatch = normalizedText.match(
    /^Downloading speech recognition model(?: (\d+)%)\. Smart Slice will continue after local speech-to-text is ready\.$/,
  );
  if (modelDownloadingMatch) {
    return t('taskDetail.executionDiagnostics.message.speechModelDownloading', {
      progress: modelDownloadingMatch[1] ?? '',
    });
  }

  const modelFailureMatch = normalizedText.match(/^Speech recognition model setup failed: (.+)$/);
  if (modelFailureMatch) {
    return t('taskDetail.executionDiagnostics.message.speechModelSetupFailedWithReason', {
      reason: normalizeTaskDetailDisplayText(modelFailureMatch[1]),
    });
  }

  const resumeWorkflowMatch = normalizedText.match(/^Resuming (.+) from (.+)\.\.\.$/);
  if (resumeWorkflowMatch) {
    return t('taskDetail.executionDiagnostics.message.resumeWorkflow', {
      workflow: normalizeTaskDetailDisplayText(resumeWorkflowMatch[1]),
      step: translateTaskExecutionDisplayText(resumeWorkflowMatch[2], t),
    });
  }

  const resumeStartedMatch = normalizedText.match(/^Resuming (.+) from step (.+)\.$/);
  if (resumeStartedMatch) {
    return t('taskDetail.executionDiagnostics.message.resumeWorkflowStep', {
      workflow: normalizeTaskDetailDisplayText(resumeStartedMatch[1]),
      step: translateTaskExecutionDisplayText(resumeStartedMatch[2], t),
    });
  }

  const resumeCheckpointMatch = normalizedText.match(/^Resuming from checkpoint (.+)\.$/);
  if (resumeCheckpointMatch) {
    return t('taskDetail.executionDiagnostics.message.resumeCheckpoint', {
      checkpoint: translateTaskExecutionDisplayText(resumeCheckpointMatch[1], t),
    });
  }

  const smartSliceFailureMatch = normalizedText.match(/^Smart Slice (.+) failed\.$/);
  if (smartSliceFailureMatch) {
    return t('taskDetail.executionDiagnostics.message.smartSliceStepFailed', {
      step: translateTaskExecutionDisplayText(smartSliceFailureMatch[1], t),
    });
  }

  return normalizedText;
}

function createTaskExecutionLogClipboardText(
  log: TaskExecutionLog,
  t: ReturnType<typeof useTranslation>['t'],
) {
  const detailsJson = log.details ? normalizeTaskDetailDisplayText(JSON.stringify(log.details, null, 2)) : '';
  return [
    `${t('taskDetail.executionDiagnostics.logLabelSeverity')}: ${t(getTaskExecutionLogSeverityLabelKey(log.severity || 'info'))}`,
    log.stepId ? `${t('taskDetail.executionDiagnostics.logLabelStep')}: ${translateTaskExecutionDisplayText(log.stepId, t)}` : '',
    log.phase ? `${t('taskDetail.executionDiagnostics.logLabelPhase')}: ${translateTaskExecutionDisplayText(log.phase, t)}` : '',
    log.source ? `${t('taskDetail.executionDiagnostics.logLabelSource')}: ${translateTaskExecutionDisplayText(log.source, t)}` : '',
    log.progress !== undefined ? `${t('taskDetail.executionDiagnostics.logLabelProgress')}: ${Math.round(log.progress)}%` : '',
    `${t('taskDetail.executionDiagnostics.logLabelTimestamp')}: ${formatAutoCutDateTime(log.timestamp)}`,
    `${t('taskDetail.executionDiagnostics.logLabelMessage')}: ${translateTaskExecutionDisplayText(log.message, t)}`,
    detailsJson ? '' : '',
    detailsJson ? `${t('taskDetail.executionDiagnostics.logLabelDetails')}:` : '',
    detailsJson,
  ].filter(Boolean).join('\n');
}

function downloadTaskExecutionResultFile(
  task: AppTask,
  taskTypeLabel: string,
  taskStatusLabel: string,
  t: ReturnType<typeof useTranslation>['t'],
) {
  const normalizedTaskName = normalizeTaskDetailDisplayText(task.name) || task.name;
  const normalizedTaskTypeLabel = normalizeTaskDetailDisplayText(taskTypeLabel) || taskTypeLabel;
  const normalizedProgressMessage = normalizeTaskDetailDisplayText(task.progressMessage);
  const normalizedErrorMessage = normalizeTaskDetailDisplayText(task.errorMessage);
  const content = [
    `${t('taskDetail.resultFile.labelTask')}: ${normalizedTaskName}`,
    `${t('taskDetail.resultFile.labelType')}: ${normalizedTaskTypeLabel}`,
    `${t('taskDetail.resultFile.labelStatus')}: ${taskStatusLabel}`,
    `${t('taskDetail.resultFile.labelProgress')}: ${Math.round(task.progress || 0)}%`,
    normalizedProgressMessage ? `${t('taskDetail.resultFile.labelProgressMessage')}: ${normalizedProgressMessage}` : '',
    task.completedAt ? `${t('taskDetail.resultFile.labelCompletedAt')}: ${formatAutoCutDateTime(task.completedAt)}` : '',
    task.resultCount !== undefined ? `${t('taskDetail.resultFile.labelResultCount')}: ${task.resultCount}` : '',
    normalizedErrorMessage ? `${t('taskDetail.resultFile.labelError')}: ${normalizedErrorMessage}` : '',
  ].filter(Boolean).join('\n');
  const { url } = createAutoCutTextObjectUrl(content);
  try {
    downloadAutoCutUrl(url, `${normalizedTaskName}_result.txt`);
  } finally {
    revokeAutoCutObjectUrl(url);
  }
}

function TaskVideoPreview({ src, title, videoKey }: { src: string; title: string; videoKey?: string }) {
  return (
    <div className="task-detail-video-preview-shell relative flex w-full flex-1 min-h-[260px] max-h-[62vh] items-center justify-center overflow-hidden bg-black">
      <video
        key={videoKey}
        src={src}
        aria-label={title}
        className="task-detail-video-preview-media h-full w-full object-contain"
        controls
        autoPlay
        playsInline
      />
    </div>
  );
}

function formatTaskDetailResultDuration(slice: SliceResult) {
  if (
    typeof slice.sourceStartMs === 'number' &&
    Number.isFinite(slice.sourceStartMs) &&
    typeof slice.sourceEndMs === 'number' &&
    Number.isFinite(slice.sourceEndMs) &&
    slice.sourceEndMs > slice.sourceStartMs
  ) {
    return formatTaskExecutionDuration(slice.sourceEndMs - slice.sourceStartMs);
  }
  if (Number.isFinite(slice.duration)) {
    return formatTaskExecutionDuration(slice.duration * 1000);
  }
  return undefined;
}

function formatTaskDetailResultSize(size: SliceResult['size']) {
  return formatBytes(size);
}

function TaskDetailCommercialResultPanel({
  sliceResults,
  selectedSlice,
  onSelectSlice,
  onOpenSliceLocation,
  onDownloadSlice,
}: {
  sliceResults: readonly SliceResult[];
  selectedSlice: SliceResult | null;
  onSelectSlice: (sliceId: string) => void;
  onOpenSliceLocation: (slice: SliceResult) => void;
  onDownloadSlice: (slice: SliceResult) => void;
}) {
  const { t } = useTranslation();

  return (
    <div
      data-task-detail-result-panel="commercial"
      className="grid h-full min-h-0 gap-3 xl:grid-cols-[340px_minmax(0,1fr)]"
    >
      <section className="flex min-h-0 flex-col overflow-hidden rounded-md border border-white/10 bg-white/[0.025]">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-3.5 py-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-100">{t('taskDetail.result.title')}</h3>
            <p className="mt-1 text-xs text-gray-500">
              {t('taskDetail.result.count', { count: sliceResults.length })}
            </p>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2 custom-scrollbar">
          {sliceResults.length ? (
            <div className="grid gap-1.5">
              {sliceResults.map((slice, index) => {
                const isSelected = selectedSlice?.id === slice.id;
                return (
                  <button
                    key={slice.id}
                    type="button"
                    className={`flex min-w-0 items-center gap-3 rounded-md border px-2.5 py-2 text-left transition-colors ${
                      isSelected
                        ? 'border-cyan-400/35 bg-cyan-400/[0.08]'
                        : 'border-transparent bg-transparent hover:border-white/10 hover:bg-white/[0.035]'
                    }`}
                    onClick={() => onSelectSlice(slice.id)}
                  >
                    <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded bg-black">
                      {slice.thumbnailUrl ? (
                        <img
                          src={slice.thumbnailUrl}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="task-detail-slice-thumbnail-media h-full w-full object-contain"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-gray-600">
                          <PlayCircle size={20} />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="rounded bg-[#222] px-1.5 py-0.5 font-mono text-[10px] text-gray-400">
                          #{index + 1}
                        </span>
                        <h4 className="min-w-0 truncate text-sm font-medium text-gray-100">
                          {normalizeTaskDetailDisplayText(slice.title || slice.name)}
                        </h4>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                        <span>{formatTaskDetailResultDuration(slice) ?? t('taskDetail.result.unavailable')}</span>
                        <span>{formatTaskDetailResultSize(slice.size) ?? t('taskDetail.result.unavailable')}</span>
                        {slice.resolution && <span>{slice.resolution}</span>}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex h-40 items-center justify-center rounded-md border border-white/10 text-sm text-gray-500">
              {t('taskDetail.result.empty')}
            </div>
          )}
        </div>
      </section>

      <section className="flex min-h-0 flex-col overflow-hidden rounded-md border border-white/10 bg-white/[0.025]">
        {selectedSlice ? (
          <>
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/10 px-3.5 py-3">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold text-gray-100">
                  {normalizeTaskDetailDisplayText(selectedSlice.title || selectedSlice.name)}
                </h3>
                <p className="mt-1 text-xs text-gray-500">{t('taskDetail.result.previewing')}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {selectedSlice.artifactPath && (
                  <Button
                    variant="outline"
                    className="h-8 border-white/10 bg-transparent px-2.5 text-xs text-gray-200 hover:bg-white/[0.04]"
                    onClick={() => onOpenSliceLocation(selectedSlice)}
                  >
                    <FolderOpen size={13} className="mr-1.5" /> {t('taskDetail.result.openLocation')}
                  </Button>
                )}
                <Button
                  className="h-8 bg-emerald-600 px-2.5 text-xs hover:bg-emerald-500"
                  onClick={() => onDownloadSlice(selectedSlice)}
                >
                  <Download size={13} className="mr-1.5" /> {t('taskDetail.result.download')}
                </Button>
              </div>
            </div>
            <TaskVideoPreview
              src={selectedSlice.url}
              title={selectedSlice.title || selectedSlice.name}
              videoKey={selectedSlice.id}
            />
          </>
        ) : (
          <div className="flex min-h-[320px] flex-1 flex-col items-center justify-center gap-3 text-gray-500">
            <PlayCircle size={32} className="opacity-50" />
            <p className="text-sm">{t('taskDetail.result.selectToPreview')}</p>
          </div>
        )}
      </section>
    </div>
  );
}

export function TaskDetailPage() {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [task, setTask] = useState<AppTask | null>(null);
  const [activePreviewUrl, setActivePreviewUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showAllExecutionLogs, setShowAllExecutionLogs] = useState(false);
  const [showExecutionDetails, setShowExecutionDetails] = useState(false);
  const [selectedExecutionStepId, setSelectedExecutionStepId] = useState<string | null | undefined>(undefined);
  const [activeFlowOutputTab, setActiveFlowOutputTab] = useState<TaskDetailOutputTab>('clips');
  const [isCancelingTask, setIsCancelingTask] = useState(false);
  const [resumingStepId, setResumingStepId] = useState<string | null>(null);
  const lastExecutionTaskIdRef = useRef<string | null>(null);

  const handleSlicePreviewSelect = (sliceId: string) => {
    setActivePreviewUrl(sliceId);
  };

  const handleOpenSliceArtifactInFolder = async (slice: SliceResult) => {
    if (!slice.artifactPath) {
      return;
    }

    try {
      await openAutoCutNativeArtifactInFolder(slice.artifactPath, slice.taskOutputDir);
    } catch (error) {
      reportAutoCutDiagnostic(
        'warning',
        'task-detail.open-slice-folder',
        'Open generated slice containing folder failed.',
        error,
      );
    }
  };

  const getTaskTypeLabel = (taskType: TaskType) =>
    t(createAutoCutTaskTypeI18nKey(taskType), { defaultValue: taskType });

  const handleReprocessTask = (taskToReprocess: AppTask) => {
    const route = getReprocessRoute(taskToReprocess.type);
    if (route) {
      navigate(route, { state: createTaskReprocessState(taskToReprocess) });
    }
  };

  const fetchTask = useCallback(() => {
    return getTasks().then(tasks => {
      const t = tasks.find(x => x.id === taskId);
      setTask(t || null);
      const firstSlice = t?.sliceResults?.[0];
      if (firstSlice && !activePreviewUrl) {
        setActivePreviewUrl(firstSlice.id);
      }
      return t || null;
    });
  }, [activePreviewUrl, taskId]);

  const handleCancelTask = async () => {
    if (!task || !isAutoCutTaskActiveStatus(task.status) || isCancelingTask) {
      return;
    }

    try {
      setIsCancelingTask(true);
      await cancelTasks([task.id]);
      await fetchTask();
    } catch (error) {
      reportAutoCutDiagnostic(
        'error',
        'task-detail.cancel-task',
        'Cancel task request failed.',
        error,
      );
    } finally {
      setIsCancelingTask(false);
    }
  };

  const handleResumeTaskFromStep = async (step: TaskExecutionStep) => {
    if (!task || resumingStepId || !isTaskResumeStatus(task)) {
      return;
    }

    try {
      setResumingStepId(step.id);
      await resumeTaskFromStep(task.id, step.id);
      await fetchTask();
    } catch (error) {
      reportAutoCutDiagnostic(
        'error',
        'task-detail.resume-task',
        'Resume task from checkpoint failed.',
        error,
      );
    } finally {
      setResumingStepId(null);
    }
  };

  useEffect(() => {
    void fetchTask();
    const handleUpdate = (updatedTask: AppTask) => {
      if (updatedTask.id === taskId) {
        setTask(updatedTask);
      }
    };
    const handleDelete = (deletedTask: { id: string }) => {
      if (deletedTask.id === taskId) {
        navigate('/tasks');
      }
    };
    const stopTaskUpdated = listenAutoCutEvent('taskUpdated', handleUpdate);
    const stopTaskDeleted = listenAutoCutEvent('taskDeleted', handleDelete);
    return () => {
      stopTaskUpdated();
      stopTaskDeleted();
    };
  }, [fetchTask, navigate, taskId]);

  useEffect(() => {
    if (!task) {
      setSelectedExecutionStepId(undefined);
      setActiveFlowOutputTab('clips');
      setShowAllExecutionLogs(false);
      setShowExecutionDetails(false);
      lastExecutionTaskIdRef.current = null;
      return;
    }

    if (lastExecutionTaskIdRef.current !== task.id) {
      lastExecutionTaskIdRef.current = task.id;
      setSelectedExecutionStepId(undefined);
      setActiveFlowOutputTab('clips');
      setShowAllExecutionLogs(false);
      setShowExecutionDetails(false);
      return;
    }

    const executionSteps = task.executionSteps ?? [];
    if (
      selectedExecutionStepId !== undefined &&
      selectedExecutionStepId !== null &&
      !executionSteps.some((step) => step.id === selectedExecutionStepId)
    ) {
      setSelectedExecutionStepId(undefined);
      return;
    }

    if (selectedExecutionStepId !== undefined) {
      return;
    }

    if (task.currentStepId && executionSteps.some((step) => step.id === task.currentStepId)) {
      setSelectedExecutionStepId(task.currentStepId);
      return;
    }

    if (executionSteps.length > 0) {
      setSelectedExecutionStepId(executionSteps[executionSteps.length - 1]?.id ?? null);
    }
  }, [selectedExecutionStepId, task]);

  const taskDetailEngine = useMemo(
    () => task ? inferSmartSliceTaskDetailEngine(task) : 'legacy-video-slice',
    [task],
  );
  const taskDetailFlowSummary = useMemo(
    () => task ? createTaskDetailEngineFlowSummary(task, taskDetailEngine) : null,
    [task, taskDetailEngine],
  );
  if (!task) {
    return (
      <div className="w-full h-full p-10 flex flex-col items-center justify-center text-gray-400">
        <p>{t('taskDetail.missing.title')}</p>
        <Button className="mt-4" onClick={() => navigate('/tasks')}>{t('taskDetail.missing.back')}</Button>
      </div>
    );
  }

  const normalizedTaskName = normalizeTaskDetailDisplayText(task.name) || task.name;
  const normalizedTaskProgressMessage = translateTaskExecutionDisplayText(task.progressMessage, t);
  const normalizedTaskErrorMessage = normalizeTaskDetailDisplayText(task.errorMessage);
  const canOpenExecutionDiagnostics = hasTaskExecutionDiagnostics(task);
  const headerCurrentFlowStep = taskDetailFlowSummary?.steps.find((step) => step.id === taskDetailFlowSummary.currentStepId) ?? taskDetailFlowSummary?.steps[0];

  const renderContent = () => {
    if (task.status === AUTOCUT_TASK_STATUS.failed) {
      return (
        <div className="flex min-h-full flex-col gap-4">
          <TaskFailureState
            errorMessage={task.errorMessage}
            failureDiagnostics={task.failureDiagnostics}
            onRetry={() => handleReprocessTask(task)}
            onCopyErrorMessage={writeAutoCutClipboardText}
          />
        </div>
      );
    }

    if (task.status === AUTOCUT_TASK_STATUS.canceled || task.status === AUTOCUT_TASK_STATUS.interrupted) {
      return (
        <div className="flex min-h-full flex-col gap-4">
          <div className="flex-1 flex flex-col items-center justify-center border border-[#222] border-dashed rounded-xl bg-[#111] text-gray-500">
            <CircleStop size={48} className="mx-auto mb-4 opacity-40 text-amber-300" />
            <p className="text-lg text-gray-300">{normalizedTaskProgressMessage || t(getTaskStatusLabelKey(task.status))}</p>
            {normalizedTaskErrorMessage && <p className="mt-2 max-w-xl text-center text-sm text-gray-500">{normalizedTaskErrorMessage}</p>}
          </div>
        </div>
      );
    }

    if (task.status === AUTOCUT_TASK_STATUS.reviewing && task.sliceReviewSession) {
      const reviewSegmentCount = task.sliceReviewSession.segments.length;
      const selectedSegmentCount = task.sliceReviewSession.selectedSegmentIds.length;
      const duplicateGroupCount = task.sliceReviewSession.duplicateGroups.length;
      return (
        <div className="flex min-h-full flex-col gap-4">
          <div className="flex-1 flex flex-col items-center justify-center border border-cyan-500/20 border-dashed rounded-xl bg-cyan-500/5 px-6 text-center text-gray-400">
            <Scissors size={48} className="mx-auto mb-4 text-cyan-300" />
            <h2 className="text-xl font-semibold text-cyan-100">{t('taskDetail.review.title')}</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-gray-400">
              {t('taskDetail.review.description')}
            </p>
            <div className="mt-5 grid w-full max-w-md grid-cols-3 gap-2">
              <div className="rounded border border-[#252525] bg-[#101010] px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{t('taskDetail.review.segments')}</div>
                <div className="mt-1 text-sm font-semibold text-gray-100">{reviewSegmentCount}</div>
              </div>
              <div className="rounded border border-[#252525] bg-[#101010] px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{t('taskDetail.review.selected')}</div>
                <div className="mt-1 text-sm font-semibold text-emerald-200">{selectedSegmentCount}</div>
              </div>
              <div className="rounded border border-[#252525] bg-[#101010] px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{t('taskDetail.review.duplicates')}</div>
                <div className="mt-1 text-sm font-semibold text-amber-200">{duplicateGroupCount}</div>
              </div>
            </div>
            <Button
              className="mt-6 bg-cyan-600 hover:bg-cyan-500"
              onClick={() => navigate(`/slicer?reviewTaskId=${encodeURIComponent(task.id)}`)}
            >
              <Scissors size={16} className="mr-2" /> {t('taskDetail.review.openWorkbench')}
            </Button>
          </div>
        </div>
      );
    }

    if (task.status !== AUTOCUT_TASK_STATUS.completed) {
      return (
        <div className="flex min-h-full flex-col gap-4">
          <div className="flex-1 flex flex-col items-center justify-center border border-[#222] border-dashed rounded-xl bg-[#111] text-gray-500">
            <Activity size={48} className="mx-auto mb-4 opacity-30 animate-pulse" />
            <p className="text-lg text-gray-300">{translateTaskExecutionDisplayText(task.progressMessage, t) || t('taskDetail.processing.fallback')}</p>
            <div className="w-64 h-2 bg-[#222] rounded-full mt-4 overflow-hidden">
               <div className="h-full bg-blue-500 transition-all duration-300 relative" style={{ width: `${task.progress || 0}%` }}>
                  <div className="absolute inset-0 bg-white/20 animate-pulse" />
               </div>
            </div>
            <p className="text-xs text-blue-400 mt-2 font-mono">{t('taskDetail.processing.progress', { progress: task.progress || 0 })}</p>
          </div>
        </div>
      );
    }

    if (task.type === AUTOCUT_TASK_TYPE.videoSlice) {
      const sliceResults = task.sliceResults || [];
      const selectedSlice = sliceResults.find((slice) => slice.id === activePreviewUrl) ?? sliceResults[0] ?? null;
      return (
        <TaskDetailCommercialResultPanel
          sliceResults={sliceResults}
          selectedSlice={selectedSlice}
          onSelectSlice={handleSlicePreviewSelect}
          onOpenSliceLocation={(slice) => void handleOpenSliceArtifactInFolder(slice)}
          onDownloadSlice={(slice) => handleDownload(slice.url, slice.name)}
        />
      );
    }

    if (task.type === AUTOCUT_TASK_TYPE.textExtraction && task.extractedText) {
      return (
        <div className="flex-1 flex flex-col bg-[#111] border border-[#222] rounded-xl overflow-hidden relative">
          <div className="absolute top-0 right-0 p-4 shrink-0 flex gap-2">
             <Button onClick={() => {
               const text = formatExtractedText(task);
               void writeAutoCutClipboardText(text);
               setCopied(true);
               setTimeout(() => setCopied(false), 2000);
             }} variant="outline" className="text-xs">
               <Copy size={14} className="mr-2" /> {copied ? t('taskDetail.result.copied') : t('taskDetail.result.copyText')}
             </Button>
             <Button onClick={() => {
               downloadExtractedTextFile(task, `${normalizedTaskName}.txt`);
             }} className="text-xs bg-purple-600 hover:bg-purple-500">
               <Download size={14} className="mr-2" /> {t('taskDetail.result.exportTxt')}
             </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-10 custom-scrollbar mt-12 bg-[#0A0A0A]">
            <div className="max-w-5xl mx-auto space-y-6">
               {task.extractedText.map((item, idx) => (
                 <div key={idx} className="group relative">
                    <div className="absolute -left-16 top-1 text-[10px] font-mono text-gray-500">{item.time}</div>
                    <div className="flex items-start gap-4">
                      <div className="shrink-0 w-8 h-8 bg-purple-500/10 border border-purple-500/20 text-purple-400 rounded-full flex items-center justify-center font-bold text-[10px]">
                        {item.speaker[0]}
                      </div>
                      <div className="flex-1">
                         <div className="text-[10px] text-gray-500 font-bold mb-1 uppercase tracking-wider">{item.speaker}</div>
                         <div className="text-gray-200 leading-relaxed text-[15px]">{item.text}</div>
                      </div>
                    </div>
                 </div>
               ))}
            </div>
          </div>
        </div>
      );
    }

    if (task.type === AUTOCUT_TASK_TYPE.videoGif && task.gifUrl) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center border border-[#222] rounded-xl bg-[#111]">
          <div className="bg-[#1A1A1A] p-4 rounded-xl border border-[#333] shadow-xl max-w-xl w-full">
            <img src={task.gifUrl} alt={t('taskDetail.result.gifAlt')} className="w-full rounded bg-black object-contain h-auto max-h-[400px]" />
          </div>
          <Button onClick={() => handleDownload(task.gifUrl, `${normalizedTaskName}.gif`)} className="mt-8 px-8" size="lg">
             <Download size={18} className="mr-2" /> {t('taskDetail.result.downloadGif')}
          </Button>
        </div>
      );
    }

    if (task.type === AUTOCUT_TASK_TYPE.audioExtraction && task.audioUrl) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center border border-[#222] rounded-xl bg-[#111]">
          <div className="w-20 h-20 bg-green-500/20 text-green-500 rounded-full flex items-center justify-center mb-8">
             <Music size={32} />
          </div>
          <div className="bg-black/40 p-6 rounded-2xl border border-[#222] max-w-md w-full backdrop-blur-sm shadow-xl">
             <h3 className="text-sm text-gray-400 mb-4 font-medium text-center truncate">{t('taskDetail.result.audioTitle', { name: normalizedTaskName })}</h3>
             <audio src={task.audioUrl} controls className="w-full outline-none" />
             <div className="mt-6 flex justify-center">
               <Button onClick={() => handleDownload(task.audioUrl, `${normalizedTaskName}.mp3`)} className="w-full bg-green-600 hover:bg-green-500" size="lg">
                 <Download size={16} className="mr-2" /> {t('taskDetail.result.downloadAudio')}
               </Button>
             </div>
          </div>
        </div>
      );
    }

    if ((task.type === AUTOCUT_TASK_TYPE.subtitleTranslate || task.type === AUTOCUT_TASK_TYPE.voiceTranslate) && (task.subtitleUrl || task.transcriptText)) {
      const transcriptText = formatExtractedText(task);
      const translationText = task.translationSegments?.length
        ? task.translationSegments.map((segment) => `[${formatSliceTranscriptTimestamp(segment.startMs)} - ${formatSliceTranscriptTimestamp(segment.endMs)}] ${segment.speaker || t('taskDetail.result.speakerFallback')}: ${segment.text}`).join('\n')
        : task.translationText?.trim() ?? '';
      const displayText = translationText || transcriptText;
      const transcriptSegmentCount = task.transcriptSegmentCount ?? task.transcriptSegments?.length ?? 0;
      return (
        <div className="flex-1 flex flex-col border border-[#222] rounded-xl bg-[#111] overflow-hidden">
          <div className="p-4 bg-[#151515] border-b border-[#222] flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
                <FileText size={16} />
              </div>
              <div>
                <div className="font-bold text-gray-100">{t('taskDetail.result.translationTitle')}</div>
                <div className="text-xs text-gray-500">{t('taskDetail.result.speechSegments', { count: transcriptSegmentCount })}</div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {task.subtitleUrl && (
                <Button onClick={() => handleDownload(task.subtitleUrl, `${normalizedTaskName}.${task.subtitleFormat || 'srt'}`)} className="bg-indigo-600 hover:bg-indigo-500">
                  <Download size={16} className="mr-2" /> {t('taskDetail.result.downloadSrt')}
                </Button>
              )}
              {displayText && (
                <Button variant="outline" onClick={() => {
                  void writeAutoCutClipboardText(displayText);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}>
                  <Copy size={16} className="mr-2" /> {copied ? t('taskDetail.result.copied') : translationText ? t('taskDetail.result.copyTranslation') : t('taskDetail.result.copyTranscript')}
                </Button>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-6 bg-[#0A0A0A]">
            <pre className="whitespace-pre-wrap text-sm leading-relaxed text-gray-200 font-mono">{displayText || t('taskDetail.result.noTranscript')}</pre>
          </div>
        </div>
      );
    }

    if (task.type === AUTOCUT_TASK_TYPE.videoCompress && task.fileSizeStats && task.videoUrl) {
      const { originalSize, newSize, compressionRatio } = task.fileSizeStats;
      return (
        <div className="flex-1 flex flex-col items-center justify-center border border-[#222] rounded-xl bg-[#111]">
          <Zap size={48} className="text-yellow-500 mb-6" />
          <h2 className="text-2xl font-bold mb-8">{t('taskDetail.result.compressionComplete', { ratio: compressionRatio })}</h2>

          <div className="flex items-center gap-8 mb-10">
            <div className="flex flex-col items-center pb-4 border-b-2 border-[#333]">
              <span className="text-sm text-gray-500 mb-1">{t('taskDetail.result.originalSize')}</span>
              <span className="text-xl font-bold text-gray-300">{formatBytes(originalSize) ?? t('taskDetail.result.unavailable')}</span>
            </div>
            <ArrowRight className="text-gray-600" />
            <div className="flex flex-col items-center pb-4 border-b-2 border-yellow-500">
              <span className="text-sm text-yellow-500 mb-1">{t('taskDetail.result.compressedSize')}</span>
              <span className="text-3xl font-bold text-white">{formatBytes(newSize) ?? t('taskDetail.result.unavailable')}</span>
            </div>
          </div>

          <div className="flex gap-4">
            <Button variant="outline" onClick={() => openAutoCutPreviewUrl(task.videoUrl)} size="lg">{t('taskDetail.result.previewVideo')}</Button>
            <Button onClick={() => handleDownload(task.videoUrl, `${normalizedTaskName}_compressed.mp4`)} size="lg" className="bg-green-600 hover:bg-green-500">
               <Download size={18} className="mr-2" /> {t('taskDetail.result.downloadCompressedVideo')}
            </Button>
          </div>
        </div>
      );
    }

    if (task.videoUrl) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center border border-[#222] rounded-xl bg-[#111] overflow-hidden">
          <TaskVideoPreview src={task.videoUrl} title={normalizedTaskName} videoKey={task.id} />
          <div className="p-6 bg-[#151515] w-full border-t border-[#222] flex justify-center">
             <Button onClick={() => handleDownload(task.videoUrl, `${normalizedTaskName}_output.mp4`)} size="lg">
               <Download size={18} className="mr-2" /> {t('taskDetail.result.downloadOutputFile')}
             </Button>
          </div>
        </div>
      );
    }

    // Fallback display
    return (
      <div className="flex-1 flex items-center justify-center border border-[#222] border-dashed rounded-xl bg-[#111] text-gray-500">
          <div className="text-center">
            <FileText size={48} className="mx-auto mb-4 opacity-30" />
            <p>{t('taskDetail.result.fallbackEmpty')}</p>
            {task.status === AUTOCUT_TASK_STATUS.completed && task.resultCount !== undefined && task.resultCount > 0 && (
              <Button className="mt-4" variant="outline" onClick={() => downloadTaskExecutionResultFile(task, getTaskTypeLabel(task.type), t(getTaskStatusLabelKey(task.status)), t)}>{t('taskDetail.result.downloadTaskResult', { count: task.resultCount })}</Button>
            )}
          </div>
      </div>
    );
  };

  return (
    <div className="w-full min-h-full overflow-y-auto bg-[#0A0A0A]">
      <div className="w-full min-h-full p-6 md:p-10 flex flex-col gap-4">

        {/* Header */}
        <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/10 pb-2 shrink-0">
          <button
            onClick={() => navigate('/tasks')}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/10 text-gray-400 transition-colors hover:bg-white/[0.04] hover:text-white"
          >
            <ArrowLeft size={16} />
          </button>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="min-w-[180px] max-w-full truncate text-base font-semibold text-white">
              {normalizedTaskName}
            </h1>
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
              <span>{t('taskDetail.header.type')}: <span className="font-medium text-gray-300">{getTaskTypeLabel(task.type)}</span></span>
              {taskDetailFlowSummary && (
                <span>{t(`taskDetail.flow.engine.${taskDetailFlowSummary.engine}`)}</span>
              )}
              {headerCurrentFlowStep && (
                <span>{t('taskDetail.flow.current')}: <span className="font-medium text-gray-300">{t(headerCurrentFlowStep.labelKey)}</span></span>
              )}
              {taskDetailFlowSummary && (
                <span>{t('taskDetail.result.progress')}: <span className="font-mono text-cyan-200">{taskDetailFlowSummary.progress}%</span></span>
              )}
              <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${getTaskStatusBadgeClass(task.status)}`}>
                {t(getTaskStatusLabelKey(task.status))}
              </span>
            </div>
          </div>
          {getReprocessRoute(task.type) && task.status !== AUTOCUT_TASK_STATUS.processing && (
            <Button
              variant="outline"
              className="h-7 shrink-0 border-white/10 bg-transparent px-2.5 text-xs text-gray-200 hover:bg-white/[0.04]"
              onClick={() => handleReprocessTask(task)}
            >
              {t('taskDetail.header.processAgain')}
            </Button>
          )}
          {canOpenExecutionDiagnostics && (
            <Button
              variant="outline"
              className="h-7 shrink-0 border-cyan-500/25 bg-cyan-500/[0.06] px-2.5 text-xs text-cyan-100 hover:border-cyan-400/40 hover:bg-cyan-500/10"
              aria-expanded={showExecutionDetails}
              onClick={() => setShowExecutionDetails((visible) => !visible)}
            >
              <Terminal size={13} className="mr-1.5" />
              {t('taskDetail.engineSteps.diagnostics.show')}
            </Button>
          )}
        </div>

        {task.type === AUTOCUT_TASK_TYPE.videoSlice && (
          <TaskDetailCommercialFlowPanel
            task={task}
            summary={taskDetailFlowSummary}
            activeOutputTab={activeFlowOutputTab}
            onSelectOutputTab={setActiveFlowOutputTab}
            onOpenReviewWorkbench={() => navigate(`/slicer?reviewTaskId=${encodeURIComponent(task.id)}`)}
          />
        )}

        {/* Content Area */}
        <div className="min-h-0 flex-1">
          {renderContent()}
        </div>

        <TaskExecutionPanel
          task={task}
          isCancelingTask={isCancelingTask}
          resumingStepId={resumingStepId}
          selectedExecutionStepId={selectedExecutionStepId ?? null}
          showAllExecutionLogs={showAllExecutionLogs}
          showExecutionDetails={showExecutionDetails}
          onCancelTask={() => void handleCancelTask()}
          onResumeTaskFromStep={(step) => void handleResumeTaskFromStep(step)}
          onSelectExecutionStep={setSelectedExecutionStepId}
          onToggleShowAllExecutionLogs={() => setShowAllExecutionLogs((visible) => !visible)}
          onToggleExecutionDetails={() => setShowExecutionDetails((visible) => !visible)}
        />

      </div>
    </div>
  );
}

function TaskDetailCommercialFlowPanel({
  task,
  summary,
  activeOutputTab,
  onSelectOutputTab,
  onOpenReviewWorkbench,
}: {
  task: AppTask;
  summary: TaskDetailEngineFlowSummary | null;
  activeOutputTab: TaskDetailOutputTab;
  onSelectOutputTab: (tab: TaskDetailOutputTab) => void;
  onOpenReviewWorkbench: () => void;
}) {
  const { t } = useTranslation();
  if (!summary) {
    return null;
  }

  const outputTabs = [
    {
      id: 'clips',
      label: t('taskDetail.flow.metrics.clips'),
      visible: (task.sliceResults?.length ?? 0) > 0,
      content: (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {(task.sliceResults ?? []).map((slice, index) => (
            <div key={slice.id} className="rounded-md border border-white/10 bg-white/[0.025] px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-gray-300">#{index + 1}</span>
                <span className="text-[10px] text-gray-500">{formatTaskDetailResultDuration(slice) ?? t('taskDetail.result.unavailable')}</span>
              </div>
              <div className="mt-2 truncate text-sm font-medium text-gray-100">
                {normalizeTaskDetailDisplayText(slice.title || slice.name)}
              </div>
              <div className="mt-1 text-[11px] text-gray-500">
                {formatTaskDetailResultSize(slice.size) ?? t('taskDetail.result.unavailable')}
                {slice.resolution ? ` · ${slice.resolution}` : ''}
              </div>
              {(slice.reason || slice.summary) && (
                <div className="mt-2 line-clamp-3 text-xs leading-relaxed text-gray-400">
                  {normalizeTaskDetailDisplayText(slice.reason || slice.summary)}
                </div>
              )}
            </div>
          ))}
        </div>
      ),
    },
    {
      id: 'review',
      label: t('taskDetail.review.title'),
      visible: Boolean(task.sliceReviewSession),
      content: task.sliceReviewSession ? (
        <div className="grid gap-2 md:grid-cols-3">
          <div className="rounded-md border border-white/10 bg-white/[0.025] px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-gray-500">{t('taskDetail.flow.metrics.clips')}</div>
            <div className="mt-1 font-mono text-lg font-semibold text-gray-100">{task.sliceReviewSession.segments.length}</div>
          </div>
          <div className="rounded-md border border-white/10 bg-white/[0.025] px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-gray-500">{t('taskDetail.flow.metrics.selected')}</div>
            <div className="mt-1 font-mono text-lg font-semibold text-gray-100">{task.sliceReviewSession.selectedSegmentIds.length}</div>
          </div>
          <div className="rounded-md border border-white/10 bg-white/[0.025] px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-gray-500">{t('taskDetail.executionDiagnostics.logsTitle')}</div>
            <div className="mt-1 font-mono text-lg font-semibold text-gray-100">{task.sliceReviewSession.manualEdits.length}</div>
          </div>
        </div>
      ) : null,
    },
    {
      id: 'transcript',
      label: t('taskDetail.flow.metrics.transcript'),
      visible: (task.sliceResults ?? []).some((slice) => (slice.transcriptSegments?.length ?? 0) > 0 || slice.transcriptText),
      content: (
        <div className="space-y-2">
          {(task.sliceResults ?? []).filter((slice) => (slice.transcriptSegments?.length ?? 0) > 0 || slice.transcriptText).slice(0, 6).map((slice) => (
            <div key={slice.id} className="rounded-md border border-white/10 bg-white/[0.025] px-3 py-2">
              <div className="truncate text-xs font-semibold text-gray-200">{normalizeTaskDetailDisplayText(slice.title || slice.name)}</div>
              <div className="mt-1 line-clamp-3 text-xs leading-relaxed text-gray-500">
                {normalizeTaskDetailDisplayText(slice.transcriptText) || t('taskDetail.result.noTranscript')}
              </div>
            </div>
          ))}
        </div>
      ),
    },
    {
      id: 'files',
      label: t('taskDetail.flow.metrics.outputs'),
      visible: (task.sliceResults?.length ?? 0) > 0,
      content: (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {(task.sliceResults ?? []).map((slice) => (
            <div key={slice.id} className="rounded-md border border-white/10 bg-white/[0.025] px-3 py-2">
              <div className="truncate text-xs font-semibold text-gray-200">{normalizeTaskDetailDisplayText(slice.title || slice.name)}</div>
              <div className="mt-1 text-[11px] text-gray-500">{formatTaskDetailResultSize(slice.size) ?? t('taskDetail.result.unavailable')}</div>
              <div className="mt-2 truncate font-mono text-[10px] text-gray-600">{normalizeTaskDetailDisplayText(slice.artifactPath || slice.url)}</div>
            </div>
          ))}
        </div>
      ),
    },
  ].filter((tab) => tab.visible) as Array<{ id: TaskDetailOutputTab; label: string; content: ReactNode }>;
  const selectedOutputTab = outputTabs.find((tab) => tab.id === activeOutputTab) ?? outputTabs[0] ?? null;

  return (
    <section
      data-task-detail-commercial-flow="primary"
      className="shrink-0 rounded-md border border-white/10 bg-white/[0.025]"
    >
      <div className="min-w-0 overflow-x-auto px-0 py-3 custom-scrollbar">
          <ol
            className="grid w-full min-w-full"
            style={{ gridTemplateColumns: `repeat(${summary.steps.length}, minmax(96px, 1fr))` }}
          >
            {summary.steps.map((step, index) => {
              const isCurrent = step.id === summary.currentStepId;
              const isCompleted = step.status === 'completed';
              const stepProgress = Math.min(100, Math.max(0, step.progress));
              return (
                <li
                  key={step.id}
                  data-task-detail-flow-step={step.id}
                  aria-current={isCurrent ? 'step' : undefined}
                  className="relative min-w-0 px-2 pb-1 pt-0"
                >
                  {index > 0 && (
                    <span
                      className={`absolute left-0 top-[18px] h-px w-1/2 ${isCompleted || isCurrent ? 'bg-cyan-400/50' : 'bg-white/10'}`}
                      aria-hidden="true"
                    />
                  )}
                  {index < summary.steps.length - 1 && (
                    <span
                      className={`absolute right-0 top-[18px] h-px w-1/2 ${isCompleted ? 'bg-cyan-400/50' : 'bg-white/10'}`}
                      aria-hidden="true"
                    />
                  )}
                  <div className="relative z-10 flex flex-col items-center text-center">
                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-full p-[2px] ${isCurrent ? 'ring-4 ring-cyan-300/10' : ''}`}
                      style={{
                        background: `conic-gradient(${getTaskDetailFlowStepProgressColor(step.status, isCurrent)} ${stepProgress * 3.6}deg, rgba(255,255,255,0.1) 0deg)`,
                      }}
                      aria-label={`${t(step.labelKey)} ${stepProgress}%`}
                    >
                      <span className="flex h-full w-full items-center justify-center rounded-full bg-[#0A0A0A] font-mono text-[9px] font-semibold text-gray-100">
                        {stepProgress}<span className="text-[7px]">%</span>
                      </span>
                    </span>
                    <span className={`mt-2 max-w-full truncate text-xs font-medium ${isCurrent ? 'text-cyan-100' : 'text-gray-300'}`}>
                      {t(step.labelKey)}
                    </span>
                    <span className={`mt-1 text-[10px] ${isCurrent ? 'text-cyan-300' : 'text-gray-600'}`}>
                      {t(getTaskDetailFlowStatusLabelKey(step.status))}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
      </div>

      {selectedOutputTab && (
        <div className="border-t border-white/10 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            {outputTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                  tab.id === selectedOutputTab.id
                    ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-100'
                    : 'border-white/10 bg-transparent text-gray-400 hover:border-cyan-500/30 hover:text-gray-200'
                }`}
                onClick={() => onSelectOutputTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
            {task.status === AUTOCUT_TASK_STATUS.reviewing && task.sliceReviewSession && (
              <Button
                className="ml-auto h-8 shrink-0 bg-cyan-600 px-3 text-xs hover:bg-cyan-500"
                onClick={onOpenReviewWorkbench}
              >
                <Scissors size={13} className="mr-1.5" /> {t('taskDetail.review.openWorkbench')}
              </Button>
            )}
          </div>
          <div className="mt-3">
            {selectedOutputTab.content}
          </div>
        </div>
      )}
    </section>
  );
}

function getTaskDetailFlowStatusLabelKey(status: TaskDetailEngineFlowStepStatus) {
  return `taskDetail.flow.status.${status}` as const;
}

function getTaskDetailFlowStepProgressColor(status: TaskDetailEngineFlowStepStatus, isCurrent: boolean) {
  if (isCurrent) {
    return 'rgb(103,232,249)';
  }
  switch (status) {
    case 'completed':
      return 'rgb(110,231,183)';
    case 'running':
      return 'rgb(147,197,253)';
    case 'action-required':
      return 'rgb(103,232,249)';
    case 'blocked':
    case 'failed':
      return 'rgb(253,164,175)';
    case 'upcoming':
    default:
      return 'rgba(148,163,184,0.45)';
  }
}

function TaskExecutionPanel({
  task,
  isCancelingTask,
  resumingStepId,
  selectedExecutionStepId,
  showAllExecutionLogs,
  showExecutionDetails,
  onCancelTask,
  onResumeTaskFromStep,
  onSelectExecutionStep,
  onToggleShowAllExecutionLogs,
  onToggleExecutionDetails,
}: {
  task: AppTask;
  isCancelingTask: boolean;
  resumingStepId: string | null;
  selectedExecutionStepId: string | null;
  showAllExecutionLogs: boolean;
  showExecutionDetails: boolean;
  onCancelTask: () => void;
  onResumeTaskFromStep: (step: TaskExecutionStep) => void;
  onSelectExecutionStep: (stepId: string | null) => void;
  onToggleShowAllExecutionLogs: () => void;
  onToggleExecutionDetails: () => void;
}) {
  const { t } = useTranslation();
  const steps = task.executionSteps ?? [];
  const logs = task.executionLogs ?? [];
  const selectedStep = selectedExecutionStepId
    ? steps.find((step) => step.id === selectedExecutionStepId)
    : undefined;
  const filteredExecutionLogs = selectedExecutionStepId
    ? logs.filter((log) => log.stepId === selectedExecutionStepId)
    : logs;
  const visibleExecutionLogs = [...(showAllExecutionLogs
    ? filteredExecutionLogs
    : filteredExecutionLogs.slice(-12)
  )].reverse();
  const currentStep = task.currentStepId
    ? steps.find((step) => step.id === task.currentStepId)
    : undefined;
  const summaryStep = selectedStep ?? currentStep ?? steps.at(-1);
  const latestLog = logs.at(-1);
  const errorLogCount = logs.filter((log) => log.severity === 'error').length;
  const executionStepLabelById = new Map(steps.map((step) => [step.id, step.label || step.id]));
  const executionLogCountByStepId = logs.reduce((counts, log) => {
    if (log.stepId) {
      counts.set(log.stepId, (counts.get(log.stepId) ?? 0) + 1);
    }
    return counts;
  }, new Map<string, number>());
  const hasExecutionState = hasTaskExecutionDiagnostics(task);

  if (!hasExecutionState) {
    return null;
  }

  return (
    <div className="relative z-20 shrink-0 rounded-md border border-white/10 bg-white/[0.025]">
      <div className="flex min-h-[44px] flex-col gap-2 px-3 py-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-gray-100">
              <Activity size={14} className="text-blue-300" />
              {t('taskDetail.engineSteps.diagnostics.title')}
            </span>
            {summaryStep && (
              <span className="max-w-[180px] truncate rounded border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 font-mono text-[11px] text-blue-200">
                {translateTaskExecutionDisplayText(summaryStep.label || summaryStep.id, t)}
              </span>
            )}
            {task.nativeTaskId && (
              <span className="hidden rounded border border-[#333] bg-[#0A0A0A] px-2 py-0.5 font-mono text-[11px] text-gray-400 xl:inline-flex">
                {t('taskDetail.executionDiagnostics.nativeTask', { id: task.nativeTaskId })}
              </span>
            )}
            <span className="hidden rounded border border-[#333] bg-[#0A0A0A] px-2 py-0.5 text-[11px] text-gray-400 md:inline-flex">
              {t('taskDetail.executionDiagnostics.stepsCount', { count: steps.length })}
            </span>
            <span className="hidden rounded border border-[#333] bg-[#0A0A0A] px-2 py-0.5 text-[11px] text-gray-400 md:inline-flex">
              {t('taskDetail.executionDiagnostics.logsCount', { count: logs.length })}
            </span>
            {errorLogCount > 0 && (
              <span className="shrink-0 rounded border border-rose-500/20 bg-rose-500/10 px-2 py-0.5 text-[11px] text-rose-200">
                {t('taskDetail.executionDiagnostics.errorsCount', { count: errorLogCount })}
              </span>
            )}
            <p className="min-w-0 flex-1 truncate text-xs text-gray-500">
              {translateTaskExecutionDisplayText(latestLog?.message, t) ||
                translateTaskExecutionDisplayText(summaryStep?.message, t) ||
                translateTaskExecutionDisplayText(task.progressMessage, t) ||
                t('taskDetail.executionDiagnostics.progressFallback', { progress: task.progress || 0 })}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2">
          <div className="hidden h-1.5 w-28 overflow-hidden rounded-full bg-[#222] sm:block">
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${Math.min(100, Math.max(0, task.progress || 0))}%` }}
            />
          </div>
          <span className="w-9 text-right font-mono text-xs text-blue-300">{Math.round(task.progress || 0)}%</span>
          {isAutoCutTaskActiveStatus(task.status) && (
            <Button
              variant="outline"
              className="h-8 border-amber-500/30 px-3 text-xs text-amber-200 hover:bg-amber-500/10"
              disabled={isCancelingTask}
              onClick={onCancelTask}
            >
              {isCancelingTask ? <RefreshCw size={13} className="mr-1.5 animate-spin" /> : <CircleStop size={13} className="mr-1.5" />}
              {t('taskDetail.executionDiagnostics.cancel')}
            </Button>
          )}
        </div>
      </div>

      {showExecutionDetails && (
      <div
        className="fixed inset-0 z-50 flex justify-start bg-black/55 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-detail-execution-drawer-title"
        onClick={onToggleExecutionDetails}
      >
      <div
        data-task-detail-diagnostics-panel="advanced"
        data-task-detail-diagnostics-drawer="true"
        className="flex h-full w-[90vw] min-w-0 max-w-none flex-col overflow-hidden border-r border-white/10 bg-[#0A0A0A] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex min-h-[52px] shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <h2 id="task-detail-execution-drawer-title" className="inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-gray-100">
              <Terminal size={15} className="text-cyan-300" />
              {t('taskDetail.engineSteps.diagnostics.show')}
            </h2>
            <span className="min-w-0 truncate text-xs text-gray-500">
              {translateTaskExecutionDisplayText(latestLog?.message, t) ||
                translateTaskExecutionDisplayText(summaryStep?.message, t) ||
                t('taskDetail.executionDiagnostics.progressFallback', { progress: task.progress || 0 })}
            </span>
          </div>
          <button
            type="button"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/10 text-gray-400 transition-colors hover:bg-white/[0.04] hover:text-white"
            aria-label={t('taskDetail.engineSteps.diagnostics.hide')}
            onClick={onToggleExecutionDetails}
          >
            <X size={15} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
        <div className="grid h-full min-h-0 gap-0 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div
          data-task-detail-diagnostics-step-filter="true"
          className="flex min-h-0 flex-col overflow-hidden border-b border-white/10 bg-[#080808] p-2.5 lg:border-b-0 lg:border-r"
        >
          <div className="min-h-0 overflow-y-auto pr-1 custom-scrollbar">
          <div className="grid gap-1.5">
            {steps.length > 0 && (
              <button
                type="button"
                data-task-execution-step-id="all"
                aria-pressed={!selectedExecutionStepId}
                className={`rounded-md border px-2.5 py-2 text-left transition-colors ${
                  !selectedExecutionStepId
                    ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-100'
                    : 'border-[#333] bg-[#0A0A0A] text-gray-300 hover:border-cyan-500/30 hover:bg-cyan-500/5'
                }`}
                onClick={() => onSelectExecutionStep(null)}
              >
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="truncate text-xs font-semibold">{t('taskDetail.executionDiagnostics.allSteps')}</span>
                  <span className="shrink-0 font-mono text-[10px] opacity-80">{logs.length}</span>
                </div>
              </button>
            )}
            {steps.length ? steps.map((step) => {
              const stepProgress = getTaskExecutionStepProgress(step);
              return (
              <div
                key={step.id}
                className={`rounded-md border px-2.5 py-2 transition-colors ${getTaskExecutionStepStatusClass(step.status)} ${
                  selectedExecutionStepId === step.id ? 'ring-1 ring-cyan-300/50' : 'hover:border-cyan-500/40'
                }`}
              >
                <button
                  type="button"
                  data-task-execution-step-id={step.id}
                  aria-pressed={selectedExecutionStepId === step.id}
                  className="block w-full text-left"
                  onClick={() => onSelectExecutionStep(step.id)}
                >
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold">{translateTaskExecutionDisplayText(step.label || step.id, t)}</span>
                    <span className="shrink-0 text-[10px] opacity-80">{t(getTaskExecutionStepStatusLabelKey(step.status))}</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/30">
                    <div
                      className="h-full bg-current opacity-70"
                      style={{ width: `${stepProgress}%` }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-[10px] opacity-80">
                    <span>{stepProgress}%</span>
                    <span className="truncate">{formatTaskExecutionDuration(step.durationMs) ?? t('taskDetail.executionDiagnostics.unavailable')}</span>
                    <span className="shrink-0 font-mono">{executionLogCountByStepId.get(step.id) ?? 0}</span>
                  </div>
                  {step.message && <p className="mt-1 line-clamp-2 text-[11px] opacity-90">{translateTaskExecutionDisplayText(step.message, t)}</p>}
                </button>
                {step.canResumeFromHere && isTaskResumeStatus(task) && (
                  <Button
                    variant="outline"
                    className="mt-2 h-7 w-full border-cyan-500/30 px-2 text-[10px] text-cyan-200 hover:bg-cyan-500/10"
                    disabled={Boolean(resumingStepId)}
                    onClick={() => onResumeTaskFromStep(step)}
                  >
                    {resumingStepId === step.id ? <RefreshCw size={12} className="mr-1.5 animate-spin" /> : <RefreshCw size={12} className="mr-1.5" />}
                    {t('taskDetail.executionDiagnostics.resumeFromHere')}
                  </Button>
                )}
              </div>
              );
            }) : (
              <div className="rounded border border-[#222] bg-[#0A0A0A] px-3 py-6 text-center text-xs text-gray-500">
                {t('taskDetail.executionDiagnostics.emptySteps')}
              </div>
            )}
          </div>
          </div>
        </div>

        <div
          data-task-detail-diagnostics-log-stream="true"
          className="flex min-h-0 flex-col overflow-hidden"
        >
          <div className="flex min-h-[42px] shrink-0 items-center justify-between gap-3 border-b border-white/10 px-3 py-2">
            <div className="min-w-0 text-xs text-gray-500">
              <span className="font-medium text-gray-300">
                {selectedStep ? translateTaskExecutionDisplayText(selectedStep.label || selectedStep.id, t) : t('taskDetail.executionDiagnostics.allSteps')}
              </span>
              <span className="ml-2 font-mono text-[11px] text-gray-600">{filteredExecutionLogs.length}/{logs.length}</span>
              {errorLogCount > 0 && <span className="ml-2 text-rose-300">{t('taskDetail.executionDiagnostics.errorsCount', { count: errorLogCount })}</span>}
            </div>
            {filteredExecutionLogs.length > 12 && (
              <button
                type="button"
                className="shrink-0 rounded-md border border-[#333] bg-transparent px-2 py-1 text-[10px] text-cyan-300 hover:border-cyan-500/40 hover:bg-cyan-500/10"
                onClick={onToggleShowAllExecutionLogs}
              >
                {showAllExecutionLogs ? t('taskDetail.executionDiagnostics.latestLogs') : t('taskDetail.executionDiagnostics.showAllLogs')}
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
          <div className="divide-y divide-white/5">
            {visibleExecutionLogs.length ? visibleExecutionLogs.map((log) => {
              const providerProgress = formatTaskExecutionLogProviderProgress(log);
              return (
              <div
                key={log.id}
                data-task-execution-log-step-id={log.stepId ?? 'unassigned'}
                className="px-3 py-2.5 transition-colors hover:bg-white/[0.025]"
              >
                <div className="flex min-w-0 items-center gap-2 text-[10px]">
                  <span className={`font-semibold uppercase ${getTaskExecutionLogSeverityClass(log.severity)}`}>
                    {t(getTaskExecutionLogSeverityLabelKey(log.severity))}
                  </span>
                  <span className="truncate text-gray-500">
                    {normalizeTaskDetailDisplayText(
                      log.stepId
                        ? translateTaskExecutionDisplayText(executionStepLabelById.get(log.stepId) ?? log.stepId, t)
                        : t('taskDetail.executionDiagnostics.unassignedStep'),
                    )}
                  </span>
                  {log.progress !== undefined && <span className="font-mono text-blue-300">{Math.round(log.progress)}%</span>}
                  {providerProgress && <span className="rounded bg-cyan-500/10 px-1.5 py-0.5 font-mono text-cyan-200">{providerProgress}</span>}
                  <button
                    type="button"
                    data-task-execution-log-copy={log.id}
                    className="inline-flex h-5 w-5 items-center justify-center rounded text-gray-500 transition-colors hover:bg-white/[0.06] hover:text-cyan-200"
                    title={t('taskDetail.executionDiagnostics.copyLog')}
                    aria-label={t('taskDetail.executionDiagnostics.copyLog')}
                    onClick={() => {
                      void writeAutoCutClipboardText(createTaskExecutionLogClipboardText(log, t)).catch((error) => {
                        reportAutoCutDiagnostic(
                          'warning',
                          'task-detail.copy-execution-log',
                          'Copy execution log failed.',
                          error,
                        );
                      });
                    }}
                  >
                    <Copy size={11} />
                  </button>
                  <span className="ml-auto shrink-0 text-gray-600">{formatAutoCutDateTime(log.timestamp)}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-gray-300">{translateTaskExecutionDisplayText(log.message, t)}</p>
                {(log.phase || log.source || log.elapsedMs !== undefined) && (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-gray-600">
                  {log.phase && <span>{translateTaskExecutionDisplayText(log.phase, t)}</span>}
                  {log.source && <span>{translateTaskExecutionDisplayText(log.source, t)}</span>}
                  {log.elapsedMs !== undefined && <span>{formatTaskExecutionDuration(log.elapsedMs) ?? t('taskDetail.executionDiagnostics.unavailable')}</span>}
                </div>
                )}
              </div>
              );
            }) : (
              <div className="px-3 py-10 text-center text-xs text-gray-500">
                {selectedExecutionStepId ? t('taskDetail.executionDiagnostics.emptySelectedLogs') : t('taskDetail.executionDiagnostics.emptyLogs')}
              </div>
            )}
          </div>
          </div>
          {isTaskResumeStatus(task) && task.errorMessage && (
            <div className="mt-3 rounded border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              <AlertTriangle size={13} className="mr-1.5 inline" />
              {normalizeTaskDetailDisplayText(task.errorMessage)}
            </div>
          )}
        </div>
        </div>
      </div>
      </div>
      </div>
      )}
    </div>
  );
}
