import { type ChangeEvent, useEffect, useMemo, useState } from 'react';
import { Activity, FolderOpen, Play, Upload } from 'lucide-react';

import { createNleTimelineFromPlan } from '../../domain/nleTimeline';
import type { RenderAudioAssetPreference, RenderPreferences, VideoSplitPlan } from '../../domain/mediaContracts';
import type {
  AssetCatalog,
  AssetCatalogEntry,
  AssetCatalogKind,
  SubtitleFormat,
  VideoCutArtifact,
  VideoCutProgressEvent,
  VideoCutTask,
  VideoCutType,
} from '../../domain/videoCutTypes';
import { NleTimelinePanel } from '../NleTimelinePanel';
import { StatusBadge } from '../StatusBadge';

const AUTO_ASSET_VALUE = 'auto';
const DISABLED_ASSET_VALUE = 'disabled';
const DEFAULT_RENDER_PREFERENCES: RenderPreferences = {
  audio: {
    bgm: {
      mode: 'auto',
    },
    bgmVolumePercent: 20,
    sfx: {
      mode: 'auto',
    },
    voiceEnhancement: 'basic',
  },
};

export function WorkbenchPage({
  tasks,
  artifacts,
  assetCatalog,
  events,
  plan,
  selectedTaskId,
  cutType,
  onImport,
  onCutTypeChange,
  onImportLocalVideo,
  onSelectTask,
  onAnalyze,
  onRender,
  onSavePlanRange,
  onSaveRenderPreferences,
  onSaveManualTranscript,
  onImportSubtitleFile,
  onExportSubtitles,
}: {
  tasks: VideoCutTask[];
  artifacts: VideoCutArtifact[];
  assetCatalog?: AssetCatalog;
  events: VideoCutProgressEvent[];
  plan?: VideoSplitPlan;
  selectedTaskId?: string;
  cutType: VideoCutType;
  onImport: () => void;
  onCutTypeChange: (type: VideoCutType) => void;
  onImportLocalVideo: (file: File) => void;
  onSelectTask: (taskId: string) => void;
  onAnalyze: (taskId: string) => void;
  onRender: (taskId: string) => void;
  onSavePlanRange: (taskId: string, segmentId: string, startMs: number, endMs: number) => void;
  onSaveRenderPreferences: (taskId: string, renderPreferences: RenderPreferences) => void;
  onSaveManualTranscript: (taskId: string, segmentId: string, startMs: number, endMs: number, text: string) => void;
  onImportSubtitleFile: (taskId: string, file: File) => void;
  onExportSubtitles: (taskId: string, format: SubtitleFormat) => void;
}) {
  const selectedTask = tasks.find((task) => task.taskId === selectedTaskId) ?? tasks[0];
  const [selectedSegmentId, setSelectedSegmentId] = useState<string>();
  const selectedSegment = plan?.segments.find((segment) => segment.segmentId === selectedSegmentId) ?? plan?.segments[0];
  const visibleArtifacts = useMemo(() => dedupeArtifactsById(artifacts), [artifacts]);
  const timeline = useMemo(() => (plan ? createNleTimelineFromPlan(plan, visibleArtifacts) : undefined), [plan, visibleArtifacts]);
  const renderPreferences = useMemo(() => renderPreferencesOrDefault(plan?.renderPreferences), [plan?.renderPreferences]);
  const [rangeDraft, setRangeDraft] = useState({ startMs: '', endMs: '' });
  const [renderAssetDraft, setRenderAssetDraft] = useState({ bgm: AUTO_ASSET_VALUE, sfx: AUTO_ASSET_VALUE });
  const [manualTranscriptText, setManualTranscriptText] = useState('');
  const bgmEntries = useMemo(() => assetEntries(assetCatalog, 'bgm'), [assetCatalog]);
  const sfxEntries = useMemo(() => assetEntries(assetCatalog, 'sfx'), [assetCatalog]);
  const draftStartMs = Number(rangeDraft.startMs);
  const draftEndMs = Number(rangeDraft.endMs);
  const canEditTask = Boolean(selectedTask && isTaskEditable(selectedTask));
  const canSavePlan =
    canEditTask &&
    Boolean(selectedTask && selectedSegment && plan && Number.isFinite(draftStartMs) && Number.isFinite(draftEndMs) && draftEndMs > draftStartMs);
  const canSaveRenderAssets = canEditTask && Boolean(selectedTask && plan);
  const canSaveManualTranscript = canSavePlan && manualTranscriptText.trim().length > 0;
  const canImportSubtitles = canEditTask && Boolean(selectedTask);
  const canExportSubtitles = canEditTask && Boolean(selectedTask);
  const canAnalyze =
    Boolean(selectedTask?.sourceName) &&
    selectedTask?.status !== 'draft' &&
    selectedTask?.status !== 'analyzing' &&
    selectedTask?.status !== 'rendering' &&
    selectedTask?.status !== 'cancelled';
  const canRender =
    Boolean(selectedTask && plan) &&
    selectedTask?.status !== 'draft' &&
    selectedTask?.status !== 'sourceReady' &&
    selectedTask?.status !== 'analyzing' &&
    selectedTask?.status !== 'rendering' &&
    selectedTask?.status !== 'cancelled';

  useEffect(() => {
    if (!plan?.segments.some((segment) => segment.segmentId === selectedSegmentId)) {
      setSelectedSegmentId(plan?.segments[0]?.segmentId);
    }
  }, [plan?.planId, plan?.planRevision, plan?.segments, selectedSegmentId]);

  useEffect(() => {
    if (!selectedSegment) {
      setRangeDraft({ startMs: '', endMs: '' });
      return;
    }

    setRangeDraft({
      startMs: String(selectedSegment.sourceRange.startMs),
      endMs: String(selectedSegment.sourceRange.endMs),
    });
  }, [selectedSegment?.segmentId, selectedSegment?.sourceRange.startMs, selectedSegment?.sourceRange.endMs]);

  useEffect(() => {
    setRenderAssetDraft({
      bgm: valueFromAssetPreference(renderPreferences.audio.bgm),
      sfx: valueFromAssetPreference(renderPreferences.audio.sfx),
    });
  }, [
    plan?.planId,
    plan?.planRevision,
    renderPreferences.audio.bgm.assetId,
    renderPreferences.audio.bgm.mode,
    renderPreferences.audio.bgm.path,
    renderPreferences.audio.sfx.assetId,
    renderPreferences.audio.sfx.mode,
    renderPreferences.audio.sfx.path,
  ]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    onImportLocalVideo(file);
    event.target.value = '';
  };
  const handleSubtitleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selectedTask) {
      return;
    }

    onImportSubtitleFile(selectedTask.taskId, file);
    event.target.value = '';
  };
  const handleSavePlan = () => {
    if (!selectedTask || !selectedSegment || !canSavePlan) {
      return;
    }

    onSavePlanRange(selectedTask.taskId, selectedSegment.segmentId, draftStartMs, draftEndMs);
  };
  const handleSaveRenderPreferences = () => {
    if (!selectedTask || !canSaveRenderAssets) {
      return;
    }

    onSaveRenderPreferences(selectedTask.taskId, {
      audio: {
        bgm: assetPreferenceFromValue(renderAssetDraft.bgm, 'bgm'),
        bgmVolumePercent: 20,
        sfx: assetPreferenceFromValue(renderAssetDraft.sfx, 'sfx'),
        voiceEnhancement: 'basic',
      },
    });
  };
  const handleSaveManualTranscript = () => {
    if (!selectedTask || !selectedSegment || !canSaveManualTranscript) {
      return;
    }

    onSaveManualTranscript(selectedTask.taskId, selectedSegment.segmentId, draftStartMs, draftEndMs, manualTranscriptText.trim());
  };

  return (
    <section className="workbench-grid">
      <div className="workbench-toolbar">
        <div>
          <span className="eyebrow">Workbench</span>
          <h2>视频剪辑工作台</h2>
        </div>
        <div className="toolbar-actions">
          <label className="toolbar-select">
            <span>剪辑类型</span>
            <select value={cutType} onChange={(event) => onCutTypeChange(event.target.value as VideoCutType)}>
              <option value="single-speaker">单人口播</option>
              <option value="interview-qa">访谈问答</option>
              <option value="long-interview">长访谈拆条</option>
            </select>
          </label>
          <label className="secondary-button file-import-control">
            <Upload size={18} aria-hidden="true" />
            导入本地视频
            <input
              aria-label="导入本地视频"
              type="file"
              accept=".mp4,.mov,.m4v,.mkv,.webm,.avi,.mpeg,.mpg,video/*"
              onChange={handleFileChange}
            />
          </label>
          <button type="button" className="secondary-button" aria-label="Import sample video" onClick={onImport}>
            <FolderOpen size={18} aria-hidden="true" />
            导入示例视频
          </button>
          <button
            type="button"
            className="secondary-button"
            aria-label="Analyze selected task"
            disabled={!canAnalyze}
            onClick={() => selectedTask && onAnalyze(selectedTask.taskId)}
          >
            <Activity size={18} aria-hidden="true" />
            开始分析
          </button>
          <button
            type="button"
            className="primary-button"
            aria-label="Render selected task"
            disabled={!canRender}
            onClick={() => selectedTask && onRender(selectedTask.taskId)}
          >
            <Play size={18} aria-hidden="true" />
            渲染输出
          </button>
        </div>
      </div>

      <aside className="clip-list" aria-label="Clip list">
        <h3>任务片段</h3>
        {tasks.length === 0 ? (
          <p className="muted">暂无任务。导入视频后会显示片段候选。</p>
        ) : (
          tasks.map((task) => (
            <button
              aria-current={task.taskId === selectedTask?.taskId ? 'true' : undefined}
              aria-label={`Select task ${task.sourceName ?? task.title}`}
              className={task.taskId === selectedTask?.taskId ? 'clip-row clip-row--button clip-row--active' : 'clip-row clip-row--button'}
              key={task.taskId}
              type="button"
              onClick={() => onSelectTask(task.taskId)}
            >
              <strong>{task.title}</strong>
              {task.sourceName && <small>{task.sourceName}</small>}
              <span>{task.type}</span>
              <StatusBadge label={task.status} tone={task.status === 'succeeded' ? 'ok' : 'neutral'} />
            </button>
          ))
        )}
      </aside>

      <section className="preview-zone" aria-label="Video preview">
        <div className="video-frame">
          <div className="video-safe-area">
            <span>9:16</span>
            <strong>1080x1920</strong>
            <small>30fps MP4</small>
            <p>字幕预览：张老师核心观点，高亮重点词</p>
          </div>
        </div>
        <div className="timeline-strip">
          <span>silence</span>
          <span>speech</span>
          <span>semantic</span>
          <span>cut decision</span>
        </div>
        <NleTimelinePanel
          selectedSegmentId={selectedSegment?.segmentId}
          timeline={timeline}
          onSelectSegment={setSelectedSegmentId}
        />
      </section>

      <aside className="inspector" aria-label="Inspector">
        <h3>审阅面板</h3>
        <dl>
          <div>
            <dt>当前阶段</dt>
            <dd>{selectedTask?.currentStage ?? '等待导入'}</dd>
          </div>
          <div>
            <dt>进度</dt>
            <dd>{selectedTask ? `${selectedTask.progress}%` : '0%'}</dd>
          </div>
          <div>
            <dt>输出规则</dt>
            <dd>≤90s / 60-180s, BGM 20%, 极宋字幕</dd>
          </div>
        </dl>
        <h4>Artifacts</h4>
        <ul className="artifact-list">
          {visibleArtifacts.map((artifact) => (
            <li key={artifact.artifactId}>{artifact.path}</li>
          ))}
        </ul>
        <section className="plan-editor" aria-label="Split plan editor">
          <div className="plan-editor-heading">
            <h4>Split plan</h4>
            {plan && <span>Plan revision {plan.planRevision}</span>}
          </div>
          {selectedSegment ? (
            <>
              <strong>{selectedSegment.title}</strong>
              <div className="plan-editor-fields">
                <label>
                  <span>Segment start ms</span>
                  <input
                    aria-label="Segment start ms"
                    disabled={!canEditTask}
                    min={0}
                    step={100}
                    type="number"
                    value={rangeDraft.startMs}
                    onChange={(event) => setRangeDraft((draft) => ({ ...draft, startMs: event.target.value }))}
                  />
                </label>
                <label>
                  <span>Segment end ms</span>
                  <input
                    aria-label="Segment end ms"
                    disabled={!canEditTask}
                    min={0}
                    step={100}
                    type="number"
                    value={rangeDraft.endMs}
                    onChange={(event) => setRangeDraft((draft) => ({ ...draft, endMs: event.target.value }))}
                  />
                </label>
              </div>
              <div className="decision-reasons" aria-label="Decision reasons">
                {selectedSegment.decisionReasons.map((reason) => (
                  <span key={reason}>{reason}</span>
                ))}
              </div>
              <button type="button" className="secondary-button" disabled={!canSavePlan} onClick={handleSavePlan}>
                Save split plan
              </button>
              <section className="render-asset-editor" aria-label="Render asset preferences">
                <div className="plan-editor-heading">
                  <h4>Render assets</h4>
                  <span>{assetCatalog?.schemaId ?? 'asset catalog unavailable'}</span>
                </div>
                <div className="plan-editor-fields">
                  <label>
                    <span>BGM asset</span>
                    <select
                      aria-label="BGM asset"
                      disabled={!canEditTask}
                      value={renderAssetDraft.bgm}
                      onChange={(event) => setRenderAssetDraft((draft) => ({ ...draft, bgm: event.target.value }))}
                    >
                      {assetPreferenceOptions(bgmEntries, 'BGM')}
                    </select>
                  </label>
                  <label>
                    <span>SFX asset</span>
                    <select
                      aria-label="SFX asset"
                      disabled={!canEditTask}
                      value={renderAssetDraft.sfx}
                      onChange={(event) => setRenderAssetDraft((draft) => ({ ...draft, sfx: event.target.value }))}
                    >
                      {assetPreferenceOptions(sfxEntries, 'SFX')}
                    </select>
                  </label>
                </div>
                <button type="button" className="secondary-button" disabled={!canSaveRenderAssets} onClick={handleSaveRenderPreferences}>
                  Save render assets
                </button>
              </section>
              <label className="manual-transcript-field">
                <span>Manual transcript text</span>
                <textarea
                  aria-label="Manual transcript text"
                  disabled={!canEditTask}
                  rows={3}
                  value={manualTranscriptText}
                  onChange={(event) => setManualTranscriptText(event.target.value)}
                />
              </label>
              <button type="button" className="secondary-button" disabled={!canSaveManualTranscript} onClick={handleSaveManualTranscript}>
                Save manual transcript
              </button>
              <label className="secondary-button file-import-control">
                <Upload size={18} aria-hidden="true" />
                Import subtitles
                <input
                  aria-label="Import subtitle file"
                  type="file"
                  disabled={!canImportSubtitles}
                  accept=".srt,.vtt,text/vtt,application/x-subrip"
                  onChange={handleSubtitleFileChange}
                />
              </label>
              <div className="subtitle-export-actions" aria-label="Subtitle export actions">
                <button
                  type="button"
                  className="secondary-button"
                  aria-label="Export SRT subtitles"
                  disabled={!canExportSubtitles}
                  onClick={() => selectedTask && onExportSubtitles(selectedTask.taskId, 'srt')}
                >
                  Export SRT
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  aria-label="Export VTT subtitles"
                  disabled={!canExportSubtitles}
                  onClick={() => selectedTask && onExportSubtitles(selectedTask.taskId, 'vtt')}
                >
                  Export VTT
                </button>
              </div>
            </>
          ) : (
            <p className="muted">分析完成后可审阅并修改第一段起止时间。</p>
          )}
        </section>
        <h4>事件流</h4>
        <ol className="event-list" aria-label="Task event stream">
          {events.map((event) => (
            <li key={event.eventId}>
              <strong>{event.stage}</strong>
              <span>{event.progress}%</span>
              <p>{event.message}</p>
              {event.metadata?.recoveryHint && (
                <div className="recovery-hint" role="note" aria-label={`Recovery hint for event ${event.eventId}`}>
                  <strong>{event.metadata.recoveryHint.label}</strong>
                  <p>{event.metadata.recoveryHint.message}</p>
                </div>
              )}
            </li>
          ))}
        </ol>
      </aside>
    </section>
  );
}

function assetEntries(assetCatalog: AssetCatalog | undefined, kind: AssetCatalogKind): AssetCatalogEntry[] {
  return assetCatalog?.slots.find((slot) => slot.kind === kind)?.entries ?? [];
}

function dedupeArtifactsById(artifacts: VideoCutArtifact[]): VideoCutArtifact[] {
  const uniqueArtifacts = new Map<string, VideoCutArtifact>();

  for (const artifact of artifacts) {
    uniqueArtifacts.set(artifact.artifactId, artifact);
  }

  return [...uniqueArtifacts.values()];
}

function isTaskEditable(task: VideoCutTask): boolean {
  return task.status !== 'analyzing' && task.status !== 'rendering' && task.status !== 'cancelled';
}

function valueFromAssetPreference(preference: RenderAudioAssetPreference | undefined): string {
  if (!preference || preference.mode === 'auto') {
    return AUTO_ASSET_VALUE;
  }

  if (preference.mode === 'disabled') {
    return DISABLED_ASSET_VALUE;
  }

  return `${preference.assetId}|${preference.path}`;
}

function renderPreferencesOrDefault(value: unknown): RenderPreferences {
  if (!isRecord(value) || !isRecord(value.audio)) {
    return cloneDefaultRenderPreferences();
  }

  return {
    audio: {
      bgm: renderAudioAssetPreferenceOrDefault(value.audio.bgm, 'bgm'),
      bgmVolumePercent: 20,
      sfx: renderAudioAssetPreferenceOrDefault(value.audio.sfx, 'sfx'),
      voiceEnhancement: 'basic',
    },
  };
}

function renderAudioAssetPreferenceOrDefault(value: unknown, kind: 'bgm' | 'sfx'): RenderAudioAssetPreference {
  if (!isRecord(value)) {
    return {
      mode: 'auto',
    };
  }

  if (value.mode === 'auto' || value.mode === 'disabled') {
    return {
      mode: value.mode,
    };
  }

  if (value.mode === 'asset' && typeof value.assetId === 'string' && typeof value.path === 'string') {
    return {
      mode: 'asset',
      assetId: value.assetId,
      path: value.path as `assets://${typeof kind}/${string}`,
    };
  }

  return {
    mode: 'auto',
  };
}

function cloneDefaultRenderPreferences(): RenderPreferences {
  return {
    audio: {
      bgm: { ...DEFAULT_RENDER_PREFERENCES.audio.bgm },
      bgmVolumePercent: DEFAULT_RENDER_PREFERENCES.audio.bgmVolumePercent,
      sfx: { ...DEFAULT_RENDER_PREFERENCES.audio.sfx },
      voiceEnhancement: DEFAULT_RENDER_PREFERENCES.audio.voiceEnhancement,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function assetPreferenceFromValue(value: string, kind: 'bgm' | 'sfx'): RenderAudioAssetPreference {
  if (value === DISABLED_ASSET_VALUE) {
    return {
      mode: 'disabled',
    };
  }

  if (value === AUTO_ASSET_VALUE) {
    return {
      mode: 'auto',
    };
  }

  const [assetId, path] = value.split('|', 2);
  return {
    mode: 'asset',
    assetId,
    path: path as `assets://${typeof kind}/${string}`,
  };
}

function assetPreferenceOptions(entries: AssetCatalogEntry[], label: 'BGM' | 'SFX') {
  return (
    <>
      <option value={AUTO_ASSET_VALUE}>Auto {label}</option>
      <option value={DISABLED_ASSET_VALUE}>Disable {label}</option>
      {entries.map((entry) => (
        <option key={entry.assetId} value={`${entry.assetId}|${entry.path}`}>
          {entry.fileName} · {entry.license}
        </option>
      ))}
    </>
  );
}
