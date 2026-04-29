import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

const scriptUrl = pathToFileURL(resolve(process.cwd(), 'scripts/run-video-cut-deployment-doctor.mjs')).href;

async function loadCliModule() {
  return import(scriptUrl) as Promise<{
    createDeploymentDoctorReport: (options: {
      authToken?: string;
      deploymentMode?: string;
      fetchImpl: typeof fetch;
      hostUrl?: string;
      profile?: string;
    }) => Promise<Record<string, any>>;
    isDirectRun: (moduleUrl: string, argvPath?: string) => boolean;
    parseDoctorArgs: (argv: string[], env?: Record<string, string | undefined>) => Record<string, any>;
  }>;
}

function okEnvelope(data: unknown) {
  return {
    ok: true,
    data,
  };
}

describe('deployment doctor CLI', () => {
  it('parses deployment mode, profile, json flag, and host url', async () => {
    const { parseDoctorArgs } = await loadCliModule();

    const options = parseDoctorArgs(
      [
        'server-dev',
        '--deployment-mode',
        'server-private',
        '--host-url',
        'http://127.0.0.1:6177/api/video-cut/v1/',
        '--json',
      ],
      {},
    );

    expect(options).toMatchObject({
      deploymentMode: 'server-private',
      hostUrl: 'http://127.0.0.1:6177/api/video-cut/v1',
      json: true,
      profile: 'server-dev',
    });
  });

  it('parses server token from the standard env and never places it in the report target url', async () => {
    const { parseDoctorArgs } = await loadCliModule();

    const options = parseDoctorArgs(['server-dev', '--deployment-mode', 'server-private', '--json'], {
      SDKWORK_VIDEO_CUT_HOST_URL: 'http://video.example.test/api/video-cut/v1/',
      SDKWORK_VIDEO_CUT_SERVER_TOKEN: 'server-token',
    });

    expect(options).toMatchObject({
      authToken: 'server-token',
      deploymentMode: 'server-private',
      hostUrl: 'http://video.example.test/api/video-cut/v1',
      json: true,
      profile: 'server-dev',
    });
  });

  it('calls health, capabilities, and doctor endpoints and returns a standard JSON report', async () => {
    const { createDeploymentDoctorReport } = await loadCliModule();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(okEnvelope({ status: 'ok' }))))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            okEnvelope({
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
            }),
          ),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            okEnvelope({
              reportVersion: 'video-cut.doctor.v1',
              deploymentMode: 'desktop-local',
              generatedAt: '2026-04-27T00:00:00.000Z',
              health: 'ok',
              capability: { reportVersion: 'video-cut.capability.v1' },
              checks: [
                { checkId: 'health', status: 'ok', label: 'Host health' },
                { checkId: 'redaction', status: 'ok', label: 'Diagnostics redaction enabled' },
              ],
              redactedConfig: {
                ai: { apiKeyConfigured: true },
                speechToText: { apiKeyConfigured: false },
              },
            }),
          ),
        ),
      );

    const report = await createDeploymentDoctorReport({
      deploymentMode: 'desktop-local',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      hostUrl: 'http://127.0.0.1:6177/api/video-cut/v1/',
      profile: 'desktop-dev',
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:6177/api/video-cut/v1/health', expect.any(Object));
    expect(fetchImpl).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:6177/api/video-cut/v1/capabilities', expect.any(Object));
    expect(fetchImpl).toHaveBeenNthCalledWith(3, 'http://127.0.0.1:6177/api/video-cut/v1/doctor', expect.any(Object));
    expect(report).toMatchObject({
      deploymentMode: 'desktop-local',
      health: 'ok',
      hostUrl: 'http://127.0.0.1:6177/api/video-cut/v1',
      ok: true,
      profile: 'desktop-dev',
      reportVersion: 'video-cut.deployment-doctor.cli.v1',
      summary: {
        fail: 0,
        ok: 2,
        warn: 0,
      },
    });
    expect(JSON.stringify(report)).not.toContain('apiKey"');
  });

  it('redacts server-local workspace paths from doctor output defensively', async () => {
    const { createDeploymentDoctorReport } = await loadCliModule();
    const localWorkspacePath = 'D:\\private\\sdkwork-video-cut\\workspace';
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(okEnvelope({ status: 'ok' }))))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            okEnvelope({
              reportVersion: 'video-cut.capability.v1',
              deploymentMode: 'server-private',
              qualityTier: 'basic',
              health: 'ok',
              ai: { status: 'warn', label: 'LLM not configured' },
              speechToText: { status: 'warn', label: 'Speech to text not configured' },
              media: { status: 'ok', label: 'FFmpeg and ffprobe configured' },
              storage: { status: 'ok', label: 'Workspace paths configured' },
              security: { status: 'ok', label: 'Redaction enabled' },
              providers: { providerCapabilityVersion: 'video-cut.provider-capability.schema.v1' },
            }),
          ),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            okEnvelope({
              reportVersion: 'video-cut.doctor.v1',
              deploymentMode: 'server-private',
              generatedAt: '2026-04-27T00:00:00.000Z',
              health: 'ok',
              capability: { reportVersion: 'video-cut.capability.v1' },
              checks: [
                {
                  checkId: 'workspaceWritable',
                  status: 'ok',
                  label: 'Workspace writable',
                  details: { path: localWorkspacePath },
                },
              ],
              redactedConfig: {
                storage: {
                  workspaceRoot: localWorkspacePath,
                  artifactRoot: `${localWorkspacePath}\\artifacts`,
                  tempRoot: `${localWorkspacePath}\\tmp`,
                },
              },
            }),
          ),
        ),
      );

    const report = await createDeploymentDoctorReport({
      deploymentMode: 'server-private',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      hostUrl: 'http://video.example.test/api/video-cut/v1',
      profile: 'server-dev',
    });
    const serialized = JSON.stringify(report);

    expect(serialized).not.toContain(localWorkspacePath);
    expect(serialized).not.toContain('D:\\private');
    expect(report.doctor.checks[0].details.path).toBe('<redacted-path>');
    expect(report.doctor.redactedConfig.storage.workspaceRoot).toBe('<redacted-path>');
    expect(report.doctor.redactedConfig.storage.artifactRoot).toBe('<redacted-path>');
    expect(report.doctor.redactedConfig.storage.tempRoot).toBe('<redacted-path>');
  });

  it('sends the configured server token as an authorization header without emitting it in the report', async () => {
    const { createDeploymentDoctorReport } = await loadCliModule();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(okEnvelope({ status: 'ok' }))))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            okEnvelope({
              reportVersion: 'video-cut.capability.v1',
              deploymentMode: 'server-private',
              qualityTier: 'basic',
              health: 'ok',
              ai: { status: 'warn', label: 'LLM not configured' },
              speechToText: { status: 'warn', label: 'Speech to text not configured' },
              media: { status: 'ok', label: 'FFmpeg and ffprobe configured' },
              storage: { status: 'ok', label: 'Workspace paths configured' },
              security: { status: 'ok', label: 'Token auth enabled' },
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
            }),
          ),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            okEnvelope({
              reportVersion: 'video-cut.doctor.v1',
              deploymentMode: 'server-private',
              generatedAt: '2026-04-27T00:00:00.000Z',
              health: 'ok',
              capability: { reportVersion: 'video-cut.capability.v1' },
              checks: [{ checkId: 'auth', status: 'ok', label: 'Server token accepted' }],
              redactedConfig: {
                runtime: { authMode: 'single-user-token' },
              },
            }),
          ),
        ),
      );

    const report = await createDeploymentDoctorReport({
      authToken: 'server-token',
      deploymentMode: 'server-private',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      hostUrl: 'http://video.example.test/api/video-cut/v1/',
      profile: 'server-dev',
    });

    for (const call of fetchImpl.mock.calls) {
      expect(call[1]).toMatchObject({
        headers: {
          accept: 'application/json',
          authorization: 'Bearer server-token',
        },
      });
    }
    expect(report.ok).toBe(true);
    expect(JSON.stringify(report)).not.toContain('server-token');
  });

  it('declares deployment doctor package scripts', () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));

    expect(packageJson.scripts).toMatchObject({
      'deployment:doctor': 'node scripts/run-video-cut-deployment-doctor.mjs desktop-dev --deployment-mode desktop-local',
      'deployment:doctor:desktop:local':
        'node scripts/run-video-cut-deployment-doctor.mjs desktop-dev --deployment-mode desktop-local',
      'deployment:doctor:server:private':
        'node scripts/run-video-cut-deployment-doctor.mjs server-dev --deployment-mode server-private',
    });
  });

  it('detects direct script execution on Windows file paths', async () => {
    const { isDirectRun } = await loadCliModule();

    expect(isDirectRun(scriptUrl, resolve(process.cwd(), 'scripts/run-video-cut-deployment-doctor.mjs'))).toBe(true);
    expect(isDirectRun(scriptUrl, resolve(process.cwd(), 'scripts/other.mjs'))).toBe(false);
  });
});
