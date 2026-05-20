import { useCallback, useMemo, useState } from 'react';
import type {
  AutoCutSliceManualEdit,
  AutoCutSliceReviewSegment,
  AutoCutSliceReviewSession,
  AutoCutStudioClipTimelineSnapshot,
  StudioClipProcessingOperation,
} from '@sdkwork/autocut-types';

import {
  adjustSliceReviewSegmentBoundaryOnStudioTimeline,
  createStudioClipPreviewRange,
  invalidateStudioClipProcessingOperationsForBoundaryEdit,
  previewStudioClipBoundaryAdjustment,
  splitSliceReviewSegmentAtTimelinePlayhead,
} from '../../service/clipWorkflow';
import {
  buildSmartSliceTimelineBoundaryPreview,
  clampSmartSliceTimelineMs,
} from './timelineModel';
import type {
  SmartSliceTimelineBoundaryPreview,
  SmartSliceTimelineBoundarySide,
  SmartSliceTimelineClipItem,
} from './types';

export interface SmartSliceTimelinePreviewRange {
  startMs: number;
  endMs: number;
  loop: boolean;
}

export interface SmartSliceTimelineReviewCommitOptions {
  processingOperations?: readonly StudioClipProcessingOperation[];
}

export type SmartSliceTimelineReviewCommitDraft = (
  baseSession: AutoCutSliceReviewSession,
  segments: readonly AutoCutSliceReviewSegment[],
  manualEdit?: AutoCutSliceManualEdit,
  options?: SmartSliceTimelineReviewCommitOptions,
) => void;

export interface UseSmartSliceTimelineReviewControllerParams {
  reviewSession: AutoCutSliceReviewSession | null;
  timelineSnapshot: AutoCutStudioClipTimelineSnapshot | null;
  timelineDurationMs: number;
  onActiveReviewSegmentIdChange: (segmentId: string) => void;
  onSeekPreviewMs: (timeMs: number) => void;
  onCommitReviewSessionDraft: SmartSliceTimelineReviewCommitDraft;
}

export function useSmartSliceTimelineReviewController({
  reviewSession,
  timelineSnapshot,
  timelineDurationMs,
  onActiveReviewSegmentIdChange,
  onSeekPreviewMs,
  onCommitReviewSessionDraft,
}: UseSmartSliceTimelineReviewControllerParams) {
  const [previewRange, setPreviewRange] = useState<SmartSliceTimelinePreviewRange | null>(null);
  const [boundaryPreview, setBoundaryPreview] = useState<SmartSliceTimelineBoundaryPreview | null>(null);
  const orderedClips = useMemo(
    () => [...(timelineSnapshot?.clips ?? [])].sort((firstClip, secondClip) =>
      firstClip.startMs - secondClip.startMs ||
      firstClip.endMs - secondClip.endMs ||
      firstClip.id.localeCompare(secondClip.id),
    ),
    [timelineSnapshot],
  );

  const seekPreviewMs = useCallback((timeMs: number) => {
    onSeekPreviewMs(clampSmartSliceTimelineMs(timeMs, timelineDurationMs));
  }, [onSeekPreviewMs, timelineDurationMs]);

  const resolveNeighborBounds = useCallback((item: SmartSliceTimelineClipItem) => {
    const clipIndex = orderedClips.findIndex((candidate) => candidate.id === item.clip.id);
    return {
      previousClipEndMs: clipIndex > 0 ? orderedClips[clipIndex - 1]?.endMs : undefined,
      nextClipStartMs: clipIndex >= 0 ? orderedClips[clipIndex + 1]?.startMs : undefined,
    };
  }, [orderedClips]);

  const constrainBoundaryMs = useCallback((
    item: SmartSliceTimelineClipItem,
    side: SmartSliceTimelineBoundarySide,
    nextMs: number,
  ) => {
    const { previousClipEndMs, nextClipStartMs } = resolveNeighborBounds(item);
    const constrainedMs = side === 'left'
      ? Math.max(previousClipEndMs ?? 0, nextMs)
      : Math.min(nextClipStartMs ?? timelineDurationMs, nextMs);
    return clampSmartSliceTimelineMs(constrainedMs, timelineDurationMs);
  }, [resolveNeighborBounds, timelineDurationMs]);

  const previewReviewSegment = useCallback((segment: AutoCutSliceReviewSegment) => {
    const nextPreviewRange = {
      startMs: segment.startMs,
      endMs: segment.endMs,
      loop: true,
    };
    onActiveReviewSegmentIdChange(segment.id);
    setPreviewRange(nextPreviewRange);
    setBoundaryPreview(null);
    seekPreviewMs(nextPreviewRange.startMs);
  }, [onActiveReviewSegmentIdChange, seekPreviewMs]);

  const seekTimelineMs = useCallback((timeMs: number) => {
    const seekMs = clampSmartSliceTimelineMs(timeMs, timelineDurationMs);
    setPreviewRange(null);
    setBoundaryPreview(null);
    seekPreviewMs(seekMs);
  }, [seekPreviewMs, timelineDurationMs]);

  const previewClip = useCallback((item: SmartSliceTimelineClipItem) => {
    const nextPreviewRange = createStudioClipPreviewRange(item.clip);
    onActiveReviewSegmentIdChange(item.segment.id);
    setPreviewRange(nextPreviewRange);
    setBoundaryPreview(null);
    seekPreviewMs(nextPreviewRange.startMs);
  }, [onActiveReviewSegmentIdChange, seekPreviewMs]);

  const commitClipBoundary = useCallback((
    item: SmartSliceTimelineClipItem,
    side: SmartSliceTimelineBoundarySide,
    nextMs: number,
  ) => {
    if (!reviewSession || !timelineSnapshot) {
      return;
    }

    const boundaryAdjustment = adjustSliceReviewSegmentBoundaryOnStudioTimeline({
      reviewSession,
      segmentId: item.segment.id,
      clip: item.clip,
      timeline: timelineSnapshot.timeline,
      side,
      nextMs: constrainBoundaryMs(item, side, nextMs),
    });
    if (!boundaryAdjustment) {
      return;
    }

    const invalidatedProcessingOperations = invalidateStudioClipProcessingOperationsForBoundaryEdit({
      processingOperations: timelineSnapshot.processingOperations,
      event: boundaryAdjustment.event,
    });
    onCommitReviewSessionDraft(reviewSession, boundaryAdjustment.segments, boundaryAdjustment.manualEdit, {
      processingOperations: invalidatedProcessingOperations,
    });
    onActiveReviewSegmentIdChange(item.segment.id);
    setPreviewRange(createStudioClipPreviewRange(boundaryAdjustment.clip));
    setBoundaryPreview(null);
  }, [
    constrainBoundaryMs,
    onActiveReviewSegmentIdChange,
    onCommitReviewSessionDraft,
    reviewSession,
    timelineSnapshot,
  ]);

  const previewClipBoundaryDrag = useCallback((
    item: SmartSliceTimelineClipItem,
    side: SmartSliceTimelineBoundarySide,
    nextMs: number,
  ) => {
    if (!timelineSnapshot) {
      return;
    }

    const previewClipForBoundary = previewStudioClipBoundaryAdjustment({
      clip: item.clip,
      timeline: timelineSnapshot.timeline,
      side,
      nextMs: constrainBoundaryMs(item, side, nextMs),
    });
    onActiveReviewSegmentIdChange(item.segment.id);
    setPreviewRange(createStudioClipPreviewRange(previewClipForBoundary));
    setBoundaryPreview(
      buildSmartSliceTimelineBoundaryPreview(
        item,
        previewClipForBoundary,
        item.widthPx / Math.max(1, item.clip.endMs - item.clip.startMs),
        side,
      ),
    );
  }, [constrainBoundaryMs, onActiveReviewSegmentIdChange, timelineSnapshot]);

  const splitClipAtTime = useCallback((segmentId: string, requestedSplitAtMs?: number) => {
    if (!reviewSession) {
      return;
    }

    const splitResult = splitSliceReviewSegmentAtTimelinePlayhead({
      reviewSession,
      segmentId,
      ...(requestedSplitAtMs !== undefined ? { splitAtMs: requestedSplitAtMs } : {}),
    });
    if (!splitResult) {
      return;
    }

    onCommitReviewSessionDraft(reviewSession, splitResult.segments, splitResult.manualEdit, {
      processingOperations: timelineSnapshot?.processingOperations ?? [],
    });
    onActiveReviewSegmentIdChange(splitResult.createdSegmentIds[0]);
    setPreviewRange({
      startMs: Math.max(0, splitResult.splitAtMs - 500),
      endMs: Math.min(timelineDurationMs, splitResult.splitAtMs + 500),
      loop: true,
    });
    setBoundaryPreview(null);
  }, [
    onActiveReviewSegmentIdChange,
    onCommitReviewSessionDraft,
    reviewSession,
    timelineDurationMs,
    timelineSnapshot?.processingOperations,
  ]);

  const syncPreviewPlayback = useCallback((currentSeconds: number, durationSeconds: number) => {
    if (!previewRange || durationSeconds <= 0) {
      return;
    }

    const currentMs = Math.round(currentSeconds * 1_000);
    if (currentMs < previewRange.endMs) {
      return;
    }

    if (previewRange.loop) {
      onSeekPreviewMs(previewRange.startMs);
      return;
    }

    setPreviewRange(null);
  }, [onSeekPreviewMs, previewRange]);

  const reset = useCallback(() => {
    setPreviewRange(null);
    setBoundaryPreview(null);
  }, []);

  return {
    previewRange,
    boundaryPreview,
    previewReviewSegment,
    seekTimelineMs,
    previewClip,
    previewClipBoundaryDrag,
    commitClipBoundary,
    splitClipAtTime,
    syncPreviewPlayback,
    reset,
  };
}
