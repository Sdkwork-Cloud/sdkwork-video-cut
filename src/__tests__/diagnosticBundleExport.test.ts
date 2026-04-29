import { describe, expect, it } from 'vitest';

import { createDiagnosticBundleDownloadDescriptor } from '../domain/diagnosticBundleExport';
import { createDefaultSettings, type DiagnosticBundle } from '../domain/videoCutTypes';

function createBundle(): DiagnosticBundle {
  const settings = createDefaultSettings();

  return {
    bundleVersion: 'video-cut.diagnostics-bundle.v1',
    generatedAt: '2026-04-27T01:02:03.000Z',
    deploymentMode: 'desktop-local',
    includes: {
      sourceMedia: false,
      transcript: false,
    },
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
        speechToTextProviderProfiles: ['openai-audio-transcriptions', 'volcengine-bigasr-flash', 'aliyun-qwen-asr'],
        requiredPorts: ['LlmProviderPort', 'SpeechToTextPort', 'SubtitlePort', 'SecretStorePort'],
      },
    },
    doctor: {
      reportVersion: 'video-cut.doctor.v1',
      deploymentMode: 'desktop-local',
      generatedAt: '2026-04-27T01:02:03.000Z',
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
          speechToTextProviderProfiles: ['openai-audio-transcriptions', 'volcengine-bigasr-flash', 'aliyun-qwen-asr'],
          requiredPorts: ['LlmProviderPort', 'SpeechToTextPort', 'SubtitlePort', 'SecretStorePort'],
        },
      },
      checks: [{ checkId: 'redaction', status: 'ok', label: 'Diagnostics redaction enabled' }],
      redactedConfig: settings,
    },
    redactedConfig: settings,
    artifacts: [],
  };
}

describe('diagnostic bundle export', () => {
  it('creates a deterministic downloadable JSON descriptor from a safe bundle', () => {
    const descriptor = createDiagnosticBundleDownloadDescriptor(createBundle());

    expect(descriptor.fileName).toBe('sdkwork-video-cut-diagnostics-desktop-local-20260427T010203000Z.json');
    expect(descriptor.mediaType).toBe('application/vnd.sdkwork.video-cut.diagnostics+json');
    expect(descriptor.href.startsWith('data:application/vnd.sdkwork.video-cut.diagnostics+json;charset=utf-8,')).toBe(true);
    expect(descriptor.sizeBytes).toBe(new TextEncoder().encode(descriptor.body).length);
    expect(descriptor.redaction.safe).toBe(true);
    expect(JSON.parse(descriptor.body)).toMatchObject({
      bundleVersion: 'video-cut.diagnostics-bundle.v1',
      deploymentMode: 'desktop-local',
      includes: {
        sourceMedia: false,
        transcript: false,
      },
    });
  });

  it('blocks unsafe diagnostic bundles before a browser href is generated', () => {
    const bundle = createBundle();
    (bundle.redactedConfig.ai as typeof bundle.redactedConfig.ai & { apiKey: string }).apiKey = 'sk-plain-secret';

    expect(() => createDiagnosticBundleDownloadDescriptor(bundle)).toThrowError(/Unsafe diagnostics bundle/);
  });

  it('blocks diagnostic bundles that still contain server-local absolute paths', () => {
    const bundle = createBundle();
    bundle.doctor.checks = [
      {
        checkId: 'workspaceWritable',
        status: 'ok',
        label: 'Workspace writable',
        details: { path: 'D:\\private\\video-cut\\workspace' },
      },
    ];
    bundle.redactedConfig.storage.workspaceRoot = 'D:\\private\\video-cut\\workspace';

    expect(() => createDiagnosticBundleDownloadDescriptor(bundle)).toThrowError(/local-absolute-path/);
  });

  it('exports support attachment descriptors only when content references remain host-relative', () => {
    const bundle = createBundle();
    bundle.includes.sourceMedia = true;
    bundle.includes.transcript = true;
    bundle.artifacts = [
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
      {
        kind: 'transcript',
        taskId: 'task-support',
        artifactId: 'task-support-transcript',
        path: 'workspace/projects/default/tasks/task-support/analysis/transcript.json',
        contentRef: '/api/video-cut/v1/tasks/task-support/artifacts/task-support-transcript/content',
        included: true,
        redacted: false,
        sizeBytes: 512,
        sha256: 'def456',
      },
    ];

    const descriptor = createDiagnosticBundleDownloadDescriptor(bundle);

    expect(descriptor.redaction.safe).toBe(true);
    expect(JSON.parse(descriptor.body).artifacts).toHaveLength(2);
  });

  it('blocks support attachment descriptors that expose server-local content references', () => {
    const bundle = createBundle();
    bundle.includes.sourceMedia = true;
    bundle.artifacts = [
      {
        kind: 'sourceMedia',
        taskId: 'task-support',
        artifactId: 'task-support-source',
        path: 'workspace/projects/default/tasks/task-support/source/input.mp4',
        contentRef: 'D:\\private\\workspace\\input.mp4',
        included: true,
        redacted: false,
        sizeBytes: 1024,
        sha256: 'abc123',
      },
    ];

    expect(() => createDiagnosticBundleDownloadDescriptor(bundle)).toThrowError(/local-absolute-path/);
  });
});
