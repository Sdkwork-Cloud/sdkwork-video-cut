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
  return (
    <button
      type="button"
      data-testid="smart-slice-timeline-playhead"
      className="absolute top-0 z-20 flex h-full w-6 -translate-x-1/2 cursor-ew-resize items-start justify-center"
      style={{ left: `${leftPx}px` }}
      onPointerDown={(event) => {
        const container = event.currentTarget.closest('[data-testid="smart-slice-timeline-track"]');
        if (!(container instanceof HTMLElement)) {
          return;
        }
        const rect = container.getBoundingClientRect();
        const resolveSeekMs = (clientX: number) => {
          const ratio = rect.width > 0 ? Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) : 0;
          return Math.round(ratio * Number(container.dataset.timelineDurationMs ?? '0'));
        };
        onSeekMs(resolveSeekMs(event.clientX));
        event.currentTarget.setPointerCapture(event.pointerId);
        const handlePointerMove = (pointerEvent: PointerEvent) => {
          onSeekMs(resolveSeekMs(pointerEvent.clientX));
        };
        const removeWindowListeners = () => {
          window.removeEventListener('pointermove', handlePointerMove);
          window.removeEventListener('pointerup', removeWindowListeners);
          window.removeEventListener('pointercancel', removeWindowListeners);
        };
        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', removeWindowListeners);
        window.addEventListener('pointercancel', removeWindowListeners);
      }}
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
