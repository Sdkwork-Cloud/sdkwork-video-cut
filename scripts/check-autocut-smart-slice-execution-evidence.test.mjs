#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createAutoCutSmartSliceExecutionEvidenceValidationReport,
  formatAutoCutSmartSliceExecutionEvidenceValidationMessage,
} from './check-autocut-smart-slice-execution-evidence.mjs';

function tempRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

function writeJson(targetPath, value) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify(value, null, 2)}\n`);
}

function createReadyTaskDir(root) {
  const taskDir = path.join(root, 'tasks', 'task-slice-ready');
  const speechEvidencePath = path.join(taskDir, 'evidence', 'speech-to-text.json');
  const semanticEvidencePath = path.join(taskDir, 'evidence', 'semantic-segmentation.json');
  const reviewSessionEvidencePath = path.join(taskDir, 'evidence', 'review-session.json');
  const manualEditsEvidencePath = path.join(taskDir, 'evidence', 'manual-edits.json');
  const reviewEventsEvidencePath = path.join(taskDir, 'evidence', 'review-events.json');
  const renderSelectionEvidencePath = path.join(taskDir, 'evidence', 'render-selection.json');
  const renderArtifactManifestEvidencePath = path.join(taskDir, 'evidence', 'render-artifact-manifest.json');
  const speechSegments = [
    {
      startMs: 1_000,
      endMs: 8_000,
      text: 'First explain the customer pain.',
      speaker: 'speaker-1',
    },
    {
      startMs: 8_200,
      endMs: 17_000,
      text: 'Then show the key solution and proof.',
      speaker: 'speaker-2',
    },
    {
      startMs: 17_100,
      endMs: 26_000,
      text: 'Close with a complete takeaway.',
      speaker: 'speaker-1',
    },
  ];
  writeJson(speechEvidencePath, {
    schema: 'smart-slice.speech-to-text.v1',
    taskId: 'task-slice-ready',
    sourceAssetUuid: 'asset-ready',
    sourceDurationMs: 30_000,
    providerId: 'local-whisper-cli',
    language: 'zh',
    text: speechSegments.map((segment) => segment.text).join(' '),
    segments: speechSegments,
    nativeTranscriptPath: 'D:/autocut/tasks/native-transcript/transcript.json',
    nativeTranscriptTaskUuid: 'native-transcript-task',
    nativeTranscriptTaskOutputDir: 'D:/autocut/tasks/native-transcript',
    createdAt: '2026-05-16T00:00:00.000Z',
  });
  writeJson(semanticEvidencePath, {
    schema: 'smart-slice.semantic-segmentation.v1',
    taskId: 'task-slice-ready',
    sourceAssetUuid: 'asset-ready',
    sourceDurationMs: 30_000,
    llmModel: 'deepseek-v4-flash',
    mode: 'contract-mode',
    segmentationDensity: 'default',
    segmentationAgentId: 'semantic-story-agent',
    segmentationAgent: {
      id: 'semantic-story-agent',
      label: 'Semantic story agent',
      description: 'Segments speech into complete semantic stories.',
      systemPrompt: 'Return complete, contiguous, transcript-backed segments.',
    },
    presetId: 'teacher-talking-head-single',
    transcriptSegmentCount: speechSegments.length,
    contentUnitCount: 2,
    candidateCount: 2,
    speakerProfileCount: 2,
    speakerSegmentCount: 3,
    blockers: [],
    transcriptEvidence: { segments: speechSegments },
    speakerEvidence: {
      profiles: [
        { speakerId: 'speaker-1', displayName: 'Speaker 1' },
        { speakerId: 'speaker-2', displayName: 'Speaker 2' },
      ],
      segments: speechSegments.map((segment, index) => ({
        id: `turn-${index + 1}`,
        speakerId: segment.speaker,
        startMs: segment.startMs,
        endMs: segment.endMs,
      })),
    },
    llmReviewAudit: {
      schema: 'smart-cut-engine.llm-review-audit.v1',
      input: {
        contentUnits: [{ id: 'unit-1' }, { id: 'unit-2' }],
        candidates: [{ id: 'candidate-1' }, { id: 'candidate-2' }],
      },
      normalizedReview: { selectedCandidateIds: ['candidate-1'] },
    },
    clips: [
      {
        index: 0,
        candidateId: 'candidate-1',
        title: 'Customer pain and solution',
        label: 'complete-story',
        startMs: 800,
        endMs: 17_400,
        durationMs: 16_600,
        sourceStartMs: 800,
        sourceEndMs: 17_400,
        speechStartMs: 1_000,
        speechEndMs: 17_000,
        contentUnitIds: ['unit-1'],
        speakerIds: ['speaker-1', 'speaker-2'],
        transcriptText: 'First explain the customer pain. Then show the key solution and proof.',
        transcriptSegmentCount: 2,
        transcriptCoverageScore: 0.96,
        speechContinuityGrade: 'strong',
        risks: [],
      },
      {
        index: 1,
        candidateId: 'candidate-2',
        title: 'Complete takeaway',
        label: 'complete-takeaway',
        startMs: 16_900,
        endMs: 26_500,
        durationMs: 9_600,
        sourceStartMs: 16_900,
        sourceEndMs: 26_500,
        speechStartMs: 17_100,
        speechEndMs: 26_000,
        contentUnitIds: ['unit-2'],
        speakerIds: ['speaker-1'],
        transcriptText: 'Close with a complete takeaway.',
        transcriptSegmentCount: 1,
        transcriptCoverageScore: 0.94,
        speechContinuityGrade: 'strong',
        risks: [],
      },
    ],
    createdAt: '2026-05-16T00:00:01.000Z',
  });
  const reviewSegments = [
    {
      index: 0,
      id: 'segment-01',
      sourceClipIndex: 0,
      status: 'selected',
      selected: true,
      title: 'Customer pain and solution',
      startMs: 800,
      endMs: 17_400,
      durationMs: 16_600,
      speechStartMs: 1_000,
      speechEndMs: 17_000,
      contentUnitIds: ['unit-1'],
      speakerIds: ['speaker-1', 'speaker-2'],
      speakerRoles: ['speaker-1', 'speaker-2'],
      transcriptSegmentCount: 2,
      transcriptText: 'First explain the customer pain. Then show the key solution and proof.',
      risks: [],
    },
    {
      index: 1,
      id: 'segment-02',
      sourceClipIndex: 1,
      status: 'selected',
      selected: true,
      title: 'Complete takeaway',
      startMs: 16_900,
      endMs: 26_500,
      durationMs: 9_600,
      speechStartMs: 17_100,
      speechEndMs: 26_000,
      contentUnitIds: ['unit-2'],
      speakerIds: ['speaker-1'],
      speakerRoles: ['speaker-1'],
      transcriptSegmentCount: 1,
      transcriptText: 'Close with a complete takeaway.',
      risks: [],
    },
  ];
  writeJson(reviewSessionEvidencePath, {
    schema: 'smart-slice.review-session.v1',
    taskId: 'task-slice-ready',
    reviewSessionId: 'slice-review-ready',
    status: 'rendered',
    sourceAssetUuid: 'asset-ready',
    sourceDurationMs: 30_000,
    segmentationAgentId: 'semantic-story-agent',
    segmentCount: reviewSegments.length,
    selectedSegmentCount: 2,
    duplicateGroupCount: 0,
    manualEditCount: 0,
    selectedSegmentIds: ['segment-01', 'segment-02'],
    duplicateGroups: [],
    segments: reviewSegments,
    createdAt: '2026-05-16T00:00:02.000Z',
  });
  writeJson(manualEditsEvidencePath, {
    schema: 'smart-slice.manual-edits.v1',
    taskId: 'task-slice-ready',
    reviewSessionId: 'slice-review-ready',
    editCount: 0,
    selectedSegmentIds: ['segment-01', 'segment-02'],
    manualEdits: [],
    segments: reviewSegments,
    createdAt: '2026-05-16T00:00:03.000Z',
  });
  writeJson(reviewEventsEvidencePath, {
    schema: 'smart-slice.review-events.v1',
    taskId: 'task-slice-ready',
    reviewSessionId: 'slice-review-ready',
    reviewVersion: 1,
    eventCount: 1,
    events: [
      {
        index: 0,
        editId: 'system-review-ready',
        kind: 'restore',
        segmentIds: ['segment-01', 'segment-02'],
        createdAt: '2026-05-16T00:00:03.500Z',
        reason: 'system initialized reviewable selected segments',
        resultingSelectedSegmentIds: ['segment-01', 'segment-02'],
      },
    ],
    createdAt: '2026-05-16T00:00:03.500Z',
  });
  writeJson(renderSelectionEvidencePath, {
    schema: 'smart-slice.render-selection.v1',
    taskId: 'task-slice-ready',
    reviewSessionId: 'slice-review-ready',
    selectedSegmentIds: ['segment-01', 'segment-02'],
    selectedSegmentCount: 2,
    submittedManualEditCount: 0,
    appliedManualEditCount: 0,
    manualEdits: [],
    selectedSegments: reviewSegments,
    createdAt: '2026-05-16T00:00:04.000Z',
  });
  writeJson(renderArtifactManifestEvidencePath, {
    schema: 'smart-slice.render-artifact-manifest.v1',
    taskId: 'task-slice-ready',
    nativeTaskId: 'native-render-ready',
    sourceAssetUuid: 'asset-ready',
    sourceDurationMs: 30_000,
    taskOutputDir: path.join(taskDir, 'native-render-ready'),
    sliceCount: 2,
    subtitleMode: 'srt',
    subtitleFormat: 'srt',
    reviewSessionId: 'slice-review-ready',
    selectedSegmentIds: ['segment-01', 'segment-02'],
    slices: [
      {
        index: 0,
        id: 'slice-01',
        name: '01-customer-pain-and-solution.mp4',
        title: 'Customer pain and solution',
        artifactUuid: 'slice-01',
        artifactPath: path.join(taskDir, 'native-render-ready', '01-customer-pain-and-solution.mp4'),
        url: 'asset://localhost/slice-01',
        thumbnailArtifactUuid: 'thumb-01',
        thumbnailArtifactPath: path.join(taskDir, 'native-render-ready', 'cover', '01.jpg'),
        thumbnailUrl: 'asset://localhost/thumb-01',
        subtitleArtifactUuid: 'sub-01',
        subtitleArtifactPath: path.join(taskDir, 'native-render-ready', '01-customer-pain-and-solution.srt'),
        subtitleUrl: 'asset://localhost/sub-01',
        subtitleFormat: 'srt',
        sourceStartMs: 800,
        sourceEndMs: 17_400,
        speechStartMs: 1_000,
        speechEndMs: 17_000,
        durationSeconds: 17,
        byteSize: 120_000,
        nativeClip: { startMs: 800, durationMs: 16_600, label: 'Customer pain and solution' },
        reviewSegmentIds: ['segment-01'],
        transcriptSegmentCount: 2,
        transcriptText: 'First explain the customer pain. Then show the key solution and proof.',
      },
      {
        index: 1,
        id: 'slice-02',
        name: '02-complete-takeaway.mp4',
        title: 'Complete takeaway',
        artifactUuid: 'slice-02',
        artifactPath: path.join(taskDir, 'native-render-ready', '02-complete-takeaway.mp4'),
        url: 'asset://localhost/slice-02',
        thumbnailArtifactUuid: 'thumb-02',
        thumbnailArtifactPath: path.join(taskDir, 'native-render-ready', 'cover', '02.jpg'),
        thumbnailUrl: 'asset://localhost/thumb-02',
        sourceStartMs: 16_900,
        sourceEndMs: 26_500,
        speechStartMs: 17_100,
        speechEndMs: 26_000,
        durationSeconds: 10,
        byteSize: 90_000,
        nativeClip: { startMs: 16_900, durationMs: 9_600, label: 'Complete takeaway' },
        reviewSegmentIds: ['segment-02'],
        transcriptSegmentCount: 1,
        transcriptText: 'Close with a complete takeaway.',
      },
    ],
    createdAt: '2026-05-16T00:00:05.000Z',
  });
  return taskDir;
}

const readyRoot = tempRoot('autocut-smart-slice-execution-evidence-ready');
const readyTaskDir = createReadyTaskDir(readyRoot);
const readyReport = createAutoCutSmartSliceExecutionEvidenceValidationReport({
  taskDir: readyTaskDir,
});

assert.equal(readyReport.schemaVersion, '2026-05-16.autocut-smart-slice-execution-evidence-validation.v1');
assert.equal(readyReport.ready, true);
assert.equal(readyReport.blockers.length, 0);
assert.equal(readyReport.summary.speechSegmentCount, 3);
assert.equal(readyReport.summary.semanticClipCount, 2);
assert.equal(readyReport.summary.speakerProfileCount, 2);
assert.equal(readyReport.summary.semanticClipsWithTranscript, 2);
assert.equal(readyReport.summary.reviewSegmentCount, 2);
assert.equal(readyReport.summary.renderedSliceCount, 2);
assert.equal(
  formatAutoCutSmartSliceExecutionEvidenceValidationMessage(readyReport),
  `ok - autocut smart slice execution evidence ${readyTaskDir} speechSegments=3 semanticClips=2 reviewSegments=2 renderedSlices=2 blockers=0`,
);

const missingSemanticRoot = tempRoot('autocut-smart-slice-execution-evidence-missing-semantic');
const missingSemanticTaskDir = createReadyTaskDir(missingSemanticRoot);
fs.rmSync(path.join(missingSemanticTaskDir, 'evidence', 'semantic-segmentation.json'));
const missingSemanticReport = createAutoCutSmartSliceExecutionEvidenceValidationReport({
  taskDir: missingSemanticTaskDir,
});
assert.equal(missingSemanticReport.ready, false);
assert.equal(
  missingSemanticReport.blockers.some((blocker) => blocker.code === 'SMART_SLICE_SEMANTIC_EVIDENCE_MISSING'),
  true,
);

const missingReviewRoot = tempRoot('autocut-smart-slice-execution-evidence-missing-review');
const missingReviewTaskDir = createReadyTaskDir(missingReviewRoot);
fs.rmSync(path.join(missingReviewTaskDir, 'evidence', 'review-session.json'));
const missingReviewReport = createAutoCutSmartSliceExecutionEvidenceValidationReport({
  taskDir: missingReviewTaskDir,
});
assert.equal(missingReviewReport.ready, false);
assert.equal(
  missingReviewReport.blockers.some((blocker) => blocker.code === 'SMART_SLICE_REVIEW_SESSION_EVIDENCE_MISSING'),
  true,
);

const missingReviewEventsRoot = tempRoot('autocut-smart-slice-execution-evidence-missing-review-events');
const missingReviewEventsTaskDir = createReadyTaskDir(missingReviewEventsRoot);
fs.rmSync(path.join(missingReviewEventsTaskDir, 'evidence', 'review-events.json'));
const missingReviewEventsReport = createAutoCutSmartSliceExecutionEvidenceValidationReport({
  taskDir: missingReviewEventsTaskDir,
});
assert.equal(missingReviewEventsReport.ready, false);
assert.equal(
  missingReviewEventsReport.blockers.some((blocker) => blocker.code === 'SMART_SLICE_REVIEW_EVENTS_EVIDENCE_MISSING'),
  true,
);

const invalidSpeakerRoot = tempRoot('autocut-smart-slice-execution-evidence-invalid-speaker');
const invalidSpeakerTaskDir = createReadyTaskDir(invalidSpeakerRoot);
const invalidSemanticPath = path.join(invalidSpeakerTaskDir, 'evidence', 'semantic-segmentation.json');
const invalidSemantic = JSON.parse(fs.readFileSync(invalidSemanticPath, 'utf8'));
invalidSemantic.clips[0].speakerIds = ['speaker-3'];
writeJson(invalidSemanticPath, invalidSemantic);
const invalidSpeakerReport = createAutoCutSmartSliceExecutionEvidenceValidationReport({
  taskDir: invalidSpeakerTaskDir,
});
assert.equal(invalidSpeakerReport.ready, false);
assert.equal(
  invalidSpeakerReport.blockers.some((blocker) => blocker.code === 'SMART_SLICE_SEMANTIC_CLIP_SPEAKER_UNKNOWN'),
  true,
);

const invalidTimelineRoot = tempRoot('autocut-smart-slice-execution-evidence-invalid-timeline');
const invalidTimelineTaskDir = createReadyTaskDir(invalidTimelineRoot);
const invalidSpeechPath = path.join(invalidTimelineTaskDir, 'evidence', 'speech-to-text.json');
const invalidSpeech = JSON.parse(fs.readFileSync(invalidSpeechPath, 'utf8'));
invalidSpeech.segments[1].startMs = invalidSpeech.segments[0].startMs;
writeJson(invalidSpeechPath, invalidSpeech);
const invalidTimelineReport = createAutoCutSmartSliceExecutionEvidenceValidationReport({
  taskDir: invalidTimelineTaskDir,
});
assert.equal(invalidTimelineReport.ready, false);
assert.equal(
  invalidTimelineReport.blockers.some((blocker) => blocker.code === 'SMART_SLICE_STT_TIMELINE_OVERLAP'),
  true,
);

const localHeuristicRoot = tempRoot('autocut-smart-slice-execution-evidence-local-heuristic');
const localHeuristicTaskDir = createReadyTaskDir(localHeuristicRoot);
const localHeuristicSemanticPath = path.join(localHeuristicTaskDir, 'evidence', 'semantic-segmentation.json');
const localHeuristicSemantic = JSON.parse(fs.readFileSync(localHeuristicSemanticPath, 'utf8'));
delete localHeuristicSemantic.llmReviewAudit;
writeJson(localHeuristicSemanticPath, localHeuristicSemantic);
const localHeuristicReport = createAutoCutSmartSliceExecutionEvidenceValidationReport({
  taskDir: localHeuristicTaskDir,
});
assert.equal(localHeuristicReport.ready, true);
assert.equal(localHeuristicReport.summary.llmReviewAuditReady, false);

console.log('ok - autocut smart slice execution evidence validation contract');
