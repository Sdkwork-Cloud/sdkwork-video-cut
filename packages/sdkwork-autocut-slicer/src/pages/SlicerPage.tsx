import { processVideoSlice } from '../service/slicerService';
import React, { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Play, Pause, Settings2, Scissors, CheckCircle2, MicOff, Waves, Video, RefreshCcw, XCircle, ChevronRight, Type } from "lucide-react";
import { Button, useToast, TaskFailureState, createAutoCutTrustedLocalFile, resolveAutoCutTrustedSourcePath } from "@sdkwork/autocut-commons";
import { AUTOCUT_SLICE_LLM_MODEL_OPTIONS, AUTOCUT_TASK_STATUS, type SliceMode, type SliceAlgorithm, type SliceHighlightEngine, type SliceLLM, type AppTask, type VideoSliceParams } from "@sdkwork/autocut-types";
import { createAutoCutObjectUrl, getAutoCutNativeHostClient, getAutoCutProcessingTaskErrorTaskId, getAutoCutSampleVideoUrl, getTasks, listenAutoCutEvent, reportAutoCutDiagnostic, resolveAutoCutLlmRuntimeConfig, revokeAutoCutObjectUrl, selectAutoCutTrustedLocalVideoFile } from "@sdkwork/autocut-services";
import { WebGLPlayer, WebGLPlayerRef, WebGLPlayerDragState } from "../components/WebGLPlayer";
import type { TextEffectStyle } from "../components/WebGLPlayer";

interface TextEffectPreset {
  id: string;
  name: string;
  text: string;
  styleConfig: TextEffectStyle;
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

export function SlicerPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const playerRef = useRef<WebGLPlayerRef>(null);
  const replaceVideoInputRef = useRef<HTMLInputElement>(null);
  const initialSourceUrl = searchParams.get('url')?.trim() ?? '';
  const initialFile = (location.state as { initialFile?: File } | null)?.initialFile ?? null;

  const [selectedMode, setSelectedMode] = useState<SliceMode>("通用");
  const [isProcessing, setIsProcessing] = useState(false);
  const [file, setFile] = useState<File | null>(initialFile);
  const [sourceUrl] = useState(initialSourceUrl);
  const [videoSrc, setVideoSrc] = useState<string>(getAutoCutSampleVideoUrl());
  const [aspectRatio, setAspectRatio] = useState<string>("auto");
  const [videoObjectFit, setVideoObjectFit] = useState<'contain' | 'cover'>('contain');
  const [detectedRatio, setDetectedRatio] = useState<string>("16:9");

  const [generateSubtitles, setGenerateSubtitles] = useState(false);
  const [selectedSubtitleStyle, setSelectedSubtitleStyle] = useState('tiktok');

  const [slicerTasks, setSlicerTasks] = useState<AppTask[]>([]);
  const [activeLeftTab, setActiveLeftTab] = useState<'text' | 'tasks'>('text');
  const [selectedTextInfo, setSelectedTextInfo] = useState<{ id: string; text: string; fontSize: number; fill: string; x?: number; y?: number; rotation?: number; scale?: number; } | null>(null);

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
          setVideoSrc(getAutoCutSampleVideoUrl());
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
        setSlicerTasks(tasks.filter(t => t.type === '视频切片'));
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
  const [minDuration, setMinDuration] = useState<number>(15);
  const [maxDuration, setMaxDuration] = useState<number>(90);
  const [llmModel, setLlmModel] = useState<SliceLLM>('deepseek-v4-flash');
  const [baseAlgorithm, setBaseAlgorithm] = useState<SliceAlgorithm>('nlp');
  const [highlightEngine, setHighlightEngine] = useState<SliceHighlightEngine>('emotion');
  const [noiseReduction, setNoiseReduction] = useState<boolean>(true);
  const [coughFilter, setCoughFilter] = useState<boolean>(true);
  const [repeatFilter, setRepeatFilter] = useState<boolean>(false);

  useEffect(() => {
    resolveAutoCutLlmRuntimeConfig()
      .then((config) => setLlmModel(config.model as SliceLLM))
      .catch((error) => reportAutoCutDiagnostic('warning', 'slicer', 'Load default LLM model failed', error));
  }, []);

  // Video Player state
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [videoProgress, setVideoProgress] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

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

  const handleStart = async () => {
    setIsProcessing(true);
    toast('视频智能切片任务已创建并提交', 'info');
    try {
      const sliceParams: VideoSliceParams = {
        mode: selectedMode,
        file,
        llmModel,
        minDuration,
        maxDuration,
        baseAlgorithm,
        highlightEngine,
        enableNoiseReduction: noiseReduction,
        enableCoughFilter: coughFilter,
        enableRepeatFilter: repeatFilter,
        enableSubtitles: generateSubtitles
      };
      if (sourceUrl) {
        sliceParams.url = sourceUrl;
      }
      if (generateSubtitles) {
        sliceParams.subtitleStyleId = selectedSubtitleStyle;
      }
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
      toast('参数配置异常或服务未响应', 'error');
    }
  };

  const handleReplaceVideoFallbackSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] ?? null;
    if (selectedFile) {
      setFile(selectedFile);
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
              onClick={() => setActiveLeftTab('text')}
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
                      e.dataTransfer.setData("application/json", JSON.stringify({
                        textContent: effect.text,
                        styleConfig: effect.styleConfig
                      }));
                      WebGLPlayerDragState.currentEffect = {
                          textContent: effect.text,
                          styleConfig: effect.styleConfig
                      };
                    }}
                    onDragEnd={() => {
                        WebGLPlayerDragState.currentEffect = null;
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
                          {task.createdAt.split(' ')[1]}
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
                        <div className="text-[10px] text-red-400/80 line-clamp-2">{task.errorMessage || '任务处理失败'}</div>
                        <TaskFailureState variant="compact" errorMessage={task.errorMessage} />
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
               <WebGLPlayer
                  ref={playerRef}
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
                      setVideoProgress((c / d) * 100);
                  }}
                  onPlayStateChange={setIsPlaying}
               />

              {isProcessing && (
                <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center z-50">
                  <div className="text-white flex flex-col items-center gap-4">
                    <div className="animate-spin text-blue-500">
                      <Settings2 size={32} />
                    </div>
                    <p className="font-medium text-xs text-blue-400">正在进行基于 WebGL 的高光帧提取与识别...</p>
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
                        onChange={e => setAspectRatio(e.target.value)}
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
                        onChange={e => setVideoObjectFit(e.target.value as 'contain' | 'cover')}
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
                    {file ? file.name : "内置演示素材.mp4"}
                    {file && <span className="px-1.5 py-0.5 bg-[#333] text-[10px] text-gray-400 rounded">{(file.size / 1024 / 1024).toFixed(1)}MB</span>}
                  </h2>
                  <div className="text-[11px] text-gray-500 font-mono mt-1 truncate">
                    {file ? "本地文件" : getAutoCutSampleVideoUrl()}
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

              {/* Duration Config */}
              <div>
                <label className="block text-[11px] font-bold text-gray-500 mb-2.5 uppercase tracking-wider flex justify-between items-center">
                  <span>片段时长控制 (秒)</span>
                  <span className="text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded text-[10px]">{minDuration}s - {maxDuration}s</span>
                </label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-500 font-medium">Min</span>
                    <input type="number" value={minDuration} onChange={e => setMinDuration(Number(e.target.value))} className="w-full bg-[#141414] border border-[#222] rounded-lg pl-8 pr-2 py-1.5 text-xs text-white focus:border-blue-500 focus:bg-[#1A1A1A] outline-none transition-all" min={5} max={180} />
                  </div>
                  <span className="text-gray-600 font-light">-</span>
                  <div className="flex-1 relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-500 font-medium">Max</span>
                    <input type="number" value={maxDuration} onChange={e => setMaxDuration(Number(e.target.value))} className="w-full bg-[#141414] border border-[#222] rounded-lg pl-8 pr-2 py-1.5 text-xs text-white focus:border-blue-500 focus:bg-[#1A1A1A] outline-none transition-all" min={10} max={600} />
                  </div>
                </div>
              </div>

              {/* Subtitles Option */}
              <div>
                <label className="flex items-center justify-between cursor-pointer group">
                  <div>
                    <div className="text-[11px] font-bold text-gray-400 group-hover:text-gray-200 transition-colors uppercase tracking-wider">自动生成中英文字幕</div>
                    <div className="text-[10px] text-gray-600 mt-1">使用 Whisper 大模型生成高潮解说字幕</div>
                  </div>
                  <div className="relative inline-flex items-center shrink-0">
                    <input
                       type="checkbox"
                       className="sr-only peer"
                       checked={generateSubtitles}
                       onChange={(e) => setGenerateSubtitles(e.target.checked)}
                    />
                    <div className="w-9 h-5 bg-[#222] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-400 peer-checked:after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-500"></div>
                  </div>
                </label>
                {generateSubtitles && (
                  <div className="mt-3 bg-[#141414] border border-[#222] rounded-lg p-3 relative animate-in fade-in slide-in-from-top-2">
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
                )}
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
                        {AUTOCUT_SLICE_LLM_MODEL_OPTIONS.map((model) => (
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
    </div>
  );
}
