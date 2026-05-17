#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  normalizeAutoCutCliArgs,
  readAutoCutCliOptionValue,
} from './autocut-cli-args.mjs';

const __filename = fileURLToPath(import.meta.url);
const schemaVersion = '2026-05-16.autocut-smart-slice-execution-evidence-validation.v1';
const speechEvidenceRelativePath = 'evidence/speech-to-text.json';
const semanticEvidenceRelativePath = 'evidence/semantic-segmentation.json';
const reviewSessionEvidenceRelativePath = 'evidence/review-session.json';
const manualEditsEvidenceRelativePath = 'evidence/manual-edits.json';
const reviewEventsEvidenceRelativePath = 'evidence/review-events.json';
const renderSelectionEvidenceRelativePath = 'evidence/render-selection.json';
const renderArtifactManifestEvidenceRelativePath = 'evidence/render-artifact-manifest.json';

export function createAutoCutSmartSliceExecutionEvidenceValidationReport({
  taskDir,
  speechPath,
  semanticPath,
  generatedAt = new Date().toISOString(),
} = {}) {
  const resolvedTaskDir = taskDir ? path.resolve(taskDir) : undefined;
  const resolvedSpeechPath = path.resolve(
    speechPath ?? (resolvedTaskDir ? path.join(resolvedTaskDir, speechEvidenceRelativePath) : speechEvidenceRelativePath),
  );
  const resolvedSemanticPath = path.resolve(
    semanticPath ?? (resolvedTaskDir ? path.join(resolvedTaskDir, semanticEvidenceRelativePath) : semanticEvidenceRelativePath),
  );
  const resolvedReviewSessionPath = path.resolve(
    resolvedTaskDir ? path.join(resolvedTaskDir, reviewSessionEvidenceRelativePath) : reviewSessionEvidenceRelativePath,
  );
  const resolvedManualEditsPath = path.resolve(
    resolvedTaskDir ? path.join(resolvedTaskDir, manualEditsEvidenceRelativePath) : manualEditsEvidenceRelativePath,
  );
  const resolvedReviewEventsPath = path.resolve(
    resolvedTaskDir ? path.join(resolvedTaskDir, reviewEventsEvidenceRelativePath) : reviewEventsEvidenceRelativePath,
  );
  const resolvedRenderSelectionPath = path.resolve(
    resolvedTaskDir ? path.join(resolvedTaskDir, renderSelectionEvidenceRelativePath) : renderSelectionEvidenceRelativePath,
  );
  const resolvedRenderArtifactManifestPath = path.resolve(
    resolvedTaskDir ? path.join(resolvedTaskDir, renderArtifactManifestEvidenceRelativePath) : renderArtifactManifestEvidenceRelativePath,
  );

  const blockers = [];
  const speech = readEvidenceJson(resolvedSpeechPath, 'SMART_SLICE_STT_EVIDENCE_MISSING', blockers);
  const semantic = readEvidenceJson(resolvedSemanticPath, 'SMART_SLICE_SEMANTIC_EVIDENCE_MISSING', blockers);
  const reviewSession = readEvidenceJson(resolvedReviewSessionPath, 'SMART_SLICE_REVIEW_SESSION_EVIDENCE_MISSING', blockers);
  const manualEdits = readEvidenceJson(resolvedManualEditsPath, 'SMART_SLICE_MANUAL_EDITS_EVIDENCE_MISSING', blockers);
  const reviewEvents = readEvidenceJson(resolvedReviewEventsPath, 'SMART_SLICE_REVIEW_EVENTS_EVIDENCE_MISSING', blockers);
  const renderSelection = readEvidenceJson(resolvedRenderSelectionPath, 'SMART_SLICE_RENDER_SELECTION_EVIDENCE_MISSING', blockers);
  const renderArtifactManifest = readEvidenceJson(
    resolvedRenderArtifactManifestPath,
    'SMART_SLICE_RENDER_ARTIFACT_MANIFEST_EVIDENCE_MISSING',
    blockers,
  );
  const speechSegments = normalizeSpeechSegments(speech?.segments);
  const semanticClips = normalizeSemanticClips(semantic?.clips);
  const speakerProfiles = normalizeSpeakerProfiles(semantic?.speakerEvidence?.profiles);
  const speakerProfileIds = new Set(speakerProfiles.map((profile) => profile.speakerId));
  const reviewSegments = normalizeReviewSegments(reviewSession?.segments);
  const manifestSlices = normalizeManifestSlices(renderArtifactManifest?.slices);

  validateSpeechEvidence(speech, speechSegments, blockers);
  validateSemanticEvidence(semantic, semanticClips, speechSegments, speakerProfileIds, blockers);
  validateReviewSessionEvidence(reviewSession, reviewSegments, semanticClips, blockers);
  validateManualEditsEvidence(manualEdits, reviewSession, blockers);
  validateReviewEventsEvidence(reviewEvents, manualEdits, reviewSession, blockers);
  validateRenderSelectionEvidence(renderSelection, reviewSegments, blockers);
  validateRenderArtifactManifestEvidence(renderArtifactManifest, manifestSlices, reviewSegments, blockers);

  return {
    schemaVersion,
    generatedAt,
    taskDir: resolvedTaskDir,
    speechPath: resolvedSpeechPath,
    semanticPath: resolvedSemanticPath,
    reviewSessionPath: resolvedReviewSessionPath,
    manualEditsPath: resolvedManualEditsPath,
    reviewEventsPath: resolvedReviewEventsPath,
    renderSelectionPath: resolvedRenderSelectionPath,
    renderArtifactManifestPath: resolvedRenderArtifactManifestPath,
    ready: blockers.length === 0,
    summary: {
      speechSegmentCount: speechSegments.length,
      speechSpeakerCount: new Set(speechSegments.map((segment) => segment.speaker).filter(Boolean)).size,
      semanticClipCount: semanticClips.length,
      semanticClipsWithTranscript: semanticClips.filter((clip) => clip.transcriptText.length > 0 && clip.transcriptSegmentCount > 0).length,
      speakerProfileCount: speakerProfiles.length,
      llmReviewAuditReady: Boolean(semantic?.llmReviewAudit),
      reviewSegmentCount: reviewSegments.length,
      manualEditCount: normalizeNonNegativeInteger(manualEdits?.editCount) ?? normalizeArray(manualEdits?.manualEdits).length,
      reviewEventCount: normalizeNonNegativeInteger(reviewEvents?.eventCount) ?? normalizeArray(reviewEvents?.events).length,
      selectedSegmentCount: normalizeStringArray(renderSelection?.selectedSegmentIds).length,
      renderedSliceCount: manifestSlices.length,
    },
    blockers,
  };
}

export function formatAutoCutSmartSliceExecutionEvidenceValidationMessage(report) {
  const target = report.taskDir ?? path.dirname(report.semanticPath);
  const prefix = report.ready ? 'ok' : 'blocked';
  return `${prefix} - autocut smart slice execution evidence ${target} speechSegments=${report.summary.speechSegmentCount} semanticClips=${report.summary.semanticClipCount} reviewSegments=${report.summary.reviewSegmentCount} renderedSlices=${report.summary.renderedSliceCount} blockers=${report.blockers.length}`;
}

function readEvidenceJson(evidencePath, missingCode, blockers) {
  if (!fs.existsSync(evidencePath) || !fs.statSync(evidencePath).isFile()) {
    blockers.push({
      code: missingCode,
      message: `Missing Smart Slice execution evidence JSON: ${evidencePath}`,
      remediation: 'Run Smart Slice again with the desktop native task evidence writer enabled.',
      path: evidencePath,
    });
    return undefined;
  }
  try {
    return JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  } catch (error) {
    blockers.push({
      code: missingCode.replace('_MISSING', '_INVALID_JSON'),
      message: `Smart Slice execution evidence JSON is not parseable: ${evidencePath}`,
      remediation: 'Regenerate the task evidence JSON from a fresh Smart Slice run.',
      path: evidencePath,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

function validateSpeechEvidence(speech, speechSegments, blockers) {
  if (!speech || typeof speech !== 'object' || Array.isArray(speech)) {
    return;
  }
  if (speech.schema !== 'smart-slice.speech-to-text.v1') {
    blockers.push({
      code: 'SMART_SLICE_STT_SCHEMA_UNSUPPORTED',
      message: `Unsupported Smart Slice STT evidence schema: ${normalizeString(speech.schema)}`,
      expected: 'smart-slice.speech-to-text.v1',
      actual: normalizeString(speech.schema),
    });
  }
  if (!normalizeString(speech.taskId)) {
    blockers.push({
      code: 'SMART_SLICE_STT_TASK_ID_MISSING',
      message: 'Smart Slice STT evidence must include taskId.',
    });
  }
  if (!normalizeString(speech.sourceAssetUuid)) {
    blockers.push({
      code: 'SMART_SLICE_STT_SOURCE_ASSET_MISSING',
      message: 'Smart Slice STT evidence must include sourceAssetUuid.',
    });
  }
  if (speechSegments.length === 0) {
    blockers.push({
      code: 'SMART_SLICE_STT_SEGMENTS_MISSING',
      message: 'Smart Slice STT evidence must include timestamped transcript segments.',
    });
  }
  validateOrderedTimeline(speechSegments, blockers);
}

function validateSemanticEvidence(semantic, semanticClips, speechSegments, speakerProfileIds, blockers) {
  if (!semantic || typeof semantic !== 'object' || Array.isArray(semantic)) {
    return;
  }
  if (semantic.schema !== 'smart-slice.semantic-segmentation.v1') {
    blockers.push({
      code: 'SMART_SLICE_SEMANTIC_SCHEMA_UNSUPPORTED',
      message: `Unsupported Smart Slice semantic evidence schema: ${normalizeString(semantic.schema)}`,
      expected: 'smart-slice.semantic-segmentation.v1',
      actual: normalizeString(semantic.schema),
    });
  }
  if (!normalizeString(semantic.taskId)) {
    blockers.push({
      code: 'SMART_SLICE_SEMANTIC_TASK_ID_MISSING',
      message: 'Smart Slice semantic evidence must include taskId.',
    });
  }
  if (!normalizeString(semantic.segmentationAgentId) || !normalizeString(semantic.segmentationAgent?.systemPrompt)) {
    blockers.push({
      code: 'SMART_SLICE_SEMANTIC_AGENT_MISSING',
      message: 'Smart Slice semantic evidence must include the segmentation agent id and system prompt.',
    });
  }
  if (semanticClips.length === 0) {
    blockers.push({
      code: 'SMART_SLICE_SEMANTIC_CLIPS_MISSING',
      message: 'Smart Slice semantic evidence must include the planned semantic clips.',
    });
  }
  for (const clip of semanticClips) {
    validateSemanticClip(clip, speechSegments, speakerProfileIds, blockers);
  }
}

function validateReviewSessionEvidence(reviewSession, reviewSegments, semanticClips, blockers) {
  if (!reviewSession || typeof reviewSession !== 'object' || Array.isArray(reviewSession)) {
    return;
  }
  if (reviewSession.schema !== 'smart-slice.review-session.v1') {
    blockers.push({
      code: 'SMART_SLICE_REVIEW_SESSION_SCHEMA_UNSUPPORTED',
      message: `Unsupported Smart Slice review session evidence schema: ${normalizeString(reviewSession.schema)}`,
      expected: 'smart-slice.review-session.v1',
      actual: normalizeString(reviewSession.schema),
    });
  }
  if (!normalizeString(reviewSession.taskId) || !normalizeString(reviewSession.reviewSessionId)) {
    blockers.push({
      code: 'SMART_SLICE_REVIEW_SESSION_ID_MISSING',
      message: 'Smart Slice review session evidence must include taskId and reviewSessionId.',
    });
  }
  if (reviewSegments.length === 0) {
    blockers.push({
      code: 'SMART_SLICE_REVIEW_SEGMENTS_MISSING',
      message: 'Smart Slice review session evidence must include reviewable segments.',
    });
  }
  const segmentCount = normalizeNonNegativeInteger(reviewSession.segmentCount);
  if (segmentCount !== undefined && segmentCount !== reviewSegments.length) {
    blockers.push({
      code: 'SMART_SLICE_REVIEW_SEGMENT_COUNT_MISMATCH',
      message: 'Smart Slice review session evidence segmentCount must match segments length.',
      expected: reviewSegments.length,
      actual: segmentCount,
    });
  }
  for (const segment of reviewSegments) {
    if (!semanticClips.some((clip) => rangesOverlap(clip.startMs, clip.endMs, segment.startMs, segment.endMs))) {
      blockers.push({
        code: 'SMART_SLICE_REVIEW_SEGMENT_SEMANTIC_RANGE_UNLINKED',
        message: `Smart Slice review segment ${segment.id} does not overlap any semantic clip.`,
        segmentId: segment.id,
      });
    }
  }
}

function validateManualEditsEvidence(manualEdits, reviewSession, blockers) {
  if (!manualEdits || typeof manualEdits !== 'object' || Array.isArray(manualEdits)) {
    return;
  }
  if (manualEdits.schema !== 'smart-slice.manual-edits.v1') {
    blockers.push({
      code: 'SMART_SLICE_MANUAL_EDITS_SCHEMA_UNSUPPORTED',
      message: `Unsupported Smart Slice manual edits evidence schema: ${normalizeString(manualEdits.schema)}`,
      expected: 'smart-slice.manual-edits.v1',
      actual: normalizeString(manualEdits.schema),
    });
  }
  const edits = normalizeArray(manualEdits.manualEdits);
  const editCount = normalizeNonNegativeInteger(manualEdits.editCount);
  if (editCount !== undefined && editCount !== edits.length) {
    blockers.push({
      code: 'SMART_SLICE_MANUAL_EDIT_COUNT_MISMATCH',
      message: 'Smart Slice manual edits evidence editCount must match manualEdits length.',
      expected: edits.length,
      actual: editCount,
    });
  }
  if (reviewSession?.reviewSessionId && manualEdits.reviewSessionId !== reviewSession.reviewSessionId) {
    blockers.push({
      code: 'SMART_SLICE_MANUAL_EDITS_REVIEW_SESSION_MISMATCH',
      message: 'Smart Slice manual edits evidence must reference the review session evidence id.',
    });
  }
}

function validateReviewEventsEvidence(reviewEvents, manualEdits, reviewSession, blockers) {
  if (!reviewEvents || typeof reviewEvents !== 'object' || Array.isArray(reviewEvents)) {
    return;
  }
  if (reviewEvents.schema !== 'smart-slice.review-events.v1') {
    blockers.push({
      code: 'SMART_SLICE_REVIEW_EVENTS_SCHEMA_UNSUPPORTED',
      message: `Unsupported Smart Slice review events schema: ${normalizeString(reviewEvents.schema)}`,
      expected: 'smart-slice.review-events.v1',
      actual: normalizeString(reviewEvents.schema),
    });
  }
  const events = normalizeArray(reviewEvents.events);
  const eventCount = normalizeNonNegativeInteger(reviewEvents.eventCount);
  if (eventCount !== undefined && eventCount !== events.length) {
    blockers.push({
      code: 'SMART_SLICE_REVIEW_EVENT_COUNT_MISMATCH',
      message: 'Smart Slice review events evidence eventCount must match events length.',
      expected: events.length,
      actual: eventCount,
    });
  }
  if (reviewSession?.reviewSessionId && reviewEvents.reviewSessionId !== reviewSession.reviewSessionId) {
    blockers.push({
      code: 'SMART_SLICE_REVIEW_EVENTS_REVIEW_SESSION_MISMATCH',
      message: 'Smart Slice review events evidence must reference the review session evidence id.',
    });
  }
  const manualEditIds = new Set(normalizeArray(manualEdits?.manualEdits).map((edit) => normalizeString(edit?.id)).filter(Boolean));
  const eventEditIds = new Set(events.map((event) => normalizeString(event?.editId)).filter(Boolean));
  for (const editId of manualEditIds) {
    if (!eventEditIds.has(editId)) {
      blockers.push({
        code: 'SMART_SLICE_REVIEW_EVENT_EDIT_UNTRACKED',
        message: `Smart Slice review event log is missing manual edit ${editId}.`,
        editId,
      });
    }
  }
}

function validateRenderSelectionEvidence(renderSelection, reviewSegments, blockers) {
  if (!renderSelection || typeof renderSelection !== 'object' || Array.isArray(renderSelection)) {
    return;
  }
  if (renderSelection.schema !== 'smart-slice.render-selection.v1') {
    blockers.push({
      code: 'SMART_SLICE_RENDER_SELECTION_SCHEMA_UNSUPPORTED',
      message: `Unsupported Smart Slice render selection evidence schema: ${normalizeString(renderSelection.schema)}`,
      expected: 'smart-slice.render-selection.v1',
      actual: normalizeString(renderSelection.schema),
    });
  }
  const reviewSegmentIds = new Set(reviewSegments.map((segment) => segment.id));
  for (const segmentId of normalizeStringArray(renderSelection.selectedSegmentIds)) {
    if (!reviewSegmentIds.has(segmentId)) {
      blockers.push({
        code: 'SMART_SLICE_RENDER_SELECTION_SEGMENT_UNKNOWN',
        message: `Smart Slice render selection references unknown review segment ${segmentId}.`,
        segmentId,
      });
    }
  }
}

function validateRenderArtifactManifestEvidence(renderArtifactManifest, manifestSlices, reviewSegments, blockers) {
  if (!renderArtifactManifest || typeof renderArtifactManifest !== 'object' || Array.isArray(renderArtifactManifest)) {
    return;
  }
  if (renderArtifactManifest.schema !== 'smart-slice.render-artifact-manifest.v1') {
    blockers.push({
      code: 'SMART_SLICE_RENDER_ARTIFACT_MANIFEST_SCHEMA_UNSUPPORTED',
      message: `Unsupported Smart Slice render artifact manifest schema: ${normalizeString(renderArtifactManifest.schema)}`,
      expected: 'smart-slice.render-artifact-manifest.v1',
      actual: normalizeString(renderArtifactManifest.schema),
    });
  }
  if (!normalizeString(renderArtifactManifest.nativeTaskId)) {
    blockers.push({
      code: 'SMART_SLICE_RENDER_ARTIFACT_MANIFEST_NATIVE_TASK_MISSING',
      message: 'Smart Slice render artifact manifest must include nativeTaskId.',
    });
  }
  if (manifestSlices.length === 0) {
    blockers.push({
      code: 'SMART_SLICE_RENDER_ARTIFACT_MANIFEST_SLICES_MISSING',
      message: 'Smart Slice render artifact manifest must include generated slice artifacts.',
    });
  }
  const reviewSegmentIds = new Set(reviewSegments.map((segment) => segment.id));
  for (const slice of manifestSlices) {
    if (!slice.artifactPath && !slice.url) {
      blockers.push({
        code: 'SMART_SLICE_RENDER_ARTIFACT_PATH_MISSING',
        message: `Smart Slice manifest slice ${slice.index + 1} must include artifactPath or url.`,
        sliceIndex: slice.index,
      });
    }
    for (const segmentId of slice.reviewSegmentIds) {
      if (!reviewSegmentIds.has(segmentId)) {
        blockers.push({
          code: 'SMART_SLICE_RENDER_ARTIFACT_REVIEW_SEGMENT_UNKNOWN',
          message: `Smart Slice manifest slice ${slice.index + 1} references unknown review segment ${segmentId}.`,
          sliceIndex: slice.index,
          segmentId,
        });
      }
    }
  }
}

function validateOrderedTimeline(segments, blockers) {
  let previousEndMs;
  for (const [index, segment] of segments.entries()) {
    if (previousEndMs !== undefined && segment.startMs < previousEndMs) {
      blockers.push({
        code: 'SMART_SLICE_STT_TIMELINE_OVERLAP',
        message: `Smart Slice STT segment ${index + 1} overlaps or moves backward in time.`,
        segmentIndex: index,
        previousEndMs,
        startMs: segment.startMs,
      });
    }
    previousEndMs = segment.endMs;
  }
}

function validateSemanticClip(clip, speechSegments, speakerProfileIds, blockers) {
  if (clip.endMs <= clip.startMs || clip.durationMs <= 0) {
    blockers.push({
      code: 'SMART_SLICE_SEMANTIC_CLIP_RANGE_INVALID',
      message: `Smart Slice semantic clip ${clip.index + 1} has an invalid time range.`,
      clipIndex: clip.index,
    });
  }
  if (!clip.transcriptText || clip.transcriptSegmentCount <= 0) {
    blockers.push({
      code: 'SMART_SLICE_SEMANTIC_CLIP_TRANSCRIPT_MISSING',
      message: `Smart Slice semantic clip ${clip.index + 1} is not backed by transcript evidence.`,
      clipIndex: clip.index,
    });
  }
  if (!speechSegments.some((segment) => rangesOverlap(segment.startMs, segment.endMs, clip.speechStartMs, clip.speechEndMs))) {
    blockers.push({
      code: 'SMART_SLICE_SEMANTIC_CLIP_STT_RANGE_UNLINKED',
      message: `Smart Slice semantic clip ${clip.index + 1} does not overlap any STT segment.`,
      clipIndex: clip.index,
    });
  }
  for (const speakerId of clip.speakerIds) {
    if (!speakerProfileIds.has(speakerId)) {
      blockers.push({
        code: 'SMART_SLICE_SEMANTIC_CLIP_SPEAKER_UNKNOWN',
        message: `Smart Slice semantic clip ${clip.index + 1} references unknown speaker ${speakerId}.`,
        clipIndex: clip.index,
        speakerId,
      });
    }
  }
}

function normalizeSpeechSegments(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((segment, index) => {
      const startMs = normalizeNonNegativeInteger(segment?.startMs);
      const endMs = normalizeNonNegativeInteger(segment?.endMs);
      const text = normalizeString(segment?.text);
      if (startMs === undefined || endMs === undefined || endMs <= startMs || !text) {
        return undefined;
      }
      return {
        index,
        startMs,
        endMs,
        text,
        speaker: normalizeString(segment?.speaker),
      };
    })
    .filter(Boolean);
}

function normalizeSemanticClips(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((clip, index) => {
      const startMs = normalizeNonNegativeInteger(clip?.startMs);
      const endMs = normalizeNonNegativeInteger(clip?.endMs);
      const durationMs = normalizeNonNegativeInteger(clip?.durationMs);
      if (startMs === undefined || endMs === undefined || durationMs === undefined) {
        return undefined;
      }
      return {
        index: normalizeNonNegativeInteger(clip?.index) ?? index,
        startMs,
        endMs,
        durationMs,
        speechStartMs: normalizeNonNegativeInteger(clip?.speechStartMs) ?? startMs,
        speechEndMs: normalizeNonNegativeInteger(clip?.speechEndMs) ?? endMs,
        transcriptText: normalizeString(clip?.transcriptText),
        transcriptSegmentCount: normalizeNonNegativeInteger(clip?.transcriptSegmentCount) ?? 0,
        speakerIds: normalizeStringArray(clip?.speakerIds),
      };
    })
    .filter(Boolean);
}

function normalizeSpeakerProfiles(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((profile) => ({
      speakerId: normalizeString(profile?.speakerId ?? profile?.id),
      displayName: normalizeString(profile?.displayName ?? profile?.label),
    }))
    .filter((profile) => profile.speakerId);
}

function normalizeReviewSegments(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((segment, index) => {
      const id = normalizeString(segment?.id);
      const startMs = normalizeNonNegativeInteger(segment?.startMs);
      const endMs = normalizeNonNegativeInteger(segment?.endMs);
      const durationMs = normalizeNonNegativeInteger(segment?.durationMs);
      if (!id || startMs === undefined || endMs === undefined || durationMs === undefined || endMs <= startMs) {
        return undefined;
      }
      return {
        index: normalizeNonNegativeInteger(segment?.index) ?? index,
        id,
        startMs,
        endMs,
        durationMs,
        status: normalizeString(segment?.status),
        selected: segment?.selected === true,
      };
    })
    .filter(Boolean);
}

function normalizeManifestSlices(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((slice, index) => ({
      index: normalizeNonNegativeInteger(slice?.index) ?? index,
      id: normalizeString(slice?.id),
      artifactPath: normalizeString(slice?.artifactPath),
      url: normalizeString(slice?.url),
      reviewSegmentIds: normalizeStringArray(slice?.reviewSegmentIds),
    }))
    .filter((slice) => slice.id || slice.artifactPath || slice.url);
}

function rangesOverlap(firstStartMs, firstEndMs, secondStartMs, secondEndMs) {
  return firstStartMs < secondEndMs && secondStartMs < firstEndMs;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => normalizeString(item)).filter(Boolean);
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNonNegativeInteger(value) {
  const numericValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : undefined;
  if (!Number.isFinite(numericValue)) {
    return undefined;
  }
  return Math.max(0, Math.round(Number(numericValue)));
}

function parseArgs(argv) {
  const args = normalizeAutoCutCliArgs(argv);
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--task-dir') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut smart slice execution evidence',
      });
      options.taskDir = option.value;
      index = option.nextIndex;
    } else if (arg === '--speech') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut smart slice execution evidence',
      });
      options.speechPath = option.value;
      index = option.nextIndex;
    } else if (arg === '--semantic') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut smart slice execution evidence',
      });
      options.semanticPath = option.value;
      index = option.nextIndex;
    } else {
      throw new Error(`Unknown AutoCut smart slice execution evidence argument: ${arg}`);
    }
  }
  return options;
}

function main() {
  const report = createAutoCutSmartSliceExecutionEvidenceValidationReport(parseArgs(process.argv.slice(2)));
  console.log(formatAutoCutSmartSliceExecutionEvidenceValidationMessage(report));
  if (!report.ready) {
    for (const blocker of report.blockers) {
      console.error(`${blocker.code}: ${blocker.message}`);
    }
    process.exit(1);
  }
}

if (path.resolve(process.argv[1] ?? '') === __filename) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
