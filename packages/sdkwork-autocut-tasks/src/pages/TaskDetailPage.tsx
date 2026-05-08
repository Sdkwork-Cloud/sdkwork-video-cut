import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, PlayCircle, Play, Download, FolderOpen, Tag, CheckCircle2, Settings2, FileText, Music, Copy, ArrowRight, Activity, Zap, ShieldAlert } from 'lucide-react';
import { createAutoCutTaskTypeI18nKey, createAutoCutTextObjectUrl, downloadAutoCutUrl, downloadExtractedTextFile, downloadSmartSliceTaskEvidenceFile, formatAutoCutDateTime, formatExtractedText, getTasks, listenAutoCutEvent, openAutoCutNativeArtifactInFolder, openAutoCutPreviewUrl, reportAutoCutDiagnostic, revokeAutoCutObjectUrl, writeAutoCutClipboardText } from '@sdkwork/autocut-services';
import { Button, TaskFailureState } from '@sdkwork/autocut-commons';
import { AUTOCUT_TASK_STATUS, AUTOCUT_TASK_TYPE, type AppTask, type TaskType } from '@sdkwork/autocut-types';

type SliceResult = NonNullable<AppTask['sliceResults']>[number];

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
  [AUTOCUT_TASK_TYPE.subtitleTranslate]: '/subtitle-translate',
  [AUTOCUT_TASK_TYPE.voiceTranslate]: '/voice-translate',
};

function getReprocessRoute(type: TaskType) {
  return REPROCESS_ROUTES[type];
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
      slice.risks?.length,
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

function downloadTaskExecutionResultFile(task: AppTask, taskTypeLabel: string) {
  const content = [
    `Task: ${task.name}`,
    `Type: ${taskTypeLabel}`,
    `Status: ${task.status}`,
    `Progress: ${task.progress}%`,
    task.progressMessage ? `Progress message: ${task.progressMessage}` : '',
    task.completedAt ? `Completed at: ${formatAutoCutDateTime(task.completedAt)}` : '',
    task.resultCount !== undefined ? `Result count: ${task.resultCount}` : '',
    task.errorMessage ? `Error: ${task.errorMessage}` : '',
  ].filter(Boolean).join('\n');
  const { url } = createAutoCutTextObjectUrl(content);
  try {
    downloadAutoCutUrl(url, `${task.name}_result.txt`);
  } finally {
    revokeAutoCutObjectUrl(url);
  }
}

function handleDownloadSmartSliceTaskEvidence(task: AppTask) {
  downloadSmartSliceTaskEvidenceFile(task, `${task.name}_smart-slice-task.json`);
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

  useEffect(() => {
    const fetchTask = () => {
      getTasks().then(tasks => {
        const t = tasks.find(x => x.id === taskId);
        setTask(t || null);
        const firstSlice = t?.sliceResults?.[0];
        if (firstSlice && !activePreviewUrl) {
          setActivePreviewUrl(firstSlice.id);
        }
      });
    };

    fetchTask();
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
  }, [taskId, activePreviewUrl]);

  if (!task) {
    return (
      <div className="w-full h-full p-10 flex flex-col items-center justify-center text-gray-400">
        <p>任务不存在或已被删除</p>
        <Button className="mt-4" onClick={() => navigate('/tasks')}>返回任务列表</Button>
      </div>
    );
  }

  const renderContent = () => {
    if (task.status === AUTOCUT_TASK_STATUS.failed) {
      return (
        <TaskFailureState
          errorMessage={task.errorMessage}
          failureDiagnostics={task.failureDiagnostics}
          onRetry={() => handleReprocessTask(task)}
          onCopyErrorMessage={writeAutoCutClipboardText}
        />
      );
    }

    if (task.status !== AUTOCUT_TASK_STATUS.completed) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center border border-[#222] border-dashed rounded-xl bg-[#111] text-gray-500">
          <Activity size={48} className="mx-auto mb-4 opacity-30 animate-pulse" />
          <p className="text-lg text-gray-300">{task.progressMessage || '任务排队中...'}</p>
          <div className="w-64 h-2 bg-[#222] rounded-full mt-4 overflow-hidden">
             <div className="h-full bg-blue-500 transition-all duration-300 relative" style={{ width: `${task.progress || 0}%` }}>
                <div className="absolute inset-0 bg-white/20 animate-pulse" />
             </div>
          </div>
          <p className="text-xs text-blue-400 mt-2 font-mono">{task.progress || 0}%</p>
        </div>
      );
    }

    if (task.type === AUTOCUT_TASK_TYPE.videoSlice) {
      const sliceResults = task.sliceResults || [];
      const selectedSlice = sliceResults.find((slice) => slice.id === activePreviewUrl) ?? sliceResults[0] ?? null;
      return (
          <div className="flex flex-col xl:flex-row gap-6 h-full flex-1 min-h-0">
            {/* Left: File List */}
            <div className="w-full xl:w-[30%] flex flex-col border border-[#222] rounded-xl bg-[#111] overflow-hidden shrink-0">
              <div className="p-4 border-b border-[#222] bg-[#151515] flex justify-between items-center shrink-0">
                <h3 className="text-sm font-bold text-gray-200">生成的切片文件 ({task.resultCount || 0})</h3>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded border border-[#333] bg-[#101010] px-2 py-1 text-emerald-300 hover:border-emerald-500/40 hover:bg-emerald-500/10 transition-colors"
                    onClick={() => handleDownloadSmartSliceTaskEvidence(task)}
                  >
                    <Download size={12} /> Quality JSON
                  </button>
                  <Settings2 size={14} /> 按时长排序
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
                        <span className="flex items-center gap-1"><Tag size={10} /> 智能提取</span>
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
                    暂无生成文件
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
                       <span className="text-[11px] text-white">正在预览: {selectedSlice.name}</span>
                     </div>
                   </div>
                   <TaskVideoPreview src={selectedSlice.url} title={selectedSlice.title || selectedSlice.name} videoKey={selectedSlice.id} />
                   {hasSliceReviewMetadata(selectedSlice) && (
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
                               <FileText size={12} /> {selectedSlice.transcriptSegmentCount} transcript segments
                             </span>
                           )}
                           {(selectedSlice.transcriptSegments?.length || selectedSlice.transcriptText) && (
                             <button
                               type="button"
                               className="inline-flex items-center gap-1 rounded border border-[#333] bg-[#101010] px-2 py-1 text-cyan-300 hover:border-cyan-500/40 hover:bg-cyan-500/10 transition-colors"
                               onClick={() => downloadSliceTranscriptFile(selectedSlice)}
                             >
                               <Download size={12} /> Speech transcript TXT
                             </button>
                           )}
                           {selectedSlice.subtitleUrl && (
                             <button
                               type="button"
                               className="inline-flex items-center gap-1 rounded border border-[#333] bg-[#101010] px-2 py-1 text-blue-300 hover:border-blue-500/40 hover:bg-blue-500/10 transition-colors"
                               onClick={() => handleDownload(selectedSlice.subtitleUrl, `${selectedSlice.name}.srt`)}
                             >
                               <Download size={12} /> Subtitle
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
                       {(selectedSlice.transcriptSegments?.length || selectedSlice.transcriptText) && (
                         <div className="rounded border border-[#2A2A2A] bg-[#0F0F0F] p-3">
                           <div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-gray-400">
                             <FileText size={12} /> Speech transcript
                           </div>
                           {selectedSlice.transcriptSegments?.length ? (
                             <div className="max-h-32 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
                               {selectedSlice.transcriptSegments.map((segment, index) => (
                                 <div key={`${segment.startMs}-${segment.endMs}-${index}`} className="grid grid-cols-[112px_1fr] gap-3 text-xs leading-relaxed">
                                   <div className="font-mono text-[10px] text-gray-500">
                                     {formatSliceRelativeTranscriptTimestamp(segment.startMs - (selectedSlice.sourceStartMs ?? 0))}
                                     <span className="mt-0.5 block text-[9px] text-gray-600">
                                       {formatSliceSourceTranscriptTimestamp(segment.startMs)}
                                     </span>
                                   </div>
                                   <div className="text-gray-300">
                                     {segment.speaker && (
                                       <span className="mr-2 text-[10px] font-semibold uppercase text-cyan-300">{segment.speaker}</span>
                                     )}
                                     {segment.text}
                                   </div>
                                 </div>
                               ))}
                             </div>
                           ) : (
                             <p className="max-h-24 overflow-y-auto pr-1 text-xs leading-relaxed text-gray-300 custom-scrollbar">
                               {selectedSlice.transcriptText}
                             </p>
                           )}
                         </div>
                       )}
                       {selectedSlice.risks?.length ? (
                         <div className="flex flex-wrap items-center gap-2">
                           {selectedSlice.risks.map((risk) => (
                             <span key={risk} className="inline-flex items-center gap-1 rounded border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300">
                               <ShieldAlert size={12} /> {risk}
                             </span>
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
                       {selectedSlice.publishabilityIssues?.length ? (
                         <div className="flex flex-wrap items-center gap-2">
                           {selectedSlice.publishabilityIssues.map((issue) => (
                             <span key={issue} className="inline-flex items-center gap-1 rounded border border-rose-500/20 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-300">
                               <ShieldAlert size={12} /> {issue}
                             </span>
                           ))}
                         </div>
                       ) : null}
                       {selectedSlice.platformReadinessIssues?.length ? (
                         <div className="flex flex-wrap items-center gap-2">
                           {selectedSlice.platformReadinessIssues.map((issue) => (
                             <span key={issue} className="inline-flex items-center gap-1 rounded border border-rose-500/20 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-300">
                               <ShieldAlert size={12} /> {issue}
                             </span>
                           ))}
                         </div>
                       ) : null}
                       {selectedSlice.sentenceBoundaryIssues?.length ? (
                         <div className="flex flex-wrap items-center gap-2">
                           {selectedSlice.sentenceBoundaryIssues.map((issue) => (
                             <span key={issue} className="inline-flex items-center gap-1 rounded border border-sky-500/20 bg-sky-500/10 px-2 py-1 text-[11px] text-sky-300">
                               <ShieldAlert size={12} /> {issue}
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
                   <p className="text-sm">点击左侧列表中的切片进行预览</p>
                 </div>
               )}
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
               <Copy size={14} className="mr-2" /> {copied ? '已复制' : '复制全文'}
             </Button>
             <Button onClick={() => {
               downloadExtractedTextFile(task, `${task.name}.txt`);
             }} className="text-xs bg-purple-600 hover:bg-purple-500">
               <Download size={14} className="mr-2" /> 导出 TXT
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
          <Button onClick={() => handleDownload(task.gifUrl, `${task.name}.gif`)} className="mt-8 px-8" size="lg">
             <Download size={18} className="mr-2" /> 下载 GIF
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
             <h3 className="text-sm text-gray-400 mb-4 font-medium text-center truncate">{task.name} - 提取的音频</h3>
             <audio src={task.audioUrl} controls className="w-full outline-none" />
             <div className="mt-6 flex justify-center">
               <Button onClick={() => handleDownload(task.audioUrl, `${task.name}.mp3`)} className="w-full bg-green-600 hover:bg-green-500" size="lg">
                 <Download size={16} className="mr-2" /> 下载音频文件
               </Button>
             </div>
          </div>
        </div>
      );
    }

    if (task.type === AUTOCUT_TASK_TYPE.videoCompress && task.fileSizeStats && task.videoUrl) {
      const { originalSize, newSize, compressionRatio } = task.fileSizeStats;
      return (
        <div className="flex-1 flex flex-col items-center justify-center border border-[#222] rounded-xl bg-[#111]">
          <Zap size={48} className="text-yellow-500 mb-6" />
          <h2 className="text-2xl font-bold mb-8">压缩成功！体积减小了 {compressionRatio}%</h2>

          <div className="flex items-center gap-8 mb-10">
            <div className="flex flex-col items-center pb-4 border-b-2 border-[#333]">
              <span className="text-sm text-gray-500 mb-1">原始大小</span>
              <span className="text-xl font-bold text-gray-300">{formatBytes(originalSize)}</span>
            </div>
            <ArrowRight className="text-gray-600" />
            <div className="flex flex-col items-center pb-4 border-b-2 border-yellow-500">
              <span className="text-sm text-yellow-500 mb-1">压缩后大小</span>
              <span className="text-3xl font-bold text-white">{formatBytes(newSize)}</span>
            </div>
          </div>

          <div className="flex gap-4">
            <Button variant="outline" onClick={() => openAutoCutPreviewUrl(task.videoUrl)} size="lg">预览视频</Button>
            <Button onClick={() => handleDownload(task.videoUrl, `${task.name}_compressed.mp4`)} size="lg" className="bg-green-600 hover:bg-green-500">
               <Download size={18} className="mr-2" /> 下载压缩视频
            </Button>
          </div>
        </div>
      );
    }

    if (task.videoUrl) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center border border-[#222] rounded-xl bg-[#111] overflow-hidden">
          <TaskVideoPreview src={task.videoUrl} title={task.name} videoKey={task.id} />
          <div className="p-6 bg-[#151515] w-full border-t border-[#222] flex justify-center">
             <Button onClick={() => handleDownload(task.videoUrl, `${task.name}_output.mp4`)} size="lg">
               <Download size={18} className="mr-2" /> 下载输出文件
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
            <p>该任务暂无详细结果预览</p>
            {task.status === AUTOCUT_TASK_STATUS.completed && task.resultCount !== undefined && task.resultCount > 0 && (
              <Button className="mt-4" variant="outline" onClick={() => downloadTaskExecutionResultFile(task, getTaskTypeLabel(task.type))}>下载执行结果 ({task.resultCount})</Button>
            )}
          </div>
      </div>
    );
  };

  return (
    <div className="w-full h-full p-6 md:p-10 flex flex-col bg-[#0A0A0A] overflow-hidden">
      <div className="w-full h-full flex flex-col space-y-6">

        {/* Header */}
        <div className="flex items-center gap-4 border-b border-[#222] pb-6 shrink-0">
          <button
            onClick={() => navigate('/tasks')}
            className="w-10 h-10 rounded-full border border-[#333] flex items-center justify-center text-gray-400 hover:text-white hover:bg-[#1A1A1A] transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-3">
              {task.name}
            </h1>
            <div className="flex items-center gap-4 text-xs text-gray-500 mt-1">
              <span>Task type: <span className="text-gray-300 font-bold">{getTaskTypeLabel(task.type)}</span></span>
              <span>创建时间: {formatAutoCutDateTime(task.createdAt)}</span>
              <span className={`px-2 py-0.5 rounded font-bold tracking-wider uppercase text-[10px] ${
                task.status === AUTOCUT_TASK_STATUS.completed ? 'bg-green-500/10 text-green-500' :
                task.status === AUTOCUT_TASK_STATUS.processing ? 'bg-blue-500/10 text-blue-500' :
                'bg-red-500/10 text-red-500'
              }`}>
                {task.status === AUTOCUT_TASK_STATUS.completed ? '已完成' : task.status === AUTOCUT_TASK_STATUS.processing ? '处理中' : '失败'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" className="text-xs flex items-center gap-2" onClick={() => navigate('/assets')}>
              <FolderOpen size={14} /> 资产管理中查看
            </Button>
            {getReprocessRoute(task.type) && task.status !== AUTOCUT_TASK_STATUS.processing && (
              <Button onClick={() => {
                const reprocessRoute = getReprocessRoute(task.type);
                if (reprocessRoute) navigate(reprocessRoute);
              }} className="text-xs flex items-center gap-2 bg-blue-600 hover:bg-blue-500">
                <Play size={14} /> 再次处理
              </Button>
            )}
          </div>
        </div>

        {/* Content Area */}
        {renderContent()}

      </div>
    </div>
  );
}
