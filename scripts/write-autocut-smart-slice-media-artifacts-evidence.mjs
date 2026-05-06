#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  normalizeAutoCutCliArgs,
  readAutoCutCliOptionValue,
} from './autocut-cli-args.mjs';

const __filename = fileURLToPath(import.meta.url);
const evidenceSchemaVersion = '2026-05-06.autocut-smart-slice-media-artifacts-evidence.v1';
const taskEvidenceSchemaVersion = '2026-05-06.autocut-smart-slice-task-evidence.v1';
const defaultTaskRelativePath = 'artifacts/smart-slice/smart-slice-task.json';
const defaultOutputRelativePath = 'artifacts/release/autocut-smart-slice-media-artifacts-evidence.json';

export function createAutoCutSmartSliceMediaArtifactsEvidence({
  rootDir = process.cwd(),
  taskPath,
  generatedAt = new Date().toISOString(),
} = {}) {
  const resolvedRootDir = path.resolve(rootDir);
  const resolvedTaskPath = path.resolve(
    taskPath ?? path.join(resolvedRootDir, defaultTaskRelativePath),
  );
  if (!fs.existsSync(resolvedTaskPath) || !fs.statSync(resolvedTaskPath).isFile()) {
    throw new Error(`missing AutoCut smart slice task evidence: ${resolvedTaskPath}`);
  }

  const task = JSON.parse(fs.readFileSync(resolvedTaskPath, 'utf8'));
  validateSmartSliceTaskEvidence(task);
  const slices = (Array.isArray(task.sliceResults) ? task.sliceResults : [])
    .map((slice, index) => createSliceMediaArtifactsSnapshot(slice, index, resolvedRootDir));
  const blockers = createMediaArtifactBlockers(slices);
  const summary = createMediaArtifactsSummary(slices);

  return {
    schemaVersion: evidenceSchemaVersion,
    generatedAt,
    taskPath: toPosixRelative(resolvedRootDir, resolvedTaskPath),
    task: {
      id: normalizeString(task.id),
      status: normalizeString(task.status),
      resultCount: typeof task.resultCount === 'number' ? task.resultCount : slices.length,
    },
    readiness: {
      smartSliceMediaArtifactsReady: blockers.length === 0,
    },
    summary,
    blockers,
    slices,
  };
}

export function writeAutoCutSmartSliceMediaArtifactsEvidence({
  rootDir = process.cwd(),
  outputPath,
  ...options
} = {}) {
  const resolvedRootDir = path.resolve(rootDir);
  const evidence = createAutoCutSmartSliceMediaArtifactsEvidence({
    rootDir: resolvedRootDir,
    ...options,
  });
  const resolvedOutputPath = path.resolve(
    outputPath ?? path.join(resolvedRootDir, defaultOutputRelativePath),
  );
  fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  fs.writeFileSync(`${resolvedOutputPath}.tmp`, `${JSON.stringify(evidence, null, 2)}\n`);
  fs.renameSync(`${resolvedOutputPath}.tmp`, resolvedOutputPath);
  return {
    outputPath: resolvedOutputPath,
    evidence,
  };
}

export function formatAutoCutSmartSliceMediaArtifactsEvidenceMessage(result) {
  return [
    `ok - autocut smart slice media artifacts evidence ${result.outputPath}`,
    `slices=${result.evidence.summary.totalSlices}`,
    `artifacts=${result.evidence.summary.totalArtifacts}`,
    `ready=${result.evidence.readiness.smartSliceMediaArtifactsReady}`,
    `blockers=${result.evidence.blockers.length}`,
  ].join(' ');
}

function validateSmartSliceTaskEvidence(task) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) {
    throw new Error('AutoCut smart slice task evidence must be a JSON object.');
  }
  if (task.schemaVersion !== taskEvidenceSchemaVersion) {
    throw new Error(`unsupported AutoCut smart slice task evidence schema: ${task.schemaVersion}`);
  }
  if (task.evidenceKind !== 'smart-slice-task') {
    throw new Error(`unsupported AutoCut smart slice task evidence kind: ${task.evidenceKind}`);
  }
  if (task.status !== 'completed') {
    throw new Error('AutoCut smart slice media artifacts evidence requires a completed smart slice task.');
  }
}

function createSliceMediaArtifactsSnapshot(slice, index, rootDir) {
  const video = createArtifactSnapshot({
    kind: 'video',
    url: slice?.url,
    declaredByteSize: slice?.size,
    rootDir,
    required: true,
  });
  const thumbnail = createArtifactSnapshot({
    kind: 'thumbnail',
    url: slice?.thumbnailUrl,
    declaredByteSize: undefined,
    rootDir,
    required: true,
  });
  const subtitle = createArtifactSnapshot({
    kind: 'subtitle',
    url: slice?.subtitleUrl,
    declaredByteSize: undefined,
    rootDir,
    required: Boolean(slice?.subtitleUrl),
  });

  return {
    index,
    id: normalizeString(slice?.id) || `slice-${index + 1}`,
    name: normalizeString(slice?.name),
    artifacts: {
      video,
      thumbnail,
      ...(slice?.subtitleUrl ? { subtitle } : {}),
    },
    ready: video.ready && thumbnail.ready && (!slice?.subtitleUrl || subtitle.ready),
  };
}

function createArtifactSnapshot({
  kind,
  url,
  declaredByteSize,
  rootDir,
  required,
}) {
  const resolvedPath = resolveArtifactPathFromUrl(url);
  const normalizedDeclaredByteSize = normalizeNonNegativeInteger(declaredByteSize);
  const normalized = {
    kind,
    url: normalizeString(url),
    path: resolvedPath ? toPosixRelative(rootDir, resolvedPath) : '',
    absolutePath: resolvedPath ?? '',
    byteSize: 0,
    ...(normalizedDeclaredByteSize !== undefined ? { declaredByteSize: normalizedDeclaredByteSize } : {}),
    sha256: '',
    ready: false,
    issues: [],
  };

  if (!required) {
    return {
      ...normalized,
      ready: true,
    };
  }

  if (!resolvedPath) {
    return withArtifactIssue(normalized, 'missing-artifact-url');
  }
  if (!isInsideDirectory(resolvedPath, rootDir)) {
    return withArtifactIssue(normalized, 'artifact-path-escapes-root');
  }
  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
    return withArtifactIssue(normalized, 'artifact-file-missing');
  }

  const bytes = fs.readFileSync(resolvedPath);
  const byteSize = bytes.length;
  const declaredByteSizeReady =
    normalizedDeclaredByteSize === undefined ||
    normalizedDeclaredByteSize === byteSize;
  return {
    ...normalized,
    byteSize,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    ready: byteSize > 0 && declaredByteSizeReady,
    issues: [
      ...(byteSize > 0 ? [] : ['artifact-file-empty']),
      ...(declaredByteSizeReady ? [] : ['declared-byte-size-mismatch']),
    ],
  };
}

function createMediaArtifactsSummary(slices) {
  const artifacts = slices.flatMap((slice) => Object.values(slice.artifacts));
  return {
    totalSlices: slices.length,
    readySlices: slices.filter((slice) => slice.ready).length,
    totalArtifacts: artifacts.length,
    readyArtifacts: artifacts.filter((artifact) => artifact.ready).length,
    totalByteSize: artifacts.reduce((sum, artifact) => sum + artifact.byteSize, 0),
  };
}

function createMediaArtifactBlockers(slices) {
  const blockers = [];
  const pathEscapeIndexes = slices
    .filter((slice) => Object.values(slice.artifacts).some((artifact) => artifact.issues.includes('artifact-path-escapes-root')))
    .map((slice) => slice.index);
  if (pathEscapeIndexes.length > 0) {
    blockers.push({
      code: 'SMART_SLICE_MEDIA_ARTIFACT_PATH_ESCAPE',
      message: 'One or more smart slice media artifact paths escape the release evidence root.',
      remediation: 'Export media artifact evidence from task-owned output files under the release evidence root.',
      sliceIndexes: pathEscapeIndexes,
    });
  }

  const missingIndexes = slices
    .filter((slice) => Object.values(slice.artifacts).some((artifact) =>
      artifact.issues.includes('missing-artifact-url') ||
      artifact.issues.includes('artifact-file-missing') ||
      artifact.issues.includes('artifact-file-empty') ||
      artifact.issues.includes('declared-byte-size-mismatch'),
    ))
    .map((slice) => slice.index)
    .filter((index) => !pathEscapeIndexes.includes(index));
  if (missingIndexes.length > 0) {
    blockers.push({
      code: 'SMART_SLICE_MEDIA_ARTIFACT_MISSING',
      message: 'One or more smart slice media artifacts are missing, empty, or inconsistent with declared metadata.',
      remediation: 'Regenerate native smart slice outputs and rerun media artifact evidence generation.',
      sliceIndexes: missingIndexes,
    });
  }

  return blockers;
}

function resolveArtifactPathFromUrl(value) {
  const normalizedValue = normalizeString(value);
  if (!normalizedValue) {
    return undefined;
  }

  if (normalizedValue.startsWith('asset://')) {
    try {
      const parsed = new URL(normalizedValue);
      const encodedPath = parsed.pathname.startsWith('/')
        ? parsed.pathname.slice(1)
        : parsed.pathname;
      const decodedPath = decodeURIComponent(encodedPath);
      return decodedPath ? path.resolve(decodedPath) : undefined;
    } catch {
      return undefined;
    }
  }

  if (/^[A-Za-z]:[\\/]/u.test(normalizedValue) || path.isAbsolute(normalizedValue)) {
    return path.resolve(normalizedValue);
  }

  return undefined;
}

function withArtifactIssue(snapshot, issue) {
  return {
    ...snapshot,
    ready: false,
    issues: [...snapshot.issues, issue],
  };
}

function isInsideDirectory(candidatePath, rootDir) {
  const relative = path.relative(path.resolve(rootDir), path.resolve(candidatePath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
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

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toPosixRelative(rootDir, targetPath) {
  const relative = path.relative(rootDir, targetPath);
  return relative ? relative.replaceAll(path.sep, '/') : '.';
}

function parseArgs(argv) {
  const options = {};
  const args = normalizeAutoCutCliArgs(argv);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--task') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut smart slice media artifacts evidence',
      });
      options.taskPath = option.value;
      index = option.nextIndex;
    } else if (arg === '--output') {
      const option = readAutoCutCliOptionValue(args, index, {
        optionName: arg,
        commandName: 'AutoCut smart slice media artifacts evidence',
      });
      options.outputPath = option.value;
      index = option.nextIndex;
    } else {
      throw new Error(`Unknown AutoCut smart slice media artifacts evidence argument: ${arg}`);
    }
  }
  return options;
}

function main() {
  const result = writeAutoCutSmartSliceMediaArtifactsEvidence(parseArgs(process.argv.slice(2)));
  console.log(formatAutoCutSmartSliceMediaArtifactsEvidenceMessage(result));
  if (!result.evidence.readiness.smartSliceMediaArtifactsReady) {
    for (const blocker of result.evidence.blockers) {
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
