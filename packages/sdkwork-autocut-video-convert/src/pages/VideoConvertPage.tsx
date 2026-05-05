import { processVideoConvert } from '../service/videoConvertService';
import { useState, useEffect } from 'react';
import { Card, Button, FileUpload, TaskFailureState } from '@sdkwork/autocut-commons';

import { Upload, Settings, Play, RefreshCcw, Activity, Download, CheckCircle2 } from 'lucide-react';
import { useToast } from '@sdkwork/autocut-commons';
import { downloadAutoCutUrl, getTasks, listenAutoCutEvent, reportAutoCutDiagnostic } from '@sdkwork/autocut-services';
import { AUTOCUT_TASK_STATUS, isAutoCutTaskActiveStatus, type AppTask } from '@sdkwork/autocut-types';

export function VideoConvertPage() {
  const [file, setFile] = useState<File | null>(null);
  const [targetFormat, setTargetFormat] = useState('MP4');
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
      toast('您需要选择一个视频才能转换', 'error');
      return;
    }
    toast('视频转换协议正在启动...', 'info');
    try {
      const res = await processVideoConvert({ file, targetFormat, videoCodec: 'auto', audioCodec: 'auto', resolution: 'original' });
      if (res.success) {
        toast('转码任务排队中...', 'success');
        setActiveTaskId(res.taskId);
        setActiveTask(null);
      }
    } catch (e) {
      reportAutoCutDiagnostic('error', 'video-convert', 'Video conversion failed', e);
      toast('转换任务配置失败', 'error');
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
            <span className="w-2 h-6 bg-orange-500 rounded-full"></span>
            视频格式转换
          </h1>
          <p className="text-sm text-gray-500 mt-2 ml-5">在常见格式之间高速无损转码</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-6">
            <Card className="p-6 bg-[#0A0A0A] border-[#222]">
              <h2 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
                <Upload size={16} className="text-orange-500" />
                需要转码的源文件
              </h2>
              <FileUpload file={file} onChange={setFile} accept="video/*" maxSizeMB={5000} />
            </Card>

            <div className="bg-orange-500/5 border border-orange-500/10 rounded-xl p-4 flex gap-3 text-sm text-orange-400">
              <RefreshCcw size={20} className="shrink-0 mt-0.5" />
              <p>如果只是封装格式转换（例如 MKV 转 MP4），通常只需几秒钟并且完全不损伤画质。</p>
            </div>
          </div>

          <Card className="p-6 bg-[#0A0A0A] border-[#222] flex flex-col">
            <h2 className="text-sm font-semibold text-gray-300 mb-6 flex items-center gap-2">
              <Settings size={16} className="text-gray-400" />
              目标格式
            </h2>

            <div className="space-y-4 flex-1">
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                {['MP4', 'MKV', 'AVI', 'MOV', 'FLV', 'WEBM'].map(format => (
                  <button
                    key={format}
                    onClick={() => setTargetFormat(format)}
                    className={`py-3 rounded-xl border font-mono text-sm transition-all shadow-sm ${
                      targetFormat === format
                        ? 'bg-orange-600/10 border-orange-500/50 text-orange-400 shadow-orange-500/5'
                        : 'bg-[#111] border-[#333] text-gray-400 hover:border-[#555] hover:text-gray-200'
                    }`}
                  >
                    {format}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-[#222] flex justify-end">
              <Button
                onClick={handleProcess}
                disabled={!file || isProcessing}
                className={`flex items-center gap-2 px-6 ${file && !isProcessing ? 'bg-orange-600 hover:bg-orange-700 text-white border-0' : ''}`}
                variant={file && !isProcessing ? 'primary' : 'secondary'}
              >
                <Play size={16} />
                {(isProcessing && !activeTask) ? '提交中...' : '开始转换'}
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
                 <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-orange-500/5 rounded-full blur-[100px] pointer-events-none" />

                 <div className="relative z-10 flex flex-col items-center justify-center text-center p-12">
                   <div className="w-24 h-24 mb-8 rounded-3xl bg-[#151515] border border-[#222] shadow-[0_0_40px_rgba(249,115,22,0.15)] flex items-center justify-center relative inner-shadow">
                     <div className="absolute inset-0 bg-orange-500/10 rounded-3xl" />
                     <Activity size={40} className="text-orange-500 relative z-10 animate-pulse" />
                   </div>
                   <h2 className="text-2xl font-extrabold text-white mb-2 tracking-tight drop-shadow-sm">正在转换视频格式...</h2>
                   <p className="text-[14px] font-medium text-gray-400 mb-8 max-w-md">系统正在将视频转码为 {targetFormat} 格式</p>

                   <div className="w-64 h-2 bg-[#222] rounded-full overflow-hidden shadow-inner border border-[#333]">
                     <div className="h-full bg-orange-500 transition-all duration-300 relative shadow-[0_0_10px_rgba(249,115,22,0.8)]" style={{ width: `${activeTask?.progress || 0}%` }}></div>
                   </div>
                   <div className="mt-4 text-xs font-mono text-orange-400 font-bold">{activeTask?.progress || 0}%</div>
                 </div>
               </Card>
             ) : (
               activeTask?.status === AUTOCUT_TASK_STATUS.failed ? (
                  <TaskFailureState errorMessage={activeTask.errorMessage} onRetry={handleProcess} />
               ) : activeTask?.status === AUTOCUT_TASK_STATUS.completed && activeTask.videoUrl ? (
                  <Card className="flex flex-col items-center justify-center border-[#222] bg-[#111] overflow-hidden">
                    <div className="p-4 bg-[#151515] w-full border-b border-[#222] flex justify-between items-center">
                       <div className="flex items-center gap-3">
                         <div className="w-8 h-8 rounded-full bg-green-500/20 text-green-500 flex items-center justify-center">
                           <CheckCircle2 size={16} />
                         </div>
                         <span className="font-bold">转码完成</span>
                       </div>
                    </div>
                    <div className="w-full max-h-[60vh] bg-black flex items-center justify-center relative">
                      <video src={activeTask.videoUrl} controls className="w-full h-full max-h-[500px] object-contain" />
                    </div>
                    <div className="p-6 bg-[#151515] w-full border-t border-[#222] flex justify-center">
                       <Button onClick={() => handleDownload(activeTask.videoUrl, `${activeTask.name}_converted.${targetFormat.toLowerCase()}`)} size="lg" className="bg-orange-600 hover:bg-orange-500 text-white border-0">
                         <Download size={18} className="mr-2" /> 下载输出文件
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
