import { useCallback, useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

import { canSplitSmartSliceTimelineClipAtTime, clampSmartSliceTimelineMs } from './timelineModel';
import type {
  SmartSliceTimelineBoundarySide,
  SmartSliceTimelineClipItem,
} from './types';

interface UseSmartSliceTimelineInteractionsParams {
  durationMs: number;
  onSeekMs: (timeMs: number) => void;
  onPreviewClip: (item: SmartSliceTimelineClipItem) => void;
  onPreviewClipBoundaryDrag: (
    item: SmartSliceTimelineClipItem,
    side: SmartSliceTimelineBoundarySide,
    nextMs: number,
  ) => void;
  onAdjustClipBoundary: (
    item: SmartSliceTimelineClipItem,
    side: SmartSliceTimelineBoundarySide,
    nextMs: number,
  ) => void;
  onCancelClipBoundaryDrag?: () => void;
  onSplitClipAtTime: (segmentId: string, splitAtMs: number) => void;
}

function resolveSmartSliceTimelineTrackTimeMs(
  trackElement: HTMLElement,
  clientX: number,
  durationMs: number,
) {
  const rect = trackElement.getBoundingClientRect();
  const ratio = rect.width > 0
    ? Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    : 0;
  return clampSmartSliceTimelineMs(ratio * durationMs, durationMs);
}

export function useSmartSliceTimelineInteractions({
  durationMs,
  onSeekMs,
  onPreviewClip,
  onPreviewClipBoundaryDrag,
  onAdjustClipBoundary,
  onCancelClipBoundaryDrag,
  onSplitClipAtTime,
}: UseSmartSliceTimelineInteractionsParams) {
  const activeBoundaryDragCleanupRef = useRef<(() => void) | null>(null);
  const seekAtTrackClientX = useCallback((trackElement: HTMLElement, clientX: number) => {
    onSeekMs(resolveSmartSliceTimelineTrackTimeMs(trackElement, clientX, durationMs));
  }, [durationMs, onSeekMs]);

  const previewClip = useCallback((item: SmartSliceTimelineClipItem) => {
    onPreviewClip(item);
  }, [onPreviewClip]);

  const previewClipBoundaryDrag = useCallback((
    item: SmartSliceTimelineClipItem,
    side: SmartSliceTimelineBoundarySide,
    nextMs: number,
  ) => {
    onPreviewClipBoundaryDrag(item, side, clampSmartSliceTimelineMs(nextMs, durationMs));
  }, [durationMs, onPreviewClipBoundaryDrag]);

  const adjustClipBoundary = useCallback((
    item: SmartSliceTimelineClipItem,
    side: SmartSliceTimelineBoundarySide,
    nextMs: number,
  ) => {
    onAdjustClipBoundary(item, side, clampSmartSliceTimelineMs(nextMs, durationMs));
  }, [durationMs, onAdjustClipBoundary]);

  const startClipBoundaryDrag = useCallback((
    item: SmartSliceTimelineClipItem,
    side: SmartSliceTimelineBoundarySide,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const trackElement = event.currentTarget.closest('[data-testid="smart-slice-timeline-track"]');
    if (!(trackElement instanceof HTMLElement)) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    previewClipBoundaryDrag(item, side, resolveSmartSliceTimelineTrackTimeMs(trackElement, event.clientX, durationMs));

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      previewClipBoundaryDrag(
        item,
        side,
        resolveSmartSliceTimelineTrackTimeMs(trackElement, pointerEvent.clientX, durationMs),
      );
    };
    const removeWindowListeners = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      activeBoundaryDragCleanupRef.current = null;
    };
    const handlePointerUp = (pointerEvent: PointerEvent) => {
      adjustClipBoundary(
        item,
        side,
        resolveSmartSliceTimelineTrackTimeMs(trackElement, pointerEvent.clientX, durationMs),
      );
      removeWindowListeners();
    };
    const handlePointerCancel = () => {
      onCancelClipBoundaryDrag?.();
      removeWindowListeners();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    activeBoundaryDragCleanupRef.current?.();
    activeBoundaryDragCleanupRef.current = removeWindowListeners;
  }, [adjustClipBoundary, durationMs, onCancelClipBoundaryDrag, previewClipBoundaryDrag]);

  const splitClipAtTime = useCallback((item: SmartSliceTimelineClipItem | null, splitAtMs: number) => {
    if (!item || !canSplitSmartSliceTimelineClipAtTime(item, splitAtMs)) {
      return;
    }
    onSplitClipAtTime(item.segment.id, clampSmartSliceTimelineMs(splitAtMs, durationMs));
  }, [durationMs, onSplitClipAtTime]);

  useEffect(() => {
    return () => {
      activeBoundaryDragCleanupRef.current?.();
    };
  }, []);

  return {
    seekAtTrackClientX,
    onPreviewClip: previewClip,
    onPreviewClipBoundaryDrag: previewClipBoundaryDrag,
    onAdjustClipBoundary: adjustClipBoundary,
    onStartClipBoundaryDrag: startClipBoundaryDrag,
    onSplitClipAtTime: splitClipAtTime,
  };
}
