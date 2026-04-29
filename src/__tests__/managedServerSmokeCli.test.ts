import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

const scriptUrl = pathToFileURL(resolve(process.cwd(), 'scripts/run-video-cut-managed-server-smoke.mjs')).href;

interface ManagedSmokeModule {
  createManagedServerWorkflowSmokeReport: (options: {
    execFileSyncImpl?: (...args: any[]) => unknown;
    fetchImpl?: typeof fetch;
    generatedAt?: string;
    portAllocator?: () => Promise<number>;
    projectRoot?: string;
    reportPath?: string;
    spawnImpl?: (...args: any[]) => any;
    timeoutMs?: number;
    tokenFactory?: () => string;
    workflowSmokeImpl?: (options: Record<string, unknown>) => Promise<Record<string, any>>;
    workspaceRoot?: string;
  }) => Promise<Record<string, any>>;
  isDirectRun: (moduleUrl: string, argvPath?: string) => boolean;
  parseManagedServerSmokeArgs: (argv: string[], env?: Record<string, string | undefined>) => Record<string, any>;
}

async function loadManagedSmokeModule() {
  return import(scriptUrl) as Promise<ManagedSmokeModule>;
}

function okEnvelope(data: unknown) {
  return {
    ok: true,
    data,
  };
}

function createChildProcessDouble() {
  return {
    killed: false,
    kill: vi.fn(function kill(this: { killed: boolean }) {
      this.killed = true;
      return true;
    }),
    pid: 4242,
    stderr: new EventEmitter(),
    stdout: new EventEmitter(),
  };
}

describe('managed server workflow smoke CLI', () => {
  it('parses server-private managed smoke options with standard env defaults', async () => {
    const { parseManagedServerSmokeArgs } = await loadManagedSmokeModule();

    const options = parseManagedServerSmokeArgs(
      [
        'server-dev',
        '--deployment-mode',
        'server-private',
        '--port',
        '18077',
        '--workspace-root',
        'artifacts/runtime/server-smoke-workspace',
        '--timeout-ms',
        '30000',
        '--report-path',
        'artifacts/release/smoke/server-smoke-report.json',
        '--keep-workspace',
        '--json',
      ],
      {
        SDKWORK_VIDEO_CUT_SERVER_TOKEN: 'server-token',
      },
    );

    expect(options).toMatchObject({
      authToken: 'server-token',
      bindHost: '127.0.0.1',
      deploymentMode: 'server-private',
      hostUrl: 'http://127.0.0.1:18077/api/video-cut/v1',
      json: true,
      keepWorkspace: true,
      port: 18_077,
      profile: 'server-dev',
      reportPath: 'artifacts/release/smoke/server-smoke-report.json',
      timeoutMs: 30_000,
      workspaceRoot: 'artifacts/runtime/server-smoke-workspace',
    });
  });

  it('builds and starts a real server-private host, runs workflow smoke with token, and redacts the report', async () => {
    const { createManagedServerWorkflowSmokeReport } = await loadManagedSmokeModule();
    const child = createChildProcessDouble();
    const execFileSyncImpl = vi.fn();
    const spawnImpl = vi.fn(() => child);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(okEnvelope({ status: 'ok' }))));
    const reportDir = mkdtempSync(resolve(tmpdir(), 'video-cut-managed-server-smoke-report-'));
    const reportPath = resolve(reportDir, 'managed-server-smoke-report.json');
    const workflowSmokeImpl = vi.fn(async () => ({
      artifacts: {
        log: {
          artifactId: 'task-managed-smoke-log',
          downloadMode: 'host-content-endpoint',
          kind: 'log',
        },
        manifest: {
          artifactId: 'task-managed-smoke-manifest',
          downloadMode: 'host-content-endpoint',
          kind: 'render-manifest',
        },
        output: {
          artifactId: 'task-managed-smoke-output',
          bytesChecked: 4096,
          downloadMode: 'host-content-endpoint',
          kind: 'render',
          mp4Signature: true,
          rangeBytesChecked: 12,
          rangeChecked: true,
          securityHeadersChecked: true,
        },
      },
      checks: [
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
      ].map((checkId) => ({ checkId, status: 'ok' })),
      deploymentMode: 'server-private',
      ok: true,
      reportVersion: 'video-cut.http-workflow-smoke.v1',
      source: {
        fileName: 'smoke-source.mp4',
        generated: true,
        sizeBytes: 2048,
      },
      summary: { fail: 0, ok: 11, warn: 0 },
      taskId: 'task-managed-smoke',
    }));

    const report = await createManagedServerWorkflowSmokeReport({
      execFileSyncImpl,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      generatedAt: '2026-04-27T00:00:00.000Z',
      portAllocator: async () => 18_077,
      projectRoot: process.cwd(),
      reportPath,
      spawnImpl,
      timeoutMs: 30_000,
      tokenFactory: () => 'managed-server-token',
      workflowSmokeImpl,
      workspaceRoot: 'artifacts/runtime/managed-server-smoke-test-workspace',
    });

    expect(execFileSyncImpl).toHaveBeenCalledWith(
      'cargo',
      ['build', '--manifest-path', 'host/Cargo.toml', '--bin', 'sdkwork-video-cut-host'],
      expect.objectContaining({
        cwd: process.cwd(),
        stdio: 'pipe',
      }),
    );
    expect(spawnImpl).toHaveBeenCalledWith(
      expect.stringMatching(/host[\\/]target[\\/]debug[\\/]sdkwork-video-cut-host(\.exe)?$/),
      [],
      expect.objectContaining({
        cwd: process.cwd(),
        env: expect.objectContaining({
          SDKWORK_VIDEO_CUT_AUTH_MODE: 'single-user-token',
          SDKWORK_VIDEO_CUT_BIND_HOST: '127.0.0.1',
          SDKWORK_VIDEO_CUT_PORT: '18077',
          SDKWORK_VIDEO_CUT_RUNTIME_MODE: 'server-private',
          SDKWORK_VIDEO_CUT_SERVER_TOKEN: 'managed-server-token',
          SDKWORK_VIDEO_CUT_WORKSPACE_ROOT: resolve(process.cwd(), 'artifacts/runtime/managed-server-smoke-test-workspace'),
        }),
        windowsHide: true,
      }),
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:18077/api/video-cut/v1/health',
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(workflowSmokeImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        authToken: 'managed-server-token',
        deploymentMode: 'server-private',
        hostUrl: 'http://127.0.0.1:18077/api/video-cut/v1',
        profile: 'server-dev',
        timeoutMs: 30_000,
      }),
    );
    expect(child.kill).toHaveBeenCalled();
    expect(report).toMatchObject({
      deploymentMode: 'server-private',
      hostUrl: 'http://127.0.0.1:18077/api/video-cut/v1',
      ok: true,
      profile: 'server-dev',
      reportVersion: 'video-cut.managed-server-workflow-smoke.v1',
      summary: {
        fail: 0,
      },
      workflow: {
        checks: expect.arrayContaining([
          expect.objectContaining({ checkId: 'sourceUpload', status: 'ok' }),
          expect.objectContaining({ checkId: 'artifactContent', status: 'ok' }),
          expect.objectContaining({ checkId: 'artifactRangeContent', status: 'ok' }),
          expect.objectContaining({ checkId: 'artifactSecurityHeaders', status: 'ok' }),
        ]),
        artifacts: {
          output: {
            bytesChecked: 4096,
            downloadMode: 'host-content-endpoint',
            mp4Signature: true,
            rangeBytesChecked: 12,
            rangeChecked: true,
            securityHeadersChecked: true,
          },
        },
        taskId: 'task-managed-smoke',
      },
    });
    expect(report.checks.map((check: Record<string, unknown>) => check.checkId)).toEqual(
      expect.arrayContaining(['hostBuild', 'hostStart', 'hostHealth', 'workflowSmoke', 'processCleanup', 'redaction']),
    );
    expect(JSON.stringify(report)).not.toContain('managed-server-token');
    expect(JSON.stringify(report)).not.toContain('SDKWORK_VIDEO_CUT_SERVER_TOKEN');
    expect(JSON.stringify(report)).not.toContain(resolve(process.cwd(), 'artifacts/runtime/managed-server-smoke-test-workspace'));
    expect(report.runtime.workspaceRoot).toBe('<configured-workspace>');
    expect(existsSync(reportPath)).toBe(true);
    expect(JSON.parse(readFileSync(reportPath, 'utf8'))).toMatchObject({
      ok: true,
      reportVersion: 'video-cut.managed-server-workflow-smoke.v1',
      workflow: {
        checks: expect.arrayContaining([
          expect.objectContaining({ checkId: 'sourceUpload', status: 'ok' }),
          expect.objectContaining({ checkId: 'artifactContent', status: 'ok' }),
          expect.objectContaining({ checkId: 'artifactRangeContent', status: 'ok' }),
          expect.objectContaining({ checkId: 'artifactSecurityHeaders', status: 'ok' }),
        ]),
        taskId: 'task-managed-smoke',
      },
    });
  });

  it('declares managed server smoke package scripts', () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));

    expect(packageJson.scripts).toMatchObject({
      'workflow:smoke:server:managed':
        'node scripts/run-video-cut-managed-server-smoke.mjs server-dev --deployment-mode server-private',
      'workflow:smoke:server:private:managed':
        'node scripts/run-video-cut-managed-server-smoke.mjs server-dev --deployment-mode server-private',
    });
  });

  it('detects direct script execution on Windows file paths', async () => {
    const { isDirectRun } = await loadManagedSmokeModule();

    expect(isDirectRun(scriptUrl, resolve(process.cwd(), 'scripts/run-video-cut-managed-server-smoke.mjs'))).toBe(true);
    expect(isDirectRun(scriptUrl, resolve(process.cwd(), 'scripts/other.mjs'))).toBe(false);
  });
});
