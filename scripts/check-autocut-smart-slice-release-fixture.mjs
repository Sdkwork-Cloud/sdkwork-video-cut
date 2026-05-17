#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  createAutoCutCommercialReleaseReadinessReport,
} from './check-autocut-commercial-release-readiness.mjs';
import {
  createAutoCutSmartSliceTaskEvidenceValidationReport,
} from './check-autocut-smart-slice-task-evidence.mjs';
import {
  writeAutoCutReleaseEvidence,
} from './write-autocut-release-evidence.mjs';
import {
  writeAutoCutSmartSliceQualityEvidence,
} from './write-autocut-smart-slice-quality-evidence.mjs';
import {
  writeAutoCutSmartSliceMediaArtifactsEvidence,
} from './write-autocut-smart-slice-media-artifacts-evidence.mjs';
import {
  normalizeAutoCutCliArgs,
  readAutoCutCliOptionValue,
} from './autocut-cli-args.mjs';
import {
  AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD,
} from '../packages/sdkwork-autocut-types/src/index.ts';

const __filename = fileURLToPath(import.meta.url);
const releaseFixtureSchemaVersion = '2026-05-06.autocut-smart-slice-release-fixture.v1';
const taskEvidenceRelativePath = 'artifacts/smart-slice/smart-slice-task.json';
const qualityEvidenceRelativePath = 'artifacts/release/autocut-smart-slice-quality-evidence.json';
const mediaArtifactsEvidenceRelativePath = 'artifacts/release/autocut-smart-slice-media-artifacts-evidence.json';
const releaseEvidenceRelativePath = 'artifacts/release/autocut-release-evidence.json';
const defaultFixtureReportRelativePath = 'artifacts/release/autocut-smart-slice-release-fixture.json';
const fixtureAudioCleanupEvidence = {
  audioCleanupProfile: AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD.audioCleanupProfile,
  noiseReductionApplied: AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD.defaultNoiseReductionApplied,
  boundaryDecisionSource: 'combined',
  audioActivityConfidence: 0.94,
  audioActivityAnalysisFilter: AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD.defaultNoiseReductionApplied
    ? AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD.requiredAudioActivityAnalysisFilter
    : AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD.rawAudioActivityAnalysisFilter,
  leadingSilenceMs: AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD.maxLeadingSilenceMs,
  trailingSilenceMs: AUTOCUT_SMART_SLICE_PROFESSIONAL_STANDARD.maxTrailingSilenceMs,
  leadingSilenceTrimMs: 0,
  trailingSilenceTrimMs: 0,
  tailTreatment: 'none',
};

export function createAutoCutSmartSliceReleaseFixtureReport({
  rootDir,
  generatedAt = new Date().toISOString(),
  fixtureProfile = 'ready',
  outputPath,
} = {}) {
  const resolvedRootDir = path.resolve(
    rootDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'autocut-smart-slice-release-fixture-')),
  );
  const resolvedOutputPath = path.resolve(
    outputPath ?? path.join(resolvedRootDir, defaultFixtureReportRelativePath),
  );
  fs.mkdirSync(resolvedRootDir, { recursive: true });

  writeFixtureReleaseInputs(resolvedRootDir, generatedAt, fixtureProfile);
  const taskValidation = createAutoCutSmartSliceTaskEvidenceValidationReport({
    rootDir: resolvedRootDir,
    generatedAt,
  });
  const qualityResult = writeQualityEvidenceIfPossible(resolvedRootDir, generatedAt, taskValidation.ready);
  const mediaArtifactsResult = writeMediaArtifactsEvidenceIfPossible(
    resolvedRootDir,
    generatedAt,
    taskValidation.ready,
  );
  const releaseResult = writeReleaseEvidenceIfPossible(
    resolvedRootDir,
    generatedAt,
    qualityResult.ready && mediaArtifactsResult.ready,
  );
  const commercialReadiness = createCommercialReadinessIfPossible(
    resolvedRootDir,
    generatedAt,
    releaseResult.ready,
  );
  const blockers = createReleaseFixtureBlockers({
    taskValidation,
    smartSliceQuality: qualityResult,
    smartSliceMediaArtifacts: mediaArtifactsResult,
    releaseEvidence: releaseResult,
    commercialReadiness,
  });

  return {
    schemaVersion: releaseFixtureSchemaVersion,
    generatedAt,
    rootDir: resolvedRootDir,
    fixtureProfile,
    ready: blockers.length === 0,
    paths: {
      fixtureReport: toPosixRelative(resolvedRootDir, resolvedOutputPath),
      taskEvidence: taskEvidenceRelativePath,
      qualityEvidence: qualityEvidenceRelativePath,
      mediaArtifactsEvidence: mediaArtifactsEvidenceRelativePath,
      releaseEvidence: releaseEvidenceRelativePath,
    },
    summary: {
      totalSlices: taskValidation.summary.totalSlices,
      smartSliceQualityReady: qualityResult.ready,
      smartSliceMediaArtifactsReady: mediaArtifactsResult.ready,
      commercialReleaseReady: commercialReadiness.ready,
      reviewWarningSlices: taskValidation.summary.reviewWarningSlices,
      reviewWarningCount: taskValidation.summary.reviewWarningCount,
    },
    taskValidation: {
      ready: taskValidation.ready,
      blockers: taskValidation.blockers,
      summary: taskValidation.summary,
      reviewWarnings: taskValidation.reviewWarnings,
    },
    smartSliceQuality: qualityResult,
    smartSliceMediaArtifacts: mediaArtifactsResult,
    releaseEvidence: releaseResult,
    commercialReadiness,
    blockers,
  };
}

export function writeAutoCutSmartSliceReleaseFixtureReport({
  rootDir,
  outputPath,
  ...options
} = {}) {
  const report = createAutoCutSmartSliceReleaseFixtureReport({
    rootDir,
    outputPath,
    ...options,
  });
  const resolvedRootDir = path.resolve(report.rootDir);
  const resolvedOutputPath = path.resolve(
    outputPath ?? path.join(resolvedRootDir, defaultFixtureReportRelativePath),
  );
  fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  fs.writeFileSync(`${resolvedOutputPath}.tmp`, `${JSON.stringify(report, null, 2)}\n`);
  fs.renameSync(`${resolvedOutputPath}.tmp`, resolvedOutputPath);
  return {
    outputPath: resolvedOutputPath,
    report,
  };
}

export function formatAutoCutSmartSliceReleaseFixtureMessage(report) {
  if (report.ready) {
    return `ok - autocut smart slice release fixture ${report.rootDir} slices=${report.summary.totalSlices} commercialReleaseReady=${report.summary.commercialReleaseReady} blockers=0`;
  }
  return `blocked - autocut smart slice release fixture ${report.rootDir} slices=${report.summary.totalSlices} blockers=${report.blockers.length}`;
}

export function createAutoCutSmartSliceReleaseFixtureReportFromArgs(argv, generatedAt) {
  return createAutoCutSmartSliceReleaseFixtureReport({
    ...parseArgs(argv),
    ...(generatedAt ? { generatedAt } : {}),
  });
}

function writeFixtureReleaseInputs(rootDir, generatedAt, fixtureProfile) {
  writeSmartSliceMediaFiles(rootDir);
  writeJson(
    path.join(rootDir, taskEvidenceRelativePath),
    createSmartSliceTaskFixture(rootDir, generatedAt, fixtureProfile),
  );
  writeFfmpegFixture(rootDir);
  writeSpeechSidecarFixture(rootDir);
  writeJson(
    path.join(rootDir, 'artifacts/release/autocut-native-release-smoke.json'),
    {
      schemaVersion: '2026-05-05.autocut-native-release-smoke.v1',
      generatedAt,
      readiness: {
        nativeReleaseSmokeReady: true,
        videoSliceSmokeReady: true,
        ffmpegExecutionReady: false,
      },
      commandMatrix: [
        {
          command: 'autocut_ffmpeg_probe',
          evidenceReady: true,
        },
        {
          command: 'autocut_slice_video',
          evidenceReady: true,
        },
      ],
      videoSliceSmoke: {
        skipped: false,
        success: true,
        status: 0,
        command: 'cargo +1.90.0 test --manifest-path packages/sdkwork-autocut-desktop/src-tauri/Cargo.toml media_runtime::tests::video_slice_from_asset_registers_each_slice_artifact_inside_task_output_dir -- --exact --test-threads=1 --nocapture',
        stdout: 'autocut-video-slice-smoke=passed',
        stderr: '',
      },
    },
  );
  writeJson(
    path.join(rootDir, 'artifacts/release/autocut-installer-signature-evidence.json'),
    {
      schemaVersion: '2026-05-05.autocut-installer-signature-evidence.v1',
      generatedAt,
      readiness: {
        installerSignatureReady: true,
      },
      blockers: [],
    },
  );
  writeInstallerFixture(rootDir);
}

function createSmartSliceTaskFixture(rootDir, generatedAt, fixtureProfile) {
  const blocked = fixtureProfile === 'blocked-transcript';
  return {
    schemaVersion: '2026-05-06.autocut-smart-slice-task-evidence.v1',
    evidenceKind: 'smart-slice-task',
    exportedAt: generatedAt,
    id: `task-smart-slice-release-fixture-${fixtureProfile}`,
    type: 'smart-slice',
    name: `autocut-smart-slice-release-fixture-${fixtureProfile}`,
    status: 'completed',
    progress: 100,
    createdAt: generatedAt,
    completedAt: generatedAt,
    sourceFileId: 'asset-release-fixture-source',
    generatedAssetIds: ['asset-release-fixture-slice-1', 'asset-release-fixture-slice-2'],
    resultCount: 2,
    sliceResults: [
      createSmartSliceResultFixture({
        rootDir,
        id: 'asset-release-fixture-slice-1',
        name: 'release-fixture-01.mp4',
        sourceStartMs: 0,
        sourceEndMs: 41950,
        speechStartMs: 200,
        speechEndMs: 41700,
        duration: 42,
        transcriptText: [
          'Why short videos fail is simple.',
          'The opening hides the result.',
          'Viewers leave before the payoff.',
          'Show the result first.',
        ].join(' '),
        transcriptSegments: createSmartSliceTranscriptSegments(0, [
          ['Why short videos fail is simple.', 200, 10_000],
          ['The opening hides the result.', 10_000, 22_000],
          ['Viewers leave before the payoff.', 22_000, 34_000],
          ['Show the result first.', 34_000, 41_700],
        ]),
        transcriptSegmentCount: 4,
        publishabilityScore: 0.88,
        publishabilityGrade: 'excellent',
        platformReadinessScore: 0.84,
        platformReadinessGrade: 'ready',
        continuityScore: blocked ? 0.42 : 0.9,
        transcriptCoverageScore: blocked ? 0.2 : 0.96,
        speechContinuityGrade: blocked ? 'weak' : 'strong',
        ...(blocked
          ? {
              transcriptText: '',
              transcriptSegments: [],
              transcriptSegmentCount: 0,
            }
          : {}),
      }),
      createSmartSliceResultFixture({
        rootDir,
        id: 'asset-release-fixture-slice-2',
        name: 'release-fixture-02.mp4',
        sourceStartMs: 44000,
        sourceEndMs: 80000,
        speechStartMs: 44200,
        speechEndMs: 79750,
        duration: 36,
        transcriptText: [
          'The practical fix is to show the outcome first.',
          'Use one clear example to prove the point.',
          'Keep the setup and ending together.',
        ].join(' '),
        transcriptSegments: createSmartSliceTranscriptSegments(44_000, [
          ['The practical fix is to show the outcome first.', 200, 12_000],
          ['Use one clear example to prove the point.', 12_000, 25_000],
          ['Keep the setup and ending together.', 25_000, 35_750],
        ]),
        transcriptSegmentCount: 3,
        publishabilityScore: 0.74,
        publishabilityGrade: 'good',
        platformReadinessScore: 0.76,
        platformReadinessGrade: 'review',
        continuityScore: 0.88,
        transcriptCoverageScore: 0.9,
        speechContinuityGrade: 'repaired',
        sentenceBoundaryIntegrityGrade: 'repaired',
        sentenceBoundaryIssues: ['sentence-open-ending-repaired'],
      }),
    ],
  };
}

function createSmartSliceResultFixture({
  rootDir,
  id,
  name,
  sourceStartMs,
  sourceEndMs,
  speechStartMs,
  speechEndMs,
  duration,
  transcriptText,
  transcriptSegments,
  transcriptSegmentCount,
  publishabilityScore,
  publishabilityGrade,
  platformReadinessScore,
  platformReadinessGrade,
  continuityScore,
  transcriptCoverageScore,
  speechContinuityGrade,
  sentenceBoundaryIntegrityGrade = 'clean',
  sentenceBoundaryIssues = [],
}) {
  const mediaPath = path.join(rootDir, 'artifacts/smart-slice-media', name);
  const thumbnailPath = path.join(rootDir, 'artifacts/smart-slice-media', `${name}.jpg`);
  const subtitlePath = path.join(rootDir, 'artifacts/smart-slice-media', `${name}.srt`);
  return {
    id,
    name,
    duration,
    size: fs.statSync(mediaPath).size,
    resolution: '1080P',
    url: toAssetUrl(mediaPath),
    thumbnailUrl: toAssetUrl(thumbnailPath),
    subtitleUrl: toAssetUrl(subtitlePath),
    subtitleFormat: 'srt',
    qualityScore: 0.86,
    continuityScore,
    storyShape: 'complete',
    publishabilityScore,
    publishabilityGrade,
    publishabilityIssues: [],
    boundaryQualityScore: 0.84,
    hookStrength: 'strong',
    endingCompleteness: 'complete',
    contentArcScore: 1,
    contentArcGrade: 'complete',
    contentArcStages: ['hook', 'setup', 'conflict', 'payoff'],
    contentArcMissingStages: [],
    topicCoherenceScore: 0.88,
    topicCoherenceGrade: 'strong',
    topicShiftCount: 0,
    topicKeywords: ['opening', 'result', 'payoff'],
    platformReadinessScore,
    platformReadinessGrade,
    platformReadinessIssues: [],
    sentenceBoundaryIntegrityScore: sentenceBoundaryIntegrityGrade === 'clean' ? 0.92 : 0.84,
    sentenceBoundaryIntegrityGrade,
    sentenceBoundaryIssues,
    risks: sentenceBoundaryIntegrityGrade === 'repaired' ? ['connector-repaired'] : [],
    sourceStartMs,
    sourceEndMs,
    speechStartMs,
    speechEndMs,
    boundaryPaddingBeforeMs: Math.max(0, speechStartMs - sourceStartMs),
    boundaryPaddingAfterMs: Math.max(0, sourceEndMs - speechEndMs),
    ...fixtureAudioCleanupEvidence,
    audioActivityStartMs: speechStartMs,
    audioActivityEndMs: speechEndMs,
    transcriptText,
    transcriptSegments,
    transcriptCoverageScore,
    transcriptSegmentCount,
    speechContinuityGrade,
  };
}

function createSmartSliceTranscriptSegments(sourceStartMs, lines) {
  return lines.map(([text, relativeStartMs, relativeEndMs]) => ({
    startMs: sourceStartMs + relativeStartMs,
    endMs: sourceStartMs + relativeEndMs,
    text,
  }));
}

function writeSmartSliceMediaFiles(rootDir) {
  const mediaDir = path.join(rootDir, 'artifacts/smart-slice-media');
  fs.mkdirSync(mediaDir, { recursive: true });
  for (const name of ['release-fixture-01.mp4', 'release-fixture-02.mp4']) {
    fs.writeFileSync(path.join(mediaDir, name), `autocut smart slice media fixture ${name}`);
    fs.writeFileSync(path.join(mediaDir, `${name}.jpg`), `autocut smart slice thumbnail fixture ${name}`);
    fs.writeFileSync(
      path.join(mediaDir, `${name}.srt`),
      `1\n00:00:00,000 --> 00:00:02,000\n${name} subtitle fixture.\n`,
    );
  }
}

function toAssetUrl(artifactPath) {
  return `asset://localhost/${encodeURIComponent(path.resolve(artifactPath))}`;
}

function writeFfmpegFixture(rootDir) {
  const sidecarRelativePath = 'windows-x86_64/ffmpeg.exe';
  const sidecarPath = path.join(
    rootDir,
    'packages/sdkwork-autocut-desktop/src-tauri/binaries',
    sidecarRelativePath,
  );
  fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
  fs.writeFileSync(sidecarPath, 'ffmpeg version release fixture');
  const bytes = fs.readFileSync(sidecarPath);
  writeJson(
    path.join(rootDir, 'packages/sdkwork-autocut-desktop/src-tauri/binaries/ffmpeg.toolchain.json'),
    {
      tool: 'ffmpeg',
      contractVersion: '2026-05-05.ffmpeg-toolchain.v1',
      bundledReady: true,
      requiredBinary: 'ffmpeg',
      platforms: {
        'windows-x86_64': {
          relativePath: sidecarRelativePath,
          binaryName: 'ffmpeg.exe',
          integrity: {
            sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
            byteSize: bytes.length,
          },
        },
      },
    },
  );
}

function writeSpeechSidecarFixture(rootDir) {
  const sidecarRelativePath = 'windows-x86_64/whisper-cli.exe';
  const sidecarPath = path.join(
    rootDir,
    'packages/sdkwork-autocut-desktop/src-tauri/binaries',
    sidecarRelativePath,
  );
  fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
  fs.writeFileSync(sidecarPath, 'whisper cli version release fixture');
  const bytes = fs.readFileSync(sidecarPath);
  writeJson(
    path.join(rootDir, 'packages/sdkwork-autocut-desktop/src-tauri/binaries/speech-transcription.toolchain.json'),
    {
      tool: 'whisper-cli',
      contractVersion: '2026-05-08.speech-toolchain.v1',
      bundledReady: false,
      requiredBinary: 'whisper-cli',
      license: {
        name: 'whisper.cpp',
        spdxExpression: 'MIT',
        notice: 'Bundled whisper.cpp sidecars must keep their upstream license notices.',
      },
      platforms: {
        'windows-x86_64': {
          relativePath: sidecarRelativePath,
          binaryName: 'whisper-cli.exe',
          integrity: {
            sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
            byteSize: bytes.length,
          },
        },
      },
    },
  );
}

function writeInstallerFixture(rootDir) {
  const bundleRoot = path.join(
    rootDir,
    'packages/sdkwork-autocut-desktop/src-tauri/target/release/bundle',
  );
  const installers = [
    path.join(bundleRoot, 'msi', 'SDKWork Video Cut_0.1.0_x64_en-US.msi'),
    path.join(bundleRoot, 'nsis', 'SDKWork Video Cut_0.1.0_x64-setup.exe'),
  ];
  for (const installerPath of installers) {
    fs.mkdirSync(path.dirname(installerPath), { recursive: true });
    fs.writeFileSync(installerPath, `autocut release fixture installer ${path.basename(installerPath)}`);
  }
}

function writeQualityEvidenceIfPossible(rootDir, generatedAt, taskReady) {
  if (!taskReady) {
    return {
      ready: false,
      skipped: true,
      blockers: [
        {
          code: 'SMART_SLICE_QUALITY_NOT_READY',
          message: 'Skipped smart slice quality evidence because task evidence validation failed.',
        },
      ],
    };
  }

  const result = writeAutoCutSmartSliceQualityEvidence({
    rootDir,
    generatedAt,
  });
  return {
    ready: Boolean(result.evidence.readiness.smartSliceQualityReady),
    skipped: false,
    path: toPosixRelative(rootDir, result.outputPath),
    blockers: result.evidence.blockers,
    summary: result.evidence.summary,
    reviewWarnings: result.evidence.reviewWarnings,
  };
}

function writeReleaseEvidenceIfPossible(rootDir, generatedAt, qualityReady) {
  if (!qualityReady) {
    return {
      ready: false,
      skipped: true,
      blockers: [
        {
          code: 'SMART_SLICE_RELEASE_EVIDENCE_NOT_READY',
          message: 'Skipped release evidence because smart slice quality evidence was not ready.',
        },
      ],
    };
  }

  const result = writeAutoCutReleaseEvidence({
    rootDir,
    generatedAt,
    platform: 'windows-x86_64',
    runPreflightCommand() {
      return 'ffmpeg version release fixture';
    },
  });
  return {
    ready: Boolean(result.evidence.readiness.releaseSmokeReady),
    skipped: false,
    path: toPosixRelative(rootDir, result.outputPath),
    blockers: [],
    readiness: result.evidence.readiness,
  };
}

function writeMediaArtifactsEvidenceIfPossible(rootDir, generatedAt, taskReady) {
  if (!taskReady) {
    return {
      ready: false,
      skipped: true,
      blockers: [
        {
          code: 'SMART_SLICE_MEDIA_ARTIFACTS_NOT_READY',
          message: 'Skipped smart slice media artifacts evidence because task evidence validation failed.',
        },
      ],
    };
  }

  const result = writeAutoCutSmartSliceMediaArtifactsEvidence({
    rootDir,
    generatedAt,
  });
  return {
    ready: Boolean(result.evidence.readiness.smartSliceMediaArtifactsReady),
    skipped: false,
    path: toPosixRelative(rootDir, result.outputPath),
    blockers: result.evidence.blockers,
    summary: result.evidence.summary,
  };
}

function createCommercialReadinessIfPossible(rootDir, generatedAt, releaseReady) {
  if (!releaseReady) {
    return {
      ready: false,
      skipped: true,
      blockers: [
        {
          code: 'SMART_SLICE_COMMERCIAL_READINESS_NOT_READY',
          message: 'Skipped commercial readiness because release evidence was not ready.',
        },
      ],
    };
  }

  const report = createAutoCutCommercialReleaseReadinessReport({
    rootDir,
    evidencePath: path.join(rootDir, releaseEvidenceRelativePath),
    generatedAt,
  });
  return {
    ready: report.commercialReleaseReady,
    skipped: false,
    blockers: report.blockers,
    readiness: report.readiness,
  };
}

function createReleaseFixtureBlockers({
  taskValidation,
  smartSliceQuality,
  smartSliceMediaArtifacts,
  releaseEvidence,
  commercialReadiness,
}) {
  return [
    ...taskValidation.blockers,
    ...smartSliceQuality.blockers,
    ...smartSliceMediaArtifacts.blockers,
    ...releaseEvidence.blockers,
    ...commercialReadiness.blockers,
  ];
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function toPosixRelative(rootDir, targetPath) {
  return path.relative(rootDir, targetPath).replaceAll(path.sep, '/');
}

function parseArgs(argv) {
  const options = {};
  const args = normalizeAutoCutCliArgs(argv);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--root') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut smart slice release fixture',
      });
      options.rootDir = option.value;
      index = option.nextIndex;
    } else if (arg === '--profile') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut smart slice release fixture',
      });
      options.fixtureProfile = option.value;
      index = option.nextIndex;
    } else if (arg === '--output') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut smart slice release fixture',
      });
      options.outputPath = option.value;
      index = option.nextIndex;
    } else {
      throw new Error(`Unknown AutoCut smart slice release fixture argument: ${arg}`);
    }
  }
  return options;
}

function main() {
  const result = writeAutoCutSmartSliceReleaseFixtureReport(parseArgs(process.argv.slice(2)));
  console.log(`${formatAutoCutSmartSliceReleaseFixtureMessage(result.report)} report=${result.outputPath}`);
  if (!result.report.ready) {
    for (const blocker of result.report.blockers) {
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
