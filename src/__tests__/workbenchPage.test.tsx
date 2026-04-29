import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { createDefaultVideoSplitPlan } from '../domain/mediaContracts';
import type { VideoCutTask } from '../domain/videoCutTypes';
import { WorkbenchPage } from '../components/pages/WorkbenchPage';

function renderingTask(): VideoCutTask {
  return {
    taskId: 'task-rendering',
    title: 'Rendering task',
    type: 'single-speaker',
    status: 'rendering',
    progress: 80,
    durationSeconds: 86,
    currentStage: 'render',
    sourceName: 'source.mp4',
    updatedAt: '2026-04-29T00:00:00.000Z',
  };
}

describe('WorkbenchPage', () => {
  it('disables mutation controls while the selected task is rendering', async () => {
    const user = userEvent.setup();
    const task = renderingTask();
    const plan = createDefaultVideoSplitPlan({
      sourceName: 'source.mp4',
      taskId: task.taskId,
      type: task.type,
    });

    render(
      <WorkbenchPage
        artifacts={[]}
        cutType="single-speaker"
        events={[]}
        plan={plan}
        selectedTaskId={task.taskId}
        tasks={[task]}
        onAnalyze={vi.fn()}
        onCutTypeChange={vi.fn()}
        onExportSubtitles={vi.fn()}
        onImport={vi.fn()}
        onImportLocalVideo={vi.fn()}
        onImportSubtitleFile={vi.fn()}
        onRender={vi.fn()}
        onSaveManualTranscript={vi.fn()}
        onSavePlanRange={vi.fn()}
        onSaveRenderPreferences={vi.fn()}
        onSelectTask={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText('Manual transcript text'), 'Locked while rendering');

    expect(screen.getByRole('button', { name: 'Save split plan' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save render assets' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save manual transcript' })).toBeDisabled();
    expect(screen.getByLabelText('Import subtitle file')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export SRT subtitles' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export VTT subtitles' })).toBeDisabled();
  });
});
