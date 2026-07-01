import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Copy, Loader2, ScanSearch, Settings2, ShieldCheck } from 'lucide-react';
import {
  AUTOCUT_VIDEO_DEDUP_STRATEGIES,
  analyzeAutoCutVideoDedup,
  createDefaultAutoCutVideoDedupParams,
  getAssets,
} from '@sdkwork/autocut-services';
import type {
  AppAsset,
  VideoDedupActionMode,
  VideoDedupMode,
  VideoDedupParams,
  VideoDedupReport,
  VideoDedupSensitivity,
  VideoDedupStrategyId,
} from '@sdkwork/autocut-types';
import { Button } from './Button';
import { useAutoCutTranslation } from './useAutoCutTranslation';

export interface VideoDedupWorkbenchProps {
  title?: string;
  compact?: boolean;
  initialParams?: Partial<VideoDedupParams>;
  sourceAssetIds?: string[];
  analysisDisabledReason?: string | undefined;
  onParamsChange?: (params: VideoDedupParams) => void;
  onReportReady?: (report: VideoDedupReport) => void;
}

function formatVideoDedupBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatVideoDedupPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function buildVideoDedupParams(initialParams: Partial<VideoDedupParams> | undefined, sourceAssetIds: string[] | undefined) {
  return createDefaultAutoCutVideoDedupParams({
    ...initialParams,
    ...(sourceAssetIds ? { sourceAssetIds } : {}),
  });
}

function resolveVideoDedupAssetName(assetById: ReadonlyMap<string, AppAsset>, assetId: string) {
  return assetById.get(assetId)?.name ?? assetId;
}

export function VideoDedupWorkbench({
  title,
  compact = false,
  initialParams,
  sourceAssetIds,
  analysisDisabledReason,
  onParamsChange,
  onReportReady,
}: VideoDedupWorkbenchProps) {
  const { t } = useAutoCutTranslation();
  const [assets, setAssets] = useState<AppAsset[]>([]);
  const [params, setParams] = useState<VideoDedupParams>(() => buildVideoDedupParams(initialParams, sourceAssetIds));
  const [report, setReport] = useState<VideoDedupReport | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const resolvedTitle = title ?? t('videoDedup.title');

  const VIDEO_DEDUP_MODES: { id: VideoDedupMode; label: string; detail: string }[] = [
    { id: 'quick-scan', label: t('videoDedup.modes.quick-scan.label'), detail: t('videoDedup.modes.quick-scan.detail') },
    { id: 'standard', label: t('videoDedup.modes.standard.label'), detail: t('videoDedup.modes.standard.detail') },
    { id: 'deep-audit', label: t('videoDedup.modes.deep-audit.label'), detail: t('videoDedup.modes.deep-audit.detail') },
    { id: 'publish-risk', label: t('videoDedup.modes.publish-risk.label'), detail: t('videoDedup.modes.publish-risk.detail') },
    { id: 'slice-result-dedup', label: t('videoDedup.modes.slice-result-dedup.label'), detail: t('videoDedup.modes.slice-result-dedup.detail') },
    { id: 'library-monitor', label: t('videoDedup.modes.library-monitor.label'), detail: t('videoDedup.modes.library-monitor.detail') },
  ];

  const VIDEO_DEDUP_SENSITIVITIES: { id: VideoDedupSensitivity; label: string }[] = [
    { id: 'low', label: t('videoDedup.sensitivities.low') },
    { id: 'balanced', label: t('videoDedup.sensitivities.balanced') },
    { id: 'high', label: t('videoDedup.sensitivities.high') },
    { id: 'forensic', label: t('videoDedup.sensitivities.forensic') },
  ];

  const VIDEO_DEDUP_ACTION_MODES: { id: VideoDedupActionMode; label: string }[] = [
    { id: 'report-only', label: t('videoDedup.actionModes.report-only') },
    { id: 'review-before-action', label: t('videoDedup.actionModes.review-before-action') },
    { id: 'archive-duplicates', label: t('videoDedup.actionModes.archive-duplicates') },
  ];

  useEffect(() => {
    let active = true;
    getAssets()
      .then((items) => {
        if (active) {
          setAssets(items.filter((asset) => asset.type === 'video'));
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setErrorMessage(error instanceof Error ? error.message : t('videoDedup.failedToLoadAssets'));
        }
      });
    return () => {
      active = false;
    };
  }, [t]);

  useEffect(() => {
    if (!Array.isArray(sourceAssetIds)) {
      return;
    }
    updateParams({ sourceAssetIds });
  }, [sourceAssetIds?.join('|')]);

  const onParamsChangeRef = useRef(onParamsChange);
  onParamsChangeRef.current = onParamsChange;

  useEffect(() => {
    onParamsChangeRef.current?.(params);
  }, [params]);

  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const sourceAssetSelectionLocked = Array.isArray(sourceAssetIds);
  const selectedAssetCount = sourceAssetSelectionLocked
    ? params.sourceAssetIds.length
    : params.sourceAssetIds.length || assets.length;
  const selectedMode = VIDEO_DEDUP_MODES.find((mode) => mode.id === params.mode) ?? VIDEO_DEDUP_MODES[1];
  const canRunAnalysis = !analysisDisabledReason && params.strategies.length > 0 && selectedAssetCount >= 1;

  function updateParams(patch: Partial<VideoDedupParams>) {
    setParams((current) => createDefaultAutoCutVideoDedupParams({ ...current, ...patch }));
  }

  function toggleStrategy(strategyId: VideoDedupStrategyId) {
    const nextStrategies = params.strategies.includes(strategyId)
      ? params.strategies.filter((id) => id !== strategyId)
      : [...params.strategies, strategyId];
    updateParams({
      strategies: nextStrategies.length ? nextStrategies : [strategyId],
    });
  }

  function toggleAsset(assetId: string) {
    if (sourceAssetSelectionLocked) {
      return;
    }
    const selectedIds = new Set(params.sourceAssetIds);
    if (selectedIds.has(assetId)) {
      selectedIds.delete(assetId);
    } else {
      selectedIds.add(assetId);
    }
    updateParams({ sourceAssetIds: [...selectedIds] });
  }

  async function runDedupAnalysis() {
    if (analysisDisabledReason) {
      setErrorMessage(analysisDisabledReason);
      return;
    }
    setIsRunning(true);
    setErrorMessage('');
    try {
      const nextReport = await analyzeAutoCutVideoDedup(params);
      setReport(nextReport);
      onReportReady?.(nextReport);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t('videoDedup.analysisFailed'));
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <section className={`rounded-lg border border-[#262626] bg-[#101010] ${compact ? 'p-3' : 'p-5'}`}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-bold text-gray-100">
            <Copy size={16} className="text-amber-300" />
            {resolvedTitle}
          </div>
          <div className="mt-1 max-w-3xl text-xs leading-5 text-gray-500">
            {t('videoDedup.description')}
          </div>
        </div>
        <Button
          type="button"
          onClick={runDedupAnalysis}
          disabled={isRunning || !canRunAnalysis}
          className="shrink-0 gap-2"
          variant="secondary"
        >
          {isRunning ? <Loader2 size={14} className="animate-spin" /> : <ScanSearch size={14} />}
          {isRunning ? t('videoDedup.buttonAnalyzing') : analysisDisabledReason ? t('videoDedup.buttonConfigured') : t('videoDedup.buttonRun')}
        </Button>
      </div>

      <div className={`mt-4 grid gap-3 ${compact ? 'grid-cols-1' : 'grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]'}`}>
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{t('videoDedup.mode')}</span>
              <select
                value={params.mode}
                onChange={(event) => updateParams({ mode: event.target.value as VideoDedupMode })}
                className="w-full rounded-lg border border-[#303030] bg-[#141414] px-3 py-2 text-xs text-gray-200 outline-none focus:border-amber-500"
              >
                {VIDEO_DEDUP_MODES.map((mode) => (
                  <option key={mode.id} value={mode.id}>{mode.label}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{t('videoDedup.sensitivity')}</span>
              <select
                value={params.sensitivity}
                onChange={(event) => updateParams({ sensitivity: event.target.value as VideoDedupSensitivity })}
                className="w-full rounded-lg border border-[#303030] bg-[#141414] px-3 py-2 text-xs text-gray-200 outline-none focus:border-amber-500"
              >
                {VIDEO_DEDUP_SENSITIVITIES.map((sensitivity) => (
                  <option key={sensitivity.id} value={sensitivity.id}>{sensitivity.label}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{t('videoDedup.action')}</span>
              <select
                value={params.actionMode}
                onChange={(event) => updateParams({ actionMode: event.target.value as VideoDedupActionMode })}
                className="w-full rounded-lg border border-[#303030] bg-[#141414] px-3 py-2 text-xs text-gray-200 outline-none focus:border-amber-500"
              >
                {VIDEO_DEDUP_ACTION_MODES.map((action) => (
                  <option key={action.id} value={action.id}>{action.label}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="rounded-lg border border-[#252525] bg-[#141414] p-3">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-gray-400">
              <Settings2 size={13} />
              {t('videoDedup.dedupMethods')}
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {AUTOCUT_VIDEO_DEDUP_STRATEGIES.map((strategy) => {
                const enabled = params.strategies.includes(strategy.id);
                const strategyName = t(`videoDedup.strategies.${strategy.id}.name`);
                const strategyDescription = t(`videoDedup.strategies.${strategy.id}.description`);
                return (
                  <button
                    type="button"
                    key={strategy.id}
                    onClick={() => toggleStrategy(strategy.id)}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      enabled
                        ? 'border-amber-500/40 bg-amber-500/10 text-amber-100'
                        : 'border-[#303030] bg-[#101010] text-gray-400 hover:border-[#444] hover:text-gray-200'
                    }`}
                    aria-pressed={enabled}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold">{strategyName}</span>
                      {enabled ? <CheckCircle2 size={14} className="text-amber-300" /> : null}
                    </div>
                    <div className="mt-1 text-[10px] leading-4 text-gray-500">{strategyDescription}</div>
                    <div className="mt-2 text-[9px] font-bold uppercase tracking-wider text-gray-600">
                      {strategy.evidenceKind} / {strategy.runtimeCost}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{t('videoDedup.minimumMatch')}</span>
              <input
                type="number"
                min={1}
                max={600}
                value={Math.round(params.minMatchDurationMs / 1000)}
                onChange={(event) => updateParams({ minMatchDurationMs: Math.max(1, Number(event.target.value) || 8) * 1000 })}
                className="w-full rounded-lg border border-[#303030] bg-[#141414] px-3 py-2 text-xs text-gray-200 outline-none focus:border-amber-500"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{t('videoDedup.introOutroMax')}</span>
              <input
                type="number"
                min={0}
                max={120}
                value={Math.round(params.introOutroMaxDurationMs / 1000)}
                onChange={(event) => updateParams({ introOutroMaxDurationMs: Math.max(0, Number(event.target.value) || 0) * 1000 })}
                className="w-full rounded-lg border border-[#303030] bg-[#141414] px-3 py-2 text-xs text-gray-200 outline-none focus:border-amber-500"
              />
            </label>
            <button
              type="button"
              onClick={() => updateParams({ ignoreIntroOutro: !params.ignoreIntroOutro })}
              className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                params.ignoreIntroOutro
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
                  : 'border-[#303030] bg-[#141414] text-gray-400'
              }`}
              aria-pressed={params.ignoreIntroOutro}
            >
              {t('videoDedup.ignoreIntroOutro')}
              <ShieldCheck size={14} />
            </button>
          </div>

          {!sourceAssetSelectionLocked ? (
            <div className="rounded-lg border border-[#252525] bg-[#141414] p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400">{t('videoDedup.sourceVideos')}</div>
                <div className="text-[10px] text-gray-500">{t('videoDedup.selectedCount', { count: selectedAssetCount })}</div>
              </div>
              <div className="mt-3 max-h-44 space-y-1 overflow-auto pr-1">
                {assets.length ? assets.map((asset) => {
                  const selected = !params.sourceAssetIds.length || params.sourceAssetIds.includes(asset.id);
                  return (
                    <button
                      type="button"
                      key={asset.id}
                      onClick={() => toggleAsset(asset.id)}
                      className={`flex w-full items-center justify-between gap-3 rounded border px-3 py-2 text-left text-xs ${
                        selected
                          ? 'border-amber-500/30 bg-amber-500/10 text-gray-100'
                          : 'border-[#252525] bg-[#101010] text-gray-500 hover:border-[#444]'
                      }`}
                    >
                      <span className="min-w-0 truncate">{asset.name}</span>
                      <span className="shrink-0 text-[10px] text-gray-500">{formatVideoDedupBytes(asset.size)}</span>
                    </button>
                  );
                }) : (
                  <div className="rounded border border-dashed border-[#333] px-3 py-4 text-center text-xs text-gray-500">
                    {t('videoDedup.noVideoAssets')}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>

        <div className="space-y-3">
          {analysisDisabledReason ? (
            <div className="rounded-lg border border-blue-500/25 bg-blue-500/10 p-3 text-[11px] leading-5 text-blue-100/80">
              {analysisDisabledReason}
            </div>
          ) : null}

          <div className="rounded-lg border border-[#252525] bg-[#141414] p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{t('videoDedup.currentPlan')}</div>
            <div className="mt-1 text-xs font-semibold text-gray-200">{selectedMode?.label}</div>
            <div className="mt-1 text-[11px] leading-4 text-gray-500">{selectedMode?.detail}</div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className="rounded border border-[#303030] bg-[#101010] p-2">
                <div className="text-[9px] uppercase tracking-wider text-gray-600">{t('videoDedup.videos')}</div>
                <div className="mt-1 text-sm font-bold text-gray-100">{selectedAssetCount}</div>
              </div>
              <div className="rounded border border-[#303030] bg-[#101010] p-2">
                <div className="text-[9px] uppercase tracking-wider text-gray-600">{t('videoDedup.methods')}</div>
                <div className="mt-1 text-sm font-bold text-gray-100">{params.strategies.length}</div>
              </div>
              <div className="rounded border border-[#303030] bg-[#101010] p-2">
                <div className="text-[9px] uppercase tracking-wider text-gray-600">{t('videoDedup.min')}</div>
                <div className="mt-1 text-sm font-bold text-gray-100">{Math.round(params.minMatchDurationMs / 1000)}s</div>
              </div>
            </div>
          </div>

          {errorMessage ? (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs leading-5 text-red-200">
              {errorMessage}
            </div>
          ) : null}

          {report ? (
            <div className="rounded-lg border border-[#252525] bg-[#141414] p-3">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <div className="text-[9px] font-bold uppercase tracking-wider text-gray-600">{t('videoDedup.duplicateGroups')}</div>
                  <div className="mt-1 text-lg font-bold text-gray-100">{report.duplicateGroupCount}</div>
                </div>
                <div>
                  <div className="text-[9px] font-bold uppercase tracking-wider text-gray-600">{t('videoDedup.matches')}</div>
                  <div className="mt-1 text-lg font-bold text-gray-100">{report.matchCount}</div>
                </div>
                <div>
                  <div className="text-[9px] font-bold uppercase tracking-wider text-gray-600">{t('videoDedup.reclaimable')}</div>
                  <div className="mt-1 text-lg font-bold text-gray-100">{formatVideoDedupBytes(report.reclaimableBytes)}</div>
                </div>
              </div>

              <div className="mt-3 space-y-2">
                {report.groups.length ? report.groups.map((group) => (
                  <div key={group.id} className="rounded-lg border border-[#303030] bg-[#101010] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-semibold text-gray-100">
                          {t('videoDedup.keep', { name: resolveVideoDedupAssetName(assetById, group.canonicalAssetId) })}
                        </div>
                        <div className="mt-1 text-[10px] leading-4 text-gray-500">{group.reason}</div>
                      </div>
                      <div className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] font-bold text-amber-200">
                        {formatVideoDedupPercent(group.groupScore)}
                      </div>
                    </div>
                    <div className="mt-2 space-y-1">
                      {group.matches.slice(0, compact ? 2 : 4).map((match) => (
                        <div key={match.id} className="rounded border border-[#252525] bg-[#0A0A0A] px-2 py-2 text-[10px] leading-4 text-gray-400">
                          <div className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate">
                              {resolveVideoDedupAssetName(assetById, match.targetAssetId)}
                            </span>
                            <span className="shrink-0 text-amber-200">{formatVideoDedupPercent(match.confidence)}</span>
                          </div>
                          <div className="mt-1 text-gray-600">
                            {match.matchKind} / {match.recommendation}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )) : (
                  <div className="rounded border border-dashed border-[#333] px-3 py-4 text-center text-xs text-gray-500">
                    {t('videoDedup.noDuplicateGroups')}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-[#303030] bg-[#141414] p-4 text-xs leading-5 text-gray-500">
              {t('videoDedup.runAnalysisPrompt')}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
