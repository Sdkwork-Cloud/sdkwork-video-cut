import { processSubtitleTranslate } from '../service/subtitleTranslateService';
import { useState, useEffect } from 'react';
import { Card, Button, FileUpload, TaskFailureState } from '@sdkwork/autocut-commons';

import { Upload, Play, Type, Languages, Activity, Download, CheckCircle2 } from 'lucide-react';
import { useToast } from '@sdkwork/autocut-commons';
import { downloadAutoCutUrl, getAutoCutProcessingTaskErrorTaskId, getTasks, listenAutoCutEvent, reportAutoCutDiagnostic, selectAutoCutTrustedLocalMediaFile, writeAutoCutClipboardText } from '@sdkwork/autocut-services';
import { AUTOCUT_TASK_STATUS, isAutoCutTaskActiveStatus, type AppTask } from '@sdkwork/autocut-types';

export function SubtitleTranslatePage() {
  const [file, setFile] = useState<File | null>(null);
  const [sourceLang] = useState('auto');
  const [targetLang, setTargetLang] = useState('zh');
  const [keepOriginal, setKeepOriginal] = useState(true);
  const [hardcode, setHardcode] = useState(false);
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
      toast('请先选择视频文件', 'error');
      return;
    }
    toast('发起了智能语音翻译任务...', 'info');
    try {
      const res = await processSubtitleTranslate({ file, sourceLang, targetLang, keepOriginal, hardcode });
      if (res.success) {
        toast('任务交接至云端处理管道...', 'success');
        setActiveTaskId(res.taskId);
        setActiveTask(null);
      }
    } catch (e) {
      const failedTaskId = getAutoCutProcessingTaskErrorTaskId(e);
      if (failedTaskId) {
        setActiveTaskId(failedTaskId);
        setActiveTask(null);
      }
      reportAutoCutDiagnostic('error', 'subtitle-translate', 'Subtitle translation failed', e);
      toast('字幕翻译引擎服务无响应', 'error');
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
            <span className="w-2 h-6 bg-indigo-500 rounded-full"></span>
            视频字幕翻译
          </h1>
          <p className="text-sm text-gray-500 mt-2 ml-5">自动识别视频中的语音，并生成高精度的多语种字幕文件</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-6">
            <Card className="p-6 bg-[#0A0A0A] border-[#222]">
              <h2 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
                <Upload size={16} className="text-indigo-500" />
                包含人声的视频
              </h2>
              <FileUpload
                file={file}
                onChange={setFile}
                accept="video/*"
                trustedFileSourceSelector={() => selectAutoCutTrustedLocalMediaFile(['video'])}
              />
            </Card>

            <div className="bg-indigo-500/5 border border-indigo-500/10 rounded-xl p-4 flex gap-3 text-sm text-indigo-400">
              <Type size={20} className="shrink-0 mt-0.5" />
              <p>采用 Whisper V3 引擎进行语音识别，识别准确率可达 98.5% 以上。输出可选 SRT 或 VTT 格式。</p>
            </div>
          </div>

          <Card className="p-6 bg-[#0A0A0A] border-[#222] flex flex-col">
            <h2 className="text-sm font-semibold text-gray-300 mb-6 flex items-center gap-2">
              <Languages size={16} className="text-gray-400" />
              翻译 & 字幕选项
            </h2>

            <div className="space-y-6 flex-1">
              <div className="space-y-3">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">目标语言</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'zh', label: '简体中文' },
                    { id: 'en', label: 'English' },
                    { id: 'ja', label: '日本語' },
                    { id: 'ko', label: '한국어' },
                    { id: 'es', label: 'Español' },
                    { id: 'custom', label: '其他语言...' },
                  ].map(lang => (
                    <button
                      key={lang.id}
                      onClick={() => setTargetLang(lang.id)}
                      className={`py-2 px-3 rounded-lg text-sm transition-all border text-left flex justify-between items-center ${
                        targetLang === lang.id
                          ? 'bg-indigo-600/10 border-indigo-500/50 text-indigo-400'
                          : 'bg-[#111] border-[#333] text-gray-400 hover:border-[#555]'
                      }`}
                    >
                      {lang.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">附加选项</label>
                <div className="space-y-2">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" checked={keepOriginal} onChange={e => setKeepOriginal(e.target.checked)} className="w-4 h-4 rounded border-[#333] bg-[#111] text-indigo-500 focus:ring-0 focus:ring-offset-0" />
                    <span className="text-sm text-gray-300">保留源语言 (双语字幕)</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" checked={hardcode} onChange={e => setHardcode(e.target.checked)} className="w-4 h-4 rounded border-[#333] bg-[#111] text-indigo-500 focus:ring-0 focus:ring-offset-0" />
                    <span className="text-sm text-gray-300">将字幕硬编码(烧录)到视频中</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-[#222] flex justify-end">
              <Button
                onClick={handleProcess}
                disabled={!file || isProcessing}
                className="flex items-center gap-2 px-6 bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                <Play size={16} />
                {(isProcessing && !activeTask) ? '提交中...' : '开始识别'}
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
                 <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-indigo-500/5 rounded-full blur-[100px] pointer-events-none" />

                 <div className="relative z-10 flex flex-col items-center justify-center text-center p-12">
                   <div className="w-24 h-24 mb-8 rounded-3xl bg-[#151515] border border-[#222] shadow-[0_0_40px_rgba(99,102,241,0.15)] flex items-center justify-center relative inner-shadow">
                     <div className="absolute inset-0 bg-indigo-500/10 rounded-3xl" />
                     <Activity size={40} className="text-indigo-500 relative z-10 animate-pulse" />
                   </div>
                   <h2 className="text-2xl font-extrabold text-white mb-2 tracking-tight drop-shadow-sm">正在进行语音识别...</h2>
                   <p className="text-[14px] font-medium text-gray-400 mb-8 max-w-md">正在提取视频音轨并进行高精度多语种转录</p>

                   <div className="w-64 h-2 bg-[#222] rounded-full overflow-hidden shadow-inner border border-[#333]">
                     <div className="h-full bg-indigo-500 transition-all duration-300 relative shadow-[0_0_10px_rgba(99,102,241,0.8)]" style={{ width: `${activeTask?.progress || 0}%` }}></div>
                   </div>
                   <div className="mt-4 text-xs font-mono text-indigo-400 font-bold">{activeTask?.progress || 0}%</div>
                 </div>
               </Card>
             ) : (
               activeTask?.status === AUTOCUT_TASK_STATUS.failed ? (
                  <TaskFailureState
                    errorMessage={activeTask.errorMessage}
                    onCopyErrorMessage={writeAutoCutClipboardText}
                    onRetry={handleProcess}
                  />
               ) : activeTask?.status === AUTOCUT_TASK_STATUS.completed && activeTask.videoUrl ? (
                  <Card className="flex flex-col items-center justify-center border-[#222] bg-[#111] overflow-hidden">
                    <div className="p-4 bg-[#151515] w-full border-b border-[#222] flex justify-between items-center">
                       <div className="flex items-center gap-3">
                         <div className="w-8 h-8 rounded-full bg-green-500/20 text-green-500 flex items-center justify-center">
                           <CheckCircle2 size={16} />
                         </div>
                         <span className="font-bold">字幕生成完成</span>
                       </div>
                    </div>
                    <div className="w-full max-h-[60vh] bg-black flex items-center justify-center relative">
                      <video src={activeTask.videoUrl} controls className="w-full h-full max-h-[500px] object-contain" />
                    </div>
                    <div className="p-6 bg-[#151515] w-full border-t border-[#222] flex justify-center">
                       <Button onClick={() => handleDownload(activeTask.videoUrl, `${activeTask.name}_subtitled.mp4`)} size="lg" className="bg-indigo-600 hover:bg-indigo-500">
                         <Download size={18} className="mr-2" /> 下载压制后的视频
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
