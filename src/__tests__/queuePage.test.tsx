import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { VideoCutTask } from '../domain/videoCutTypes';
import { QueuePage } from '../components/pages/QueuePage';

function taskWithStatus(status: VideoCutTask['status']): VideoCutTask {
  return {
    taskId: 'task-rendering',
    title: 'Rendering task',
    type: 'single-speaker',
    status,
    progress: 80,
    durationSeconds: 86,
    currentStage: status === 'rendering' ? 'render' : 'draft',
    sourceName: 'source.mp4',
    updatedAt: '2026-04-29T00:00:00.000Z',
  };
}

describe('QueuePage', () => {
  it('disables delete for running tasks', () => {
    const task = taskWithStatus('rendering');

    render(
      <QueuePage
        events={[]}
        selectedTaskId={task.taskId}
        tasks={[task]}
        onCancel={vi.fn()}
        onDelete={vi.fn()}
        onRetry={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Delete task source.mp4' })).toBeDisabled();
  });

  it('disables cancel for interrupted tasks while keeping retry available', () => {
    const task = taskWithStatus('interrupted');

    render(
      <QueuePage
        events={[]}
        selectedTaskId={task.taskId}
        tasks={[task]}
        onCancel={vi.fn()}
        onDelete={vi.fn()}
        onRetry={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Cancel task source.mp4' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Retry task source.mp4' })).toBeEnabled();
  });
});
