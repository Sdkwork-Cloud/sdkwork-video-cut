#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  formatAutoCutWenan5RealMediaSliceCheckMessage,
  runAutoCutWenan5RealMediaSliceCheck,
} from './check-autocut-wenan5-real-media-slice.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const fixtureRoot = path.join(repoRoot, 'artifacts/autocut-diagnostics/wenan5');
const sourceAudioPath = path.join(fixtureRoot, 'speech.wav');
const transcriptPath = path.join(fixtureRoot, 'speech-transcript.json');
const generatedSourcePath = path.join(fixtureRoot, 'wenan5-e2e-source.mp4');
const outputDir = path.join(fixtureRoot, 'slices-e2e');
const ffmpegPath = process.env.SDKWORK_AUTOCUT_FFMPEG_EXECUTABLE ?? process.env.SDKWORK_AUTOCUT_FFMPEG ?? 'ffmpeg';
const ffprobePath = process.env.SDKWORK_AUTOCUT_FFPROBE_EXECUTABLE ?? process.env.SDKWORK_AUTOCUT_FFPROBE ?? 'ffprobe';

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
  });
  if (result.error) {
    return {
      status: 1,
      stdout: '',
      stderr: result.error.message,
    };
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function assertFixtureReady() {
  assert.equal(fs.existsSync(sourceAudioPath), true, `missing Smart Slice e2e source audio: ${sourceAudioPath}`);
  assert.equal(fs.existsSync(transcriptPath), true, `missing Smart Slice e2e transcript: ${transcriptPath}`);
  const ffmpegVersion = runCommand(ffmpegPath, ['-version']);
  assert.equal(ffmpegVersion.status, 0, `ffmpeg is required for Smart Slice e2e: ${ffmpegVersion.stderr}`);
  const ffprobeVersion = runCommand(ffprobePath, ['-version']);
  assert.equal(ffprobeVersion.status, 0, `ffprobe is required for Smart Slice e2e: ${ffprobeVersion.stderr}`);
}

function readAudioDurationSeconds() {
  const result = runCommand(ffprobePath, [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    sourceAudioPath,
  ]);
  assert.equal(result.status, 0, `ffprobe failed for Smart Slice e2e audio: ${result.stderr}`);
  const durationSeconds = Number(String(result.stdout).trim());
  assert.equal(Number.isFinite(durationSeconds) && durationSeconds > 0, true, 'Smart Slice e2e audio duration must be positive');
  return durationSeconds;
}

function ensureDeterministicSourceVideo() {
  const durationSeconds = readAudioDurationSeconds();
  fs.mkdirSync(path.dirname(generatedSourcePath), { recursive: true });
  const result = runCommand(ffmpegPath, [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `testsrc2=size=360x640:rate=10:duration=${durationSeconds.toFixed(6)}`,
    '-i',
    sourceAudioPath,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-shortest',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-crf',
    '30',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    generatedSourcePath,
  ]);
  assert.equal(result.status, 0, `failed to create Smart Slice e2e source video: ${result.stderr || result.stdout}`);
  const sourceStat = fs.statSync(generatedSourcePath);
  assert.equal(sourceStat.size > 1024 * 1024, true, 'Smart Slice e2e source video must be a non-empty media fixture');
}

function verifyRenderedArtifacts(result) {
  assert.equal(result.ready, true, 'Smart Slice e2e result must be ready');
  assert.equal(result.report.renderedClipCount >= 3, true, 'Smart Slice e2e must render multiple clips');
  assert.equal(result.report.blockers.length, 0, 'Smart Slice e2e verification must have no blockers');
  for (const clip of result.report.clips) {
    assert.equal(typeof clip.outputPath, 'string', `Smart Slice e2e clip ${clip.index + 1} must expose an output path`);
    assert.equal(fs.existsSync(clip.outputPath), true, `Smart Slice e2e output is missing: ${clip.outputPath}`);
    const stat = fs.statSync(clip.outputPath);
    assert.equal(stat.size > 0, true, `Smart Slice e2e output is empty: ${clip.outputPath}`);
    assert.equal(clip.blockers.length, 0, `Smart Slice e2e clip ${clip.index + 1} must have no blockers`);
    assert.equal(clip.longSilenceCount, 0, `Smart Slice e2e clip ${clip.index + 1} must not contain long silence`);
    assert.equal((clip.transcriptSegmentCount ?? 0) > 0, true, `Smart Slice e2e clip ${clip.index + 1} must retain transcript evidence`);
  }
}

assertFixtureReady();
ensureDeterministicSourceVideo();

const result = await runAutoCutWenan5RealMediaSliceCheck({
  inputPath: generatedSourcePath,
  transcriptPath,
  outputDir,
  ffmpegPath,
  ffprobePath,
});
verifyRenderedArtifacts(result);

console.log(formatAutoCutWenan5RealMediaSliceCheckMessage(result));
