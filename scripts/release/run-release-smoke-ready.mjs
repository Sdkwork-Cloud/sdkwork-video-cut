#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createReleaseSmokeReadinessReport } from '../check-video-cut-release-smoke-readiness.mjs';
import { normalizeCliArgs } from '../lib/cli-args.mjs';
import { createRemediationSummary } from '../lib/release-remediation-summary.mjs';
import { createReportPath } from '../lib/report-paths.mjs';
import { findLocalAbsolutePath, reportContainsSensitiveData, sanitizeErrorMessage } from '../lib/report-safety.mjs';
import { createReleaseSmokePreflightReport } from './check-release-smoke-preflight.mjs';
import { createReleaseSmokeMatrixReport } from './run-release-smoke-matrix.mjs';

const REPORT_VERSION = 'video-cut.release-smoke-ready-report.v1';
const COMMAND = 'release:smoke:ready';
const DEFAULT_RELEASE_ASSETS_DIR = 'artifacts/release-smoke-matrix';
const DEFAULT_REPORT_DIR = 'artifacts/governance';
const DEFAULT_BIND_HOST = '127.0.0.1';
const DEFAULT_TIMEOUT_MS = 15_000;
const REPORT_FILE_NAME = 'release-smoke-ready-report.json';
const PREFLIGHT_REPORT_FILE_NAME = 'release-smoke-preflight-report.json';
const MATRIX_REPORT_FILE_NAME = 'release-smoke-matrix-report.json';

export function parseReleaseSmokeReadyArgs(argv, env = process.env) {
  const args = normalizeCliArgs(argv);
  let bindHost = env.SDKWORK_VIDEO_CUT_BIND_HOST || DEFAULT_BIND_HOST;
  let cargoPath = env.SDKWORK_VIDEO_CUT_CARGO_PATH || 'cargo';
  let chromeExecutablePath = env.SDKWORK_VIDEO_CUT_CHROME_EXECUTABLE_PATH || '';
  let ffmpegPath = env.SDKWORK_VIDEO_CUT_FFMPEG_PATH || 'ffmpeg';
  let json = false;
  let releaseAssetsDir = DEFAULT_RELEASE_ASSETS_DIR;
  let reportDir = DEFAULT_REPORT_DIR;
  let smokeReportDir = '';
  let timeoutMs = DEFAULT_TIMEOUT_MS;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      json = true;
      continue;
    }

    if (arg === '--bind-host') {
      bindHost = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--cargo-path') {
      cargoPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--chrome-executable-path') {
      chromeExecutablePath = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--ffmpeg-path') {
      ffmpegPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--release-assets-dir') {
      releaseAssetsDir = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--report-dir') {
      reportDir = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--smoke-report-dir') {
      smokeReportDir = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--timeout-ms') {
      timeoutMs = Number(requireValue(args, index, arg));
      index += 1;
      continue;
    }

    throw new Error(`Unknown release smoke ready argument: ${arg}`);
  }

  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
    throw new Error('--timeout-ms must be a positive number.');
  }

  assertProjectRelativePath('releaseAssetsDir', releaseAssetsDir);
  assertProjectRelativePath('reportDir', reportDir);
  const normalizedReleaseAssetsDir = normalizeProjectPath(releaseAssetsDir);
  const normalizedSmokeReportDir = normalizeProjectPath(smokeReportDir || `${normalizedReleaseAssetsDir}/smoke`);
  assertProjectRelativePath('smokeReportDir', normalizedSmokeReportDir);

  return {
    bindHost,
    cargoPath,
    chromeExecutablePath,
    ffmpegPath,
    json,
    releaseAssetsDir: normalizedReleaseAssetsDir,
    reportDir: normalizeProjectPath(reportDir),
    smokeReportDir: normalizedSmokeReportDir,
    timeoutMs,
  };
}

export async function createReleaseSmokeReadyReport({
  bindHost = DEFAULT_BIND_HOST,
  cargoPath = 'cargo',
  chromeExecutablePath = '',
  ffmpegPath = 'ffmpeg',
  projectRoot = process.cwd(),
  releaseAssetsDir = DEFAULT_RELEASE_ASSETS_DIR,
  reportDir = DEFAULT_REPORT_DIR,
  smokeReportDir = '',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  preflightImpl = createReleaseSmokePreflightReport,
  matrixImpl = createReleaseSmokeMatrixReport,
  readinessImpl = createReleaseSmokeReadinessReport,
} = {}) {
  assertProjectRelativePath('releaseAssetsDir', releaseAssetsDir);
  assertProjectRelativePath('reportDir', reportDir);
  const normalizedReleaseAssetsDir = normalizeProjectPath(releaseAssetsDir);
  const normalizedReportDir = normalizeProjectPath(reportDir);
  const normalizedSmokeReportDir = normalizeProjectPath(smokeReportDir || `${normalizedReleaseAssetsDir}/smoke`);
  assertProjectRelativePath('smokeReportDir', normalizedSmokeReportDir);

  const generatedAt = new Date().toISOString();
  const preflight = await runPreflight({
    bindHost,
    cargoPath,
    chromeExecutablePath,
    ffmpegPath,
    preflightImpl,
    projectRoot,
    releaseAssetsDir: normalizedReleaseAssetsDir,
    reportDir: normalizedReportDir,
    smokeReportDir: normalizedSmokeReportDir,
    timeoutMs,
  });
  const matrix = await runMatrix({
    bindHost,
    cargoPath,
    chromeExecutablePath,
    ffmpegPath,
    matrixImpl,
    preflight,
    projectRoot,
    releaseAssetsDir: normalizedReleaseAssetsDir,
    reportDir: normalizedReportDir,
    smokeReportDir: normalizedSmokeReportDir,
    timeoutMs,
  });
  const readiness = await runReadiness({
    projectRoot,
    readinessImpl,
    reportDir: normalizedReportDir,
  });
  const readinessStatus = readiness?.readinessStatus ?? 'failed';
  const promotionEligible =
    readiness?.status === 'pass' &&
    readiness?.requireReady === true &&
    readinessStatus === 'ready' &&
    readiness?.promotionEligible === true;
  const environmentStatus = readiness?.environmentStatus ?? 'failed';
  const readinessBlockers = Array.isArray(readiness?.environmentBlockers)
    ? readiness.environmentBlockers.map(toEnvironmentBlockerEvidence)
    : [];
  const environmentBlockers =
    readinessBlockers.length > 0 || readinessStatus === 'ready'
      ? readinessBlockers
      : mergeEnvironmentBlockers(preflight?.environmentBlockers, matrix?.environmentBlockers);
  const remediationSummary = createRemediationSummary(preflight, matrix, readiness);
  const checksBeforeSafety = [
    checkPreflight(preflight),
    checkMatrix(matrix),
    checkReadinessRequired(readiness),
    checkPromotionEligible({ promotionEligible, readiness }),
  ];
  const summaryBeforeSafety = summarizeChecks(checksBeforeSafety);
  const { absolutePath, reportPath } = createReportPath(projectRoot, normalizedReportDir, REPORT_FILE_NAME);
  const reportDraft = {
    reportVersion: REPORT_VERSION,
    command: COMMAND,
    status: summaryBeforeSafety.fail === 0 ? 'pass' : 'fail',
    requireReady: true,
    readinessStatus,
    promotionEligible,
    environmentStatus,
    environmentBlockers,
    remediationSummary,
    generatedAt,
    releaseAssetsDir: normalizedReleaseAssetsDir,
    smokeReportDir: normalizedSmokeReportDir,
    reportPath,
    preflight,
    matrix,
    readiness,
    summary: summaryBeforeSafety,
    checks: checksBeforeSafety,
  };
  const safetyCheck = checkReportSafety(reportDraft);
  const checks = [...checksBeforeSafety, safetyCheck];
  const summary = summarizeChecks(checks);
  const report = {
    ...reportDraft,
    status: summary.fail === 0 ? 'pass' : 'fail',
    summary,
    checks,
  };

  writeReport(absolutePath, report);
  return report;
}

async function runPreflight({
  bindHost,
  cargoPath,
  chromeExecutablePath,
  ffmpegPath,
  preflightImpl,
  projectRoot,
  releaseAssetsDir,
  reportDir,
  smokeReportDir,
  timeoutMs,
}) {
  try {
    return toPreflightEvidence(
      await preflightImpl({
        bindHost,
        cargoPath,
        chromeExecutablePath,
        ffmpegPath,
        projectRoot,
        releaseAssetsDir,
        reportDir,
        smokeReportDir,
        timeoutMs,
      }),
    );
  } catch (error) {
    return toPreflightEvidence({
      reportVersion: 'video-cut.release-smoke-preflight-report.v1',
      command: 'release:smoke:preflight',
      status: 'fail',
      environmentStatus: 'blocked',
      environmentBlockers: [
        {
          id: 'release-smoke-ready-preflight-run',
          code: 'RELEASE_SMOKE_ENV_PREFLIGHT_BLOCKED',
          category: 'preflight',
          evidence: sanitizeErrorMessage(error),
        },
      ],
      remediationSummary: createRemediationSummary(),
      reportPath: `${reportDir}/${PREFLIGHT_REPORT_FILE_NAME}`,
      summary: { pass: 0, warn: 0, fail: 1 },
      error: {
        code: 'RELEASE_SMOKE_READY_FAILED',
        message: sanitizeErrorMessage(error),
      },
      checks: [
        {
          id: 'release-smoke-ready-preflight-run',
          status: 'fail',
          evidence: sanitizeErrorMessage(error),
        },
      ],
    });
  }
}

async function runMatrix({
  bindHost,
  cargoPath,
  chromeExecutablePath,
  ffmpegPath,
  matrixImpl,
  preflight,
  projectRoot,
  releaseAssetsDir,
  reportDir,
  smokeReportDir,
  timeoutMs,
}) {
  try {
    return toMatrixEvidence(
      await matrixImpl({
        bindHost,
        cargoPath,
        chromeExecutablePath,
        ffmpegPath,
        projectRoot,
        releaseAssetsDir,
        reportDir,
        smokeReportDir,
        preflightImpl: async () => preflight,
        timeoutMs,
      }),
    );
  } catch (error) {
    return toMatrixEvidence({
      reportVersion: 'video-cut.release-smoke-matrix-report.v1',
      command: 'release:smoke:matrix',
      status: 'fail',
      environmentStatus: preflight.environmentStatus === 'ready' ? 'failed' : 'blocked',
      environmentBlockers: preflight.environmentBlockers,
      remediationSummary: preflight.remediationSummary,
      reportPath: `${reportDir}/${MATRIX_REPORT_FILE_NAME}`,
      targetSummary: { total: 0, pass: 0, warn: 0, fail: 1, blocked: 0 },
      summary: { pass: 0, warn: 0, fail: 1 },
      error: {
        code: 'RELEASE_SMOKE_READY_FAILED',
        message: sanitizeErrorMessage(error),
      },
      checks: [
        {
          id: 'release-smoke-ready-matrix-run',
          status: 'fail',
          evidence: sanitizeErrorMessage(error),
        },
      ],
      targets: [],
    });
  }
}

async function runReadiness({ projectRoot, readinessImpl, reportDir }) {
  try {
    return toReadinessEvidence(
      await readinessImpl({
        projectRoot,
        reportDir,
        preflightReportPath: `${reportDir}/${PREFLIGHT_REPORT_FILE_NAME}`,
        matrixReportPath: `${reportDir}/${MATRIX_REPORT_FILE_NAME}`,
        requireReady: true,
      }),
    );
  } catch (error) {
    return toReadinessEvidence({
      reportVersion: 'video-cut.release-smoke-readiness-report.v1',
      command: 'check:release-smoke-readiness',
      status: 'fail',
      requireReady: true,
      readinessStatus: 'failed',
      promotionEligible: false,
      environmentStatus: 'failed',
      environmentBlockers: [],
      remediationSummary: createRemediationSummary(),
      reportPath: `${reportDir}/release-smoke-readiness-report.json`,
      summary: { pass: 0, warn: 0, fail: 1 },
      error: {
        code: 'RELEASE_SMOKE_READY_FAILED',
        message: sanitizeErrorMessage(error),
      },
      checks: [
        {
          id: 'release-smoke-readiness-ready-required',
          status: 'fail',
          evidence: sanitizeErrorMessage(error),
        },
      ],
    });
  }
}

function toPreflightEvidence(report) {
  return {
    reportVersion: report?.reportVersion ?? '',
    command: report?.command ?? '',
    status: report?.status ?? 'missing',
    environmentStatus: report?.environmentStatus ?? 'missing',
    environmentBlockers: Array.isArray(report?.environmentBlockers)
      ? report.environmentBlockers.map(toEnvironmentBlockerEvidence)
      : [],
    remediationSummary: createRemediationSummary(report),
    reportPath: toPathEvidence(report?.reportPath),
    summary: report?.summary ?? {},
    checks: toChecks(report?.checks),
    error: toErrorEvidence(report?.error),
  };
}

function toMatrixEvidence(report) {
  return {
    reportVersion: report?.reportVersion ?? '',
    command: report?.command ?? '',
    status: report?.status ?? 'missing',
    environmentStatus: report?.environmentStatus ?? 'missing',
    environmentBlockers: Array.isArray(report?.environmentBlockers)
      ? report.environmentBlockers.map(toEnvironmentBlockerEvidence)
      : [],
    remediationSummary: createRemediationSummary(report),
    reportPath: toPathEvidence(report?.reportPath),
    targetSummary: report?.targetSummary ?? {},
    summary: report?.summary ?? {},
    checks: toChecks(report?.checks),
    targets: Array.isArray(report?.targets) ? report.targets.map(toTargetEvidence) : [],
    error: toErrorEvidence(report?.error),
  };
}

function toReadinessEvidence(report) {
  return {
    reportVersion: report?.reportVersion ?? '',
    command: report?.command ?? '',
    status: report?.status ?? 'missing',
    requireReady: report?.requireReady === true,
    readinessStatus: report?.readinessStatus ?? 'failed',
    promotionEligible: report?.promotionEligible === true,
    environmentStatus: report?.environmentStatus ?? 'failed',
    environmentBlockers: Array.isArray(report?.environmentBlockers)
      ? report.environmentBlockers.map(toEnvironmentBlockerEvidence)
      : [],
    remediationSummary: createRemediationSummary(report),
    reportPath: toPathEvidence(report?.reportPath),
    summary: report?.summary ?? {},
    checks: toChecks(report?.checks),
    error: toErrorEvidence(report?.error),
  };
}

function toTargetEvidence(target) {
  return {
    target: target?.target ?? '',
    status: target?.status ?? 'missing',
    environmentBlockers: Array.isArray(target?.environmentBlockers)
      ? target.environmentBlockers.map(toEnvironmentBlockerEvidence)
      : [],
    smoke: {
      reportVersion: target?.smoke?.reportVersion ?? '',
      ok: target?.smoke?.ok ?? false,
      summary: target?.smoke?.summary ?? {},
      error: toErrorEvidence(target?.smoke?.error),
    },
    smokeEvidenceContracts: {
      status: target?.smokeEvidenceContracts?.status ?? 'missing',
      summary: target?.smokeEvidenceContracts?.summary ?? {},
      error: toErrorEvidence(target?.smokeEvidenceContracts?.error),
    },
    releaseReport: {
      status: target?.releaseReport?.status ?? 'missing',
      summary: target?.releaseReport?.summary ?? {},
      error: toErrorEvidence(target?.releaseReport?.error),
    },
    releaseContracts: {
      status: target?.releaseContracts?.status ?? 'missing',
      summary: target?.releaseContracts?.summary ?? {},
    },
    signatureVerification: {
      status: target?.signatureVerification?.status ?? 'missing',
      summary: target?.signatureVerification?.summary ?? {},
    },
  };
}

function toEnvironmentBlockerEvidence(blocker) {
  return {
    id: blocker?.id ?? '',
    code: blocker?.code ?? 'RELEASE_SMOKE_ENV_PREFLIGHT_BLOCKED',
    category: blocker?.category ?? 'preflight',
    evidence: sanitizeErrorMessage(blocker?.evidence ?? ''),
  };
}

function toErrorEvidence(error) {
  if (!error) {
    return null;
  }

  return {
    code: error?.code ?? 'RELEASE_SMOKE_READY_FAILED',
    message: sanitizeErrorMessage(error?.message ?? error),
  };
}

function toPathEvidence(path) {
  const value = String(path || '');
  return findLocalAbsolutePath(value) ? sanitizeErrorMessage(value) : value;
}

function toChecks(checks) {
  return Array.isArray(checks)
    ? checks.map((check) => ({
        id: check?.id ?? '',
        status: check?.status ?? 'missing',
        evidence: sanitizeErrorMessage(check?.evidence ?? ''),
      }))
    : [];
}

function checkPreflight(preflight) {
  const failures = [];
  if (preflight.reportVersion !== 'video-cut.release-smoke-preflight-report.v1') {
    failures.push('reportVersion');
  }
  if (preflight.command !== 'release:smoke:preflight') {
    failures.push('command');
  }
  if (!['pass', 'fail'].includes(preflight.status)) {
    failures.push('status');
  }
  if (!['ready', 'blocked'].includes(preflight.environmentStatus)) {
    failures.push('environmentStatus');
  }

  return checkResult({
    id: 'release-smoke-ready-preflight',
    passed: failures.length === 0,
    evidence: `${preflight.reportPath || PREFLIGHT_REPORT_FILE_NAME}: release smoke preflight evidence was emitted.`,
    failMessage: `Release smoke ready preflight evidence is not usable: ${failures.join(', ')}`,
  });
}

function checkMatrix(matrix) {
  const failures = [];
  if (matrix.reportVersion !== 'video-cut.release-smoke-matrix-report.v1') {
    failures.push('reportVersion');
  }
  if (matrix.command !== 'release:smoke:matrix') {
    failures.push('command');
  }
  if (!['pass', 'fail'].includes(matrix.status)) {
    failures.push('status');
  }
  if (!['ready', 'blocked'].includes(matrix.environmentStatus)) {
    failures.push('environmentStatus');
  }

  return checkResult({
    id: 'release-smoke-ready-matrix',
    passed: failures.length === 0,
    evidence: `${matrix.reportPath || MATRIX_REPORT_FILE_NAME}: release smoke matrix evidence was emitted.`,
    failMessage: `Release smoke ready matrix evidence is not usable: ${failures.join(', ')}`,
  });
}

function checkReadinessRequired(readiness) {
  const readyRequiredCheck = readiness.checks.find((check) => check.id === 'release-smoke-readiness-ready-required');
  const passed =
    readiness.reportVersion === 'video-cut.release-smoke-readiness-report.v1' &&
    readiness.command === 'check:release-smoke-readiness' &&
    readiness.requireReady === true &&
    readiness.status === 'pass' &&
    readiness.readinessStatus === 'ready' &&
    readyRequiredCheck?.status === 'pass';

  return checkResult({
    id: 'release-smoke-ready-readiness-required',
    passed,
    evidence: 'Commercial release smoke ready gate passed with readinessStatus=ready.',
    failMessage: `Commercial release smoke ready gate requires readinessStatus=ready; current readinessStatus=${readiness.readinessStatus}.`,
  });
}

function checkPromotionEligible({ promotionEligible, readiness }) {
  const nestedPromotionCheck = readiness.checks.find(
    (check) => check.id === 'release-smoke-readiness-promotion-eligible',
  );
  const expected =
    readiness.reportVersion === 'video-cut.release-smoke-readiness-report.v1' &&
    readiness.command === 'check:release-smoke-readiness' &&
    readiness.status === 'pass' &&
    readiness.requireReady === true &&
    readiness.readinessStatus === 'ready' &&
    readiness.promotionEligible === true &&
    nestedPromotionCheck?.status === 'pass';
  const passed = promotionEligible === expected && (readiness.readinessStatus !== 'ready' || expected);

  return checkResult({
    id: 'release-smoke-ready-promotion-eligible',
    passed,
    evidence: promotionEligible
      ? 'Release smoke ready report is promotion eligible.'
      : `Release smoke ready report is not promotion eligible because readinessStatus=${readiness.readinessStatus}.`,
    failMessage: `Release smoke ready promotionEligible drift: promotionEligible=${promotionEligible} readinessStatus=${readiness.readinessStatus}.`,
  });
}

function checkReportSafety(report) {
  const sensitive = reportContainsSensitiveData(report);
  const localPath = findLocalAbsolutePath(report);
  return checkResult({
    id: 'release-smoke-ready-redaction-and-path-safety',
    passed: !sensitive && !localPath,
    evidence: 'Release smoke ready report contains no credential-shaped values and no server-local absolute paths.',
    failMessage: `Release smoke ready report must not contain sensitive data or local paths. Sensitive=${sensitive} localPath=${localPath}`,
  });
}

function mergeEnvironmentBlockers(...blockerLists) {
  const merged = new Map();
  for (const blockers of blockerLists) {
    if (!Array.isArray(blockers)) {
      continue;
    }
    for (const blocker of blockers) {
      const evidence = toEnvironmentBlockerEvidence(blocker);
      merged.set(`${evidence.id}|${evidence.code}|${evidence.category}`, evidence);
    }
  }
  return [...merged.values()];
}

function summarizeChecks(checks) {
  return checks.reduce(
    (summary, check) => {
      summary[check.status] += 1;
      return summary;
    },
    { pass: 0, warn: 0, fail: 0 },
  );
}

function checkResult({ evidence, failMessage, id, passed }) {
  return {
    id,
    status: passed ? 'pass' : 'fail',
    evidence: passed ? evidence : failMessage,
  };
}

function requireValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function assertProjectRelativePath(name, value) {
  if (!isSafeRelativePath(value)) {
    throw new Error(`${name} must be project-relative and must not contain parent-directory segments.`);
  }
}

function isSafeRelativePath(value) {
  const raw = String(value ?? '');
  const normalized = normalizeProjectPath(raw);
  return Boolean(
    normalized &&
      !isAbsolute(raw) &&
      !normalized.startsWith('../') &&
      normalized !== '..' &&
      !normalized.includes('/../') &&
      !normalized.startsWith('/') &&
      !/^[A-Za-z]:\//.test(normalized) &&
      !normalized.startsWith('//'),
  );
}

function normalizeProjectPath(value) {
  return String(value || '').replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function writeReport(reportPath, report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function printHumanReport(report) {
  const lines = [
    'SDKWork Video Cut Release Smoke Ready',
    `requireReady: ${report.requireReady}`,
    `readinessStatus: ${report.readinessStatus}`,
    `promotionEligible: ${report.promotionEligible}`,
    `environmentStatus: ${report.environmentStatus}`,
    `status: ${report.status}`,
    `summary: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail`,
    `reportPath: ${report.reportPath}`,
    '',
    ...report.checks.map((check) => `${check.status.toUpperCase()} ${check.id}: ${check.evidence}`),
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

export function isDirectRun(moduleUrl, argvPath = process.argv[1]) {
  return Boolean(argvPath) && moduleUrl === pathToFileURL(argvPath).href;
}

async function main() {
  try {
    const options = parseReleaseSmokeReadyArgs(process.argv.slice(2));
    const report = await createReleaseSmokeReadyReport(options);
    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      printHumanReport(report);
    }
    process.exitCode = report.status === 'pass' ? 0 : 1;
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify(
        {
          reportVersion: REPORT_VERSION,
          command: COMMAND,
          status: 'fail',
          readinessStatus: 'failed',
          error: {
            code: 'RELEASE_SMOKE_READY_FAILED',
            message: sanitizeErrorMessage(error),
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
