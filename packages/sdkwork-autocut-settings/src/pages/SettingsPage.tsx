import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { Card, Button, useToast } from '@sdkwork/autocut-commons';
import {
  Bell,
  BrainCircuit,
  Check,
  Copy,
  CreditCard,
  Database,
  FolderOpen,
  Key,
  Monitor,
  Play,
  RotateCcw,
  Shield,
  Trash2,
  User,
} from 'lucide-react';
import {
  cancelAutoCutSubscription,
  clearAutoCutStorageCache,
  createAutoCutApiKey,
  deleteAutoCutAccount,
  copyAutoCutLocalSpeechTranscriptionModelPresetUrl,
  downloadAutoCutLocalSpeechTranscriptionModelPreset,
  getAutoCutLocalSpeechTranscriptionModelPresets,
  getAutoCutSettings,
  inspectAutoCutLocalSpeechTranscriptionSetup,
  initializeAutoCutLocalSpeechTranscriptionSetup,
  listenAutoCutEvent,
  loadMoreAutoCutInvoices,
  normalizeAutoCutLocale,
  openAutoCutSubscriptionManagement,
  requestAutoCutAvatarChange,
  requestAutoCutPasswordChange,
  revokeAutoCutApiKey,
  revokeAutoCutSessions,
  saveAutoCutAccountSettings,
  saveAutoCutLlmSettings,
  saveAutoCutNotificationSettings,
  saveAutoCutSpeechTranscriptionSettings,
  saveAutoCutWorkspaceSettings,
  selectAutoCutSpeechTranscriptionFile,
  selectAutoCutTrustedLocalDirectory,
  setAutoCutTwoFactorEnabled,
  setupAutoCutLocalSpeechTranscriptionModelPreset,
  testAutoCutLlmConnection,
  testAutoCutSpeechTranscriptionProvider,
  writeAutoCutClipboardText,
} from '@sdkwork/autocut-services';
import {
  AUTOCUT_MODEL_VENDOR_PRESETS,
  AUTOCUT_SMART_SLICE_SEGMENTATION_AGENTS,
  AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_PHASE,
  AUTOCUT_SPEECH_TRANSCRIPTION_LANGUAGE_OPTIONS,
  AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_EXTENSIONS,
  AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER_DEFINITIONS,
  AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS,
  getAutoCutModelPreset,
  getAutoCutSmartSliceSegmentationAgentDefinition,
  getAutoCutSpeechTranscriptionProviderDefinition,
  isAutoCutSpeechTranscriptionModelDownloadTerminalPhase,
} from '@sdkwork/autocut-types';
import type {
  AppSettings,
  AutoCutAppLocale,
  AutoCutLocalSpeechTranscriptionSetupReadiness,
  AutoCutLocalSpeechTranscriptionSetupStatus,
  AutoCutLlmSettings,
  AutoCutSmartSliceSegmentationAgentId,
  AutoCutSpeechTranscriptionModelDownloadProgressEvent,
  AutoCutSpeechTranscriptionProviderId,
  ModelVendor,
} from '@sdkwork/autocut-types';
import {
  AUTOCUT_SETTINGS_LOCALE_OPTIONS,
  AUTOCUT_SETTINGS_TABS,
  isAutoCutSettingsTabId,
  type AutoCutSettingsIconId,
  type AutoCutSettingsTabId,
} from '../service/settings.registry';

const AUTOCUT_SETTINGS_ICON: Record<AutoCutSettingsIconId, ReactNode> = {
  bell: <Bell size={16} />,
  brain: <BrainCircuit size={16} />,
  'credit-card': <CreditCard size={16} />,
  database: <Database size={16} />,
  key: <Key size={16} />,
  monitor: <Monitor size={16} />,
  shield: <Shield size={16} />,
  user: <User size={16} />,
};

const AUTOCUT_DEFAULT_SETTINGS_TAB = AUTOCUT_SETTINGS_TABS[0];

if (!AUTOCUT_DEFAULT_SETTINGS_TAB) {
  throw new Error('AutoCut Settings Center requires at least one settings tab.');
}

const AUTOCUT_NOTIFICATION_FIELDS: readonly {
  key: keyof AppSettings['notifications'];
  labelKey: string;
}[] = [
  { key: 'taskCompleted', labelKey: 'settings.notification.taskCompleted' },
  { key: 'appUpdates', labelKey: 'settings.notification.appUpdates' },
  { key: 'accountBilling', labelKey: 'settings.notification.accountBilling' },
  { key: 'productAnnouncements', labelKey: 'settings.notification.productAnnouncements' },
  { key: 'usageReports', labelKey: 'settings.notification.usageReports' },
] as const;

function getAutoCutAccountInitials(displayName: string) {
  const initials = displayName.trim().slice(0, 2).toUpperCase();
  return initials || 'US';
}

function formatAutoCutTokenCount(tokens: number) {
  return String(Math.round(tokens)).replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
}

function formatAutoCutByteCount(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'] as const;
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatAutoCutSpeechSetupPath(path: string | undefined) {
  const value = path?.trim();
  if (!value) {
    return '';
  }
  const normalized = value.replace(/\\/gu, '/');
  const fileName = normalized.split('/').filter(Boolean).at(-1);
  return fileName || value;
}

function normalizeSettingsLocalPath(path: string | undefined) {
  return (path ?? '').trim().replace(/\\/gu, '/').replace(/\/+/gu, '/').replace(/\/$/u, '').toLowerCase();
}

function createSettingsSpeechSetupFriendlyError(
  error: unknown,
  translate: (key: string) => string,
) {
  const rawMessage = error instanceof Error ? error.message : String(error ?? '');
  const message = rawMessage.toLowerCase();
  if (
    message.includes('checksum') ||
    message.includes('integrity') ||
    message.includes('sha-256')
  ) {
    return translate('settings.toast.speechModelIntegrityFailed');
  }
  if (
    message.includes('incomplete') ||
    message.includes('did not finish') ||
    message.includes('download') ||
    message.includes('network') ||
    message.includes('http status')
  ) {
    return translate('settings.speech.modelDownloadFailedDescription');
  }
  if (
    message.includes('final availability check') ||
    message.includes('provider validation') ||
    message.includes('probe') ||
    message.includes('availability')
  ) {
    return translate('settings.toast.speechSetupAvailabilityFailed');
  }
  if (
    message.includes('executable') ||
    message.includes('whisper-cli') ||
    message.includes('sidecar')
  ) {
    return translate('settings.toast.speechSetupNeedsRecognitionApp');
  }
  return translate('settings.toast.speechModelConfigureFailed');
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
      {children}
    </label>
  );
}

function waitForSettingsUiYield() {
  return new Promise<void>((resolve) => {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          setTimeout(() => resolve(), 0);
        });
      });
      return;
    }

    setTimeout(() => resolve(), 0);
  });
}

function FieldHelp({ children }: { children: ReactNode }) {
  return <p className="text-[11px] leading-relaxed text-gray-500">{children}</p>;
}

function SectionTitle({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return (
    <div className="border-b border-[#222] pb-4">
      <h3 className="text-lg font-semibold text-white">{title}</h3>
      {description ? <p className="mt-1 text-xs leading-relaxed text-gray-500">{description}</p> : null}
    </div>
  );
}

function StatusBadge({ tone, children }: { tone: 'green' | 'yellow' | 'red'; children: ReactNode }) {
  const toneClass = {
    green: 'border-green-500/20 bg-green-500/10 text-green-500',
    yellow: 'border-yellow-500/20 bg-yellow-500/10 text-yellow-500',
    red: 'border-red-500/20 bg-red-500/10 text-red-500',
  }[tone];

  return (
    <span className={`inline-flex min-h-6 items-center rounded border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${toneClass}`}>
      {children}
    </span>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span className="h-6 w-11 rounded-full bg-[#222] transition-colors peer-checked:bg-blue-600" />
      <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full border border-gray-300 bg-gray-400 transition-transform peer-checked:translate-x-full peer-checked:bg-white" />
    </label>
  );
}

function SettingsRow({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-t border-[#111] py-5 first:border-t-0 first:pt-0 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <h4 className="text-sm font-medium text-gray-200">{title}</h4>
        {description ? <p className="mt-1 text-xs leading-relaxed text-gray-500">{description}</p> : null}
      </div>
      <div className="min-w-0 md:max-w-xl">{children}</div>
    </div>
  );
}

export function SettingsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const queryParams = new URLSearchParams(location.search);
  const tabFromUrl = queryParams.get('tab');
  const initialTab = isAutoCutSettingsTabId(tabFromUrl) ? tabFromUrl : 'account';

  const [activeTab, setActiveTab] = useState<AutoCutSettingsTabId>(initialTab);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [isTestingLlmConnection, setIsTestingLlmConnection] = useState(false);
  const [isTestingSpeechTranscription, setIsTestingSpeechTranscription] = useState(false);
  const [isConfiguringSpeechModel, setIsConfiguringSpeechModel] = useState(false);
  const [speechSetupStatus, setSpeechSetupStatus] = useState<AutoCutLocalSpeechTranscriptionSetupStatus | null>(null);
  const [speechModelDownloadProgress, setSpeechModelDownloadProgress] =
    useState<AutoCutSpeechTranscriptionModelDownloadProgressEvent | null>(null);

  useEffect(() => {
    setActiveTab(isAutoCutSettingsTabId(tabFromUrl) ? tabFromUrl : 'account');
  }, [tabFromUrl]);

  useEffect(() => {
    getAutoCutSettings().then((loadedSettings) => {
      setSettings(loadedSettings);
      void i18n.changeLanguage(loadedSettings.workspace.language);
    });
    return listenAutoCutEvent('settingsUpdated', (nextSettings) => {
      setSettings(nextSettings);
      void i18n.changeLanguage(nextSettings.workspace.language);
    });
  }, [i18n]);

  useEffect(() => {
    if (!settings || activeTab !== 'speech') {
      return;
    }
    const provider = getAutoCutSpeechTranscriptionProviderDefinition(settings.speechTranscription.providerId);
    if (provider.kind !== 'local') {
      setSpeechSetupStatus(null);
      return;
    }

    let cancelled = false;
    void inspectAutoCutLocalSpeechTranscriptionSetup()
      .then((status) => {
        if (!cancelled) {
          setSpeechSetupStatus(status);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSpeechSetupStatus(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeTab,
    settings?.speechTranscription.providerId,
    settings?.speechTranscription.executablePath,
    settings?.speechTranscription.modelPath,
    settings?.speechTranscription.lastProbeReady,
  ]);

  useEffect(() => listenAutoCutEvent('speechTranscriptionModelDownloadProgress', (progress) => {
    setSpeechModelDownloadProgress(progress);
  }), []);

  const activeTabDefinition = useMemo(
    () => AUTOCUT_SETTINGS_TABS.find((tab) => tab.id === activeTab) ?? AUTOCUT_DEFAULT_SETTINGS_TAB,
    [activeTab],
  );

  const updateSettingsState = (nextSettings: AppSettings) => {
    setSettings(nextSettings);
    void i18n.changeLanguage(nextSettings.workspace.language);
  };

  const handleTabChange = (tabId: AutoCutSettingsTabId) => {
    setActiveTab(tabId);
    navigate(`/settings?tab=${tabId}`, { replace: true });
  };

  const handleSaveAccount = async () => {
    if (!settings) return;
    updateSettingsState(await saveAutoCutAccountSettings(settings.account));
    toast(t('settings.toast.accountSaved'), 'success');
  };

  const handleSaveWorkspace = async () => {
    if (!settings) return;
    updateSettingsState(await saveAutoCutWorkspaceSettings(settings.workspace));
    toast(t('settings.toast.workspaceSaved'), 'success');
  };

  const handleWorkspacePreferenceChange = (workspace: AppSettings['workspace']) => {
    if (!settings) return;
    const nextSettings = { ...settings, workspace };
    setSettings(nextSettings);
    void saveAutoCutWorkspaceSettings(workspace).then(updateSettingsState);
  };

  const handleWorkspaceLanguageChange = (language: string) => {
    if (!settings) return;
    const normalizedLanguage: AutoCutAppLocale = normalizeAutoCutLocale(language);
    const workspace = { ...settings.workspace, language: normalizedLanguage };
    const nextSettings = { ...settings, workspace };
    setSettings(nextSettings);
    void i18n.changeLanguage(normalizedLanguage);
    void saveAutoCutWorkspaceSettings(workspace).then(updateSettingsState);
  };

  const handleSaveNotifications = async () => {
    if (!settings) return;
    updateSettingsState(await saveAutoCutNotificationSettings(settings.notifications));
    toast(t('settings.toast.notificationsSaved'), 'success');
  };

  const handleNotificationPreferenceChange = (notifications: AppSettings['notifications']) => {
    if (!settings) return;
    setSettings({ ...settings, notifications });
    void saveAutoCutNotificationSettings(notifications).then(updateSettingsState);
  };

  const handleChangeAvatar = async () => {
    updateSettingsState(await requestAutoCutAvatarChange());
    toast(t('settings.toast.avatarRequested'), 'info');
  };

  const handleLlmSettingsChange = (llm: AutoCutLlmSettings) => {
    if (!settings) return;
    setSettings({ ...settings, llm });
  };

  const handleLlmVendorChange = (modelVendor: ModelVendor) => {
    if (!settings) return;
    const preset = AUTOCUT_MODEL_VENDOR_PRESETS[modelVendor];
    const nextLlm: AutoCutLlmSettings = {
      ...settings.llm,
      modelVendor,
      baseUrl: modelVendor === 'custom' ? settings.llm.baseUrl : preset.baseUrl,
      model: modelVendor === 'custom' ? settings.llm.model : preset.defaultModel,
    };
    handleLlmSettingsChange(nextLlm);
    void saveAutoCutLlmSettings(nextLlm).then(updateSettingsState);
  };

  const handleSaveLlmSettings = async () => {
    if (!settings) return;
    updateSettingsState(await saveAutoCutLlmSettings(settings.llm));
    toast(t('settings.toast.llmSaved'), 'success');
  };

  const handleTestLlmConnection = async () => {
    if (!settings || isTestingLlmConnection) return;
    setIsTestingLlmConnection(true);
    try {
      updateSettingsState(await saveAutoCutLlmSettings(settings.llm));
      const result = await testAutoCutLlmConnection();
      toast(t('settings.toast.llmTestPassed', { model: result.model }), 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : t('settings.toast.llmTestFailed');
      toast(message, 'error');
    } finally {
      setIsTestingLlmConnection(false);
    }
  };

  const handleSpeechTranscriptionSettingsChange = (speechTranscription: AppSettings['speechTranscription']) => {
    if (!settings) return;
    setSettings({ ...settings, speechTranscription: resetSpeechTranscriptionProbeState(speechTranscription) });
  };

  const resetSpeechTranscriptionProbeState = (
    speechTranscription: AppSettings['speechTranscription'],
  ): AppSettings['speechTranscription'] => {
    const nextSpeechTranscription = { ...speechTranscription };
    delete nextSpeechTranscription.lastTestedAt;
    delete nextSpeechTranscription.lastProbeReady;
    delete nextSpeechTranscription.lastProbeDiagnostics;
    return nextSpeechTranscription;
  };

  const handleSpeechTranscriptionProviderChange = (providerId: AutoCutSpeechTranscriptionProviderId) => {
    if (!settings) return;
    const provider = getAutoCutSpeechTranscriptionProviderDefinition(providerId);
    const nextSpeechTranscription = resetSpeechTranscriptionProbeState({
      ...settings.speechTranscription,
      providerId: provider.id,
      ...(provider.kind === 'api'
        ? {
            modelVendor: provider.modelVendor,
            baseUrl: provider.modelVendor
              ? AUTOCUT_MODEL_VENDOR_PRESETS[provider.modelVendor].baseUrl
              : settings.speechTranscription.baseUrl,
            model: provider.defaultModel ?? settings.speechTranscription.model,
          }
        : {}),
    });
    handleSpeechTranscriptionSettingsChange(nextSpeechTranscription);
    void saveAutoCutSpeechTranscriptionSettings(nextSpeechTranscription)
      .then(updateSettingsState)
      .then(() => {
        if (provider.kind === 'local') {
          void handleSetupSpeechTranscriptionModelPreset();
        }
      });
  };

  const handleSaveSpeechTranscriptionSettings = async () => {
    if (!settings) return;
    updateSettingsState(await saveAutoCutSpeechTranscriptionSettings(settings.speechTranscription));
    toast(t('settings.toast.speechSaved'), 'success');
  };

  const handleSelectSpeechTranscriptionFile = async (kind: 'executable' | 'model') => {
    if (!settings) return;
    const selectedPath = await selectAutoCutSpeechTranscriptionFile(kind);
    if (!selectedPath) return;
    const speechTranscription = {
      ...settings.speechTranscription,
      ...(kind === 'executable' ? { executablePath: selectedPath } : { modelPath: selectedPath }),
    };
    updateSettingsState(await saveAutoCutSpeechTranscriptionSettings(resetSpeechTranscriptionProbeState(speechTranscription)));
    toast(t('settings.toast.speechPathUpdated'), 'success');
  };

  const handleDownloadSpeechTranscriptionModelPreset = (modelPresetId: string) => {
    downloadAutoCutLocalSpeechTranscriptionModelPreset(modelPresetId);
  };

  const handleSetupSpeechTranscriptionModelPreset = async (modelPresetId?: string) => {
    if (isConfiguringSpeechModel) return;
    setIsConfiguringSpeechModel(true);
    try {
      await waitForSettingsUiYield();
      const result = await setupAutoCutLocalSpeechTranscriptionModelPreset(modelPresetId);
      updateSettingsState(result.settings);
      const refreshedStatus = await inspectAutoCutLocalSpeechTranscriptionSetup();
      setSpeechSetupStatus(refreshedStatus);
      toast(
        result.nativeDownload && refreshedStatus.readiness === AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.ready
          ? t('settings.toast.speechModelConfigured', { model: result.preset.label })
          : result.nativeDownload
            ? createSettingsSpeechSetupFriendlyError(
                new Error(refreshedStatus.diagnostics[0] ?? 'final availability check'),
                t,
              )
            : t('settings.toast.speechModelDownloadStarted', { model: result.preset.label }),
        result.nativeDownload && refreshedStatus.readiness === AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.ready
          ? 'success'
          : 'info',
      );
    } catch (error) {
      toast(createSettingsSpeechSetupFriendlyError(error, t), 'error');
      void inspectAutoCutLocalSpeechTranscriptionSetup()
        .then(setSpeechSetupStatus)
        .catch(() => setSpeechSetupStatus(null));
    } finally {
      setIsConfiguringSpeechModel(false);
    }
  };

  const handleInitializeSpeechTranscriptionSetup = async () => {
    if (isConfiguringSpeechModel) return;
    setIsConfiguringSpeechModel(true);
    try {
      setSpeechModelDownloadProgress(null);
      await waitForSettingsUiYield();
      const result = await initializeAutoCutLocalSpeechTranscriptionSetup();
      updateSettingsState(result.settings);
      setSpeechSetupStatus(result.status);
      toast(t('settings.toast.speechModelConfigured', { model: result.status.model.preset.label }), 'success');
    } catch (error) {
      toast(createSettingsSpeechSetupFriendlyError(error, t), 'error');
      void inspectAutoCutLocalSpeechTranscriptionSetup()
        .then(setSpeechSetupStatus)
        .catch(() => setSpeechSetupStatus(null));
    } finally {
      setIsConfiguringSpeechModel(false);
    }
  };

  const handleCopySpeechTranscriptionModelPresetUrl = async (modelPresetId: string) => {
    await copyAutoCutLocalSpeechTranscriptionModelPresetUrl(modelPresetId);
    toast(t('settings.toast.speechModelUrlCopied'), 'success');
  };

  const handleTestSpeechTranscriptionProvider = async () => {
    if (!settings || isTestingSpeechTranscription) return;
    setIsTestingSpeechTranscription(true);
    try {
      updateSettingsState(await saveAutoCutSpeechTranscriptionSettings(settings.speechTranscription));
      const result = await testAutoCutSpeechTranscriptionProvider();
      toast(t('settings.toast.speechTestPassed', { sourceKind: result.sourceKind }), 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : t('settings.toast.speechTestFailed');
      toast(message, 'error');
    } finally {
      setIsTestingSpeechTranscription(false);
    }
  };

  const handleChangeDirectory = async () => {
    if (!settings) return;
    const selectedDirectory = await selectAutoCutTrustedLocalDirectory();
    if (!selectedDirectory) return;
    updateSettingsState(await saveAutoCutWorkspaceSettings({
      ...settings.workspace,
      defaultStoragePath: selectedDirectory,
    }));
    toast(t('settings.toast.defaultDirectoryUpdated'), 'success');
  };

  const handleChangeOutputDirectory = async () => {
    if (!settings) return;
    const selectedDirectory = await selectAutoCutTrustedLocalDirectory();
    if (!selectedDirectory) return;
    updateSettingsState(await saveAutoCutWorkspaceSettings({
      ...settings.workspace,
      outputDirectory: selectedDirectory,
    }));
    toast(t('settings.toast.outputDirectoryUpdated'), 'success');
  };

  const handleCreateApiKey = async () => {
    updateSettingsState(await createAutoCutApiKey());
    toast(t('settings.toast.apiKeyCreated'), 'success');
  };

  const handleCopyApiKey = async (maskedKey: string) => {
    await writeAutoCutClipboardText(maskedKey);
    toast(t('settings.toast.apiKeyCopied'), 'success');
  };

  const handleRevokeApiKey = async (apiKeyId: string) => {
    updateSettingsState(await revokeAutoCutApiKey(apiKeyId));
    toast(t('settings.toast.apiKeyRevoked'), 'success');
  };

  const handleClearCache = async () => {
    updateSettingsState(await clearAutoCutStorageCache());
    toast(t('settings.toast.cacheCleared'), 'success');
  };

  const handleLoadMoreInvoices = async () => {
    updateSettingsState(await loadMoreAutoCutInvoices());
    toast(t('settings.toast.invoicesLoaded'), 'success');
  };

  const handleCancelSubscription = async () => {
    updateSettingsState(await cancelAutoCutSubscription());
    toast(t('settings.toast.subscriptionUpdated'), 'info');
  };

  const handleManageSubscription = async () => {
    updateSettingsState(await openAutoCutSubscriptionManagement());
    handleTabChange('billing');
    toast(t('settings.toast.subscriptionManagementOpened'), 'info');
  };

  const handleChangePassword = async () => {
    updateSettingsState(await requestAutoCutPasswordChange());
    toast(t('settings.toast.passwordRequested'), 'info');
  };

  const handleToggleTwoFactor = async () => {
    if (!settings) return;
    updateSettingsState(await setAutoCutTwoFactorEnabled(!settings.security.twoFactorEnabled));
    toast(t('settings.toast.twoFactorUpdated'), 'success');
  };

  const handleRevokeSessions = async () => {
    updateSettingsState(await revokeAutoCutSessions());
    toast(t('settings.toast.sessionsRevoked'), 'success');
  };

  const handleDeleteAccount = async () => {
    updateSettingsState(await deleteAutoCutAccount());
    toast(t('settings.toast.accountDeletionRequested'), 'info');
  };

  if (!settings) {
    return (
      <div className="h-full w-full overflow-y-auto bg-[#050505] p-6 text-gray-200 md:p-10">
        <div className="flex h-full min-h-[240px] items-center justify-center text-gray-500">
          {t('settings.page.loading')}
        </div>
      </div>
    );
  }

  const activeLlmVendorPreset = AUTOCUT_MODEL_VENDOR_PRESETS[settings.llm.modelVendor];
  const activeLlmModelPreset = getAutoCutModelPreset(settings.llm.modelVendor, settings.llm.model);
  const selectedLlmSegmentationAgent = getAutoCutSmartSliceSegmentationAgentDefinition(
    settings.llm.defaultSegmentationAgentId,
  );
  const activeSpeechTranscriptionProvider = getAutoCutSpeechTranscriptionProviderDefinition(
    settings.speechTranscription.providerId,
  );
  const activeSpeechTranscriptionModelPresets = getAutoCutLocalSpeechTranscriptionModelPresets(
    activeSpeechTranscriptionProvider.id,
  );
  const executableReady =
    activeSpeechTranscriptionProvider.kind !== 'local' ||
    speechSetupStatus?.executable.ready === true;
  const testReady = speechSetupStatus?.test.ready === true || settings.speechTranscription.lastProbeReady === true;
  const speechRuntimeReady =
    activeSpeechTranscriptionProvider.kind === 'local' ? testReady : settings.speechTranscription.configured;
  const speechModelDownloadPhase = speechModelDownloadProgress?.phase;
  const speechModelDownloadCompleted =
    speechModelDownloadPhase === AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_PHASE.completed ||
    speechModelDownloadPhase === AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_PHASE.skipped;
  const speechModelDownloadFailed =
    speechModelDownloadPhase === AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_PHASE.failed;
  const speechModelDownloadActive =
    speechModelDownloadPhase === AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_PHASE.started ||
    speechModelDownloadPhase === AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_DOWNLOAD_PHASE.downloading;
  const modelReady =
    activeSpeechTranscriptionProvider.kind !== 'local' ||
    speechSetupStatus?.model.ready === true ||
    speechModelDownloadCompleted;
  const readiness = (
    speechModelDownloadProgress &&
    !isAutoCutSpeechTranscriptionModelDownloadTerminalPhase(speechModelDownloadProgress.phase)
  )
    ? AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.downloading
    : speechSetupStatus?.readiness;
  const speechSetupStatusTone: 'green' | 'yellow' | 'red' =
    readiness === AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.ready
      ? 'green'
      : readiness === AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.needsExecutable ||
          readiness === AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.failed
        ? 'red'
        : 'yellow';
  const speechSetupStatusLabel = readiness === AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.downloading
    ? t('settings.speech.setupStatus.downloading')
    : t(`settings.speech.setupStatus.${readiness ?? 'checking'}`);
  const speechReadinessDescriptionKey = {
    ready: 'settings.speech.readyDescription',
    downloading: 'settings.speech.downloadingDescription',
    'needs-executable': 'settings.speech.needsExecutableDescription',
    'needs-model': 'settings.speech.needsModelDescription',
    'needs-test': 'settings.speech.needsTestDescription',
    unsupported: 'settings.speech.unsupportedDescription',
    failed: 'settings.speech.failedDescription',
    checking: 'settings.speech.checkingDescription',
  } satisfies Record<AutoCutLocalSpeechTranscriptionSetupReadiness | 'checking', string>;
  const speechReadinessDescription = speechModelDownloadCompleted && readiness !== AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.ready
    ? t('settings.speech.modelSavedNeedsCheckDescription')
    : speechModelDownloadFailed
      ? t('settings.speech.modelDownloadFailedDescription')
      : t(speechReadinessDescriptionKey[readiness ?? 'checking']);
  const downloadedBytes = speechModelDownloadProgress?.downloadedBytes ?? 0;
  const totalBytes = speechModelDownloadProgress?.totalBytes;
  const speechDownloadProgressPercent = speechModelDownloadCompleted
    ? 100
    : speechModelDownloadProgress?.progress ??
      (totalBytes && totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0);
  const speechExecutablePath = speechSetupStatus?.executable.path ||
    settings.speechTranscription.executablePath ||
    speechSetupStatus?.defaults.executablePath ||
    '';
  const speechModelPath = speechSetupStatus?.model.path ||
    settings.speechTranscription.modelPath ||
    speechSetupStatus?.defaults.modelPath ||
    '';
  const speechDisplayExecutablePath = formatAutoCutSpeechSetupPath(speechExecutablePath) ||
    t('settings.speech.setupStatus.executableMissing');
  const speechDisplayModelPath = formatAutoCutSpeechSetupPath(speechModelPath) ||
    t('settings.speech.setupStatus.modelMissing');
  const normalizedSpeechModelPath = normalizeSettingsLocalPath(settings.speechTranscription.modelPath || speechSetupStatus?.model.path || '');
  const normalizedDefaultSpeechModelDirectory = normalizeSettingsLocalPath(speechSetupStatus?.defaults.modelDirectory ?? '');
  const speechDownloadProgressLabel = speechModelDownloadCompleted
    ? t('settings.speech.modelDownloadCompleted')
    : speechModelDownloadFailed
      ? t('settings.speech.modelDownloadNeedsRetry')
      : speechModelDownloadActive
        ? t('settings.speech.modelDownloadActive')
        : t('settings.speech.downloadProgress', {
          downloaded: formatAutoCutByteCount(downloadedBytes),
          total: totalBytes ? formatAutoCutByteCount(totalBytes) : t('settings.speech.setupStatus.unknownSize'),
        });
  const speechSetupChecklist = [
    {
      id: 'executableReady',
      ready: executableReady,
      label: t('settings.speech.setup.executableReady'),
    },
    {
      id: 'modelReady',
      ready: modelReady,
      label: t('settings.speech.setup.modelReady'),
    },
    {
      id: 'testReady',
      ready: testReady,
      label: t('settings.speech.setup.testReady'),
    },
  ] as const;
  const storageUsagePercent = Math.min(100, (settings.storage.usedGb / settings.storage.quotaGb) * 100);

  return (
    <div className="h-full w-full overflow-y-auto bg-[#050505] p-6 text-gray-200 md:p-10">
      <div className="w-full space-y-8">
        <header className="flex flex-col gap-4 border-b border-[#151515] pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-3xl font-extrabold tracking-normal text-white">{t('settings.page.title')}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-400">{t('settings.page.description')}</p>
          </div>
          <div className="flex min-w-[220px] flex-col gap-2">
            <FieldLabel>{t('settings.field.language')}</FieldLabel>
            <select
              value={settings.workspace.language}
              onChange={(event) => handleWorkspaceLanguageChange(event.target.value)}
              className="h-10 rounded-md border border-[#333] bg-[#111] px-3 text-sm text-gray-200 outline-none transition-colors focus:border-blue-500"
            >
              {AUTOCUT_SETTINGS_LOCALE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </option>
              ))}
            </select>
          </div>
        </header>

        <div className="flex flex-col gap-8 md:flex-row">
          <nav className="w-full shrink-0 space-y-1 md:w-72">
            {AUTOCUT_SETTINGS_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTabChange(tab.id)}
                className={`flex min-h-14 w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-all ${
                  activeTab === tab.id
                    ? 'border-blue-500/20 bg-blue-600/10 text-blue-400'
                    : 'border-transparent text-gray-400 hover:bg-[#111] hover:text-gray-200'
                }`}
              >
                {AUTOCUT_SETTINGS_ICON[tab.icon]}
                <span className="min-w-0">
                  <span className="block font-medium">{t(tab.labelKey)}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-gray-500">{t(tab.descriptionKey)}</span>
                </span>
              </button>
            ))}
          </nav>

          <main className="min-w-0 flex-1 space-y-6">
            <div className="min-h-10">
              <h2 className="text-xl font-semibold text-white">{t(activeTabDefinition.labelKey)}</h2>
              <p className="mt-1 text-sm text-gray-500">{t(activeTabDefinition.descriptionKey)}</p>
            </div>

            {activeTab === 'account' && (
              <Card className="border-[#222] bg-[#0A0A0A] p-6 md:p-8">
                <div className="space-y-6">
                  <SectionTitle title={t('settings.section.accountProfile')} />
                  <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-2 border-[#333] bg-gradient-to-br from-blue-500 to-indigo-600 text-2xl font-bold text-white shadow-lg">
                      {getAutoCutAccountInitials(settings.account.displayName)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-xl font-bold text-gray-100">{settings.account.displayName}</h4>
                        <StatusBadge tone="yellow">{t('settings.status.pro')}</StatusBadge>
                      </div>
                      <p className="mt-1 text-sm text-gray-500">{settings.account.email}</p>
                      <Button onClick={handleChangeAvatar} size="sm" variant="outline" className="mt-3 border-[#333] text-xs">
                        {t('settings.action.changeAvatar')}
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    <div className="space-y-2">
                      <FieldLabel>{t('settings.field.displayName')}</FieldLabel>
                      <input
                        type="text"
                        value={settings.account.displayName}
                        onChange={(event) => setSettings({
                          ...settings,
                          account: { ...settings.account, displayName: event.target.value },
                        })}
                        className="h-10 w-full rounded-md border border-[#333] bg-[#111] px-3 text-sm text-gray-200 outline-none transition-colors focus:border-blue-500"
                      />
                    </div>
                    <div className="space-y-2">
                      <FieldLabel>{t('settings.field.email')}</FieldLabel>
                      <input
                        type="email"
                        value={settings.account.email}
                        onChange={(event) => setSettings({
                          ...settings,
                          account: { ...settings.account, email: event.target.value },
                        })}
                        className="h-10 w-full rounded-md border border-[#333] bg-[#111] px-3 text-sm text-gray-200 outline-none transition-colors focus:border-blue-500"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button onClick={handleSaveAccount} className="bg-blue-600 text-white hover:bg-blue-500">
                      <Check size={16} />
                      {t('settings.action.saveChanges')}
                    </Button>
                  </div>
                </div>
              </Card>
            )}

            {activeTab === 'workspace' && (
              <Card className="border-[#222] bg-[#0A0A0A] p-6 md:p-8">
                <div className="space-y-6">
                  <SectionTitle title={t('settings.section.workspacePreferences')} />
                  <SettingsRow
                    title={t('settings.field.defaultStoragePath')}
                    description={t('settings.help.defaultStoragePath')}
                  >
                    <Button onClick={handleChangeDirectory} variant="outline" size="sm" className="border-[#333]">
                      <FolderOpen size={16} />
                      {t('settings.action.changeDirectory')}
                    </Button>
                  </SettingsRow>
                  <SettingsRow
                    title={t('settings.field.outputDirectory')}
                    description={t('settings.help.outputDirectory')}
                  >
                    <div className="flex min-w-0 gap-3">
                      <input
                        type="text"
                        value={settings.workspace.outputDirectory}
                        onChange={(event) => setSettings({
                          ...settings,
                          workspace: { ...settings.workspace, outputDirectory: event.target.value },
                        })}
                        onBlur={handleSaveWorkspace}
                        className="h-10 min-w-0 flex-1 rounded-md border border-[#333] bg-[#111] px-3 text-sm text-gray-200 outline-none transition-colors focus:border-blue-500"
                      />
                      <Button onClick={handleChangeOutputDirectory} variant="outline" size="sm" className="shrink-0 border-[#333]">
                        <FolderOpen size={16} />
                        {t('settings.action.changeDirectory')}
                      </Button>
                    </div>
                  </SettingsRow>
                  <SettingsRow
                    title={t('settings.field.hardwareAcceleration')}
                    description={t('settings.help.hardwareAcceleration')}
                  >
                    <Toggle
                      checked={settings.workspace.hardwareAcceleration}
                      onChange={(checked) => handleWorkspacePreferenceChange({
                        ...settings.workspace,
                        hardwareAcceleration: checked,
                      })}
                    />
                  </SettingsRow>
                  <SettingsRow title={t('settings.field.completionSound')} description={t('settings.help.completionSound')}>
                    <Toggle
                      checked={settings.workspace.completionSound}
                      onChange={(checked) => handleWorkspacePreferenceChange({
                        ...settings.workspace,
                        completionSound: checked,
                      })}
                    />
                  </SettingsRow>
                  <SettingsRow title={t('settings.field.language')} description={t('settings.help.language')}>
                    <select
                      value={settings.workspace.language}
                      onChange={(event) => handleWorkspaceLanguageChange(event.target.value)}
                      onBlur={handleSaveWorkspace}
                      className="h-10 w-full rounded-md border border-[#333] bg-[#111] px-3 text-sm text-gray-200 outline-none transition-colors focus:border-blue-500 md:w-56"
                    >
                      {AUTOCUT_SETTINGS_LOCALE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {t(option.labelKey)}
                        </option>
                      ))}
                    </select>
                  </SettingsRow>
                </div>
              </Card>
            )}

            {activeTab === 'speech' && (
              <Card className="border-[#222] bg-[#0A0A0A] p-6 md:p-8">
                <div className="space-y-6">
                  <div className="flex flex-col gap-4 border-b border-[#222] pb-4 md:flex-row md:items-start md:justify-between">
                    <SectionTitle
                      title={t('settings.section.speechRuntime')}
                      description={t(activeSpeechTranscriptionProvider.descriptionKey)}
                    />
                    <StatusBadge tone={speechRuntimeReady ? 'green' : 'yellow'}>
                      {speechRuntimeReady ? t('settings.status.ready') : t('settings.status.required')}
                    </StatusBadge>
                  </div>
                  <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    <div className="space-y-2 md:col-span-2">
                      <FieldLabel>{t('settings.field.provider')}</FieldLabel>
                      <select
                        value={settings.speechTranscription.providerId}
                        onChange={(event) =>
                          handleSpeechTranscriptionProviderChange(event.target.value as AutoCutSpeechTranscriptionProviderId)}
                        className="h-10 w-full rounded-md border border-[#333] bg-[#111] px-3 text-sm text-gray-200 outline-none transition-colors focus:border-blue-500"
                      >
                        {AUTOCUT_SPEECH_TRANSCRIPTION_PROVIDER_DEFINITIONS.map((provider) => (
                          <option key={provider.id} value={provider.id}>
                            {t(provider.nameKey)}
                          </option>
                        ))}
                      </select>
                      <FieldHelp>{t(activeSpeechTranscriptionProvider.nameKey)}</FieldHelp>
                      <div className="grid gap-2 pt-2 text-xs text-gray-500 sm:grid-cols-3">
                        <div className="rounded-md border border-[#242424] bg-[#0b0b0b] px-3 py-2">
                          <span className="block text-[10px] font-semibold uppercase tracking-wide text-gray-600">Speaker diarization</span>
                          <span className={activeSpeechTranscriptionProvider.capabilities.supportsSpeakerDiarization ? 'text-emerald-300' : 'text-gray-400'}>
                            {activeSpeechTranscriptionProvider.capabilities.supportsSpeakerDiarization ? 'Supported' : 'Single-speaker adapter'}
                          </span>
                        </div>
                        <div className="rounded-md border border-[#242424] bg-[#0b0b0b] px-3 py-2">
                          <span className="block text-[10px] font-semibold uppercase tracking-wide text-gray-600">Word timestamps</span>
                          <span className={activeSpeechTranscriptionProvider.capabilities.supportsWords ? 'text-emerald-300' : 'text-gray-400'}>
                            {activeSpeechTranscriptionProvider.capabilities.supportsWords ? 'Supported' : 'Segment only'}
                          </span>
                        </div>
                        <div className="rounded-md border border-[#242424] bg-[#0b0b0b] px-3 py-2">
                          <span className="block text-[10px] font-semibold uppercase tracking-wide text-gray-600">Long video</span>
                          <span className={activeSpeechTranscriptionProvider.capabilities.preferredForLongForm ? 'text-emerald-300' : 'text-gray-400'}>
                            {activeSpeechTranscriptionProvider.capabilities.preferredForLongForm ? 'Recommended' : 'Privacy fallback'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {activeSpeechTranscriptionProvider.kind === 'local' && (
                      <>
                        <div className="space-y-4 rounded-md border border-[#222] bg-[#111] p-4 md:col-span-2">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <FieldLabel>{t('settings.speech.readinessTitle')}</FieldLabel>
                                <StatusBadge tone={speechSetupStatusTone}>{speechSetupStatusLabel}</StatusBadge>
                              </div>
                              <p className="mt-2 max-w-3xl text-xs leading-relaxed text-gray-400">{speechReadinessDescription}</p>
                              <div className="mt-3 grid gap-2 text-xs text-gray-500 sm:grid-cols-2">
                                <div className="rounded-md border border-[#242424] bg-[#0b0b0b] px-3 py-2">
                                  <span className="block text-[10px] font-semibold uppercase tracking-wide text-gray-600">
                                    {t('settings.speech.executableSource')}
                                  </span>
                                  <span className="mt-1 block truncate text-gray-300" title={speechExecutablePath}>
                                    {speechDisplayExecutablePath}
                                  </span>
                                </div>
                                <div className="rounded-md border border-[#242424] bg-[#0b0b0b] px-3 py-2">
                                  <span className="block text-[10px] font-semibold uppercase tracking-wide text-gray-600">
                                    {t('settings.speech.modelLocation')}
                                  </span>
                                  <span className="mt-1 block truncate text-gray-300" title={speechModelPath}>
                                    {speechDisplayModelPath}
                                  </span>
                                </div>
                                <div className={`rounded-md border px-3 py-2 ${
                                  speechSetupStatus?.gpu.ready
                                    ? 'border-emerald-500/20 bg-emerald-500/10'
                                    : 'border-[#242424] bg-[#0b0b0b]'
                                }`}>
                                  <span className="block text-[10px] font-semibold uppercase tracking-wide text-gray-600">
                                    GPU acceleration
                                  </span>
                                  <span className={`mt-1 block truncate text-xs ${
                                    speechSetupStatus?.gpu.ready ? 'text-emerald-300' : 'text-gray-400'
                                  }`}>
                                    {speechSetupStatus?.gpu.ready
                                      ? `Enabled / ${speechSetupStatus.gpu.backend ?? 'detected'}`
                                      : 'CPU runtime detected'}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <Button
                              onClick={handleInitializeSpeechTranscriptionSetup}
                              disabled={
                                isConfiguringSpeechModel ||
                                readiness === AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.ready ||
                                readiness === AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.downloading
                              }
                              className="bg-blue-600 text-white hover:bg-blue-500"
                            >
                              <Check size={16} />
                              {isConfiguringSpeechModel ? t('settings.speech.configuring') : t('settings.action.initializeSpeech')}
                            </Button>
                          </div>
                          <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
                            {speechSetupChecklist.map((item) => (
                              <div
                                key={item.id}
                                className={`flex min-h-11 items-center justify-between gap-3 rounded-md border px-3 py-2 ${
                                  item.ready
                                    ? 'border-green-500/20 bg-green-500/10 text-green-400'
                                    : 'border-yellow-500/20 bg-yellow-500/10 text-yellow-400'
                                }`}
                              >
                                <span className="min-w-0 text-xs font-medium">{item.label}</span>
                                <StatusBadge tone={item.ready ? 'green' : 'yellow'}>
                                  {item.ready ? t('settings.status.ready') : t('settings.status.required')}
                                </StatusBadge>
                              </div>
                            ))}
                          </div>
                          {speechModelDownloadProgress ? (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between gap-3 text-[11px] text-gray-500">
                                <span>{speechDownloadProgressLabel}</span>
                                <span className="font-mono">{speechDownloadProgressPercent}%</span>
                              </div>
                              <div className="h-2 w-full overflow-hidden rounded-full border border-[#222] bg-[#050505]">
                                <div
                                  className={`h-full min-w-[4px] rounded-full ${
                                    speechModelDownloadFailed
                                      ? 'bg-red-500'
                                      : speechModelDownloadCompleted
                                        ? 'bg-emerald-500'
                                        : 'bg-blue-500'
                                  }`}
                                  style={{ width: `${Math.max(4, Math.min(100, speechDownloadProgressPercent))}%` }}
                                />
                              </div>
                              {speechModelDownloadCompleted && readiness !== AUTOCUT_SPEECH_TRANSCRIPTION_SETUP_READINESS.ready ? (
                                <p className="text-[11px] leading-relaxed text-gray-500">
                                  {t('settings.speech.modelSavedNeedsCheckDescription')}
                                </p>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                        <div className="space-y-2 md:col-span-2">
                          <FieldLabel>{t('settings.field.executablePath')}</FieldLabel>
                          <div className="flex gap-3">
                            <input
                              type="text"
                              value={settings.speechTranscription.executablePath}
                              placeholder={speechSetupStatus?.defaults.executablePath || ''}
                              onChange={(event) => handleSpeechTranscriptionSettingsChange({
                                ...settings.speechTranscription,
                                executablePath: event.target.value,
                              })}
                              onBlur={handleSaveSpeechTranscriptionSettings}
                              className="h-10 min-w-0 flex-1 rounded-md border border-[#333] bg-[#111] px-3 text-sm text-gray-200 outline-none transition-colors focus:border-blue-500"
                            />
                            <Button onClick={() => handleSelectSpeechTranscriptionFile('executable')} variant="outline" className="border-[#333] text-white">
                              <FolderOpen size={16} />
                              {t('settings.action.browse')}
                            </Button>
                          </div>
                          <FieldHelp>{t('settings.speech.local.executableHelp')}</FieldHelp>
                          {speechSetupStatus?.defaults.executablePath ? (
                            <FieldHelp>{formatAutoCutSpeechSetupPath(speechSetupStatus.defaults.executablePath)}</FieldHelp>
                          ) : null}
                        </div>
                        <div className="space-y-2 md:col-span-2">
                          <FieldLabel>{t('settings.field.modelPath')}</FieldLabel>
                          <div className="flex gap-3">
                            <input
                              type="text"
                              value={settings.speechTranscription.modelPath}
                              onChange={(event) => handleSpeechTranscriptionSettingsChange({
                                ...settings.speechTranscription,
                                modelPath: event.target.value,
                              })}
                              onBlur={handleSaveSpeechTranscriptionSettings}
                              className="h-10 min-w-0 flex-1 rounded-md border border-[#333] bg-[#111] px-3 text-sm text-gray-200 outline-none transition-colors focus:border-blue-500"
                            />
                            <Button onClick={() => handleSelectSpeechTranscriptionFile('model')} variant="outline" className="border-[#333] text-white">
                              <FolderOpen size={16} />
                              {t('settings.action.browse')}
                            </Button>
                          </div>
                          <FieldHelp>
                            {t('settings.speech.local.modelHelp', {
                              extensions: AUTOCUT_SPEECH_TRANSCRIPTION_MODEL_EXTENSIONS.join(', '),
                            })}
                          </FieldHelp>
                          {speechSetupStatus?.defaults.modelPath ? (
                            <FieldHelp>{formatAutoCutSpeechSetupPath(speechSetupStatus.defaults.modelPath)}</FieldHelp>
                          ) : null}
                        </div>
                        <div className="space-y-3 md:col-span-2">
                          <div className="flex flex-col gap-1">
                            <FieldLabel>{t('settings.speech.modelCatalog')}</FieldLabel>
                            <FieldHelp>{t('settings.speech.modelCatalogHelp')}</FieldHelp>
                          </div>
                          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                            {activeSpeechTranscriptionModelPresets
                              .map((modelPreset) => {
                                const managedPresetPath = normalizedDefaultSpeechModelDirectory
                                  ? `${normalizedDefaultSpeechModelDirectory}/${modelPreset.fileName.toLowerCase()}`
                                  : '';
                                const modelPresetDownloaded = Boolean(
                                  normalizedSpeechModelPath &&
                                  (
                                    normalizedSpeechModelPath === managedPresetPath ||
                                    normalizedSpeechModelPath.endsWith(`/${modelPreset.fileName.toLowerCase()}`)
                                  ),
                                );
                                return (
                                  <div key={modelPreset.id} className="rounded-md border border-[#222] bg-[#111] p-3">
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0">
                                        <div className="truncate text-sm font-semibold text-gray-100">{modelPreset.label}</div>
                                        <div className="mt-1 text-[11px] text-gray-500">{modelPreset.sizeLabel} / {modelPreset.languageScope}</div>
                                      </div>
                                      <div className="flex shrink-0 flex-col items-end gap-1">
                                        {modelPresetDownloaded ? (
                                          <StatusBadge tone="green">{t('settings.status.downloaded')}</StatusBadge>
                                        ) : null}
                                        {modelPreset.recommended ? (
                                          <StatusBadge tone="green">{t('settings.status.recommended')}</StatusBadge>
                                        ) : null}
                                      </div>
                                    </div>
                                    <div className="mt-3 space-y-1 text-[11px] leading-relaxed text-gray-500">
                                      <div>{modelPreset.qualityLabel}</div>
                                      <div>{modelPreset.speedLabel}</div>
                                    </div>
                                    <div className="mt-3 flex flex-wrap gap-2">
                                      <Button
                                        onClick={() => handleSetupSpeechTranscriptionModelPreset(modelPreset.id)}
                                        disabled={isConfiguringSpeechModel}
                                        size="sm"
                                        className="h-8 bg-blue-600 text-white hover:bg-blue-500"
                                      >
                                        <Check size={14} />
                                        {isConfiguringSpeechModel ? t('settings.speech.configuring') : t('settings.action.useAndDownloadModel')}
                                      </Button>
                                      <Button
                                        onClick={() => handleDownloadSpeechTranscriptionModelPreset(modelPreset.id)}
                                        variant="outline"
                                        size="sm"
                                        className="h-8 border-[#333] text-gray-300"
                                      >
                                        <FolderOpen size={14} />
                                        {t('settings.action.downloadModel')}
                                      </Button>
                                      <Button
                                        onClick={() => handleCopySpeechTranscriptionModelPresetUrl(modelPreset.id)}
                                        variant="outline"
                                        size="sm"
                                        className="h-8 border-[#333] text-gray-400"
                                      >
                                        <Copy size={14} />
                                        {t('settings.action.copyLink')}
                                      </Button>
                                    </div>
                                  </div>
                                );
                              })}
                          </div>
                        </div>
                      </>
                    )}

                    {activeSpeechTranscriptionProvider.kind === 'api' && (
                      <>
                        <div className="space-y-2">
                          <FieldLabel>{t('settings.field.modelVendor')}</FieldLabel>
                          <div className="flex h-10 items-center rounded-md border border-[#333] bg-[#111] px-3 font-mono text-sm text-gray-400">
                            {settings.speechTranscription.modelVendor ?? activeSpeechTranscriptionProvider.modelVendor ?? 'custom'}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <FieldLabel>{t('settings.field.model')}</FieldLabel>
                          <input
                            type="text"
                            value={settings.speechTranscription.model ?? activeSpeechTranscriptionProvider.defaultModel ?? ''}
                            onChange={(event) => handleSpeechTranscriptionSettingsChange({
                              ...settings.speechTranscription,
                              model: event.target.value,
                            })}
                            onBlur={handleSaveSpeechTranscriptionSettings}
                            className="h-10 w-full rounded-md border border-[#333] bg-[#111] px-3 font-mono text-sm text-gray-200 outline-none transition-colors focus:border-blue-500"
                          />
                        </div>
                        <div className="space-y-2 md:col-span-2">
                          <FieldLabel>{t('settings.field.apiRuntime')}</FieldLabel>
                          <div className="flex min-h-10 items-center rounded-md border border-[#333] bg-[#111] px-3 py-2 text-xs leading-relaxed text-gray-500">
                            {t('settings.speech.api.runtimeHelp')}
                          </div>
                        </div>
                      </>
                    )}

                    <div className="space-y-2">
                      <FieldLabel>{t('settings.field.transcriptionLanguage')}</FieldLabel>
                      <select
                        value={settings.speechTranscription.language}
                        onChange={(event) => handleSpeechTranscriptionSettingsChange({
                          ...settings.speechTranscription,
                          language: event.target.value,
                        })}
                        onBlur={handleSaveSpeechTranscriptionSettings}
                        className="h-10 w-full rounded-md border border-[#333] bg-[#111] px-3 text-sm text-gray-200 outline-none transition-colors focus:border-blue-500"
                      >
                        {AUTOCUT_SPEECH_TRANSCRIPTION_LANGUAGE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <FieldLabel>{t('settings.field.lastTest')}</FieldLabel>
                      <div className="flex h-10 items-center rounded-md border border-[#333] bg-[#111] px-3 font-mono text-sm text-gray-500">
                        {settings.speechTranscription.lastTestedAt || t('settings.speech.notTested')}
                      </div>
                    </div>
                    {settings.speechTranscription.lastProbeDiagnostics?.length ? (
                      <div className="space-y-2 md:col-span-2">
                        <FieldLabel>{t('settings.speech.diagnostics')}</FieldLabel>
                        <div className="space-y-2 rounded-md border border-[#2a2a2a] bg-[#0b0b0b] p-3">
                          {settings.speechTranscription.lastProbeDiagnostics.map((diagnostic) => (
                            <div key={diagnostic} className="text-xs leading-relaxed text-gray-400">
                              {diagnostic}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap justify-end gap-3">
                    <Button
                      onClick={handleTestSpeechTranscriptionProvider}
                      disabled={isTestingSpeechTranscription}
                      variant="outline"
                      className="text-white"
                    >
                      <Play size={16} />
                      {isTestingSpeechTranscription ? t('settings.speech.testing') : t('settings.action.testProvider')}
                    </Button>
                    <Button onClick={handleSaveSpeechTranscriptionSettings} className="bg-blue-600 text-white hover:bg-blue-500">
                      <Check size={16} />
                      {t('settings.action.saveSpeech')}
                    </Button>
                  </div>
                </div>
              </Card>
            )}

            {activeTab === 'llm' && (
              <Card className="border-[#222] bg-[#0A0A0A] p-6 md:p-8">
                <div className="space-y-6">
                  <div className="flex flex-col gap-4 border-b border-[#222] pb-4 md:flex-row md:items-start md:justify-between">
                    <SectionTitle title={t('settings.section.llmRuntime')} description={t('settings.help.llmDescription')} />
                    <StatusBadge tone={settings.llm.apiKeyConfigured ? 'green' : 'yellow'}>
                      {settings.llm.apiKeyConfigured ? t('settings.status.keyReady') : t('settings.status.keyRequired')}
                    </StatusBadge>
                  </div>
                  <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    <div className="space-y-2">
                      <FieldLabel>{t('settings.field.modelVendor')}</FieldLabel>
                      <select
                        value={settings.llm.modelVendor}
                        onChange={(event) => handleLlmVendorChange(event.target.value as ModelVendor)}
                        className="h-10 w-full rounded-md border border-[#333] bg-[#111] px-3 text-sm text-gray-200 outline-none transition-colors focus:border-blue-500"
                      >
                        {Object.values(AUTOCUT_MODEL_VENDOR_PRESETS).map((preset) => (
                          <option key={preset.vendor} value={preset.vendor} title={t(preset.descriptionKey)}>
                            {t(preset.labelKey)}
                          </option>
                        ))}
                      </select>
                      <FieldHelp>{t(activeLlmVendorPreset.descriptionKey)}</FieldHelp>
                      <div className="flex flex-wrap gap-2 text-[11px] font-medium text-gray-500">
                        <span className="rounded border border-[#222] bg-[#111] px-2 py-1">
                          {t(`settings.llm.region.${activeLlmVendorPreset.region}`)}
                        </span>
                        <span className="rounded border border-[#222] bg-[#111] px-2 py-1">
                          {t('settings.llm.runtime.openAiCompatible')}
                        </span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <FieldLabel>{t('settings.field.model')}</FieldLabel>
                      <input
                        type="text"
                        value={settings.llm.model}
                        list="llm-model-options"
                        onChange={(event) => handleLlmSettingsChange({ ...settings.llm, model: event.target.value })}
                        onBlur={handleSaveLlmSettings}
                        className="h-10 w-full rounded-md border border-[#333] bg-[#111] px-3 text-sm text-gray-200 outline-none transition-colors focus:border-blue-500"
                      />
                      <datalist id="llm-model-options">
                        {AUTOCUT_MODEL_VENDOR_PRESETS[settings.llm.modelVendor].models.map((model) => (
                          <option key={model.id} value={model.id}>{model.label}</option>
                        ))}
                      </datalist>
                      <FieldHelp>
                        {t('settings.help.llmTokenLimits', {
                          contextTokens: formatAutoCutTokenCount(activeLlmModelPreset.contextWindowTokens),
                          maxTokens: formatAutoCutTokenCount(activeLlmModelPreset.maxOutputTokens),
                        })}
                      </FieldHelp>
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <FieldLabel>{t('settings.field.baseUrl')}</FieldLabel>
                      <input
                        type="url"
                        value={settings.llm.baseUrl}
                        onChange={(event) => handleLlmSettingsChange({ ...settings.llm, baseUrl: event.target.value })}
                        onBlur={handleSaveLlmSettings}
                        className="h-10 w-full rounded-md border border-[#333] bg-[#111] px-3 font-mono text-sm text-gray-200 outline-none transition-colors focus:border-blue-500"
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <FieldLabel>{t('settings.field.apiKey')}</FieldLabel>
                      <input
                        type="password"
                        value={settings.llm.apiKey ?? ''}
                        placeholder={settings.llm.maskedApiKey || t('settings.help.llmApiKeyPlaceholder')}
                        onChange={(event) => handleLlmSettingsChange({ ...settings.llm, apiKey: event.target.value })}
                        onBlur={handleSaveLlmSettings}
                        className="h-10 w-full rounded-md border border-[#333] bg-[#111] px-3 font-mono text-sm text-gray-200 outline-none transition-colors focus:border-blue-500"
                      />
                      <div className="flex min-h-10 items-center rounded border border-[#222] bg-[#111] p-2.5 font-mono text-xs text-gray-500">
                        {settings.llm.maskedApiKey || t('settings.help.llmMaskedKeyEmpty')}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <FieldLabel>{t('settings.field.temperature')}</FieldLabel>
                      <input
                        type="number"
                        min={activeLlmModelPreset.temperature.min}
                        max={activeLlmModelPreset.temperature.max}
                        step={activeLlmModelPreset.temperature.step}
                        value={settings.llm.temperature}
                        onChange={(event) => handleLlmSettingsChange({
                          ...settings.llm,
                          temperature: Number(event.target.value),
                        })}
                        onBlur={handleSaveLlmSettings}
                        className="h-10 w-full rounded-md border border-[#333] bg-[#111] px-3 text-sm text-gray-200 outline-none transition-colors focus:border-blue-500"
                      />
                    </div>
                    <div className="space-y-2">
                      <FieldLabel>{t('settings.field.maxTokens')}</FieldLabel>
                      <input
                        type="number"
                        min={activeLlmModelPreset.minOutputTokens}
                        max={activeLlmModelPreset.maxOutputTokens}
                        step={256}
                        value={settings.llm.maxTokens}
                        onChange={(event) => handleLlmSettingsChange({
                          ...settings.llm,
                          maxTokens: Number(event.target.value),
                        })}
                        onBlur={handleSaveLlmSettings}
                        className="h-10 w-full rounded-md border border-[#333] bg-[#111] px-3 text-sm text-gray-200 outline-none transition-colors focus:border-blue-500"
                      />
                      <FieldHelp>
                        {t('settings.help.llmMaxTokenHelp', {
                          defaultTokens: formatAutoCutTokenCount(activeLlmModelPreset.defaultMaxTokens),
                          maxTokens: formatAutoCutTokenCount(activeLlmModelPreset.maxOutputTokens),
                        })}
                      </FieldHelp>
                    </div>
                    <div className="space-y-3 md:col-span-2" data-settings-llm-segmentation-agent="settings.llm.segmentationAgent">
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,260px)_1fr]">
                        <div className="space-y-2">
                          <FieldLabel>{t('settings.llm.defaultSegmentationAgent')}</FieldLabel>
                          <select
                            value={settings.llm.defaultSegmentationAgentId}
                            onChange={(event) => handleLlmSettingsChange({
                              ...settings.llm,
                              defaultSegmentationAgentId: event.target.value as AutoCutSmartSliceSegmentationAgentId,
                            })}
                            onBlur={handleSaveLlmSettings}
                            className="h-10 w-full rounded-md border border-[#333] bg-[#111] px-3 text-sm text-gray-200 outline-none transition-colors focus:border-blue-500"
                          >
                            {AUTOCUT_SMART_SLICE_SEGMENTATION_AGENTS.map((agent) => (
                              <option key={agent.id} value={agent.id}>{agent.label}</option>
                            ))}
                          </select>
                          <FieldHelp>{t('settings.llm.segmentationAgentDescription')}</FieldHelp>
                        </div>
                        <div className="rounded-lg border border-[#222] bg-[#111] p-3">
                          <div className="text-xs font-semibold text-gray-200">{selectedLlmSegmentationAgent.label}</div>
                          <div className="mt-1 text-xs leading-relaxed text-gray-500">{selectedLlmSegmentationAgent.description}</div>
                          <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap rounded border border-[#222] bg-[#090909] p-3 font-mono text-[11px] leading-5 text-gray-500">
                            {selectedLlmSegmentationAgent.systemPrompt}
                          </pre>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                        {AUTOCUT_SMART_SLICE_SEGMENTATION_AGENTS.map((agent) => (
                          <div
                            key={agent.id}
                            className={`rounded-lg border p-3 ${
                              agent.id === settings.llm.defaultSegmentationAgentId
                                ? 'border-blue-500/40 bg-blue-500/10'
                                : 'border-[#222] bg-[#0D0D0D]'
                            }`}
                          >
                            <div className="text-xs font-semibold text-gray-200">{agent.label}</div>
                            <div className="mt-1 text-[11px] leading-4 text-gray-500">{agent.description}</div>
                            <div className="mt-3 text-[10px] font-bold uppercase tracking-wider text-gray-600">
                              {t('settings.llm.agentSystemPrompt')}
                            </div>
                            <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap rounded border border-[#222] bg-[#090909] p-2 font-mono text-[10px] leading-4 text-gray-500">
                              {agent.systemPrompt}
                            </pre>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-3">
                    <Button onClick={handleTestLlmConnection} disabled={isTestingLlmConnection} variant="outline" className="text-white">
                      <Play size={16} />
                      {isTestingLlmConnection ? t('settings.speech.testing') : t('settings.action.testConnection')}
                    </Button>
                    <Button onClick={handleSaveLlmSettings} className="bg-blue-600 text-white hover:bg-blue-500">
                      <Check size={16} />
                      {t('settings.action.saveLlm')}
                    </Button>
                  </div>
                </div>
              </Card>
            )}

            {activeTab === 'api' && (
              <Card className="border-[#222] bg-[#0A0A0A] p-6 md:p-8">
                <div className="space-y-6">
                  <div className="flex flex-col gap-4 border-b border-[#222] pb-4 sm:flex-row sm:items-center sm:justify-between">
                    <SectionTitle title={t('settings.section.apiKeys')} description={t('settings.help.apiKeys')} />
                    <Button onClick={handleCreateApiKey} size="sm" className="bg-blue-600 text-white hover:bg-blue-500">
                      <Key size={16} />
                      {t('settings.action.createApiKey')}
                    </Button>
                  </div>
                  <div className="space-y-4">
                    {settings.apiKeys.map((apiKey) => (
                      <div key={apiKey.id} className="rounded-lg border border-[#222] bg-[#0A0A0A] p-4 transition-colors hover:border-[#333]">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <h4 className="font-medium text-gray-200">{apiKey.name}</h4>
                            <p className="mt-1 text-xs text-gray-500">
                              {apiKey.createdAt}{apiKey.revokedAt ? ` / ${apiKey.revokedAt}` : ''}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <Button onClick={() => handleCopyApiKey(apiKey.maskedKey)} variant="outline" size="sm" className="h-8 border-[#333] text-gray-400">
                              <Copy size={14} />
                              {t('settings.action.copy')}
                            </Button>
                            <Button onClick={() => handleRevokeApiKey(apiKey.id)} variant="outline" size="sm" className="h-8 border-[#333] text-red-500">
                              <RotateCcw size={14} />
                              {t('settings.action.revoke')}
                            </Button>
                          </div>
                        </div>
                        <div className="mt-4 flex items-center rounded border border-[#222] bg-[#111] p-2.5 font-mono text-sm text-gray-400">
                          {apiKey.maskedKey}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            )}

            {activeTab === 'billing' && (
              <div className="space-y-6">
                <Card className="overflow-hidden border border-yellow-500/30 bg-[#0A0A0A]">
                  <div className="space-y-8 p-6 md:p-8">
                    <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <CreditCard size={22} className="text-yellow-500" />
                          <h3 className="text-2xl font-bold text-white">{settings.billing.planName}</h3>
                        </div>
                        <p className="mt-2 text-sm text-gray-400">{t('settings.help.billingDescription')}</p>
                      </div>
                      <div className="text-left md:text-right">
                        <div className="text-3xl font-extrabold text-white">
                          ${settings.billing.monthlyPrice}
                          <span className="text-sm font-medium text-gray-400">/mo</span>
                        </div>
                        <p className="mt-1 text-xs text-gray-500">
                          {t('settings.help.nextBillingDate', { date: settings.billing.nextBillingDate })}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col gap-3 border-t border-[#222] pt-6 sm:flex-row sm:items-center sm:justify-between">
                      <button
                        type="button"
                        onClick={handleCancelSubscription}
                        className="text-left text-sm text-gray-400 underline underline-offset-4 hover:text-white"
                      >
                        {t('settings.action.cancelSubscription')}
                      </button>
                      <Button onClick={handleManageSubscription} className="bg-yellow-500 font-semibold text-black hover:bg-yellow-400">
                        {t('settings.action.manageSubscription')}
                      </Button>
                    </div>
                  </div>
                </Card>
                <Card className="border-[#222] bg-[#0A0A0A] p-6 md:p-8">
                  <div className="space-y-6">
                    <SectionTitle title={t('settings.section.billingHistory')} />
                    <div className="space-y-3">
                      {Array.from({ length: settings.billing.invoicesLoaded }).map((_, index) => (
                        <div key={index} className="grid grid-cols-2 gap-3 border-b border-[#222] py-3 text-sm md:grid-cols-4">
                          <div className="text-gray-300"><span>{settings.billing.nextBillingDate}</span></div>
                          <div className="text-gray-400">
                            {t('settings.help.invoicePlan', { planName: settings.billing.planName })}
                          </div>
                          <div className="font-medium text-gray-200">${settings.billing.monthlyPrice}.00</div>
                          <div className="text-green-500">{t('settings.status.paid')}</div>
                        </div>
                      ))}
                    </div>
                    <Button onClick={handleLoadMoreInvoices} variant="outline" className="w-full border-[#333] text-gray-400">
                      {t('settings.action.loadMore')}
                    </Button>
                  </div>
                </Card>
              </div>
            )}

            {activeTab === 'storage' && (
              <Card className="border-[#222] bg-[#0A0A0A] p-6 md:p-8">
                <div className="space-y-6">
                  <SectionTitle title={t('settings.section.storageUsage')} />
                  <div className="flex flex-col gap-8 md:flex-row md:items-center">
                    <div className="w-full md:w-1/3">
                      <div className="text-4xl font-extrabold text-blue-500">
                        {settings.storage.usedGb}
                        <span className="ml-2 text-lg font-medium text-gray-500">GB</span>
                      </div>
                      <p className="mt-2 text-sm text-gray-400">{t('settings.storage.used')}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        {t('settings.help.storageQuota', { quotaGb: settings.storage.quotaGb })}
                      </p>
                    </div>
                    <div className="w-full space-y-4 md:w-2/3">
                      <div className="h-3 w-full overflow-hidden rounded-full border border-[#222] bg-[#111]">
                        <div
                          className="h-full min-w-[4px] rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.6)]"
                          style={{ width: `${storageUsagePercent}%` }}
                        />
                      </div>
                      <div className="grid grid-cols-1 gap-3 text-xs text-gray-500 sm:grid-cols-3">
                        <span>{t('settings.storage.video')} ({settings.storage.videoGb}GB)</span>
                        <span>{t('settings.storage.document')} ({settings.storage.documentGb}GB)</span>
                        <span>{t('settings.storage.cache')} ({settings.storage.cacheGb}GB)</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col gap-4 rounded-lg border border-[#222] bg-[#111] p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm leading-relaxed text-gray-400">
                      {t('settings.help.storageCache', { cachedItems: settings.storage.cachedItems })}
                      <span className="sr-only">{settings.storage.cachedItems}</span>
                    </div>
                    <Button onClick={handleClearCache} className="border border-red-500/20 bg-red-500/10 text-red-500 hover:bg-red-500/20">
                      <Trash2 size={16} />
                      {t('settings.action.clearCache')}
                    </Button>
                  </div>
                </div>
              </Card>
            )}

            {activeTab === 'notifications' && (
              <Card className="border-[#222] bg-[#0A0A0A] p-6 md:p-8">
                <div className="space-y-6">
                  <SectionTitle title={t('settings.section.notificationSystem')} />
                  {AUTOCUT_NOTIFICATION_FIELDS.map(({ key, labelKey }) => (
                    <SettingsRow key={key} title={t(labelKey)}>
                      <Toggle
                        checked={settings.notifications[key]}
                        onChange={(checked) => handleNotificationPreferenceChange({
                          ...settings.notifications,
                          [key]: checked,
                        })}
                      />
                    </SettingsRow>
                  ))}
                  <div className="flex justify-end">
                    <Button onClick={handleSaveNotifications} className="bg-blue-600 text-white hover:bg-blue-500">
                      <Check size={16} />
                      {t('settings.action.saveChanges')}
                    </Button>
                  </div>
                </div>
              </Card>
            )}

            {activeTab === 'security' && (
              <Card className="border-[#222] bg-[#0A0A0A] p-6 md:p-8">
                <div className="space-y-6">
                  <SectionTitle title={t('settings.section.securityManagement')} />
                  <SettingsRow title={t('settings.field.updatePassword')} description={t('settings.help.password')}>
                    <Button onClick={handleChangePassword} variant="outline" size="sm" className="border-[#333]">
                      {t('settings.action.changePassword')}
                    </Button>
                  </SettingsRow>
                  <SettingsRow
                    title={
                      <span className="inline-flex items-center gap-2">
                        {t('settings.field.twoFactor')}
                        <StatusBadge tone={settings.security.twoFactorEnabled ? 'green' : 'red'}>
                          {settings.security.twoFactorEnabled ? t('settings.status.enabled') : t('settings.status.disabled')}
                        </StatusBadge>
                      </span>
                    }
                    description={t('settings.help.twoFactor')}
                  >
                    <Button onClick={handleToggleTwoFactor} size="sm" className="bg-[#222] text-white hover:bg-[#333]">
                      {t('settings.action.setupTwoFactor')}
                    </Button>
                  </SettingsRow>
                  <SettingsRow title={t('settings.field.activeSessions')} description={t('settings.help.activeSessions')}>
                    <Button onClick={handleRevokeSessions} variant="outline" size="sm" className="border-[#333] text-red-500">
                      {t('settings.action.revokeSessions')}
                    </Button>
                  </SettingsRow>
                  <div className="border-t border-red-500/20 pt-6">
                    <h4 className="font-bold text-red-500">{t('settings.section.dangerZone')}</h4>
                    <p className="mt-2 text-xs leading-relaxed text-gray-500">{t('settings.help.danger')}</p>
                    <Button onClick={handleDeleteAccount} className="mt-4 bg-red-600 font-semibold text-white hover:bg-red-500">
                      <Trash2 size={16} />
                      {t('settings.action.deleteAccount')}
                    </Button>
                  </div>
                </div>
              </Card>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
