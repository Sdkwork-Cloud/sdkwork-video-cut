import { processVideoCompress } from '../service/videoCompressService';
import { useState, useEffect } from 'react';
import { Card, Button, FileUpload, TaskFailureState, useAutoCutCommonLabels, useToast } from '@sdkwork/autocut-commons';

import { Upload, Settings, Play, Minimize2, Activity, ArrowRight, Download, Zap } from 'lucide-react';
import { downloadAutoCutUrl, getAutoCutProcessingTaskErrorTaskId, getTasks, listenAutoCutEvent, openAutoCutPreviewUrl, reportAutoCutDiagnostic, selectAutoCutTrustedLocalMediaFile, writeAutoCutClipboardText } from '@sdkwork/autocut-services';
import { AUTOCUT_TASK_STATUS, isAutoCutTaskActiveStatus, type AppTask } from '@sdkwork/autocut-types';

function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function VideoCompressPage() {
  const commonLabels = useAutoCutCommonLabels();
  const [file, setFile] = useState<File | null>(null);
  const [compressionMode, setCompressionMode] = useState('balanced');
  const { toast } = useToast();

  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<AppTask | null>(null);

  useEffect(() => {
    if (!activeTaskId) return;
    const fetchTask = () => {
      getTasks().then(tasks => {
        const t = tasks.find(x => x.id === activeTaskId);
        if (t) setActiveTask(t);
      });
    };
    fetchTask();
        const handleUpdate = (task: AppTask) => {
      if (task.id === activeTaskId) {
        setActiveTask(task);
      }
    };
    return listenAutoCutEvent('taskUpdated', handleUpdate);
  }, [activeTaskId]);

  const handleProcess = async () => {
    if (!file) {
      toast('请先选择需要压缩的视频', 'error');
      return;
    }
    toast('正在计算最优压缩比路...', 'info');
    try {
      const res = await processVideoCompress({ file, compressionMode });
      if (res.success) {
        toast('任务交由云端压缩集群处理中...', 'success');
        setActiveTaskId(res.taskId);
        setActiveTask(null);
      }
    } catch (e) {
      const failedTaskId = getAutoCutProcessingTaskErrorTaskId(e);
      if (failedTaskId) {
        setActiveTaskId(failedTaskId);
        setActiveTask(null);
      }
      reportAutoCutDiagnostic('error', 'video-compress', 'Video compression failed', e);
      toast('压缩服务通信故障', 'error');
    }
  };

  const isProcessing = Boolean(activeTaskId) && (!activeTask || isAutoCutTaskActiveStatus(activeTask.status));

  const handleDownload = (url: string | undefined, filename: string) => {
    downloadAutoCutUrl(url, filename);
  };

  return (
    <div className="w-full h-full p-6 md:p-10 flex flex-col items-center overflow-y-auto custom-scrollbar">
      <div className="w-full flex flex-col space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div>
          <h1 className="text-2xl font-bold text-gray-100 flex items-center gap-3">
            <span className="w-2 h-6 bg-green-500 rounded-full"></span>
            视频压缩
          </h1>
          <p className="text-sm text-gray-500 mt-2 ml-5">智能压缩视频文件大小，同时最大程度保留画质</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-6">
            <Card className="p-6 bg-[#0A0A0A] border-[#222]">
              <h2 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
                <Upload size={16} className="text-green-500" />
                需要压缩的视频
              </h2>
              <FileUpload
                file={file}
                onChange={setFile}
                accept="video/*"
                maxSizeMB={5000}
                labels={commonLabels.fileUpload}
                requiredStreams={{ video: true }}
                trustedFileSourceSelector={() => selectAutoCutTrustedLocalMediaFile(['video'])}
              />
            </Card>

            <div className="bg-green-500/5 border border-green-500/10 rounded-xl p-4 flex gap-3 text-sm text-green-400">
              <Minimize2 size={20} className="shrink-0 mt-0.5" />
              <p>采用下一代超高压引擎（H.265/HEVC），在体积减少 50% 以上的同时裸眼无法区分画质损失。</p>
            </div>
          </div>

          <Card className="p-6 bg-[#0A0A0A] border-[#222] flex flex-col">
            <h2 className="text-sm font-semibold text-gray-300 mb-6 flex items-center gap-2">
              <Settings size={16} className="text-gray-400" />
              压缩策略
            </h2>

            <div className="space-y-4 flex-1">
              {[
                { id: 'quality', label: '画质优先', desc: '文件减小 20%~40%，适合存档' },
                { id: 'balanced', label: '均衡模式', desc: '文件减小 40%~60%，建议日常使用' },
                { id: 'extreme', label: '极限压缩', desc: '文件减小 70%以上，适合低速网络传输' }
              ].map(mode => (
                <div
                  key={mode.id}
                  onClick={() => setCompressionMode(mode.id)}
                  className={`p-4 rounded-xl border transition-all cursor-pointer ${
                    compressionMode === mode.id
                      ? 'bg-green-600/10 border-green-500/50'
                      : 'bg-[#111] border-[#333] hover:border-[#555]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <h3 className={`font-medium ${compressionMode === mode.id ? 'text-green-400' : 'text-gray-300'}`}>
                      {mode.label}
                    </h3>
                    <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                      compressionMode === mode.id ? 'border-green-500' : 'border-gray-500'
                    }`}>
                      {compressionMode === mode.id && <div className="w-2 h-2 bg-green-500 rounded-full" />}
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{mode.desc}</p>
                </div>
              ))}
            </div>

            <div className="mt-8 pt-6 border-t border-[#222] flex justify-end">
              <Button
                onClick={handleProcess}
                disabled={!file || isProcessing}
                className={`flex items-center gap-2 px-6 ${file && !isProcessing ? 'bg-green-600 hover:bg-green-700 text-white' : ''}`}
                variant={file && !isProcessing ? 'primary' : 'secondary'}
              >
                <Play size={16} />
                {(isProcessing && !activeTask) ? '提交中...' : '开始压缩'}
              </Button>
            </div>
          </Card>
        </div>

        {/* Task Processing / Result Area */}
        {activeTaskId && (
          <div className="w-full mt-6 animate-in fade-in slide-in-from-bottom-2">
             {isProcessing ? (
               <Card className="flex-1 flex flex-col items-center justify-center relative overflow-hidden bg-gradient-to-br from-[#0A0A0A] to-[#111] border-[#222]">
                 <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] pointer-events-none"></div>
                 <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-green-500/5 rounded-full blur-[100px] pointer-events-none" />

                 <div className="relative z-10 flex flex-col items-center justify-center text-center p-12">
                   <div className="w-24 h-24 mb-8 rounded-3xl bg-[#151515] border border-[#222] shadow-[0_0_40px_rgba(34,197,94,0.15)] flex items-center justify-center relative inner-shadow">
                     <div className="absolute inset-0 bg-green-500/10 rounded-3xl" />
                     <Activity size={40} className="text-green-500 relative z-10 animate-pulse" />
                   </div>
                   <h2 className="text-2xl font-extrabold text-white mb-2 tracking-tight drop-shadow-sm">正在压缩视频...</h2>
                   <p className="text-[14px] font-medium text-gray-400 mb-8 max-w-md">系统正在使用高效算法减少文件体积，请耐心等待</p>

                   <div className="w-64 h-2 bg-[#222] rounded-full overflow-hidden shadow-inner border border-[#333]">
                     <div className="h-full bg-green-500 transition-all duration-300 relative shadow-[0_0_10px_rgba(34,197,94,0.8)]" style={{ width: `${activeTask?.progress || 0}%` }}></div>
                   </div>
                   <div className="mt-4 text-xs font-mono text-green-400 font-bold">{activeTask?.progress || 0}%</div>
                 </div>
               </Card>
             ) : (
               activeTask?.status === AUTOCUT_TASK_STATUS.failed ? (
                 <TaskFailureState
                   errorMessage={activeTask.errorMessage}
                   onCopyErrorMessage={writeAutoCutClipboardText}
                   onRetry={handleProcess}
                   labels={commonLabels.taskFailure}
                 />
               ) : activeTask?.status === AUTOCUT_TASK_STATUS.completed && activeTask.fileSizeStats && activeTask.videoUrl ? (
                 <Card className="p-10 flex flex-col items-center justify-center border-[#222] bg-[#111]">
                   <Zap size={48} className="text-yellow-500 mb-6" />
                   <h2 className="text-2xl font-bold mb-8">压缩成功！体积减小了 {activeTask.fileSizeStats.compressionRatio}%</h2>

                   <div className="flex items-center gap-8 mb-10 w-full max-w-md justify-center">
                     <div className="flex flex-col items-center pb-4 border-b-2 border-[#333] flex-1">
                       <span className="text-sm text-gray-500 mb-1">原始大小</span>
                       <span className="text-xl font-bold text-gray-300">{formatBytes(activeTask.fileSizeStats.originalSize)}</span>
                     </div>
                     <ArrowRight className="text-gray-600 shrink-0" />
                     <div className="flex flex-col items-center pb-4 border-b-2 border-yellow-500 flex-1">
                       <span className="text-sm text-yellow-500 mb-1">压缩后大小</span>
                       <span className="text-3xl font-bold text-white">{formatBytes(activeTask.fileSizeStats.newSize)}</span>
                     </div>
                   </div>

                   <div className="flex gap-4">
                     <Button variant="outline" onClick={() => openAutoCutPreviewUrl(activeTask.videoUrl)} size="lg">预览视频</Button>
                     <Button onClick={() => handleDownload(activeTask.videoUrl, `${activeTask.name}_compressed.mp4`)} size="lg" className="bg-green-600 hover:bg-green-500 text-white border-0">
                        <Download size={18} className="mr-2" /> 下载压缩视频
                     </Button>
                   </div>
                 </Card>
               ) : null
             )}
          </div>
        )}
      </div>
    </div>
  );
}
