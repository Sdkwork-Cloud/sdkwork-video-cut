import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  FileText,
  Filter,
  Image,
  Languages,
  Mic,
  Minimize,
  Monitor,
  Music,
  PlayCircle,
  RefreshCcw,
  RotateCcw,
  Scissors,
  Trash2,
  Video,
  XCircle,
} from 'lucide-react';
import { AUTOCUT_TASK_STATUS, AUTOCUT_TASK_TYPE, isAutoCutTaskActiveStatus, type AppTask, type TaskStatus, type TaskType } from '@sdkwork/autocut-types';
import {
  cancelTasks,
  confirmAutoCutAction,
  createAutoCutTaskTypeI18nKey,
  deleteTask,
  deleteTasks,
  downloadAutoCutTaskPackage,
  formatAutoCutDateTime,
  getTasks,
  hasAutoCutTaskPackageDownloadables,
  listenAutoCutEvent,
  retryTasks,
  sortAutoCutRecordsByCreatedAtDesc,
} from '@sdkwork/autocut-services';
import { Card, useToast } from '@sdkwork/autocut-commons';

function sortTaskQueueByCreatedAtDesc(tasks: readonly AppTask[]) {
  return sortAutoCutRecordsByCreatedAtDesc([...tasks]);
}

function mergeTaskQueueUpdate(tasks: readonly AppTask[], updatedTask: AppTask) {
  const taskIndex = tasks.findIndex((task) => task.id === updatedTask.id);
  if (taskIndex < 0) {
    return sortTaskQueueByCreatedAtDesc([updatedTask, ...tasks]);
  }

  return tasks.map((task, index) => (index === taskIndex ? updatedTask : task));
}

const TYPE_ICONS: Record<TaskType, React.ReactNode> = {
  [AUTOCUT_TASK_TYPE.videoSlice]: <Video size={18} className="text-blue-500" />,
  [AUTOCUT_TASK_TYPE.textExtraction]: <FileText size={18} className="text-purple-500" />,
  [AUTOCUT_TASK_TYPE.audioExtraction]: <Music size={18} className="text-green-500" />,
  [AUTOCUT_TASK_TYPE.videoGif]: <Image size={18} className="text-orange-500" />,
  [AUTOCUT_TASK_TYPE.videoCompress]: <Minimize size={18} className="text-pink-500" />,
  [AUTOCUT_TASK_TYPE.videoConvert]: <RefreshCcw size={18} className="text-yellow-500" />,
  [AUTOCUT_TASK_TYPE.videoEnhance]: <Monitor size={18} className="text-cyan-500" />,
  [AUTOCUT_TASK_TYPE.videoDedup]: <Copy size={18} className="text-amber-500" />,
  [AUTOCUT_TASK_TYPE.subtitleTranslate]: <Languages size={18} className="text-indigo-500" />,
  [AUTOCUT_TASK_TYPE.voiceTranslate]: <Mic size={18} className="text-rose-500" />,
};

type TaskTypeFilter = TaskType | 'all';
const TASK_STATUS_FILTERS = [
  'all',
  AUTOCUT_TASK_STATUS.pending,
  AUTOCUT_TASK_STATUS.processing,
  AUTOCUT_TASK_STATUS.reviewing,
  AUTOCUT_TASK_STATUS.completed,
  AUTOCUT_TASK_STATUS.failed,
  AUTOCUT_TASK_STATUS.canceled,
  AUTOCUT_TASK_STATUS.interrupted,
] as const;

function getTaskStatusLabel(status: AppTask['status'] | 'all') {
  switch (status) {
    case 'all':
      return 'All';
    case AUTOCUT_TASK_STATUS.pending:
      return 'Pending';
    case AUTOCUT_TASK_STATUS.processing:
      return 'Processing';
    case AUTOCUT_TASK_STATUS.reviewing:
      return 'Review Ready';
    case AUTOCUT_TASK_STATUS.completed:
      return 'Completed';
    case AUTOCUT_TASK_STATUS.failed:
      return 'Failed';
    case AUTOCUT_TASK_STATUS.canceled:
      return 'Canceled';
    case AUTOCUT_TASK_STATUS.interrupted:
      return 'Interrupted';
    default:
      return String(status);
  }
}

function getTaskStatusIndicator(task: AppTask) {
  if (task.status === AUTOCUT_TASK_STATUS.completed) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-green-500">
        <CheckCircle2 size={14} /> Completed
      </span>
    );
  }
  if (task.status === AUTOCUT_TASK_STATUS.processing) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-blue-400">
        <RefreshCcw size={14} className="animate-spin" /> Processing
      </span>
    );
  }
  if (task.status === AUTOCUT_TASK_STATUS.reviewing) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-cyan-300">
        <Scissors size={14} /> Review Ready
      </span>
    );
  }
  if (task.status === AUTOCUT_TASK_STATUS.pending) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-blue-300">
        <Clock size={14} /> Pending
      </span>
    );
  }
  if (task.status === AUTOCUT_TASK_STATUS.canceled) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-amber-400">
        <XCircle size={14} /> Canceled
      </span>
    );
  }
  if (task.status === AUTOCUT_TASK_STATUS.interrupted) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-purple-400">
        <AlertCircle size={14} /> Interrupted
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-red-500">
      <XCircle size={14} /> Failed
    </span>
  );
}

export function TasksPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<AppTask[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | TaskStatus>('all');
  const [typeFilter, setTypeFilter] = useState<TaskTypeFilter>('all');
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [packagingTaskIds, setPackagingTaskIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const getTaskTypeLabel = (taskType: TaskType) =>
    t(createAutoCutTaskTypeI18nKey(taskType), { defaultValue: taskType });

  useEffect(() => {
    const fetchTasks = () => getTasks().then(setTasks).finally(() => setIsLoading(false));
    const handleTaskUpdated = (updatedTask: AppTask) => {
      setTasks((currentTasks) => mergeTaskQueueUpdate(currentTasks, updatedTask));
    };
    const handleTaskAdded = (addedTask: AppTask) => {
      setTasks((currentTasks) => mergeTaskQueueUpdate(currentTasks, addedTask));
    };
    const handleTaskDeleted = (deletedTask: { id: string }) => {
      setTasks((currentTasks) => currentTasks.filter((task) => task.id !== deletedTask.id));
    };
    fetchTasks();
    const stopTaskUpdated = listenAutoCutEvent('taskUpdated', handleTaskUpdated);
    const stopTaskAdded = listenAutoCutEvent('taskAdded', handleTaskAdded);
    const stopTaskDeleted = listenAutoCutEvent('taskDeleted', handleTaskDeleted);
    return () => {
      stopTaskUpdated();
      stopTaskAdded();
      stopTaskDeleted();
    };
  }, []);

  useEffect(() => {
    setSelectedTaskIds((currentIds) => currentIds.filter((taskId) => tasks.some((task) => task.id === taskId)));
  }, [tasks]);

  const handleDelete = async (id: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (confirmAutoCutAction('Delete this task?')) {
      await deleteTask(id);
      setSelectedTaskIds((currentIds) => currentIds.filter((taskId) => taskId !== id));
      toast('Task deleted', 'success');
    }
  };

  const handleToggleTaskSelection = (taskId: string, event: React.MouseEvent | React.ChangeEvent<HTMLInputElement>) => {
    event.stopPropagation();
    setSelectedTaskIds((currentIds) =>
      currentIds.includes(taskId)
        ? currentIds.filter((selectedTaskId) => selectedTaskId !== taskId)
        : [...currentIds, taskId],
    );
  };

  const handleOpenTaskDetail = (taskId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    navigate(`/tasks/${taskId}`);
  };

  const handleOpenReviewWorkbench = (taskId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    navigate(`/slicer?reviewTaskId=${encodeURIComponent(taskId)}`);
  };

  const availableTypes = useMemo<TaskTypeFilter[]>(() => {
    const types = new Set<TaskType>();
    tasks.forEach((task) => types.add(task.type));
    return ['all', ...Array.from(types)];
  }, [tasks]);

  const filteredTasks = tasks.filter((task) => {
    const statusMatch = statusFilter === 'all' || task.status === statusFilter;
    const typeMatch = typeFilter === 'all' || task.type === typeFilter;
    return statusMatch && typeMatch;
  });
  const visibleTaskIds = filteredTasks.map((task) => task.id);
  const visibleTaskIdSet = new Set(visibleTaskIds);
  const selectedTasks = tasks.filter((task) => selectedTaskIds.includes(task.id));
  const allVisibleTasksSelected = visibleTaskIds.length > 0 && selectedTaskIds.filter((taskId) => visibleTaskIdSet.has(taskId)).length === visibleTaskIds.length;
  const activeSelectedTaskIds = selectedTasks
    .filter((task) => isAutoCutTaskActiveStatus(task.status))
    .map((task) => task.id);
  const failedSelectedTaskIds = selectedTasks
    .filter((task) => task.status === AUTOCUT_TASK_STATUS.failed)
    .map((task) => task.id);
  const packageableSelectedTasks = selectedTasks.filter(hasAutoCutTaskPackageDownloadables);
  const activeSelectedTaskCount = activeSelectedTaskIds.length;
  const failedSelectedTaskCount = failedSelectedTaskIds.length;
  const packageableSelectedTaskCount = packageableSelectedTasks.length;
  const isPackagingSelectedTasks = packageableSelectedTasks.some((task) => packagingTaskIds.includes(task.id));

  const handleToggleVisibleTaskSelection = (event: React.MouseEvent | React.ChangeEvent<HTMLInputElement>) => {
    event.stopPropagation();
    setSelectedTaskIds((currentIds) => {
      if (allVisibleTasksSelected) {
        return currentIds.filter((taskId) => !visibleTaskIdSet.has(taskId));
      }
      return [...new Set([...currentIds, ...visibleTaskIds])];
    });
  };

  const handleClearTaskSelection = () => {
    setSelectedTaskIds([]);
  };

  const handleBulkDeleteTasks = async () => {
    if (selectedTaskIds.length === 0) {
      return;
    }
    const selectedCount = selectedTaskIds.length;
    if (!confirmAutoCutAction(`Delete ${selectedCount} selected task${selectedCount === 1 ? '' : 's'}?`)) {
      return;
    }
    const result = await deleteTasks(selectedTaskIds);
    setSelectedTaskIds((currentIds) => currentIds.filter((taskId) => !result.deletedTaskIds.includes(taskId)));
    toast(
      result.skipped > 0
        ? `Deleted ${result.deleted} task${result.deleted === 1 ? '' : 's'}, skipped ${result.skipped}`
        : `Deleted ${result.deleted} selected task${result.deleted === 1 ? '' : 's'}`,
      result.deleted > 0 ? 'success' : 'info',
    );
  };

  const handleBulkCancelTasks = async () => {
    if (activeSelectedTaskIds.length === 0) {
      toast('No active selected tasks can be canceled', 'info');
      return;
    }
    const result = await cancelTasks(activeSelectedTaskIds);
    toast(
      result.skipped > 0
        ? `Cancel requested for ${result.canceled} task${result.canceled === 1 ? '' : 's'}, skipped ${result.skipped}`
        : `Cancel requested for ${result.canceled} active task${result.canceled === 1 ? '' : 's'}`,
      result.canceled > 0 ? 'success' : 'info',
    );
  };

  const handleBulkRetryTasks = async () => {
    if (failedSelectedTaskIds.length === 0) {
      toast('No failed selected tasks can be retried', 'info');
      return;
    }
    const result = await retryTasks(failedSelectedTaskIds);
    setSelectedTaskIds((currentIds) => currentIds.filter((taskId) => !result.retriedTaskIds.includes(taskId)));
    toast(
      result.skipped > 0
        ? `Retried ${result.retried} task${result.retried === 1 ? '' : 's'}, skipped ${result.skipped}`
        : `Retried ${result.retried} failed task${result.retried === 1 ? '' : 's'}`,
      result.retried > 0 ? 'success' : 'info',
    );
  };

  const handleDownloadTaskPackage = async (task: AppTask, event: React.MouseEvent) => {
    event.stopPropagation();
    if (!hasAutoCutTaskPackageDownloadables(task) || packagingTaskIds.includes(task.id)) {
      return;
    }

    try {
      setPackagingTaskIds((currentIds) => [...new Set([...currentIds, task.id])]);
      const result = await downloadAutoCutTaskPackage([task]);
      toast(
        result.skippedFileCount > 0
          ? t('tasks.packageDownload.singlePartial', {
              defaultValue: `Packaged ${result.includedFileCount} files, skipped ${result.skippedFileCount}`,
              count: result.includedFileCount,
              skipped: result.skippedFileCount,
            })
          : t('tasks.packageDownload.singleSuccess', {
              defaultValue: `Package download started: ${result.includedFileCount} files`,
              count: result.includedFileCount,
            }),
        result.includedFileCount > 0 ? 'success' : 'info',
      );
    } catch (error) {
      toast(
        error instanceof Error
          ? error.message
          : t('tasks.packageDownload.failed', { defaultValue: 'Package download failed' }),
        'error',
      );
    } finally {
      setPackagingTaskIds((currentIds) => currentIds.filter((taskId) => taskId !== task.id));
    }
  };

  const handleBulkDownloadTaskPackage = async () => {
    if (packageableSelectedTaskCount === 0) {
      toast(t('tasks.packageDownload.noneSelected', { defaultValue: 'No completed selected tasks can be packaged' }), 'info');
      return;
    }

    const taskIds = packageableSelectedTasks.map((task) => task.id);
    try {
      setPackagingTaskIds((currentIds) => [...new Set([...currentIds, ...taskIds])]);
      const result = await downloadAutoCutTaskPackage(packageableSelectedTasks);
      toast(
        result.skippedFileCount > 0
          ? t('tasks.packageDownload.bulkPartial', {
              defaultValue: `Packaged ${result.taskCount} tasks with ${result.includedFileCount} files, skipped ${result.skippedFileCount}`,
              count: result.taskCount,
              files: result.includedFileCount,
              skipped: result.skippedFileCount,
            })
          : t('tasks.packageDownload.bulkSuccess', {
              defaultValue: `Package download started: ${result.taskCount} tasks, ${result.includedFileCount} files`,
              count: result.taskCount,
              files: result.includedFileCount,
            }),
        result.includedFileCount > 0 ? 'success' : 'info',
      );
    } catch (error) {
      toast(
        error instanceof Error
          ? error.message
          : t('tasks.packageDownload.failed', { defaultValue: 'Package download failed' }),
        'error',
      );
    } finally {
      setPackagingTaskIds((currentIds) => currentIds.filter((taskId) => !taskIds.includes(taskId)));
    }
  };

  return (
    <div className="w-full h-full min-h-0 p-4 md:p-5 flex flex-col overflow-hidden">
      <div className="w-full flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3 border-b border-[#222] px-3 py-2">
          <div
            aria-label="Task status filter"
            className="flex rounded-md border border-[#333] bg-[#111] p-0.5"
          >
            {TASK_STATUS_FILTERS.map((filter) => (
              <button
                key={filter}
                onClick={() => setStatusFilter(filter)}
                className={`h-7 px-3 text-xs font-semibold rounded transition-all ${
                  statusFilter === filter
                    ? 'bg-[#222] text-gray-200 shadow-sm border border-[#444]'
                    : 'text-gray-500 hover:text-gray-300 transparent border border-transparent'
                }`}
              >
                {getTaskStatusLabel(filter)}
              </button>
            ))}
          </div>
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="text-sm font-semibold text-gray-100">Task queue</h1>
            <span className="rounded-full border border-[#333] bg-[#0A0A0A] px-2.5 py-1 text-[11px] text-gray-500">
              {filteredTasks.length} visible / {selectedTaskIds.length} selected
            </span>
          </div>
          <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
            <label className="flex h-8 items-center gap-2 rounded-md border border-[#333] bg-[#111] px-3 text-xs font-semibold text-gray-400">
              <input
                type="checkbox"
                aria-label="Select visible tasks"
                checked={allVisibleTasksSelected}
                onChange={handleToggleVisibleTaskSelection}
                disabled={visibleTaskIds.length === 0}
                className="h-4 w-4 rounded border-[#444] bg-[#111] accent-blue-500"
              />
              <span>{allVisibleTasksSelected ? 'Clear visible' : 'Select visible'}</span>
            </label>
            {selectedTaskIds.length > 0 && (
              <div
                aria-label="Selected task bulk actions"
                className="flex h-8 min-w-0 flex-wrap items-center gap-1.5 rounded-md border border-blue-500/20 bg-blue-500/5 px-2"
              >
                <span className="shrink-0 px-1 text-xs font-semibold text-blue-300">{selectedTaskIds.length} selected</span>
                <span className="hidden shrink-0 text-[11px] text-gray-500 md:inline">A {activeSelectedTaskCount}</span>
                <span className="hidden shrink-0 text-[11px] text-gray-500 md:inline">F {failedSelectedTaskCount}</span>
                <span className="hidden shrink-0 text-[11px] text-gray-500 md:inline">D {packageableSelectedTaskCount}</span>
                <button
                  type="button"
                  aria-label="Cancel active selected tasks"
                  onClick={handleBulkCancelTasks}
                  disabled={activeSelectedTaskCount === 0}
                  className="inline-flex h-6 items-center gap-1 rounded border border-amber-500/25 bg-amber-500/10 px-2 text-[11px] font-semibold text-amber-300 transition-colors hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:border-[#333] disabled:bg-[#111] disabled:text-gray-600"
                >
                  <XCircle size={12} /> Cancel
                </button>
                <button
                  type="button"
                  aria-label="Retry failed selected tasks"
                  onClick={handleBulkRetryTasks}
                  disabled={failedSelectedTaskCount === 0}
                  className="inline-flex h-6 items-center gap-1 rounded border border-emerald-500/25 bg-emerald-500/10 px-2 text-[11px] font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:border-[#333] disabled:bg-[#111] disabled:text-gray-600"
                >
                  <RotateCcw size={12} /> Retry
                </button>
                <button
                  type="button"
                  aria-label={t('tasks.packageDownload.bulkAria', { defaultValue: 'Download selected completed tasks as a ZIP package' })}
                  onClick={handleBulkDownloadTaskPackage}
                  disabled={packageableSelectedTaskCount === 0 || isPackagingSelectedTasks}
                  className="inline-flex h-6 items-center gap-1 rounded border border-cyan-500/25 bg-cyan-500/10 px-2 text-[11px] font-semibold text-cyan-300 transition-colors hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:border-[#333] disabled:bg-[#111] disabled:text-gray-600"
                >
                  <Download size={12} />
                  {isPackagingSelectedTasks
                    ? t('tasks.packageDownload.packaging', { defaultValue: 'Packaging' })
                    : t('tasks.packageDownload.download', { defaultValue: 'Download' })}
                </button>
                <button
                  type="button"
                  aria-label="Clear task selection"
                  onClick={handleClearTaskSelection}
                  className="h-6 rounded border border-[#333] bg-[#111] px-2 text-[11px] font-semibold text-gray-300 transition-colors hover:border-[#555] hover:text-white"
                >
                  Clear
                </button>
                <button
                  type="button"
                  aria-label="Delete selected tasks"
                  onClick={handleBulkDeleteTasks}
                  className="inline-flex h-6 items-center gap-1 rounded border border-red-500/25 bg-red-500/10 px-2 text-[11px] font-semibold text-red-300 transition-colors hover:bg-red-500/20"
                >
                  <Trash2 size={12} /> Delete
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 px-3">
          <div className="flex h-7 items-center gap-2 rounded-md border border-[#222] bg-[#0A0A0A] px-2.5 text-xs text-gray-500">
            <Filter size={14} />
            <span>Type</span>
          </div>
          {availableTypes.map((type) => (
            <button
              key={type}
              onClick={() => setTypeFilter(type)}
              className={`h-7 px-3 text-xs rounded-md border transition-all ${
                typeFilter === type
                  ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                  : 'bg-[#111] text-gray-400 border-[#333] hover:border-[#555] hover:text-gray-200'
              }`}
            >
              {type === 'all' ? 'All types' : getTaskTypeLabel(type)}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center p-20 text-gray-500 bg-[#0A0A0A] border border-[#222] border-dashed rounded-xl">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-700 border-t-blue-500" />
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-20 text-gray-500 bg-[#0A0A0A] border border-[#222] border-dashed rounded-xl">
              <AlertCircle size={48} className="mb-4 opacity-30" />
              <p className="text-sm">No matching tasks</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {filteredTasks.map((task) => (
                <Card key={task.id} className="p-0 overflow-hidden border-[#222] hover:border-[#444] transition-all group">
                  <div
                    className={`p-4 flex items-center justify-between bg-[#0A0A0A] group-hover:bg-[#111] transition-colors cursor-pointer ${
                      selectedTaskIds.includes(task.id) ? 'ring-1 ring-blue-500/40 bg-blue-500/5' : ''
                    }`}
                    onClick={() => navigate(`/tasks/${task.id}`)}
                  >
                    <div className="flex items-center gap-4 w-1/2">
                      <label
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#333] bg-[#111] hover:border-blue-500/50 transition-colors"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          aria-label="Select task"
                          checked={selectedTaskIds.includes(task.id)}
                          onChange={(event) => handleToggleTaskSelection(task.id, event)}
                          className="sr-only"
                        />
                        {selectedTaskIds.includes(task.id) ? (
                          <Check size={16} className="text-blue-400" />
                        ) : (
                          <span className="h-3.5 w-3.5 rounded border border-[#555]" />
                        )}
                      </label>
                      <div className="w-12 h-12 bg-[#151515] border border-[#333] rounded-xl flex items-center justify-center shadow-inner relative overflow-hidden">
                        {TYPE_ICONS[task.type] || <PlayCircle size={20} className="text-gray-500" />}
                      {isAutoCutTaskActiveStatus(task.status) && (
                        <div className="absolute bottom-0 left-0 h-0.5 bg-blue-500" style={{ width: `${task.progress}%` }} />
                      )}
                      {task.status === AUTOCUT_TASK_STATUS.reviewing && (
                        <div className="absolute bottom-0 left-0 h-0.5 bg-cyan-400" style={{ width: '100%' }} />
                      )}
                      </div>

                      <div className="flex flex-col gap-1.5 min-w-0">
                        <h3 className="text-sm font-semibold text-gray-200 group-hover:text-white transition-colors truncate">{task.name}</h3>
                        <div className="flex items-center gap-4 text-[11px] text-gray-500">
                          <span className="flex items-center gap-1">
                            <Clock size={12} /> {formatAutoCutDateTime(task.createdAt)}
                          </span>
                          <span className="flex items-center gap-1 font-mono">ID: {task.id.toUpperCase()}</span>
                        </div>
                      </div>
                    </div>

                    <div className="w-1/6 flex justify-center flex-col items-center gap-1">
                      <span className="px-2.5 py-1 bg-[#1A1A1A] rounded-md text-gray-400 border border-[#333] text-[11px] font-medium tracking-wide">
                        {getTaskTypeLabel(task.type)}
                      </span>
                      {task.status === AUTOCUT_TASK_STATUS.completed && task.resultCount !== undefined && task.resultCount > 0 && (
                        <span className="text-[10px] text-blue-400 font-medium">{task.resultCount} files</span>
                      )}
                    </div>

                    <div className="flex items-center gap-8 w-1/3 justify-end">
                      {isAutoCutTaskActiveStatus(task.status) && (
                        <div className="flex flex-col gap-1.5 w-full max-w-[160px] mr-2">
                          <span className="text-[11px] text-blue-400 truncate text-right font-medium">
                            {task.progressMessage || (task.status === AUTOCUT_TASK_STATUS.pending ? 'Pending...' : 'Processing...')}
                          </span>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-[#222] rounded-full overflow-hidden">
                              <div className="h-full bg-blue-500 rounded-full transition-all duration-500" style={{ width: `${task.progress}%` }} />
                            </div>
                            <span className="text-[11px] font-mono font-bold text-blue-400 min-w-[24px] text-right">{task.progress}%</span>
                          </div>
                        </div>
                      )}
                      {task.status === AUTOCUT_TASK_STATUS.reviewing && (
                        <div className="flex flex-col gap-1.5 w-full max-w-[180px] mr-2">
                          <span className="text-[11px] text-cyan-300 truncate text-right font-medium">
                            Segment Review Workbench is ready
                          </span>
                          <button
                            type="button"
                            onClick={(event) => handleOpenReviewWorkbench(task.id, event)}
                            className="ml-auto inline-flex h-7 items-center gap-1 rounded border border-cyan-500/25 bg-cyan-500/10 px-2 text-[11px] font-semibold text-cyan-200 transition-colors hover:border-cyan-400 hover:bg-cyan-500/20"
                          >
                            <Scissors size={12} /> Review segments
                          </button>
                        </div>
                      )}

                      <div className="w-24 flex justify-end">
                        {getTaskStatusIndicator(task)}
                      </div>

                      <div className="flex items-center gap-1">
                        {hasAutoCutTaskPackageDownloadables(task) && (
                          <button
                            className="w-8 h-8 rounded-full flex items-center justify-center text-cyan-400 hover:bg-cyan-500/10 transition-colors disabled:cursor-not-allowed disabled:text-gray-600 disabled:hover:bg-transparent"
                            onClick={(event) => void handleDownloadTaskPackage(task, event)}
                            disabled={packagingTaskIds.includes(task.id)}
                            title={t('tasks.packageDownload.rowTitle', { defaultValue: 'Download package' })}
                            aria-label={t('tasks.packageDownload.rowAria', { taskName: task.name, defaultValue: `Download ${task.name} as a ZIP package` })}
                          >
                            <Download size={16} />
                          </button>
                        )}
                        <button
                          className="w-8 h-8 rounded-full flex items-center justify-center text-red-500 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all"
                          onClick={(event) => handleDelete(task.id, event)}
                          title="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                        <button
                          className="w-8 h-8 rounded-full flex items-center justify-center text-gray-500 hover:bg-[#222] hover:text-white transition-colors"
                          onClick={(event) => handleOpenTaskDetail(task.id, event)}
                          title="Open details"
                        >
                          <ArrowRight size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
