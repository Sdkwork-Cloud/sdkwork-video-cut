import { processVideoSlice } from '../service/slicerService';
import React, { Suspense, useState, useEffect, useMemo, useRef, useImperativeHandle, forwardRef } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Play, Pause, Settings2, Scissors, CheckCircle2, MicOff, Waves, Video, RefreshCcw, XCircle, ChevronRight, Type, Download, AlertTriangle, ExternalLink, Loader2 } from "lucide-react";
import { Button, useToast, TaskFailureState, createAutoCutTrustedLocalFile, resolveAutoCutTrustedSourcePath, type AutoCutTrustedFileSourceDescriptor } from "@sdkwork/autocut-commons";
import { AUTOCUT_MODEL_VENDOR_PRESETS, AUTOCUT_SLICE_LLM_MODEL_OPTIONS, AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS, AUTOCUT_TASK_STATUS, AUTOCUT_TASK_TYPE, type AutoCutLocalSpeechTranscriptionSetupStatus, type AutoCutSpeechTranscriptionModelDownloadProgressEvent, type ModelVendor, type SliceMode, type SliceAlgorithm, type SliceHighlightEngine, type SliceLLM, type SliceTargetPlatform, type SliceTargetAspectRatio, type SliceVideoObjectFit, type SliceCountMode, type SliceContinuityLevel, type SliceSubtitleMode, type AppTask, type VideoSliceParams } from "@sdkwork/autocut-types";
import { createAutoCutObjectUrl, formatAutoCutTimeOfDay, getAutoCutNativeHostClient, getAutoCutProcessingTaskErrorTaskId, getAutoCutWorkflowPreferences, getTasks, initializeAutoCutLocalSpeechTranscriptionSetup, inspectAutoCutLocalSpeechTranscriptionSetup, listenAutoCutEvent, reportAutoCutDiagnostic, resolveAutoCutLlmRuntimeConfig, revokeAutoCutObjectUrl, saveAutoCutVideoSlicePreferences, selectAutoCutTrustedLocalVideoFile, writeAutoCutClipboardText } from "@sdkwork/autocut-services";
import type { WebGLPlayerRef, TextEffectStyle, TextEffectDragPayload } from "../components/WebGLPlayer";

const WebGLPlayer = React.lazy(() => import("../components/WebGLPlayer"));

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

const MODES: SliceMode[] = [
  "商品直播",
  "单人讲解",
  "双人连线直播",
  "多人连线直播",
  "在线会议",
  "才艺表演",
  "电影",
  "通用",
];

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

function createSmartSliceFailureToastMessage(error: unknown) {
  const errorMessage = getSmartSliceErrorMessage(error).trim();
  return errorMessage ? `智能切片失败：${errorMessage}` : '智能切片失败：请打开控制台查看 AutoCut 诊断日志。';
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
    targetPlatform: params.targetPlatform,
    targetAspectRatio: params.targetAspectRatio,
    videoObjectFit: params.videoObjectFit,
    sliceCountMode: params.sliceCountMode,
    targetSliceCount: params.targetSliceCount,
    idealDuration: params.idealDuration,
    minDuration: params.minDuration,
    maxDuration: params.maxDuration,
    continuityLevel: params.continuityLevel,
    customKeywordCount: params.customKeywords?.length ?? 0,
    baseAlgorithm: params.baseAlgorithm,
    highlightEngine: params.highlightEngine,
    enableSubtitles: params.enableSubtitles,
    subtitleMode: params.subtitleMode,
    subtitleStyleId: params.subtitleStyleId,
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

function createSmartSliceSpeechSetupFriendlyError(errorMessage: string) {
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
    return '下载的语音识别模型没有通过完整性校验。请重新准备，应用会替换无效文件。';
  }
  if (
    message.includes('incomplete') ||
    message.includes('did not finish') ||
    message.includes('empty file')
  ) {
    return '语音识别模型还没有完整下载。请重试准备；如果网络受限，可以在设置中复制下载链接并手动选择完整模型文件。';
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
    return '语音识别模型暂时无法下载。请检查网络后重试，或在语音识别设置中复制下载链接后手动导入。';
  }
  if (
    message.includes('executable') ||
    message.includes('whisper-cli') ||
    message.includes('sidecar')
  ) {
    return '本机语音识别程序还没有准备好。请打开语音识别设置，完成自动准备或选择本机 whisper-cli。';
  }
  if (
    message.includes('model') ||
    message.includes('modelpath')
  ) {
    return '离线语音识别模型还没有准备好。请重试准备，或在设置中选择已下载完成的模型文件。';
  }

  return rawMessage.length > 180
    ? '语音识别准备失败。请重试，或打开语音识别设置查看详细信息。'
    : rawMessage;
}

function getSmartSliceSpeechSetupProgressLabel(progress: AutoCutSpeechTranscriptionModelDownloadProgressEvent | null) {
  if (!progress) {
    return '等待离线模型准备';
  }
  if (progress.errorMessage) {
    return createSmartSliceSpeechSetupFriendlyError(progress.errorMessage);
  }

  const downloaded = formatSmartSliceSpeechSetupBytes(progress.downloadedBytes);
  const total = progress.totalBytes ? formatSmartSliceSpeechSetupBytes(progress.totalBytes) : '';
  return total ? `${downloaded} / ${total}` : downloaded;
}

function createSmartSliceSpeechSetupStatusText(
  status: AutoCutLocalSpeechTranscriptionSetupStatus | null,
  errorMessage: string,
) {
  if (errorMessage) {
    return createSmartSliceSpeechSetupFriendlyError(errorMessage);
  }
  if (!status) {
    return '正在检查智能切片需要的语音识别能力。';
  }
  if (status.readiness === AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.ready) {
    return '语音识别已准备好，智能切片可以继续分析语音内容。';
  }
  if (status.readiness === AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.needsExecutable) {
    return status.capabilities.toolchainReady
      ? '已找到本机语音识别程序，应用会在开始切片前保存检测结果。'
      : '还没有找到可用的本机语音识别程序。请打开语音识别设置，完成自动准备或选择已安装的 whisper-cli。';
  }
  if (status.readiness === AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.needsModel) {
    return `需要离线识别模型。应用将下载并校验 ${status.model.preset.label}，完成后继续智能切片。`;
  }
  if (status.readiness === AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.needsTest) {
    return '语音识别程序和模型已选择，还需要通过一次可用性检测。';
  }

  return createSmartSliceSpeechSetupFriendlyError(status.diagnostics[0] ?? '') ||
    '需要先准备好语音识别能力，智能切片才能分析视频中的语音内容。';
}

function waitForSmartSliceUiYield() {
  return new Promise<void>((resolve) => {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => resolve());
      return;
    }

    setTimeout(() => resolve(), 0);
  });
}

export function SlicerPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const playerRef = useRef<SmartSlicePlayerRef>(null);
  const replaceVideoInputRef = useRef<HTMLInputElement>(null);
  const initialSourceUrl = searchParams.get('url')?.trim() ?? '';
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

  const [selectedMode, setSelectedMode] = useState<SliceMode>("通用");
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
  const [activeLeftTab, setActiveLeftTab] = useState<'text' | 'tasks'>('text');
  const [selectedTextInfo, setSelectedTextInfo] = useState<{ id: string; text: string; fontSize: number; fill: string; x?: number; y?: number; rotation?: number; scale?: number; } | null>(null);
  const [speechSetupDialogOpen, setSpeechSetupDialogOpen] = useState(false);
  const [speechSetupStatus, setSpeechSetupStatus] = useState<AutoCutLocalSpeechTranscriptionSetupStatus | null>(null);
  const [speechSetupErrorMessage, setSpeechSetupErrorMessage] = useState('');
  const [isInitializingSpeechSetup, setIsInitializingSpeechSetup] = useState(false);
  const [speechModelDownloadProgress, setSpeechModelDownloadProgress] = useState<AutoCutSpeechTranscriptionModelDownloadProgressEvent | null>(null);
  const [enableOverlayEditor, setEnableOverlayEditor] = useState(false);
  const webGlPlayerRef = playerRef as React.MutableRefObject<WebGLPlayerRef | null>;
  const shouldUseWebGlOverlayEditor = enableOverlayEditor && videoSrc;

  const TEXT_EFFECTS: TextEffectPreset[] = [
    {
      id: 'tiktok',
      name: '爆款红蓝字',
      text: '所有女生，准备好了吗！',
      styleConfig: {
        fill: '#00ebff',
        stroke: { color: '#ff0050', width: 4 },
        dropShadow: { color: '#000000', blur: 4, angle: Math.PI/4, distance: 4, alpha: 1 },
        fontFamily: 'system-ui', fontWeight: '900', letterSpacing: 2, fontSize: 48
      }
    },
    {
      id: 'variety',
      name: '综艺大字',
      text: '这也太好吃了吧！',
      styleConfig: {
        fill: '#fffc00',
        stroke: { color: '#ffffff', width: 4 },
        dropShadow: { color: '#ff0000', blur: 0, angle: Math.PI/2, distance: 6, alpha: 1 },
        fontFamily: 'system-ui', fontWeight: '900', letterSpacing: 1, fontSize: 52
      }
    },
    {
      id: 'gradient-cyan',
      name: '青蓝渐变',
      text: '家人们冲啊！',
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
      name: '燃爆火焰',
      text: '直接骨折价！',
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
      name: '赛博霓虹',
      text: '三、二、一，上链接！',
      styleConfig: {
        fill: '#ffffff',
        stroke: { color: '#d926ff', width: 2 },
        dropShadow: { color: '#d926ff', blur: 15, angle: 0, distance: 0, alpha: 1 },
        fontFamily: 'system-ui', fontWeight: 'bold', fontSize: 48
      }
    },
    {
        id: 'gold',
        name: '黑金炫酷',
        text: '主播亲测，绝对良心',
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
      name: '波普复古',
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
      name: '粗黑描边',
      text: '最后五十单！',
      styleConfig: {
        fill: '#FFF500',
        stroke: { color: '#000000', width: 10 },
        fontFamily: 'system-ui', fontWeight: '900', fontSize: 55, letterSpacing: 1
      }
    },
    {
        id: 'minimal',
        name: '极简白',
        text: '数量有限，先到先得',
        styleConfig: {
            fill: '#ffffff',
            stroke: { color: '#000000', width: 3 },
            dropShadow: { color: '#000000', blur: 8, angle: Math.PI/4, distance: 4, alpha: 0.8 },
            fontFamily: 'system-ui', fontWeight: '600', fontSize: 44
        }
    },
    {
      id: 'title-retro',
      name: '复古标题',
      text: '八十年代回忆',
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
      name: '立体积木',
      text: '新品首发！',
      styleConfig: {
        fill: '#FFFFFF',
        stroke: { color: '#0055FF', width: 4 },
        dropShadow: { color: '#0022AA', blur: 0, angle: Math.PI/2, distance: 10, alpha: 1 },
        fontFamily: 'system-ui', fontWeight: '900', letterSpacing: 3, fontSize: 50
      }
    },
    {
      id: 'bubble-gum',
      name: '泡泡糖',
      text: '甜蜜来袭~',
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
    fetchTasks();
    const handleUpdate = () => fetchTasks();
    const stopTaskUpdated = listenAutoCutEvent('taskUpdated', handleUpdate);
    const stopTaskAdded = listenAutoCutEvent('taskAdded', handleUpdate);
    return () => {
      stopTaskUpdated();
      stopTaskAdded();
    };
  }, []);

  // Slicing Advanced Parameters
  const [targetPlatform, setTargetPlatform] = useState<SliceTargetPlatform>('douyin');
  const [sliceCountMode, setSliceCountMode] = useState<SliceCountMode>('qualityFirst');
  const [targetSliceCount, setTargetSliceCount] = useState<number>(5);
  const [idealDuration, setIdealDuration] = useState<number>(45);
  const [continuityLevel, setContinuityLevel] = useState<SliceContinuityLevel>('standard');
  const [customKeywordsInput, setCustomKeywordsInput] = useState<string>('');
  const [minDuration, setMinDuration] = useState<number>(15);
  const [maxDuration, setMaxDuration] = useState<number>(90);
  const [activeLlmRuntimeModelVendor, setActiveLlmRuntimeModelVendor] = useState<ModelVendor>('deepseek');
  const [llmModel, setLlmModel] = useState<SliceLLM>('deepseek-v4-flash');
  const [baseAlgorithm, setBaseAlgorithm] = useState<SliceAlgorithm>('nlp');
  const [highlightEngine, setHighlightEngine] = useState<SliceHighlightEngine>('emotion');
  const [noiseReduction, setNoiseReduction] = useState<boolean>(true);
  const [coughFilter, setCoughFilter] = useState<boolean>(true);
  const [repeatFilter, setRepeatFilter] = useState<boolean>(false);

  useEffect(() => {
    if (targetPlatform === 'bilibili') {
      setAspectRatio('16:9');
      setVideoObjectFit('contain');
      setTargetSliceCount(3);
      setIdealDuration(90);
      return;
    }

    if (targetPlatform === 'xiaohongshu') {
      setAspectRatio('9:16');
      setVideoObjectFit('cover');
      setTargetSliceCount(5);
      setIdealDuration(35);
      return;
    }

    if (targetPlatform !== 'generic') {
      setAspectRatio('9:16');
      setVideoObjectFit('cover');
      setTargetSliceCount(5);
      setIdealDuration(45);
    }
  }, [targetPlatform]);

  useEffect(() => {
    resolveAutoCutLlmRuntimeConfig()
      .then((config) => {
        setActiveLlmRuntimeModelVendor(config.modelVendor);
        setLlmModel(config.model as SliceLLM);
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
        setSliceCountMode(videoSlice.sliceCountMode);
        setTargetSliceCount(videoSlice.targetSliceCount);
        setIdealDuration(videoSlice.idealDuration);
        setContinuityLevel(videoSlice.continuityLevel);
        setCustomKeywordsInput(videoSlice.customKeywordsInput);
        setMinDuration(videoSlice.minDuration);
        setMaxDuration(videoSlice.maxDuration);
        setBaseAlgorithm(videoSlice.baseAlgorithm);
        setHighlightEngine(videoSlice.highlightEngine);
        setNoiseReduction(videoSlice.enableNoiseReduction);
        setCoughFilter(videoSlice.enableCoughFilter);
        setRepeatFilter(videoSlice.enableRepeatFilter);
      })
      .catch((error) => reportAutoCutDiagnostic('warning', 'slicer', 'Load video slice parameter preferences failed', error));
  }, []);

  useEffect(() => listenAutoCutEvent('speechTranscriptionModelDownloadProgress', (progress) => {
    setSpeechModelDownloadProgress(progress);
  }), []);

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
    const status = await inspectAutoCutLocalSpeechTranscriptionSetup();
    setSpeechSetupStatus(status);
    return status;
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
      toast('语音识别已准备好，智能切片将继续处理。', 'success');
      return result.status.readiness === AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.ready;
    } catch (error) {
      const message = error instanceof Error ? error.message : '语音识别还没有准备好。';
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
    const status = await refreshSmartSliceLocalSpeechTranscriptionSetup();
    if (status.readiness === AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.ready) {
      setSpeechSetupDialogOpen(false);
      return true;
    }

    setSpeechSetupDialogOpen(true);
    const initialized = await runSmartSliceLocalSpeechTranscriptionInitialization();
    if (initialized) {
      setSpeechSetupDialogOpen(false);
    }
    return initialized;
  };

  const handleStart = async () => {
    setIsProcessing(true);
    toast('视频智能切片任务已创建并提交', 'info');
    try {
      const speechReady = await ensureSmartSliceLocalSpeechTranscriptionReady();
      if (!speechReady) {
        return;
      }
      await waitForSmartSliceUiYield();
      const effectiveSubtitleMode = enableSubtitles && subtitleMode === 'none' ? 'both' : subtitleMode;
      const sliceParams: VideoSliceParams = {
        mode: selectedMode,
        file,
        ...(fileId && !file ? { fileId } : {}),
        llmModel,
        targetPlatform,
        targetAspectRatio: aspectRatio,
        videoObjectFit,
        sliceCountMode,
        targetSliceCount,
        idealDuration,
        continuityLevel,
        customKeywords: customKeywordsInput
          .split(/[,，\n]/u)
          .map((keyword) => keyword.trim())
          .filter(Boolean),
        minDuration,
        maxDuration,
        baseAlgorithm,
        highlightEngine,
        enableNoiseReduction: noiseReduction,
        enableCoughFilter: coughFilter,
        enableRepeatFilter: repeatFilter,
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
      reportAutoCutDiagnostic('warning', 'slicer.submit', 'Smart Slice submit params', createSmartSliceSubmissionDiagnostics(sliceParams));
      await saveAutoCutVideoSlicePreferences({
        mode: selectedMode,
        targetPlatform,
        targetAspectRatio: aspectRatio,
        videoObjectFit,
        sliceCountMode,
        targetSliceCount,
        idealDuration,
        continuityLevel,
        customKeywordsInput,
        minDuration,
        maxDuration,
        llmModel,
        baseAlgorithm,
        highlightEngine,
        enableNoiseReduction: noiseReduction,
        enableCoughFilter: coughFilter,
        enableRepeatFilter: repeatFilter,
        enableSubtitles,
        subtitleMode: enableSubtitles ? effectiveSubtitleMode : 'none',
        subtitleStyleId: selectedSubtitleStyle,
      });
      await processVideoSlice(sliceParams);
      setIsProcessing(false);
      setActiveLeftTab("tasks");
      toast('切片任务分发成功，正在云端解析中', 'success');
    } catch (e) {
      const failedTaskId = getAutoCutProcessingTaskErrorTaskId(e);
      if (failedTaskId) {
        setActiveLeftTab("tasks");
      }
      reportAutoCutDiagnostic('error', 'slicer', 'Video slicing failed', e);
      setIsProcessing(false);
      toast(createSmartSliceFailureToastMessage(e), 'error');
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

  const handleReplaceVideoFallbackSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] ?? null;
    if (selectedFile) {
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
              视频切片工作台
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
              <Type size={14} /> 花字特效
            </button>
            <button
              onClick={() => setActiveLeftTab('tasks')}
              className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-colors flex justify-center items-center gap-2 ${activeLeftTab === 'tasks' ? 'text-blue-400 border-b-2 border-blue-500 bg-[#111]' : 'text-gray-500 hover:text-gray-300 hover:bg-[#111]'}`}
            >
              <CheckCircle2 size={14} /> 任务列表
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
                        <CheckCircle2 size={12} /> <span className="font-semibold">切片已完成</span>
                      </div>
                    )}
                    {task.status === AUTOCUT_TASK_STATUS.failed && (
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-[10px] text-red-500">
                        <XCircle size={12} /> <span className="font-semibold">切片失败</span>
                        </div>
                        <TaskFailureState
                          variant="compact"
                          errorMessage={task.errorMessage}
                          failureDiagnostics={task.failureDiagnostics}
                          onCopyErrorMessage={writeAutoCutClipboardText}
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
                查看所有任务 <ChevronRight size={14} />
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
                      <span className="px-1.5 py-0.5 bg-[#222] rounded border border-[#333]">J</span> 倒退
                      <span className="px-1.5 py-0.5 bg-[#222] rounded border border-[#333]">K</span>/
                      <span className="px-1.5 py-0.5 bg-[#222] rounded border border-[#333]">Space</span> 播放
                      <span className="px-1.5 py-0.5 bg-[#222] rounded border border-[#333]">L</span> 前进
                      <span className="ml-2 px-1.5 py-0.5 bg-[#222] rounded border border-[#333]">←</span>
                      <span className="px-1.5 py-0.5 bg-[#222] rounded border border-[#333]">→</span> 逐帧
                    </div>
                  </div>
                <div className="flex items-center gap-2 text-gray-400">
                     <select
                        value={aspectRatio}
                         onChange={e => setAspectRatio(e.target.value as SliceTargetAspectRatio)}
                        className="bg-[#222] border border-[#333] text-gray-300 text-[11px] rounded px-2 py-1 outline-none focus:border-blue-500 transition-colors"
                     >
                       <option value="auto">自动比例 ({detectedRatio})</option>
                       <option value="16:9">16:9 (横屏)</option>
                       <option value="9:16">9:16 (竖屏)</option>
                       <option value="1:1">1:1 (正方形)</option>
                       <option value="4:3">4:3 (标准)</option>
                     </select>

                     <select
                        value={videoObjectFit}
                         onChange={e => setVideoObjectFit(e.target.value as SliceVideoObjectFit)}
                        className="bg-[#222] border border-[#333] text-gray-300 text-[11px] rounded px-2 py-1 outline-none focus:border-blue-500 transition-colors"
                     >
                       <option value="contain">适应 (留黑边)</option>
                       <option value="cover">填充 (裁剪)</option>
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
                  <RefreshCcw size={14} /> 更换视频文件
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
                  文字属性
                </h2>
                <span
                  className="text-[11px] text-gray-500 cursor-pointer hover:text-white transition-colors"
                  onClick={() => setSelectedTextInfo(null)}
                >
                  关闭
                </span>
              </div>
              <div className="p-5 flex-1 overflow-y-auto space-y-6">
                 <div>
                   <label className="block text-[11px] font-bold text-gray-500 mb-2 uppercase tracking-wider">文本内容</label>
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
                      <span>字号 (大小)</span>
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
                   <label className="block text-[11px] font-bold text-gray-500 mb-2 uppercase tracking-wider">文字颜色</label>
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
                     <label className="block text-[11px] font-bold text-gray-500 mb-2 uppercase tracking-wider">X 坐标</label>
                     <div className="bg-[#141414] border border-[#222] rounded-lg px-3 py-2 text-xs text-white text-center font-mono">
                        {selectedTextInfo.x !== undefined && !Number.isNaN(selectedTextInfo.x) ? selectedTextInfo.x : '-'}
                     </div>
                   </div>
                   <div>
                     <label className="block text-[11px] font-bold text-gray-500 mb-2 uppercase tracking-wider">Y 坐标</label>
                     <div className="bg-[#141414] border border-[#222] rounded-lg px-3 py-2 text-xs text-white text-center font-mono">
                        {selectedTextInfo.y !== undefined && !Number.isNaN(selectedTextInfo.y) ? selectedTextInfo.y : '-'}
                     </div>
                   </div>
                 </div>

                 <div className="grid grid-cols-2 gap-4">
                   <div>
                     <label className="block text-[11px] font-bold text-gray-500 mb-2 uppercase tracking-wider">缩放比例</label>
                     <div className="bg-[#141414] border border-[#222] rounded-lg px-3 py-2 text-xs text-white text-center font-mono">
                        {selectedTextInfo.scale !== undefined && !Number.isNaN(selectedTextInfo.scale) ? selectedTextInfo.scale.toFixed(2) : '-'}
                     </div>
                   </div>
                   <div>
                     <label className="block text-[11px] font-bold text-gray-500 mb-2 uppercase tracking-wider">旋转角度</label>
                     <div className="bg-[#141414] border border-[#222] rounded-lg px-3 py-2 text-xs text-white text-center font-mono">
                        {selectedTextInfo.rotation !== undefined && !Number.isNaN(selectedTextInfo.rotation) ? (selectedTextInfo.rotation * (180/Math.PI)).toFixed(1) + '°' : '-'}
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
                  智能切片配置
                </h2>
                <span className="text-[11px] text-blue-500 cursor-pointer hover:text-blue-400 transition-colors">自定义 &rsaquo;</span>
              </div>

              <div className="p-5 flex-1 overflow-y-auto w-full custom-scrollbar styled-scrollbar">
                <div className="space-y-6">
              {/* Mode Selection */}
              <div>
                <label className="block text-[11px] font-bold text-gray-500 mb-2 uppercase tracking-wider">
                  切片内容场景
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {MODES.map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setSelectedMode(mode)}
                      className={`px-2 py-2 text-[11px] font-bold rounded-lg transition-all border ${
                        selectedMode === mode
                          ? "bg-blue-600/20 border-blue-500 text-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.15)]"
                          : "bg-[#141414] border-[#222] text-gray-400 hover:bg-[#1A1A1A] hover:border-[#333] hover:text-gray-200"
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
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

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="flex justify-between items-end mb-1.5">
                         <span className="text-[11px] font-medium text-gray-300">Count Mode</span>
                      </div>
                      <select
                         value={sliceCountMode}
                         onChange={e => setSliceCountMode(e.target.value as SliceCountMode)}
                         className="w-full bg-[#141414] border border-[#222] hover:border-[#333] rounded-lg px-3 py-2 text-xs text-gray-200 outline-none focus:border-blue-500 appearance-none transition-all cursor-pointer shadow-sm">
                        <option value="qualityFirst">Quality First</option>
                        <option value="coverageFirst">Coverage First</option>
                        <option value="fixed">Fixed Count</option>
                        <option value="auto">Auto</option>
                      </select>
                    </div>
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

                  <div className="grid grid-cols-2 gap-2">
                    <div className="relative">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-500 font-medium">Clips</span>
                      <input
                        type="number"
                        value={targetSliceCount}
                        onChange={(event) =>
                          setTargetSliceCount((currentValue) =>
                            normalizeSlicerNumberInput(event.target.value, currentValue, 1, 20),
                          )
                        }
                        className="w-full bg-[#141414] border border-[#222] rounded-lg pl-11 pr-2 py-1.5 text-xs text-white focus:border-blue-500 focus:bg-[#1A1A1A] outline-none transition-all"
                        min={1}
                        max={20}
                      />
                    </div>
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
                  <span>片段时长控制 (秒)</span>
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
                    <div className="text-[11px] font-bold text-gray-400 group-hover:text-gray-200 transition-colors uppercase tracking-wider">自动生成中英文字幕</div>
                    <div className="text-[10px] text-gray-600 mt-1">使用 Whisper 大模型生成高潮解说字幕</div>
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
                     <span className="text-[10px] font-bold text-gray-500 mb-2 block uppercase tracking-wider">选择自动字幕样式</span>
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
                <label className="block text-[11px] font-bold text-gray-500 mb-3 uppercase tracking-wider">核心切分算法</label>
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between items-end mb-1.5">
                       <span className="text-[11px] font-medium text-gray-300">推理大模型 (LLM)</span>
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
                  <div>
                    <div className="flex justify-between items-end mb-1.5">
                       <span className="text-[11px] font-medium text-gray-300">基础分段策略</span>
                    </div>
                    <div className="relative">
                      <select
                         value={baseAlgorithm}
                         onChange={e => setBaseAlgorithm(e.target.value as SliceAlgorithm)}
                         className="w-full bg-[#141414] border border-[#222] hover:border-[#333] rounded-lg px-3 py-2 text-xs text-gray-200 outline-none focus:border-blue-500 appearance-none transition-all cursor-pointer shadow-sm">
                        <option value="nlp">NLP 语义智能断句</option>
                        <option value="pause">声音停顿识别算法</option>
                        <option value="scene">画面分镜切换识别</option>
                      </select>
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500">
                        <svg width="8" height="5" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between items-end mb-1.5">
                       <span className="text-[11px] font-medium text-gray-300">高光提取引擎</span>
                    </div>
                    <div className="relative">
                      <select
                         value={highlightEngine}
                         onChange={e => setHighlightEngine(e.target.value as SliceHighlightEngine)}
                         className="w-full bg-[#141414] border border-[#222] hover:border-[#333] rounded-lg px-3 py-2 text-xs text-gray-200 outline-none focus:border-blue-500 appearance-none transition-all cursor-pointer shadow-sm">
                        <option value="emotion">情绪波动识别网络</option>
                        <option value="keyword">关键词唤醒提取</option>
                        <option value="motion">动作幅度变化提取</option>
                      </select>
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500">
                        <svg width="8" height="5" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="w-full h-px bg-[#222]"></div>

              {/* AI Filters */}
              <div>
                <label className="block text-[11px] font-bold text-gray-500 mb-2 uppercase tracking-wider">AI 智能过滤</label>
                <div className="space-y-0.5">

                  <div className="flex items-center justify-between group p-1.5 -mx-1.5 hover:bg-[#111] rounded-lg transition-colors cursor-pointer" onClick={() => setNoiseReduction(!noiseReduction)}>
                     <div className="flex items-center gap-2.5">
                        <div className="w-6 h-6 rounded bg-[#1A1A1A] border border-[#222] flex items-center justify-center group-hover:border-[#333] transition-colors">
                          <Waves size={12} className="text-gray-400 group-hover:text-blue-400 transition-colors" />
                        </div>
                        <span className="text-xs text-gray-300 font-medium">环境降噪增强</span>
                     </div>
                     <button className={`w-7 h-4 rounded-full p-0.5 transition-colors relative focus:outline-none ${noiseReduction ? 'bg-blue-600' : 'bg-[#333]'}`}>
                       <div className={`w-3 h-3 bg-white rounded-full transition-transform absolute top-0.5 shadow-sm ${noiseReduction ? 'translate-x-3' : 'translate-x-0'}`} />
                     </button>
                  </div>

                  <div className="flex items-center justify-between group p-1.5 -mx-1.5 hover:bg-[#111] rounded-lg transition-colors cursor-pointer" onClick={() => setCoughFilter(!coughFilter)}>
                     <div className="flex items-center gap-2.5">
                        <div className="w-6 h-6 rounded bg-[#1A1A1A] border border-[#222] flex items-center justify-center group-hover:border-[#333] transition-colors">
                          <MicOff size={12} className="text-gray-400 group-hover:text-orange-400 transition-colors" />
                        </div>
                        <span className="text-xs text-gray-300 font-medium">咳嗽与杂音剔除</span>
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
                        <span className="text-xs text-gray-300 font-medium">重复内容去重</span>
                     </div>
                     <button className={`w-7 h-4 rounded-full p-0.5 transition-colors relative focus:outline-none ${repeatFilter ? 'bg-blue-600' : 'bg-[#333]'}`}>
                       <div className={`w-3 h-3 bg-white rounded-full transition-transform absolute top-0.5 shadow-sm ${repeatFilter ? 'translate-x-3' : 'translate-x-0'}`} />
                     </button>
                  </div>

                </div>
              </div>

            </div>
          </div>

          <div className="p-5 border-t border-[#222] bg-[#0A0A0A]">
            <Button
              size="lg"
              className="w-full flex items-center justify-center gap-2 font-bold tracking-wide bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20 transition-all rounded-xl py-4 h-auto"
              onClick={handleStart}
              disabled={isProcessing}
            >
              <Scissors size={20} />
              <span className="text-sm">{isProcessing ? "切片请求处理中..." : "开始一键智能切片"}</span>
            </Button>
            <p className="text-center text-[10px] text-gray-600 mt-3 leading-relaxed">
              基于 AI 行为识别引擎，自动识别精彩片段并输出
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
                    : isInitializingSpeechSetup
                      ? 'border-blue-500/30 bg-blue-500/10 text-blue-300'
                      : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                }`}>
                  {speechSetupErrorMessage ? <AlertTriangle size={18} /> : isInitializingSpeechSetup ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                </div>
                <div>
                  <h2 id="smart-slice-speech-setup-title" className="text-sm font-semibold text-gray-100">准备语音识别能力</h2>
                  <p className="mt-1 text-xs leading-5 text-gray-400">{createSmartSliceSpeechSetupStatusText(speechSetupStatus, speechSetupErrorMessage)}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSpeechSetupDialogOpen(false)}
                className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-[#202020] hover:text-gray-200"
                disabled={isInitializingSpeechSetup}
                aria-label="Close speech recognition setup"
              >
                <XCircle size={18} />
              </button>
            </div>

            <div className="space-y-4 px-5 py-4">
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: '识别程序', ready: speechSetupStatus?.executable.ready, detail: formatSmartSliceSpeechSetupPath(speechSetupStatus?.executable.path || speechSetupStatus?.defaults.executablePath) || (speechSetupStatus?.executable.ready ? '已检测' : '待准备') },
                  { label: '离线模型', ready: speechSetupStatus?.model.ready, detail: formatSmartSliceSpeechSetupPath(speechSetupStatus?.model.path || speechSetupStatus?.defaults.modelPath) || speechSetupStatus?.model.preset.label || '推荐模型' },
                  { label: '可用性检测', ready: speechSetupStatus?.test.ready, detail: speechSetupStatus?.test.ready ? '已通过' : '待检测' },
                ].map((item) => (
                  <div key={item.label} className="rounded-md border border-[#252525] bg-[#151515] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{item.label}</span>
                      {item.ready ? <CheckCircle2 size={14} className="text-green-400" /> : <AlertTriangle size={14} className="text-amber-400" />}
                    </div>
                    <div className="mt-2 truncate text-xs leading-4 text-gray-300" title={item.detail}>{item.detail}</div>
                  </div>
                ))}
              </div>

              <div className="rounded-md border border-[#252525] bg-[#151515] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-gray-200">本机识别程序</div>
                    <div className="mt-1 text-[11px] text-gray-500">
                      {speechSetupStatus?.executable.ready ? '已找到可用程序' : '正在检查程序'}
                    </div>
                  </div>
                  <div className={`text-xs font-bold ${speechSetupStatus?.executable.ready ? 'text-emerald-300' : 'text-amber-300'}`}>
                    {speechSetupStatus?.executable.ready ? '已就绪' : '待准备'}
                  </div>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#252525]">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: speechSetupStatus?.executable.ready ? '100%' : '8%' }}
                  />
                </div>
                <div className="mt-2 truncate text-[10px] text-gray-500" title={speechSetupStatus?.executable.path || speechSetupStatus?.defaults.executablePath || ''}>
                  {formatSmartSliceSpeechSetupPath(speechSetupStatus?.executable.path || speechSetupStatus?.defaults.executablePath) || '应用会自动检测本机识别程序'}
                </div>
              </div>

              <div className="rounded-md border border-[#252525] bg-[#151515] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-gray-200">离线识别模型</div>
                    <div className="mt-1 text-[11px] text-gray-500">{getSmartSliceSpeechSetupProgressLabel(speechModelDownloadProgress)}</div>
                  </div>
                  <div className="text-xs font-bold text-blue-300">{speechModelDownloadProgress?.progress ?? 0}%</div>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#252525]">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all"
                    style={{ width: `${Math.min(100, Math.max(0, speechModelDownloadProgress?.progress ?? 0))}%` }}
                  />
                </div>
                <div className="mt-2 flex justify-between text-[10px] text-gray-600">
                  <span>{speechModelDownloadProgress ? '下载进度' : '等待准备'}</span>
                  <span>
                    {formatSmartSliceSpeechSetupBytes(speechModelDownloadProgress?.downloadedBytes)}
                    {speechModelDownloadProgress?.totalBytes ? ` / ${formatSmartSliceSpeechSetupBytes(speechModelDownloadProgress.totalBytes)}` : ''}
                  </span>
                </div>
                <div className="mt-2 truncate text-[10px] text-gray-500" title={speechModelDownloadProgress?.modelPath || speechSetupStatus?.model.path || speechSetupStatus?.defaults.modelPath || ''}>
                  {formatSmartSliceSpeechSetupPath(speechModelDownloadProgress?.modelPath || speechSetupStatus?.model.path || speechSetupStatus?.defaults.modelPath) || '应用会自动保存离线模型'}
                </div>
              </div>

              {speechSetupStatus?.diagnostics?.length ? (
                <div className="max-h-24 overflow-y-auto rounded-md border border-[#252525] bg-[#0b0b0b] p-3 text-[11px] leading-5 text-gray-400">
                  <div className="mb-1 font-semibold text-gray-500">详细信息</div>
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
                打开语音识别设置
              </Button>
              <Button
                type="button"
                className="h-9 gap-2 bg-blue-600 px-3 text-xs text-white hover:bg-blue-500"
                onClick={runSmartSliceLocalSpeechTranscriptionInitialization}
                disabled={isInitializingSpeechSetup}
              >
                {isInitializingSpeechSetup ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                {isInitializingSpeechSetup ? '准备中' : '重新准备'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
