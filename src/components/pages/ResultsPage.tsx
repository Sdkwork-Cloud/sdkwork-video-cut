import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileJson } from 'lucide-react';

import { parseRenderAttemptManifest, type RenderAttemptManifest } from '../../domain/mediaContracts';
import { type OperationError, toOperationError } from '../../domain/operationErrors';
import type { VideoCutArtifact } from '../../domain/videoCutTypes';

function fileNameFromPath(path: string): string {
  return path.split('/').pop() ?? path;
}

function formatBytes(sizeBytes: number): string {
  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (sizeBytes >= 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }

  return `${sizeBytes} B`;
}

function latestArtifact(artifacts: VideoCutArtifact[], kind: VideoCutArtifact['kind']): VideoCutArtifact | undefined {
  return [...artifacts]
    .filter((artifact) => artifact.kind === kind)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .at(-1);
}

function artifactForRender(
  artifacts: VideoCutArtifact[],
  kind: VideoCutArtifact['kind'],
  renderId: string | undefined,
): VideoCutArtifact | undefined {
  if (renderId) {
    const exact = artifacts.find((artifact) => artifact.kind === kind && artifact.renderId === renderId);
    if (exact) {
      return exact;
    }
  }

  return latestArtifact(artifacts, kind);
}

function isValidSha256(artifact: VideoCutArtifact | undefined): boolean {
  return Boolean(artifact && artifact.sizeBytes > 0 && /^[a-f0-9]{64}$/i.test(artifact.sha256));
}

function createBrowserObjectUrl(blob: Blob): string {
  if (typeof URL.createObjectURL !== 'function') {
    throw new Error('Browser object URL API is unavailable for artifact preview.');
  }

  return URL.createObjectURL(blob);
}

function revokeBrowserObjectUrl(url: string): void {
  if (typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(url);
  }
}

function InlineOperationError({ error }: { error: OperationError }) {
  return (
    <div className="delivery-warning inline-operation-error" role="alert">
      <strong>{error.title}</strong>
      <p>{error.message}</p>
      <dl className="operation-error-meta">
        {error.code && (
          <div>
            <dt>Code</dt>
            <dd>{error.code}</dd>
          </div>
        )}
        {error.status !== undefined && (
          <div>
            <dt>Status</dt>
            <dd>HTTP {error.status}</dd>
          </div>
        )}
        {error.traceId && (
          <div>
            <dt>Trace</dt>
            <dd>{error.traceId}</dd>
          </div>
        )}
        {error.endpoint && (
          <div>
            <dt>Endpoint</dt>
            <dd>{error.endpoint}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function useArtifactObjectUrl(
  artifact: VideoCutArtifact | undefined,
  getArtifactContent: (taskId: string, artifactId: string) => Promise<Blob>,
): {
  artifactId?: string;
  error?: OperationError;
  loading: boolean;
  url?: string;
} {
  const [state, setState] = useState<{
    artifactId?: string;
    error?: OperationError;
    loading: boolean;
    url?: string;
  }>({ loading: false });

  useEffect(() => {
    if (!artifact) {
      setState({ loading: false });
      return;
    }

    let cancelled = false;
    let objectUrl: string | undefined;
    setState({
      artifactId: artifact.artifactId,
      loading: true,
    });
    void getArtifactContent(artifact.taskId, artifact.artifactId)
      .then((blob) => {
        if (cancelled) {
          return;
        }

        objectUrl = createBrowserObjectUrl(blob);
        setState({
          artifactId: artifact.artifactId,
          loading: false,
          url: objectUrl,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        setState({
          artifactId: artifact.artifactId,
          error: toOperationError(error, 'Load artifact content failed'),
          loading: false,
        });
      });

    return () => {
      cancelled = true;
      if (objectUrl) {
        revokeBrowserObjectUrl(objectUrl);
      }
    };
  }, [artifact?.artifactId, artifact?.taskId, getArtifactContent]);

  return state;
}

function formatRange(range: RenderAttemptManifest['sourceRange']): string {
  return `${range.startMs} ms - ${range.endMs} ms`;
}

function formatOutputSpec(manifest: RenderAttemptManifest): string {
  return `${manifest.outputSpec.width}x${manifest.outputSpec.height} @ ${manifest.outputSpec.frameRate}fps ${manifest.outputSpec.format}`;
}

function formatVoiceEnhancement(manifest: RenderAttemptManifest): string {
  const { filters, status } = manifest.renderGraph.voiceEnhancement;

  return `${status} (${filters.join(', ')})`;
}

function formatBgmStatus(manifest: RenderAttemptManifest): string {
  const { bgm } = manifest.renderGraph;

  return `BGM ${bgm.volumePercent}% ${bgm.mixed ? 'mixed' : bgm.status}`;
}

function formatSfxStatus(manifest: RenderAttemptManifest): string {
  const { sfx } = manifest.renderGraph;

  return `SFX ${sfx.mixed ? 'mixed' : sfx.status}`;
}

function formatAssetLicense(asset: NonNullable<RenderAttemptManifest['renderGraph']['bgm']['asset']>): string {
  return `${asset.license} / ${asset.version}`;
}

function buildDeliveryIntegrity(
  artifacts: VideoCutArtifact[],
  manifestArtifact: VideoCutArtifact,
  manifest: RenderAttemptManifest,
): {
  hashCount: number;
  requiredCount: number;
  missingLabels: string[];
  status: 'Complete' | 'Warning';
} {
  const artifactById = new Map(artifacts.map((artifact) => [artifact.artifactId, artifact]));
  const required = [
    { id: manifest.outputArtifactId, label: 'output.mp4' },
    { id: manifest.subtitleArtifactId, label: 'subtitles.ass' },
    { id: manifest.coverArtifactId, label: 'cover.png' },
    { id: manifest.logArtifactId, label: 'render.log' },
    { id: manifestArtifact.artifactId, label: 'render.json' },
  ];
  const missingLabels = required.filter(({ id }) => !artifactById.has(id)).map(({ label }) => label);
  const hashCount = required.filter(({ id }) => isValidSha256(artifactById.get(id))).length;
  const complete = missingLabels.length === 0 && hashCount === required.length && manifest.warnings.length === 0;

  return {
    hashCount,
    missingLabels,
    requiredCount: required.length,
    status: complete ? 'Complete' : 'Warning',
  };
}

export function ResultsPage({
  artifacts,
  getArtifactContent,
  getArtifactText,
}: {
  artifacts: VideoCutArtifact[];
  getArtifactContent: (taskId: string, artifactId: string) => Promise<Blob>;
  getArtifactText: (taskId: string, artifactId: string) => Promise<string>;
}) {
  const renderArtifact = latestArtifact(artifacts, 'render');
  const activeRenderId = renderArtifact?.renderId;
  const coverArtifact = artifactForRender(artifacts, 'cover', activeRenderId);
  const manifestArtifact = artifactForRender(artifacts, 'render-manifest', activeRenderId);
  const renderContentState = useArtifactObjectUrl(renderArtifact, getArtifactContent);
  const coverContentState = useArtifactObjectUrl(coverArtifact, getArtifactContent);
  const [manifestState, setManifestState] = useState<{
    artifactId?: string;
    error?: OperationError;
    loading: boolean;
    manifest?: RenderAttemptManifest;
  }>({ loading: false });
  const [downloadState, setDownloadState] = useState<{
    artifactId?: string;
    error?: OperationError;
    loading: boolean;
  }>({ loading: false });

  useEffect(() => {
    if (!manifestArtifact) {
      setManifestState({ loading: false });
      return;
    }

    let cancelled = false;
    setManifestState({
      artifactId: manifestArtifact.artifactId,
      loading: true,
    });
    void getArtifactText(manifestArtifact.taskId, manifestArtifact.artifactId)
      .then((raw) => {
        if (cancelled) {
          return;
        }

        const manifest = parseRenderAttemptManifest(raw);
        if (!manifest) {
          setManifestState({
            artifactId: manifestArtifact.artifactId,
            error: {
              title: 'Load render manifest failed',
              message: 'Render manifest is not a valid video-cut.render-attempt.schema.v1 document.',
            },
            loading: false,
          });
          return;
        }

        setManifestState({
          artifactId: manifestArtifact.artifactId,
          loading: false,
          manifest,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        setManifestState({
          artifactId: manifestArtifact.artifactId,
          error: toOperationError(error, 'Load render manifest failed'),
          loading: false,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [getArtifactText, manifestArtifact?.artifactId, manifestArtifact?.taskId]);

  const deliveryIntegrity =
    manifestArtifact && manifestState.manifest
      ? buildDeliveryIntegrity(artifacts, manifestArtifact, manifestState.manifest)
      : undefined;

  const downloadArtifact = useCallback(
    async (artifact: VideoCutArtifact) => {
      let objectUrl: string | undefined;
      setDownloadState({
        artifactId: artifact.artifactId,
        loading: true,
      });

      try {
        const blob = await getArtifactContent(artifact.taskId, artifact.artifactId);
        objectUrl = createBrowserObjectUrl(blob);
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = fileNameFromPath(artifact.path);
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        setDownloadState({ loading: false });
      } catch (error: unknown) {
        setDownloadState({
          artifactId: artifact.artifactId,
          error: toOperationError(error, 'Download artifact failed'),
          loading: false,
        });
      } finally {
        if (objectUrl) {
          revokeBrowserObjectUrl(objectUrl);
        }
      }
    },
    [getArtifactContent],
  );

  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Results</span>
          <h2>渲染结果</h2>
        </div>
      </div>

      {renderArtifact && (
        <section className="result-preview" aria-label="Render output preview">
          <div className="result-preview-media">
            {renderContentState.loading && <p className="muted">Loading render preview...</p>}
            {renderContentState.error && (
              <InlineOperationError error={renderContentState.error} />
            )}
            {renderContentState.url && (
              <video aria-label="Rendered video preview" controls preload="metadata" src={renderContentState.url} />
            )}
            {coverContentState.error && (
              <InlineOperationError error={coverContentState.error} />
            )}
            {coverArtifact && coverContentState.url && (
              <img alt="Generated cover preview" src={coverContentState.url} />
            )}
          </div>
          <div className="result-preview-meta">
            <strong>{fileNameFromPath(renderArtifact.path)}</strong>
            <span>{formatBytes(renderArtifact.sizeBytes)}</span>
            {coverArtifact && (
              <span>
                {fileNameFromPath(coverArtifact.path)} / {formatBytes(coverArtifact.sizeBytes)}
              </span>
            )}
          </div>
        </section>
      )}

      {manifestArtifact && (
        <section className="delivery-panel" aria-label="Delivery package">
          <div className="delivery-header">
            <FileJson size={18} aria-hidden="true" />
            <div>
              <span className="eyebrow">Render manifest</span>
              <h3>Delivery package</h3>
            </div>
            {deliveryIntegrity && (
              <span className={`delivery-status delivery-status--${deliveryIntegrity.status.toLowerCase()}`}>
                {deliveryIntegrity.status === 'Complete' ? (
                  <CheckCircle2 size={15} aria-hidden="true" />
                ) : (
                  <AlertTriangle size={15} aria-hidden="true" />
                )}
                {deliveryIntegrity.status}
              </span>
            )}
          </div>

          {manifestState.loading && <p className="muted">Loading render manifest...</p>}
          {manifestState.error && (
            <InlineOperationError error={manifestState.error} />
          )}
          {manifestState.manifest && deliveryIntegrity && (
            <>
              <dl className="delivery-grid">
                <div>
                  <dt>Source range</dt>
                  <dd>{formatRange(manifestState.manifest.sourceRange)}</dd>
                </div>
                <div>
                  <dt>Output</dt>
                  <dd>{formatOutputSpec(manifestState.manifest)}</dd>
                </div>
                <div>
                  <dt>Engine</dt>
                  <dd>{manifestState.manifest.renderGraph.engine}</dd>
                </div>
                <div>
                  <dt>Filter preset</dt>
                  <dd>{manifestState.manifest.renderGraph.videoFilterPreset}</dd>
                </div>
                <div>
                  <dt>Audio filter</dt>
                  <dd>{manifestState.manifest.renderGraph.audioFilterPreset}</dd>
                </div>
                <div>
                  <dt>Voice</dt>
                  <dd>{formatVoiceEnhancement(manifestState.manifest)}</dd>
                </div>
                <div>
                  <dt>BGM</dt>
                  <dd>{formatBgmStatus(manifestState.manifest)}</dd>
                </div>
                {manifestState.manifest.renderGraph.bgm.asset && (
                  <>
                    <div>
                      <dt>BGM asset</dt>
                      <dd>{manifestState.manifest.renderGraph.bgm.asset.path}</dd>
                    </div>
                    <div>
                      <dt>BGM license</dt>
                      <dd>{formatAssetLicense(manifestState.manifest.renderGraph.bgm.asset)}</dd>
                    </div>
                    <div>
                      <dt>BGM source</dt>
                      <dd>{manifestState.manifest.renderGraph.bgm.asset.source}</dd>
                    </div>
                  </>
                )}
                <div>
                  <dt>SFX</dt>
                  <dd>{formatSfxStatus(manifestState.manifest)}</dd>
                </div>
                {manifestState.manifest.renderGraph.sfx.asset && (
                  <>
                    <div>
                      <dt>SFX asset</dt>
                      <dd>{manifestState.manifest.renderGraph.sfx.asset.path}</dd>
                    </div>
                    <div>
                      <dt>SFX license</dt>
                      <dd>{formatAssetLicense(manifestState.manifest.renderGraph.sfx.asset)}</dd>
                    </div>
                    <div>
                      <dt>SFX source</dt>
                      <dd>{manifestState.manifest.renderGraph.sfx.asset.source}</dd>
                    </div>
                  </>
                )}
                <div>
                  <dt>Subtitle burn-in</dt>
                  <dd>{manifestState.manifest.subtitleBurnIn ? 'enabled' : 'disabled'}</dd>
                </div>
                <div>
                  <dt>Subtitle cues</dt>
                  <dd>{manifestState.manifest.subtitleCueCount}</dd>
                </div>
                <div>
                  <dt>Artifact integrity</dt>
                  <dd>
                    {deliveryIntegrity.hashCount}/{deliveryIntegrity.requiredCount} hashes present
                  </dd>
                </div>
                <div>
                  <dt>Codec</dt>
                  <dd>
                    {manifestState.manifest.renderGraph.codec.video} / {manifestState.manifest.renderGraph.codec.audio}
                  </dd>
                </div>
              </dl>
              {deliveryIntegrity.missingLabels.length > 0 && (
                <p className="delivery-warning">Missing artifacts: {deliveryIntegrity.missingLabels.join(', ')}</p>
              )}
              {manifestState.manifest.warnings.length > 0 && (
                <ul className="delivery-warning-list">
                  {manifestState.manifest.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      )}

      <div className="artifact-panel">
        {downloadState.error && (
          <InlineOperationError error={downloadState.error} />
        )}
        {artifacts.length === 0 ? (
          <p className="muted">暂无输出。渲染完成后会展示 MP4、字幕、封面和日志。</p>
        ) : (
          artifacts.map((artifact) => (
            <button
              aria-label={`Download ${fileNameFromPath(artifact.path)}`}
              className="artifact-row artifact-row--link"
              disabled={downloadState.loading}
              key={artifact.artifactId}
              type="button"
              onClick={() => void downloadArtifact(artifact)}
            >
              <Download size={16} aria-hidden="true" />
              <span>{artifact.kind}</span>
              <strong>{fileNameFromPath(artifact.path)}</strong>
              <small>
                {downloadState.loading && downloadState.artifactId === artifact.artifactId
                  ? 'Preparing...'
                  : formatBytes(artifact.sizeBytes)}
              </small>
            </button>
          ))
        )}
      </div>
    </section>
  );
}
