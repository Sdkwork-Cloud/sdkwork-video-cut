import type { DeploymentMode } from './videoCutTypes';

export type SettingsSectionId =
  | 'overview'
  | 'ai'
  | 'speechToText'
  | 'subtitle'
  | 'mediaTools'
  | 'outputPresets'
  | 'assets'
  | 'storage'
  | 'runtime'
  | 'security'
  | 'diagnostics'
  | 'about';

export type SettingsFieldKind =
  | 'boolean'
  | 'color'
  | 'enum'
  | 'number'
  | 'path'
  | 'readonly'
  | 'secret'
  | 'text'
  | 'url';

export type SettingsImpactScope = 'none' | 'new-tasks' | 'current-task' | 'runtime' | 'diagnostics';

export interface SettingsFieldDefinition {
  key: string;
  label: string;
  kind: SettingsFieldKind;
  secret: boolean;
  requiresRestart: boolean;
  affects: SettingsImpactScope;
  deploymentModes: DeploymentMode[];
}

export interface SettingsSectionDefinition {
  id: SettingsSectionId;
  label: string;
  description: string;
  fields: SettingsFieldDefinition[];
}

const allDeploymentModes: DeploymentMode[] = [
  'desktop-local',
  'desktop-private',
  'web-private',
  'server-private',
  'container-private',
  'kubernetes-private',
];

const localEditableModes: DeploymentMode[] = ['desktop-local', 'desktop-private'];

function field(
  key: string,
  label: string,
  kind: SettingsFieldKind,
  options: Partial<Omit<SettingsFieldDefinition, 'key' | 'label' | 'kind'>> = {},
): SettingsFieldDefinition {
  return {
    key,
    label,
    kind,
    secret: options.secret ?? kind === 'secret',
    requiresRestart: options.requiresRestart ?? false,
    affects: options.affects ?? 'new-tasks',
    deploymentModes: options.deploymentModes ?? allDeploymentModes,
  };
}

export const settingsSections: SettingsSectionDefinition[] = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Runtime readiness and blocking configuration issues.',
    fields: [
      field('runtime.deploymentMode', 'Runtime mode', 'readonly', { affects: 'runtime' }),
      field('capability.ai', 'LLM readiness', 'readonly', { affects: 'diagnostics' }),
      field('capability.speechToText', 'STT readiness', 'readonly', { affects: 'diagnostics' }),
    ],
  },
  {
    id: 'ai',
    label: 'AI Providers',
    description: 'OpenAI-compatible LLM endpoint and structured output settings.',
    fields: [
      field('ai.enabled', 'Enable AI provider', 'boolean'),
      field('ai.baseUrl', 'Base URL', 'url'),
      field('ai.apiKey', 'API key', 'secret'),
      field('ai.apiKeyConfigured', 'API key status', 'readonly', { affects: 'diagnostics' }),
      field('ai.chatModel', 'Chat model', 'text'),
      field('ai.structuredOutputMode', 'Structured output', 'enum'),
      field('ai.temperature', 'Temperature', 'number'),
      field('ai.timeoutSeconds', 'Timeout seconds', 'number'),
      field('ai.retryCount', 'Retry count', 'number'),
    ],
  },
  {
    id: 'speechToText',
    label: 'Speech To Text',
    description: 'OpenAI-compatible transcription endpoint and transcript capabilities.',
    fields: [
      field('speechToText.enabled', 'Enable STT provider', 'boolean'),
      field('speechToText.providerProfile', 'Provider profile', 'enum'),
      field('speechToText.reuseAiProviderConnection', 'Reuse AI provider', 'boolean'),
      field('speechToText.baseUrl', 'Base URL', 'url'),
      field('speechToText.apiKey', 'API key', 'secret'),
      field('speechToText.apiKeyConfigured', 'API key status', 'readonly', { affects: 'diagnostics' }),
      field('speechToText.transcriptionModel', 'Transcription model', 'text'),
      field('speechToText.resourceId', 'Resource ID', 'text'),
      field('speechToText.languageHint', 'Language', 'text'),
      field('speechToText.timestampGranularity', 'Timestamp granularity', 'enum'),
      field('speechToText.diarizationEnabled', 'Diarization', 'boolean'),
      field('speechToText.localWhisperFallbackEnabled', 'Local whisper fallback', 'boolean'),
    ],
  },
  {
    id: 'subtitle',
    label: 'Subtitle And Caption',
    description: 'Subtitle style, highlight color, positioning, and export defaults.',
    fields: [
      field('subtitle.fontFamily', 'Font', 'text'),
      field('subtitle.fontFallback', 'Fallback font', 'text'),
      field('subtitle.highlightColor', 'Highlight', 'color'),
      field('subtitle.fontSize', 'Font size', 'number'),
      field('subtitle.shadowOpacity', 'Shadow opacity', 'number'),
      field('subtitle.maxLines', 'Max lines', 'number'),
      field('subtitle.position', 'Position', 'enum'),
    ],
  },
  {
    id: 'mediaTools',
    label: 'Media Tools',
    description: 'FFmpeg, ffprobe, VAD, ONNX Runtime, and media workload limits.',
    fields: [
      field('mediaTools.ffmpegPath', 'FFmpeg path', 'path', { deploymentModes: localEditableModes }),
      field('mediaTools.ffprobePath', 'ffprobe path', 'path', { deploymentModes: localEditableModes }),
      field('mediaTools.sileroVadModelPath', 'Silero VAD model', 'path', { deploymentModes: localEditableModes }),
      field('mediaTools.workerConcurrency', 'Worker concurrency', 'number', { affects: 'runtime' }),
      field('mediaTools.maxUploadBytes', 'Max upload bytes', 'number', { affects: 'runtime' }),
      field('mediaTools.onnxRuntimeEnabled', 'ONNX Runtime', 'boolean'),
    ],
  },
  {
    id: 'outputPresets',
    label: 'Output Presets',
    description: 'Publishing preset for 9:16 short video outputs.',
    fields: [
      field('output.resolution', 'Resolution', 'readonly'),
      field('output.aspectRatio', 'Aspect ratio', 'readonly'),
      field('output.frameRate', 'Frame rate', 'readonly'),
      field('output.format', 'Format', 'readonly'),
      field('output.bgmVolume', 'BGM volume', 'readonly'),
      field('output.codec', 'Codec', 'readonly'),
    ],
  },
  {
    id: 'assets',
    label: 'Assets',
    description: 'Font, BGM, SFX, cover template, and model asset locations.',
    fields: [
      field('assets.fonts', 'Font assets', 'path', { deploymentModes: localEditableModes }),
      field('assets.bgm', 'BGM assets', 'path', { deploymentModes: localEditableModes }),
      field('assets.sfx', 'SFX assets', 'path', { deploymentModes: localEditableModes }),
      field('assets.coverTemplates', 'Cover templates', 'path', { deploymentModes: localEditableModes }),
    ],
  },
  {
    id: 'storage',
    label: 'Storage',
    description: 'Workspace, artifacts, temporary data, and retention policy.',
    fields: [
      field('storage.workspaceRoot', 'Workspace root', 'path', { affects: 'runtime', deploymentModes: localEditableModes }),
      field('storage.artifactRoot', 'Artifact root', 'path', { affects: 'runtime', deploymentModes: localEditableModes }),
      field('storage.tempRoot', 'Temp root', 'path', { affects: 'runtime', deploymentModes: localEditableModes }),
      field('storage.retentionDays', 'Retention days', 'number', { affects: 'runtime' }),
    ],
  },
  {
    id: 'runtime',
    label: 'Runtime',
    description: 'Deployment mode, listener, public URL, and auth policy.',
    fields: [
      field('runtime.deploymentMode', 'Deployment mode', 'readonly', { affects: 'runtime', requiresRestart: true }),
      field('runtime.bindHost', 'Bind host', 'text', { affects: 'runtime', requiresRestart: true }),
      field('runtime.port', 'Port', 'number', { affects: 'runtime', requiresRestart: true }),
      field('runtime.publicBaseUrl', 'Public base URL', 'url', { affects: 'runtime' }),
      field('runtime.authMode', 'Auth mode', 'enum', { affects: 'runtime', requiresRestart: true }),
    ],
  },
  {
    id: 'security',
    label: 'Security',
    description: 'Secret source, redaction, and diagnostics export scope.',
    fields: [
      field('security.secretProvider', 'Secret provider', 'enum', { affects: 'runtime', requiresRestart: true }),
      field('security.corsAllowedOrigins', 'CORS origins', 'text', { affects: 'runtime', requiresRestart: true }),
      field('security.redactionEnabled', 'Enable redaction', 'boolean', { affects: 'diagnostics' }),
      field('security.diagnosticsIncludeSourceMedia', 'Include source media in diagnostics', 'boolean', { affects: 'diagnostics' }),
      field('security.diagnosticsIncludeTranscript', 'Include transcript in diagnostics', 'boolean', { affects: 'diagnostics' }),
    ],
  },
  {
    id: 'diagnostics',
    label: 'Diagnostics',
    description: 'Doctor, capability evidence, and redacted diagnostics bundle actions.',
    fields: [field('diagnostics.runDoctor', 'Run doctor', 'readonly', { affects: 'diagnostics' })],
  },
  {
    id: 'about',
    label: 'About',
    description: 'Application architecture and provider contract information.',
    fields: [field('about.version', 'Version', 'readonly', { affects: 'none' })],
  },
];

export function getSettingsSection(sectionId: SettingsSectionId): SettingsSectionDefinition {
  const section = settingsSections.find((item) => item.id === sectionId);
  if (!section) {
    throw new Error(`Unknown settings section: ${sectionId}`);
  }

  return section;
}
