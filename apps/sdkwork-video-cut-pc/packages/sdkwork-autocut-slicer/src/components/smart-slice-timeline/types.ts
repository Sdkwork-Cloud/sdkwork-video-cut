import type {
  AutoCutSliceReviewSegment,
  AutoCutStudioClipTimelineSnapshot,
  StudioClip,
} from '@sdkwork/autocut-types';

export type SmartSliceTimelineBoundarySide = 'left' | 'right';

export interface SmartSliceTimelineClipItem {
  clip: StudioClip;
  segment: AutoCutSliceReviewSegment;
  index: number;
  leftPx: number;
  widthPx: number;
  startLabel: string;
  endLabel: string;
  durationLabel: string;
  isActive: boolean;
  isSelected: boolean;
  isDuplicate: boolean;
}

export interface SmartSliceTimelineBoundaryPreview {
  item: SmartSliceTimelineClipItem;
  previewClip: StudioClip;
  side: SmartSliceTimelineBoundarySide;
  leftPx: number;
  widthPx: number;
  startLabel: string;
  endLabel: string;
  durationLabel: string;
}

export interface SmartSliceTimelineViewportState {
  pxPerMs: number;
  pxPerSecond: number;
  contentWidthPx: number;
  minPxPerSecond: number;
  maxPxPerSecond: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
}

export interface SmartSliceTimelineWorkbenchProps {
  snapshot: AutoCutStudioClipTimelineSnapshot | null;
  reviewSegments: readonly AutoCutSliceReviewSegment[];
  activeReviewSegmentId: string;
  currentTimeMs: number;
  durationMs: number;
  previewRange: { startMs: number; endMs: number; loop: boolean } | null;
  boundaryPreview: SmartSliceTimelineBoundaryPreview | null;
  isEditable?: boolean;
  onSeekMs: (timeMs: number) => void;
  onPreviewClip: (item: SmartSliceTimelineClipItem) => void;
  onPreviewClipBoundaryDrag: (
    item: SmartSliceTimelineClipItem,
    side: SmartSliceTimelineBoundarySide,
    nextMs: number,
  ) => void;
  onCommitClipBoundary: (
    item: SmartSliceTimelineClipItem,
    side: SmartSliceTimelineBoundarySide,
    nextMs: number,
  ) => void;
  onCancelClipBoundaryDrag?: () => void;
  onSplitClipAtTime: (segmentId: string, splitAtMs: number) => void;
}
