import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Pause, Play, Scissors, ZoomIn, ZoomOut } from 'lucide-react';

import {
  buildSmartSliceTimelineClipItems,
  canSplitSmartSliceTimelineClipAtTime,
  formatSmartSliceTimelineTime,
  parseSmartSliceTimelineTimeInput,
} from './timelineModel';
import { SmartSliceTimelineRuler } from './SmartSliceTimelineRuler';
import { SmartSliceTimelineTrack } from './SmartSliceTimelineTrack';
import { useSmartSliceTimelineInteractions } from './useSmartSliceTimelineInteractions';
import { useSmartSliceTimelineViewport } from './useSmartSliceTimelineViewport';
import type { SmartSliceTimelineWorkbenchProps } from './types';

interface SmartSliceTimelineWorkbenchViewProps extends SmartSliceTimelineWorkbenchProps {
  isPlaying: boolean;
  onTogglePlay: () => void;
}

export function SmartSliceTimelineWorkbench({
  snapshot,
  reviewSegments,
  activeReviewSegmentId,
  currentTimeMs,
  durationMs,
  previewRange,
  boundaryPreview,
  isEditable = true,
  onSeekMs,
  onPreviewClip,
  onPreviewClipBoundaryDrag,
  onCommitClipBoundary,
  onSplitClipAtTime,
  isPlaying,
  onTogglePlay,
}: SmartSliceTimelineWorkbenchViewProps) {
  const timelineScrollViewportRef = useRef<HTMLDivElement | null>(null);
  const { viewport, tickConfiguration, timeToX, zoomIn, zoomOut, fitToDuration } = useSmartSliceTimelineViewport(durationMs, {
    viewportRef: timelineScrollViewportRef,
  });
  const [timecodeInput, setTimecodeInput] = useState(() => formatSmartSliceTimelineTime(currentTimeMs));
  const [isEditingTimecode, setIsEditingTimecode] = useState(false);
  const timelineInteractions = useSmartSliceTimelineInteractions({
    durationMs,
    onSeekMs,
    onPreviewClip,
    onPreviewClipBoundaryDrag,
    onAdjustClipBoundary: onCommitClipBoundary,
    onSplitClipAtTime,
  });
  const clipItems = useMemo(
    () => buildSmartSliceTimelineClipItems(snapshot, reviewSegments, viewport.pxPerMs, activeReviewSegmentId),
    [activeReviewSegmentId, reviewSegments, snapshot, viewport.pxPerMs],
  );
  const activeClip = useMemo(
    () => clipItems.find((item) => currentTimeMs >= item.clip.startMs && currentTimeMs < item.clip.endMs) ?? clipItems.at(-1) ?? null,
    [clipItems, currentTimeMs],
  );
  const canSplitActiveClip = canSplitSmartSliceTimelineClipAtTime(activeClip, currentTimeMs);
  const currentLabel = formatSmartSliceTimelineTime(currentTimeMs);
  const durationLabel = formatSmartSliceTimelineTime(durationMs);
  const previewLabel = previewRange
    ? `${formatSmartSliceTimelineTime(previewRange.startMs)} - ${formatSmartSliceTimelineTime(previewRange.endMs)}`
    : '';
  const boundaryLabel = boundaryPreview
    ? `${boundaryPreview.startLabel} - ${boundaryPreview.endLabel}`
    : '';
  const viewportDensityLabel = viewport.pxPerSecond >= 10
    ? viewport.pxPerSecond.toFixed(0)
    : viewport.pxPerSecond >= 1
      ? viewport.pxPerSecond.toFixed(1)
      : viewport.pxPerSecond.toFixed(2);
  useEffect(() => {
    if (!isEditingTimecode) {
      setTimecodeInput(currentLabel);
    }
  }, [currentLabel, isEditingTimecode]);

  const commitTimecodeInput = () => {
    const parsedTimeMs = parseSmartSliceTimelineTimeInput(timecodeInput, durationMs);
    setIsEditingTimecode(false);
    if (parsedTimeMs === null) {
      setTimecodeInput(currentLabel);
      return;
    }
    onSeekMs(parsedTimeMs);
  };

  return (
    <section className="flex w-full flex-col border border-[#262626] bg-[#0a0a0a]">
      <div className="flex items-center justify-between gap-3 border-b border-[#222] bg-[#111] px-3 py-2">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300">Timeline workbench</div>
          <div className="mt-0.5 truncate text-[10px] text-gray-500">
            {clipItems.length} clips | {durationLabel} source | {viewportDensityLabel} px/s
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            data-testid="smart-slice-timeline-timecode-input"
            type="text"
            value={timecodeInput}
            inputMode="decimal"
            className="h-8 w-20 rounded border border-[#2a2a2a] bg-[#0b0b0b] px-2 text-center font-mono text-[10px] text-gray-200 outline-none transition-colors focus:border-cyan-400"
            onFocus={() => setIsEditingTimecode(true)}
            onChange={(event) => setTimecodeInput(event.target.value)}
            onBlur={commitTimecodeInput}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                commitTimecodeInput();
              }
              if (event.key === 'Escape') {
                setIsEditingTimecode(false);
                setTimecodeInput(currentLabel);
              }
            }}
            aria-label="Seek timeline timecode"
          />
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded border border-[#2a2a2a] bg-[#151515] text-gray-300 transition-colors hover:border-cyan-400/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            onClick={zoomOut}
            disabled={!viewport.canZoomOut}
            title="Zoom out"
            aria-label="Zoom out"
          >
            <ZoomOut size={13} />
          </button>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded border border-[#2a2a2a] bg-[#151515] text-gray-300 transition-colors hover:border-cyan-400/40 hover:text-white"
            onClick={fitToDuration}
            title="Fit to duration"
            aria-label="Fit to duration"
          >
            <Maximize2 size={13} />
          </button>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded border border-[#2a2a2a] bg-[#151515] text-gray-300 transition-colors hover:border-cyan-400/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            onClick={zoomIn}
            disabled={!viewport.canZoomIn}
            title="Zoom in"
            aria-label="Zoom in"
          >
            <ZoomIn size={13} />
          </button>
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1 rounded border border-[#2a2a2a] bg-[#151515] px-3 text-[10px] font-semibold text-gray-200 transition-colors hover:border-cyan-400/40 hover:text-white"
            onClick={onTogglePlay}
          >
            {isPlaying ? <Pause size={12} /> : <Play size={12} />}
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1 rounded border border-[#2a2a2a] bg-[#151515] px-3 text-[10px] font-semibold text-gray-200 transition-colors hover:border-cyan-400/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            title="Split clip at playhead"
            aria-label="Split clip at playhead"
            onClick={() => {
              timelineInteractions.onSplitClipAtTime(activeClip, currentTimeMs);
            }}
            disabled={!isEditable || !activeClip || !canSplitActiveClip}
          >
            <Scissors size={12} />
          </button>
        </div>
      </div>

      <div
        ref={timelineScrollViewportRef}
        data-testid="smart-slice-timeline-scroll-viewport"
        className="overflow-x-auto border-b border-[#222]"
      >
        <SmartSliceTimelineRuler
          durationMs={durationMs}
          viewport={viewport}
          majorTickMs={tickConfiguration.majorTickMs}
          minorTickMs={tickConfiguration.minorTickMs}
          timeToX={timeToX}
        />
        <div className="px-3 py-3">
          <SmartSliceTimelineTrack
            clipItems={clipItems}
            viewport={viewport}
            currentTimeMs={currentTimeMs}
            durationMs={durationMs}
            previewRange={previewRange}
            boundaryPreview={boundaryPreview}
            isEditable={isEditable}
            onSeekMs={onSeekMs}
            onPreviewClip={timelineInteractions.onPreviewClip}
            onBoundaryDragStart={timelineInteractions.onStartClipBoundaryDrag}
            onNudgeBoundary={timelineInteractions.onAdjustClipBoundary}
            onSplitClipAtTime={timelineInteractions.onSplitClipAtTime}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 bg-[#0f0f0f] px-3 py-2 text-[10px] text-gray-500">
        <div className="min-w-0 truncate">
          {currentLabel}
          {activeClip ? ` | ${activeClip.segment.title}` : ''}
        </div>
        <div className="min-w-0 truncate text-right">
          {previewLabel ? `Preview ${previewLabel}` : 'Preview idle'}
          {boundaryLabel ? ` | Edit ${boundaryLabel}` : ''}
        </div>
      </div>
    </section>
  );
}
