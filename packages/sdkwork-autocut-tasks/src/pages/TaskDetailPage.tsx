import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, PlayCircle, Play, Download, FolderOpen, Tag, CheckCircle2, Settings2, FileText, Music, Copy, ArrowRight, Activity, Zap } from 'lucide-react';
import { createAutoCutTextObjectUrl, downloadAutoCutUrl, downloadExtractedTextFile, formatAutoCutDateTime, formatExtractedText, getTasks, listenAutoCutEvent, openAutoCutPreviewUrl, revokeAutoCutObjectUrl, writeAutoCutClipboardText } from '@sdkwork/autocut-services';
import { Button, TaskFailureState } from '@sdkwork/autocut-commons';
import { AUTOCUT_TASK_STATUS, type AppTask, type TaskType } from '@sdkwork/autocut-types';

function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

const REPROCESS_ROUTES: Record<TaskType, string> = {
  '视频切片': '/slicer',
  '文案提取': '/extractor-text',
  '视频提音': '/extractor-audio',
  '视频转gif': '/video-gif',
  '视频压缩': '/video-compress',
  '视频格式转换': '/video-convert',
  '视频高清化': '/video-enhance',
  '视频字幕翻译': '/subtitle-translate',
  '视频人声翻译': '/voice-translate',
};

function getReprocessRoute(type: TaskType) {
  return REPROCESS_ROUTES[type];
}

function handleDownload(url: string | undefined, filename: string) {
  downloadAutoCutUrl(url, filename);
}

function downloadTaskExecutionResultFile(task: AppTask) {
  const content = [
    `Task: ${task.name}`,
    `Type: ${task.type}`,
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

export function TaskDetailPage() {
  const { taskId } = useParams();
  const navigate = useNavigate();

  const [task, setTask] = useState<AppTask | null>(null);
  const [activePreviewUrl, setActivePreviewUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSlicePreviewSelect = (sliceId: string) => {
    setActivePreviewUrl(sliceId);
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
      return <TaskFailureState errorMessage={task.errorMessage} />;
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

    if (task.type === '视频切片') {
      const sliceResults = task.sliceResults || [];
      const selectedSlice = sliceResults.find((slice) => slice.id === activePreviewUrl) ?? sliceResults[0] ?? null;
      return (
          <div className="flex flex-col xl:flex-row gap-6 h-full flex-1 min-h-0">
            {/* Left: File List */}
            <div className="w-full xl:w-[30%] flex flex-col border border-[#222] rounded-xl bg-[#111] overflow-hidden shrink-0">
              <div className="p-4 border-b border-[#222] bg-[#151515] flex justify-between items-center shrink-0">
                <h3 className="text-sm font-bold text-gray-200">生成的切片文件 ({task.resultCount || 0})</h3>
                <div className="flex items-center gap-2 text-xs text-gray-500">
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
                      <img src={slice.thumbnailUrl} alt="" className="w-full h-full object-cover opacity-60" />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
                         <PlayCircle size={24} className={activePreviewUrl === slice.id ? 'text-blue-400' : 'text-white'} />
                      </div>
                      <span className="absolute bottom-1 right-1 bg-black/80 px-1 rounded text-[9px] font-mono text-gray-300">
                        00:{String(slice.duration).padStart(2, '0')}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col justify-center">
                      <h4 className={`text-sm font-medium truncate ${activePreviewUrl === slice.id ? 'text-blue-400' : 'text-gray-200'}`}>
                        {slice.name}
                      </h4>
                      <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-500">
                        <span className="flex items-center gap-1"><Tag size={10} /> 智能提取</span>
                        <span>{formatBytes(slice.size)}</span>
                        <span className="bg-[#333] px-1 rounded">{slice.resolution}</span>
                      </div>
                    </div>
                    <div className="shrink-0 flex items-center">
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
            <div className="flex-1 bg-[#111] rounded-xl border border-[#222] flex flex-col items-center justify-center relative overflow-hidden group">
               {selectedSlice ? (
                 <div className="w-full h-full flex flex-col">
                   <div className="flex-1 bg-black w-full relative flex items-center justify-center">
                     <div className="absolute top-4 left-4 z-10 px-3 py-1.5 bg-black/60 backdrop-blur-md rounded border border-white/10 flex items-center gap-2">
                       <CheckCircle2 size={14} className="text-blue-400" />
                       <span className="text-[11px] text-white">正在预览: {selectedSlice.name}</span>
                     </div>
                     <video
                       key={selectedSlice.id}
                       src={selectedSlice.url}
                       className="w-full h-full max-h-full object-contain"
                       controls
                       autoPlay
                     />
                   </div>
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

    if (task.type === '文案提取' && task.extractedText) {
      return (
        <div className="flex-1 flex flex-col bg-[#111] border border-[#222] rounded-xl overflow-hidden relative">
          <div className="absolute top-0 right-0 p-4 shrink-0 flex gap-2">
             <Button onClick={() => {
               const text = formatExtractedText(task.extractedText);
               void writeAutoCutClipboardText(text);
               setCopied(true);
               setTimeout(() => setCopied(false), 2000);
             }} variant="outline" className="text-xs">
               <Copy size={14} className="mr-2" /> {copied ? '已复制' : '复制全文'}
             </Button>
             <Button onClick={() => {
               downloadExtractedTextFile(task.extractedText, `${task.name}.txt`);
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

    if (task.type === '视频转gif' && task.gifUrl) {
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

    if (task.type === '视频提音' && task.audioUrl) {
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

    if (task.type === '视频压缩' && task.fileSizeStats && task.videoUrl) {
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
          <div className="w-full h-full max-h-[60vh] bg-black flex items-center justify-center relative">
            <video src={task.videoUrl} controls autoPlay className="w-full h-full object-contain" />
          </div>
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
              <Button className="mt-4" variant="outline" onClick={() => downloadTaskExecutionResultFile(task)}>下载执行结果 ({task.resultCount})</Button>
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
              <span>任务类型: <span className="text-gray-300 font-bold">{task.type}</span></span>
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
