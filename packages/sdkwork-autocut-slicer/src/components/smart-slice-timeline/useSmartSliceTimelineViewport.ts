import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import type { RefObject } from 'react';

import {
  clampSmartSliceTimelineMs,
  resolveSmartSliceTimelineFitPxPerSecond,
  resolveSmartSliceTimelineTickConfiguration,
} from './timelineModel';
import type { SmartSliceTimelineViewportState } from './types';

const SMART_SLICE_TIMELINE_MAX_PX_PER_SECOND = 240;
const SMART_SLICE_TIMELINE_DEFAULT_VIEWPORT_WIDTH_PX = 1_200;

interface UseSmartSliceTimelineViewportOptions {
  viewportRef?: RefObject<HTMLElement | null>;
}

export function useSmartSliceTimelineViewport(
  durationMs: number,
  { viewportRef }: UseSmartSliceTimelineViewportOptions = {},
) {
  const [viewportWidthPx, setViewportWidthPx] = useState(SMART_SLICE_TIMELINE_DEFAULT_VIEWPORT_WIDTH_PX);
  const [zoomScale, setZoomScale] = useState(1);

  const measureViewportWidth = useCallback(() => {
    const nextViewportWidthPx = viewportRef?.current?.clientWidth;
    if (nextViewportWidthPx && Number.isFinite(nextViewportWidthPx)) {
      setViewportWidthPx(Math.max(1, Math.round(nextViewportWidthPx)));
    }
  }, [viewportRef]);

  useLayoutEffect(() => {
    measureViewportWidth();
    const viewportElement = viewportRef?.current;
    if (!viewportElement) {
      return undefined;
    }

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measureViewportWidth);
      return () => window.removeEventListener('resize', measureViewportWidth);
    }

    const resizeObserver = new ResizeObserver(() => measureViewportWidth());
    resizeObserver.observe(viewportElement);
    return () => resizeObserver.disconnect();
  }, [measureViewportWidth, viewportRef]);

  useLayoutEffect(() => {
    setZoomScale(1);
  }, [durationMs]);

  const fitPxPerSecond = useMemo(
    () => resolveSmartSliceTimelineFitPxPerSecond({
      durationMs,
      viewportWidthPx,
      maxPxPerSecond: SMART_SLICE_TIMELINE_MAX_PX_PER_SECOND,
    }),
    [durationMs, viewportWidthPx],
  );
  const maxZoomScale = Math.max(1, SMART_SLICE_TIMELINE_MAX_PX_PER_SECOND / Math.max(fitPxPerSecond, 0.001));

  const viewport = useMemo<SmartSliceTimelineViewportState>(() => {
    const normalizedZoomScale = Math.max(1, Math.min(maxZoomScale, zoomScale));
    const normalizedPxPerSecond = Math.min(
      SMART_SLICE_TIMELINE_MAX_PX_PER_SECOND,
      Math.max(fitPxPerSecond, fitPxPerSecond * normalizedZoomScale),
    );
    const pxPerMs = normalizedPxPerSecond / 1_000;
    const contentWidthPx = Math.max(durationMs * pxPerMs, 1);
    return {
      pxPerMs,
      pxPerSecond: normalizedPxPerSecond,
      contentWidthPx,
      minPxPerSecond: fitPxPerSecond,
      maxPxPerSecond: SMART_SLICE_TIMELINE_MAX_PX_PER_SECOND,
      canZoomIn: normalizedPxPerSecond < SMART_SLICE_TIMELINE_MAX_PX_PER_SECOND,
      canZoomOut: normalizedZoomScale > 1,
    };
  }, [durationMs, fitPxPerSecond, maxZoomScale, zoomScale]);

  const timeToX = (timeMs: number) => clampSmartSliceTimelineMs(timeMs, durationMs) * viewport.pxPerMs;
  const xToTime = (xPx: number) => clampSmartSliceTimelineMs(xPx / viewport.pxPerMs, durationMs);
  const setPxPerSecond = (nextPxPerSecond: number | ((currentPxPerSecond: number) => number)) => {
    setZoomScale((currentZoomScale) => {
      const currentPxPerSecond = Math.min(
        SMART_SLICE_TIMELINE_MAX_PX_PER_SECOND,
        Math.max(fitPxPerSecond, fitPxPerSecond * currentZoomScale),
      );
      const resolvedPxPerSecond = typeof nextPxPerSecond === 'function'
        ? nextPxPerSecond(currentPxPerSecond)
        : nextPxPerSecond;
      return Math.max(1, Math.min(maxZoomScale, resolvedPxPerSecond / Math.max(fitPxPerSecond, 0.001)));
    });
  };
  const zoomIn = () => setZoomScale((current) => Math.min(maxZoomScale, current * 1.25));
  const zoomOut = () => setZoomScale((current) => Math.max(1, current / 1.25));
  const fitToDuration = () => {
    measureViewportWidth();
    setZoomScale(1);
  };

  return {
    viewport,
    tickConfiguration: resolveSmartSliceTimelineTickConfiguration(viewport.pxPerMs),
    timeToX,
    xToTime,
    setPxPerSecond,
    zoomIn,
    zoomOut,
    fitToDuration,
  };
}
