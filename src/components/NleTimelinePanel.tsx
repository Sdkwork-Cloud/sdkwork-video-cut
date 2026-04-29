import type { NleTimelineDocument, NleTimelineClip } from '../domain/nleTimeline';

export function NleTimelinePanel({
  selectedSegmentId,
  timeline,
  onSelectSegment,
}: {
  selectedSegmentId?: string;
  timeline?: NleTimelineDocument;
  onSelectSegment: (segmentId: string) => void;
}) {
  if (!timeline) {
    return (
      <section className="nle-timeline nle-timeline--empty" aria-label="NLE timeline">
        <span>Timeline</span>
      </section>
    );
  }

  return (
    <section className="nle-timeline" aria-label="NLE timeline">
      <div className="nle-timeline-header">
        <strong>NLE Timeline</strong>
        <span>Revision {timeline.planRevision}</span>
      </div>
      <div className="nle-timeline-ruler" aria-hidden="true">
        <span>0 ms</span>
        <span>{formatMs(timeline.durationMs)}</span>
      </div>
      <div className="nle-timeline-tracks">
        {timeline.tracks.map((track) => (
          <div className="nle-track" key={track.trackId}>
            <span className="nle-track-label">{track.label}</span>
            <div className="nle-track-lane">
              {track.clips.length === 0 ? (
                <span className="nle-track-empty">empty</span>
              ) : (
                track.clips.map((clip) => (
                  <TimelineClip
                    clip={clip}
                    durationMs={timeline.durationMs}
                    key={clip.clipId}
                    selected={Boolean(clip.segmentId && clip.segmentId === selectedSegmentId)}
                    onSelectSegment={onSelectSegment}
                  />
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function TimelineClip({
  clip,
  durationMs,
  selected,
  onSelectSegment,
}: {
  clip: NleTimelineClip;
  durationMs: number;
  selected: boolean;
  onSelectSegment: (segmentId: string) => void;
}) {
  const style = {
    left: `${percentage(clip.startMs, durationMs)}%`,
    width: `${Math.max(percentage(clip.endMs - clip.startMs, durationMs), 2)}%`,
  };
  const className = selected ? `nle-clip nle-clip--${clip.kind} nle-clip--selected` : `nle-clip nle-clip--${clip.kind}`;

  if (clip.segmentId && clip.kind === 'source-segment') {
    return (
      <button
        type="button"
        className={className}
        style={style}
        aria-label={`Select timeline segment ${clip.label}`}
        onClick={() => onSelectSegment(clip.segmentId!)}
      >
        <span>{clip.label}</span>
      </button>
    );
  }

  return (
    <span className={className} style={style} title={clip.label}>
      <span>{clip.label}</span>
    </span>
  );
}

function percentage(value: number, durationMs: number): number {
  if (durationMs <= 0) {
    return 0;
  }
  return Math.min(Math.max((value / durationMs) * 100, 0), 100);
}

function formatMs(value: number): string {
  if (value >= 60_000) {
    return `${Math.round(value / 1000)} s`;
  }
  return `${value} ms`;
}
