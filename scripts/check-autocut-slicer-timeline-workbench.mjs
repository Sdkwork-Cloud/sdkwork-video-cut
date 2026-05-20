import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const rootDir = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(rootDir, relativePath));
}

const failures = [];
const pass = [];

function assertRule(condition, message) {
  if (condition) {
    pass.push(message);
  } else {
    failures.push(message);
  }
}

function assertExists(relativePath, message) {
  assertRule(exists(relativePath), message);
}

function assertIncludes(source, marker, message) {
  assertRule(source.includes(marker), message);
}

function assertNotIncludes(source, marker, message) {
  assertRule(!source.includes(marker), message);
}

const workbenchPath = 'packages/sdkwork-autocut-slicer/src/components/smart-slice-timeline/SmartSliceTimelineWorkbench.tsx';
const rulerPath = 'packages/sdkwork-autocut-slicer/src/components/smart-slice-timeline/SmartSliceTimelineRuler.tsx';
const trackPath = 'packages/sdkwork-autocut-slicer/src/components/smart-slice-timeline/SmartSliceTimelineTrack.tsx';
const clipPath = 'packages/sdkwork-autocut-slicer/src/components/smart-slice-timeline/SmartSliceTimelineClip.tsx';
const playheadPath = 'packages/sdkwork-autocut-slicer/src/components/smart-slice-timeline/SmartSliceTimelinePlayhead.tsx';
const splitHandlePath = 'packages/sdkwork-autocut-slicer/src/components/smart-slice-timeline/SmartSliceTimelineSplitHandle.tsx';
const typesPath = 'packages/sdkwork-autocut-slicer/src/components/smart-slice-timeline/types.ts';
const viewportHookPath = 'packages/sdkwork-autocut-slicer/src/components/smart-slice-timeline/useSmartSliceTimelineViewport.ts';
const interactionsHookPath = 'packages/sdkwork-autocut-slicer/src/components/smart-slice-timeline/useSmartSliceTimelineInteractions.ts';
const reviewControllerHookPath = 'packages/sdkwork-autocut-slicer/src/components/smart-slice-timeline/useSmartSliceTimelineReviewController.ts';
const timelineModelPath = 'packages/sdkwork-autocut-slicer/src/components/smart-slice-timeline/timelineModel.ts';
const timelineIndexPath = 'packages/sdkwork-autocut-slicer/src/components/smart-slice-timeline/index.ts';
const slicerPagePath = 'packages/sdkwork-autocut-slicer/src/pages/SlicerPage.tsx';
const clipWorkflowPath = 'packages/sdkwork-autocut-slicer/src/service/clipWorkflow.ts';

async function loadTimelineModelModule() {
  const sourcePath = path.join(rootDir, timelineModelPath);
  const sourceText = read(timelineModelPath)
    .replace(/import\s+type\s+\{[\s\S]*?\}\s+from\s+['"]@sdkwork\/autocut-types['"];\s*/u, '')
    .replace(/import\s+type\s+\{[\s\S]*?\}\s+from\s+['"]\.\/types['"];\s*/u, '');
  const transpiled = ts.transpileModule(sourceText, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      isolatedModules: true,
      moduleDetection: ts.ModuleDetectionKind.Force,
    },
    fileName: sourcePath,
  });
  const outputDir = path.join(rootDir, 'artifacts', 'timeline-workbench-modules', `${process.pid}-${Date.now().toString(36)}`);
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'timelineModel.mjs');
  fs.writeFileSync(outputPath, transpiled.outputText);
  return import(pathToFileURL(outputPath).href);
}

assertExists(workbenchPath, 'timeline workbench component file exists');
assertExists(rulerPath, 'timeline ruler component file exists');
assertExists(trackPath, 'timeline track component file exists');
assertExists(clipPath, 'timeline clip component file exists');
assertExists(playheadPath, 'timeline playhead component file exists');
assertExists(splitHandlePath, 'timeline split handle component file exists');
assertExists(typesPath, 'timeline types file exists');
assertExists(viewportHookPath, 'timeline viewport hook file exists');
assertExists(interactionsHookPath, 'timeline interactions hook file exists');
assertExists(reviewControllerHookPath, 'timeline review controller hook file exists');
assertExists(timelineModelPath, 'timeline model file exists');
assertExists(timelineIndexPath, 'timeline package barrel file exists');
assertExists(clipWorkflowPath, 'clip workflow service file exists');

if (exists(timelineIndexPath)) {
  const timelineIndexSource = read(timelineIndexPath);
  assertIncludes(timelineIndexSource, "from './SmartSliceTimelineWorkbench'", 'timeline package barrel exports the canonical workbench');
  assertIncludes(timelineIndexSource, "from './useSmartSliceTimelineReviewController'", 'timeline package barrel exports the review controller hook');
  assertIncludes(timelineIndexSource, "from './types'", 'timeline package barrel exports public timeline types');
}

if (exists(workbenchPath)) {
  const workbenchSource = read(workbenchPath);
  assertIncludes(workbenchSource, 'export function SmartSliceTimelineWorkbench', 'workbench exports the canonical editor surface');
  assertIncludes(workbenchSource, 'isEditable = true', 'workbench defaults to editable review mode while allowing source-preview read-only mode');
  assertIncludes(workbenchSource, 'useRef<HTMLDivElement | null>(null)', 'workbench owns the measured timeline viewport ref');
  assertIncludes(workbenchSource, 'viewportRef: timelineScrollViewportRef', 'workbench passes the measured viewport to the viewport hook for auto-fit zoom');
  assertIncludes(workbenchSource, 'ref={timelineScrollViewportRef}', 'workbench attaches the measured viewport ref to the scroll container');
  assertIncludes(workbenchSource, 'SmartSliceTimelineRuler', 'workbench composes the ruler component');
  assertIncludes(workbenchSource, 'SmartSliceTimelineTrack', 'workbench composes the track component');
  assertIncludes(workbenchSource, 'useSmartSliceTimelineViewport', 'workbench uses the viewport hook');
  assertIncludes(workbenchSource, 'useSmartSliceTimelineInteractions', 'workbench uses the interactions hook');
  assertIncludes(workbenchSource, "from './useSmartSliceTimelineViewport'", 'workbench imports the viewport hook from the timeline component boundary');
  assertIncludes(workbenchSource, "from './useSmartSliceTimelineInteractions'", 'workbench imports the interactions hook from the timeline component boundary');
  assertIncludes(workbenchSource, 'data-testid="smart-slice-timeline-scroll-viewport"', 'workbench keeps the ruler and clip track in one scroll-synchronized timeline viewport');
  assertIncludes(workbenchSource, 'data-testid="smart-slice-timeline-timecode-input"', 'workbench exposes precision timecode seeking');
  assertIncludes(workbenchSource, 'parseSmartSliceTimelineTimeInput', 'workbench parses professional timecode seek input through the timeline model');
  assertIncludes(workbenchSource, 'canSplitSmartSliceTimelineClipAtTime', 'workbench validates split-at-playhead eligibility before dispatching edits');
  assertRule(
    workbenchSource.indexOf('<SmartSliceTimelineRuler') > workbenchSource.indexOf('data-testid="smart-slice-timeline-scroll-viewport"') &&
      workbenchSource.indexOf('<SmartSliceTimelineTrack') > workbenchSource.indexOf('<SmartSliceTimelineRuler'),
    'workbench renders ruler before editable clips inside the shared timeline viewport',
  );
}

if (exists(trackPath)) {
  const trackSource = read(trackPath);
  assertIncludes(trackSource, 'SmartSliceTimelinePlayhead', 'track composes the playhead component');
  assertIncludes(trackSource, 'SmartSliceTimelineSplitHandle', 'track composes the split handle component');
  assertIncludes(trackSource, 'canSplitSmartSliceTimelineClipAtTime', 'track validates split handles before rendering them');
  assertIncludes(trackSource, 'disabled={!isEditable}', 'track keeps split controls visible but disabled for source-preview timelines');
  assertIncludes(trackSource, 'isEditable={isEditable}', 'track forwards editability to clip items');
}

if (exists(clipPath)) {
  const clipSource = read(clipPath);
  assertIncludes(clipSource, 'isEditable?: boolean', 'clip component accepts an explicit editable flag');
  assertIncludes(clipSource, 'disabled={!isEditable}', 'clip component keeps boundary editing controls visible but disabled for read-only source preview timelines');
}

if (exists(playheadPath)) {
  const playheadSource = read(playheadPath);
  assertIncludes(playheadSource, 'onPointerDown', 'playhead uses pointer events for desktop-grade drag seeking');
  assertIncludes(playheadSource, "window.addEventListener('pointermove'", 'playhead supports continuous drag seeking');
  assertIncludes(playheadSource, 'setPointerCapture', 'playhead captures pointer events while dragging');
  assertIncludes(playheadSource, 'data-testid="smart-slice-timeline-playhead"', 'playhead exposes a canonical test id');
  assertIncludes(playheadSource, 'data-testid="smart-slice-timeline-playhead-handle"', 'playhead renders a visible draggable handle');
  assertIncludes(playheadSource, 'w-6', 'playhead keeps a usable drag hit area instead of only a hairline target');
}

if (exists(viewportHookPath)) {
  const viewportHookSource = read(viewportHookPath);
  assertIncludes(viewportHookSource, 'export function useSmartSliceTimelineViewport', 'viewport hook exports a stable viewport API');
  assertIncludes(viewportHookSource, 'viewportRef', 'viewport hook accepts the measured timeline viewport');
  assertIncludes(viewportHookSource, 'ResizeObserver', 'viewport hook tracks container width changes for responsive fit-to-duration zoom');
  assertIncludes(viewportHookSource, 'resolveSmartSliceTimelineFitPxPerSecond', 'viewport hook computes default zoom from visible width and duration');
  assertIncludes(viewportHookSource, 'zoomScale', 'viewport hook preserves manual zoom as a scale over fit-to-duration');
  assertIncludes(viewportHookSource, 'pxPerMs', 'viewport hook manages zoom density');
  assertIncludes(viewportHookSource, 'fitToDuration', 'viewport hook supports fit-to-content');
  assertIncludes(viewportHookSource, 'timeToX', 'viewport hook exposes time-to-x conversion');
  assertIncludes(viewportHookSource, 'xToTime', 'viewport hook exposes x-to-time conversion');
}

if (exists(interactionsHookPath)) {
  const interactionsHookSource = read(interactionsHookPath);
  assertIncludes(interactionsHookSource, 'export function useSmartSliceTimelineInteractions', 'interactions hook exports the timeline event surface');
  assertIncludes(interactionsHookSource, 'onPreviewClip', 'interactions hook supports clip preview');
  assertIncludes(interactionsHookSource, 'onAdjustClipBoundary', 'interactions hook supports boundary edits');
  assertIncludes(interactionsHookSource, 'onSplitClipAtTime', 'interactions hook supports split-at-time editing');
  assertIncludes(interactionsHookSource, 'canSplitSmartSliceTimelineClipAtTime', 'interactions hook guards split-at-time edits before dispatch');
}

if (exists(reviewControllerHookPath)) {
  const reviewControllerHookSource = read(reviewControllerHookPath);
  assertIncludes(reviewControllerHookSource, 'export function useSmartSliceTimelineReviewController', 'review controller hook exports the page-facing timeline adapter');
  assertIncludes(reviewControllerHookSource, 'useState<SmartSliceTimelinePreviewRange | null>', 'review controller owns preview range state');
  assertIncludes(reviewControllerHookSource, 'useState<SmartSliceTimelineBoundaryPreview | null>', 'review controller owns boundary preview state');
  assertIncludes(reviewControllerHookSource, 'previewReviewSegment', 'review controller supports previewing a review segment');
  assertIncludes(reviewControllerHookSource, 'seekTimelineMs', 'review controller supports precise timeline seeking');
  assertIncludes(reviewControllerHookSource, 'previewClipBoundaryDrag', 'review controller supports boundary drag preview');
  assertIncludes(reviewControllerHookSource, 'commitClipBoundary', 'review controller commits boundary edits');
  assertIncludes(reviewControllerHookSource, 'splitClipAtTime', 'review controller dispatches split-at-time edits');
  assertIncludes(reviewControllerHookSource, 'syncPreviewPlayback', 'review controller owns preview loop playback behavior');
  assertIncludes(reviewControllerHookSource, 'adjustSliceReviewSegmentBoundaryOnStudioTimeline', 'review controller uses the clip workflow boundary-edit domain service');
  assertIncludes(reviewControllerHookSource, 'invalidateStudioClipProcessingOperationsForBoundaryEdit', 'review controller invalidates processing operations after boundary edits');
  assertIncludes(reviewControllerHookSource, 'splitSliceReviewSegmentAtTimelinePlayhead', 'review controller uses the clip workflow split domain service');
}

if (exists(timelineModelPath)) {
  const {
    canSplitSmartSliceTimelineClipAtTime,
    parseSmartSliceTimelineTimeInput,
    resolveSmartSliceTimelineFitPxPerSecond,
    resolveSmartSliceTimelineTickConfiguration,
  } = await loadTimelineModelModule();
  const clipItem = {
    clip: {
      id: 'clip-1',
      startMs: 10_000,
      endMs: 20_000,
    },
  };
  assertRule(parseSmartSliceTimelineTimeInput('01:02.500', 120_000) === 62_500, 'timeline model parses minute-second millisecond precision timecode input');
  assertRule(parseSmartSliceTimelineTimeInput('1:02:03', 4_000_000) === 3_723_000, 'timeline model parses hour-minute-second precision timecode input');
  assertRule(parseSmartSliceTimelineTimeInput('not-a-timecode', 120_000) === null, 'timeline model rejects invalid timecode input');
  assertRule(parseSmartSliceTimelineTimeInput('99:00', 120_000) === 120_000, 'timeline model clamps precision timecode seeking to source duration');
  assertRule(canSplitSmartSliceTimelineClipAtTime(clipItem, 15_000) === true, 'timeline model allows splits inside a clip interior');
  assertRule(canSplitSmartSliceTimelineClipAtTime(clipItem, 10_100) === false, 'timeline model blocks splits too close to the clip start');
  assertRule(canSplitSmartSliceTimelineClipAtTime(clipItem, 19_900) === false, 'timeline model blocks splits too close to the clip end');
  assertRule(typeof resolveSmartSliceTimelineFitPxPerSecond === 'function', 'timeline model exports fit-to-viewport density resolver');
  if (typeof resolveSmartSliceTimelineFitPxPerSecond === 'function') {
    assertRule(
      resolveSmartSliceTimelineFitPxPerSecond({ durationMs: 3_600_000, viewportWidthPx: 960 }) <= 0.3,
      'timeline model can fit a one-hour source inside a standard viewport instead of clamping to 24 px/s',
    );
    assertRule(
      resolveSmartSliceTimelineFitPxPerSecond({ durationMs: 60_000, viewportWidthPx: 960 }) > 10,
      'timeline model uses readable density for short clips while fitting the visible viewport',
    );
  }
  assertRule(typeof resolveSmartSliceTimelineTickConfiguration === 'function', 'timeline model exports responsive ruler tick resolver');
  if (typeof resolveSmartSliceTimelineTickConfiguration === 'function') {
    assertRule(
      resolveSmartSliceTimelineTickConfiguration(0.0001).majorTickMs >= 1_800_000,
      'timeline model uses long ruler intervals when fitting long videos into one screen',
    );
  }
}

if (exists(slicerPagePath)) {
  const slicerPageSource = read(slicerPagePath);
  assertIncludes(slicerPageSource, 'from "../components/smart-slice-timeline"', 'page consumes the timeline package through its barrel boundary');
  assertIncludes(slicerPageSource, 'createStudioClipTimelineSnapshotForSourcePreview', 'page uses the clip workflow source-preview timeline adapter after upload and during slicing');
  assertIncludes(slicerPageSource, 'sourcePreviewTimeline', 'page builds a source-preview timeline when no review session exists');
  assertIncludes(slicerPageSource, 'displayStudioClipTimelineSnapshot', 'page resolves one display timeline for upload, processing, and review states');
  assertIncludes(slicerPageSource, 'displayReviewSegments', 'page resolves one display segment list for upload, processing, and review states');
  assertIncludes(slicerPageSource, 'isEditable={Boolean(effectiveReviewSession)}', 'page keeps source-preview timeline read-only and review timeline editable');
  assertNotIncludes(slicerPageSource, '{activeStudioClipTimelineSnapshot ? (', 'page does not gate timeline rendering on review-only snapshots');
  assertNotIncludes(slicerPageSource, 'from "../components/smart-slice-timeline/SmartSliceTimelineWorkbench"', 'page does not import the timeline workbench implementation file directly');
  assertNotIncludes(slicerPageSource, 'from "../components/smart-slice-timeline/timelineModel"', 'page does not import timeline model internals directly');
  assertNotIncludes(slicerPageSource, 'from "../components/smart-slice-timeline/types"', 'page does not import timeline types internals directly');
  assertNotIncludes(slicerPageSource, 'const [studioClipPreviewRange', 'page no longer owns timeline preview range state');
  assertNotIncludes(slicerPageSource, 'setStudioClipPreviewRange', 'page no longer mutates timeline preview range state directly');
  assertNotIncludes(slicerPageSource, 'smartSliceTimelineBoundaryPreview', 'page no longer owns timeline boundary preview state');
  assertNotIncludes(slicerPageSource, 'setSmartSliceTimelineBoundaryPreview', 'page no longer mutates timeline boundary preview state directly');
  assertNotIncludes(slicerPageSource, 'handleSmartSliceTimelineSeekMs', 'page no longer owns timeline seek handler plumbing');
  assertNotIncludes(slicerPageSource, 'handlePreviewSmartSliceTimelineClip', 'page no longer owns timeline clip preview handler plumbing');
  assertNotIncludes(slicerPageSource, 'resolveSmartSliceTimelineNeighborBounds', 'page no longer owns timeline neighbor boundary calculations');
  assertNotIncludes(slicerPageSource, 'constrainSmartSliceTimelineBoundaryMs', 'page no longer owns timeline boundary constraint calculations');
  assertNotIncludes(slicerPageSource, 'handleCommitSmartSliceTimelineClipBoundary', 'page no longer owns timeline boundary commit handler plumbing');
  assertNotIncludes(slicerPageSource, 'handlePreviewSmartSliceTimelineClipBoundaryDrag', 'page no longer owns timeline boundary drag preview handler plumbing');
  assertNotIncludes(slicerPageSource, 'const studioClipTimelineItems = useMemo<StudioClipTimelineItem[]>', 'page no longer owns timeline item geometry');
  assertNotIncludes(slicerPageSource, 'handlePreviewStudioClipBoundaryDrag', 'page no longer owns boundary drag preview logic');
  assertNotIncludes(slicerPageSource, 'handleDragStudioClipBoundary', 'page no longer owns boundary drag pointer plumbing');
  assertNotIncludes(slicerPageSource, 'handleAdjustStudioClipBoundary', 'page no longer owns boundary commit plumbing');
  assertNotIncludes(slicerPageSource, 'handlePreviewStudioClip(', 'page no longer owns clip preview plumbing');
  assertNotIncludes(slicerPageSource, 'data-testid="studio-clip-timeline"', 'page no longer renders the inline timeline strip');
  assertNotIncludes(slicerPageSource, 'studioClipTimelineItems.map(', 'page no longer renders inline clip bars directly');
}

if (exists(clipWorkflowPath)) {
  const clipWorkflowSource = read(clipWorkflowPath);
  assertIncludes(clipWorkflowSource, 'export function createStudioClipTimelineSnapshotForSourcePreview', 'clip workflow service creates source-preview timeline snapshots for the unified slicer workbench');
  assertIncludes(clipWorkflowSource, "engineId: 'manual-timeline-v1'", 'source-preview timeline uses the manual timeline engine contract');
  assertIncludes(clipWorkflowSource, 'processingOperations: []', 'source-preview timeline does not create processing operation debt before review analysis');
}

if (failures.length > 0) {
  console.error('AutoCut slicer timeline workbench check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  console.error(`\n${pass.length} checks passed, ${failures.length} checks failed.`);
  process.exitCode = 1;
} else {
  console.log(`AutoCut slicer timeline workbench check passed (${pass.length} checks).`);
}
