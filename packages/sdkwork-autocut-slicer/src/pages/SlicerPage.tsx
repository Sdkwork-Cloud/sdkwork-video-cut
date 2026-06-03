import { analyzeVideoSlicePlan, processVideoSlice, renderVideoSlicePlan, saveVideoSliceReviewDraft } from '../service/slicerService';
import React, { Suspense, useState, useEffect, useMemo, useRef, useImperativeHandle, forwardRef, useCallback } from "react";
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Play, Pause, Settings2, Scissors, CheckCircle2, MicOff, Waves, Video, RefreshCcw, XCircle, ChevronRight, Type, Download, AlertTriangle, ExternalLink, Loader2 } from "lucide-react";
import { Button, useToast, TaskFailureState, VideoDedupWorkbench, useAutoCutCommonLabels, createAutoCutTrustedLocalFile, resolveAutoCutTrustedSourcePath, type AutoCutTrustedFileSourceDescriptor } from "@sdkwork/autocut-commons";
import { AUTOCUT_DEFAULT_SMART_SLICE_SEGMENTATION_AGENT_ID, AUTOCUT_DEFAULT_SPEECH_TRANSCRIPTION_WORKFLOW_PRESET_ID, AUTOCUT_MODEL_VENDOR_PRESETS, AUTOCUT_SLICE_LLM_MODEL_OPTIONS, AUTOCUT_SMART_SLICE_SEGMENTATION_AGENTS, AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_PHASE, AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS, AUTOCUT_SPEECH_TRANSCRIPTION_WORKFLOW_PRESETS, AUTOCUT_TASK_STATUS, AUTOCUT_TASK_TYPE, type AutoCutLlmRuntimeConfig, type AutoCutLocalSpeechTranscriptionSetupStatus, type AutoCutSliceManualEdit, type AutoCutSliceReviewSegment, type AutoCutSliceReviewSession, type AutoCutSmartSliceSegmentationAgentId, type AutoCutSpeechTranscriptionModelDownloadProgressEvent, type AutoCutSpeechTranscriptionWorkflowPreset, type ModelVendor, type SliceMode, type SliceLLM, type SliceTargetPlatform, type SliceTargetAspectRatio, type SliceVideoObjectFit, type SliceContinuityLevel, type SliceSegmentationDensity, type SliceSubtitleMode, type AppTask, type VideoDedupParams, type VideoDedupReport, type VideoSliceParams } from "@sdkwork/autocut-types";
import { createAutoCutObjectUrl, createAutoCutTimestamp, createDefaultAutoCutVideoDedupParams, formatAutoCutTimeOfDay, getAutoCutNativeHostClient, getAutoCutProcessingTaskErrorTaskId, getAutoCutWorkflowPreferences, getTasks, initializeAutoCutLocalSpeechTranscriptionSetup, inspectAutoCutLocalSpeechTranscriptionSetup, listenAutoCutEvent, reportAutoCutDiagnostic, resolveAutoCutLlmRuntimeConfig, revokeAutoCutObjectUrl, saveAutoCutVideoSlicePreferences, selectAutoCutTrustedLocalVideoFile, sortAutoCutRecordsByCreatedAtDesc, writeAutoCutClipboardText } from "@sdkwork/autocut-services";
import { correctSliceReviewSegmentOnStudioTimeline, createSliceReviewSessionFromSegments, createStudioClipTimelineSnapshotForReviewSession, createStudioClipTimelineSnapshotForSourcePreview, markSliceReviewSegmentAsDuplicateOnStudioTimeline, mergeSliceReviewSegmentsOnStudioTimeline, restoreSliceReviewSegmentOnStudioTimeline, selectAllSliceReviewSegmentsForRender, setSliceReviewSegmentRenderSelectionOnStudioTimeline, setSliceReviewSegmentsRenderSelectionForRender } from "../service/clipWorkflow";
import {
  SmartSliceTimelineWorkbench,
  useSmartSliceTimelineReviewController,
  type SmartSliceTimelineReviewCommitOptions,
} from "../components/smart-slice-timeline";
import type { WebGLPlayerRef, TextEffectStyle, TextEffectDragPayload } from "../components/WebGLPlayer";

const WebGLPlayer = React.lazy(() => import("../components/WebGLPlayer"));
const SMART_SLICE_DEDUP_REVIEW_RISK_CODE = 'smart-dedup-review';
const SMART_SLICE_DEFAULT_TARGET_PLATFORM: SliceTargetPlatform = 'generic';

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

function updateSlicerTask(tasks: readonly AppTask[], taskId: string, update: (task: AppTask) => AppTask): AppTask[] {
  return tasks.map((task) => task.id === taskId ? update(task) : task);
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

const NativeSmartSliceVideoPreview = React.memo(forwardRef<SmartSlicePlayerRef, SmartSliceVideoPreviewProps>(
  ({ videoSrc, aspectRatio, videoObjectFit = 'contain', onVideoLoaded, onTimeUpdate, onPlayStateChange }, ref) => {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const containerAspectRatio = aspectRatio && aspectRatio !== 'auto' ? aspectRatio.replace(':', ' / ') : undefined;

    useImperativeHandle(ref, () => ({
      play: () => {
        const video = videoRef.current;
        if (video) {
          void video.play().then(() => onPlayStateChange?.(true)).catch(() => onPlayStateChange?.(false));
        }
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
          void video.play().then(() => onPlayStateChange?.(true)).catch(() => onPlayStateChange?.(false));
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
                void video.play().then(() => onPlayStateChange?.(true)).catch(() => onPlayStateChange?.(false));
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
));

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
  uiDetail: string;
  uiLabel: string;
};

type AutoCutTranslate = ReturnType<typeof useTranslation>['t'];
type SmartSliceRunMode = 'auto-render' | 'review-before-render';
type SliceReviewVisibilityFilter = 'all' | 'selected' | 'duplicates' | 'excluded';
type SmartSliceReviewCorrectionDraft = {
  title: string;
  startMs: string;
  endMs: string;
  transcriptText: string;
  speakerRoles: string;
  manualNotes: string;
};
type SmartSliceReviewCorrectionField = {
  id: keyof SmartSliceReviewCorrectionDraft;
  control: 'input' | 'textarea';
  inputType?: 'text' | 'number';
  value: string;
  placeholder: string;
  className: string;
};
type SmartSliceAdvancedI18nGroup = 'sceneOptions' | 'sttPresets' | 'segmentationAgents';
type SmartSliceAdvancedI18nField = 'label' | 'detail' | 'title';

const MODES: SliceMode[] = [
  'general',
  'talking-head',
  'commerce-live',
  'dialogue',
  'meeting',
  'performance',
  'film',
];

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

function createSmartSliceAdvancedI18nKey(
  group: SmartSliceAdvancedI18nGroup,
  id: string,
  field: SmartSliceAdvancedI18nField,
) {
  return `slicer.settings.advanced.${group}.${id}.${field}`;
}

function formatSmartSliceAdvancedI18nText(
  t: AutoCutTranslate,
  group: SmartSliceAdvancedI18nGroup,
  id: string,
  field: SmartSliceAdvancedI18nField,
  fallback: string,
  values?: Record<string, string | number>,
) {
  const key = createSmartSliceAdvancedI18nKey(group, id, field);
  const translated = values ? t(key, values) : t(key);
  return translated === key ? fallback : translated;
}

function formatSmartSliceSttWorkflowPresetLabel(
  preset: AutoCutSpeechTranscriptionWorkflowPreset,
  t: AutoCutTranslate,
  status?: 'gpuRuntimeRequired' | 'configureVendorApiKey' | 'recommended',
) {
  const label = formatSmartSliceAdvancedI18nText(t, 'sttPresets', preset.id, 'label', preset.label);
  if (status === 'gpuRuntimeRequired') {
    return t('slicer.settings.advanced.gpuRuntimeRequiredSuffix', { label });
  }
  if (status === 'configureVendorApiKey') {
    return t('slicer.settings.advanced.configureApiKeySuffix', { label });
  }
  if (status === 'recommended') {
    return t('slicer.settings.advanced.recommendedSuffix', { label });
  }
  return label;
}

function createSmartSliceSttWorkflowPresetDisabledReason(
  preset: AutoCutSpeechTranscriptionWorkflowPreset,
  t: AutoCutTranslate,
  reason: 'gpuRuntimeRequired' | 'configureVendorApiKey',
  gpuDiagnostic?: string,
) {
  if (reason === 'gpuRuntimeRequired') {
    return gpuDiagnostic?.trim() || t('slicer.settings.advanced.gpuRuntimeRequired');
  }
  return t('slicer.settings.advanced.configureVendorApiKey', {
    vendor: preset.modelVendor ?? t('slicer.settings.advanced.matchingVendor'),
  });
}

function createSmartSliceSttWorkflowPresetDetail(
  preset: AutoCutSpeechTranscriptionWorkflowPreset,
  t: AutoCutTranslate,
) {
  if (preset.localWhisper) {
    return t('slicer.settings.advanced.localExecutionDetail', {
      profile: preset.executionProfile,
      strategy: preset.localWhisper.chunkSourceStrategy,
      parallelism: preset.localWhisper.chunkParallelism,
      threads: preset.localWhisper.chunkThreadCount,
    });
  }
  return t('slicer.settings.advanced.cloudExecutionDetail', {
    profile: preset.executionProfile,
    vendor: preset.modelVendor ?? t('slicer.settings.advanced.apiVendor'),
  });
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

function formatSlicerTimelineTime(timeInSecs: number) {
  if (!timeInSecs || timeInSecs < 0 || Number.isNaN(timeInSecs)) {
    return '00:00';
  }
  const totalSeconds = Math.floor(timeInSecs);
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
  const secs = (totalSeconds % 60).toString().padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${mins}:${secs}`;
  }
  return `${mins}:${secs}`;
}

function isSliceLlmModelId(value: string): value is SliceLLM {
  return AUTOCUT_SLICE_LLM_MODEL_OPTIONS.some((model) => model.id === value);
}

function resolveSmartSliceLlmModelForVendor(vendor: ModelVendor, value: string): SliceLLM {
  if (vendor === 'custom') {
    return value;
  }

  const providerModel = AUTOCUT_SLICE_LLM_MODEL_OPTIONS.find((model) => model.vendor === vendor && model.id === value);
  if (providerModel && isSliceLlmModelId(providerModel.id)) {
    return providerModel.id;
  }

  const defaultModel = AUTOCUT_MODEL_VENDOR_PRESETS[vendor].defaultModel;
  const defaultProviderModel = AUTOCUT_SLICE_LLM_MODEL_OPTIONS.find(
    (model) => model.vendor === vendor && model.id === defaultModel,
  );
  if (defaultProviderModel && isSliceLlmModelId(defaultProviderModel.id)) {
    return defaultProviderModel.id;
  }

  const fallbackModel = AUTOCUT_SLICE_LLM_MODEL_OPTIONS.find(
    (model) => model.vendor === 'deepseek' && model.id === AUTOCUT_MODEL_VENDOR_PRESETS.deepseek.defaultModel,
  );
  if (fallbackModel && isSliceLlmModelId(fallbackModel.id)) {
    return fallbackModel.id;
  }

  return 'deepseek-v4-flash';
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

export function SlicerPage() {
  const commonLabels = useAutoCutCommonLabels();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const playerRef = useRef<SmartSlicePlayerRef>(null);
  const replaceVideoInputRef = useRef<HTMLInputElement>(null);
  const rawSourceUrl = searchParams.get('url')?.trim() ?? '';
  const initialSourceUrl = rawSourceUrl && /^https?:\/\//i.test(rawSourceUrl) ? rawSourceUrl : '';
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
  const sourceUrl = initialSourceUrl;
  const [videoSrc, setVideoSrc] = useState<string>(initialSourceUrl);
  const blobUrlRef = useRef<string>('');
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
  const [reviewVisibilityFilter, setReviewVisibilityFilter] = useState<SliceReviewVisibilityFilter>('all');
  const [activeReviewSegmentId, setActiveReviewSegmentId] = useState<string>('');
  const [reviewManualEdits, setReviewManualEdits] = useState<AutoCutSliceManualEdit[]>([]);
  const [isRenderingReviewSelection, setIsRenderingReviewSelection] = useState(false);
  const [isSavingReviewDraft, setIsSavingReviewDraft] = useState(false);
  const [reviewDraftSavedAt, setReviewDraftSavedAt] = useState<string>('');
  const [reviewDraftSaveError, setReviewDraftSaveError] = useState<string>('');
  const [showReviewCorrectionEditor, setShowReviewCorrectionEditor] = useState(false);
  const [expandedReviewSegmentActionId, setExpandedReviewSegmentActionId] = useState<string>('');
  const [reviewCorrectionDraft, setReviewCorrectionDraft] = useState<SmartSliceReviewCorrectionDraft>({
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
  const isInitializingSpeechSetupRef = useRef(false);
  const [speechModelDownloadProgress, setSpeechModelDownloadProgress] = useState<AutoCutSpeechTranscriptionModelDownloadProgressEvent | null>(null);
  const [enableOverlayEditor, setEnableOverlayEditor] = useState(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;
  const durationRef = useRef(duration);
  durationRef.current = duration;
  const processingGenerationRef = useRef(0);
  const [videoProgress, setVideoProgress] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
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
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [videoDedupParams, setVideoDedupParams] = useState<VideoDedupParams>(() =>
    createDefaultAutoCutVideoDedupParams({ mode: 'slice-result-dedup' }),
  );
  const [latestVideoDedupReport, setLatestVideoDedupReport] = useState<VideoDedupReport | null>(null);
  const speechGpuDiagnosticsText = speechSetupStatus?.gpu?.diagnostics?.join('\n') ?? '';
  const availableSttWorkflowPresets = useMemo<SmartSliceVisibleSttWorkflowPreset[]>(
    () => AUTOCUT_SPEECH_TRANSCRIPTION_WORKFLOW_PRESETS.filter((preset) => preset.available).map((preset) => {
      const gpuPresetWithoutRuntime =
        preset.executionProfile === 'gpu' && speechSetupStatus?.gpu.ready !== true;
      const apiPresetWithoutCredentials =
        preset.executionProfile === 'cloud' &&
        (!activeLlmRuntimeConfig?.apiKeyConfigured ||
          (preset.modelVendor !== undefined && activeLlmRuntimeConfig.modelVendor !== preset.modelVendor));
      const sttWorkflowState = gpuPresetWithoutRuntime
        ? 'gpuRuntimeRequired'
        : apiPresetWithoutCredentials
          ? 'configureVendorApiKey'
          : 'recommended' in preset && preset.recommended === true
            ? 'recommended'
            : undefined;
      const uiDisabledReason = gpuPresetWithoutRuntime
        ? createSmartSliceSttWorkflowPresetDisabledReason(
          preset,
          t,
          'gpuRuntimeRequired',
          speechSetupStatus?.gpu.diagnostics[0],
        )
        : apiPresetWithoutCredentials
          ? createSmartSliceSttWorkflowPresetDisabledReason(preset, t, 'configureVendorApiKey')
          : undefined;
      return {
        ...preset,
        selectable: !gpuPresetWithoutRuntime && !apiPresetWithoutCredentials,
        ...(uiDisabledReason ? { uiDisabledReason } : {}),
        uiDetail: createSmartSliceSttWorkflowPresetDetail(preset, t),
        uiLabel: formatSmartSliceSttWorkflowPresetLabel(preset, t, sttWorkflowState),
      };
    }),
    [activeLlmRuntimeConfig?.apiKeyConfigured, activeLlmRuntimeConfig?.modelVendor, speechGpuDiagnosticsText, speechSetupStatus?.gpu.ready, t],
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
  const smartCutExperience = useMemo(() => createSmartCutEngineProductExperience({
    mode: selectedMode,
    targetPlatform: SMART_SLICE_DEFAULT_TARGET_PLATFORM,
    aspectRatio,
    idealDuration,
    enableSubtitles,
    subtitleMode,
    minDuration,
    maxDuration,
    noiseReduction,
    coughFilter,
    repeatFilter,
  }), [selectedMode, aspectRatio, idealDuration, enableSubtitles, subtitleMode, minDuration, maxDuration, noiseReduction, coughFilter, repeatFilter]);
  const hasVideoSource = Boolean(file || fileId || sourceUrl || videoSrc);
  const strategyExecutionSupport = smartCutExperience.profile.executionSupport;
  const smartSliceSpeechReady =
    speechModelReadyForDisplay ||
    speechSetupStatus?.readiness === AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.ready;
  const smartSliceReadyForRun = hasVideoSource && strategyExecutionSupport.ready;
  const smartSliceSettingsReadinessItems = useMemo(() => [
    {
      id: 'source',
      label: t('slicer.settings.status.source'),
      value: hasVideoSource ? t('slicer.settings.status.sourceReady') : t('slicer.settings.status.sourceMissing'),
      ready: hasVideoSource,
    },
    {
      id: 'stt',
      label: t('slicer.settings.status.stt'),
      value: smartSliceSpeechReady ? t('slicer.settings.status.sttReady') : t('slicer.settings.status.sttCheck'),
      ready: smartSliceSpeechReady,
    },
    {
      id: 'strategy',
      label: t('slicer.settings.status.strategy'),
      value: strategyExecutionSupport.ready ? t('slicer.settings.status.strategyReady') : t('slicer.settings.status.strategyBlocked'),
      ready: strategyExecutionSupport.ready,
    },
  ], [hasVideoSource, smartSliceSpeechReady, strategyExecutionSupport.ready, t]);
  const smartSliceRunModeOptions = [
    {
      id: 'review-before-render',
      label: t('slicer.settings.runMode.review.label'),
      detail: t('slicer.settings.runMode.review.detail'),
    },
    {
      id: 'auto-render',
      label: t('slicer.settings.runMode.auto.label'),
      detail: t('slicer.settings.runMode.auto.detail'),
    },
  ] satisfies Array<{ id: SmartSliceRunMode; label: string; detail: string }>;
  const smartSliceDurationControls = useMemo(() => [
    {
      id: 'min',
      label: t('slicer.settings.basic.minDuration'),
      value: minDuration,
      min: 5,
      max: Math.min(180, maxDuration),
      update: setMinDuration,
    },
    {
      id: 'ideal',
      label: t('slicer.settings.basic.idealDuration'),
      value: idealDuration,
      min: minDuration,
      max: maxDuration,
      update: setIdealDuration,
    },
    {
      id: 'max',
      label: t('slicer.settings.basic.maxDuration'),
      value: maxDuration,
      min: Math.max(10, minDuration),
      max: 600,
      update: setMaxDuration,
    },
  ], [minDuration, maxDuration, idealDuration, t]);
  const smartSliceAspectRatioOptions = useMemo(() => [
    { value: 'auto', label: t('slicer.settings.basic.aspectAuto', { ratio: detectedRatio }) },
    { value: '16:9', label: '16:9' },
    { value: '9:16', label: '9:16' },
    { value: '1:1', label: '1:1' },
    { value: '4:3', label: '4:3' },
  ] satisfies Array<{ value: SliceTargetAspectRatio; label: string }>, [detectedRatio, t]);
  const smartSliceObjectFitOptions = [
    { value: 'contain', label: t('slicer.settings.basic.fitContain') },
    { value: 'cover', label: t('slicer.settings.basic.fitCover') },
  ] satisfies Array<{ value: SliceVideoObjectFit; label: string }>;
  const smartSliceAudioCleanupControls = useMemo(() => [
    {
      id: 'noise',
      icon: <Waves size={12} />,
      label: t('slicer.settings.basic.noiseReduction'),
      enabled: noiseReduction,
      toggle: () => setNoiseReduction((enabled) => !enabled),
    },
    {
      id: 'cough',
      icon: <MicOff size={12} />,
      label: t('slicer.settings.basic.silenceCleanup'),
      enabled: coughFilter,
      toggle: () => setCoughFilter((enabled) => !enabled),
    },
    {
      id: 'repeat',
      icon: <CheckCircle2 size={12} />,
      label: t('slicer.settings.basic.repeatFilter'),
      enabled: repeatFilter,
      toggle: () => setRepeatFilter((enabled) => !enabled),
    },
  ], [coughFilter, noiseReduction, repeatFilter, t]);
  const smartSliceContinuityOptions = [
    { value: 'standard', label: t('slicer.settings.advanced.continuityStandard') },
    { value: 'strict', label: t('slicer.settings.advanced.continuityStrict') },
  ] satisfies Array<{ value: SliceContinuityLevel; label: string }>;
  const smartSliceSegmentationOptions = [
    { value: 'default', label: t('slicer.settings.advanced.segmentationDefault') },
    { value: 'maximize-continuity', label: t('slicer.settings.advanced.segmentationContinuous') },
  ] satisfies Array<{ value: SliceSegmentationDensity; label: string }>;
  const smartSliceSceneOptions = MODES.map((mode) => {
    const profile = resolveSmartCutEngineProductProfile(mode);
    return {
      id: mode,
      label: formatSmartSliceAdvancedI18nText(
        t,
        'sceneOptions',
        profile.id,
        'label',
        formatSmartCutEngineModeLabel(mode),
      ),
      detail: formatSmartSliceAdvancedI18nText(
        t,
        'sceneOptions',
        profile.id,
        'detail',
        profile.primarySlicer,
      ),
      title: formatSmartSliceAdvancedI18nText(
        t,
        'sceneOptions',
        profile.id,
        'title',
        profile.strategy,
      ),
    };
  }) satisfies Array<{ id: SliceMode; label: string; detail: string; title: string }>;
  const smartSliceSubtitleModeOptions = [
    { value: 'srt', label: 'SRT' },
    { value: 'burned', label: t('slicer.settings.basic.subtitleBurned') },
    { value: 'both', label: t('slicer.settings.basic.subtitleBoth') },
  ] satisfies Array<{ value: SliceSubtitleMode; label: string }>;
  const smartSliceReviewFilterOptions = [
    { id: 'all', label: t('slicer.settings.review.filter.all') },
    { id: 'selected', label: t('slicer.settings.review.filter.selected') },
    { id: 'duplicates', label: t('slicer.settings.review.filter.duplicates') },
    { id: 'excluded', label: t('slicer.settings.review.filter.excluded') },
  ] satisfies Array<{ id: SliceReviewVisibilityFilter; label: string }>;
  const smartSlicePrimaryActionLabel = isProcessing
    ? t('slicer.settings.action.running')
    : hasVideoSource
      ? runMode === 'review-before-render'
        ? t('slicer.settings.action.analyze')
        : t('slicer.settings.action.run')
      : t('slicer.settings.action.selectSource');
  const handleSmartSliceAspectRatioChange = (value: string) => {
    const option = smartSliceAspectRatioOptions.find((item) => item.value === value);
    if (option) {
      setAspectRatio(option.value);
    }
  };
  const handleSmartSliceObjectFitChange = (value: string) => {
    const option = smartSliceObjectFitOptions.find((item) => item.value === value);
    if (option) {
      setVideoObjectFit(option.value);
    }
  };
  const handleSmartSliceContinuityChange = (value: string) => {
    const option = smartSliceContinuityOptions.find((item) => item.value === value);
    if (option) {
      setContinuityLevel(option.value);
    }
  };
  const handleSmartSliceSegmentationChange = (value: string) => {
    const option = smartSliceSegmentationOptions.find((item) => item.value === value);
    if (option) {
      setSegmentationDensity(option.value);
    }
  };
  const activeReviewTask = useMemo(
    () => slicerTasks.find((task) => task.id === activeReviewTaskId && task.sliceReviewSession) ??
      (!hasVideoSource && !activeReviewTaskId
        ? slicerTasks.find((task) => task.status === AUTOCUT_TASK_STATUS.reviewing && task.sliceReviewSession)
        : undefined),
    [activeReviewTaskId, hasVideoSource, slicerTasks],
  );
  const effectiveReviewSession = reviewSessionDraft ?? activeReviewTask?.sliceReviewSession ?? null;
  const reviewSegments = effectiveReviewSession?.segments ?? [];
  const activeStudioClipTimelineSnapshot = useMemo(
    () => {
      if (!effectiveReviewSession) {
        return activeReviewTask?.studioClipTimeline ?? null;
      }
      return createStudioClipTimelineSnapshotForReviewSession(
        effectiveReviewSession,
        activeReviewTask?.studioClipTimeline?.processingOperations ?? [],
      );
    },
    [activeReviewTask?.studioClipTimeline?.processingOperations, activeReviewTask?.studioClipTimeline, effectiveReviewSession],
  );
  const sourcePreviewTimeline = useMemo(
    () => {
      if (!hasVideoSource || effectiveReviewSession || activeStudioClipTimelineSnapshot) {
        return null;
      }
      return createStudioClipTimelineSnapshotForSourcePreview({
        sourceDurationMs: Math.max(1, Math.round(duration * 1_000)),
        sourceLabel: file?.name || sourceUrl || fileId || 'Source video',
        taskId: activeReviewTaskId || fileId || 'source-preview',
      });
    },
    [activeReviewTaskId, activeStudioClipTimelineSnapshot, duration, effectiveReviewSession, file?.name, fileId, hasVideoSource, sourceUrl],
  );
  const displayStudioClipTimelineSnapshot =
    activeStudioClipTimelineSnapshot ?? sourcePreviewTimeline?.timelineSnapshot ?? null;
  const displayReviewSegments = effectiveReviewSession
    ? reviewSegments
    : sourcePreviewTimeline?.reviewSegments ?? reviewSegments;
  const studioClipTimelineDurationMs = Math.max(
    1,
    displayStudioClipTimelineSnapshot?.timeline.durationMs ??
      effectiveReviewSession?.sourceDurationMs ??
      Math.round(duration * 1_000),
  );
  const publishableReviewSegmentCount = reviewSegments.filter((segment) => segment.status !== 'duplicate').length;
  const renderableReviewSegmentIds = reviewSegments
    .filter((segment) => segment.selected && segment.status === 'selected')
    .map((segment) => segment.id);
  const renderableReviewSegmentCount = renderableReviewSegmentIds.length;
  const selectedReviewSegmentIds = renderableReviewSegmentIds;
  const selectedReviewSegmentCount = selectedReviewSegmentIds.length;
  const canSelectAllReviewSegments = publishableReviewSegmentCount > 0;
  const canClearReviewSegmentSelection = selectedReviewSegmentCount > 0;
  const duplicateReviewSegmentCount = reviewSegments.filter((segment) => segment.status === 'duplicate').length;
  const duplicateReviewGroupCount = effectiveReviewSession?.duplicateGroups.length ?? 0;
  const smartDedupRiskSegmentCount = reviewSegments.filter((segment) =>
    segment.risks.includes(SMART_SLICE_DEDUP_REVIEW_RISK_CODE),
  ).length;
  const excludedReviewSegmentCount = reviewSegments.filter((segment) => segment.status === 'excluded').length;
  const smartSliceReviewStatusBadge = isSavingReviewDraft
    ? t('slicer.settings.review.status.saving')
    : reviewDraftSaveError
      ? t('slicer.settings.review.status.saveFailed')
      : reviewDraftSavedAt
        ? t('slicer.settings.review.status.saved', { time: reviewDraftSavedAt })
        : effectiveReviewSession
          ? t('slicer.settings.review.status.ready')
          : t('slicer.settings.review.status.noPlan');
  const smartSliceReviewMetricItems = useMemo(() => [
    {
      id: 'segments',
      label: t('slicer.settings.review.metric.segments'),
      value: reviewSegments.length,
      valueClassName: 'text-gray-100',
    },
    {
      id: 'selected',
      label: t('slicer.settings.review.metric.selected'),
      value: selectedReviewSegmentCount,
      valueClassName: 'text-emerald-200',
    },
    {
      id: 'duplicates',
      label: t('slicer.settings.review.metric.duplicates'),
      value: duplicateReviewSegmentCount,
      valueClassName: 'text-amber-200',
      detail: duplicateReviewGroupCount || smartDedupRiskSegmentCount
        ? t('slicer.settings.review.metric.duplicateDetail', {
            groups: duplicateReviewGroupCount,
            risks: smartDedupRiskSegmentCount,
          })
        : '',
    },
    {
      id: 'excluded',
      label: t('slicer.settings.review.metric.excluded'),
      value: excludedReviewSegmentCount,
      valueClassName: 'text-gray-300',
    },
  ], [duplicateReviewGroupCount, duplicateReviewSegmentCount, excludedReviewSegmentCount, reviewSegments.length, selectedReviewSegmentCount, smartDedupRiskSegmentCount, t]);
  const smartSliceReviewCorrectionFields = useMemo(() => [
    {
      id: 'title',
      control: 'input',
      inputType: 'text',
      value: reviewCorrectionDraft.title,
      placeholder: t('slicer.settings.review.correction.titlePlaceholder'),
      className: 'col-span-2 text-gray-200',
    },
    {
      id: 'startMs',
      control: 'input',
      inputType: 'number',
      value: reviewCorrectionDraft.startMs,
      placeholder: t('slicer.settings.review.correction.startPlaceholder'),
      className: 'text-gray-200',
    },
    {
      id: 'endMs',
      control: 'input',
      inputType: 'number',
      value: reviewCorrectionDraft.endMs,
      placeholder: t('slicer.settings.review.correction.endPlaceholder'),
      className: 'text-gray-200',
    },
    {
      id: 'speakerRoles',
      control: 'input',
      inputType: 'text',
      value: reviewCorrectionDraft.speakerRoles,
      placeholder: t('slicer.settings.review.correction.speakerPlaceholder'),
      className: 'col-span-2 text-gray-200',
    },
    {
      id: 'transcriptText',
      control: 'textarea',
      value: reviewCorrectionDraft.transcriptText,
      placeholder: t('slicer.settings.review.correction.transcriptPlaceholder'),
      className: 'col-span-2 min-h-16 leading-4 text-gray-200',
    },
    {
      id: 'manualNotes',
      control: 'textarea',
      value: reviewCorrectionDraft.manualNotes,
      placeholder: t('slicer.settings.review.correction.notesPlaceholder'),
      className: 'col-span-2 min-h-12 leading-4 text-gray-200',
    },
  ] satisfies SmartSliceReviewCorrectionField[], [reviewCorrectionDraft, t]);
  const visibleReviewSegments = useMemo(() => {
    if (reviewVisibilityFilter === 'selected') {
      return reviewSegments.filter((segment) =>
        segment.selected && segment.status === 'selected',
      );
    }
    if (reviewVisibilityFilter === 'duplicates') {
      return reviewSegments.filter(isSliceReviewDuplicateRiskSegment);
    }
    if (reviewVisibilityFilter === 'excluded') {
      return reviewSegments.filter((segment) => segment.status === 'excluded');
    }
    return reviewSegments;
  }, [reviewSegments, reviewVisibilityFilter]);
  const activeReviewSegment = useMemo(
    () => reviewSegments.find((segment) => segment.id === activeReviewSegmentId) ?? visibleReviewSegments[0] ?? reviewSegments[0],
    [activeReviewSegmentId, reviewSegments, visibleReviewSegments],
  );
  const displayActiveReviewSegmentId = activeReviewSegment?.id ||
    activeReviewSegmentId ||
    displayReviewSegments[0]?.id ||
    '';
  useEffect(() => {
    setShowReviewCorrectionEditor(false);
    setExpandedReviewSegmentActionId('');
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
  }, [activeReviewSegment]);
  useEffect(() => {
    if (blobUrlRef.current) {
      revokeAutoCutObjectUrl(blobUrlRef.current);
      blobUrlRef.current = '';
    }
    if (file) {
      const trustedSourcePath = resolveAutoCutTrustedSourcePath(file);
      if (trustedSourcePath) {
        try {
          setVideoSrc(getAutoCutNativeHostClient().createAssetUrl(trustedSourcePath));
        } catch (error) {
          reportAutoCutDiagnostic('warning', 'slicer', 'Trusted desktop video preview failed', error);
          setVideoSrc('');
        }
        return () => {};
      }

      const url = createAutoCutObjectUrl(file);
      blobUrlRef.current = url;
      setVideoSrc(url);
      return () => {
        revokeAutoCutObjectUrl(url);
        blobUrlRef.current = '';
      };
    }
    setVideoSrc('');
  }, [file]);

  useEffect(() => {
    let cancelled = false;
    const fetchTasks = () => {
      getTasks().then(tasks => {
        if (!cancelled) {
          setSlicerTasks(tasks.filter(t => t.type === AUTOCUT_TASK_TYPE.videoSlice));
        }
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
      cancelled = true;
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
    setActiveReviewSegmentId(
      nextReviewSession.selectedSegmentIds[0] ??
        nextReviewSession.segments[0]?.id ??
        '',
    );
    setReviewManualEdits([]);
  }, [activeReviewTask?.id, activeReviewTask?.sliceReviewSession, activeReviewTaskId, reviewManualEdits.length, reviewSessionDraft?.id]);

  useEffect(() => {
    let cancelled = false;
    resolveAutoCutLlmRuntimeConfig()
      .then((config) => {
        if (cancelled) return;
        setActiveLlmRuntimeConfig(config);
        setActiveLlmRuntimeModelVendor(config.modelVendor);
        setLlmModel(resolveSmartSliceLlmModelForVendor(config.modelVendor, config.model));
        setSegmentationAgentId(config.defaultSegmentationAgentId);
      })
      .catch((error) => {
        if (cancelled) return;
        reportAutoCutDiagnostic('warning', 'slicer', 'Load default LLM model failed', error);
      });
    return () => { cancelled = true; };
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
      setLlmModel(resolveSmartSliceLlmModelForVendor(
        activeLlmRuntimeModelVendor,
        AUTOCUT_MODEL_VENDOR_PRESETS[activeLlmRuntimeModelVendor].defaultModel,
      ));
    }
  }, [activeLlmRuntimeModelVendor, llmModel, visibleLlmModelOptions]);

  useEffect(() => {
    let cancelled = false;
    getAutoCutWorkflowPreferences()
      .then((preferences) => {
        if (cancelled) return;
        const videoSlice = preferences.videoSlice;
        if (MODES.includes(videoSlice.mode as SliceMode)) {
          setSelectedMode(videoSlice.mode as SliceMode);
        }
        setAspectRatio(videoSlice.targetAspectRatio);
        setVideoObjectFit(videoSlice.videoObjectFit);
        setEnableSubtitles(videoSlice.enableSubtitles);
        setSubtitleMode(videoSlice.subtitleMode);
        setSelectedSubtitleStyle(videoSlice.subtitleStyleId);
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
      .catch((error) => {
        if (cancelled) return;
        reportAutoCutDiagnostic('warning', 'slicer', 'Load video slice parameter preferences failed', error);
      });
    return () => { cancelled = true; };
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

  const timelineSyncPreviewPlaybackRef = useRef<(currentSeconds: number, durationSeconds: number) => void>(() => {});

  const formatTime = formatSlicerTimelineTime;
  const handleSmartSliceVideoTimeUpdate = useCallback((currentSeconds: number, durationSeconds: number) => {
    const safeCurrent = Number.isFinite(currentSeconds) ? currentSeconds : 0;
    const safeDuration = Number.isFinite(durationSeconds) ? durationSeconds : 0;
    setCurrentTime(safeCurrent);
    setDuration(safeDuration);
    setVideoProgress(safeDuration > 0 ? Math.min(100, (safeCurrent / safeDuration) * 100) : 0);
    timelineSyncPreviewPlaybackRef.current(safeCurrent, safeDuration);
  }, []);
  const handleSmartSliceVideoLoaded = useCallback((w: number, h: number) => {
    const safeH = h > 0 ? h : 1;
    const ratio = w / safeH;
    if (ratio > 1.5) setDetectedRatio("16:9");
    else if (ratio < 0.7) setDetectedRatio("9:16");
    else if (Math.abs(ratio - 1) < 0.1) setDetectedRatio("1:1");
    else if (Math.abs(ratio - 1.33) < 0.1) setDetectedRatio("4:3");
    else setDetectedRatio(`${w}:${h}`);
  }, []);
  const smartSliceReviewPreviewMetaItems = activeReviewSegment
    ? [
        {
          id: 'time',
          label: `${formatTime(activeReviewSegment.startMs / 1_000)} - ${formatTime(activeReviewSegment.endMs / 1_000)}`,
        },
        {
          id: 'speaker',
          label: activeReviewSegment.speakerRoles.join(', ') ||
            activeReviewSegment.speakerIds.join(', ') ||
            t('slicer.settings.review.preview.speakerPending'),
        },
      ]
    : [];

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
     const rect = e.currentTarget.getBoundingClientRect();
     const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / (rect.width || 1)));
     if (playerRef.current) {
        playerRef.current.seek(percent);
     }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') {
            return;
        }

        const currentDuration = durationRef.current;
        const currentCurrentTime = currentTimeRef.current;

        if (e.code === 'Space' || e.code === 'KeyK') {
            e.preventDefault();
            playerRef.current?.togglePlay();
        } else if (e.code === 'KeyJ') {
            if (playerRef.current && currentDuration > 0) {
               const newTime = Math.max(0, currentCurrentTime - 5);
               playerRef.current.seek(newTime / currentDuration);
            }
        } else if (e.code === 'KeyL') {
            if (playerRef.current && currentDuration > 0) {
               const newTime = Math.min(currentDuration, currentCurrentTime + 5);
               playerRef.current.seek(newTime / currentDuration);
            }
        } else if (e.code === 'ArrowLeft') {
            if (playerRef.current && currentDuration > 0) {
              const newTime = Math.max(0, currentCurrentTime - 0.1);
              playerRef.current.seek(newTime / currentDuration);
            }
        } else if (e.code === 'ArrowRight') {
            if (playerRef.current && currentDuration > 0) {
              const newTime = Math.min(currentDuration, currentCurrentTime + 0.1);
              playerRef.current.seek(newTime / currentDuration);
            }
        }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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
    if (isInitializingSpeechSetupRef.current) {
      return false;
    }

    setSpeechSetupDialogOpen(true);
    setSpeechSetupErrorMessage('');
    isInitializingSpeechSetupRef.current = true;
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
      isInitializingSpeechSetupRef.current = false;
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
      targetPlatform: SMART_SLICE_DEFAULT_TARGET_PLATFORM,
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
    if (sourceUrl && !file) {
      sliceParams.url = sourceUrl;
    }
    return sliceParams;
  };

  const saveCurrentVideoSlicePreferences = async () => {
    const effectiveSubtitleMode = enableSubtitles && subtitleMode === 'none' ? 'both' : subtitleMode;
    await saveAutoCutVideoSlicePreferences({
      mode: selectedMode,
      targetPlatform: SMART_SLICE_DEFAULT_TARGET_PLATFORM,
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

  const commitReviewSessionDraft = useCallback((
    baseSession: AutoCutSliceReviewSession,
    segments: readonly AutoCutSliceReviewSegment[],
    manualEdit?: AutoCutSliceManualEdit,
    options: SmartSliceTimelineReviewCommitOptions = {},
  ) => {
    const nextSession = createSliceReviewSessionFromSegments(
      baseSession,
      segments,
      manualEdit ? [manualEdit] : [],
    );
    const nextManualEdits = manualEdit ? [...reviewManualEdits, manualEdit] : reviewManualEdits;
    const nextStudioClipTimeline = createStudioClipTimelineSnapshotForReviewSession(
      nextSession,
      options.processingOperations ?? activeStudioClipTimelineSnapshot?.processingOperations ?? [],
    );
    setReviewSessionDraft(nextSession);
    if (manualEdit) {
      setReviewManualEdits(nextManualEdits);
    }
    const taskId = activeReviewTask?.id ?? activeReviewTaskId;
    if (taskId) {
      setSlicerTasks((currentTasks) =>
        updateSlicerTask(currentTasks, taskId, (task) => ({
          ...task,
          sliceReviewSession: nextSession,
          studioClipTimeline: nextStudioClipTimeline,
        }))
      );
    }
    setReviewDraftSaveError('');
    setIsSavingReviewDraft(true);
    if (!taskId) {
      setIsSavingReviewDraft(false);
      return;
    }
    void saveVideoSliceReviewDraft(taskId, {
      reviewSessionId: nextSession.id,
      selectedSegmentIds: nextSession.selectedSegmentIds,
      manualEdits: nextManualEdits,
    }, nextStudioClipTimeline.processingOperations)
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
  }, [activeReviewTask, activeReviewTaskId, activeStudioClipTimelineSnapshot, reviewManualEdits, t]);

  const seekSmartSlicePreviewMs = useCallback((timeMs: number) => {
    const currentDuration = durationRef.current;
    if (currentDuration > 0 && Number.isFinite(timeMs)) {
      playerRef.current?.seek(Math.max(0, timeMs / 1_000) / currentDuration);
    }
  }, []);

  const timelineController = useSmartSliceTimelineReviewController({
    reviewSession: effectiveReviewSession,
    timelineSnapshot: displayStudioClipTimelineSnapshot,
    timelineDurationMs: studioClipTimelineDurationMs,
    onActiveReviewSegmentIdChange: setActiveReviewSegmentId,
    onSeekPreviewMs: seekSmartSlicePreviewMs,
    onCommitReviewSessionDraft: commitReviewSessionDraft,
  });
  timelineSyncPreviewPlaybackRef.current = timelineController.syncPreviewPlayback;

  const handleSelectAllReviewSegments = () => {
    const baseSession = effectiveReviewSession;
    if (!baseSession) {
      return;
    }
    const selectResult = selectAllSliceReviewSegmentsForRender({
      reviewSession: baseSession,
    });
    if (!selectResult) {
      return;
    }
    commitReviewSessionDraft(baseSession, selectResult.segments, selectResult.manualEdit);
  };

  const handleClearReviewSegmentSelection = () => {
    const baseSession = effectiveReviewSession;
    if (!baseSession) {
      return;
    }
    const clearResult = setSliceReviewSegmentsRenderSelectionForRender({
      reviewSession: baseSession,
      selected: false,
    });
    if (!clearResult) {
      return;
    }
    commitReviewSessionDraft(baseSession, clearResult.segments, clearResult.manualEdit);
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
    const toggleResult = setSliceReviewSegmentRenderSelectionOnStudioTimeline({
      reviewSession: baseSession,
      segmentId,
      selected: shouldSelect,
    });
    if (!toggleResult) {
      return;
    }
    commitReviewSessionDraft(baseSession, toggleResult.segments, toggleResult.manualEdit);
  };

  const handleMergeReviewSegment = (segmentId: string, direction: 'previous' | 'next') => {
    const baseSession = effectiveReviewSession;
    if (!baseSession) {
      return;
    }
    const mergeResult = mergeSliceReviewSegmentsOnStudioTimeline({
      reviewSession: baseSession,
      segmentId,
      direction,
    });
    if (!mergeResult) {
      return;
    }
    commitReviewSessionDraft(baseSession, mergeResult.segments, mergeResult.manualEdit);
  };

  const handleDeleteDuplicateReviewSegment = (segmentId: string) => {
    const baseSession = effectiveReviewSession;
    if (!baseSession) {
      return;
    }
    const duplicateResult = markSliceReviewSegmentAsDuplicateOnStudioTimeline({
      reviewSession: baseSession,
      segmentId,
    });
    if (!duplicateResult) {
      return;
    }
    commitReviewSessionDraft(baseSession, duplicateResult.segments, duplicateResult.manualEdit);
  };

  const handleRestoreReviewSegment = (segmentId: string) => {
    const baseSession = effectiveReviewSession;
    if (!baseSession) {
      return;
    }
    const restoreResult = restoreSliceReviewSegmentOnStudioTimeline({
      reviewSession: baseSession,
      segmentId,
    });
    if (!restoreResult) {
      return;
    }
    commitReviewSessionDraft(baseSession, restoreResult.segments, restoreResult.manualEdit);
  };

  const handleToggleReviewSegmentActions = (segmentId: string) => {
    setExpandedReviewSegmentActionId((expandedId) => (expandedId === segmentId ? '' : segmentId));
  };

  const updateSmartSliceReviewCorrectionDraftField = (
    field: keyof SmartSliceReviewCorrectionDraft,
    value: string,
  ) => {
    setReviewCorrectionDraft((draft) => ({ ...draft, [field]: value }));
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
    const correctionResult = correctSliceReviewSegmentOnStudioTimeline({
      reviewSession: baseSession,
      segmentId: segment.id,
      patch: {
        title: reviewCorrectionDraft.title.trim() || segment.title,
        startMs: correctedStartMs,
        endMs: Math.max(correctedStartMs + 1, correctedEndMs),
        speakerIds: speakerRoles.length ? speakerRoles : segment.speakerIds,
        speakerRoles,
        ...(correctedTranscriptText ? { transcriptText: correctedTranscriptText } : {}),
        ...(correctedManualNotes ? { manualNotes: correctedManualNotes } : {}),
      },
    });
    if (!correctionResult) {
      return;
    }
    commitReviewSessionDraft(baseSession, correctionResult.segments, correctionResult.manualEdit);
    setShowReviewCorrectionEditor(false);
  };

  const handleRenderSelectedReviewSegments = async () => {
    const baseSession = effectiveReviewSession;
    const taskId = activeReviewTask?.id ?? activeReviewTaskId;
    if (!baseSession || !taskId) {
      toast(t('slicer.settings.review.toast.noPlan'), 'error');
      return;
    }
    if (renderableReviewSegmentCount === 0) {
      toast(t('slicer.settings.review.toast.noSelection'), 'error');
      return;
    }
    if (isRenderingReviewSelection) {
      return;
    }
    setIsRenderingReviewSelection(true);
    try {
      await renderVideoSlicePlan(taskId, {
        reviewSessionId: baseSession.id,
        selectedSegmentIds: renderableReviewSegmentIds,
        manualEdits: reviewManualEdits,
      });
      setActiveLeftTab('tasks');
      toast(t('slicer.settings.review.toast.renderSubmitted'), 'success');
    } catch (error) {
      reportAutoCutDiagnostic('error', 'slicer.review-render', 'Render selected Smart Slice segments failed', error);
      toast(createSmartSliceFailureToastMessage(error, t), 'error');
    } finally {
      setIsRenderingReviewSelection(false);
    }
  };

  const handleStart = async () => {
    if (!hasVideoSource) {
      toast(t('slicer.settings.review.toast.selectSource'), 'error');
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
    const generation = ++processingGenerationRef.current;
    try {
      const speechReady = await ensureSmartSliceLocalSpeechTranscriptionReady();
      if (!speechReady || processingGenerationRef.current !== generation) {
        return;
      }
      await waitForSmartSliceUiYield();
      if (processingGenerationRef.current !== generation) return;
      toast(t('slicer.speechSetup.toast.submitCreated'), 'info');
      const sliceParams = createCurrentVideoSliceParams();
      reportAutoCutDiagnostic('warning', 'slicer.submit', 'Smart Slice submit params', createSmartSliceSubmissionDiagnostics(sliceParams));
      await saveCurrentVideoSlicePreferences();
      if (processingGenerationRef.current !== generation) return;
      if (runMode === 'review-before-render') {
        resetSmartSliceReviewWorkbenchForNewPlan();
        const result = await analyzeVideoSlicePlan(sliceParams);
        if (processingGenerationRef.current !== generation) return;
        setActiveReviewTaskId(result.taskId);
        toast(t('slicer.settings.review.toast.analyzeComplete'), 'success');
      } else {
        resetSmartSliceReviewWorkbenchForNewPlan();
        await processVideoSlice(sliceParams);
        if (processingGenerationRef.current !== generation) return;
        toast(t('slicer.speechSetup.toast.submitted'), 'success');
      }
      setActiveLeftTab("tasks");
    } catch (e) {
      if (processingGenerationRef.current !== generation) return;
      const failedTaskId = getAutoCutProcessingTaskErrorTaskId(e);
      if (failedTaskId) {
        setActiveLeftTab("tasks");
      }
      reportAutoCutDiagnostic('error', 'slicer', 'Video slicing failed', e);
      toast(createSmartSliceFailureToastMessage(e, t), 'error');
    } finally {
      if (processingGenerationRef.current === generation) {
        setIsProcessing(false);
      }
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
    setReviewVisibilityFilter('all');
    setActiveReviewSegmentId('');
    setExpandedReviewSegmentActionId('');
    setReviewManualEdits([]);
    setIsRenderingReviewSelection(false);
    setLatestVideoDedupReport(null);
    timelineController.reset();
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
      processingGenerationRef.current += 1;
      setIsProcessing(false);
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
    processingGenerationRef.current += 1;
    setIsProcessing(false);
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
                          onVideoLoaded={handleSmartSliceVideoLoaded}
                          onTimeUpdate={handleSmartSliceVideoTimeUpdate}
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
                        onVideoLoaded={handleSmartSliceVideoLoaded}
                        onTimeUpdate={handleSmartSliceVideoTimeUpdate}
                        onPlayStateChange={setIsPlaying}
                     />
                   </Suspense>
                 ) : (
                   <NativeSmartSliceVideoPreview
                      ref={playerRef}
                      videoSrc={videoSrc}
                      aspectRatio={aspectRatio}
                      videoObjectFit={videoObjectFit}
                      onVideoLoaded={handleSmartSliceVideoLoaded}
                      onTimeUpdate={handleSmartSliceVideoTimeUpdate}
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
                          onChange={(event) => handleSmartSliceAspectRatioChange(event.target.value)}
                          className="bg-[#222] border border-[#333] text-gray-300 text-[11px] rounded px-2 py-1 outline-none focus:border-blue-500 transition-colors"
                       >
                        {smartSliceAspectRatioOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>

                      <select
                          value={videoObjectFit}
                          onChange={(event) => handleSmartSliceObjectFitChange(event.target.value)}
                          className="bg-[#222] border border-[#333] text-gray-300 text-[11px] rounded px-2 py-1 outline-none focus:border-blue-500 transition-colors"
                       >
                        {smartSliceObjectFitOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>

                     <Settings2 size={16} className="cursor-pointer hover:text-white transition-colors ml-2" />
                  </div>
                </div>
                {displayStudioClipTimelineSnapshot ? (
                  <div className="border-t border-[#262626] pt-3">
                    <SmartSliceTimelineWorkbench
                      snapshot={displayStudioClipTimelineSnapshot}
                      reviewSegments={displayReviewSegments}
                      activeReviewSegmentId={displayActiveReviewSegmentId}
                      currentTimeMs={Math.round(currentTime * 1_000)}
                      durationMs={studioClipTimelineDurationMs}
                      previewRange={timelineController.previewRange}
                      boundaryPreview={timelineController.boundaryPreview}
                      isEditable={Boolean(effectiveReviewSession)}
                      isPlaying={isPlaying}
                      onTogglePlay={() => playerRef.current?.togglePlay()}
                      onSeekMs={timelineController.seekTimelineMs}
                      onPreviewClip={timelineController.previewClip}
                      onPreviewClipBoundaryDrag={timelineController.previewClipBoundaryDrag}
                      onCommitClipBoundary={timelineController.commitClipBoundary}
                      onCancelClipBoundaryDrag={timelineController.cancelBoundaryPreview}
                      onSplitClipAtTime={timelineController.splitClipAtTime}
                    />
                  </div>
                ) : null}
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
        <aside className="w-[430px] xl:w-[460px] bg-[#0A0A0A] border-l border-[#222] flex flex-col shrink-0 z-10 shadow-[-4px_0_15px_-3px_rgba(0,0,0,0.5)]">
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
              <div className="h-14 border-b border-[#222] flex items-center px-5 shrink-0">
                <h2 className="text-[13px] font-bold text-gray-200 flex items-center gap-2 tracking-wide">
                  <Settings2 size={16} className="text-blue-500" />
                  {t('slicer.settings.title')}
                </h2>
              </div>

              <div className="p-5 flex-1 overflow-y-auto w-full custom-scrollbar styled-scrollbar">
                <div className="space-y-5">
              <section className="rounded-lg border border-[#262626] bg-[#101010] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-blue-300">{t('slicer.settings.status.title')}</div>
                  </div>
                  <span className={`rounded border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${
                    smartSliceReadyForRun
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                      : 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                  }`}>
                    {smartSliceReadyForRun ? t('slicer.settings.status.ready') : t('slicer.settings.status.needsSetup')}
                  </span>
                </div>
                <div className="mt-3 divide-y divide-[#222] overflow-hidden rounded-md border border-[#222]">
                  {smartSliceSettingsReadinessItems.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-3 bg-[#141414] px-3 py-2">
                      <span className="text-[11px] font-medium text-gray-400">{item.label}</span>
                      <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${item.ready ? 'text-emerald-300' : 'text-amber-300'}`}>
                        {item.ready ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                        {item.value}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
              <section className="rounded-lg border border-[#262626] bg-[#101010] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-blue-300">{t('slicer.settings.runMode.title')}</div>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {smartSliceRunModeOptions.map((option) => (
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
                    <div className="text-[11px] font-bold uppercase tracking-wider text-blue-300">{t('slicer.settings.basic.title')}</div>
                  </div>
                </div>

                <div className="mt-4 space-y-4">
                  <div>
                    <label className="mb-2.5 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-gray-500">
                      <span>{t('slicer.settings.basic.duration')}</span>
                      <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-400">{minDuration}s - {maxDuration}s</span>
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {smartSliceDurationControls.map((item) => (
                        <div key={item.id} className="relative">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-medium text-gray-500">{item.label}</span>
                          <input
                            type="number"
                            value={item.value}
                            onChange={(event) =>
                              item.update((currentValue) =>
                                normalizeSlicerNumberInput(event.target.value, currentValue, item.min, item.max),
                              )
                            }
                            className="w-full rounded-lg border border-[#222] bg-[#141414] py-1.5 pl-12 pr-2 text-xs text-white outline-none transition-all focus:border-blue-500 focus:bg-[#1A1A1A]"
                            min={item.min}
                            max={item.max}
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-gray-500">{t('slicer.settings.basic.format')}</label>
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={aspectRatio}
                        onChange={(event) => handleSmartSliceAspectRatioChange(event.target.value)}
                        className="rounded-lg border border-[#222] bg-[#141414] px-3 py-2 text-xs text-gray-200 outline-none transition-all focus:border-blue-500"
                      >
                        {smartSliceAspectRatioOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                      <select
                        value={videoObjectFit}
                        onChange={(event) => handleSmartSliceObjectFitChange(event.target.value)}
                        className="rounded-lg border border-[#222] bg-[#141414] px-3 py-2 text-xs text-gray-200 outline-none transition-all focus:border-blue-500"
                      >
                        {smartSliceObjectFitOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400">{t('slicer.settings.basic.subtitles')}</div>
                      </div>
                      <button
                        type="button"
                        onClick={handleSubtitleToggle}
                        className={`inline-flex min-w-[68px] shrink-0 items-center gap-1.5 rounded border px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                          enableSubtitles
                            ? 'border-blue-500/40 bg-blue-500/15 text-blue-200'
                            : 'border-[#333] bg-[#141414] text-gray-400 hover:border-[#444] hover:text-gray-200'
                        }`}
                        aria-pressed={enableSubtitles}
                      >
                        <Type size={12} />
                        {enableSubtitles ? t('slicer.settings.common.on') : t('slicer.settings.common.off')}
                      </button>
                    </div>
                    {enableSubtitles ? (
                      <div className="mt-3 rounded-lg border border-[#222] bg-[#141414] p-3">
                        <div className="mb-3 grid grid-cols-3 gap-1">
                          {smartSliceSubtitleModeOptions.map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => setSubtitleMode(option.value)}
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
                        <select
                          value={selectedSubtitleStyle}
                          onChange={(event) => setSelectedSubtitleStyle(event.target.value)}
                          className="w-full rounded border border-[#333] bg-[#0A0A0A] px-2.5 py-1.5 text-xs text-gray-200 outline-none transition-all focus:border-blue-500"
                        >
                          {TEXT_EFFECTS.map((effect) => (
                            <option key={effect.id} value={effect.id}>{effect.name} - {effect.text}</option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                  </div>

                  <div>
                    <label className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-gray-500">{t('slicer.settings.basic.audio')}</label>
                    <div className="space-y-1">
                      {smartSliceAudioCleanupControls.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={item.toggle}
                          className="flex w-full items-center justify-between rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-[#111]"
                          aria-pressed={item.enabled}
                        >
                          <span className="flex items-center gap-2.5 text-xs font-medium text-gray-300">
                            <span className="flex h-6 w-6 items-center justify-center rounded border border-[#222] bg-[#1A1A1A] text-gray-400">{item.icon}</span>
                            {item.label}
                          </span>
                          <span className={`relative h-4 w-7 rounded-full p-0.5 transition-colors ${item.enabled ? 'bg-blue-600' : 'bg-[#333]'}`}>
                            <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${item.enabled ? 'translate-x-3' : 'translate-x-0'}`} />
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </section>

              {effectiveReviewSession ? (
                <section className="rounded-lg border border-[#262626] bg-[#101010] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-wider text-blue-300">{t('slicer.settings.review.title')}</div>
                    </div>
                    <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-200">
                      {smartSliceReviewStatusBadge}
                    </span>
                  </div>
                  {reviewDraftSaveError ? (
                    <div className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[10px] leading-4 text-amber-100">
                      {reviewDraftSaveError}
                    </div>
                  ) : null}

                  <div className="mt-3 space-y-3">
                    <div className="grid grid-cols-4 gap-2">
                      {smartSliceReviewMetricItems.map((metric) => (
                        <div key={metric.id} className="rounded border border-[#252525] bg-[#141414] px-2 py-2">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{metric.label}</div>
                          <div className={`mt-1 text-[12px] font-semibold ${metric.valueClassName}`}>{metric.value}</div>
                          {metric.detail ? (
                            <div className="mt-0.5 text-[9px] text-gray-500">{metric.detail}</div>
                          ) : null}
                        </div>
                      ))}
                    </div>

                    {effectiveReviewSession.smartDedupReport ? (
                      <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-amber-200">{t('slicer.settings.review.dedup.title')}</div>
                            <div className="mt-1 truncate text-[10px] text-amber-100/80">
                              {t('slicer.settings.review.dedup.detail', {
                                matches: effectiveReviewSession.smartDedupReport.matchCount,
                                risks: smartDedupRiskSegmentCount,
                                strategies: effectiveReviewSession.smartDedupReport.strategies.join(', '),
                              })}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setReviewVisibilityFilter('duplicates')}
                            className="shrink-0 rounded border border-amber-400/40 bg-[#101010] px-2 py-1 text-[10px] font-semibold text-amber-100 hover:border-amber-300"
                          >
                            {t('slicer.settings.review.action.reviewDuplicates')}
                          </button>
                        </div>
                      </div>
                    ) : null}

                    <div className="rounded-lg border border-[#252525] bg-[#141414] p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{t('slicer.settings.review.preview.title')}</div>
                          <div className="mt-1 truncate text-[12px] font-semibold text-gray-100">
                            {activeReviewSegment ? activeReviewSegment.title : t('slicer.settings.review.preview.emptyTitle')}
                          </div>
                        </div>
                        {activeReviewSegment ? (
                          <button
                            type="button"
                            onClick={() => timelineController.previewReviewSegment(activeReviewSegment)}
                            className="shrink-0 rounded border border-blue-500/40 bg-blue-500/10 px-2 py-1 text-[10px] font-semibold text-blue-200 hover:border-blue-400"
                          >
                            {t('slicer.settings.review.action.preview')}
                          </button>
                        ) : null}
                      </div>
                      {activeReviewSegment ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {smartSliceReviewPreviewMetaItems.map((item) => (
                            <span key={item.id} className="rounded border border-[#303030] bg-[#101010] px-1.5 py-0.5 text-[9px] font-semibold text-gray-400">
                              {item.label}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-2 text-[10px] leading-4 text-gray-500">
                          {t('slicer.settings.review.preview.emptyDetail')}
                        </div>
                      )}
                      <div className="mt-2 line-clamp-3 text-[10px] leading-4 text-gray-400">
                        {activeReviewSegment?.transcriptText || activeReviewSegment?.summary || t('slicer.settings.review.preview.transcriptPending')}
                      </div>
                    </div>

                    {activeReviewSegment ? (
                      <div className="rounded-lg border border-[#252525] bg-[#141414] p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{t('slicer.settings.review.correction.title')}</div>
                            <div className="mt-1 text-[10px] leading-4 text-gray-500">
                              {t('slicer.settings.review.correction.description')}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setShowReviewCorrectionEditor((shown) => !shown)}
                            aria-expanded={showReviewCorrectionEditor}
                            className="shrink-0 rounded border border-cyan-500/40 bg-cyan-500/10 px-2 py-1 text-[10px] font-semibold text-cyan-200 hover:border-cyan-400"
                          >
                            {showReviewCorrectionEditor
                              ? t('slicer.settings.review.action.hideCorrection')
                              : t('slicer.settings.review.action.editCorrection')}
                          </button>
                        </div>
                        {showReviewCorrectionEditor ? (
                          <div className="mt-3 space-y-2">
                            <div className="grid grid-cols-2 gap-2">
                              {smartSliceReviewCorrectionFields.map((field) =>
                                field.control === 'textarea' ? (
                                  <textarea
                                    key={field.id}
                                    value={field.value}
                                    onChange={(event) => updateSmartSliceReviewCorrectionDraftField(field.id, event.target.value)}
                                    className={`rounded border border-[#303030] bg-[#101010] px-2 py-1.5 text-[10px] outline-none focus:border-cyan-500 ${field.className}`}
                                    placeholder={field.placeholder}
                                  />
                                ) : (
                                  <input
                                    key={field.id}
                                    type={field.inputType}
                                    value={field.value}
                                    onChange={(event) => updateSmartSliceReviewCorrectionDraftField(field.id, event.target.value)}
                                    className={`rounded border border-[#303030] bg-[#101010] px-2 py-1.5 text-[10px] outline-none focus:border-cyan-500 ${field.className}`}
                                    placeholder={field.placeholder}
                                  />
                                ),
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={handleApplyReviewSegmentCorrection}
                              className="w-full rounded border border-cyan-500/40 bg-cyan-500/10 px-2 py-1.5 text-[10px] font-semibold text-cyan-200 hover:border-cyan-400"
                            >
                              {t('slicer.settings.review.action.saveCorrection')}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="rounded-lg border border-[#252525] bg-[#141414] p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{t('slicer.settings.review.queue.title')}</div>
                          <div className="mt-1 text-[10px] leading-4 text-gray-500">
                            {t('slicer.settings.review.queue.description')}
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <button
                            type="button"
                            onClick={handleSelectAllReviewSegments}
                            disabled={!canSelectAllReviewSegments}
                            className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-200 hover:border-emerald-400 disabled:cursor-not-allowed disabled:border-[#333] disabled:bg-[#101010] disabled:text-gray-600"
                          >
                            {t('slicer.settings.review.action.selectAll')}
                          </button>
                          <button
                            type="button"
                            onClick={handleClearReviewSegmentSelection}
                            disabled={!canClearReviewSegmentSelection}
                            className="rounded border border-[#333] bg-[#101010] px-2 py-1 text-[10px] font-semibold text-gray-300 hover:border-[#444] disabled:cursor-not-allowed disabled:text-gray-600 disabled:hover:border-[#333]"
                          >
                            {t('slicer.settings.review.action.clearSelection')}
                          </button>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-4 gap-1">
                        {smartSliceReviewFilterOptions.map((filter) => (
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
                          {t('slicer.settings.review.queue.empty')}
                        </div>
                      ) : visibleReviewSegments.map((segment) => {
                        const index = Math.max(0, reviewSegments.findIndex((candidate) => candidate.id === segment.id));
                        const selected = segment.selected && segment.status === 'selected';
                        const previewing = activeReviewSegment?.id === segment.id;
                        const reviewSegmentActionsExpanded = expandedReviewSegmentActionId === segment.id;
                        const previousReviewSegment = reviewSegments[index - 1];
                        const nextReviewSegment = reviewSegments[index + 1];
                        const canMergeWithPreviousReviewSegment =
                          segment.status !== 'duplicate' && previousReviewSegment !== undefined && previousReviewSegment.status !== 'duplicate';
                        const canMergeWithNextReviewSegment =
                          segment.status !== 'duplicate' && nextReviewSegment !== undefined && nextReviewSegment.status !== 'duplicate';
                        const reviewSegmentBadgeItems = [
                          ...segment.speakerRoles.slice(0, 3).map((speakerRole, speakerRoleIndex) => ({
                            id: `speaker-${speakerRoleIndex}-${speakerRole}`,
                            label: speakerRole,
                            className: 'border-[#333] bg-[#101010] text-gray-400',
                          })),
                          ...segment.risks.slice(0, 3).map((risk, riskIndex) => ({
                            id: `risk-${riskIndex}-${risk}`,
                            label: risk,
                            className: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
                          })),
                          ...(segment.status === 'duplicate'
                            ? [{
                                id: 'duplicate-excluded',
                                label: t('slicer.settings.review.segment.duplicateExcluded'),
                                className: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
                              }]
                            : []),
                          ...(previewing
                            ? [{
                                id: 'previewing',
                                label: t('slicer.settings.review.segment.previewing'),
                                className: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200',
                              }]
                            : []),
                        ];
                        const reviewSegmentActionItems = [
                          {
                            id: 'split',
                            label: t('slicer.settings.review.action.split'),
                            onClick: () => timelineController.splitClipAtTime(segment.id),
                            className: 'border-[#333] bg-[#101010] text-gray-300 hover:border-blue-500/50 hover:text-blue-200',
                          },
                          ...(canMergeWithPreviousReviewSegment
                            ? [{
                                id: 'merge-previous',
                                label: t('slicer.settings.review.action.mergePrevious'),
                                onClick: () => handleMergeReviewSegment(segment.id, 'previous'),
                                className: 'border-[#333] bg-[#101010] text-gray-300 hover:border-blue-500/50 hover:text-blue-200',
                              }]
                            : []),
                          ...(canMergeWithNextReviewSegment
                            ? [{
                                id: 'merge-next',
                                label: t('slicer.settings.review.action.mergeNext'),
                                onClick: () => handleMergeReviewSegment(segment.id, 'next'),
                                className: 'border-[#333] bg-[#101010] text-gray-300 hover:border-blue-500/50 hover:text-blue-200',
                              }]
                            : []),
                          segment.status === 'duplicate' || !segment.selected
                            ? {
                                id: 'restore',
                                label: t('slicer.settings.review.action.restore'),
                                onClick: () => handleRestoreReviewSegment(segment.id),
                                className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:border-emerald-400',
                              }
                            : {
                                id: 'delete-duplicate',
                                label: t('slicer.settings.review.action.deleteDuplicate'),
                                onClick: () => handleDeleteDuplicateReviewSegment(segment.id),
                                className: 'border-amber-500/30 bg-amber-500/10 text-amber-200 hover:border-amber-400',
                              },
                        ];
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
                                disabled={segment.status === 'duplicate'}
                                className="mt-1 h-4 w-4 accent-blue-500"
                                aria-label={`Select review segment ${index + 1}`}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                  <button
                                    type="button"
                                    onClick={() => timelineController.previewReviewSegment(segment)}
                                    className="truncate text-left text-[11px] font-bold text-gray-100 hover:text-blue-300"
                                  >
                                    {String(index + 1).padStart(2, '0')}. {segment.title}
                                  </button>
                                  <span className="shrink-0 rounded border border-[#333] bg-[#101010] px-1.5 py-0.5 text-[9px] font-semibold text-gray-400">
                                    {formatTime(segment.startMs / 1_000)} - {formatTime(segment.endMs / 1_000)}
                                  </span>
                                </div>
                                <div className="mt-1 line-clamp-2 text-[10px] leading-4 text-gray-500">
                                  {segment.transcriptText || segment.summary || t('slicer.settings.review.segment.transcriptFallback')}
                                </div>
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {reviewSegmentBadgeItems.map((badge) => (
                                    <span key={badge.id} className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold ${badge.className}`}>
                                      {badge.label}
                                    </span>
                                  ))}
                                </div>
                                <div className="mt-2 flex items-center justify-end">
                                  <button
                                    type="button"
                                    onClick={() => handleToggleReviewSegmentActions(segment.id)}
                                    aria-expanded={reviewSegmentActionsExpanded}
                                    className="rounded border border-[#333] bg-[#101010] px-2 py-1 text-[9px] font-semibold text-gray-300 hover:border-[#444] hover:text-gray-100"
                                  >
                                    {reviewSegmentActionsExpanded
                                      ? t('slicer.settings.review.action.hideSegmentActions')
                                      : t('slicer.settings.review.action.showSegmentActions')}
                                  </button>
                                </div>
                                {reviewSegmentActionsExpanded ? (
                                  <div className="mt-2 grid grid-cols-2 gap-1">
                                    {reviewSegmentActionItems.map((action) => (
                                      <button
                                        key={action.id}
                                        type="button"
                                        onClick={action.onClick}
                                        className={`rounded border px-1.5 py-1 text-[9px] font-semibold ${action.className}`}
                                      >
                                        {action.label}
                                      </button>
                                    ))}
                                  </div>
                                ) : null}
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
                      disabled={isRenderingReviewSelection || renderableReviewSegmentCount === 0}
                    >
                      <Scissors size={16} />
                      {isRenderingReviewSelection
                        ? t('slicer.settings.review.action.rendering')
                        : t('slicer.settings.review.action.renderSelected', { count: renderableReviewSegmentCount })}
                    </Button>
                  </div>
                </section>
              ) : (
                <div className="rounded-lg border border-dashed border-[#303030] bg-[#101010] p-4 text-[11px] leading-5 text-gray-500">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-blue-300">{t('slicer.settings.review.emptyTitle')}</div>
                </div>
              )}

              <section className="rounded-lg border border-[#262626] bg-[#101010]">
                <button
                  type="button"
                  onClick={() => setShowAdvancedSettings((shown) => !shown)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                  aria-expanded={showAdvancedSettings}
                >
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-blue-300">{t('slicer.settings.advanced.title')}</div>
                  </div>
                  <ChevronRight size={16} className={`text-gray-500 transition-transform ${showAdvancedSettings ? 'rotate-90' : ''}`} />
                </button>

                {showAdvancedSettings ? (
                  <div className="space-y-4 border-t border-[#222] p-4">
                    <div>
                      <label className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-gray-500">{t('slicer.settings.advanced.scene')}</label>
                      <div className="grid grid-cols-2 gap-2">
                        {smartSliceSceneOptions.map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => setSelectedMode(option.id)}
                            className={`rounded-lg border px-2 py-2 text-left transition-all ${
                              selectedMode === option.id
                                ? 'border-blue-500 bg-blue-600/20 text-blue-300'
                                : 'border-[#222] bg-[#141414] text-gray-400 hover:border-[#333] hover:text-gray-200'
                            }`}
                            title={option.title}
                          >
                            <span className="block truncate text-[11px] font-bold">{option.label}</span>
                            <span className="mt-0.5 block truncate text-[9px] font-semibold uppercase tracking-wider text-gray-500">{option.detail}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="mb-1.5 block text-[11px] font-medium text-gray-300">{t('slicer.settings.advanced.sttMode')}</label>
                      <select
                        value={selectedSttWorkflowPreset?.id ?? sttPresetId}
                        onChange={(event) => {
                          const nextPreset = availableSttWorkflowPresets.find((preset) => preset.id === event.target.value);
                          if (nextPreset && !nextPreset.selectable) {
                            toast(nextPreset.uiDisabledReason ?? t('slicer.settings.advanced.gpuRuntimeRequired'), 'error');
                            return;
                          }
                          if (nextPreset) {
                            setSttPresetId(nextPreset.id);
                          }
                        }}
                        className="w-full rounded-lg border border-[#222] bg-[#141414] px-3 py-2 text-xs text-gray-200 outline-none transition-all focus:border-blue-500"
                      >
                        {availableSttWorkflowPresets.map((preset) => (
                          <option key={preset.id} value={preset.id} disabled={!preset.selectable}>{preset.uiLabel}</option>
                        ))}
                      </select>
                      {selectedSttWorkflowPreset ? (
                        <div className="mt-1 text-[10px] leading-4 text-gray-500">
                          {selectedSttWorkflowPreset.uiDetail}
                        </div>
                      ) : null}
                      {selectedSttWorkflowPresetDisabledReason ? (
                        <div className="mt-1 text-[10px] leading-4 text-amber-300">
                          {selectedSttWorkflowPresetDisabledReason}
                        </div>
                      ) : selectedSttWorkflowPreset?.executionProfile === 'gpu' && speechSetupStatus?.gpu.ready ? (
                        <div className="mt-1 text-[10px] leading-4 text-emerald-300">
                          {t('slicer.settings.advanced.gpuReady', { backend: speechSetupStatus.gpu.backend ?? t('slicer.settings.advanced.detectedBackend') })}
                        </div>
                      ) : null}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="mb-1.5 block text-[11px] font-medium text-gray-300">{t('slicer.settings.advanced.continuity')}</label>
                        <select
                          value={continuityLevel}
                          onChange={(event) => handleSmartSliceContinuityChange(event.target.value)}
                          className="w-full rounded-lg border border-[#222] bg-[#141414] px-3 py-2 text-xs text-gray-200 outline-none transition-all focus:border-blue-500"
                        >
                          {smartSliceContinuityOptions.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1.5 block text-[11px] font-medium text-gray-300">{t('slicer.settings.advanced.segmentation')}</label>
                        <select
                          value={segmentationDensity}
                          onChange={(event) => handleSmartSliceSegmentationChange(event.target.value)}
                          className="w-full rounded-lg border border-[#222] bg-[#141414] px-3 py-2 text-xs text-gray-200 outline-none transition-all focus:border-blue-500"
                        >
                          {smartSliceSegmentationOptions.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <input
                      type="text"
                      value={customKeywordsInput}
                      onChange={(event) => setCustomKeywordsInput(event.target.value)}
                      placeholder={t('slicer.settings.advanced.keywordsPlaceholder')}
                      className="w-full rounded-lg border border-[#222] bg-[#141414] px-3 py-2 text-xs text-gray-200 outline-none transition-all placeholder:text-gray-600 focus:border-blue-500"
                    />

                    <div>
                      <label className="mb-1.5 block text-[11px] font-medium text-gray-300">{t('slicer.settings.advanced.reviewModel')}</label>
                      <select
                        value={llmModel}
                        onChange={(event) => {
                          const selectedModel = visibleLlmModelOptions.find((model) => model.id === event.target.value);
                          if (selectedModel && isSliceLlmModelId(selectedModel.id)) {
                            setLlmModel(selectedModel.id);
                          }
                        }}
                        className="w-full rounded-lg border border-[#222] bg-[#141414] px-3 py-2 text-xs text-gray-200 outline-none transition-all focus:border-blue-500"
                      >
                        {visibleLlmModelOptions.map((model) => (
                          <option key={`${model.vendor}:${model.id}`} value={model.id}>{model.label}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-1.5 block text-[11px] font-medium text-gray-300">{t('slicer.settings.advanced.agent')}</label>
                      <select
                        value={segmentationAgentId}
                        onChange={(event) => {
                          const selectedAgent = AUTOCUT_SMART_SLICE_SEGMENTATION_AGENTS.find((agent) => agent.id === event.target.value);
                          if (selectedAgent) {
                            setSegmentationAgentId(selectedAgent.id);
                          }
                        }}
                        className="w-full rounded-lg border border-[#222] bg-[#141414] px-3 py-2 text-xs text-gray-200 outline-none transition-all focus:border-blue-500"
                      >
                        {AUTOCUT_SMART_SLICE_SEGMENTATION_AGENTS.map((agent) => (
                          <option key={agent.id} value={agent.id}>
                            {formatSmartSliceAdvancedI18nText(
                              t,
                              'segmentationAgents',
                              agent.id,
                              'label',
                              agent.label,
                            )}
                          </option>
                        ))}
                      </select>
                    </div>

                    <section className="rounded-lg border border-[#252525] bg-[#101010] p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400">{t('slicer.settings.advanced.dedup')}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setEnableSmartDedup((enabled) => !enabled)}
                          className={`inline-flex min-w-[58px] items-center justify-center rounded border px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                            enableSmartDedup
                              ? 'border-amber-500/40 bg-amber-500/15 text-amber-200'
                              : 'border-[#333] bg-[#141414] text-gray-400 hover:border-[#444] hover:text-gray-200'
                          }`}
                          aria-pressed={enableSmartDedup}
                        >
                          {enableSmartDedup ? t('slicer.settings.common.on') : t('slicer.settings.common.off')}
                        </button>
                      </div>
                      {enableSmartDedup ? (
                        <div className="mt-3">
                          <VideoDedupWorkbench
                            compact
                            title={t('slicer.settings.advanced.dedupTitle')}
                            sourceAssetIds={fileId ? [fileId] : []}
                            analysisDisabledReason={fileId ? undefined : t('slicer.settings.advanced.dedupPendingSource')}
                            initialParams={videoDedupParams}
                            onParamsChange={setVideoDedupParams}
                            onReportReady={setLatestVideoDedupReport}
                          />
                          {latestVideoDedupReport ? (
                            <div className="mt-2 rounded border border-[#303030] bg-[#141414] px-3 py-2 text-[10px] leading-4 text-gray-400">
                              {t('slicer.settings.advanced.dedupReport', {
                                groups: latestVideoDedupReport.duplicateGroupCount,
                                matches: latestVideoDedupReport.matchCount,
                              })}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </section>
                  </div>
                ) : null}
              </section>

            </div>
          </div>

          <div className="p-5 border-t border-[#222] bg-[#0A0A0A]">
            <Button
              size="lg"
              className="w-full flex items-center justify-center gap-2 font-bold tracking-wide bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20 transition-all rounded-xl py-4 h-auto disabled:cursor-not-allowed disabled:bg-[#252525] disabled:text-gray-500 disabled:shadow-none"
              onClick={handleStart}
              disabled={isProcessing || !smartSliceReadyForRun}
            >
              <Scissors size={20} />
              <span className="text-sm">{smartSlicePrimaryActionLabel}</span>
            </Button>
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
