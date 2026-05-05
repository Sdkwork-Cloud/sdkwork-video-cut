import { processAudioExtraction } from '../service/audioExtractorService';
import { useState, useEffect } from 'react';
import { Music, Download, PlayCircle, Waves, Activity } from 'lucide-react';
import { FileUpload, Button, TaskFailureState } from '@sdkwork/autocut-commons';
import { useToast } from '@sdkwork/autocut-commons';
import { downloadAutoCutUrl, getTasks, listenAutoCutEvent } from '@sdkwork/autocut-services';
import { AUTOCUT_TASK_STATUS, isAutoCutTaskActiveStatus, type AppTask } from '@sdkwork/autocut-types';

export function AudioExtractorPage() {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState('mp3');
  const [quality, setQuality] = useState('320');
  const [smartVolume, setSmartVolume] = useState(true);

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

  const handleStartProcess = async () => {
    toast('音频提取任务已创建', 'info');
    try {
      const res = await processAudioExtraction({ file, format, quality, channel: smartVolume ? 'smart-stereo' : 'stereo' });
      if (res.success) {
        toast('任务提交流程完毕，正在云端解析中...', 'success');
        setActiveTaskId(res.taskId);
        setActiveTask(null);
      }
    } catch(e) {
      toast('音频提取环境异常，服务处理失败', 'error');
    }
  };

  const isProcessing = Boolean(activeTaskId) && (!activeTask || isAutoCutTaskActiveStatus(activeTask.status));

  const handleDownload = () => {
    downloadAutoCutUrl(activeTask?.audioUrl, `${activeTask?.name}.${format}`);
  };

  return (
    <div className="h-full flex flex-col bg-[#050505] text-gray-200">
      <div className="h-16 shrink-0 border-b border-[#222] flex items-center px-6 justify-between bg-[#111]">
        <div className="flex items-center gap-3">
          <Music className="text-pink-500" size={24} />
          <h1 className="text-lg font-bold tracking-wider text-white">音频无损提取</h1>
          <span className="text-[10px] bg-pink-500/20 text-pink-400 px-2 py-0.5 rounded-full outline outline-1 outline-pink-500/30">专业音频处理</span>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left config panel */}
        <div className="w-[420px] shrink-0 border-r border-[#222] bg-[#0A0A0A] flex flex-col overflow-y-auto custom-scrollbar">
          <div className="p-6 pb-2">
            <h2 className="text-xs uppercase tracking-widest text-gray-500 mb-4 font-bold flex items-center gap-2">
               <span className="w-1 h-3 bg-pink-500 rounded-full"></span>
               选择源视频
            </h2>

            <FileUpload file={file} onChange={setFile} accept="video/*" maxSizeMB={500} />
          </div>

          <div className="p-6">
             <h2 className="text-xs uppercase tracking-widest text-gray-500 mb-4 font-bold flex items-center gap-2">
               <span className="w-1 h-3 bg-pink-500 rounded-full"></span>
               输出配置
             </h2>

             <div className="space-y-6">
                <div>
                  <label className="block text-[11px] font-bold text-gray-500 mb-2 uppercase">输出格式</label>
                  <select value={format} onChange={e => setFormat(e.target.value)} className="w-full bg-[#141414] border border-[#222] rounded-lg px-3 py-2.5 text-xs text-white focus:border-pink-500 outline-none transition-all">
                    <option value="mp3">MP3 (高压缩, 体积小)</option>
                    <option value="wav">WAV (无损, 原音质)</option>
                    <option value="flac">FLAC (无损压缩)</option>
                    <option value="aac">AAC (更高压缩率)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-gray-500 mb-2 uppercase">比特率 (音质)</label>
                  <select value={quality} onChange={e => setQuality(e.target.value)} className="w-full bg-[#141414] border border-[#222] rounded-lg px-3 py-2.5 text-xs text-white focus:border-pink-500 outline-none transition-all">
                    <option value="320">320 kbps (最高品质)</option>
                    <option value="256">256 kbps (高品质)</option>
                    <option value="192">192 kbps (标准)</option>
                    <option value="128">128 kbps (网络推荐)</option>
                  </select>
                </div>

                <div>
                  <label className="flex items-center justify-between cursor-pointer group">
                    <div>
                      <div className="text-[11px] font-bold text-gray-400 group-hover:text-gray-200 transition-colors uppercase">智能音量均衡</div>
                      <div className="text-[10px] text-gray-600 mt-1">自动平衡全片音量大小</div>
                    </div>
                    <div className="relative inline-flex items-center">
                      <input type="checkbox" checked={smartVolume} onChange={e => setSmartVolume(e.target.checked)} className="sr-only peer" />
                      <div className="w-9 h-5 bg-[#222] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-400 peer-checked:after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-pink-500"></div>
                    </div>
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-[#141414] border border-[#222] rounded-lg p-3 cursor-pointer hover:border-pink-500/50 transition-colors">
                     <span className="text-[11px] font-bold text-gray-400 block mb-1">淡入效果</span>
                     <span className="text-white text-xs">无</span>
                  </div>
                  <div className="bg-[#141414] border border-[#222] rounded-lg p-3 cursor-pointer hover:border-pink-500/50 transition-colors">
                     <span className="text-[11px] font-bold text-gray-400 block mb-1">淡出效果</span>
                     <span className="text-white text-xs">自动计算</span>
                  </div>
                </div>
             </div>
          </div>

          <div className="p-6 mt-auto">
            <button
              onClick={handleStartProcess}
              disabled={!file || isProcessing}
              className="w-full bg-pink-600 hover:bg-pink-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-xl shadow-lg shadow-pink-900/20 transition-all flex items-center justify-center gap-2 tracking-wide"
            >
              {isProcessing ? (
                 <>提交中 <span className="animate-pulse">...</span></>
              ) : (
                 <><PlayCircle size={18} /> 开始提取</>
              )}
            </button>
          </div>
        </div>

        {/* Right workspace */}
        <div className="flex-1 flex flex-col relative bg-[#090909]">
          {!activeTaskId && (
            <div className="flex-1 flex flex-col justify-center items-center relative overflow-hidden bg-gradient-to-br from-[#0A0A0A] to-[#111]">
              <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] pointer-events-none"></div>
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-pink-500/5 rounded-full blur-[100px] pointer-events-none" />

              <div className="relative z-10 flex flex-col items-center justify-center text-center max-w-xl mx-auto px-6">
                <div className="w-24 h-24 mb-8 rounded-3xl bg-[#151515] border border-[#222] shadow-[0_0_40px_rgba(236,72,153,0.15)] flex items-center justify-center relative inner-shadow">
                  <div className="absolute inset-0 bg-pink-500/10 rounded-3xl" />
                  <Waves size={40} className="text-pink-500 relative z-10 animate-pulse" />
                </div>
                <h3 className="text-3xl font-extrabold mb-4 tracking-tight text-white drop-shadow-sm">最高保真度剥离引擎</h3>
                <p className="text-[15px] font-medium text-gray-400 leading-relaxed max-w-md">
                  直接从视频容器中无损剥离音频轨道，可自定超高比特率和专业级音量均衡。支持批量处理和格式转换。
                </p>
              </div>
            </div>
          )}

          {isProcessing && (
            <div className="flex-1 flex flex-col items-center justify-center relative overflow-hidden bg-gradient-to-br from-[#0A0A0A] to-[#111]">
               <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] pointer-events-none"></div>
               <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-pink-500/5 rounded-full blur-[100px] pointer-events-none" />

               <div className="relative z-10 flex flex-col items-center justify-center text-center p-12">
                 <div className="w-24 h-24 mb-8 rounded-3xl bg-[#151515] border border-[#222] shadow-[0_0_40px_rgba(236,72,153,0.15)] flex items-center justify-center relative inner-shadow">
                   <div className="absolute inset-0 bg-pink-500/10 rounded-3xl" />
                   <Activity size={40} className="text-pink-500 relative z-10 animate-pulse" />
                 </div>
                 <h2 className="text-2xl font-extrabold text-white mb-2 tracking-tight drop-shadow-sm">正在提取音频...</h2>
                 <p className="text-[14px] font-medium text-gray-400 mb-8 max-w-md">系统正在从视频中无损剥离音频轨道</p>

                 <div className="w-64 h-2 bg-[#222] rounded-full overflow-hidden shadow-inner border border-[#333]">
                   <div className="h-full bg-pink-500 transition-all duration-300 relative shadow-[0_0_10px_rgba(236,72,153,0.8)]" style={{ width: `${activeTask?.progress || 0}%` }}></div>
                 </div>
                 <div className="mt-4 text-xs font-mono text-pink-400 font-bold">{activeTask?.progress || 0}%</div>
               </div>
            </div>
          )}

          {activeTask?.status === AUTOCUT_TASK_STATUS.completed && activeTask.audioUrl && (
            <div className="flex-1 flex flex-col items-center justify-center bg-[#111]">
              <div className="w-20 h-20 bg-pink-500/20 text-pink-500 rounded-full flex items-center justify-center mb-8">
                 <Music size={32} />
              </div>
              <div className="bg-black/40 p-6 rounded-2xl border border-[#222] max-w-md w-full backdrop-blur-sm shadow-xl">
                 <h3 className="text-sm text-gray-400 mb-4 font-medium text-center truncate">{activeTask.name} - 提取完成</h3>
                 <audio src={activeTask.audioUrl} controls className="w-full outline-none" />
                 <div className="mt-6 flex justify-center">
                   <Button onClick={handleDownload} className="w-full bg-pink-600 hover:bg-pink-500" size="lg">
                     <Download size={16} className="mr-2" /> 下载音频文件
                   </Button>
                 </div>
              </div>
            </div>
          )}

          {activeTask?.status === AUTOCUT_TASK_STATUS.failed && (
            <TaskFailureState errorMessage={activeTask.errorMessage} onRetry={handleStartProcess} />
          )}
        </div>
      </div>
    </div>
  );
}
