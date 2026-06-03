import { processExtractorText } from '../service/extractorTextService';
import { useState, useEffect, useRef } from 'react';
import { FileText, Type, Download, PlayCircle, Activity, Copy, CheckCircle2 } from 'lucide-react';
import { FileUpload, Button, TaskFailureState, useAutoCutCommonLabels, useToast } from '@sdkwork/autocut-commons';
import { downloadExtractedTextFile, formatExtractedText, getAutoCutProcessingTaskErrorTaskId, getAutoCutWorkflowPreferences, getTasks, listenAutoCutEvent, reportAutoCutDiagnostic, saveAutoCutTextExtractionPreferences, selectAutoCutTrustedLocalMediaFile, writeAutoCutClipboardText } from '@sdkwork/autocut-services';
import {
  AUTOCUT_SPEECH_TRANSCRIPTION_LANGUAGE_OPTIONS,
  AUTOCUT_TASK_STATUS,
  isAutoCutTaskActiveStatus,
  type AppTask,
} from '@sdkwork/autocut-types';

export function ExtractorTextPage() {
  const { toast } = useToast();
  const commonLabels = useAutoCutCommonLabels();
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState('auto');
  const [separateSpeakers, setSeparateSpeakers] = useState(true);
  const [filterWords, setFilterWords] = useState(true);

  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<AppTask | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    getAutoCutWorkflowPreferences()
      .then((preferences) => {
        setLanguage(preferences.textExtraction.language);
        setSeparateSpeakers(preferences.textExtraction.separateSpeakers);
        setFilterWords(preferences.textExtraction.filterWords);
      })
      .catch((error) => reportAutoCutDiagnostic('warning', 'extractor-text', 'Load text extraction parameter preferences failed', error));
  }, []);

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

  useEffect(() => () => { if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current); }, []);

  const handleStartProcess = async () => {
    toast('开始分析与提取文案任务...', 'info');
    try {
      await saveAutoCutTextExtractionPreferences({ language, separateSpeakers, filterWords });
      const res = await processExtractorText({ file, language, format: filterWords ? 'filtered' : 'raw', separateSpeakers });
      if (res.success) {
        toast('提取引擎已就绪，正在努力识别中', 'success');
        setActiveTaskId(res.taskId);
        setActiveTask(null); // Reset while loading
      }
    } catch(e) {
      const failedTaskId = getAutoCutProcessingTaskErrorTaskId(e);
      if (failedTaskId) {
        setActiveTaskId(failedTaskId);
        setActiveTask(null);
      }
      toast('提取任务创建失败', 'error');
    }
  };

  const isProcessing = Boolean(activeTaskId) && (!activeTask || isAutoCutTaskActiveStatus(activeTask.status));

  const handleDownload = () => {
    if (!activeTask?.extractedText) return;
    downloadExtractedTextFile(activeTask, `${activeTask.name}.txt`);
  };

  return (
    <div className="h-full flex flex-col bg-[#050505] text-gray-200">
      <div className="h-16 shrink-0 border-b border-[#222] flex items-center px-6 justify-between bg-[#111]">
        <div className="flex items-center gap-3">
          <FileText className="text-purple-500" size={24} />
          <h1 className="text-lg font-bold tracking-wider text-white">文案提取大师</h1>
          <span className="text-[10px] bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded-full outline outline-1 outline-purple-500/30">AI 音视频识别</span>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left config panel */}
        <div className="w-[420px] shrink-0 border-r border-[#222] bg-[#0A0A0A] flex flex-col overflow-y-auto custom-scrollbar">
          <div className="p-6 pb-2">
            <h2 className="text-xs uppercase tracking-widest text-gray-500 mb-4 font-bold flex items-center gap-2">
               <span className="w-1 h-3 bg-purple-500 rounded-full"></span>
               选择源文件
            </h2>

            <FileUpload
              file={file}
              onChange={setFile}
              accept="audio/*,video/*"
              maxSizeMB={500}
              labels={commonLabels.fileUpload}
              requiredStreams={{ audio: true }}
              trustedFileSourceSelector={() => selectAutoCutTrustedLocalMediaFile(['audio', 'video'])}
            />
          </div>

          <div className="p-6">
             <h2 className="text-xs uppercase tracking-widest text-gray-500 mb-4 font-bold flex items-center gap-2">
               <span className="w-1 h-3 bg-purple-500 rounded-full"></span>
               提取配置
             </h2>

             <div className="space-y-6">
                <div>
                  <label className="block text-[11px] font-bold text-gray-500 mb-2 uppercase">识别语言</label>
                  <select value={language} onChange={e => setLanguage(e.target.value)} className="w-full bg-[#141414] border border-[#222] rounded-lg px-3 py-2.5 text-xs text-white focus:border-purple-500 outline-none transition-all">
                    {AUTOCUT_SPEECH_TRANSCRIPTION_LANGUAGE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="flex items-center justify-between cursor-pointer group">
                    <div>
                      <div className="text-[11px] font-bold text-gray-400 group-hover:text-gray-200 transition-colors uppercase">区分说话人</div>
                      <div className="text-[10px] text-gray-600 mt-1">自动给不同的发音人打标签</div>
                    </div>
                    <div className="relative inline-flex items-center">
                      <input type="checkbox" checked={separateSpeakers} onChange={e => setSeparateSpeakers(e.target.checked)} className="sr-only peer" />
                      <div className="w-9 h-5 bg-[#222] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-400 peer-checked:after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-500"></div>
                    </div>
                  </label>
                </div>

                <div>
                  <label className="flex items-center justify-between cursor-pointer group">
                    <div>
                      <div className="text-[11px] font-bold text-gray-400 group-hover:text-gray-200 transition-colors uppercase">过滤无效语气词</div>
                      <div className="text-[10px] text-gray-600 mt-1">自动删减“嗯、啊、那个”等冗余词汇</div>
                    </div>
                    <div className="relative inline-flex items-center">
                      <input type="checkbox" checked={filterWords} onChange={e => setFilterWords(e.target.checked)} className="sr-only peer" />
                      <div className="w-9 h-5 bg-[#222] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-400 peer-checked:after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-500"></div>
                    </div>
                  </label>
                </div>
             </div>
          </div>

          <div className="p-6 mt-auto">
            <button
              onClick={handleStartProcess}
              disabled={!file || isProcessing}
              className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-xl shadow-lg shadow-purple-900/20 transition-all flex items-center justify-center gap-2 tracking-wide"
            >
              {isProcessing ? (
                 <>提交中 <span className="animate-pulse">...</span></>
              ) : (
                 <><PlayCircle size={18} /> 开始提取文案</>
              )}
            </button>
          </div>
        </div>

        {/* Right workspace */}
        <div className="flex-1 flex flex-col relative bg-[#090909]">
          {!activeTaskId && (
            <div className="flex-1 flex flex-col justify-center items-center relative overflow-hidden bg-gradient-to-br from-[#0A0A0A] to-[#111]">
              <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] pointer-events-none"></div>
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-purple-500/5 rounded-full blur-[100px] pointer-events-none" />

              <div className="relative z-10 flex flex-col items-center justify-center text-center max-w-xl mx-auto px-6">
                <div className="w-24 h-24 mb-8 rounded-3xl bg-[#151515] border border-[#222] shadow-[0_0_40px_rgba(168,85,247,0.15)] flex items-center justify-center relative inner-shadow">
                  <div className="absolute inset-0 bg-purple-500/10 rounded-3xl" />
                  <Type size={40} className="text-purple-500 relative z-10 animate-pulse" />
                </div>
                <h3 className="text-3xl font-extrabold mb-4 tracking-tight text-white drop-shadow-sm">智能文案提取引擎</h3>
                <p className="text-[15px] font-medium text-gray-400 leading-relaxed max-w-md">
                  基于最新的语音识别大模型，可在几秒内将长视频或音频转为极高准确率的带时间戳文案，方便自媒体创作者二次创作。自动区分说话人并支持过滤冗余语气词。
                </p>
              </div>
            </div>
          )}

          {isProcessing && (
            <div className="flex-1 flex flex-col items-center justify-center relative overflow-hidden bg-gradient-to-br from-[#0A0A0A] to-[#111]">
               <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] pointer-events-none"></div>
               <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-purple-500/5 rounded-full blur-[100px] pointer-events-none" />

               <div className="relative z-10 flex flex-col items-center justify-center text-center p-12">
                 <div className="w-24 h-24 mb-8 rounded-3xl bg-[#151515] border border-[#222] shadow-[0_0_40px_rgba(168,85,247,0.15)] flex items-center justify-center relative inner-shadow">
                   <div className="absolute inset-0 bg-purple-500/10 rounded-3xl" />
                   <Activity size={40} className="text-purple-500 relative z-10 animate-pulse" />
                 </div>
                 <h2 className="text-2xl font-extrabold text-white mb-2 tracking-tight drop-shadow-sm">正在提取文案...</h2>
                 <p className="text-[14px] font-medium text-gray-400 mb-8 max-w-md">AI 正在识别音视频中的语音内容，请耐心等待</p>

                 <div className="w-64 h-2 bg-[#222] rounded-full overflow-hidden shadow-inner border border-[#333]">
                   <div className="h-full bg-purple-500 transition-all duration-300 relative shadow-[0_0_10px_rgba(168,85,247,0.8)]" style={{ width: `${activeTask?.progress || 0}%` }}></div>
                 </div>
                 <div className="mt-4 text-xs font-mono text-purple-400 font-bold">{activeTask?.progress || 0}%</div>
               </div>
            </div>
          )}

          {activeTask?.status === AUTOCUT_TASK_STATUS.completed && activeTask.extractedText && (
            <div className="absolute inset-0 flex flex-col bg-[#111]">
              <div className="h-16 border-b border-[#222] flex items-center justify-between px-6 bg-[#151515] shrink-0">
                <div className="flex items-center gap-3">
                   <div className="w-8 h-8 rounded-full bg-green-500/20 text-green-500 flex items-center justify-center">
                     <CheckCircle2 size={16} />
                   </div>
                   <span className="font-bold">提取完成</span>
                </div>
                <div className="flex items-center gap-3">
                   <Button onClick={() => {
                     const text = formatExtractedText(activeTask);
                     void writeAutoCutClipboardText(text);
                     setCopied(true);
                     if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
                     copiedTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
                   }} variant="outline" className="text-xs">
                     <Copy size={14} className="mr-2" /> {copied ? '已复制' : '复制全文'}
                   </Button>
                   <Button onClick={handleDownload} className="text-xs bg-purple-600 hover:bg-purple-500">
                     <Download size={14} className="mr-2" /> 导出 TXT
                   </Button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-10 custom-scrollbar bg-[#0A0A0A]">
                <div className="max-w-5xl mx-auto space-y-6">
                   {activeTask.extractedText.map((item, idx) => (
                     <div key={idx} className="group relative">
                        <div className="absolute -left-16 top-1 text-[10px] font-mono text-gray-500">{item.time}</div>
                        <div className="flex items-start gap-4">
                          <div className="shrink-0 w-8 h-8 bg-purple-500/10 border border-purple-500/20 text-purple-400 rounded-full flex items-center justify-center font-bold text-[10px]">
                            {item.speaker?.[0] || '?'}
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
          )}

          {activeTask?.status === AUTOCUT_TASK_STATUS.failed && (
            <TaskFailureState
              errorMessage={activeTask.errorMessage}
              onCopyErrorMessage={writeAutoCutClipboardText}
              onRetry={handleStartProcess}
              labels={commonLabels.taskFailure}
            />
          )}
        </div>
      </div>
    </div>
  );
}
