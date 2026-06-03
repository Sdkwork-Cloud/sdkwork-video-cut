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
  const safeDurationMs = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 1;
  const [viewportWidthPx, setViewportWidthPx] = useState(SMART_SLICE_TIMELINE_DEFAULT_VIEWPORT_WIDTH_PX);
  const [zoomScale, setZoomScale] = useState(1);

  const measureViewportWidth = useCallback(() => {
    const nextViewportWidthPx = viewportRef?.current?.clientWidth;
    if (nextViewportWidthPx !== undefined && nextViewportWidthPx !== null && Number.isFinite(nextViewportWidthPx) && nextViewportWidthPx > 0) {
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
  }, [safeDurationMs]);

  const fitPxPerSecond = useMemo(
    () => resolveSmartSliceTimelineFitPxPerSecond({
      durationMs: safeDurationMs,
      viewportWidthPx,
      maxPxPerSecond: SMART_SLICE_TIMELINE_MAX_PX_PER_SECOND,
    }),
    [safeDurationMs, viewportWidthPx],
  );
  const maxZoomScale = Math.max(1, SMART_SLICE_TIMELINE_MAX_PX_PER_SECOND / Math.max(fitPxPerSecond, 0.001));

  const viewport = useMemo<SmartSliceTimelineViewportState>(() => {
    const normalizedZoomScale = Math.max(1, Math.min(maxZoomScale, zoomScale));
    const normalizedPxPerSecond = Math.min(
      SMART_SLICE_TIMELINE_MAX_PX_PER_SECOND,
      Math.max(fitPxPerSecond, fitPxPerSecond * normalizedZoomScale),
    );
    const pxPerMs = normalizedPxPerSecond / 1_000;
    const contentWidthPx = Math.max(safeDurationMs * pxPerMs, 1);
    return {
      pxPerMs,
      pxPerSecond: normalizedPxPerSecond,
      contentWidthPx,
      minPxPerSecond: fitPxPerSecond,
      maxPxPerSecond: SMART_SLICE_TIMELINE_MAX_PX_PER_SECOND,
      canZoomIn: normalizedPxPerSecond < SMART_SLICE_TIMELINE_MAX_PX_PER_SECOND,
      canZoomOut: normalizedZoomScale > 1,
    };
  }, [safeDurationMs, fitPxPerSecond, maxZoomScale, zoomScale]);

  const timeToX = useCallback((timeMs: number) => clampSmartSliceTimelineMs(timeMs, safeDurationMs) * viewport.pxPerMs, [safeDurationMs, viewport.pxPerMs]);
  const xToTime = useCallback((xPx: number) => clampSmartSliceTimelineMs(xPx / viewport.pxPerMs, safeDurationMs), [safeDurationMs, viewport.pxPerMs]);
  const setPxPerSecond = useCallback((nextPxPerSecond: number | ((currentPxPerSecond: number) => number)) => {
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
  }, [fitPxPerSecond, maxZoomScale]);
  const zoomIn = useCallback(() => setZoomScale((current) => Math.min(maxZoomScale, current * 1.25)), [maxZoomScale]);
  const zoomOut = useCallback(() => setZoomScale((current) => Math.max(1, current / 1.25)), []);
  const fitToDuration = useCallback(() => {
    measureViewportWidth();
    setZoomScale(1);
  }, [measureViewportWidth]);

  const tickConfiguration = useMemo(
    () => resolveSmartSliceTimelineTickConfiguration(viewport.pxPerMs),
    [viewport.pxPerMs],
  );

  return {
    viewport,
    tickConfiguration,
    timeToX,
    xToTime,
    setPxPerSecond,
    zoomIn,
    zoomOut,
    fitToDuration,
  };
}
