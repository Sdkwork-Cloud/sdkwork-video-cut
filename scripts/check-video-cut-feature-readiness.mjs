#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import YAML from 'yaml';

import { createReportPath, serializeProjectPath } from './lib/report-paths.mjs';

const COMMAND = 'check:feature-readiness';
const DEFAULT_REGISTRY_PATH = 'docs/product/feature-readiness.yaml';
const DEFAULT_REPORT_DIR = 'artifacts/governance';
const REPORT_VERSION = 'video-cut.feature-readiness-report.v1';
const VALID_STATUSES = new Set(['implemented', 'partial', 'planned']);

export function parseFeatureReadinessArgs(argv) {
  const args = [...argv];
  let json = false;
  let registryPath = DEFAULT_REGISTRY_PATH;
  let reportDir = DEFAULT_REPORT_DIR;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      json = true;
      continue;
    }

    if (arg === '--registry') {
      registryPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--report-dir') {
      reportDir = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    throw new Error(`Unknown feature readiness argument: ${arg}`);
  }

  return { json, registryPath, reportDir };
}

export function createFeatureReadinessReport({
  projectRoot = process.cwd(),
  registryPath = DEFAULT_REGISTRY_PATH,
  reportDir = DEFAULT_REPORT_DIR,
} = {}) {
  const registry = readRegistry(projectRoot, registryPath);
  const features = normalizeFeatures(projectRoot, registry.features ?? []);
  const openGaps = features
    .filter((feature) => feature.status !== 'implemented')
    .map((feature) => ({
      id: feature.id,
      title: feature.title,
      priority: feature.priority,
      status: feature.status,
      gap: feature.gap,
      nextAction: feature.nextAction,
    }));
  const blockingFailures = features.filter((feature) => feature.blockingFailure);
  const summary = summarizeFeatures(features);
  const status = blockingFailures.length > 0 ? 'fail' : openGaps.length > 0 ? 'attention' : 'pass';
  const { absolutePath: absoluteReportPath, reportPath } = createReportPath(
    projectRoot,
    reportDir,
    'feature-readiness-report.json',
  );
  const absoluteRegistryPath = resolve(projectRoot, registryPath);
  const report = {
    reportVersion: REPORT_VERSION,
    command: COMMAND,
    status,
    checkedAt: new Date().toISOString(),
    registryPath: serializeProjectPath(projectRoot, absoluteRegistryPath),
    reportPath,
    summary: {
      ...summary,
      gaps: openGaps.length,
      blockingFailures: blockingFailures.length,
    },
    openGaps,
    blockingFailures,
    features,
  };

  writeReport(absoluteReportPath, report);
  return report;
}

function requireValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`${name} requires a value.`);
  }

  return value;
}

function readRegistry(projectRoot, registryPath) {
  const absolutePath = resolve(projectRoot, registryPath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Feature readiness registry not found: ${registryPath}`);
  }

  return YAML.parse(readFileSync(absolutePath, 'utf8'));
}

function normalizeFeatures(projectRoot, features) {
  if (!Array.isArray(features)) {
    throw new Error('feature-readiness.yaml must define a features array.');
  }

  return features.map((feature, index) => normalizeFeature(projectRoot, feature, index));
}

function normalizeFeature(projectRoot, feature, index) {
  const id = stringField(feature, 'id', index);
  const status = stringField(feature, 'status', index);
  if (!VALID_STATUSES.has(status)) {
    throw new Error(`Feature ${id} has invalid status: ${status}`);
  }

  const evidenceFiles = arrayField(feature, 'evidenceFiles');
  const missingEvidence = evidenceFiles.filter((file) => !existsSync(resolve(projectRoot, file)));
  const priority = stringField(feature, 'priority', index);
  const blockingFailure = priority === 'mvp' && (status !== 'implemented' || missingEvidence.length > 0);

  return {
    id,
    title: stringField(feature, 'title', index),
    priority,
    status,
    evidenceFiles,
    checks: arrayField(feature, 'checks'),
    missingEvidence,
    blockingFailure,
    ...(feature.gap ? { gap: String(feature.gap) } : {}),
    nextAction: String(feature.nextAction || ''),
  };
}

function stringField(feature, key, index) {
  const value = feature?.[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Feature at index ${index} must define string field ${key}.`);
  }

  return value.trim();
}

function arrayField(feature, key) {
  const value = feature?.[key];
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => String(item));
}

function summarizeFeatures(features) {
  return features.reduce(
    (summary, feature) => {
      summary.total += 1;
      summary[feature.status] += 1;
      return summary;
    },
    { total: 0, implemented: 0, partial: 0, planned: 0 },
  );
}

function writeReport(reportPath, report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function printHumanReport(report) {
  const lines = [
    `SDKWork Video Cut Feature Readiness`,
    `status: ${report.status}`,
    `summary: ${report.summary.implemented} implemented, ${report.summary.partial} partial, ${report.summary.planned} planned`,
    `openGaps: ${report.openGaps.length}`,
    `reportPath: ${report.reportPath}`,
    '',
    ...report.openGaps.map((gap) => `${gap.status.toUpperCase()} ${gap.id}: ${gap.nextAction}`),
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

export function isDirectRun(moduleUrl, argvPath = process.argv[1]) {
  return Boolean(argvPath) && moduleUrl === pathToFileURL(argvPath).href;
}

async function main() {
  try {
    const options = parseFeatureReadinessArgs(process.argv.slice(2));
    const report = createFeatureReadinessReport({
      registryPath: options.registryPath,
      reportDir: options.reportDir,
    });

    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      printHumanReport(report);
    }

    process.exitCode = report.status === 'fail' ? 1 : 0;
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify(
        {
          reportVersion: REPORT_VERSION,
          command: COMMAND,
          status: 'fail',
          error: {
            code: 'FEATURE_READINESS_FAILED',
            message: error instanceof Error ? error.message : String(error),
          },
        },
        null,
        2,
      )}\n`,
    );
    process.exitCode = 1;
  }
}

if (isDirectRun(import.meta.url)) {
  void main();
}
