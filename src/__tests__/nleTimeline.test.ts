import { describe, expect, it } from 'vitest';

import { createDefaultVideoSplitPlan } from '../domain/mediaContracts';
import { createNleTimelineFromPlan, validateNleTimelineDocument } from '../domain/nleTimeline';
import type { VideoCutArtifact } from '../domain/videoCutTypes';

describe('nleTimeline', () => {
  it('builds a standard multi-track NLE timeline from a split plan and artifacts', () => {
    const plan = createDefaultVideoSplitPlan({
      sourceName: 'interview.mp4',
      taskId: 'task-0001',
      type: 'interview-qa',
    });
    const artifacts: VideoCutArtifact[] = [
      {
        artifactId: 'task-0001-transcript',
        taskId: 'task-0001',
        kind: 'analysis',
        path: 'workspace/projects/default/tasks/task-0001/analysis/transcript.json',
        sizeBytes: 100,
        sha256: 'sha-transcript',
        createdAt: '2026-04-26T00:00:00.000Z',
      },
      {
        artifactId: 'task-0001-subtitle-export-vtt',
        taskId: 'task-0001',
        kind: 'subtitle',
        path: 'workspace/projects/default/tasks/task-0001/analysis/subtitles-export.vtt',
        sizeBytes: 100,
        sha256: 'sha-subtitle',
        createdAt: '2026-04-26T00:00:00.000Z',
      },
    ];

    const timeline = createNleTimelineFromPlan(plan, artifacts);

    expect(timeline.schemaId).toBe('video-cut.nle-timeline.schema.v1');
    expect(timeline.planRevision).toBe(plan.planRevision);
    expect(timeline.durationMs).toBeGreaterThan(0);
    expect(timeline.tracks.map((track) => track.kind)).toEqual([
      'source',
      'segments',
      'output',
      'analysis',
      'artifacts',
    ]);
    expect(timeline.tracks.find((track) => track.kind === 'segments')?.clips[0]).toEqual(
      expect.objectContaining({
        clipId: 'task-0001-segment-1-source',
        segmentId: 'task-0001-segment-1',
        startMs: plan.segments[0].sourceRange.startMs,
        endMs: plan.segments[0].sourceRange.endMs,
      }),
    );
    expect(timeline.tracks.find((track) => track.kind === 'analysis')?.clips).toHaveLength(plan.tracks.length);
    expect(timeline.tracks.find((track) => track.kind === 'artifacts')?.clips.map((clip) => clip.artifactId)).toEqual([
      'task-0001-transcript',
      'task-0001-subtitle-export-vtt',
    ]);
    expect(validateNleTimelineDocument(timeline)).toEqual({ valid: true, errors: [] });
  });

  it('rejects invalid timeline clips before they can reach the workbench', () => {
    const plan = createDefaultVideoSplitPlan({
      sourceName: 'interview.mp4',
      taskId: 'task-0001',
      type: 'interview-qa',
    });
    const timeline = createNleTimelineFromPlan(plan, []);
    timeline.tracks[1].clips[0].endMs = timeline.tracks[1].clips[0].startMs;

    expect(validateNleTimelineDocument(timeline).errors).toContainEqual(
      expect.objectContaining({
        code: 'NLE_TIMELINE_CLIP_RANGE_INVALID',
        field: 'tracks[1].clips[0]',
      }),
    );
  });

  it('deduplicates artifact clips by artifact id before React keys are generated', () => {
    const plan = createDefaultVideoSplitPlan({
      sourceName: 'interview.mp4',
      taskId: 'task-0001',
      type: 'interview-qa',
    });
    const artifacts: VideoCutArtifact[] = [
      {
        artifactId: 'task-0001-render-2-output',
        taskId: 'task-0001',
        renderId: 'task-0001-render-2',
        kind: 'render',
        path: 'workspace/projects/default/tasks/task-0001/renders/task-0001-render-2/output.mp4',
        sizeBytes: 100,
        sha256: 'sha-old',
        createdAt: '2026-04-26T00:00:00.000Z',
      },
      {
        artifactId: 'task-0001-render-2-output',
        taskId: 'task-0001',
        renderId: 'task-0001-render-2',
        kind: 'render',
        path: 'workspace/projects/default/tasks/task-0001/renders/task-0001-render-2/output.mp4',
        sizeBytes: 120,
        sha256: 'sha-new',
        createdAt: '2026-04-26T00:00:00.000Z',
      },
    ];

    const timeline = createNleTimelineFromPlan(plan, artifacts);
    const artifactClips = timeline.tracks.find((track) => track.kind === 'artifacts')?.clips ?? [];

    expect(artifactClips.map((clip) => clip.clipId)).toEqual(['task-0001-render-2-output-timeline']);
    expect(artifactClips.map((clip) => clip.artifactId)).toEqual(['task-0001-render-2-output']);
  });
});
