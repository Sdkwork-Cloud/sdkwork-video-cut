import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

const scriptUrl = pathToFileURL(resolve(process.cwd(), 'scripts/run-video-cut-managed-ui-smoke.mjs')).href;

interface ManagedUiSmokeModule {
  createManagedUiWorkflowSmokeReport: (options: {
    browserWorkflowImpl?: (options: Record<string, unknown>) => Promise<Record<string, any>>;
    execFileSyncImpl?: (...args: any[]) => unknown;
    fetchImpl?: typeof fetch;
    generatedAt?: string;
    portAllocator?: () => Promise<number>;
    projectRoot?: string;
    reportPath?: string;
    spawnImpl?: (...args: any[]) => any;
    timeoutMs?: number;
    tokenFactory?: () => string;
    workspaceRoot?: string;
  }) => Promise<Record<string, any>>;
  isDirectRun: (moduleUrl: string, argvPath?: string) => boolean;
  parseManagedUiSmokeArgs: (argv: string[], env?: Record<string, string | undefined>) => Record<string, any>;
}

async function loadManagedUiSmokeModule() {
  return import(scriptUrl) as Promise<ManagedUiSmokeModule>;
}

function createChildProcessDouble(pid: number) {
  return {
    killed: false,
    kill: vi.fn(function kill(this: { killed: boolean }) {
      this.killed = true;
      return true;
    }),
    pid,
    stderr: new EventEmitter(),
    stdout: new EventEmitter(),
  };
}

function okEnvelope(data: unknown) {
  return {
    ok: true,
    data,
  };
}

describe('managed UI workflow smoke CLI', () => {
  it('parses managed UI smoke options and standard server token env', async () => {
    const { parseManagedUiSmokeArgs } = await loadManagedUiSmokeModule();

    const options = parseManagedUiSmokeArgs(
      [
        '--',
        'server-dev',
        '--deployment-mode',
        'server-private',
        '--host-port',
        '18077',
        '--web-port',
        '18078',
        '--workspace-root',
        'artifacts/runtime/ui-smoke-workspace',
        '--chrome-executable-path',
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        '--timeout-ms',
        '45000',
        '--report-path',
        'artifacts/release/smoke/web-smoke-report.json',
        '--json',
      ],
      {
        SDKWORK_VIDEO_CUT_SERVER_TOKEN: 'server-token',
      },
    );

    expect(options).toMatchObject({
      authToken: 'server-token',
      chromeExecutablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      deploymentMode: 'server-private',
      hostUrl: 'http://127.0.0.1:18077/api/video-cut/v1',
      json: true,
      profile: 'server-dev',
      reportPath: 'artifacts/release/smoke/web-smoke-report.json',
      timeoutMs: 45_000,
      webUrl: 'http://127.0.0.1:18078',
      workspaceRoot: 'artifacts/runtime/ui-smoke-workspace',
    });
  });

  it('starts server-private Host and Vite, runs browser workflow, then redacts and cleans up', async () => {
    const { createManagedUiWorkflowSmokeReport } = await loadManagedUiSmokeModule();
    const hostChild = createChildProcessDouble(5001);
    const webChild = createChildProcessDouble(5002);
    const execFileSyncImpl = vi.fn();
    const spawnImpl = vi.fn().mockReturnValueOnce(hostChild).mockReturnValueOnce(webChild);
    const reportDir = mkdtempSync(resolve(tmpdir(), 'video-cut-managed-ui-smoke-report-'));
    const reportPath = resolve(reportDir, 'managed-ui-smoke-report.json');
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/video-cut/v1/health')) {
        return new Response(JSON.stringify(okEnvelope({ status: 'ok' })));
      }
      return new Response('<html><body>sdkwork-video-cut</body></html>', {
        headers: { 'content-type': 'text/html' },
      });
    });
    const browserWorkflowImpl = vi.fn(async () => ({
      artifactContentAuthorizationVerified: true,
      artifactContentEndpointFetched: true,
      artifactDownloadAuthorizationVerified: true,
      artifactDownloadButtonVisible: true,
      artifactDownloadContentFetched: true,
      deliveryIntegrityStatus: 'Complete',
      deliveryPackageVisible: true,
      diagnosticsBundleVerified: true,
      doctorVerified: true,
      providerConformanceVerified: true,
      settingsRedactionVerified: true,
      settingsSaved: true,
      localPathLeakVisible: false,
      manifestVisible: true,
      outputArtifactVisible: true,
      outputPreviewBlobUrl: true,
      resultsPageVerified: true,
      statusText: 'succeeded',
      taskTitle: 'ui-smoke-source',
    }));

    const report = await createManagedUiWorkflowSmokeReport({
      browserWorkflowImpl,
      execFileSyncImpl,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      generatedAt: '2026-04-27T00:00:00.000Z',
      portAllocator: vi.fn().mockResolvedValueOnce(18_077).mockResolvedValueOnce(18_078),
      projectRoot: process.cwd(),
      reportPath,
      spawnImpl,
      timeoutMs: 45_000,
      tokenFactory: () => 'managed-ui-token',
      workspaceRoot: 'artifacts/runtime/managed-ui-smoke-test-workspace',
    });

    expect(execFileSyncImpl).toHaveBeenCalledWith(
      'cargo',
      ['build', '--manifest-path', 'host/Cargo.toml', '--bin', 'sdkwork-video-cut-host'],
      expect.objectContaining({ cwd: process.cwd(), stdio: 'pipe' }),
    );
    expect(spawnImpl).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/host[\\/]target[\\/]debug[\\/]sdkwork-video-cut-host(\.exe)?$/),
      [],
      expect.objectContaining({
        cwd: process.cwd(),
        env: expect.objectContaining({
          SDKWORK_VIDEO_CUT_AUTH_MODE: 'single-user-token',
          SDKWORK_VIDEO_CUT_CORS_ALLOWED_ORIGINS: 'http://127.0.0.1:18078',
          SDKWORK_VIDEO_CUT_PORT: '18077',
          SDKWORK_VIDEO_CUT_RUNTIME_MODE: 'server-private',
          SDKWORK_VIDEO_CUT_SERVER_TOKEN: 'managed-ui-token',
        }),
        windowsHide: true,
      }),
    );
    expect(spawnImpl).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/node(\.exe)?$/),
      expect.arrayContaining([
        expect.stringMatching(/vite[\\/]bin[\\/]vite\.js$/),
        '--host',
        '127.0.0.1',
        '--port',
        '18078',
        '--strictPort',
      ]),
      expect.objectContaining({
        env: expect.any(Object),
      }),
    );
    expect(spawnImpl.mock.calls[1][2].env).not.toHaveProperty('VITE_VIDEO_CUT_HOST_BASE_URL');
    expect(spawnImpl.mock.calls[1][2].env).not.toHaveProperty('VITE_VIDEO_CUT_HOST_MODE');
    expect(spawnImpl.mock.calls[1][2].env).not.toHaveProperty('VITE_VIDEO_CUT_SERVER_TOKEN');
    expect(
      Object.keys(spawnImpl.mock.calls[1][2].env).filter(
        (key) => key.startsWith('VITE_') || key.startsWith('SDKWORK_VIDEO_CUT_') || key.startsWith('VIDEO_CUT_'),
      ),
    ).toEqual([]);
    expect(browserWorkflowImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        authToken: 'managed-ui-token',
        hostUrl: 'http://127.0.0.1:18077/api/video-cut/v1',
        webUrl: 'http://127.0.0.1:18078',
      }),
    );
    expect(hostChild.kill).toHaveBeenCalled();
    expect(webChild.kill).toHaveBeenCalled();
    expect(report).toMatchObject({
      deploymentMode: 'server-private',
      hostUrl: 'http://127.0.0.1:18077/api/video-cut/v1',
      ok: true,
      profile: 'server-dev',
      reportVersion: 'video-cut.managed-ui-workflow-smoke.v1',
      summary: { fail: 0 },
      ui: {
        artifactContentAuthorizationVerified: true,
        artifactContentEndpointFetched: true,
        artifactDownloadAuthorizationVerified: true,
        artifactDownloadButtonVisible: true,
        artifactDownloadContentFetched: true,
        deliveryIntegrityStatus: 'Complete',
        deliveryPackageVisible: true,
        diagnosticsBundleVerified: true,
        doctorVerified: true,
        providerConformanceVerified: true,
        settingsRedactionVerified: true,
        settingsSaved: true,
        localPathLeakVisible: false,
        manifestVisible: true,
        outputArtifactVisible: true,
        outputPreviewBlobUrl: true,
        resultsPageVerified: true,
      },
      webUrl: 'http://127.0.0.1:18078',
    });
    expect(report.checks.map((check: Record<string, unknown>) => check.checkId)).toEqual(
      expect.arrayContaining(['hostBuild', 'hostStart', 'hostHealth', 'webStart', 'webHealth', 'browserWorkflow', 'processCleanup', 'redaction']),
    );
    expect(JSON.stringify(report)).not.toContain('managed-ui-token');
    expect(JSON.stringify(report)).not.toContain('VITE_VIDEO_CUT_SERVER_TOKEN');
    expect(JSON.stringify(report)).not.toContain('SDKWORK_VIDEO_CUT_SERVER_TOKEN');
    expect(existsSync(reportPath)).toBe(true);
    expect(JSON.parse(readFileSync(reportPath, 'utf8'))).toMatchObject({
      ok: true,
      reportVersion: 'video-cut.managed-ui-workflow-smoke.v1',
      ui: {
        resultsPageVerified: true,
        settingsSaved: true,
      },
    });
  });

  it('declares managed UI smoke package scripts and playwright-core dependency', () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));
    const script = readFileSync(resolve(process.cwd(), 'scripts/run-video-cut-managed-ui-smoke.mjs'), 'utf8');

    expect(packageJson.scripts).toMatchObject({
      'workflow:smoke:ui:managed': 'node scripts/run-video-cut-managed-ui-smoke.mjs server-dev --deployment-mode server-private',
      'workflow:smoke:server:ui:managed': 'node scripts/run-video-cut-managed-ui-smoke.mjs server-dev --deployment-mode server-private',
    });
    expect(packageJson.devDependencies).toHaveProperty('playwright-core');
    expect(script).toContain("getByLabel('API key', { exact: true })");
    expect(script).not.toContain('input[type="file"][accept="video/*"]');
    expect(script).toContain('input[aria-label="导入本地视频"]');
    expect(script).toContain('waitForResponse');
    expect(script).toContain('/source/file');
  });

  it('documents Settings Center verification fields in runtime deployment governance', () => {
    const deploymentStandard = readFileSync(resolve(process.cwd(), 'docs/architecture/09-deployment-runtime-profile-standard.md'), 'utf8');
    const readme = readFileSync(resolve(process.cwd(), 'README.md'), 'utf8');
    const readiness = readFileSync(resolve(process.cwd(), 'docs/product/feature-readiness.yaml'), 'utf8');

    for (const requiredField of [
      'ui.settingsSaved',
      'ui.providerConformanceVerified',
      'ui.doctorVerified',
      'ui.diagnosticsBundleVerified',
      'ui.settingsRedactionVerified',
      'ui.artifactContentAuthorizationVerified',
      'ui.artifactDownloadContentFetched',
      'ui.artifactDownloadAuthorizationVerified',
      'ui.outputPreviewBlobUrl',
    ]) {
      expect(deploymentStandard).toContain(requiredField);
      expect(readme).toContain(requiredField);
    }

    expect(readiness).toContain('Settings Center write-only secret save path');
    expect(readiness).toContain('managed UI Settings Center smoke');
  });

  it('detects direct script execution on Windows file paths', async () => {
    const { isDirectRun } = await loadManagedUiSmokeModule();

    expect(isDirectRun(scriptUrl, resolve(process.cwd(), 'scripts/run-video-cut-managed-ui-smoke.mjs'))).toBe(true);
    expect(isDirectRun(scriptUrl, resolve(process.cwd(), 'scripts/other.mjs'))).toBe(false);
  });
});
