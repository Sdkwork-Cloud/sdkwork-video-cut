import { type ContractValidationError, type ContractValidationResult, mediaContractSchemaIds, type TrackKind, type VideoSplitPlan } from './mediaContracts';
import type { VideoCutArtifact } from './videoCutTypes';

export type NleTimelineTrackKind = 'source' | 'segments' | 'output' | 'analysis' | 'artifacts';
export type NleTimelineClipKind = 'source-video' | 'source-segment' | 'output-segment' | 'analysis-provenance' | 'artifact';

export interface NleTimelineClip {
  clipId: string;
  kind: NleTimelineClipKind;
  label: string;
  startMs: number;
  endMs: number;
  locked: boolean;
  artifactId?: string;
  segmentId?: string;
  sourceArtifactId?: string;
  trackKind?: TrackKind;
  score?: number;
}

export interface NleTimelineTrack {
  trackId: string;
  kind: NleTimelineTrackKind;
  label: string;
  clips: NleTimelineClip[];
}

export interface NleTimelineDocument {
  schemaId: typeof mediaContractSchemaIds.nleTimeline;
  timelineVersion: 1;
  taskId: string;
  planId: string;
  planRevision: number;
  durationMs: number;
  tracks: NleTimelineTrack[];
  createdAt: string;
}

const trackLabels: Record<NleTimelineTrackKind, string> = {
  source: 'Source',
  segments: 'Segments',
  output: 'Output',
  analysis: 'Analysis',
  artifacts: 'Artifacts',
};

const artifactKindsForTimeline = new Set<VideoCutArtifact['kind']>(['analysis', 'subtitle', 'render', 'cover']);

export function createNleTimelineFromPlan(plan: VideoSplitPlan, artifacts: VideoCutArtifact[]): NleTimelineDocument {
  const sourceDurationMs = Math.max(...plan.segments.map((segment) => segment.sourceRange.endMs), 1_000);
  const outputDurationMs = Math.max(...plan.segments.map((segment) => segment.outputRange.endMs), 1_000);
  const durationMs = Math.max(sourceDurationMs, outputDurationMs);
  const timelineArtifacts = dedupeArtifactsById(artifacts.filter((artifact) => artifactKindsForTimeline.has(artifact.kind)));

  return {
    schemaId: mediaContractSchemaIds.nleTimeline,
    timelineVersion: 1,
    taskId: plan.taskId,
    planId: plan.planId,
    planRevision: plan.planRevision,
    durationMs,
    tracks: [
      {
        trackId: `${plan.taskId}-timeline-source`,
        kind: 'source',
        label: trackLabels.source,
        clips: [
          {
            clipId: `${plan.taskId}-source-video`,
            kind: 'source-video',
            label: plan.sourceName,
            startMs: 0,
            endMs: sourceDurationMs,
            locked: true,
            sourceArtifactId: `${plan.taskId}-source`,
          },
        ],
      },
      {
        trackId: `${plan.taskId}-timeline-segments`,
        kind: 'segments',
        label: trackLabels.segments,
        clips: plan.segments.map((segment) => ({
          clipId: `${segment.segmentId}-source`,
          kind: 'source-segment',
          label: segment.title,
          startMs: segment.sourceRange.startMs,
          endMs: segment.sourceRange.endMs,
          locked: false,
          segmentId: segment.segmentId,
          score: segment.score,
        })),
      },
      {
        trackId: `${plan.taskId}-timeline-output`,
        kind: 'output',
        label: trackLabels.output,
        clips: plan.segments.map((segment, index) => ({
          clipId: `${segment.segmentId}-output`,
          kind: 'output-segment',
          label: `Output ${index + 1}`,
          startMs: segment.outputRange.startMs,
          endMs: segment.outputRange.endMs,
          locked: false,
          segmentId: segment.segmentId,
          score: segment.score,
        })),
      },
      {
        trackId: `${plan.taskId}-timeline-analysis`,
        kind: 'analysis',
        label: trackLabels.analysis,
        clips: plan.tracks.map((track, index) => ({
          clipId: `${plan.taskId}-${track.kind}-provenance`,
          kind: 'analysis-provenance',
          label: analysisTrackLabel(track.kind),
          startMs: Math.min(index * 120, Math.max(durationMs - 120, 0)),
          endMs: Math.max(Math.min(index * 120, Math.max(durationMs - 120, 0)) + 100, 100),
          locked: true,
          sourceArtifactId: track.sourceArtifactId,
          trackKind: track.kind,
        })),
      },
      {
        trackId: `${plan.taskId}-timeline-artifacts`,
        kind: 'artifacts',
        label: trackLabels.artifacts,
        clips: timelineArtifacts.map((artifact, index) => ({
          clipId: `${artifact.artifactId}-timeline`,
          kind: 'artifact',
          label: artifactLabel(artifact),
          startMs: Math.min(index * 160, Math.max(durationMs - 160, 0)),
          endMs: Math.max(Math.min(index * 160, Math.max(durationMs - 160, 0)) + 140, 140),
          locked: true,
          artifactId: artifact.artifactId,
        })),
      },
    ],
    createdAt: plan.createdAt,
  };
}

function dedupeArtifactsById(artifacts: VideoCutArtifact[]): VideoCutArtifact[] {
  const uniqueArtifacts = new Map<string, VideoCutArtifact>();

  for (const artifact of artifacts) {
    uniqueArtifacts.set(artifact.artifactId, artifact);
  }

  return [...uniqueArtifacts.values()];
}

export function validateNleTimelineDocument(document: unknown): ContractValidationResult {
  const errors: ContractValidationError[] = [];
  if (!isRecord(document)) {
    pushError(errors, 'document', 'NLE_TIMELINE_DOCUMENT_INVALID', 'NLE timeline document must be an object.');
    return { valid: false, errors };
  }

  if (document.schemaId !== mediaContractSchemaIds.nleTimeline) {
    pushError(errors, 'schemaId', 'SCHEMA_ID_MISMATCH', 'NLE timeline schemaId is invalid.');
  }
  if (document.timelineVersion !== 1) {
    pushError(errors, 'timelineVersion', 'NLE_TIMELINE_VERSION_UNSUPPORTED', 'NLE timeline version must be 1.');
  }
  if (!isPositiveNumber(document.durationMs)) {
    pushError(errors, 'durationMs', 'NLE_TIMELINE_DURATION_INVALID', 'NLE timeline duration must be positive.');
  }
  if (!Array.isArray(document.tracks) || document.tracks.length === 0) {
    pushError(errors, 'tracks', 'NLE_TIMELINE_TRACKS_REQUIRED', 'NLE timeline must contain tracks.');
  } else {
    document.tracks.forEach((track, trackIndex) => {
      if (!isRecord(track)) {
        pushError(errors, `tracks[${trackIndex}]`, 'NLE_TIMELINE_TRACK_INVALID', 'NLE timeline track must be an object.');
        return;
      }
      if (!Array.isArray(track.clips)) {
        pushError(errors, `tracks[${trackIndex}].clips`, 'NLE_TIMELINE_CLIPS_REQUIRED', 'NLE timeline track clips must be an array.');
        return;
      }
      track.clips.forEach((clip, clipIndex) => {
        if (!isRecord(clip)) {
          pushError(errors, `tracks[${trackIndex}].clips[${clipIndex}]`, 'NLE_TIMELINE_CLIP_INVALID', 'NLE timeline clip must be an object.');
          return;
        }
        if (!isNonNegativeNumber(clip.startMs) || !isPositiveNumber(clip.endMs) || clip.endMs <= clip.startMs) {
          pushError(
            errors,
            `tracks[${trackIndex}].clips[${clipIndex}]`,
            'NLE_TIMELINE_CLIP_RANGE_INVALID',
            'NLE timeline clip must have a positive millisecond range.',
          );
        }
      });
    });
  }

  return { valid: errors.length === 0, errors };
}

function analysisTrackLabel(kind: TrackKind): string {
  return kind
    .replace(/Track$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (character) => character.toUpperCase());
}

function artifactLabel(artifact: VideoCutArtifact): string {
  return `${artifact.kind} artifact`;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function pushError(errors: ContractValidationError[], field: string, code: string, message: string): void {
  errors.push({ field, code, message });
}
