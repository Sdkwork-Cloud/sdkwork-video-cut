import { processVoiceTranslate } from '../service/voiceTranslateService';
import { useState, useEffect } from 'react';
import { Card, Button, FileUpload, TaskFailureState } from '@sdkwork/autocut-commons';

import { Upload, Settings, Play, Mic, Activity, Download, CheckCircle2 } from 'lucide-react';
import { useToast } from '@sdkwork/autocut-commons';
import { downloadAutoCutUrl, getTasks, listenAutoCutEvent, reportAutoCutDiagnostic } from '@sdkwork/autocut-services';
import { AUTOCUT_TASK_STATUS, isAutoCutTaskActiveStatus, type AppTask } from '@sdkwork/autocut-types';

export function VoiceTranslatePage() {
  const [file, setFile] = useState<File | null>(null);
  const [targetLang, setTargetLang] = useState('en');
  const [voiceModel, setVoiceModel] = useState('clone');
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
      toast('选择要提取人声翻译的视频', 'error');
      return;
    }
    toast('语音分析与跨语种声轨构建中...', 'info');
    try {
      const res = await processVoiceTranslate({ file, sourceLang: 'auto', targetLang, voiceCloneSync: voiceModel === 'clone', bgmHandling: 'keep' });
      if (res.success) {
        toast('提取克隆任务提交成功...', 'success');
        setActiveTaskId(res.taskId);
        setActiveTask(null);
      }
    } catch (e) {
      reportAutoCutDiagnostic('error', 'voice-translate', 'Voice translation failed', e);
      toast('人声引擎崩溃', 'error');
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
            <span className="w-2 h-6 bg-rose-500 rounded-full"></span>
            视频人声翻译
          </h1>
          <p className="text-sm text-gray-500 mt-2 ml-5">保留背景音，将人声替换为目标语言（支持声纹克隆）</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-6">
            <Card className="p-6 bg-[#0A0A0A] border-[#222]">
              <h2 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
                <Upload size={16} className="text-rose-500" />
                源视频文件
              </h2>
              <FileUpload file={file} onChange={setFile} accept="video/*" maxSizeMB={1000} />
            </Card>

            <div className="bg-rose-500/5 border border-rose-500/10 rounded-xl p-4 flex gap-3 text-sm text-rose-400">
              <Mic size={20} className="shrink-0 mt-0.5" />
              <p>为了获得最佳的音色克隆效果，请确保源视频包含清晰、无剧烈背景噪音的人声（至少5秒以上）。</p>
            </div>
          </div>

          <Card className="p-6 bg-[#0A0A0A] border-[#222] flex flex-col">
            <h2 className="text-sm font-semibold text-gray-300 mb-6 flex items-center gap-2">
              <Settings size={16} className="text-gray-400" />
              翻译 & 配音设置
            </h2>

            <div className="space-y-6 flex-1">
              <div className="space-y-3">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">目标语言</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'en', label: '英语 (US)' },
                    { id: 'zh', label: '中文 (CN)' },
                    { id: 'ja', label: '日语 (JP)' },
                    { id: 'ko', label: '韩语 (KR)' },
                    { id: 'es', label: '西班牙语' },
                    { id: 'fr', label: '法语' },
                  ].map(lang => (
                    <button
                      key={lang.id}
                      onClick={() => setTargetLang(lang.id)}
                      className={`py-2 rounded-lg text-sm transition-all border block text-center ${
                        targetLang === lang.id
                          ? 'bg-rose-600/10 border-rose-500/50 text-rose-400 shadow-rose-500/5'
                          : 'bg-[#111] border-[#333] text-gray-400 hover:border-[#555]'
                      }`}
                    >
                      {lang.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">配音策略</label>
                <div className="space-y-3">
                  <label className={`flex items-start gap-3 p-4 border rounded-xl cursor-pointer transition-colors ${voiceModel === 'clone' ? 'border-rose-500/50 bg-rose-500/5' : 'border-[#333] bg-[#111] hover:border-[#555]'}`}>
                    <input
                      type="radio"
                      name="voice"
                      checked={voiceModel === 'clone'}
                      onChange={() => setVoiceModel('clone')}
                      className="mt-1 flex-shrink-0 text-rose-500 focus:ring-0"
                    />
                    <div>
                      <div className={`text-sm font-medium ${voiceModel === 'clone' ? 'text-gray-200' : 'text-gray-400'}`}>音色克隆 (推荐)</div>
                      <div className="text-xs text-gray-500 mt-1">提取源视频说话人的声纹并用于目标语言配音。</div>
                    </div>
                  </label>

                  <label className={`flex items-start gap-3 p-4 border rounded-xl cursor-pointer transition-colors ${voiceModel === 'standard' ? 'border-rose-500/50 bg-rose-500/5' : 'border-[#333] bg-[#111] hover:border-[#555]'}`}>
                    <input
                      type="radio"
                      name="voice"
                      checked={voiceModel === 'standard'}
                      onChange={() => setVoiceModel('standard')}
                      className="mt-1 flex-shrink-0 text-rose-500 focus:ring-0"
                    />
                    <div>
                      <div className={`text-sm font-medium ${voiceModel === 'standard' ? 'text-gray-200' : 'text-gray-400'}`}>标准 AI 声音</div>
                      <div className="text-xs text-gray-500 mt-1">使用平台内置的高质量人工声音进行配音。</div>
                    </div>
                  </label>
                </div>
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-[#222] flex justify-end">
              <Button
                onClick={handleProcess}
                disabled={!file || isProcessing}
                className="flex items-center gap-2 px-6 bg-rose-600 hover:bg-rose-700 text-white"
              >
                <Play size={16} />
                {(isProcessing && !activeTask) ? '提交中...' : '提交翻译'}
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
                 <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-rose-500/5 rounded-full blur-[100px] pointer-events-none" />

                 <div className="relative z-10 flex flex-col items-center justify-center text-center p-12">
                   <div className="w-24 h-24 mb-8 rounded-3xl bg-[#151515] border border-[#222] shadow-[0_0_40px_rgba(225,29,72,0.15)] flex items-center justify-center relative inner-shadow">
                     <div className="absolute inset-0 bg-rose-500/10 rounded-3xl" />
                     <Activity size={40} className="text-rose-500 relative z-10 animate-pulse" />
                   </div>
                   <h2 className="text-2xl font-extrabold text-white mb-2 tracking-tight drop-shadow-sm">正在进行人声翻译与克隆...</h2>
                   <p className="text-[14px] font-medium text-gray-400 mb-8 max-w-md">正在提取声纹、翻译文案并进行音色克隆语音合成</p>

                   <div className="w-64 h-2 bg-[#222] rounded-full overflow-hidden shadow-inner border border-[#333]">
                     <div className="h-full bg-rose-500 transition-all duration-300 relative shadow-[0_0_10px_rgba(225,29,72,0.8)]" style={{ width: `${activeTask?.progress || 0}%` }}></div>
                   </div>
                   <div className="mt-4 text-xs font-mono text-rose-400 font-bold">{activeTask?.progress || 0}%</div>
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
                         <span className="font-bold">视频翻译完成</span>
                       </div>
                    </div>
                    <div className="w-full max-h-[60vh] bg-black flex items-center justify-center relative">
                      <video src={activeTask.videoUrl} controls className="w-full h-full max-h-[500px] object-contain" />
                    </div>
                    <div className="p-6 bg-[#151515] w-full border-t border-[#222] flex justify-center">
                       <Button onClick={() => handleDownload(activeTask.videoUrl, `${activeTask.name}_translated.mp4`)} size="lg" className="bg-rose-600 hover:bg-rose-500">
                         <Download size={18} className="mr-2" /> 下载配音视频
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
