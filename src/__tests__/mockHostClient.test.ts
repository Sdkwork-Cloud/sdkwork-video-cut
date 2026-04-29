import { describe, expect, it } from 'vitest';

import { createDefaultSettings } from '../domain/videoCutTypes';
import { VideoCutHostApiError } from '../services/httpHostClient';
import { createMemoryHostStore, createMockHostClient } from '../services/mockHostClient';

type MockVideoCutHostClient = ReturnType<typeof createMockHostClient>;

async function attachVideoSource(client: MockVideoCutHostClient, taskId: string, sourceName = 'interview.mp4') {
  await client.attachTaskSource(taskId, {
    sourceName,
    sizeBytes: 128_000_000,
    contentType: 'video/mp4',
  });
}

describe('createMockHostClient', () => {
  it('returns a capability report derived from settings', async () => {
    const client = createMockHostClient();

    const capability = await client.getCapabilities();

    expect(capability.reportVersion).toBe('video-cut.capability.v1');
    expect(capability.ai.status).toBe('warn');
    expect(capability.media.status).toBe('ok');
  });

  it('returns a deployment doctor report with redacted effective settings', async () => {
    const client = createMockHostClient();
    const settings = createDefaultSettings();
    settings.ai.enabled = true;
    settings.ai.apiKeyConfigured = true;
    (settings.ai as typeof settings.ai & { apiKey: string }).apiKey = 'sk-plain-ui-secret';

    await client.updateSettings(settings);
    const report = await client.getDoctorReport();

    expect(report.reportVersion).toBe('video-cut.doctor.v1');
    expect(report.capability.reportVersion).toBe('video-cut.capability.v1');
    expect(report.checks.map((check) => check.checkId)).toEqual(
      expect.arrayContaining(['health', 'workspaceWritable', 'ffmpeg', 'ffprobe', 'providerPolicy', 'settingsValidation', 'redaction']),
    );
    expect(JSON.stringify(report.redactedConfig)).not.toContain('sk-plain-ui-secret');
    expect(report.redactedConfig.ai.apiKeyConfigured).toBe(true);
  });

  it('returns a standard asset catalog without leaking absolute local asset paths', async () => {
    const client = createMockHostClient();
    const settings = createDefaultSettings();
    settings.assets.bgm = 'D:\\private\\video-cut\\assets\\bgm';
    settings.assets.sfx = 'assets/sfx';

    await client.updateSettings(settings);
    const catalog = await (client as any).getAssetCatalog();

    expect(catalog).toMatchObject({
      assetCatalogVersion: 1,
      schemaId: 'video-cut.asset-catalog.schema.v1',
    });
    expect(catalog.slots.map((slot: Record<string, unknown>) => slot.kind)).toEqual([
      'fonts',
      'bgm',
      'sfx',
      'coverTemplates',
    ]);
    expect(catalog.slots.find((slot: Record<string, unknown>) => slot.kind === 'bgm')).toMatchObject({
      configuredPath: '<server-local-path>',
      status: 'not-configured',
    });
    expect(JSON.stringify(catalog)).not.toContain('D:\\private');
  });

  it('redacts absolute local storage paths from doctor and diagnostics reports', async () => {
    const client = createMockHostClient();
    const settings = createDefaultSettings();
    settings.storage.workspaceRoot = 'D:\\private\\video-cut\\workspace';
    settings.storage.artifactRoot = 'D:\\private\\video-cut\\workspace\\artifacts';
    settings.storage.tempRoot = 'D:\\private\\video-cut\\workspace\\tmp';

    await client.updateSettings(settings);
    const report = await client.getDoctorReport();
    const bundle = await client.getDiagnosticBundle();

    expect(JSON.stringify(report)).not.toContain('D:\\private');
    expect(JSON.stringify(bundle)).not.toContain('D:\\private');
    expect(report.redactedConfig.storage.workspaceRoot).toBe('<redacted-path>');
    expect(report.checks.find((check) => check.checkId === 'workspaceWritable')?.details?.path).toBe('<redacted-path>');
    expect(bundle.redactedConfig.storage.tempRoot).toBe('<redacted-path>');
  });

  it('exports a redacted diagnostics bundle without source media or transcript by default', async () => {
    const client = createMockHostClient();
    const settings = createDefaultSettings();
    settings.ai.enabled = true;
    settings.ai.apiKeyConfigured = true;
    (settings.ai as typeof settings.ai & { apiKey: string }).apiKey = 'sk-plain-diagnostics-secret';

    await client.updateSettings(settings);
    const bundle = await client.getDiagnosticBundle();

    expect(bundle.bundleVersion).toBe('video-cut.diagnostics-bundle.v1');
    expect(bundle.includes).toEqual({ sourceMedia: false, transcript: false });
    expect(bundle.doctor.reportVersion).toBe('video-cut.doctor.v1');
    expect(JSON.stringify(bundle)).not.toContain('sk-plain-diagnostics-secret');
    expect(JSON.stringify(bundle)).not.toContain('"apiKey"');
  });

  it('returns a redacted OpenAI-compatible provider conformance report', async () => {
    const client = createMockHostClient();
    const settings = createDefaultSettings();
    settings.ai.enabled = true;
    settings.ai.baseUrl = 'https://api.example.com/v1';
    settings.ai.apiKeyConfigured = true;
    (settings.ai as typeof settings.ai & { apiKey: string }).apiKey = 'sk-plain-provider-secret';
    settings.speechToText.enabled = true;
    settings.speechToText.reuseAiProviderConnection = true;

    await client.updateSettings(settings);
    const report = await client.runProviderConformance('all');

    expect(report.reportVersion).toBe('video-cut.provider-conformance.v1');
    expect(report.status).toBe('ok');
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          checkId: 'llm.endpoint.chatCompletions',
          details: expect.objectContaining({
            endpoint: 'https://api.example.com/v1/chat/completions',
            credentialStatus: 'configured',
          }),
        }),
        expect.objectContaining({
          checkId: 'stt.provider.bridge',
          details: expect.objectContaining({
            providerProfile: 'openai-audio-transcriptions',
            vendorEndpoint: 'https://api.example.com/v1/audio/transcriptions',
            canonicalRequest: 'openai-audio-transcriptions.verbose-json',
          }),
        }),
      ]),
    );
    expect(JSON.stringify(report)).not.toContain('sk-plain-provider-secret');
    expect(JSON.stringify(report)).not.toContain('"apiKey"');
  });

  it('does not emit secret reference field names in invalid provider conformance reports', async () => {
    const client = createMockHostClient();

    const report = await client.runProviderConformance('all');
    const serialized = JSON.stringify(report);

    expect(report.status).toBe('fail');
    expect(serialized).not.toContain('"apiKey"');
    expect(serialized).not.toContain('apiKeySecretRef');
    expect(serialized).not.toContain('credentialSecretRef');
    expect(serialized).not.toContain('secretRef');
    expect(serialized).toContain('credentialStatus');
    expect(serialized).toContain('not-configured');
  });

  it('reports vendor speech bridge conformance without leaking credentials', async () => {
    const client = createMockHostClient();
    const settings = createDefaultSettings();
    settings.speechToText.enabled = true;
    settings.speechToText.providerProfile = 'aliyun-qwen-asr';
    settings.speechToText.reuseAiProviderConnection = false;
    settings.speechToText.baseUrl = 'https://dashscope.aliyuncs.com';
    settings.speechToText.apiKeyConfigured = true;
    settings.speechToText.transcriptionModel = 'qwen3-asr-flash';
    (settings.speechToText as typeof settings.speechToText & { apiKey: string }).apiKey = 'aliyun-plain-secret';

    await client.updateSettings(settings);
    const report = await client.runProviderConformance('speechToText');

    expect(report.providerId).toBe('runtime-speech-to-text-bridge');
    expect(report.status).toBe('ok');
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        checkId: 'stt.provider.bridge',
        details: expect.objectContaining({
          providerProfile: 'aliyun-qwen-asr',
          vendorEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
          credentialStatus: 'configured',
        }),
      }),
    );
    expect(JSON.stringify(report)).not.toContain('aliyun-plain-secret');
    expect(JSON.stringify(report)).not.toContain('"apiKey"');
  });

  it('reports Volcengine resource metadata through safe provider conformance details', async () => {
    const client = createMockHostClient();
    const settings = createDefaultSettings();
    settings.speechToText.enabled = true;
    settings.speechToText.providerProfile = 'volcengine-bigasr-flash';
    settings.speechToText.reuseAiProviderConnection = false;
    settings.speechToText.baseUrl = 'https://openspeech.bytedance.com';
    settings.speechToText.apiKeyConfigured = true;
    settings.speechToText.transcriptionModel = 'bigmodel';
    settings.speechToText.resourceId = 'volc.bigasr.auc';

    await client.updateSettings(settings);
    const report = await client.runProviderConformance('speechToText');

    expect(report.status).toBe('ok');
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        checkId: 'stt.provider.bridge',
        details: expect.objectContaining({
          providerProfile: 'volcengine-bigasr-flash',
          resourceId: 'volc.bigasr.auc',
          vendorEndpoint: 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash',
        }),
      }),
    );
  });

  it('persists valid settings and updates capabilities', async () => {
    const client = createMockHostClient();
    const settings = createDefaultSettings();
    settings.ai.enabled = true;
    settings.ai.apiKeyConfigured = true;

    const result = await client.updateSettings(settings);
    const capability = await client.getCapabilities();

    expect(result.valid).toBe(true);
    expect(capability.ai.status).toBe('ok');
  });

  it('requires a configured AI provider before reused STT connection is ready', async () => {
    const client = createMockHostClient();
    const settings = createDefaultSettings();
    settings.speechToText.enabled = true;
    settings.speechToText.reuseAiProviderConnection = true;

    await client.updateSettings(settings);
    expect((await client.getCapabilities()).speechToText.status).toBe('warn');

    settings.ai.enabled = true;
    settings.ai.apiKeyConfigured = true;
    await client.updateSettings(settings);

    expect((await client.getCapabilities()).speechToText.status).toBe('ok');
  });

  it('rejects invalid settings without replacing current settings', async () => {
    const client = createMockHostClient();
    const settings = createDefaultSettings();
    settings.ai.enabled = true;
    settings.ai.baseUrl = 'bad';

    const result = await client.updateSettings(settings);
    const current = await client.getSettings();

    expect(result.valid).toBe(false);
    expect(current.ai.enabled).toBe(false);
  });

  it('restores saved settings and task metadata from a host store snapshot', async () => {
    const store = createMemoryHostStore();
    const firstClient = createMockHostClient(undefined, store);
    const settings = createDefaultSettings();
    settings.ai.enabled = true;
    settings.ai.apiKeyConfigured = true;

    await firstClient.updateSettings(settings);
    const savedTask = await firstClient.createTask({
      title: '本地访谈',
      type: 'long-interview',
    });
    await attachVideoSource(firstClient, savedTask.taskId, 'local.mp4');

    const secondClient = createMockHostClient(undefined, store);

    expect((await secondClient.getSettings()).ai.enabled).toBe(true);
    expect(await secondClient.listTasks()).toContainEqual(
      expect.objectContaining({
        title: '本地访谈',
        sourceName: 'local.mp4',
      }),
    );
  });

  it('orders local mock tasks by updated time with the same task-id tiebreaker as Host', async () => {
    const client = createMockHostClient();
    await client.createTask({
      title: 'first',
      type: 'single-speaker',
    });
    await client.createTask({
      title: 'second',
      type: 'single-speaker',
    });

    expect((await client.listTasks()).map((task) => task.taskId)).toEqual(['task-0002', 'task-0001']);
  });

  it('creates, analyzes, and renders a task with event history', async () => {
    const client = createMockHostClient();
    const task = await client.createTask({
      title: '张老师访谈拆条',
      type: 'interview-qa',
    });
    await client.attachTaskSource(task.taskId, {
      sourceName: 'interview.mp4',
      sizeBytes: 128_000_000,
      contentType: 'video/mp4',
    });

    expect(task.status).toBe('draft');

    const analyzed = await client.analyzeTask(task.taskId);
    expect(analyzed.status).toBe('planReady');
    expect(await client.getTaskPlan(task.taskId)).toMatchObject({
      planVersion: 1,
      schemaId: 'video-cut.split-plan.schema.v1',
      taskId: task.taskId,
    });
    expect((await client.getTaskPlan(task.taskId)).tracks.find((track) => track.kind === 'mediaInfoTrack')?.sourceArtifactId).toBe(
      `${task.taskId}-media-info`,
    );

    const rendered = await client.renderTask(task.taskId);
    expect(rendered.status).toBe('succeeded');

    const events = await client.getTaskEvents(task.taskId);
    const artifacts = await client.getTaskArtifacts(task.taskId);

    expect(events.map((event) => event.stage)).toEqual(['import', 'analyze', 'render']);
    expect(artifacts).toContainEqual(
      expect.objectContaining({
        artifactId: `${task.taskId}-media-info`,
        kind: 'analysis',
        path: expect.stringContaining('/analysis/media-info.json'),
      }),
    );
    expect(artifacts).toContainEqual(
      expect.objectContaining({
        artifactId: `${task.taskId}-audio-extract`,
        kind: 'analysis',
        path: expect.stringContaining('/analysis/audio-extract.json'),
      }),
    );
    expect(artifacts).toContainEqual(
      expect.objectContaining({
        artifactId: `${task.taskId}-silence-ranges`,
        kind: 'analysis',
        path: expect.stringContaining('/analysis/silence-ranges.json'),
      }),
    );
    expect(artifacts).toContainEqual(
      expect.objectContaining({
        artifactId: `${task.taskId}-vad-ranges`,
        kind: 'analysis',
        path: expect.stringContaining('/analysis/vad-ranges.json'),
      }),
    );
    expect(artifacts).toContainEqual(
      expect.objectContaining({
        artifactId: `${task.taskId}-transcript`,
        kind: 'analysis',
        path: expect.stringContaining('/analysis/transcript.json'),
      }),
    );
    expect((await client.getTaskPlan(task.taskId)).tracks.find((track) => track.kind === 'transcriptTrack')?.sourceArtifactId).toBe(
      `${task.taskId}-transcript`,
    );
    expect(artifacts).toContainEqual(
      expect.objectContaining({
        artifactId: `${task.taskId}-semantic-analysis`,
        kind: 'analysis',
        path: expect.stringContaining('/analysis/semantic-analysis.json'),
      }),
    );
    expect((await client.getTaskPlan(task.taskId)).tracks.find((track) => track.kind === 'semanticTrack')?.sourceArtifactId).toBe(
      `${task.taskId}-semantic-analysis`,
    );
    expect(artifacts).toContainEqual(
      expect.objectContaining({
        kind: 'render',
        path: expect.stringContaining('output.mp4'),
      }),
    );
    expect(artifacts).toContainEqual(
      expect.objectContaining({
        kind: 'subtitle',
        path: expect.stringContaining('subtitles.ass'),
      }),
    );
    expect(artifacts).toContainEqual(
      expect.objectContaining({
        kind: 'cover',
        path: expect.stringContaining('cover.png'),
      }),
    );
    expect(artifacts).toContainEqual(
      expect.objectContaining({
        kind: 'render-manifest',
        path: expect.stringContaining('render.json'),
      }),
    );
    expect(artifacts).toContainEqual(
      expect.objectContaining({
        kind: 'log',
        path: expect.stringContaining('render.log'),
      }),
    );
    expect(events.at(-1)?.message).toBe('Rendered MP4, subtitles, cover, and render log.');
  });

  it('creates draft tasks without publishing fake source artifacts', async () => {
    const client = createMockHostClient();
    const task = await client.createTask({
      title: 'empty task',
      type: 'single-speaker',
    });

    expect(task).toMatchObject({
      status: 'draft',
      progress: 0,
      currentStage: 'draft',
    });
    expect(task.sourceName).toBeUndefined();
    expect((await client.getTaskArtifacts(task.taskId)).some((artifact) => artifact.kind === 'source')).toBe(false);
    expect(await client.getTaskEvents(task.taskId)).toEqual([]);
  });

  it('rejects analysis for draft tasks without source artifacts', async () => {
    const client = createMockHostClient();
    const task = await client.createTask({
      title: 'empty analysis',
      type: 'single-speaker',
    });

    await expect(client.analyzeTask(task.taskId)).rejects.toThrow(/source file must be uploaded/i);
    expect(await client.getTask(task.taskId)).toMatchObject({
      status: 'draft',
      progress: 0,
    });
    expect(await client.getTaskArtifacts(task.taskId)).toEqual([]);
  });

  it('throws standard host api errors for missing tasks in local mock mode', async () => {
    const client = createMockHostClient();

    await expect(client.getTask('missing-task')).rejects.toMatchObject({
      name: 'VideoCutHostApiError',
      status: 404,
      code: 'TASK_NOT_FOUND',
      traceId: 'trace-missing-task',
      endpoint: 'mock://video-cut/tasks/missing-task',
    });
    await expect(client.getTask('missing-task')).rejects.toBeInstanceOf(VideoCutHostApiError);
    await expect(client.getTaskEvents('missing-task')).rejects.toMatchObject({
      status: 404,
      code: 'TASK_NOT_FOUND',
      endpoint: 'mock://video-cut/tasks/missing-task/events',
    });
    await expect(client.getTaskArtifacts('missing-task')).rejects.toMatchObject({
      status: 404,
      code: 'TASK_NOT_FOUND',
      endpoint: 'mock://video-cut/tasks/missing-task/artifacts',
    });
    await expect(client.getArtifactDownload('missing-task', 'missing-artifact')).rejects.toMatchObject({
      status: 404,
      code: 'TASK_NOT_FOUND',
      endpoint: 'mock://video-cut/tasks/missing-task/artifacts',
    });
    await expect(client.getArtifactContent('missing-task', 'missing-artifact')).rejects.toMatchObject({
      status: 404,
      code: 'TASK_NOT_FOUND',
      endpoint: 'mock://video-cut/tasks/missing-task/artifacts',
    });
  });

  it('throws standard host api errors for invalid source uploads in local mock mode', async () => {
    const client = createMockHostClient();
    const task = await client.createTask({
      title: 'invalid source',
      type: 'single-speaker',
    });

    await expect(client.uploadTaskSourceFile(task.taskId, new File(['not-video'], 'notes.txt', { type: 'text/plain' }))).rejects.toMatchObject({
      name: 'VideoCutHostApiError',
      status: 400,
      code: 'SOURCE_FILE_TYPE_UNSUPPORTED',
      traceId: `trace-${task.taskId}`,
      endpoint: `mock://video-cut/tasks/${task.taskId}/source/file`,
    });
  });

  it('throws standard host api errors for missing source before analysis in local mock mode', async () => {
    const client = createMockHostClient();
    const task = await client.createTask({
      title: 'missing source',
      type: 'single-speaker',
    });

    await expect(client.analyzeTask(task.taskId)).rejects.toMatchObject({
      name: 'VideoCutHostApiError',
      status: 400,
      code: 'SOURCE_FILE_REQUIRED',
      traceId: `trace-${task.taskId}`,
      endpoint: `mock://video-cut/tasks/${task.taskId}/analyze`,
    });
  });

  it('throws standard host api errors for missing artifacts in local mock mode', async () => {
    const client = createMockHostClient();
    const task = await client.createTask({
      title: 'missing artifact',
      type: 'single-speaker',
    });

    await expect(client.getArtifactContent(task.taskId, 'missing-artifact')).rejects.toMatchObject({
      name: 'VideoCutHostApiError',
      status: 404,
      code: 'ARTIFACT_NOT_FOUND',
      traceId: `trace-${task.taskId}`,
      endpoint: `mock://video-cut/tasks/${task.taskId}/artifacts/missing-artifact/content`,
    });
  });

  it('throws standard host api errors for diagnostics support consent failures in local mock mode', async () => {
    const client = createMockHostClient();

    await expect(
      client.getDiagnosticSupportBundle({
        includeSourceMedia: true,
        includeTranscript: false,
        taskId: 'task-0001',
        consentAccepted: false,
      }),
    ).rejects.toMatchObject({
      name: 'VideoCutHostApiError',
      status: 400,
      code: 'DIAGNOSTICS_CONSENT_REQUIRED',
      traceId: 'trace-diagnostics-support-bundle',
      endpoint: 'mock://video-cut/diagnostics/support-bundle',
    });
  });

  it('updates manual transcripts as standard transcript documents', async () => {
    const client = createMockHostClient();
    const task = await client.createTask({
      title: 'manual transcript',
      type: 'single-speaker',
    });
    await attachVideoSource(client, task.taskId, 'manual.mp4');
    await client.analyzeTask(task.taskId);

    const transcript = await client.updateTaskTranscript(task.taskId, {
      language: 'en',
      segments: [{ startMs: 500, endMs: 1800, text: 'Manual subtitle' }],
    });

    expect(transcript).toMatchObject({
      adapterVersion: 'manual-transcript.adapter.v1',
      language: 'en',
      providerId: 'manual-transcript',
      schemaId: 'video-cut.transcript.schema.v1',
      transcriptStatus: 'ok',
    });
    expect(transcript.segments).toEqual([
      expect.objectContaining({
        startMs: 500,
        endMs: 1800,
        text: 'Manual subtitle',
      }),
    ]);
    const artifacts = await client.getTaskArtifacts(task.taskId);
    expect(artifacts.filter((artifact) => artifact.artifactId === `${task.taskId}-transcript`)).toHaveLength(1);
    expect((await client.getTaskEvents(task.taskId)).map((event) => event.stage)).toContain('transcript');
  });

  it('rejects source, plan, transcript, and subtitle mutations while a task is rendering', async () => {
    const store = createMemoryHostStore();
    const setupClient = createMockHostClient(undefined, store);
    const task = await setupClient.createTask({
      title: 'rendering mutation guard',
      type: 'single-speaker',
    });
    await attachVideoSource(setupClient, task.taskId);
    await setupClient.analyzeTask(task.taskId);
    const snapshot = store.load();
    expect(snapshot).toBeDefined();
    snapshot!.tasks = snapshot!.tasks.map((item) =>
      item.taskId === task.taskId ? { ...item, status: 'rendering', currentStage: 'render', progress: 80 } : item,
    );
    store.save(snapshot!);

    const client = createMockHostClient(undefined, store);
    const plan = await client.getTaskPlan(task.taskId);

    await expect(client.updateTaskPlan(task.taskId, plan)).rejects.toMatchObject({
      code: 'TASK_BUSY',
      status: 409,
    });
    await expect(
      client.updateTaskTranscript(task.taskId, {
        language: 'en',
        segments: [{ startMs: 500, endMs: 1800, text: 'Should not replace while rendering' }],
      }),
    ).rejects.toMatchObject({
      code: 'TASK_BUSY',
      status: 409,
    });
    await expect(
      client.importTaskSubtitles(task.taskId, {
        format: 'srt',
        language: 'en',
        content: '1\n00:00:00,500 --> 00:00:01,800\nShould not import\n',
      }),
    ).rejects.toMatchObject({
      code: 'TASK_BUSY',
      status: 409,
    });
    await expect(client.exportTaskSubtitles(task.taskId, 'vtt')).rejects.toMatchObject({
      code: 'TASK_BUSY',
      status: 409,
    });
    await expect(client.uploadTaskSourceFile(task.taskId, new File(['video'], 'replacement.mp4', { type: 'video/mp4' }))).rejects.toMatchObject({
      code: 'TASK_BUSY',
      status: 409,
    });
    await expect(
      client.attachTaskSource(task.taskId, {
        sourceName: 'replacement.mp4',
        sizeBytes: 2048,
        contentType: 'video/mp4',
      }),
    ).rejects.toMatchObject({
      code: 'TASK_BUSY',
      status: 409,
    });
    await expect(client.deleteTask(task.taskId)).rejects.toMatchObject({
      code: 'TASK_BUSY',
      status: 409,
    });

    await expect(client.getTask(task.taskId)).resolves.toMatchObject({
      currentStage: 'render',
      status: 'rendering',
    });
  });

  it('rejects duplicate local mock analyze and render operations with standard busy errors', async () => {
    const store = createMemoryHostStore();
    const setupClient = createMockHostClient(undefined, store);
    const task = await setupClient.createTask({
      title: 'busy operation guard',
      type: 'single-speaker',
    });
    await attachVideoSource(setupClient, task.taskId);
    await setupClient.analyzeTask(task.taskId);
    let snapshot = store.load();
    expect(snapshot).toBeDefined();
    snapshot!.tasks = snapshot!.tasks.map((item) =>
      item.taskId === task.taskId ? { ...item, status: 'rendering', currentStage: 'render', progress: 80 } : item,
    );
    store.save(snapshot!);

    let client = createMockHostClient(undefined, store);
    await expect(client.renderTask(task.taskId)).rejects.toMatchObject({
      code: 'RENDER_ALREADY_RUNNING',
      status: 409,
    });
    await expect(client.analyzeTask(task.taskId)).rejects.toMatchObject({
      code: 'TASK_BUSY',
      status: 409,
    });

    snapshot = store.load();
    expect(snapshot).toBeDefined();
    snapshot!.tasks = snapshot!.tasks.map((item) =>
      item.taskId === task.taskId ? { ...item, status: 'analyzing', currentStage: 'analyze', progress: 10 } : item,
    );
    store.save(snapshot!);

    client = createMockHostClient(undefined, store);
    await expect(client.analyzeTask(task.taskId)).rejects.toMatchObject({
      code: 'ANALYZE_ALREADY_RUNNING',
      status: 409,
    });
    await expect(client.renderTask(task.taskId)).rejects.toMatchObject({
      code: 'TASK_BUSY',
      status: 409,
    });
  });

  it('rejects cancel for terminal local mock tasks without overwriting status', async () => {
    const client = createMockHostClient();
    const task = await client.createTask({
      title: 'terminal cancel guard',
      type: 'single-speaker',
    });
    await attachVideoSource(client, task.taskId);
    await client.analyzeTask(task.taskId);
    await client.renderTask(task.taskId);

    await expect(client.cancelTask(task.taskId)).rejects.toMatchObject({
      code: 'TASK_TERMINAL',
      status: 409,
    });
    await expect(client.getTask(task.taskId)).resolves.toMatchObject({
      currentStage: 'artifact',
      status: 'succeeded',
    });
  });

  it('uploads a local source file and replaces source artifact metadata', async () => {
    const client = createMockHostClient();
    const task = await client.createTask({
      title: 'local upload',
      type: 'single-speaker',
    });
    const file = new File(['video-bytes'], 'local.mp4', { type: 'video/mp4' });

    const artifact = await client.uploadTaskSourceFile(task.taskId, file);
    const updatedTask = await client.getTask(task.taskId);
    const artifacts = await client.getTaskArtifacts(task.taskId);

    expect(artifact).toMatchObject({
      artifactId: `${task.taskId}-source`,
      kind: 'source',
      sizeBytes: file.size,
    });
    expect(artifact.path).toContain('/source/local.mp4');
    expect(updatedTask.sourceName).toBe('local.mp4');
    expect(artifacts.filter((item) => item.kind === 'source')).toHaveLength(1);
  });

  it('rejects non-video local source uploads before replacing source metadata', async () => {
    const client = createMockHostClient();
    const task = await client.createTask({
      title: 'bad local upload',
      type: 'single-speaker',
    });
    const file = new File(['not-video'], 'notes.txt', { type: 'text/plain' });

    await expect(client.uploadTaskSourceFile(task.taskId, file)).rejects.toThrow(/supported video file/);

    const updatedTask = await client.getTask(task.taskId);
    const artifacts = await client.getTaskArtifacts(task.taskId);

    expect(updatedTask.sourceName).toBeUndefined();
    expect(artifacts.some((artifact) => artifact.kind === 'source')).toBe(false);
  });

  it('sanitizes metadata source names before creating source artifact paths', async () => {
    const client = createMockHostClient();
    const task = await client.createTask({
      title: 'metadata source',
      type: 'single-speaker',
    });

    const artifact = await client.attachTaskSource(task.taskId, {
      sourceName: '..\\evil/clip.mp4',
      sizeBytes: 2048,
      contentType: 'video/mp4',
    });

    expect(artifact.path).toBe(`workspace/projects/default/tasks/${task.taskId}/source/clip.mp4`);
    expect((await client.getTask(task.taskId)).sourceName).toBe('clip.mp4');
  });

  it('rejects non-video metadata source attachment', async () => {
    const client = createMockHostClient();
    const task = await client.createTask({
      title: 'metadata source',
      type: 'single-speaker',
    });

    await expect(
      client.attachTaskSource(task.taskId, {
        sourceName: 'notes.txt',
        sizeBytes: 2048,
        contentType: 'text/plain',
      }),
    ).rejects.toThrow(/supported video file/);

    expect((await client.getTask(task.taskId)).sourceName).toBeUndefined();
  });

  it('creates a distinct render attempt for each render request', async () => {
    const client = createMockHostClient();
    const task = await client.createTask({
      title: 'repeat render',
      type: 'long-interview',
    });
    await attachVideoSource(client, task.taskId);

    await client.analyzeTask(task.taskId);
    await client.renderTask(task.taskId);
    await client.renderTask(task.taskId);

    expect((await client.getTaskArtifacts(task.taskId)).filter((artifact) => artifact.kind === 'render').map((artifact) => artifact.renderId)).toEqual([
      `${task.taskId}-render-1`,
      `${task.taskId}-render-2`,
    ]);
  });

  it('batch renders one distinct render attempt for each split plan segment', async () => {
    const client = createMockHostClient();
    const task = await client.createTask({
      title: 'batch render',
      type: 'single-speaker',
    });
    await attachVideoSource(client, task.taskId);

    await client.analyzeTask(task.taskId);
    const plan = await client.getTaskPlan(task.taskId);
    const firstSegment = {
      ...plan.segments[0],
      segmentId: `${task.taskId}-segment-1`,
      sourceRange: { startMs: 1_000, endMs: 2_500 },
      outputRange: { startMs: 0, endMs: 1_500 },
    };
    const secondSegment = {
      ...plan.segments[0],
      segmentId: `${task.taskId}-segment-2`,
      sourceRange: { startMs: 3_000, endMs: 4_200 },
      outputRange: { startMs: 0, endMs: 1_200 },
    };
    await client.updateTaskPlan(task.taskId, {
      ...plan,
      segments: [firstSegment, secondSegment],
    });

    const rendered = await client.renderTaskBatch(task.taskId);

    expect(rendered.status).toBe('succeeded');
    const artifacts = await client.getTaskArtifacts(task.taskId);
    expect(artifacts.filter((artifact) => artifact.kind === 'render').map((artifact) => artifact.renderId)).toEqual([
      `${task.taskId}-render-1`,
      `${task.taskId}-render-2`,
    ]);
    const manifests = artifacts.filter((artifact) => artifact.kind === 'render-manifest');
    const firstManifest = JSON.parse(await client.getArtifactText(task.taskId, manifests[0].artifactId));
    const secondManifest = JSON.parse(await client.getArtifactText(task.taskId, manifests[1].artifactId));
    expect(firstManifest.sourceRange).toEqual({ startMs: 1_000, endMs: 2_500 });
    expect(secondManifest.sourceRange).toEqual({ startMs: 3_000, endMs: 4_200 });
  });

  it('refreshes plan artifact metadata when a split plan is saved', async () => {
    const client = createMockHostClient();
    const task = await client.createTask({
      title: 'plan edit',
      type: 'single-speaker',
    });
    await attachVideoSource(client, task.taskId);
    await client.analyzeTask(task.taskId);
    const before = (await client.getTaskArtifacts(task.taskId)).find((artifact) => artifact.artifactId === `${task.taskId}-plan`);
    const plan = await client.getTaskPlan(task.taskId);
    const updatedPlan = {
      ...plan,
      planRevision: plan.planRevision + 1,
      segments: [
        {
          ...plan.segments[0],
          title: `${plan.segments[0].title} - user edited range`,
          sourceRange: { startMs: 500, endMs: 1800 },
          outputRange: { startMs: 0, endMs: 1300 },
        },
      ],
    };

    await client.updateTaskPlan(task.taskId, updatedPlan);

    const after = (await client.getTaskArtifacts(task.taskId)).find((artifact) => artifact.artifactId === `${task.taskId}-plan`);
    expect(after).toBeDefined();
    expect(after?.sizeBytes).not.toBe(before?.sizeBytes);
    expect(after?.sha256).not.toBe(before?.sha256);
  });

  it('imports SRT subtitles as transcript segments and exports WebVTT artifacts', async () => {
    const client = createMockHostClient();
    const task = await client.createTask({
      title: 'subtitle import',
      type: 'single-speaker',
    });
    await attachVideoSource(client, task.taskId, 'talk.mp4');
    await client.analyzeTask(task.taskId);

    const transcript = await client.importTaskSubtitles(task.taskId, {
      format: 'srt',
      language: 'en',
      content: '1\n00:00:00,500 --> 00:00:01,800\nHello world\n\n2\n00:00:02,000 --> 00:00:02,700\nSecond cue\n',
    });
    const exported = await client.exportTaskSubtitles(task.taskId, 'vtt');

    expect(transcript.providerId).toBe('subtitle-import-srt');
    expect(transcript.segments[0]).toMatchObject({ startMs: 500, endMs: 1800, text: 'Hello world' });
    expect(exported).toMatchObject({
      artifactId: `${task.taskId}-subtitle-export-vtt`,
      format: 'vtt',
      path: `workspace/projects/default/tasks/${task.taskId}/analysis/subtitles-export.vtt`,
    });
    expect(exported.content).toContain('WEBVTT');
    expect(exported.content).toContain('00:00:00.500 --> 00:00:01.800');
    await expect(client.importTaskSubtitles(task.taskId, {
      format: 'vtt',
      content: 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nFirst\n\n00:00:01.500 --> 00:00:03.000\nOverlap\n',
    })).rejects.toThrow(/overlaps/);
  });

  it('returns standard content types for subtitle, cover, and render manifest artifacts', async () => {
    const client = createMockHostClient();
    const task = await client.createTask({
      title: 'artifact content types',
      type: 'single-speaker',
    });
    await attachVideoSource(client, task.taskId, 'talk.mp4');

    await client.analyzeTask(task.taskId);
    await client.renderTask(task.taskId);

    const artifacts = await client.getTaskArtifacts(task.taskId);
    const subtitle = artifacts.find((artifact) => artifact.kind === 'subtitle');
    const cover = artifacts.find((artifact) => artifact.kind === 'cover');
    const manifest = artifacts.find((artifact) => artifact.kind === 'render-manifest');

    expect(subtitle).toBeDefined();
    expect(cover).toBeDefined();
    expect(manifest).toBeDefined();
    await expect(client.getArtifactDownload(task.taskId, subtitle!.artifactId)).resolves.toMatchObject({
      contentType: 'text/x-ssa',
      downloadMode: 'host-content-endpoint',
    });
    await expect(client.getArtifactDownload(task.taskId, cover!.artifactId)).resolves.toMatchObject({
      contentType: 'image/png',
      downloadMode: 'host-content-endpoint',
    });
    await expect(client.getArtifactDownload(task.taskId, manifest!.artifactId)).resolves.toMatchObject({
      contentType: 'application/json',
      downloadMode: 'host-content-endpoint',
    });
  });

  it('returns standard render manifest text for rendered tasks', async () => {
    const client = createMockHostClient();
    const task = await client.createTask({
      title: 'manifest text',
      type: 'interview-qa',
    });
    await attachVideoSource(client, task.taskId);
    await client.analyzeTask(task.taskId);
    await client.renderTask(task.taskId);
    const artifacts = await client.getTaskArtifacts(task.taskId);
    const manifestArtifact = artifacts.find((artifact) => artifact.kind === 'render-manifest');

    const manifest = JSON.parse(await client.getArtifactText(task.taskId, manifestArtifact!.artifactId));

    expect(manifest).toMatchObject({
      schemaId: 'video-cut.render-attempt.schema.v1',
      taskId: task.taskId,
      renderId: `${task.taskId}-render-1`,
      subtitleBurnIn: true,
      renderGraph: {
        engine: 'ffmpeg',
        adapterVersion: 'ffmpeg-media-render.adapter.v1',
      },
    });
    expect(manifest.sourceRange).toEqual({ startMs: 8000, endMs: 78000 });
    expect(manifest.subtitleCueCount).toBe(2);
  });
});
