import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ResultsPage } from '../components/pages/ResultsPage';
import type { VideoCutArtifact } from '../domain/videoCutTypes';
import { VideoCutHostApiError } from '../services/httpHostClient';

const artifacts: VideoCutArtifact[] = [
  {
    artifactId: 'task-0001-render-1-output',
    taskId: 'task-0001',
    renderId: 'task-0001-render-1',
    kind: 'render',
    path: 'workspace/projects/default/tasks/task-0001/renders/task-0001-render-1/output.mp4',
    sizeBytes: 301229,
    sha256: 'a'.repeat(64),
    createdAt: '2026-04-27T00:00:00.000Z',
  },
  {
    artifactId: 'task-0001-render-1-log',
    taskId: 'task-0001',
    renderId: 'task-0001-render-1',
    kind: 'log',
    path: 'workspace/projects/default/tasks/task-0001/renders/task-0001-render-1/render.log',
    sizeBytes: 1024,
    sha256: 'b'.repeat(64),
    createdAt: '2026-04-27T00:00:00.000Z',
  },
  {
    artifactId: 'task-0001-render-1-subtitle',
    taskId: 'task-0001',
    renderId: 'task-0001-render-1',
    kind: 'subtitle',
    path: 'workspace/projects/default/tasks/task-0001/renders/task-0001-render-1/subtitles.ass',
    sizeBytes: 2048,
    sha256: 'c'.repeat(64),
    createdAt: '2026-04-27T00:00:00.000Z',
  },
  {
    artifactId: 'task-0001-render-1-cover',
    taskId: 'task-0001',
    renderId: 'task-0001-render-1',
    kind: 'cover',
    path: 'workspace/projects/default/tasks/task-0001/renders/task-0001-render-1/cover.png',
    sizeBytes: 4096,
    sha256: 'd'.repeat(64),
    createdAt: '2026-04-27T00:00:00.000Z',
  },
  {
    artifactId: 'task-0001-render-1-manifest',
    taskId: 'task-0001',
    renderId: 'task-0001-render-1',
    kind: 'render-manifest',
    path: 'workspace/projects/default/tasks/task-0001/renders/task-0001-render-1/render.json',
    sizeBytes: 1536,
    sha256: 'e'.repeat(64),
    createdAt: '2026-04-27T00:00:00.000Z',
  },
];

function installObjectUrlMock(): void {
  let objectUrlIndex = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    objectUrlIndex += 1;
    return `blob:artifact-${objectUrlIndex}`;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
}

describe('ResultsPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads preview media through authenticated artifact blobs instead of direct private API URLs', async () => {
    installObjectUrlMock();
    const getArtifactContent = vi.fn(async (_taskId: string, artifactId: string) => {
      if (artifactId.endsWith('-cover')) {
        return new Blob([new Uint8Array([4, 5, 6])], { type: 'image/png' });
      }

      return new Blob([new Uint8Array([0, 1, 2, 3])], { type: 'video/mp4' });
    });

    render(
      <ResultsPage
        artifacts={artifacts}
        getArtifactContent={getArtifactContent}
        getArtifactText={async () => '{}'}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Rendered video preview')).toHaveAttribute('src', 'blob:artifact-1');
      expect(screen.getByRole('img', { name: 'Generated cover preview' })).toHaveAttribute('src', 'blob:artifact-2');
    });
    expect(screen.getByRole('img', { name: 'Generated cover preview' })).toHaveAttribute('src', 'blob:artifact-2');
    expect(getArtifactContent).toHaveBeenCalledWith('task-0001', 'task-0001-render-1-output');
    expect(getArtifactContent).toHaveBeenCalledWith('task-0001', 'task-0001-render-1-cover');
  });

  it('renders artifact download commands that prepare authenticated object URLs on demand', async () => {
    installObjectUrlMock();
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const getArtifactContent = vi.fn(async () => new Blob([new Uint8Array([0, 1, 2])], { type: 'application/octet-stream' }));

    render(
      <ResultsPage
        artifacts={artifacts}
        getArtifactContent={getArtifactContent}
        getArtifactText={async () => '{}'}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Rendered video preview')).toHaveAttribute('src', 'blob:artifact-1');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Download output.mp4' }));

    await waitFor(() => {
      expect(anchorClick).toHaveBeenCalledTimes(1);
    });
    expect(getArtifactContent).toHaveBeenCalledWith('task-0001', 'task-0001-render-1-output');
    expect(screen.getByRole('button', { name: 'Download render.log' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download subtitles.ass' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download cover.png' })).toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:artifact-3');
  });

  it('loads the render manifest and shows delivery package integrity evidence', async () => {
    installObjectUrlMock();
    render(
      <ResultsPage
        artifacts={artifacts}
        getArtifactContent={async () => new Blob()}
        getArtifactText={async (taskId, artifactId) => {
          expect(taskId).toBe('task-0001');
          expect(artifactId).toBe('task-0001-render-1-manifest');
          return JSON.stringify({
            schemaId: 'video-cut.render-attempt.schema.v1',
            renderAttemptVersion: 1,
            taskId: 'task-0001',
            renderId: 'task-0001-render-1',
            planId: 'task-0001-plan-1',
            planRevision: 2,
            sourceArtifactId: 'task-0001-source',
            transcriptArtifactId: 'task-0001-transcript',
            outputArtifactId: 'task-0001-render-1-output',
            subtitleArtifactId: 'task-0001-render-1-subtitle',
            coverArtifactId: 'task-0001-render-1-cover',
            logArtifactId: 'task-0001-render-1-log',
            subtitleBurnIn: true,
            subtitleCueCount: 1,
            sourceRange: { startMs: 500, endMs: 1800 },
            outputSpec: {
              aspectRatio: '9:16',
              width: 1080,
              height: 1920,
              frameRate: 30,
              format: 'mp4',
            },
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
                status: 'mixed',
                mixed: true,
                volumePercent: 20,
                asset: {
                  assetId: 'bgm-1234567890abcdef',
                  path: 'assets://bgm/licensed-bgm.wav',
                  sha256: 'a'.repeat(64),
                  license: 'CC0-1.0',
                  source: 'https://example.invalid/sdkwork-bgm-pack',
                  version: '2026.04',
                },
              },
              sfx: {
                status: 'not-configured',
                mixed: false,
              },
              codec: { video: 'libx264', audio: 'aac' },
            },
            warnings: [],
            createdAt: '2026-04-27T00:00:00.000Z',
          });
        }}
      />,
    );

    expect(await screen.findByText('Delivery package')).toBeInTheDocument();
    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.getByText('500 ms - 1800 ms')).toBeInTheDocument();
    expect(screen.getByText('1080x1920 @ 30fps mp4')).toBeInTheDocument();
    expect(screen.getByText('standard-vertical-scale-crop-fps-ass-burn-in.v1')).toBeInTheDocument();
    expect(screen.getByText('voice-basic-loudnorm-afftdn.v1')).toBeInTheDocument();
    expect(screen.getByText('BGM 20% mixed')).toBeInTheDocument();
    expect(screen.getByText('assets://bgm/licensed-bgm.wav')).toBeInTheDocument();
    expect(screen.getByText('CC0-1.0 / 2026.04')).toBeInTheDocument();
    expect(screen.getByText('Subtitle cues')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('5/5 hashes present')).toBeInTheDocument();
  });

  it('shows standard host metadata when artifact preview content fails', async () => {
    installObjectUrlMock();

    render(
      <ResultsPage
        artifacts={artifacts}
        getArtifactContent={async (_taskId, artifactId) => {
          if (artifactId.endsWith('-cover')) {
            throw new VideoCutHostApiError({
              status: 403,
              code: 'ARTIFACT_CONTENT_DENIED',
              message: 'Artifact content access denied.',
              traceId: 'trace-cover-preview-001',
              endpoint: 'http://127.0.0.1:6177/api/video-cut/v1/tasks/task-0001/artifacts/task-0001-render-1-cover/content',
            });
          }

          return new Blob([new Uint8Array([0, 1, 2, 3])], { type: 'video/mp4' });
        }}
        getArtifactText={async () => '{}'}
      />,
    );

    expect(await screen.findByText('ARTIFACT_CONTENT_DENIED')).toBeInTheDocument();
    expect(screen.getByText('HTTP 403')).toBeInTheDocument();
    expect(screen.getByText('trace-cover-preview-001')).toBeInTheDocument();
    expect(
      screen.getByText('http://127.0.0.1:6177/api/video-cut/v1/tasks/task-0001/artifacts/task-0001-render-1-cover/content'),
    ).toBeInTheDocument();
  });

  it('shows standard host metadata when the render manifest cannot be loaded', async () => {
    installObjectUrlMock();

    render(
      <ResultsPage
        artifacts={artifacts}
        getArtifactContent={async () => new Blob([new Uint8Array([0, 1, 2, 3])], { type: 'application/octet-stream' })}
        getArtifactText={async () => {
          throw new VideoCutHostApiError({
            status: 404,
            code: 'ARTIFACT_NOT_FOUND',
            message: 'Render manifest artifact was not found.',
            traceId: 'trace-manifest-404',
            endpoint: 'http://127.0.0.1:6177/api/video-cut/v1/tasks/task-0001/artifacts/task-0001-render-1-manifest/content',
          });
        }}
      />,
    );

    expect(await screen.findByText('ARTIFACT_NOT_FOUND')).toBeInTheDocument();
    expect(screen.getByText('HTTP 404')).toBeInTheDocument();
    expect(screen.getByText('trace-manifest-404')).toBeInTheDocument();
    expect(
      screen.getByText('http://127.0.0.1:6177/api/video-cut/v1/tasks/task-0001/artifacts/task-0001-render-1-manifest/content'),
    ).toBeInTheDocument();
  });

  it('shows standard host metadata when an artifact download cannot be prepared', async () => {
    installObjectUrlMock();
    let outputContentReads = 0;

    render(
      <ResultsPage
        artifacts={artifacts}
        getArtifactContent={async (_taskId, artifactId) => {
          if (artifactId.endsWith('-output')) {
            outputContentReads += 1;
            if (outputContentReads > 1) {
              throw new VideoCutHostApiError({
                status: 416,
                code: 'ARTIFACT_RANGE_INVALID',
                message: 'Artifact byte range is invalid.',
                traceId: 'trace-download-416',
                endpoint: 'http://127.0.0.1:6177/api/video-cut/v1/tasks/task-0001/artifacts/task-0001-render-1-output/content',
              });
            }
          }

          return new Blob([new Uint8Array([0, 1, 2, 3])], { type: 'application/octet-stream' });
        }}
        getArtifactText={async () => '{}'}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Rendered video preview')).toHaveAttribute('src', 'blob:artifact-1');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Download output.mp4' }));

    expect(await screen.findByText('ARTIFACT_RANGE_INVALID')).toBeInTheDocument();
    expect(screen.getByText('HTTP 416')).toBeInTheDocument();
    expect(screen.getByText('trace-download-416')).toBeInTheDocument();
    expect(
      screen.getByText('http://127.0.0.1:6177/api/video-cut/v1/tasks/task-0001/artifacts/task-0001-render-1-output/content'),
    ).toBeInTheDocument();
  });
});
