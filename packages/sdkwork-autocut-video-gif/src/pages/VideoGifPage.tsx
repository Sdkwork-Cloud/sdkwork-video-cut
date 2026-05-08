import { processVideoGif } from '../service/videoGifService';
import { useState, useEffect } from 'react';
import { Card, Button, FileUpload, TaskFailureState } from '@sdkwork/autocut-commons';

import { Upload, Settings, Play, Image as ImageIcon, Activity, Download } from 'lucide-react';
import { useToast } from '@sdkwork/autocut-commons';
import { downloadAutoCutUrl, getAutoCutProcessingTaskErrorTaskId, getTasks, listenAutoCutEvent, reportAutoCutDiagnostic, selectAutoCutTrustedLocalMediaFile, writeAutoCutClipboardText } from '@sdkwork/autocut-services';
import { AUTOCUT_TASK_STATUS, isAutoCutTaskActiveStatus, type AppTask } from '@sdkwork/autocut-types';

export function VideoGifPage() {
  const [file, setFile] = useState<File | null>(null);
  const [fps, setFps] = useState('15');
  const [resolution, setResolution] = useState('480p');
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
      toast('您还需要上传一个视频', 'error');
      return;
    }
    toast('视频转GIF处理器已准备就绪', 'info');
    try {
      const res = await processVideoGif({ file, fps, resolution, dither: true });
      if (res.success) {
        toast('任务交由云端编码集群处理...', 'success');
        setActiveTaskId(res.taskId);
        setActiveTask(null);
      }
    } catch (e) {
      const failedTaskId = getAutoCutProcessingTaskErrorTaskId(e);
      if (failedTaskId) {
        setActiveTaskId(failedTaskId);
        setActiveTask(null);
      }
      reportAutoCutDiagnostic('error', 'video-gif', 'Video GIF processing failed', e);
      toast('GIF转码生成失败', 'error');
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
            <span className="w-2 h-6 bg-pink-500 rounded-full"></span>
            视频转GIF
          </h1>
          <p className="text-sm text-gray-500 mt-2 ml-5">将视频片段快速转换为高质量的动图，方便网络分享与传播</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-6">
            <Card className="p-6 bg-[#0A0A0A] border-[#222]">
              <h2 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
                <Upload size={16} className="text-pink-500" />
                源视频文件
              </h2>
              <FileUpload
                file={file}
                onChange={setFile}
                accept="video/*"
                trustedFileSourceSelector={() => selectAutoCutTrustedLocalMediaFile(['video'])}
              />
            </Card>

            <div className="bg-pink-500/5 border border-pink-500/10 rounded-xl p-4 flex gap-3 text-sm text-pink-400">
              <ImageIcon size={20} className="shrink-0 mt-0.5" />
              <p>GIF 动图非常适合在社交媒体、即时通讯软件中分享。降低帧率或分辨率可以显著减小文件体积。</p>
            </div>
          </div>

          <Card className="p-6 bg-[#0A0A0A] border-[#222] flex flex-col">
            <h2 className="text-sm font-semibold text-gray-300 mb-6 flex items-center gap-2">
              <Settings size={16} className="text-gray-400" />
              GIF 编码设置
            </h2>

            <div className="space-y-6 flex-1">
              {/* FPS Control */}
              <div className="space-y-3">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">帧率 (FPS)</label>
                <div className="grid grid-cols-3 gap-2">
                  {['10', '15', '24'].map(val => (
                    <button
                      key={val}
                      onClick={() => setFps(val)}
                      className={`py-2 rounded-lg text-sm transition-colors border ${
                        fps === val
                          ? 'bg-pink-600/20 border-pink-500/50 text-pink-300'
                          : 'bg-[#111] border-[#333] text-gray-400 hover:border-gray-500'
                      }`}
                    >
                      {val} fps
                    </button>
                  ))}
                </div>
              </div>

              {/* Resolution Control */}
              <div className="space-y-3">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">画质 / 分辨率</label>
                <div className="grid grid-cols-3 gap-2">
                  {['320p', '480p', '720p'].map(val => (
                    <button
                      key={val}
                      onClick={() => setResolution(val)}
                      className={`py-2 rounded-lg text-sm transition-colors border ${
                        resolution === val
                          ? 'bg-pink-600/20 border-pink-500/50 text-pink-300'
                          : 'bg-[#111] border-[#333] text-gray-400 hover:border-gray-500'
                      }`}
                    >
                      {val}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-[#222] flex justify-end">
              <Button
                onClick={handleProcess}
                disabled={!file || isProcessing}
                className={`flex items-center gap-2 px-6 ${file && !isProcessing ? 'bg-pink-600 hover:bg-pink-700 text-white border-0' : ''}`}
                variant={file && !isProcessing ? 'primary' : 'secondary'}
              >
                <Play size={16} />
                {(isProcessing && !activeTask) ? '提交中...' : '生成 GIF'}
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
                 <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-pink-500/5 rounded-full blur-[100px] pointer-events-none" />

                 <div className="relative z-10 flex flex-col items-center justify-center text-center p-12">
                   <div className="w-24 h-24 mb-8 rounded-3xl bg-[#151515] border border-[#222] shadow-[0_0_40px_rgba(236,72,153,0.15)] flex items-center justify-center relative inner-shadow">
                     <div className="absolute inset-0 bg-pink-500/10 rounded-3xl" />
                     <Activity size={40} className="text-pink-500 relative z-10 animate-pulse" />
                   </div>
                   <h2 className="text-2xl font-extrabold text-white mb-2 tracking-tight drop-shadow-sm">正在生成动图...</h2>
                   <p className="text-[14px] font-medium text-gray-400 mb-8 max-w-md">系统正在按照指定的帧率和分辨率提取画面并进行编码，请稍候</p>

                   <div className="w-64 h-2 bg-[#222] rounded-full overflow-hidden shadow-inner border border-[#333]">
                     <div className="h-full bg-pink-500 transition-all duration-300 relative shadow-[0_0_10px_rgba(236,72,153,0.8)]" style={{ width: `${activeTask?.progress || 0}%` }}></div>
                   </div>
                   <div className="mt-4 text-xs font-mono text-pink-400 font-bold">{activeTask?.progress || 0}%</div>
                 </div>
               </Card>
             ) : (
               activeTask?.status === AUTOCUT_TASK_STATUS.failed ? (
                  <TaskFailureState
                    errorMessage={activeTask.errorMessage}
                    onCopyErrorMessage={writeAutoCutClipboardText}
                    onRetry={handleProcess}
                  />
               ) : activeTask?.status === AUTOCUT_TASK_STATUS.completed && activeTask.gifUrl ? (
                  <Card className="p-10 flex flex-col items-center justify-center border-[#222] bg-[#111]">
                    <div className="bg-[#1A1A1A] p-4 rounded-xl border border-[#333] shadow-xl max-w-xl w-full">
                      <img src={activeTask.gifUrl} alt="Generated GIF" className="w-full rounded bg-black object-contain h-auto max-h-[400px]" />
                    </div>
                    <Button onClick={() => handleDownload(activeTask.gifUrl, `${activeTask.name}.gif`)} className="mt-8 px-8 bg-pink-600 hover:bg-pink-500 text-white border-0" size="lg">
                       <Download size={18} className="mr-2" /> 下载 GIF
                    </Button>
                  </Card>
               ) : null
             )}
          </div>
        )}
      </div>
    </div>
  );
}
