#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createLargeMediaTranscriptContinuityPlan,
  formatAutoCutGenericRealMediaSliceCheckMessage,
  runAutoCutGenericRealMediaSliceCheck,
} from './check-autocut-generic-real-media-slice.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'autocut-generic-real-media-slice-'));
const inputPath = path.join(root, 'large-source.mp4');
const transcriptPath = path.join(root, 'speech-transcript.json');
const outputDir = path.join(root, 'generic-output');
const renderedDurationsByPath = new Map();
const commandCalls = [];

fs.writeFileSync(inputPath, Buffer.alloc(12_345));
writeTranscriptFixture(transcriptPath);

const result = await runAutoCutGenericRealMediaSliceCheck({
  inputPath,
  transcriptPath,
  outputDir,
  generatedAt: '2026-05-16T10:00:00.000Z',
  renderClipLimit: 1,
  runCommand(command, args) {
    commandCalls.push({ command, args });
    const argText = args.join(' ');
    if (command === 'ffprobe' && argText.includes('format=duration') && args.at(-1)?.endsWith('.mp4')) {
      if (args.at(-1) === inputPath) {
        return { status: 0, stdout: '125.000000\n', stderr: '' };
      }
      const durationMs = renderedDurationsByPath.get(args.at(-1));
      assert.equal(typeof durationMs, 'number', `mock ffprobe must know duration for ${args.at(-1)}`);
      return { status: 0, stdout: `${(durationMs / 1_000).toFixed(6)}\n`, stderr: '' };
    }
    if (command === 'ffprobe' && argText.includes('-select_streams a:0')) {
      return { status: 0, stdout: '1\n', stderr: '' };
    }
    if (command === 'ffprobe' && argText.includes('-show_streams')) {
      return { status: 0, stdout: 'width=1080\nheight=1920\n', stderr: '' };
    }
    if (command === 'ffmpeg' && argText.includes('silencedetect=noise=-35dB:d=0.8')) {
      return { status: 0, stdout: '', stderr: '' };
    }
    if (command === 'ffmpeg' && argText.includes('-vf') && argText.includes('scale=1080:1920')) {
      const outputPath = args.at(-1);
      const durationArg = args[args.indexOf('-t') + 1];
      renderedDurationsByPath.set(outputPath, Math.round(Number(durationArg) * 1_000));
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, Buffer.alloc(8_192));
      return { status: 0, stdout: '', stderr: '' };
    }
    return { status: 1, stdout: '', stderr: `unexpected command ${command} ${argText}` };
  },
});

assert.equal(result.ready, true);
assert.equal(result.report.schemaVersion, '2026-05-16.autocut-generic-real-media-slice.v1');
assert.equal(result.report.input, path.resolve(inputPath));
assert.equal(result.report.transcript, path.resolve(transcriptPath));
assert.equal(result.report.sourceDurationMs, 125_000);
assert.equal(result.report.plannedClipCount >= 1, true);
assert.equal(result.report.renderedClipCount, 1);
assert.equal(result.report.renderLimit, 1);
assert.equal(result.executionEvidenceReport.ready, true);
assert.equal(result.executionEvidenceReport.summary.speechSegmentCount, 5);
assert.equal(result.executionEvidenceReport.summary.renderedSliceCount, 1);
assert.equal(fs.existsSync(result.planPath), true);
assert.equal(fs.existsSync(result.verificationPath), true);
assert.equal(fs.existsSync(result.evidencePackage.speechToTextPath), true);
assert.equal(fs.existsSync(result.evidencePackage.semanticSegmentationPath), true);
assert.equal(fs.existsSync(result.evidencePackage.renderArtifactManifestPath), true);

const speechEvidence = JSON.parse(fs.readFileSync(result.evidencePackage.speechToTextPath, 'utf8'));
assert.equal(speechEvidence.schema, 'smart-slice.speech-to-text.v1');
assert.equal(speechEvidence.segments.length, 5);
assert.equal(speechEvidence.segments.every((segment) => segment.speaker === 'Speaker 1'), true);
assert.equal(
  speechEvidence.nativeTranscriptPath,
  path.resolve(transcriptPath),
  'generic real media Smart Slice must persist the same-source transcript path for audit and replay',
);

const semanticEvidence = JSON.parse(fs.readFileSync(result.evidencePackage.semanticSegmentationPath, 'utf8'));
assert.equal(semanticEvidence.schema, 'smart-slice.semantic-segmentation.v1');
assert.equal(semanticEvidence.planningEngine.length > 0, true);
assert.equal(semanticEvidence.segmentationAgentId, 'semantic-story-agent');
assert.equal(semanticEvidence.speakerEvidence.profiles.length, 1);
assert.equal(semanticEvidence.clips.length, result.report.plannedClipCount);
assert.equal(semanticEvidence.clips[0].transcriptSegmentCount > 0, true);

const manifest = JSON.parse(fs.readFileSync(result.evidencePackage.renderArtifactManifestPath, 'utf8'));
assert.equal(manifest.schema, 'smart-slice.render-artifact-manifest.v1');
assert.equal(manifest.sliceCount, 1);
assert.equal(fs.existsSync(manifest.slices[0].artifactPath), true);
assert.equal(fs.existsSync(manifest.slices[0].subtitleArtifactPath), true);

assert.equal(
  commandCalls.filter((call) => call.command === 'ffmpeg' && call.args.includes('-vf')).length,
  1,
  'generic runner renders only the configured benchmark slice limit by default',
);
assert.match(
  formatAutoCutGenericRealMediaSliceCheckMessage(result),
  /ok - generic real media Smart Slice clips=1 planned=\d+/u,
);

const continuityPlan = createLargeMediaTranscriptContinuityPlan({
  params: {
    minDuration: 30,
    maxDuration: 70,
    idealDuration: 45,
    sourceDurationMs: 240_000,
  },
  transcriptSegments: [
    { startMs: 0, endMs: 8_000, text: '首先说明问题的背景。', speaker: 'Speaker 1' },
    { startMs: 8_000, endMs: 16_000, text: '然后补充关键条件。', speaker: 'Speaker 1' },
    { startMs: 16_000, endMs: 24_000, text: '所以这里不能直接切断。', speaker: 'Speaker 1' },
    { startMs: 24_000, endMs: 36_000, text: '最后给出完整结论。', speaker: 'Speaker 1' },
    { startMs: 90_000, endMs: 100_000, text: '第二个主题开始。', speaker: 'Speaker 1' },
    { startMs: 100_000, endMs: 112_000, text: '继续解释这个主题。', speaker: 'Speaker 1' },
    { startMs: 112_000, endMs: 126_000, text: '因此形成独立完整段落。', speaker: 'Speaker 1' },
  ],
});
assert.equal(continuityPlan.length, 2);
assert.deepEqual(
  continuityPlan.map((clip) => ({
    transcriptSegmentCount: clip.transcriptSegmentCount,
    sourceStartMs: clip.sourceStartMs,
    sourceEndMs: clip.sourceEndMs,
    speakerIds: clip.speakerIds,
  })),
  [
    {
      transcriptSegmentCount: 4,
      sourceStartMs: 0,
      sourceEndMs: 36_350,
      speakerIds: ['speaker-speaker-1'],
    },
    {
      transcriptSegmentCount: 3,
      sourceStartMs: 89_650,
      sourceEndMs: 126_350,
      speakerIds: ['speaker-speaker-1'],
    },
  ],
  'large-media transcript continuity fallback merges dangling connector fragments into complete contiguous speech chunks',
);

console.log('ok - generic real media Smart Slice contract');

function writeTranscriptFixture(targetPath) {
  fs.writeFileSync(targetPath, `${JSON.stringify({
    result: { language: 'zh' },
    transcription: [
      { offsets: { from: 1_000, to: 12_000 }, text: 'Opening context explains the problem and why it matters.' },
      { offsets: { from: 12_200, to: 24_000 }, text: 'The speaker gives the concrete setup and important background.' },
      { offsets: { from: 24_300, to: 37_000 }, text: 'Then the explanation continues with the key method and example.' },
      { offsets: { from: 37_200, to: 49_000 }, text: 'The result is clear and the idea reaches a complete payoff.' },
      { offsets: { from: 80_000, to: 94_000 }, text: 'A second independent point starts later and can become another slice.' },
    ],
  }, null, 2)}\n`);
}
