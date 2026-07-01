import { useCallback, useEffect, useRef } from 'react';

import { formatSmartSliceTimelineTime } from './timelineModel';

interface SmartSliceTimelinePlayheadProps {
  currentTimeMs: number;
  leftPx: number;
  onSeekMs: (timeMs: number) => void;
}

export function SmartSliceTimelinePlayhead({
  currentTimeMs,
  leftPx,
  onSeekMs,
}: SmartSliceTimelinePlayheadProps) {
  const cleanupRef = useRef<(() => void) | null>(null);
  const onSeekMsRef = useRef(onSeekMs);
  onSeekMsRef.current = onSeekMs;

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const button = event.currentTarget;
    const container = button.closest('[data-testid="smart-slice-timeline-track"]');
    if (!(container instanceof HTMLElement)) {
      return;
    }
    button.setPointerCapture(event.pointerId);
    const rect = container.getBoundingClientRect();
    const resolveSeekMs = (clientX: number) => {
      const ratio = rect.width > 0 ? Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) : 0;
      const parsed = Number(container.dataset.timelineDurationMs ?? '0');
      const safeDurationMs = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
      return Math.round(ratio * safeDurationMs);
    };
    onSeekMsRef.current(resolveSeekMs(event.clientX));

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      onSeekMsRef.current(resolveSeekMs(pointerEvent.clientX));
    };
    const handlePointerUp = () => {
      cleanup();
    };
    const handlePointerCancel = () => {
      cleanup();
    };
    const cleanup = () => {
      button.removeEventListener('pointermove', handlePointerMove);
      button.removeEventListener('pointerup', handlePointerUp);
      button.removeEventListener('pointercancel', handlePointerCancel);
      try { button.releasePointerCapture(event.pointerId); } catch { /* already released */ }
      cleanupRef.current = null;
    };
    cleanupRef.current = cleanup;

    button.addEventListener('pointermove', handlePointerMove);
    button.addEventListener('pointerup', handlePointerUp);
    button.addEventListener('pointercancel', handlePointerCancel);
  }, []);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  return (
    <button
      type="button"
      data-testid="smart-slice-timeline-playhead"
      className="absolute top-0 z-20 flex h-full w-6 -translate-x-1/2 cursor-ew-resize items-start justify-center"
      style={{ left: `${leftPx}px` }}
      onPointerDown={handlePointerDown}
      aria-label={`Playhead at ${formatSmartSliceTimelineTime(currentTimeMs)}`}
    >
      <span
        data-testid="smart-slice-timeline-playhead-handle"
        className="mt-0.5 h-3 w-3 rounded-sm border border-cyan-200 bg-cyan-400 shadow-[0_0_0_1px_rgba(103,232,249,0.35)]"
      />
      <span className="absolute bottom-0 top-0 w-0.5 bg-cyan-400 shadow-[0_0_0_1px_rgba(103,232,249,0.45)]" />
    </button>
  );
}
