import { processVideoEnhance } from '../service/videoEnhanceService';
import { useState, useEffect } from 'react';
import { Card, Button, FileUpload, TaskFailureState, useAutoCutCommonLabels, useToast } from '@sdkwork/autocut-commons';

import { Upload, Settings, Play, Monitor, Activity, Download, CheckCircle2 } from 'lucide-react';
import { downloadAutoCutUrl, getAutoCutProcessingTaskErrorTaskId, getTasks, listenAutoCutEvent, reportAutoCutDiagnostic, selectAutoCutTrustedLocalMediaFile, writeAutoCutClipboardText } from '@sdkwork/autocut-services';
import { AUTOCUT_TASK_STATUS, isAutoCutTaskActiveStatus, type AppTask } from '@sdkwork/autocut-types';

export function VideoEnhancePage() {
  const commonLabels = useAutoCutCommonLabels();
  const [file, setFile] = useState<File | null>(null);
  const [targetResolution, setTargetResolution] = useState('1080p');
  const [enhanceModel, setEnhanceModel] = useState('anime');
  const { toast } = useToast();

  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<AppTask | null>(null);

  useEffect(() => {
    if (!activeTaskId) return;
    const fetchTask = () => {
      getTasks().then(tasks => {
        const t = tasks.find(x => x.id === activeTaskId);
        if (t) setActiveTask(t);
      }).catch(() => {});
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
      toast('需要上传视频素材', 'error');
      return;
    }
    toast('视频增强超分服务启动...', 'info');
    try {
      const res = await processVideoEnhance({ file, targetResolution, enhanceMode: enhanceModel, frameRate: 'original' });
      if (res.success) {
        toast('超分模型正在处理任务中...', 'success');
        setActiveTaskId(res.taskId);
        setActiveTask(null);
      }
    } catch (e) {
      const failedTaskId = getAutoCutProcessingTaskErrorTaskId(e);
      if (failedTaskId) {
        setActiveTaskId(failedTaskId);
        setActiveTask(null);
      }
      reportAutoCutDiagnostic('error', 'video-enhance', 'Video enhancement failed', e);
      toast('无法连接到增强引擎节点', 'error');
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
            <span className="w-2 h-6 bg-cyan-500 rounded-full"></span>
            视频高清化
          </h1>
          <p className="text-sm text-gray-500 mt-2 ml-5">基于深度学习技术，提升视频分辨率与清晰度</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-6">
            <Card className="p-6 bg-[#0A0A0A] border-[#222]">
              <h2 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
                <Upload size={16} className="text-cyan-500" />
                需要增强的视频
              </h2>
              <FileUpload
                file={file}
                onChange={setFile}
                accept="video/*"
                labels={commonLabels.fileUpload}
                requiredStreams={{ video: true }}
                trustedFileSourceSelector={() => selectAutoCutTrustedLocalMediaFile(['video'])}
              />
            </Card>

            <div className="bg-cyan-500/5 border border-cyan-500/10 rounded-xl p-4 flex gap-3 text-sm text-cyan-400">
              <Monitor size={20} className="shrink-0 mt-0.5" />
              <p>AI 超分算法会消耗大量的计算资源。一段 5 分钟的视频可能需要 30 分钟到 1 小时才能处理完成，请耐心等待任务结束。</p>
            </div>
          </div>

          <Card className="p-6 bg-[#0A0A0A] border-[#222] flex flex-col">
            <h2 className="text-sm font-semibold text-gray-300 mb-6 flex items-center gap-2">
              <Settings size={16} className="text-gray-400" />
              增强选项
            </h2>

            <div className="space-y-6 flex-1">
              <div className="space-y-3">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">目标分辨率</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: '1080p', label: '1080P 超清' },
                    { id: '2k', label: '2K 极清' },
                    { id: '4k', label: '4K 影院级' },
                  ].map(res => (
                    <button
                      key={res.id}
                      onClick={() => setTargetResolution(res.id)}
                      className={`py-3 px-4 rounded-xl text-sm transition-all border text-left flex justify-between items-center ${
                        targetResolution === res.id
                          ? 'bg-cyan-600/10 border-cyan-500/50 text-cyan-400 shadow-cyan-500/5'
                          : 'bg-[#111] border-[#333] text-gray-400 hover:border-[#555]'
                      }`}
                    >
                      <span className="font-semibold">{res.id.toUpperCase()}</span>
                      <span className="text-xs opacity-60 font-normal hidden sm:inline">{res.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">增强模型</label>
                <select value={enhanceModel} onChange={e => setEnhanceModel(e.target.value)} className="w-full bg-[#111] border border-[#333] focus:border-cyan-500 text-sm rounded-xl py-3 px-4 outline-none text-white transition-colors appearance-none">
                  <option value="anime">二次元/动漫专属模型 (Real-ESRGAN-Anime)</option>
                  <option value="real">真人/实景超分模型 (Real-ESRGAN-V3)</option>
                  <option value="face">人脸特别增强模型 (GFPGAN)</option>
                </select>
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-[#222] flex justify-end">
              <Button
                onClick={handleProcess}
                disabled={!file || isProcessing}
                className={`flex items-center gap-2 px-6 ${file && !isProcessing ? 'bg-cyan-600 hover:bg-cyan-700 text-white border-0' : ''}`}
                variant={file && !isProcessing ? 'primary' : 'secondary'}
              >
                <Play size={16} />
                {(isProcessing && !activeTask) ? '提交中...' : '开始增强'}
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
                 <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-cyan-500/5 rounded-full blur-[100px] pointer-events-none" />

                 <div className="relative z-10 flex flex-col items-center justify-center text-center p-12">
                   <div className="w-24 h-24 mb-8 rounded-3xl bg-[#151515] border border-[#222] shadow-[0_0_40px_rgba(6,182,212,0.15)] flex items-center justify-center relative inner-shadow">
                     <div className="absolute inset-0 bg-cyan-500/10 rounded-3xl" />
                     <Activity size={40} className="text-cyan-500 relative z-10 animate-pulse" />
                   </div>
                   <h2 className="text-2xl font-extrabold text-white mb-2 tracking-tight drop-shadow-sm">正在进行视频高清化...</h2>
                   <p className="text-[14px] font-medium text-gray-400 mb-8 max-w-md">系统正在使用AI模型增强画质并提升分辨率，请耐心等待</p>

                   <div className="w-64 h-2 bg-[#222] rounded-full overflow-hidden shadow-inner border border-[#333]">
                     <div className="h-full bg-cyan-500 transition-all duration-300 relative shadow-[0_0_10px_rgba(6,182,212,0.8)]" style={{ width: `${activeTask?.progress || 0}%` }}></div>
                   </div>
                   <div className="mt-4 text-xs font-mono text-cyan-400 font-bold">{activeTask?.progress || 0}%</div>
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
               ) : activeTask?.status === AUTOCUT_TASK_STATUS.completed && activeTask.videoUrl ? (
                  <Card className="flex flex-col items-center justify-center border-[#222] bg-[#111] overflow-hidden">
                    <div className="p-4 bg-[#151515] w-full border-b border-[#222] flex justify-between items-center">
                       <div className="flex items-center gap-3">
                         <div className="w-8 h-8 rounded-full bg-green-500/20 text-green-500 flex items-center justify-center">
                           <CheckCircle2 size={16} />
                         </div>
                         <span className="font-bold">视频增强完成</span>
                       </div>
                    </div>
                    <div className="w-full max-h-[60vh] bg-black flex items-center justify-center relative">
                      <video src={activeTask.videoUrl} controls className="w-full h-full max-h-[500px] object-contain" />
                    </div>
                    <div className="p-6 bg-[#151515] w-full border-t border-[#222] flex justify-center">
                       <Button onClick={() => handleDownload(activeTask.videoUrl, `${activeTask.name}_enhanced.mp4`)} size="lg" className="bg-cyan-600 hover:bg-cyan-500 text-white border-0">
                         <Download size={18} className="mr-2" /> 下载高清视频
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
