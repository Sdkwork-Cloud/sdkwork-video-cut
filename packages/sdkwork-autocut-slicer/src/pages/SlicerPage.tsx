import { analyzeVideoSlicePlan, processVideoSlice, renderVideoSlicePlan, saveVideoSliceReviewDraft } from '../service/slicerService';
import React, { Suspense, useState, useEffect, useMemo, useRef, useImperativeHandle, forwardRef } from "react";
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Play, Pause, Settings2, Scissors, CheckCircle2, MicOff, Waves, Video, RefreshCcw, XCircle, ChevronRight, Type, Download, AlertTriangle, ExternalLink, Loader2 } from "lucide-react";
import { Button, useToast, TaskFailureState, VideoDedupWorkbench, useAutoCutCommonLabels, createAutoCutTrustedLocalFile, resolveAutoCutTrustedSourcePath, type AutoCutTrustedFileSourceDescriptor } from "@sdkwork/autocut-commons";
import { AUTOCUT_DEFAULT_SMART_SLICE_SEGMENTATION_AGENT_ID, AUTOCUT_DEFAULT_SPEECH_TRANSCRIPTION_WORKFLOW_PRESET_ID, AUTOCUT_MODEL_VENDOR_PRESETS, AUTOCUT_SLICE_LLM_MODEL_OPTIONS, AUTOCUT_SMART_SLICE_SEGMENTATION_AGENTS, AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_PHASE, AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS, AUTOCUT_SPEECH_TRANSCRIPTION_WORKFLOW_PRESETS, AUTOCUT_TASK_STATUS, AUTOCUT_TASK_TYPE, getAutoCutSmartSliceSegmentationAgentDefinition, type AutoCutLlmRuntimeConfig, type AutoCutLocalSpeechTranscriptionSetupStatus, type AutoCutSliceManualEdit, type AutoCutSliceReviewSegment, type AutoCutSliceReviewSession, type AutoCutSmartSliceSegmentationAgentId, type AutoCutSpeechTranscriptionModelDownloadProgressEvent, type AutoCutSpeechTranscriptionWorkflowPreset, type ModelVendor, type SliceMode, type SliceLLM, type SliceTargetPlatform, type SliceTargetAspectRatio, type SliceVideoObjectFit, type SliceContinuityLevel, type SliceSegmentationDensity, type SliceSubtitleMode, type AppTask, type VideoDedupParams, type VideoDedupReport, type VideoSliceParams } from "@sdkwork/autocut-types";
import { createAutoCutId, createAutoCutObjectUrl, createAutoCutTimestamp, createDefaultAutoCutVideoDedupParams, formatAutoCutTimeOfDay, getAutoCutNativeHostClient, getAutoCutProcessingTaskErrorTaskId, getAutoCutWorkflowPreferences, getTasks, initializeAutoCutLocalSpeechTranscriptionSetup, inspectAutoCutLocalSpeechTranscriptionSetup, listenAutoCutEvent, reportAutoCutDiagnostic, resolveAutoCutLlmRuntimeConfig, revokeAutoCutObjectUrl, saveAutoCutVideoSlicePreferences, selectAutoCutTrustedLocalVideoFile, sortAutoCutRecordsByCreatedAtDesc, writeAutoCutClipboardText } from "@sdkwork/autocut-services";
import type { WebGLPlayerRef, TextEffectStyle, TextEffectDragPayload } from "../components/WebGLPlayer";

const WebGLPlayer = React.lazy(() => import("../components/WebGLPlayer"));
const SMART_SLICE_DEDUP_REVIEW_RISK_CODE = 'smart-dedup-review';
const SMART_SLICE_GPU_STT_RUNTIME_REQUIRED_REASON =
  'GPU local requires a CUDA, Vulkan, Metal, Core ML, or OpenVINO whisper.cpp runtime in Settings.';

function sortSlicerTasksByCreatedAtDesc(tasks: readonly AppTask[]): AppTask[] {
  return sortAutoCutRecordsByCreatedAtDesc([...tasks]);
}

function isSliceReviewDuplicateRiskSegment(segment: AutoCutSliceReviewSegment) {
  return segment.status === 'duplicate' || segment.risks.includes(SMART_SLICE_DEDUP_REVIEW_RISK_CODE);
}

function mergeSlicerTaskUpdate(tasks: readonly AppTask[], updatedTask: AppTask): AppTask[] {
  if (updatedTask.type !== AUTOCUT_TASK_TYPE.videoSlice) {
    return tasks as AppTask[];
  }

  const taskIndex = tasks.findIndex((task) => task.id === updatedTask.id);
  if (taskIndex < 0) {
    return sortSlicerTasksByCreatedAtDesc([updatedTask, ...tasks]);
  }

  return tasks.map((task, index) => (index === taskIndex ? updatedTask : task));
}

function createSliceReviewSessionFromSegments(
  baseSession: AutoCutSliceReviewSession,
  segments: readonly AutoCutSliceReviewSegment[],
  manualEdits: readonly AutoCutSliceManualEdit[] = [],
): AutoCutSliceReviewSession {
  const selectedSegmentIds = segments
    .filter((segment) => segment.selected && segment.status === 'selected')
    .map((segment) => segment.id);
  return {
    ...baseSession,
    updatedAt: createAutoCutTimestamp(),
    segments: segments.map((segment) => ({ ...segment })),
    manualEdits: [...baseSession.manualEdits, ...manualEdits],
    selectedSegmentIds,
  };
}

function createSliceReviewManualEdit(
  kind: AutoCutSliceManualEdit['kind'],
  segmentIds: string[],
  detail: Omit<Partial<AutoCutSliceManualEdit>, 'id' | 'kind' | 'segmentIds' | 'createdAt'> = {},
): AutoCutSliceManualEdit {
  return {
    id: createAutoCutId('slice-manual-edit'),
    kind,
    segmentIds,
    createdAt: createAutoCutTimestamp(),
    ...detail,
  };
}

function shouldHydrateSmartSliceReviewSessionFromTask({
  currentTaskId,
  nextTaskId,
  currentDraft,
  nextSession,
  currentManualEditCount,
}: {
  currentTaskId: string;
  nextTaskId: string;
  currentDraft: AutoCutSliceReviewSession | null;
  nextSession: AutoCutSliceReviewSession;
  currentManualEditCount: number;
}) {
  if (
    currentManualEditCount > 0 &&
    currentTaskId === nextTaskId &&
    currentDraft?.id === nextSession.id
  ) {
    return false;
  }

  return true;
}

function filterSliceReviewTranscriptSegmentsForPreview(
  segment: AutoCutSliceReviewSegment,
  startMs: number,
  endMs: number,
) {
  return (segment.transcriptSegments ?? [])
    .filter((transcriptSegment) => transcriptSegment.endMs > startMs && transcriptSegment.startMs < endMs)
    .map((transcriptSegment) => ({
      ...transcriptSegment,
      startMs: Math.max(startMs, transcriptSegment.startMs),
      endMs: Math.min(endMs, transcriptSegment.endMs),
    }))
    .filter((transcriptSegment) => transcriptSegment.endMs > transcriptSegment.startMs);
}

function createSliceReviewTranscriptTextForPreview(segment: AutoCutSliceReviewSegment) {
  return segment.transcriptSegments?.map((item) => item.text).filter(Boolean).join(' ') || segment.transcriptText;
}

function createSliceReviewSpeechRangeForPreview(
  segment: AutoCutSliceReviewSegment,
  startMs: number,
  endMs: number,
) {
  const transcriptSegments = filterSliceReviewTranscriptSegmentsForPreview(segment, startMs, endMs);
  const speechStartMs = transcriptSegments[0]?.startMs ?? segment.speechStartMs;
  const speechEndMs = transcriptSegments.at(-1)?.endMs ?? segment.speechEndMs;
  if (speechStartMs === undefined || speechEndMs === undefined) {
    return {};
  }
  const clippedSpeechStartMs = Math.max(startMs, Math.min(endMs, Math.round(speechStartMs)));
  const clippedSpeechEndMs = Math.max(clippedSpeechStartMs, Math.min(endMs, Math.round(speechEndMs)));
  return {
    speechStartMs: clippedSpeechStartMs,
    speechEndMs: clippedSpeechEndMs,
  };
}

function setWebGlTextEffectDragPayload(payload: TextEffectDragPayload | null) {
  void import("../components/WebGLPlayer")
    .then((module) => {
      module.WebGLPlayerDragState.currentEffect = payload;
    })
    .catch((error) => {
      reportAutoCutDiagnostic('warning', 'slicer.webgl.lazy-drag-state', 'Failed to prepare lazy WebGL text overlay drag state', error);
    });
}

interface SmartSlicePlayerRef {
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  seek: (progress: number) => void;
  updateSelectedText: (props: Partial<{ text: string; fontSize: number; fill: string }>) => void;
}

interface SmartSliceVideoPreviewProps {
  videoSrc: string;
  aspectRatio?: SliceTargetAspectRatio;
  videoObjectFit?: SliceVideoObjectFit;
  onVideoLoaded?: (width: number, height: number) => void;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onPlayStateChange?: (isPlaying: boolean) => void;
}

const NativeSmartSliceVideoPreview = forwardRef<SmartSlicePlayerRef, SmartSliceVideoPreviewProps>(
  ({ videoSrc, aspectRatio, videoObjectFit = 'contain', onVideoLoaded, onTimeUpdate, onPlayStateChange }, ref) => {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const containerAspectRatio = aspectRatio && aspectRatio !== 'auto' ? aspectRatio.replace(':', ' / ') : undefined;

    useImperativeHandle(ref, () => ({
      play: () => {
        void videoRef.current?.play();
        onPlayStateChange?.(true);
      },
      pause: () => {
        videoRef.current?.pause();
        onPlayStateChange?.(false);
      },
      togglePlay: () => {
        const video = videoRef.current;
        if (!video) {
          return;
        }
        if (video.paused) {
          void video.play();
          onPlayStateChange?.(true);
        } else {
          video.pause();
          onPlayStateChange?.(false);
        }
      },
      seek: (progress) => {
        const video = videoRef.current;
        if (video?.duration) {
          video.currentTime = video.duration * progress;
        }
      },
      updateSelectedText: () => undefined,
    }), [onPlayStateChange]);

    return (
      <div className="flex h-full w-full items-center justify-center bg-black p-2">
        <div
          className="relative flex h-full max-h-full w-full max-w-full items-center justify-center overflow-hidden bg-black"
          style={containerAspectRatio ? { aspectRatio: containerAspectRatio } : undefined}
        >
          <video
            ref={videoRef}
            src={videoSrc}
            className="h-full w-full bg-black"
            style={{ objectFit: videoObjectFit }}
            playsInline
            preload="metadata"
            onLoadedMetadata={(event) => {
              const video = event.currentTarget;
              onVideoLoaded?.(video.videoWidth, video.videoHeight);
              onTimeUpdate?.(video.currentTime, video.duration || 0);
            }}
            onTimeUpdate={(event) => {
              const video = event.currentTarget;
              onTimeUpdate?.(video.currentTime, video.duration || 0);
            }}
            onPlay={() => onPlayStateChange?.(true)}
            onPause={() => onPlayStateChange?.(false)}
            onClick={() => {
              const video = videoRef.current;
              if (!video) {
                return;
              }
              if (video.paused) {
                void video.play();
                onPlayStateChange?.(true);
              } else {
                video.pause();
                onPlayStateChange?.(false);
              }
            }}
          />
        </div>
      </div>
    );
  },
);

NativeSmartSliceVideoPreview.displayName = 'NativeSmartSliceVideoPreview';

interface TextEffectPreset {
  id: string;
  name: string;
  text: string;
  styleConfig: TextEffectStyle;
}

interface VisibleLlmModelOption {
  vendor: ModelVendor;
  id: string;
  label: string;
}

type SmartSliceVisibleSttWorkflowPreset = AutoCutSpeechTranscriptionWorkflowPreset & {
  selectable: boolean;
  uiDisabledReason?: string;
  uiLabel: string;
};

type AutoCutTranslate = ReturnType<typeof useTranslation>['t'];
type SmartSliceRunMode = 'auto-render' | 'review-before-render';
type SliceReviewVisibilityFilter = 'all' | 'selected' | 'duplicates' | 'excluded';

const MODES: SliceMode[] = [
  'general',
  'talking-head',
  'commerce-live',
  'dialogue',
  'meeting',
  'performance',
  'film',
];

const SMART_CUT_ENGINE_PIPELINE_STEPS = [
  'Speech-to-text evidence',
  'Speaker diarization',
  'Semantic content units',
  'Candidate ID review',
  'Post-filter render',
] as const;

const SMART_CUT_ENGINE_BADGES = [
  'Speech-first',
  'speaker-aware',
  'ID-only LLM',
  'post-filter',
] as const;

type SmartCutEngineProductProfileId = 'commerce-live' | 'talking-head' | 'dialogue' | 'meeting' | 'performance' | 'film' | 'general';

interface SmartCutEngineProductProfile {
  id: SmartCutEngineProductProfileId;
  match: RegExp;
  title: string;
  strategy: string;
  primarySlicer: string;
  executionSupport: {
    ready: boolean;
    status: 'speech-first-ready' | 'native-evidence-adapter-required';
    blockerCode?: 'UNSUPPORTED_VISUAL_PRESET_EVIDENCE';
    label: string;
    detail: string;
  };
  speakerGate: 'adaptive-single-speaker' | 'required-diarization';
  boundaryContract: string;
  reviewContract: string;
  publishableClipContract: string;
  qaSplitContract: string;
  coverContract: string;
  outputPackage: readonly string[];
}

const SMART_CUT_ENGINE_PRODUCT_PROFILES: readonly SmartCutEngineProductProfile[] = [
  {
    id: 'commerce-live',
    match: /\u5546\u54c1|\u76f4\u64ad|commerce|live/iu,
    title: 'Commerce live highlight',
    strategy: 'Product proof, offer context, and conversion-ready complete speech units.',
    primarySlicer: 'commerce-live + speech-semantic',
    executionSupport: {
      ready: true,
      status: 'speech-first-ready',
      label: 'Speech-first ready',
      detail: 'Routes to the commerce-live product preset through STT, speaker evidence, semantic content units, ID-only review, and post-boundary filters.',
    },
    speakerGate: 'adaptive-single-speaker',
    boundaryContract: 'Do not split proof, price, objection, and call-to-action units.',
    reviewContract: 'Rank candidate ids by product value and keyword intent only.',
    publishableClipContract: 'Single publishable vertical clip under 90s with stable upper-body framing.',
    qaSplitContract: 'Not Q/A-first; preserve offer context and product proof as one selling arc.',
    coverContract: 'Auto cover must combine the core question, product proof, and clean brand frame.',
    outputPackage: ['Vertical clip', 'Transcript evidence', 'Cover frame', 'Audit manifest'],
  },
  {
    id: 'talking-head',
    match: /\u5355\u4eba|\u8bb2\u89e3|talking|teacher|course/iu,
    title: 'Talking-head semantic lesson',
    strategy: 'One speaker, one complete idea arc, strong opening and payoff.',
    primarySlicer: 'speech-semantic',
    executionSupport: {
      ready: true,
      status: 'speech-first-ready',
      label: 'Speech-first ready',
      detail: 'Runs the default STT-first semantic slicer with rule-based single-speaker evidence for talking-head sources.',
    },
    speakerGate: 'adaptive-single-speaker',
    boundaryContract: 'Keep setup, explanation, and payoff inside one semantic unit.',
    reviewContract: 'Rank candidate ids by clarity, continuity, and publishability.',
    publishableClipContract: 'Single teacher-style talking-head clip, <=90s, stable upper-body focus.',
    qaSplitContract: 'Not Q/A-first; split by one complete idea, example, or answerable topic.',
    coverContract: 'Auto cover must show the question and core takeaway with a clean professional frame.',
    outputPackage: ['Short video clip', 'Transcript evidence', 'Subtitle sidecar', 'Audit manifest'],
  },
  {
    id: 'dialogue',
    match: /interview|dialogue|qa|q&a|\u8fde\u7ebf|\u53cc\u4eba|\u591a\u4eba|\u8bbf\u8c08|\u5bf9\u8bdd|\u95ee\u7b54/iu,
    title: 'Speaker-aware dialogue',
    strategy: 'Question, answer, and speaker roles are kept together as complete Q/A units.',
    primarySlicer: 'dialogue-qa + speech-semantic',
    executionSupport: {
      ready: true,
      status: 'speech-first-ready',
      label: 'Diarization gate',
      detail: 'Runs only when transcript evidence carries real multi-speaker labels for interviewer, guest, moderator, or speaker roles.',
    },
    speakerGate: 'required-diarization',
    boundaryContract: 'Never output answer-only or question-only dialogue fragments.',
    reviewContract: 'Rank stable Q/A candidate ids; preserve interviewer and guest roles.',
    publishableClipContract: 'Batch publishable interview clips where every segment is a complete 1Q1A unit.',
    qaSplitContract: '1Q1A required: question, answer, and role evidence must stay inside the same clip.',
    coverContract: 'Auto cover should use the question plus guest answer hook, with speaker roles retained.',
    outputPackage: ['Dialogue clip', 'Speaker-role evidence', 'Transcript evidence', 'Audit manifest'],
  },
  {
    id: 'meeting',
    match: /meeting|conference|agenda|minutes|\u4f1a\u8bae|\u5728\u7ebf\u4f1a\u8bae/iu,
    title: 'Meeting decision highlight',
    strategy: 'Agenda items, owners, decisions, and follow-ups stay traceable.',
    primarySlicer: 'meeting-agenda + speech-semantic',
    executionSupport: {
      ready: true,
      status: 'speech-first-ready',
      label: 'Diarization gate',
      detail: 'Runs only when meeting transcript evidence preserves speaker ownership for agenda, decision, and follow-up units.',
    },
    speakerGate: 'required-diarization',
    boundaryContract: 'Keep decision context with the speaker turn that owns it.',
    reviewContract: 'Rank candidate ids by decision value and role completeness.',
    publishableClipContract: 'Decision or agenda clips must retain owner, context, decision, and follow-up.',
    qaSplitContract: 'Meeting turns are split by agenda decision, not by isolated speaker turns.',
    coverContract: 'Auto cover should show the decision topic and owner without exposing weak context.',
    outputPackage: ['Decision clip', 'Speaker-role evidence', 'Transcript evidence', 'Audit manifest'],
  },
  {
    id: 'performance',
    match: /\u624d\u827a|\u8868\u6f14|performance|show/iu,
    title: 'Performance moment',
    strategy: 'Speech evidence leads now; visual and audio-event slicers can extend this profile later.',
    primarySlicer: 'speech-semantic',
    executionSupport: {
      ready: true,
      status: 'speech-first-ready',
      label: 'Speech-first ready',
      detail: 'Runs speech-semantic moment slicing now; future visual and audio-event evidence can enrich the same strategy profile.',
    },
    speakerGate: 'adaptive-single-speaker',
    boundaryContract: 'Keep setup and performance payoff together.',
    reviewContract: 'Rank candidate ids by complete moment value.',
    publishableClipContract: 'Publish only complete moments with setup, performance beat, and payoff.',
    qaSplitContract: 'Not Q/A-first; preserve complete setup and performance payoff.',
    coverContract: 'Auto cover should use the best performance frame and concise moment title.',
    outputPackage: ['Moment clip', 'Transcript evidence', 'Filter report', 'Audit manifest'],
  },
  {
    id: 'film',
    match: /\u7535\u5f71|film|movie|documentary/iu,
    title: 'Narrative scene preview',
    strategy: 'Registered for future multimodal scene slicing; blocked until native visual/audio evidence adapters are available.',
    primarySlicer: 'film-scene + visual-scene',
    executionSupport: {
      ready: false,
      status: 'native-evidence-adapter-required',
      blockerCode: 'UNSUPPORTED_VISUAL_PRESET_EVIDENCE',
      label: 'Native evidence adapter required',
      detail: 'Film, documentary, music, sports, gaming, and screen-recording strategies require shot, OCR, waveform, beat, motion, or event evidence before commercial execution.',
    },
    speakerGate: 'adaptive-single-speaker',
    boundaryContract: 'Preserve narrative setup and payoff in one approved candidate.',
    reviewContract: 'Rank candidate ids by narrative completeness.',
    publishableClipContract: 'Scene preview clips preserve setup, conflict, and payoff without spoiler fragments.',
    qaSplitContract: 'Not Q/A-first; preserve narrative scene continuity.',
    coverContract: 'Auto cover should use a representative scene frame and narrative hook.',
    outputPackage: ['Scene clip', 'Transcript evidence', 'Render manifest', 'Audit manifest'],
  },
  {
    id: 'general',
    match: /.*/u,
    title: 'General semantic short',
    strategy: 'Build complete speech content units, then rank publishable short clips.',
    primarySlicer: 'speech-semantic',
    executionSupport: {
      ready: true,
      status: 'speech-first-ready',
      label: 'Speech-first ready',
      detail: 'Runs the default semantic short-video slicer using timestamped transcript and speaker-aware evidence.',
    },
    speakerGate: 'adaptive-single-speaker',
    boundaryContract: 'Complete semantic units must be accepted before filters run.',
    reviewContract: 'LLM can rank candidate ids and referenced unit ids only.',
    publishableClipContract: 'Publish only complete semantic clips that can stand alone.',
    qaSplitContract: 'Use Q/A splitting only when transcript evidence contains a complete question and answer.',
    coverContract: 'Auto cover should summarize the strongest complete idea.',
    outputPackage: ['Short video clip', 'Transcript evidence', 'Filter report', 'Audit manifest'],
  },
] as const;

function resolveSmartCutEngineProductProfile(mode: SliceMode | string) {
  const modeText = String(mode);
  const fallbackProfile = SMART_CUT_ENGINE_PRODUCT_PROFILES[SMART_CUT_ENGINE_PRODUCT_PROFILES.length - 1];
  if (!fallbackProfile) {
    throw new Error('Smart Cut Engine product profiles must not be empty.');
  }
  return SMART_CUT_ENGINE_PRODUCT_PROFILES.find((profile) => profile.match.test(modeText)) ?? fallbackProfile;
}

function formatSmartCutEngineModeLabel(mode: SliceMode | string) {
  return resolveSmartCutEngineProductProfile(mode).title;
}

function createSmartCutEngineProductExperience({
  mode,
  targetPlatform,
  aspectRatio,
  idealDuration,
  enableSubtitles,
  subtitleMode,
  minDuration,
  maxDuration,
  noiseReduction,
  coughFilter,
  repeatFilter,
}: {
  mode: SliceMode | string;
  targetPlatform: SliceTargetPlatform;
  aspectRatio: SliceTargetAspectRatio;
  idealDuration: number;
  enableSubtitles: boolean;
  subtitleMode: SliceSubtitleMode;
  minDuration: number;
  maxDuration: number;
  noiseReduction: boolean;
  coughFilter: boolean;
  repeatFilter: boolean;
}) {
  const profile = resolveSmartCutEngineProductProfile(mode);
  const formatContract = `${aspectRatio === 'auto' ? '9:16 adaptive default' : aspectRatio} / 1080x1920 / 30fps MP4`;
  const subtitleContract = enableSubtitles
    ? `${subtitleMode} subtitles with sentence-level speech sync and highlight-ready captions`
    : 'Subtitle package disabled; transcript evidence is still retained for audit';
  const cleanupContract = [
    noiseReduction ? 'voice enhancement' : 'raw audio preserved',
    coughFilter ? 'pause/cough/silence cleanup' : 'no silence cleanup',
    repeatFilter ? 'repeat dedupe' : 'repeat evidence retained',
  ].join(' + ');
  const durationContract = profile.id === 'dialogue'
    ? '1Q1A clips inside selected bounds'
    : profile.id === 'meeting'
      ? 'agenda/decision clips inside selected bounds'
      : maxDuration >= 180
        ? '60-180s matrix-ready long-interview clips'
        : `${minDuration}-${maxDuration}s clips; ideal ${idealDuration}s`;
  const reviewCheckpoint = 'Human Review: inspect transcript evidence, speaker roles, cover frame, subtitles, and filter decisions before export.';
  const failClosedPolicy = profile.speakerGate === 'required-diarization'
    ? 'Fail Closed: weak transcript or missing speaker diarization blocks commercial slicing.'
    : 'Fail Closed: weak transcript timing, empty speech evidence, or invalid boundaries block commercial slicing.';
  return {
    profile,
    requiresSpeakerDiarization: profile.speakerGate === 'required-diarization',
    publishProfile: `${targetPlatform} / ${aspectRatio}`,
    durationTarget: `${idealDuration}s target`,
    subtitleOutput: enableSubtitles ? subtitleMode : 'none',
    publishableClipContract: profile.publishableClipContract,
    qaSplitContract: profile.qaSplitContract,
    formatContract,
    durationContract,
    subtitleContract,
    cleanupContract,
    coverContract: `${profile.coverContract} Prompt sound and light music can be packaged after boundary approval.`,
    reviewCheckpoint,
    failClosedPolicy,
    outputPackage: profile.outputPackage,
  };
}

function smartCutRequiresSpeakerDiarization(mode: SliceMode | string) {
  return /interview|dialogue|meeting|conference|qa|q&a|\u8fde\u7ebf|\u53cc\u4eba|\u591a\u4eba|\u4f1a\u8bae|\u8bbf\u8c08|\u5bf9\u8bdd|\u95ee\u7b54/iu.test(String(mode));
}

function normalizeSlicerNumberInput(
  rawValue: string,
  currentValue: number,
  minValue: number,
  maxValue: number,
) {
  const numericValue = Number(rawValue);
  if (!Number.isFinite(numericValue)) {
    return currentValue;
  }

  return Math.max(minValue, Math.min(maxValue, Math.round(numericValue)));
}

function getSmartSliceErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return '';
}

function createSmartSliceFailureToastMessage(error: unknown, t: AutoCutTranslate) {
  const errorMessage = getSmartSliceErrorMessage(error).trim();
  return errorMessage
    ? `${t('slicer.speechSetup.smartSliceFailedPrefix')}${errorMessage}`
    : t('slicer.speechSetup.smartSliceFailedFallback');
}

function createSmartSliceSubmissionDiagnostics(params: VideoSliceParams) {
  return {
    source: params.file
      ? 'file'
      : params.fileId
        ? 'fileId'
        : params.url
          ? 'url'
          : 'missing',
    fileName: params.file?.name,
    fileSize: params.file?.size,
    fileId: params.fileId,
    hasUrl: Boolean(params.url?.trim()),
    mode: params.mode,
    llmModel: params.llmModel,
    segmentationAgentId: params.segmentationAgentId,
    targetPlatform: params.targetPlatform,
    targetAspectRatio: params.targetAspectRatio,
    videoObjectFit: params.videoObjectFit,
    idealDuration: params.idealDuration,
    minDuration: params.minDuration,
    maxDuration: params.maxDuration,
    continuityLevel: params.continuityLevel,
    segmentationDensity: params.segmentationDensity,
    customKeywordCount: params.customKeywords?.length ?? 0,
    baseAlgorithm: params.baseAlgorithm,
    highlightEngine: params.highlightEngine,
    enableSubtitles: params.enableSubtitles,
    subtitleMode: params.subtitleMode,
    subtitleStyleId: params.subtitleStyleId,
    enableSmartDedup: params.enableSmartDedup,
    videoDedupStrategyCount: params.videoDedupParams?.strategies.length ?? 0,
  };
}

function formatSmartSliceSpeechSetupBytes(value: number | undefined) {
  if (!Number.isFinite(value) || !value || value <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${unitIndex === 0 ? Math.round(size) : size.toFixed(1)} ${units[unitIndex]}`;
}

function formatSmartSliceSpeechSetupPath(path: string | undefined) {
  const value = path?.trim();
  if (!value) {
    return '';
  }
  const normalized = value.replace(/\\/gu, '/');
  const fileName = normalized.split('/').filter(Boolean).at(-1);
  return fileName || value;
}

function createSmartSliceSpeechSetupFriendlyError(errorMessage: string, t: AutoCutTranslate) {
  const rawMessage = errorMessage.trim();
  if (!rawMessage) {
    return '';
  }
  const message = rawMessage.toLowerCase();
  if (
    message.includes('checksum') ||
    message.includes('integrity') ||
    message.includes('sha-256') ||
    message.includes('did not pass integrity')
  ) {
    return t('slicer.speechSetup.error.integrity');
  }
  if (
    message.includes('incomplete') ||
    message.includes('did not finish') ||
    message.includes('empty file')
  ) {
    return t('slicer.speechSetup.error.incomplete');
  }
  if (
    message.includes('download') ||
    message.includes('network') ||
    message.includes('connection') ||
    message.includes('timed out') ||
    message.includes('timeout') ||
    message.includes('http status') ||
    message.includes('trusted source')
  ) {
    return t('slicer.speechSetup.error.download');
  }
  if (
    message.includes('executable') ||
    message.includes('whisper-cli') ||
    message.includes('sidecar')
  ) {
    return t('slicer.speechSetup.error.executable');
  }
  if (
    message.includes('model') ||
    message.includes('modelpath')
  ) {
    return t('slicer.speechSetup.error.model');
  }

  return rawMessage.length > 180
    ? t('slicer.speechSetup.error.generic')
    : rawMessage;
}

function getSmartSliceSpeechSetupProgressLabel(progress: AutoCutSpeechTranscriptionModelDownloadProgressEvent | null, t: AutoCutTranslate) {
  if (!progress) {
    return t('slicer.speechSetup.progress.waiting');
  }
  if (progress.phase === AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_PHASE.completed) {
    return t('slicer.speechSetup.progress.completed');
  }
  if (progress.phase === AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_PHASE.skipped) {
    return t('slicer.speechSetup.progress.skipped');
  }
  if (progress.errorMessage) {
    return createSmartSliceSpeechSetupFriendlyError(progress.errorMessage, t);
  }

  const downloaded = formatSmartSliceSpeechSetupBytes(progress.downloadedBytes);
  const total = progress.totalBytes ? formatSmartSliceSpeechSetupBytes(progress.totalBytes) : '';
  return total ? `${downloaded} / ${total}` : downloaded;
}

function createSmartSliceSpeechSetupStatusText(
  status: AutoCutLocalSpeechTranscriptionSetupStatus | null,
  errorMessage: string,
  t: AutoCutTranslate,
  modelDownloadCompleted = false,
) {
  if (errorMessage) {
    if (modelDownloadCompleted) {
      return t('slicer.speechSetup.status.modelSavedNeedsCheck');
    }
    return createSmartSliceSpeechSetupFriendlyError(errorMessage, t);
  }
  if (!status) {
    return t('slicer.speechSetup.status.checking');
  }
  if (status.readiness === AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.ready) {
    return t('slicer.speechSetup.status.ready');
  }
  if (status.readiness === AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.needsExecutable) {
    return status.capabilities.toolchainReady
      ? t('slicer.speechSetup.status.executableReady')
      : t('slicer.speechSetup.status.executableMissing');
  }
  if (status.readiness === AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.needsModel) {
    return t('slicer.speechSetup.status.needsModel', { model: status.model.preset.label });
  }
  if (status.readiness === AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.needsTest) {
    return t('slicer.speechSetup.status.needsTest');
  }

  return createSmartSliceSpeechSetupFriendlyError(status.diagnostics[0] ?? '', t) ||
    t('slicer.speechSetup.status.fallback');
}

function waitForSmartSliceUiYield() {
  return new Promise<void>((resolve) => {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          setTimeout(() => resolve(), 0);
        });
      });
      return;
    }

    setTimeout(() => resolve(), 0);
  });
}

export function SlicerPage() {
  const commonLabels = useAutoCutCommonLabels();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const playerRef = useRef<SmartSlicePlayerRef>(null);
  const replaceVideoInputRef = useRef<HTMLInputElement>(null);
  const initialSourceUrl = searchParams.get('url')?.trim() ?? '';
  const initialReviewTaskId = searchParams.get('reviewTaskId')?.trim() ?? '';
  const routeState = location.state as {
    initialFile?: File;
    initialFileId?: string;
    initialTrustedFileSource?: AutoCutTrustedFileSourceDescriptor;
  } | null;
  const initialTrustedFileSource = routeState?.initialTrustedFileSource;
  const initialFile = initialTrustedFileSource
    ? createAutoCutTrustedLocalFile(initialTrustedFileSource)
    : routeState?.initialFile ?? null;
  const initialFileId = routeState?.initialFileId?.trim() ?? '';

  const [selectedMode, setSelectedMode] = useState<SliceMode>('general');
  const [isProcessing, setIsProcessing] = useState(false);
  const [file, setFile] = useState<File | null>(initialFile);
  const [fileId, setFileId] = useState<string>(initialFileId);
  const [sourceUrl] = useState(initialSourceUrl);
  const [videoSrc, setVideoSrc] = useState<string>(initialSourceUrl);
  const [aspectRatio, setAspectRatio] = useState<SliceTargetAspectRatio>("auto");
  const [videoObjectFit, setVideoObjectFit] = useState<SliceVideoObjectFit>('contain');
  const [detectedRatio, setDetectedRatio] = useState<string>("16:9");

  const [enableSubtitles, setEnableSubtitles] = useState(false);
  const [subtitleMode, setSubtitleMode] = useState<SliceSubtitleMode>('both');
  const [selectedSubtitleStyle, setSelectedSubtitleStyle] = useState('tiktok');

  const [slicerTasks, setSlicerTasks] = useState<AppTask[]>([]);
  const [activeLeftTab, setActiveLeftTab] = useState<'text' | 'tasks'>('tasks');
  const [runMode, setRunMode] = useState<SmartSliceRunMode>('review-before-render');
  const [activeReviewTaskId, setActiveReviewTaskId] = useState<string>(initialReviewTaskId);
  const [reviewSessionDraft, setReviewSessionDraft] = useState<AutoCutSliceReviewSession | null>(null);
  const [selectedReviewSegmentIds, setSelectedReviewSegmentIds] = useState<string[]>([]);
  const [reviewVisibilityFilter, setReviewVisibilityFilter] = useState<SliceReviewVisibilityFilter>('all');
  const [activeReviewSegmentId, setActiveReviewSegmentId] = useState<string>('');
  const [reviewManualEdits, setReviewManualEdits] = useState<AutoCutSliceManualEdit[]>([]);
  const [isRenderingReviewSelection, setIsRenderingReviewSelection] = useState(false);
  const [isSavingReviewDraft, setIsSavingReviewDraft] = useState(false);
  const [reviewDraftSavedAt, setReviewDraftSavedAt] = useState<string>('');
  const [reviewDraftSaveError, setReviewDraftSaveError] = useState<string>('');
  const [reviewCorrectionDraft, setReviewCorrectionDraft] = useState({
    title: '',
    startMs: '',
    endMs: '',
    transcriptText: '',
    speakerRoles: '',
    manualNotes: '',
  });
  const [selectedTextInfo, setSelectedTextInfo] = useState<{ id: string; text: string; fontSize: number; fill: string; x?: number; y?: number; rotation?: number; scale?: number; } | null>(null);
  const [speechSetupDialogOpen, setSpeechSetupDialogOpen] = useState(false);
  const [speechSetupStatus, setSpeechSetupStatus] = useState<AutoCutLocalSpeechTranscriptionSetupStatus | null>(null);
  const [speechSetupErrorMessage, setSpeechSetupErrorMessage] = useState('');
  const [isInspectingSpeechSetup, setIsInspectingSpeechSetup] = useState(false);
  const [isInitializingSpeechSetup, setIsInitializingSpeechSetup] = useState(false);
  const [speechModelDownloadProgress, setSpeechModelDownloadProgress] = useState<AutoCutSpeechTranscriptionModelDownloadProgressEvent | null>(null);
  const [enableOverlayEditor, setEnableOverlayEditor] = useState(false);
  const webGlPlayerRef = playerRef as React.MutableRefObject<WebGLPlayerRef | null>;
  const shouldUseWebGlOverlayEditor = enableOverlayEditor && videoSrc;
  const speechModelDownloadPhase = speechModelDownloadProgress?.phase;
  const speechModelDownloadCompleted =
    speechModelDownloadPhase === AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_PHASE.completed;
  const speechModelDownloadFailed =
    speechModelDownloadPhase === AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_PHASE.failed;
  const speechModelDownloadActive =
    speechModelDownloadPhase === AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_PHASE.started ||
    speechModelDownloadPhase === AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_PHASE.downloading;
  const speechModelProgressPercent = speechModelDownloadCompleted
    ? 100
    : Math.min(100, Math.max(0, speechModelDownloadProgress?.progress ?? 0));
  const speechModelReadyForDisplay = speechSetupStatus?.model.ready === true || speechModelDownloadCompleted;
  const speechModelDetailForDisplay = formatSmartSliceSpeechSetupPath(
    speechModelDownloadProgress?.modelPath ||
      speechSetupStatus?.model.path ||
      speechSetupStatus?.defaults.modelPath,
  ) || speechSetupStatus?.model.preset.label || t('slicer.speechSetup.model.recommended');
  const speechFinalCheckNeedsAttention =
    Boolean(speechSetupErrorMessage) && speechModelDownloadCompleted;
  const speechSetupBusy = isInspectingSpeechSetup || isInitializingSpeechSetup;

  // Slicing advanced parameters
  const [targetPlatform, setTargetPlatform] = useState<SliceTargetPlatform>('douyin');
  const [idealDuration, setIdealDuration] = useState<number>(45);
  const [continuityLevel, setContinuityLevel] = useState<SliceContinuityLevel>('standard');
  const [segmentationDensity, setSegmentationDensity] = useState<SliceSegmentationDensity>('default');
  const [sttPresetId, setSttPresetId] = useState<string>(AUTOCUT_DEFAULT_SPEECH_TRANSCRIPTION_WORKFLOW_PRESET_ID);
  const [customKeywordsInput, setCustomKeywordsInput] = useState<string>('');
  const [minDuration, setMinDuration] = useState<number>(15);
  const [maxDuration, setMaxDuration] = useState<number>(90);
  const [activeLlmRuntimeModelVendor, setActiveLlmRuntimeModelVendor] = useState<ModelVendor>('deepseek');
  const [activeLlmRuntimeConfig, setActiveLlmRuntimeConfig] = useState<AutoCutLlmRuntimeConfig | null>(null);
  const [llmModel, setLlmModel] = useState<SliceLLM>('deepseek-v4-flash');
  const [segmentationAgentId, setSegmentationAgentId] = useState<AutoCutSmartSliceSegmentationAgentId>(
    AUTOCUT_DEFAULT_SMART_SLICE_SEGMENTATION_AGENT_ID,
  );
  const [noiseReduction, setNoiseReduction] = useState<boolean>(true);
  const [coughFilter, setCoughFilter] = useState<boolean>(true);
  const [repeatFilter, setRepeatFilter] = useState<boolean>(false);
  const [enableSmartDedup, setEnableSmartDedup] = useState<boolean>(false);
  const [videoDedupParams, setVideoDedupParams] = useState<VideoDedupParams>(() =>
    createDefaultAutoCutVideoDedupParams({ mode: 'slice-result-dedup' }),
  );
  const [latestVideoDedupReport, setLatestVideoDedupReport] = useState<VideoDedupReport | null>(null);
  const selectedSegmentationAgent = useMemo(
    () => getAutoCutSmartSliceSegmentationAgentDefinition(segmentationAgentId),
    [segmentationAgentId],
  );
  const speechGpuDiagnosticsText = speechSetupStatus?.gpu.diagnostics.join('\n') ?? '';
  const availableSttWorkflowPresets = useMemo<SmartSliceVisibleSttWorkflowPreset[]>(
    () => AUTOCUT_SPEECH_TRANSCRIPTION_WORKFLOW_PRESETS.filter((preset) => preset.available).map((preset) => {
      const gpuPresetWithoutRuntime =
        preset.executionProfile === 'gpu' && speechSetupStatus?.gpu.ready !== true;
      const apiPresetWithoutCredentials =
        preset.executionProfile === 'cloud' &&
        (!activeLlmRuntimeConfig?.apiKeyConfigured ||
          (preset.modelVendor !== undefined && activeLlmRuntimeConfig.modelVendor !== preset.modelVendor));
      const uiDisabledReason = gpuPresetWithoutRuntime
        ? speechSetupStatus?.gpu.diagnostics[0] ?? SMART_SLICE_GPU_STT_RUNTIME_REQUIRED_REASON
        : apiPresetWithoutCredentials
          ? `Configure the ${preset.modelVendor ?? 'matching'} ModelVendor API key in Settings before using Smart cloud STT.`
          : undefined;
      return {
        ...preset,
        selectable: !gpuPresetWithoutRuntime && !apiPresetWithoutCredentials,
        ...(uiDisabledReason ? { uiDisabledReason } : {}),
        uiLabel: gpuPresetWithoutRuntime
          ? `${preset.label} (requires GPU runtime)`
          : apiPresetWithoutCredentials
            ? `${preset.label} (configure API key)`
            : 'recommended' in preset && preset.recommended === true
              ? `${preset.label} (recommended)`
              : preset.label,
      };
    }),
    [activeLlmRuntimeConfig?.apiKeyConfigured, activeLlmRuntimeConfig?.modelVendor, speechGpuDiagnosticsText, speechSetupStatus?.gpu.ready],
  );
  const selectedSttWorkflowPreset = useMemo(
    () =>
      availableSttWorkflowPresets.find((preset) => preset.id === sttPresetId && preset.selectable) ??
      availableSttWorkflowPresets.find((preset) => preset.id === AUTOCUT_DEFAULT_SPEECH_TRANSCRIPTION_WORKFLOW_PRESET_ID) ??
      availableSttWorkflowPresets[0],
    [availableSttWorkflowPresets, sttPresetId],
  );
  const selectedSttWorkflowPresetDisabledReason =
    availableSttWorkflowPresets.find((preset) => preset.id === sttPresetId && !preset.selectable)?.uiDisabledReason;
  const effectiveSttPresetId =
    selectedSttWorkflowPreset?.id ?? AUTOCUT_DEFAULT_SPEECH_TRANSCRIPTION_WORKFLOW_PRESET_ID;
  useEffect(() => {
    if (speechSetupStatus && selectedSttWorkflowPresetDisabledReason && sttPresetId !== effectiveSttPresetId) {
      setSttPresetId(effectiveSttPresetId);
    }
  }, [effectiveSttPresetId, selectedSttWorkflowPresetDisabledReason, speechSetupStatus, sttPresetId]);
  const smartCutExperience = createSmartCutEngineProductExperience({
    mode: selectedMode,
    targetPlatform,
    aspectRatio,
    idealDuration,
    enableSubtitles,
    subtitleMode,
    minDuration,
    maxDuration,
    noiseReduction,
    coughFilter,
    repeatFilter,
  });
  const requiresSpeakerDiarization =
    smartCutExperience.requiresSpeakerDiarization || smartCutRequiresSpeakerDiarization(selectedMode);
  const hasVideoSource = Boolean(file || fileId || sourceUrl || videoSrc);
  const strategyExecutionSupport = smartCutExperience.profile.executionSupport;
  const activeReviewTask = useMemo(
    () => slicerTasks.find((task) => task.id === activeReviewTaskId && task.sliceReviewSession) ??
      (!hasVideoSource && !activeReviewTaskId
        ? slicerTasks.find((task) => task.status === AUTOCUT_TASK_STATUS.reviewing && task.sliceReviewSession)
        : undefined),
    [activeReviewTaskId, hasVideoSource, slicerTasks],
  );
  const effectiveReviewSession = reviewSessionDraft ?? activeReviewTask?.sliceReviewSession ?? null;
  const reviewSegments = effectiveReviewSession?.segments ?? [];
  const selectedReviewSegmentCount = selectedReviewSegmentIds.length;
  const duplicateReviewSegmentCount = reviewSegments.filter((segment) => segment.status === 'duplicate').length;
  const duplicateReviewGroupCount = effectiveReviewSession?.duplicateGroups.length ?? 0;
  const smartDedupRiskSegmentCount = reviewSegments.filter((segment) =>
    segment.risks.includes(SMART_SLICE_DEDUP_REVIEW_RISK_CODE),
  ).length;
  const excludedReviewSegmentCount = reviewSegments.filter((segment) => segment.status === 'excluded').length;
  const visibleReviewSegments = useMemo(() => {
    if (reviewVisibilityFilter === 'selected') {
      return reviewSegments.filter((segment) =>
        selectedReviewSegmentIds.includes(segment.id) && segment.status === 'selected',
      );
    }
    if (reviewVisibilityFilter === 'duplicates') {
      return reviewSegments.filter(isSliceReviewDuplicateRiskSegment);
    }
    if (reviewVisibilityFilter === 'excluded') {
      return reviewSegments.filter((segment) => segment.status === 'excluded');
    }
    return reviewSegments;
  }, [reviewSegments, reviewVisibilityFilter, selectedReviewSegmentIds]);
  const activeReviewSegment = useMemo(
    () => reviewSegments.find((segment) => segment.id === activeReviewSegmentId) ?? visibleReviewSegments[0] ?? reviewSegments[0],
    [activeReviewSegmentId, reviewSegments, visibleReviewSegments],
  );
  useEffect(() => {
    if (!activeReviewSegment) {
      setReviewCorrectionDraft({
        title: '',
        startMs: '',
        endMs: '',
        transcriptText: '',
        speakerRoles: '',
        manualNotes: '',
      });
      return;
    }
    setReviewCorrectionDraft({
      title: activeReviewSegment.title,
      startMs: String(activeReviewSegment.startMs),
      endMs: String(activeReviewSegment.endMs),
      transcriptText: activeReviewSegment.transcriptText ?? '',
      speakerRoles: (activeReviewSegment.speakerRoles.length
        ? activeReviewSegment.speakerRoles
        : activeReviewSegment.speakerIds
      ).join(', '),
      manualNotes: activeReviewSegment.manualNotes ?? '',
    });
  }, [activeReviewSegment?.id]);
  const engineReadinessItems = [
    {
      label: 'STT',
      value: speechModelReadyForDisplay || speechSetupStatus?.readiness === AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.ready ? 'Ready' : 'Check',
    },
    {
      label: 'Speaker',
      value: requiresSpeakerDiarization ? 'Required' : 'Adaptive',
    },
    {
      label: 'Strategy',
      value: strategyExecutionSupport.label,
    },
    {
      label: 'Audit',
      value: 'contentUnitIds + speakerRoles',
    },
  ];
  const commercialReadinessItems = [
    {
      label: 'Source Evidence',
      value: hasVideoSource ? 'Ready' : 'Missing source video',
      blocked: !hasVideoSource,
    },
    {
      label: 'Speech Evidence',
      value: speechModelReadyForDisplay || speechSetupStatus?.readiness === AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.ready ? 'STT ready' : 'STT preflight required',
      blocked: false,
    },
    {
      label: 'Speaker Evidence',
      value: requiresSpeakerDiarization ? 'Diarization required' : 'Single speaker adapter allowed',
      blocked: false,
    },
    {
      label: 'Strategy Capability',
      value: strategyExecutionSupport.ready ? strategyExecutionSupport.label : 'Native evidence adapter required',
      blocked: !strategyExecutionSupport.ready,
    },
    {
      label: 'Export Contract',
      value: smartCutExperience.formatContract,
      blocked: false,
    },
  ];
  const hasCommercialReadinessBlocker = commercialReadinessItems.some((item) => item.blocked);

  const TEXT_EFFECTS: TextEffectPreset[] = [
    {
      id: 'tiktok',
      name: 'Viral red-blue',
      text: 'Ready for the big reveal?',
      styleConfig: {
        fill: '#00ebff',
        stroke: { color: '#ff0050', width: 4 },
        dropShadow: { color: '#000000', blur: 4, angle: Math.PI/4, distance: 4, alpha: 1 },
        fontFamily: 'system-ui', fontWeight: '900', letterSpacing: 2, fontSize: 48
      }
    },
    {
      id: 'variety',
      name: 'Variety bold',
      text: 'This is the key moment!',
      styleConfig: {
        fill: '#fffc00',
        stroke: { color: '#ffffff', width: 4 },
        dropShadow: { color: '#ff0000', blur: 0, angle: Math.PI/2, distance: 6, alpha: 1 },
        fontFamily: 'system-ui', fontWeight: '900', letterSpacing: 1, fontSize: 52
      }
    },
    {
      id: 'gradient-cyan',
      name: 'Cyan gradient',
      text: 'Watch this result',
      styleConfig: {
        fill: ['#00FF87', '#60EFFF'],
        fillGradientType: 1,
        stroke: { color: '#000000', width: 6 },
        dropShadow: { color: '#000000', blur: 6, angle: Math.PI/4, distance: 4, alpha: 0.8 },
        fontFamily: 'system-ui', fontWeight: '900', letterSpacing: 2, fontSize: 50
      }
    },
    {
      id: 'fire',
      name: 'Fire impact',
      text: 'Limited-time offer',
      styleConfig: {
        fill: ['#FFD100', '#FF7A00', '#FF0000'],
        fillGradientType: 0,
        stroke: { color: '#FFFFFF', width: 4 },
        dropShadow: { color: '#FF0000', blur: 10, angle: 0, distance: 0, alpha: 1 },
        fontFamily: 'system-ui', fontWeight: '900', fontStyle: 'italic', fontSize: 54
      }
    },
    {
      id: 'neon',
      name: 'Neon glow',
      text: 'Link opens now',
      styleConfig: {
        fill: '#ffffff',
        stroke: { color: '#d926ff', width: 2 },
        dropShadow: { color: '#d926ff', blur: 15, angle: 0, distance: 0, alpha: 1 },
        fontFamily: 'system-ui', fontWeight: 'bold', fontSize: 48
      }
    },
    {
      id: 'gold',
      name: 'Gold premium',
      text: 'Creator verified',
      styleConfig: {
        fill: ['#FFE066', '#D4AF37'],
        fillGradientType: 0,
        stroke: { color: '#000000', width: 6 },
        dropShadow: { color: '#000000', blur: 8, angle: Math.PI/4, distance: 6, alpha: 1 },
        fontFamily: 'system-ui', fontWeight: '900', fontStyle: 'italic', fontSize: 48
      }
    },
    {
      id: 'retro-pop',
      name: 'Retro pop',
      text: 'Oh My God!',
      styleConfig: {
        fill: '#FF00B2',
        stroke: { color: '#000000', width: 5 },
        dropShadow: { color: '#00FFFF', blur: 0, angle: Math.PI/4, distance: 6, alpha: 1 },
        fontFamily: 'Impact, system-ui', fontWeight: '900', fontSize: 50, letterSpacing: 2
      }
    },
    {
      id: 'thick-border',
      name: 'Thick outline',
      text: 'Final 50 spots',
      styleConfig: {
        fill: '#FFF500',
        stroke: { color: '#000000', width: 10 },
        fontFamily: 'system-ui', fontWeight: '900', fontSize: 55, letterSpacing: 1
      }
    },
    {
      id: 'minimal',
      name: 'Minimal white',
      text: 'Clean key point',
      styleConfig: {
        fill: '#ffffff',
        stroke: { color: '#000000', width: 3 },
        dropShadow: { color: '#000000', blur: 8, angle: Math.PI/4, distance: 4, alpha: 0.8 },
        fontFamily: 'system-ui', fontWeight: '600', fontSize: 44
      }
    },
    {
      id: 'title-retro',
      name: 'Retro title',
      text: 'Chapter highlight',
      styleConfig: {
        fill: ['#FF7E00', '#FFCD00'],
        fillGradientType: 0,
        stroke: { color: '#000000', width: 6 },
        dropShadow: { color: '#FF0055', blur: 0, angle: Math.PI/4, distance: 8, alpha: 1 },
        fontFamily: 'serif', fontWeight: '900', fontSize: 52
      }
    },
    {
      id: '3d-block',
      name: '3D block',
      text: 'New launch',
      styleConfig: {
        fill: '#FFFFFF',
        stroke: { color: '#0055FF', width: 4 },
        dropShadow: { color: '#0022AA', blur: 0, angle: Math.PI/2, distance: 10, alpha: 1 },
        fontFamily: 'system-ui', fontWeight: '900', letterSpacing: 3, fontSize: 50
      }
    },
    {
      id: 'bubble-gum',
      name: 'Bubble gum',
      text: 'Sweet hook',
      styleConfig: {
        fill: '#FFB6C1',
        stroke: { color: '#FF1493', width: 6 },
        dropShadow: { color: '#FFFFFF', blur: 0, angle: Math.PI/4, distance: 4, alpha: 1 },
        fontFamily: 'cursive, system-ui', fontWeight: '900', fontSize: 48, letterSpacing: 2
      }
    }
  ];

  useEffect(() => {
    if (file) {
      const trustedSourcePath = resolveAutoCutTrustedSourcePath(file);
      if (trustedSourcePath) {
        try {
          setVideoSrc(getAutoCutNativeHostClient().createAssetUrl(trustedSourcePath));
        } catch (error) {
          reportAutoCutDiagnostic('warning', 'slicer', 'Trusted desktop video preview failed', error);
          setVideoSrc('');
        }
        return;
      }

      const url = createAutoCutObjectUrl(file);
      setVideoSrc(url);
      return () => revokeAutoCutObjectUrl(url);
    }
  }, [file]);

  useEffect(() => {
    const fetchTasks = () => {
      getTasks().then(tasks => {
        setSlicerTasks(tasks.filter(t => t.type === AUTOCUT_TASK_TYPE.videoSlice));
      });
    };
    const handleSlicerTaskUpdated = (updatedTask: AppTask) => {
      setSlicerTasks((currentTasks) => mergeSlicerTaskUpdate(currentTasks, updatedTask));
    };
    const handleSlicerTaskAdded = (addedTask: AppTask) => {
      setSlicerTasks((currentTasks) => mergeSlicerTaskUpdate(currentTasks, addedTask));
    };
    fetchTasks();
    const stopTaskUpdated = listenAutoCutEvent('taskUpdated', handleSlicerTaskUpdated);
    const stopTaskAdded = listenAutoCutEvent('taskAdded', handleSlicerTaskAdded);
    return () => {
      stopTaskUpdated();
      stopTaskAdded();
    };
  }, []);

  useEffect(() => {
    const nextReviewSession = activeReviewTask?.sliceReviewSession;
    if (!activeReviewTask || !nextReviewSession) {
      return;
    }
    if (!shouldHydrateSmartSliceReviewSessionFromTask({
      currentTaskId: activeReviewTaskId,
      nextTaskId: activeReviewTask.id,
      currentDraft: reviewSessionDraft,
      nextSession: nextReviewSession,
      currentManualEditCount: reviewManualEdits.length,
    })) {
      return;
    }
    setActiveReviewTaskId(activeReviewTask.id);
    setReviewSessionDraft(nextReviewSession);
    setSelectedReviewSegmentIds(nextReviewSession.selectedSegmentIds);
    setActiveReviewSegmentId(
      nextReviewSession.selectedSegmentIds[0] ??
        nextReviewSession.segments[0]?.id ??
        '',
    );
    setReviewManualEdits([]);
  }, [activeReviewTask?.id, activeReviewTask?.sliceReviewSession, activeReviewTaskId, reviewManualEdits.length, reviewSessionDraft?.id]);

  useEffect(() => {
    if (targetPlatform === 'bilibili') {
      setAspectRatio('16:9');
      setVideoObjectFit('contain');
      setIdealDuration(90);
      return;
    }

    if (targetPlatform === 'xiaohongshu') {
      setAspectRatio('9:16');
      setVideoObjectFit('cover');
      setIdealDuration(35);
      return;
    }

    if (targetPlatform !== 'generic') {
      setAspectRatio('9:16');
      setVideoObjectFit('cover');
      setIdealDuration(45);
    }
  }, [targetPlatform]);

  useEffect(() => {
    resolveAutoCutLlmRuntimeConfig()
      .then((config) => {
        setActiveLlmRuntimeConfig(config);
        setActiveLlmRuntimeModelVendor(config.modelVendor);
        setLlmModel(config.model as SliceLLM);
        setSegmentationAgentId(config.defaultSegmentationAgentId);
      })
      .catch((error) => reportAutoCutDiagnostic('warning', 'slicer', 'Load default LLM model failed', error));
  }, []);

  const activeLlmModelOptions = useMemo(
    () => AUTOCUT_SLICE_LLM_MODEL_OPTIONS.filter((model) => model.vendor === activeLlmRuntimeModelVendor),
    [activeLlmRuntimeModelVendor],
  );
  const visibleLlmModelOptions = useMemo<VisibleLlmModelOption[]>(() => {
    if (activeLlmRuntimeModelVendor === 'custom') {
      return [{ vendor: 'custom', id: llmModel, label: llmModel || 'Custom model' }];
    }

    return activeLlmModelOptions.length > 0
      ? activeLlmModelOptions
      : AUTOCUT_SLICE_LLM_MODEL_OPTIONS.filter((model) => model.vendor === 'deepseek');
  }, [activeLlmModelOptions, activeLlmRuntimeModelVendor, llmModel]);

  useEffect(() => {
    const currentModelIsVisible = visibleLlmModelOptions.some((model) => model.id === llmModel);
    if (!currentModelIsVisible) {
      setLlmModel(AUTOCUT_MODEL_VENDOR_PRESETS[activeLlmRuntimeModelVendor].defaultModel as SliceLLM);
    }
  }, [activeLlmRuntimeModelVendor, llmModel, visibleLlmModelOptions]);

  // Video Player state
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [videoProgress, setVideoProgress] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  useEffect(() => {
    getAutoCutWorkflowPreferences()
      .then((preferences) => {
        const videoSlice = preferences.videoSlice;
        if (MODES.includes(videoSlice.mode as SliceMode)) {
          setSelectedMode(videoSlice.mode as SliceMode);
        }
        setAspectRatio(videoSlice.targetAspectRatio);
        setVideoObjectFit(videoSlice.videoObjectFit);
        setEnableSubtitles(videoSlice.enableSubtitles);
        setSubtitleMode(videoSlice.subtitleMode);
        setSelectedSubtitleStyle(videoSlice.subtitleStyleId);
        setTargetPlatform(videoSlice.targetPlatform);
        setIdealDuration(videoSlice.idealDuration);
        setContinuityLevel(videoSlice.continuityLevel);
        setSegmentationDensity(videoSlice.segmentationDensity);
        setSttPresetId(videoSlice.sttPresetId);
        setCustomKeywordsInput(videoSlice.customKeywordsInput);
        setMinDuration(videoSlice.minDuration);
        setMaxDuration(videoSlice.maxDuration);
        setSegmentationAgentId(videoSlice.segmentationAgentId);
        setNoiseReduction(videoSlice.enableNoiseReduction);
        setCoughFilter(videoSlice.enableCoughFilter);
        setRepeatFilter(videoSlice.enableRepeatFilter);
        setEnableSmartDedup(videoSlice.enableSmartDedup);
        setVideoDedupParams(videoSlice.videoDedupParams);
      })
      .catch((error) => reportAutoCutDiagnostic('warning', 'slicer', 'Load video slice parameter preferences failed', error));
  }, []);

  useEffect(() => listenAutoCutEvent('speechTranscriptionModelDownloadProgress', (progress) => {
    setSpeechModelDownloadProgress(progress);
  }), []);

  useEffect(() => {
    let cancelled = false;
    inspectAutoCutLocalSpeechTranscriptionSetup()
      .then((status) => {
        if (!cancelled) {
          setSpeechSetupStatus(status);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          reportAutoCutDiagnostic('warning', 'slicer.speech-setup', 'Initial Smart Slice STT readiness inspection failed', error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const formatTime = (timeInSecs: number) => {
    if (!timeInSecs || isNaN(timeInSecs)) return "00:00";
    const mins = Math.floor(timeInSecs / 60).toString().padStart(2, '0');
    const secs = Math.floor(timeInSecs % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
     const rect = e.currentTarget.getBoundingClientRect();
     const percent = (e.clientX - rect.left) / rect.width;
     if (playerRef.current) {
        playerRef.current.seek(percent);
     }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        // Only trigger if not editing text
        if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') {
            return;
        }

        if (e.code === 'Space' || e.code === 'KeyK') {
            e.preventDefault();
            playerRef.current?.togglePlay();
        } else if (e.code === 'KeyJ') {
            // Rewind 5 seconds
            if (playerRef.current && duration > 0) {
               const newTime = Math.max(0, currentTime - 5);
               playerRef.current.seek(newTime / duration);
            }
        } else if (e.code === 'KeyL') {
            // Fast forward 5 seconds
            if (playerRef.current && duration > 0) {
               const newTime = Math.min(duration, currentTime + 5);
               playerRef.current.seek(newTime / duration);
            }
        } else if (e.code === 'ArrowLeft') {
            // Step back ~3 frames (0.1s)
            if (playerRef.current && duration > 0) {
              const newTime = Math.max(0, currentTime - 0.1);
              playerRef.current.seek(newTime / duration);
            }
        } else if (e.code === 'ArrowRight') {
            // Step forward ~3 frames (0.1s)
            if (playerRef.current && duration > 0) {
              const newTime = Math.min(duration, currentTime + 0.1);
              playerRef.current.seek(newTime / duration);
            }
        }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentTime, duration]);

  const refreshSmartSliceLocalSpeechTranscriptionSetup = async () => {
    setIsInspectingSpeechSetup(true);
    try {
      const status = await inspectAutoCutLocalSpeechTranscriptionSetup();
      setSpeechSetupStatus(status);
      return status;
    } catch (error) {
      setSpeechSetupErrorMessage(error instanceof Error ? error.message : t('slicer.speechSetup.error.inspectFailed'));
      reportAutoCutDiagnostic('error', 'slicer.speech-setup', 'Smart Slice local STT readiness inspection failed', error);
      throw error;
    } finally {
      setIsInspectingSpeechSetup(false);
    }
  };

  const runSmartSliceLocalSpeechTranscriptionInitialization = async () => {
    if (isInitializingSpeechSetup) {
      return false;
    }

    setSpeechSetupDialogOpen(true);
    setSpeechSetupErrorMessage('');
    setIsInitializingSpeechSetup(true);
    try {
      setSpeechModelDownloadProgress(null);
      await waitForSmartSliceUiYield();
      const preflightStatus = await refreshSmartSliceLocalSpeechTranscriptionSetup();
      reportAutoCutDiagnostic('warning', 'slicer.speech-setup', 'Smart Slice local STT initialization preflight', {
        readiness: preflightStatus.readiness,
        executableReady: preflightStatus.executable.ready,
        executableSourceKind: preflightStatus.executable.sourceKind,
        executablePath: preflightStatus.executable.path,
        defaultExecutablePath: preflightStatus.defaults.executablePath,
        executableDirectory: preflightStatus.defaults.executableDirectory,
        executableStrategy: preflightStatus.defaults.executableStrategy,
        modelReady: preflightStatus.model.ready,
        modelPath: preflightStatus.model.path || preflightStatus.defaults.modelPath,
        modelDirectory: preflightStatus.defaults.modelDirectory,
        toolchainReady: preflightStatus.capabilities.toolchainReady,
        executableDownloadReady: preflightStatus.capabilities.executableDownloadReady,
        modelDownloadReady: preflightStatus.capabilities.modelDownloadReady,
        diagnostics: preflightStatus.diagnostics,
      });
      await waitForSmartSliceUiYield();
      const result = await initializeAutoCutLocalSpeechTranscriptionSetup();
      setSpeechSetupStatus(result.status);
      toast(t('slicer.speechSetup.toast.ready'), 'success');
      return result.status.readiness === AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.ready;
    } catch (error) {
      const message = error instanceof Error ? error.message : t('slicer.speechSetup.toast.notReady');
      setSpeechSetupErrorMessage(message);
      reportAutoCutDiagnostic('error', 'slicer.speech-setup', 'Smart Slice local STT initialization failed', error);
      await refreshSmartSliceLocalSpeechTranscriptionSetup().catch(() => null);
      return false;
    } finally {
      setIsInitializingSpeechSetup(false);
    }
  };

  const ensureSmartSliceLocalSpeechTranscriptionReady = async () => {
    setSpeechSetupErrorMessage('');
    setSpeechSetupDialogOpen(true);
    await waitForSmartSliceUiYield();
    const status = await refreshSmartSliceLocalSpeechTranscriptionSetup();
    if (status.readiness === AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.ready) {
      setSpeechSetupDialogOpen(false);
      return true;
    }

    const initialized = await runSmartSliceLocalSpeechTranscriptionInitialization();
    if (initialized) {
      setSpeechSetupDialogOpen(false);
    }
    return initialized;
  };

  const createCurrentVideoSliceParams = (): VideoSliceParams => {
    const effectiveSubtitleMode = enableSubtitles && subtitleMode === 'none' ? 'both' : subtitleMode;
    const sliceParams: VideoSliceParams = {
      mode: selectedMode,
      file,
      ...(fileId && !file ? { fileId } : {}),
      llmModel,
      targetPlatform,
      targetAspectRatio: aspectRatio,
      videoObjectFit,
      idealDuration,
      continuityLevel,
      segmentationDensity,
      sttPresetId: effectiveSttPresetId,
      customKeywords: customKeywordsInput
        .split(/[,\n;\uFF0C\u3001]+/u)
        .map((keyword) => keyword.trim())
        .filter(Boolean),
      minDuration,
      maxDuration,
      segmentationAgentId,
      baseAlgorithm: 'nlp',
      highlightEngine: 'emotion',
      enableNoiseReduction: noiseReduction,
      enableCoughFilter: coughFilter,
      enableRepeatFilter: repeatFilter,
      enableSmartDedup,
      videoDedupParams: createDefaultAutoCutVideoDedupParams({
        ...videoDedupParams,
        sourceAssetIds: fileId ? [fileId] : videoDedupParams.sourceAssetIds,
      }),
      enableSubtitles,
      ...(enableSubtitles
        ? {
            subtitleMode: effectiveSubtitleMode,
            subtitleStyleId: selectedSubtitleStyle,
          }
        : {}),
    };
    if (sourceUrl) {
      sliceParams.url = sourceUrl;
    }
    return sliceParams;
  };

  const saveCurrentVideoSlicePreferences = async () => {
    const effectiveSubtitleMode = enableSubtitles && subtitleMode === 'none' ? 'both' : subtitleMode;
    await saveAutoCutVideoSlicePreferences({
      mode: selectedMode,
      targetPlatform,
      targetAspectRatio: aspectRatio,
      videoObjectFit,
      idealDuration,
      continuityLevel,
      segmentationDensity,
      sttPresetId: effectiveSttPresetId,
      customKeywordsInput,
      minDuration,
      maxDuration,
      llmModel,
      segmentationAgentId,
      baseAlgorithm: 'nlp',
      highlightEngine: 'emotion',
      enableNoiseReduction: noiseReduction,
      enableCoughFilter: coughFilter,
      enableRepeatFilter: repeatFilter,
      enableSmartDedup,
      videoDedupParams,
      enableSubtitles,
      subtitleMode: enableSubtitles ? effectiveSubtitleMode : 'none',
      subtitleStyleId: selectedSubtitleStyle,
    });
  };

  const commitReviewSessionDraft = (
    baseSession: AutoCutSliceReviewSession,
    segments: readonly AutoCutSliceReviewSegment[],
    manualEdit?: AutoCutSliceManualEdit,
  ) => {
    const nextSession = createSliceReviewSessionFromSegments(
      baseSession,
      segments,
      manualEdit ? [manualEdit] : [],
    );
    setReviewSessionDraft(nextSession);
    setSelectedReviewSegmentIds(nextSession.selectedSegmentIds);
    const nextManualEdits = manualEdit ? [...reviewManualEdits, manualEdit] : reviewManualEdits;
    if (manualEdit) {
      setReviewManualEdits(nextManualEdits);
    }
    const taskId = activeReviewTask?.id ?? activeReviewTaskId;
    if (!taskId) {
      return;
    }
    setReviewDraftSaveError('');
    setIsSavingReviewDraft(true);
    void saveVideoSliceReviewDraft(taskId, {
      reviewSessionId: nextSession.id,
      selectedSegmentIds: nextSession.selectedSegmentIds,
      manualEdits: nextManualEdits,
    })
      .then(() => {
        setReviewDraftSavedAt(formatAutoCutTimeOfDay(createAutoCutTimestamp()));
      })
      .catch((error) => {
        reportAutoCutDiagnostic('error', 'slicer.review-draft', 'Save Smart Slice review draft failed', error);
        setReviewDraftSaveError(createSmartSliceFailureToastMessage(error, t));
      })
      .finally(() => {
        setIsSavingReviewDraft(false);
      });
  };

  const handlePreviewReviewSegment = (segment: AutoCutSliceReviewSegment) => {
    setActiveReviewSegmentId(segment.id);
    if (duration > 0) {
      playerRef.current?.seek(Math.max(0, segment.startMs / 1_000) / duration);
    }
  };

  const handleSelectAllReviewSegments = () => {
    const baseSession = effectiveReviewSession;
    if (!baseSession) {
      return;
    }
    const publishableSegments = baseSession.segments.filter((segment) => segment.status !== 'duplicate');
    const edit = createSliceReviewManualEdit('select', publishableSegments.map((segment) => segment.id), {
      reason: 'manual bulk select all publishable review segments',
    });
    commitReviewSessionDraft(
      baseSession,
      baseSession.segments.map((segment) =>
        segment.status === 'duplicate'
          ? segment
          : {
              ...segment,
              selected: true,
              status: 'selected',
            },
      ),
      edit,
    );
  };

  const handleClearReviewSegmentSelection = () => {
    const baseSession = effectiveReviewSession;
    if (!baseSession) {
      return;
    }
    const selectedIds = baseSession.segments
      .filter((segment) => segment.selected && segment.status === 'selected')
      .map((segment) => segment.id);
    const edit = createSliceReviewManualEdit('exclude', selectedIds, {
      reason: 'manual clear selected review segments',
    });
    commitReviewSessionDraft(
      baseSession,
      baseSession.segments.map((segment) =>
        segment.status === 'selected'
          ? {
              ...segment,
              selected: false,
              status: 'excluded',
            }
          : segment,
      ),
      edit,
    );
  };

  const handleToggleReviewSegment = (segmentId: string) => {
    const baseSession = effectiveReviewSession;
    if (!baseSession) {
      return;
    }
    const targetSegment = baseSession.segments.find((segment) => segment.id === segmentId);
    if (!targetSegment) {
      return;
    }
    const shouldSelect = !(targetSegment.selected && targetSegment.status === 'selected');
    const edit = createSliceReviewManualEdit(shouldSelect ? 'select' : 'exclude', [segmentId], {
      reason: shouldSelect ? 'manual segment selected for render' : 'manual segment excluded from render',
    });
    commitReviewSessionDraft(
      baseSession,
      baseSession.segments.map((segment) =>
        segment.id === segmentId
          ? {
              ...segment,
              selected: shouldSelect,
              status: shouldSelect ? 'selected' : 'excluded',
            }
          : segment,
      ),
      edit,
    );
  };

  const handleSplitReviewSegment = (segmentId: string) => {
    const baseSession = effectiveReviewSession;
    const segment = baseSession?.segments.find((candidate) => candidate.id === segmentId);
    if (!baseSession || !segment || segment.endMs <= segment.startMs + 1_000) {
      return;
    }
    const transcriptBoundaryMs = segment.transcriptSegments?.find((transcriptSegment) =>
      transcriptSegment.endMs > segment.startMs + 500 &&
      transcriptSegment.endMs < segment.endMs - 500
    )?.endMs;
    const splitAtMs = Math.round(transcriptBoundaryMs ?? (segment.startMs + segment.endMs) / 2);
    const firstSegment: AutoCutSliceReviewSegment = {
      ...segment,
      id: `${segment.id}-a`,
      title: `${segment.title} A`,
      endMs: splitAtMs,
      durationMs: Math.max(1, splitAtMs - segment.startMs),
      ...createSliceReviewSpeechRangeForPreview(segment, segment.startMs, splitAtMs),
      transcriptSegments: filterSliceReviewTranscriptSegmentsForPreview(segment, segment.startMs, splitAtMs),
    };
    const firstTranscriptText = createSliceReviewTranscriptTextForPreview(firstSegment);
    if (firstTranscriptText !== undefined) {
      firstSegment.transcriptText = firstTranscriptText;
    }
    const secondSegment: AutoCutSliceReviewSegment = {
      ...segment,
      id: `${segment.id}-b`,
      title: `${segment.title} B`,
      startMs: splitAtMs,
      durationMs: Math.max(1, segment.endMs - splitAtMs),
      ...createSliceReviewSpeechRangeForPreview(segment, splitAtMs, segment.endMs),
      transcriptSegments: filterSliceReviewTranscriptSegmentsForPreview(segment, splitAtMs, segment.endMs),
    };
    const secondTranscriptText = createSliceReviewTranscriptTextForPreview(secondSegment);
    if (secondTranscriptText !== undefined) {
      secondSegment.transcriptText = secondTranscriptText;
    }
    const edit = createSliceReviewManualEdit('split', [segmentId], {
      splitAtMs,
      createdSegmentIds: [firstSegment.id, secondSegment.id],
      reason: 'manual split at reviewed transcript boundary',
    });
    commitReviewSessionDraft(
      baseSession,
      baseSession.segments.flatMap((candidate) =>
        candidate.id === segmentId ? [firstSegment, secondSegment] : [candidate],
      ),
      edit,
    );
  };

  const handleMergeReviewSegment = (segmentId: string, direction: 'previous' | 'next') => {
    const baseSession = effectiveReviewSession;
    if (!baseSession) {
      return;
    }
    const segmentIndex = baseSession.segments.findIndex((segment) => segment.id === segmentId);
    const neighborIndex = direction === 'previous' ? segmentIndex - 1 : segmentIndex + 1;
    const currentSegment = baseSession.segments[segmentIndex];
    const neighborSegment = baseSession.segments[neighborIndex];
    if (!currentSegment || !neighborSegment) {
      return;
    }
    const mergeSegments = [currentSegment, neighborSegment].sort((a, b) => a.startMs - b.startMs);
    const baseMergeSegment = mergeSegments[0];
    if (!baseMergeSegment) {
      return;
    }
    const mergedSegment: AutoCutSliceReviewSegment = {
      ...baseMergeSegment,
      id: mergeSegments.map((segment) => segment.id).join('-'),
      title: mergeSegments.map((segment) => segment.title).join(' + '),
      startMs: Math.min(...mergeSegments.map((segment) => segment.startMs)),
      endMs: Math.max(...mergeSegments.map((segment) => segment.endMs)),
      durationMs: Math.max(...mergeSegments.map((segment) => segment.endMs)) - Math.min(...mergeSegments.map((segment) => segment.startMs)),
      contentUnitIds: [...new Set(mergeSegments.flatMap((segment) => segment.contentUnitIds))],
      speakerIds: [...new Set(mergeSegments.flatMap((segment) => segment.speakerIds))],
      speakerRoles: [...new Set(mergeSegments.flatMap((segment) => segment.speakerRoles))],
      transcriptSegments: mergeSegments.flatMap((segment) => segment.transcriptSegments ?? []),
      transcriptText: mergeSegments.map((segment) => segment.transcriptText).filter(Boolean).join(' '),
      risks: [...new Set(mergeSegments.flatMap((segment) => segment.risks))],
      selected: mergeSegments.some((segment) => segment.selected),
      status: mergeSegments.some((segment) => segment.selected) ? 'selected' : 'excluded',
    };
    const mergeIds = new Set(mergeSegments.map((segment) => segment.id));
    const firstIndex = Math.min(segmentIndex, neighborIndex);
    const retainedSegments = baseSession.segments.filter((segment) => !mergeIds.has(segment.id));
    const nextSegments = [
      ...retainedSegments.slice(0, firstIndex),
      mergedSegment,
      ...retainedSegments.slice(firstIndex),
    ];
    const edit = createSliceReviewManualEdit('merge', [...mergeIds], {
      createdSegmentIds: [mergedSegment.id],
      reason: 'manual merge to preserve continuous context',
    });
    commitReviewSessionDraft(baseSession, nextSegments, edit);
  };

  const handleDeleteDuplicateReviewSegment = (segmentId: string) => {
    const baseSession = effectiveReviewSession;
    if (!baseSession) {
      return;
    }
    const keepSegmentId = baseSession.selectedSegmentIds.find((id) => id !== segmentId) ??
      baseSession.segments.find((segment) => segment.id !== segmentId)?.id;
    const duplicateEditSegmentIds = keepSegmentId ? [keepSegmentId, segmentId] : [segmentId];
    const edit = createSliceReviewManualEdit('deleteDuplicate', duplicateEditSegmentIds, {
      ...(keepSegmentId ? { keepSegmentId } : {}),
      reason: 'manual duplicate content deletion',
    });
    commitReviewSessionDraft(
      baseSession,
      baseSession.segments.map((segment) =>
        segment.id === segmentId
          ? {
              ...segment,
              selected: false,
              status: 'duplicate',
              duplicateOfSegmentId: keepSegmentId,
            }
          : segment,
      ),
      edit,
    );
  };

  const handleRestoreReviewSegment = (segmentId: string) => {
    const baseSession = effectiveReviewSession;
    if (!baseSession) {
      return;
    }
    const edit = createSliceReviewManualEdit('restore', [segmentId], {
      reason: 'manual restore before render',
    });
    commitReviewSessionDraft(
      baseSession,
      baseSession.segments.map((segment) =>
        segment.id === segmentId
          ? {
              ...segment,
              selected: true,
              status: 'selected',
              duplicateGroupId: undefined,
              duplicateOfSegmentId: undefined,
            }
          : segment,
      ),
      edit,
    );
  };

  const handleApplyReviewSegmentCorrection = () => {
    const baseSession = effectiveReviewSession;
    const segment = activeReviewSegment;
    if (!baseSession || !segment) {
      return;
    }
    const correctedStartMs = normalizeSlicerNumberInput(
      reviewCorrectionDraft.startMs,
      segment.startMs,
      0,
      Math.max(0, segment.endMs - 1),
    );
    const correctedEndMs = normalizeSlicerNumberInput(
      reviewCorrectionDraft.endMs,
      segment.endMs,
      correctedStartMs + 1,
      effectiveReviewSession?.sourceDurationMs ?? Number.MAX_SAFE_INTEGER,
    );
    const speakerRoles = reviewCorrectionDraft.speakerRoles
      .split(/[,\n;\uFF0C\u3001]+/u)
      .map((speakerRole) => speakerRole.trim())
      .filter(Boolean);
    const correctedTranscriptText = reviewCorrectionDraft.transcriptText.trim();
    const correctedManualNotes = reviewCorrectionDraft.manualNotes.trim();
    const correctedSpeechRange = createSliceReviewSpeechRangeForPreview(segment, correctedStartMs, correctedEndMs);
    const correctedTranscriptSegments = filterSliceReviewTranscriptSegmentsForPreview(segment, correctedStartMs, correctedEndMs);
    const correctedSegment: AutoCutSliceReviewSegment = {
      ...segment,
      title: reviewCorrectionDraft.title.trim() || segment.title,
      startMs: correctedStartMs,
      endMs: Math.max(correctedStartMs + 1, correctedEndMs),
      durationMs: Math.max(1, correctedEndMs - correctedStartMs),
      speakerRoles,
      speakerIds: speakerRoles.length ? speakerRoles : segment.speakerIds,
      ...correctedSpeechRange,
      transcriptSegments: correctedTranscriptSegments,
      ...(correctedTranscriptText ? { transcriptText: correctedTranscriptText } : {}),
      ...(correctedManualNotes ? { manualNotes: correctedManualNotes } : {}),
    };
    const correctionPatch: NonNullable<AutoCutSliceManualEdit['patch']> = {
      title: correctedSegment.title,
      startMs: correctedSegment.startMs,
      endMs: correctedSegment.endMs,
      ...(correctedSegment.speechStartMs !== undefined ? { speechStartMs: correctedSegment.speechStartMs } : {}),
      ...(correctedSegment.speechEndMs !== undefined ? { speechEndMs: correctedSegment.speechEndMs } : {}),
      ...(correctedTranscriptText ? { transcriptText: correctedTranscriptText } : {}),
      speakerIds: correctedSegment.speakerIds,
      speakerRoles: correctedSegment.speakerRoles,
      ...(correctedManualNotes ? { manualNotes: correctedManualNotes } : {}),
    };
    const edit = createSliceReviewManualEdit('correctSegment', [segment.id], {
      reason: 'manual real-time segment correction',
      patch: correctionPatch,
    });
    commitReviewSessionDraft(
      baseSession,
      baseSession.segments.map((candidate) => candidate.id === segment.id ? correctedSegment : candidate),
      edit,
    );
  };

  const handleRenderSelectedReviewSegments = async () => {
    const baseSession = effectiveReviewSession;
    const taskId = activeReviewTask?.id ?? activeReviewTaskId;
    if (!baseSession || !taskId) {
      toast('No reviewed segment plan is ready for rendering.', 'error');
      return;
    }
    if (selectedReviewSegmentIds.length === 0) {
      toast('Select at least one review segment before rendering.', 'error');
      return;
    }
    setIsRenderingReviewSelection(true);
    try {
      await renderVideoSlicePlan(taskId, {
        reviewSessionId: baseSession.id,
        selectedSegmentIds: selectedReviewSegmentIds,
        manualEdits: reviewManualEdits,
      });
      setActiveLeftTab('tasks');
      toast('Render selected Smart Slice segments submitted.', 'success');
    } catch (error) {
      reportAutoCutDiagnostic('error', 'slicer.review-render', 'Render selected Smart Slice segments failed', error);
      toast(createSmartSliceFailureToastMessage(error, t), 'error');
    } finally {
      setIsRenderingReviewSelection(false);
    }
  };

  const handleStart = async () => {
    if (!hasVideoSource) {
      toast('Select a source video before running Smart Cut Engine.', 'error');
      return;
    }
    if (!strategyExecutionSupport.ready) {
      const blockerCode = strategyExecutionSupport.blockerCode ?? 'UNSUPPORTED_VISUAL_PRESET_EVIDENCE';
      reportAutoCutDiagnostic('warning', 'slicer.submit', 'Smart Cut Engine strategy blocked before submission', {
        mode: selectedMode,
        blockerCode,
        status: strategyExecutionSupport.status,
        detail: strategyExecutionSupport.detail,
      });
      toast(`${blockerCode}: ${strategyExecutionSupport.detail}`, 'error');
      return;
    }
    setIsProcessing(true);
    try {
      const speechReady = await ensureSmartSliceLocalSpeechTranscriptionReady();
      if (!speechReady) {
        return;
      }
      await waitForSmartSliceUiYield();
      toast(t('slicer.speechSetup.toast.submitCreated'), 'info');
      const sliceParams = createCurrentVideoSliceParams();
      reportAutoCutDiagnostic('warning', 'slicer.submit', 'Smart Slice submit params', createSmartSliceSubmissionDiagnostics(sliceParams));
      await saveCurrentVideoSlicePreferences();
      if (runMode === 'review-before-render') {
        resetSmartSliceReviewWorkbenchForNewPlan();
        const result = await analyzeVideoSlicePlan(sliceParams);
        setActiveReviewTaskId(result.taskId);
        toast('Analyze complete. Segment Review Workbench will open when the plan is ready.', 'success');
      } else {
        resetSmartSliceReviewWorkbenchForNewPlan();
        await processVideoSlice(sliceParams);
        toast(t('slicer.speechSetup.toast.submitted'), 'success');
      }
      setIsProcessing(false);
      setActiveLeftTab("tasks");
    } catch (e) {
      const failedTaskId = getAutoCutProcessingTaskErrorTaskId(e);
      if (failedTaskId) {
        setActiveLeftTab("tasks");
      }
      reportAutoCutDiagnostic('error', 'slicer', 'Video slicing failed', e);
      setIsProcessing(false);
      toast(createSmartSliceFailureToastMessage(e, t), 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSubtitleToggle = () => {
    setEnableSubtitles((enabled) => {
      const nextEnabled = !enabled;
      if (nextEnabled) {
        setSubtitleMode((currentMode) => currentMode === 'none' ? 'both' : currentMode);
      }
      return nextEnabled;
    });
  };

  const resetSmartSliceReviewWorkbenchForNewPlan = () => {
    setActiveReviewTaskId('');
    setReviewSessionDraft(null);
    setSelectedReviewSegmentIds([]);
    setReviewVisibilityFilter('all');
    setActiveReviewSegmentId('');
    setReviewManualEdits([]);
    setIsRenderingReviewSelection(false);
    setLatestVideoDedupReport(null);
  };

  const resetSmartSliceReviewWorkbenchForSourceChange = () => {
    resetSmartSliceReviewWorkbenchForNewPlan();
    setVideoDedupParams((currentParams) =>
      createDefaultAutoCutVideoDedupParams({
        ...currentParams,
        sourceAssetIds: [],
      }),
    );
  };

  const handleReplaceVideoFallbackSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] ?? null;
    if (selectedFile) {
      resetSmartSliceReviewWorkbenchForSourceChange();
      setFile(selectedFile);
      setFileId('');
    }
    event.target.value = '';
  };

  const fallbackReplaceVideoFileChooser = () => {
    replaceVideoInputRef.current?.click();
  };

  const handleReplaceVideo = async () => {
    try {
      const selectedVideo = await selectAutoCutTrustedLocalVideoFile();
      if (!selectedVideo) {
        return;
      }

      const trustedFile = createAutoCutTrustedLocalFile(selectedVideo);
      resetSmartSliceReviewWorkbenchForSourceChange();
      setFile(trustedFile);
      setFileId('');
      return;
    } catch (error) {
      reportAutoCutDiagnostic('warning', 'slicer', 'Desktop trusted video replacement failed, using browser fallback', error);
    }

    fallbackReplaceVideoFileChooser();
  };

  return (
    <div className="flex-1 w-full flex flex-col bg-[#111] text-gray-200 overflow-hidden relative">
      {/* Main Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Sidebar (Tabs: Text | Tasks) */}
        <aside className="w-[280px] bg-[#0A0A0A] border-r border-[#222] flex flex-col shrink-0">
          <div className="h-14 flex items-center px-4 shrink-0">
            <button
              onClick={() => navigate(-1)}
              className="mr-3 p-1.5 text-gray-400 hover:text-white hover:bg-[#222] rounded-md transition-colors"
            >
              <ArrowLeft size={16} />
            </button>
            <h1 className="text-[13px] font-bold text-gray-200 flex items-center gap-2">
              Smart Cut Engine
            </h1>
          </div>

          <div className="flex border-b border-[#222] border-t shrink-0 bg-[#0d0d0d]">
            <button
              onClick={() => {
                setActiveLeftTab('text');
                setEnableOverlayEditor(true);
              }}
              className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-colors flex justify-center items-center gap-2 ${activeLeftTab === 'text' ? 'text-blue-400 border-b-2 border-blue-500 bg-[#111]' : 'text-gray-500 hover:text-gray-300 hover:bg-[#111]'}`}
            >
              <Type size={14} /> Overlay
            </button>
            <button
              onClick={() => setActiveLeftTab('tasks')}
              className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-colors flex justify-center items-center gap-2 ${activeLeftTab === 'tasks' ? 'text-blue-400 border-b-2 border-blue-500 bg-[#111]' : 'text-gray-500 hover:text-gray-300 hover:bg-[#111]'}`}
            >
              <CheckCircle2 size={14} /> Jobs
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {activeLeftTab === 'text' ? (
              <div className="space-y-3">
                {TEXT_EFFECTS.map((effect) => (
                  <div
                    key={effect.id}
                    draggable
                    onDragStart={(e) => {
                      setEnableOverlayEditor(true);
                      e.dataTransfer.setData("application/json", JSON.stringify({
                        textContent: effect.text,
                        styleConfig: effect.styleConfig
                      }));
                      setWebGlTextEffectDragPayload({
                          textContent: effect.text,
                          styleConfig: effect.styleConfig
                      });
                    }}
                    onDragEnd={() => {
                        setWebGlTextEffectDragPayload(null);
                    }}
                    className="p-4 bg-[#111] rounded-xl border border-[#222] hover:border-blue-500/50 hover:bg-[#1A1A1A] transition-all cursor-grab active:cursor-grabbing group relative overflow-hidden flex flex-col items-center justify-center gap-3"
                  >
                    <div className="absolute top-2 left-2 text-[9px] text-gray-500 font-bold uppercase tracking-wider">{effect.name}</div>
                    <div
                      className="text-lg font-bold text-center mt-3 tracking-wide"
                      style={{
                       background: Array.isArray(effect.styleConfig.fill) ? `linear-gradient(${effect.styleConfig.fillGradientType === 1 ? 'to right' : 'to bottom'}, ${effect.styleConfig.fill.join(', ')})` : 'none',
                       color: Array.isArray(effect.styleConfig.fill) ? 'transparent' : effect.styleConfig.fill,
                       WebkitBackgroundClip: Array.isArray(effect.styleConfig.fill) ? 'text' : 'border-box',
                       WebkitTextStroke: effect.styleConfig.stroke ? `1.5px ${effect.styleConfig.stroke.color}` : 'none',
                       filter: effect.styleConfig.dropShadow
                         ? `drop-shadow(${effect.styleConfig.dropShadow.distance}px ${effect.styleConfig.dropShadow.distance}px ${effect.styleConfig.dropShadow.blur}px ${effect.styleConfig.dropShadow.color})`
                         : 'none',
                       fontStyle: effect.styleConfig.fontStyle || 'normal',
                       fontWeight: effect.styleConfig.fontWeight || 'bold',
                       fontFamily: effect.styleConfig.fontFamily || 'inherit',
                       letterSpacing: effect.styleConfig.letterSpacing ? `${effect.styleConfig.letterSpacing}px` : 'normal'
                    }}>
                      {effect.text}
                    </div>
                  </div>
                ))}
              </div>
            ) : slicerTasks.length === 0 ? (
              <div className="rounded-lg border border-[#222] bg-[#111] p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded border border-[#333] bg-[#181818] text-blue-300">
                    <Scissors size={15} />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-gray-200">No Smart Cut jobs yet</div>
                    <div className="mt-1 text-[11px] leading-5 text-gray-500">
                      Select a source video, confirm the scene strategy, then run Smart Cut Engine to create audit-ready clips.
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              slicerTasks.map(task => (
                <div key={task.id} className="p-3 bg-[#111] rounded-lg border border-[#222] hover:border-[#333] hover:bg-[#1A1A1A] transition-all cursor-pointer group" onClick={() => navigate(`/tasks/${task.id}`)}>
                  <div className="flex items-start justify-between">
                    <div className="flex gap-3">
                      <div className="mt-1 text-gray-500 group-hover:text-blue-400 transition-colors">
                        <Video size={16} />
                      </div>
                      <div>
                        <h3 className="text-[11px] font-medium text-gray-200 line-clamp-1">{task.name}</h3>
                        <div className="mt-1 text-[10px] text-gray-500 font-mono">
                          {formatAutoCutTimeOfDay(task.createdAt)}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3">
                    {task.status === AUTOCUT_TASK_STATUS.processing && (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1 bg-[#222] rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500 rounded-full" style={{ width: `${task.progress}%` }} />
                        </div>
                        <span className="text-[10px] text-blue-400 font-bold">{task.progress}%</span>
                      </div>
                    )}
                    {task.status === AUTOCUT_TASK_STATUS.completed && (
                      <div className="flex items-center gap-1.5 text-[10px] text-green-500">
                        <CheckCircle2 size={12} /> <span className="font-semibold">Completed</span>
                      </div>
                    )}
                    {task.status === AUTOCUT_TASK_STATUS.reviewing && (
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            if (task.sliceReviewSession) {
                              setActiveReviewTaskId(task.id);
                              setReviewSessionDraft(task.sliceReviewSession);
                              setSelectedReviewSegmentIds(task.sliceReviewSession.selectedSegmentIds);
                              setReviewManualEdits([]);
                            }
                          }}
                          className="flex items-center gap-1.5 text-[10px] font-semibold text-blue-300 hover:text-blue-200"
                        >
                          <Scissors size={12} /> Review ready
                        </button>
                        <span className="text-[10px] text-gray-500">{task.sliceReviewSession?.selectedSegmentIds.length ?? 0} selected</span>
                      </div>
                    )}
                    {task.status === AUTOCUT_TASK_STATUS.failed && (
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-[10px] text-red-500">
                        <XCircle size={12} /> <span className="font-semibold">Failed</span>
                        </div>
                        <TaskFailureState
                          variant="compact"
                          errorMessage={task.errorMessage}
                          failureDiagnostics={task.failureDiagnostics}
                          onCopyErrorMessage={writeAutoCutClipboardText}
                          labels={commonLabels.taskFailure}
                        />
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {activeLeftTab === 'tasks' && (
            <div className="p-3 border-t border-[#222] bg-[#050505] shrink-0">
              <button onClick={() => navigate('/tasks')} className="w-full py-2 text-[11px] text-gray-400 flex items-center justify-center gap-1 hover:text-white transition-colors">
                View all tasks <ChevronRight size={14} />
              </button>
            </div>
          )}
        </aside>

        {/* Center: Player */}
        <div className="flex-1 min-w-0 p-4 xl:p-6 pb-4 flex flex-col bg-[#111] overflow-y-auto custom-scrollbar">

          <div className="w-full h-full flex flex-col gap-4 min-h-0">

            {/* Player Container */}
            <div className="w-full flex-1 relative bg-[#050505] rounded-xl overflow-hidden shadow-2xl border border-[#222] group min-h-[300px]">
               {videoSrc ? (
                 shouldUseWebGlOverlayEditor ? (
                   <Suspense
                      fallback={
                        <NativeSmartSliceVideoPreview
                          ref={playerRef}
                          videoSrc={videoSrc}
                          aspectRatio={aspectRatio}
                          videoObjectFit={videoObjectFit}
                          onVideoLoaded={(w, h) => {
                             const ratio = w / h;
                             if (ratio > 1.5) setDetectedRatio("16:9");
                             else if (ratio < 0.7) setDetectedRatio("9:16");
                             else if (Math.abs(ratio - 1) < 0.1) setDetectedRatio("1:1");
                             else if (Math.abs(ratio - 1.33) < 0.1) setDetectedRatio("4:3");
                             else setDetectedRatio(`${w}:${h}`);
                          }}
                          onTimeUpdate={(c, d) => {
                              setCurrentTime(c);
                              setDuration(d);
                              setVideoProgress(d > 0 ? (c / d) * 100 : 0);
                          }}
                          onPlayStateChange={setIsPlaying}
                        />
                      }
                   >
                     <WebGLPlayer
                        ref={webGlPlayerRef}
                        videoSrc={videoSrc}
                        aspectRatio={aspectRatio}
                        videoObjectFit={videoObjectFit}
                        onSelectText={setSelectedTextInfo}
                        onVideoLoaded={(w, h) => {
                           const ratio = w / h;
                           if (ratio > 1.5) setDetectedRatio("16:9");
                           else if (ratio < 0.7) setDetectedRatio("9:16");
                           else if (Math.abs(ratio - 1) < 0.1) setDetectedRatio("1:1");
                           else if (Math.abs(ratio - 1.33) < 0.1) setDetectedRatio("4:3");
                           else setDetectedRatio(`${w}:${h}`);
                        }}
                        onTimeUpdate={(c, d) => {
                            setCurrentTime(c);
                            setDuration(d);
                            setVideoProgress(d > 0 ? (c / d) * 100 : 0);
                        }}
                        onPlayStateChange={setIsPlaying}
                     />
                   </Suspense>
                 ) : (
                   <NativeSmartSliceVideoPreview
                      ref={playerRef}
                      videoSrc={videoSrc}
                      aspectRatio={aspectRatio}
                      videoObjectFit={videoObjectFit}
                      onVideoLoaded={(w, h) => {
                         const ratio = w / h;
                         if (ratio > 1.5) setDetectedRatio("16:9");
                         else if (ratio < 0.7) setDetectedRatio("9:16");
                         else if (Math.abs(ratio - 1) < 0.1) setDetectedRatio("1:1");
                         else if (Math.abs(ratio - 1.33) < 0.1) setDetectedRatio("4:3");
                         else setDetectedRatio(`${w}:${h}`);
                      }}
                      onTimeUpdate={(c, d) => {
                          setCurrentTime(c);
                          setDuration(d);
                          setVideoProgress(d > 0 ? (c / d) * 100 : 0);
                      }}
                      onPlayStateChange={setIsPlaying}
                   />
                 )
               ) : (
                 <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#050505] text-center">
                   <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-[#333] bg-[#111]">
                     <Video size={28} className="text-blue-500" />
                   </div>
                   <div className="max-w-xs space-y-1">
                     <p className="text-sm font-semibold text-gray-200">Select a local video to start</p>
                     <p className="text-xs leading-5 text-gray-500">AutoCut no longer loads remote demo videos by default.</p>
                   </div>
                 </div>
               )}

              {isProcessing && (
                <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center z-50">
                  <div className="text-white flex flex-col items-center gap-4">
                    <div className="animate-spin text-blue-500">
                      <Settings2 size={32} />
                    </div>
                    <p className="font-medium text-xs text-blue-400">Smart Slice is running native speech analysis and FFmpeg rendering...</p>
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Control Bar */}
            <div className="w-full bg-[#1A1A1A] border border-[#222] rounded-lg p-3.5 flex flex-col gap-2.5 shadow-md pl-4 pr-4 shrink-0">
                <div
                   className="w-full h-1.5 bg-[#222] rounded-full cursor-pointer overflow-hidden transition-all hover:h-2"
                   onClick={handleSeek}
                >
                  <div
                    className="h-full bg-blue-500 rounded-full shadow-[0_0_10px_rgba(59,130,246,0.8)] transition-all ease-linear"
                    style={{ width: `${videoProgress}%` }}
                  ></div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4 text-white">
                    <button
                        onClick={() => playerRef.current?.togglePlay()}
                        className="hover:text-blue-400 transition-colors w-8 h-8 flex items-center justify-center rounded-full bg-[#222] hover:bg-[#333] border border-[#333]"
                    >
                      {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-1" />}
                    </button>
                    <span className="text-[12px] font-medium text-gray-400 font-mono">
                        {formatTime(currentTime)} <span className="text-gray-600 mx-1">/</span> {formatTime(duration)}
                    </span>
                    <div className="flex items-center gap-2 ml-4 text-[10px] text-gray-600 font-medium">
                      <span className="px-1.5 py-0.5 bg-[#222] rounded border border-[#333]">J</span> Back
                      <span className="px-1.5 py-0.5 bg-[#222] rounded border border-[#333]">K</span>/
                      <span className="px-1.5 py-0.5 bg-[#222] rounded border border-[#333]">Space</span> Play
                      <span className="px-1.5 py-0.5 bg-[#222] rounded border border-[#333]">L</span> Forward
                      <span className="ml-2 px-1.5 py-0.5 bg-[#222] rounded border border-[#333]">Left</span>
                      <span className="px-1.5 py-0.5 bg-[#222] rounded border border-[#333]">Right</span> Frame
                    </div>
                  </div>
                <div className="flex items-center gap-2 text-gray-400">
                     <select
                         value={aspectRatio}
                          onChange={e => setAspectRatio(e.target.value as SliceTargetAspectRatio)}
                         className="bg-[#222] border border-[#333] text-gray-300 text-[11px] rounded px-2 py-1 outline-none focus:border-blue-500 transition-colors"
                      >
                       <option value="auto">Auto ({detectedRatio})</option>
                       <option value="16:9">16:9 Landscape</option>
                       <option value="9:16">9:16 Vertical</option>
                       <option value="1:1">1:1 Square</option>
                       <option value="4:3">4:3 Standard</option>
                     </select>

                     <select
                         value={videoObjectFit}
                          onChange={e => setVideoObjectFit(e.target.value as SliceVideoObjectFit)}
                         className="bg-[#222] border border-[#333] text-gray-300 text-[11px] rounded px-2 py-1 outline-none focus:border-blue-500 transition-colors"
                      >
                       <option value="contain">Contain</option>
                       <option value="cover">Cover</option>
                     </select>

                     <Settings2 size={16} className="cursor-pointer hover:text-white transition-colors ml-2" />
                  </div>
                </div>
            </div>

            {/* File Info Bar */}
            <div className="w-full bg-[#1A1A1A] border border-[#222] rounded-lg p-4 flex flex-col xl:flex-row xl:items-center justify-between gap-4 shadow-sm shrink-0">
              <div className="flex gap-4 overflow-hidden">
                <div className="w-12 h-12 bg-[#222] border border-[#333] rounded-lg flex items-center justify-center shrink-0">
                  <Video size={24} className="text-blue-500" />
                </div>
                <div className="min-w-0 flex flex-col justify-center">
                  <h2 className="text-[13px] font-bold text-gray-200 truncate flex items-center gap-2">
                    {file ? file.name : sourceUrl ? "Remote source URL" : fileId ? "Selected native asset" : "No video selected"}
                    {file && <span className="px-1.5 py-0.5 bg-[#333] text-[10px] text-gray-400 rounded">{(file.size / 1024 / 1024).toFixed(1)}MB</span>}
                  </h2>
                  <div className="text-[11px] text-gray-500 font-mono mt-1 truncate">
                    {file ? "Local trusted video" : sourceUrl || fileId || "Choose a local video file before processing"}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  className="px-3 py-2 text-[11px] font-medium bg-[#222] hover:bg-[#333] border border-[#333] hover:border-[#444] rounded-lg transition-colors text-gray-300 flex items-center gap-2 cursor-pointer"
                  onClick={handleReplaceVideo}
                >
                  <RefreshCcw size={14} /> Replace video
                </button>
                <input
                  ref={replaceVideoInputRef}
                  type="file"
                  className="hidden"
                  accept="video/*"
                  onChange={handleReplaceVideoFallbackSelected}
                />
              </div>
            </div>

            {/* Added some padding at bottom */}
            <div className="h-4"></div>
          </div>
        </div>

        {/* Right: Parameters Sidebar */}
        <aside className="w-[320px] xl:w-[340px] bg-[#0A0A0A] border-l border-[#222] flex flex-col shrink-0 z-10 shadow-[-4px_0_15px_-3px_rgba(0,0,0,0.5)]">
          {selectedTextInfo ? (
            <>
              <div className="h-14 border-b border-[#222] flex items-center px-5 shrink-0 justify-between">
                <h2 className="text-[13px] font-bold text-gray-200 flex items-center gap-2 tracking-wide">
                  <Settings2 size={16} className="text-blue-500" />
                  Text overlay
                </h2>
                <span
                  className="text-[11px] text-gray-500 cursor-pointer hover:text-white transition-colors"
                  onClick={() => setSelectedTextInfo(null)}
                >
                  Close
                </span>
              </div>
              <div className="p-5 flex-1 overflow-y-auto space-y-6">
                 <div>
                   <label className="block text-[11px] font-bold text-gray-500 mb-2 uppercase tracking-wider">Text content</label>
                    <textarea
                     className="w-full bg-[#141414] border border-[#222] hover:border-[#333] rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-blue-500 resize-none h-24"
                     value={selectedTextInfo.text}
                     onChange={(e) => {
                        const newText = e.target.value;
                        setSelectedTextInfo({ ...selectedTextInfo, text: newText });
                        playerRef.current?.updateSelectedText({ text: newText });
                     }}
                   />
                 </div>

                 <div>
                   <label className="block text-[11px] font-bold text-gray-500 mb-2 uppercase tracking-wider flex justify-between">
                       <span>Font size</span>
                       <span className="text-blue-400">{selectedTextInfo.fontSize}px</span>
                    </label>
                   <input
                     type="range"
                     className="w-full accent-blue-500"
                     min={12} max={200}
                     value={selectedTextInfo.fontSize}
                     onChange={(e) => {
                        const newSize = Number(e.target.value);
                        setSelectedTextInfo({ ...selectedTextInfo, fontSize: newSize });
                        playerRef.current?.updateSelectedText({ fontSize: newSize });
                     }}
                   />
                 </div>

                 <div>
                   <label className="block text-[11px] font-bold text-gray-500 mb-2 uppercase tracking-wider">Text color</label>
                    <div className="flex items-center gap-3">
                     <input
                       type="color"
                       className="w-8 h-8 rounded shrink-0 cursor-pointer border-none p-0 bg-transparent"
                       value={selectedTextInfo.fill}
                       onChange={(e) => {
                          const newColor = e.target.value;
                          setSelectedTextInfo({ ...selectedTextInfo, fill: newColor });
                          playerRef.current?.updateSelectedText({ fill: newColor });
                       }}
                     />
                     <span className="text-xs text-gray-300 font-mono uppercase bg-[#141414] px-3 py-1 rounded border border-[#222] flex-1 text-center">
                        {selectedTextInfo.fill}
                     </span>
                   </div>
                 </div>

                 <div className="grid grid-cols-2 gap-4">
                   <div>
                     <label className="block text-[11px] font-bold text-gray-500 mb-2 uppercase tracking-wider">X position</label>
                     <div className="bg-[#141414] border border-[#222] rounded-lg px-3 py-2 text-xs text-white text-center font-mono">
                        {selectedTextInfo.x !== undefined && !Number.isNaN(selectedTextInfo.x) ? selectedTextInfo.x : '-'}
                     </div>
                   </div>
                   <div>
                     <label className="block text-[11px] font-bold text-gray-500 mb-2 uppercase tracking-wider">Y position</label>
                     <div className="bg-[#141414] border border-[#222] rounded-lg px-3 py-2 text-xs text-white text-center font-mono">
                        {selectedTextInfo.y !== undefined && !Number.isNaN(selectedTextInfo.y) ? selectedTextInfo.y : '-'}
                     </div>
                   </div>
                 </div>

                 <div className="grid grid-cols-2 gap-4">
                   <div>
                     <label className="block text-[11px] font-bold text-gray-500 mb-2 uppercase tracking-wider">Scale</label>
                      <div className="bg-[#141414] border border-[#222] rounded-lg px-3 py-2 text-xs text-white text-center font-mono">
                         {selectedTextInfo.scale !== undefined && !Number.isNaN(selectedTextInfo.scale) ? selectedTextInfo.scale.toFixed(2) : '-'}
                     </div>
                   </div>
                   <div>
                     <label className="block text-[11px] font-bold text-gray-500 mb-2 uppercase tracking-wider">Rotation</label>
                      <div className="bg-[#141414] border border-[#222] rounded-lg px-3 py-2 text-xs text-white text-center font-mono">
                         {selectedTextInfo.rotation !== undefined && !Number.isNaN(selectedTextInfo.rotation) ? (selectedTextInfo.rotation * (180/Math.PI)).toFixed(1) + 'deg' : '-'}
                     </div>
                   </div>
                 </div>
              </div>
            </>
          ) : (
            <>
              <div className="h-14 border-b border-[#222] flex items-center px-5 shrink-0 justify-between">
                <h2 className="text-[13px] font-bold text-gray-200 flex items-center gap-2 tracking-wide">
                  <Settings2 size={16} className="text-blue-500" />
                  Smart Cut Engine Workbench
                </h2>
                <span className="text-[11px] text-blue-400">commercial brief</span>
              </div>

              <div className="p-5 flex-1 overflow-y-auto w-full custom-scrollbar styled-scrollbar">
                <div className="space-y-6">
              <section className="rounded-lg border border-[#262626] bg-[#101010] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-blue-300">Workflow Mode</div>
                    <div className="mt-1 text-xs leading-5 text-gray-300">Auto render or review before render</div>
                  </div>
                  <span className="rounded border border-[#333] bg-[#141414] px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-300">
                    {runMode === 'review-before-render' ? 'Human-in-loop' : 'One-click'}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {[
                    { id: 'review-before-render' as const, label: 'Review before render', detail: 'Analyze first, edit segments, then render selected.' },
                    { id: 'auto-render' as const, label: 'Auto render', detail: 'Plan, filter, and render in one automated run.' },
                  ].map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setRunMode(option.id)}
                      className={`rounded-lg border p-3 text-left transition-colors ${
                        runMode === option.id
                          ? 'border-blue-500/60 bg-blue-500/15 text-blue-100'
                          : 'border-[#252525] bg-[#141414] text-gray-400 hover:border-[#3a3a3a] hover:text-gray-200'
                      }`}
                    >
                      <div className="text-[11px] font-bold">{option.label}</div>
                      <div className="mt-1 text-[10px] leading-4 text-gray-500">{option.detail}</div>
                    </button>
                  ))}
                </div>
              </section>

              <section className="rounded-lg border border-[#262626] bg-[#101010] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-blue-300">Segment Review Workbench</div>
                    <div className="mt-1 text-xs leading-5 text-gray-300">Preview planned segments, select exports, and remove duplicate content</div>
                  </div>
                  <span className={`rounded border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${
                    effectiveReviewSession
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                      : 'border-[#333] bg-[#141414] text-gray-500'
                  }`}>
                    {isSavingReviewDraft
                      ? 'Saving'
                      : reviewDraftSaveError
                        ? 'Save failed'
                        : reviewDraftSavedAt
                          ? `Saved ${reviewDraftSavedAt}`
                          : effectiveReviewSession
                            ? 'Ready'
                            : 'No plan'}
                  </span>
                </div>
                {reviewDraftSaveError ? (
                  <div className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[10px] leading-4 text-amber-100">
                    {reviewDraftSaveError}
                  </div>
                ) : null}

                {effectiveReviewSession ? (
                  <div className="mt-3 space-y-3">
                    <div className="grid grid-cols-4 gap-2">
                      <div className="rounded border border-[#252525] bg-[#141414] px-2 py-2">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Segments</div>
                        <div className="mt-1 text-[12px] font-semibold text-gray-100">{reviewSegments.length}</div>
                      </div>
                      <div className="rounded border border-[#252525] bg-[#141414] px-2 py-2">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Selected</div>
                        <div className="mt-1 text-[12px] font-semibold text-emerald-200">{selectedReviewSegmentCount}</div>
                      </div>
                      <div className="rounded border border-[#252525] bg-[#141414] px-2 py-2">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Duplicates</div>
                        <div className="mt-1 text-[12px] font-semibold text-amber-200">{duplicateReviewSegmentCount}</div>
                        {duplicateReviewGroupCount || smartDedupRiskSegmentCount ? (
                          <div className="mt-0.5 text-[9px] text-gray-500">
                            {duplicateReviewGroupCount} groups / {smartDedupRiskSegmentCount} AI risk
                          </div>
                        ) : null}
                      </div>
                      <div className="rounded border border-[#252525] bg-[#141414] px-2 py-2">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Excluded</div>
                        <div className="mt-1 text-[12px] font-semibold text-gray-300">{excludedReviewSegmentCount}</div>
                      </div>
                    </div>

                    {effectiveReviewSession.smartDedupReport ? (
                      <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-amber-200">Smart dedup review</div>
                            <div className="mt-1 truncate text-[10px] text-amber-100/80">
                              {effectiveReviewSession.smartDedupReport.matchCount} matches / {smartDedupRiskSegmentCount} risk segments / {effectiveReviewSession.smartDedupReport.strategies.join(', ')}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setReviewVisibilityFilter('duplicates')}
                            className="shrink-0 rounded border border-amber-400/40 bg-[#101010] px-2 py-1 text-[10px] font-semibold text-amber-100 hover:border-amber-300"
                          >
                            Review
                          </button>
                        </div>
                      </div>
                    ) : null}

                    <div className="rounded-lg border border-[#252525] bg-[#141414] p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Previewing Segment</div>
                          <div className="mt-1 truncate text-[12px] font-semibold text-gray-100">
                            {activeReviewSegment ? activeReviewSegment.title : 'No segment selected'}
                          </div>
                        </div>
                        {activeReviewSegment ? (
                          <button
                            type="button"
                            onClick={() => handlePreviewReviewSegment(activeReviewSegment)}
                            className="shrink-0 rounded border border-blue-500/40 bg-blue-500/10 px-2 py-1 text-[10px] font-semibold text-blue-200 hover:border-blue-400"
                          >
                            Preview
                          </button>
                        ) : null}
                      </div>
                      <div className="mt-2 text-[10px] leading-4 text-gray-500">
                        {activeReviewSegment
                          ? `${formatTime(activeReviewSegment.startMs / 1_000)} - ${formatTime(activeReviewSegment.endMs / 1_000)} | ${activeReviewSegment.speakerRoles.join(', ') || activeReviewSegment.speakerIds.join(', ') || 'speaker evidence pending'}`
                          : 'Run analysis to generate a reviewable semantic segment plan.'}
                      </div>
                      <div className="mt-2 line-clamp-3 text-[10px] leading-4 text-gray-400">
                        {activeReviewSegment?.transcriptText || activeReviewSegment?.summary || 'Transcript and speaker evidence will appear here for manual boundary review.'}
                      </div>
                    </div>

                    {activeReviewSegment ? (
                      <div className="rounded-lg border border-[#252525] bg-[#141414] p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Real-time Correction</div>
                            <div className="mt-1 text-[10px] leading-4 text-gray-500">
                              Edit boundaries, transcript, speaker labels, and review notes before rendering.
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={handleApplyReviewSegmentCorrection}
                            className="shrink-0 rounded border border-cyan-500/40 bg-cyan-500/10 px-2 py-1 text-[10px] font-semibold text-cyan-200 hover:border-cyan-400"
                          >
                            Save correction
                          </button>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <input
                            type="text"
                            value={reviewCorrectionDraft.title}
                            onChange={(event) => setReviewCorrectionDraft((draft) => ({ ...draft, title: event.target.value }))}
                            className="col-span-2 rounded border border-[#303030] bg-[#101010] px-2 py-1.5 text-[10px] text-gray-200 outline-none focus:border-cyan-500"
                            placeholder="Segment title"
                          />
                          <input
                            type="number"
                            value={reviewCorrectionDraft.startMs}
                            onChange={(event) => setReviewCorrectionDraft((draft) => ({ ...draft, startMs: event.target.value }))}
                            className="rounded border border-[#303030] bg-[#101010] px-2 py-1.5 text-[10px] text-gray-200 outline-none focus:border-cyan-500"
                            placeholder="Start ms"
                          />
                          <input
                            type="number"
                            value={reviewCorrectionDraft.endMs}
                            onChange={(event) => setReviewCorrectionDraft((draft) => ({ ...draft, endMs: event.target.value }))}
                            className="rounded border border-[#303030] bg-[#101010] px-2 py-1.5 text-[10px] text-gray-200 outline-none focus:border-cyan-500"
                            placeholder="End ms"
                          />
                          <input
                            type="text"
                            value={reviewCorrectionDraft.speakerRoles}
                            onChange={(event) => setReviewCorrectionDraft((draft) => ({ ...draft, speakerRoles: event.target.value }))}
                            className="col-span-2 rounded border border-[#303030] bg-[#101010] px-2 py-1.5 text-[10px] text-gray-200 outline-none focus:border-cyan-500"
                            placeholder="Speaker labels, comma separated"
                          />
                          <textarea
                            value={reviewCorrectionDraft.transcriptText}
                            onChange={(event) => setReviewCorrectionDraft((draft) => ({ ...draft, transcriptText: event.target.value }))}
                            className="col-span-2 min-h-16 rounded border border-[#303030] bg-[#101010] px-2 py-1.5 text-[10px] leading-4 text-gray-200 outline-none focus:border-cyan-500"
                            placeholder="Transcript correction"
                          />
                          <textarea
                            value={reviewCorrectionDraft.manualNotes}
                            onChange={(event) => setReviewCorrectionDraft((draft) => ({ ...draft, manualNotes: event.target.value }))}
                            className="col-span-2 min-h-12 rounded border border-[#303030] bg-[#101010] px-2 py-1.5 text-[10px] leading-4 text-gray-200 outline-none focus:border-cyan-500"
                            placeholder="Review notes"
                          />
                        </div>
                      </div>
                    ) : null}

                    <div className="rounded-lg border border-[#252525] bg-[#141414] p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Review Queue</div>
                          <div className="mt-1 text-[10px] leading-4 text-gray-500">
                            Filter segments, resolve duplicates, then render only confirmed selections.
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <button
                            type="button"
                            onClick={handleSelectAllReviewSegments}
                            className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-200 hover:border-emerald-400"
                          >
                            Select all publishable
                          </button>
                          <button
                            type="button"
                            onClick={handleClearReviewSegmentSelection}
                            className="rounded border border-[#333] bg-[#101010] px-2 py-1 text-[10px] font-semibold text-gray-300 hover:border-[#444]"
                          >
                            Clear selection
                          </button>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-4 gap-1">
                        {[
                          { id: 'all' as const, label: 'All segments' },
                          { id: 'selected' as const, label: 'Selected only' },
                          { id: 'duplicates' as const, label: 'Duplicates only' },
                          { id: 'excluded' as const, label: 'Excluded only' },
                        ].map((filter) => (
                          <button
                            key={filter.id}
                            type="button"
                            onClick={() => setReviewVisibilityFilter(filter.id)}
                            className={`rounded border px-1.5 py-1 text-[9px] font-semibold transition-colors ${
                              reviewVisibilityFilter === filter.id
                                ? 'border-blue-500/50 bg-blue-500/10 text-blue-200'
                                : 'border-[#303030] bg-[#101010] text-gray-400 hover:border-[#444] hover:text-gray-200'
                            }`}
                          >
                            {filter.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                      {visibleReviewSegments.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-[#303030] bg-[#141414] p-4 text-[11px] leading-5 text-gray-500">
                          No segments match the current review filter.
                        </div>
                      ) : visibleReviewSegments.map((segment) => {
                        const index = Math.max(0, reviewSegments.findIndex((candidate) => candidate.id === segment.id));
                        const selected = selectedReviewSegmentIds.includes(segment.id) && segment.status === 'selected';
                        const previewing = activeReviewSegment?.id === segment.id;
                        return (
                          <div
                            key={segment.id}
                            className={`rounded-lg border p-3 ${
                              previewing
                                ? 'border-cyan-500/50 bg-cyan-500/10'
                                : selected
                                ? 'border-blue-500/50 bg-blue-500/10'
                                : segment.status === 'duplicate'
                                  ? 'border-amber-500/30 bg-amber-500/10'
                                  : 'border-[#252525] bg-[#141414]'
                            }`}
                          >
                            <div className="flex items-start gap-2">
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={() => handleToggleReviewSegment(segment.id)}
                                className="mt-1 h-4 w-4 accent-blue-500"
                                aria-label={`Select review segment ${index + 1}`}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handlePreviewReviewSegment(segment)}
                                    className="truncate text-left text-[11px] font-bold text-gray-100 hover:text-blue-300"
                                  >
                                    {String(index + 1).padStart(2, '0')}. {segment.title}
                                  </button>
                                  <span className="shrink-0 rounded border border-[#333] bg-[#101010] px-1.5 py-0.5 text-[9px] font-semibold text-gray-400">
                                    {formatTime(segment.startMs / 1_000)} - {formatTime(segment.endMs / 1_000)}
                                  </span>
                                </div>
                                <div className="mt-1 line-clamp-2 text-[10px] leading-4 text-gray-500">
                                  {segment.transcriptText || segment.summary || 'Transcript evidence retained for this segment.'}
                                </div>
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {segment.speakerRoles.slice(0, 3).map((speakerRole) => (
                                    <span key={speakerRole} className="rounded border border-[#333] bg-[#101010] px-1.5 py-0.5 text-[9px] font-semibold text-gray-400">
                                      {speakerRole}
                                    </span>
                                  ))}
                                  {segment.risks.slice(0, 3).map((risk) => (
                                    <span key={risk} className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-amber-200">
                                      {risk}
                                    </span>
                                  ))}
                                  {segment.status === 'duplicate' ? (
                                    <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-amber-200">
                                      duplicate excluded
                                    </span>
                                  ) : null}
                                  {previewing ? (
                                    <span className="rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-cyan-200">
                                      previewing
                                    </span>
                                  ) : null}
                                </div>
                                <div className="mt-2 grid grid-cols-4 gap-1">
                                  <button type="button" onClick={() => handleSplitReviewSegment(segment.id)} className="rounded border border-[#333] bg-[#101010] px-1.5 py-1 text-[9px] font-semibold text-gray-300 hover:border-blue-500/50 hover:text-blue-200">
                                    Split
                                  </button>
                                  <button type="button" onClick={() => handleMergeReviewSegment(segment.id, 'previous')} className="rounded border border-[#333] bg-[#101010] px-1.5 py-1 text-[9px] font-semibold text-gray-300 hover:border-blue-500/50 hover:text-blue-200">
                                    Merge prev
                                  </button>
                                  <button type="button" onClick={() => handleMergeReviewSegment(segment.id, 'next')} className="rounded border border-[#333] bg-[#101010] px-1.5 py-1 text-[9px] font-semibold text-gray-300 hover:border-blue-500/50 hover:text-blue-200">
                                    Merge next
                                  </button>
                                  {segment.status === 'duplicate' || !segment.selected ? (
                                    <button type="button" onClick={() => handleRestoreReviewSegment(segment.id)} className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-1 text-[9px] font-semibold text-emerald-200 hover:border-emerald-400">
                                      Restore
                                    </button>
                                  ) : (
                                    <button type="button" onClick={() => handleDeleteDuplicateReviewSegment(segment.id)} className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-1 text-[9px] font-semibold text-amber-200 hover:border-amber-400">
                                      Delete dup
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <Button
                      type="button"
                      size="lg"
                      className="w-full justify-center gap-2 rounded-lg bg-emerald-600 py-3 text-xs font-bold text-white hover:bg-emerald-500 disabled:bg-[#252525] disabled:text-gray-500"
                      onClick={handleRenderSelectedReviewSegments}
                      disabled={isRenderingReviewSelection || selectedReviewSegmentIds.length === 0}
                    >
                      <Scissors size={16} />
                      {isRenderingReviewSelection ? 'Rendering selected...' : `Render selected (${selectedReviewSegmentIds.length})`}
                    </Button>
                  </div>
                ) : (
                  <div className="mt-3 rounded-lg border border-dashed border-[#303030] bg-[#141414] p-4 text-[11px] leading-5 text-gray-500">
                    Run Review before render to create an editable segment plan. Automatic slicing remains available through Auto render.
                  </div>
                )}
              </section>

              <section className="rounded-lg border border-[#262626] bg-[#101010] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-blue-300">Smart Cut Engine</div>
                    <div className="mt-1 text-xs leading-5 text-gray-300">Semantic boundaries first, filters second</div>
                  </div>
                  <span className={`rounded border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${
                    requiresSpeakerDiarization
                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                      : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                  }`}>
                    {requiresSpeakerDiarization ? 'Multi-speaker gate' : 'Single-speaker ready'}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {SMART_CUT_ENGINE_BADGES.map((badge) => (
                    <span key={badge} className="rounded border border-[#303030] bg-[#151515] px-2 py-1 text-[10px] font-semibold text-gray-300">
                      {badge}
                    </span>
                  ))}
                </div>

                <div className="mt-4 rounded-lg border border-[#252525] bg-[#141414] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Scene Strategy</div>
                      <div className="mt-1 text-[12px] font-semibold text-gray-100">{smartCutExperience.profile.title}</div>
                    </div>
                    <span className="rounded border border-[#333] bg-[#101010] px-2 py-1 text-[10px] font-semibold text-gray-300">
                      {smartCutExperience.profile.primarySlicer}
                    </span>
                  </div>
                  <div className="mt-2 text-[10px] leading-4 text-gray-500">{smartCutExperience.profile.strategy}</div>
                </div>

                <div className="mt-3 rounded-lg border border-[#252525] bg-[#141414] p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Operator Brief</div>
                  <div className="mt-2 space-y-1.5 text-[10px] leading-4 text-gray-400">
                    <div><span className="font-semibold text-gray-200">Clip:</span> {smartCutExperience.publishableClipContract}</div>
                    <div><span className="font-semibold text-gray-200">Split:</span> {smartCutExperience.qaSplitContract}</div>
                    <div><span className="font-semibold text-gray-200">Format:</span> {smartCutExperience.formatContract}</div>
                    <div><span className="font-semibold text-gray-200">Duration:</span> {smartCutExperience.durationContract}</div>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-[#252525] bg-[#141414] p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Evidence Gate</div>
                    <div className="mt-1 text-[11px] font-semibold text-gray-200">
                      {requiresSpeakerDiarization ? 'STT + speaker diarization' : 'STT + adaptive speaker evidence'}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#252525] bg-[#141414] p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Boundary Contract</div>
                    <div className="mt-1 text-[11px] leading-4 text-gray-200">{smartCutExperience.profile.boundaryContract}</div>
                  </div>
                  <div className="rounded-lg border border-[#252525] bg-[#141414] p-3 col-span-2">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Review Contract</div>
                    <div className="mt-1 text-[11px] leading-4 text-gray-200">{smartCutExperience.profile.reviewContract}</div>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-[#252525] bg-[#141414] p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Quality Gate</div>
                    <div className="mt-1 text-[11px] leading-4 text-gray-200">9:16 / 1080x1920 / 30fps MP4</div>
                    <div className="mt-1 text-[10px] leading-4 text-gray-500">{smartCutExperience.subtitleContract}</div>
                  </div>
                  <div className="rounded-lg border border-[#252525] bg-[#141414] p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Fail Closed</div>
                    <div className="mt-1 text-[11px] leading-4 text-gray-200">{smartCutExperience.failClosedPolicy}</div>
                  </div>
                  <div className="rounded-lg border border-[#252525] bg-[#141414] p-3 col-span-2">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Human Review</div>
                    <div className="mt-1 text-[11px] leading-4 text-gray-200">{smartCutExperience.reviewCheckpoint}</div>
                    <div className="mt-1 text-[10px] leading-4 text-gray-500">{smartCutExperience.coverContract}</div>
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  {SMART_CUT_ENGINE_PIPELINE_STEPS.map((step, index) => (
                    <div key={step} className="grid grid-cols-[22px_1fr] items-start gap-2">
                      <div className="flex h-5 w-5 items-center justify-center rounded border border-[#303030] bg-[#181818] text-[10px] font-bold text-gray-400">
                        {index + 1}
                      </div>
                      <div>
                        <div className="text-[11px] font-semibold text-gray-200">{step}</div>
                        <div className="text-[10px] leading-4 text-gray-500">
                          {step === 'Speech-to-text evidence' ? 'Timestamped transcript is the source of truth.' : null}
                          {step === 'Speaker diarization' ? (requiresSpeakerDiarization ? 'Interview, dialogue, and meeting modes require real speaker labels.' : 'Talking-head mode can use a rule-based single-speaker adapter.') : null}
                          {step === 'Semantic content units' ? 'Complete logical units are built before destructive media filters.' : null}
                          {step === 'Candidate ID review' ? 'LLM ranks stable candidate ids and content unit ids only.' : null}
                          {step === 'Post-filter render' ? 'Denoise, silence trim, abnormal fragment removal, and repeat dedupe run after accepted boundaries.' : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  {engineReadinessItems.map((item) => (
                    <div key={item.label} className="rounded border border-[#252525] bg-[#141414] px-2 py-2">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{item.label}</div>
                      <div className="mt-1 truncate text-[11px] font-semibold text-gray-200" title={item.value}>{item.value}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-lg border border-[#262626] bg-[#101010] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-blue-300">Commercial Readiness</div>
                    <div className="mt-1 text-xs leading-5 text-gray-300">Launch gates before Smart Cut Engine execution</div>
                  </div>
                  <span className={`rounded border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${
                    hasCommercialReadinessBlocker
                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                      : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                  }`}>
                    {hasCommercialReadinessBlocker ? 'Blocked' : 'Ready'}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {commercialReadinessItems.map((item) => (
                    <div key={item.label} className="rounded border border-[#252525] bg-[#141414] px-2 py-2">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{item.label}</div>
                      <div className={`mt-1 text-[11px] font-semibold ${item.blocked ? 'text-amber-200' : 'text-gray-200'}`} title={item.value}>{item.value}</div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Mode Selection */}
              <div>
                <label className="block text-[11px] font-bold text-gray-500 mb-2 uppercase tracking-wider">
                  Smart-edit scene
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {MODES.map((mode) => {
                    const modeProfile = resolveSmartCutEngineProductProfile(mode);
                    return (
                      <button
                        key={mode}
                        data-smart-cut-strategy-status={modeProfile.executionSupport.status}
                        onClick={() => setSelectedMode(mode)}
                        className={`px-2 py-2 text-left rounded-lg transition-all border ${
                          selectedMode === mode
                            ? "bg-blue-600/20 border-blue-500 text-blue-300 shadow-[0_0_10px_rgba(59,130,246,0.15)]"
                            : "bg-[#141414] border-[#222] text-gray-400 hover:bg-[#1A1A1A] hover:border-[#333] hover:text-gray-200"
                        }`}
                      >
                        <span className="block truncate text-[11px] font-bold">{formatSmartCutEngineModeLabel(mode)}</span>
                        <span className="mt-0.5 block truncate text-[9px] font-semibold uppercase tracking-wider text-gray-500">{modeProfile.primarySlicer}</span>
                        <span
                          className={`mt-1 inline-flex max-w-full rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                            modeProfile.executionSupport.ready
                              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                              : 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                          }`}
                          title={modeProfile.executionSupport.detail}
                        >
                          {modeProfile.executionSupport.ready ? 'Ready' : 'Blocked'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="w-full h-px bg-[#222]"></div>

              {/* Publishing Strategy */}
              <div>
                <label className="block text-[11px] font-bold text-gray-500 mb-3 uppercase tracking-wider">Publishing Strategy</label>
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between items-end mb-1.5">
                       <span className="text-[11px] font-medium text-gray-300">Target Platform</span>
                    </div>
                    <div className="relative">
                      <select
                         value={targetPlatform}
                         onChange={e => setTargetPlatform(e.target.value as SliceTargetPlatform)}
                         className="w-full bg-[#141414] border border-[#222] hover:border-[#333] rounded-lg px-3 py-2 text-xs text-gray-200 outline-none focus:border-blue-500 appearance-none transition-all cursor-pointer shadow-sm">
                        <option value="douyin">Douyin / TikTok CN</option>
                        <option value="kuaishou">Kuaishou</option>
                        <option value="shipinhao">WeChat Channels</option>
                        <option value="xiaohongshu">Xiaohongshu</option>
                        <option value="bilibili">Bilibili</option>
                        <option value="generic">Generic</option>
                      </select>
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500">
                        <svg width="8" height="5" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                    </div>
                  </div>

                  <div>
                    <div>
                      <div className="flex justify-between items-end mb-1.5">
                         <span className="text-[11px] font-medium text-gray-300">Continuity</span>
                      </div>
                      <select
                         value={continuityLevel}
                         onChange={e => setContinuityLevel(e.target.value as SliceContinuityLevel)}
                         className="w-full bg-[#141414] border border-[#222] hover:border-[#333] rounded-lg px-3 py-2 text-xs text-gray-200 outline-none focus:border-blue-500 appearance-none transition-all cursor-pointer shadow-sm">
                        <option value="standard">Standard</option>
                        <option value="strict">Strict</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <div>
                      <div className="flex justify-between items-end mb-1.5">
                         <span className="text-[11px] font-medium text-gray-300">Segmentation mode</span>
                      </div>
                      <select
                         value={segmentationDensity}
                         onChange={e => setSegmentationDensity(e.target.value as SliceSegmentationDensity)}
                         className="w-full bg-[#141414] border border-[#222] hover:border-[#333] rounded-lg px-3 py-2 text-xs text-gray-200 outline-none focus:border-blue-500 appearance-none transition-all cursor-pointer shadow-sm">
                        <option value="default">Default segmentation</option>
                        <option value="maximize-continuity">Maximize continuous content</option>
                      </select>
                      <div className="mt-1 text-[10px] leading-4 text-gray-500">
                        Merge continuous semantic units up to max duration.
                      </div>
                    </div>
                  </div>

                  <div>
                    <div>
                      <div className="flex justify-between items-end mb-1.5">
                         <span className="text-[11px] font-medium text-gray-300">Speech-to-text mode</span>
                      </div>
                      <select
                         value={selectedSttWorkflowPreset?.id ?? sttPresetId}
                         onChange={e => {
                           const nextPreset = availableSttWorkflowPresets.find((preset) => preset.id === e.target.value);
                           if (nextPreset && !nextPreset.selectable) {
                             toast(nextPreset.uiDisabledReason ?? SMART_SLICE_GPU_STT_RUNTIME_REQUIRED_REASON, 'error');
                             return;
                           }
                           setSttPresetId(e.target.value);
                         }}
                         className="w-full bg-[#141414] border border-[#222] hover:border-[#333] rounded-lg px-3 py-2 text-xs text-gray-200 outline-none focus:border-blue-500 appearance-none transition-all cursor-pointer shadow-sm">
                        {availableSttWorkflowPresets.map((preset) => (
                          <option key={preset.id} value={preset.id} disabled={!preset.selectable}>{preset.uiLabel}</option>
                        ))}
                      </select>
                      {selectedSttWorkflowPreset ? (
                        <div className="mt-1 text-[10px] leading-4 text-gray-500">
                          {selectedSttWorkflowPreset.executionProfile}
                          {selectedSttWorkflowPreset.localWhisper
                            ? ` / ${selectedSttWorkflowPreset.localWhisper.chunkSourceStrategy} / chunks ${selectedSttWorkflowPreset.localWhisper.chunkParallelism}x${selectedSttWorkflowPreset.localWhisper.chunkThreadCount}t`
                            : ` / ${selectedSttWorkflowPreset.modelVendor ?? 'api'} / speaker diarization`}
                        </div>
                      ) : null}
                      {selectedSttWorkflowPresetDisabledReason ? (
                        <div className="mt-1 text-[10px] leading-4 text-amber-300">
                          {selectedSttWorkflowPresetDisabledReason}
                        </div>
                      ) : selectedSttWorkflowPreset?.executionProfile === 'gpu' && speechSetupStatus?.gpu.ready ? (
                        <div className="mt-1 text-[10px] leading-4 text-emerald-300">
                          GPU runtime ready: {speechSetupStatus.gpu.backend ?? 'detected'}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div>
                    <div className="relative">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-500 font-medium">Ideal</span>
                      <input
                        type="number"
                        value={idealDuration}
                        onChange={(event) =>
                          setIdealDuration((currentValue) =>
                            normalizeSlicerNumberInput(event.target.value, currentValue, minDuration, maxDuration),
                          )
                        }
                        className="w-full bg-[#141414] border border-[#222] rounded-lg pl-11 pr-2 py-1.5 text-xs text-white focus:border-blue-500 focus:bg-[#1A1A1A] outline-none transition-all"
                        min={5}
                        max={600}
                      />
                    </div>
                  </div>

                  <input
                    type="text"
                    value={customKeywordsInput}
                    onChange={e => setCustomKeywordsInput(e.target.value)}
                    placeholder="Keywords: hook, result, pain point"
                    className="w-full bg-[#141414] border border-[#222] rounded-lg px-3 py-2 text-xs text-gray-200 placeholder:text-gray-600 focus:border-blue-500 focus:bg-[#1A1A1A] outline-none transition-all"
                  />
                </div>
              </div>

              <div className="w-full h-px bg-[#222]"></div>

              {/* Duration Config */}
              <div>
                <label className="block text-[11px] font-bold text-gray-500 mb-2.5 uppercase tracking-wider flex justify-between items-center">
                  <span>Clip duration (seconds)</span>
                  <span className="text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded text-[10px]">{minDuration}s - {maxDuration}s</span>
                </label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-500 font-medium">Min</span>
                    <input
                      type="number"
                      value={minDuration}
                      onChange={(event) =>
                        setMinDuration((currentValue) =>
                          normalizeSlicerNumberInput(event.target.value, currentValue, 5, Math.min(180, maxDuration)),
                        )
                      }
                      className="w-full bg-[#141414] border border-[#222] rounded-lg pl-8 pr-2 py-1.5 text-xs text-white focus:border-blue-500 focus:bg-[#1A1A1A] outline-none transition-all"
                      min={5}
                      max={180}
                    />
                  </div>
                  <span className="text-gray-600 font-light">-</span>
                  <div className="flex-1 relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-500 font-medium">Max</span>
                    <input
                      type="number"
                      value={maxDuration}
                      onChange={(event) =>
                        setMaxDuration((currentValue) =>
                          normalizeSlicerNumberInput(event.target.value, currentValue, Math.max(10, minDuration), 600),
                        )
                      }
                      className="w-full bg-[#141414] border border-[#222] rounded-lg pl-8 pr-2 py-1.5 text-xs text-white focus:border-blue-500 focus:bg-[#1A1A1A] outline-none transition-all"
                      min={10}
                      max={600}
                    />
                  </div>
                </div>
              </div>

              {/* Subtitles Option */}
              <div>
                <div className="flex items-center justify-between group">
                  <div>
                    <div className="text-[11px] font-bold text-gray-400 group-hover:text-gray-200 transition-colors uppercase tracking-wider">Subtitles</div>
                      <div className="text-[10px] text-gray-600 mt-1">Generate sentence-level captions from speech evidence.</div>
                  </div>
                  <button
                    type="button"
                    onClick={handleSubtitleToggle}
                    className={`inline-flex min-w-[68px] items-center gap-1.5 rounded border px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors shrink-0 ${
                      enableSubtitles
                        ? 'border-blue-500/40 bg-blue-500/15 text-blue-200'
                        : 'border-[#333] bg-[#141414] text-gray-400 hover:border-[#444] hover:text-gray-200'
                    }`}
                    aria-pressed={enableSubtitles}
                  >
                    <Type size={12} />
                    {enableSubtitles ? 'On' : 'Off'}
                  </button>
                </div>
                {enableSubtitles ? (
                  <div className="mt-3 bg-[#141414] border border-[#222] rounded-lg p-3 relative animate-in fade-in slide-in-from-top-2">
                     <span className="text-[10px] font-bold text-gray-500 mb-2 block uppercase tracking-wider">Subtitle publishing</span>
                     <div className="grid grid-cols-3 gap-1 mb-3">
                       {[
                         { value: 'srt', label: 'SRT' },
                         { value: 'burned', label: 'Burned' },
                         { value: 'both', label: 'Burn + SRT' },
                       ].map((option) => (
                         <button
                           key={option.value}
                           type="button"
                           onClick={() => setSubtitleMode(option.value as SliceSubtitleMode)}
                           className={`rounded border px-2 py-1.5 text-[10px] font-medium transition-colors ${
                             subtitleMode === option.value
                               ? 'border-blue-500/60 bg-blue-500/15 text-blue-200'
                               : 'border-[#333] bg-[#0A0A0A] text-gray-400 hover:border-[#444] hover:text-gray-200'
                           }`}
                         >
                           {option.label}
                         </button>
                       ))}
                     </div>
                     <span className="text-[10px] font-bold text-gray-500 mb-2 block uppercase tracking-wider">Caption style</span>
                      <div className="relative">
                       <select
                          value={selectedSubtitleStyle}
                          onChange={(e) => setSelectedSubtitleStyle(e.target.value)}
                          className="w-full bg-[#0A0A0A] border border-[#333] hover:border-blue-500/50 rounded px-2.5 py-1.5 text-xs text-gray-200 outline-none focus:border-blue-500 appearance-none transition-all cursor-pointer shadow-sm">
                         {TEXT_EFFECTS.map(eff => (
                            <option key={eff.id} value={eff.id}>{eff.name} - {eff.text}</option>
                         ))}
                       </select>
                       <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500">
                         <svg width="8" height="5" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                           <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                         </svg>
                       </div>
                     </div>
                  </div>
                ) : null}
              </div>

              <div className="w-full h-px bg-[#222]"></div>

              {/* Algorithm Selection */}
              <div>
                <label className="block text-[11px] font-bold text-gray-500 mb-3 uppercase tracking-wider">Engine Review & Signals</label>
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between items-end mb-1.5">
                       <span className="text-[11px] font-medium text-gray-300">ID-only review model</span>
                    </div>
                    <div className="relative">
                      <select
                         value={llmModel}
                         onChange={(e) => setLlmModel(e.target.value as SliceLLM)}
                         className="w-full bg-[#141414] border border-[#222] hover:border-[#333] rounded-lg px-3 py-2 text-xs text-gray-200 outline-none focus:border-blue-500 appearance-none transition-all cursor-pointer shadow-sm">
                        {visibleLlmModelOptions.map((model) => (
                          <option key={`${model.vendor}:${model.id}`} value={model.id}>{model.label}</option>
                        ))}
                      </select>
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500">
                        <svg width="8" height="5" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#252525] bg-[#141414] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] font-semibold text-gray-300">Primary slicer</span>
                      <span className="rounded border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-[10px] font-bold text-blue-200">{smartCutExperience.profile.primarySlicer}</span>
                    </div>
                    <div className="mt-2 text-[10px] leading-4 text-gray-500">
                      Speech-to-text creates semantic content units; the model can only rank candidate ids and referenced unit ids.
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between items-end mb-1.5">
                      <span className="text-[11px] font-medium text-gray-300">Segmentation agent</span>
                    </div>
                    <div className="relative">
                      <select
                        value={segmentationAgentId}
                        onChange={(event) => setSegmentationAgentId(event.target.value as AutoCutSmartSliceSegmentationAgentId)}
                        className="w-full bg-[#141414] border border-[#222] hover:border-[#333] rounded-lg px-3 py-2 text-xs text-gray-200 outline-none focus:border-blue-500 appearance-none transition-all cursor-pointer shadow-sm">
                        {AUTOCUT_SMART_SLICE_SEGMENTATION_AGENTS.map((agent) => (
                          <option key={agent.id} value={agent.id}>{agent.label}</option>
                        ))}
                      </select>
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500">
                        <svg width="8" height="5" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                    </div>
                    <div className="mt-2 rounded-lg border border-[#252525] bg-[#101010] p-3">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{selectedSegmentationAgent.id}</div>
                      <div className="mt-1 text-[11px] leading-4 text-gray-300">{selectedSegmentationAgent.description}</div>
                      <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded border border-[#222] bg-[#080808] p-2 font-mono text-[10px] leading-4 text-gray-500">{selectedSegmentationAgent.systemPrompt}</pre>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg border border-[#252525] bg-[#141414] p-3">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Boundary rule</div>
                      <div className="mt-1 text-[11px] font-semibold text-gray-200">complete semantic unit</div>
                    </div>
                    <div className="rounded-lg border border-[#252525] bg-[#141414] p-3">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Audit trail</div>
                      <div className="mt-1 text-[11px] font-semibold text-gray-200">contentUnitIds + speakerRoles</div>
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#252525] bg-[#141414] p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Cleanup policy</div>
                    <div className="mt-1 text-[11px] leading-4 text-gray-200">{smartCutExperience.cleanupContract}</div>
                  </div>
                </div>
              </div>

              <div className="w-full h-px bg-[#222]"></div>

              {/* AI Filters */}
              <div>
                <label className="block text-[11px] font-bold text-gray-500 mb-1 uppercase tracking-wider">Post-boundary Filter Chain</label>
                <div className="mb-2 text-[10px] leading-4 text-gray-500">
                  Post-filter render keeps approved semantic content units intact.
                </div>
                <div className="space-y-0.5">

                  <div className="flex items-center justify-between group p-1.5 -mx-1.5 hover:bg-[#111] rounded-lg transition-colors cursor-pointer" onClick={() => setNoiseReduction(!noiseReduction)}>
                     <div className="flex items-center gap-2.5">
                        <div className="w-6 h-6 rounded bg-[#1A1A1A] border border-[#222] flex items-center justify-center group-hover:border-[#333] transition-colors">
                          <Waves size={12} className="text-gray-400 group-hover:text-blue-400 transition-colors" />
                        </div>
                        <span className="text-xs text-gray-300 font-medium">Denoise after cut approval</span>
                     </div>
                     <button className={`w-7 h-4 rounded-full p-0.5 transition-colors relative focus:outline-none ${noiseReduction ? 'bg-blue-600' : 'bg-[#333]'}`} type="button" aria-pressed={noiseReduction}>
                       <div className={`w-3 h-3 bg-white rounded-full transition-transform absolute top-0.5 shadow-sm ${noiseReduction ? 'translate-x-3' : 'translate-x-0'}`} />
                     </button>
                  </div>

                  <div className="flex items-center justify-between group p-1.5 -mx-1.5 hover:bg-[#111] rounded-lg transition-colors cursor-pointer" onClick={() => setCoughFilter(!coughFilter)}>
                     <div className="flex items-center gap-2.5">
                        <div className="w-6 h-6 rounded bg-[#1A1A1A] border border-[#222] flex items-center justify-center group-hover:border-[#333] transition-colors">
                          <MicOff size={12} className="text-gray-400 group-hover:text-orange-400 transition-colors" />
                        </div>
                        <span className="text-xs text-gray-300 font-medium">Silence and abnormal fragment removal</span>
                     </div>
                     <button className={`w-7 h-4 rounded-full p-0.5 transition-colors relative focus:outline-none ${coughFilter ? 'bg-blue-600' : 'bg-[#333]'}`}>
                       <div className={`w-3 h-3 bg-white rounded-full transition-transform absolute top-0.5 shadow-sm ${coughFilter ? 'translate-x-3' : 'translate-x-0'}`} />
                     </button>
                  </div>

                  <div className="flex items-center justify-between group p-1.5 -mx-1.5 hover:bg-[#111] rounded-lg transition-colors cursor-pointer" onClick={() => setRepeatFilter(!repeatFilter)}>
                     <div className="flex items-center gap-2.5">
                        <div className="w-6 h-6 rounded bg-[#1A1A1A] border border-[#222] flex items-center justify-center group-hover:border-[#333] transition-colors">
                          <CheckCircle2 size={12} className="text-gray-400 group-hover:text-green-400 transition-colors" />
                        </div>
                        <span className="text-xs text-gray-300 font-medium">Repeat dedupe inside approved units</span>
                     </div>
                     <button className={`w-7 h-4 rounded-full p-0.5 transition-colors relative focus:outline-none ${repeatFilter ? 'bg-blue-600' : 'bg-[#333]'}`}>
                       <div className={`w-3 h-3 bg-white rounded-full transition-transform absolute top-0.5 shadow-sm ${repeatFilter ? 'translate-x-3' : 'translate-x-0'}`} />
                     </button>
                  </div>

                </div>
              </div>

              <section className="rounded-lg border border-[#252525] bg-[#101010] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Intelligent dedup</div>
                    <div className="mt-1 text-[10px] leading-4 text-gray-500">
                      Call the shared video dedup component before final slice review.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEnableSmartDedup(!enableSmartDedup)}
                    className={`inline-flex min-w-[58px] items-center justify-center rounded border px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                      enableSmartDedup
                        ? 'border-amber-500/40 bg-amber-500/15 text-amber-200'
                        : 'border-[#333] bg-[#141414] text-gray-400 hover:border-[#444] hover:text-gray-200'
                    }`}
                    aria-pressed={enableSmartDedup}
                  >
                    {enableSmartDedup ? 'On' : 'Off'}
                  </button>
                </div>
                {enableSmartDedup ? (
                  <div className="mt-3">
                    <VideoDedupWorkbench
                      compact
                      title="Smart Slice dedup"
                      sourceAssetIds={fileId ? [fileId] : []}
                      analysisDisabledReason={fileId ? undefined : 'Smart Slice will analyze the current imported source after native preparation creates runtime source evidence. Configure methods here; duplicate matches appear in the review workbench.'}
                      initialParams={videoDedupParams}
                      onParamsChange={setVideoDedupParams}
                      onReportReady={setLatestVideoDedupReport}
                    />
                    {latestVideoDedupReport ? (
                      <div className="mt-2 rounded border border-[#303030] bg-[#141414] px-3 py-2 text-[10px] leading-4 text-gray-400">
                        Latest dedup report: {latestVideoDedupReport.duplicateGroupCount} groups,
                        {' '}{latestVideoDedupReport.matchCount} matches.
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>

              <div className="w-full h-px bg-[#222]"></div>

              <section className="rounded-lg border border-[#252525] bg-[#101010] p-4">
                <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Output Package</div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded border border-[#252525] bg-[#151515] px-2 py-2">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Profile</div>
                    <div className="mt-1 text-[11px] font-semibold text-gray-200">{smartCutExperience.publishProfile}</div>
                  </div>
                  <div className="rounded border border-[#252525] bg-[#151515] px-2 py-2">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Duration</div>
                    <div className="mt-1 text-[11px] font-semibold text-gray-200">{smartCutExperience.durationTarget}</div>
                  </div>
                  <div className="rounded border border-[#252525] bg-[#151515] px-2 py-2">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Subtitle</div>
                    <div className="mt-1 text-[11px] font-semibold text-gray-200">{smartCutExperience.subtitleOutput}</div>
                  </div>
                  <div className="rounded border border-[#252525] bg-[#151515] px-2 py-2">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Evidence</div>
                    <div className="mt-1 text-[11px] font-semibold text-gray-200">audit-ready</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {smartCutExperience.outputPackage.map((item) => (
                    <span key={item} className="rounded border border-[#303030] bg-[#151515] px-2 py-1 text-[10px] font-semibold text-gray-300">
                      {item}
                    </span>
                  ))}
                </div>
                <div className="mt-3 text-[10px] leading-4 text-gray-500">
                  Output packages retain transcript text, contentUnitIds, speakerRoles, filter decisions, and render artifacts for review.
                </div>
              </section>

            </div>
          </div>

          <div className="p-5 border-t border-[#222] bg-[#0A0A0A]">
            <Button
              size="lg"
              className="w-full flex items-center justify-center gap-2 font-bold tracking-wide bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20 transition-all rounded-xl py-4 h-auto disabled:cursor-not-allowed disabled:bg-[#252525] disabled:text-gray-500 disabled:shadow-none"
              onClick={handleStart}
              disabled={isProcessing || hasCommercialReadinessBlocker}
            >
              <Scissors size={20} />
              <span className="text-sm">
                {isProcessing
                  ? "Smart Cut Engine running..."
                  : hasVideoSource
                    ? runMode === 'review-before-render'
                      ? "Analyze for review"
                      : "Run Smart Cut Engine"
                    : "Select source video first"}
              </span>
            </Button>
            <p className="text-center text-[10px] text-gray-600 mt-3 leading-relaxed">
              {hasVideoSource ? smartCutExperience.profile.title : 'Smart Cut requires a local or trusted source video before speech evidence analysis.'}
            </p>
          </div>
          </>
          )}
        </aside>
      </div>

      {speechSetupDialogOpen && (
        <div className="absolute inset-0 z-[80] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="smart-slice-speech-setup-title">
          <div className="w-full max-w-[560px] rounded-lg border border-[#2b2b2b] bg-[#101010] shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-[#242424] px-5 py-4">
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 flex h-9 w-9 items-center justify-center rounded-md border ${
                  speechSetupErrorMessage
                    ? 'border-red-500/30 bg-red-500/10 text-red-300'
                    : speechSetupBusy
                      ? 'border-blue-500/30 bg-blue-500/10 text-blue-300'
                      : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                }`}>
                  {speechSetupErrorMessage ? <AlertTriangle size={18} /> : speechSetupBusy ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                </div>
                <div>
                  <h2 id="smart-slice-speech-setup-title" className="text-sm font-semibold text-gray-100">{t('slicer.speechSetup.title')}</h2>
                  <p className="mt-1 text-xs leading-5 text-gray-400">{createSmartSliceSpeechSetupStatusText(speechSetupStatus, speechSetupErrorMessage, t, speechModelDownloadCompleted)}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSpeechSetupDialogOpen(false)}
                className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-[#202020] hover:text-gray-200"
                disabled={speechSetupBusy}
                aria-label={t('slicer.speechSetup.action.close')}
              >
                <XCircle size={18} />
              </button>
            </div>

            <div className="space-y-4 px-5 py-4">
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'executable', label: t('slicer.speechSetup.checklist.executable'), ready: speechSetupStatus?.executable.ready, detail: formatSmartSliceSpeechSetupPath(speechSetupStatus?.executable.path || speechSetupStatus?.defaults.executablePath) || (speechSetupStatus?.executable.ready ? t('slicer.speechSetup.checklist.detected') : t('slicer.speechSetup.checklist.pending')) },
                  { id: 'model', label: t('slicer.speechSetup.checklist.model'), ready: speechModelReadyForDisplay, detail: speechModelDownloadCompleted ? t('slicer.speechSetup.checklist.completed') : speechModelDetailForDisplay },
                  { id: 'finalCheck', label: t('slicer.speechSetup.checklist.finalCheck'), ready: speechSetupStatus?.test.ready, detail: speechSetupStatus?.test.ready ? t('slicer.speechSetup.checklist.passed') : speechFinalCheckNeedsAttention ? t('slicer.speechSetup.checklist.needsAttention') : t('slicer.speechSetup.checklist.pendingCheck') },
                ].map((item) => (
                  <div key={item.label} className="rounded-md border border-[#252525] bg-[#151515] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{item.label}</span>
                      {item.ready ? <CheckCircle2 size={14} className="text-green-400" /> : <AlertTriangle size={14} className={speechFinalCheckNeedsAttention && item.id === 'finalCheck' ? 'text-red-400' : 'text-amber-400'} />}
                    </div>
                    <div className="mt-2 truncate text-xs leading-4 text-gray-300" title={item.detail}>{item.detail}</div>
                  </div>
                ))}
              </div>

              <div className="rounded-md border border-[#252525] bg-[#151515] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-gray-200">{t('slicer.speechSetup.executable.title')}</div>
                    <div className="mt-1 text-[11px] text-gray-500">
                      {speechSetupStatus?.executable.ready ? t('slicer.speechSetup.executable.detected') : t('slicer.speechSetup.executable.checking')}
                    </div>
                  </div>
                  <div className={`text-xs font-bold ${speechSetupStatus?.executable.ready ? 'text-emerald-300' : 'text-amber-300'}`}>
                    {speechSetupStatus?.executable.ready ? t('slicer.speechSetup.executable.ready') : t('slicer.speechSetup.executable.pending')}
                  </div>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#252525]">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: speechSetupStatus?.executable.ready ? '100%' : '8%' }}
                  />
                </div>
                <div className="mt-2 truncate text-[10px] text-gray-500" title={speechSetupStatus?.executable.path || speechSetupStatus?.defaults.executablePath || ''}>
                  {formatSmartSliceSpeechSetupPath(speechSetupStatus?.executable.path || speechSetupStatus?.defaults.executablePath) || t('slicer.speechSetup.executable.defaultPath')}
                </div>
              </div>

              <div className="rounded-md border border-[#252525] bg-[#151515] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-gray-200">{t('slicer.speechSetup.model.title')}</div>
                    <div className="mt-1 text-[11px] text-gray-500">{getSmartSliceSpeechSetupProgressLabel(speechModelDownloadProgress, t)}</div>
                  </div>
                  <div className={`text-xs font-bold ${speechModelDownloadFailed ? 'text-red-300' : speechModelDownloadCompleted ? 'text-emerald-300' : 'text-blue-300'}`}>
                    {speechModelProgressPercent}%
                  </div>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#252525]">
                  <div
                    className={`h-full rounded-full transition-all ${speechModelDownloadFailed ? 'bg-red-500' : speechModelDownloadCompleted ? 'bg-emerald-500' : 'bg-blue-500'}`}
                    style={{ width: `${speechModelDownloadFailed ? Math.max(8, speechModelProgressPercent) : speechModelProgressPercent}%` }}
                  />
                </div>
                <div className="mt-2 flex justify-between text-[10px] text-gray-600">
                  <span>{speechModelDownloadCompleted ? t('slicer.speechSetup.model.completed') : speechModelDownloadFailed ? t('slicer.speechSetup.model.retry') : speechModelDownloadActive ? t('slicer.speechSetup.model.downloading') : t('slicer.speechSetup.model.waiting')}</span>
                  <span>
                    {formatSmartSliceSpeechSetupBytes(speechModelDownloadProgress?.downloadedBytes)}
                    {speechModelDownloadProgress?.totalBytes ? ` / ${formatSmartSliceSpeechSetupBytes(speechModelDownloadProgress.totalBytes)}` : ''}
                  </span>
                </div>
                <div className="mt-2 truncate text-[10px] text-gray-500" title={speechModelDownloadProgress?.modelPath || speechSetupStatus?.model.path || speechSetupStatus?.defaults.modelPath || ''}>
                  {formatSmartSliceSpeechSetupPath(speechModelDownloadProgress?.modelPath || speechSetupStatus?.model.path || speechSetupStatus?.defaults.modelPath) || t('slicer.speechSetup.model.defaultPath')}
                </div>
              </div>

              {speechSetupStatus?.diagnostics?.length ? (
                <div className="max-h-24 overflow-y-auto rounded-md border border-[#252525] bg-[#0b0b0b] p-3 text-[11px] leading-5 text-gray-400">
                  <div className="mb-1 font-semibold text-gray-500">{t('slicer.speechSetup.diagnostics')}</div>
                  {speechSetupStatus.diagnostics.map((diagnostic, index) => (
                    <div key={`${diagnostic}:${index}`}>{diagnostic}</div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#242424] px-5 py-4">
              <Button
                type="button"
                variant="secondary"
                className="h-9 gap-2 border-[#333] bg-[#181818] px-3 text-xs text-gray-200 hover:bg-[#222]"
                onClick={() => navigate('/settings?tab=speech')}
              >
                <ExternalLink size={14} />
                {t('slicer.speechSetup.action.openSettings')}
              </Button>
              <Button
                type="button"
                className="h-9 gap-2 bg-blue-600 px-3 text-xs text-white hover:bg-blue-500"
                onClick={runSmartSliceLocalSpeechTranscriptionInitialization}
                disabled={speechSetupBusy}
              >
                {speechSetupBusy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                {speechSetupBusy ? t('slicer.speechSetup.action.preparing') : t('slicer.speechSetup.action.retry')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
