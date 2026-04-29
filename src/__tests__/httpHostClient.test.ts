import { describe, expect, it, vi } from 'vitest';

import { createDefaultVideoSplitPlan } from '../domain/mediaContracts';
import { createDefaultSettings } from '../domain/videoCutTypes';
import { createHttpHostClient, VideoCutHostApiError } from '../services/httpHostClient';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

function okEnvelope<T>(data: T) {
  return {
    data,
    ok: true,
  };
}

describe('createHttpHostClient', () => {
  it('uses the video-cut v1 contract for settings and tasks', async () => {
    const settings = createDefaultSettings();
    const plan = createDefaultVideoSplitPlan({
      sourceName: 'local.mp4',
      taskId: 'task-0001',
      type: 'long-interview',
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(okEnvelope(settings)))
      .mockResolvedValueOnce(jsonResponse(okEnvelope({ valid: true, errors: [] })))
      .mockResolvedValueOnce(
        jsonResponse(
          okEnvelope({
            taskId: 'task-0001',
            title: 'local',
            type: 'long-interview',
            status: 'draft',
            progress: 0,
            durationSeconds: 168,
            sourceName: undefined,
            updatedAt: '2026-04-26T00:00:00.000Z',
          }),
        ),
      )
      .mockResolvedValueOnce(jsonResponse(okEnvelope(plan)))
      .mockResolvedValueOnce(jsonResponse(okEnvelope(plan)));
    const client = createHttpHostClient({
      baseUrl: 'http://127.0.0.1:6177/api/video-cut/v1/',
      fetchImpl,
    });

    await client.getSettings();
    await client.updateSettings(settings);
    await client.createTask({
      title: 'local',
      type: 'long-interview',
    });
    await client.getTaskPlan('task-0001');
    await client.updateTaskPlan('task-0001', plan);

    expect(fetchImpl).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:6177/api/video-cut/v1/settings', {
      headers: { accept: 'application/json' },
      method: 'GET',
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:6177/api/video-cut/v1/settings',
      expect.objectContaining({
        body: JSON.stringify(settings),
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        method: 'PUT',
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'http://127.0.0.1:6177/api/video-cut/v1/tasks',
      expect.objectContaining({
        body: JSON.stringify({
          title: 'local',
          type: 'long-interview',
        }),
        method: 'POST',
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(4, 'http://127.0.0.1:6177/api/video-cut/v1/tasks/task-0001/plan', {
      headers: { accept: 'application/json' },
      method: 'GET',
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      5,
      'http://127.0.0.1:6177/api/video-cut/v1/tasks/task-0001/plan',
      expect.objectContaining({
        body: JSON.stringify(plan),
        method: 'PUT',
      }),
    );
  });

  it('reads the asset catalog through the standard asset repository endpoint', async () => {
    const catalog = {
      assetCatalogVersion: 1,
      generatedAt: '2026-04-27T00:00:00.000Z',
      schemaId: 'video-cut.asset-catalog.schema.v1',
      slots: [],
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(okEnvelope(catalog)));
    const client = createHttpHostClient({
      baseUrl: 'http://127.0.0.1:6177/api/video-cut/v1/',
      fetchImpl,
    });

    await expect((client as any).getAssetCatalog()).resolves.toEqual(catalog);

    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:6177/api/video-cut/v1/assets/catalog', {
      headers: { accept: 'application/json' },
      method: 'GET',
    });
  });

  it('updates manual transcripts through the standard transcript endpoint', async () => {
    const transcript = {
      adapterVersion: 'manual-transcript.adapter.v1',
      audioArtifactId: 'task-0001-audio-source',
      audioPath: 'workspace/projects/default/tasks/task-0001/audio/source.wav',
      createdAt: '2026-04-27T00:00:00.000Z',
      durationSeconds: 1.3,
      language: 'en',
      providerId: 'manual-transcript',
      schemaId: 'video-cut.transcript.schema.v1',
      segments: [
        {
          endMs: 1800,
          segmentId: 'task-0001-manual-transcript-segment-1',
          startMs: 500,
          text: 'Manual subtitle',
        },
      ],
      text: 'Manual subtitle',
      timestampGranularity: ['segment'],
      transcriptStatus: 'ok',
      transcriptVersion: 1,
      warnings: [],
    };
    const input = {
      language: 'en',
      segments: [{ startMs: 500, endMs: 1800, text: 'Manual subtitle' }],
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(okEnvelope(transcript)));
    const client = createHttpHostClient({
      baseUrl: '/api/video-cut/v1/',
      fetchImpl,
    });

    await expect(client.updateTaskTranscript('task-0001', input)).resolves.toMatchObject({
      providerId: 'manual-transcript',
      transcriptStatus: 'ok',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/video-cut/v1/tasks/task-0001/transcript',
      expect.objectContaining({
        body: JSON.stringify(input),
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        method: 'PUT',
      }),
    );
  });

  it('throws a standard api error for non-success responses', async () => {
    const fetchImpl = vi.fn().mockImplementation(() =>
      Promise.resolve(
        jsonResponse(
          {
            error: {
              code: 'HOST_UNAVAILABLE',
              message: 'Host is unavailable.',
              traceId: 'trace-001',
            },
            ok: false,
          },
          { status: 503 },
        ),
      ),
    );
    const client = createHttpHostClient({
      baseUrl: '/api/video-cut/v1',
      fetchImpl,
    });

    await expect(client.getCapabilities()).rejects.toMatchObject({
      name: 'VideoCutHostApiError',
      status: 503,
      code: 'HOST_UNAVAILABLE',
      traceId: 'trace-001',
    });
    await expect(client.getCapabilities()).rejects.toBeInstanceOf(VideoCutHostApiError);
  });

  it('rejects successful JSON API responses that do not use the standard success envelope', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('plain ok', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'ok',
        }),
      );
    const client = createHttpHostClient({
      baseUrl: '/api/video-cut/v1',
      fetchImpl,
    });

    await expect(client.getHealth()).rejects.toMatchObject({
      name: 'VideoCutHostApiError',
      status: 200,
      code: 'RESPONSE_ENVELOPE_INVALID',
    });
    await expect(client.getHealth()).rejects.toMatchObject({
      name: 'VideoCutHostApiError',
      status: 200,
      code: 'RESPONSE_ENVELOPE_INVALID',
    });
  });

  it('adds a bearer token to json, multipart, and text artifact requests when configured', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(okEnvelope({ status: 'ok' })))
      .mockResolvedValueOnce(
        jsonResponse(
          okEnvelope({
            artifactId: 'task-0001-source',
            taskId: 'task-0001',
            kind: 'source',
            path: 'workspace/projects/default/tasks/task-0001/source/local.mp4',
            sizeBytes: 3,
            sha256: 'a'.repeat(64),
            createdAt: '2026-04-27T00:00:00.000Z',
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response('schemaId=video-cut.render-log.schema.v1', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      );
    const client = createHttpHostClient({
      authToken: 'server-token',
      baseUrl: '/api/video-cut/v1/',
      fetchImpl,
    });
    const file = new File(['abc'], 'local.mp4', { type: 'video/mp4' });

    await client.getHealth();
    await client.uploadTaskSourceFile('task-0001', file);
    await client.getArtifactText('task-0001', 'task-0001-render-1-log');

    expect(fetchImpl).toHaveBeenNthCalledWith(1, '/api/video-cut/v1/health', {
      headers: {
        accept: 'application/json',
        authorization: 'Bearer server-token',
      },
      method: 'GET',
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      '/api/video-cut/v1/tasks/task-0001/source/file',
      expect.objectContaining({
        headers: {
          accept: 'application/json',
          authorization: 'Bearer server-token',
        },
        method: 'POST',
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      '/api/video-cut/v1/tasks/task-0001/artifacts/task-0001-render-1-log/content',
      {
        headers: {
          accept: 'text/plain, application/json;q=0.9, */*;q=0.8',
          authorization: 'Bearer server-token',
        },
        method: 'GET',
      },
    );
  });

  it('calls the standard deployment doctor endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        okEnvelope({
          reportVersion: 'video-cut.doctor.v1',
          deploymentMode: 'desktop-local',
          generatedAt: '2026-04-26T00:00:00.000Z',
          health: 'ok',
          capability: {
            reportVersion: 'video-cut.capability.v1',
            deploymentMode: 'desktop-local',
            qualityTier: 'basic',
            health: 'ok',
            ai: { status: 'warn', label: 'LLM not configured' },
            speechToText: { status: 'warn', label: 'Speech to text not configured' },
            media: { status: 'ok', label: 'FFmpeg and ffprobe configured' },
            storage: { status: 'ok', label: 'Workspace paths configured' },
            security: { status: 'ok', label: 'Redaction enabled' },
            providers: {
              providerCapabilityVersion: 'video-cut.provider-capability.schema.v1',
              configurationSchemaId: 'video-cut.openai-compatible-provider-config.schema.v1',
              openAiCompatible: {
                chatCompletionsEndpoint: '/v1/chat/completions',
                audioTranscriptionsEndpoint: '/v1/audio/transcriptions',
                structuredOutputModes: ['json-schema', 'json-object-fallback'],
                ollamaAllowed: false,
              },
              requiredPorts: ['LlmProviderPort', 'SpeechToTextPort', 'SubtitlePort', 'SecretStorePort'],
            },
          },
          checks: [{ checkId: 'health', status: 'ok', label: 'Host health' }],
          redactedConfig: createDefaultSettings(),
        }),
      ),
    );
    const client = createHttpHostClient({
      baseUrl: '/api/video-cut/v1/',
      fetchImpl,
    });

    const report = await client.getDoctorReport();

    expect(report.reportVersion).toBe('video-cut.doctor.v1');
    expect(fetchImpl).toHaveBeenCalledWith('/api/video-cut/v1/doctor', {
      headers: { accept: 'application/json' },
      method: 'GET',
    });
  });

  it('calls the standard diagnostics bundle endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        okEnvelope({
          bundleVersion: 'video-cut.diagnostics-bundle.v1',
          generatedAt: '2026-04-27T00:00:00.000Z',
          deploymentMode: 'desktop-local',
          includes: {
            sourceMedia: false,
            transcript: false,
          },
          capability: { reportVersion: 'video-cut.capability.v1' },
          doctor: { reportVersion: 'video-cut.doctor.v1' },
          redactedConfig: createDefaultSettings(),
          artifacts: [],
        }),
      ),
    );
    const client = createHttpHostClient({
      baseUrl: '/api/video-cut/v1/',
      fetchImpl,
    });

    const bundle = await client.getDiagnosticBundle();

    expect(bundle.bundleVersion).toBe('video-cut.diagnostics-bundle.v1');
    expect(fetchImpl).toHaveBeenCalledWith('/api/video-cut/v1/diagnostics/bundle', {
      headers: { accept: 'application/json' },
      method: 'GET',
    });
  });

  it('posts explicit consent when exporting a diagnostics support bundle with attachments', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        okEnvelope({
          bundleVersion: 'video-cut.diagnostics-bundle.v1',
          generatedAt: '2026-04-27T00:00:00.000Z',
          deploymentMode: 'desktop-local',
          includes: {
            sourceMedia: true,
            transcript: true,
          },
          supportRequest: {
            schemaId: 'video-cut.diagnostics-support-bundle-request.v1',
            taskId: 'task-support',
            consentAccepted: true,
            includeSourceMedia: true,
            includeTranscript: true,
          },
          capability: { reportVersion: 'video-cut.capability.v1' },
          doctor: { reportVersion: 'video-cut.doctor.v1' },
          redactedConfig: createDefaultSettings(),
          artifacts: [
            {
              kind: 'sourceMedia',
              taskId: 'task-support',
              artifactId: 'task-support-source',
              path: 'workspace/projects/default/tasks/task-support/source/input.mp4',
              contentRef: '/api/video-cut/v1/tasks/task-support/artifacts/task-support-source/content',
              included: true,
              redacted: false,
              sizeBytes: 1024,
              sha256: 'abc123',
            },
          ],
        }),
      ),
    );
    const client = createHttpHostClient({
      baseUrl: '/api/video-cut/v1/',
      fetchImpl,
    });

    const bundle = await client.getDiagnosticSupportBundle({
      taskId: 'task-support',
      includeSourceMedia: true,
      includeTranscript: true,
      consentAccepted: true,
    });

    expect(bundle.includes.sourceMedia).toBe(true);
    expect(bundle.artifacts[0].contentRef).toContain('/content');
    expect(fetchImpl).toHaveBeenCalledWith('/api/video-cut/v1/diagnostics/support-bundle', {
      body: JSON.stringify({
        taskId: 'task-support',
        includeSourceMedia: true,
        includeTranscript: true,
        consentAccepted: true,
      }),
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      method: 'POST',
    });
  });

  it('calls the standard provider conformance endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        okEnvelope({
          reportVersion: 'video-cut.provider-conformance.v1',
          providerId: 'runtime-openai-compatible-ai',
          status: 'ok',
          generatedAt: '2026-04-27T00:00:00.000Z',
          checks: [
            {
              checkId: 'llm.structuredOutput',
              status: 'ok',
              label: 'LLM structured output request contract',
              actionHint: null,
              details: { credentialStatus: 'configured' },
            },
          ],
        }),
      ),
    );
    const client = createHttpHostClient({
      baseUrl: '/api/video-cut/v1/',
      fetchImpl,
    });

    const report = await client.runProviderConformance('ai');

    expect(report.reportVersion).toBe('video-cut.provider-conformance.v1');
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/video-cut/v1/providers/openai-compatible/conformance',
      expect.objectContaining({
        body: JSON.stringify({ target: 'ai' }),
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        method: 'POST',
      }),
    );
  });

  it('uses the standard task lifecycle endpoints beyond analyze and render', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          okEnvelope({
            taskId: 'task-0001',
            title: 'local',
            type: 'long-interview',
            status: 'sourceReady',
            progress: 5,
            durationSeconds: 168,
            sourceName: 'local.mp4',
            updatedAt: '2026-04-26T00:00:00.000Z',
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          okEnvelope({
            artifactId: 'task-0001-source',
            taskId: 'task-0001',
            kind: 'source',
            path: 'workspace/projects/default/tasks/task-0001/source/local.mp4',
            sizeBytes: 1024,
            sha256: 'a'.repeat(64),
            createdAt: '2026-04-26T00:00:00.000Z',
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          okEnvelope({
            taskId: 'task-0001',
            title: 'local',
            type: 'long-interview',
            status: 'cancelled',
            progress: 5,
            durationSeconds: 168,
            sourceName: 'local.mp4',
            updatedAt: '2026-04-26T00:00:01.000Z',
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          okEnvelope({
            artifactId: 'task-0001-source',
            taskId: 'task-0001',
            path: 'workspace/projects/default/tasks/task-0001/source/local.mp4',
            sizeBytes: 1024,
            sha256: 'a'.repeat(64),
            contentType: 'video/mp4',
            downloadMode: 'host-content-endpoint',
            url: '/api/video-cut/v1/tasks/task-0001/artifacts/task-0001-source/content',
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          okEnvelope({
            taskId: 'task-0001',
            deleted: true,
            artifactsDeleted: 1,
            eventsDeleted: 2,
          }),
        ),
      );
    const client = createHttpHostClient({
      baseUrl: '/api/video-cut/v1/',
      fetchImpl,
    });

    await client.getTask('task-0001');
    await client.attachTaskSource('task-0001', {
      sourceName: 'local.mp4',
      sizeBytes: 1024,
      contentType: 'video/mp4',
    });
    await client.cancelTask('task-0001');
    await client.getArtifactDownload('task-0001', 'task-0001-source');
    await client.deleteTask('task-0001');

    expect(fetchImpl).toHaveBeenNthCalledWith(1, '/api/video-cut/v1/tasks/task-0001', {
      headers: { accept: 'application/json' },
      method: 'GET',
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      '/api/video-cut/v1/tasks/task-0001/source',
      expect.objectContaining({
        body: JSON.stringify({
          sourceName: 'local.mp4',
          sizeBytes: 1024,
          contentType: 'video/mp4',
        }),
        method: 'POST',
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(3, '/api/video-cut/v1/tasks/task-0001/cancel', {
      headers: { accept: 'application/json' },
      method: 'POST',
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      '/api/video-cut/v1/tasks/task-0001/artifacts/task-0001-source/download',
      {
        headers: { accept: 'application/json' },
        method: 'GET',
      },
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(5, '/api/video-cut/v1/tasks/task-0001', {
      headers: { accept: 'application/json' },
      method: 'DELETE',
    });
  });

  it('posts batch render requests to the standard multi-segment render endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(
        okEnvelope({
          taskId: 'task-0001',
          title: 'batch',
          type: 'long-interview',
          status: 'succeeded',
          progress: 100,
          durationSeconds: 168,
          sourceName: 'batch.mp4',
          updatedAt: '2026-04-26T00:00:00.000Z',
          currentStage: 'artifact',
        }),
      ),
    );
    const client = createHttpHostClient({
      baseUrl: '/api/video-cut/v1/',
      fetchImpl,
    });

    const task = await client.renderTaskBatch('task 0001');

    expect(task.status).toBe('succeeded');
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/video-cut/v1/tasks/task%200001/render/batch',
      expect.objectContaining({
        headers: {
          accept: 'application/json',
        },
        method: 'POST',
      }),
    );
  });

  it('uses standard subtitle import and export endpoints', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          okEnvelope({
            schemaId: 'video-cut.transcript.schema.v1',
            transcriptVersion: 1,
            taskId: 'task-0001',
            audioArtifactId: 'task-0001-audio-source',
            audioPath: 'workspace/projects/default/tasks/task-0001/audio/source.wav',
            providerId: 'subtitle-import-srt',
            adapterVersion: 'subtitle-srt-import.adapter.v1',
            transcriptStatus: 'ok',
            language: 'en',
            timestampGranularity: ['segment'],
            durationSeconds: 1.8,
            text: 'Hello',
            segments: [{ segmentId: 'task-0001-subtitle-import-segment-1', startMs: 500, endMs: 1800, text: 'Hello' }],
            warnings: [],
            createdAt: '2026-04-26T00:00:00.000Z',
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          okEnvelope({
            format: 'vtt',
            content: 'WEBVTT\n\n00:00:00.500 --> 00:00:01.800\nHello\n',
            artifactId: 'task-0001-subtitle-export-vtt',
            path: 'workspace/projects/default/tasks/task-0001/analysis/subtitles-export.vtt',
          }),
        ),
      );
    const client = createHttpHostClient({
      baseUrl: '/api/video-cut/v1/',
      fetchImpl,
    });

    const transcript = await client.importTaskSubtitles('task-0001', {
      format: 'srt',
      language: 'en',
      content: '1\n00:00:00,500 --> 00:00:01,800\nHello\n',
    });
    const exported = await client.exportTaskSubtitles('task-0001', 'vtt');

    expect(transcript.providerId).toBe('subtitle-import-srt');
    expect(exported.content).toContain('WEBVTT');
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      '/api/video-cut/v1/tasks/task-0001/subtitles/import',
      expect.objectContaining({
        body: JSON.stringify({
          format: 'srt',
          language: 'en',
          content: '1\n00:00:00,500 --> 00:00:01,800\nHello\n',
        }),
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        method: 'PUT',
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(2, '/api/video-cut/v1/tasks/task-0001/subtitles/export?format=vtt', {
      headers: { accept: 'application/json' },
      method: 'GET',
    });
  });

  it('uploads local source files through multipart without forcing a json content type', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        okEnvelope({
          artifactId: 'task-0001-source',
          taskId: 'task-0001',
          kind: 'source',
          path: 'workspace/projects/default/tasks/task-0001/source/local.mp4',
          sizeBytes: 3,
          sha256: 'a'.repeat(64),
          createdAt: '2026-04-27T00:00:00.000Z',
        }),
      ),
    );
    const client = createHttpHostClient({
      baseUrl: '/api/video-cut/v1/',
      fetchImpl,
    });
    const file = new File(['abc'], 'local.mp4', { type: 'video/mp4' });

    const artifact = await client.uploadTaskSourceFile('task-0001', file);

    expect(artifact.sizeBytes).toBe(3);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [endpoint, init] = fetchImpl.mock.calls[0];
    expect(endpoint).toBe('/api/video-cut/v1/tasks/task-0001/source/file');
    expect(init).toMatchObject({
      headers: { accept: 'application/json' },
      method: 'POST',
    });
    expect(init.headers).not.toHaveProperty('content-type');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('file')).toMatchObject({
      name: 'local.mp4',
      size: 3,
      type: 'video/mp4',
    });
  });

  it('reads text artifact content through the canonical content endpoint without an envelope', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      new Response('schemaId=video-cut.render-log.schema.v1', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    );
    const client = createHttpHostClient({
      baseUrl: '/api/video-cut/v1/',
      fetchImpl,
    });

    await expect(client.getArtifactText('task-0001', 'task-0001-render-1-log')).resolves.toBe(
      'schemaId=video-cut.render-log.schema.v1',
    );
    expect(fetchImpl).toHaveBeenCalledWith('/api/video-cut/v1/tasks/task-0001/artifacts/task-0001-render-1-log/content', {
      headers: { accept: 'text/plain, application/json;q=0.9, */*;q=0.8' },
      method: 'GET',
    });
  });

  it('rejects standard error envelopes returned from text artifact reads even when status is 200', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        error: {
          code: 'ARTIFACT_CONTENT_NOT_FOUND',
          message: 'Artifact content not found.',
          traceId: 'trace-artifact',
        },
        ok: false,
      }),
    );
    const client = createHttpHostClient({
      baseUrl: '/api/video-cut/v1/',
      fetchImpl,
    });

    await expect(client.getArtifactText('task-0001', 'missing-log')).rejects.toMatchObject({
      name: 'VideoCutHostApiError',
      status: 200,
      code: 'ARTIFACT_CONTENT_NOT_FOUND',
      traceId: 'trace-artifact',
    });
  });

  it('reads binary artifact content through the canonical endpoint with bearer auth', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      new Response(new Uint8Array([0, 1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'video/mp4' },
      }),
    );
    const client = createHttpHostClient({
      authToken: 'server-token',
      baseUrl: '/api/video-cut/v1/',
      fetchImpl,
    });

    const blob = await client.getArtifactContent('task-0001', 'task-0001-render-1-output');

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBe(4);
    expect(blob.type).toBe('video/mp4');
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/video-cut/v1/tasks/task-0001/artifacts/task-0001-render-1-output/content',
      {
        headers: {
          accept: '*/*',
          authorization: 'Bearer server-token',
        },
        method: 'GET',
      },
    );
  });

  it('rejects standard error envelopes returned from binary artifact reads even when status is 200', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        error: {
          code: 'ARTIFACT_PATH_INVALID',
          message: 'Artifact content can only be served from the task workspace.',
          traceId: 'trace-bad-request',
        },
        ok: false,
      }),
    );
    const client = createHttpHostClient({
      baseUrl: '/api/video-cut/v1/',
      fetchImpl,
    });

    await expect(client.getArtifactContent('task-0001', 'bad-output')).rejects.toMatchObject({
      name: 'VideoCutHostApiError',
      status: 200,
      code: 'ARTIFACT_PATH_INVALID',
      traceId: 'trace-bad-request',
    });
  });
});
