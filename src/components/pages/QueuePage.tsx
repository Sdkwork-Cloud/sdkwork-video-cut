import { MousePointer2, RotateCw, Square, Trash2 } from 'lucide-react';

import { latestTaskRecoveryHint } from '../../domain/taskRecovery';
import type { VideoCutProgressEvent, VideoCutTask } from '../../domain/videoCutTypes';
import { StatusBadge } from '../StatusBadge';

function taskLabel(task: VideoCutTask): string {
  return task.sourceName ?? task.title;
}

function canCancelTask(task: VideoCutTask): boolean {
  return task.status !== 'cancelled' && task.status !== 'succeeded' && task.status !== 'failed' && task.status !== 'interrupted';
}

function canRetryTask(task: VideoCutTask): boolean {
  return task.status === 'failed' || task.status === 'interrupted';
}

function canDeleteTask(task: VideoCutTask): boolean {
  return task.status !== 'analyzing' && task.status !== 'rendering';
}

export function QueuePage({
  events,
  selectedTaskId,
  tasks,
  onCancel,
  onDelete,
  onRetry,
  onSelect,
}: {
  events: VideoCutProgressEvent[];
  selectedTaskId?: string;
  tasks: VideoCutTask[];
  onCancel: (taskId: string) => void;
  onDelete: (taskId: string) => void;
  onRetry: (taskId: string) => void;
  onSelect: (taskId: string) => void;
}) {
  const selectedRecoveryHint = latestTaskRecoveryHint(events, selectedTaskId);

  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Queue</span>
          <h2>批量队列</h2>
        </div>
        <StatusBadge label={`${tasks.length} tasks`} />
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>任务</th>
            <th>类型</th>
            <th>状态</th>
            <th>进度</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr className={task.taskId === selectedTaskId ? 'data-table-row--active' : undefined} key={task.taskId}>
              <td>
                <strong>{task.title}</strong>
                {task.sourceName && <small>{task.sourceName}</small>}
                {task.taskId === selectedTaskId && selectedRecoveryHint && (
                  <div className="recovery-hint" role="note" aria-label={`Recovery hint for ${taskLabel(task)}`}>
                    <strong>{selectedRecoveryHint.label}</strong>
                    <p>{selectedRecoveryHint.message}</p>
                  </div>
                )}
              </td>
              <td>{task.type}</td>
              <td>{task.status}</td>
              <td>{task.progress}%</td>
              <td>
                <div className="table-actions">
                  <button
                    aria-label={`Select task ${taskLabel(task)}`}
                    className="secondary-button table-action-button"
                    type="button"
                    onClick={() => onSelect(task.taskId)}
                  >
                    <MousePointer2 size={15} aria-hidden="true" />
                    Select
                  </button>
                  <button
                    aria-label={`Cancel task ${taskLabel(task)}`}
                    className="secondary-button table-action-button"
                    disabled={!canCancelTask(task)}
                    type="button"
                    onClick={() => onCancel(task.taskId)}
                  >
                    <Square size={15} aria-hidden="true" />
                    Cancel
                  </button>
                  <button
                    aria-label={`Retry task ${taskLabel(task)}`}
                    className="secondary-button table-action-button"
                    disabled={!canRetryTask(task)}
                    type="button"
                    onClick={() => onRetry(task.taskId)}
                  >
                    <RotateCw size={15} aria-hidden="true" />
                    Retry
                  </button>
                  <button
                    aria-label={`Delete task ${taskLabel(task)}`}
                    className="secondary-button table-action-button table-action-button--danger"
                    disabled={!canDeleteTask(task)}
                    type="button"
                    onClick={() => onDelete(task.taskId)}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
