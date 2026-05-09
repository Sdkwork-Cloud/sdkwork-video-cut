#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createAutoCutSmartSliceSampleEvidencePlan,
  formatAutoCutSmartSliceSampleEvidenceMessage,
  writeAutoCutSmartSliceSampleEvidence,
} from './write-autocut-smart-slice-sample-evidence.mjs';

function tempRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

const root = tempRoot('autocut-smart-slice-sample');
const ffmpegPath = path.join(root, 'bin', 'ffmpeg.exe');
fs.mkdirSync(path.dirname(ffmpegPath), { recursive: true });
fs.writeFileSync(ffmpegPath, 'ffmpeg fixture');

const plan = createAutoCutSmartSliceSampleEvidencePlan({
  rootDir: root,
  ffmpegPath,
  generatedAt: '2026-05-06T00:00:00.000Z',
});

assert.equal(plan.ffmpegPath, ffmpegPath);
assert.equal(plan.taskPath, path.join(root, 'artifacts', 'smart-slice', 'smart-slice-task.json'));
assert.equal(plan.qualityEvidencePath, path.join(root, 'artifacts', 'release', 'autocut-smart-slice-quality-evidence.json'));
assert.equal(plan.mediaArtifactsEvidencePath, path.join(root, 'artifacts', 'release', 'autocut-smart-slice-media-artifacts-evidence.json'));
assert.equal(plan.reportPath, path.join(root, 'artifacts', 'release', 'autocut-smart-slice-sample-evidence.json'));
assert.equal(plan.commands.length, 5);
assert.equal(plan.commands.every((command) => command.command === ffmpegPath), true);
assert.equal(plan.commands[0].purpose, 'source-video');
assert.equal(plan.commands[1].purpose, 'slice-video-1');
assert.equal(plan.commands[2].purpose, 'slice-video-2');
assert.equal(plan.commands[3].purpose, 'thumbnail-1');
assert.equal(plan.commands[4].purpose, 'thumbnail-2');

const platformRoot = tempRoot('autocut-smart-slice-sample-platform');
const platformManifestDir = path.join(platformRoot, 'packages', 'sdkwork-autocut-desktop', 'src-tauri', 'binaries');
const linuxFfmpegPath = path.join(platformManifestDir, 'linux-x86_64', 'ffmpeg');
fs.mkdirSync(path.dirname(linuxFfmpegPath), { recursive: true });
fs.writeFileSync(linuxFfmpegPath, 'linux ffmpeg fixture');
fs.writeFileSync(
  path.join(platformManifestDir, 'ffmpeg.toolchain.json'),
  `${JSON.stringify(
    {
      tool: 'ffmpeg',
      platforms: {
        'windows-x86_64': {
          relativePath: 'windows-x86_64/ffmpeg.exe',
        },
        'linux-x86_64': {
          relativePath: 'linux-x86_64/ffmpeg',
        },
      },
    },
    null,
    2,
  )}\n`,
);
const linuxPlan = createAutoCutSmartSliceSampleEvidencePlan({
  rootDir: platformRoot,
  platform: 'linux-x86_64',
  generatedAt: '2026-05-06T00:00:00.000Z',
});
assert.equal(linuxPlan.ffmpegPath, linuxFfmpegPath);

const result = writeAutoCutSmartSliceSampleEvidence({
  rootDir: root,
  ffmpegPath,
  generatedAt: '2026-05-06T00:00:00.000Z',
  runCommand(command, args) {
    const outputPath = args.at(-1);
    assert.equal(command, ffmpegPath);
    assert.equal(typeof outputPath, 'string');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${path.basename(outputPath)} bytes`);
    return {
      status: 0,
      stdout: 'ffmpeg ok',
      stderr: '',
    };
  },
});

assert.equal(result.ready, true);
assert.equal(result.report.schemaVersion, '2026-05-06.autocut-smart-slice-sample-evidence.v1');
assert.equal(result.report.readiness.smartSliceTaskReady, true);
assert.equal(result.report.readiness.smartSliceQualityReady, true);
assert.equal(result.report.readiness.smartSliceMediaArtifactsReady, true);
assert.equal(result.report.task.resultCount, 2);
assert.equal(result.report.ffmpeg.commands.length, 5);
assert.equal(fs.existsSync(result.plan.taskPath), true);
assert.equal(fs.existsSync(result.plan.qualityEvidencePath), true);
assert.equal(fs.existsSync(result.plan.mediaArtifactsEvidencePath), true);
assert.equal(fs.existsSync(result.outputPath), true);
assert.equal(
  formatAutoCutSmartSliceSampleEvidenceMessage(result),
  `ok - autocut smart slice sample evidence ${result.outputPath} slices=2 ready=true`,
);

assert.throws(
  () =>
    writeAutoCutSmartSliceSampleEvidence({
      rootDir: tempRoot('autocut-smart-slice-sample-failed'),
      ffmpegPath,
      runCommand() {
        return {
          status: 1,
          stdout: '',
          stderr: 'ffmpeg failed',
        };
      },
    }),
  /AutoCut smart slice sample FFmpeg command failed/u,
);

console.log('ok - autocut smart slice sample evidence contract');
