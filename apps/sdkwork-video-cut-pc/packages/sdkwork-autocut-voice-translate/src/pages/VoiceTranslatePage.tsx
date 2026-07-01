import { processVoiceTranslate } from '../service/voiceTranslateService';
import { useEffect, useState } from 'react';
import { Activity, CheckCircle2, Download, Languages, Play, Upload } from 'lucide-react';
import { Card, Button, FileUpload, TaskFailureState, useAutoCutCommonLabels, useToast } from '@sdkwork/autocut-commons';
import {
  downloadAutoCutUrl,
  getAutoCutProcessingTaskErrorTaskId,
  getTasks,
  listenAutoCutEvent,
  reportAutoCutDiagnostic,
  selectAutoCutTrustedLocalMediaFile,
  writeAutoCutClipboardText,
} from '@sdkwork/autocut-services';
import { AUTOCUT_TASK_STATUS, isAutoCutTaskActiveStatus, type AppTask } from '@sdkwork/autocut-types';

const VOICE_TRANSLATE_TARGET_LANGUAGES = [
  { id: 'en', label: 'English' },
  { id: 'zh', label: 'Chinese' },
  { id: 'ja', label: 'Japanese' },
  { id: 'ko', label: 'Korean' },
  { id: 'es', label: 'Spanish' },
  { id: 'fr', label: 'French' },
] as const;

export function VoiceTranslatePage() {
  const commonLabels = useAutoCutCommonLabels();
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [targetLang, setTargetLang] = useState('en');
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<AppTask | null>(null);

  useEffect(() => {
    if (!activeTaskId) {
      return;
    }

    const fetchTask = () => {
      void getTasks().then((tasks) => {
        const task = tasks.find((candidate) => candidate.id === activeTaskId);
        if (task) {
          setActiveTask(task);
        }
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
      toast('Select an audio or video file to translate.', 'error');
      return;
    }

    toast('Creating the translated transcript and SRT...', 'info');
    try {
      const result = await processVoiceTranslate({
        file,
        sourceLang: 'auto',
        targetLang,
      });
      if (result.success) {
        toast('Voice translation task submitted.', 'success');
        setActiveTaskId(result.taskId);
        setActiveTask(null);
      }
    } catch (error) {
      const failedTaskId = getAutoCutProcessingTaskErrorTaskId(error);
      if (failedTaskId) {
        setActiveTaskId(failedTaskId);
        setActiveTask(null);
      }
      reportAutoCutDiagnostic('error', 'voice-translate', 'Voice translation failed', error);
      toast('Voice translation failed.', 'error');
    }
  };

  const isProcessing = Boolean(activeTaskId) && (!activeTask || isAutoCutTaskActiveStatus(activeTask.status));

  const handleDownload = () => {
    downloadAutoCutUrl(activeTask?.subtitleUrl, `${activeTask?.name ?? 'voice-translation'}.${activeTask?.subtitleFormat || 'srt'}`);
  };

  return (
    <div className="w-full h-full p-6 md:p-10 flex flex-col items-center overflow-y-auto custom-scrollbar">
      <div className="w-full flex flex-col space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div>
          <h1 className="text-2xl font-bold text-gray-100 flex items-center gap-3">
            <span className="w-2 h-6 bg-rose-500 rounded-full"></span>
            Voice Translation
          </h1>
          <p className="text-sm text-gray-500 mt-2 ml-5">
            Extract speech from audio or video, translate it, and export a timestamped SRT file.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-6">
            <Card className="p-6 bg-[#0A0A0A] border-[#222]">
              <h2 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
                <Upload size={16} className="text-rose-500" />
                Source Media
              </h2>
              <FileUpload
                file={file}
                onChange={setFile}
                accept="audio/*,video/*"
                maxSizeMB={1000}
                labels={commonLabels.fileUpload}
                requiredStreams={{ audio: true }}
                trustedFileSourceSelector={() => selectAutoCutTrustedLocalMediaFile(['audio', 'video'])}
              />
            </Card>

            <div className="bg-rose-500/5 border border-rose-500/10 rounded-xl p-4 flex gap-3 text-sm text-rose-400">
              <Languages size={20} className="shrink-0 mt-0.5" />
              <p>
                Use a media file with clear speech. AutoCut stores the original transcript, translated transcript,
                and downloadable SRT output on the completed task.
              </p>
            </div>
          </div>

          <Card className="p-6 bg-[#0A0A0A] border-[#222] flex flex-col">
            <h2 className="text-sm font-semibold text-gray-300 mb-6 flex items-center gap-2">
              <Languages size={16} className="text-gray-400" />
              Translation Settings
            </h2>

            <div className="space-y-6 flex-1">
              <div className="space-y-3">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Target Language</label>
                <div className="grid grid-cols-3 gap-2">
                  {VOICE_TRANSLATE_TARGET_LANGUAGES.map((language) => (
                    <button
                      key={language.id}
                      onClick={() => setTargetLang(language.id)}
                      className={`py-2 rounded-lg text-sm transition-all border block text-center ${
                        targetLang === language.id
                          ? 'bg-rose-600/10 border-rose-500/50 text-rose-400 shadow-rose-500/5'
                          : 'bg-[#111] border-[#333] text-gray-400 hover:border-[#555]'
                      }`}
                    >
                      {language.label}
                    </button>
                  ))}
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
                {isProcessing && !activeTask ? 'Submitting...' : 'Translate'}
              </Button>
            </div>
          </Card>
        </div>

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
                  <h2 className="text-2xl font-extrabold text-white mb-2 tracking-tight drop-shadow-sm">
                    Translating the speech transcript...
                  </h2>
                  <p className="text-[14px] font-medium text-gray-400 mb-8 max-w-md">
                    AutoCut is transcribing the source media, translating each segment, and preparing SRT subtitles.
                  </p>

                  <div className="w-64 h-2 bg-[#222] rounded-full overflow-hidden shadow-inner border border-[#333]">
                    <div
                      className="h-full bg-rose-500 transition-all duration-300 relative shadow-[0_0_10px_rgba(225,29,72,0.8)]"
                      style={{ width: `${activeTask?.progress || 0}%` }}
                    ></div>
                  </div>
                  <div className="mt-4 text-xs font-mono text-rose-400 font-bold">{activeTask?.progress || 0}%</div>
                </div>
              </Card>
            ) : activeTask?.status === AUTOCUT_TASK_STATUS.failed ? (
              <TaskFailureState
                errorMessage={activeTask.errorMessage}
                onCopyErrorMessage={writeAutoCutClipboardText}
                onRetry={handleProcess}
                labels={commonLabels.taskFailure}
              />
            ) : activeTask?.status === AUTOCUT_TASK_STATUS.completed && (activeTask.subtitleUrl || activeTask.transcriptText) ? (
              <Card className="flex flex-col items-center justify-center border-[#222] bg-[#111] overflow-hidden">
                <div className="p-4 bg-[#151515] w-full border-b border-[#222] flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-green-500/20 text-green-500 flex items-center justify-center">
                      <CheckCircle2 size={16} />
                    </div>
                    <span className="font-bold">Voice translation complete</span>
                  </div>
                </div>
                <div className="w-full max-h-[60vh] overflow-y-auto custom-scrollbar bg-black/30 p-6">
                  <pre className="whitespace-pre-wrap text-sm leading-relaxed text-gray-200 font-mono">
                    {activeTask.translationText || activeTask.transcriptText}
                  </pre>
                </div>
                <div className="p-6 bg-[#151515] w-full border-t border-[#222] flex justify-center">
                  <Button onClick={handleDownload} size="lg" className="bg-rose-600 hover:bg-rose-500">
                    <Download size={18} className="mr-2" /> Download SRT
                  </Button>
                </div>
              </Card>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
