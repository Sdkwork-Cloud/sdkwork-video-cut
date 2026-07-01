import React from 'react';
import { Play } from 'lucide-react';

import type { SmartSliceTimelineBoundarySide, SmartSliceTimelineClipItem } from './types';

interface SmartSliceTimelineClipProps {
  item: SmartSliceTimelineClipItem;
  isEditable?: boolean;
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
}

export function SmartSliceTimelineClip({
  item,
  isEditable = true,
  onPreviewClip,
  onBoundaryDragStart,
  onNudgeBoundary,
}: SmartSliceTimelineClipProps) {
  const stateClassName = item.isActive
    ? 'border-cyan-400 bg-cyan-500/20'
    : item.isSelected
      ? 'border-blue-500/60 bg-blue-500/15'
      : item.isDuplicate
        ? 'border-amber-500/50 bg-amber-500/15'
        : 'border-[#3a3a3a] bg-[#151515]';

  return (
    <div
      className={`absolute top-3 h-[52px] rounded border transition-colors ${stateClassName}`}
      style={{
        left: `${item.leftPx}px`,
        width: `${item.widthPx}px`,
      }}
    >
      <button
        type="button"
        className="absolute left-0 top-0 h-full w-3 cursor-ew-resize rounded-l border-r border-white/10 bg-white/5 hover:bg-cyan-400/35 disabled:cursor-not-allowed disabled:opacity-40"
        onPointerDown={(event) => onBoundaryDragStart(item, 'left', event)}
        disabled={!isEditable}
        aria-label={`Adjust ${item.segment.title} start`}
      />
      <button
        type="button"
        className="absolute right-0 top-0 h-full w-3 cursor-ew-resize rounded-r border-l border-white/10 bg-white/5 hover:bg-cyan-400/35 disabled:cursor-not-allowed disabled:opacity-40"
        onPointerDown={(event) => onBoundaryDragStart(item, 'right', event)}
        disabled={!isEditable}
        aria-label={`Adjust ${item.segment.title} end`}
      />
      <button
        type="button"
        className="absolute left-3 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded border border-white/10 bg-black/40 text-[10px] font-bold text-gray-300 transition-colors hover:border-cyan-400/50 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-40"
        onClick={() => onNudgeBoundary(item, 'left', item.clip.startMs - 250)}
        disabled={!isEditable}
        aria-label={`Nudge ${item.segment.title} start earlier`}
      >
        -
      </button>
      <button
        type="button"
        className="absolute right-3 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded border border-white/10 bg-black/40 text-[10px] font-bold text-gray-300 transition-colors hover:border-cyan-400/50 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-40"
        onClick={() => onNudgeBoundary(item, 'right', item.clip.endMs + 250)}
        disabled={!isEditable}
        aria-label={`Nudge ${item.segment.title} end later`}
      >
        +
      </button>
      <button
        type="button"
        className="flex h-full w-full min-w-0 flex-col justify-center px-4 text-left"
        onClick={() => onPreviewClip(item)}
      >
        <span className="flex items-center gap-2 truncate text-[10px] font-semibold text-gray-100">
          <Play size={10} className="shrink-0 text-cyan-300" />
          {String(item.clip.order).padStart(2, '0')}. {item.segment.title}
        </span>
        <span className="mt-0.5 truncate text-[9px] font-mono text-gray-400">
          {item.startLabel} - {item.endLabel} / {item.durationLabel}
        </span>
      </button>
    </div>
  );
}
