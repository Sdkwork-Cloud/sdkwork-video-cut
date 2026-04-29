import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

const scriptUrl = pathToFileURL(resolve(process.cwd(), 'scripts/run-video-cut-http-workflow-smoke.mjs')).href;

interface SmokeModule {
  createHttpWorkflowSmokeReport: (options: {
    authToken?: string;
    deploymentMode?: string;
    fetchImpl: typeof fetch;
    fixtureBytes?: Uint8Array;
    generatedAt?: string;
    hostUrl?: string;
    profile?: string;
    reportPath?: string;
    sourceFile?: string;
    timeoutMs?: number;
  }) => Promise<Record<string, any>>;
  isDirectRun: (moduleUrl: string, argvPath?: string) => boolean;
  parseHttpWorkflowSmokeArgs: (argv: string[], env?: Record<string, string | undefined>) => Record<string, any>;
}

async function loadSmokeModule() {
  return import(scriptUrl) as Promise<SmokeModule>;
}

function okEnvelope(data: unknown) {
  return {
    ok: true,
    data,
  };
}

function artifact(artifactId: string, kind: string, path: string, sizeBytes = 128) {
  return {
    artifactId,
    createdAt: '2026-04-27T00:00:00.000Z',
    kind,
    path,
    sha256: 'a'.repeat(64),
    sizeBytes,
    taskId: 'task-smoke',
  };
}

describe('HTTP workflow smoke CLI', () => {
  it('parses local/server workflow options and normalizes the host URL', async () => {
    const { parseHttpWorkflowSmokeArgs } = await loadSmokeModule();

    const options = parseHttpWorkflowSmokeArgs(
      [
        'server-dev',
        '--deployment-mode',
        'server-private',
        '--host-url',
        'http://127.0.0.1:6177/api/video-cut/v1/',
        '--source-file',
        'fixtures/source.mp4',
        '--timeout-ms',
        '20000',
        '--report-path',
        'artifacts/release/smoke/server-smoke-report.json',
        '--keep-fixture',
        '--json',
      ],
      {
        SDKWORK_VIDEO_CUT_SERVER_TOKEN: 'server-token',
      },
    );

    expect(options).toMatchObject({
      authToken: 'server-token',
      deploymentMode: 'server-private',
      hostUrl: 'http://127.0.0.1:6177/api/video-cut/v1',
      json: true,
      keepFixture: true,
      profile: 'server-dev',
      reportPath: 'artifacts/release/smoke/server-smoke-report.json',
      sourceFile: 'fixtures/source.mp4',
      timeoutMs: 20_000,
    });
  });

  it('executes the canonical create-upload-analyze-plan-render-artifact workflow and redacts secrets', async () => {
    const { createHttpWorkflowSmokeReport } = await loadSmokeModule();
    const outputArtifactId = 'task-smoke-render-1-output';
    const manifestArtifactId = 'task-smoke-render-1-manifest';
    const logArtifactId = 'task-smoke-render-1-log';
    const renderedMp4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);
    const calls: Array<{ bodyType: string; method: string; range: string; url: string }> = [];
    const reportDir = mkdtempSync(resolve(tmpdir(), 'video-cut-http-smoke-report-'));
    const reportPath = resolve(reportDir, 'http-smoke-report.json');
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({
        bodyType: init?.body?.constructor?.name ?? '',
        method,
        range: String((init?.headers as Record<string, string> | undefined)?.range ?? ''),
        url,
      });

      if (url.endsWith('/health')) {
        return new Response(JSON.stringify(okEnvelope({ status: 'ok' })));
      }

      if (url.endsWith('/tasks') && method === 'POST') {
        return new Response(
          JSON.stringify(
            okEnvelope({
              currentStage: 'draft',
              durationSeconds: 3,
              progress: 0,
              status: 'draft',
              taskId: 'task-smoke',
              title: 'HTTP workflow smoke',
              type: 'long-interview',
              updatedAt: '2026-04-27T00:00:00.000Z',
            }),
          ),
        );
      }

      if (url.endsWith('/tasks/task-smoke/source/file') && method === 'POST') {
        return new Response(
          JSON.stringify(
            okEnvelope(artifact('task-smoke-source', 'source', 'workspace/projects/default/tasks/task-smoke/source/smoke-source.mp4')),
          ),
        );
      }

      if (url.endsWith('/tasks/task-smoke/analyze') && method === 'POST') {
        return new Response(
          JSON.stringify(
            okEnvelope({
              currentStage: 'plan',
              durationSeconds: 3,
              progress: 65,
              status: 'planReady',
              taskId: 'task-smoke',
            }),
          ),
        );
      }

      if (url.endsWith('/tasks/task-smoke/plan') && method === 'GET') {
        return new Response(
          JSON.stringify(
            okEnvelope({
              schemaId: 'video-cut.split-plan.schema.v1',
              outputSpec: {
                frameRate: 30,
                height: 1920,
                width: 1080,
              },
              segments: [
                {
                  segmentId: 'segment-1',
                  sourceRange: { endMs: 2500, startMs: 0 },
                  outputRange: { endMs: 2500, startMs: 0 },
                },
              ],
              tracks: [],
            }),
          ),
        );
      }

      if (url.endsWith('/tasks/task-smoke/plan') && method === 'PUT') {
        return new Response(JSON.stringify(okEnvelope({ schemaId: 'video-cut.split-plan.schema.v1' })));
      }

      if (url.endsWith('/tasks/task-smoke/render') && method === 'POST') {
        return new Response(
          JSON.stringify(
            okEnvelope({
              currentStage: 'artifact',
              durationSeconds: 3,
              progress: 100,
              status: 'succeeded',
              taskId: 'task-smoke',
            }),
          ),
        );
      }

      if (url.endsWith('/tasks/task-smoke/events')) {
        return new Response(
          JSON.stringify(
            okEnvelope([
              {
                eventId: 'event-1',
                message: 'Rendered MP4, subtitles, cover, and render log.',
                progress: 100,
                stage: 'render',
                taskId: 'task-smoke',
              },
            ]),
          ),
        );
      }

      if (url.endsWith('/tasks/task-smoke/artifacts')) {
        return new Response(
          JSON.stringify(
            okEnvelope([
              artifact(outputArtifactId, 'render', 'workspace/projects/default/tasks/task-smoke/renders/task-smoke-render-1/output.mp4', 4096),
              artifact(manifestArtifactId, 'render-manifest', 'workspace/projects/default/tasks/task-smoke/renders/task-smoke-render-1/render.json'),
              artifact(logArtifactId, 'log', 'workspace/projects/default/tasks/task-smoke/renders/task-smoke-render-1/render.log'),
            ]),
          ),
        );
      }

      if (url.endsWith(`/tasks/task-smoke/artifacts/${outputArtifactId}/download`)) {
        return new Response(
          JSON.stringify(
            okEnvelope({
              artifactId: outputArtifactId,
              contentType: 'video/mp4',
              downloadMode: 'host-content-endpoint',
              path: 'workspace/projects/default/tasks/task-smoke/renders/task-smoke-render-1/output.mp4',
              sha256: 'b'.repeat(64),
              sizeBytes: 4096,
              taskId: 'task-smoke',
              url: `/api/video-cut/v1/tasks/task-smoke/artifacts/${outputArtifactId}/content`,
            }),
          ),
        );
      }

      if (url.endsWith(`/tasks/task-smoke/artifacts/${manifestArtifactId}/download`)) {
        return new Response(
          JSON.stringify(
            okEnvelope({
              artifactId: manifestArtifactId,
              contentType: 'application/json',
              downloadMode: 'host-content-endpoint',
              path: 'workspace/projects/default/tasks/task-smoke/renders/task-smoke-render-1/render.json',
              sha256: 'c'.repeat(64),
              sizeBytes: 256,
              taskId: 'task-smoke',
              url: `/api/video-cut/v1/tasks/task-smoke/artifacts/${manifestArtifactId}/content`,
            }),
          ),
        );
      }

      if (url.endsWith(`/tasks/task-smoke/artifacts/${logArtifactId}/download`)) {
        return new Response(
          JSON.stringify(
            okEnvelope({
              artifactId: logArtifactId,
              contentType: 'text/plain',
              downloadMode: 'host-content-endpoint',
              path: 'workspace/projects/default/tasks/task-smoke/renders/task-smoke-render-1/render.log',
              sha256: 'd'.repeat(64),
              sizeBytes: 128,
              taskId: 'task-smoke',
              url: `/api/video-cut/v1/tasks/task-smoke/artifacts/${logArtifactId}/content`,
            }),
          ),
        );
      }

      if (url.endsWith(`/tasks/task-smoke/artifacts/${outputArtifactId}/content`) && (init?.headers as Record<string, string> | undefined)?.range === 'bytes=0-11') {
        return new Response(renderedMp4, {
          headers: {
            'accept-ranges': 'bytes',
            'cache-control': 'private, no-store',
            'content-range': `bytes 0-11/${renderedMp4.byteLength}`,
            'content-type': 'video/mp4',
            pragma: 'no-cache',
            'x-content-type-options': 'nosniff',
          },
          status: 206,
        });
      }

      if (url.endsWith(`/tasks/task-smoke/artifacts/${outputArtifactId}/content`)) {
        return new Response(renderedMp4, {
          headers: {
            'accept-ranges': 'bytes',
            'cache-control': 'private, no-store',
            'content-type': 'video/mp4',
            pragma: 'no-cache',
            'x-content-type-options': 'nosniff',
          },
        });
      }

      if (url.endsWith(`/tasks/task-smoke/artifacts/${manifestArtifactId}/content`)) {
        return new Response(
          JSON.stringify({
            outputArtifactId,
            renderGraph: {
              video: { status: 'rendered' },
            },
            schemaId: 'video-cut.render-attempt-manifest.schema.v1',
            source: 'workspace/projects/default/tasks/task-smoke/source/smoke-source.mp4',
          }),
          { headers: { 'content-type': 'application/json' } },
        );
      }

      if (url.endsWith(`/tasks/task-smoke/artifacts/${logArtifactId}/content`)) {
        return new Response('schemaId=video-cut.render-log.schema.v1\nsource=<source>\nstatus=ok\n');
      }

      throw new Error(`Unexpected smoke request: ${method} ${url}`);
    });

    const report = await createHttpWorkflowSmokeReport({
      authToken: 'server-token',
      deploymentMode: 'server-private',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      fixtureBytes: new Uint8Array([1, 2, 3, 4]),
      generatedAt: '2026-04-27T00:00:00.000Z',
      hostUrl: 'http://127.0.0.1:6177/api/video-cut/v1/',
      profile: 'server-dev',
      reportPath,
      timeoutMs: 10_000,
    });

    expect(calls.map((call) => `${call.method} ${call.url.replace('http://127.0.0.1:6177/api/video-cut/v1', '')}`)).toEqual([
      'GET /health',
      'POST /tasks',
      'POST /tasks/task-smoke/source/file',
      'POST /tasks/task-smoke/analyze',
      'GET /tasks/task-smoke/plan',
      'PUT /tasks/task-smoke/plan',
      'POST /tasks/task-smoke/render',
      'GET /tasks/task-smoke/artifacts',
      `GET /tasks/task-smoke/artifacts/${outputArtifactId}/download`,
      `GET /tasks/task-smoke/artifacts/${manifestArtifactId}/download`,
      `GET /tasks/task-smoke/artifacts/${logArtifactId}/download`,
      `GET /tasks/task-smoke/artifacts/${outputArtifactId}/content`,
      `GET /tasks/task-smoke/artifacts/${outputArtifactId}/content`,
      `GET /tasks/task-smoke/artifacts/${manifestArtifactId}/content`,
      `GET /tasks/task-smoke/artifacts/${logArtifactId}/content`,
      'GET /tasks/task-smoke/events',
    ]);
    expect(calls.filter((call) => call.url.endsWith(`/tasks/task-smoke/artifacts/${outputArtifactId}/content`)).map((call) => call.range)).toEqual([
      '',
      'bytes=0-11',
    ]);
    expect(calls[2].bodyType).toBe('FormData');
    for (const call of fetchImpl.mock.calls) {
      expect(call[1]).toMatchObject({
        headers: expect.objectContaining({
          authorization: 'Bearer server-token',
        }),
      });
    }
    expect(report).toMatchObject({
      deploymentMode: 'server-private',
      hostUrl: 'http://127.0.0.1:6177/api/video-cut/v1',
      ok: true,
      profile: 'server-dev',
      reportVersion: 'video-cut.http-workflow-smoke.v1',
      summary: {
        fail: 0,
      },
      taskId: 'task-smoke',
    });
    expect(report.artifacts.output.artifactId).toBe(outputArtifactId);
    expect(report.artifacts.output.bytesChecked).toBe(renderedMp4.byteLength);
    expect(report.artifacts.output.rangeChecked).toBe(true);
    expect(report.artifacts.output.rangeBytesChecked).toBe(12);
    expect(report.artifacts.output.securityHeadersChecked).toBe(true);
    expect(report.checks.map((check: Record<string, unknown>) => check.checkId)).toEqual(
      expect.arrayContaining([
        'health',
        'taskCreate',
        'sourceUpload',
        'analysis',
        'planRoundtrip',
        'render',
        'artifactList',
        'artifactDownloadDescriptors',
        'artifactContent',
        'artifactRangeContent',
        'artifactSecurityHeaders',
        'events',
        'redaction',
      ]),
    );
    expect(JSON.stringify(report)).not.toContain('server-token');
    expect(JSON.stringify(report)).not.toContain('authorization');
    expect(existsSync(reportPath)).toBe(true);
    expect(JSON.parse(readFileSync(reportPath, 'utf8'))).toMatchObject({
      ok: true,
      reportVersion: 'video-cut.http-workflow-smoke.v1',
      taskId: 'task-smoke',
    });
  });

  it('declares HTTP workflow smoke package scripts', () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));

    expect(packageJson.scripts).toMatchObject({
      'workflow:smoke': 'node scripts/run-video-cut-http-workflow-smoke.mjs desktop-dev --deployment-mode desktop-local',
      'workflow:smoke:desktop:local':
        'node scripts/run-video-cut-http-workflow-smoke.mjs desktop-dev --deployment-mode desktop-local',
      'workflow:smoke:server:private':
        'node scripts/run-video-cut-http-workflow-smoke.mjs server-dev --deployment-mode server-private',
    });
  });

  it('detects direct script execution on Windows file paths', async () => {
    const { isDirectRun } = await loadSmokeModule();

    expect(isDirectRun(scriptUrl, resolve(process.cwd(), 'scripts/run-video-cut-http-workflow-smoke.mjs'))).toBe(true);
    expect(isDirectRun(scriptUrl, resolve(process.cwd(), 'scripts/other.mjs'))).toBe(false);
  });
});
