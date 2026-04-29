import { useCallback, useEffect, useMemo, useState } from 'react';

import { AppShell } from './components/AppShell';
import { DiagnosticsPage } from './components/pages/DiagnosticsPage';
import { HomePage } from './components/pages/HomePage';
import { QueuePage } from './components/pages/QueuePage';
import { ResultsPage } from './components/pages/ResultsPage';
import { WorkbenchPage } from './components/pages/WorkbenchPage';
import { OperationErrorPanel } from './components/OperationErrorPanel';
import { SettingsCenter } from './components/settings/SettingsCenter';
import {
  createDiagnosticBundleDownloadDescriptor,
  type DiagnosticBundleDownloadDescriptor,
} from './domain/diagnosticBundleExport';
import type { RenderPreferences, VideoSplitPlan } from './domain/mediaContracts';
import type { PageId } from './domain/navigationTypes';
import { type OperationError, toOperationError } from './domain/operationErrors';
import type {
  CapabilityReport,
  AssetCatalog,
  DeploymentDoctorReport,
  DiagnosticBundle,
  DiagnosticSupportBundleRequest,
  ProviderConformanceReport,
  ProviderConformanceTarget,
  SubtitleFormat,
  VideoCutArtifact,
  VideoCutProgressEvent,
  VideoCutSettings,
  VideoCutSettingsSavePayload,
  VideoCutTask,
  VideoCutType,
} from './domain/videoCutTypes';
import type { VideoCutHostClient } from './ports/videoCutHostClient';
import { createVideoCutHostClient } from './services/createVideoCutHostClient';
import { readTextFile } from './utils/readTextFile';
import { createSampleVideoFile } from './utils/sampleVideo';
import { titleFromSourceName } from './utils/sourceTitle';

export interface AppProps {
  client?: VideoCutHostClient;
}

interface LoadedRuntimeState {
  artifacts: VideoCutArtifact[];
  assetCatalog: AssetCatalog;
  capability: CapabilityReport;
  doctorReport: DeploymentDoctorReport;
  events: VideoCutProgressEvent[];
  selectedPlan?: VideoSplitPlan;
  selectedTaskId?: string;
  settings: VideoCutSettings;
  tasks: VideoCutTask[];
}

function isMissingTaskPlanError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null) {
    const code = (error as Record<string, unknown>).code;
    if (code === 'TASK_PLAN_NOT_FOUND') {
      return true;
    }
  }

  return error instanceof Error && error.message.startsWith('Task plan not found:');
}

async function getOptionalTaskPlan(client: VideoCutHostClient, taskId: string): Promise<VideoSplitPlan | undefined> {
  try {
    return await client.getTaskPlan(taskId);
  } catch (error) {
    if (isMissingTaskPlanError(error)) {
      return undefined;
    }

    throw error;
  }
}

function shouldReadTaskPlan(task: VideoCutTask | undefined): task is VideoCutTask {
  if (!task) {
    return false;
  }

  if (task.status === 'draft' || task.status === 'sourceReady') {
    return false;
  }

  return task.currentStage !== 'draft' && task.currentStage !== 'import';
}

async function getOptionalTaskPlanForTask(
  client: VideoCutHostClient,
  task: VideoCutTask | undefined,
): Promise<VideoSplitPlan | undefined> {
  if (!shouldReadTaskPlan(task)) {
    return undefined;
  }

  return getOptionalTaskPlan(client, task.taskId);
}

export default function App({ client: providedClient }: AppProps = {}) {
  const client = useMemo<VideoCutHostClient>(() => providedClient ?? createVideoCutHostClient(), [providedClient]);
  const [activePage, setActivePage] = useState<PageId>('workbench');
  const [capability, setCapability] = useState<CapabilityReport>();
  const [doctorReport, setDoctorReport] = useState<DeploymentDoctorReport>();
  const [diagnosticBundle, setDiagnosticBundle] = useState<DiagnosticBundle>();
  const [diagnosticBundleDownload, setDiagnosticBundleDownload] = useState<DiagnosticBundleDownloadDescriptor>();
  const [providerConformanceReport, setProviderConformanceReport] = useState<ProviderConformanceReport>();
  const [settings, setSettings] = useState<VideoCutSettings>();
  const [tasks, setTasks] = useState<VideoCutTask[]>([]);
  const [artifacts, setArtifacts] = useState<VideoCutArtifact[]>([]);
  const [assetCatalog, setAssetCatalog] = useState<AssetCatalog>();
  const [events, setEvents] = useState<VideoCutProgressEvent[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<VideoSplitPlan>();
  const [selectedTaskId, setSelectedTaskId] = useState<string>();
  const [selectedCutType, setSelectedCutType] = useState<VideoCutType>('interview-qa');
  const [operationError, setOperationError] = useState<OperationError>();

  const applyLoadedRuntimeState = useCallback((nextState: LoadedRuntimeState) => {
    setCapability(nextState.capability);
    setDoctorReport(nextState.doctorReport);
    setSettings(nextState.settings);
    setTasks(nextState.tasks);
    setSelectedTaskId(nextState.selectedTaskId);
    setArtifacts(nextState.artifacts);
    setAssetCatalog(nextState.assetCatalog);
    setEvents(nextState.events);
    setSelectedPlan(nextState.selectedPlan);
  }, []);

  const loadRuntimeState = useCallback(async (): Promise<LoadedRuntimeState> => {
    const [nextCapability, nextDoctorReport, nextSettings, nextAssetCatalog, nextTasks] = await Promise.all([
      client.getCapabilities(),
      client.getDoctorReport(),
      client.getSettings(),
      client.getAssetCatalog(),
      client.listTasks(),
    ]);
    const initialTask = nextTasks[0];
    if (!initialTask) {
      return {
        artifacts: [],
        assetCatalog: nextAssetCatalog,
        capability: nextCapability,
        doctorReport: nextDoctorReport,
        events: [],
        selectedPlan: undefined,
        selectedTaskId: undefined,
        settings: nextSettings,
        tasks: nextTasks,
      };
    }

    const [nextArtifacts, nextEvents, nextPlan] = await Promise.all([
      client.getTaskArtifacts(initialTask.taskId),
      client.getTaskEvents(initialTask.taskId),
      getOptionalTaskPlanForTask(client, initialTask),
    ]);

    return {
      artifacts: nextArtifacts,
      assetCatalog: nextAssetCatalog,
      capability: nextCapability,
      doctorReport: nextDoctorReport,
      events: nextEvents,
      selectedPlan: nextPlan,
      selectedTaskId: initialTask.taskId,
      settings: nextSettings,
      tasks: nextTasks,
    };
  }, [client]);

  const reloadRuntimeState = async () => {
    setOperationError(undefined);
    try {
      applyLoadedRuntimeState(await loadRuntimeState());
    } catch (error) {
      setOperationError(toOperationError(error, 'Load runtime state failed'));
    }
  };

  useEffect(() => {
    let cancelled = false;

    void loadRuntimeState()
      .then((nextState) => {
        if (cancelled) {
          return;
        }

        applyLoadedRuntimeState(nextState);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        setOperationError(toOperationError(error, 'Load runtime state failed'));
      });

    return () => {
      cancelled = true;
    };
  }, [applyLoadedRuntimeState, loadRuntimeState]);

  const runOperation = async <T,>(title: string, operation: () => Promise<T>): Promise<T | undefined> => {
    setOperationError(undefined);
    try {
      return await operation();
    } catch (error) {
      setOperationError(toOperationError(error, title));
      return undefined;
    }
  };

  const refreshTaskState = async (taskId?: string) => {
    const nextTasks = await client.listTasks();
    setTasks(nextTasks);
    const nextSelectedTaskId =
      taskId ?? (selectedTaskId && nextTasks.some((task) => task.taskId === selectedTaskId) ? selectedTaskId : nextTasks[0]?.taskId);

    if (nextSelectedTaskId) {
      const nextSelectedTask = nextTasks.find((task) => task.taskId === nextSelectedTaskId);
      const [nextArtifacts, nextEvents, nextPlan] = await Promise.all([
        client.getTaskArtifacts(nextSelectedTaskId),
        client.getTaskEvents(nextSelectedTaskId),
        getOptionalTaskPlanForTask(client, nextSelectedTask),
      ]);
      setSelectedTaskId(nextSelectedTaskId);
      setArtifacts(nextArtifacts);
      setEvents(nextEvents);
      setSelectedPlan(nextPlan);
      return;
    }

    setSelectedTaskId(undefined);
    setArtifacts([]);
    setEvents([]);
    setSelectedPlan(undefined);
  };

  const importSample = async () => {
    const task = await client.createTask({
      title: '张老师访谈拆条',
      type: 'interview-qa',
    });
    await client.uploadTaskSourceFile(task.taskId, createSampleVideoFile());
    await refreshTaskState(task.taskId);
    setActivePage('workbench');
  };

  const importLocalVideo = async (file: File) => {
    const task = await client.createTask({
      title: titleFromSourceName(file.name),
      type: selectedCutType,
    });
    await client.uploadTaskSourceFile(task.taskId, file);
    await refreshTaskState(task.taskId);
    setActivePage('workbench');
  };

  const analyzeTask = async (taskId: string) => {
    const task = await client.analyzeTask(taskId);
    await refreshTaskState(task.taskId);
  };

  const renderTask = async (taskId: string) => {
    const currentPlan = selectedPlan?.taskId === taskId ? selectedPlan : await client.getTaskPlan(taskId);
    const task = currentPlan.segments.length > 1 ? await client.renderTaskBatch(taskId) : await client.renderTask(taskId);
    await refreshTaskState(task.taskId);
  };

  const selectTask = async (taskId: string) => {
    await refreshTaskState(taskId);
    setActivePage('workbench');
  };

  const cancelTask = async (taskId: string) => {
    const task = await client.cancelTask(taskId);
    await refreshTaskState(task.taskId);
  };

  const deleteTask = async (taskId: string) => {
    await client.deleteTask(taskId);
    await refreshTaskState(taskId === selectedTaskId ? undefined : selectedTaskId);
  };

  const retryTask = async (taskId: string) => {
    const task = tasks.find((item) => item.taskId === taskId);
    if (task?.currentStage === 'render') {
      await renderTask(taskId);
      return;
    }

    await analyzeTask(taskId);
  };

  const savePlanRange = async (taskId: string, segmentId: string, startMs: number, endMs: number) => {
    const currentPlan = selectedPlan?.taskId === taskId ? selectedPlan : await client.getTaskPlan(taskId);
    if (!currentPlan.segments.some((segment) => segment.segmentId === segmentId)) {
      throw new Error(`Split plan segment not found: ${segmentId}`);
    }
    const nextPlan: VideoSplitPlan = {
      ...currentPlan,
      planRevision: currentPlan.planRevision + 1,
      segments: currentPlan.segments.map((segment) => {
        if (segment.segmentId !== segmentId) {
          return segment;
        }

        const decisionReasons = segment.decisionReasons.includes('manual-override')
          ? segment.decisionReasons
          : [...segment.decisionReasons, 'manual-override' as const];

        return {
          ...segment,
          sourceRange: { startMs, endMs },
          outputRange: { startMs: 0, endMs: endMs - startMs },
          decisionReasons,
        };
      }),
    };
    const savedPlan = await client.updateTaskPlan(taskId, nextPlan);
    setSelectedPlan(savedPlan);
    return savedPlan;
  };

  const saveRenderAssetPreferences = async (taskId: string, renderPreferences: RenderPreferences) => {
    const currentPlan = selectedPlan?.taskId === taskId ? selectedPlan : await client.getTaskPlan(taskId);
    const nextPlan: VideoSplitPlan = {
      ...currentPlan,
      planRevision: currentPlan.planRevision + 1,
      renderPreferences,
    };
    const savedPlan = await client.updateTaskPlan(taskId, nextPlan);
    setSelectedPlan(savedPlan);
    return savedPlan;
  };

  const saveManualTranscript = async (taskId: string, segmentId: string, startMs: number, endMs: number, text: string) => {
    await savePlanRange(taskId, segmentId, startMs, endMs);
    await client.updateTaskTranscript(taskId, {
      language: settings?.subtitle.language ?? settings?.speechToText.languageHint ?? 'zh',
      segments: [{ startMs, endMs, text }],
      text,
    });
    await refreshTaskState(taskId);
  };

  const importSubtitleFile = async (taskId: string, file: File) => {
    const format: SubtitleFormat = file.name.toLowerCase().endsWith('.vtt') ? 'vtt' : 'srt';
    await client.importTaskSubtitles(taskId, {
      content: await readTextFile(file),
      format,
      language: settings?.subtitle.language ?? settings?.speechToText.languageHint ?? 'zh',
    });
    await refreshTaskState(taskId);
  };

  const exportSubtitles = async (taskId: string, format: SubtitleFormat) => {
    await client.exportTaskSubtitles(taskId, format);
    await refreshTaskState(taskId);
  };

  const saveSettings = async (nextSettings: VideoCutSettingsSavePayload) => {
    const result = await client.updateSettings(nextSettings);
    if (result.valid) {
      const [savedSettings, nextCapability, nextDoctorReport] = await Promise.all([
        client.getSettings(),
        client.getCapabilities(),
        client.getDoctorReport(),
      ]);
      const nextAssetCatalog = await client.getAssetCatalog();
      setSettings(savedSettings);
      setCapability(nextCapability);
      setDoctorReport(nextDoctorReport);
      setAssetCatalog(nextAssetCatalog);
      setDiagnosticBundle(undefined);
      setDiagnosticBundleDownload(undefined);
    }
    return result;
  };

  const runDoctor = async () => {
    const [nextCapability, nextDoctorReport] = await Promise.all([client.getCapabilities(), client.getDoctorReport()]);
    setCapability(nextCapability);
    setDoctorReport(nextDoctorReport);
    return nextDoctorReport;
  };

  const exportDiagnosticBundle = async () => {
    const nextBundle = await client.getDiagnosticBundle();
    const nextDownload = createDiagnosticBundleDownloadDescriptor(nextBundle);
    setDiagnosticBundle(nextBundle);
    setDiagnosticBundleDownload(nextDownload);
    setCapability(nextBundle.capability);
    setDoctorReport(nextBundle.doctor);
    return nextBundle;
  };

  const exportDiagnosticSupportBundle = async (input: DiagnosticSupportBundleRequest) => {
    const nextBundle = await client.getDiagnosticSupportBundle(input);
    const nextDownload = createDiagnosticBundleDownloadDescriptor(nextBundle);
    setDiagnosticBundle(nextBundle);
    setDiagnosticBundleDownload(nextDownload);
    setCapability(nextBundle.capability);
    setDoctorReport(nextBundle.doctor);
    return nextBundle;
  };

  const runProviderConformance = async (target: ProviderConformanceTarget) => {
    const report = await client.runProviderConformance(target);
    setProviderConformanceReport(report);
    return report;
  };

  const renderPage = () => {
    const selectedTask = tasks.find((task) => task.taskId === selectedTaskId);

    switch (activePage) {
      case 'home':
        return <HomePage onImport={() => void runOperation('Import sample failed', importSample)} />;
      case 'queue':
        return (
          <QueuePage
            events={events}
            selectedTaskId={selectedTaskId}
            tasks={tasks}
            onCancel={(taskId) => void runOperation('Cancel task failed', () => cancelTask(taskId))}
            onDelete={(taskId) => void runOperation('Delete task failed', () => deleteTask(taskId))}
            onRetry={(taskId) => void runOperation('Retry task failed', () => retryTask(taskId))}
            onSelect={(taskId) => void runOperation('Select task failed', () => selectTask(taskId))}
          />
        );
      case 'results':
        return (
          <ResultsPage
            artifacts={artifacts}
            getArtifactContent={client.getArtifactContent}
            getArtifactText={client.getArtifactText}
          />
        );
      case 'diagnostics':
        return (
          <DiagnosticsPage
            capability={capability}
            diagnosticBundle={diagnosticBundle}
            diagnosticBundleDownload={diagnosticBundleDownload}
            doctorReport={doctorReport}
            onExportDiagnosticBundle={() => runOperation('Export diagnostics failed', exportDiagnosticBundle)}
            onExportDiagnosticSupportBundle={(input) =>
              runOperation('Export support bundle failed', () => exportDiagnosticSupportBundle(input))
            }
            onRunDoctor={() => runOperation('Run doctor failed', runDoctor)}
            selectedTask={selectedTask}
          />
        );
      case 'settings':
        return (
          <SettingsCenter
            diagnosticBundle={diagnosticBundle}
            diagnosticBundleDownload={diagnosticBundleDownload}
            doctorReport={doctorReport}
            providerConformanceReport={providerConformanceReport}
            assetCatalog={assetCatalog}
            settings={settings}
            onExportDiagnosticBundle={() => runOperation('Export diagnostics failed', exportDiagnosticBundle)}
            onExportDiagnosticSupportBundle={(input) =>
              runOperation('Export support bundle failed', () => exportDiagnosticSupportBundle(input))
            }
            onRunProviderConformance={(target) =>
              runOperation('Provider conformance failed', () => runProviderConformance(target))
            }
            onRunDoctor={() => runOperation('Run doctor failed', runDoctor)}
            selectedTask={selectedTask}
            onSave={(nextSettings) => runOperation('Save settings failed', () => saveSettings(nextSettings))}
          />
        );
      case 'workbench':
      default:
        return (
          <WorkbenchPage
            tasks={tasks}
            artifacts={artifacts}
            assetCatalog={assetCatalog}
            events={events}
            plan={selectedPlan}
            selectedTaskId={selectedTaskId}
            cutType={selectedCutType}
            onImport={() => void runOperation('Import sample failed', importSample)}
            onCutTypeChange={setSelectedCutType}
            onImportLocalVideo={(file) => void runOperation('Import local video failed', () => importLocalVideo(file))}
            onSelectTask={(taskId) => void runOperation('Select task failed', () => selectTask(taskId))}
            onAnalyze={(taskId) => void runOperation('Analyze task failed', () => analyzeTask(taskId))}
            onRender={(taskId) => void runOperation('Render task failed', () => renderTask(taskId))}
            onSavePlanRange={(taskId, segmentId, startMs, endMs) =>
              void runOperation('Save split plan failed', () => savePlanRange(taskId, segmentId, startMs, endMs))
            }
            onSaveRenderPreferences={(taskId, renderPreferences) =>
              void runOperation('Save render asset preferences failed', () => saveRenderAssetPreferences(taskId, renderPreferences))
            }
            onSaveManualTranscript={(taskId, segmentId, startMs, endMs, text) =>
              void runOperation('Save manual transcript failed', () => saveManualTranscript(taskId, segmentId, startMs, endMs, text))
            }
            onImportSubtitleFile={(taskId, file) => void runOperation('Import subtitle file failed', () => importSubtitleFile(taskId, file))}
            onExportSubtitles={(taskId, format) => void runOperation('Export subtitles failed', () => exportSubtitles(taskId, format))}
          />
        );
    }
  };

  return (
    <AppShell activePage={activePage} capability={capability} onNavigate={setActivePage}>
      {operationError && (
        <OperationErrorPanel
          error={operationError}
          recoveryAction={
            operationError.title === 'Load runtime state failed'
              ? { label: 'Reload runtime state', onRun: () => void reloadRuntimeState() }
              : undefined
          }
          onDismiss={() => setOperationError(undefined)}
        />
      )}
      {renderPage()}
    </AppShell>
  );
}
