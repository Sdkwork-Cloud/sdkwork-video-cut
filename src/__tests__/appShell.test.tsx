import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import App from '../App';
import { createDefaultVideoSplitPlan } from '../domain/mediaContracts';
import type { AssetCatalog } from '../domain/videoCutTypes';
import { createDefaultSettings, type VideoCutArtifact, type VideoCutTask } from '../domain/videoCutTypes';
import { VideoCutHostApiError } from '../services/httpHostClient';
import { createMemoryHostStore, createMockHostClient } from '../services/mockHostClient';

function renderApp() {
  return render(<App client={createMockHostClient()} />);
}

describe('App shell', () => {
  it('renders the operational navigation and workbench by default', () => {
    renderApp();

    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import sample video' })).toBeInTheDocument();
    expect(screen.getByText('9:16')).toBeInTheDocument();
    expect(screen.getByText('1080x1920')).toBeInTheDocument();
  });

  it('normalizes duplicate artifact ids before rendering workbench artifact lists', async () => {
    const taskId = 'task-duplicate-artifacts';
    const artifactPath = `workspace/projects/default/tasks/${taskId}/renders/${taskId}-render-2/output.mp4`;
    const task: VideoCutTask = {
      currentStage: 'artifact',
      durationSeconds: 2,
      progress: 100,
      sourceName: 'source.mp4',
      status: 'succeeded',
      taskId,
      title: 'Duplicate artifact task',
      type: 'single-speaker',
      updatedAt: '2026-04-27T00:00:00.000Z',
    };
    const artifact: VideoCutArtifact = {
      artifactId: `${taskId}-render-2-output`,
      createdAt: '2026-04-27T00:00:00.000Z',
      kind: 'render',
      path: artifactPath,
      renderId: `${taskId}-render-2`,
      sha256: 'sha-old',
      sizeBytes: 100,
      taskId,
    };
    const store = createMemoryHostStore({
      artifacts: {
        [taskId]: [artifact, { ...artifact, sha256: 'sha-new', sizeBytes: 120 }],
      },
      events: {
        [taskId]: [],
      },
      plans: {
        [taskId]: createDefaultVideoSplitPlan({
          sourceName: 'source.mp4',
          taskId,
          type: 'single-speaker',
        }),
      },
      settings: createDefaultSettings(),
      taskSequence: 1,
      tasks: [task],
    });
    const client = createMockHostClient(createDefaultSettings(), store);

    render(<App client={client} />);

    await waitFor(() => expect(screen.getAllByText(artifactPath)).toHaveLength(1));
  });

  it('uses production-ready localized product copy without mojibake markers', async () => {
    const user = userEvent.setup();
    renderApp();

    expect(screen.getByRole('heading', { name: 'SDKWork Video Cut' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '工作台' })).toHaveAttribute('data-page-id', 'workbench');
    expect(screen.getByRole('heading', { name: '视频剪辑工作台' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '项目' }));
    expect(screen.getByRole('heading', { name: '项目与最近任务' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '队列' }));
    expect(screen.getByRole('heading', { name: '批量队列' })).toBeInTheDocument();

    expect(document.body.textContent ?? '').not.toMatch(/[瑙瀵浠闃鐘鎵宸绫绛褰杈鏆寮]/);
  });

  it('keeps localized navigation names and exposes stable page ids for browser automation', () => {
    renderApp();

    const navigation = within(screen.getByRole('navigation', { name: 'Primary' }));

    expect(navigation.getByRole('button', { name: '工作台' })).toHaveAttribute('data-page-id', 'workbench');
    expect(navigation.getByRole('button', { name: '结果' })).toHaveAttribute('data-page-id', 'results');
    expect(navigation.getByRole('button', { name: '设置' })).toHaveAttribute('data-page-id', 'settings');
  });

  it('shows a standard operation error when initial host loading fails', async () => {
    const client = {
      ...createMockHostClient(),
      async getCapabilities() {
        throw new VideoCutHostApiError({
          status: 503,
          code: 'HOST_UNAVAILABLE',
          message: 'Video cut host is unavailable.',
          traceId: 'trace-startup-001',
          endpoint: 'http://127.0.0.1:6177/api/video-cut/v1/capabilities',
        });
      },
    };

    render(<App client={client} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Load runtime state failed');
    expect(screen.getByText('HOST_UNAVAILABLE')).toBeInTheDocument();
    expect(screen.getByText('trace-startup-001')).toBeInTheDocument();
    expect(screen.getByText('HTTP 503')).toBeInTheDocument();
    expect(screen.getByText('http://127.0.0.1:6177/api/video-cut/v1/capabilities')).toBeInTheDocument();
  });

  it('lets the user retry runtime loading after a startup host failure', async () => {
    const user = userEvent.setup();
    let capabilityAttempts = 0;
    const client = {
      ...createMockHostClient(),
      async getCapabilities() {
        capabilityAttempts += 1;
        if (capabilityAttempts === 1) {
          throw new VideoCutHostApiError({
            status: 503,
            code: 'HOST_UNAVAILABLE',
            message: 'Video cut host is unavailable.',
            traceId: 'trace-startup-retry-001',
            endpoint: 'http://127.0.0.1:6177/api/video-cut/v1/capabilities',
          });
        }
        return createMockHostClient().getCapabilities();
      },
    };

    render(<App client={client} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Load runtime state failed');

    await user.click(screen.getByRole('button', { name: 'Reload runtime state' }));

    expect(await screen.findByLabelText('Capability summary')).toHaveTextContent('LLM not configured');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not swallow unexpected split-plan loading failures during startup', async () => {
    const baseClient = createMockHostClient();
    const task = await baseClient.createTask({
      title: 'plan failure',
      type: 'interview-qa',
    });
    await baseClient.attachTaskSource(task.taskId, {
      contentType: 'video/mp4',
      sourceName: 'plan-failure.mp4',
    });
    await baseClient.analyzeTask(task.taskId);
    const client = {
      ...baseClient,
      async getTaskPlan() {
        throw new VideoCutHostApiError({
          status: 500,
          code: 'PLAN_READ_FAILED',
          message: 'Split plan could not be loaded.',
          traceId: 'trace-plan-read-001',
          endpoint: 'http://127.0.0.1:6177/api/video-cut/v1/tasks/task-0001/plan',
        });
      },
    };

    render(<App client={client} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Load runtime state failed');
    expect(screen.getByText('PLAN_READ_FAILED')).toBeInTheDocument();
    expect(screen.getByText('HTTP 500')).toBeInTheDocument();
    expect(screen.getByText('trace-plan-read-001')).toBeInTheDocument();
    expect(screen.getByText('http://127.0.0.1:6177/api/video-cut/v1/tasks/task-0001/plan')).toBeInTheDocument();
  });

  it('does not swallow task-not-found split-plan failures during startup', async () => {
    const baseClient = createMockHostClient();
    const task = await baseClient.createTask({
      title: 'missing task plan failure',
      type: 'interview-qa',
    });
    await baseClient.attachTaskSource(task.taskId, {
      contentType: 'video/mp4',
      sourceName: 'missing-plan-task.mp4',
    });
    await baseClient.analyzeTask(task.taskId);
    const client = {
      ...baseClient,
      async getTaskPlan() {
        throw new VideoCutHostApiError({
          status: 404,
          code: 'TASK_NOT_FOUND',
          message: 'Task not found: task-0001',
          traceId: 'trace-task-0001',
          endpoint: 'http://127.0.0.1:6177/api/video-cut/v1/tasks/task-0001/plan',
        });
      },
    };

    render(<App client={client} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Load runtime state failed');
    expect(screen.getByText('TASK_NOT_FOUND')).toBeInTheDocument();
    expect(screen.getByText('HTTP 404')).toBeInTheDocument();
    expect(screen.getByText('trace-task-0001')).toBeInTheDocument();
    expect(screen.getByText('http://127.0.0.1:6177/api/video-cut/v1/tasks/task-0001/plan')).toBeInTheDocument();
  });

  it('does not request split plans for draft tasks before analysis', async () => {
    const baseClient = createMockHostClient();
    await baseClient.createTask({
      title: 'draft without generated plan',
      type: 'interview-qa',
    });
    let planReadAttempts = 0;
    const client = {
      ...baseClient,
      async getTaskPlan() {
        planReadAttempts += 1;
        throw new VideoCutHostApiError({
          status: 404,
          code: 'TASK_PLAN_NOT_FOUND',
          message: 'Task plan not found: task-0001',
          traceId: 'trace-task-0001',
          endpoint: 'http://127.0.0.1:6177/api/video-cut/v1/tasks/task-0001/plan',
        });
      },
    };

    render(<App client={client} />);

    expect(await screen.findByRole('button', { name: 'Analyze selected task' })).toBeDisabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(planReadAttempts).toBe(0);
  });

  it('keeps analysis disabled for draft tasks without source media', async () => {
    const client = createMockHostClient();
    await client.createTask({
      title: 'draft without source',
      type: 'single-speaker',
    });

    render(<App client={client} />);

    expect(await screen.findByRole('button', { name: 'Analyze selected task' })).toBeDisabled();
  });

  it('creates a task and moves it through analyze and render from the workbench', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: 'Import sample video' }));
    expect(screen.getByText('Source video uploaded to workspace.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Analyze selected task' }));
    expect(screen.getByText('planReady')).toBeInTheDocument();
    expect(screen.getByText('Transcript, semantic analysis, and split plan generated.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Render selected task' }));
    expect(screen.getByText('succeeded')).toBeInTheDocument();
    expect(screen.getByText(/output.mp4/)).toBeInTheDocument();
    expect(screen.getByText(/subtitles.ass/)).toBeInTheDocument();
    expect(screen.getByText(/cover.png/)).toBeInTheDocument();
    expect(screen.getByText('Rendered MP4, subtitles, cover, and render log.')).toBeInTheDocument();
  });

  it('lets the user review and save the first split segment range', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: 'Import sample video' }));
    await user.click(screen.getByRole('button', { name: 'Analyze selected task' }));

    const startInput = await screen.findByLabelText('Segment start ms');
    const endInput = screen.getByLabelText('Segment end ms');
    expect(startInput).toHaveValue(8000);
    expect(endInput).toHaveValue(78000);

    await user.clear(startInput);
    await user.type(startInput, '500');
    await user.clear(endInput);
    await user.type(endInput, '1800');
    await user.click(screen.getByRole('button', { name: 'Save split plan' }));

    expect(await screen.findByText('Plan revision 2')).toBeInTheDocument();
    expect(screen.getByLabelText('Segment start ms')).toHaveValue(500);
    expect(screen.getByLabelText('Segment end ms')).toHaveValue(1800);
    expect(screen.getByText('manual-override')).toBeInTheDocument();
  });

  it('saves the selected non-first split segment range without mutating the first segment', async () => {
    const user = userEvent.setup();
    const baseClient = createMockHostClient();
    const client = {
      ...baseClient,
      async analyzeTask(taskId: string) {
        const task = await baseClient.analyzeTask(taskId);
        const plan = await baseClient.getTaskPlan(taskId);
        const firstSegment = {
          ...plan.segments[0],
          segmentId: `${taskId}-segment-1`,
          title: 'Opening segment',
          sourceRange: { startMs: 1_000, endMs: 2_500 },
          outputRange: { startMs: 0, endMs: 1_500 },
        };
        const secondSegment = {
          ...plan.segments[0],
          segmentId: `${taskId}-segment-2`,
          title: 'Selected answer',
          sourceRange: { startMs: 3_000, endMs: 4_200 },
          outputRange: { startMs: 0, endMs: 1_200 },
        };
        await baseClient.updateTaskPlan(taskId, {
          ...plan,
          segments: [firstSegment, secondSegment],
        });
        return task;
      },
    };
    render(<App client={client} />);

    await user.click(screen.getByRole('button', { name: 'Import sample video' }));
    await user.click(screen.getByRole('button', { name: 'Analyze selected task' }));
    await user.click(await screen.findByRole('button', { name: /Select timeline segment Selected answer/ }));
    expect(screen.getByLabelText('Segment start ms')).toHaveValue(3000);
    expect(screen.getByLabelText('Segment end ms')).toHaveValue(4200);

    await user.clear(screen.getByLabelText('Segment start ms'));
    await user.type(screen.getByLabelText('Segment start ms'), '5200');
    await user.clear(screen.getByLabelText('Segment end ms'));
    await user.type(screen.getByLabelText('Segment end ms'), '6900');
    await user.click(screen.getByRole('button', { name: 'Save split plan' }));

    await waitFor(async () => {
      const savedPlan = await baseClient.getTaskPlan('task-0001');
      expect(savedPlan.segments[0].sourceRange).toEqual({ startMs: 1_000, endMs: 2_500 });
      expect(savedPlan.segments[0].outputRange).toEqual({ startMs: 0, endMs: 1_500 });
      expect(savedPlan.segments[1].sourceRange).toEqual({ startMs: 5_200, endMs: 6_900 });
      expect(savedPlan.segments[1].outputRange).toEqual({ startMs: 0, endMs: 1_700 });
      expect(savedPlan.segments[1].decisionReasons).toContain('manual-override');
    });
  });

  it('lets the user save render asset preferences from the workbench catalog', async () => {
    const user = userEvent.setup();
    const baseClient = createMockHostClient();
    const assetCatalog: AssetCatalog = {
      schemaId: 'video-cut.asset-catalog.schema.v1',
      assetCatalogVersion: 1,
      generatedAt: '2026-04-27T00:00:00.000Z',
      slots: [
        {
          kind: 'bgm',
          status: 'available',
          configuredPath: '<server-local-path>',
          manifestPath: 'assets://bgm/asset-manifest.json',
          supportedExtensions: ['wav'],
          entries: [
            {
              assetId: 'bgm-1111111111111111',
              path: 'assets://bgm/first-bgm.wav',
              fileName: 'first-bgm.wav',
              sizeBytes: 128,
              sha256: '1'.repeat(64),
              license: 'CC0-1.0',
              source: 'https://example.invalid/first-bgm',
              version: '2026.04',
            },
            {
              assetId: 'bgm-2222222222222222',
              path: 'assets://bgm/selected-bgm.wav',
              fileName: 'selected-bgm.wav',
              sizeBytes: 256,
              sha256: '2'.repeat(64),
              license: 'CC0-1.0',
              source: 'https://example.invalid/selected-bgm',
              version: '2026.04',
            },
          ],
          warnings: [],
        },
        {
          kind: 'sfx',
          status: 'available',
          configuredPath: '<server-local-path>',
          manifestPath: 'assets://sfx/asset-manifest.json',
          supportedExtensions: ['wav'],
          entries: [
            {
              assetId: 'sfx-3333333333333333',
              path: 'assets://sfx/click.wav',
              fileName: 'click.wav',
              sizeBytes: 64,
              sha256: '3'.repeat(64),
              license: 'CC0-1.0',
              source: 'https://example.invalid/click',
              version: '2026.04',
            },
          ],
          warnings: [],
        },
      ],
    };
    let savedRenderPreferences: unknown;
    const client = {
      ...baseClient,
      async getAssetCatalog() {
        return assetCatalog;
      },
      async updateTaskPlan(...args: Parameters<typeof baseClient.updateTaskPlan>) {
        savedRenderPreferences = args[1].renderPreferences;
        return baseClient.updateTaskPlan(...args);
      },
    };
    render(<App client={client} />);

    await user.click(screen.getByRole('button', { name: 'Import sample video' }));
    await user.click(screen.getByRole('button', { name: 'Analyze selected task' }));
    await user.selectOptions(await screen.findByLabelText('BGM asset'), 'bgm-2222222222222222|assets://bgm/selected-bgm.wav');
    await user.selectOptions(screen.getByLabelText('SFX asset'), 'disabled');
    await user.click(screen.getByRole('button', { name: 'Save render assets' }));

    expect(savedRenderPreferences).toEqual({
      audio: {
        bgm: {
          mode: 'asset',
          assetId: 'bgm-2222222222222222',
          path: 'assets://bgm/selected-bgm.wav',
        },
        bgmVolumePercent: 20,
        sfx: {
          mode: 'disabled',
        },
        voiceEnhancement: 'basic',
      },
    });
    expect(await screen.findByText('Plan revision 2')).toBeInTheDocument();
  });

  it('renders existing split plans that do not yet contain render asset preferences', async () => {
    const baseClient = createMockHostClient();
    const task = await baseClient.createTask({
      title: 'legacy plan without preferences',
      type: 'interview-qa',
    });
    await baseClient.attachTaskSource(task.taskId, {
      contentType: 'video/mp4',
      sourceName: 'legacy-plan.mp4',
    });
    await baseClient.analyzeTask(task.taskId);
    const plan = await baseClient.getTaskPlan(task.taskId);
    const legacyPlan = { ...plan, renderPreferences: undefined } as unknown as typeof plan;
    const client = {
      ...baseClient,
      async getTaskPlan() {
        return legacyPlan;
      },
    };

    render(<App client={client} />);

    expect(await screen.findByLabelText('BGM asset')).toHaveValue('auto');
    expect(screen.getByLabelText('SFX asset')).toHaveValue('auto');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a full multi-track NLE timeline after analysis', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: 'Import sample video' }));
    await user.click(screen.getByRole('button', { name: 'Analyze selected task' }));

    const timeline = await screen.findByRole('region', { name: 'NLE timeline' });
    expect(within(timeline).getByText('Source')).toBeInTheDocument();
    expect(within(timeline).getByText('Segments')).toBeInTheDocument();
    expect(within(timeline).getByText('Output')).toBeInTheDocument();
    expect(within(timeline).getByText('Analysis')).toBeInTheDocument();
    expect(within(timeline).getByRole('button', { name: /Select timeline segment/ })).toBeInTheDocument();
  });

  it('lets the user import manual transcript text for the selected plan range', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: 'Import sample video' }));
    await user.click(screen.getByRole('button', { name: 'Analyze selected task' }));

    await user.clear(await screen.findByLabelText('Segment start ms'));
    await user.type(screen.getByLabelText('Segment start ms'), '500');
    await user.clear(screen.getByLabelText('Segment end ms'));
    await user.type(screen.getByLabelText('Segment end ms'), '1800');
    await user.type(screen.getByLabelText('Manual transcript text'), 'Manual subtitle');
    await user.click(screen.getByRole('button', { name: 'Save manual transcript' }));

    expect(await screen.findByText('Manual transcript imported.')).toBeInTheDocument();
    expect(screen.getByText(/analysis\/transcript.json/)).toBeInTheDocument();
  });

  it('keeps the selected task explicit across multiple imported sources', async () => {
    const user = userEvent.setup();
    const view = renderApp();

    await user.click(screen.getByRole('button', { name: 'Import sample video' }));
    await user.selectOptions(screen.getByRole('combobox'), 'long-interview');
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['video-bytes'], 'second-source.mp4', { type: 'video/mp4' }));

    expect(screen.getByText(/workspace\/projects\/default\/tasks\/task-0002\/source\/second-source.mp4/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Select task .*interview\.mp4/ }));

    expect(screen.getByText(/workspace\/projects\/default\/tasks\/task-0001\/source\/interview.mp4/)).toBeInTheDocument();
    expect(screen.queryByText(/workspace\/projects\/default\/tasks\/task-0002\/source\/second-source.mp4/)).not.toBeInTheDocument();
  });

  it('lets the user cancel and delete tasks from the queue', async () => {
    const user = userEvent.setup();
    renderApp();
    const navButtons = within(screen.getByRole('navigation', { name: 'Primary' })).getAllByRole('button');

    await user.click(screen.getByRole('button', { name: 'Import sample video' }));
    await user.click(navButtons[2]);

    await user.click(screen.getByRole('button', { name: /Cancel task .*interview\.mp4/ }));
    expect(await screen.findByText('cancelled')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Delete task .*interview\.mp4/ }));
    expect(screen.queryByText('interview.mp4')).not.toBeInTheDocument();
  });

  it('lets the user retry a failed task from the queue', async () => {
    const user = userEvent.setup();
    const baseClient = createMockHostClient();
    const task = await baseClient.createTask({
      title: 'failed analyze',
      type: 'interview-qa',
    });
    await baseClient.attachTaskSource(task.taskId, {
      sourceName: 'failed-source.mp4',
      sizeBytes: 128_000_000,
      contentType: 'video/mp4',
    });
    let exposeFailedTask = true;
    let retryAttempts = 0;
    const client = {
      ...baseClient,
      async listTasks() {
        const tasks = await baseClient.listTasks();
        if (!exposeFailedTask) {
          return tasks;
        }

        return tasks.map((item) =>
          item.taskId === task.taskId
            ? {
                ...item,
                currentStage: 'analyze',
                progress: 100,
                status: 'failed' as const,
              }
            : item,
        );
      },
      async analyzeTask(taskId: string) {
        retryAttempts += 1;
        exposeFailedTask = false;
        return baseClient.analyzeTask(taskId);
      },
    };
    render(<App client={client} />);
    const navButtons = within(screen.getByRole('navigation', { name: 'Primary' })).getAllByRole('button');

    await user.click(navButtons[2]);
    expect(await screen.findByText('failed')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Retry task .*failed-source\.mp4/ }));

    expect(retryAttempts).toBe(1);
    expect(await screen.findByText('planReady')).toBeInTheDocument();
  });

  it('shows recovery hints from task event metadata in the workbench and queue', async () => {
    const user = userEvent.setup();
    const baseClient = createMockHostClient();
    const task = await baseClient.createTask({
      title: 'failed render',
      type: 'single-speaker',
    });
    await baseClient.attachTaskSource(task.taskId, {
      sourceName: 'broken-render.mp4',
      sizeBytes: 128_000_000,
      contentType: 'video/mp4',
    });
    const recoveryEvent = {
      eventId: `${task.taskId}-event-render-failed`,
      taskId: task.taskId,
      stage: 'render',
      progress: 100,
      message: 'Render failed with a redacted FFmpeg error.',
      traceId: `trace-${task.taskId}`,
      level: 'error' as const,
      metadata: {
        recoveryHint: {
          code: 'RENDER_FAILED_REVIEW_LOG',
          action: 'retry-render' as const,
          label: 'Review render log and retry render',
          message: 'Open the render log artifact, verify FFmpeg/media settings, then retry rendering this task.',
          retryable: true,
          targetStage: 'render',
        },
      },
    };
    const client = {
      ...baseClient,
      async listTasks() {
        const tasks = await baseClient.listTasks();
        return tasks.map((item) =>
          item.taskId === task.taskId
            ? {
                ...item,
                currentStage: 'render',
                progress: 100,
                status: 'failed' as const,
              }
            : item,
        );
      },
      async getTaskEvents(taskId: string) {
        return taskId === task.taskId ? [recoveryEvent] : baseClient.getTaskEvents(taskId);
      },
    };
    render(<App client={client} />);

    expect(await screen.findByText('Review render log and retry render')).toBeInTheDocument();
    expect(screen.getByText('Open the render log artifact, verify FFmpeg/media settings, then retry rendering this task.')).toBeInTheDocument();

    const navButtons = within(screen.getByRole('navigation', { name: 'Primary' })).getAllByRole('button');
    await user.click(navButtons[2]);

    expect(await screen.findByRole('note', { name: /Recovery hint for .*broken-render\.mp4/ })).toHaveTextContent(
      'Review render log and retry render',
    );
  });

  it('allows a succeeded task to be rendered again as a distinct render attempt', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: 'Import sample video' }));
    await user.click(screen.getByRole('button', { name: 'Analyze selected task' }));
    await user.click(screen.getByRole('button', { name: 'Render selected task' }));
    expect(await screen.findByText(/renders\/task-0001-render-1\/output.mp4/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Render selected task' }));

    expect(await screen.findByText(/renders\/task-0001-render-2\/output.mp4/)).toBeInTheDocument();
  });

  it('renders every split plan segment when the selected task has multiple segments', async () => {
    const user = userEvent.setup();
    const baseClient = createMockHostClient();
    const client = {
      ...baseClient,
      async analyzeTask(taskId: string) {
        const task = await baseClient.analyzeTask(taskId);
        const plan = await baseClient.getTaskPlan(taskId);
        const firstSegment = {
          ...plan.segments[0],
          segmentId: `${taskId}-segment-1`,
          sourceRange: { startMs: 1_000, endMs: 2_500 },
          outputRange: { startMs: 0, endMs: 1_500 },
        };
        const secondSegment = {
          ...plan.segments[0],
          segmentId: `${taskId}-segment-2`,
          sourceRange: { startMs: 3_000, endMs: 4_200 },
          outputRange: { startMs: 0, endMs: 1_200 },
        };
        await baseClient.updateTaskPlan(taskId, {
          ...plan,
          segments: [firstSegment, secondSegment],
        });
        return task;
      },
    };
    render(<App client={client} />);

    await user.click(screen.getByRole('button', { name: 'Import sample video' }));
    await user.click(screen.getByRole('button', { name: 'Analyze selected task' }));
    await user.click(screen.getByRole('button', { name: 'Render selected task' }));

    expect(await screen.findByText(/renders\/task-0001-render-1\/output.mp4/)).toBeInTheDocument();
    expect(await screen.findByText(/renders\/task-0001-render-2\/output.mp4/)).toBeInTheDocument();
  });

  it('imports and exports subtitle files from the workbench', async () => {
    const user = userEvent.setup();
    const baseClient = createMockHostClient();
    let importAttempts = 0;
    const client = {
      ...baseClient,
      async importTaskSubtitles(...args: Parameters<typeof baseClient.importTaskSubtitles>) {
        importAttempts += 1;
        return baseClient.importTaskSubtitles(...args);
      },
    };
    const view = render(<App client={client} />);

    await user.click(screen.getByRole('button', { name: 'Import sample video' }));
    await user.click(screen.getByRole('button', { name: 'Analyze selected task' }));
    expect(screen.getByText('planReady')).toBeInTheDocument();
    const subtitleInput = view.container.querySelector('input[aria-label="Import subtitle file"]') as HTMLInputElement;
    await user.upload(
      subtitleInput,
      new File(['1\n00:00:00,500 --> 00:00:01,800\nHello world\n'], 'captions.srt', { type: 'application/x-subrip' }),
    );
    await waitFor(() => {
      expect(importAttempts).toBe(1);
    });
    await waitFor(async () => {
      expect((await baseClient.getTask('task-0001')).currentStage).toBe('subtitle');
    });

    await user.click(screen.getByRole('button', { name: 'Export VTT subtitles' }));

    await waitFor(async () => {
      expect((await baseClient.getTaskArtifacts('task-0001')).some((artifact) => artifact.path.endsWith('subtitles-export.vtt'))).toBe(true);
    });
    expect(await screen.findByText(/analysis\/subtitles-export\.vtt/)).toBeInTheDocument();
    expect(await screen.findByText('Subtitle vtt exported.')).toBeInTheDocument();
  });

  it('imports a local video file with the selected cut type', async () => {
    const user = userEvent.setup();
    const view = renderApp();

    await user.selectOptions(screen.getByRole('combobox'), 'long-interview');
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toContain('.mp4');
    expect(input.accept).toContain('.webm');
    await user.upload(input, new File(['video-bytes'], 'long-interview-source.mp4', { type: 'video/mp4' }));

    expect(screen.getByText('long-interview-source')).toBeInTheDocument();
    expect(screen.getByText('long-interview-source.mp4')).toBeInTheDocument();
    expect(screen.getByText('long-interview')).toBeInTheDocument();
    expect(screen.getByText('Source video uploaded to workspace.')).toBeInTheDocument();
    expect(screen.getByText(/workspace\/projects\/default\/tasks\/task-0001\/source\/long-interview-source.mp4/)).toBeInTheDocument();
  });

  it('opens the settings center from primary navigation', async () => {
    const user = userEvent.setup();
    renderApp();
    const navButtons = within(screen.getByRole('navigation', { name: 'Primary' })).getAllByRole('button');

    await user.click(navButtons.at(-1)!);

    expect(screen.getByRole('heading', { name: '设置中心' })).toBeInTheDocument();
    const settings = screen.getByRole('region', { name: 'Settings sections' });
    expect(within(settings).getByRole('button', { name: /AI Providers/ })).toBeInTheDocument();
    expect(within(settings).getByRole('button', { name: /Speech To Text/ })).toBeInTheDocument();
  });

  it('opens diagnostics with deployment doctor checks', async () => {
    const user = userEvent.setup();
    renderApp();
    const navButtons = within(screen.getByRole('navigation', { name: 'Primary' })).getAllByRole('button');

    await user.click(navButtons[4]);

    expect(screen.getByText('Deployment Doctor')).toBeInTheDocument();
    expect(screen.getByText('Host health')).toBeInTheDocument();
    expect(screen.getByText('Workspace writable')).toBeInTheDocument();
    expect(screen.getByText('OpenAI-compatible provider policy active')).toBeInTheDocument();
  });

  it('exports a downloadable diagnostics bundle from the diagnostics page', async () => {
    const user = userEvent.setup();
    renderApp();
    const navButtons = within(screen.getByRole('navigation', { name: 'Primary' })).getAllByRole('button');

    await user.click(navButtons[4]);
    await user.click(screen.getByRole('button', { name: /Export diagnostics/ }));

    const downloadLink = await screen.findByRole('link', { name: 'Download diagnostics JSON' });
    expect(downloadLink.getAttribute('download')).toMatch(/^sdkwork-video-cut-diagnostics-desktop-local-.*\.json$/);
    expect(downloadLink.getAttribute('href')).toMatch(/^data:application\/vnd\.sdkwork\.video-cut\.diagnostics\+json;charset=utf-8,/);
    expect(screen.getByText(/redaction verified/i)).toBeInTheDocument();
  });

  it('requires explicit consent before exporting diagnostics support attachments', async () => {
    const user = userEvent.setup();
    renderApp();
    const navButtons = within(screen.getByRole('navigation', { name: 'Primary' })).getAllByRole('button');

    await user.click(screen.getByRole('button', { name: 'Import sample video' }));
    await screen.findByText('Source video uploaded to workspace.');
    await user.click(navButtons[4]);

    const exportButton = screen.getByRole('button', { name: /Export support bundle/ });
    expect(exportButton).toBeDisabled();

    await user.click(screen.getByLabelText('Include source media attachment'));
    expect(exportButton).toBeDisabled();

    await user.click(screen.getByLabelText('I understand this support bundle may include task media or transcript data'));
    await user.click(exportButton);

    expect(await screen.findByText('sourceMedia: true')).toBeInTheDocument();
    expect(screen.getByText('sourceMedia')).toBeInTheDocument();
    expect(screen.getByText(/task-0001-source/)).toBeInTheDocument();
  });

  it('shows standard operation errors when diagnostics export fails', async () => {
    const user = userEvent.setup();
    const client = {
      ...createMockHostClient(),
      async getDiagnosticBundle() {
        throw new VideoCutHostApiError({
          status: 500,
          code: 'DIAGNOSTICS_EXPORT_FAILED',
          message: 'Diagnostics bundle export failed.',
          traceId: 'trace-diagnostics-001',
          endpoint: 'http://127.0.0.1:6177/api/video-cut/v1/diagnostics/bundle',
        });
      },
    };
    render(<App client={client} />);
    const navButtons = within(screen.getByRole('navigation', { name: 'Primary' })).getAllByRole('button');

    await user.click(navButtons[4]);
    await user.click(screen.getByRole('button', { name: /Export diagnostics/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Export diagnostics failed');
    expect(screen.getByText('DIAGNOSTICS_EXPORT_FAILED')).toBeInTheDocument();
    expect(screen.getByText('trace-diagnostics-001')).toBeInTheDocument();
    expect(screen.getByText('HTTP 500')).toBeInTheDocument();
    expect(screen.getByText('http://127.0.0.1:6177/api/video-cut/v1/diagnostics/bundle')).toBeInTheDocument();
  });

  it('shows standard host operation errors with code and trace evidence', async () => {
    const user = userEvent.setup();
    const client = createMockHostClient();
    const task = await client.createTask({
      title: 'render failure',
      type: 'interview-qa',
    });
    await client.attachTaskSource(task.taskId, {
      sourceName: 'failure.mp4',
      sizeBytes: 128_000_000,
      contentType: 'video/mp4',
    });
    await client.analyzeTask(task.taskId);
    const failingClient = {
      ...client,
      async renderTask() {
        throw new VideoCutHostApiError({
          status: 500,
          code: 'FFMPEG_RENDER_FAILED',
          message: 'FFmpeg render failed with status 1.',
          traceId: 'trace-render-001',
          endpoint: 'http://127.0.0.1:6177/api/video-cut/v1/tasks/task-0001/render',
        });
      },
    };
    render(<App client={failingClient} />);

    expect(await screen.findByText('planReady')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Render selected task' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Render task failed');
    expect(screen.getByText('FFMPEG_RENDER_FAILED')).toBeInTheDocument();
    expect(screen.getByText('trace-render-001')).toBeInTheDocument();
    expect(screen.getByText('HTTP 500')).toBeInTheDocument();
    expect(screen.getByText('http://127.0.0.1:6177/api/video-cut/v1/tasks/task-0001/render')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Dismiss operation error' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
