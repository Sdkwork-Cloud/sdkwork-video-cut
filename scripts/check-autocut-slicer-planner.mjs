import path from 'node:path';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import {
  buildTranscriptSliceCandidates,
  createSmartSliceAudioActivitySourceSegments,
  createDeterministicSlicePlan,
  createSmartSliceSpeechSourceSegments,
  createSmartSliceTranscriptAudioMuteRanges,
  createTranscriptAssistedSlicePlan,
  getVideoSlicePlanningPolicy,
  normalizeSmartSliceTranscriptEvidenceText,
  normalizeCandidateSlicePlan,
  parseLlmSlicePlan,
  refineSmartSlicePlanWithAudioActivityBoundaries,
  repairSmartSliceClipTimingForNativeRender,
  normalizeSmartSliceTranscriptSegmentsForPlanning,
  validateVideoSliceParams,
} from '../packages/sdkwork-autocut-slicer/src/service/slicePlanner.ts';
import {
  createSmartCutEngineSlicePlan,
  createSmartCutEngineLlmReview,
  SmartCutEngineSlicePlanningError,
} from '../packages/sdkwork-autocut-slicer/src/service/smartCutEnginePlanner.ts';
import {
  AUTOCUT_DEFAULT_SMART_SLICE_SEGMENTATION_AGENT_ID,
  AUTOCUT_SMART_SLICE_SEGMENTATION_AGENTS,
  getAutoCutSmartSliceSegmentationAgentDefinition,
} from '../packages/sdkwork-autocut-types/src/index.ts';

const clipWorkflowSourcePath = 'packages/sdkwork-autocut-slicer/src/service/clipWorkflow.ts';
const clipWorkflowModule = await loadClipWorkflowModule();
const {
  adjustStudioClipBoundary,
  adjustSliceReviewSegmentBoundaryOnStudioTimeline,
  correctSliceReviewSegmentOnStudioTimeline,
  createSliceReviewManualEdit,
  createSliceReviewSessionFromSegments,
  AUTOCUT_INTELLIGENT_SLICING_ENGINE_TEMPLATES,
  createStudioClipPreviewRange,
  createStudioClipTimelineFromReviewSession,
  createStudioClipTimelineSnapshotForReviewSession,
  invalidateStudioClipProcessingOperationsForBoundaryEdit,
  mergeSliceReviewSegmentsOnStudioTimeline,
  mergeStudioClipTimelineSnapshotProcessingOperationHistory,
  previewStudioClipBoundaryAdjustment,
  reconcileStudioClipProcessingOperationReadiness,
  restoreSliceReviewSegmentOnStudioTimeline,
  selectAllSliceReviewSegmentsForRender,
  setSliceReviewSegmentRenderSelectionOnStudioTimeline,
  setSliceReviewSegmentsRenderSelectionForRender,
  splitSliceReviewSegmentAtTimelinePlayhead,
  markSliceReviewSegmentAsDuplicateOnStudioTimeline,
} = clipWorkflowModule;

const failures = [];
const pass = [];
const plannerSource = readFileSync('packages/sdkwork-autocut-slicer/src/service/slicePlanner.ts', 'utf8');
const slicerServiceSource = readFileSync('packages/sdkwork-autocut-slicer/src/service/slicerService.ts', 'utf8');
const slicerPageSource = readFileSync('packages/sdkwork-autocut-slicer/src/pages/SlicerPage.tsx', 'utf8');
const smartSliceTimelineWorkbenchSource = readFileSync('packages/sdkwork-autocut-slicer/src/components/smart-slice-timeline/SmartSliceTimelineWorkbench.tsx', 'utf8');
const smartSliceTimelineTrackSource = readFileSync('packages/sdkwork-autocut-slicer/src/components/smart-slice-timeline/SmartSliceTimelineTrack.tsx', 'utf8');
const smartSliceTimelineClipSource = readFileSync('packages/sdkwork-autocut-slicer/src/components/smart-slice-timeline/SmartSliceTimelineClip.tsx', 'utf8');
const smartSliceTimelineInteractionsSource = readFileSync('packages/sdkwork-autocut-slicer/src/components/smart-slice-timeline/useSmartSliceTimelineInteractions.ts', 'utf8');
const smartSliceTimelineControllerSource = readFileSync('packages/sdkwork-autocut-slicer/src/components/smart-slice-timeline/useSmartSliceTimelineReviewController.ts', 'utf8');
const smartCutEnginePlannerSource = readFileSync('packages/sdkwork-autocut-slicer/src/service/smartCutEnginePlanner.ts', 'utf8');
const autocutTypesSource = readFileSync('packages/sdkwork-autocut-types/src/index.ts', 'utf8');
let clipWorkflowSource = '';
try {
  clipWorkflowSource = readFileSync(clipWorkflowSourcePath, 'utf8');
} catch {
  clipWorkflowSource = '';
}
const sqliteBaselineSource = readFileSync('packages/sdkwork-autocut-desktop/src-tauri/database/schema/sqlite/001_baseline.sql', 'utf8');
const schemaRegistrySource = readFileSync('packages/sdkwork-autocut-desktop/src-tauri/database/schema-registry/autocut_host_baseline.yaml', 'utf8');
const databaseContractRsSource = readFileSync('packages/sdkwork-autocut-desktop/src-tauri/src/database_contract.rs', 'utf8');
const databaseRuntimeRsSource = readFileSync('packages/sdkwork-autocut-desktop/src-tauri/src/database_runtime.rs', 'utf8');

function toPosixPath(value) {
  return value.replaceAll(path.sep, '/');
}

function resolveClipWorkflowModuleSourcePath(sourcePath, specifier) {
  if (specifier === '@sdkwork/autocut-types') {
    return path.join(process.cwd(), 'packages/sdkwork-autocut-types/src/index.ts');
  }
  if (specifier.startsWith('.')) {
    const basePath = path.resolve(path.dirname(sourcePath), specifier);
    const candidates = [
      basePath,
      `${basePath}.ts`,
      `${basePath}.tsx`,
      path.join(basePath, 'index.ts'),
      path.join(basePath, 'index.tsx'),
    ];
    return candidates.find((candidate) => {
      try {
        readFileSync(candidate);
        return true;
      } catch {
        return false;
      }
    });
  }
  return undefined;
}

function rewriteClipWorkflowModuleSpecifiers(sourcePath, jsSource, moduleOutputDir, servicesStubPath) {
  return jsSource.replace(
    /((?:from\s*|import\s*\()\s*['"])([^'"]+)(['"])/gu,
    (match, prefix, specifier, suffix) => {
      const resolvedPath = specifier === '@sdkwork/autocut-services'
        ? servicesStubPath
        : resolveClipWorkflowModuleSourcePath(sourcePath, specifier);
      if (!resolvedPath) {
        return match;
      }
      let relativeSpecifier = toPosixPath(path.relative(
        path.dirname(resolveClipWorkflowOutputPath(moduleOutputDir, sourcePath)),
        specifier === '@sdkwork/autocut-services'
          ? resolvedPath
          : resolveClipWorkflowOutputPath(moduleOutputDir, resolvedPath),
      ));
      if (!relativeSpecifier.startsWith('.')) {
        relativeSpecifier = `./${relativeSpecifier}`;
      }
      return `${prefix}${relativeSpecifier}${suffix}`;
    },
  );
}

function resolveClipWorkflowOutputPath(moduleOutputDir, sourcePath) {
  return path.join(moduleOutputDir, path.relative(process.cwd(), sourcePath)).replace(/\.(tsx?|jsx?)$/u, '.mjs');
}

function collectClipWorkflowModuleGraph(entryPath, seen = new Set()) {
  if (seen.has(entryPath)) {
    return seen;
  }
  seen.add(entryPath);
  const source = readFileSync(entryPath, 'utf8');
  const importPattern = /(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/gu;
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1];
    if (!specifier || specifier === '@sdkwork/autocut-services') {
      continue;
    }
    const resolvedPath = resolveClipWorkflowModuleSourcePath(entryPath, specifier);
    if (resolvedPath) {
      collectClipWorkflowModuleGraph(resolvedPath, seen);
    }
  }
  return seen;
}

function transpileClipWorkflowModule(sourcePath, moduleOutputDir, servicesStubPath) {
  const transpiled = ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      useDefineForClassFields: false,
      experimentalDecorators: true,
      isolatedModules: true,
      moduleDetection: ts.ModuleDetectionKind.Force,
    },
    fileName: sourcePath,
  });
  const outPath = resolveClipWorkflowOutputPath(moduleOutputDir, sourcePath);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, rewriteClipWorkflowModuleSpecifiers(sourcePath, transpiled.outputText, moduleOutputDir, servicesStubPath));
}

async function loadClipWorkflowModule() {
  const moduleOutputDir = path.join(process.cwd(), 'artifacts', 'slicer-planner-modules', `${process.pid}-${Date.now().toString(36)}`);
  rmSync(moduleOutputDir, { recursive: true, force: true });
  mkdirSync(moduleOutputDir, { recursive: true });
  const servicesStubPath = path.join(moduleOutputDir, 'sdkwork-autocut-services-stub.mjs');
  writeFileSync(servicesStubPath, `
let autoCutIdSequence = 0;
export function createAutoCutTimestamp() {
  return new Date().toISOString();
}
export function createAutoCutId(prefix) {
  autoCutIdSequence = (autoCutIdSequence + 1) % 100000;
  return \`\${prefix}-\${Date.now()}-\${autoCutIdSequence.toString().padStart(5, '0')}\`;
}
export function resolveAutoCutTimestampMs(timestamp) {
  if (timestamp instanceof Date) {
    const value = timestamp.getTime();
    return Number.isNaN(value) ? 0 : value;
  }
  if (typeof timestamp === 'number') {
    return Number.isFinite(timestamp) ? timestamp : 0;
  }
  if (typeof timestamp === 'string' && timestamp.trim()) {
    const value = Date.parse(timestamp);
    return Number.isNaN(value) ? 0 : value;
  }
  return 0;
}
`);
  const entryPath = path.join(process.cwd(), clipWorkflowSourcePath);
  for (const sourcePath of collectClipWorkflowModuleGraph(entryPath)) {
    transpileClipWorkflowModule(sourcePath, moduleOutputDir, servicesStubPath);
  }
  return import(pathToFileURL(resolveClipWorkflowOutputPath(moduleOutputDir, entryPath)).href);
}

function assertRule(condition, message) {
  if (condition) {
    pass.push(message);
  } else {
    failures.push(message);
  }
}

function assertEqual(actual, expected, message) {
  assertRule(Object.is(actual, expected), `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}

function assertRejects(action, expectedMessagePart, message) {
  let rejectedError = null;

  try {
    action();
  } catch (error) {
    rejectedError = error;
  }

  const rejectedMessage = rejectedError instanceof Error ? rejectedError.message : '';
  assertRule(rejectedError instanceof Error, `${message} rejects`);
  assertRule(
    rejectedMessage.includes(expectedMessagePart),
    `${message} explains ${expectedMessagePart}`,
  );
}

async function assertRejectsAsync(action, expectedMessagePart, message) {
  let rejectedError = null;

  try {
    await action();
  } catch (error) {
    rejectedError = error;
  }

  const rejectedMessage = rejectedError instanceof Error ? rejectedError.message : '';
  assertRule(rejectedError instanceof Error, `${message} rejects`);
  assertRule(
    rejectedMessage.includes(expectedMessagePart),
    `${message} explains ${expectedMessagePart}`,
  );
}

function assertNumberBetween(actual, min, max, message) {
  assertRule(
    typeof actual === 'number' && actual >= min && actual <= max,
    `${message} (expected ${min} <= value <= ${max}, got ${JSON.stringify(actual)})`,
  );
}

function assertArrayIncludes(actual, expectedItem, message) {
  assertRule(
    Array.isArray(actual) && actual.includes(expectedItem),
    `${message} (expected array to include ${JSON.stringify(expectedItem)}, got ${JSON.stringify(actual)})`,
  );
}

const transcriptCoverageBoundaryToleranceMs = 80;

function isNgOrRetakeTranscriptText(text) {
  const normalizedText = normalizeSmartSliceTranscriptEvidenceText(text).toLowerCase();
  return /(?:\u5570\u55e6|\u91cd\u65b0\u5f55|\u91cd\u5f55|\u7b97\u4e86|ng|retake|re-record|record again|show you the same thing)/iu.test(normalizedText);
}

function isEligibleTranscriptCoverageText(text) {
  const normalizedText = normalizeSmartSliceTranscriptEvidenceText(text);
  return normalizedText.length > 0 && !isNgOrRetakeTranscriptText(normalizedText);
}

function getEligibleTranscriptCoverageSegments(transcriptSegments) {
  const normalizedSegments = normalizeSmartSliceTranscriptSegmentsForPlanning(transcriptSegments);
  const timelineStartMs = normalizedSegments[0]?.startMs ?? 0;
  const timelineEndMs = normalizedSegments.at(-1)?.endMs ?? timelineStartMs;
  const timelineDurationMs = Math.max(1, timelineEndMs - timelineStartMs);
  const tailStartIndex = normalizedSegments.findIndex((segment, index) =>
    index > 0 &&
      isNgOrRetakeTranscriptText(segment.text) &&
      segment.startMs >= timelineStartMs + timelineDurationMs * 0.65
  );
  const publishableSegments = tailStartIndex >= 0
    ? normalizedSegments.slice(0, tailStartIndex)
    : normalizedSegments;
  return publishableSegments.filter((segment) => isEligibleTranscriptCoverageText(segment.text));
}

function getClipCoverageRanges(clip) {
  if (Array.isArray(clip?.sourceSegments) && clip.sourceSegments.length > 0) {
    return clip.sourceSegments
      .map((segment) => ({
        startMs: Math.max(0, Math.round(segment?.startMs ?? 0)),
        endMs: Math.max(0, Math.round(segment?.endMs ?? 0)),
      }))
      .filter((segment) => segment.endMs > segment.startMs);
  }

  const startMs = typeof clip?.speechStartMs === 'number'
    ? Math.max(0, Math.round(clip.speechStartMs))
    : typeof clip?.sourceStartMs === 'number'
      ? Math.max(0, Math.round(clip.sourceStartMs))
      : typeof clip?.startMs === 'number'
        ? Math.max(0, Math.round(clip.startMs))
        : undefined;
  const endMs = typeof clip?.speechEndMs === 'number'
    ? Math.max(0, Math.round(clip.speechEndMs))
    : typeof clip?.sourceEndMs === 'number'
      ? Math.max(0, Math.round(clip.sourceEndMs))
      : typeof clip?.startMs === 'number' && typeof clip?.durationMs === 'number'
        ? Math.max(0, Math.round(clip.startMs + clip.durationMs))
        : undefined;

  return startMs !== undefined && endMs !== undefined && endMs > startMs
    ? [{ startMs, endMs }]
    : [];
}

function doesPlanFullyCoverTranscriptSegment(plan, segment) {
  const segmentStartMs = Math.round(segment.startMs);
  const segmentEndMs = Math.round(segment.endMs);
  const ranges = plan
    .flatMap((clip) => getClipCoverageRanges(clip))
    .map((range) => ({
      startMs: Math.max(segmentStartMs, range.startMs),
      endMs: Math.min(segmentEndMs, range.endMs),
    }))
    .filter((range) => range.endMs > range.startMs)
    .sort((firstRange, secondRange) =>
      firstRange.startMs - secondRange.startMs || firstRange.endMs - secondRange.endMs
    );

  let coveredUntilMs = segmentStartMs;
  for (const range of ranges) {
    if (range.endMs <= coveredUntilMs) {
      continue;
    }
    if (range.startMs > coveredUntilMs + transcriptCoverageBoundaryToleranceMs) {
      return false;
    }
    coveredUntilMs = Math.max(coveredUntilMs, range.endMs);
    if (coveredUntilMs >= segmentEndMs - transcriptCoverageBoundaryToleranceMs) {
      return true;
    }
  }

  return coveredUntilMs >= segmentEndMs - transcriptCoverageBoundaryToleranceMs;
}

function isTranscriptSegmentCoveredByRepeatFilteredClip(plan, segment) {
  const normalizedSegmentText = normalizeSmartSliceTranscriptEvidenceText(segment.text);
  return normalizedSegmentText.length > 0 &&
    plan.some((clip) =>
      Array.isArray(clip?.risks) &&
        clip.risks.includes('transcript-repeat-filtered') &&
        normalizeSmartSliceTranscriptEvidenceText(clip.transcriptText ?? '') === normalizedSegmentText
    );
}

function getUncoveredEligibleTranscriptSegments(plan, transcriptSegments) {
  return getEligibleTranscriptCoverageSegments(transcriptSegments)
    .filter((segment) => !isTranscriptSegmentCoveredByRepeatFilteredClip(plan, segment))
    .filter((segment) => !doesPlanFullyCoverTranscriptSegment(plan, segment));
}

function assertPlanCoversEveryEligibleTranscriptSegment(plan, transcriptSegments, message) {
  const uncoveredSegments = getUncoveredEligibleTranscriptSegments(plan, transcriptSegments);
  assertRule(
    uncoveredSegments.length === 0,
    `${message} (uncovered=${uncoveredSegments.length}, sample=${JSON.stringify(uncoveredSegments.slice(0, 6))})`,
  );
}

function assertPlanReadyForNativeRenderLikeUi(plan, transcriptSegments, sourceDurationMs, message) {
  assertRule(plan.length > 0, `${message} has at least one planned clip`);

  let previousRenderedEndMs;
  plan.forEach((clip, index) => {
    const clipNumber = index + 1;
    const startMs = Math.round(clip.startMs);
    const durationMs = Math.round(clip.durationMs);
    const renderedEndMs = startMs + durationMs;
    const sourceStartMs = Math.round(clip.sourceStartMs ?? startMs);
    const sourceEndMs = Math.round(clip.sourceEndMs ?? renderedEndMs);
    const speechStartMs = Math.round(clip.speechStartMs ?? sourceStartMs);
    const speechEndMs = Math.round(clip.speechEndMs ?? sourceEndMs);

    assertRule(
      Number.isFinite(startMs) && startMs >= 0,
      `${message} clip ${clipNumber} has non-negative finite startMs`,
    );
    assertRule(
      Number.isFinite(durationMs) && durationMs > 0,
      `${message} clip ${clipNumber} has positive finite durationMs`,
    );
    assertRule(
      previousRenderedEndMs === undefined || startMs >= previousRenderedEndMs,
      `${message} clip ${clipNumber} starts after previous rendered clip ends (startMs=${startMs}, previousRenderedEndMs=${previousRenderedEndMs})`,
    );
    assertRule(
      renderedEndMs <= sourceDurationMs,
      `${message} clip ${clipNumber} stays inside source duration (endMs=${renderedEndMs}, sourceDurationMs=${sourceDurationMs})`,
    );
    assertRule(
      sourceEndMs > sourceStartMs && sourceStartMs >= startMs && sourceEndMs <= renderedEndMs,
      `${message} clip ${clipNumber} source range stays inside rendered timing (startMs=${startMs}, renderedEndMs=${renderedEndMs}, sourceStartMs=${sourceStartMs}, sourceEndMs=${sourceEndMs})`,
    );
    assertRule(
      speechEndMs > speechStartMs && speechStartMs >= sourceStartMs && speechEndMs <= sourceEndMs,
      `${message} clip ${clipNumber} speech range stays inside source range (sourceStartMs=${sourceStartMs}, sourceEndMs=${sourceEndMs}, speechStartMs=${speechStartMs}, speechEndMs=${speechEndMs})`,
    );

    previousRenderedEndMs = renderedEndMs;
  });

  assertPlanCoversEveryEligibleTranscriptSegment(
    plan,
    transcriptSegments,
    `${message} covers every eligible speech-to-text segment`,
  );
}

const baseParams = {
  mode: '单人讲解',
  llmModel: 'deepseek-chat',
  segmentationAgentId: AUTOCUT_DEFAULT_SMART_SLICE_SEGMENTATION_AGENT_ID,
  minDuration: 15,
  maxDuration: 60,
  baseAlgorithm: 'scene',
  highlightEngine: 'keyword',
  enableNoiseReduction: true,
  enableCoughFilter: true,
  enableRepeatFilter: true,
  enableSubtitles: false,
};

assertRejects(
  () => validateVideoSliceParams({ ...baseParams, minDuration: 90, maxDuration: 15 }),
  'minimum slice duration',
  'planner rejects inverted duration ranges',
);
assertRejects(
  () => validateVideoSliceParams({ ...baseParams, minDuration: Number.NaN }),
  'minimum slice duration',
  'planner rejects NaN minimum durations instead of silently defaulting them',
);
assertRejects(
  () => validateVideoSliceParams({ ...baseParams, minDuration: 4 }),
  'minimum slice duration',
  'planner rejects minimum durations below the renderable slicing floor',
);
assertRejects(
  () => validateVideoSliceParams({ ...baseParams, maxDuration: Number.POSITIVE_INFINITY }),
  'maximum slice duration',
  'planner rejects infinite maximum durations before native rendering',
);
assertRejects(
  () => validateVideoSliceParams({ ...baseParams, maxDuration: 601 }),
  'maximum slice duration',
  'planner rejects maximum durations above the standard slicing ceiling',
);
assertRejects(
  () => validateVideoSliceParams({ ...baseParams, idealDuration: Number.NaN }),
  'ideal slice duration',
  'planner rejects NaN ideal durations instead of passing unstable planning policy',
);
assertRejects(
  () => validateVideoSliceParams({ ...baseParams, idealDuration: 4 }),
  'ideal slice duration',
  'planner rejects ideal durations below the renderable slicing floor',
);
assertRejects(
  () => validateVideoSliceParams({ ...baseParams, idealDuration: 601 }),
  'ideal slice duration',
  'planner rejects ideal durations above the standard slicing ceiling',
);
assertRejects(
  () => validateVideoSliceParams({ ...baseParams, sourceDurationMs: Number.NaN }),
  'source media duration',
  'planner rejects NaN source media duration metadata',
);
assertRejects(
  () => validateVideoSliceParams({ ...baseParams, sourceDurationMs: 4_000 }),
  'source media duration',
  'planner rejects source media duration metadata below the minimum renderable slice',
);

const requiredUnifiedClipTypeMarkers = [
  'export type AutoCutSlicingEngineId',
  'export type StudioClipType',
  'export type ClipProcessingOperationKey',
  'export type ClipProcessingOperationExecutionStage',
  'export const CLIP_PROCESSING_OPERATION_STATUS_CODE',
  'export const CLIP_PROCESSING_OPERATION_STATUS_KEY_BY_CODE',
  'export interface ClipProcessingOperationPlanItem',
  'export interface ClipProcessingPlan',
  'export interface StudioClipProcessingOperation',
  'executionStage: ClipProcessingOperationExecutionStage',
  'dependencyOperationKeys: ClipProcessingOperationKey[]',
  'statusKey: ClipProcessingOperationStatus',
  'statusCode: ClipProcessingOperationStatusCode',
  'attemptNo: number',
  'maxAttempts: number',
  'startedAt?: string',
  'completedAt?: string',
  'durationMs?: number',
  'workerId?: string',
  'clipBoundaryVersion: number',
  'sourceStartMs: number',
  'sourceEndMs: number',
  'sourceDurationMs: number',
  'export interface StudioTimeline',
  'export interface StudioClip',
  'export interface StudioClipSourceRef',
  'export interface StudioClipEvent',
  'export interface AutoCutClipWorkflowTemplate',
  'generate-clips',
  'timeline-preview-edit',
  'process-clips',
  'render-clips',
];
for (const marker of requiredUnifiedClipTypeMarkers) {
  assertRule(
    autocutTypesSource.includes(marker),
    `@sdkwork/autocut-types defines the unified Clip workflow contract marker ${marker}`,
  );
}

const requiredClipWorkflowMarkers = [
  'AUTOCUT_INTELLIGENT_SLICING_ENGINE_TEMPLATES',
  'AUTOCUT_CLIP_PROCESSING_OPERATION_SEQUENCE',
  'transcript-semantic-v2',
  'dialogue-speaker-v1',
  'commerce-live-v1',
  'visual-scene-v1',
  'pause-keyword-v1',
  'generate-clips',
  'timeline-preview-edit',
  'refine-clips',
  'process-clips',
  'render-clips',
  'clipProcessingOperationKeys',
  'studio_clip_processing_operation',
  'createStudioClipTimelineFromReviewSession',
  'createStudioClipTimelineSnapshotForReviewSession',
  'adjustStudioClipBoundary',
  'adjustSliceReviewSegmentBoundaryOnStudioTimeline',
  'correctSliceReviewSegmentOnStudioTimeline',
  'createSliceReviewManualEdit',
  'createSliceReviewSessionFromSegments',
  'previewStudioClipBoundaryAdjustment',
  'createStudioClipPreviewRange',
  'splitSliceReviewSegmentAtTimelinePlayhead',
  'invalidateStudioClipProcessingOperationsForBoundaryEdit',
  'invalidatedStepKeys',
  'invalidatedOperationKeys',
  'boundaryVersion',
  'clipBoundaryVersion',
  'oldBoundaryVersion',
  'newBoundaryVersion',
];
for (const marker of requiredClipWorkflowMarkers) {
  assertRule(
    clipWorkflowSource.includes(marker),
    `${clipWorkflowSourcePath} implements the unified Clip workflow marker ${marker}`,
  );
}

const requiredStudioClipTimelineWorkbenchMarkers = [
  'studioClipTimeline',
  'activeStudioClipTimelineSnapshot',
  'createStudioClipPreviewRange',
  'adjustSliceReviewSegmentBoundaryOnStudioTimeline',
  'correctSliceReviewSegmentOnStudioTimeline',
  'createSliceReviewSessionFromSegments',
  'previewStudioClipBoundaryAdjustment',
  'invalidateStudioClipProcessingOperationsForBoundaryEdit',
  'createStudioClipTimelineSnapshotForReviewSession',
  'buildSmartSliceTimelineBoundaryPreview',
  'previewClipBoundaryDrag',
  'commitClipBoundary',
  'splitSliceReviewSegmentAtTimelinePlayhead',
  'correctSliceReviewSegmentOnStudioTimeline',
  'SmartSliceTimelineWorkbench',
  'onPreviewClipBoundaryDrag={timelineController.previewClipBoundaryDrag}',
  'onCommitClipBoundary={timelineController.commitClipBoundary}',
  'onSplitClipAtTime={timelineController.splitClipAtTime}',
];
for (const marker of requiredStudioClipTimelineWorkbenchMarkers) {
  const inSlicerPage = slicerPageSource.includes(marker);
  const inController = smartSliceTimelineControllerSource.includes(marker);
  assertRule(
    inSlicerPage || inController,
    `SlicerPage review workbench wires componentized StudioClip timeline marker ${marker}`,
  );
}

const requiredSmartSliceTimelineComponentMarkers = [
  [smartSliceTimelineWorkbenchSource, 'SmartSliceTimelineRuler', 'SmartSliceTimelineWorkbench composes the professional timeline ruler'],
  [smartSliceTimelineWorkbenchSource, 'SmartSliceTimelineTrack', 'SmartSliceTimelineWorkbench composes the editable clip track'],
  [smartSliceTimelineWorkbenchSource, 'useSmartSliceTimelineViewport', 'SmartSliceTimelineWorkbench owns viewport density through a timeline hook'],
  [smartSliceTimelineWorkbenchSource, 'useSmartSliceTimelineInteractions', 'SmartSliceTimelineWorkbench owns pointer interactions through a timeline hook'],
  [smartSliceTimelineWorkbenchSource, 'data-testid="smart-slice-timeline-scroll-viewport"', 'SmartSliceTimelineWorkbench keeps ruler, playhead, split point, and clips in one scroll-synchronized coordinate space'],
  [smartSliceTimelineWorkbenchSource, 'data-testid="smart-slice-timeline-timecode-input"', 'SmartSliceTimelineWorkbench supports precision timecode seeking'],
  [smartSliceTimelineWorkbenchSource, 'canSplitSmartSliceTimelineClipAtTime', 'SmartSliceTimelineWorkbench validates split-at-playhead before dispatching clip edits'],
  [smartSliceTimelineTrackSource, 'data-testid="smart-slice-timeline-track"', 'SmartSliceTimelineTrack exposes the canonical track test id'],
  [smartSliceTimelineTrackSource, 'data-testid="smart-slice-timeline-boundary-preview"', 'SmartSliceTimelineTrack renders live boundary previews'],
  [smartSliceTimelineTrackSource, 'SmartSliceTimelinePlayhead', 'SmartSliceTimelineTrack renders the WYSIWYG playhead'],
  [smartSliceTimelineTrackSource, 'SmartSliceTimelineSplitHandle', 'SmartSliceTimelineTrack renders split-at-playhead controls'],
  [smartSliceTimelineTrackSource, 'canSplitSmartSliceTimelineClipAtTime', 'SmartSliceTimelineTrack only exposes split controls at valid interior clip positions'],
  [readFileSync('packages/sdkwork-autocut-slicer/src/components/smart-slice-timeline/SmartSliceTimelinePlayhead.tsx', 'utf8'), 'data-testid="smart-slice-timeline-playhead-handle"', 'SmartSliceTimelinePlayhead exposes a professional draggable handle hit area'],
  [smartSliceTimelineWorkbenchSource, 'isEditingTimecode', 'SmartSliceTimelineWorkbench keeps manual timecode entry stable while playback updates current time'],
  [smartSliceTimelineClipSource, "onPointerDown={(event) => onBoundaryDragStart(item, 'left', event)}", 'SmartSliceTimelineClip exposes left boundary drag editing'],
  [smartSliceTimelineClipSource, "onPointerDown={(event) => onBoundaryDragStart(item, 'right', event)}", 'SmartSliceTimelineClip exposes right boundary drag editing'],
  [smartSliceTimelineInteractionsSource, "window.addEventListener('pointermove'", 'timeline interaction hook owns pointermove drag tracking'],
  [smartSliceTimelineInteractionsSource, 'onSplitClipAtTime', 'timeline interaction hook exposes split-at-time editing'],
  [smartSliceTimelineInteractionsSource, 'canSplitSmartSliceTimelineClipAtTime', 'timeline interaction hook blocks invalid split-at-time edits before dispatch'],
];
for (const [source, marker, message] of requiredSmartSliceTimelineComponentMarkers) {
  assertRule(
    source.includes(marker),
    message,
  );
}
assertRule(
  (slicerPageSource.includes('const boundaryAdjustment = adjustSliceReviewSegmentBoundaryOnStudioTimeline({') ||
    smartSliceTimelineControllerSource.includes('const boundaryAdjustment = adjustSliceReviewSegmentBoundaryOnStudioTimeline({')) &&
  (slicerPageSource.includes('invalidateStudioClipProcessingOperationsForBoundaryEdit({') ||
    smartSliceTimelineControllerSource.includes('invalidateStudioClipProcessingOperationsForBoundaryEdit({')) &&
  (slicerPageSource.includes('event: boundaryAdjustment.event') ||
    smartSliceTimelineControllerSource.includes('event: boundaryAdjustment.event')) &&
  slicerPageSource.includes('createStudioClipTimelineSnapshotForReviewSession(') &&
  (slicerPageSource.includes('invalidatedProcessingOperations') ||
    smartSliceTimelineControllerSource.includes('invalidatedProcessingOperations')) &&
  (slicerPageSource.includes('nextStudioClipTimeline.processingOperations')),
  'SlicerPage commits WYSIWYG boundary edits through the canonical Clip workflow and invalidates stale per-clip operation rows in the active StudioClip timeline snapshot',
);
assertRule(
  slicerPageSource.includes('return createStudioClipTimelineSnapshotForReviewSession(') &&
    slicerPageSource.includes('activeReviewTask?.studioClipTimeline?.processingOperations ?? []') &&
    slicerPageSource.includes('[activeReviewTask?.studioClipTimeline?.processingOperations, activeReviewTask?.studioClipTimeline, effectiveReviewSession]'),
  'SlicerPage derives active StudioClip timeline snapshots through the shared snapshot merge helper while preserving operation history from the current task snapshot',
);
assertRule(
  slicerPageSource.includes('createStudioClipTimelineSnapshotForReviewSession(') &&
    slicerPageSource.includes('saveVideoSliceReviewDraft(taskId, {') &&
    slicerPageSource.includes('nextStudioClipTimeline.processingOperations') &&
    !slicerPageSource.includes('function createNextStudioClipTimelineSnapshotForReviewSession(') &&
    !slicerPageSource.includes('AutoCutStudioClipTimelineSnapshot'),
  'SlicerPage uses the shared Clip workflow snapshot helper instead of owning a local StudioClip timeline regeneration helper',
);
assertRule(
  !slicerPageSource.includes('const nextStudioClipTimeline = mergeStudioClipTimelineSnapshotProcessingOperationHistory({') &&
    !slicerPageSource.includes('const regeneratedStudioClipTimelineSnapshot = createStudioClipTimelineFromReviewSession(splitResult.reviewSession);') &&
    !slicerPageSource.includes('createNextStudioClipTimelineSnapshotForReviewSession({'),
  'SlicerPage keeps StudioClip timeline snapshot regeneration centralized instead of duplicating task write-back logic inside individual review handlers',
);
assertRule(
  slicerServiceSource.includes('createStudioClipTimelineSnapshotForReviewSession(') &&
    slicerServiceSource.includes('processingOperations: readonly StudioClipProcessingOperation[] = []') &&
    slicerServiceSource.includes('processingOperations.length > 0 ? processingOperations : task.studioClipTimeline?.processingOperations ?? []'),
  'Slicer service uses the shared Clip workflow snapshot helper together with caller-provided processing history when persisting review-stage timeline updates',
);
assertRule(
  !slicerServiceSource.includes('studioClipTimeline: createStudioClipTimelineFromReviewSession(draftReviewSession)') &&
    !slicerServiceSource.includes('studioClipTimeline: createStudioClipTimelineFromReviewSession(readyForRenderReviewSession)') &&
    !slicerServiceSource.includes('studioClipTimeline: createStudioClipTimelineFromReviewSession(reviewReadySession)') &&
    !slicerServiceSource.includes('studioClipTimeline: createStudioClipTimelineFromReviewSession(renderedReviewSession)'),
  'Slicer service no longer rewrites review-stage StudioClip timelines with raw regenerated snapshots',
);
assertRule(
  !slicerPageSource.includes("id: `${segment.id}-a`") &&
    !slicerPageSource.includes("id: `${segment.id}-b`") &&
    !slicerPageSource.includes("title: `${segment.title} A`") &&
    !slicerPageSource.includes("title: `${segment.title} B`"),
  'SlicerPage delegates review clip splitting to the canonical Clip workflow instead of constructing split review segments inline',
);
assertRule(
  !slicerPageSource.includes('function createSliceReviewSegmentFromStudioClipBoundaryAdjustment') &&
    !slicerPageSource.includes('function createSliceReviewManualEdit(') &&
    !slicerPageSource.includes('function createSliceReviewSessionFromSegments(') &&
    !slicerPageSource.includes('const { clip, event } = adjustStudioClipBoundary'),
  'SlicerPage delegates StudioClip boundary review segment and manual edit creation to the canonical Clip workflow',
);
assertRule(
  !slicerPageSource.includes("reason: 'manual real-time segment correction'") &&
    !slicerPageSource.includes('const correctedSegment: AutoCutSliceReviewSegment = {'),
  'SlicerPage delegates live review correction to the canonical Clip workflow instead of reconstructing corrected segments inline',
);
assertRule(
  [
    'selectAllSliceReviewSegmentsForRender',
    'setSliceReviewSegmentsRenderSelectionForRender',
    'setSliceReviewSegmentRenderSelectionOnStudioTimeline',
    'mergeSliceReviewSegmentsOnStudioTimeline',
    'markSliceReviewSegmentAsDuplicateOnStudioTimeline',
    'restoreSliceReviewSegmentOnStudioTimeline',
  ].every((marker) => clipWorkflowSource.includes(`export function ${marker}`)),
  'Clip workflow exports canonical helpers for every review mutation that changes render selection or StudioClip timeline output',
);
assertRule(
  !slicerPageSource.includes('createSliceReviewManualEdit(') &&
    !slicerPageSource.includes('resolveSmartSliceDuplicateKeepSegmentId('),
  'SlicerPage no longer owns manual edit construction or duplicate keep-segment resolution after canonical review workflow extraction',
);
assertRule(
  !slicerPageSource.includes("reason: 'manual bulk select all publishable review segments'") &&
    !slicerPageSource.includes("reason: 'manual clear selected review segments'") &&
    !slicerPageSource.includes("reason: shouldSelect ? 'manual segment selected for render'") &&
    !slicerPageSource.includes("reason: 'manual merge to preserve continuous context'") &&
    !slicerPageSource.includes("reason: 'manual duplicate content deletion'") &&
    !slicerPageSource.includes("reason: 'manual restore before render'") &&
    !slicerPageSource.includes('const mergedSegment: AutoCutSliceReviewSegment = {') &&
    !slicerPageSource.includes('function resolveSmartSliceDuplicateKeepSegmentId('),
  'SlicerPage delegates select/exclude/merge/delete-duplicate/restore review mutations to the canonical Clip workflow',
);

const requiredClipConvergenceStepKeys = [
  'generate-clips',
  'timeline-preview-edit',
  'refine-clips',
  'process-clips',
  'render-clips',
  'verify-clips',
  'persist-results',
];
const requiredClipProcessingOperationKeys = [
  'denoise-audio',
  'normalize-loudness',
  'remove-cough-and-breath-noise',
  'trim-silence',
  'filter-repeated-content',
  'check-duplicate-content',
  'refine-subtitle-cues',
  'select-cover-frame',
];
const expectedClipProcessingOperationExecutionPlan = [
  { key: 'denoise-audio', stage: 'audio-foundation', dependencies: [] },
  { key: 'normalize-loudness', stage: 'audio-foundation', dependencies: ['denoise-audio'] },
  { key: 'remove-cough-and-breath-noise', stage: 'speech-cleanup', dependencies: ['denoise-audio'] },
  { key: 'trim-silence', stage: 'speech-cleanup', dependencies: ['remove-cough-and-breath-noise'] },
  { key: 'filter-repeated-content', stage: 'content-cleanup', dependencies: ['trim-silence'] },
  { key: 'check-duplicate-content', stage: 'content-cleanup', dependencies: ['filter-repeated-content'] },
  { key: 'refine-subtitle-cues', stage: 'publishing-assets', dependencies: ['trim-silence', 'filter-repeated-content'] },
  { key: 'select-cover-frame', stage: 'publishing-assets', dependencies: ['check-duplicate-content'] },
];
const expectedClipProcessingOperationStatusCodes = {
  blocked: 10,
  pending: 20,
  running: 30,
  succeeded: 40,
  skipped: 50,
  failed: 60,
  invalidated: 70,
};
assertRule(
  autocutTypesSource.includes('export type ClipProcessingOperationStatusCode') &&
    autocutTypesSource.includes('blocked: 10') &&
    autocutTypesSource.includes('pending: 20') &&
    autocutTypesSource.includes('running: 30') &&
    autocutTypesSource.includes('succeeded: 40') &&
    autocutTypesSource.includes('skipped: 50') &&
    autocutTypesSource.includes('failed: 60') &&
    autocutTypesSource.includes('invalidated: 70'),
  '@sdkwork/autocut-types defines the canonical Clip processing operation numeric status code map',
);

const expectedInitialReadyForRenderOperationStatuses = [
  { key: 'denoise-audio', status: 'pending', blockedBy: [] },
  { key: 'normalize-loudness', status: 'blocked', blockedBy: ['denoise-audio'] },
  { key: 'remove-cough-and-breath-noise', status: 'blocked', blockedBy: ['denoise-audio'] },
  { key: 'trim-silence', status: 'blocked', blockedBy: ['remove-cough-and-breath-noise'] },
  { key: 'filter-repeated-content', status: 'blocked', blockedBy: ['trim-silence'] },
  { key: 'check-duplicate-content', status: 'blocked', blockedBy: ['filter-repeated-content'] },
  { key: 'refine-subtitle-cues', status: 'blocked', blockedBy: ['trim-silence', 'filter-repeated-content'] },
  { key: 'select-cover-frame', status: 'blocked', blockedBy: ['check-duplicate-content'] },
];
const expectedOperationStatusesAfterAudioFoundation = [
  { key: 'denoise-audio', status: 'succeeded', blockedBy: [] },
  { key: 'normalize-loudness', status: 'pending', blockedBy: [] },
  { key: 'remove-cough-and-breath-noise', status: 'pending', blockedBy: [] },
  { key: 'trim-silence', status: 'blocked', blockedBy: ['remove-cough-and-breath-noise'] },
  { key: 'filter-repeated-content', status: 'blocked', blockedBy: ['trim-silence'] },
  { key: 'check-duplicate-content', status: 'blocked', blockedBy: ['filter-repeated-content'] },
  { key: 'refine-subtitle-cues', status: 'blocked', blockedBy: ['trim-silence', 'filter-repeated-content'] },
  { key: 'select-cover-frame', status: 'blocked', blockedBy: ['check-duplicate-content'] },
];
function findExpectedInitialReadyForRenderOperationStatus(operationKey) {
  return expectedInitialReadyForRenderOperationStatuses.find((expected) => expected.key === operationKey);
}

function expectedBlockingReasonForStatus(status) {
  return status === 'blocked' ? 'waiting-for-dependencies' : undefined;
}

function operationMatchesExpectedDependencyReadiness(operation, expected) {
  const expectedBlockingReason = expectedBlockingReasonForStatus(expected.status);
  return operation.status === expected.status &&
    operation.statusKey === expected.status &&
    operation.statusCode === expectedClipProcessingOperationStatusCodes[expected.status] &&
    operation.enabled === (expected.status === 'pending') &&
    JSON.stringify(operation.blockedByOperationKeys ?? []) === JSON.stringify(expected.blockedBy) &&
    operation.blockingReason === expectedBlockingReason &&
    JSON.stringify(operation.input?.blockedByOperationKeys ?? []) === JSON.stringify(expected.blockedBy) &&
    operation.input?.blockingReason === expectedBlockingReason &&
    JSON.stringify(operation.metadata?.blockedByOperationKeys ?? []) === JSON.stringify(expected.blockedBy) &&
    operation.metadata?.blockingReason === expectedBlockingReason;
}
for (const workflowTemplate of AUTOCUT_INTELLIGENT_SLICING_ENGINE_TEMPLATES) {
  const stepKeys = workflowTemplate.steps.map((step) => step.key);
  const convergenceStartIndex = stepKeys.indexOf('generate-clips');
  assertRule(
    convergenceStartIndex >= 0,
    `${workflowTemplate.id} reaches the shared generate-clips convergence step`,
  );
  assertEqual(
    JSON.stringify(stepKeys.slice(convergenceStartIndex)),
    JSON.stringify(requiredClipConvergenceStepKeys),
    `${workflowTemplate.id} uses the exact shared Clip convergence sequence`,
  );
  for (const perClipStepKey of ['refine-clips', 'process-clips', 'render-clips', 'verify-clips']) {
    assertRule(
      workflowTemplate.steps.find((step) => step.key === perClipStepKey)?.runsPerClip === true,
      `${workflowTemplate.id} marks ${perClipStepKey} as per-clip parallel work`,
    );
  }
  const processClipsStep = workflowTemplate.steps.find((step) => step.key === 'process-clips');
  assertEqual(
    JSON.stringify(processClipsStep?.clipProcessingOperationKeys ?? []),
    JSON.stringify(requiredClipProcessingOperationKeys),
    `${workflowTemplate.id} process-clips declares the exact auditable per-clip processing operation sequence`,
  );
}

const workflowBehaviorReviewSession = {
  id: 'review-session-check',
  schema: 'slice.review.v1',
  status: 'ready_for_review',
  taskId: 'task-check',
  createdAt: '2026-05-18T00:00:00.000Z',
  updatedAt: '2026-05-18T00:00:00.000Z',
  sourceAssetUuid: 'source-asset-check',
  sourceDurationMs: 12_000,
  segments: [
    {
      id: 'segment-1',
      sourceClipIndex: 0,
      status: 'selected',
      selected: true,
      title: 'Opening claim',
      startMs: 1_000,
      endMs: 5_000,
      durationMs: 4_000,
      contentUnitIds: ['content-unit-1'],
      speakerIds: ['speaker-1'],
      speakerRoles: ['host'],
      transcriptText: 'Opening claim with complete context.',
      transcriptSegments: [
        { startMs: 1_100, endMs: 2_000, text: 'Opening claim', speaker: 'host' },
        { startMs: 2_100, endMs: 4_800, text: 'with complete context.', speaker: 'host' },
      ],
      risks: [],
    },
  ],
  duplicateGroups: [],
  manualEdits: [],
  selectedSegmentIds: ['segment-1'],
};
const workflowBehaviorTimeline = createStudioClipTimelineFromReviewSession(workflowBehaviorReviewSession);
const repeatedWorkflowBehaviorTimeline = createStudioClipTimelineFromReviewSession(workflowBehaviorReviewSession);
const workflowBehaviorClip = workflowBehaviorTimeline.clips[0];
const actualClipProcessingOperationExecutionPlan = (workflowBehaviorClip?.processingPlan.operations ?? []).map((operation) => ({
  key: operation.key,
  stage: operation.executionStage,
  dependencies: operation.dependencyOperationKeys,
}));
assertEqual(
  JSON.stringify(actualClipProcessingOperationExecutionPlan),
  JSON.stringify(expectedClipProcessingOperationExecutionPlan),
  'Clip processing operation plan declares the exact dependency DAG so parallelism never violates cleanup prerequisites',
);
assertRule(
  workflowBehaviorTimeline.timeline.durationMs === 12_000 &&
    workflowBehaviorTimeline.clips.length === 1 &&
    workflowBehaviorClip?.sourceRefs.some((sourceRef) => sourceRef.sourceType === 'content_unit') &&
    workflowBehaviorClip?.sourceRefs.some((sourceRef) => sourceRef.sourceType === 'text_segment') &&
    workflowBehaviorClip?.boundaryVersion === 1 &&
    workflowBehaviorClip?.processingPlan.schema === 'clip.processing.plan.v1' &&
    JSON.stringify(workflowBehaviorClip?.processingPlan.operations.map((operation) => operation.key) ?? []) ===
      JSON.stringify(requiredClipProcessingOperationKeys) &&
    JSON.stringify(actualClipProcessingOperationExecutionPlan) === JSON.stringify(expectedClipProcessingOperationExecutionPlan),
  'StudioClip timeline snapshots preserve source duration, evidence refs, boundary version, and the canonical dependency-aware per-clip processing operation plan',
);
assertRule(
  workflowBehaviorTimeline.timeline.status === 'draft' &&
    workflowBehaviorTimeline.processingOperations.length === requiredClipProcessingOperationKeys.length &&
    workflowBehaviorTimeline.processingOperations.every((operation) =>
      operation.status === 'blocked' &&
        operation.attemptNo === 0 &&
        operation.maxAttempts === 3 &&
        operation.startedAt === undefined &&
        operation.completedAt === undefined &&
        operation.durationMs === undefined &&
        operation.executionStage === workflowBehaviorClip?.processingPlan.operations.find((planOperation) =>
          planOperation.key === operation.operationKey
        )?.executionStage &&
        JSON.stringify(operation.dependencyOperationKeys) === JSON.stringify(
          workflowBehaviorClip?.processingPlan.operations.find((planOperation) =>
            planOperation.key === operation.operationKey
          )?.dependencyOperationKeys ?? []
        ) &&
        Array.isArray(operation.input.dependencyOperationKeys) &&
        operation.clipBoundaryVersion === workflowBehaviorClip?.boundaryVersion
    ),
  'ready_for_review StudioClip timeline snapshots keep dependency-aware boundary-versioned per-clip processing operations blocked without fake execution lifecycle timestamps',
);
assertRule(
  workflowBehaviorTimeline.timeline.id === repeatedWorkflowBehaviorTimeline.timeline.id &&
    workflowBehaviorTimeline.clips[0]?.id === repeatedWorkflowBehaviorTimeline.clips[0]?.id &&
    workflowBehaviorTimeline.clips[0]?.sourceRefs[0]?.id === repeatedWorkflowBehaviorTimeline.clips[0]?.sourceRefs[0]?.id &&
    workflowBehaviorTimeline.processingOperations[0]?.id === repeatedWorkflowBehaviorTimeline.processingOperations[0]?.id,
  'StudioClip timeline snapshots use stable timeline, clip, source-ref, and operation ids derived from review evidence',
);
if (workflowBehaviorClip) {
  const previewRange = createStudioClipPreviewRange(workflowBehaviorClip);
  assertRule(
    previewRange.startMs === workflowBehaviorClip.startMs &&
      previewRange.endMs === workflowBehaviorClip.endMs &&
      previewRange.loop === true,
    'StudioClip preview range loops over the source-video clip boundaries',
  );
  assertRule(
    typeof previewStudioClipBoundaryAdjustment === 'function',
    'StudioClip workflow exports a boundary adjustment preview helper that does not create edit events during pointermove',
  );
  if (typeof previewStudioClipBoundaryAdjustment === 'function') {
    const previewClip = previewStudioClipBoundaryAdjustment({
      clip: workflowBehaviorClip,
      timeline: workflowBehaviorTimeline.timeline,
      side: 'right',
      nextMs: 5_900,
      minDurationMs: 1_000,
    });
    assertRule(
      previewClip.endMs === 5_900 &&
        previewClip.preview.sourceEndMs === 5_900 &&
        previewClip.id === workflowBehaviorClip.id &&
        previewClip.boundaryVersion === workflowBehaviorClip.boundaryVersion,
      'StudioClip boundary preview returns a WYSIWYG clip range without changing clip identity or committed boundary version',
    );
  }
  const boundaryAdjustment = adjustStudioClipBoundary({
    clip: workflowBehaviorClip,
    timeline: workflowBehaviorTimeline.timeline,
    side: 'left',
    nextMs: 4_900,
    minDurationMs: 1_000,
  });
  assertRule(
    boundaryAdjustment.clip.startMs === 4_000 &&
      boundaryAdjustment.clip.durationMs === 1_000 &&
      boundaryAdjustment.clip.boundaryVersion === workflowBehaviorClip.boundaryVersion + 1 &&
      boundaryAdjustment.event.eventType === 'clip-boundary-adjusted' &&
      boundaryAdjustment.event.payload.oldBoundaryVersion === workflowBehaviorClip.boundaryVersion &&
      boundaryAdjustment.event.payload.newBoundaryVersion === boundaryAdjustment.clip.boundaryVersion,
    'StudioClip left boundary adjustment clamps to the minimum duration, increments boundary version, and emits a boundary-adjusted event',
  );
  assertEqual(
    JSON.stringify(boundaryAdjustment.event.payload.invalidatedOperationKeys ?? []),
    JSON.stringify(requiredClipProcessingOperationKeys),
    'StudioClip boundary edits invalidate every downstream per-clip processing operation',
  );
  assertEqual(
    JSON.stringify(boundaryAdjustment.event.invalidatedStepKeys),
    JSON.stringify(['refine-clips', 'process-clips', 'render-clips', 'verify-clips', 'persist-results']),
    'StudioClip boundary edits invalidate every downstream per-clip processing and persistence step',
  );
  assertRule(
    typeof invalidateStudioClipProcessingOperationsForBoundaryEdit === 'function',
    'StudioClip workflow exports a standard helper for marking stale per-clip processing operation rows invalidated after boundary edits',
  );
  assertRule(
    typeof adjustSliceReviewSegmentBoundaryOnStudioTimeline === 'function',
    'StudioClip workflow exports a canonical review boundary adjustment helper for WYSIWYG timeline commits',
  );
  assertRule(
    typeof correctSliceReviewSegmentOnStudioTimeline === 'function',
    'StudioClip workflow exports a canonical review correction helper for live review edits',
  );
  if (typeof adjustSliceReviewSegmentBoundaryOnStudioTimeline === 'function') {
    const reviewBoundaryAdjustment = adjustSliceReviewSegmentBoundaryOnStudioTimeline({
      reviewSession: workflowBehaviorReviewSession,
      segmentId: 'segment-1',
      clip: workflowBehaviorClip,
      timeline: workflowBehaviorTimeline.timeline,
      side: 'right',
      nextMs: 3_400,
    });
    const correctedSegment = reviewBoundaryAdjustment?.segment;
    assertRule(
      reviewBoundaryAdjustment !== null &&
        correctedSegment?.id === 'segment-1' &&
        correctedSegment?.startMs === 1_000 &&
        correctedSegment?.endMs === 3_400 &&
        correctedSegment?.durationMs === 2_400 &&
        correctedSegment?.boundaryVersion === workflowBehaviorClip.boundaryVersion + 1 &&
        correctedSegment?.transcriptText === 'Opening claim with complete context.' &&
        correctedSegment?.transcriptSegments?.[1]?.endMs === 3_400 &&
        correctedSegment?.speechStartMs === 1_100 &&
        correctedSegment?.speechEndMs === 3_400,
      'canonical review boundary adjustment returns a corrected review segment clipped to the committed StudioClip boundary',
    );
    assertRule(
      reviewBoundaryAdjustment?.manualEdit.kind === 'correctSegment' &&
        JSON.stringify(reviewBoundaryAdjustment.manualEdit.segmentIds) === JSON.stringify(['segment-1']) &&
        reviewBoundaryAdjustment.manualEdit.reason === 'manual right boundary adjusted on studio_clip timeline' &&
        reviewBoundaryAdjustment.manualEdit.patch?.startMs === 1_000 &&
        reviewBoundaryAdjustment.manualEdit.patch?.endMs === 3_400 &&
        reviewBoundaryAdjustment.manualEdit.patch?.boundaryVersion === workflowBehaviorClip.boundaryVersion + 1 &&
        reviewBoundaryAdjustment.manualEdit.patch?.speechStartMs === 1_100 &&
        reviewBoundaryAdjustment.manualEdit.patch?.speechEndMs === 3_400 &&
        reviewBoundaryAdjustment.manualEdit.patch?.transcriptText === 'Opening claim with complete context.',
      'canonical review boundary adjustment emits auditable correctSegment manual edit patch evidence',
    );
    assertRule(
      reviewBoundaryAdjustment?.event.eventType === 'clip-boundary-adjusted' &&
        reviewBoundaryAdjustment.event.invalidatedOperationKeys?.length === requiredClipProcessingOperationKeys.length &&
        reviewBoundaryAdjustment.reviewSession.segments[0]?.endMs === 3_400 &&
        reviewBoundaryAdjustment.reviewSession.manualEdits.at(-1)?.id === reviewBoundaryAdjustment.manualEdit.id,
      'canonical review boundary adjustment returns the StudioClip event and an updated review session ready for timeline regeneration',
    );
    assertRule(
      adjustSliceReviewSegmentBoundaryOnStudioTimeline({
        reviewSession: workflowBehaviorReviewSession,
        segmentId: 'missing-segment',
        clip: workflowBehaviorClip,
        timeline: workflowBehaviorTimeline.timeline,
        side: 'right',
        nextMs: 3_400,
      }) === null,
      'canonical review boundary adjustment returns null when the target review segment is missing',
    );
  }

  assertRule(
    typeof createSliceReviewManualEdit === 'function' &&
      typeof createSliceReviewSessionFromSegments === 'function',
    'StudioClip workflow exports canonical review session and manual edit builders for all review mutations',
  );
  if (typeof createSliceReviewManualEdit === 'function' && typeof createSliceReviewSessionFromSegments === 'function') {
    const reviewManualEdit = createSliceReviewManualEdit('select', ['segment-1'], {
      reason: 'canonical review session builder test',
    });
    const reviewSessionFromSegments = createSliceReviewSessionFromSegments(
      workflowBehaviorReviewSession,
      workflowBehaviorReviewSession.segments,
      [reviewManualEdit],
    );
    assertRule(
      reviewManualEdit.kind === 'select' &&
        JSON.stringify(reviewManualEdit.segmentIds) === JSON.stringify(['segment-1']) &&
        reviewManualEdit.reason === 'canonical review session builder test' &&
        typeof reviewManualEdit.createdAt === 'string',
      'canonical review manual edit builder creates stable auditable edit records',
    );
    assertRule(
      reviewSessionFromSegments.updatedAt !== workflowBehaviorReviewSession.updatedAt &&
        reviewSessionFromSegments.manualEdits.at(-1)?.id === reviewManualEdit.id &&
        JSON.stringify(reviewSessionFromSegments.selectedSegmentIds) === JSON.stringify(['segment-1']) &&
        reviewSessionFromSegments.segments.length === workflowBehaviorReviewSession.segments.length,
      'canonical review session builder rebuilds selected segment ids and appends the new manual edit',
    );
  }
}

const workflowApprovedReviewSession = {
  ...workflowBehaviorReviewSession,
  status: 'ready_for_render',
};
const workflowApprovedTimeline = createStudioClipTimelineFromReviewSession(workflowApprovedReviewSession);
assertRule(
    workflowApprovedTimeline.timeline.status === 'ready_for_render' &&
    workflowApprovedTimeline.clips.every((clip) => clip.status === 'selected') &&
    JSON.stringify(workflowApprovedTimeline.processingOperations.map((operation) => ({
      key: operation.operationKey,
      status: operation.status,
      blockedBy: operation.blockedByOperationKeys ?? [],
    }))) === JSON.stringify(expectedInitialReadyForRenderOperationStatuses) &&
    workflowApprovedTimeline.processingOperations.every((operation) =>
      operation.statusKey === operation.status &&
        operation.attemptNo === 0 &&
        operation.maxAttempts === 3 &&
        operation.startedAt === undefined &&
        operation.completedAt === undefined &&
        operation.durationMs === undefined &&
        operation.clipBoundaryVersion === workflowApprovedTimeline.clips[0]?.boundaryVersion &&
        operationMatchesExpectedDependencyReadiness(
          operation,
          findExpectedInitialReadyForRenderOperationStatus(operation.operationKey),
        ) &&
        operation.input.dependencyReadinessMode === 'canonical-operation-dag' &&
        Array.isArray(operation.input.blockedByOperationKeys) &&
        JSON.stringify(operation.input.blockedByOperationKeys) === JSON.stringify(operation.blockedByOperationKeys ?? [])
    ),
  'ready_for_render StudioClip timeline snapshots unlock only dependency-ready selected clip operations and keep downstream operations blocked without claiming an attempt has started',
);
assertRule(
  typeof reconcileStudioClipProcessingOperationReadiness === 'function',
  'StudioClip workflow exports a standard helper for dependency-aware process-clips operation readiness reconciliation',
);
if (typeof reconcileStudioClipProcessingOperationReadiness === 'function') {
  const denoiseSucceededOperation = {
    ...workflowApprovedTimeline.processingOperations.find((operation) => operation.operationKey === 'denoise-audio'),
    status: 'succeeded',
    statusKey: 'succeeded',
    statusCode: expectedClipProcessingOperationStatusCodes.succeeded,
    enabled: false,
    completedAt: workflowApprovedTimeline.timeline.updatedAt,
    durationMs: 0,
  };
  const reconciledAfterAudioFoundation = reconcileStudioClipProcessingOperationReadiness({
    timeline: workflowApprovedTimeline.timeline,
    clip: workflowApprovedTimeline.clips[0],
    processingOperations: workflowApprovedTimeline.processingOperations.map((operation) =>
      operation.operationKey === 'denoise-audio' ? denoiseSucceededOperation : operation
    ),
  });
  assertEqual(
    JSON.stringify(reconciledAfterAudioFoundation.map((operation) => ({
      key: operation.operationKey,
      status: operation.status,
      blockedBy: operation.blockedByOperationKeys ?? [],
    }))),
    JSON.stringify(expectedOperationStatusesAfterAudioFoundation),
    'process-clips readiness reconciliation unlocks only operations whose canonical dependency operation keys have succeeded',
  );
  assertRule(
    reconciledAfterAudioFoundation.every((operation) =>
      operation.metadata?.dependencyReadinessMode === 'canonical-operation-dag' &&
        JSON.stringify(operation.metadata?.blockedByOperationKeys ?? []) === JSON.stringify(operation.blockedByOperationKeys ?? []) &&
        operationMatchesExpectedDependencyReadiness(
          operation,
          expectedOperationStatusesAfterAudioFoundation.find((expected) => expected.key === operation.operationKey),
        )
    ),
    'process-clips readiness reconciliation writes dependency readiness audit metadata and clears stale blockers from newly schedulable operations',
  );
}
assertRule(
  autocutTypesSource.includes('blockedByOperationKeys: ClipProcessingOperationKey[]') &&
    autocutTypesSource.includes('blockingReason?: ClipProcessingOperationBlockingReason') &&
    autocutTypesSource.includes("export type ClipProcessingOperationBlockingReason"),
  '@sdkwork/autocut-types exposes dependency-aware operation blocked-by metadata for process-clips scheduling',
);
if (workflowBehaviorClip && typeof invalidateStudioClipProcessingOperationsForBoundaryEdit === 'function') {
  const boundaryAdjustment = adjustStudioClipBoundary({
    clip: workflowApprovedTimeline.clips[0],
    timeline: workflowApprovedTimeline.timeline,
    side: 'right',
    nextMs: 4_400,
    minDurationMs: 1_000,
  });
  const untouchedOperation = {
    ...workflowApprovedTimeline.processingOperations[0],
    id: 'studio-clip-processing-operation-other-clip',
    clipId: 'other-clip',
    status: 'succeeded',
    statusKey: 'succeeded',
    enabled: true,
    input: {
      sourceStartMs: 7_000,
      sourceEndMs: 9_000,
    },
  };
  const operationsAfterBoundaryEdit = invalidateStudioClipProcessingOperationsForBoundaryEdit({
    processingOperations: [
      ...workflowApprovedTimeline.processingOperations,
      untouchedOperation,
    ],
    event: boundaryAdjustment.event,
  });
  const invalidatedOperations = operationsAfterBoundaryEdit.filter((operation) =>
    operation.clipId === boundaryAdjustment.clip.id
  );
  const untouchedOperationAfterInvalidation = operationsAfterBoundaryEdit.find((operation) =>
    operation.id === untouchedOperation.id
  );
  assertRule(
    invalidatedOperations.length === requiredClipProcessingOperationKeys.length &&
      invalidatedOperations.every((operation) => {
        const previousOperation = workflowApprovedTimeline.processingOperations.find((before) =>
          before.operationKey === operation.operationKey
        );
        return previousOperation !== undefined &&
          operation.id === previousOperation.id &&
          operation.status === 'invalidated' &&
          operation.statusKey === 'invalidated' &&
          operation.statusCode === expectedClipProcessingOperationStatusCodes.invalidated &&
          operation.enabled === false &&
          JSON.stringify(operation.blockedByOperationKeys ?? []) === JSON.stringify([]) &&
          operation.blockingReason === undefined &&
          JSON.stringify(operation.input?.blockedByOperationKeys ?? []) === JSON.stringify([]) &&
          operation.input?.blockingReason === undefined &&
          operation.sourceStartMs === previousOperation.sourceStartMs &&
          operation.clipBoundaryVersion === previousOperation.clipBoundaryVersion &&
          operation.sourceEndMs === previousOperation.sourceEndMs &&
          operation.sourceDurationMs === previousOperation.sourceDurationMs &&
          operation.invalidatedByEventId === boundaryAdjustment.event.id &&
          operation.invalidatedAt === boundaryAdjustment.event.createdAt &&
          operation.completedAt === boundaryAdjustment.event.createdAt &&
          operation.durationMs === 0 &&
          operation.attemptNo === 0 &&
          operation.maxAttempts === 3 &&
          operation.metadata?.previousStatus === previousOperation.status &&
          operation.metadata?.previousStatusCode === previousOperation.statusCode &&
          JSON.stringify(operation.metadata?.previousBlockedByOperationKeys ?? []) ===
            JSON.stringify(previousOperation.blockedByOperationKeys ?? []) &&
          operation.metadata?.previousBlockingReason === previousOperation.blockingReason &&
          JSON.stringify(operation.metadata?.blockedByOperationKeys ?? []) === JSON.stringify([]) &&
          operation.metadata?.blockingReason === undefined &&
          operation.metadata?.previousAttemptNo === 0 &&
          operation.metadata?.previousMaxAttempts === 3 &&
          operation.metadata?.invalidatedByBoundaryEdit === true &&
          operation.metadata?.previousSourceRange?.startMs === operation.sourceStartMs &&
          operation.metadata?.previousSourceRange?.endMs === operation.sourceEndMs &&
          operation.metadata?.previousBoundaryVersion === workflowApprovedTimeline.clips[0]?.boundaryVersion &&
          operation.metadata?.newBoundaryVersion === boundaryAdjustment.clip.boundaryVersion &&
          operation.metadata?.newSourceRange?.endMs === boundaryAdjustment.clip.endMs;
      }),
    'StudioClip boundary edits deterministically mark existing boundary-versioned per-clip operation rows invalidated while preserving row identity and audit metadata',
  );
  assertRule(
      untouchedOperationAfterInvalidation?.status === untouchedOperation.status &&
      untouchedOperationAfterInvalidation?.statusCode === untouchedOperation.statusCode &&
      untouchedOperationAfterInvalidation?.enabled === untouchedOperation.enabled &&
      untouchedOperationAfterInvalidation?.invalidatedByEventId === undefined,
    'StudioClip boundary operation invalidation leaves other clips untouched',
  );
  const adjustedApprovedReviewSession = {
    ...workflowApprovedReviewSession,
    segments: [
      {
        ...workflowApprovedReviewSession.segments[0],
        startMs: boundaryAdjustment.clip.startMs,
        endMs: boundaryAdjustment.clip.endMs,
        durationMs: boundaryAdjustment.clip.durationMs,
        boundaryVersion: boundaryAdjustment.clip.boundaryVersion,
      },
    ],
  };
  const adjustedApprovedTimeline = createStudioClipTimelineFromReviewSession(adjustedApprovedReviewSession);
  assertRule(
    adjustedApprovedTimeline.clips[0]?.id === workflowApprovedTimeline.clips[0]?.id &&
      adjustedApprovedTimeline.processingOperations.every((operation) => {
        const expected = findExpectedInitialReadyForRenderOperationStatus(operation.operationKey);
        return expected !== undefined &&
          operation.clipId === boundaryAdjustment.clip.id &&
          operationMatchesExpectedDependencyReadiness(operation, expected) &&
          operation.clipBoundaryVersion === boundaryAdjustment.clip.boundaryVersion &&
          operation.sourceStartMs === boundaryAdjustment.clip.startMs &&
          operation.sourceEndMs === boundaryAdjustment.clip.endMs &&
          operation.sourceDurationMs === boundaryAdjustment.clip.durationMs &&
          operation.input.sourceEndMs === boundaryAdjustment.clip.endMs &&
          !workflowApprovedTimeline.processingOperations.some((previousOperation) =>
            previousOperation.id === operation.id
          );
      }),
    'StudioClip regenerated operation rows use a new boundary-version-and-source-range-specific identity after boundary edits while keeping the canonical clip identity stable',
  );
  const returnedBoundaryAdjustment = adjustStudioClipBoundary({
    clip: adjustedApprovedTimeline.clips[0],
    timeline: adjustedApprovedTimeline.timeline,
    side: 'right',
    nextMs: workflowApprovedTimeline.clips[0].endMs,
    minDurationMs: 1_000,
  });
  const returnedApprovedTimeline = createStudioClipTimelineFromReviewSession({
    ...workflowApprovedReviewSession,
    segments: [
      {
        ...workflowApprovedReviewSession.segments[0],
        startMs: returnedBoundaryAdjustment.clip.startMs,
        endMs: returnedBoundaryAdjustment.clip.endMs,
        durationMs: returnedBoundaryAdjustment.clip.durationMs,
        boundaryVersion: returnedBoundaryAdjustment.clip.boundaryVersion,
      },
    ],
  });
  assertRule(
    returnedApprovedTimeline.clips[0]?.boundaryVersion === returnedBoundaryAdjustment.clip.boundaryVersion &&
      returnedApprovedTimeline.processingOperations.every((operation) =>
        operation.clipBoundaryVersion === returnedBoundaryAdjustment.clip.boundaryVersion &&
          operation.sourceStartMs === workflowApprovedTimeline.processingOperations[0]?.sourceStartMs &&
          operation.sourceEndMs === workflowApprovedTimeline.processingOperations[0]?.sourceEndMs &&
          !workflowApprovedTimeline.processingOperations.some((previousOperation) =>
            previousOperation.id === operation.id
          )
      ),
    'StudioClip regenerated operation rows stay unique when a boundary edit returns to a previous source range because clip boundary version is part of operation identity',
  );
  const mergedTimelineAfterFirstBoundaryEdit = mergeStudioClipTimelineSnapshotProcessingOperationHistory({
    snapshot: adjustedApprovedTimeline,
    processingOperations: invalidatedOperations,
  });
  const repeatedBoundaryAdjustment = adjustStudioClipBoundary({
    clip: adjustedApprovedTimeline.clips[0],
    timeline: adjustedApprovedTimeline.timeline,
    side: 'left',
    nextMs: 1_500,
    minDurationMs: 1_000,
  });
  const operationsAfterRepeatedBoundaryEdit = invalidateStudioClipProcessingOperationsForBoundaryEdit({
    processingOperations: mergedTimelineAfterFirstBoundaryEdit.processingOperations,
    event: repeatedBoundaryAdjustment.event,
  });
  const firstInvalidatedOperationAfterRepeat = operationsAfterRepeatedBoundaryEdit.find((operation) =>
    operation.id === invalidatedOperations[0]?.id
  );
  const repeatedInvalidatedOperations = operationsAfterRepeatedBoundaryEdit.filter((operation) =>
    operation.clipId === repeatedBoundaryAdjustment.clip.id &&
      operation.invalidatedByEventId === repeatedBoundaryAdjustment.event.id
  );
  assertRule(
    firstInvalidatedOperationAfterRepeat?.invalidatedByEventId === boundaryAdjustment.event.id &&
      firstInvalidatedOperationAfterRepeat?.statusCode === expectedClipProcessingOperationStatusCodes.invalidated &&
      firstInvalidatedOperationAfterRepeat?.metadata?.previousStatus === 'pending' &&
      firstInvalidatedOperationAfterRepeat?.metadata?.previousStatusCode === expectedClipProcessingOperationStatusCodes.pending &&
      repeatedInvalidatedOperations.length === requiredClipProcessingOperationKeys.length,
    'StudioClip repeated boundary edits preserve prior invalidation audit rows and only invalidate the latest pending operation range',
  );
}

assertRule(
  typeof splitSliceReviewSegmentAtTimelinePlayhead === 'function',
  'StudioClip workflow exports a canonical review segment split helper for WYSIWYG timeline editing',
);
if (typeof splitSliceReviewSegmentAtTimelinePlayhead === 'function') {
  const splitReviewResult = splitSliceReviewSegmentAtTimelinePlayhead({
    reviewSession: workflowBehaviorReviewSession,
    segmentId: 'segment-1',
    splitAtMs: 2_600,
  });
  const splitSegments = splitReviewResult?.segments ?? [];
  const splitEdit = splitReviewResult?.manualEdit;
  assertRule(
    splitReviewResult !== null &&
      splitSegments.length === 2 &&
      splitSegments[0]?.id === 'segment-1-split-2600-a' &&
      splitSegments[1]?.id === 'segment-1-split-2600-b' &&
      splitSegments[0]?.title === 'Opening claim A' &&
      splitSegments[1]?.title === 'Opening claim B' &&
      splitSegments[0]?.startMs === 1_000 &&
      splitSegments[0]?.endMs === 2_600 &&
      splitSegments[1]?.startMs === 2_600 &&
      splitSegments[1]?.endMs === 5_000 &&
      splitSegments[0]?.durationMs === 1_600 &&
      splitSegments[1]?.durationMs === 2_400 &&
      splitSegments[0]?.selected === true &&
      splitSegments[1]?.selected === true &&
      splitSegments[0]?.status === 'selected' &&
      splitSegments[1]?.status === 'selected',
    'canonical review split replaces one clip with two stable WYSIWYG review segments that exactly cover the original source range',
  );
  assertRule(
    splitSegments[0]?.transcriptText === 'Opening claim with complete context.' &&
      splitSegments[1]?.transcriptText === 'with complete context.' &&
      splitSegments[0]?.transcriptSegments?.[1]?.endMs === 2_600 &&
      splitSegments[1]?.transcriptSegments?.[0]?.startMs === 2_600 &&
      splitSegments[0]?.speechStartMs === 1_100 &&
      splitSegments[0]?.speechEndMs === 2_600 &&
      splitSegments[1]?.speechStartMs === 2_600 &&
      splitSegments[1]?.speechEndMs === 4_800,
    'canonical review split clips transcript and speech evidence to the exact timeline playhead boundary',
  );
  assertRule(
    splitEdit?.kind === 'split' &&
      JSON.stringify(splitEdit.segmentIds) === JSON.stringify(['segment-1']) &&
      splitEdit.splitAtMs === 2_600 &&
      JSON.stringify(splitEdit.createdSegmentIds) === JSON.stringify(['segment-1-split-2600-a', 'segment-1-split-2600-b']) &&
      splitEdit.reason === 'manual split at timeline playhead',
    'canonical review split emits auditable manual edit evidence with splitAtMs and created segment ids',
  );
  const implicitSplitResult = splitSliceReviewSegmentAtTimelinePlayhead({
    reviewSession: workflowBehaviorReviewSession,
    segmentId: 'segment-1',
  });
  assertRule(
    implicitSplitResult?.splitAtMs === 2_000 &&
      implicitSplitResult?.manualEdit.reason === 'manual split at reviewed transcript boundary',
    'canonical review split falls back to a reviewed transcript boundary when no playhead time is supplied',
  );
  assertRule(
    splitSliceReviewSegmentAtTimelinePlayhead({
      reviewSession: workflowBehaviorReviewSession,
      segmentId: 'segment-1',
      splitAtMs: 1_100,
    }) === null &&
      splitSliceReviewSegmentAtTimelinePlayhead({
        reviewSession: workflowBehaviorReviewSession,
        segmentId: 'missing-segment',
        splitAtMs: 2_600,
      }) === null,
    'canonical review split returns null for invalid timeline positions or missing segments instead of mutating review state',
  );
  const splitTimeline = createStudioClipTimelineFromReviewSession({
    ...workflowBehaviorReviewSession,
    updatedAt: splitReviewResult?.reviewSession.updatedAt ?? workflowBehaviorReviewSession.updatedAt,
    segments: splitSegments,
    manualEdits: splitEdit ? [splitEdit] : [],
    selectedSegmentIds: splitSegments.filter((segment) => segment.selected && segment.status === 'selected').map((segment) => segment.id),
  });
  assertRule(
    splitTimeline.clips.length === 2 &&
      splitTimeline.clips[0]?.metadata?.reviewSegmentId === 'segment-1-split-2600-a' &&
      splitTimeline.clips[1]?.metadata?.reviewSegmentId === 'segment-1-split-2600-b' &&
      splitTimeline.processingOperations.length === requiredClipProcessingOperationKeys.length * 2,
    'StudioClip timeline regeneration turns canonical review splits into two independently processable clips',
  );
}

const canonicalReviewMutationHelpersAvailable = [
  selectAllSliceReviewSegmentsForRender,
  setSliceReviewSegmentsRenderSelectionForRender,
  setSliceReviewSegmentRenderSelectionOnStudioTimeline,
  mergeSliceReviewSegmentsOnStudioTimeline,
  markSliceReviewSegmentAsDuplicateOnStudioTimeline,
  restoreSliceReviewSegmentOnStudioTimeline,
].every((helper) => typeof helper === 'function');
assertRule(
  canonicalReviewMutationHelpersAvailable,
  'Clip workflow exports executable canonical helpers for select/exclude/merge/delete-duplicate/restore review mutations',
);
if (canonicalReviewMutationHelpersAvailable) {
  const workflowMutationReviewSession = {
    ...workflowBehaviorReviewSession,
    segments: [
      workflowBehaviorReviewSession.segments[0],
      {
        ...workflowBehaviorReviewSession.segments[0],
        id: 'segment-2',
        sourceClipIndex: 1,
        status: 'excluded',
        selected: false,
        title: 'Follow up proof',
        startMs: 5_000,
        endMs: 7_200,
        durationMs: 2_200,
        contentUnitIds: ['content-unit-2'],
        speakerIds: ['speaker-2'],
        speakerRoles: ['guest'],
        transcriptText: 'Follow up proof.',
        transcriptSegments: [
          { startMs: 5_100, endMs: 7_000, text: 'Follow up proof.', speaker: 'guest' },
        ],
        duplicateGroupId: 'duplicate-group-1',
      },
      {
        ...workflowBehaviorReviewSession.segments[0],
        id: 'segment-3',
        sourceClipIndex: 2,
        status: 'duplicate',
        selected: false,
        title: 'Repeated proof',
        startMs: 7_200,
        endMs: 8_400,
        durationMs: 1_200,
        contentUnitIds: ['content-unit-3'],
        speakerIds: ['speaker-2'],
        speakerRoles: ['guest'],
        transcriptText: 'Repeated proof.',
        transcriptSegments: [
          { startMs: 7_300, endMs: 8_300, text: 'Repeated proof.', speaker: 'guest' },
        ],
        duplicateGroupId: 'duplicate-group-1',
        duplicateOfSegmentId: 'segment-1',
      },
    ],
    duplicateGroups: [
      {
        id: 'duplicate-group-1',
        segmentIds: ['segment-1', 'segment-2', 'segment-3'],
        keptSegmentId: 'segment-1',
        reason: 'smart-dedup',
      },
    ],
    selectedSegmentIds: ['segment-1'],
  };
  const selectAllReviewResult = selectAllSliceReviewSegmentsForRender({
    reviewSession: workflowMutationReviewSession,
  });
  assertRule(
    selectAllReviewResult?.segments[0]?.status === 'selected' &&
      selectAllReviewResult?.segments[1]?.status === 'selected' &&
      selectAllReviewResult?.segments[2]?.status === 'duplicate' &&
      selectAllReviewResult?.reviewSession.selectedSegmentIds.join(',') === 'segment-1,segment-2' &&
      selectAllReviewResult?.manualEdit.kind === 'select' &&
      selectAllReviewResult.manualEdit.segmentIds.join(',') === 'segment-2' &&
      selectAllReviewResult.manualEdit.reason === 'manual bulk select all publishable review segments',
    'canonical bulk select selects only changed publishable review segments and never re-enables duplicates',
  );
  const clearSelectionResult = setSliceReviewSegmentsRenderSelectionForRender({
    reviewSession: workflowMutationReviewSession,
    selected: false,
  });
  assertRule(
    clearSelectionResult?.segments[0]?.status === 'excluded' &&
      clearSelectionResult?.segments[1]?.status === 'excluded' &&
      clearSelectionResult?.segments[2]?.status === 'duplicate' &&
      clearSelectionResult?.reviewSession.selectedSegmentIds.length === 0 &&
      clearSelectionResult?.manualEdit.kind === 'exclude' &&
      clearSelectionResult.manualEdit.segmentIds.join(',') === 'segment-1' &&
      clearSelectionResult.manualEdit.reason === 'manual clear selected review segments',
    'canonical clear selection excludes only currently selected review segments and leaves duplicate state untouched',
  );
  const singleSelectResult = setSliceReviewSegmentRenderSelectionOnStudioTimeline({
    reviewSession: workflowMutationReviewSession,
    segmentId: 'segment-2',
    selected: true,
  });
  assertRule(
    singleSelectResult?.segment.id === 'segment-2' &&
      singleSelectResult.segment.status === 'selected' &&
      singleSelectResult.segment.selected === true &&
      singleSelectResult.manualEdit.kind === 'select' &&
      singleSelectResult.manualEdit.segmentIds.join(',') === 'segment-2' &&
      setSliceReviewSegmentRenderSelectionOnStudioTimeline({
        reviewSession: workflowMutationReviewSession,
        segmentId: 'segment-3',
        selected: true,
      }) === null,
    'canonical single-segment selection updates one publishable review segment and rejects duplicate selection',
  );
  const duplicateResult = markSliceReviewSegmentAsDuplicateOnStudioTimeline({
    reviewSession: workflowMutationReviewSession,
    segmentId: 'segment-2',
  });
  assertRule(
    duplicateResult?.segment.id === 'segment-2' &&
      duplicateResult.segment.status === 'duplicate' &&
      duplicateResult.segment.selected === false &&
      duplicateResult.segment.duplicateOfSegmentId === 'segment-1' &&
      duplicateResult.manualEdit.kind === 'deleteDuplicate' &&
      duplicateResult.manualEdit.keepSegmentId === 'segment-1' &&
      duplicateResult.manualEdit.segmentIds.join(',') === 'segment-1,segment-2',
    'canonical duplicate deletion resolves the kept segment, marks the target duplicate, and records auditable keep-segment evidence',
  );
  const restoreResult = restoreSliceReviewSegmentOnStudioTimeline({
    reviewSession: workflowMutationReviewSession,
    segmentId: 'segment-3',
  });
  assertRule(
    restoreResult?.segment.id === 'segment-3' &&
      restoreResult.segment.status === 'selected' &&
      restoreResult.segment.selected === true &&
      restoreResult.segment.duplicateGroupId === undefined &&
      restoreResult.segment.duplicateOfSegmentId === undefined &&
      restoreResult.manualEdit.kind === 'restore' &&
      restoreResult.manualEdit.segmentIds.join(',') === 'segment-3',
    'canonical restore turns a duplicate review segment back into a selected renderable clip and clears duplicate metadata',
  );
  const mergeResult = mergeSliceReviewSegmentsOnStudioTimeline({
    reviewSession: workflowMutationReviewSession,
    segmentId: 'segment-2',
    direction: 'previous',
  });
  assertRule(
    mergeResult?.segment.id === 'segment-1-segment-2' &&
      mergeResult.segment.title === 'Opening claim + Follow up proof' &&
      mergeResult.segment.startMs === 1_000 &&
      mergeResult.segment.endMs === 7_200 &&
      mergeResult.segment.durationMs === 6_200 &&
      mergeResult.segment.status === 'selected' &&
      mergeResult.segment.selected === true &&
      mergeResult.segment.contentUnitIds.join(',') === 'content-unit-1,content-unit-2' &&
      mergeResult.segment.speakerIds.join(',') === 'speaker-1,speaker-2' &&
      mergeResult.segment.transcriptText === 'Opening claim with complete context. Follow up proof.' &&
      mergeResult.manualEdit.kind === 'merge' &&
      mergeResult.manualEdit.segmentIds.join(',') === 'segment-1,segment-2' &&
      mergeResult.manualEdit.createdSegmentIds?.join(',') === 'segment-1-segment-2' &&
      mergeResult.reviewSession.segments.map((segment) => segment.id).join(',') === 'segment-1-segment-2,segment-3',
    'canonical merge replaces adjacent publishable review segments with one continuous WYSIWYG clip while preserving evidence',
  );
  assertRule(
    mergeSliceReviewSegmentsOnStudioTimeline({
      reviewSession: workflowMutationReviewSession,
      segmentId: 'segment-3',
      direction: 'previous',
    }) === null &&
      markSliceReviewSegmentAsDuplicateOnStudioTimeline({
        reviewSession: workflowMutationReviewSession,
        segmentId: 'missing-segment',
      }) === null &&
      restoreSliceReviewSegmentOnStudioTimeline({
        reviewSession: workflowMutationReviewSession,
        segmentId: 'missing-segment',
      }) === null,
    'canonical review mutation helpers return null for missing or non-publishable mutation targets instead of mutating review state',
  );

  const selectedForRenderTimeline = createStudioClipTimelineFromReviewSession({
    ...workflowBehaviorReviewSession,
    status: 'ready_for_render',
  });
  const excludedForRenderResult = setSliceReviewSegmentRenderSelectionOnStudioTimeline({
    reviewSession: {
      ...workflowBehaviorReviewSession,
      status: 'ready_for_render',
    },
    segmentId: 'segment-1',
    selected: false,
  });
  const excludedForRenderTimeline = createStudioClipTimelineFromReviewSession(excludedForRenderResult.reviewSession);
  const mergedExcludedForRenderTimeline = mergeStudioClipTimelineSnapshotProcessingOperationHistory({
    snapshot: excludedForRenderTimeline,
    processingOperations: selectedForRenderTimeline.processingOperations,
  });
  assertRule(
    mergedExcludedForRenderTimeline.processingOperations.every((operation) =>
      operation.status === 'skipped' &&
        operation.statusCode === expectedClipProcessingOperationStatusCodes.skipped &&
        operation.enabled === false
    ),
    'StudioClip operation history merge lets current review selection state override stale selected-clip operation rows after a clip is excluded',
  );
  const reselectedForRenderResult = setSliceReviewSegmentRenderSelectionOnStudioTimeline({
    reviewSession: excludedForRenderResult.reviewSession,
    segmentId: 'segment-1',
    selected: true,
  });
  const reselectedForRenderTimeline = createStudioClipTimelineFromReviewSession(reselectedForRenderResult.reviewSession);
  const mergedReselectedForRenderTimeline = mergeStudioClipTimelineSnapshotProcessingOperationHistory({
    snapshot: reselectedForRenderTimeline,
    processingOperations: mergedExcludedForRenderTimeline.processingOperations,
  });
  assertRule(
    JSON.stringify(mergedReselectedForRenderTimeline.processingOperations.map((operation) => ({
      key: operation.operationKey,
      status: operation.status,
      blockedBy: operation.blockedByOperationKeys ?? [],
    }))) === JSON.stringify(expectedInitialReadyForRenderOperationStatuses),
    'StudioClip operation history merge lets current review selection state restore schedulable operation readiness after a clip is reselected',
  );
}

const workflowRenderedReviewSession = {
  ...workflowBehaviorReviewSession,
  status: 'rendered',
};
const workflowRenderedTimeline = createStudioClipTimelineFromReviewSession(workflowRenderedReviewSession);
assertRule(
  workflowRenderedTimeline.timeline.status === 'rendered' &&
    workflowRenderedTimeline.processingOperations.every((operation) =>
      operation.status === 'succeeded' &&
        operation.statusCode === expectedClipProcessingOperationStatusCodes.succeeded &&
        operation.attemptNo === 1 &&
        operation.maxAttempts === 3 &&
        typeof operation.startedAt === 'string' &&
        typeof operation.completedAt === 'string' &&
        typeof operation.durationMs === 'number' &&
        operation.durationMs >= 0 &&
        operation.clipBoundaryVersion === workflowRenderedTimeline.clips[0]?.boundaryVersion
    ),
  'rendered StudioClip timeline snapshots preserve completed boundary-versioned per-clip processing operation lifecycle state',
);

const workflowMixedReviewSession = {
  ...workflowApprovedReviewSession,
  segments: [
    workflowBehaviorReviewSession.segments[0],
    {
      ...workflowBehaviorReviewSession.segments[0],
      id: 'segment-excluded',
      sourceClipIndex: 1,
      status: 'excluded',
      selected: false,
      title: 'Excluded claim',
      startMs: 5_200,
      endMs: 8_000,
      durationMs: 2_800,
      contentUnitIds: ['content-unit-excluded'],
    },
    {
      ...workflowBehaviorReviewSession.segments[0],
      id: 'segment-duplicate',
      sourceClipIndex: 2,
      status: 'duplicate',
      selected: false,
      title: 'Duplicate claim',
      startMs: 8_200,
      endMs: 11_000,
      durationMs: 2_800,
      contentUnitIds: ['content-unit-duplicate'],
    },
  ],
  selectedSegmentIds: ['segment-1'],
};
const workflowMixedTimeline = createStudioClipTimelineFromReviewSession(workflowMixedReviewSession);
assertRule(
  workflowMixedTimeline.processingOperations
    .filter((operation) => operation.clipId !== workflowMixedTimeline.clips[0]?.id)
    .every((operation) =>
      operation.status === 'skipped' &&
        operation.enabled === false &&
        operation.attemptNo === 0 &&
        operation.completedAt === workflowMixedTimeline.clips.find((clip) => clip.id === operation.clipId)?.updatedAt &&
        operation.durationMs === 0
    ),
  'ready_for_render StudioClip timeline snapshots skip operations for excluded or duplicate clips with terminal lifecycle audit instead of processing non-output ranges',
);

const requiredUnifiedClipTables = [
  'ops_workflow_run',
  'ops_step_run',
  'ops_step_item_run',
  'media_text_track',
  'media_text_segment',
  'media_content_unit',
  'studio_timeline',
  'studio_clip',
  'studio_clip_source_ref',
  'studio_clip_processing_operation',
  'studio_clip_event',
];
for (const tableName of requiredUnifiedClipTables) {
  assertRule(
    sqliteBaselineSource.includes(`CREATE TABLE IF NOT EXISTS ${tableName}`),
    `SQLite baseline creates ${tableName} for unified Clip workflow persistence`,
  );
  assertRule(
    schemaRegistrySource.includes(`table_name: ${tableName}`),
    `schema registry declares ${tableName} for unified Clip workflow persistence`,
  );
  assertRule(
    databaseContractRsSource.includes(`name: "${tableName}"`),
    `Rust database contract verifies ${tableName} for unified Clip workflow persistence`,
  );
}

assertRule(
  sqliteBaselineSource.includes('invalidated_step_keys_json TEXT NOT NULL DEFAULT') &&
    sqliteBaselineSource.includes('invalidated_operation_keys_json TEXT NOT NULL DEFAULT') &&
    sqliteBaselineSource.includes('boundary_version INTEGER NOT NULL DEFAULT 1') &&
    schemaRegistrySource.includes('invalidated_step_keys_json: { type: json') &&
    schemaRegistrySource.includes('invalidated_operation_keys_json: { type: json'),
  'studio_clip and studio_clip_event persist boundary version and downstream invalidation as explicit queryable columns',
);
assertRule(
  /table_name:\s*studio_clip_event[\s\S]*?clip_uuid:\s*\{\s*type:\s*string,\s*length:\s*64,\s*required:\s*false\s*\}/u
    .test(schemaRegistrySource),
  'studio_clip_event schema registry declares the optional clip_uuid event target column used by boundary invalidation',
);
assertRule(
    sqliteBaselineSource.includes('status_key TEXT NOT NULL') &&
    sqliteBaselineSource.includes('execution_stage TEXT NOT NULL') &&
    sqliteBaselineSource.includes('dependency_operation_keys_json TEXT NOT NULL DEFAULT') &&
    sqliteBaselineSource.includes('blocked_by_operation_keys_json TEXT NOT NULL DEFAULT') &&
    sqliteBaselineSource.includes('blocking_reason TEXT') &&
    sqliteBaselineSource.includes('attempt_no INTEGER NOT NULL DEFAULT 0') &&
    sqliteBaselineSource.includes('max_attempts INTEGER NOT NULL DEFAULT 3') &&
    sqliteBaselineSource.includes('started_at TEXT') &&
    sqliteBaselineSource.includes('completed_at TEXT') &&
    sqliteBaselineSource.includes('duration_ms INTEGER') &&
    sqliteBaselineSource.includes('worker_id TEXT') &&
    sqliteBaselineSource.includes('clip_boundary_version INTEGER NOT NULL DEFAULT 1') &&
    sqliteBaselineSource.includes("CHECK (operation_key IN ('denoise-audio', 'normalize-loudness', 'remove-cough-and-breath-noise', 'trim-silence', 'filter-repeated-content', 'check-duplicate-content', 'refine-subtitle-cues', 'select-cover-frame'))") &&
    sqliteBaselineSource.includes("CHECK ((operation_order = 1 AND operation_key = 'denoise-audio')") &&
    sqliteBaselineSource.includes("OR (operation_order = 8 AND operation_key = 'select-cover-frame'))") &&
    sqliteBaselineSource.includes('source_start_ms INTEGER NOT NULL') &&
    sqliteBaselineSource.includes('source_end_ms INTEGER NOT NULL') &&
    sqliteBaselineSource.includes('source_duration_ms INTEGER NOT NULL') &&
    sqliteBaselineSource.includes('CHECK (status IN (10, 20, 30, 40, 50, 60, 70))') &&
    sqliteBaselineSource.includes("CHECK (execution_stage IN ('audio-foundation', 'speech-cleanup', 'content-cleanup', 'publishing-assets'))") &&
    sqliteBaselineSource.includes("CHECK ((operation_key = 'denoise-audio' AND dependency_operation_keys_json = '[]')") &&
    sqliteBaselineSource.includes("OR (operation_key = 'normalize-loudness' AND dependency_operation_keys_json = '[\"denoise-audio\"]')") &&
    sqliteBaselineSource.includes("OR (operation_key = 'select-cover-frame' AND dependency_operation_keys_json = '[\"check-duplicate-content\"]'))") &&
    sqliteBaselineSource.includes("CHECK (blocking_reason IS NULL OR blocking_reason IN ('waiting-for-dependencies', 'timeline-not-ready', 'clip-not-selected'))") &&
    sqliteBaselineSource.includes("CHECK (status <> 10 OR (blocking_reason IS NOT NULL AND blocked_by_operation_keys_json IS NOT NULL))") &&
    sqliteBaselineSource.includes("CHECK (status = 10 OR blocked_by_operation_keys_json = '[]')") &&
    sqliteBaselineSource.includes('CHECK (status = 10 OR blocking_reason IS NULL)') &&
    sqliteBaselineSource.includes("CHECK ((status = 10 AND status_key = 'blocked')") &&
    sqliteBaselineSource.includes("OR (status = 70 AND status_key = 'invalidated'))") &&
    sqliteBaselineSource.includes('CHECK (source_end_ms > source_start_ms)') &&
    sqliteBaselineSource.includes('CHECK (source_duration_ms = source_end_ms - source_start_ms)') &&
    sqliteBaselineSource.includes('CHECK (attempt_no >= 0 AND max_attempts >= 1 AND attempt_no <= max_attempts)') &&
    sqliteBaselineSource.includes('CHECK (status <> 30 OR (attempt_no >= 1 AND started_at IS NOT NULL AND completed_at IS NULL))') &&
    sqliteBaselineSource.includes('CHECK (status NOT IN (40, 50, 60, 70) OR completed_at IS NOT NULL)') &&
    sqliteBaselineSource.includes('CHECK (status NOT IN (10, 20) OR (attempt_no = 0 AND started_at IS NULL AND completed_at IS NULL AND duration_ms IS NULL))') &&
    sqliteBaselineSource.includes('CHECK (duration_ms IS NULL OR duration_ms >= 0)') &&
    sqliteBaselineSource.includes('CHECK (boundary_version >= 1)') &&
    sqliteBaselineSource.includes('CHECK (clip_boundary_version >= 1)') &&
    sqliteBaselineSource.includes('invalidated_by_event_uuid TEXT') &&
    sqliteBaselineSource.includes('invalidated_at TEXT') &&
    schemaRegistrySource.includes('boundary_version: { type: int64, required: true, default: 1 }') &&
    schemaRegistrySource.includes('execution_stage: { type: string, length: 64, required: true, allowed: "audio-foundation|speech-cleanup|content-cleanup|publishing-assets" }') &&
    schemaRegistrySource.includes('dependency_operation_keys_json: { type: json, required: true, default: "[]" }') &&
    schemaRegistrySource.includes('blocked_by_operation_keys_json: { type: json, required: true, default: "[]" }') &&
    schemaRegistrySource.includes('blocking_reason: { type: string, length: 64, required: false, allowed: "waiting-for-dependencies|timeline-not-ready|clip-not-selected" }') &&
    schemaRegistrySource.includes('attempt_no: { type: int64, required: true, default: 0 }') &&
    schemaRegistrySource.includes('max_attempts: { type: int64, required: true, default: 3 }') &&
    schemaRegistrySource.includes('started_at: { type: instant, required: false }') &&
    schemaRegistrySource.includes('completed_at: { type: instant, required: false }') &&
    schemaRegistrySource.includes('duration_ms: { type: int64, required: false }') &&
    schemaRegistrySource.includes('worker_id: { type: string, length: 128, required: false }') &&
    schemaRegistrySource.includes('clip_boundary_version: { type: int64, required: true, default: 1 }') &&
    schemaRegistrySource.includes('operation_key: { type: string, length: 96, required: true, allowed: "denoise-audio|normalize-loudness|remove-cough-and-breath-noise|trim-silence|filter-repeated-content|check-duplicate-content|refine-subtitle-cues|select-cover-frame" }') &&
    schemaRegistrySource.includes('status_key: { type: string') &&
    schemaRegistrySource.includes('status: { type: enum_int32, required: true, allowed: "10|20|30|40|50|60|70" }') &&
    schemaRegistrySource.includes('source_start_ms: { type: int64') &&
    schemaRegistrySource.includes('source_end_ms: { type: int64') &&
    schemaRegistrySource.includes('source_duration_ms: { type: int64') &&
    schemaRegistrySource.includes('invalidated_by_event_uuid: { type: string') &&
    schemaRegistrySource.includes('invalidated_at: { type: instant') &&
    databaseContractRsSource.includes('source_start_ms') &&
    databaseContractRsSource.includes('source_end_ms') &&
    databaseContractRsSource.includes('source_duration_ms') &&
    databaseContractRsSource.includes('execution_stage') &&
    databaseContractRsSource.includes('dependency_operation_keys_json') &&
    databaseContractRsSource.includes('blocked_by_operation_keys_json') &&
    databaseContractRsSource.includes('blocking_reason') &&
    databaseContractRsSource.includes('attempt_no') &&
    databaseContractRsSource.includes('max_attempts') &&
    databaseContractRsSource.includes('started_at') &&
    databaseContractRsSource.includes('completed_at') &&
    databaseContractRsSource.includes('duration_ms') &&
    databaseContractRsSource.includes('worker_id') &&
    databaseContractRsSource.includes('boundary_version') &&
    databaseContractRsSource.includes('clip_boundary_version') &&
    databaseContractRsSource.includes('invalidated_by_event_uuid') &&
    databaseContractRsSource.includes('invalidated_at') &&
    schemaRegistrySource.includes('blocked|pending|running|succeeded|skipped|failed|invalidated') &&
    databaseRuntimeRsSource.includes('test-operation-blocked-without-reason') &&
    databaseRuntimeRsSource.includes('test-operation-pending-with-blocked-by') &&
    databaseRuntimeRsSource.includes('test-operation-pending-with-blocking-reason'),
  'studio_clip_processing_operation persists and enforces canonical operation sequence, dependency DAG, dependency readiness, status code, status key, retry lifecycle, clip boundary version, source range, and invalidation audit columns across SQL, registry, and Rust contract',
);

assertRule(
  !plannerSource.includes('const insertIndex = sorted.findIndex') &&
    !plannerSource.includes('sorted.splice(insertIndex, 0'),
  'planner uses native stable sort instead of quadratic insertion-sort helpers for large transcript workloads',
);
assertRule(
  !plannerSource.includes('const frontier: NormalizedSlicePlanClip[][]') &&
    plannerSource.includes('selectOptimalSliceCandidateSetByDynamicProgramming') &&
    plannerSource.includes('findPreviousCompatibleSliceCandidateIndexes'),
  'planner selects transcript-aligned slice candidates with bounded dynamic programming instead of exponential frontier enumeration',
);
assertRule(
  plannerSource.includes('sortSliceClipsByEndMs') &&
    plannerSource.includes('SLICE_CANDIDATE_DP_BEAM_WIDTH') &&
    plannerSource.includes('isSliceCandidatePlanInternallyCompatible'),
  'planner dynamic programming is ordered by candidate end time, keeps a bounded beam, and revalidates whole-plan repeat compatibility',
);
assertRule(
  plannerSource.includes('MAX_TRANSCRIPT_SLICE_CANDIDATE_POOL_SIZE') &&
    plannerSource.includes('pruneTranscriptSliceCandidatePool') &&
    plannerSource.includes('getTranscriptSliceCandidatePoolLimit') &&
    plannerSource.includes('candidatePoolLimit'),
  'planner prunes speech-to-text candidate pools during generation for long transcript performance',
);

const sparseSpeechSegments = [
  {
    startMs: 10_000,
    endMs: 15_600,
    text: 'How to remove silent intros from short video clips.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 31_000,
    endMs: 36_600,
    text: 'How to remove silent intros from short video clips.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 55_000,
    endMs: 60_700,
    text: 'Then keep only the complete spoken payoff.',
    speaker: 'Speaker 1',
  },
];
const sparseSpeechPlan = createTranscriptAssistedSlicePlan(
  {
    ...baseParams,
    minDuration: 15,
    maxDuration: 60,
    sourceDurationMs: 90_000,
    enableRepeatFilter: true,
  },
  sparseSpeechSegments,
);
assertRule(
  sparseSpeechPlan.length >= 1,
  'transcript-assisted planner can create clips from short speech-to-text segments without relying on fixed silent filler windows',
);
assertRule(
  sparseSpeechPlan.every((clip) => (clip.boundaryPaddingBeforeMs ?? 0) <= 500),
  'transcript-assisted planner clamps leading silence around speech-to-text starts',
);
assertRule(
  sparseSpeechPlan.every((clip) => (clip.boundaryPaddingAfterMs ?? 0) <= 500),
  'transcript-assisted planner clamps trailing silence around speech-to-text ends',
);
assertRule(
  sparseSpeechPlan.every((clip) => (clip.speechEndMs ?? clip.startMs + clip.durationMs) - (clip.speechStartMs ?? clip.startMs) >= clip.durationMs - 1_000),
  'transcript-assisted planner does not stretch sparse speech windows with long silent padding just to satisfy requested minimum duration',
);
assertEqual(
  sparseSpeechPlan.filter((clip) => clip.transcriptText === sparseSpeechSegments[0].text).length,
  1,
  'transcript-assisted planner deduplicates repeated speech-to-text content across different time ranges',
);
assertRule(
  sparseSpeechPlan.some((clip) => clip.risks?.includes('transcript-repeat-filtered')),
  'transcript-assisted planner records when repeated speech-to-text windows are filtered',
);
assertEqual(
  sparseSpeechPlan.filter((clip) => clip.transcriptText?.includes('Then keep only the complete spoken payoff.')).length,
  1,
  'transcript-assisted planner preserves the non-repeated payoff after filtering repeated sparse setup speech',
);
const fillerHeavyTranscriptCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 22,
  maxDuration: 45,
  continuityLevel: 'standard',
  highlightEngine: 'keyword',
  customKeywords: ['retention', 'refund'],
}, [
  { startMs: 0, endMs: 12_000, text: 'um um uh', speaker: 'Speaker 1' },
  { startMs: 12_100, endMs: 21_000, text: 'Well, watch the retention setup and pricing pain.', speaker: 'Speaker 1' },
  { startMs: 21_100, endMs: 30_000, text: 'So the complete payoff is the refund fix.', speaker: 'Speaker 1' },
]);
const fillerHeavyTranscriptCandidate = fillerHeavyTranscriptCandidates.find((candidate) =>
  candidate.transcriptText?.includes('retention setup') &&
  candidate.transcriptText.includes('refund fix'),
);
assertRule(
  Boolean(fillerHeavyTranscriptCandidate),
  'speech-to-text filler cleanup still keeps the meaningful retention-to-payoff candidate window',
);
assertRule(
  !/\b(?:um|uh)\b/iu.test(fillerHeavyTranscriptCandidate?.transcriptText ?? ''),
  'speech-to-text filler cleanup removes pure filler words from transcript candidate text',
);
assertRule(
  !/^(?:um|uh|well|like|you know|i mean|okay|so)\b/iu.test(fillerHeavyTranscriptCandidate?.label ?? ''),
  'speech-to-text filler cleanup prevents filler words from becoming task clip titles',
);
assertEqual(
  fillerHeavyTranscriptCandidate?.transcriptSegmentCount,
  2,
  'speech-to-text filler cleanup excludes pure filler segments from transcript segment counts',
);
const explicitConflictStoryCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 15,
  maxDuration: 25,
  continuityLevel: 'strict',
  sourceDurationMs: 50_000,
}, [
  {
    startMs: 0,
    endMs: 9_000,
    text: 'Why artifact checks matter is simple. Because the artifact conflict blocks safe review.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 9_020,
    endMs: 19_000,
    text: 'So the artifact check rejects the bad artifact and keeps artifact storage safe.',
    speaker: 'Speaker 1',
  },
]);
const explicitConflictStoryCandidate = explicitConflictStoryCandidates.find((candidate) =>
  candidate.transcriptSegmentCount === 2 &&
    candidate.transcriptText?.includes('artifact conflict') &&
    candidate.transcriptText.includes('artifact storage'),
);
assertArrayIncludes(
  explicitConflictStoryCandidate?.contentArcStages,
  'conflict',
  'speech-to-text content arcs treat explicit conflict language as the conflict stage',
);
assertEqual(
  explicitConflictStoryCandidate?.contentArcGrade,
  'complete',
  'speech-to-text content arcs grade explicit conflict stories as complete when hook, setup, and payoff are present',
);
const punctuationOnlyTitleCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 5,
  maxDuration: 25,
  continuityLevel: 'strict',
}, [
  { startMs: 0, endMs: 6_000, text: 'And?', speaker: 'Speaker 1' },
  { startMs: 12_000, endMs: 21_000, text: 'Then retention payoff fixes refund churn.', speaker: 'Speaker 1' },
]);
assertRule(
  !punctuationOnlyTitleCandidates.some((candidate) => /^[^\p{L}\p{N}]+$/u.test(candidate.label)),
  'speech-to-text title extraction never emits punctuation-only candidate labels',
);
assertRule(
  punctuationOnlyTitleCandidates.some((candidate) => candidate.label === 'Smart slice 1'),
  'speech-to-text title extraction falls back to a stable slice label when weak connectors strip all words',
);
const isolatedMicroSpeechPlan = createTranscriptAssistedSlicePlan(
  {
    ...baseParams,
    minDuration: 15,
    maxDuration: 60,
    sourceDurationMs: 90_000,
    enableRepeatFilter: true,
  },
  [
    {
      startMs: 10_000,
      endMs: 12_000,
      text: 'Tiny isolated speech.',
      speaker: 'Speaker 1',
    },
    {
      startMs: 40_000,
      endMs: 42_000,
      text: 'Another tiny isolated speech.',
      speaker: 'Speaker 1',
    },
  ],
);
assertRule(
  isolatedMicroSpeechPlan.length >= 1,
  'transcript-assisted planner creates reviewable speech-backed clips from isolated micro speech instead of failing the whole smart slice task',
);
assertRule(
  isolatedMicroSpeechPlan.some((clip) => clip.transcriptText?.includes('Tiny isolated speech.')) &&
    isolatedMicroSpeechPlan.some((clip) => clip.transcriptText?.includes('Another tiny isolated speech.')),
  'transcript-assisted planner covers every separated isolated micro speech segment instead of dropping repeated-looking speech',
);
assertRule(
  isolatedMicroSpeechPlan.every((clip) => clip.transcriptText?.trim()),
  'transcript-assisted planner keeps visible transcript text on isolated micro speech fallback clips',
);
assertRule(
  isolatedMicroSpeechPlan.every((clip) => (clip.transcriptSegmentCount ?? 0) > 0),
  'transcript-assisted planner keeps structured transcript segment evidence on isolated micro speech fallback clips',
);
assertRule(
  isolatedMicroSpeechPlan.every((clip) => (clip.transcriptCoverageScore ?? 0) >= 0.8),
  'transcript-assisted planner keeps professional transcript coverage on isolated micro speech fallback clips',
);
assertRule(
  isolatedMicroSpeechPlan.every((clip) => clip.durationMs < 3_000),
  'transcript-assisted planner does not pad isolated micro speech up to long requested minimum durations',
);
assertRule(
  isolatedMicroSpeechPlan.every((clip) => (clip.boundaryPaddingBeforeMs ?? 0) <= 500 && (clip.boundaryPaddingAfterMs ?? 0) <= 500),
  'transcript-assisted planner bounds silence padding on isolated micro speech fallback clips',
);
assertRule(
  isolatedMicroSpeechPlan.every((clip) => clip.risks?.includes('sparse-transcript-speech')),
  'transcript-assisted planner marks isolated micro speech fallback clips for review instead of hiding sparse transcript risk',
);
const sparseSpeechCandidates = buildTranscriptSliceCandidates(
  {
    ...baseParams,
    minDuration: 15,
    maxDuration: 60,
    sourceDurationMs: 90_000,
    enableRepeatFilter: true,
  },
  sparseSpeechSegments,
);
const llmSparseSpeechPlan = parseLlmSlicePlan(
  JSON.stringify([
    {
      candidateId: sparseSpeechCandidates[0]?.candidateId,
      title: 'Trimmed speech candidate',
      qualityScore: 0.9,
      continuityScore: 0.9,
    },
  ]),
  {
    ...baseParams,
    minDuration: 15,
    maxDuration: 60,
    sourceDurationMs: 90_000,
    enableRepeatFilter: true,
  },
  sparseSpeechPlan,
  sparseSpeechCandidates,
);
assertRule(
  (llmSparseSpeechPlan[0]?.boundaryPaddingAfterMs ?? Number.POSITIVE_INFINITY) <= 500,
  'LLM candidate-id planning preserves trimmed speech-to-text trailing boundaries instead of re-expanding sparse speech to the requested minimum',
);
assertRule(
  (llmSparseSpeechPlan[0]?.speechEndMs ?? 0) - (llmSparseSpeechPlan[0]?.speechStartMs ?? 0) >=
    (llmSparseSpeechPlan[0]?.durationMs ?? 0) - 1_000,
  'LLM candidate-id planning keeps sparse speech render windows aligned to speech duration',
);
assertArrayIncludes(
  llmSparseSpeechPlan[0]?.risks,
  'transcript-repeat-filtered',
  'LLM candidate-id planning preserves transcript repeat-filtering risks from matched speech-to-text candidates',
);

const partialDuplicateCandidates = buildTranscriptSliceCandidates(
  {
    ...baseParams,
    minDuration: 10,
    maxDuration: 40,
    sourceDurationMs: 90_000,
    enableRepeatFilter: true,
  },
  [
    {
      startMs: 0,
      endMs: 12_000,
      text: 'Watch the retention hook, pricing pain, and final refund fix for this launch.',
      speaker: 'Speaker 1',
    },
    {
      startMs: 24_000,
      endMs: 36_000,
      text: 'This launch refund fix repeats the pricing pain and retention hook.',
      speaker: 'Speaker 1',
    },
    {
      startMs: 55_000,
      endMs: 68_000,
      text: 'A different onboarding example explains setup, user confusion, and the final payoff.',
      speaker: 'Speaker 1',
    },
  ],
);
assertEqual(
  partialDuplicateCandidates.filter((candidate) => candidate.transcriptText?.includes('retention hook')).length,
  1,
  'transcript repeat filter removes high-overlap paraphrased speech windows that are not strict text substrings',
);
assertRule(
  partialDuplicateCandidates.some((candidate) => candidate.risks?.includes('transcript-repeat-filtered')),
  'transcript repeat filter records filtered high-overlap paraphrased speech windows for review',
);
const shortPhraseDuplicateCandidates = buildTranscriptSliceCandidates(
  {
    ...baseParams,
    minDuration: 5,
    maxDuration: 20,
    enableRepeatFilter: true,
    continuityLevel: 'strict',
  },
  [
    { startMs: 0, endMs: 9_000, text: 'Refund fix improves retention.', speaker: 'Speaker 1' },
    { startMs: 16_000, endMs: 25_000, text: 'Refund fix improved retention.', speaker: 'Speaker 1' },
    { startMs: 36_000, endMs: 45_000, text: 'Pricing setup explains invoice pain.', speaker: 'Speaker 1' },
  ],
);
assertEqual(
  shortPhraseDuplicateCandidates.filter((candidate) => candidate.transcriptText?.includes('Refund fix')).length,
  1,
  'transcript repeat filter removes short one-sentence paraphrases that differ only by inflection',
);
assertRule(
  shortPhraseDuplicateCandidates.some((candidate) => candidate.risks?.includes('transcript-repeat-filtered')),
  'transcript repeat filter records filtered short one-sentence paraphrases for review',
);
const semanticDuplicateCandidates = buildTranscriptSliceCandidates(
  {
    ...baseParams,
    minDuration: 5,
    maxDuration: 25,
    enableRepeatFilter: true,
    continuityLevel: 'strict',
  },
  [
    { startMs: 0, endMs: 9_000, text: 'Refund fix improves retention.', speaker: 'Speaker 1' },
    { startMs: 15_000, endMs: 24_000, text: 'Return repair boosts retention.', speaker: 'Speaker 1' },
    { startMs: 34_000, endMs: 44_000, text: 'Pricing setup explains invoice pain.', speaker: 'Speaker 1' },
  ],
);
assertEqual(
  semanticDuplicateCandidates.filter((candidate) =>
    candidate.transcriptText?.includes('retention') &&
      /Refund fix|Return repair/u.test(candidate.transcriptText)
  ).length,
  1,
  'transcript repeat filter removes semantically equivalent short windows even when the duplicate uses different words',
);
assertRule(
  semanticDuplicateCandidates.some((candidate) => candidate.risks?.includes('transcript-repeat-filtered')),
  'transcript repeat filter records semantically equivalent short-window removals for review',
);
const businessMeaningDuplicateCandidates = buildTranscriptSliceCandidates(
  {
    ...baseParams,
    minDuration: 5,
    maxDuration: 20,
    enableRepeatFilter: true,
    continuityLevel: 'strict',
  },
  [
    { startMs: 0, endMs: 9_000, text: 'Customers cancel after a confusing bill.', speaker: 'Speaker 1' },
    { startMs: 15_000, endMs: 24_000, text: 'Users churn after unclear invoices.', speaker: 'Speaker 1' },
    { startMs: 34_000, endMs: 44_000, text: 'Pricing setup explains annual terms.', speaker: 'Speaker 1' },
  ],
);
assertEqual(
  businessMeaningDuplicateCandidates.filter((candidate) =>
    /\b(?:cancel|churn)\b/iu.test(candidate.transcriptText ?? '')
  ).length,
  1,
  'transcript repeat filter removes business-meaning duplicates using semantic canonical tokens',
);
const internalRepeatCandidates = buildTranscriptSliceCandidates(
  {
    ...baseParams,
    minDuration: 15,
    maxDuration: 45,
    sourceDurationMs: 70_000,
    enableRepeatFilter: true,
    continuityLevel: 'standard',
  },
  [
    { startMs: 0, endMs: 8_000, text: 'Watch the onboarding setup and retention pain.', speaker: 'Speaker 1' },
    { startMs: 8_000, endMs: 16_000, text: 'Watch the onboarding setup and retention pain.', speaker: 'Speaker 1' },
    { startMs: 16_000, endMs: 28_000, text: 'So the payoff is the activation fix viewers can apply.', speaker: 'Speaker 1' },
    { startMs: 40_000, endMs: 52_000, text: 'Watch the pricing setup and invoice pain.', speaker: 'Speaker 1' },
    { startMs: 52_000, endMs: 64_000, text: 'So the payoff is the billing fix viewers can apply.', speaker: 'Speaker 1' },
  ],
);
const internalRepeatCandidate = internalRepeatCandidates.find((candidate) =>
  candidate.transcriptSegmentCount === 2 &&
    (candidate.transcriptText?.match(/onboarding setup/giu)?.length ?? 0) >= 2
);
assertArrayIncludes(
  internalRepeatCandidate?.risks,
  'transcript-internal-repeat',
  'speech-to-text planning flags candidate windows that contain repeated meaning inside the same rendered slice',
);
assertRule(
  (internalRepeatCandidate?.qualityScore ?? 1) <= 0.72,
  'speech-to-text planning downgrades internally repeated windows so clean continuous clips win selection',
);
const noiseInterruptedTranscriptCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 15,
  maxDuration: 45,
  continuityLevel: 'standard',
  highlightEngine: 'keyword',
  customKeywords: ['activation', 'payoff'],
}, [
  { startMs: 0, endMs: 9_000, text: 'Watch the onboarding setup and activation pain.', speaker: 'Speaker 1' },
  { startMs: 9_100, endMs: 10_000, text: '[coughing]', speaker: 'Speaker 1' },
  { startMs: 10_100, endMs: 11_000, text: '[laughing]', speaker: 'Speaker 1' },
  { startMs: 11_100, endMs: 12_000, text: '[Music]', speaker: 'Speaker 1' },
  { startMs: 12_100, endMs: 25_000, text: 'So the complete payoff is the activation fix viewers can apply.', speaker: 'Speaker 1' },
]);
const noiseInterruptedTranscriptCandidate = noiseInterruptedTranscriptCandidates.find((candidate) =>
  candidate.transcriptText?.includes('onboarding setup') &&
    candidate.transcriptText.includes('activation fix')
);
assertRule(
  Boolean(noiseInterruptedTranscriptCandidate),
  'speech-to-text noise cleanup keeps one continuous setup-to-payoff window across removed cough, laugh, and music markers',
);
assertRule(
  !/\b(?:coughing|music)\b|哈哈/u.test(noiseInterruptedTranscriptCandidate?.transcriptText ?? ''),
  'speech-to-text noise cleanup removes cough, laugh, and music-only transcript fragments from planned clip text',
);
assertEqual(
  noiseInterruptedTranscriptCandidate?.transcriptSegmentCount,
  2,
  'speech-to-text noise cleanup excludes noise-only fragments from transcript segment evidence',
);
assertEqual(
  normalizeSmartSliceTranscriptEvidenceText('[coughing]'),
  '',
  'speech-to-text evidence cleanup drops cough-only transcript fragments before native rendering',
);
assertEqual(
  normalizeSmartSliceTranscriptEvidenceText('[MUSIC PLAYING]'),
  '',
  'speech-to-text evidence cleanup drops descriptive music-only STT tags before native rendering',
);
assertEqual(
  normalizeSmartSliceTranscriptEvidenceText('[BLANK_AUDIO]'),
  '',
  'speech-to-text evidence cleanup drops blank-audio STT tags before native rendering',
);
assertEqual(
  normalizeSmartSliceTranscriptEvidenceText('\u3010\u97f3\u4e50\u3011'),
  '',
  'speech-to-text evidence cleanup drops CJK bracketed music tags before native rendering',
);
assertEqual(
  normalizeSmartSliceTranscriptEvidenceText('\uff08\u54b3\u55fd\uff09'),
  '',
  'speech-to-text evidence cleanup drops full-width bracketed cough tags before native rendering',
);
assertEqual(
  normalizeSmartSliceTranscriptEvidenceText('um, What works is this.'),
  'What works is this.',
  'speech-to-text evidence cleanup removes edge filler before native rendering',
);
const audioMuteRanges = createSmartSliceTranscriptAudioMuteRanges(0, 25_000, [
  { startMs: 0, endMs: 9_000, text: 'Watch the onboarding setup and activation pain.', speaker: 'Speaker 1' },
  { startMs: 9_100, endMs: 10_000, text: '[coughing]', speaker: 'Speaker 1' },
  { startMs: 10_100, endMs: 10_700, text: 'um', speaker: 'Speaker 1' },
  { startMs: 11_100, endMs: 12_000, text: '[Music]', speaker: 'Speaker 1' },
  { startMs: 12_100, endMs: 25_000, text: 'So the complete payoff is the activation fix viewers can apply.', speaker: 'Speaker 1' },
  { startMs: 26_000, endMs: 30_000, text: '[Music]', speaker: 'Speaker 1' },
]);
assertEqual(audioMuteRanges.length, 3, 'speech-to-text noise cleanup creates audio mute ranges for short noise and filler fragments inside rendered clips');
assertEqual(audioMuteRanges[0]?.startMs, 9_100, 'speech-to-text audio mute range keeps the original cough start boundary');
assertEqual(audioMuteRanges[2]?.endMs, 12_000, 'speech-to-text audio mute range keeps the original music end boundary');
const mergedLongAudioMuteRanges = createSmartSliceTranscriptAudioMuteRanges(0, 12_000, [
  { startMs: 3_000, endMs: 5_000, text: '[Music]', speaker: 'Speaker 1' },
  { startMs: 5_000, endMs: 7_000, text: '[coughing]', speaker: 'Speaker 1' },
]);
assertEqual(
  mergedLongAudioMuteRanges.length,
  0,
  'speech-to-text noise cleanup refuses merged mute ranges that would create a long silent hole inside the rendered clip',
);
const silenceCompactedSourceSegments = createSmartSliceSpeechSourceSegments(
  {
    index: 0,
    startMs: 0,
    durationMs: 18_000,
    label: 'Silence compaction candidate',
    sourceStartMs: 0,
    sourceEndMs: 18_000,
    speechStartMs: 1_000,
    speechEndMs: 17_200,
    transcriptCoverageScore: 0.9,
    transcriptSegmentCount: 3,
    speechContinuityGrade: 'repaired',
  },
  [
    { startMs: 1_000, endMs: 4_000, text: 'The first useful spoken section sets up the idea.', speaker: 'Speaker 1' },
    { startMs: 10_600, endMs: 13_000, text: 'The second useful spoken section continues the same point.', speaker: 'Speaker 1' },
    { startMs: 15_500, endMs: 17_200, text: 'The final spoken section completes the thought.', speaker: 'Speaker 1' },
  ],
);
assertEqual(
  silenceCompactedSourceSegments.length,
  3,
  'speech-to-text silence compaction splits one semantic slice into retained source speech islands',
);
assertEqual(
  silenceCompactedSourceSegments[0]?.startMs,
  800,
  'speech-to-text silence compaction keeps only professional leading room before the first speech island',
);
assertEqual(
  silenceCompactedSourceSegments[0]?.endMs,
  4_250,
  'speech-to-text silence compaction keeps only a short natural pause after a speech island',
);
assertEqual(
  silenceCompactedSourceSegments[1]?.startMs,
  10_400,
  'speech-to-text silence compaction trims the long internal pause before the next speech island',
);
assertEqual(
  silenceCompactedSourceSegments[2]?.endMs,
  17_450,
  'speech-to-text silence compaction keeps final speech breathing room without preserving the whole quiet tail',
);
assertEqual(
  silenceCompactedSourceSegments.reduce((total, segment) => total + segment.endMs - segment.startMs, 0),
  8_450,
  'speech-to-text silence compaction reports a rendered duration based on retained source islands instead of the original silent span',
);
const audioActivityCompactedSourceSegments = createSmartSliceAudioActivitySourceSegments(
  {
    index: 0,
    startMs: 57_140,
    durationMs: 36_160,
    label: 'Real coarse STT span with internal pauses',
    sourceStartMs: 57_140,
    sourceEndMs: 93_300,
    speechStartMs: 57_340,
    speechEndMs: 93_300,
    transcriptCoverageScore: 0.9,
    transcriptSegmentCount: 4,
    speechContinuityGrade: 'repaired',
  },
  {
    index: 0,
    startMs: 57_140,
    durationMs: 36_160,
    sourceStartMs: 57_140,
    sourceEndMs: 93_300,
    audioActivityStartMs: 57_340,
    audioActivityEndMs: 93_300,
    leadingSilenceMs: 200,
    trailingSilenceMs: 0,
    internalSilenceIntervals: [
      { startMs: 64_950, endMs: 72_090 },
      { startMs: 78_030, endMs: 79_670 },
      { startMs: 86_900, endMs: 91_750 },
    ],
    confidence: 0.91,
    analysisFilter: 'silencedetect=noise=-35dB:d=0.08',
  },
);
assertEqual(
  audioActivityCompactedSourceSegments.length,
  4,
  'audio activity silence compaction splits coarse STT spans using detected internal silence intervals',
);
assertEqual(
  audioActivityCompactedSourceSegments[0]?.endMs,
  65_125,
  'audio activity silence compaction keeps only natural silence before the first long internal pause',
);
assertEqual(
  audioActivityCompactedSourceSegments[1]?.startMs,
  71_915,
  'audio activity silence compaction keeps only natural silence after the first long internal pause',
);
assertEqual(
  audioActivityCompactedSourceSegments.reduce((total, segment) => total + segment.endMs - segment.startMs, 0),
  23_580,
  'audio activity silence compaction removes multi-second pauses from the rendered source duration',
);
const audioActivityLeadingSilenceCompactedSourceSegments = createSmartSliceAudioActivitySourceSegments(
  {
    index: 0,
    startMs: 93_300,
    durationMs: 35_600,
    label: 'Real STT boundary with acoustic leading silence',
    sourceStartMs: 93_300,
    sourceEndMs: 128_900,
    speechStartMs: 93_300,
    speechEndMs: 128_900,
    transcriptCoverageScore: 0.9,
    transcriptSegmentCount: 8,
    speechContinuityGrade: 'strong',
  },
  {
    index: 0,
    startMs: 93_300,
    durationMs: 35_600,
    sourceStartMs: 93_300,
    sourceEndMs: 128_900,
    audioActivityStartMs: 96_660,
    audioActivityEndMs: 128_900,
    leadingSilenceMs: 3_360,
    trailingSilenceMs: 0,
    internalSilenceIntervals: [
      { startMs: 93_300, endMs: 96_660 },
      { startMs: 115_022, endMs: 122_359 },
    ],
    confidence: 0.91,
    analysisFilter: 'silencedetect=noise=-35dB:d=0.08',
  },
);
assertEqual(
  audioActivityLeadingSilenceCompactedSourceSegments[0]?.startMs,
  96_460,
  'audio activity silence compaction keeps no more than professional leading audio padding before audible speech',
);
assertEqual(
  audioActivityLeadingSilenceCompactedSourceSegments.at(-1)?.endMs,
  128_900,
  'audio activity silence compaction still preserves the source ending after leading silence removal',
);
const longNoiseBridgeCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 15,
  maxDuration: 45,
  continuityLevel: 'standard',
  highlightEngine: 'keyword',
  customKeywords: ['activation', 'payoff'],
}, [
  { startMs: 0, endMs: 9_000, text: 'Watch the onboarding setup and activation pain.', speaker: 'Speaker 1' },
  { startMs: 9_100, endMs: 18_000, text: '[Music]', speaker: 'Speaker 1' },
  { startMs: 18_100, endMs: 30_000, text: 'So the complete payoff is the activation fix viewers can apply.', speaker: 'Speaker 1' },
]);
assertRule(
  !longNoiseBridgeCandidates.some((candidate) =>
    candidate.transcriptText?.includes('onboarding setup') &&
      candidate.transcriptText.includes('activation fix')
  ),
  'speech-to-text noise cleanup does not bridge long audible interruptions that would still remain inside a continuous rendered clip',
);

const englishConnectorChainCandidates = buildTranscriptSliceCandidates(
  {
    ...baseParams,
    minDuration: 15,
    maxDuration: 60,
    sourceDurationMs: 62_000,
    enableRepeatFilter: true,
  },
  [
    { startMs: 0, endMs: 12_000, text: 'Watch this case background.', speaker: 'Speaker 1' },
    { startMs: 12_000, endMs: 26_000, text: 'Then the real spike comes from concentrated user pain.', speaker: 'Speaker 1' },
    { startMs: 26_000, endMs: 41_000, text: 'So this is the complete short-video payoff.', speaker: 'Speaker 1' },
  ],
);
const englishConnectorChainCandidate = englishConnectorChainCandidates.find(
  (candidate) => candidate.transcriptSegmentCount === 3,
);
assertEqual(
  englishConnectorChainCandidate?.startMs,
  0,
  'English connector-chain speech-to-text planning repairs repeated Then/So starts back to the full context boundary',
);
assertEqual(
  englishConnectorChainCandidate?.speechEndMs,
  41_000,
  'English connector-chain speech-to-text planning keeps the repaired payoff segment in the final candidate',
);
assertEqual(
  englishConnectorChainCandidate?.contentArcGrade,
  'complete',
  'English connector-chain speech-to-text planning scores hook-context-payoff windows as complete arcs',
);
assertNumberBetween(
  englishConnectorChainCandidate?.topicCoherenceScore,
  0.65,
  1,
  'English connector-chain speech-to-text planning treats background, spike, user pain, and payoff as one topic',
);

const lightlyOverlappingTranscriptCandidates = buildTranscriptSliceCandidates(
  {
    ...baseParams,
    minDuration: 15,
    maxDuration: 45,
    sourceDurationMs: 50_000,
    continuityLevel: 'standard',
    enableRepeatFilter: true,
  },
  [
    { startMs: 0, endMs: 12_000, text: 'Watch the retention case background and pricing pain.', speaker: 'Speaker 1' },
    { startMs: 11_850, endMs: 26_000, text: 'Then the refund fix becomes the complete payoff.', speaker: 'Speaker 1' },
  ],
);
const lightlyOverlappingTranscriptCandidate = lightlyOverlappingTranscriptCandidates.find((candidate) =>
  candidate.startMs === 0 && candidate.transcriptSegmentCount === 2
);
assertEqual(
  lightlyOverlappingTranscriptCandidate?.speechStartMs,
  0,
  'speech-to-text planning repairs connector starts across tiny STT segment overlaps',
);
assertEqual(
  lightlyOverlappingTranscriptCandidate?.speechEndMs,
  26_000,
  'speech-to-text planning preserves the full spoken payoff when STT segments slightly overlap',
);
assertArrayIncludes(
  lightlyOverlappingTranscriptCandidate?.risks,
  'connector-repaired',
  'speech-to-text planning records connector repair across tiny STT segment overlaps',
);
assertArrayIncludes(
  lightlyOverlappingTranscriptCandidate?.risks,
  'transcript-overlap-repaired',
  'speech-to-text planning records tiny STT segment overlap repair for quality review',
);

const dynamicPlanningSegments = [
  { startMs: 0, endMs: 12_000, text: 'Watch the first case background and key pain.', speaker: 'Speaker 1' },
  { startMs: 12_000, endMs: 28_000, text: 'So the first payoff is a complete fix viewers can apply.', speaker: 'Speaker 1' },
  { startMs: 36_000, endMs: 48_000, text: 'Watch the second case background and retention pain.', speaker: 'Speaker 1' },
  { startMs: 48_000, endMs: 64_000, text: 'So the second payoff is another complete fix viewers can apply.', speaker: 'Speaker 1' },
  {
    startMs: 72_000,
    endMs: 90_000,
    text: 'This long recap repeats the same first case background and key pain, then repeats the second case background and retention pain without adding a new payoff.',
    speaker: 'Speaker 1',
  },
];
const dynamicPlanningPlan = createTranscriptAssistedSlicePlan(
  {
    ...baseParams,
    minDuration: 15,
    maxDuration: 120,
    sourceDurationMs: 100_000,
    enableRepeatFilter: true,
  },
  dynamicPlanningSegments,
);
assertEqual(
  dynamicPlanningPlan.length,
  2,
  'transcript-assisted dynamic planning selects only real non-overlapping high-value speech windows',
);
assertRule(
  dynamicPlanningPlan.some((clip) => (clip.speechStartMs ?? clip.startMs) === 0 && (clip.speechEndMs ?? 0) >= 28_000),
  'transcript-assisted dynamic planning keeps the first complete speech-to-text case window',
);
assertRule(
  dynamicPlanningPlan.some((clip) => (clip.speechStartMs ?? clip.startMs) === 36_000 && (clip.speechEndMs ?? 0) >= 64_000),
  'transcript-assisted dynamic planning keeps the second complete speech-to-text case window',
);
assertRule(
  !dynamicPlanningPlan.some((clip) => (clip.speechStartMs ?? clip.startMs) === 0 && (clip.speechEndMs ?? 0) >= 64_000),
  'transcript-assisted dynamic planning does not let one broad overlapping candidate crowd out multiple complete clips',
);

const coarseTranscriptIndependentStoriesText = [
  'Why onboarding activation fails is that the first screen hides the result and users feel confused.',
  'Because the signup case shows the pain clearly, so the fix is to show the outcome first and activation improves.',
  'Why refund operations fail is that the queue hides priority and support teams miss the real problem.',
  'Because the refund case shows escalation pain, so the solution is to route urgent requests first and retention improves.',
  'Why creator analytics fail is that the dashboard hides dropoff and teams cannot see the key moment.',
  'Because the analytics case shows audience pain, so the fix is to package the result first and publishing improves.',
].join(' ');
const coarseTranscriptIndependentStoriesCandidates = buildTranscriptSliceCandidates(
  {
    ...baseParams,
    minDuration: 10,
    maxDuration: 90,
    sourceDurationMs: 180_000,
    continuityLevel: 'standard',
    enableRepeatFilter: true,
  },
  [
    {
      startMs: 0,
      endMs: 180_000,
      text: coarseTranscriptIndependentStoriesText,
      speaker: 'Speaker 1',
    },
  ],
);
assertRule(
  coarseTranscriptIndependentStoriesCandidates.filter((candidate) =>
    (candidate.speechStartMs ?? candidate.startMs) >= 0 &&
      (candidate.speechEndMs ?? candidate.startMs + candidate.durationMs) <= 65_000
  ).length > 0,
  'coarse speech-to-text planning derives an onboarding candidate from a long provider segment',
);
assertRule(
  coarseTranscriptIndependentStoriesCandidates.filter((candidate) =>
    (candidate.speechStartMs ?? candidate.startMs) >= 55_000 &&
      (candidate.speechEndMs ?? candidate.startMs + candidate.durationMs) <= 125_000
  ).length > 0,
  'coarse speech-to-text planning derives a refund candidate from a long provider segment',
);
assertRule(
  coarseTranscriptIndependentStoriesCandidates.filter((candidate) =>
    (candidate.speechStartMs ?? candidate.startMs) >= 115_000
  ).length > 0,
  'coarse speech-to-text planning derives an analytics candidate from a long provider segment',
);
const coarseTranscriptIndependentStoriesPlan = createTranscriptAssistedSlicePlan(
  {
    ...baseParams,
    minDuration: 10,
    maxDuration: 90,
    sourceDurationMs: 180_000,
    continuityLevel: 'standard',
    enableRepeatFilter: true,
  },
  [
    {
      startMs: 0,
      endMs: 180_000,
      text: coarseTranscriptIndependentStoriesText,
      speaker: 'Speaker 1',
    },
  ],
);
assertEqual(
  coarseTranscriptIndependentStoriesPlan.length,
  3,
  'coarse speech-to-text planning splits one long provider segment into every independent content story',
);
assertRule(
  coarseTranscriptIndependentStoriesPlan.every((clip, index, clips) =>
    index === 0 || clip.startMs >= clips[index - 1].startMs + clips[index - 1].durationMs
  ),
  'coarse speech-to-text planning emits non-overlapping clips after splitting a long provider segment',
);

const lectureTopicSegments = [
  {
    startMs: 0,
    endMs: 8_000,
    text: 'Vector embeddings convert tokens into dense numeric representations for retrieval systems.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 8_200,
    endMs: 16_000,
    text: 'The embedding layer keeps related meanings close together so search can compare concepts.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 16_200,
    endMs: 18_000,
    text: 'um um',
    speaker: 'Speaker 1',
  },
  {
    startMs: 20_000,
    endMs: 28_000,
    text: 'Cosine similarity measures the angle between vectors when ranking related passages.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 28_200,
    endMs: 36_000,
    text: 'A higher cosine score usually means the passages discuss the same semantic concept.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 44_000,
    endMs: 52_000,
    text: 'Document chunking splits long source material into indexed retrieval units.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 52_200,
    endMs: 60_000,
    text: 'Each chunk keeps enough local context and metadata for the retrieval pipeline.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 60_200,
    endMs: 68_000,
    text: 'Small overlaps reduce boundary loss when an answer crosses two neighboring chunks.',
    speaker: 'Speaker 1',
  },
];
const lectureTopicPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 5,
  maxDuration: 30,
  sourceDurationMs: 80_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, lectureTopicSegments);
assertEqual(
  lectureTopicPlan.length,
  3,
  'lecture speech-to-text planning segments expository content into every coherent topic clip instead of requiring short-video hook/payoff arcs',
);
assertRule(
  lectureTopicPlan.every((clip) =>
    clip.risks?.includes('content-topic-segment') &&
      (clip.transcriptSegmentCount ?? 0) >= 2 &&
      clip.topicCoherenceGrade !== 'weak'
  ),
  'lecture topic clips keep multiple transcript segments with strong or mixed topic evidence',
);
assertRule(
  lectureTopicPlan.every((clip) => !/\bum+\b/iu.test(clip.transcriptText ?? '')),
  'lecture topic planning removes filler transcript fragments from rendered clip evidence',
);

const lectureNoiseBridgePlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 5,
  maxDuration: 24,
  sourceDurationMs: 30_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 7_000,
    text: 'The embedding model converts every sentence into a vector representation.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 7_100,
    endMs: 8_200,
    text: 'uh',
    speaker: 'Speaker 1',
  },
  {
    startMs: 8_300,
    endMs: 15_000,
    text: 'Those vectors let the search engine compare meaning instead of exact keywords.',
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  lectureNoiseBridgePlan.length,
  1,
  'lecture topic planning merges real speech across a short problematic filler segment',
);
assertEqual(
  lectureNoiseBridgePlan[0]?.transcriptSegmentCount,
  2,
  'lecture topic planning excludes filtered filler fragments from clip segment counts',
);
assertRule(
  lectureNoiseBridgePlan[0]?.risks?.includes('transcript-noise-bridge-repaired') &&
    lectureNoiseBridgePlan[0]?.risks?.includes('content-topic-segment'),
  'lecture topic planning records both content-topic segmentation and repaired filler bridge evidence',
);

const lectureSetupOnlyTopicPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 5,
  maxDuration: 30,
  sourceDurationMs: 40_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 8_000,
    text: 'Vector embeddings are dense numeric representations for retrieval systems.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 8_200,
    endMs: 16_000,
    text: 'The embedding model stores semantic relationships in a vector space.',
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  lectureSetupOnlyTopicPlan.length,
  1,
  'lecture topic planning keeps expository setup-only technical topics when they have explicit knowledge evidence',
);
assertArrayIncludes(
  lectureSetupOnlyTopicPlan[0]?.risks,
  'content-topic-segment',
  'lecture setup-only topic planning records content-topic evidence instead of falling back to sparse fragments',
);

const payoffOnlySparseCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 10,
  maxDuration: 40,
  sourceDurationMs: 40_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 12_000,
    text: 'The retention payoff is higher retention and clearer retention outcome.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 12_200,
    endMs: 24_000,
    text: 'The retention outcome is better retention, stronger retention, and a concrete payoff.',
    speaker: 'Speaker 1',
  },
]);
const payoffOnlySparsePlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 10,
  maxDuration: 40,
  sourceDurationMs: 40_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 12_000,
    text: 'The retention payoff is higher retention and clearer retention outcome.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 12_200,
    endMs: 24_000,
    text: 'The retention outcome is better retention, stronger retention, and a concrete payoff.',
    speaker: 'Speaker 1',
  },
]);
assertRule(
  payoffOnlySparseCandidates.some((candidate) => candidate.storyShape === 'payoffOnly'),
  'payoff-only sparse regression fixture exercises an isolated payoff fragment candidate',
);
assertEqual(
  payoffOnlySparsePlan.length,
  0,
  'transcript-assisted planning does not publish isolated payoff-only sparse fragments without setup context',
);

const longTranscriptSegments = Array.from({ length: 260 }, (_, index) => {
  const startMs = index * 8_000;
  const keyWindowTextByIndex = {
    12: 'Watch the onboarding funnel setup, signup pain, pricing conflict, and complete activation payoff.',
    130: 'Watch the refund workflow setup, support queue pain, escalation conflict, and complete retention payoff.',
    238: 'Watch the creator analytics setup, audience dropoff pain, packaging conflict, and complete publishing payoff.',
  };
  return {
    startMs,
    endMs: startMs + 6_000,
    text: keyWindowTextByIndex[index]
      ? keyWindowTextByIndex[index]
      : `Routine context segment ${index} with background notes and normal discussion.`,
    speaker: 'Speaker 1',
  };
});
const longTranscriptCandidates = buildTranscriptSliceCandidates(
  {
    ...baseParams,
    minDuration: 5,
    maxDuration: 15,
    sourceDurationMs: 2_100_000,
    enableRepeatFilter: true,
  },
  longTranscriptSegments,
);
assertRule(
  longTranscriptCandidates.length <= 10,
  'speech-to-text candidate generation returns a bounded review set after pruning large transcript workloads',
);
assertRule(
  longTranscriptCandidates.some((candidate) => (candidate.speechStartMs ?? candidate.startMs) < 160_000) &&
    longTranscriptCandidates.some((candidate) => (candidate.speechStartMs ?? candidate.startMs) > 900_000 && (candidate.speechStartMs ?? candidate.startMs) < 1_200_000) &&
    longTranscriptCandidates.some((candidate) => (candidate.speechStartMs ?? candidate.startMs) > 1_800_000),
  'speech-to-text candidate pruning preserves high-value windows across early, middle, and late transcript ranges',
);

const transcriptSegments = [
  {
    startMs: 0,
    endMs: 12000,
    text: 'Watch this case background.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 12000,
    endMs: 26000,
    text: 'Then the real spike comes from concentrated user pain.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 26000,
    endMs: 41000,
    text: 'So this is the complete short-video payoff.',
    speaker: 'Speaker 1',
  },
];
const transcriptPlan = createTranscriptAssistedSlicePlan(baseParams, transcriptSegments);
assertRule(
  transcriptPlan.length > 0 && transcriptPlan.length <= 3,
  'transcript-assisted planner returns quality transcript windows instead of fixed filler clips',
);
assertEqual(
  transcriptPlan[0]?.startMs,
  0,
  'transcript-assisted planner expands connector-led candidates backward',
);
assertEqual(
  transcriptPlan[0]?.durationMs,
  41250,
  'transcript-assisted planner extends open speech-to-text windows through the payoff segment and keeps a trailing speech buffer',
);
assertRule(
  transcriptPlan.every((clip, index, clips) =>
    index === 0 || clip.startMs >= clips[index - 1].startMs + clips[index - 1].durationMs,
  ),
  'transcript-assisted planner returns non-overlapping clips',
);
assertRule(
  typeof transcriptPlan[0]?.title === 'string' && transcriptPlan[0].title.length > 0,
  'transcript-assisted fallback clips expose reviewable titles without relying on the LLM',
);
assertRule(
  typeof transcriptPlan[0]?.summary === 'string' && transcriptPlan[0].summary.includes(' '),
  'transcript-assisted fallback clips summarize the repaired speech-to-text window',
);
assertRule(
  typeof transcriptPlan[0]?.reason === 'string' && transcriptPlan[0].reason.includes('speech-to-text'),
  'transcript-assisted fallback clips explain that slice boundaries follow speech-to-text continuity',
);
assertNumberBetween(
  transcriptPlan[0]?.qualityScore,
  0.55,
  1,
  'transcript-assisted fallback clips expose transcript-derived quality scores',
);
assertNumberBetween(
  transcriptPlan[0]?.continuityScore,
  0.8,
  1,
  'transcript-assisted fallback clips expose high continuity scores for joined speech windows',
);
assertArrayIncludes(
  transcriptPlan[0]?.risks,
  'connector-repaired',
  'transcript-assisted fallback clips surface repaired weak-connector starts as review risks',
);
assertEqual(
  transcriptPlan[0]?.sourceStartMs,
  transcriptPlan[0]?.startMs,
  'transcript-assisted fallback clips expose sourceStartMs aligned to the repaired transcript boundary',
);
assertEqual(
  transcriptPlan[0]?.sourceEndMs,
  transcriptPlan[0]?.startMs + transcriptPlan[0]?.durationMs,
  'transcript-assisted fallback clips expose sourceEndMs aligned to the padded render boundary',
);
assertEqual(
  transcriptPlan[0]?.speechStartMs,
  0,
  'transcript-assisted fallback clips preserve the repaired speech-to-text start boundary separately from render padding',
);
assertEqual(
  transcriptPlan[0]?.speechEndMs,
  41000,
  'transcript-assisted fallback clips preserve the repaired speech-to-text end boundary separately from render padding',
);
assertEqual(
  transcriptPlan[0]?.boundaryPaddingBeforeMs,
  0,
  'transcript-assisted fallback clips expose clamped leading speech boundary padding',
);
assertEqual(
  transcriptPlan[0]?.boundaryPaddingAfterMs,
  250,
  'transcript-assisted fallback clips expose trailing speech boundary padding for natural endings',
);
assertEqual(
  transcriptPlan[0]?.transcriptText,
  transcriptSegments.map((segment) => segment.text).join(' '),
  'transcript-assisted fallback clips expose the exact repaired speech-to-text text for review',
);
assertEqual(
  transcriptPlan[0]?.transcriptSegmentCount,
  3,
  'transcript-assisted fallback clips expose the number of transcript segments included in the slice',
);
assertEqual(
  transcriptPlan[0]?.transcriptCoverageScore,
  1,
  'transcript-assisted fallback clips expose full transcript coverage for contiguous speech windows',
);
assertEqual(
  transcriptPlan[0]?.speechContinuityGrade,
  'repaired',
  'transcript-assisted fallback clips grade connector-repaired speech windows as repaired continuity',
);
assertNumberBetween(
  transcriptPlan[0]?.publishabilityScore,
  0.7,
  1,
  'transcript-assisted fallback clips expose a composite publishability score for short-video review',
);
assertRule(
  ['excellent', 'good'].includes(transcriptPlan[0]?.publishabilityGrade),
  `transcript-assisted fallback clips grade repaired complete speech windows as publishable (got ${JSON.stringify(transcriptPlan[0]?.publishabilityGrade)})`,
);
assertRule(
  Array.isArray(transcriptPlan[0]?.publishabilityIssues),
  'transcript-assisted fallback clips expose normalized publishability issue tags',
);
assertNumberBetween(
  transcriptPlan[0]?.platformReadinessScore,
  0.68,
  1,
  'transcript-assisted fallback clips expose platform-specific readiness scores',
);
assertRule(
  ['ready', 'review'].includes(transcriptPlan[0]?.platformReadinessGrade),
  `transcript-assisted fallback clips grade platform-specific publish readiness (got ${JSON.stringify(transcriptPlan[0]?.platformReadinessGrade)})`,
);
assertRule(
  Array.isArray(transcriptPlan[0]?.platformReadinessIssues),
  'transcript-assisted fallback clips expose platform-specific readiness issue tags',
);
assertNumberBetween(
  transcriptPlan[0]?.boundaryQualityScore,
  0.65,
  1,
  'transcript-assisted fallback clips expose boundary quality scores for opening and ending review',
);
assertRule(
  ['strong', 'contextual'].includes(transcriptPlan[0]?.hookStrength),
  `transcript-assisted fallback clips grade hook strength for self-media openings (got ${JSON.stringify(transcriptPlan[0]?.hookStrength)})`,
);
assertRule(
  ['complete', 'soft'].includes(transcriptPlan[0]?.endingCompleteness),
  `transcript-assisted fallback clips grade ending completeness for coherent short videos (got ${JSON.stringify(transcriptPlan[0]?.endingCompleteness)})`,
);

const llmCandidatePlan = parseLlmSlicePlan(
  JSON.stringify([
    {
      candidateId: 'transcript-2',
      startMs: 12000,
      durationMs: 15000,
      summary: 'Explains the spike cause and the audience pain point.',
      reason: 'The selected window has a complete setup and payoff for a short video.',
      qualityScore: 0.92,
      continuityScore: 0.88,
      risks: ['needs-cover-title'],
      title: '爆发原因',
    },
  ]),
  baseParams,
  transcriptPlan,
  transcriptSegments,
);
assertEqual(
  llmCandidatePlan[0]?.startMs,
  0,
  'LLM candidate-id plans keep deterministic repaired candidate start time',
);
assertEqual(
  llmCandidatePlan[0]?.durationMs,
  41250,
  'LLM candidate-id plans keep deterministic padded speech-to-text render duration',
);
assertEqual(
  llmCandidatePlan[0]?.label,
  '爆发原因',
  'LLM candidate-id plans can still use the semantic title as clip label',
);

assertEqual(
  llmCandidatePlan[0]?.title,
  llmCandidatePlan[0]?.label,
  'LLM candidate-id plans preserve AI titles for explainable slice results',
);
assertEqual(
  llmCandidatePlan[0]?.summary,
  'Explains the spike cause and the audience pain point.',
  'LLM candidate-id plans preserve AI summaries for operator review',
);
assertEqual(
  llmCandidatePlan[0]?.reason,
  'The selected window has a complete setup and payoff for a short video.',
  'LLM candidate-id plans preserve AI selection reasons',
);
assertEqual(
  llmCandidatePlan[0]?.qualityScore,
  transcriptPlan[0]?.qualityScore,
  'LLM candidate-id plans preserve deterministic transcript quality scores instead of trusting model-invented scores',
);
assertEqual(
  llmCandidatePlan[0]?.continuityScore,
  transcriptPlan[0]?.continuityScore,
  'LLM candidate-id plans preserve deterministic transcript continuity scores instead of trusting model-invented scores',
);
assertEqual(
  llmCandidatePlan[0]?.risks?.[0],
  transcriptPlan[0]?.risks?.[0],
  'LLM candidate-id plans preserve deterministic transcript risk tags instead of trusting model-invented publishability risks',
);
assertRule(
  !llmCandidatePlan[0]?.risks?.includes('needs-cover-title'),
  'LLM candidate-id plans ignore model-invented risk tags so publishability scoring stays evidence-backed',
);
assertEqual(
  llmCandidatePlan[0]?.sourceStartMs,
  0,
  'LLM candidate-id plans expose deterministic source start metadata',
);
assertEqual(
  llmCandidatePlan[0]?.sourceEndMs,
  41250,
  'LLM candidate-id plans expose deterministic source end metadata',
);
assertEqual(
  llmCandidatePlan[0]?.speechStartMs,
  0,
  'LLM candidate-id plans expose deterministic speech start metadata',
);
assertEqual(
  llmCandidatePlan[0]?.speechEndMs,
  41000,
  'LLM candidate-id plans expose deterministic speech end metadata',
);
assertEqual(
  llmCandidatePlan[0]?.boundaryPaddingAfterMs,
  250,
  'LLM candidate-id plans preserve deterministic speech boundary padding metadata',
);
assertEqual(
  llmCandidatePlan[0]?.transcriptText,
  transcriptPlan[0]?.transcriptText,
  'LLM candidate-id plans preserve deterministic transcript text metadata',
);
assertEqual(
  llmCandidatePlan[0]?.transcriptSegmentCount,
  3,
  'LLM candidate-id plans preserve deterministic transcript segment counts',
);
assertEqual(
  llmCandidatePlan[0]?.transcriptCoverageScore,
  1,
  'LLM candidate-id plans preserve deterministic transcript coverage scores',
);
assertEqual(
  llmCandidatePlan[0]?.speechContinuityGrade,
  'repaired',
  'LLM candidate-id plans preserve deterministic speech continuity grades',
);
assertEqual(
  llmCandidatePlan[0]?.boundaryQualityScore,
  transcriptPlan[0]?.boundaryQualityScore,
  'LLM candidate-id plans preserve deterministic boundary quality scores',
);
assertEqual(
  llmCandidatePlan[0]?.hookStrength,
  transcriptPlan[0]?.hookStrength,
  'LLM candidate-id plans preserve deterministic hook strength grades',
);
assertEqual(
  llmCandidatePlan[0]?.endingCompleteness,
  transcriptPlan[0]?.endingCompleteness,
  'LLM candidate-id plans preserve deterministic ending completeness grades',
);
assertNumberBetween(
  llmCandidatePlan[0]?.publishabilityScore,
  0.7,
  1,
  'LLM candidate-id plans expose composite publishability scores',
);
assertRule(
  ['excellent', 'good'].includes(llmCandidatePlan[0]?.publishabilityGrade),
  `LLM candidate-id plans preserve publishable transcript candidates as ready for self-media review (got ${JSON.stringify(llmCandidatePlan[0]?.publishabilityGrade)})`,
);
assertEqual(
  llmCandidatePlan[0]?.platformReadinessGrade,
  transcriptPlan[0]?.platformReadinessGrade,
  'LLM candidate-id plans preserve deterministic platform-specific readiness grades',
);
assertRule(
  Array.isArray(llmCandidatePlan[0]?.platformReadinessIssues),
  'LLM candidate-id plans preserve deterministic platform-specific readiness issues',
);

const llmRejectCandidateFallbackPlan = parseLlmSlicePlan(
  JSON.stringify([
    {
      candidateId: 'reject-candidate',
      title: 'Inflated weak candidate',
      reason: 'The LLM tried to promote a weak fragment by inventing high scores.',
      qualityScore: 1,
      continuityScore: 1,
    },
  ]),
  {
    ...baseParams,
  },
  transcriptPlan,
  [
    {
      candidateId: 'reject-candidate',
      index: 0,
      anchorSegmentIndex: 0,
      startMs: 45_000,
      endMs: 56_000,
      durationMs: 11_000,
      label: 'Weak trailing fragment',
      text: 'Then maybe another unrelated point without a complete payoff',
      score: 0.12,
      qualityScore: 0.12,
      continuityScore: 0.14,
      storyShape: 'thin',
      publishabilityScore: 0.08,
      publishabilityGrade: 'reject',
      publishabilityIssues: ['missing-payoff', 'weak-hook', 'open-ending'],
      boundaryQualityScore: 0.12,
      hookStrength: 'weak',
      endingCompleteness: 'open',
      contentArcScore: 0.1,
      contentArcGrade: 'thin',
      contentArcStages: ['conflict'],
      contentArcMissingStages: ['hook', 'setup', 'payoff'],
      topicCoherenceScore: 0.2,
      topicCoherenceGrade: 'weak',
      topicShiftCount: 1,
      topicKeywords: ['unrelated'],
      platformReadinessScore: 0.08,
      platformReadinessGrade: 'reject',
      platformReadinessIssues: ['platform-weak-hook', 'platform-open-ending', 'platform-incomplete-arc', 'platform-topic-drift'],
      sentenceBoundaryIntegrityScore: 0.3,
      sentenceBoundaryIntegrityGrade: 'broken',
      sentenceBoundaryIssues: ['sentence-end-unrepaired'],
      risks: ['missing-payoff', 'weak-hook', 'open-ending', 'topic-drift'],
      sourceStartMs: 45_000,
      sourceEndMs: 56_000,
      speechStartMs: 45_000,
      speechEndMs: 56_000,
      boundaryPaddingBeforeMs: 0,
      boundaryPaddingAfterMs: 0,
      transcriptText: 'Then maybe another unrelated point without a complete payoff',
      transcriptCoverageScore: 1,
      transcriptSegmentCount: 1,
      speechContinuityGrade: 'weak',
    },
  ],
);
assertEqual(
  llmRejectCandidateFallbackPlan.length,
  transcriptPlan.length,
  'LLM candidate-id plans fall back when every selected transcript candidate fails publishability gates after normalization',
);
assertEqual(
  llmRejectCandidateFallbackPlan[0]?.startMs,
  transcriptPlan[0]?.startMs,
  'LLM candidate-id fallback preserves the deterministic transcript plan instead of returning an empty slice plan',
);
assertRule(
  llmRejectCandidateFallbackPlan.every((clip) => clip.candidateId !== 'reject-candidate'),
  'LLM candidate-id fallback does not render a model-promoted reject-grade transcript candidate',
);

const llmRawTranscriptPlan = parseLlmSlicePlan(
  JSON.stringify([
    {
      startMs: 13000,
      durationMs: 10000,
      title: 'Raw LLM midpoint',
      reason: 'LLM chose a midpoint that needs speech-to-text repair.',
    },
  ]),
  baseParams,
  transcriptPlan,
  transcriptSegments,
);
assertEqual(
  llmRawTranscriptPlan[0]?.startMs,
  0,
  'LLM raw-timing plans snap overlapping selections back to repaired speech-to-text start boundaries',
);
assertEqual(
  llmRawTranscriptPlan[0]?.durationMs,
  41250,
  'LLM raw-timing plans snap overlapping selections forward to complete padded speech-to-text durations',
);
assertArrayIncludes(
  llmRawTranscriptPlan[0]?.risks,
  'llm-timing-snapped-to-transcript',
  'LLM raw-timing plans record when a model midpoint is repaired to speech-to-text boundaries',
);

const llmWeakOverlapTranscriptPlan = parseLlmSlicePlan(
  JSON.stringify([
    {
      startMs: 40500,
      durationMs: 10000,
      title: 'Weak edge overlap',
      reason: 'LLM selected a window that only grazes the transcript candidate edge.',
    },
  ]),
  baseParams,
  transcriptPlan,
  transcriptSegments,
);
assertEqual(
  llmWeakOverlapTranscriptPlan[0]?.startMs,
  transcriptPlan[0]?.startMs,
  'LLM weak-overlap raw timing falls back to deterministic transcript plan instead of snapping to an unrelated candidate edge',
);
assertEqual(
  llmWeakOverlapTranscriptPlan[0]?.durationMs,
  transcriptPlan[0]?.durationMs,
  'LLM weak-overlap raw timing keeps the fallback transcript duration when transcript overlap confidence is too low',
);
assertRule(
  !llmWeakOverlapTranscriptPlan[0]?.risks?.includes('llm-timing-snapped-to-transcript'),
  'LLM weak-overlap raw timing is not marked as a confident transcript snap',
);

const fixedModeLlmTranscriptCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 10,
  maxDuration: 45,
  sourceDurationMs: 90_000,
}, [
  {
    startMs: 30_000,
    endMs: 42_000,
    text: 'Why silent padding damages short clips is because the editing case shows viewers leave before the useful hook appears.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 42_200,
    endMs: 54_000,
    text: 'The problem is silent padding, so the fix is to cut on the real speech boundary and the result keeps the complete payoff.',
    speaker: 'Speaker 1',
  },
]);
const fixedModeLlmTranscriptPlan = parseLlmSlicePlan(
  JSON.stringify([
    {
      candidateId: fixedModeLlmTranscriptCandidates[0]?.candidateId,
      title: 'Transcript backed story',
      reason: 'The model selected the real transcript-backed story candidate.',
    },
  ]),
  {
    ...baseParams,
    minDuration: 10,
    maxDuration: 45,
    sourceDurationMs: 90_000,
  },
  createDeterministicSlicePlan({
    ...baseParams,
    minDuration: 10,
    maxDuration: 45,
    sourceDurationMs: 90_000,
  }),
  fixedModeLlmTranscriptCandidates,
);
assertEqual(
  fixedModeLlmTranscriptPlan.length,
  1,
  'fixed-mode LLM transcript plans do not pad selected real content with fabricated count-filler clips',
);
assertRule(
  fixedModeLlmTranscriptPlan.every((clip) =>
    typeof clip.candidateId === 'string' &&
    (clip.transcriptSegmentCount ?? 0) > 0 &&
    !clip.risks?.includes('no-transcript-boundary')
  ),
  'fixed-mode LLM transcript plans keep every output clip backed by structured transcript evidence',
);

const invalidJsonTranscriptLlmPlan = parseLlmSlicePlan(
  'not json',
  {
    ...baseParams,
    minDuration: 10,
    maxDuration: 45,
    sourceDurationMs: 90_000,
  },
  createDeterministicSlicePlan({
    ...baseParams,
    minDuration: 10,
    maxDuration: 45,
    sourceDurationMs: 90_000,
  }),
  fixedModeLlmTranscriptCandidates,
);
assertEqual(
  invalidJsonTranscriptLlmPlan.length,
  0,
  'invalid LLM responses cannot fall back to deterministic no-transcript clips when transcript candidates exist',
);

const invalidJsonWeakEvidenceFallbackPlan = parseLlmSlicePlan(
  'not json',
  {
    ...baseParams,
    minDuration: 10,
    maxDuration: 45,
    sourceDurationMs: 90_000,
  },
  [
    {
      ...fixedModeLlmTranscriptCandidates[0],
      transcriptCoverageScore: 0.2,
      speechContinuityGrade: 'weak',
      publishabilityGrade: 'reject',
      platformReadinessGrade: 'reject',
    },
  ],
  fixedModeLlmTranscriptCandidates,
);
assertEqual(
  invalidJsonWeakEvidenceFallbackPlan.length,
  0,
  'invalid LLM responses cannot fall back to weak transcript evidence that would fail native render readiness',
);

const deterministicPlan = createDeterministicSlicePlan({
  ...baseParams,
  minDuration: 15,
  maxDuration: 60,
  sourceDurationMs: 90_000,
});
assertEqual(
  deterministicPlan.length > 0,
  true,
  'deterministic fallback produces source-duration bounded clips when transcript content evidence is unavailable',
);
assertRule(
  deterministicPlan.every((clip, index, clips) =>
    clip.startMs >= 0 &&
      clip.durationMs > 0 &&
      clip.startMs + clip.durationMs <= 90_000 &&
      (index === 0 || clip.startMs >= clips[index - 1].startMs + clips[index - 1].durationMs) &&
      clip.risks?.includes('deterministic-no-transcript-fallback')
  ),
  'deterministic fallback clips stay ordered, bounded, and marked as no-transcript fallback clips',
);

const autoDeterministicPlan = createDeterministicSlicePlan({
  ...baseParams,
  minDuration: 15,
  maxDuration: 60,
});
assertEqual(
  autoDeterministicPlan.length,
  0,
  'auto deterministic fallback refuses to fabricate default clip counts without transcript content evidence',
);
assertEqual(
  createTranscriptAssistedSlicePlan({
    ...baseParams,
    minDuration: 15,
    maxDuration: 60,
  }, []).length,
  0,
  'auto transcript-assisted planning returns no clips when no real transcript content is available',
);

const autoLlmFallbackPlan = createDeterministicSlicePlan({
  ...baseParams,
  minDuration: 15,
  maxDuration: 60,
});
assertEqual(
  parseLlmSlicePlan(
    'not json',
    {
      ...baseParams,
    },
    autoLlmFallbackPlan,
  ).length,
  0,
  'auto LLM fallback refuses deterministic clips when no transcript content evidence is available',
);

const legacyFixedDeterministicPlan = createDeterministicSlicePlan({
  ...baseParams,
  idealDuration: 45,
});
assertEqual(
  legacyFixedDeterministicPlan.length,
  0,
  'deterministic Smart Slice fallback refuses legacy fixed target counts without transcript content evidence',
);

const sourceBoundedDeterministicPlan = createDeterministicSlicePlan({
  ...baseParams,
  sourceDurationMs: 35000,
});
assertEqual(
  sourceBoundedDeterministicPlan.length > 0,
  true,
  'source-duration-aware Smart Slice fallback creates at least one bounded clip without transcript content evidence',
);
assertRule(
  sourceBoundedDeterministicPlan.every((clip) => clip.startMs + clip.durationMs <= 35000),
  'source-duration-aware Smart Slice fallback never plans clips beyond the source media duration',
);

const qualityFirstPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
}, transcriptSegments);
assertRule(
  qualityFirstPlan.length > 0 && qualityFirstPlan.length < 5,
  'legacy quality-first transcript planning ignores requested target count and does not pad weak filler clips',
);

const coverageFirstPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
}, transcriptSegments);
assertEqual(
  coverageFirstPlan.length,
  qualityFirstPlan.length,
  'legacy coverage-first transcript planning resolves to the same content-derived clips instead of padding silent fixed windows',
);
assertRule(
  coverageFirstPlan.every((clip) => clip.publishabilityGrade !== 'reject' && clip.platformReadinessGrade !== 'reject'),
  'transcript-assisted planning filters unpublishable reject-grade speech windows before rendering',
);

const autoContentContinuityTopics = [
  ['retention analytics', 'opening hook', 'watch time payoff'],
  ['pricing invoices', 'refund dispute', 'annual plan conversion'],
  ['launch migration', 'feature flag rollout', 'rollback decision'],
  ['creator lighting', 'studio setup', 'camera confidence'],
  ['customer onboarding', 'activation checklist', 'first value moment'],
  ['team hiring', 'interview rubric', 'manager calibration'],
];
const autoContentContinuitySegments = autoContentContinuityTopics.flatMap(([topic, example, payoff], index) => {
  const startMs = index * 30_000;
  return [
    {
      startMs,
      endMs: startMs + 8_000,
      text: `The ${topic} section starts with the real problem and gives viewers a specific reason to keep watching.`,
      speaker: 'Speaker 1',
    },
    {
      startMs: startMs + 8_300,
      endMs: startMs + 17_000,
      text: `Then the ${example} example resolves into ${payoff}, so this topic forms a complete standalone clip.`,
      speaker: 'Speaker 1',
    },
  ];
});
const autoContinuityPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  sourceDurationMs: 190_000,
}, autoContentContinuitySegments);
assertEqual(
  autoContinuityPlan.length,
  6,
  'auto transcript planning derives clip count from real continuous content groups instead of truncating to the default target count',
);
assertRule(
  autoContinuityPlan.every((clip) => (clip.transcriptSegmentCount ?? 0) >= 2 && clip.speechContinuityGrade !== 'weak'),
  'auto transcript planning keeps only continuous transcript-backed groups when deriving clip count',
);

const legacyCountIgnoredContinuityPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  sourceDurationMs: 190_000,
}, autoContentContinuitySegments);
assertEqual(
  legacyCountIgnoredContinuityPlan.length,
  autoContinuityPlan.length,
  'transcript planning ignores legacy fixed target count and derives clip count from real continuous content groups',
);
assertRule(
  legacyCountIgnoredContinuityPlan.every((clip) => (clip.transcriptSegmentCount ?? 0) >= 2 && clip.speechContinuityGrade !== 'weak'),
  'legacy fixed-mode transcript planning still keeps only continuous transcript-backed groups',
);

const standardContinuityCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  continuityLevel: 'standard',
}, [
  { startMs: 0, endMs: 10000, text: 'Opening setup with important context.', speaker: 'Speaker 1' },
  { startMs: 11200, endMs: 24000, text: 'then payoff should attach across standard gap.', speaker: 'Speaker 1' },
]);
const standardConnectorCandidate = standardContinuityCandidates.find((candidate) =>
  candidate.startMs === 0 && candidate.risks?.includes('connector-repaired')
);
assertEqual(
  standardConnectorCandidate?.startMs,
  0,
  'standard continuity repairs connector starts across short transcript gaps',
);
assertArrayIncludes(
  standardConnectorCandidate?.risks,
  'connector-repaired',
  'standard continuity candidates flag repaired connector-led starts',
);
assertNumberBetween(
  standardConnectorCandidate?.continuityScore,
  0.8,
  1,
  'standard continuity candidates score repaired speech-to-text windows as continuous',
);

const trailingConnectorCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 10,
  maxDuration: 40,
  continuityLevel: 'standard',
}, [
  { startMs: 0, endMs: 12000, text: 'The setup reaches the minimum duration and', speaker: 'Speaker 1' },
  { startMs: 12400, endMs: 25000, text: 'the payoff completes the sentence for the short video.', speaker: 'Speaker 1' },
]);
assertEqual(
  trailingConnectorCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.durationMs,
  25250,
  'speech-to-text planning extends clips that would otherwise end on a trailing connector and adds ending breathing room',
);
assertArrayIncludes(
  trailingConnectorCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.risks,
  'trailing-connector-extended',
  'speech-to-text planning records when it extends an incomplete trailing connector',
);
assertNumberBetween(
  trailingConnectorCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.sentenceBoundaryIntegrityScore,
  0.72,
  1,
  'speech-to-text planning exposes sentence boundary integrity scores after repairing trailing connectors',
);
assertEqual(
  trailingConnectorCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.sentenceBoundaryIntegrityGrade,
  'repaired',
  'speech-to-text planning grades repaired trailing connector windows separately from fully clean sentence boundaries',
);
assertArrayIncludes(
  trailingConnectorCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.sentenceBoundaryIssues,
  'sentence-trailing-connector-repaired',
  'speech-to-text planning records sentence boundary issue tags for repaired trailing connectors',
);

const trailingOpenSentenceCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 10,
  maxDuration: 40,
  continuityLevel: 'standard',
}, [
  { startMs: 0, endMs: 12000, text: 'The speaker introduces the case without closing punctuation', speaker: 'Speaker 1' },
  { startMs: 12300, endMs: 23000, text: 'so the next subtitle completes the thought.', speaker: 'Speaker 1' },
]);
assertEqual(
  trailingOpenSentenceCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.durationMs,
  23250,
  'speech-to-text planning extends clips that end on an open subtitle sentence without terminal punctuation and adds ending breathing room',
);
assertArrayIncludes(
  trailingOpenSentenceCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.risks,
  'open-sentence-extended',
  'speech-to-text planning records when it extends an open subtitle sentence',
);
assertEqual(
  trailingOpenSentenceCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.sentenceBoundaryIntegrityGrade,
  'repaired',
  'speech-to-text planning grades open subtitle sentence extensions as repaired sentence boundaries',
);

const chineseConnectorCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 15,
  maxDuration: 45,
  continuityLevel: 'standard',
}, [
  { startMs: 0, endMs: 12000, text: '\u5f00\u5934\u5148\u8bb2\u5b8c\u8fd9\u4e2a\u6848\u4f8b\u7684\u80cc\u666f\u548c\u95ee\u9898\u3002', speaker: 'Speaker 1' },
  { startMs: 12400, endMs: 30000, text: '\u7136\u540e\u624d\u7ed9\u51fa\u89e3\u51b3\u529e\u6cd5\uff0c\u8fd9\u6837\u526a\u51fa\u6765\u7684\u7247\u6bb5\u624d\u8fde\u8d2f\u3002', speaker: 'Speaker 1' },
]);
const chineseConnectorCandidate = chineseConnectorCandidates.find((candidate) =>
  candidate.startMs === 0 && candidate.risks?.includes('connector-repaired')
);
assertEqual(
  chineseConnectorCandidate?.startMs,
  0,
  'Chinese speech-to-text planning repairs clips that start with connector words by including prior context',
);
assertArrayIncludes(
  chineseConnectorCandidate?.risks,
  'connector-repaired',
  'Chinese connector-led clips surface the repaired transcript boundary as a review risk',
);
assertArrayIncludes(
  chineseConnectorCandidate?.sentenceBoundaryIssues,
  'sentence-leading-connector-repaired',
  'Chinese connector-led clips expose sentence boundary issue tags for repaired openings',
);

const chineseTrailingConnectorCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 10,
  maxDuration: 40,
  continuityLevel: 'standard',
}, [
  { startMs: 0, endMs: 12000, text: '\u8fd9\u4e2a\u7247\u6bb5\u4e0d\u80fd\u5728\u8fd9\u91cc\u76f4\u63a5\u7ed3\u675f\uff0c\u56e0\u4e3a', speaker: 'Speaker 1' },
  { startMs: 12300, endMs: 24500, text: '\u540e\u9762\u8fd9\u53e5\u624d\u662f\u89e3\u91ca\u539f\u56e0\u548c\u5b8c\u6574\u7ed3\u8bba\u3002', speaker: 'Speaker 1' },
]);
assertEqual(
  chineseTrailingConnectorCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.durationMs,
  24750,
  'Chinese speech-to-text planning extends clips that would end on trailing connector words and adds ending breathing room',
);
assertArrayIncludes(
  chineseTrailingConnectorCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.risks,
  'trailing-connector-extended',
  'Chinese trailing connector extensions are surfaced as continuity repair risks',
);
assertEqual(
  chineseTrailingConnectorCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.sentenceBoundaryIntegrityGrade,
  'repaired',
  'Chinese trailing connector extensions are graded as repaired sentence boundaries',
);

const chineseOpenSentenceCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 10,
  maxDuration: 40,
  continuityLevel: 'standard',
}, [
  { startMs: 0, endMs: 12000, text: '\u8fd9\u6bb5\u8bdd\u5df2\u7ecf\u8fbe\u5230\u6700\u77ed\u65f6\u957f\u4f46\u8fd8\u6ca1\u6709\u628a\u7ed3\u8bba\u8bf4\u5b8c', speaker: 'Speaker 1' },
  { startMs: 12200, endMs: 23800, text: '\u6240\u4ee5\u9700\u8981\u628a\u8fd9\u4e00\u53e5\u4e5f\u7eb3\u5165\u540c\u4e00\u4e2a\u77ed\u89c6\u9891\u3002', speaker: 'Speaker 1' },
]);
assertEqual(
  chineseOpenSentenceCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.durationMs,
  24050,
  'Chinese speech-to-text planning extends subtitle windows that lack terminal punctuation and adds ending breathing room',
);
assertArrayIncludes(
  chineseOpenSentenceCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.risks,
  'open-sentence-extended',
  'Chinese open sentence extensions are surfaced as continuity repair risks',
);
assertNumberBetween(
  chineseOpenSentenceCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.sentenceBoundaryIntegrityScore,
  0.72,
  1,
  'Chinese open sentence extensions expose a usable repaired sentence boundary score',
);

const unrepairedConnectorRankingPlan = normalizeCandidateSlicePlan([
  {
    index: 0,
    startMs: 0,
    durationMs: 22000,
    label: 'Clean sentence boundary',
    qualityScore: 0.83,
    continuityScore: 0.86,
    storyShape: 'complete',
    publishabilityScore: 0.83,
    hookStrength: 'strong',
    endingCompleteness: 'complete',
    contentArcScore: 1,
    contentArcGrade: 'complete',
    topicCoherenceScore: 0.86,
    topicCoherenceGrade: 'strong',
    sentenceBoundaryIntegrityScore: 0.94,
    sentenceBoundaryIntegrityGrade: 'clean',
    sentenceBoundaryIssues: [],
  },
  {
    index: 1,
    startMs: 30000,
    durationMs: 22000,
    label: 'Higher score but broken sentence boundary',
    qualityScore: 0.94,
    continuityScore: 0.93,
    storyShape: 'complete',
    publishabilityScore: 0.9,
    hookStrength: 'strong',
    endingCompleteness: 'complete',
    contentArcScore: 1,
    contentArcGrade: 'complete',
    topicCoherenceScore: 0.9,
    topicCoherenceGrade: 'strong',
    sentenceBoundaryIntegrityScore: 0.28,
    sentenceBoundaryIntegrityGrade: 'broken',
    sentenceBoundaryIssues: ['sentence-leading-connector-unrepaired'],
  },
], {
  ...baseParams,
});
assertEqual(
  unrepairedConnectorRankingPlan[0]?.label,
  'Clean sentence boundary',
  'quality-first candidate normalization ranks clean sentence boundaries above higher-score broken sentence fragments',
);
assertEqual(
  unrepairedConnectorRankingPlan[0]?.sentenceBoundaryIntegrityGrade,
  'clean',
  'quality-first candidate normalization preserves sentence boundary integrity grades on selected clips',
);

const paddedBreathingRoomCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 10,
  maxDuration: 40,
  continuityLevel: 'standard',
  sourceDurationMs: 45000,
}, [
  { startMs: 1000, endMs: 9000, text: 'Watch the opening result before the setup starts.', speaker: 'Speaker 1' },
  { startMs: 9300, endMs: 22000, text: 'Because the first sentence names the pain clearly.', speaker: 'Speaker 1' },
]);
assertEqual(
  paddedBreathingRoomCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.startMs,
  800,
  'speech-to-text candidates add leading render padding before the first spoken word',
);
assertEqual(
  paddedBreathingRoomCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.speechStartMs,
  1000,
  'speech-to-text candidates preserve the unpadded speech start for subtitle and review alignment',
);
assertEqual(
  paddedBreathingRoomCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.speechEndMs,
  22000,
  'speech-to-text candidates preserve the unpadded speech end for subtitle and review alignment',
);
assertEqual(
  paddedBreathingRoomCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.boundaryPaddingBeforeMs,
  200,
  'speech-to-text candidates expose the leading boundary padding applied to the render clip',
);
assertEqual(
  paddedBreathingRoomCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.boundaryPaddingAfterMs,
  250,
  'speech-to-text candidates expose the trailing boundary padding applied to the render clip',
);
assertEqual(
  paddedBreathingRoomCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.sourceStartMs,
  800,
  'speech-to-text candidates expose padded sourceStartMs for the actual rendered clip',
);
assertEqual(
  paddedBreathingRoomCandidates.find((candidate) => candidate.candidateId === 'transcript-1')?.sourceEndMs,
  22250,
  'speech-to-text candidates expose padded sourceEndMs for the actual rendered clip',
);

const tightGapPaddingCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 10,
  maxDuration: 18,
  continuityLevel: 'strict',
  sourceDurationMs: 36000,
}, [
  { startMs: 0, endMs: 12000, text: 'First clear hook explains the retention problem.', speaker: 'Speaker 1' },
  { startMs: 12100, endMs: 25000, text: 'Second clear hook explains the pricing problem.', speaker: 'Speaker 1' },
]);
const tightGapPaddingPlan = [
  tightGapPaddingCandidates.find((candidate) => candidate.candidateId === 'transcript-1'),
  tightGapPaddingCandidates.find((candidate) => candidate.candidateId === 'transcript-2'),
].filter(Boolean);
assertRule(
  tightGapPaddingPlan.every((clip, index, clips) =>
    index === 0 || clip.startMs >= clips[index - 1].startMs + clips[index - 1].durationMs,
  ),
  'speech boundary padding is clamped so adjacent rendered clips never overlap',
);
assertEqual(
  tightGapPaddingPlan[0]?.boundaryPaddingAfterMs,
  50,
  'speech boundary padding splits tight inter-speech gaps instead of overlapping the next clip',
);
assertEqual(
  tightGapPaddingPlan[1]?.boundaryPaddingBeforeMs,
  50,
  'speech boundary padding splits tight previous gaps before the next clip',
);

const externallyPaddedSpeechPlan = normalizeCandidateSlicePlan([
  {
    index: 0,
    startMs: 0,
    durationMs: 25_000,
    label: 'LLM padded intro',
    qualityScore: 0.91,
    continuityScore: 0.92,
    storyShape: 'complete',
    transcriptText: 'Watch the result first, then the speaker explains the reason and takeaway.',
    transcriptCoverageScore: 0.95,
    transcriptSegmentCount: 3,
    speechContinuityGrade: 'strong',
    speechStartMs: 4_000,
    speechEndMs: 20_000,
    sourceStartMs: 0,
    sourceEndMs: 25_000,
  },
], {
  ...baseParams,
  minDuration: 5,
  maxDuration: 60,
  sourceDurationMs: 60_000,
});
assertEqual(
  externallyPaddedSpeechPlan[0]?.startMs,
  3_800,
  'candidate normalization trims excessive silent intros around known speech starts',
);
assertEqual(
  externallyPaddedSpeechPlan[0]?.durationMs,
  16_450,
  'candidate normalization trims excessive silent outros around known speech ends',
);
assertEqual(
  externallyPaddedSpeechPlan[0]?.boundaryPaddingBeforeMs,
  200,
  'candidate normalization keeps only professional leading speech breathing room after silence trimming',
);
assertEqual(
  externallyPaddedSpeechPlan[0]?.boundaryPaddingAfterMs,
  250,
  'candidate normalization keeps only professional trailing speech breathing room after silence trimming',
);
assertArrayIncludes(
  externallyPaddedSpeechPlan[0]?.risks,
  'excess-leading-silence-trimmed',
  'candidate normalization records excessive leading silence trimming for review',
);
assertArrayIncludes(
  externallyPaddedSpeechPlan[0]?.risks,
  'excess-trailing-silence-trimmed',
  'candidate normalization records excessive trailing silence trimming for review',
);

const audioBoundaryRefinedPlan = refineSmartSlicePlanWithAudioActivityBoundaries([
  {
    index: 0,
    startMs: 0,
    durationMs: 30_000,
    label: 'Audio cleanup candidate',
    qualityScore: 0.91,
    continuityScore: 0.92,
    storyShape: 'complete',
    transcriptText: 'The useful speech starts after the noisy lead and ends before the tail.',
    transcriptCoverageScore: 0.95,
    transcriptSegmentCount: 2,
    speechContinuityGrade: 'strong',
    speechStartMs: 5_000,
    speechEndMs: 24_000,
    sourceStartMs: 0,
    sourceEndMs: 30_000,
    boundaryPaddingBeforeMs: 5_000,
    boundaryPaddingAfterMs: 6_000,
  },
], [
  {
    index: 0,
    startMs: 0,
    durationMs: 30_000,
    sourceStartMs: 0,
    sourceEndMs: 30_000,
    audioActivityStartMs: 5_120,
    audioActivityEndMs: 23_880,
    leadingSilenceMs: 5_120,
    trailingSilenceMs: 6_120,
    confidence: 0.94,
    analysisFilter: 'highpass=f=80,lowpass=f=12000,afftdn=nr=10:nf=-25,silencedetect=noise=-35dB:d=0.08',
  },
]);
assertEqual(
  audioBoundaryRefinedPlan[0]?.startMs,
  4_920,
  'audio cleanup refinement tightens rendered starts to high-confidence denoised audio activity before native rendering',
);
assertEqual(
  audioBoundaryRefinedPlan[0]?.durationMs,
  19_210,
  'audio cleanup refinement tightens rendered tails to high-confidence denoised audio activity before native rendering',
);
assertEqual(
  audioBoundaryRefinedPlan[0]?.speechStartMs,
  5_120,
  'audio cleanup refinement corrects the effective speech start when denoised audio activity starts after the STT timestamp',
);
assertEqual(
  audioBoundaryRefinedPlan[0]?.speechEndMs,
  23_880,
  'audio cleanup refinement corrects the effective speech end when denoised audio activity ends before the STT timestamp',
);
assertEqual(
  audioBoundaryRefinedPlan[0]?.boundaryPaddingBeforeMs,
  200,
  'audio cleanup refinement preserves the professional leading speech breathing room',
);
assertEqual(
  audioBoundaryRefinedPlan[0]?.boundaryPaddingAfterMs,
  250,
  'audio cleanup refinement preserves the professional trailing speech breathing room',
);
assertEqual(
  audioBoundaryRefinedPlan[0]?.leadingSilenceMs,
  200,
  'audio cleanup refinement records only the remaining leading audio padding inside the final render window',
);
assertEqual(
  audioBoundaryRefinedPlan[0]?.trailingSilenceMs,
  250,
  'audio cleanup refinement records only the remaining trailing audio padding inside the final render window',
);
assertEqual(
  audioBoundaryRefinedPlan[0]?.leadingSilenceTrimMs,
  4_920,
  'audio cleanup refinement records how much noisy leading silence was removed',
);
assertEqual(
  audioBoundaryRefinedPlan[0]?.trailingSilenceTrimMs,
  5_870,
  'audio cleanup refinement records how much noisy trailing silence was removed',
);
assertEqual(
  audioBoundaryRefinedPlan[0]?.tailTreatment,
  'fade-out',
  'audio cleanup refinement marks trimmed clip tails for a short native audio fade-out',
);
assertEqual(
  audioBoundaryRefinedPlan[0]?.audioCleanupProfile,
  'smart-slice-speech-denoise-v1',
  'audio cleanup refinement records the canonical Smart Slice cleanup profile',
);
assertEqual(
  audioBoundaryRefinedPlan[0]?.boundaryDecisionSource,
  'combined',
  'audio cleanup refinement records that transcript and denoised audio activity jointly produced the boundary',
);
const audioBoundaryRefinedPlanWithStaleNativeSilenceEvidence = refineSmartSlicePlanWithAudioActivityBoundaries([
  {
    index: 0,
    startMs: 0,
    durationMs: 30_000,
    label: 'Audio cleanup stale evidence candidate',
    qualityScore: 0.91,
    continuityScore: 0.92,
    storyShape: 'complete',
    transcriptText: 'The useful speech starts after the noisy lead and ends before the tail.',
    transcriptCoverageScore: 0.95,
    transcriptSegmentCount: 2,
    speechContinuityGrade: 'strong',
    speechStartMs: 5_000,
    speechEndMs: 24_000,
    sourceStartMs: 0,
    sourceEndMs: 30_000,
    boundaryPaddingBeforeMs: 5_000,
    boundaryPaddingAfterMs: 6_000,
  },
], [
  {
    index: 0,
    startMs: 0,
    durationMs: 30_000,
    sourceStartMs: 0,
    sourceEndMs: 30_000,
    audioActivityStartMs: 5_120,
    audioActivityEndMs: 23_880,
    leadingSilenceMs: 1,
    trailingSilenceMs: 2,
    confidence: 0.94,
    analysisFilter: 'highpass=f=80,lowpass=f=12000,afftdn=nr=10:nf=-25,silencedetect=noise=-35dB:d=0.08',
  },
]);
assertEqual(
  audioBoundaryRefinedPlanWithStaleNativeSilenceEvidence[0]?.leadingSilenceMs,
  200,
  'audio cleanup refinement derives leading silence evidence from the final render window instead of stale native metadata',
);
assertEqual(
  audioBoundaryRefinedPlanWithStaleNativeSilenceEvidence[0]?.trailingSilenceMs,
  250,
  'audio cleanup refinement derives trailing silence evidence from the final render window instead of stale native metadata',
);
assertArrayIncludes(
  audioBoundaryRefinedPlan[0]?.risks,
  'audio-boundary-refined',
  'audio cleanup refinement marks refined timing for review evidence',
);

const audioBoundaryTranscriptProtectedPlan = refineSmartSlicePlanWithAudioActivityBoundaries([
  {
    index: 0,
    startMs: 0,
    durationMs: 30_000,
    label: 'Transcript protected cleanup candidate',
    qualityScore: 0.91,
    continuityScore: 0.92,
    storyShape: 'complete',
    transcriptText: 'The transcript boundary protects speech when audio activity spills beyond recognized text.',
    transcriptCoverageScore: 0.95,
    transcriptSegmentCount: 2,
    speechContinuityGrade: 'strong',
    speechStartMs: 5_000,
    speechEndMs: 24_000,
    sourceStartMs: 0,
    sourceEndMs: 30_000,
    boundaryPaddingBeforeMs: 5_000,
    boundaryPaddingAfterMs: 6_000,
  },
], [
  {
    index: 0,
    startMs: 0,
    durationMs: 30_000,
    sourceStartMs: 0,
    sourceEndMs: 30_000,
    audioActivityStartMs: 4_500,
    audioActivityEndMs: 24_800,
    leadingSilenceMs: 4_500,
    trailingSilenceMs: 5_200,
    confidence: 0.93,
    analysisFilter: 'highpass=f=80,lowpass=f=12000,afftdn=nr=10:nf=-25,silencedetect=noise=-35dB:d=0.08',
  },
]);
assertEqual(
  audioBoundaryTranscriptProtectedPlan[0]?.startMs,
  4_800,
  'audio cleanup refinement keeps transcript-protected leading padding when audio activity starts before the STT boundary',
);
assertEqual(
  audioBoundaryTranscriptProtectedPlan[0]?.durationMs,
  19_450,
  'audio cleanup refinement keeps transcript-protected trailing padding when audio activity extends after the STT boundary',
);
assertEqual(
  audioBoundaryTranscriptProtectedPlan[0]?.boundaryPaddingBeforeMs,
  200,
  'audio cleanup refinement never expands leading padding beyond the professional transcript boundary',
);
assertEqual(
  audioBoundaryTranscriptProtectedPlan[0]?.boundaryPaddingAfterMs,
  250,
  'audio cleanup refinement never expands trailing padding beyond the professional transcript boundary',
);
assertNumberBetween(
  audioBoundaryTranscriptProtectedPlan[0]?.leadingSilenceMs,
  0,
  200,
  'audio cleanup transcript-protected slices keep trusted leading audio activity evidence inside the final source window',
);
assertNumberBetween(
  audioBoundaryTranscriptProtectedPlan[0]?.trailingSilenceMs,
  0,
  250,
  'audio cleanup transcript-protected slices keep trusted trailing audio activity evidence inside the final source window',
);
assertRule(
  typeof audioBoundaryTranscriptProtectedPlan[0]?.sourceStartMs === 'number' &&
    typeof audioBoundaryTranscriptProtectedPlan[0]?.sourceEndMs === 'number' &&
    typeof audioBoundaryTranscriptProtectedPlan[0]?.audioActivityStartMs === 'number' &&
    typeof audioBoundaryTranscriptProtectedPlan[0]?.audioActivityEndMs === 'number' &&
    audioBoundaryTranscriptProtectedPlan[0].audioActivityStartMs >= audioBoundaryTranscriptProtectedPlan[0].sourceStartMs &&
    audioBoundaryTranscriptProtectedPlan[0].audioActivityEndMs <= audioBoundaryTranscriptProtectedPlan[0].sourceEndMs,
  'audio cleanup transcript-protected slices keep trusted audio activity range inside the final rendered source range',
);

const shortRepairableSilentTailClip = repairSmartSliceClipTimingForNativeRender(
  {
    index: 0,
    startMs: 10_000,
    durationMs: 5_000,
    label: 'Short repairable silent-tail clip',
    sourceStartMs: 10_000,
    sourceEndMs: 15_000,
    speechStartMs: 10_200,
    speechEndMs: 14_720,
    boundaryPaddingBeforeMs: 200,
    boundaryPaddingAfterMs: 280,
    transcriptText: 'The short clip keeps only a small amount of silence around the speech.',
    transcriptCoverageScore: 0.91,
    transcriptSegmentCount: 1,
    speechContinuityGrade: 'strong',
  },
  getVideoSlicePlanningPolicy({
    ...baseParams,
    minDuration: 15,
    maxDuration: 60,
    sourceDurationMs: 60_000,
  }),
);
assertEqual(
  shortRepairableSilentTailClip.startMs,
  10_000,
  'native render repair keeps the original start when the speech boundary is already inside the professional range',
);
assertEqual(
  shortRepairableSilentTailClip.durationMs,
  4_970,
  'native render repair trims excessive silence even when the repaired clip drops below the planning slice floor',
);
assertEqual(
  shortRepairableSilentTailClip.sourceStartMs,
  10_000,
  'native render repair keeps the repaired source start aligned to the original render start',
);
assertEqual(
  shortRepairableSilentTailClip.sourceEndMs,
  14_970,
  'native render repair trims the repaired source end to the professional trailing silence limit',
);
assertEqual(
  shortRepairableSilentTailClip.speechStartMs,
  10_200,
  'native render repair preserves the speech start inside the repaired native clip',
);
assertEqual(
  shortRepairableSilentTailClip.speechEndMs,
  14_720,
  'native render repair preserves the speech end inside the repaired native clip',
);
assertArrayIncludes(
  shortRepairableSilentTailClip.risks,
  'excess-trailing-silence-trimmed',
  'native render repair records the tightened trailing silence even when the clip remains at the minimum duration',
);

const audioBoundaryConflictProtectedPlan = refineSmartSlicePlanWithAudioActivityBoundaries([
  {
    index: 0,
    startMs: 0,
    durationMs: 30_000,
    label: 'Audio transcript conflict cleanup candidate',
    qualityScore: 0.92,
    continuityScore: 0.93,
    storyShape: 'complete',
    transcriptText: 'The transcript still contains real speech before and after the narrow denoised activity range.',
    transcriptCoverageScore: 0.96,
    transcriptSegmentCount: 3,
    speechContinuityGrade: 'strong',
    speechStartMs: 5_000,
    speechEndMs: 24_000,
    sourceStartMs: 0,
    sourceEndMs: 30_000,
    boundaryPaddingBeforeMs: 5_000,
    boundaryPaddingAfterMs: 6_000,
  },
], [
  {
    index: 0,
    startMs: 0,
    durationMs: 30_000,
    sourceStartMs: 0,
    sourceEndMs: 30_000,
    audioActivityStartMs: 9_000,
    audioActivityEndMs: 18_000,
    leadingSilenceMs: 9_000,
    trailingSilenceMs: 12_000,
    confidence: 0.95,
    analysisFilter: 'highpass=f=80,lowpass=f=12000,afftdn=nr=10:nf=-25,silencedetect=noise=-35dB:d=0.08',
  },
]);
assertEqual(
  audioBoundaryConflictProtectedPlan[0]?.startMs,
  8_800,
  'audio cleanup boundary conflicts trim rendered starts to trusted denoised activity before native rendering',
);
assertEqual(
  audioBoundaryConflictProtectedPlan[0]?.durationMs,
  9_450,
  'audio cleanup boundary conflicts trim rendered tails to trusted denoised activity before native rendering',
);
assertEqual(
  audioBoundaryConflictProtectedPlan[0]?.speechStartMs,
  9_000,
  'audio cleanup boundary conflicts use the trusted audio activity start as the effective speech boundary',
);
assertEqual(
  audioBoundaryConflictProtectedPlan[0]?.speechEndMs,
  18_000,
  'audio cleanup boundary conflicts use the trusted audio activity end as the effective speech boundary',
);
assertEqual(
  audioBoundaryConflictProtectedPlan[0]?.audioActivityStartMs,
  9_000,
  'audio cleanup boundary conflicts preserve denoised audio activity start evidence for review',
);
assertEqual(
  audioBoundaryConflictProtectedPlan[0]?.audioActivityEndMs,
  18_000,
  'audio cleanup boundary conflicts preserve denoised audio activity end evidence for review',
);
assertNumberBetween(
  audioBoundaryConflictProtectedPlan[0]?.leadingSilenceMs,
  0,
  200,
  'audio cleanup boundary conflicts keep leading audio activity padding inside the native render standard',
);
assertNumberBetween(
  audioBoundaryConflictProtectedPlan[0]?.trailingSilenceMs,
  0,
  250,
  'audio cleanup boundary conflicts keep trailing audio activity padding inside the native render standard',
);
assertEqual(
  audioBoundaryConflictProtectedPlan[0]?.boundaryDecisionSource,
  'combined',
  'audio cleanup boundary conflicts choose combined boundaries when transcript ranges overlap with denoised audio activity',
);
assertEqual(
  audioBoundaryConflictProtectedPlan[0]?.leadingSilenceTrimMs,
  8_800,
  'audio cleanup boundary conflicts record the audio-bounded leading trim',
);
assertEqual(
  audioBoundaryConflictProtectedPlan[0]?.trailingSilenceTrimMs,
  11_750,
  'audio cleanup boundary conflicts record the audio-bounded trailing trim',
);
assertArrayIncludes(
  audioBoundaryConflictProtectedPlan[0]?.risks,
  'audio-transcript-boundary-conflict',
  'audio cleanup boundary conflicts are visible as review risks',
);

const audioBoundaryMicroTrimProtectedPlan = refineSmartSlicePlanWithAudioActivityBoundaries([
  {
    index: 0,
    startMs: 0,
    durationMs: 30_000,
    label: 'Micro audio activity inside valid transcript candidate',
    qualityScore: 0.9,
    continuityScore: 0.9,
    storyShape: 'complete',
    transcriptText: 'The transcript contains a valid short complete statement despite narrow audio activity.',
    transcriptCoverageScore: 0.95,
    transcriptSegmentCount: 1,
    speechContinuityGrade: 'strong',
    speechStartMs: 5_000,
    speechEndMs: 6_200,
    sourceStartMs: 4_800,
    sourceEndMs: 6_450,
    boundaryPaddingBeforeMs: 200,
    boundaryPaddingAfterMs: 250,
  },
], [
  {
    index: 0,
    startMs: 0,
    durationMs: 30_000,
    sourceStartMs: 4_800,
    sourceEndMs: 6_450,
    audioActivityStartMs: 5_400,
    audioActivityEndMs: 5_500,
    leadingSilenceMs: 600,
    trailingSilenceMs: 950,
    confidence: 0.94,
    analysisFilter: 'highpass=f=80,lowpass=f=12000,afftdn=nr=10:nf=-25,silencedetect=noise=-35dB:d=0.08',
  },
]);
assertEqual(
  audioBoundaryMicroTrimProtectedPlan[0]?.durationMs,
  550,
  'audio cleanup micro boundary conflicts prefer renderable audio activity padding over transcript-backed excessive silence',
);
assertEqual(
  audioBoundaryMicroTrimProtectedPlan[0]?.boundaryDecisionSource,
  'combined',
  'audio cleanup micro boundary conflicts choose combined boundaries when transcript padding cannot satisfy native render evidence',
);
assertNumberBetween(
  audioBoundaryMicroTrimProtectedPlan[0]?.leadingSilenceMs,
  0,
  200,
  'audio cleanup micro boundary conflicts keep leading audio activity padding inside the native render standard',
);
assertNumberBetween(
  audioBoundaryMicroTrimProtectedPlan[0]?.trailingSilenceMs,
  0,
  250,
  'audio cleanup micro boundary conflicts keep trailing audio activity padding inside the native render standard',
);
assertArrayIncludes(
  audioBoundaryMicroTrimProtectedPlan[0]?.risks,
  'audio-transcript-boundary-conflict',
  'audio cleanup refinement records micro-trim protection as an audio/transcript boundary conflict',
);
assertArrayIncludes(
  audioBoundaryMicroTrimProtectedPlan[0]?.risks,
  'combined-boundary-on-conflict',
  'audio cleanup micro boundary conflicts remain visible as combined-boundary-on-conflict when trusted activity cannot meet the speech-aligned duration target',
);

const audioOnlyBoundaryRefinedPlan = refineSmartSlicePlanWithAudioActivityBoundaries([
  {
    index: 0,
    startMs: 0,
    durationMs: 30_000,
    label: 'Audio-only cleanup candidate',
    qualityScore: 0.86,
    continuityScore: 0.84,
    storyShape: 'complete',
    transcriptText: 'The recognizer returned useful text but did not provide reliable timing.',
    transcriptCoverageScore: 0.8,
    transcriptSegmentCount: 1,
    sourceStartMs: 0,
    sourceEndMs: 30_000,
  },
], [
  {
    index: 0,
    startMs: 0,
    durationMs: 30_000,
    sourceStartMs: 0,
    sourceEndMs: 30_000,
    audioActivityStartMs: 4_500,
    audioActivityEndMs: 22_700,
    leadingSilenceMs: 4_500,
    trailingSilenceMs: 7_300,
    confidence: 0.91,
    analysisFilter: 'highpass=f=80,lowpass=f=12000,afftdn=nr=10:nf=-25,silencedetect=noise=-35dB:d=0.08',
  },
]);
assertEqual(
  audioOnlyBoundaryRefinedPlan[0]?.startMs,
  4_300,
  'audio cleanup refinement trims starts from denoised audio activity when transcript timings are unavailable',
);
assertEqual(
  audioOnlyBoundaryRefinedPlan[0]?.durationMs,
  18_650,
  'audio cleanup refinement trims tails from denoised audio activity when transcript timings are unavailable',
);
assertEqual(
  audioOnlyBoundaryRefinedPlan[0]?.boundaryDecisionSource,
  'audio',
  'audio cleanup refinement records audio-only boundary decisions when transcript timings are unavailable',
);
assertEqual(
  audioOnlyBoundaryRefinedPlan[0]?.leadingSilenceTrimMs,
  4_300,
  'audio-only cleanup records leading silence removed from the planned render window',
);
assertEqual(
  audioOnlyBoundaryRefinedPlan[0]?.trailingSilenceTrimMs,
  7_050,
  'audio-only cleanup records trailing silence removed from the planned render window',
);
assertArrayIncludes(
  audioOnlyBoundaryRefinedPlan[0]?.risks,
  'audio-boundary-refined',
  'audio-only cleanup records refined timing evidence for review',
);

const audioOnlyMicroActivityPlan = refineSmartSlicePlanWithAudioActivityBoundaries([
  {
    index: 0,
    startMs: 0,
    durationMs: 30_000,
    label: 'Audio-only micro activity candidate',
    qualityScore: 0.86,
    continuityScore: 0.84,
    storyShape: 'complete',
    transcriptText: 'The recognizer returned text but no reliable timestamped speech boundary.',
    transcriptCoverageScore: 0.8,
    transcriptSegmentCount: 1,
    sourceStartMs: 0,
    sourceEndMs: 30_000,
  },
], [
  {
    index: 0,
    startMs: 0,
    durationMs: 30_000,
    sourceStartMs: 0,
    sourceEndMs: 30_000,
    audioActivityStartMs: 5_400,
    audioActivityEndMs: 5_500,
    leadingSilenceMs: 5_400,
    trailingSilenceMs: 24_500,
    confidence: 0.91,
    analysisFilter: 'highpass=f=80,lowpass=f=12000,afftdn=nr=10:nf=-25,silencedetect=noise=-35dB:d=0.08',
  },
]);
assertEqual(
  audioOnlyMicroActivityPlan[0]?.durationMs,
  30_000,
  'audio-only cleanup refuses to create sub-second clips from micro audio activity without STT speech boundaries',
);
assertEqual(
  audioOnlyMicroActivityPlan[0]?.boundaryDecisionSource,
  'audio',
  'audio-only cleanup keeps the boundary decision auditable when micro activity cannot safely define render timing',
);
assertArrayIncludes(
  audioOnlyMicroActivityPlan[0]?.risks,
  'audio-only-boundary-too-short',
  'audio-only cleanup records when micro activity is too short to become a standalone smart slice',
);

const forcedDenoiseAudioBoundaryRefinedPlan = refineSmartSlicePlanWithAudioActivityBoundaries([
  {
    index: 0,
    startMs: 0,
    durationMs: 30_000,
    label: 'No denoise cleanup candidate',
    qualityScore: 0.86,
    continuityScore: 0.84,
    storyShape: 'complete',
    transcriptText: 'The user disabled denoise but still wants reliable boundary evidence.',
    transcriptCoverageScore: 0.9,
    transcriptSegmentCount: 1,
    speechContinuityGrade: 'strong',
    speechStartMs: 5_000,
    speechEndMs: 24_000,
    sourceStartMs: 0,
    sourceEndMs: 30_000,
  },
], [
  {
    index: 0,
    startMs: 0,
    durationMs: 30_000,
    sourceStartMs: 0,
    sourceEndMs: 30_000,
    audioActivityStartMs: 5_000,
    audioActivityEndMs: 24_000,
    leadingSilenceMs: 5_000,
    trailingSilenceMs: 6_000,
    confidence: 0.9,
    analysisFilter: 'silencedetect=noise=-35dB:d=0.08',
  },
], { noiseReductionApplied: false });
assertEqual(
  forcedDenoiseAudioBoundaryRefinedPlan[0]?.noiseReductionApplied,
  false,
  'audio cleanup refinement preserves an explicit no-denoise decision for clean source audio',
);
assertEqual(
  forcedDenoiseAudioBoundaryRefinedPlan[0]?.audioCleanupProfile,
  'smart-slice-speech-denoise-v1',
  'audio cleanup refinement keeps the canonical cleanup profile while skipping broadband denoise',
);
assertEqual(
  forcedDenoiseAudioBoundaryRefinedPlan[0]?.boundaryDecisionSource,
  'combined',
  'audio cleanup refinement accepts high-confidence raw audio activity as boundary evidence when denoise is disabled',
);
assertEqual(
  forcedDenoiseAudioBoundaryRefinedPlan[0]?.audioActivityAnalysisFilter,
  'silencedetect=noise=-35dB:d=0.08',
  'audio cleanup refinement records the raw audio boundary analysis filter when denoise is disabled',
);

const sparseIndexedAudioBoundaryRefinedPlan = refineSmartSlicePlanWithAudioActivityBoundaries([
  {
    index: 4,
    startMs: 0,
    durationMs: 30_000,
    label: 'Sparse indexed audio cleanup candidate A',
    qualityScore: 0.91,
    continuityScore: 0.92,
    storyShape: 'complete',
    transcriptText: 'The first sparse indexed clip should use its own audio analysis result.',
    transcriptCoverageScore: 0.95,
    transcriptSegmentCount: 2,
    speechContinuityGrade: 'strong',
    speechStartMs: 5_000,
    speechEndMs: 24_000,
    sourceStartMs: 0,
    sourceEndMs: 30_000,
  },
  {
    index: 7,
    startMs: 40_000,
    durationMs: 30_000,
    label: 'Sparse indexed audio cleanup candidate B',
    qualityScore: 0.91,
    continuityScore: 0.92,
    storyShape: 'complete',
    transcriptText: 'The second sparse indexed clip should use the later indexed audio analysis result.',
    transcriptCoverageScore: 0.95,
    transcriptSegmentCount: 2,
    speechContinuityGrade: 'strong',
    speechStartMs: 45_000,
    speechEndMs: 64_000,
    sourceStartMs: 40_000,
    sourceEndMs: 70_000,
  },
], [
  {
    index: 7,
    startMs: 40_000,
    durationMs: 30_000,
    sourceStartMs: 40_000,
    sourceEndMs: 70_000,
    audioActivityStartMs: 45_500,
    audioActivityEndMs: 63_500,
    leadingSilenceMs: 5_500,
    trailingSilenceMs: 6_500,
    confidence: 0.93,
    analysisFilter: 'highpass=f=80,lowpass=f=12000,afftdn=nr=10:nf=-25,silencedetect=noise=-35dB:d=0.08',
  },
  {
    index: 4,
    startMs: 0,
    durationMs: 30_000,
    sourceStartMs: 0,
    sourceEndMs: 30_000,
    audioActivityStartMs: 5_120,
    audioActivityEndMs: 23_880,
    leadingSilenceMs: 5_120,
    trailingSilenceMs: 6_120,
    confidence: 0.94,
    analysisFilter: 'highpass=f=80,lowpass=f=12000,afftdn=nr=10:nf=-25,silencedetect=noise=-35dB:d=0.08',
  },
]);
assertEqual(
  sparseIndexedAudioBoundaryRefinedPlan[0]?.audioActivityStartMs,
  5_120,
  'audio cleanup refinement matches boundary analysis by clip index before falling back to array order',
);
assertEqual(
  sparseIndexedAudioBoundaryRefinedPlan[1]?.audioActivityStartMs,
  45_500,
  'audio cleanup refinement does not attach a sparse clip index analysis to the wrong planned clip',
);

const overpaddedSpeechCandidate = {
  candidateId: 'overpadded-speech-evidence',
  index: 0,
  startMs: 0,
  durationMs: 30_000,
  endMs: 30_000,
  label: 'Overpadded evidence',
  transcriptText: 'The hook starts only after silence and finishes before the quiet tail.',
  transcriptCoverageScore: 0.92,
  transcriptSegmentCount: 2,
  speechContinuityGrade: 'strong',
  speechStartMs: 6_000,
  speechEndMs: 23_000,
  sourceStartMs: 0,
  sourceEndMs: 30_000,
  boundaryPaddingBeforeMs: 6_000,
  boundaryPaddingAfterMs: 7_000,
  qualityScore: 0.9,
  continuityScore: 0.9,
  storyShape: 'complete',
  contentArcGrade: 'complete',
  topicCoherenceGrade: 'strong',
  score: 0.9,
};
const llmOverpaddedSpeechPlan = parseLlmSlicePlan(
  JSON.stringify([
    {
      startMs: 0,
      durationMs: 30_000,
      title: 'Overpadded LLM clip',
    },
  ]),
  {
    ...baseParams,
    minDuration: 5,
    maxDuration: 60,
    sourceDurationMs: 60_000,
  },
  deterministicPlan,
  [overpaddedSpeechCandidate],
);
assertEqual(
  llmOverpaddedSpeechPlan[0]?.startMs,
  5_800,
  'LLM raw timing is trimmed to the first real speech boundary instead of preserving a long silent intro',
);
assertEqual(
  llmOverpaddedSpeechPlan[0]?.durationMs,
  17_450,
  'LLM raw timing is trimmed to the final real speech boundary instead of preserving a long silent outro',
);
assertArrayIncludes(
  llmOverpaddedSpeechPlan[0]?.risks,
  'excess-leading-silence-trimmed',
  'LLM raw timing records leading silence trimming in the final plan',
);

const shortUnjoinedSpeechCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 10,
  maxDuration: 20,
  continuityLevel: 'strict',
}, [
  { startMs: 0, endMs: 6000, text: 'Short setup cannot stand alone yet.', speaker: 'Speaker 1' },
  { startMs: 7000, endMs: 18000, text: 'Separate next point starts after a strict continuity break.', speaker: 'Speaker 1' },
]);
assertRule(
  !shortUnjoinedSpeechCandidates.some((candidate) =>
    candidate.candidateId === 'transcript-1' && candidate.endMs > 7000,
  ),
  'speech boundary padding never extends a short candidate into the next unjoined speech segment',
);

const sourceDurationBoundedTranscriptCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 10,
  maxDuration: 45,
  sourceDurationMs: 60_000,
  continuityLevel: 'standard',
}, [
  { startMs: 2_000, endMs: 18_000, text: 'The valid story starts and ends inside the imported source duration.', speaker: 'Speaker 1' },
  { startMs: 58_000, endMs: 65_000, text: 'This recognizer timestamp extends beyond the source and cannot be trusted.', speaker: 'Speaker 1' },
]);
assertRule(
  !sourceDurationBoundedTranscriptCandidates.some((candidate) =>
    (candidate.speechEndMs ?? candidate.endMs) > 60_000 ||
      candidate.transcriptText?.includes('cannot be trusted')
  ),
  'transcript candidate generation rejects speech-to-text segments that extend beyond trusted source duration',
);

const strictContinuityCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  continuityLevel: 'strict',
}, [
  { startMs: 0, endMs: 10000, text: 'Opening setup with important context.', speaker: 'Speaker 1' },
  { startMs: 11200, endMs: 24000, text: 'then payoff should not attach across strict gap.', speaker: 'Speaker 1' },
]);
assertEqual(
  strictContinuityCandidates.find((candidate) => candidate.candidateId === 'transcript-2')?.startMs,
  11000,
  'strict continuity may add silence breathing room but does not repair connector starts across gaps beyond the strict join standard',
);
assertEqual(
  strictContinuityCandidates.find((candidate) => candidate.candidateId === 'transcript-2')?.speechStartMs,
  11200,
  'strict continuity preserves the unpadded speech start when connector context cannot be repaired',
);

const keywordCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  highlightEngine: 'keyword',
  customKeywords: ['retention'],
}, [
  { startMs: 0, endMs: 16000, text: 'Plain setup without the configured term.', speaker: 'Speaker 1' },
  { startMs: 17000, endMs: 33000, text: 'Retention spike explains why viewers stay.', speaker: 'Speaker 1' },
]);
const keywordCandidate = keywordCandidates.find((candidate) => candidate.transcriptText?.includes('Retention spike'));
assertEqual(
  keywordCandidate?.startMs,
  16800,
  'custom keywords boost matching transcript windows in candidate ranking while preserving render breathing room',
);
assertEqual(
  keywordCandidate?.speechStartMs,
  17000,
  'custom keyword candidates preserve the original speech start despite leading render padding',
);

const storyShapeCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 10,
  maxDuration: 45,
  continuityLevel: 'standard',
}, [
  { startMs: 0, endMs: 12000, text: 'Three seconds is all you have before people scroll away.', speaker: 'Speaker 1' },
  { startMs: 12200, endMs: 24000, text: 'Because the opening does not name the pain, viewers never know why they should care.', speaker: 'Speaker 1' },
  { startMs: 24200, endMs: 36000, text: 'So the fix is to lead with the result, then prove it with one concrete example.', speaker: 'Speaker 1' },
]);
const completeStoryCandidate = storyShapeCandidates.find((candidate) => candidate.storyShape === 'complete');
assertEqual(
  completeStoryCandidate?.storyShape,
  'complete',
  'speech-to-text candidate scoring detects complete hook-context-payoff short-video windows',
);
assertRule(
  !completeStoryCandidate?.risks?.includes('missing-payoff'),
  'complete hook-context-payoff windows are not flagged as missing a payoff',
);
assertNumberBetween(
  completeStoryCandidate?.contentArcScore,
  0.8,
  1,
  'speech-to-text candidate scoring exposes complete content-arc scores for publishable short videos',
);
assertEqual(
  completeStoryCandidate?.contentArcGrade,
  'complete',
  'speech-to-text candidate scoring grades complete hook-setup-conflict-payoff arcs as complete',
);
assertArrayIncludes(
  completeStoryCandidate?.contentArcStages,
  'hook',
  'speech-to-text content arcs detect short-video hooks',
);
assertArrayIncludes(
  completeStoryCandidate?.contentArcStages,
  'setup',
  'speech-to-text content arcs detect setup context',
);
assertArrayIncludes(
  completeStoryCandidate?.contentArcStages,
  'conflict',
  'speech-to-text content arcs detect audience pain or conflict',
);
assertArrayIncludes(
  completeStoryCandidate?.contentArcStages,
  'payoff',
  'speech-to-text content arcs detect payoff or solution endings',
);
const beforeAsTemporalPayoffCandidate = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 10,
  maxDuration: 45,
  continuityLevel: 'standard',
}, [
  {
    startMs: 0,
    endMs: 12_400,
    text: 'Why the opening must start immediately is simple. The first sentence states the result before any silence and gives viewers the clear payoff.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 12_420,
    endMs: 24_800,
    text: 'Speaker two answers with context, explains the problem, and connects the setup so the first publishable clip stays complete.',
    speaker: 'Speaker 2',
  },
]);
assertArrayIncludes(
  beforeAsTemporalPayoffCandidate[0]?.contentArcStages,
  'payoff',
  'English payoff detection treats before as temporal when the sentence states a result before silence',
);
assertRule(
  !beforeAsTemporalPayoffCandidate[0]?.risks?.includes('missing-payoff'),
  'English payoff detection does not mark temporal before/result clips as missing payoff',
);
assertRule(
  Array.isArray(completeStoryCandidate?.contentArcMissingStages) &&
    completeStoryCandidate.contentArcMissingStages.length === 0,
  'complete content arcs do not report missing short-video stages',
);
assertNumberBetween(
  completeStoryCandidate?.topicCoherenceScore,
  0.75,
  1,
  'speech-to-text candidate scoring exposes high topic coherence for single-topic short videos',
);
assertEqual(
  completeStoryCandidate?.topicCoherenceGrade,
  'strong',
  'speech-to-text candidate scoring grades single-topic transcript windows as strong topic coherence',
);
assertEqual(
  completeStoryCandidate?.topicShiftCount,
  0,
  'single-topic transcript windows do not report topic shifts',
);
assertArrayIncludes(
  completeStoryCandidate?.topicKeywords,
  'opening',
  'topic coherence metadata exposes representative transcript keywords for review',
);

const semanticContinuityPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 10,
  maxDuration: 45,
  sourceDurationMs: 50_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 12_000,
    text: 'Why retention drops is simple: the opening hides the result viewers came for.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 12_200,
    endMs: 24_500,
    text: 'Because the onboarding case shows viewer pain before people understand the workflow context.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 24_700,
    endMs: 37_000,
    text: 'The problem is unclear context, so the fix is to show the outcome first and the payoff improves completion.',
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  semanticContinuityPlan[0]?.startMs,
  0,
  'semantic continuity planning selects the full understood story from the original hook boundary',
);
assertEqual(
  semanticContinuityPlan[0]?.speechEndMs,
  37_000,
  'semantic continuity planning keeps the payoff segment instead of cutting an incomplete high-score snippet',
);
assertEqual(
  semanticContinuityPlan[0]?.transcriptSegmentCount,
  3,
  'semantic continuity planning merges adjacent understood transcript segments into one continuous clip',
);
assertEqual(
  semanticContinuityPlan[0]?.contentArcGrade,
  'complete',
  'semantic continuity planning requires merged clips to carry a complete hook-setup-conflict-payoff arc',
);
assertRule(
  semanticContinuityPlan[0]?.topicCoherenceGrade !== 'weak',
  'semantic continuity planning refuses to call unrelated topic drift a complete story merge',
);
assertArrayIncludes(
  semanticContinuityPlan[0]?.risks,
  'semantic-story-merged',
  'semantic continuity planning records story-merge evidence for review and release audits',
);

const multiSlotSemanticContinuityPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 10,
  maxDuration: 45,
  sourceDurationMs: 50_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 12_000,
    text: 'Why retention drops is simple: the opening hides the result viewers came for.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 12_200,
    endMs: 24_500,
    text: 'Because the onboarding case shows viewer pain before people understand the workflow context.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 24_700,
    endMs: 37_000,
    text: 'The problem is unclear context, so the fix is to show the outcome first and the payoff improves completion.',
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  multiSlotSemanticContinuityPlan.length,
  1,
  'semantic continuity planning does not split one complete story into multiple adjacent fragments just because more output slots are available',
);
assertEqual(
  multiSlotSemanticContinuityPlan[0]?.transcriptSegmentCount,
  3,
  'semantic continuity planning keeps all understood story segments together for multi-slot requests',
);
assertArrayIncludes(
  multiSlotSemanticContinuityPlan[0]?.risks,
  'semantic-story-merged',
  'semantic continuity planning prefers the merged story over separate partial windows in the final plan',
);

const numberedStepSingleStoryPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 10,
  maxDuration: 45,
  sourceDurationMs: 60_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 9_000,
    text: 'Step one: why checkout conversion drops is that the payment screen hides the trust result and the problem is unclear.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 9_200,
    endMs: 19_000,
    text: 'Step two: because the checkout case shows user pain before people understand the refund context.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 19_200,
    endMs: 30_000,
    text: 'Step three: so the fix is to show the guarantee first and the payoff improves completion.',
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  numberedStepSingleStoryPlan.length,
  1,
  'numbered step story planning keeps one coherent hook-setup-payoff story as a single clip',
);
assertEqual(
  numberedStepSingleStoryPlan[0]?.transcriptSegmentCount,
  3,
  'numbered step story planning keeps every internal step inside the complete story clip',
);
assertArrayIncludes(
  numberedStepSingleStoryPlan[0]?.risks,
  'semantic-story-merged',
  'numbered step story planning keeps semantic-story evidence instead of downgrading to a generic topic segment',
);

const twoSegmentCompleteStoryPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 15,
  maxDuration: 60,
  sourceDurationMs: 120_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 18_000,
    text: 'Why retention drops is that viewers do not understand the opening problem and the context is hidden.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 18_200,
    endMs: 36_000,
    text: 'The example shows the onboarding case and the fix is to show the outcome first so completion improves.',
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  twoSegmentCompleteStoryPlan.length,
  1,
  'auto semantic continuity planning merges a two-segment hook-payoff story instead of splitting it into sparse fragments',
);
assertEqual(
  twoSegmentCompleteStoryPlan[0]?.transcriptSegmentCount,
  2,
  'auto semantic continuity planning keeps both adjacent segments in a short complete story',
);
assertEqual(
  twoSegmentCompleteStoryPlan[0]?.contentArcGrade,
  'complete',
  'auto semantic continuity planning emits a complete content arc for two-segment stories',
);
assertArrayIncludes(
  twoSegmentCompleteStoryPlan[0]?.risks,
  'semantic-story-merged',
  'auto semantic continuity planning records merged-story evidence for short complete stories',
);

const gappedContinuousStoryPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 10,
  maxDuration: 60,
  sourceDurationMs: 90_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 11_000,
    text: 'Why retention drops is that the opening hides the problem viewers should care about.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 12_600,
    endMs: 24_000,
    text: 'Because the onboarding case shows user pain before people understand the workflow context.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 25_700,
    endMs: 37_000,
    text: 'The mistake is unclear context and the risk is that viewers leave before the value appears.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 38_800,
    endMs: 51_000,
    text: 'So the fix is to show the outcome first, then the payoff improves completion.',
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  gappedContinuousStoryPlan.length,
  1,
  'auto semantic continuity planning treats short same-topic pauses as one content group instead of separate output clips',
);
assertEqual(
  gappedContinuousStoryPlan[0]?.transcriptSegmentCount,
  4,
  'auto semantic continuity planning keeps the full gapped hook-setup-conflict-payoff story together',
);
assertArrayIncludes(
  gappedContinuousStoryPlan[0]?.risks,
  'semantic-story-merged',
  'auto semantic continuity planning records semantic merge evidence for gapped continuous stories',
);

const distinctBackToBackStoriesPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 10,
  maxDuration: 45,
  sourceDurationMs: 120_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 10_000,
    text: 'Why viewer retention drops is that the opening hides the result and the problem is unclear.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 10_200,
    endMs: 22_000,
    text: 'Because the onboarding case shows the pain, so the fix is to show the outcome first and completion improves.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 24_200,
    endMs: 35_000,
    text: 'Why pricing refunds fail is that annual invoice terms hide the cost and the billing problem is unclear.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 35_200,
    endMs: 47_000,
    text: 'Because the refund case shows user pain, so the solution is to show the invoice terms before checkout.',
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  distinctBackToBackStoriesPlan.length,
  2,
  'auto semantic continuity planning emits two clips for two distinct complete back-to-back stories',
);
assertRule(
  distinctBackToBackStoriesPlan.every((clip) => clip.transcriptSegmentCount === 2),
  'auto semantic continuity planning keeps each distinct story internally continuous without merging unrelated topics',
);
assertRule(
  !distinctBackToBackStoriesPlan.some((clip) => (clip.transcriptSegmentCount ?? 0) > 2),
  'auto semantic continuity planning refuses to merge adjacent complete stories into one topic-drift clip',
);
assertRule(
  distinctBackToBackStoriesPlan.every((clip) => clip.contentArcGrade === 'complete'),
  'auto semantic continuity planning requires each distinct story clip to keep a complete content arc',
);

const sequentialTipStoriesPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 10,
  maxDuration: 60,
  sourceDurationMs: 120_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 8_000,
    text: 'Tip one: why onboarding retention drops is that the first screen hides the result and the problem is unclear.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 8_200,
    endMs: 16_000,
    text: 'Because this retention example shows viewer pain, so the fix is to show the outcome first and completion improves.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 16_200,
    endMs: 24_000,
    text: 'Tip two: why activation checklist fails is that the next action is hidden and the problem blocks users.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 24_200,
    endMs: 32_000,
    text: 'Because this activation example shows user pain, so the solution is to show one next action and conversion improves.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 32_200,
    endMs: 40_000,
    text: 'Tip three: why setup progress fails is that the tutorial hides progress and the problem feels endless.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 40_200,
    endMs: 48_000,
    text: 'Because this setup example shows user pain, so the fix is to show progress first and confidence improves.',
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  sequentialTipStoriesPlan.length,
  3,
  'auto semantic continuity planning emits every adjacent complete tip story instead of collapsing the natural clip count',
);
assertRule(
  sequentialTipStoriesPlan.every((clip) =>
    clip.contentArcGrade === 'complete' &&
      clip.topicCoherenceGrade !== 'weak' &&
      clip.transcriptSegmentCount === 2
  ),
  'adjacent tip story planning keeps every emitted clip complete, coherent, and internally continuous',
);
assertRule(
  sequentialTipStoriesPlan.some((clip) => clip.transcriptText?.includes('retention example')) &&
    sequentialTipStoriesPlan.some((clip) => clip.transcriptText?.includes('activation example')) &&
    sequentialTipStoriesPlan.some((clip) => clip.transcriptText?.includes('setup example')),
  'adjacent tip story planning preserves each natural content group instead of replacing one with a broader overlapping merge',
);
assertRule(
  !sequentialTipStoriesPlan.some((clip) => (clip.transcriptSegmentCount ?? 0) > 2),
  'adjacent tip story planning refuses broad semantic merges that cross into the next complete story opening',
);

const sequentialCaseStoriesPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 10,
  maxDuration: 60,
  sourceDurationMs: 120_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 8_000,
    text: 'Case one: why onboarding retention drops is that the first screen hides the result and the problem is unclear.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 8_200,
    endMs: 16_000,
    text: 'Because this retention example shows viewer pain, so the fix is to show the outcome first and completion improves.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 16_200,
    endMs: 24_000,
    text: 'Case two: why activation checklist fails is that the next action is hidden and the problem blocks users.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 24_200,
    endMs: 32_000,
    text: 'Because this activation example shows user pain, so the solution is to show one next action and conversion improves.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 32_200,
    endMs: 40_000,
    text: 'Case three: why setup progress fails is that the tutorial hides progress and the problem feels endless.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 40_200,
    endMs: 48_000,
    text: 'Because this setup example shows user pain, so the fix is to show progress first and confidence improves.',
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  sequentialCaseStoriesPlan.length,
  3,
  'adjacent case story planning emits every complete case instead of merging a previous payoff into the next case opening',
);
assertRule(
  sequentialCaseStoriesPlan.every((clip) =>
    clip.risks?.includes('semantic-story-merged') &&
      clip.contentArcGrade === 'complete' &&
      clip.topicCoherenceGrade !== 'weak' &&
      clip.transcriptSegmentCount === 2
  ),
  'adjacent case story planning keeps each emitted case complete, coherent, and internally continuous',
);
assertRule(
  sequentialCaseStoriesPlan.some((clip) => clip.transcriptText?.includes('retention example')) &&
    sequentialCaseStoriesPlan.some((clip) => clip.transcriptText?.includes('activation example')) &&
    sequentialCaseStoriesPlan.some((clip) => clip.transcriptText?.includes('setup example')),
  'adjacent case story planning preserves every natural case group instead of dropping the first complete case',
);
assertRule(
  !sequentialCaseStoriesPlan.some((clip) => (clip.transcriptSegmentCount ?? 0) > 2),
  'adjacent case story planning refuses broad semantic merges that cross explicit case story openings',
);

const sequentialFixStoriesPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 10,
  maxDuration: 60,
  sourceDurationMs: 120_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 8_000,
    text: 'Fix one: why onboarding retention drops is that the first screen hides the result and the problem is unclear.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 8_200,
    endMs: 16_000,
    text: 'Because this retention example shows viewer pain, so the fix is to show the outcome first and completion improves.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 16_200,
    endMs: 24_000,
    text: 'Fix two: why activation checklist fails is that the next action is hidden and the problem blocks users.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 24_200,
    endMs: 32_000,
    text: 'Because this activation example shows user pain, so the solution is to show one next action and conversion improves.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 32_200,
    endMs: 40_000,
    text: 'Fix three: why setup progress fails is that the tutorial hides progress and the problem feels endless.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 40_200,
    endMs: 48_000,
    text: 'Because this setup example shows user pain, so the fix is to show progress first and confidence improves.',
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  sequentialFixStoriesPlan.length,
  3,
  'adjacent fix story planning emits every complete fix instead of letting repeat filtering collapse the natural clip count',
);
assertRule(
  sequentialFixStoriesPlan.every((clip) =>
    clip.risks?.includes('semantic-story-merged') &&
      clip.contentArcGrade === 'complete' &&
      clip.topicCoherenceGrade !== 'weak' &&
      clip.transcriptSegmentCount === 2
  ),
  'adjacent fix story planning keeps each emitted fix complete, coherent, and internally continuous',
);
assertRule(
  sequentialFixStoriesPlan.some((clip) => clip.transcriptText?.includes('retention example')) &&
    sequentialFixStoriesPlan.some((clip) => clip.transcriptText?.includes('activation example')) &&
    sequentialFixStoriesPlan.some((clip) => clip.transcriptText?.includes('setup example')),
  'adjacent fix story planning preserves every natural fix group instead of dropping the first complete fix',
);
assertRule(
  !sequentialFixStoriesPlan.some((clip) => (clip.transcriptSegmentCount ?? 0) > 2),
  'adjacent fix story planning refuses broad semantic merges that cross explicit fix story openings',
);

const sequentialProblemStoriesPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 10,
  maxDuration: 60,
  sourceDurationMs: 120_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 8_000,
    text: 'Problem one: why onboarding retention drops is that the first screen hides the result and the problem is unclear.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 8_200,
    endMs: 16_000,
    text: 'Because this retention example shows viewer pain, so the fix is to show the outcome first and completion improves.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 16_200,
    endMs: 24_000,
    text: 'Problem two: why activation checklist fails is that the next action is hidden and the problem blocks users.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 24_200,
    endMs: 32_000,
    text: 'Because this activation example shows user pain, so the solution is to show one next action and conversion improves.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 32_200,
    endMs: 40_000,
    text: 'Problem three: why setup progress fails is that the tutorial hides progress and the problem feels endless.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 40_200,
    endMs: 48_000,
    text: 'Because this setup example shows user pain, so the fix is to show progress first and confidence improves.',
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  sequentialProblemStoriesPlan.length,
  3,
  'adjacent problem story planning emits every complete problem instead of letting a payoff-to-next-problem window collapse the natural clip count',
);
assertRule(
  sequentialProblemStoriesPlan.every((clip) =>
    clip.risks?.includes('semantic-story-merged') &&
      clip.contentArcGrade === 'complete' &&
      clip.topicCoherenceGrade !== 'weak' &&
      clip.transcriptSegmentCount === 2
  ),
  'adjacent problem story planning keeps each emitted problem complete, coherent, and internally continuous',
);
assertRule(
  sequentialProblemStoriesPlan.some((clip) => clip.transcriptText?.includes('retention example')) &&
    sequentialProblemStoriesPlan.some((clip) => clip.transcriptText?.includes('activation example')) &&
    sequentialProblemStoriesPlan.some((clip) => clip.transcriptText?.includes('setup example')),
  'adjacent problem story planning preserves every natural problem group instead of dropping the first complete problem',
);
assertRule(
  !sequentialProblemStoriesPlan.some((clip) => (clip.transcriptSegmentCount ?? 0) > 2),
  'adjacent problem story planning refuses broad semantic merges that cross explicit problem story openings',
);

const sequentialBugStoriesPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 10,
  maxDuration: 60,
  sourceDurationMs: 120_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 8_000,
    text: 'Bug one: why onboarding retention drops is that the first screen hides the result and the problem is unclear.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 8_200,
    endMs: 16_000,
    text: 'Because this retention example shows viewer pain, so the fix is to show the outcome first and completion improves.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 16_200,
    endMs: 24_000,
    text: 'Bug two: why activation checklist fails is that the next action is hidden and the problem blocks users.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 24_200,
    endMs: 32_000,
    text: 'Because this activation example shows user pain, so the solution is to show one next action and conversion improves.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 32_200,
    endMs: 40_000,
    text: 'Bug three: why setup progress fails is that the tutorial hides progress and the problem feels endless.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 40_200,
    endMs: 48_000,
    text: 'Because this setup example shows user pain, so the fix is to show progress first and confidence improves.',
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  sequentialBugStoriesPlan.length,
  3,
  'adjacent bug story planning emits every complete bug story instead of letting a payoff-to-next-bug window collapse the natural clip count',
);
assertRule(
  sequentialBugStoriesPlan.every((clip) =>
    clip.risks?.includes('semantic-story-merged') &&
      clip.contentArcGrade === 'complete' &&
      clip.topicCoherenceGrade !== 'weak' &&
      clip.transcriptSegmentCount === 2
  ),
  'adjacent bug story planning keeps each emitted bug story complete, coherent, and internally continuous',
);
assertRule(
  sequentialBugStoriesPlan.some((clip) => clip.transcriptText?.includes('retention example')) &&
    sequentialBugStoriesPlan.some((clip) => clip.transcriptText?.includes('activation example')) &&
    sequentialBugStoriesPlan.some((clip) => clip.transcriptText?.includes('setup example')),
  'adjacent bug story planning preserves every natural bug group instead of dropping the first complete bug story',
);
assertRule(
  !sequentialBugStoriesPlan.some((clip) => (clip.transcriptSegmentCount ?? 0) > 2),
  'adjacent bug story planning refuses broad semantic merges that cross explicit bug story openings',
);

const createSequentialGenericHeadingStoriesPlan = (headingNoun) => createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 10,
  maxDuration: 60,
  sourceDurationMs: 120_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 8_000,
    text: `${headingNoun} one: why onboarding retention drops is that the first screen hides the result and the problem is unclear.`,
    speaker: 'Speaker 1',
  },
  {
    startMs: 8_200,
    endMs: 16_000,
    text: 'Because this retention example shows viewer pain, so the fix is to show the outcome first and completion improves.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 16_200,
    endMs: 24_000,
    text: `${headingNoun} two: why activation checklist fails is that the next action is hidden and the problem blocks users.`,
    speaker: 'Speaker 1',
  },
  {
    startMs: 24_200,
    endMs: 32_000,
    text: 'Because this activation example shows user pain, so the solution is to show one next action and conversion improves.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 32_200,
    endMs: 40_000,
    text: `${headingNoun} three: why setup progress fails is that the tutorial hides progress and the problem feels endless.`,
    speaker: 'Speaker 1',
  },
  {
    startMs: 40_200,
    endMs: 48_000,
    text: 'Because this setup example shows user pain, so the fix is to show progress first and confidence improves.',
    speaker: 'Speaker 1',
  },
]);
for (const headingNoun of ['Solution', 'Checklist']) {
  const sequentialGenericHeadingStoriesPlan = createSequentialGenericHeadingStoriesPlan(headingNoun);
  assertEqual(
    sequentialGenericHeadingStoriesPlan.length,
    3,
    `generic enumerated ${headingNoun.toLowerCase()} story planning emits every complete story instead of collapsing natural clip count`,
  );
  assertRule(
    sequentialGenericHeadingStoriesPlan.every((clip) =>
      clip.risks?.includes('semantic-story-merged') &&
        clip.contentArcGrade === 'complete' &&
        clip.topicCoherenceGrade !== 'weak' &&
        clip.transcriptSegmentCount === 2
    ),
    `generic enumerated ${headingNoun.toLowerCase()} story planning keeps every emitted story complete, coherent, and internally continuous`,
  );
  assertRule(
    !sequentialGenericHeadingStoriesPlan.some((clip) => (clip.transcriptSegmentCount ?? 0) > 2),
    `generic enumerated ${headingNoun.toLowerCase()} story planning refuses broad semantic merges that cross explicit enumerated openings`,
  );
}

const coarseSegmentEnumeratedStoriesPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 5,
  maxDuration: 20,
  sourceDurationMs: 24_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 24_000,
    text: [
      'Tip one: why onboarding retention drops is that the first screen hides the result and the problem is unclear.',
      'Because this retention example shows viewer pain, so the fix is to show the outcome first and completion improves.',
      'Tip two: why activation checklist fails is that the next action is hidden and the problem blocks users.',
      'Because this activation example shows user pain, so the solution is to show one next action and conversion improves.',
      'Tip three: why setup progress fails is that the tutorial hides progress and the problem feels endless.',
      'Because this setup example shows user pain, so the fix is to show progress first and confidence improves.',
    ].join(' '),
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  coarseSegmentEnumeratedStoriesPlan.length,
  3,
  'coarse STT segment planning splits multiple enumerated complete stories instead of returning an empty or single collapsed plan',
);
assertRule(
  coarseSegmentEnumeratedStoriesPlan.every((clip) =>
    clip.risks?.includes('semantic-story-merged') &&
      clip.contentArcGrade === 'complete' &&
      clip.topicCoherenceGrade !== 'weak' &&
      clip.transcriptSegmentCount === 2
  ),
  'coarse STT segment planning keeps each emitted story complete, coherent, and internally continuous',
);
assertRule(
  coarseSegmentEnumeratedStoriesPlan.some((clip) => clip.transcriptText?.includes('retention example')) &&
    coarseSegmentEnumeratedStoriesPlan.some((clip) => clip.transcriptText?.includes('activation example')) &&
    coarseSegmentEnumeratedStoriesPlan.some((clip) => clip.transcriptText?.includes('setup example')),
  'coarse STT segment planning preserves every natural story group from a single transcript segment',
);
assertRule(
  !coarseSegmentEnumeratedStoriesPlan.some((clip) => (clip.transcriptSegmentCount ?? 0) > 2),
  'coarse STT segment planning refuses broad semantic merges across enumerated story openings',
);

const unpunctuatedCoarseSegmentEnumeratedStoriesPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 5,
  maxDuration: 20,
  sourceDurationMs: 24_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 24_000,
    text: [
      'Tip one why onboarding retention drops is that the first screen hides the result and the problem is unclear because this retention example shows viewer pain so the fix is to show the outcome first and completion improves',
      'Tip two why activation checklist fails is that the next action is hidden and the problem blocks users because this activation example shows user pain so the solution is to show one next action and conversion improves',
      'Tip three why setup progress fails is that the tutorial hides progress and the problem feels endless because this setup example shows user pain so the fix is to show progress first and confidence improves',
    ].join(' '),
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  unpunctuatedCoarseSegmentEnumeratedStoriesPlan.length,
  3,
  'unpunctuated coarse STT segment planning splits multiple enumerated stories instead of depending on sentence punctuation',
);
assertRule(
  unpunctuatedCoarseSegmentEnumeratedStoriesPlan.every((clip) =>
    clip.contentArcGrade === 'complete' &&
      clip.topicCoherenceGrade !== 'weak' &&
      clip.transcriptSegmentCount <= 2
  ),
  'unpunctuated coarse STT segment planning keeps each emitted story complete, coherent, and compact',
);
assertRule(
  unpunctuatedCoarseSegmentEnumeratedStoriesPlan.some((clip) => clip.transcriptText?.includes('retention example')) &&
    unpunctuatedCoarseSegmentEnumeratedStoriesPlan.some((clip) => clip.transcriptText?.includes('activation example')) &&
    unpunctuatedCoarseSegmentEnumeratedStoriesPlan.some((clip) => clip.transcriptText?.includes('setup example')),
  'unpunctuated coarse STT segment planning preserves every natural story group from one punctuation-free transcript segment',
);

const unpunctuatedGenericHeadingCoarseStoriesPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 5,
  maxDuration: 20,
  sourceDurationMs: 24_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 24_000,
    text: [
      'Solution one: onboarding retention drops because the first screen hides the result and the problem is unclear because this retention example shows viewer pain so the fix is to show the outcome first and completion improves',
      'Solution two: activation checklist fails because the next action is hidden and the problem blocks users because this activation example shows user pain so the solution is to show one next action and conversion improves',
      'Solution three: setup progress fails because the tutorial hides progress and the problem feels endless because this setup example shows user pain so the fix is to show progress first and confidence improves',
    ].join(' '),
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  unpunctuatedGenericHeadingCoarseStoriesPlan.length,
  3,
  'unpunctuated generic-heading coarse STT planning treats enumerated headings as story hooks instead of dropping complete stories',
);
assertRule(
  unpunctuatedGenericHeadingCoarseStoriesPlan.every((clip) =>
    clip.contentArcGrade === 'complete' &&
      clip.storyShape === 'complete' &&
      clip.topicCoherenceGrade !== 'weak' &&
      clip.transcriptSegmentCount <= 2
  ),
  'unpunctuated generic-heading coarse STT planning keeps each emitted heading story complete, coherent, and compact',
);
assertRule(
  unpunctuatedGenericHeadingCoarseStoriesPlan.some((clip) => clip.transcriptText?.includes('retention example')) &&
    unpunctuatedGenericHeadingCoarseStoriesPlan.some((clip) => clip.transcriptText?.includes('activation example')) &&
    unpunctuatedGenericHeadingCoarseStoriesPlan.some((clip) => clip.transcriptText?.includes('setup example')),
  'unpunctuated generic-heading coarse STT planning preserves every natural heading story group',
);

const ordinalOnlyEnumeratedStoriesText = [
  'First, why onboarding retention drops is that the first screen hides the result because this retention example shows viewer pain so the fix is to show the outcome first and completion improves.',
  'Second, why activation checklist fails is that the next action is hidden because this activation example shows user pain so the solution is to show one next action and conversion improves.',
  'Third, why setup progress fails is that the tutorial hides progress because this setup example shows user pain so the fix is to show progress first and confidence improves.',
].join(' ');
const ordinalOnlyEnumeratedStoriesPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 5,
  maxDuration: 20,
  sourceDurationMs: 30_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 30_000,
    text: ordinalOnlyEnumeratedStoriesText,
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  ordinalOnlyEnumeratedStoriesPlan.length,
  3,
  'ordinal-only coarse STT planning splits first-second-third stories instead of returning an empty plan',
);
assertRule(
  ordinalOnlyEnumeratedStoriesPlan.every((clip) =>
    clip.contentArcGrade === 'complete' &&
      clip.storyShape === 'complete' &&
      clip.topicCoherenceGrade !== 'weak' &&
      clip.transcriptSegmentCount <= 2
  ),
  'ordinal-only coarse STT planning keeps each emitted enumerated story complete, coherent, and compact',
);
assertRule(
  ordinalOnlyEnumeratedStoriesPlan.some((clip) => clip.transcriptText?.startsWith('First')) &&
    ordinalOnlyEnumeratedStoriesPlan.some((clip) => clip.transcriptText?.startsWith('Second')) &&
    ordinalOnlyEnumeratedStoriesPlan.some((clip) => clip.transcriptText?.startsWith('Third')),
  'ordinal-only coarse STT planning preserves every first-second-third story opening',
);

const unpunctuatedOrdinalOnlyStoriesText = [
  'First why onboarding retention drops is that the first screen hides the result because this retention example shows viewer pain so the fix is to show the outcome first and completion improves',
  'Second why activation checklist fails is that the next action is hidden because this activation example shows user pain so the solution is to show one next action and conversion improves',
  'Third why setup progress fails is that the tutorial hides progress because this setup example shows user pain so the fix is to show progress first and confidence improves',
].join(' ');
const unpunctuatedOrdinalOnlyPlanningSegments = normalizeSmartSliceTranscriptSegmentsForPlanning([
  {
    startMs: 0,
    endMs: 30_000,
    text: unpunctuatedOrdinalOnlyStoriesText,
    speaker: 'Speaker 1',
  },
]);
const unpunctuatedOrdinalOnlyStoriesPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 5,
  maxDuration: 20,
  sourceDurationMs: 30_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 30_000,
    text: unpunctuatedOrdinalOnlyStoriesText,
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  unpunctuatedOrdinalOnlyPlanningSegments.length,
  3,
  'unpunctuated ordinal-only normalization splits first-second-third stories without relying on punctuation',
);
assertEqual(
  unpunctuatedOrdinalOnlyStoriesPlan.length,
  3,
  'unpunctuated ordinal-only coarse STT planning emits every first-second-third story instead of returning an empty plan',
);
assertRule(
  unpunctuatedOrdinalOnlyStoriesPlan.every((clip) =>
    clip.contentArcGrade === 'complete' &&
      clip.storyShape === 'complete' &&
      clip.topicCoherenceGrade !== 'weak' &&
      clip.transcriptSegmentCount <= 2
  ),
  'unpunctuated ordinal-only coarse STT planning keeps every emitted story complete, coherent, and compact',
);
assertRule(
  unpunctuatedOrdinalOnlyStoriesPlan.some((clip) => clip.transcriptText?.startsWith('First')) &&
    unpunctuatedOrdinalOnlyStoriesPlan.some((clip) => clip.transcriptText?.startsWith('Second')) &&
    unpunctuatedOrdinalOnlyStoriesPlan.some((clip) => clip.transcriptText?.startsWith('Third')),
  'unpunctuated ordinal-only coarse STT planning preserves every ordinal story opening',
);

const adverbialOrdinalStoriesText = [
  'Firstly why onboarding retention drops is that the first screen hides the result because this retention example shows viewer pain so the fix is to show the outcome first and completion improves',
  'Secondly why activation checklist fails is that the next action is hidden because this activation example shows user pain so the solution is to show one next action and conversion improves',
  'Finally why setup progress fails is that the tutorial hides progress because this setup example shows user pain so the fix is to show progress first and confidence improves',
].join(' ');
const adverbialOrdinalStoriesPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 5,
  maxDuration: 20,
  sourceDurationMs: 30_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 30_000,
    text: adverbialOrdinalStoriesText,
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  adverbialOrdinalStoriesPlan.length,
  3,
  'adverbial ordinal coarse STT planning splits firstly-secondly-finally stories instead of returning an empty plan',
);
assertRule(
  adverbialOrdinalStoriesPlan.every((clip) =>
    clip.contentArcGrade === 'complete' &&
      clip.storyShape === 'complete' &&
      clip.topicCoherenceGrade !== 'weak' &&
      clip.transcriptSegmentCount <= 2
  ),
  'adverbial ordinal coarse STT planning keeps each emitted story complete, coherent, and compact',
);
assertRule(
  adverbialOrdinalStoriesPlan.some((clip) => clip.transcriptText?.startsWith('Firstly')) &&
    adverbialOrdinalStoriesPlan.some((clip) => clip.transcriptText?.startsWith('Secondly')) &&
    adverbialOrdinalStoriesPlan.some((clip) => clip.transcriptText?.startsWith('Finally')),
  'adverbial ordinal coarse STT planning preserves every firstly-secondly-finally story opening',
);

const numberWordEnumeratedStoriesText = [
  'Number one why onboarding retention drops is that the first screen hides the result because this retention example shows viewer pain so the fix is to show the outcome first and completion improves',
  'Number two why activation checklist fails is that the next action is hidden because this activation example shows user pain so the solution is to show one next action and conversion improves',
  'Number three why setup progress fails is that the tutorial hides progress because this setup example shows user pain so the fix is to show progress first and confidence improves',
].join(' ');
const numberWordEnumeratedStoriesPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 5,
  maxDuration: 20,
  sourceDurationMs: 30_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 30_000,
    text: numberWordEnumeratedStoriesText,
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  numberWordEnumeratedStoriesPlan.length,
  3,
  'number-word coarse STT planning splits number-one-two-three stories instead of returning an empty plan',
);
assertRule(
  numberWordEnumeratedStoriesPlan.every((clip) =>
    clip.contentArcGrade === 'complete' &&
      clip.storyShape === 'complete' &&
      clip.topicCoherenceGrade !== 'weak' &&
      clip.transcriptSegmentCount <= 2
  ),
  'number-word coarse STT planning keeps every emitted story complete, coherent, and compact',
);
assertRule(
  numberWordEnumeratedStoriesPlan.some((clip) => clip.transcriptText?.startsWith('Number one')) &&
    numberWordEnumeratedStoriesPlan.some((clip) => clip.transcriptText?.startsWith('Number two')) &&
    numberWordEnumeratedStoriesPlan.some((clip) => clip.transcriptText?.startsWith('Number three')),
  'number-word coarse STT planning preserves every number-one-two-three story opening',
);

const numericEnumeratedStoriesText = [
  '1 why onboarding retention drops is that the first screen hides the result because this retention example shows viewer pain so the fix is to show the outcome first and completion improves',
  '2 why activation checklist fails is that the next action is hidden because this activation example shows user pain so the solution is to show one next action and conversion improves',
  '3 why setup progress fails is that the tutorial hides progress because this setup example shows user pain so the fix is to show progress first and confidence improves',
].join(' ');
const numericEnumeratedPlanningSegments = normalizeSmartSliceTranscriptSegmentsForPlanning([
  {
    startMs: 0,
    endMs: 30_000,
    text: numericEnumeratedStoriesText,
    speaker: 'Speaker 1',
  },
]);
const numericEnumeratedStoriesPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 5,
  maxDuration: 20,
  sourceDurationMs: 30_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 30_000,
    text: numericEnumeratedStoriesText,
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  numericEnumeratedPlanningSegments.length,
  3,
  'numeric-list normalization splits 1-2-3 stories when each number starts a content story',
);
assertEqual(
  numericEnumeratedStoriesPlan.length,
  3,
  'numeric-list coarse STT planning emits every 1-2-3 story instead of returning an empty plan',
);
assertRule(
  numericEnumeratedStoriesPlan.every((clip) =>
    clip.contentArcGrade === 'complete' &&
      clip.storyShape === 'complete' &&
      clip.topicCoherenceGrade !== 'weak' &&
      clip.transcriptSegmentCount <= 2
  ),
  'numeric-list coarse STT planning keeps every emitted story complete, coherent, and compact',
);

const digitOrdinalEnumeratedStoriesText = [
  '1st why onboarding retention drops is that the first screen hides the result because this retention example shows viewer pain so the fix is to show the outcome first and completion improves',
  '2nd why activation checklist fails is that the next action is hidden because this activation example shows user pain so the solution is to show one next action and conversion improves',
  '3rd why setup progress fails is that the tutorial hides progress because this setup example shows user pain so the fix is to show progress first and confidence improves',
].join(' ');
const digitOrdinalEnumeratedStoriesPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 5,
  maxDuration: 20,
  sourceDurationMs: 30_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 30_000,
    text: digitOrdinalEnumeratedStoriesText,
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  digitOrdinalEnumeratedStoriesPlan.length,
  3,
  'digit-ordinal coarse STT planning splits 1st-2nd-3rd stories instead of returning an empty plan',
);
assertRule(
  digitOrdinalEnumeratedStoriesPlan.every((clip) =>
    clip.contentArcGrade === 'complete' &&
      clip.storyShape === 'complete' &&
      clip.topicCoherenceGrade !== 'weak' &&
      clip.transcriptSegmentCount <= 2
  ),
  'digit-ordinal coarse STT planning keeps every emitted story complete, coherent, and compact',
);

const hashEnumeratedStoriesText = [
  '#1 why onboarding retention drops is that the first screen hides the result because this retention example shows viewer pain so the fix is to show the outcome first and completion improves',
  '#2 why activation checklist fails is that the next action is hidden because this activation example shows user pain so the solution is to show one next action and conversion improves',
  '#3 why setup progress fails is that the tutorial hides progress because this setup example shows user pain so the fix is to show progress first and confidence improves',
].join(' ');
const hashEnumeratedStoriesPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 5,
  maxDuration: 20,
  sourceDurationMs: 30_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 30_000,
    text: hashEnumeratedStoriesText,
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  hashEnumeratedStoriesPlan.length,
  3,
  'hash-number coarse STT planning splits #1-#2-#3 stories instead of returning an empty plan',
);
assertRule(
  hashEnumeratedStoriesPlan.every((clip) =>
    clip.contentArcGrade === 'complete' &&
      clip.storyShape === 'complete' &&
      clip.topicCoherenceGrade !== 'weak' &&
      clip.transcriptSegmentCount <= 2
  ),
  'hash-number coarse STT planning keeps every emitted story complete, coherent, and compact',
);

const noDotEnumeratedStoriesText = [
  'No. 1 why onboarding retention drops is that the first screen hides the result because this retention example shows viewer pain so the fix is to show the outcome first and completion improves',
  'No. 2 why activation checklist fails is that the next action is hidden because this activation example shows user pain so the solution is to show one next action and conversion improves',
  'No. 3 why setup progress fails is that the tutorial hides progress because this setup example shows user pain so the fix is to show progress first and confidence improves',
].join(' ');
const noDotEnumeratedPlanningSegments = normalizeSmartSliceTranscriptSegmentsForPlanning([
  {
    startMs: 0,
    endMs: 30_000,
    text: noDotEnumeratedStoriesText,
    speaker: 'Speaker 1',
  },
]);
const noDotEnumeratedStoriesPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 5,
  maxDuration: 20,
  sourceDurationMs: 30_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 30_000,
    text: noDotEnumeratedStoriesText,
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  noDotEnumeratedPlanningSegments.length,
  3,
  'no-dot numeric normalization keeps No. 1 / No. 2 / No. 3 headings intact instead of splitting after No.',
);
assertEqual(
  noDotEnumeratedStoriesPlan.length,
  3,
  'no-dot numeric coarse STT planning emits every No. 1 / No. 2 / No. 3 story',
);

const letterEnumeratedStoriesText = [
  'A why onboarding retention drops is that the first screen hides the result because this retention example shows viewer pain so the fix is to show the outcome first and completion improves',
  'B why activation checklist fails is that the next action is hidden because this activation example shows user pain so the solution is to show one next action and conversion improves',
  'C why setup progress fails is that the tutorial hides progress because this setup example shows user pain so the fix is to show progress first and confidence improves',
].join(' ');
const letterEnumeratedStoriesPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 5,
  maxDuration: 20,
  sourceDurationMs: 30_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 30_000,
    text: letterEnumeratedStoriesText,
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  letterEnumeratedStoriesPlan.length,
  3,
  'letter-list coarse STT planning splits A-B-C stories instead of returning an empty plan',
);
assertRule(
  letterEnumeratedStoriesPlan.every((clip) =>
    clip.contentArcGrade === 'complete' &&
      clip.storyShape === 'complete' &&
      clip.topicCoherenceGrade !== 'weak' &&
      clip.transcriptSegmentCount <= 2
  ),
  'letter-list coarse STT planning keeps every emitted story complete, coherent, and compact',
);

const partLetterEnumeratedStoriesText = [
  'Part A why onboarding retention drops is that the first screen hides the result because this retention example shows viewer pain so the fix is to show the outcome first and completion improves',
  'Part B why activation checklist fails is that the next action is hidden because this activation example shows user pain so the solution is to show one next action and conversion improves',
  'Part C why setup progress fails is that the tutorial hides progress because this setup example shows user pain so the fix is to show progress first and confidence improves',
].join(' ');
const partLetterEnumeratedStoriesPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 5,
  maxDuration: 20,
  sourceDurationMs: 30_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 30_000,
    text: partLetterEnumeratedStoriesText,
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  partLetterEnumeratedStoriesPlan.length,
  3,
  'part-letter coarse STT planning splits Part A-B-C stories instead of returning an empty plan',
);
assertRule(
  partLetterEnumeratedStoriesPlan.every((clip) =>
    clip.contentArcGrade === 'complete' &&
      clip.storyShape === 'complete' &&
      clip.topicCoherenceGrade !== 'weak' &&
      clip.transcriptSegmentCount <= 2
  ),
  'part-letter coarse STT planning keeps every emitted story complete, coherent, and compact',
);

const optionLetterEnumeratedStoriesText = [
  'Option A why onboarding retention drops is that the first screen hides the result because this retention example shows viewer pain so the fix is to show the outcome first and completion improves',
  'Option B why activation checklist fails is that the next action is hidden because this activation example shows user pain so the solution is to show one next action and conversion improves',
  'Option C why setup progress fails is that the tutorial hides progress because this setup example shows user pain so the fix is to show progress first and confidence improves',
].join(' ');
const optionLetterEnumeratedStoriesPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 5,
  maxDuration: 20,
  sourceDurationMs: 30_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 30_000,
    text: optionLetterEnumeratedStoriesText,
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  optionLetterEnumeratedStoriesPlan.length,
  3,
  'option-letter coarse STT planning splits Option A-B-C stories instead of returning an empty plan',
);
assertRule(
  optionLetterEnumeratedStoriesPlan.every((clip) =>
    clip.contentArcGrade === 'complete' &&
      clip.storyShape === 'complete' &&
      clip.topicCoherenceGrade !== 'weak' &&
      clip.transcriptSegmentCount <= 2
  ),
  'option-letter coarse STT planning keeps every emitted story complete, coherent, and compact',
);

const unnumberedWhyBecauseSoCoarseStoriesPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 5,
  maxDuration: 30,
  sourceDurationMs: 72_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 72_000,
    text: [
      'Why do viewers leave after the first screen?',
      'Because the opening promises a result but the next shot explains setup instead.',
      'So move the result preview before the context and retention improves.',
      'Why do trials fail after signup?',
      'Because the first checklist asks for optional profile details before the core action.',
      'So move the activation action first and completion improves.',
      'Why does onboarding support volume spike?',
      'Because the setup email hides the one required permission.',
      'So show that permission first and setup tickets drop.',
    ].join(' '),
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  unnumberedWhyBecauseSoCoarseStoriesPlan.length,
  3,
  'unnumbered coarse STT planning emits every repeated why-because-so story when each natural story fits duration limits',
);
assertRule(
  unnumberedWhyBecauseSoCoarseStoriesPlan.every((clip) =>
    clip.contentArcGrade === 'complete' &&
      clip.storyShape === 'complete' &&
      clip.topicCoherenceGrade !== 'weak' &&
      clip.transcriptSegmentCount === 3 &&
      /^Why\b/.test(clip.transcriptText ?? '') &&
      /\bBecause\b/.test(clip.transcriptText ?? '') &&
      /\bSo\b/.test(clip.transcriptText ?? '')
  ),
  'unnumbered coarse STT planning preserves the hook, setup, and payoff inside each repeated story instead of starting clips at because',
);
assertRule(
  unnumberedWhyBecauseSoCoarseStoriesPlan.some((clip) => clip.transcriptText?.includes('retention improves')) &&
    unnumberedWhyBecauseSoCoarseStoriesPlan.some((clip) => clip.transcriptText?.includes('completion improves')) &&
    unnumberedWhyBecauseSoCoarseStoriesPlan.some((clip) => clip.transcriptText?.includes('setup tickets drop')),
  'unnumbered coarse STT planning preserves every repeated story payoff',
);

const zhTranscript = (value) => JSON.parse(`"${value}"`);
const chinesePromiseOnlyPayoffSegments = [
  [0, 12_000, '\\u6700\\u5feb\\u4e09\\u4e2a\\u6708\\u5c31\\u80fd\\u5e26\\u7740\\u5bb6\\u4eba\\u5408\\u6cd5\\u5165\\u5883'],
  [12_200, 24_000, '\\u957f\\u671f\\u7684\\u8f7b\\u677e\\u81ea\\u5728\\u7684\\u751f\\u6d3b\\uff0c\\u91cd\\u56de\\u4f60\\u719f\\u6089\\u7684\\u7f8e\\u56fd\\u751f\\u6d3b'],
].map(([startMs, endMs, text]) => ({
  startMs,
  endMs,
  text: zhTranscript(text),
  speaker: 'Speaker 1',
}));
const chinesePromiseOnlyPayoffCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 10,
  maxDuration: 40,
  sourceDurationMs: 40_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, chinesePromiseOnlyPayoffSegments);
const chinesePromiseOnlyPayoffPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 10,
  maxDuration: 40,
  sourceDurationMs: 40_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, chinesePromiseOnlyPayoffSegments);
assertRule(
  chinesePromiseOnlyPayoffCandidates.some((candidate) =>
    candidate.candidateId === 'content-topic-1-2' &&
      candidate.contentArcStages?.includes('payoff') &&
      candidate.contentArcStages?.includes('setup')
  ),
  'Chinese promise-only regression fixture exercises a content-topic candidate that looks superficially complete',
);
assertEqual(
  chinesePromiseOnlyPayoffPlan.length,
  0,
  'Chinese marketing promise-only topic fragments are not published without application or context setup',
);
const chineseTransitionBenefitOnlySparseSegments = [
  [0, 12_000, '\\u540c\\u65f6\\u7ed9\\u81ea\\u5df1\\u7559\\u8db3\\u957f\\u671f\\u7684\\u53d1\\u5c55\\u6761\\u4ef6'],
  [12_200, 24_000, '\\u957f\\u671f\\u7684\\u8f7b\\u677e\\u81ea\\u5728\\u7684\\u751f\\u6d3b\\uff0c\\u91cd\\u56de\\u4f60\\u719f\\u6089\\u7684\\u7f8e\\u56fd\\u751f\\u6d3b'],
].map(([startMs, endMs, text]) => ({
  startMs,
  endMs,
  text: zhTranscript(text),
  speaker: 'Speaker 1',
}));
const chineseTransitionBenefitOnlySparsePlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 10,
  maxDuration: 45,
  sourceDurationMs: 60_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, chineseTransitionBenefitOnlySparseSegments);
assertRule(
  chineseTransitionBenefitOnlySparsePlan.every((clip) => clip.risks?.includes('sparse-transcript-speech')),
  'Chinese transition-benefit regression fixture exercises the sparse fallback release path',
);
assertEqual(
  chineseTransitionBenefitOnlySparsePlan.length,
  0,
  'Chinese marketing transition-benefit sparse fragments are not published as standalone clips',
);
const chineseSetupOnlyMarketingTopicSegments = [
  [0, 12_000, '\\u53ea\\u8981\\u4f60\\u6709\\u4e00\\u5b9a\\u7684\\u884c\\u4e1a\\u7ecf\\u9a8c\\u3002'],
  [12_200, 24_000, '\\u8fd9\\u6761\\u8def\\u5f84\\u9002\\u5408\\u60f3\\u957f\\u671f\\u5728\\u7f8e\\u56fd\\u751f\\u6d3b\\u7684\\u4eba\\u3002'],
].map(([startMs, endMs, text]) => ({
  startMs,
  endMs,
  text: zhTranscript(text),
  speaker: 'Speaker 1',
}));
const chineseSetupOnlyMarketingTopicCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 10,
  maxDuration: 45,
  sourceDurationMs: 60_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, chineseSetupOnlyMarketingTopicSegments);
const chineseSetupOnlyMarketingTopicPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 10,
  maxDuration: 45,
  sourceDurationMs: 60_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, chineseSetupOnlyMarketingTopicSegments);
assertRule(
  chineseSetupOnlyMarketingTopicCandidates.some((candidate) =>
    candidate.candidateId === 'content-topic-1-2' &&
      !candidate.contentArcStages?.includes('payoff') &&
      candidate.endingCompleteness === 'soft'
  ),
  'Chinese setup-only marketing regression fixture exercises a non-open content-topic candidate without payoff',
);
assertEqual(
  chineseSetupOnlyMarketingTopicPlan.length,
  0,
  'Chinese setup-only marketing topic fragments are not published without a payoff',
);
const wenan5RealTranscriptSegments = [
  [0, 9_900, '\\u806a\\u660e\\u7684\\u7f8e\\u56fd\\u7559\\u5b66\\u6d77\\u5f52\\u518d\\u53bb\\u7f8e\\u56fd\\u751f\\u6d3b'],
  [9_900, 14_360, '\\u65e9\\u5c31\\u4e0d\\u6324\\u7559\\u5b66\\u7b7e'],
  [14_360, 17_440, '\\u65e9\\u5c31\\u4e0d\\u4f1a\\u518d\\u53bb\\u6324\\u82e6\\u903c\\u7684\\u7559\\u5b66\\u7b7e'],
  [17_440, 22_600, '\\u4e5f\\u522b\\u53bb\\u5e7b\\u60f3\\u5c3d\\u4e2d\\u8d8a\\u7684\\u5de5\\u94b1\\u4e86'],
  [22_600, 29_980, '\\u806a\\u660e\\u7684\\u7f8e\\u56fd\\u7559\\u5b66\\u6d77\\u5f52\\u60f3\\u518d\\u53bb\\u7f8e\\u56fd\\u751f\\u6d3b'],
  [30_000, 34_400, '\\u4e0d\\u4f1a\\u518d\\u53bb\\u6324\\u82e6\\u903c\\u7684\\u7559\\u5b66\\u7b7e'],
  [34_400, 36_760, '\\u66f4\\u52a0\\u4e0d\\u4f1a\\u53bb'],
  [36_760, 40_080, '\\u66f4\\u52a0\\u4e0d\\u4f1a\\u6401\\u7740\\u811a\\u53bb\\u8df3'],
  [40_080, 43_760, '\\u5c3d\\u4e2d\\u8d8a\\u7684\\u5de5\\u94b1'],
  [57_340, 66_300, '\\u4ed6\\u4eec\\u4f1a\\u7528\\u8fd9\\u4e07\\u8bbf\\u5b66\\u7684\\u8def\\u5f84\\u7ed9\\u81ea\\u5df1\\u548c\\u5bb6\\u4eba\\u94fa\\u5c31\\u4e00\\u6761\\u901a\\u5411\\u7f8e\\u56fd\\u7684\\u5934\\u7b49\\u8231\\u673a\\u7968'],
  [66_300, 78_060, '\\u6211\\u505a\\u7f8e\\u56fd\\u8bbf\\u5b6616\\u5e74\\u5e2e\\u52a9\\u51e0\\u767e\\u4f4d\\u7f8e\\u56fd\\u7559\\u5b66\\u6d77\\u5f52'],
  [78_060, 80_140, '\\u5e2e\\u52a9'],
  [80_140, 86_300, '\\u6211\\u505a\\u7f8e\\u56fd\\u8bbf\\u5b6616\\u5e74\\u5e2e\\u52a9\\u51e0\\u767e\\u4f4d\\u6d77\\u5f52\\u91cd\\u65b0\\u6740\\u56de\\u7f8e\\u56fd'],
  [86_300, 93_300, '\\u8fd9\\u4e07\\u8bbf\\u5b66\\u4e0d\\u780d\\u4f60\\u7684\\u6bd5\\u4e1a\\u8fde\\u7ebf'],
  [93_300, 98_700, '\\u53ea\\u8981\\u4f60\\u6709\\u4e00\\u5b9a\\u7684\\u884c\\u4e1a\\u7ecf\\u9a8c'],
  [98_700, 102_980, '\\u53ea\\u8981\\u4f60\\u6709\\u4e00\\u5b9a\\u7684\\u884c\\u4e1a\\u7ecf\\u9a8c\\u5c31\\u80fd\\u7533\\u8bf7'],
  [102_980, 107_940, '\\u6700\\u5feb\\u4e09\\u4e2a\\u6708\\u5e26\\u7740\\u5bb6\\u4eba\\u4e00\\u8d77\\u53bb\\u7f8e\\u56fd'],
  [107_940, 109_300, '\\u957f\\u671f\\u7684\\u5408\\u6cd5'],
  [109_300, 111_940, '\\u5e26\\u7740\\u5bb6\\u4eba\\u4e00\\u8d77\\u53bb\\u7f8e\\u56fd'],
  [111_940, 115_060, '\\u957f\\u671f\\u7684\\u8f7b\\u677e\\u81ea\\u5728\\u7684\\u751f\\u6d3b'],
  [115_060, 125_900, '\\u6700\\u5feb\\u4e09\\u4e2a\\u6708\\u5c31\\u80fd\\u5e26\\u7740\\u5bb6\\u4eba\\u5408\\u6cd5\\u5165\\u5883'],
  [125_900, 128_900, '\\u91cd\\u56de\\u4f60\\u719f\\u6089\\u7684\\u7f8e\\u56fd\\u751f\\u6d3b'],
  [128_900, 131_900, '\\u540c\\u65f6\\u7ed9\\u81ea\\u5df1\\u7559\\u8db3'],
  [131_900, 136_500, '\\u540c\\u65f6\\u7ed9\\u81ea\\u5df1\\u7559\\u8db3\\u957f\\u671f\\u7684\\u53d1\\u5c55\\u56f0\\u4ef6'],
  [136_500, 148_740, '\\u5f88\\u591a\\u4eba\\u89c9\\u5f97\\u56de\\u7f8e\\u56fd\\u5c31\\u8981\\u5148\\u653e\\u5f03\\u56fd\\u5185\\u7684\\u4e00\\u5207\\u8d4c\\u4e00\\u628a'],
  [148_740, 153_940, '\\u6211\\u544a\\u8bc9\\u4f60\\u9ad8\\u8ba4\\u77e5\\u7684\\u6d77\\u5f52'],
  [156_060, 160_060, '\\u5c31\\u662f\\u5148\\u7ed9\\u81ea\\u5df1\\u548c\\u5bb6\\u4eba\\u62ff\\u4e00\\u5f20'],
  [160_060, 162_420, '\\u5c31\\u662f\\u5148\\u7ed9\\u81ea\\u5df1\\u548c\\u5bb6\\u4eba\\u62ff\\u4e00\\u5f20'],
  [162_420, 164_660, '\\u5c3d\\u53ef\\u653b\\u9000\\u53ef\\u626f\\u7684\\u5165\\u573a\\u5238'],
  [164_660, 171_860, '\\u8fd9\\u5176\\u5b9e\\u633a\\u5570\\u55e6\\u7684'],
  [171_860, 174_620, '\\u4f60\\u60f3\\u957f\\u671f\\u5728\\u7f8e\\u56fd\\u751f\\u6d3b'],
  [174_620, 178_100, '\\u8fd9\\u5176\\u5b9e\\u633a\\u5570\\u55e6\\u7684'],
  [178_100, 179_340, '\\u7b97\\u4e86\\u6211\\u91cd\\u65b0\\u5f55\\u5427'],
  [179_340, 180_300, '\\u8fd9\\u4e9b\\u6211\\u91cd\\u65b0\\u5f55\\u5427'],
  [180_300, 182_340, '\\u6211\\u81ea\\u4e8e\\u53d1\\u6325\\u4e00\\u4e0b'],
].map(([startMs, endMs, text]) => ({
  startMs,
  endMs,
  text: zhTranscript(text),
  speaker: 'Speaker 1',
}));
const wenan5RealTranscriptParams = {
  ...baseParams,
  minDuration: 15,
  maxDuration: 60,
  sourceDurationMs: 182_360,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
};
const wenan5RealTranscriptCandidates = buildTranscriptSliceCandidates(
  wenan5RealTranscriptParams,
  wenan5RealTranscriptSegments,
);
const wenan5RealTranscriptPlan = createTranscriptAssistedSlicePlan(
  wenan5RealTranscriptParams,
  wenan5RealTranscriptSegments,
);
assertRule(
  wenan5RealTranscriptPlan.length >= 3,
  `real Chinese marketing video transcript planning emits multiple clips instead of ${wenan5RealTranscriptPlan.length}`,
);
assertRule(
  wenan5RealTranscriptPlan.every((clip) => clip.durationMs >= 15_000 && clip.durationMs <= 60_000),
  'real Chinese marketing video transcript planning keeps every emitted clip within requested duration limits',
);
assertRule(
  wenan5RealTranscriptPlan.every((clip) =>
    clip.risks?.includes('transcript-coverage-repaired') ||
      clip.contentArcGrade === 'complete' ||
      (
        Array.isArray(clip.contentArcStages) &&
        clip.contentArcStages.includes('payoff') &&
        clip.endingCompleteness !== 'open'
      )
  ),
  'real Chinese marketing video transcript planning does not publish open-ended hook/conflict fragments without a payoff',
);
assertRule(
  wenan5RealTranscriptPlan
    .filter((clip) => clip.risks?.includes('transcript-coverage-repaired'))
    .every((clip) => clip.publishabilityGrade === 'review' || clip.platformReadinessGrade === 'review'),
  'real Chinese marketing video transcript planning marks transcript coverage repair clips for review instead of treating them as ready highlights',
);
assertRule(
  wenan5RealTranscriptPlan.every((clip, index, clips) =>
    index === 0 || clip.startMs >= clips[index - 1].startMs + clips[index - 1].durationMs
  ),
  'real Chinese marketing video transcript planning emits non-overlapping clips in timeline order',
);
assertRule(
  wenan5RealTranscriptPlan.some((clip) =>
    clip.transcriptText?.includes(zhTranscript('\\u6700\\u5feb\\u4e09\\u4e2a\\u6708')) &&
      clip.transcriptText?.includes(zhTranscript('\\u957f\\u671f\\u7684\\u8f7b\\u677e\\u81ea\\u5728\\u7684\\u751f\\u6d3b'))
  ) &&
    wenan5RealTranscriptPlan.some((clip) =>
      clip.transcriptText?.includes(zhTranscript('\\u5165\\u573a\\u5238'))
  ),
  'real Chinese marketing video transcript planning preserves complete three-month family entry and fallback ticket story beats',
);
assertRule(
  wenan5RealTranscriptPlan.some((clip) =>
    clip.transcriptText?.includes(zhTranscript('\\u53ea\\u8981\\u4f60\\u6709\\u4e00\\u5b9a\\u7684\\u884c\\u4e1a\\u7ecf\\u9a8c\\u5c31\\u80fd\\u7533\\u8bf7')) &&
      clip.transcriptText?.includes(zhTranscript('\\u6700\\u5feb\\u4e09\\u4e2a\\u6708'))
  ),
  'real Chinese marketing video transcript planning keeps the application condition and three-month payoff in one complete continuous clip',
);
assertRule(
  wenan5RealTranscriptPlan.every((clip) =>
    !clip.transcriptText?.includes(zhTranscript('\\u91cd\\u65b0\\u5f55')) &&
      !clip.transcriptText?.includes(zhTranscript('\\u5570\\u55e6')) &&
      !clip.transcriptText?.includes(zhTranscript('\\u81ea\\u4e8e\\u53d1\\u6325'))
  ),
  'real Chinese marketing video transcript planning excludes NG/re-recording tail speech from publishable clips',
);
assertRule(
  wenan5RealTranscriptPlan.every((clip) => (clip.speechEndMs ?? clip.startMs + clip.durationMs) <= 164_860),
  'real Chinese marketing video transcript planning stops before the NG tail begins',
);
assertPlanCoversEveryEligibleTranscriptSegment(
  wenan5RealTranscriptPlan,
  wenan5RealTranscriptSegments,
  'real Chinese marketing video transcript planning covers every eligible non-NG speech-to-text segment before native rendering',
);
const wenan5DesktopUiDefaultTranscriptParams = {
  ...wenan5RealTranscriptParams,
  minDuration: 15,
  maxDuration: 90,
  idealDuration: 45,
  targetPlatform: 'douyin',
  targetAspectRatio: '9:16',
  videoObjectFit: 'cover',
  baseAlgorithm: 'nlp',
  highlightEngine: 'emotion',
  enableNoiseReduction: false,
  enableRepeatFilter: false,
};
const wenan5DesktopUiDefaultTranscriptPlan = createTranscriptAssistedSlicePlan(
  wenan5DesktopUiDefaultTranscriptParams,
  wenan5RealTranscriptSegments,
);
assertRule(
  wenan5DesktopUiDefaultTranscriptPlan.length >= 3,
  `desktop UI default transcript planning emits multiple clips instead of ${wenan5DesktopUiDefaultTranscriptPlan.length}`,
);
assertPlanReadyForNativeRenderLikeUi(
  wenan5DesktopUiDefaultTranscriptPlan,
  wenan5RealTranscriptSegments,
  wenan5DesktopUiDefaultTranscriptParams.sourceDurationMs,
  'desktop UI default transcript planning satisfies native render timing invariants',
);
const wenan5DesktopUiDurationTranscriptParams = {
  ...wenan5RealTranscriptParams,
  minDuration: 30,
  maxDuration: 70,
  idealDuration: 45,
  targetPlatform: 'douyin',
  targetAspectRatio: '9:16',
  videoObjectFit: 'contain',
  baseAlgorithm: 'nlp',
  highlightEngine: 'emotion',
};
const wenan5DesktopUiDurationTranscriptPlan = createTranscriptAssistedSlicePlan(
  wenan5DesktopUiDurationTranscriptParams,
  wenan5RealTranscriptSegments,
);
assertRule(
  wenan5DesktopUiDurationTranscriptPlan.length >= 3,
  `desktop UI duration transcript planning emits multiple clips instead of ${wenan5DesktopUiDurationTranscriptPlan.length}`,
);
assertPlanCoversEveryEligibleTranscriptSegment(
  wenan5DesktopUiDurationTranscriptPlan,
  wenan5RealTranscriptSegments,
  'desktop UI duration transcript planning covers every eligible non-NG speech-to-text segment before native rendering',
);
assertPlanReadyForNativeRenderLikeUi(
  wenan5DesktopUiDurationTranscriptPlan,
  wenan5RealTranscriptSegments,
  wenan5DesktopUiDurationTranscriptParams.sourceDurationMs,
  'desktop UI duration transcript planning satisfies native render timing invariants',
);
assertRule(
  wenan5DesktopUiDurationTranscriptPlan.some((clip) =>
    clip.transcriptText?.includes(zhTranscript('\\u4ed6\\u4eec\\u4f1a\\u7528\\u8fd9\\u4e07\\u8bbf\\u5b66\\u7684\\u8def\\u5f84')) &&
      clip.transcriptText?.includes(zhTranscript('\\u8fd9\\u4e07\\u8bbf\\u5b66\\u4e0d\\u780d\\u4f60\\u7684\\u6bd5\\u4e1a\\u8fde\\u7ebf'))
  ),
  'desktop UI duration transcript planning keeps the 57s-93s visitor-scholar story window renderable',
);
assertRule(
  wenan5DesktopUiDurationTranscriptPlan.some((clip) =>
    clip.transcriptText?.includes(zhTranscript('\\u5c3d\\u53ef\\u653b\\u9000\\u53ef\\u626f\\u7684\\u5165\\u573a\\u5238'))
  ),
  'desktop UI duration transcript planning keeps the final fallback ticket sentence renderable',
);
const wenan5SingleCandidateLlmPlan = parseLlmSlicePlan(
  JSON.stringify([
    {
      candidateId: 'semantic-story-10-13',
      title: 'Model selected one middle story only',
      reason: 'This reproduces a weak LLM response that would previously collapse the task to one clip.',
    },
  ]),
  wenan5RealTranscriptParams,
  wenan5RealTranscriptPlan,
  wenan5RealTranscriptCandidates,
);
assertEqual(
  wenan5SingleCandidateLlmPlan.length,
  wenan5RealTranscriptPlan.length,
  'real Chinese marketing LLM planning cannot collapse deterministic multi-clip output to one selected candidate',
);
assertRule(
  wenan5RealTranscriptPlan.every((fallbackClip) =>
    wenan5SingleCandidateLlmPlan.some((llmClip) =>
      llmClip.candidateId === fallbackClip.candidateId &&
        llmClip.startMs === fallbackClip.startMs &&
        llmClip.durationMs === fallbackClip.durationMs
    )
  ),
  'real Chinese marketing LLM planning restores every deterministic publishable clip when model output is incomplete',
);

const wenan5DesktopCoarseTranscriptSegments = [
  [0, 22_600, '\\u806a\\u660e\\u7684\\u7f8e\\u56fd\\u7559\\u5b66\\u6d77\\u5f52\\u518d\\u53bb\\u7f8e\\u56fd\\u751f\\u6d3b\\uff0c\\u65e9\\u5c31\\u4e0d\\u6324\\u7559\\u5b66\\u7b7e\\uff0c\\u65e9\\u5c31\\u4e0d\\u4f1a\\u518d\\u53bb\\u6324\\u82e6\\u903c\\u7684\\u7559\\u5b66\\u7b7e\\uff0c\\u4e5f\\u522b\\u53bb\\u5e7b\\u60f3\\u8fdb\\u4e2d\\u8d8a\\u7684\\u5de5\\u94b1\\u4e86\\u3002'],
  [26_600, 43_740, '\\u806a\\u660e\\u7684\\u7f8e\\u56fd\\u7559\\u5b66\\u6d77\\u5f52\\u60f3\\u518d\\u53bb\\u7f8e\\u56fd\\u751f\\u6d3b\\uff0c\\u4e0d\\u4f1a\\u518d\\u53bb\\u6324\\u82e6\\u903c\\u7684\\u7559\\u5b66\\u7b7e\\uff0c\\u66f4\\u52a0\\u4e0d\\u4f1a\\u53bb\\uff0c\\u66f4\\u52a0\\u4e0d\\u4f1a\\u6302\\u7740\\u811a\\u53bb\\u8df3\\u8fdb\\u4e2d\\u8d8a\\u7684\\u5de5\\u94b1\\u3002'],
  [53_200, 66_260, '\\u4ed6\\u4eec\\u4f1a\\u7528\\u8fd9\\u4e07\\u8bbf\\u5b66\\u7684\\u8def\\u5f84\\u7ed9\\u81ea\\u5df1\\u548c\\u5bb6\\u4eba\\u94fa\\u5c31\\u4e00\\u6761\\u901a\\u5411\\u7f8e\\u56fd\\u7684\\u5934\\u7b49\\u8231\\u673a\\u7968\\u3002'],
  [73_420, 86_260, '\\u6211\\u505a\\u7f8e\\u56fd\\u8bbf\\u5b6616\\u5e74\\uff0c\\u5e2e\\u52a9\\u51e0\\u767e\\u4f4d\\u7f8e\\u56fd\\u7559\\u5b66\\u6d77\\u5f52\\uff0c\\u5e2e\\u52a9\\u51e0\\u767e\\u4f4d\\u6d77\\u5f52\\u91cd\\u65b0\\u6740\\u56de\\u7f8e\\u56fd\\u3002'],
  [90_760, 109_240, '\\u8fd9\\u4e07\\u8bbf\\u5b66\\u4e0d\\u780d\\u4f60\\u7684\\u6bd5\\u4e1a\\u8fde\\u7ebf\\uff0c\\u53ea\\u8981\\u4f60\\u6709\\u4e00\\u5b9a\\u7684\\u884c\\u4e1a\\u7ecf\\u9a8c\\uff0c\\u53ea\\u8981\\u4f60\\u6709\\u4e00\\u5b9a\\u7684\\u884c\\u4e1a\\u7ecf\\u9a8c\\u5c31\\u80fd\\u7533\\u8bf7\\uff0c\\u6700\\u5feb\\u4e09\\u4e2a\\u6708\\u5e26\\u7740\\u5bb6\\u4eba\\u4e00\\u8d77\\u53bb\\u7f8e\\u56fd\\uff0c\\u957f\\u671f\\u7684\\u5408\\u6cd5\\u3002'],
  [110_240, 115_060, '\\u5e26\\u7740\\u5bb6\\u4eba\\u4e00\\u8d77\\u53bb\\u7f8e\\u56fd\\uff0c\\u957f\\u671f\\u7684\\u8f7b\\u677e\\u81ea\\u5728\\u7684\\u751f\\u6d3b\\u3002'],
  [115_060, 128_880, '\\u6700\\u5feb\\u4e09\\u4e2a\\u6708\\u5c31\\u80fd\\u5e26\\u7740\\u5bb6\\u4eba\\u5408\\u6cd5\\u5165\\u5883\\uff0c\\u91cd\\u56de\\u4f60\\u719f\\u6089\\u7684\\u7f8e\\u56fd\\u751f\\u6d3b\\u3002'],
  [128_880, 136_460, '\\u540c\\u65f6\\u7ed9\\u81ea\\u5df1\\u7559\\u8db3\\uff0c\\u540c\\u65f6\\u7ed9\\u81ea\\u5df1\\u7559\\u8db3\\uff0c\\u957f\\u671f\\u7684\\u53d1\\u5c55\\u56f0\\u4ef6\\u3002'],
  [136_460, 148_740, '\\u5f88\\u591a\\u4eba\\u89c9\\u5f97\\u56de\\u7f8e\\u56fd\\uff0c\\u5c31\\u8981\\u5148\\u653e\\u5f03\\u56fd\\u5185\\u7684\\u4e00\\u5207\\uff0c\\u8d4c\\u4e00\\u628a\\u3002'],
  [151_740, 164_700, '\\u6211\\u544a\\u8bc9\\u4f60\\uff0c\\u9ad8\\u8ba4\\u77e5\\u7684\\u6d77\\u5f52\\uff0c\\u5c31\\u662f\\u5148\\u7ed9\\u81ea\\u5df1\\u548c\\u5bb6\\u4eba\\u62ff\\u4e00\\u5f20\\uff0c\\u5c31\\u662f\\u5148\\u7ed9\\u81ea\\u5df1\\u548c\\u5bb6\\u4eba\\u62ff\\u4e00\\u5f20\\u8fdb\\u53ef\\u653b\\uff0c\\u9000\\u53ef\\u626f\\u7684\\u5165\\u573a\\u5238\\u3002'],
  [164_700, 170_200, '\\u8fd9\\u5176\\u5b9e\\u633a\\u5570\\u55e6\\u7684\\u3002'],
  [170_200, 175_640, '\\u4f60\\u60f3\\u957f\\u671f\\u5728\\u7f8e\\u56fd\\u751f\\u6d3b\\uff0c\\u8fd9\\u5176\\u5b9e\\u633a\\u5570\\u55e6\\u7684\\u3002'],
  [178_060, 182_380, "I'll show you the same thing. I'll show you the same thing. I'll show you the same thing."],
].map(([startMs, endMs, text]) => ({
  startMs,
  endMs,
  text: zhTranscript(text),
  speaker: 'Speaker 1',
}));
const wenan5DesktopUiParams = {
  ...baseParams,
  minDuration: 30,
  maxDuration: 70,
  idealDuration: 45,
  sourceDurationMs: 182_360,
  targetPlatform: 'douyin',
  targetAspectRatio: '9:16',
  videoObjectFit: 'contain',
  continuityLevel: 'standard',
  baseAlgorithm: 'nlp',
  highlightEngine: 'emotion',
  enableNoiseReduction: true,
  enableCoughFilter: true,
  enableRepeatFilter: true,
  enableSubtitles: true,
};
const wenan5DesktopCoarseTranscriptCandidates = buildTranscriptSliceCandidates(
  wenan5DesktopUiParams,
  wenan5DesktopCoarseTranscriptSegments,
);
const wenan5DesktopCoarseTranscriptPlan = createTranscriptAssistedSlicePlan(
  wenan5DesktopUiParams,
  wenan5DesktopCoarseTranscriptSegments,
);
assertRule(
  wenan5DesktopCoarseTranscriptCandidates.length >= 6,
  `desktop UI coarse wenan5 transcript produces planning candidates before release filtering (${wenan5DesktopCoarseTranscriptCandidates.length})`,
);
assertRule(
  wenan5DesktopCoarseTranscriptPlan.length >= 2,
  `desktop UI coarse wenan5 transcript emits multiple renderable clips instead of ${wenan5DesktopCoarseTranscriptPlan.length}`,
);
assertRule(
  wenan5DesktopCoarseTranscriptPlan.every((clip) =>
    clip.durationMs >= 30_000 &&
      clip.durationMs <= 70_000 &&
      (clip.transcriptSegmentCount ?? 0) > 0 &&
      Boolean(clip.transcriptText?.trim()) &&
      clip.publishabilityGrade !== 'reject' &&
      clip.platformReadinessGrade !== 'reject'
  ),
  'desktop UI coarse wenan5 transcript plan keeps emitted clips renderable, transcript-backed, and within UI duration bounds',
);
assertRule(
  wenan5DesktopCoarseTranscriptPlan.some((clip) =>
    clip.transcriptText?.includes(zhTranscript('\\u53ea\\u8981\\u4f60\\u6709\\u4e00\\u5b9a\\u7684\\u884c\\u4e1a\\u7ecf\\u9a8c')) &&
      clip.transcriptText?.includes(zhTranscript('\\u6700\\u5feb\\u4e09\\u4e2a\\u6708\\u5c31\\u80fd\\u5e26\\u7740\\u5bb6\\u4eba\\u5408\\u6cd5\\u5165\\u5883'))
  ),
  'desktop UI coarse wenan5 transcript keeps the application condition and three-month legal-entry payoff in a continuous release clip',
);
assertRule(
  wenan5DesktopCoarseTranscriptPlan.every((clip) =>
    !clip.transcriptText?.includes(zhTranscript('\\u5570\\u55e6')) &&
      !clip.transcriptText?.includes('show you the same thing')
  ),
  'desktop UI coarse wenan5 transcript excludes NG/re-recording tail speech from release clips',
);
assertPlanCoversEveryEligibleTranscriptSegment(
  wenan5DesktopCoarseTranscriptPlan,
  wenan5DesktopCoarseTranscriptSegments,
  'desktop UI coarse wenan5 transcript plan covers every eligible speech-to-text segment before native rendering',
);
const unpunctuatedChineseCoarseSegmentStoriesPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 5,
  maxDuration: 20,
  sourceDurationMs: 24_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 24_000,
    text: [
      '\\u7b2c\\u4e00\\u70b9\\u4e3a\\u4ec0\\u4e48\\u5f00\\u5934\\u7559\\u5b58\\u4e0b\\u964d\\u662f\\u56e0\\u4e3a\\u6b22\\u8fce\\u9875\\u9762\\u9690\\u85cf\\u7ed3\\u679c\\u7528\\u6237\\u770b\\u4e0d\\u6e05\\u95ee\\u9898\\u56e0\\u4e3a\\u8fd9\\u4e2a\\u6848\\u4f8b\\u8bf4\\u660e\\u7528\\u6237\\u75db\\u70b9\\u6240\\u4ee5\\u89e3\\u51b3\\u529e\\u6cd5\\u662f\\u5148\\u5c55\\u793a\\u7ed3\\u679c\\u5b8c\\u64ad\\u4f1a\\u63d0\\u5347',
      '\\u7b2c\\u4e8c\\u70b9\\u4e3a\\u4ec0\\u4e48\\u6fc0\\u6d3b\\u6d41\\u7a0b\\u5931\\u8d25\\u662f\\u56e0\\u4e3a\\u6e05\\u5355\\u9690\\u85cf\\u4e0b\\u4e00\\u6b65\\u7528\\u6237\\u88ab\\u95ee\\u9898\\u5361\\u4f4f\\u56e0\\u4e3a\\u8fd9\\u4e2a\\u6848\\u4f8b\\u8bf4\\u660e\\u6fc0\\u6d3b\\u75db\\u70b9\\u6240\\u4ee5\\u89e3\\u51b3\\u65b9\\u6848\\u662f\\u5c55\\u793a\\u4e00\\u4e2a\\u4e0b\\u4e00\\u6b65\\u8f6c\\u5316\\u4f1a\\u63d0\\u5347',
      '\\u7b2c\\u4e09\\u70b9\\u4e3a\\u4ec0\\u4e48\\u6559\\u7a0b\\u8bbe\\u7f6e\\u5931\\u8d25\\u662f\\u56e0\\u4e3a\\u8fdb\\u5ea6\\u88ab\\u9690\\u85cf\\u7528\\u6237\\u89c9\\u5f97\\u95ee\\u9898\\u6ca1\\u5b8c\\u56e0\\u4e3a\\u8fd9\\u4e2a\\u6848\\u4f8b\\u8bf4\\u660e\\u8bbe\\u7f6e\\u75db\\u70b9\\u6240\\u4ee5\\u4fee\\u590d\\u529e\\u6cd5\\u662f\\u5148\\u5c55\\u793a\\u8fdb\\u5ea6\\u4fe1\\u5fc3\\u4f1a\\u63d0\\u5347',
    ].map(zhTranscript).join(' '),
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  unpunctuatedChineseCoarseSegmentStoriesPlan.length,
  3,
  'unpunctuated Chinese coarse STT segment planning splits numbered stories instead of depending on Chinese punctuation',
);
assertRule(
  unpunctuatedChineseCoarseSegmentStoriesPlan.every((clip) =>
    clip.contentArcGrade === 'complete' &&
      clip.storyShape === 'complete' &&
      clip.topicCoherenceGrade !== 'weak' &&
      clip.transcriptSegmentCount <= 2
  ),
  'unpunctuated Chinese coarse STT segment planning keeps each emitted story complete, coherent, and compact',
);
assertRule(
  unpunctuatedChineseCoarseSegmentStoriesPlan.some((clip) => clip.transcriptText?.includes(zhTranscript('\\u6fc0\\u6d3b\\u75db\\u70b9'))) &&
    unpunctuatedChineseCoarseSegmentStoriesPlan.some((clip) => clip.transcriptText?.includes(zhTranscript('\\u8bbe\\u7f6e\\u75db\\u70b9'))) &&
    unpunctuatedChineseCoarseSegmentStoriesPlan.some((clip) => clip.transcriptText?.includes(zhTranscript('\\u7528\\u6237\\u75db\\u70b9'))),
  'unpunctuated Chinese coarse STT segment planning preserves every natural numbered story group',
);

const unpunctuatedChineseOrdinalNoUnitStoriesText = zhTranscript(
  '\\u7b2c\\u4e00\\u4e3a\\u4ec0\\u4e48\\u5f00\\u5934\\u7559\\u5b58\\u4e0b\\u964d\\u662f\\u56e0\\u4e3a\\u9996\\u5c4f\\u9690\\u85cf\\u7ed3\\u679c\\u7528\\u6237\\u75db\\u70b9\\u660e\\u663e\\u6240\\u4ee5\\u5148\\u5c55\\u793a\\u7ed3\\u679c\\u5b8c\\u64ad\\u63d0\\u5347\\u7b2c\\u4e8c\\u4e3a\\u4ec0\\u4e48\\u6fc0\\u6d3b\\u5931\\u8d25\\u662f\\u56e0\\u4e3a\\u4e0b\\u4e00\\u6b65\\u88ab\\u9690\\u85cf\\u7528\\u6237\\u75db\\u70b9\\u660e\\u663e\\u6240\\u4ee5\\u5c55\\u793a\\u4e00\\u4e2a\\u4e0b\\u4e00\\u6b65\\u8f6c\\u5316\\u63d0\\u5347\\u7b2c\\u4e09\\u4e3a\\u4ec0\\u4e48\\u8bbe\\u7f6e\\u5931\\u8d25\\u662f\\u56e0\\u4e3a\\u8fdb\\u5ea6\\u9690\\u85cf\\u7528\\u6237\\u75db\\u70b9\\u660e\\u663e\\u6240\\u4ee5\\u5148\\u5c55\\u793a\\u8fdb\\u5ea6\\u4fe1\\u5fc3\\u63d0\\u5347',
);
const unpunctuatedChineseOrdinalNoUnitPlanningSegments = normalizeSmartSliceTranscriptSegmentsForPlanning([
  {
    startMs: 0,
    endMs: 30_000,
    text: unpunctuatedChineseOrdinalNoUnitStoriesText,
    speaker: 'Speaker 1',
  },
]);
const unpunctuatedChineseOrdinalNoUnitStoriesPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 5,
  maxDuration: 20,
  sourceDurationMs: 30_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 30_000,
    text: unpunctuatedChineseOrdinalNoUnitStoriesText,
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  unpunctuatedChineseOrdinalNoUnitPlanningSegments.length,
  3,
  'unpunctuated Chinese ordinal normalization splits 第一-第二-第三 stories even when STT omits 点/个/条 units',
);
assertEqual(
  unpunctuatedChineseOrdinalNoUnitStoriesPlan.length,
  3,
  'unpunctuated Chinese ordinal coarse STT planning emits every 第一-第二-第三 story without requiring unit words',
);
assertRule(
  unpunctuatedChineseOrdinalNoUnitStoriesPlan.every((clip) =>
    clip.contentArcGrade === 'complete' &&
      clip.storyShape === 'complete' &&
      clip.topicCoherenceGrade !== 'weak' &&
      clip.transcriptSegmentCount <= 2
  ),
  'unpunctuated Chinese ordinal coarse STT planning keeps every emitted ordinal story complete, coherent, and compact',
);

const unpunctuatedChineseBareNumeralStoriesText = zhTranscript(
  '\\u4e00\\u4e3a\\u4ec0\\u4e48\\u5f00\\u5934\\u7559\\u5b58\\u4e0b\\u964d\\u662f\\u56e0\\u4e3a\\u9996\\u5c4f\\u9690\\u85cf\\u7ed3\\u679c\\u6240\\u4ee5\\u5148\\u5c55\\u793a\\u7ed3\\u679c\\u5b8c\\u64ad\\u63d0\\u5347\\u4e8c\\u4e3a\\u4ec0\\u4e48\\u6fc0\\u6d3b\\u5931\\u8d25\\u662f\\u56e0\\u4e3a\\u4e0b\\u4e00\\u6b65\\u9690\\u85cf\\u6240\\u4ee5\\u5c55\\u793a\\u4e0b\\u4e00\\u6b65\\u8f6c\\u5316\\u63d0\\u5347\\u4e09\\u4e3a\\u4ec0\\u4e48\\u8bbe\\u7f6e\\u5931\\u8d25\\u662f\\u56e0\\u4e3a\\u8fdb\\u5ea6\\u9690\\u85cf\\u6240\\u4ee5\\u5c55\\u793a\\u8fdb\\u5ea6\\u4fe1\\u5fc3\\u63d0\\u5347',
);
const unpunctuatedChineseBareNumeralPlanningSegments = normalizeSmartSliceTranscriptSegmentsForPlanning([
  {
    startMs: 0,
    endMs: 30_000,
    text: unpunctuatedChineseBareNumeralStoriesText,
    speaker: 'Speaker 1',
  },
]);
const unpunctuatedChineseBareNumeralStoriesPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 5,
  maxDuration: 20,
  sourceDurationMs: 30_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 30_000,
    text: unpunctuatedChineseBareNumeralStoriesText,
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  unpunctuatedChineseBareNumeralPlanningSegments.length,
  3,
  'unpunctuated Chinese bare numeral normalization splits 一-二-三 stories when each numeral starts a question-style content story',
);
assertEqual(
  unpunctuatedChineseBareNumeralStoriesPlan.length,
  3,
  'unpunctuated Chinese bare numeral coarse STT planning emits every 一-二-三 story instead of returning an empty plan',
);
assertRule(
  unpunctuatedChineseBareNumeralStoriesPlan.every((clip) =>
    clip.contentArcGrade === 'complete' &&
      clip.storyShape === 'complete' &&
      clip.topicCoherenceGrade !== 'weak' &&
      clip.transcriptSegmentCount <= 2
  ),
  'unpunctuated Chinese bare numeral coarse STT planning keeps every emitted story complete, coherent, and compact',
);

const unpunctuatedChineseBareNumeralShiStoriesText = zhTranscript(
  '\\u4e00\\u662f\\u5f00\\u5934\\u7559\\u5b58\\u4e0b\\u964d\\u56e0\\u4e3a\\u9996\\u5c4f\\u9690\\u85cf\\u7ed3\\u679c\\u7528\\u6237\\u75db\\u70b9\\u660e\\u663e\\u6240\\u4ee5\\u5148\\u5c55\\u793a\\u7ed3\\u679c\\u5b8c\\u64ad\\u63d0\\u5347\\u4e8c\\u662f\\u6fc0\\u6d3b\\u5931\\u8d25\\u56e0\\u4e3a\\u4e0b\\u4e00\\u6b65\\u88ab\\u9690\\u85cf\\u7528\\u6237\\u75db\\u70b9\\u660e\\u663e\\u6240\\u4ee5\\u5c55\\u793a\\u4e00\\u4e2a\\u4e0b\\u4e00\\u6b65\\u8f6c\\u5316\\u63d0\\u5347\\u4e09\\u662f\\u8bbe\\u7f6e\\u5931\\u8d25\\u56e0\\u4e3a\\u8fdb\\u5ea6\\u9690\\u85cf\\u7528\\u6237\\u75db\\u70b9\\u660e\\u663e\\u6240\\u4ee5\\u5148\\u5c55\\u793a\\u8fdb\\u5ea6\\u4fe1\\u5fc3\\u63d0\\u5347',
);
const unpunctuatedChineseBareNumeralShiStoriesPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 5,
  maxDuration: 20,
  sourceDurationMs: 30_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 30_000,
    text: unpunctuatedChineseBareNumeralShiStoriesText,
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  unpunctuatedChineseBareNumeralShiStoriesPlan.length,
  3,
  'unpunctuated Chinese bare numeral planning splits 一是-二是-三是 stories instead of returning an empty plan',
);
assertRule(
  unpunctuatedChineseBareNumeralShiStoriesPlan.every((clip) =>
    clip.contentArcGrade === 'complete' &&
      clip.storyShape === 'complete' &&
      clip.topicCoherenceGrade !== 'weak' &&
      clip.transcriptSegmentCount <= 2
  ),
  'unpunctuated Chinese bare numeral 一是 stories stay complete, coherent, and compact',
);

const unpunctuatedChineseOrdinalShiStoriesText = zhTranscript(
  '\\u7b2c\\u4e00\\u662f\\u5f00\\u5934\\u7559\\u5b58\\u4e0b\\u964d\\u56e0\\u4e3a\\u9996\\u5c4f\\u9690\\u85cf\\u7ed3\\u679c\\u6240\\u4ee5\\u5148\\u5c55\\u793a\\u7ed3\\u679c\\u5b8c\\u64ad\\u63d0\\u5347\\u7b2c\\u4e8c\\u662f\\u6fc0\\u6d3b\\u5931\\u8d25\\u56e0\\u4e3a\\u4e0b\\u4e00\\u6b65\\u9690\\u85cf\\u6240\\u4ee5\\u5c55\\u793a\\u4e0b\\u4e00\\u6b65\\u8f6c\\u5316\\u63d0\\u5347\\u7b2c\\u4e09\\u662f\\u8bbe\\u7f6e\\u5931\\u8d25\\u56e0\\u4e3a\\u8fdb\\u5ea6\\u9690\\u85cf\\u6240\\u4ee5\\u5c55\\u793a\\u8fdb\\u5ea6\\u4fe1\\u5fc3\\u63d0\\u5347',
);
const unpunctuatedChineseOrdinalShiStoriesPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 5,
  maxDuration: 20,
  sourceDurationMs: 30_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 30_000,
    text: unpunctuatedChineseOrdinalShiStoriesText,
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  unpunctuatedChineseOrdinalShiStoriesPlan.length,
  3,
  'unpunctuated Chinese ordinal planning splits 第一是-第二是-第三是 stories instead of returning an empty plan',
);
assertRule(
  unpunctuatedChineseOrdinalShiStoriesPlan.every((clip) =>
    clip.contentArcGrade === 'complete' &&
      clip.storyShape === 'complete' &&
      clip.topicCoherenceGrade !== 'weak' &&
      clip.transcriptSegmentCount <= 2
  ),
  'unpunctuated Chinese ordinal 第一是 stories stay complete, coherent, and compact',
);

const unpunctuatedChineseQiEnumeratedStoriesText = zhTranscript(
  '\\u5176\\u4e00\\u5f00\\u5934\\u7559\\u5b58\\u4e0b\\u964d\\u56e0\\u4e3a\\u9996\\u5c4f\\u9690\\u85cf\\u7ed3\\u679c\\u7528\\u6237\\u75db\\u70b9\\u660e\\u663e\\u6240\\u4ee5\\u5148\\u5c55\\u793a\\u7ed3\\u679c\\u5b8c\\u64ad\\u63d0\\u5347\\u5176\\u4e8c\\u6fc0\\u6d3b\\u5931\\u8d25\\u56e0\\u4e3a\\u4e0b\\u4e00\\u6b65\\u88ab\\u9690\\u85cf\\u7528\\u6237\\u75db\\u70b9\\u660e\\u663e\\u6240\\u4ee5\\u5c55\\u793a\\u4e00\\u4e2a\\u4e0b\\u4e00\\u6b65\\u8f6c\\u5316\\u63d0\\u5347\\u5176\\u4e09\\u8bbe\\u7f6e\\u5931\\u8d25\\u56e0\\u4e3a\\u8fdb\\u5ea6\\u9690\\u85cf\\u7528\\u6237\\u75db\\u70b9\\u660e\\u663e\\u6240\\u4ee5\\u5148\\u5c55\\u793a\\u8fdb\\u5ea6\\u4fe1\\u5fc3\\u63d0\\u5347',
);
const unpunctuatedChineseQiEnumeratedStoriesPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 5,
  maxDuration: 20,
  sourceDurationMs: 30_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 30_000,
    text: unpunctuatedChineseQiEnumeratedStoriesText,
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  unpunctuatedChineseQiEnumeratedStoriesPlan.length,
  3,
  'unpunctuated Chinese planning splits 其一-其二-其三 stories instead of returning an empty plan',
);
assertRule(
  unpunctuatedChineseQiEnumeratedStoriesPlan.every((clip) =>
    clip.contentArcGrade === 'complete' &&
      clip.storyShape === 'complete' &&
      clip.topicCoherenceGrade !== 'weak' &&
      clip.transcriptSegmentCount <= 2
  ),
  'unpunctuated Chinese 其一 stories stay complete, coherent, and compact',
);

const unpunctuatedChineseLetterOptionStoriesText = zhTranscript(
  'A\\u65b9\\u6848\\u5f00\\u5934\\u7559\\u5b58\\u4e0b\\u964d\\u56e0\\u4e3a\\u9996\\u5c4f\\u9690\\u85cf\\u7ed3\\u679c\\u7528\\u6237\\u75db\\u70b9\\u660e\\u663e\\u6240\\u4ee5\\u5148\\u5c55\\u793a\\u7ed3\\u679c\\u5b8c\\u64ad\\u63d0\\u5347B\\u65b9\\u6848\\u6fc0\\u6d3b\\u5931\\u8d25\\u56e0\\u4e3a\\u4e0b\\u4e00\\u6b65\\u88ab\\u9690\\u85cf\\u7528\\u6237\\u75db\\u70b9\\u660e\\u663e\\u6240\\u4ee5\\u5c55\\u793a\\u4e00\\u4e2a\\u4e0b\\u4e00\\u6b65\\u8f6c\\u5316\\u63d0\\u5347C\\u65b9\\u6848\\u8bbe\\u7f6e\\u5931\\u8d25\\u56e0\\u4e3a\\u8fdb\\u5ea6\\u9690\\u85cf\\u7528\\u6237\\u75db\\u70b9\\u660e\\u663e\\u6240\\u4ee5\\u5148\\u5c55\\u793a\\u8fdb\\u5ea6\\u4fe1\\u5fc3\\u63d0\\u5347',
);
const unpunctuatedChineseLetterOptionStoriesPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 5,
  maxDuration: 20,
  sourceDurationMs: 30_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 30_000,
    text: unpunctuatedChineseLetterOptionStoriesText,
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  unpunctuatedChineseLetterOptionStoriesPlan.length,
  3,
  'unpunctuated Chinese planning splits A方案-B方案-C方案 stories instead of returning an empty plan',
);
assertRule(
  unpunctuatedChineseLetterOptionStoriesPlan.every((clip) =>
    clip.contentArcGrade === 'complete' &&
      clip.storyShape === 'complete' &&
      clip.topicCoherenceGrade !== 'weak' &&
      clip.transcriptSegmentCount <= 2
  ),
  'unpunctuated Chinese A/B/C方案 stories stay complete, coherent, and compact',
);

const unpunctuatedChineseTransitionCoarseStoriesText = zhTranscript(
  '\\u9996\\u5148\\u7528\\u6237\\u75db\\u70b9\\u662f\\u9996\\u5c4f\\u770b\\u4e0d\\u5230\\u7ed3\\u679c\\u56e0\\u4e3a\\u8bf4\\u660e\\u592a\\u65e9\\u6240\\u4ee5\\u5148\\u653e\\u5bf9\\u6bd4\\u6548\\u679c\\u7559\\u5b58\\u63d0\\u5347\\u5176\\u6b21\\u6fc0\\u6d3b\\u75db\\u70b9\\u662f\\u7528\\u6237\\u5148\\u586b\\u8d44\\u6599\\u56e0\\u4e3a\\u6838\\u5fc3\\u52a8\\u4f5c\\u88ab\\u63a8\\u540e\\u6240\\u4ee5\\u5148\\u653e\\u542f\\u52a8\\u52a8\\u4f5c\\u5b8c\\u6210\\u7387\\u63d0\\u5347\\u518d\\u6b21\\u8bbe\\u7f6e\\u75db\\u70b9\\u662f\\u6743\\u9650\\u63d0\\u793a\\u88ab\\u9690\\u85cf\\u56e0\\u4e3a\\u90ae\\u4ef6\\u6ca1\\u6709\\u8bf4\\u6e05\\u6240\\u4ee5\\u9996\\u5c4f\\u5c55\\u793a\\u6743\\u9650\\u6b65\\u9aa4\\u5de5\\u5355\\u4e0b\\u964d',
);
const unpunctuatedChineseTransitionPlanningSegments = normalizeSmartSliceTranscriptSegmentsForPlanning([
  {
    startMs: 0,
    endMs: 36_000,
    text: unpunctuatedChineseTransitionCoarseStoriesText,
    speaker: 'Speaker 1',
  },
]);
const unpunctuatedChineseTransitionCoarseStoriesPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 5,
  maxDuration: 20,
  sourceDurationMs: 36_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 36_000,
    text: unpunctuatedChineseTransitionCoarseStoriesText,
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  unpunctuatedChineseTransitionPlanningSegments.length,
  3,
  'unpunctuated Chinese transition-marker normalization splits firstly-next-finally stories without relying on punctuation',
);
assertEqual(
  unpunctuatedChineseTransitionCoarseStoriesPlan.length,
  3,
  'unpunctuated Chinese transition-marker coarse STT planning emits each natural story instead of returning an empty plan',
);
assertRule(
  unpunctuatedChineseTransitionCoarseStoriesPlan.every((clip) =>
    clip.contentArcGrade === 'complete' &&
      clip.storyShape === 'complete' &&
      clip.topicCoherenceGrade !== 'weak' &&
      clip.transcriptSegmentCount <= 2
  ),
  'unpunctuated Chinese transition-marker coarse STT planning keeps every emitted story complete, coherent, and compact',
);
assertRule(
  unpunctuatedChineseTransitionCoarseStoriesPlan.some((clip) => clip.transcriptText?.includes(zhTranscript('\\u7559\\u5b58\\u63d0\\u5347'))) &&
    unpunctuatedChineseTransitionCoarseStoriesPlan.some((clip) => clip.transcriptText?.includes(zhTranscript('\\u5b8c\\u6210\\u7387\\u63d0\\u5347'))) &&
    unpunctuatedChineseTransitionCoarseStoriesPlan.some((clip) => clip.transcriptText?.includes(zhTranscript('\\u5de5\\u5355\\u4e0b\\u964d'))),
  'unpunctuated Chinese transition-marker coarse STT planning preserves every transition story payoff',
);

const inlineNumberedPhrasePlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 5,
  maxDuration: 20,
  sourceDurationMs: 12_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 12_000,
    text: 'Use case 1 and use case 2 are both examples in this product demo, so the final answer is to compare the result before choosing a fix.',
    speaker: 'Speaker 1',
  },
]);
const inlineNumberedPhrasePlanningSegments = normalizeSmartSliceTranscriptSegmentsForPlanning([
  {
    startMs: 0,
    endMs: 12_000,
    text: 'Use case 1 and use case 2 are both examples in this product demo, so the final answer is to compare the result before choosing a fix.',
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  inlineNumberedPhrasePlanningSegments.length,
  1,
  'transcript normalization preserves inline numbered phrases instead of splitting them as section headings',
);
assertRule(
  inlineNumberedPhrasePlanningSegments[0]?.text.includes('use case 2') === true,
  'transcript normalization keeps the full inline numbered phrase in one planning segment',
);
assertRule(
  inlineNumberedPhrasePlan.length <= 1,
  'inline numbered phrases such as use case 1 and use case 2 are not split into fake independent stories',
);
assertRule(
  !inlineNumberedPhrasePlan.some((clip) => (clip.transcriptText ?? '').trim() === 'Use'),
  'inline numbered phrase planning never emits a dangling prefix as a clip',
);

const inlineOrdinalPhrasePlanningSegments = normalizeSmartSliceTranscriptSegmentsForPlanning([
  {
    startMs: 0,
    endMs: 12_000,
    text: 'The first screen compares the setup and the second example shows the result, so the final answer is to keep one clear fix.',
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  inlineOrdinalPhrasePlanningSegments.length,
  1,
  'transcript normalization preserves ordinary inline ordinal phrases instead of splitting first screen and second example as story headings',
);
assertRule(
  inlineOrdinalPhrasePlanningSegments[0]?.text.includes('second example') === true,
  'transcript normalization keeps ordinary inline ordinal phrases in one planning segment',
);

const inlineNumericPhrasePlanningSegments = normalizeSmartSliceTranscriptSegmentsForPlanning([
  {
    startMs: 0,
    endMs: 12_000,
    text: 'Version 1 works with setup 2 and rollout 3 in this demo, so the final answer is to compare one result before choosing a fix.',
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  inlineNumericPhrasePlanningSegments.length,
  1,
  'transcript normalization preserves ordinary inline numeric phrases instead of splitting version and setup numbers as story headings',
);
assertRule(
  inlineNumericPhrasePlanningSegments[0]?.text.includes('setup 2') === true,
  'transcript normalization keeps ordinary inline numeric phrases in one planning segment',
);

const inlineNumberWordPhrasePlanningSegments = normalizeSmartSliceTranscriptSegmentsForPlanning([
  {
    startMs: 0,
    endMs: 12_000,
    text: 'The number one mistake is hidden setup, and number two is unclear result, so the final fix is one visible outcome.',
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  inlineNumberWordPhrasePlanningSegments.length,
  1,
  'transcript normalization preserves ordinary inline number-word phrases instead of splitting number one and number two references',
);
assertRule(
  inlineNumberWordPhrasePlanningSegments[0]?.text.includes('number two') === true,
  'transcript normalization keeps ordinary inline number-word phrases in one planning segment',
);

const inlineLetterPhrasePlanningSegments = normalizeSmartSliceTranscriptSegmentsForPlanning([
  {
    startMs: 0,
    endMs: 12_000,
    text: 'Plan A and plan B are compared inside one sentence, so the final answer is to keep one clear result.',
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  inlineLetterPhrasePlanningSegments.length,
  1,
  'transcript normalization preserves ordinary inline letter references such as Plan A and plan B',
);
assertRule(
  inlineLetterPhrasePlanningSegments[0]?.text.includes('plan B') === true,
  'transcript normalization keeps ordinary inline letter references in one planning segment',
);

for (const inlineLetterReferenceText of [
  'Option A and option B both work because the setup is clear, so do not split this comparison.',
  'Part A and part B are labels inside one explanation, so keep a single clip.',
]) {
  const inlineLetterReferenceSegments = normalizeSmartSliceTranscriptSegmentsForPlanning([
    {
      startMs: 0,
      endMs: 12_000,
      text: inlineLetterReferenceText,
      speaker: 'Speaker 1',
    },
  ]);
  assertEqual(
    inlineLetterReferenceSegments.length,
    1,
    'transcript normalization preserves ordinary inline option/part letter references',
  );
}

const inlineChineseNumeralPhrasePlanningSegments = normalizeSmartSliceTranscriptSegmentsForPlanning([
  {
    startMs: 0,
    endMs: 12_000,
    text: zhTranscript('\\u7b2c\\u4e00\\u5c4f\\u548c\\u7b2c\\u4e8c\\u4e2a\\u6848\\u4f8b\\u90fd\\u5728\\u8bf4\\u660e\\u8bbe\\u7f6e\\u6548\\u679c\\u6240\\u4ee5\\u6700\\u540e\\u7b54\\u6848\\u662f\\u4fdd\\u7559\\u4e00\\u4e2a\\u6e05\\u6670\\u7ed3\\u679c'),
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  inlineChineseNumeralPhrasePlanningSegments.length,
  1,
  'transcript normalization preserves ordinary inline Chinese ordinal phrases such as 第一屏 and 第二个案例',
);
assertRule(
  inlineChineseNumeralPhrasePlanningSegments[0]?.text.includes(zhTranscript('\\u7b2c\\u4e8c\\u4e2a\\u6848\\u4f8b')) === true,
  'transcript normalization keeps ordinary inline Chinese ordinal phrases in one planning segment',
);

const inlineChineseBareNumeralPhrasePlanningSegments = normalizeSmartSliceTranscriptSegmentsForPlanning([
  {
    startMs: 0,
    endMs: 12_000,
    text: zhTranscript('\\u4e00\\u4e2a\\u95ee\\u9898\\u548c\\u4e8c\\u4e2a\\u539f\\u56e0\\u90fd\\u5728\\u540c\\u4e00\\u53e5\\u91cc\\u6240\\u4ee5\\u4e0d\\u8981\\u5207\\u6210\\u591a\\u4e2a\\u6545\\u4e8b'),
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  inlineChineseBareNumeralPhrasePlanningSegments.length,
  1,
  'transcript normalization preserves ordinary inline Chinese bare numeral phrases such as 一个问题 and 二个原因',
);
assertRule(
  inlineChineseBareNumeralPhrasePlanningSegments[0]?.text.includes(zhTranscript('\\u4e8c\\u4e2a\\u539f\\u56e0')) === true,
  'transcript normalization keeps ordinary inline Chinese bare numeral phrases in one planning segment',
);

const inlineChineseLetterOptionPhrasePlanningSegments = normalizeSmartSliceTranscriptSegmentsForPlanning([
  {
    startMs: 0,
    endMs: 12_000,
    text: zhTranscript('A\\u65b9\\u6848\\u548cB\\u65b9\\u6848\\u90fd\\u5728\\u540c\\u4e00\\u53e5\\u91cc\\u5bf9\\u6bd4\\u6240\\u4ee5\\u6700\\u540e\\u4fdd\\u7559\\u4e00\\u4e2a\\u6e05\\u6670\\u7ed3\\u679c'),
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  inlineChineseLetterOptionPhrasePlanningSegments.length,
  1,
  'transcript normalization preserves ordinary inline Chinese letter-option references such as A方案 and B方案',
);
assertRule(
  inlineChineseLetterOptionPhrasePlanningSegments[0]?.text.includes(zhTranscript('B\\u65b9\\u6848')) === true,
  'transcript normalization keeps ordinary inline Chinese letter-option references in one planning segment',
);

const inlineChineseQiPhrasePlanningSegments = normalizeSmartSliceTranscriptSegmentsForPlanning([
  {
    startMs: 0,
    endMs: 12_000,
    text: zhTranscript('\\u5176\\u4e00\\u4e2a\\u95ee\\u9898\\u548c\\u5176\\u4e8c\\u4e2a\\u539f\\u56e0\\u90fd\\u5728\\u540c\\u4e00\\u53e5\\u91cc\\u6240\\u4ee5\\u4e0d\\u8981\\u5207\\u5f00'),
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  inlineChineseQiPhrasePlanningSegments.length,
  1,
  'transcript normalization preserves ordinary inline Chinese 其一个/其二个 phrases',
);
assertRule(
  inlineChineseQiPhrasePlanningSegments[0]?.text.includes(zhTranscript('\\u5176\\u4e8c\\u4e2a\\u539f\\u56e0')) === true,
  'transcript normalization keeps ordinary inline Chinese 其一个/其二个 phrases in one planning segment',
);

const standaloneCompleteTipStoriesPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 10,
  maxDuration: 60,
  sourceDurationMs: 120_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 12_000,
    text: 'Tip one: why onboarding retention drops is that the first screen hides the result and the problem is unclear, so the fix is to show the outcome first and completion improves.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 12_200,
    endMs: 24_200,
    text: 'Tip two: why activation checklist fails is because the activation case hides the next action and the problem blocks users, so the solution is to show one next action and conversion improves.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 24_400,
    endMs: 36_400,
    text: 'Tip three: why setup progress fails is that the tutorial hides progress and the problem feels endless, so the fix is to show progress first and confidence improves.',
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  standaloneCompleteTipStoriesPlan.length,
  3,
  'standalone complete tip story planning emits every already-complete story instead of merging adjacent complete sections',
);
assertRule(
  standaloneCompleteTipStoriesPlan.every((clip) =>
    clip.contentArcGrade === 'complete' &&
      clip.storyShape === 'complete' &&
      clip.transcriptSegmentCount === 1
  ),
  'standalone complete tip story planning keeps complete one-segment stories as independent continuous clips',
);
assertRule(
  !standaloneCompleteTipStoriesPlan.some((clip) => clip.risks?.includes('semantic-story-merged')),
  'standalone complete tip story planning does not record semantic merge evidence when no fragment merge is needed',
);
assertRule(
  !standaloneCompleteTipStoriesPlan.some((clip) => (clip.transcriptSegmentCount ?? 0) > 1),
  'standalone complete tip story planning refuses broad merges that cross into the next complete section opening',
);

const sequentialChinesePointStoriesPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 10,
  maxDuration: 60,
  sourceDurationMs: 120_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 8_000,
    text: zhTranscript('\\u7b2c\\u4e00\\u70b9\\uff1a\\u4e3a\\u4ec0\\u4e48\\u5f00\\u5934\\u7559\\u5b58\\u4e0b\\u964d\\uff0c\\u662f\\u56e0\\u4e3a\\u6b22\\u8fce\\u9875\\u9762\\u9690\\u85cf\\u7ed3\\u679c\\uff0c\\u7528\\u6237\\u770b\\u4e0d\\u6e05\\u95ee\\u9898\\u3002'),
    speaker: 'Speaker 1',
  },
  {
    startMs: 8_200,
    endMs: 16_000,
    text: zhTranscript('\\u56e0\\u4e3a\\u8fd9\\u4e2a\\u6848\\u4f8b\\u8bf4\\u660e\\u7528\\u6237\\u75db\\u70b9\\uff0c\\u6240\\u4ee5\\u89e3\\u51b3\\u529e\\u6cd5\\u662f\\u5148\\u5c55\\u793a\\u7ed3\\u679c\\uff0c\\u5b8c\\u64ad\\u4f1a\\u63d0\\u5347\\u3002'),
    speaker: 'Speaker 1',
  },
  {
    startMs: 16_200,
    endMs: 24_000,
    text: zhTranscript('\\u7b2c\\u4e8c\\u70b9\\uff1a\\u4e3a\\u4ec0\\u4e48\\u6fc0\\u6d3b\\u6d41\\u7a0b\\u5931\\u8d25\\uff0c\\u662f\\u56e0\\u4e3a\\u6e05\\u5355\\u9690\\u85cf\\u4e0b\\u4e00\\u6b65\\uff0c\\u7528\\u6237\\u88ab\\u95ee\\u9898\\u5361\\u4f4f\\u3002'),
    speaker: 'Speaker 1',
  },
  {
    startMs: 24_200,
    endMs: 32_000,
    text: zhTranscript('\\u56e0\\u4e3a\\u8fd9\\u4e2a\\u6848\\u4f8b\\u8bf4\\u660e\\u6fc0\\u6d3b\\u75db\\u70b9\\uff0c\\u6240\\u4ee5\\u89e3\\u51b3\\u65b9\\u6848\\u662f\\u5c55\\u793a\\u4e00\\u4e2a\\u4e0b\\u4e00\\u6b65\\uff0c\\u8f6c\\u5316\\u4f1a\\u63d0\\u5347\\u3002'),
    speaker: 'Speaker 1',
  },
  {
    startMs: 32_200,
    endMs: 40_000,
    text: zhTranscript('\\u7b2c\\u4e09\\u70b9\\uff1a\\u4e3a\\u4ec0\\u4e48\\u6559\\u7a0b\\u8bbe\\u7f6e\\u5931\\u8d25\\uff0c\\u662f\\u56e0\\u4e3a\\u8fdb\\u5ea6\\u88ab\\u9690\\u85cf\\uff0c\\u7528\\u6237\\u89c9\\u5f97\\u95ee\\u9898\\u6ca1\\u5b8c\\u3002'),
    speaker: 'Speaker 1',
  },
  {
    startMs: 40_200,
    endMs: 48_000,
    text: zhTranscript('\\u56e0\\u4e3a\\u8fd9\\u4e2a\\u6848\\u4f8b\\u8bf4\\u660e\\u8bbe\\u7f6e\\u75db\\u70b9\\uff0c\\u6240\\u4ee5\\u4fee\\u590d\\u529e\\u6cd5\\u662f\\u5148\\u5c55\\u793a\\u8fdb\\u5ea6\\uff0c\\u4fe1\\u5fc3\\u4f1a\\u63d0\\u5347\\u3002'),
    speaker: 'Speaker 1',
  },
]);
assertEqual(
  sequentialChinesePointStoriesPlan.length,
  3,
  'Chinese adjacent point story planning emits every complete story instead of collapsing natural clip count',
);
assertRule(
  sequentialChinesePointStoriesPlan.every((clip) =>
    clip.risks?.includes('semantic-story-merged') &&
      clip.contentArcGrade === 'complete' &&
      clip.topicCoherenceGrade !== 'weak' &&
      clip.transcriptSegmentCount === 2
  ),
  'Chinese adjacent point story planning keeps every emitted clip as semantic-story evidence with complete coherent two-segment continuity',
);
assertRule(
  sequentialChinesePointStoriesPlan.some((clip) => clip.transcriptText?.includes(zhTranscript('\\u6fc0\\u6d3b\\u75db\\u70b9'))) &&
    sequentialChinesePointStoriesPlan.some((clip) => clip.transcriptText?.includes(zhTranscript('\\u8bbe\\u7f6e\\u75db\\u70b9'))) &&
    sequentialChinesePointStoriesPlan.some((clip) => clip.transcriptText?.includes(zhTranscript('\\u7528\\u6237\\u75db\\u70b9'))),
  'Chinese adjacent point story planning preserves each natural content group instead of downgrading one to a generic topic segment',
);
assertRule(
  !sequentialChinesePointStoriesPlan.some((clip) => (clip.transcriptSegmentCount ?? 0) > 2),
  'Chinese adjacent point story planning refuses broad semantic merges that cross into the next numbered story opening',
);

const longFormStoryTopics = [
  'retention opening',
  'pricing refund',
  'launch checklist',
  'billing invoice',
  'signup onboarding',
  'analytics dashboard',
  'support escalation',
  'checkout trust',
  'editor export',
  'caption timing',
  'storage cleanup',
  'notification routing',
  'permission review',
  'template library',
  'search ranking',
  'voiceover sync',
  'thumbnail testing',
  'workspace invite',
  'upload recovery',
  'render queue',
  'model preset',
];
const longFormIndependentStorySegments = longFormStoryTopics.flatMap((topic, topicIndex) => {
  const baseStartMs = topicIndex * 30_000;
  return [
    {
      startMs: baseStartMs,
      endMs: baseStartMs + 10_000,
      text: `Why ${topic} fails is that the ${topic} case hides the problem and the ${topic} context is unclear.`,
      speaker: 'Speaker 1',
    },
    {
      startMs: baseStartMs + 10_200,
      endMs: baseStartMs + 22_000,
      text: `Because the ${topic} example shows user pain, so the ${topic} solution shows the result first and completion improves.`,
      speaker: 'Speaker 1',
    },
  ];
});
const longFormIndependentStoriesPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 10,
  maxDuration: 45,
  sourceDurationMs: 660_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, longFormIndependentStorySegments);
assertEqual(
  longFormIndependentStoriesPlan.length,
  longFormStoryTopics.length,
  'auto semantic continuity planning emits every independent complete story instead of truncating to an internal safety cap',
);
assertRule(
  longFormIndependentStoriesPlan.every((clip) => clip.contentArcGrade === 'complete' && clip.transcriptSegmentCount === 2),
  'long-form content-derived planning keeps every emitted clip as a complete two-segment story',
);

const unboundedNaturalStoryCount = 170;
const unboundedNaturalStorySegments = Array.from({ length: unboundedNaturalStoryCount }, (_, index) => {
  const topic = `storytopic${String(index).padStart(3, '0')} workflow${String(index).padStart(3, '0')}`;
  const baseStartMs = index * 30_000;
  return [
    {
      startMs: baseStartMs,
      endMs: baseStartMs + 10_000,
      text: `Why ${topic} fails is that the ${topic} case hides the problem and the ${topic} context is unclear.`,
      speaker: 'Speaker 1',
    },
    {
      startMs: baseStartMs + 10_200,
      endMs: baseStartMs + 22_000,
      text: `Because the ${topic} example shows user pain, so the ${topic} solution shows the result first and completion improves.`,
      speaker: 'Speaker 1',
    },
  ];
}).flat();
const unboundedNaturalStoryCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 10,
  maxDuration: 45,
  sourceDurationMs: 5_100_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, unboundedNaturalStorySegments);
assertEqual(
  unboundedNaturalStoryCandidates.filter((candidate) => candidate.risks?.includes('semantic-story-merged')).length,
  unboundedNaturalStoryCount,
  'candidate generation preserves every complete semantic story beyond bounded review-pool safety limits',
);
const unboundedNaturalStoryPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 10,
  maxDuration: 45,
  sourceDurationMs: 5_100_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, unboundedNaturalStorySegments);
assertEqual(
  unboundedNaturalStoryPlan.length,
  unboundedNaturalStoryCount,
  'content-derived planning publishes every natural continuous story beyond internal candidate safety limits',
);
assertRule(
  unboundedNaturalStoryPlan.every((clip) =>
    clip.risks?.includes('semantic-story-merged') &&
      clip.contentArcGrade === 'complete' &&
      clip.transcriptSegmentCount === 2
  ),
  'unbounded content-derived planning keeps every large-workload clip as a complete two-segment semantic story',
);

const oversizedSemanticStoryCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 10,
  maxDuration: 40,
  sourceDurationMs: 90_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 11_000,
    text: 'Why retention drops is that the opening hides the problem viewers should care about.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 11_200,
    endMs: 23_500,
    text: 'Because the onboarding case shows user pain before people understand the workflow context.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 23_700,
    endMs: 36_000,
    text: 'The mistake is unclear context and the risk is that viewers leave before the value appears.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 36_200,
    endMs: 49_000,
    text: 'So the fix is to show the outcome first, then the payoff improves completion and the result is clear.',
    speaker: 'Speaker 1',
  },
]);
const truncatedSemanticStoryCandidates = oversizedSemanticStoryCandidates.filter((candidate) =>
  candidate.risks?.includes('semantic-story-merged') &&
    typeof candidate.speechEndMs === 'number' &&
    typeof candidate.sourceEndMs === 'number' &&
    candidate.speechEndMs > candidate.sourceEndMs,
);
assertEqual(
  truncatedSemanticStoryCandidates.length,
  0,
  'semantic story merge candidates are rejected instead of truncating speech beyond the maximum clip duration',
);

const semanticContinuityCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 10,
  maxDuration: 45,
  sourceDurationMs: 50_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 12_000,
    text: 'Why retention drops is simple: the opening hides the result viewers came for.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 12_200,
    endMs: 24_500,
    text: 'Because the onboarding case shows viewer pain before people understand the workflow context.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 24_700,
    endMs: 37_000,
    text: 'The problem is unclear context, so the fix is to show the outcome first and the payoff improves completion.',
    speaker: 'Speaker 1',
  },
]);
const llmPartialSemanticStoryPlan = parseLlmSlicePlan(
  JSON.stringify([
    {
      candidateId: 'transcript-3',
      title: 'Only the payoff',
      reason: 'The LLM picked the high-scoring payoff fragment without the setup.',
      qualityScore: 0.96,
      continuityScore: 0.9,
    },
  ]),
  {
    ...baseParams,
    minDuration: 10,
    maxDuration: 45,
    sourceDurationMs: 50_000,
    continuityLevel: 'standard',
    enableRepeatFilter: true,
  },
  multiSlotSemanticContinuityPlan,
  semanticContinuityCandidates,
);
assertEqual(
  llmPartialSemanticStoryPlan[0]?.candidateId,
  'semantic-story-1-3',
  'LLM partial semantic selections are repaired to the complete merged story candidate',
);
assertEqual(
  llmPartialSemanticStoryPlan[0]?.transcriptSegmentCount,
  3,
  'LLM semantic repair keeps all adjacent understood segments instead of returning an incomplete payoff fragment',
);
assertArrayIncludes(
  llmPartialSemanticStoryPlan[0]?.risks,
  'semantic-story-merged',
  'LLM semantic repair preserves story-merge evidence for review',
);

const llmMixedStrongAndSparseCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 10,
  maxDuration: 45,
  sourceDurationMs: 90_000,
  continuityLevel: 'standard',
  enableRepeatFilter: false,
}, [
  {
    startMs: 0,
    endMs: 10_000,
    text: 'Why viewer retention drops is that the opening hides the result and the problem is unclear.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 10_200,
    endMs: 22_000,
    text: 'Because the onboarding case shows the pain, so the fix is to show the outcome first and completion improves.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 50_000,
    endMs: 62_000,
    text: 'Pricing context and invoice details are briefly mentioned here.',
    speaker: 'Speaker 1',
  },
]);
const llmMixedStrongAndSparseFallbackPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 10,
  maxDuration: 45,
  sourceDurationMs: 90_000,
  continuityLevel: 'standard',
  enableRepeatFilter: false,
}, [
  {
    startMs: 0,
    endMs: 10_000,
    text: 'Why viewer retention drops is that the opening hides the result and the problem is unclear.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 10_200,
    endMs: 22_000,
    text: 'Because the onboarding case shows the pain, so the fix is to show the outcome first and completion improves.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 50_000,
    endMs: 62_000,
    text: 'Pricing context and invoice details are briefly mentioned here.',
    speaker: 'Speaker 1',
  },
]);
const llmMixedStrongAndSparsePlan = parseLlmSlicePlan(
  JSON.stringify([
    {
      candidateId: 'semantic-story-1-2',
      title: 'Strong continuous story',
      reason: 'This is the complete continuous content group.',
    },
    {
      candidateId: 'transcript-3',
      title: 'Sparse single-segment review clip',
      reason: 'The model tried to append a sparse review candidate after a strong story.',
    },
  ]),
  {
    ...baseParams,
    minDuration: 10,
    maxDuration: 45,
    sourceDurationMs: 90_000,
    continuityLevel: 'standard',
    enableRepeatFilter: false,
  },
  llmMixedStrongAndSparseFallbackPlan,
  llmMixedStrongAndSparseCandidates,
);
assertEqual(
  llmMixedStrongAndSparsePlan.length,
  1,
  'LLM planning drops sparse review candidates whenever strong content-derived clips exist in the selected plan',
);
assertRule(
  llmMixedStrongAndSparsePlan.every((clip) => !clip.risks?.includes('sparse-transcript-speech')),
  'LLM planning keeps output clip count derived from strong continuous content instead of model-selected sparse review extras',
);
assertEqual(
  llmMixedStrongAndSparsePlan[0]?.candidateId,
  'semantic-story-1-2',
  'LLM planning preserves the complete strong semantic story when filtering sparse review extras',
);

const llmSparseOnlyAgainstStrongFallbackPlan = parseLlmSlicePlan(
  JSON.stringify([
    {
      candidateId: 'transcript-3',
      title: 'Sparse single-segment review clip',
      reason: 'The model tried to replace a strong content-derived story with a sparse review candidate.',
    },
  ]),
  {
    ...baseParams,
    minDuration: 10,
    maxDuration: 45,
    sourceDurationMs: 90_000,
    continuityLevel: 'standard',
    enableRepeatFilter: false,
  },
  llmMixedStrongAndSparseFallbackPlan,
  llmMixedStrongAndSparseCandidates,
);
assertEqual(
  llmSparseOnlyAgainstStrongFallbackPlan.length,
  1,
  'LLM planning refuses to replace deterministic strong content-derived clips with sparse-only model selections',
);
assertEqual(
  llmSparseOnlyAgainstStrongFallbackPlan[0]?.candidateId,
  'semantic-story-1-2',
  'LLM sparse-only selections fall back to the complete deterministic content group when one exists',
);
assertRule(
  !llmSparseOnlyAgainstStrongFallbackPlan.some((clip) => clip.risks?.includes('sparse-transcript-speech')),
  'LLM sparse-only selections cannot override strong content-derived fallback clips',
);

const llmExtraStrongStoryCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 10,
  maxDuration: 45,
  sourceDurationMs: 120_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 10_000,
    text: 'Why viewer retention drops is that the opening hides the result and the problem is unclear.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 10_200,
    endMs: 22_000,
    text: 'Because the onboarding case shows the pain, so the fix is to show the outcome first and completion improves.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 60_000,
    endMs: 72_000,
    text: 'Why pricing refunds fail is that invoice context hides the problem, because users see the cost too late, so the solution improves trust.',
    speaker: 'Speaker 1',
  },
]);
const llmExtraStrongStoryFallbackPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 10,
  maxDuration: 45,
  sourceDurationMs: 120_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 10_000,
    text: 'Why viewer retention drops is that the opening hides the result and the problem is unclear.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 10_200,
    endMs: 22_000,
    text: 'Because the onboarding case shows the pain, so the fix is to show the outcome first and completion improves.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 60_000,
    endMs: 72_000,
    text: 'Why pricing refunds fail is that invoice context hides the problem, because users see the cost too late, so the solution improves trust.',
    speaker: 'Speaker 1',
  },
]);
const llmExtraStrongStoryPlan = parseLlmSlicePlan(
  JSON.stringify([
    {
      candidateId: 'semantic-story-1-2',
      title: 'Retention story',
      reason: 'The deterministic fallback already selected this complete story.',
    },
    {
      candidateId: 'transcript-3',
      title: 'Pricing refund story',
      reason: 'The model selected a second non-overlapping complete story from the candidate pool.',
    },
  ]),
  {
    ...baseParams,
    minDuration: 10,
    maxDuration: 45,
    sourceDurationMs: 120_000,
    continuityLevel: 'standard',
    enableRepeatFilter: true,
  },
  llmExtraStrongStoryFallbackPlan,
  llmExtraStrongStoryCandidates,
);
assertEqual(
  llmExtraStrongStoryFallbackPlan.length,
  2,
  'deterministic planning keeps both the merged story and the complete standalone transcript story',
);
assertEqual(
  llmExtraStrongStoryPlan.length,
  2,
  'LLM planning preserves extra non-overlapping strong transcript candidates instead of truncating output to fallback length',
);
assertRule(
  llmExtraStrongStoryPlan.some((clip) => clip.candidateId === 'semantic-story-1-2') &&
    llmExtraStrongStoryPlan.some((clip) => clip.candidateId === 'transcript-3'),
  'LLM planning keeps both canonical fallback clips and additional selected strong transcript clips',
);

const llmExtraStandaloneAgainstNarrowFallbackPlan = parseLlmSlicePlan(
  JSON.stringify([
    {
      candidateId: 'semantic-story-1-2',
      title: 'Retention story',
      reason: 'The deterministic fallback already selected this complete story.',
    },
    {
      candidateId: 'transcript-3',
      title: 'Pricing refund story',
      reason: 'The model selected a second non-overlapping complete story from the candidate pool.',
    },
  ]),
  {
    ...baseParams,
    minDuration: 10,
    maxDuration: 45,
    sourceDurationMs: 120_000,
    continuityLevel: 'standard',
    enableRepeatFilter: true,
  },
  llmExtraStrongStoryFallbackPlan.filter((clip) => clip.candidateId === 'semantic-story-1-2'),
  llmExtraStrongStoryCandidates,
);
assertEqual(
  llmExtraStandaloneAgainstNarrowFallbackPlan.length,
  2,
  'LLM planning merges extra standalone transcript stories even when canonical fallback only contains the merged story',
);
assertRule(
  llmExtraStandaloneAgainstNarrowFallbackPlan.some((clip) => clip.candidateId === 'semantic-story-1-2') &&
    llmExtraStandaloneAgainstNarrowFallbackPlan.some((clip) => clip.candidateId === 'transcript-3'),
  'LLM canonical fallback merging does not truncate additional selected standalone stories',
);

const llmOmittedStrongStoryCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 10,
  maxDuration: 45,
  sourceDurationMs: 120_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 10_000,
    text: 'Why viewer retention drops is that the opening hides the result and the problem is unclear.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 10_200,
    endMs: 22_000,
    text: 'Because the onboarding case shows the pain, so the fix is to show the outcome first and completion improves.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 24_200,
    endMs: 35_000,
    text: 'Why pricing refunds fail is that annual invoice terms hide the cost and the billing problem is unclear.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 35_200,
    endMs: 47_000,
    text: 'Because the refund case shows user pain, so the solution is to show the invoice terms before checkout.',
    speaker: 'Speaker 1',
  },
]);
const llmOmittedStrongStoryFallbackPlan = createTranscriptAssistedSlicePlan({
  ...baseParams,
  minDuration: 10,
  maxDuration: 45,
  sourceDurationMs: 120_000,
  continuityLevel: 'standard',
  enableRepeatFilter: true,
}, [
  {
    startMs: 0,
    endMs: 10_000,
    text: 'Why viewer retention drops is that the opening hides the result and the problem is unclear.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 10_200,
    endMs: 22_000,
    text: 'Because the onboarding case shows the pain, so the fix is to show the outcome first and completion improves.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 24_200,
    endMs: 35_000,
    text: 'Why pricing refunds fail is that annual invoice terms hide the cost and the billing problem is unclear.',
    speaker: 'Speaker 1',
  },
  {
    startMs: 35_200,
    endMs: 47_000,
    text: 'Because the refund case shows user pain, so the solution is to show the invoice terms before checkout.',
    speaker: 'Speaker 1',
  },
]);
const llmOmittedStrongStoryPlan = parseLlmSlicePlan(
  JSON.stringify([
    {
      candidateId: 'semantic-story-1-2',
      title: 'Retention story',
      summary: 'The model selected only the first complete story.',
      reason: 'The selected candidate is valid but incomplete as a full content-derived plan.',
      risks: ['missing-payoff', 'topic-drift'],
    },
  ]),
  {
    ...baseParams,
    minDuration: 10,
    maxDuration: 45,
    sourceDurationMs: 120_000,
    continuityLevel: 'standard',
    enableRepeatFilter: true,
  },
  llmOmittedStrongStoryFallbackPlan,
  llmOmittedStrongStoryCandidates,
);
assertEqual(
  llmOmittedStrongStoryFallbackPlan.length,
  2,
  'deterministic planning finds every distinct complete content-derived story',
);
assertEqual(
  llmOmittedStrongStoryPlan.length,
  2,
  'LLM planning cannot omit a deterministic strong content-derived story to reduce the natural clip count',
);
assertRule(
  llmOmittedStrongStoryPlan.some((clip) => clip.candidateId === 'semantic-story-1-2') &&
    llmOmittedStrongStoryPlan.some((clip) => clip.candidateId === 'semantic-story-3-4'),
  'LLM planning keeps every canonical strong content group when the model selects only a subset',
);
assertRule(
  !llmOmittedStrongStoryPlan.some((clip) =>
    clip.risks?.includes('missing-payoff') || clip.risks?.includes('topic-drift')
  ),
  'LLM planning cannot contaminate canonical strong content groups with model-invented blocking risks',
);

const chineseStoryShapeCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 10,
  maxDuration: 45,
  continuityLevel: 'standard',
}, [
  { startMs: 0, endMs: 11000, text: '\u4e3a\u4ec0\u4e48\u5f88\u591a\u77ed\u89c6\u9891\u526a\u51fa\u6765\u6ca1\u6709\u5b8c\u64ad\uff1f', speaker: 'Speaker 1' },
  { startMs: 11200, endMs: 23000, text: '\u56e0\u4e3a\u5f00\u5934\u6ca1\u6709\u628a\u95ee\u9898\u548c\u573a\u666f\u4ea4\u4ee3\u6e05\u695a\u3002', speaker: 'Speaker 1' },
  { startMs: 23200, endMs: 35000, text: '\u6240\u4ee5\u89e3\u51b3\u529e\u6cd5\u662f\u5148\u7ed9\u7ed3\u679c\uff0c\u518d\u7528\u4e00\u4e2a\u4f8b\u5b50\u8bc1\u660e\u3002', speaker: 'Speaker 1' },
]);
const completeChineseStoryCandidate = chineseStoryShapeCandidates.find((candidate) => candidate.storyShape === 'complete');
assertEqual(
  completeChineseStoryCandidate?.storyShape,
  'complete',
  'Chinese speech-to-text candidate scoring detects complete hook-context-payoff windows',
);
assertRule(
  !completeChineseStoryCandidate?.risks?.includes('missing-payoff'),
  'complete Chinese hook-context-payoff windows are not flagged as missing a payoff',
);
assertEqual(
  completeChineseStoryCandidate?.contentArcGrade,
  'complete',
  'Chinese speech-to-text candidate scoring grades complete hook-setup-conflict-payoff arcs as complete',
);
assertArrayIncludes(
  completeChineseStoryCandidate?.contentArcStages,
  'conflict',
  'Chinese speech-to-text content arcs detect problem or pain stages',
);

const thinStoryCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 10,
  maxDuration: 20,
  continuityLevel: 'standard',
}, [
  { startMs: 0, endMs: 12000, text: 'The team had a difficult launch with many details still unclear', speaker: 'Speaker 1' },
  { startMs: 50000, endMs: 62000, text: 'The next section starts a separate topic with no payoff yet', speaker: 'Speaker 1' },
]);
assertArrayIncludes(
  thinStoryCandidates[0]?.risks,
  'missing-payoff',
  'speech-to-text candidate scoring flags setup-only windows that are weak short-video slices',
);
assertEqual(
  thinStoryCandidates[0]?.contentArcGrade,
  'partial',
  'setup-only transcript windows are graded as partial content arcs instead of complete publishable shorts',
);
assertArrayIncludes(
  thinStoryCandidates[0]?.contentArcMissingStages,
  'payoff',
  'setup-only transcript windows surface missing payoff stages for review',
);

const topicDriftCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 30,
  maxDuration: 45,
  continuityLevel: 'standard',
}, [
  { startMs: 0, endMs: 10000, text: 'Retention drops when the opening hides the viewer pain.', speaker: 'Speaker 1' },
  { startMs: 10200, endMs: 21000, text: 'So the fix is to name the result and prove it fast.', speaker: 'Speaker 1' },
  { startMs: 21200, endMs: 32000, text: 'The pricing model uses annual invoices and refund terms.', speaker: 'Speaker 1' },
]);
assertNumberBetween(
  topicDriftCandidates[0]?.topicCoherenceScore,
  0,
  0.74,
  'speech-to-text candidate scoring lowers topic coherence when one slice crosses unrelated topics',
);
assertEqual(
  topicDriftCandidates[0]?.topicCoherenceGrade,
  'weak',
  'speech-to-text candidate scoring grades cross-topic transcript windows as weak topic coherence',
);
assertRule(
  typeof topicDriftCandidates[0]?.topicShiftCount === 'number' && topicDriftCandidates[0].topicShiftCount >= 1,
  'cross-topic transcript windows expose the number of topic shifts for review',
);
assertArrayIncludes(
  topicDriftCandidates[0]?.publishabilityIssues,
  'topic-drift',
  'cross-topic transcript windows include topic drift publishability issue tags',
);

const duplicateCandidatePlan = normalizeCandidateSlicePlan([
  {
    index: 0,
    startMs: 0,
    durationMs: 22000,
    label: 'Duplicate lower score',
    qualityScore: 0.62,
    summary: 'The speaker explains the same retention spike with weaker framing.',
  },
  {
    index: 1,
    startMs: 1000,
    durationMs: 22000,
    label: 'Duplicate higher score',
    qualityScore: 0.93,
    summary: 'The speaker explains the same retention spike with stronger framing.',
  },
  {
    index: 2,
    startMs: 32000,
    durationMs: 15000,
    label: 'Distinct later topic',
    qualityScore: 0.72,
    summary: 'A different example covers the pricing lesson.',
  },
], {
  ...baseParams,
});
assertEqual(
  duplicateCandidatePlan[0]?.startMs,
  1000,
  'candidate normalization keeps the strongest candidate when two windows heavily overlap',
);
assertEqual(
  duplicateCandidatePlan.length,
  2,
  'candidate normalization removes near-duplicate windows instead of producing repetitive short videos',
);

const partialOverlapCandidatePlan = normalizeCandidateSlicePlan([
  {
    index: 0,
    startMs: 0,
    durationMs: 30000,
    label: 'First complete speech window',
    qualityScore: 0.86,
    continuityScore: 0.9,
    storyShape: 'complete',
    transcriptText: 'The first window explains one complete answer.',
    transcriptSegmentCount: 3,
    speechContinuityGrade: 'strong',
  },
  {
    index: 1,
    startMs: 25000,
    durationMs: 30000,
    label: 'Partially repeated overlap',
    qualityScore: 0.85,
    continuityScore: 0.9,
    storyShape: 'complete',
    transcriptText: 'The second window repeats the previous ending before a new answer.',
    transcriptSegmentCount: 3,
    speechContinuityGrade: 'strong',
  },
], {
  ...baseParams,
});
assertEqual(
  partialOverlapCandidatePlan.length,
  1,
  'candidate normalization rejects partially overlapping speech windows so slice outputs do not repeat source content',
);
const shortPhraseDuplicateCandidatePlan = normalizeCandidateSlicePlan([
  {
    index: 0,
    startMs: 0,
    durationMs: 12_000,
    label: 'Refund fix A',
    qualityScore: 0.9,
    continuityScore: 0.9,
    storyShape: 'complete',
    transcriptText: 'Refund fix improves retention.',
    transcriptSegmentCount: 1,
    speechContinuityGrade: 'strong',
  },
  {
    index: 1,
    startMs: 16_000,
    durationMs: 12_000,
    label: 'Refund fix B',
    qualityScore: 0.89,
    continuityScore: 0.9,
    storyShape: 'complete',
    transcriptText: 'Refund fix improved retention.',
    transcriptSegmentCount: 1,
    speechContinuityGrade: 'strong',
  },
  {
    index: 2,
    startMs: 36_000,
    durationMs: 12_000,
    label: 'Pricing setup',
    qualityScore: 0.8,
    continuityScore: 0.9,
    storyShape: 'complete',
    transcriptText: 'Pricing setup explains invoice pain.',
    transcriptSegmentCount: 1,
    speechContinuityGrade: 'strong',
  },
], {
  ...baseParams,
  minDuration: 5,
  maxDuration: 60,
  enableRepeatFilter: true,
});
assertEqual(
  shortPhraseDuplicateCandidatePlan.filter((candidate) => candidate.transcriptText?.includes('Refund fix')).length,
  1,
  'candidate normalization removes short one-sentence near-duplicates from external or LLM candidate inputs',
);
assertRule(
  shortPhraseDuplicateCandidatePlan.some((candidate) => candidate.transcriptText?.includes('Pricing setup')),
  'candidate normalization keeps distinct short transcript candidates while removing short near-duplicates',
);

const invalidCandidateTimingPlan = normalizeCandidateSlicePlan([
  {
    index: 0,
    startMs: 0,
    durationMs: -30000,
    label: 'Negative duration candidate',
    qualityScore: 0.99,
  },
  {
    index: 1,
    startMs: 10000,
    durationMs: 0,
    label: 'Zero duration candidate',
    qualityScore: 0.98,
  },
  {
    index: 2,
    startMs: 30000,
    durationMs: 16000,
    label: 'Valid normalized candidate',
    qualityScore: 0.7,
  },
], {
  ...baseParams,
});
assertEqual(
  invalidCandidateTimingPlan[0]?.label,
  'Valid normalized candidate',
  'candidate normalization rejects non-positive durations instead of repairing them into minimum-length clips',
);
assertEqual(
  invalidCandidateTimingPlan[0]?.startMs,
  30000,
  'candidate normalization keeps valid candidates after dirty timing entries',
);

const dirtyTimingMetadataPlan = normalizeCandidateSlicePlan([
  {
    index: 0,
    startMs: 10000,
    durationMs: 20000,
    label: 'Dirty timing metadata',
    qualityScore: 0.82,
    continuityScore: 0.9,
    storyShape: 'complete',
    sourceStartMs: 50000,
    sourceEndMs: 9000,
    speechStartMs: 0,
    speechEndMs: 50000,
    transcriptText: 'Start with the result, explain the reason, and finish with the takeaway.',
    transcriptCoverageScore: 0.95,
    transcriptSegmentCount: 3,
    speechContinuityGrade: 'strong',
  },
], {
  ...baseParams,
});
assertEqual(
  dirtyTimingMetadataPlan[0]?.sourceStartMs,
  10000,
  'candidate normalization repairs dirty sourceStartMs to the actual render start',
);
assertEqual(
  dirtyTimingMetadataPlan[0]?.sourceEndMs,
  30000,
  'candidate normalization repairs dirty sourceEndMs to the actual render end',
);
assertEqual(
  dirtyTimingMetadataPlan[0]?.speechStartMs,
  10000,
  'candidate normalization clamps dirty speechStartMs inside the repaired source range',
);
assertEqual(
  dirtyTimingMetadataPlan[0]?.speechEndMs,
  30000,
  'candidate normalization clamps dirty speechEndMs inside the repaired source range',
);
assertEqual(
  dirtyTimingMetadataPlan[0]?.boundaryPaddingBeforeMs,
  0,
  'candidate normalization recomputes leading boundary padding after timing repair',
);
assertEqual(
  dirtyTimingMetadataPlan[0]?.boundaryPaddingAfterMs,
  0,
  'candidate normalization recomputes trailing boundary padding after timing repair',
);
assertArrayIncludes(
  dirtyTimingMetadataPlan[0]?.risks,
  'timing-metadata-repaired',
  'candidate normalization records timing metadata repairs for quality review',
);

const publishabilityRankedPlan = normalizeCandidateSlicePlan([
  {
    index: 0,
    startMs: 0,
    durationMs: 20000,
    label: 'Weak but early',
    qualityScore: 0.95,
    continuityScore: 0.35,
    storyShape: 'thin',
    risks: ['missing-payoff'],
    transcriptCoverageScore: 0.2,
    transcriptSegmentCount: 1,
    speechContinuityGrade: 'weak',
  },
  {
    index: 1,
    startMs: 30000,
    durationMs: 20000,
    label: 'Complete publishable',
    qualityScore: 0.78,
    continuityScore: 0.92,
    storyShape: 'complete',
    risks: [],
    transcriptCoverageScore: 0.96,
    transcriptSegmentCount: 4,
    speechContinuityGrade: 'strong',
  },
], {
  ...baseParams,
});
assertEqual(
  publishabilityRankedPlan[0]?.label,
  'Complete publishable',
  'quality-first candidate normalization ranks complete continuous slices above early but weak high-quality fragments',
);
assertNumberBetween(
  publishabilityRankedPlan[0]?.publishabilityScore,
  0.75,
  1,
  'quality-first candidate normalization exposes publishability scores on selected clips',
);
assertEqual(
  publishabilityRankedPlan[0]?.publishabilityGrade,
  'good',
  'quality-first candidate normalization grades complete continuous slices as good publish candidates',
);

const platformRankedPlan = normalizeCandidateSlicePlan([
  {
    index: 0,
    startMs: 0,
    durationMs: 90000,
    label: 'Long context that only works on Bilibili',
    qualityScore: 0.9,
    continuityScore: 0.94,
    storyShape: 'complete',
    publishabilityScore: 0.9,
    boundaryQualityScore: 0.84,
    hookStrength: 'contextual',
    endingCompleteness: 'complete',
    contentArcScore: 1,
    contentArcGrade: 'complete',
    topicCoherenceScore: 0.9,
    topicCoherenceGrade: 'strong',
    transcriptCoverageScore: 0.95,
    transcriptSegmentCount: 6,
    speechContinuityGrade: 'strong',
  },
  {
    index: 1,
    startMs: 100000,
    durationMs: 32000,
    label: 'Short vertical-ready hook',
    qualityScore: 0.83,
    continuityScore: 0.9,
    storyShape: 'complete',
    publishabilityScore: 0.84,
    boundaryQualityScore: 0.9,
    hookStrength: 'strong',
    endingCompleteness: 'complete',
    contentArcScore: 1,
    contentArcGrade: 'complete',
    topicCoherenceScore: 0.88,
    topicCoherenceGrade: 'strong',
    transcriptCoverageScore: 0.94,
    transcriptSegmentCount: 4,
    speechContinuityGrade: 'strong',
  },
], {
  ...baseParams,
  targetPlatform: 'douyin',
  maxDuration: 120,
});
assertEqual(
  platformRankedPlan[0]?.label,
  'Short vertical-ready hook',
  'quality-first candidate normalization ranks platform-ready short-video slices above generic long contexts on Douyin',
);
assertEqual(
  platformRankedPlan[0]?.platformReadinessGrade,
  'ready',
  'platform-ready short-video candidates are graded ready for the selected platform',
);

const bilibiliLongContextPlan = normalizeCandidateSlicePlan([
  {
    index: 0,
    startMs: 0,
    durationMs: 90000,
    label: 'Long context that fits Bilibili',
    qualityScore: 0.9,
    continuityScore: 0.94,
    storyShape: 'complete',
    publishabilityScore: 0.9,
    boundaryQualityScore: 0.84,
    hookStrength: 'contextual',
    endingCompleteness: 'complete',
    contentArcScore: 1,
    contentArcGrade: 'complete',
    topicCoherenceScore: 0.9,
    topicCoherenceGrade: 'strong',
    transcriptCoverageScore: 0.95,
    transcriptSegmentCount: 6,
    speechContinuityGrade: 'strong',
  },
], {
  ...baseParams,
  targetPlatform: 'bilibili',
  maxDuration: 120,
});
assertNumberBetween(
  bilibiliLongContextPlan[0]?.platformReadinessScore,
  0.68,
  1,
  'Bilibili platform readiness tolerates longer complete context windows',
);
assertRule(
  ['ready', 'review'].includes(bilibiliLongContextPlan[0]?.platformReadinessGrade),
  `Bilibili long context slices remain reviewable instead of rejected (got ${JSON.stringify(bilibiliLongContextPlan[0]?.platformReadinessGrade)})`,
);

const xiaohongshuWeakHookPlan = normalizeCandidateSlicePlan([
  {
    index: 0,
    startMs: 0,
    durationMs: 32000,
    label: 'Lifestyle context without a strong cover hook',
    qualityScore: 0.86,
    continuityScore: 0.9,
    storyShape: 'complete',
    publishabilityScore: 0.86,
    boundaryQualityScore: 0.68,
    hookStrength: 'contextual',
    endingCompleteness: 'complete',
    contentArcScore: 1,
    contentArcGrade: 'complete',
    topicCoherenceScore: 0.9,
    topicCoherenceGrade: 'strong',
    transcriptCoverageScore: 0.94,
    transcriptSegmentCount: 4,
    speechContinuityGrade: 'strong',
  },
], {
  ...baseParams,
  targetPlatform: 'xiaohongshu',
});
assertArrayIncludes(
  xiaohongshuWeakHookPlan[0]?.platformReadinessIssues,
  'platform-hook-not-strong',
  'Xiaohongshu readiness requires a strong opening hook for cover-feed publishing',
);
assertRule(
  ['review', 'reject'].includes(xiaohongshuWeakHookPlan[0]?.platformReadinessGrade),
  `Xiaohongshu contextual-hook slices require review before publishing (got ${JSON.stringify(xiaohongshuWeakHookPlan[0]?.platformReadinessGrade)})`,
);

const weakBoundaryCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 10,
  maxDuration: 45,
  continuityLevel: 'standard',
}, [
  { startMs: 0, endMs: 12000, text: 'The team talked through a few implementation details', speaker: 'Speaker 1' },
  { startMs: 12200, endMs: 24500, text: 'and there were still unresolved tradeoffs before the next section', speaker: 'Speaker 1' },
]);
assertEqual(
  weakBoundaryCandidates[0]?.hookStrength,
  'weak',
  'speech-to-text candidate scoring detects weak openings that are poor self-media hooks',
);
assertEqual(
  weakBoundaryCandidates[0]?.endingCompleteness,
  'open',
  'speech-to-text candidate scoring detects open endings that need review before publishing',
);
assertArrayIncludes(
  weakBoundaryCandidates[0]?.publishabilityIssues,
  'weak-hook',
  'weak-boundary transcript candidates surface weak opening publishability issues',
);
assertArrayIncludes(
  weakBoundaryCandidates[0]?.publishabilityIssues,
  'open-ending',
  'weak-boundary transcript candidates surface open ending publishability issues',
);
assertArrayIncludes(
  weakBoundaryCandidates[0]?.contentArcMissingStages,
  'hook',
  'weak-boundary transcript candidates surface missing hook content-arc stages',
);
assertArrayIncludes(
  weakBoundaryCandidates[0]?.contentArcMissingStages,
  'payoff',
  'weak-boundary transcript candidates surface missing payoff content-arc stages',
);
assertArrayIncludes(
  weakBoundaryCandidates[0]?.publishabilityIssues,
  'missing-content-payoff',
  'weak-boundary transcript candidates include content-arc publishability issue tags',
);

const policy = getVideoSlicePlanningPolicy({
  ...baseParams,
  targetPlatform: 'douyin',
  targetAspectRatio: '9:16',
  videoObjectFit: 'cover',
  idealDuration: 42,
  continuityLevel: 'strict',
  customKeywords: ['hook', 'retention', 'retention'],
});
assertEqual(policy.targetPlatform, 'douyin', 'planning policy preserves the target publishing platform');
assertEqual(policy.targetAspectRatio, '9:16', 'planning policy preserves the target aspect ratio');
assertEqual(policy.videoObjectFit, 'cover', 'planning policy preserves the target object-fit behavior');
assertRule(
  !('sliceCountMode' in policy),
  'planning policy does not preserve legacy target count mode for Smart Slice',
);
assertRule(
  !('targetSliceCount' in policy),
  'planning policy does not preserve legacy target slice count for Smart Slice',
);
assertEqual(policy.idealDurationMs, 42000, 'planning policy normalizes the ideal duration to milliseconds');
assertEqual(policy.continuityJoinGapMs, 800, 'strict continuity policy uses a tighter transcript join gap');
assertEqual(policy.customKeywords.length, 2, 'planning policy trims and deduplicates custom keywords');
const defaultSegmentationDensityPolicy = getVideoSlicePlanningPolicy({
  ...baseParams,
  continuityLevel: 'standard',
});
const maximizedSegmentationDensityPolicy = getVideoSlicePlanningPolicy({
  ...baseParams,
  continuityLevel: 'strict',
  segmentationDensity: 'maximize-continuity',
});
assertEqual(
  defaultSegmentationDensityPolicy.segmentationDensity,
  'default',
  'planning policy defaults to standard segmentation density',
);
assertEqual(
  maximizedSegmentationDensityPolicy.segmentationDensity,
  'maximize-continuity',
  'planning policy preserves the maximize-continuity segmentation density',
);
assertRule(
  maximizedSegmentationDensityPolicy.candidateJoinGapMs > defaultSegmentationDensityPolicy.candidateJoinGapMs,
  'maximize-continuity segmentation density expands the Smart Cut Engine candidate join gap',
);
assertRule(
  maximizedSegmentationDensityPolicy.continuityJoinGapMs === 800,
  'maximize-continuity segmentation density does not weaken strict boundary continuity repair',
);
assertEqual(
  getVideoSlicePlanningPolicy({ ...baseParams, sourceDurationMs: 35000 }).sourceDurationMs,
  35000,
  'planning policy carries the source media duration into deterministic slice normalization',
);

const platformDefaultPolicy = getVideoSlicePlanningPolicy({
  ...baseParams,
  targetPlatform: 'douyin',
  targetAspectRatio: 'auto',
});
assertEqual(
  platformDefaultPolicy.targetAspectRatio,
  '9:16',
  'planning policy resolves auto aspect ratio to the target platform publishing standard',
);

const noTranscriptAutoLlmPlan = parseLlmSlicePlan(
  JSON.stringify([
    { startMs: 40000, durationMs: 999999, label: 'Late' },
    { startMs: 0, durationMs: 1000, label: 'Short' },
  ]),
  {
    ...baseParams,
  },
  deterministicPlan,
);
assertEqual(
  noTranscriptAutoLlmPlan.length,
  0,
  'auto no-transcript LLM plans reject raw timing windows that are not backed by real transcript content evidence',
);

const noTranscriptLlmPlan = parseLlmSlicePlan(
  JSON.stringify([
    { startMs: 40000, durationMs: 999999, label: 'Late' },
    { startMs: 0, durationMs: 1000, label: 'Short' },
  ]),
  {
    ...baseParams,
  },
  deterministicPlan,
);
assertEqual(
  noTranscriptLlmPlan.length,
  0,
  'no-transcript LLM plans reject raw timing windows instead of filling fabricated fallback clips',
);

const punctuationOnlyLlmTitleCandidates = buildTranscriptSliceCandidates({
  ...baseParams,
  minDuration: 10,
  maxDuration: 45,
  sourceDurationMs: 45_000,
}, [
  {
    startMs: 0,
    endMs: 18_000,
    text: 'A stable transcript title should survive even when the model returns only punctuation.',
    speaker: 'Speaker 1',
  },
]);
const punctuationOnlyLlmTitlePlan = parseLlmSlicePlan(
  JSON.stringify([
    { startMs: 0, durationMs: 15000, title: '???', label: '...' },
  ]),
  {
    ...baseParams,
  },
  punctuationOnlyLlmTitleCandidates,
  punctuationOnlyLlmTitleCandidates,
);
assertRule(
  !/^[^\p{L}\p{N}]+$/u.test(punctuationOnlyLlmTitlePlan[0]?.label ?? ''),
  'LLM parsing never emits punctuation-only clip labels for task display or native output naming',
);
assertRule(
  !/^[^\p{L}\p{N}]+$/u.test(punctuationOnlyLlmTitlePlan[0]?.title ?? ''),
  'LLM parsing never emits punctuation-only clip titles for generated file names',
);
assertEqual(
  punctuationOnlyLlmTitlePlan[0]?.label,
  punctuationOnlyLlmTitleCandidates[0]?.label,
  'LLM parsing falls back to stable semantic labels when model titles contain no words',
);

const dirtyLlmPlan = parseLlmSlicePlan(
  JSON.stringify([
    { startMs: 0, durationMs: -20000, label: 'Negative duration' },
    { startMs: 15000, endMs: 15000, label: 'Zero duration by endMs' },
    { startMs: 'bad', durationMs: 15000, label: 'Invalid start' },
    { startMs: 30000, durationMs: 18000, label: 'Valid after dirty candidates' },
  ]),
  {
    ...baseParams,
  },
  deterministicPlan,
);
assertEqual(
  dirtyLlmPlan.length,
  0,
  'LLM parsing rejects dirty raw timing survivors when no transcript candidate evidence exists',
);

const sourceBoundedLlmPlan = parseLlmSlicePlan(
  JSON.stringify([
    { startMs: 40000, durationMs: 20000, label: 'Outside source' },
    { startMs: 0, durationMs: 15000, label: 'Inside source' },
  ]),
  {
    ...baseParams,
    sourceDurationMs: 32000,
  },
  sourceBoundedDeterministicPlan,
);
assertEqual(
  sourceBoundedLlmPlan.length,
  0,
  'source-duration-aware no-transcript LLM plans reject raw model timing instead of fabricating bounded clips',
);

await assertRejectsAsync(
  () => createSmartCutEngineSlicePlan({
    params: {
      ...baseParams,
      mode: 'interview',
      minDuration: 10,
      maxDuration: 90,
      sourceDurationMs: 60_000,
    },
    sourceAssetUuid: 'check-interview-without-speakers',
    sourceDurationMs: 60_000,
    transcriptSegments: [
      {
        startMs: 0,
        endMs: 8_000,
        text: 'What is the main retention problem?',
      },
      {
        startMs: 8_200,
        endMs: 30_000,
        text: 'The opening hides the result, so viewers do not understand why they should continue watching.',
      },
    ],
    llmReview: async ({ candidates, contentUnits }) => ({
      rankedCandidateIds: candidates.map((candidate) => candidate.id),
      referencedUnitIds: contentUnits.map((unit) => unit.id),
      reviewNotes: ['ID-only test review.'],
    }),
  }),
  'MISSING_MULTI_SPEAKER_DIARIZATION',
  'Smart Cut Engine rejects interview planning when transcript evidence has no real speaker diarization labels',
);

await createSmartCutEngineSlicePlan({
  params: {
    ...baseParams,
    mode: 'interview',
    minDuration: 10,
    maxDuration: 90,
    sourceDurationMs: 60_000,
  },
  sourceAssetUuid: 'check-interview-with-speakers',
  sourceDurationMs: 60_000,
  transcriptSegments: [
    {
      startMs: 0,
      endMs: 8_000,
      speaker: 'interviewer',
      text: 'What is the main retention problem?',
    },
    {
      startMs: 8_200,
      endMs: 30_000,
      speaker: 'guest',
      text: 'The opening hides the result, so viewers do not understand why they should continue watching.',
    },
  ],
  llmReview: async ({ candidates }) => ({
    rankedCandidateIds: candidates.map((candidate) => candidate.id),
    referencedUnitIds: [...new Set(candidates.flatMap((candidate) => candidate.unitIds))],
    reviewNotes: ['ID-only test review.'],
  }),
}).then((result) => {
  assertRule(
    result.speakerEvidence.profiles.length >= 2 &&
      result.clips.some((clip) => clip.speakerRoles?.includes('interviewer')) &&
      result.clips.some((clip) => clip.speakerRoles?.includes('guest')),
    'Smart Cut Engine preserves real interviewer and guest speaker roles for dialogue clips',
  );
}).catch((error) => {
  failures.push(
    `Smart Cut Engine accepts interview planning when real speaker labels exist (${error instanceof Error ? error.message : String(error)})`,
  );
});

await createSmartCutEngineSlicePlan({
  params: {
    ...baseParams,
    mode: 'interview',
    minDuration: 10,
    maxDuration: 90,
    sourceDurationMs: 80_000,
  },
  sourceAssetUuid: 'check-interview-role-inference-by-question',
  sourceDurationMs: 80_000,
  transcriptSegments: [
    {
      startMs: 0,
      endMs: 8_000,
      speaker: 'guest',
      text: 'Before we begin, the most important issue is viewer retention.',
    },
    {
      startMs: 8_200,
      endMs: 15_000,
      speaker: 'host',
      text: 'What is the main retention problem?',
    },
    {
      startMs: 15_200,
      endMs: 36_000,
      speaker: 'guest',
      text: 'The opening hides the result, so viewers do not understand why they should continue watching.',
    },
  ],
  llmReview: async ({ candidates }) => ({
    rankedCandidateIds: candidates.map((candidate) => candidate.id),
    referencedUnitIds: [...new Set(candidates.flatMap((candidate) => candidate.unitIds))],
    reviewNotes: ['ID-only test review.'],
  }),
}).then((result) => {
  const rolesBySpeaker = new Map(result.speakerEvidence.profiles.map((profile) => [profile.id, profile.role]));
  assertEqual(
    rolesBySpeaker.get('speaker-host'),
    'interviewer',
    'Smart Cut Engine assigns interviewer role to the speaker with question evidence, not just the first speaker',
  );
  assertEqual(
    rolesBySpeaker.get('speaker-guest'),
    'guest',
    'Smart Cut Engine preserves guest role when the guest speaks before the interviewer question',
  );
}).catch((error) => {
  failures.push(
    `Smart Cut Engine infers interview roles from question evidence (${error instanceof Error ? error.message : String(error)})`,
  );
});

const dialogueAgentTalkingHeadPlan = await createSmartCutEngineSlicePlan({
  params: {
    ...baseParams,
    mode: 'talking-head',
    segmentationAgentId: 'dialogue-turn-agent',
    minDuration: 10,
    maxDuration: 90,
    sourceDurationMs: 70_000,
  },
  sourceAssetUuid: 'check-dialogue-agent-overrides-speaking-mode',
  sourceDurationMs: 70_000,
  transcriptSegments: [
    {
      startMs: 0,
      endMs: 9_000,
      speaker: 'host',
      text: 'Why does activation drop after signup?',
    },
    {
      startMs: 9_200,
      endMs: 30_000,
      speaker: 'guest',
      text: 'It drops because the first action is unclear, so the fix is to guide users to one measurable activation event.',
    },
  ],
  llmReview: async ({ candidates, contentUnits }) => ({
    rankedCandidateIds: candidates.map((candidate) => candidate.id),
    referencedUnitIds: contentUnits.map((unit) => unit.id),
    reviewNotes: ['Dialogue agent Q/A preset check.'],
  }),
});
assertEqual(
  dialogueAgentTalkingHeadPlan.presetId,
  'interview-one-question-one-answer',
  'Smart Cut Engine lets dialogue-turn-agent select the dialogue Q/A slicer even when the UI mode is talking-head',
);
assertRule(
  dialogueAgentTalkingHeadPlan.clips.some((clip) =>
    clip.contentUnitIds?.length >= 2 &&
      clip.speakerRoles?.includes('interviewer') &&
      clip.speakerRoles?.includes('guest') &&
      clip.transcriptText?.includes('Why does activation drop') &&
      clip.transcriptText?.includes('one measurable activation event')
  ),
  'dialogue-turn-agent talking-head planning keeps the question and answer in one complete semantic clip',
);

const explicitCommerceWithDialogueAgentPlan = await createSmartCutEngineSlicePlan({
  params: {
    ...baseParams,
    mode: 'commerce-live',
    segmentationAgentId: 'dialogue-turn-agent',
    minDuration: 10,
    maxDuration: 90,
    sourceDurationMs: 70_000,
  },
  sourceAssetUuid: 'check-explicit-commerce-mode-before-default-dialogue-agent',
  sourceDurationMs: 70_000,
  transcriptSegments: [
    {
      startMs: 0,
      endMs: 18_000,
      speaker: 'Host',
      text: 'Why the checkout offer matters is that buyers need a clear bundle before the deadline.',
    },
    {
      startMs: 18_200,
      endMs: 34_000,
      speaker: 'Guest',
      text: 'The checkout bundle includes the bonus and the support plan for this product.',
    },
  ],
});
assertEqual(
  explicitCommerceWithDialogueAgentPlan.presetId,
  'commerce-live-product-cards',
  'Smart Cut Engine keeps explicit industry slice modes ahead of the default dialogue segmentation agent',
);

const keywordPrioritizedPlan = await createSmartCutEngineSlicePlan({
  params: {
    ...baseParams,
    mode: 'talking-head',
    customKeywords: ['refund'],
    minDuration: 10,
    maxDuration: 90,
    sourceDurationMs: 80_000,
  },
  sourceAssetUuid: 'check-custom-keyword-id-review',
  sourceDurationMs: 80_000,
  transcriptSegments: [
    {
      startMs: 0,
      endMs: 18_000,
      text: 'First we introduce the agenda and explain the background context for today.',
    },
    {
      startMs: 20_000,
      endMs: 42_000,
      text: 'The refund policy changed because customers need a clear answer before checkout.',
    },
  ],
});
assertEqual(
  keywordPrioritizedPlan.clips.some((clip) =>
    clip.transcriptText === 'The refund policy changed because customers need a clear answer before checkout.'
  ),
  true,
  'Smart Cut Engine deterministic ID review preserves custom keyword candidates while render output stays timeline ordered',
);
const keywordMatchedSmartCutClip = keywordPrioritizedPlan.clips.find((clip) =>
  clip.transcriptText === 'The refund policy changed because customers need a clear answer before checkout.'
);
assertEqual(
  keywordPrioritizedPlan.clips[0]?.transcriptText,
  'First we introduce the agenda and explain the background context for today.',
  'Smart Cut Engine outputs selected semantic clips in renderable timeline order instead of LLM ranking order',
);
assertEqual(
  keywordMatchedSmartCutClip?.transcriptText,
  'The refund policy changed because customers need a clear answer before checkout.',
  'Smart Cut Engine deterministic ID review still identifies candidates whose content units match custom keywords',
);
assertArrayIncludes(
  keywordMatchedSmartCutClip?.risks,
  'custom-keyword-match',
  'Smart Cut Engine preserves custom keyword ranking evidence without letting the model invent timestamps',
);

assertRule(
  AUTOCUT_SMART_SLICE_SEGMENTATION_AGENTS.length >= 3 &&
    AUTOCUT_SMART_SLICE_SEGMENTATION_AGENTS.some((agent) => agent.id === 'semantic-story-agent') &&
    AUTOCUT_SMART_SLICE_SEGMENTATION_AGENTS.some((agent) => agent.id === 'dialogue-turn-agent') &&
    AUTOCUT_SMART_SLICE_SEGMENTATION_AGENTS.some((agent) => agent.id === 'teaching-step-agent'),
  'AutoCut exposes multiple Smart Slice segmentation agent implementations for STT-backed semantic slicing',
);
assertRule(
  AUTOCUT_SMART_SLICE_SEGMENTATION_AGENTS.every((agent) =>
    agent.id &&
      agent.label &&
      agent.systemPrompt.includes('Do not output timestamps') &&
      agent.systemPrompt.includes('contentUnitIds') &&
      agent.systemPrompt.includes('candidate ids')
  ),
  'Every Smart Slice segmentation agent publishes an auditable system prompt that forbids timestamp generation',
);
assertEqual(
  getAutoCutSmartSliceSegmentationAgentDefinition('missing-agent').id,
  AUTOCUT_DEFAULT_SMART_SLICE_SEGMENTATION_AGENT_ID,
  'Smart Slice segmentation agent registry falls back to the default semantic story agent for unknown ids',
);

let dialogueAgentPrompt;
await createSmartCutEngineSlicePlan({
  params: {
    ...baseParams,
    mode: 'talking-head',
    segmentationAgentId: 'dialogue-turn-agent',
    minDuration: 10,
    maxDuration: 90,
    sourceDurationMs: 80_000,
  },
  sourceAssetUuid: 'check-dialogue-segmentation-agent-prompt',
  sourceDurationMs: 80_000,
  transcriptSegments: [
    {
      startMs: 0,
      endMs: 12_000,
      speaker: 'Speaker 1',
      text: 'Why does retention fall after signup?',
    },
    {
      startMs: 12_200,
      endMs: 34_000,
      speaker: 'Speaker 2',
      text: 'The answer explains the activation problem and gives a complete resolution with one measurable next action.',
    },
  ],
  llmReview: async (prompt) => {
    dialogueAgentPrompt = prompt;
    return {
      rankedCandidateIds: prompt.candidates.map((candidate) => candidate.id),
      referencedUnitIds: prompt.contentUnits.map((unit) => unit.id),
      reviewNotes: ['Agent-aware ID-only review.'],
    };
  },
});
assertEqual(
  dialogueAgentPrompt?.segmentationAgent?.id,
  'dialogue-turn-agent',
  'Smart Cut Engine passes the selected segmentation agent id into the ID-only review prompt',
);
assertRule(
  String(dialogueAgentPrompt?.segmentationAgent?.systemPrompt ?? '').includes('speaker turn') &&
    String(dialogueAgentPrompt?.segmentationAgent?.systemPrompt ?? '').includes('Do not output timestamps'),
  'Smart Cut Engine passes the selected segmentation agent system prompt into the review context',
);
assertRule(
  dialogueAgentPrompt?.rules?.some((rule) => rule.includes('segmentation agent')) &&
    dialogueAgentPrompt?.rules?.some((rule) => rule.includes('Do not output timestamps')),
  'Smart Cut Engine review payload tells agents to rank candidate ids without raw timing output',
);

let capturedDialogueCreateChatCompletionRequest;
const dialogueStructuredReview = await createSmartCutEngineLlmReview(
  {
    model: 'deepseek-chat',
    presetId: 'interview-one-question-one-answer',
    customKeywords: ['retention'],
    segmentationAgentId: 'dialogue-turn-agent',
    contentUnits: [
      {
        id: 'dialogue-question-unit',
        unitKind: 'speech',
        startMs: 0,
        endMs: 9_000,
        text: 'Why does activation drop after signup?',
        speakerIds: ['speaker-interviewer'],
        speakerTurnIds: ['turn-speaker-interviewer-1'],
        speakerRoles: ['interviewer'],
        speakerConfidence: 0.98,
        overlapGroupIds: [],
        transcriptSegmentIds: ['transcript-question'],
        evidenceIds: ['transcript', 'speaker'],
        topicIds: ['topic-retention'],
        completenessScore: 0.92,
        continuityScore: 0.91,
        publishabilityScore: 0.88,
      },
      {
        id: 'dialogue-answer-unit',
        unitKind: 'speech',
        startMs: 9_200,
        endMs: 29_000,
        text: 'It drops because the first action is unclear, so the fix is to guide users to one measurable activation event.',
        speakerIds: ['speaker-guest'],
        speakerTurnIds: ['turn-speaker-guest-1'],
        speakerRoles: ['guest'],
        speakerConfidence: 0.97,
        overlapGroupIds: [],
        transcriptSegmentIds: ['transcript-answer'],
        evidenceIds: ['transcript', 'speaker'],
        topicIds: ['topic-retention'],
        completenessScore: 0.94,
        continuityScore: 0.93,
        publishabilityScore: 0.9,
      },
    ],
    candidates: [
      {
        id: 'dialogue-candidate-complete-qa',
        slicerId: 'dialogue-qa',
        unitIds: ['dialogue-question-unit', 'dialogue-answer-unit'],
        startMs: 0,
        endMs: 29_000,
        title: 'Activation retention question and answer',
        reason: 'Complete question and answer semantic unit.',
        confidence: 0.91,
        risks: [],
      },
    ],
  },
  async (request) => {
    capturedDialogueCreateChatCompletionRequest = request;
    return {
      content: JSON.stringify({
        schemaVersion: 'smart-cut-llm-review/v1',
        reviewKind: 'candidate-id-semantic-segmentation-review',
        selectedCandidateIds: ['dialogue-candidate-complete-qa'],
        rankedCandidateIds: ['dialogue-candidate-complete-qa'],
        referencedUnitIds: ['dialogue-question-unit', 'dialogue-answer-unit'],
        referencedTimeSliceIds: ['time-slice-dialogue-candidate-complete-qa'],
        referencedSpeakerIds: ['speaker-interviewer', 'speaker-guest'],
        referencedSpeakerTurnIds: ['turn-speaker-interviewer-1', 'turn-speaker-guest-1'],
        segmentDecisions: [
          {
            candidateId: 'dialogue-candidate-complete-qa',
            decision: 'select',
            reasonCode: 'complete-question-answer',
            referencedUnitIds: ['dialogue-question-unit', 'dialogue-answer-unit'],
            referencedTimeSliceIds: ['time-slice-dialogue-candidate-complete-qa'],
            referencedSpeakerIds: ['speaker-interviewer', 'speaker-guest'],
            referencedSpeakerTurnIds: ['turn-speaker-interviewer-1', 'turn-speaker-guest-1'],
          },
        ],
        reviewNotes: ['Dialogue agent selected the complete Q/A pair.'],
      }),
    };
  },
);
const dialogueAgentUserPayload = JSON.parse(capturedDialogueCreateChatCompletionRequest?.messages?.[1]?.content ?? '{}');
assertEqual(
  dialogueAgentUserPayload.schemaVersion,
  'smart-cut-llm-review/v1',
  'createSmartCutEngineLlmReview sends a versioned structured LLM input contract',
);
assertEqual(
  dialogueAgentUserPayload.reviewKind,
  'candidate-id-semantic-segmentation-review',
  'createSmartCutEngineLlmReview names the semantic segmentation review kind',
);
assertRule(
  dialogueAgentUserPayload.inputContract?.allowedOutputIds?.candidateIds?.includes('dialogue-candidate-complete-qa') &&
    dialogueAgentUserPayload.inputContract?.allowedOutputIds?.contentUnitIds?.includes('dialogue-question-unit') &&
    dialogueAgentUserPayload.inputContract?.allowedOutputIds?.timeSliceIds?.includes('time-slice-dialogue-candidate-complete-qa') &&
    dialogueAgentUserPayload.inputContract?.allowedOutputIds?.speakerIds?.includes('speaker-interviewer') &&
    dialogueAgentUserPayload.inputContract?.allowedOutputIds?.speakerTurnIds?.includes('turn-speaker-guest-1'),
  'createSmartCutEngineLlmReview declares the complete stable-id whitelist for model output',
);
assertRule(
  dialogueAgentUserPayload.inputContract?.forbiddenOutputFields?.includes('startMs') &&
    dialogueAgentUserPayload.inputContract?.forbiddenOutputFields?.includes('endMs') &&
    dialogueAgentUserPayload.inputContract?.forbiddenOutputFields?.includes('sourceStartMs') &&
    dialogueAgentUserPayload.inputContract?.forbiddenOutputFields?.includes('sourceEndMs'),
  'createSmartCutEngineLlmReview explicitly forbids raw timestamp fields in model output',
);
assertRule(
  dialogueAgentUserPayload.outputContract?.schemaVersion === 'smart-cut-llm-review/v1' &&
    dialogueAgentUserPayload.outputContract?.requiredFields?.includes('segmentDecisions') &&
    dialogueAgentUserPayload.outputContract?.segmentDecisionSchema?.referencedTimeSliceIds?.includes('timeSliceId') &&
    dialogueAgentUserPayload.outputContract?.segmentDecisionSchema?.referencedSpeakerTurnIds?.includes('speakerTurnId'),
  'createSmartCutEngineLlmReview publishes the structured model output schema including segment decisions',
);
assertRule(
  dialogueAgentUserPayload.timeSlices?.[0]?.timeSliceId === 'time-slice-dialogue-candidate-complete-qa' &&
    dialogueAgentUserPayload.timeSlices?.[0]?.candidateId === 'dialogue-candidate-complete-qa' &&
    dialogueAgentUserPayload.timeSlices?.[0]?.sourceStartMs === 0 &&
    dialogueAgentUserPayload.timeSlices?.[0]?.sourceEndMs === 29_000 &&
    dialogueAgentUserPayload.timeSlices?.[0]?.contentUnitIds?.includes('dialogue-answer-unit') &&
    dialogueAgentUserPayload.timeSlices?.[0]?.speakerIds?.includes('speaker-guest') &&
    dialogueAgentUserPayload.timeSlices?.[0]?.speakerTurnIds?.includes('turn-speaker-guest-1'),
  'createSmartCutEngineLlmReview serializes engine-owned time slices with content and speaker evidence',
);
assertRule(
  dialogueAgentUserPayload.speakerCatalog?.some((speaker) =>
    speaker.speakerId === 'speaker-interviewer' && speaker.roles?.includes('interviewer')
  ) &&
    dialogueAgentUserPayload.speakerCatalog?.some((speaker) =>
      speaker.speakerId === 'speaker-guest' && speaker.roles?.includes('guest')
    ),
  'createSmartCutEngineLlmReview serializes a speaker catalog for model reasoning',
);
assertRule(
  dialogueAgentUserPayload.speakerTurns?.some((turn) =>
    turn.speakerTurnId === 'turn-speaker-interviewer-1' &&
      turn.speakerId === 'speaker-interviewer' &&
      turn.timeSliceIds?.includes('time-slice-dialogue-candidate-complete-qa') &&
      turn.contentUnitIds?.includes('dialogue-question-unit')
  ) &&
    dialogueAgentUserPayload.speakerTurns?.some((turn) =>
      turn.speakerTurnId === 'turn-speaker-guest-1' &&
        turn.speakerId === 'speaker-guest' &&
        turn.timeSliceIds?.includes('time-slice-dialogue-candidate-complete-qa') &&
        turn.contentUnitIds?.includes('dialogue-answer-unit')
    ),
  'createSmartCutEngineLlmReview serializes speaker turns linked to time slices and content units',
);
assertRule(
  dialogueAgentUserPayload.candidates?.[0]?.timeSliceId === 'time-slice-dialogue-candidate-complete-qa' &&
    dialogueAgentUserPayload.contentUnits?.[0]?.timeSliceIds?.includes('time-slice-dialogue-candidate-complete-qa'),
  'createSmartCutEngineLlmReview links candidates and content units to structured time slice ids',
);
assertRule(
  dialogueAgentUserPayload.candidates?.[0]?.speakerIds?.includes('speaker-interviewer') &&
    dialogueAgentUserPayload.candidates?.[0]?.speakerIds?.includes('speaker-guest') &&
    dialogueAgentUserPayload.candidates?.[0]?.speakerRoles?.includes('interviewer') &&
    dialogueAgentUserPayload.candidates?.[0]?.speakerRoles?.includes('guest'),
  'createSmartCutEngineLlmReview serializes candidate-level speaker ids and roles for dialogue turn agents',
);
assertRule(
  dialogueAgentUserPayload.candidates?.[0]?.speakerTurnIds?.includes('turn-speaker-interviewer-1') &&
    dialogueAgentUserPayload.candidates?.[0]?.speakerTurnIds?.includes('turn-speaker-guest-1') &&
    dialogueAgentUserPayload.candidates?.[0]?.speakerTurnCount === 2,
  'createSmartCutEngineLlmReview serializes candidate-level speaker turn evidence for multi-speaker dialogue',
);
assertRule(
  dialogueAgentUserPayload.contentUnits?.[0]?.speakerTurnIds?.includes('turn-speaker-interviewer-1') &&
    dialogueAgentUserPayload.contentUnits?.[0]?.speakerConfidence === 0.98 &&
    Array.isArray(dialogueAgentUserPayload.contentUnits?.[0]?.overlapGroupIds),
  'createSmartCutEngineLlmReview serializes content-unit diarization evidence for dialogue auditability',
);
assertEqual(
  dialogueAgentUserPayload.candidates?.[0]?.dialogueTurnContinuity,
  'question-answer-complete',
  'createSmartCutEngineLlmReview labels complete dialogue candidates with question-answer continuity',
);
assertRule(
  dialogueAgentUserPayload.rules?.some((rule) => rule.includes('orphan answers')) &&
    dialogueAgentUserPayload.rules?.some((rule) => rule.includes('speakerIds and speakerRoles')),
  'dialogue-turn-agent review rules reject orphan answers and require speaker evidence reasoning',
);
assertRule(
  dialogueStructuredReview?.segmentDecisions?.[0]?.referencedTimeSliceIds?.includes('time-slice-dialogue-candidate-complete-qa') &&
    dialogueStructuredReview?.referencedSpeakerTurnIds?.includes('turn-speaker-guest-1'),
  'createSmartCutEngineLlmReview parses structured output decisions with time slice and speaker turn evidence',
);

let capturedOrphanAnswerDialogueRequest;
await createSmartCutEngineLlmReview(
  {
    model: 'deepseek-chat',
    presetId: 'interview-one-question-one-answer',
    customKeywords: [],
    segmentationAgentId: 'dialogue-turn-agent',
    contentUnits: [
      {
        id: 'orphan-answer-unit',
        unitKind: 'speech',
        startMs: 0,
        endMs: 16_000,
        text: 'The fix is to guide users to one measurable activation event before the second screen.',
        speakerIds: ['speaker-guest'],
        speakerTurnIds: ['turn-speaker-guest-1'],
        speakerRoles: ['guest'],
        speakerConfidence: 0.96,
        overlapGroupIds: [],
        transcriptSegmentIds: ['transcript-orphan-answer'],
        evidenceIds: ['transcript', 'speaker'],
        topicIds: ['topic-retention'],
        completenessScore: 0.88,
        continuityScore: 0.72,
        publishabilityScore: 0.74,
      },
    ],
    candidates: [
      {
        id: 'dialogue-candidate-orphan-answer',
        slicerId: 'dialogue-qa',
        unitIds: ['orphan-answer-unit'],
        startMs: 0,
        endMs: 16_000,
        title: 'Activation fix without question',
        reason: 'Answer unit without the preceding question.',
        confidence: 0.74,
        risks: ['orphan-answer'],
      },
    ],
  },
  async (request) => {
    capturedOrphanAnswerDialogueRequest = request;
    return {
      content: JSON.stringify({
        rankedCandidateIds: ['dialogue-candidate-orphan-answer'],
        referencedUnitIds: ['orphan-answer-unit'],
        reviewNotes: ['Fixture captures orphan answer continuity label.'],
      }),
    };
  },
);
const orphanAnswerDialoguePayload = JSON.parse(capturedOrphanAnswerDialogueRequest?.messages?.[1]?.content ?? '{}');
assertEqual(
  orphanAnswerDialoguePayload.candidates?.[0]?.dialogueTurnContinuity,
  'answer-without-question',
  'dialogue-turn-agent review payload marks answer-only candidates as missing question context',
);

let capturedRoleOnlyDialogueRequest;
await createSmartCutEngineLlmReview(
  {
    model: 'deepseek-chat',
    presetId: 'interview-one-question-one-answer',
    customKeywords: [],
    segmentationAgentId: 'dialogue-turn-agent',
    contentUnits: [
      {
        id: 'role-only-context-unit',
        unitKind: 'speech',
        startMs: 0,
        endMs: 7_000,
        text: 'The host introduces the retention theme and passes to the guest.',
        speakerIds: ['speaker-host'],
        speakerTurnIds: ['turn-speaker-host-1'],
        speakerRoles: ['interviewer'],
        speakerConfidence: 0.96,
        overlapGroupIds: [],
        transcriptSegmentIds: ['transcript-role-only-context'],
        evidenceIds: ['transcript', 'speaker'],
        topicIds: ['topic-retention'],
        completenessScore: 0.82,
        continuityScore: 0.76,
        publishabilityScore: 0.72,
      },
      {
        id: 'role-only-answer-unit',
        unitKind: 'speech',
        startMs: 7_200,
        endMs: 20_000,
        text: 'The guest explains the activation fix and describes the measurable event.',
        speakerIds: ['speaker-guest'],
        speakerTurnIds: ['turn-speaker-guest-1'],
        speakerRoles: ['guest'],
        speakerConfidence: 0.96,
        overlapGroupIds: [],
        transcriptSegmentIds: ['transcript-role-only-answer'],
        evidenceIds: ['transcript', 'speaker'],
        topicIds: ['topic-retention'],
        completenessScore: 0.83,
        continuityScore: 0.75,
        publishabilityScore: 0.72,
      },
    ],
    candidates: [
      {
        id: 'dialogue-candidate-role-only',
        slicerId: 'dialogue-qa',
        unitIds: ['role-only-context-unit', 'role-only-answer-unit'],
        startMs: 0,
        endMs: 20_000,
        title: 'Role exchange without explicit question',
        reason: 'Multi-speaker answer context without a question mark.',
        confidence: 0.72,
        risks: ['missing-question'],
      },
    ],
  },
  async (request) => {
    capturedRoleOnlyDialogueRequest = request;
    return {
      content: JSON.stringify({
        rankedCandidateIds: ['dialogue-candidate-role-only'],
        referencedUnitIds: ['role-only-context-unit', 'role-only-answer-unit'],
        reviewNotes: ['Fixture captures role-only dialogue continuity label.'],
      }),
    };
  },
);
const roleOnlyDialoguePayload = JSON.parse(capturedRoleOnlyDialogueRequest?.messages?.[1]?.content ?? '{}');
assertEqual(
  roleOnlyDialoguePayload.candidates?.[0]?.dialogueTurnContinuity,
  'multi-speaker-context-required',
  'dialogue-turn-agent review payload does not treat speaker roles alone as complete Q/A without question evidence',
);

let capturedCreateChatCompletionRequest;
const teachingAgentReview = await createSmartCutEngineLlmReview(
  {
    model: 'deepseek-chat',
    presetId: 'teacher-talking-head-single',
    customKeywords: ['outline'],
    segmentationAgentId: 'teaching-step-agent',
    contentUnits: [
      {
        id: 'unit-1',
        unitKind: 'speech',
        startMs: 0,
        endMs: 10_000,
        text: 'Step one explains the setup.',
        speakerIds: ['speaker-1'],
        speakerRoles: ['teacher'],
        transcriptSegmentIds: ['transcript-1'],
        evidenceIds: ['transcript', 'speaker'],
        completenessScore: 0.9,
        continuityScore: 0.9,
        publishabilityScore: 0.86,
      },
    ],
    candidates: [
      {
        id: 'candidate-1',
        slicerId: 'speech-semantic',
        unitIds: ['unit-1'],
        startMs: 0,
        endMs: 10_000,
        title: 'Step one',
        reason: 'Complete teaching step.',
        confidence: 0.9,
        risks: [],
      },
    ],
  },
  async (request) => {
    capturedCreateChatCompletionRequest = request;
    return {
      content: JSON.stringify({
        rankedCandidateIds: ['candidate-1'],
        referencedUnitIds: ['unit-1'],
        reviewNotes: ['Teaching agent selected one step.'],
      }),
    };
  },
);
const teachingAgentUserPayload = JSON.parse(capturedCreateChatCompletionRequest?.messages?.[1]?.content ?? '{}');
assertRule(
  capturedCreateChatCompletionRequest?.messages?.[0]?.content?.includes('teaching-step-agent') &&
    capturedCreateChatCompletionRequest?.messages?.[0]?.content?.includes('Do not output timestamps'),
  'createSmartCutEngineLlmReview injects the selected segmentation agent system prompt into the model system message',
);
assertEqual(
  teachingAgentUserPayload.segmentationAgent?.id,
  'teaching-step-agent',
  'createSmartCutEngineLlmReview serializes the selected segmentation agent into the user payload for auditability',
);
assertRule(
  teachingAgentReview?.rankedCandidateIds?.[0] === 'candidate-1',
  'createSmartCutEngineLlmReview still parses agent-aware ID-only review output',
);

const commerceLivePlan = await createSmartCutEngineSlicePlan({
  params: {
    ...baseParams,
    mode: 'commerce-live',
    customKeywords: ['checkout'],
    minDuration: 10,
    maxDuration: 90,
    sourceDurationMs: 80_000,
  },
  sourceAssetUuid: 'check-commerce-live-stable-mode-routing',
  sourceDurationMs: 80_000,
  transcriptSegments: [
    {
      startMs: 0,
      endMs: 18_000,
      speaker: 'Seller',
      text: 'This product proof solves the customer pain and shows the exact checkout benefit.',
    },
    {
      startMs: 20_000,
      endMs: 44_000,
      speaker: 'Seller',
      text: 'The offer answer includes refund context, price proof, and a clear purchase result.',
    },
  ],
});
assertEqual(
  commerceLivePlan.presetId,
  'commerce-live-product-cards',
  'Smart Cut Engine routes the stable commerce-live mode id to the commerce-live product preset instead of the default talking-head preset',
);

await assertRejectsAsync(
  () => createSmartCutEngineSlicePlan({
    params: {
      ...baseParams,
      mode: 'film',
      minDuration: 10,
      maxDuration: 90,
      sourceDurationMs: 80_000,
    },
    sourceAssetUuid: 'check-film-stable-mode-requires-visual-evidence',
    sourceDurationMs: 80_000,
    transcriptSegments: [
      {
        startMs: 0,
        endMs: 20_000,
        speaker: 'Narrator',
        text: 'The scene setup introduces the main conflict and keeps the narrative context intact.',
      },
      {
        startMs: 22_000,
        endMs: 50_000,
        speaker: 'Narrator',
        text: 'The payoff resolves the scene and gives viewers a complete story beat.',
      },
    ],
  }),
  'UNSUPPORTED_VISUAL_PRESET_EVIDENCE',
  'Smart Cut Engine fails closed for stable film mode until canonical visual-scene evidence is supplied instead of silently running talking-head semantics',
);

const filmVisualEvidence = {
  kind: 'visual',
  schemaVersion: '2026-05-14.smart-cut-engine.v1',
  provider: 'ffmpeg-scene',
  profile: 'scene-index-v1',
  shots: [
    {
      id: 'shot-001',
      startMs: 0,
      endMs: 20_000,
      confidence: 0.92,
      boundarySource: 'ffmpeg-scene',
    },
    {
      id: 'shot-002',
      startMs: 20_000,
      endMs: 50_000,
      confidence: 0.9,
      boundarySource: 'ffmpeg-scene',
    },
    {
      id: 'shot-003',
      startMs: 50_000,
      endMs: 80_000,
      confidence: 0.88,
      boundarySource: 'ffmpeg-scene',
    },
  ],
  sceneBoundaries: [
    { startMs: 0, endMs: 20_000 },
    { startMs: 20_000, endMs: 50_000 },
    { startMs: 50_000, endMs: 80_000 },
  ],
  frameQuality: [
    { atMs: 10_000, blurScore: 0.9, exposureScore: 0.88, stabilityScore: 0.86 },
    { atMs: 35_000, blurScore: 0.89, exposureScore: 0.87, stabilityScore: 0.85 },
  ],
};
const filmVisualPlan = await createSmartCutEngineSlicePlan({
  params: {
    ...baseParams,
    mode: 'film',
    minDuration: 10,
    maxDuration: 90,
    sourceDurationMs: 80_000,
  },
  sourceAssetUuid: 'check-film-stable-mode-with-visual-evidence',
  sourceDurationMs: 80_000,
  transcriptSegments: [],
  visualEvidence: filmVisualEvidence,
});
assertEqual(
  filmVisualPlan.presetId,
  'film-scene-index',
  'Smart Cut Engine routes visual-evidence-backed film mode to the film scene index preset',
);
assertRule(
  filmVisualPlan.clips.length === 3 &&
    filmVisualPlan.clips.every((clip, index) =>
      clip.planningEngine === 'smart-cut-engine' &&
        clip.smartCutPresetId === 'film-scene-index' &&
        clip.contentUnitIds?.[0] === `visual-scene-${index + 1}` &&
        clip.sourceStartMs === filmVisualEvidence.sceneBoundaries[index]?.startMs &&
        clip.sourceEndMs === filmVisualEvidence.sceneBoundaries[index]?.endMs &&
        clip.risks?.includes('visual-scene-evidence') &&
        clip.boundaryDecisionSource === 'combined'
    ),
  'Smart Cut Engine creates source-backed film scene clips from canonical visual scene evidence without transcript or speaker fabrication',
);
assertRule(
  filmVisualPlan.visualEvidence?.provider === 'ffmpeg-scene' &&
    filmVisualPlan.visualEvidenceQuality?.ready === true &&
    filmVisualPlan.visualEvidenceQuality.shotReady === true &&
    filmVisualPlan.visualEvidenceQuality.sceneReady === true,
  'Smart Cut Engine validates film visual evidence quality before planning scene clips',
);

await assertRejectsAsync(
  () => createSmartCutEngineSlicePlan({
    params: {
      ...baseParams,
      mode: 'film',
      minDuration: 10,
      maxDuration: 90,
      sourceDurationMs: 80_000,
    },
    sourceAssetUuid: 'check-film-invalid-visual-evidence',
    sourceDurationMs: 80_000,
    transcriptSegments: [],
    visualEvidence: {
      ...filmVisualEvidence,
      shots: [
        {
          id: 'shot-001',
          startMs: 0,
          endMs: 90_000,
          confidence: 0.95,
          boundarySource: 'ffmpeg-scene',
        },
      ],
    },
  }),
  'VISUAL_SHOT_OUT_OF_SOURCE',
  'Smart Cut Engine rejects film visual evidence whose shot ranges exceed the probed source duration',
);

await assertRejectsAsync(
  () => createSmartCutEngineSlicePlan({
    params: {
      ...baseParams,
      mode: 'documentary',
      minDuration: 10,
      maxDuration: 90,
      sourceDurationMs: 80_000,
    },
    sourceAssetUuid: 'check-documentary-still-requires-audio-and-story-evidence',
    sourceDurationMs: 80_000,
    transcriptSegments: [],
    visualEvidence: filmVisualEvidence,
  }),
  'UNSUPPORTED_MULTIMODAL_PRESET_EVIDENCE',
  'Smart Cut Engine keeps documentary mode blocked until its audio/story multimodal evidence adapters are implemented',
);

const genericMultiSpeakerPlan = await createSmartCutEngineSlicePlan({
  params: {
    ...baseParams,
    mode: 'contract-mode',
    minDuration: 10,
    maxDuration: 60,
    sourceDurationMs: 240_000,
  },
  sourceAssetUuid: 'check-generic-multi-speaker-speech-semantic',
  sourceDurationMs: 240_000,
  transcriptSegments: [
    {
      startMs: 0,
      endMs: 14_000,
      speaker: 'Speaker 1',
      text: 'Why the pricing pain matters is simple. Because retention drops before the team changes the workflow, the solution must be shown clearly.',
    },
    {
      startMs: 14_050,
      endMs: 29_000,
      speaker: 'Speaker 2',
      text: 'So speaker two interrupts quickly, but the answer completes the refund fix and gives the viewer the final result.',
    },
  ],
});
assertEqual(
  genericMultiSpeakerPlan.presetId,
  'teacher-talking-head-single',
  'Smart Cut Engine treats generic contract-mode multi-speaker speech as speech-semantic unless the user selected a dialogue or meeting mode',
);
assertRule(
  genericMultiSpeakerPlan.clips.some((clip) =>
    clip.speakerIds?.includes('speaker-speaker-1') &&
      clip.speakerIds?.includes('speaker-speaker-2') &&
      clip.transcriptText?.includes('refund fix')
  ),
  'generic multi-speaker speech keeps speaker ids while producing a complete semantic clip',
);

const adjacentSmartCutEnginePlan = await createSmartCutEngineSlicePlan({
  params: {
    ...baseParams,
    mode: 'talking-head',
    minDuration: 10,
    maxDuration: 18,
    sourceDurationMs: 36_000,
  },
  sourceAssetUuid: 'check-smart-cut-engine-adjacent-padding',
  sourceDurationMs: 36_000,
  transcriptSegments: [
    {
      startMs: 0,
      endMs: 12_000,
      speaker: 'Speaker 1',
      text: 'First clear hook explains the retention problem and gives the viewer a complete takeaway.',
    },
    {
      startMs: 12_100,
      endMs: 25_000,
      speaker: 'Speaker 2',
      text: 'Second clear hook explains the pricing problem and gives the viewer the final resolution.',
    },
  ],
});
assertRule(
  adjacentSmartCutEnginePlan.clips.length >= 2,
  'Smart Cut Engine can keep adjacent semantic content units as separate renderable clips when maxDuration requires splitting',
);
assertRule(
  adjacentSmartCutEnginePlan.clips.every((clip, index, clips) =>
    index === 0 || clip.startMs >= clips[index - 1].startMs + clips[index - 1].durationMs
  ),
  'Smart Cut Engine clamps non-semantic boundary padding so adjacent rendered clips never overlap',
);
assertPlanReadyForNativeRenderLikeUi(
  adjacentSmartCutEnginePlan.clips,
  adjacentSmartCutEnginePlan.transcriptEvidence.segments,
  36_000,
  'Smart Cut Engine adjacent semantic padding plan',
);

let longTranscriptLlmPrompt;
const longTranscriptEnginePlan = await createSmartCutEngineSlicePlan({
  params: {
    ...baseParams,
    mode: 'talking-head',
    minDuration: 5,
    maxDuration: 15,
    sourceDurationMs: 2_080_000,
  },
  sourceAssetUuid: 'check-long-transcript-id-review-projection',
  sourceDurationMs: 2_080_000,
  transcriptSegments: Array.from({ length: 260 }, (_, index) => {
    const startMs = index * 8_000;
    const keyWindowTextByIndex = {
      12: 'Watch the onboarding funnel setup, signup pain, pricing conflict, and complete activation payoff.',
      130: 'Watch the refund workflow setup, support queue pain, escalation conflict, and complete retention payoff.',
      238: 'Watch the creator analytics setup, audience dropoff pain, packaging conflict, and complete publishing payoff.',
    };
    return {
      startMs,
      endMs: startMs + 6_000,
      speaker: 'Speaker 1',
      text: keyWindowTextByIndex[index] ?? `Routine long transcript context ${index}.`,
    };
  }),
  llmReview: async (prompt) => {
    longTranscriptLlmPrompt = prompt;
    return {
      rankedCandidateIds: prompt.candidates.map((candidate) => candidate.id),
      referencedUnitIds: prompt.contentUnits.map((unit) => unit.id),
      reviewNotes: ['ID-only bounded projection review.'],
    };
  },
});
assertRule(
  (longTranscriptLlmPrompt?.contentUnits?.length ?? 0) <= 80,
  'Smart Cut Engine sends a bounded ID-only LLM content-unit projection for long transcripts',
);
assertRule(
  longTranscriptLlmPrompt?.contentUnits?.some((unit) => String(unit.text ?? '').includes('creator analytics')),
  'Smart Cut Engine keeps late high-value creator analytics content in the bounded LLM projection',
);
assertRule(
  longTranscriptLlmPrompt?.candidates?.some((candidate) => String(candidate.title ?? '').includes('creator analytics')),
  'Smart Cut Engine keeps late high-value creator analytics candidates in the bounded LLM projection',
);
assertRule(
  longTranscriptLlmPrompt?.candidates?.every((candidate) =>
    candidate.unitIds.every((unitId) => longTranscriptLlmPrompt.contentUnits.some((unit) => unit.id === unitId))
  ),
  'Smart Cut Engine LLM projection only includes candidates backed by projected content units',
);
assertRule(
  longTranscriptEnginePlan.clips.length > 0,
  'Smart Cut Engine expands bounded LLM reviews back to executable engine candidates without losing render output',
);

let sparseTranscriptLlmPrompt;
await createSmartCutEngineSlicePlan({
  params: {
    ...baseParams,
    mode: 'talking-head',
    minDuration: 15,
    maxDuration: 60,
    sourceDurationMs: 90_000,
  },
  sourceAssetUuid: 'check-sparse-transcript-id-review-tags',
  sourceDurationMs: 90_000,
  transcriptSegments: [
    {
      startMs: 10_000,
      endMs: 12_000,
      speaker: 'Speaker 1',
      text: 'Tiny isolated speech.',
    },
    {
      startMs: 40_000,
      endMs: 42_000,
      speaker: 'Speaker 1',
      text: 'Another tiny isolated speech.',
    },
  ],
  llmReview: async (prompt) => {
    sparseTranscriptLlmPrompt = prompt;
    return {
      rankedCandidateIds: prompt.candidates.map((candidate) => candidate.id),
      referencedUnitIds: prompt.contentUnits.map((unit) => unit.id),
      reviewNotes: ['ID-only sparse projection review.'],
    };
  },
});
assertRule(
  sparseTranscriptLlmPrompt?.candidates?.every((candidate) => candidate.risks?.includes('sparse-transcript-speech')),
  'Smart Cut Engine tags sparse transcript candidates before ID-only LLM review',
);

assertRule(
  smartCutEnginePlannerSource.includes("from '@sdkwork/autocut-smart-cut-engine'") &&
    smartCutEnginePlannerSource.includes('createSmartCutSpeechFirstExecutionPackage') &&
    smartCutEnginePlannerSource.includes('SmartCutSpeakerEvidence') &&
    smartCutEnginePlannerSource.includes('rankedCandidateIds') &&
    smartCutEnginePlannerSource.includes('referencedUnitIds') &&
    smartCutEnginePlannerSource.includes('smart-cut-engine') &&
    smartCutEnginePlannerSource.includes('contentUnitIds') &&
    smartCutEnginePlannerSource.includes('speakerIds') &&
    smartCutEnginePlannerSource.includes('speakerRoles'),
  'smartCutEnginePlanner.ts uses the new Smart Cut Engine as the only speech-first semantic slicing planner with speaker-aware content-unit evidence',
);

assertRule(
  !/[\u00c0-\u00ff]\u0080?|闀|璁|瑷|杩|閫|鍙|闆|澶|浼|鏈/u.test(smartCutEnginePlannerSource),
  'smartCutEnginePlanner.ts stable strategy routing has no mojibake legacy mode regex branches',
);

assertRule(
  slicerServiceSource.includes("from './smartCutEnginePlanner'") &&
    slicerServiceSource.includes('createSmartCutEngineSlicePlan') &&
    slicerServiceSource.includes('createSmartCutEngineLlmReview') &&
    slicerServiceSource.includes('createAutoCutOpenAiCompatibleChatCompletion') &&
    slicerServiceSource.includes('resolveAutoCutLlmRuntimeConfig') &&
    slicerServiceSource.includes('External LLM review was unavailable; deterministic ID-only review preserved Smart Cut Engine timestamps.') &&
    slicerServiceSource.includes('SmartCutEngineSlicePlanningError'),
  'slicerService.ts delegates plan-clips to the new Smart Cut Engine planner with optional approved ID-only LLM review and deterministic offline availability',
);

assertRule(
  !slicerServiceSource.includes('const transcriptCandidates = buildTranscriptSliceCandidates(planningParams, transcriptSegments);') &&
    !slicerServiceSource.includes('const result = await createAutoCutOpenAiCompatibleChatCompletion({') &&
    !slicerServiceSource.includes('parseLlmSlicePlan(result.content, planningParams, fallbackPlan, transcriptCandidates)'),
  'slicerService.ts no longer lets legacy candidate windows or raw-timestamp LLM output drive smart-slice planning',
);

if (failures.length > 0) {
  console.error('AutoCut slicer planner check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  console.error(`\n${pass.length} checks passed, ${failures.length} checks failed.`);
  process.exitCode = 1;
} else {
  console.log(`AutoCut slicer planner check passed (${pass.length} checks).`);
}
