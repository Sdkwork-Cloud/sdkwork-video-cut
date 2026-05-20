import type {
  AutoCutSliceReviewSegment,
  AutoCutStudioClipTimelineSnapshot,
} from '@sdkwork/autocut-types';

import type {
  SmartSliceTimelineBoundaryPreview,
  SmartSliceTimelineClipItem,
} from './types';

const SMART_SLICE_TIMELINE_MAJOR_TICK_INTERVALS_MS = [
  1_000,
  2_000,
  5_000,
  10_000,
  15_000,
  30_000,
  60_000,
  120_000,
  300_000,
  600_000,
  900_000,
  1_800_000,
  3_600_000,
  7_200_000,
  21_600_000,
] as const;
const SMART_SLICE_TIMELINE_MIN_SPLIT_EDGE_DISTANCE_MS = 500;
const SMART_SLICE_TIMELINE_FALLBACK_VIEWPORT_WIDTH_PX = 1_200;
const SMART_SLICE_TIMELINE_HORIZONTAL_INSET_PX = 24;
const SMART_SLICE_TIMELINE_MIN_FIT_PX_PER_SECOND = 0.001;
const SMART_SLICE_TIMELINE_MAX_FIT_PX_PER_SECOND = 240;

export interface SmartSliceTimelineFitPxPerSecondParams {
  durationMs: number;
  viewportWidthPx: number;
  horizontalInsetPx?: number;
  maxPxPerSecond?: number;
}

export function clampSmartSliceTimelineMs(value: number, durationMs: number) {
  if (!Number.isFinite(value) || durationMs <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(durationMs, Math.round(value)));
}

export function formatSmartSliceTimelineTime(timeInMs: number) {
  if (!Number.isFinite(timeInMs) || timeInMs <= 0) {
    return '00:00';
  }

  const totalSeconds = Math.floor(timeInMs / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');

  if (hours > 0) {
    return `${hours}:${minutes}:${seconds}`;
  }

  return `${minutes}:${seconds}`;
}

export function parseSmartSliceTimelineTimeInput(value: string, durationMs: number) {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return null;
  }

  const parts = normalizedValue.split(':').map((part) => part.trim());
  if (parts.length > 3 || parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part))) {
    return null;
  }

  const numericParts = parts.map((part) => Number(part));
  if (numericParts.some((part) => !Number.isFinite(part))) {
    return null;
  }

  const totalSeconds = numericParts.reduce((total, part, index) => {
    const remainingParts = numericParts.length - index - 1;
    return total + part * (remainingParts === 2 ? 3_600 : remainingParts === 1 ? 60 : 1);
  }, 0);

  return clampSmartSliceTimelineMs(totalSeconds * 1_000, durationMs);
}

export function resolveSmartSliceTimelineFitPxPerSecond({
  durationMs,
  viewportWidthPx,
  horizontalInsetPx = SMART_SLICE_TIMELINE_HORIZONTAL_INSET_PX,
  maxPxPerSecond = SMART_SLICE_TIMELINE_MAX_FIT_PX_PER_SECOND,
}: SmartSliceTimelineFitPxPerSecondParams) {
  const normalizedDurationSeconds = Math.max(1, Math.round(durationMs) / 1_000);
  const normalizedViewportWidthPx = Number.isFinite(viewportWidthPx) && viewportWidthPx > 0
    ? Math.round(viewportWidthPx)
    : SMART_SLICE_TIMELINE_FALLBACK_VIEWPORT_WIDTH_PX;
  const availableWidthPx = Math.max(1, normalizedViewportWidthPx - Math.max(0, Math.round(horizontalInsetPx)));
  return Math.min(
    Math.max(1, maxPxPerSecond),
    Math.max(SMART_SLICE_TIMELINE_MIN_FIT_PX_PER_SECOND, availableWidthPx / normalizedDurationSeconds),
  );
}

export function canSplitSmartSliceTimelineClipAtTime(
  item: SmartSliceTimelineClipItem | null,
  splitAtMs: number,
  minEdgeDistanceMs = SMART_SLICE_TIMELINE_MIN_SPLIT_EDGE_DISTANCE_MS,
) {
  if (!item || !Number.isFinite(splitAtMs)) {
    return false;
  }

  return splitAtMs >= item.clip.startMs + minEdgeDistanceMs &&
    splitAtMs <= item.clip.endMs - minEdgeDistanceMs;
}

export function resolveSmartSliceTimelineTickConfiguration(pxPerMs: number) {
  const pxPerSecond = pxPerMs * 1_000;
  const majorTickMs = SMART_SLICE_TIMELINE_MAJOR_TICK_INTERVALS_MS.find((intervalMs) =>
    intervalMs * pxPerMs >= 96,
  ) ?? SMART_SLICE_TIMELINE_MAJOR_TICK_INTERVALS_MS.at(-1) ?? 60_000;
  const minorTickMs = majorTickMs <= 5_000
    ? 1_000
    : majorTickMs <= 30_000
      ? 5_000
      : majorTickMs / 5;

  return {
    majorTickMs,
    minorTickMs,
    pxPerSecond,
  };
}

export function buildSmartSliceTimelineClipItems(
  snapshot: AutoCutStudioClipTimelineSnapshot | null,
  reviewSegments: readonly AutoCutSliceReviewSegment[],
  pxPerMs: number,
  activeReviewSegmentId: string,
): SmartSliceTimelineClipItem[] {
  if (!snapshot) {
    return [];
  }

  const segmentById = new Map(reviewSegments.map((segment) => [segment.id, segment]));
  return snapshot.clips
    .map((clip, index) => {
      const reviewSegmentId = typeof clip.metadata?.reviewSegmentId === 'string'
        ? clip.metadata.reviewSegmentId
        : '';
      const segment = segmentById.get(reviewSegmentId);
      if (!segment) {
        return null;
      }

      const leftPx = Math.max(0, clip.startMs * pxPerMs);
      const widthPx = Math.max(1, (clip.endMs - clip.startMs) * pxPerMs);

      return {
        clip,
        segment,
        index,
        leftPx,
        widthPx,
        startLabel: formatSmartSliceTimelineTime(clip.startMs),
        endLabel: formatSmartSliceTimelineTime(clip.endMs),
        durationLabel: formatSmartSliceTimelineTime(clip.endMs - clip.startMs),
        isActive: segment.id === activeReviewSegmentId,
        isSelected: segment.selected && segment.status === 'selected',
        isDuplicate: segment.status === 'duplicate',
      } satisfies SmartSliceTimelineClipItem;
    })
    .filter((item): item is SmartSliceTimelineClipItem => item !== null);
}

export function buildSmartSliceTimelineBoundaryPreview(
  item: SmartSliceTimelineClipItem,
  previewClip: SmartSliceTimelineBoundaryPreview['previewClip'],
  pxPerMs: number,
  side: SmartSliceTimelineBoundaryPreview['side'],
): SmartSliceTimelineBoundaryPreview {
  return {
    item,
    previewClip,
    side,
    leftPx: Math.max(0, previewClip.startMs * pxPerMs),
    widthPx: Math.max(1, (previewClip.endMs - previewClip.startMs) * pxPerMs),
    startLabel: formatSmartSliceTimelineTime(previewClip.startMs),
    endLabel: formatSmartSliceTimelineTime(previewClip.endMs),
    durationLabel: formatSmartSliceTimelineTime(previewClip.endMs - previewClip.startMs),
  };
}

export function findSmartSliceTimelineClipItemAtTime(
  clipItems: readonly SmartSliceTimelineClipItem[],
  currentTimeMs: number,
) {
  return clipItems.find((item) => currentTimeMs >= item.clip.startMs && currentTimeMs < item.clip.endMs) ??
    clipItems.at(-1) ??
    null;
}
