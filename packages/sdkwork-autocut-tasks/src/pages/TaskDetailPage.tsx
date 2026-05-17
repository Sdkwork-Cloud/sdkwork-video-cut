import { useCallback, useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, PlayCircle, Play, Download, FolderOpen, Tag, CheckCircle2, Settings2, FileText, Music, Copy, ArrowRight, Activity, Zap, ShieldAlert, Pencil, Save, X, CircleStop, Clock, Terminal, AlertTriangle, RefreshCw, Scissors } from 'lucide-react';
import { cancelTasks, createAutoCutTaskTypeI18nKey, createAutoCutTextObjectUrl, downloadAutoCutUrl, downloadExtractedTextFile, downloadSmartSliceTaskEvidenceFile, formatAutoCutDateTime, formatExtractedText, getTasks, listenAutoCutEvent, openAutoCutNativeArtifactInFolder, openAutoCutPreviewUrl, reportAutoCutDiagnostic, resumeTaskFromStep, revokeAutoCutObjectUrl, updateTaskSliceTranscript, writeAutoCutClipboardText } from '@sdkwork/autocut-services';
import { Button, TaskFailureState, normalizeAutoCutTaskDetailDisplayText } from '@sdkwork/autocut-commons';
import { AUTOCUT_SMART_SLICE_REVIEW_RISK_CATALOG, AUTOCUT_TASK_STATUS, AUTOCUT_TASK_TYPE, isAutoCutTaskActiveStatus, type AppTask, type TaskType } from '@sdkwork/autocut-types';

type SliceResult = NonNullable<AppTask['sliceResults']>[number];
type TaskExecutionStep = NonNullable<AppTask['executionSteps']>[number];
type TaskExecutionLog = NonNullable<AppTask['executionLogs']>[number];
type TranscriptSegment = NonNullable<SliceResult['transcriptSegments']>[number];
type TranscriptDraftMode = 'segments' | 'text';
type SmartSliceEvidenceCheckpointStepId =
  | 'speech-to-text'
  | 'plan-clips'
  | 'human-review'
  | 'verify-artifacts';

interface TranscriptDraftState {
  sliceId: string;
  mode: TranscriptDraftMode;
  text: string;
  segments: TranscriptSegment[];
}

interface SmartSliceEvidenceArtifact {
  relativePath: string;
  artifactPath?: string;
  taskOutputDir?: string;
  byteSize?: number;
  contentSha256?: string;
}

interface SmartSliceEvidenceInspectorRow {
  item: SmartSliceEvidencePackageItem;
  present: boolean;
  stepCompleted: boolean;
  summary: string;
  artifact?: SmartSliceEvidenceArtifact;
}

interface SmartSliceEvidenceInspectorSummary {
  presentCount: number;
  missingCount: number;
  totalCount: number;
  completedStepCount: number;
  totalStepCount: number;
  speechSegmentCount: number;
  semanticClipCount: number;
  reviewSegmentCount: number;
  selectedSegmentCount: number;
  manualEditCount: number;
  renderedSliceCount: number;
}

const SMART_SLICE_WORKFLOW_ID = 'smart-slice';
const SMART_SLICE_EVIDENCE_STEP_IDS = [
  'speech-to-text',
  'plan-clips',
  'human-review',
  'verify-artifacts',
] as const satisfies ReadonlyArray<SmartSliceEvidenceCheckpointStepId>;

const SMART_SLICE_EVIDENCE_PACKAGE_ITEMS = [
  {
    id: 'speech-to-text',
    title: 'Speech-to-text',
    stepId: 'speech-to-text',
    artifactKey: 'speechToTextEvidence',
    relativePath: 'evidence/speech-to-text.json',
    schema: 'smart-slice.speech-to-text.v1',
  },
  {
    id: 'semantic-segmentation',
    title: 'Semantic segmentation',
    stepId: 'plan-clips',
    artifactKey: 'semanticSegmentationEvidence',
    relativePath: 'evidence/semantic-segmentation.json',
    schema: 'smart-slice.semantic-segmentation.v1',
  },
  {
    id: 'review-session',
    title: 'Review session',
    stepId: 'human-review',
    artifactKey: 'reviewSessionEvidence',
    relativePath: 'evidence/review-session.json',
    schema: 'smart-slice.review-session.v1',
  },
  {
    id: 'manual-edits',
    title: 'Manual edits',
    stepId: 'human-review',
    artifactKey: 'manualEditsEvidence',
    relativePath: 'evidence/manual-edits.json',
    schema: 'smart-slice.manual-edits.v1',
  },
  {
    id: 'review-events',
    title: 'Review events',
    stepId: 'human-review',
    artifactKey: 'reviewEventsEvidence',
    relativePath: 'evidence/review-events.json',
    schema: 'smart-slice.review-events.v1',
  },
  {
    id: 'render-selection',
    title: 'Render selection',
    stepId: 'human-review',
    artifactKey: 'renderSelectionEvidence',
    relativePath: 'evidence/render-selection.json',
    schema: 'smart-slice.render-selection.v1',
  },
  {
    id: 'render-artifact-manifest',
    title: 'Render artifact manifest',
    stepId: 'verify-artifacts',
    artifactKey: 'renderArtifactManifestEvidence',
    relativePath: 'evidence/render-artifact-manifest.json',
    schema: 'smart-slice.render-artifact-manifest.v1',
  },
] as const satisfies ReadonlyArray<{
  id: string;
  title: string;
  stepId: SmartSliceEvidenceCheckpointStepId;
  artifactKey: string;
  relativePath: string;
  schema: string;
}>;

type SmartSliceEvidencePackageItem = (typeof SMART_SLICE_EVIDENCE_PACKAGE_ITEMS)[number];

function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return '0 Bytes';
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

function getTaskStatusLabel(status: AppTask['status']) {
  switch (status) {
    case AUTOCUT_TASK_STATUS.pending:
      return 'Pending';
    case AUTOCUT_TASK_STATUS.processing:
      return 'Processing';
    case AUTOCUT_TASK_STATUS.reviewing:
      return 'Review Ready';
    case AUTOCUT_TASK_STATUS.completed:
      return 'Completed';
    case AUTOCUT_TASK_STATUS.canceled:
      return 'Canceled';
    case AUTOCUT_TASK_STATUS.interrupted:
      return 'Interrupted';
    case AUTOCUT_TASK_STATUS.failed:
    default:
      return 'Failed';
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

function formatSliceScore(score: number | undefined) {
  return typeof score === 'number' && Number.isFinite(score) ? `${Math.round(score * 100)}%` : '--';
}

function formatSliceStoryShape(storyShape: SliceResult['storyShape']) {
  switch (storyShape) {
    case 'complete':
      return 'Complete';
    case 'setupOnly':
      return 'Setup only';
    case 'payoffOnly':
      return 'Payoff only';
    case 'contextOnly':
      return 'Context';
    case 'thin':
      return 'Thin';
    default:
      return '--';
  }
}

function formatSpeechContinuityGrade(grade: SliceResult['speechContinuityGrade']) {
  switch (grade) {
    case 'strong':
      return 'Strong';
    case 'repaired':
      return 'Repaired';
    case 'weak':
      return 'Weak';
    default:
      return '--';
  }
}

function formatPublishabilityGrade(grade: SliceResult['publishabilityGrade']) {
  switch (grade) {
    case 'excellent':
      return 'Excellent';
    case 'good':
      return 'Good';
    case 'review':
      return 'Review';
    case 'reject':
      return 'Reject';
    default:
      return '--';
  }
}

function formatPlatformReadinessGrade(grade: SliceResult['platformReadinessGrade']) {
  switch (grade) {
    case 'ready':
      return 'Ready';
    case 'review':
      return 'Review';
    case 'reject':
      return 'Reject';
    default:
      return '--';
  }
}

function formatSentenceBoundaryIntegrityGrade(grade: SliceResult['sentenceBoundaryIntegrityGrade']) {
  switch (grade) {
    case 'clean':
      return 'Clean';
    case 'repaired':
      return 'Repaired';
    case 'broken':
      return 'Broken';
    default:
      return '--';
  }
}

function formatSliceBoundaryGrade(grade: SliceResult['hookStrength'] | SliceResult['endingCompleteness']) {
  switch (grade) {
    case 'strong':
      return 'Strong';
    case 'contextual':
      return 'Contextual';
    case 'weak':
      return 'Weak';
    case 'complete':
      return 'Complete';
    case 'soft':
      return 'Soft';
    case 'open':
      return 'Open';
    default:
      return '--';
  }
}

function formatSliceContentArcGrade(grade: SliceResult['contentArcGrade']) {
  switch (grade) {
    case 'complete':
      return 'Complete';
    case 'partial':
      return 'Partial';
    case 'thin':
      return 'Thin';
    default:
      return '--';
  }
}

function formatSliceTopicCoherenceGrade(grade: SliceResult['topicCoherenceGrade']) {
  switch (grade) {
    case 'strong':
      return 'Strong';
    case 'mixed':
      return 'Mixed';
    case 'weak':
      return 'Weak';
    default:
      return '--';
  }
}

function formatSmartSliceBoundaryDecisionSource(source: SliceResult['boundaryDecisionSource']) {
  switch (source) {
    case 'transcript':
      return 'Transcript';
    case 'audio':
      return 'Audio activity';
    case 'combined':
      return 'Transcript + audio';
    default:
      return '--';
  }
}

function formatSmartSliceMilliseconds(milliseconds: number | undefined) {
  return typeof milliseconds === 'number' && Number.isFinite(milliseconds)
    ? `${Math.round(milliseconds)}ms`
    : '--';
}

function formatSmartSliceAudioCleanup(slice: SliceResult) {
  const parts = [
    slice.audioCleanupProfile ? `Profile ${slice.audioCleanupProfile}` : '',
    slice.noiseReductionApplied === undefined ? '' : slice.noiseReductionApplied ? 'Denoise on' : 'Denoise off',
    slice.audioActivityAnalysisFilter ? `Filter ${slice.audioActivityAnalysisFilter}` : '',
  ].filter(Boolean);

  return parts.length ? parts.join(' / ') : '--';
}

function createSmartSliceTaskSlicingLogicSummary(sliceResults: readonly SliceResult[]) {
  const transcriptEvidenceCount = sliceResults.filter((slice) =>
    slice.transcriptSegmentCount !== undefined ||
    slice.transcriptSegments?.length ||
    slice.transcriptText,
  ).length;
  const audioBoundaryCount = sliceResults.filter((slice) =>
    slice.boundaryDecisionSource ||
    slice.audioActivityStartMs !== undefined ||
    slice.audioActivityEndMs !== undefined ||
    slice.audioActivityConfidence !== undefined,
  ).length;
  const audioCleanupCount = sliceResults.filter((slice) =>
    slice.audioCleanupProfile ||
    slice.noiseReductionApplied !== undefined ||
    slice.audioActivityAnalysisFilter,
  ).length;
  const fallbackPlanCount = sliceResults.filter((slice) => slice.risks?.includes('fallback-plan')).length;
  const reviewIssueCount = sliceResults.filter((slice) => createSmartSliceReviewIssueCodes(slice).length > 0).length;

  return {
    transcriptEvidenceCount,
    audioBoundaryCount,
    audioCleanupCount,
    fallbackPlanCount,
    reviewIssueCount,
  };
}

function isTaskDetailRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readTaskDetailString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readTaskDetailFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function countTaskDetailArray(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function readSmartSliceCheckpointStepArtifact(
  task: AppTask,
  stepId: SmartSliceEvidenceCheckpointStepId,
) {
  const stepArtifact = task.executionCheckpoint?.artifacts[stepId];
  return isTaskDetailRecord(stepArtifact) ? stepArtifact : undefined;
}

function readSmartSliceEvidenceArtifact(
  task: AppTask,
  item: SmartSliceEvidencePackageItem,
): SmartSliceEvidenceArtifact | undefined {
  const stepArtifact = readSmartSliceCheckpointStepArtifact(task, item.stepId);
  const artifact = stepArtifact?.[item.artifactKey];
  if (!isTaskDetailRecord(artifact)) {
    return undefined;
  }

  const relativePath = readTaskDetailString(artifact.relativePath) ?? item.relativePath;
  const artifactPath = readTaskDetailString(artifact.artifactPath);
  const taskOutputDir = readTaskDetailString(artifact.taskOutputDir);
  const byteSize = readTaskDetailFiniteNumber(artifact.byteSize);
  const contentSha256 = readTaskDetailString(artifact.contentSha256);

  return {
    relativePath,
    ...(artifactPath ? { artifactPath } : {}),
    ...(taskOutputDir ? { taskOutputDir } : {}),
    ...(byteSize !== undefined ? { byteSize } : {}),
    ...(contentSha256 ? { contentSha256 } : {}),
  };
}

function readSmartSliceReviewSessionSegmentCount(task: AppTask) {
  if (task.sliceReviewSession) {
    return task.sliceReviewSession.segments.length;
  }

  const humanReviewArtifact = readSmartSliceCheckpointStepArtifact(task, 'human-review');
  const reviewSession = humanReviewArtifact?.reviewSession;
  return isTaskDetailRecord(reviewSession) ? countTaskDetailArray(reviewSession.segments) : 0;
}

function readSmartSliceReviewSessionSelectedCount(task: AppTask) {
  if (task.sliceReviewSession) {
    return task.sliceReviewSession.selectedSegmentIds.length;
  }

  const humanReviewArtifact = readSmartSliceCheckpointStepArtifact(task, 'human-review');
  const reviewSession = humanReviewArtifact?.reviewSession;
  return isTaskDetailRecord(reviewSession) ? countTaskDetailArray(reviewSession.selectedSegmentIds) : 0;
}

function readSmartSliceReviewSessionManualEditCount(task: AppTask) {
  if (task.sliceReviewSession) {
    return task.sliceReviewSession.manualEdits.length;
  }

  const humanReviewArtifact = readSmartSliceCheckpointStepArtifact(task, 'human-review');
  const reviewSession = humanReviewArtifact?.reviewSession;
  return isTaskDetailRecord(reviewSession) ? countTaskDetailArray(reviewSession.manualEdits) : 0;
}

function readSmartSliceSpeechSegmentCount(task: AppTask) {
  const speechArtifact = readSmartSliceCheckpointStepArtifact(task, 'speech-to-text');
  return countTaskDetailArray(speechArtifact?.transcriptSegments);
}

function readSmartSliceSemanticClipCount(task: AppTask) {
  const planArtifact = readSmartSliceCheckpointStepArtifact(task, 'plan-clips');
  return countTaskDetailArray(planArtifact?.plannedClips);
}

function readSmartSliceRenderedSliceCount(task: AppTask) {
  if (task.sliceResults?.length) {
    return task.sliceResults.length;
  }

  const verifyArtifact = readSmartSliceCheckpointStepArtifact(task, 'verify-artifacts');
  return countTaskDetailArray(verifyArtifact?.sliceResults);
}

function createSmartSliceEvidenceRowSummary(task: AppTask, item: SmartSliceEvidencePackageItem) {
  switch (item.id) {
    case 'speech-to-text':
      return `${readSmartSliceSpeechSegmentCount(task)} speech segments`;
    case 'semantic-segmentation':
      return `${readSmartSliceSemanticClipCount(task)} semantic clips`;
    case 'review-session':
      return `${readSmartSliceReviewSessionSegmentCount(task)} review segments`;
    case 'manual-edits':
      return `${readSmartSliceReviewSessionManualEditCount(task)} manual edits`;
    case 'review-events':
      return `${readSmartSliceReviewSessionManualEditCount(task)} replayable events`;
    case 'render-selection':
      return `${readSmartSliceReviewSessionSelectedCount(task)} selected segments`;
    case 'render-artifact-manifest':
      return `${readSmartSliceRenderedSliceCount(task)} rendered slices`;
  }
}

function createSmartSliceEvidenceInspectorRows(task: AppTask): {
  rows: SmartSliceEvidenceInspectorRow[];
  summary: SmartSliceEvidenceInspectorSummary;
} {
  const completedStepIds = new Set(task.executionCheckpoint?.completedStepIds ?? []);
  const completedEvidenceStepCount = SMART_SLICE_EVIDENCE_STEP_IDS.filter((stepId) => completedStepIds.has(stepId)).length;
  const rows = SMART_SLICE_EVIDENCE_PACKAGE_ITEMS.map((item) => {
    const artifact = readSmartSliceEvidenceArtifact(task, item);
    const stepCompleted = completedStepIds.has(item.stepId);
    return {
      item,
      present: Boolean(artifact),
      stepCompleted,
      summary: createSmartSliceEvidenceRowSummary(task, item),
      ...(artifact ? { artifact } : {}),
    };
  });

  return {
    rows,
    summary: {
      presentCount: rows.filter((row) => row.present).length,
      missingCount: rows.filter((row) => !row.present).length,
      totalCount: rows.length,
      completedStepCount: completedEvidenceStepCount,
      totalStepCount: SMART_SLICE_EVIDENCE_STEP_IDS.length,
      speechSegmentCount: readSmartSliceSpeechSegmentCount(task),
      semanticClipCount: readSmartSliceSemanticClipCount(task),
      reviewSegmentCount: readSmartSliceReviewSessionSegmentCount(task),
      selectedSegmentCount: readSmartSliceReviewSessionSelectedCount(task),
      manualEditCount: readSmartSliceReviewSessionManualEditCount(task),
      renderedSliceCount: readSmartSliceRenderedSliceCount(task),
    },
  };
}

function shouldRenderSmartSliceEvidenceInspector(task: AppTask) {
  if (task.type !== AUTOCUT_TASK_TYPE.videoSlice) {
    return false;
  }

  if (task.executionCheckpoint?.workflowId === SMART_SLICE_WORKFLOW_ID) {
    return true;
  }

  return createSmartSliceEvidenceInspectorRows(task).rows.some((row) => row.present);
}

function formatSmartSliceEvidenceHash(hash: string | undefined) {
  return hash ? hash.slice(0, 12) : '--';
}

function formatSmartSliceEvidenceByteSize(bytes: number | undefined) {
  return bytes === undefined ? '--' : formatBytes(bytes);
}

function formatSmartSliceReviewRiskFallbackTitle(risk: string) {
  return risk
    .split('-')
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ') || 'Review risk';
}

function getSmartSliceReviewRiskDefinition(risk: string) {
  return AUTOCUT_SMART_SLICE_REVIEW_RISK_CATALOG[
    risk as keyof typeof AUTOCUT_SMART_SLICE_REVIEW_RISK_CATALOG
  ];
}

function isSmartSliceReviewSentenceBoundaryIssue(issue: string) {
  return !issue.startsWith('sentence-clean-') && !issue.endsWith('-repaired');
}

function createSmartSliceReviewIssueCodes(slice: SliceResult) {
  const codes = [
    ...(slice.risks ?? []),
    ...(slice.publishabilityIssues ?? []),
    ...(slice.platformReadinessIssues ?? []),
    ...(slice.sentenceBoundaryIssues ?? []).filter(isSmartSliceReviewSentenceBoundaryIssue),
  ];
  return [...new Set(codes)].filter(Boolean);
}

function formatSliceSourceRange(startMs: number | undefined, endMs: number | undefined) {
  if (typeof startMs !== 'number' || typeof endMs !== 'number') {
    return '--';
  }

  return `${Math.round(startMs / 1_000)}s - ${Math.round(endMs / 1_000)}s`;
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

function formatSliceRelativeTranscriptTimestamp(milliseconds: number | undefined) {
  return formatSliceTranscriptTimestamp(milliseconds);
}

function formatSliceSourceTranscriptTimestamp(milliseconds: number | undefined) {
  return formatSliceTranscriptTimestamp(milliseconds);
}

function formatTaskExecutionDuration(durationMs: number | undefined) {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs)) {
    return '--';
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

function createTaskExecutionLogClipboardText(log: TaskExecutionLog) {
  const detailsJson = log.details ? normalizeTaskDetailDisplayText(JSON.stringify(log.details, null, 2)) : '';
  return [
    `Severity: ${normalizeTaskDetailDisplayText(log.severity || 'info') || 'info'}`,
    log.stepId ? `Step: ${normalizeTaskDetailDisplayText(log.stepId)}` : '',
    log.phase ? `Phase: ${normalizeTaskDetailDisplayText(log.phase)}` : '',
    log.source ? `Source: ${normalizeTaskDetailDisplayText(log.source)}` : '',
    log.progress !== undefined ? `Progress: ${Math.round(log.progress)}%` : '',
    `Timestamp: ${formatAutoCutDateTime(log.timestamp)}`,
    `Message: ${normalizeTaskDetailDisplayText(log.message)}`,
    detailsJson ? '' : '',
    detailsJson ? 'Details:' : '',
    detailsJson,
  ].filter(Boolean).join('\n');
}

function hasSliceReviewMetadata(slice: SliceResult) {
  return Boolean(
    slice.summary ||
      slice.reason ||
      slice.transcriptText ||
      slice.transcriptSegments?.length ||
      slice.transcriptSegmentCount !== undefined ||
      slice.qualityScore !== undefined ||
      slice.continuityScore !== undefined ||
      slice.publishabilityScore !== undefined ||
      slice.publishabilityGrade ||
      slice.publishabilityIssues?.length ||
      slice.platformReadinessScore !== undefined ||
      slice.platformReadinessGrade ||
      slice.platformReadinessIssues?.length ||
      slice.sentenceBoundaryIntegrityScore !== undefined ||
      slice.sentenceBoundaryIntegrityGrade ||
      slice.sentenceBoundaryIssues?.length ||
      slice.boundaryQualityScore !== undefined ||
      slice.hookStrength ||
      slice.endingCompleteness ||
      slice.contentArcScore !== undefined ||
      slice.contentArcGrade ||
      slice.contentArcStages?.length ||
      slice.contentArcMissingStages?.length ||
      slice.topicCoherenceScore !== undefined ||
      slice.topicCoherenceGrade ||
      slice.topicShiftCount !== undefined ||
      slice.topicKeywords?.length ||
      slice.transcriptCoverageScore !== undefined ||
      slice.transcriptSegmentCount !== undefined ||
      slice.speechContinuityGrade ||
      slice.storyShape ||
      slice.sourceStartMs !== undefined ||
      slice.speechStartMs !== undefined ||
      slice.boundaryPaddingBeforeMs !== undefined ||
      slice.boundaryPaddingAfterMs !== undefined ||
      slice.transcriptCorrection ||
      createSmartSliceReviewIssueCodes(slice).length,
  );
}

function formatSliceTranscriptFile(slice: SliceResult) {
  const header = [
    `Slice: ${slice.title || slice.name}`,
    `Source: ${formatSliceSourceRange(slice.sourceStartMs, slice.sourceEndMs)}`,
    `Speech: ${formatSliceSourceRange(slice.speechStartMs, slice.speechEndMs)}`,
    '',
  ];
  const segmentLines = slice.transcriptSegments?.length
    ? slice.transcriptSegments.map((segment) => {
        const speaker = segment.speaker?.trim() || 'Speaker';
        const relativeStartMs = segment.startMs - (slice.sourceStartMs ?? 0);
        const relativeEndMs = segment.endMs - (slice.sourceStartMs ?? 0);
        return `[slice ${formatSliceRelativeTranscriptTimestamp(relativeStartMs)} - ${formatSliceRelativeTranscriptTimestamp(relativeEndMs)} | source ${formatSliceSourceTranscriptTimestamp(segment.startMs)} - ${formatSliceSourceTranscriptTimestamp(segment.endMs)}] ${speaker}: ${segment.text}`;
      })
    : slice.transcriptText
      ? [slice.transcriptText]
      : [];

  return [...header, ...segmentLines].join('\n');
}

function formatSliceTranscriptText(slice: SliceResult) {
  if (slice.transcriptSegments?.length) {
    return slice.transcriptSegments
      .map((segment) => segment.text.trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  return slice.transcriptText?.trim() ?? '';
}

function createTranscriptDraft(slice: SliceResult): TranscriptDraftState {
  const segments = slice.transcriptSegments?.map((segment) => ({ ...segment })) ?? [];
  return {
    sliceId: slice.id,
    mode: segments.length ? 'segments' : 'text',
    text: slice.transcriptText?.trim() ?? '',
    segments,
  };
}

function normalizeTranscriptDraftText(value: string) {
  return value.trim().replace(/\s+/gu, ' ');
}

function hasTranscriptDraftChanges(slice: SliceResult, draft: TranscriptDraftState | null) {
  if (!draft || draft.sliceId !== slice.id) {
    return false;
  }

  if (draft.mode === 'segments') {
    const currentSegments = slice.transcriptSegments ?? [];
    if (currentSegments.length !== draft.segments.length) {
      return true;
    }

    return draft.segments.some((segment, index) =>
      normalizeTranscriptDraftText(segment.text) !== normalizeTranscriptDraftText(currentSegments[index]?.text ?? '') ||
      normalizeTranscriptDraftText(segment.speaker ?? '') !== normalizeTranscriptDraftText(currentSegments[index]?.speaker ?? '')
    );
  }

  return normalizeTranscriptDraftText(draft.text) !== normalizeTranscriptDraftText(slice.transcriptText ?? '');
}

function downloadTaskExecutionResultFile(task: AppTask, taskTypeLabel: string) {
  const normalizedTaskName = normalizeTaskDetailDisplayText(task.name) || task.name;
  const normalizedTaskTypeLabel = normalizeTaskDetailDisplayText(taskTypeLabel) || taskTypeLabel;
  const normalizedProgressMessage = normalizeTaskDetailDisplayText(task.progressMessage);
  const normalizedErrorMessage = normalizeTaskDetailDisplayText(task.errorMessage);
  const content = [
    `Task: ${normalizedTaskName}`,
    `Type: ${normalizedTaskTypeLabel}`,
    `Status: ${task.status}`,
    `Progress: ${task.progress}%`,
    normalizedProgressMessage ? `Progress message: ${normalizedProgressMessage}` : '',
    task.completedAt ? `Completed at: ${formatAutoCutDateTime(task.completedAt)}` : '',
    task.resultCount !== undefined ? `Result count: ${task.resultCount}` : '',
    normalizedErrorMessage ? `Error: ${normalizedErrorMessage}` : '',
  ].filter(Boolean).join('\n');
  const { url } = createAutoCutTextObjectUrl(content);
  try {
    downloadAutoCutUrl(url, `${normalizedTaskName}_result.txt`);
  } finally {
    revokeAutoCutObjectUrl(url);
  }
}

function handleDownloadSmartSliceTaskEvidence(task: AppTask) {
  const normalizedTaskName = normalizeTaskDetailDisplayText(task.name) || task.name;
  downloadSmartSliceTaskEvidenceFile(task, `${normalizedTaskName}_smart-slice-task.json`);
}

function downloadSliceTranscriptFile(slice: SliceResult) {
  const { url } = createAutoCutTextObjectUrl(formatSliceTranscriptFile(slice));
  try {
    downloadAutoCutUrl(url, `${slice.name}_transcript.txt`);
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

export function TaskDetailPage() {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [task, setTask] = useState<AppTask | null>(null);
  const [activePreviewUrl, setActivePreviewUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [transcriptDraft, setTranscriptDraft] = useState<TranscriptDraftState | null>(null);
  const [transcriptFeedback, setTranscriptFeedback] = useState<string | null>(null);
  const [isSavingTranscript, setIsSavingTranscript] = useState(false);
  const [showSlicingLogic, setShowSlicingLogic] = useState(false);
  const [copiedSmartSliceEvidenceItemId, setCopiedSmartSliceEvidenceItemId] = useState<string | null>(null);
  const [showAllExecutionLogs, setShowAllExecutionLogs] = useState(false);
  const [showExecutionDetails, setShowExecutionDetails] = useState(false);
  const [selectedExecutionStepId, setSelectedExecutionStepId] = useState<string | null | undefined>(undefined);
  const [isCancelingTask, setIsCancelingTask] = useState(false);
  const [resumingStepId, setResumingStepId] = useState<string | null>(null);
  const lastExecutionTaskIdRef = useRef<string | null>(null);

  const handleSlicePreviewSelect = (sliceId: string) => {
    setActivePreviewUrl(sliceId);
    setTranscriptFeedback(null);
    setTranscriptDraft((draft) => draft?.sliceId === sliceId ? draft : null);
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

  const copySmartSliceEvidenceArtifactPath = async (
    item: SmartSliceEvidencePackageItem,
    artifact: SmartSliceEvidenceArtifact,
  ) => {
    const artifactPath = artifact.artifactPath ?? artifact.relativePath;
    try {
      await writeAutoCutClipboardText(artifactPath);
      setCopiedSmartSliceEvidenceItemId(item.id);
      window.setTimeout(() => {
        setCopiedSmartSliceEvidenceItemId((copiedItemId) => copiedItemId === item.id ? null : copiedItemId);
      }, 1800);
    } catch (error) {
      reportAutoCutDiagnostic(
        'warning',
        'task-detail.copy-smart-slice-evidence-path',
        'Copy Smart Slice evidence artifact path failed.',
        error,
      );
    }
  };

  const openSmartSliceEvidenceArtifactLocation = async (artifact: SmartSliceEvidenceArtifact) => {
    if (!artifact.artifactPath) {
      return;
    }

    try {
      await openAutoCutNativeArtifactInFolder(artifact.artifactPath, artifact.taskOutputDir);
    } catch (error) {
      reportAutoCutDiagnostic(
        'warning',
        'task-detail.open-smart-slice-evidence-folder',
        'Open Smart Slice evidence artifact location failed.',
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

  const showTranscriptFeedback = (message: string) => {
    setTranscriptFeedback(message);
    window.setTimeout(() => setTranscriptFeedback(null), 1800);
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

  const handleCopyTranscriptText = async (text: string, feedback: string) => {
    const normalizedText = text.trim();
    if (!normalizedText) {
      return;
    }

    try {
      await writeAutoCutClipboardText(normalizedText);
      showTranscriptFeedback(feedback);
    } catch (error) {
      reportAutoCutDiagnostic(
        'warning',
        'task-detail.copy-transcript',
        'Copy transcript text failed.',
        error,
      );
      showTranscriptFeedback(t('taskDetail.transcript.copyFailed'));
    }
  };

  const handleStartTranscriptEdit = (slice: SliceResult) => {
    setTranscriptDraft(createTranscriptDraft(slice));
    setTranscriptFeedback(null);
  };

  const handleTranscriptSegmentTextChange = (index: number, text: string) => {
    setTranscriptDraft((draft) => {
      if (!draft || draft.mode !== 'segments') {
        return draft;
      }

      return {
        ...draft,
        segments: draft.segments.map((segment, segmentIndex) =>
          segmentIndex === index ? { ...segment, text } : segment,
        ),
      };
    });
  };

  const handleTranscriptTextChange = (text: string) => {
    setTranscriptDraft((draft) => draft ? { ...draft, text } : draft);
  };

  const handleCancelTranscriptEdit = () => {
    setTranscriptDraft(null);
    setTranscriptFeedback(null);
  };

  const handleSaveTranscriptEdit = async (slice: SliceResult) => {
    if (!task || !transcriptDraft || transcriptDraft.sliceId !== slice.id) {
      return;
    }

    try {
      setIsSavingTranscript(true);
      await updateTaskSliceTranscript(
        task.id,
        slice.id,
        transcriptDraft.mode === 'segments'
          ? transcriptDraft.segments
          : { transcriptText: transcriptDraft.text },
      );
      setTranscriptDraft(null);
      showTranscriptFeedback(t('taskDetail.transcript.saved'));
    } catch (error) {
      reportAutoCutDiagnostic(
        'error',
        'task-detail.save-transcript',
        'Save corrected transcript failed.',
        error,
      );
      showTranscriptFeedback(t('taskDetail.transcript.saveFailed'));
    } finally {
      setIsSavingTranscript(false);
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
      setShowAllExecutionLogs(false);
      setShowExecutionDetails(false);
      lastExecutionTaskIdRef.current = null;
      return;
    }

    if (lastExecutionTaskIdRef.current !== task.id) {
      lastExecutionTaskIdRef.current = task.id;
      setSelectedExecutionStepId(undefined);
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

  if (!task) {
    return (
      <div className="w-full h-full p-10 flex flex-col items-center justify-center text-gray-400">
        <p>Task not found or it has been deleted.</p>
        <Button className="mt-4" onClick={() => navigate('/tasks')}>Back to task list</Button>
      </div>
    );
  }

  const normalizedTaskName = normalizeTaskDetailDisplayText(task.name) || task.name;
  const normalizedTaskProgressMessage = normalizeTaskDetailDisplayText(task.progressMessage);
  const normalizedTaskErrorMessage = normalizeTaskDetailDisplayText(task.errorMessage);

  const renderSmartSliceEvidenceInspector = () => {
    if (!shouldRenderSmartSliceEvidenceInspector(task)) {
      return null;
    }

    const { rows, summary } = createSmartSliceEvidenceInspectorRows(task);
    const missingRows = rows.filter((row) => !row.present);

    return (
      <div className="shrink-0 rounded-lg border border-[#222] bg-[#101010] shadow-xl shadow-black/20">
        <div className="flex flex-col gap-3 border-b border-[#222] px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-gray-100">
              <FileText size={14} className="text-emerald-300" />
              Smart Slice Evidence Inspector
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
              <span className="rounded border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-emerald-200">
                {summary.presentCount}/{summary.totalCount} evidence files
              </span>
              <span className="rounded border border-blue-500/20 bg-blue-500/10 px-2 py-1 text-blue-200">
                {summary.completedStepCount}/{summary.totalStepCount} checkpoint steps
              </span>
              <span className="rounded border border-[#333] bg-[#0A0A0A] px-2 py-1">
                STT {summary.speechSegmentCount}
              </span>
              <span className="rounded border border-[#333] bg-[#0A0A0A] px-2 py-1">
                Clips {summary.semanticClipCount}
              </span>
              <span className="rounded border border-[#333] bg-[#0A0A0A] px-2 py-1">
                Review {summary.reviewSegmentCount}/{summary.selectedSegmentCount}
              </span>
              <span className="rounded border border-[#333] bg-[#0A0A0A] px-2 py-1">
                Edits {summary.manualEditCount}
              </span>
              <span className="rounded border border-[#333] bg-[#0A0A0A] px-2 py-1">
                Rendered {summary.renderedSliceCount}
              </span>
              {missingRows.length > 0 && (
                <span className="rounded border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-amber-200">
                  Missing {summary.missingCount}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            className="inline-flex h-8 w-fit shrink-0 items-center gap-1.5 rounded border border-emerald-500/30 bg-emerald-500/10 px-3 text-xs text-emerald-200 transition-colors hover:bg-emerald-500/15"
            onClick={() => handleDownloadSmartSliceTaskEvidence(task)}
          >
            <Download size={13} /> Task JSON
          </button>
        </div>

        <div className="grid gap-2 p-3 lg:grid-cols-2 2xl:grid-cols-3">
          {rows.map((row) => {
            const artifactPath = row.artifact?.artifactPath ?? row.artifact?.relativePath ?? row.item.relativePath;
            return (
              <div
                key={row.item.id}
                className={`rounded border px-3 py-2 ${
                  row.present
                    ? 'border-[#2A2A2A] bg-[#0A0A0A]'
                    : 'border-amber-500/20 bg-amber-500/5'
                }`}
              >
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      {row.present ? (
                        <CheckCircle2 size={13} className="shrink-0 text-emerald-300" />
                      ) : (
                        <AlertTriangle size={13} className="shrink-0 text-amber-300" />
                      )}
                      <h3 className="truncate text-xs font-semibold text-gray-100">{row.item.title}</h3>
                    </div>
                    <p className="mt-1 truncate font-mono text-[10px] text-cyan-200">{row.item.relativePath}</p>
                  </div>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
                    row.present ? 'bg-emerald-500/10 text-emerald-200' : 'bg-amber-500/10 text-amber-200'
                  }`}>
                    {row.present ? 'Ready' : row.stepCompleted ? 'Missing' : 'Pending'}
                  </span>
                </div>

                <div className="mt-2 grid gap-1 text-[10px] text-gray-500 sm:grid-cols-2">
                  <span className="truncate">Schema: <span className="text-gray-300">{row.item.schema}</span></span>
                  <span className="truncate">Summary: <span className="text-gray-300">{row.summary}</span></span>
                  <span className="truncate">Size: <span className="text-gray-300">{formatSmartSliceEvidenceByteSize(row.artifact?.byteSize)}</span></span>
                  <span className="truncate">SHA: <span className="font-mono text-gray-300">{formatSmartSliceEvidenceHash(row.artifact?.contentSha256)}</span></span>
                </div>

                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    title="Copy artifact path"
                    aria-label={`Copy ${row.item.title} artifact path`}
                    disabled={!row.present}
                    className="inline-flex h-7 items-center gap-1 rounded border border-[#333] bg-[#101010] px-2 text-[11px] text-cyan-300 transition-colors hover:border-cyan-500/40 hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => {
                      if (row.artifact) {
                        void copySmartSliceEvidenceArtifactPath(row.item, row.artifact);
                      }
                    }}
                  >
                    <Copy size={12} /> {copiedSmartSliceEvidenceItemId === row.item.id ? 'Copied' : 'Copy path'}
                  </button>
                  <button
                    type="button"
                    title="Open artifact location"
                    aria-label={`Open ${row.item.title} artifact location`}
                    disabled={!row.artifact?.artifactPath}
                    className="inline-flex h-7 items-center gap-1 rounded border border-[#333] bg-[#101010] px-2 text-[11px] text-blue-300 transition-colors hover:border-blue-500/40 hover:bg-blue-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => {
                      if (row.artifact) {
                        void openSmartSliceEvidenceArtifactLocation(row.artifact);
                      }
                    }}
                  >
                    <FolderOpen size={12} /> Reveal
                  </button>
                </div>

                <p className="mt-2 truncate font-mono text-[10px] text-gray-600">{artifactPath}</p>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderContent = () => {
    if (task.status === AUTOCUT_TASK_STATUS.failed) {
      return (
        <div className="flex min-h-full flex-col gap-4">
          {renderSmartSliceEvidenceInspector()}
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
          {renderSmartSliceEvidenceInspector()}
          <div className="flex-1 flex flex-col items-center justify-center border border-[#222] border-dashed rounded-xl bg-[#111] text-gray-500">
            <CircleStop size={48} className="mx-auto mb-4 opacity-40 text-amber-300" />
            <p className="text-lg text-gray-300">{normalizedTaskProgressMessage || getTaskStatusLabel(task.status)}</p>
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
          {renderSmartSliceEvidenceInspector()}
          <div className="flex-1 flex flex-col items-center justify-center border border-cyan-500/20 border-dashed rounded-xl bg-cyan-500/5 px-6 text-center text-gray-400">
            <Scissors size={48} className="mx-auto mb-4 text-cyan-300" />
            <h2 className="text-xl font-semibold text-cyan-100">Segment Review Workbench is ready</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-gray-400">
              Review the analyzed Smart Slice plan, manually select export segments, split or merge boundaries, and remove duplicate content before rendering.
            </p>
            <div className="mt-5 grid w-full max-w-md grid-cols-3 gap-2">
              <div className="rounded border border-[#252525] bg-[#101010] px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Segments</div>
                <div className="mt-1 text-sm font-semibold text-gray-100">{reviewSegmentCount}</div>
              </div>
              <div className="rounded border border-[#252525] bg-[#101010] px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Selected</div>
                <div className="mt-1 text-sm font-semibold text-emerald-200">{selectedSegmentCount}</div>
              </div>
              <div className="rounded border border-[#252525] bg-[#101010] px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Duplicates</div>
                <div className="mt-1 text-sm font-semibold text-amber-200">{duplicateGroupCount}</div>
              </div>
            </div>
            <Button
              className="mt-6 bg-cyan-600 hover:bg-cyan-500"
              onClick={() => navigate(`/slicer?reviewTaskId=${encodeURIComponent(task.id)}`)}
            >
              <Scissors size={16} className="mr-2" /> Open review workbench
            </Button>
          </div>
        </div>
      );
    }

    if (task.status !== AUTOCUT_TASK_STATUS.completed) {
      return (
        <div className="flex min-h-full flex-col gap-4">
          {renderSmartSliceEvidenceInspector()}
          <div className="flex-1 flex flex-col items-center justify-center border border-[#222] border-dashed rounded-xl bg-[#111] text-gray-500">
            <Activity size={48} className="mx-auto mb-4 opacity-30 animate-pulse" />
            <p className="text-lg text-gray-300">{normalizeTaskDetailDisplayText(task.progressMessage) || 'Task is processing...'}</p>
            <div className="w-64 h-2 bg-[#222] rounded-full mt-4 overflow-hidden">
               <div className="h-full bg-blue-500 transition-all duration-300 relative" style={{ width: `${task.progress || 0}%` }}>
                  <div className="absolute inset-0 bg-white/20 animate-pulse" />
               </div>
            </div>
            <p className="text-xs text-blue-400 mt-2 font-mono">{task.progress || 0}%</p>
          </div>
        </div>
      );
    }

    if (task.type === AUTOCUT_TASK_TYPE.videoSlice) {
      const sliceResults = task.sliceResults || [];
      const selectedSlice = sliceResults.find((slice) => slice.id === activePreviewUrl) ?? sliceResults[0] ?? null;
      const selectedSliceReviewIssueCodes = selectedSlice ? createSmartSliceReviewIssueCodes(selectedSlice) : [];
      const smartSliceTaskSlicingLogicSummary = createSmartSliceTaskSlicingLogicSummary(sliceResults);
      return (
          <div className="flex h-full min-h-0 flex-1 flex-col gap-4">
          {renderSmartSliceEvidenceInspector()}
          <div className="flex flex-col xl:flex-row gap-6 flex-1 min-h-0">
            {/* Left: File List */}
            <div className="w-full xl:w-[30%] flex flex-col border border-[#222] rounded-xl bg-[#111] overflow-hidden shrink-0">
              <div className="p-4 border-b border-[#222] bg-[#151515] flex justify-between items-center shrink-0">
                <h3 className="text-sm font-bold text-gray-200">Generated slices ({task.resultCount || 0})</h3>
                <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-gray-500">
                  <button
                    type="button"
                    aria-expanded={showSlicingLogic}
                    aria-controls="task-detail-slicing-logic"
                    disabled={sliceResults.length === 0}
                    className={`inline-flex items-center gap-1 rounded border px-2 py-1 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      showSlicingLogic
                        ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200'
                        : 'border-[#333] bg-[#101010] text-cyan-300 hover:border-cyan-500/40 hover:bg-cyan-500/10'
                    }`}
                    onClick={() => setShowSlicingLogic((visible) => !visible)}
                  >
                    <FileText size={12} /> {t('taskDetail.slicingLogic.title', { defaultValue: 'Slicing logic' })}
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded border border-[#333] bg-[#101010] px-2 py-1 text-emerald-300 hover:border-emerald-500/40 hover:bg-emerald-500/10 transition-colors"
                    onClick={() => handleDownloadSmartSliceTaskEvidence(task)}
                  >
                    <Download size={12} /> Quality JSON
                  </button>
                  <span className="inline-flex items-center gap-1"><Settings2 size={14} /> Duration order</span>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
                {sliceResults.map((slice) => (
                  <div
                    key={slice.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border transition-all cursor-pointer group ${
                      activePreviewUrl === slice.id
                        ? 'border-blue-500/50 bg-blue-500/10'
                        : 'border-[#222] bg-[#1A1A1A] hover:border-[#444] hover:bg-[#222]'
                    }`}
                    onClick={() => handleSlicePreviewSelect(slice.id)}
                  >
                    <div className="w-24 h-16 bg-black rounded shadow-inner overflow-hidden relative shrink-0 border border-[#333]">
                      <img src={slice.thumbnailUrl} alt="" loading="lazy" decoding="async" className="task-detail-slice-thumbnail-media w-full h-full object-contain opacity-70" />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
                         <PlayCircle size={24} className={activePreviewUrl === slice.id ? 'text-blue-400' : 'text-white'} />
                      </div>
                      <span className="absolute bottom-1 right-1 bg-black/80 px-1 rounded text-[9px] font-mono text-gray-300">
                        00:{String(slice.duration).padStart(2, '0')}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col justify-center">
                      <h4 className={`text-sm font-medium truncate ${activePreviewUrl === slice.id ? 'text-blue-400' : 'text-gray-200'}`}>
                        {slice.title || slice.name}
                      </h4>
                      <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-500">
                        <span className="flex items-center gap-1"><Tag size={10} /> Smart Slice</span>
                        <span>{formatBytes(slice.size)}</span>
                        <span className="bg-[#333] px-1 rounded">{slice.resolution}</span>
                      </div>
                      {(slice.qualityScore !== undefined || slice.continuityScore !== undefined) && (
                        <div className="flex flex-wrap items-center gap-1.5 mt-2 text-[10px]">
                          {slice.publishabilityGrade && (
                            <span className="px-1.5 py-0.5 rounded bg-fuchsia-500/10 text-fuchsia-300 border border-fuchsia-500/20">
                              P {formatPublishabilityGrade(slice.publishabilityGrade)}
                            </span>
                          )}
                          <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                            Q {formatSliceScore(slice.qualityScore)}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20">
                            C {formatSliceScore(slice.continuityScore)}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 flex items-center gap-1">
                      {slice.artifactPath && (
                        <button className="w-8 h-8 rounded hover:bg-black/50 flex items-center justify-center text-gray-400 hover:text-white transition-colors" onClick={(e) => {
                           e.stopPropagation();
                           void handleOpenSliceArtifactInFolder(slice);
                        }}>
                          <FolderOpen size={14} />
                        </button>
                      )}
                      <button className="w-8 h-8 rounded hover:bg-black/50 flex items-center justify-center text-gray-400 hover:text-white transition-colors" onClick={(e) => {
                         e.stopPropagation();
                         handleDownload(slice.url, slice.name);
                      }}>
                        <Download size={14} />
                      </button>
                    </div>
                  </div>
                ))}
                {sliceResults.length === 0 && (
                  <div className="h-40 flex items-center justify-center text-gray-500 text-sm">
                    No generated files yet.
                  </div>
                )}
              </div>
            </div>

            {/* Right: Player Preview */}
            <div className="flex-1 min-w-0 bg-[#111] rounded-xl border border-[#222] flex flex-col relative overflow-hidden group">
               {selectedSlice ? (
                 <div className="w-full h-full min-h-0 flex flex-col">
                   <div className="shrink-0 border-b border-[#222] bg-[#151515] px-4 py-3 flex items-center gap-2">
                     <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                       <CheckCircle2 size={14} className="text-blue-400 shrink-0" />
                       <span className="text-[11px] text-white">Previewing: {selectedSlice.name}</span>
                     </div>
                   </div>
                   <TaskVideoPreview src={selectedSlice.url} title={selectedSlice.title || selectedSlice.name} videoKey={selectedSlice.id} />
                   {showSlicingLogic ? (
                    <div id="task-detail-slicing-logic" className="shrink-0 max-h-[46%] overflow-y-auto border-t border-[#222] bg-[#151515] p-4 space-y-3 custom-scrollbar">
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div className="min-w-0">
                          <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-gray-100">
                            <Activity size={14} className="text-cyan-300" />
                            {t('taskDetail.slicingLogic.title', { defaultValue: 'Slicing logic' })}
                          </h3>
                          <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
                            {t('taskDetail.slicingLogic.summary', {
                              defaultValue: 'Smart slicing generates candidate clips from transcript semantics, content arc, topic coherence, publishability standards, and audio activity boundaries.',
                            })}
                          </p>
                        </div>
                        <span className="inline-flex w-fit items-center gap-1 rounded border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-[11px] text-cyan-200">
                          <Settings2 size={12} />
                          {t('taskDetail.slicingLogic.sliceCount', { defaultValue: 'Slice count' })}: {sliceResults.length}
                        </span>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                        <div className="rounded border border-[#2A2A2A] bg-[#101010] px-2.5 py-2">
                          <p className="text-[10px] uppercase text-gray-500">Transcript evidence</p>
                          <p className="mt-1 text-sm font-semibold text-cyan-200">{smartSliceTaskSlicingLogicSummary.transcriptEvidenceCount}/{sliceResults.length}</p>
                        </div>
                        <div className="rounded border border-[#2A2A2A] bg-[#101010] px-2.5 py-2">
                          <p className="text-[10px] uppercase text-gray-500">Audio boundary</p>
                          <p className="mt-1 text-sm font-semibold text-blue-200">{smartSliceTaskSlicingLogicSummary.audioBoundaryCount}/{sliceResults.length}</p>
                        </div>
                        <div className="rounded border border-[#2A2A2A] bg-[#101010] px-2.5 py-2">
                          <p className="text-[10px] uppercase text-gray-500">Audio cleanup</p>
                          <p className="mt-1 text-sm font-semibold text-emerald-200">{smartSliceTaskSlicingLogicSummary.audioCleanupCount}/{sliceResults.length}</p>
                        </div>
                        <div className="rounded border border-[#2A2A2A] bg-[#101010] px-2.5 py-2">
                          <p className="text-[10px] uppercase text-gray-500">Review risks</p>
                          <p className="mt-1 text-sm font-semibold text-amber-200">{smartSliceTaskSlicingLogicSummary.reviewIssueCount}/{sliceResults.length}</p>
                        </div>
                        <div className="rounded border border-[#2A2A2A] bg-[#101010] px-2.5 py-2">
                          <p className="text-[10px] uppercase text-gray-500">Fallback plan</p>
                          <p className="mt-1 text-sm font-semibold text-rose-200">{smartSliceTaskSlicingLogicSummary.fallbackPlanCount}/{sliceResults.length}</p>
                        </div>
                      </div>

                      <div className="space-y-2">
                        {sliceResults.map((slice, index) => {
                          const issueCodes = createSmartSliceReviewIssueCodes(slice);
                          const transcriptSegmentCount = slice.transcriptSegmentCount ?? slice.transcriptSegments?.length;

                          return (
                            <div
                              key={slice.id}
                              role="button"
                              tabIndex={0}
                              className={`rounded border px-3 py-2 text-left transition-colors ${
                                selectedSlice.id === slice.id
                                  ? 'border-cyan-500/40 bg-cyan-500/10'
                                  : 'border-[#2A2A2A] bg-[#101010] hover:border-[#444] hover:bg-[#181818]'
                              }`}
                              onClick={() => handleSlicePreviewSelect(slice.id)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  handleSlicePreviewSelect(slice.id);
                                }
                              }}
                            >
                              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                                <div className="min-w-0">
                                  <div className="flex min-w-0 items-center gap-2">
                                    <span className="rounded bg-[#222] px-1.5 py-0.5 font-mono text-[10px] text-gray-300">#{index + 1}</span>
                                    <h4 className="truncate text-xs font-semibold text-gray-100">{slice.title || slice.name}</h4>
                                  </div>
                                  <p className="mt-1 text-[11px] text-gray-500">
                                    Source {formatSliceSourceRange(slice.sourceStartMs, slice.sourceEndMs)} / Speech {formatSliceSourceRange(slice.speechStartMs, slice.speechEndMs)}
                                  </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-1 text-[10px] text-gray-400">
                                  <span className="rounded border border-sky-500/20 bg-sky-500/10 px-1.5 py-0.5 text-sky-200">
                                    Boundary {formatSmartSliceBoundaryDecisionSource(slice.boundaryDecisionSource)}
                                  </span>
                                  <span className="rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-200">
                                    Cleanup {formatSmartSliceAudioCleanup(slice)}
                                  </span>
                                </div>
                              </div>
                              <p className="mt-2 text-xs leading-relaxed text-gray-300">
                                {slice.reason || t('taskDetail.slicingLogic.reasonUnavailable', {
                                  defaultValue: 'This slice has no dedicated AI selection reason. Review the semantic, boundary, and risk evidence below.',
                                })}
                              </p>
                              {slice.summary && (
                                <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{slice.summary}</p>
                              )}
                              <div className="mt-2 grid gap-1.5 text-[10px] text-gray-400 sm:grid-cols-2 xl:grid-cols-4">
                                <span className="rounded border border-teal-500/20 bg-teal-500/10 px-1.5 py-1 text-teal-200">
                                  Arc {formatSliceScore(slice.contentArcScore)} / {formatSliceContentArcGrade(slice.contentArcGrade)}
                                </span>
                                <span className="rounded border border-indigo-500/20 bg-indigo-500/10 px-1.5 py-1 text-indigo-200">
                                  Topic {formatSliceScore(slice.topicCoherenceScore)} / {formatSliceTopicCoherenceGrade(slice.topicCoherenceGrade)}
                                </span>
                                <span className="rounded border border-cyan-500/20 bg-cyan-500/10 px-1.5 py-1 text-cyan-200">
                                  Transcript {transcriptSegmentCount ?? '--'}
                                </span>
                                <span className="rounded border border-slate-500/20 bg-slate-500/10 px-1.5 py-1 text-slate-200">
                                  Silence {formatSmartSliceMilliseconds(slice.leadingSilenceMs)} + {formatSmartSliceMilliseconds(slice.trailingSilenceMs)}
                                </span>
                              </div>
                              {(slice.topicKeywords?.length || issueCodes.length) ? (
                                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                  {slice.topicKeywords?.slice(0, 6).map((keyword) => (
                                    <span key={keyword} className="rounded bg-indigo-500/10 px-1.5 py-0.5 text-[10px] text-indigo-200">{keyword}</span>
                                  ))}
                                  {issueCodes.slice(0, 4).map((risk) => (
                                    <span key={risk} className="rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-200">{risk}</span>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                   ) : hasSliceReviewMetadata(selectedSlice) && (
                    <div className="shrink-0 max-h-[34%] overflow-y-auto border-t border-[#222] bg-[#151515] p-4 space-y-3 custom-scrollbar">
                       <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                         <div className="min-w-0">
                           <h3 className="text-sm font-semibold text-gray-100 truncate">{selectedSlice.title || selectedSlice.name}</h3>
                           <p className="text-[11px] text-gray-500 mt-1">Source {formatSliceSourceRange(selectedSlice.sourceStartMs, selectedSlice.sourceEndMs)}</p>
                           <p className="text-[11px] text-gray-500 mt-1">
                             Speech {formatSliceSourceRange(selectedSlice.speechStartMs, selectedSlice.speechEndMs)}
                             {' '}
                             ({Math.round((selectedSlice.boundaryPaddingBeforeMs ?? 0) / 10) / 100}s + {Math.round((selectedSlice.boundaryPaddingAfterMs ?? 0) / 10) / 100}s)
                           </p>
                         </div>
                         <div className="flex flex-wrap items-center gap-2 text-[11px] shrink-0">
                           <span className="px-2 py-1 rounded bg-fuchsia-500/10 text-fuchsia-300 border border-fuchsia-500/20">
                             Publish {formatSliceScore(selectedSlice.publishabilityScore)} / {formatPublishabilityGrade(selectedSlice.publishabilityGrade)}
                           </span>
                           <span className="px-2 py-1 rounded bg-rose-500/10 text-rose-300 border border-rose-500/20">
                             Platform {formatSliceScore(selectedSlice.platformReadinessScore)} / {formatPlatformReadinessGrade(selectedSlice.platformReadinessGrade)}
                           </span>
                           <span className="px-2 py-1 rounded bg-sky-500/10 text-sky-300 border border-sky-500/20">
                             Sentence {formatSliceScore(selectedSlice.sentenceBoundaryIntegrityScore)} / {formatSentenceBoundaryIntegrityGrade(selectedSlice.sentenceBoundaryIntegrityGrade)}
                           </span>
                           <span className="px-2 py-1 rounded bg-orange-500/10 text-orange-300 border border-orange-500/20">
                             Hook {formatSliceBoundaryGrade(selectedSlice.hookStrength)}
                           </span>
                           <span className="px-2 py-1 rounded bg-lime-500/10 text-lime-300 border border-lime-500/20">
                             Ending {formatSliceBoundaryGrade(selectedSlice.endingCompleteness)}
                           </span>
                           <span className="px-2 py-1 rounded bg-teal-500/10 text-teal-300 border border-teal-500/20">
                             Arc {formatSliceScore(selectedSlice.contentArcScore)} / {formatSliceContentArcGrade(selectedSlice.contentArcGrade)}
                           </span>
                           <span className="px-2 py-1 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                             Topic {formatSliceScore(selectedSlice.topicCoherenceScore)} / {formatSliceTopicCoherenceGrade(selectedSlice.topicCoherenceGrade)}
                           </span>
                           <span className="px-2 py-1 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20">
                             Story {formatSliceStoryShape(selectedSlice.storyShape)}
                           </span>
                           <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                             Quality {formatSliceScore(selectedSlice.qualityScore)}
                           </span>
                           <span className="px-2 py-1 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20">
                             Continuity {formatSliceScore(selectedSlice.continuityScore)}
                           </span>
                           <span className="px-2 py-1 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                             Transcript {formatSliceScore(selectedSlice.transcriptCoverageScore)}
                           </span>
                           <span className="px-2 py-1 rounded bg-slate-500/10 text-slate-300 border border-slate-500/20">
                             {formatSpeechContinuityGrade(selectedSlice.speechContinuityGrade)}
                           </span>
                         </div>
                       </div>
                       {(selectedSlice.transcriptSegmentCount !== undefined || selectedSlice.subtitleUrl) && (
                         <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-400">
                           {selectedSlice.transcriptSegmentCount !== undefined && (
                             <span className="inline-flex items-center gap-1 rounded border border-[#333] bg-[#101010] px-2 py-1">
                               <FileText size={12} /> {t('taskDetail.transcript.segmentCount', { count: selectedSlice.transcriptSegmentCount })}
                             </span>
                           )}
                           {(selectedSlice.transcriptSegments?.length || selectedSlice.transcriptText) && (
                             <button
                               type="button"
                               className="inline-flex items-center gap-1 rounded border border-[#333] bg-[#101010] px-2 py-1 text-cyan-300 hover:border-cyan-500/40 hover:bg-cyan-500/10 transition-colors"
                               onClick={() => downloadSliceTranscriptFile(selectedSlice)}
                             >
                               <Download size={12} /> {t('taskDetail.transcript.exportTxt')}
                             </button>
                           )}
                           {selectedSlice.subtitleUrl && (
                             <button
                               type="button"
                               className="inline-flex items-center gap-1 rounded border border-[#333] bg-[#101010] px-2 py-1 text-blue-300 hover:border-blue-500/40 hover:bg-blue-500/10 transition-colors"
                               onClick={() => handleDownload(selectedSlice.subtitleUrl, `${selectedSlice.name}.srt`)}
                             >
                               <Download size={12} /> {t('taskDetail.transcript.subtitle')}
                             </button>
                           )}
                         </div>
                       )}
                       {selectedSlice.summary && (
                         <p className="text-xs leading-relaxed text-gray-300">{selectedSlice.summary}</p>
                       )}
                        {selectedSlice.reason && (
                          <p className="text-xs leading-relaxed text-gray-400">{selectedSlice.reason}</p>
                        )}
                        {selectedSlice.transcriptCorrection && (
                          <div className="inline-flex w-fit items-center gap-2 rounded border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-300">
                            <Pencil size={12} />
                            <span>{t('taskDetail.transcript.corrected')}</span>
                            <span className="text-emerald-200/70">
                              {formatAutoCutDateTime(selectedSlice.transcriptCorrection.correctedAt)}
                            </span>
                            <span className="text-emerald-200/60">
                              {t('taskDetail.transcript.correctionCount', {
                                count: selectedSlice.transcriptCorrection.correctionCount,
                              })}
                            </span>
                          </div>
                        )}
                        {(selectedSlice.transcriptSegments?.length || selectedSlice.transcriptText) && (
                          <div className="rounded border border-[#2A2A2A] bg-[#0F0F0F] p-3">
                           <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                             <div className="flex items-center gap-2 text-[11px] font-medium text-gray-400">
                               <FileText size={12} /> {t('taskDetail.transcript.title')}
                               {transcriptFeedback && (
                                 <span className="rounded bg-cyan-500/10 px-1.5 py-0.5 text-[10px] text-cyan-300">
                                   {transcriptFeedback}
                                 </span>
                               )}
                             </div>
                             <div className="flex items-center gap-1.5">
                               <button
                                 type="button"
                                 title={t('taskDetail.transcript.copyTranscript')}
                                 aria-label={t('taskDetail.transcript.copyTranscript')}
                                 className="inline-flex h-7 items-center gap-1 rounded border border-[#333] bg-[#101010] px-2 text-[11px] text-cyan-300 hover:border-cyan-500/40 hover:bg-cyan-500/10 transition-colors"
                                 onClick={() => void handleCopyTranscriptText(formatSliceTranscriptText(selectedSlice), t('taskDetail.transcript.copied'))}
                               >
                                 <Copy size={12} /> {t('taskDetail.transcript.copyAll')}
                               </button>
                               {transcriptDraft?.sliceId === selectedSlice.id ? (
                                 <>
                                   <button
                                     type="button"
                                     title={t('taskDetail.transcript.saveEdits')}
                                     aria-label={t('taskDetail.transcript.saveEdits')}
                                     disabled={isSavingTranscript || !hasTranscriptDraftChanges(selectedSlice, transcriptDraft)}
                                     className="inline-flex h-7 items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 text-[11px] text-emerald-300 transition-colors hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                                     onClick={() => void handleSaveTranscriptEdit(selectedSlice)}
                                   >
                                     <Save size={12} /> {isSavingTranscript ? t('taskDetail.transcript.saving') : t('taskDetail.transcript.save')}
                                   </button>
                                   <button
                                     type="button"
                                     title={t('taskDetail.transcript.cancelEdits')}
                                     aria-label={t('taskDetail.transcript.cancelEdits')}
                                     disabled={isSavingTranscript}
                                     className="inline-flex h-7 items-center justify-center rounded border border-[#333] bg-[#101010] px-2 text-[11px] text-gray-300 transition-colors hover:border-gray-500/40 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                                     onClick={handleCancelTranscriptEdit}
                                   >
                                     <X size={12} /> {t('taskDetail.transcript.cancel')}
                                   </button>
                                 </>
                               ) : (
                                 <button
                                   type="button"
                                   title={t('taskDetail.transcript.editTranscript')}
                                   aria-label={t('taskDetail.transcript.editTranscript')}
                                   className="inline-flex h-7 items-center gap-1 rounded border border-[#333] bg-[#101010] px-2 text-[11px] text-amber-300 hover:border-amber-500/40 hover:bg-amber-500/10 transition-colors"
                                   onClick={() => handleStartTranscriptEdit(selectedSlice)}
                                 >
                                   <Pencil size={12} /> {t('taskDetail.transcript.edit')}
                                 </button>
                               )}
                             </div>
                           </div>
                           {transcriptDraft?.sliceId === selectedSlice.id && transcriptDraft.mode === 'segments' ? (
                             <div className="max-h-44 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
                               {transcriptDraft.segments.map((segment, index) => (
                                 <div key={`${segment.startMs}-${segment.endMs}-${index}`} className="grid grid-cols-[112px_1fr] gap-3 text-xs leading-relaxed">
                                   <div className="font-mono text-[10px] text-gray-500">
                                     {formatSliceRelativeTranscriptTimestamp(segment.startMs - (selectedSlice.sourceStartMs ?? 0))}
                                     <span className="mt-0.5 block text-[9px] text-gray-600">
                                       {formatSliceSourceTranscriptTimestamp(segment.startMs)}
                                     </span>
                                   </div>
                                   <textarea
                                     value={segment.text}
                                     rows={2}
                                     spellCheck
                                     aria-label={t('taskDetail.transcript.editSegmentAria', { index: index + 1 })}
                                     className="min-h-[52px] w-full resize-y rounded border border-[#333] bg-[#080808] px-2 py-1.5 text-xs leading-relaxed text-gray-100 outline-none transition-colors focus:border-cyan-500/60 focus:bg-black disabled:opacity-60"
                                     disabled={isSavingTranscript}
                                     onChange={(event) => handleTranscriptSegmentTextChange(index, event.target.value)}
                                   />
                                 </div>
                               ))}
                             </div>
                           ) : transcriptDraft?.sliceId === selectedSlice.id ? (
                             <textarea
                               value={transcriptDraft.text}
                               rows={4}
                               spellCheck
                               aria-label={t('taskDetail.transcript.editTextAria')}
                               className="max-h-44 min-h-[88px] w-full resize-y rounded border border-[#333] bg-[#080808] px-2 py-1.5 text-xs leading-relaxed text-gray-100 outline-none transition-colors focus:border-cyan-500/60 focus:bg-black disabled:opacity-60"
                               disabled={isSavingTranscript}
                               onChange={(event) => handleTranscriptTextChange(event.target.value)}
                             />
                           ) : selectedSlice.transcriptSegments?.length ? (
                             <div className="max-h-32 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
                               {selectedSlice.transcriptSegments.map((segment, index) => (
                                 <div key={`${segment.startMs}-${segment.endMs}-${index}`} className="grid grid-cols-[112px_1fr] gap-3 text-xs leading-relaxed">
                                   <div className="font-mono text-[10px] text-gray-500">
                                     {formatSliceRelativeTranscriptTimestamp(segment.startMs - (selectedSlice.sourceStartMs ?? 0))}
                                     <span className="mt-0.5 block text-[9px] text-gray-600">
                                       {formatSliceSourceTranscriptTimestamp(segment.startMs)}
                                     </span>
                                   </div>
                                   <button
                                     type="button"
                                     title={t('taskDetail.transcript.copySegment')}
                                     aria-label={t('taskDetail.transcript.copySegmentAria', { index: index + 1 })}
                                     className="group/segment min-w-0 rounded px-2 py-1 text-left text-gray-300 transition-colors hover:bg-cyan-500/10 hover:text-gray-100"
                                     onClick={() => void handleCopyTranscriptText(segment.text, t('taskDetail.transcript.segmentCopied'))}
                                   >
                                     {segment.speaker && (
                                       <span className="mr-2 text-[10px] font-semibold uppercase text-cyan-300">{segment.speaker}</span>
                                     )}
                                     {segment.text}
                                     <Copy size={11} className="ml-1 inline opacity-0 transition-opacity group-hover/segment:opacity-70" />
                                   </button>
                                 </div>
                               ))}
                             </div>
                           ) : (
                             <button
                               type="button"
                               title={t('taskDetail.transcript.copyTranscript')}
                               aria-label={t('taskDetail.transcript.copyTranscriptText')}
                               className="block max-h-24 w-full overflow-y-auto rounded px-2 py-1 text-left text-xs leading-relaxed text-gray-300 transition-colors hover:bg-cyan-500/10 hover:text-gray-100 custom-scrollbar"
                               onClick={() => void handleCopyTranscriptText(selectedSlice.transcriptText ?? '', t('taskDetail.transcript.copied'))}
                             >
                               {selectedSlice.transcriptText}
                               <Copy size={11} className="ml-1 inline opacity-70" />
                             </button>
                           )}
                         </div>
                       )}
                       {selectedSliceReviewIssueCodes.length ? (
                         <div className="space-y-2 rounded border border-amber-500/20 bg-amber-500/5 p-3">
                           <div className="flex items-center gap-2 text-[11px] font-medium text-amber-200">
                             <ShieldAlert size={12} /> {t('taskDetail.reviewRisk.title')}
                           </div>
                           {selectedSliceReviewIssueCodes.map((risk) => (
                             <div key={risk} className="rounded border border-amber-500/15 bg-[#101010] px-2.5 py-2">
                               {(() => {
                                 const definition = getSmartSliceReviewRiskDefinition(risk);
                                 const label = definition
                                   ? t(definition.labelKey, { defaultValue: definition.title })
                                   : t('taskDetail.reviewRisk.unknownLabel', {
                                       risk,
                                       defaultValue: formatSmartSliceReviewRiskFallbackTitle(risk),
                                     });
                                 const message = definition
                                   ? t(definition.messageKey, { defaultValue: definition.message })
                                   : t('taskDetail.reviewRisk.unknownMessage', { risk });
                                 const remediation = definition
                                   ? t(definition.remediationKey, { defaultValue: definition.remediation })
                                   : t('taskDetail.reviewRisk.unknownRemediation');

                                 return (
                                   <div className="space-y-1">
                                     <div className="flex flex-wrap items-center gap-2">
                                       <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-200">
                                         <ShieldAlert size={12} /> {label}
                                       </span>
                                       <span className="rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-300/70">
                                         {risk}
                                       </span>
                                     </div>
                                     <p className="text-[11px] leading-relaxed text-amber-100/80">{message}</p>
                                     <p className="text-[11px] leading-relaxed text-gray-400">{remediation}</p>
                                   </div>
                                 );
                               })()}
                             </div>
                           ))}
                         </div>
                       ) : null}
                       {selectedSlice.topicKeywords?.length ? (
                         <div className="flex flex-wrap items-center gap-2">
                           {selectedSlice.topicKeywords.map((keyword) => (
                             <span key={keyword} className="inline-flex items-center gap-1 rounded border border-indigo-500/20 bg-indigo-500/10 px-2 py-1 text-[11px] text-indigo-300">
                               <Tag size={12} /> {keyword}
                             </span>
                           ))}
                         </div>
                       ) : null}
                       {selectedSlice.contentArcMissingStages?.length ? (
                         <div className="flex flex-wrap items-center gap-2">
                           {selectedSlice.contentArcMissingStages.map((stage) => (
                             <span key={stage} className="inline-flex items-center gap-1 rounded border border-teal-500/20 bg-teal-500/10 px-2 py-1 text-[11px] text-teal-300">
                               <ShieldAlert size={12} /> missing-{stage}
                             </span>
                           ))}
                         </div>
                       ) : null}
                     </div>
                   )}
                 </div>
               ) : (
                 <div className="flex flex-col items-center justify-center text-gray-500 gap-4">
                   <div className="w-16 h-16 bg-[#1A1A1A] rounded-full flex items-center justify-center border border-[#333]">
                     <PlayCircle size={28} className="text-gray-600" />
                   </div>
                   <p className="text-sm">Select a slice from the list to preview it.</p>
                 </div>
               )}
            </div>
          </div>
          </div>
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
               <Copy size={14} className="mr-2" /> {copied ? 'Copied' : 'Copy text'}
             </Button>
             <Button onClick={() => {
               downloadExtractedTextFile(task, `${normalizedTaskName}.txt`);
             }} className="text-xs bg-purple-600 hover:bg-purple-500">
               <Download size={14} className="mr-2" /> Export TXT
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
            <img src={task.gifUrl} alt="Generated GIF" className="w-full rounded bg-black object-contain h-auto max-h-[400px]" />
          </div>
          <Button onClick={() => handleDownload(task.gifUrl, `${normalizedTaskName}.gif`)} className="mt-8 px-8" size="lg">
             <Download size={18} className="mr-2" /> Download GIF
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
             <h3 className="text-sm text-gray-400 mb-4 font-medium text-center truncate">{normalizedTaskName} - Extracted audio</h3>
             <audio src={task.audioUrl} controls className="w-full outline-none" />
             <div className="mt-6 flex justify-center">
               <Button onClick={() => handleDownload(task.audioUrl, `${normalizedTaskName}.mp3`)} className="w-full bg-green-600 hover:bg-green-500" size="lg">
                 <Download size={16} className="mr-2" /> Download audio file
               </Button>
             </div>
          </div>
        </div>
      );
    }

    if ((task.type === AUTOCUT_TASK_TYPE.subtitleTranslate || task.type === AUTOCUT_TASK_TYPE.voiceTranslate) && (task.subtitleUrl || task.transcriptText)) {
      const transcriptText = formatExtractedText(task);
      const translationText = task.translationSegments?.length
        ? task.translationSegments.map((segment) => `[${formatSliceTranscriptTimestamp(segment.startMs)} - ${formatSliceTranscriptTimestamp(segment.endMs)}] ${segment.speaker || 'Speaker'}: ${segment.text}`).join('\n')
        : task.translationText?.trim() ?? '';
      const displayText = translationText || transcriptText;
      return (
        <div className="flex-1 flex flex-col border border-[#222] rounded-xl bg-[#111] overflow-hidden">
          <div className="p-4 bg-[#151515] border-b border-[#222] flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
                <FileText size={16} />
              </div>
              <div>
                <div className="font-bold text-gray-100">Translated subtitle and transcript output</div>
                <div className="text-xs text-gray-500">{task.transcriptSegmentCount ?? task.transcriptSegments?.length ?? 0} speech segments</div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {task.subtitleUrl && (
                <Button onClick={() => handleDownload(task.subtitleUrl, `${normalizedTaskName}.${task.subtitleFormat || 'srt'}`)} className="bg-indigo-600 hover:bg-indigo-500">
                  <Download size={16} className="mr-2" /> Download SRT
                </Button>
              )}
              {displayText && (
                <Button variant="outline" onClick={() => {
                  void writeAutoCutClipboardText(displayText);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}>
                  <Copy size={16} className="mr-2" /> {copied ? 'Copied' : translationText ? 'Copy translation' : 'Copy transcript'}
                </Button>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-6 bg-[#0A0A0A]">
            <pre className="whitespace-pre-wrap text-sm leading-relaxed text-gray-200 font-mono">{displayText || 'No transcript text is available.'}</pre>
          </div>
        </div>
      );
    }

    if (task.type === AUTOCUT_TASK_TYPE.videoCompress && task.fileSizeStats && task.videoUrl) {
      const { originalSize, newSize, compressionRatio } = task.fileSizeStats;
      return (
        <div className="flex-1 flex flex-col items-center justify-center border border-[#222] rounded-xl bg-[#111]">
          <Zap size={48} className="text-yellow-500 mb-6" />
          <h2 className="text-2xl font-bold mb-8">Compression complete. Size reduced by {compressionRatio}%</h2>

          <div className="flex items-center gap-8 mb-10">
            <div className="flex flex-col items-center pb-4 border-b-2 border-[#333]">
              <span className="text-sm text-gray-500 mb-1">Original size</span>
              <span className="text-xl font-bold text-gray-300">{formatBytes(originalSize)}</span>
            </div>
            <ArrowRight className="text-gray-600" />
            <div className="flex flex-col items-center pb-4 border-b-2 border-yellow-500">
              <span className="text-sm text-yellow-500 mb-1">Compressed size</span>
              <span className="text-3xl font-bold text-white">{formatBytes(newSize)}</span>
            </div>
          </div>

          <div className="flex gap-4">
            <Button variant="outline" onClick={() => openAutoCutPreviewUrl(task.videoUrl)} size="lg">Preview video</Button>
            <Button onClick={() => handleDownload(task.videoUrl, `${normalizedTaskName}_compressed.mp4`)} size="lg" className="bg-green-600 hover:bg-green-500">
               <Download size={18} className="mr-2" /> Download compressed video
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
               <Download size={18} className="mr-2" /> Download output file
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
            <p>No detailed result preview is available for this task.</p>
            {task.status === AUTOCUT_TASK_STATUS.completed && task.resultCount !== undefined && task.resultCount > 0 && (
              <Button className="mt-4" variant="outline" onClick={() => downloadTaskExecutionResultFile(task, getTaskTypeLabel(task.type))}>Download task result ({task.resultCount})</Button>
            )}
          </div>
      </div>
    );
  };

  return (
    <div className="w-full h-full p-6 md:p-10 flex flex-col bg-[#0A0A0A] overflow-hidden">
      <div className="w-full h-full flex flex-col gap-4">

        {/* Header */}
        <div className="flex items-center gap-4 border-b border-[#222] pb-4 shrink-0">
          <button
            onClick={() => navigate('/tasks')}
            className="w-10 h-10 rounded-full border border-[#333] flex items-center justify-center text-gray-400 hover:text-white hover:bg-[#1A1A1A] transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-3">
              {normalizedTaskName}
            </h1>
            <div className="flex items-center gap-4 text-xs text-gray-500 mt-1">
              <span>Task type: <span className="text-gray-300 font-bold">{getTaskTypeLabel(task.type)}</span></span>
              <span>Created: {formatAutoCutDateTime(task.createdAt)}</span>
              <span className={`px-2 py-0.5 rounded font-bold tracking-wider uppercase text-[10px] ${getTaskStatusBadgeClass(task.status)}`}>
                {getTaskStatusLabel(task.status)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" className="text-xs flex items-center gap-2" onClick={() => navigate('/assets')}>
              <FolderOpen size={14} /> Open Assets
            </Button>
            {getReprocessRoute(task.type) && task.status !== AUTOCUT_TASK_STATUS.processing && (
              <Button onClick={() => {
                const reprocessRoute = getReprocessRoute(task.type);
                if (reprocessRoute) navigate(reprocessRoute);
              }} className="text-xs flex items-center gap-2 bg-blue-600 hover:bg-blue-500">
                <Play size={14} /> Process again
              </Button>
            )}
          </div>
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

        {/* Content Area */}
        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
          {renderContent()}
        </div>

      </div>
    </div>
  );
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
  const warningLogCount = logs.filter((log) => log.severity === 'warning').length;
  const hasExecutionState =
    steps.length > 0 ||
    logs.length > 0 ||
    isAutoCutTaskActiveStatus(task.status) ||
    Boolean(task.nativeTaskId);

  if (!hasExecutionState) {
    return null;
  }

  return (
    <div className="relative z-20 shrink-0 rounded-lg border border-[#222] bg-[#101010] shadow-xl shadow-black/20">
      <div className="flex min-h-[44px] flex-col gap-2 px-3 py-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-gray-100">
              <Activity size={14} className="text-blue-300" />
              Execution
            </span>
            {summaryStep && (
              <span className="max-w-[180px] truncate rounded border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 font-mono text-[11px] text-blue-200">
                {summaryStep.label || summaryStep.id}
              </span>
            )}
            {task.nativeTaskId && (
              <span className="hidden rounded border border-[#333] bg-[#0A0A0A] px-2 py-0.5 font-mono text-[11px] text-gray-400 xl:inline-flex">
                native {task.nativeTaskId}
              </span>
            )}
            <span className="hidden rounded border border-[#333] bg-[#0A0A0A] px-2 py-0.5 text-[11px] text-gray-400 md:inline-flex">
              {steps.length} steps
            </span>
            <span className="hidden rounded border border-[#333] bg-[#0A0A0A] px-2 py-0.5 text-[11px] text-gray-400 md:inline-flex">
              {logs.length} logs
            </span>
            {errorLogCount > 0 && (
              <span className="shrink-0 rounded border border-rose-500/20 bg-rose-500/10 px-2 py-0.5 text-[11px] text-rose-200">
                {errorLogCount} errors
              </span>
            )}
            {warningLogCount > 0 && (
              <span className="hidden shrink-0 rounded border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-200 sm:inline-flex">
                {warningLogCount} warnings
              </span>
            )}
            <p className="min-w-0 flex-1 truncate text-xs text-gray-500">
              {normalizeTaskDetailDisplayText(latestLog?.message) ||
                normalizeTaskDetailDisplayText(summaryStep?.message) ||
                normalizeTaskDetailDisplayText(task.progressMessage) ||
                `Progress ${task.progress || 0}%`}
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
          <Button
            variant="outline"
            className="h-8 border-[#333] px-3 text-xs text-cyan-200 hover:border-cyan-500/40 hover:bg-cyan-500/10"
            onClick={onToggleExecutionDetails}
          >
            {showExecutionDetails ? 'Hide details' : 'Steps / Logs'}
          </Button>
          {isAutoCutTaskActiveStatus(task.status) && (
            <Button
              variant="outline"
              className="h-8 border-amber-500/30 px-3 text-xs text-amber-200 hover:bg-amber-500/10"
              disabled={isCancelingTask}
              onClick={onCancelTask}
            >
              {isCancelingTask ? <RefreshCw size={13} className="mr-1.5 animate-spin" /> : <CircleStop size={13} className="mr-1.5" />}
              Cancel
            </Button>
          )}
        </div>
      </div>

      {showExecutionDetails && (
      <div className="absolute left-0 right-0 top-[calc(100%+8px)] grid max-h-[min(38vh,380px)] min-h-0 gap-0 overflow-hidden rounded-lg border border-[#222] bg-[#101010] shadow-2xl shadow-black/60 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <div className="flex min-h-0 flex-col overflow-hidden border-b border-[#222] p-3 lg:border-b-0 lg:border-r">
          <div className="mb-2 flex shrink-0 items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
              <Clock size={13} /> Steps
            </span>
            <span className="text-[11px] text-gray-600">{steps.length}</span>
          </div>
          <div className="max-h-[min(30vh,300px)] min-h-0 overflow-y-auto pr-1 custom-scrollbar">
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {steps.length > 0 && (
              <button
                type="button"
                data-task-execution-step-id="all"
                aria-pressed={!selectedExecutionStepId}
                className={`rounded border px-3 py-2 text-left transition-colors ${
                  !selectedExecutionStepId
                    ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-100'
                    : 'border-[#333] bg-[#0A0A0A] text-gray-300 hover:border-cyan-500/30 hover:bg-cyan-500/5'
                }`}
                onClick={() => onSelectExecutionStep(null)}
              >
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="truncate text-xs font-semibold">All steps</span>
                  <span className="font-mono text-[10px] uppercase opacity-80">{logs.length} logs</span>
                </div>
                <p className="mt-2 text-[11px] text-gray-500">Show the full execution timeline.</p>
              </button>
            )}
            {steps.length ? steps.map((step) => (
              <div
                key={step.id}
                className={`rounded border px-3 py-2 transition-colors ${getTaskExecutionStepStatusClass(step.status)} ${
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
                    <span className="truncate text-xs font-semibold">{step.label || step.id}</span>
                    <span className="font-mono text-[10px] uppercase opacity-80">{step.status}</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/30">
                    <div
                      className="h-full bg-current opacity-70"
                      style={{ width: `${Math.min(100, Math.max(0, step.progress || 0))}%` }}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] opacity-80">
                    <span>{Math.round(step.progress || 0)}%</span>
                    <span>{formatTaskExecutionDuration(step.durationMs)}</span>
                    {step.attempts > 1 && <span>{step.attempts} attempts</span>}
                  </div>
                  {step.message && <p className="mt-1 line-clamp-2 text-[11px] opacity-90">{step.message}</p>}
                  {step.checkpointKey && (
                    <p className="mt-1 truncate font-mono text-[10px] opacity-60">{step.checkpointKey}</p>
                  )}
                </button>
                {step.canResumeFromHere && isTaskResumeStatus(task) && (
                  <Button
                    variant="outline"
                    className="mt-2 h-7 w-full border-cyan-500/30 px-2 text-[10px] text-cyan-200 hover:bg-cyan-500/10"
                    disabled={Boolean(resumingStepId)}
                    onClick={() => onResumeTaskFromStep(step)}
                  >
                    {resumingStepId === step.id ? <RefreshCw size={12} className="mr-1.5 animate-spin" /> : <RefreshCw size={12} className="mr-1.5" />}
                    Resume from here
                  </Button>
                )}
              </div>
            )) : (
              <div className="rounded border border-[#222] bg-[#0A0A0A] px-3 py-6 text-center text-xs text-gray-500 md:col-span-2 xl:col-span-3">
                No execution step snapshot yet.
              </div>
            )}
          </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-col overflow-hidden p-3">
          <div className="mb-2 flex shrink-0 items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
              <Terminal size={13} /> Logs
              {selectedStep && (
                <span className="rounded border border-[#333] bg-[#0A0A0A] px-1.5 py-0.5 font-mono text-[10px] normal-case text-cyan-200">
                  {selectedStep.id}
                </span>
              )}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-600">{filteredExecutionLogs.length}/{logs.length}</span>
              {filteredExecutionLogs.length > 12 && (
                <button
                  type="button"
                  className="rounded border border-[#333] bg-[#0A0A0A] px-2 py-1 text-[10px] text-cyan-300 hover:border-cyan-500/40 hover:bg-cyan-500/10"
                  onClick={onToggleShowAllExecutionLogs}
                >
                  {showAllExecutionLogs ? 'Latest 12' : 'Show all'}
                </button>
              )}
            </div>
          </div>
          <div className="max-h-[min(30vh,300px)] min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
            {visibleExecutionLogs.length ? visibleExecutionLogs.map((log) => {
              const providerProgress = formatTaskExecutionLogProviderProgress(log);
              return (
              <div
                key={log.id}
                data-task-execution-log-step-id={log.stepId ?? 'unassigned'}
                className="rounded border border-[#222] bg-[#0A0A0A] px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2 text-[10px]">
                  <span className={`font-semibold uppercase ${getTaskExecutionLogSeverityClass(log.severity)}`}>
                    {normalizeTaskDetailDisplayText(log.severity)}
                  </span>
                  {log.stepId && <span className="truncate font-mono text-gray-500">{normalizeTaskDetailDisplayText(log.stepId)}</span>}
                  {log.progress !== undefined && <span className="font-mono text-blue-300">{Math.round(log.progress)}%</span>}
                  {providerProgress && <span className="rounded bg-cyan-500/10 px-1.5 py-0.5 font-mono text-cyan-200">{providerProgress}</span>}
                  <button
                    type="button"
                    data-task-execution-log-copy={log.id}
                    className="inline-flex h-5 w-5 items-center justify-center rounded border border-[#333] text-cyan-300 transition-colors hover:border-cyan-500/40 hover:bg-cyan-500/10"
                    title="Copy log"
                    aria-label="Copy log"
                    onClick={() => {
                      void writeAutoCutClipboardText(createTaskExecutionLogClipboardText(log)).catch((error) => {
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
                <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-gray-300">{normalizeTaskDetailDisplayText(log.message)}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-gray-600">
                  {log.phase && <span>{normalizeTaskDetailDisplayText(log.phase)}</span>}
                  {log.source && <span>{normalizeTaskDetailDisplayText(log.source)}</span>}
                  {log.elapsedMs !== undefined && <span>{formatTaskExecutionDuration(log.elapsedMs)}</span>}
                </div>
              </div>
              );
            }) : (
              <div className="rounded border border-[#222] bg-[#0A0A0A] px-3 py-6 text-center text-xs text-gray-500">
                {selectedExecutionStepId ? 'No execution logs for the selected step yet.' : 'No execution logs yet.'}
              </div>
            )}
          </div>
          {isTaskResumeStatus(task) && task.errorMessage && (
            <div className="mt-3 rounded border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              <AlertTriangle size={13} className="mr-1.5 inline" />
              {normalizeTaskDetailDisplayText(task.errorMessage)}
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
}
