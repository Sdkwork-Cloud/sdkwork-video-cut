import {
  createDefaultRenderRequest,
  createDefaultSubtitleDocument,
  createDefaultVideoSplitPlan,
  mediaContractSchemaIds,
  type RenderAttemptManifest,
  type TranscriptDocument,
  type TranscriptSegment,
  type VideoSplitPlan,
  validateRenderRequest,
  validateVideoSplitPlan,
} from '../domain/mediaContracts';
import { VideoCutHostApiError } from '../domain/hostApiErrors';
import {
  type ArtifactDownloadDescriptor,
  type AssetCatalog,
  type AssetCatalogKind,
  type AssetCatalogSlot,
  type AttachTaskSourceInput,
  type CapabilityReport,
  type CreateTaskInput,
  type DeleteTaskResult,
  type DeploymentDoctorCheck,
  type DeploymentDoctorReport,
  type DiagnosticBundle,
  type DiagnosticBundleArtifact,
  type DiagnosticSupportBundleRequest,
  type ManualTranscriptInput,
  type ProviderConformanceCheck,
  type ProviderConformanceReport,
  type ProviderConformanceTarget,
  type SubtitleExportOutput,
  type SubtitleFormat,
  type SubtitleImportInput,
  type ValidationResult,
  type VideoCutArtifact,
  type VideoCutProgressEvent,
  type VideoCutSettings,
  type VideoCutSettingsSavePayload,
  type VideoCutTask,
  createDefaultSettings,
} from '../domain/videoCutTypes';
import type { VideoCutHostClient } from '../ports/videoCutHostClient';
import { validateRuntimeSettings } from './settingsValidation';

export type { VideoCutHostClient } from '../ports/videoCutHostClient';

const REDACTED_PATH = '<redacted-path>';

function mockEndpoint(path: string): string {
  return `mock://video-cut${path}`;
}

function mockTaskPath(taskId: string, suffix = ''): string {
  return `/tasks/${encodeURIComponent(taskId)}${suffix}`;
}

function mockArtifactPath(taskId: string, artifactId: string, suffix: string): string {
  return `${mockTaskPath(taskId, '/artifacts')}/${encodeURIComponent(artifactId)}${suffix}`;
}

function mockHostError({
  code,
  endpoint,
  message,
  status,
  traceId,
}: {
  code: string;
  endpoint: string;
  message: string;
  status: number;
  traceId: string;
}): VideoCutHostApiError {
  return new VideoCutHostApiError({
    code,
    endpoint: mockEndpoint(endpoint),
    message,
    status,
    traceId,
  });
}

function mockTaskNotFoundError(taskId: string, endpoint = mockTaskPath(taskId)): VideoCutHostApiError {
  return mockHostError({
    code: 'TASK_NOT_FOUND',
    endpoint,
    message: `Task not found: ${taskId}`,
    status: 404,
    traceId: `trace-${taskId}`,
  });
}

function mockPlanNotFoundError(taskId: string, endpoint = mockTaskPath(taskId, '/plan')): VideoCutHostApiError {
  return mockHostError({
    code: 'TASK_PLAN_NOT_FOUND',
    endpoint,
    message: `Task plan not found: ${taskId}`,
    status: 404,
    traceId: `trace-${taskId}`,
  });
}

function mockArtifactNotFoundError(taskId: string, artifactId: string, suffix = ''): VideoCutHostApiError {
  return mockHostError({
    code: 'ARTIFACT_NOT_FOUND',
    endpoint: mockArtifactPath(taskId, artifactId, suffix),
    message: `Artifact not found: ${artifactId}`,
    status: 404,
    traceId: `trace-${taskId}`,
  });
}

function mockBadRequestError({
  code,
  endpoint,
  message,
  taskId,
}: {
  code: string;
  endpoint: string;
  message: string;
  taskId: string;
}): VideoCutHostApiError {
  return mockHostError({
    code,
    endpoint,
    message,
    status: 400,
    traceId: `trace-${taskId}`,
  });
}

export interface VideoCutHostSnapshot {
  settings: VideoCutSettings;
  taskSequence: number;
  tasks: VideoCutTask[];
  events: Record<string, VideoCutProgressEvent[]>;
  artifacts: Record<string, VideoCutArtifact[]>;
  plans: Record<string, VideoSplitPlan>;
}

export interface VideoCutHostStore {
  load(): VideoCutHostSnapshot | undefined;
  save(snapshot: VideoCutHostSnapshot): void;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function nowIso(): string {
  return new Date().toISOString();
}

function createTaskId(index: number): string {
  return `task-${String(index).padStart(4, '0')}`;
}

function createSha(seed: string): string {
  return `${seed}-sha256`.padEnd(64, '0').slice(0, 64);
}

function createContentSha(input: string): string {
  const words = Array.from({ length: 8 }, (_, index) => 0x811c9dc5 ^ Math.imul(index + 1, 0x9e3779b1));
  const bytes = new TextEncoder().encode(input);
  bytes.forEach((byte, index) => {
    const slot = index % words.length;
    words[slot] = Math.imul(words[slot] ^ byte, 0x01000193);
  });
  return words.map((word) => (word >>> 0).toString(16).padStart(8, '0')).join('');
}

function jsonArtifactMetadata(value: unknown) {
  const body = JSON.stringify(value, null, 2);
  return {
    sha256: createContentSha(body),
    sizeBytes: new TextEncoder().encode(body).length,
  };
}

function inferArtifactContentType(artifact: VideoCutArtifact): string {
  if (artifact.path.endsWith('.mp4')) {
    return 'video/mp4';
  }

  if (artifact.path.endsWith('.ass')) {
    return 'text/x-ssa';
  }

  if (artifact.path.endsWith('.json')) {
    return 'application/json';
  }

  if (artifact.path.endsWith('.png')) {
    return 'image/png';
  }

  if (artifact.path.endsWith('.log') || artifact.path.endsWith('.txt')) {
    return 'text/plain';
  }

  return 'application/octet-stream';
}

function createRenderAttemptManifestText({
  artifact,
  plan,
  taskArtifacts,
}: {
  artifact: VideoCutArtifact;
  plan: VideoSplitPlan;
  taskArtifacts: VideoCutArtifact[];
}): string {
  const renderId = artifact.renderId ?? `${artifact.taskId}-render-1`;
  const findRenderArtifact = (kind: VideoCutArtifact['kind']) =>
    taskArtifacts.find((item) => item.renderId === renderId && item.kind === kind);
  const firstSegment = plan.segments[0];
  const document: RenderAttemptManifest = {
    schemaId: mediaContractSchemaIds.renderAttemptManifest,
    renderAttemptVersion: 1,
    taskId: artifact.taskId,
    renderId,
    planId: plan.planId,
    planRevision: plan.planRevision,
    sourceArtifactId: `${artifact.taskId}-source`,
    transcriptArtifactId: `${artifact.taskId}-transcript`,
    outputArtifactId: findRenderArtifact('render')?.artifactId ?? `${renderId}-output`,
    subtitleArtifactId: findRenderArtifact('subtitle')?.artifactId ?? `${renderId}-subtitle`,
    coverArtifactId: findRenderArtifact('cover')?.artifactId ?? `${renderId}-cover`,
    logArtifactId: findRenderArtifact('log')?.artifactId ?? `${renderId}-log`,
    subtitleBurnIn: true,
    subtitleCueCount: 2,
    sourceRange: firstSegment.sourceRange,
    outputSpec: plan.outputSpec,
    renderGraph: {
      engine: 'ffmpeg',
      adapterVersion: 'ffmpeg-media-render.adapter.v1',
      videoFilterPreset: 'standard-vertical-scale-crop-fps-ass-burn-in.v1',
      audioFilterPreset: 'voice-basic-loudnorm-afftdn.v1',
      voiceEnhancement: {
        status: 'applied',
        filters: ['loudnorm', 'afftdn'],
      },
      bgm: {
        ...mockAudioAssetMixSlot(plan.renderPreferences.audio.bgm, 'bgm'),
        volumePercent: 20,
      },
      sfx: mockAudioAssetMixSlot(plan.renderPreferences.audio.sfx, 'sfx'),
      codec: {
        video: 'libx264',
        audio: 'aac',
      },
    },
    warnings: [],
    createdAt: artifact.createdAt,
  };

  return JSON.stringify(document, null, 2);
}

function mockAudioAssetMixSlot(preference: VideoSplitPlan['renderPreferences']['audio']['bgm'], kind: 'bgm' | 'sfx') {
  if (preference.mode === 'disabled') {
    return {
      status: 'disabled' as const,
      mixed: false,
    };
  }

  if (preference.mode !== 'asset' || !preference.assetId || !preference.path) {
    return {
      status: 'not-configured' as const,
      mixed: false,
    };
  }

  return {
    status: 'mixed' as const,
    mixed: true,
    asset: {
      assetId: preference.assetId,
      path: preference.path as `assets://${typeof kind}/${string}`,
      sha256: createSha(`${preference.assetId}-${preference.path}`),
      license: 'mock-catalog-license',
      source: 'mock-catalog',
      version: 'mock-catalog-v1',
    },
  };
}

function planWithOnlySegment(plan: VideoSplitPlan, segmentIndex: number): VideoSplitPlan {
  const segment = plan.segments[segmentIndex];
  if (!segment) {
    throw new Error(`Split plan segment not found: ${segmentIndex}`);
  }

  return {
    ...clone(plan),
    segments: [clone(segment)],
  };
}

function createRenderArtifacts(taskId: string, renderId: string): VideoCutArtifact[] {
  return [
    {
      artifactId: `${renderId}-output`,
      taskId,
      renderId,
      kind: 'render',
      path: `workspace/projects/default/tasks/${taskId}/renders/${renderId}/output.mp4`,
      sizeBytes: 42_000_000,
      sha256: createSha(`${renderId}-output`),
      createdAt: nowIso(),
    },
    {
      artifactId: `${renderId}-subtitle`,
      taskId,
      renderId,
      kind: 'subtitle',
      path: `workspace/projects/default/tasks/${taskId}/renders/${renderId}/subtitles.ass`,
      sizeBytes: 2_048,
      sha256: createSha(`${renderId}-subtitle`),
      createdAt: nowIso(),
    },
    {
      artifactId: `${renderId}-cover`,
      taskId,
      renderId,
      kind: 'cover',
      path: `workspace/projects/default/tasks/${taskId}/renders/${renderId}/cover.png`,
      sizeBytes: 512_000,
      sha256: createSha(`${renderId}-cover`),
      createdAt: nowIso(),
    },
    {
      artifactId: `${renderId}-manifest`,
      taskId,
      renderId,
      kind: 'render-manifest',
      path: `workspace/projects/default/tasks/${taskId}/renders/${renderId}/render.json`,
      sizeBytes: 1_536,
      sha256: createSha(`${renderId}-manifest`),
      createdAt: nowIso(),
    },
    {
      artifactId: `${renderId}-log`,
      taskId,
      renderId,
      kind: 'log',
      path: `workspace/projects/default/tasks/${taskId}/renders/${renderId}/render.log`,
      sizeBytes: 1_024,
      sha256: createSha(`${renderId}-log`),
      createdAt: nowIso(),
    },
  ];
}

function createManualTranscriptDocument({
  input,
  taskId,
  audioArtifact,
  languageFallback,
}: {
  input: ManualTranscriptInput;
  taskId: string;
  audioArtifact?: VideoCutArtifact;
  languageFallback: string;
}): TranscriptDocument {
  if (input.segments.length === 0) {
    throw new Error('Manual transcript must contain at least one segment.');
  }
  let previousEndMs = 0;
  const segments: TranscriptSegment[] = input.segments.map((segment, index) => {
    const text = segment.text.trim();
    if (!text) {
      throw new Error(`Manual transcript segment ${index + 1} text is empty.`);
    }
    if (segment.endMs <= segment.startMs) {
      throw new Error(`Manual transcript segment ${index + 1} must have endMs greater than startMs.`);
    }
    if (index > 0 && segment.startMs < previousEndMs) {
      throw new Error(`Manual transcript segment ${index + 1} overlaps the previous segment.`);
    }
    previousEndMs = segment.endMs;

    return {
      endMs: segment.endMs,
      segmentId: `${taskId}-manual-transcript-segment-${index + 1}`,
      speakerId: segment.speakerId,
      startMs: segment.startMs,
      text,
    };
  });
  const text = input.text?.trim() || segments.map((segment) => segment.text).join('\n');
  const durationSeconds = Math.max(...segments.map((segment) => segment.endMs)) / 1000;

  return {
    adapterVersion: 'manual-transcript.adapter.v1',
    audioArtifactId: audioArtifact?.artifactId ?? `${taskId}-audio-source`,
    audioPath: audioArtifact?.path ?? `workspace/projects/default/tasks/${taskId}/audio/source.wav`,
    createdAt: nowIso(),
    durationSeconds,
    language: input.language?.trim() || languageFallback || 'zh',
    providerId: 'manual-transcript',
    schemaId: mediaContractSchemaIds.transcriptDocument,
    segments,
    taskId,
    text,
    timestampGranularity: ['segment'],
    transcriptStatus: 'ok',
    transcriptVersion: 1,
    warnings: [],
  };
}

interface ParsedSubtitleCue {
  startMs: number;
  endMs: number;
  text: string;
}

function normalizeSubtitleFormat(format: string): SubtitleFormat {
  const normalized = format.trim().toLowerCase();
  if (normalized === 'srt' || normalized === 'vtt') {
    return normalized;
  }

  throw new Error('Subtitle format must be srt or vtt.');
}

function parseSubtitleCues(format: SubtitleFormat, content: string): ParsedSubtitleCue[] {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalized) {
    throw new Error('Subtitle content is empty.');
  }

  const cues = normalized
    .split(/\n{2,}/)
    .flatMap((block) => {
      const lines = block
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      if (format === 'vtt' && lines[0]?.toLowerCase().startsWith('webvtt')) {
        return [];
      }
      const timeLineIndex = lines.findIndex((line) => line.includes('-->'));
      if (timeLineIndex < 0) {
        throw new Error('Subtitle cue is missing a time range.');
      }
      const [startRaw, endRaw = ''] = lines[timeLineIndex].split('-->');
      const endToken = endRaw.trim().split(/\s+/)[0] ?? '';
      const text = lines.slice(timeLineIndex + 1).join('\n').trim();
      if (!text) {
        throw new Error('Subtitle cue text is empty.');
      }
      return [{ startMs: parseSubtitleTimestamp(startRaw), endMs: parseSubtitleTimestamp(endToken), text }];
    });

  if (cues.length === 0) {
    throw new Error('Subtitle document must contain at least one cue.');
  }
  cues.forEach((cue, index) => {
    if (cue.endMs <= cue.startMs) {
      throw new Error(`Subtitle cue ${index + 1} endMs must be greater than startMs.`);
    }
    const previous = cues[index - 1];
    if (previous && cue.startMs < previous.endMs) {
      throw new Error(`Subtitle cue ${index + 1} overlaps the previous cue.`);
    }
  });

  return cues;
}

function parseSubtitleTimestamp(value: string): number {
  const parts = value.trim().replace(',', '.').split(':');
  const [hours, minutes, secondsPart] =
    parts.length === 3 ? [Number(parts[0]), Number(parts[1]), parts[2]] : [0, Number(parts[0]), parts[1]];
  const [secondsRaw, millisRaw = '0'] = String(secondsPart ?? '').split('.');
  const seconds = Number(secondsRaw);
  const millis = Number(millisRaw.padEnd(3, '0').slice(0, 3));
  if (![hours, minutes, seconds, millis].every(Number.isFinite)) {
    throw new Error(`Subtitle timestamp is invalid: ${value}.`);
  }

  return (((hours * 60 + minutes) * 60 + seconds) * 1000) + millis;
}

function formatSubtitleTimestamp(valueMs: number, separator: ',' | '.'): string {
  const millis = valueMs % 1000;
  const totalSeconds = Math.floor(valueMs / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}${separator}${String(millis).padStart(3, '0')}`;
}

function createSubtitleTranscriptDocument({
  input,
  taskId,
  audioArtifact,
  languageFallback,
}: {
  input: SubtitleImportInput;
  taskId: string;
  audioArtifact?: VideoCutArtifact;
  languageFallback: string;
}): TranscriptDocument {
  const format = normalizeSubtitleFormat(input.format);
  const cues = parseSubtitleCues(format, input.content);
  return {
    adapterVersion: `subtitle-${format}-import.adapter.v1`,
    audioArtifactId: audioArtifact?.artifactId ?? `${taskId}-audio-source`,
    audioPath: audioArtifact?.path ?? `workspace/projects/default/tasks/${taskId}/audio/source.wav`,
    createdAt: nowIso(),
    durationSeconds: Math.max(...cues.map((cue) => cue.endMs)) / 1000,
    language: input.language?.trim() || languageFallback || 'zh',
    providerId: `subtitle-import-${format}`,
    schemaId: mediaContractSchemaIds.transcriptDocument,
    segments: cues.map((cue, index) => ({
      segmentId: `${taskId}-subtitle-import-segment-${index + 1}`,
      startMs: cue.startMs,
      endMs: cue.endMs,
      text: cue.text,
    })),
    taskId,
    text: cues.map((cue) => cue.text).join('\n'),
    timestampGranularity: ['segment'],
    transcriptStatus: 'ok',
    transcriptVersion: 1,
    warnings: [],
  };
}

function exportTranscriptAsSubtitle(transcript: TranscriptDocument, format: SubtitleFormat): string {
  if (format === 'vtt') {
    return `WEBVTT\n\n${transcript.segments
      .map((segment) => `${formatSubtitleTimestamp(segment.startMs, '.')} --> ${formatSubtitleTimestamp(segment.endMs, '.')}\n${segment.text}\n`)
      .join('\n')}`;
  }

  return transcript.segments
    .map((segment, index) => `${index + 1}\n${formatSubtitleTimestamp(segment.startMs, ',')} --> ${formatSubtitleTimestamp(segment.endMs, ',')}\n${segment.text}\n`)
    .join('\n');
}

function sanitizeSourceFileName(sourceName: string): string {
  const fileName = sourceName.split(/[\\/]/).pop()?.trim() ?? '';
  const sanitized = fileName
    .replace(/[^a-zA-Z0-9.\-_ ()]/g, '_')
    .replace(/^\.+|\.+$/g, '')
    .trim();

  return sanitized || 'source.bin';
}

function validateSourceMediaType(
  sourceName: string,
  contentType: string | undefined,
  context: {
    endpoint: string;
    taskId: string;
  },
): void {
  const extension = sourceName.includes('.') ? sourceName.split('.').pop()?.toLowerCase() ?? '' : '';
  const extensionAllowed = ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'mpeg', 'mpg'].includes(extension);
  const normalizedContentType = contentType?.trim().toLowerCase() ?? '';
  const contentTypeAllowed =
    normalizedContentType.length === 0 ||
    normalizedContentType === 'application/octet-stream' ||
    normalizedContentType === 'application/x-matroska' ||
    normalizedContentType.startsWith('video/');

  if (!extensionAllowed || !contentTypeAllowed) {
    throw mockBadRequestError({
      code: 'SOURCE_FILE_TYPE_UNSUPPORTED',
      endpoint: context.endpoint,
      message: 'Source file must be a supported video file: mp4, mov, m4v, mkv, webm, avi, mpeg, or mpg.',
      taskId: context.taskId,
    });
  }
}

function normalizeProviderBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed.slice(0, -3).replace(/\/+$/, '') : trimmed;
}

function buildOpenAiCompatibleEndpoint(baseUrl: string, path: 'chat/completions' | 'audio/transcriptions'): string {
  return `${normalizeProviderBaseUrl(baseUrl)}/v1/${path}`;
}

function buildSpeechBridgeEndpoint(baseUrl: string, providerProfile: VideoCutSettings['speechToText']['providerProfile']): string {
  const normalized = normalizeProviderBaseUrl(baseUrl);
  if (providerProfile === 'volcengine-bigasr-flash') {
    return `${normalized}/api/v3/auc/bigmodel/recognize/flash`;
  }

  if (providerProfile === 'aliyun-qwen-asr') {
    return `${normalized}/compatible-mode/v1/chat/completions`;
  }

  return `${normalized}/v1/audio/transcriptions`;
}

function isValidHttpUrl(value: string): boolean {
  const lower = value.trim().toLowerCase();
  return (lower.startsWith('http://') || lower.startsWith('https://')) && lower.length > 'http://'.length;
}

function isOllamaEndpoint(value: string): boolean {
  const lower = value.trim().toLowerCase();
  return lower.includes('ollama') || lower.includes('localhost:11434') || lower.includes('127.0.0.1:11434');
}

function credentialStatus(configured: boolean): 'configured' | 'not-configured' {
  return configured ? 'configured' : 'not-configured';
}

function structuredResponseFormat(mode: VideoCutSettings['ai']['structuredOutputMode']): Record<string, unknown> {
  if (mode === 'json-object-fallback') {
    return { type: 'json_object' };
  }

  return {
    type: 'json_schema',
    jsonSchema: {
      name: 'video_cut_provider_conformance',
      strict: true,
      schema: {
        additionalProperties: false,
        properties: {
          status: { enum: ['ok'], type: 'string' },
        },
        required: ['status'],
        type: 'object',
      },
    },
  };
}

function providerValidationErrors({
  baseUrl,
  chatModel,
  credentialConfigured,
  needsLlm,
  needsStt,
  transcriptionModel,
}: {
  baseUrl: string;
  chatModel?: string;
  credentialConfigured: boolean;
  needsLlm: boolean;
  needsStt: boolean;
  transcriptionModel?: string;
}): Array<{ code: string; field: string; message: string }> {
  const errors: Array<{ code: string; field: string; message: string }> = [];

  if (!isValidHttpUrl(baseUrl)) {
    errors.push({
      code: 'INVALID_URL',
      field: 'baseUrl',
      message: 'Base URL must be an absolute HTTP or HTTPS URL.',
    });
  }

  if (isOllamaEndpoint(baseUrl)) {
    errors.push({
      code: 'OLLAMA_NOT_ALLOWED',
      field: 'baseUrl',
      message: 'Ollama-compatible endpoints are not allowed by this product contract.',
    });
  }

  if (!credentialConfigured) {
    errors.push({
      code: 'REQUIRED',
      field: 'credential',
      message: 'Provider credential is required.',
    });
  }

  if (needsLlm && !chatModel?.trim()) {
    errors.push({
      code: 'REQUIRED',
      field: 'chatModel',
      message: 'Chat model is required for LLM capability.',
    });
  }

  if (needsStt && !transcriptionModel?.trim()) {
    errors.push({
      code: 'REQUIRED',
      field: 'transcriptionModel',
      message: 'Transcription model is required for speech-to-text capability.',
    });
  }

  return errors;
}

function createProviderConformanceReport({
  baseUrl,
  chatModel,
  credentialConfigured,
  needsLlm,
  needsStt,
  providerId,
  settings,
  transcriptionModel,
}: {
  baseUrl: string;
  chatModel?: string;
  credentialConfigured: boolean;
  needsLlm: boolean;
  needsStt: boolean;
  providerId: string;
  settings: VideoCutSettings;
  transcriptionModel?: string;
}): ProviderConformanceReport {
  const errors = providerValidationErrors({
    baseUrl,
    chatModel,
    credentialConfigured,
    needsLlm,
    needsStt,
    transcriptionModel,
  });
  const valid = errors.length === 0;
  const status = valid ? 'ok' : 'fail';
  const checks: ProviderConformanceCheck[] = [];

  if (!valid) {
    checks.push({
      checkId: 'provider.config.validation',
      status,
      label: 'Provider configuration validation',
      actionHint: 'Fix provider settings before running media analysis.',
      details: {
        credentialStatus: credentialStatus(credentialConfigured),
        errors,
      },
    });
  }

  if (needsLlm) {
    checks.push({
      checkId: 'llm.endpoint.chatCompletions',
      status: isValidHttpUrl(baseUrl) ? 'ok' : 'fail',
      label: 'LLM chat completions endpoint',
      actionHint: isValidHttpUrl(baseUrl) ? null : 'Configure a valid OpenAI-compatible base URL.',
      details: {
        credentialStatus: credentialStatus(credentialConfigured),
        endpoint: isValidHttpUrl(baseUrl) ? buildOpenAiCompatibleEndpoint(baseUrl, 'chat/completions') : '',
        method: 'POST',
        model: chatModel ?? '',
        retryCount: settings.ai.retryCount,
        timeoutSeconds: settings.ai.timeoutSeconds,
      },
    });
    checks.push({
      checkId: 'llm.structuredOutput',
      status,
      label: 'LLM structured output request contract',
      actionHint: valid ? null : 'Use JSON schema mode when the provider supports it; otherwise use json_object fallback.',
      details: {
        responseFormat: structuredResponseFormat(settings.ai.structuredOutputMode),
        schemaId: 'video-cut.provider-conformance.response-format.v1',
      },
    });
  }

  if (needsStt) {
    checks.push({
      checkId: 'stt.endpoint.audioTranscriptions',
      status: isValidHttpUrl(baseUrl) ? 'ok' : 'fail',
      label: 'Speech-to-text audio transcriptions endpoint',
      actionHint: isValidHttpUrl(baseUrl) ? null : 'Configure a valid OpenAI-compatible base URL.',
      details: {
        credentialStatus: credentialStatus(credentialConfigured),
        endpoint: isValidHttpUrl(baseUrl) ? buildOpenAiCompatibleEndpoint(baseUrl, 'audio/transcriptions') : '',
        method: 'POST',
        model: transcriptionModel ?? '',
        multipart: true,
        retryCount: settings.ai.retryCount,
        timeoutSeconds: settings.ai.timeoutSeconds,
      },
    });
  }

  return {
    reportVersion: 'video-cut.provider-conformance.v1',
    providerId,
    status,
    generatedAt: nowIso(),
    checks,
  };
}

function createSpeechToTextConformanceReport({
  baseUrl,
  credentialConfigured,
  providerProfile,
  settings,
}: {
  baseUrl: string;
  credentialConfigured: boolean;
  providerProfile: VideoCutSettings['speechToText']['providerProfile'];
  settings: VideoCutSettings;
}): ProviderConformanceReport {
  const errors = providerValidationErrors({
    baseUrl,
    credentialConfigured,
    needsLlm: false,
    needsStt: true,
    transcriptionModel: settings.speechToText.transcriptionModel,
  });
  if (providerProfile === 'volcengine-bigasr-flash' && !settings.speechToText.resourceId.trim()) {
    errors.push({
      code: 'REQUIRED',
      field: 'resourceId',
      message: 'Volcengine BigASR Flash resource id is required.',
    });
  }
  const valid = errors.length === 0;

  return {
    reportVersion: 'video-cut.provider-conformance.v1',
    providerId: 'runtime-speech-to-text-bridge',
    status: valid ? 'ok' : 'fail',
    generatedAt: nowIso(),
    checks: [
      ...(valid
        ? []
        : [
            {
              checkId: 'provider.config.validation',
              status: 'fail' as const,
              label: 'Speech-to-text provider configuration validation',
              actionHint: 'Fix speech-to-text provider settings before running media analysis.',
              details: {
                credentialStatus: credentialStatus(credentialConfigured),
                errors,
                providerProfile,
              },
            },
          ]),
      {
        checkId: 'stt.provider.bridge',
        status: valid ? 'ok' : 'fail',
        label: 'Speech-to-text provider bridge contract',
        actionHint: valid ? null : 'Configure STT provider base URL, model, credential, and vendor profile metadata.',
        details: {
          canonicalRequest: 'openai-audio-transcriptions.verbose-json',
          canonicalResponse: 'openai-audio-transcriptions.verbose-json',
          credentialStatus: credentialStatus(credentialConfigured),
          languageHint: settings.speechToText.languageHint,
          model: settings.speechToText.transcriptionModel,
          providerProfile,
          ...(providerProfile === 'volcengine-bigasr-flash' ? { resourceId: settings.speechToText.resourceId } : {}),
          retryCount: settings.ai.retryCount,
          timeoutSeconds: settings.ai.timeoutSeconds,
          timestampGranularity: settings.speechToText.timestampGranularity,
          vendorEndpoint: isValidHttpUrl(baseUrl) ? buildSpeechBridgeEndpoint(baseUrl, providerProfile) : '',
        },
      },
    ],
  };
}

function mergeProviderConformanceReports(reports: ProviderConformanceReport[]): ProviderConformanceReport {
  return {
    reportVersion: 'video-cut.provider-conformance.v1',
    providerId: 'runtime-openai-compatible',
    status: reports.some((report) => report.status === 'fail') ? 'fail' : 'ok',
    generatedAt: nowIso(),
    checks: reports.flatMap((report) => report.checks),
  };
}

function toProviderConformanceReport(settings: VideoCutSettings, target: ProviderConformanceTarget): ProviderConformanceReport {
  const aiReport = () =>
    createProviderConformanceReport({
      baseUrl: settings.ai.baseUrl,
      chatModel: settings.ai.chatModel,
      credentialConfigured: settings.ai.apiKeyConfigured,
      needsLlm: true,
      needsStt: false,
      providerId: 'runtime-openai-compatible-ai',
      settings,
    });
  const sttCredentialConfigured = settings.speechToText.reuseAiProviderConnection
    ? settings.ai.apiKeyConfigured
    : settings.speechToText.apiKeyConfigured;
  const sttBaseUrl = settings.speechToText.reuseAiProviderConnection ? settings.ai.baseUrl : settings.speechToText.baseUrl;
  const sttReport = () =>
    createSpeechToTextConformanceReport({
      baseUrl: sttBaseUrl,
      credentialConfigured: sttCredentialConfigured,
      providerProfile: settings.speechToText.providerProfile,
      settings,
    });

  if (target === 'ai') {
    return aiReport();
  }

  if (target === 'speechToText') {
    return sttReport();
  }

  if (settings.speechToText.reuseAiProviderConnection) {
    return mergeProviderConformanceReports([aiReport(), sttReport()]);
  }

  return mergeProviderConformanceReports([aiReport(), sttReport()]);
}

function toCapabilityReport(settings: VideoCutSettings): CapabilityReport {
  const aiReady = settings.ai.enabled && settings.ai.apiKeyConfigured;
  const sttReady =
    settings.speechToText.enabled &&
    (settings.speechToText.apiKeyConfigured || (settings.speechToText.reuseAiProviderConnection && aiReady));

  return {
    reportVersion: 'video-cut.capability.v1',
    deploymentMode: settings.runtime.deploymentMode,
    qualityTier: aiReady && sttReady ? 'interview' : 'basic',
    health: 'ok',
    ai: {
      status: aiReady ? 'ok' : 'warn',
      label: aiReady ? 'LLM ready' : 'LLM not configured',
      actionHint: aiReady ? undefined : 'Open Settings > AI Providers and configure an API key.',
    },
    speechToText: {
      status: sttReady ? 'ok' : 'warn',
      label: sttReady ? 'Speech to text ready' : 'Speech to text not configured',
      actionHint: sttReady ? undefined : 'Open Settings > Speech To Text and configure transcription.',
    },
    media: {
      status: 'ok',
      label: 'FFmpeg and ffprobe configured',
    },
    storage: {
      status: 'ok',
      label: 'Workspace paths configured',
    },
    security: {
      status: settings.security.redactionEnabled ? 'ok' : 'warn',
      label: settings.security.redactionEnabled ? 'Redaction enabled' : 'Redaction disabled',
    },
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
  };
}

function toRedactedSettings(settings: VideoCutSettingsSavePayload): VideoCutSettings {
  const nextSettings = clone(settings) as VideoCutSettingsSavePayload & {
    ai: VideoCutSettings['ai'] & Record<string, unknown>;
    speechToText: VideoCutSettings['speechToText'] & Record<string, unknown>;
  };
  delete nextSettings.ai.apiKey;
  delete nextSettings.speechToText.apiKey;
  redactAbsoluteStoragePaths(nextSettings);
  return nextSettings;
}

function redactAbsoluteStoragePaths(settings: VideoCutSettings): void {
  for (const key of ['workspaceRoot', 'artifactRoot', 'tempRoot'] as const) {
    if (isAbsoluteLocalPath(settings.storage[key])) {
      settings.storage[key] = REDACTED_PATH;
    }
  }
}

function redactPathDetail(value: string): string {
  return isAbsoluteLocalPath(value) ? REDACTED_PATH : value;
}

function isAbsoluteLocalPath(value: string): boolean {
  const trimmed = String(value || '').trim();
  return /^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith('\\\\') || trimmed.startsWith('/');
}

function toAssetCatalog(settings: VideoCutSettings): AssetCatalog {
  const slotDefinitions: Array<{
    kind: AssetCatalogKind;
    configuredPath: string;
    supportedExtensions: string[];
  }> = [
    { kind: 'fonts', configuredPath: settings.assets.fonts, supportedExtensions: ['otf', 'ttc', 'ttf', 'woff', 'woff2'] },
    { kind: 'bgm', configuredPath: settings.assets.bgm, supportedExtensions: ['aac', 'flac', 'm4a', 'mp3', 'ogg', 'wav'] },
    { kind: 'sfx', configuredPath: settings.assets.sfx, supportedExtensions: ['aac', 'flac', 'm4a', 'mp3', 'ogg', 'wav'] },
    { kind: 'coverTemplates', configuredPath: settings.assets.coverTemplates, supportedExtensions: ['jpeg', 'jpg', 'json', 'png', 'webp'] },
  ];
  const slots: AssetCatalogSlot[] = slotDefinitions.map((definition) => ({
    kind: definition.kind,
    status: 'not-configured',
    configuredPath: redactAssetPathDetail(definition.configuredPath),
    manifestPath: `assets://${definition.kind}/asset-manifest.json`,
    supportedExtensions: definition.supportedExtensions,
    entries: [],
    warnings: [],
  }));

  return {
    schemaId: 'video-cut.asset-catalog.schema.v1',
    assetCatalogVersion: 1,
    generatedAt: nowIso(),
    slots,
  };
}

function redactAssetPathDetail(value: string): string {
  return isAbsoluteLocalPath(value) ? '<server-local-path>' : value.replaceAll('\\', '/');
}

function toDoctorReport(settings: VideoCutSettings): DeploymentDoctorReport {
  const capability = toCapabilityReport(settings);
  const validation = validateRuntimeSettings(settings);
  const mediaToolsConfigured = settings.mediaTools.ffmpegPath.trim() !== '' && settings.mediaTools.ffprobePath.trim() !== '';
  const redactedConfig = toRedactedSettings(settings);
  const checks: DeploymentDoctorCheck[] = [
    {
      checkId: 'health',
      status: 'ok',
      label: 'Host health',
      actionHint: null,
    },
    {
      checkId: 'workspaceWritable',
      status: settings.storage.workspaceRoot.trim() === '' ? 'fail' : 'ok',
      label: settings.storage.workspaceRoot.trim() === '' ? 'Workspace root missing' : 'Workspace writable',
      actionHint:
        settings.storage.workspaceRoot.trim() === ''
          ? 'Open Settings > Storage and configure a writable workspace root.'
          : null,
      details: { path: redactPathDetail(settings.storage.workspaceRoot) },
    },
    {
      checkId: 'ffmpeg',
      status: mediaToolsConfigured ? 'ok' : 'fail',
      label: mediaToolsConfigured ? 'ffmpeg available' : 'ffmpeg unavailable',
      actionHint: mediaToolsConfigured ? null : 'Open Settings > Media Tools and configure valid ffmpeg/ffprobe paths.',
      details: { path: redactPathDetail(settings.mediaTools.ffmpegPath) },
    },
    {
      checkId: 'ffprobe',
      status: mediaToolsConfigured ? 'ok' : 'fail',
      label: mediaToolsConfigured ? 'ffprobe available' : 'ffprobe unavailable',
      actionHint: mediaToolsConfigured ? null : 'Open Settings > Media Tools and configure valid ffmpeg/ffprobe paths.',
      details: { path: redactPathDetail(settings.mediaTools.ffprobePath) },
    },
    {
      checkId: 'providerPolicy',
      status: 'ok',
      label: 'OpenAI-compatible provider policy active',
      actionHint: null,
    },
    {
      checkId: 'settingsValidation',
      status: validation.valid ? 'ok' : 'fail',
      label: validation.valid ? 'Runtime settings valid' : 'Runtime settings invalid',
      actionHint: validation.valid ? null : 'Open Settings and resolve validation errors.',
      details: validation.valid ? undefined : { errors: validation.errors },
    },
    {
      checkId: 'redaction',
      status: JSON.stringify(redactedConfig).includes('"apiKey"') ? 'fail' : 'ok',
      label: JSON.stringify(redactedConfig).includes('"apiKey"')
        ? 'Diagnostics redaction failed'
        : 'Diagnostics redaction enabled',
      actionHint: JSON.stringify(redactedConfig).includes('"apiKey"')
        ? 'Do not export diagnostics until secrets are removed.'
        : null,
    },
  ];

  return {
    reportVersion: 'video-cut.doctor.v1',
    deploymentMode: settings.runtime.deploymentMode,
    generatedAt: nowIso(),
    health: checks.some((check) => check.status === 'fail' || check.status === 'warn') ? 'degraded' : 'ok',
    capability,
    checks,
    redactedConfig,
  };
}

function toDiagnosticBundle(settings: VideoCutSettings): DiagnosticBundle {
  const redactedConfig = toRedactedSettings(settings);

  return {
    bundleVersion: 'video-cut.diagnostics-bundle.v1',
    generatedAt: nowIso(),
    deploymentMode: settings.runtime.deploymentMode,
    includes: {
      sourceMedia: false,
      transcript: false,
    },
    capability: toCapabilityReport(settings),
    doctor: toDoctorReport(settings),
    redactedConfig,
    artifacts: [],
  };
}

function isSafeTaskArtifactPath(taskId: string, path: string): boolean {
  return path.startsWith(`workspace/projects/default/tasks/${taskId}/`) && !path.includes('..') && !path.includes('\\');
}

function toSupportBundleArtifact(
  taskId: string,
  kind: DiagnosticBundleArtifact['kind'],
  artifact: VideoCutArtifact | undefined,
  missingReason: string,
): DiagnosticBundleArtifact {
  if (!artifact) {
    return {
      kind,
      taskId,
      included: false,
      redacted: true,
      reason: missingReason,
    };
  }

  if (!isSafeTaskArtifactPath(taskId, artifact.path)) {
    return {
      kind,
      taskId,
      artifactId: artifact.artifactId,
      included: false,
      redacted: true,
      reason: 'Artifact path failed workspace boundary validation.',
    };
  }

  return {
    kind,
    taskId,
    artifactId: artifact.artifactId,
    path: artifact.path,
    contentRef: `/api/video-cut/v1/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(artifact.artifactId)}/content`,
    contentType: inferArtifactContentType(artifact),
    included: true,
    redacted: false,
    sizeBytes: artifact.sizeBytes,
    sha256: artifact.sha256,
  };
}

function toDiagnosticSupportBundle(
  settings: VideoCutSettings,
  input: DiagnosticSupportBundleRequest,
  taskArtifacts: VideoCutArtifact[] | undefined,
): DiagnosticBundle {
  if ((input.includeSourceMedia || input.includeTranscript) && !input.consentAccepted) {
    throw mockHostError({
      code: 'DIAGNOSTICS_CONSENT_REQUIRED',
      endpoint: '/diagnostics/support-bundle',
      message: 'Explicit consent is required for support attachments.',
      status: 400,
      traceId: 'trace-diagnostics-support-bundle',
    });
  }
  if ((input.includeSourceMedia || input.includeTranscript) && !input.taskId?.trim()) {
    throw mockHostError({
      code: 'DIAGNOSTICS_TASK_REQUIRED',
      endpoint: '/diagnostics/support-bundle',
      message: 'taskId is required for support attachments.',
      status: 400,
      traceId: 'trace-diagnostics-support-bundle',
    });
  }

  const bundle = toDiagnosticBundle(settings);
  const artifacts: DiagnosticBundleArtifact[] = [];

  if (input.taskId && input.includeSourceMedia) {
    artifacts.push(
      toSupportBundleArtifact(
        input.taskId,
        'sourceMedia',
        taskArtifacts?.find((artifact) => artifact.kind === 'source'),
        'Source media artifact is not available for this task.',
      ),
    );
  }

  if (input.taskId && input.includeTranscript) {
    artifacts.push(
      toSupportBundleArtifact(
        input.taskId,
        'transcript',
        taskArtifacts?.find((artifact) => artifact.artifactId === `${input.taskId}-transcript`),
        'Transcript artifact is not available for this task.',
      ),
    );
  }

  return {
    ...bundle,
    includes: {
      sourceMedia: artifacts.some((artifact) => artifact.kind === 'sourceMedia' && artifact.included),
      transcript: artifacts.some((artifact) => artifact.kind === 'transcript' && artifact.included),
    },
    supportRequest: {
      schemaId: 'video-cut.diagnostics-support-bundle-request.v1',
      ...input,
    },
    artifacts,
  };
}

export function createMemoryHostStore(initialSnapshot?: VideoCutHostSnapshot): VideoCutHostStore {
  let snapshot = initialSnapshot ? clone(initialSnapshot) : undefined;

  return {
    load() {
      return snapshot ? clone(snapshot) : undefined;
    },
    save(nextSnapshot: VideoCutHostSnapshot) {
      snapshot = clone(nextSnapshot);
    },
  };
}

export function createBrowserHostStore(storageKey = 'sdkwork-video-cut.host.v1'): VideoCutHostStore | undefined {
  if (typeof window === 'undefined' || !window.localStorage) {
    return undefined;
  }

  return {
    load() {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        return undefined;
      }

      try {
        return JSON.parse(raw) as VideoCutHostSnapshot;
      } catch {
        return undefined;
      }
    },
    save(snapshot: VideoCutHostSnapshot) {
      window.localStorage.setItem(storageKey, JSON.stringify(snapshot));
    },
  };
}

export function createMockHostClient(
  initialSettings = createDefaultSettings(),
  store?: VideoCutHostStore,
): VideoCutHostClient {
  const loadedSnapshot = store?.load();
  let settings = clone(loadedSnapshot?.settings ?? initialSettings);
  let taskSequence = loadedSnapshot?.taskSequence ?? 0;
  const tasks = new Map<string, VideoCutTask>((loadedSnapshot?.tasks ?? []).map((task) => [task.taskId, task]));
  const events = new Map<string, VideoCutProgressEvent[]>(
    Object.entries(loadedSnapshot?.events ?? {}).map(([taskId, taskEvents]) => [taskId, taskEvents]),
  );
  const artifacts = new Map<string, VideoCutArtifact[]>(
    Object.entries(loadedSnapshot?.artifacts ?? {}).map(([taskId, taskArtifacts]) => [taskId, taskArtifacts]),
  );
  const plans = new Map<string, VideoSplitPlan>(
    Object.entries(loadedSnapshot?.plans ?? {}).map(([taskId, plan]) => [taskId, plan]),
  );
  const renderAttemptPlans = new Map<string, VideoSplitPlan>();
  const transcriptDocuments = new Map<string, TranscriptDocument>();
  const subtitleArtifactText = new Map<string, string>();

  function persist(): void {
    store?.save({
      settings,
      taskSequence,
      tasks: Array.from(tasks.values()),
      events: Object.fromEntries(events.entries()),
      artifacts: Object.fromEntries(artifacts.entries()),
      plans: Object.fromEntries(plans.entries()),
    });
  }

  function pushEvent(taskId: string, stage: string, progress: number, message: string): void {
    const current = events.get(taskId) ?? [];
    current.push({
      eventId: `${taskId}-event-${current.length + 1}`,
      taskId,
      stage,
      progress,
      message,
      traceId: `trace-${taskId}`,
    });
    events.set(taskId, current);
  }

  function renderSelectedPlans(taskId: string, selectedPlans: VideoSplitPlan[], finalMessage: string): VideoCutTask {
    if (selectedPlans.length === 0) {
      throw mockBadRequestError({
        code: 'PLAN_SEGMENTS_REQUIRED',
        endpoint: mockTaskPath(taskId, '/render'),
        message: `Task render plan has no segments: ${taskId}`,
        taskId,
      });
    }

    const renderAttemptStart = (artifacts.get(taskId) ?? []).filter((artifact) => artifact.kind === 'render').length + 1;
    const nextArtifacts: VideoCutArtifact[] = [];

    selectedPlans.forEach((selectedPlan, index) => {
      const renderId = `${taskId}-render-${renderAttemptStart + index}`;
      const subtitleDocument = createDefaultSubtitleDocument({
        planId: selectedPlan.planId,
        taskId,
      });
      const renderRequest = {
        ...createDefaultRenderRequest({
          plan: selectedPlan,
          subtitleDocument,
        }),
        renderId,
      };
      const validation = validateRenderRequest(renderRequest, selectedPlan, subtitleDocument);
      if (!validation.valid) {
        throw mockBadRequestError({
          code: 'RENDER_REQUEST_INVALID',
          endpoint: mockTaskPath(taskId, '/render'),
          message: `Invalid render request: ${validation.errors.map((error) => error.code).join(', ')}`,
          taskId,
        });
      }

      renderAttemptPlans.set(renderId, clone(selectedPlan));
      nextArtifacts.push(...createRenderArtifacts(taskId, renderId));
    });

    const task = updateTask(taskId, {
      status: 'succeeded',
      progress: 100,
      currentStage: 'artifact',
    });
    pushEvent(taskId, 'render', 100, finalMessage);
    artifacts.set(taskId, [...(artifacts.get(taskId) ?? []), ...nextArtifacts]);
    persist();

    return task;
  }

  function updateTask(taskId: string, patch: Partial<VideoCutTask>): VideoCutTask {
    const task = tasks.get(taskId);
    if (!task) {
      throw mockTaskNotFoundError(taskId);
    }

    const next = {
      ...task,
      ...patch,
      updatedAt: nowIso(),
    };
    tasks.set(taskId, next);
    return clone(next);
  }

  return {
    async getHealth() {
      return { status: 'ok' };
    },

    async getCapabilities() {
      return clone(toCapabilityReport(settings));
    },

    async getDoctorReport() {
      return clone(toDoctorReport(settings));
    },

    async getDiagnosticBundle() {
      return clone(toDiagnosticBundle(settings));
    },

    async getDiagnosticSupportBundle(input: DiagnosticSupportBundleRequest) {
      const taskArtifacts = input.taskId ? artifacts.get(input.taskId) : undefined;
      return clone(toDiagnosticSupportBundle(settings, input, taskArtifacts));
    },

    async getAssetCatalog() {
      return clone(toAssetCatalog(settings));
    },

    async runProviderConformance(target: ProviderConformanceTarget) {
      return clone(toProviderConformanceReport(settings, target));
    },

    async getSettings() {
      return clone(settings);
    },

    async updateSettings(nextSettings: VideoCutSettingsSavePayload) {
      const validation = validateRuntimeSettings(nextSettings);
      if (validation.valid) {
        settings = toRedactedSettings(nextSettings);
        persist();
      }
      return validation;
    },

    async listTasks() {
      return Array.from(tasks.values())
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((task) => clone(task));
    },

    async createTask(input: CreateTaskInput) {
      taskSequence += 1;
      const taskId = createTaskId(taskSequence);
      const task: VideoCutTask = {
        taskId,
        title: input.title,
        type: input.type,
        status: 'draft',
        progress: 0,
        durationSeconds: input.type === 'single-speaker' ? 86 : 168,
        currentStage: 'draft',
        updatedAt: nowIso(),
      };
      tasks.set(taskId, task);
      persist();
      return clone(task);
    },

    async getTask(taskId: string) {
      const task = tasks.get(taskId);
      if (!task) {
        throw mockTaskNotFoundError(taskId);
      }

      return clone(task);
    },

    async deleteTask(taskId: string): Promise<DeleteTaskResult> {
      if (!tasks.has(taskId)) {
        throw mockTaskNotFoundError(taskId);
      }

      const artifactsDeleted = artifacts.get(taskId)?.length ?? 0;
      const eventsDeleted = events.get(taskId)?.length ?? 0;
      tasks.delete(taskId);
      plans.delete(taskId);
      artifacts.delete(taskId);
      events.delete(taskId);
      persist();

      return {
        taskId,
        deleted: true,
        artifactsDeleted,
        eventsDeleted,
      };
    },

    async attachTaskSource(taskId: string, input: AttachTaskSourceInput) {
      const task = tasks.get(taskId);
      if (!task) {
        throw mockTaskNotFoundError(taskId, mockTaskPath(taskId, '/source'));
      }

      const sourceName = sanitizeSourceFileName(input.sourceName);
      validateSourceMediaType(sourceName, input.contentType, {
        endpoint: mockTaskPath(taskId, '/source'),
        taskId,
      });
      const artifact: VideoCutArtifact = {
        artifactId: `${taskId}-source`,
        taskId,
        kind: 'source',
        path: `workspace/projects/default/tasks/${taskId}/source/${sourceName}`,
        sizeBytes: input.sizeBytes ?? 128_000_000,
        sha256: createSha(`${taskId}-source-${sourceName}`),
        createdAt: nowIso(),
      };
      artifacts.set(taskId, [artifact, ...(artifacts.get(taskId) ?? []).filter((item) => item.kind !== 'source')]);
      updateTask(taskId, {
        sourceName,
        status: 'sourceReady',
        progress: Math.max(task.progress, 5),
        currentStage: 'import',
      });
      pushEvent(taskId, 'import', 5, 'Source video attached.');
      persist();

      return clone(artifact);
    },

    async uploadTaskSourceFile(taskId: string, file: File) {
      const task = tasks.get(taskId);
      if (!task) {
        throw mockTaskNotFoundError(taskId, mockTaskPath(taskId, '/source/file'));
      }

      const sourceName = sanitizeSourceFileName(file.name);
      validateSourceMediaType(sourceName, file.type, {
        endpoint: mockTaskPath(taskId, '/source/file'),
        taskId,
      });
      const artifact: VideoCutArtifact = {
        artifactId: `${taskId}-source`,
        taskId,
        kind: 'source',
        path: `workspace/projects/default/tasks/${taskId}/source/${sourceName}`,
        sizeBytes: file.size,
        sha256: createSha(`${taskId}-source-${sourceName}-${file.size}`),
        createdAt: nowIso(),
      };
      artifacts.set(taskId, [artifact, ...(artifacts.get(taskId) ?? []).filter((item) => item.kind !== 'source')]);
      updateTask(taskId, {
        sourceName,
        status: 'sourceReady',
        progress: Math.max(task.progress, 5),
        currentStage: 'import',
      });
      pushEvent(taskId, 'import', 5, 'Source video uploaded to workspace.');
      persist();

      return clone(artifact);
    },

    async analyzeTask(taskId: string) {
      const existingTask = tasks.get(taskId);
      if (!existingTask) {
        throw mockTaskNotFoundError(taskId, mockTaskPath(taskId, '/analyze'));
      }
      if (!(artifacts.get(taskId) ?? []).some((item) => item.kind === 'source')) {
        throw mockBadRequestError({
          code: 'SOURCE_FILE_REQUIRED',
          endpoint: mockTaskPath(taskId, '/analyze'),
          message: 'A source file must be uploaded before analysis.',
          taskId,
        });
      }
      const plan = createDefaultVideoSplitPlan({
        sourceName: existingTask.sourceName ?? 'source.mp4',
        taskId,
        type: existingTask.type,
      });
      const validation = validateVideoSplitPlan(plan);
      if (!validation.valid) {
        throw mockBadRequestError({
          code: 'PLAN_INVALID',
          endpoint: mockTaskPath(taskId, '/analyze'),
          message: `Invalid split plan: ${validation.errors.map((error) => error.code).join(', ')}`,
          taskId,
        });
      }
      const planMetadata = jsonArtifactMetadata(plan);
      plans.set(taskId, plan);
      const task = updateTask(taskId, {
        status: 'planReady',
        progress: 72,
        currentStage: 'plan',
      });
      pushEvent(taskId, 'analyze', 72, 'Transcript, semantic analysis, and split plan generated.');
      artifacts.set(taskId, [
        ...(artifacts.get(taskId) ?? []).filter(
          (item) =>
            item.artifactId !== `${taskId}-media-info` &&
            item.artifactId !== `${taskId}-audio-extract` &&
            item.artifactId !== `${taskId}-audio-source` &&
            item.artifactId !== `${taskId}-silence-ranges` &&
            item.artifactId !== `${taskId}-vad-ranges` &&
            item.artifactId !== `${taskId}-transcript` &&
            item.artifactId !== `${taskId}-semantic-analysis` &&
            item.artifactId !== `${taskId}-plan`,
        ),
        {
          artifactId: `${taskId}-media-info`,
          taskId,
          kind: 'analysis',
          path: `workspace/projects/default/tasks/${taskId}/analysis/media-info.json`,
          sizeBytes: 640,
          sha256: createSha(`${taskId}-media-info`),
          createdAt: nowIso(),
        },
        {
          artifactId: `${taskId}-audio-extract`,
          taskId,
          kind: 'analysis',
          path: `workspace/projects/default/tasks/${taskId}/analysis/audio-extract.json`,
          sizeBytes: 512,
          sha256: createSha(`${taskId}-audio-extract`),
          createdAt: nowIso(),
        },
        {
          artifactId: `${taskId}-audio-source`,
          taskId,
          kind: 'audio',
          path: `workspace/projects/default/tasks/${taskId}/audio/source.wav`,
          sizeBytes: 2_752_000,
          sha256: createSha(`${taskId}-audio-source`),
          createdAt: nowIso(),
        },
        {
          artifactId: `${taskId}-silence-ranges`,
          taskId,
          kind: 'analysis',
          path: `workspace/projects/default/tasks/${taskId}/analysis/silence-ranges.json`,
          sizeBytes: 768,
          sha256: createSha(`${taskId}-silence-ranges`),
          createdAt: nowIso(),
        },
        {
          artifactId: `${taskId}-vad-ranges`,
          taskId,
          kind: 'analysis',
          path: `workspace/projects/default/tasks/${taskId}/analysis/vad-ranges.json`,
          sizeBytes: 768,
          sha256: createSha(`${taskId}-vad-ranges`),
          createdAt: nowIso(),
        },
        {
          artifactId: `${taskId}-transcript`,
          taskId,
          kind: 'analysis',
          path: `workspace/projects/default/tasks/${taskId}/analysis/transcript.json`,
          sizeBytes: 1_024,
          sha256: createSha(`${taskId}-transcript`),
          createdAt: nowIso(),
        },
        {
          artifactId: `${taskId}-semantic-analysis`,
          taskId,
          kind: 'analysis',
          path: `workspace/projects/default/tasks/${taskId}/analysis/semantic-analysis.json`,
          sizeBytes: 1_536,
          sha256: createSha(`${taskId}-semantic-analysis`),
          createdAt: nowIso(),
        },
        {
          artifactId: `${taskId}-plan`,
          taskId,
          kind: 'plan',
          path: `workspace/projects/default/tasks/${taskId}/plan/plan.json`,
          sizeBytes: planMetadata.sizeBytes,
          sha256: planMetadata.sha256,
          createdAt: nowIso(),
        },
      ]);
      persist();
      return task;
    },

    async getTaskPlan(taskId: string) {
      const plan = plans.get(taskId);
      if (!plan) {
        throw mockPlanNotFoundError(taskId);
      }

      return clone(plan);
    },

    async updateTaskPlan(taskId: string, plan: VideoSplitPlan) {
      if (plan.taskId !== taskId) {
        throw mockBadRequestError({
          code: 'PLAN_TASK_ID_MISMATCH',
          endpoint: mockTaskPath(taskId, '/plan'),
          message: `Task plan id mismatch: ${taskId}`,
          taskId,
        });
      }
      const validation = validateVideoSplitPlan(plan);
      if (!validation.valid) {
        throw mockBadRequestError({
          code: 'PLAN_INVALID',
          endpoint: mockTaskPath(taskId, '/plan'),
          message: `Invalid split plan: ${validation.errors.map((error) => error.code).join(', ')}`,
          taskId,
        });
      }
      const planMetadata = jsonArtifactMetadata(plan);
      plans.set(taskId, clone(plan));
      artifacts.set(taskId, [
        ...(artifacts.get(taskId) ?? []).filter((artifact) => artifact.artifactId !== `${taskId}-plan`),
        {
          artifactId: `${taskId}-plan`,
          taskId,
          kind: 'plan',
          path: `workspace/projects/default/tasks/${taskId}/plan/plan.json`,
          sizeBytes: planMetadata.sizeBytes,
          sha256: planMetadata.sha256,
          createdAt: nowIso(),
        },
      ]);
      persist();
      return clone(plan);
    },

    async updateTaskTranscript(taskId: string, input: ManualTranscriptInput) {
      const existingTask = tasks.get(taskId);
      if (!existingTask) {
        throw mockTaskNotFoundError(taskId, mockTaskPath(taskId, '/transcript'));
      }
      const taskArtifacts = artifacts.get(taskId) ?? [];
      const audioArtifact = taskArtifacts.find((artifact) => artifact.kind === 'audio');
      const transcript = createManualTranscriptDocument({
        input,
        taskId,
        audioArtifact,
        languageFallback: settings.speechToText.languageHint,
      });
      transcriptDocuments.set(taskId, clone(transcript));
      artifacts.set(taskId, [
        ...taskArtifacts.filter((artifact) => artifact.artifactId !== `${taskId}-transcript`),
        {
          artifactId: `${taskId}-transcript`,
          taskId,
          kind: 'analysis',
          path: `workspace/projects/default/tasks/${taskId}/analysis/transcript.json`,
          sizeBytes: JSON.stringify(transcript).length,
          sha256: createSha(`${taskId}-transcript-manual`),
          createdAt: nowIso(),
        },
      ]);
      updateTask(taskId, {
        currentStage: 'transcript',
        progress: Math.max(existingTask.progress, 74),
        status: 'planReady',
      });
      pushEvent(taskId, 'transcript', 74, 'Manual transcript imported.');
      persist();
      return clone(transcript);
    },

    async importTaskSubtitles(taskId: string, input: SubtitleImportInput) {
      const existingTask = tasks.get(taskId);
      if (!existingTask) {
        throw mockTaskNotFoundError(taskId, mockTaskPath(taskId, '/subtitles/import'));
      }
      const taskArtifacts = artifacts.get(taskId) ?? [];
      const audioArtifact = taskArtifacts.find((artifact) => artifact.kind === 'audio');
      const transcript = createSubtitleTranscriptDocument({
        input,
        taskId,
        audioArtifact,
        languageFallback: settings.speechToText.languageHint,
      });
      transcriptDocuments.set(taskId, clone(transcript));
      artifacts.set(taskId, [
        ...taskArtifacts.filter((artifact) => artifact.artifactId !== `${taskId}-transcript`),
        {
          artifactId: `${taskId}-transcript`,
          taskId,
          kind: 'analysis',
          path: `workspace/projects/default/tasks/${taskId}/analysis/transcript.json`,
          sizeBytes: JSON.stringify(transcript).length,
          sha256: createSha(`${taskId}-subtitle-import-${input.format}`),
          createdAt: nowIso(),
        },
      ]);
      updateTask(taskId, {
        currentStage: 'subtitle',
        progress: Math.max(existingTask.progress, 74),
        status: 'planReady',
      });
      pushEvent(taskId, 'subtitle', 74, `Subtitle ${normalizeSubtitleFormat(input.format)} imported.`);
      persist();
      return clone(transcript);
    },

    async exportTaskSubtitles(taskId: string, format: SubtitleFormat): Promise<SubtitleExportOutput> {
      if (!tasks.has(taskId)) {
        throw mockTaskNotFoundError(taskId, mockTaskPath(taskId, '/subtitles/export'));
      }
      const normalizedFormat = normalizeSubtitleFormat(format);
      const transcript = transcriptDocuments.get(taskId);
      if (!transcript) {
        throw mockBadRequestError({
          code: 'TRANSCRIPT_REQUIRED',
          endpoint: mockTaskPath(taskId, '/subtitles/export'),
          message: `Transcript or imported subtitle must be available before subtitle export: ${taskId}`,
          taskId,
        });
      }
      const content = exportTranscriptAsSubtitle(transcript, normalizedFormat);
      const artifactId = `${taskId}-subtitle-export-${normalizedFormat}`;
      const path = `workspace/projects/default/tasks/${taskId}/analysis/subtitles-export.${normalizedFormat}`;
      subtitleArtifactText.set(artifactId, content);
      artifacts.set(taskId, [
        ...(artifacts.get(taskId) ?? []).filter((artifact) => artifact.artifactId !== artifactId),
        {
          artifactId,
          taskId,
          kind: 'subtitle',
          path,
          sizeBytes: content.length,
          sha256: createSha(artifactId),
          createdAt: nowIso(),
        },
      ]);
      pushEvent(taskId, 'subtitle', 76, `Subtitle ${normalizedFormat} exported.`);
      persist();
      return {
        artifactId,
        content,
        format: normalizedFormat,
        path,
      };
    },

    async renderTask(taskId: string) {
      const plan = plans.get(taskId);
      if (!plan) {
        throw mockPlanNotFoundError(taskId, mockTaskPath(taskId, '/render'));
      }
      return renderSelectedPlans(taskId, [plan], 'Rendered MP4, subtitles, cover, and render log.');
    },

    async renderTaskBatch(taskId: string) {
      const plan = plans.get(taskId);
      if (!plan) {
        throw mockPlanNotFoundError(taskId, mockTaskPath(taskId, '/render/batch'));
      }

      const selectedPlans = plan.segments.map((_, index) => planWithOnlySegment(plan, index));
      return renderSelectedPlans(
        taskId,
        selectedPlans,
        `Batch rendered ${selectedPlans.length} segments into MP4, subtitles, covers, manifests, and logs.`,
      );
    },

    async cancelTask(taskId: string) {
      const task = updateTask(taskId, {
        status: 'cancelled',
        currentStage: 'cancelled',
      });
      pushEvent(taskId, 'cancelled', task.progress, 'Task cancelled by user.');
      persist();
      return task;
    },

    async getTaskEvents(taskId: string) {
      return clone(events.get(taskId) ?? []);
    },

    async getTaskArtifacts(taskId: string) {
      return clone(artifacts.get(taskId) ?? []);
    },

    async getArtifactDownload(taskId: string, artifactId: string): Promise<ArtifactDownloadDescriptor> {
      const artifact = (artifacts.get(taskId) ?? []).find((item) => item.artifactId === artifactId);
      if (!artifact) {
        throw mockArtifactNotFoundError(taskId, artifactId, '/download');
      }

      return {
        artifactId: artifact.artifactId,
        taskId: artifact.taskId,
        path: artifact.path,
        sizeBytes: artifact.sizeBytes,
        sha256: artifact.sha256,
        contentType: inferArtifactContentType(artifact),
        downloadMode: 'host-content-endpoint',
        url: `/api/video-cut/v1/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(artifactId)}/content`,
      };
    },

    async getArtifactContent(taskId: string, artifactId: string) {
      const artifact = (artifacts.get(taskId) ?? []).find((item) => item.artifactId === artifactId);
      if (!artifact) {
        throw mockArtifactNotFoundError(taskId, artifactId, '/content');
      }

      return new Blob([`mock artifact content: ${artifact.artifactId}`], {
        type: inferArtifactContentType(artifact),
      });
    },

    async getArtifactText(taskId: string, artifactId: string) {
      const artifact = (artifacts.get(taskId) ?? []).find((item) => item.artifactId === artifactId);
      if (!artifact) {
        throw mockArtifactNotFoundError(taskId, artifactId, '/content');
      }

      if (artifact.kind === 'render-manifest') {
        const plan = plans.get(taskId);
        if (!plan) {
          throw mockPlanNotFoundError(taskId, mockArtifactPath(taskId, artifactId, '/content'));
        }
        const renderPlan = artifact.renderId ? renderAttemptPlans.get(artifact.renderId) : undefined;

        return createRenderAttemptManifestText({
          artifact,
          plan: renderPlan ?? plan,
          taskArtifacts: artifacts.get(taskId) ?? [],
        });
      }

      if (artifact.kind === 'log') {
        return [
          'schemaId=video-cut.render-log.schema.v1',
          `taskId=${taskId}`,
          `artifactId=${artifact.artifactId}`,
          'status=ok',
        ].join('\n');
      }

      if (artifact.path.endsWith('.srt') || artifact.path.endsWith('.vtt')) {
        const content = subtitleArtifactText.get(artifact.artifactId);
        if (!content) {
          throw mockArtifactNotFoundError(taskId, artifactId, '/content');
        }
        return content;
      }

      if (artifact.kind === 'subtitle') {
        return '[Script Info]\nScriptType: v4.00+\n';
      }

      if (artifact.path.endsWith('.json')) {
        return JSON.stringify(
          {
            artifactId: artifact.artifactId,
            kind: artifact.kind,
            schemaId: 'video-cut.mock-artifact-content.schema.v1',
            taskId,
          },
          null,
          2,
        );
      }

      throw mockBadRequestError({
        code: 'ARTIFACT_TEXT_UNSUPPORTED',
        endpoint: mockArtifactPath(taskId, artifactId, '/content'),
        message: `Artifact is not a text artifact: ${artifactId}`,
        taskId,
      });
    },
  };
}
