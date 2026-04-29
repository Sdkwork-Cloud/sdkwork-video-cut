import { AlertTriangle, CheckCircle2, FileDown, SlidersHorizontal } from 'lucide-react';

import { DiagnosticBundleDownloadCard } from '../DiagnosticBundleDownloadCard';
import { DiagnosticSupportBundleCard } from '../DiagnosticSupportBundleCard';
import type { DiagnosticBundleDownloadDescriptor } from '../../domain/diagnosticBundleExport';
import type { SettingsSectionId } from '../../domain/settingsSchema';
import type {
  AssetCatalog,
  AssetCatalogSlot,
  DeploymentDoctorReport,
  DiagnosticBundle,
  DiagnosticSupportBundleRequest,
  ProviderConformanceReport,
  ProviderConformanceTarget,
  VideoCutSettings,
  VideoCutTask,
} from '../../domain/videoCutTypes';
import { CheckboxField, NumberField, ReadOnlyField, SelectField, TextField } from './SettingsFieldControls';

type ErrorLookup = (field: string) => string | undefined;

type PatchHandler<T> = (patch: Partial<T>) => void;

function fieldId(sectionId: SettingsSectionId, label: string): string {
  return `settings-${sectionId}-${label}`.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
}

export function AiProviderSettingsPanel({
  aiApiKey,
  draft,
  errorFor,
  providerConformanceReport,
  onRunProviderConformance,
  setAiApiKey,
  updateAi,
}: {
  aiApiKey: string;
  draft: VideoCutSettings;
  errorFor: ErrorLookup;
  providerConformanceReport?: ProviderConformanceReport;
  onRunProviderConformance: (target: ProviderConformanceTarget) => Promise<ProviderConformanceReport | undefined>;
  setAiApiKey: (value: string) => void;
  updateAi: PatchHandler<VideoCutSettings['ai']>;
}) {
  return (
    <div className="field-grid">
      <CheckboxField label="Enable AI provider" checked={draft.ai.enabled} onChange={(enabled) => updateAi({ enabled })} />
      <TextField id={fieldId('ai', 'Base URL')} label="Base URL" value={draft.ai.baseUrl} onChange={(baseUrl) => updateAi({ baseUrl })} error={errorFor('ai.baseUrl')} />
      <TextField id={fieldId('ai', 'Chat model')} label="Chat model" value={draft.ai.chatModel} onChange={(chatModel) => updateAi({ chatModel })} error={errorFor('ai.chatModel')} />
      <label>
        API key
        <input value={aiApiKey} type="password" autoComplete="off" onChange={(event) => setAiApiKey(event.target.value)} />
      </label>
      <ReadOnlyField id={fieldId('ai', 'API key status')} label="API key status" value={draft.ai.apiKeyConfigured ? 'Configured' : 'Not configured'} />
      <SelectField
        id={fieldId('ai', 'Structured output')}
        label="Structured output"
        value={draft.ai.structuredOutputMode}
        options={['json-schema', 'json-object-fallback']}
        onChange={(structuredOutputMode) => updateAi({ structuredOutputMode })}
      />
      <NumberField id={fieldId('ai', 'Temperature')} label="Temperature" value={draft.ai.temperature} min={0} max={2} step={0.1} onChange={(temperature) => updateAi({ temperature })} />
      <NumberField id={fieldId('ai', 'Timeout seconds')} label="Timeout seconds" value={draft.ai.timeoutSeconds} onChange={(timeoutSeconds) => updateAi({ timeoutSeconds })} />
      <NumberField id={fieldId('ai', 'Retry count')} label="Retry count" value={draft.ai.retryCount} onChange={(retryCount) => updateAi({ retryCount })} />
      <ProviderConformanceActions
        buttonLabel="Test structured output"
        report={providerConformanceReport}
        target="ai"
        onRunProviderConformance={onRunProviderConformance}
      />
    </div>
  );
}

export function SpeechToTextSettingsPanel({
  draft,
  errorFor,
  providerConformanceReport,
  onRunProviderConformance,
  setSpeechApiKey,
  speechApiKey,
  updateSpeechToText,
}: {
  draft: VideoCutSettings;
  errorFor: ErrorLookup;
  providerConformanceReport?: ProviderConformanceReport;
  onRunProviderConformance: (target: ProviderConformanceTarget) => Promise<ProviderConformanceReport | undefined>;
  setSpeechApiKey: (value: string) => void;
  speechApiKey: string;
  updateSpeechToText: PatchHandler<VideoCutSettings['speechToText']>;
}) {
  return (
    <div className="field-grid">
      <CheckboxField label="Enable STT provider" checked={draft.speechToText.enabled} onChange={(enabled) => updateSpeechToText({ enabled })} />
      <SelectField
        id={fieldId('speechToText', 'Provider profile')}
        label="Provider profile"
        value={draft.speechToText.providerProfile}
        options={['openai-audio-transcriptions', 'volcengine-bigasr-flash', 'aliyun-qwen-asr']}
        onChange={(providerProfile) => updateSpeechToText({ providerProfile })}
      />
      <CheckboxField
        label="Reuse AI provider"
        checked={draft.speechToText.reuseAiProviderConnection}
        onChange={(reuseAiProviderConnection) => updateSpeechToText({ reuseAiProviderConnection })}
      />
      <TextField
        id={fieldId('speechToText', 'Base URL')}
        label="Base URL"
        value={draft.speechToText.baseUrl}
        onChange={(baseUrl) => updateSpeechToText({ baseUrl })}
        error={errorFor('speechToText.baseUrl')}
      />
      <label>
        API key
        <input value={speechApiKey} type="password" autoComplete="off" onChange={(event) => setSpeechApiKey(event.target.value)} />
      </label>
      <ReadOnlyField
        id={fieldId('speechToText', 'API key status')}
        label="API key status"
        value={draft.speechToText.apiKeyConfigured ? 'Configured' : 'Not configured'}
      />
      <TextField
        id={fieldId('speechToText', 'Transcription model')}
        label="Transcription model"
        value={draft.speechToText.transcriptionModel}
        onChange={(transcriptionModel) => updateSpeechToText({ transcriptionModel })}
        error={errorFor('speechToText.transcriptionModel')}
      />
      <TextField
        id={fieldId('speechToText', 'Resource ID')}
        label="Resource ID"
        value={draft.speechToText.resourceId}
        onChange={(resourceId) => updateSpeechToText({ resourceId })}
        error={errorFor('speechToText.resourceId')}
      />
      <TextField
        id={fieldId('speechToText', 'Language')}
        label="Language"
        value={draft.speechToText.languageHint}
        onChange={(languageHint) => updateSpeechToText({ languageHint })}
      />
      <SelectField
        id={fieldId('speechToText', 'Timestamp granularity')}
        label="Timestamp granularity"
        value={draft.speechToText.timestampGranularity}
        options={['segment', 'word']}
        onChange={(timestampGranularity) => updateSpeechToText({ timestampGranularity })}
      />
      <CheckboxField label="Diarization" checked={draft.speechToText.diarizationEnabled} onChange={(diarizationEnabled) => updateSpeechToText({ diarizationEnabled })} />
      <CheckboxField
        label="Local whisper fallback"
        checked={draft.speechToText.localWhisperFallbackEnabled}
        onChange={(localWhisperFallbackEnabled) => updateSpeechToText({ localWhisperFallbackEnabled })}
      />
      <ProviderConformanceActions
        buttonLabel="Test transcription"
        report={providerConformanceReport}
        target="speechToText"
        onRunProviderConformance={onRunProviderConformance}
      />
    </div>
  );
}

function ProviderConformanceActions({
  buttonLabel,
  report,
  target,
  onRunProviderConformance,
}: {
  buttonLabel: string;
  report?: ProviderConformanceReport;
  target: ProviderConformanceTarget;
  onRunProviderConformance: (target: ProviderConformanceTarget) => Promise<ProviderConformanceReport | undefined>;
}) {
  return (
    <div className="provider-conformance-panel">
      <button type="button" className="secondary-button" onClick={() => void onRunProviderConformance(target)}>
        <SlidersHorizontal size={18} aria-hidden="true" />
        {buttonLabel}
      </button>
      {report && <ProviderConformanceReportView report={report} />}
    </div>
  );
}

function ProviderConformanceReportView({ report }: { report: ProviderConformanceReport }) {
  return (
    <div className="settings-doctor-report">
      <div className="doctor-summary">
        <span className={`status-badge status-badge--${report.status === 'ok' ? 'ok' : 'warn'}`}>
          {report.status}
        </span>
        <span>{report.reportVersion}</span>
        <span>{report.providerId}</span>
      </div>
      {report.checks.map((check) => {
        const Icon = check.status === 'ok' ? CheckCircle2 : AlertTriangle;

        return (
          <article className="diagnostic-row diagnostic-row--doctor" key={check.checkId}>
            <Icon size={18} aria-hidden="true" />
            <strong>{check.checkId}</strong>
            <span>{check.label}</span>
            {check.actionHint && <small>{check.actionHint}</small>}
          </article>
        );
      })}
    </div>
  );
}

export function SubtitleSettingsPanel({
  draft,
  updateSubtitle,
}: {
  draft: VideoCutSettings;
  updateSubtitle: PatchHandler<VideoCutSettings['subtitle']>;
}) {
  return (
    <div className="field-grid">
      <TextField id={fieldId('subtitle', 'Font')} label="Font" value={draft.subtitle.fontFamily} onChange={(fontFamily) => updateSubtitle({ fontFamily })} />
      <TextField id={fieldId('subtitle', 'Fallback font')} label="Fallback font" value={draft.subtitle.fontFallback} onChange={(fontFallback) => updateSubtitle({ fontFallback })} />
      <TextField id={fieldId('subtitle', 'Highlight')} label="Highlight" value={draft.subtitle.highlightColor} type="color" onChange={(highlightColor) => updateSubtitle({ highlightColor })} />
      <NumberField id={fieldId('subtitle', 'Font size')} label="Font size" value={draft.subtitle.fontSize} onChange={(fontSize) => updateSubtitle({ fontSize })} />
      <NumberField
        id={fieldId('subtitle', 'Shadow opacity')}
        label="Shadow opacity"
        value={Math.round(draft.subtitle.shadowOpacity * 100)}
        onChange={(shadowOpacity) => updateSubtitle({ shadowOpacity: shadowOpacity / 100 })}
      />
      <NumberField id={fieldId('subtitle', 'Max lines')} label="Max lines" value={draft.subtitle.maxLines} onChange={(maxLines) => updateSubtitle({ maxLines })} />
      <SelectField
        id={fieldId('subtitle', 'Position')}
        label="Position"
        value={draft.subtitle.position}
        options={['bottom-safe', 'middle', 'top']}
        onChange={(position) => updateSubtitle({ position })}
      />
    </div>
  );
}

export function MediaToolsSettingsPanel({
  draft,
  errorFor,
  updateMediaTools,
}: {
  draft: VideoCutSettings;
  errorFor: ErrorLookup;
  updateMediaTools: PatchHandler<VideoCutSettings['mediaTools']>;
}) {
  return (
    <div className="field-grid">
      <TextField id={fieldId('mediaTools', 'FFmpeg path')} label="FFmpeg path" value={draft.mediaTools.ffmpegPath} onChange={(ffmpegPath) => updateMediaTools({ ffmpegPath })} />
      <TextField id={fieldId('mediaTools', 'ffprobe path')} label="ffprobe path" value={draft.mediaTools.ffprobePath} onChange={(ffprobePath) => updateMediaTools({ ffprobePath })} />
      <TextField
        id={fieldId('mediaTools', 'Silero VAD model')}
        label="Silero VAD model"
        value={draft.mediaTools.sileroVadModelPath}
        onChange={(sileroVadModelPath) => updateMediaTools({ sileroVadModelPath })}
      />
      <NumberField
        id={fieldId('mediaTools', 'Worker concurrency')}
        label="Worker concurrency"
        value={draft.mediaTools.workerConcurrency}
        onChange={(workerConcurrency) => updateMediaTools({ workerConcurrency })}
        error={errorFor('mediaTools.workerConcurrency')}
      />
      <NumberField id={fieldId('mediaTools', 'Max upload bytes')} label="Max upload bytes" value={draft.mediaTools.maxUploadBytes} onChange={(maxUploadBytes) => updateMediaTools({ maxUploadBytes })} />
      <CheckboxField label="ONNX Runtime" checked={draft.mediaTools.onnxRuntimeEnabled} onChange={(onnxRuntimeEnabled) => updateMediaTools({ onnxRuntimeEnabled })} />
    </div>
  );
}

export function OutputPresetsPanel() {
  return (
    <div className="field-grid">
      <ReadOnlyField id={fieldId('outputPresets', 'Resolution')} label="Resolution" value="1080x1920" />
      <ReadOnlyField id={fieldId('outputPresets', 'Aspect ratio')} label="Aspect ratio" value="9:16" />
      <ReadOnlyField id={fieldId('outputPresets', 'Frame rate')} label="Frame rate" value="30fps" />
      <ReadOnlyField id={fieldId('outputPresets', 'Format')} label="Format" value="MP4" />
      <ReadOnlyField id={fieldId('outputPresets', 'BGM volume')} label="BGM volume" value="20%" />
      <ReadOnlyField id={fieldId('outputPresets', 'Codec')} label="Codec" value="libx264/aac" />
    </div>
  );
}

export function AssetsSettingsPanel({
  assetCatalog,
  draft,
  updateAssets,
}: {
  assetCatalog?: AssetCatalog;
  draft: VideoCutSettings;
  updateAssets: PatchHandler<VideoCutSettings['assets']>;
}) {
  return (
    <>
      <div className="field-grid">
        <TextField id={fieldId('assets', 'Font assets')} label="Font assets" value={draft.assets.fonts} onChange={(fonts) => updateAssets({ fonts })} />
        <TextField id={fieldId('assets', 'BGM assets')} label="BGM assets" value={draft.assets.bgm} onChange={(bgm) => updateAssets({ bgm })} />
        <TextField id={fieldId('assets', 'SFX assets')} label="SFX assets" value={draft.assets.sfx} onChange={(sfx) => updateAssets({ sfx })} />
        <TextField
          id={fieldId('assets', 'Cover templates')}
          label="Cover templates"
          value={draft.assets.coverTemplates}
          onChange={(coverTemplates) => updateAssets({ coverTemplates })}
        />
      </div>
      {assetCatalog && <AssetCatalogPanel catalog={assetCatalog} />}
    </>
  );
}

function AssetCatalogPanel({ catalog }: { catalog: AssetCatalog }) {
  return (
    <section className="asset-catalog-panel" aria-label="Asset pack catalog">
      <div className="asset-catalog-header">
        <div>
          <h4>Asset pack catalog</h4>
          <span>{catalog.schemaId}</span>
        </div>
        <span>{catalog.generatedAt}</span>
      </div>
      <div className="asset-catalog-grid">
        {catalog.slots.map((slot) => (
          <AssetCatalogSlotCard key={slot.kind} slot={slot} />
        ))}
      </div>
    </section>
  );
}

function AssetCatalogSlotCard({ slot }: { slot: AssetCatalogSlot }) {
  const firstEntry = slot.entries[0];

  return (
    <article className="asset-catalog-slot">
      <div className="asset-catalog-slot__header">
        <strong>{slot.kind}</strong>
        <span className={`status-badge status-badge--${slot.status === 'available' ? 'ok' : slot.status === 'unavailable' ? 'warn' : 'neutral'}`}>
          {slot.status}
        </span>
      </div>
      <dl>
        <dt>Path</dt>
        <dd>{slot.configuredPath}</dd>
        <dt>Manifest</dt>
        <dd>{slot.manifestPath}</dd>
        <dt>Extensions</dt>
        <dd>{slot.supportedExtensions.join(', ')}</dd>
        <dt>Assets</dt>
        <dd>{slot.entries.length}</dd>
        {firstEntry && (
          <>
            <dt>First asset</dt>
            <dd>{firstEntry.fileName}</dd>
            <dt>License</dt>
            <dd>{firstEntry.license}</dd>
          </>
        )}
      </dl>
      {slot.warnings.length > 0 && (
        <ul className="asset-catalog-warnings">
          {slot.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </article>
  );
}

export function StorageSettingsPanel({
  draft,
  updateStorage,
}: {
  draft: VideoCutSettings;
  updateStorage: PatchHandler<VideoCutSettings['storage']>;
}) {
  return (
    <div className="field-grid">
      <TextField id={fieldId('storage', 'Workspace root')} label="Workspace root" value={draft.storage.workspaceRoot} onChange={(workspaceRoot) => updateStorage({ workspaceRoot })} />
      <ReadOnlyField id={fieldId('storage', 'Artifact root')} label="Artifact root" value={draft.storage.artifactRoot} />
      <ReadOnlyField id={fieldId('storage', 'Temp root')} label="Temp root" value={draft.storage.tempRoot} />
      <NumberField id={fieldId('storage', 'Retention days')} label="Retention days" value={draft.storage.retentionDays} onChange={(retentionDays) => updateStorage({ retentionDays })} />
    </div>
  );
}

export function RuntimeSettingsPanel({
  draft,
  errorFor,
  updateRuntime,
}: {
  draft: VideoCutSettings;
  errorFor: ErrorLookup;
  updateRuntime: PatchHandler<VideoCutSettings['runtime']>;
}) {
  return (
    <div className="field-grid">
      <ReadOnlyField id={fieldId('runtime', 'Deployment mode')} label="Deployment mode" value={draft.runtime.deploymentMode} />
      <TextField id={fieldId('runtime', 'Bind host')} label="Bind host" value={draft.runtime.bindHost} onChange={(bindHost) => updateRuntime({ bindHost })} />
      <NumberField id={fieldId('runtime', 'Port')} label="Port" value={draft.runtime.port} onChange={(port) => updateRuntime({ port })} />
      <TextField id={fieldId('runtime', 'Public base URL')} label="Public base URL" value={draft.runtime.publicBaseUrl} onChange={(publicBaseUrl) => updateRuntime({ publicBaseUrl })} />
      <SelectField
        id={fieldId('runtime', 'Auth mode')}
        label="Auth mode"
        value={draft.runtime.authMode}
        options={['none', 'single-user-token', 'reverse-proxy']}
        onChange={(authMode) => updateRuntime({ authMode })}
        error={errorFor('runtime.authMode')}
      />
    </div>
  );
}

export function SecuritySettingsPanel({
  draft,
  errorFor,
  updateSecurity,
}: {
  draft: VideoCutSettings;
  errorFor: ErrorLookup;
  updateSecurity: PatchHandler<VideoCutSettings['security']>;
}) {
  return (
    <div className="field-grid">
      <SelectField
        id={fieldId('security', 'Secret provider')}
        label="Secret provider"
        value={draft.security.secretProvider}
        options={['local-secure-store', 'env', 'kubernetes-secret']}
        onChange={(secretProvider) => updateSecurity({ secretProvider })}
      />
      <TextField
        id={fieldId('security', 'CORS origins')}
        label="CORS origins"
        value={draft.security.corsAllowedOrigins.join(', ')}
        onChange={(value) =>
          updateSecurity({
            corsAllowedOrigins: value
              .split(',')
              .map((origin) => origin.trim())
              .filter(Boolean),
          })
        }
        error={errorFor('security.corsAllowedOrigins')}
      />
      <ReadOnlyField id={fieldId('security', 'Redaction')} label="Redaction" value={draft.security.redactionEnabled ? 'Enabled' : 'Disabled'} />
      <CheckboxField label="Enable redaction" checked={draft.security.redactionEnabled} onChange={(redactionEnabled) => updateSecurity({ redactionEnabled })} />
      <CheckboxField
        label="Include source media in diagnostics"
        checked={draft.security.diagnosticsIncludeSourceMedia}
        onChange={(diagnosticsIncludeSourceMedia) => updateSecurity({ diagnosticsIncludeSourceMedia })}
      />
      <CheckboxField
        label="Include transcript in diagnostics"
        checked={draft.security.diagnosticsIncludeTranscript}
        onChange={(diagnosticsIncludeTranscript) => updateSecurity({ diagnosticsIncludeTranscript })}
      />
    </div>
  );
}

export function DiagnosticsSettingsPanel({
  diagnosticBundle,
  diagnosticBundleDownload,
  doctorReport,
  onExportDiagnosticBundle,
  onExportDiagnosticSupportBundle,
  onRunDoctor,
  selectedTask,
}: {
  diagnosticBundle?: DiagnosticBundle;
  diagnosticBundleDownload?: DiagnosticBundleDownloadDescriptor;
  doctorReport?: DeploymentDoctorReport;
  onExportDiagnosticBundle: () => Promise<DiagnosticBundle | undefined>;
  onExportDiagnosticSupportBundle: (input: DiagnosticSupportBundleRequest) => Promise<DiagnosticBundle | undefined>;
  onRunDoctor: () => Promise<DeploymentDoctorReport | undefined>;
  selectedTask?: VideoCutTask;
}) {
  return (
    <div className="diagnostic-actions">
      <button type="button" className="primary-button" onClick={() => void onRunDoctor()}>
        <SlidersHorizontal size={18} aria-hidden="true" />
        Run doctor
      </button>
      <button type="button" className="secondary-button" onClick={() => void onExportDiagnosticBundle()}>
        <FileDown size={18} aria-hidden="true" />
        Export diagnostics
      </button>
      <p className="muted">Doctor 使用 host 的 CapabilityReport 和脱敏 effective config，不由 UI 自行探测环境。</p>
      <DiagnosticSupportBundleCard
        selectedTask={selectedTask}
        onExportSupportBundle={onExportDiagnosticSupportBundle}
      />
      <DiagnosticBundleDownloadCard bundle={diagnosticBundle} download={diagnosticBundleDownload} />
      {doctorReport && (
        <div className="settings-doctor-report">
          <div className="doctor-summary">
            <span className={`status-badge status-badge--${doctorReport.health === 'ok' ? 'ok' : 'warn'}`}>
              {doctorReport.health}
            </span>
            <span>{doctorReport.reportVersion}</span>
            <span>{doctorReport.generatedAt}</span>
          </div>
          {doctorReport.checks.map((check) => {
            const Icon = check.status === 'ok' ? CheckCircle2 : AlertTriangle;

            return (
              <article className="diagnostic-row diagnostic-row--doctor" key={check.checkId}>
                <Icon size={18} aria-hidden="true" />
                <strong>{check.checkId}</strong>
                <span>{check.label}</span>
                {check.actionHint && <small>{check.actionHint}</small>}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function OverviewSettingsPanel({ draft }: { draft: VideoCutSettings }) {
  return (
    <div className="field-grid">
      <ReadOnlyField id={fieldId('overview', 'Runtime mode')} label="Runtime mode" value={draft.runtime.deploymentMode} />
      <ReadOnlyField id={fieldId('overview', 'LLM readiness')} label="LLM readiness" value={draft.ai.enabled ? 'Enabled' : 'Not configured'} />
      <ReadOnlyField id={fieldId('overview', 'STT readiness')} label="STT readiness" value={draft.speechToText.enabled ? 'Enabled' : 'Not configured'} />
    </div>
  );
}

export function AboutSettingsPanel() {
  return (
    <p className="muted">
      sdkwork-video-cut MVP follows the local-first architecture and OpenAI-compatible provider contract.
    </p>
  );
}
