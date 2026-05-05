import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { PlayCircle, FileText, Music, CheckCircle2, XCircle, Clock, AlertCircle, Filter, ArrowRight, Image, Minimize, RefreshCcw, Monitor, Languages, Mic, Video, Trash2 } from 'lucide-react';
import { AUTOCUT_TASK_STATUS, type AppTask, type TaskStatus, type TaskType } from '@sdkwork/autocut-types';
import { confirmAutoCutAction, getTasks, deleteTask, listenAutoCutEvent } from '@sdkwork/autocut-services';
import { Card, useToast } from '@sdkwork/autocut-commons';

const TYPE_ICONS: Record<TaskType, React.ReactNode> = {
  '视频切片': <Video size={18} className="text-blue-500" />,
  '文案提取': <FileText size={18} className="text-purple-500" />,
  '视频提音': <Music size={18} className="text-green-500" />,
  '视频转gif': <Image size={18} className="text-orange-500" />,
  '视频压缩': <Minimize size={18} className="text-pink-500" />,
  '视频格式转换': <RefreshCcw size={18} className="text-yellow-500" />,
  '视频高清化': <Monitor size={18} className="text-cyan-500" />,
  '视频字幕翻译': <Languages size={18} className="text-indigo-500" />,
  '视频人声翻译': <Mic size={18} className="text-rose-500" />
};

export function TasksPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [tasks, setTasks] = useState<AppTask[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | TaskStatus>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  useEffect(() => {
    const fetchTasks = () => getTasks().then(setTasks);
    fetchTasks();
    const stopTaskUpdated = listenAutoCutEvent('taskUpdated', fetchTasks);
    const stopTaskAdded = listenAutoCutEvent('taskAdded', fetchTasks);
    const stopTaskDeleted = listenAutoCutEvent('taskDeleted', fetchTasks);
    return () => {
      stopTaskUpdated();
      stopTaskAdded();
      stopTaskDeleted();
    };
  }, []);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmAutoCutAction('确定要删除这个任务吗？')) {
      await deleteTask(id);
      toast('任务已删除', 'success');
    }
  };

  const handleOpenTaskDetail = (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/tasks/${taskId}`);
  };

  // Derive unique types from tasks
  const availableTypes = useMemo(() => {
    const types = new Set<string>();
    tasks.forEach(task => types.add(task.type));
    return ['all', ...Array.from(types)];
  }, [tasks]);

  const filteredTasks = tasks.filter(task => {
    const statusMatch = statusFilter === 'all' || task.status === statusFilter;
    const typeMatch = typeFilter === 'all' || task.type === typeFilter;
    return statusMatch && typeMatch;
  });

  return (
    <div className="w-full h-full p-6 md:p-10 flex flex-col items-center overflow-y-auto">
      <div className="w-full flex flex-col h-full space-y-8">
        {/* Header */}
        <div className="flex items-end justify-between border-b border-[#222] pb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-100 flex items-center gap-3">
              <span className="w-2 h-6 bg-blue-500 rounded-full"></span>
              任务中心
            </h1>
            <p className="text-sm text-gray-500 mt-2 ml-5">统一管理和追踪所有应用与工具的执行任务记录</p>
          </div>

          <div className="flex items-center gap-2">
            <div className="bg-[#111] border border-[#333] rounded-lg p-1 flex">
              {(['all', AUTOCUT_TASK_STATUS.processing, AUTOCUT_TASK_STATUS.completed, AUTOCUT_TASK_STATUS.failed] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setStatusFilter(f)}
                  className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all ${
                    statusFilter === f
                      ? 'bg-[#222] text-gray-200 shadow-sm border border-[#444]'
                      : 'text-gray-500 hover:text-gray-300 transparent border border-transparent'
                  }`}
                >
                  {f === 'all' && '全部状态'}
                  {f === AUTOCUT_TASK_STATUS.processing && '处理中'}
                  {f === AUTOCUT_TASK_STATUS.completed && '已完成'}
                  {f === AUTOCUT_TASK_STATUS.failed && '异常'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-gray-500 bg-[#0A0A0A] px-3 py-1.5 rounded-full border border-[#222]">
            <Filter size={14} />
            <span>任务类型:</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {availableTypes.map(type => (
              <button
                key={type}
                onClick={() => setTypeFilter(type)}
                className={`px-3 py-1.5 text-xs rounded-full border transition-all ${
                  typeFilter === type
                    ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                    : 'bg-[#111] text-gray-400 border-[#333] hover:border-[#555] hover:text-gray-200'
                }`}
              >
                {type === 'all' ? '全部类型' : type}
              </button>
            ))}
          </div>
        </div>

        {/* Task List */}
        <div className="flex-1 overflow-y-auto">
          {filteredTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-20 text-gray-500 bg-[#0A0A0A] border border-[#222] border-dashed rounded-xl">
              <AlertCircle size={48} className="mb-4 opacity-30" />
              <p className="text-sm">没有匹配的任务记录</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {filteredTasks.map(task => (
                <Card key={task.id} className="p-0 overflow-hidden border-[#222] hover:border-[#444] transition-all group">
                  <div
                    className="p-4 flex items-center justify-between bg-[#0A0A0A] group-hover:bg-[#111] transition-colors cursor-pointer"
                    onClick={() => navigate(`/tasks/${task.id}`)}
                  >

                    {/* Left: Icon & Info */}
                    <div className="flex items-center gap-5 w-1/2">
                      <div className="w-12 h-12 bg-[#151515] border border-[#333] rounded-xl flex items-center justify-center shadow-inner relative overflow-hidden">
                        {TYPE_ICONS[task.type] || <PlayCircle size={20} className="text-gray-500" />}
                        {task.status === AUTOCUT_TASK_STATUS.processing && (
                          <div className="absolute bottom-0 left-0 h-0.5 bg-blue-500" style={{ width: `${task.progress}%` }} />
                        )}
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <h3 className="text-sm font-semibold text-gray-200 group-hover:text-white transition-colors">{task.name}</h3>
                        <div className="flex items-center gap-4 text-[11px] text-gray-500">
                          <span className="flex items-center gap-1">
                            <Clock size={12} /> {task.createdAt}
                          </span>
                          <span className="flex items-center gap-1 font-mono">
                            ID: {task.id.toUpperCase()}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Middle: Type Badge */}
                    <div className="w-1/6 flex justify-center flex-col items-center gap-1">
                      <span className="px-2.5 py-1 bg-[#1A1A1A] rounded-md text-gray-400 border border-[#333] text-[11px] font-medium tracking-wide">
                        {task.type}
                      </span>
                      {task.status === AUTOCUT_TASK_STATUS.completed && task.resultCount !== undefined && task.resultCount > 0 && (
                        <span className="text-[10px] text-blue-400 font-medium">生成 {task.resultCount} 个文件</span>
                      )}
                    </div>

                    {/* Right: Status & Actions */}
                    <div className="flex items-center gap-8 w-1/3 justify-end">
                      {task.status === AUTOCUT_TASK_STATUS.processing && (
                        <div className="flex flex-col gap-1.5 w-full max-w-[160px] mr-2">
                          <span className="text-[11px] text-blue-400 truncate text-right font-medium">{task.progressMessage || '处理中...'}</span>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-[#222] rounded-full overflow-hidden">
                              <div className="h-full bg-blue-500 rounded-full transition-all duration-500" style={{ width: `${task.progress}%` }} />
                            </div>
                            <span className="text-[11px] font-mono font-bold text-blue-400 min-w-[24px] text-right">{task.progress}%</span>
                          </div>
                        </div>
                      )}

                      <div className="w-24 flex justify-end">
                        {task.status === AUTOCUT_TASK_STATUS.completed && (
                          <span className="flex items-center gap-1.5 text-xs text-green-500">
                            <CheckCircle2 size={14} /> 成功完成
                          </span>
                        )}
                        {task.status === AUTOCUT_TASK_STATUS.processing && (
                          <span className="flex items-center gap-1.5 text-xs text-blue-400">
                            <RefreshCcw size={14} className="animate-spin" /> 处理中...
                          </span>
                        )}
                        {task.status === AUTOCUT_TASK_STATUS.failed && (
                          <span className="flex items-center gap-1.5 text-xs text-red-500">
                            <XCircle size={14} /> 异常中断
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        <button className="w-8 h-8 rounded-full flex items-center justify-center text-red-500 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all" onClick={(e) => handleDelete(task.id, e)} title="删除">
                          <Trash2 size={16} />
                        </button>
                        <button className="w-8 h-8 rounded-full flex items-center justify-center text-gray-500 hover:bg-[#222] hover:text-white transition-colors" onClick={(e) => handleOpenTaskDetail(task.id, e)} title="查看详情">
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
