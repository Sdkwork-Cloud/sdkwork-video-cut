import React from 'react';
import { PlayCircle } from 'lucide-react';

import { buildSmartSliceTimelineBoundaryPreview, canSplitSmartSliceTimelineClipAtTime, clampSmartSliceTimelineMs, findSmartSliceTimelineClipItemAtTime, formatSmartSliceTimelineTime } from './timelineModel';
import { SmartSliceTimelineClip } from './SmartSliceTimelineClip';
import { SmartSliceTimelinePlayhead } from './SmartSliceTimelinePlayhead';
import { SmartSliceTimelineSplitHandle } from './SmartSliceTimelineSplitHandle';
import type {
  SmartSliceTimelineBoundaryPreview,
  SmartSliceTimelineBoundarySide,
  SmartSliceTimelineClipItem,
  SmartSliceTimelineWorkbenchProps,
  SmartSliceTimelineViewportState,
} from './types';

interface SmartSliceTimelineTrackProps {
  clipItems: SmartSliceTimelineClipItem[];
  viewport: SmartSliceTimelineViewportState;
  currentTimeMs: number;
  durationMs: number;
  previewRange: SmartSliceTimelineWorkbenchProps['previewRange'];
  boundaryPreview: SmartSliceTimelineBoundaryPreview | null;
  isEditable: boolean;
  onSeekMs: (timeMs: number) => void;
  onPreviewClip: (item: SmartSliceTimelineClipItem) => void;
  onBoundaryDragStart: (
    item: SmartSliceTimelineClipItem,
    side: SmartSliceTimelineBoundarySide,
    event: React.PointerEvent<HTMLButtonElement>,
  ) => void;
  onNudgeBoundary: (
    item: SmartSliceTimelineClipItem,
    side: SmartSliceTimelineBoundarySide,
    nextMs: number,
  ) => void;
  onSplitClipAtTime: (item: SmartSliceTimelineClipItem | null, splitAtMs: number) => void;
  trackHeightPx?: number;
}

export function SmartSliceTimelineTrack({
  clipItems,
  currentTimeMs,
  durationMs,
  previewRange,
  boundaryPreview,
  isEditable,
  onSeekMs,
  onPreviewClip,
  onBoundaryDragStart,
  onNudgeBoundary,
  onSplitClipAtTime,
  viewport,
  trackHeightPx = 112,
}: SmartSliceTimelineTrackProps) {
  const currentPlayheadX = viewport.pxPerMs * clampSmartSliceTimelineMs(currentTimeMs, durationMs);
  const activeClip = findSmartSliceTimelineClipItemAtTime(clipItems, currentTimeMs);
  const canSplitActiveClip = canSplitSmartSliceTimelineClipAtTime(activeClip, currentTimeMs);
  const previewClipItem = previewRange
    ? findSmartSliceTimelineClipItemAtTime(clipItems, previewRange.startMs)
    : null;
  const activeTimeLabel = formatSmartSliceTimelineTime(currentTimeMs);
  const boundaryPreviewState = boundaryPreview
    ? buildSmartSliceTimelineBoundaryPreview(boundaryPreview.item, boundaryPreview.previewClip, viewport.pxPerMs, boundaryPreview.side)
    : null;

  return (
    <div
      data-testid="smart-slice-timeline-track"
      className="relative overflow-hidden rounded-md border border-[#2a2a2a] bg-[#080808]"
      style={{
        height: `${trackHeightPx}px`,
        width: `${Math.max(viewport.contentWidthPx, 1)}px`,
      }}
      data-timeline-duration-ms={durationMs}
    >
      <div
        className="absolute inset-0 cursor-crosshair"
        onMouseDown={(event) => {
          event.preventDefault();
          if (durationMs <= 0) {
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          const nextMs = Math.round(
            Math.max(0, Math.min(1, rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0)) * durationMs,
          );
          onSeekMs(nextMs);
        }}
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 border-b border-white/5 bg-gradient-to-b from-white/[0.04] to-transparent" />

      {boundaryPreviewState ? (
        <div
          data-testid="smart-slice-timeline-boundary-preview"
          className="pointer-events-none absolute top-3 z-20 h-[52px] rounded border border-cyan-300 bg-cyan-400/15 shadow-[0_0_0_1px_rgba(103,232,249,0.35)]"
          style={{
            left: `${boundaryPreviewState.leftPx}px`,
            width: `${boundaryPreviewState.widthPx}px`,
          }}
        >
          <div className="flex h-full min-w-0 flex-col justify-center px-3">
            <span className="truncate text-[10px] font-bold text-cyan-100">
              <PlayCircle size={10} className="mr-1 inline-block align-middle" />
              {String(boundaryPreviewState.item.clip.order).padStart(2, '0')}. {boundaryPreviewState.item.segment.title}
            </span>
            <span className="mt-0.5 truncate text-[9px] font-mono text-cyan-200">
              {boundaryPreviewState.startLabel} - {boundaryPreviewState.endLabel} / {boundaryPreviewState.durationLabel}
            </span>
          </div>
        </div>
      ) : null}

      {clipItems.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center text-[10px] text-gray-600">
          No editable clips
        </div>
      ) : (
        clipItems.map((item) => (
          <SmartSliceTimelineClip
            key={item.clip.id}
            item={item}
            isEditable={isEditable}
            onPreviewClip={onPreviewClip}
            onBoundaryDragStart={onBoundaryDragStart}
            onNudgeBoundary={onNudgeBoundary}
          />
        ))
      )}

      {activeClip && canSplitActiveClip ? (
        <SmartSliceTimelineSplitHandle
          leftPx={currentPlayheadX}
          label={formatSmartSliceTimelineTime(currentTimeMs)}
          disabled={!isEditable}
          onSplit={() => onSplitClipAtTime(activeClip, currentTimeMs)}
        />
      ) : null}

      <SmartSliceTimelinePlayhead
        currentTimeMs={currentTimeMs}
        leftPx={currentPlayheadX}
        onSeekMs={onSeekMs}
      />

      <div className="pointer-events-none absolute right-2 top-1 z-10 rounded bg-black/35 px-2 py-0.5 text-[9px] font-mono text-gray-500">
        {activeTimeLabel}
        {previewClipItem ? ` | ${previewClipItem.segment.title}` : ''}
      </div>
    </div>
  );
}
