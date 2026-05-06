#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  createAutoCutSmartSliceTaskEvidenceValidationReport,
} from './check-autocut-smart-slice-task-evidence.mjs';
import {
  writeAutoCutSmartSliceMediaArtifactsEvidence,
} from './write-autocut-smart-slice-media-artifacts-evidence.mjs';
import {
  writeAutoCutSmartSliceQualityEvidence,
} from './write-autocut-smart-slice-quality-evidence.mjs';
import {
  normalizeAutoCutCliArgs,
  readAutoCutCliOptionValue,
} from './autocut-cli-args.mjs';

const __filename = fileURLToPath(import.meta.url);
const sampleSchemaVersion = '2026-05-06.autocut-smart-slice-sample-evidence.v1';
const defaultTaskRelativePath = 'artifacts/smart-slice/smart-slice-task.json';
const defaultReportRelativePath = 'artifacts/release/autocut-smart-slice-sample-evidence.json';
const defaultQualityEvidenceRelativePath = 'artifacts/release/autocut-smart-slice-quality-evidence.json';
const defaultMediaArtifactsEvidenceRelativePath = 'artifacts/release/autocut-smart-slice-media-artifacts-evidence.json';
const sourceVideoRelativePath = 'artifacts/smart-slice-media/source-smart-slice-sample.mp4';
const sliceOneVideoRelativePath = 'artifacts/smart-slice-media/smart-slice-sample-01.mp4';
const sliceTwoVideoRelativePath = 'artifacts/smart-slice-media/smart-slice-sample-02.mp4';
const sliceOneThumbnailRelativePath = 'artifacts/smart-slice-media/smart-slice-sample-01.jpg';
const sliceTwoThumbnailRelativePath = 'artifacts/smart-slice-media/smart-slice-sample-02.jpg';
const sliceOneSubtitleRelativePath = 'artifacts/smart-slice-media/smart-slice-sample-01.srt';
const sliceTwoSubtitleRelativePath = 'artifacts/smart-slice-media/smart-slice-sample-02.srt';

export function createAutoCutSmartSliceSampleEvidencePlan({
  rootDir = process.cwd(),
  ffmpegPath = process.env.SDKWORK_AUTOCUT_FFMPEG_EXECUTABLE,
  generatedAt = new Date().toISOString(),
  taskPath,
  outputPath,
} = {}) {
  const resolvedRootDir = path.resolve(rootDir);
  const resolvedFfmpegPath = resolveFfmpegPath(resolvedRootDir, ffmpegPath);
  const resolvedTaskPath = path.resolve(taskPath ?? path.join(resolvedRootDir, defaultTaskRelativePath));
  const resolvedReportPath = path.resolve(outputPath ?? path.join(resolvedRootDir, defaultReportRelativePath));
  const media = {
    sourceVideo: path.join(resolvedRootDir, sourceVideoRelativePath),
    sliceOneVideo: path.join(resolvedRootDir, sliceOneVideoRelativePath),
    sliceTwoVideo: path.join(resolvedRootDir, sliceTwoVideoRelativePath),
    sliceOneThumbnail: path.join(resolvedRootDir, sliceOneThumbnailRelativePath),
    sliceTwoThumbnail: path.join(resolvedRootDir, sliceTwoThumbnailRelativePath),
    sliceOneSubtitle: path.join(resolvedRootDir, sliceOneSubtitleRelativePath),
    sliceTwoSubtitle: path.join(resolvedRootDir, sliceTwoSubtitleRelativePath),
  };
  const commands = [
    {
      purpose: 'source-video',
      command: resolvedFfmpegPath,
      args: [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=1280x720:rate=30:duration=80',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=880:duration=80',
        '-shortest',
        '-pix_fmt',
        'yuv420p',
        media.sourceVideo,
      ],
    },
    {
      purpose: 'slice-video-1',
      command: resolvedFfmpegPath,
      args: ['-y', '-ss', '0', '-t', '42', '-i', media.sourceVideo, '-c', 'copy', media.sliceOneVideo],
    },
    {
      purpose: 'slice-video-2',
      command: resolvedFfmpegPath,
      args: ['-y', '-ss', '44', '-t', '36', '-i', media.sourceVideo, '-c', 'copy', media.sliceTwoVideo],
    },
    {
      purpose: 'thumbnail-1',
      command: resolvedFfmpegPath,
      args: ['-y', '-ss', '1', '-i', media.sliceOneVideo, '-frames:v', '1', media.sliceOneThumbnail],
    },
    {
      purpose: 'thumbnail-2',
      command: resolvedFfmpegPath,
      args: ['-y', '-ss', '1', '-i', media.sliceTwoVideo, '-frames:v', '1', media.sliceTwoThumbnail],
    },
  ];
  return {
    rootDir: resolvedRootDir,
    ffmpegPath: resolvedFfmpegPath,
    generatedAt,
    taskPath: resolvedTaskPath,
    reportPath: resolvedReportPath,
    qualityEvidencePath: path.join(resolvedRootDir, defaultQualityEvidenceRelativePath),
    mediaArtifactsEvidencePath: path.join(resolvedRootDir, defaultMediaArtifactsEvidenceRelativePath),
    media,
    commands,
  };
}

export function writeAutoCutSmartSliceSampleEvidence({
  runCommand = runAutoCutSmartSliceSampleCommand,
  ...options
} = {}) {
  const plan = createAutoCutSmartSliceSampleEvidencePlan(options);
  for (const targetPath of Object.values(plan.media)) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  }

  const commandResults = plan.commands.map((commandSpec) => {
    const result = runCommand(commandSpec.command, commandSpec.args);
    const status = Number.isInteger(result.status) ? result.status : 1;
    const stdout = String(result.stdout ?? '');
    const stderr = String(result.stderr ?? '');
    if (status !== 0) {
      const detail = stderr.trim() || stdout.trim() || `exit ${status}`;
      throw new Error(`AutoCut smart slice sample FFmpeg command failed for ${commandSpec.purpose}: ${detail}`);
    }
    return {
      purpose: commandSpec.purpose,
      status,
      stdout: trimOutput(stdout),
      stderr: trimOutput(stderr),
    };
  });

  writeSampleSubtitles(plan);
  writeJson(plan.taskPath, createSampleTaskEvidence(plan));
  const taskValidation = createAutoCutSmartSliceTaskEvidenceValidationReport({
    rootDir: plan.rootDir,
    taskPath: plan.taskPath,
    generatedAt: plan.generatedAt,
  });
  const quality = writeAutoCutSmartSliceQualityEvidence({
    rootDir: plan.rootDir,
    taskPath: plan.taskPath,
    outputPath: plan.qualityEvidencePath,
    generatedAt: plan.generatedAt,
  });
  const mediaArtifacts = writeAutoCutSmartSliceMediaArtifactsEvidence({
    rootDir: plan.rootDir,
    taskPath: plan.taskPath,
    outputPath: plan.mediaArtifactsEvidencePath,
    generatedAt: plan.generatedAt,
  });
  const report = {
    schemaVersion: sampleSchemaVersion,
    generatedAt: plan.generatedAt,
    readiness: {
      smartSliceTaskReady: taskValidation.ready,
      smartSliceQualityReady: Boolean(quality.evidence.readiness.smartSliceQualityReady),
      smartSliceMediaArtifactsReady: Boolean(mediaArtifacts.evidence.readiness.smartSliceMediaArtifactsReady),
    },
    paths: {
      task: toPosixRelative(plan.rootDir, plan.taskPath),
      qualityEvidence: toPosixRelative(plan.rootDir, quality.outputPath),
      mediaArtifactsEvidence: toPosixRelative(plan.rootDir, mediaArtifacts.outputPath),
    },
    task: {
      resultCount: taskValidation.summary.totalSlices,
      blockers: taskValidation.blockers,
    },
    ffmpeg: {
      path: plan.ffmpegPath,
      commands: commandResults,
    },
    quality: {
      summary: quality.evidence.summary,
      blockers: quality.evidence.blockers,
    },
    mediaArtifacts: {
      summary: mediaArtifacts.evidence.summary,
      blockers: mediaArtifacts.evidence.blockers,
    },
  };
  const ready = Object.values(report.readiness).every(Boolean);
  fs.mkdirSync(path.dirname(plan.reportPath), { recursive: true });
  fs.writeFileSync(`${plan.reportPath}.tmp`, `${JSON.stringify(report, null, 2)}\n`);
  fs.renameSync(`${plan.reportPath}.tmp`, plan.reportPath);
  if (!ready) {
    throw new Error(`AutoCut smart slice sample evidence is not ready: ${JSON.stringify(report.readiness)}`);
  }
  return {
    ready,
    outputPath: plan.reportPath,
    plan,
    report,
  };
}

export function formatAutoCutSmartSliceSampleEvidenceMessage(result) {
  return `ok - autocut smart slice sample evidence ${result.outputPath} slices=${result.report.task.resultCount} ready=${result.ready}`;
}

export function runAutoCutSmartSliceSampleCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
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

function createSampleTaskEvidence(plan) {
  const sliceOneSize = fileSize(plan.media.sliceOneVideo);
  const sliceTwoSize = fileSize(plan.media.sliceTwoVideo);
  return {
    schemaVersion: '2026-05-06.autocut-smart-slice-task-evidence.v1',
    evidenceKind: 'smart-slice-task',
    exportedAt: plan.generatedAt,
    id: 'task-smart-slice-release-sample',
    type: 'smart-slice',
    name: 'autocut-smart-slice-release-sample',
    status: 'completed',
    progress: 100,
    createdAt: plan.generatedAt,
    completedAt: plan.generatedAt,
    sourceFileId: 'asset-smart-slice-release-sample-source',
    generatedAssetIds: ['asset-smart-slice-release-sample-1', 'asset-smart-slice-release-sample-2'],
    resultCount: 2,
    sliceResults: [
      {
        id: 'asset-smart-slice-release-sample-1',
        name: 'smart-slice-sample-01.mp4',
        duration: 42,
        size: sliceOneSize,
        resolution: '720P',
        url: toAssetUrl(plan.media.sliceOneVideo),
        thumbnailUrl: toAssetUrl(plan.media.sliceOneThumbnail),
        subtitleUrl: toAssetUrl(plan.media.sliceOneSubtitle),
        subtitleFormat: 'srt',
        qualityScore: 0.9,
        continuityScore: 0.92,
        storyShape: 'complete',
        publishabilityScore: 0.88,
        publishabilityGrade: 'excellent',
        publishabilityIssues: [],
        boundaryQualityScore: 0.86,
        hookStrength: 'strong',
        endingCompleteness: 'complete',
        contentArcScore: 1,
        contentArcGrade: 'complete',
        contentArcStages: ['hook', 'setup', 'conflict', 'payoff'],
        contentArcMissingStages: [],
        topicCoherenceScore: 0.88,
        topicCoherenceGrade: 'strong',
        topicShiftCount: 0,
        topicKeywords: ['result', 'opening', 'payoff'],
        platformReadinessScore: 0.84,
        platformReadinessGrade: 'ready',
        platformReadinessIssues: [],
        sentenceBoundaryIntegrityScore: 0.92,
        sentenceBoundaryIntegrityGrade: 'clean',
        sentenceBoundaryIssues: [],
        risks: [],
        sourceStartMs: 0,
        sourceEndMs: 42000,
        speechStartMs: 200,
        speechEndMs: 41700,
        boundaryPaddingBeforeMs: 200,
        boundaryPaddingAfterMs: 300,
        transcriptText:
          'Why short videos fail is simple. The opening hides the result, so viewers leave before the payoff.',
        transcriptCoverageScore: 0.96,
        subtitleSegmentCount: 4,
        speechContinuityGrade: 'strong',
      },
      {
        id: 'asset-smart-slice-release-sample-2',
        name: 'smart-slice-sample-02.mp4',
        duration: 36,
        size: sliceTwoSize,
        resolution: '720P',
        url: toAssetUrl(plan.media.sliceTwoVideo),
        thumbnailUrl: toAssetUrl(plan.media.sliceTwoThumbnail),
        subtitleUrl: toAssetUrl(plan.media.sliceTwoSubtitle),
        subtitleFormat: 'srt',
        qualityScore: 0.84,
        continuityScore: 0.88,
        storyShape: 'complete',
        publishabilityScore: 0.74,
        publishabilityGrade: 'good',
        publishabilityIssues: [],
        boundaryQualityScore: 0.8,
        hookStrength: 'contextual',
        endingCompleteness: 'complete',
        contentArcScore: 1,
        contentArcGrade: 'complete',
        contentArcStages: ['hook', 'setup', 'payoff'],
        contentArcMissingStages: [],
        topicCoherenceScore: 0.84,
        topicCoherenceGrade: 'strong',
        topicShiftCount: 0,
        topicKeywords: ['result', 'example', 'fix'],
        platformReadinessScore: 0.76,
        platformReadinessGrade: 'review',
        platformReadinessIssues: [],
        sentenceBoundaryIntegrityScore: 0.84,
        sentenceBoundaryIntegrityGrade: 'repaired',
        sentenceBoundaryIssues: ['sentence-open-ending-repaired'],
        risks: [],
        sourceStartMs: 44000,
        sourceEndMs: 80000,
        speechStartMs: 44200,
        speechEndMs: 79750,
        boundaryPaddingBeforeMs: 200,
        boundaryPaddingAfterMs: 250,
        transcriptText:
          'The practical fix is to show the outcome first, then use one clear example to prove the point.',
        transcriptCoverageScore: 0.9,
        subtitleSegmentCount: 3,
        speechContinuityGrade: 'repaired',
      },
    ],
  };
}

function writeSampleSubtitles(plan) {
  fs.writeFileSync(
    plan.media.sliceOneSubtitle,
    [
      '1',
      '00:00:00,000 --> 00:00:10,000',
      'Why short videos fail is simple.',
      '',
      '2',
      '00:00:10,000 --> 00:00:22,000',
      'The opening hides the result.',
      '',
      '3',
      '00:00:22,000 --> 00:00:34,000',
      'Viewers leave before the payoff.',
      '',
      '4',
      '00:00:34,000 --> 00:00:42,000',
      'Show the result first.',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    plan.media.sliceTwoSubtitle,
    [
      '1',
      '00:00:00,000 --> 00:00:12,000',
      'The practical fix is to show the outcome first.',
      '',
      '2',
      '00:00:12,000 --> 00:00:25,000',
      'Use one clear example to prove the point.',
      '',
      '3',
      '00:00:25,000 --> 00:00:36,000',
      'Keep the setup and ending together.',
      '',
    ].join('\n'),
  );
}

function resolveFfmpegPath(rootDir, configuredPath) {
  if (typeof configuredPath === 'string' && configuredPath.trim()) {
    const resolved = path.resolve(configuredPath.trim());
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      throw new Error(`AutoCut smart slice sample FFmpeg executable is missing: ${resolved}`);
    }
    return resolved;
  }
  const manifestPath = path.join(
    rootDir,
    'packages/sdkwork-autocut-desktop/src-tauri/binaries/ffmpeg.toolchain.json',
  );
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const relativePath = manifest.platforms?.['windows-x86_64']?.relativePath;
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new Error('AutoCut smart slice sample requires a windows-x86_64 FFmpeg sidecar manifest entry.');
  }
  const resolved = path.join(path.dirname(manifestPath), relativePath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`AutoCut smart slice sample FFmpeg executable is missing: ${resolved}`);
  }
  return resolved;
}

function toAssetUrl(artifactPath) {
  return `asset://localhost/${encodeURIComponent(path.resolve(artifactPath))}`;
}

function fileSize(filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`AutoCut smart slice sample artifact is missing: ${filePath}`);
  }
  return fs.statSync(filePath).size;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(`${filePath}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(`${filePath}.tmp`, filePath);
}

function trimOutput(output) {
  const maxLength = 4000;
  return output.length <= maxLength ? output : `${output.slice(0, maxLength)}\n[autocut-smart-slice-sample-output-truncated]`;
}

function toPosixRelative(rootDir, targetPath) {
  return path.relative(rootDir, targetPath).replaceAll(path.sep, '/');
}

function parseArgs(argv) {
  const options = {};
  const args = normalizeAutoCutCliArgs(argv);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--ffmpeg') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut smart slice sample evidence',
      });
      options.ffmpegPath = option.value;
      index = option.nextIndex;
    } else if (arg === '--task') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut smart slice sample evidence',
      });
      options.taskPath = option.value;
      index = option.nextIndex;
    } else if (arg === '--output') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut smart slice sample evidence',
      });
      options.outputPath = option.value;
      index = option.nextIndex;
    } else {
      throw new Error(`Unknown AutoCut smart slice sample evidence argument: ${arg}`);
    }
  }
  return options;
}

function main() {
  const result = writeAutoCutSmartSliceSampleEvidence(parseArgs(process.argv.slice(2)));
  console.log(formatAutoCutSmartSliceSampleEvidenceMessage(result));
}

if (path.resolve(process.argv[1] ?? '') === __filename) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
