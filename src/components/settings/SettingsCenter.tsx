import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';

import { settingsSections, type SettingsSectionId } from '../../domain/settingsSchema';
import type { DiagnosticBundleDownloadDescriptor } from '../../domain/diagnosticBundleExport';
import type {
  AssetCatalog,
  DeploymentDoctorReport,
  DiagnosticBundle,
  DiagnosticSupportBundleRequest,
  ProviderConformanceReport,
  ProviderConformanceTarget,
  ValidationError,
  ValidationResult,
  VideoCutSettingsSavePayload,
  VideoCutSettings,
  VideoCutTask,
} from '../../domain/videoCutTypes';
import {
  buildSettingsSavePayload,
  stripWriteOnlySecretFields,
} from '../../services/settingsDraft';
import { StatusBadge } from '../StatusBadge';
import {
  AboutSettingsPanel,
  AiProviderSettingsPanel,
  AssetsSettingsPanel,
  DiagnosticsSettingsPanel,
  MediaToolsSettingsPanel,
  OutputPresetsPanel,
  OverviewSettingsPanel,
  RuntimeSettingsPanel,
  SecuritySettingsPanel,
  SpeechToTextSettingsPanel,
  StorageSettingsPanel,
  SubtitleSettingsPanel,
} from './SettingsPanels';

type SectionRendererProps = {
  aiApiKey: string;
  assetCatalog?: AssetCatalog;
  diagnosticBundle?: DiagnosticBundle;
  diagnosticBundleDownload?: DiagnosticBundleDownloadDescriptor;
  doctorReport?: DeploymentDoctorReport;
  providerConformanceReport?: ProviderConformanceReport;
  draft: VideoCutSettings;
  errorFor: (field: string) => string | undefined;
  onExportDiagnosticBundle: () => Promise<DiagnosticBundle | undefined>;
  onExportDiagnosticSupportBundle: (input: DiagnosticSupportBundleRequest) => Promise<DiagnosticBundle | undefined>;
  onRunProviderConformance: (target: ProviderConformanceTarget) => Promise<ProviderConformanceReport | undefined>;
  onRunDoctor: () => Promise<DeploymentDoctorReport | undefined>;
  selectedTask?: VideoCutTask;
  setAiApiKey: (value: string) => void;
  setSpeechApiKey: (value: string) => void;
  speechApiKey: string;
  updateAi: (patch: Partial<VideoCutSettings['ai']>) => void;
  updateAssets: (patch: Partial<VideoCutSettings['assets']>) => void;
  updateMediaTools: (patch: Partial<VideoCutSettings['mediaTools']>) => void;
  updateRuntime: (patch: Partial<VideoCutSettings['runtime']>) => void;
  updateSecurity: (patch: Partial<VideoCutSettings['security']>) => void;
  updateSpeechToText: (patch: Partial<VideoCutSettings['speechToText']>) => void;
  updateStorage: (patch: Partial<VideoCutSettings['storage']>) => void;
  updateSubtitle: (patch: Partial<VideoCutSettings['subtitle']>) => void;
};

function appendPathSegment(root: string, segment: string): string {
  const trimmed = root.trim();
  if (!trimmed) {
    return '';
  }

  const normalized = trimmed.replace(/[\\/]+$/, '');
  if (normalized) {
    return `${normalized}/${segment}`;
  }

  return `${trimmed.startsWith('\\') ? '\\' : '/'}${segment}`;
}

function derivedStorageRoots(workspaceRoot: string): Pick<VideoCutSettings['storage'], 'artifactRoot' | 'tempRoot'> {
  return {
    artifactRoot: appendPathSegment(workspaceRoot, 'artifacts'),
    tempRoot: appendPathSegment(workspaceRoot, 'tmp'),
  };
}

function withDerivedStorageRoots(settings?: VideoCutSettings): VideoCutSettings | undefined {
  if (!settings) {
    return settings;
  }

  return {
    ...settings,
    storage: {
      ...settings.storage,
      ...derivedStorageRoots(settings.storage.workspaceRoot),
    },
  };
}

function renderSettingsSection(activeSection: SettingsSectionId, props: SectionRendererProps) {
  switch (activeSection) {
    case 'overview':
      return <OverviewSettingsPanel draft={props.draft} />;
    case 'ai':
      return (
        <AiProviderSettingsPanel
          aiApiKey={props.aiApiKey}
          draft={props.draft}
          errorFor={props.errorFor}
          providerConformanceReport={props.providerConformanceReport}
          onRunProviderConformance={props.onRunProviderConformance}
          setAiApiKey={props.setAiApiKey}
          updateAi={props.updateAi}
        />
      );
    case 'speechToText':
      return (
        <SpeechToTextSettingsPanel
          draft={props.draft}
          errorFor={props.errorFor}
          providerConformanceReport={props.providerConformanceReport}
          onRunProviderConformance={props.onRunProviderConformance}
          setSpeechApiKey={props.setSpeechApiKey}
          speechApiKey={props.speechApiKey}
          updateSpeechToText={props.updateSpeechToText}
        />
      );
    case 'subtitle':
      return <SubtitleSettingsPanel draft={props.draft} updateSubtitle={props.updateSubtitle} />;
    case 'mediaTools':
      return <MediaToolsSettingsPanel draft={props.draft} errorFor={props.errorFor} updateMediaTools={props.updateMediaTools} />;
    case 'outputPresets':
      return <OutputPresetsPanel />;
    case 'assets':
      return <AssetsSettingsPanel assetCatalog={props.assetCatalog} draft={props.draft} updateAssets={props.updateAssets} />;
    case 'storage':
      return <StorageSettingsPanel draft={props.draft} updateStorage={props.updateStorage} />;
    case 'runtime':
      return <RuntimeSettingsPanel draft={props.draft} errorFor={props.errorFor} updateRuntime={props.updateRuntime} />;
    case 'security':
      return <SecuritySettingsPanel draft={props.draft} errorFor={props.errorFor} updateSecurity={props.updateSecurity} />;
    case 'diagnostics':
      return (
        <DiagnosticsSettingsPanel
          diagnosticBundle={props.diagnosticBundle}
          diagnosticBundleDownload={props.diagnosticBundleDownload}
          doctorReport={props.doctorReport}
          onExportDiagnosticBundle={props.onExportDiagnosticBundle}
          onExportDiagnosticSupportBundle={props.onExportDiagnosticSupportBundle}
          onRunDoctor={props.onRunDoctor}
          selectedTask={props.selectedTask}
        />
      );
    case 'about':
      return <AboutSettingsPanel />;
    default:
      return null;
  }
}

export function SettingsCenter({
  diagnosticBundle,
  diagnosticBundleDownload,
  doctorReport,
  providerConformanceReport,
  assetCatalog,
  onExportDiagnosticBundle,
  onExportDiagnosticSupportBundle,
  onRunProviderConformance,
  onRunDoctor,
  selectedTask,
  settings,
  onSave,
}: {
  diagnosticBundle?: DiagnosticBundle;
  diagnosticBundleDownload?: DiagnosticBundleDownloadDescriptor;
  doctorReport?: DeploymentDoctorReport;
  providerConformanceReport?: ProviderConformanceReport;
  assetCatalog?: AssetCatalog;
  onExportDiagnosticBundle: () => Promise<DiagnosticBundle | undefined>;
  onExportDiagnosticSupportBundle: (input: DiagnosticSupportBundleRequest) => Promise<DiagnosticBundle | undefined>;
  onRunProviderConformance: (target: ProviderConformanceTarget) => Promise<ProviderConformanceReport | undefined>;
  onRunDoctor: () => Promise<DeploymentDoctorReport | undefined>;
  selectedTask?: VideoCutTask;
  settings?: VideoCutSettings;
  onSave: (settings: VideoCutSettingsSavePayload) => Promise<ValidationResult | undefined>;
}) {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('ai');
  const [draft, setDraft] = useState<VideoCutSettings | undefined>(() => withDerivedStorageRoots(settings));
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [saveMessage, setSaveMessage] = useState('');
  const [aiApiKey, setAiApiKey] = useState('');
  const [speechApiKey, setSpeechApiKey] = useState('');
  const activeSectionDefinition = settingsSections.find((section) => section.id === activeSection) ?? settingsSections[0];

  useEffect(() => {
    setDraft(withDerivedStorageRoots(settings));
  }, [settings]);

  const updateDraft = (updater: (current: VideoCutSettings) => VideoCutSettings) => {
    setDraft((current) => (current ? updater(current) : current));
    setSaveMessage('');
  };

  const updateAi = (patch: Partial<VideoCutSettings['ai']>) => {
    updateDraft((current) => ({
      ...current,
      ai: {
        ...current.ai,
        ...patch,
      },
    }));
  };

  const updateSpeechToText = (patch: Partial<VideoCutSettings['speechToText']>) => {
    updateDraft((current) => ({
      ...current,
      speechToText: {
        ...current.speechToText,
        ...patch,
      },
    }));
  };

  const updateSubtitle = (patch: Partial<VideoCutSettings['subtitle']>) => {
    updateDraft((current) => ({
      ...current,
      subtitle: {
        ...current.subtitle,
        ...patch,
      },
    }));
  };

  const updateMediaTools = (patch: Partial<VideoCutSettings['mediaTools']>) => {
    updateDraft((current) => ({
      ...current,
      mediaTools: {
        ...current.mediaTools,
        ...patch,
      },
    }));
  };

  const updateAssets = (patch: Partial<VideoCutSettings['assets']>) => {
    updateDraft((current) => ({
      ...current,
      assets: {
        ...current.assets,
        ...patch,
      },
    }));
  };

  const updateStorage = (patch: Partial<VideoCutSettings['storage']>) => {
    updateDraft((current) => ({
      ...current,
      storage: {
        ...current.storage,
        ...patch,
        ...(Object.prototype.hasOwnProperty.call(patch, 'workspaceRoot')
          ? derivedStorageRoots(patch.workspaceRoot ?? '')
          : {}),
      },
    }));
  };

  const updateRuntime = (patch: Partial<VideoCutSettings['runtime']>) => {
    updateDraft((current) => ({
      ...current,
      runtime: {
        ...current.runtime,
        ...patch,
      },
    }));
  };

  const updateSecurity = (patch: Partial<VideoCutSettings['security']>) => {
    updateDraft((current) => ({
      ...current,
      security: {
        ...current.security,
        ...patch,
      },
    }));
  };

  const errorFor = (field: string) => errors.find((error) => error.field === field)?.message;

  const handleSaveSettings = async () => {
    if (!draft) {
      return;
    }

    const savePayload = buildSettingsSavePayload(draft, {
      aiApiKey,
      speechApiKey,
    });
    const result = await onSave(savePayload);
    if (!result) {
      return;
    }
    setErrors(result.errors);
    if (result.valid) {
      setDraft(stripWriteOnlySecretFields(savePayload));
      setAiApiKey('');
      setSpeechApiKey('');
      setSaveMessage('Settings saved');
    } else {
      setSaveMessage('');
    }
  };

  const discardChanges = () => {
    setDraft(settings);
    setErrors([]);
    setAiApiKey('');
    setSpeechApiKey('');
    setSaveMessage('');
  };

  if (!draft) {
    return (
      <section className="settings-layout">
        <div className="settings-header">
          <div>
            <span className="eyebrow">Settings</span>
            <h2>设置中心</h2>
          </div>
          <StatusBadge label="loading" />
        </div>
        <div className="settings-form">
          <p className="muted">正在读取 host 设置...</p>
        </div>
      </section>
    );
  }

  return (
    <section className="settings-layout">
      <div className="settings-header">
        <div>
          <span className="eyebrow">Settings</span>
          <h2>设置中心</h2>
        </div>
        <StatusBadge label={draft.runtime.deploymentMode} />
      </div>
      <section className="settings-nav" aria-label="Settings sections">
        {settingsSections.map((section) => (
          <button
            key={section.id}
            type="button"
            className={activeSection === section.id ? 'settings-nav-item settings-nav-item--active' : 'settings-nav-item'}
            onClick={() => setActiveSection(section.id)}
          >
            {section.label}
          </button>
        ))}
      </section>
      <div className="settings-form">
        <h3>{activeSectionDefinition.label}</h3>
        <p className="settings-section-description">{activeSectionDefinition.description}</p>
        <div className="settings-schema-strip" aria-label="Settings schema metadata">
          <StatusBadge label={`${activeSectionDefinition.fields.length} fields`} />
          <StatusBadge
            label={`${activeSectionDefinition.fields.filter((field) => field.secret).length} secret`}
            tone={activeSectionDefinition.fields.some((field) => field.secret) ? 'warn' : 'neutral'}
          />
          <StatusBadge label={activeSectionDefinition.fields.some((field) => field.requiresRestart) ? 'restart-aware' : 'no restart'} />
        </div>
        {errors.length > 0 && <div className="settings-error-summary">{errors.length} settings issue needs attention.</div>}
        {saveMessage && <div className="settings-save-message">{saveMessage}</div>}
        {renderSettingsSection(activeSection, {
          aiApiKey,
          assetCatalog,
          diagnosticBundle,
          diagnosticBundleDownload,
          doctorReport,
          providerConformanceReport,
          draft,
          errorFor,
          onExportDiagnosticBundle,
          onExportDiagnosticSupportBundle,
          onRunProviderConformance,
          onRunDoctor,
          selectedTask,
          setAiApiKey,
          setSpeechApiKey,
          speechApiKey,
          updateAi,
          updateAssets,
          updateMediaTools,
          updateRuntime,
          updateSecurity,
          updateSpeechToText,
          updateStorage,
          updateSubtitle,
        })}
        <div className="settings-action-bar">
          <span>Changes are local until saved to the host settings contract.</span>
          <button type="button" className="secondary-button" onClick={discardChanges}>
            Discard
          </button>
          <button type="button" className="primary-button" onClick={handleSaveSettings}>
            <Save size={18} aria-hidden="true" />
            Save settings
          </button>
        </div>
      </div>
    </section>
  );
}
