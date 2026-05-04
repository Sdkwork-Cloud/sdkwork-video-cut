#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createGovernanceReport } from '../check-video-cut-governance-suite.mjs';
import { normalizeCliArgs } from '../lib/cli-args.mjs';
import { createRemediationSummary } from '../lib/release-remediation-summary.mjs';
import { createReportPath } from '../lib/report-paths.mjs';
import { findLocalAbsolutePath, reportContainsSensitiveData, sanitizeErrorMessage } from '../lib/report-safety.mjs';
import { createReleaseMatrixReport } from './run-release-matrix.mjs';
import { createReleaseSmokeReadyReport } from './run-release-smoke-ready.mjs';

const REPORT_VERSION = 'video-cut.release-ready-report.v1';
const COMMAND = 'release:ready';
const DEFAULT_RELEASE_ASSETS_DIR = 'artifacts/release-matrix';
const DEFAULT_SMOKE_RELEASE_ASSETS_DIR = 'artifacts/release-smoke-matrix';
const DEFAULT_REPORT_DIR = 'artifacts/governance';
const DEFAULT_BIND_HOST = '127.0.0.1';
const DEFAULT_TIMEOUT_MS = 15_000;
const REPORT_FILE_NAME = 'release-ready-report.json';

export function parseReleaseReadyArgs(argv, env = process.env) {
  const args = normalizeCliArgs(argv);
  let bindHost = env.SDKWORK_VIDEO_CUT_BIND_HOST || DEFAULT_BIND_HOST;
  let cargoPath = env.SDKWORK_VIDEO_CUT_CARGO_PATH || 'cargo';
  let chromeExecutablePath = env.SDKWORK_VIDEO_CUT_CHROME_EXECUTABLE_PATH || '';
  let ffmpegPath = env.SDKWORK_VIDEO_CUT_FFMPEG_PATH || 'ffmpeg';
  let json = false;
  let releaseAssetsDir = DEFAULT_RELEASE_ASSETS_DIR;
  let smokeReleaseAssetsDir = DEFAULT_SMOKE_RELEASE_ASSETS_DIR;
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

    if (arg === '--smoke-release-assets-dir') {
      smokeReleaseAssetsDir = requireValue(args, index, arg);
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

    throw new Error(`Unknown release ready argument: ${arg}`);
  }

  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
    throw new Error('--timeout-ms must be a positive number.');
  }

  assertProjectRelativePath('releaseAssetsDir', releaseAssetsDir);
  assertProjectRelativePath('smokeReleaseAssetsDir', smokeReleaseAssetsDir);
  assertProjectRelativePath('reportDir', reportDir);
  const normalizedSmokeReleaseAssetsDir = normalizeProjectPath(smokeReleaseAssetsDir);
  const normalizedSmokeReportDir = normalizeProjectPath(smokeReportDir || `${normalizedSmokeReleaseAssetsDir}/smoke`);
  assertProjectRelativePath('smokeReportDir', normalizedSmokeReportDir);

  return {
    bindHost,
    cargoPath,
    chromeExecutablePath,
    ffmpegPath,
    json,
    releaseAssetsDir: normalizeProjectPath(releaseAssetsDir),
    smokeReleaseAssetsDir: normalizedSmokeReleaseAssetsDir,
    reportDir: normalizeProjectPath(reportDir),
    smokeReportDir: normalizedSmokeReportDir,
    timeoutMs,
  };
}

export async function createReleaseReadyReport({
  bindHost = DEFAULT_BIND_HOST,
  cargoPath = 'cargo',
  chromeExecutablePath = '',
  ffmpegPath = 'ffmpeg',
  projectRoot = process.cwd(),
  releaseAssetsDir = DEFAULT_RELEASE_ASSETS_DIR,
  smokeReleaseAssetsDir = DEFAULT_SMOKE_RELEASE_ASSETS_DIR,
  reportDir = DEFAULT_REPORT_DIR,
  smokeReportDir = '',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  governanceImpl = createGovernanceReport,
  packageMatrixImpl = createReleaseMatrixReport,
  smokeReadyImpl = createReleaseSmokeReadyReport,
} = {}) {
  assertProjectRelativePath('releaseAssetsDir', releaseAssetsDir);
  assertProjectRelativePath('smokeReleaseAssetsDir', smokeReleaseAssetsDir);
  assertProjectRelativePath('reportDir', reportDir);
  const normalizedReleaseAssetsDir = normalizeProjectPath(releaseAssetsDir);
  const normalizedSmokeReleaseAssetsDir = normalizeProjectPath(smokeReleaseAssetsDir);
  const normalizedReportDir = normalizeProjectPath(reportDir);
  const normalizedSmokeReportDir = normalizeProjectPath(smokeReportDir || `${normalizedSmokeReleaseAssetsDir}/smoke`);
  assertProjectRelativePath('smokeReportDir', normalizedSmokeReportDir);

  const generatedAt = new Date().toISOString();
  const governance = toGovernanceEvidence(
    await runGovernance({
      governanceImpl,
      projectRoot,
      reportDir: normalizedReportDir,
    }),
  );
  const packageMatrix = toPackageMatrixEvidence(
    await runPackageMatrix({
      packageMatrixImpl,
      projectRoot,
      releaseAssetsDir: normalizedReleaseAssetsDir,
      reportDir: normalizedReportDir,
    }),
  );
  const smokeReady = toSmokeReadyEvidence(
    await runSmokeReady({
      bindHost,
      cargoPath,
      chromeExecutablePath,
      ffmpegPath,
      projectRoot,
      releaseAssetsDir: normalizedSmokeReleaseAssetsDir,
      reportDir: normalizedReportDir,
      smokeReadyImpl,
      smokeReportDir: normalizedSmokeReportDir,
      timeoutMs,
    }),
  );
  const packageStatus = packageMatrix.status === 'pass' ? 'ready' : 'failed';
  const smokeStatus = classifySmokeStatus(smokeReady);
  const promotionEligible =
    governance.status === 'pass' &&
    packageStatus === 'ready' &&
    smokeReady.status === 'pass' &&
    smokeReady.requireReady === true &&
    smokeReady.readinessStatus === 'ready' &&
    smokeReady.promotionEligible === true;
  const environmentStatus = smokeReady.environmentStatus || (smokeStatus === 'ready' ? 'ready' : 'failed');
  const environmentBlockers = Array.isArray(smokeReady.environmentBlockers)
    ? smokeReady.environmentBlockers.map(toEnvironmentBlockerEvidence)
    : [];
  const remediationSummary = createRemediationSummary(smokeReady);
  const checksBeforeSafety = [
    checkGovernance(governance),
    checkPackageMatrix(packageMatrix),
    checkSmokeReady(smokeReady),
    checkPromotionEligible({ governance, packageStatus, promotionEligible, smokeReady, smokeStatus }),
  ];
  const summaryBeforeSafety = summarizeChecks(checksBeforeSafety);
  const { absolutePath, reportPath } = createReportPath(projectRoot, normalizedReportDir, REPORT_FILE_NAME);
  const reportDraft = {
    reportVersion: REPORT_VERSION,
    command: COMMAND,
    status: summaryBeforeSafety.fail === 0 ? 'pass' : 'fail',
    packageStatus,
    smokeStatus,
    promotionEligible,
    environmentStatus,
    environmentBlockers,
    remediationSummary,
    generatedAt,
    releaseAssetsDir: normalizedReleaseAssetsDir,
    smokeReleaseAssetsDir: normalizedSmokeReleaseAssetsDir,
    smokeReportDir: normalizedSmokeReportDir,
    reportPath,
    governance,
    packageMatrix,
    smokeReady,
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

async function runGovernance({ governanceImpl, projectRoot, reportDir }) {
  try {
    return await governanceImpl({ category: 'all', projectRoot, reportDir });
  } catch (error) {
    return {
      reportVersion: 'video-cut.governance-suite.v1',
      command: 'check:governance',
      category: 'all',
      status: 'fail',
      reportPath: `${reportDir}/governance-suite-report.json`,
      summary: { pass: 0, warn: 0, fail: 1 },
      error: {
        code: 'RELEASE_READY_FAILED',
        message: sanitizeErrorMessage(error),
      },
      checks: [
        {
          id: 'release-ready-governance-run',
          status: 'fail',
          evidence: sanitizeErrorMessage(error),
        },
      ],
    };
  }
}

async function runPackageMatrix({ packageMatrixImpl, projectRoot, releaseAssetsDir, reportDir }) {
  try {
    return await packageMatrixImpl({ projectRoot, releaseAssetsDir, reportDir });
  } catch (error) {
    return {
      reportVersion: 'video-cut.release-matrix-report.v1',
      command: 'release:package:matrix',
      status: 'fail',
      releaseAssetsDir,
      reportPath: `${reportDir}/release-matrix-report.json`,
      targetSummary: { total: 0, pass: 0, warn: 0, fail: 1 },
      summary: { pass: 0, warn: 0, fail: 1 },
      error: {
        code: 'RELEASE_READY_FAILED',
        message: sanitizeErrorMessage(error),
      },
      checks: [
        {
          id: 'release-ready-package-matrix-run',
          status: 'fail',
          evidence: sanitizeErrorMessage(error),
        },
      ],
      targets: [],
    };
  }
}

async function runSmokeReady({
  bindHost,
  cargoPath,
  chromeExecutablePath,
  ffmpegPath,
  projectRoot,
  releaseAssetsDir,
  reportDir,
  smokeReadyImpl,
  smokeReportDir,
  timeoutMs,
}) {
  try {
    return await smokeReadyImpl({
      bindHost,
      cargoPath,
      chromeExecutablePath,
      ffmpegPath,
      projectRoot,
      releaseAssetsDir,
      reportDir,
      smokeReportDir,
      timeoutMs,
    });
  } catch (error) {
    return {
      reportVersion: 'video-cut.release-smoke-ready-report.v1',
      command: 'release:smoke:ready',
      status: 'fail',
      requireReady: true,
      readinessStatus: 'failed',
      promotionEligible: false,
      environmentStatus: 'failed',
      environmentBlockers: [],
      remediationSummary: createRemediationSummary(),
      reportPath: `${reportDir}/release-smoke-ready-report.json`,
      summary: { pass: 0, warn: 0, fail: 1 },
      error: {
        code: 'RELEASE_READY_FAILED',
        message: sanitizeErrorMessage(error),
      },
      checks: [
        {
          id: 'release-ready-smoke-ready-run',
          status: 'fail',
          evidence: sanitizeErrorMessage(error),
        },
      ],
    };
  }
}

function toGovernanceEvidence(report) {
  return {
    reportVersion: report?.reportVersion ?? '',
    command: report?.command ?? '',
    category: report?.category ?? '',
    status: report?.status ?? 'missing',
    reportPath: toPathEvidence(report?.reportPath),
    summary: report?.summary ?? {},
    checks: toChecks(report?.checks),
    error: toErrorEvidence(report?.error),
  };
}

function toPackageMatrixEvidence(report) {
  return {
    reportVersion: report?.reportVersion ?? '',
    command: report?.command ?? '',
    status: report?.status ?? 'missing',
    releaseAssetsDir: normalizeProjectPath(report?.releaseAssetsDir ?? ''),
    reportPath: toPathEvidence(report?.reportPath),
    targetSummary: report?.targetSummary ?? {},
    summary: report?.summary ?? {},
    checks: toChecks(report?.checks),
    targets: Array.isArray(report?.targets) ? report.targets.map(toPackageTargetEvidence) : [],
    error: toErrorEvidence(report?.error),
  };
}

function toPackageTargetEvidence(target) {
  return {
    target: target?.target ?? '',
    action: target?.action ?? '',
    status: target?.status ?? 'missing',
    releaseAssetsDir: normalizeProjectPath(target?.releaseAssetsDir ?? ''),
    manifestPath: normalizeProjectPath(target?.manifestPath ?? ''),
    missingStandardFiles: Array.isArray(target?.missingStandardFiles) ? target.missingStandardFiles : [],
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

function toSmokeReadyEvidence(report) {
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

function toEnvironmentBlockerEvidence(blocker) {
  return {
    id: blocker?.id ?? '',
    code: blocker?.code ?? 'RELEASE_SMOKE_ENV_PREFLIGHT_BLOCKED',
    category: blocker?.category ?? 'preflight',
    evidence: sanitizeErrorMessage(blocker?.evidence ?? ''),
  };
}

function checkGovernance(governance) {
  return checkResult({
    id: 'release-ready-governance',
    passed:
      governance.reportVersion === 'video-cut.governance-suite.v1' &&
      governance.command === 'check:governance' &&
      governance.category === 'all' &&
      governance.status === 'pass',
    evidence: `${governance.reportPath || 'governance-suite-report.json'}: governance suite passed.`,
    failMessage: `Release ready requires governance status=pass; current status=${governance.status}.`,
  });
}

function checkPackageMatrix(packageMatrix) {
  return checkResult({
    id: 'release-ready-package-matrix',
    passed:
      packageMatrix.reportVersion === 'video-cut.release-matrix-report.v1' &&
      packageMatrix.command === 'release:package:matrix' &&
      packageMatrix.status === 'pass' &&
      Number(packageMatrix.targetSummary?.pass ?? 0) === 5 &&
      Number(packageMatrix.targetSummary?.fail ?? 0) === 0,
    evidence: `${packageMatrix.reportPath || 'release-matrix-report.json'}: all release package targets passed.`,
    failMessage: `Release ready requires package matrix status=pass with five passed targets; current status=${packageMatrix.status}.`,
  });
}

function checkSmokeReady(smokeReady) {
  const nestedPromotionCheck = smokeReady.checks.find((check) => check.id === 'release-smoke-ready-promotion-eligible');
  return checkResult({
    id: 'release-ready-smoke-ready',
    passed:
      smokeReady.reportVersion === 'video-cut.release-smoke-ready-report.v1' &&
      smokeReady.command === 'release:smoke:ready' &&
      smokeReady.status === 'pass' &&
      smokeReady.requireReady === true &&
      smokeReady.readinessStatus === 'ready' &&
      smokeReady.promotionEligible === true &&
      nestedPromotionCheck?.status === 'pass',
    evidence: `${smokeReady.reportPath || 'release-smoke-ready-report.json'}: commercial smoke ready gate passed.`,
    failMessage: `Release ready requires smoke readinessStatus=ready and promotionEligible=true; current readinessStatus=${smokeReady.readinessStatus} promotionEligible=${smokeReady.promotionEligible}.`,
  });
}

function classifySmokeStatus(smokeReady) {
  const nestedPromotionCheck = smokeReady.checks.find((check) => check.id === 'release-smoke-ready-promotion-eligible');
  if (smokeReady.readinessStatus !== 'ready') {
    return smokeReady.readinessStatus;
  }

  return smokeReady.status === 'pass' &&
    smokeReady.requireReady === true &&
    smokeReady.promotionEligible === true &&
    nestedPromotionCheck?.status === 'pass'
    ? 'ready'
    : 'failed';
}

function checkPromotionEligible({ governance, packageStatus, promotionEligible, smokeReady, smokeStatus }) {
  const nestedPromotionCheck = smokeReady.checks.find((check) => check.id === 'release-smoke-ready-promotion-eligible');
  const expected =
    governance.status === 'pass' &&
    packageStatus === 'ready' &&
    smokeReady.reportVersion === 'video-cut.release-smoke-ready-report.v1' &&
    smokeReady.command === 'release:smoke:ready' &&
    smokeReady.status === 'pass' &&
    smokeReady.requireReady === true &&
    smokeReady.readinessStatus === 'ready' &&
    smokeReady.promotionEligible === true &&
    nestedPromotionCheck?.status === 'pass';
  const passed = promotionEligible === expected;

  return checkResult({
    id: 'release-ready-promotion-eligible',
    passed,
    evidence: promotionEligible
      ? 'Release ready report is promotion eligible.'
      : `Release ready report is not promotion eligible because packageStatus=${packageStatus} and smokeStatus=${smokeStatus}.`,
    failMessage: `Release ready promotionEligible drift: promotionEligible=${promotionEligible} packageStatus=${packageStatus} smokeStatus=${smokeStatus}.`,
  });
}

function checkReportSafety(report) {
  const sensitive = reportContainsSensitiveData(report);
  const localPath = findLocalAbsolutePath(report);
  return checkResult({
    id: 'release-ready-redaction-and-path-safety',
    passed: !sensitive && !localPath,
    evidence: 'Release ready report contains no credential-shaped values and no server-local absolute paths.',
    failMessage: `Release ready report must not contain sensitive data or local paths. Sensitive=${sensitive} localPath=${localPath}`,
  });
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

function toErrorEvidence(error) {
  if (!error) {
    return null;
  }

  return {
    code: error?.code ?? 'RELEASE_READY_FAILED',
    message: sanitizeErrorMessage(error?.message ?? error),
  };
}

function toPathEvidence(path) {
  const value = String(path || '');
  return findLocalAbsolutePath(value) ? sanitizeErrorMessage(value) : normalizeProjectPath(value);
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
    'SDKWork Video Cut Release Ready',
    `packageStatus: ${report.packageStatus}`,
    `smokeStatus: ${report.smokeStatus}`,
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
    const options = parseReleaseReadyArgs(process.argv.slice(2));
    const report = await createReleaseReadyReport(options);
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
          error: {
            code: 'RELEASE_READY_FAILED',
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
