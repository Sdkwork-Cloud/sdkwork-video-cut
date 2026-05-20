import type { SmartSliceTimelineViewportState } from './types';
import { formatSmartSliceTimelineTime } from './timelineModel';

interface SmartSliceTimelineRulerProps {
  durationMs: number;
  viewport: SmartSliceTimelineViewportState;
  majorTickMs: number;
  minorTickMs: number;
  timeToX: (timeMs: number) => number;
}

export function SmartSliceTimelineRuler({
  durationMs,
  viewport,
  majorTickMs,
  minorTickMs,
  timeToX,
}: SmartSliceTimelineRulerProps) {
  const majorTicks = [];
  for (let timeMs = 0; timeMs <= durationMs; timeMs += majorTickMs) {
    majorTicks.push(timeMs);
  }

  const minorTicks = [];
  for (let timeMs = 0; timeMs <= durationMs; timeMs += minorTickMs) {
    if (timeMs % majorTickMs !== 0) {
      minorTicks.push(timeMs);
    }
  }
  const viewportDensityLabel = viewport.pxPerSecond >= 10
    ? viewport.pxPerSecond.toFixed(0)
    : viewport.pxPerSecond >= 1
      ? viewport.pxPerSecond.toFixed(1)
      : viewport.pxPerSecond.toFixed(2);

  return (
    <div className="border-b border-[#222] bg-[#0d0d0d] px-3 py-2">
      <div
        className="relative h-10 rounded border border-[#1f1f1f] bg-[#0a0a0a]"
        style={{ width: `${Math.max(viewport.contentWidthPx, 1)}px` }}
      >
        <div className="absolute inset-0">
          {minorTicks.map((timeMs) => (
            <div
              key={`minor-${timeMs}`}
              className="absolute bottom-0 h-2 w-px bg-white/10"
              style={{ left: `${timeToX(timeMs)}px` }}
            />
          ))}
          {majorTicks.map((timeMs) => (
            <div
              key={`major-${timeMs}`}
              className="absolute bottom-0 h-5 w-px bg-white/30"
              style={{ left: `${timeToX(timeMs)}px` }}
            >
              <span className="absolute left-1 top-0 -translate-y-0.5 whitespace-nowrap text-[10px] font-mono text-gray-400">
                {formatSmartSliceTimelineTime(timeMs)}
              </span>
            </div>
          ))}
        </div>
        <div className="pointer-events-none absolute right-2 top-1 text-[10px] font-mono text-gray-500">
          {formatSmartSliceTimelineTime(durationMs)} | {viewportDensityLabel} px/s
        </div>
      </div>
    </div>
  );
}
